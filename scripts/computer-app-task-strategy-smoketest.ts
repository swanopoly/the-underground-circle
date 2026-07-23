/**
 * computer-app-task-strategy-smoketest — verifies that computer/app
 * tasks get an execution strategy, not just an intent label.
 *
 * Run: npx tsx scripts/computer-app-task-strategy-smoketest.ts
 */

import {
  buildComputerAppTaskStrategy,
  buildComputerAppTaskStrategyPromptBlock,
} from '../src/lib/computerAppTaskStrategy';
import { buildOpenSwanTaskPlan } from '../src/lib/openswanTaskPlanner';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }

function assertStrategy(input: string, expectedId: string, expectedTools: string[] = []) {
  const strategy = buildComputerAppTaskStrategy(input);
  if (strategy?.id !== expectedId) {
    fail(`${input} expected strategy ${expectedId}, got ${strategy?.id || 'none'}`);
    return;
  }
  const missing = expectedTools.filter((tool) => !strategy.recommendedTools.includes(tool));
  if (missing.length > 0) {
    fail(`${input} strategy ${expectedId} missing tools ${missing.join(', ')}`);
    return;
  }
  if (strategy.maxBlindActions !== 0) {
    fail(`${input} strategy ${expectedId} should not allow blind actions`);
    return;
  }
  pass(`${expectedId}: ${input}`);
}

function assertStrategyLabelIncludes(input: string, expected: string) {
  const strategy = buildComputerAppTaskStrategy(input);
  if (!strategy?.label.includes(expected)) {
    fail(`${input} strategy label expected to include ${expected}, got ${strategy?.label || 'none'}`);
    return;
  }
  pass(`strategy label ${expected}: ${input}`);
}

function assertOpenSwanTools(input: string, expectedTools: string[]) {
  const plan = buildOpenSwanTaskPlan(input, 'senior' as any);
  const tools = plan.recommendedTools.map((item) => item.tool);
  const missing = expectedTools.filter((tool) => !tools.includes(tool as any));
  if (missing.length > 0) {
    fail(`${input} OpenSwan plan missing ${missing.join(', ')} from [${tools.join(', ')}]`);
    return;
  }
  pass(`OpenSwan tools: ${input}`);
}

assertStrategy('Tell me all the tabs I have open in Chrome right now', 'desktop_readonly', ['desktop.list_browser_tabs']);
assertStrategy('Extract product prices from https://example.com into JSON', 'browser_semantic', ['browser.dom_snapshot']);
assertStrategy('Login to WordPress with my saved vault credentials and draft a post', 'credentialed_browser', ['vault.resolve_for_task', 'browser.verification_state']);
assertStrategy('Log into WordPress wp-admin and install the SEO plugin after approval', 'credentialed_browser', ['wp.discover_types', 'wp.list_posts', 'vault.runbook', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request']);
assertStrategyLabelIncludes('Log into WordPress wp-admin and install the SEO plugin after approval', 'WordPress Admin');
assertStrategy('Open WordPress media library and upload logo.png from Desktop', 'browser_file_transfer', ['wp.upload_media', 'desktop.file_search', 'desktop.file_stat', 'browser.upload_file', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot']);
assertStrategyLabelIncludes('Open WordPress media library and upload logo.png from Desktop', 'WordPress Media/Admin');
assertStrategy('Upload banner.jpg and create a Dealer Inspire DI Slide, assign it to StellantisUS-1920x600, and set expiration_date to June 30 after approval', 'browser_file_transfer', ['wp.discover_types', 'wp.list_posts', 'wp.create_slide', 'desktop.file_stat', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request']);
assertStrategyLabelIncludes('Upload banner.jpg and create a Dealer Inspire DI Slide after approval', 'WordPress');
assertStrategy('Quick Edit Dealer Inspire DI Slide Promaster expiration_date in wp-admin after approval', 'credentialed_browser', ['wp.discover_types', 'wp.list_posts', 'wp.update_post', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'browser.fill_field', 'approvals.request']);
assertStrategy('Open Figma and crop this image after I approve desktop control', 'desktop_canvas_vision', ['desktop.screenshot', 'desktop.screen_size']);
assertStrategy('Open Photoshop and crop this image after I approve desktop control', 'creative_layout_control', ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_set_layer_appearance', 'desktop.photoshop_create_text_layer', 'desktop.photoshop_add_fill_layer', 'desktop.photoshop_export_proof']);
assertStrategy('Open this InDesign file and make changes for a marketing banner with different layers', 'creative_layout_control', ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof']);
assertStrategyLabelIncludes('Open Photoshop and crop this image after I approve desktop control', 'Adobe Photoshop');
assertStrategyLabelIncludes('Open this InDesign file and make changes for a marketing banner with different layers', 'Adobe InDesign');
assertStrategy('Open Illustrator and update this logo then export SVG', 'adobe_cc_control', ['desktop.illustrator_vectorize', 'desktop.illustrator_set_appearance', 'desktop.illustrator_align', 'desktop.illustrator_arrange', 'desktop.illustrator_group', 'desktop.illustrator_add_artboard', 'desktop.illustrator_add_text', 'desktop.illustrator_add_shape', 'desktop.file_stat', 'desktop.read_a11y_tree', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Open Adobe Audition and clean this podcast audio before exporting WAV', 'adobe_cc_control', ['desktop.window_state', 'desktop.screenshot', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Open AutoCAD and create a 2D floor plan with two rooms and dimensions', 'engineering_cad_control', ['desktop.read_a11y_tree', 'desktop.file_stat', 'research.search', 'fetch_url', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Open MATLAB and build a Simulink model, run the simulation, and export plots after approval', 'engineering_cad_control', ['desktop.read_a11y_tree', 'desktop.file_stat', 'research.search', 'fetch_url', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Use SOLIDWORKS to update this part dimension and export STEP after approval', 'engineering_cad_control', ['desktop.read_a11y_tree', 'desktop.file_stat', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Use Ableton Live to create a four-bar drum loop and export it after approval', 'universal_app_control', ['office.list_agents', 'research.search', 'agent.build_app_capability', 'desktop.read_a11y_tree']);
assertStrategy(
  'I want chat to open any app, figure out how to use it by itself, research what it needs, and do the requested task',
  'universal_app_control',
  ['tools.search', 'research.search', 'fetch_url', 'agent.build_app_capability', 'desktop.launch_app', 'desktop.window_state'],
);
assertStrategy('The website is showing a Cloudflare human verification screen', 'human_verification_pause', ['browser.verification_state']);
assertStrategy('Start 10 separate Codex sessions in my terminal', 'terminal_agent_orchestration', ['office.list_agents']);
assertStrategy('Search files in ~/Downloads for invoice PDFs', 'file_readonly', ['desktop.file_search']);
assertStrategy('Upload the image from my Desktop to Shopify product page after I approve', 'browser_file_transfer', ['desktop.file_search', 'browser.upload_file', 'browser.dom_snapshot']);
assertStrategy('Download the orders CSV from Shopify and save it to Downloads', 'browser_file_transfer', ['desktop.file_search', 'browser.screenshot']);
assertStrategy('Have the attached Codex agent download whatever assets it needs to finish the website task', 'agent_asset_acquisition', ['office.list_agents', 'agent.codex_acquire_asset', 'desktop.file_stat']);
assertStrategy('Summarize unread emails and prioritize Slack alerts', 'productivity_app_control', ['desktop.read_a11y_tree', 'desktop.type_text']);
assertStrategy('Book a flight to New York next Friday under $500', 'approval_sensitive_browser', ['browser.dom_snapshot', 'approvals.request']);
assertStrategy('Compare vendors and buy five software licenses after approval', 'approval_sensitive_browser', ['browser.dom_snapshot', 'approvals.request']);
assertStrategy('Check AWS logs and rollback the failed deploy after approval', 'ops_console_control', ['code.inspect', 'approvals.request']);
assertStrategy('Extract the signed date and renewal clause from this contract PDF', 'document_data_workbench', ['desktop.file_read']);

// ─── SLICE 1: bare design-verb requests reach a design strategy ──────────────
// Vector-design verbs with no named Adobe app still route to the Illustrator
// (adobe_cc_control) control loop.
assertStrategy('vectorize this logo to SVG', 'adobe_cc_control');
assertStrategy('align these objects', 'adobe_cc_control');
assertStrategy('group these paths', 'adobe_cc_control');
assertStrategy('image trace this photo', 'adobe_cc_control');
// Bare Photoshop single-ops (no layout+layer noun pair) route to the layered
// creative control loop.
assertStrategy('make the selection red', 'creative_layout_control');
assertStrategy('set the layer opacity to 50%', 'creative_layout_control');
assertStrategy('change the blend mode to multiply', 'creative_layout_control');
assertStrategy('add a white background', 'creative_layout_control');
assertStrategy('add a fill layer', 'creative_layout_control');
// Precision: plain conversation must NOT resolve a design strategy.
for (const conversational of ['should we align our goals', 'add a note', 'group the tasks by priority']) {
  if (buildComputerAppTaskStrategy(conversational) !== null) {
    fail(`precision: "${conversational}" should not resolve a computer/app strategy`);
  } else {
    pass(`precision: "${conversational}" stays conversational (no strategy)`);
  }
}

assertOpenSwanTools('Open Figma and crop this image after I approve desktop control', ['desktop.screenshot', 'desktop.screen_size', 'desktop.click_at']);
assertOpenSwanTools('Open Photoshop and crop this image after I approve desktop control', ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_export_proof', 'approvals.request']);
assertOpenSwanTools('Open this InDesign file and make changes for a marketing banner with different layers', ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'approvals.request']);
assertOpenSwanTools('Open After Effects and render the active comp to MP4', ['desktop.launch_app', 'desktop.screenshot', 'agent.build_app_capability', 'approvals.request']);
assertOpenSwanTools('Open AutoCAD and create a 2D floor plan with two rooms and dimensions', ['desktop.launch_app', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.file_stat', 'research.search', 'fetch_url', 'agent.build_app_capability', 'approvals.request']);
assertOpenSwanTools('Open MATLAB and build a Simulink model, run the simulation, and export plots after approval', ['desktop.launch_app', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.file_stat', 'research.search', 'fetch_url', 'agent.build_app_capability', 'approvals.request']);
assertOpenSwanTools('Use Ableton Live to create a four-bar drum loop and export it after approval', ['office.list_agents', 'research.search', 'agent.build_app_capability', 'desktop.window_state', 'desktop.read_a11y_tree', 'approvals.request']);
assertOpenSwanTools('Login to WordPress with my saved vault credentials and draft a post', ['vault.resolve_for_task', 'browser.verification_state', 'approvals.request']);
assertOpenSwanTools('Log into WordPress wp-admin and install the SEO plugin after approval', ['wp.discover_types', 'wp.list_posts', 'wp.upload_media', 'vault.resolve_for_task', 'browser.open_url', 'browser.wp_admin_source_intelligence', 'browser.dom_snapshot', 'approvals.request']);
assertOpenSwanTools('Tell me all the tabs I have open in Chrome right now', ['desktop.list_browser_tabs', 'desktop.window_state']);
assertOpenSwanTools('Summarize unread emails and prioritize Slack alerts', ['desktop.read_a11y_tree', 'desktop.type_text', 'tasks.create']);
assertOpenSwanTools('Check AWS logs and rollback the failed deploy after approval', ['code.inspect', 'browser.dom_snapshot', 'approvals.request']);
assertOpenSwanTools('Upload the image from my Desktop to Shopify product page after I approve', ['desktop.file_search', 'desktop.file_stat', 'browser.upload_file', 'browser.dom_snapshot', 'approvals.request']);
assertOpenSwanTools('Have the attached Codex agent download whatever assets it needs to finish the website task', ['office.list_agents', 'agent.codex_acquire_asset', 'desktop.file_search', 'desktop.file_stat', 'approvals.request']);

const autonomyPrompt = buildComputerAppTaskStrategyPromptBlock('Open CapCut and edit this video like a pro, research how the app works if needed, then export it after approval') || '';
if (!autonomyPrompt.includes('## Professional App Autonomy')) {
  fail('professional app autonomy prompt should be injected for named app-control tasks');
} else if (!autonomyPrompt.includes('Open/focus first') || !autonomyPrompt.includes('Research-first rule') || !autonomyPrompt.includes('Control-surface order')) {
  fail('professional app autonomy prompt should include open, research, and control-surface rules');
} else if (!autonomyPrompt.includes('desktop.run_applescript') || !autonomyPrompt.includes('agent.build_app_capability')) {
  fail('professional app autonomy prompt should include scriptable-app and buildout tools');
} else {
  pass('professional app autonomy prompt: named app task');
}

if (failures > 0) {
  console.error(`\n${failures} computer/app task strategy smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer/app task strategy smoke cases passed.');
