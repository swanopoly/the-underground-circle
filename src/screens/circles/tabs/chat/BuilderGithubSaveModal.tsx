/**
 * BuilderGithubSaveModal — pick a repo from the user's connected GitHub
 * account, optionally name the branch, commit the current artifact.
 * Uses the circle's stored GitHub token.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

const hoverGhost = Platform.OS === 'web'
  ? { transition: 'all 0.15s ease' } as any : {};
const hoverGhostIn = { borderColor: '#94a3b8', backgroundColor: '#152032', transform: [{ translateY: -1 }] };
const hoverPrimaryIn = { borderColor: '#22d3ee', backgroundColor: '#22d3ee30', transform: [{ translateY: -1 }] };
const pressScale = { transform: [{ scale: 0.96 }] };
import { type GitHubRepoLite, listReposForSave, saveArtifactToGitHub, type SaveToGitHubResult } from '../../../../lib/builderGithubSave';

interface Props {
  circleId: string | null | undefined;
  title: string;
  html: string | null | undefined;
  visible: boolean;
  onClose: () => void;
}

export default function BuilderGithubSaveModal({ circleId, title, html, visible, onClose }: Props) {
  const [repos, setRepos] = useState<GitHubRepoLite[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<GitHubRepoLite | null>(null);
  const [branchDraft, setBranchDraft] = useState('');
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveToGitHubResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible || !circleId) return;
    let cancelled = false;
    setLoadingRepos(true);
    setError(null);
    listReposForSave(circleId)
      .then(rs => { if (!cancelled) setRepos(rs); })
      .catch(err => { if (!cancelled) setError(err?.message || 'Failed to load repos'); })
      .finally(() => { if (!cancelled) setLoadingRepos(false); });
    return () => { cancelled = true; };
  }, [visible, circleId]);

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(r => r.full_name.toLowerCase().includes(q));
  }, [repos, filter]);

  if (!circleId) return null;

  const commit = async () => {
    if (!selected || !html) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      const res = await saveArtifactToGitHub({
        circleId,
        owner: selected.owner,
        repo: selected.name,
        branch: branchDraft.trim() || undefined,
        baseBranch: selected.default_branch,
        title,
        html,
      });
      setResult(res);
      // Auto-copy the branch URL so the user can paste it straight into chat.
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(res.branchUrl);
          setCopied(true);
        }
      } catch { /* ignore clipboard failures */ }
    } catch (err: any) {
      setError(err?.message || 'Commit failed');
    } finally {
      setSaving(false);
    }
  };

  const copyBranchUrl = async () => {
    if (!result) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.branchUrl);
        setCopied(true);
      }
    } catch { /* ignore */ }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>SAVE TO GITHUB</Text>
            <Text style={styles.subtitle}>
              Creates a branch, commits <Text style={{ color: '#e2e8f0' }}>index.html</Text> and a README on that branch.
            </Text>
          </View>

          {!result && (
            <>
              <TextInput
                value={filter}
                onChangeText={setFilter}
                placeholder="Search repos…"
                placeholderTextColor="#475569"
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {loadingRepos ? (
                <View style={styles.loadingRow}><ActivityIndicator color="#94a3b8" /><Text style={styles.loadingText}>Loading repos…</Text></View>
              ) : (
                <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={styles.list}>
                  {filteredRepos.length === 0 ? (
                    <Text style={styles.empty}>
                      {repos.length === 0 ? 'No connected GitHub account — connect in Integrations first.' : 'No repos match your filter.'}
                    </Text>
                  ) : (
                    filteredRepos.map(r => {
                      const active = selected?.full_name === r.full_name;
                      return (
                        <Pressable
                          key={r.full_name}
                          onPress={() => setSelected(r)}
                          style={[styles.repoRow, active && styles.repoRowActive]}
                        >
                          <Text style={[styles.repoName, active && { color: '#22d3ee' }]}>{r.full_name}</Text>
                          <Text style={styles.repoMeta}>{r.private ? 'private' : 'public'} · default {r.default_branch || 'main'}</Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              )}

              <View style={{ gap: 4 }}>
                <Text style={styles.rowLabel}>BRANCH (OPTIONAL — AUTO IF EMPTY)</Text>
                <TextInput
                  value={branchDraft}
                  onChangeText={setBranchDraft}
                  placeholder="uc-builder/timestamp-slug"
                  placeholderTextColor="#475569"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {error && (
                <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
              )}

              <View style={styles.footer}>
                <Pressable onPress={onClose} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverGhost, hovered && hoverGhostIn, pressed && pressScale]}>
                  <Text style={styles.ghostBtnText}>CANCEL</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable
                  disabled={!selected || !html || saving}
                  onPress={commit}
                  style={({ hovered, pressed }: any) => [styles.primaryBtn, hoverGhost, (!selected || !html || saving) && { opacity: 0.5 }, hovered && hoverPrimaryIn, pressed && pressScale]}
                >
                  <Text style={styles.primaryBtnText}>{saving ? 'COMMITTING…' : 'COMMIT'}</Text>
                </Pressable>
              </View>
            </>
          )}

          {result && (
            <View style={{ gap: 10 }}>
              <View style={styles.successBox}>
                <Text style={styles.successTitle}>✓ COMMITTED{copied ? ' · LINK COPIED' : ''}</Text>
                <Text style={styles.successMeta}>branch: <Text style={{ color: '#e2e8f0' }}>{result.branch}</Text></Text>
                <Text style={styles.successMeta}>sha: <Text style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{result.commitSha.slice(0, 10)}</Text></Text>
              </View>
              <Pressable onPress={copyBranchUrl} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>{copied ? 'COPIED ✓' : 'COPY BRANCH URL'}</Text>
              </Pressable>
              <Pressable
                onPress={() => { try { window.open(result.branchUrl, '_blank', 'noopener'); } catch {} }}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryBtnText}>OPEN BRANCH</Text>
              </Pressable>
              <Pressable
                onPress={() => { try { window.open(result.fileUrl, '_blank', 'noopener'); } catch {} }}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>OPEN INDEX.HTML</Text>
              </Pressable>
              <Pressable onPress={() => { setResult(null); setCopied(false); setSelected(null); setBranchDraft(''); onClose(); }} style={styles.ghostBtn}>
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
  rowLabel: { color: '#425066', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, fontFamily: 'monospace' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  loadingText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  list: { gap: 4, paddingVertical: 4 },
  empty: { color: '#475569', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', paddingVertical: 24 },
  repoRow: { padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#152032', backgroundColor: '#0a0f17' },
  repoRowActive: { borderColor: '#22d3ee', backgroundColor: '#22d3ee14' },
  repoName: { color: '#d8e1ef', fontSize: 12, fontWeight: '800', fontFamily: 'monospace' },
  repoMeta: { color: '#7f8ea3', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  errorBox: { padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#ef4444', backgroundColor: '#2a0a0a' },
  errorText: { color: '#fecaca', fontSize: 12, fontFamily: 'monospace' },
  successBox: { padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#052e14', gap: 4 },
  successTitle: { color: '#22c55e', fontSize: 11, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  successMeta: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ghostBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17' },
  ghostBtnText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  primaryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: '#22d3ee', backgroundColor: '#22d3ee18', alignItems: 'center' },
  primaryBtnText: { color: '#22d3ee', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
});
