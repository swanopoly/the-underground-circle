/**
 * computer-app-task-strategy-smoketest — verifies that computer/app
 * tasks get an execution strategy, not just an intent label.
 *
 * Run: npx tsx scripts/computer-app-task-strategy-smoketest.ts
 */

import { buildComputerAppTaskStrategy } from '../src/lib/computerAppTaskStrategy';
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
assertStrategy('Open Figma and crop this image after I approve desktop control', 'desktop_canvas_vision', ['desktop.screenshot', 'desktop.screen_size']);
assertStrategy('Open Photoshop and crop this image after I approve desktop control', 'creative_layout_control', ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_export_proof']);
assertStrategy('Open this InDesign file and make changes for a marketing banner with different layers', 'creative_layout_control', ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof']);
assertStrategyLabelIncludes('Open Photoshop and crop this image after I approve desktop control', 'Adobe Photoshop');
assertStrategyLabelIncludes('Open this InDesign file and make changes for a marketing banner with different layers', 'Adobe InDesign');
assertStrategy('Open Illustrator and update this logo then export SVG', 'adobe_cc_control', ['desktop.file_stat', 'desktop.read_a11y_tree', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Open Adobe Audition and clean this podcast audio before exporting WAV', 'adobe_cc_control', ['desktop.window_state', 'desktop.screenshot', 'agent.build_app_capability', 'approvals.request']);
assertStrategy('Open AutoCAD and create a 2D floor plan with two rooms and dimensions', 'engineering_cad_control', ['desktop.read_a11y_tree', 'desktop.file_stat', 'approvals.request']);
assertStrategy('Use Ableton Live to create a four-bar drum loop and export it after approval', 'universal_app_control', ['office.list_agents', 'research.search', 'agent.build_app_capability', 'desktop.read_a11y_tree']);
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

assertOpenSwanTools('Open Figma and crop this image after I approve desktop control', ['desktop.screenshot', 'desktop.screen_size', 'desktop.click_at']);
assertOpenSwanTools('Open Photoshop and crop this image after I approve desktop control', ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_export_proof', 'approvals.request']);
assertOpenSwanTools('Open this InDesign file and make changes for a marketing banner with different layers', ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'approvals.request']);
assertOpenSwanTools('Open After Effects and render the active comp to MP4', ['desktop.launch_app', 'desktop.screenshot', 'agent.build_app_capability', 'approvals.request']);
assertOpenSwanTools('Open AutoCAD and create a 2D floor plan with two rooms and dimensions', ['desktop.launch_app', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.file_stat', 'approvals.request']);
assertOpenSwanTools('Use Ableton Live to create a four-bar drum loop and export it after approval', ['office.list_agents', 'research.search', 'agent.build_app_capability', 'desktop.window_state', 'desktop.read_a11y_tree', 'approvals.request']);
assertOpenSwanTools('Login to WordPress with my saved vault credentials and draft a post', ['vault.resolve_for_task', 'browser.verification_state', 'approvals.request']);
assertOpenSwanTools('Tell me all the tabs I have open in Chrome right now', ['desktop.list_browser_tabs', 'desktop.window_state']);
assertOpenSwanTools('Summarize unread emails and prioritize Slack alerts', ['desktop.read_a11y_tree', 'desktop.type_text', 'tasks.create']);
assertOpenSwanTools('Check AWS logs and rollback the failed deploy after approval', ['code.inspect', 'browser.dom_snapshot', 'approvals.request']);
assertOpenSwanTools('Upload the image from my Desktop to Shopify product page after I approve', ['desktop.file_search', 'desktop.file_stat', 'browser.upload_file', 'browser.dom_snapshot', 'approvals.request']);
assertOpenSwanTools('Have the attached Codex agent download whatever assets it needs to finish the website task', ['office.list_agents', 'agent.codex_acquire_asset', 'desktop.file_search', 'desktop.file_stat', 'approvals.request']);

if (failures > 0) {
  console.error(`\n${failures} computer/app task strategy smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer/app task strategy smoke cases passed.');
