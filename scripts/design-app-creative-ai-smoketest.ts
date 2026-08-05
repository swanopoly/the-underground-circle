/**
 * design-app-creative-ai-smoketest
 *
 * Verifies that Photoshop/InDesign creative-AI requests get capability plans,
 * adapter gaps, runbooks, and compact chat handoff metadata.
 *
 * Run: npm run smoke:design-app-creative-ai
 */

import assert from 'node:assert/strict';

import { buildAgentAppCapabilityBuildoutPolicy } from '../src/lib/agentAppCapabilityBuildout';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import { buildChatDesignTaskCardModel } from '../src/lib/chatDesignTaskCard';
import { buildDesignAppAutomationPlan, buildDesignAppAutomationPromptBlock } from '../src/lib/designAppAutomation';
import {
  buildDesignAppCreativeAiPlan,
  buildDesignAppCreativeAiPromptBlock,
  buildDesignAppCreativeAiRecipePlan,
  buildDesignAppCreativeAiRecipePromptBlock,
} from '../src/lib/designAppCreativeAi';
import { buildDesignAppAdapterGapPlan } from '../src/lib/designAppAdapterGaps';
import { buildDesignAppOperationRunbookPlan } from '../src/lib/designAppOperationRunbooks';
import { getBestUserTaskPipeline } from '../src/lib/userTaskPipelines';

const photoshopTask = 'Open this Photoshop PSD, use Firefly to generate four background options for the hero image, place the best one as a smart object, and export a PNG proof.';
const photoshopCreative = buildDesignAppCreativeAiPlan(photoshopTask);
const photoshopRecipes = buildDesignAppCreativeAiRecipePlan(photoshopTask);
const photoshopAutomation = buildDesignAppAutomationPlan(photoshopTask);
const photoshopGaps = buildDesignAppAdapterGapPlan(photoshopTask);
const photoshopRunbooks = buildDesignAppOperationRunbookPlan(photoshopTask);

assert.equal(photoshopCreative?.appId, 'adobe_photoshop');
assert(photoshopCreative?.capabilities.some((capability) => capability.id === 'photoshop.text_to_image_asset'));
assert(photoshopCreative?.capabilities.some((capability) => capability.id === 'photoshop.creative_variations'));
assert(photoshopCreative?.recommendedTools.includes('agent.build_app_capability'));
assert(photoshopCreative?.sourceRefs.some((ref) => ref.url.includes('/firefly-services/docs/firefly-api/')));
assert(photoshopRecipes?.recipes.some((recipe) => recipe.id === 'photoshop.background_asset_pack'));
assert(photoshopRecipes?.recipes.some((recipe) => recipe.id === 'photoshop.creative_variant_contact_sheet'));
assert(photoshopRecipes?.buildoutTools.includes('desktop.firefly_generate_image_asset'));
assert(photoshopRecipes?.userVisibleOptions.some((option) => /Generate an AI background/i.test(option)));
assert(photoshopAutomation?.operations.includes('generate_ai_asset'));
assert(photoshopAutomation?.operations.includes('create_creative_variants'));
assert(!photoshopAutomation?.operations.includes('generative_fill_or_remove'), 'plain Firefly generation is not misclassified as localized generative fill');
assert(photoshopAutomation?.creativeAiCapabilities?.includes('photoshop.text_to_image_asset'));
assert(photoshopAutomation?.recommendedTools.includes('agent.build_app_capability'));
assert(photoshopGaps?.gaps.some((gap) => gap.missingBridgeTools.includes('desktop.firefly_generate_image_asset')));
assert(photoshopGaps?.gaps.some((gap) => gap.missingBridgeTools.includes('desktop.firefly_batch_generate_variants')));
assert(photoshopRunbooks?.runbooks.some((runbook) => runbook.operation === 'generate_ai_asset' && runbook.steps.some((step) => String(step.tool).includes('agent.build_app_capability'))));

const photoshopPrompt = [
  buildDesignAppAutomationPromptBlock(photoshopTask),
  buildDesignAppCreativeAiPromptBlock(photoshopTask),
  buildDesignAppCreativeAiRecipePromptBlock(photoshopTask),
].filter(Boolean).join('\n');
assert(photoshopPrompt.includes('Design App Creative AI Plan'));
assert(photoshopPrompt.includes('Design App Creative AI Recipes'));
assert(photoshopPrompt.includes('Creative AI capabilities'));
assert(photoshopPrompt.includes('Buildout tool: desktop.firefly_generate_image_asset'));
assert(photoshopPrompt.includes('Firefly'));
assert(photoshopPrompt.includes('agent.build_app_capability'));
assert(!photoshopPrompt.includes('/Users/'), 'creative AI prompt does not leak local paths');

// ── HUNT invariant pin: creative-AI plan/prompt echoes taxonomy only — never a
// concrete local path, private folder, file name, or secret-shaped token.
{
  const sensitiveTask = 'In Photoshop open /Users/chris/Clients/acmeCorp/hero.psd and use Firefly to generate four background variations (api_key sk-ant-secret-TOKEN-123), then export a PNG proof.';
  const sensitivePlanBlock = buildDesignAppCreativeAiPromptBlock(sensitiveTask) || '';
  const sensitiveRecipeBlock = buildDesignAppCreativeAiRecipePromptBlock(sensitiveTask) || '';
  const sensitivePlanJson = JSON.stringify(buildDesignAppCreativeAiPlan(sensitiveTask) || {});
  for (const [label, haystack] of [
    ['plan prompt', sensitivePlanBlock],
    ['recipe prompt', sensitiveRecipeBlock],
    ['plan metadata', sensitivePlanJson],
  ] as const) {
    assert(!haystack.includes('/Users/'), `secret hygiene: creative-AI ${label} does not echo the local path`);
    assert(!haystack.includes('acmeCorp'), `secret hygiene: creative-AI ${label} does not echo the private folder`);
    assert(!haystack.includes('hero.psd'), `secret hygiene: creative-AI ${label} does not echo the file name`);
    assert(!haystack.includes('sk-ant-'), `secret hygiene: creative-AI ${label} does not echo the secret-shaped token`);
    assert(!/api_key/i.test(haystack), `secret hygiene: creative-AI ${label} does not echo credential wording`);
  }
}

const indesignTextToImageTask = 'Open this InDesign banner and use Text to Image to generate a futuristic city hero image for the empty frame, then export a proof PDF.';
const indesignCreative = buildDesignAppCreativeAiPlan(indesignTextToImageTask);
const indesignRecipes = buildDesignAppCreativeAiRecipePlan(indesignTextToImageTask);
const indesignAutomation = buildDesignAppAutomationPlan(indesignTextToImageTask);
const indesignGaps = buildDesignAppAdapterGapPlan(indesignTextToImageTask);

assert.equal(indesignCreative?.appId, 'adobe_indesign');
assert(indesignCreative?.capabilities.some((capability) => capability.id === 'indesign.text_to_image_frame'));
assert(indesignCreative?.sourceRefs.some((ref) => ref.url.includes('/indesign-apis/')));
assert(indesignRecipes?.recipes.some((recipe) => recipe.id === 'indesign.hero_image_frame'));
assert(indesignRecipes?.recoveryHints.some((hint) => /target frame/i.test(hint)));
assert(indesignAutomation?.operations.includes('generate_ai_asset'));
assert(indesignAutomation?.operations.includes('export_proof'));
assert(indesignGaps?.gaps.some((gap) => gap.missingBridgeTools.includes('desktop.indesign_generate_image_for_frame')));

const dataMergeTask = 'Open this InDesign campaign template and CSV, create 20 personalized banner variants with data merge, and export sample proof PDFs.';
const dataMergeCreative = buildDesignAppCreativeAiPlan(dataMergeTask);
const dataMergeRecipes = buildDesignAppCreativeAiRecipePlan(dataMergeTask);
const dataMergeRunbooks = buildDesignAppOperationRunbookPlan(dataMergeTask);
const dataMergeGap = buildDesignAppAdapterGapPlan(dataMergeTask);

assert(dataMergeCreative?.capabilities.some((capability) => capability.id === 'indesign.data_merge_variants'));
assert(dataMergeRecipes?.recipes.some((recipe) => recipe.id === 'indesign.data_merge_campaign_variants'));
assert(dataMergeGap?.gaps.some((gap) => gap.missingBridgeTools.includes('desktop.indesign_data_merge_variants')));
assert(dataMergeRunbooks?.runbooks.some((runbook) => runbook.operation === 'create_creative_variants' && runbook.requiredInputs.some((input) => input.includes('CSV'))));

const handoff = buildChatComputerHandoffContext({
  task: photoshopTask,
  adapterId: 'app_adapter',
  taskKind: 'app_task',
});
assert(handoff.metadata.designCreativeAi?.capabilities.some((capability) => capability.id === 'photoshop.text_to_image_asset'));
assert(handoff.metadata.designCreativeAi?.recipes.some((recipe) => recipe.id === 'photoshop.background_asset_pack'));
assert(handoff.metadata.designCreativeAi?.userVisibleOptions.some((option) => /Generate an AI background/i.test(option)));
assert(handoff.metadata.designCreativeAi?.buildoutTools.includes('desktop.firefly_generate_image_asset'));
assert(handoff.metadata.designAppTask?.creativeAiCapabilities?.includes('photoshop.creative_variations'));
assert(handoff.touched.includes('surface:design_app'));
assert(!JSON.stringify(handoff.metadata.designCreativeAi).includes('/Users/'), 'creative AI handoff metadata hides local paths');
const handoffCard = buildChatDesignTaskCardModel(handoff.metadata);
assert(handoffCard?.creativeAiSummary?.includes('Generated background'), 'design task card summarizes creative-AI recipe quietly');

const buildoutPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: photoshopTask,
  appName: 'Adobe Photoshop',
  capabilityGap: 'No Firefly-to-Photoshop placement adapter exists for generated background options.',
});
assert(buildoutPolicy.prompt.includes('Design App Creative AI Recipes'));
assert(buildoutPolicy.prompt.includes('desktop.firefly_generate_image_asset'));
assert(buildoutPolicy.researchChecklist.some((item) => item.includes('Satisfy creative-AI recipe buildout tool')));
assert(buildoutPolicy.verification.some((item) => item.includes('creative-AI recipe')));

const pipeline = getBestUserTaskPipeline(indesignTextToImageTask, { includeFallback: false });
assert.equal(pipeline?.pipeline.id, 'creative_layout_design');

console.log('All design-app creative AI smoke cases passed.');
