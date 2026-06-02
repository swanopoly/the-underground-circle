/**
 * openswan-task-planner-smoketest - pins OpenSwan's local computer and
 * browser-awareness tool routing. Regression here means chat can have the
 * runtime tools available but fail to expose them for natural user prompts.
 *
 * Run: npm run smoke:openswan-task-planner
 */

import { buildOpenSwanTaskPlan, type OpenSwanToolName } from '../src/lib/openswanTaskPlanner';
import type { AgenticCodingProfile } from '../src/lib/agenticCodingProfile';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function toolsFor(message: string, profile: AgenticCodingProfile = 'support'): OpenSwanToolName[] {
  return buildOpenSwanTaskPlan(message, profile).recommendedTools.map((item) => item.tool);
}

function assertHas(message: string, expected: OpenSwanToolName, profile?: AgenticCodingProfile) {
  const tools = toolsFor(message, profile);
  assert(
    tools.includes(expected),
    `"${message}" recommends ${expected}`,
    `saw ${tools.join(', ')}`,
  );
}

function main() {
  assertHas(
    'tell me all the tabs I have open on my web browser',
    'desktop.list_browser_tabs',
  );
  assertHas(
    'what app is active and what windows are open on my computer',
    'desktop.window_state',
  );
  assertHas(
    'copy this launch checklist to my clipboard',
    'desktop.clipboard_write',
  );
  assertHas(
    'search files in my Downloads folder for invoice',
    'desktop.file_search',
  );
  assertHas(
    'does the file landscaping-img.png on my desktop exist and what size is it',
    'desktop.file_stat',
  );
  assertHas(
    'change the file landscaping-img.png thats on the desktop to andscaping-img-1.png',
    'desktop.file_rename',
  );
  assertHas(
    'copy landscaping-img.png on my desktop to landscaping-img-copy.png',
    'desktop.file_copy',
  );
  assertHas(
    'move old-screenshot.png on my desktop to trash',
    'desktop.file_trash',
  );
  assertHas(
    'create a folder on my desktop called Project Assets',
    'desktop.file_mkdir',
  );
  assertHas(
    'write a text file on my desktop called notes.txt with hello',
    'desktop.file_write_text',
  );
  assertHas(
    'run my Resize Images Apple Shortcut',
    'desktop.shortcuts_run',
  );
  assertHas(
    'resize the active app window on my desktop',
    'desktop.window_manage',
  );
  assertHas(
    'scroll down in the desktop browser window',
    'desktop.mouse_scroll',
  );
  assertHas(
    'move mouse to 200,300',
    'desktop.mouse_move',
  );
  assertHas(
    'right double click at 400,500',
    'desktop.mouse_click',
  );
  assertHas(
    'hold mouse down at 400,500',
    'desktop.mouse_down',
  );
  assertHas(
    'release mouse at 420,520',
    'desktop.mouse_up',
  );
  assertHas(
    'drag from 100,200 to 600,700',
    'desktop.mouse_drag',
  );
  assertHas(
    'paste this exact multiline text into TextEdit',
    'desktop.paste_text',
  );
  assertHas(
    'fill the email field with chris@example.com in TextEdit',
    'desktop.set_element_value',
  );
  assertHas(
    'show clickable elements in Safari',
    'desktop.read_a11y_tree',
  );
  assertHas(
    'check InDesign document status and missing links',
    'desktop.indesign_document_status',
  );
  assertHas(
    'show InDesign text frames and layer names',
    'desktop.indesign_text_inventory',
  );
  assertHas(
    'Open InDesign and hide layer Legal',
    'desktop.indesign_set_layer_state',
  );
  assertHas(
    'Open Photoshop and hide layer Legal',
    'desktop.photoshop_set_layer_state',
  );
  assertHas(
    'update the InDesign disclaimer to See dealer for details',
    'desktop.indesign_update_text_layer',
  );
  assertHas(
    'in InDesign change 64 to 65, 72 to 84, and expires 5/31 to expires 6/30',
    'desktop.indesign_batch_find_change',
  );
  assertHas(
    'Open InDesign and update headline to Memorial Day Sale, price to $29,995, APR to 2.9%, and disclaimer to See dealer for details',
    'desktop.indesign_batch_update_text_layers',
  );
  assertHas(
    'Open InDesign and export proof pdf as dealer-proof.pdf',
    'desktop.indesign_export_proof',
  );
  assertHas(
    'Open InDesign and relink selected image to ~/Desktop/new-hero.png',
    'desktop.indesign_relink_asset',
  );
  assertHas(
    'Open InDesign and package document for handoff',
    'desktop.indesign_package_document',
  );
  assertHas(
    'Open After Effects and render the active comp to MP4 after approval',
    'agent.build_app_capability',
  );
  assertHas(
    'Open After Effects and render the active comp to MP4 after approval',
    'desktop.screenshot',
  );
  assertHas(
    'Open Illustrator and update this logo then export SVG',
    'desktop.file_stat',
  );
  assertHas(
    'open https://example.com/dashboard in the browser',
    'browser.open_url',
  );
  assertHas(
    'inspect the fields and links on the website',
    'browser.dom_snapshot',
  );
  assertHas(
    'click the Login button on the website',
    'browser.click_role',
  );
  assertHas(
    'fill the login form in the browser',
    'browser.fill_field',
  );
  assertHas(
    'select Canada from the country dropdown in the browser',
    'browser.select_option',
  );
  assertHas(
    'press Enter in the browser',
    'browser.press_key',
  );
  assertHas(
    'take a browser screenshot for proof',
    'browser.screenshot',
  );
  assertHas(
    'log into Shopify and update this product page after I approve',
    'vault.resolve_for_task',
  );
  assertHas(
    'log into Shopify and update this product page after I approve',
    'browser.verification_state',
  );
  assertHas(
    'the desktop/browser_tabs endpoint returns 404 in the local bridge',
    'desktop.list_browser_tabs',
  );
  assertHas(
    'have the attached Codex agent download whatever assets it needs to finish the website task',
    'agent.codex_acquire_asset',
  );
  assertHas(
    'have the attached Codex agent download whatever assets it needs to finish the website task',
    'desktop.file_stat',
  );
  assertHas(
    'Use Ableton Live to create a four-bar drum loop and export it after approval',
    'agent.build_app_capability',
  );
  assertHas(
    'Use Ableton Live to create a four-bar drum loop and export it after approval',
    'research.search',
  );
  assertHas(
    'Click the Render Queue button in SuperRender app',
    'agent.build_app_capability',
  );
  assertHas(
    'the Photoshop task failed with a selector timeout, figure out why and fix it',
    'agent.recover_failed_task',
  );
  assertHas(
    'the desktop/browser_tabs endpoint returns 404 in the local bridge, recover the failed task',
    'agent.recover_failed_task',
  );

  const tabTools = toolsFor('tell me all the tabs I have open on my web browser');
  const tabIndex = tabTools.indexOf('desktop.list_browser_tabs');
  const browserPlanIndex = tabTools.indexOf('browser.plan_task');
  assert(
    tabIndex >= 0 && (browserPlanIndex < 0 || tabIndex < browserPlanIndex),
    'browser tab awareness is prioritized before generic browser planning',
    `order ${tabTools.join(', ')}`,
  );

  if (failures > 0) {
    console.error(`\n${failures} OpenSwan task-planner smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll OpenSwan task-planner smoke cases passed.');
}

main();
