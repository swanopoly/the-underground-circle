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

export type VerifiedLocalSecretReadResult =
  | Readonly<{ status: 'found'; value: string }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'unavailable' | 'invalid' }>;

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

async function readVerifiedNativeLocalSecret(
  secureStore: NativeSecureStore,
  namespace: string,
  id: string,
): Promise<VerifiedLocalSecretReadResult> {
  try {
    const stored = await secureStore.getItemAsync(nativeLocalSecretStorageKey(namespace, id));
    return stored === null
      ? Object.freeze({ status: 'missing' as const })
      : Object.freeze({ status: 'found' as const, value: stored });
  } catch {
    return Object.freeze({ status: 'unavailable' as const });
  }
}

async function writeVerifiedNativeLocalSecret(
  secureStore: NativeSecureStore,
  namespace: string,
  id: string,
  value: string,
): Promise<boolean> {
  if (!value) return false;
  try {
    const key = nativeLocalSecretStorageKey(namespace, id);
    await secureStore.setItemAsync(key, value);
    let verified = false;
    try { verified = await secureStore.getItemAsync(key) === value; } catch {}
    if (verified) return true;
    try { await secureStore.deleteItemAsync(key); } catch {}
    return false;
  } catch {
    return false;
  }
}

async function deleteVerifiedNativeLocalSecret(
  secureStore: NativeSecureStore,
  namespace: string,
  id: string,
): Promise<boolean> {
  try {
    const key = nativeLocalSecretStorageKey(namespace, id);
    await secureStore.deleteItemAsync(key);
    const legacyKey = readableLegacyNativeKey(namespace, id);
    if (legacyKey && legacyKey !== key) await secureStore.deleteItemAsync(legacyKey);
    const canonicalRemaining = await secureStore.getItemAsync(key);
    const legacyRemaining = legacyKey && legacyKey !== key
      ? await secureStore.getItemAsync(legacyKey)
      : null;
    return canonicalRemaining === null && legacyRemaining === null;
  } catch {
    return false;
  }
}

export const __localSecretsTestables = {
  deleteVerifiedNativeLocalSecret,
  readNativeLocalSecret,
  readVerifiedNativeLocalSecret,
  writeVerifiedNativeLocalSecret,
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

/**
 * Strict authority-storage read. On web, only an AES-GCM blob produced by
 * `webCrypto` is accepted; historical plaintext compatibility is deliberately
 * disabled. Native values are read only from the canonical OS SecureStore key.
 */
export async function readVerifiedLocalSecret(
  namespace: string,
  id: string,
): Promise<VerifiedLocalSecretReadResult> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage === 'undefined' || !isWebCryptoAvailable()) {
        return Object.freeze({ status: 'unavailable' as const });
      }
      const raw = localStorage.getItem(webStorageKey(namespace, id));
      if (raw === null) return Object.freeze({ status: 'missing' as const });
      if (!isEncryptedBlob(raw)) return Object.freeze({ status: 'invalid' as const });
      const value = await decryptString(raw);
      return value === null
        ? Object.freeze({ status: 'invalid' as const })
        : Object.freeze({ status: 'found' as const, value });
    } catch {
      return Object.freeze({ status: 'unavailable' as const });
    }
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return Object.freeze({ status: 'unavailable' as const });
  return readVerifiedNativeLocalSecret(secureStore, namespace, id);
}

/**
 * Write a non-empty authority value and acknowledge it only after an exact
 * protected-store readback. Web requires AES-GCM and never falls back to a
 * plaintext localStorage value. This is device-local protection at rest; it
 * does not make browser-held authority safe from code already executing in the
 * origin (for example, XSS).
 */
export async function writeVerifiedLocalSecret(
  namespace: string,
  id: string,
  value: string,
): Promise<boolean> {
  if (!value) return false;
  if (Platform.OS === 'web') {
    const key = webStorageKey(namespace, id);
    try {
      if (typeof localStorage === 'undefined' || !isWebCryptoAvailable()) return false;
      const blob = await encryptString(value);
      if (!blob || !isEncryptedBlob(blob)) return false;
      localStorage.setItem(key, blob);
      const stored = localStorage.getItem(key);
      if (stored === blob && isEncryptedBlob(stored) && await decryptString(stored) === value) {
        return true;
      }
      localStorage.removeItem(key);
      return false;
    } catch {
      try { localStorage.removeItem(key); } catch {}
      return false;
    }
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return false;
  return writeVerifiedNativeLocalSecret(secureStore, namespace, id, value);
}

/** Delete and verify absence before one-shot authority is considered spent. */
export async function deleteVerifiedLocalSecret(
  namespace: string,
  id: string,
): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage === 'undefined') return false;
      const key = webStorageKey(namespace, id);
      localStorage.removeItem(key);
      return localStorage.getItem(key) === null;
    } catch {
      return false;
    }
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return false;
  return deleteVerifiedNativeLocalSecret(secureStore, namespace, id);
}
