/**
 * office-run-drawer-focus-core-smoketest — the tiny pure deep-link seam
 * (src/lib/officeRunDrawerFocusCore.ts) between Office blocked-run attention
 * items (ChatAttentionItem.refId = run id for `open_run`) and the Run History
 * drawer's optional initialRunId prop. Load-bearing assertions:
 *
 *   RESOLUTION: refId present + loaded → {refId, 'focused'}; refId present but
 *   not in the loaded first page (or the id list is missing/not an array) →
 *   {null, 'not_loaded'} so the drawer knows it must resolve the id directly;
 *   missing/empty/non-string refId → {null, 'no_ref'}.
 *
 *   DRAWER FALLBACK: a first-page miss fetches the exact run, validates its
 *   circle, prepends/selects it, or renders unavailable without selecting a
 *   different run. No-ref callers retain the legacy first-run default.
 *
 *   And: total — degenerate/hostile/cyclic input never throws.
 *
 * Pure — loads under tsx (officeRunDrawerFocusCore has zero imports).
 */

import { readFileSync } from 'node:fs';
import { resolveRunDrawerFocus } from '../src/lib/officeRunDrawerFocusCore';

const drawerSource = readFileSync('src/components/chat/RunHistoryDrawer.tsx', 'utf8');

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertResult(
  actual: { focusRunId: string | null; reason: string },
  focusRunId: string | null,
  reason: string,
  msg: string,
): void {
  assert(
    actual.focusRunId === focusRunId && actual.reason === reason,
    msg,
    `got ${JSON.stringify(actual)} want ${JSON.stringify({ focusRunId, reason })}`,
  );
}

function main(): void {
  const ids = ['run-1', 'run-2', 'run-3'];

  // ── Group 1: happy path ────────────────────────────────────────────────────
  assertResult(resolveRunDrawerFocus({ refId: 'run-2', availableRunIds: ids }), 'run-2', 'focused',
    '(1) loaded refId focuses');
  assertResult(resolveRunDrawerFocus({ refId: 'run-1', availableRunIds: ids }), 'run-1', 'focused',
    '(1) first id focuses too');
  assertResult(resolveRunDrawerFocus({ refId: '  run-3  ', availableRunIds: ids }), 'run-3', 'focused',
    '(1) refId is trimmed before matching');

  // ── Group 2: not loaded in the first page ──────────────────────────────────
  assertResult(resolveRunDrawerFocus({ refId: 'run-99', availableRunIds: ids }), null, 'not_loaded',
    '(2) unknown run → not_loaded (drawer resolves exact id)');
  assertResult(resolveRunDrawerFocus({ refId: 'run-1', availableRunIds: [] }), null, 'not_loaded',
    '(2) empty page → not_loaded');
  assertResult(resolveRunDrawerFocus({ refId: 'run-1' }), null, 'not_loaded',
    '(2) missing id list → not_loaded');
  assertResult(resolveRunDrawerFocus({ refId: 'run-1', availableRunIds: 'run-1' as never }), null, 'not_loaded',
    '(2) non-array id list → not_loaded');
  assertResult(resolveRunDrawerFocus({ refId: 'RUN-1', availableRunIds: ids }), null, 'not_loaded',
    '(2) match is exact (case-sensitive ids)');
  assertResult(resolveRunDrawerFocus({ refId: 'run-1', availableRunIds: [null, 42, { id: 'run-1' }] as never }),
    null, 'not_loaded', '(2) non-string entries never match');

  // ── Group 3: no ref ────────────────────────────────────────────────────────
  assertResult(resolveRunDrawerFocus({ refId: null, availableRunIds: ids }), null, 'no_ref', '(3) null refId');
  assertResult(resolveRunDrawerFocus({ refId: undefined, availableRunIds: ids }), null, 'no_ref', '(3) undefined refId');
  assertResult(resolveRunDrawerFocus({ availableRunIds: ids }), null, 'no_ref', '(3) missing refId');
  assertResult(resolveRunDrawerFocus({ refId: '', availableRunIds: ids }), null, 'no_ref', '(3) empty refId');
  assertResult(resolveRunDrawerFocus({ refId: '   ', availableRunIds: ids }), null, 'no_ref', '(3) whitespace refId');
  assertResult(resolveRunDrawerFocus({ refId: 42 as never, availableRunIds: ids }), null, 'no_ref', '(3) non-string refId');

  // ── Group 4: totality ──────────────────────────────────────────────────────
  let threw = false;
  try {
    resolveRunDrawerFocus();
    resolveRunDrawerFocus(undefined);
    resolveRunDrawerFocus(null as never);
    resolveRunDrawerFocus(42 as never);
    const cyclic: Record<string, unknown> = {};
    cyclic.refId = cyclic;
    cyclic.availableRunIds = cyclic;
    resolveRunDrawerFocus(cyclic as never);
  } catch {
    threw = true;
  }
  assert(!threw, '(4) degenerate/hostile/cyclic input never throws');
  assertResult(resolveRunDrawerFocus(), null, 'no_ref', '(4) no-arg call → no_ref');
  assertResult(resolveRunDrawerFocus(null as never), null, 'no_ref', '(4) null input → no_ref');

  // ── Group 5: exact first-page miss handling in the React drawer ───────────
  const exactFocusStart = drawerSource.indexOf('if (shouldApplyInitial) {');
  const exactFocusEnd = drawerSource.indexOf('\n        setRuns(nextRuns);', exactFocusStart);
  const exactFocusBlock = exactFocusStart >= 0 && exactFocusEnd > exactFocusStart
    ? drawerSource.slice(exactFocusStart, exactFocusEnd)
    : '';
  assert(drawerSource.includes('getRun,'), '(5) drawer imports canonical getRun');
  assert(
    exactFocusBlock.includes('await getRun(requestedInitialRunId, strictReadOptions)'),
    '(5) first-page miss fetches the exact requested id',
  );
  assert(
    exactFocusBlock.includes('exactRun?.circle_id === circleId'),
    '(5) exact result is accepted only inside the current circle',
  );
  assert(
    exactFocusBlock.includes('[exactRun, ...nextRuns.filter((run) => run.id !== exactRun.id)]')
      && exactFocusBlock.includes('.slice(0, RUN_DRAWER_PAGE_LIMIT)'),
    '(5) exact result is prepended without breaking the history bound',
  );
  assert(
    exactFocusBlock.includes('setUnavailableInitialRunId(requestedInitialRunId)')
      && exactFocusBlock.includes('setSelectedRunId(null)')
      && !exactFocusBlock.includes('nextRuns[0]'),
    '(5) unavailable exact id never substitutes the newest run',
  );
  assert(
    drawerSource.includes('RUN UNAVAILABLE')
      && drawerSource.includes('is not available in this circle'),
    '(5) unavailable exact id renders bounded user-facing copy',
  );
  assert(
    /setSelectedRunId\(\(current\) => \([\s\S]{0,180}current && nextRuns\.some\(\(run\) => run\.id === current\)[\s\S]{0,120}: nextRuns\[0\]\?\.id \|\| null/.test(drawerSource),
    '(5) no-ref callers preserve legacy first-run selection',
  );

  console.log(`office-run-drawer-focus-core smoketest: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
