/**
 * computer-task-evidence-recovery-smoketest
 *
 * Verifies that failed chat/browser/desktop tasks can be recovered against the
 * hidden route evidence contract instead of only raw prose or generic
 * checkpoint matching.
 *
 * Run: npm run smoke:computer-task-evidence-recovery
 */

import assert from 'node:assert/strict';
import {
  buildChatFailureRecoveryArchive,
  buildChatFailureRecoveryInput,
  buildChatFailureRecoveryOptions,
  buildChatFailureRecoveryVerificationPlan,
  formatChatFailureRecoveryUserMessage,
  formatChatFailureRecoveryDetail,
} from '../src/lib/chatFailureRecovery';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';
import {
  diagnoseComputerTaskEvidenceFailure,
  evaluateComputerTaskEvidenceRecoveryReadiness,
  formatComputerTaskEvidenceRecoveryForPrompt,
} from '../src/lib/computerTaskEvidenceRecovery';
import { buildAppAutomationRouteDecision } from '../src/lib/appAutomationControlSurfaces';
import { buildAppAdapterGapPlan } from '../src/lib/appAdapterGapContract';
import {
  buildAgentFailureRecoveryPolicy,
  type AgentFailureRecoveryStartResult,
} from '../src/lib/agentFailureRecovery';

const browserRoute = buildChatComputerRequestRoute('Log into Shopify and update this product page after I approve');
assert(browserRoute?.evidenceContract, 'browser route carries evidence contract');
const browserRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: browserRoute.evidenceContract,
  task: 'Update Shopify product page',
  failureMessage: 'Locator timed out because the target button was obscured and failed actionability checks.',
  outcomeStatus: 'failed',
  source: 'browser_bridge_action',
});
assert(browserRecovery, 'browser evidence failure is diagnosed');
assert.equal(browserRecovery?.failureArea, 'actionability', 'browser actionability failure is classified');
assert.equal(browserRecovery?.retryAllowed, true, 'browser actionability failure can retry after fresh evidence');
assert(browserRecovery?.requiredFreshEvidence.some((item) => /DOM\/ARIA|fresh/i.test(item)), 'browser recovery carries fresh DOM evidence');
assert(browserRecovery?.requiredEvidence.some((item) => item.tool === 'browser.verification_state'), 'browser recovery requires verification-state evidence');
assert(browserRecovery?.requiredEvidence.some((item) => item.tool === 'browser.dom_snapshot'), 'browser recovery requires DOM evidence');
assert(browserRecovery?.requiredEvidence.some((item) => item.tool === 'browser.locator_actionability'), 'browser recovery requires actionability evidence');
assert.equal(browserRecovery?.evidenceReadiness?.status, 'missing', 'browser recovery starts with missing evidence readiness');
assert.equal(browserRecovery?.recommendedOptionId, 'retry_with_fresh_evidence', 'browser recovery recommends fresh-evidence retry');

const taskStopConditionDoesNotPoisonActionability = diagnoseComputerTaskEvidenceFailure({
  contract: browserRoute.evidenceContract,
  task: 'Buy the basic plan, but stop and ask me if a CAPTCHA appears.',
  failureMessage: 'Locator timed out because the target button was obscured and failed actionability checks.',
  outcomeStatus: 'failed',
  source: 'browser_bridge_action',
});
assert.equal(
  taskStopConditionDoesNotPoisonActionability?.failureArea,
  'actionability',
  'CAPTCHA in the user task stop condition is not treated as an observed CAPTCHA failure',
);
assert.equal(
  taskStopConditionDoesNotPoisonActionability?.retryAllowed,
  true,
  'task stop-condition wording cannot disable an evidence-backed actionability retry',
);

const readinessNow = Date.parse('2026-05-28T12:00:00.000Z');
const readyBrowserEvidence = evaluateComputerTaskEvidenceRecoveryReadiness({
  recovery: browserRecovery,
  nowMs: readinessNow,
  observations: [
    { id: 'browser-verification-state', tool: 'browser.verification_state', capturedAt: readinessNow - 1_000 },
    { id: 'browser-dom-aria', tool: 'browser.dom_snapshot', capturedAt: readinessNow - 1_000 },
    { id: 'browser-actionability', tool: 'browser.locator_actionability', capturedAt: readinessNow - 1_000 },
  ],
});
assert.equal(readyBrowserEvidence?.status, 'ready', 'browser recovery readiness passes with fresh evidence');
assert.equal(readyBrowserEvidence?.ready, true, 'browser recovery readiness marks retry ready');
const staleBrowserEvidence = evaluateComputerTaskEvidenceRecoveryReadiness({
  recovery: browserRecovery,
  nowMs: readinessNow,
  observations: [
    { id: 'browser-verification-state', tool: 'browser.verification_state', capturedAt: readinessNow - 60_000 },
    { id: 'browser-dom-aria', tool: 'browser.dom_snapshot', capturedAt: readinessNow - 60_000 },
    { id: 'browser-actionability', tool: 'browser.locator_actionability', capturedAt: readinessNow - 60_000 },
  ],
});
assert.equal(staleBrowserEvidence?.status, 'stale', 'browser recovery readiness detects stale evidence');

const localImageRoute = buildChatComputerRequestRoute('Open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the Desktop and make it a jpg');
assert(localImageRoute?.evidenceContract, 'local image conversion route carries evidence contract');
const localImageMissingRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: localImageRoute.evidenceContract,
  task: 'Convert a Desktop image to JPG',
  failureMessage: 'desktop.convert_image preflight failed (file_not_found): No matching source image named Gemini_Generated_Image_lppqo8lppqo8lppq.png was found in the allowed folders.',
  outcomeStatus: 'failed',
  source: 'desktop.convert_image',
});
assert.equal(localImageMissingRecovery?.failureArea, 'fresh_evidence', 'missing local image maps to fresh file evidence');
assert.equal(localImageMissingRecovery?.retryAllowed, true, 'missing local image can retry after fresh file evidence');
assert.equal(localImageMissingRecovery?.userActionRequired, false, 'missing local image does not require bridge restart by default');
assert.equal(localImageMissingRecovery?.recommendedOptionId, 'retry_with_fresh_evidence', 'missing local image recommends fresh-evidence retry');
assert(localImageMissingRecovery?.requiredEvidence.some((item) => item.tool === 'desktop.file_search'), 'missing local image requires file search evidence');
assert(localImageMissingRecovery?.requiredEvidence.some((item) => item.tool === 'desktop.file_stat'), 'missing local image requires file stat evidence');
assert(localImageMissingRecovery?.resumeInstruction.includes('retry only the failed step once'), 'missing local image gets one-shot retry instruction');

const userBlockedRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: browserRoute.evidenceContract,
  task: 'Log into Shopify',
  failureMessage: 'Protected human verification and MFA are present on the login page.',
});
assert.equal(userBlockedRecovery?.userActionRequired, true, 'human verification requires the user');
assert.equal(userBlockedRecovery?.retryAllowed, false, 'human verification does not allow blind retry');
assert.equal(userBlockedRecovery?.evidenceReadiness?.status, 'blocked', 'user-blocked recovery readiness is blocked');
assert.equal(userBlockedRecovery?.recommendedOptionId, 'resolve_contract_blocker', 'human verification recommends user unblock');

const observedCaptchaRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: browserRoute.evidenceContract,
  task: 'Continue checkout',
  failureMessage: 'The run stopped after refreshing the page state.',
  outcomeStatus: 'blocked',
  observations: [{
    tool: 'browser.verification_state',
    ok: true,
    summary: 'A CAPTCHA human-verification challenge is visible in the observed page state.',
  }],
});
assert.equal(
  observedCaptchaRecovery?.failureArea,
  'user_unblock',
  'captured observation evidence can still classify a genuine CAPTCHA blocker',
);

const vlcReadRoute = buildChatComputerRequestRoute('Open VLC and read the current track title');
assert(vlcReadRoute?.evidenceContract, 'read-only VLC route carries evidence contract');
assert(vlcReadRoute?.appAutomationRouteDecision, 'read-only VLC route carries its app route decision');
const vlcReadRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: vlcReadRoute.evidenceContract,
  appRouteDecision: vlcReadRoute.appAutomationRouteDecision,
  task: 'Open VLC and read the current track title',
  failureMessage: 'The current track title was unavailable from the fresh accessibility observation.',
  outcomeStatus: 'blocked',
  source: 'desktop.read_a11y_tree',
});
assert.equal(vlcReadRecovery?.failureArea, 'fresh_evidence', 'read-only VLC failure requests fresh app evidence');
assert.equal(vlcReadRecovery?.retryAllowed, true, 'read-only VLC failure allows one bounded observation retry');
assert.equal(vlcReadRecovery?.userActionRequired, false, 'read-only VLC failure does not invent an approval unblock');
assert.deepEqual(vlcReadRecovery?.approvalBoundaries, [], 'read-only VLC recovery strips mutation-only route approvals');
assert.deepEqual(vlcReadRecovery?.appRouteDecision?.missingApprovals, [], 'read-only VLC route-decision summary strips mutation-only approvals');
assert.deepEqual(
  vlcReadRecovery?.requiredEvidence.map((item) => item.tool),
  ['desktop.window_state', 'desktop.read_a11y_tree'],
  'read-only VLC recovery requires exact window plus semantic read evidence only',
);
assert.doesNotMatch(
  [...(vlcReadRecovery?.requiredFreshEvidence || []), ...(vlcReadRecovery?.requiredProof || [])].join(' | '),
  /file_stat|file search|output|export|save|document mutation|layer inventory/i,
  'read-only VLC recovery carries no local-file or document-mutation evidence',
);
assert(!(vlcReadRecovery?.requiredEvidence || []).some((item) => /browser\.|desktop\.file_|user\.confirm/i.test(item.tool)), 'read-only VLC recovery cannot foreground a browser, inspect files, or request approval');

for (const [request, expectedTarget] of [
  ['Open Docker Desktop', 'Docker Desktop'],
  ['Open Microsoft Remote Desktop', 'Microsoft Remote Desktop'],
] as const) {
  const productRoute = buildChatComputerRequestRoute(request);
  assert(productRoute?.evidenceContract, `${request}: product read route carries evidence`);
  const recovery = diagnoseComputerTaskEvidenceFailure({
    contract: productRoute.evidenceContract,
    appRouteDecision: productRoute.appAutomationRouteDecision,
    task: request,
    failureMessage: 'The fresh app/window observation did not return the requested state.',
    outcomeStatus: 'blocked',
    source: 'desktop.window_state',
  });
  assert.equal(recovery?.targetName, expectedTarget, `${request}: exact product identity survives recovery`);
  assert.equal(recovery?.failureArea, 'fresh_evidence', `${request}: recovery requests fresh observation`);
  assert.deepEqual(recovery?.approvalBoundaries, [], `${request}: recovery invents no approval`);
  assert(!(recovery?.requiredEvidence || []).some((item) => /browser\.|desktop\.file_|user\.confirm|build_app_capability/i.test(item.tool)), `${request}: recovery exposes only app-read evidence`);
  assert.doesNotMatch(
    [...(recovery?.requiredFreshEvidence || []), ...(recovery?.requiredProof || [])].join(' | '),
    /file_stat|source file|output|export|save|mutation retry|buildout|research/i,
    `${request}: recovery has no file/mutation/buildout requirements`,
  );
}

const photoshopLaunchRoute = buildChatComputerRequestRoute('Open Photoshop');
assert(photoshopLaunchRoute?.evidenceContract, 'Photoshop launch-only route carries evidence contract');
const staleApprovalCopyOnSafeRead = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopLaunchRoute.evidenceContract,
  appRouteDecision: photoshopLaunchRoute.appAutomationRouteDecision,
  task: 'Open Photoshop',
  failureMessage: 'Approval lookup failed. The plan was not executed; retry when the approval service is available.',
  outcomeStatus: 'blocked',
  source: 'chat.run_computer_task',
});
assert.notEqual(staleApprovalCopyOnSafeRead?.failureArea, 'approval_boundary', 'stale approval copy cannot turn an approval-free launch into an approval boundary');
assert.deepEqual(staleApprovalCopyOnSafeRead?.approvalBoundaries, [], 'approval-free Photoshop launch retains no approval boundary during recovery');
assert((staleApprovalCopyOnSafeRead?.requiredEvidence || []).some((item) => item.tool === 'desktop.photoshop_document_status'), 'Photoshop launch recovery uses app-native status');
assert(!(staleApprovalCopyOnSafeRead?.requiredEvidence || []).some((item) => item.tool === 'desktop.photoshop_layer_inventory' || item.tool.startsWith('desktop.file_')), 'Photoshop launch recovery omits layer and file evidence');

const photoshopRoute = buildChatComputerRequestRoute('Open Photoshop and update the text layer then export a proof png');
assert(photoshopRoute?.evidenceContract, 'Photoshop route carries evidence contract');
assert(photoshopRoute?.appAutomationRouteDecision, 'Photoshop route carries app automation route decision');
const photoshopRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Update Photoshop text layer',
  failureMessage: 'Could not verify final state because Photoshop layer inventory and exported proof were missing.',
});
assert.equal(photoshopRecovery?.failureArea, 'fresh_evidence', 'Photoshop missing inventory maps to fresh evidence');
assert(photoshopRecovery?.requiredFreshEvidence.some((item) => /document status|layer inventory/i.test(item)), 'Photoshop recovery asks for refreshed layer inventory');
assert(photoshopRecovery?.requiredProof.some((item) => /proof artifact|file_stat|Photoshop/i.test(item)), 'Photoshop recovery carries proof-after requirements');

const photoshopExportProofRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Update Photoshop text layer and export a proof PNG',
  failureMessage: 'Final proof receipt was unavailable after the export attempt.',
  outcomeStatus: 'partial',
  source: 'desktop.photoshop_export_proof',
});
assert.equal(photoshopExportProofRecovery?.failureArea, 'proof_after', 'Photoshop export remains a proof-after failure');
assert(photoshopExportProofRecovery?.approvalBoundaries.some((item) => /mutation|save|export/i.test(item)), 'Photoshop mutation/export recovery retains approval boundaries');
assert(photoshopExportProofRecovery?.requiredEvidence.some((item) => item.tool === 'desktop.file_stat'), 'Photoshop export proof recovery retains output file stat');

const zoomMutationRoute = buildChatComputerRequestRoute('Open Zoom and mute my microphone');
assert(zoomMutationRoute?.evidenceContract, 'non-file Zoom mutation carries evidence contract');
const zoomProofRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: zoomMutationRoute.evidenceContract,
  task: 'Mute the microphone in Zoom',
  failureMessage: 'Final proof receipt could not be confirmed after the control action.',
  outcomeStatus: 'partial',
  source: 'desktop.run_applescript',
});
assert.equal(zoomProofRecovery?.failureArea, 'proof_after', 'Zoom mutation missing proof is classified as proof-after');
assert(zoomProofRecovery?.approvalBoundaries.some((item) => /mutation|saving|exporting|deleting/i.test(item)), 'Zoom mutation recovery retains approval policy');
assert(!zoomProofRecovery?.requiredEvidence.some((item) => item.tool === 'desktop.file_stat'), 'non-file Zoom mutation recovery does not fabricate output file evidence');

const routeObservationRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  appRouteDecision: photoshopRoute.appAutomationRouteDecision,
  task: 'Update Photoshop text layer',
  failureMessage: 'Route decision paused before mutation because app evidence is incomplete.',
});
assert.equal(routeObservationRecovery?.failureArea, 'fresh_evidence', 'route decision needing observation maps to fresh evidence');
assert.equal(routeObservationRecovery?.retryAllowed, true, 'route observation failure allows a bounded evidence retry');
assert.equal(routeObservationRecovery?.appRouteDecision?.status, 'needs_observation', 'recovery stores app route decision status');
assert(routeObservationRecovery?.requiredFreshEvidence.some((item) => /App route confirmation/i.test(item)), 'route missing confirmations become required fresh evidence');
assert(formatComputerTaskEvidenceRecoveryForPrompt(routeObservationRecovery)?.includes('app route decision: needs_observation'), 'prompt includes app route decision');

const indesignRoute = buildChatComputerRequestRoute('Open this InDesign file and resize the banner layout');
assert(indesignRoute?.evidenceContract, 'InDesign route carries evidence contract');
const indesignRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: indesignRoute.evidenceContract,
  task: 'Resize InDesign banner layout',
  failureMessage: 'Missing adapter: no InDesign resize/layout bridge tool is implemented for this command.',
});
assert.equal(indesignRecovery?.failureArea, 'capability_gap', 'missing InDesign adapter maps to capability gap');
assert.equal(indesignRecovery?.connectedAgentAllowed, true, 'missing adapter allows connected-agent buildout');
assert(indesignRecovery?.requiredEvidence.some((item) => item.tool === 'agent.build_app_capability.result'), 'missing adapter requires buildout result evidence');
assert(indesignRecovery?.requiredEvidence.some((item) => item.tool === 'computer.focused_smoke'), 'missing adapter requires focused smoke evidence');
assert.equal(indesignRecovery?.recommendedOptionId, 'let_connected_agent_repair', 'missing adapter recommends connected-agent repair');

const exportTaskDoesNotPoisonCapabilityGap = diagnoseComputerTaskEvidenceFailure({
  contract: indesignRoute.evidenceContract,
  task: 'Resize the InDesign banner and export a PDF proof.',
  failureMessage: 'Missing adapter: no InDesign export bridge tool is implemented for this command.',
  outcomeStatus: 'failed',
  source: 'computer_task_outcome',
});
assert.equal(
  exportTaskDoesNotPoisonCapabilityGap?.failureArea,
  'capability_gap',
  'requested export action is not mistaken for an observed approval boundary',
);
assert.equal(
  exportTaskDoesNotPoisonCapabilityGap?.recommendedOptionId,
  'let_connected_agent_repair',
  'missing export adapter retains the connected-agent repair path',
);

const genericAppRoute = buildChatComputerRequestRoute('Open the AcmeDesigner desktop app and create the requested marketing layout');
assert(genericAppRoute?.evidenceContract, 'generic native app route carries evidence contract');
const connectedBuildoutDecision = buildAppAutomationRouteDecision('Open the AcmeDesigner desktop app and create the requested marketing layout', {
  availableSurfaceIds: ['connected_agent_buildout'],
  allowConnectedAgentBuildout: true,
});
const routeBuildoutRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: genericAppRoute.evidenceContract,
  appRouteDecision: connectedBuildoutDecision,
  task: 'Create layout in AcmeDesigner',
  failureMessage: 'Route decision selected connected-agent buildout because no deterministic app bridge exists yet.',
});
assert.equal(routeBuildoutRecovery?.failureArea, 'capability_gap', 'connected-agent route decision maps to capability gap');
assert.equal(routeBuildoutRecovery?.connectedAgentAllowed, true, 'connected-agent route decision allows bounded repair');
assert.equal(routeBuildoutRecovery?.recommendedOptionId, 'let_connected_agent_repair', 'connected-agent route decision recommends repair');
assert(routeBuildoutRecovery?.matchedRules.some((item) => /needs_connected_agent_buildout/i.test(item)), 'matched rules preserve connected-agent route decision');

const userActionDecision = buildAppAutomationRouteDecision('Open Photoshop and update a layered poster', {
  userActionBlockers: ['Photoshop license sign-in is required'],
});
const routeUserActionRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  appRouteDecision: userActionDecision,
  task: 'Update Photoshop poster',
  failureMessage: 'Route decision paused for user action.',
});
assert.equal(routeUserActionRecovery?.failureArea, 'user_unblock', 'user-action route decision maps to user unblock');
assert.equal(routeUserActionRecovery?.userActionRequired, true, 'user-action route decision requires the user');
assert.equal(routeUserActionRecovery?.retryAllowed, false, 'user-action route decision blocks blind retry');
assert.equal(routeUserActionRecovery?.recommendedOptionId, 'resolve_contract_blocker', 'user-action route decision recommends blocker resolution');

const recoveryPrompt = formatComputerTaskEvidenceRecoveryForPrompt(indesignRecovery);
assert(recoveryPrompt?.includes('Computer task evidence recovery:'), 'evidence recovery formats prompt block');
assert(recoveryPrompt?.includes('connected agent allowed: yes'), 'prompt block includes connected-agent policy');
assert(recoveryPrompt?.includes('required evidence tools:'), 'prompt block includes required evidence tools');
assert(recoveryPrompt?.includes('evidence readiness:'), 'prompt block includes readiness state');
assert(!recoveryPrompt?.includes('/Users/'), 'prompt block avoids local absolute paths');

const policy = buildAgentFailureRecoveryPolicy({
  task: 'Update Shopify product page',
  failureMessage: 'Locator timed out because the target button was obscured and failed actionability checks.',
  executionKind: 'run_computer_task',
  source: 'browser_bridge_action',
});
const fakeRecovery: AgentFailureRecoveryStartResult = {
  ok: false,
  provider: 'codex',
  launched: false,
  recoveryAction: 'retry_with_grounding',
  assessment: policy.assessment,
  runbook: policy.runbook,
  message: 'Use fresh grounding before retrying.',
};
const launchedRecovery: AgentFailureRecoveryStartResult = {
  ...fakeRecovery,
  ok: true,
  launched: true,
  sessionId: 'codex-session-1',
  recoveryAction: 'patch_app_code',
};

const input = {
  task: 'Update Shopify product page',
  failureMessage: 'Locator timed out because the target button was obscured and failed actionability checks.',
  executionKind: 'run_computer_task',
  source: 'browser_bridge_action',
  evidenceContract: browserRoute.evidenceContract,
};
const agentInput = buildChatFailureRecoveryInput(input);
assert(agentInput.planSummary?.includes('Computer task evidence recovery:'), 'agent input includes evidence recovery context');
assert(agentInput.planSummary?.includes('required fresh evidence'), 'agent input includes required evidence');
const routeDecisionAgentInput = buildChatFailureRecoveryInput({
  ...input,
  appRouteDecision: photoshopRoute.appAutomationRouteDecision,
});
assert(routeDecisionAgentInput.planSummary?.includes('app route decision: needs_observation'), 'agent input includes app route decision recovery context');

const verificationPlan = buildChatFailureRecoveryVerificationPlan(input);
assert(verificationPlan.commands.includes('npm run smoke:computer-task-evidence-contract'), 'verification includes evidence contract smoke');
assert(verificationPlan.commands.includes('npm run smoke:computer-task-evidence-recovery'), 'verification includes evidence recovery smoke');
assert(verificationPlan.checks.some((check) => /route evidence contract/i.test(check)), 'verification includes evidence-contract check');

const options = buildChatFailureRecoveryOptions(input, fakeRecovery);
assert(options.some((option) => option.id === 'retry_with_fresh_evidence' && option.source === 'evidence_contract'), 'recovery options include contract evidence retry');
assert(options.some((option) => option.id === 'stop_and_report'), 'recovery options keep stop fallback');
const buildoutOptions = buildChatFailureRecoveryOptions({
  task: 'Resize InDesign banner layout',
  failureMessage: 'Missing adapter: no InDesign resize/layout bridge tool is implemented for this command.',
  executionKind: 'run_computer_task',
  source: 'computer_task_outcome',
  evidenceContract: indesignRoute.evidenceContract,
}, launchedRecovery);
assert(buildoutOptions.some((option) => option.id === 'let_connected_agent_repair' && option.detail.includes('codex-session-1') && option.source === 'evidence_contract'), 'connected-agent recovery option keeps launched session context');

const userMessage = formatChatFailureRecoveryUserMessage(input, fakeRecovery);
assert(userMessage.startsWith("Couldn't finish:"), 'chat bubble is terse — one-line reason, no evidence-contract dump');
const detailMessage = formatChatFailureRecoveryDetail(input, fakeRecovery);
assert(detailMessage.includes('Evidence contract:'), 'detail message includes compact evidence contract diagnosis');
assert(detailMessage.includes('Retry with required evidence') || detailMessage.includes('Retry after fresh evidence'), 'detail message includes fresh evidence option');

const archive = buildChatFailureRecoveryArchive(input, fakeRecovery);
assert((archive.archiveMetadata.evidenceRecovery as any)?.failureArea === 'actionability', 'archive metadata stores evidence recovery context');
assert((archive.archiveMetadata.recoveryOptions as any[])?.some((option) => option.source === 'evidence_contract'), 'archive recovery options preserve evidence source');

// ── Unfamiliar-app failures get research-first buildout + find-ladder guidance ─
const acmeTask = 'Open AcmeDesigner and rename the active board.';
const acmeRoute = buildChatComputerRequestRoute(acmeTask);
const acmeGap = buildAppAdapterGapPlan(acmeTask)?.contract || null;
assert(acmeGap, 'unfamiliar app task yields an app-adapter-gap contract');
assert(acmeRoute?.evidenceContract, 'unfamiliar app route carries evidence contract');

const acmeCapabilityRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: acmeRoute!.evidenceContract,
  appAdapterGap: acmeGap,
  task: acmeTask,
  failureMessage: 'Missing adapter: no AcmeDesigner bridge tool is implemented for renaming boards.',
});
assert.equal(acmeCapabilityRecovery?.failureArea, 'capability_gap', 'unfamiliar-app missing adapter → capability gap');
assert.equal(acmeCapabilityRecovery?.recommendedOptionId, 'let_connected_agent_repair');
// Research the control surface BEFORE buildout, then still require the buildout result.
assert(acmeCapabilityRecovery?.requiredEvidence[0]?.tool === 'research.search', 'research.search precedes buildout in required evidence');
assert(acmeCapabilityRecovery?.requiredEvidence.some((item) => item.tool === 'agent.build_app_capability.result'), 'buildout result still required');
assert(acmeCapabilityRecovery?.appCapabilityResearch?.findLadder.length, 'recovery carries the universal find ladder');
assert(acmeCapabilityRecovery?.appCapabilityResearch?.missingTool.startsWith('desktop.'), 'recovery proposes a desktop adapter tool');
assert(/research/i.test(acmeCapabilityRecovery?.resumeInstruction || ''), 'resume instruction is research-anchored');
assert(/retry/i.test(acmeCapabilityRecovery?.resumeInstruction || ''), 'resume instruction ends in a bounded retry');
assert(acmeCapabilityRecovery?.matchedRules.some((item) => /Research before guessing/i.test(item)), 'matched rules carry research-before-guessing');

const acmePrompt = formatComputerTaskEvidenceRecoveryForPrompt(acmeCapabilityRecovery) || '';
assert(acmePrompt.includes('research before guessing'), 'recovery prompt surfaces the research plan');
assert(acmePrompt.includes('propose app tool'), 'recovery prompt names the proposed adapter tool');
assert(!acmePrompt.includes('/Users/'), 'recovery prompt does not leak local paths');

// A fresh-evidence failure on an unfamiliar app walks the universal find ladder.
const acmeFreshRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: acmeRoute!.evidenceContract,
  appAdapterGap: acmeGap,
  task: acmeTask,
  failureMessage: 'Could not read the accessibility tree snapshot; the control target was stale.',
});
assert.equal(acmeFreshRecovery?.failureArea, 'fresh_evidence');
assert(acmeFreshRecovery?.requiredFreshEvidence.some((item) => /accessibility|semantic tree|command palette|menu bar/i.test(item)), 'fresh-evidence recovery walks the find ladder');

// Non-app failures are unchanged: no app capability research is attached.
assert.equal(browserRecovery?.appCapabilityResearch ?? null, null, 'browser recovery has no app capability research');

// ─── AR4: context-aware recovery — switch to a launchable fallback ────────
const webFallback = {
  displayName: 'Photopea',
  surface: 'browser' as const,
  openVia: 'browser_url',
  openTarget: 'https://www.photopea.com',
  reason: 'full-featured web app — works in the browser',
  availability: 'web' as const,
};

// The user asked for Pixelmator; its adapter is missing. WITHOUT a fallback
// this routes to a connected-agent buildout — WITH a launchable web fallback
// it becomes a one-tap switch-and-retry that names both intent and target.
const unavailableNoFallback = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Edit the product photo in Pixelmator',
  failureMessage: 'Missing adapter: no Pixelmator bridge tool is implemented for this command.',
});
assert.equal(unavailableNoFallback?.failureArea, 'capability_gap', 'AR4: missing adapter → capability gap');
assert.equal(unavailableNoFallback?.recommendedOptionId, 'let_connected_agent_repair', 'AR4: missing adapter with NO fallback routes to buildout');
assert.equal(unavailableNoFallback?.appFallback ?? null, null, 'AR4: no fallback → no appFallback on the context');

const unavailableWithFallback = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Edit the product photo in Pixelmator',
  failureMessage: 'Missing adapter: no Pixelmator bridge tool is implemented for this command.',
  namedAppIntent: 'pixelmator',
  appFallback: webFallback,
});
assert.equal(unavailableWithFallback?.recommendedOptionId, 'retry_with_fresh_evidence', 'AR4: launchable fallback turns a dead-end into switch-and-retry');
assert.equal(unavailableWithFallback?.userActionRequired, false, 'AR4: switch does not require the user');
assert.equal(unavailableWithFallback?.retryAllowed, true, 'AR4: switch allows retry');
assert.equal(unavailableWithFallback?.appFallback?.displayName, 'Photopea', 'AR4: the fallback rides the recovery context');
assert(/you asked to use pixelmator/i.test(unavailableWithFallback?.reason || ''), 'AR4: reason names the user intent');
assert(/photopea/i.test(unavailableWithFallback?.reason || ''), 'AR4: reason names the concrete fallback');
assert(/switch to photopea/i.test(unavailableWithFallback?.resumeInstruction || ''), 'AR4: resume instruction says switch to the fallback');
assert(/open it in the browser/i.test(unavailableWithFallback?.resumeInstruction || ''), 'AR4: resume instruction says how to open the fallback');
// Re-grounds on the fallback surface — not the capability-gap buildout smokes.
assert(!unavailableWithFallback?.requiredEvidence.some((item) => item.tool === 'agent.build_app_capability.result'), 'AR4: switch re-grounds, no buildout-result requirement');

// A website auth/verification wall is NOT solved by switching photo editors —
// the fallback must be suppressed there.
const authWall = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Edit the product photo in Pixelmator',
  failureMessage: 'A two-factor verification code is required to sign in before continuing.',
  namedAppIntent: 'pixelmator',
  appFallback: webFallback,
});
assert.equal(authWall?.appFallback ?? null, null, 'AR4: auth/verification blocker suppresses the app switch');
assert.notEqual(authWall?.recommendedOptionId, 'retry_with_fresh_evidence', 'AR4: auth blocker still routes to the user, not a silent switch');

// An UNCONFIRMED ('maybe') desktop fallback is not offered — switching to
// another unverified app would just chain the same failure.
const maybeFallback = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Edit the product photo in Pixelmator',
  failureMessage: 'Pixelmator Pro is not available on this Mac.',
  namedAppIntent: 'pixelmator',
  appFallback: { displayName: 'GIMP', surface: 'desktop', availability: 'maybe' },
});
assert.equal(maybeFallback?.appFallback ?? null, null, "AR4: a 'maybe' desktop fallback is not offered as a switch");

// A mutation that crossed the bridge boundary can be inspected, never replayed.
const postDispatchExactRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: photoshopRoute.evidenceContract,
  task: 'Open Photoshop and start a new project 600 x 600',
  failureMessage: 'Create request dispatched; final receipt was unavailable.',
  outcomeStatus: 'partial',
  replayPolicy: 'manual_verify_only',
  mutationDispatched: true,
  verificationOnlyTools: ['desktop.photoshop_document_status'],
});
assert.equal(postDispatchExactRecovery?.failureArea, 'proof_after', 'post-dispatch unknown is a proof problem, not an actionability retry');
assert.equal(postDispatchExactRecovery?.retryAllowed, false, 'post-dispatch exact mutation cannot be retried');
assert.equal(postDispatchExactRecovery?.connectedAgentAllowed, false, 'connected-agent repair cannot replay an uncertain mutation');
assert.equal(postDispatchExactRecovery?.recommendedOptionId, 'stop_and_report', 'post-dispatch exact mutation offers no retry option');
assert.equal(postDispatchExactRecovery?.replayPolicy, 'manual_verify_only');
assert.equal(postDispatchExactRecovery?.mutationDispatched, true);
assert.deepEqual(postDispatchExactRecovery?.verificationOnlyTools, ['desktop.photoshop_document_status']);
assert.deepEqual(
  postDispatchExactRecovery?.requiredEvidence.map((item) => item.tool),
  ['desktop.photoshop_document_status'],
  'only read-only Photoshop status is permitted after uncertain dispatch',
);
assert.match(postDispatchExactRecovery?.resumeInstruction || '', /Do not retry the original action/i);

console.log('All computer task evidence recovery smoke cases passed.');
