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
const hoverPrimaryIn = { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#6366f130', transform: [{ translateY: -1 }] };
const pressScale = { transform: [{ scale: 0.96 }] };
import {
  type GitHubRepoLite,
  type GitHubSubmitFile,
  type SaveToGitHubResult,
  type SubmitFilesToGitHubResult,
  listReposForSave,
  saveArtifactToGitHub,
  submitFilesToGitHub,
} from '../../../../lib/builderGithubSave';

interface Props {
  circleId: string | null | undefined;
  title: string;
  html: string | null | undefined;
  /** When present, the modal submits these reviewed Room files instead of a builder artifact. */
  files?: GitHubSubmitFile[];
  initialFilePaths?: string[];
  initialRepoFullName?: string | null;
  visible: boolean;
  onClose: () => void;
  onSubmitted?: (result: SubmitFilesToGitHubResult) => void;
}

type ModalResult = SaveToGitHubResult | SubmitFilesToGitHubResult;

export default function BuilderGithubSaveModal({
  circleId,
  title,
  html,
  files,
  initialFilePaths,
  initialRepoFullName,
  visible,
  onClose,
  onSubmitted,
}: Props) {
  const [repos, setRepos] = useState<GitHubRepoLite[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<GitHubRepoLite | null>(null);
  const [branchDraft, setBranchDraft] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [createDraftPullRequest, setCreateDraftPullRequest] = useState(true);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ModalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isRoomSubmission = Array.isArray(files);

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

  useEffect(() => {
    if (!visible) return;
    const availablePaths = (files || []).map(file => file.path);
    const preferredPaths = (initialFilePaths || []).filter(path => availablePaths.includes(path));
    setSelectedPaths(preferredPaths);
    setSelected(null);
    setFilter('');
    setBranchDraft('');
    setCommitMessage(`Room changes — ${title}`.slice(0, 100));
    setCreateDraftPullRequest(true);
    setResult(null);
    setError(null);
    setCopied(false);
  }, [files, initialFilePaths, title, visible]);

  useEffect(() => {
    if (selected || repos.length === 0) return;
    const preferred = initialRepoFullName
      ? repos.find(repo => repo.full_name === initialRepoFullName)
      : null;
    setSelected(preferred || repos[0]);
  }, [initialRepoFullName, repos, selected]);

  const filteredRepos = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(r => r.full_name.toLowerCase().includes(q));
  }, [repos, filter]);

  if (!circleId) return null;

  const chosenFiles = (files || []).filter(file => selectedPaths.includes(file.path));

  const commit = async () => {
    if (!selected || (isRoomSubmission ? chosenFiles.length === 0 : !html)) return;
    setSaving(true);
    setError(null);
    setResult(null);
    try {
      if (isRoomSubmission) {
        const submitted = await submitFilesToGitHub({
          circleId,
          owner: selected.owner,
          repo: selected.name,
          baseBranch: selected.default_branch,
          branch: branchDraft.trim() || undefined,
          title,
          commitMessage: commitMessage.trim() || undefined,
          files: chosenFiles,
          createDraftPullRequest,
        });
        setResult(submitted);
        onSubmitted?.(submitted);
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(submitted.pullRequest?.url || submitted.branchUrl);
            setCopied(true);
          }
        } catch { /* ignore clipboard failures */ }
        return;
      }
      const res = await saveArtifactToGitHub({
        circleId,
        owner: selected.owner,
        repo: selected.name,
        branch: branchDraft.trim() || undefined,
        baseBranch: selected.default_branch,
        title,
        html: html || '',
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
            <Text style={styles.title}>{isRoomSubmission ? 'SUBMIT ROOM FILES' : 'SAVE TO GITHUB'}</Text>
            <Text style={styles.subtitle}>
              {isRoomSubmission
                ? 'Review the exact files below, commit them to a branch, verify GitHub readback, and optionally open a draft pull request.'
                : <>Creates a branch, commits <Text style={{ color: '#e2e8f0' }}>index.html</Text> and a README on that branch.</>}
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
                      {repos.length === 0 ? 'No browser GitHub PAT is available — add one in Marketplace, then reopen this review.' : 'No repos match your filter.'}
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
                          <Text style={[styles.repoName, active && { color: '#6366f1' }]}>{r.full_name}</Text>
                          <Text style={styles.repoMeta}>{r.private ? 'private' : 'public'} · default {r.default_branch || 'main'}</Text>
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
              )}

              {isRoomSubmission ? (
                <View style={{ gap: 5 }}>
                  <View style={styles.selectionHeader}>
                    <Text style={styles.rowLabel}>FILES ({selectedPaths.length}/{files?.length || 0})</Text>
                    <Pressable
                      onPress={() => setSelectedPaths(selectedPaths.length === (files?.length || 0) ? [] : (files || []).map(file => file.path))}
                      accessibilityRole="button"
                      accessibilityLabel={selectedPaths.length === (files?.length || 0) ? 'Clear selected files' : 'Select all files'}>
                      <Text style={styles.linkText}>{selectedPaths.length === (files?.length || 0) ? 'CLEAR' : 'SELECT ALL'}</Text>
                    </Pressable>
                  </View>
                  <ScrollView style={styles.fileList} contentContainerStyle={{ gap: 4 }} nestedScrollEnabled>
                    {(files || []).map(file => {
                      const checked = selectedPaths.includes(file.path);
                      return (
                        <Pressable
                          key={file.path}
                          onPress={() => setSelectedPaths(current => checked
                            ? current.filter(path => path !== file.path)
                            : [...current, file.path])}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          style={[styles.fileRow, checked && styles.fileRowActive]}>
                          <Text style={[styles.checkbox, checked && { color: '#6366f1' }]}>{checked ? '✓' : '○'}</Text>
                          <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
                          <Text style={styles.fileSize}>{file.content.length.toLocaleString()} chars</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>
              ) : null}

              <View style={{ gap: 4 }}>
                <Text style={styles.rowLabel}>BRANCH (AUTO-CREATED IF EMPTY)</Text>
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

              {isRoomSubmission ? (
                <>
                  <View style={{ gap: 4 }}>
                    <Text style={styles.rowLabel}>COMMIT MESSAGE</Text>
                    <TextInput
                      value={commitMessage}
                      onChangeText={setCommitMessage}
                      placeholder="Describe the reviewed changes"
                      placeholderTextColor="#475569"
                      style={styles.input}
                    />
                  </View>
                  <Pressable
                    onPress={() => setCreateDraftPullRequest(value => !value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: createDraftPullRequest }}
                    style={[styles.prToggle, createDraftPullRequest && styles.prToggleActive]}>
                    <Text style={[styles.checkbox, createDraftPullRequest && { color: '#6366f1' }]}>{createDraftPullRequest ? '✓' : '○'}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.prToggleTitle}>Open a draft pull request</Text>
                      <Text style={styles.prToggleHint}>Keeps review separate from the default branch.</Text>
                    </View>
                  </Pressable>
                </>
              ) : null}

              {error && (
                <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
              )}

              <View style={styles.footer}>
                <Pressable onPress={onClose} style={({ hovered, pressed }: any) => [styles.ghostBtn, hoverGhost, hovered && hoverGhostIn, pressed && pressScale]}>
                  <Text style={styles.ghostBtnText}>CANCEL</Text>
                </Pressable>
                <View style={{ flex: 1 }} />
                <Pressable
                  disabled={!selected || (isRoomSubmission ? chosenFiles.length === 0 : !html) || saving}
                  onPress={commit}
                  style={({ hovered, pressed }: any) => [styles.primaryBtn, hoverGhost, (!selected || (isRoomSubmission ? chosenFiles.length === 0 : !html) || saving) && { opacity: 0.5 }, hovered && hoverPrimaryIn, pressed && pressScale]}
                >
                  <Text style={styles.primaryBtnText}>{saving ? 'SUBMITTING…' : isRoomSubmission ? `SUBMIT ${chosenFiles.length} FILE${chosenFiles.length === 1 ? '' : 'S'}` : 'COMMIT'}</Text>
                </Pressable>
              </View>
            </>
          )}

          {result && (
            <View style={{ gap: 10 }}>
              <View style={styles.successBox}>
                <Text style={styles.successTitle}>✓ COMMITTED{isRoomSubmission ? ' · VERIFIED' : ''}{copied ? ' · LINK COPIED' : ''}</Text>
                <Text style={styles.successMeta}>branch: <Text style={{ color: '#e2e8f0' }}>{result.branch}</Text></Text>
                <Text style={styles.successMeta}>sha: <Text style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>{result.commitSha.slice(0, 10)}</Text></Text>
                {'verifiedPaths' in result ? (
                  <Text style={styles.successMeta}>{result.verifiedPaths.length} file{result.verifiedPaths.length === 1 ? '' : 's'} matched GitHub readback.</Text>
                ) : null}
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
                onPress={() => {
                  const url = 'fileUrl' in result ? result.fileUrl : result.fileUrls[0]?.url;
                  if (!url) return;
                  try { window.open(url, '_blank', 'noopener'); } catch {}
                }}
                style={styles.ghostBtn}
              >
                <Text style={styles.ghostBtnText}>{isRoomSubmission ? 'OPEN FIRST FILE' : 'OPEN INDEX.HTML'}</Text>
              </Pressable>
              {'pullRequest' in result && result.pullRequest ? (
                <Pressable
                  onPress={() => { try { window.open(result.pullRequest?.url, '_blank', 'noopener'); } catch {} }}
                  style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>OPEN DRAFT PR #{result.pullRequest.number}</Text>
                </Pressable>
              ) : null}
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
  selectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkText: { color: '#6366f1', fontSize: 9, fontWeight: '900', letterSpacing: 0.7, fontFamily: 'monospace' },
  fileList: { maxHeight: 150, borderWidth: 1, borderColor: '#152032', borderRadius: 8, backgroundColor: '#070b11', padding: 4 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6 },
  fileRowActive: { backgroundColor: '#6366f112' },
  checkbox: { width: 14, color: '#64748b', fontSize: 12, fontWeight: '900', fontFamily: 'monospace' },
  filePath: { flex: 1, color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' },
  fileSize: { color: '#475569', fontSize: 9, fontFamily: 'monospace' },
  prToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#152032', backgroundColor: '#0a0f17' },
  prToggleActive: { borderColor: '#6366f155', backgroundColor: '#6366f10d' },
  prToggleTitle: { color: '#cbd5e1', fontSize: 11, fontWeight: '800' },
  prToggleHint: { color: '#64748b', fontSize: 10, marginTop: 2 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  loadingText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  list: { gap: 4, paddingVertical: 4 },
  empty: { color: '#475569', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', paddingVertical: 24 },
  repoRow: { padding: 10, borderRadius: 6, borderWidth: 1, borderColor: '#152032', backgroundColor: '#0a0f17' },
  repoRowActive: { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#6366f114' },
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
  primaryBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#6366f118', alignItems: 'center' },
  primaryBtnText: { color: '#6366f1', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
});
