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
} from '../src/lib/chatFailureRecovery';
import { buildChatComputerRequestRoute } from '../src/lib/chatComputerRequestRouter';
import {
  diagnoseComputerTaskEvidenceFailure,
  evaluateComputerTaskEvidenceRecoveryReadiness,
  formatComputerTaskEvidenceRecoveryForPrompt,
} from '../src/lib/computerTaskEvidenceRecovery';
import { buildAppAutomationRouteDecision } from '../src/lib/appAutomationControlSurfaces';
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

const userBlockedRecovery = diagnoseComputerTaskEvidenceFailure({
  contract: browserRoute.evidenceContract,
  task: 'Log into Shopify',
  failureMessage: 'Protected human verification and MFA are present on the login page.',
});
assert.equal(userBlockedRecovery?.userActionRequired, true, 'human verification requires the user');
assert.equal(userBlockedRecovery?.retryAllowed, false, 'human verification does not allow blind retry');
assert.equal(userBlockedRecovery?.evidenceReadiness?.status, 'blocked', 'user-blocked recovery readiness is blocked');
assert.equal(userBlockedRecovery?.recommendedOptionId, 'resolve_contract_blocker', 'human verification recommends user unblock');

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
assert(userMessage.includes('Evidence contract:'), 'visible recovery message includes compact evidence contract diagnosis');
assert(userMessage.includes('Retry with required evidence') || userMessage.includes('Retry after fresh evidence'), 'visible recovery message includes fresh evidence option');

const archive = buildChatFailureRecoveryArchive(input, fakeRecovery);
assert((archive.archiveMetadata.evidenceRecovery as any)?.failureArea === 'actionability', 'archive metadata stores evidence recovery context');
assert((archive.archiveMetadata.recoveryOptions as any[])?.some((option) => option.source === 'evidence_contract'), 'archive recovery options preserve evidence source');

console.log('All computer task evidence recovery smoke cases passed.');
