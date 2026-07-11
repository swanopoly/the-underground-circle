/**
 * swanbot-routing-smoketest — pure grammar test for the `/v2` slash
 * command + flag state helpers + session circuit breaker in
 * `src/lib/swanbotRouting.ts`. Runs offline with a localStorage shim.
 *
 * M4 flipped the default: v2 is opt-OUT. Empty/garbage/unavailable
 * storage all mean ENABLED; only an explicit `'false'` routes to v1.
 *
 * Run: npm run smoke:swanbot-routing
 */

// Minimal localStorage shim so the router can read/write without a DOM.
const store: Record<string, string> = {};
const shimLocalStorage = {
  getItem(key: string) { return store[key] ?? null; },
  setItem(key: string, value: string) { store[key] = String(value); },
  removeItem(key: string) { delete store[key]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};
(globalThis as any).localStorage = shimLocalStorage;

import {
  isSwanbotV2Enabled,
  enableSwanbotV2,
  disableSwanbotV2,
  toggleSwanbotV2,
  recordSwanbotV2Outcome,
  isSwanbotV2CircuitOpen,
  resetSwanbotV2Circuit,
  describeSwanbotV2Circuit,
  parseSwanbotV2Command,
  applySwanbotV2Command,
  shouldConsultSolverThisRound,
  v2OutcomeCountsTowardBreaker,
} from '../src/lib/swanbotRouting';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Default state (M4: v2 is opt-out) ───────────────────────────────
(globalThis as any).localStorage.removeItem('uc_swanbot_v2_enabled');
assert(isSwanbotV2Enabled() === true, 'default: v2 ENABLED with empty storage (M4 flip)');

// Explicit opt-out is the only way off v2.
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'false');
assert(isSwanbotV2Enabled() === false, "opt-out: explicit 'false' routes to v1");

// ─── Flip on / off / toggle ──────────────────────────────────────────
enableSwanbotV2();
assert(isSwanbotV2Enabled() === true, 'enable: sets flag true');
disableSwanbotV2();
assert(isSwanbotV2Enabled() === false, 'disable: sets flag false');
toggleSwanbotV2();
assert(isSwanbotV2Enabled() === true, 'toggle: off → on');
toggleSwanbotV2();
assert(isSwanbotV2Enabled() === false, 'toggle: on → off');
(globalThis as any).localStorage.removeItem('uc_swanbot_v2_enabled');
toggleSwanbotV2();
assert(isSwanbotV2Enabled() === false, 'toggle: default(on) → off');

// ─── Non-'false' values in storage all mean enabled ──────────────────
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'nonsense');
assert(isSwanbotV2Enabled() === true, 'read: garbage value → enabled (opt-out semantics)');
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'TRUE');
assert(isSwanbotV2Enabled() === true, 'read: TRUE → enabled');
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'FALSE');
assert(isSwanbotV2Enabled() === true, "read: case-sensitive — only exact 'false' opts out");
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', '');
assert(isSwanbotV2Enabled() === true, 'read: empty string → enabled');
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'true');
assert(isSwanbotV2Enabled() === true, "read: 'true' → enabled");
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'false');
assert(isSwanbotV2Enabled() === false, "read: 'false' → disabled");

// ─── Storage unavailable / throwing → default ON (native runtimes) ───
(globalThis as any).localStorage = undefined;
assert(isSwanbotV2Enabled() === true, 'no localStorage (native): defaults ON');
(globalThis as any).localStorage = {
  getItem() { throw new Error('storage exploded'); },
  setItem() { throw new Error('storage exploded'); },
  removeItem() {},
  clear() {},
};
assert(isSwanbotV2Enabled() === true, 'throwing localStorage: defaults ON');
enableSwanbotV2();   // setItem throws — must not crash
disableSwanbotV2();  // setItem throws — must not crash
pass('enable/disable survive a throwing localStorage');
(globalThis as any).localStorage = shimLocalStorage;

// ─── Session circuit breaker ─────────────────────────────────────────
resetSwanbotV2Circuit();
assert(isSwanbotV2CircuitOpen() === false, 'breaker: starts closed');
assert(describeSwanbotV2Circuit() === null, 'breaker: no status line while closed');
recordSwanbotV2Outcome(false);
assert(isSwanbotV2CircuitOpen() === false, 'breaker: 1 failure — still closed');
recordSwanbotV2Outcome(false);
assert(isSwanbotV2CircuitOpen() === true, 'breaker: opens after exactly 2 consecutive failures');
{
  const line = describeSwanbotV2Circuit();
  assert(typeof line === 'string' && line.includes('paused this session'), 'breaker: open status line says paused this session');
  assert(typeof line === 'string' && line.includes('/v2 on'), 'breaker: open status line points at /v2 on');
}
recordSwanbotV2Outcome(true);
assert(isSwanbotV2CircuitOpen() === false, 'breaker: success closes an open circuit');
recordSwanbotV2Outcome(false);
recordSwanbotV2Outcome(true);
recordSwanbotV2Outcome(false);
assert(isSwanbotV2CircuitOpen() === false, 'breaker: non-consecutive failures do not open it');
recordSwanbotV2Outcome(false);
assert(isSwanbotV2CircuitOpen() === true, 'breaker: streak re-opens after 2 more consecutive failures');
enableSwanbotV2();
assert(isSwanbotV2CircuitOpen() === false, 'breaker: enableSwanbotV2() (/v2 on) resets the circuit');
recordSwanbotV2Outcome(false);
recordSwanbotV2Outcome(false);
resetSwanbotV2Circuit();
assert(isSwanbotV2CircuitOpen() === false, 'breaker: resetSwanbotV2Circuit() closes it directly');

// ─── parseSwanbotV2Command ───────────────────────────────────────────
assert(parseSwanbotV2Command('')                     === null,                    'parse: empty → null');
assert(parseSwanbotV2Command('hello world')          === null,                    'parse: non-slash → null');
assert(parseSwanbotV2Command('/memory-bank')         === null,                    'parse: other slash → null');
assert(JSON.stringify(parseSwanbotV2Command('/v2'))        === JSON.stringify({ action: 'status' }),  'parse: bare → status');
assert(JSON.stringify(parseSwanbotV2Command('/v2 on'))     === JSON.stringify({ action: 'enable' }),  'parse: on → enable');
assert(JSON.stringify(parseSwanbotV2Command('/v2 enable')) === JSON.stringify({ action: 'enable' }),  'parse: enable alias');
assert(JSON.stringify(parseSwanbotV2Command('/v2 off'))    === JSON.stringify({ action: 'disable' }), 'parse: off → disable');
assert(JSON.stringify(parseSwanbotV2Command('/v2 disable'))=== JSON.stringify({ action: 'disable' }), 'parse: disable alias');
assert(JSON.stringify(parseSwanbotV2Command('/v2 toggle')) === JSON.stringify({ action: 'toggle' }),  'parse: toggle');
assert(JSON.stringify(parseSwanbotV2Command('/v2 wat'))    === JSON.stringify({ action: 'status' }),  'parse: unknown arg → status');
assert(JSON.stringify(parseSwanbotV2Command('/V2 ON'))     === JSON.stringify({ action: 'enable' }),  'parse: case-insensitive');

// ─── applySwanbotV2Command — returns message + new state ─────────────
store['uc_swanbot_v2_enabled'] = 'false';
{
  const r = applySwanbotV2Command('enable');
  assert(r.enabled === true, 'apply enable: flag now true');
  assert(r.message.includes('ENABLED'), 'apply enable: message says ENABLED');
  assert(r.message.includes('typed loop (default)'), 'apply enable: message says v2 typed loop is the default');
  assert(r.message.includes('/v2 off'), 'apply enable: message offers /v2 off for the legacy loop');
}
{
  const r = applySwanbotV2Command('disable');
  assert(r.enabled === false, 'apply disable: flag now false');
  assert(r.message.includes('disabled'), 'apply disable: message says disabled');
  assert(r.message.includes('legacy'), 'apply disable: message says legacy loop');
  assert(r.message.includes('/v2 on'), 'apply disable: message offers /v2 on to return to default');
}
{
  const r = applySwanbotV2Command('toggle');
  assert(r.enabled === true, 'apply toggle: false → true');
}
{
  const r = applySwanbotV2Command('status');
  assert(r.message.includes('ENABLED'), 'apply status: mirrors current state');
  assert(!r.message.includes('paused this session'), 'apply status: no circuit note while breaker closed');
}

// ─── applySwanbotV2Command — surfaces + clears the circuit note ──────
recordSwanbotV2Outcome(false);
recordSwanbotV2Outcome(false);
{
  const r = applySwanbotV2Command('status');
  assert(r.message.includes('paused this session'), 'apply status: shows circuit-open note while paused');
}
{
  const r = applySwanbotV2Command('enable');
  assert(isSwanbotV2CircuitOpen() === false, 'apply enable: resets the circuit breaker');
  assert(!r.message.includes('paused this session'), 'apply enable: circuit note cleared after reset');
}

// ─── #6: shouldConsultSolverThisRound (final-round consult gate) ──────
// Parity primitive for the legacy relay loop + browser edge: consult only
// when stuck, not-yet-consulted, AND a next round exists to answer it.
assert(shouldConsultSolverThisRound({ stuck: true, alreadyConsulted: false, roundsRemaining: 1 }) === true,
  'consult-gate: stuck + fresh + a round remains → consult');
assert(shouldConsultSolverThisRound({ stuck: true, alreadyConsulted: false, roundsRemaining: 3 }) === true,
  'consult-gate: several rounds remaining → consult');
assert(shouldConsultSolverThisRound({ stuck: true, alreadyConsulted: false, roundsRemaining: 0 }) === false,
  'consult-gate: FINAL round (0 remaining) → skip consult, go straight to the honest stop (#6)');
assert(shouldConsultSolverThisRound({ stuck: true, alreadyConsulted: false, roundsRemaining: -1 }) === false,
  'consult-gate: negative remaining (defensive) → no consult');
assert(shouldConsultSolverThisRound({ stuck: true, alreadyConsulted: true, roundsRemaining: 2 }) === false,
  'consult-gate: already spent → no consult even with rounds left (once per run)');
assert(shouldConsultSolverThisRound({ stuck: false, alreadyConsulted: false, roundsRemaining: 2 }) === false,
  'consult-gate: not stuck → no consult');

// ─── #12: v2OutcomeCountsTowardBreaker (body vs transport) ────────────
// The breaker counts TRANSPORT failures only. A 200-with-error-body
// (config/permanent, e.g. model_unsupported_on_v2 / key_missing) must NOT
// count — else one config error trips the breaker + disables v2 all session.
assert(v2OutcomeCountsTowardBreaker({ kind: 'transport_failure' }) === true,
  'breaker-class: transport failure counts toward the breaker');
assert(v2OutcomeCountsTowardBreaker({ kind: 'success' }) === true,
  'breaker-class: success counts (it resets the streak)');
assert(v2OutcomeCountsTowardBreaker({ kind: 'body_error' }) === false,
  'breaker-class: a 200-with-error-body (config) is NOT counted (#12)');
{
  // End-to-end breaker behavior: two consecutive BODY errors must leave the
  // breaker CLOSED (they are surfaced, not counted), where two transport
  // failures would have opened it. This is the exact regression #12 fixes.
  resetSwanbotV2Circuit();
  const record = (o: Parameters<typeof v2OutcomeCountsTowardBreaker>[0]) => {
    if (v2OutcomeCountsTowardBreaker(o)) recordSwanbotV2Outcome(o.kind === 'success');
  };
  record({ kind: 'body_error' });
  record({ kind: 'body_error' });
  assert(isSwanbotV2CircuitOpen() === false, 'breaker-class: 2 consecutive body errors do NOT open the breaker (#12)');
  record({ kind: 'transport_failure' });
  record({ kind: 'transport_failure' });
  assert(isSwanbotV2CircuitOpen() === true, 'breaker-class: 2 consecutive TRANSPORT failures still open it');
  // A body error in the middle of a transport streak neither counts nor
  // resets — the transport streak stays intact around it.
  resetSwanbotV2Circuit();
  record({ kind: 'transport_failure' });
  record({ kind: 'body_error' });   // ignored — must not reset the streak
  record({ kind: 'transport_failure' });
  assert(isSwanbotV2CircuitOpen() === true, 'breaker-class: an ignored body error does not reset a transport streak');
  resetSwanbotV2Circuit();
}

if (failures > 0) {
  console.error(`\n${failures} swanbot-routing smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll swanbot-routing smoke cases passed.');
