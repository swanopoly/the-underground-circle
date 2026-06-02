/**
 * chat-computer-request-router-smoketest — verifies that chat requests
 * involving browser, files, desktop apps, and unfamiliar apps produce one
 * explicit best-path route before execution.
 *
 * Run: npm run smoke:chat-computer-request-router
 */

import { buildChatAutomationPlan, summarisePlanForTelemetry } from '../src/lib/chatAutomationPlanner';
import { formatChatComputerTaskAutonomyPromptBlock } from '../src/lib/chatComputerTaskAutonomy';
import { buildChatComputerRequestRoute, buildChatComputerRequestRoutePromptBlock } from '../src/lib/chatComputerRequestRouter';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assertRoute(
  input: string,
  expected: Partial<{
    kind: string;
    strategyId: string;
    pipelineId: string;
    risk: string;
    approvalRequired: boolean;
    designApp: string;
    routeId: string | null;
    routeDecisionStatus: string | null;
    routeDecisionTarget: string | null;
    routeDecisionTaskFamily: string | null;
    evidenceTarget: string | null;
    evidenceTaskFamily: string | null;
    minTools: string[];
  }>,
) {
  const route = buildChatComputerRequestRoute(input);
  if (!route) {
    fail(`${input} expected a computer request route`);
    return;
  }
  const errors: string[] = [];
  if (expected.kind !== undefined && route.kind !== expected.kind) errors.push(`kind expected ${expected.kind}, got ${route.kind}`);
  if (expected.strategyId !== undefined && route.appStrategy?.id !== expected.strategyId) errors.push(`strategy expected ${expected.strategyId}, got ${route.appStrategy?.id || 'none'}`);
  if (expected.pipelineId !== undefined && route.selectedPipeline?.id !== expected.pipelineId) errors.push(`pipeline expected ${expected.pipelineId}, got ${route.selectedPipeline?.id || 'none'}`);
  if (expected.risk !== undefined && route.risk !== expected.risk) errors.push(`risk expected ${expected.risk}, got ${route.risk}`);
  if (expected.approvalRequired !== undefined && route.approvalRequired !== expected.approvalRequired) errors.push(`approval expected ${expected.approvalRequired}, got ${route.approvalRequired}`);
  if (expected.designApp !== undefined && route.designExecutionPipeline?.appName !== expected.designApp) errors.push(`design app expected ${expected.designApp}, got ${route.designExecutionPipeline?.appName || 'none'}`);
  if (expected.routeId !== undefined && route.routeId !== expected.routeId) errors.push(`routeId expected ${expected.routeId}, got ${route.routeId}`);
  if (expected.routeDecisionStatus !== undefined && (route.appAutomationRouteDecision?.status || null) !== expected.routeDecisionStatus) {
    errors.push(`route decision expected ${expected.routeDecisionStatus}, got ${route.appAutomationRouteDecision?.status || 'none'}`);
  }
  if (expected.routeDecisionTarget !== undefined && (route.appAutomationRouteDecision?.targetName || null) !== expected.routeDecisionTarget) {
    errors.push(`route decision target expected ${expected.routeDecisionTarget}, got ${route.appAutomationRouteDecision?.targetName || 'none'}`);
  }
  if (expected.routeDecisionTaskFamily !== undefined && (route.appAutomationRouteDecision?.taskFamily || null) !== expected.routeDecisionTaskFamily) {
    errors.push(`route decision task family expected ${expected.routeDecisionTaskFamily}, got ${route.appAutomationRouteDecision?.taskFamily || 'none'}`);
  }
  if (expected.evidenceTarget !== undefined && (route.evidenceContract?.targetName || null) !== expected.evidenceTarget) {
    errors.push(`evidence target expected ${expected.evidenceTarget}, got ${route.evidenceContract?.targetName || 'none'}`);
  }
  if (expected.evidenceTaskFamily !== undefined && (route.evidenceContract?.taskFamily || null) !== expected.evidenceTaskFamily) {
    errors.push(`evidence task family expected ${expected.evidenceTaskFamily}, got ${route.evidenceContract?.taskFamily || 'none'}`);
  }
  const missingTools = (expected.minTools || []).filter((tool) => !route.recommendedTools.includes(tool));
  if (missingTools.length > 0) errors.push(`missing tools ${missingTools.join(', ')}`);
  if (!route.bestPath || !route.notes.some((note) => note.includes('Computer request route'))) {
    errors.push('route should expose bestPath and route note');
  }
  if (!route.completionProof.length) errors.push('route should expose completion proof');
  if (errors.length) {
    fail(`${input}\n    ${errors.join('\n    ')}`);
    return;
  }
  pass(`${route.kind}/${route.appStrategy?.id || 'no-strategy'}: ${input}`);
}

assertRoute(
  'Open Photoshop and generate a background then save png',
  {
    kind: 'desktop_app',
    strategyId: 'creative_layout_control',
    pipelineId: 'creative_layout_design',
    risk: 'review',
    approvalRequired: true,
    designApp: 'Adobe Photoshop',
    routeId: 'browser',
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_export_proof'],
  },
);

assertRoute(
  'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png',
  {
    kind: 'desktop_app',
    strategyId: 'creative_layout_control',
    pipelineId: 'creative_layout_design',
    risk: 'safe',
    approvalRequired: false,
    designApp: 'Adobe Photoshop',
    routeId: 'browser',
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory'],
  },
);

assertRoute(
  'Open this InDesign file and make changes for a marketing banner with different layers',
  {
    kind: 'desktop_app',
    strategyId: 'creative_layout_control',
    pipelineId: 'creative_layout_design',
    risk: 'review',
    approvalRequired: true,
    designApp: 'Adobe InDesign',
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_export_proof'],
  },
);

assertRoute(
  'Use Ableton Live to create a four-bar drum loop and export it after approval',
  {
    kind: 'desktop_app',
    strategyId: 'universal_app_control',
    pipelineId: 'desktop_app_control',
    risk: 'review',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    routeDecisionTarget: 'Ableton Live',
    routeDecisionTaskFamily: 'file/save/export work',
    evidenceTarget: 'Ableton Live',
    evidenceTaskFamily: 'file/save/export work',
    minTools: ['office.list_agents', 'agent.build_app_capability', 'desktop.read_a11y_tree'],
  },
);

assertRoute(
  'Open AutoCAD and create a 2D floor plan with two rooms and dimensions',
  {
    kind: 'desktop_app',
    strategyId: 'engineering_cad_control',
    pipelineId: 'desktop_app_control',
    risk: 'review',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.read_a11y_tree', 'desktop.file_stat', 'approvals.request'],
  },
);

assertRoute(
  'Log into Shopify and update this product page after I approve',
  {
    kind: 'browser',
    strategyId: 'credentialed_browser',
    pipelineId: 'website_platform_admin',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    minTools: ['vault.resolve_for_task', 'browser.verification_state'],
  },
);

assertRoute(
  'Search files in Downloads for invoice',
  {
    kind: 'local_file',
    strategyId: 'file_readonly',
    pipelineId: 'local_files',
    risk: 'safe',
    approvalRequired: false,
    routeDecisionStatus: null,
    minTools: ['desktop.file_search'],
  },
);

const pureImageRoute = buildChatComputerRequestRoute('Generate an image of a neon swan');
if (pureImageRoute) {
  fail(`pure image generation should not force computer route, got ${pureImageRoute.bestPath}`);
} else {
  pass('pure image generation stays on image/chat route');
}

const wordpressPlan = buildChatAutomationPlan({ message: 'Publish the homepage update to WordPress' });
if (wordpressPlan.execution.kind !== 'run_command_handler' || wordpressPlan.execution.routeId !== 'wordpress') {
  fail(`simple WordPress publish should keep existing conversational route, got ${wordpressPlan.execution.kind}/${wordpressPlan.execution.routeId}`);
} else {
  pass('simple WordPress publish preserves existing route');
}

const photoshopPlan = buildChatAutomationPlan({ message: 'Open Photoshop and generate a background then save png' });
if (photoshopPlan.execution.kind !== 'run_computer_task' || photoshopPlan.computerRequestRoute?.appStrategy?.id !== 'creative_layout_control') {
  fail('chat planner should dispatch Photoshop app work through the computer request route');
} else {
  pass('chat planner uses computer request route for Photoshop');
}

const imagePlan = buildChatAutomationPlan({ message: 'Generate an image of a neon swan' });
if (imagePlan.execution.routeId !== 'hf_tools' || imagePlan.computerRequestRoute) {
  fail('chat planner should leave pure image generation on hf_tools without computer route');
} else {
  pass('chat planner leaves pure image generation on hf_tools');
}

const telemetry = summarisePlanForTelemetry(photoshopPlan);
if ((telemetry.computerRequestRoute as any)?.appStrategyId !== 'creative_layout_control') {
  fail('planner telemetry should include compact computer request route details');
} else {
  pass('planner telemetry includes computer request route details');
}

const prompt = buildChatComputerRequestRoutePromptBlock('Open InDesign and export high quality pdf as brochure.pdf') || '';
if (
  !prompt.includes('## Chat Computer Request Route') ||
  !prompt.includes('## Least User Effort Policy') ||
  !prompt.includes('User effort: approve') ||
  !prompt.includes('Can auto-prepare: yes') ||
  !prompt.includes('Execution rule: prepare quietly where allowed') ||
  !prompt.includes('Best path:') ||
  !prompt.includes('## App Automation Route Decision') ||
  !prompt.includes('Status: needs_observation') ||
  prompt.includes('/Users/')
) {
  fail('computer request route prompt should be compact, routed, and free of local absolute paths');
} else {
  pass('computer request route prompt block is compact and sanitized');
}

const quietPrompt = buildChatComputerRequestRoutePromptBlock('Search files in Downloads for invoice') || '';
if (
  !quietPrompt.includes('User effort: none') ||
  !quietPrompt.includes('Can run quietly: yes') ||
  !quietPrompt.includes('Can auto-prepare: yes') ||
  !quietPrompt.includes('Execution rule: start useful work quietly') ||
  quietPrompt.includes('Ready for review')
) {
  fail('safe local-file route prompt should encode quiet least-effort execution');
} else {
  pass('safe local-file prompt encodes quiet least-effort execution');
}

const browserApprovalPrompt = buildChatComputerRequestRoutePromptBlock('Log into Shopify and update this product page after I approve') || '';
if (
  !browserApprovalPrompt.includes('User effort: approve') ||
  !browserApprovalPrompt.includes('Can auto-prepare: no') ||
  !browserApprovalPrompt.includes('stop at the approval boundary')
) {
  fail('credentialed browser prompt should encode approval without desktop auto-prep');
} else {
  pass('credentialed browser prompt encodes approval without desktop auto-prep');
}

const blockedRoute = buildChatComputerRequestRoute('Open Photoshop and generate a background then save png');
const blockedPrompt = blockedRoute
  ? formatChatComputerTaskAutonomyPromptBlock({
      ...blockedRoute,
      appAutomationRouteDecision: blockedRoute.appAutomationRouteDecision
        ? {
            ...blockedRoute.appAutomationRouteDecision,
            status: 'needs_user_action',
            userActionBlockers: ['Grant macOS Accessibility permission for Photoshop control.'],
          }
        : null,
    })
  : '';
if (
  !blockedPrompt.includes('User effort: unblock') ||
  !blockedPrompt.includes('Can run quietly: no') ||
  !blockedPrompt.includes('Can auto-prepare: no') ||
  !blockedPrompt.includes('do not continue execution until the user-controlled blocker is cleared')
) {
  fail('blocked app route prompt should fail closed to user unblock');
} else {
  pass('blocked app route prompt fails closed to user unblock');
}

const abletonRoute = buildChatComputerRequestRoute('Use Ableton Live to create a four-bar drum loop and export it after approval');
if (!abletonRoute?.bestPath.includes('desktop app: Ableton Live') || abletonRoute.bestPath.includes('Generic App Navigator via')) {
  fail(`unfamiliar app route should keep bestPath user-readable, got ${abletonRoute?.bestPath || 'none'}`);
} else {
  pass('unfamiliar app route bestPath is user-readable');
}
if (!abletonRoute?.notes.some((note) => note.includes('for file/save/export work'))) {
  fail('unfamiliar app route notes should preserve the task-family label');
} else {
  pass('unfamiliar app route notes preserve the task-family label');
}

if (failures > 0) {
  console.error(`\n${failures} chat computer request route smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat computer request route smoke cases passed.');
