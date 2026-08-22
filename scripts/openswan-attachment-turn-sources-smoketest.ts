/**
 * Behavioral smoke for the sealed Chat-turn attachment-source assembler.
 *
 * No storage, network, filesystem, React Native, Supabase, or provider access
 * is used. Bytes and SHA-256 are injected at the boundary.
 * Run: npx tsx scripts/openswan-attachment-turn-sources-smoketest.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS,
  assembleOpenSwanAttachmentTurnSources,
  type OpenSwanAttachmentByteRequest,
  type OpenSwanAttachmentDigestOutput,
  type OpenSwanAttachmentTurnSourceDependencies,
  type OpenSwanAttachmentTurnSourceErrorCode,
  type OpenSwanAttachmentTurnSourcesInput,
} from '../src/lib/openSwanAttachmentTurnSources';
import {
  createOpenSwanAttachmentSourceReceipt,
  resolveOpenSwanAttachmentSourceEvidence,
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

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256Hex(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function digestSha256(value: Uint8Array): Promise<OpenSwanAttachmentDigestOutput> {
  return Uint8Array.from(createHash('sha256').update(value).digest());
}

const CIRCLE_ID = 'circle-source-1';
const THREAD_ID = 'thread-source-1';
const ORIGIN_ID = 'local-user-message-1';
const MANIFEST_ID = 'attachment-manifest-turn-1';

const PICKER_TEXT = 'Picker extracted text stays runtime-private.';
const STAGED_TEXT = 'Staged extracted text stays runtime-private.';
const pickerBytes = bytes(PICKER_TEXT);
const stagedBytes = bytes(STAGED_TEXT);
const imageBytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const pdfBytes = bytes('%PDF-1.7');

function baseInput(): OpenSwanAttachmentTurnSourcesInput {
  return {
    manifestId: MANIFEST_ID,
    circleId: CIRCLE_ID,
    threadId: THREAD_ID,
    originLocalMessageId: ORIGIN_ID,
    mediaAttachments: [],
    stagedFiles: [],
    visualBriefs: [],
  };
}

function pickerTextInput() {
  return {
    id: 'picker-text-1',
    name: 'picked notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    extractText: PICKER_TEXT,
    extractTextComplete: true,
    byteSourceId: 'picker-byte-source-1',
  } as const;
}

function stagedTextInput() {
  return {
    id: 'staged-local-1',
    name: 'uploaded notes.txt',
    mimeType: 'text/plain',
    sizeBytes: stagedBytes.byteLength,
    uploading: false,
    error: null,
    attachment: {
      id: 'db-attachment-text-1',
      circleId: CIRCLE_ID,
      threadId: THREAD_ID,
      originalName: 'uploaded notes.txt',
      mimeType: 'text/plain',
      sizeBytes: stagedBytes.byteLength,
      extractText: STAGED_TEXT,
      extractTextComplete: true,
    },
    exactBytes: stagedBytes,
  } as const;
}

function stagedMediaMirror() {
  return {
    id: 'media-shadow-text-1',
    uploadedAttachmentId: 'db-attachment-text-1',
    name: 'uploaded notes.txt',
    mimeType: 'TEXT/PLAIN',
    size: stagedBytes.byteLength,
    extractText: STAGED_TEXT,
    extractTextComplete: true,
    exactBytes: stagedBytes,
  } as const;
}

function imageInput() {
  return {
    id: 'picker-image-1',
    name: 'mockup.png',
    mimeType: 'image/png',
    size: imageBytes.byteLength,
    exactBytes: imageBytes,
  } as const;
}

function pdfInput() {
  return {
    id: 'picker-pdf-1',
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    size: pdfBytes.byteLength,
    exactBytes: pdfBytes,
  } as const;
}

function visualInput() {
  return {
    attachmentId: 'picker-image-1',
    version: 1 as const,
    fileName: 'mockup.png',
    observation: 'A blue dashboard. See https://private.example.test/a and /Users/casey/mockup.png password=hunterhunter.',
    redactionApplied: false,
  } as const;
}

function fullInput(): OpenSwanAttachmentTurnSourcesInput {
  return {
    ...baseInput(),
    mediaAttachments: [pickerTextInput(), stagedMediaMirror(), imageInput(), pdfInput()],
    stagedFiles: [stagedTextInput()],
    visualBriefs: [visualInput()],
  };
}

function singleMediaInput(media: Record<string, unknown>): unknown {
  return {
    ...baseInput(),
    mediaAttachments: [media],
  };
}

async function expectFailure(
  input: unknown,
  code: OpenSwanAttachmentTurnSourceErrorCode,
  message: string,
  dependencies: OpenSwanAttachmentTurnSourceDependencies = { digestSha256 },
): Promise<void> {
  const result = await assembleOpenSwanAttachmentTurnSources(input, dependencies);
  check(!result.ok && result.code === code, message);
}

async function main(): Promise<void> {
  const resolvedRequests: OpenSwanAttachmentByteRequest[] = [];
  let digestCalls = 0;
  const result = await assembleOpenSwanAttachmentTurnSources(fullInput(), {
    async digestSha256(value) {
      digestCalls += 1;
      return digestSha256(value);
    },
    async resolveBytes(request) {
      resolvedRequests.push(request);
      return request.byteSourceId === 'picker-byte-source-1' ? pickerBytes : null;
    },
  });
  check(result.ok, 'media, staged, visual, and PDF sources assemble as one sealed turn');
  if (!result.ok) throw new Error(result.code);

  equal(result.manifest.manifestId, MANIFEST_ID, 'manifest preserves the exact caller identity');
  equal(result.manifest.circleId, CIRCLE_ID, 'manifest binds the exact circle');
  equal(result.manifest.threadId, THREAD_ID, 'manifest binds the exact thread');
  equal(result.manifest.originLocalMessageId, ORIGIN_ID, 'manifest binds the exact local origin message');
  equal(result.manifest.attachments.length, 4, 'the same durable upload in media and staged lanes is deduplicated once');
  equal(digestCalls, 8, 'exact bytes and all three model-visible source bodies receive independent SHA-256 digests');
  equal(resolvedRequests.length, 1, 'only the picker source without exact bytes invokes async byte lookup');
  equal(resolvedRequests[0].lane, 'media', 'byte lookup is bound to the exact source lane');
  equal(resolvedRequests[0].attachmentId, 'picker-text-1', 'byte lookup is bound to the exact attachment identity');
  equal(resolvedRequests[0].byteSourceId, 'picker-byte-source-1', 'byte lookup uses only an opaque source identity');
  equal(resolvedRequests[0].sizeBytes, pickerBytes.byteLength, 'byte lookup binds the expected byte count');
  check(Object.isFrozen(resolvedRequests[0]), 'the injected byte request is immutable');

  const picker = result.manifest.attachments.find((item) => item.attachmentId === 'picker-text-1');
  const staged = result.manifest.attachments.find((item) => item.attachmentId === 'db-attachment-text-1');
  const image = result.manifest.attachments.find((item) => item.attachmentId === 'picker-image-1');
  const pdf = result.manifest.attachments.find((item) => item.attachmentId === 'picker-pdf-1');
  check(Boolean(picker && staged && image && pdf), 'every canonical attachment identity is present');
  if (!picker || !staged || !image || !pdf) throw new Error('fixture attachment missing');

  equal(picker.sha256, sha256Hex(pickerBytes), 'async picker bytes receive the exact SHA-256 identity');
  equal(staged.sha256, sha256Hex(stagedBytes), 'staged bytes receive the exact SHA-256 identity');
  equal(image.sha256, sha256Hex(imageBytes), 'image bytes receive the exact SHA-256 identity');
  equal(pdf.sha256, sha256Hex(pdfBytes), 'PDF bytes receive the exact SHA-256 identity');
  equal(staged.mimeType, 'text/plain', 'MIME essence is canonicalized after cross-lane deduplication');

  equal(picker.sourceHandle.kind, 'inline_text', 'picker extracted text becomes a private inline source');
  equal(picker.contentAvailability, 'complete', 'complete picker extraction is represented exactly');
  equal(
    result.privateSourcesByHandle[picker.sourceHandle.id],
    PICKER_TEXT,
    'picker text is available only through its private opaque handle',
  );
  equal(picker.sourceContentBinding, 'deterministic_text', 'picker text is deterministically derived from exact bytes');
  equal(picker.sourceContentProvenance, 'builtin:utf8-redacted-v1', 'picker text records the exact built-in transform version');
  equal(picker.sourceContentSha256, sha256Hex(bytes(PICKER_TEXT)), 'picker source digest binds the exact released body');
  equal(staged.sourceHandle.kind, 'inline_text', 'staged extracted text becomes a private inline source');
  equal(staged.contentAvailability, 'complete', 'complete staged extraction is represented exactly');
  equal(
    result.privateSourcesByHandle[staged.sourceHandle.id],
    STAGED_TEXT,
    'staged text is available only through its private opaque handle',
  );
  equal(staged.sourceContentBinding, 'deterministic_text', 'staged text is deterministically derived from exact bytes');
  equal(staged.sourceContentSha256, sha256Hex(bytes(STAGED_TEXT)), 'staged source digest binds the exact released body');
  equal(image.sourceHandle.kind, 'visual_brief', 'image observation becomes a private visual source');
  equal(image.contentAvailability, 'derived', 'visual content is explicitly derived, not raw image access');
  const visualText = result.privateSourcesByHandle[image.sourceHandle.id];
  check(visualText.startsWith('UNTRUSTED VISUAL DATA ONLY'), 'visual brief retains its untrusted-data boundary');
  check(!visualText.includes('https://private.example.test/a'), 'visual brief redacts the source URL');
  check(!visualText.includes('/Users/casey/mockup.png'), 'visual brief redacts the local path');
  check(!visualText.includes('hunterhunter'), 'visual brief redacts the secret value');
  check(
    Array.from(visualText).length <= OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxVisualBriefChars,
    'private visual brief is bounded',
  );
  equal(image.sourceContentBinding, 'derived_unbound', 'independently supplied visual description is explicitly non-exact');
  equal(image.sourceContentSha256, sha256Hex(bytes(visualText)), 'derived visual body still receives a tamper-detection digest');
  equal(pdf.sourceHandle.kind, 'metadata_only', 'a PDF without a readable handle remains metadata-only');
  equal(pdf.contentAvailability, 'unavailable', 'transient PDF bytes do not falsely claim readable content');
  equal(pdf.sourceContentBinding, 'none', 'metadata-only PDF cannot claim a source-content binding');
  equal(pdf.sourceContentSha256, null, 'metadata-only PDF has no model-content digest');
  check(!(pdf.sourceHandle.id in result.privateSourcesByHandle), 'metadata-only PDF has no private source value');
  equal(Object.keys(result.privateSourcesByHandle).length, 3, 'private map contains only two extracted texts and one visual brief');

  check(Object.isFrozen(result), 'successful assembler result is immutable');
  check(Object.isFrozen(result.manifest), 'assembled manifest is immutable');
  check(Object.isFrozen(result.manifest.attachments), 'assembled attachment list is immutable');
  check(Object.isFrozen(result.manifest.attachments[0]), 'assembled attachment rows are immutable');
  check(Object.isFrozen(result.privateSourcesByHandle), 'private source map is immutable');
  check(Object.isFrozen(result.modelProjection), 'model projection is immutable');

  const projectionJson = JSON.stringify(result.modelProjection);
  check(!projectionJson.includes(CIRCLE_ID), 'model projection omits circle scope');
  check(!projectionJson.includes(THREAD_ID), 'model projection omits thread scope');
  check(!projectionJson.includes(ORIGIN_ID), 'model projection omits local-origin scope');
  check(!projectionJson.includes(picker.sourceHandle.id), 'model projection omits inline handle identity');
  check(!projectionJson.includes(pdf.sourceHandle.id), 'model projection omits metadata handle identity');
  check(!projectionJson.includes(PICKER_TEXT), 'model projection omits picker text');
  check(!projectionJson.includes(STAGED_TEXT), 'model projection omits staged text');
  check(!/sourceContentSha256|sourceContentBinding|sourceContentProvenance/.test(projectionJson), 'model projection omits private source-body binding fields');
  check(!projectionJson.includes('private.example.test'), 'model projection omits raw visual data');
  check(!/"sourceHandle"\s*:|sourceHandleId|storagePath|signedUrl|localPath|base64|rawBytes|exactBytes/.test(projectionJson), 'model projection has no raw authority, address, bytes, or handle-id field');
  equal(result.modelProjection.attachmentCount, 4, 'model projection reports the exact deduplicated count');

  const explicitHandle = await assembleOpenSwanAttachmentTurnSources(singleMediaInput({
    id: 'readable-pdf-1',
    name: 'readable.pdf',
    mimeType: 'application/pdf',
    size: pdfBytes.byteLength,
    exactBytes: pdfBytes,
    readableHandle: { kind: 'private_storage_object', id: 'storage-capability-1' },
  }), { digestSha256 });
  check(explicitHandle.ok, 'binary content is admitted when an exact readable handle is explicitly provided');
  if (!explicitHandle.ok) throw new Error(explicitHandle.code);
  equal(explicitHandle.manifest.attachments[0].sourceHandle.kind, 'private_storage_object', 'explicit private-object handle is preserved');
  equal(explicitHandle.manifest.attachments[0].sourceHandle.id, 'storage-capability-1', 'exact opaque readable handle identity is preserved privately');
  equal(explicitHandle.manifest.attachments[0].contentAvailability, 'complete', 'an explicit readable binary handle can claim complete availability');
  equal(explicitHandle.manifest.attachments[0].sourceContentBinding, 'external_unverified', 'external handle is not mistaken for observed model content');
  equal(explicitHandle.manifest.attachments[0].sourceContentSha256, null, 'external handle has no model-content digest before an exact read');
  equal(Object.keys(explicitHandle.privateSourcesByHandle).length, 0, 'readable binary handles never masquerade as inline private text');
  check(!JSON.stringify(explicitHandle.modelProjection).includes('storage-capability-1'), 'readable handle identity stays out of model projection');

  const topLevelText = 'Trusted top-level staged extraction.';
  const topLevelBytes = bytes(topLevelText);
  const topLevelStagedText = await assembleOpenSwanAttachmentTurnSources({
    ...baseInput(),
    stagedFiles: [{
      id: 'staged-top-text-1',
      name: 'top.txt',
      mimeType: 'text/plain',
      sizeBytes: topLevelBytes.byteLength,
      uploading: false,
      attachment: {
        id: 'db-top-text-1',
        circleId: CIRCLE_ID,
        threadId: THREAD_ID,
        originalName: 'top.txt',
        mimeType: 'text/plain',
        sizeBytes: topLevelBytes.byteLength,
      },
      extractText: topLevelText,
      extractTextComplete: true,
      exactBytes: topLevelBytes,
    }],
  }, { digestSha256 });
  check(topLevelStagedText.ok, 'top-level staged extracted text is explicitly admitted');
  if (!topLevelStagedText.ok) throw new Error(topLevelStagedText.code);
  equal(topLevelStagedText.manifest.attachments[0].sourceHandle.kind, 'inline_text', 'top-level staged extraction uses an inline handle');
  equal(Object.values(topLevelStagedText.privateSourcesByHandle)[0], topLevelText, 'top-level staged text remains private');

  const longText = 'x'.repeat(OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInlineTextChars + 5);
  const longTextBytes = bytes(longText);
  const boundedText = await assembleOpenSwanAttachmentTurnSources(singleMediaInput({
    id: 'long-text-1',
    name: 'long.txt',
    mimeType: 'text/plain',
    size: longTextBytes.byteLength,
    extractText: longText,
    extractTextComplete: true,
    exactBytes: longTextBytes,
  }), { digestSha256 });
  check(boundedText.ok, 'oversized extracted text is safely bounded instead of leaked');
  if (!boundedText.ok) throw new Error(boundedText.code);
  equal(boundedText.manifest.attachments[0].contentAvailability, 'partial', 'truncated extraction cannot falsely claim completeness');
  equal(Array.from(Object.values(boundedText.privateSourcesByHandle)[0]).length, OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInlineTextChars, 'private extracted text obeys the exact bound');

  await expectFailure(singleMediaInput({
    id: 'substituted-text-1',
    name: 'substituted.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    extractText: 'A substituted extraction that did not come from these bytes.',
    extractTextComplete: true,
    exactBytes: pickerBytes,
  }), 'extracted_text_mismatch', 'exact bytes plus independently substituted extractedText fail closed');

  // Keep a realistic runtime fixture without committing a scanner-shaped key.
  const secretValue = `${'s'}${'k'}-${'12345678901234567890'}`;
  const secretText = `Quarterly result. ${secretValue}`;
  const secretBytes = bytes(secretText);
  const redactedText = await assembleOpenSwanAttachmentTurnSources(singleMediaInput({
    id: 'redacted-text-1',
    name: 'redacted.txt',
    mimeType: 'text/plain',
    size: secretBytes.byteLength,
    extractText: secretText,
    extractTextComplete: true,
    exactBytes: secretBytes,
  }), { digestSha256 });
  check(redactedText.ok, 'exact text containing a secret is sealed as a safe bounded source');
  if (!redactedText.ok) throw new Error(redactedText.code);
  const redactedItem = redactedText.manifest.attachments[0];
  const redactedBody = redactedText.privateSourcesByHandle[redactedItem.sourceHandle.id];
  check(!redactedBody.includes(secretValue), 'the private model source is redacted before its digest is sealed');
  equal(redactedItem.contentAvailability, 'partial', 'a redacted source cannot claim complete byte-for-byte visibility');
  equal(redactedItem.sourceContentSha256, sha256Hex(bytes(redactedBody)), 'the sealed digest identifies the exact redacted model body');
  const redactedReceipt = createOpenSwanAttachmentSourceReceipt({
    manifest: redactedText.manifest,
    attachmentId: redactedItem.attachmentId,
    evidenceId: 'toolu-redacted-source',
    access: 'content',
    observedSourceContentSha256: redactedItem.sourceContentSha256,
  });
  check(redactedReceipt.ok, 'runtime may record the exact redacted body it actually presented');
  if (!redactedReceipt.ok) throw new Error(redactedReceipt.code);
  const redactedResolution = resolveOpenSwanAttachmentSourceEvidence({
    manifest: redactedText.manifest,
    receipts: [redactedReceipt.receipt],
    expected: {
      manifestId: redactedText.manifest.manifestId,
      circleId: redactedText.manifest.circleId,
      threadId: redactedText.manifest.threadId,
      originLocalMessageId: redactedText.manifest.originLocalMessageId,
      attachmentId: redactedItem.attachmentId,
      evidenceId: 'toolu-redacted-source',
      requiredAccess: 'content',
    },
  });
  check(redactedResolution.ok && !redactedResolution.evidence.contentBound, 'redacted partial text is readable but cannot prove exact-source completion');
  const alteredReceipt = createOpenSwanAttachmentSourceReceipt({
    manifest: redactedText.manifest,
    attachmentId: redactedItem.attachmentId,
    evidenceId: 'toolu-altered-source',
    access: 'content',
    observedSourceContentSha256: sha256Hex(bytes(`${redactedBody} altered`)),
  });
  check(!alteredReceipt.ok && alteredReceipt.code === 'observed_source_content_mismatch', 'post-seal presentation changes cannot mint a falsely exact receipt');

  const extractedPdfText = 'Trusted PDF extraction from exact bytes.';
  const trustedPdf = await assembleOpenSwanAttachmentTurnSources(singleMediaInput({
    id: 'trusted-pdf-1',
    name: 'trusted.pdf',
    mimeType: 'application/pdf',
    size: pdfBytes.byteLength,
    extractText: extractedPdfText,
    extractTextComplete: true,
    exactBytes: pdfBytes,
  }), {
    digestSha256,
    async extractTrustedText(request) {
      equal(request.sha256, sha256Hex(pdfBytes), 'trusted extractor receives the digest of its exact byte input');
      equal(Buffer.from(request.bytes).toString('utf8'), '%PDF-1.7', 'trusted extractor receives only the exact copied attachment bytes');
      return { text: extractedPdfText, complete: true, provenanceId: 'extractor:pdf-text-v1' };
    },
  });
  check(trustedPdf.ok, 'an explicit trusted extractor may bind non-text bytes to a sealed source body');
  if (!trustedPdf.ok) throw new Error(trustedPdf.code);
  equal(trustedPdf.manifest.attachments[0].sourceContentBinding, 'trusted_extractor', 'trusted extraction provenance is distinguished from caller text');
  equal(trustedPdf.manifest.attachments[0].sourceContentProvenance, 'extractor:pdf-text-v1', 'trusted extractor version survives as value-free provenance');
  equal(trustedPdf.manifest.attachments[0].sourceContentSha256, sha256Hex(bytes(extractedPdfText)), 'trusted extraction seals the exact released-body digest');

  const offsetBacking = Uint8Array.of(1, 9, 8, 7, 2);
  const offsetView = new DataView(offsetBacking.buffer, 1, 3);
  const offsetResult = await assembleOpenSwanAttachmentTurnSources(singleMediaInput({
    id: 'offset-view-1',
    name: 'offset.bin',
    mimeType: 'application/octet-stream',
    size: 3,
    exactBytes: offsetView,
  }), { digestSha256 });
  check(offsetResult.ok, 'an exact ArrayBuffer view is copied using its byte offset and length');
  if (!offsetResult.ok) throw new Error(offsetResult.code);
  equal(offsetResult.manifest.attachments[0].sha256, sha256Hex(Uint8Array.of(9, 8, 7)), 'only the addressed bytes enter SHA-256');

  await expectFailure(null, 'invalid_input', 'null input fails closed');
  await expectFailure({}, 'invalid_keys', 'missing exact origin and source lists fail closed');
  await expectFailure({ ...baseInput(), originLocalMessageId: '../other-message' }, 'invalid_scope', 'unsafe local origin identity fails closed');
  await expectFailure({ ...baseInput(), storageUrl: 'https://private.test/object' }, 'invalid_keys', 'extra root storage authority fails closed');
  await expectFailure(baseInput(), 'attachment_count_invalid', 'an empty attachment turn is rejected');

  await expectFailure(singleMediaInput({
    ...pickerTextInput(),
    exactBytes: pickerBytes,
    signedUrl: 'https://private.test/object',
  }), 'invalid_media', 'an unsafe media field fails the whole manifest');

  let unsafeDigestCalls = 0;
  await expectFailure(singleMediaInput({
    id: 'unsafe-name-1',
    name: '../secret.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    exactBytes: pickerBytes,
  }), 'manifest_invalid', 'path-shaped basename fails the whole manifest before hashing', {
    async digestSha256(value) {
      unsafeDigestCalls += 1;
      return digestSha256(value);
    },
  });
  equal(unsafeDigestCalls, 0, 'unsafe metadata is rejected before the digest dependency runs');

  await expectFailure(singleMediaInput({
    id: 'unsafe-mime-1',
    name: 'notes.txt',
    mimeType: 'text/plain; charset=utf-8',
    size: pickerBytes.byteLength,
    exactBytes: pickerBytes,
  }), 'manifest_invalid', 'non-essence MIME metadata fails closed');

  await expectFailure(singleMediaInput({
    id: 'no-bytes-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
  }), 'bytes_unavailable', 'a source with no exact or resolvable bytes cannot mint a digest');

  await expectFailure(singleMediaInput({
    id: 'missing-resolved-bytes-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    byteSourceId: 'missing-source-1',
  }), 'bytes_unavailable', 'an unavailable async byte source fails closed', {
    digestSha256,
    async resolveBytes() { return null; },
  });

  await expectFailure(singleMediaInput({
    id: 'wrong-size-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength + 1,
    exactBytes: pickerBytes,
  }), 'bytes_size_mismatch', 'byte-count mismatch fails before a receipt can be trusted');

  await expectFailure(singleMediaInput({
    id: 'digest-throws-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    exactBytes: pickerBytes,
  }), 'digest_unavailable', 'a rejected digest dependency fails the whole manifest', {
    async digestSha256() { throw new Error('digest unavailable'); },
  });

  await expectFailure(singleMediaInput({
    id: 'bad-digest-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    exactBytes: pickerBytes,
  }), 'digest_invalid', 'a malformed digest fails the whole manifest', {
    async digestSha256() { return new Uint8Array(31); },
  });

  const uppercaseDigest = await assembleOpenSwanAttachmentTurnSources(singleMediaInput({
    id: 'uppercase-digest-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    exactBytes: pickerBytes,
  }), {
    async digestSha256() { return sha256Hex(pickerBytes).toUpperCase(); },
  });
  check(uppercaseDigest.ok, 'a valid Web-Crypto-compatible hex digest is admitted');
  if (!uppercaseDigest.ok) throw new Error(uppercaseDigest.code);
  equal(uppercaseDigest.manifest.attachments[0].sha256, sha256Hex(pickerBytes), 'hex digest is canonical lowercase');

  const uploading = stagedTextInput();
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{ ...uploading, uploading: true }],
  }, 'attachment_uploading', 'an uploading staged source pauses the entire manifest');
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{ ...uploading, error: 'upload failed' }],
  }, 'attachment_error', 'a staged upload error fails the entire manifest');
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{ ...uploading, attachment: null }],
  }, 'staged_attachment_missing', 'a staged row without its durable upload fails closed');
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{
      ...uploading,
      attachment: { ...uploading.attachment, circleId: 'circle-other' },
    }],
  }, 'staged_scope_mismatch', 'cross-circle staged attachment is rejected');
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{
      ...uploading,
      attachment: { ...uploading.attachment, threadId: 'thread-other' },
    }],
  }, 'staged_scope_mismatch', 'cross-thread staged attachment is rejected');
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{
      ...uploading,
      extractText: 'conflicting text',
    }],
  }, 'ambiguous_duplicate', 'conflicting staged extraction representations are ambiguous');
  await expectFailure({
    ...baseInput(),
    stagedFiles: [{
      ...uploading,
      extractText: uploading.attachment.extractText,
      extractTextComplete: false,
    }],
  }, 'ambiguous_duplicate', 'conflicting staged completeness claims fail closed');

  await expectFailure({
    ...baseInput(),
    mediaAttachments: [pickerTextInput(), { ...pickerTextInput() }],
  }, 'ambiguous_duplicate', 'same-lane duplicate attachment identity fails closed');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [{
      id: 'db-attachment-text-1',
      name: 'uploaded notes.txt',
      mimeType: 'text/plain',
      size: stagedBytes.byteLength,
      exactBytes: stagedBytes,
    }],
    stagedFiles: [stagedTextInput()],
  }, 'ambiguous_duplicate', 'coincident ids without an explicit durable upload link are not deduplicated');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [{ ...stagedMediaMirror(), name: 'other.txt' }],
    stagedFiles: [stagedTextInput()],
  }, 'ambiguous_duplicate', 'durable duplicate with conflicting metadata fails closed');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [{ ...stagedMediaMirror(), extractTextComplete: false }],
    stagedFiles: [stagedTextInput()],
  }, 'ambiguous_duplicate', 'durable duplicate with conflicting extraction completeness fails closed');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [{
      ...stagedMediaMirror(),
      exactBytes: Uint8Array.from(stagedBytes, (value, index) => (index === 0 ? value ^ 1 : value)),
    }],
    stagedFiles: [stagedTextInput()],
  }, 'ambiguous_duplicate', 'durable duplicate with conflicting content hashes fails closed');

  await expectFailure({
    ...baseInput(),
    mediaAttachments: [imageInput()],
    visualBriefs: [visualInput(), { ...visualInput() }],
  }, 'ambiguous_duplicate', 'duplicate visual briefs for one attachment fail closed');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [imageInput()],
    visualBriefs: [{ ...visualInput(), attachmentId: 'missing-image-1' }],
  }, 'visual_attachment_not_found', 'visual brief cannot bind an unknown attachment');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [pdfInput()],
    visualBriefs: [{ ...visualInput(), attachmentId: 'picker-pdf-1', fileName: 'brief.pdf' }],
  }, 'visual_attachment_mismatch', 'PDF metadata cannot masquerade as a visual brief source');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [imageInput()],
    visualBriefs: [{ ...visualInput(), fileName: 'other.png' }],
  }, 'visual_attachment_mismatch', 'visual brief filename must match the exact attachment');
  await expectFailure({
    ...baseInput(),
    mediaAttachments: [imageInput()],
    visualBriefs: [{ ...visualInput(), signedUrl: 'https://private.test/image' }],
  }, 'invalid_visual_brief', 'visual input cannot carry an extra URL field');

  await expectFailure(singleMediaInput({
    id: 'bad-handle-1',
    name: 'brief.pdf',
    mimeType: 'application/pdf',
    size: pdfBytes.byteLength,
    exactBytes: pdfBytes,
    readableHandle: { kind: 'private_storage_object', id: '/private/object' },
  }), 'invalid_media', 'path-shaped readable handle identity is rejected');

  const symbolTainted = pickerTextInput() as Record<PropertyKey, unknown>;
  symbolTainted[Symbol('raw-bytes')] = pickerBytes;
  await expectFailure(singleMediaInput(symbolTainted as Record<string, unknown>), 'invalid_media', 'symbol-keyed hidden authority is rejected by the sealed shape');

  const accessorMedia: Record<string, unknown> = {
    id: 'accessor-media-1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: pickerBytes.byteLength,
    exactBytes: pickerBytes,
  };
  Object.defineProperty(accessorMedia, 'signedUrl', {
    enumerable: false,
    value: 'https://private.test/object',
  });
  await expectFailure(singleMediaInput(accessorMedia), 'invalid_media', 'non-enumerable hidden authority is rejected by the sealed shape');

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  await expectFailure(revoked.proxy, 'invalid_input', 'revoked structural input fails closed without throwing');

  const tooMany = Array.from(
    { length: OPEN_SWAN_ATTACHMENT_TURN_SOURCE_LIMITS.maxInputsPerLane + 1 },
    (_, index) => ({
      id: `too-many-${index}`,
      name: `file-${index}.txt`,
      mimeType: 'text/plain',
      size: pickerBytes.byteLength,
      exactBytes: pickerBytes,
    }),
  );
  await expectFailure({ ...baseInput(), mediaAttachments: tooMany }, 'attachment_count_invalid', 'oversized attachment lane fails closed as a whole');

  console.log(`OpenSwan attachment turn-source smoke passed (${assertions} assertions).`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
