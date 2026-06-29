/**
 * app-adapter-gap-contract-smoketest
 *
 * Verifies the generic, app-agnostic adapter-gap contract: the chat can
 * navigate ANY app via universal primitives, research an unfamiliar app's
 * control surface before guessing, and drive a structured connected-agent
 * buildout — and that this feeds the capability-buildout policy for non-Adobe
 * apps while Adobe keeps its richer design-specific contract.
 *
 * Run: npm run smoke:app-adapter-gap-contract
 */

import assert from 'node:assert/strict';

import {
  buildAppAdapterGapContract,
  buildAppAdapterGapPlan,
  buildAppAdapterGapPromptBlock,
  formatAppAdapterGapPromptBlock,
  inferAppOperation,
} from '../src/lib/appAdapterGapContract';
import { buildAgentAppCapabilityBuildoutPolicy } from '../src/lib/agentAppCapabilityBuildout';

// ── Unfamiliar app: navigate + find + research + buildout ──────────────────
const unfamiliarTask = 'Open MeshWizard Pro and export the selected mesh as an STL file.';
const unfamiliarPlan = buildAppAdapterGapPlan(unfamiliarTask);
assert(unfamiliarPlan, 'unfamiliar app task yields a gap plan');
assert.equal(unfamiliarPlan?.appName, 'MeshWizard Pro');
assert.equal(unfamiliarPlan?.knownApp, false, 'MeshWizard Pro is not pre-configured -> unfamiliar');
const bc = unfamiliarPlan!.contract;
assert(bc.missingBridgeTools[0]?.startsWith('desktop.meshwizard_pro_'), 'proposes an app-specific adapter tool');
// FIND ANYTHING via the basics every app shares
assert(bc.universalFindLadder.some((item) => /accessibility|semantic tree/i.test(item)), 'find ladder reads the a11y/semantic tree');
assert(bc.universalFindLadder.some((item) => /command palette|search/i.test(item)), 'find ladder uses command palette/search');
assert(bc.universalFindLadder.some((item) => /menu bar/i.test(item)), 'find ladder walks the menu bar');
// RESEARCH when unfamiliar
assert(bc.researchPlan.some((item) => /unfamiliar|not pre-configured/i.test(item)), 'research plan flags the unfamiliar app');
assert(bc.researchTriggers.length > 0);
assert(bc.failClosedRules.some((item) => /research/i.test(item)), 'fail-closed: research before guessing');
assert(bc.failClosedRules.some((item) => /coordinate/i.test(item)), 'fail-closed: no blind coordinates');
// NAVIGATE + ACT loop is present
assert(bc.navigatePhases.some((p) => p.id === 'inspect_semantic_tree'));
assert(bc.navigatePhases.some((p) => p.id === 'verify_or_buildout'));
// BUILDOUT contract
assert(bc.connectedAgentTask.includes('MeshWizard Pro'));
assert(bc.connectedAgentTask.includes(bc.missingBridgeTools[0]));
assert(bc.retryPrompt.toLowerCase().includes('after'));
assert(bc.officialSourceRefs.length > 0, 'carries official research refs');

// ── Known/configured app reflects knownApp + app-specific research refs ────
const cadPlan = buildAppAdapterGapPlan('Open AutoCAD and draw a rectangle, then add a dimension.');
assert.equal(cadPlan?.appName, 'AutoCAD');
assert.equal(cadPlan?.knownApp, true, 'AutoCAD is a known configured app');
assert(cadPlan?.contract.officialSourceRefs.some((ref) => /autocad|autodesk/i.test(ref.url + ref.label)), 'pulls AutoCAD-specific research refs');
assert(cadPlan?.contract.officialSourceRefs.some((ref) => /mcp|assistant/i.test(ref.label)), 'pulls Autodesk AI/MCP/Assistant research refs for Autodesk apps');

const matlabPlan = buildAppAdapterGapPlan('Open MATLAB and run a Simulink simulation, then export the plots.');
assert.equal(matlabPlan?.appName, 'MATLAB');
assert.equal(matlabPlan?.knownApp, true, 'MATLAB is a known configured engineering app');
assert(matlabPlan?.contract.controlSurface.includes('MATLAB MCP Core Server'), 'MATLAB contract prefers MCP/toolkit route');
assert(matlabPlan?.contract.officialSourceRefs.some((ref) => /MATLAB MCP Core Server/i.test(ref.label)), 'pulls MATLAB MCP research refs');

// ── Platform-aware research refs ───────────────────────────────────────────
const webContract = buildAppAdapterGapContract('Linear', 'create an issue', { platform: 'web' });
assert(webContract.officialSourceRefs.some((ref) => /playwright|chromedevtools/i.test(ref.url)), 'web platform → browser-control refs');
assert(webContract.controlSurface.includes('DOM') || webContract.controlSurface.toLowerCase().includes('browser') === false);
const macContract = buildAppAdapterGapContract('Some Niche Mac App', 'rename a record', { platform: 'mac' });
assert(macContract.officialSourceRefs.some((ref) => /apple/i.test(ref.url)), 'mac platform → Apple accessibility refs');
assert(macContract.platform === 'mac');

// ── inferAppOperation extracts an action phrase ────────────────────────────
assert(/rename/i.test(inferAppOperation('rename the project to Q3 in Asana')));

// ── Non-app tasks do not get an app gap plan ───────────────────────────────
assert.equal(buildAppAdapterGapPlan('Summarize the key points of this article.'), null, 'non-app task → no app gap plan');
assert.equal(buildAppAdapterGapPlan(''), null);

// ── Prompt block is emitted and never leaks local paths ────────────────────
const promptBlock = buildAppAdapterGapPromptBlock(unfamiliarTask);
assert(promptBlock.includes('App Adapter Gap Contract (generic)'));
assert(promptBlock.includes('Find the target'));
assert(promptBlock.includes('Research when unfamiliar'));
assert(!promptBlock.includes('/Users/'), 'prompt block does not leak local paths');
assert.equal(formatAppAdapterGapPromptBlock(null), '', 'null plan → empty block');

// ── Capability-buildout policy integration ─────────────────────────────────
// Non-Adobe app → composes the generic app gap contract + research checklist.
const genericPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: unfamiliarTask,
  appName: 'MeshWizard Pro',
  capabilityGap: 'No MeshWizard Pro adapter/tool exists yet.',
  desiredOutcome: 'Export the selected mesh as STL with proof.',
});
assert(genericPolicy.prompt.includes('App Adapter Gap Contract (generic)'), 'buildout policy embeds the generic app gap contract for non-Adobe apps');
assert(genericPolicy.researchChecklist.some((item) => item.startsWith('Research before guessing:')), 'buildout policy carries research-before-guessing checklist');

const autocadPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: 'Open AutoCAD, draw a rectangle, add a dimension, and export a PDF proof after approval.',
  appName: 'AutoCAD',
  capabilityGap: 'No deterministic AutoCAD drafting/export adapter exists yet.',
  desiredOutcome: 'Build the smallest AutoCAD command/script adapter with proof.',
});
assert(autocadPolicy.prompt.includes('Engineering/CAD Operation Runbooks'), 'AutoCAD buildout prompt embeds CAD operation runbooks');
assert(autocadPolicy.prompt.includes('Draft or revise 2D CAD geometry'), 'AutoCAD buildout prompt carries drafting runbook');
assert(autocadPolicy.prompt.includes('Export, plot, publish, or save CAD deliverable'), 'AutoCAD buildout prompt carries export runbook');
assert(autocadPolicy.researchChecklist.some((item) => /engineering\/CAD runbook contract/i.test(item)), 'AutoCAD checklist preserves runbook fallback contract');
assert(autocadPolicy.verification.some((item) => /engineering\/CAD buildout/i.test(item)), 'AutoCAD verification requires CAD runbook proof');

const matlabPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: 'Open MATLAB, run a Simulink simulation, run the current script, inspect warnings, run tests, and export plots.',
  appName: 'MATLAB',
  capabilityGap: 'No MATLAB MCP/script execution adapter is available.',
});
assert(matlabPolicy.prompt.includes('Engineering/CAD Operation Runbooks'), 'MATLAB buildout prompt embeds engineering runbooks');
assert(matlabPolicy.prompt.includes('Run MATLAB/Simulink computation'), 'MATLAB buildout prompt carries compute runbook');
assert(matlabPolicy.prompt.includes('Build, debug, test, or review MATLAB code/apps'), 'MATLAB buildout prompt carries code/test runbook');

// Adobe app → keeps the design-specific path; the generic block is NOT added.
const adobePolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: 'Open this Photoshop PSD and add a drop shadow to the logo layer, then export a PNG proof.',
  appName: 'Adobe Photoshop',
  capabilityGap: 'No layer-effects adapter.',
});
assert(!adobePolicy.prompt.includes('App Adapter Gap Contract (generic)'), 'Adobe tasks use the design contract, not the generic fallback');

console.log('All app adapter gap contract smoke cases passed.');
