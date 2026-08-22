import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import {
  getStoredToken,
  storeToken,
  validateToken,
  listRepos,
  createWebhook,
  deleteWebhook,
  connectViaOAuth,
  getOAuthStatus,
  getConnectedRepos,
  type GitHubRepo,
  type GitHubUser,
  type GitHubOAuthStatus,
} from '../../../lib/github';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/github-webhook`;

interface GitHubConnection {
  id: string;
  circle_id: string;
  owner: string;
  repo: string;
  full_name: string;
  default_branch: string;
  webhook_id: number | null;
  events_enabled: string[];
  notify_chat: boolean;
  notify_activity: boolean;
  is_active: boolean;
  last_event_at: string | null;
  event_count: number;
  created_at: string;
}

interface GitHubEvent {
  id: string;
  event_type: string;
  action: string | null;
  title: string;
  author: string;
  url: string;
  created_at: string;
}

type ViewMode = 'loading' | 'setup' | 'repos' | 'connected';

export default function GitHubTab({ circleId }: { circleId: string }) {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [repoFilter, setRepoFilter] = useState('');
  const [connections, setConnections] = useState<GitHubConnection[]>([]);
  const [recentEvents, setRecentEvents] = useState<GitHubEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectingRepo, setConnectingRepo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oauthStatus, setOauthStatus] = useState<GitHubOAuthStatus | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showPatSection, setShowPatSection] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadState();

    // Realtime subscription for new GitHub events
    const channel = supabase
      .channel(`github-events-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'circle_github_events',
        filter: `circle_id=eq.${circleId}`,
      }, (payload) => {
        const ev = payload.new as GitHubEvent;
        setRecentEvents(prev => [ev, ...prev].slice(0, 20));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [circleId]);

  const loadState = async () => {
    setMode('loading');
    try {
      // Get current user for OAuth
      const { data: { user: authUser } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (authUser) setUserId(authUser.id);

      // Check for existing connections
      const { data: conns } = await supabase
        .from('circle_github_connections')
        .select('id, circle_id, owner, repo, full_name, default_branch, webhook_id, events_enabled, notify_chat, notify_activity, is_active, last_event_at, event_count, created_at')
        .eq('circle_id', circleId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (conns && conns.length > 0) {
        setConnections(conns);
        // Load recent events
        const { data: events } = await supabase
          .from('circle_github_events')
          .select('id, event_type, action, title, author, url, created_at')
          .eq('circle_id', circleId)
          .order('created_at', { ascending: false })
          .limit(20);
        setRecentEvents(events || []);
        setMode('connected');
      } else {
        // Check OAuth status first (preferred), then fall back to PAT
        if (authUser) {
          const oauth = await getOAuthStatus(authUser.id);
          setOauthStatus(oauth);
          if (oauth.connected) {
            // OAuth connected — use OAuth repos
            const { repos: oauthRepos } = await getConnectedRepos(authUser.id);
            if (oauthRepos.length > 0) {
              setGhUser({ login: oauth.github_username || '', avatar_url: '', name: oauth.github_username || null });
              setRepos(oauthRepos.filter(r => !r.archived));
              setMode('repos');
              return;
            }
            // OAuth says connected but we couldn't load repos — still show
            // the connected user so the UI doesn't flip to "Not Connected".
            setGhUser({ login: oauth.github_username || '', avatar_url: '', name: oauth.github_username || null });
            setMode('repos');
            return;
          }
          // If the status call failed transiently (network / 5xx), don't
          // bounce the user into the setup flow — keep whatever PAT/state we
          // have and let them retry. A true "not connected" returns
          // {connected:false} with no `error` field.
          if (oauth.error) {
            setError(`GitHub status check failed (${oauth.error}) — retrying on next load. Your connection has not been removed.`);
          }
        }

        // Fall back to stored PAT
        const stored = await getStoredToken(circleId);
        if (stored) {
          setToken(stored);
          const { user } = await validateToken(stored);
          if (user) setGhUser(user);
        }
        setMode('setup');
      }
    } catch (err) {
      console.error('GitHub load error:', err);
      setMode('setup');
    }
  };

  const handleOAuthConnect = async () => {
    if (!userId) {
      setError('Not authenticated');
      return;
    }
    setOauthLoading(true);
    setError(null);
    try {
      const { url, error: oauthErr } = await connectViaOAuth(circleId, userId);
      if (oauthErr || !url) {
        setError(oauthErr || 'Failed to start OAuth flow');
        return;
      }
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setOauthLoading(false);
    }
  };

  const handleValidateToken = async () => {
    if (!tokenInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { user, error: valErr } = await validateToken(tokenInput.trim());
      if (valErr || !user) {
        setError(valErr || 'Invalid token');
        return;
      }
      await storeToken(circleId, tokenInput.trim());
      setToken(tokenInput.trim());
      setGhUser(user);
      setTokenInput('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleBrowseRepos = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const { repos: repoList, error: repoErr } = await listRepos(token);
      if (repoErr) {
        setError(repoErr);
        return;
      }
      setRepos(repoList.filter(r => !r.archived));
      setMode('repos');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConnectRepo = async (repo: GitHubRepo) => {
    setConnectingRepo(repo.full_name);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Generate webhook secret
      const secretBytes = new Uint8Array(32);
      crypto.getRandomValues(secretBytes);
      const webhookSecret = Array.from(secretBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      // Create webhook on GitHub
      const { webhook, error: whErr } = await createWebhook(
        token,
        repo.owner.login,
        repo.name,
        WEBHOOK_URL,
        webhookSecret,
      );

      if (whErr) {
        setError(`Webhook creation failed: ${whErr}`);
        return;
      }

      // Ensure PAT is stored so Rooms can browse files from this connection
      if (token) {
        await storeToken(circleId, token);
      }

      // Store connection in DB — upsert so re-connecting an existing repo updates it
      const { error: dbErr } = await supabase
        .from('circle_github_connections')
        .upsert({
          circle_id: circleId,
          connected_by: user.id,
          owner: repo.owner.login,
          repo: repo.name,
          full_name: repo.full_name,
          default_branch: repo.default_branch,
          webhook_id: webhook?.id || null,
          webhook_secret: webhookSecret,
          is_active: true,
        }, { onConflict: 'circle_id,owner,repo' });

      if (dbErr) {
        if (webhook?.id) {
          await deleteWebhook(token, repo.owner.login, repo.name, webhook.id);
        }
        throw dbErr;
      }

      // Reload state
      await loadState();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConnectingRepo(null);
    }
  };

  const handleDisconnect = async (conn: GitHubConnection) => {
    const doDisconnect = async () => {
      try {
        // Delete webhook from GitHub
        if (conn.webhook_id && token) {
          await deleteWebhook(token, conn.owner, conn.repo, conn.webhook_id);
        }
        // Deactivate in DB
        await supabase
          .from('circle_github_connections')
          .update({ is_active: false })
          .eq('id', conn.id);
        await loadState();
      } catch (err: any) {
        setError(err.message);
      }
    };

    if (Platform.OS === 'web') {
      if (confirm(`Disconnect ${conn.full_name}?`)) doDisconnect();
    } else {
      Alert.alert('Disconnect', `Remove ${conn.full_name}?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: doDisconnect },
      ]);
    }
  };

  const filteredRepos = repos.filter(r =>
    r.full_name.toLowerCase().includes(repoFilter.toLowerCase())
  );

  const alreadyConnected = new Set(connections.map(c => c.full_name));

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (mode === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    );
  }

  // ─── Connected View ──────────────────────────────────────────────────────
  if (mode === 'connected') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.sectionTitle}>Connected Repositories</Text>

        {connections.map(conn => (
          <View key={conn.id} style={styles.connCard}>
            <View style={styles.connHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.connName}>{conn.full_name}</Text>
                <Text style={styles.connMeta}>
                  {conn.default_branch} · {conn.event_count} events
                  {conn.last_event_at
                    ? ` · last ${timeAgo(conn.last_event_at)}`
                    : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => handleDisconnect(conn)}
                style={styles.disconnectBtn}
              >
                <Text style={styles.disconnectText}>Disconnect</Text>
              </Pressable>
            </View>

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Chat notifications:</Text>
              <Text style={[styles.configValue, conn.notify_chat && styles.configActive]}>
                {conn.notify_chat ? 'ON' : 'OFF'}
              </Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Activity feed:</Text>
              <Text style={[styles.configValue, conn.notify_activity && styles.configActive]}>
                {conn.notify_activity ? 'ON' : 'OFF'}
              </Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Events:</Text>
              <Text style={styles.configValue}>
                {(conn.events_enabled || []).join(', ')}
              </Text>
            </View>
          </View>
        ))}

        {/* File Browsing Access — needed for Rooms to show file tree */}
        <View style={styles.fileBrowsingSection}>
          <Text style={styles.fileBrowsingTitle}>File Browsing (Rooms)</Text>
          {token ? (
            <View style={styles.fileBrowsingStatus}>
              <View style={[styles.statusDot, { backgroundColor: '#22c55e' }]} />
              <Text style={styles.fileBrowsingText}>
                API access active — Rooms can browse files, view code, and make changes.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.fileBrowsingStatus}>
                <View style={[styles.statusDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={styles.fileBrowsingText}>
                  Add a Personal Access Token to enable file browsing in Rooms.
                </Text>
              </View>
              <View style={{ marginTop: 10, gap: 8 }}>
                <TextInput
                  style={styles.tokenInput}
                  value={tokenInput}
                  onChangeText={setTokenInput}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  placeholderTextColor="#555"
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  onPress={handleValidateToken}
                  disabled={!tokenInput.trim() || loading}
                  style={[styles.primaryBtn, (!tokenInput.trim() || loading) && styles.btnDisabled]}
                >
                  <Text style={styles.primaryBtnText}>
                    {loading ? 'Validating...' : 'Save Token'}
                  </Text>
                </Pressable>
                <Text style={{ color: '#555', fontSize: 10, lineHeight: 15 }}>
                  Generate at github.com {'>'} Settings {'>'} Developer settings {'>'} Personal access tokens {'>'} Tokens (classic) with "repo" scope.
                </Text>
              </View>
            </>
          )}
        </View>

        <Pressable
          onPress={handleBrowseRepos}
          style={styles.addRepoBtn}
        >
          <Text style={styles.addRepoBtnText}>+ Connect Another Repo</Text>
        </Pressable>

        {/* Recent Events */}
        {recentEvents.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>
              Recent Events
            </Text>
            {recentEvents.map(ev => (
              <View key={ev.id} style={styles.eventRow}>
                <Text style={styles.eventIcon}>
                  {eventIcon(ev.event_type)}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle} numberOfLines={2}>
                    {ev.title}
                  </Text>
                  <Text style={styles.eventMeta}>
                    {ev.author} · {timeAgo(ev.created_at)}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    );
  }

  // ─── Repo Picker ─────────────────────────────────────────────────────────
  if (mode === 'repos') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        <Pressable onPress={() => setMode('setup')} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Back</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Select a Repository</Text>
        <Text style={styles.desc}>
          Choose a repo to receive webhook events from.
        </Text>

        <TextInput
          style={styles.filterInput}
          value={repoFilter}
          onChangeText={setRepoFilter}
          placeholder="Filter repos..."
          placeholderTextColor="#555"
        />

        {filteredRepos.map(repo => {
          const connected = alreadyConnected.has(repo.full_name);
          const connecting = connectingRepo === repo.full_name;
          return (
            <Pressable
              key={repo.id}
              onPress={() => !connected && !connecting && handleConnectRepo(repo)}
              style={[styles.repoCard, connected && styles.repoCardConnected]}
              disabled={connected || connecting}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.repoName}>{repo.full_name}</Text>
                <Text style={styles.repoDesc} numberOfLines={1}>
                  {repo.description || 'No description'}
                </Text>
                <Text style={styles.repoMeta}>
                  {repo.language || 'unknown'} · {repo.default_branch}
                  {repo.private ? ' · private' : ''}
                </Text>
              </View>
              {connecting ? (
                <ActivityIndicator color="#6366f1" size="small" />
              ) : connected ? (
                <Text style={styles.connectedBadge}>Connected</Text>
              ) : (
                <Text style={styles.connectBtnText}>Connect</Text>
              )}
            </Pressable>
          );
        })}

        {filteredRepos.length === 0 && (
          <Text style={styles.emptyText}>No repos match filter</Text>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    );
  }

  // ─── Setup View ──────────────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.sectionTitle}>GitHub Integration</Text>
      <Text style={styles.desc}>
        Connect GitHub repos to receive push, PR, CI, deploy, security alerts,
        and community events in your circle's chat and activity feed.
      </Text>

      {ghUser ? (
        <View style={styles.userCard}>
          <Text style={styles.userLogin}>@{ghUser.login}</Text>
          <Text style={styles.userName}>{ghUser.name || ''}</Text>
          {oauthStatus?.connected && (
            <Text style={styles.oauthBadge}>Connected via OAuth</Text>
          )}
          <Pressable onPress={handleBrowseRepos} style={styles.primaryBtn}>
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>Browse Repos →</Text>
            )}
          </Pressable>
        </View>
      ) : (
        <View style={styles.tokenSection}>
          {/* OAuth — primary option */}
          <Pressable
            onPress={handleOAuthConnect}
            style={[styles.oauthBtn, oauthLoading && styles.btnDisabled]}
            disabled={oauthLoading}
          >
            {oauthLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.oauthBtnText}>Connect with GitHub</Text>
            )}
          </Pressable>
          <Text style={styles.oauthHint}>
            Securely connect via GitHub OAuth. No tokens to manage.
          </Text>

          {/* PAT — collapsible secondary option */}
          <Pressable
            onPress={() => setShowPatSection(!showPatSection)}
            style={styles.patToggle}
          >
            <Text style={styles.patToggleText}>
              {showPatSection ? '▾' : '▸'} or use a Personal Access Token
            </Text>
          </Pressable>

          {showPatSection && (
            <View style={{ gap: 8 }}>
              <Text style={styles.tokenHint}>
                Create a token at github.com/settings/tokens with "repo" and
                "admin:repo_hook" scopes.
              </Text>
              <TextInput
                style={styles.tokenInput}
                value={tokenInput}
                onChangeText={setTokenInput}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                placeholderTextColor="#555"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                onPress={handleValidateToken}
                style={[styles.primaryBtn, !tokenInput.trim() && styles.btnDisabled]}
                disabled={!tokenInput.trim() || loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Validate & Connect</Text>
                )}
              </Pressable>
            </View>
          )}
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}
    </ScrollView>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function eventIcon(type: string): string {
  switch (type) {
    case 'push': return '>';
    case 'pull_request': return '#';
    case 'pull_request_review': return 'R';
    case 'issues': return '!';
    case 'release': return '@';
    case 'workflow_run': return '*';
    case 'check_run': return 'C';
    case 'check_suite': return 'C';
    case 'deployment': return 'D';
    case 'deployment_status': return 'D';
    case 'code_scanning_alert': return '~';
    case 'secret_scanning_alert': return '~';
    case 'dependabot_alert': return '~';
    case 'projects_v2_item': return 'P';
    case 'discussion': return 'Q';
    case 'discussion_comment': return 'Q';
    case 'star': return 'S';
    case 'fork': return 'F';
    default: return '-';
  }
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  desc: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 12,
  },

  // OAuth
  oauthBtn: {
    backgroundColor: '#238636',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  oauthBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  oauthHint: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 4,
  },
  oauthBadge: {
    color: '#22c55e',
    fontSize: 11,
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  patToggle: {
    marginTop: 16,
    paddingVertical: 8,
  },
  patToggleText: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
  },

  // Token setup
  tokenSection: { gap: 8 },
  tokenHint: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  tokenInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 12,
    color: '#fff',
    fontSize: 13,
    fontFamily: 'monospace',
  },

  // User card
  userCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  userLogin: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  userName: {
    color: '#888',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 8,
  },

  // Buttons
  primaryBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  btnDisabled: { opacity: 0.4 },

  // Repo picker
  filterInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 8,
    padding: 10,
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
    marginBottom: 12,
  },
  repoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  repoCardConnected: { opacity: 0.5 },
  repoName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  repoDesc: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  repoMeta: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  connectBtnText: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginLeft: 8,
  },
  connectedBadge: {
    color: '#22c55e',
    fontSize: 11,
    fontFamily: 'monospace',
    marginLeft: 8,
  },
  emptyText: {
    color: '#555',
    fontSize: 12,
    fontFamily: 'monospace',
    textAlign: 'center',
    paddingVertical: 20,
  },

  // Connected view
  connCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  connHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  connName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  connMeta: {
    color: '#666',
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  disconnectBtn: {
    backgroundColor: '#2a2a2a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 8,
  },
  disconnectText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  configLabel: {
    color: '#888',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  configValue: {
    color: '#555',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  configActive: { color: '#22c55e' },
  fileBrowsingSection: {
    marginTop: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a28',
    backgroundColor: '#0a0a10',
  },
  fileBrowsingTitle: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginBottom: 8,
  },
  fileBrowsingStatus: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  fileBrowsingText: {
    color: '#888',
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 4,
  },
  addRepoBtn: {
    borderWidth: 1,
    borderColor: '#6366f1',
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  addRepoBtnText: {
    color: '#6366f1',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Events
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  eventIcon: {
    color: '#6366f1',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    width: 18,
    textAlign: 'center',
    marginTop: 2,
  },
  eventTitle: {
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 17,
  },
  eventMeta: {
    color: '#555',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 2,
  },

  // Back button
  backBtn: { marginBottom: 12 },
  backBtnText: {
    color: '#6366f1',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
});
