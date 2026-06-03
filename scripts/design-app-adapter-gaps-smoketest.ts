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

// ── Tier-3 operation coverage: PS layer effects/CRUD, ID styles/pages ──────
const psEffectsTask = 'Open this Photoshop PSD, add a drop shadow and stroke layer style to the logo, then duplicate and merge the background layers.';
const psEffectsGap = buildDesignAppAdapterGapPlan(psEffectsTask);
assert.equal(psEffectsGap?.appId, 'adobe_photoshop');
const layerEffectsGap = psEffectsGap?.gaps.find((gap) => gap.operation === 'apply_layer_effects');
assert(layerEffectsGap?.missingBridgeTools.includes('desktop.photoshop_apply_layer_effects'), 'PS layer effects → adapter gap');
assert(layerEffectsGap?.requiredBridgeToolsBeforeRetry.includes('desktop.photoshop_layer_inventory'));
assert(layerEffectsGap?.controlSurface.includes('batchPlay'));
const manageLayersGap = psEffectsGap?.gaps.find((gap) => gap.operation === 'manage_layers');
assert(manageLayersGap?.missingBridgeTools.includes('desktop.photoshop_manage_layers'), 'PS layer CRUD → adapter gap');
assert(psEffectsGap?.sourceRefs.some((ref) => ref.url.includes('/batchplay/')));

const idStylePagesTask = 'Open this InDesign file, apply the Heading paragraph style to the title, and add two pages with master B applied.';
const idStylePagesGap = buildDesignAppAdapterGapPlan(idStylePagesTask);
assert.equal(idStylePagesGap?.appId, 'adobe_indesign');
const textStyleGap = idStylePagesGap?.gaps.find((gap) => gap.operation === 'apply_text_style');
assert(textStyleGap?.missingBridgeTools.includes('desktop.indesign_apply_text_style'), 'ID text style → adapter gap');
assert(textStyleGap?.requiredBridgeToolsBeforeRetry.includes('desktop.indesign_text_inventory'));
assert(textStyleGap?.failClosedRules.some((item) => item.includes('blind coordinates')));
assert(textStyleGap?.requiredEvidence.some((item) => item.includes('overset')));
const managePagesGap = idStylePagesGap?.gaps.find((gap) => gap.operation === 'manage_pages');
assert(managePagesGap?.missingBridgeTools.includes('desktop.indesign_manage_pages'), 'ID page management → adapter gap');
assert(managePagesGap?.requiredEvidence.some((item) => item.includes('master')));

// Runbooks wire the new gaps and treat destructive structural ops as high-risk.
const idStyleRunbooks = buildDesignAppOperationRunbookPlan(idStylePagesTask);
const pagesRunbook = idStyleRunbooks?.runbooks.find((r) => r.operation === 'manage_pages');
assert.equal(pagesRunbook?.risk, 'high');
assert(pagesRunbook?.adapterGap?.adapterId === managePagesGap?.adapterId, 'manage_pages runbook wires its gap contract');
const effectsRunbooks = buildDesignAppOperationRunbookPlan(psEffectsTask);
assert.equal(effectsRunbooks?.runbooks.find((r) => r.operation === 'manage_layers')?.risk, 'high');
assert(effectsRunbooks?.runbooks.some((r) => r.operation === 'apply_layer_effects'));

// ── Tier-3 batch 2: PS transform/color-mode, ID tables/font resolution ─────
const psTransformTask = 'Open this Photoshop PSD and rotate the logo layer 90 degrees, then flip it horizontally.';
const transformGap = buildDesignAppAdapterGapPlan(psTransformTask)?.gaps.find((gap) => gap.operation === 'transform_layer');
assert(transformGap?.missingBridgeTools.includes('desktop.photoshop_transform_layer'), 'PS transform → adapter gap');
assert(transformGap?.controlSurface.includes('batchPlay'));
assert(transformGap?.requiredBridgeToolsBeforeRetry.includes('desktop.photoshop_layer_inventory'));
assert.equal(buildDesignAppOperationRunbookPlan(psTransformTask)?.runbooks.find((r) => r.operation === 'transform_layer')?.risk, 'high');

const psColorTask = 'Open this PSD and convert it to CMYK color mode for print.';
const colorModeGap = buildDesignAppAdapterGapPlan(psColorTask)?.gaps.find((gap) => gap.operation === 'convert_color_mode');
assert(colorModeGap?.missingBridgeTools.includes('desktop.photoshop_convert_color_mode'), 'PS color-mode → adapter gap');
assert(colorModeGap?.requiredEvidence.some((item) => item.includes('color mode/profile')));
assert.equal(buildDesignAppOperationRunbookPlan(psColorTask)?.runbooks.find((r) => r.operation === 'convert_color_mode')?.risk, 'high');

const idTableTask = 'Open this InDesign file and create a 4x3 pricing table, then merge the header cells.';
const tablesGap = buildDesignAppAdapterGapPlan(idTableTask)?.gaps.find((gap) => gap.operation === 'manage_tables');
assert(tablesGap?.missingBridgeTools.includes('desktop.indesign_manage_tables'), 'ID tables → adapter gap');
assert(tablesGap?.requiredEvidence.some((item) => item.includes('table')));
assert(tablesGap?.failClosedRules.some((item) => item.includes('blind coordinates')));
assert.equal(buildDesignAppOperationRunbookPlan(idTableTask)?.runbooks.find((r) => r.operation === 'manage_tables')?.risk, 'high');

const idFontTask = 'Open this InDesign file and activate the missing Adobe fonts before exporting a proof.';
const fontsGap = buildDesignAppAdapterGapPlan(idFontTask)?.gaps.find((gap) => gap.operation === 'resolve_fonts');
assert(fontsGap?.missingBridgeTools.includes('desktop.indesign_resolve_fonts'), 'ID font resolution → adapter gap');
assert(fontsGap?.requiredEvidence.some((item) => item.includes('font')));
assert(fontsGap?.requiredBridgeToolsBeforeRetry.includes('desktop.indesign_text_inventory'));
// Font activation/substitution is recoverable → review, not high.
assert.equal(buildDesignAppOperationRunbookPlan(idFontTask)?.runbooks.find((r) => r.operation === 'resolve_fonts')?.risk, 'review');

// ── Tier-3 batch 3: PS artboards, ID hyperlinks/cross-refs, ID TOC/index ───
const psArtboardTask = 'Open this Photoshop PSD and create three new artboards for Instagram story, post, and reel sizes.';
const artboardGap = buildDesignAppAdapterGapPlan(psArtboardTask)?.gaps.find((gap) => gap.operation === 'manage_artboards');
assert(artboardGap?.missingBridgeTools.includes('desktop.photoshop_manage_artboards'), 'PS artboards → adapter gap');
assert(artboardGap?.controlSurface.includes('batchPlay'));
assert.equal(buildDesignAppOperationRunbookPlan(psArtboardTask)?.runbooks.find((r) => r.operation === 'manage_artboards')?.risk, 'high');

const idLinkTask = 'Open this InDesign file and add hyperlinks to all the URLs and a cross-reference to the appendix.';
const hyperlinkGap = buildDesignAppAdapterGapPlan(idLinkTask)?.gaps.find((gap) => gap.operation === 'manage_hyperlinks');
assert(hyperlinkGap?.missingBridgeTools.includes('desktop.indesign_manage_hyperlinks'), 'ID hyperlinks → adapter gap');
assert(hyperlinkGap?.requiredBridgeToolsBeforeRetry.includes('desktop.indesign_text_inventory'));
assert(hyperlinkGap?.failClosedRules.some((item) => item.includes('blind coordinates')));
assert.equal(buildDesignAppOperationRunbookPlan(idLinkTask)?.runbooks.find((r) => r.operation === 'manage_hyperlinks')?.risk, 'review');

const idTocTask = 'Open this InDesign book file and generate a table of contents from the heading styles.';
const tocGap = buildDesignAppAdapterGapPlan(idTocTask)?.gaps.find((gap) => gap.operation === 'build_toc');
assert(tocGap?.missingBridgeTools.includes('desktop.indesign_build_toc'), 'ID TOC → adapter gap');
assert(tocGap?.requiredEvidence.some((item) => item.includes('TOC')));
assert.equal(buildDesignAppOperationRunbookPlan(idTocTask)?.runbooks.find((r) => r.operation === 'build_toc')?.risk, 'review');

// ── Tier-3 batch 4: ID text flow/overset, PS smart objects, ID swatches ────
const idFlowTask = 'Open this InDesign file and thread the overflowing text into a new frame to fix the overset.';
const flowGap = buildDesignAppAdapterGapPlan(idFlowTask)?.gaps.find((gap) => gap.operation === 'manage_text_flow');
assert(flowGap?.missingBridgeTools.includes('desktop.indesign_manage_text_flow'), 'ID text flow → adapter gap');
assert(flowGap?.requiredBridgeToolsBeforeRetry.includes('desktop.indesign_text_inventory'));
assert(flowGap?.failClosedRules.some((item) => item.includes('blind coordinates')));
assert.equal(buildDesignAppOperationRunbookPlan(idFlowTask)?.runbooks.find((r) => r.operation === 'manage_text_flow')?.risk, 'review');

const psSmartTask = 'Open this Photoshop PSD and convert the logo layer to a smart object, then edit the smart object contents.';
const smartGap = buildDesignAppAdapterGapPlan(psSmartTask)?.gaps.find((gap) => gap.operation === 'manage_smart_objects');
assert(smartGap?.missingBridgeTools.includes('desktop.photoshop_manage_smart_objects'), 'PS smart objects → adapter gap');
assert(smartGap?.controlSurface.includes('batchPlay'));
assert.equal(buildDesignAppOperationRunbookPlan(psSmartTask)?.runbooks.find((r) => r.operation === 'manage_smart_objects')?.risk, 'high');
// Smart-object detection must NOT fire on "place X smart object" (replace_linked_asset's job).
assert(!buildDesignAppAdapterGapPlan('Open this Photoshop PSD and place the new logo smart object.')?.gaps.some((gap) => gap.operation === 'manage_smart_objects'), 'placing a smart object is not smart-object management');

const idSwatchTask = 'Open this InDesign file and convert all the swatches to CMYK spot colors for the Pantone press run.';
const swatchGap = buildDesignAppAdapterGapPlan(idSwatchTask)?.gaps.find((gap) => gap.operation === 'manage_swatches');
assert(swatchGap?.missingBridgeTools.includes('desktop.indesign_manage_swatches'), 'ID swatches → adapter gap');
assert(swatchGap?.requiredEvidence.some((item) => item.includes('swatch')));
assert.equal(buildDesignAppOperationRunbookPlan(idSwatchTask)?.runbooks.find((r) => r.operation === 'manage_swatches')?.risk, 'review');

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
