/**
 * chat-computer-request-router-smoketest — verifies that chat requests
 * involving browser, files, desktop apps, and unfamiliar apps produce one
 * explicit best-path route before execution.
 *
 * Run: npm run smoke:chat-computer-request-router
 */

import { buildChatAutomationPlan, summarisePlanForTelemetry } from '../src/lib/chatAutomationPlanner';
import { formatChatComputerTaskAutonomyPromptBlock } from '../src/lib/chatComputerTaskAutonomy';
import {
  buildChatComputerRequestRoute,
  buildChatComputerRequestRoutePromptBlock,
  constraintBlocksToolCall,
  detectAlwaysConfirmFloorCategories,
} from '../src/lib/chatComputerRequestRouter';

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

function assertLocalFileActionTool(input: string, expectedTool: string, expectedApprovalRequired?: boolean) {
  const route = buildChatComputerRequestRoute(input);
  const tools = route?.actionItems?.map((item) => item.tool) || [];
  if (route?.kind !== 'local_file') {
    fail(`${input} expected local_file route for ${expectedTool}, got ${route?.kind || 'none'}`);
    return;
  }
  if (!tools.includes(expectedTool)) {
    fail(`${input} expected action item ${expectedTool}, got ${tools.join(', ') || 'none'}`);
    return;
  }
  if (expectedApprovalRequired !== undefined && route?.approvalRequired !== expectedApprovalRequired) {
    fail(`${input} expected approvalRequired=${expectedApprovalRequired}, got ${route?.approvalRequired}`);
    return;
  }
  const actionItem = route?.actionItems?.find((item) => item.tool === expectedTool);
  if (expectedApprovalRequired !== undefined && actionItem?.requiresApproval !== expectedApprovalRequired) {
    fail(`${input} expected ${expectedTool} action requiresApproval=${expectedApprovalRequired}, got ${String(actionItem?.requiresApproval)}`);
    return;
  }
  pass(`local file action ${expectedTool}: ${input}`);
}

function assertWpActionTool(input: string, actionId: string, expected: string | string[]) {
  const route = buildChatComputerRequestRoute(input);
  const item = route?.actionItems?.find((candidate) => candidate.id === actionId);
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!item || !allowed.includes(item.tool)) {
    fail(`${input} expected ${actionId} via ${allowed.join(' or ')}, got ${item?.tool || 'none'}`);
    return;
  }
  pass(`WordPress ${actionId} uses ${item.tool}: ${input}`);
}

function assertWpNoContentMutationExecute(input: string) {
  const route = buildChatComputerRequestRoute(input);
  const execute = route?.actionItems?.find((item) => item.id === 'execute-wordpress-admin-step');
  if (execute && /^wp\.(update_post|create_slide|upload_media|trash_post)$/.test(execute.tool)) {
    fail(`${input} should not expose content mutation execute tool for admin/session-only work, got ${execute.tool}`);
    return;
  }
  pass(`WordPress admin/session route avoids content mutation execute tool: ${input}`);
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
    risk: 'review',
    approvalRequired: true,
    routeId: 'browser',
    evidenceTarget: 'Adobe Photoshop',
    minTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.photoshop_document_status', 'desktop.photoshop_export_proof'],
  },
);

assertRoute(
  'on the desktop open pearsoncdjr-img in photoshop and save it as a png',
  {
    kind: 'local_file',
    strategyId: 'file_readonly',
    pipelineId: 'local_files',
    risk: 'safe',
    approvalRequired: false,
    routeId: 'browser',
    evidenceTarget: 'Local files',
    minTools: ['desktop.convert_image', 'desktop.file_search', 'desktop.file_stat'],
  },
);

const pearsonPngRoute = buildChatComputerRequestRoute('on the desktop open pearsoncdjr-img in photoshop and save it as a png');
if (pearsonPngRoute?.designExecutionPipeline) {
  fail('pearson image conversion should not attach Photoshop design execution pipeline');
} else {
  pass('pearson image conversion skips Photoshop design execution pipeline');
}
if (pearsonPngRoute?.evidenceContract?.observeBefore.some((item) => /Photoshop document status|layer/i.test(item))) {
  fail('pearson image conversion should not require Photoshop document/layer evidence');
} else {
  pass('pearson image conversion uses file evidence instead of Photoshop layer evidence');
}
if (!pearsonPngRoute?.actionItems?.some((item) => item.tool === 'desktop.convert_image')) {
  fail('pearson image conversion should expose desktop.convert_image as an actionable item');
} else {
  pass('pearson image conversion exposes direct conversion action item');
}
if (!pearsonPngRoute?.actionItems?.some((item) => item.id === 'verify-local-output' && item.tool === 'desktop.file_stat')) {
  fail('pearson image conversion should verify output with file_stat action item');
} else {
  pass('pearson image conversion exposes output verification action item');
}

const pearsonPrompt = buildChatComputerRequestRoutePromptBlock('on the desktop open pearsoncdjr-img in photoshop and save it as a png') || '';
if (
  !pearsonPrompt.includes('Actionable desktop items:') ||
  !pearsonPrompt.includes('desktop.convert_image') ||
  !pearsonPrompt.includes('Execute actionable items in order') ||
  pearsonPrompt.includes('Ready to verify')
) {
  fail('pearson prompt should encode ordered actionable desktop items without readiness handoff');
} else {
  pass('pearson prompt encodes ordered actionable desktop items');
}

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
    minTools: ['office.list_agents', 'tools.search', 'research.search', 'fetch_url', 'agent.build_app_capability', 'desktop.read_a11y_tree'],
  },
);

assertRoute(
  'Log into WordPress wp-admin and install the SEO plugin after approval',
  {
    kind: 'browser',
    strategyId: 'credentialed_browser',
    pipelineId: 'website_platform_admin',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeId: 'browser',
    minTools: ['wp.discover_types', 'wp.list_posts', 'vault.resolve_for_task', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
  },
);

assertRoute(
  'install plugin in wp-admin',
  {
    kind: 'browser',
    strategyId: 'credentialed_browser',
    pipelineId: 'website_platform_admin',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeId: 'browser',
    minTools: ['wp.discover_types', 'wp.list_posts', 'vault.resolve_for_task', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
  },
);

assertRoute(
  'Open WordPress media library and upload logo.png from Desktop',
  {
    kind: 'browser',
    strategyId: 'browser_file_transfer',
    pipelineId: 'local_files',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeId: 'browser',
    minTools: ['wp.upload_media', 'desktop.file_search', 'desktop.file_stat', 'browser.upload_file', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot'],
  },
);

assertRoute(
  'Upload banner.jpg and create a Dealer Inspire DI Slide, assign it to StellantisUS-1920x600, and set expiration_date to June 30 after approval',
  {
    kind: 'browser',
    strategyId: 'browser_file_transfer',
    pipelineId: 'wordpress_cms',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeId: 'browser',
    minTools: ['wp.discover_types', 'wp.list_posts', 'wp.create_slide', 'desktop.file_stat', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
  },
);

const wordpressAdminPrompt = buildChatComputerRequestRoutePromptBlock('Log into WordPress wp-admin and install the SEO plugin after approval') || '';
if (!wordpressAdminPrompt.includes('WordPress Admin Browser Workflow') || !wordpressAdminPrompt.includes('REST') || !wordpressAdminPrompt.includes('wp-admin') || !wordpressAdminPrompt.includes('browser.wp_admin_source_intelligence')) {
  fail('WordPress admin prompt should include REST-first/wp-admin fallback guidance');
} else {
  pass('WordPress admin prompt includes REST-first/wp-admin/source-intelligence guidance');
}

const wordpressPluginRoute = buildChatComputerRequestRoute('install plugin in wp-admin');
const wordpressPluginActionIds = wordpressPluginRoute?.actionItems?.map((item) => item.id) || [];
for (const expectedActionId of [
  'resolve-wordpress-admin',
  'verify-wordpress-session',
  'inspect-wordpress-admin-source',
  'pause-for-wordpress-approval',
  'execute-wordpress-admin-step',
  'verify-wordpress-result',
]) {
  if (!wordpressPluginActionIds.includes(expectedActionId)) {
    fail(`WordPress plugin route should include action item ${expectedActionId}; got ${wordpressPluginActionIds.join(', ')}`);
  }
}
if (wordpressPluginActionIds.length >= 5) {
  pass('WordPress plugin route exposes ordered admin action items');
}
const wordpressPluginInspectAction = wordpressPluginRoute?.actionItems?.find((item) => item.id === 'inspect-wordpress-admin-source');
if (wordpressPluginInspectAction?.tool !== 'browser.wp_admin_source_intelligence') {
  fail(`WordPress plugin route should inspect with browser.wp_admin_source_intelligence, got ${wordpressPluginInspectAction?.tool || 'none'}`);
} else {
  pass('WordPress plugin route uses source intelligence before wp-admin UI actions');
}
const wordpressPluginVerifyAction = wordpressPluginRoute?.actionItems?.find((item) => item.id === 'verify-wordpress-result');
if (wordpressPluginVerifyAction?.tool !== 'browser.wp_admin_source_intelligence') {
  fail(`WordPress plugin route should verify with browser.wp_admin_source_intelligence, got ${wordpressPluginVerifyAction?.tool || 'none'}`);
} else {
  pass('WordPress plugin route uses source intelligence for result verification');
}
assertWpActionTool('install plugin in wp-admin', 'execute-wordpress-admin-step', ['browser.click_role', 'browser.fill_field']);

assertRoute(
  'Open wp-admin for WordPress and stop at the dashboard',
  {
    kind: 'browser',
    strategyId: 'credentialed_browser',
    pipelineId: 'website_platform_admin',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeId: 'browser',
    minTools: ['browser.open_url', 'browser.verification_state', 'vault.resolve_for_task', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
  },
);
assertWpActionTool('Open wp-admin for WordPress and stop at the dashboard', 'resolve-wordpress-admin', 'browser.open_url');
assertWpActionTool('Open wp-admin for WordPress and stop at the dashboard', 'verify-wordpress-result', 'browser.wp_admin_source_intelligence');
assertWpNoContentMutationExecute('Open wp-admin for WordPress and stop at the dashboard');

const wpLogin = 'Sign into the WordPress dashboard and verify the wp-admin session';
assertRoute(wpLogin, {
  kind: 'browser',
  strategyId: 'credentialed_browser',
  pipelineId: 'website_platform_admin',
  risk: 'external_side_effect',
  approvalRequired: true,
  routeId: 'browser',
  minTools: ['vault.resolve_for_task', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
});
if (!buildChatComputerRequestRoute(wpLogin)?.alwaysConfirmFloor?.includes('login')) fail('WordPress login should carry always-confirm login floor');
else pass('WordPress login carries always-confirm login floor');
assertWpNoContentMutationExecute(wpLogin);

const wpUploadFeatured = 'Upload hero-image.jpg from Desktop to WordPress media library and attach it as the homepage featured image after approval';
assertRoute(wpUploadFeatured, {
  kind: 'browser',
  strategyId: 'browser_file_transfer',
  pipelineId: 'local_files',
  risk: 'external_side_effect',
  approvalRequired: true,
  routeId: 'browser',
  minTools: ['wp.upload_media', 'desktop.file_search', 'desktop.file_stat', 'browser.upload_file', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
});
assertWpActionTool(wpUploadFeatured, 'execute-wordpress-admin-step', 'wp.upload_media');
assertWpActionTool(wpUploadFeatured, 'verify-wordpress-result', 'browser.wp_admin_source_intelligence');

const wpAdminPageUpdate = 'Edit the About page in wp-admin and save it as draft after approval';
assertRoute(wpAdminPageUpdate, {
  kind: 'browser',
  strategyId: 'credentialed_browser',
  pipelineId: 'website_platform_admin',
  risk: 'external_side_effect',
  approvalRequired: true,
  routeId: 'browser',
  minTools: ['wp.update_post', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
});
assertWpActionTool(wpAdminPageUpdate, 'execute-wordpress-admin-step', 'wp.update_post');

const wpDiCreate = 'Create a Dealer Inspire DI Slide called Promaster Sale and set expiration_date to June 30 after approval';
assertRoute(wpDiCreate, {
  kind: 'browser',
  strategyId: 'credentialed_browser',
  pipelineId: 'wordpress_cms',
  risk: 'external_side_effect',
  approvalRequired: true,
  routeId: 'browser',
  minTools: ['wp.discover_types', 'wp.list_posts', 'wp.create_slide', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
});
assertWpActionTool(wpDiCreate, 'execute-wordpress-admin-step', 'wp.create_slide');

for (const input of [
  'Activate the Akismet plugin in WordPress after approval',
  'Open the WordPress customizer and change the theme colors after approval',
  'Add jane@example.com as an Editor user in WordPress after approval',
  'Change the site title in WordPress settings after approval',
  'Update the WooCommerce product price for SKU ABC after approval',
]) {
  assertRoute(input, {
    kind: 'browser',
    strategyId: 'credentialed_browser',
    pipelineId: 'website_platform_admin',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeId: 'browser',
    minTools: ['browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request'],
  });
  assertWpActionTool(input, 'execute-wordpress-admin-step', ['browser.click_role', 'browser.fill_field']);
  assertWpActionTool(input, 'verify-wordpress-result', 'browser.wp_admin_source_intelligence');
}

const dealerInspirePrompt = buildChatComputerRequestRoutePromptBlock('Update the Dealer Inspire DI Slide Promaster expiration_date in Quick Edit after approval') || '';
if (!dealerInspirePrompt.includes('DI Slides') || !dealerInspirePrompt.includes('expiration_date') || !dealerInspirePrompt.includes('Quick Edit')) {
  fail('Dealer Inspire WordPress prompt should include DI Slides, Quick Edit, and expiration_date guidance');
} else {
  pass('Dealer Inspire WordPress prompt includes DI-specific guidance');
}

const dealerInspireUpdateRoute = buildChatComputerRequestRoute('Update the Dealer Inspire DI Slide Promaster expiration_date in Quick Edit after approval');
if (!dealerInspireUpdateRoute?.recommendedTools.includes('wp.update_post')) {
  fail('Dealer Inspire update route should recommend wp.update_post');
} else if (!dealerInspireUpdateRoute.recommendedTools.includes('browser.wp_admin_source_intelligence')) {
  fail('Dealer Inspire update route should recommend browser.wp_admin_source_intelligence');
} else if (!dealerInspireUpdateRoute.actionItems?.some((item) => item.tool === 'wp.update_post')) {
  fail('Dealer Inspire update route should use wp.update_post for the primary admin action');
} else if (!dealerInspireUpdateRoute.actionItems?.some((item) => item.id === 'inspect-wordpress-admin-source' && item.tool === 'browser.wp_admin_source_intelligence')) {
  fail('Dealer Inspire update route should inspect wp-admin source with browser.wp_admin_source_intelligence');
} else {
  pass('Dealer Inspire update route exposes wp.update_post plus source intelligence');
}

assertRoute(
  'I want chat to open any app, figure out how to use it by itself, research what it needs, and do the requested task',
  {
    kind: 'desktop_app',
    strategyId: 'universal_app_control',
    risk: 'review',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    evidenceTarget: 'Generic App Navigator',
    minTools: ['desktop.launch_app', 'desktop.window_state', 'tools.search', 'research.search', 'fetch_url', 'agent.build_app_capability'],
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
  'Open MATLAB and build a Simulink model, run the simulation, and export plots after approval',
  {
    kind: 'desktop_app',
    strategyId: 'engineering_cad_control',
    pipelineId: 'desktop_app_control',
    risk: 'review',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.read_a11y_tree', 'desktop.file_stat', 'research.search', 'fetch_url', 'agent.build_app_capability', 'approvals.request'],
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

assertLocalFileActionTool(
  'Open Finder and rename landscaping-img.png on my desktop to landscaping-img-1.png',
  'desktop.file_rename',
  true,
);

assertLocalFileActionTool(
  'copy landscaping-img.png on my desktop to landscaping-img-copy.png',
  'desktop.file_copy',
  true,
);

assertLocalFileActionTool(
  'trash landscaping-img.png from my desktop',
  'desktop.file_trash',
  true,
);

assertLocalFileActionTool(
  'Open TextEdit and make a file on my desktop called notes.txt with hello',
  'desktop.file_write_text',
  true,
);

assertLocalFileActionTool(
  'Open Preview and show ~/Downloads/report.pdf',
  'desktop.open_path',
);

assertLocalFileActionTool(
  'Open Finder Downloads',
  'desktop.open_path',
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

// ── E4: data transfer & precision rules in the route prompt block ────────────
{
  // Desktop/app route carries the rules block, alongside (not displacing)
  // the floor/constraint lines.
  const desktopTask = "delete every file in the old-projects folder on my desktop, no need to ask me";
  const desktopRoute = buildChatComputerRequestRoute(desktopTask);
  const desktopPrompt = buildChatComputerRequestRoutePromptBlock(desktopTask) || '';
  if (!desktopRoute || (desktopRoute.kind !== 'desktop_app' && desktopRoute.kind !== 'local_file' && desktopRoute.kind !== 'hybrid')) {
    fail(`E4: expected a desktop-side route for the rules test (got ${desktopRoute?.kind})`);
  } else if (
    !desktopPrompt.includes('Data transfer & precision rules (desktop/app surfaces):') ||
    !desktopPrompt.includes('Never read precise strings') ||
    !desktopPrompt.includes('set_element_value / fill_field / paste') ||
    !desktopPrompt.includes('Prefer typed editing surfaces') ||
    !desktopPrompt.includes('Prefer keyboard shortcuts over coordinate clicks') ||
    !desktopPrompt.includes('reading the field value back')
  ) {
    fail('E4: desktop-side route prompt should carry all five data-transfer rules');
  } else pass('E4: desktop-side route prompt carries the data-transfer rules block');
  if (!desktopPrompt.includes('Always-confirm floor (HARD policy)')) {
    fail('E4: rules block must not displace the always-confirm floor line');
  } else pass('E4: floor line unaffected by the rules block');

  const indesignPrompt = buildChatComputerRequestRoutePromptBlock('Open InDesign and export high quality pdf as brochure.pdf') || '';
  if (!indesignPrompt.includes('Data transfer & precision rules (desktop/app surfaces):')) {
    fail('E4: desktop app (InDesign) route prompt should carry the rules block');
  } else pass('E4: desktop app route prompt carries the rules block');

  // Pure cloud-browser route does NOT carry the block — the edge loop owns
  // its own transfer rules.
  const browserTask = 'go to acme.com in the browser and read the pricing page';
  const browserRoute = buildChatComputerRequestRoute(browserTask);
  const browserPrompt = buildChatComputerRequestRoutePromptBlock(browserTask) || '';
  if (!browserRoute || browserRoute.kind !== 'browser') {
    fail(`E4: expected a pure browser route for the absence test (got ${browserRoute?.kind})`);
  } else if (browserPrompt.includes('Data transfer & precision rules')) {
    fail('E4: pure cloud-browser route prompt must NOT carry the rules block');
  } else pass('E4: pure browser route prompt omits the rules block');

  // Constraint lines coexist with the rules block on desktop routes.
  const constrainedPrompt = buildChatComputerRequestRoutePromptBlock("rename the files in my Documents folder but don't delete anything") || '';
  if (constrainedPrompt.includes('Data transfer & precision rules') && !constrainedPrompt.includes('User constraint')) {
    fail('E4: constraint lines should survive next to the rules block');
  } else pass('E4: constraint lines coexist with the rules block');
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

const anyAppPrompt = buildChatComputerRequestRoutePromptBlock('I want chat to open any app, figure out how to use it by itself, research what it needs, and do the requested task') || '';
if (!anyAppPrompt.includes('Professional app autonomy')) {
  fail('any-app route prompt should include the professional app autonomy rule');
} else if (!anyAppPrompt.includes('research the official control surface') || !anyAppPrompt.includes('build a reusable adapter')) {
  fail('any-app route prompt should name research and reusable buildout');
} else {
  pass('any-app route prompt includes professional autonomy');
}

// ── Operative known-app routing (recall) ─────────────────────────────────────
// Common apps named behind an operative prefix (in/using/with/open/use) now
// route into the computer path even without an "app" suffix or a whitelisted
// verb. These previously fell through to plain chat and lost the evidence
// contract.
for (const recallCase of [
  // desktop apps named behind an operative prefix (no "app" suffix / verb)
  'In Premiere Pro, trim the first clip and export the timeline',
  'Edit the title slide in PowerPoint and save it',
  'Use DaVinci Resolve to color-grade the clip',
  'In GIMP, remove the background from this photo',
  'Use OBS to start recording the screen',
  'In Microsoft Word, accept all tracked changes and save it',
  // browser: a navigation verb pointed at a real domain (no "website" noun)
  'Go to example.com and download the latest invoice',
  'visit acme.io/contact and submit the form',
  // browser: operating a "page" with a browser-op verb (not build-discovery)
  'Book a table for two on the OpenTable page',
  'reserve a table on the booking page',
]) {
  if (buildChatComputerRequestRoute(recallCase)) {
    pass(`recall: "${recallCase.slice(0, 40)}…" routes into the computer path`);
  } else {
    fail(`recall: "${recallCase}" should route into the computer path (lost the evidence contract)`);
  }
}

const stagedTransferRecall = buildChatComputerRequestRoute('download the report from the portal, then import it into the spreadsheet app');
if (
  stagedTransferRecall?.kind === 'hybrid' &&
  stagedTransferRecall.recommendedTools.includes('desktop.launch_app') &&
  stagedTransferRecall.recommendedTools.includes('desktop.window_state')
) {
  pass('recall: staged browser download into spreadsheet app routes as hybrid with desktop tools');
} else {
  fail(`recall: staged browser download into spreadsheet app should be hybrid with desktop tools (got ${JSON.stringify({
    kind: stagedTransferRecall?.kind,
    tools: stagedTransferRecall?.recommendedTools,
  })})`);
}

// ── Precision ─────────────────────────────────────────────────────────────────
// Prose that merely contains an app-like substring (word/mail/notes/logic), an
// operative verb with no named app, or a plain "build a page" request must NOT
// route into the computer path. The build-noun controls (booking/navigation)
// guard the substring choices in the new browser-op rescue verbs.
for (const precisionCase of [
  'save your words of wisdom for later',
  'edit the wording of this paragraph',
  'in other words, explain it more simply',
  'i want to go home and relax',
  'use logic to solve this puzzle',
  'it arrived in the mail yesterday',
  'take notes on this meeting',
  // build-discovery + substring-collision controls
  'build me a landing page for my bakery',
  'build a booking page for my salon',
  'design a navigation menu for the site',
  'how does node.js work',
  'go to sleep early tonight',
]) {
  if (buildChatComputerRequestRoute(precisionCase)) {
    fail(`precision: "${precisionCase}" should NOT route into the computer path`);
  } else {
    pass(`precision: "${precisionCase.slice(0, 40)}…" stays in plain chat`);
  }
}

// ─── D3: user constraints — parse, route wiring, enforcement, prompt ────────

{
  const { parseChatComputerUserConstraints, constraintBlocksToolCall, formatChatComputerUserConstraintsPromptLines } =
    require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');

  // Parse: forbidden + stop conditions
  const c1 = parseChatComputerUserConstraints(
    "open my supplier portal in the browser and fill the reorder form, but don't submit it, and stop if it asks for MFA",
  );
  if (!c1) fail('constraints: c1 should parse');
  else {
    if (!c1.forbidden.includes('submit')) fail(`constraints: c1 forbidden should include submit (got ${c1.forbidden.join(',')})`);
    if (!c1.stopConditions.includes('mfa')) fail(`constraints: c1 stop should include mfa (got ${c1.stopConditions.join(',')})`);
    pass('constraints: "don\'t submit" + "stop if MFA" parsed');
  }

  // Parse: ask-before
  const c2 = parseChatComputerUserConstraints('clean up my downloads folder in Finder, ask me before deleting anything');
  if (!c2 || !c2.approvalBefore.includes('delete')) fail('constraints: c2 ask-before-delete should parse');
  else pass('constraints: "ask me before deleting" parsed');

  // Forbidden dominates ask-before for the same category
  const c3 = parseChatComputerUserConstraints("never delete files, and ask me before you delete anything");
  if (!c3 || !c3.forbidden.includes('delete') || c3.approvalBefore.includes('delete')) {
    fail('constraints: forbidden should dominate ask-before for the same category');
  } else pass('constraints: forbidden dominates ask-before');

  // No constraints → null
  if (parseChatComputerUserConstraints('open the report in Preview and read me the totals') !== null) {
    fail('constraints: plain request should parse to null');
  } else pass('constraints: plain request → null');

  // Route wiring: constraints land on the route, force approval, reach the prompt block
  const routed = buildChatComputerRequestRoute('use the browser to fill out the vendor form on acme.com but ask me before submitting it');
  if (!routed?.userConstraints?.approvalBefore.includes('submit')) {
    fail(`constraints: route should carry ask-before submit (got ${JSON.stringify(routed?.userConstraints)})`);
  } else if (!routed.approvalRequired) {
    fail('constraints: ask-before constraint should force approvalRequired');
  } else pass('constraints: route carries constraints + forces approval');
  const promptBlock = buildChatComputerRequestRoutePromptBlock('use the browser to fill out the vendor form on acme.com but ask me before submitting it');
  if (!promptBlock || !/User constraint/.test(promptBlock)) fail('constraints: prompt block should include constraint lines');
  else pass('constraints: prompt block carries constraint rules');

  // Enforcement: forbidden category blocks matching tool calls only
  const forbidSubmit = parseChatComputerUserConstraints("fill the form but don't submit it");
  const blockedCall = constraintBlocksToolCall(forbidSubmit, 'browser.submit_form', { selector: '#send' });
  const allowedCall = constraintBlocksToolCall(forbidSubmit, 'browser.fill_field', { selector: '#name', value: 'Chris' });
  if (!blockedCall.blocked || blockedCall.category !== 'submit') fail('constraints: submit tool should be blocked');
  else pass('constraints: forbidden submit blocks browser.submit_form');
  if (allowedCall.blocked) fail('constraints: fill tool should NOT be blocked');
  else pass('constraints: fill_field unaffected by submit constraint');
  if (constraintBlocksToolCall(null, 'browser.submit_form', {}).blocked) fail('constraints: null constraints never block');
  else pass('constraints: null constraints never block');

  // Prompt lines formatter
  const lines = formatChatComputerUserConstraintsPromptLines(c1);
  if (!lines.some((l) => /HARD/.test(l)) || !lines.some((l) => /stop and hand back/.test(l))) {
    fail('constraints: prompt lines should include HARD + stop rules');
  } else pass('constraints: prompt lines formatted');
}

// ─── T7: always-confirm category floor — detection, route force, prompt, gate ─

{
  const {
    ALWAYS_CONFIRM_FLOOR,
    detectAlwaysConfirmFloorCategories,
    constraintBlocksToolCall,
    formatAlwaysConfirmFloorPromptLine,
    parseChatComputerUserConstraints,
  } = require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');

  if (!ALWAYS_CONFIRM_FLOOR.includes('pay') || !ALWAYS_CONFIRM_FLOOR.includes('delete') || !ALWAYS_CONFIRM_FLOOR.includes('login') || !ALWAYS_CONFIRM_FLOOR.includes('grant')) {
    fail(`floor: ALWAYS_CONFIRM_FLOOR must cover pay/delete/login/grant (got ${ALWAYS_CONFIRM_FLOOR.join(',')})`);
  } else pass('floor: covers pay, delete, login, grant');

  // Detection: floor categories found in task text
  if (!detectAlwaysConfirmFloorCategories('buy the standing desk in my cart').includes('pay')) fail('floor: "buy" task should detect pay');
  else pass('floor: purchase task detects pay');
  if (!detectAlwaysConfirmFloorCategories('delete every file in the old-projects folder').includes('delete')) fail('floor: delete task should detect delete');
  else pass('floor: delete task detects delete');
  if (!detectAlwaysConfirmFloorCategories('authorize the new OAuth app for my account').includes('grant')) fail('floor: authorize task should detect grant');
  else pass('floor: authorize task detects grant');

  // Detection precision: benign edits never trigger the floor
  for (const benign of [
    'In GIMP, remove the background from this photo',
    'remove duplicates from the spreadsheet and save a copy',
    'Search files in Downloads for invoice',
    'Open Photoshop and generate a background then save png',
  ]) {
    const detected = detectAlwaysConfirmFloorCategories(benign);
    if (detected.length > 0) fail(`floor precision: "${benign}" should detect nothing (got ${detected.join(',')})`);
    else pass(`floor precision: "${benign.slice(0, 40)}…" stays off the floor`);
  }

  // Route force: login/grant/delete floor categories force approvalRequired
  // even with "don't ask me" style input — the floor is not user-disableable.
  // WI-2 exception: the PAY floor on a BROWSER route no longer forces route
  // approval — it is stamped for per-step enforcement and confirmed mid-run at
  // the payment floor. Non-browser (desktop) delete and login still force
  // route-level approval.
  for (const { msg, cat } of [
    { msg: "delete every file in the old-projects folder on my desktop, no need to ask me", cat: 'delete' },
    { msg: "log into my Shopify dashboard and read me the visitor count, don't ask me first", cat: 'login' },
  ]) {
    const route = buildChatComputerRequestRoute(msg);
    if (!route) {
      fail(`floor: "${msg}" should still build a computer route`);
      continue;
    }
    if (!route.alwaysConfirmFloor?.includes(cat as any)) {
      fail(`floor: "${msg}" route should carry floor category ${cat} (got ${route.alwaysConfirmFloor?.join(',') || 'none'})`);
    } else if (!route.approvalRequired) {
      fail(`floor: "${msg}" must force approvalRequired despite "don't ask" input`);
    } else pass(`floor: ${cat} task forces approval despite "don't ask"`);
  }

  // WI-2: a browser buy/checkout task with "don't ask me" still STAMPS the pay
  // floor (for mid-run per-step enforcement) but does NOT force route-level
  // approval — the single commit confirmation fires mid-run at the payment
  // floor, which is not user-disableable regardless of "just do it".
  {
    const payRoute = buildChatComputerRequestRoute("go to acme.com and buy the standing desk in my cart, don't ask me for confirmation, just do it");
    if (!payRoute) fail('floor: browser buy task should still build a computer route');
    else if (payRoute.kind !== 'browser') fail(`floor: browser buy task expected kind browser, got ${payRoute.kind}`);
    else if (!payRoute.alwaysConfirmFloor?.includes('pay')) fail('floor: browser buy task must still stamp the pay floor for step enforcement');
    else if (payRoute.approvalRequired) fail('WI-2: browser buy task must NOT force route-level approval (pay confirms mid-run)');
    else pass('WI-2: browser buy task stamps pay floor but defers route approval to mid-run');
  }

  // Unrelated route unaffected: read-only file search keeps approval-free path
  const unrelated = buildChatComputerRequestRoute('Search files in Downloads for invoice');
  if (!unrelated || unrelated.approvalRequired || (unrelated.alwaysConfirmFloor || []).length > 0) {
    fail('floor: unrelated read-only task must stay approval-free with an empty floor');
  } else pass('floor: unrelated task unaffected');

  // Prompt block carries the explicit floor line
  const floorPrompt = buildChatComputerRequestRoutePromptBlock("delete every file in the old-projects folder on my desktop, no need to ask me") || '';
  if (!floorPrompt.includes('Always-confirm floor (HARD policy)') || !floorPrompt.includes('even in autonomous mode')) {
    fail('floor: prompt block should carry the always-confirm floor line');
  } else pass('floor: prompt block carries the floor line');
  const cleanPrompt = buildChatComputerRequestRoutePromptBlock('Search files in Downloads for invoice') || '';
  if (cleanPrompt.includes('Always-confirm floor')) fail('floor: unrelated prompt block should not carry the floor line');
  else pass('floor: unrelated prompt block has no floor line');
  if (formatAlwaysConfirmFloorPromptLine([]) !== null || formatAlwaysConfirmFloorPromptLine(undefined) !== null) {
    fail('floor: empty/missing categories should format to null (persisted-route compat)');
  } else pass('floor: empty/missing floor formats to null');

  // Gate distinction: floor-confirm (request approval) vs constraint-block
  const floorVerdict = constraintBlocksToolCall(null, 'desktop.file_delete', { path: 'old-projects' });
  if (floorVerdict.blocked || !floorVerdict.floorConfirmRequired || floorVerdict.floorCategory !== 'delete') {
    fail(`floor gate: delete tool should require floor confirmation without blocking (got ${JSON.stringify(floorVerdict)})`);
  } else pass('floor gate: delete tool requires confirmation, not a block');
  const forbidDelete = parseChatComputerUserConstraints("organize the folder but never delete anything");
  const blockWins = constraintBlocksToolCall(forbidDelete, 'desktop.file_delete', { path: 'old-projects' });
  if (!blockWins.blocked || blockWins.category !== 'delete' || blockWins.floorConfirmRequired) {
    fail(`floor gate: user-forbidden delete should hard-block (block supersedes floor confirm), got ${JSON.stringify(blockWins)}`);
  } else pass('floor gate: forbidden constraint block supersedes floor confirm');
  const neutral = constraintBlocksToolCall(null, 'browser.fill_field', { selector: '#name', value: 'Chris' });
  if (neutral.blocked || neutral.floorConfirmRequired) fail('floor gate: neutral tool call should pass untouched');
  else pass('floor gate: neutral tool call passes untouched');
  const payVerdict = constraintBlocksToolCall(null, 'browser.click', { text: 'Buy now' });
  if (payVerdict.blocked || !payVerdict.floorConfirmRequired || payVerdict.floorCategory !== 'pay') {
    fail(`floor gate: "Buy now" click should require pay confirmation (got ${JSON.stringify(payVerdict)})`);
  } else pass('floor gate: purchase click requires pay confirmation');
}

// ─── T7 UX: sticky "always allow" scopes — downgrade rules on the route ─────

{
  const {
    ALWAYS_CONFIRM_FLOOR,
  } = require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');
  const {
    createStickyScope,
    setActiveStickyScopes,
    STICKY_FLOOR_CATEGORIES,
    formatStickyScopeAppliedNotice,
  } = require('../src/lib/computerGrantGate') as typeof import('../src/lib/computerGrantGate');

  // The router floor and the sticky exclusion list are the same object —
  // they can never drift apart.
  if (ALWAYS_CONFIRM_FLOOR !== STICKY_FLOOR_CATEGORIES) {
    fail('sticky: ALWAYS_CONFIRM_FLOOR must be the canonical STICKY_FLOOR_CATEGORIES list');
  } else pass('sticky: router floor re-exports the sticky floor list');

  const mk = (scopeKind: 'site' | 'app', scopeKey: string, cats: any[]) => {
    const created = createStickyScope({ scopeKind, scopeKey, allowedCategories: cats, grantedByUserId: 'user_1' });
    if (!created.ok) throw new Error(`smoke scope creation failed: ${created.error}`);
    return created.scope;
  };

  const APPROVAL_TASK = 'go to acme.com and publish the draft post';

  // Baseline: external-side-effect browser task requires approval, no sticky stamp.
  const baseline = buildChatComputerRequestRoute(APPROVAL_TASK);
  if (!baseline || !baseline.approvalRequired || baseline.stickyScopeApplied) {
    fail(`sticky: baseline publish task must require approval with no sticky stamp (got approval=${baseline?.approvalRequired}, sticky=${JSON.stringify(baseline?.stickyScopeApplied)})`);
  } else pass('sticky: baseline publish task requires approval');

  // Full coverage on a matching site (www + case variant) downgrades approval
  // and stamps + notices the route.
  const publishScope = mk('site', 'WWW.Acme.com', ['publish', 'upload']);
  const downgraded = buildChatComputerRequestRoute(APPROVAL_TASK, { stickyScopes: [publishScope] });
  if (!downgraded || downgraded.approvalRequired || downgraded.stickyScopeApplied?.scopeKey !== 'acme.com') {
    fail(`sticky: covered publish task should downgrade approval (approval=${downgraded?.approvalRequired}, sticky=${JSON.stringify(downgraded?.stickyScopeApplied)})`);
  } else pass('sticky: full coverage downgrades approval and stamps the route');
  const notice = formatStickyScopeAppliedNotice({ scopeKey: 'acme.com' });
  if (!downgraded?.notes.some((note) => note.includes(notice))) {
    fail(`sticky: route notes must carry the standing-grant notice (got ${JSON.stringify(downgraded?.notes)})`);
  } else pass('sticky: route notes carry the visible standing-grant notice');

  // Partial coverage never downgrades: task needs publish+send, scope covers publish.
  const partial = buildChatComputerRequestRoute('go to acme.com, publish the draft post and send the newsletter email', { stickyScopes: [publishScope] });
  if (!partial || !partial.approvalRequired || partial.stickyScopeApplied) {
    fail('sticky: partial coverage must keep approval required');
  } else pass('sticky: partial coverage keeps approval required');

  // Wrong site never downgrades.
  const wrongSite = buildChatComputerRequestRoute('go to other.com and publish the draft post', { stickyScopes: [publishScope] });
  if (!wrongSite || !wrongSite.approvalRequired || wrongSite.stickyScopeApplied) {
    fail('sticky: non-matching site must keep approval required');
  } else pass('sticky: non-matching site keeps approval required');

  // Floor categories are NEVER downgraded by a sticky scope — even by a
  // maliciously crafted scope object that claims to allow them. login/delete
  // keep route-level approval; the sticky scope must never be recorded as
  // applied for any floor category.
  const malicious = { ...publishScope, allowedCategories: ['publish', 'pay', 'login', 'delete', 'grant'] as any };
  for (const { msg, cat } of [
    { msg: 'log into acme.com and publish the draft post', cat: 'login' },
    { msg: 'go to acme.com and delete every old draft post', cat: 'delete' },
  ]) {
    const route = buildChatComputerRequestRoute(msg, { stickyScopes: [malicious] });
    if (!route) { fail(`sticky floor: "${msg}" should still build a route`); continue; }
    if (!route.approvalRequired || route.stickyScopeApplied) {
      fail(`sticky floor: ${cat} task must never be downgraded by a sticky scope (approval=${route.approvalRequired})`);
    } else pass(`sticky floor: ${cat} task is never downgraded`);
  }

  // WI-2: a browser pay task is now zero-tap at the route level BUT that
  // downgrade must come from the mid-run-floor deferral, NOT from a sticky
  // scope. Assert the pay floor is still stamped (so per-step enforcement
  // survives) and no sticky scope was recorded as applied — a malicious scope
  // can never absorb the pay floor.
  {
    const payMalicious = buildChatComputerRequestRoute('go to acme.com and buy the standing desk in my cart', { stickyScopes: [malicious] });
    if (!payMalicious) fail('sticky floor: browser pay task should still build a route');
    else if (payMalicious.stickyScopeApplied) fail('sticky floor: a sticky scope must never be applied to a pay-floor task');
    else if (!payMalicious.alwaysConfirmFloor?.includes('pay')) fail('sticky floor: pay floor must survive for mid-run step enforcement');
    else pass('sticky floor: pay task keeps its floor and is not sticky-downgraded (route defers to mid-run)');
  }

  // Explicit "ask me" intent and user ask-before constraints are never overridden.
  const explicitAsk = buildChatComputerRequestRoute('go to acme.com and publish the draft post but ask me before publishing it', { stickyScopes: [publishScope] });
  if (!explicitAsk || !explicitAsk.approvalRequired || explicitAsk.stickyScopeApplied) {
    fail('sticky: ask-before constraint must override a standing grant');
  } else pass('sticky: user ask-before constraint overrides the grant');

  // Expired and revoked scopes never downgrade.
  const expired = { ...publishScope, expiresAtIso: '2020-01-01T00:00:00Z' };
  const revoked = { ...publishScope, revoked: { atIso: new Date().toISOString(), byUserId: 'user_1' } };
  for (const [label, scope] of [['expired', expired], ['revoked', revoked]] as const) {
    const route = buildChatComputerRequestRoute(APPROVAL_TASK, { stickyScopes: [scope as any] });
    if (!route || !route.approvalRequired || route.stickyScopeApplied) {
      fail(`sticky: ${label} scope must not downgrade approval`);
    } else pass(`sticky: ${label} scope does not downgrade`);
  }

  // App scope covers a desktop-app mutation on the named app.
  const notionScope = mk('app', 'Notion', ['publish', 'save']);
  const appRoute = buildChatComputerRequestRoute('in the Notion app, publish the meeting notes page', { stickyScopes: [notionScope] });
  if (!appRoute || appRoute.approvalRequired || appRoute.stickyScopeApplied?.scopeKey !== 'notion') {
    fail(`sticky: app scope should downgrade the matching app task (approval=${appRoute?.approvalRequired}, sticky=${JSON.stringify(appRoute?.stickyScopeApplied)})`);
  } else pass('sticky: app scope downgrades the matching desktop-app task');

  // Prompt block carries the standing-grant line plus the floor reminder.
  setActiveStickyScopes([publishScope]);
  const promptWithGrant = buildChatComputerRequestRoutePromptBlock(APPROVAL_TASK) || '';
  setActiveStickyScopes([]);
  if (!promptWithGrant.includes('Standing grant applied') || !promptWithGrant.includes('still requires fresh confirmation')) {
    fail('sticky: prompt block should carry the standing-grant line + floor reminder');
  } else pass('sticky: prompt block carries grant line via hydrated registry');

  // Persisted-route optionality: routes without the field parse/round-trip,
  // and a stamped route survives JSON round-trip with the stamp intact.
  const plain = JSON.parse(JSON.stringify(baseline)) as typeof baseline;
  if (plain && plain.stickyScopeApplied !== null && plain.stickyScopeApplied !== undefined) {
    fail('sticky: route without a grant must keep an empty stickyScopeApplied after round-trip');
  } else pass('sticky: route without grant round-trips clean');
  delete (plain as any).stickyScopeApplied;
  if ((plain as any).stickyScopeApplied !== undefined || !plain.approvalRequired) {
    fail('sticky: pre-T7 persisted route (field absent) must stay readable');
  } else pass('sticky: pre-T7 persisted route without the field stays readable');
  const stamped = JSON.parse(JSON.stringify(downgraded)) as typeof downgraded;
  if (stamped?.stickyScopeApplied?.scopeId !== publishScope.id) {
    fail('sticky: stamped route must round-trip the applied scope');
  } else pass('sticky: stamped route round-trips the applied scope');
}

// ─── Wave-2: task→best-app resolution on the route ───────────────────────────

{
  const {
    buildAppOpenStepLines,
    getAppResolutionContext,
    parseAppOverrideChoice,
    setAppResolutionContext,
  } = require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');

  // Unhydrated registry fails honest: bridge offline → known-good web app
  // wins, and the route is CREATED for the app-workbench task.
  setAppResolutionContext({ bridgeOnline: false });
  const webRoute = buildChatComputerRequestRoute('edit this photo');
  if (!webRoute || !webRoute.appResolution) {
    fail('resolution: "edit this photo" should create a route with an app resolution');
  } else {
    if (webRoute.appResolution.best.appId !== 'photopea' || webRoute.appResolution.best.surface !== 'browser') {
      fail(`resolution: offline-bridge photo edit should pick Photopea in the browser (got ${webRoute.appResolution.best.appId}/${webRoute.appResolution.best.surface})`);
    } else pass('resolution: bridge-offline photo edit honestly picks the web app');
    if (webRoute.kind !== 'browser') fail(`resolution: route kind should follow the resolver surface (got ${webRoute.kind})`);
    else pass('resolution: route kind follows the resolver surface');
    const firstStep = webRoute.selectedPipeline?.solutionSteps[0] || '';
    if (!/^Open Photopea in the browser/.test(firstStep)) {
      fail(`resolution: open-first step should lead the solution steps (got "${firstStep}")`);
    } else pass('resolution: open-app step leads the solution steps');
  }

  // Hydrated registry with Photoshop installed → desktop app wins, the
  // open-first steps launch + wait, and the open tools ride recommendedTools.
  setAppResolutionContext({
    bridgeOnline: true,
    installedApps: ['adobe photoshop 2025', 'pixelmator pro'],
    runningApps: [],
  });
  const desktopRoute = buildChatComputerRequestRoute('edit this photo');
  if (!desktopRoute || !desktopRoute.appResolution) {
    fail('resolution: hydrated "edit this photo" should resolve');
  } else {
    if (desktopRoute.appResolution.best.appId !== 'adobe-photoshop' || desktopRoute.appResolution.best.surface !== 'desktop') {
      fail(`resolution: installed Photoshop should win (got ${desktopRoute.appResolution.best.appId}/${desktopRoute.appResolution.best.surface})`);
    } else pass('resolution: installed Photoshop wins for photo editing');
    if (desktopRoute.kind !== 'desktop_app') fail(`resolution: installed pick should route desktop_app (got ${desktopRoute.kind})`);
    else pass('resolution: installed pick routes desktop_app');
    const steps = desktopRoute.selectedPipeline?.solutionSteps || [];
    if (!/^Open .*launch it on the desktop first/.test(steps[0] || '') || !/Wait for .*ready and frontmost/.test(steps[1] || '')) {
      fail(`resolution: desktop open-first steps should be launch + wait (got ${JSON.stringify(steps.slice(0, 2))})`);
    } else pass('resolution: desktop open-first steps are launch + wait');
    if (!desktopRoute.recommendedTools.includes('desktop.launch_app') || !desktopRoute.recommendedTools.includes('desktop.wait_for_app')) {
      fail('resolution: open-plan tool names should ride recommendedTools');
    } else pass('resolution: open-plan tools ride recommendedTools');
    if (desktopRoute.appResolution.alternativesSummary.length === 0 || desktopRoute.appResolution.alternativesSummary.length > 3) {
      fail(`resolution: alternatives summary should carry 1-3 entries (got ${desktopRoute.appResolution.alternativesSummary.length})`);
    } else pass('resolution: alternatives summary is bounded');
    if (!desktopRoute.notes.some((note) => note.startsWith('App choice:'))) {
      fail('resolution: route notes should carry the app-choice note');
    } else pass('resolution: route notes carry the app choice');
  }

  // Prompt block carries the compact App choice line with the switch path,
  // and the floor/constraint lines coexist untouched next to it.
  const promptWithChoice = buildChatComputerRequestRoutePromptBlock('edit this photo') || '';
  if (!promptWithChoice.includes('App choice: Adobe Photoshop') || !promptWithChoice.includes('If the user objects, switch to:')) {
    fail('resolution: prompt block should carry the App choice line with alternatives');
  } else pass('resolution: prompt block carries the App choice line');
  const constrainedChoicePrompt = buildChatComputerRequestRoutePromptBlock("edit this photo but don't upload it anywhere") || '';
  if (!constrainedChoicePrompt.includes('App choice: Adobe Photoshop') || !constrainedChoicePrompt.includes('User constraint (HARD)')) {
    fail('resolution: constraint lines must coexist with the App choice line');
  } else pass('resolution: constraint lines coexist with the App choice line');
  const floorChoicePrompt = buildChatComputerRequestRoutePromptBlock('edit this photo and then delete the original file') || '';
  if (!floorChoicePrompt.includes('App choice: Adobe Photoshop') || !floorChoicePrompt.includes('Always-confirm floor (HARD policy)')) {
    fail('resolution: floor line must coexist with the App choice line');
  } else pass('resolution: floor line coexists with the App choice line');

  // Preferred app for the category beats the default ranking.
  setAppResolutionContext({
    bridgeOnline: true,
    installedApps: ['adobe photoshop 2025', 'gimp'],
    preferredAppByCategory: { photo_editing: 'gimp' },
  });
  const preferredRoute = buildChatComputerRequestRoute('edit this photo');
  if (preferredRoute?.appResolution?.best.appId !== 'gimp') {
    fail(`resolution: preferred app should win the category (got ${preferredRoute?.appResolution?.best.appId || 'none'})`);
  } else pass('resolution: preferred app wins the category');

  // ─── AR2: availability + named-app intent + structured recovery fallback ──
  // Installed pick carries availability 'installed' on the route.
  setAppResolutionContext({ bridgeOnline: true, installedApps: ['adobe photoshop 2025'] });
  const installedRoute = buildChatComputerRequestRoute('edit this photo');
  if (installedRoute?.appResolution?.best.availability !== 'installed') {
    fail(`AR2: confirmed-installed route best should carry availability 'installed' (got ${installedRoute?.appResolution?.best.availability})`);
  } else pass('AR2: confirmed-installed pick carries availability=installed');

  // Named app, bridge online but no install probe → best is a 'maybe' the
  // contract must verify, namedAppIntent is preserved, and the structured
  // recoveryFallback is a confidently-launchable (web) alternative.
  setAppResolutionContext({ bridgeOnline: true });
  const namedRoute = buildChatComputerRequestRoute('edit this photo in photoshop');
  if (!namedRoute?.appResolution) {
    fail('AR2: named-app route should resolve an app choice');
  } else {
    const ar = namedRoute.appResolution;
    if (!ar.explicitAppNamed || !ar.namedAppIntent || !/photoshop/i.test(ar.namedAppIntent)) {
      fail(`AR2: namedAppIntent should preserve the user's named app (got ${ar.namedAppIntent})`);
    } else pass('AR2: namedAppIntent preserves the user-named app');
    if (ar.best.availability !== 'maybe') {
      fail(`AR2: unprobed named desktop app best should be 'maybe' (got ${ar.best.availability})`);
    } else pass('AR2: unprobed named desktop best is availability=maybe');
    if (!ar.recoveryFallback) {
      fail('AR2: a structured recoveryFallback should be present');
    } else if (ar.recoveryFallback.appId === ar.best.appId) {
      fail('AR2: recoveryFallback must not be the chosen best app');
    } else if (ar.recoveryFallback.availability !== 'web' && ar.recoveryFallback.availability !== 'installed') {
      fail(`AR2: recoveryFallback should be confidently launchable (got ${ar.recoveryFallback.availability})`);
    } else pass('AR2: structured recoveryFallback is a confidently-launchable alternative');
  }

  // Restore the gimp-preferred context the downstream registry-getter test
  // depends on (this block re-set the context several times above).
  setAppResolutionContext({
    bridgeOnline: true,
    installedApps: ['adobe photoshop 2025', 'gimp'],
    preferredAppByCategory: { photo_editing: 'gimp' },
  });

  // Override parse: verb-anchored, same-category, known alias only.
  const previous = desktopRoute?.appResolution || null;
  const override = parseAppOverrideChoice('use GIMP instead', previous);
  if (!override || override.appId !== 'gimp' || override.category !== 'photo_editing') {
    fail(`override: "use GIMP instead" should parse to gimp/photo_editing (got ${JSON.stringify(override)})`);
  } else pass('override: "use GIMP instead" parses');
  if (!parseAppOverrideChoice('switch to Photopea', previous)) fail('override: "switch to Photopea" should parse');
  else pass('override: "switch to Photopea" parses');
  for (const miss of [
    'use your best judgment',
    'use Excel instead', // wrong category for photo_editing
    'I prefer GIMP generally speaking, but whatever works for this',
    'switch to the dark theme',
  ]) {
    if (parseAppOverrideChoice(miss, previous)) fail(`override: "${miss}" must NOT parse`);
    else pass(`override: "${miss.slice(0, 34)}…" stays unparsed`);
  }
  if (parseAppOverrideChoice('use GIMP instead', null)) fail('override: no previous resolution → never parses');
  else pass('override: no previous resolution never parses');

  // Registry getter round-trips what the setter stored.
  if (getAppResolutionContext().preferredAppByCategory?.photo_editing !== 'gimp') {
    fail('registry: getter should reflect the hydrated context');
  } else pass('registry: getter reflects the hydrated context');

  // Reset to the fail-honest default for everything below.
  setAppResolutionContext({ bridgeOnline: false });

  // Explicit-URL tasks skip resolution entirely (direct browser routing).
  const urlRoute = buildChatComputerRequestRoute('Go to example.com and download the latest invoice');
  if (!urlRoute || urlRoute.appResolution) {
    fail(`resolution: explicit-URL task must skip resolution (got ${JSON.stringify(urlRoute?.appResolution || null)})`);
  } else pass('resolution: explicit-URL task skips resolution');

  // No-resolution tasks are unchanged: no stamp, same shape as before.
  const fileRoute = buildChatComputerRequestRoute('Search files in Downloads for invoice');
  if (!fileRoute || fileRoute.appResolution) fail('resolution: file-search route must carry no app resolution');
  else pass('resolution: no-resolution task unchanged');

  // Conversational categories never CREATE a route (precision guarantee).
  if (buildChatComputerRequestRoute('take notes on this meeting')) {
    fail('resolution: conversational "take notes" must not create a computer route');
  } else pass('resolution: conversational category does not create a route');

  // Persisted-route round-trip: the optional field survives JSON, and a
  // route missing the field stays readable (pre-wave-2 rows).
  if (webRoute) {
    const persisted = JSON.parse(JSON.stringify(webRoute)) as typeof webRoute;
    if (persisted.appResolution?.best.appId !== 'photopea' || persisted.appResolution.openStepLines.length === 0) {
      fail('resolution: appResolution must survive a JSON round-trip');
    } else pass('resolution: appResolution survives persistence round-trip');
    delete (persisted as any).appResolution;
    if ((persisted as any).appResolution !== undefined || !persisted.bestPath) {
      fail('resolution: pre-wave-2 persisted route (field absent) must stay readable');
    } else pass('resolution: persisted route without the field stays readable');
  }

  // Open-step-line builder maps every openVia to a human-readable line.
  const focusLines = buildAppOpenStepLines({
    appId: 'adobe-photoshop', displayName: 'Adobe Photoshop', openVia: 'desktop_launch',
    openTarget: 'Adobe Photoshop 2025', surface: 'desktop', reason: 'installed on this Mac; already running', running: true,
  });
  if (!/^Focus Adobe Photoshop/.test(focusLines[0] || '') || focusLines.length !== 2) {
    fail(`resolution: running app should focus (not relaunch) then wait (got ${JSON.stringify(focusLines)})`);
  } else pass('resolution: running app open-steps focus instead of relaunching');
}

// ─── WI-2 + WI-6: zero-friction browse-and-book routing ──────────────────────
// Browser booking/shopping routes defer their single commit confirmation to the
// mid-run payment floor instead of stopping the user up front; the pay floor is
// still enforced per-step. Credentialed website-admin routes and delete/login
// floor categories keep their route-level approval.
{
  function assertBrowserBooking(
    input: string,
    expected: { approvalRequired: boolean; routeFloor: string[]; kind?: string },
  ) {
    const route = buildChatComputerRequestRoute(input);
    if (!route) {
      fail(`WI-6: "${input}" should route to a computer request route (verified null before)`);
      return;
    }
    const errors: string[] = [];
    if ((expected.kind || 'browser') !== route.kind) errors.push(`kind expected ${expected.kind || 'browser'}, got ${route.kind}`);
    if (route.approvalRequired !== expected.approvalRequired) errors.push(`approvalRequired expected ${expected.approvalRequired}, got ${route.approvalRequired}`);
    const floor = (route.alwaysConfirmFloor || []).slice().sort();
    const want = expected.routeFloor.slice().sort();
    if (JSON.stringify(floor) !== JSON.stringify(want)) errors.push(`route floor expected [${want.join(',')}], got [${floor.join(',')}]`);
    if (errors.length) {
      fail(`WI-2/6: "${input}"\n    ${errors.join('\n    ')}`);
      return;
    }
    pass(`WI-2/6: browser booking route "${input}" (approval=${route.approvalRequired}, floor=[${floor.join(',')}])`);
  }

  // Hotel message with URL → browser, zero-tap, floor empty ("book" is NOT a
  // route-level pay floor verb, so the route does not stamp pay).
  assertBrowserBooking('go to marriott.com and book me a hotel in Chicago this weekend', {
    approvalRequired: false,
    routeFloor: [],
  });

  // WI-6: URL-bearing discovery phrasing (verified null before) routes to
  // browser, zero-tap.
  assertBrowserBooking('find me hotels in chicago this weekend on marriott.com', {
    approvalRequired: false,
    routeFloor: [],
  });

  // WI-6: URL-less booking phrasing still routes to browser, zero-tap.
  assertBrowserBooking('book me a hotel in chicago', {
    approvalRequired: false,
    routeFloor: [],
  });

  // "buy X on <site>": browser route, zero-tap at route level, but the pay
  // floor IS stamped ("buy" is a route pay verb) — it just does not force
  // route-level approval for a browser route; enforcement is per-step below.
  assertBrowserBooking('buy a laptop stand on amazon.com', {
    approvalRequired: false,
    routeFloor: ['pay'],
  });

  // Bug #6: deliberation questions must NOT auto-launch a browser run. A
  // commerce/discovery verb behind a deliberation frame ("should I book …")
  // is the user asking for help deciding, not a command.
  {
    const deliberation = buildChatComputerRequestRoute('should I book a hotel or an airbnb?');
    if (deliberation && deliberation.kind === 'browser') {
      fail(`bug#6: "should I book a hotel or an airbnb?" must NOT route to a browser run (got kind=${deliberation.kind})`);
    } else pass('bug#6: deliberation "should I book …" does not auto-launch a browser route');

    // The three genuine commands must still reach the browser runtime.
    for (const command of [
      'book me a hotel in Chicago',
      'go to marriott.com and book a hotel',
      'find me hotels in chicago on marriott.com',
    ]) {
      const route = buildChatComputerRequestRoute(command);
      if (route?.kind !== 'browser') {
        fail(`bug#6: genuine command "${command}" must still route to browser (got ${route?.kind || 'null'})`);
      } else pass(`bug#6: genuine command still routes to browser: "${command}"`);
    }
  }

  // Regression: credentialed WordPress-admin route stays gated up front.
  {
    const wp = buildChatComputerRequestRoute('Log into WordPress wp-admin and install the SEO plugin after approval');
    if (wp?.approvalRequired !== true) fail(`WI-2: WordPress-admin route must keep approvalRequired=true, got ${wp?.approvalRequired}`);
    else if (!(wp.alwaysConfirmFloor || []).includes('login')) fail('WI-2: WordPress-admin login route must keep the login floor');
    else pass('WI-2: WordPress-admin route stays gated (approval + login floor)');
  }

  // Bug #3 support: the credentialed-website-admin classifier is a single
  // exported source of truth the ChatTab call site imports. It must return
  // FALSE for approval_sensitive_browser (travel/shopping) and TRUE for
  // credentialed_browser + WordPress-admin routes.
  {
    const { isCredentialedWebsiteAdminRoute } =
      require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');
    const wpMsg = 'Log into WordPress wp-admin and install the SEO plugin after approval';
    const wpRoute = buildChatComputerRequestRoute(wpMsg);
    if (isCredentialedWebsiteAdminRoute(wpRoute?.appStrategy ?? null, wpMsg) !== true) {
      fail('bug#3: exported classifier must return TRUE for a WordPress-admin route');
    } else pass('bug#3: exported classifier returns TRUE for WordPress-admin');

    const shopMsg = 'buy a laptop stand on amazon.com';
    const shopRoute = buildChatComputerRequestRoute(shopMsg);
    if (isCredentialedWebsiteAdminRoute(shopRoute?.appStrategy ?? null, shopMsg) !== false) {
      fail(`bug#3: exported classifier must return FALSE for approval_sensitive_browser (got strategy=${shopRoute?.appStrategy?.id})`);
    } else pass('bug#3: exported classifier returns FALSE for travel/shopping route');
  }

  // Regression: delete floor still forces route-level approval on a browser route.
  {
    const del = buildChatComputerRequestRoute('use the browser to delete my account on twitter.com');
    if (del?.kind !== 'browser') fail(`WI-2: delete-account browser route expected kind browser, got ${del?.kind}`);
    else if (del.approvalRequired !== true) fail(`WI-2: delete floor must keep browser route approvalRequired=true, got ${del.approvalRequired}`);
    else if (!(del.alwaysConfirmFloor || []).includes('delete')) fail('WI-2: delete-account route must carry the delete floor');
    else pass('WI-2: delete floor still gates a browser route');
  }

  // "book" is not a route-level pay floor verb; "pay"/"buy" are.
  if (detectAlwaysConfirmFloorCategories('book me a hotel in chicago').includes('pay')) {
    fail('WI-2: "book" must NOT stamp the route-level pay floor');
  } else pass('WI-2: "book" is not a route-level pay floor verb');
  if (!detectAlwaysConfirmFloorCategories('pay for the room').includes('pay')) {
    fail('WI-2: "pay" must stamp the route-level pay floor');
  } else pass('WI-2: "pay" stamps the route-level pay floor');

  // Step-level pay enforcement: booking/checkout submit calls fire the pay
  // floor confirm (never a hard block) even though "book"/"reserve" are absent
  // from the route-level floor list.
  function assertStepPayFloor(tool: string, input: unknown, shouldFire: boolean) {
    const verdict = constraintBlocksToolCall(null, tool, input);
    const fired = verdict.floorConfirmRequired === true && verdict.floorCategory === 'pay';
    if (verdict.blocked) {
      fail(`WI-2: step-level floor must never hard-block ("${tool}"); it must ask, not block`);
      return;
    }
    if (fired !== shouldFire) {
      fail(`WI-2: step "${tool}" pay-floor confirm expected ${shouldFire}, got ${fired}`);
      return;
    }
    pass(`WI-2: step "${tool}" pay-floor confirm=${fired}`);
  }
  assertStepPayFloor('browser.submit_booking', { confirm: true }, true);
  assertStepPayFloor('confirm_reservation', {}, true);
  assertStepPayFloor('browser.click', { text: 'Place order' }, true);
  assertStepPayFloor('browser.click', { text: 'Pay now' }, true);
  // Ordinary navigation/extraction never fires the pay floor.
  assertStepPayFloor('browser.navigate', { url: 'https://marriott.com' }, false);
  assertStepPayFloor('browser.extract', { schema: 'rooms' }, false);
}

if (failures > 0) {
  console.error(`\n${failures} chat computer request route smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat computer request route smoke cases passed.');
