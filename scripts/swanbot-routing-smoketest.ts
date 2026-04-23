/**
 * swanbot-routing-smoketest — pure grammar test for the `/v2` slash
 * command + flag state helpers in `src/lib/swanbotRouting.ts`. Runs
 * offline with a localStorage shim.
 *
 * Run: npm run smoke:swanbot-routing
 */

// Minimal localStorage shim so the router can read/write without a DOM.
const store: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem(key: string) { return store[key] ?? null; },
  setItem(key: string, value: string) { store[key] = String(value); },
  removeItem(key: string) { delete store[key]; },
  clear() { for (const k of Object.keys(store)) delete store[k]; },
};

import {
  isSwanbotV2Enabled,
  enableSwanbotV2,
  disableSwanbotV2,
  toggleSwanbotV2,
  parseSwanbotV2Command,
  applySwanbotV2Command,
} from '../src/lib/swanbotRouting';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Default state ────────────────────────────────────────────────────
store[''] = '';  // ensure shim is alive
(globalThis as any).localStorage.removeItem('uc_swanbot_v2_enabled');
assert(isSwanbotV2Enabled() === false, 'default: v2 disabled');

// ─── Flip on / off / toggle ──────────────────────────────────────────
enableSwanbotV2();
assert(isSwanbotV2Enabled() === true, 'enable: sets flag true');
disableSwanbotV2();
assert(isSwanbotV2Enabled() === false, 'disable: sets flag false');
toggleSwanbotV2();
assert(isSwanbotV2Enabled() === true, 'toggle: off → on');
toggleSwanbotV2();
assert(isSwanbotV2Enabled() === false, 'toggle: on → off');

// ─── Non-string values in storage ────────────────────────────────────
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'nonsense');
assert(isSwanbotV2Enabled() === false, 'read: non-"true" treated as false');
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'TRUE');
assert(isSwanbotV2Enabled() === false, 'read: case-sensitive — TRUE rejected');
(globalThis as any).localStorage.setItem('uc_swanbot_v2_enabled', 'true');
assert(isSwanbotV2Enabled() === true, 'read: "true" accepted');

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
}
{
  const r = applySwanbotV2Command('disable');
  assert(r.enabled === false, 'apply disable: flag now false');
  assert(r.message.includes('disabled'), 'apply disable: message says disabled');
}
{
  const r = applySwanbotV2Command('toggle');
  assert(r.enabled === true, 'apply toggle: false → true');
}
{
  const r = applySwanbotV2Command('status');
  assert(r.message.includes('ENABLED'), 'apply status: mirrors current state');
}

if (failures > 0) {
  console.error(`\n${failures} swanbot-routing smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll swanbot-routing smoke cases passed.');
