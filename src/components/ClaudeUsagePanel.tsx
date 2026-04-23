/**
 * ClaudeUsagePanel — surfaces Anthropic API spend and cache hit rate for a
 * circle. Populated by edge functions writing to `claude_api_usage` after
 * each Claude call. Lives on the Analytics tab.
 *
 * Style: UC B&W terminal aesthetic (docs/UC_STYLE_GUIDE.md).
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import {
  getClaudeUsageSummary,
  getClaudeUsageByModel,
  formatTokens,
  formatCost,
  type ClaudeUsageSummary,
  type ClaudeUsageByModel,
} from "../lib/claudeUsage";

interface Props {
  circleId: string;
}

type Range = 1 | 7 | 30;

const RANGES: Array<{ value: Range; label: string }> = [
  { value: 1,  label: "24H" },
  { value: 7,  label: "7D" },
  { value: 30, label: "30D" },
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

export default function ClaudeUsagePanel({ circleId }: Props) {
  const [range, setRange] = useState<Range>(7);
  const [summary, setSummary] = useState<ClaudeUsageSummary>(EMPTY_SUMMARY);
  const [byModel, setByModel] = useState<ClaudeUsageByModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getClaudeUsageSummary(circleId, range),
      getClaudeUsageByModel(circleId, range),
    ]).then(([s, m]) => {
      if (cancelled) return;
      setSummary(s);
      setByModel(m);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [circleId, range]);

  // Project what the cost would have been without caching, so the user can
  // see actual savings. Cache reads would have been billed as full input.
  const projectedFullCost = useMemo(() => {
    const { total_input, total_cache_creation, total_cache_read, total_output } = summary;
    if (total_cache_read === 0) return summary.total_cost;
    // Approximate ratio: cache_read bills at 0.1x vs full 1.0x of input rate.
    // We don't know the exact per-model rate here, so approximate from the
    // actual spend ratio — use the effective input rate implied by total_cost.
    const totalIn = total_input + total_cache_creation + total_cache_read;
    if (totalIn === 0) return summary.total_cost;
    // Derive effective input rate: solve for rate assuming haiku-ish
    // proportions is not necessary — just compute savings as cache_read * 0.9 * avgRate.
    // Fallback: assume Haiku base-rate of $0.80/M for a conservative floor.
    const assumedRate = 0.80 / 1_000_000;
    const savings = total_cache_read * 0.9 * assumedRate;
    return summary.total_cost + savings;
  }, [summary]);

  const cacheHitPct = Math.round((summary.cache_hit_rate || 0) * 100);
  const cacheHitColor = cacheHitPct >= 40 ? "#22c55e" : cacheHitPct >= 15 ? "#f59e0b" : "#ef4444";

  return (
    <View style={s.card} nativeID="section-analytics-claude-usage">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>$</Text></View>
        <Text style={s.title}>CLAUDE API SPEND</Text>
        <View style={s.rangeRow}>
          {RANGES.map((r) => {
            const active = r.value === range;
            return (
              <Pressable
                key={r.value}
                onPress={() => setRange(r.value)}
                style={[s.rangePill, active && s.rangePillActive]}
              >
                <Text style={[s.rangeText, active && s.rangeTextActive]}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={s.subtitle}>LAST {range}D · SWANBOT + AUTOMATIONS</Text>
      <View style={s.divider} />

      {loading ? (
        <Text style={s.hint}>LOADING...</Text>
      ) : summary.request_count === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>NO USAGE DATA YET</Text>
          <Text style={s.emptyHint}>DEPLOY THE UPDATED EDGE FUNCTIONS TO START LOGGING.</Text>
        </View>
      ) : (
        <>
          <View style={s.statsGrid}>
            <Stat label="TOTAL SPEND"    value={formatCost(summary.total_cost)} />
            <Stat label="REQUESTS"       value={String(summary.request_count)} />
            <Stat
              label="CACHE HIT"
              value={`${cacheHitPct}%`}
              valueColor={cacheHitColor}
            />
          </View>

          <View style={s.statsGrid}>
            <Stat label="INPUT TOKENS"   value={formatTokens(summary.total_input)} />
            <Stat label="OUTPUT TOKENS"  value={formatTokens(summary.total_output)} />
            <Stat
              label="CACHE READ / WRITE"
              value={`${formatTokens(summary.total_cache_read)} / ${formatTokens(summary.total_cache_creation)}`}
            />
          </View>

          {summary.total_cache_read > 0 && projectedFullCost > summary.total_cost && (
            <View style={s.savingsBox}>
              <Text style={s.savingsLabel}>EST. SAVINGS FROM CACHE</Text>
              <Text style={s.savingsValue}>
                {formatCost(projectedFullCost - summary.total_cost)}
                {" "}
                <Text style={s.savingsPct}>
                  ({Math.round(((projectedFullCost - summary.total_cost) / projectedFullCost) * 100)}% OFF PROJECTED)
                </Text>
              </Text>
            </View>
          )}

          {byModel.length > 0 && (
            <>
              <View style={s.divider} />
              <Text style={s.sectionLabel}>BY MODEL</Text>
              <View style={s.modelList}>
                {byModel.map((m) => (
                  <View key={m.model} style={s.modelRow}>
                    <Text style={s.modelName} numberOfLines={1}>{shortModel(m.model)}</Text>
                    <View style={s.modelStats}>
                      <Text style={s.modelCost}>{formatCost(m.total_cost)}</Text>
                      <Text style={s.modelMeta}>
                        {m.request_count} REQ · {formatTokens(m.input_tokens + m.cache_read + m.cache_creation)} IN
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function shortModel(model: string): string {
  if (model.includes("opus-4-7")) return "OPUS 4.7";
  if (model.includes("opus-4-6")) return "OPUS 4.6";
  if (model.includes("opus-4-5")) return "OPUS 4.5";
  if (model.includes("sonnet-4-6")) return "SONNET 4.6";
  if (model.includes("sonnet-4-5")) return "SONNET 4.5";
  if (model.includes("haiku-4-5")) return "HAIKU 4.5";
  if (model.includes("haiku-3")) return "HAIKU 3";
  return model.toUpperCase();
}

const hoverCSS = Platform.OS === "web" ? ({ transition: "all 0.15s ease" } as any) : {};

const s = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: "#000",
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 2,
    padding: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
  },
  title: {
    flex: 1,
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 3,
  },
  rangeRow: {
    flexDirection: "row",
    gap: 4,
  },
  rangePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 2,
    ...hoverCSS,
  },
  rangePillActive: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  rangeText: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  rangeTextActive: {
    color: "#000",
  },
  subtitle: {
    marginTop: 6,
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  divider: {
    height: 1,
    backgroundColor: "#222",
    marginVertical: 12,
  },
  hint: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    paddingVertical: 8,
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 2,
    padding: 16,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  emptyHint: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
  },
  statsGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  statBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 2,
    padding: 10,
    backgroundColor: "#0a0a0a",
    gap: 4,
  },
  statLabel: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  statValue: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1,
  },
  savingsBox: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: "#22c55e",
    borderRadius: 2,
    padding: 10,
    backgroundColor: "#22c55e10",
    gap: 4,
  },
  savingsLabel: {
    color: "#22c55e",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  savingsValue: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "900",
  },
  savingsPct: {
    color: "#22c55e",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  sectionLabel: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },
  modelList: {
    gap: 6,
  },
  modelRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 2,
    padding: 10,
    backgroundColor: "#0a0a0a",
    gap: 10,
  },
  modelName: {
    flex: 1,
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  modelStats: {
    alignItems: "flex-end",
    gap: 2,
  },
  modelCost: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
  },
  modelMeta: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
