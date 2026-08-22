/**
 * Pure attachment-source identity and evidence binding for OpenSwan turns.
 *
 * This module deliberately does not fetch, extract, stage, or persist a file.
 * A trusted caller builds a manifest after those operations establish an
 * admitted source. The runtime may then mint a receipt only after a successful
 * source observation and resolve that receipt against the exact manifest.
 *
 * The contracts are value-free: they contain identity, byte count, attachment
 * and released-source digests, provenance, availability, and opaque handle
 * metadata only. Raw bytes, extracted text, storage paths, signed URLs, and
 * local paths have no field in any contract and are excluded from the
 * model-facing projection.
 */

export const OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS = Object.freeze({
  maxAttachments: 20,
  maxReceipts: 64,
  maxIdChars: 160,
  maxEvidenceIdChars: 160,
  maxBasenameChars: 120,
  maxMimeTypeChars: 127,
  maxSizeBytes: 100 * 1024 * 1024,
} as const);

export type OpenSwanAttachmentContentAvailability =
  | 'unavailable'
  | 'partial'
  | 'complete'
  | 'derived';

export type OpenSwanAttachmentSourceHandleKind =
  | 'metadata_only'
  | 'inline_text'
  | 'visual_brief'
  | 'desktop_staged_file'
  | 'private_storage_object';

export type OpenSwanAttachmentSourceAccess = 'metadata' | 'content' | 'visual';

/**
 * How the bounded source string released to the model relates to the exact
 * attachment bytes. `derived_unbound` is deliberately readable but cannot
 * prove exact source-grounded completion.
 */
export type OpenSwanAttachmentSourceContentBinding =
  | 'none'
  | 'deterministic_text'
  | 'trusted_extractor'
  | 'derived_unbound'
  | 'external_unverified';

export type OpenSwanAttachmentSourceHandle = Readonly<{
  kind: OpenSwanAttachmentSourceHandleKind;
  /** Opaque internal capability identity. Never a URL or filesystem path. */
  id: string;
}>;

export type OpenSwanAttachmentSourceManifestItem = Readonly<{
  attachmentId: string;
  basename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  contentAvailability: OpenSwanAttachmentContentAvailability;
  sourceHandle: OpenSwanAttachmentSourceHandle;
  /** SHA-256 of the exact bounded source body that may be released to a model. */
  sourceContentSha256: string | null;
  sourceContentBinding: OpenSwanAttachmentSourceContentBinding;
  /** Value-free implementation identity, never a path, URL, or storage key. */
  sourceContentProvenance: string | null;
}>;

export type OpenSwanAttachmentSourceManifest = Readonly<{
  schemaVersion: 1;
  manifestId: string;
  circleId: string;
  threadId: string;
  /** Device-local Chat message identity captured before persistence. */
  originLocalMessageId: string;
  attachments: ReadonlyArray<OpenSwanAttachmentSourceManifestItem>;
}>;

export type OpenSwanAttachmentSourceReceipt = Readonly<{
  schemaVersion: 1;
  evidenceId: string;
  manifestId: string;
  circleId: string;
  threadId: string;
  originLocalMessageId: string;
  attachmentId: string;
  sha256: string;
  sizeBytes: number;
  contentAvailability: OpenSwanAttachmentContentAvailability;
  sourceHandleKind: OpenSwanAttachmentSourceHandleKind;
  sourceHandleId: string;
  sourceContentSha256: string | null;
  sourceContentBinding: OpenSwanAttachmentSourceContentBinding;
  sourceContentProvenance: string | null;
  /** Digest of the final source body actually presented to the model. */
  observedSourceContentSha256: string | null;
  /** What the trusted runtime actually observed before minting this receipt. */
  access: OpenSwanAttachmentSourceAccess;
}>;

export type OpenSwanAttachmentSourceModelItem = Readonly<{
  attachmentId: string;
  basename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  contentAvailability: OpenSwanAttachmentContentAvailability;
  sourceHandleKind: OpenSwanAttachmentSourceHandleKind;
}>;

export type OpenSwanAttachmentSourceModelProjection = Readonly<{
  schemaVersion: 1;
  manifestId: string;
  attachmentCount: number;
  attachments: ReadonlyArray<OpenSwanAttachmentSourceModelItem>;
}>;

export type OpenSwanAttachmentManifestErrorCode =
  | 'invalid_input'
  | 'invalid_keys'
  | 'invalid_schema'
  | 'invalid_scope'
  | 'invalid_manifest_id'
  | 'invalid_attachment_count'
  | 'invalid_attachment'
  | 'invalid_attachment_id'
  | 'unsafe_basename'
  | 'invalid_mime_type'
  | 'invalid_size'
  | 'invalid_sha256'
  | 'invalid_content_availability'
  | 'invalid_source_handle'
  | 'incompatible_source_handle'
  | 'invalid_source_content_binding'
  | 'duplicate_attachment_id'
  | 'duplicate_source_handle_id';

export type OpenSwanAttachmentReceiptErrorCode =
  | 'invalid_input'
  | 'invalid_keys'
  | 'invalid_schema'
  | 'invalid_scope'
  | 'invalid_evidence_id'
  | 'invalid_manifest_id'
  | 'invalid_attachment_id'
  | 'invalid_sha256'
  | 'invalid_size'
  | 'invalid_content_availability'
  | 'invalid_source_handle'
  | 'invalid_source_content_binding'
  | 'invalid_observed_source_content_sha256'
  | 'observed_source_content_mismatch'
  | 'invalid_access'
  | 'incompatible_access'
  | 'manifest_invalid'
  | 'attachment_not_found';

export type OpenSwanAttachmentManifestResult =
  | Readonly<{ ok: true; manifest: OpenSwanAttachmentSourceManifest }>
  | Readonly<{ ok: false; code: OpenSwanAttachmentManifestErrorCode }>;

export type OpenSwanAttachmentReceiptResult =
  | Readonly<{ ok: true; receipt: OpenSwanAttachmentSourceReceipt }>
  | Readonly<{ ok: false; code: OpenSwanAttachmentReceiptErrorCode }>;

export type OpenSwanAttachmentSourceEvidenceFailure =
  | 'invalid_input'
  | 'invalid_keys'
  | 'manifest_invalid'
  | 'invalid_expected_identity'
  | 'manifest_mismatch'
  | 'scope_mismatch'
  | 'attachment_not_found'
  | 'invalid_receipts'
  | 'duplicate_evidence_id'
  | 'evidence_missing'
  | 'evidence_ambiguous'
  | 'evidence_manifest_mismatch'
  | 'evidence_scope_mismatch'
  | 'evidence_attachment_mismatch'
  | 'evidence_content_identity_mismatch'
  | 'evidence_source_handle_mismatch'
  | 'evidence_source_content_mismatch'
  | 'content_unavailable'
  | 'access_mismatch';

export type OpenSwanAttachmentSourceEvidenceResolution =
  | Readonly<{
      ok: true;
      evidence: Readonly<{
        evidenceId: string;
        manifestId: string;
        attachmentId: string;
        sha256: string;
        sizeBytes: number;
        sourceHandleKind: OpenSwanAttachmentSourceHandleKind;
        sourceContentSha256: string | null;
        sourceContentBinding: OpenSwanAttachmentSourceContentBinding;
        sourceContentProvenance: string | null;
        observedSourceContentSha256: string | null;
        access: OpenSwanAttachmentSourceAccess;
        identityBound: true;
        contentBound: boolean;
      }>;
    }>
  | Readonly<{ ok: false; reason: OpenSwanAttachmentSourceEvidenceFailure }>;

const SAFE_OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const MIME_ESSENCE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const UNSAFE_BASENAME_RE = /[\\/?#<>`\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2069\ufeff]/;
const MANIFEST_KEYS = Object.freeze([
  'schemaVersion',
  'manifestId',
  'circleId',
  'threadId',
  'originLocalMessageId',
  'attachments',
] as const);
const MANIFEST_ITEM_KEYS = Object.freeze([
  'attachmentId',
  'basename',
  'mimeType',
  'sizeBytes',
  'sha256',
  'contentAvailability',
  'sourceHandle',
  'sourceContentSha256',
  'sourceContentBinding',
  'sourceContentProvenance',
] as const);
const SOURCE_HANDLE_KEYS = Object.freeze(['kind', 'id'] as const);
const RECEIPT_KEYS = Object.freeze([
  'schemaVersion',
  'evidenceId',
  'manifestId',
  'circleId',
  'threadId',
  'originLocalMessageId',
  'attachmentId',
  'sha256',
  'sizeBytes',
  'contentAvailability',
  'sourceHandleKind',
  'sourceHandleId',
  'sourceContentSha256',
  'sourceContentBinding',
  'sourceContentProvenance',
  'observedSourceContentSha256',
  'access',
] as const);
const CREATE_RECEIPT_KEYS = Object.freeze([
  'manifest',
  'attachmentId',
  'evidenceId',
  'access',
  'observedSourceContentSha256',
] as const);
const RESOLVE_KEYS = Object.freeze(['manifest', 'receipts', 'expected'] as const);
const EXPECTED_KEYS = Object.freeze([
  'manifestId',
  'circleId',
  'threadId',
  'originLocalMessageId',
  'attachmentId',
  'evidenceId',
  'requiredAccess',
] as const);

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

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  try {
    const ownKeys = Object.keys(value);
    if (ownKeys.length !== keys.length) return false;
    const allowed = new Set(keys);
    return ownKeys.every((key) => allowed.has(key))
      && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
  } catch {
    return false;
  }
}

function isSafeOpaqueId(value: unknown, maxChars = OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxIdChars): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxChars
    && value === value.trim()
    && SAFE_OPAQUE_ID_RE.test(value);
}

function isContentAvailability(value: unknown): value is OpenSwanAttachmentContentAvailability {
  return value === 'unavailable'
    || value === 'partial'
    || value === 'complete'
    || value === 'derived';
}

function isSourceHandleKind(value: unknown): value is OpenSwanAttachmentSourceHandleKind {
  return value === 'metadata_only'
    || value === 'inline_text'
    || value === 'visual_brief'
    || value === 'desktop_staged_file'
    || value === 'private_storage_object';
}

function isAccess(value: unknown): value is OpenSwanAttachmentSourceAccess {
  return value === 'metadata' || value === 'content' || value === 'visual';
}

function isSourceContentBinding(value: unknown): value is OpenSwanAttachmentSourceContentBinding {
  return value === 'none'
    || value === 'deterministic_text'
    || value === 'trusted_extractor'
    || value === 'derived_unbound'
    || value === 'external_unverified';
}

function normalizeSourceContentProvenance(value: unknown): string | null | false {
  if (value === null) return null;
  return isSafeOpaqueId(value) ? value : false;
}

function isSafeBasename(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || value === '.' || value === '..') return false;
  if (value.length === 0 || Array.from(value).length > OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxBasenameChars) return false;
  if (UNSAFE_BASENAME_RE.test(value) || /^data:/i.test(value)) return false;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;
    if (
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
      || (codePoint >= 0xe0000 && codePoint <= 0xe007f)
    ) return false;
  }
  return true;
}

function normalizeMimeType(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) return null;
  if (value.length > OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxMimeTypeChars) return null;
  const normalized = value.toLowerCase();
  return MIME_ESSENCE_RE.test(normalized) ? normalized : null;
}

function normalizeSha256(value: unknown): string | null {
  return typeof value === 'string' && SHA256_RE.test(value) ? value.toLowerCase() : null;
}

function isSizeBytes(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxSizeBytes;
}

function sourceHandleMatchesAvailability(
  kind: OpenSwanAttachmentSourceHandleKind,
  availability: OpenSwanAttachmentContentAvailability,
): boolean {
  if (kind === 'metadata_only') return availability === 'unavailable';
  if (kind === 'inline_text') return availability === 'partial' || availability === 'complete';
  if (kind === 'visual_brief') return availability === 'derived';
  return availability === 'complete';
}

function accessMatchesSource(
  access: OpenSwanAttachmentSourceAccess,
  kind: OpenSwanAttachmentSourceHandleKind,
  availability: OpenSwanAttachmentContentAvailability,
): boolean {
  if (access === 'metadata') return true;
  if (availability === 'unavailable') return false;
  if (access === 'visual') return kind === 'visual_brief' && availability === 'derived';
  return kind === 'inline_text'
    || kind === 'desktop_staged_file'
    || kind === 'private_storage_object';
}

function sourceContentBindingMatchesSource(
  binding: OpenSwanAttachmentSourceContentBinding,
  sha256: string | null,
  provenance: string | null,
  kind: OpenSwanAttachmentSourceHandleKind,
  availability: OpenSwanAttachmentContentAvailability,
): boolean {
  if (binding === 'none') {
    return sha256 === null
      && provenance === null
      && kind === 'metadata_only'
      && availability === 'unavailable';
  }
  if (binding === 'external_unverified') {
    return sha256 === null
      && provenance !== null
      && (kind === 'desktop_staged_file' || kind === 'private_storage_object')
      && availability === 'complete';
  }
  if (sha256 === null || provenance === null) return false;
  if (binding === 'derived_unbound') {
    return kind === 'visual_brief' && availability === 'derived';
  }
  return kind === 'inline_text'
    && (availability === 'partial' || availability === 'complete');
}

function sourceContentCanProveCompletion(
  binding: OpenSwanAttachmentSourceContentBinding,
  availability: OpenSwanAttachmentContentAvailability,
): boolean {
  return availability === 'complete'
    && (binding === 'deterministic_text' || binding === 'trusted_extractor');
}

function failManifest(code: OpenSwanAttachmentManifestErrorCode): OpenSwanAttachmentManifestResult {
  return Object.freeze({ ok: false as const, code });
}

function failReceipt(code: OpenSwanAttachmentReceiptErrorCode): OpenSwanAttachmentReceiptResult {
  return Object.freeze({ ok: false as const, code });
}

/**
 * Strictly normalize a trusted attachment manifest. Extra fields fail closed so
 * a storage URL, local path, raw text, or byte payload cannot accidentally ride
 * this value-free contract.
 */
export function normalizeOpenSwanAttachmentSourceManifest(input: unknown): OpenSwanAttachmentManifestResult {
  try {
    if (!isRecord(input)) return failManifest('invalid_input');
    if (!hasExactKeys(input, MANIFEST_KEYS)) return failManifest('invalid_keys');
    if (readOwn(input, 'schemaVersion') !== 1) return failManifest('invalid_schema');

    const manifestId = readOwn(input, 'manifestId');
    if (!isSafeOpaqueId(manifestId)) return failManifest('invalid_manifest_id');
    const circleId = readOwn(input, 'circleId');
    const threadId = readOwn(input, 'threadId');
    const originLocalMessageId = readOwn(input, 'originLocalMessageId');
    if (
      !isSafeOpaqueId(circleId)
      || !isSafeOpaqueId(threadId)
      || !isSafeOpaqueId(originLocalMessageId)
    ) return failManifest('invalid_scope');

    const rawAttachments = readOwn(input, 'attachments');
    if (!Array.isArray(rawAttachments)) return failManifest('invalid_attachment_count');
    if (
      rawAttachments.length < 1
      || rawAttachments.length > OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxAttachments
    ) return failManifest('invalid_attachment_count');

    const attachmentIds = new Set<string>();
    const sourceHandleIds = new Set<string>();
    const attachments: OpenSwanAttachmentSourceManifestItem[] = [];
    for (let index = 0; index < rawAttachments.length; index += 1) {
      const rawAttachment = readIndex(rawAttachments, index);
      if (!isRecord(rawAttachment) || !hasExactKeys(rawAttachment, MANIFEST_ITEM_KEYS)) {
        return failManifest('invalid_attachment');
      }
      const attachmentId = readOwn(rawAttachment, 'attachmentId');
      if (!isSafeOpaqueId(attachmentId)) return failManifest('invalid_attachment_id');
      if (attachmentIds.has(attachmentId)) return failManifest('duplicate_attachment_id');

      const basename = readOwn(rawAttachment, 'basename');
      if (!isSafeBasename(basename)) return failManifest('unsafe_basename');
      const mimeType = normalizeMimeType(readOwn(rawAttachment, 'mimeType'));
      if (!mimeType) return failManifest('invalid_mime_type');
      const sizeBytes = readOwn(rawAttachment, 'sizeBytes');
      if (!isSizeBytes(sizeBytes)) return failManifest('invalid_size');
      const sha256 = normalizeSha256(readOwn(rawAttachment, 'sha256'));
      if (!sha256) return failManifest('invalid_sha256');
      const contentAvailability = readOwn(rawAttachment, 'contentAvailability');
      if (!isContentAvailability(contentAvailability)) return failManifest('invalid_content_availability');

      const rawSourceHandle = readOwn(rawAttachment, 'sourceHandle');
      if (!isRecord(rawSourceHandle) || !hasExactKeys(rawSourceHandle, SOURCE_HANDLE_KEYS)) {
        return failManifest('invalid_source_handle');
      }
      const sourceHandleKind = readOwn(rawSourceHandle, 'kind');
      const sourceHandleId = readOwn(rawSourceHandle, 'id');
      if (!isSourceHandleKind(sourceHandleKind) || !isSafeOpaqueId(sourceHandleId)) {
        return failManifest('invalid_source_handle');
      }
      if (!sourceHandleMatchesAvailability(sourceHandleKind, contentAvailability)) {
        return failManifest('incompatible_source_handle');
      }
      const rawSourceContentSha256 = readOwn(rawAttachment, 'sourceContentSha256');
      const sourceContentSha256 = rawSourceContentSha256 === null
        ? null
        : normalizeSha256(rawSourceContentSha256);
      if (rawSourceContentSha256 !== null && !sourceContentSha256) {
        return failManifest('invalid_source_content_binding');
      }
      const sourceContentBinding = readOwn(rawAttachment, 'sourceContentBinding');
      const sourceContentProvenance = normalizeSourceContentProvenance(
        readOwn(rawAttachment, 'sourceContentProvenance'),
      );
      if (
        !isSourceContentBinding(sourceContentBinding)
        || sourceContentProvenance === false
        || !sourceContentBindingMatchesSource(
          sourceContentBinding,
          sourceContentSha256,
          sourceContentProvenance,
          sourceHandleKind,
          contentAvailability,
        )
      ) return failManifest('invalid_source_content_binding');
      if (sourceHandleIds.has(sourceHandleId)) return failManifest('duplicate_source_handle_id');

      attachmentIds.add(attachmentId);
      sourceHandleIds.add(sourceHandleId);
      attachments.push(Object.freeze({
        attachmentId,
        basename,
        mimeType,
        sizeBytes,
        sha256,
        contentAvailability,
        sourceHandle: Object.freeze({ kind: sourceHandleKind, id: sourceHandleId }),
        sourceContentSha256,
        sourceContentBinding,
        sourceContentProvenance,
      }));
    }

    return Object.freeze({
      ok: true as const,
      manifest: Object.freeze({
        schemaVersion: 1 as const,
        manifestId,
        circleId,
        threadId,
        originLocalMessageId,
        attachments: Object.freeze(attachments),
      }),
    });
  } catch {
    return failManifest('invalid_input');
  }
}

/** Strict reader for persisted or cross-boundary value-free receipts. */
export function normalizeOpenSwanAttachmentSourceReceipt(input: unknown): OpenSwanAttachmentReceiptResult {
  try {
    if (!isRecord(input)) return failReceipt('invalid_input');
    if (!hasExactKeys(input, RECEIPT_KEYS)) return failReceipt('invalid_keys');
    if (readOwn(input, 'schemaVersion') !== 1) return failReceipt('invalid_schema');

    const evidenceId = readOwn(input, 'evidenceId');
    if (!isSafeOpaqueId(evidenceId, OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxEvidenceIdChars)) {
      return failReceipt('invalid_evidence_id');
    }
    const manifestId = readOwn(input, 'manifestId');
    if (!isSafeOpaqueId(manifestId)) return failReceipt('invalid_manifest_id');
    const circleId = readOwn(input, 'circleId');
    const threadId = readOwn(input, 'threadId');
    const originLocalMessageId = readOwn(input, 'originLocalMessageId');
    if (
      !isSafeOpaqueId(circleId)
      || !isSafeOpaqueId(threadId)
      || !isSafeOpaqueId(originLocalMessageId)
    ) return failReceipt('invalid_scope');
    const attachmentId = readOwn(input, 'attachmentId');
    if (!isSafeOpaqueId(attachmentId)) return failReceipt('invalid_attachment_id');
    const sha256 = normalizeSha256(readOwn(input, 'sha256'));
    if (!sha256) return failReceipt('invalid_sha256');
    const sizeBytes = readOwn(input, 'sizeBytes');
    if (!isSizeBytes(sizeBytes)) return failReceipt('invalid_size');
    const contentAvailability = readOwn(input, 'contentAvailability');
    if (!isContentAvailability(contentAvailability)) return failReceipt('invalid_content_availability');
    const sourceHandleKind = readOwn(input, 'sourceHandleKind');
    const sourceHandleId = readOwn(input, 'sourceHandleId');
    if (!isSourceHandleKind(sourceHandleKind) || !isSafeOpaqueId(sourceHandleId)) {
      return failReceipt('invalid_source_handle');
    }
    if (!sourceHandleMatchesAvailability(sourceHandleKind, contentAvailability)) {
      return failReceipt('invalid_source_handle');
    }
    const rawSourceContentSha256 = readOwn(input, 'sourceContentSha256');
    const sourceContentSha256 = rawSourceContentSha256 === null
      ? null
      : normalizeSha256(rawSourceContentSha256);
    const sourceContentBinding = readOwn(input, 'sourceContentBinding');
    const sourceContentProvenance = normalizeSourceContentProvenance(
      readOwn(input, 'sourceContentProvenance'),
    );
    if (
      (rawSourceContentSha256 !== null && !sourceContentSha256)
      || !isSourceContentBinding(sourceContentBinding)
      || sourceContentProvenance === false
      || !sourceContentBindingMatchesSource(
        sourceContentBinding,
        sourceContentSha256,
        sourceContentProvenance,
        sourceHandleKind,
        contentAvailability,
      )
    ) return failReceipt('invalid_source_content_binding');
    const access = readOwn(input, 'access');
    if (!isAccess(access)) return failReceipt('invalid_access');
    if (!accessMatchesSource(access, sourceHandleKind, contentAvailability)) {
      return failReceipt('incompatible_access');
    }
    const rawObservedSourceContentSha256 = readOwn(input, 'observedSourceContentSha256');
    const observedSourceContentSha256 = rawObservedSourceContentSha256 === null
      ? null
      : normalizeSha256(rawObservedSourceContentSha256);
    if (rawObservedSourceContentSha256 !== null && !observedSourceContentSha256) {
      return failReceipt('invalid_observed_source_content_sha256');
    }
    if (access === 'metadata') {
      if (observedSourceContentSha256 !== null) {
        return failReceipt('invalid_observed_source_content_sha256');
      }
    } else if (
      sourceContentSha256 === null
      || observedSourceContentSha256 === null
      || observedSourceContentSha256 !== sourceContentSha256
    ) {
      return failReceipt('observed_source_content_mismatch');
    }

    return Object.freeze({
      ok: true as const,
      receipt: Object.freeze({
        schemaVersion: 1 as const,
        evidenceId,
        manifestId,
        circleId,
        threadId,
        originLocalMessageId,
        attachmentId,
        sha256,
        sizeBytes,
        contentAvailability,
        sourceHandleKind,
        sourceHandleId,
        sourceContentSha256,
        sourceContentBinding,
        sourceContentProvenance,
        observedSourceContentSha256,
        access,
      }),
    });
  } catch {
    return failReceipt('invalid_input');
  }
}

/**
 * Mint a structurally bound receipt from one validated manifest item. For
 * content/visual access the caller must supply the digest of the final bounded
 * body actually presented to the model; a pre-redaction or post-seal body does
 * not match. This pure core intentionally cannot assert I/O occurred.
 */
export function createOpenSwanAttachmentSourceReceipt(input: unknown): OpenSwanAttachmentReceiptResult {
  try {
    if (!isRecord(input)) return failReceipt('invalid_input');
    if (!hasExactKeys(input, CREATE_RECEIPT_KEYS)) return failReceipt('invalid_keys');
    const manifestResult = normalizeOpenSwanAttachmentSourceManifest(readOwn(input, 'manifest'));
    if (!manifestResult.ok) return failReceipt('manifest_invalid');
    const attachmentId = readOwn(input, 'attachmentId');
    if (!isSafeOpaqueId(attachmentId)) return failReceipt('invalid_attachment_id');
    const evidenceId = readOwn(input, 'evidenceId');
    if (!isSafeOpaqueId(evidenceId, OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxEvidenceIdChars)) {
      return failReceipt('invalid_evidence_id');
    }
    const access = readOwn(input, 'access');
    if (!isAccess(access)) return failReceipt('invalid_access');
    const rawObservedSourceContentSha256 = readOwn(input, 'observedSourceContentSha256');
    const observedSourceContentSha256 = rawObservedSourceContentSha256 === null
      ? null
      : normalizeSha256(rawObservedSourceContentSha256);
    if (rawObservedSourceContentSha256 !== null && !observedSourceContentSha256) {
      return failReceipt('invalid_observed_source_content_sha256');
    }
    const attachment = manifestResult.manifest.attachments.find((candidate) => (
      candidate.attachmentId === attachmentId
    ));
    if (!attachment) return failReceipt('attachment_not_found');
    if (!accessMatchesSource(access, attachment.sourceHandle.kind, attachment.contentAvailability)) {
      return failReceipt('incompatible_access');
    }
    if (access === 'metadata') {
      if (observedSourceContentSha256 !== null) {
        return failReceipt('invalid_observed_source_content_sha256');
      }
    } else if (
      attachment.sourceContentSha256 === null
      || observedSourceContentSha256 === null
      || observedSourceContentSha256 !== attachment.sourceContentSha256
    ) {
      return failReceipt('observed_source_content_mismatch');
    }
    return normalizeOpenSwanAttachmentSourceReceipt({
      schemaVersion: 1,
      evidenceId,
      manifestId: manifestResult.manifest.manifestId,
      circleId: manifestResult.manifest.circleId,
      threadId: manifestResult.manifest.threadId,
      originLocalMessageId: manifestResult.manifest.originLocalMessageId,
      attachmentId: attachment.attachmentId,
      sha256: attachment.sha256,
      sizeBytes: attachment.sizeBytes,
      contentAvailability: attachment.contentAvailability,
      sourceHandleKind: attachment.sourceHandle.kind,
      sourceHandleId: attachment.sourceHandle.id,
      sourceContentSha256: attachment.sourceContentSha256,
      sourceContentBinding: attachment.sourceContentBinding,
      sourceContentProvenance: attachment.sourceContentProvenance,
      observedSourceContentSha256,
      access,
    });
  } catch {
    return failReceipt('invalid_input');
  }
}

/**
 * Project only safe attachment metadata for a model prompt. Circle/thread/user
 * scope and opaque source-handle identities stay runtime-private; no content,
 * path, URL, storage key, or byte field exists in the result.
 */
export function projectOpenSwanAttachmentSourceManifestForModel(
  input: unknown,
): OpenSwanAttachmentSourceModelProjection | null {
  const result = normalizeOpenSwanAttachmentSourceManifest(input);
  if (!result.ok) return null;
  return Object.freeze({
    schemaVersion: 1 as const,
    manifestId: result.manifest.manifestId,
    attachmentCount: result.manifest.attachments.length,
    attachments: Object.freeze(result.manifest.attachments.map((attachment) => Object.freeze({
      attachmentId: attachment.attachmentId,
      basename: attachment.basename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      sha256: attachment.sha256,
      contentAvailability: attachment.contentAvailability,
      sourceHandleKind: attachment.sourceHandle.kind,
    }))),
  });
}

function failResolution(reason: OpenSwanAttachmentSourceEvidenceFailure): OpenSwanAttachmentSourceEvidenceResolution {
  return Object.freeze({ ok: false as const, reason });
}

/**
 * Resolve one cited runtime evidence id against an exact attachment manifest.
 * Every scope, attachment-byte, source-body, and provenance field must match.
 * Only complete deterministic text or a complete trusted extractor result can
 * resolve as content-bound completion evidence. An evidence id is a single-use
 * selector here: duplicate rows are ambiguous and fail closed.
 */
export function resolveOpenSwanAttachmentSourceEvidence(
  input: unknown,
): OpenSwanAttachmentSourceEvidenceResolution {
  try {
    if (!isRecord(input)) return failResolution('invalid_input');
    if (!hasExactKeys(input, RESOLVE_KEYS)) return failResolution('invalid_keys');
    const manifestResult = normalizeOpenSwanAttachmentSourceManifest(readOwn(input, 'manifest'));
    if (!manifestResult.ok) return failResolution('manifest_invalid');
    const manifest = manifestResult.manifest;

    const expected = readOwn(input, 'expected');
    if (!isRecord(expected) || !hasExactKeys(expected, EXPECTED_KEYS)) {
      return failResolution('invalid_expected_identity');
    }
    const expectedManifestId = readOwn(expected, 'manifestId');
    const expectedCircleId = readOwn(expected, 'circleId');
    const expectedThreadId = readOwn(expected, 'threadId');
    const expectedOriginLocalMessageId = readOwn(expected, 'originLocalMessageId');
    const expectedAttachmentId = readOwn(expected, 'attachmentId');
    const expectedEvidenceId = readOwn(expected, 'evidenceId');
    const requiredAccess = readOwn(expected, 'requiredAccess');
    if (
      !isSafeOpaqueId(expectedManifestId)
      || !isSafeOpaqueId(expectedCircleId)
      || !isSafeOpaqueId(expectedThreadId)
      || !isSafeOpaqueId(expectedOriginLocalMessageId)
      || !isSafeOpaqueId(expectedAttachmentId)
      || !isSafeOpaqueId(expectedEvidenceId, OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxEvidenceIdChars)
      || !isAccess(requiredAccess)
    ) return failResolution('invalid_expected_identity');

    if (manifest.manifestId !== expectedManifestId) return failResolution('manifest_mismatch');
    if (
      manifest.circleId !== expectedCircleId
      || manifest.threadId !== expectedThreadId
      || manifest.originLocalMessageId !== expectedOriginLocalMessageId
    ) return failResolution('scope_mismatch');
    const attachment = manifest.attachments.find((candidate) => (
      candidate.attachmentId === expectedAttachmentId
    ));
    if (!attachment) return failResolution('attachment_not_found');

    const rawReceipts = readOwn(input, 'receipts');
    if (
      !Array.isArray(rawReceipts)
      || rawReceipts.length < 1
      || rawReceipts.length > OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxReceipts
    ) return failResolution('invalid_receipts');
    const receipts: OpenSwanAttachmentSourceReceipt[] = [];
    const evidenceIds = new Set<string>();
    for (let index = 0; index < rawReceipts.length; index += 1) {
      const receiptResult = normalizeOpenSwanAttachmentSourceReceipt(readIndex(rawReceipts, index));
      if (!receiptResult.ok) return failResolution('invalid_receipts');
      if (evidenceIds.has(receiptResult.receipt.evidenceId)) {
        return failResolution(
          receiptResult.receipt.evidenceId === expectedEvidenceId
            ? 'evidence_ambiguous'
            : 'duplicate_evidence_id',
        );
      }
      evidenceIds.add(receiptResult.receipt.evidenceId);
      receipts.push(receiptResult.receipt);
    }
    const matches = receipts.filter((receipt) => receipt.evidenceId === expectedEvidenceId);
    if (matches.length === 0) return failResolution('evidence_missing');
    if (matches.length !== 1) return failResolution('evidence_ambiguous');
    const receipt = matches[0];

    if (receipt.manifestId !== manifest.manifestId) return failResolution('evidence_manifest_mismatch');
    if (
      receipt.circleId !== manifest.circleId
      || receipt.threadId !== manifest.threadId
      || receipt.originLocalMessageId !== manifest.originLocalMessageId
    ) return failResolution('evidence_scope_mismatch');
    if (receipt.attachmentId !== attachment.attachmentId) {
      return failResolution('evidence_attachment_mismatch');
    }
    if (
      receipt.sha256 !== attachment.sha256
      || receipt.sizeBytes !== attachment.sizeBytes
      || receipt.contentAvailability !== attachment.contentAvailability
    ) return failResolution('evidence_content_identity_mismatch');
    if (
      receipt.sourceHandleKind !== attachment.sourceHandle.kind
      || receipt.sourceHandleId !== attachment.sourceHandle.id
    ) return failResolution('evidence_source_handle_mismatch');
    if (
      receipt.sourceContentSha256 !== attachment.sourceContentSha256
      || receipt.sourceContentBinding !== attachment.sourceContentBinding
      || receipt.sourceContentProvenance !== attachment.sourceContentProvenance
      || (
        receipt.access !== 'metadata'
        && receipt.observedSourceContentSha256 !== attachment.sourceContentSha256
      )
      || (receipt.access === 'metadata' && receipt.observedSourceContentSha256 !== null)
    ) return failResolution('evidence_source_content_mismatch');
    if (requiredAccess !== 'metadata' && attachment.contentAvailability === 'unavailable') {
      return failResolution('content_unavailable');
    }
    if (receipt.access !== requiredAccess) return failResolution('access_mismatch');

    return Object.freeze({
      ok: true as const,
      evidence: Object.freeze({
        evidenceId: receipt.evidenceId,
        manifestId: receipt.manifestId,
        attachmentId: receipt.attachmentId,
        sha256: receipt.sha256,
        sizeBytes: receipt.sizeBytes,
        sourceHandleKind: receipt.sourceHandleKind,
        sourceContentSha256: receipt.sourceContentSha256,
        sourceContentBinding: receipt.sourceContentBinding,
        sourceContentProvenance: receipt.sourceContentProvenance,
        observedSourceContentSha256: receipt.observedSourceContentSha256,
        access: receipt.access,
        identityBound: true as const,
        contentBound: receipt.access !== 'metadata'
          && receipt.observedSourceContentSha256 === receipt.sourceContentSha256
          && sourceContentCanProveCompletion(
            receipt.sourceContentBinding,
            receipt.contentAvailability,
          ),
      }),
    });
  } catch {
    return failResolution('invalid_input');
  }
}
