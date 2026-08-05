/**
 * deadline-sla-core-smoketest — guards the PURE deadline / SLA core:
 *
 *   - evaluateSla bucketing: ok → due_soon → overdue → breached, including the
 *     exact-dueAt boundary (due_soon, msRemaining 0) and the grace=0 case where
 *     a deadline breaches the instant it passes.
 *   - msRemaining / msOverdue arithmetic.
 *   - nextDueAt: catch-up over several missed intervals, landing strictly after
 *     `now` and ON the grid; the intervalMs<=0 guard; future-anchor rule.
 *   - NaN / negative / undefined guards on every input (never throws).
 *
 * Imports the REAL module (pure, zero runtime imports).
 *
 * Run: npx tsx scripts/deadline-sla-core-smoketest.ts
 */

import {
  evaluateSla,
  nextDueAt,
  describeSla,
  DEFAULT_DUE_SOON_MS,
  type SlaLevel,
  type SlaState,
} from '../src/lib/deadlineSlaCore';

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

const HOUR = 3_600_000;
const DAY = 86_400_000;
const T = 1_000_000_000_000; // arbitrary fixed epoch anchor

// ── evaluateSla: level bucketing (defaults: dueSoonMs=1h, grace=0) ────────────
assertEqual(DEFAULT_DUE_SOON_MS, HOUR, 'default due-soon window is one hour');

// ok: well before the window
assertEqual(evaluateSla({ dueAt: T + DAY, now: T }).level, 'ok', 'far before due → ok');

// due_soon: inside the 1h window but not yet due
assertEqual(
  evaluateSla({ dueAt: T + HOUR, now: T + HOUR - 60_000 }).level,
  'due_soon',
  'inside the due-soon window → due_soon',
);

// boundary: now exactly at the start of the window (now == dueAt - dueSoonMs) is still ok
assertEqual(
  evaluateSla({ dueAt: T + HOUR, now: T }).level,
  'ok',
  'now == dueAt - dueSoonMs → ok (window is exclusive at the top)',
);
// one ms into the window flips to due_soon
assertEqual(
  evaluateSla({ dueAt: T + HOUR, now: T + 1 }).level,
  'due_soon',
  'one ms past the window start → due_soon',
);

// boundary: now exactly at dueAt → due_soon with msRemaining 0
{
  const s = evaluateSla({ dueAt: T, now: T });
  assertEqual(s.level, 'due_soon', 'now == dueAt → due_soon');
  assertEqual(s.msRemaining, 0, 'now == dueAt → msRemaining 0');
  assertEqual(s.msOverdue, 0, 'now == dueAt → msOverdue 0');
  assert(/due now/i.test(s.reason), 'now == dueAt reason says due now', s.reason);
}

// grace=0: one ms past dueAt → breached immediately (no overdue band)
assertEqual(
  evaluateSla({ dueAt: T, now: T + 1 }).level,
  'breached',
  'grace 0 → breached the instant after due',
);

// overdue: within an explicit grace window
{
  const s = evaluateSla({ dueAt: T, now: T + 5 * 60_000, breachGraceMs: 10 * 60_000 });
  assertEqual(s.level, 'overdue', 'past due but within grace → overdue');
  assert(/grace/i.test(s.reason), 'overdue reason mentions grace', s.reason);
}
// boundary: now exactly at dueAt + grace → still overdue (band is inclusive at the top)
assertEqual(
  evaluateSla({ dueAt: T, now: T + 10 * 60_000, breachGraceMs: 10 * 60_000 }).level,
  'overdue',
  'now == dueAt + grace → overdue',
);
// one ms past the grace → breached
assertEqual(
  evaluateSla({ dueAt: T, now: T + 10 * 60_000 + 1, breachGraceMs: 10 * 60_000 }).level,
  'breached',
  'one ms past grace → breached',
);

// custom dueSoonMs window
assertEqual(
  evaluateSla({ dueAt: T + DAY, now: T + DAY - 60_000, dueSoonMs: 2 * DAY }).level,
  'due_soon',
  'wide custom due-soon window catches a distant deadline',
);

// ── evaluateSla: msRemaining / msOverdue math ─────────────────────────────────
{
  const s = evaluateSla({ dueAt: T + HOUR, now: T });
  assertEqual(s.msRemaining, HOUR, 'msRemaining = dueAt - now when before due');
  assertEqual(s.msOverdue, 0, 'msOverdue is 0 while before due');
}
{
  const s = evaluateSla({ dueAt: T, now: T + 45 * 60_000 });
  assertEqual(s.msOverdue, 45 * 60_000, 'msOverdue = now - dueAt when past due');
  assertEqual(s.msRemaining, 0, 'msRemaining is 0 once past due');
}

// ── evaluateSla: NaN / undefined / negative guards (never throw) ──────────────
{
  const s = evaluateSla({ dueAt: NaN, now: T });
  assertEqual(s.level, 'ok', 'NaN dueAt → ok');
  assertEqual(s.msRemaining, 0, 'NaN dueAt → msRemaining 0');
  assertEqual(s.msOverdue, 0, 'NaN dueAt → msOverdue 0');
}
assertEqual(evaluateSla({ dueAt: T, now: NaN }).level, 'ok', 'NaN now → ok');
assertEqual(evaluateSla({ dueAt: T, now: T + 1, breachGraceMs: NaN }).level, 'breached', 'NaN grace falls back to 0 → breached after due');
assertEqual(
  evaluateSla({ dueAt: T + HOUR, now: T + HOUR - 60_000, dueSoonMs: NaN }).level,
  'due_soon',
  'NaN dueSoonMs falls back to 1h default',
);
// negative window falls back to the default (never a negative duration)
assertEqual(
  evaluateSla({ dueAt: T + HOUR, now: T + HOUR - 60_000, dueSoonMs: -5 }).level,
  'due_soon',
  'negative dueSoonMs falls back to default',
);
assertEqual(evaluateSla({ dueAt: T, now: T + 1, breachGraceMs: -1000 }).level, 'breached', 'negative grace falls back to 0');
// @ts-expect-error — intentional: undefined args must not throw
assertEqual(evaluateSla(undefined).level, 'ok', 'undefined args → ok (no throw)');
// @ts-expect-error — intentional: empty object must not throw
assertEqual(evaluateSla({}).level, 'ok', 'empty args → ok (no throw)');
assertEqual(evaluateSla({ dueAt: Infinity, now: T }).level, 'ok', 'Infinity dueAt guarded → ok');

// ── nextDueAt: catch-up over several missed intervals ─────────────────────────
{
  // anchor at T, hourly; now is 3h40m later → 4 intervals have elapsed, so the
  // next tick after now is T + 4h. Landed strictly after now and on the grid.
  const now = T + 3 * HOUR + 40 * 60_000;
  const next = nextDueAt(T, HOUR, now);
  assertEqual(next, T + 4 * HOUR, 'catch-up over 3 missed intervals → next is the 4th tick');
  assert(next > now, 'catch-up result is strictly after now', `next=${next} now=${now}`);
  assertEqual((next - T) % HOUR, 0, 'catch-up result sits exactly on the interval grid');
}
{
  // many missed intervals — O(1), no loop: 1000 days of hourly ticks
  const now = T + 1000 * DAY + 123;
  const next = nextDueAt(T, HOUR, now);
  assert(next > now, 'far catch-up lands strictly after now', `next=${next} now=${now}`);
  assertEqual((next - T) % HOUR, 0, 'far catch-up stays on the grid');
  assert(next - now <= HOUR, 'far catch-up is within one interval of now (smallest such tick)', `gap=${next - now}`);
}
// now exactly ON a grid point → must advance to the NEXT tick (strictly greater)
{
  const now = T + 5 * HOUR;
  const next = nextDueAt(T, HOUR, now);
  assertEqual(next, T + 6 * HOUR, 'now exactly on grid → advances to the next tick (strict >)');
  assert(next > now, 'on-grid now still yields a strictly-later tick');
}
// now just before the first tick → first tick is the anchor + interval
assertEqual(nextDueAt(T, HOUR, T + 1), T + HOUR, 'just after anchor → first interval tick');
// now == anchor → first tick after it
assertEqual(nextDueAt(T, HOUR, T), T + HOUR, 'now == anchor → first tick is anchor + interval');

// ── nextDueAt: guards ─────────────────────────────────────────────────────────
assertEqual(nextDueAt(T, 0, T + DAY), T, 'intervalMs 0 → returns lastRunAt (cannot advance)');
assertEqual(nextDueAt(T, -HOUR, T + DAY), T, 'negative intervalMs → returns lastRunAt');
assertEqual(nextDueAt(T, NaN, T + DAY), T, 'NaN intervalMs → returns lastRunAt');
assertEqual(nextDueAt(NaN, HOUR, T), 0, 'NaN lastRunAt → 0');
assertEqual(nextDueAt(T, HOUR, NaN), T + HOUR, 'NaN now → one interval after anchor');
// future anchor (lastRunAt > now) → anchor + interval
assertEqual(nextDueAt(T + DAY, HOUR, T), T + DAY + HOUR, 'future anchor → anchor + interval');
// @ts-expect-error — intentional: undefined interval must not throw
assertEqual(nextDueAt(T, undefined, T), T, 'undefined interval → returns lastRunAt (no throw)');

// ── describeSla ───────────────────────────────────────────────────────────────
{
  const s: SlaState = { level: 'breached', msRemaining: 0, msOverdue: DAY, reason: 'breached — ~1d past due' };
  const line = describeSla(s);
  assert(line.includes('BREACHED'), 'describeSla surfaces the level label', line);
  assert(line.includes('past due'), 'describeSla carries the reason', line);
}
assert(typeof describeSla({ level: 'ok' } as SlaState).includes === 'function', 'describeSla returns a string for a partial state');
// @ts-expect-error — intentional: undefined state must not throw
assert(describeSla(undefined).includes('OK'), 'describeSla(undefined) degrades to OK (no throw)');
{
  // unknown level coerces to OK rather than leaking a bogus label
  const line = describeSla({ level: 'weird' as SlaLevel, msRemaining: 0, msOverdue: 0, reason: 'x' });
  assert(line.startsWith('[OK]'), 'describeSla coerces an unknown level to OK', line);
}

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`deadline-sla-core smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
