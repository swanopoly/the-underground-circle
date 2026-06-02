/**
 * design-app-adapter-gaps-smoketest
 *
 * Verifies that unsupported Photoshop/InDesign operations produce bounded
 * connected-agent adapter buildout contracts instead of falling through to
 * blind desktop control.
 *
 * Run: npm run smoke:design-app-adapter-gaps
 */

import assert from 'node:assert/strict';

import { buildAgentAppCapabilityBuildoutPolicy } from '../src/lib/agentAppCapabilityBuildout';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import {
  buildDesignAppAdapterGapPlan,
  buildDesignAppAdapterGapPromptBlock,
} from '../src/lib/designAppAdapterGaps';
import { buildDesignAppOperationRunbookPlan } from '../src/lib/designAppOperationRunbooks';

const indesignTask = 'Open this InDesign banner package, resize it to a 300x250 web ad, hide the legal disclaimer layer, and export a PDF proof.';
const indesignGapPlan = buildDesignAppAdapterGapPlan(indesignTask);

assert.equal(indesignGapPlan?.appId, 'adobe_indesign');
assert(indesignGapPlan?.gaps.some((gap) => gap.operation === 'resize_layout'));
assert(!indesignGapPlan?.gaps.some((gap) => gap.operation === 'toggle_layer_visibility'));
assert(indesignGapPlan?.sourceRefs.some((ref) => ref.url.includes('/indesign/uxp/scripts/')));
assert(indesignGapPlan?.sourceRefs.some((ref) => ref.url.includes('/indesign/dom/api/')));

const resizeGap = indesignGapPlan?.gaps.find((gap) => gap.operation === 'resize_layout');
assert(resizeGap?.missingBridgeTools.includes('desktop.indesign_resize_layout'));
assert(resizeGap?.requiredBridgeToolsBeforeRetry.includes('desktop.indesign_document_status'));
assert(resizeGap?.requiredBridgeToolsBeforeRetry.includes('desktop.indesign_text_inventory'));
assert(resizeGap?.requiredEvidence.some((item) => item.includes('overset')));
assert(resizeGap?.focusedSmokeCases.some((item) => item.includes('refuses ambiguous')));
assert(resizeGap?.failClosedRules.some((item) => item.includes('blind coordinates')));
assert(resizeGap?.connectedAgentTask.includes('agent') === false, 'gap task is a direct buildout instruction, not a chat command');

const layerRunbooks = buildDesignAppOperationRunbookPlan('Open this InDesign file and hide layer Legal.');
const layerRunbook = layerRunbooks?.runbooks.find((runbook) => runbook.operation === 'toggle_layer_visibility');
assert(layerRunbook?.steps.some((step) => step.tool === 'desktop.indesign_set_layer_state'));
assert.equal(layerRunbook?.adapterGap, undefined);
assert(layerRunbook?.fallbackBuildoutTrigger.includes('desktop.indesign_set_layer_state'));

const photoshopLayerTask = 'Open this Photoshop PSD and hide layer Legal.';
const photoshopLayerGapPlan = buildDesignAppAdapterGapPlan(photoshopLayerTask);
assert.equal(photoshopLayerGapPlan, null, 'Photoshop layer-state is now a shipped adapter, not an adapter gap');
const photoshopLayerRunbooks = buildDesignAppOperationRunbookPlan(photoshopLayerTask);
const photoshopLayerRunbook = photoshopLayerRunbooks?.runbooks.find((runbook) => runbook.operation === 'toggle_layer_visibility');
assert(photoshopLayerRunbook?.steps.some((step) => step.tool === 'desktop.photoshop_set_layer_state'));
assert.equal(photoshopLayerRunbook?.adapterGap, undefined);
assert(photoshopLayerRunbook?.fallbackBuildoutTrigger.includes('desktop.photoshop_set_layer_state'));

const photoshopTask = 'Open this Photoshop PSD, select the product area, remove the background with generative fill, add a curves adjustment layer, and export a PNG proof.';
const photoshopGapPlan = buildDesignAppAdapterGapPlan(photoshopTask);

assert.equal(photoshopGapPlan?.appId, 'adobe_photoshop');
assert(photoshopGapPlan?.gaps.some((gap) => gap.operation === 'generative_fill_or_remove'));
assert(photoshopGapPlan?.gaps.some((gap) => gap.operation === 'edit_adjustment_layers'));
assert(photoshopGapPlan?.sourceRefs.some((ref) => ref.url.includes('/photoshop/uxp/scripting/')));
assert(photoshopGapPlan?.sourceRefs.some((ref) => ref.url.includes('/executeasmodal/')));
assert(photoshopGapPlan?.sourceRefs.some((ref) => ref.url.includes('/batchplay/')));

const generativeGap = photoshopGapPlan?.gaps.find((gap) => gap.operation === 'generative_fill_or_remove');
assert(generativeGap?.missingBridgeTools.includes('desktop.photoshop_generative_fill_or_remove'));
assert(generativeGap?.controlSurface.includes('batchPlay'));
assert(generativeGap?.requiredBridgeToolsBeforeRetry.includes('desktop.photoshop_document_status'));
assert(generativeGap?.requiredBridgeToolsBeforeRetry.includes('desktop.photoshop_layer_inventory'));
assert(generativeGap?.requiredBridgeToolsBeforeRetry.includes('desktop.photoshop_export_proof'));
assert(generativeGap?.requiredEvidence.some((item) => item.includes('selection/mask')));
assert(generativeGap?.focusedSmokeCases.some((item) => item.includes('selection or mask')));
assert(generativeGap?.failClosedRules.some((item) => item.includes('executeAsModal')));

const adjustmentGap = photoshopGapPlan?.gaps.find((gap) => gap.operation === 'edit_adjustment_layers');
assert(adjustmentGap?.missingBridgeTools.includes('desktop.photoshop_apply_adjustment_layer'));
assert(adjustmentGap?.requiredEvidence.some((item) => item.includes('adjustment descriptor')));
assert(adjustmentGap?.failClosedRules.some((item) => item.includes('blind sliders')));

const promptBlock = buildDesignAppAdapterGapPromptBlock(photoshopTask) || '';
assert(promptBlock.includes('Design App Adapter Gap Contracts'));
assert(promptBlock.includes('desktop.photoshop_generative_fill_or_remove'));
assert(promptBlock.includes('executeAsModal'));
assert(!promptBlock.includes('/Users/'), 'adapter gap prompt does not leak local paths');

const runbooks = buildDesignAppOperationRunbookPlan(photoshopTask);
const generativeRunbook = runbooks?.runbooks.find((runbook) => runbook.operation === 'generative_fill_or_remove');
assert(generativeRunbook?.adapterGap?.adapterId === generativeGap?.adapterId);
assert(generativeRunbook?.fallbackBuildoutTrigger.includes('Photoshop generative fill or remove adapter'));
assert(generativeRunbook?.failClosedConditions.some((item) => item.includes('approval is missing')));

const policy = buildAgentAppCapabilityBuildoutPolicy({
  task: photoshopTask,
  appName: 'Adobe Photoshop',
  capabilityGap: generativeGap?.connectedAgentTask,
  desiredOutcome: 'Add the missing Photoshop generative adapter and retry once with proof.',
});
assert(policy.prompt.includes('Design App Adapter Gap Contracts'));
assert(policy.researchChecklist.some((item) => item.includes('batchPlay')));
assert(policy.researchChecklist.some((item) => item.includes('executeAsModal')));

const handoff = buildChatComputerHandoffContext({
  task: indesignTask,
  adapterId: 'app_adapter',
  taskKind: 'app_task',
});
assert(handoff.metadata.designAdapterGaps?.some((gap) => gap.operation === 'resize_layout'));
assert(!handoff.metadata.designAdapterGaps?.some((gap) => gap.operation === 'toggle_layer_visibility'));
assert(!JSON.stringify(handoff.metadata.designAdapterGaps).includes('/Users/'), 'handoff adapter-gap metadata does not leak local paths');

console.log('All design-app adapter gap smoke cases passed.');
