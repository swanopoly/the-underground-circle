/**
 * engineering-cad-operation-runbooks-smoketest
 *
 * Verifies that CAD/engineering app tasks get operation-level runbooks:
 * observe -> approve -> act -> verify -> recover/stop.
 *
 * Run: npm run smoke:engineering-cad-operation-runbooks
 */

import assert from 'node:assert/strict';

import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import { buildComputerTaskDispatchPrefix } from '../src/lib/computerTaskDispatch';
import {
  buildEngineeringCadOperationRunbookPlan,
  buildEngineeringCadOperationRunbookPromptBlock,
} from '../src/lib/engineeringCadOperationRunbooks';
import { buildComputerAppPreflight } from '../src/lib/computerAppPreflight';
import { planComputerTaskPreview } from '../src/lib/computerTaskPlanner';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';
import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';
import type { ComputerTaskGrantPlan } from '../src/lib/computerTaskGrants';

const autocadTask = 'Open AutoCAD, create a 2D floor plan with two rooms and dimensions, then export a PDF after approval.';
const autocadPlan = buildEngineeringCadOperationRunbookPlan(autocadTask);
assert.equal(autocadPlan?.targetName, 'AutoCAD / DWG CAD app');
assert(autocadPlan?.operations.includes('draft_2d_geometry'));
assert(autocadPlan?.operations.includes('update_dimensions_layers'));
assert(autocadPlan?.operations.includes('export_plot'));

const draftRunbook = autocadPlan?.runbooks.find((runbook) => runbook.operation === 'draft_2d_geometry');
assert.equal(draftRunbook?.risk, 'review');
assert(draftRunbook?.steps.some((step) => step.tool === 'desktop.observe_app'),
  'P18: runbooks observe via the combined one-round-trip tool');
assert(!draftRunbook?.steps.some((step) => step.tool === 'desktop.window_state'),
  'P18: separate window-state observe step replaced by observe_app');
assert(draftRunbook?.steps.some((step) => step.tool === 'approvals.request' && step.approvalRequired));
assert(draftRunbook?.steps.some((step) => step.tool === 'desktop.type_text' && step.approvalRequired));
assert(draftRunbook?.failClosedConditions.some((item) => item.includes('units/scale/origin')));
assert(draftRunbook?.sourceRefs.some((ref) => ref.label.includes('AutoLISP')));

const exportRunbook = autocadPlan?.runbooks.find((runbook) => runbook.operation === 'export_plot');
assert.equal(exportRunbook?.risk, 'high');
assert(exportRunbook?.approvalBefore.some((item) => item.includes('plot')));
assert(exportRunbook?.steps.some((step) => step.tool === 'desktop.file_stat'));
assert(exportRunbook?.successCriteria.some((item) => item.includes('output file exists')));

const solidworksPlan = buildEngineeringCadOperationRunbookPlan('Use SOLIDWORKS to update this part dimension and export STEP after approval.');
assert.equal(solidworksPlan?.targetName, 'SOLIDWORKS');
assert(solidworksPlan?.operations.includes('model_or_bim_edit'));
assert(solidworksPlan?.operations.includes('export_plot'));
assert(solidworksPlan?.sourceRefs.some((ref) => ref.label.includes('SOLIDWORKS API')));
assert(solidworksPlan?.sourceRefs.some((ref) => ref.label.includes('SOLIDWORKS macros')));

const matlabPlan = buildEngineeringCadOperationRunbookPlan('Open MATLAB, build a Simulink model, run the simulation, test the script, and export plots after approval.');
assert.equal(matlabPlan?.targetName, 'MATLAB / Simulink');
assert(matlabPlan?.operations.includes('matlab_compute_simulation'));
assert(matlabPlan?.operations.includes('matlab_code_test_review'));
assert(matlabPlan?.sourceRefs.some((ref) => ref.label.includes('MATLAB MCP Core Server')));
assert(matlabPlan?.sourceRefs.some((ref) => ref.label.includes('MATLAB Agentic Toolkit')));
const matlabRunbook = matlabPlan?.runbooks.find((runbook) => runbook.operation === 'matlab_compute_simulation');
assert.equal(matlabRunbook?.risk, 'review');
assert(matlabRunbook?.steps.some((step) => step.tool?.includes('detect_matlab_toolboxes')));
assert(matlabRunbook?.fallbackBuildoutTrigger.includes('MATLAB execution adapter'));

const revitPlan = buildEngineeringCadOperationRunbookPlan('Open Revit, update the sheet title block, and export a PDF set after approval.');
assert.equal(revitPlan?.targetName, 'Autodesk Revit');
assert(revitPlan?.operations.includes('model_or_bim_edit'));
assert(revitPlan?.operations.includes('update_dimensions_layers'));
assert(revitPlan?.sourceRefs.some((ref) => ref.label.includes('Revit API')));

const batchPlan = buildEngineeringCadOperationRunbookPlan('Batch convert this folder of DWG files to DXF using cloud automation after approval.');
assert(batchPlan?.operations.includes('batch_convert_or_translate'));
const batchRunbook = batchPlan?.runbooks.find((runbook) => runbook.operation === 'batch_convert_or_translate');
assert.equal(batchRunbook?.risk, 'high');
assert(batchRunbook?.sourceRefs.some((ref) => ref.label.includes('Automation API')));
assert(batchRunbook?.approvalBefore.some((item) => item.includes('uploading design files')));

assert.equal(buildEngineeringCadOperationRunbookPlan('Open Photoshop and crop this PSD'), null);

const promptBlock = buildEngineeringCadOperationRunbookPromptBlock(autocadTask) || '';
assert(promptBlock.includes('Engineering/CAD Operation Runbooks'));
assert(promptBlock.includes('Draft or revise 2D CAD geometry'));
assert(promptBlock.includes('Fail closed'));
assert(promptBlock.includes('Source refs:'));
assert(promptBlock.includes('AutoCAD'));
assert(!promptBlock.includes('/Users/'), 'CAD prompt block does not leak local paths');

const handoff = buildChatComputerHandoffContext({
  task: autocadTask,
  adapterId: 'app_adapter',
  taskKind: 'app_task',
});
assert(handoff.metadata.engineeringCadOperationRunbooks?.some((runbook) => runbook.operation === 'draft_2d_geometry'));
assert(handoff.metadata.engineeringCadOperationRunbooks?.some((runbook) => runbook.controlSurface.includes('AutoCAD')));
assert(handoff.chatLines.some((line) => line.includes('CAD runbooks')));
assert(!JSON.stringify(handoff.metadata.engineeringCadOperationRunbooks).includes('/Users/'), 'CAD runbook metadata does not leak local paths');

const saved = formatPersistedChatBotMessage('OpenSwan', 'CAD task staged.', {
  computerHandoff: handoff.metadata,
});
const savedMetadata = readPersistedChatBotMetadata(saved);
assert(savedMetadata?.computerHandoff?.engineeringCadOperationRunbooks?.some((runbook) => runbook.operation === 'draft_2d_geometry'));
assert(!JSON.stringify(savedMetadata?.computerHandoff?.engineeringCadOperationRunbooks || {}).includes('/Users/'), 'persisted CAD runbooks do not leak local paths');

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

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>> = {}): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => ({
    id,
    label: id,
    status: overrides[id] || 'ready',
    detail: `${id} ${overrides[id] || 'ready'}`,
    sources: ['smoke-test'],
  }));
  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: [],
    availableIntegrationCapabilities: [],
    activeBridgeProviders: [],
    activeMcpServerCount: 0,
    activeMcpToolCount: 0,
  };
}

const grantPlan: ComputerTaskGrantPlan = {
  grants: [],
  granted: [],
  outstanding: [],
  requiresApproval: false,
  summary: 'No grants required for smoke.',
  approvalSummary: null,
};

const dispatchBlock = buildComputerTaskDispatchPrefix({
  task: autocadTask,
  preview: planComputerTaskPreview(autocadTask),
  readiness: { ready: true, missing: [], summary: 'ready' },
  audit: audit(),
  grants: grantPlan,
  preflight: buildComputerAppPreflight({ task: autocadTask, audit: audit() }),
});
assert(dispatchBlock.includes('Engineering/CAD Operation Runbooks'));
assert(dispatchBlock.includes('Draft or revise 2D CAD geometry'));
assert(dispatchBlock.includes('CAD mutation'));

console.log('All engineering CAD operation runbook smoke cases passed.');
