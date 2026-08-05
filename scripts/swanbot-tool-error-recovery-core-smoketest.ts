/**
 * swanbot-tool-error-recovery-core-smoketest — the pure LOOP-level decision
 * (src/lib/swanbotToolErrorRecoveryCore.ts) for what the tool loop does when a
 * single tool call ERRORS mid-turn. Distinct from failureRecoveryCopyCore
 * (user-facing copy); this is the machine retry/skip/ask/abort decision that
 * agentExecutionCore routes a tool error through instead of a blanket retry.
 *
 * Load-bearing assertions:
 *   decideToolErrorRecovery(input):
 *   - transient + attempts left → retry; at the cap → abort (retry→abort);
 *   - invalid_args → retry_with_fix; exhausted → abort;
 *   - auth / permission → ask_user (uncapped — never spuriously aborts);
 *   - not_found + hasAlternative → skip; no alt → retry_with_fix; exhausted → abort;
 *   - exhausted + hasAlternative → skip (prefer the alternative over a dead stop);
 *   - unknown kind → conservative retry_with_fix (capped);
 *   - action is ALWAYS one of the five valid actions; reason bounded + non-empty.
 *   normalizeToolErrorKind: canonical + provider/copy aliases + HTTP statuses +
 *     word-bounded keyword fallback (auth beats invalid_args on "invalid api
 *     key"; "generate"/"accurate" are NOT transient); default unknown.
 *   And: every export is TOTAL — null / undefined / wrong-type / huge / hostile /
 *     throwing-getter / circular input never throws (fails closed to abort).
 *
 * Pure — loads under tsx (swanbotToolErrorRecoveryCore has zero imports).
 * Run: npx tsx scripts/swanbot-tool-error-recovery-core-smoketest.ts
 */

import {
  decideToolErrorRecovery,
  normalizeToolErrorKind,
  TOOL_ERROR_MAX_ATTEMPTS,
  type ToolErrorKind,
  type ToolErrorRecoveryAction,
  type ToolErrorRecoveryInput,
  type ToolErrorRecoveryDecision,
} from '../src/lib/swanbotToolErrorRecoveryCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes += 1;
  else {
    failures += 1;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

/** Returns fn()'s value; records a failure + returns undefined if it throws. */
function noThrow<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    failures += 1;
    console.error('FAIL: threw (' + label + ') :: ' + String(e));
    return undefined;
  }
}

const VALID_ACTIONS: ReadonlySet<string> = new Set<ToolErrorRecoveryAction>([
  'retry',
  'retry_with_fix',
  'skip',
  'ask_user',
  'abort',
]);
const VALID_KINDS: ReadonlySet<string> = new Set<ToolErrorKind>([
  'transient',
  'not_found',
  'auth',
  'invalid_args',
  'permission',
  'unknown',
]);
const REASON_MAX = 200;

/** True if `s` holds any C0 control char (0x00–0x1F) or DEL (0x7F). Built with
 *  charCodeAt (not a control-char regex literal) so this source file stays free
 *  of raw control bytes. The sanitized reason must contain none. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** Assert a decision is well-formed regardless of which branch produced it. */
function assertValidDecision(d: ToolErrorRecoveryDecision | undefined, m: string): void {
  assert(!!d && typeof d === 'object', m + ' :: is object', JSON.stringify(d));
  if (!d || typeof d !== 'object') return;
  assert(VALID_ACTIONS.has(d.action), m + ' :: action valid', String(d.action));
  assert(typeof d.reason === 'string', m + ' :: reason is string', typeof d.reason);
  assert(typeof d.reason === 'string' && d.reason.length > 0, m + ' :: reason non-empty');
  assert(typeof d.reason === 'string' && d.reason.length <= REASON_MAX, m + ' :: reason <= 200', String(d.reason?.length));
}

/** Shorthand: just the action. */
function act(input: ToolErrorRecoveryInput): ToolErrorRecoveryAction {
  return decideToolErrorRecovery(input).action;
}

function main(): void {
  // ── 1. transient: retry while attempts remain, abort at the cap ─────────────
  {
    assertEq(TOOL_ERROR_MAX_ATTEMPTS, 3, '(1) cap is 3');
    assertEq(act({ errorKind: 'transient', attempts: 0 }), 'retry', '(1) transient attempt 0 → retry');
    assertEq(act({ errorKind: 'transient', attempts: 1 }), 'retry', '(1) transient attempt 1 → retry');
    assertEq(act({ errorKind: 'transient', attempts: 2 }), 'retry', '(1) transient attempt 2 → retry');
    assertEq(act({ errorKind: 'transient', attempts: 3 }), 'abort', '(1) transient attempt 3 (cap) → abort');
    assertEq(act({ errorKind: 'transient', attempts: 4 }), 'abort', '(1) transient attempt 4 → abort');
    assertEq(act({ errorKind: 'transient', attempts: 99 }), 'abort', '(1) transient attempt 99 → abort');
    // default attempts (absent) is a real failure → treated as 1 → retry
    assertEq(act({ errorKind: 'transient' }), 'retry', '(1) transient no-attempts → retry (default 1)');
    // at the cap WITH an alternative → skip (prefer the alternative over a stop)
    assertEq(act({ errorKind: 'transient', attempts: 3, hasAlternative: true }), 'skip', '(1) transient cap + alt → skip');
    // reason for a transient retry names the tool + attempt count
    const d = decideToolErrorRecovery({ errorKind: 'transient', attempts: 1, toolName: 'desktop.click_element' });
    assert(d.reason.includes('transient'), '(1) retry reason names transient', d.reason);
    assert(d.reason.includes('desktop.click_element'), '(1) retry reason names the tool', d.reason);
    assert(d.reason.includes('attempt 1 of 3'), '(1) retry reason shows attempt count', d.reason);
  }

  // ── 2. invalid_args → retry_with_fix; exhausted → abort ─────────────────────
  {
    assertEq(act({ errorKind: 'invalid_args', attempts: 1 }), 'retry_with_fix', '(2) invalid_args attempt 1 → retry_with_fix');
    assertEq(act({ errorKind: 'invalid_args', attempts: 2 }), 'retry_with_fix', '(2) invalid_args attempt 2 → retry_with_fix');
    assertEq(act({ errorKind: 'invalid_args' }), 'retry_with_fix', '(2) invalid_args default → retry_with_fix');
    assertEq(act({ errorKind: 'invalid_args', attempts: 3 }), 'abort', '(2) invalid_args cap → abort');
    assertEq(act({ errorKind: 'invalid_args', attempts: 3, hasAlternative: true }), 'skip', '(2) invalid_args cap + alt → skip');
    const d = decideToolErrorRecovery({ errorKind: 'invalid_args', attempts: 1, toolName: 'gsheets.append_rows' });
    assert(/invalid arguments/i.test(d.reason), '(2) retry_with_fix reason says invalid arguments', d.reason);
    assert(/correct the input/i.test(d.reason), '(2) retry_with_fix reason tells model to fix args', d.reason);
  }

  // ── 3. auth / permission → ask_user (uncapped, never aborts) ────────────────
  {
    assertEq(act({ errorKind: 'auth' }), 'ask_user', '(3) auth → ask_user');
    assertEq(act({ errorKind: 'auth', attempts: 1 }), 'ask_user', '(3) auth attempt 1 → ask_user');
    assertEq(act({ errorKind: 'auth', attempts: 3 }), 'ask_user', '(3) auth at cap → still ask_user (uncapped)');
    assertEq(act({ errorKind: 'auth', attempts: 99 }), 'ask_user', '(3) auth attempt 99 → still ask_user');
    // an alternative does NOT turn an auth failure into a skip — creds still needed
    assertEq(act({ errorKind: 'auth', attempts: 99, hasAlternative: true }), 'ask_user', '(3) auth + alt → still ask_user');
    assertEq(act({ errorKind: 'permission' }), 'ask_user', '(3) permission → ask_user');
    assertEq(act({ errorKind: 'permission', attempts: 5 }), 'ask_user', '(3) permission attempt 5 → ask_user');
    assertEq(act({ errorKind: 'permission', attempts: 5, hasAlternative: true }), 'ask_user', '(3) permission + alt → ask_user');
    const da = decideToolErrorRecovery({ errorKind: 'auth', toolName: 'gmail.send' });
    assert(/authentication|credential/i.test(da.reason), '(3) auth reason names credential/authentication', da.reason);
    assert(/ask the user/i.test(da.reason), '(3) auth reason says ask the user', da.reason);
    const dp = decideToolErrorRecovery({ errorKind: 'permission' });
    assert(/permission|approval|access/i.test(dp.reason), '(3) permission reason names approval/access', dp.reason);
  }

  // ── 4. not_found: alt → skip; no alt → retry_with_fix; exhausted → abort ────
  {
    assertEq(act({ errorKind: 'not_found', hasAlternative: true }), 'skip', '(4) not_found + alt → skip');
    // skip is uncapped: not_found + alt at high attempts still skips
    assertEq(act({ errorKind: 'not_found', hasAlternative: true, attempts: 9 }), 'skip', '(4) not_found + alt at high attempts → skip');
    assertEq(act({ errorKind: 'not_found', attempts: 1 }), 'retry_with_fix', '(4) not_found no-alt attempt 1 → retry_with_fix');
    assertEq(act({ errorKind: 'not_found', attempts: 2 }), 'retry_with_fix', '(4) not_found no-alt attempt 2 → retry_with_fix');
    assertEq(act({ errorKind: 'not_found' }), 'retry_with_fix', '(4) not_found no-alt default → retry_with_fix');
    assertEq(act({ errorKind: 'not_found', attempts: 3 }), 'abort', '(4) not_found no-alt cap → abort');
    assertEq(act({ errorKind: 'not_found', attempts: 3, hasAlternative: true }), 'skip', '(4) not_found cap + alt → skip');
    const ds = decideToolErrorRecovery({ errorKind: 'not_found', hasAlternative: true, toolName: 'browser.click' });
    assert(/alternative/i.test(ds.reason), '(4) skip reason names alternative', ds.reason);
    assert(/not found/i.test(ds.reason), '(4) skip reason names not-found', ds.reason);
    const dr = decideToolErrorRecovery({ errorKind: 'not_found', attempts: 1 });
    assert(/re-observe|correct the target/i.test(dr.reason), '(4) no-alt not_found reason says re-observe/fix target', dr.reason);
  }

  // ── 5. unknown kind → conservative retry_with_fix (capped) ──────────────────
  {
    assertEq(act({ errorKind: 'unknown', attempts: 1 }), 'retry_with_fix', '(5) unknown attempt 1 → retry_with_fix');
    assertEq(act({ errorKind: 'unknown', attempts: 3 }), 'abort', '(5) unknown cap → abort');
    assertEq(act({ errorKind: 'unknown', attempts: 3, hasAlternative: true }), 'skip', '(5) unknown cap + alt → skip');
    // an unclassifiable free-text kind behaves like unknown
    assertEq(act({ errorKind: 'kaboom-weird-thing', attempts: 1 }), 'retry_with_fix', '(5) garbage kind attempt 1 → retry_with_fix');
    assertEq(act({ errorKind: 'kaboom-weird-thing', attempts: 3 }), 'abort', '(5) garbage kind cap → abort');
    const du = decideToolErrorRecovery({ errorKind: 'unknown', attempts: 1 });
    assert(/unclassified|change your approach/i.test(du.reason), '(5) unknown reason says change approach', du.reason);
  }

  // ── 6. exhausted + alternative → skip across looping kinds ──────────────────
  {
    for (const k of ['transient', 'invalid_args', 'not_found', 'unknown'] as ToolErrorKind[]) {
      assertEq(act({ errorKind: k, attempts: 3, hasAlternative: true }), 'skip', `(6) ${k} exhausted + alt → skip`);
      assertEq(act({ errorKind: k, attempts: 3, hasAlternative: false }), 'abort', `(6) ${k} exhausted no alt → abort`);
    }
  }

  // ── 7. normalizeToolErrorKind: canonical + aliases + statuses + keywords ────
  {
    // canonical passthrough
    assertEq(normalizeToolErrorKind('transient'), 'transient', '(7) canonical transient');
    assertEq(normalizeToolErrorKind('not_found'), 'not_found', '(7) canonical not_found');
    assertEq(normalizeToolErrorKind('auth'), 'auth', '(7) canonical auth');
    assertEq(normalizeToolErrorKind('invalid_args'), 'invalid_args', '(7) canonical invalid_args');
    assertEq(normalizeToolErrorKind('permission'), 'permission', '(7) canonical permission');
    assertEq(normalizeToolErrorKind('unknown'), 'unknown', '(7) canonical unknown');
    // providerErrorAdvanceCore / failureRecoveryCopyCore vocab → buckets
    assertEq(normalizeToolErrorKind('rate_limit'), 'transient', '(7) rate_limit → transient');
    assertEq(normalizeToolErrorKind('overload'), 'transient', '(7) overload → transient');
    assertEq(normalizeToolErrorKind('overloaded'), 'transient', '(7) overloaded → transient');
    assertEq(normalizeToolErrorKind('timeout'), 'transient', '(7) timeout → transient');
    assertEq(normalizeToolErrorKind('network'), 'transient', '(7) network → transient');
    assertEq(normalizeToolErrorKind('bridge_offline'), 'transient', '(7) bridge_offline → transient');
    assertEq(normalizeToolErrorKind('enotfound'), 'transient', '(7) ENOTFOUND → transient (DNS, not not_found)');
    assertEq(normalizeToolErrorKind('permanent'), 'unknown', '(7) permanent → unknown (conservative)');
    // HTTP statuses (string + number)
    assertEq(normalizeToolErrorKind('429'), 'transient', '(7) 429 → transient');
    assertEq(normalizeToolErrorKind('529'), 'transient', '(7) 529 → transient');
    assertEq(normalizeToolErrorKind('503'), 'transient', '(7) 503 → transient');
    assertEq(normalizeToolErrorKind(404), 'not_found', '(7) number 404 → not_found');
    assertEq(normalizeToolErrorKind(401), 'auth', '(7) number 401 → auth');
    assertEq(normalizeToolErrorKind(403), 'permission', '(7) number 403 → permission');
    assertEq(normalizeToolErrorKind(400), 'invalid_args', '(7) number 400 → invalid_args');
    // aliases
    assertEq(normalizeToolErrorKind('missing'), 'not_found', '(7) missing → not_found');
    assertEq(normalizeToolErrorKind('unauthorized'), 'auth', '(7) unauthorized → auth');
    assertEq(normalizeToolErrorKind('invalid_api_key'), 'auth', '(7) invalid_api_key → auth (NOT invalid_args)');
    assertEq(normalizeToolErrorKind('forbidden'), 'permission', '(7) forbidden → permission');
    assertEq(normalizeToolErrorKind('access_denied'), 'permission', '(7) access_denied → permission');
    assertEq(normalizeToolErrorKind('bad_request'), 'invalid_args', '(7) bad_request → invalid_args');
    assertEq(normalizeToolErrorKind('validation_error'), 'invalid_args', '(7) validation_error → invalid_args');
    // case + separator normalization
    assertEq(normalizeToolErrorKind('RATE_LIMIT'), 'transient', '(7) RATE_LIMIT (upper) → transient');
    assertEq(normalizeToolErrorKind('rate-limit'), 'transient', '(7) rate-limit (hyphen) → transient');
    assertEq(normalizeToolErrorKind('Rate Limit'), 'transient', '(7) "Rate Limit" (space) → transient');
    assertEq(normalizeToolErrorKind('  not_found  '), 'not_found', '(7) padded not_found → not_found');
    // word-bounded keyword fallback for looser free text
    assertEq(normalizeToolErrorKind('invalid api key provided'), 'auth', '(7) "invalid api key" → auth (auth beats invalid_args)');
    assertEq(normalizeToolErrorKind('permission denied for user'), 'permission', '(7) "permission denied" → permission');
    assertEq(normalizeToolErrorKind('element not found on screen'), 'not_found', '(7) "not found" phrase → not_found');
    assertEq(normalizeToolErrorKind('the request timed out'), 'transient', '(7) "timed out" phrase → transient');
    assertEq(normalizeToolErrorKind('the model is overloaded right now'), 'transient', '(7) "overloaded" phrase → transient');
    assertEq(normalizeToolErrorKind('invalid input for parameter'), 'invalid_args', '(7) "invalid input" phrase → invalid_args');
    // word boundary guards: "generate"/"accurate" must NOT read as transient(rate)
    assertEq(normalizeToolErrorKind('failed to generate output'), 'unknown', '(7) "generate" NOT transient');
    assertEq(normalizeToolErrorKind('accurate but slow'), 'unknown', '(7) "accurate" NOT transient');
    // empty / junk → unknown
    assertEq(normalizeToolErrorKind(''), 'unknown', '(7) empty → unknown');
    assertEq(normalizeToolErrorKind('   '), 'unknown', '(7) blank → unknown');
    assertEq(normalizeToolErrorKind('totally-made-up-word'), 'unknown', '(7) nonsense → unknown');
  }

  // ── 8. attempts normalization ───────────────────────────────────────────────
  {
    // numeric-string attempts are coerced
    assertEq(act({ errorKind: 'transient', attempts: '2' }), 'retry', '(8) attempts "2" (string) → retry');
    assertEq(act({ errorKind: 'transient', attempts: '3' }), 'abort', '(8) attempts "3" (string) → abort (cap)');
    // negative clamps to 0 → not exhausted
    assertEq(act({ errorKind: 'transient', attempts: -5 }), 'retry', '(8) negative attempts → clamp 0 → retry');
    // huge clamps but is still >= cap → exhausted
    assertEq(act({ errorKind: 'transient', attempts: 1e9 }), 'abort', '(8) huge attempts → abort (>= cap)');
    assertEq(act({ errorKind: 'transient', attempts: Number.MAX_SAFE_INTEGER }), 'abort', '(8) MAX_SAFE_INTEGER attempts → abort');
    // NaN / Infinity / non-number fall back to the default (1) → not exhausted
    assertEq(act({ errorKind: 'transient', attempts: NaN }), 'retry', '(8) NaN attempts → default → retry');
    assertEq(act({ errorKind: 'transient', attempts: Infinity }), 'retry', '(8) Infinity attempts → default → retry');
    assertEq(act({ errorKind: 'transient', attempts: 'not-a-number' }), 'retry', '(8) junk-string attempts → default → retry');
    assertEq(act({ errorKind: 'transient', attempts: {} }), 'retry', '(8) object attempts → default → retry');
    // fractional attempts floor
    assertEq(act({ errorKind: 'transient', attempts: 2.9 }), 'retry', '(8) 2.9 attempts → floor 2 → retry');
    assertEq(act({ errorKind: 'transient', attempts: 3.9 }), 'abort', '(8) 3.9 attempts → floor 3 → abort');
  }

  // ── 9. hasAlternative strictness — only literal `true` counts ────────────────
  {
    // at the cap: only literal true → skip; every truthy-not-true → abort
    assertEq(act({ errorKind: 'transient', attempts: 3, hasAlternative: true }), 'skip', '(9) alt=true → skip');
    assertEq(act({ errorKind: 'transient', attempts: 3, hasAlternative: 1 }), 'abort', '(9) alt=1 (truthy) → abort');
    assertEq(act({ errorKind: 'transient', attempts: 3, hasAlternative: 'yes' }), 'abort', '(9) alt="yes" → abort');
    assertEq(act({ errorKind: 'transient', attempts: 3, hasAlternative: {} }), 'abort', '(9) alt={} → abort');
    assertEq(act({ errorKind: 'transient', attempts: 3, hasAlternative: false }), 'abort', '(9) alt=false → abort');
    assertEq(act({ errorKind: 'transient', attempts: 3 }), 'abort', '(9) alt absent → abort');
    // not_found: only literal true routes to skip
    assertEq(act({ errorKind: 'not_found', hasAlternative: 1 }), 'retry_with_fix', '(9) not_found alt=1 → retry_with_fix (not skip)');
    assertEq(act({ errorKind: 'not_found', hasAlternative: true }), 'skip', '(9) not_found alt=true → skip');
  }

  // ── 10. reason quality, bounds, and tool-label sanitization ─────────────────
  {
    // every decision has a bounded, non-empty reason across the full matrix
    for (const k of [...VALID_KINDS] as ToolErrorKind[]) {
      for (const attempts of [0, 1, 3, 99]) {
        for (const hasAlternative of [true, false]) {
          assertValidDecision(
            decideToolErrorRecovery({ errorKind: k, attempts, hasAlternative, toolName: 't' }),
            `(10) ${k}/${attempts}/${hasAlternative}`,
          );
        }
      }
    }
    // absent tool name → generic label
    const dNoTool = decideToolErrorRecovery({ errorKind: 'transient', attempts: 1 });
    assert(dNoTool.reason.includes('the tool'), '(10) absent toolName → "the tool"', dNoTool.reason);
    // huge/hostile tool name is clamped and cannot bloat the reason
    const huge = 'Z'.repeat(50000);
    const dHuge = decideToolErrorRecovery({ errorKind: 'transient', attempts: 1, toolName: huge });
    assert(dHuge.reason.length <= REASON_MAX, '(10) reason bounded despite huge toolName', String(dHuge.reason.length));
    assertValidDecision(dHuge, '(10) huge toolName decision valid');
    // backticks / control chars in the tool name are stripped (no format break).
    // The `\n` + `\t` here are SOURCE escapes (backslash-n / backslash-t), not raw
    // bytes — the runtime string carries the actual control chars for the test.
    const dTick = decideToolErrorRecovery({ errorKind: 'transient', attempts: 1, toolName: 'evil`name`\n\tinject' });
    assert(!dTick.reason.includes('evil`name`'), '(10) backticks stripped from tool label', dTick.reason);
    assert(!hasControlChar(dTick.reason), '(10) control chars stripped from reason', JSON.stringify(dTick.reason));
    assertValidDecision(dTick, '(10) sanitized tool label decision valid');
  }

  // ── 11. determinism + action always valid + constant ────────────────────────
  {
    const inA = { errorKind: 'transient', attempts: 2, toolName: 'x', hasAlternative: false };
    assertEq(
      JSON.stringify(decideToolErrorRecovery(inA)),
      JSON.stringify(decideToolErrorRecovery(inA)),
      '(11) deterministic (same input → same output)',
    );
    // a broad sweep: action is always valid; kind always in the enum
    for (const ek of ['transient', 'not_found', 'auth', 'invalid_args', 'permission', 'unknown', 'rate_limit', '404', 'garbage', '']) {
      assert(VALID_KINDS.has(normalizeToolErrorKind(ek)), `(11) normalizeToolErrorKind(${JSON.stringify(ek)}) in enum`, normalizeToolErrorKind(ek));
      for (let attempts = 0; attempts <= 4; attempts += 1) {
        assert(VALID_ACTIONS.has(act({ errorKind: ek, attempts })), `(11) action valid ek=${ek} n=${attempts}`);
      }
    }
    assert(typeof TOOL_ERROR_MAX_ATTEMPTS === 'number' && TOOL_ERROR_MAX_ATTEMPTS >= 1, '(11) cap is a positive number');
  }

  // ── 12. Degenerate / hostile input — must NEVER throw (fail closed) ──────────
  try {
    // throwing getters on each field
    const throwingErrorKind: Record<string, unknown> = { attempts: 1 };
    Object.defineProperty(throwingErrorKind, 'errorKind', { get() { throw new Error('boom-kind'); }, enumerable: true });
    const throwingAttempts: Record<string, unknown> = { errorKind: 'transient' };
    Object.defineProperty(throwingAttempts, 'attempts', { get() { throw new Error('boom-attempts'); }, enumerable: true });
    const throwingAlt: Record<string, unknown> = { errorKind: 'not_found' };
    Object.defineProperty(throwingAlt, 'hasAlternative', { get() { throw new Error('boom-alt'); }, enumerable: true });
    const throwingName: Record<string, unknown> = { errorKind: 'transient', attempts: 1 };
    Object.defineProperty(throwingName, 'toolName', { get() { throw new Error('boom-name'); }, enumerable: true });
    // circular input
    const circular: Record<string, unknown> = { errorKind: 'transient', attempts: 1 };
    circular.self = circular;
    // errorKind whose toString throws
    const badToString = { toString() { throw new Error('boom-tostring'); } };
    // huge string with a leading keyword (bounded scan must still classify it)
    const hugeAuth = 'unauthorized ' + 'y'.repeat(2_000_000);

    const hostileInputs: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['zero', 0],
      ['NaN', NaN],
      ['boolean', true],
      ['string', 'nope'],
      ['symbol', Symbol('x')],
      ['function', () => 0],
      ['array', []],
      ['array of junk', [1, 'two', null]],
      ['empty obj', {}],
      ['throwing errorKind getter', throwingErrorKind],
      ['throwing attempts getter', throwingAttempts],
      ['throwing hasAlternative getter', throwingAlt],
      ['throwing toolName getter', throwingName],
      ['circular', circular],
      ['errorKind bad toString', { errorKind: badToString, attempts: 1 }],
      ['errorKind symbol', { errorKind: Symbol('k'), attempts: 1 }],
      ['errorKind bigint', { errorKind: 10n, attempts: 1 }],
      ['errorKind object', { errorKind: { a: 1 }, attempts: 1 }],
      ['errorKind array', { errorKind: ['transient'], attempts: 1 }],
      ['attempts as array', { errorKind: 'transient', attempts: [3] }],
      ['attempts bigint', { errorKind: 'transient', attempts: 3n }],
      ['toolName number', { errorKind: 'transient', attempts: 1, toolName: 999 }],
      ['toolName object', { errorKind: 'transient', attempts: 1, toolName: {} }],
      ['huge errorKind w/ keyword', { errorKind: hugeAuth, attempts: 1 }],
      ['huge errorKind no keyword', { errorKind: 'x'.repeat(2_000_000), attempts: 1 }],
      ['all hostile fields', { errorKind: Symbol('z'), attempts: {}, toolName: [], hasAlternative: 'maybe' }],
    ];
    for (const [label, input] of hostileInputs) {
      const d = noThrow('decide ' + label, () => decideToolErrorRecovery(input as ToolErrorRecoveryInput));
      assertValidDecision(d, '(12) hostile decide ' + label);
    }

    // normalizeToolErrorKind hostile inputs — always a valid kind, never throws
    const hostileKinds: unknown[] = [
      null, undefined, 42, 0, NaN, true, false, {}, [], Symbol('x'), () => 0, 10n,
      badToString, { toString() { return 'auth'; } }, ['transient'],
      'x'.repeat(2_000_000), hugeAuth,
    ];
    for (const k of hostileKinds) {
      const kind = noThrow('normalize ' + String(typeof k), () => normalizeToolErrorKind(k));
      assert(typeof kind === 'string' && VALID_KINDS.has(kind as string), '(12) normalize hostile → valid kind', String(kind));
    }
    // specific hostile expectations that should still resolve meaningfully
    assertEq(normalizeToolErrorKind(hugeAuth), 'auth', '(12) huge string w/ leading "unauthorized" → auth (bounded scan)');
    assertEq(normalizeToolErrorKind('x'.repeat(2_000_000)), 'unknown', '(12) huge no-keyword string → unknown (bounded)');
    // a throwing-errorKind-getter input degrades gracefully (errorKind → unknown
    // via the field-level safeGet), NOT to the fail-closed abort backstop
    const dThrowKind = decideToolErrorRecovery(throwingErrorKind as ToolErrorRecoveryInput);
    assertValidDecision(dThrowKind, '(12) throwing-errorKind decision valid');
    assertEq(dThrowKind.action, 'retry_with_fix', '(12) throwing errorKind getter → unknown kind → retry_with_fix (n=1)');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error('FAIL: (12) degenerate inputs threw: ' + ((e as Error) && (e as Error).message));
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll swanbot-tool-error-recovery-core smoke cases passed (' + passes + ' passed).');
}

main();
