/**
 * computer-task-schedule-model-smoketest — verifies the recurring-watch
 * schedule model (Phase 6a of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md):
 * cadence interval math, next-run computation, the runner due-check,
 * watch-task validation (whitespace, empty, bounds, approval-floor
 * rejection), and the created/update chat message formats + bounds.
 *
 * Run: npx tsx scripts/computer-task-schedule-model-smoketest.ts
 */

import {
  MAX_ACTIVE_WATCHES,
  WATCH_TASK_MAX_CHARS,
  cadenceIntervalMs,
  computeNextRunAtIso,
  describeWatchCadence,
  formatWatchCreatedMessage,
  formatWatchUpdateMessage,
  isScheduleDue,
  validateWatchTask,
} from '../src/lib/computerTaskScheduleModel';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Cadence interval math ────────────────────────────────────────────────────
{
  expect(cadenceIntervalMs('hourly') === 3_600_000, 'hourly interval is 3_600_000 ms');
  expect(cadenceIntervalMs('daily') === 86_400_000, 'daily interval is 86_400_000 ms');
  expect(cadenceIntervalMs('weekly') === 604_800_000, 'weekly interval is 604_800_000 ms');
  expect(MAX_ACTIVE_WATCHES === 10 && WATCH_TASK_MAX_CHARS === 500, 'caps exported as documented');
  pass('cadence interval math');
}

// ── Next-run computation ─────────────────────────────────────────────────────
{
  const from = Date.parse('2026-07-01T12:00:00.000Z');
  expect(computeNextRunAtIso('hourly', from) === '2026-07-01T13:00:00.000Z', 'hourly → +1h as ISO');
  expect(computeNextRunAtIso('daily', from) === '2026-07-02T12:00:00.000Z', 'daily → +1d as ISO');
  expect(computeNextRunAtIso('weekly', from) === '2026-07-08T12:00:00.000Z', 'weekly → +7d as ISO');
  expect(
    computeNextRunAtIso('daily', from) === new Date(from + cadenceIntervalMs('daily')).toISOString(),
    'next run is exactly fromMs + interval',
  );
  pass('next-run computation');
}

// ── Due-check ────────────────────────────────────────────────────────────────
{
  const now = Date.parse('2026-07-01T12:00:00.000Z');
  expect(!isScheduleDue({ active: false, next_run_at: '2026-07-01T00:00:00.000Z' }, now), 'inactive watch is never due');
  expect(!isScheduleDue({ active: true, next_run_at: '2026-07-01T13:00:00.000Z' }, now), 'future next_run_at is not due');
  expect(isScheduleDue({ active: true, next_run_at: '2026-07-01T11:00:00.000Z' }, now), 'past next_run_at is due');
  expect(isScheduleDue({ active: true, next_run_at: '2026-07-01T12:00:00.000Z' }, now), 'exactly-now is due (<=)');
  expect(!isScheduleDue({ active: true, next_run_at: 'not-a-timestamp' }, now), 'garbage next_run_at fails closed (never due)');
  pass('due-check: inactive / future / past / garbage');
}

// ── Watch-task validation ────────────────────────────────────────────────────
{
  const clean = validateWatchTask('  check   Hacker News   for BlackSwan posts ', { floorCategories: [] });
  expect(clean.ok && clean.task === 'check Hacker News for BlackSwan posts', 'trims + collapses whitespace');

  const empty = validateWatchTask('   ', { floorCategories: [] });
  expect(!empty.ok && empty.error.length > 0, 'blank task rejected with an error');

  const oversize = validateWatchTask(`check ${'x'.repeat(600)}`, { floorCategories: [] });
  expect(
    oversize.ok && oversize.task.length <= WATCH_TASK_MAX_CHARS && oversize.task.endsWith('…'),
    'oversize task clamped to WATCH_TASK_MAX_CHARS with trailing …',
  );

  const floored = validateWatchTask('pay my utility bill every day', { floorCategories: ['pay'] });
  expect(!floored.ok, 'approval-floor category rejects the watch');
  expect(!floored.ok && floored.error.includes('pay'), 'rejection names the detected category');
  expect(!floored.ok && floored.error.toLowerCase().includes('read-only'), 'rejection explains watches are read-only monitoring');

  const multiFloor = validateWatchTask('buy it then delete the listing', { floorCategories: ['pay', 'delete'] });
  expect(!multiFloor.ok && multiFloor.error.includes('pay') && multiFloor.error.includes('delete'), 'multiple categories all named');
  pass('watch-task validation');
}

// ── Cadence phrases ──────────────────────────────────────────────────────────
{
  expect(describeWatchCadence('hourly') === 'every hour', "hourly → 'every hour'");
  expect(describeWatchCadence('daily') === 'every day', "daily → 'every day'");
  expect(describeWatchCadence('weekly') === 'every week', "weekly → 'every week'");
  pass('cadence phrases');
}

// ── Created message ──────────────────────────────────────────────────────────
{
  const created = formatWatchCreatedMessage({
    task: 'check flight prices to Tokyo',
    cadence: 'daily',
    notifyOn: 'changes_only',
  });
  expect(created.includes('🔁 Watching: "check flight prices to Tokyo"'), 'created message quotes the task');
  expect(created.includes('every day'), 'created message mentions the cadence phrase');
  expect(created.includes('only when something changes'), 'changes_only → changes-only wording');
  expect(created.includes('Manage watches in Office'), 'created message points at Office management');

  const always = formatWatchCreatedMessage({ task: 'watch the deploy page', cadence: 'hourly', notifyOn: 'always' });
  expect(always.includes('after every check') && always.includes('every hour'), "always → 'after every check' wording");

  const long = formatWatchCreatedMessage({ task: 'x'.repeat(300), cadence: 'weekly', notifyOn: 'changes_only' });
  expect(long.includes('…') && long.length < 300, 'created message bounds the task at 120');
  pass('created message copy + bounds');
}

// ── Update message ───────────────────────────────────────────────────────────
{
  const errored = formatWatchUpdateMessage({
    task: 'watch the release page',
    diffSummary: '**Since the last run: 1 new.**',
    runSummary: 'ran fine',
    errorMessage: 'Browserbase session expired',
  });
  expect(errored.startsWith('🔁 Watch update — "watch the release page"'), 'update header format');
  expect(errored.includes('Check failed: Browserbase session expired'), 'error takes priority in the body');
  expect(!errored.includes('Since the last run'), 'diff suppressed when the check failed');

  const diffed = formatWatchUpdateMessage({
    task: 'watch the release page',
    diffSummary: '**Since the last run: 2 new.**',
    runSummary: 'irrelevant fallback',
    errorMessage: null,
  });
  expect(diffed.includes('Since the last run: 2 new') && !diffed.includes('irrelevant fallback'), 'diff beats plain run summary');

  const summaryOnly = formatWatchUpdateMessage({
    task: 'watch the release page',
    diffSummary: null,
    runSummary: 'Found 3 listings under $200.',
    errorMessage: null,
  });
  expect(summaryOnly.includes('Found 3 listings under $200.'), 'run summary used when there is no diff');

  const emptyBody = formatWatchUpdateMessage({ task: 't', diffSummary: null, runSummary: null });
  expect((emptyBody.split('\n')[1] || '').length > 0, 'no error/diff/summary still yields a body line');

  const oversized = formatWatchUpdateMessage({
    task: 'T'.repeat(300),
    diffSummary: 'd'.repeat(2000),
    runSummary: null,
  });
  expect(oversized.length <= 800, 'oversized update message stays ≤ 800 chars');
  expect(oversized.includes('…'), 'oversized task/body clamped with …');
  expect(!oversized.includes('T'.repeat(81)), 'header task bounded at 80');

  const oversizedError = formatWatchUpdateMessage({
    task: 'watch it',
    diffSummary: null,
    runSummary: null,
    errorMessage: 'e'.repeat(1000),
  });
  expect(oversizedError.length <= 800 && oversizedError.includes('Check failed: '), 'oversized error message bounded');
  expect(!oversizedError.includes('e'.repeat(201)), 'error body clamped to 200');
  pass('update message priority + bounds');
}

if (failures > 0) {
  console.error(`\n${failures} computer-task schedule model smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-task schedule model smoke cases passed.');
