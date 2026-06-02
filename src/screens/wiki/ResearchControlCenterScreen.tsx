import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, Alert, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  RESEARCH_PROFILE_OPTIONS,
  SECOND_BRAIN_KNOWLEDGE_PROFILE_OPTIONS,
  getGeneratedResearchBriefs,
  getGeneratedResearchDigests,
  getResearchAgentRuns,
  runSecondBrainKnowledgeProfile,
  runResearchProfile,
  setResearchDocumentReviewStatus,
  type ResearchAgentRun,
} from '../../lib/researchControl';
import type { ResearchDocument } from '../../lib/researchKnowledge';

const BG_PAGE = '#050508';
const BG_SURFACE = '#0a0a10';
const BG_RAISED = '#0f0f18';
const TEXT_PRI = '#f0f0f5';
const TEXT_SEC = '#a0a0b0';
const TEXT_TER = '#606075';
const BORDER_DEF = '#1a1a28';
const CYAN = '#06b6d4';
const GREEN = '#22c55e';
const RED = '#ef4444';
const AMBER = '#f59e0b';

function spiritList(doc: ResearchDocument): string[] {
  const metadata = (doc.metadata || {}) as { relevant_spirits?: unknown };
  return Array.isArray(metadata.relevant_spirits)
    ? metadata.relevant_spirits.filter((item): item is string => typeof item === 'string')
    : [];
}

function ProfileBadge({ run }: { run: ResearchAgentRun }) {
  const tone = run.status === 'succeeded' ? GREEN : run.status === 'failed' ? RED : AMBER;
  return (
    <View style={[styles.badge, { borderColor: tone + '50', backgroundColor: tone + '12' }]}>
      <Text style={[styles.badgeText, { color: tone }]}>{run.status.toUpperCase()}</Text>
    </View>
  );
}

export default function ResearchControlCenterScreen({ navigation, route }: any) {
  const focusDocumentId = route?.params?.focusDocumentId as string | undefined;
  const [runs, setRuns] = useState<ResearchAgentRun[]>([]);
  const [digests, setDigests] = useState<ResearchDocument[]>([]);
  const [briefs, setBriefs] = useState<ResearchDocument[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [runningProfiles, setRunningProfiles] = useState<string[]>([]);
  const [runningKnowledgeProfiles, setRunningKnowledgeProfiles] = useState<string[]>([]);
  const [reviewingDocIds, setReviewingDocIds] = useState<string[]>([]);
  const [docFilter, setDocFilter] = useState<'all' | 'draft' | 'reviewed' | 'validated'>('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [nextRuns, nextDigests, nextBriefs] = await Promise.all([
        getResearchAgentRuns(24),
        getGeneratedResearchDigests(12),
        getGeneratedResearchBriefs(18),
      ]);
      setRuns(nextRuns);
      setDigests(nextDigests);
      setBriefs(nextBriefs);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const successCount = useMemo(() => runs.filter(run => run.status === 'succeeded').length, [runs]);
  const failureCount = useMemo(() => runs.filter(run => run.status === 'failed').length, [runs]);
  const totalDocs = useMemo(() => digests.length + briefs.length, [digests, briefs]);
  const validatedDocs = useMemo(() => [...digests, ...briefs].filter(doc => doc.review_status === 'validated').length, [digests, briefs]);
  const reviewedDocs = useMemo(() => [...digests, ...briefs].filter(doc => doc.review_status === 'reviewed').length, [digests, briefs]);
  const runSuccessRate = runs.length > 0 ? Math.round((successCount / runs.length) * 100) : 0;
  const latestRun = runs[0] || null;
  const normalizedQuery = query.trim().toLowerCase();

  const filterDocuments = useCallback((docs: ResearchDocument[]) => {
    return docs.filter((doc) => {
      if (docFilter !== 'all' && (doc.review_status || 'draft') !== docFilter) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        doc.title,
        doc.summary || '',
        doc.source_title || '',
        ...(doc.tags || []),
        ...spiritList(doc),
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [docFilter, normalizedQuery]);

  const filteredDigests = useMemo(() => filterDocuments(digests), [digests, filterDocuments]);
  const filteredBriefs = useMemo(() => filterDocuments(briefs), [briefs, filterDocuments]);

  const triggerProfile = useCallback(async (profileKey: string) => {
    setRunningProfiles((current) => [...current, profileKey]);
    const result = await runResearchProfile(profileKey);
    setRunningProfiles((current) => current.filter((item) => item !== profileKey));
    if (!result.ok) {
      Alert.alert('Research Run Failed', result.error || 'Could not trigger research profile.');
      return;
    }
    await load();
  }, [load]);

  const triggerKnowledgeProfile = useCallback(async (profileKey: string) => {
    setRunningKnowledgeProfiles((current) => [...current, profileKey]);
    const result = await runSecondBrainKnowledgeProfile({ profileKeys: [profileKey] });
    setRunningKnowledgeProfiles((current) => current.filter((item) => item !== profileKey));
    if (!result.ok) {
      Alert.alert('Knowledge Intake Failed', result.error || 'Could not trigger this knowledge profile.');
      return;
    }
    await load();
  }, [load]);

  const promoteDoc = useCallback(async (
    documentId: string,
    reviewStatus: 'draft' | 'reviewed' | 'validated',
  ) => {
    setReviewingDocIds((current) => [...current, documentId]);
    const result = await setResearchDocumentReviewStatus(documentId, reviewStatus);
    setReviewingDocIds((current) => current.filter((item) => item !== documentId));
    if (!result.ok) {
      Alert.alert('Review Update Failed', result.error || 'Could not update review status.');
      return;
    }
    await load();
  }, [load]);

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={CYAN} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={styles.backText}>{'<-'} Back</Text>
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.kicker}>Knowledge Ops</Text>
            <Text style={styles.title}>Wiki Knowledge Control Center</Text>
            <Text style={styles.subtitle}>Daily research agents, source-backed Wiki documents, broad-domain knowledge intake, and the SOULs they are feeding.</Text>
          </View>
        </View>

        <View style={styles.commandDeck}>
          <View style={styles.commandDeckPrimary}>
            <Text style={styles.commandDeckLabel}>Operations Snapshot</Text>
            <Text style={styles.commandDeckTitle}>Knowledge intelligence pipeline is live</Text>
            <Text style={styles.commandDeckBody}>
              This panel governs automated ingestion, document review state, Wiki coverage, and the research signals currently flowing into matching SOULs and the Digital Brain.
            </Text>
            <View style={styles.commandDeckMetaRow}>
              <Text style={styles.commandDeckMeta}>Success rate: {runSuccessRate}%</Text>
              <Text style={styles.commandDeckMeta}>Validated docs: {validatedDocs}</Text>
              <Text style={styles.commandDeckMeta}>Reviewed docs: {reviewedDocs}</Text>
            </View>
          </View>
          <View style={styles.commandDeckSide}>
            <Text style={styles.commandDeckLabel}>Latest Run</Text>
            <Text style={styles.commandDeckSideTitle}>{latestRun?.profile_key || 'No runs yet'}</Text>
            <Text style={styles.commandDeckSideMeta}>
              {latestRun ? `${latestRun.status.toUpperCase()} • ${latestRun.run_date}` : 'Trigger a profile to generate new intelligence'}
            </Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{runs.length}</Text>
            <Text style={styles.statLabel}>Recent Runs</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{successCount}</Text>
            <Text style={styles.statLabel}>Succeeded</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{failureCount}</Text>
            <Text style={styles.statLabel}>Failed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalDocs}</Text>
            <Text style={styles.statLabel}>Generated Docs</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{validatedDocs}</Text>
            <Text style={styles.statLabel}>Validated</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Research Profiles</Text>
          <Text style={styles.sectionSubtitle}>Kick off focused source intake immediately without waiting for cron.</Text>
          <View style={styles.actionRow}>
            {RESEARCH_PROFILE_OPTIONS.map((profile) => {
              const active = runningProfiles.includes(profile.key);
              return (
                <Pressable
                  key={profile.key}
                  onPress={() => void triggerProfile(profile.key)}
                  style={[styles.runButton, { borderColor: `${profile.color}44` }, active && styles.runButtonActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Run ${profile.label} research profile`}
                >
                  <Text style={styles.runButtonText}>{active ? 'RUNNING…' : profile.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Broad Knowledge Intake</Text>
          <Text style={styles.sectionSubtitle}>
            These profiles feed the Wiki first, and write to a configured .web Digital Brain when a user/circle target is available.
          </Text>
          <View style={styles.knowledgeProfileGrid}>
            {SECOND_BRAIN_KNOWLEDGE_PROFILE_OPTIONS.map((profile) => {
              const active = runningKnowledgeProfiles.includes(profile.key);
              return (
                <Pressable
                  key={profile.key}
                  onPress={() => void triggerKnowledgeProfile(profile.key)}
                  style={[styles.knowledgeProfileCard, { borderColor: `${profile.color}44`, backgroundColor: `${profile.color}10` }, active && styles.runButtonActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Run ${profile.label} knowledge intake`}
                >
                  <Text style={[styles.knowledgeProfileTitle, { color: profile.color }]}>{active ? 'RUNNING...' : profile.label}</Text>
                  <Text style={styles.cardMeta}>{profile.cadence.toUpperCase()} · WIKI + DIGITAL BRAIN</Text>
                  <Text style={styles.cardBody}>{profile.description}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.filterBar}>
          <View style={styles.filterSearchWrap}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Filter by title, source, spirit, tag..."
              placeholderTextColor={TEXT_TER}
              style={styles.filterSearchInput}
            />
          </View>
          <View style={styles.filterChipRow}>
            {(['all', 'draft', 'reviewed', 'validated'] as const).map((value) => (
              <Pressable
                key={value}
                onPress={() => setDocFilter(value)}
                style={[styles.filterChip, docFilter === value && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, docFilter === value && styles.filterChipTextActive]}>
                  {value.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.dashboardGrid}>
          <View style={styles.dashboardMain}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Knowledge Digests</Text>
              <Text style={styles.sectionSubtitle}>Synthesized research drops currently being injected into Wiki, matching spirits, and eligible Digital Brains.</Text>
              {filteredDigests.map((doc) => {
                const isFocused = focusDocumentId === doc.id;
                return (
                <Pressable
                  key={doc.id}
                  onPress={() => navigation.navigate('ResearchDocumentDetail', { documentId: doc.id })}
                  style={[styles.card, isFocused && styles.focusedCard]}
                >
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{doc.title}</Text>
                      <Text style={styles.cardMeta}>{doc.publication_date || 'No date'} · {doc.review_status || 'draft'}</Text>
                    </View>
                    <View style={[styles.badge, { borderColor: CYAN + '40', backgroundColor: CYAN + '12' }]}>
                      <Text style={[styles.badgeText, { color: CYAN }]}>DIGEST</Text>
                    </View>
                  </View>
                  <Text style={styles.cardBody}>{doc.summary || 'No summary yet.'}</Text>
                  <View style={styles.spiritWrap}>
                    {spiritList(doc).map((spiritId) => (
                      <View key={`${doc.id}:${spiritId}`} style={styles.spiritChip}>
                        <Text style={styles.spiritChipText}>{spiritId}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={styles.actionRow}>
                    {(['draft', 'reviewed', 'validated'] as const).map((status) => (
                      <Pressable
                        key={`${doc.id}:${status}`}
                        onPress={(event) => {
                          event.stopPropagation?.();
                          void promoteDoc(doc.id, status);
                        }}
                        style={[
                          styles.statusButton,
                          doc.review_status === status && styles.statusButtonActive,
                          reviewingDocIds.includes(doc.id) && styles.statusButtonBusy,
                        ]}
                        accessibilityRole="button"
                      >
                        <Text style={styles.statusButtonText}>{status.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Pressable>
              )})}
              {filteredDigests.length === 0 ? <Text style={styles.emptyText}>No digests match the current filters.</Text> : null}
            </View>
          </View>

          <View style={styles.dashboardSide}>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Run Activity</Text>
              <Text style={styles.sectionSubtitle}>Backend audit trail for scheduled research agents.</Text>
              {runs.map((run) => (
                <Pressable
                  key={run.id}
                  onPress={() => navigation.navigate('ResearchRunDetail', { runId: run.id })}
                  style={styles.sideCard}
                >
                  <View style={styles.cardTop}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{run.profile_key}</Text>
                      <Text style={styles.cardMeta}>{run.run_date} · {run.source}</Text>
                    </View>
                    <ProfileBadge run={run} />
                  </View>
                  <Text style={styles.cardBody}>
                    {run.documents_created || 0} docs created
                    {run.error ? ` · ${run.error}` : ''}
                  </Text>
                  <View style={styles.spiritWrap}>
                    {(run.target_spirits || []).map((spiritId) => (
                      <View key={`${run.id}:${spiritId}`} style={styles.spiritChip}>
                        <Text style={styles.spiritChipText}>{spiritId}</Text>
                      </View>
                    ))}
                  </View>
                </Pressable>
              ))}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Source Briefs</Text>
              <Text style={styles.sectionSubtitle}>Fresh source-level items collected by the runner across AI, technology, science, cities, health, infrastructure, and more.</Text>
              {filteredBriefs.map((doc) => {
                const isFocused = focusDocumentId === doc.id;
                return (
                <Pressable
                  key={doc.id}
                  onPress={() => navigation.navigate('ResearchDocumentDetail', { documentId: doc.id })}
                  style={[styles.sideCard, isFocused && styles.focusedCard]}
                >
                  <Text style={styles.cardTitle}>{doc.title}</Text>
                  <Text style={styles.cardMeta}>{doc.source_title || 'Source'} · {doc.publication_date || 'No date'}</Text>
                  <Text style={styles.cardBody}>{doc.summary || 'No summary yet.'}</Text>
                  <View style={styles.actionRow}>
                    {(['draft', 'reviewed', 'validated'] as const).map((status) => (
                      <Pressable
                        key={`${doc.id}:${status}`}
                        onPress={(event) => {
                          event.stopPropagation?.();
                          void promoteDoc(doc.id, status);
                        }}
                        style={[
                          styles.statusButton,
                          doc.review_status === status && styles.statusButtonActive,
                          reviewingDocIds.includes(doc.id) && styles.statusButtonBusy,
                        ]}
                        accessibilityRole="button"
                      >
                        <Text style={styles.statusButtonText}>{status.toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                </Pressable>
              )})}
              {filteredBriefs.length === 0 ? <Text style={styles.emptyText}>No source briefs match the current filters.</Text> : null}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { padding: 20, paddingBottom: 48, maxWidth: 1320, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 20 },
  backText: { color: CYAN, fontSize: 14, fontWeight: '600' },
  headerCopy: { marginTop: 14 },
  kicker: { color: CYAN, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: TEXT_PRI, fontSize: 30, fontWeight: '800', marginTop: 6 },
  subtitle: { color: TEXT_SEC, fontSize: 14, marginTop: 8, maxWidth: 760, lineHeight: 20 },
  commandDeck: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 18 },
  commandDeckPrimary: { minWidth: 360, flexGrow: 2, backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 18, padding: 18 },
  commandDeckSide: { minWidth: 260, flexGrow: 1, backgroundColor: BG_RAISED, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 18, padding: 18 },
  commandDeckLabel: { color: TEXT_TER, fontSize: 11, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  commandDeckTitle: { color: TEXT_PRI, fontSize: 20, fontWeight: '800', marginTop: 10 },
  commandDeckBody: { color: TEXT_SEC, fontSize: 14, lineHeight: 21, marginTop: 10, maxWidth: 720 },
  commandDeckMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  commandDeckMeta: { color: CYAN, fontSize: 12, fontWeight: '700' },
  commandDeckSideTitle: { color: TEXT_PRI, fontSize: 18, fontWeight: '700', marginTop: 10 },
  commandDeckSideMeta: { color: TEXT_SEC, fontSize: 13, lineHeight: 20, marginTop: 8 },
  filterBar: { gap: 10, marginBottom: 20 },
  filterSearchWrap: {
    backgroundColor: BG_RAISED,
    borderWidth: 1,
    borderColor: BORDER_DEF,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  filterSearchInput: {
    height: 44,
    color: TEXT_PRI,
    fontSize: 14,
  },
  filterChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER_DEF,
    backgroundColor: BG_RAISED,
  },
  filterChipActive: { borderColor: CYAN + '55', backgroundColor: CYAN + '14' },
  filterChipText: { color: TEXT_SEC, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  filterChipTextActive: { color: CYAN },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 22 },
  statCard: { minWidth: 140, backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 16, padding: 16 },
  statValue: { color: TEXT_PRI, fontSize: 24, fontWeight: '800' },
  statLabel: { color: TEXT_SEC, fontSize: 12, marginTop: 6, textTransform: 'uppercase', letterSpacing: 1 },
  section: { marginBottom: 24 },
  sectionTitle: { color: TEXT_PRI, fontSize: 18, fontWeight: '700' },
  sectionSubtitle: { color: TEXT_SEC, fontSize: 13, marginTop: 6, marginBottom: 12 },
  card: { backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 16, padding: 16, marginBottom: 12 },
  sideCard: { backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 16, padding: 14, marginBottom: 12 },
  focusedCard: { borderColor: CYAN, backgroundColor: CYAN + '10' },
  dashboardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  dashboardMain: { minWidth: 420, flexGrow: 2, flexBasis: 0 },
  dashboardSide: { minWidth: 300, flexGrow: 1, flexBasis: 0 },
  emptyText: { color: TEXT_TER, fontSize: 13, fontStyle: 'italic', marginTop: 4 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardTitle: { color: TEXT_PRI, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: TEXT_TER, fontSize: 12, marginTop: 6 },
  cardBody: { color: TEXT_SEC, fontSize: 13, marginTop: 10, lineHeight: 19 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  spiritWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  spiritChip: { backgroundColor: BG_RAISED, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  spiritChipText: { color: TEXT_SEC, fontSize: 11, fontWeight: '700' },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  runButton: { backgroundColor: CYAN + '14', borderWidth: 1, borderColor: CYAN + '35', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 10 },
  runButtonActive: { backgroundColor: CYAN + '25' },
  runButtonText: { color: CYAN, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  knowledgeProfileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  knowledgeProfileCard: {
    minWidth: 240,
    flexGrow: 1,
    flexBasis: 0,
    backgroundColor: BG_SURFACE,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
  },
  knowledgeProfileTitle: { fontSize: 15, fontWeight: '800' },
  statusButton: { backgroundColor: BG_RAISED, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8 },
  statusButtonActive: { borderColor: GREEN + '50', backgroundColor: GREEN + '14' },
  statusButtonBusy: { opacity: 0.7 },
  statusButtonText: { color: TEXT_SEC, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
