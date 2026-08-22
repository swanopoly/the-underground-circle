/**
 * ClaudeUsagePanel — verified Anthropic spend and cache efficiency for one
 * circle. It is lazy-loaded below the Analytics overview and consumes the same
 * captured-bearer Supabase client as its parent dashboard.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  formatCost,
  formatTokens,
  getClaudeUsageByModelStrict,
  getClaudeUsageSummaryStrict,
  type ClaudeUsageByModel,
  type ClaudeUsageSummary,
} from '../lib/claudeUsage';

interface Props {
  circleId: string;
  client: SupabaseClient;
}

type Range = 1 | 7 | 30;
type LoadState = 'loading' | 'ready' | 'error';

const RANGES: ReadonlyArray<{ value: Range; label: string }> = [
  { value: 1, label: '24h' },
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
];

const EMPTY_SUMMARY: ClaudeUsageSummary = {
  total_cost: 0,
  total_input: 0,
  total_output: 0,
  total_cache_creation: 0,
  total_cache_read: 0,
  request_count: 0,
  cache_hit_rate: 0,
};

const COLORS = {
  surface: '#161b22',
  inset: '#010409',
  hover: '#1c2128',
  border: '#30363d',
  borderMuted: '#21262d',
  text: '#e6edf3',
  secondary: '#8b949e',
  muted: '#484f58',
  accent: '#6366f1',
  accentHover: '#818cf8',
  accentSubtle: '#6366f115',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
} as const;

const WEB_INTERACTIVE = Platform.OS === 'web'
  ? ({ cursor: 'pointer', transitionDuration: '120ms' } as any)
  : null;

export default function ClaudeUsagePanel({ circleId, client }: Props) {
  const [range, setRange] = useState<Range>(7);
  const [summary, setSummary] = useState<ClaudeUsageSummary>(EMPTY_SUMMARY);
  const [byModel, setByModel] = useState<ClaudeUsageByModel[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [refreshToken, setRefreshToken] = useState(0);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    setState('loading');
    setSummary(EMPTY_SUMMARY);
    setByModel([]);

    void Promise.all([
      getClaudeUsageSummaryStrict(circleId, range, client),
      getClaudeUsageByModelStrict(circleId, range, client),
    ]).then(([nextSummary, nextByModel]) => {
      if (generation !== requestGenerationRef.current) return;
      setSummary(nextSummary);
      setByModel(nextByModel);
      setState('ready');
    }).catch((error) => {
      if (generation !== requestGenerationRef.current) return;
      console.warn('[ClaudeUsagePanel] usage read failed:', error);
      setState('error');
    });

    return () => {
      if (generation === requestGenerationRef.current) requestGenerationRef.current += 1;
    };
  }, [circleId, client, range, refreshToken]);

  const projectedFullCost = useMemo(() => {
    const { total_input, total_cache_creation, total_cache_read } = summary;
    if (total_cache_read === 0) return summary.total_cost;
    const totalIn = total_input + total_cache_creation + total_cache_read;
    if (totalIn === 0) return summary.total_cost;
    const assumedRate = 0.80 / 1_000_000;
    const savings = total_cache_read * 0.9 * assumedRate;
    return summary.total_cost + savings;
  }, [summary]);

  const cacheHitPct = Math.round((summary.cache_hit_rate || 0) * 100);
  const cacheTone = cacheHitPct >= 40
    ? COLORS.success
    : cacheHitPct >= 15
      ? COLORS.warning
      : COLORS.danger;
  const estimatedSavings = Math.max(0, projectedFullCost - summary.total_cost);

  return (
    <View style={styles.panel} nativeID="section-analytics-claude-usage">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title} accessibilityRole="header">AI usage</Text>
          <Text style={styles.subtitle}>Claude spend, requests, tokens, and cache performance.</Text>
        </View>
        <View style={styles.rangeRow} accessibilityRole="tablist">
          {RANGES.map((option) => {
            const selected = option.value === range;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityLabel={`Show AI usage for ${option.label}`}
                accessibilityState={{ selected }}
                onPress={() => setRange(option.value)}
                style={({ hovered, pressed, focused }: any) => [
                  styles.rangeButton,
                  selected ? styles.rangeButtonSelected : null,
                  hovered && !selected ? styles.rangeButtonHover : null,
                  pressed ? styles.rangeButtonPressed : null,
                  focused && Platform.OS === 'web' ? styles.keyboardFocus : null,
                  WEB_INTERACTIVE,
                ]}
              >
                <Text style={[styles.rangeText, selected ? styles.rangeTextSelected : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {state === 'loading' ? (
        <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading AI usage">
          <ActivityIndicator color={COLORS.accent} />
          <Text style={styles.loadingText}>Loading verified usage…</Text>
        </View>
      ) : state === 'error' ? (
        <View style={styles.errorState} accessibilityRole="alert">
          <View style={styles.errorCopy}>
            <Text style={styles.errorTitle}>AI usage unavailable</Text>
            <Text style={styles.errorMessage}>
              The latest usage receipt could not be verified, so the dashboard did not substitute a $0 value.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading AI usage"
            onPress={() => setRefreshToken((value) => value + 1)}
            style={({ hovered, pressed, focused }: any) => [
              styles.retryButton,
              hovered ? styles.retryButtonHover : null,
              pressed ? styles.retryButtonPressed : null,
              focused && Platform.OS === 'web' ? styles.keyboardFocus : null,
              WEB_INTERACTIVE,
            ]}
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : summary.request_count === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No AI usage in this period</Text>
          <Text style={styles.emptyMessage}>
            Claude requests from Chat and automations will appear here when activity begins.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.statsGrid}>
            <Stat label="Spend" value={formatCost(summary.total_cost)} />
            <Stat label="Requests" value={summary.request_count.toLocaleString()} />
            <Stat label="Input tokens" value={formatTokens(summary.total_input)} />
            <Stat label="Output tokens" value={formatTokens(summary.total_output)} />
          </View>

          <View style={styles.cacheRow}>
            <View style={styles.cacheCopy}>
              <View style={styles.cacheLabelRow}>
                <View style={[styles.statusDot, { backgroundColor: cacheTone }]} />
                <Text style={styles.cacheLabel}>Cache hit rate</Text>
              </View>
              <Text style={[styles.cacheValue, { color: cacheTone }]}>{cacheHitPct}%</Text>
            </View>
            <View style={styles.cacheDetails}>
              <Text style={styles.cacheDetailLabel}>Read / write</Text>
              <Text style={styles.cacheDetailValue}>
                {formatTokens(summary.total_cache_read)} / {formatTokens(summary.total_cache_creation)}
              </Text>
              {estimatedSavings > 0 ? (
                <Text style={styles.savingsText}>
                  About {formatCost(estimatedSavings)} saved through cache reads
                </Text>
              ) : null}
            </View>
          </View>

          {byModel.length > 0 ? (
            <View style={styles.modelSection}>
              <View style={styles.modelSectionHeader}>
                <Text style={styles.modelSectionTitle}>Usage by model</Text>
                <Text style={styles.modelSectionMeta}>{byModel.length} models</Text>
              </View>
              {byModel.map((model, index) => (
                <View
                  key={model.model}
                  style={[styles.modelRow, index === byModel.length - 1 ? styles.modelRowLast : null]}
                  accessible
                  accessibilityLabel={`${shortModel(model.model)}: ${formatCost(model.total_cost)}, ${model.request_count} requests`}
                >
                  <Text style={styles.modelName} numberOfLines={1}>{shortModel(model.model)}</Text>
                  <View style={styles.modelStats}>
                    <Text style={styles.modelCost}>{formatCost(model.total_cost)}</Text>
                    <Text style={styles.modelMeta}>
                      {model.request_count} requests · {formatTokens(model.input_tokens + model.cache_read + model.cache_creation)} input
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function shortModel(model: string): string {
  if (model.includes('opus-4-7')) return 'Opus 4.7';
  if (model.includes('opus-4-6')) return 'Opus 4.6';
  if (model.includes('opus-4-5')) return 'Opus 4.5';
  if (model.includes('sonnet-4-6')) return 'Sonnet 4.6';
  if (model.includes('sonnet-4-5')) return 'Sonnet 4.5';
  if (model.includes('haiku-4-5')) return 'Haiku 4.5';
  if (model.includes('haiku-3')) return 'Haiku 3';
  return model;
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderMuted,
  },
  headerCopy: {
    flex: 1,
    minWidth: 210,
  },
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: COLORS.secondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rangeButton: {
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeButtonSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSubtle,
  },
  rangeButtonHover: {
    backgroundColor: COLORS.hover,
  },
  rangeButtonPressed: {
    opacity: 0.78,
  },
  rangeText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  rangeTextSelected: {
    color: COLORS.accentHover,
  },
  keyboardFocus: Platform.OS === 'web' ? ({
    outlineStyle: 'solid',
    outlineWidth: 2,
    outlineColor: COLORS.accentHover,
    outlineOffset: 2,
  } as any) : {},
  loading: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: COLORS.secondary,
    fontSize: 12,
  },
  emptyState: {
    minHeight: 150,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyMessage: {
    color: COLORS.secondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 480,
    marginTop: 5,
  },
  errorState: {
    minHeight: 132,
    paddingTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  errorCopy: {
    flex: 1,
    minWidth: 220,
  },
  errorTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  errorMessage: {
    color: COLORS.secondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  retryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.inset,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryButtonHover: {
    backgroundColor: COLORS.hover,
    borderColor: COLORS.secondary,
  },
  retryButtonPressed: {
    opacity: 0.78,
  },
  retryButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 16,
  },
  stat: {
    flexGrow: 1,
    flexBasis: 170,
    minWidth: 130,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: 10,
    backgroundColor: COLORS.inset,
  },
  statLabel: {
    color: COLORS.secondary,
    fontSize: 11,
    fontWeight: '500',
  },
  statValue: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 6,
  },
  cacheRow: {
    marginTop: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    borderRadius: 10,
    backgroundColor: COLORS.inset,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  cacheCopy: {
    minWidth: 130,
  },
  cacheLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  cacheLabel: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  cacheValue: {
    fontSize: 22,
    fontWeight: '700',
    marginTop: 5,
  },
  cacheDetails: {
    flex: 1,
    minWidth: 210,
    alignItems: 'flex-end',
  },
  cacheDetailLabel: {
    color: COLORS.muted,
    fontSize: 11,
  },
  cacheDetailValue: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  savingsText: {
    color: COLORS.success,
    fontSize: 11,
    marginTop: 5,
    textAlign: 'right',
  },
  modelSection: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderMuted,
  },
  modelSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 8,
  },
  modelSectionTitle: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  modelSectionMeta: {
    color: COLORS.muted,
    fontSize: 11,
  },
  modelRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderMuted,
  },
  modelRowLast: {
    borderBottomWidth: 0,
  },
  modelName: {
    flex: 1,
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
  },
  modelStats: {
    alignItems: 'flex-end',
  },
  modelCost: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  modelMeta: {
    color: COLORS.muted,
    fontSize: 10,
    marginTop: 2,
    textAlign: 'right',
  },
});
