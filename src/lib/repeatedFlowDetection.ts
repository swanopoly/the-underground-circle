/**
 * repeatedFlowDetection — Phase CA-5a of `CHAT_AUTOMATION_AUDIT_PLAN`.
 *
 * Scans recent `chatAutomationDecision` rows (from
 * `loadChatAutomationDecisions`) and flags patterns that a user runs
 * often enough to deserve a "save as automation" suggestion chip.
 *
 * Pure, deterministic, no DB calls here — the caller fetches the rows
 * and feeds them in. That makes this easy to test against synthetic
 * fixtures and easy to compose with any future ranking / LLM layer.
 *
 * Heuristics in this first version:
 *   1. **Frequency** — same `(executionKind, routeId, commandFingerprint)`
 *      triggered ≥ `minOccurrences` times (default 3) within the window.
 *   2. **Rhythm** — intervals between occurrences are regular enough
 *      (coefficient of variation < `regularityCvThreshold`) to suggest a
 *      real cadence rather than noise.
 *   3. **Success** — majority of occurrences ended in
 *      `outcomeStatus === 'completed'` so we don't suggest saving broken
 *      flows.
 *
 * Output shape is UI-ready: each `RepeatedFlowSuggestion` can be
 * rendered as a chip ("You've done this 5× this week — save as
 * automation?") with a click handler that opens the `/automation
 * create` flow pre-filled with the detected command text.
 */

import type { ChatAutomationDecisionRow } from './chatAutomationDecisions';

export type RepeatedFlowOptions = {
  /** Minimum occurrences of the same fingerprint to flag. Default 3. */
  minOccurrences?: number;
  /** Maximum coefficient of variation on interval gaps. Default 0.75. */
  regularityCvThreshold?: number;
  /** Minimum ratio of successful outcomes (0-1). Default 0.6. */
  minSuccessRatio?: number;
  /** Cap on how many suggestions to return. Default 10. */
  maxSuggestions?: number;
};

export type RepeatedFlowSuggestion = {
  /** Stable identifier for the pattern — safe to use as React key. */
  fingerprint: string;
  /** Kind of work this represents. */
  executionKind: string;
  /** Route involved, if any. */
  routeId: string | null;
  /** Lowercased, trimmed command text. Empty when the pattern is modal-only. */
  commandFingerprint: string;
  /** How many matching decisions were found. */
  occurrences: number;
  /** How many of those succeeded. */
  completedCount: number;
  /** successCount / occurrences. */
  successRatio: number;
  /** First + last timestamps in the window. */
  firstAt: string;
  lastAt: string;
  /** Coefficient of variation (stdev / mean) of interval gaps. Null if <2 intervals. */
  intervalCv: number | null;
  /** Best-guess cadence tag based on median interval. */
  cadence: 'under_hour' | 'hourly' | 'daily' | 'multi_day' | 'irregular';
  /** Score — higher = stronger suggestion. Useful for ranking. */
  score: number;
  /** runIds of the matched rows (for deep-link into run ledger). */
  exampleRunIds: string[];
};

export function detectRepeatedFlows(
  rows: ChatAutomationDecisionRow[],
  opts: RepeatedFlowOptions = {},
): RepeatedFlowSuggestion[] {
  const minOccurrences       = Math.max(2, opts.minOccurrences ?? 3);
  const regularityCvThreshold = opts.regularityCvThreshold ?? 0.75;
  const minSuccessRatio      = Math.min(1, Math.max(0, opts.minSuccessRatio ?? 0.6));
  const maxSuggestions       = Math.max(1, opts.maxSuggestions ?? 10);

  const groups = new Map<string, ChatAutomationDecisionRow[]>();
  for (const row of rows) {
    const kind   = String(row.decision?.executionKind ?? 'unknown');
    // Skip routing outcomes that are unlikely to be worth saving. Pure
    // small-talk / local replies clog the suggestion list.
    if (kind === 'local_reply' || kind === 'skipped' || kind === 'deferred') continue;

    const route   = row.decision?.routeId ? String(row.decision.routeId) : '';
    const command = extractCommandFingerprint(row);
    const key = `${kind}|${route}|${command}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  }

  const suggestions: RepeatedFlowSuggestion[] = [];
  for (const [key, matching] of groups) {
    if (matching.length < minOccurrences) continue;

    // Chronological order for interval math.
    const sorted = [...matching].sort((a, b) => tsOf(a) - tsOf(b));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(tsOf(sorted[i]) - tsOf(sorted[i - 1]));
    }
    const intervalCv = intervals.length >= 2 ? cvOf(intervals) : null;
    const medianIntervalMs = intervals.length > 0 ? medianOf(intervals) : 0;

    const completedCount = sorted.filter((r) => (r.outcomeStatus ?? '') === 'completed').length;
    const successRatio = sorted.length > 0 ? completedCount / sorted.length : 0;
    if (successRatio < minSuccessRatio) continue;

    // Cadence classification. We bias slightly — a noisy cadence (high CV)
    // is still useful, but we tag it 'irregular' so the UI can frame it
    // differently ("You ran this X times — want to schedule it?").
    const cadence = classifyCadence(medianIntervalMs, intervalCv, regularityCvThreshold);

    const [kind, route, command] = key.split('|');
    const first = sorted[0];
    const last  = sorted[sorted.length - 1];

    suggestions.push({
      fingerprint: key,
      executionKind: kind,
      routeId: route || null,
      commandFingerprint: command,
      occurrences: sorted.length,
      completedCount,
      successRatio,
      firstAt: first.startedAt ?? first.completedAt ?? new Date(tsOf(first)).toISOString(),
      lastAt:  last.startedAt  ?? last.completedAt  ?? new Date(tsOf(last)).toISOString(),
      intervalCv,
      cadence,
      score: scoreSuggestion({
        occurrences: sorted.length,
        successRatio,
        intervalCv,
        cadence,
      }),
      exampleRunIds: sorted.slice(0, 5).map((r) => r.runId),
    });
  }

  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSuggestions);
}

// ─── Internals ──────────────────────────────────────────────────────────────

function tsOf(row: ChatAutomationDecisionRow): number {
  const iso = row.startedAt || row.completedAt;
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function extractCommandFingerprint(row: ChatAutomationDecisionRow): string {
  const decision = row.decision || {};
  const command = (decision as any).commandText ?? '';
  if (typeof command !== 'string') return '';
  return command.toLowerCase().trim().slice(0, 200);
}

function cvOf(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function classifyCadence(
  medianMs: number,
  cv: number | null,
  cvThreshold: number,
): RepeatedFlowSuggestion['cadence'] {
  if (cv !== null && cv > cvThreshold) return 'irregular';
  if (medianMs <= 0) return 'irregular';
  const hour = 3_600_000;
  const day  = 24 * hour;
  if (medianMs < hour) return 'under_hour';
  if (medianMs < 3 * hour) return 'hourly';
  if (medianMs < 2 * day) return 'daily';
  return 'multi_day';
}

function scoreSuggestion(input: {
  occurrences: number;
  successRatio: number;
  intervalCv: number | null;
  cadence: RepeatedFlowSuggestion['cadence'];
}): number {
  let score = 0;
  score += Math.min(input.occurrences, 20) * 2; // up to 40
  score += input.successRatio * 20;              // up to 20
  if (input.cadence !== 'irregular' && input.cadence !== 'under_hour') score += 15;
  if (input.cadence === 'daily') score += 5;
  if (input.intervalCv !== null && input.intervalCv < 0.35) score += 10;
  return Math.round(score * 10) / 10;
}
