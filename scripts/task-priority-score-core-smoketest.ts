/**
 * task-priority-score-core-smoketest — the PURE task priority brain
 * (src/lib/taskPriorityScoreCore.ts). Load-bearing behavior asserted here:
 * urgency (overdue > soon > far), importance (high>medium>low), blocking
 * (more>less, saturating), effort quick-win (short>long), age (older>newer),
 * terminal-status → 0, weighted-sum clamp to [0,100], factor breakdown,
 * deterministic rank ordering + id tie-break, and never-throws / missing-field
 * safety.
 *
 * Pure — loads under tsx (taskPriorityScoreCore has zero imports).
 */

import {
  scoreTask,
  rankTasks,
  MAX_SCORE,
  URGENCY_NO_DUE,
  EFFORT_NEUTRAL,
  type ScorableTask,
} from '../src/lib/taskPriorityScoreCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const NOW = 1_700_000_000_000; // fixed "now" (epoch ms)
const DAY = 24 * 60 * 60 * 1000;

function main(): void {
  // ─── (1) urgency: overdue > due-soon > far-future > no-due ──────────────────
  const overdue = scoreTask({ id: 'a', dueAt: NOW - DAY }, NOW);
  const soon = scoreTask({ id: 'b', dueAt: NOW + DAY }, NOW);
  const far = scoreTask({ id: 'c', dueAt: NOW + 30 * DAY }, NOW);
  const noDue = scoreTask({ id: 'd' }, NOW);
  assert(overdue.score > soon.score, '(1) overdue outranks due-soon');
  assert(soon.score > far.score, '(1) due-soon outranks far-future');
  assertEq(overdue.factors.urgency, 1, '(1) overdue pins urgency at 1');
  assert(far.factors.urgency < soon.factors.urgency, '(1) urgency decays with distance');
  assertEq(noDue.factors.urgency, URGENCY_NO_DUE, '(1) no due date → neutral-low urgency constant');
  assert(soon.factors.urgency > URGENCY_NO_DUE, '(1) a near deadline beats having no deadline');

  // ─── (2) importance: high > medium > low (all else equal) ───────────────────
  const hi = scoreTask({ id: 'x', importance: 'high' }, NOW);
  const med = scoreTask({ id: 'x', importance: 'medium' }, NOW);
  const lo = scoreTask({ id: 'x', importance: 'low' }, NOW);
  assert(hi.score > med.score, '(2) high importance > medium');
  assert(med.score > lo.score, '(2) medium importance > low');
  assert(hi.factors.importance > lo.factors.importance, '(2) importance factor ordered high>low');
  const unset = scoreTask({ id: 'x' }, NOW);
  assertEq(unset.factors.importance, med.factors.importance, '(2) missing importance defaults to medium');
  const garbageImp = scoreTask({ id: 'x', importance: 'URGENT' as any }, NOW);
  assertEq(garbageImp.factors.importance, med.factors.importance, '(2) invalid importance label → medium default');

  // ─── (3) blocking: more blocked tasks → higher, saturating ──────────────────
  const block0 = scoreTask({ id: 'x', blocking: 0 }, NOW);
  const block2 = scoreTask({ id: 'x', blocking: 2 }, NOW);
  const block10 = scoreTask({ id: 'x', blocking: 10 }, NOW);
  assert(block2.score > block0.score, '(3) blocking 2 > blocking 0');
  assert(block10.score > block2.score, '(3) blocking 10 > blocking 2');
  assertEq(block0.factors.blocking, 0, '(3) zero blocking → factor 0');
  // diminishing returns: the 0→2 jump exceeds the 8→10 jump
  const block8 = scoreTask({ id: 'x', blocking: 8 }, NOW);
  const lowGain = block2.factors.blocking - block0.factors.blocking;
  const highGain = block10.factors.blocking - block8.factors.blocking;
  assert(lowGain > highGain, '(3) blocking has diminishing returns (log-ish curve)');
  assert(block10.factors.blocking <= 1, '(3) blocking factor stays clamped <= 1');

  // ─── (4) effort quick-win: short effort > long effort (all else equal) ──────
  const quick = scoreTask({ id: 'x', effortMinutes: 10 }, NOW);
  const slow = scoreTask({ id: 'x', effortMinutes: 600 }, NOW);
  assert(quick.score > slow.score, '(4) quick task (short effort) outranks a long one');
  assertEq(quick.factors.effort, 1, '(4) very short effort → max quick-win factor');
  assert(slow.factors.effort < quick.factors.effort, '(4) long effort → lower quick-win factor');
  const unknownEffort = scoreTask({ id: 'x' }, NOW);
  assertEq(unknownEffort.factors.effort, EFFORT_NEUTRAL, '(4) unknown effort → neutral factor');

  // ─── (5) age: older createdAt → small boost ─────────────────────────────────
  const old = scoreTask({ id: 'x', createdAt: NOW - 20 * DAY }, NOW);
  const fresh = scoreTask({ id: 'x', createdAt: NOW - 1 * DAY }, NOW);
  const brandNew = scoreTask({ id: 'x', createdAt: NOW }, NOW);
  assert(old.score > fresh.score, '(5) older task outranks a newer one (all else equal)');
  assert(fresh.factors.age > brandNew.factors.age, '(5) age factor grows with age');
  assertEq(brandNew.factors.age, 0, '(5) age 0 → factor 0');
  const futureCreated = scoreTask({ id: 'x', createdAt: NOW + 5 * DAY }, NOW);
  assertEq(futureCreated.factors.age, 0, '(5) future createdAt (clock skew) → age factor 0, not negative');

  // ─── (6) terminal statuses → score 0 with factors zeroed ────────────────────
  const base = { id: 'x', dueAt: NOW - 5 * DAY, importance: 'high' as const, blocking: 9, effortMinutes: 5 };
  for (const status of ['done', 'completed', 'cancelled', 'Done', 'COMPLETED', 'Cancelled', ' canceled ']) {
    const t = scoreTask({ ...base, status }, NOW);
    assertEq(t.score, 0, `(6) terminal status "${status}" → score 0`);
    assertEq(t.factors.urgency, 0, `(6) terminal status "${status}" zeroes urgency factor`);
    assertEq(t.factors.blocking, 0, `(6) terminal status "${status}" zeroes blocking factor`);
  }
  const active = scoreTask({ ...base, status: 'in_progress' }, NOW);
  assert(active.score > 0, '(6) a non-terminal status is scored normally');

  // ─── (7) clamp + factor breakdown invariants ────────────────────────────────
  const maxed = scoreTask({ id: 'x', dueAt: NOW - DAY, importance: 'high', blocking: 999, effortMinutes: 1, createdAt: NOW - 90 * DAY }, NOW);
  assert(maxed.score <= MAX_SCORE, '(7) score never exceeds MAX_SCORE');
  assert(maxed.score >= 0, '(7) score never negative');
  assert(maxed.score > 80, '(7) an all-signals-high task scores near the ceiling');
  for (const k of ['urgency', 'importance', 'blocking', 'effort', 'age'] as const) {
    assert(maxed.factors[k] >= 0 && maxed.factors[k] <= 1, `(7) factor "${k}" stays in [0,1]`);
  }
  assertEq(maxed.factors.score, maxed.score, '(7) factors.score mirrors the final score');

  // ─── (8) rank: descending by score ──────────────────────────────────────────
  const ranked = rankTasks(
    [
      { id: 'far', dueAt: NOW + 30 * DAY },
      { id: 'overdue', dueAt: NOW - DAY, importance: 'high' },
      { id: 'mid', dueAt: NOW + 2 * DAY },
    ],
    NOW,
  );
  assertEq(ranked.length, 3, '(8) rank returns every task');
  assertEq(ranked[0].id, 'overdue', '(8) highest-priority task ranks first');
  assertEq(ranked[2].id, 'far', '(8) lowest-priority task ranks last');
  assert(ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score, '(8) ranked strictly descending by score');

  // ─── (9) deterministic tie-break by id ascending when scores are equal ──────
  // Identical scorable content, different ids, deliberately shuffled input.
  const tie: ScorableTask[] = [
    { id: 'charlie', importance: 'medium' },
    { id: 'alpha', importance: 'medium' },
    { id: 'bravo', importance: 'medium' },
  ];
  const tieRanked = rankTasks(tie, NOW);
  assert(tieRanked[0].score === tieRanked[1].score && tieRanked[1].score === tieRanked[2].score, '(9) tie setup: equal scores');
  assertEq(tieRanked.map((t) => t.id).join(','), 'alpha,bravo,charlie', '(9) equal scores break ties by id ascending');
  // Same input in a different order → identical output (stable/deterministic).
  const tieRanked2 = rankTasks([tie[1], tie[2], tie[0]], NOW);
  assertEq(tieRanked2.map((t) => t.id).join(','), 'alpha,bravo,charlie', '(9) ranking is order-independent (deterministic)');

  // ─── (10) missing-field tasks are safe & produce a sensible mid score ───────
  const bare = scoreTask({ id: 'bare' }, NOW);
  assert(Number.isFinite(bare.score) && bare.score >= 0 && bare.score <= MAX_SCORE, '(10) bare task → finite in-range score');
  assertEq(bare.id, 'bare', '(10) id preserved on a bare task');
  assert(bare.score > 0 && bare.score < MAX_SCORE, '(10) bare task lands in the neutral middle, not an extreme');

  // ─── (11) NaN / negative / undefined guards — never throw, never leak NaN ───
  const nastyInputs: any[] = [
    { id: 'n1', dueAt: NaN, blocking: NaN, effortMinutes: NaN, createdAt: NaN },
    { id: 'n2', dueAt: Infinity, blocking: -Infinity, effortMinutes: -5, createdAt: -100 },
    { id: 'n3', blocking: -3, effortMinutes: -50 },
    {}, // no id at all
    null,
    undefined,
  ];
  for (const bad of nastyInputs) {
    const t = scoreTask(bad, NOW);
    assert(Number.isFinite(t.score), `(11) score finite for nasty input ${JSON.stringify(bad)}`);
    assert(t.score >= 0 && t.score <= MAX_SCORE, `(11) score in-range for nasty input ${JSON.stringify(bad)}`);
    assertEq(typeof t.id, 'string', `(11) id is always a string for ${JSON.stringify(bad)}`);
    for (const k of ['urgency', 'importance', 'blocking', 'effort', 'age'] as const) {
      assert(Number.isFinite(t.factors[k]) && t.factors[k] >= 0 && t.factors[k] <= 1, `(11) factor ${k} clean for ${JSON.stringify(bad)}`);
    }
  }
  // negative blocking / effort must NOT out-boost zero / neutral
  assertEq(scoreTask({ id: 'x', blocking: -5 }, NOW).factors.blocking, 0, '(11) negative blocking clamped to 0');
  assert(scoreTask({ id: 'x', effortMinutes: -10 }, NOW).factors.effort === 1, '(11) negative effort clamps to 0 min → max quick-win, not NaN');

  // ─── (12) `now` guards + rank on garbage inputs ─────────────────────────────
  const nanNow = scoreTask({ id: 'x', dueAt: NOW }, NaN as any);
  assert(Number.isFinite(nanNow.score), '(12) NaN now → still a finite score (now defaults)');
  assertEq(rankTasks(null as any, NOW).length, 0, '(12) non-array task list → empty ranking, no throw');
  assertEq(rankTasks([], NOW).length, 0, '(12) empty task list → empty ranking');
  const mixedRank = rankTasks([null as any, { id: 'ok', importance: 'high' }, undefined as any], NOW);
  assertEq(mixedRank.length, 3, '(12) rank tolerates garbage entries alongside good ones');
  assert(mixedRank.every((t) => Number.isFinite(t.score)), '(12) every ranked score finite despite garbage entries');

  // ─── (13) determinism: same inputs → byte-identical results ─────────────────
  const once = JSON.stringify(scoreTask({ ...base, status: 'open' }, NOW));
  const twice = JSON.stringify(scoreTask({ ...base, status: 'open' }, NOW));
  assertEq(once, twice, '(13) scoreTask is deterministic (identical serialization)');

  console.log(`task-priority-score-core smoke: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
