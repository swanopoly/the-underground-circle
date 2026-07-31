/**
 * accountability-nag-core-smoketest — guards the PURE "needs attention" brain
 * (`buildNeedsAttention` in src/lib/accountabilityNagCore.ts):
 *
 *   - ranking: mission_breached > task_overdue > task_stalled at equal recency
 *   - age math against a fixed nowMs ("overdue by 3d", "no agent run for 6d")
 *   - stalled detection BOTH branches (no run ever / last run older than N days)
 *     plus the negative (fresh run → not stalled)
 *   - blocked detection from last_agent_run_status
 *   - dedupe (one item per task, highest severity wins) + bound (maxItems)
 *   - stable deterministic ordering (urgency desc, key asc tie-break)
 *   - totality: null/garbage inputs and malformed rows never throw
 *   - suggestedAction shape (label always, seedCommand bounded string)
 *   - COMPOSITION: the same dueAt/now fed through the REAL evaluateSla must
 *     yield the SLA verdict the nag item's kind maps from (not re-implemented)
 *
 * Run: npx tsx scripts/accountability-nag-core-smoketest.ts
 */

import {
  buildNeedsAttention,
  slaLevelToTaskKind,
  formatAgeShort,
  KIND_BASE,
  DEFAULT_MAX_ITEMS,
  type NeedsAttentionInput,
  type NeedsAttentionItem,
} from '../src/lib/accountabilityNagCore';
import { evaluateSla } from '../src/lib/deadlineSlaCore';

let failures = 0;
let passes = 0;
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) {
    passes += 1;
    console.log('pass:', message);
  } else {
    failures += 1;
    console.error('FAIL:', `${message}${detail ? ` — ${detail}` : ''}`);
  }
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

// Fixed clock: local end-of-day anchor so bare YYYY-MM-DD due dates (parsed as
// T23:59:59 local, mirroring FeedTab) produce exact day ages.
const DUE_EOD = new Date('2026-07-20T23:59:59').getTime();
const NOW = DUE_EOD + 3 * DAY; // '2026-07-20' is overdue by exactly 3 days

// ── 1. Ranking: breached > overdue > stalled at equal recency ────────────────

{
  const items = buildNeedsAttention({
    nowMs: NOW,
    tasks: [
      { id: 't-overdue', title: 'Overdue task', status: 'todo', due_date: '2026-07-20' },
      {
        id: 't-stalled', title: 'Stalled task', status: 'in_progress',
        last_agent_run_at: new Date(NOW - 6 * DAY).toISOString(),
      },
    ],
    missions: [
      {
        id: 'm-breached', title: 'Breached mission', status: 'active',
        deadline: new Date(NOW - 3 * DAY).toISOString(),
      },
    ],
  });

  assertEqual(items.length, 3, 'ranking: three items produced');
  assertEqual(items[0]?.kind, 'mission_breached', 'ranking: breached mission first');
  assertEqual(items[1]?.kind, 'task_overdue', 'ranking: overdue task second');
  assertEqual(items[2]?.kind, 'task_stalled', 'ranking: stalled task third');
  assert(
    items[0]!.urgencyScore > items[1]!.urgencyScore && items[1]!.urgencyScore > items[2]!.urgencyScore,
    'ranking: urgencyScore strictly descending across bands',
  );
  assert(
    KIND_BASE.mission_breached > KIND_BASE.task_overdue && KIND_BASE.task_overdue > KIND_BASE.task_stalled,
    'ranking: KIND_BASE bands encode breached > overdue > stalled',
  );

  // ids / keys are wired through
  assertEqual(items[0]?.missionId, 'm-breached', 'ranking: missionId carried');
  assertEqual(items[1]?.taskId, 't-overdue', 'ranking: taskId carried');
  assertEqual(items[1]?.key, 'task_overdue:t-overdue', 'ranking: key = kind:id');
}

// ── 2. Age math vs fixed nowMs ───────────────────────────────────────────────

{
  const items = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 't1', title: 'Late', status: 'todo', due_date: '2026-07-20' }],
    missions: [],
  });
  assertEqual(items.length, 1, 'age: single overdue item');
  assert(items[0]!.reason.includes('overdue by 3d'), 'age: reason says "overdue by 3d"', items[0]!.reason);

  // mission overdue by exactly 5 days
  const m = buildNeedsAttention({
    nowMs: NOW,
    missions: [{ id: 'm1', title: 'M', status: 'active', deadline: new Date(NOW - 5 * DAY).toISOString() }],
  });
  assert(m[0]!.reason.includes('overdue by 5d'), 'age: mission reason says "overdue by 5d"', m[0]!.reason);

  // due soon (12h out with 24h lead window)
  const soon = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 't2', title: 'Soon', status: 'todo', due_date: new Date(NOW + 12 * HOUR).toISOString() }],
  });
  assertEqual(soon[0]?.kind, 'task_due_soon', 'age: 12h out with 24h window → due_soon');
  assert(soon[0]!.reason.includes('due in 12h'), 'age: due-soon reason says "due in 12h"', soon[0]!.reason);

  // formatAgeShort direct pins
  assertEqual(formatAgeShort(3 * DAY), '3d', 'age: formatAgeShort 3d');
  assertEqual(formatAgeShort(5 * HOUR), '5h', 'age: formatAgeShort 5h');
  assertEqual(formatAgeShort(10_000), '<1h', 'age: formatAgeShort sub-hour');
}

// ── 3. Stalled detection — both branches + negative ──────────────────────────

{
  // Branch A: in progress, no run ever
  const a = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 'ta', title: 'Never ran', status: 'in_progress' }],
  });
  assertEqual(a[0]?.kind, 'task_stalled', 'stalled: no-run-ever branch fires');
  assert(a[0]!.reason.includes('no agent run yet'), 'stalled: no-run-ever reason', a[0]!.reason);

  // Branch B: last run 6 days ago (default threshold 4d) — via recentRunsByTaskId
  const b = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 'tb', title: 'Old run', status: 'in_progress' }],
    recentRunsByTaskId: { tb: NOW - 6 * DAY },
  });
  assertEqual(b[0]?.kind, 'task_stalled', 'stalled: old-run branch fires (recentRunsByTaskId)');
  assert(b[0]!.reason.includes('no agent run for 6d'), 'stalled: old-run reason has age 6d', b[0]!.reason);

  // Branch B': same via last_agent_run_at row field
  const b2 = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{
      id: 'tb2', title: 'Old run (row)', status: 'in_progress',
      last_agent_run_at: new Date(NOW - 5 * DAY).toISOString(),
    }],
  });
  assertEqual(b2[0]?.kind, 'task_stalled', 'stalled: old-run branch fires (last_agent_run_at)');

  // Negative: run 1 day ago → NOT stalled
  const c = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 'tc', title: 'Fresh run', status: 'in_progress' }],
    recentRunsByTaskId: { tc: NOW - 1 * DAY },
  });
  assertEqual(c.length, 0, 'stalled: fresh run (1d ago) is not stalled');

  // recentRunsByTaskId OVERRIDES a stale last_agent_run_at
  const d = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{
      id: 'td', title: 'Override', status: 'in_progress',
      last_agent_run_at: new Date(NOW - 10 * DAY).toISOString(),
    }],
    recentRunsByTaskId: { td: NOW - 1 * HOUR },
  });
  assertEqual(d.length, 0, 'stalled: recentRunsByTaskId overrides stale row timestamp');

  // Custom threshold: 2 days makes a 3-day-old run stalled
  const e = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 'te', title: 'Custom N', status: 'in_progress' }],
    recentRunsByTaskId: { te: NOW - 3 * DAY },
    stalledAfterDays: 2,
  });
  assertEqual(e[0]?.kind, 'task_stalled', 'stalled: custom stalledAfterDays honored');

  // Non-in-progress task never stalls
  const f = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 'tf', title: 'Todo', status: 'todo' }],
  });
  assertEqual(f.length, 0, 'stalled: todo status does not stall');
}

// ── 4. Blocked detection ─────────────────────────────────────────────────────

{
  const items = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{
      id: 'tblk', title: 'Blocked one', status: 'in_progress',
      last_agent_run_status: 'blocked',
      last_agent_run_at: new Date(NOW - 2 * DAY).toISOString(),
    }],
    recentRunsByTaskId: { tblk: NOW - 2 * DAY },
  });
  assertEqual(items.length, 1, 'blocked: single deduped item for blocked+stalled-candidate task');
  assertEqual(items[0]?.kind, 'task_blocked', 'blocked: blocked outranks stalled for same task');
  assert(items[0]!.reason.includes('2d ago'), 'blocked: reason carries age', items[0]!.reason);
}

// ── 5. Dedupe + bound ────────────────────────────────────────────────────────

{
  // Same task simultaneously overdue AND stalled → ONE item, overdue wins.
  const dup = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{
      id: 'tdup', title: 'Overdue and stalled', status: 'in_progress', due_date: '2026-07-20',
    }],
  });
  assertEqual(dup.length, 1, 'dedupe: one item per task');
  assertEqual(dup[0]?.kind, 'task_overdue', 'dedupe: higher-severity kind (overdue) wins');

  // 20 overdue tasks → bounded to DEFAULT_MAX_ITEMS (8)
  const many = buildNeedsAttention({
    nowMs: NOW,
    tasks: Array.from({ length: 20 }, (_, i) => ({
      id: `bulk-${String(i).padStart(2, '0')}`, title: `Bulk ${i}`, status: 'todo', due_date: '2026-07-20',
    })),
  });
  assertEqual(many.length, DEFAULT_MAX_ITEMS, 'bound: capped at DEFAULT_MAX_ITEMS');

  // custom maxItems
  const three = buildNeedsAttention({
    nowMs: NOW,
    tasks: Array.from({ length: 20 }, (_, i) => ({
      id: `b2-${String(i).padStart(2, '0')}`, title: `B2 ${i}`, status: 'todo', due_date: '2026-07-20',
    })),
    maxItems: 3,
  });
  assertEqual(three.length, 3, 'bound: custom maxItems honored');

  // Stable ordering: equal scores tie-break by key ascending, deterministic
  // regardless of input order.
  const inputA: NeedsAttentionInput = {
    nowMs: NOW,
    tasks: [
      { id: 'tie-b', title: 'B', status: 'todo', due_date: '2026-07-20' },
      { id: 'tie-a', title: 'A', status: 'todo', due_date: '2026-07-20' },
    ],
  };
  const inputB: NeedsAttentionInput = {
    nowMs: NOW,
    tasks: [...(inputA.tasks as any[])].reverse(),
  };
  const orderA = buildNeedsAttention(inputA).map(i => i.key).join(',');
  const orderB = buildNeedsAttention(inputB).map(i => i.key).join(',');
  assertEqual(orderA, orderB, 'ordering: deterministic regardless of input order');
  assertEqual(orderA, 'task_overdue:tie-a,task_overdue:tie-b', 'ordering: key-ascending tie-break');
}

// ── 6. Totality: malformed inputs never throw ────────────────────────────────

{
  let threw = false;
  let results: NeedsAttentionItem[][] = [];
  try {
    results = [
      buildNeedsAttention(undefined as any),
      buildNeedsAttention(null as any),
      buildNeedsAttention({} as any),
      buildNeedsAttention({ nowMs: NaN } as any),
      buildNeedsAttention({ nowMs: NOW, tasks: 'garbage' as any, missions: 42 as any }),
      buildNeedsAttention({
        nowMs: NOW,
        tasks: [null, undefined, {}, { id: '' }, { id: 't', due_date: 'not-a-date', status: 7 }, 'str'] as any,
        missions: [null, { id: 'm', status: 'active', deadline: 'garbage' }, { status: 'active' }] as any,
        recentRunsByTaskId: 'nope' as any,
      }),
      buildNeedsAttention({ nowMs: NOW, maxItems: -5, stalledAfterDays: NaN, dueSoonMs: -1 }),
    ];
  } catch (err) {
    threw = true;
    console.error('threw:', err);
  }
  assert(!threw, 'totality: no malformed input throws');
  assert(results.every(r => Array.isArray(r)), 'totality: every result is an array');
  assertEqual(results[0]!.length, 0, 'totality: undefined input → []');
  assertEqual(results[3]!.length, 0, 'totality: NaN nowMs → []');
  assertEqual(results[5]!.length, 0, 'totality: garbage rows produce no items (bad dates skipped)');
}

// ── 7. suggestedAction shape ─────────────────────────────────────────────────

{
  const longTitle = 'X'.repeat(200);
  const items = buildNeedsAttention({
    nowMs: NOW,
    tasks: [
      { id: 's1', title: longTitle, status: 'todo', due_date: '2026-07-20' },
      { id: 's2', title: 'Stall "me"', status: 'in_progress' },
    ],
    missions: [{ id: 'sm', title: 'Mission', status: 'active', deadline: new Date(NOW - DAY).toISOString() }],
  });
  assert(items.length >= 3, 'action: items produced for shape check');
  for (const item of items) {
    assert(
      typeof item.suggestedAction?.label === 'string' && item.suggestedAction.label.length > 0,
      `action: ${item.kind} has non-empty label`,
    );
    assert(
      item.suggestedAction.seedCommand === undefined || typeof item.suggestedAction.seedCommand === 'string',
      `action: ${item.kind} seedCommand is string-or-absent`,
    );
  }
  const overdueItem = items.find(i => i.taskId === 's1')!;
  assert(
    (overdueItem.suggestedAction.seedCommand || '').length < 160,
    'action: seedCommand bounded even with a 200-char title',
    String(overdueItem.suggestedAction.seedCommand?.length),
  );
  const stalledItem = items.find(i => i.taskId === 's2')!;
  assert(
    !(stalledItem.suggestedAction.seedCommand || '').includes('"me"'),
    'action: double quotes in titles are neutralized in seedCommand',
  );
}

// ── 8. COMPOSITION: kind matches the REAL evaluateSla verdict ────────────────

{
  const DUE_SOON_MS = 24 * HOUR; // core default for tasks
  const cases: Array<{ id: string; dueAt: number }> = [
    { id: 'comp-late', dueAt: NOW - 3 * DAY },   // → breached (grace 0)
    { id: 'comp-soon', dueAt: NOW + 6 * HOUR },  // → due_soon
    { id: 'comp-ok', dueAt: NOW + 10 * DAY },    // → ok (no item)
  ];

  for (const c of cases) {
    // The REAL SLA brain's verdict for the exact same dueAt/now/window:
    const sla = evaluateSla({ dueAt: c.dueAt, now: NOW, dueSoonMs: DUE_SOON_MS });
    const expectedKind = slaLevelToTaskKind(sla.level);

    const items = buildNeedsAttention({
      nowMs: NOW,
      tasks: [{ id: c.id, title: c.id, status: 'todo', due_date: new Date(c.dueAt).toISOString() }],
    });

    if (expectedKind === null) {
      assertEqual(items.length, 0, `composition: SLA '${sla.level}' → no nag item (${c.id})`);
    } else {
      assertEqual(items.length, 1, `composition: SLA '${sla.level}' → one nag item (${c.id})`);
      assertEqual(items[0]?.kind, expectedKind, `composition: kind matches SLA verdict '${sla.level}' (${c.id})`);
    }
  }

  // And the reason's age agrees with the SLA's msOverdue for the late case.
  const lateSla = evaluateSla({ dueAt: NOW - 3 * DAY, now: NOW, dueSoonMs: DUE_SOON_MS });
  const lateItems = buildNeedsAttention({
    nowMs: NOW,
    tasks: [{ id: 'comp-age', title: 'x', status: 'todo', due_date: new Date(NOW - 3 * DAY).toISOString() }],
  });
  assert(
    lateItems[0]!.reason.includes(`overdue by ${formatAgeShort(lateSla.msOverdue)}`),
    'composition: item age is formatted from the SLA msOverdue',
    lateItems[0]!.reason,
  );
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\naccountability-nag-core: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
