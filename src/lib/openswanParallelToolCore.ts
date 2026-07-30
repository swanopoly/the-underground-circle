/**
 * openswanParallelToolCore — pure partitioner that lets the OpenSwan session
 * runtime (`runOpenSwanSession` in `src/lib/openswanSessionRuntime.ts`) run
 * the INDEPENDENT read-only tool calls of one model round CONCURRENTLY instead
 * of strictly serially.
 *
 * Problem: a session round can carry several tool calls the model emitted
 * together — often a burst of pure reads with no ordering dependency
 * (`context.search` + `codebase.search` + `desktop.read_a11y_tree` +
 * `tasks.list`). Today the session loop pins `parallelToolConcurrency: 1`
 * (see the wiring note at that flag), so every read waits on the previous
 * one's network round-trip. This core walks the round's calls IN ORDER and
 * coalesces each maximal run of consecutive parallel-safe calls into ONE
 * group the caller may `Promise.all`, while every mutating / approval-gated /
 * unknown call stays a serial singleton barrier at its original position.
 *
 * "Parallel-safe" is keyed off the OpenSwan tool POLICY, not a hardcoded name
 * list: a call parallelizes iff its policy is `mutatesState === false` AND
 * `approvalMode === 'auto'` (mirrors `getOpenSwanToolPolicy` in
 * `src/lib/openswanToolRuntime.ts`). The policy is INJECTED (`policyOf`) so
 * this module stays pure — the real resolver lives in the runtime module,
 * which cannot be imported here. When `policyOf` is absent or returns nothing
 * for a name, a conservative built-in default (grounded in the real policy's
 * read-only/auto classification) decides; anything unknown to BOTH fails
 * CLOSED to a serial singleton — omission never reorders a mutation.
 *
 * Ordering guarantee: group order == emission order, and flattening every
 * group's `indices` reproduces `0..n-1` (capped), so a mutation NEVER moves
 * past any other call. `indices` point back into the ORIGINAL calls array so
 * the caller zips results by position.
 *
 * Sibling modules:
 *   - `src/lib/clientToolBatchCore.ts` — the chat-side (SwanBot v2 client-tool)
 *     analog; keys off a bare read-only NAME set because that path never sees
 *     policy objects. This core is its policy-keyed twin for the runtime loop.
 *   - `src/lib/toolBatchParallelism.ts` — the typed-loop (agentExecutionCore)
 *     partitioner that also reasons about write/read DOMAIN disjointness.
 *
 * Purity contract (smoke-tested under tsx): zero runtime imports, zero side
 * effects at import, no Date.now()/Math.random(), every export TOTAL (never
 * throws on null/undefined/wrong-type/huge/hostile/cyclic input — degrades to
 * a safe neutral value), deterministic, bounded output.
 */

/** Approval posture — mirrors `OpenSwanToolApprovalMode` in the runtime. */
export type OpenSwanToolApprovalMode = 'auto' | 'ask';

/**
 * The minimal slice of an OpenSwan tool policy this core reads. Grounded in
 * `OpenSwanToolPolicy` (`src/lib/openswanToolRuntime.ts`): the real object
 * carries `mutatesState` + `approvalMode`. `mutates` is accepted as an alias
 * so a caller can hand in the compact `{ mutates, approvalMode }` shape too.
 */
export interface OpenSwanToolParallelPolicy {
  /** Alias for `mutatesState` (compact caller shape). */
  mutates?: boolean;
  /** Real `OpenSwanToolPolicy` field: does the call change app/external state. */
  mutatesState?: boolean;
  /** Real `OpenSwanToolPolicy` field: 'auto' runs unattended, 'ask' gates. */
  approvalMode?: OpenSwanToolApprovalMode;
}

/**
 * Optional policy lookup. A function `(name) => policy`, a `Map`, or a plain
 * `Record`. Whatever form, missing/garbage entries fall through to the
 * built-in default (and then fail closed). Typed loosely on purpose — the
 * public entry points accept `unknown` and coerce totally.
 */
export type OpenSwanToolPolicyLookup =
  | ((name: string) => OpenSwanToolParallelPolicy | null | undefined)
  | ReadonlyMap<string, OpenSwanToolParallelPolicy | null | undefined>
  | Readonly<Record<string, OpenSwanToolParallelPolicy | null | undefined>>;

/** One dispatch group over the ORIGINAL round call array (by index). */
export interface OpenSwanToolGroup {
  /** true ⇔ this group holds >1 call and is safe to `Promise.all`. A single
   *  call (read or write) is a serial singleton with `parallel: false`. */
  parallel: boolean;
  /** Indices into the input `calls` array, ascending, in emission order. */
  indices: number[];
}

export interface OpenSwanToolPartition {
  /** Ordered dispatch plan; flattening `indices` yields 0..n-1 (capped). */
  groups: OpenSwanToolGroup[];
  /** How many calls landed in a parallel group (group size > 1) — i.e. how
   *  many calls actually gained concurrency this round. */
  parallelizableCount: number;
}

/** Hard cap on how many calls one partition processes — bounds output on
 *  adversarial input. Real rounds carry only a handful of tool calls. */
export const MAX_OPENSWAN_TOOL_CALLS = 500;

/**
 * Built-in read-only/auto OpenSwan tool names — every entry has
 * `mutatesState === false` AND `approvalMode === 'auto'` in
 * `getBaseOpenSwanToolPolicy` (`src/lib/openswanToolRuntime.ts`), so it is
 * safe to dispatch concurrently with its neighbours. This is the fallback the
 * core consults when an injected `policyOf` says nothing about a name.
 *
 * Deliberately EXCLUDES every mutation/approval tool (code.generate,
 * save_memory, *.create/update/delete, desktop writes, local.run_shell,
 * git.run, browser actions, credentials.get, vault.grant/revoke, gmail.write
 * & other g*.write, wp writes, messaging.notify, schedule_action, etc.).
 * Prefix rules for the uniformly-safe families (`verification.*`, `code.*`
 * minus `code.generate`) are applied on top in the default predicate.
 */
export const DEFAULT_PARALLEL_SAFE_TOOLS: ReadonlySet<string> = new Set<string>([
  // knowledge reads (getBaseOpenSwanToolPolicy read list + singletons)
  'fetch_url',
  'list_circle_members',
  'github.list_repos',
  'github.read_file',
  'github.activity',
  'integrations.list',
  'office.list_agents',
  'messages.list',
  'messages.search',
  'check_ins.list',
  'rooms.list',
  'rooms.list_tasks',
  'rooms.list_files',
  'rooms.read_file',
  'tasks.list',
  'tasks.get',
  'goals.list',
  'missions.list',
  'research.search',
  'automations.list',
  'approvals.list',
  'engineering.draft_dxf',
  'engineering.model_3d',
  'tools.search',
  'context.search',
  'codebase.search',
  'coordination.file_status',
  'todo.write',
  'skills.view',
  'search_memories',
  'integration.compose_action',
  'custom_api.read',
  // Google Workspace reads (auto, non-mutating)
  'gmail.read',
  'gdocs.read',
  'gsheets.read',
  'gdrive.read',
  'gcal.read',
  // vault redacted reads (grant/revoke/credentials.get excluded)
  'vault.list',
  'vault.find',
  'vault.grants',
  'vault.runbook',
  'vault.resolve_for_task',
  // WordPress reads
  'wp.discover_types',
  'wp.list_posts',
  // browser observation (all browser actions excluded)
  'browser.plan_task',
  'browser.dom_snapshot',
  'browser.wp_admin_source_intelligence',
  'browser.verification_state',
  'browser.screenshot',
  // workspace read
  'workspace.open_preview',
  // desktop observation (readOnlyTools set in getBaseOpenSwanToolPolicy)
  'desktop.list_running_apps',
  'desktop.list_installed_apps',
  'desktop.list_browser_tabs',
  'desktop.window_state',
  'desktop.clipboard',
  'desktop.file_list',
  'desktop.file_read',
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.shortcuts_list',
  'desktop.screen_size',
  'desktop.screenshot',
  // desktop.wait_for_app is deliberately EXCLUDED: it is a temporal
  // synchronization primitive (blocks until the app is ready), so same-round
  // neighbours must not dispatch beside it — getOpenSwanToolParallelPolicy
  // special-cases it into a sequential barrier, and this fallback must agree.
  'desktop.read_a11y_tree',
  'desktop.indesign_document_status',
  'desktop.indesign_text_inventory',
  'desktop.photoshop_document_status',
  'desktop.photoshop_layer_inventory',
  'desktop.illustrator_document_status',
  'desktop.illustrator_text_inventory',
  'desktop.menu_inventory',
  'desktop.cad_inspect_file',
  'desktop.observe_app',
  'desktop.app_reachability',
]);

/**
 * Built-in default parallel-safety verdict for a tool name, used only when an
 * injected `policyOf` is absent or silent about the name. Grounded in the real
 * policy's read-only/auto classification. Fails CLOSED: unknown → false.
 */
export function defaultOpenSwanToolParallelSafe(name: unknown): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (DEFAULT_PARALLEL_SAFE_TOOLS.has(name)) return true;
  // Uniformly read-only/auto families (getBaseOpenSwanToolPolicy):
  //   verification.* — always auto + non-mutating.
  //   code.*         — auto + non-mutating EXCEPT code.generate.
  if (name.startsWith('verification.')) return true;
  if (name.startsWith('code.') && name !== 'code.generate') return true;
  return false;
}

/** Coerce an arbitrary value to the policy slice we read, or null if it
 *  carries no usable field (never throws; ignores prototype junk). */
function coercePolicy(value: unknown): OpenSwanToolParallelPolicy | null {
  if (value === null || typeof value !== 'object') return null;
  let mutates: boolean | undefined;
  let mutatesState: boolean | undefined;
  let approvalMode: OpenSwanToolApprovalMode | undefined;
  try {
    const rec = value as Record<string, unknown>;
    if (typeof rec.mutates === 'boolean') mutates = rec.mutates;
    if (typeof rec.mutatesState === 'boolean') mutatesState = rec.mutatesState;
    if (rec.approvalMode === 'auto' || rec.approvalMode === 'ask') approvalMode = rec.approvalMode;
  } catch {
    // adversarial getter / revoked proxy → treat as no usable field
    return null;
  }
  if (mutates === undefined && mutatesState === undefined && approvalMode === undefined) {
    return null;
  }
  return { mutates, mutatesState, approvalMode };
}

/** Resolve a name against an injected lookup (function | Map | Record), or
 *  null when the lookup is absent/says nothing. Never throws. */
function resolveInjectedPolicy(policyOf: unknown, name: string): OpenSwanToolParallelPolicy | null {
  if (policyOf === null || policyOf === undefined) return null;
  try {
    if (typeof policyOf === 'function') {
      return coercePolicy((policyOf as (n: string) => unknown)(name));
    }
    const asMap = policyOf as { get?: unknown };
    if (typeof asMap.get === 'function') {
      return coercePolicy((asMap.get as (n: string) => unknown).call(policyOf, name));
    }
    if (typeof policyOf === 'object') {
      const rec = policyOf as Record<string, unknown>;
      // own-property only — never inherit from Object.prototype ('toString'…).
      if (Object.prototype.hasOwnProperty.call(rec, name)) {
        return coercePolicy(rec[name]);
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** A resolved policy is parallel-safe iff it neither mutates NOR needs
 *  approval. Both conditions required — fail closed on partial policies. */
function isPolicyParallelSafe(policy: OpenSwanToolParallelPolicy): boolean {
  const mutating = policy.mutates === true || policy.mutatesState === true;
  return !mutating && policy.approvalMode === 'auto';
}

/**
 * Is one OpenSwan tool safe to run concurrently with its round-neighbours?
 * Injected `policyOf` wins when it resolves the name; otherwise the built-in
 * default decides; unknown to both → false (fail closed). Total, never throws.
 */
export function isParallelSafeOpenSwanTool(name: unknown, policyOf?: unknown): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  try {
    const injected = resolveInjectedPolicy(policyOf, name);
    if (injected) return isPolicyParallelSafe(injected);
    return defaultOpenSwanToolParallelSafe(name);
  } catch {
    return false;
  }
}

/** Extract a usable tool name from a raw round call `{ name, args }`, or null
 *  (→ serial singleton). Ignores everything but a string `name`; never throws
 *  — a throwing getter or revoked proxy degrades to null. */
function toolNameOf(call: unknown): string | null {
  if (call === null || (typeof call !== 'object' && typeof call !== 'function')) return null;
  try {
    const n = (call as Record<string, unknown>).name;
    return typeof n === 'string' && n.length > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Partition one round's tool calls into an ordered dispatch plan.
 *
 *   - consecutive parallel-safe calls → one group (`parallel: true`, run via
 *     Promise.all);
 *   - any mutating / approval-gated / unknown / malformed call → its own
 *     serial singleton group (`parallel: false`);
 *   - group order == input order; a mutation never reorders past anything;
 *   - `indices` reference the ORIGINAL `calls` array (0-based); flattening
 *     them reproduces 0..n-1 (capped at MAX_OPENSWAN_TOOL_CALLS);
 *   - `parallelizableCount` = calls that gained concurrency (in a group >1);
 *   - degenerate input (non-array, empty) → { groups: [], parallelizableCount: 0 }.
 *
 * Caller contract (openswanSessionRuntime round dispatch): run groups in
 * order; within a `parallel` group dispatch concurrently and reassemble
 * results by their original index; run singleton groups one at a time so
 * approval prompts and side-effect ordering stay intact.
 */
export function partitionOpenSwanToolCalls(calls: unknown, policyOf?: unknown): OpenSwanToolPartition {
  try {
    if (!Array.isArray(calls) || calls.length === 0) {
      return { groups: [], parallelizableCount: 0 };
    }
    const limit = Math.min(calls.length, MAX_OPENSWAN_TOOL_CALLS);
    const groups: OpenSwanToolGroup[] = [];
    let openRun: OpenSwanToolGroup | null = null;
    for (let i = 0; i < limit; i += 1) {
      const name = toolNameOf(calls[i]);
      const safe = name !== null && isParallelSafeOpenSwanTool(name, policyOf);
      if (safe) {
        if (openRun) {
          openRun.indices.push(i);
        } else {
          openRun = { parallel: false, indices: [i] };
          groups.push(openRun);
        }
      } else {
        openRun = null;
        groups.push({ parallel: false, indices: [i] });
      }
    }
    let parallelizableCount = 0;
    for (const group of groups) {
      if (group.indices.length > 1) {
        group.parallel = true;
        parallelizableCount += group.indices.length;
      }
    }
    return { groups, parallelizableCount };
  } catch {
    // Totality backstop (e.g. revoked-proxy Array.isArray) — neutral value.
    return { groups: [], parallelizableCount: 0 };
  }
}
