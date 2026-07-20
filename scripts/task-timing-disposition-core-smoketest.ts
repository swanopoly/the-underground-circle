/**
 * task-timing-disposition-core-smoketest — the PURE "when does this task run?"
 * front-door router (src/lib/taskTimingDispositionCore.ts). Load-bearing behavior
 * asserted here:
 *
 *   - decideTaskTiming: a FIRST-MATCH priority ladder — blockingResource (defer)
 *     beats recurrenceHint (recurring) beats an explicit FUTURE instant
 *     (schedule_once) beats an expensive on-hours off-hours defer (schedule_once)
 *     beats the run_now default — verified by peeling one signal off at a time.
 *   - explicit time: future → schedule_once AT that ms (conf 0.9); at/behind now
 *     → run_now:explicit_time_in_past (conf 0.7), never a past instant; no usable
 *     clock → falls through to run_now:default.
 *   - off-hours defer: expensive + on_hours + known FUTURE window → schedule_once
 *     at the window; cheap / off_hours-now / no-window / past-window / unknown
 *     bucket → run_now. isExpensiveForOffHours boundaries: 0.5 and 120000 are NOT
 *     over (strict >), negatives / non-finite read as not over.
 *   - signalsFired: an independent fixed-order diagnostic snapshot, bounded to
 *     MAX_SIGNALS_FIRED, every token from the frozen vocabulary.
 *   - describeTimingDecision: a bounded, control-clean, secret-safe one-liner.
 *   - DETERMINISM: identical input twice → identical JSON.
 *   - HOSTILE: null / undefined / number / {} / [] / NaN / ±Infinity / bigint /
 *     huge / control-chars / cyclic / throwing-proxy / __proto__+constructor keys
 *     / path-traversal label never throw and yield a well-formed, bounded,
 *     code-point-clean decision (no split surrogate, no pollution).
 *
 * Pure — loads under tsx (taskTimingDispositionCore has zero imports).
 * Run: npx tsx scripts/task-timing-disposition-core-smoketest.ts
 */

import {
  decideTaskTiming,
  isExpensiveForOffHours,
  describeTimingDecision,
  MAX_REASON_CHARS,
  MAX_BLOCKED_ON_CHARS,
  MAX_RECURRENCE_HINT_CHARS,
  MAX_SIGNALS_FIRED,
  OFF_HOURS_COST_THRESHOLD_USD,
  OFF_HOURS_DURATION_THRESHOLD_MS,
  TIMING_REASON,
  TIMING_REASON_CODES,
  TIMING_SIGNAL_TOKENS,
  type TimingDecision,
  type TaskTimingSignals,
} from '../src/lib/taskTimingDispositionCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertLE(a: number, b: number, m: string): void {
  assert(typeof a === 'number' && a <= b, m, 'got ' + a + ' want <= ' + b);
}
function assertIncludes(hay: unknown, needle: string, m: string): void {
  assert(typeof hay === 'string' && hay.includes(needle), m, JSON.stringify(hay) + ' missing "' + needle + '"');
}
function assertNoThrow(fn: () => void, m: string): void {
  let threw = false;
  let err = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    err = String(e);
  }
  assert(!threw, m, err);
}

// ── code-point + control-char helpers ────────────────────────────────────────
const cpLen = (s: string): number => Array.from(s).length;

/** No control / DEL / C1 / line-separator chars — and none of the zero-width /
 *  bidi format controls sanitizeLabel strips, INCLUDING the Trojan-Source isolates
 *  U+2066-U+2069 (LRI/RLI/FSI/PDI) and U+061C (ALM). (single-line strings). */
function noControlChars(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return false;
    if (
      c === 0x061c ||
      (c >= 0x200b && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      c === 0x2060 ||
      (c >= 0x2066 && c <= 0x2069) ||
      c === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}
/** True if the string ends up with a split/lone surrogate anywhere. */
function hasLoneSurrogate(s: string): boolean {
  for (const ch of Array.from(s)) {
    if (ch.length === 1) {
      const c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
  }
  return false;
}

// ── control / hostile character fixtures (built, never pasted raw) ───────────
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const DEL = String.fromCharCode(0x7f);
const C1 = String.fromCharCode(0x9f);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ZW = String.fromCharCode(0x200b);
const BOM = String.fromCharCode(0xfeff);
const LONE_HI = String.fromCharCode(0xd800); // lone high surrogate
const LONE_LO = String.fromCharCode(0xdc00); // lone low surrogate
const EMOJI = String.fromCodePoint(0x1f600); // 😀 valid surrogate pair
const COMBINING = String.fromCharCode(0x0301); // combining acute accent
// Trojan-Source (CVE-2021-42574) invisible bidi directional-formatting controls.
const LRI = String.fromCharCode(0x2066); // LEFT-TO-RIGHT ISOLATE
const RLI = String.fromCharCode(0x2067); // RIGHT-TO-LEFT ISOLATE
const FSI = String.fromCharCode(0x2068); // FIRST STRONG ISOLATE
const PDI = String.fromCharCode(0x2069); // POP DIRECTIONAL ISOLATE
const ALM = String.fromCharCode(0x061c); // ARABIC LETTER MARK
const ctrlStr = 'a' + NUL + BEL + TAB + NL + CR + DEL + C1 + LS + PS + ZW + BOM + 'b';

// A stable, injected "now" — deterministic; the core reads no clock.
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

// ── structural + bounds check for a TimingDecision ───────────────────────────
function wellFormed(d: unknown): boolean {
  if (!d || typeof d !== 'object') return false;
  const t = d as TimingDecision;
  const dispOk =
    t.disposition === 'run_now' ||
    t.disposition === 'schedule_once' ||
    t.disposition === 'recurring' ||
    t.disposition === 'defer_until_unblocked';
  if (!dispOk) return false;
  const runAtOk = t.runAtMs === null || (typeof t.runAtMs === 'number' && Number.isFinite(t.runAtMs));
  const recOk =
    t.recurrenceHint === null ||
    (typeof t.recurrenceHint === 'string' &&
      cpLen(t.recurrenceHint) <= MAX_RECURRENCE_HINT_CHARS &&
      noControlChars(t.recurrenceHint) &&
      !hasLoneSurrogate(t.recurrenceHint));
  const blkOk =
    t.blockedOn === null ||
    (typeof t.blockedOn === 'string' &&
      cpLen(t.blockedOn) <= MAX_BLOCKED_ON_CHARS &&
      noControlChars(t.blockedOn) &&
      !hasLoneSurrogate(t.blockedOn));
  const reasonOk =
    typeof t.reason === 'string' &&
    t.reason.length > 0 &&
    cpLen(t.reason) <= MAX_REASON_CHARS &&
    noControlChars(t.reason) &&
    TIMING_REASON_CODES.indexOf(t.reason) >= 0;
  const confOk = typeof t.confidence === 'number' && Number.isFinite(t.confidence) && t.confidence >= 0 && t.confidence <= 1;
  const sigOk =
    Array.isArray(t.signalsFired) &&
    t.signalsFired.length <= MAX_SIGNALS_FIRED &&
    t.signalsFired.every((s) => typeof s === 'string' && TIMING_SIGNAL_TOKENS.indexOf(s) >= 0);
  if (!(runAtOk && recOk && blkOk && reasonOk && confOk && sigOk)) return false;

  // Cross-field invariants: exactly the sink-relevant field is populated.
  switch (t.disposition) {
    case 'schedule_once':
      return typeof t.runAtMs === 'number' && Number.isFinite(t.runAtMs) && t.recurrenceHint === null && t.blockedOn === null;
    case 'recurring':
      return t.runAtMs === null && typeof t.recurrenceHint === 'string' && t.recurrenceHint.length > 0 && t.blockedOn === null;
    case 'defer_until_unblocked':
      return t.runAtMs === null && t.recurrenceHint === null && typeof t.blockedOn === 'string' && t.blockedOn.length > 0;
    case 'run_now':
      return t.runAtMs === null && t.recurrenceHint === null && t.blockedOn === null;
    default:
      return false;
  }
}

/** Fixed-order subsequence check against the canonical token vocabulary. */
function isOrderedSubsequence(fired: string[]): boolean {
  let last = -1;
  for (const tok of fired) {
    const idx = TIMING_SIGNAL_TOKENS.indexOf(tok);
    if (idx <= last) return false;
    last = idx;
  }
  return true;
}

function main(): void {
  // ─── (A) ladder priority — peel one signal off at a time ────────────────────
  const allSet: TaskTimingSignals = {
    nowMs: NOW,
    blockingResource: 'nightly export',
    recurrenceHint: 'every day at 9am',
    explicitRunAtMs: NOW + HOUR,
    hoursBucket: 'on_hours',
    nextOffHoursStartMs: NOW + 2 * HOUR,
    estimatedCostUsd: 5,
    estimatedDurationMs: 300_000,
  };
  const dAll = decideTaskTiming(allSet);
  assert(wellFormed(dAll), '(A) all-signals decision well-formed', JSON.stringify(dAll));
  assertEq(dAll.disposition, 'defer_until_unblocked', '(A) blockingResource wins the ladder');
  assertEq(dAll.blockedOn, 'nightly export', '(A) blockedOn echoes the resource');
  assertEq(dAll.runAtMs, null, '(A) defer has no runAtMs');
  assertEq(dAll.recurrenceHint, null, '(A) defer has no recurrenceHint');
  assertEq(dAll.reason, TIMING_REASON.DEFER_RESOURCE, '(A) defer reason code');
  assertEq(dAll.confidence, 0.9, '(A) defer confidence 0.9');
  assertEq(
    JSON.stringify(dAll.signalsFired),
    JSON.stringify(['blocking_resource', 'recurrence_hint', 'explicit_time_future', 'expensive', 'on_hours', 'next_off_hours_known']),
    '(A) signalsFired is the full fixed-order snapshot',
  );

  const noBlock = decideTaskTiming({ ...allSet, blockingResource: null });
  assertEq(noBlock.disposition, 'recurring', '(A) without blocking → recurring wins');
  assertEq(noBlock.recurrenceHint, 'every day at 9am', '(A) recurrenceHint echoed');
  assertEq(noBlock.runAtMs, null, '(A) recurring has no runAtMs');
  assertEq(noBlock.blockedOn, null, '(A) recurring has no blockedOn');
  assertEq(noBlock.reason, TIMING_REASON.RECURRING_CADENCE, '(A) recurring reason code');
  assertEq(noBlock.confidence, 0.85, '(A) recurring confidence 0.85');
  assert(wellFormed(noBlock), '(A) recurring decision well-formed');

  const noRec = decideTaskTiming({ ...allSet, blockingResource: null, recurrenceHint: null });
  assertEq(noRec.disposition, 'schedule_once', '(A) without recurrence → explicit future wins');
  assertEq(noRec.runAtMs, NOW + HOUR, '(A) schedule_once at the explicit instant');
  assertEq(noRec.reason, TIMING_REASON.SCHEDULE_EXPLICIT, '(A) explicit schedule reason code');
  assertEq(noRec.confidence, 0.9, '(A) explicit schedule confidence 0.9');
  assert(wellFormed(noRec), '(A) explicit schedule well-formed');

  const noExplicit = decideTaskTiming({ ...allSet, blockingResource: null, recurrenceHint: null, explicitRunAtMs: null });
  assertEq(noExplicit.disposition, 'schedule_once', '(A) without explicit → off-hours defer wins');
  assertEq(noExplicit.runAtMs, NOW + 2 * HOUR, '(A) schedule_once at the off-hours window');
  assertEq(noExplicit.reason, TIMING_REASON.SCHEDULE_OFF_HOURS, '(A) off-hours reason code');
  assertEq(noExplicit.confidence, 0.6, '(A) off-hours confidence 0.6');
  assert(wellFormed(noExplicit), '(A) off-hours schedule well-formed');

  const bare = decideTaskTiming({
    ...allSet,
    blockingResource: null,
    recurrenceHint: null,
    explicitRunAtMs: null,
    estimatedCostUsd: 0.1,
    estimatedDurationMs: 1_000,
  });
  assertEq(bare.disposition, 'run_now', '(A) cheap + no other signal → run_now');
  assertEq(bare.reason, TIMING_REASON.RUN_NOW_DEFAULT, '(A) default reason code');
  assertEq(bare.confidence, 0.8, '(A) default confidence 0.8');
  assertEq(bare.runAtMs, null, '(A) run_now has no runAtMs');
  assert(wellFormed(bare), '(A) run_now default well-formed');

  // ─── (B) explicit time ──────────────────────────────────────────────────────
  const future = decideTaskTiming({ nowMs: NOW, explicitRunAtMs: NOW + 1_000 });
  assertEq(future.disposition, 'schedule_once', '(B) future instant → schedule_once');
  assertEq(future.runAtMs, NOW + 1_000, '(B) runAtMs is the explicit instant');
  assertEq(future.reason, TIMING_REASON.SCHEDULE_EXPLICIT, '(B) future reason code');
  assert(future.signalsFired.indexOf('explicit_time_future') >= 0, '(B) explicit_time_future fired');

  const past = decideTaskTiming({ nowMs: NOW, explicitRunAtMs: NOW - 1_000 });
  assertEq(past.disposition, 'run_now', '(B) past instant → run_now (never a past instant)');
  assertEq(past.runAtMs, null, '(B) past → no runAtMs');
  assertEq(past.reason, TIMING_REASON.RUN_NOW_EXPLICIT_PAST, '(B) past reason code');
  assertEq(past.confidence, 0.7, '(B) past confidence 0.7');
  assert(past.signalsFired.indexOf('explicit_time_past') >= 0, '(B) explicit_time_past fired');

  const exactlyNow = decideTaskTiming({ nowMs: NOW, explicitRunAtMs: NOW });
  assertEq(exactlyNow.disposition, 'run_now', '(B) == now is not future → run_now');
  assertEq(exactlyNow.reason, TIMING_REASON.RUN_NOW_EXPLICIT_PAST, '(B) == now → explicit_time_in_past');

  const noClock = decideTaskTiming({ nowMs: NaN, explicitRunAtMs: NOW + 1_000 });
  assertEq(noClock.disposition, 'run_now', '(B) explicit instant but non-finite now → run_now default');
  assertEq(noClock.reason, TIMING_REASON.RUN_NOW_DEFAULT, '(B) no usable clock → default reason');
  assert(noClock.signalsFired.indexOf('explicit_time_future') < 0 && noClock.signalsFired.indexOf('explicit_time_past') < 0, '(B) explicit_time not classifiable without a clock');

  // ─── (C) off-hours defer + isExpensiveForOffHours ───────────────────────────
  const expensiveWindow = { nowMs: NOW, hoursBucket: 'on_hours' as const, nextOffHoursStartMs: NOW + HOUR };
  assertEq(decideTaskTiming({ ...expensiveWindow, estimatedCostUsd: 2 }).disposition, 'schedule_once', '(C) expensive-by-cost on-hours → defer to window');
  assertEq(decideTaskTiming({ ...expensiveWindow, estimatedCostUsd: 2 }).runAtMs, NOW + HOUR, '(C) deferred to the window ms');
  assertEq(decideTaskTiming({ ...expensiveWindow, estimatedDurationMs: 200_000 }).disposition, 'schedule_once', '(C) expensive-by-duration on-hours → defer');
  assertEq(decideTaskTiming({ ...expensiveWindow, estimatedCostUsd: 0.1, estimatedDurationMs: 1_000 }).disposition, 'run_now', '(C) cheap → run_now');
  assertEq(decideTaskTiming({ nowMs: NOW, hoursBucket: 'off_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 2 }).disposition, 'run_now', '(C) already off_hours → run_now');
  assertEq(decideTaskTiming({ nowMs: NOW, hoursBucket: 'on_hours', estimatedCostUsd: 2 }).disposition, 'run_now', '(C) expensive on_hours but NO window → run_now');
  assertEq(decideTaskTiming({ nowMs: NOW, hoursBucket: 'on_hours', nextOffHoursStartMs: NOW - HOUR, estimatedCostUsd: 2 }).disposition, 'run_now', '(C) window in the past → run_now');
  assertEq(decideTaskTiming({ nowMs: NOW, hoursBucket: null, nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 2 }).disposition, 'run_now', '(C) unknown bucket → run_now (only defer when known on_hours)');

  // boundary + guard table for isExpensiveForOffHours
  assertEq(isExpensiveForOffHours(OFF_HOURS_COST_THRESHOLD_USD, 0), false, '(C) cost == threshold is NOT over (strict >)');
  assertEq(isExpensiveForOffHours(OFF_HOURS_COST_THRESHOLD_USD + 0.01, 0), true, '(C) cost just above threshold is over');
  assertEq(isExpensiveForOffHours(0, OFF_HOURS_DURATION_THRESHOLD_MS), false, '(C) duration == threshold is NOT over');
  assertEq(isExpensiveForOffHours(0, OFF_HOURS_DURATION_THRESHOLD_MS + 1), true, '(C) duration just above threshold is over');
  assertEq(isExpensiveForOffHours(OFF_HOURS_COST_THRESHOLD_USD, OFF_HOURS_DURATION_THRESHOLD_MS), false, '(C) both exactly at threshold → not over');
  assertEq(isExpensiveForOffHours(-5, -5), false, '(C) negative cost/duration → not over');
  assertEq(isExpensiveForOffHours(NaN, NaN), false, '(C) NaN → not over');
  assertEq(isExpensiveForOffHours(Infinity, Infinity), false, '(C) ±Infinity → not over (cannot act on infinite)');
  assertEq(isExpensiveForOffHours(1, 0), true, '(C) cost over → expensive');
  assertEq(isExpensiveForOffHours(0, 999_999), true, '(C) duration over → expensive');
  assertEq(isExpensiveForOffHours(0, 0), false, '(C) zero cost/duration → not over');

  // ─── (D) signalsFired detail ────────────────────────────────────────────────
  const offNow = decideTaskTiming({ nowMs: NOW, hoursBucket: 'off_hours' });
  assert(offNow.signalsFired.indexOf('off_hours') >= 0 && offNow.signalsFired.indexOf('on_hours') < 0, '(D) off_hours token, not on_hours');
  const knownPastWindow = decideTaskTiming({ nowMs: NOW, nextOffHoursStartMs: NOW - 1_000 });
  assert(knownPastWindow.signalsFired.indexOf('next_off_hours_known') >= 0, '(D) next_off_hours_known fires on a finite window (even past)');
  assertEq(knownPastWindow.disposition, 'run_now', '(D) a bare past window alone → run_now');
  // fixed order + bounds hold across a saturated input
  assert(isOrderedSubsequence(dAll.signalsFired), '(D) signalsFired preserves the canonical order');
  assertLE(dAll.signalsFired.length, MAX_SIGNALS_FIRED, '(D) signalsFired bounded by MAX_SIGNALS_FIRED');
  assert(dAll.signalsFired.every((s) => TIMING_SIGNAL_TOKENS.indexOf(s) >= 0), '(D) all fired tokens are from the vocabulary');
  // 'On_Hours' (wrong case) is not a bucket → unknown → no defer + no bucket token
  const wrongCase = decideTaskTiming({ nowMs: NOW, hoursBucket: 'On_Hours' as unknown as 'on_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 2 });
  assertEq(wrongCase.disposition, 'run_now', '(D) wrong-case bucket treated as unknown → run_now');
  assert(wrongCase.signalsFired.indexOf('on_hours') < 0 && wrongCase.signalsFired.indexOf('off_hours') < 0, '(D) wrong-case bucket fires no bucket token');

  // ─── (E) describeTimingDecision ─────────────────────────────────────────────
  const descDefer = describeTimingDecision(dAll);
  assertIncludes(descDefer, 'Deferred', '(E) defer label');
  assertIncludes(descDefer, 'nightly export', '(E) defer label names the resource');
  assertLE(cpLen(descDefer), MAX_REASON_CHARS, '(E) defer label bounded');
  assert(noControlChars(descDefer), '(E) defer label control-clean');

  const descRec = describeTimingDecision(noBlock);
  assertIncludes(descRec, 'Recurring', '(E) recurring label');
  assertIncludes(descRec, 'every day at 9am', '(E) recurring label names the cadence');

  const descSched = describeTimingDecision(noRec);
  assertIncludes(descSched, 'Scheduled once', '(E) schedule label');
  assertIncludes(descSched, String(NOW + HOUR), '(E) schedule label carries the instant');

  const descRun = describeTimingDecision(bare);
  assertIncludes(descRun, 'Run now', '(E) run_now label');
  assert(noControlChars(descRun) && cpLen(descRun) <= MAX_REASON_CHARS, '(E) run_now label clean + bounded');

  // huge recurrence hint → describe stays bounded + code-point clean
  const hugeHintDecision = decideTaskTiming({ nowMs: NOW, recurrenceHint: (EMOJI + 'x').repeat(500) });
  assert(hugeHintDecision.disposition === 'recurring', '(E) huge recurrence hint still recurring');
  assertLE(cpLen(hugeHintDecision.recurrenceHint || ''), MAX_RECURRENCE_HINT_CHARS, '(E) huge recurrenceHint bounded');
  assert(!hasLoneSurrogate(hugeHintDecision.recurrenceHint || ''), '(E) huge recurrenceHint has no split surrogate');
  const descHuge = describeTimingDecision(hugeHintDecision);
  assertLE(cpLen(descHuge), MAX_REASON_CHARS, '(E) describe of huge hint bounded');
  assert(noControlChars(descHuge) && !hasLoneSurrogate(descHuge), '(E) describe of huge hint clean');

  // control-char-laden blockingResource → sanitized in both blockedOn + describe
  const ctrlDecision = decideTaskTiming({ nowMs: NOW, blockingResource: 'nightly `export` <job>' + ctrlStr });
  assertEq(ctrlDecision.disposition, 'defer_until_unblocked', '(E) control-laden resource still defers');
  assert(noControlChars(ctrlDecision.blockedOn || ''), '(E) blockedOn is control-clean');
  assert(!(ctrlDecision.blockedOn || '').includes('`') && !(ctrlDecision.blockedOn || '').includes('<') && !(ctrlDecision.blockedOn || '').includes('>'), '(E) fence chars stripped from blockedOn');
  assert(!(ctrlDecision.blockedOn || '').includes(NUL) && !(ctrlDecision.blockedOn || '').includes(LS) && !(ctrlDecision.blockedOn || '').includes(PS), '(E) NUL/LS/PS stripped from blockedOn');
  assert(noControlChars(describeTimingDecision(ctrlDecision)), '(E) describe of control-laden decision is clean');

  // whitespace-only / all-control label treated as ABSENT
  const wsOnly = decideTaskTiming({ nowMs: NOW, blockingResource: '   ' + TAB + NL + '  ' });
  assertEq(wsOnly.disposition, 'run_now', '(E) whitespace-only resource treated as absent');
  const ctrlOnly = decideTaskTiming({ nowMs: NOW, recurrenceHint: NUL + BEL + DEL + ZW });
  assertEq(ctrlOnly.disposition, 'run_now', '(E) all-control hint treated as absent');

  // ─── (F) determinism ────────────────────────────────────────────────────────
  assertEq(JSON.stringify(decideTaskTiming(allSet)), JSON.stringify(decideTaskTiming(allSet)), '(F) decideTaskTiming deterministic (all signals)');
  const detInput: TaskTimingSignals = { nowMs: NOW, hoursBucket: 'on_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 3 };
  assertEq(JSON.stringify(decideTaskTiming(detInput)), JSON.stringify(decideTaskTiming(detInput)), '(F) decideTaskTiming deterministic (off-hours)');
  assertEq(describeTimingDecision(dAll), describeTimingDecision(dAll), '(F) describeTimingDecision deterministic');

  // ─── (G) HOSTILE — never throws, always well-formed ─────────────────────────
  const cyclic: Record<string, unknown> = { nowMs: NOW, blockingResource: 'root' };
  cyclic.self = cyclic;
  (cyclic as Record<string, unknown>).nested = { back: cyclic };

  const throwingProxy = new Proxy(
    {},
    {
      get() {
        throw new Error('boom-get');
      },
      has() {
        throw new Error('boom-has');
      },
      ownKeys() {
        throw new Error('boom-keys');
      },
      getOwnPropertyDescriptor() {
        throw new Error('boom-desc');
      },
    },
  );

  const throwingField: Record<string, unknown> = { nowMs: NOW };
  Object.defineProperty(throwingField, 'blockingResource', {
    get() {
      throw new Error('boom-field');
    },
    enumerable: true,
  });

  const protoKeys = JSON.parse('{"nowMs":1700000000000,"__proto__":{"polluted":true},"blockingResource":"safe label"}');
  const ctorKey = { nowMs: NOW, constructor: 'evil', recurrenceHint: 'every hour' };
  const hugeStr = 'z'.repeat(200_000);

  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['string', 'just a string'],
    ['empty-object', {}],
    ['array', []],
    ['boolean', true],
    ['bigint', 10n],
    ['nowMs-bigint', { nowMs: 10n }],
    ['nowMs-NaN', { nowMs: NaN, explicitRunAtMs: NOW + 1000 }],
    ['nowMs-Infinity', { nowMs: Infinity, explicitRunAtMs: NOW + 1000 }],
    ['explicit-NaN', { nowMs: NOW, explicitRunAtMs: NaN }],
    ['explicit-Infinity', { nowMs: NOW, explicitRunAtMs: Infinity }],
    ['cost-bigint', { nowMs: NOW, hoursBucket: 'on_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 10n, estimatedDurationMs: 10n }],
    ['negative-cost', { nowMs: NOW, hoursBucket: 'on_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: -100, estimatedDurationMs: -100 }],
    ['symbol-field', { nowMs: NOW, blockingResource: Symbol('s') as unknown as string }],
    ['object-label', { nowMs: NOW, blockingResource: {} as unknown as string, recurrenceHint: [] as unknown as string }],
    ['cyclic', cyclic],
    ['throwing-proxy', throwingProxy],
    ['throwing-field', throwingField],
    ['proto-keys', protoKeys],
    ['ctor-key', ctorKey],
    ['proto-bucket', { nowMs: NOW, hoursBucket: '__proto__' as unknown as 'on_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 2 }],
    ['ctor-bucket', { nowMs: NOW, hoursBucket: 'constructor' as unknown as 'on_hours', nextOffHoursStartMs: NOW + HOUR, estimatedCostUsd: 2 }],
    ['huge-labels', { nowMs: NOW, blockingResource: hugeStr, recurrenceHint: hugeStr }],
    ['huge-emoji-label', { nowMs: NOW, blockingResource: EMOJI.repeat(5000) + COMBINING }],
    ['lone-surrogate-label', { nowMs: NOW, blockingResource: 'a' + LONE_HI + 'b' + LONE_LO + 'c' }],
    ['path-traversal-label', { nowMs: NOW, blockingResource: '../../../etc/passwd' + NUL + '/../secret' }],
    ['wrong-type-fields', { nowMs: '1700000000000', explicitRunAtMs: 'soon', hoursBucket: 5, nextOffHoursStartMs: {}, estimatedCostUsd: 'lots' }],
    ['ctrl-everywhere', { nowMs: NOW, blockingResource: ctrlStr, recurrenceHint: ctrlStr }],
  ];

  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const d = decideTaskTiming(input as never);
      assert(wellFormed(d), '(G) ' + label + ' → well-formed decision', JSON.stringify(d));
      // describe must also survive the resulting (or hostile) decision
      const desc = describeTimingDecision(d);
      assert(typeof desc === 'string' && desc.length > 0 && noControlChars(desc) && cpLen(desc) <= MAX_REASON_CHARS && !hasLoneSurrogate(desc), '(G) ' + label + ' → describe clean', JSON.stringify(desc));
    }, '(G) decideTaskTiming never throws :: ' + label);
  }

  // describeTimingDecision is independently total on hostile DECISION objects
  const hostileDecisions: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 7],
    ['empty', {}],
    ['array', []],
    ['bad-disposition', { disposition: 'teleport', confidence: 5, runAtMs: 'nope' }],
    ['proto-disposition', { disposition: '__proto__' }],
    ['huge-blocked', { disposition: 'defer_until_unblocked', blockedOn: hugeStr, confidence: 2 }],
    ['ctrl-recurrence', { disposition: 'recurring', recurrenceHint: ctrlStr, confidence: -1 }],
    ['lone-surrogate', { disposition: 'recurring', recurrenceHint: 'x' + LONE_HI, confidence: 0.5 }],
    ['throwing-proxy', throwingProxy],
    ['NaN-confidence', { disposition: 'run_now', confidence: NaN }],
  ];
  for (const [label, dec] of hostileDecisions) {
    assertNoThrow(() => {
      const desc = describeTimingDecision(dec as never);
      assert(typeof desc === 'string' && desc.length > 0 && noControlChars(desc) && cpLen(desc) <= MAX_REASON_CHARS && !hasLoneSurrogate(desc), '(G) describe hostile → clean :: ' + label, JSON.stringify(desc));
    }, '(G) describeTimingDecision never throws :: ' + label);
  }

  // isExpensiveForOffHours is independently total on hostile numeric-ish input
  assertNoThrow(() => {
    isExpensiveForOffHours(10n as unknown as number, 10n as unknown as number);
    isExpensiveForOffHours('x' as unknown as number, {} as unknown as number);
    isExpensiveForOffHours(NaN, Infinity);
    isExpensiveForOffHours(null as unknown as number, undefined as unknown as number);
  }, '(G) isExpensiveForOffHours never throws on hostile input');

  // no prototype pollution from __proto__ / constructor keys or bucket values
  assert(({} as Record<string, unknown>).polluted === undefined, '(G) no Object.prototype pollution (polluted)');
  assert((Object.prototype as Record<string, unknown>).polluted === undefined, '(G) Object.prototype untouched');

  // a lone-surrogate label defers cleanly with a bounded, surrogate-free blockedOn
  const loneDecision = decideTaskTiming({ nowMs: NOW, blockingResource: 'a' + LONE_HI + 'b' });
  assert(!hasLoneSurrogate(loneDecision.blockedOn || ''), '(G) lone surrogate dropped from blockedOn');

  // ─── (H) REGRESSION: Trojan-Source bidi ISOLATE controls must be stripped ─────
  // Bug: INVISIBLE_RE missed U+2066-U+2069 (LRI/RLI/FSI/PDI) + U+061C (ALM) — the
  // exact invisible directional-formatting chars of CVE-2021-42574 — so an unbalanced
  // isolate leaked through sanitizeLabel into blockedOn / recurrenceHint and the
  // rendered one-liner, able to reorder adjacent UI/prompt text. They must be removed
  // like U+202E, not survive into the echoed label.

  // EXACT failing input from the bug report: 'delete' + U+2066 + ' keep'.
  const lriDecision = decideTaskTiming({ nowMs: NOW, blockingResource: 'delete' + LRI + ' keep' });
  assertEq(lriDecision.disposition, 'defer_until_unblocked', '(H) isolate-laden resource still defers');
  assert(!(lriDecision.blockedOn || '').includes(LRI), '(H) U+2066 LRI stripped from blockedOn (not leaked)');
  assertEq(lriDecision.blockedOn, 'delete keep', '(H) blockedOn is the cleaned label, isolate removed');
  const lriDesc = describeTimingDecision(lriDecision);
  assert(!lriDesc.includes(LRI), '(H) U+2066 LRI absent from the rendered one-liner');
  assertIncludes(lriDesc, 'delete keep', '(H) rendered one-liner carries the cleaned label');
  assert(noControlChars(lriDesc), '(H) rendered one-liner is control/bidi-clean');

  // every isolate + ALM stripped from BOTH echoed sinks (blockedOn + recurrenceHint)
  const isolates: Array<[string, string]> = [['LRI', LRI], ['RLI', RLI], ['FSI', FSI], ['PDI', PDI], ['ALM', ALM]];
  const isoBlock = decideTaskTiming({ nowMs: NOW, blockingResource: 'x' + LRI + RLI + FSI + PDI + ALM + 'y' });
  assertEq(isoBlock.blockedOn, 'xy', '(H) all isolate/mark controls removed from blockedOn');
  const isoRec = decideTaskTiming({ nowMs: NOW, recurrenceHint: 'a' + LRI + RLI + FSI + PDI + ALM + 'b' });
  assertEq(isoRec.disposition, 'recurring', '(H) isolate-laden hint still recurring');
  assertEq(isoRec.recurrenceHint, 'ab', '(H) all isolate/mark controls removed from recurrenceHint');
  for (const [name, ch] of isolates) {
    assert(!(isoBlock.blockedOn || '').includes(ch), '(H) ' + name + ' stripped from blockedOn');
    assert(!(isoRec.recurrenceHint || '').includes(ch), '(H) ' + name + ' stripped from recurrenceHint');
  }

  // a label made ONLY of isolate/mark controls reduces to absent (like all-control)
  const isoOnly = decideTaskTiming({ nowMs: NOW, blockingResource: LRI + RLI + FSI + PDI + ALM });
  assertEq(isoOnly.disposition, 'run_now', '(H) isolate-only resource treated as absent');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll task-timing-disposition-core smoke cases passed (' + passes + ' passed).');
}

main();
