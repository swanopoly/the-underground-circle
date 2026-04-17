import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { getResearchAgentRunById, type ResearchAgentRun } from '../../lib/researchControl';

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

function statusColor(status: ResearchAgentRun['status'] | undefined): string {
  switch (status) {
    case 'succeeded':
      return GREEN;
    case 'failed':
      return RED;
    default:
      return AMBER;
  }
}

function summaryRows(run: ResearchAgentRun | null): Array<{ label: string; value: string }> {
  if (!run) return [];
  return [
    { label: 'Profile', value: run.profile_key },
    { label: 'Source', value: run.source },
    { label: 'Status', value: run.status },
    { label: 'Run Date', value: run.run_date },
    { label: 'Documents Created', value: String(run.documents_created || 0) },
    { label: 'Started', value: run.started_at || 'n/a' },
    { label: 'Completed', value: run.completed_at || 'n/a' },
  ];
}

export default function ResearchRunDetailScreen({ navigation, route }: any) {
  const runId = route?.params?.runId as string;
  const [run, setRun] = useState<ResearchAgentRun | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!runId) return;
    setRefreshing(true);
    try {
      const next = await getResearchAgentRunById(runId);
      setRun(next);
    } finally {
      setRefreshing(false);
    }
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tone = statusColor(run?.status);

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
            <Text style={styles.kicker}>Research Run</Text>
            <Text style={styles.title}>{run?.profile_key || 'Loading run...'}</Text>
            <Text style={styles.subtitle}>Execution detail for a single automated or manual research-agent run.</Text>
          </View>
        </View>

        {!run ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Run unavailable</Text>
            <Text style={styles.cardBody}>This run could not be loaded. It may have been removed or is not accessible.</Text>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{run.profile_key}</Text>
                  <Text style={styles.cardMeta}>{run.source} • {run.run_date}</Text>
                </View>
                <View style={[styles.badge, { borderColor: tone + '45', backgroundColor: tone + '12' }]}>
                  <Text style={[styles.badgeText, { color: tone }]}>{run.status.toUpperCase()}</Text>
                </View>
              </View>
              {run.error ? <Text style={styles.errorText}>{run.error}</Text> : null}
              {run.query ? (
                <>
                  <Text style={styles.sectionLabel}>Query</Text>
                  <Text style={styles.cardBody}>{run.query}</Text>
                </>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Run Summary</Text>
              {summaryRows(run).map((row) => (
                <View key={row.label} style={styles.metaRow}>
                  <Text style={styles.metaKey}>{row.label}</Text>
                  <Text style={styles.metaValue}>{row.value}</Text>
                </View>
              ))}
            </View>

            {(run.target_spirits || []).length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Target SOULs</Text>
                <View style={styles.chipWrap}>
                  {(run.target_spirits || []).map((spiritId) => (
                    <View key={spiritId} style={styles.chip}>
                      <Text style={styles.chipText}>{spiritId}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {run.summary && Object.keys(run.summary).length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>Run Metadata</Text>
                {Object.entries(run.summary).map(([key, value]) => (
                  <View key={key} style={styles.metaRow}>
                    <Text style={styles.metaKey}>{key}</Text>
                    <Text style={styles.metaValue}>{typeof value === 'string' ? value : JSON.stringify(value)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { padding: 20, paddingBottom: 48 },
  header: { marginBottom: 20 },
  backText: { color: CYAN, fontSize: 14, fontWeight: '600' },
  headerCopy: { marginTop: 14 },
  kicker: { color: CYAN, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: TEXT_PRI, fontSize: 28, fontWeight: '800', marginTop: 6 },
  subtitle: { color: TEXT_SEC, fontSize: 14, marginTop: 8, maxWidth: 760, lineHeight: 20 },
  card: { backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 16, padding: 16, marginBottom: 14 },
  cardTop: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardTitle: { color: TEXT_PRI, fontSize: 16, fontWeight: '700' },
  cardMeta: { color: TEXT_TER, fontSize: 12, marginTop: 6 },
  cardBody: { color: TEXT_SEC, fontSize: 13, marginTop: 10, lineHeight: 19 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  sectionLabel: { color: TEXT_PRI, fontSize: 12, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8, textTransform: 'uppercase' },
  errorText: { color: RED, fontSize: 13, lineHeight: 19, marginTop: 10 },
  metaRow: { paddingVertical: 7, borderTopWidth: 1, borderTopColor: BORDER_DEF },
  metaKey: { color: CYAN, fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  metaValue: { color: TEXT_SEC, fontSize: 13, lineHeight: 18, marginTop: 3 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: BG_RAISED, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: TEXT_SEC, fontSize: 11, fontWeight: '700' },
});
