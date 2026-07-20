/**
 * chat-session-resumption-core-smoketest — the pure RE-ENTRY posture picker
 * (src/lib/chatSessionResumptionCore.ts). At thread re-open / run resume,
 * decideSessionResumption folds elapsed dormancy + pending clarification/approval
 * freshness + in-flight plan + open-task count + last outcome into ONE posture
 * (continue-silently / recap / reconfirm / reconfirm-stale-pending / fresh-start)
 * plus a bounded, secret-safe prompt directive. isPendingClarificationFresh +
 * RESUMPTION_CLARIFICATION_FRESH_MS are the deterministic drop-in for the
 * triplicated inline `Date.now() - askedAt < 15 * 60 * 1000`. Load-bearing:
 *
 *   POSTURE MATRIX — pending+fresh+brief → continue-silently; pending+stale →
 *   reconfirm-stale-pending; pending+fresh+short → reconfirm; inFlight+brief →
 *   continue-silently; inFlight+long → recap; openTasks+short → recap;
 *   lastOutcome=failed → recap; nothing → fresh-start.
 *   BUCKETS — boundaries exactly at 120_000 / 900_000 / 7_200_000 / 86_400_000.
 *   FRESHNESS — equivalence vs the old inline gate incl. exactly 15m (⇒ false).
 *   DETERMINISM — same input twice → identical decision.
 *
 *   TOTAL: null / undefined / wrong-type / NaN / ±Infinity / negative / huge /
 *   bigint / symbol / control-char / cyclic / throwing-getter input never throws;
 *   directive stays bounded + secret/fence/control-free.
 *
 * Pure — loads under tsx (chatSessionResumptionCore has zero runtime imports).
 * Run: npx tsx scripts/chat-session-resumption-core-smoketest.ts
 */

import {
  decideSessionResumption,
  bucketElapsed,
  isPendingClarificationFresh,
  RESUMPTION_CLARIFICATION_FRESH_MS,
  ELAPSED_BRIEF_MAX_MS,
  ELAPSED_SHORT_MAX_MS,
  ELAPSED_IDLE_MAX_MS,
  ELAPSED_LONG_MAX_MS,
  MAX_DIRECTIVE_LEN,
  MAX_LABEL_LEN,
  MAX_REASON_LEN,
  type ResumptionPosture,
  type ElapsedBucket,
  type SessionResumptionDecision,
  type SessionResumptionInput,
} from '../src/lib/chatSessionResumptionCore';

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

const POSTURES: ReadonlySet<ResumptionPosture> = new Set<ResumptionPosture>([
  'continue-silently', 'recap', 'reconfirm', 'reconfirm-stale-pending', 'fresh-start',
]);
const BUCKETS: ReadonlySet<ElapsedBucket> = new Set<ElapsedBucket>([
  'brief', 'short', 'idle', 'long', 'dormant', 'unknown',
]);

/** No control / DEL / C1 / line-sep / bidi / zero-width char survives. */
function noControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (
      c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)
      || c === 0x2028 || c === 0x2029
      || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e)
      || c === 0x2060 || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff
    ) {
      return false;
    }
  }
  return true;
}
function noFenceChars(s: string): boolean {
  return !s.includes('<') && !s.includes('>') && !s.includes('`');
}

/** A decision is well-formed: valid posture + bucket; elapsedMs null-or-finite;
 *  boolean flags; a bounded, control-free, fence-free directive; a bounded,
 *  non-empty reason. */
function wellFormed(d: SessionResumptionDecision): boolean {
  return (
    !!d && typeof d === 'object'
    && POSTURES.has(d.posture)
    && BUCKETS.has(d.elapsed)
    && (d.elapsedMs === null || (typeof d.elapsedMs === 'number' && Number.isFinite(d.elapsedMs)))
    && typeof d.clarificationStillFresh === 'boolean'
    && typeof d.approvalStillFresh === 'boolean'
    && typeof d.hasPendingAction === 'boolean'
    && typeof d.directive === 'string'
    && d.directive.length <= MAX_DIRECTIVE_LEN
    && noControlChars(d.directive)
    && noFenceChars(d.directive)
    && typeof d.reason === 'string'
    && d.reason.length > 0
    && d.reason.length <= MAX_REASON_LEN
    && noControlChars(d.reason)
  );
}

/** Runs the decider on hostile input; records a failure (not a crash) on throw.
 *  Never String()s the hostile value — only the fixed label. */
function noThrow(label: string, fn: () => SessionResumptionDecision): SessionResumptionDecision {
  try {
    const d = fn();
    assert(wellFormed(d), `${label} -> well-formed decision`, JSON.stringify(d));
    return d;
  } catch (err) {
    assert(false, `${label} -> must not throw`, String(err));
    return {
      posture: 'fresh-start', elapsed: 'unknown', elapsedMs: null,
      clarificationStillFresh: false, approvalStillFresh: false,
      hasPendingAction: false, directive: '', reason: 'threw',
    };
  }
}

const NOW = 1_700_000_000_000; // a plausible ms timestamp

function main(): void {
  // ─── (1) exported constants ───────────────────────────────────────────────
  assertEq(RESUMPTION_CLARIFICATION_FRESH_MS, 15 * 60 * 1000, '(1) fresh window = 15 min');
  assertEq(RESUMPTION_CLARIFICATION_FRESH_MS, 900_000, '(1) fresh window = 900_000 ms');
  assertEq(ELAPSED_BRIEF_MAX_MS, 120_000, '(1) brief boundary = 2 min');
  assertEq(ELAPSED_SHORT_MAX_MS, 900_000, '(1) short boundary = 15 min');
  assertEq(ELAPSED_IDLE_MAX_MS, 7_200_000, '(1) idle boundary = 2 hr');
  assertEq(ELAPSED_LONG_MAX_MS, 86_400_000, '(1) long boundary = 24 hr');
  assertEq(MAX_DIRECTIVE_LEN, 400, '(1) max directive len = 400');
  assertEq(MAX_LABEL_LEN, 160, '(1) max label len = 160');
  assertEq(MAX_REASON_LEN, 80, '(1) max reason len = 80');
  assert(ELAPSED_SHORT_MAX_MS === RESUMPTION_CLARIFICATION_FRESH_MS, '(1) short bucket coincides with fresh window (15 min)');
  assert(
    ELAPSED_BRIEF_MAX_MS < ELAPSED_SHORT_MAX_MS
    && ELAPSED_SHORT_MAX_MS < ELAPSED_IDLE_MAX_MS
    && ELAPSED_IDLE_MAX_MS < ELAPSED_LONG_MAX_MS,
    '(1) bucket boundaries strictly ascending',
  );

  // ─── (2) bucketElapsed boundaries (exclusive-lower) ───────────────────────
  assertEq(bucketElapsed(0), 'brief', '(2) 0 -> brief');
  assertEq(bucketElapsed(1), 'brief', '(2) 1 -> brief');
  assertEq(bucketElapsed(ELAPSED_BRIEF_MAX_MS - 1), 'brief', '(2) 119_999 -> brief');
  assertEq(bucketElapsed(ELAPSED_BRIEF_MAX_MS), 'short', '(2) exactly 120_000 -> short');
  assertEq(bucketElapsed(ELAPSED_BRIEF_MAX_MS + 1), 'short', '(2) 120_001 -> short');
  assertEq(bucketElapsed(ELAPSED_SHORT_MAX_MS - 1), 'short', '(2) 899_999 -> short');
  assertEq(bucketElapsed(ELAPSED_SHORT_MAX_MS), 'idle', '(2) exactly 900_000 -> idle');
  assertEq(bucketElapsed(ELAPSED_SHORT_MAX_MS + 1), 'idle', '(2) 900_001 -> idle');
  assertEq(bucketElapsed(ELAPSED_IDLE_MAX_MS - 1), 'idle', '(2) 7_199_999 -> idle');
  assertEq(bucketElapsed(ELAPSED_IDLE_MAX_MS), 'long', '(2) exactly 7_200_000 -> long');
  assertEq(bucketElapsed(ELAPSED_IDLE_MAX_MS + 1), 'long', '(2) 7_200_001 -> long');
  assertEq(bucketElapsed(ELAPSED_LONG_MAX_MS - 1), 'long', '(2) 86_399_999 -> long');
  assertEq(bucketElapsed(ELAPSED_LONG_MAX_MS), 'dormant', '(2) exactly 86_400_000 -> dormant');
  assertEq(bucketElapsed(ELAPSED_LONG_MAX_MS + 1), 'dormant', '(2) 86_400_001 -> dormant');
  assertEq(bucketElapsed(1e12), 'dormant', '(2) 1e12 -> dormant');
  assertEq(bucketElapsed(-1), 'unknown', '(2) negative -> unknown');
  assertEq(bucketElapsed(NaN), 'unknown', '(2) NaN -> unknown');
  assertEq(bucketElapsed(Infinity), 'unknown', '(2) Infinity -> unknown');
  assertEq(bucketElapsed(null), 'unknown', '(2) null -> unknown');
  assertEq(bucketElapsed('300000'), 'short', '(2) numeric-string 300_000 -> short');
  assertEq(bucketElapsed('nope'), 'unknown', '(2) non-numeric string -> unknown');

  // ─── (3) isPendingClarificationFresh equivalence vs the old inline gate ───
  const oldGate = (asked: number, now: number): boolean => now - asked < 15 * 60 * 1000;
  const gaps = [
    0, 1, 1000, 60_000, 120_000, 300_000, 899_999,
    RESUMPTION_CLARIFICATION_FRESH_MS - 1,
    RESUMPTION_CLARIFICATION_FRESH_MS,
    RESUMPTION_CLARIFICATION_FRESH_MS + 1,
    1_000_000, 5_000_000, 86_400_000,
  ];
  for (const gap of gaps) {
    const asked = NOW - gap;
    assertEq(
      isPendingClarificationFresh(asked, NOW),
      oldGate(asked, NOW),
      `(3) equivalence at gap=${gap}`,
    );
  }
  assertEq(isPendingClarificationFresh(NOW - RESUMPTION_CLARIFICATION_FRESH_MS, NOW), false, '(3) exactly 15m -> not fresh');
  assertEq(isPendingClarificationFresh(NOW - (RESUMPTION_CLARIFICATION_FRESH_MS - 1), NOW), true, '(3) 15m minus 1ms -> fresh');
  assertEq(isPendingClarificationFresh(NOW - 0, NOW), true, '(3) just asked -> fresh');
  assertEq(isPendingClarificationFresh(NOW + 5000, NOW), true, '(3) future askedAt (skew) -> fresh (matches old)');
  // numeric-string coercion matches the old `-` coercion for finite values.
  assertEq(isPendingClarificationFresh(String(NOW - 60_000), NOW), true, '(3) numeric-string askedAt -> fresh');
  // unreadable inputs fail closed (false), never throw.
  assertEq(isPendingClarificationFresh(null, NOW), false, '(3) null askedAt -> false');
  assertEq(isPendingClarificationFresh(NOW, null), false, '(3) null now -> false');
  assertEq(isPendingClarificationFresh('x', NOW), false, '(3) junk askedAt -> false');
  assertEq(isPendingClarificationFresh(NaN, NOW), false, '(3) NaN askedAt -> false');
  assertEq(isPendingClarificationFresh(undefined, undefined), false, '(3) undefined/undefined -> false');

  // ─── (4) POSTURE MATRIX ───────────────────────────────────────────────────
  // pending clarification, fresh, brief gap -> continue-silently
  const pfb = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 60_000, pendingClarificationAskedAtMs: NOW - 60_000 });
  assertEq(pfb.posture, 'continue-silently', '(4) pending+fresh+brief -> continue-silently');
  assertEq(pfb.elapsed, 'brief', '(4) pending+fresh+brief bucket brief');
  assertEq(pfb.clarificationStillFresh, true, '(4) pending+fresh+brief clarFresh');
  assertEq(pfb.hasPendingAction, true, '(4) pending+fresh+brief hasPending');
  assert(pfb.directive.length > 0, '(4) continue-silently has a directive');

  // pending clarification, stale -> reconfirm-stale-pending
  const ps = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 1_000_000, pendingClarificationAskedAtMs: NOW - 1_000_000 });
  assertEq(ps.posture, 'reconfirm-stale-pending', '(4) pending+stale -> reconfirm-stale-pending');
  assertEq(ps.clarificationStillFresh, false, '(4) pending+stale clarNotFresh');
  assert(ps.directive.length > 0 && ps.directive.includes('stale'), '(4) stale directive mentions stale');

  // pending clarification, fresh, short gap -> reconfirm
  const pfs = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 300_000, pendingClarificationAskedAtMs: NOW - 300_000 });
  assertEq(pfs.posture, 'reconfirm', '(4) pending+fresh+short -> reconfirm');
  assertEq(pfs.elapsed, 'short', '(4) pending+fresh+short bucket short');
  assertEq(pfs.clarificationStillFresh, true, '(4) pending+fresh+short clarFresh');

  // in-flight, brief -> continue-silently
  const ifb = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 30_000, inFlightPlan: true });
  assertEq(ifb.posture, 'continue-silently', '(4) inFlight+brief -> continue-silently');

  // in-flight, long -> recap
  const ifl = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 10_000_000, inFlightPlan: true });
  assertEq(ifl.posture, 'recap', '(4) inFlight+long -> recap');
  assertEq(ifl.elapsed, 'long', '(4) inFlight+long bucket long');

  // open tasks, short -> recap
  const ots = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 300_000, openTaskCount: 3 });
  assertEq(ots.posture, 'recap', '(4) openTasks+short -> recap');

  // last outcome failed -> recap
  const lof = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 300_000, lastOutcome: 'failed' });
  assertEq(lof.posture, 'recap', '(4) lastOutcome=failed -> recap');

  // nothing -> fresh-start
  const none = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 300_000, lastOutcome: 'success' });
  assertEq(none.posture, 'fresh-start', '(4) nothing -> fresh-start');
  assertEq(none.directive, '', '(4) fresh-start has empty directive');
  assertEq(none.hasPendingAction, false, '(4) nothing hasPending false');

  // ─── (5) POSTURE MATRIX — priority + extra combinations ───────────────────
  // stale pending beats an in-flight plan (stale is the dangerous case).
  const staleBeatsInflight = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 30_000, pendingClarificationAskedAtMs: NOW - 2_000_000, inFlightPlan: true });
  assertEq(staleBeatsInflight.posture, 'reconfirm-stale-pending', '(5) stale pending beats inFlight');

  // open tasks + brief gap -> continue-silently.
  const otb = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 30_000, openTaskCount: 2 });
  assertEq(otb.posture, 'continue-silently', '(5) openTasks+brief -> continue-silently');

  // failed outcome + brief gap still recaps (acknowledge the failure).
  const failBrief = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 30_000, lastOutcome: 'error' });
  assertEq(failBrief.posture, 'recap', '(5) failed+brief -> recap');

  // pending APPROVAL, stale -> reconfirm-stale-pending.
  const apprStale = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 2_000_000, pendingApprovalRequestedAtMs: NOW - 2_000_000 });
  assertEq(apprStale.posture, 'reconfirm-stale-pending', '(5) approval stale -> reconfirm-stale-pending');
  assertEq(apprStale.approvalStillFresh, false, '(5) approval stale -> approvalNotFresh');
  assertEq(apprStale.hasPendingAction, true, '(5) approval present -> hasPending');

  // pending APPROVAL, fresh, brief -> continue-silently.
  const apprFreshBrief = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 30_000, pendingApprovalRequestedAtMs: NOW - 30_000 });
  assertEq(apprFreshBrief.posture, 'continue-silently', '(5) approval fresh+brief -> continue-silently');
  assertEq(apprFreshBrief.approvalStillFresh, true, '(5) approval fresh -> approvalFresh');

  // dormant + nothing -> still fresh-start (nothing to resume even after days).
  const dormantNothing = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 3 * 86_400_000, lastOutcome: 'success' });
  assertEq(dormantNothing.posture, 'fresh-start', '(5) dormant + nothing -> fresh-start');
  assertEq(dormantNothing.elapsed, 'dormant', '(5) 3 days -> dormant bucket');

  // in-flight + unknown gap (no time info) -> recap (never silently continue).
  const inflightUnknown = decideSessionResumption({ inFlightPlan: true });
  assertEq(inflightUnknown.posture, 'recap', '(5) inFlight + unknown gap -> recap');
  assertEq(inflightUnknown.elapsed, 'unknown', '(5) no time info -> unknown bucket');
  assertEq(inflightUnknown.elapsedMs, null, '(5) no time info -> elapsedMs null');

  // fresh clarification but a dormant gap (mismatch) -> reconfirm (not silent).
  const freshButDormant = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 5 * 86_400_000, pendingClarificationAskedAtMs: NOW - 60_000 });
  assertEq(freshButDormant.posture, 'reconfirm', '(5) fresh clar + dormant gap -> reconfirm');

  // elapsedMs fallback used when now/lastActivity absent.
  const fallbackBrief = decideSessionResumption({ elapsedMs: 30_000, inFlightPlan: true });
  assertEq(fallbackBrief.posture, 'continue-silently', '(5) elapsedMs fallback brief -> continue-silently');
  assertEq(fallbackBrief.elapsed, 'brief', '(5) elapsedMs fallback -> brief bucket');
  assertEq(fallbackBrief.elapsedMs, 30_000, '(5) elapsedMs fallback surfaced');

  // clock skew (lastActivity in the future) clamps elapsed to 0 -> brief.
  const skew = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW + 50_000, inFlightPlan: true });
  assertEq(skew.posture, 'continue-silently', '(5) clock skew -> brief -> continue-silently');
  assertEq(skew.elapsedMs, 0, '(5) clock skew clamps elapsedMs to 0');

  // computed elapsed surfaced on the decision.
  assertEq(decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 60_000 }).elapsedMs, 60_000, '(5) elapsedMs = now - lastActivity');

  // ─── (6) DIRECTIVE content + safety on a clean, labeled state ─────────────
  const labeled = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 3_600_000, inFlightPlan: true, lastActivityLabel: 'Deploying to prod' });
  assertEq(labeled.posture, 'recap', '(6) inFlight idle -> recap');
  assertEq(labeled.elapsed, 'idle', '(6) 1 hr -> idle bucket');
  assert(labeled.directive.includes('Deploying to prod'), '(6) recap directive echoes clean label');
  assert(labeled.directive.length <= MAX_DIRECTIVE_LEN, '(6) labeled directive bounded');
  assert(noControlChars(labeled.directive) && noFenceChars(labeled.directive), '(6) labeled directive clean');
  assert(labeled.reason.includes('recap'), '(6) reason names the posture');

  // reconfirm directive echoes the label too.
  const reconf = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 300_000, pendingClarificationAskedAtMs: NOW - 300_000, lastActivityLabel: 'delete staging DB' });
  assertEq(reconf.posture, 'reconfirm', '(6) fresh pending + short -> reconfirm');
  assert(reconf.directive.includes('delete staging DB'), '(6) reconfirm directive echoes label');

  // continue-silently directive is present but does NOT echo the label.
  const silentLabeled = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 30_000, inFlightPlan: true, lastActivityLabel: 'some private note' });
  assertEq(silentLabeled.posture, 'continue-silently', '(6) inFlight brief -> continue-silently');
  assert(silentLabeled.directive.length > 0, '(6) continue-silently directive non-empty');
  assert(!silentLabeled.directive.includes('some private note'), '(6) continue-silently omits the label');

  // ─── (7) DETERMINISM (identical input twice -> identical decision) ────────
  const detInputs: SessionResumptionInput[] = [
    { nowMs: NOW, lastActivityAtMs: NOW - 60_000, pendingClarificationAskedAtMs: NOW - 60_000 },
    { nowMs: NOW, lastActivityAtMs: NOW - 1_000_000, pendingClarificationAskedAtMs: NOW - 1_000_000 },
    { nowMs: NOW, lastActivityAtMs: NOW - 10_000_000, inFlightPlan: true, lastActivityLabel: 'Refactoring auth' },
    { nowMs: NOW, lastActivityAtMs: NOW - 300_000, openTaskCount: 4 },
    { nowMs: NOW, lastActivityAtMs: NOW - 300_000, lastOutcome: 'failed' },
    { nowMs: NOW, lastActivityAtMs: NOW - 300_000, lastOutcome: 'success' },
    { inFlightPlan: true },
  ];
  for (const inp of detInputs) {
    const a = decideSessionResumption(inp);
    const b = decideSessionResumption(inp);
    assertEq(JSON.stringify(a), JSON.stringify(b), `(7) deterministic: ${JSON.stringify(inp).slice(0, 48)}`);
  }
  // bucketElapsed + freshness are deterministic too.
  assertEq(bucketElapsed(300_000), bucketElapsed(300_000), '(7) bucketElapsed deterministic');
  assertEq(isPendingClarificationFresh(NOW - 60_000, NOW), isPendingClarificationFresh(NOW - 60_000, NOW), '(7) freshness deterministic');

  // ─── (8) HOSTILE — never throws, always well-formed ───────────────────────
  const cyclic: Record<string, unknown> = { openTaskCount: 1 };
  cyclic.self = cyclic;

  const throwing: Record<string, unknown> = {};
  for (const k of ['nowMs', 'lastActivityAtMs', 'lastActivityLabel', 'pendingClarificationAskedAtMs', 'inFlightPlan', 'openTaskCount', 'lastOutcome']) {
    Object.defineProperty(throwing, k, { get() { throw new Error(`boom:${k}`); }, enumerable: true });
  }

  // Each entry is [label, input]; the label is used in messages so a throwing /
  // symbol / bigint value is NEVER passed to String() in an assertion message.
  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['-1', -1],
    ['1e21', 1e21],
    ['string', 'x'],
    ['empty-object', {}],
    ['array', []],
    ['boolean', true],
    ['number', 42],
    ['bigint', 10n],
    ['symbol', Symbol('s')],
    ['throwing-getters', throwing],
    // hostile FIELD values inside a real object:
    ['fields:NaN/Inf/bigint', { nowMs: NaN, lastActivityAtMs: Infinity, openTaskCount: 10n, inFlightPlan: 'nope' }],
    ['fields:symbol/obj/arr', { nowMs: Symbol('n'), lastActivityAtMs: {}, elapsedMs: [], lastOutcome: 42 }],
    ['fields:huge/neg', { nowMs: 1e21, lastActivityAtMs: -1e21, openTaskCount: -5, pendingClarificationAskedAtMs: 'abc' }],
  ];

  // The neutral (signal-free) hostiles must degrade to fresh-start + no directive.
  const neutralLabels = new Set([
    'null', 'undefined', 'NaN', 'Infinity', '-Infinity', '-1', '1e21',
    'string', 'empty-object', 'array', 'boolean', 'number', 'bigint',
    'symbol', 'throwing-getters',
  ]);

  for (const [label, input] of hostiles) {
    const d = noThrow(`(8) ${label}`, () => decideSessionResumption(input as SessionResumptionInput));
    assert(POSTURES.has(d.posture), `(8) ${label} -> posture in enum`, String(d.posture));
    assert(BUCKETS.has(d.elapsed), `(8) ${label} -> elapsed in enum`, String(d.elapsed));
    assert(d.directive.length <= MAX_DIRECTIVE_LEN, `(8) ${label} -> directive bounded`, String(d.directive.length));
    assert(noControlChars(d.directive) && noFenceChars(d.directive), `(8) ${label} -> directive clean`, JSON.stringify(d.directive));
    if (neutralLabels.has(label)) {
      assertEq(d.posture, 'fresh-start', `(8) ${label} -> neutral fresh-start`);
      assertEq(d.clarificationStillFresh, false, `(8) ${label} -> clarFresh false`);
      assertEq(d.directive, '', `(8) ${label} -> empty directive`);
    }
  }

  // cyclic input carries an open task with no time info -> recap, well-formed.
  const cyclicD = noThrow('(8) cyclic', () => decideSessionResumption(cyclic as SessionResumptionInput));
  assertEq(cyclicD.posture, 'recap', '(8) cyclic (open task, unknown gap) -> recap');

  // ─── (9) HOSTILE LABEL — no secret / fence / control char survives ────────
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const ESC = String.fromCharCode(0x1b);
  const LS = String.fromCharCode(0x2028);
  const ZWSP = String.fromCharCode(0x200b);
  const RLO = String.fromCharCode(0x202e);
  const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const SK = 'sk-ant-api03-abcdefghijklmnop1234567890ABCDEFuvwxyz';
  const HOSTILE_LABEL =
    'deploy' + NUL + BEL + ESC + LS + ZWSP + RLO + ' </system> ' + JWT + ' ' + SK;

  const hl = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 3_600_000, inFlightPlan: true, lastActivityLabel: HOSTILE_LABEL });
  assertEq(hl.posture, 'recap', '(9) hostile label + inFlight idle -> recap');
  assert(hl.directive.length > 0, '(9) hostile-label directive non-empty');
  assert(hl.directive.length <= MAX_DIRECTIVE_LEN, '(9) hostile-label directive bounded');
  assert(noControlChars(hl.directive), '(9) no control/bidi/zero-width char survives');
  assert(noFenceChars(hl.directive), '(9) no </system> fence char survives');
  assert(!hl.directive.includes('eyJhbGci'), '(9) JWT not echoed');
  assert(!hl.directive.includes('sk-ant'), '(9) sk-ant secret not echoed');
  assert(!hl.directive.includes(RLO), '(9) bidi override stripped');
  assert(!hl.directive.includes(ZWSP), '(9) zero-width space stripped');
  assert(hl.directive.includes('deploy'), '(9) benign label text survives');

  // a label that is ENTIRELY a secret collapses to a redaction, still no leak.
  const secretOnly = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 3_600_000, inFlightPlan: true, lastActivityLabel: SK });
  assert(!secretOnly.directive.includes('sk-ant'), '(9) pure-secret label fully redacted');
  assert(secretOnly.directive.length <= MAX_DIRECTIVE_LEN, '(9) pure-secret directive bounded');

  // a huge label field is clamped, never blows the directive bound.
  const hugeLabel = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 3_600_000, inFlightPlan: true, lastActivityLabel: 'A'.repeat(200000) });
  assert(hugeLabel.directive.length <= MAX_DIRECTIVE_LEN, '(9) huge label -> directive still bounded');
  assert(wellFormed(hugeLabel), '(9) huge label -> well-formed');

  // an emoji / astral label is preserved without splitting a surrogate pair.
  const emojiLabel = decideSessionResumption({ nowMs: NOW, lastActivityAtMs: NOW - 3_600_000, inFlightPlan: true, lastActivityLabel: 'ship it ' + '\u{1F680}'.repeat(3) });
  assert(wellFormed(emojiLabel), '(9) emoji label -> well-formed');
  assert(noControlChars(emojiLabel.directive), '(9) emoji label -> no stray control unit');
}

main();

if (failures > 0) {
  console.error(`\nchatSessionResumptionCore smoke: ${failures} FAILED, ${passes} passed`);
  process.exit(1);
}
console.log(`\nAll ${passes} assertions passed — chatSessionResumptionCore is sound.`);
