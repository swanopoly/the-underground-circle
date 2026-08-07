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

class UnscrubbableSecureStore extends MemorySecureStore {
  private cleanupFailureEnabled = false;

  enableCleanupFailure() {
    this.cleanupFailureEnabled = true;
  }

  override async deleteItemAsync(key: string) {
    if (this.cleanupFailureEnabled && key.endsWith('_0_0')) {
      throw new Error('simulated keychain delete failure');
    }
    await super.deleteItemAsync(key);
  }

  override async setItemAsync(key: string, value: string) {
    if (this.cleanupFailureEnabled && key.endsWith('_0_0') && value === '') {
      throw new Error('simulated keychain scrub failure');
    }
    await super.setItemAsync(key, value);
  }
}

class FailingAvailabilitySecureStore extends MemorySecureStore {
  override async isAvailableAsync(): Promise<boolean> {
    throw new Error('simulated secure-store probe failure');
  }
}

class FaultInjectingSecureStore extends MemorySecureStore {
  private failedSetKey: string | null = null;

  failNextSet(key: string) {
    this.failedSetKey = key;
  }

  override async setItemAsync(key: string, value: string) {
    if (key === this.failedSetKey) {
      this.failedSetKey = null;
      throw new Error(`simulated write failure for ${key}`);
    }
    await super.setItemAsync(key, value);
  }
}

class FaultInjectingDeleteSecureStore extends FaultInjectingSecureStore {
  private failedDeletePrefix: string | null = null;

  failDeletesStartingWith(prefix: string | null) {
    this.failedDeletePrefix = prefix;
  }

  override async deleteItemAsync(key: string) {
    if (this.failedDeletePrefix && key.startsWith(this.failedDeletePrefix)) {
      throw new Error(`simulated delete failure for ${key}`);
    }
    await super.deleteItemAsync(key);
  }
}

class ThrowingReadSecureStore extends MemorySecureStore {
  private failedReadKey: string | null = null;

  failReadsFor(key: string) {
    this.failedReadKey = key;
  }

  override async getItemAsync(key: string) {
    if (key === this.failedReadKey) throw new Error(`simulated read failure for ${key}`);
    return super.getItemAsync(key);
  }
}

class BlockingSecureStore extends MemorySecureStore {
  private blockedSetKey: string | null = null;
  private releaseBlockedSet: (() => void) | null = null;
  private markBlockedSetEntered: (() => void) | null = null;
  blockedSetEntered: Promise<void> = Promise.resolve();

  blockNextSet(key: string) {
    this.blockedSetKey = key;
    this.blockedSetEntered = new Promise((resolve) => {
      this.markBlockedSetEntered = resolve;
    });
  }

  release() {
    this.releaseBlockedSet?.();
  }

  override async setItemAsync(key: string, value: string) {
    if (key === this.blockedSetKey) {
      this.blockedSetKey = null;
      const waitForRelease = new Promise<void>((resolve) => {
        this.releaseBlockedSet = resolve;
      });
      this.markBlockedSetEntered?.();
      await waitForRelease;
      this.releaseBlockedSet = null;
      this.markBlockedSetEntered = null;
    }
    await super.setItemAsync(key, value);
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
  assert.equal(secure.values.get(secureKey), 'uc-auth-v2:0:3',
    'the first session is committed through slot zero');
  assert.equal(await authStorage.getItem(authKey), longSession,
    'chunked sessions round-trip');

  const unicodeSession = JSON.stringify({
    user_metadata: { display_name: '🦊'.repeat(1_200) },
  });
  await authStorage.setItem(authKey, unicodeSession);
  assert.match(secure.values.get(secureKey) ?? '', /^uc-auth-v2:1:/,
    'replacement commits by switching to the inactive slot');
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
  assert.equal(
    Array.from(secure.values.keys()).some((key) => key.startsWith(`${secureKey}_1_`)),
    false,
    'short replacements remove chunks from the previously active slot',
  );
  await legacy.setItem(authKey, 'stale-plaintext-after-secure-commit');
  assert.equal(await authStorage.getItem(authKey), 'short-session',
    'a valid secure manifest remains authoritative over stale plaintext');
  assert.equal(await legacy.getItem(authKey), null,
    'every valid secure read retries stale plaintext cleanup');

  const oldSession = 'A'.repeat(5_000);
  const newSession = 'B'.repeat(5_000);
  for (const failedChunk of [0, 1, 2]) {
    const faultSecure = new FaultInjectingSecureStore();
    const faultStorage = createNativeSecureAuthStorage({
      legacyStorage: new MemoryStorage(),
      loadSecureStore: async () => faultSecure,
    });
    await faultStorage.setItem(authKey, oldSession);
    faultSecure.failNextSet(`${secureKey}_1_${failedChunk}`);
    await assert.rejects(() => faultStorage.setItem(authKey, newSession),
      `replacement rejects when chunk ${failedChunk} fails`);
    assert.equal(await faultStorage.getItem(authKey), oldSession,
      `chunk ${failedChunk} failure preserves the exact old session`);
    assert.equal(faultSecure.values.get(secureKey), 'uc-auth-v2:0:3',
      `chunk ${failedChunk} failure does not switch authority slots`);
  }

  const manifestFaultSecure = new FaultInjectingSecureStore();
  const manifestFaultStorage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => manifestFaultSecure,
  });
  await manifestFaultStorage.setItem(authKey, oldSession);
  manifestFaultSecure.failNextSet(secureKey);
  await assert.rejects(() => manifestFaultStorage.setItem(authKey, newSession),
    'replacement rejects when the authority manifest write fails');
  assert.equal(await manifestFaultStorage.getItem(authKey), oldSession,
    'manifest failure preserves the exact old session');
  assert.equal(
    Array.from(manifestFaultSecure.values.keys())
      .some((key) => key.startsWith(`${secureKey}_1_`)),
    false,
    'failed replacement chunks are cleaned from the inactive slot',
  );

  const candidateCleanupSecure = new FaultInjectingDeleteSecureStore();
  const candidateCleanupStorage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => candidateCleanupSecure,
  });
  await candidateCleanupStorage.setItem(authKey, oldSession);
  candidateCleanupSecure.failDeletesStartingWith(`${secureKey}_1_`);
  candidateCleanupSecure.failNextSet(secureKey);
  await assert.rejects(() => candidateCleanupStorage.setItem(authKey, newSession),
    'manifest failure still surfaces when candidate deletion needs zeroing');
  for (const [key, value] of candidateCleanupSecure.values) {
    if (key.startsWith(`${secureKey}_1_`)) {
      assert.equal(value, '', 'aborted candidate chunks are zeroed when deletion fails');
    }
  }
  await candidateCleanupStorage.setItem(authKey, 'C');
  assert.equal(await candidateCleanupStorage.getItem(authKey), 'C',
    'a shorter retry remains complete after an aborted candidate was scrubbed');
  assert.equal(
    Array.from(candidateCleanupSecure.values.values()).some((value) => value.includes('B')),
    false,
    'no credential tail from the aborted replacement survives a shorter retry',
  );

  const blockingSecure = new BlockingSecureStore();
  const blockingStorage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => blockingSecure,
  });
  await blockingStorage.setItem(authKey, oldSession);
  blockingSecure.blockNextSet(`${secureKey}_1_0`);
  const refreshPromise = blockingStorage.setItem(authKey, newSession);
  await blockingSecure.blockedSetEntered;
  const readDuringRefresh = blockingStorage.getItem(authKey);
  const logoutDuringRefresh = blockingStorage.removeItem(authKey);
  await assert.rejects(() => blockingStorage.setItem(authKey, 'racing-session'),
    'a write invoked while logout cleanup is pending is rejected');
  blockingSecure.release();
  await refreshPromise;
  assert.equal(await readDuringRefresh, newSession,
    'reads serialize behind refreshes and return one complete session');
  await logoutDuringRefresh;
  assert.equal(await blockingStorage.getItem(authKey), null,
    'logout queued behind a refresh wins and leaves no session authority');
  await blockingStorage.setItem(authKey, 'new-login-session');
  assert.equal(await blockingStorage.getItem(authKey), 'new-login-session',
    'a new login can persist after logout cleanup has completed');

  const sharedSecure = new BlockingSecureStore();
  const sharedLegacy = new MemoryStorage();
  const firstAdapter = createNativeSecureAuthStorage({
    legacyStorage: sharedLegacy,
    loadSecureStore: async () => sharedSecure,
  });
  const secondAdapter = createNativeSecureAuthStorage({
    legacyStorage: sharedLegacy,
    loadSecureStore: async () => sharedSecure,
  });
  await firstAdapter.setItem(authKey, oldSession);
  sharedSecure.blockNextSet(`${secureKey}_1_0`);
  const firstReplacement = firstAdapter.setItem(authKey, newSession);
  await sharedSecure.blockedSetEntered;
  const finalSession = 'C'.repeat(5_000);
  const secondReplacement = secondAdapter.setItem(authKey, finalSession);
  sharedSecure.release();
  await Promise.all([firstReplacement, secondReplacement]);
  assert.equal(await firstAdapter.getItem(authKey), finalSession,
    'separate adapters serialize replacements through the process-wide queue');

  const staleCleanupSecure = new FailingDeleteSecureStore();
  const staleCleanupStorage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => staleCleanupSecure,
  });
  await staleCleanupStorage.setItem(authKey, oldSession);
  await staleCleanupStorage.setItem(authKey, newSession);
  assert.equal(await staleCleanupStorage.getItem(authKey), newSession,
    'a replacement remains readable when an obsolete chunk cannot be deleted');
  assert.equal(staleCleanupSecure.values.get(`${secureKey}_0_0`), '',
    'an undeletable obsolete chunk is zeroed instead of retaining a credential');

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

  const v1Secure = new MemorySecureStore();
  v1Secure.values.set(secureKey, 'uc-auth-v1:2');
  v1Secure.values.set(`${secureKey}_0`, 'legacy-');
  v1Secure.values.set(`${secureKey}_1`, 'secure-session');
  const v1Storage = createNativeSecureAuthStorage({
    legacyStorage: new MemoryStorage(),
    loadSecureStore: async () => v1Secure,
  });
  assert.equal(await v1Storage.getItem(authKey), 'legacy-secure-session',
    'the prior secure manifest format remains readable');
  await v1Storage.setItem(authKey, 'upgraded-session');
  assert.match(v1Secure.values.get(secureKey) ?? '', /^uc-auth-v2:/,
    'the next write upgrades a v1 secure record to the two-slot format');
  assert.equal(v1Secure.values.has(`${secureKey}_0`), false,
    'v1 chunks are removed after a successful format upgrade');

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
  assert.equal(await restartedUnavailableStorage.getItem(authKey), 'memory-only-session',
    'memory-only fallback is shared by adapters in the same process');
  await restartedUnavailableStorage.removeItem(authKey);
  assert.equal(await unavailableStorage.getItem(authKey), null,
    'logout through one adapter clears every adapter process-wide');

  const probeFailureLegacy = new MemoryStorage();
  const probeFailureStorage = createNativeSecureAuthStorage({
    legacyStorage: probeFailureLegacy,
    loadSecureStore: async () => new FailingAvailabilitySecureStore(),
  });
  await probeFailureLegacy.setItem(authKey, 'legacy-token-before-probe-failure');
  await assert.rejects(
    () => probeFailureStorage.setItem(authKey, 'must-stay-secure'),
    'SecureStore probe failures fail closed',
  );
  assert.equal(await probeFailureLegacy.getItem(authKey), null,
    'failed probes leave no plaintext token behind');

  await probeFailureLegacy.setItem(authKey, 'legacy-token-before-read-probe-failure');
  await assert.rejects(
    () => probeFailureStorage.getItem(authKey),
    'SecureStore acquisition failures fail closed on reads',
  );
  assert.equal(await probeFailureLegacy.getItem(authKey), null,
    'failed read probes also remove stale plaintext authority');

  await probeFailureLegacy.setItem(authKey, 'legacy-token-before-logout');
  await assert.rejects(
    () => probeFailureStorage.removeItem(authKey),
    'logout surfaces a SecureStore probe failure',
  );
  assert.equal(await probeFailureLegacy.getItem(authKey), null,
    'logout still removes plaintext when the SecureStore probe fails');

  const failingLegacy = new MemoryStorage();
  const failingSecure = new UnscrubbableSecureStore();
  const failingStorage = createNativeSecureAuthStorage({
    legacyStorage: failingLegacy,
    loadSecureStore: async () => failingSecure,
  });
  await failingStorage.setItem(authKey, 'must-not-silently-survive');
  await failingLegacy.setItem(authKey, 'stale-plaintext-before-failed-cleanup');
  failingSecure.enableCleanupFailure();
  await assert.rejects(
    () => failingStorage.removeItem(authKey),
    'a keychain record that cannot be deleted or zeroed is surfaced',
  );
  assert.equal(await failingLegacy.getItem(authKey), null,
    'plaintext is still deleted when secure cleanup cannot finish');

  const readFailureLegacy = new MemoryStorage();
  const readFailureSecure = new ThrowingReadSecureStore();
  const readFailureStorage = createNativeSecureAuthStorage({
    legacyStorage: readFailureLegacy,
    loadSecureStore: async () => readFailureSecure,
  });
  await readFailureStorage.setItem(authKey, 'secure-session-before-read-error');
  await readFailureLegacy.setItem(authKey, 'stale-plaintext-before-read-error');
  readFailureSecure.failReadsFor(`${secureKey}_0_0`);
  await assert.rejects(
    () => readFailureStorage.getItem(authKey),
    'a SecureStore read error fails closed',
  );
  assert.equal(await readFailureLegacy.getItem(authKey), null,
    'a valid manifest triggers plaintext cleanup even when chunk reading throws');

  const manifestReadFailureLegacy = new MemoryStorage();
  const manifestReadFailureSecure = new ThrowingReadSecureStore();
  const manifestReadFailureStorage = createNativeSecureAuthStorage({
    legacyStorage: manifestReadFailureLegacy,
    loadSecureStore: async () => manifestReadFailureSecure,
  });
  await manifestReadFailureStorage.setItem(authKey, 'secure-session-before-manifest-error');
  await manifestReadFailureLegacy.setItem(authKey, 'stale-plaintext-before-manifest-error');
  manifestReadFailureSecure.failReadsFor(secureKey);
  await assert.rejects(
    () => manifestReadFailureStorage.getItem(authKey),
    'a SecureStore manifest read error fails closed',
  );
  assert.equal(await manifestReadFailureLegacy.getItem(authKey), null,
    'a manifest read error still removes stale plaintext authority');

  const corruptLegacy = new MemoryStorage();
  const corruptSecure = new MemorySecureStore();
  await corruptLegacy.setItem(authKey, 'stale-plaintext-session');
  corruptSecure.values.set(secureKey, 'uc-auth-v2:0:1:garbage');
  const corruptStorage = createNativeSecureAuthStorage({
    legacyStorage: corruptLegacy,
    loadSecureStore: async () => corruptSecure,
  });
  assert.equal(await corruptStorage.getItem(authKey), null,
    'malformed secure records do not resurrect plaintext sessions');
  assert.equal(await corruptLegacy.getItem(authKey), null,
    'malformed secure records also remove stale plaintext authority');

  const missingLegacy = new MemoryStorage();
  const missingSecure = new MemorySecureStore();
  await missingLegacy.setItem(authKey, 'must-not-be-resurrected');
  missingSecure.values.set(secureKey, 'uc-auth-v2:0:2');
  missingSecure.values.set(`${secureKey}_0_0`, 'partial-session');
  const missingStorage = createNativeSecureAuthStorage({
    legacyStorage: missingLegacy,
    loadSecureStore: async () => missingSecure,
  });
  assert.equal(await missingStorage.getItem(authKey), null,
    'a valid manifest with missing chunks fails closed');
  assert.equal(await missingLegacy.getItem(authKey), null,
    'missing secure chunks never fall back to stale plaintext');
  assert.equal(missingSecure.values.has(secureKey), false,
    'incomplete secure records are removed before a future retry');

  console.log('auth storage security smoke passed');
}

void main();
