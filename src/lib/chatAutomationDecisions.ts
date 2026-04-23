/**
 * chatAutomationDecisions — read helpers for the chat-planner telemetry
 * stamped onto `agent_runs.metadata.chatAutomationDecision` by
 * `attachPlanDecisionToRun` (see `runChatAutomationPlan.ts`).
 *
 * Phase CA-6 of `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`. Whoever
 * builds the Run Ledger / Chat Routing dashboard consumes these.
 *
 * The decision blob is the compact `summarisePlanForTelemetry` output,
 * plus the dispatcher's outcome status/duration/approval id. Everything
 * else — prompts, tool calls, artifacts — stays in their usual columns.
 */

import { supabase } from './supabase';

export type ChatAutomationDecisionRow = {
  runId: string;
  circleId: string;
  userId: string;
  surface: string;
  mode: string | null;
  title: string;
  startedAt: string | null;
  completedAt: string | null;
  status: string;
  /** The planner's compact record (source / intentKind / executionKind / etc). */
  decision: Record<string, unknown> | null;
  /** The dispatcher's outcome status ("completed" | "failed" | …). */
  outcomeStatus: string | null;
  outcomeDurationMs: number | null;
  approvalId: string | null;
};

export type LoadDecisionsOptions = {
  /** Max rows. Default 30, max 200. */
  limit?: number;
  /** Only runs whose planner source matches (e.g. 'slash', 'conversational_intent'). */
  source?: string;
  /** Only runs whose executionKind matches (e.g. 'run_openswan'). */
  executionKind?: string;
  /** Only runs started after this ISO timestamp. */
  since?: string;
};

/**
 * Load recent runs (for a circle) whose metadata carries a
 * `chatAutomationDecision`. Rows without a decision are filtered out
 * client-side; `agent_runs.metadata` is a jsonb so we can't filter on
 * nested keys cheaply without a computed column.
 */
export async function loadChatAutomationDecisions(
  circleId: string,
  opts: LoadDecisionsOptions = {},
): Promise<ChatAutomationDecisionRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);

  let query = supabase
    .from('agent_runs')
    .select('id, circle_id, user_id, surface, mode, title, started_at, completed_at, status, metadata')
    .eq('circle_id', circleId)
    .order('started_at', { ascending: false })
    // Pull a larger pool than `limit` so the post-filter still has enough
    // rows with decisions in it. 5x is a reasonable buffer for circles
    // where not every run came through the planner yet.
    .limit(limit * 5);

  if (opts.since) query = query.gte('started_at', opts.since);

  const { data, error } = await query;
  if (error) {
    console.warn('[chatAutomationDecisions] load failed:', error.message);
    return [];
  }

  const rows: ChatAutomationDecisionRow[] = [];
  for (const r of (data || []) as Array<{
    id: string;
    circle_id: string;
    user_id: string;
    surface: string;
    mode: string | null;
    title: string;
    started_at: string | null;
    completed_at: string | null;
    status: string;
    metadata: Record<string, unknown> | null;
  }>) {
    const meta = (r.metadata || {}) as Record<string, unknown>;
    const decision = (meta.chatAutomationDecision || null) as Record<string, unknown> | null;
    if (!decision) continue;

    if (opts.source && decision.source !== opts.source) continue;
    if (opts.executionKind && decision.executionKind !== opts.executionKind) continue;

    rows.push({
      runId: r.id,
      circleId: r.circle_id,
      userId: r.user_id,
      surface: r.surface,
      mode: r.mode,
      title: r.title,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      status: r.status,
      decision,
      outcomeStatus: (decision.outcomeStatus as string | null) ?? null,
      outcomeDurationMs: (decision.outcomeDurationMs as number | null) ?? null,
      approvalId: (decision.approvalId as string | null) ?? null,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * Aggregate counts per `executionKind` over the returned window. Feeds
 * the Run Ledger "routing breakdown" widget — answers "what's chat
 * actually doing, split by transport?"
 */
export type ChatAutomationBreakdown = {
  totalRuns: number;
  totalWithDecision: number;
  byExecutionKind: Record<string, number>;
  bySource: Record<string, number>;
  byOutcome: Record<string, number>;
  medianDurationMs: number | null;
};

export async function loadChatAutomationBreakdown(
  circleId: string,
  opts: Omit<LoadDecisionsOptions, 'executionKind' | 'source'> & { windowHours?: number } = {},
): Promise<ChatAutomationBreakdown> {
  const since = opts.since
    ? opts.since
    : new Date(Date.now() - (opts.windowHours ?? 24 * 7) * 3_600_000).toISOString();

  // Count every recent run so we can show how many bypassed the planner.
  const [{ count: totalRuns }, decisions] = await Promise.all([
    supabase
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .gte('started_at', since),
    loadChatAutomationDecisions(circleId, { since, limit: 200 }),
  ]);

  const byExecutionKind: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const durations: number[] = [];

  for (const row of decisions) {
    const kind = String(row.decision?.executionKind ?? 'unknown');
    const source = String(row.decision?.source ?? 'unknown');
    const outcome = String(row.outcomeStatus ?? 'unknown');
    byExecutionKind[kind] = (byExecutionKind[kind] || 0) + 1;
    bySource[source]      = (bySource[source] || 0) + 1;
    byOutcome[outcome]    = (byOutcome[outcome] || 0) + 1;
    if (typeof row.outcomeDurationMs === 'number' && row.outcomeDurationMs >= 0) {
      durations.push(row.outcomeDurationMs);
    }
  }

  durations.sort((a, b) => a - b);
  const medianDurationMs = durations.length > 0
    ? durations[Math.floor(durations.length / 2)]
    : null;

  return {
    totalRuns: totalRuns ?? 0,
    totalWithDecision: decisions.length,
    byExecutionKind,
    bySource,
    byOutcome,
    medianDurationMs,
  };
}
