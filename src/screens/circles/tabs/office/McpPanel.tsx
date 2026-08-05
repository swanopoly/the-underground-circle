import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';
import {
  getTrustedMcpServerIds,
  setMcpServerTrusted,
  MCP_TRUST_WARNING_COPY,
} from '../../../../lib/circleMcpTrustSettings';

interface McpServer {
  id: string;
  name: string;
  url: string;
  type: 'sse' | 'http';
  status: string;
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

type RiskTier = 'low' | 'medium' | 'high' | 'unknown';

const RISK_KEYWORDS: Record<string, RiskTier> = {
  read: 'low', get: 'low', list: 'low', search: 'low', fetch: 'low', query: 'low', describe: 'low',
  write: 'medium', create: 'medium', update: 'medium', set: 'medium', add: 'medium', put: 'medium', post: 'medium',
  delete: 'high', remove: 'high', drop: 'high', destroy: 'high', execute: 'high', run: 'high', exec: 'high', eval: 'high',
};

function inferRiskTier(toolName: string): RiskTier {
  const lower = toolName.toLowerCase();
  for (const [keyword, tier] of Object.entries(RISK_KEYWORDS)) {
    if (lower.includes(keyword)) return tier;
  }
  return 'unknown';
}

const RISK_COLORS: Record<RiskTier, { bg: string; text: string; label: string }> = {
  low: { bg: '#22c55e18', text: '#22c55e', label: 'LOW' },
  medium: { bg: '#eab30818', text: '#eab308', label: 'MED' },
  high: { bg: '#ef444418', text: '#ef4444', label: 'HIGH' },
  unknown: { bg: '#6366f118', text: '#6366f1', label: '?' },
};

interface Props {
  circleId: string;
  onClose: () => void;
}

export default function McpPanel({ circleId, onClose }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, McpTool[]>>({});
  const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({});
  const [trustedIds, setTrustedIds] = useState<string[]>([]);
  const [togglingTrust, setTogglingTrust] = useState<string | null>(null);

  useEffect(() => {
    loadServers();
  }, [circleId]);

  const loadServers = async () => {
    setLoading(true);
    const [{ data, error }, trusted] = await Promise.all([
      supabase
        .from('circle_mcp_servers')
        .select('*')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false }),
      getTrustedMcpServerIds(circleId),
    ]);

    if (error) console.error('Error loading MCP servers:', error);
    else setServers(data || []);
    setTrustedIds(trusted);
    setLoading(false);
  };

  // Confirmation helper — window.confirm on web (RN-web Alert.alert with
  // buttons is a no-op), Alert.alert on native. Same pattern as
  // AgentGatewayPanels.
  const confirmTrust = (message: string): Promise<boolean> => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return Promise.resolve(window.confirm(message));
    }
    return new Promise(resolve => {
      Alert.alert('Trust this MCP server?', message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Trust Server', style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  };

  const handleToggleTrust = async (server: McpServer) => {
    const currentlyTrusted = trustedIds.includes(server.id);
    if (!currentlyTrusted) {
      const ok = await confirmTrust(`Trust "${server.name}"?\n\n${MCP_TRUST_WARNING_COPY}`);
      if (!ok) return;
    }
    setTogglingTrust(server.id);
    const result = await setMcpServerTrusted(circleId, server.id, !currentlyTrusted);
    if (result.ok) {
      setTrustedIds(result.trustedIds);
    } else if (result.error) {
      Alert.alert('Error', result.error);
    }
    setTogglingTrust(null);
  };

  const fetchTools = async (server: McpServer) => {
    setLoadingTools(prev => ({ ...prev, [server.id]: true }));
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'list-tools',
          method: 'tools/list',
          params: {}
        }),
      });

      const data = await response.json();
      if (data.result && data.result.tools) {
        setServerTools(prev => ({ ...prev, [server.id]: data.result.tools }));
      } else {
        setServerTools(prev => ({ ...prev, [server.id]: [] }));
      }
    } catch (e) {
      console.error('Failed to fetch tools:', e);
      setServerTools(prev => ({ ...prev, [server.id]: [] }));
    }
    setLoadingTools(prev => ({ ...prev, [server.id]: false }));
  };

  const handleAddServer = async () => {
    if (!newName.trim() || !newUrl.trim()) return;
    setAdding(true);
    try {
      const type = newUrl.startsWith('http') ? 'http' : 'sse';
      const { error } = await supabase.from('circle_mcp_servers').insert({
        circle_id: circleId,
        name: newName.trim(),
        url: newUrl.trim(),
        type,
      });

      if (error) throw error;

      setNewName('');
      setNewUrl('');
      loadServers();

      // Log activity
      await supabase.from('agent_activity').insert({
        circle_id: circleId,
        agent_name: 'System',
        source: 'system',
        activity_type: 'task_started',
        content: `Registered new MCP Server: ${newName}`,
      });

    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
    setAdding(false);
  };

  const handleDeleteServer = async (id: string) => {
    const { error } = await supabase
      .from('circle_mcp_servers')
      .delete()
      .eq('id', id);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      // Clean up the trust entry so deleted servers don't keep occupying a
      // slot in the bounded trusted-id list.
      if (trustedIds.includes(id)) {
        const result = await setMcpServerTrusted(circleId, id, false);
        if (result.ok) setTrustedIds(result.trustedIds);
      }
      setServerTools(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      loadServers();
    }
  };

  const testConnection = async (server: McpServer) => {
    setTesting(server.id);
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'Underground Circle Host', version: '1.0.0' }
          }
        }),
      });

      const data = await response.json();
      if (data.result) {
        const sn = data.result.serverInfo?.name || 'MCP Server';
        const sv = data.result.serverInfo?.version;
        Alert.alert('Success', `Connected to ${sn} (v${sv})`);
        // Auto-fetch tools after successful connection test
        fetchTools(server);
      } else {
        throw new Error(data.error?.message || 'Invalid MCP response');
      }
    } catch (e: any) {
      Alert.alert('Connection Failed', e.message);
    }
    setTesting(null);
  };

  const renderToolRow = (tool: McpTool) => {
    const risk = inferRiskTier(tool.name);
    const riskStyle = RISK_COLORS[risk];
    return (
      <View key={tool.name} style={styles.toolRow}>
        <View style={styles.toolInfo}>
          <Text style={styles.toolName}>{tool.name}</Text>
          {tool.description ? (
            <Text style={styles.toolDesc} numberOfLines={2}>{tool.description}</Text>
          ) : null}
        </View>
        <View style={[styles.riskBadge, { backgroundColor: riskStyle.bg }]}>
          <Text style={[styles.riskBadgeText, { color: riskStyle.text }]}>{riskStyle.label}</Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>MCP HUB</Text>
          <Text style={styles.subtitle}>Model Context Protocol — Bridge local tools to your agents</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.form}>
          <Text style={styles.label}>REGISTER EXTERNAL MCP SERVER</Text>
          <TextInput
            style={styles.input}
            placeholder="Server Name (e.g. My Local Files)"
            placeholderTextColor="#6f6f6f"
            value={newName}
            onChangeText={setNewName}
          />
          <TextInput
            style={styles.input}
            placeholder="URL (e.g. http://localhost:3000/mcp)"
            placeholderTextColor="#6f6f6f"
            value={newUrl}
            onChangeText={setNewUrl}
            autoCapitalize="none"
          />
          <Pressable
            style={[styles.addBtn, (!newName || !newUrl || adding) && styles.btnDisabled]}
            onPress={handleAddServer}
            disabled={!newName || !newUrl || adding}
          >
            {adding ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addBtnText}>ADD SERVER</Text>}
          </Pressable>
        </View>

        <View style={styles.listSection}>
          <Text style={styles.label}>CONNECTED SERVERS</Text>
          {loading ? (
            <ActivityIndicator size="small" color="#e8e8e8" style={{ marginTop: 20 }} />
          ) : servers.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No MCP servers registered.</Text>
            </View>
          ) : (
            servers.map((server) => {
              const tools = serverTools[server.id];
              const isLoadingTools = loadingTools[server.id];
              const isTrusted = trustedIds.includes(server.id);
              return (
                <View key={server.id} style={styles.serverCardWrapper}>
                  <View style={styles.serverCard}>
                    <View style={styles.serverInfo}>
                      <View style={styles.serverNameRow}>
                        <Text style={styles.serverName}>{server.name}</Text>
                        {tools && tools.length > 0 && (
                          <View style={styles.toolCountBadge}>
                            <Text style={styles.toolCountText}>{tools.length} tool{tools.length !== 1 ? 's' : ''}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.serverUrl} numberOfLines={1}>{server.url}</Text>
                      <View style={styles.badgeRow}>
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{server.type.toUpperCase()}</Text>
                        </View>
                        <Pressable
                          onPress={() => handleToggleTrust(server)}
                          disabled={togglingTrust === server.id}
                          style={[styles.trustToggle, isTrusted ? styles.trustToggleOn : styles.trustToggleOff]}
                        >
                          {togglingTrust === server.id ? (
                            <ActivityIndicator size="small" color={isTrusted ? '#22c55e' : '#6f6f6f'} />
                          ) : (
                            <Text style={[styles.trustToggleText, { color: isTrusted ? '#22c55e' : '#6f6f6f' }]}>
                              {isTrusted ? '✓ TRUSTED' : 'UNTRUSTED'}
                            </Text>
                          )}
                        </Pressable>
                      </View>
                      {isTrusted && (
                        <Text style={styles.trustNote}>
                          Read-only tools run without approval. Output is still treated as untrusted data.
                        </Text>
                      )}
                    </View>
                    <View style={styles.serverActions}>
                      <Pressable
                        onPress={() => testConnection(server)}
                        style={styles.actionBtn}
                        disabled={testing === server.id}
                      >
                        {testing === server.id ? (
                          <ActivityIndicator size="small" color="#e8e8e8" />
                        ) : (
                          <Text style={styles.actionBtnText}>TEST</Text>
                        )}
                      </Pressable>
                      <Pressable onPress={() => handleDeleteServer(server.id)} style={styles.deleteBtn}>
                        <Text style={styles.deleteBtnText}>✕</Text>
                      </Pressable>
                    </View>
                  </View>
                  {/* Tools section */}
                  {isLoadingTools && (
                    <View style={styles.toolsLoading}>
                      <ActivityIndicator size="small" color="#6366f1" />
                      <Text style={styles.toolsLoadingText}>Fetching tools...</Text>
                    </View>
                  )}
                  {tools && tools.length > 0 && (
                    <View style={styles.toolsSection}>
                      <View style={styles.toolsHeader}>
                        <Text style={styles.toolsSectionLabel}>AVAILABLE TOOLS</Text>
                        <Pressable onPress={() => fetchTools(server)} style={styles.refreshBtn}>
                          <Text style={styles.refreshBtnText}>↻ Refresh Tools</Text>
                        </Pressable>
                      </View>
                      {tools.map(renderToolRow)}
                    </View>
                  )}
                  {tools && tools.length === 0 && !isLoadingTools && (
                    <View style={styles.toolsSection}>
                      <Text style={styles.noToolsText}>No tools reported by this server.</Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>💡 Pro Tip: Local Data Access</Text>
          <Text style={styles.infoText}>
            Run an MCP server locally (e.g. using @modelcontextprotocol/server-filesystem) and expose it via ngrok or cloudflared to give your Circle agents access to your local codebase.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#161616',
  },
  title: {
    color: '#e8e8e8',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  subtitle: {
    color: '#9e9e9e',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    padding: 10,
  },
  closeText: {
    color: '#9e9e9e',
    fontSize: 20,
  },
  scroll: {
    padding: 16,
  },
  form: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#252525',
  },
  label: {
    color: '#6f6f6f',
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#000000',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#e8e8e8',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#252525',
    marginBottom: 12,
  },
  addBtn: {
    backgroundColor: '#6366f1',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  listSection: {
    marginBottom: 24,
  },
  empty: {
    padding: 30,
    alignItems: 'center',
    backgroundColor: '#16161640',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    borderColor: '#252525',
  },
  emptyText: {
    color: '#6f6f6f',
    fontSize: 14,
  },
  serverCardWrapper: {
    marginBottom: 12,
  },
  serverCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#252525',
  },
  serverInfo: {
    flex: 1,
    marginRight: 12,
  },
  serverNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serverName: {
    color: '#e8e8e8',
    fontSize: 15,
    fontWeight: '600',
  },
  toolCountBadge: {
    backgroundColor: '#6366f125',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  toolCountText: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '600',
  },
  serverUrl: {
    color: '#6f6f6f',
    fontSize: 12,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  badge: {
    backgroundColor: '#6366f120',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  trustToggle: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
  },
  trustToggleOn: {
    borderColor: '#22c55e60',
    backgroundColor: '#22c55e12',
  },
  trustToggleOff: {
    borderColor: '#3a3a3a',
    backgroundColor: 'transparent',
  },
  trustToggleText: {
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  trustNote: {
    color: '#eab308',
    fontSize: 10,
    marginTop: 6,
    fontStyle: 'italic',
  },
  badgeText: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: 'bold',
  },
  serverActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#22c55e60',
  },
  actionBtnText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '700',
  },
  deleteBtn: {
    padding: 6,
  },
  deleteBtnText: {
    color: '#ef4444',
    fontSize: 16,
  },
  toolsSection: {
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#252525',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
  },
  toolsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  toolsSectionLabel: {
    color: '#6f6f6f',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  refreshBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#6366f140',
  },
  refreshBtnText: {
    color: '#6366f1',
    fontSize: 10,
    fontWeight: '600',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  toolInfo: {
    flex: 1,
    marginRight: 8,
  },
  toolName: {
    color: '#d4d4d4',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  toolDesc: {
    color: '#6f6f6f',
    fontSize: 11,
    marginTop: 2,
  },
  riskBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  riskBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  toolsLoading: {
    backgroundColor: '#0d0d0d',
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: '#252525',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolsLoadingText: {
    color: '#6f6f6f',
    fontSize: 11,
  },
  noToolsText: {
    color: '#6f6f6f',
    fontSize: 11,
    fontStyle: 'italic',
  },
  infoBox: {
    backgroundColor: '#3b82f610',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3b82f625',
  },
  infoTitle: {
    color: '#e8e8e8',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  infoText: {
    color: '#9e9e9e',
    fontSize: 12,
    lineHeight: 18,
  },
});
