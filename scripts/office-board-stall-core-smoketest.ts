/**
 * office-board-stall-core-smoketest — exercises the pure, READ-ONLY board
 * stall classifier in src/lib/officeBoardStallCore.ts.
 *
 * Covers:
 *   1. Composition with the REAL runStallPolicyCore thresholds at fixed nowMs
 *      (stale/dead boundaries, exact threshold edges)
 *   2. Only 'running' rows can stall (queued/waiting/paused/terminal → live)
 *   3. Missing/garbage updatedAt → not stalled (board never uses started_at)
 *   4. classifyBoardStalls tree walk: roots + nested children, dedupe, bounds
 *   5. Totality: hostile input never throws; verdict is read-only data (no
 *      reap plan / ids-to-fail anywhere in the shape)
 *   6. Determinism at fixed nowMs
 *
 * Usage:
 *   npx tsx scripts/office-board-stall-core-smoketest.ts
 */

import {
  classifyRunNodeStall,
  classifyBoardStalls,
  OFFICE_BOARD_STALL_LABEL,
  RUN_STALL_STALE_MS,
  RUN_STALL_DEAD_MS,
  type BoardStallNodeLike,
} from '../src/lib/officeBoardStallCore';
import {
  classifyRunLiveness,
  RUN_STALL_STALE_MS as POLICY_STALE_MS,
  RUN_STALL_DEAD_MS as POLICY_DEAD_MS,
} from '../src/lib/runStallPolicyCore';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NOW = Date.parse('2026-07-31T12:00:00.000Z');
const iso = (agoMs: number) => new Date(NOW - agoMs).toISOString();
const node = (over: Partial<BoardStallNodeLike>): BoardStallNodeLike => ({
  runId: 'run-1',
  status: 'running',
  ...over,
});

console.log('office-board-stall-core smoketest');

// ── 1. Composition with the real policy thresholds ──────────────────────────
console.log('\n[1] policy composition at fixed nowMs');
check('re-exported stale threshold IS the policy value', RUN_STALL_STALE_MS === POLICY_STALE_MS);
check('re-exported dead threshold IS the policy value', RUN_STALL_DEAD_MS === POLICY_DEAD_MS);
check('policy thresholds are the documented 2min/5min', POLICY_STALE_MS === 120_000 && POLICY_DEAD_MS === 300_000);

const fresh = classifyRunNodeStall(node({ updatedAt: iso(30_000) }), NOW);
check('fresh heartbeat (30s) → not stalled', !fresh.stalled && fresh.liveness === 'live');
check('fresh verdict carries no label', fresh.label === undefined);

const justUnderStale = classifyRunNodeStall(node({ updatedAt: iso(RUN_STALL_STALE_MS - 1) }), NOW);
check('1ms under stale threshold → not stalled', !justUnderStale.stalled);

const atStale = classifyRunNodeStall(node({ updatedAt: iso(RUN_STALL_STALE_MS) }), NOW);
check('exactly at stale threshold → stalled', atStale.stalled && atStale.liveness === 'stale');
check('stalled verdict carries STALLED? label', atStale.label === OFFICE_BOARD_STALL_LABEL);
check('label text is STALLED?', OFFICE_BOARD_STALL_LABEL === 'STALLED?');

const atDead = classifyRunNodeStall(node({ updatedAt: iso(RUN_STALL_DEAD_MS) }), NOW);
check('at dead threshold → stalled with dead liveness', atDead.stalled && atDead.liveness === 'dead');
check('dead verdict also carries the label', atDead.label === OFFICE_BOARD_STALL_LABEL);

// Composition assertion: board verdict agrees with a direct policy call for
// running rows with a heartbeat, across the whole age sweep.
let agrees = true;
for (const ageMs of [0, 60_000, 119_999, 120_000, 180_000, 299_999, 300_000, 3_600_000]) {
  const board = classifyRunNodeStall(node({ updatedAt: iso(ageMs) }), NOW);
  const policy = classifyRunLiveness({ status: 'running', startedAt: null, updatedAt: iso(ageMs), nowMs: NOW });
  if (board.liveness !== policy || board.stalled !== (policy !== 'live')) agrees = false;
}
check('board verdict === direct policy verdict across age sweep', agrees);

check('future heartbeat (clock skew) → not stalled', !classifyRunNodeStall(node({ updatedAt: iso(-60_000) }), NOW).stalled);

// ── 2. Only running rows stall ───────────────────────────────────────────────
console.log('\n[2] status gating');
for (const status of ['queued', 'planning', 'waiting_approval', 'paused', 'completed', 'failed', 'cancelled']) {
  check(
    `${status} with ancient heartbeat → not stalled`,
    !classifyRunNodeStall(node({ status, updatedAt: iso(24 * 3_600_000) }), NOW).stalled,
  );
}
check('RUNNING with the same ancient heartbeat → stalled', classifyRunNodeStall(node({ updatedAt: iso(24 * 3_600_000) }), NOW).stalled);

// ── 3. Missing heartbeat → never stalled ─────────────────────────────────────
console.log('\n[3] missing updatedAt totality');
check('no updatedAt → not stalled', !classifyRunNodeStall(node({}), NOW).stalled);
check('undefined updatedAt → not stalled', !classifyRunNodeStall(node({ updatedAt: undefined }), NOW).stalled);
check('null updatedAt → not stalled', !classifyRunNodeStall(node({ updatedAt: null }), NOW).stalled);
check('empty-string updatedAt → not stalled', !classifyRunNodeStall(node({ updatedAt: '   ' }), NOW).stalled);
check('unparseable updatedAt → not stalled', !classifyRunNodeStall(node({ updatedAt: 'not-a-date' }), NOW).stalled);
// The deliberate divergence from the reaper: an old START time alone must not
// badge a heartbeat-less run (the reaper's started_at fallback stays reaper-only).
check(
  'old startedAt + no updatedAt → not stalled (no started_at fallback)',
  !classifyRunNodeStall({ runId: 'r', status: 'running', startedAt: iso(3_600_000) } as BoardStallNodeLike, NOW).stalled,
);

// ── 4. Tree walk ─────────────────────────────────────────────────────────────
console.log('\n[4] classifyBoardStalls tree walk');
const tree: BoardStallNodeLike[] = [
  {
    runId: 'root-stalled',
    status: 'running',
    updatedAt: iso(RUN_STALL_DEAD_MS + 1),
    children: [
      { runId: 'child-fresh', status: 'running', updatedAt: iso(10_000) },
      { runId: 'child-stale', status: 'running', updatedAt: iso(RUN_STALL_STALE_MS + 5_000) },
    ],
  },
  { runId: 'root-queued', status: 'queued', updatedAt: iso(3_600_000) },
  { runId: 'root-noheartbeat', status: 'running' },
];
const verdicts = classifyBoardStalls(tree, NOW);
check('all five nodes classified', verdicts.size === 5, String(verdicts.size));
check('stalled root flagged dead', verdicts.get('root-stalled')?.stalled === true && verdicts.get('root-stalled')?.liveness === 'dead');
check('fresh child not flagged', verdicts.get('child-fresh')?.stalled === false);
check('stale child flagged with label', verdicts.get('child-stale')?.stalled === true && verdicts.get('child-stale')?.label === OFFICE_BOARD_STALL_LABEL);
check('queued root not flagged', verdicts.get('root-queued')?.stalled === false);
check('heartbeat-less root not flagged', verdicts.get('root-noheartbeat')?.stalled === false);

const dupes = classifyBoardStalls(
  [
    { runId: 'dup', status: 'running', updatedAt: iso(RUN_STALL_DEAD_MS + 1) },
    { runId: 'dup', status: 'running', updatedAt: iso(1_000) }, // second occurrence ignored
  ],
  NOW,
);
check('duplicate runId: first occurrence wins', dupes.size === 1 && dupes.get('dup')?.stalled === true);

// Cyclic structure must terminate (bounded walk).
const a: BoardStallNodeLike = { runId: 'cycle-a', status: 'running', updatedAt: iso(1000), children: [] };
const b: BoardStallNodeLike = { runId: 'cycle-b', status: 'running', updatedAt: iso(1000), children: [a] };
a.children = [b];
const cyclic = classifyBoardStalls([a], NOW);
check('cyclic tree terminates with both nodes classified', cyclic.size === 2);

// ── 5. Totality / read-only shape ────────────────────────────────────────────
console.log('\n[5] totality + read-only verdict shape');
let threw = false;
try {
  classifyRunNodeStall(null, NOW);
  classifyRunNodeStall(undefined, NOW);
  classifyRunNodeStall(42 as never, NOW);
  classifyRunNodeStall(node({ updatedAt: iso(1000) }), NaN);
  classifyBoardStalls(null, NOW);
  classifyBoardStalls(undefined, NOW);
  classifyBoardStalls('nope' as never, NOW);
  classifyBoardStalls([null, undefined, 42, 'x'] as never, NOW);
  classifyBoardStalls(tree, NaN);
} catch {
  threw = true;
}
check('hostile inputs never throw', !threw);
check('null node → not stalled', !classifyRunNodeStall(null, NOW).stalled);
check('invalid nowMs → not stalled (cannot classify)', !classifyRunNodeStall(node({ updatedAt: iso(RUN_STALL_DEAD_MS * 10) }), NaN).stalled);
check('non-array board input → empty map', classifyBoardStalls('nope' as never, NOW).size === 0);
const verdictKeys = Object.keys(classifyRunNodeStall(node({ updatedAt: iso(RUN_STALL_DEAD_MS + 1) }), NOW)).sort();
check(
  'verdict shape is read-only classification only (no reap fields)',
  verdictKeys.join(',') === 'label,liveness,stalled',
  verdictKeys.join(','),
);
const hugeBoard: BoardStallNodeLike[] = Array.from({ length: 10_000 }, (_, i) => ({
  runId: `huge-${i}`,
  status: 'running',
  updatedAt: iso(1000),
}));
check('huge input stays bounded (≤5000 walked)', classifyBoardStalls(hugeBoard, NOW).size <= 5000);

// ── 6. Determinism ───────────────────────────────────────────────────────────
console.log('\n[6] determinism');
const v1 = JSON.stringify([...classifyBoardStalls(tree, NOW).entries()]);
const v2 = JSON.stringify([...classifyBoardStalls(tree, NOW).entries()]);
check('identical input + nowMs → identical verdicts', v1 === v2);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
