/**
 * computerTaskScheduleModel — pure owner for recurring computer-task
 * watches (Phase 6a of `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * A "watch" is a standing read-only computer task ("check flight prices
 * every day, tell me when something changes") stored in
 * `computer_use_schedules` (migration `20260701_computer_use_schedules.sql`;
 * `ComputerTaskScheduleRow` mirrors that table 1:1 — keep them in
 * lockstep). This module owns everything about a watch that is not I/O:
 * cadence math, the due-check the runner ticks against, watch-task
 * validation, and the chat-facing created/update message formats. The
 * runner executes due watches through the normal computer-use pipeline
 * and reuses `computerRunDiff` for `changes_only` reporting — this module
 * never runs anything.
 *
 * Watches are monitoring-only by contract: the caller runs the router's
 * approval-floor detector over the task text and passes any detected
 * categories into `validateWatchTask`, which rejects them. The model
 * stays pure by taking the detector's result as input instead of
 * importing it (no imports, no Supabase/React Native, clock passed in) —
 * smoke-testable via tsx
 * (`npx tsx scripts/computer-task-schedule-model-smoketest.ts`).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type ComputerTaskScheduleCadence = 'hourly' | 'daily' | 'weekly';

/** `changes_only` posts an update only when the findings diff is non-empty. */
export type ComputerTaskScheduleNotifyOn = 'always' | 'changes_only';

/** 1:1 mirror of a `computer_use_schedules` row. */
export interface ComputerTaskScheduleRow {
  id: string;
  circle_id: string;
  created_by: string;
  task: string;
  cadence: ComputerTaskScheduleCadence;
  notify_on: ComputerTaskScheduleNotifyOn;
  /** Chat thread the watch reports into; null = the circle's main chat. */
  thread_id: string | null;
  active: boolean;
  last_run_at: string | null;
  /** Structured findings from the last run, kept so `computerRunDiff` can compare. */
  last_findings: unknown[] | null;
  last_diff_summary: string | null;
  next_run_at: string;
  created_at: string;
  updated_at: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Per-circle cap on active watches so the runner's queue stays bounded. */
export const MAX_ACTIVE_WATCHES = 10;

/** Stored watch tasks are clamped to this many characters. */
export const WATCH_TASK_MAX_CHARS = 500;

const CADENCE_INTERVAL_MS: Record<ComputerTaskScheduleCadence, number> = {
  hourly: 3_600_000,
  daily: 86_400_000,
  weekly: 604_800_000,
};

const CADENCE_PHRASE: Record<ComputerTaskScheduleCadence, string> = {
  hourly: 'every hour',
  daily: 'every day',
  weekly: 'every week',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampText(value: string, max: number): string {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

// ─── Cadence math ───────────────────────────────────────────────────────────

/** Milliseconds between runs for a cadence. */
export function cadenceIntervalMs(cadence: ComputerTaskScheduleCadence): number {
  return CADENCE_INTERVAL_MS[cadence];
}

/** ISO timestamp exactly one cadence interval after `fromMs` (epoch ms). */
export function computeNextRunAtIso(cadence: ComputerTaskScheduleCadence, fromMs: number): string {
  return new Date(fromMs + cadenceIntervalMs(cadence)).toISOString();
}

/**
 * True when the runner should execute this watch now: active and
 * `next_run_at` has passed. Unparseable timestamps fail closed (never
 * due) instead of firing on every tick.
 */
export function isScheduleDue(
  s: Pick<ComputerTaskScheduleRow, 'active' | 'next_run_at'>,
  nowMs: number,
): boolean {
  if (!s.active) return false;
  const dueAt = Date.parse(String(s.next_run_at || ''));
  if (!Number.isFinite(dueAt)) return false;
  return dueAt <= nowMs;
}

// ─── Watch-task validation ──────────────────────────────────────────────────

/**
 * Normalize + validate the task text for a new watch: trims, collapses
 * whitespace, rejects empty, clamps to `WATCH_TASK_MAX_CHARS`. Watches
 * are read-only monitoring, so callers detect approval-floor categories
 * (the router's floor detector) on the text and pass the result in via
 * `opts.floorCategories`; any hit rejects the watch outright.
 */
export function validateWatchTask(
  task: string,
  opts: { floorCategories: string[] },
): { ok: true; task: string } | { ok: false; error: string } {
  const normalized = String(task || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return {
      ok: false,
      error: 'A watch needs a task to check — try "watch <site or thing> for <what to look for>".',
    };
  }
  const categories = (opts.floorCategories || []).filter(Boolean);
  if (categories.length > 0) {
    return {
      ok: false,
      error:
        `Watches are read-only monitoring and can't include ${categories.join(', ')} actions. `
        + 'Rephrase it as something to check, or run it once as a normal computer task with approval.',
    };
  }
  return { ok: true, task: clampText(normalized, WATCH_TASK_MAX_CHARS) };
}

// ─── Chat-facing messages ───────────────────────────────────────────────────

/** 'every hour' | 'every day' | 'every week'. */
export function describeWatchCadence(cadence: ComputerTaskScheduleCadence): string {
  return CADENCE_PHRASE[cadence];
}

/** Confirmation posted to chat right after a watch is created. */
export function formatWatchCreatedMessage(input: {
  task: string;
  cadence: ComputerTaskScheduleCadence;
  notifyOn: ComputerTaskScheduleNotifyOn;
}): string {
  const reporting = input.notifyOn === 'always'
    ? "I'll report after every check."
    : "I'll report only when something changes.";
  return `🔁 Watching: "${clampText(input.task, 120)}" — ${describeWatchCadence(input.cadence)}. ${reporting} Manage watches in Office.`;
}

/**
 * Update posted to the watch's thread after a scheduled check. Body
 * priority: error → diff summary → plain run summary; each part is
 * clamped and the whole message stays ≤ 800 chars so persisted chat rows
 * stay bounded.
 */
export function formatWatchUpdateMessage(input: {
  task: string;
  diffSummary: string | null;
  runSummary: string | null;
  errorMessage?: string | null;
}): string {
  const header = `🔁 Watch update — "${clampText(input.task, 80)}"`;
  const error = String(input.errorMessage || '').trim();
  const diff = String(input.diffSummary || '').trim();
  const run = String(input.runSummary || '').trim();
  let body: string;
  if (error) {
    body = `Check failed: ${clampText(error, 200)}`;
  } else if (diff) {
    body = clampText(diff, 400);
  } else if (run) {
    body = clampText(run, 400);
  } else {
    body = 'Check completed — nothing was reported.';
  }
  return `${header}\n${body}`.slice(0, 800);
}
