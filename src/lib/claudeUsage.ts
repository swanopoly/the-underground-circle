/**
 * claudeUsage — frontend helpers for reading the claude_api_usage log.
 * Aggregates emitted by edge functions (swanbot-ai, automation-executor,
 * etc.) so the UI can surface spend + cache hit rate.
 */

import { supabase } from "./supabase";

export interface ClaudeUsageSummary {
  total_cost: number;
  total_input: number;
  total_output: number;
  total_cache_creation: number;
  total_cache_read: number;
  request_count: number;
  cache_hit_rate: number;
}

export interface ClaudeUsageByModel {
  model: string;
  request_count: number;
  total_cost: number;
  cache_read: number;
  cache_creation: number;
  input_tokens: number;
  output_tokens: number;
}

const EMPTY_SUMMARY: ClaudeUsageSummary = {
  total_cost: 0,
  total_input: 0,
  total_output: 0,
  total_cache_creation: 0,
  total_cache_read: 0,
  request_count: 0,
  cache_hit_rate: 0,
};

function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

export async function getClaudeUsageSummary(
  circleId: string | null,
  days: number = 7,
): Promise<ClaudeUsageSummary> {
  const { data, error } = await supabase.rpc("get_claude_usage_summary", {
    p_circle_id: circleId,
    p_days: days,
  });
  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    return { ...EMPTY_SUMMARY };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_cost:           toNum(row.total_cost),
    total_input:          toNum(row.total_input),
    total_output:         toNum(row.total_output),
    total_cache_creation: toNum(row.total_cache_creation),
    total_cache_read:     toNum(row.total_cache_read),
    request_count:        toNum(row.request_count),
    cache_hit_rate:       toNum(row.cache_hit_rate),
  };
}

export async function getClaudeUsageByModel(
  circleId: string | null,
  days: number = 7,
): Promise<ClaudeUsageByModel[]> {
  const { data, error } = await supabase.rpc("get_claude_usage_by_model", {
    p_circle_id: circleId,
    p_days: days,
  });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    model:          r.model ?? "unknown",
    request_count:  toNum(r.request_count),
    total_cost:     toNum(r.total_cost),
    cache_read:     toNum(r.cache_read),
    cache_creation: toNum(r.cache_creation),
    input_tokens:   toNum(r.input_tokens),
    output_tokens:  toNum(r.output_tokens),
  }));
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export function formatCost(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
