import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyDesktopAttachmentRequest } from '../src/lib/chatDesktopAttachmentRouting';

const root = resolve(import.meta.dirname, '..');
const runtimeSource = readFileSync(resolve(root, 'src/lib/openswanToolRuntime.ts'), 'utf8');
const sessionSource = readFileSync(resolve(root, 'src/lib/openswanSessionRuntime.ts'), 'utf8');
const legacyAdapterSource = readFileSync(resolve(root, 'src/lib/openswanTools/index.ts'), 'utf8');
const authoritySource = readFileSync(resolve(root, 'src/lib/openSwanDesktopAttachmentAuthority.ts'), 'utf8');
const persistenceSource = readFileSync(resolve(root, 'src/lib/agentRunPersistence.ts'), 'utf8');

const definitionStart = runtimeSource.indexOf("name: 'desktop.open_attachment'");
const definitionEnd = runtimeSource.indexOf("name: 'desktop.open_path'", definitionStart);
assert.ok(definitionStart > 0 && definitionEnd > definitionStart, 'opaque tool definition must exist');
const definition = runtimeSource.slice(definitionStart, definitionEnd);
assert.match(definition, /surfaces:\s*\['main_chat', 'room_chat', 'task_run'\]/);
assert.match(definition, /properties:\s*\{\s*attachmentId:/s);
assert.match(definition, /required:\s*\['attachmentId'\]/);
assert.match(definition, /additionalProperties:\s*false/);

const policyStart = runtimeSource.indexOf("if (tool === 'desktop.open_attachment')");
const policyEnd = runtimeSource.indexOf("if (tool.startsWith('desktop.'))", policyStart);
const policy = runtimeSource.slice(policyStart, policyEnd);
assert.match(policy, /approvalMode:\s*'ask'/);
assert.match(policy, /mutatesState:\s*true/);
assert.match(policy, /externalSideEffect:\s*true/);
assert.match(runtimeSource, /'desktop\.open_attachment',\s*\n\s*'desktop\.open_path'/);
assert.match(runtimeSource, /'desktop\.open_attachment':\s*\['execute'\]/);
assert.match(runtimeSource, /t === 'desktop\.open_attachment'/);
assert.match(runtimeSource, /'desktop\.open_attachment':\s*\{ writes: \['desktop_ui'\] \}/);

const executeStart = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool');
const opaqueBranch = runtimeSource.indexOf("if (tool === 'desktop.open_attachment')", executeStart);
const pathBranch = runtimeSource.indexOf("if (tool === 'desktop.open_path')", opaqueBranch);
const genericApproval = runtimeSource.indexOf('const approvalGate = await maybeAuthorizeToolWithWorkflowReview(', opaqueBranch);
assert.ok(opaqueBranch > 0, 'opaque handler branch must exist');
assert.ok(pathBranch > opaqueBranch, 'opaque handler must run before the legacy path gateway');
assert.ok(genericApproval > opaqueBranch, 'opaque handler must run before generic approval');

assert.match(runtimeSource, /inspectDesktopAttachmentOpenCapability/);
assert.match(runtimeSource, /observeDesktopAttachmentOpenCapability/);
assert.match(runtimeSource, /registerOpenSwanDesktopAttachmentApprovalResumeLease/);
assert.match(runtimeSource, /hasOpenSwanDesktopAttachmentApprovalLeaseCustodyForCapability/);
assert.match(runtimeSource, /consumeDesktopAttachmentOpenCapability/);
assert.match(runtimeSource, /dispatchDurableComputerAppMutation/);
assert.match(runtimeSource, /resolveOpenSwanDesktopAttachmentOpenEvidence/);
const opaqueHandlerStart = runtimeSource.indexOf('async function executeGuardedDesktopAttachmentOpen');
const opaqueHandlerEnd = runtimeSource.indexOf('async function executeGuardedNativeOpenPath', opaqueHandlerStart);
const opaqueHandler = runtimeSource.slice(opaqueHandlerStart, opaqueHandlerEnd);
assert.ok(opaqueHandlerStart > 0 && opaqueHandlerEnd > opaqueHandlerStart);
assert.ok(
  opaqueHandler.indexOf('inspectDesktopAttachmentOpenCapability')
    < opaqueHandler.indexOf("maybeAuthorizeToolWithWorkflowReview(\n      'desktop.open_attachment'"),
  'exact non-consuming byte inspection must precede approval',
);
assert.equal(
  (opaqueHandler.match(/consumeDesktopAttachmentOpenCapability/g) || []).length,
  1,
  'the handler must have one and only one capability consume seam',
);
assert.doesNotMatch(
  opaqueHandler,
  /desktopAttachmentStagedBasename|observeDesktopAttachmentOpenTarget|findDesktopAttachmentOpenEvidence|\.observeApp\s*\(/,
  'completion proof must use the exact private capability observation, never generic filename or a11y evidence',
);
assert.match(opaqueHandler, /requestedAppFingerprint !== capability\.requestedAppFingerprint/);
assert.match(opaqueHandler, /resolvedAppFingerprint !== capability\.resolvedAppFingerprint/);
assert.match(opaqueHandler, /documentFingerprint !== capability\.documentFingerprint/);
assert.match(opaqueHandler, /after\.observationFingerprint !== before\.observationFingerprint/);
assert.match(opaqueHandler, /after\.appRunning === true/);
assert.match(opaqueHandler, /after\.frontmost === true/);
assert.match(opaqueHandler, /after\?\.documentOpen === true/);
assert.match(
  opaqueHandler,
  /for \(let attempt = 0; attempt < 12 && !after\?\.documentOpen; attempt \+= 1\)/,
  'post-dispatch proof must allow a bounded native-app launch and document-load window',
);
assert.match(
  opaqueHandler,
  /setTimeout\(resolve, 500\)/,
  'post-dispatch exact observation retries must use a realistic bounded backoff',
);
assert.match(
  opaqueHandler,
  /finally \{\s*if \(!capabilityRetainedByLease\) \{\s*await revokeDesktopAttachmentCapabilityQuietly\(capability, scope\)/,
  'every terminal non-leased path must revoke any remaining active or dispatched private capability',
);
const priorLeaseCustodyCheck = opaqueHandler.indexOf(
  'hasOpenSwanDesktopAttachmentApprovalLeaseCustodyForCapability({',
);
const earlyAttachmentBindingGuard = opaqueHandler.indexOf('!attachmentId');
assert.ok(
  priorLeaseCustodyCheck > 0 && earlyAttachmentBindingGuard > priorLeaseCustodyCheck,
  'exact live lease custody must be established before a mismatched attachment id can return through terminal cleanup',
);
assert.match(
  opaqueHandler.slice(priorLeaseCustodyCheck, earlyAttachmentBindingGuard),
  /sources,\s*expected,\s*privateCapability: capability,/s,
  'the early custody query must bind the same sources, expected scope, and resolved private capability',
);
assert.match(
  authoritySource,
  /state\.privateCapability !== input\.privateCapability/,
  'a different capability cannot adopt a live lease custody result',
);
assert.match(
  authoritySource,
  /return hasLiveApprovalResumeLeaseForState\(state, nowMs\)/,
  'custody must be backed by a currently live process-private lease',
);
assert.doesNotMatch(
  opaqueHandler,
  /!capabilityRetainedByLease && !capabilityConsumed/,
  'a dispatched-but-unproven capability must not be left for TTL cleanup',
);
assert.doesNotMatch(
  opaqueHandler,
  /\b(?:localPath|signedUrl|storagePath|stageDirectory|manifestPath)\b/,
  'the opaque runtime handler must have no path or storage serializer field',
);
assert.match(runtimeSource, /issuedOpenSwanDesktopAttachmentOpenReceipts\.has\(receipt\)/);
assert.match(runtimeSource, /issuedOpenSwanDesktopAttachmentApprovalLeaseReceipts\.has\(receipt\)/);
assert.match(opaqueHandler, /if \(registered\.ok\)/);
assert.match(opaqueHandler, /registered\.code === 'duplicate_approval'/);
assert.match(opaqueHandler, /isOpenSwanDesktopAttachmentExistingLeaseCustodyReceipt\(registered\.existingLeaseCustody\)/);
assert.match(opaqueHandler, /capabilityRetainedByLease = true/);
assert.match(authoritySource, /const existingLease = pendingApprovalResumeLeases\.get\(input\.pendingApproval\.approvalId\)/);
assert.match(authoritySource, /existingLease\.sources === input\.sources/);
assert.match(authoritySource, /existingLease\.privateCapability === state\.privateCapability/);
assert.match(authoritySource, /existingLease\.ledgerReference === input\.ledgerReference/);
assert.match(authoritySource, /expiresAtMs: existingLease\.expiresAtMs/);
assert.match(authoritySource, /existingLeaseCustodyReceipts\.set\(existingLeaseCustody, existingLease\)/);
assert.match(opaqueHandler, /context\.mode !== 'execute'/);
assert.doesNotMatch(
  runtimeSource.slice(opaqueBranch, pathBranch),
  /\.openPath\s*\(/,
  'opaque open must never recurse through desktop.open_path',
);

const resolverStart = runtimeSource.indexOf('function desktopAttachmentApprovalResolverMatches(');
const resolverBodyStart = runtimeSource.indexOf('{', resolverStart);
const resolverBodyEnd = runtimeSource.indexOf('\n}', resolverBodyStart);
assert.ok(resolverStart > 0 && resolverBodyStart > resolverStart && resolverBodyEnd > resolverBodyStart);
const resolver = new Function(
  'resolvedBy',
  'currentUserId',
  runtimeSource.slice(resolverBodyStart + 1, resolverBodyEnd),
) as (resolvedBy: unknown, currentUserId: unknown) => boolean;
const requesterId = '55555555-5555-4555-8555-555555555555';
const otherMemberId = '66666666-6666-4666-8666-666666666666';
assert.equal(resolver(requesterId, requesterId), true);
assert.equal(
  resolver(otherMemberId, requesterId),
  false,
  'another circle member resolving the row must never authorize attachment dispatch',
);
const approvalConsumeStart = runtimeSource.indexOf('async function consumeOpenSwanApprovalAuthority');
const approvalConsumeEnd = runtimeSource.indexOf('type CrossRunApprovalLookup', approvalConsumeStart);
const approvalConsumeSource = runtimeSource.slice(approvalConsumeStart, approvalConsumeEnd);
assert.match(
  approvalConsumeSource,
  /input\.source === 'cross_run'[\s\S]{0,180}desktopAttachmentApprovalResolverMatches\(row\.resolved_by, input\.context\.userId\)/,
  'every cross-run approval, including private attachment open, requires the requester as resolver',
);
assert.match(
  approvalConsumeSource,
  /consume_openswan_chat_approval_resume_v1/,
  'bound Chat continuation consumes authority through the transactional resume RPC',
);
assert.match(approvalConsumeSource, /\.eq\('resolved_by', input\.context\.userId\)/);
assert.ok(
  (runtimeSource.match(/requested_by,resolved_by,requested_at,timeout_seconds,status,payload/g) || []).length >= 3,
  'same-run and cross-run approval reads must retain resolver identity for authoritative validation',
);

assert.match(sessionSource, /classifyDesktopAttachmentRequest/);
assert.match(sessionSource, /intent === 'desktop_open'/);
assert.match(sessionSource, /desktop_attachment_edit_not_supported/);
assert.match(sessionSource, /resolveOpenSwanDesktopAttachmentOpenEvidence/);
assert.match(sessionSource, /desktopAttachmentMessageId/);
assert.match(sessionSource, /multiActionLedgerReference/);
assert.match(sessionSource, /attachmentRoute\?\.intent !== 'content_read'/);
assert.match(sessionSource, /child\.attachmentIntent === 'desktop_edit'/);
assert.match(sessionSource, /desktopAttachmentOpenResolution\.evidence\.appBound/);
assert.match(sessionSource, /shouldSuppressPreLoopDelegationForAttachmentTurn/);
assert.match(sessionSource, /stripCanonicalCurrentTurnUploadSourceMarker\(actionText\)/);
assert.match(
  sessionSource,
  /const CURRENT_TURN_UPLOAD_SOURCE_MARKER = '\\nCurrent-turn upload is the sole requested source\.';/,
);
const stripMarkerStart = sessionSource.indexOf('function stripCanonicalCurrentTurnUploadSourceMarker');
const stripMarkerEnd = sessionSource.indexOf('function classifyCurrentTurnAttachmentAction', stripMarkerStart);
const stripMarkerSource = sessionSource.slice(stripMarkerStart, stripMarkerEnd);
assert.match(stripMarkerSource, /actionText\.endsWith\(CURRENT_TURN_UPLOAD_SOURCE_MARKER\)/);
assert.doesNotMatch(
  stripMarkerSource,
  /replace\s*\(/,
  'marker removal must not relax or rewrite the closed-world request grammar',
);
const canonicalMarker = '\nCurrent-turn upload is the sole requested source.';
const stripCanonicalMarker = (value: string): string => value.endsWith(canonicalMarker)
  ? value.slice(0, -canonicalMarker.length)
  : value;
const exactAttachment = Object.freeze({
  name: 'private-design.ai',
  mimeType: 'application/pdf',
  sizeBytes: 64,
  durableLink: Object.freeze({
    linkState: 'durable_linked' as const,
    attachmentId: '11111111-1111-4111-8111-111111111111',
    messageId: '22222222-2222-4222-8222-222222222222',
    circleId: '33333333-3333-4333-8333-333333333333',
    threadId: '44444444-4444-4444-8444-444444444444',
  }),
});
const validMarkedOpen = classifyDesktopAttachmentRequest({
  requestText: stripCanonicalMarker(`Open the attached file.${canonicalMarker}`),
  attachments: [exactAttachment],
});
assert.deepEqual(
  validMarkedOpen,
  {
    intent: 'desktop_open',
    supported: true,
    attachmentId: exactAttachment.durableLink.attachmentId,
    messageId: exactAttachment.durableLink.messageId,
  },
  'the exact binder suffix must restore the original valid open command',
);
const maliciousExtraAction = classifyDesktopAttachmentRequest({
  requestText: stripCanonicalMarker(`Open the attached file and then email it.${canonicalMarker}`),
  attachments: [exactAttachment],
});
assert.deepEqual(
  maliciousExtraAction,
  {
    intent: 'ambiguous',
    supported: false,
    code: 'desktop_attachment_request_ambiguous',
  },
  'an additional action before the canonical marker must stay visible and fail the narrow grammar',
);
assert.match(sessionSource, /hasExactRetainedDesktopAttachmentApprovalLease/);
assert.match(sessionSource, /resolveOpenSwanDesktopAttachmentApprovalLeaseEvidence/);
const retainedLeaseStart = sessionSource.indexOf('function hasExactRetainedDesktopAttachmentApprovalLease');
const retainedLeaseEnd = sessionSource.indexOf('async function revokeDesktopAttachmentAuthorityAtTurnBoundary', retainedLeaseStart);
const retainedLeaseSource = sessionSource.slice(retainedLeaseStart, retainedLeaseEnd);
assert.match(retainedLeaseSource, /retainedApprovalId/);
assert.match(retainedLeaseSource, /request\.id !== retainedApprovalId/);
assert.match(retainedLeaseSource, /exactPendingCount > 0 && exactPendingCount === pendingEventCount/);
assert.doesNotMatch(
  retainedLeaseSource,
  /exactPendingCount === 1/,
  'two exact provider retries for one retained approval must not trigger terminal revocation',
);
assert.match(sessionSource, /hasExactExistingDesktopAttachmentLeaseCustodyEvent/);
assert.match(sessionSource, /hasOpenSwanDesktopAttachmentApprovalLeaseCustodyForSources\(initialDesktopAttachmentBinding\)/);
assert.match(sessionSource, /resolveOpenSwanDesktopAttachmentExistingLeaseCustody/);
assert.match(sessionSource, /revokeDesktopAttachmentAuthorityAtTurnBoundary/);
const sessionTurnStart = sessionSource.indexOf('export async function runOpenSwanSessionTurn');
const sessionRunCreate = sessionSource.indexOf('const run = opts.context.circleId', sessionTurnStart);
const sessionRunCallback = sessionSource.indexOf('opts.onRunStarted(run.id)', sessionRunCreate);
const sessionToolLoop = sessionSource.indexOf('runTypedCoreToolLoop({', sessionRunCallback);
assert.ok(
  sessionRunCreate > sessionTurnStart && sessionRunCallback > sessionRunCreate && sessionToolLoop > sessionRunCallback,
  'durable run ownership callback must precede every approval-capable typed tool dispatch',
);
assert.match(sessionSource, /if \(!retainDesktopAttachmentApprovalLease\) \{\s*await revokeDesktopAttachmentAuthorityAtTurnBoundary\(opts\);/s);
assert.match(legacyAdapterSource, /registerOpenSwanDesktopAttachmentToolContext/);
assert.match(legacyAdapterSource, /desktopAttachmentToolContextBySources = new WeakMap/);
assert.doesNotMatch(
  persistenceSource,
  /openSwanDesktopAttachment(?:Open|ApprovalLease|ExistingLeaseCustody)Receipt/,
  'private completion, approval-lease, and custody receipts must not be admitted by public run metadata persistence',
);

console.log('OpenSwan opaque desktop attachment runtime smoke passed.');
