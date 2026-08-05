/**
 * openswanTelemetryDeferCore — pure classifier + scheduler for OpenSwan
 * pre-loop telemetry writes (hot-path optimization plan finding R2).
 *
 * WHY: Before the first model token, `runOpenSwanSessionTurn`
 * (`src/lib/openswanSessionRuntime.ts`) performs ~11 awaited Supabase
 * round-trips that are pure audit/transcript telemetry (evidence lines
 * :1295–:1613 in that file). They gate time-to-first-token even though the
 * model call does not depend on them. Only three writes are truly on the
 * critical path:
 *   - `createRun`                    (agentRunSystem.ts:144 — returns run.id)
 *   - `buildOpenSwanMemoryStores`    (memory recall — feeds the prompt)
 *   - `buildStreamableSystemPrompt`  (system prompt — feeds the model call)
 *
 * This core decides, per write, whether it must be AWAITED before the model
 * call, can be fired-and-forgotten after the first token, or must be DEFERRED
 * but still SEQUENCED (because a later write depends on an earlier one). The
 * one ordering hazard the plan calls out (R2): `mergeRunMetadata`
 * (agentRunSystem.ts:203 — read/merge/write of the JSON `metadata` column)
 * MUST precede `updateRunStatus` when the latter carries a `metadata` field,
 * because `updateRunStatus` (agentRunSystem.ts:188) does a WHOLE-COLUMN
 * REPLACE (comment at openswanSessionRuntime.ts:2129–2134). Callers encode
 * that constraint with `dependsOn` and this core preserves it.
 *
 * The caller (openswanSessionRuntime) owns the real write closures + row ids;
 * this core owns only the *decision* over lightweight descriptors, so it stays
 * pure and tsx-loadable (zero runtime imports — no react-native / supabase /
 * deno). Every export is TOTAL: null / undefined / wrong-type / huge / hostile
 * / cyclic input yields a safe neutral result and never throws. Fail-closed:
 * anything unknown or ambiguous is treated as `await_blocking`, and a
 * required-ordered write is never dropped or left racing its dependency.
 */

// ─── Public types ───────────────────────────────────────────────────────────

export type WriteDisposition =
  | 'await_blocking'
  | 'defer_fire_and_forget'
  | 'defer_ordered';

export interface TelemetryWriteDescriptor {
  /** Stable id used to reference this write in a schedule / dependency edge. */
  id: string;
  /** Coarse write kind, e.g. create_run | merge_metadata | update_status | transcript | event. */
  kind: string;
  /** Truthy when the model call cannot start until this write completes. */
  blocksModelCall?: unknown;
  /** id[] this write must follow (e.g. update_status dependsOn merge_metadata). */
  dependsOn?: unknown;
}

export interface TelemetryWriteClassification {
  disposition: WriteDisposition;
  reason: string;
}

export interface TelemetrySchedule {
  /** Awaited before the model call, in input order. */
  blocking: string[];
  /**
   * Deferred-but-sequenced write chains. Each inner array is one independent
   * chain, topologically ordered so a dependency precedes its dependent
   * (e.g. ['merge_meta', 'update_status']). Distinct chains have no ordering
   * between them, so the caller may run them as parallel `void` chains after
   * the first token, each internally sequential.
   */
  deferredOrdered: string[][];
  /** Deferred with no ordering constraint — pure `void ...().catch()`, in input order. */
  fireAndForget: string[];
}

// ─── Bounds (keep every export total + bounded) ──────────────────────────────

const MAX_WRITES = 4096;
const MAX_DEPS_PER_WRITE = 256;
const MAX_ID_LEN = 200;
const MAX_KIND_LEN = 64;

// ─── Kind classification (exact-match sets; see header for real call sites) ──

/** Writes that gate the model call — awaited before the first token. */
const BLOCKING_KINDS: ReadonlySet<string> = new Set([
  'create_run', // createRun (agentRunSystem.ts:144) — returns run.id
  'memory_recall', // buildOpenSwanMemoryStores — feeds the prompt
  'memory_stores', // alias of the above
  'system_prompt', // buildStreamableSystemPrompt — feeds the model call
  'prompt_build', // alias of the above
]);

/** Pure audit/transcript telemetry — safe to defer off the critical path. */
const TELEMETRY_KINDS: ReadonlySet<string> = new Set([
  'transcript',
  'transcript_event',
  'transcript_header', // upsertOpenSwanTranscriptHeader :1295
  'event',
  'update_status', // updateRunStatus :1338 / :1419 / :1574
  'merge_metadata', // mergeRunMetadata :1339 / :1554 / :1613
  'add_step', // addStep :1344 / :1390 / :1398
  'step',
  'add_artifact', // addArtifact :1538
  'artifact',
  'ledger', // persistAgentRunLedgerPreview :1278
  'ledger_preview',
  'session_started',
  'user_turn',
  'context_loaded',
  'memory_loaded', // NB: the telemetry EVENT, not the memory recall (blocking)
  'delegation_planned',
  'delegation_completed',
  'posture',
  'log',
  'metric',
]);

/** Camel/verbose call-site names collapse onto canonical kinds. Keys are the
 *  underscore-stripped, lowercased form (see normalizeKind). */
const KIND_ALIASES: Readonly<Record<string, string>> = {
  createrun: 'create_run',
  runcreate: 'create_run',
  updaterunstatus: 'update_status',
  runstatus: 'update_status',
  updatestatus: 'update_status',
  mergerunmetadata: 'merge_metadata',
  runmetadata: 'merge_metadata',
  mergemetadata: 'merge_metadata',
  appendtranscriptevent: 'transcript_event',
  transcriptevent: 'transcript_event',
  upsertopenswantranscriptheader: 'transcript_header',
  transcriptheader: 'transcript_header',
  buildstreamablesystemprompt: 'system_prompt',
  systemprompt: 'system_prompt',
  promptbuild: 'prompt_build',
  buildopenswanmemorystores: 'memory_recall',
  memoryrecall: 'memory_recall',
  memorystores: 'memory_stores',
  addstep: 'add_step',
  addartifact: 'add_artifact',
  addstepstep: 'add_step',
  persistagentrunledgerpreview: 'ledger_preview',
  ledgerpreview: 'ledger_preview',
};

// ─── Internal helpers (total, bounded) ───────────────────────────────────────

function cleanId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > MAX_ID_LEN ? s.slice(0, MAX_ID_LEN) : s;
}

function normalizeKind(v: unknown): string {
  if (typeof v !== 'string') return '';
  // Cheap upper bound on work, then collapse to a safe [a-z0-9_] token.
  let s = v.slice(0, MAX_KIND_LEN * 3).toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!s) return '';
  s = s.slice(0, MAX_KIND_LEN).replace(/_+$/g, '');
  if (!s) return '';
  if (KIND_ALIASES[s]) return KIND_ALIASES[s];
  const compact = s.replace(/_/g, '');
  if (KIND_ALIASES[compact]) return KIND_ALIASES[compact];
  return s;
}

function toIdList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < v.length && out.length < MAX_DEPS_PER_WRITE; i += 1) {
    const id = cleanId(v[i]);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Fail-closed truthiness for `blocksModelCall`: anything ambiguous (objects,
 *  NaN, symbols) is treated as blocking rather than silently deferred. */
function isBlockingFlag(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v !== 0 : true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return !(
      s === '' ||
      s === 'false' ||
      s === '0' ||
      s === 'no' ||
      s === 'off' ||
      s === 'null' ||
      s === 'undefined'
    );
  }
  // object / array / function / symbol / bigint → ambiguous → fail closed
  return true;
}

// ─── Per-write classifier ────────────────────────────────────────────────────

/**
 * Classify a single telemetry write.
 *
 * - `blocksModelCall` truthy, or a critical-path kind (create_run /
 *   memory_recall / system_prompt) → `await_blocking`.
 * - a write carrying an ordering dependency (e.g. update_status dependsOn
 *   merge_metadata) → `defer_ordered` (deferred, but sequenced after its dep).
 * - pure telemetry/transcript with no dependency → `defer_fire_and_forget`.
 * - anything unknown/ambiguous/malformed → `await_blocking` (fail-closed).
 *
 * NB: this is a LOCAL decision. Whether a write is *depended upon* by another
 * (and must therefore join an ordered chain instead of firing loose) is a
 * whole-graph fact resolved by `planTelemetrySchedule`.
 */
export function classifyTelemetryWrite(w: TelemetryWriteDescriptor): TelemetryWriteClassification {
  try {
    if (w === null || typeof w !== 'object' || Array.isArray(w)) {
      return { disposition: 'await_blocking', reason: 'malformed descriptor → fail-closed to await_blocking' };
    }
    const rec = w as unknown as Record<string, unknown>;
    const id = cleanId(rec.id);
    if (!id) {
      return { disposition: 'await_blocking', reason: 'missing/invalid id → fail-closed to await_blocking' };
    }
    if (isBlockingFlag(rec.blocksModelCall)) {
      return { disposition: 'await_blocking', reason: 'blocksModelCall set → on model critical path' };
    }
    const kind = normalizeKind(rec.kind);
    if (kind && BLOCKING_KINDS.has(kind)) {
      return { disposition: 'await_blocking', reason: `critical-path kind (${kind}) → await before model call` };
    }
    const deps = toIdList(rec.dependsOn);
    if (deps.length > 0) {
      return { disposition: 'defer_ordered', reason: 'has ordering dependency → deferred but sequenced after dep' };
    }
    if (kind && TELEMETRY_KINDS.has(kind)) {
      return { disposition: 'defer_fire_and_forget', reason: `pure telemetry (${kind}) with no dependency → fire-and-forget` };
    }
    return {
      disposition: 'await_blocking',
      reason: kind
        ? `unknown kind (${kind}) → fail-closed to await_blocking`
        : 'unclassifiable kind → fail-closed to await_blocking',
    };
  } catch {
    return { disposition: 'await_blocking', reason: 'classification error → fail-closed to await_blocking' };
  }
}

// ─── Whole-schedule planner ──────────────────────────────────────────────────

interface ScheduleItem {
  id: string;
  kind: string;
  deps: string[];
  disp: WriteDisposition;
  index: number;
}

/** Topologically order one weakly-connected component; ties broken by input
 *  index for determinism. Any leftover (should not happen post-fixpoint) is
 *  appended by input order so no id is ever dropped. */
function topoOrderComponent(
  ids: string[],
  resolvedById: ReadonlyMap<string, string[]>,
  indexById: ReadonlyMap<string, number>,
): string[] {
  const set = new Set(ids);
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of ids) {
    indeg.set(id, 0);
    dependents.set(id, []);
  }
  for (const id of ids) {
    for (const dep of resolvedById.get(id) || []) {
      if (set.has(dep)) {
        indeg.set(id, (indeg.get(id) || 0) + 1);
        (dependents.get(dep) as string[]).push(id);
      }
    }
  }
  const byIndex = (a: string, b: string): number => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0);
  const ready = ids.filter((id) => (indeg.get(id) || 0) === 0);
  const chain: string[] = [];
  let guard = 0;
  while (ready.length > 0 && guard < ids.length + 1) {
    guard += 1;
    ready.sort(byIndex);
    const n = ready.shift() as string;
    chain.push(n);
    for (const m of dependents.get(n) || []) {
      const nd = (indeg.get(m) || 0) - 1;
      indeg.set(m, nd);
      if (nd === 0) ready.push(m);
    }
  }
  if (chain.length < ids.length) {
    const included = new Set(chain);
    for (const id of [...ids].sort(byIndex)) {
      if (!included.has(id)) chain.push(id);
    }
  }
  return chain;
}

/**
 * Partition + topologically group a batch of telemetry writes so the caller
 * can cut time-to-first-token safely:
 *   - `blocking`        — await these before the model call.
 *   - `deferredOrdered` — after the first token, run each inner chain as a
 *                         sequential `void` chain (dep precedes dependent).
 *   - `fireAndForget`   — after the first token, `void ...().catch()` freely.
 *
 * Fail-closed guarantees:
 *   - a write whose `dependsOn` names an id NOT present in the batch is
 *     escalated to `blocking` (cannot guarantee ordering otherwise).
 *   - a dependency CYCLE escalates every node on it to `blocking`.
 *   - a required-ordered dependency of a deferred write is pulled INTO the
 *     ordered chain, never left as loose fire-and-forget.
 * Every valid, uniquely-identified input write appears in exactly one bucket.
 * Total + bounded: non-array / hostile / cyclic / oversized input is safe.
 */
export function planTelemetrySchedule(writes: unknown): TelemetrySchedule {
  const empty: TelemetrySchedule = { blocking: [], deferredOrdered: [], fireAndForget: [] };
  try {
    if (!Array.isArray(writes)) return empty;

    // 1. Normalize into items keyed by valid, unique id.
    const items: ScheduleItem[] = [];
    const byId = new Map<string, ScheduleItem>();
    const limit = Math.min(writes.length, MAX_WRITES);
    for (let i = 0; i < limit; i += 1) {
      const w = writes[i];
      if (w === null || typeof w !== 'object' || Array.isArray(w)) continue;
      const rec = w as Record<string, unknown>;
      const id = cleanId(rec.id);
      if (!id || byId.has(id)) continue; // unschedulable (no id) or duplicate
      const cls = classifyTelemetryWrite(w as TelemetryWriteDescriptor);
      const item: ScheduleItem = {
        id,
        kind: normalizeKind(rec.kind),
        deps: toIdList(rec.dependsOn),
        disp: cls.disposition,
        index: items.length,
      };
      items.push(item);
      byId.set(id, item);
    }
    if (items.length === 0) return empty;

    const indexById = new Map<string, number>();
    for (const it of items) indexById.set(it.id, it.index);

    const blockingSet = new Set<string>();
    for (const it of items) if (it.disp === 'await_blocking') blockingSet.add(it.id);

    const resolvedDeps = (it: ScheduleItem): string[] =>
      it.deps.filter((d) => byId.has(d) && !blockingSet.has(d));

    // 2. Fixpoint: escalate missing-dep and cyclic nodes to blocking → DAG.
    for (let iter = 0; iter <= items.length; iter += 1) {
      let changed = false;

      // 2a. A dependency that is not present at all → cannot sequence → block.
      for (const it of items) {
        if (blockingSet.has(it.id)) continue;
        for (const dep of it.deps) {
          if (!byId.has(dep)) {
            blockingSet.add(it.id);
            changed = true;
            break;
          }
        }
      }

      // 2b. Detect cycles among the remaining deferred nodes via Kahn.
      const deferred = items.filter((it) => !blockingSet.has(it.id));
      const indeg = new Map<string, number>();
      const dependents = new Map<string, string[]>();
      for (const it of deferred) {
        indeg.set(it.id, 0);
        dependents.set(it.id, []);
      }
      for (const it of deferred) {
        for (const dep of resolvedDeps(it)) {
          if (indeg.has(dep)) {
            indeg.set(it.id, (indeg.get(it.id) || 0) + 1);
            (dependents.get(dep) as string[]).push(it.id);
          }
        }
      }
      const queue: string[] = [];
      for (const it of deferred) if ((indeg.get(it.id) || 0) === 0) queue.push(it.id);
      let removed = 0;
      let guard = 0;
      while (queue.length > 0 && guard < deferred.length + 1) {
        guard += 1;
        const n = queue.shift() as string;
        removed += 1;
        for (const m of dependents.get(n) || []) {
          const nd = (indeg.get(m) || 0) - 1;
          indeg.set(m, nd);
          if (nd === 0) queue.push(m);
        }
      }
      if (removed < deferred.length) {
        // Nodes still carrying in-edges are on cycles → fail closed to blocking.
        for (const it of deferred) {
          if ((indeg.get(it.id) || 0) > 0 && !blockingSet.has(it.id)) {
            blockingSet.add(it.id);
            changed = true;
          }
        }
      }

      if (!changed) break;
    }

    // 3. Snapshot stable resolved deps + partition.
    const deferred = items.filter((it) => !blockingSet.has(it.id));
    const resolvedById = new Map<string, string[]>();
    for (const it of deferred) resolvedById.set(it.id, resolvedDeps(it));

    const involved = new Set<string>();
    for (const it of deferred) {
      const rd = resolvedById.get(it.id) as string[];
      if (rd.length > 0) {
        involved.add(it.id);
        for (const dep of rd) involved.add(dep);
      }
    }

    const blocking: string[] = [];
    for (const it of items) if (blockingSet.has(it.id)) blocking.push(it.id);

    const fireAndForget: string[] = [];
    for (const it of deferred) if (!involved.has(it.id)) fireAndForget.push(it.id);

    // 4. Weakly-connected components over involved nodes → topo-ordered chains.
    const involvedNodes = deferred.filter((it) => involved.has(it.id));
    const deferredOrdered = buildOrderedChains(involvedNodes, resolvedById, indexById);

    return { blocking, deferredOrdered, fireAndForget };
  } catch {
    return empty;
  }
}

function buildOrderedChains(
  nodes: ScheduleItem[],
  resolvedById: ReadonlyMap<string, string[]>,
  indexById: ReadonlyMap<string, number>,
): string[][] {
  if (nodes.length === 0) return [];

  // Union-find over ordering edges → weakly-connected components.
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);
  const find = (x: string): string => {
    let r = x;
    let guard = 0;
    while (parent.get(r) !== r && guard < nodes.length + 2) {
      r = parent.get(r) ?? r;
      guard += 1;
    }
    return r;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const n of nodes) {
    for (const dep of resolvedById.get(n.id) || []) {
      if (parent.has(dep)) union(n.id, dep);
    }
  }

  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const bucket = groups.get(root);
    if (bucket) bucket.push(n.id);
    else groups.set(root, [n.id]);
  }

  const chains: Array<{ chain: string[]; minIndex: number }> = [];
  for (const group of groups.values()) {
    const chain = topoOrderComponent(group, resolvedById, indexById);
    let minIndex = Number.POSITIVE_INFINITY;
    for (const id of chain) {
      const idx = indexById.get(id) ?? 0;
      if (idx < minIndex) minIndex = idx;
    }
    chains.push({ chain, minIndex: Number.isFinite(minIndex) ? minIndex : 0 });
  }
  chains.sort((a, b) => a.minIndex - b.minIndex);
  return chains.map((c) => c.chain);
}
