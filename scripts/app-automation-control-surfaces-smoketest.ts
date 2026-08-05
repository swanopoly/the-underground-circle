/**
 * app-automation-control-surfaces-smoketest
 *
 * Locks the research-backed control-surface order for desktop/app automation.
 *
 * Run: npm run smoke:app-automation-control-surfaces
 */

import assert from 'node:assert/strict';

import {
  buildAppAutomationControlSurfacePlan,
  buildAppAutomationControlSurfacePromptBlock,
  buildAppAutomationResearchPromptBlock,
  buildAppAutomationRouteDecision,
  formatAppAutomationRouteDecisionPromptBlock,
  listAppAutomationResearchRefs,
} from '../src/lib/appAutomationControlSurfaces';
import { buildAgentAppCapabilityBuildoutPolicy } from '../src/lib/agentAppCapabilityBuildout';
import { buildAdobeCreativeCloudAutomationPlan } from '../src/lib/adobeCreativeCloudApps';
import { buildComputerAppPreflight } from '../src/lib/computerAppPreflight';
import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';
import { buildDesignAppAutomationPlan, buildDesignAppAutomationPromptBlock } from '../src/lib/designAppAutomation';

const photoshopTask = 'Open Photoshop and remove the background from this PSD with generative fill, then export a PNG proof.';
const photoshopPlan = buildAppAutomationControlSurfacePlan(photoshopTask);
assert.equal(photoshopPlan.targetId, 'adobe_photoshop');
assert.equal(photoshopPlan.candidates[0]?.id, 'adobe_photoshop_uxp_dom');
assert(photoshopPlan.candidates.some((surface) => surface.id === 'adobe_photoshop_batchplay'));
assert(photoshopPlan.failSafeRules.some((rule) => rule.includes('coordinate actions only')));
assert(photoshopPlan.sourceRefs.some((ref) => ref.label.includes('executeAsModal')));
assert(photoshopPlan.sourceRefs.every((ref) => ref.sourceType?.startsWith('official_')));
assert(photoshopPlan.sourceRefs.every((ref) => ref.lastReviewedAt === '2026-05-29'));

const photoshopDecision = buildAppAutomationRouteDecision(photoshopTask, {
  confirmedRequirements: [
    'Photoshop installed and licensed',
    'local desktop bridge ready',
    'UXP script capable bridge tool available',
    'executeAsModal mutation scope supported',
    'local file grants approved',
    'mutation runs inside modal scope',
    'errors and cancel state are surfaced to recovery',
    'the requested command is supported by UXP scripting',
  ],
  observedEvidence: [
    'fresh document status',
    'fresh layer inventory',
    'raster proof target selected',
  ],
  approvedActions: [
    'text/layer mutation',
    'placing assets',
    'save/export/write',
  ],
});
assert.equal(photoshopDecision.status, 'ready_to_execute');
assert.equal(photoshopDecision.chosenSurface.id, 'adobe_photoshop_uxp_dom');
assert.equal(photoshopDecision.missingConfirmations.length, 0);
assert.equal(photoshopDecision.missingApprovals.length, 0);
assert(photoshopDecision.score >= 90);
const photoshopDecisionBlock = formatAppAutomationRouteDecisionPromptBlock(photoshopDecision);
assert(photoshopDecisionBlock.includes('Status: ready_to_execute'));
assert(photoshopDecisionBlock.includes('Chosen surface: Photoshop UXP DOM/app API in modal scope'));

const photoshopDesignPlan = buildDesignAppAutomationPlan(photoshopTask);
assert(photoshopDesignPlan?.controlSurfaceOrder[0]?.includes('Photoshop UXP DOM'));
assert(photoshopDesignPlan?.failSafeRules.some((rule) => rule.includes('delegate a bounded capability buildout')));
assert((buildDesignAppAutomationPromptBlock(photoshopTask) || '').includes('Research/source refs'));

const indesignTask = 'Open this InDesign package, update the marketing banner copy, relink the hero image, and export a proof PDF.';
const indesignPlan = buildAppAutomationControlSurfacePlan(indesignTask);
assert.equal(indesignPlan.targetId, 'adobe_indesign');
assert.equal(indesignPlan.candidates[0]?.id, 'adobe_indesign_uxp_dom');
assert(indesignPlan.candidates.some((surface) => surface.id === 'adobe_indesign_cloud_api'));
assert(indesignPlan.sourceRefs.some((ref) => ref.url.includes('/indesign/uxp/scripts')));
assert(indesignPlan.sourceRefs.some((ref) => ref.mustConfirm?.some((item) => item.includes('active document identity'))));

const illustratorPlan = buildAdobeCreativeCloudAutomationPlan('Open Illustrator and update this logo then export SVG');
assert(illustratorPlan?.controlSurfaceOrder[0]?.includes('Documented Adobe app script'));
assert(illustratorPlan?.actionOrder.some((step) => step.includes('researched control-surface order')));

const genericPrompt = buildAppAutomationControlSurfacePromptBlock('Use Ableton Live to create a four-bar drum loop and export it after approval');
assert(genericPrompt.includes('Target app: Ableton Live'));
assert(genericPrompt.includes('Task family: file/save/export work'));
assert(genericPrompt.includes('Vendor script/plugin/CLI/API surface'));
assert(genericPrompt.includes('Connected-agent'));
assert(genericPrompt.includes('Fail-safe rules'));
assert(genericPrompt.includes('## Official App Automation Research'));
assert(genericPrompt.includes('reviewed: 2026-06-01'));

const browserPlan = buildAppAutomationControlSurfacePlan('Open the browser, fill the dashboard form, upload the CSV, and submit after approval.');
assert.equal(browserPlan.targetId, 'browser_app');
assert.equal(browserPlan.candidates[0]?.id, 'browser_dom_cdp');
assert(browserPlan.candidates[0]?.label.includes('locator'));
assert(browserPlan.candidates[0]?.requirements.some((item) => item.includes('locator candidates')));
assert(browserPlan.candidates[0]?.verification.some((item) => item.includes('actionability')));
assert(browserPlan.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/locators')));
assert(browserPlan.sourceRefs.some((ref) => ref.url.includes('playwright.dev/docs/actionability')));
assert(browserPlan.sourceRefs.some((ref) => ref.url.includes('developer.chrome.com/docs/devtools/protocol-monitor')));

const browserDecision = buildAppAutomationRouteDecision('Fill and submit the browser dashboard form after approval.', {
  confirmedRequirements: ['browser bridge ready'],
  observedEvidence: ['fresh page URL and title'],
});
assert.equal(browserDecision.status, 'needs_observation');
assert.equal(browserDecision.chosenSurface.id, 'browser_dom_cdp');
assert(browserDecision.missingConfirmations.some((item) => item.includes('DOM/ARIA snapshot')));
assert(browserDecision.missingConfirmations.some((item) => item.includes('locator')));
assert(browserDecision.nextSteps.some((item) => item.includes('Collect fresh evidence')));

const autocadTask = 'Open AutoCAD and create a 2D floor plan with two rooms, dimensions, and a PDF export after approval.';
const autocadPlan = buildAppAutomationControlSurfacePlan(autocadTask);
assert.equal(autocadPlan.targetId, 'engineering_cad_app');
assert(autocadPlan.targetName.includes('AutoCAD'));
assert.equal(autocadPlan.candidates[0]?.id, 'autocad_lisp_dotnet_api');
assert(autocadPlan.candidates.some((surface) => surface.id === 'autodesk_aps_automation_api'));
assert(autocadPlan.candidates.some((surface) => surface.id === 'autodesk_ai_mcp_assistant'));
assert(autocadPlan.sourceRefs.some((ref) => ref.label.includes('AutoLISP')));
assert(autocadPlan.sourceRefs.some((ref) => ref.label.includes('AutoCAD .NET API')));
assert(autocadPlan.sourceRefs.some((ref) => ref.label.includes('Autodesk MCP Servers')));
assert(autocadPlan.sourceRefs.some((ref) => ref.url.includes('aps.autodesk.com/developer/overview/autocad-api')));
assert(autocadPlan.failSafeRules.some((rule) => rule.includes('coordinate actions only')));
assert(autocadPlan.promptHints.some((hint) => hint.includes('Official refs reviewed')));

const autodeskAiPlan = buildAppAutomationControlSurfacePlan('Use Autodesk MCP servers and Autodesk Assistant in Fusion to inspect the design and suggest a manufacturing-ready feature workflow.');
assert.equal(autodeskAiPlan.targetId, 'engineering_cad_app');
assert.equal(autodeskAiPlan.candidates[0]?.id, 'autodesk_ai_mcp_assistant');
assert(autodeskAiPlan.sourceRefs.some((ref) => ref.label.includes('Autodesk Assistant')));
assert(autodeskAiPlan.sourceRefs.some((ref) => ref.label.includes('Autodesk neural CAD')));

const solidworksPlan = buildAppAutomationControlSurfacePlan('Use SOLIDWORKS to update this part dimension and export STEP after approval.');
assert.equal(solidworksPlan.targetId, 'engineering_cad_app');
assert.equal(solidworksPlan.candidates[0]?.id, 'solidworks_com_api');
assert(solidworksPlan.sourceRefs.some((ref) => ref.label.includes('SOLIDWORKS API')));
assert(solidworksPlan.sourceRefs.some((ref) => ref.label.includes('SOLIDWORKS macros')));

const matlabPlan = buildAppAutomationControlSurfacePlan('Open MATLAB and build a Simulink model, run the simulation, test the script, and export plots after approval.');
assert.equal(matlabPlan.targetId, 'engineering_cad_app');
assert.equal(matlabPlan.targetName, 'MATLAB / Simulink');
assert.equal(matlabPlan.candidates[0]?.id, 'matlab_mcp_agentic_toolkit');
assert(matlabPlan.sourceRefs.some((ref) => ref.label.includes('MATLAB MCP Core Server')));
assert(matlabPlan.sourceRefs.some((ref) => ref.label.includes('MATLAB Agentic Toolkit')));
assert(matlabPlan.sourceRefs.some((ref) => ref.label.includes('MATLAB AI skill')));

const rhinoPlan = buildAppAutomationControlSurfacePlan('Open Rhino and put selected curves on a new layer, then export the 3DM proof.');
assert.equal(rhinoPlan.targetId, 'engineering_cad_app');
assert.equal(rhinoPlan.candidates[0]?.id, 'rhino_common_api');
assert(rhinoPlan.sourceRefs.some((ref) => ref.label.includes('RhinoCommon')));

const revitPlan = buildAppAutomationControlSurfacePlan('Open Revit, update the sheet title block, and export a PDF set after approval.');
assert.equal(revitPlan.targetId, 'engineering_cad_app');
assert.equal(revitPlan.candidates[0]?.id, 'revit_api_addin');
assert(revitPlan.sourceRefs.some((ref) => ref.label.includes('Revit API')));

const freeCadPlan = buildAppAutomationControlSurfacePlan('Open FreeCAD and inspect the STEP file dimensions before exporting a copy.');
assert.equal(freeCadPlan.targetId, 'engineering_cad_app');
assert.equal(freeCadPlan.targetName, 'FreeCAD');
assert.equal(freeCadPlan.candidates[0]?.id, 'vendor_script_or_plugin_api');
assert(freeCadPlan.candidates.some((surface) => surface.id === 'connected_agent_buildout'));

const unfamiliarAppDecision = buildAppAutomationRouteDecision('Use Ableton Live to create a four-bar drum loop and export it after approval', {
  availableSurfaceIds: ['connected_agent_buildout'],
  unavailableSurfaceIds: ['vendor_script_or_plugin_api', 'os_accessibility', 'semantic_desktop', 'screenshot_coordinate_fallback'],
});
assert.equal(unfamiliarAppDecision.status, 'needs_connected_agent_buildout');
assert.equal(unfamiliarAppDecision.targetName, 'Ableton Live');
assert.equal(unfamiliarAppDecision.taskFamily, 'file/save/export work');
assert.equal(unfamiliarAppDecision.chosenSurface.id, 'connected_agent_buildout');
assert(unfamiliarAppDecision.nextSteps.some((item) => item.includes('connected-agent app capability buildout')));

const blockedDecision = buildAppAutomationRouteDecision(indesignTask, {
  userActionBlockers: ['InDesign is not installed or licensed on this Mac'],
});
assert.equal(blockedDecision.status, 'needs_user_action');
assert(blockedDecision.nextSteps[0]?.includes('InDesign is not installed'));
assert(blockedDecision.score < 80);

const allRefs = listAppAutomationResearchRefs();
assert(allRefs.length >= 10);
assert(allRefs.every((ref) => ref.url.startsWith('https://')));
assert(allRefs.every((ref) => ref.sourceType?.startsWith('official_')));

const researchBlock = buildAppAutomationResearchPromptBlock('Open Photoshop and export a proof after updating a text layer');
assert(researchBlock.includes('Primary-source refs to use before blogs or examples'));
assert(researchBlock.includes('Adobe Photoshop UXP scripting'));
assert(researchBlock.includes('Research contract'));

const buildoutPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: 'Use Ableton Live to create a four-bar drum loop and export it after approval',
  appName: 'Ableton Live',
  capabilityGap: 'No Ableton adapter exists for project/timeline export automation.',
});
assert(buildoutPolicy.prompt.includes('Research-backed control surface order'));
assert(buildoutPolicy.prompt.includes('Vendor script/plugin/CLI/API surface'));
assert(buildoutPolicy.prompt.includes('Official App Automation Research'));
assert(buildoutPolicy.prompt.includes('## App Automation Route Decision'));
assert(buildoutPolicy.prompt.includes('Status: needs_connected_agent_buildout'));
assert(buildoutPolicy.prompt.includes('source: official_'));
assert(buildoutPolicy.prompt.includes('reviewed: 2026-06-01'));
assert(buildoutPolicy.researchChecklist.some((item) => item.includes('choose from this control-surface order')));

const CAPABILITY_IDS: ComputerCapabilityId[] = [
  'browser_automation',
  'browser_sessions',
  'file_search',
  'file_read',
  'file_write',
  'app_tools',
  'agent_bridges',
  'desktop_control',
];

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>> = {}): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => ({
    id,
    label: id,
    status: overrides[id] || 'ready',
    detail: `${id} ${overrides[id] || 'ready'}`,
    sources: ['smoke-test'],
  }));
  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: [],
    availableIntegrationCapabilities: [],
    activeBridgeProviders: [],
    activeMcpServerCount: 0,
    activeMcpToolCount: 0,
  };
}

const preflight = buildComputerAppPreflight({
  task: indesignTask,
  audit: audit(),
});
assert.equal(preflight.strategy?.id, 'creative_layout_control');
assert.equal(preflight.routeDecision?.status, 'needs_observation');
assert.equal(preflight.routeDecision?.chosenSurface.id, 'adobe_indesign_uxp_dom');
assert(preflight.warnings.some((warning) => warning.id === 'control-surface:research-backed-order'));
assert(preflight.warnings.some((warning) => warning.id === 'route-decision:needs-observation'));
assert(preflight.fixActions.some((fix) => fix.includes('InDesign UXP script/plugin DOM')));

const cadPreflight = buildComputerAppPreflight({
  task: autocadTask,
  audit: audit(),
});
assert.equal(cadPreflight.strategy?.id, 'engineering_cad_control');
assert.equal(cadPreflight.routeDecision?.status, 'needs_observation');
assert.equal(cadPreflight.routeDecision?.chosenSurface.id, 'autocad_lisp_dotnet_api');
assert(cadPreflight.warnings.some((warning) => warning.id === 'control-surface:research-backed-order'));
assert(cadPreflight.warnings.some((warning) => warning.id === 'route-decision:needs-observation'));
assert(cadPreflight.fixActions.some((fix) => fix.includes('AutoCAD API / AutoLISP')));
assert(cadPreflight.fixActions.some((fix) => fix.includes('call agent.build_app_capability')));

console.log('All app automation control surface smoke cases passed.');
