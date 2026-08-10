/**
 * BuilderNetlifyDeployModal — one-click publish of the current builder
 * artifact to Netlify. Pick an existing site or spin up a new one, hit
 * DEPLOY, get back a live https:// URL.
 *
 * First-run flow: if no PAT is stored for the circle, the modal swaps
 * into a "connect Netlify" panel with a secure input + instructions.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';

const hoverTr = Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {};
const hoverGhostIn = { borderColor: '#94a3b8', backgroundColor: '#152032', transform: [{ translateY: -1 }] };
const hoverPrimaryIn = { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee30', transform: [{ translateY: -1 }] };
const pressScale = { transform: [{ scale: 0.96 }] };
import {
  type DeployResult, type NetlifySite, type NetlifyUser,
  deployArtifact, getStoredNetlifyToken, listNetlifySites,
  removeNetlifyToken, storeNetlifyToken, validateNetlifyToken,
} from '../../../../lib/netlifyDeploy';

interface Props {
  circleId: string | null | undefined;
  title: string;
  html: string | null | undefined;
  visible: boolean;
  onClose: () => void;
}

type Mode = 'connect' | 'pick' | 'deploying' | 'done';

export default function BuilderNetlifyDeployModal({ circleId, title, html, visible, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('connect');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<NetlifyUser | null>(null);

  // connect-mode state
  const [tokenDraft, setTokenDraft] = useState('');
  const [connecting, setConnecting] = useState(false);

  // pick-mode state
  const [sites, setSites] = useState<NetlifySite[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null); // null = "new site"
  const [loadingSites, setLoadingSites] = useState(false);

  // deploying / result
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Boot: check for stored token, validate, pick site
  useEffect(() => {
    if (!visible || !circleId) return;
    let cancelled = false;
    setError(null);
    setResult(null);
    (async () => {
      const stored = await getStoredNetlifyToken(circleId);
      if (!stored) { if (!cancelled) setMode('connect'); return; }
      const { user: u, error: vErr, status } = await validateNetlifyToken(stored);
      if (cancelled) return;
      if (u) {
        setToken(stored);
        setUser(u);
        setMode('pick');
        return;
      }
      // Genuine auth failure → clear so user can paste a fresh token.
      // Transient errors → keep the token, surface a hint.
      if (status === 401 || status === 403) {
        await removeNetlifyToken(circleId);
        setMode('connect');
        setError('Saved Netlify token was rejected — paste a new one.');
      } else {
        setToken(stored);
        setMode('pick');
        setError(vErr ? `Netlify check failed: ${vErr} (keeping stored token)` : null);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, circleId]);

  // Load sites once we have a valid token
  useEffect(() => {
    if (mode !== 'pick' || !token) return;
    let cancelled = false;
    setLoadingSites(true);
    listNetlifySites(token)
      .then(({ sites: s, error: e }) => {
        if (cancelled) return;
        setSites(s);
        if (e) setError(e);
      })
      .finally(() => { if (!cancelled) setLoadingSites(false); });
    return () => { cancelled = true; };
  }, [mode, token]);

  const filteredSites = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(s =>
      s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q),
    );
  }, [sites, filter]);

  if (!circleId) return null;

  const handleConnect = async () => {
    const trimmed = tokenDraft.trim();
    if (!trimmed) return;
    setConnecting(true);
    setError(null);
    try {
      const { user: u, error: e } = await validateNetlifyToken(trimmed);
      if (!u) { setError(e || 'Invalid token'); return; }
      await storeNetlifyToken(circleId, trimmed);
      setToken(trimmed);
      setUser(u);
      setTokenDraft('');
      setMode('pick');
    } finally {
      setConnecting(false);
    }
  };

  const handleDeploy = async () => {
    if (!html) { setError('Nothing to deploy — build something first.'); return; }
    setMode('deploying');
    setError(null);
    try {
      const res = await deployArtifact({
        circleId,
        siteId: selectedSiteId,
        suggestedName: `uc-${title || 'build'}`,
        html,
      });
      setResult(res);
      // If we just created a new site, remember it so "DEPLOY AGAIN" updates
      // the same site instead of spawning a fresh one every time.
      if (!selectedSiteId) {
        setSelectedSiteId(res.site.id);
        setSites(prev => (prev.some(s => s.id === res.site.id) ? prev : [res.site, ...prev]));
      }
      setMode('done');
    } catch (e: any) {
      setError(e?.message || 'Deploy failed');
      setMode('pick');
    }
  };

  const handleDisconnect = async () => {
    if (!circleId) return;
    await removeNetlifyToken(circleId);
    setToken(null);
    setUser(null);
    setSites([]);
    setSelectedSiteId(null);
    setMode('connect');
  };

  const openUrl = (url: string) => {
    try {
      if (typeof window !== 'undefined' && window.open) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        Linking.openURL(url).catch(() => {});
      }
    } catch {}
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>DEPLOY TO NETLIFY</Text>
            {user && (
              <Text style={styles.subtitle}>
                Connected as <Text style={{ color: '#e2e8f0' }}>{user.email || user.full_name || 'Netlify'}</Text>
              </Text>
            )}
            {!user && mode === 'connect' && (
              <Text style={styles.subtitle}>
                Paste a Netlify Personal Access Token — we store it locally per circle and never send it to our server.
              </Text>
            )}
          </View>

          {mode === 'connect' && (
            <View style={{ gap: 10 }}>
              <TextInput
                value={tokenDraft}
                onChangeText={setTokenDraft}
                placeholder="nfp_…"
                placeholderTextColor="#475569"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Pressable onPress={() => openUrl('https://app.netlify.com/user/applications/personal')} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverTr, hovered && hoverGhostIn, pressed && pressScale]}>
                <Text style={styles.ghostBtnText}>GET A TOKEN →</Text>
              </Pressable>
              {error && (
                <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
              )}
              <View style={styles.footer}>
                <Pressable onPress={onClose} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverTr, hovered && hoverGhostIn, pressed && pressScale]}>
                  <Text style={styles.ghostBtnText}>CANCEL</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable
                  disabled={!tokenDraft.trim() || connecting}
                  onPress={handleConnect}
                  style={({ hovered, pressed }: any) => [styles.primaryBtn, hoverTr, (!tokenDraft.trim() || connecting) && { opacity: 0.5 }, hovered && hoverPrimaryIn, pressed && pressScale]}
                >
                  <Text style={styles.primaryBtnText}>{connecting ? 'CHECKING…' : 'CONNECT'}</Text>
                </Pressable>
              </View>
            </View>
          )}

          {mode === 'pick' && (
            <>
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Filter sites…"
                placeholderTextColor="#475569"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={styles.list}>
                {/* "Create new site" option always at top */}
                <Pressable
                  onPress={() => setSelectedSiteId(null)}
                  style={[styles.siteRow, selectedSiteId === null && styles.siteRowActive]}
                >
                  <Text style={[styles.siteName, selectedSiteId === null && { color: '#22d3ee' }]}>+ CREATE NEW SITE</Text>
                  <Text style={styles.siteMeta}>Netlify picks a random name; you can rename it later.</Text>
                </Pressable>

                {loadingSites ? (
                  <View style={styles.loadingRow}>
                    <ActivityIndicator color="#94a3b8" />
                    <Text style={styles.loadingText}>Loading sites…</Text>
                  </View>
                ) : (
                  filteredSites.map(s => {
                    const active = selectedSiteId === s.id;
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => setSelectedSiteId(s.id)}
                        style={[styles.siteRow, active && styles.siteRowActive]}
                      >
                        <Text style={[styles.siteName, active && { color: '#22d3ee' }]}>{s.name}</Text>
                        <Text style={styles.siteMeta} numberOfLines={1}>{s.ssl_url || s.url}</Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>

              {error && (
                <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
              )}

              <View style={styles.footer}>
                <Pressable onPress={handleDisconnect} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverTr, hovered && hoverGhostIn, pressed && pressScale]}>
                  <Text style={styles.ghostBtnText}>DISCONNECT</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable onPress={onClose} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverTr, hovered && hoverGhostIn, pressed && pressScale]}>
                  <Text style={styles.ghostBtnText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  disabled={!html}
                  onPress={handleDeploy}
                  style={({ hovered, pressed }: any) => [styles.primaryBtn, hoverTr, !html && { opacity: 0.5 }, hovered && hoverPrimaryIn, pressed && pressScale]}
                >
                  <Text style={styles.primaryBtnText}>DEPLOY</Text>
                </Pressable>
              </View>
            </>
          )}

          {mode === 'deploying' && (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#22d3ee" />
              <Text style={styles.loadingText}>
                {selectedSiteId ? 'Publishing new deploy…' : 'Creating site + publishing…'}
              </Text>
            </View>
          )}

          {mode === 'done' && result && (
            <View style={{ gap: 10 }}>
              <View style={styles.successBox}>
                <Text style={styles.successTitle}>✓ LIVE</Text>
                <Text style={styles.successMeta}>site: <Text style={{ color: '#e2e8f0' }}>{result.site.name}</Text></Text>
                <Text style={styles.successMeta} numberOfLines={1}>url: <Text style={{ color: '#e2e8f0' }}>{result.url}</Text></Text>
              </View>
              <Pressable onPress={() => openUrl(result.url)} style={({ hovered, pressed }: any) => [styles.primaryBtn, hoverTr, hovered && hoverPrimaryIn, pressed && pressScale]}>
                <Text style={styles.primaryBtnText}>OPEN SITE</Text>
              </Pressable>
              <Pressable onPress={() => openUrl(result.site.admin_url)} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverTr, hovered && hoverGhostIn, pressed && pressScale]}>
                <Text style={styles.ghostBtnText}>OPEN NETLIFY DASHBOARD</Text>
              </Pressable>
              <Pressable
                onPress={() => { setResult(null); setMode('pick'); }}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>DEPLOY AGAIN</Text>
              </Pressable>
              <Pressable onPress={onClose} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverTr, hovered && hoverGhostIn, pressed && pressScale]}>
                <Text style={styles.ghostBtnText}>DONE</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: { width: '100%', maxWidth: 560, borderRadius: 12, backgroundColor: '#05070b', borderWidth: 1, borderColor: '#152032', padding: 14, gap: 12 },
  header: { gap: 4 },
  title: { color: '#d8e1ef', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, fontFamily: 'monospace' },
  subtitle: { color: '#7f8ea3', fontSize: 11, lineHeight: 15 },
  input: {
    color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  loadingText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  list: { gap: 4, paddingVertical: 4 },
  siteRow: { padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#152032', backgroundColor: '#0a0f17', gap: 2 },
  siteRowActive: { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee14' },
  siteName: { color: '#d8e1ef', fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },
  siteMeta: { color: '#7f8ea3', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  errorBox: { padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ef4444', backgroundColor: '#2a0a0a' },
  errorText: { color: '#fecaca', fontSize: 12, fontFamily: 'monospace' },
  successBox: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#052e14', gap: 4 },
  successTitle: { color: '#22c55e', fontSize: 11, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  successMeta: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17' },
  ghostBtnText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  primaryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee18', alignItems: 'center' },
  primaryBtnText: { color: '#22d3ee', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
});
