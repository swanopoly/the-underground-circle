/**
 * circleMemoryWriteCore — the PURE decision layer behind every write to the
 * shared `circle_memory` doc (`brief` / `active_context` / `progress`).
 *
 * `circle_memory` is the circle's shared operating doc in a multi-agent,
 * multi-human workspace: a realtime React hook, `/memory-bank update`, idle
 * digest behaviors, checkpoint restore, and HITL-approved compaction all write
 * the SAME row. Concurrent writes are routine, not exotic. Two facts make an
 * unguarded write destructive:
 *
 *   1. The write is a whole-document REPLACE, not a delta. A writer that read
 *      v3 and writes v4 silently deletes whatever the other v3 reader shipped.
 *   2. `circle_memory_history` is the only undo. If a write skips the history
 *      row (compaction did), the prior content is gone for good.
 *
 * So this core makes two decisions, and only these two:
 *
 *   planMemoryDocWrite()        — what to archive, what to patch, and which
 *                                 `version` the caller must pin its UPDATE to.
 *   classifyMemoryWriteOutcome() — what a 0-rows-affected UPDATE actually MEANT,
 *                                 and whether replaying it is provably lossless.
 *
 * CONFLICT POLICY (deliberate — see classifyMemoryWriteOutcome):
 *   Because the write is a whole-document replace, a blind retry-with-refetch
 *   is NOT a fix — it re-applies stale-derived content on top of the winner and
 *   reproduces the exact lost update one round trip later. Default is therefore
 *   FAIL-CLOSED: return a typed `diverged` conflict the caller surfaces.
 *   Auto-retry happens only in the one case where replay is provably lossless
 *   (`safe_retry`: the version moved but the content did not), and it is bounded
 *   by MEMORY_WRITE_MAX_ATTEMPTS. A write whose content the winner already
 *   published is reported `converged` — success, no second write.
 *
 * Conventions: no I/O, no `Date.now()` (callers pass `nowMs`), every export
 * total on hostile input, and only light value imports so `npx tsx` loads it.
 */

import { parseMemoryDocKind, type MemoryDocKind } from './memoryBankKinds';

/** Hard ceiling on commit attempts for one logical write. */
export const MEMORY_WRITE_MAX_ATTEMPTS = 3;

/** Legacy default doc — matches pre-migration `circle_memory` semantics. */
export const DEFAULT_MEMORY_DOC_KIND: MemoryDocKind = 'brief';

/** First version stamped on a freshly inserted doc. */
export const FIRST_MEMORY_DOC_VERSION = 1;

// ─── Row shapes ──────────────────────────────────────────────────────────────

/** The subset of a `circle_memory` row this core reasons about. */
export type MemoryDocSnapshot = {
  id: string | null;
  content: string;
  last_edited_by: string | null;
  last_edited_at: string | null;
  version: number;
};

/** Insert payload for `circle_memory_history` (the undo record). */
export type MemoryHistoryRowPlan = {
  circle_id: string;
  doc_kind: MemoryDocKind;
  content: string;
  edited_by: string | null;
  edited_at: string;
  version: number;
};

/** Column patch for an existing `circle_memory` row. */
export type MemoryDocUpdatePatch = {
  content: string;
  last_edited_by: string | null;
  last_edited_at: string;
  version: number;
};

/** Insert payload for a `circle_memory` row that does not exist yet. */
export type MemoryDocInsertPatch = MemoryDocUpdatePatch & {
  circle_id: string;
  doc_kind: MemoryDocKind;
};

// ─── Plan ────────────────────────────────────────────────────────────────────

export type MemoryWriteAction = 'insert' | 'update' | 'noop' | 'refuse';

export type MemoryWriteRefusal =
  /** No usable circle id — never guess which circle to overwrite. */
  | 'missing_circle_id'
  /** Content wasn't a string. Coercing an object to "" would wipe the doc. */
  | 'invalid_content'
  /** Caller passed a non-finite `nowMs`; refuse rather than stamp epoch. */
  | 'invalid_now'
  /**
   * The caller pinned the write to a base snapshot (e.g. the content a
   * compaction proposal summarized) and the live doc no longer matches it.
   */
  | 'base_content_changed';

export type MemoryDocWritePlan = {
  action: MemoryWriteAction;
  docKind: MemoryDocKind;
  /** Undo record for the content about to be replaced. null unless action==='update'. */
  history: MemoryHistoryRowPlan | null;
  /** Row payload to write. null unless action is 'insert' | 'update'. */
  patch: MemoryDocInsertPatch | MemoryDocUpdatePatch | null;
  /**
   * Optimistic-concurrency predicate: the UPDATE must carry
   * `.eq('version', expectedVersion)`. null for insert/noop/refuse.
   */
  expectedVersion: number | null;
  /** Version the row carries after a successful commit. */
  nextVersion: number;
  /** Live content this plan was derived from — the base for conflict triage. */
  baseContent: string;
  /** Content the plan intends the doc to end up holding. */
  intendedContent: string;
  /** Set only when action === 'refuse'. */
  refusedReason: MemoryWriteRefusal | null;
};

export type PlanMemoryDocWriteInput = {
  circleId: unknown;
  /** Existing `circle_memory` row, or null/undefined for a first write. */
  existing?: unknown;
  nextContent: unknown;
  editorId?: unknown;
  docKind?: unknown;
  /** Caller-supplied clock (ms). No `Date.now()` in this module. */
  nowMs: unknown;
  /**
   * Optional precondition on the CONTENT (not just the version). Used by
   * compaction: the approved summary describes `originalContent`, so applying
   * it over anything else would destroy an edit made after the proposal.
   * Pass null/undefined to skip the guard.
   */
  guardBaseContent?: unknown;
};

// ─── Outcome ─────────────────────────────────────────────────────────────────

export type MemoryWriteConflictKind =
  /** UPDATE matched — the write committed. */
  | 'none'
  /** A concurrent writer already published byte-identical content. */
  | 'converged'
  /** Version moved but content did not — replaying our content loses nothing. */
  | 'safe_retry'
  /** A real concurrent edit. Overwriting it would be the lost update. */
  | 'diverged'
  /** The row disappeared underneath the write. */
  | 'vanished'
  /** Version predicate still matches yet 0 rows changed — RLS / filter problem. */
  | 'blocked';

export type MemoryWriteOutcome = {
  conflict: MemoryWriteConflictKind;
  /** Caller should re-plan against the fresh row and commit again. */
  retryable: boolean;
  /** True when the shared doc now holds the intended content. */
  contentApplied: boolean;
  /** Short, human-surfaceable explanation. */
  detail: string;
};

export type ClassifyMemoryWriteInput = {
  plan: unknown;
  /** Rows the UPDATE actually changed (`data.length` from `.select('id')`). */
  rowsAffected: unknown;
  /** Freshly refetched row after a 0-row UPDATE, or null if it's gone. */
  latest?: unknown;
  /** 1-based attempt number for this logical write. */
  attempt?: unknown;
  maxAttempts?: unknown;
};

// ─── Result (returned by the service layer; callers may ignore it) ───────────

export type MemoryWriteStatus =
  | 'inserted'
  | 'updated'
  | 'unchanged'
  | 'conflict'
  | 'refused'
  | 'error';

export type MemoryDocWriteResult = {
  /** True when the shared doc holds the intended content. */
  ok: boolean;
  status: MemoryWriteStatus;
  docKind: MemoryDocKind;
  /** Version the doc carries now, when known. */
  version: number | null;
  conflict: MemoryWriteConflictKind | null;
  refusedReason: MemoryWriteRefusal | null;
  /** True when this write archived an undo row into `circle_memory_history`. */
  historyRecorded: boolean;
  attempts: number;
  message: string;
};

// ─── Internal coercion helpers (total) ───────────────────────────────────────

function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Versions are non-negative integers. Junk floors to 0 so `+1` still climbs. */
export function normalizeMemoryVersion(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/** Canonicalize a doc kind, falling back to the legacy `brief` doc. */
export function normalizeMemoryDocKind(value: unknown): MemoryDocKind {
  if (value === undefined || value === null) return DEFAULT_MEMORY_DOC_KIND;
  return parseMemoryDocKind(typeof value === 'string' ? value : String(value)) ?? DEFAULT_MEMORY_DOC_KIND;
}

/** Read a `circle_memory` row into the shape this core reasons about. */
export function normalizeMemoryDocSnapshot(value: unknown): MemoryDocSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const content = safeGet(value, 'content');
  return {
    id: asText(safeGet(value, 'id')),
    content: typeof content === 'string' ? content : '',
    last_edited_by: asText(safeGet(value, 'last_edited_by')),
    last_edited_at: asText(safeGet(value, 'last_edited_at')),
    version: normalizeMemoryVersion(safeGet(value, 'version')),
  };
}

function refusedPlan(
  docKind: MemoryDocKind,
  reason: MemoryWriteRefusal,
  baseContent: string,
  intendedContent: string,
  nextVersion: number,
): MemoryDocWritePlan {
  return {
    action: 'refuse',
    docKind,
    history: null,
    patch: null,
    expectedVersion: null,
    nextVersion,
    baseContent,
    intendedContent,
    refusedReason: reason,
  };
}

// ─── planMemoryDocWrite ──────────────────────────────────────────────────────

/**
 * Decide what a single logical write to `circle_memory` should do.
 *
 * Guarantees:
 *   - Every content CHANGE to an existing row plans exactly one history row
 *     carrying the PRIOR content/editor/timestamp/version — including
 *     compaction, which used to skip it entirely.
 *   - Every update plans `expectedVersion` so the caller can pin the UPDATE and
 *     detect the lost-update race instead of silently winning it.
 *   - `nextVersion` is strictly greater than the base version on every write,
 *     so history versions stay monotonic and never collide.
 *   - A write whose content already matches the live row is a `noop`: no
 *     version churn, no meaningless history row.
 */
export function planMemoryDocWrite(input: PlanMemoryDocWriteInput): MemoryDocWritePlan {
  const raw = (input && typeof input === 'object' ? input : {}) as PlanMemoryDocWriteInput;
  const docKind = normalizeMemoryDocKind(raw.docKind);
  const existing = normalizeMemoryDocSnapshot(raw.existing);
  const baseContent = existing ? existing.content : '';
  const baseVersion = existing ? existing.version : 0;

  // Content must be a real string. Coercing `{}` / null to "" here would be an
  // silent doc wipe with a well-formed audit trail — the worst possible bug.
  if (typeof raw.nextContent !== 'string') {
    return refusedPlan(docKind, 'invalid_content', baseContent, baseContent, baseVersion);
  }
  const nextContent = raw.nextContent;

  const circleId = asText(raw.circleId);
  if (!circleId) {
    return refusedPlan(docKind, 'missing_circle_id', baseContent, nextContent, baseVersion);
  }

  const nowMs = typeof raw.nowMs === 'number' ? raw.nowMs : Number(raw.nowMs);
  if (!Number.isFinite(nowMs)) {
    return refusedPlan(docKind, 'invalid_now', baseContent, nextContent, baseVersion);
  }
  let nowIso: string;
  try {
    nowIso = new Date(nowMs).toISOString();
  } catch {
    // Finite but outside the representable Date range.
    return refusedPlan(docKind, 'invalid_now', baseContent, nextContent, baseVersion);
  }

  // Content precondition (compaction's stale-proposal guard).
  const guard = typeof raw.guardBaseContent === 'string' ? raw.guardBaseContent : null;
  if (guard !== null && baseContent !== guard) {
    return refusedPlan(docKind, 'base_content_changed', baseContent, nextContent, baseVersion);
  }

  const editorId = asText(raw.editorId);

  if (!existing) {
    const insert: MemoryDocInsertPatch = {
      circle_id: circleId,
      doc_kind: docKind,
      content: nextContent,
      last_edited_by: editorId,
      last_edited_at: nowIso,
      version: FIRST_MEMORY_DOC_VERSION,
    };
    return {
      action: 'insert',
      docKind,
      history: null, // nothing existed to archive
      patch: insert,
      expectedVersion: null,
      nextVersion: FIRST_MEMORY_DOC_VERSION,
      baseContent: '',
      intendedContent: nextContent,
      refusedReason: null,
    };
  }

  if (existing.content === nextContent) {
    return {
      action: 'noop',
      docKind,
      history: null,
      patch: null,
      expectedVersion: null,
      nextVersion: baseVersion,
      baseContent,
      intendedContent: nextContent,
      refusedReason: null,
    };
  }

  const nextVersion = baseVersion + 1;
  const history: MemoryHistoryRowPlan = {
    circle_id: circleId,
    doc_kind: docKind,
    content: existing.content,
    edited_by: existing.last_edited_by,
    edited_at: existing.last_edited_at ?? nowIso,
    version: baseVersion,
  };
  const update: MemoryDocUpdatePatch = {
    content: nextContent,
    last_edited_by: editorId,
    last_edited_at: nowIso,
    version: nextVersion,
  };
  return {
    action: 'update',
    docKind,
    history,
    patch: update,
    expectedVersion: baseVersion,
    nextVersion,
    baseContent,
    intendedContent: nextContent,
    refusedReason: null,
  };
}

// ─── classifyMemoryWriteOutcome ──────────────────────────────────────────────

function outcome(
  conflict: MemoryWriteConflictKind,
  retryable: boolean,
  contentApplied: boolean,
  detail: string,
): MemoryWriteOutcome {
  return { conflict, retryable, contentApplied, detail };
}

/**
 * Triage a version-pinned UPDATE that changed 0 rows.
 *
 * A 0-row UPDATE is NOT an error and NOT a success — it is the lost-update race
 * being caught. What it means depends entirely on what the row holds now, so the
 * caller must refetch and pass `latest`.
 *
 * Only `safe_retry` is replayable, and only because the live content is still
 * byte-identical to the base this write was derived from — replaying it cannot
 * destroy anything. Everything else fails closed.
 */
export function classifyMemoryWriteOutcome(input: ClassifyMemoryWriteInput): MemoryWriteOutcome {
  const raw = (input && typeof input === 'object' ? input : {}) as ClassifyMemoryWriteInput;

  const rowsRaw = typeof raw.rowsAffected === 'number' ? raw.rowsAffected : Number(raw.rowsAffected);
  const rowsAffected = Number.isFinite(rowsRaw) ? Math.max(0, Math.floor(rowsRaw)) : 0;
  if (rowsAffected >= 1) {
    return outcome('none', false, true, 'Write committed.');
  }

  const planAction = safeGet(raw.plan, 'action');
  const expectedVersionRaw = safeGet(raw.plan, 'expectedVersion');
  const expectedVersion = typeof expectedVersionRaw === 'number' ? expectedVersionRaw : null;
  const intendedRaw = safeGet(raw.plan, 'intendedContent');
  const intendedContent = typeof intendedRaw === 'string' ? intendedRaw : null;
  const baseRaw = safeGet(raw.plan, 'baseContent');
  const baseContent = typeof baseRaw === 'string' ? baseRaw : null;

  const latest = normalizeMemoryDocSnapshot(raw.latest);

  if (latest === null) {
    return outcome(
      'vanished',
      false,
      false,
      'The shared memory doc no longer exists — it was deleted while this write was in flight.',
    );
  }

  // A concurrent writer already published exactly what we intended. The doc
  // holds the target content and THEY archived the undo row. Nothing to do.
  if (intendedContent !== null && latest.content === intendedContent) {
    return outcome('converged', false, true, 'Another editor already saved identical content.');
  }

  // Predicate still matches but nothing changed: this was never a race. Almost
  // always RLS or a circle/doc filter mismatch. Replaying reproduces it exactly.
  if (
    planAction === 'update' &&
    expectedVersion !== null &&
    latest.version === expectedVersion
  ) {
    return outcome(
      'blocked',
      false,
      false,
      'The update matched no rows even though the version is unchanged — the write was rejected (permissions or a filter mismatch), not raced.',
    );
  }

  // The version moved but the content did not, so re-applying our content
  // cannot destroy anyone's edit. This is the ONLY provably lossless replay.
  if (baseContent !== null && latest.content === baseContent) {
    const attemptRaw = typeof raw.attempt === 'number' ? raw.attempt : Number(raw.attempt);
    const attempt = Number.isFinite(attemptRaw) ? Math.max(1, Math.floor(attemptRaw)) : 1;
    const maxRaw = typeof raw.maxAttempts === 'number' ? raw.maxAttempts : Number(raw.maxAttempts);
    const maxAttempts = Number.isFinite(maxRaw) ? Math.max(1, Math.floor(maxRaw)) : MEMORY_WRITE_MAX_ATTEMPTS;
    const retryable = attempt < maxAttempts;
    return outcome(
      'safe_retry',
      retryable,
      false,
      retryable
        ? 'The doc version moved but its content did not — replaying this write is lossless.'
        : `Gave up after ${attempt} attempts against a repeatedly-moving version.`,
    );
  }

  // Real divergence. Whole-doc replace means overwriting here IS the lost
  // update, so refuse and hand the conflict back to the caller.
  return outcome(
    'diverged',
    false,
    false,
    'Someone else edited this memory doc first. Your version was not saved, so their edit is intact — reload and reapply your change.',
  );
}

// ─── Reporting ───────────────────────────────────────────────────────────────

export function describeMemoryWriteRefusal(reason: MemoryWriteRefusal | null): string {
  switch (reason) {
    case 'missing_circle_id':
      return 'Refused: no circle id was supplied for this memory write.';
    case 'invalid_content':
      return 'Refused: memory content must be a string.';
    case 'invalid_now':
      return 'Refused: the caller supplied an invalid timestamp.';
    case 'base_content_changed':
      return 'Refused: the memory doc changed after this write was prepared, so applying it would overwrite that edit.';
    default:
      return 'Refused.';
  }
}

/** Compose the caller-facing result. Pure so the wording is testable. */
export function buildMemoryDocWriteResult(input: {
  plan: MemoryDocWritePlan;
  outcome?: MemoryWriteOutcome | null;
  historyRecorded?: boolean;
  attempts?: number;
  liveVersion?: number | null;
  error?: string | null;
}): MemoryDocWriteResult {
  const plan = input.plan;
  const docKind = normalizeMemoryDocKind(safeGet(plan, 'docKind'));
  const attemptsRaw = typeof input.attempts === 'number' ? input.attempts : 0;
  const attempts = Number.isFinite(attemptsRaw) ? Math.max(0, Math.floor(attemptsRaw)) : 0;
  const historyRecorded = input.historyRecorded === true;
  const liveVersion =
    typeof input.liveVersion === 'number' && Number.isFinite(input.liveVersion) ? input.liveVersion : null;

  if (input.error) {
    return {
      ok: false,
      status: 'error',
      docKind,
      version: liveVersion,
      conflict: input.outcome?.conflict ?? null,
      refusedReason: null,
      historyRecorded,
      attempts,
      message: input.error,
    };
  }

  if (plan.action === 'refuse') {
    return {
      ok: false,
      status: 'refused',
      docKind,
      version: liveVersion,
      conflict: null,
      refusedReason: plan.refusedReason,
      historyRecorded: false,
      attempts,
      message: describeMemoryWriteRefusal(plan.refusedReason),
    };
  }

  if (plan.action === 'noop') {
    return {
      ok: true,
      status: 'unchanged',
      docKind,
      version: liveVersion ?? plan.nextVersion,
      conflict: null,
      refusedReason: null,
      historyRecorded: false,
      attempts,
      message: 'No change — the memory doc already holds this content.',
    };
  }

  const result = input.outcome ?? outcome('none', false, true, 'Write committed.');
  if (result.contentApplied) {
    const converged = result.conflict === 'converged';
    return {
      ok: true,
      status: converged ? 'unchanged' : plan.action === 'insert' ? 'inserted' : 'updated',
      docKind,
      version: converged ? liveVersion : liveVersion ?? plan.nextVersion,
      conflict: result.conflict === 'none' ? null : result.conflict,
      refusedReason: null,
      historyRecorded,
      attempts,
      message: result.detail,
    };
  }

  return {
    ok: false,
    status: 'conflict',
    docKind,
    version: liveVersion,
    conflict: result.conflict,
    refusedReason: null,
    historyRecorded,
    attempts,
    message: result.detail,
  };
}
