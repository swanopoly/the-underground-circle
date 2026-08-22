import assert from 'node:assert/strict';
import {
  WEB_MODULE_GRAPH_REVISION,
  WEB_MODULE_RECOVERY_COOLDOWN_MS,
  buildWebModuleRecoveryStorageKey,
  isWebModuleLoadFailure,
  planWebModuleRecovery,
} from '../src/lib/webModuleRecoveryCore';

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert.ok(condition, message);
}

const staleChatError = Object.assign(
  new Error(
    'Loading module https://app.chrisswanson.xyz/_expo/static/js/web/ChatTab-9cf10eddbd33fd31dddfbb832858681b.js failed.',
  ),
  { name: 'AsyncRequireError' },
);

const positiveCases: unknown[] = [
  staleChatError,
  new Error('Failed to fetch dynamically imported module: https://example.test/chunk.js'),
  new Error('Importing a module script failed.'),
  new Error('ChunkLoadError: Loading chunk 42 failed.'),
  new Error('Expected a JavaScript-or-Wasm module script but the server responded with text/html.'),
  { name: 'AsyncRequireError', message: 'Loading module https://example.test/OfficeTab-a1.js failed.' },
];

for (const candidate of positiveCases) {
  check(isWebModuleLoadFailure(candidate), `module load failure is recognized: ${String(candidate)}`);
}

const negativeCases: unknown[] = [
  new TypeError('Failed to fetch'),
  new Error('net::ERR_INTERNET_DISCONNECTED'),
  new Error('Supabase request failed with 502'),
  new Error('provider_billing_unavailable'),
  new Error('Loading profile failed'),
  null,
];

for (const candidate of negativeCases) {
  check(!isWebModuleLoadFailure(candidate), `ordinary runtime/network failure is not reload-classified: ${String(candidate)}`);
}

const firstKey = buildWebModuleRecoveryStorageKey(staleChatError);
const sameKey = buildWebModuleRecoveryStorageKey(staleChatError);
const otherKey = buildWebModuleRecoveryStorageKey(
  Object.assign(new Error('Loading module https://example.test/OfficeTab-b2.js failed.'), { name: 'AsyncRequireError' }),
);
check(typeof firstKey === 'string' && firstKey.includes(WEB_MODULE_GRAPH_REVISION), 'recovery key is revision scoped');
check(firstKey === sameKey, 'same failed module receives a stable recovery key');
check(firstKey !== otherKey, 'different failed module receives an independent recovery key');
check(buildWebModuleRecoveryStorageKey(new TypeError('Failed to fetch')) === null, 'unrelated fetch failure has no recovery key');

const nowMs = 1_000_000;
check(
  planWebModuleRecovery({ error: staleChatError, online: true, nowMs }).action === 'reload_once',
  'first online module failure receives one automatic reload',
);
check(
  planWebModuleRecovery({ error: staleChatError, online: false, nowMs }).action === 'wait_for_online',
  'offline module failure waits for network recovery',
);
check(
  planWebModuleRecovery({
    error: staleChatError,
    online: true,
    nowMs,
    previousAttemptAtMs: nowMs - 1,
  }).action === 'show_manual_reload',
  'recent automatic attempt cannot enter a reload loop',
);
check(
  planWebModuleRecovery({
    error: staleChatError,
    online: true,
    nowMs,
    previousAttemptAtMs: nowMs - WEB_MODULE_RECOVERY_COOLDOWN_MS,
  }).action === 'reload_once',
  'expired recovery cooldown permits a later bounded attempt',
);
check(
  planWebModuleRecovery({
    error: new TypeError('Failed to fetch'),
    online: true,
    nowMs,
  }).action === 'none',
  'ordinary data fetch failure never reloads the app',
);

console.log(`web-module-recovery-core-smoketest: ${assertions} assertions passed`);
