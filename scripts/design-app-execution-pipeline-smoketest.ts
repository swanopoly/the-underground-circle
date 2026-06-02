/**
 * design-app-execution-pipeline-smoketest
 *
 * Verifies that Photoshop/InDesign automation requests are converted into one
 * ordered execution pipeline that chat, OpenSwan, recovery, and connected
 * agents can share.
 *
 * Run: npm run smoke:design-app-execution-pipeline
 */

import assert from 'node:assert/strict';

import { buildAgentAppCapabilityBuildoutPolicy } from '../src/lib/agentAppCapabilityBuildout';
import { buildChatComputerHandoffContext } from '../src/lib/chatComputerHandoffContext';
import { buildChatDesignTaskCardModel } from '../src/lib/chatDesignTaskCard';
import {
  buildDesignAppExecutionPipelinePlan,
  buildDesignAppExecutionPipelinePromptBlock,
} from '../src/lib/designAppExecutionPipeline';
import {
  formatPersistedChatBotMessage,
  readPersistedChatBotMetadata,
} from '../src/lib/persistedChatMetadata';

const indesignTask = 'Open this InDesign package, update the headline layer, relink the hero image, export a proof PDF, and package it for handoff.';
const indesignPipeline = buildDesignAppExecutionPipelinePlan(indesignTask);

assert.equal(indesignPipeline?.appId, 'adobe_indesign');
assert(indesignPipeline?.phases.some((phase) => phase.id === 'resolve_source_package'));
assert(indesignPipeline?.phases.some((phase) => phase.id === 'observe_document_inventory'));
assert(indesignPipeline?.phases.some((phase) => phase.id === 'request_design_approval' && phase.approvalRequired));
assert(indesignPipeline?.phases.some((phase) => phase.id === 'execute_design_mutations' && phase.tools.includes('desktop.indesign_relink_asset')));
assert(indesignPipeline?.phases.some((phase) => phase.id === 'export_or_package_outputs' && phase.tools.includes('desktop.indesign_package_document')));
assert(indesignPipeline?.phases.some((phase) => phase.id === 'verify_design_output' && phase.tools.includes('desktop.indesign_export_proof')));
assert(indesignPipeline?.requiredToolSequence.includes('desktop.indesign_document_status'));
assert(indesignPipeline?.requiredToolSequence.includes('desktop.indesign_text_inventory'));
assert(indesignPipeline?.approvalTools.includes('approvals.request'));
assert.match(indesignPipeline?.nextVisibleAction || '', /Approve Adobe InDesign/i);

const photoshopTask = 'Open this Photoshop PSD, use Firefly to generate four background options, place the selected one as a smart object, remove the old background with generative fill, and export a PNG proof.';
const photoshopPipeline = buildDesignAppExecutionPipelinePlan(photoshopTask);

assert.equal(photoshopPipeline?.appId, 'adobe_photoshop');
assert(photoshopPipeline?.creativeAiRecipeIds.includes('photoshop.background_asset_pack'));
assert(photoshopPipeline?.creativeAiRecipeIds.includes('photoshop.localized_cleanup'));
assert(photoshopPipeline?.buildoutTools.includes('desktop.firefly_generate_image_asset'));
assert(photoshopPipeline?.phases.some((phase) => phase.id === 'prepare_creative_ai_brief' && phase.userVisibleWhen === 'approval'));
assert(photoshopPipeline?.phases.some((phase) => phase.id === 'recover_or_build_adapter' && phase.tools.includes('agent.build_app_capability')));
assert(photoshopPipeline?.proofTools.includes('desktop.photoshop_export_proof'));
assert(photoshopPipeline?.failClosedRules.some((rule) => /approval|selection|proof/i.test(rule)));

const photoshopPrompt = buildDesignAppExecutionPipelinePromptBlock(photoshopTask) || '';
assert(photoshopPrompt.includes('Design App Execution Pipeline'));
assert(photoshopPrompt.includes('Required tool sequence'));
assert(photoshopPrompt.includes('Creative AI recipes'));
assert(photoshopPrompt.includes('Do not skip phases'));
assert(!photoshopPrompt.includes('/Users/'), 'pipeline prompt does not leak local paths');

const handoff = buildChatComputerHandoffContext({
  task: photoshopTask,
  adapterId: 'app_adapter',
  taskKind: 'app_task',
});
assert(handoff.metadata.designExecutionPipeline?.phases.some((phase) => phase.id === 'prepare_creative_ai_brief'));
assert(handoff.metadata.designExecutionPipeline?.buildoutTools.includes('desktop.firefly_generate_image_asset'));
assert(handoff.chatLines.some((line) => line.includes('Design pipeline')));
assert(!JSON.stringify(handoff.metadata.designExecutionPipeline).includes('/Users/'), 'pipeline handoff metadata hides local paths');

const designCard = buildChatDesignTaskCardModel(handoff.metadata);
assert(designCard?.nextAction.includes('Approve Adobe Photoshop'), 'design task card can use pipeline next action');

const persistedMessage = formatPersistedChatBotMessage('OpenSwan', 'Photoshop task is staged.', {
  computerHandoff: handoff.metadata,
});
const persisted = readPersistedChatBotMetadata(persistedMessage);
assert(persisted?.computerHandoff?.designExecutionPipeline?.phases.some((phase) => phase.id === 'prepare_creative_ai_brief'), 'persisted metadata keeps compact execution pipeline');
assert(persisted?.computerHandoff?.designExecutionPipeline?.buildoutTools.includes('desktop.firefly_generate_image_asset'), 'persisted metadata keeps compact pipeline buildout tool');
assert(persisted?.computerHandoff?.designCreativeAi?.recipes.some((recipe) => recipe.id === 'photoshop.background_asset_pack'), 'persisted metadata keeps compact creative-AI recipe');
assert((persisted?.computerHandoff?.designAdapterGaps?.length || 0) > 0, 'persisted metadata keeps compact adapter-gap contract');
assert(!JSON.stringify(persisted?.computerHandoff || {}).includes('/Users/'), 'persisted design pipeline hides local paths');

const buildoutPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: photoshopTask,
  appName: 'Adobe Photoshop',
  capabilityGap: 'Need Firefly generation and Photoshop placement adapters.',
});
assert(buildoutPolicy.prompt.includes('Design App Execution Pipeline'));
assert(buildoutPolicy.researchChecklist.some((item) => item.includes('Preserve design execution pipeline tool order')));

console.log('All design app execution pipeline smoke cases passed.');
