/**
 * computer-task-complexity-smoketest
 *
 * Locks the checkpoint plan used by complex desktop/browser/file tasks.
 *
 * Run: npm run smoke:computer-task-complexity
 */

import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';
import {
  diagnoseComputerTaskCheckpointFailure,
  formatComputerTaskCheckpointRecoveryForPrompt,
} from '../src/lib/computerTaskCheckpointRecovery';
import { buildComputerTaskStateSteps, compactComputerTaskCheckpointRecovery, compactComputerTaskComplexityPlan, evaluateComputerTaskCheckpointEvidenceReadiness, markComputerTaskCheckpointRecoveryObserved } from '../src/lib/computerTaskStateModel';
import { prepareComputerTaskExecution } from '../src/lib/computerTaskExecution';

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

const uploadWorkflow = prepareComputerTaskExecution({
  task: 'Find logo.png on my Desktop, log into Shopify, upload it to the product page, verify the preview, and publish after I approve',
  audit: audit(),
  grantedIds: ['browser_navigation', 'browser_side_effect', 'file_read', 'file_write', 'app_read', 'app_action'],
});
assert(uploadWorkflow.preview.kind === 'hybrid_task', 'browser/file upload workflow is hybrid', uploadWorkflow.preview.kind);
assert(uploadWorkflow.complexityPlan.level === 'complex', 'browser/file upload workflow is complex', uploadWorkflow.complexityPlan.level);
assert(uploadWorkflow.complexityPlan.reasons.includes('cross-surface workflow'), 'complexity reasons include cross-surface workflow');
assert(uploadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'resolve-files'), 'complex workflow resolves local files');
assert(uploadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'observe-browser'), 'complex workflow observes browser state');
assert(uploadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'approval-before-side-effect'), 'complex workflow gates final side effect');
assert(uploadWorkflow.dispatchPrefix.includes('## Complex Computer Task Checkpoints'), 'dispatch prefix includes checkpoint block');
assert(uploadWorkflow.dispatchPrefix.includes('Run checkpoints in order'), 'dispatch prefix enforces checkpoint order');
const uploadStateComplexity = compactComputerTaskComplexityPlan(uploadWorkflow.complexityPlan);
assert(uploadStateComplexity?.level === 'complex', 'complex plan compacts into task state');
assert(!!uploadStateComplexity?.reasons.includes('cross-surface workflow'), 'task state compact keeps complexity reasons');
assert(!!uploadStateComplexity?.checkpoints.some((checkpoint) => checkpoint.id === 'resolve-files'), 'task state compact keeps checkpoint ids');
assert(
  buildComputerTaskStateSteps({
    taskKind: uploadWorkflow.preview.kind,
    phase: 'executing',
    complexity: uploadStateComplexity,
  }).some((step) => step.id === 'checkpoints' && step.status === 'active'),
  'task state adds active checkpoint step while executing complex work',
);
const uploadCheckpointRecovery = diagnoseComputerTaskCheckpointFailure({
  task: uploadWorkflow.preview.label,
  failureMessage: 'Upload failed because logo.png was not found inside the granted Desktop folder.',
  outcomeStatus: 'blocked',
  executionKind: 'run_computer_task',
  complexityPlan: uploadWorkflow.complexityPlan,
});
assert(uploadCheckpointRecovery?.failedCheckpointId === 'resolve-files', 'file blocker maps to resolve-files checkpoint', uploadCheckpointRecovery?.failedCheckpointId);
assert(uploadCheckpointRecovery?.safeNextStep.includes('exact path'), 'checkpoint recovery includes bounded file next step');
assert(uploadCheckpointRecovery?.retryPolicy.canRetry === true, 'checkpoint recovery allows one bounded retry');
assert(uploadCheckpointRecovery?.retryPolicy.requiredEvidence.some((item) => item.tool === 'desktop.file_search'), 'checkpoint recovery requires file search evidence');
assert(uploadCheckpointRecovery?.retryPolicy.requiredEvidence.some((item) => item.tool === 'desktop.file_stat'), 'checkpoint recovery requires file identity evidence');
assert(uploadCheckpointRecovery?.retryPolicy.forbiddenActions.some((item) => item.includes('No upload')), 'checkpoint recovery forbids file mutation before evidence');
assert(uploadCheckpointRecovery?.retryPolicy.resumeInstruction.includes('Collect fresh evidence'), 'checkpoint recovery includes resume instruction');
assert(formatComputerTaskCheckpointRecoveryForPrompt(uploadCheckpointRecovery)?.includes('failed checkpoint: resolve-files'), 'checkpoint recovery prompt names failed checkpoint');
assert(formatComputerTaskCheckpointRecoveryForPrompt(uploadCheckpointRecovery)?.includes('retry guard'), 'checkpoint recovery prompt includes retry guard');
assert(formatComputerTaskCheckpointRecoveryForPrompt(uploadCheckpointRecovery)?.includes('required fresh evidence'), 'checkpoint recovery prompt includes evidence requirements');
const compactUploadCheckpointRecovery = compactComputerTaskCheckpointRecovery(uploadCheckpointRecovery);
assert(compactUploadCheckpointRecovery?.failedCheckpointId === 'resolve-files', 'checkpoint recovery compacts into task state');
assert(!!compactUploadCheckpointRecovery?.safeNextStep.includes('exact path'), 'task state checkpoint recovery keeps safe next step');
assert(!!compactUploadCheckpointRecovery?.retryPolicy?.failureFingerprint.startsWith('checkpoint:resolve-files:'), 'task state checkpoint recovery keeps retry fingerprint');
const firstObservedUploadRecovery = markComputerTaskCheckpointRecoveryObserved(null, uploadCheckpointRecovery);
assert(firstObservedUploadRecovery?.retryPolicy?.repeatCount === 1, 'first checkpoint observation starts retry counter');
assert(firstObservedUploadRecovery?.retryPolicy?.canRetry === true, 'first checkpoint observation can retry once');
assert(firstObservedUploadRecovery?.retryPolicy?.evidenceReadiness?.status === 'missing', 'first checkpoint observation starts with missing evidence status', firstObservedUploadRecovery?.retryPolicy?.evidenceReadiness?.status);
assert(firstObservedUploadRecovery?.retryPolicy?.evidenceReadiness?.nextEvidenceTools.includes('desktop.file_search'), 'missing evidence points to next evidence tool');
const nowMs = Date.parse('2026-05-22T12:00:00.000Z');
const readyEvidence = evaluateComputerTaskCheckpointEvidenceReadiness({
  recovery: uploadCheckpointRecovery,
  nowMs,
  observations: [
    {
      id: 'file-search',
      tool: 'desktop.file_search',
      capturedAt: nowMs - 1_000,
      summary: 'Found /Users/cswanson/Desktop/logo.png',
    },
    {
      id: 'file-identity',
      tool: 'desktop.file_stat',
      capturedAt: nowMs - 1_000,
      summary: 'logo.png sha256=abc size=1234',
    },
  ],
});
assert(readyEvidence?.ready === true, 'checkpoint evidence readiness passes with fresh required evidence');
assert(readyEvidence?.status === 'ready', 'checkpoint evidence readiness reports ready');
const staleEvidence = evaluateComputerTaskCheckpointEvidenceReadiness({
  recovery: uploadCheckpointRecovery,
  nowMs,
  observations: [
    {
      id: 'file-search',
      tool: 'desktop.file_search',
      capturedAt: nowMs - 30_000,
      summary: 'Old file search',
    },
    {
      id: 'file-identity',
      tool: 'desktop.file_stat',
      capturedAt: nowMs - 30_000,
      summary: 'Old file stat',
    },
  ],
});
assert(staleEvidence?.status === 'stale', 'checkpoint evidence readiness detects stale evidence', staleEvidence?.status);
const repeatedUploadRecovery = markComputerTaskCheckpointRecoveryObserved(firstObservedUploadRecovery, uploadCheckpointRecovery);
assert(repeatedUploadRecovery?.retryPolicy?.repeatCount === 2, 'repeated checkpoint failure increments retry counter');
assert(repeatedUploadRecovery?.retryPolicy?.canRetry === false, 'repeated checkpoint failure blocks another blind retry');
assert(!!repeatedUploadRecovery?.retryPolicy?.stopReason?.includes('same checkpoint failure repeated'), 'repeated checkpoint failure explains stop reason');
assert(repeatedUploadRecovery?.retryPolicy?.evidenceReadiness?.status === 'blocked', 'repeated checkpoint failure blocks evidence readiness');

const cadWorkflow = prepareComputerTaskExecution({
  task: 'Open AutoCAD, create a dimensioned floor plan with correct units, export the DWG and PDF after approval',
  audit: audit(),
  grantedIds: ['app_read', 'app_action', 'file_read', 'file_write'],
});
assert(cadWorkflow.preview.kind === 'hybrid_task' || cadWorkflow.preview.kind === 'app_task', 'CAD workflow routes through app/hybrid runtime', cadWorkflow.preview.kind);
assert(cadWorkflow.complexityPlan.level === 'complex', 'CAD workflow is complex', cadWorkflow.complexityPlan.level);
assert(cadWorkflow.complexityPlan.reasons.includes('visual or precision desktop work'), 'CAD workflow marks precision desktop work');
assert(cadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'observe-desktop'), 'CAD workflow observes desktop/app state');
assert(cadWorkflow.dispatchPrefix.includes('Checkpoint rule'), 'CAD dispatch prefix carries checkpoint rule');
const cadCheckpointRecovery = diagnoseComputerTaskCheckpointFailure({
  task: 'Open AutoCAD, create a dimensioned floor plan with correct units, export the DWG and PDF after approval',
  failureMessage: 'Accessibility tree unavailable and screenshot capture failed before the AutoCAD window could be verified.',
  outcomeStatus: 'failed',
  executionKind: 'run_computer_task',
  stateComplexity: compactComputerTaskComplexityPlan(cadWorkflow.complexityPlan),
});
assert(cadCheckpointRecovery?.failedCheckpointId === 'observe-desktop', 'desktop observation blocker maps to observe-desktop checkpoint', cadCheckpointRecovery?.failedCheckpointId);
assert(cadCheckpointRecovery?.confidence === 'high', 'desktop checkpoint diagnosis is high confidence', cadCheckpointRecovery?.confidence);
assert(cadCheckpointRecovery?.retryPolicy.requiredEvidence.some((item) => item.tool === 'desktop.screenshot'), 'desktop checkpoint requires screenshot evidence');
assert(cadCheckpointRecovery?.retryPolicy.forbiddenActions.some((item) => item.includes('No keyboard')), 'desktop checkpoint forbids blind desktop action');

const simpleLaunch = prepareComputerTaskExecution({
  task: 'open zoom',
  audit: audit(),
  grantedIds: ['app_read'],
});
assert(simpleLaunch.complexityPlan.level === 'simple', 'pure app launch stays simple', simpleLaunch.complexityPlan.level);
assert(!simpleLaunch.dispatchPrefix.includes('## Complex Computer Task Checkpoints'), 'simple task does not inflate dispatch prefix');
assert(simpleLaunch.complexityPlan.visibleNextSteps.length <= 3, 'simple task keeps next steps compact');
assert(compactComputerTaskComplexityPlan(simpleLaunch.complexityPlan) === null, 'simple plan does not persist checkpoint state');
assert(diagnoseComputerTaskCheckpointFailure({
  task: 'open zoom',
  failureMessage: 'Zoom failed to launch.',
  complexityPlan: simpleLaunch.complexityPlan,
}) === null, 'simple task does not emit checkpoint recovery');

if (failures > 0) {
  console.error(`\n${failures} computer-task complexity smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-task complexity smoke cases passed.');
