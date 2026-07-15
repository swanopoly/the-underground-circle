/**
 * client-tool-batch-core-smoketest — pins the pure client-tool batch
 * partitioner (src/lib/clientToolBatchCore.ts) that lets the SwanBot v2
 * client-tool continuation path (`executeClientToolCalls` in
 * src/lib/swanbot.ts) dispatch consecutive read-only client tools in
 * parallel while keeping strict serial order for everything else.
 *
 * Load-bearing assertions:
 *   ALLOWLIST: READONLY_CLIENT_TOOLS contains exactly the 20 side-effect-
 *   free client tools (desktop/browser/codebase/coordination reads) and
 *   NONE of the mutating tools (edit_file, run_shell, git.run,
 *   clipboard_write/clear, launch_app, browser.click/fill, tasks.create).
 *
 *   MEMBERSHIP: isReadOnlyClientTool is strict — exact catalog names only;
 *   wrong type, casing, whitespace, or unknown names fail closed (false).
 *
 *   PARTITION: consecutive reads coalesce into one parallel group; every
 *   non-read/unknown/malformed call is its own singleton group; group
 *   order preserves input order so a write never reorders past any other
 *   call and groups.flat() mirrors the input sequence; parallelizable
 *   counts only calls in groups of size > 1; id/name are projected to
 *   bounded strings; input processing caps at MAX_CLIENT_TOOL_BATCH_CALLS.
 *
 *   And: every export is total — degenerate/adversarial input (null,
 *   undefined, {}, [], wrong types, throwing getters, huge arrays) never
 *   throws.
 *
 * Pure — loads under tsx (clientToolBatchCore has zero runtime imports).
 */

import {
  READONLY_CLIENT_TOOLS,
  MAX_CLIENT_TOOL_BATCH_CALLS,
  isReadOnlyClientTool,
  partitionClientToolBatch,
  type ToolBatchCall,
} from '../src/lib/clientToolBatchCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: compact shape signature of a partition, e.g. "2|1|3". */
function shapeOf(groups: ToolBatchCall[][]): string {
  return groups.map((g) => g.length).join('|');
}

/** Helper: flattened id sequence, e.g. "a,b,c". */
function flatIds(groups: ToolBatchCall[][]): string {
  return groups.flat().map((c) => c.id).join(',');
}

const call = (id: string, name: string) => ({ id, name, input: {} });

function main(): void {
  // ─── (1) READONLY_CLIENT_TOOLS allowlist — exact membership ──────────────
  const expectedReads = [
    'desktop.file_read',
    'desktop.file_list',
    'desktop.file_search',
    'desktop.file_stat',
    'desktop.list_running_apps',
    'desktop.list_installed_apps',
    'desktop.list_browser_tabs',
    'desktop.window_state',
    'desktop.clipboard',
    'desktop.screen_size',
    'desktop.screenshot',
    'desktop.read_a11y_tree',
    'desktop.observe_app',
    'desktop.wait_for_app',
    'desktop.app_reachability',
    'browser.dom_snapshot',
    'browser.verification_state',
    'browser.screenshot',
    'codebase.search',
    'coordination.file_status',
  ];
  for (const name of expectedReads) {
    assert(READONLY_CLIENT_TOOLS.has(name), `(1) allowlist contains ${name}`);
  }
  assertEq(READONLY_CLIENT_TOOLS.size, expectedReads.length, '(1) allowlist has exactly the expected 20 tools');

  const mutators = [
    'desktop.edit_file',
    'local.run_shell',
    'git.run',
    'desktop.clipboard_write',
    'desktop.clipboard_clear',
    'desktop.launch_app',
    'browser.click',
    'browser.fill',
    'tasks.create',
  ];
  for (const name of mutators) {
    assert(!READONLY_CLIENT_TOOLS.has(name), `(1) allowlist excludes mutating tool ${name}`);
  }

  // ─── (2) isReadOnlyClientTool — strict, fail-closed ──────────────────────
  assertEq(isReadOnlyClientTool('desktop.read_a11y_tree'), true, '(2) a11y tree read is read-only');
  assertEq(isReadOnlyClientTool('browser.dom_snapshot'), true, '(2) dom snapshot is read-only');
  assertEq(isReadOnlyClientTool('coordination.file_status'), true, '(2) coordination file_status is read-only');
  assertEq(isReadOnlyClientTool('desktop.edit_file'), false, '(2) edit_file is NOT read-only');
  assertEq(isReadOnlyClientTool('local.run_shell'), false, '(2) run_shell is NOT read-only');
  assertEq(isReadOnlyClientTool('git.run'), false, '(2) git.run is NOT read-only');
  assertEq(isReadOnlyClientTool('desktop.file_read '), false, '(2) trailing whitespace fails closed');
  assertEq(isReadOnlyClientTool('DESKTOP.FILE_READ'), false, '(2) casing mismatch fails closed');
  assertEq(isReadOnlyClientTool(''), false, '(2) empty string fails closed');
  assertEq(isReadOnlyClientTool('desktop.totally_new_tool'), false, '(2) unknown tool fails closed');
  assertEq(isReadOnlyClientTool(null), false, '(2) null fails closed');
  assertEq(isReadOnlyClientTool(undefined), false, '(2) undefined fails closed');
  assertEq(isReadOnlyClientTool(42), false, '(2) number fails closed');
  assertEq(isReadOnlyClientTool({}), false, '(2) object fails closed');
  assertEq(isReadOnlyClientTool(['desktop.file_read']), false, '(2) array-wrapped name fails closed');

  // ─── (3) all-reads batch → one parallel group ────────────────────────────
  const r3 = partitionClientToolBatch([
    call('a', 'desktop.read_a11y_tree'),
    call('b', 'desktop.list_running_apps'),
    call('c', 'desktop.screenshot'),
  ]);
  assertEq(shapeOf(r3.groups), '3', '(3) three consecutive reads coalesce into one group');
  assertEq(r3.parallelizable, 3, '(3) all three calls counted as parallelizable');
  assertEq(flatIds(r3.groups), 'a,b,c', '(3) in-group order preserves emission order');
  assertEq(r3.groups[0][1].name, 'desktop.list_running_apps', '(3) projected name preserved');

  // ─── (4) all-writes batch → singleton groups, zero parallelism ───────────
  const r4 = partitionClientToolBatch([
    call('w1', 'desktop.edit_file'),
    call('w2', 'local.run_shell'),
    call('w3', 'git.run'),
  ]);
  assertEq(shapeOf(r4.groups), '1|1|1', '(4) writes never coalesce');
  assertEq(r4.parallelizable, 0, '(4) singleton groups contribute zero parallelizable');
  assertEq(flatIds(r4.groups), 'w1,w2,w3', '(4) write order untouched');

  // ─── (5) mixed batch — reads coalesce, writes are barriers ───────────────
  const r5 = partitionClientToolBatch([
    call('r1', 'desktop.read_a11y_tree'),
    call('r2', 'desktop.window_state'),
    call('w1', 'desktop.clipboard_write'),
    call('r3', 'desktop.clipboard'),
    call('w2', 'desktop.edit_file'),
    call('r4', 'desktop.file_read'),
    call('r5', 'desktop.file_stat'),
    call('r6', 'browser.screenshot'),
  ]);
  assertEq(shapeOf(r5.groups), '2|1|1|1|3', '(5) mixed batch partitions as 2|1|1|1|3');
  assertEq(r5.parallelizable, 5, '(5) parallelizable counts only size>1 group members (2+3)');
  assertEq(flatIds(r5.groups), 'r1,r2,w1,r3,w2,r4,r5,r6', '(5) flattened groups mirror input order exactly');
  assertEq(r5.groups[1][0].id, 'w1', '(5) clipboard_write stays a singleton at its original position');
  assertEq(r5.groups[2][0].id, 'r3', '(5) read AFTER a write does not merge backward across it');

  // ─── (6) single-call batches ──────────────────────────────────────────────
  const r6a = partitionClientToolBatch([call('solo', 'desktop.screenshot')]);
  assertEq(shapeOf(r6a.groups), '1', '(6) lone read is one group of one');
  assertEq(r6a.parallelizable, 0, '(6) group of one is not parallelizable');
  const r6b = partitionClientToolBatch([call('solo', 'desktop.edit_file')]);
  assertEq(shapeOf(r6b.groups), '1', '(6) lone write is one group of one');
  assertEq(r6b.parallelizable, 0, '(6) lone write not parallelizable');

  // ─── (7) unknown tool splits a read run (fail closed) ────────────────────
  const r7 = partitionClientToolBatch([
    call('r1', 'desktop.file_read'),
    call('u1', 'desktop.some_future_tool'),
    call('r2', 'desktop.file_list'),
  ]);
  assertEq(shapeOf(r7.groups), '1|1|1', '(7) unknown name is a barrier singleton');
  assertEq(r7.parallelizable, 0, '(7) no parallelism across an unknown tool');
  assertEq(flatIds(r7.groups), 'r1,u1,r2', '(7) unknown tool keeps its position');

  // ─── (8) never reorder a write past another call (invariant) ─────────────
  const seq = [
    call('a', 'desktop.observe_app'),
    call('b', 'desktop.edit_file'),
    call('c', 'desktop.observe_app'),
    call('d', 'desktop.edit_file'),
    call('e', 'desktop.app_reachability'),
    call('f', 'desktop.wait_for_app'),
  ];
  const r8 = partitionClientToolBatch(seq);
  assertEq(flatIds(r8.groups), 'a,b,c,d,e,f', '(8) flatten(groups) == input order (no reordering ever)');
  assertEq(shapeOf(r8.groups), '1|1|1|1|2', '(8) observe/act/observe alternation partitions correctly');
  const flatCount8 = r8.groups.reduce((n, g) => n + g.length, 0);
  assertEq(flatCount8, seq.length, '(8) no call dropped, no call duplicated');

  // ─── (9) projection: id/name coercion + bounding ─────────────────────────
  const longName = 'desktop.' + 'x'.repeat(500);
  const r9 = partitionClientToolBatch([
    { id: 'ok', name: 'desktop.screenshot' },
    { id: 123, name: 'desktop.edit_file' },
    { id: 'long', name: longName },
    { name: 'desktop.file_read' },
  ]);
  assertEq(shapeOf(r9.groups), '1|1|1|1', '(9) long/unknown names stay singleton');
  assertEq(r9.groups[1][0].id, '', '(9) non-string id coerced to empty string');
  assert(r9.groups[2][0].name.length <= 200, '(9) oversized name capped', `len ${r9.groups[2][0].name.length}`);
  assertEq(r9.groups[3][0].id, '', '(9) missing id coerced to empty string');
  assertEq(r9.groups[3][0].name, 'desktop.file_read', '(9) valid name survives projection');

  // ─── (10) huge input capped at MAX_CLIENT_TOOL_BATCH_CALLS ───────────────
  const huge = Array.from({ length: MAX_CLIENT_TOOL_BATCH_CALLS + 100 }, (_, i) =>
    call(`h${i}`, 'desktop.file_stat'));
  const r10 = partitionClientToolBatch(huge);
  const flatCount10 = r10.groups.reduce((n, g) => n + g.length, 0);
  assertEq(flatCount10, MAX_CLIENT_TOOL_BATCH_CALLS, '(10) processing capped at MAX_CLIENT_TOOL_BATCH_CALLS');
  assertEq(r10.groups.length, 1, '(10) capped all-read run is still one group');
  assertEq(r10.parallelizable, MAX_CLIENT_TOOL_BATCH_CALLS, '(10) capped run fully parallelizable');
  assert(MAX_CLIENT_TOOL_BATCH_CALLS >= 40, '(10) cap comfortably covers the real ~40-call rounds');

  // ─── (11) degenerate top-level input → neutral empty partition ───────────
  for (const bad of [null, undefined, {}, 'not-an-array', 42, true, () => []] as unknown[]) {
    const r = partitionClientToolBatch(bad);
    assertEq(r.groups.length, 0, `(11) non-array input ${String(bad)} → empty groups`);
    assertEq(r.parallelizable, 0, `(11) non-array input ${String(bad)} → zero parallelizable`);
  }
  const rEmpty = partitionClientToolBatch([]);
  assertEq(rEmpty.groups.length, 0, '(11) empty array → empty groups');
  assertEq(rEmpty.parallelizable, 0, '(11) empty array → zero parallelizable');

  // ─── (12) degenerate ELEMENTS are kept as serial singletons ──────────────
  const r12 = partitionClientToolBatch([
    null,
    call('r1', 'desktop.file_read'),
    undefined,
    7,
    'desktop.file_read',
    call('r2', 'desktop.file_list'),
    call('r3', 'desktop.file_search'),
  ]);
  assertEq(shapeOf(r12.groups), '1|1|1|1|1|2', '(12) malformed elements are singleton barriers');
  const flatCount12 = r12.groups.reduce((n, g) => n + g.length, 0);
  assertEq(flatCount12, 7, '(12) every input element lands in exactly one group (positional zip safe)');
  assertEq(r12.groups[0][0].id, '', '(12) null element projects to empty id');
  assertEq(r12.groups[0][0].name, '', '(12) null element projects to empty name');
  assertEq(r12.parallelizable, 2, '(12) only the trailing read pair parallelizes');

  // ─── (13) totality: throw degenerate input at every export ───────────────
  const degenerates: unknown[] = [
    null, undefined, {}, [], '', 'x', 0, 42, -1, NaN, true, false,
    () => { throw new Error('never called'); },
    Symbol('sym'),
    { id: null, name: null },
    [[]],
    [[call('n', 'desktop.file_read')]],
    [{ get id() { throw new Error('boom-id'); }, get name() { throw new Error('boom-name'); } }],
    [Object.create(null)],
    new Array(10000).fill({ id: 'a', name: 'desktop.screenshot' }),
  ];
  for (const d of degenerates) {
    try {
      isReadOnlyClientTool(d);
      partitionClientToolBatch(d);
      READONLY_CLIENT_TOOLS.has(d as string);
      passes += 1;
    } catch (err) {
      failures += 1;
      console.error(`FAIL: (13) export threw on degenerate input :: ${String(err)}`);
    }
  }
  // Throwing-getter element must degrade to a serial singleton, not throw.
  const rTrap = partitionClientToolBatch([
    { get id() { throw new Error('boom'); }, get name() { throw new Error('boom'); } },
    call('r1', 'desktop.file_read'),
  ]);
  assertEq(shapeOf(rTrap.groups), '1|1', '(13) throwing-getter element degrades to serial singleton');
  assertEq(rTrap.groups[0][0].name, '', '(13) throwing getter projects to empty name');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll client-tool-batch-core smoke cases passed (${passes} passed).`);
}

main();
