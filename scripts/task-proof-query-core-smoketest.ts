/**
 * task-proof-query-core smoke.
 *
 * proof_of_work rows link to tasks only via detail.task_id inside the JSONB
 * (written by useKanbanData's proof publish → buildRunProofPublication
 * proofRow.task_id). The core filters circle-scoped rows client-side. This
 * smoke pins: matching/non-matching filtering, string-vs-number task-id
 * coercion, JSON-string detail parsing, totality on malformed detail/rows,
 * newest-first ordering + the ~5-row bound, and every summarize field.
 */

import {
  filterProofRowsForTask,
  summarizeTaskProof,
  TASK_PROOF_MAX_ROWS,
} from '../src/lib/taskProofQueryCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

const TASK = 'task-abc-123';

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'pow-1',
    pow_type: 'agent_run',
    title: 'Agent run: fix the widget',
    agent_name: 'BlackSwan',
    created_at: '2026-07-30T12:00:00.000Z',
    detail: { task_id: TASK, verified: true, bullets: ['did a thing'], git_references: [] },
    ...overrides,
  };
}

function main() {
  // ─── Basic matching / non-matching ───────────────────────────────
  {
    const rows = [
      row({ id: 'a' }),
      row({ id: 'b', detail: { task_id: 'other-task', verified: true } }),
      row({ id: 'c', detail: { verified: true } }), // no task_id at all
    ];
    const out = filterProofRowsForTask(rows, TASK);
    assert(out.length === 1, 'only the matching detail.task_id row survives');
    assert(out[0].id === 'a', 'matched row keeps its id');
    assert(out[0].title === 'Agent run: fix the widget', 'matched row keeps its title');
    assert(out[0].agentName === 'BlackSwan', 'matched row keeps agent_name');
    assert(out[0].powType === 'agent_run', 'matched row keeps pow_type');
    assert(out[0].createdAt === '2026-07-30T12:00:00.000Z', 'matched row keeps created_at');
    assert(out[0].detail.verified === true, 'matched row exposes the parsed detail object');
  }

  // ─── String vs number task-id coercion (JSONB numbers happen) ────
  {
    const rows = [
      row({ id: 'num', detail: { task_id: 42, verified: false } }),
      row({ id: 'str', detail: { task_id: '42', verified: true } }),
      row({ id: 'other', detail: { task_id: 43 } }),
    ];
    const asString = filterProofRowsForTask(rows, '42');
    assert(asString.length === 2, "string taskId '42' matches BOTH numeric 42 and string '42' details");
    const asNumber = filterProofRowsForTask(rows, 42);
    assert(asNumber.length === 2, 'numeric taskId 42 matches the same two rows');
    assert(filterProofRowsForTask(rows, '43').length === 1, 'no cross-talk: 43 matches only its own row');
    // Coercion must not be loose-equality sloppy:
    assert(filterProofRowsForTask([row({ detail: { task_id: true } })], 'true').length === 0,
      'boolean task_id never coerces to a string match');
    assert(filterProofRowsForTask([row({ detail: { task_id: NaN } })], 'NaN').length === 0,
      'NaN task_id never matches');
  }

  // ─── JSON-string detail parsing ──────────────────────────────────
  {
    const rows = [
      row({ id: 'js', detail: JSON.stringify({ task_id: TASK, verified: true, git_references: [{ url: 'https://github.com/o/r/pull/1' }] }) }),
      row({ id: 'js-other', detail: JSON.stringify({ task_id: 'nope' }) }),
    ];
    const out = filterProofRowsForTask(rows, TASK);
    assert(out.length === 1, 'JSON-string detail is parsed and matched');
    assert(out[0].id === 'js', 'the parsed-string match is the right row');
    assert(out[0].detail.verified === true, 'parsed-string detail exposes fields as an object');
    assert(Array.isArray(out[0].detail.git_references), 'parsed-string detail keeps git_references array');
  }

  // ─── Totality: malformed inputs never throw, never match ─────────
  {
    const garbage = [
      row({ id: 'g1', detail: null }),
      row({ id: 'g2', detail: undefined }),
      row({ id: 'g3', detail: 'not json {{{' }),
      row({ id: 'g4', detail: '"just a json string"' }), // parses to non-object
      row({ id: 'g5', detail: '[1,2,3]' }), // parses to array, not record
      row({ id: 'g6', detail: 12345 }),
      row({ id: 'g7', detail: [{ task_id: TASK }] }), // array detail, not record
      null,
      undefined,
      'a string row',
      42,
      { detail: { task_id: TASK } }, // matches even with missing row fields
    ];
    let out: ReturnType<typeof filterProofRowsForTask> = [];
    let threw = false;
    try { out = filterProofRowsForTask(garbage, TASK); } catch { threw = true; }
    assert(!threw, 'malformed rows/details never throw');
    assert(out.length === 1, 'only the well-linked row survives the garbage pile');
    assert(out[0].id === null && out[0].title === null, 'missing row fields normalize to null, not undefined/crash');

    assert(filterProofRowsForTask(null, TASK).length === 0, 'null rows input → []');
    assert(filterProofRowsForTask('rows', TASK).length === 0, 'non-array rows input → []');
    assert(filterProofRowsForTask([row({})], null).length === 0, 'null taskId → []');
    assert(filterProofRowsForTask([row({})], '').length === 0, 'empty-string taskId → []');
    assert(filterProofRowsForTask([row({})], { id: TASK } as unknown).length === 0, 'object taskId → []');
  }

  // ─── Bound + newest-first ordering ───────────────────────────────
  {
    // 8 matching rows fed in scrambled chronological order.
    const times = [
      '2026-07-24T00:00:00.000Z', '2026-07-28T00:00:00.000Z', '2026-07-22T00:00:00.000Z',
      '2026-07-30T00:00:00.000Z', '2026-07-26T00:00:00.000Z', '2026-07-21T00:00:00.000Z',
      '2026-07-29T00:00:00.000Z', '2026-07-23T00:00:00.000Z',
    ];
    const rows = times.map((t, i) => row({ id: `r${i}`, created_at: t }));
    const out = filterProofRowsForTask(rows, TASK);
    assert(out.length === TASK_PROOF_MAX_ROWS, `bounded to TASK_PROOF_MAX_ROWS (${TASK_PROOF_MAX_ROWS})`);
    assert(TASK_PROOF_MAX_ROWS === 5, 'bound is ~5 as specified');
    const ts = out.map((m) => m.createdAt);
    const sorted = [...ts].sort((a, b) => Date.parse(b!) - Date.parse(a!));
    assert(JSON.stringify(ts) === JSON.stringify(sorted), 'output is newest-first');
    assert(out[0].createdAt === '2026-07-30T00:00:00.000Z', 'newest row is first');
    assert(ts.every((t) => t !== '2026-07-21T00:00:00.000Z' && t !== '2026-07-22T00:00:00.000Z' && t !== '2026-07-23T00:00:00.000Z'),
      'the three OLDEST rows are the ones dropped by the bound');
    // Malformed created_at sorts last, does not throw.
    const withBad = filterProofRowsForTask([
      row({ id: 'good', created_at: '2026-07-30T00:00:00.000Z' }),
      row({ id: 'bad-ts', created_at: 'not a date' }),
      row({ id: 'no-ts', created_at: null }),
    ], TASK);
    assert(withBad.length === 3, 'malformed timestamps still match');
    assert(withBad[0].id === 'good', 'row with a real timestamp sorts before malformed ones');
  }

  // ─── summarizeTaskProof fields ───────────────────────────────────
  {
    const empty = summarizeTaskProof([]);
    assert(empty.count === 0 && empty.latestVerified === null && empty.latestTs === null && empty.gitRefCount === 0,
      'empty summary: {0, null, null, 0}');

    const matches = filterProofRowsForTask([
      row({ id: 'new', created_at: '2026-07-30T00:00:00.000Z', detail: { task_id: TASK, verified: true, git_references: [{ url: 'u1' }, { url: 'u2' }] } }),
      row({ id: 'old', created_at: '2026-07-20T00:00:00.000Z', detail: { task_id: TASK, verified: false, git_references: [{ url: 'u3' }] } }),
    ], TASK);
    const sum = summarizeTaskProof(matches);
    assert(sum.count === 2, 'summary count = matched rows');
    assert(sum.latestVerified === true, 'latestVerified reflects the NEWEST row');
    assert(sum.latestTs === '2026-07-30T00:00:00.000Z', 'latestTs is the newest created_at');
    assert(sum.gitRefCount === 3, 'gitRefCount sums git_references across rows');

    const unverifiedLatest = summarizeTaskProof(filterProofRowsForTask([
      row({ id: 'new', created_at: '2026-07-30T00:00:00.000Z', detail: { task_id: TASK, verified: false } }),
      row({ id: 'old', created_at: '2026-07-20T00:00:00.000Z', detail: { task_id: TASK, verified: true } }),
    ], TASK));
    assert(unverifiedLatest.latestVerified === false, 'latestVerified=false when newest row unverified (older verified does not mask)');

    const noVerifiedField = summarizeTaskProof(filterProofRowsForTask([
      row({ detail: { task_id: TASK } }),
    ], TASK));
    assert(noVerifiedField.latestVerified === false, 'missing verified field reads as false (never fabricates verification)');
    assert(noVerifiedField.gitRefCount === 0, 'missing git_references → 0');

    // Totality of summarize itself.
    let threw = false;
    try {
      summarizeTaskProof(null);
      summarizeTaskProof('x');
      summarizeTaskProof([null, 42, { detail: 'broken {' }]);
    } catch { threw = true; }
    assert(!threw, 'summarizeTaskProof is total on garbage');
    const garbageSum = summarizeTaskProof([{ detail: 'broken {' }]);
    assert(garbageSum.count === 1 && garbageSum.latestVerified === null, 'unparseable detail in summary → latestVerified null');
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('FAILURES:', failures);
    process.exit(1);
  }
}

main();
