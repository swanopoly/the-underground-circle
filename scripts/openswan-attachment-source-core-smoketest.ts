/**
 * Pure smoke for the OpenSwan attachment-source identity foundation.
 *
 * No storage, bridge, provider, React Native, or Supabase dependency is used.
 * Run: npx tsx scripts/openswan-attachment-source-core-smoketest.ts
 */

import assert from 'node:assert/strict';
import {
  OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS,
  createOpenSwanAttachmentSourceReceipt,
  normalizeOpenSwanAttachmentSourceManifest,
  normalizeOpenSwanAttachmentSourceReceipt,
  projectOpenSwanAttachmentSourceManifestForModel,
  resolveOpenSwanAttachmentSourceEvidence,
  type OpenSwanAttachmentSourceManifest,
  type OpenSwanAttachmentSourceReceipt,
} from '../src/lib/openSwanAttachmentSourceCore';

let assertions = 0;

function check(condition: unknown, message: string): void {
  assertions += 1;
  assert.ok(condition, message);
  console.log('pass:', message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
  console.log('pass:', message);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const PDF_SHA = 'a'.repeat(64);
const TEXT_SHA = 'b'.repeat(64);
const IMAGE_SHA = 'c'.repeat(64);
const OBJECT_SHA = 'd'.repeat(64);
const META_SHA = 'e'.repeat(64);
const PDF_SOURCE_SHA = '1'.repeat(64);
const TEXT_SOURCE_SHA = '2'.repeat(64);
const IMAGE_SOURCE_SHA = '3'.repeat(64);

const rawManifest = {
  schemaVersion: 1,
  manifestId: 'attachment-manifest-1',
  circleId: 'circle-1',
  threadId: 'thread-1',
  originLocalMessageId: 'user-1723500000000-local',
  attachments: [
    {
      attachmentId: 'attachment-pdf',
      basename: 'Quarterly report.pdf',
      mimeType: 'APPLICATION/PDF',
      sizeBytes: 42_000,
      sha256: PDF_SHA.toUpperCase(),
      contentAvailability: 'complete',
      sourceHandle: { kind: 'inline_text', id: 'staged-pdf-1' },
      sourceContentSha256: PDF_SOURCE_SHA,
      sourceContentBinding: 'trusted_extractor',
      sourceContentProvenance: 'extractor:pdf-v1',
    },
    {
      attachmentId: 'attachment-text',
      basename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 900,
      sha256: TEXT_SHA,
      contentAvailability: 'partial',
      sourceHandle: { kind: 'inline_text', id: 'inline-text-1' },
      sourceContentSha256: TEXT_SOURCE_SHA,
      sourceContentBinding: 'deterministic_text',
      sourceContentProvenance: 'builtin:utf8-redacted-v1',
    },
    {
      attachmentId: 'attachment-image',
      basename: 'dashboard mockup.png',
      mimeType: 'image/png',
      sizeBytes: 800_000,
      sha256: IMAGE_SHA,
      contentAvailability: 'derived',
      sourceHandle: { kind: 'visual_brief', id: 'visual-brief-1' },
      sourceContentSha256: IMAGE_SOURCE_SHA,
      sourceContentBinding: 'derived_unbound',
      sourceContentProvenance: 'derived:visual-brief-v1',
    },
    {
      attachmentId: 'attachment-object',
      basename: 'archive.zip',
      mimeType: 'application/zip',
      sizeBytes: 1_200_000,
      sha256: OBJECT_SHA,
      contentAvailability: 'complete',
      sourceHandle: { kind: 'private_storage_object', id: 'private-object-1' },
      sourceContentSha256: null,
      sourceContentBinding: 'external_unverified',
      sourceContentProvenance: 'external:private-storage-v1',
    },
    {
      attachmentId: 'attachment-meta',
      basename: 'unknown.bin',
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sha256: META_SHA,
      contentAvailability: 'unavailable',
      sourceHandle: { kind: 'metadata_only', id: 'metadata-1' },
      sourceContentSha256: null,
      sourceContentBinding: 'none',
      sourceContentProvenance: null,
    },
  ],
};

const normalized = normalizeOpenSwanAttachmentSourceManifest(rawManifest);
check(normalized.ok, 'a complete strict manifest is admitted');
if (!normalized.ok) throw new Error(`fixture rejected: ${normalized.code}`);
const manifest: OpenSwanAttachmentSourceManifest = normalized.manifest;
equal(manifest.schemaVersion, 1, 'manifest schema is fixed at v1');
equal(manifest.manifestId, 'attachment-manifest-1', 'manifest identity is exact');
equal(manifest.circleId, 'circle-1', 'circle identity is exact');
equal(manifest.threadId, 'thread-1', 'thread identity is exact');
equal(manifest.originLocalMessageId, 'user-1723500000000-local', 'origin local message identity is exact');
equal(manifest.attachments.length, 5, 'all bounded attachment identities survive');
equal(manifest.attachments[0].mimeType, 'application/pdf', 'MIME essence is canonical lowercase');
equal(manifest.attachments[0].sha256, PDF_SHA, 'SHA-256 is canonical lowercase');
check(Object.isFrozen(manifest), 'manifest is frozen');
check(Object.isFrozen(manifest.attachments), 'manifest attachment array is frozen');
check(Object.isFrozen(manifest.attachments[0]), 'manifest attachment rows are frozen');
check(Object.isFrozen(manifest.attachments[0].sourceHandle), 'source handles are frozen');

const normalizedAgain = normalizeOpenSwanAttachmentSourceManifest(rawManifest);
check(normalizedAgain.ok, 'normalization is deterministic on repeated input');
if (normalizedAgain.ok) {
  equal(JSON.stringify(normalizedAgain.manifest), JSON.stringify(manifest), 'deterministic manifests are byte-identical JSON');
}

const projection = projectOpenSwanAttachmentSourceManifestForModel(manifest);
check(projection !== null, 'a valid manifest produces a model-facing projection');
if (!projection) throw new Error('projection missing');
equal(projection.attachmentCount, 5, 'projection states the exact attachment count');
equal(projection.attachments[0].attachmentId, 'attachment-pdf', 'projection preserves opaque attachment identity');
equal(projection.attachments[0].sha256, PDF_SHA, 'projection preserves exact content hash');
equal(projection.attachments[0].sourceHandleKind, 'inline_text', 'projection states only the source-handle kind');
check(!('circleId' in projection), 'model projection omits circle scope identity');
check(!('threadId' in projection), 'model projection omits thread scope identity');
check(!('originLocalMessageId' in projection), 'model projection omits local message identity');
check(!('sourceHandle' in projection.attachments[0]), 'model projection omits the opaque internal handle');
check(!('sourceHandleId' in projection.attachments[0]), 'model projection has no handle-id alias');
const projectionJson = JSON.stringify(projection);
check(!/storagePath|signedUrl|localPath|base64|rawBytes|extractedText|ocrText/.test(projectionJson), 'projection cannot carry raw content or address fields');
check(!/sourceContentSha256|sourceContentBinding|sourceContentProvenance/.test(projectionJson), 'projection omits runtime-private source-body binding fields');
check(!projectionJson.includes('staged-pdf-1'), 'projection does not leak the internal staged-file handle');
check(Object.isFrozen(projection) && Object.isFrozen(projection.attachments), 'model projection is immutable');

function expectManifestFailure(candidate: unknown, code: string, message: string): void {
  const result = normalizeOpenSwanAttachmentSourceManifest(candidate);
  check(!result.ok && result.code === code, message);
}

expectManifestFailure(null, 'invalid_input', 'null manifest fails closed');
expectManifestFailure([], 'invalid_input', 'array manifest fails closed');
expectManifestFailure({ ...rawManifest, storagePath: 'private/path' }, 'invalid_keys', 'extra storage-path field is rejected');
expectManifestFailure({ ...rawManifest, rawBytes: 'AAAA' }, 'invalid_keys', 'extra raw-byte field is rejected');
expectManifestFailure({ ...rawManifest, schemaVersion: 2 }, 'invalid_schema', 'unknown schema fails closed');
expectManifestFailure({ ...rawManifest, manifestId: '../manifest' }, 'invalid_manifest_id', 'path-shaped manifest id is rejected');
expectManifestFailure({ ...rawManifest, circleId: 'circle/other' }, 'invalid_scope', 'unsafe circle scope is rejected');
expectManifestFailure({ ...rawManifest, threadId: 'thread other' }, 'invalid_scope', 'unsafe thread scope is rejected');
expectManifestFailure({ ...rawManifest, originLocalMessageId: 'https://message' }, 'invalid_scope', 'URL-shaped origin identity is rejected');
expectManifestFailure({ ...rawManifest, attachments: [] }, 'invalid_attachment_count', 'empty manifest is rejected');
expectManifestFailure({
  ...rawManifest,
  attachments: Array.from({ length: OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxAttachments + 1 }, (_, index) => ({
    ...rawManifest.attachments[0],
    attachmentId: `attachment-${index}`,
    sourceHandle: { kind: 'desktop_staged_file', id: `handle-${index}` },
  })),
}, 'invalid_attachment_count', 'oversized manifest is rejected');

function manifestWithItem(patch: Record<string, unknown>, index = 0): unknown {
  const candidate = clone(rawManifest);
  candidate.attachments[index] = { ...candidate.attachments[index], ...patch } as never;
  return candidate;
}

expectManifestFailure(manifestWithItem({ extra: true }), 'invalid_attachment', 'extra attachment fields are rejected');
expectManifestFailure(manifestWithItem({ attachmentId: 'attachment/1' }), 'invalid_attachment_id', 'unsafe attachment id is rejected');
expectManifestFailure(manifestWithItem({ basename: '../secrets.pdf' }), 'unsafe_basename', 'traversal basename is rejected');
expectManifestFailure(manifestWithItem({ basename: '/tmp/report.pdf' }), 'unsafe_basename', 'absolute path basename is rejected');
expectManifestFailure(manifestWithItem({ basename: 'C:\\private\\report.pdf' }), 'unsafe_basename', 'Windows path basename is rejected');
expectManifestFailure(manifestWithItem({ basename: 'data:image/png;base64,AAAA' }), 'unsafe_basename', 'data URI basename is rejected');
expectManifestFailure(manifestWithItem({ basename: 'report\u202eexe.pdf' }), 'unsafe_basename', 'bidi-control basename is rejected');
expectManifestFailure(manifestWithItem({ basename: 'report\u200b.pdf' }), 'unsafe_basename', 'zero-width basename smuggling is rejected');
expectManifestFailure(manifestWithItem({ basename: `report${String.fromCodePoint(0xe0001)}.pdf` }), 'unsafe_basename', 'Unicode tag basename smuggling is rejected');
expectManifestFailure(manifestWithItem({ basename: ' report.pdf ' }), 'unsafe_basename', 'noncanonical surrounding basename whitespace is rejected');
expectManifestFailure(manifestWithItem({ basename: 'x'.repeat(OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxBasenameChars + 1) }), 'unsafe_basename', 'oversized basename is rejected');
expectManifestFailure(manifestWithItem({ mimeType: 'application/pdf; charset=utf-8' }), 'invalid_mime_type', 'MIME parameters are rejected from the essence field');
expectManifestFailure(manifestWithItem({ mimeType: 'pdf' }), 'invalid_mime_type', 'malformed MIME type is rejected');
expectManifestFailure(manifestWithItem({ sizeBytes: -1 }), 'invalid_size', 'negative size is rejected');
expectManifestFailure(manifestWithItem({ sizeBytes: 1.5 }), 'invalid_size', 'fractional size is rejected');
expectManifestFailure(manifestWithItem({ sizeBytes: OPEN_SWAN_ATTACHMENT_SOURCE_LIMITS.maxSizeBytes + 1 }), 'invalid_size', 'oversized content is rejected');
expectManifestFailure(manifestWithItem({ sha256: 'f'.repeat(63) }), 'invalid_sha256', 'short digest is rejected');
expectManifestFailure(manifestWithItem({ sha256: 'z'.repeat(64) }), 'invalid_sha256', 'nonhex digest is rejected');
expectManifestFailure(manifestWithItem({ contentAvailability: 'maybe' }), 'invalid_content_availability', 'unknown availability is rejected');
expectManifestFailure(manifestWithItem({ sourceHandle: { kind: 'desktop_staged_file', id: '/tmp/report.pdf' } }), 'invalid_source_handle', 'raw local path cannot be a source handle id');
expectManifestFailure(manifestWithItem({ sourceHandle: { kind: 'desktop_staged_file', id: 'https://storage.example/object' } }), 'invalid_source_handle', 'storage URL cannot be a source handle id');
expectManifestFailure(manifestWithItem({ sourceHandle: { kind: 'other', id: 'opaque-1' } }), 'invalid_source_handle', 'unknown source handle kind is rejected');
expectManifestFailure(manifestWithItem({ sourceHandle: { kind: 'metadata_only', id: 'opaque-1' } }), 'incompatible_source_handle', 'metadata-only handle cannot claim complete content');
expectManifestFailure(manifestWithItem({ contentAvailability: 'derived' }), 'incompatible_source_handle', 'staged file cannot claim only derived availability');
expectManifestFailure(manifestWithItem({ sourceContentSha256: null }), 'invalid_source_content_binding', 'readable inline source requires a sealed model-content digest');
expectManifestFailure(manifestWithItem({ sourceContentBinding: 'derived_unbound' }), 'invalid_source_content_binding', 'exact extractor output cannot be relabelled as an unbound derivation');
expectManifestFailure(manifestWithItem({ sourceContentProvenance: '/tmp/extractor' }), 'invalid_source_content_binding', 'source provenance cannot carry an executable or local path');

const duplicateAttachment = clone(rawManifest);
duplicateAttachment.attachments[1].attachmentId = duplicateAttachment.attachments[0].attachmentId;
expectManifestFailure(duplicateAttachment, 'duplicate_attachment_id', 'duplicate attachment identity is rejected as ambiguous');
const duplicateHandle = clone(rawManifest);
duplicateHandle.attachments[1].sourceHandle.id = duplicateHandle.attachments[0].sourceHandle.id;
expectManifestFailure(duplicateHandle, 'duplicate_source_handle_id', 'duplicate internal handle identity is rejected as ambiguous');
const sameContentHash = clone(rawManifest);
sameContentHash.attachments[1].sha256 = sameContentHash.attachments[0].sha256;
check(normalizeOpenSwanAttachmentSourceManifest(sameContentHash).ok, 'two distinct attachments may legitimately contain identical bytes');

const revokedManifestProxy = Proxy.revocable({}, {});
revokedManifestProxy.revoke();
expectManifestFailure(revokedManifestProxy.proxy, 'invalid_input', 'revoked manifest proxy fails closed without throwing');
const hostileManifest = new Proxy({}, { ownKeys() { throw new Error('hostile ownKeys'); } });
expectManifestFailure(hostileManifest, 'invalid_keys', 'hostile manifest key enumeration fails closed');

function mint(attachmentId: string, evidenceId: string, access: 'metadata' | 'content' | 'visual') {
  const item = manifest.attachments.find((candidate) => candidate.attachmentId === attachmentId);
  return createOpenSwanAttachmentSourceReceipt({
    manifest,
    attachmentId,
    evidenceId,
    access,
    observedSourceContentSha256: access === 'metadata' ? null : item?.sourceContentSha256 ?? null,
  });
}

const pdfReceiptResult = mint('attachment-pdf', 'toolu-pdf-read', 'content');
check(pdfReceiptResult.ok, 'runtime can mint a content receipt for the exact staged PDF');
if (!pdfReceiptResult.ok) throw new Error(pdfReceiptResult.code);
const pdfReceipt: OpenSwanAttachmentSourceReceipt = pdfReceiptResult.receipt;
equal(pdfReceipt.manifestId, manifest.manifestId, 'receipt copies exact manifest identity');
equal(pdfReceipt.circleId, manifest.circleId, 'receipt copies exact circle scope');
equal(pdfReceipt.threadId, manifest.threadId, 'receipt copies exact thread scope');
equal(pdfReceipt.originLocalMessageId, manifest.originLocalMessageId, 'receipt copies exact origin-message scope');
equal(pdfReceipt.attachmentId, 'attachment-pdf', 'receipt binds exact attachment id');
equal(pdfReceipt.sha256, PDF_SHA, 'receipt binds exact content digest');
equal(pdfReceipt.sizeBytes, 42_000, 'receipt binds exact byte count');
equal(pdfReceipt.sourceHandleId, 'staged-pdf-1', 'receipt privately binds exact source handle');
equal(pdfReceipt.sourceContentSha256, PDF_SOURCE_SHA, 'receipt binds the exact model-visible source body');
equal(pdfReceipt.observedSourceContentSha256, PDF_SOURCE_SHA, 'receipt records the body the runtime actually presented');
equal(pdfReceipt.sourceContentProvenance, 'extractor:pdf-v1', 'receipt retains value-free extractor provenance');
equal(pdfReceipt.access, 'content', 'receipt records content access rather than metadata access');
check(Object.isFrozen(pdfReceipt), 'minted receipt is immutable');

check(mint('attachment-text', 'toolu-text-read', 'content').ok, 'inline text can mint a content receipt');
check(mint('attachment-image', 'toolu-image-observe', 'visual').ok, 'visual brief can mint a visual receipt');
check(!mint('attachment-object', 'toolu-object-read', 'content').ok, 'unobserved private object cannot mint a model-content receipt');
check(mint('attachment-meta', 'toolu-meta-stat', 'metadata').ok, 'metadata-only attachment can mint a metadata receipt');
check(!mint('attachment-image', 'toolu-image-content', 'content').ok, 'visual brief cannot masquerade as raw content access');
check(!mint('attachment-pdf', 'toolu-pdf-visual', 'visual').ok, 'staged file cannot masquerade as visual observation');
check(!mint('attachment-meta', 'toolu-meta-content', 'content').ok, 'unavailable content cannot mint a content receipt');
const missingMint = mint('attachment-missing', 'toolu-missing', 'content');
check(!missingMint.ok && missingMint.code === 'attachment_not_found', 'receipt minting rejects an unknown attachment');
const badMint = createOpenSwanAttachmentSourceReceipt({ manifest, attachmentId: 'attachment-pdf', evidenceId: '../tool', access: 'content', observedSourceContentSha256: PDF_SOURCE_SHA });
check(!badMint.ok && badMint.code === 'invalid_evidence_id', 'receipt minting rejects unsafe evidence identity');
const extraMint = createOpenSwanAttachmentSourceReceipt({ manifest, attachmentId: 'attachment-pdf', evidenceId: 'toolu-ok', access: 'content', observedSourceContentSha256: PDF_SOURCE_SHA, path: '/tmp' });
check(!extraMint.ok && extraMint.code === 'invalid_keys', 'receipt minting rejects extra path authority');
const missingObservedMint = createOpenSwanAttachmentSourceReceipt({ manifest, attachmentId: 'attachment-pdf', evidenceId: 'toolu-missing-observed', access: 'content', observedSourceContentSha256: null });
check(!missingObservedMint.ok && missingObservedMint.code === 'observed_source_content_mismatch', 'content receipt requires the digest actually presented to the model');
const alteredObservedMint = createOpenSwanAttachmentSourceReceipt({ manifest, attachmentId: 'attachment-pdf', evidenceId: 'toolu-altered-observed', access: 'content', observedSourceContentSha256: '9'.repeat(64) });
check(!alteredObservedMint.ok && alteredObservedMint.code === 'observed_source_content_mismatch', 'redacted or otherwise altered presentation cannot reuse the pre-change receipt');

const normalizedReceipt = normalizeOpenSwanAttachmentSourceReceipt(pdfReceipt);
check(normalizedReceipt.ok, 'strict receipt reader accepts a canonical receipt');
if (normalizedReceipt.ok) {
  equal(JSON.stringify(normalizedReceipt.receipt), JSON.stringify(pdfReceipt), 'receipt round-trip is deterministic');
}

function receiptPatch(patch: Record<string, unknown>): unknown {
  return { ...pdfReceipt, ...patch };
}

function expectReceiptFailure(candidate: unknown, code: string, message: string): void {
  const result = normalizeOpenSwanAttachmentSourceReceipt(candidate);
  check(!result.ok && result.code === code, message);
}

expectReceiptFailure(null, 'invalid_input', 'null receipt fails closed');
expectReceiptFailure({ ...pdfReceipt, storageUrl: 'https://example.test/private' }, 'invalid_keys', 'receipt cannot carry storage URL');
expectReceiptFailure(receiptPatch({ schemaVersion: 2 }), 'invalid_schema', 'receipt rejects unknown schema');
expectReceiptFailure(receiptPatch({ evidenceId: 'tool use' }), 'invalid_evidence_id', 'receipt rejects unsafe evidence id');
expectReceiptFailure(receiptPatch({ manifestId: '../manifest' }), 'invalid_manifest_id', 'receipt rejects unsafe manifest id');
expectReceiptFailure(receiptPatch({ threadId: 'thread/other' }), 'invalid_scope', 'receipt rejects unsafe scope');
expectReceiptFailure(receiptPatch({ attachmentId: 'attachment/other' }), 'invalid_attachment_id', 'receipt rejects unsafe attachment id');
expectReceiptFailure(receiptPatch({ sha256: '0'.repeat(63) }), 'invalid_sha256', 'receipt rejects malformed digest');
expectReceiptFailure(receiptPatch({ sizeBytes: -1 }), 'invalid_size', 'receipt rejects invalid size');
expectReceiptFailure(receiptPatch({ contentAvailability: 'unknown' }), 'invalid_content_availability', 'receipt rejects unknown availability');
expectReceiptFailure(receiptPatch({ sourceHandleId: '/tmp/report.pdf' }), 'invalid_source_handle', 'receipt rejects path-shaped handle');
expectReceiptFailure(receiptPatch({ sourceHandleKind: 'metadata_only' }), 'invalid_source_handle', 'receipt rejects incompatible handle and availability');
expectReceiptFailure(receiptPatch({ sourceContentSha256: null }), 'invalid_source_content_binding', 'receipt rejects a missing model-content digest');
expectReceiptFailure(receiptPatch({ sourceContentBinding: 'derived_unbound' }), 'invalid_source_content_binding', 'receipt rejects incompatible source-content provenance');
expectReceiptFailure(receiptPatch({ observedSourceContentSha256: '9'.repeat(64) }), 'observed_source_content_mismatch', 'receipt rejects a presented body that differs from the sealed source');
expectReceiptFailure(receiptPatch({ access: 'execute' }), 'invalid_access', 'receipt rejects unknown access type');
expectReceiptFailure(receiptPatch({
  sourceHandleKind: 'visual_brief',
  contentAvailability: 'derived',
  sourceContentBinding: 'derived_unbound',
  sourceContentProvenance: 'derived:visual-brief-v1',
  access: 'content',
}), 'incompatible_access', 'receipt rejects content access through visual-only evidence');
const revokedReceiptProxy = Proxy.revocable({}, {});
revokedReceiptProxy.revoke();
expectReceiptFailure(revokedReceiptProxy.proxy, 'invalid_input', 'revoked receipt proxy fails closed without throwing');

function expectedFor(
  attachmentId: string,
  evidenceId: string,
  requiredAccess: 'metadata' | 'content' | 'visual',
) {
  return {
    manifestId: manifest.manifestId,
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    originLocalMessageId: manifest.originLocalMessageId,
    attachmentId,
    evidenceId,
    requiredAccess,
  };
}

const pdfResolution = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [pdfReceipt],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
});
check(pdfResolution.ok, 'exact receipt resolves against exact manifest identity and hash');
if (pdfResolution.ok) {
  equal(pdfResolution.evidence.evidenceId, 'toolu-pdf-read', 'resolved evidence retains exact runtime event id');
  equal(pdfResolution.evidence.attachmentId, 'attachment-pdf', 'resolved evidence retains exact attachment id');
  equal(pdfResolution.evidence.sha256, PDF_SHA, 'resolved evidence retains exact content digest');
  check(pdfResolution.evidence.identityBound, 'resolved evidence is explicitly identity-bound');
  check(pdfResolution.evidence.contentBound, 'content receipt is explicitly content-bound');
  check(Object.isFrozen(pdfResolution.evidence), 'resolved evidence is immutable');
}

const imageReceiptResult = mint('attachment-image', 'toolu-image-observe', 'visual');
if (!imageReceiptResult.ok) throw new Error(imageReceiptResult.code);
const imageResolution = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [pdfReceipt, imageReceiptResult.receipt],
  expected: expectedFor('attachment-image', 'toolu-image-observe', 'visual'),
});
check(imageResolution.ok, 'visual evidence resolves only for the exact image brief');
if (imageResolution.ok) check(!imageResolution.evidence.contentBound, 'independently supplied visual derivation cannot prove exact image-content completion');
const metaReceiptResult = mint('attachment-meta', 'toolu-meta-stat', 'metadata');
if (!metaReceiptResult.ok) throw new Error(metaReceiptResult.code);
const metadataResolution = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [metaReceiptResult.receipt],
  expected: expectedFor('attachment-meta', 'toolu-meta-stat', 'metadata'),
});
check(metadataResolution.ok, 'metadata evidence resolves for metadata-only attachment');
if (metadataResolution.ok) check(!metadataResolution.evidence.contentBound, 'metadata evidence never claims content binding');

function expectResolutionFailure(
  candidate: unknown,
  reason: string,
  message: string,
): void {
  const result = resolveOpenSwanAttachmentSourceEvidence(candidate);
  check(!result.ok && result.reason === reason, message);
}

expectResolutionFailure(null, 'invalid_input', 'null resolution input fails closed');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'), extra: true }, 'invalid_keys', 'extra resolution fields fail closed');
expectResolutionFailure({ manifest: { ...manifest, storagePath: '/tmp/report.pdf' }, receipts: [pdfReceipt], expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content') }, 'manifest_invalid', 'resolver rejects a manifest carrying raw path data');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: { ...expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'), manifestId: 'other-manifest' } }, 'manifest_mismatch', 'expected manifest id cannot cross-bind');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: { ...expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'), circleId: 'circle-other' } }, 'scope_mismatch', 'expected circle cannot cross-bind');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: { ...expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'), threadId: 'thread-other' } }, 'scope_mismatch', 'expected thread cannot cross-bind');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: { ...expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'), originLocalMessageId: 'user-other' } }, 'scope_mismatch', 'expected origin message cannot cross-bind');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: expectedFor('attachment-other', 'toolu-pdf-read', 'content') }, 'attachment_not_found', 'unknown expected attachment fails closed');
expectResolutionFailure({ manifest, receipts: [], expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content') }, 'invalid_receipts', 'empty receipt list fails closed');
expectResolutionFailure({ manifest, receipts: [{ ...pdfReceipt, rawBytes: 'AAAA' }], expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content') }, 'invalid_receipts', 'receipt with raw bytes invalidates the evidence set');
expectResolutionFailure({ manifest, receipts: [pdfReceipt], expected: expectedFor('attachment-pdf', 'toolu-missing', 'content') }, 'evidence_missing', 'unknown cited evidence id fails closed');
expectResolutionFailure({ manifest, receipts: [pdfReceipt, clone(pdfReceipt)], expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content') }, 'evidence_ambiguous', 'duplicate cited evidence ids fail closed as ambiguous');
expectResolutionFailure({
  manifest,
  receipts: [pdfReceipt, imageReceiptResult.receipt, clone(imageReceiptResult.receipt)],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'duplicate_evidence_id', 'duplicate unrelated evidence ids invalidate the bounded evidence set');

expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ manifestId: 'attachment-manifest-other' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_manifest_mismatch', 'receipt from another manifest cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ circleId: 'circle-other' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_scope_mismatch', 'receipt from another circle cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ threadId: 'thread-other' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_scope_mismatch', 'receipt from another thread cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ originLocalMessageId: 'user-other' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_scope_mismatch', 'receipt from another user message cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ attachmentId: 'attachment-object' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_attachment_mismatch', 'receipt for another attachment cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ sha256: 'f'.repeat(64) })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_content_identity_mismatch', 'receipt with another digest cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ sizeBytes: 42_001 })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_content_identity_mismatch', 'receipt with another byte count cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ sourceHandleId: 'staged-pdf-other' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_source_handle_mismatch', 'receipt from another internal source handle cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({ sourceHandleKind: 'private_storage_object' })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'invalid_receipts', 'structurally incompatible source-surface receipt is rejected before cross-binding');
expectResolutionFailure({
  manifest,
  receipts: [receiptPatch({
    sourceContentSha256: '9'.repeat(64),
    observedSourceContentSha256: '9'.repeat(64),
  })],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'content'),
}, 'evidence_source_content_mismatch', 'a self-consistent receipt for a different presented body cannot cross-bind');
expectResolutionFailure({
  manifest,
  receipts: [pdfReceipt],
  expected: expectedFor('attachment-pdf', 'toolu-pdf-read', 'metadata'),
}, 'access_mismatch', 'content and metadata receipts are not interchangeable');
expectResolutionFailure({
  manifest,
  receipts: [metaReceiptResult.receipt],
  expected: expectedFor('attachment-meta', 'toolu-meta-stat', 'content'),
}, 'content_unavailable', 'metadata-only source can never satisfy required content evidence');

const hostileResolve = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('hostile descriptor'); } });
expectResolutionFailure(hostileResolve, 'invalid_keys', 'hostile resolution object fails closed without throwing');

console.log(`\nAll OpenSwan attachment-source core smoke cases passed (${assertions} assertions).`);
