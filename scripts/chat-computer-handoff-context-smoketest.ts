import assert from 'node:assert/strict';
import {
  COMPUTER_USE_PINNED_LOOP_MODEL,
  buildChatComputerHandoffContext,
  formatChatComputerHandoffForMessage,
  formatComputerTaskModelResolutionNotice,
  resolveComputerTaskLoopModel,
} from '../src/lib/chatComputerHandoffContext';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';
import { buildChatComputerRequestUserNotice } from '../src/lib/chatComputerRequestUx';
import { buildDesignAppObjectManifestArtifact } from '../src/lib/designAppObjectManifest';
import {
  DESKTOP_ATTACHMENT_MANIFEST_FILENAME,
  buildDesktopAttachmentComputerTask,
} from '../src/lib/chatDesktopAttachmentRouting';

const browser = buildChatComputerHandoffContext({
  task: 'Extract product prices from https://example.com/catalog',
  entrypoint: 'browser_runtime',
  adapterId: 'browser_adapter',
  taskKind: 'browser_task',
  taskLabel: 'Browser task',
  browserPlanId: 'browser-plan-123',
  browserActionCount: 4,
  grantSummary: 'Needs browser navigation.',
  approvalSummary: 'Review before side effects.',
  preflightStatus: 'ready',
});
assert.equal(browser.surface, 'browser');
assert(browser.touched.includes('surface:browser'));
assert.equal(browser.metadata.browserPlanId, 'browser-plan-123');
const browserVisible = formatChatComputerHandoffForMessage(browser);
assert(browserVisible.includes('Ready for review'));
assert(browserVisible.includes('Browser plan staged (4 actions).'));
assert(!browserVisible.includes('browser-plan-123'), 'user-visible browser handoff hides internal plan id');

const browserRoute = buildChatComputerRequestRoute('Log into Shopify and update this product page after I approve');
assert(browserRoute, 'browser request route is available for handoff notice smoke');
const browserNoticeHandoff = buildChatComputerHandoffContext({
  task: 'Log into Shopify and update this product page after I approve',
  entrypoint: 'browser_runtime',
  adapterId: 'browser_adapter',
  taskKind: 'browser_task',
  taskLabel: 'Browser task',
  browserPlanId: 'browser-plan-shopify',
  approvalSummary: 'Review before publish.',
  requestNotice: buildChatComputerRequestUserNotice(browserRoute!),
  evidenceContract: browserRoute!.evidenceContract,
  appAutomationRouteDecision: browserRoute!.appAutomationRouteDecision,
});
const browserNoticeVisible = formatChatComputerHandoffForMessage(browserNoticeHandoff);
assert(browserNoticeHandoff.metadata.requestNotice?.primaryAction?.kind === 'approve_browser');
assert.equal(browserNoticeHandoff.metadata.evidenceContract?.kind, 'browser');
assert.equal(browserNoticeHandoff.metadata.appRouteDecision?.status, 'needs_observation');
assert.equal(browserNoticeHandoff.metadata.appRouteDecision?.chosenSurfaceId, 'browser_dom_cdp');
assert(browserNoticeHandoff.metadata.evidenceContract?.actionabilityChecks.some((item) => /visible/i.test(item)));
assert(browserNoticeVisible.includes('I found the browser path for this request.'));
assert(browserNoticeVisible.includes('Approve browser run'));
assert(!browserNoticeVisible.includes('browser-plan-shopify'), 'request notice handoff hides internal browser plan id');

const illustratorTask = 'Open Adobe Illustrator 2026, create a document, add a blue circle, and export it as PNG';
const illustratorRoute = buildChatComputerRequestRoute(illustratorTask);
assert(illustratorRoute?.requestedActionContract, 'multi-action route builds an A1…An contract for handoff');
const illustratorHandoff = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Illustrator multi-action task',
  requestedActionContract: illustratorRoute?.requestedActionContract,
  evidenceContract: illustratorRoute?.evidenceContract,
});
assert.deepEqual(
  illustratorHandoff.metadata.requestedActionContract?.actions.map((action) => action.id),
  ['A1', 'A2', 'A3', 'A4'],
  'handoff retains every requested action id',
);
assert.equal(
  illustratorHandoff.metadata.requestedActionContract?.actions[3]?.text,
  'export it as PNG',
  'handoff retains the final requested action instead of only the first step',
);
assert(Object.isFrozen(illustratorHandoff.metadata.requestedActionContract), 'handoff action summary is immutable');
assert.deepEqual(
  illustratorHandoff.metadata.requestedActionCoverage?.actions.map((action) => action.status),
  ['pending', 'pending', 'pending', 'pending'],
  'unstarted handoff keeps every requested action pending',
);
assert.equal(
  illustratorHandoff.metadata.requestedActionCoverage?.allActionsVerified,
  false,
  'an action ledger alone never manufactures completion',
);
assert(
  formatChatComputerHandoffForMessage(illustratorHandoff, { visibility: 'debug' })
    .includes('Requested actions: A1–A4 pending.'),
  'debug handoff exposes bounded A-id coverage',
);

const blockedIllustratorHandoff = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  requestedActionContract: illustratorRoute?.requestedActionContract,
  outcomeStatus: 'blocked',
  mutationDispatched: false,
  blockers: ['Illustrator is not reachable'],
});
assert.deepEqual(
  blockedIllustratorHandoff.metadata.requestedActionCoverage?.actions.map((action) => action.status),
  ['blocked', 'pending', 'pending', 'pending'],
  'pre-dispatch block identifies A1 and leaves later actions pending',
);
assert(
  formatChatComputerHandoffForMessage(blockedIllustratorHandoff).includes(
    'Requested actions: A1 blocked; A2–A4 pending.',
  ),
  'problem handoff makes unfinished action coverage visible',
);

const uncertainIllustratorHandoff = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  taskKind: 'app_task',
  requestedActionContract: illustratorRoute?.requestedActionContract,
  outcomeStatus: 'partial',
  mutationDispatched: true,
  blockers: ['Fresh after-state proof is missing'],
});
assert(
  uncertainIllustratorHandoff.metadata.requestedActionCoverage?.actions.every(
    (action) => action.status === 'outcome_unknown',
  ),
  'possible mutation without whole-task proof keeps every A-id outcome-unknown',
);
assert(
  formatChatComputerHandoffForMessage(uncertainIllustratorHandoff).includes('completion is not verified'),
  'uncertain handoff never presents partial action coverage as done',
);
const uncertainWithoutProseBlocker = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  requestedActionContract: illustratorRoute?.requestedActionContract,
  outcomeStatus: 'partial',
  mutationDispatched: true,
});
assert(
  formatChatComputerHandoffForMessage(uncertainWithoutProseBlocker).includes('Needs attention'),
  'typed unresolved A-id coverage is itself enough to surface a non-complete task',
);
const completedIllustratorHandoff = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  requestedActionContract: illustratorRoute?.requestedActionContract,
  outcomeStatus: 'completed',
  taskCompletionVerified: true,
  mutationDispatched: true,
});
assert.equal(
  completedIllustratorHandoff.metadata.requestedActionCoverage?.allActionsVerified,
  true,
  'authoritative whole-task completion verifies every retained A-id',
);
assert.equal(
  formatChatComputerHandoffForMessage(completedIllustratorHandoff),
  '',
  'verified action coverage stays quiet in the default success surface',
);
const unverifiedCompletedIllustratorHandoff = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  requestedActionContract: illustratorRoute?.requestedActionContract,
  outcomeStatus: 'completed',
  mutationDispatched: true,
});
assert.equal(
  unverifiedCompletedIllustratorHandoff.metadata.requestedActionCoverage?.overallStatus,
  'outcome_unknown',
  'completed status without runtime-owned task proof cannot verify A1…An',
);
assert(
  formatChatComputerHandoffForMessage(unverifiedCompletedIllustratorHandoff).includes('completion is not verified'),
  'unverified completed status remains visibly non-complete',
);
const malformedActionLedgerHandoff = buildChatComputerHandoffContext({
  task: illustratorTask,
  entrypoint: 'agent_runtime',
  adapterId: 'desktop_app_adapter',
  requestedActionContract: {
    ...illustratorRoute!.requestedActionContract!,
    actionCount: 9,
  } as any,
  outcomeStatus: 'completed',
  taskCompletionVerified: true,
});
assert.equal(
  malformedActionLedgerHandoff.metadata.requestedActionCoverage?.overallStatus,
  'requires_decomposition',
  'a mismatched handoff action count fails closed instead of borrowing a completion bit',
);

// Retired broad standing grants cannot be revived by a forged handoff stamp.
const stickyHandoff = buildChatComputerHandoffContext({
  task: 'Save the updated pricing table on acme.com',
  entrypoint: 'browser_runtime',
  adapterId: 'browser_adapter',
  taskKind: 'browser_task',
  taskLabel: 'Browser task',
  browserPlanId: 'browser-plan-sticky',
  stickyScopeApplied: { scopeId: 'scope-sticky-1', scopeKey: 'acme.com', categories: ['publish'] },
});
assert.equal(stickyHandoff.metadata.standingGrant, null, 'forged broad grant stays out of handoff metadata');
assert(!stickyHandoff.chatLines.some((line) => line.includes('Standing grant:')), 'forged broad grant stays out of the compact summary');
const stickyVisible = formatChatComputerHandoffForMessage(stickyHandoff);
assert(!stickyVisible.includes('standing grant'), 'forged broad grant produces no visible approval claim');
assert.equal(browser.metadata.standingGrant, null, 'routes without a grant keep an empty standingGrant');

const desktopTaskRequest = 'change APR to 2.9% in the InDesign banner';
const desktopTaskProjection = buildDesktopAttachmentComputerTask(desktopTaskRequest, [{
  name: 'dealer-banner.indd',
  mimeType: 'application/octet-stream',
  sizeBytes: 4_200_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/banner/dealer-banner.indd',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/banner',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/banner/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: 'a'.repeat(64),
  appName: 'Adobe InDesign',
}, {
  name: 'hero.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 900_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/banner/hero.jpg',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/banner',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/banner/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: 'b'.repeat(64),
  appName: 'Adobe Photoshop',
}]);
assert(!desktopTaskProjection.includes('/Users/chris'), 'desktop compatibility projection hides local paths');
assert(!desktopTaskProjection.includes('dealer-banner.indd'), 'desktop compatibility projection hides filenames');
assert(!desktopTaskProjection.includes(desktopTaskRequest), 'desktop compatibility projection hides the original request');
const desktopTask = desktopTaskRequest;
const desktop = buildChatComputerHandoffContext({
  task: desktopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded desktop file task',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
});
assert.equal(desktop.surface, 'desktop');
assert(desktop.touched.includes('surface:desktop_bridge'));
assert.equal(desktop.metadata.desktopAttachmentPackage, null, 'value-free handoff cannot reconstruct a desktop package');
assert(desktop.touched.includes('surface:design_app'), 'InDesign handoff records design-app surface');
assert.equal(desktop.metadata.designAppTask?.appName, 'Adobe InDesign');
assert(desktop.metadata.designAppTask?.operations.includes('update_text_layers'), 'InDesign handoff captures text-layer operation');
assert.equal(desktop.metadata.designProofReview?.reviewTitle, 'InDesign Proof Review');
assert(desktop.metadata.designProofReview?.checklist.some((item) => /Text inventory/i.test(item)), 'InDesign handoff carries proof review checklist');
assert.equal(formatChatComputerHandoffForMessage(desktop), '', 'successful desktop handoff stays quiet by default');
const desktopDebug = formatChatComputerHandoffForMessage(desktop, { visibility: 'debug' });
assert(!desktopDebug.includes('Package files:'), 'debug handoff does not recreate private attachment metadata');
assert(desktopDebug.includes('Design app: Adobe InDesign'));

const photoshopTaskRequest = 'remove the background with Photoshop generative fill and export a PNG proof';
const photoshopTaskProjection = buildDesktopAttachmentComputerTask(photoshopTaskRequest, [{
  name: 'hero.psd',
  mimeType: 'application/octet-stream',
  sizeBytes: 9_200_000,
  localPath: '/Users/chris/Downloads/Underground Circle Attachments/photo/hero.psd',
  stageDirectory: '/Users/chris/Downloads/Underground Circle Attachments/photo',
  manifestPath: `/Users/chris/Downloads/Underground Circle Attachments/photo/${DESKTOP_ATTACHMENT_MANIFEST_FILENAME}`,
  sha256: 'c'.repeat(64),
  appName: 'Adobe Photoshop',
}]);
assert(!photoshopTaskProjection.includes('/Users/chris'), 'Photoshop compatibility projection hides its local path');
assert(!photoshopTaskProjection.includes('hero.psd'), 'Photoshop compatibility projection hides its filename');
assert(!photoshopTaskProjection.includes(photoshopTaskRequest), 'Photoshop compatibility projection hides the original request');
const photoshopTask = photoshopTaskRequest;
const photoshopDesktop = buildChatComputerHandoffContext({
  task: photoshopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded Photoshop file task',
  preflightStatus: 'ready',
  groundingStatus: 'ready',
});
assert.equal(photoshopDesktop.surface, 'desktop');
assert(photoshopDesktop.touched.includes('surface:design_app'), 'Photoshop handoff records design-app surface');
assert(photoshopDesktop.touched.includes('app:adobe_photoshop'), 'Photoshop handoff records app id');
assert.equal(photoshopDesktop.metadata.designAppTask?.appName, 'Adobe Photoshop');
assert(photoshopDesktop.metadata.designAppTask?.operations.includes('generative_fill_or_remove'), 'Photoshop handoff captures generative edit operation');
assert(photoshopDesktop.metadata.designExecutionPipeline?.phases.some((phase) => phase.id === 'observe_document_inventory'), 'Photoshop handoff carries ordered execution pipeline');
assert(photoshopDesktop.metadata.designExecutionPipeline?.requiredToolSequence.includes('desktop.photoshop_document_status'), 'Photoshop pipeline carries document-status tool order');
assert(photoshopDesktop.metadata.designCreativeAi?.recipes.some((recipe) => recipe.id === 'photoshop.localized_cleanup'), 'Photoshop handoff carries creative-AI recipe metadata');
assert(photoshopDesktop.metadata.designCreativeAi?.recoveryHints.some((hint) => /selection or mask/i.test(hint)), 'Photoshop handoff carries creative-AI fail-closed recovery hint');
assert(photoshopDesktop.metadata.designAppTask?.recommendedTools.includes('desktop.photoshop_layer_inventory'), 'Photoshop handoff carries Photoshop layer inventory tool');
assert(photoshopDesktop.metadata.designAppTask?.recommendedTools.includes('desktop.photoshop_set_layer_state'), 'Photoshop handoff carries Photoshop layer-state tool');
assert.equal(photoshopDesktop.metadata.designProofReview?.reviewTitle, 'Photoshop Proof Review');
assert(photoshopDesktop.metadata.designProofReview?.checklist.some((item) => /Selection\/mask/i.test(item)), 'Photoshop handoff carries proof review checklist');
const photoshopApproval = buildChatComputerHandoffContext({
  task: photoshopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded Photoshop file task',
  approvalSummary: 'Review before generative fill, destructive edits, save, or export.',
});
const photoshopApprovalVisible = formatChatComputerHandoffForMessage(photoshopApproval);
assert(photoshopApprovalVisible.includes('Adobe Photoshop'));
assert(photoshopApprovalVisible.includes('layer inventory, selection/mask state'));
assert(!photoshopApprovalVisible.includes('text inventory'), 'Photoshop approval does not use InDesign text proof wording');

const photoshopRoute = buildChatComputerRequestRoute('Open Photoshop and generate a background then save png');
assert(photoshopRoute, 'Photoshop request route is available for handoff notice smoke');
const photoshopNoticeApproval = buildChatComputerHandoffContext({
  task: 'Open Photoshop and generate a background then save png',
  entrypoint: 'agent_runtime',
  adapterId: 'app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Desktop app task',
  approvalSummary: 'Review before Photoshop edits.',
  requestNotice: buildChatComputerRequestUserNotice(photoshopRoute!),
  evidenceContract: photoshopRoute!.evidenceContract,
  appAutomationRouteDecision: photoshopRoute!.appAutomationRouteDecision,
});
const photoshopNoticeVisible = formatChatComputerHandoffForMessage(photoshopNoticeApproval);
assert.equal(photoshopNoticeApproval.metadata.evidenceContract?.targetName, 'Adobe Photoshop');
assert.equal(photoshopNoticeApproval.metadata.appRouteDecision?.targetName, 'Adobe Photoshop');
assert.equal(photoshopNoticeApproval.metadata.appRouteDecision?.chosenSurfaceId, 'adobe_photoshop_uxp_dom');
assert(photoshopNoticeApproval.metadata.evidenceContract?.proofAfter.some((item) => /Photoshop document status/i.test(item)));
assert(photoshopNoticeVisible.includes('desktop-app path for Adobe Photoshop'));
assert(photoshopNoticeVisible.includes('Approve desktop run'));
assert(!photoshopNoticeVisible.includes('Surface:'), 'request notice handoff avoids technical route detail');

const abletonRoute = buildChatComputerRequestRoute('Use Ableton Live to create a four-bar drum loop and export it after approval');
assert(abletonRoute, 'Ableton request route is available for handoff notice smoke');
const abletonNoticeHandoff = buildChatComputerHandoffContext({
  task: 'Use Ableton Live to create a four-bar drum loop and export it after approval',
  entrypoint: 'agent_runtime',
  adapterId: 'app_adapter',
  taskKind: 'app_task',
  taskLabel: 'Desktop app task',
  approvalSummary: 'Review before unfamiliar app mutation or export.',
  requestNotice: buildChatComputerRequestUserNotice(abletonRoute!),
  evidenceContract: abletonRoute!.evidenceContract,
  appAutomationRouteDecision: abletonRoute!.appAutomationRouteDecision,
});
const abletonNoticeVisible = formatChatComputerHandoffForMessage(abletonNoticeHandoff);
assert.equal(abletonNoticeHandoff.metadata.evidenceContract?.targetName, 'Ableton Live');
assert.equal(abletonNoticeHandoff.metadata.evidenceContract?.taskFamily, 'file/save/export work');
assert.equal(abletonNoticeHandoff.metadata.appRouteDecision?.targetName, 'Ableton Live');
assert.equal(abletonNoticeHandoff.metadata.appRouteDecision?.taskFamily, 'file/save/export work');
assert(abletonNoticeVisible.includes('desktop-app path for Ableton Live'));
assert(abletonNoticeVisible.includes('Approve desktop run'));
assert(!abletonNoticeVisible.includes('Native desktop app'), 'unfamiliar app handoff should preserve inferred target');

const photoshopManifestArtifact = buildDesignAppObjectManifestArtifact({
  task: photoshopTask,
  beforeCaptures: [
    { tool: 'desktop.file_stat', data: { path: '/Users/chris/Downloads/photo/hero.psd', sizeBytes: 9200000 } },
    {
      tool: 'desktop.photoshop_document_status',
      data: {
        activeDocumentName: 'hero.psd',
        activeDocumentPath: '/Users/chris/Downloads/photo/hero.psd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        widthPx: 1200,
        heightPx: 800,
        layerCount: 6,
        textLayerCount: 1,
        smartObjectCount: 1,
        adjustmentLayerCount: 0,
        selectionActive: true,
      },
    },
    {
      tool: 'desktop.photoshop_layer_inventory',
      data: {
        documentName: 'hero.psd',
        layers: [{ name: 'Background', path: 'Background', kind: 'pixelLayer', visible: true, locked: false }],
      },
    },
  ],
  afterCaptures: [
    {
      tool: 'desktop.photoshop_document_status',
      data: {
        activeDocumentName: 'hero.psd',
        activeDocumentPath: '/Users/chris/Downloads/photo/hero.psd',
        activeDocumentSaved: true,
        activeDocumentModified: false,
        widthPx: 1200,
        heightPx: 800,
        layerCount: 7,
        textLayerCount: 1,
        smartObjectCount: 1,
        adjustmentLayerCount: 0,
        selectionActive: false,
      },
    },
    {
      tool: 'desktop.photoshop_layer_inventory',
      data: {
        documentName: 'hero.psd',
        layers: [{ name: 'Background cleaned', path: 'Background cleaned', kind: 'pixelLayer', visible: true, locked: false }],
      },
    },
    { tool: 'desktop.screenshot', data: { artifactId: 'screen-after' } },
  ],
  actionCaptures: [{
    tool: 'desktop.photoshop_export_proof',
    data: {
      documentName: 'hero.psd',
      outputPath: '/Users/chris/Downloads/photo/hero-proof.png',
      format: 'png',
      fileExists: true,
      sizeBytes: 245000,
      widthPx: 1200,
      heightPx: 800,
    },
  }],
  approvals: [{ id: 'approval-photoshop-proof', summary: 'Approved generative edit and PNG proof export.', approved: true }],
});
const photoshopWithManifest = buildChatComputerHandoffContext({
  task: photoshopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded Photoshop file task',
  designObjectManifestArtifact: photoshopManifestArtifact,
});
assert.equal(photoshopWithManifest.metadata.designObjectManifestArtifact?.auditOk, true);
assert.equal(photoshopWithManifest.metadata.designObjectManifestArtifact?.activeDocumentBasename, 'hero.psd');
assert(photoshopWithManifest.metadata.designObjectManifestArtifact?.artifactKinds.includes('proof'));
assert(!JSON.stringify(photoshopWithManifest.metadata.designObjectManifestArtifact).includes('/Users/'), 'manifest artifact summary hides local paths');

const desktopApproval = buildChatComputerHandoffContext({
  task: desktopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded desktop file task',
  approvalSummary: 'Review before editing text, relinking assets, save, export, or package.',
});
const desktopApprovalVisible = formatChatComputerHandoffForMessage(desktopApproval);
assert(desktopApprovalVisible.includes('Ready for review'));
assert(desktopApprovalVisible.includes('Adobe InDesign'));
assert(desktopApprovalVisible.includes('document status, text inventory'));
assert(desktopApprovalVisible.includes('Review before editing text'));

const blockedDesktop = buildChatComputerHandoffContext({
  task: desktopTask,
  entrypoint: 'agent_runtime',
  adapterId: 'hybrid_adapter',
  taskKind: 'hybrid_task',
  taskLabel: 'Uploaded desktop file task',
  blockers: ['Photoshop needs Accessibility permission'],
});
const blockedVisible = formatChatComputerHandoffForMessage(blockedDesktop);
assert(blockedVisible.includes('Needs attention'));
assert(!blockedVisible.includes('Uploaded package is preserved'), 'problem handoff does not claim persisted private package data');
assert(!blockedVisible.includes(DESKTOP_ATTACHMENT_MANIFEST_FILENAME), 'user-visible problem handoff hides manifest path by default');
assert(!formatChatComputerHandoffForMessage(blockedDesktop, { visibility: 'problem', includeTechnicalPaths: true }).includes(DESKTOP_ATTACHMENT_MANIFEST_FILENAME));

const localFiles = buildChatComputerHandoffContext({
  task: 'Search files in Downloads for invoice',
  entrypoint: 'agent_runtime',
  adapterId: 'file_adapter',
  taskKind: 'file_task',
  taskLabel: 'Local file task',
});
assert.equal(localFiles.surface, 'local_files');
assert(localFiles.touched.includes('surface:local_files'));
assert.equal(formatChatComputerHandoffForMessage(localFiles), '', 'successful local-file handoff stays quiet by default');
assert(formatChatComputerHandoffForMessage(localFiles, { visibility: 'debug' }).includes('Local file task'));

// ─── Model substitution visibility (2.5) ────────────────────────────────────
// Every substitution becomes visible; computer-use-capable models get NO notice.

const keptSonnet = resolveComputerTaskLoopModel('claude-sonnet-4-6');
assert.equal(keptSonnet.substituted, false, 'sonnet keeps driving the native loop');
assert.equal(keptSonnet.resolvedModel, 'claude-sonnet-4-6');
assert.equal(keptSonnet.reason, null);
assert.equal(formatComputerTaskModelResolutionNotice(keptSonnet), '', 'computer-use-capable model → no substitution notice at all');

const prefixedSonnet = resolveComputerTaskLoopModel('anthropic/claude-sonnet-4-6');
assert.equal(prefixedSonnet.substituted, false, 'anthropic/-prefixed sonnet is not a substitution');
assert.equal(prefixedSonnet.resolvedModel, 'claude-sonnet-4-6');

const marketplaceSonnet = resolveComputerTaskLoopModel('openrouter/anthropic/claude-sonnet-4-6');
assert.equal(marketplaceSonnet.substituted, false, 'provider-prefixed sonnet has computerUse:true → no notice');

// Edge-loop parity: resolveComputerUseModel keeps ANY claude-*sonnet id, so
// legacy sonnet ids the capability table does not list must never produce a
// false substitution notice.
const legacySonnet = resolveComputerTaskLoopModel('claude-3-5-sonnet-20241022');
assert.equal(legacySonnet.substituted, false, 'legacy sonnet ids the edge keeps stay notice-free');
assert.equal(legacySonnet.resolvedModel, 'claude-3-5-sonnet-20241022');

const substituted = resolveComputerTaskLoopModel('deepseek/deepseek-reasoner');
assert.equal(substituted.substituted, true, 'non-sonnet model → native loop pins sonnet');
assert.equal(substituted.resolvedModel, COMPUTER_USE_PINNED_LOOP_MODEL);
assert.equal(substituted.requestedModel, 'deepseek/deepseek-reasoner', 'requested id preserved verbatim');
assert.equal(substituted.reason, 'computer_use_requires_sonnet');
assert.equal(
  formatComputerTaskModelResolutionNotice(substituted),
  'Screen loop needs computer-use, so it runs on claude-sonnet-4-6; your pick (deepseek-reasoner) still plans and verifies.',
  'compact notice uses short (provider-stripped) model names',
);

const opusRequested = resolveComputerTaskLoopModel('claude-opus-4-8');
assert.equal(opusRequested.substituted, true, 'opus has computerUse:false → substitution is visible');
assert.equal(
  formatComputerTaskModelResolutionNotice(opusRequested),
  'Screen loop needs computer-use, so it runs on claude-sonnet-4-6; your pick (claude-opus-4-8) still plans and verifies.',
);

const unknownModel = resolveComputerTaskLoopModel('mystery-org/model-x');
assert.equal(unknownModel.substituted, true, 'unknown ids fail closed → pinned loop model + visible notice');
assert.equal(unknownModel.resolvedModel, COMPUTER_USE_PINNED_LOOP_MODEL);

const noModel = resolveComputerTaskLoopModel('');
assert.equal(noModel.substituted, false, 'no requested model is the plain default, not a substitution');
assert.equal(noModel.resolvedModel, COMPUTER_USE_PINNED_LOOP_MODEL);
assert.equal(formatComputerTaskModelResolutionNotice(noModel), '', 'default pin without a request → no notice');
assert.equal(resolveComputerTaskLoopModel(null).substituted, false, 'null model → default, no notice');

// Bounded-payload rule: absurdly long ids still yield one compact line.
const longId = resolveComputerTaskLoopModel(`openrouter/${'x'.repeat(300)}`);
assert.equal(longId.substituted, true);
const longNotice = formatComputerTaskModelResolutionNotice(longId);
assert(longNotice.length <= 160, 'substitution notice stays compact even for oversized model ids');
assert(
  longNotice.startsWith('Screen loop needs computer-use, so it runs on claude-sonnet-4-6;'),
  'notice shape holds for oversized ids',
);

// ─── Bounded + secret-safe persisted metadata (handoff is the persist boundary) ─
// grounding/preflight summaries are untrusted app-observation text. They (and
// approval/grant summaries, warnings, task label) MUST be bounded before they
// land in persisted chat metadata — no verbatim 50KB blobs, no secret pass-through.
{
  const secret = 'sk-ant-SECRETKEY1234567890 password=hunter2 Bearer ey.JWT.token';
  const big = 'X'.repeat(50_000);
  const boundedCtx = buildChatComputerHandoffContext({
    task: 'do a thing',
    entrypoint: 'browser_runtime',
    adapterId: 'browser_adapter',
    taskKind: 'browser_task',
    taskLabel: `label ${big}`,
    groundingSummary: `grounding ${secret} ${big}`,
    preflightSummary: `preflight ${secret} ${big}`,
    approvalSummary: `approval ${secret} ${big}`,
    grantSummary: `grant ${secret} ${big}`,
    warnings: [`warn ${big}`],
    rawWarnings: [`raw ${big}`],
    blockers: [`blocker ${big}`],
  });
  const meta = boundedCtx.metadata;
  assert((meta.groundingSummary || '').length <= 600, 'grounding summary is bounded in metadata');
  assert((meta.preflightSummary || '').length <= 600, 'preflight summary is bounded in metadata');
  assert((meta.approvalSummary || '').length <= 240, 'approval summary is bounded in metadata');
  assert((meta.grantSummary || '').length <= 240, 'grant summary is bounded in metadata');
  assert((meta.taskLabel || '').length <= 240, 'task label is bounded in metadata');
  assert(meta.warnings.every((w) => w.length <= 240), 'each warning item is bounded');
  assert((meta.rawWarnings || []).every((w) => w.length <= 240), 'each rawWarnings item is bounded');
  assert(meta.blockers.every((b) => b.length <= 240), 'each blocker item is bounded');
  // Whole persisted metadata stays compact even under an adversarial 50KB input.
  assert(JSON.stringify(meta).length < 20_000, 'persisted handoff metadata stays bounded overall');
  // The oversized blob is truncated (its 10k+ tail never survives verbatim).
  assert(!JSON.stringify(meta).includes('X'.repeat(10_000)), 'no verbatim oversized blob survives into metadata');
  // Debug chatLines (the only verbose visible view) are bounded too.
  assert(boundedCtx.chatLines.every((line) => line.length <= 400), 'debug chatLines stay bounded');
  console.log('pass: handoff metadata bounds untrusted summaries/warnings and stays compact');
}

console.log('All chat computer handoff context smoke cases passed.');
