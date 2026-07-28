/**
 * Adversarial smoke for the SwanBot v2 private continuation checkpoint.
 *
 * Run:
 *   npx tsx scripts/swanbot-v2-continuation-crypto-smoketest.ts
 */

import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  openSwanBotContinuationSnapshot,
  parseSwanBotContinuationCryptoEnvelope,
  sealSwanBotContinuationSnapshot,
  SwanBotContinuationCryptoError,
  SWANBOT_CONTINUATION_CRYPTO_ALGORITHM,
  SWANBOT_CONTINUATION_CRYPTO_IV_BYTES,
  SWANBOT_CONTINUATION_CRYPTO_KDF,
  SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_B64_CHARS,
  SWANBOT_CONTINUATION_CRYPTO_MAX_PLAINTEXT_BYTES,
  SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION,
  type SwanBotContinuationCryptoEnvelopeV1,
  type SwanBotContinuationCryptoErrorCode,
  type SwanBotContinuationCryptoOptions,
  type SwanBotContinuationCryptoRowBinding,
} from "../supabase/functions/_shared/swanbot-continuation-crypto";

const nodeCrypto = webcrypto as unknown as Crypto;
const SECRET_A = `a-${"A".repeat(48)}-dedicated-continuation-secret`;
const SECRET_B = `b-${"B".repeat(48)}-different-continuation-secret`;
const KEY_VERSION = "2026-07-primary";
const PRIVATE_VALUE = "private-message-hunter2";
const PRIVATE_PATH = "/Users/example/private/payroll-notes.txt";
const ROW_A: SwanBotContinuationCryptoRowBinding = {
  runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userId: "22222222-2222-4222-8222-222222222222",
  circleId: "33333333-3333-4333-8333-333333333333",
};
const ROW_B: SwanBotContinuationCryptoRowBinding = {
  runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  userId: ROW_A.userId,
  circleId: ROW_A.circleId,
};

const optionsA: SwanBotContinuationCryptoOptions = {
  secret: SECRET_A,
  keyVersion: KEY_VERSION,
  crypto: nodeCrypto,
};

let assertions = 0;

function check(condition: unknown, label: string): asserts condition {
  assertions += 1;
  assert(condition, label);
}

function checkEqual<T>(actual: T, expected: T, label: string): void {
  assertions += 1;
  assert.equal(actual, expected, label);
}

function checkDeepEqual(actual: unknown, expected: unknown, label: string): void {
  assertions += 1;
  assert.deepEqual(actual, expected, label);
}

function serializeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = error instanceof SwanBotContinuationCryptoError ? error.code : "";
  return `${error.name}:${code}:${error.message}`;
}

async function captureCryptoError(
  action: () => Promise<unknown> | unknown,
  expectedCode: SwanBotContinuationCryptoErrorCode,
  label: string,
): Promise<SwanBotContinuationCryptoError> {
  try {
    await action();
  } catch (error) {
    assertions += 1;
    assert(error instanceof SwanBotContinuationCryptoError, `${label}: typed error`);
    checkEqual(error.code, expectedCode, `${label}: stable error code`);
    const rendered = serializeError(error);
    check(!rendered.includes(SECRET_A), `${label}: error omits encryption secret`);
    check(!rendered.includes(SECRET_B), `${label}: error omits wrong secret`);
    check(!rendered.includes(PRIVATE_VALUE), `${label}: error omits private value`);
    check(!rendered.includes(PRIVATE_PATH), `${label}: error omits private path`);
    check(!rendered.includes(ROW_A.runId), `${label}: error omits owning run id`);
    check(!rendered.includes(ROW_A.userId), `${label}: error omits owning user id`);
    check(!rendered.includes(ROW_A.circleId), `${label}: error omits owning circle id`);
    return error;
  }
  assert.fail(`${label}: expected a crypto error`);
}

function mutateCanonicalBase64(value: string): string {
  const index = value.search(/[A-Za-z0-9]/);
  assert(index >= 0, "ciphertext has a mutable base64 character");
  const replacement = value[index] === "A" ? "B" : "A";
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

function sealForRow<T extends Record<string, unknown>>(
  snapshot: T,
  options: SwanBotContinuationCryptoOptions = optionsA,
  rowBinding: SwanBotContinuationCryptoRowBinding = ROW_A,
) {
  return sealSwanBotContinuationSnapshot(snapshot, rowBinding, options);
}

function openForRow<T extends Record<string, unknown>>(
  envelope: unknown,
  options: SwanBotContinuationCryptoOptions = optionsA,
  rowBinding: SwanBotContinuationCryptoRowBinding = ROW_A,
) {
  return openSwanBotContinuationSnapshot<T>(envelope, rowBinding, options);
}

async function main(): Promise<void> {
  const snapshot = {
    continuationIdentity: "11111111-1111-4111-8111-111111111111",
    continuationVersion: 2,
    resumeState: "pending",
    iter: 3,
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu_private",
            name: "desktop.type_text",
            input: {
              text: PRIVATE_VALUE,
              path: PRIVATE_PATH,
              unicode: "résumé 🚀",
            },
          },
        ],
      },
    ],
    pendingToolUseIds: ["toolu_private"],
  };

  const first = await sealForRow(snapshot);
  const second = await sealForRow(snapshot);

  checkDeepEqual(
    Object.keys(first).sort(),
    [
      "algorithm",
      "ciphertextB64",
      "ivB64",
      "kdf",
      "keyVersion",
      "schemaVersion",
    ],
    "envelope contains only the strict public fields",
  );
  checkEqual(
    first.schemaVersion,
    SWANBOT_CONTINUATION_CRYPTO_SCHEMA_VERSION,
    "schema version is explicit",
  );
  checkEqual(first.algorithm, SWANBOT_CONTINUATION_CRYPTO_ALGORITHM, "AES-256-GCM is explicit");
  checkEqual(first.kdf, SWANBOT_CONTINUATION_CRYPTO_KDF, "SHA-256 KDF is explicit");
  checkEqual(first.keyVersion, KEY_VERSION, "rotation key version is explicit");
  checkEqual(
    atob(first.ivB64).length,
    SWANBOT_CONTINUATION_CRYPTO_IV_BYTES,
    "IV is exactly 96 bits",
  );
  check(first.ivB64 !== second.ivB64, "random IV changes for identical plaintext");
  check(
    first.ciphertextB64 !== second.ciphertextB64,
    "ciphertext changes for identical plaintext",
  );

  const serializedEnvelope = JSON.stringify(first);
  check(!serializedEnvelope.includes(PRIVATE_VALUE), "sealed envelope omits the raw private value");
  check(!serializedEnvelope.includes(PRIVATE_PATH), "sealed envelope omits the raw private path");
  check(!serializedEnvelope.includes(SECRET_A), "sealed envelope omits the encryption secret");
  check(!serializedEnvelope.includes("payroll-notes"), "sealed envelope omits private path basenames");
  check(!serializedEnvelope.includes(ROW_A.runId), "public envelope omits the owning run id");
  check(!serializedEnvelope.includes(ROW_A.userId), "public envelope omits the owning user id");
  check(!serializedEnvelope.includes(ROW_A.circleId), "public envelope omits the owning circle id");

  const parsedEnvelope = parseSwanBotContinuationCryptoEnvelope(first);
  checkDeepEqual(parsedEnvelope, first, "strict envelope parser preserves a valid envelope");
  const opened = await openForRow<typeof snapshot>(first);
  checkDeepEqual(opened, snapshot, "exact JSON snapshot round-trips through AES-GCM");

  const rowBEnvelope = await sealForRow(snapshot, optionsA, ROW_B);
  const rowATransplantError = await captureCryptoError(
    () => openForRow(first, optionsA, ROW_B),
    "continuation_crypto_open_failed",
    "row A ciphertext transplanted to row B",
  );
  const rowBTransplantError = await captureCryptoError(
    () => openForRow(rowBEnvelope, optionsA, ROW_A),
    "continuation_crypto_open_failed",
    "row B ciphertext transplanted to row A",
  );
  checkEqual(
    rowATransplantError.message,
    rowBTransplantError.message,
    "cross-row transplant directions expose one value-free failure",
  );
  checkDeepEqual(
    await openForRow<typeof snapshot>(first),
    snapshot,
    "failed cross-row transplant does not consume or alter the owning row ciphertext",
  );

  const tamperedCiphertext: SwanBotContinuationCryptoEnvelopeV1 = {
    ...first,
    ciphertextB64: mutateCanonicalBase64(first.ciphertextB64),
  };
  const tamperError = await captureCryptoError(
    () => openForRow(tamperedCiphertext),
    "continuation_crypto_open_failed",
    "ciphertext tamper",
  );
  const wrongKeyError = await captureCryptoError(
    () => openForRow(first, {
      ...optionsA,
      secret: SECRET_B,
    }),
    "continuation_crypto_open_failed",
    "wrong key",
  );
  checkEqual(
    tamperError.message,
    wrongKeyError.message,
    "tamper and wrong-key failures expose the same value-free message",
  );

  const tamperedAadEnvelope: SwanBotContinuationCryptoEnvelopeV1 = {
    ...first,
    keyVersion: "2026-08-rotated",
  };
  await captureCryptoError(
    () => openForRow(tamperedAadEnvelope, {
      ...optionsA,
      keyVersion: tamperedAadEnvelope.keyVersion,
    }),
    "continuation_crypto_open_failed",
    "authenticated key-version AAD tamper",
  );
  await captureCryptoError(
    () => openForRow(first, {
      ...optionsA,
      keyVersion: "2026-08-rotated",
    }),
    "continuation_crypto_key_version_mismatch",
    "caller key-version mismatch",
  );

  await captureCryptoError(
    () => openForRow({
      ...first,
      schemaVersion: 2,
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "unknown schema version",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      algorithm: "AES-CBC",
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "algorithm downgrade",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      kdf: "PBKDF2",
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "KDF substitution",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      keyVersion: "../private/key",
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "unsafe envelope key version",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      unexpected: "field",
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "unknown envelope field",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      ivB64: btoa("short"),
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "non-96-bit IV",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      ciphertextB64: "AAAA",
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "ciphertext shorter than the GCM tag",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      ciphertextB64: `${first.ciphertextB64}\n`,
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "non-canonical base64",
  );
  await captureCryptoError(
    () => openForRow({
      ...first,
      ciphertextB64: "A".repeat(
        SWANBOT_CONTINUATION_CRYPTO_MAX_CIPHERTEXT_B64_CHARS + 4,
      ),
    }, optionsA),
    "continuation_crypto_envelope_invalid",
    "oversized ciphertext envelope",
  );

  await captureCryptoError(
    () => sealForRow(snapshot, {
      ...optionsA,
      secret: "too-short",
    }),
    "continuation_crypto_secret_invalid",
    "short dedicated secret",
  );
  await captureCryptoError(
    () => sealForRow(snapshot, {
      ...optionsA,
      keyVersion: "../private/key",
    }),
    "continuation_crypto_key_version_invalid",
    "unsafe key version",
  );
  await captureCryptoError(
    () => sealForRow(snapshot, {
      ...optionsA,
      crypto: {} as Crypto,
    }),
    "continuation_crypto_unavailable",
    "missing Web Crypto primitives",
  );
  await captureCryptoError(
    () => sealSwanBotContinuationSnapshot(
      snapshot,
      { ...ROW_A, runId: ROW_A.runId.toUpperCase() },
      optionsA,
    ),
    "continuation_crypto_row_binding_invalid",
    "non-canonical row id",
  );
  await captureCryptoError(
    () => openSwanBotContinuationSnapshot(
      first,
      { ...ROW_A, extra: "not-authority" } as SwanBotContinuationCryptoRowBinding,
      optionsA,
    ),
    "continuation_crypto_row_binding_invalid",
    "unknown row-binding field",
  );
  await captureCryptoError(
    () => sealForRow(
      [] as unknown as Record<string, unknown>,
      optionsA,
    ),
    "continuation_crypto_snapshot_invalid",
    "non-object snapshot",
  );

  const cyclic: Record<string, unknown> = {
    privateValue: PRIVATE_VALUE,
    privatePath: PRIVATE_PATH,
  };
  cyclic.self = cyclic;
  await captureCryptoError(
    () => sealForRow(cyclic),
    "continuation_crypto_snapshot_invalid",
    "cyclic snapshot",
  );
  await captureCryptoError(
    () => sealForRow({
      oversized: "x".repeat(SWANBOT_CONTINUATION_CRYPTO_MAX_PLAINTEXT_BYTES + 1),
      privatePath: PRIVATE_PATH,
    }, optionsA),
    "continuation_crypto_snapshot_too_large",
    "oversized plaintext snapshot",
  );

  console.log(
    `swanbot-v2-continuation-crypto smoke passed (${assertions} assertions)`,
  );
}

main().catch((error) => {
  console.error(serializeError(error));
  process.exitCode = 1;
});
