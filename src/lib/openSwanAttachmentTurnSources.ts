/**
 * Sealed, platform-free assembler for the attachment sources on one Chat turn.
 *
 * Callers project composer values into the structural inputs below and inject
 * byte lookup plus SHA-256. A non-text extractor, when supplied, receives the
 * exact copied bytes inside this boundary rather than an independently claimed
 * string. This module performs no fetch, storage, filesystem, React Native, or
 * Supabase work. Successful output separates:
 *
 * - a strict runtime-private identity manifest;
 * - a value-free model projection; and
 * - bounded private text keyed by an opaque manifest handle.
 *
 * Raw bytes establish the attachment digest and either deterministic UTF-8 or
 * an explicitly trusted extraction. The exact bounded model source is hashed
 * separately and raw bytes are never returned.
 * URLs, paths, storage keys, File/Blob objects, and base64 have no admitted
 * input field. A binary with no explicitly supplied readable handle remains
 * metadata-only even when its bytes were available transiently for hashing.
 */

import {
  OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS,
  normalizeOpenSwanAttachmentSourceManifest,
  projectOpenSwanAttachmentSourceManifestForModel,
  type OpenSwanAttachmentSourceHandleKind,
  type OpenSwanAttachmentSourceContentBinding,
  type OpenSwanAttachmentSourceManifest,
  type OpenSwanAttachmentSourceManifestItem,
  type OpenSwanAttachmentSourceModelProjection,
} from './openSwanAttachmentSourceCore';
import { createChatVisualBriefArtifact } from './chatVisualBriefCore';
import { redactSecrets } from './secretRedactionCore';

export const OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS = Object.freeze({
  maxInlineTextChars: 10_000,
  maxVisualBriefChars: 3_000,
  maxInputsPerLane: 20,
  maxByteSourceIdChars: 160,
} as const);

export type OpenSwanAttachmentReadableHandle = Readonly<{
  kind: 'desktop_staged_file' | 'private_storage_object';
  id: string;
}>;

export type OpenSwanAttachmentTurnMediaInput = Readonly<{
  id: string;
  /** Durable upload identity, when this media row mirrors a staged upload. */
  uploadedAttachmentId?: string | null;
  name: string;
  mimeType: string;
  size: number;
  extractText?: string | null;
  extractTextComplete?: boolean;
  exactBytes?: ArrayBuffer | ArrayBufferView | null;
  byteSourceId?: string | null;
  readableHandle?: OpenSwanAttachmentReadableHandle | null;
}>;

export type OpenSwanAttachmentTurnStagedUpload = Readonly<{
  id: string;
  circleId: string;
  threadId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractText?: string | null;
  extractTextComplete?: boolean;
}>;

export type OpenSwanAttachmentTurnStagedInput = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploading: boolean;
  error?: string | null;
  attachment?: OpenSwanAttachmentTurnStagedUpload | null;
  extractText?: string | null;
  extractTextComplete?: boolean;
  exactBytes?: ArrayBuffer | ArrayBufferView | null;
  byteSourceId?: string | null;
  readableHandle?: OpenSwanAttachmentReadableHandle | null;
}>;

export type OpenSwanAttachmentTurnVisualInput = Readonly<{
  attachmentId: string;
  version: 1;
  fileName: string;
  observation: string;
  redactionApplied: boolean;
}>;

export type OpenSwanAttachmentTurnSourcesInput = Readonly<{
  manifestId: string;
  circleId: string;
  threadId: string;
  originLocalMessageId: string;
  mediaAttachments: ReadonlyArray<OpenSwanAttachmentTurnMediaInput>;
  stagedFiles: ReadonlyArray<OpenSwanAttachmentTurnStagedInput>;
  visualBriefs: ReadonlyArray<OpenSwanAttachmentTurnVisualInput>;
}>;

export type OpenSwanAttachmentByteRequest = Readonly<{
  lane: 'media' | 'staged';
  attachmentId: string;
  byteSourceId: string;
  sizeBytes: number;
}>;

export type OpenSwanAttachmentDigestOutput = string | ArrayBuffer | ArrayBufferView;

export type OpenSwanAttachmentTrustedTextExtractionRequest = Readonly<{
  attachmentId: string;
  basename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  /** Exact copied bytes whose SHA-256 is the `sha256` field above. */
  bytes: Uint8Array;
}>;

export type OpenSwanAttachmentTrustedTextExtraction = Readonly<{
  text: string;
  complete: boolean;
  /** Opaque, versioned extractor identity. Never a URL or executable path. */
  provenanceId: string;
}>;

export type OpenSwanAttachmentTurnSourceDependencies = Readonly<{
  /** Web-Crypto-compatible: `bytes => crypto.subtle.digest('SHA-256', bytes)`. */
  digestSha256: (bytes: Uint8Array) => Promise<OpenSwanAttachmentDigestOutput>;
  /** Optional exact-byte lookup. The request contains no URL or path. */
  resolveBytes?: (request: OpenSwanAttachmentByteRequest) => Promise<ArrayBuffer | ArrayBufferView | null>;
  /** Optional trusted extraction over the exact bytes supplied in the request. */
  extractTrustedText?: (
    request: OpenSwanAttachmentTrustedTextExtractionRequest,
  ) => Promise<OpenSwanAttachmentTrustedTextExtraction | null>;
}>;

export type OpenSwanAttachmentPrivateSources = Readonly<Record<string, string>>;

export type OpenSwanAttachmentTurnSources = Readonly<{
  manifest: OpenSwanAttachmentSourceManifest;
  modelProjection: OpenSwanAttachmentSourceModelProjection;
  /** Values are only bounded inline text or a sanitized visual observation. */
  privateSourcesByHandle: OpenSwanAttachmentPrivateSources;
}>;

export type OpenSwanAttachmentTurnSourceErrorCode =
  | 'invalid_input'
  | 'invalid_keys'
  | 'invalid_scope'
  | 'invalid_manifest_id'
  | 'invalid_media'
  | 'invalid_staged_file'
  | 'attachment_uploading'
  | 'attachment_error'
  | 'staged_attachment_missing'
  | 'staged_scope_mismatch'
  | 'invalid_visual_brief'
  | 'visual_attachment_not_found'
  | 'visual_attachment_mismatch'
  | 'ambiguous_duplicate'
  | 'attachment_count_invalid'
  | 'bytes_unavailable'
  | 'bytes_size_mismatch'
  | 'digest_unavailable'
  | 'digest_invalid'
  | 'text_decode_unavailable'
  | 'extracted_text_mismatch'
  | 'trusted_extraction_invalid'
  | 'manifest_invalid';

export type OpenSwanAttachmentTurnSourcesResult =
  | Readonly<{ ok: true } & OpenSwanAttachmentTurnSources>
  | Readonly<{ ok: false; code: OpenSwanAttachmentTurnSourceErrorCode }>;

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const ROOT_KEYS = Object.freeze([
  'manifestId',
  'circleId',
  'threadId',
  'originLocalMessageId',
  'mediaAttachments',
  'stagedFiles',
  'visualBriefs',
] as const);
const MEDIA_KEYS = new Set([
  'id',
  'uploadedAttachmentId',
  'name',
  'mimeType',
  'size',
  'extractText',
  'extractTextComplete',
  'exactBytes',
  'byteSourceId',
  'readableHandle',
]);
const STAGED_KEYS = new Set([
  'id',
  'name',
  'mimeType',
  'sizeBytes',
  'uploading',
  'error',
  'attachment',
  'extractText',
  'extractTextComplete',
  'exactBytes',
  'byteSourceId',
  'readableHandle',
]);
const UPLOAD_KEYS = new Set([
  'id',
  'circleId',
  'threadId',
  'originalName',
  'mimeType',
  'sizeBytes',
  'extractText',
  'extractTextComplete',
]);
const READABLE_HANDLE_KEYS = Object.freeze(['kind', 'id'] as const);
const VISUAL_KEYS = Object.freeze([
  'attachmentId',
  'version',
  'fileName',
  'observation',
  'redactionApplied',
] as const);
const UNSAFE_TEXT_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/g;
const UNICODE_TAG_RE = /[\u{E0000}-\u{E007F}]/gu;
const CLOSING_SOURCE_BOUNDARY_RE = /<\/untrusted_attachment_source\s*>/gi;

type CandidateLane = 'media' | 'staged';

type Candidate = {
  lane: CandidateLane;
  attachmentId: string;
  durableIdentity: boolean;
  basename: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string | null;
  claimedExtractedText: string | null;
  extractedTextComplete: boolean;
  extractedTextCompletenessClaim: boolean | null;
  exactBytes: Uint8Array | null;
  byteSourceId: string;
  readableHandle: OpenSwanAttachmentReadableHandle | null;
};

type CandidateGroup = {
  attachmentId: string;
  candidates: Candidate[];
  basename: string;
  mimeType: string;
  sizeBytes: number;
  extractedText: string | null;
  claimedExtractedText: string | null;
  extractedTextComplete: boolean;
  extractedTextCompletenessClaim: boolean | null;
  readableHandle: OpenSwanAttachmentReadableHandle | null;
};

function fail(code: OpenSwanAttachmentTurnSourceErrorCode): OpenSwanAttachmentTurnSourcesResult {
  return Object.freeze({ ok: false as const, code });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  } catch {
    return false;
  }
}

function readOwn(value: Record<string, unknown>, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
  } catch {
    return undefined;
  }
}

function readIndex(value: unknown[], index: number): unknown {
  try {
    return value[index];
  } catch {
    return undefined;
  }
}

function exactKeys(value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean {
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return false;
    const keys = ownKeys as string[];
    if (keys.length !== expected.length) return false;
    if (keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !descriptor.enumerable || !('value' in descriptor);
    })) return false;
    const allowed = new Set(expected);
    return keys.every((key) => allowed.has(key))
      && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  } catch {
    return false;
  }
}

function allowedKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  required: ReadonlyArray<string>,
): boolean {
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) return false;
    const keys = ownKeys as string[];
    if (keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor || !descriptor.enumerable || !('value' in descriptor);
    })) return false;
    return keys.every((key) => allowed.has(key))
      && required.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  } catch {
    return false;
  }
}

function safeId(value: unknown, maxChars = OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxIdChars): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxChars
    && value === value.trim()
    && SAFE_ID_RE.test(value);
}

function exactString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function exactBoolean(value: unknown, fallback = false): boolean | null {
  if (value === undefined) return fallback;
  return typeof value === 'boolean' ? value : null;
}

function exactSize(value: unknown): number | null {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxSizeBytes
    ? value as number
    : null;
}

function normalizeReadableHandle(value: unknown): OpenSwanAttachmentReadableHandle | null | false {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !exactKeys(value, READABLE_HANDLE_KEYS)) return false;
  const kind = readOwn(value, 'kind');
  const id = readOwn(value, 'id');
  if (
    (kind !== 'desktop_staged_file' && kind !== 'private_storage_object')
    || !safeId(id)
  ) return false;
  return Object.freeze({ kind, id });
}

function copyExactBytes(value: unknown): Uint8Array | null | false {
  if (value === undefined || value === null) return null;
  try {
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) {
      const view = value as ArrayBufferView;
      const copy = new Uint8Array(view.byteLength);
      copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return copy;
    }
    return false;
  } catch {
    return false;
  }
}

function normalizePrivateText(value: unknown): { text: string | null; truncated: boolean } {
  if (value === undefined || value === null) return { text: null, truncated: false };
  if (typeof value !== 'string') return { text: null, truncated: true };
  try {
    const cleaned = value
      .replace(/\r\n?/g, '\n')
      .replace(UNSAFE_TEXT_CONTROL_RE, ' ')
      .replace(UNICODE_TAG_RE, '')
      .trim();
    if (!cleaned) return { text: null, truncated: value.length > 0 };
    const chars = Array.from(cleaned);
    if (chars.length <= OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInlineTextChars) {
      return { text: cleaned, truncated: cleaned !== value };
    }
    return {
      text: chars.slice(0, OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInlineTextChars).join(''),
      truncated: true,
    };
  } catch {
    return { text: null, truncated: true };
  }
}

function parseMedia(value: unknown): Candidate | null {
  if (!isRecord(value) || !allowedKeys(value, MEDIA_KEYS, ['id', 'name', 'mimeType', 'size'])) return null;
  const id = readOwn(value, 'id');
  const uploadedAttachmentId = readOwn(value, 'uploadedAttachmentId');
  if (!safeId(id)) return null;
  if (uploadedAttachmentId !== undefined && uploadedAttachmentId !== null && !safeId(uploadedAttachmentId)) return null;
  const attachmentId = typeof uploadedAttachmentId === 'string' ? uploadedAttachmentId : id;
  const basename = exactString(readOwn(value, 'name'));
  const mimeType = exactString(readOwn(value, 'mimeType'));
  const sizeBytes = exactSize(readOwn(value, 'size'));
  if (basename === null || mimeType === null || sizeBytes === null) return null;
  const text = normalizePrivateText(readOwn(value, 'extractText'));
  if (readOwn(value, 'extractText') !== undefined && readOwn(value, 'extractText') !== null && text.text === null) return null;
  const claimedExtractedText = readOwn(value, 'extractText') === undefined
    || readOwn(value, 'extractText') === null
    ? null
    : exactString(readOwn(value, 'extractText'));
  if (claimedExtractedText === null && readOwn(value, 'extractText') != null) return null;
  const completeRaw = readOwn(value, 'extractTextComplete');
  const complete = exactBoolean(completeRaw);
  if (complete === null) return null;
  const exactBytes = copyExactBytes(readOwn(value, 'exactBytes'));
  if (exactBytes === false) return null;
  const byteSource = readOwn(value, 'byteSourceId');
  if (byteSource !== undefined && byteSource !== null && !safeId(byteSource, OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxByteSourceIdChars)) return null;
  const readableHandle = normalizeReadableHandle(readOwn(value, 'readableHandle'));
  if (readableHandle === false) return null;
  return {
    lane: 'media',
    attachmentId,
    durableIdentity: typeof uploadedAttachmentId === 'string',
    basename,
    mimeType,
    sizeBytes,
    extractedText: text.text,
    claimedExtractedText,
    extractedTextComplete: complete && !text.truncated,
    extractedTextCompletenessClaim: typeof completeRaw === 'boolean' ? complete : null,
    exactBytes,
    byteSourceId: typeof byteSource === 'string' ? byteSource : id,
    readableHandle,
  };
}

function parseStaged(
  value: unknown,
  scope: Readonly<{ circleId: string; threadId: string }>,
): Candidate | OpenSwanAttachmentTurnSourceErrorCode {
  if (!isRecord(value) || !allowedKeys(value, STAGED_KEYS, [
    'id', 'name', 'mimeType', 'sizeBytes', 'uploading',
  ])) return 'invalid_staged_file';
  if (readOwn(value, 'uploading') !== false) return 'attachment_uploading';
  const rawError = readOwn(value, 'error');
  if (rawError !== undefined && rawError !== null) {
    if (typeof rawError !== 'string' || rawError.trim().length > 0) return 'attachment_error';
  }
  const id = readOwn(value, 'id');
  const basename = exactString(readOwn(value, 'name'));
  const mimeType = exactString(readOwn(value, 'mimeType'));
  const sizeBytes = exactSize(readOwn(value, 'sizeBytes'));
  if (!safeId(id) || basename === null || mimeType === null || sizeBytes === null) return 'invalid_staged_file';
  const upload = readOwn(value, 'attachment');
  if (!isRecord(upload) || !allowedKeys(upload, UPLOAD_KEYS, [
    'id', 'circleId', 'threadId', 'originalName', 'mimeType', 'sizeBytes',
  ])) return 'staged_attachment_missing';
  const attachmentId = readOwn(upload, 'id');
  if (!safeId(attachmentId)) return 'invalid_staged_file';
  if (readOwn(upload, 'circleId') !== scope.circleId || readOwn(upload, 'threadId') !== scope.threadId) {
    return 'staged_scope_mismatch';
  }
  const uploadedName = exactString(readOwn(upload, 'originalName'));
  const uploadedMime = exactString(readOwn(upload, 'mimeType'));
  const uploadedSize = exactSize(readOwn(upload, 'sizeBytes'));
  if (
    uploadedName === null
    || uploadedMime === null
    || uploadedSize === null
    || uploadedName !== basename
    || uploadedMime.toLowerCase() !== mimeType.toLowerCase()
    || uploadedSize !== sizeBytes
  ) return 'ambiguous_duplicate';
  const topTextRaw = readOwn(value, 'extractText');
  const uploadTextRaw = readOwn(upload, 'extractText');
  if (
    typeof topTextRaw === 'string'
    && typeof uploadTextRaw === 'string'
    && topTextRaw !== uploadTextRaw
  ) return 'ambiguous_duplicate';
  const topText = normalizePrivateText(topTextRaw);
  const uploadText = normalizePrivateText(uploadTextRaw);
  if (topTextRaw !== undefined && topTextRaw !== null && topText.text === null) return 'invalid_staged_file';
  if (uploadTextRaw !== undefined && uploadTextRaw !== null && uploadText.text === null) return 'invalid_staged_file';
  if (topText.text && uploadText.text && topText.text !== uploadText.text) return 'ambiguous_duplicate';
  const extractedText = uploadText.text || topText.text;
  const claimedExtractedText = typeof uploadTextRaw === 'string'
    ? uploadTextRaw
    : typeof topTextRaw === 'string'
      ? topTextRaw
      : null;
  const topCompleteRaw = readOwn(value, 'extractTextComplete');
  const uploadCompleteRaw = readOwn(upload, 'extractTextComplete');
  const topComplete = exactBoolean(topCompleteRaw);
  const uploadComplete = exactBoolean(uploadCompleteRaw);
  if (topComplete === null || uploadComplete === null) return 'invalid_staged_file';
  if (
    typeof topCompleteRaw === 'boolean'
    && typeof uploadCompleteRaw === 'boolean'
    && topComplete !== uploadComplete
  ) return 'ambiguous_duplicate';
  const exactBytes = copyExactBytes(readOwn(value, 'exactBytes'));
  if (exactBytes === false) return 'invalid_staged_file';
  const byteSource = readOwn(value, 'byteSourceId');
  if (byteSource !== undefined && byteSource !== null && !safeId(byteSource, OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxByteSourceIdChars)) {
    return 'invalid_staged_file';
  }
  const readableHandle = normalizeReadableHandle(readOwn(value, 'readableHandle'));
  if (readableHandle === false) return 'invalid_staged_file';
  return {
    lane: 'staged',
    attachmentId,
    durableIdentity: true,
    basename,
    mimeType,
    sizeBytes,
    extractedText,
    claimedExtractedText,
    extractedTextComplete: Boolean((uploadComplete || topComplete) && !topText.truncated && !uploadText.truncated),
    extractedTextCompletenessClaim: typeof uploadCompleteRaw === 'boolean'
      ? uploadComplete
      : typeof topCompleteRaw === 'boolean'
        ? topComplete
        : null,
    exactBytes,
    byteSourceId: typeof byteSource === 'string' ? byteSource : id,
    readableHandle,
  };
}

function buildGroups(candidates: Candidate[]): CandidateGroup[] | null {
  const groups = new Map<string, CandidateGroup>();
  for (const candidate of candidates) {
    const existing = groups.get(candidate.attachmentId);
    if (!existing) {
      groups.set(candidate.attachmentId, {
        attachmentId: candidate.attachmentId,
        candidates: [candidate],
        basename: candidate.basename,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
        extractedText: candidate.extractedText,
        claimedExtractedText: candidate.claimedExtractedText,
        extractedTextComplete: candidate.extractedTextComplete,
        extractedTextCompletenessClaim: candidate.extractedTextCompletenessClaim,
        readableHandle: candidate.readableHandle,
      });
      continue;
    }
    const first = existing.candidates[0];
    // Only the same durable upload represented once in each input lane may be
    // deduplicated. Same-lane duplicates and coincident client ids are unclear.
    if (
      first.lane === candidate.lane
      || !first.durableIdentity
      || !candidate.durableIdentity
      || existing.candidates.length !== 1
      || existing.basename !== candidate.basename
      || existing.mimeType.toLowerCase() !== candidate.mimeType.toLowerCase()
      || existing.sizeBytes !== candidate.sizeBytes
    ) return null;
    if (existing.extractedText && candidate.extractedText && existing.extractedText !== candidate.extractedText) return null;
    if (
      existing.claimedExtractedText !== null
      && candidate.claimedExtractedText !== null
      && existing.claimedExtractedText !== candidate.claimedExtractedText
    ) return null;
    if (
      existing.extractedTextCompletenessClaim !== null
      && candidate.extractedTextCompletenessClaim !== null
      && existing.extractedTextCompletenessClaim !== candidate.extractedTextCompletenessClaim
    ) return null;
    if (
      existing.readableHandle
      && candidate.readableHandle
      && (
        existing.readableHandle.kind !== candidate.readableHandle.kind
        || existing.readableHandle.id !== candidate.readableHandle.id
      )
    ) return null;
    existing.candidates.push(candidate);
    existing.extractedText = existing.extractedText || candidate.extractedText;
    existing.claimedExtractedText = existing.claimedExtractedText ?? candidate.claimedExtractedText;
    existing.extractedTextComplete = existing.extractedTextComplete || candidate.extractedTextComplete;
    existing.extractedTextCompletenessClaim = existing.extractedTextCompletenessClaim
      ?? candidate.extractedTextCompletenessClaim;
    existing.readableHandle = existing.readableHandle || candidate.readableHandle;
  }
  return Array.from(groups.values());
}

function normalizeDigestOutput(value: OpenSwanAttachmentDigestOutput): string | null {
  try {
    if (typeof value === 'string') return SHA256_RE.test(value) ? value.toLowerCase() : null;
    const bytes = value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : null;
    if (!bytes || bytes.byteLength !== 32) return null;
    return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

async function bytesForCandidate(
  candidate: Candidate,
  dependencies: OpenSwanAttachmentTurnSourceDependencies,
): Promise<Uint8Array | null> {
  if (candidate.exactBytes) return new Uint8Array(candidate.exactBytes);
  if (typeof dependencies.resolveBytes !== 'function') return null;
  try {
    const resolved = await dependencies.resolveBytes(Object.freeze({
      lane: candidate.lane,
      attachmentId: candidate.attachmentId,
      byteSourceId: candidate.byteSourceId,
      sizeBytes: candidate.sizeBytes,
    }));
    const copied = copyExactBytes(resolved);
    return copied === false ? null : copied;
  } catch {
    return null;
  }
}

async function digestGroup(
  group: CandidateGroup,
  dependencies: OpenSwanAttachmentTurnSourceDependencies,
): Promise<
  | { ok: true; sha256: string; bytes: Uint8Array }
  | { ok: false; code: OpenSwanAttachmentTurnSourceErrorCode }
> {
  if (typeof dependencies.digestSha256 !== 'function') return { ok: false, code: 'digest_unavailable' };
  const digests = new Set<string>();
  let canonicalBytes: Uint8Array | null = null;
  for (const candidate of group.candidates) {
    const bytes = await bytesForCandidate(candidate, dependencies);
    if (!bytes) continue;
    if (bytes.byteLength !== candidate.sizeBytes) return { ok: false, code: 'bytes_size_mismatch' };
    if (canonicalBytes) {
      if (canonicalBytes.byteLength !== bytes.byteLength) return { ok: false, code: 'ambiguous_duplicate' };
      for (let index = 0; index < bytes.byteLength; index += 1) {
        if (canonicalBytes[index] !== bytes[index]) return { ok: false, code: 'ambiguous_duplicate' };
      }
    } else {
      canonicalBytes = new Uint8Array(bytes);
    }
    let rawDigest: OpenSwanAttachmentDigestOutput;
    try {
      rawDigest = await dependencies.digestSha256(new Uint8Array(bytes));
    } catch {
      return { ok: false, code: 'digest_unavailable' };
    }
    const digest = normalizeDigestOutput(rawDigest);
    if (!digest) return { ok: false, code: 'digest_invalid' };
    digests.add(digest);
  }
  if (!canonicalBytes) return { ok: false, code: 'bytes_unavailable' };
  if (digests.size !== 1) return { ok: false, code: 'ambiguous_duplicate' };
  return { ok: true, sha256: Array.from(digests)[0], bytes: canonicalBytes };
}

async function digestSourceText(
  text: string,
  dependencies: OpenSwanAttachmentTurnSourceDependencies,
): Promise<
  | { ok: true; sha256: string }
  | { ok: false; code: 'digest_unavailable' | 'digest_invalid' }
> {
  if (typeof dependencies.digestSha256 !== 'function') return { ok: false, code: 'digest_unavailable' };
  try {
    const output = await dependencies.digestSha256(new TextEncoder().encode(text));
    const sha256 = normalizeDigestOutput(output);
    return sha256 ? { ok: true, sha256 } : { ok: false, code: 'digest_invalid' };
  } catch {
    return { ok: false, code: 'digest_unavailable' };
  }
}

function safeGeneratedHandleId(kind: 'inline' | 'visual' | 'metadata', index: number, sha256: string): string {
  return `${kind}-${index + 1}-${sha256.slice(0, 24)}`;
}

type SealedSourceText = Readonly<{
  text: string;
  complete: boolean;
}>;

function isDeterministicTextMime(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith('text/')
    || normalized === 'application/json'
    || normalized.endsWith('+json')
    || normalized === 'application/xml'
    || normalized.endsWith('+xml')
    || normalized === 'application/javascript'
    || normalized === 'application/x-javascript'
    || normalized === 'application/sql'
    || normalized === 'application/yaml'
    || normalized === 'application/x-yaml';
}

function sealSourceText(value: string, declaredComplete: boolean): SealedSourceText | null {
  const normalized = normalizePrivateText(value);
  if (!normalized.text) return null;
  const redacted = redactSecrets(normalized.text);
  const boundarySafe = redacted.text.replace(
    CLOSING_SOURCE_BOUNDARY_RE,
    '[attachment source boundary removed]',
  );
  const chars = Array.from(boundarySafe);
  const bounded = chars
    .slice(0, OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInlineTextChars)
    .join('');
  if (!bounded.trim()) return null;
  return Object.freeze({
    text: bounded,
    complete: declaredComplete
      && !normalized.truncated
      && redacted.redactionCount === 0
      && boundarySafe === redacted.text
      && chars.length <= OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInlineTextChars,
  });
}

function decodeExactUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

async function trustedExtractedSource(args: {
  group: CandidateGroup;
  bytes: Uint8Array;
  sha256: string;
  dependencies: OpenSwanAttachmentTurnSourceDependencies;
}): Promise<
  | { ok: true; source: SealedSourceText | null; provenance: string | null }
  | { ok: false; code: OpenSwanAttachmentTurnSourceErrorCode }
> {
  const extractor = args.dependencies.extractTrustedText;
  if (typeof extractor !== 'function') {
    return args.group.claimedExtractedText === null
      ? { ok: true, source: null, provenance: null }
      : { ok: false, code: 'trusted_extraction_invalid' };
  }
  const extractorBytes = new Uint8Array(args.bytes);
  let output: OpenSwanAttachmentTrustedTextExtraction | null;
  try {
    output = await extractor(Object.freeze({
      attachmentId: args.group.attachmentId,
      basename: args.group.basename,
      mimeType: args.group.mimeType.toLowerCase(),
      sizeBytes: args.group.sizeBytes,
      sha256: args.sha256,
      bytes: extractorBytes,
    }));
  } catch {
    return { ok: false, code: 'trusted_extraction_invalid' };
  }
  for (let index = 0; index < args.bytes.byteLength; index += 1) {
    if (args.bytes[index] !== extractorBytes[index]) {
      return { ok: false, code: 'trusted_extraction_invalid' };
    }
  }
  if (output === null) {
    return args.group.claimedExtractedText === null
      ? { ok: true, source: null, provenance: null }
      : { ok: false, code: 'trusted_extraction_invalid' };
  }
  if (!isRecord(output) || !exactKeys(output, ['text', 'complete', 'provenanceId'])) {
    return { ok: false, code: 'trusted_extraction_invalid' };
  }
  const text = readOwn(output, 'text');
  const complete = readOwn(output, 'complete');
  const provenanceId = readOwn(output, 'provenanceId');
  if (typeof text !== 'string' || typeof complete !== 'boolean' || !safeId(provenanceId)) {
    return { ok: false, code: 'trusted_extraction_invalid' };
  }
  if (args.group.claimedExtractedText !== null && args.group.claimedExtractedText !== text) {
    return { ok: false, code: 'extracted_text_mismatch' };
  }
  const source = sealSourceText(text, complete);
  if (!source) return { ok: false, code: 'trusted_extraction_invalid' };
  return { ok: true, source, provenance: provenanceId };
}

function preflightGroupMetadata(
  groups: CandidateGroup[],
  identity: Readonly<{
    manifestId: string;
    circleId: string;
    threadId: string;
    originLocalMessageId: string;
  }>,
): boolean {
  const placeholderSha = '0'.repeat(64);
  return normalizeOpenSwanAttachmentSourceManifest({
    schemaVersion: 1,
    ...identity,
    attachments: groups.map((group, index) => ({
      attachmentId: group.attachmentId,
      basename: group.basename,
      mimeType: group.mimeType,
      sizeBytes: group.sizeBytes,
      sha256: placeholderSha,
      contentAvailability: 'unavailable',
      sourceHandle: { kind: 'metadata_only', id: `preflight-${index + 1}` },
      sourceContentSha256: null,
      sourceContentBinding: 'none',
      sourceContentProvenance: null,
    })),
  }).ok;
}

/**
 * Assemble one sealed turn manifest. Any invalid member fails the whole turn;
 * callers must not silently drop a bad attachment and continue with the rest.
 */
export async function assembleOpenSwanAttachmentTurnSources(
  input: unknown,
  dependencies: OpenSwanAttachmentTurnSourceDependencies,
): Promise<OpenSwanAttachmentTurnSourcesResult> {
  try {
    if (!isRecord(input)) return fail('invalid_input');
    if (!exactKeys(input, ROOT_KEYS)) return fail('invalid_keys');
    const manifestId = readOwn(input, 'manifestId');
    const circleId = readOwn(input, 'circleId');
    const threadId = readOwn(input, 'threadId');
    const originLocalMessageId = readOwn(input, 'originLocalMessageId');
    if (!safeId(manifestId)) return fail('invalid_manifest_id');
    if (!safeId(circleId) || !safeId(threadId) || !safeId(originLocalMessageId)) return fail('invalid_scope');
    const media = readOwn(input, 'mediaAttachments');
    const staged = readOwn(input, 'stagedFiles');
    const visuals = readOwn(input, 'visualBriefs');
    if (!Array.isArray(media) || !Array.isArray(staged) || !Array.isArray(visuals)) return fail('invalid_input');
    if (
      media.length > OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInputsPerLane
      || staged.length > OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInputsPerLane
      || visuals.length > OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInputsPerLane
    ) return fail('attachment_count_invalid');

    const candidates: Candidate[] = [];
    for (let index = 0; index < media.length; index += 1) {
      const candidate = parseMedia(readIndex(media, index));
      if (!candidate) return fail('invalid_media');
      candidates.push(candidate);
    }
    for (let index = 0; index < staged.length; index += 1) {
      const candidate = parseStaged(readIndex(staged, index), { circleId, threadId });
      if (typeof candidate === 'string') return fail(candidate);
      candidates.push(candidate);
    }
    if (
      candidates.length < 1
      || candidates.length > OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxAttachments * 2
    ) return fail('attachment_count_invalid');
    const groups = buildGroups(candidates);
    if (!groups) return fail('ambiguous_duplicate');
    if (groups.length < 1 || groups.length > OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxAttachments) {
      return fail('attachment_count_invalid');
    }
    if (!preflightGroupMetadata(groups, {
      manifestId,
      circleId,
      threadId,
      originLocalMessageId,
    })) return fail('manifest_invalid');

    const visualByAttachment = new Map<string, string>();
    for (let index = 0; index < visuals.length; index += 1) {
      const rawVisual = readIndex(visuals, index);
      if (!isRecord(rawVisual) || !exactKeys(rawVisual, VISUAL_KEYS)) return fail('invalid_visual_brief');
      const attachmentId = readOwn(rawVisual, 'attachmentId');
      if (!safeId(attachmentId) || readOwn(rawVisual, 'version') !== 1 || typeof readOwn(rawVisual, 'redactionApplied') !== 'boolean') {
        return fail('invalid_visual_brief');
      }
      if (visualByAttachment.has(attachmentId)) return fail('ambiguous_duplicate');
      const group = groups.find((candidate) => candidate.attachmentId === attachmentId);
      if (!group) return fail('visual_attachment_not_found');
      if (!group.mimeType.toLowerCase().startsWith('image/')) return fail('visual_attachment_mismatch');
      const fileName = readOwn(rawVisual, 'fileName');
      const observation = readOwn(rawVisual, 'observation');
      if (typeof fileName !== 'string' || typeof observation !== 'string' || fileName !== group.basename) {
        return fail('visual_attachment_mismatch');
      }
      const sanitized = createChatVisualBriefArtifact({ fileName, observation });
      if (sanitized.fileName !== group.basename || !sanitized.observation.trim()) {
        return fail('invalid_visual_brief');
      }
      const boundedObservation = Array.from(sanitized.observation)
        .slice(0, OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxVisualBriefChars)
        .join('');
      if (!boundedObservation) return fail('invalid_visual_brief');
      visualByAttachment.set(attachmentId, boundedObservation);
    }

    const manifestItems: OpenSwanAttachmentSourceManifestItem[] = [];
    const privateSources: Record<string, string> = Object.create(null) as Record<string, string>;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const digest = await digestGroup(group, dependencies);
      if ('code' in digest) return fail(digest.code);
      const visualText = visualByAttachment.get(group.attachmentId) || null;
      let handleKind: OpenSwanAttachmentSourceHandleKind;
      let handleId: string;
      let contentAvailability: 'unavailable' | 'partial' | 'complete' | 'derived';
      let sourceContentSha256: string | null = null;
      let sourceContentBinding: OpenSwanAttachmentSourceContentBinding = 'none';
      let sourceContentProvenance: string | null = null;
      if (visualText) {
        handleKind = 'visual_brief';
        handleId = safeGeneratedHandleId('visual', index, digest.sha256);
        contentAvailability = 'derived';
        privateSources[handleId] = visualText;
        const sourceDigest = await digestSourceText(visualText, dependencies);
        if (!sourceDigest.ok) return fail(sourceDigest.code);
        sourceContentSha256 = sourceDigest.sha256;
        sourceContentBinding = 'derived_unbound';
        sourceContentProvenance = 'derived:visual-brief-v1';
      } else if (isDeterministicTextMime(group.mimeType)) {
        const decoded = decodeExactUtf8(digest.bytes);
        if (decoded === null) return fail('text_decode_unavailable');
        if (group.claimedExtractedText !== null && group.claimedExtractedText !== decoded) {
          return fail('extracted_text_mismatch');
        }
        const source = sealSourceText(decoded, true);
        if (!source) return fail('text_decode_unavailable');
        const sourceDigest = await digestSourceText(source.text, dependencies);
        if (!sourceDigest.ok) return fail(sourceDigest.code);
        handleKind = 'inline_text';
        handleId = safeGeneratedHandleId('inline', index, digest.sha256);
        contentAvailability = source.complete ? 'complete' : 'partial';
        privateSources[handleId] = source.text;
        sourceContentSha256 = sourceDigest.sha256;
        sourceContentBinding = 'deterministic_text';
        sourceContentProvenance = 'builtin:utf8-redacted-v1';
      } else {
        const extraction = await trustedExtractedSource({
          group,
          bytes: digest.bytes,
          sha256: digest.sha256,
          dependencies,
        });
        if (!extraction.ok) return fail(extraction.code);
        if (extraction.source && extraction.provenance) {
          const sourceDigest = await digestSourceText(extraction.source.text, dependencies);
          if (!sourceDigest.ok) return fail(sourceDigest.code);
          handleKind = 'inline_text';
          handleId = safeGeneratedHandleId('inline', index, digest.sha256);
          contentAvailability = extraction.source.complete ? 'complete' : 'partial';
          privateSources[handleId] = extraction.source.text;
          sourceContentSha256 = sourceDigest.sha256;
          sourceContentBinding = 'trusted_extractor';
          sourceContentProvenance = extraction.provenance;
        } else if (group.readableHandle) {
          handleKind = group.readableHandle.kind;
          handleId = group.readableHandle.id;
          contentAvailability = 'complete';
          sourceContentBinding = 'external_unverified';
          sourceContentProvenance = `external:${group.readableHandle.kind}-v1`;
        } else {
          handleKind = 'metadata_only';
          handleId = safeGeneratedHandleId('metadata', index, digest.sha256);
          contentAvailability = 'unavailable';
        }
      }
      manifestItems.push(Object.freeze({
        attachmentId: group.attachmentId,
        basename: group.basename,
        mimeType: group.mimeType,
        sizeBytes: group.sizeBytes,
        sha256: digest.sha256,
        contentAvailability,
        sourceHandle: Object.freeze({ kind: handleKind, id: handleId }),
        sourceContentSha256,
        sourceContentBinding,
        sourceContentProvenance,
      }));
    }

    const manifestResult = normalizeOpenSwanAttachmentSourceManifest({
      schemaVersion: 1,
      manifestId,
      circleId,
      threadId,
      originLocalMessageId,
      attachments: manifestItems,
    });
    if (!manifestResult.ok) return fail('manifest_invalid');
    const modelProjection = projectOpenSwanAttachmentSourceManifestForModel(manifestResult.manifest);
    if (!modelProjection) return fail('manifest_invalid');
    const privateSourcesByHandle = Object.freeze(privateSources);
    return Object.freeze({
      ok: true as const,
      manifest: manifestResult.manifest,
      modelProjection,
      privateSourcesByHandle,
    });
  } catch {
    return fail('invalid_input');
  }
}
