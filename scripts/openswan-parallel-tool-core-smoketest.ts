/**
 * openswan-parallel-tool-core-smoketest — the PURE round-parallelism brain
 * (src/lib/openswanParallelToolCore.ts). Load-bearing behaviour:
 *   - consecutive read-only/auto tools coalesce into one parallel group;
 *   - a mutating/ask/unknown tool is a serial singleton that never merges
 *     across (ordering + side-effect safety preserved);
 *   - policy is INJECTED (function | Map | Record), authoritative when it
 *     resolves a name, else the built-in default, else fail-closed;
 *   - indices point back into the original round array (0..n-1, capped);
 *   - total: null/undefined/wrong-type/huge/hostile/cyclic → safe neutral.
 *
 * Pure — loads under tsx (openswanParallelToolCore has zero imports).
 */

import {
  partitionOpenSwanToolCalls,
  isParallelSafeOpenSwanTool,
  defaultOpenSwanToolParallelSafe,
  DEFAULT_PARALLEL_SAFE_TOOLS,
  MAX_OPENSWAN_TOOL_CALLS,
  type OpenSwanToolParallelPolicy,
} from '../src/lib/openswanParallelToolCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
/** Compact call factory. */
const c = (name: unknown, args?: unknown) => ({ name, args: args ?? {} });
/** Flatten a partition's indices for order-preservation checks. */
const flat = (p: { groups: Array<{ indices: number[] }> }) => p.groups.flatMap((g) => g.indices);

function main(): void {
  // ─── (1) 3 reads → ONE parallel group ────────────────────────────────────
  {
    const p = partitionOpenSwanToolCalls([
      c('context.search'), c('codebase.search'), c('tasks.list'),
    ]);
    assertEq(p.groups.length, 1, '(1) three reads → single group');
    assertEq(p.groups[0].parallel, true, '(1) the group is parallel');
    assertEq(p.groups[0].indices.length, 3, '(1) all three coalesced');
    assertEq(p.parallelizableCount, 3, '(1) parallelizableCount counts all three');
    assertEq(JSON.stringify(p.groups[0].indices), '[0,1,2]', '(1) indices in emission order');
  }

  // ─── (2) read / write / read → THREE serial singletons ───────────────────
  {
    const p = partitionOpenSwanToolCalls([
      c('tasks.list'), c('tasks.create'), c('tasks.get'),
    ]);
    assertEq(p.groups.length, 3, '(2) read/write/read → 3 groups');
    assert(p.groups.every((g) => g.parallel === false), '(2) every group is a serial singleton');
    assert(p.groups.every((g) => g.indices.length === 1), '(2) each singleton holds one call');
    assertEq(p.parallelizableCount, 0, '(2) nothing parallelized');
    assertEq(JSON.stringify(flat(p)), '[0,1,2]', '(2) flatten reproduces input order');
  }

  // ─── (3) leading reads coalesce, trailing write splits ───────────────────
  {
    const p = partitionOpenSwanToolCalls([
      c('context.search'), c('codebase.search'), c('tasks.create'),
    ]);
    assertEq(p.groups.length, 2, '(3) two groups');
    assertEq(p.groups[0].parallel, true, '(3) leading reads → parallel group');
    assertEq(JSON.stringify(p.groups[0].indices), '[0,1]', '(3) leading indices coalesced');
    assertEq(p.groups[1].parallel, false, '(3) trailing write → serial singleton');
    assertEq(JSON.stringify(p.groups[1].indices), '[2]', '(3) write keeps its position');
    assertEq(p.parallelizableCount, 2, '(3) two calls parallelized');
  }

  // ─── (3b) write in the MIDDLE splits two read runs (no merge across) ──────
  {
    const p = partitionOpenSwanToolCalls([
      c('tasks.list'), c('tasks.get'),          // run A
      c('save_memory'),                          // barrier (write)
      c('goals.list'), c('missions.list'),       // run B
    ]);
    assertEq(p.groups.length, 3, '(3b) run/barrier/run → 3 groups');
    assertEq(p.groups[0].parallel, true, '(3b) run A parallel');
    assertEq(JSON.stringify(p.groups[0].indices), '[0,1]', '(3b) run A indices');
    assertEq(p.groups[1].parallel, false, '(3b) barrier singleton');
    assertEq(JSON.stringify(p.groups[1].indices), '[2]', '(3b) barrier position');
    assertEq(p.groups[2].parallel, true, '(3b) run B parallel');
    assertEq(JSON.stringify(p.groups[2].indices), '[3,4]', '(3b) run B indices — never merged across the write');
    assertEq(p.parallelizableCount, 4, '(3b) 2 + 2 parallelized');
    assertEq(JSON.stringify(flat(p)), '[0,1,2,3,4]', '(3b) order preserved end-to-end');
  }

  // ─── (4) unknown tool → serial singleton (fail closed) ───────────────────
  {
    const p = partitionOpenSwanToolCalls([
      c('context.search'), c('totally.unknown.tool'), c('tasks.list'),
    ]);
    assertEq(p.groups.length, 3, '(4) unknown splits the reads');
    assertEq(p.groups[1].parallel, false, '(4) unknown → serial singleton');
    assertEq(p.parallelizableCount, 0, '(4) unknown blocks coalescing');
    assertEq(isParallelSafeOpenSwanTool('totally.unknown.tool'), false, '(4) unknown not safe');
  }

  // ─── (5) empty / degenerate → neutral value ──────────────────────────────
  {
    assertEq(JSON.stringify(partitionOpenSwanToolCalls([])), '{"groups":[],"parallelizableCount":0}', '(5) empty array neutral');
    assertEq(partitionOpenSwanToolCalls(null).groups.length, 0, '(5) null neutral');
    assertEq(partitionOpenSwanToolCalls(undefined).parallelizableCount, 0, '(5) undefined neutral');
    assertEq(partitionOpenSwanToolCalls('nope' as unknown).groups.length, 0, '(5) string neutral');
    assertEq(partitionOpenSwanToolCalls(42 as unknown).groups.length, 0, '(5) number neutral');
    assertEq(partitionOpenSwanToolCalls({ length: 3 } as unknown).groups.length, 0, '(5) array-like non-array neutral');
  }

  // ─── (6) single-call rounds ──────────────────────────────────────────────
  {
    const r = partitionOpenSwanToolCalls([c('tasks.list')]);
    assertEq(r.groups.length, 1, '(6) one read → one group');
    assertEq(r.groups[0].parallel, false, '(6) lone read is a serial singleton (size 1)');
    assertEq(r.parallelizableCount, 0, '(6) lone read gains no concurrency');
    const w = partitionOpenSwanToolCalls([c('tasks.create')]);
    assertEq(w.groups[0].parallel, false, '(6) lone write is a serial singleton');
  }

  // ─── (7) default classifier: reads safe, mutations/ask NOT ───────────────
  {
    const safe = [
      'context.search', 'codebase.search', 'coordination.file_status', 'tasks.list',
      'tasks.get', 'goals.list', 'missions.list', 'rooms.read_file', 'github.read_file',
      'search_memories', 'fetch_url', 'gmail.read', 'gcal.read', 'vault.list', 'vault.grants',
      'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.file_read', 'browser.dom_snapshot',
      'tools.search', 'todo.write', 'workspace.open_preview', 'wp.list_posts', 'skills.view',
    ];
    for (const n of safe) assert(defaultOpenSwanToolParallelSafe(n), `(7) ${n} is parallel-safe by default`);
    const unsafe = [
      'tasks.create', 'tasks.update_status', 'save_memory', 'code.generate', 'git.run',
      'local.run_shell', 'desktop.edit_file', 'desktop.file_write_text', 'desktop.launch_app',
      'browser.fill_credential_field', 'browser.click_role', 'browser.open_url', 'vault.grant', 'vault.revoke',
      'credentials.get', 'gmail.write', 'gcal.write', 'gdocs.append', 'gsheets.write',
      'messaging.notify', 'schedule_action', 'wp.create_slide', 'codebase.index',
      'workspace.create_room', 'workspace.apply_artifacts', 'skills.manage', 'circle.toggle_public',
      'team.deploy_agents', 'approvals.request', 'approvals.resolve', 'desktop.convert_image',
    ];
    for (const n of unsafe) assert(!defaultOpenSwanToolParallelSafe(n), `(7) ${n} is NOT parallel-safe by default`);
  }

  // ─── (7b) family prefix rules: verification.* safe; code.* minus generate ─
  {
    assert(defaultOpenSwanToolParallelSafe('verification.lint'), '(7b) verification.lint safe');
    assert(defaultOpenSwanToolParallelSafe('verification.typecheck'), '(7b) verification.typecheck safe');
    assert(defaultOpenSwanToolParallelSafe('code.review'), '(7b) code.review safe');
    assert(!defaultOpenSwanToolParallelSafe('code.generate'), '(7b) code.generate NOT safe (mutates)');
    // membership constant is aligned with the predicate
    assert(DEFAULT_PARALLEL_SAFE_TOOLS.has('context.search'), '(7b) constant carries a known read');
    assert(!DEFAULT_PARALLEL_SAFE_TOOLS.has('tasks.create'), '(7b) constant excludes a known write');
    assert(!DEFAULT_PARALLEL_SAFE_TOOLS.has('credentials.get'), '(7b) constant excludes the ask-gated secret read');
  }

  // ─── (8) INJECTED policyOf as a FUNCTION overrides the default ───────────
  {
    // Function policy that FLIPS defaults: mark a normally-safe read as
    // mutating (→ serial) and a normally-unknown name as a clean read (→ safe).
    const policyFn = (name: string): OpenSwanToolParallelPolicy | null => {
      if (name === 'context.search') return { mutatesState: true, approvalMode: 'auto' };   // now unsafe
      if (name === 'x.custom_read') return { mutatesState: false, approvalMode: 'auto' };    // now safe
      if (name === 'x.custom_write') return { mutates: true, approvalMode: 'ask' };          // unsafe
      return null; // fall through to default
    };
    assertEq(isParallelSafeOpenSwanTool('context.search', policyFn), false, '(8) injected policy forces read → serial');
    assertEq(isParallelSafeOpenSwanTool('x.custom_read', policyFn), true, '(8) injected policy makes unknown → safe');
    assertEq(isParallelSafeOpenSwanTool('x.custom_write', policyFn), false, '(8) injected ask policy → serial');
    // fall-through name still uses default classifier
    assertEq(isParallelSafeOpenSwanTool('tasks.list', policyFn), true, '(8) unresolved name falls back to default (safe)');

    const p = partitionOpenSwanToolCalls([
      c('x.custom_read'), c('x.custom_read'), c('context.search'), c('x.custom_read'),
    ], policyFn);
    // custom_read,custom_read (parallel) | context.search (now serial) | custom_read (serial singleton)
    assertEq(p.groups.length, 3, '(8) injected policy reshapes the partition');
    assertEq(p.groups[0].parallel, true, '(8) two injected reads coalesce');
    assertEq(JSON.stringify(p.groups[0].indices), '[0,1]', '(8) coalesced injected reads');
    assertEq(p.groups[1].parallel, false, '(8) forced-mutating read splits');
    assertEq(p.groups[2].parallel, false, '(8) trailing lone read is a singleton');
    assertEq(p.parallelizableCount, 2, '(8) only the leading pair parallelized');
  }

  // ─── (8b) INJECTED policyOf as a Map and as a Record ─────────────────────
  {
    const mapPolicy = new Map<string, OpenSwanToolParallelPolicy>([
      ['alpha', { mutatesState: false, approvalMode: 'auto' }],
      ['beta', { mutatesState: true, approvalMode: 'auto' }],
    ]);
    assertEq(isParallelSafeOpenSwanTool('alpha', mapPolicy), true, '(8b) Map read → safe');
    assertEq(isParallelSafeOpenSwanTool('beta', mapPolicy), false, '(8b) Map write → serial');
    assertEq(isParallelSafeOpenSwanTool('gamma', mapPolicy), false, '(8b) Map miss → default (unknown → serial)');

    const recPolicy: Record<string, OpenSwanToolParallelPolicy> = {
      one: { mutates: false, approvalMode: 'auto' },
      two: { approvalMode: 'ask' },
    };
    assertEq(isParallelSafeOpenSwanTool('one', recPolicy), true, '(8b) Record read → safe');
    assertEq(isParallelSafeOpenSwanTool('two', recPolicy), false, '(8b) Record ask → serial');
    // inherited Object.prototype keys must NOT resolve as policy
    assertEq(isParallelSafeOpenSwanTool('toString', recPolicy), false, '(8b) inherited proto key ignored');
    assertEq(isParallelSafeOpenSwanTool('hasOwnProperty', recPolicy), false, '(8b) proto method not treated as policy');
  }

  // ─── (8c) partial / require BOTH conditions (fail closed) ────────────────
  {
    // approvalMode present but 'ask' → unsafe even if not mutating.
    assertEq(isParallelSafeOpenSwanTool('n', (): OpenSwanToolParallelPolicy => ({ mutatesState: false, approvalMode: 'ask' })), false, '(8c) non-mutating + ask → serial');
    // not mutating, no approvalMode field → NOT auto → unsafe (fail closed).
    assertEq(isParallelSafeOpenSwanTool('n', (): OpenSwanToolParallelPolicy => ({ mutatesState: false })), false, '(8c) missing approvalMode → serial (fail closed)');
    // auto + not mutating → safe.
    assertEq(isParallelSafeOpenSwanTool('n', (): OpenSwanToolParallelPolicy => ({ mutatesState: false, approvalMode: 'auto' })), true, '(8c) auto + non-mutating → safe');
    // mutates alias respected.
    assertEq(isParallelSafeOpenSwanTool('n', (): OpenSwanToolParallelPolicy => ({ mutates: true, approvalMode: 'auto' })), false, '(8c) mutates:true alias → serial');
    // empty policy object → no usable field → default fallback (unknown → serial).
    assertEq(isParallelSafeOpenSwanTool('unknownName', () => ({})), false, '(8c) empty policy → default → serial');
    // empty policy object on a DEFAULT-safe name → falls back to default → safe.
    assertEq(isParallelSafeOpenSwanTool('tasks.list', () => ({})), true, '(8c) empty policy falls back → default safe name stays safe');
  }

  // ─── (9) large & capped input stays bounded and ordered ──────────────────
  {
    const many = Array.from({ length: 1000 }, () => c('tasks.list'));
    const p = partitionOpenSwanToolCalls(many);
    assertEq(p.groups.length, 1, '(9) 1000 reads → one group');
    assertEq(p.groups[0].indices.length, MAX_OPENSWAN_TOOL_CALLS, '(9) processing capped at MAX');
    assertEq(p.groups[0].indices[0], 0, '(9) first index 0');
    assertEq(p.groups[0].indices[MAX_OPENSWAN_TOOL_CALLS - 1], MAX_OPENSWAN_TOOL_CALLS - 1, '(9) last index at cap-1');
    assertEq(p.parallelizableCount, MAX_OPENSWAN_TOOL_CALLS, '(9) count bounded by cap');
    // alternating read/write beyond the cap: still bounded, order intact
    const alt = Array.from({ length: 800 }, (_v, i) => c(i % 2 === 0 ? 'tasks.list' : 'tasks.create'));
    const pa = partitionOpenSwanToolCalls(alt);
    assert(pa.groups.length <= MAX_OPENSWAN_TOOL_CALLS, '(9) alternating groups bounded');
    assertEq(JSON.stringify(flat(pa)), JSON.stringify(Array.from({ length: MAX_OPENSWAN_TOOL_CALLS }, (_v, i) => i)), '(9) alternating flatten is 0..cap-1');
  }

  // ─── (10) hostile / malformed inputs never throw ─────────────────────────
  try {
    // malformed call elements → each degrades to a serial singleton
    const hostile = partitionOpenSwanToolCalls([
      null, undefined, 123, 'str', true, {}, { name: 42 }, { name: '' }, [], { args: {} },
      c('tasks.list'), c('context.search'),
    ]);
    assert(hostile.groups.length >= 1, '(10) hostile input produced groups');
    // the two trailing valid reads coalesce; everything before is singletons
    const last = hostile.groups[hostile.groups.length - 1];
    assertEq(last.parallel, true, '(10) trailing valid reads still coalesce');
    assertEq(last.indices.length, 2, '(10) two trailing reads grouped');
    assertEq(JSON.stringify(flat(hostile)), JSON.stringify(Array.from({ length: 12 }, (_v, i) => i)), '(10) hostile order preserved');

    // cyclic args object — must not trip the partitioner (it never reads args)
    const cyc: Record<string, unknown> = { name: 'tasks.list' };
    cyc.self = cyc;
    assertEq(partitionOpenSwanToolCalls([cyc]).groups[0].parallel, false, '(10) cyclic-args call handled (lone read singleton)');
    assertEq(partitionOpenSwanToolCalls([cyc, cyc, cyc]).groups[0].parallel, true, '(10) cyclic-args reads coalesce');

    // throwing `name` getter → treated as unknown → serial singleton
    const boobyTrap = { get name(): string { throw new Error('boom'); }, args: {} };
    assertEq(partitionOpenSwanToolCalls([boobyTrap]).groups.length, 1, '(10) throwing name getter handled');
    assertEq(partitionOpenSwanToolCalls([boobyTrap]).groups[0].parallel, false, '(10) throwing getter → serial singleton');

    // hostile policyOf: a function that throws, and a Map whose get throws
    const throwingFn = () => { throw new Error('policy boom'); };
    assertEq(isParallelSafeOpenSwanTool('tasks.list', throwingFn), true, '(10) throwing policy fn → default fallback');
    const throwingMap = { get: () => { throw new Error('map boom'); } };
    assertEq(isParallelSafeOpenSwanTool('tasks.list', throwingMap), true, '(10) throwing policy map → default fallback');
    assertEq(isParallelSafeOpenSwanTool('unknownX', throwingFn), false, '(10) throwing policy + unknown → serial');

    // hostile policyOf returning junk types
    assertEq(isParallelSafeOpenSwanTool('tasks.list', () => 'not-a-policy'), true, '(10) junk policy return → default fallback');
    assertEq(isParallelSafeOpenSwanTool('tasks.list', () => null), true, '(10) null policy return → default fallback');
    assertEq(isParallelSafeOpenSwanTool('tasks.list', 12345), true, '(10) numeric policyOf ignored → default');

    // predicate totality on junk names
    assertEq(isParallelSafeOpenSwanTool(null), false, '(10) null name → false');
    assertEq(isParallelSafeOpenSwanTool(undefined), false, '(10) undefined name → false');
    assertEq(isParallelSafeOpenSwanTool(42 as unknown), false, '(10) numeric name → false');
    assertEq(isParallelSafeOpenSwanTool('' as unknown), false, '(10) empty name → false');
    assertEq(defaultOpenSwanToolParallelSafe(null), false, '(10) default null name → false');
    assertEq(defaultOpenSwanToolParallelSafe({} as unknown), false, '(10) default object name → false');

    // huge tool name string must not throw or hang
    const huge = 'x'.repeat(200_000);
    assertEq(isParallelSafeOpenSwanTool(huge), false, '(10) huge unknown name → false');
    assertEq(partitionOpenSwanToolCalls([c(huge)]).groups[0].parallel, false, '(10) huge name → serial singleton');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) hostile inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (11) realistic read-heavy round: big wall-clock win ─────────────────
  {
    // Model opens a task with a burst of reads, then one gated write.
    const round = [
      c('context.search'), c('codebase.search'), c('coordination.file_status'),
      c('desktop.read_a11y_tree'), c('tasks.list'), c('git.run'),
    ];
    const p = partitionOpenSwanToolCalls(round);
    assertEq(p.groups.length, 2, '(11) five reads + one write → 2 groups');
    assertEq(p.groups[0].parallel, true, '(11) the five reads run concurrently');
    assertEq(p.groups[0].indices.length, 5, '(11) all five reads coalesced');
    assertEq(p.groups[1].parallel, false, '(11) git.run stays a serial singleton');
    assertEq(p.parallelizableCount, 5, '(11) five calls gained concurrency');
    assertEq(JSON.stringify(flat(p)), '[0,1,2,3,4,5]', '(11) order preserved (write last)');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll openswan-parallel-tool-core smoke cases passed (${passes} passed).`);
}

main();
