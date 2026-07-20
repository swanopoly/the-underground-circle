/**
 * tool-replay-safety-core-smoketest — the PURE replay-safety gate
 * (src/lib/toolReplaySafetyCore.ts) that decides whether a FAILED, side-effecting
 * tool call may be replayed as-is, gating a `retry` on the two axes:
 *   side-effect class (read_only | idempotent_write | unsafe_write | unknown)
 *     × failure disposition (not_sent | outcome_unknown | rejected)
 *     × freshVerificationAvailable
 *   → verdict (replay_safe | verify_first | unsafe_replay).
 *
 * Load-bearing assertions:
 *   classifyToolSideEffect(sideEffect): canonical strings, ToolParallelPolicy
 *     ({mutatesState, externalSideEffect}), and MCP hints ({readOnlyHint,
 *     destructiveHint, idempotentHint}) → the right class.
 *   classifyFailureDisposition(disposition): econnrefused/bridge/invalid_args →
 *     not_sent; timeout/504/socket-hang-up/'' → outcome_unknown (conservative
 *     default); 409/conflict/validation → rejected.
 *   decideToolReplaySafety(input): the full verdict table, incl. unsafe_write +
 *     outcome_unknown + no verification → unsafe_replay (fail-closed).
 *   isReplaySafe(input): === safety==='replay_safe'.
 *
 * And: every export is TOTAL — null/undefined/number/NaN/{}/[]-as-input, a
 * throwing-getter / circular / proxy / symbol / function, a huge string, and a
 * secret-shaped toolName ⇒ a valid bounded decision, never a throw, never a
 * leaked secret, uncomputable ⇒ unsafe_replay (fail-closed).
 *
 * Pure — loads under tsx (the core has ZERO runtime imports).
 */

import {
  classifyToolSideEffect,
  classifyFailureDisposition,
  decideToolReplaySafety,
  isReplaySafe,
  MAX_REPLAY_REASON_LENGTH,
  MAX_REPLAY_TOOL_LABEL_LENGTH,
  MAX_REPLAY_SCAN_LENGTH,
  type ToolReplaySafetyInput,
  type ToolReplaySafetyDecision,
  type ToolSideEffectClass,
  type ToolFailureDisposition,
  type ToolReplaySafety,
} from '../src/lib/toolReplaySafetyCore';

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
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── vocab (validation source of truth, local to the smoke) ───────────────────
const SAFETIES: ToolReplaySafety[] = ['replay_safe', 'verify_first', 'unsafe_replay'];
const CLASSES: ToolSideEffectClass[] = ['read_only', 'idempotent_write', 'unsafe_write', 'unknown'];
const DISPOS: ToolFailureDisposition[] = ['not_sent', 'outcome_unknown', 'rejected'];

// Any control / DEL / C1 / fence char (regex literal, no raw bytes) OR the two
// Unicode line separators + zero-width/bidi markers (built via fromCharCode so
// no raw invisibles in this source). NOTE: the reason is intentionally
// backtick-free, so a stray "`" would be a leak — we DO flag it here.
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
const ZW = String.fromCharCode(0x200b, 0x202e, 0xfeff);
function hasUnsafeChars(s: string): boolean {
  if (/[\x00-\x1f\x7f-\x9f`<>]/.test(s)) return true;
  for (const ch of LINE_SEP + ZW) if (s.indexOf(ch) >= 0) return true;
  return false;
}

// ── call wrappers (keep hostile fixtures cast-free at the call sites) ─────────
function d(input?: unknown): ToolReplaySafetyDecision {
  return decideToolReplaySafety(input as ToolReplaySafetyInput);
}
function safeBool(input?: unknown): boolean {
  return isReplaySafe(input as ToolReplaySafetyInput);
}
function se(sideEffect?: unknown): ToolSideEffectClass {
  return classifyToolSideEffect(sideEffect);
}
function fd(disposition?: unknown): ToolFailureDisposition {
  return classifyFailureDisposition(disposition);
}

/** Structural invariants any decision must satisfy. */
function decisionIsValid(x: unknown): x is ToolReplaySafetyDecision {
  if (!x || typeof x !== 'object') return false;
  const dd = x as ToolReplaySafetyDecision;
  if (!SAFETIES.includes(dd.safety)) return false;
  if (!CLASSES.includes(dd.sideEffectClass)) return false;
  if (!DISPOS.includes(dd.disposition)) return false;
  if (typeof dd.reason !== 'string' || dd.reason.length === 0 || dd.reason.length > MAX_REPLAY_REASON_LENGTH) return false;
  if (hasUnsafeChars(dd.reason)) return false;
  return true;
}

/** decide + isReplaySafe agree, are valid, and never throw. */
function totalOn(input: unknown): boolean {
  try {
    const dec = d(input);
    if (!decisionIsValid(dec)) return false;
    if (safeBool(input) !== (dec.safety === 'replay_safe')) return false;
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (A) read_only → replay_safe for EVERY disposition ──────────────────────
  {
    for (const dispo of ['not_sent', 'outcome_unknown', 'rejected', 'timeout', 'econnrefused', '504']) {
      const dec = d({ sideEffect: 'read_only', disposition: dispo, toolName: 'gsheets.read_range' });
      assertEq(dec.safety, 'replay_safe', `(A) read_only + ${JSON.stringify(dispo)} → replay_safe`);
      assertEq(dec.sideEffectClass, 'read_only', `(A) class echoed read_only (${dispo})`);
      assert(decisionIsValid(dec), `(A) valid decision (${dispo})`);
      assert(/read-only/i.test(dec.reason), '(A) reason mentions read-only', dec.reason);
    }
    // read_only + outcome_unknown + NO verification is still safe (no effect to double)
    const dec = d({ sideEffect: { readOnlyHint: true }, disposition: 'timeout', freshVerificationAvailable: false });
    assertEq(dec.safety, 'replay_safe', '(A) read_only ignores missing verification');
    assertEq(safeBool({ sideEffect: 'read_only', disposition: 'timeout' }), true, '(A) isReplaySafe true for read_only');
  }

  // ─── (B) idempotent_write → replay_safe for EVERY disposition ───────────────
  {
    for (const dispo of ['not_sent', 'outcome_unknown', 'rejected', 'socket hang up', '502']) {
      const dec = d({ sideEffect: { idempotentHint: true }, disposition: dispo, toolName: 'gsheets.set_cell' });
      assertEq(dec.safety, 'replay_safe', `(B) idempotent_write + ${JSON.stringify(dispo)} → replay_safe`);
      assertEq(dec.sideEffectClass, 'idempotent_write', `(B) class echoed idempotent_write (${dispo})`);
      assert(/idempotent/i.test(dec.reason), '(B) reason mentions idempotent', dec.reason);
    }
    // canonical string form is idempotent too
    assertEq(d({ sideEffect: 'idempotent_write', disposition: 'timeout' }).safety, 'replay_safe', '(B) canonical idempotent string');
    // an idempotent hint WITH a destructive hint is NOT idempotent (destructive wins)
    assertEq(se({ idempotentHint: true, destructiveHint: true }), 'unsafe_write', '(B) destructive overrides idempotent');
  }

  // ─── (C) unsafe_write (git push) — the disposition decides ──────────────────
  {
    const push = { mutatesState: true, externalSideEffect: true }; // ToolParallelPolicy for git push
    assertEq(se(push), 'unsafe_write', '(C) git push policy → unsafe_write');

    const notSent = d({ sideEffect: push, disposition: 'econnrefused', toolName: 'git.run' });
    assertEq(notSent.safety, 'replay_safe', '(C) unsafe_write + not_sent → replay_safe');
    assertEq(notSent.disposition, 'not_sent', '(C) disposition classified not_sent');
    assert(/never reached/i.test(notSent.reason), '(C) reason: never reached', notSent.reason);

    const rejected = d({ sideEffect: push, disposition: '409 conflict', toolName: 'git.run' });
    assertEq(rejected.safety, 'replay_safe', '(C) unsafe_write + rejected(409) → replay_safe');
    assertEq(rejected.disposition, 'rejected', '(C) disposition classified rejected');

    const verify = d({ sideEffect: push, disposition: 'timeout', freshVerificationAvailable: true, toolName: 'git.run' });
    assertEq(verify.safety, 'verify_first', '(C) unsafe_write + outcome_unknown + verify → verify_first');
    assertEq(verify.disposition, 'outcome_unknown', '(C) disposition classified outcome_unknown');
    assert(/re-observe/i.test(verify.reason), '(C) reason: re-observe first', verify.reason);

    const unsafe = d({ sideEffect: push, disposition: 'timeout', freshVerificationAvailable: false, toolName: 'git.run' });
    assertEq(unsafe.safety, 'unsafe_replay', '(C) unsafe_write + outcome_unknown + no-verify → unsafe_replay');
    assert(/do not replay/i.test(unsafe.reason), '(C) reason: do not replay', unsafe.reason);
    assertEq(safeBool({ sideEffect: push, disposition: 'timeout' }), false, '(C) isReplaySafe false when unsafe_replay');

    // missing freshVerificationAvailable (undefined, not true) → unsafe_replay
    const noFlag = d({ sideEffect: push, disposition: 'timeout' });
    assertEq(noFlag.safety, 'unsafe_replay', '(C) absent verification flag → unsafe_replay');
    // a non-true flag (truthy but not literal true) still counts as "no verification"
    assertEq(d({ sideEffect: push, disposition: 'timeout', freshVerificationAvailable: 'yes' }).safety, 'unsafe_replay', '(C) only literal true enables verify_first');
    // destructive MCP hint is the same unsafe_write path
    assertEq(d({ sideEffect: { destructiveHint: true }, disposition: 'timeout' }).safety, 'unsafe_replay', '(C) MCP destructive + outcome_unknown → unsafe_replay');
  }

  // ─── (D) unknown side-effect (no metadata) treated as unsafe ────────────────
  {
    assertEq(se({}), 'unknown', '(D) no metadata → unknown class');
    const unsafe = d({ sideEffect: {}, disposition: 'timeout', freshVerificationAvailable: false, toolName: 'mystery.tool' });
    assertEq(unsafe.safety, 'unsafe_replay', '(D) unknown + outcome_unknown + no-verify → unsafe_replay');
    assertEq(unsafe.sideEffectClass, 'unknown', '(D) class echoed unknown');

    const notSent = d({ sideEffect: {}, disposition: 'bridge offline', toolName: 'mystery.tool' });
    assertEq(notSent.safety, 'replay_safe', '(D) unknown + not_sent → replay_safe (no effect possible)');

    const verify = d({ sideEffect: undefined, disposition: 'timeout', freshVerificationAvailable: true });
    assertEq(verify.safety, 'verify_first', '(D) unknown + outcome_unknown + verify → verify_first');
    // rejected also clears an unknown-class tool
    assertEq(d({ sideEffect: {}, disposition: 'validation' }).safety, 'replay_safe', '(D) unknown + rejected → replay_safe');
  }

  // ─── (E) classifyToolSideEffect ─────────────────────────────────────────────
  {
    // ToolParallelPolicy shapes
    assertEq(se({ mutatesState: false, externalSideEffect: false }), 'read_only', '(E) {mutates:false,external:false} → read_only');
    assertEq(se({ externalSideEffect: true }), 'unsafe_write', '(E) {external:true} → unsafe_write');
    assertEq(se({ mutatesState: true }), 'unsafe_write', '(E) {mutates:true} (no idempotent) → unsafe_write');
    assertEq(se({ mutatesState: true, idempotentHint: true }), 'idempotent_write', '(E) mutates + idempotentHint → idempotent_write');
    // MCP annotation shapes
    assertEq(se({ destructiveHint: true }), 'unsafe_write', '(E) MCP {destructiveHint:true} → unsafe_write');
    assertEq(se({ readOnlyHint: true }), 'read_only', '(E) MCP {readOnlyHint:true} → read_only');
    assertEq(se({ idempotentHint: true }), 'idempotent_write', '(E) MCP {idempotentHint:true} → idempotent_write');
    // readOnly wins even alongside a mutate flag (explicit read-only claim)
    assertEq(se({ readOnlyHint: true, mutatesState: true }), 'read_only', '(E) readOnlyHint wins the cascade');
    // canonical strings + aliases
    assertEq(se('read_only'), 'read_only', '(E) canonical "read_only"');
    assertEq(se('readonly'), 'read_only', '(E) alias "readonly"');
    assertEq(se('unsafe_write'), 'unsafe_write', '(E) canonical "unsafe_write"');
    assertEq(se('destructive'), 'unsafe_write', '(E) alias "destructive"');
    assertEq(se('write'), 'unsafe_write', '(E) bare "write" → unsafe (safe direction)');
    assertEq(se('idempotent'), 'idempotent_write', '(E) alias "idempotent"');
    assertEq(se('unknown'), 'unknown', '(E) canonical "unknown"');
    assertEq(se('totally-made-up'), 'unknown', '(E) unrecognized string → unknown');
    // empty object / empty string → unknown
    assertEq(se(''), 'unknown', '(E) empty string → unknown');
    assertEq(se([]), 'unknown', '(E) array with no hints → unknown');
  }

  // ─── (F) classifyFailureDisposition ─────────────────────────────────────────
  {
    // not_sent
    assertEq(fd('econnrefused'), 'not_sent', '(F) econnrefused → not_sent');
    assertEq(fd('connection refused'), 'not_sent', '(F) connection refused → not_sent');
    assertEq(fd('ENOTFOUND'), 'not_sent', '(F) ENOTFOUND (DNS) → not_sent');
    assertEq(fd('bridge offline'), 'not_sent', '(F) bridge offline → not_sent');
    assertEq(fd('invalid_args'), 'not_sent', '(F) invalid_args (client-side) → not_sent');
    assertEq(fd('unauthorized'), 'not_sent', '(F) unauthorized (pre-send 401) → not_sent');
    assertEq(fd(401), 'not_sent', '(F) status 401 → not_sent');
    assertEq(fd(403), 'not_sent', '(F) status 403 → not_sent');
    assertEq(fd('not_sent'), 'not_sent', '(F) canonical not_sent');
    // outcome_unknown (conservative default + explicit)
    assertEq(fd('timeout'), 'outcome_unknown', '(F) timeout → outcome_unknown');
    assertEq(fd('504'), 'outcome_unknown', '(F) 504 → outcome_unknown');
    assertEq(fd(504), 'outcome_unknown', '(F) numeric 504 → outcome_unknown');
    assertEq(fd('socket hang up'), 'outcome_unknown', '(F) socket hang up → outcome_unknown');
    assertEq(fd('ECONNRESET'), 'outcome_unknown', '(F) ECONNRESET → outcome_unknown');
    assertEq(fd('aborted'), 'outcome_unknown', '(F) aborted → outcome_unknown');
    assertEq(fd('empty body'), 'outcome_unknown', '(F) empty body → outcome_unknown');
    assertEq(fd(''), 'outcome_unknown', '(F) empty string → outcome_unknown (conservative default)');
    assertEq(fd('something weird'), 'outcome_unknown', '(F) unrecognized → outcome_unknown (conservative default)');
    assertEq(fd(500), 'outcome_unknown', '(F) status 500 → outcome_unknown');
    assertEq(fd('outcome_unknown'), 'outcome_unknown', '(F) canonical outcome_unknown');
    // rejected
    assertEq(fd('409 conflict'), 'rejected', '(F) 409 conflict → rejected');
    assertEq(fd(409), 'rejected', '(F) numeric 409 → rejected');
    assertEq(fd('validation'), 'rejected', '(F) validation → rejected');
    assertEq(fd('422'), 'rejected', '(F) 422 → rejected');
    assertEq(fd(400), 'rejected', '(F) status 400 → rejected');
    assertEq(fd('rejected'), 'rejected', '(F) canonical rejected');
    // error-object shape
    assertEq(fd({ code: 'ETIMEDOUT' }), 'outcome_unknown', '(F) {code:ETIMEDOUT} → outcome_unknown');
    assertEq(fd({ status: 409, message: 'conflict' }), 'rejected', '(F) {status:409} → rejected');
    assertEq(fd({ code: 'ECONNREFUSED' }), 'not_sent', '(F) {code:ECONNREFUSED} → not_sent');
    // conservative dominance: an outcome_unknown signal alongside a not_sent one wins
    assertEq(fd('connection refused then timeout'), 'outcome_unknown', '(F) outcome_unknown dominates a mixed signal');
  }

  // ─── (G) isReplaySafe convenience ───────────────────────────────────────────
  {
    assertEq(safeBool({ sideEffect: 'read_only', disposition: 'timeout' }), true, '(G) read_only → true');
    assertEq(safeBool({ sideEffect: 'idempotent_write', disposition: 'timeout' }), true, '(G) idempotent → true');
    assertEq(safeBool({ sideEffect: 'unsafe_write', disposition: 'not_sent' }), true, '(G) unsafe+not_sent → true');
    assertEq(safeBool({ sideEffect: 'unsafe_write', disposition: 'timeout', freshVerificationAvailable: true }), false, '(G) verify_first → NOT replay_safe');
    assertEq(safeBool({ sideEffect: 'unsafe_write', disposition: 'timeout' }), false, '(G) unsafe_replay → false');
    // agreement with decide for a battery of inputs
    const battery: ToolReplaySafetyInput[] = [
      { sideEffect: 'read_only', disposition: 'rejected' },
      { sideEffect: { destructiveHint: true }, disposition: 'not_sent' },
      { sideEffect: {}, disposition: 'timeout' },
      { sideEffect: 'unsafe_write', disposition: '409' },
    ];
    for (const b of battery) {
      assertEq(safeBool(b), d(b).safety === 'replay_safe', `(G) isReplaySafe agrees with decide :: ${JSON.stringify(b)}`);
    }
  }

  // ─── (H) bounds / caps / exported values ────────────────────────────────────
  {
    assertEq(MAX_REPLAY_REASON_LENGTH, 200, '(H) MAX_REPLAY_REASON_LENGTH');
    assertEq(MAX_REPLAY_TOOL_LABEL_LENGTH, 48, '(H) MAX_REPLAY_TOOL_LABEL_LENGTH');
    assertEq(MAX_REPLAY_SCAN_LENGTH, 200, '(H) MAX_REPLAY_SCAN_LENGTH');
    // a huge tool name is clamped and never bloats the reason
    const dec = d({ sideEffect: 'unsafe_write', disposition: 'timeout', toolName: 'x'.repeat(100000) });
    assert(dec.reason.length <= MAX_REPLAY_REASON_LENGTH, '(H) reason clamped under huge toolName', String(dec.reason.length));
    assert(decisionIsValid(dec), '(H) huge-toolName decision valid');
    // a huge disposition string is clamped before scanning (still classified)
    assertEq(fd('timeout ' + 'z'.repeat(500000)), 'outcome_unknown', '(H) huge disposition still classified');
    // a huge sideEffect string → unknown, no slowdown
    assertEq(se('y'.repeat(500000)), 'unknown', '(H) huge sideEffect string → unknown');
  }

  // ─── (I) determinism: same input twice → deep-equal ─────────────────────────
  {
    const cases: unknown[] = [
      { sideEffect: 'read_only', disposition: 'timeout', toolName: 'gsheets.read' },
      { sideEffect: { mutatesState: true, externalSideEffect: true }, disposition: 'econnrefused', toolName: 'git.run' },
      { sideEffect: { destructiveHint: true }, disposition: 'timeout', freshVerificationAvailable: true, toolName: 'gmail.send' },
      { sideEffect: {}, disposition: 'timeout' },
      { sideEffect: 'idempotent_write', disposition: '409 conflict' },
      { sideEffect: 'unsafe_write', disposition: 'validation', toolName: 'local.run_shell' },
    ];
    for (const c of cases) {
      assertJson(d(c), d(c), `(I) decide deterministic :: ${JSON.stringify(c)}`);
      assertEq(safeBool(c), safeBool(c), `(I) isReplaySafe deterministic :: ${JSON.stringify(c)}`);
    }
    for (const s of ['read_only', { readOnlyHint: true }, { mutatesState: true }, 'garbage', {}] as unknown[]) {
      assertEq(se(s), se(s), `(I) classifyToolSideEffect deterministic :: ${JSON.stringify(s)}`);
    }
    for (const p of ['timeout', '409', 'econnrefused', '', { code: 'ETIMEDOUT' }] as unknown[]) {
      assertEq(fd(p), fd(p), `(I) classifyFailureDisposition deterministic :: ${JSON.stringify(p)}`);
    }
  }

  // ─── (HOSTILE) totality: never throw, never leak, fail-closed ───────────────
  try {
    const hostiles: unknown[] = [null, undefined, 123, NaN, Infinity, -0, true, false, 'x'.repeat(1_000_000), {}, [], 9n, Symbol('s'), () => 1];
    for (const bad of hostiles) {
      assert(totalOn(bad), 'hostile whole-input is total', JSON.stringify(String(bad).slice(0, 16)));
      // a non-object / empty input is uncomputable side-effect + conservative
      // disposition → fail-closed unsafe_replay (never a silent replay_safe).
      const dec = d(bad);
      assert(decisionIsValid(dec), 'hostile whole-input → valid decision');
    }
    // null / non-object inputs specifically fail closed
    assertEq(d(null).safety, 'unsafe_replay', 'hostile null → unsafe_replay (fail-closed)');
    assertEq(d(undefined).safety, 'unsafe_replay', 'hostile undefined → unsafe_replay (fail-closed)');
    assertEq(d(42).safety, 'unsafe_replay', 'hostile number → unsafe_replay (fail-closed)');
    assertEq(safeBool(null), false, 'hostile null → isReplaySafe false');

    // hostile per-field values on each classifier
    const fieldHostiles: unknown[] = [null, undefined, 123, NaN, {}, [], 9n, Symbol('x'), () => 1, true];
    for (const bad of fieldHostiles) {
      assert(CLASSES.includes(se(bad)), 'classifyToolSideEffect total', JSON.stringify(String(bad).slice(0, 12)));
      assert(DISPOS.includes(fd(bad)), 'classifyFailureDisposition total', JSON.stringify(String(bad).slice(0, 12)));
      assert(totalOn({ sideEffect: bad, disposition: bad, toolName: bad, freshVerificationAvailable: bad }), 'all-hostile-fields input is total');
    }
    // hostile field default directions
    assertEq(se(NaN), 'unknown', 'hostile NaN sideEffect → unknown');
    assertEq(fd(NaN), 'outcome_unknown', 'hostile NaN disposition → outcome_unknown (conservative)');
    assertEq(se(Symbol('z')), 'unknown', 'symbol sideEffect → unknown');
    assertEq(fd(() => 1), 'outcome_unknown', 'function disposition → outcome_unknown');

    // throwing-getter fields must not nuke the decision
    const throwing = {} as Record<string, unknown>;
    Object.defineProperty(throwing, 'sideEffect', { get() { throw new Error('se boom'); }, enumerable: true });
    Object.defineProperty(throwing, 'disposition', { get() { throw new Error('dispo boom'); }, enumerable: true });
    Object.defineProperty(throwing, 'toolName', { get() { throw new Error('name boom'); }, enumerable: true });
    Object.defineProperty(throwing, 'freshVerificationAvailable', { get() { throw new Error('flag boom'); }, enumerable: true });
    assert(totalOn(throwing), 'throwing-getter input is total');
    assertEq(d(throwing).safety, 'unsafe_replay', 'throwing-getter input → fail-closed unsafe_replay');

    // a sideEffect object whose hint getters throw → unknown, no throw
    const throwSe = {} as Record<string, unknown>;
    Object.defineProperty(throwSe, 'readOnlyHint', { get() { throw new Error('hint boom'); }, enumerable: true });
    Object.defineProperty(throwSe, 'mutatesState', { get() { throw new Error('hint boom'); }, enumerable: true });
    assertEq(se(throwSe), 'unknown', 'throwing-hint sideEffect → unknown');
    assert(totalOn({ sideEffect: throwSe, disposition: 'timeout' }), 'throwing-hint sideEffect input is total');

    // throwing proxy on any access
    const throwingProxy = new Proxy({}, { get() { throw new Error('proxy boom'); } });
    assertEq(se(throwingProxy), 'unknown', 'throwing-proxy sideEffect → unknown');
    assertEq(fd(throwingProxy), 'outcome_unknown', 'throwing-proxy disposition → outcome_unknown');
    assert(totalOn({ sideEffect: throwingProxy, disposition: throwingProxy, toolName: throwingProxy }), 'throwing-proxy input is total');

    // cyclic objects everywhere
    const cyc: Record<string, unknown> = { mutatesState: true, externalSideEffect: true };
    cyc.self = cyc;
    assertEq(se(cyc), 'unsafe_write', 'cyclic sideEffect still classified');
    const cycInput: Record<string, unknown> = { sideEffect: cyc, disposition: 'timeout', toolName: 'git.run' };
    cycInput.self = cycInput;
    assert(totalOn(cycInput), 'cyclic input is total');
    assertEq(d(cycInput).safety, 'unsafe_replay', 'cyclic unsafe_write + timeout → unsafe_replay');

    // control / fence / line-sep / bidi chars in the toolName are stripped
    const nasty =
      'git`rm`' +
      String.fromCharCode(0) +
      '<x>' +
      String.fromCharCode(0x202e) +
      String.fromCharCode(0x2028) +
      String.fromCharCode(0xfeff) +
      '.run';
    const nastyDec = d({ sideEffect: 'unsafe_write', disposition: 'timeout', toolName: nasty });
    assert(decisionIsValid(nastyDec), 'control/fence toolName → valid decision');
    assert(!hasUnsafeChars(nastyDec.reason), 'no control/fence/bidi/backtick chars survive in the reason', nastyDec.reason);

    // injected-backtick + huge toolName (smoke-sketch fixture) → bounded, clean
    const injDec = d({ sideEffect: 'unsafe_write', disposition: 'timeout', toolName: '`inj` ' + 'A'.repeat(9999) });
    assertEq(injDec.safety, 'unsafe_replay', 'injected huge toolName → still fail-closed unsafe_replay');
    assert(injDec.reason.length <= MAX_REPLAY_REASON_LENGTH, 'injected huge toolName reason bounded', String(injDec.reason.length));
    assert(injDec.reason.indexOf('`') < 0, 'no backtick survives in the reason');
    assert(!hasUnsafeChars(injDec.reason), 'injected reason is control/fence-free');

    // secret-shaped toolName is redacted, never echoed
    const SK = 'sk-ant-' + 'a'.repeat(48);
    const secretDec = d({ sideEffect: 'unsafe_write', disposition: 'not_sent', toolName: SK });
    assert(decisionIsValid(secretDec), 'secret-shaped toolName → valid decision');
    assert(!JSON.stringify(secretDec).includes('sk-ant'), 'secret-shaped toolName never leaks', secretDec.reason);
    assert(/the tool/i.test(secretDec.reason), 'secret-shaped toolName redacted to "the tool"', secretDec.reason);
    // JWT-shaped toolName redacted
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const jwtDec = d({ sideEffect: 'unsafe_write', disposition: 'not_sent', toolName: JWT });
    assert(!JSON.stringify(jwtDec).includes('eyJ'), 'JWT-shaped toolName never leaks', jwtDec.reason);
    // a secret hidden in the disposition free-text is never echoed (raw error not surfaced)
    const secretDispoDec = d({ sideEffect: 'unsafe_write', disposition: `boom ${SK} timeout`, toolName: 'git.run' });
    assert(!JSON.stringify(secretDispoDec).includes('sk-ant'), 'secret in disposition text never echoed');
    assertEq(secretDispoDec.disposition, 'outcome_unknown', 'secret-bearing timeout text still classified outcome_unknown');

    // arrays / weird holders as whole input
    for (const weird of [[1, 2, 3], new Map(), new Set(), new Date(0)] as unknown[]) {
      assert(totalOn(weird), 'weird holder input is total', Object.prototype.toString.call(weird));
    }

    // a large battery of mixed valid+hostile inputs all obey the invariants
    const mixed: unknown[] = [
      { sideEffect: 'read_only', disposition: 'timeout' },
      { sideEffect: 'unsafe_write', disposition: 'not_sent' },
      { sideEffect: { idempotentHint: true }, disposition: '502' },
      { sideEffect: { mutatesState: true }, disposition: 'validation' },
      { sideEffect: null, disposition: null, toolName: null },
      { sideEffect: 42, disposition: 42, toolName: 42 },
      'not-even-an-object',
      { sideEffect: { readOnlyHint: 'truthy-but-not-true' }, disposition: 'timeout' }, // hint not literal true → unknown → unsafe path
    ];
    for (const m of mixed) {
      assert(totalOn(m), 'mixed battery input total', JSON.stringify(m).slice(0, 40));
    }
    // the non-literal-true hint case must NOT be read_only (only literal true counts)
    assertEq(se({ readOnlyHint: 'yes' }), 'unknown', 'non-literal-true readOnlyHint → unknown (not read_only)');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll tool-replay-safety-core smoke cases passed (${passes} passed).`);
}

main();
