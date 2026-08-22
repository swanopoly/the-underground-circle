import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AuthKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

interface SecureStoreLike {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

interface NativeAuthStorageDependencies {
  legacyStorage?: AuthKeyValueStorage;
  loadSecureStore?: () => Promise<SecureStoreLike | null>;
}

const SECURE_MANIFEST_PREFIX = 'uc-auth-v2:';
const LEGACY_SECURE_MANIFEST_PREFIX = 'uc-auth-v1:';
const SECURE_CHUNK_SIZE = 1_800;
const SECURE_MAX_CHUNKS = 64;

type SecureSlot = 0 | 1;

type SecureManifest =
  | { format: 'v2'; slot: SecureSlot; chunkCount: number }
  | { format: 'v1'; chunkCount: number };

interface AuthStorageCoordinationState {
  operationTails: Map<string, Promise<void>>;
  pendingRemovals: Map<string, number>;
  volatileFallback: Map<string, string>;
}

const AUTH_STORAGE_COORDINATION_KEY = '__UC_AUTH_STORAGE_COORDINATION_V2__' as const;
type AuthStorageGlobal = typeof globalThis & {
  [AUTH_STORAGE_COORDINATION_KEY]?: AuthStorageCoordinationState;
};

const authStorageGlobal = globalThis as AuthStorageGlobal;
const authStorageCoordination = authStorageGlobal[AUTH_STORAGE_COORDINATION_KEY]
  ?? (authStorageGlobal[AUTH_STORAGE_COORDINATION_KEY] = {
    operationTails: new Map<string, Promise<void>>(),
    pendingRemovals: new Map<string, number>(),
    volatileFallback: new Map<string, string>(),
  });

function shortKeyHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function secureAuthStorageKey(storageKey: string): string {
  const normalized = String(storageKey || '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 120) || 'session';
  return `uc_auth_${normalized}_${shortKeyHash(storageKey)}`;
}

function validChunkCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= SECURE_MAX_CHUNKS;
}

function parseManifest(value: string | null): SecureManifest | null {
  const v2Match = value?.match(/^uc-auth-v2:([01]):([1-9][0-9]*)$/);
  if (v2Match) {
    const slot = Number(v2Match[1]) as SecureSlot;
    const chunkCount = Number(v2Match[2]);
    return validChunkCount(chunkCount) ? { format: 'v2', slot, chunkCount } : null;
  }

  const v1Match = value?.match(/^uc-auth-v1:([1-9][0-9]*)$/);
  if (v1Match) {
    const chunkCount = Number(v1Match[1]);
    return validChunkCount(chunkCount) ? { format: 'v1', chunkCount } : null;
  }

  return null;
}

function secureSlotChunkKey(baseKey: string, slot: SecureSlot, index: number): string {
  return `${baseKey}_${slot}_${index}`;
}

function legacySecureChunkKey(baseKey: string, index: number): string {
  return `${baseKey}_${index}`;
}

function splitSecureValue(value: string): string[] {
  const chunks: string[] = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const characterBytes = codePoint <= 0x7f
      ? 1
      : codePoint <= 0x7ff
        ? 2
        : codePoint <= 0xffff
          ? 3
          : 4;
    if (chunk && chunkBytes + characterBytes > SECURE_CHUNK_SIZE) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  if (chunks.length > SECURE_MAX_CHUNKS) {
    throw new Error('Supabase auth session exceeds the secure-storage size limit.');
  }
  return chunks;
}

async function scrubSecureKeys(store: SecureStoreLike, keys: string[]): Promise<void> {
  const cleanupResults = await Promise.allSettled(keys.map(async (key) => {
    try {
      await store.deleteItemAsync(key);
    } catch (deleteError) {
      // Zeroing removes credential material even when a keychain temporarily
      // refuses physical deletion. A blank orphan is non-authoritative; a
      // failed zeroing attempt is a real security failure and must surface.
      try {
        await store.setItemAsync(key, '');
      } catch (scrubError) {
        throw new Error(`Could not scrub secure auth record ${key}.`, {
          cause: scrubError ?? deleteError,
        });
      }
      try {
        await store.deleteItemAsync(key);
      } catch {
        // The value is already blank and therefore contains no credential.
      }
    }
  }));
  const failedCleanup = cleanupResults.find((result) => result.status === 'rejected');
  if (failedCleanup?.status === 'rejected') throw failedCleanup.reason;
}

async function loadExpoSecureStore(): Promise<SecureStoreLike | null> {
  try {
    return await import('expo-secure-store');
  } catch {
    return null;
  }
}

/**
 * Native Supabase auth storage backed by the OS keychain/keystore.
 *
 * SecureStore historically rejects large single values on some platforms, so
 * the session JSON is split into bounded chunks. Writes go to the inactive one
 * of two slots and switch a tiny manifest only after every chunk succeeds. A
 * process-wide per-key queue keeps reads, refreshes, and logout deletion from
 * racing even when multiple Supabase clients or storage adapters exist.
 * Existing AsyncStorage sessions are migrated on first read
 * and removed only after the secure write succeeds. If the OS secure store is
 * unavailable, sessions are memory-only for the current process; auth
 * authority is never downgraded to plaintext AsyncStorage.
 */
export function createNativeSecureAuthStorage(
  dependencies: NativeAuthStorageDependencies = {},
): AuthKeyValueStorage {
  const legacyStorage = dependencies.legacyStorage ?? AsyncStorage;
  const loadStore = dependencies.loadSecureStore ?? loadExpoSecureStore;
  let secureStorePromise: Promise<SecureStoreLike | null> | null = null;

  const runExclusive = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const coordinationKey = secureAuthStorageKey(key);
    const previousTail = authStorageCoordination.operationTails.get(coordinationKey)
      ?? Promise.resolve();
    const operationPromise = previousTail.catch(() => undefined).then(operation);
    const nextTail = operationPromise.then(() => undefined, () => undefined);
    authStorageCoordination.operationTails.set(coordinationKey, nextTail);
    try {
      return await operationPromise;
    } finally {
      if (authStorageCoordination.operationTails.get(coordinationKey) === nextTail) {
        authStorageCoordination.operationTails.delete(coordinationKey);
      }
    }
  };

  const getSecureStore = async (): Promise<SecureStoreLike | null> => {
    if (!secureStorePromise) {
      secureStorePromise = loadStore().then(async (store) => {
        if (!store) return null;
        // A definitive `false` means this device cannot use SecureStore and may
        // use the compatibility adapter. A thrown availability probe is not
        // treated as permission to downgrade tokens to plaintext storage.
        return await store.isAvailableAsync() ? store : null;
      });
    }
    return secureStorePromise;
  };

  const cleanupUnprotectedAuthority = async (key: string): Promise<unknown | null> => {
    authStorageCoordination.volatileFallback.delete(secureAuthStorageKey(key));
    try {
      await legacyStorage.removeItem(key);
      return null;
    } catch (error) {
      return error;
    }
  };

  const writeSecure = async (store: SecureStoreLike, key: string, value: string): Promise<void> => {
    const baseKey = secureAuthStorageKey(key);
    const previousManifest = await store.getItemAsync(baseKey);
    const previous = parseManifest(previousManifest);
    const chunks = splitSecureValue(value);

    const targetSlot: SecureSlot = previous?.format === 'v2' && previous.slot === 0 ? 1 : 0;
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        await store.setItemAsync(secureSlotChunkKey(baseKey, targetSlot, index), chunks[index]);
      }
      // This single manifest write is the authority switch. The previously
      // active slot remains untouched until the new value is fully durable.
      await store.setItemAsync(
        baseKey,
        `${SECURE_MANIFEST_PREFIX}${targetSlot}:${chunks.length}`,
      );
    } catch (error) {
      try {
        await scrubSecureKeys(
          store,
          chunks.map((_, index) => secureSlotChunkKey(baseKey, targetSlot, index)),
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Secure session write failed and its candidate chunks could not be completely scrubbed.',
        );
      }
      throw error;
    }

    const previousChunkKeys: string[] = [];
    if (previous?.format === 'v2') {
      for (let index = 0; index < previous.chunkCount; index += 1) {
        previousChunkKeys.push(secureSlotChunkKey(baseKey, previous.slot, index));
      }
    } else if (previous?.format === 'v1') {
      for (let index = 0; index < previous.chunkCount; index += 1) {
        previousChunkKeys.push(legacySecureChunkKey(baseKey, index));
      }
    }
    if (previousChunkKeys.length > 0) {
      await scrubSecureKeys(store, previousChunkKeys);
    }
  };

  const readSecure = async (
    store: SecureStoreLike,
    baseKey: string,
    manifest: SecureManifest,
  ): Promise<string | null> => {
    const chunks: string[] = [];
    for (let index = 0; index < manifest.chunkCount; index += 1) {
      const chunkKey = manifest.format === 'v2'
        ? secureSlotChunkKey(baseKey, manifest.slot, index)
        : legacySecureChunkKey(baseKey, index);
      const chunk = await store.getItemAsync(chunkKey);
      if (chunk === null) return null;
      chunks.push(chunk);
    }
    return chunks.join('');
  };

  const deleteSecureRecords = async (store: SecureStoreLike, key: string): Promise<void> => {
    const baseKey = secureAuthStorageKey(key);
    const secureKeys = [baseKey];
    for (let index = 0; index < SECURE_MAX_CHUNKS; index += 1) {
      secureKeys.push(legacySecureChunkKey(baseKey, index));
      secureKeys.push(secureSlotChunkKey(baseKey, 0, index));
      secureKeys.push(secureSlotChunkKey(baseKey, 1, index));
    }
    await scrubSecureKeys(store, secureKeys);
  };

  const storage: AuthKeyValueStorage = {
    async getItem(key) {
      return runExclusive(key, async () => {
        let secureStore: SecureStoreLike | null;
        try {
          secureStore = await getSecureStore();
        } catch (secureStoreError) {
          const cleanupError = await cleanupUnprotectedAuthority(key);
          if (cleanupError) {
            throw new AggregateError(
              [secureStoreError, cleanupError],
              'Secure storage was unavailable and stale plaintext cleanup failed.',
            );
          }
          throw secureStoreError;
        }
        if (!secureStore) {
          // A legacy plaintext session must not stay usable on a device that
          // cannot protect it. Remove it and keep only this process's memory.
          await legacyStorage.removeItem(key);
          return authStorageCoordination.volatileFallback.get(secureAuthStorageKey(key)) ?? null;
        }

        const baseKey = secureAuthStorageKey(key);
        let manifestValue: string | null;
        try {
          manifestValue = await secureStore.getItemAsync(baseKey);
        } catch (manifestReadError) {
          const cleanupFailures: unknown[] = [manifestReadError];
          const cleanupError = await cleanupUnprotectedAuthority(key);
          if (cleanupError) cleanupFailures.push(cleanupError);
          if (cleanupFailures.length > 1) {
            throw new AggregateError(
              cleanupFailures,
              'Could not read the secure auth manifest or remove stale plaintext.',
            );
          }
          throw manifestReadError;
        }
        const manifest = parseManifest(manifestValue);
        if (manifest) {
          let secureValue: string | null = null;
          let secureReadFailed = false;
          const cleanupFailures: unknown[] = [];
          try {
            secureValue = await readSecure(secureStore, baseKey, manifest);
          } catch (error) {
            secureReadFailed = true;
            cleanupFailures.push(error);
          }
          // A previous process can crash after committing the secure manifest
          // but before deleting the plaintext migration source. Every secure
          // read therefore reasserts that plaintext is absent, even when the
          // keychain read itself throws.
          try {
            await legacyStorage.removeItem(key);
          } catch (error) {
            cleanupFailures.push(error);
          }
          authStorageCoordination.volatileFallback.delete(baseKey);
          if (!secureReadFailed && secureValue === null) {
            try {
              await deleteSecureRecords(secureStore, key);
            } catch (error) {
              cleanupFailures.push(error);
            }
          }
          if (cleanupFailures.length === 1) throw cleanupFailures[0];
          if (cleanupFailures.length > 1) {
            throw new AggregateError(
              cleanupFailures,
              'Could not safely read and clean up the Supabase auth session.',
            );
          }
          return secureValue;
        }

        if (manifestValue !== null) {
          // A malformed secure record must not leave a stale plaintext token
          // available to another version of the app.
          await legacyStorage.removeItem(key);
          authStorageCoordination.volatileFallback.delete(baseKey);
          return null;
        }

        const legacyValue = await legacyStorage.getItem(key);
        if (legacyValue === null) return null;
        await writeSecure(secureStore, key, legacyValue);
        await legacyStorage.removeItem(key);
        return legacyValue;
      });
    },

    async setItem(key, value) {
      const coordinationKey = secureAuthStorageKey(key);
      if ((authStorageCoordination.pendingRemovals.get(coordinationKey) ?? 0) > 0) {
        throw new Error('Cannot persist a Supabase auth session while logout cleanup is running.');
      }
      return runExclusive(key, async () => {
        let secureStore: SecureStoreLike | null;
        try {
          secureStore = await getSecureStore();
        } catch (secureStoreError) {
          const cleanupError = await cleanupUnprotectedAuthority(key);
          if (cleanupError) {
            throw new AggregateError(
              [secureStoreError, cleanupError],
              'Secure storage was unavailable and stale plaintext cleanup failed.',
            );
          }
          throw secureStoreError;
        }
        if (!secureStore) {
          authStorageCoordination.volatileFallback.set(secureAuthStorageKey(key), value);
          await legacyStorage.removeItem(key);
          return;
        }
        authStorageCoordination.volatileFallback.delete(secureAuthStorageKey(key));
        try {
          await writeSecure(secureStore, key, value);
          await legacyStorage.removeItem(key);
        } catch (secureWriteError) {
          const cleanupError = await cleanupUnprotectedAuthority(key);
          if (cleanupError) {
            throw new AggregateError(
              [secureWriteError, cleanupError],
              'Secure session persistence failed and stale plaintext cleanup also failed.',
            );
          }
          throw secureWriteError;
        }
      });
    },

    async removeItem(key) {
      const coordinationKey = secureAuthStorageKey(key);
      authStorageCoordination.pendingRemovals.set(
        coordinationKey,
        (authStorageCoordination.pendingRemovals.get(coordinationKey) ?? 0) + 1,
      );
      try {
        return await runExclusive(key, async () => {
          authStorageCoordination.volatileFallback.delete(secureAuthStorageKey(key));
          const cleanupFailures: unknown[] = [];
          try {
            const secureStore = await getSecureStore();
            if (secureStore) await deleteSecureRecords(secureStore, key);
          } catch (error) {
            cleanupFailures.push(error);
          }
          try {
            await legacyStorage.removeItem(key);
          } catch (error) {
            cleanupFailures.push(error);
          }
          if (cleanupFailures.length === 1) throw cleanupFailures[0];
          if (cleanupFailures.length > 1) {
            throw new AggregateError(
              cleanupFailures,
              'Could not completely remove the Supabase auth session.',
            );
          }
        });
      } finally {
        const remaining = (
          authStorageCoordination.pendingRemovals.get(coordinationKey) ?? 1
        ) - 1;
        if (remaining > 0) {
          authStorageCoordination.pendingRemovals.set(coordinationKey, remaining);
        } else {
          authStorageCoordination.pendingRemovals.delete(coordinationKey);
        }
      }
    },
  };

  return storage;
}
