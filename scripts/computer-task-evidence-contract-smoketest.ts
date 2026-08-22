/**
 * computer-task-evidence-contract-smoketest — verifies that browser,
 * desktop app, local file, and design-app chat routes carry an evidence-first
 * execution contract before SwanBot/OpenSwan dispatch.
 *
 * Run: npm run smoke:computer-task-evidence-contract
 */

import assert from 'node:assert/strict';
import { summarisePlanForTelemetry, buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildChatComputerRequestRoute, buildChatComputerRequestRoutePromptBlock } from '../src/lib/chatComputerRequestRouter';
import {
  formatComputerTaskEvidenceContractPromptBlock,
  isReadOnlyDesktopEvidenceContract,
  summarizeComputerTaskEvidenceContract,
} from '../src/lib/computerTaskEvidenceContract';

const browserRoute = buildChatComputerRequestRoute('Log into Shopify and update this product page after I approve');
assert(browserRoute?.evidenceContract, 'browser route carries evidence contract');
assert.equal(browserRoute.evidenceContract.kind, 'browser');
assert(browserRoute.evidenceContract.actionabilityChecks.some((item) => /visible/i.test(item)), 'browser contract requires visible target');
assert(browserRoute.evidenceContract.actionabilityChecks.some((item) => /receives events/i.test(item)), 'browser contract requires event-receiving target');
assert(browserRoute.evidenceContract.approvalBefore.some((item) => /credential/i.test(item)), 'browser contract gates credentials');
assert(browserRoute.evidenceContract.failClosedRules.some((item) => /human verification|MFA/i.test(item)), 'browser contract fails closed on human verification');
assert(browserRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/actionability')), 'browser contract cites Playwright actionability');
assert(browserRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/locators')), 'browser contract cites Playwright locators');

const photoshopRoute = buildChatComputerRequestRoute('Open Photoshop and generate a background then save png');
assert(photoshopRoute?.evidenceContract, 'Photoshop route carries evidence contract');
assert.equal(photoshopRoute.evidenceContract.targetName, 'Adobe Photoshop');
assert(photoshopRoute.evidenceContract.observeBefore.some((item) => /layer\/selection\/mask inventory/i.test(item)), 'Photoshop contract requires layer/selection/mask inventory');
assert(photoshopRoute.evidenceContract.actionabilityChecks.some((item) => /modal execution scope/i.test(item)), 'Photoshop contract requires modal execution scope');
assert(photoshopRoute.evidenceContract.approvalBefore.some((item) => /destructive edit/i.test(item)), 'Photoshop contract gates destructive edits');
assert(photoshopRoute.evidenceContract.proofAfter.some((item) => /Photoshop document status and layer inventory/i.test(item)), 'Photoshop contract requires refreshed inventory proof');
assert(photoshopRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('/photoshop/uxp/scripting/')), 'Photoshop contract cites UXP scripting');
assert(photoshopRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('/executeasmodal/')), 'Photoshop contract cites executeAsModal');

const multiActionIllustratorRoute = buildChatComputerRequestRoute(
  'Open Adobe Illustrator 2026, create a new document, add a blue circle, and export it as PNG',
);
assert(multiActionIllustratorRoute?.requestedActionContract, 'multi-action Illustrator route carries requested-action accounting');
assert.deepEqual(
  multiActionIllustratorRoute.requestedActionContract.actions.map((action) => action.id),
  ['A1', 'A2', 'A3', 'A4'],
  'multi-action Illustrator route retains every requested action ID',
);
for (const action of multiActionIllustratorRoute.requestedActionContract.actions) {
  assert(
    multiActionIllustratorRoute.evidenceContract?.proofAfter.some((proof) => proof.startsWith(`${action.id} independently verified`)),
    `${action.id} receives an independent proof requirement`,
  );
}
assert(
  multiActionIllustratorRoute.evidenceContract?.failClosedRules.some((rule) => /whole task non-complete/i.test(rule)),
  'missing proof for one requested action keeps the whole task non-complete',
);

const exactBlankDocumentRoute = buildChatComputerRequestRoute('Open Photoshop and start a new project 600 x 600');
assert(exactBlankDocumentRoute?.evidenceContract, 'exact blank-document route carries an evidence contract');
assert.equal(exactBlankDocumentRoute.evidenceContract.taskFamily, 'from-scratch 600x600 blank-document creation');
assert.deepEqual(exactBlankDocumentRoute.evidenceContract.proofAfter, [
  'final desktop.photoshop_document_status reports an active 600x600 document',
  'final app-native status reports the created document name and dimensions',
]);
assert.deepEqual(exactBlankDocumentRoute.evidenceContract.approvalBefore, [], 'bounded unsaved blank document has no redundant approval gate');
assert(
  exactBlankDocumentRoute.evidenceContract.mutationGuardrails.some((item) => /direct user command.*unsaved blank document/i.test(item)),
  'exact blank-document contract records narrow direct-request authority',
);
assert(!/layer|source file|package|screenshot|export/i.test([
  ...exactBlankDocumentRoute.evidenceContract.observeBefore,
  ...exactBlankDocumentRoute.evidenceContract.actionabilityChecks,
  ...exactBlankDocumentRoute.evidenceContract.proofAfter,
  ...exactBlankDocumentRoute.evidenceContract.freshEvidenceRequired,
].join(' ')), 'exact blank-document evidence omits generic edit-file review');

for (const request of [
  'Open Photoshop',
  'Open VLC and read the current track title',
  'Open R and read the active console prompt',
]) {
  const readOnlyRoute = buildChatComputerRequestRoute(request);
  assert(readOnlyRoute?.evidenceContract, `${request}: pure desktop read carries evidence contract`);
  const contract = readOnlyRoute.evidenceContract;
  assert.equal(contract.kind, 'desktop_app', `${request}: pure read remains desktop-owned`);
  assert.equal(contract.taskFamily, 'app inspection', `${request}: pure read uses the canonical app-inspection family`);
  assert.equal(isReadOnlyDesktopEvidenceContract(contract), true, `${request}: contract is explicitly recognizable as read-only desktop evidence`);
  assert.deepEqual(contract.approvalBefore, [], `${request}: launch/read has no mutation approval evidence`);
  assert.doesNotMatch(
    contract.observeBefore.join(' | '),
    /staged source|output destination|before mutation|layer\/selection\/mask inventory|text\/link\/font/i,
    `${request}: observe-before has no file or document-mutation precondition`,
  );
  assert.doesNotMatch(
    contract.proofAfter.join(' | '),
    /file_stat|exported proof|output artifact|object manifest|post-change|layer inventory/i,
    `${request}: proof requires only same-app read state`,
  );
  assert.doesNotMatch(
    contract.freshEvidenceRequired.join(' | '),
    /file_stat|output write|layer inventory|mutation retry/i,
    `${request}: retry evidence has no file or mutation requirement`,
  );
  assert(contract.mutationGuardrails.some((item) => /do not substitute or foreground a browser/i.test(item)), `${request}: desktop read forbids browser foreground fallback`);
}

for (const [request, expectedTarget] of [
  ['Open Docker Desktop', 'Docker Desktop'],
  ['Open Microsoft Remote Desktop', 'Microsoft Remote Desktop'],
] as const) {
  const route = buildChatComputerRequestRoute(request);
  assert(route?.evidenceContract, `${request}: desktop product carries evidence`);
  assert.equal(route.evidenceContract.targetName, expectedTarget, `${request}: exact product identity reaches evidence`);
  assert.equal(route.evidenceContract.taskFamily, 'app inspection', `${request}: product launch is read-only`);
  assert.deepEqual(route.evidenceContract.approvalBefore, [], `${request}: no approval for launch/read`);
  assert.doesNotMatch(
    [
      ...route.evidenceContract.observeBefore,
      ...route.evidenceContract.proofAfter,
      ...route.evidenceContract.freshEvidenceRequired,
    ].join(' | '),
    /file_stat|source file|output file|output destination|mutation retry/i,
    `${request}: Desktop suffix does not imply file work`,
  );
}

const indesignRoute = buildChatComputerRequestRoute('Open this InDesign file and make changes for a marketing banner with different layers');
assert(indesignRoute?.evidenceContract, 'InDesign route carries evidence contract');
assert.equal(indesignRoute.evidenceContract.targetName, 'Adobe InDesign');
assert(indesignRoute.evidenceContract.observeBefore.some((item) => /text\/link\/font/i.test(item)), 'InDesign contract requires text/link/font inventory');
assert(indesignRoute.evidenceContract.actionabilityChecks.some((item) => /UXP script\/plugin DOM/i.test(item)), 'InDesign contract prefers UXP script/plugin DOM');
assert(indesignRoute.evidenceContract.proofAfter.some((item) => /text\/link\/layer|preflight inventory/i.test(item)), 'InDesign contract requires refreshed layout inventory proof');
assert(indesignRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('/indesign/uxp/scripts/')), 'InDesign contract cites UXP scripts');

const cadRoute = buildChatComputerRequestRoute('Open AutoCAD and create a 2D floor plan with two rooms and dimensions, then export PDF after approval');
assert(cadRoute?.evidenceContract, 'CAD route carries evidence contract');
assert.equal(cadRoute.evidenceContract.kind, 'desktop_app');
assert(cadRoute.evidenceContract.observeBefore.some((item) => /engineering document\/model\/project state/i.test(item)), 'CAD contract requires units/model state before mutation');
assert(cadRoute.evidenceContract.actionabilityChecks.some((item) => /app API\/script\/add-in\/command surface/i.test(item)), 'CAD contract prefers app-native/script control');
assert(cadRoute.evidenceContract.proofAfter.some((item) => /units\/dimensions\/layers/i.test(item)), 'CAD contract requires refreshed engineering proof');
assert(cadRoute.evidenceContract.sourceRefs.some((ref) => ref.label.includes('AutoLISP')), 'CAD contract cites AutoLISP');
assert(cadRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('aps.autodesk.com/developer/overview/autocad-api')), 'CAD contract cites AutoCAD API');

const matlabRoute = buildChatComputerRequestRoute('Open MATLAB and build a Simulink model, run the simulation, and export plots after approval');
assert(matlabRoute?.evidenceContract, 'MATLAB route carries evidence contract');
assert.equal(matlabRoute.evidenceContract.targetName, 'MATLAB / Simulink');
assert(matlabRoute.evidenceContract.observeBefore.some((item) => /toolboxes/i.test(item)), 'MATLAB contract requires toolbox/project state before execution');
assert(matlabRoute.evidenceContract.sourceRefs.some((ref) => ref.label.includes('MATLAB MCP Core Server')), 'MATLAB contract cites MCP Core Server');

const abletonRoute = buildChatComputerRequestRoute('Use Ableton Live to create a four-bar drum loop and export it after approval');
assert(abletonRoute?.evidenceContract, 'unfamiliar app route carries evidence contract');
assert.equal(abletonRoute.evidenceContract.targetName, 'Ableton Live');
assert.equal(abletonRoute.evidenceContract.taskFamily, 'file/save/export work');
assert(abletonRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('developer.apple.com')), 'unfamiliar app contract cites Apple accessibility automation');
assert(abletonRoute.evidenceContract.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/actionability')), 'unfamiliar app contract cites actionability for hybrid/browser-like surfaces');

const zoomMutationRoute = buildChatComputerRequestRoute('Open Zoom and mute my microphone');
assert(zoomMutationRoute?.evidenceContract, 'reversible Zoom mutation carries evidence contract');
assert.equal(isReadOnlyDesktopEvidenceContract(zoomMutationRoute.evidenceContract), false, 'Zoom mutation cannot inherit read-only evidence authority');
assert(zoomMutationRoute.evidenceContract.approvalBefore.some((item) => /mutation|saving|exporting|deleting/i.test(item)), 'Zoom mutation retains an approval boundary');
assert(zoomMutationRoute.evidenceContract.actionabilityChecks.some((item) => /target|control/i.test(item)), 'Zoom mutation retains exact-target actionability');
assert(zoomMutationRoute.evidenceContract.proofAfter.some((item) => /before\/after|screenshot|state/i.test(item)), 'Zoom mutation retains after-state proof');
assert.doesNotMatch(zoomMutationRoute.evidenceContract.freshEvidenceRequired.join(' | '), /file_stat|output writes/i, 'non-file Zoom mutation does not fabricate output-file evidence');

assert.equal(isReadOnlyDesktopEvidenceContract(photoshopRoute.evidenceContract), false, 'Photoshop edit/export contract remains mutating');
assert(photoshopRoute.evidenceContract.approvalBefore.some((item) => /document mutation/i.test(item)), 'Photoshop edit/export retains document-mutation approval');
assert(photoshopRoute.evidenceContract.proofAfter.some((item) => /file_stat/i.test(item)), 'Photoshop export retains output file proof');
assert(photoshopRoute.evidenceContract.freshEvidenceRequired.some((item) => /file_stat/i.test(item)), 'Photoshop export retains fresh output evidence');

const fileRoute = buildChatComputerRequestRoute('Search files in Downloads for invoice');
assert(fileRoute?.evidenceContract, 'local file route carries evidence contract');
assert.equal(fileRoute.evidenceContract.kind, 'local_file');
assert(fileRoute.evidenceContract.observeBefore.some((item) => /scoped folder\/path/i.test(item)), 'file contract resolves scope before read/write');
assert(fileRoute.evidenceContract.approvalBefore.some((item) => /write|delete|move/i.test(item)), 'file contract gates mutations');
assert(fileRoute.evidenceContract.proofAfter.some((item) => /bounded search\/read result/i.test(item)), 'file contract requires bounded read proof');

const telemetry = summarisePlanForTelemetry(buildChatAutomationPlan({
  message: 'Open Photoshop and generate a background then save png',
}));
const telemetryContract = (telemetry.computerRequestRoute as any)?.evidenceContract;
assert.equal(telemetryContract?.targetName, 'Adobe Photoshop', 'planner telemetry includes evidence contract summary');
assert(telemetryContract?.proofAfter?.some((item: string) => /layer inventory/i.test(item)), 'telemetry evidence summary includes proof-after items');

const promptBlock = buildChatComputerRequestRoutePromptBlock('Open Photoshop and generate a background then save png') || '';
assert(promptBlock.includes('## Computer Task Evidence Contract'), 'route prompt includes evidence contract block');
assert(promptBlock.includes('Fresh evidence before retry'), 'route prompt carries retry-evidence rules');
assert(!promptBlock.includes('/Users/'), 'route prompt stays free of local absolute paths');

const compact = summarizeComputerTaskEvidenceContract(photoshopRoute.evidenceContract);
assert(!('mutationGuardrails' in compact), 'compact evidence summary omits verbose guardrails');
const contractPrompt = formatComputerTaskEvidenceContractPromptBlock(browserRoute.evidenceContract);
assert(contractPrompt.includes('Actionability checks'), 'evidence prompt formatter includes actionability');
assert(contractPrompt.includes('Source refs'), 'evidence prompt formatter includes source refs');

console.log('All computer task evidence contract smoke cases passed.');
