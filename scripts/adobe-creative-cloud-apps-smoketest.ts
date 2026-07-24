/**
 * adobe-creative-cloud-apps-smoketest — verifies that broad Adobe CC app
 * tasks route to an app-profile-aware desktop strategy without stealing the
 * dedicated InDesign/Photoshop paths or generic PDF/document tasks.
 *
 * Run: npm run smoke:adobe-creative-cloud-apps
 */

import assert from 'node:assert/strict';

import {
  buildAdobeCreativeCloudAutomationPlan,
  findAdobeCreativeCloudAppProfile,
  getAdobeCreativeCloudAppProfiles,
  isAdobeCreativeCloudTask,
} from '../src/lib/adobeCreativeCloudApps';
import { buildComputerAppTaskStrategy } from '../src/lib/computerAppTaskStrategy';
import { buildOpenSwanTaskPlan } from '../src/lib/openswanTaskPlanner';
import {
  buildUserTaskPipelinePromptBlock,
  getBestUserTaskPipeline,
} from '../src/lib/userTaskPipelines';

const profiles = getAdobeCreativeCloudAppProfiles();
const appNames = new Set(profiles.map((profile) => profile.appName));

assert(profiles.length >= 24, `expected broad Adobe profile coverage, saw ${profiles.length}`);
for (const name of [
  'Adobe InDesign',
  'Adobe Photoshop',
  'Adobe Photoshop Express',
  'Adobe Illustrator',
  'Adobe Premiere Pro',
  'Adobe After Effects',
  'Adobe Acrobat',
  'Adobe Acrobat Reader',
  'Adobe Lightroom Classic',
  'Adobe Audition',
  'Adobe Animate',
  'Adobe Media Encoder',
  'Adobe Bridge',
  'Adobe Capture',
  'Adobe Dreamweaver',
  'Adobe InCopy',
  'Adobe Character Animator',
  'Frame.io',
  'Adobe Express',
  'Adobe Firefly',
  'Adobe Fresco',
  'Adobe Scan',
  'Adobe Fill & Sign',
  'Adobe Substance 3D',
]) {
  assert(appNames.has(name), `missing Adobe profile for ${name}`);
}

assert.equal(findAdobeCreativeCloudAppProfile('Open Illustrator and export this logo as SVG')?.id, 'adobe_illustrator');
assert.equal(findAdobeCreativeCloudAppProfile('Render this After Effects comp to mp4')?.id, 'adobe_after_effects');
assert.equal(findAdobeCreativeCloudAppProfile('Use Adobe Bridge to batch rename this folder')?.id, 'adobe_bridge');
assert.equal(findAdobeCreativeCloudAppProfile('Please scan this contract.pdf'), null);
assert.equal(findAdobeCreativeCloudAppProfile('The desktop bridge is unreachable'), null);
assert(isAdobeCreativeCloudTask('Use Adobe Audition to clean this podcast audio'));

const illustratorPlan = buildAdobeCreativeCloudAutomationPlan('Open Illustrator and update this logo then export SVG');
assert.equal(illustratorPlan?.profile.id, 'adobe_illustrator');
assert(illustratorPlan?.recommendedTools.includes('agent.build_app_capability'));
assert(illustratorPlan?.approvalCheckpoints.includes('export deliverable'));
// Illustrator profile plan surfaces the shipped deterministic ExtendScript ops
// so a routed vector request is steered to the exact op, not blind UI control.
for (const tool of [
  'desktop.illustrator_vectorize',
  'desktop.illustrator_set_appearance',
  'desktop.illustrator_align',
  'desktop.illustrator_arrange',
  'desktop.illustrator_group',
  'desktop.illustrator_add_artboard',
  'desktop.illustrator_add_text',
  'desktop.illustrator_add_shape',
]) {
  assert(illustratorPlan?.recommendedTools.includes(tool), `illustrator profile plan surfaces ${tool}`);
}

// Photoshop profile plan surfaces the 3 shipped Photoshop ExtendScript ops.
const photoshopProfilePlan = buildAdobeCreativeCloudAutomationPlan('Open Adobe Photoshop and edit this psd file');
assert.equal(photoshopProfilePlan?.profile.id, 'adobe_photoshop');
for (const tool of [
  'desktop.photoshop_create_text_layer',
  'desktop.photoshop_set_layer_appearance',
  'desktop.photoshop_add_fill_layer',
]) {
  assert(photoshopProfilePlan?.recommendedTools.includes(tool), `photoshop profile plan surfaces ${tool}`);
}

const illustratorStrategy = buildComputerAppTaskStrategy('Open Illustrator and update this logo then export SVG');
assert.equal(illustratorStrategy?.id, 'adobe_cc_control');
assert(illustratorStrategy?.label.includes('Illustrator'));
assert(illustratorStrategy?.recommendedTools.includes('agent.build_app_capability'));
assert.equal(illustratorStrategy?.maxBlindActions, 0);

assert.equal(
  buildComputerAppTaskStrategy('Open Photoshop and crop this image after I approve desktop control')?.id,
  'creative_layout_control',
);
assert.equal(
  buildComputerAppTaskStrategy('Open this InDesign banner package and export a proof PDF')?.id,
  'creative_layout_control',
);

const aePlan = buildOpenSwanTaskPlan('Open After Effects and render the active comp to mp4', 'senior' as any);
const aeTools = aePlan.recommendedTools.map((item) => item.tool);
assert(aeTools.includes('agent.build_app_capability'));
assert(aeTools.includes('desktop.screenshot'));
assert(aeTools.includes('approvals.request'));
assert.equal(aePlan.computerAppStrategy?.id, 'adobe_cc_control');

assert.equal(
  getBestUserTaskPipeline('Open Illustrator and update this logo then export SVG', { includeFallback: false })?.pipeline.id,
  'adobe_creative_cloud',
);
assert.notEqual(
  getBestUserTaskPipeline('Extract the signed date from contract.pdf', { includeFallback: false })?.pipeline.id,
  'adobe_creative_cloud',
);

const prompt = buildUserTaskPipelinePromptBlock('Open Premiere Pro and export this sequence after approval') || '';
assert(prompt.includes('Adobe Creative Cloud App Automation'));
assert(prompt.includes('agent.build_app_capability'));

console.log('All Adobe Creative Cloud app smoke cases passed.');
