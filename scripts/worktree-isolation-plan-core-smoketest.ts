// Smoke test for worktreeIsolationPlanCore — pure, tsx-loadable.
// Run: npx tsx scripts/worktree-isolation-plan-core-smoketest.ts
import {
  detectFileOverlaps,
  planWorktreeIsolation,
  summarizeWorktreePlan,
  type AgentTask,
  type WorktreePlanResult,
} from '../src/lib/worktreeIsolationPlanCore';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

const ids = (tasks: AgentTask[]) => tasks.map((t) => t.id).sort((a, b) => a.localeCompare(b));
const totalPlaced = (r: WorktreePlanResult) =>
  r.parallelSharedSafe.length +
  r.worktree.length +
  r.serializedGroups.reduce((n, g) => n + g.length, 0);
function partitionedOnce(r: WorktreePlanResult, allIds: string[]): boolean {
  const bag: string[] = [
    ...r.parallelSharedSafe.map((t) => t.id),
    ...r.worktree.map((t) => t.id),
    ...r.serializedGroups.flatMap((g) => g.map((t) => t.id)),
  ];
  if (bag.length !== allIds.length) return false;
  if (new Set(bag).size !== bag.length) return false; // no duplicate placement
  const want = new Set(allIds);
  return bag.every((x) => want.has(x));
}

// ── 1. Three fully-disjoint tasks → all parallelSharedSafe ────────────────────
{
  const tasks: AgentTask[] = [
    { id: 'a', touchedFiles: ['src/a.ts'] },
    { id: 'b', touchedFiles: ['src/b.ts'] },
    { id: 'c', touchedFiles: ['src/c.ts'] },
  ];
  const r = planWorktreeIsolation(tasks);
  check('disjoint: 3 parallel-safe', r.parallelSharedSafe.length === 3);
  check('disjoint: no serialized groups', r.serializedGroups.length === 0);
  check('disjoint: no worktree', r.worktree.length === 0);
  check('disjoint: no conflicts', r.conflicts.length === 0);
  check('disjoint: parallel ids a,b,c', JSON.stringify(ids(r.parallelSharedSafe)) === JSON.stringify(['a', 'b', 'c']));
  check('disjoint: partitioned exactly once', partitionedOnce(r, ['a', 'b', 'c']));
}

// ── 2. Two tasks sharing a file → one serializedGroup of 2 ────────────────────
{
  const tasks: AgentTask[] = [
    { id: 't1', touchedFiles: ['src/shared.ts', 'src/one.ts'] },
    { id: 't2', touchedFiles: ['src/shared.ts', 'src/two.ts'] },
  ];
  const r = planWorktreeIsolation(tasks);
  check('shared: 1 serialized group', r.serializedGroups.length === 1);
  check('shared: group has 2 tasks', r.serializedGroups[0]?.length === 2);
  check('shared: group ordered t1,t2', JSON.stringify(r.serializedGroups[0].map((t) => t.id)) === JSON.stringify(['t1', 't2']));
  check('shared: nothing parallel', r.parallelSharedSafe.length === 0);
  check('shared: nothing worktree', r.worktree.length === 0);
  check('shared: 1 conflict', r.conflicts.length === 1);
  check('shared: conflict files = [src/shared.ts]', JSON.stringify(r.conflicts[0].files) === JSON.stringify(['src/shared.ts']));
  check('shared: conflict a=t1 b=t2', r.conflicts[0].a === 't1' && r.conflicts[0].b === 't2');
  check('shared: partitioned once', partitionedOnce(r, ['t1', 't2']));
}

// ── 3. Transitive A–B–C chain → single group of 3 (even though A,C disjoint) ──
{
  // A shares f1 with B; B shares f2 with C; A and C touch NO common file.
  const tasks: AgentTask[] = [
    { id: 'A', touchedFiles: ['f1.ts', 'onlyA.ts'] },
    { id: 'B', touchedFiles: ['f1.ts', 'f2.ts'] },
    { id: 'C', touchedFiles: ['f2.ts', 'onlyC.ts'] },
  ];
  const overlaps = detectFileOverlaps(tasks);
  // A–C should NOT be a direct overlap; only A–B and B–C.
  check('transitive: 2 direct overlaps', overlaps.length === 2);
  check('transitive: A–C not directly overlapping', !overlaps.some((o) => o.a === 'A' && o.b === 'C'));
  const r = planWorktreeIsolation(tasks);
  check('transitive: single serialized group', r.serializedGroups.length === 1);
  check('transitive: group of 3', r.serializedGroups[0]?.length === 3);
  check('transitive: group = A,B,C sorted', JSON.stringify(r.serializedGroups[0].map((t) => t.id)) === JSON.stringify(['A', 'B', 'C']));
  check('transitive: nothing parallel', r.parallelSharedSafe.length === 0);
  check('transitive: partitioned once', partitionedOnce(r, ['A', 'B', 'C']));
}

// ── 4. forceWorktree task → worktree ──────────────────────────────────────────
{
  const tasks: AgentTask[] = [
    { id: 'p', touchedFiles: ['src/p.ts'] },
    { id: 'w', touchedFiles: ['src/w.ts'], forceWorktree: true },
  ];
  const r = planWorktreeIsolation(tasks);
  check('force: 1 in worktree', r.worktree.length === 1);
  check('force: worktree is w', r.worktree[0]?.id === 'w');
  check('force: 1 parallel-safe', r.parallelSharedSafe.length === 1);
  check('force: parallel is p', r.parallelSharedSafe[0]?.id === 'p');
  check('force: no serialized groups', r.serializedGroups.length === 0);
  check('force: partitioned once', partitionedOnce(r, ['p', 'w']));
}

// ── 5. isolateOverlapping → overlapping tasks go to worktree, not serialized ──
{
  const tasks: AgentTask[] = [
    { id: 'x', touchedFiles: ['dup.ts'] },
    { id: 'y', touchedFiles: ['dup.ts'] },
    { id: 'z', touchedFiles: ['solo.ts'] },
  ];
  const def = planWorktreeIsolation(tasks);
  check('iso-default: x,y serialized', def.serializedGroups.length === 1 && def.serializedGroups[0].length === 2);
  check('iso-default: worktree empty', def.worktree.length === 0);

  const iso = planWorktreeIsolation(tasks, { isolateOverlapping: true });
  check('iso: overlapping x,y in worktree', JSON.stringify(ids(iso.worktree)) === JSON.stringify(['x', 'y']));
  check('iso: no serialized groups', iso.serializedGroups.length === 0);
  check('iso: z still parallel-safe', iso.parallelSharedSafe.length === 1 && iso.parallelSharedSafe[0].id === 'z');
  check('iso: conflicts still reported', iso.conflicts.length === 1);
  check('iso: partitioned once', partitionedOnce(iso, ['x', 'y', 'z']));
}

// ── 6. Determinism: shuffled input → identical plan ───────────────────────────
{
  const base: AgentTask[] = [
    { id: 'm2', touchedFiles: ['b.ts', 'c.ts'] },
    { id: 'm1', touchedFiles: ['a.ts', 'b.ts'] },
    { id: 'm4', touchedFiles: ['solo.ts'] },
    { id: 'm3', touchedFiles: ['c.ts'] },
  ];
  const shuffled: AgentTask[] = [base[3], base[0], base[2], base[1]];
  const r1 = planWorktreeIsolation(base);
  const r2 = planWorktreeIsolation(shuffled);
  check('determinism: plans identical regardless of input order', JSON.stringify(r1) === JSON.stringify(r2));
  check('determinism: overlaps identical', JSON.stringify(detectFileOverlaps(base)) === JSON.stringify(detectFileOverlaps(shuffled)));
  // m1(a,b)-m2(b,c)-m3(c) chain → one group of 3; m4 alone parallel.
  check('determinism: chain grouped m1,m2,m3', r1.serializedGroups.length === 1 && JSON.stringify(r1.serializedGroups[0].map((t) => t.id)) === JSON.stringify(['m1', 'm2', 'm3']));
  check('determinism: m4 parallel', r1.parallelSharedSafe.length === 1 && r1.parallelSharedSafe[0].id === 'm4');
}

// ── 7. Empty input is safe; empty touchedFiles (no force) → parallel-safe ─────
{
  const empty = planWorktreeIsolation([]);
  check('empty: no parallel', empty.parallelSharedSafe.length === 0);
  check('empty: no groups', empty.serializedGroups.length === 0);
  check('empty: no worktree', empty.worktree.length === 0);
  check('empty: no conflicts', empty.conflicts.length === 0);
  check('empty: detectFileOverlaps([]) is []', detectFileOverlaps([]).length === 0);

  const noFiles = planWorktreeIsolation([
    { id: 'nf1', touchedFiles: [] },
    { id: 'nf2', touchedFiles: ['  '] }, // whitespace normalizes away → empty set
  ]);
  check('no-files: both parallel-safe', noFiles.parallelSharedSafe.length === 2);
  check('no-files: no conflicts', noFiles.conflicts.length === 0);
}

// ── 8. Robustness: garbage input, dup ids, path normalization, never throws ───
{
  // @ts-expect-error deliberately bad input
  const r = planWorktreeIsolation(null);
  check('robust: null input → empty parallel', r.parallelSharedSafe.length === 0);

  // Dup id: only the first is kept.
  const dup = planWorktreeIsolation([
    { id: 'd', touchedFiles: ['x.ts'] },
    { id: 'd', touchedFiles: ['y.ts'] },
  ]);
  check('robust: dup id collapsed to 1 task', dup.parallelSharedSafe.length === 1);

  // Path normalization: 'src//shared.ts' and 'src/shared.ts' are the same file.
  const norm = planWorktreeIsolation([
    { id: 'n1', touchedFiles: ['src//shared.ts'] },
    { id: 'n2', touchedFiles: ['src/shared.ts/'] },
  ]);
  check('robust: normalized paths overlap → serialized', norm.serializedGroups.length === 1 && norm.serializedGroups[0].length === 2);

  // summarize never throws and mentions the frontier caveat.
  const summary = summarizeWorktreePlan(norm);
  check('robust: summary is a non-empty string', typeof summary === 'string' && summary.length > 0);
  check('robust: summary carries FILE-collision caveat', /FILE collisions/i.test(summary));
  // @ts-expect-error bad summary input
  check('robust: summarize(undefined) does not throw', typeof summarizeWorktreePlan(undefined) === 'string');
}

// ── 9. Mixed real-world plan: parallel + serialized + forced worktree together ─
{
  const tasks: AgentTask[] = [
    { id: 'auth', touchedFiles: ['src/auth.ts'] },
    { id: 'ui-a', touchedFiles: ['src/ui/list.tsx', 'src/ui/theme.ts'] },
    { id: 'ui-b', touchedFiles: ['src/ui/theme.ts'] },
    { id: 'risky', touchedFiles: ['src/db.ts'], forceWorktree: true },
  ];
  const r = planWorktreeIsolation(tasks);
  check('mixed: auth parallel-safe', r.parallelSharedSafe.some((t) => t.id === 'auth'));
  check('mixed: ui-a & ui-b serialized together', r.serializedGroups.length === 1 && JSON.stringify(r.serializedGroups[0].map((t) => t.id)) === JSON.stringify(['ui-a', 'ui-b']));
  check('mixed: risky forced to worktree', r.worktree.length === 1 && r.worktree[0].id === 'risky');
  check('mixed: every task placed exactly once', totalPlaced(r) === 4 && partitionedOnce(r, ['auth', 'ui-a', 'ui-b', 'risky']));
  check('mixed: exactly one conflict (ui theme)', r.conflicts.length === 1 && JSON.stringify(r.conflicts[0].files) === JSON.stringify(['src/ui/theme.ts']));
}

console.log(`worktree-isolation-plan-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
