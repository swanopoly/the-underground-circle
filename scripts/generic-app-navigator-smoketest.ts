/**
 * generic-app-navigator-smoketest
 *
 * Locks the unfamiliar-app control contract: observe first, use semantic
 * controls, keep the user-facing path quiet, and delegate missing capability
 * buildout instead of guessing.
 *
 * Run: npm run smoke:generic-app-navigator
 */

import assert from 'node:assert/strict';

import {
  buildGenericAppNavigatorPlan,
  buildGenericAppNavigatorRouteContext,
  classifyGenericAppTaskFamily,
  formatGenericAppTaskFamilyForUser,
  formatGenericAppNavigatorPromptBlock,
  formatProfessionalAppAutonomyPromptBlock,
  inferGenericAppName,
  shouldUseProfessionalAppAutonomy,
  shouldUseGenericAppNavigator,
} from '../src/lib/genericAppNavigator';
import {
  buildAppAutomationControlSurfacePlan,
  buildAppAutomationControlSurfacePromptBlock,
} from '../src/lib/appAutomationControlSurfaces';
import {
  buildComputerAppTaskStrategy,
  buildComputerAppTaskStrategyPromptBlock,
} from '../src/lib/computerAppTaskStrategy';

const abletonTask = 'Use Ableton Live to create a four-bar drum loop and export it after approval';
const abletonPlan = buildGenericAppNavigatorPlan(abletonTask);
assert.equal(inferGenericAppName(abletonTask), 'Ableton Live');
assert.equal(abletonPlan.targetAppName, 'Ableton Live');
assert.equal(abletonPlan.taskFamily, 'file_open_save_export');
assert.equal(formatGenericAppTaskFamilyForUser(abletonPlan.taskFamily), 'file/save/export work');
const abletonContext = buildGenericAppNavigatorRouteContext(abletonTask);
assert.equal(abletonContext.targetAppName, 'Ableton Live');
assert.equal(abletonContext.taskFamily, 'file_open_save_export');
assert.equal(abletonContext.taskFamilyLabel, 'file/save/export work');
assert.equal(abletonPlan.canNavigateWithoutAdapter, true);
assert(abletonPlan.observeFirst.includes('desktop.read_a11y_tree to list visible controls, fields, menus, dialogs, and values'));
assert(abletonPlan.actionLadder.some((step) => step.includes('one reversible visual coordinate step only after fresh screenshot')));
assert(abletonPlan.recommendedTools.includes('desktop.click_element'));
assert(abletonPlan.recommendedTools.includes('desktop.set_element_value'));
assert(abletonPlan.recommendedTools.includes('agent.build_app_capability'));
assert(abletonPlan.buildoutTriggers.some((trigger) => trigger.includes('app-specific save/export/render')));
assert(abletonPlan.sourceRefs.some((ref) => ref.url.includes('developer.apple.com')));
assert(abletonPlan.sourceRefs.some((ref) => ref.url.includes('learn.microsoft.com')));
assert(abletonPlan.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/locators')));

const fieldTask = 'Open UnknownApp and put hello in the Project Name field';
const fieldPlan = buildGenericAppNavigatorPlan(fieldTask);
assert.equal(inferGenericAppName(fieldTask), 'UnknownApp');
assert.equal(classifyGenericAppTaskFamily(fieldTask), 'field_or_form_entry');
assert.equal(fieldPlan.taskFamily, 'field_or_form_entry');
assert(fieldPlan.recommendedTools.includes('desktop.set_element_value'));

const blenderTask = 'Use Blender to render a smoke simulation and export MP4';
const blenderPlan = buildGenericAppNavigatorPlan(blenderTask);
assert.equal(inferGenericAppName(blenderTask), 'Blender');
assert(blenderPlan.buildoutTriggers.some((trigger) => trigger.includes('app-specific save/export/render')));
assert(blenderPlan.buildoutTriggers.some((trigger) => trigger.includes('visual canvas/timeline/model operations')));
assert(blenderPlan.actionLadder.findIndex((step) => step.includes('agent.build_app_capability')) < blenderPlan.actionLadder.findIndex((step) => step.includes('one reversible visual coordinate step')));

assert.equal(shouldUseGenericAppNavigator(abletonTask), true);
assert.equal(shouldUseGenericAppNavigator('Open Photoshop and export a PNG proof'), false);
assert.equal(shouldUseGenericAppNavigator('Build whatever is needed so the chat can control any app without previous configuration'), true);
assert.equal(
  shouldUseProfessionalAppAutonomy('I want chat to open any app, figure out how to use it, research what it needs, and do the task'),
  true,
  'professional autonomy trigger catches broad any-app request',
);
assert.equal(
  shouldUseProfessionalAppAutonomy('Open Reminders and add a reminder to call mom'),
  true,
  'professional autonomy still applies to known scriptable app tasks',
);

const promptBlock = formatGenericAppNavigatorPromptBlock(abletonPlan);
assert(promptBlock.includes('## Generic App Navigator'));
assert(promptBlock.includes('research_control_surface'));
assert(promptBlock.includes('Task family: file_open_save_export (file/save/export work)'));
assert(promptBlock.includes('one bounded semantic step'));
assert(promptBlock.includes('hide internal route'));
assert(promptBlock.includes('agent.build_app_capability'));
assert(promptBlock.includes('Apple UI scripting and Accessibility'));

const autonomyPromptBlock = formatProfessionalAppAutonomyPromptBlock(abletonTask) || '';
assert(autonomyPromptBlock.includes('## Professional App Autonomy'));
assert(autonomyPromptBlock.includes('Open/focus first'));
assert(autonomyPromptBlock.includes('Research-first rule'));
assert(autonomyPromptBlock.includes('app-native API/script/plugin/CLI'));
assert(autonomyPromptBlock.includes('desktop.run_applescript'));
assert(autonomyPromptBlock.includes('agent.build_app_capability'));

const strategy = buildComputerAppTaskStrategy(abletonTask);
assert.equal(strategy?.id, 'universal_app_control');
assert(strategy?.label.includes('Ableton Live'));
assert(strategy?.recommendedTools.includes('desktop.click_element'));
assert(strategy?.recommendedTools.includes('desktop.set_element_value'));
assert(strategy?.verificationOrder.some((step) => step.includes('hide internal route/status details')));

const strategyPrompt = buildComputerAppTaskStrategyPromptBlock(abletonTask) || '';
assert(strategyPrompt.includes('## Computer/App Execution Strategy'));
assert(strategyPrompt.includes('## Professional App Autonomy'));
assert(strategyPrompt.includes('## Generic App Navigator'));
assert(strategyPrompt.includes('Can navigate without a dedicated adapter: yes'));
assert(strategyPrompt.includes('Visibility rule: hide internal route'));
// The generic app-adapter-gap contract (find ladder + research-before-guess)
// rides along in the live strategy prompt for any-app tasks.
assert(strategyPrompt.includes('## App Adapter Gap Contract (generic)'));
assert(strategyPrompt.includes('Find the target (basics every app shares)'));
assert(strategyPrompt.includes('Research when unfamiliar'));

const controlPlan = buildAppAutomationControlSurfacePlan(abletonTask);
assert.equal(controlPlan.targetId, 'generic_native_app');
assert.equal(controlPlan.targetName, 'Ableton Live');
assert.equal(controlPlan.taskFamily, 'file/save/export work');
assert(controlPlan.promptHints.some((hint) => hint.includes('Generic navigator: Ableton Live')));
assert(controlPlan.sourceRefs.some((ref) => ref.url.includes('developer.apple.com')));
assert(controlPlan.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/actionability')));
assert(controlPlan.failSafeRules.some((rule) => rule.includes('if a dialog appears')));
assert(controlPlan.buildoutChecklist.some((step) => step.includes('app-specific save/export/render')));

const controlPrompt = buildAppAutomationControlSurfacePromptBlock(abletonTask);
assert(controlPrompt.includes('Generic navigator: Ableton Live'));
assert(controlPrompt.includes('Task family: file/save/export work'));
assert(controlPrompt.includes('Apple UI scripting and Accessibility'));
assert(controlPrompt.includes('Primary-source refs'));

const fieldControlPlan = buildAppAutomationControlSurfacePlan(fieldTask);
assert.equal(fieldControlPlan.targetName, 'UnknownApp');
assert.equal(fieldControlPlan.taskFamily, 'field/form entry');

const fallbackContext = buildGenericAppNavigatorRouteContext(
  'Click the save button',
  { targetAppName: 'Native desktop app', fallbackTargetAppName: 'Native desktop app' },
);
assert.equal(fallbackContext.targetAppName, 'Native desktop app');
assert.equal(fallbackContext.plan.targetAppName, 'Unfamiliar desktop app');
assert.equal(fallbackContext.taskFamilyLabel, 'file/save/export work');

// Scriptable Mac apps (Notes, Reminders, Calendar) have a native AppleScript
// surface — they must NOT be routed through the unfamiliar-app / buildout
// path (that's what made "create a note" stall on "unknown app -> buildout").
assert.equal(
  shouldUseGenericAppNavigator('open the notes app and create a note that says hi'),
  false,
  'Notes is scriptable -> skips the generic navigator / buildout path',
);
assert.equal(
  shouldUseGenericAppNavigator('open reminders and add a reminder to buy milk'),
  false,
  'Reminders is scriptable -> skips the generic navigator',
);
// A genuinely unfamiliar app still routes through the generic navigator.
assert.equal(
  shouldUseGenericAppNavigator('open Ableton Live and create a drum loop'),
  true,
  'a non-scriptable unfamiliar app still uses the generic navigator',
);

console.log('All generic app navigator smoke cases passed.');
