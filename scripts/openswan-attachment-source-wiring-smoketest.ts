/**
 * Red-first contract for wiring one exact Chat attachment into an OpenSwan
 * multi-action turn.
 *
 * This smoke intentionally combines pure production contracts with narrow
 * source-wiring checks. It must not perform storage, provider, desktop, or
 * Supabase I/O.
 *
 * Run:
 *   npx tsx scripts/openswan-attachment-source-wiring-smoketest.ts
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createOpenSwanAttachmentSourceReceipt,
  normalizeOpenSwanAttachmentSourceManifest,
  resolveOpenSwanAttachmentSourceEvidence,
} from '../src/lib/openSwanAttachmentSourceCore';
import { assembleOpenSwanAttachmentTurnSources } from '../src/lib/openSwanAttachmentTurnSources';
import {
  evaluateOpenSwanMultiActionCompletion,
  type OpenSwanMultiActionCompletionLedger,
} from '../src/lib/openSwanMultiActionCompletionCore';

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
  console.log('pass:', message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
  console.log('pass:', message);
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

async function main(): Promise<void> {
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\nQuarterly revenue grew 12 percent.');
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');
const assembled = await assembleOpenSwanAttachmentTurnSources({
  manifestId: 'manifest-turn-1',
  circleId: 'circle-1',
  threadId: 'thread-1',
  originLocalMessageId: 'user-local-1',
  mediaAttachments: [],
  stagedFiles: [{
    id: 'staged-client-1',
    name: 'quarterly-report.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF_BYTES.byteLength,
    uploading: false,
    attachment: {
      id: 'attachment-db-1',
      circleId: 'circle-1',
      threadId: 'thread-1',
      originalName: 'quarterly-report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: PDF_BYTES.byteLength,
      extractText: 'Quarterly revenue grew 12 percent.',
      extractTextComplete: true,
    },
    exactBytes: PDF_BYTES,
  }],
  visualBriefs: [],
}, {
  digestSha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
  extractTrustedText: async (request) => {
    equal(
      createHash('sha256').update(request.bytes).digest('hex'),
      request.sha256,
      'trusted PDF extraction receives the exact bytes sealed by the manifest digest',
    );
    return {
      text: 'Quarterly revenue grew 12 percent.',
      complete: true,
      provenanceId: 'pdf-extractor-v1',
    };
  },
});
check(assembled.ok, 'the production assembler admits one exact staged DB attachment');
if (!assembled.ok) throw new Error('code' in assembled ? assembled.code : 'assembly_failed');
const manifest = assembled.manifest;
const projection = assembled.modelProjection;
equal(manifest.originLocalMessageId, 'user-local-1', 'the assembler binds the exact local user-message identity');
equal(manifest.attachments[0]?.attachmentId, 'attachment-db-1', 'the assembler promotes the durable attachment DB id');
equal(manifest.attachments[0]?.sha256, PDF_SHA, 'the assembler hashes exact bytes instead of trusting a filename');
check(Object.values(assembled.privateSourcesByHandle).includes('Quarterly revenue grew 12 percent.'), 'bounded extracted content stays in the private trusted source map');
check(projection !== null, 'the model receives a bounded attachment projection');
equal(projection.attachmentCount, 1, 'the projection preserves exact attachment count');
equal(projection.attachments[0]?.attachmentId, 'attachment-db-1', 'the projection exposes the opaque attachment id');
equal(projection.attachments[0]?.sha256, PDF_SHA, 'the projection binds the exact content digest');

const projectionJson = JSON.stringify(projection);
check(!projectionJson.includes('circle-1'), 'the projection omits private circle scope');
check(!projectionJson.includes('thread-1'), 'the projection omits private thread scope');
check(!projectionJson.includes('user-local-1'), 'the projection omits the local message identity');
check(!projectionJson.includes(manifest.attachments[0]?.sourceHandle.id || ''), 'the projection omits the trusted source handle');
check(!/storage(?:path|key|url)|signed.?url|local.?path|raw.?bytes|base64|extract(?:ed)?.?text|ocr.?text/i.test(projectionJson), 'the projection cannot carry paths, URLs, bytes, or extracted content');

const receiptResult = createOpenSwanAttachmentSourceReceipt({
  manifest,
  attachmentId: 'attachment-db-1',
  evidenceId: 'toolu-attachment-read-1',
  access: 'content',
  observedSourceContentSha256: manifest.attachments[0]?.sourceContentSha256 || null,
});
check(receiptResult.ok, 'a successful trusted read can mint one exact attachment receipt');
const receipt = receiptResult.receipt;

const exactEvidence = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [receipt],
  expected: {
    manifestId: manifest.manifestId,
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    originLocalMessageId: manifest.originLocalMessageId,
    attachmentId: 'attachment-db-1',
    evidenceId: 'toolu-attachment-read-1',
    requiredAccess: 'content',
  },
});
check(exactEvidence.ok && exactEvidence.evidence.contentBound, 'the receipt resolves only as exact content-bound evidence');
if (!exactEvidence.ok) throw new Error('reason' in exactEvidence ? exactEvidence.reason : 'evidence_failed');
equal(exactEvidence.evidence.sha256, PDF_SHA, 'resolved evidence retains the manifest digest');

const missingEvidence = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [receipt],
  expected: {
    manifestId: manifest.manifestId,
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    originLocalMessageId: manifest.originLocalMessageId,
    attachmentId: 'attachment-db-1',
    evidenceId: 'toolu-missing',
    requiredAccess: 'content',
  },
});
check(!missingEvidence.ok && 'reason' in missingEvidence && missingEvidence.reason === 'evidence_missing', 'missing read evidence fails closed');

const wrongAttachment = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [receipt],
  expected: {
    manifestId: manifest.manifestId,
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    originLocalMessageId: manifest.originLocalMessageId,
    attachmentId: 'attachment-db-other',
    evidenceId: 'toolu-attachment-read-1',
    requiredAccess: 'content',
  },
});
check(!wrongAttachment.ok && 'reason' in wrongAttachment && wrongAttachment.reason === 'attachment_not_found', 'wrong attachment identity fails closed');

const duplicateEvidence = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [receipt, { ...receipt }],
  expected: {
    manifestId: manifest.manifestId,
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    originLocalMessageId: manifest.originLocalMessageId,
    attachmentId: 'attachment-db-1',
    evidenceId: 'toolu-attachment-read-1',
    requiredAccess: 'content',
  },
});
check(!duplicateEvidence.ok && 'reason' in duplicateEvidence && duplicateEvidence.reason === 'evidence_ambiguous', 'duplicate evidence ids fail closed as ambiguous');

const tamperedReceipt = { ...receipt, sha256: '8'.repeat(64) };
const contentDrift = resolveOpenSwanAttachmentSourceEvidence({
  manifest,
  receipts: [tamperedReceipt],
  expected: {
    manifestId: manifest.manifestId,
    circleId: manifest.circleId,
    threadId: manifest.threadId,
    originLocalMessageId: manifest.originLocalMessageId,
    attachmentId: 'attachment-db-1',
    evidenceId: 'toolu-attachment-read-1',
    requiredAccess: 'content',
  },
});
check(!contentDrift.ok && 'reason' in contentDrift && contentDrift.reason === 'evidence_content_identity_mismatch', 'content hash drift fails closed');

const unavailableManifestResult = normalizeOpenSwanAttachmentSourceManifest({
  ...manifest,
  manifestId: 'manifest-unavailable',
  attachments: [{
    ...manifest.attachments[0],
    contentAvailability: 'unavailable',
    sourceHandle: { kind: 'metadata_only', id: 'metadata-only-1' },
    sourceContentSha256: null,
    sourceContentBinding: 'none',
    sourceContentProvenance: null,
  }],
});
check(unavailableManifestResult.ok, 'metadata-only fixture is structurally valid');
const unavailableReceipt = createOpenSwanAttachmentSourceReceipt({
  manifest: unavailableManifestResult.manifest,
  attachmentId: 'attachment-db-1',
  evidenceId: 'toolu-unavailable',
  access: 'content',
  observedSourceContentSha256: null,
});
check(!unavailableReceipt.ok && 'code' in unavailableReceipt && unavailableReceipt.code === 'incompatible_access', 'unavailable content cannot mint a content receipt');

const ledger: OpenSwanMultiActionCompletionLedger = {
  schemaVersion: 1,
  dispatchMode: 'single_openswan_turn',
  actionCount: 2,
  actions: [{
    id: 'A1',
    ordinal: 1,
    dependsOnActionIds: [],
    evidenceToolNames: ['attachments.read_source'],
    evidenceRequiresTargetBinding: true,
  }, {
    id: 'A2',
    ordinal: 2,
    dependsOnActionIds: ['A1'],
    evidenceArtifactKinds: ['summary'],
  }],
};

const exactCompound = evaluateOpenSwanMultiActionCompletion({
  ledger,
  evidence: [{
    kind: 'tool',
    evidenceId: receipt.evidenceId,
    sequence: 1,
    status: 'succeeded',
    tool: 'attachments.read_source',
    mutatesState: false,
    targetBound: exactEvidence.ok && exactEvidence.evidence.identityBound,
  }, {
    kind: 'artifact',
    evidenceId: 'artifact-summary-1',
    sequence: 2,
    status: 'succeeded',
    actionId: 'A2',
    artifactKind: 'summary',
    contentPresent: true,
    durablyRecorded: true,
  }],
  reports: [{
    actionId: 'A1',
    status: 'completed',
    reportedAtSequence: 3,
    evidenceIds: [receipt.evidenceId],
  }, {
    actionId: 'A2',
    status: 'completed',
    reportedAtSequence: 3,
    evidenceIds: ['artifact-summary-1'],
  }],
});
check(exactCompound.completionVerified, 'exact attachment read plus durable dependent artifact can verify the bounded compound turn');

const filenameOnly = evaluateOpenSwanMultiActionCompletion({
  ledger,
  evidence: [{
    kind: 'artifact',
    evidenceId: 'artifact-summary-1',
    sequence: 1,
    status: 'succeeded',
    actionId: 'A2',
    artifactKind: 'summary',
    contentPresent: true,
    durablyRecorded: true,
  }],
  reports: [{
    actionId: 'A1',
    status: 'completed',
    reportedAtSequence: 2,
    // A filename in provider prose is deliberately absent from this ledger.
    evidenceIds: [],
  }, {
    actionId: 'A2',
    status: 'completed',
    reportedAtSequence: 2,
    evidenceIds: ['artifact-summary-1'],
  }],
});
check(!filenameOnly.completionVerified, 'filename or provider prose cannot complete an attachment-dependent action');
check(filenameOnly.issues.some((issue) => issue.actionId === 'A1'), 'the source action stays explicitly unresolved without a trusted receipt');

// Production wiring. These checks are deliberately semantic and avoid pinning
// incidental helper names, but they require the complete trust boundary:
// persisted message -> linked DB attachments -> turn sources -> one exact read
// tool -> validated receipt -> target-bound A# evidence.
const chat = source('src/screens/circles/tabs/ChatTab.tsx');
const runtime = source('src/lib/openswanSessionRuntime.ts');
const tools = source('src/lib/openswanToolRuntime.ts');

check(/openSwanAttachmentTurnSources/.test(chat), 'Chat imports the canonical attachment turn-source assembler');
check(/await\s+linkAttachmentsToMessage\s*\(/.test(chat), 'Chat awaits attachment linking before OpenSwan dispatch');
check(/linkAttachmentsToMessage\s*\([\s\S]{0,300}(?:\.attachment\?*\.id|attachmentIds)[\s\S]{0,300}(?:persisted|message).*id/i.test(chat), 'exact staged attachment DB ids link to the exact returned user-message id');
check(/attachmentTurnSources\s*:/.test(chat), 'Chat passes one assembled attachment turn-source contract to OpenSwan');
check(/attachmentTurnSources\??\s*:/.test(runtime), 'OpenSwan turn options type the private attachment turn sources');
check(/attachmentTurnSources[\s\S]{0,800}(?:modelProjection|modelContext)/.test(runtime), 'OpenSwan exposes only the bounded model projection to the provider');
const runtimeTools = source('src/lib/openswanToolRuntime.ts');
check(
  /const\s+turnSources\s*=\s*context\.attachmentTurnSources[\s\S]{0,3200}exactPrivateAttachmentSource\s*\(turnSources,\s*attachment\.sourceHandle\.id\)/.test(runtimeTools)
    && /const\s+trustedSource\s*=\s*exactPrivateAttachmentSource/.test(runtimeTools),
  'OpenSwan retains a separate trusted private source resolver at the tool boundary',
);
check(/['"]attachments\.read_source['"]/.test(tools), 'the catalog exposes one dedicated deferred attachment read tool');

const attachmentToolStart = tools.search(/name\s*:\s*['"]attachments\.read_source['"]/);
check(attachmentToolStart >= 0, 'the exact attachment read tool definition is discoverable');
const attachmentToolDefinition = tools.slice(attachmentToolStart, attachmentToolStart + 2400);
check(/attachmentId/.test(attachmentToolDefinition), 'the deferred read accepts exact attachmentId');
check(!/(?:storagePath|signedUrl|localPath|filePath|url|bytes|base64)\s*:/.test(attachmentToolDefinition), 'the deferred read schema accepts no path, URL, or byte authority');
check(/createOpenSwanAttachmentSourceReceipt|resolveOpenSwanAttachmentSourceEvidence/.test(runtime), 'runtime evidence is minted or resolved through the canonical attachment receipt core');
check(/attachments\.read_source[\s\S]{0,2400}(?:targetBound|identityBound)/.test(runtime), 'only exact receipt identity can mint target-bound A# evidence');
check(!/metadata\s*:\s*\{[\s\S]{0,1000}attachmentTurnSources/.test(chat), 'private attachment turn sources never enter public run metadata');

console.log(`\nOpenSwan attachment-source wiring smoke passed (${assertions} assertions).`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
