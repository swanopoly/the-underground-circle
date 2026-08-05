/**
 * computer-task-execution-grounding-smoketest - verifies direct chat
 * computer-task dispatch carries the same grounding contract as OpenSwan.
 *
 * Run: npm run smoke:computer-task-execution-grounding
 */

import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';
import { prepareComputerTaskExecution } from '../src/lib/computerTaskExecution';
import {
  buildComputerTaskLocalFileAccessBlockedPresentation,
  buildComputerTaskSurfacePreparationBlockedPresentation,
  buildComputerTaskSurfacePreparationPlan,
  buildComputerTaskSurfacePreparationReceipt,
} from '../src/lib/computerTaskSurfacePreparation';

const CAPABILITY_IDS: ComputerCapabilityId[] = [
  'browser_automation',
  'browser_sessions',
  'file_search',
  'file_read',
  'file_write',
  'app_tools',
  'agent_bridges',
  'desktop_control',
];

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>> = {}): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => {
    const status = overrides[id] || 'ready';
    return {
      id,
      label: id,
      status,
      detail: `${id} ${status}`,
      sources: status === 'missing' ? [] : ['smoke-test'],
    };
  });
  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: [],
    availableIntegrationCapabilities: ['web_automation', 'remote_browser_sessions'],
    activeBridgeProviders: ['openswan'],
    activeMcpServerCount: 1,
    activeMcpToolCount: 8,
  };
}

const localTabs = prepareComputerTaskExecution({
  task: 'Tell me all the tabs I have open in Chrome right now',
  audit: audit(),
  grantedIds: ['app_read'],
});
assert(localTabs.computerAppGrounding?.strategy.id === 'desktop_readonly', 'local browser tabs execution has desktop_readonly grounding', localTabs.computerAppGrounding?.strategy.id);
assert(localTabs.computerAppGroundingTrace?.status === 'needs_observation', 'local browser tabs execution starts with observation trace', localTabs.computerAppGroundingTrace?.status);
assert(localTabs.computerAppGroundingNextStep?.tool === 'desktop.list_browser_tabs', 'local browser tabs execution starts with desktop tabs tool', localTabs.computerAppGroundingNextStep?.tool);
assert(localTabs.dispatchPrefix.includes('## Computer/App Grounding'), 'dispatch prefix includes grounding section');
assert(localTabs.dispatchPrefix.includes('Do not substitute Browserbase'), 'dispatch prefix blocks remote browser fallback for local tabs');
const localTabsSurfacePrep = buildComputerTaskSurfacePreparationPlan(localTabs);
assert(localTabsSurfacePrep.shouldPrepareDesktopBridge === true, 'local browser tabs task prepares desktop bridge first');
assert(['desktop_app', 'hybrid'].includes(localTabsSurfacePrep.surface), 'local browser tabs task prepares as local app/hybrid surface', localTabsSurfacePrep.surface);

const figma = prepareComputerTaskExecution({
  task: 'Open Figma and crop this image after I approve desktop control',
  audit: audit(),
  grantedIds: ['app_read', 'app_action'],
});
assert(figma.computerAppGrounding?.strategy.id === 'desktop_canvas_vision', 'Figma execution has canvas grounding strategy', figma.computerAppGrounding?.strategy.id);
assert(
  figma.computerAppGroundingRunbook?.steps.some((step) => step.tool === 'desktop.screenshot'),
  'Figma grounding runbook requires screenshot observation',
);
assert(
  figma.dispatchPrefix.includes('Every mutating action must cite sourceObservationIds'),
  'dispatch prefix carries action readiness citation contract',
);
assert(
  figma.dispatchPrefix.includes('No blind coordinate action'),
  'dispatch prefix carries canvas forbidden fallback',
);
const figmaPrep = buildComputerTaskSurfacePreparationPlan(figma);
assert(figmaPrep.shouldPrepareDesktopBridge === true, 'Figma task auto-prepares desktop bridge');
const figmaPrepReady = buildComputerTaskSurfacePreparationReceipt(figmaPrep, {
  ok: true,
  status: 'started_and_paired',
  content: 'started',
  userActionRequired: false,
});
assert(figmaPrepReady.ok === true, 'surface preparation receipt treats started bridge as ready');
assert(figmaPrepReady.warnings.length === 0, 'surface preparation receipt stays quiet when ready');
const figmaPrepFailed = buildComputerTaskSurfacePreparationReceipt(figmaPrep, {
  ok: false,
  status: 'starter_unavailable',
  content: 'no local starter',
  detail: 'no local starter',
  userActionRequired: true,
});
assert(figmaPrepFailed.ok === false, 'surface preparation receipt captures bridge startup failure');
assert(figmaPrepFailed.userActionRequired === true, 'surface preparation receipt marks unavailable local starter as user action');
assert(figmaPrepFailed.warnings.some((warning) => warning.includes('no local starter')), 'surface preparation receipt preserves compact failure detail');
const figmaPrepBlocked = buildComputerTaskSurfacePreparationBlockedPresentation(figmaPrepFailed);
assert(figmaPrepBlocked.shouldBlock === true, 'surface preparation failure can stop before noisy preflight recovery');
assert(figmaPrepBlocked.message.includes('desktop bridge button'), 'surface preparation block gives one bridge reconnect action');
assert(figmaPrepBlocked.message.includes('already tried'), 'surface preparation block confirms automatic bridge startup was attempted');
assert(figmaPrepBlocked.message.includes('npm run bridge'), 'surface preparation block includes the exact fallback only when auto-connect is unavailable');
assert(!figmaPrepBlocked.message.includes('Recovery Options'), 'surface preparation block does not expose recovery internals');
assert(figmaPrepBlocked.nextSteps.length === 2, 'surface preparation block keeps next steps compact');
const figmaPrepReadyPresentation = buildComputerTaskSurfacePreparationBlockedPresentation(figmaPrepReady);
assert(figmaPrepReadyPresentation.shouldBlock === false, 'ready surface preparation never blocks chat execution');
const fileGrantBlocked = buildComputerTaskLocalFileAccessBlockedPresentation({
  roots: ['~/Desktop'],
  scope: 'write',
  error: 'Local file access needs one-time session verification for this browser session before OpenSwan can modify local files.',
  errorCode: 'file_access_not_granted',
});
assert(fileGrantBlocked.message.includes('local file write access for ~/Desktop'), 'local file grant block names missing scope and root');
assert(fileGrantBlocked.message.includes('stopped before trying to modify or export files'), 'local file grant block confirms no unsafe file action ran');
assert(fileGrantBlocked.message.includes('desktop bridge button'), 'local file grant block gives bridge reconnect fallback');
assert(fileGrantBlocked.nextSteps.length === 3, 'local file grant block keeps next steps bounded');
assert(!fileGrantBlocked.message.includes('Recovery Options'), 'local file grant block does not expose recovery internals');

const photoshop = prepareComputerTaskExecution({
  task: 'Open Photoshop and crop this PSD after I approve desktop control',
  audit: audit(),
  grantedIds: ['app_read', 'app_action', 'file_read', 'file_write'],
});
assert(photoshop.computerAppGrounding?.strategy.id === 'creative_layout_control', 'Photoshop execution has creative design grounding strategy', photoshop.computerAppGrounding?.strategy.id);
assert(
  photoshop.computerAppGroundingRunbook?.steps.some((step) => step.tool === 'desktop.photoshop_layer_inventory'),
  'Photoshop grounding runbook requires layer inventory observation',
);
assert(
  photoshop.dispatchPrefix.includes('No localized generative/content-aware edit without a verified selection or mask'),
  'dispatch prefix carries Photoshop selection/mask guardrail',
);

const wordpress = prepareComputerTaskExecution({
  task: 'Login to WordPress with my saved vault credentials and draft a post',
  audit: audit(),
  grantedIds: ['browser_navigation', 'browser_side_effect'],
});
assert(wordpress.computerAppGrounding?.strategy.id === 'credentialed_browser', 'WordPress execution has credentialed browser grounding', wordpress.computerAppGrounding?.strategy.id);
assert(
  wordpress.computerAppGroundingRunbook?.steps.some((step) => step.tool === 'vault.runbook'),
  'WordPress grounding runbook starts with vault runbook',
);
assert(
  wordpress.dispatchPrefix.includes('Never expose raw secrets'),
  'dispatch prefix carries no-secret grounding rule',
);
assert(
  wordpress.computerAppGroundingTrace?.persistenceTargets.includes('computer_trace_artifact'),
  'execution trace declares computer trace artifact persistence target',
);
const wordpressPrep = buildComputerTaskSurfacePreparationPlan(wordpress);
assert(wordpressPrep.shouldPrepareDesktopBridge === false, 'remote browser task does not prepare desktop bridge first');

if (failures > 0) {
  console.error(`\n${failures} computer-task execution grounding smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-task execution grounding smoke cases passed.');
