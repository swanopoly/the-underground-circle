// Smoke test for src/lib/planDiffCore.ts — run with: npx tsx scripts/plan-diff-core-smoketest.ts
// Pure module (zero runtime imports), so tsx/esbuild can load it directly.

import {
  diffPlans,
  renderPlanDiff,
  type DiffPlan,
  type DiffPlanStep,
} from '../src/lib/planDiffCore';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function step(id: string, extra: Partial<DiffPlanStep> = {}): DiffPlanStep {
  return { id, title: extra.title ?? `T-${id}`, status: extra.status ?? 'pending', ...extra };
}

function plan(steps: DiffPlanStep[], meta: Partial<DiffPlan> = {}): DiffPlan {
  return { steps, ...meta };
}

// ── 1. Identical plans → all empty + reordered false ──────────────────────────
{
  const p = plan([step('a'), step('b'), step('c')]);
  const d = diffPlans(p, plan([step('a'), step('b'), step('c')]));
  assert('identical: no added', d.added.length === 0);
  assert('identical: no removed', d.removed.length === 0);
  assert('identical: no changed', d.changed.length === 0);
  assert('identical: not reordered', d.reordered === false);
  assert('identical: summary', d.summary === '+0 -0 ~0');
}

// ── 2. Pure add ───────────────────────────────────────────────────────────────
{
  const before = plan([step('a'), step('b')]);
  const after = plan([step('a'), step('b'), step('c')]);
  const d = diffPlans(before, after);
  assert('add: one added', d.added.length === 1 && d.added[0] === 'c');
  assert('add: none removed', d.removed.length === 0);
  assert('add: none changed', d.changed.length === 0);
  assert('add: not reordered', d.reordered === false);
  assert('add: summary', d.summary === '+1 -0 ~0');
}

// ── 3. Pure remove ────────────────────────────────────────────────────────────
{
  const before = plan([step('a'), step('b'), step('c')]);
  const after = plan([step('a'), step('c')]);
  const d = diffPlans(before, after);
  assert('remove: one removed', d.removed.length === 1 && d.removed[0] === 'b');
  assert('remove: none added', d.added.length === 0);
  assert('remove: none changed', d.changed.length === 0);
  assert('remove: not reordered (common order intact)', d.reordered === false);
  assert('remove: summary', d.summary === '+0 -1 ~0');
}

// ── 4. Title-only change ──────────────────────────────────────────────────────
{
  const before = plan([step('a', { title: 'Old' })]);
  const after = plan([step('a', { title: 'New' })]);
  const d = diffPlans(before, after);
  assert('title: one changed', d.changed.length === 1);
  assert('title: kind is title only', d.changed[0].kinds.length === 1 && d.changed[0].kinds[0] === 'title');
  assert('title: no status kind', !d.changed[0].kinds.includes('status'));
  assert('title: detail mentions arrow', (d.changed[0].detail ?? '').includes('→'));
  assert('title: before/after populated', d.changed[0].before?.title === 'Old' && d.changed[0].after?.title === 'New');
  assert('title: summary', d.summary === '+0 -0 ~1');
}

// ── 5. Status-only change ─────────────────────────────────────────────────────
{
  const before = plan([step('a', { status: 'pending' })]);
  const after = plan([step('a', { status: 'done' })]);
  const d = diffPlans(before, after);
  assert('status: one changed', d.changed.length === 1);
  assert('status: kind is status only', d.changed[0].kinds.length === 1 && d.changed[0].kinds[0] === 'status');
  assert('status: title unchanged not flagged', !d.changed[0].kinds.includes('title'));
}

// ── 6. Files set change (order-insensitive) ───────────────────────────────────
{
  // Same set, different order → NO change.
  const before = plan([step('a', { files: ['x.ts', 'y.ts'] })]);
  const afterSameSet = plan([step('a', { files: ['y.ts', 'x.ts'] })]);
  const dSame = diffPlans(before, afterSameSet);
  assert('files: reorder of same set is NOT a change', dSame.changed.length === 0);

  // Different set → change flagged as files.
  const afterDiff = plan([step('a', { files: ['x.ts', 'z.ts'] })]);
  const dDiff = diffPlans(before, afterDiff);
  assert('files: differing set is a change', dDiff.changed.length === 1);
  assert('files: kind is files', dDiff.changed[0].kinds.includes('files'));
  assert('files: only files kind', dDiff.changed[0].kinds.length === 1);

  // Added file (length differs).
  const afterAddFile = plan([step('a', { files: ['x.ts', 'y.ts', 'z.ts'] })]);
  const dAdd = diffPlans(before, afterAddFile);
  assert('files: extra file is a change', dAdd.changed.length === 1 && dAdd.changed[0].kinds.includes('files'));

  // Duplicate entries within one step collapse to a set (dupes ignored).
  const beforeDup = plan([step('a', { files: ['x.ts', 'x.ts', 'y.ts'] })]);
  const afterDedup = plan([step('a', { files: ['x.ts', 'y.ts'] })]);
  const dDup = diffPlans(beforeDup, afterDedup);
  assert('files: duplicate entries collapse to set (no change)', dDup.changed.length === 0);
}

// ── 7. Deps change (order-insensitive set) ────────────────────────────────────
{
  const before = plan([step('b', { dependsOn: ['a'] })]);
  const after = plan([step('b', { dependsOn: ['a', 'c'] })]);
  const d = diffPlans(before, after);
  assert('deps: one changed', d.changed.length === 1);
  assert('deps: kind is deps', d.changed[0].kinds.includes('deps'));

  // Same deps, different order → no change.
  const beforeDeps = plan([step('b', { dependsOn: ['a', 'c'] })]);
  const afterDepsReorder = plan([step('b', { dependsOn: ['c', 'a'] })]);
  const dReorder = diffPlans(beforeDeps, afterDepsReorder);
  assert('deps: reorder of same set is NOT a change', dReorder.changed.length === 0);
}

// ── 8. Multi-field change (title + status + files + deps) ─────────────────────
{
  const before = plan([step('a', { title: 'A', status: 'pending', files: ['a.ts'], dependsOn: ['x'] })]);
  const after = plan([step('a', { title: 'B', status: 'done', files: ['b.ts'], dependsOn: ['y'] })]);
  const d = diffPlans(before, after);
  assert('multi: one changed', d.changed.length === 1);
  const kinds = d.changed[0].kinds;
  assert('multi: title flagged', kinds.includes('title'));
  assert('multi: status flagged', kinds.includes('status'));
  assert('multi: files flagged', kinds.includes('files'));
  assert('multi: deps flagged', kinds.includes('deps'));
  assert('multi: exactly four kinds', kinds.length === 4);
  assert('multi: no added/removed/unchanged in kinds', !kinds.includes('added') && !kinds.includes('unchanged'));
}

// ── 9. Reorder detection (same ids, different order) ──────────────────────────
{
  const before = plan([step('a'), step('b'), step('c')]);
  const after = plan([step('c'), step('a'), step('b')]);
  const d = diffPlans(before, after);
  assert('reorder: detected', d.reordered === true);
  assert('reorder: nothing added', d.added.length === 0);
  assert('reorder: nothing removed', d.removed.length === 0);
  assert('reorder: nothing changed (fields equal)', d.changed.length === 0);
  assert('reorder: summary has marker', d.summary === '+0 -0 ~0 · reordered');
}

// ── 10. Reorder ignores added/removed positions (common-only sequence) ────────
{
  // Insert a new step 'z' at the front but keep a,b,c in the same relative order.
  const before = plan([step('a'), step('b'), step('c')]);
  const after = plan([step('z'), step('a'), step('b'), step('c')]);
  const d = diffPlans(before, after);
  assert('reorder+add: added z', d.added.length === 1 && d.added[0] === 'z');
  assert('reorder+add: common order intact → not reordered', d.reordered === false);
  assert('reorder+add: summary', d.summary === '+1 -0 ~0');
}

// ── 11. Combined summary counts (+2 -1 ~3 · reordered) ────────────────────────
{
  const before = plan([
    step('a', { title: 'A0' }),
    step('b', { status: 'pending' }),
    step('c', { files: ['c.ts'] }),
    step('d'), // will be removed
  ]);
  const after = plan([
    step('e'), // added
    step('c', { files: ['c2.ts'] }), // changed (files) + moved earlier
    step('b', { status: 'done' }), // changed (status)
    step('a', { title: 'A1' }), // changed (title)
    step('f'), // added
  ]);
  const d = diffPlans(before, after);
  assert('combined: 2 added', d.added.length === 2);
  assert('combined: added sorted (e,f)', d.added[0] === 'e' && d.added[1] === 'f');
  assert('combined: 1 removed (d)', d.removed.length === 1 && d.removed[0] === 'd');
  assert('combined: 3 changed', d.changed.length === 3);
  assert('combined: changed sorted by id (a,b,c)', d.changed.map((c) => c.id).join(',') === 'a,b,c');
  assert('combined: reordered', d.reordered === true);
  assert('combined: summary exact', d.summary === '+2 -1 ~3 · reordered');
}

// ── 12. Missing / empty steps arrays are safe ─────────────────────────────────
{
  const dEmpty = diffPlans(plan([]), plan([]));
  assert('empty: both empty → no changes', dEmpty.added.length === 0 && dEmpty.removed.length === 0 && dEmpty.changed.length === 0);
  assert('empty: not reordered', dEmpty.reordered === false);
  assert('empty: summary', dEmpty.summary === '+0 -0 ~0');

  const dFromEmpty = diffPlans(plan([]), plan([step('a')]));
  assert('empty→one: added a', dFromEmpty.added.length === 1 && dFromEmpty.added[0] === 'a');

  const dToEmpty = diffPlans(plan([step('a')]), plan([]));
  assert('one→empty: removed a', dToEmpty.removed.length === 1 && dToEmpty.removed[0] === 'a');

  // Missing steps property entirely (bad input).
  const dMissing = diffPlans({} as unknown as DiffPlan, {} as unknown as DiffPlan);
  assert('missing steps: safe empty diff', dMissing.added.length === 0 && dMissing.removed.length === 0 && dMissing.reordered === false);
}

// ── 13. Fully malformed inputs never throw ────────────────────────────────────
{
  let threw = false;
  try {
    // null / undefined / non-object / wrong-typed steps
    diffPlans(null as unknown as DiffPlan, undefined as unknown as DiffPlan);
    diffPlans({ steps: 'nope' } as unknown as DiffPlan, { steps: 42 } as unknown as DiffPlan);
    diffPlans({ steps: [null, 5, 'x', {}] } as unknown as DiffPlan, { steps: [{ id: '' }] } as unknown as DiffPlan);
  } catch {
    threw = true;
  }
  assert('malformed: never throws', threw === false);

  // Steps without a usable id are dropped (no id, empty id, whitespace id).
  const dNoId = diffPlans(
    plan([]),
    { steps: [{ id: '' }, { id: '   ' }, {}, { id: 'ok', title: 'T', status: 's' }] } as unknown as DiffPlan,
  );
  assert('malformed: only valid-id step survives', dNoId.added.length === 1 && dNoId.added[0] === 'ok');
}

// ── 14. Duplicate ids: last wins, deterministic ───────────────────────────────
{
  // Duplicate id in "after" — the LAST occurrence defines the step.
  const before = plan([step('a', { title: 'orig' })]);
  const after = plan([step('a', { title: 'first' }), step('a', { title: 'LAST' })]);
  const d = diffPlans(before, after);
  assert('dup: single changed entry for a', d.changed.length === 1 && d.changed[0].id === 'a');
  assert('dup: last occurrence wins', d.changed[0].after?.title === 'LAST');
  assert('dup: not counted as added', d.added.length === 0);

  // Duplicate id where last occurrence equals before → no change.
  const before2 = plan([step('a', { status: 'done' })]);
  const after2 = plan([step('a', { status: 'pending' }), step('a', { status: 'done' })]);
  const d2 = diffPlans(before2, after2);
  assert('dup: last-equals-before → no change', d2.changed.length === 0);

  // Determinism: running twice yields identical output.
  const runA = JSON.stringify(diffPlans(before, after));
  const runB = JSON.stringify(diffPlans(before, after));
  assert('dup: deterministic across runs', runA === runB);
}

// ── 15. Whitespace-only title/status differences are not changes (trimmed) ────
{
  const before = plan([step('a', { title: 'Hello', status: 'done' })]);
  const after = plan([step('a', { title: '  Hello  ', status: ' done ' })]);
  const d = diffPlans(before, after);
  assert('trim: whitespace-only diffs are not changes', d.changed.length === 0);
}

// ── 16. renderPlanDiff is deterministic + human-readable ──────────────────────
{
  const before = plan([step('a', { title: 'A0' }), step('b'), step('gone')]);
  const after = plan([step('new'), step('b'), step('a', { title: 'A1' })]);
  const d = diffPlans(before, after);
  const r1 = renderPlanDiff(d);
  const r2 = renderPlanDiff(d);
  assert('render: deterministic', r1 === r2);
  assert('render: has summary header', r1.startsWith('Plan diff: '));
  assert('render: shows added', r1.includes('+ added: new'));
  assert('render: shows removed', r1.includes('- removed: gone'));
  assert('render: shows changed a', r1.includes('~ changed: a'));
  assert('render: shows reorder marker', r1.includes('reordered'));

  // Empty diff renders a "(no step changes)" hint.
  const rEmpty = renderPlanDiff(diffPlans(plan([step('a')]), plan([step('a')])));
  assert('render: empty diff hint', rEmpty.includes('(no step changes)'));

  // renderPlanDiff is total on garbage input.
  let renderThrew = false;
  try {
    renderPlanDiff(null as unknown as ReturnType<typeof diffPlans>);
    renderPlanDiff({} as unknown as ReturnType<typeof diffPlans>);
    renderPlanDiff({ added: 'x', changed: [{ id: '' }, null] } as unknown as ReturnType<typeof diffPlans>);
  } catch {
    renderThrew = true;
  }
  assert('render: never throws on garbage', renderThrew === false);
}

// ── 17. reordered false when there are no common ids ──────────────────────────
{
  const d = diffPlans(plan([step('a'), step('b')]), plan([step('c'), step('d')]));
  assert('no-common: not reordered', d.reordered === false);
  assert('no-common: 2 added', d.added.length === 2);
  assert('no-common: 2 removed', d.removed.length === 2);
}

// ── 18. single common id can never be "reordered" ─────────────────────────────
{
  const before = plan([step('x'), step('a')]);
  const after = plan([step('a'), step('y')]);
  const d = diffPlans(before, after);
  assert('single-common: not reordered', d.reordered === false);
  assert('single-common: added y', d.added.includes('y'));
  assert('single-common: removed x', d.removed.includes('x'));
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log(`plan-diff-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
