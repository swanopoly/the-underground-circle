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
    'drag from 100,200 to 600,700',
    'desktop.mouse_drag',
  );
  assertHas(
    'show clickable elements in Safari',
    'desktop.read_a11y_tree',
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
