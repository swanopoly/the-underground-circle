/**
 * localSecrets — per-device secret storage.
 *
 * Native: passes through to `expo-secure-store` (OS keychain / keystore).
 *
 * Web: AES-GCM encrypts before writing to `localStorage`, using a key held
 * in IndexedDB (see `webCrypto.ts`). Existing plaintext entries written by
 * older app versions are still readable and transparently upgraded on the
 * next write. If SubtleCrypto or IndexedDB is unavailable (ancient browser,
 * Safari in private mode) we fall back to plaintext so the app keeps
 * working — getting tokens onto the device is more important than hiding
 * them from ourselves.
 */

import { Platform } from 'react-native';
import {
  decryptString, encryptString, isEncryptedBlob, isWebCryptoAvailable,
} from './webCrypto';

const SECRET_PREFIX = '@local_secret:';

function storageKey(namespace: string, id: string): string {
  return `${SECRET_PREFIX}${namespace}:${id}`;
}

async function getSecureStore() {
  if (Platform.OS === 'web') return null;
  try {
    return await import('expo-secure-store');
  } catch {
    return null;
  }
}

export async function readLocalSecret(namespace: string, id: string): Promise<string> {
  const key = storageKey(namespace, id);

  if (Platform.OS === 'web') {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      if (!raw) return '';
      if (!isEncryptedBlob(raw)) return raw; // legacy plaintext — still usable
      const plain = await decryptString(raw);
      return plain ?? '';
    } catch {
      return '';
    }
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return '';
  try {
    return (await secureStore.getItemAsync(key)) || '';
  } catch {
    return '';
  }
}

export async function writeLocalSecret(namespace: string, id: string, value: string): Promise<void> {
  const key = storageKey(namespace, id);

  if (Platform.OS === 'web') {
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
      // Fallback — old browser, SubtleCrypto refused, etc. Write plaintext
      // so the rest of the app keeps working; future reads handle both.
      localStorage.setItem(key, value);
    } catch {}
    return;
  }

  const secureStore = await getSecureStore();
  if (!secureStore) return;
  try {
    if (value) await secureStore.setItemAsync(key, value);
    else await secureStore.deleteItemAsync(key);
  } catch {}
}

export async function deleteLocalSecret(namespace: string, id: string): Promise<void> {
  await writeLocalSecret(namespace, id, '');
}
