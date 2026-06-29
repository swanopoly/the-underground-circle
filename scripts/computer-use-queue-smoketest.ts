/**
 * computer-use-queue-smoketest — covers the pure queue helpers in
 * `src/lib/useComputerUseQueue.ts` (enqueue bounds/dedupe, the opt-in
 * auto-start gate, and active-slot counting). The React hook itself and
 * the console QUEUE section need a browser + live agent; those get
 * integration-tested manually.
 *
 * Run: npm run smoke:computer-use-queue
 */

import {
  appendQueuedComputerUseTask,
  countActiveComputerUseSlots,
  planComputerUseQueueAutoStart,
  MAX_QUEUED_COMPUTER_USE_TASKS,
  type QueuedComputerUseTask,
} from '../src/lib/useComputerUseQueue';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── countActiveComputerUseSlots ────────────────────────────────────────────
{
  const slot = (status: string) => ({ state: { status } as any });
  assert(countActiveComputerUseSlots([]) === 0, 'count: empty slots');
  assert(
    countActiveComputerUseSlots([slot('running'), slot('starting'), slot('done'), slot('error'), slot('idle')]) === 2,
    'count: only running/starting occupy a slot',
  );
}

// ─── planComputerUseQueueAutoStart — the opt-in gate ────────────────────────
{
  // Default-off safety: a populated queue with the toggle off NEVER starts.
  const off = planComputerUseQueueAutoStart({ activeCount: 0, pendingCount: 3, autoStartEnabled: false });
  assert(!off.shouldStart && off.reason === 'auto_start_disabled', 'gate: disabled toggle never auto-starts');

  const empty = planComputerUseQueueAutoStart({ activeCount: 0, pendingCount: 0, autoStartEnabled: true });
  assert(!empty.shouldStart && empty.reason === 'queue_empty', 'gate: empty queue starts nothing');

  const full = planComputerUseQueueAutoStart({ activeCount: 3, pendingCount: 2, autoStartEnabled: true });
  assert(!full.shouldStart && full.reason === 'slots_full', 'gate: concurrency cap respected');

  const go = planComputerUseQueueAutoStart({ activeCount: 2, pendingCount: 1, autoStartEnabled: true });
  assert(go.shouldStart && go.reason === 'slot_free', 'gate: enabled + free slot + waiting task starts');

  const customCap = planComputerUseQueueAutoStart({ activeCount: 1, pendingCount: 1, autoStartEnabled: true, maxConcurrent: 1 });
  assert(!customCap.shouldStart, 'gate: custom maxConcurrent respected');
}

// ─── appendQueuedComputerUseTask — bounds + dedupe ──────────────────────────
{
  const nowIso = '2026-06-12T10:00:00.000Z';
  let pending: QueuedComputerUseTask[] = [];

  const empty = appendQueuedComputerUseTask(pending, '   ');
  assert(empty.added === null && empty.reason === 'Empty task.', 'enqueue: empty task refused');
  assert(empty.pending === pending, 'enqueue: refusal returns the same list');

  const first = appendQueuedComputerUseTask(pending, '  research espresso machines  ', { nowIso, id: 'q1' });
  assert(first.added?.task === 'research espresso machines', 'enqueue: task trimmed');
  assert(first.added?.id === 'q1' && first.added?.queuedAtIso === nowIso, 'enqueue: explicit id/time honored');
  pending = first.pending;

  const dup = appendQueuedComputerUseTask(pending, 'research espresso machines');
  assert(dup.added === null && dup.reason === 'That task is already queued.', 'enqueue: exact duplicate refused');

  for (let i = 0; pending.length < MAX_QUEUED_COMPUTER_USE_TASKS; i += 1) {
    pending = appendQueuedComputerUseTask(pending, `task ${i}`).pending;
  }
  assert(pending.length === MAX_QUEUED_COMPUTER_USE_TASKS, 'enqueue: queue fills to the bound');
  const overflow = appendQueuedComputerUseTask(pending, 'one more');
  assert(overflow.added === null && /Queue full/.test(overflow.reason || ''), 'enqueue: bound enforced with reason');
  assert(overflow.pending.length === MAX_QUEUED_COMPUTER_USE_TASKS, 'enqueue: overflow does not grow the queue');

  // Generated ids are unique enough for keys/removal.
  const a = appendQueuedComputerUseTask([], 'alpha').added;
  const b = appendQueuedComputerUseTask([], 'beta').added;
  assert(Boolean(a?.id && b?.id && a.id !== b.id), 'enqueue: generated ids differ');
}

if (failures > 0) {
  console.error(`\n${failures} computer-use queue smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-use queue smoke cases passed.');
