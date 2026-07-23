/**
 * design-app-automation-smoketest
 *
 * Locks the chat foundation for layered InDesign and Photoshop creative work.
 *
 * Run: npm run smoke:design-app-automation
 */
import {
  buildDesignAppAutomationPlan,
  buildDesignAppAutomationPromptBlock,
  shouldUseDesignAppAutomation,
} from '../src/lib/designAppAutomation';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message); else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

const request = 'Open this InDesign file and make changes for a marketing banner with different layers: update the headline, replace the image asset, and export a proof PDF.';
const plan = buildDesignAppAutomationPlan(request);

assert(shouldUseDesignAppAutomation(request), 'detects layered InDesign banner automation');
assert(plan?.appId === 'adobe_indesign', 'selects Adobe InDesign');
assert(plan?.taskKind === 'marketing_banner_layout', 'classifies marketing banner layout');
assert(plan?.operations.includes('inspect_layers'), 'requires layer inspection');
assert(plan?.operations.includes('update_text_layers'), 'detects text-layer updates');
assert(plan?.operations.includes('replace_linked_asset'), 'detects linked asset replacement');
assert(plan?.operations.includes('export_proof'), 'detects proof export');
assert(plan?.recommendedTools.includes('desktop.indesign_document_status'), 'recommends document status tool');
assert(plan?.recommendedTools.includes('desktop.indesign_text_inventory'), 'recommends text inventory tool');
assert(plan?.recommendedTools.includes('desktop.indesign_set_layer_state'), 'recommends InDesign layer-state tool');
assert(plan?.recommendedTools.includes('desktop.indesign_relink_asset'), 'recommends InDesign asset relink tool');
assert(plan?.recommendedTools.includes('desktop.indesign_package_document'), 'recommends InDesign package handoff tool');
assert(plan?.recommendedTools.includes('desktop.indesign_export_proof'), 'recommends InDesign proof export tool');
assert(plan?.approvalGates.some((gate) => gate.includes('saving')), 'gates save/export style mutations');
assert(plan?.verificationSignals.some((signal) => signal.includes('post-change InDesign text inventory')), 'requires post-change inventory verification');

const promptBlock = buildDesignAppAutomationPromptBlock(request) || '';
assert(promptBlock.includes('Design App Automation Plan'), 'prompt block is emitted');
assert(promptBlock.includes('desktop.indesign_set_layer_state'), 'prompt block names layer-state tool');
assert(promptBlock.includes('desktop.indesign_batch_update_text_layers'), 'prompt block names batch text-layer tool');
assert(promptBlock.includes('desktop.indesign_relink_asset'), 'prompt block names asset relink tool');
assert(promptBlock.includes('desktop.indesign_package_document'), 'prompt block names package handoff tool');
assert(promptBlock.includes('desktop.indesign_export_proof'), 'prompt block names proof export tool');
assert(promptBlock.includes('missing fonts or links'), 'prompt block preserves production blockers');

const photoshopRequest = 'Open this Photoshop PSD, remove the background with generative fill, adjust the color, add the new logo asset, and export a PNG proof.';
const photoshopPlan = buildDesignAppAutomationPlan(photoshopRequest);
assert(shouldUseDesignAppAutomation(photoshopRequest), 'detects layered Photoshop creative automation');
assert(photoshopPlan?.appId === 'adobe_photoshop', 'selects Adobe Photoshop');
assert(photoshopPlan?.taskKind === 'raster_image_edit', 'classifies Photoshop raster image edit');
assert(photoshopPlan?.operations.includes('inspect_image_document'), 'requires Photoshop document inspection');
assert(photoshopPlan?.operations.includes('generative_fill_or_remove'), 'detects generative/content-aware edit');
assert(photoshopPlan?.operations.includes('edit_adjustment_layers'), 'detects adjustment-layer edit');
assert(photoshopPlan?.operations.includes('replace_linked_asset'), 'detects placed asset replacement');
assert(photoshopPlan?.operations.includes('export_raster_proof'), 'detects raster proof export');
assert(photoshopPlan?.recommendedTools.includes('desktop.photoshop_document_status'), 'recommends Photoshop document status tool');
assert(photoshopPlan?.recommendedTools.includes('desktop.photoshop_layer_inventory'), 'recommends Photoshop layer inventory tool');
assert(photoshopPlan?.recommendedTools.includes('desktop.photoshop_set_layer_state'), 'recommends Photoshop layer-state tool');
assert(photoshopPlan?.approvalGates.some((gate) => gate.includes('generative fill')), 'gates generative Photoshop edits');
assert(photoshopPlan?.recoveryRules.some((rule) => rule.includes('selection/mask')), 'requires selection or mask recovery for localized Photoshop edits');

const photoshopPromptBlock = buildDesignAppAutomationPromptBlock(photoshopRequest) || '';
assert(photoshopPromptBlock.includes('Adobe Photoshop'), 'Photoshop prompt block is emitted');
assert(photoshopPromptBlock.includes('desktop.photoshop_layer_inventory'), 'Photoshop prompt block names layer inventory tool');
assert(photoshopPromptBlock.includes('desktop.photoshop_set_layer_state'), 'Photoshop prompt block names layer-state tool');
assert(photoshopPromptBlock.includes('fresh screenshot or raster proof'), 'Photoshop prompt block preserves visual proof requirement');

const illustratorRequest = 'Open this Illustrator file and vectorize the logo, then recolor it red.';
const illustratorPlan = buildDesignAppAutomationPlan(illustratorRequest);
assert(shouldUseDesignAppAutomation(illustratorRequest), 'detects Illustrator vector automation');
assert(illustratorPlan?.appId === 'adobe_illustrator', 'selects Adobe Illustrator');
assert(illustratorPlan?.operations.includes('vectorize'), 'detects vectorize operation');
assert(illustratorPlan?.operations.includes('set_appearance'), 'detects recolor/appearance operation');
assert(illustratorPlan?.recommendedTools.includes('desktop.illustrator_document_status'), 'recommends Illustrator document status tool');
assert(illustratorPlan?.recommendedTools.includes('desktop.illustrator_vectorize'), 'recommends Illustrator vectorize tool');
assert(illustratorPlan?.recommendedTools.includes('desktop.illustrator_export_proof'), 'recommends Illustrator export proof tool');

const unrelated = buildDesignAppAutomationPlan('Summarize unread Gmail messages');
assert(unrelated === null, 'non-design task does not get a design automation plan');

if (failures > 0) {
  console.error(`\n${failures} design-app-automation smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll design-app-automation smoke cases passed.');
