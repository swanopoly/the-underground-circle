import {
  deleteVerifiedLocalSecret,
  readVerifiedLocalSecret,
  writeVerifiedLocalSecret,
} from './localSecrets';
import {
  deleteOpenSwanApprovalResumeExactCallLeases,
  registerOpenSwanApprovalResumeExactCallLease,
  type OpenSwanApprovalResumeExactCallLeaseInput,
} from './openSwanApprovalResumeAuthority';
import {
  normalizeOpenSwanApprovalResumeBindingV1,
  type OpenSwanApprovalResumeBindingV1,
} from './openswanToolApprovals';
import { Platform } from 'react-native';

/**
 * Device-local custody for generic approval-resume arguments.
 *
 * The durable database row remains value-free. This outbox is the temporary
 * complementary value store: native uses the OS SecureStore, while web accepts
 * only the AES-GCM localSecrets path. Browser encryption protects data at rest;
 * it does not make authority safe from code already executing in the origin
 * (for example, XSS). Every mutation is read back, parsed, and rehashed before
 * it is acknowledged. There is no plaintext or AsyncStorage fallback.
 */

const OUTBOX_NAMESPACE = 'openswan_approval_resume_outbox_v1';
const OUTBOX_ID = 'exact_calls';
const OUTBOX_WEB_LOCK = 'uc.openswan.approval-resume-outbox.v1';
const OUTBOX_SCHEMA_VERSION = 1 as const;
const OUTBOX_KIND = 'openswan_approval_resume_exact_calls' as const;
const ENVELOPE_KIND = 'openswan_approval_resume_exact_call' as const;
const MAX_ENTRIES = 64;
const MAX_SERIALIZED_BYTES = 1_000_000;
const MAX_ARGS_BYTES = 256_000;
const MAX_DEPTH = 20;
const MAX_NODES = 4_096;
const MAX_CONTAINER_KEYS = 512;
const MAX_STRING_LENGTH = 200_000;
const MAX_EXPIRY_AHEAD_MS = 86_400_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const APPROVAL_DIGEST_RE = /^approval-v2:sha256:[0-9a-f]{64}$/;
const NONCE_RE = /^nonce-v1:[0-9a-f]{64}$/;
const PAYLOAD_DIGEST_RE = /^outbox-v1:sha256:[0-9a-f]{64}$/;

const OUTBOX_KEYS = new Set(['schemaVersion', 'kind', 'revision', 'entries']);
const ENVELOPE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'approvalId',
  'sourceRunId',
  'userId',
  'circleId',
  'threadId',
  'sourceUserMessageId',
  'toolName',
  'toolApprovalDigest',
  'sourceToolUseId',
  'sourceIteration',
  'sourceCallOrdinal',
  'args',
  'expiresAtMs',
  'nonce',
  'payloadSha256',
]);

type ExactCallEnvelopePayload = Readonly<{
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  kind: typeof ENVELOPE_KIND;
  approvalId: string;
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
  sourceUserMessageId: string;
  toolName: string;
  toolApprovalDigest: string;
  sourceToolUseId: string;
  sourceIteration: number;
  sourceCallOrdinal: number;
  args: Readonly<Record<string, unknown>>;
  expiresAtMs: number;
  nonce: string;
}>;

type ExactCallEnvelope = ExactCallEnvelopePayload & Readonly<{
  payloadSha256: string;
}>;

type StoredOutbox = Readonly<{
  schemaVersion: typeof OUTBOX_SCHEMA_VERSION;
  kind: typeof OUTBOX_KIND;
  revision: number;
  entries: Readonly<Record<string, ExactCallEnvelope>>;
}>;

type OutboxReadResult =
  | Readonly<{ status: 'ready'; outbox: StoredOutbox }>
  | Readonly<{ status: 'blocked'; reason: OpenSwanApprovalResumeOutboxBlockReason }>;

export type OpenSwanApprovalResumeOutboxCall = OpenSwanApprovalResumeExactCallLeaseInput;

export type OpenSwanApprovalResumeOutboxBlockReason =
  | 'invalid_request'
  | 'storage_unavailable'
  | 'storage_invalid'
  | 'storage_write_failed'
  | 'expiry_cleanup_failed'
  | 'missing_exact_call'
  | 'scope_mismatch'
  | 'authority_registration_failed';

export type OpenSwanApprovalResumeOutboxListResult =
  | Readonly<{
      status: 'ready';
      calls: readonly OpenSwanApprovalResumeOutboxCall[];
      missingApprovalIds: readonly string[];
    }>
  | Readonly<{
      status: 'blocked';
      reason: OpenSwanApprovalResumeOutboxBlockReason;
      calls: readonly [];
      missingApprovalIds: readonly string[];
    }>;

export type OpenSwanApprovalResumeOutboxRestoreResult =
  | Readonly<{
      status: 'ready';
      restoredApprovalIds: readonly string[];
      missingApprovalIds: readonly string[];
    }>
  | Readonly<{
      status: 'blocked';
      reason: OpenSwanApprovalResumeOutboxBlockReason;
      restoredApprovalIds: readonly [];
      missingApprovalIds: readonly string[];
    }>;

export type OpenSwanApprovalResumeOutboxClaimResult =
  | Readonly<{ kind: 'claimed'; calls: readonly OpenSwanApprovalResumeOutboxCall[] }>
  | Readonly<{
      kind: 'unavailable';
      reason: OpenSwanApprovalResumeOutboxBlockReason;
      missingApprovalIds: readonly string[];
    }>;

type ScopeInput = Readonly<{
  userId: string;
  circleId: string;
  threadId?: string | null;
  sourceUserMessageId?: string | null;
}>;

let operationTail: Promise<void> = Promise.resolve();
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let authAuthorityEpoch = 1;
let authAuthorityOpen = true;

/**
 * Synchronously fence every pending/future exact-call operation before logout
 * starts asynchronous cleanup. Operations capture the epoch before waiting on
 * Web Locks/SecureStore and must recheck it under that lock before committing.
 */
export function closeOpenSwanApprovalResumeOutboxAuthorityForLogout(): number {
  authAuthorityOpen = false;
  authAuthorityEpoch += 1;
  deleteOpenSwanApprovalResumeExactCallLeases();
  return authAuthorityEpoch;
}

/** Re-open only after App has server-validated a newly authenticated session. */
export function openOpenSwanApprovalResumeOutboxAuthorityForSession(): number {
  authAuthorityEpoch += 1;
  authAuthorityOpen = true;
  return authAuthorityEpoch;
}

function captureOpenSwanApprovalResumeAuthAuthority(): number | null {
  return authAuthorityOpen ? authAuthorityEpoch : null;
}

function hasOpenSwanApprovalResumeAuthAuthority(epoch: number | null): boolean {
  return epoch !== null && authAuthorityOpen && epoch === authAuthorityEpoch;
}

function runSerialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation, operation);
  operationTail = result.then(() => undefined, () => undefined);
  return result;
}

type WebLockManager = Readonly<{
  request<T>(
    name: string,
    options: Readonly<{ mode: 'exclusive' }>,
    callback: () => Promise<T>,
  ): Promise<T>;
}>;

/** Browser tabs share storage but not the module-local promise queue. */
function runExclusive<T>(
  operation: () => Promise<T>,
  unavailable: () => T,
): Promise<T> {
  return runSerialized(async () => {
    if (Platform.OS !== 'web') return operation();
    try {
      const locks = (globalThis as unknown as {
        navigator?: { locks?: WebLockManager };
      }).navigator?.locks;
      if (!locks || typeof locks.request !== 'function') return unavailable();
      return await locks.request(
        OUTBOX_WEB_LOCK,
        { mode: 'exclusive' },
        operation,
      );
    } catch {
      return unavailable();
    }
  });
}

function exactRecord(value: unknown, keys: ReadonlySet<string>): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.size
      || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
    ) return null;
    const record: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

function cloneJsonData(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH || state.nodes >= MAX_NODES) {
    throw new Error('approval_resume_outbox_args_too_large');
  }
  state.nodes += 1;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new Error('approval_resume_outbox_string_too_large');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error('approval_resume_outbox_number_invalid');
    }
    return value;
  }
  if (typeof value !== 'object') throw new Error('approval_resume_outbox_non_json_value');

  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || value.length > MAX_CONTAINER_KEYS) {
      throw new Error('approval_resume_outbox_array_invalid');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= value.length;
    })) throw new Error('approval_resume_outbox_array_key_invalid');
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('approval_resume_outbox_sparse_or_accessor_array');
      }
      clone.push(cloneJsonData(descriptor.value, state, depth + 1));
    }
    return Object.freeze(clone);
  }

  if (proto !== Object.prototype && proto !== null) {
    throw new Error('approval_resume_outbox_object_invalid');
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length > MAX_CONTAINER_KEYS
    || ownKeys.some((key) => typeof key !== 'string')
  ) throw new Error('approval_resume_outbox_object_keys_invalid');
  const clone: Record<string, unknown> = Object.create(null);
  for (const key of (ownKeys as string[]).sort()) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('approval_resume_outbox_unsafe_key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('approval_resume_outbox_accessor');
    }
    clone[key] = cloneJsonData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(clone);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('non_json_value');
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        codePoint = 0xfffd;
      }
    } else if (codePoint >= 0xdc00 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

function sha256Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((highBits >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((lowBits >>> shift) & 0xff);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const rotateRight = (word: number, count: number): number => (
    (word >>> count) | (word << (32 - count))
  );
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let word = 0; word < 16; word += 1) {
      const start = offset + word * 4;
      words[word] = (
        (bytes[start]! << 24)
        | (bytes[start + 1]! << 16)
        | (bytes[start + 2]! << 8)
        | bytes[start + 3]!
      ) >>> 0;
    }
    for (let word = 16; word < 64; word += 1) {
      const first = words[word - 15]!;
      const second = words[word - 2]!;
      const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
      const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
      words[word] = (words[word - 16]! + sigma0 + words[word - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let round = 0; round < 64; round += 1) {
      const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choose + constants[round]! + words[round]!) >>> 0;
      const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d! + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}

function byteLength(value: string): number {
  return utf8Bytes(value).length;
}

function randomNonce(): string {
  try {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.getRandomValues !== 'function') return '';
    const bytes = new Uint8Array(32);
    cryptoApi.getRandomValues(bytes);
    const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `nonce-v1:${hex}`;
  } catch {
    return '';
  }
}

function normalizeCallInput(
  input: OpenSwanApprovalResumeOutboxCall,
  nowMs: number,
): OpenSwanApprovalResumeOutboxCall | null {
  try {
    if (
      !UUID_RE.test(input.approvalId)
      || !UUID_RE.test(input.sourceRunId)
      || !UUID_RE.test(input.userId)
    || !UUID_RE.test(input.circleId)
    || !UUID_RE.test(input.threadId)
      || !UUID_RE.test(input.sourceUserMessageId)
      || !CALL_ID_RE.test(input.toolName)
      || !APPROVAL_DIGEST_RE.test(input.toolApprovalDigest)
      || !CALL_ID_RE.test(input.sourceToolUseId)
      || !Number.isInteger(input.sourceIteration)
      || input.sourceIteration < 1
      || input.sourceIteration > 1_000
      || !Number.isInteger(input.sourceCallOrdinal)
      || input.sourceCallOrdinal < 1
      || input.sourceCallOrdinal > 1_000
      || !Number.isSafeInteger(input.expiresAtMs)
      || input.expiresAtMs <= nowMs
      || input.expiresAtMs > nowMs + MAX_EXPIRY_AHEAD_MS
    ) return null;
    const args = cloneJsonData(input.args, { nodes: 0 });
    if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
    if (byteLength(canonicalJson(args)) > MAX_ARGS_BYTES) return null;
    return Object.freeze({
      approvalId: input.approvalId,
      sourceRunId: input.sourceRunId,
      userId: input.userId,
      circleId: input.circleId,
      threadId: input.threadId,
      sourceUserMessageId: input.sourceUserMessageId,
      toolName: input.toolName,
      toolApprovalDigest: input.toolApprovalDigest,
      sourceToolUseId: input.sourceToolUseId,
      sourceIteration: input.sourceIteration,
      sourceCallOrdinal: input.sourceCallOrdinal,
      args: args as Readonly<Record<string, unknown>>,
      expiresAtMs: input.expiresAtMs,
    });
  } catch {
    return null;
  }
}

function envelopePayload(call: OpenSwanApprovalResumeOutboxCall, nonce: string): ExactCallEnvelopePayload {
  return Object.freeze({
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    kind: ENVELOPE_KIND,
    approvalId: call.approvalId,
    sourceRunId: call.sourceRunId,
    userId: call.userId,
    circleId: call.circleId,
    threadId: call.threadId,
    sourceUserMessageId: call.sourceUserMessageId,
    toolName: call.toolName,
    toolApprovalDigest: call.toolApprovalDigest,
    sourceToolUseId: call.sourceToolUseId,
    sourceIteration: call.sourceIteration,
    sourceCallOrdinal: call.sourceCallOrdinal,
    args: call.args,
    expiresAtMs: call.expiresAtMs,
    nonce,
  });
}

function buildEnvelope(call: OpenSwanApprovalResumeOutboxCall): ExactCallEnvelope | null {
  const nonce = randomNonce();
  if (!NONCE_RE.test(nonce)) return null;
  const payload = envelopePayload(call, nonce);
  return Object.freeze({
    ...payload,
    payloadSha256: `outbox-v1:sha256:${sha256Hex(canonicalJson(payload))}`,
  });
}

function parseEnvelope(value: unknown, keyedApprovalId: string): ExactCallEnvelope | null {
  const record = exactRecord(value, ENVELOPE_KEYS);
  if (!record) return null;
  if (
    typeof record.approvalId !== 'string'
    || typeof record.sourceRunId !== 'string'
    || typeof record.userId !== 'string'
    || typeof record.circleId !== 'string'
    || typeof record.threadId !== 'string'
    || typeof record.sourceUserMessageId !== 'string'
    || typeof record.toolName !== 'string'
    || typeof record.toolApprovalDigest !== 'string'
    || typeof record.sourceToolUseId !== 'string'
    || typeof record.sourceIteration !== 'number'
    || typeof record.sourceCallOrdinal !== 'number'
    || typeof record.expiresAtMs !== 'number'
  ) return null;
  const provisional = normalizeCallInput({
    approvalId: record.approvalId,
    sourceRunId: record.sourceRunId,
    userId: record.userId,
    circleId: record.circleId,
    threadId: record.threadId,
    sourceUserMessageId: record.sourceUserMessageId,
    toolName: record.toolName,
    toolApprovalDigest: record.toolApprovalDigest,
    sourceToolUseId: record.sourceToolUseId,
    sourceIteration: record.sourceIteration,
    sourceCallOrdinal: record.sourceCallOrdinal,
    args: record.args as Record<string, unknown>,
    expiresAtMs: record.expiresAtMs,
  }, record.expiresAtMs - MAX_EXPIRY_AHEAD_MS);
  const nonce = typeof record.nonce === 'string' ? record.nonce : '';
  const payloadSha256 = typeof record.payloadSha256 === 'string' ? record.payloadSha256 : '';
  if (
    record.schemaVersion !== OUTBOX_SCHEMA_VERSION
    || record.kind !== ENVELOPE_KIND
    || !provisional
    || provisional.approvalId !== keyedApprovalId
    || !NONCE_RE.test(nonce)
    || !PAYLOAD_DIGEST_RE.test(payloadSha256)
  ) return null;
  const payload = envelopePayload(provisional, nonce);
  if (`outbox-v1:sha256:${sha256Hex(canonicalJson(payload))}` !== payloadSha256) return null;
  return Object.freeze({ ...payload, payloadSha256 });
}

function emptyOutbox(): StoredOutbox {
  return Object.freeze({
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    kind: OUTBOX_KIND,
    revision: 0,
    entries: Object.freeze(Object.create(null) as Record<string, ExactCallEnvelope>),
  });
}

function makeOutbox(revision: number, entries: Record<string, ExactCallEnvelope>): StoredOutbox {
  const sorted: Record<string, ExactCallEnvelope> = Object.create(null);
  for (const approvalId of Object.keys(entries).sort()) sorted[approvalId] = entries[approvalId]!;
  return Object.freeze({
    schemaVersion: OUTBOX_SCHEMA_VERSION,
    kind: OUTBOX_KIND,
    revision,
    entries: Object.freeze(sorted),
  });
}

function parseOutbox(serialized: string): StoredOutbox | null {
  try {
    if (!serialized || byteLength(serialized) > MAX_SERIALIZED_BYTES) return null;
    const parsed = JSON.parse(serialized) as unknown;
    const record = exactRecord(parsed, OUTBOX_KEYS);
    if (
      !record
      || record.schemaVersion !== OUTBOX_SCHEMA_VERSION
      || record.kind !== OUTBOX_KIND
      || !Number.isSafeInteger(record.revision)
      || Number(record.revision) < 1
      || !record.entries
      || typeof record.entries !== 'object'
      || Array.isArray(record.entries)
    ) return null;
    const entryRecord = record.entries as Record<string, unknown>;
    const proto = Object.getPrototypeOf(entryRecord);
    const approvalIds = Reflect.ownKeys(entryRecord);
    if (
      (proto !== Object.prototype && proto !== null)
      || approvalIds.length < 1
      || approvalIds.length > MAX_ENTRIES
      || approvalIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))
    ) return null;
    const entries: Record<string, ExactCallEnvelope> = Object.create(null);
    const seenPositions = new Set<string>();
    for (const approvalId of (approvalIds as string[]).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(entryRecord, approvalId);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      const envelope = parseEnvelope(descriptor.value, approvalId);
      if (!envelope) return null;
      const position = [
        envelope.sourceRunId,
        envelope.sourceIteration,
        envelope.sourceCallOrdinal,
      ].join(':');
      if (seenPositions.has(position)) return null;
      seenPositions.add(position);
      entries[approvalId] = envelope;
    }
    return makeOutbox(Number(record.revision), entries);
  } catch {
    return null;
  }
}

function envelopeToCall(envelope: ExactCallEnvelope): OpenSwanApprovalResumeOutboxCall {
  return Object.freeze({
    approvalId: envelope.approvalId,
    sourceRunId: envelope.sourceRunId,
    userId: envelope.userId,
    circleId: envelope.circleId,
    threadId: envelope.threadId,
    sourceUserMessageId: envelope.sourceUserMessageId,
    toolName: envelope.toolName,
    toolApprovalDigest: envelope.toolApprovalDigest,
    sourceToolUseId: envelope.sourceToolUseId,
    sourceIteration: envelope.sourceIteration,
    sourceCallOrdinal: envelope.sourceCallOrdinal,
    args: envelope.args,
    expiresAtMs: envelope.expiresAtMs,
  });
}

async function readOutbox(): Promise<OutboxReadResult> {
  const secret = await readVerifiedLocalSecret(OUTBOX_NAMESPACE, OUTBOX_ID);
  if (secret.status === 'missing') return Object.freeze({ status: 'ready', outbox: emptyOutbox() });
  if (secret.status !== 'found') {
    return Object.freeze({
      status: 'blocked',
      reason: secret.status === 'unavailable' ? 'storage_unavailable' : 'storage_invalid',
    });
  }
  const outbox = parseOutbox(secret.value);
  return outbox
    ? Object.freeze({ status: 'ready' as const, outbox })
    : Object.freeze({ status: 'blocked' as const, reason: 'storage_invalid' as const });
}

function scheduleExpiry(outbox: StoredOutbox): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const earliest = Object.values(outbox.entries)
    .reduce((value, entry) => Math.min(value, entry.expiresAtMs), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(earliest)) return;
  const delay = Math.max(0, Math.min(earliest - Date.now() + 1, 2_147_000_000));
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    void sweepExpiredOpenSwanApprovalResumeOutboxCalls();
  }, delay);
  (expiryTimer as unknown as { unref?: () => void }).unref?.();
}

async function writeOutbox(outbox: StoredOutbox): Promise<boolean> {
  const approvalIds = Object.keys(outbox.entries);
  if (approvalIds.length === 0) {
    const deleted = await deleteVerifiedLocalSecret(OUTBOX_NAMESPACE, OUTBOX_ID);
    if (deleted && expiryTimer) clearTimeout(expiryTimer);
    if (deleted) expiryTimer = null;
    return deleted;
  }
  const serialized = canonicalJson(outbox);
  if (byteLength(serialized) > MAX_SERIALIZED_BYTES) return false;
  if (!await writeVerifiedLocalSecret(OUTBOX_NAMESPACE, OUTBOX_ID, serialized)) return false;

  // The localSecrets write verifies exact plaintext. Parse and rehash again at
  // this boundary so an acknowledgement proves the closed outbox schema too.
  const readback = await readVerifiedLocalSecret(OUTBOX_NAMESPACE, OUTBOX_ID);
  if (readback.status !== 'found') return false;
  const verified = parseOutbox(readback.value);
  if (!verified || canonicalJson(verified) !== serialized) return false;
  scheduleExpiry(verified);
  return true;
}

async function readAndSweep(nowMs: number): Promise<OutboxReadResult> {
  const read = await readOutbox();
  if (read.status === 'blocked') return read;
  const expired = Object.values(read.outbox.entries)
    .filter((entry) => entry.expiresAtMs <= nowMs)
    .map((entry) => entry.approvalId);
  if (expired.length === 0) {
    scheduleExpiry(read.outbox);
    return read;
  }
  const entries: Record<string, ExactCallEnvelope> = Object.create(null);
  for (const [approvalId, entry] of Object.entries(read.outbox.entries)) {
    if (entry.expiresAtMs > nowMs) entries[approvalId] = entry;
  }
  const next = makeOutbox(read.outbox.revision + 1, entries);
  if (!await writeOutbox(next)) {
    return Object.freeze({ status: 'blocked', reason: 'expiry_cleanup_failed' });
  }
  deleteOpenSwanApprovalResumeExactCallLeases(expired);
  return Object.freeze({ status: 'ready', outbox: next });
}

function validScope(scope: ScopeInput): boolean {
  return UUID_RE.test(scope.userId)
    && UUID_RE.test(scope.circleId)
    && (scope.threadId == null || UUID_RE.test(scope.threadId))
    && (scope.sourceUserMessageId == null || UUID_RE.test(scope.sourceUserMessageId));
}

function matchesScope(entry: ExactCallEnvelope, scope: ScopeInput): boolean {
  return entry.userId === scope.userId
    && entry.circleId === scope.circleId
    && (scope.threadId == null || entry.threadId === scope.threadId)
    && (scope.sourceUserMessageId == null
      || entry.sourceUserMessageId === scope.sourceUserMessageId);
}

function normalizedApprovalIds(value: readonly string[] | null | undefined): readonly string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_ENTRIES) return null;
  const ids = value.map((id) => String(id || ''));
  if (ids.some((id) => !UUID_RE.test(id)) || new Set(ids).size !== ids.length) return null;
  return Object.freeze(ids);
}

function sameCall(a: OpenSwanApprovalResumeOutboxCall, b: OpenSwanApprovalResumeOutboxCall): boolean {
  return a.approvalId === b.approvalId
    && a.sourceRunId === b.sourceRunId
    && a.userId === b.userId
    && a.circleId === b.circleId
    && a.threadId === b.threadId
    && a.sourceUserMessageId === b.sourceUserMessageId
    && a.toolName === b.toolName
    && a.toolApprovalDigest === b.toolApprovalDigest
    && a.sourceToolUseId === b.sourceToolUseId
    && a.sourceIteration === b.sourceIteration
    && a.sourceCallOrdinal === b.sourceCallOrdinal
    && a.expiresAtMs === b.expiresAtMs
    && canonicalJson(a.args) === canonicalJson(b.args);
}

/** Persist one exact call only after protected write/read/schema/hash proof. */
export function persistAndVerifyOpenSwanApprovalResumeOutboxCall(
  input: OpenSwanApprovalResumeOutboxCall,
  nowMs = Date.now(),
): Promise<boolean> {
  const authorityEpoch = captureOpenSwanApprovalResumeAuthAuthority();
  return runExclusive(async () => {
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) return false;
    const call = normalizeCallInput(input, nowMs);
    if (!call) return false;
    const read = await readAndSweep(nowMs);
    if (read.status === 'blocked') return false;
    const existing = read.outbox.entries[call.approvalId];
    if (existing) return sameCall(envelopeToCall(existing), call);
    if (Object.keys(read.outbox.entries).length >= MAX_ENTRIES) return false;
    const duplicateSourcePosition = Object.values(read.outbox.entries).some((entry) => (
      entry.sourceRunId === call.sourceRunId
      && entry.sourceIteration === call.sourceIteration
      && entry.sourceCallOrdinal === call.sourceCallOrdinal
    ));
    if (duplicateSourcePosition) return false;
    const envelope = buildEnvelope(call);
    if (!envelope) return false;
    const entries = { ...read.outbox.entries, [call.approvalId]: envelope };
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) return false;
    const written = await writeOutbox(makeOutbox(read.outbox.revision + 1, entries));
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) {
      await deleteVerifiedLocalSecret(OUTBOX_NAMESPACE, OUTBOX_ID);
      return false;
    }
    return written;
  }, () => false);
}

/**
 * List exact calls for one authenticated scope. Passing approval ids preserves
 * their requested order and reports every absent id; an unfiltered list uses
 * original provider source order. Expired entries are deleted first.
 */
export function listOpenSwanApprovalResumeOutboxCalls(input: ScopeInput & Readonly<{
  approvalIds?: readonly string[] | null;
  nowMs?: number;
}>): Promise<OpenSwanApprovalResumeOutboxListResult> {
  const authorityEpoch = captureOpenSwanApprovalResumeAuthAuthority();
  return runExclusive(async () => {
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) {
      return Object.freeze({
        status: 'blocked' as const,
        reason: 'storage_unavailable' as const,
        calls: Object.freeze([]) as readonly [],
        missingApprovalIds: Object.freeze(input.approvalIds ? [...input.approvalIds] : []),
      });
    }
    const nowMs = input.nowMs ?? Date.now();
    if (!validScope(input)) {
      return Object.freeze({
        status: 'blocked' as const,
        reason: 'invalid_request' as const,
        calls: Object.freeze([]) as readonly [],
        missingApprovalIds: Object.freeze([]),
      });
    }
    const requested = input.approvalIds == null ? null : normalizedApprovalIds(input.approvalIds);
    if (input.approvalIds != null && !requested) {
      return Object.freeze({
        status: 'blocked' as const,
        reason: 'invalid_request' as const,
        calls: Object.freeze([]) as readonly [],
        missingApprovalIds: Object.freeze([]),
      });
    }
    const read = await readAndSweep(nowMs);
    if (read.status === 'blocked') {
      return Object.freeze({
        status: 'blocked' as const,
        reason: read.reason,
        calls: Object.freeze([]) as readonly [],
        missingApprovalIds: Object.freeze(requested ? [...requested] : []),
      });
    }
    const ids = requested || Object.values(read.outbox.entries)
      .filter((entry) => matchesScope(entry, input))
      .sort((a, b) => (
        a.sourceIteration - b.sourceIteration
        || a.sourceCallOrdinal - b.sourceCallOrdinal
        || a.approvalId.localeCompare(b.approvalId)
      ))
      .map((entry) => entry.approvalId);
    const calls: OpenSwanApprovalResumeOutboxCall[] = [];
    const missing: string[] = [];
    for (const approvalId of ids) {
      const entry = read.outbox.entries[approvalId];
      if (!entry || !matchesScope(entry, input)) missing.push(approvalId);
      else calls.push(envelopeToCall(entry));
    }
    return Object.freeze({
      status: 'ready' as const,
      calls: Object.freeze(calls),
      missingApprovalIds: Object.freeze(missing),
    });
  }, () => Object.freeze({
    status: 'blocked' as const,
    reason: 'storage_unavailable' as const,
    calls: Object.freeze([]) as readonly [],
    missingApprovalIds: Object.freeze(input.approvalIds ? [...input.approvalIds] : []),
  }));
}

/**
 * Reload exact calls into the process-private authority without consuming the
 * device copy. A requested set is all-or-nothing; partial registration is
 * rolled back so an approved batch can never degrade into a partial replay.
 */
export async function restoreOpenSwanApprovalResumeOutboxIntoProcessAuthority(
  input: ScopeInput & Readonly<{
    approvalIds?: readonly string[] | null;
    nowMs?: number;
  }>,
): Promise<OpenSwanApprovalResumeOutboxRestoreResult> {
  const listed = await listOpenSwanApprovalResumeOutboxCalls(input);
  if (listed.status === 'blocked') {
    return Object.freeze({
      status: 'blocked',
      reason: listed.reason,
      restoredApprovalIds: Object.freeze([]) as readonly [],
      missingApprovalIds: listed.missingApprovalIds,
    });
  }
  if (listed.missingApprovalIds.length > 0) {
    return Object.freeze({
      status: 'blocked',
      reason: 'missing_exact_call',
      restoredApprovalIds: Object.freeze([]) as readonly [],
      missingApprovalIds: listed.missingApprovalIds,
    });
  }
  const restored: string[] = [];
  for (const call of listed.calls) {
    if (!registerOpenSwanApprovalResumeExactCallLease(call, input.nowMs ?? Date.now())) {
      deleteOpenSwanApprovalResumeExactCallLeases(restored);
      return Object.freeze({
        status: 'blocked',
        reason: 'authority_registration_failed',
        restoredApprovalIds: Object.freeze([]) as readonly [],
        missingApprovalIds: Object.freeze([]),
      });
    }
    restored.push(call.approvalId);
  }
  return Object.freeze({
    status: 'ready',
    restoredApprovalIds: Object.freeze(restored),
    missingApprovalIds: Object.freeze([]),
  });
}

async function removeExactEntries(input: ScopeInput & Readonly<{
  approvalIds: readonly string[];
  nowMs?: number;
}>): Promise<OpenSwanApprovalResumeOutboxListResult> {
  const nowMs = input.nowMs ?? Date.now();
  if (!validScope(input)) {
    return Object.freeze({
      status: 'blocked',
      reason: 'invalid_request',
      calls: Object.freeze([]) as readonly [],
      missingApprovalIds: Object.freeze([]),
    });
  }
  const approvalIds = normalizedApprovalIds(input.approvalIds);
  if (!approvalIds) {
    return Object.freeze({
      status: 'blocked',
      reason: 'invalid_request',
      calls: Object.freeze([]) as readonly [],
      missingApprovalIds: Object.freeze([]),
    });
  }
  const read = await readAndSweep(nowMs);
  if (read.status === 'blocked') {
    return Object.freeze({
      status: 'blocked',
      reason: read.reason,
      calls: Object.freeze([]) as readonly [],
      missingApprovalIds: Object.freeze([...approvalIds]),
    });
  }
  const calls: OpenSwanApprovalResumeOutboxCall[] = [];
  const missing: string[] = [];
  let mismatched = false;
  for (const approvalId of approvalIds) {
    const entry = read.outbox.entries[approvalId];
    if (!entry) missing.push(approvalId);
    else if (!matchesScope(entry, input)) mismatched = true;
    else calls.push(envelopeToCall(entry));
  }
  if (missing.length > 0 || mismatched) {
    return Object.freeze({
      status: 'blocked',
      reason: mismatched ? 'scope_mismatch' : 'missing_exact_call',
      calls: Object.freeze([]) as readonly [],
      missingApprovalIds: Object.freeze(missing),
    });
  }
  const entries: Record<string, ExactCallEnvelope> = Object.create(null);
  const removed = new Set(approvalIds);
  for (const [approvalId, entry] of Object.entries(read.outbox.entries)) {
    if (!removed.has(approvalId)) entries[approvalId] = entry;
  }
  if (!await writeOutbox(makeOutbox(read.outbox.revision + 1, entries))) {
    return Object.freeze({
      status: 'blocked',
      reason: 'storage_write_failed',
      calls: Object.freeze([]) as readonly [],
      missingApprovalIds: Object.freeze([]),
    });
  }
  return Object.freeze({
    status: 'ready',
    calls: Object.freeze(calls),
    missingApprovalIds: Object.freeze([]),
  });
}

/**
 * Claim a complete approved binding from device storage. Exact calls are
 * returned only after verified deletion; callers may then enter the canonical
 * process-authority/DB-consume/dispatch path. No model reconstruction occurs.
 */
export function claimOpenSwanApprovalResumeOutboxCalls(input: Readonly<{
  binding: OpenSwanApprovalResumeBindingV1;
  currentRunId: string;
  sourceUserMessageId: string;
  nowMs?: number;
}>): Promise<OpenSwanApprovalResumeOutboxClaimResult> {
  const authorityEpoch = captureOpenSwanApprovalResumeAuthAuthority();
  return runExclusive(async () => {
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) {
      return Object.freeze({
        kind: 'unavailable' as const,
        reason: 'storage_unavailable' as const,
        missingApprovalIds: Object.freeze([]),
      });
    }
    const binding = normalizeOpenSwanApprovalResumeBindingV1(input.binding);
    if (
      !binding
      || !UUID_RE.test(input.currentRunId)
      || !UUID_RE.test(input.sourceUserMessageId)
      || input.currentRunId === binding.sourceRunId
    ) {
      return Object.freeze({
        kind: 'unavailable' as const,
        reason: 'invalid_request' as const,
        missingApprovalIds: Object.freeze([]),
      });
    }
    const removed = await removeExactEntries({
      userId: binding.userId,
      circleId: binding.circleId,
      threadId: binding.threadId,
      sourceUserMessageId: input.sourceUserMessageId,
      approvalIds: binding.approvals.map((item) => item.approvalId),
      nowMs: input.nowMs,
    });
    if (removed.status === 'blocked') {
      return Object.freeze({
        kind: 'unavailable' as const,
        reason: removed.reason,
        missingApprovalIds: removed.missingApprovalIds,
      });
    }
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) {
      deleteOpenSwanApprovalResumeExactCallLeases(removed.calls.map((call) => call.approvalId));
      return Object.freeze({
        kind: 'unavailable' as const,
        reason: 'storage_unavailable' as const,
        missingApprovalIds: Object.freeze([]),
      });
    }
    const byId = new Map(removed.calls.map((call) => [call.approvalId, call]));
    const matches = binding.approvals.every((item) => {
      const call = byId.get(item.approvalId);
      return call?.sourceRunId === binding.sourceRunId
        && call.toolName === item.toolName
        && call.toolApprovalDigest === item.toolApprovalDigest;
    });
    if (!matches) {
      // Values are intentionally not restored after a scope/digest mismatch.
      // Losing authority is safer than making a rejected one-shot claim replayable.
      deleteOpenSwanApprovalResumeExactCallLeases(removed.calls.map((call) => call.approvalId));
      return Object.freeze({
        kind: 'unavailable' as const,
        reason: 'scope_mismatch' as const,
        missingApprovalIds: Object.freeze([]),
      });
    }
    const calls = [...removed.calls].sort((a, b) => (
      a.sourceIteration - b.sourceIteration
      || a.sourceCallOrdinal - b.sourceCallOrdinal
      || a.approvalId.localeCompare(b.approvalId)
    ));
    // Protected storage is already verified absent. Clear any same-process
    // cache before returning the one-shot values; the production caller must
    // explicitly re-register this returned set before the canonical claim.
    deleteOpenSwanApprovalResumeExactCallLeases(calls.map((call) => call.approvalId));
    return Object.freeze({ kind: 'claimed' as const, calls: Object.freeze(calls) });
  }, () => Object.freeze({
    kind: 'unavailable' as const,
    reason: 'storage_unavailable' as const,
    missingApprovalIds: Object.freeze([]),
  }));
}

/** Reject/cancel an exact set and remove both device and process custody. */
export function deleteOpenSwanApprovalResumeOutboxCalls(input: ScopeInput & Readonly<{
  approvalIds: readonly string[];
  nowMs?: number;
}>): Promise<boolean> {
  const authorityEpoch = captureOpenSwanApprovalResumeAuthAuthority();
  return runExclusive(async () => {
    if (!hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)) return false;
    const removed = await removeExactEntries(input);
    if (removed.status === 'blocked') return false;
    deleteOpenSwanApprovalResumeExactCallLeases(removed.calls.map((call) => call.approvalId));
    return true;
  }, () => false);
}

/** Delete expired device entries and their corresponding process leases. */
export function sweepExpiredOpenSwanApprovalResumeOutboxCalls(
  nowMs = Date.now(),
): Promise<boolean> {
  const authorityEpoch = captureOpenSwanApprovalResumeAuthAuthority();
  return runExclusive(
    async () => hasOpenSwanApprovalResumeAuthAuthority(authorityEpoch)
      && (await readAndSweep(nowMs)).status === 'ready',
    () => false,
  );
}

/** Logout boundary: remove the single protected outbox and all process leases. */
export function clearOpenSwanApprovalResumeOutboxForLogout(): Promise<boolean> {
  return runExclusive(async () => {
    const deleted = await deleteVerifiedLocalSecret(OUTBOX_NAMESPACE, OUTBOX_ID);
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    deleteOpenSwanApprovalResumeExactCallLeases();
    return deleted;
  }, () => {
    deleteOpenSwanApprovalResumeExactCallLeases();
    return false;
  });
}

export const __openSwanApprovalResumeOutboxTestables = Object.freeze({
  canonicalJson,
  parseOutbox,
  sha256Hex,
  storageId: OUTBOX_ID,
  storageNamespace: OUTBOX_NAMESPACE,
  webLockName: OUTBOX_WEB_LOCK,
  inspectAuthAuthority: () => Object.freeze({
    epoch: authAuthorityEpoch,
    open: authAuthorityOpen,
  }),
});
