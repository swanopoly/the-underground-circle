import assert from 'node:assert/strict';
import {
  createNativeSecureAuthStorage,
  secureAuthStorageKey,
  type AuthKeyValueStorage,
} from '../src/lib/authStorage';

class MemoryStorage implements AuthKeyValueStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    this.values.delete(key);
  }
}

class MemorySecureStore {
  readonly values = new Map<string, string>();

  constructor(private readonly available = true) {}

  async isAvailableAsync() {
    return this.available;
  }

  async getItemAsync(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string) {
    this.values.set(key, value);
  }

  async deleteItemAsync(key: string) {
    this.values.delete(key);
  }
}

class FailingDeleteSecureStore extends MemorySecureStore {
  override async deleteItemAsync(key: string) {
    if (key.endsWith('_0')) throw new Error('simulated keychain failure');
    await super.deleteItemAsync(key);
  }
}

class FailingAvailabilitySecureStore extends MemorySecureStore {
  override async isAvailableAsync(): Promise<boolean> {
    throw new Error('simulated secure-store probe failure');
  }
}

async function main() {
  const authKey = 'sb-project-ref-auth-token';
  const secureKey = secureAuthStorageKey(authKey);
  assert.match(secureKey, /^[A-Za-z0-9._-]+$/,
    'SecureStore key uses only supported characters');

  const legacy = new MemoryStorage();
  const secure = new MemorySecureStore();
  const authStorage = createNativeSecureAuthStorage({
    legacyStorage: legacy,
    loadSecureStore: async () => secure,
  });

  const longSession = JSON.stringify({
    access_token: 'a'.repeat(2_400),
    refresh_token: 'r'.repeat(2_400),
  });
  await authStorage.setItem(authKey, longSession);
  assert.equal(legacy.values.has(authKey), false,
    'secure devices do not retain plaintext AsyncStorage sessions');
  assert.equal(await authStorage.getItem(authKey), longSession,
    'chunked sessions round-trip');

  const unicodeSession = JSON.stringify({
    user_metadata: { display_name: '🦊'.repeat(1_200) },
  });
  await authStorage.setItem(authKey, unicodeSession);
  assert.equal(await authStorage.getItem(authKey), unicodeSession,
    'multibyte session data round-trips');
  for (const [key, value] of secure.values) {
    if (key.startsWith(`${secureKey}_`)) {
      assert.ok(Buffer.byteLength(value, 'utf8') <= 1_800,
        'every SecureStore chunk stays under its byte cap');
    }
  }

  await authStorage.setItem(authKey, 'short-session');
  assert.equal(await authStorage.getItem(authKey), 'short-session',
    'session replacement round-trips');
  assert.equal(secure.values.has(`${secureKey}_1`), false,
    'short replacements remove stale secure chunks');

  await authStorage.removeItem(authKey);
  assert.equal(await authStorage.getItem(authKey), null,
    'logout removes the secure auth session');
  assert.equal(
    Array.from(secure.values.keys()).some((key) => key.startsWith(secureKey)),
    false,
    'logout removes the manifest and every bounded chunk',
  );

  const migrationLegacy = new MemoryStorage();
  const migrationSecure = new MemorySecureStore();
  await migrationLegacy.setItem(authKey, 'legacy-session');
  const migrationStorage = createNativeSecureAuthStorage({
    legacyStorage: migrationLegacy,
    loadSecureStore: async () => migrationSecure,
  });
  assert.equal(await migrationStorage.getItem(authKey), 'legacy-session',
    'legacy sessions remain usable during secure migration');
  assert.equal(await migrationLegacy.getItem(authKey), null,
    'legacy plaintext is deleted only after secure migration succeeds');

  const unavailableLegacy = new MemoryStorage();
  const unavailableStorage = createNativeSecureAuthStorage({
    legacyStorage: unavailableLegacy,
    loadSecureStore: async () => new MemorySecureStore(false),
  });
  await unavailableStorage.setItem(authKey, 'memory-only-session');
  assert.equal(await unavailableLegacy.getItem(authKey), null,
    'unavailable secure storage never downgrades tokens to plaintext storage');
  assert.equal(await unavailableStorage.getItem(authKey), 'memory-only-session',
    'unavailable secure storage keeps the session in process memory only');
  const restartedUnavailableStorage = createNativeSecureAuthStorage({
    legacyStorage: unavailableLegacy,
    loadSecureStore: async () => new MemorySecureStore(false),
  });
  assert.equal(await restartedUnavailableStorage.getItem(authKey), null,
    'memory-only fallback does not persist across process restarts');

  const probeFailureLegacy = new MemoryStorage();
  const probeFailureStorage = createNativeSecureAuthStorage({
    legacyStorage: probeFailureLegacy,
    loadSecureStore: async () => new FailingAvailabilitySecureStore(),
  });
  await assert.rejects(
    () => probeFailureStorage.setItem(authKey, 'must-stay-secure'),
    'SecureStore probe failures fail closed',
  );
  assert.equal(await probeFailureLegacy.getItem(authKey), null,
    'failed probes leave no plaintext token behind');

  const failingSecure = new FailingDeleteSecureStore();
  const failingStorage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => failingSecure,
  });
  await failingStorage.setItem(authKey, 'must-not-silently-survive');
  await assert.rejects(
    () => failingStorage.removeItem(authKey),
    'partial keychain deletion is surfaced',
  );

  const corruptLegacy = new MemoryStorage();
  const corruptSecure = new MemorySecureStore();
  await corruptLegacy.setItem(authKey, 'stale-plaintext-session');
  corruptSecure.values.set(secureKey, 'malformed-manifest');
  const corruptStorage = createNativeSecureAuthStorage({
    legacyStorage: corruptLegacy,
    loadSecureStore: async () => corruptSecure,
  });
  assert.equal(await corruptStorage.getItem(authKey), null,
    'malformed secure records do not resurrect plaintext sessions');

  console.log('auth storage security smoke passed');
}

void main();
