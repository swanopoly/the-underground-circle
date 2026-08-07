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

const SECURE_MANIFEST_PREFIX = 'uc-auth-v1:';
const SECURE_CHUNK_SIZE = 1_800;
const SECURE_MAX_CHUNKS = 64;

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

function parseManifest(value: string | null): number | null {
  if (!value?.startsWith(SECURE_MANIFEST_PREFIX)) return null;
  const chunkCount = Number(value.slice(SECURE_MANIFEST_PREFIX.length));
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > SECURE_MAX_CHUNKS) {
    return null;
  }
  return chunkCount;
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
 * the session JSON is split into bounded chunks with a tiny manifest. Existing
 * AsyncStorage sessions are migrated on first read and removed only after the
 * secure write succeeds. If the OS secure store is unavailable, sessions are
 * memory-only for the current process; auth authority is never downgraded to
 * plaintext AsyncStorage.
 */
export function createNativeSecureAuthStorage(
  dependencies: NativeAuthStorageDependencies = {},
): AuthKeyValueStorage {
  const legacyStorage = dependencies.legacyStorage ?? AsyncStorage;
  const loadStore = dependencies.loadSecureStore ?? loadExpoSecureStore;
  let secureStorePromise: Promise<SecureStoreLike | null> | null = null;
  const volatileFallback = new Map<string, string>();

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

  const writeSecure = async (store: SecureStoreLike, key: string, value: string): Promise<void> => {
    const baseKey = secureAuthStorageKey(key);
    const previousManifest = await store.getItemAsync(baseKey);
    const previousChunkCount = parseManifest(previousManifest) ?? 0;
    const chunks = splitSecureValue(value);

    // The manifest is the commit marker. Readers continue using the previous
    // count until every new chunk has been persisted.
    for (let index = 0; index < chunks.length; index += 1) {
      await store.setItemAsync(`${baseKey}_${index}`, chunks[index]);
    }
    await store.setItemAsync(baseKey, `${SECURE_MANIFEST_PREFIX}${chunks.length}`);

    for (let index = chunks.length; index < previousChunkCount; index += 1) {
      await store.deleteItemAsync(`${baseKey}_${index}`);
    }
  };

  const storage: AuthKeyValueStorage = {
    async getItem(key) {
      const secureStore = await getSecureStore();
      if (!secureStore) {
        // A legacy plaintext session must not stay usable on a device that
        // cannot protect it. Remove it and keep only this process's memory.
        await legacyStorage.removeItem(key);
        return volatileFallback.get(key) ?? null;
      }

      const baseKey = secureAuthStorageKey(key);
      const manifest = await secureStore.getItemAsync(baseKey);
      const chunkCount = parseManifest(manifest);
      if (chunkCount) {
        const chunks: string[] = [];
        for (let index = 0; index < chunkCount; index += 1) {
          const chunk = await secureStore.getItemAsync(`${baseKey}_${index}`);
          if (chunk === null) return null;
          chunks.push(chunk);
        }
        return chunks.join('');
      }

      if (manifest !== null) {
        // A malformed secure record must not resurrect a potentially stale
        // plaintext token from the legacy store.
        return null;
      }

      const legacyValue = await legacyStorage.getItem(key);
      if (legacyValue === null) return null;
      await writeSecure(secureStore, key, legacyValue);
      await legacyStorage.removeItem(key);
      return legacyValue;
    },

    async setItem(key, value) {
      const secureStore = await getSecureStore();
      if (!secureStore) {
        volatileFallback.set(key, value);
        await legacyStorage.removeItem(key);
        return;
      }
      volatileFallback.delete(key);
      await writeSecure(secureStore, key, value);
      await legacyStorage.removeItem(key);
    },

    async removeItem(key) {
      volatileFallback.delete(key);
      const secureStore = await getSecureStore();
      if (secureStore) {
        const baseKey = secureAuthStorageKey(key);
        // Logout is rare and security-sensitive. Delete the complete bounded
        // keyspace so even chunks from an interrupted pre-manifest write go.
        const deletions: Promise<void>[] = [secureStore.deleteItemAsync(baseKey)];
        for (let index = 0; index < SECURE_MAX_CHUNKS; index += 1) {
          deletions.push(secureStore.deleteItemAsync(`${baseKey}_${index}`));
        }
        const results = await Promise.allSettled(deletions);
        if (results.some((result) => result.status === 'rejected')) {
          throw new Error('Could not completely remove the secure Supabase auth session.');
        }
      }
      await legacyStorage.removeItem(key);
    },
  };

  return storage;
}
