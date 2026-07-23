/**
 * design-app-operation-runbooks-smoketest
 *
 * Verifies that Photoshop/InDesign tasks get operation-level runbooks:
 * observe -> approve -> act -> verify -> recover/stop.
 *
 * Run: npm run smoke:design-app-operation-runbooks
 */

import assert from 'node:assert/strict';

import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import {
  buildDesignAppOperationRunbookPlan,
  buildDesignAppOperationRunbookPromptBlock,
} from '../src/lib/designAppOperationRunbooks';

const indesignTask = 'Open this InDesign package, update the headline layer, relink the hero image, export a proof PDF, and package it for handoff.';
const indesignPlan = buildDesignAppOperationRunbookPlan(indesignTask);

assert.equal(indesignPlan?.appId, 'adobe_indesign');
assert(indesignPlan?.runbooks.some((runbook) => runbook.operation === 'update_text_layers'));
assert(indesignPlan?.runbooks.some((runbook) => runbook.operation === 'replace_linked_asset'));
assert(indesignPlan?.runbooks.some((runbook) => runbook.operation === 'export_proof'));
assert(indesignPlan?.runbooks.some((runbook) => runbook.operation === 'package_handoff'));

const textRunbook = indesignPlan?.runbooks.find((runbook) => runbook.operation === 'update_text_layers');
assert(textRunbook?.steps.some((step) => step.tool === 'desktop.indesign_text_inventory'));
assert(textRunbook?.steps.some((step) => step.tool === 'approvals.request' && step.approvalRequired));
assert(textRunbook?.steps.some((step) => String(step.tool).includes('desktop.indesign_batch_update_text_layers')));
assert(textRunbook?.failClosedConditions.some((item) => item.includes('overset')));
assert(textRunbook?.sourceRefs.some((ref) => ref.url.includes('/TextFrame/')));

const packageRunbook = indesignPlan?.runbooks.find((runbook) => runbook.operation === 'package_handoff');
assert(packageRunbook?.steps.some((step) => step.tool === 'desktop.indesign_package_document'));
assert(packageRunbook?.successCriteria.some((item) => item.includes('package report')));

const layerPlan = buildDesignAppOperationRunbookPlan('Open this InDesign file and hide layer Legal.');
const layerRunbook = layerPlan?.runbooks.find((runbook) => runbook.operation === 'toggle_layer_visibility');
assert(layerRunbook?.steps.some((step) => step.tool === 'desktop.indesign_set_layer_state'));
assert(layerRunbook?.steps.some((step) => step.tool === 'approvals.request' && step.approvalRequired));
assert(layerRunbook?.successCriteria.some((item) => item.includes('exactly one layer matched')));
assert(!layerRunbook?.adapterGap);

const photoshopTask = 'Open this Photoshop PSD, replace the logo smart object, remove the background with generative fill, update the CTA text layer, and export a PNG proof.';
const photoshopPlan = buildDesignAppOperationRunbookPlan(photoshopTask);

assert.equal(photoshopPlan?.appId, 'adobe_photoshop');
assert(photoshopPlan?.runbooks.some((runbook) => runbook.operation === 'replace_linked_asset'));
assert(photoshopPlan?.runbooks.some((runbook) => runbook.operation === 'generative_fill_or_remove'));
assert(photoshopPlan?.runbooks.some((runbook) => runbook.operation === 'update_text_layers'));
assert(photoshopPlan?.runbooks.some((runbook) => runbook.operation === 'export_raster_proof'));

const generativeRunbook = photoshopPlan?.runbooks.find((runbook) => runbook.operation === 'generative_fill_or_remove');
assert.equal(generativeRunbook?.risk, 'high');
assert(generativeRunbook?.controlSurface.includes('batchPlay') || generativeRunbook?.controlSurface.includes('executeAsModal'));
assert(generativeRunbook?.requiredInputs.some((input) => input.includes('selection or mask')));
assert(generativeRunbook?.steps.some((step) => step.tool === 'approvals.request' && step.approvalRequired));
assert(generativeRunbook?.failClosedConditions.some((item) => item.includes('selection/mask target missing')));
assert(generativeRunbook?.sourceRefs.some((ref) => ref.url.includes('/batchplay/')));

const photoshopLayerPlan = buildDesignAppOperationRunbookPlan('Open this Photoshop PSD and hide layer Legal.');
const photoshopLayerRunbook = photoshopLayerPlan?.runbooks.find((runbook) => runbook.operation === 'toggle_layer_visibility');
assert(photoshopLayerRunbook?.steps.some((step) => step.tool === 'desktop.photoshop_set_layer_state'));
assert(photoshopLayerRunbook?.steps.some((step) => step.tool === 'desktop.photoshop_layer_inventory'));
assert(photoshopLayerRunbook?.failClosedConditions.some((item) => item.includes('target layer ambiguous')));

const promptBlock = buildDesignAppOperationRunbookPromptBlock(photoshopTask) || '';
assert(promptBlock.includes('Design App Operation Runbooks'));
assert(promptBlock.includes('Run generative/content-aware action'));
assert(promptBlock.includes('Fail closed'));
assert(promptBlock.includes('Source refs:'));

// ── Illustrator: vector requests route to the deterministic runbook ──────────
const illustratorTask = 'Open this Illustrator file and vectorize the logo, then recolor it red.';
const illustratorPlan = buildDesignAppOperationRunbookPlan(illustratorTask);
assert.equal(illustratorPlan?.appId, 'adobe_illustrator');
const vectorizeRunbook = illustratorPlan?.runbooks.find((runbook) => runbook.operation === 'vectorize');
assert(vectorizeRunbook?.steps.some((step) => step.tool === 'desktop.illustrator_document_status'), 'vectorize runbook observes via illustrator_document_status');
assert(vectorizeRunbook?.steps.some((step) => step.tool === 'desktop.illustrator_vectorize'), 'vectorize runbook acts through the shipped adapter');
assert(vectorizeRunbook?.steps.some((step) => step.tool === 'approvals.request' && step.approvalRequired), 'vectorize runbook gates on approval');
assert(vectorizeRunbook?.sourceRefs.some((ref) => /illustrator/i.test(ref.label)), 'vectorize runbook cites Illustrator source refs');
const recolorRunbook = illustratorPlan?.runbooks.find((runbook) => runbook.operation === 'set_appearance');
assert(recolorRunbook?.steps.some((step) => step.tool === 'desktop.illustrator_set_appearance'), 'recolor runbook acts through the appearance adapter');

const handoff = buildChatComputerHandoffContext({
  task: photoshopTask,
  adapterId: 'app_adapter',
  taskKind: 'app_task',
});
assert(handoff.metadata.designOperationRunbooks?.some((runbook) => runbook.operation === 'generative_fill_or_remove'));
assert(handoff.metadata.designOperationRunbooks?.some((runbook) => runbook.controlSurface.includes('Photoshop')));
assert(!JSON.stringify(handoff.metadata.designOperationRunbooks).includes('/Users/'), 'runbook metadata does not leak local paths');

console.log('All design app operation runbook smoke cases passed.');
