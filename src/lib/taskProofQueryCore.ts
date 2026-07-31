/**
 * taskProofQueryCore — pure task ↔ proof-of-work back-link filtering.
 *
 * proof_of_work rows carry their task linkage only INSIDE the `detail` JSONB
 * (`detail.task_id`, written by useKanbanData's proof publish via
 * agentRunProofPublisherCore.buildRunProofPublication — `proofRow.task_id`).
 * Supabase cannot index into that JSONB without a migration, so the query
 * strategy is: the caller selects recent proof rows for the CIRCLE (bounded
 * ~100) and this core filters client-side for the exact task.
 *
 * Totality: `detail` may arrive as an object, a JSON string (some drivers /
 * legacy writes), null, or malformed garbage. Nothing here ever throws — a row
 * that cannot be understood is silently skipped.
 *
 * Pure module: no react-native / supabase imports (smoke-testable via tsx).
 */

/** Shape of a `proof_of_work` select row as the panel fetches it. Loose on
 *  purpose — every field is guarded. */
export interface ProofOfWorkRow {
  id?: unknown;
  pow_type?: unknown;
  title?: unknown;
  agent_name?: unknown;
  created_at?: unknown;
  detail?: unknown;
}

/** A proof row confirmed to back-link the requested task, with its detail
 *  normalized to a plain object (JSON-string details parsed). */
export interface TaskProofMatch {
  id: string | null;
  powType: string | null;
  title: string | null;
  agentName: string | null;
  createdAt: string | null;
  /** Parsed/normalized detail object — safe to hand to AgentRunProofDetail
   *  (which null-guards every field itself). */
  detail: Record<string, unknown>;
}

/** Bound on how many matched rows the panel shows. */
export const TASK_PROOF_MAX_ROWS = 5;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Normalize a `detail` value: object passes through, JSON string is parsed
 *  (must parse to an object), everything else → null. Never throws. */
function normalizeDetail(detail: unknown): Record<string, unknown> | null {
  if (isRecord(detail)) return detail;
  if (typeof detail === 'string') {
    try {
      const parsed = JSON.parse(detail);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function asStringOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** created_at → epoch ms for ordering; malformed/missing → 0 (sorts last). */
function rowTimeMs(createdAt: string | null): number {
  if (!createdAt) return 0;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Filter circle-scoped proof rows down to those whose `detail.task_id`
 * (string-coerced — a numeric id in JSONB still matches a string task id)
 * equals `taskId`. Newest first by `created_at`, bounded to
 * `TASK_PROOF_MAX_ROWS`. Total: never throws on any input shape.
 */
export function filterProofRowsForTask(
  rows: unknown,
  taskId: unknown,
): TaskProofMatch[] {
  if (!Array.isArray(rows)) return [];
  const wanted =
    typeof taskId === 'string' && taskId.length > 0
      ? taskId
      : typeof taskId === 'number' && Number.isFinite(taskId)
        ? String(taskId)
        : null;
  if (!wanted) return [];

  const matches: TaskProofMatch[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const detail = normalizeDetail((raw as ProofOfWorkRow).detail);
    if (!detail) continue;
    const rowTaskId = detail.task_id;
    const coerced =
      typeof rowTaskId === 'string'
        ? rowTaskId
        : typeof rowTaskId === 'number' && Number.isFinite(rowTaskId)
          ? String(rowTaskId)
          : null;
    if (coerced === null || coerced !== wanted) continue;
    matches.push({
      id: asStringOrNull(raw.id),
      powType: asStringOrNull(raw.pow_type),
      title: asStringOrNull(raw.title),
      agentName: asStringOrNull(raw.agent_name),
      createdAt: asStringOrNull(raw.created_at),
      detail,
    });
  }

  // Newest first; stable for ties/missing timestamps.
  matches.sort((a, b) => rowTimeMs(b.createdAt) - rowTimeMs(a.createdAt));
  return matches.slice(0, TASK_PROOF_MAX_ROWS);
}

/** Header-line summary of a task's (already filtered) proof matches. */
export interface TaskProofSummary {
  /** Matched row count (post-bound). */
  count: number;
  /** `detail.verified === true` of the NEWEST row; null when no rows. */
  latestVerified: boolean | null;
  /** created_at of the newest row (ISO string) or null. */
  latestTs: string | null;
  /** Total git references across the matched rows (bounded arrays only). */
  gitRefCount: number;
}

/**
 * Summarize filtered matches for the panel header
 * (`PROOF (N) · last verified ✓/✗`). Total: any input → a valid summary.
 */
export function summarizeTaskProof(rows: unknown): TaskProofSummary {
  const matches = Array.isArray(rows)
    ? (rows as unknown[]).filter(isRecord)
    : [];
  let gitRefCount = 0;
  for (const m of matches) {
    const detail = normalizeDetail((m as { detail?: unknown }).detail);
    const refs = detail?.git_references;
    if (Array.isArray(refs)) gitRefCount += refs.length;
  }
  if (matches.length === 0) {
    return { count: 0, latestVerified: null, latestTs: null, gitRefCount: 0 };
  }
  const latest = matches[0] as { detail?: unknown; createdAt?: unknown };
  const latestDetail = normalizeDetail(latest.detail);
  return {
    count: matches.length,
    latestVerified: latestDetail ? latestDetail.verified === true : null,
    latestTs: asStringOrNull(latest.createdAt),
    gitRefCount,
  };
}
