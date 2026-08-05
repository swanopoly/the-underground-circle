/**
 * SwanBot continuation checkpoint encryption.
 *
 * Exact continuation transcripts can contain user text, local paths, tool
 * inputs, and tool results. They must not be stored in circle-visible run
 * telemetry as plaintext. This dependency-free helper seals one JSON-safe
 * continuation snapshot with AES-256-GCM and authenticates the envelope's
 * schema, key version, and exact owning run/user/circle row as additional
 * authenticated data (AAD). The row binding is never copied into the public
 * envelope, so ciphertext cannot be transplanted to another authorized row.
 *
 * The caller owns key lookup/rotation and must supply a dedicated secret. Do
 * not derive this secret from the Supabase service-role key or another shared
 * application credential.
 */

export const SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION = 1 as const;
export const SWANBOT_CONTINUATION_CRYPTO_ALGORITHM = "AES-256-GCM" as const;
export const SWANBOT_CONTINUATION_CRYPTO_KDF = "SHA-256" as const;
export const SWANBOT_CONTINUATION_CRYPTO_PURPOSE =
  "underground-circle:swanbot-continuation-checkpoint" as const;
export const SWANBOT_CONTINUATION_CRYPTO_ROW_BINDING_VERSION = 1 as const;

export const SWANBOT_CONTINUATION_CRYPTO_MIN_SECRET_CHARS = 32;
export const SWANBOT_CONTINUATION_CRYPTO_MAX_SECRET_CHARS = 4_096;
export const SWANBOT_CONTINUATION_CRYPTO_MAX_KEY_VERSION_CHARS = 64;
export const SWANBOT_CONTINUATION_CRYPTO_IV_BYTES = 12;
export const SWANBOT_CONTINUATION_CRYPTO_TAG_BITS = 128;
export const SWANBOT_CONTINUATION_CRYPTO_TAG_BYTES =
  SWANBOT_CONTINUATION_CRYPTO_TAG_BITS / 8;
export const SWANBOT_CONTINUATION_CRYPTO_MAX_PLAINTEXT_BYTES =
  4 * 1024 * 1024;
export const SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_BYTES =
  SWANBOT_CONTINUATION_CRYPTO_MAX_PLAINTEXT_BYTES
  + SWANBOT_CONTINUATION_CRYPTO_TAG_BYTES;
export const SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_B64_CHARS =
  Math.ceil(SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_BYTES / 3) * 4;

const ENVELOPE_FIELDS = [
  "schemaVersion",
  "algorithm",
  "kdf",
  "keyVersion",
  "ivB64",
  "ciphertextB64",
] as const;

const KEY_VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SECRET_CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY_DERIVATION_DOMAIN =
  `${SWANBOT_CONTINUATION_CRYPTO_PURPOSE}:key-derivation:v1`;

export type SwanBotContinuationCryptoEnvelopeV1 = {
  schemaVersion: typeof SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION;
  algorithm: typeof SWANBOT_CONTINUATION_CRYPTO_ALGORITHM;
  kdf: typeof SWANBOT_CONTINUATION_CRYPTO_KDF;
  keyVersion: string;
  ivB64: string;
  ciphertextB64: string;
};

export type SwanBotContinuationCryptoOptions = {
  /** Dedicated deployment secret. Minimum 32 characters; never persisted. */
  secret: string;
  /** Rotation label authenticated into the ciphertext, for example `2026-07`. */
  keyVersion: string;
  /** Optional injection for deterministic runtime selection and Node smokes. */
  crypto?: Crypto;
};

export type SwanBotContinuationCryptoRowBinding = {
  runId: string;
  userId: string;
  circleId: string;
};

export type SwanBotContinuationCryptoErrorCode =
  | "continuation_crypto_unavailable"
  | "continuation_crypto_secret_invalid"
  | "continuation_crypto_key_version_invalid"
  | "continuation_crypto_row_binding_invalid"
  | "continuation_crypto_snapshot_invalid"
  | "continuation_crypto_snapshot_too_large"
  | "continuation_crypto_envelope_invalid"
  | "continuation_crypto_key_version_mismatch"
  | "continuation_crypto_seal_failed"
  | "continuation_crypto_open_failed";

const ERROR_MESSAGES: Record<SwanBotContinuationCryptoErrorCode, string> = {
  continuation_crypto_unavailable:
    "SwanBot continuation cryptography is unavailable.",
  continuation_crypto_secret_invalid:
    "SwanBot continuation encryption secret is invalid.",
  continuation_crypto_key_version_invalid:
    "SwanBot continuation encryption key version is invalid.",
  continuation_crypto_row_binding_invalid:
    "SwanBot continuation checkpoint row binding is invalid.",
  continuation_crypto_snapshot_invalid:
    "SwanBot continuation snapshot is invalid.",
  continuation_crypto_snapshot_too_large:
    "SwanBot continuation snapshot exceeds the checkpoint limit.",
  continuation_crypto_envelope_invalid:
    "SwanBot continuation checkpoint envelope is invalid.",
  continuation_crypto_key_version_mismatch:
    "SwanBot continuation checkpoint key version does not match.",
  continuation_crypto_seal_failed:
    "SwanBot continuation checkpoint sealing failed.",
  continuation_crypto_open_failed:
    "SwanBot continuation checkpoint opening failed.",
};

/**
 * Stable, value-free failure. It deliberately carries no cause because browser
 * crypto/JSON exceptions may echo plaintext, local paths, or provider details.
 */
export class SwanBotContinuationCryptoError extends Error {
  readonly code: SwanBotContinuationCryptoErrorCode;

  constructor(code: SwanBotContinuationCryptoErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SwanBotContinuationCryptoError";
    this.code = code;
  }
}

function fail(code: SwanBotContinuationCryptoErrorCode): never {
  throw new SwanBotContinuationCryptoError(code);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function validateSecret(secret: unknown): string {
  if (
    typeof secret !== "string"
    || secret.length < SWANBOT_CONTINUATION_CRYPTO_MIN_SECRET_CHARS
    || secret.length > SWANBOT_CONTINUATION_CRYPTO_MAX_SECRET_CHARS
    || secret.trim().length < SWANBOT_CONTINUATION_CRYPTO_MIN_SECRET_CHARS
    || SECRET_CONTROL_CHAR_RE.test(secret)
  ) {
    fail("continuation_crypto_secret_invalid");
  }
  return secret;
}

function isValidKeyVersion(keyVersion: unknown): keyVersion is string {
  return typeof keyVersion === "string"
    && keyVersion.length <= SWANBOT_CONTINUATION_CRYPTO_MAX_KEY_VERSION_CHARS
    && KEY_VERSION_RE.test(keyVersion);
}

function validateKeyVersion(keyVersion: unknown): string {
  if (!isValidKeyVersion(keyVersion)) {
    fail("continuation_crypto_key_version_invalid");
  }
  return keyVersion;
}

function validateRowBinding(
  binding: unknown,
): SwanBotContinuationCryptoRowBinding {
  if (!isPlainRecord(binding)) {
    fail("continuation_crypto_row_binding_invalid");
  }
  const keys = Object.keys(binding).sort();
  if (
    keys.length !== 3
    || keys[0] !== "circleId"
    || keys[1] !== "runId"
    || keys[2] !== "userId"
    || typeof binding.runId !== "string"
    || typeof binding.userId !== "string"
    || typeof binding.circleId !== "string"
    || !UUID_RE.test(binding.runId)
    || !UUID_RE.test(binding.userId)
    || !UUID_RE.test(binding.circleId)
  ) {
    fail("continuation_crypto_row_binding_invalid");
  }
  return {
    runId: binding.runId,
    userId: binding.userId,
    circleId: binding.circleId,
  };
}

function resolveCrypto(override?: Crypto): Crypto {
  const cryptoApi = override ?? globalThis.crypto;
  if (
    !cryptoApi
    || typeof cryptoApi.getRandomValues !== "function"
    || !cryptoApi.subtle
    || typeof cryptoApi.subtle.digest !== "function"
    || typeof cryptoApi.subtle.importKey !== "function"
    || typeof cryptoApi.subtle.encrypt !== "function"
    || typeof cryptoApi.subtle.decrypt !== "function"
  ) {
    fail("continuation_crypto_unavailable");
  }
  return cryptoApi;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function ownedBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
  copy.set(value);
  return copy;
}

function decodeCanonicalBase64(
  value: unknown,
  exactBytes?: number,
  maxBytes?: number,
): Uint8Array<ArrayBuffer> | null {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length % 4 !== 0
    || !BASE64_RE.test(value)
  ) {
    return null;
  }
  if (
    maxBytes !== undefined
    && value.length > Math.ceil(maxBytes / 3) * 4
  ) {
    return null;
  }
  try {
    const binary = atob(value);
    if (exactBytes !== undefined && binary.length !== exactBytes) return null;
    if (maxBytes !== undefined && binary.length > maxBytes) return null;
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytesToBase64(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

function buildAuthenticatedData(
  keyVersion: string,
  rowBinding: SwanBotContinuationCryptoRowBinding,
): Uint8Array<ArrayBuffer> {
  return ownedBytes(new TextEncoder().encode(JSON.stringify({
    purpose: SWANBOT_CONTINUATION_CRYPTO_PURPOSE,
    schemaVersion: SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION,
    algorithm: SWANBOT_CONTINUATION_CRYPTO_ALGORITHM,
    kdf: SWANBOT_CONTINUATION_CRYPTO_KDF,
    keyVersion,
    rowBindingVersion: SWANBOT_CONTINUATION_CRYPTO_ROW_BINDING_VERSION,
    runId: rowBinding.runId,
    userId: rowBinding.userId,
    circleId: rowBinding.circleId,
  })));
}

async function deriveKey(
  cryptoApi: Crypto,
  secret: string,
  keyVersion: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = ownedBytes(new TextEncoder().encode(
    `${KEY_DERIVATION_DOMAIN}\u0000${keyVersion}\u0000${secret}`,
  ));
  let digest: ArrayBuffer | null = null;
  try {
    digest = await cryptoApi.subtle.digest("SHA-256", material);
    return await cryptoApi.subtle.importKey(
      "raw",
      digest,
      { name: "AES-GCM", length: 256 },
      false,
      usages,
    );
  } finally {
    material.fill(0);
    if (digest) new Uint8Array(digest).fill(0);
  }
}

/**
 * Validate an untrusted database/API value before selecting a rotation key or
 * attempting decryption. Unknown fields, non-canonical base64, wrong lengths,
 * and oversized ciphertext fail closed.
 */
export function parseSwanBotContinuationCryptoEnvelope(
  value: unknown,
): SwanBotContinuationCryptoEnvelopeV1 {
  try {
    if (!isPlainRecord(value)) fail("continuation_crypto_envelope_invalid");
    const keys = Object.keys(value).sort();
    const expectedKeys = [...ENVELOPE_FIELDS].sort();
    if (
      keys.length !== expectedKeys.length
      || keys.some((key, index) => key !== expectedKeys[index])
      || value.schemaVersion !== SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION
      || value.algorithm !== SWANBOT_CONTINUATION_CRYPTO_ALGORITHM
      || value.kdf !== SWANBOT_CONTINUATION_CRYPTO_KDF
    ) {
      fail("continuation_crypto_envelope_invalid");
    }
    if (!isValidKeyVersion(value.keyVersion)) {
      fail("continuation_crypto_envelope_invalid");
    }
    const keyVersion = value.keyVersion;
    const iv = decodeCanonicalBase64(
      value.ivB64,
      SWANBOT_CONTINUATION_CRYPTO_IV_BYTES,
    );
    const ciphertext = decodeCanonicalBase64(
      value.ciphertextB64,
      undefined,
      SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_BYTES,
    );
    if (
      !iv
      || !ciphertext
      || ciphertext.length < SWANBOT_CONTINUATION_CRYPTO_TAG_BYTES
    ) {
      fail("continuation_crypto_envelope_invalid");
    }
    return {
      schemaVersion: SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION,
      algorithm: SWANBOT_CONTINUATION_CRYPTO_ALGORITHM,
      kdf: SWANBOT_CONTINUATION_CRYPTO_KDF,
      keyVersion,
      ivB64: value.ivB64 as string,
      ciphertextB64: value.ciphertextB64 as string,
    };
  } catch (error) {
    if (error instanceof SwanBotContinuationCryptoError) throw error;
    fail("continuation_crypto_envelope_invalid");
  }
}

/**
 * Seal an exact JSON-safe continuation snapshot. JSON serialization is the
 * existing persistence boundary for `agent_runs.metadata`; the opened value is
 * therefore exact with respect to that durable JSON representation.
 */
export async function sealSwanBotContinuationSnapshot<
  T extends Record<string, unknown>,
>(
  snapshot: T,
  untrustedRowBinding: SwanBotContinuationCryptoRowBinding,
  options: SwanBotContinuationCryptoOptions,
): Promise<SwanBotContinuationCryptoEnvelopeV1> {
  const secret = validateSecret(options?.secret);
  const keyVersion = validateKeyVersion(options?.keyVersion);
  const rowBinding = validateRowBinding(untrustedRowBinding);
  const cryptoApi = resolveCrypto(options?.crypto);
  if (!isPlainRecord(snapshot)) fail("continuation_crypto_snapshot_invalid");

  let plaintext: Uint8Array<ArrayBuffer>;
  try {
    const serialized = JSON.stringify(snapshot);
    if (typeof serialized !== "string") {
      fail("continuation_crypto_snapshot_invalid");
    }
    plaintext = ownedBytes(new TextEncoder().encode(serialized));
  } catch (error) {
    if (error instanceof SwanBotContinuationCryptoError) throw error;
    fail("continuation_crypto_snapshot_invalid");
  }
  if (plaintext.length > SWANBOT_CONTINUATION_CRYPTO_MAX_PLAINTEXT_BYTES) {
    fail("continuation_crypto_snapshot_too_large");
  }

  try {
    const iv = new Uint8Array(
      new ArrayBuffer(SWANBOT_CONTINUATION_CRYPTO_IV_BYTES),
    );
    cryptoApi.getRandomValues(iv);
    const key = await deriveKey(cryptoApi, secret, keyVersion, ["encrypt"]);
    const ciphertext = await cryptoApi.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: buildAuthenticatedData(keyVersion, rowBinding),
        tagLength: SWANBOT_CONTINUATION_CRYPTO_TAG_BITS,
      },
      key,
      plaintext,
    );
    return {
      schemaVersion: SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION,
      algorithm: SWANBOT_CONTINUATION_CRYPTO_ALGORITHM,
      kdf: SWANBOT_CONTINUATION_CRYPTO_KDF,
      keyVersion,
      ivB64: bytesToBase64(iv),
      ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    };
  } catch {
    fail("continuation_crypto_seal_failed");
  } finally {
    plaintext.fill(0);
  }
}

/**
 * Open a validated checkpoint with the exact expected rotation key. Tampering,
 * a wrong secret, corrupt JSON, and authentication failure deliberately share
 * one stable error so callers never receive a plaintext/value oracle.
 */
export async function openSwanBotContinuationSnapshot<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  untrustedEnvelope: unknown,
  untrustedRowBinding: SwanBotContinuationCryptoRowBinding,
  options: SwanBotContinuationCryptoOptions,
): Promise<T> {
  const envelope = parseSwanBotContinuationCryptoEnvelope(untrustedEnvelope);
  const secret = validateSecret(options?.secret);
  const keyVersion = validateKeyVersion(options?.keyVersion);
  const rowBinding = validateRowBinding(untrustedRowBinding);
  const cryptoApi = resolveCrypto(options?.crypto);
  if (envelope.keyVersion !== keyVersion) {
    fail("continuation_crypto_key_version_mismatch");
  }

  try {
    const iv = decodeCanonicalBase64(
      envelope.ivB64,
      SWANBOT_CONTINUATION_CRYPTO_IV_BYTES,
    )!;
    const ciphertext = decodeCanonicalBase64(
      envelope.ciphertextB64,
      undefined,
      SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_BYTES,
    )!;
    const key = await deriveKey(cryptoApi, secret, keyVersion, ["decrypt"]);
    const plaintext = await cryptoApi.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: buildAuthenticatedData(keyVersion, rowBinding),
        tagLength: SWANBOT_CONTINUATION_CRYPTO_TAG_BITS,
      },
      key,
      ciphertext,
    );
    const plaintextBytes = new Uint8Array(plaintext);
    try {
      if (plaintext.byteLength > SWANBOT_CONTINUATION_CRYPTO_MAX_PLAINTEXT_BYTES) {
        fail("continuation_crypto_open_failed");
      }
      const parsed = JSON.parse(new TextDecoder().decode(plaintextBytes));
      if (!isPlainRecord(parsed)) fail("continuation_crypto_open_failed");
      return parsed as T;
    } finally {
      plaintextBytes.fill(0);
    }
  } catch (error) {
    if (
      error instanceof SwanBotContinuationCryptoError
      && error.code === "continuation_crypto_open_failed"
    ) {
      throw error;
    }
    fail("continuation_crypto_open_failed");
  }
}
