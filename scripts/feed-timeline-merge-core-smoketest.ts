/**
 * feed-timeline-merge-core-smoketest — pure smoke for
 * src/lib/feedTimelineMergeCore.ts (no app imports, runs under tsx).
 *
 *   npx tsx scripts/feed-timeline-merge-core-smoketest.ts
 *
 * Covers: chronological merge ordering, cross-lane run dedupe (proof >
 * activity > task_run), weak task-id proximity dedupe, no-overmerge
 * guards, bounds + truncation count, the lane retry policy
 * (schema-permanent vs transient backoff schedule + attempt cap), and
 * totality on malformed/cyclic rows.
 */

import {
  buildFeedTimeline,
  decideFeedLaneRetry,
  FEED_TIMELINE_MAX_ITEMS,
  FEED_TIMELINE_TASK_PROXIMITY_MS,
  FEED_LANE_RETRY_SCHEDULE_MS,
} from '../src/lib/feedTimelineMergeCore';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

const T0 = Date.parse('2026-07-30T12:00:00Z');
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

// Row factories in the panel's exact query shapes.
const activityRow = (id: string, at: number, meta?: Record<string, unknown>) => ({
  id,
  agent_name: 'Swan',
  activity_type: 'task_completed',
  source: 'system',
  source_detail: null,
  title: `activity ${id}`,
  body: null,
  metadata: meta ?? {},
  created_at: iso(at),
});
const taskRunRow = (id: string, at: number, opts?: { runId?: string | null; taskId?: string | null }) => ({
  id,
  task_id: opts?.taskId ?? null,
  agent_id: 'agent-1',
  openswan_run_id: opts?.runId ?? null,
  run_kind: 'chat',
  status: 'completed',
  summary: `task run ${id}`,
  model_used: null,
  token_count: null,
  duration_ms: null,
  started_at: iso(at),
});
const proofRow = (id: string, at: number, detail?: unknown) => ({
  id,
  pow_type: 'agent_run',
  title: `proof ${id}`,
  agent_name: 'Swan',
  created_at: iso(at),
  detail: detail ?? {},
});
const automationRow = (id: string, at: number) => ({
  id,
  status: 'failed',
  error_message: 'boom',
  output_text: null,
  model_used: 'm',
  estimated_cost: null,
  duration_ms: null,
  trigger_source: 'auto',
  started_at: iso(at),
});

// ─── 1. Merge ordering (mixed timestamps across lanes) ───────────────
{
  const res = buildFeedTimeline({
    activity: [activityRow('a1', -30_000), activityRow('a2', -300_000)],
    automationRuns: [automationRow('r1', -60_000)],
    taskRuns: [taskRunRow('t1', -10_000)],
    proofs: [proofRow('p1', -120_000)],
  });
  assert(res.items.length === 5, 'ordering: all 5 unrelated items survive');
  const kinds = res.items.map((i) => i.kind).join(',');
  assert(kinds === 'task_run,activity,automation_run,proof,activity', `ordering: strict time-desc across lanes (got ${kinds})`);
  for (let i = 1; i < res.items.length; i++) {
    assert(res.items[i - 1].ts >= res.items[i].ts, `ordering: ts monotone non-increasing at ${i}`);
  }
  assert(res.dedupedCount === 0 && res.truncatedCount === 0, 'ordering: no dedupe/truncation for unrelated rows');
}

// ─── 2. Dedupe: one run in 3 lanes → 1 item, proof wins ─────────────
{
  const res = buildFeedTimeline({
    activity: [activityRow('a1', -5_000, { run_id: 'run-X', task_id: 'task-X' })],
    taskRuns: [taskRunRow('t1', -8_000, { runId: 'run-X', taskId: 'task-X' })],
    proofs: [proofRow('p1', -2_000, { run_id: 'run-X', task_id: 'task-X' })],
    automationRuns: [],
  });
  assert(res.items.length === 1, 'dedupe: run in 3 lanes collapses to 1 item');
  assert(res.items[0].kind === 'proof', 'dedupe: proof wins over activity and task_run');
  assert(res.items[0].dedupeKey === 'run:run-X', 'dedupe: strong run dedupeKey');
  assert(res.dedupedCount === 2, 'dedupe: dedupedCount counts the 2 collapsed rows');
}

// ─── 2b. Activity wins over task_run when no proof exists ────────────
{
  const res = buildFeedTimeline({
    activity: [activityRow('a1', -5_000, { run_id: 'run-Y' })],
    taskRuns: [taskRunRow('t1', -6_000, { runId: 'run-Y' })],
    proofs: [],
    automationRuns: [],
  });
  assert(res.items.length === 1 && res.items[0].kind === 'activity', 'dedupe: activity wins over task_run');
}

// ─── 2c. Weak key: task_id + timestamp proximity ─────────────────────
{
  // Proof lacks run_id but shares task_id with a task_run 60s away → merge.
  const res = buildFeedTimeline({
    proofs: [proofRow('p1', 0, { task_id: 'task-W' })],
    taskRuns: [taskRunRow('t1', -60_000, { taskId: 'task-W' })],
    activity: [],
    automationRuns: [],
  });
  assert(res.items.length === 1 && res.items[0].kind === 'proof', 'weak key: task_id within proximity merges, proof wins');
  assert(res.items[0].dedupeKey === 'task:task-W', 'weak key: task dedupeKey when no run id');
}

// ─── 3. No-overmerge ─────────────────────────────────────────────────
{
  // Two DIFFERENT runs in the same second stay separate.
  const res = buildFeedTimeline({
    proofs: [proofRow('p1', 0, { run_id: 'run-A' }), proofRow('p2', 0, { run_id: 'run-B' })],
    taskRuns: [taskRunRow('t1', 0, { runId: 'run-A' }), taskRunRow('t2', 0, { runId: 'run-B' })],
    activity: [],
    automationRuns: [],
  });
  assert(res.items.length === 2, 'no-overmerge: two different runs same second stay 2 items');
  assert(res.items.every((i) => i.kind === 'proof'), 'no-overmerge: both survivors are the proofs');
}
{
  // Same task, 10 minutes apart (outside proximity) → both kept.
  const res = buildFeedTimeline({
    proofs: [proofRow('p1', 0, { task_id: 'task-Z' })],
    taskRuns: [taskRunRow('t1', -(FEED_TIMELINE_TASK_PROXIMITY_MS * 2), { taskId: 'task-Z' })],
    activity: [],
    automationRuns: [],
  });
  assert(res.items.length === 2, 'no-overmerge: same task outside proximity window keeps both');
}
{
  // Same task within proximity BUT provably different run ids → both kept.
  const res = buildFeedTimeline({
    proofs: [proofRow('p1', 0, { run_id: 'run-A', task_id: 'task-Q' })],
    taskRuns: [taskRunRow('t1', -30_000, { runId: 'run-B', taskId: 'task-Q' })],
    activity: [],
    automationRuns: [],
  });
  assert(res.items.length === 2, 'no-overmerge: same task, provably different run ids keeps both');
}
{
  // Two proof rows sharing one run id (same kind) never dedupe each other.
  const res = buildFeedTimeline({
    proofs: [proofRow('p1', 0, { run_id: 'run-S' }), proofRow('p2', -1_000, { run_id: 'run-S' })],
    activity: [],
    taskRuns: [],
    automationRuns: [],
  });
  assert(res.items.length === 2, 'no-overmerge: same-kind rows never dedupe each other');
}
{
  // Automation runs never cross-merge even at identical timestamps.
  const res = buildFeedTimeline({
    automationRuns: [automationRow('r1', 0)],
    proofs: [proofRow('p1', 0, { run_id: 'run-A' })],
    activity: [activityRow('a1', 0, { run_id: 'run-A' })],
    taskRuns: [],
  });
  assert(res.items.length === 2, 'no-overmerge: automation run kept beside the deduped proof');
  assert(res.items.some((i) => i.kind === 'automation_run'), 'no-overmerge: automation_run survives');
}

// ─── 4. Bounds + truncation ──────────────────────────────────────────
{
  const many = Array.from({ length: 100 }, (_, i) => activityRow(`a${i}`, -i * 1_000));
  const res = buildFeedTimeline({ activity: many, automationRuns: [], taskRuns: [], proofs: [] });
  assert(res.items.length === FEED_TIMELINE_MAX_ITEMS, `bounds: capped at ${FEED_TIMELINE_MAX_ITEMS}`);
  assert(res.truncatedCount === 100 - FEED_TIMELINE_MAX_ITEMS, 'bounds: truncatedCount reports the drop');
  assert(res.items[0].ts > res.items[res.items.length - 1].ts, 'bounds: newest kept, oldest truncated');
}
{
  const res = buildFeedTimeline(
    { activity: [activityRow('a1', 0), activityRow('a2', -1_000), activityRow('a3', -2_000)] },
    { maxItems: 2 },
  );
  assert(res.items.length === 2 && res.truncatedCount === 1, 'bounds: maxItems override honoured');
}

// ─── 5. Retry policy ─────────────────────────────────────────────────
{
  const d1 = decideFeedLaneRetry({ code: '42P01', message: 'relation "proof_of_work" does not exist' }, 1);
  assert(d1.disableForever === true && d1.retryInMs === null, 'retry: 42P01 → disableForever');
  const d2 = decideFeedLaneRetry({ code: '42703', message: 'column x does not exist' }, 1);
  assert(d2.disableForever === true, 'retry: 42703 → disableForever');
  const d3 = decideFeedLaneRetry({ message: 'relation "task_runs" does not exist' }, 1);
  assert(d3.disableForever === true, 'retry: relation-does-not-exist message → disableForever');
  const d4 = decideFeedLaneRetry(
    { message: "Could not find the table 'public.task_runs' in the schema cache", code: 'PGRST205' },
    1,
  );
  assert(d4.disableForever === true, 'retry: PostgREST schema-cache miss → disableForever');

  const t1 = decideFeedLaneRetry({ message: 'Failed to fetch' }, 1);
  const t2 = decideFeedLaneRetry({ message: 'Failed to fetch' }, 2);
  const t3 = decideFeedLaneRetry({ message: 'network timeout' }, 3);
  const t4 = decideFeedLaneRetry({ message: 'network timeout' }, 4);
  assert(t1.disableForever === false && t1.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[0], 'retry: transient attempt 1 → 2s');
  assert(t2.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[1], 'retry: transient attempt 2 → 8s');
  assert(t3.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[2], 'retry: transient attempt 3 → 30s');
  assert(t4.disableForever === false && t4.retryInMs === null, 'retry: past cap → enabled but idle (no auto retry)');
  assert(FEED_LANE_RETRY_SCHEDULE_MS.join(',') === '2000,8000,30000', 'retry: schedule is 2s/8s/30s');

  // Totality on hostile inputs — always transient, never disabled, never throws.
  const h1 = decideFeedLaneRetry(null, 1);
  const h2 = decideFeedLaneRetry(undefined, NaN);
  const h3 = decideFeedLaneRetry({ code: 12345, message: { nested: true } }, -5);
  const h4 = decideFeedLaneRetry('random string error', 2);
  assert(h1.disableForever === false && h1.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[0], 'retry: null error → transient attempt 1');
  assert(h2.disableForever === false && h2.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[0], 'retry: NaN attempt → treated as attempt 1');
  assert(h3.disableForever === false && h3.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[0], 'retry: malformed error/attempt → safe transient');
  assert(h4.disableForever === false && h4.retryInMs === FEED_LANE_RETRY_SCHEDULE_MS[1], 'retry: plain-string non-schema error → transient');
  const h5 = decideFeedLaneRetry('column "metadata" does not exist', 1);
  assert(h5.disableForever === true, 'retry: plain-string schema error → disableForever');
}

// ─── 6. Totality on malformed rows ───────────────────────────────────
{
  const cyclic: any = { id: 'c1', created_at: iso(0), detail: {} };
  cyclic.detail.self = cyclic;
  const res = buildFeedTimeline({
    activity: [
      null as any,
      undefined as any,
      42 as any,
      { id: 'no-ts' } as any, // missing created_at → epoch 0 → tail
      activityRow('ok', -1_000),
      { id: 'bad-ts', created_at: 'not-a-date' } as any,
    ],
    proofs: [cyclic, proofRow('p1', 0)],
    taskRuns: [{ id: 'tr-no-ts', started_at: null } as any],
    automationRuns: [{} as any],
  });
  const okItems = res.items;
  assert(okItems.length === 7, `totality: malformed scalar/null rows skipped, object rows kept (got ${okItems.length})`);
  const tail = okItems.filter((i) => i.ts === 0);
  assert(tail.length === 4, 'totality: missing/invalid timestamps fall back to epoch 0');
  assert(
    okItems.slice(okItems.length - tail.length).every((i) => i.ts === 0),
    'totality: epoch-0 rows sort to the tail',
  );
  assert(
    okItems[0].kind === 'proof' && (okItems[0].row as any).id === 'c1' && (okItems[1].row as any).id === 'p1',
    'totality: cyclic detail row survives without throwing and ties deterministically (c1 before p1)',
  );
}
{
  // Whole-input hostility.
  const r1 = buildFeedTimeline(null);
  const r2 = buildFeedTimeline(undefined);
  const r3 = buildFeedTimeline({ activity: 'nope' as any, proofs: 7 as any });
  assert(r1.items.length === 0 && r2.items.length === 0 && r3.items.length === 0, 'totality: null/hostile inputs → empty result');
}

// ─── 7. Determinism ──────────────────────────────────────────────────
{
  const input = {
    activity: [activityRow('a1', 0), activityRow('a2', 0)],
    proofs: [proofRow('p1', 0)],
    taskRuns: [taskRunRow('t1', 0)],
    automationRuns: [automationRow('r1', 0)],
  };
  const a = buildFeedTimeline(input);
  const b = buildFeedTimeline(input);
  assert(
    JSON.stringify(a.items.map((i) => `${i.kind}:${(i.row as any).id}`)) ===
      JSON.stringify(b.items.map((i) => `${i.kind}:${(i.row as any).id}`)),
    'determinism: identical input → identical order',
  );
  assert(a.items[0].kind === 'proof', 'determinism: precedence tie-break puts proof first at equal ts');
}

console.log(`\nfeed-timeline-merge-core: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
