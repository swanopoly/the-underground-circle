/**
 * circleCostTelemetry — narrow helpers for the per-circle budget meters
 * shown in CircleSettingsScreen. Reads from `claude_api_usage` directly
 * (no RPC needed; the composite index added in RUN_THIS_SQL.sql §12
 * makes these queries cheap).
 *
 * Distinct from `claudeUsage.ts` — that one fetches aggregates for the
 * cost dashboard via RPCs. This one is a targeted read of "how close are
 * we to each circle's cap right now".
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface CircleCostTelemetry {
  /** Cost of the most recent Computer Use run (≤24h old). Null if none. */
  computerUseLastRunCost: number | null;
  /** When the most recent CU run completed. Null if none in the window. */
  computerUseLastRunAt: Date | null;
  /** Sum of automation-executor spend in the last rolling 24h. */
  automation24hCost: number;
  /** Sum of Computer Use spend in the last rolling 24h (across all runs). */
  computerUse24hCost: number;
  loading: boolean;
  /** Re-fetch. Hook auto-fetches on circle change, but callers can force
   *  after a known state change (e.g. a task completes in the same session). */
  refresh: () => Promise<void>;
}

const EMPTY: Omit<CircleCostTelemetry, 'refresh'> = {
  computerUseLastRunCost: null,
  computerUseLastRunAt: null,
  automation24hCost: 0,
  computerUse24hCost: 0,
  loading: false,
};

/**
 * Hook: loads the circle's recent Claude spend, scoped to the sources
 * that have budget caps. Re-runs on circle change. Narrow by design —
 * the settings screen just needs progress-bar numbers.
 */
export function useCircleCostTelemetry(circleId: string | null): CircleCostTelemetry {
  const [state, setState] = useState<Omit<CircleCostTelemetry, 'refresh'>>(EMPTY);

  const refresh = useCallback(async () => {
    if (!circleId) {
      setState(EMPTY);
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Parallel fetches — the index covers (circle_id, source, created_at)
      // so both scans are index-only.
      const [autoRes, cuRes, cuLastRes] = await Promise.all([
        supabase
          .from('claude_api_usage')
          .select('estimated_cost')
          .eq('circle_id', circleId)
          .eq('source', 'automation-executor')
          .gte('created_at', since),
        supabase
          .from('claude_api_usage')
          .select('estimated_cost')
          .eq('circle_id', circleId)
          .eq('source', 'computer-use-agent')
          .gte('created_at', since),
        // Most recent CU run — a single row, ordered by created_at.
        // `computer_use_runs` is the right source here (not claude_api_usage)
        // because CU runs consolidate per-run cost while the usage table
        // logs per-agent-turn. Either would work; runs is simpler.
        supabase
          .from('computer_use_runs')
          .select('estimated_cost, completed_at')
          .eq('circle_id', circleId)
          .eq('status', 'done')
          .order('completed_at', { ascending: false })
          .limit(1),
      ]);

      const auto24h = (autoRes.data || []).reduce(
        (s, r: any) => s + Number(r.estimated_cost || 0),
        0,
      );
      const cu24h = (cuRes.data || []).reduce(
        (s, r: any) => s + Number(r.estimated_cost || 0),
        0,
      );
      const lastRun = cuLastRes.data?.[0];

      setState({
        computerUseLastRunCost: lastRun ? Number(lastRun.estimated_cost || 0) : null,
        computerUseLastRunAt: lastRun?.completed_at ? new Date(lastRun.completed_at) : null,
        automation24hCost:     auto24h,
        computerUse24hCost:    cu24h,
        loading: false,
      });
    } catch {
      // Silent fail — the meter is a nice-to-have, not a blocker.
      setState((s) => ({ ...s, loading: false }));
    }
  }, [circleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

/** Format a USD amount for tight UI contexts. Kept here (not claudeUsage's
 *  formatCost) so the decimals always match the budget-cap display. */
export function formatBudgetUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Returns a color based on how close usage is to the cap.
 *  slate <75% · amber 75–95% · red ≥95%. Matches the style guide's
 *  accent-driven semantic colors. */
export function capUsageTone(used: number, cap: number): string {
  if (cap <= 0) return '#64748b';
  const pct = used / cap;
  if (pct >= 0.95) return '#ef4444';
  if (pct >= 0.75) return '#f59e0b';
  return '#64748b';
}

/**
 * Per-source spend row for the "AI SPEND LAST 24H" section. One row per
 * unique `source` string in `claude_api_usage`. Sorted cost-desc by the
 * fetcher so the UI can render directly.
 */
export interface SpendBySourceRow {
  source: string;
  cost: number;
  count: number;
  cacheReadTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface SpendBreakdown {
  totalCost: number;
  totalRequests: number;
  totalCacheReadTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Percentage of input-side tokens served from cache (0–100). */
  cacheHitPct: number;
  rows: SpendBySourceRow[];
  loading: boolean;
  refresh: () => Promise<void>;
}

const EMPTY_BREAKDOWN: Omit<SpendBreakdown, 'refresh'> = {
  totalCost: 0,
  totalRequests: 0,
  totalCacheReadTokens: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  cacheHitPct: 0,
  rows: [],
  loading: false,
};

/**
 * Hook: loads the full 24h Claude spend breakdown per source. Powers
 * the "AI SPEND LAST 24H" section in CircleSettingsScreen. One source
 * of truth across every agent (Computer Use, Automation, boss-agent,
 * swanbot-ai, etc) — anything that writes to `claude_api_usage`.
 */
export function useClaudeSpendBreakdown(circleId: string | null, hours = 24): SpendBreakdown {
  const [state, setState] = useState<Omit<SpendBreakdown, 'refresh'>>(EMPTY_BREAKDOWN);

  const refresh = useCallback(async () => {
    if (!circleId) {
      setState(EMPTY_BREAKDOWN);
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    try {
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      // One scan over the circle+time window. Aggregates in JS since
      // Supabase RPC for GROUP BY would need a new function — the index
      // makes this cheap for reasonable volumes (~k rows/circle/day).
      const { data, error } = await supabase
        .from('claude_api_usage')
        .select('source, estimated_cost, cache_read_tokens, input_tokens, output_tokens, cache_creation_tokens')
        .eq('circle_id', circleId)
        .gte('created_at', since);
      if (error || !data) { setState(EMPTY_BREAKDOWN); return; }

      // Fold into per-source buckets.
      const bySource = new Map<string, SpendBySourceRow>();
      let totalCost = 0;
      let totalRequests = 0;
      let totalCacheReadTokens = 0;
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCacheCreate = 0;
      for (const r of data as any[]) {
        const src = String(r.source || 'unknown');
        const cost = Number(r.estimated_cost || 0);
        const cacheRead = Number(r.cache_read_tokens || 0);
        const input = Number(r.input_tokens || 0);
        const output = Number(r.output_tokens || 0);
        const cacheCreate = Number(r.cache_creation_tokens || 0);
        const row = bySource.get(src) ?? {
          source: src, cost: 0, count: 0, cacheReadTokens: 0, inputTokens: 0, outputTokens: 0,
        };
        row.cost += cost;
        row.count += 1;
        row.cacheReadTokens += cacheRead;
        row.inputTokens += input;
        row.outputTokens += output;
        bySource.set(src, row);
        totalCost += cost;
        totalRequests += 1;
        totalCacheReadTokens += cacheRead;
        totalInputTokens += input;
        totalOutputTokens += output;
        totalCacheCreate += cacheCreate;
      }
      // Cache hit rate = cacheRead / (cacheRead + input + cacheCreate).
      const inputSide = totalCacheReadTokens + totalInputTokens + totalCacheCreate;
      const cacheHitPct = inputSide > 0 ? Math.round((totalCacheReadTokens / inputSide) * 100) : 0;

      const rows = [...bySource.values()].sort((a, b) => b.cost - a.cost);

      setState({
        totalCost,
        totalRequests,
        totalCacheReadTokens,
        totalInputTokens,
        totalOutputTokens,
        cacheHitPct,
        rows,
        loading: false,
      });
    } catch {
      setState((s) => ({ ...s, loading: false }));
    }
  }, [circleId, hours]);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, refresh };
}

/**
 * Friendly label for a `claude_api_usage.source` string. Keeps the
 * "AI SPEND" table readable even when the DB has raw function slugs.
 * Unknown sources fall through as-is.
 */
export function sourceLabel(src: string): string {
  switch (src) {
    case 'computer-use-agent':         return 'Computer Use';
    case 'automation-executor':        return 'Automations';
    case 'swanbot-ai':                 return 'BlackSwan (chat)';
    case 'chat-stream':                return 'Chat stream';
    case 'llm-proxy':                  return 'LLM proxy (BYO)';
    case 'room-task-executor':         return 'Room tasks';
    case 'build-stream':               return 'Page builder';
    case 'heartbeat-agent':            return 'Heartbeat';
    case 'boss-agent.generate_tasks':  return 'Boss (planner)';
    case 'boss-agent.model_council':   return 'Boss (council)';
    case 'boss-agent':                 return 'Boss';
    default:                           return src;
  }
}

/** Per-source accent for the stacked spend bar. */
export function sourceAccent(src: string): string {
  if (src.startsWith('computer-use'))  return '#22d3ee'; // cyan
  if (src.startsWith('automation'))    return '#f59e0b'; // amber
  if (src.startsWith('swanbot'))       return '#a855f7'; // purple
  if (src.startsWith('chat-stream'))   return '#38bdf8'; // sky
  if (src.startsWith('llm-proxy'))     return '#94a3b8'; // slate
  if (src.startsWith('room-task'))     return '#22c55e'; // green
  if (src.startsWith('build-stream'))  return '#ec4899'; // pink
  if (src.startsWith('heartbeat'))     return '#fbbf24'; // gold
  if (src.startsWith('boss-agent'))    return '#8b5cf6'; // violet
  return '#64748b'; // fallback slate
}

/** "AGO" formatter tuned for the budget meter. */
export function relativeSince(d: Date | null): string {
  if (!d) return '';
  const ms = Date.now() - d.getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60)        return `${s}s ago`;
  if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
