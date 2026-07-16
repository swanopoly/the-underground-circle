/**
 * runCheckpointResumeCore — the PURE checkpoint-serialize + resume-decision core
 * behind ADD #4 of docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md
 * ("Durable checkpoint-per-step resume"): model the agent loop as a sequence of
 * per-step checkpoints keyed by run id so any run resumes deterministically
 * after a crash / edge cold-start / long HITL wait, with IDEMPOTENT side effects
 * (a tool whose result is already captured is skipped on resume, never re-run).
 *
 * WHERE IT PLUGS IN (the DB write / reload is the CALLER's — this stays pure):
 *   • CAPTURE — `agentExecutionCore.runAgent` emits `{ kind: 'iteration_complete',
 *     iteration, messages }` at every CLEAN round boundary (every `tool_use` has
 *     a matching `tool_result`; see that event's doc comment — "callers can
 *     persist it as a resumable checkpoint"). The persistence adapter calls
 *     `buildRunCheckpoint({ runId, stepIndex: iteration, messages, toolResults,
 *     nowMs: Date.now() })` and writes the returned row to `agent_runs` (a
 *     checkpoint column / a checkpoints child table). The `messagesSnapshot` is
 *     bounded here precisely because CLAUDE.md says keep persisted chat/run
 *     payloads bounded to avoid oversized rows.
 *   • RESUME — a cold start (crash recovery / edge re-entry / an approved HITL
 *     wait ending) loads the last persisted checkpoint and calls
 *     `planResumeFromCheckpoint(checkpoint)`: when `canResume`, it seeds a fresh
 *     `runAgent` with `checkpoint.messagesSnapshot` as `initialMessages` and
 *     skips re-dispatching any `tool_use` whose id is in `skipCompletedToolIds`
 *     (that tool's side effect already ran — return the cached result, don't
 *     re-invoke). `isCheckpointStale(checkpoint, Date.now())` gates that on
 *     freshness first (an abandoned run's stale checkpoint starts fresh).
 *
 * The completed-tool ledger is the union of (a) the ids the caller passes in
 * `toolResults` and (b) every `tool_result.tool_use_id` already present in the
 * message snapshot — so the idempotency guard is complete even if the caller
 * only hands over `messages` (which is all the `iteration_complete` event
 * carries).
 *
 * PURITY (load-bearing — the smoke runs under tsx; no react-native / supabase /
 * deno may be pulled in): ZERO runtime imports; no `Date.now()` / `Math.random()`
 * at module scope (the clock is injected as `nowMs`); every export TOTAL
 * (null / undefined / wrong-type / huge / hostile / cyclic input → a safe
 * neutral value, NEVER throws); bounded output (snapshot + id list are
 * hard-capped so a checkpoint row can't grow unbounded); secret-free (every
 * string is length-capped, so a base64 image payload inside a tool_result is
 * truncated with a length marker, never persisted whole).
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RunCheckpoint {
  /** The `agent_runs` id this checkpoint belongs to (empty ⇒ not resumable). */
  runId: string;
  /** 1-indexed last-completed step (mirrors `iteration_complete.iteration`;
   *  0 is the sentinel for "no step completed" ⇒ not resumable). */
  stepIndex: number;
  /** Bounded, cycle-safe, JSON-serialisable clone of the message history at the
   *  round boundary. Seeds `initialMessages` on resume. */
  messagesSnapshot: unknown;
  /** Deduped ids of every tool whose result is already captured — the
   *  idempotency ledger (skip these on resume so side effects don't re-run). */
  completedToolIds: string[];
  /** Capture time (the injected `nowMs`; 0 when the clock was unreadable, which
   *  reads as stale). */
  at: number;
}

export interface ResumePlan {
  /** True iff this checkpoint is structurally usable to resume a run. Freshness
   *  is a SEPARATE gate — combine with `!isCheckpointStale(...)` at the call
   *  site (this fn takes no clock). */
  canResume: boolean;
  /** The last durably-captured step index (equals `stepIndex`). The resumed run
   *  re-loads `messagesSnapshot` and continues producing step `fromStep + 1`
   *  onward; every step ≤ fromStep is done (its tools are in
   *  `skipCompletedToolIds`). 0 when not resumable. */
  fromStep: number;
  /** The completed-tool ledger to skip on resume (empty when not resumable). */
  skipCompletedToolIds: string[];
  /** Bounded, deterministic, secret-free diagnostic (never empty). */
  reason: string;
}

// ─── Tunables (exported so callers/tests share the exact ceilings) ────────────

/** Max messages kept in a snapshot (safety ceiling; a real run is far smaller). */
export const MAX_SNAPSHOT_MESSAGES = 200;
/** Max characters per string in a snapshot; longer strings are truncated with a
 *  `…[+N]` length marker (bounds base64 image payloads / oversized results). */
export const MAX_SNAPSHOT_STRING_CHARS = 8_000;
/** Max nesting depth cloned before a subtree becomes an `[omitted: too deep]`. */
export const MAX_SNAPSHOT_DEPTH = 12;
/** Max items cloned from any one array. */
export const MAX_SNAPSHOT_ARRAY_ITEMS = 500;
/** Max keys cloned from any one object. */
export const MAX_SNAPSHOT_OBJECT_KEYS = 200;
/** Global node budget across the whole snapshot (bounds shallow-but-huge input). */
export const MAX_SNAPSHOT_NODES = 20_000;
/** Max completed-tool ids kept in the ledger. */
export const MAX_COMPLETED_TOOL_IDS = 500;
/** Max characters kept per tool-use id. */
export const MAX_TOOL_ID_CHARS = 200;
/** Max characters kept for the run id. */
export const MAX_RUN_ID_CHARS = 200;
/** Absolute clamp for a step index (a real loop caps well under this). */
export const MAX_STEP_INDEX = 1_000_000;
/** Default staleness window: a checkpoint older than this is not resumed. 24h is
 *  generous enough for a long HITL wait yet abandons dead runs. */
export const DEFAULT_CHECKPOINT_MAX_AGE_MS = 86_400_000;

// ─── Total-safe primitives (never throw) ──────────────────────────────────────

/** Read one property without ever throwing (guards throwing getters / non-objects). */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** number | numeric-string → finite integer (floored); everything else → null. */
function toFiniteInt(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.floor(v) : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  return null;
}

function coerceRunId(v: unknown): string {
  if (typeof v === 'string') return v.trim().slice(0, MAX_RUN_ID_CHARS);
  if (typeof v === 'number' && Number.isFinite(v)) return String(v).slice(0, MAX_RUN_ID_CHARS);
  return '';
}

/** Completed-step index → non-negative, clamped integer. Invalid ⇒ 0 (sentinel). */
function coerceStepIndex(v: unknown): number {
  const n = toFiniteInt(v);
  if (n === null || n < 0) return 0;
  return n > MAX_STEP_INDEX ? MAX_STEP_INDEX : n;
}

/** Capture time → non-negative integer; invalid ⇒ 0 (reads as stale). */
function coerceAt(v: unknown): number {
  const n = toFiniteInt(v);
  if (n === null || n < 0) return 0;
  return n;
}

/** Length-cap a string, appending a `…[+N]` marker (secret-safe: reveals only a
 *  count, never the omitted content). */
function capString(s: string): string {
  if (s.length <= MAX_SNAPSHOT_STRING_CHARS) return s;
  return `${s.slice(0, MAX_SNAPSHOT_STRING_CHARS)}…[+${s.length - MAX_SNAPSHOT_STRING_CHARS}]`;
}

// ─── Bounded, cycle-safe snapshot clone ───────────────────────────────────────

type NodeBudget = { n: number };

/**
 * Deep clone bounded on every axis — depth, per-array width, per-object keys,
 * string length, and a global node budget — with true-cycle detection. The
 * output is always plain JSON-serialisable data (strings/numbers/booleans/null/
 * arrays/objects); functions, symbols, bigints, and non-finite numbers collapse
 * to `null`; a cycle / over-depth / over-budget subtree becomes a short marker
 * string. Cross-sibling sharing (a DAG) is preserved — only ANCESTOR cycles are
 * cut — because each node is removed from `seen` as its subtree unwinds.
 */
function boundedClone(value: unknown, depth: number, seen: WeakSet<object>, budget: NodeBudget): unknown {
  budget.n += 1;
  if (budget.n > MAX_SNAPSHOT_NODES) return '[omitted: snapshot budget]';

  if (value === null) return null;
  const t = typeof value;
  if (t === 'string') return capString(value as string);
  if (t === 'number') return Number.isFinite(value as number) ? (value as number) : null;
  if (t === 'boolean') return value;
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') return null;
  if (t !== 'object') return null;

  if (depth > MAX_SNAPSHOT_DEPTH) return '[omitted: too deep]';
  const obj = value as object;
  if (seen.has(obj)) return '[omitted: circular]';
  seen.add(obj);

  let out: unknown;
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    const cap = Math.min(value.length, MAX_SNAPSHOT_ARRAY_ITEMS);
    for (let i = 0; i < cap; i += 1) {
      if (budget.n > MAX_SNAPSHOT_NODES) break;
      arr.push(boundedClone(value[i], depth + 1, seen, budget));
    }
    out = arr;
  } else {
    const o: Record<string, unknown> = {};
    let keys: string[];
    try {
      keys = Object.keys(value as Record<string, unknown>);
    } catch {
      keys = [];
    }
    const cap = Math.min(keys.length, MAX_SNAPSHOT_OBJECT_KEYS);
    for (let i = 0; i < cap; i += 1) {
      if (budget.n > MAX_SNAPSHOT_NODES) break;
      const k = keys[i];
      let v: unknown;
      try {
        v = (value as Record<string, unknown>)[k];
      } catch {
        v = undefined; // throwing getter → treat as absent
      }
      o[k] = boundedClone(v, depth + 1, seen, budget);
    }
    out = o;
  }

  seen.delete(obj); // allow the same node under a different branch (DAG-safe)
  return out;
}

/** Turn arbitrary `messages` input into a bounded, cycle-free snapshot array.
 *  Non-array input ⇒ `[]` (a non-transcript can't seed a resume). */
function snapshotMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  const seen = new WeakSet<object>();
  const budget: NodeBudget = { n: 0 };
  const cap = Math.min(messages.length, MAX_SNAPSHOT_MESSAGES);
  const out: unknown[] = [];
  for (let i = 0; i < cap; i += 1) {
    if (budget.n > MAX_SNAPSHOT_NODES) break;
    out.push(boundedClone(messages[i], 1, seen, budget));
  }
  return out;
}

// ─── Completed-tool id collection ─────────────────────────────────────────────

/** Walk a CLEAN (already bounded, acyclic, depth-capped) snapshot collecting
 *  every `tool_result.tool_use_id`. Safe direct access — the clone has no
 *  throwing getters and no cycles. */
function collectToolResultIds(node: unknown, depth: number, out: string[]): void {
  if (depth > MAX_SNAPSHOT_DEPTH + 2) return;
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) collectToolResultIds(node[i], depth + 1, out);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === 'tool_result' && typeof rec.tool_use_id === 'string' && rec.tool_use_id) {
    out.push(rec.tool_use_id);
  }
  for (const k of Object.keys(rec)) collectToolResultIds(rec[k], depth + 1, out);
}

/** Extract ids from an explicit `toolResults` input — accepts raw string ids or
 *  objects keyed by `tool_use_id` / `toolUseId` / `id` (matches the
 *  `SwanBotResumeToolResult` and Anthropic `tool_result` / `tool_use` shapes). */
function idsFromToolResults(toolResults: unknown): string[] {
  if (!Array.isArray(toolResults)) return [];
  const out: string[] = [];
  const cap = Math.min(toolResults.length, MAX_COMPLETED_TOOL_IDS * 2);
  for (let i = 0; i < cap; i += 1) {
    const item = toolResults[i];
    let id = '';
    if (typeof item === 'string') {
      id = item;
    } else if (item && typeof item === 'object') {
      const cand = safeGet(item, 'tool_use_id') ?? safeGet(item, 'toolUseId') ?? safeGet(item, 'id');
      if (typeof cand === 'string') id = cand;
    }
    id = id.trim();
    if (id) out.push(id);
  }
  return out;
}

/** Dedupe + trim + length-cap + count-cap a list of ids (first occurrence wins,
 *  order preserved). Total: non-array ⇒ `[]`. */
function dedupeIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    const raw = ids[i];
    const t = typeof raw === 'string' ? raw.trim().slice(0, MAX_TOOL_ID_CHARS) : '';
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_COMPLETED_TOOL_IDS) break;
  }
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Capture a resumable checkpoint after a completed step. TOTAL: any hostile /
 * cyclic / missing input yields a well-formed `RunCheckpoint` with safe neutral
 * fields — it never throws. The messages snapshot is bounded on every axis and
 * the tool ledger is the deduped union of `toolResults` ids and the snapshot's
 * own `tool_result` ids.
 */
export function buildRunCheckpoint(input: {
  runId: unknown;
  stepIndex: unknown;
  messages: unknown;
  toolResults: unknown;
  nowMs: unknown;
}): RunCheckpoint {
  const src = (input && typeof input === 'object') ? input : ({} as Record<string, unknown>);
  const runId = coerceRunId(safeGet(src, 'runId'));
  const stepIndex = coerceStepIndex(safeGet(src, 'stepIndex'));
  const at = coerceAt(safeGet(src, 'nowMs'));

  let messagesSnapshot: unknown = [];
  let completedToolIds: string[] = [];
  try {
    const snapshot = snapshotMessages(safeGet(src, 'messages'));
    messagesSnapshot = snapshot;
    const fromResults = idsFromToolResults(safeGet(src, 'toolResults'));
    const fromMessages: string[] = [];
    collectToolResultIds(snapshot, 0, fromMessages);
    completedToolIds = dedupeIds([...fromResults, ...fromMessages]);
  } catch {
    messagesSnapshot = [];
    completedToolIds = [];
  }

  return { runId, stepIndex, messagesSnapshot, completedToolIds, at };
}

/**
 * Decide whether — and where — to resume a run from a persisted checkpoint.
 * TOTAL: accepts `unknown` (a hand-built / corrupt row) and re-validates every
 * field. Structural only — freshness is gated separately via `isCheckpointStale`
 * at the call site (this fn takes no clock). A checkpoint is resumable iff it
 * has a run id, at least one completed step, and a non-empty message snapshot.
 */
export function planResumeFromCheckpoint(checkpoint: unknown): ResumePlan {
  const notResumable = (reason: string): ResumePlan => ({
    canResume: false,
    fromStep: 0,
    skipCompletedToolIds: [],
    reason,
  });

  try {
    if (!checkpoint || typeof checkpoint !== 'object') {
      return notResumable('not resumable: invalid checkpoint');
    }
    const runId = coerceRunId(safeGet(checkpoint, 'runId'));
    if (!runId) return notResumable('not resumable: missing run id');

    const stepIndex = coerceStepIndex(safeGet(checkpoint, 'stepIndex'));
    if (stepIndex < 1) return notResumable('not resumable: no completed step');

    const snapshot = safeGet(checkpoint, 'messagesSnapshot');
    if (!Array.isArray(snapshot) || snapshot.length === 0) {
      return notResumable('not resumable: empty message snapshot');
    }

    const skipCompletedToolIds = dedupeIds(safeGet(checkpoint, 'completedToolIds'));
    return {
      canResume: true,
      fromStep: stepIndex,
      skipCompletedToolIds,
      reason: `resumable: step ${stepIndex}, ${skipCompletedToolIds.length} completed tool id(s) to skip`,
    };
  } catch {
    return notResumable('not resumable: invalid checkpoint');
  }
}

/**
 * Is this checkpoint too old to safely resume? TOTAL and FAIL-CLOSED: an
 * unreadable `nowMs` or a missing / unreadable capture time returns `true`
 * (treat as stale rather than resume something we can't age). A capture time at
 * or in the future of `now` is fresh (`false`). The boundary `age === maxAgeMs`
 * is fresh; one past it is stale. An invalid `maxAgeMs` falls back to the
 * default window.
 */
export function isCheckpointStale(
  checkpoint: unknown,
  nowMs: unknown,
  maxAgeMs: number = DEFAULT_CHECKPOINT_MAX_AGE_MS,
): boolean {
  try {
    const now = toFiniteInt(nowMs);
    if (now === null) return true; // can't verify age → fail closed
    const at = toFiniteInt(safeGet(checkpoint, 'at'));
    if (at === null) return true; // no/invalid capture time → stale
    let max = toFiniteInt(maxAgeMs);
    if (max === null || max <= 0) max = DEFAULT_CHECKPOINT_MAX_AGE_MS;
    const age = now - at;
    if (age <= 0) return false; // same-instant or future capture → fresh
    return age > max;
  } catch {
    return true;
  }
}
