/**
 * webCrypto — small AES-GCM helper for web-only token storage.
 *
 * The old `localSecrets.writeLocalSecret` path wrote tokens (OpenSwan, Discord,
 * Telegram, GitHub) to `localStorage` in plaintext. That's readable by any
 * browser extension, any devtools snippet, or any third-party script loaded
 * on the origin. Encrypting the blob doesn't defeat targeted XSS, but it
 * does stop the common attack: "extension enumerates localStorage for
 * things that look like tokens."
 *
 * Design:
 *   - 256-bit AES-GCM key.
 *   - Key is exported as JWK once and persisted in IndexedDB (NOT
 *     localStorage — IDB entries don't show up under the "Local Storage"
 *     panel in DevTools, and extensions can't enumerate them as easily).
 *   - Ciphertext format: `v1:${base64(iv)}:${base64(ciphertext)}` — the
 *     `v1:` prefix tells reads "this is encrypted"; legacy plaintext
 *     entries (no prefix) are returned as-is and transparently re-encrypted
 *     on the next write.
 *
 * Intentionally no-op on non-web runtimes — native uses `expo-secure-store`
 * which is already hardware-backed on both iOS and Android.
 */

import { Platform } from 'react-native';

const DB_NAME = 'uc_crypto_v1';
const DB_STORE = 'keys';
const KEY_ID = 'local_secret_key';
const CIPHER_PREFIX = 'v1:';

let cachedKey: CryptoKey | null = null;
let keyLoadPromise: Promise<CryptoKey | null> | null = null;

function subtle(): SubtleCrypto | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const s = (window.crypto as any)?.subtle;
  return s ?? null;
}

// ── IndexedDB helpers ───────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(DB_STORE, 'readwrite');
      const req = tx.objectStore(DB_STORE).put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch { resolve(false); }
  });
}

// ── Key management ──────────────────────────────────────────────────────────

async function loadOrCreateKey(): Promise<CryptoKey | null> {
  const s = subtle();
  if (!s) return null;

  if (cachedKey) return cachedKey;
  if (keyLoadPromise) return keyLoadPromise;

  keyLoadPromise = (async () => {
    const db = await openDb();
    if (!db) return null;

    const existing = await idbGet<JsonWebKey>(db, KEY_ID);
    if (existing) {
      try {
        const imported = await s.importKey(
          'jwk', existing, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
        );
        cachedKey = imported;
        return imported;
      } catch {
        // Fall through to generate a new key — existing one is unusable.
      }
    }

    // Generate + persist.
    const freshKey = await s.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
    );
    const jwk = await s.exportKey('jwk', freshKey);
    await idbPut(db, KEY_ID, jwk);
    cachedKey = freshKey;
    return freshKey;
  })();

  try {
    return await keyLoadPromise;
  } finally {
    keyLoadPromise = null;
  }
}

// ── base64 (ArrayBuffer ⇄ string) ───────────────────────────────────────────

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function isWebCryptoAvailable(): boolean {
  return !!subtle() && typeof indexedDB !== 'undefined';
}

/** Encrypts `plain` → `v1:{iv}:{ct}` string. Returns null on failure. */
export async function encryptString(plain: string): Promise<string | null> {
  const s = subtle();
  if (!s) return null;
  const key = await loadOrCreateKey();
  if (!key) return null;

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plain);
  try {
    const ct = await s.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    return `${CIPHER_PREFIX}${bufToB64(iv.buffer as ArrayBuffer)}:${bufToB64(ct)}`;
  } catch {
    return null;
  }
}

/**
 * Decrypts a blob produced by `encryptString`. If the input doesn't start
 * with `v1:` it's treated as legacy plaintext and returned as-is. Returns
 * null if decryption fails (key rotated, blob tampered, etc).
 */
export async function decryptString(blob: string): Promise<string | null> {
  if (!blob) return '';
  if (!blob.startsWith(CIPHER_PREFIX)) return blob; // legacy plaintext

  const s = subtle();
  if (!s) return null;
  const key = await loadOrCreateKey();
  if (!key) return null;

  const parts = blob.slice(CIPHER_PREFIX.length).split(':');
  if (parts.length !== 2) return null;
  const [ivB64, ctB64] = parts;
  try {
    const iv = new Uint8Array(b64ToBuf(ivB64));
    const ct = b64ToBuf(ctB64);
    const plain = await s.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** True if a blob looks like the `v1:` ciphertext format. */
export function isEncryptedBlob(blob: string): boolean {
  return typeof blob === 'string' && blob.startsWith(CIPHER_PREFIX);
}
