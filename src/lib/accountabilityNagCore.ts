// accountabilityNagCore — the PURE "needs attention" brain for the Feed tab.
// It turns the circle's task/mission rows into a small, ranked, deduplicated
// list of things that are actively rotting: breached mission deadlines, overdue
// tasks, blocked tasks, stalled in-progress tasks (no agent run for N days),
// and tasks due soon.
//
// It COMPOSES the two existing pure brains instead of re-deriving them:
//   - `evaluateSla` (deadlineSlaCore) decides ok / due_soon / overdue / breached
//     for every due date — the SLA verdict IS the item kind.
//   - `scoreTask` (taskPriorityScoreCore) supplies the within-band priority so
//     two equally-late tasks sort by the same score the mission board uses.
//
// PURITY: only pure-core imports, tsx-loadable (smoke: accountability-nag-core).
// The caller supplies `nowMs`; nothing here reads the clock or does I/O, and
// `buildNeedsAttention` NEVER throws — malformed rows are skipped or degraded.

import { evaluateSla, type SlaLevel } from './deadlineSlaCore';
import { scoreTask } from './taskPriorityScoreCore';

// ── Public contract ───────────────────────────────────────────────────────────

export type NeedsAttentionKind =
  | 'task_overdue'
  | 'task_due_soon'
  | 'mission_breached'
  | 'task_stalled'
  | 'task_blocked';

export interface NeedsAttentionAction {
  /** Short button label, e.g. "Unblock". */
  label: string;
  /** Optional chat-seed sentence the UI can prefill into the composer. */
  seedCommand?: string;
}

export interface NeedsAttentionItem {
  /** Stable unique key: `${kind}:${task|mission id}`. */
  key: string;
  kind: NeedsAttentionKind;
  title: string;
  /** Human sentence including the age, e.g. "overdue by 3d". */
  reason: string;
  /** Higher = nags harder. Kind bands never overlap (see KIND_BASE). */
  urgencyScore: number;
  taskId?: string;
  missionId?: string;
  suggestedAction: NeedsAttentionAction;
}

/** Mirrors the KanbanTask row fields FeedTab already has in scope — a
 *  `KanbanTask` can be passed as-is (structural subset, all optional). */
export interface NagTaskInput {
  id: string;
  title?: string | null;
  /** KanbanTask.status: 'backlog'|'todo'|'in_progress'|...|'done'. */
  status?: string | null;
  /** 'YYYY-MM-DD' (interpreted end-of-day, like FeedTab) or full ISO. */
  due_date?: string | null;
  /** KanbanTask.priority: 'low'|'normal'|'high'|'urgent'. */
  priority?: string | null;
  assigned_to?: string | null;
  created_at?: string | null;
  last_agent_run_at?: string | null;
  /** 'blocked' → surfaces as task_blocked. */
  last_agent_run_status?: string | null;
}

/** Mirrors the Mission rows FeedTab already has (`useMissions`). */
export interface NagMissionInput {
  id: string;
  title?: string | null;
  /** Only 'active' missions are evaluated. */
  status?: string | null;
  /** ISO deadline or null. */
  deadline?: string | null;
}

export interface NeedsAttentionInput {
  nowMs: number;
  tasks?: NagTaskInput[] | null;
  missions?: NagMissionInput[] | null;
  /** taskId → epoch ms of last run (overrides last_agent_run_at when present). */
  recentRunsByTaskId?: Record<string, number> | null;
  /** In-progress with no run newer than this many days = stalled. Default 4. */
  stalledAfterDays?: number;
  /** Max items returned. Default 8. */
  maxItems?: number;
  /** Lead window for "due soon", ms. Default 24h (day-granularity due dates). */
  dueSoonMs?: number;
}

// ── Tunables ──────────────────────────────────────────────────────────────────

export const DEFAULT_STALLED_AFTER_DAYS = 4;
export const DEFAULT_MAX_ITEMS = 8;
/** Task due dates are day-granularity, so "due soon" leads by a full day. */
export const DEFAULT_TASK_DUE_SOON_MS = 24 * 3_600_000;

/**
 * Non-overlapping urgency bands per kind. Within-band bonuses (priority score
 * 0..100 + age bonus 0..60) stay under the 200-wide gap, so a lower band can
 * never outrank a higher one: breached > overdue > blocked > stalled > due_soon.
 */
export const KIND_BASE: Record<NeedsAttentionKind, number> = {
  mission_breached: 1000,
  task_overdue: 800,
  task_blocked: 600,
  task_stalled: 400,
  task_due_soon: 200,
};

const DAY_MS = 86_400_000;

// ── Guards / small helpers ────────────────────────────────────────────────────

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function cleanId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function cleanTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Bounded title fragment for seedCommand sentences. */
function seedTitle(title: string): string {
  const t = title.length > 60 ? `${title.slice(0, 57)}...` : title;
  return t.replace(/"/g, "'");
}

/** Parse a due value the way FeedTab does: bare YYYY-MM-DD → end of that day. */
function parseDueMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? Date.parse(`${raw}T23:59:59`)
    : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Coarse day/hour age phrase: "3d", "5h", "<1h". */
export function formatAgeShort(ms: number): string {
  const m = Math.max(0, finiteOr(ms, 0));
  const days = Math.floor(m / DAY_MS);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(m / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  return '<1h';
}

/** Age bonus within a band: 0..60, saturating at 30 days late/stalled. */
function ageBonus(ms: number): number {
  const days = Math.max(0, finiteOr(ms, 0)) / DAY_MS;
  return Math.min(days, 30) * 2;
}

function priorityToImportance(priority: unknown): 'low' | 'medium' | 'high' | undefined {
  if (priority === 'urgent' || priority === 'high') return 'high';
  if (priority === 'normal' || priority === 'medium') return 'medium';
  if (priority === 'low') return 'low';
  return undefined;
}

const TERMINAL_TASK_STATUSES = new Set(['done', 'completed', 'cancelled', 'canceled', 'approved']);

/** Map a task's SLA verdict onto a nag kind (composition, not re-derivation). */
export function slaLevelToTaskKind(level: SlaLevel): NeedsAttentionKind | null {
  if (level === 'overdue' || level === 'breached') return 'task_overdue';
  if (level === 'due_soon') return 'task_due_soon';
  return null;
}

// ── Suggested actions ─────────────────────────────────────────────────────────

function actionFor(kind: NeedsAttentionKind, title: string): NeedsAttentionAction {
  const t = seedTitle(title);
  switch (kind) {
    case 'mission_breached':
      return { label: 'Review mission', seedCommand: `Review the breached mission "${t}" and propose a recovery plan` };
    case 'task_overdue':
      return { label: 'Reschedule or finish', seedCommand: `The task "${t}" is overdue — finish it or set a realistic new due date` };
    case 'task_blocked':
      return { label: 'Unblock', seedCommand: `The task "${t}" is blocked — identify the blocker and unblock it` };
    case 'task_stalled':
      return { label: 'Kick off a run', seedCommand: `The task "${t}" has stalled — run it or report what is preventing progress` };
    case 'task_due_soon':
      return { label: 'Start now', seedCommand: `The task "${t}" is due soon — start it now` };
  }
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Build the ranked "needs attention" list. Deterministic in `nowMs`, bounded to
 * `maxItems`, one item per task/mission (highest-severity kind wins), stable
 * ordering (urgencyScore desc, then key asc). NEVER throws — a malformed input
 * object or garbage rows yield [] or partial results, never an exception.
 */
export function buildNeedsAttention(inputRaw: NeedsAttentionInput): NeedsAttentionItem[] {
  const input = (inputRaw ?? {}) as NeedsAttentionInput;
  const now = finiteOr(input.nowMs, NaN);
  if (!Number.isFinite(now)) return [];

  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const missions = Array.isArray(input.missions) ? input.missions : [];
  const runsByTask =
    input.recentRunsByTaskId && typeof input.recentRunsByTaskId === 'object'
      ? input.recentRunsByTaskId
      : {};
  const stalledAfterMs =
    Math.max(0, finiteOr(input.stalledAfterDays, DEFAULT_STALLED_AFTER_DAYS)) * DAY_MS;
  const maxItems = Math.max(1, Math.floor(finiteOr(input.maxItems, DEFAULT_MAX_ITEMS)));
  const dueSoonMs = Math.max(0, finiteOr(input.dueSoonMs, DEFAULT_TASK_DUE_SOON_MS));

  // Dedup map: one entry per subject ("task:<id>" / "mission:<id>"), keeping
  // the highest-urgency item for that subject.
  const bySubject = new Map<string, NeedsAttentionItem>();
  const propose = (subject: string, item: NeedsAttentionItem) => {
    const existing = bySubject.get(subject);
    if (!existing || item.urgencyScore > existing.urgencyScore) bySubject.set(subject, item);
  };

  // ── Missions: breached deadlines ────────────────────────────────────────────
  for (const raw of missions) {
    const m = (raw ?? {}) as NagMissionInput;
    const id = cleanId(m.id);
    if (!id) continue;
    if (m.status !== 'active') continue;
    const dueAt = parseDueMs(m.deadline);
    if (dueAt === null) continue;

    const sla = evaluateSla({ dueAt, now, dueSoonMs });
    if (sla.level !== 'overdue' && sla.level !== 'breached') continue;

    const title = cleanTitle(m.title, 'Untitled mission');
    const kind: NeedsAttentionKind = 'mission_breached';
    propose(`mission:${id}`, {
      key: `${kind}:${id}`,
      kind,
      title,
      reason: `mission deadline breached — overdue by ${formatAgeShort(sla.msOverdue)}`,
      urgencyScore: KIND_BASE[kind] + ageBonus(sla.msOverdue),
      missionId: id,
      suggestedAction: actionFor(kind, title),
    });
  }

  // ── Tasks ───────────────────────────────────────────────────────────────────
  for (const raw of tasks) {
    const t = (raw ?? {}) as NagTaskInput;
    const id = cleanId(t.id);
    if (!id) continue;
    const status = typeof t.status === 'string' ? t.status.trim().toLowerCase() : '';
    if (TERMINAL_TASK_STATUSES.has(status)) continue;

    const title = cleanTitle(t.title, 'Untitled task');
    const dueAt = parseDueMs(t.due_date);
    const createdAt = parseTimestampMs(t.created_at);

    // Shared within-band priority (0..100) from the real scoring brain.
    const priority = scoreTask(
      {
        id,
        dueAt: dueAt ?? undefined,
        createdAt: createdAt ?? undefined,
        importance: priorityToImportance(t.priority),
        status,
      },
      now,
    ).score;
    // Scaled to 0..100 → contributes at most half the 200-wide band gap.
    const priorityBonus = Math.min(100, Math.max(0, priority));

    // 1) Due-date verdict via the real SLA brain (composition point).
    if (dueAt !== null) {
      const sla = evaluateSla({ dueAt, now, dueSoonMs });
      const kind = slaLevelToTaskKind(sla.level);
      if (kind === 'task_overdue') {
        propose(`task:${id}`, {
          key: `${kind}:${id}`,
          kind,
          title,
          reason: `overdue by ${formatAgeShort(sla.msOverdue)}`,
          urgencyScore: KIND_BASE[kind] + ageBonus(sla.msOverdue) + priorityBonus / 2,
          taskId: id,
          suggestedAction: actionFor(kind, title),
        });
      } else if (kind === 'task_due_soon') {
        propose(`task:${id}`, {
          key: `${kind}:${id}`,
          kind,
          title,
          reason: sla.msRemaining === 0 ? 'due now' : `due in ${formatAgeShort(sla.msRemaining)}`,
          urgencyScore: KIND_BASE[kind] + priorityBonus,
          taskId: id,
          suggestedAction: actionFor(kind, title),
        });
      }
    }

    // 2) Blocked: last agent run ended blocked.
    if (typeof t.last_agent_run_status === 'string' && t.last_agent_run_status.trim().toLowerCase() === 'blocked') {
      const lastRun = finiteOr(runsByTask[id], NaN);
      const lastRunMs = Number.isFinite(lastRun) ? lastRun : parseTimestampMs(t.last_agent_run_at);
      const sinceMs = lastRunMs !== null && lastRunMs <= now ? now - lastRunMs : null;
      const kind: NeedsAttentionKind = 'task_blocked';
      propose(`task:${id}`, {
        key: `${kind}:${id}`,
        kind,
        title,
        reason:
          sinceMs !== null
            ? `blocked — last agent run hit a blocker ${formatAgeShort(sinceMs)} ago`
            : 'blocked — last agent run hit a blocker',
        urgencyScore: KIND_BASE[kind] + ageBonus(sinceMs ?? 0) + priorityBonus / 2,
        taskId: id,
        suggestedAction: actionFor(kind, title),
      });
    }

    // 3) Stalled: in progress with no run ever, or last run older than N days.
    if (status === 'in_progress') {
      const override = finiteOr(runsByTask[id], NaN);
      const lastRunMs = Number.isFinite(override) ? override : parseTimestampMs(t.last_agent_run_at);
      const neverRan = lastRunMs === null;
      const sinceMs = lastRunMs !== null ? Math.max(0, now - lastRunMs) : null;
      const stale = neverRan || (sinceMs !== null && sinceMs > stalledAfterMs);
      if (stale) {
        const kind: NeedsAttentionKind = 'task_stalled';
        propose(`task:${id}`, {
          key: `${kind}:${id}`,
          kind,
          title,
          reason: neverRan
            ? 'in progress but no agent run yet'
            : `in progress but no agent run for ${formatAgeShort(sinceMs as number)}`,
          urgencyScore: KIND_BASE[kind] + ageBonus(sinceMs ?? stalledAfterMs) + priorityBonus / 2,
          taskId: id,
          suggestedAction: actionFor(kind, title),
        });
      }
    }
  }

  // Stable deterministic ordering: urgency desc, then key asc.
  const items = Array.from(bySubject.values()).sort((a, b) => {
    if (b.urgencyScore !== a.urgencyScore) return b.urgencyScore - a.urgencyScore;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return items.slice(0, maxItems);
}
