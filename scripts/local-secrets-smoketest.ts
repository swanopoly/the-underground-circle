import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type SecureStoreOperation = 'get' | 'set' | 'delete';

interface SecureStoreCall {
  operation: SecureStoreOperation;
  key: string;
}

interface LocalSecretsSmokeState {
  platform: { OS: string };
  values: Map<string, string>;
  calls: SecureStoreCall[];
  failNext: { operation: SecureStoreOperation; key: string } | null;
}

const smokeState: LocalSecretsSmokeState = {
  platform: { OS: 'ios' },
  values: new Map(),
  calls: [],
  failNext: null,
};

function beforeSecureStoreCall(operation: SecureStoreOperation, key: string): void {
  smokeState.calls.push({ operation, key });
  if (!/^[A-Za-z0-9._-]+$/.test(key)) throw new Error('invalid SecureStore key');
  if (smokeState.failNext?.operation === operation && smokeState.failNext.key === key) {
    smokeState.failNext = null;
    throw new Error('simulated SecureStore failure');
  }
}

const secureStoreStub = {
  async getItemAsync(key: string) {
    beforeSecureStoreCall('get', key);
    return smokeState.values.get(key) ?? null;
  },
  async setItemAsync(key: string, value: string) {
    beforeSecureStoreCall('set', key);
    smokeState.values.set(key, value);
  },
  async deleteItemAsync(key: string) {
    beforeSecureStoreCall('delete', key);
    smokeState.values.delete(key);
  },
};

type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
const Module = require('node:module') as { _load: ModuleLoader };
const originalLoad = Module._load;
Module._load = function patchedLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
): unknown {
  if (request === 'react-native') return { Platform: smokeState.platform };
  return originalLoad.call(this, request, parent, isMain);
};

class MemoryLocalStorage {
  readonly values = new Map<string, string>();

  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

async function main() {
  const {
    __localSecretsTestables,
    deleteLocalSecret,
    nativeLocalSecretStorageKey,
    readLocalSecret,
    writeLocalSecret,
  } = require('../src/lib/localSecrets') as typeof import('../src/lib/localSecrets');
  const { readNativeLocalSecret, writeNativeLocalSecret } = __localSecretsTestables;

  const collisionCases: Array<readonly [string, string]> = [
    ['a:b', 'c'],
    ['a', 'b:c'],
    ['a.b', 'c'],
    ['a', 'b.c'],
    ['a_b', 'c'],
    ['a', 'b_c'],
    ['emoji-🦊', 'id'],
    ['emoji', '🦊-id'],
    ['\ud800', 'lone-surrogate'],
    ['�', 'lone-surrogate'],
    ['', 'empty-namespace'],
    ['empty-id', ''],
  ];
  const collisionKeys = collisionCases.map(([namespace, id]) =>
    nativeLocalSecretStorageKey(namespace, id));
  assert.equal(new Set(collisionKeys).size, collisionKeys.length,
    'distinct namespace/id pairs cannot collide after native key normalization');
  for (const key of collisionKeys) {
    assert.match(key, /^[A-Za-z0-9._-]+$/,
      'every normalized key uses only the Expo SecureStore 15 alphabet');
  }
  assert.equal(
    nativeLocalSecretStorageKey('github_pat', 'circle:one'),
    'uc.local-secret.v1.github_005f_pat.circle_003a_one',
    'normalization is deterministic and reversible instead of lossy replacement',
  );

  const namespace = 'github_pat';
  const id = 'circle:one';
  const nativeKey = nativeLocalSecretStorageKey(namespace, id);
  const historicalKey = '@local_secret:github_pat:circle:one';

  await writeNativeLocalSecret(secureStoreStub, namespace, id, 'native-secret');
  assert.equal(smokeState.values.get(nativeKey), 'native-secret',
    'native write uses the normalized SecureStore key');
  assert.equal(await readNativeLocalSecret(secureStoreStub, namespace, id), 'native-secret',
    'native secret round-trips');
  assert.equal(smokeState.calls.some((call) => call.key === historicalKey), false,
    'unreadable historical keys are never passed to SecureStore 15');

  const firstCollisionPair = collisionCases[0];
  const secondCollisionPair = collisionCases[1];
  assert.ok(firstCollisionPair && secondCollisionPair, 'collision fixtures are present');
  await writeNativeLocalSecret(secureStoreStub, firstCollisionPair[0], firstCollisionPair[1], 'first-secret');
  await writeNativeLocalSecret(secureStoreStub, secondCollisionPair[0], secondCollisionPair[1], 'second-secret');
  assert.equal(await readNativeLocalSecret(secureStoreStub, firstCollisionPair[0], firstCollisionPair[1]), 'first-secret');
  assert.equal(await readNativeLocalSecret(secureStoreStub, secondCollisionPair[0], secondCollisionPair[1]), 'second-secret');

  const browserStorage = new MemoryLocalStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: browserStorage,
  });
  browserStorage.setItem(historicalKey, 'web-only-secret');

  smokeState.failNext = { operation: 'get', key: nativeKey };
  assert.equal(await readNativeLocalSecret(secureStoreStub, namespace, id), '',
    'native read failure returns no secret and does not downgrade to web storage');
  assert.equal(browserStorage.getItem(historicalKey), 'web-only-secret',
    'native failure leaves the separate web store untouched');

  smokeState.values.delete(nativeKey);
  smokeState.failNext = { operation: 'set', key: nativeKey };
  await writeNativeLocalSecret(secureStoreStub, namespace, id, 'must-not-downgrade');
  assert.equal(smokeState.values.has(nativeKey), false,
    'native write failure does not fabricate a successful secure write');
  assert.equal(browserStorage.getItem(historicalKey), 'web-only-secret',
    'native write failure never falls back to localStorage');

  smokeState.values.set(nativeKey, 'must-survive-failed-delete');
  smokeState.failNext = { operation: 'delete', key: nativeKey };
  await writeNativeLocalSecret(secureStoreStub, namespace, id, '');
  assert.equal(smokeState.values.get(nativeKey), 'must-survive-failed-delete',
    'a failed native delete does not remove or mutate another key');

  await writeNativeLocalSecret(secureStoreStub, namespace, id, '');
  assert.equal(smokeState.values.has(nativeKey), false,
    'native delete removes the normalized key');

  const nativeCallCount = smokeState.calls.length;
  smokeState.platform.OS = 'web';
  assert.equal(await readLocalSecret(namespace, id), 'web-only-secret',
    'web can still read a historical plaintext value for reconnect/migration');
  await writeLocalSecret(namespace, id, 'replacement-web-secret');
  assert.equal(browserStorage.getItem(historicalKey), null,
    'web encryption unavailability fails closed instead of storing plaintext');
  assert.equal(await readLocalSecret(namespace, id), '',
    'a failed secure web write leaves no reusable plaintext credential');
  await deleteLocalSecret(namespace, id);
  assert.equal(browserStorage.getItem(historicalKey), null,
    'web delete retains the historical localStorage key behavior');
  assert.equal(smokeState.calls.length, nativeCallCount,
    'web operations never call SecureStore');

  assert.ok(smokeState.calls.length > 0, 'native SecureStore paths were exercised');
  for (const call of smokeState.calls) {
    assert.match(call.key, /^[A-Za-z0-9._-]+$/,
      `${call.operation} passed a valid SecureStore key`);
  }

  console.log('local secrets native key normalization security smoke passed');
}

void main().finally(() => {
  Module._load = originalLoad;
});
