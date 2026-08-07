/**
 * localSecrets — per-device secret storage.
 *
 * Native: uses `expo-secure-store` (OS keychain / keystore) with keys that
 * satisfy its portable key alphabet.
 *
 * Web: AES-GCM encrypts before writing to `localStorage`, using a key held
 * in IndexedDB (see `webCrypto.ts`). Existing plaintext entries written by
 * older app versions remain readable, but new writes fail closed when the
 * browser cannot encrypt; provider tokens must never silently downgrade to
 * plaintext storage.
 */

import { Platform } from 'react-native';
import {
  decryptString, encryptString, isEncryptedBlob, isWebCryptoAvailable,
} from './webCrypto';

const WEB_SECRET_PREFIX = '@local_secret:';
const NATIVE_SECRET_PREFIX = 'uc.local-secret.v1';
const SECURE_STORE_KEY_RE = /^[A-Za-z0-9._-]+$/;
const NATIVE_KEY_PART_PASSTHROUGH_RE = /^[A-Za-z0-9-]$/;

interface NativeSecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

function webStorageKey(namespace: string, id: string): string {
  return `${WEB_SECRET_PREFIX}${namespace}:${id}`;
}

/**
 * Encode one key component without hashing or lossy replacement. Components
 * never contain `.`, so the separators in `nativeLocalSecretStorageKey` are
 * unambiguous. Escaping UTF-16 code units also keeps lone surrogates distinct.
 */
function encodeNativeKeyPart(value: string): string {
  let encoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character && NATIVE_KEY_PART_PASSTHROUGH_RE.test(character)) {
      encoded += character;
      continue;
    }
    encoded += `_${value.charCodeAt(index).toString(16).padStart(4, '0')}_`;
  }
  return encoded;
}

/**
 * Collision-free SecureStore key for the exact namespace/id pair.
 *
 * A reversible encoding is used instead of replacing unsupported characters:
 * pairs such as (`a:b`, `c`) and (`a`, `b:c`) must never share a secret.
 */
export function nativeLocalSecretStorageKey(namespace: string, id: string): string {
  const key = `${NATIVE_SECRET_PREFIX}.${encodeNativeKeyPart(String(namespace))}.${encodeNativeKeyPart(String(id))}`;
  if (!SECURE_STORE_KEY_RE.test(key)) {
    throw new Error('Could not create a valid native secret-storage key.');
  }
  return key;
}

function readableLegacyNativeKey(namespace: string, id: string): string | null {
  const key = webStorageKey(namespace, id);
  return SECURE_STORE_KEY_RE.test(key) ? key : null;
}

async function getSecureStore(): Promise<NativeSecureStore | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await import('expo-secure-store');
  } catch {
    return null;
  }
}

async function readNativeLocalSecret(
  secureStore: NativeSecureStore,
  namespace: string,
  id: string,
): Promise<string> {
  try {
    const key = nativeLocalSecretStorageKey(namespace, id);
    const stored = await secureStore.getItemAsync(key);
    if (stored !== null) return stored;

    // Migrate only a historical key that the supported SecureStore API can
    // address. Every committed `@local_secret:...` native key is invalid under
    // Expo's key contract, so current builds deliberately do not reach into a
    // private native module or try a collision-prone sanitized alias.
    const legacyKey = readableLegacyNativeKey(namespace, id);
    if (!legacyKey || legacyKey === key) return '';

    const legacy = await secureStore.getItemAsync(legacyKey);
    if (legacy === null) return '';
    await secureStore.setItemAsync(key, legacy);
    try {
      await secureStore.deleteItemAsync(legacyKey);
    } catch {
      // Do not expose a partly migrated value as success. Best-effort rollback
      // leaves the readable legacy entry authoritative for an older build.
      try { await secureStore.deleteItemAsync(key); } catch {}
      return '';
    }
    return legacy;
  } catch {
    return '';
  }
}

async function writeNativeLocalSecret(
  secureStore: NativeSecureStore,
  namespace: string,
  id: string,
  value: string,
): Promise<void> {
  try {
    const key = nativeLocalSecretStorageKey(namespace, id);
    const legacyKey = readableLegacyNativeKey(namespace, id);
    if (value) {
      await secureStore.setItemAsync(key, value);
      if (legacyKey && legacyKey !== key) await secureStore.deleteItemAsync(legacyKey);
    } else {
      await secureStore.deleteItemAsync(key);
      if (legacyKey && legacyKey !== key) await secureStore.deleteItemAsync(legacyKey);
    }
  } catch {}
}

export const __localSecretsTestables = {
  readNativeLocalSecret,
  writeNativeLocalSecret,
};

export async function readLocalSecret(namespace: string, id: string): Promise<string> {
  if (Platform.OS === 'web') {
    const key = webStorageKey(namespace, id);
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      if (!raw) return '';
      if (!isEncryptedBlob(raw)) {
        // Preserve compatibility long enough for the user to reconnect, while
        // opportunistically replacing a historical plaintext value at rest.
        if (isWebCryptoAvailable()) {
          const upgraded = await encryptString(raw);
          if (upgraded) localStorage.setItem(key, upgraded);
        }
        return raw;
      }
      const plain = await decryptString(raw);
      return plain ?? '';
    } catch {
      return '';
    }
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return '';
  return readNativeLocalSecret(secureStore, namespace, id);
}

export async function writeLocalSecret(namespace: string, id: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    const key = webStorageKey(namespace, id);
    try {
      if (typeof localStorage === 'undefined') return;
      if (!value) {
        localStorage.removeItem(key);
        return;
      }
      if (isWebCryptoAvailable()) {
        const blob = await encryptString(value);
        if (blob) {
          localStorage.setItem(key, blob);
          return;
        }
      }
      // Never downgrade a provider credential to plaintext. Remove any stale
      // legacy value so a failed secure update cannot leave old authority in
      // place while the UI believes it stored the replacement.
      localStorage.removeItem(key);
    } catch {}
    return;
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return;
  await writeNativeLocalSecret(secureStore, namespace, id, value);
}

export async function deleteLocalSecret(namespace: string, id: string): Promise<void> {
  await writeLocalSecret(namespace, id, '');
}
