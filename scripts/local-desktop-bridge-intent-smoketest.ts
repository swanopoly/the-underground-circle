/**
 * local-desktop-bridge-intent-smoketest - pins chat routing for local
 * desktop bridge awareness/actions. These requests should stay local
 * through OpenSwan, not Browserbase/computer-use.
 *
 * Run: npm run smoke:local-desktop-bridge-intent
 */

import {
  detectLocalComputerAwarenessIntent,
  type LocalComputerAwarenessKind,
} from '../src/lib/localComputerAwarenessIntent';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

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

function assertIntent(
  message: string,
  expectedKind: LocalComputerAwarenessKind,
  expected?: Partial<{ appQuery: string; url: string; path: string; text: string; x: number; y: number; mouseButton: 'left' | 'right'; clickCount: number }>,
) {
  const intent = detectLocalComputerAwarenessIntent(message);
  assert(intent.route, `"${message}" routes to local desktop bridge`, intent.reason);
  assert(intent.kind === expectedKind, `"${message}" kind = ${expectedKind}`, `saw ${intent.kind}`);
  if (expected?.appQuery !== undefined) {
    assert(intent.appQuery === expected.appQuery, `"${message}" appQuery parsed`, `saw ${intent.appQuery}`);
  }
  if (expected?.url !== undefined) {
    assert(intent.url === expected.url, `"${message}" url parsed`, `saw ${intent.url}`);
  }
  if (expected?.path !== undefined) {
    assert(intent.path === expected.path, `"${message}" path parsed`, `saw ${intent.path}`);
  }
  if (expected?.text !== undefined) {
    assert(intent.text === expected.text, `"${message}" clipboard text parsed`, `saw ${intent.text}`);
  }
  if (expected?.x !== undefined) {
    assert(intent.x === expected.x, `"${message}" x parsed`, `saw ${intent.x}`);
  }
  if (expected?.y !== undefined) {
    assert(intent.y === expected.y, `"${message}" y parsed`, `saw ${intent.y}`);
  }
  if (expected?.mouseButton !== undefined) {
    assert(intent.mouseButton === expected.mouseButton, `"${message}" mouse button parsed`, `saw ${intent.mouseButton}`);
  }
  if (expected?.clickCount !== undefined) {
    assert(intent.clickCount === expected.clickCount, `"${message}" click count parsed`, `saw ${intent.clickCount}`);
  }

  const plan = buildChatAutomationPlan({ message });
  assert(
    plan.execution.kind === 'run_openswan',
    `"${message}" stays in OpenSwan/local bridge routing`,
    `saw ${plan.execution.kind}`,
  );
  assert(
    plan.execution.kind !== 'run_computer_task',
    `"${message}" does not start Computer Use`,
  );
}

function assertExtraIntent(
  message: string,
  expectedKind: LocalComputerAwarenessKind,
  verify: (intent: ReturnType<typeof detectLocalComputerAwarenessIntent>) => void,
) {
  const intent = detectLocalComputerAwarenessIntent(message);
  assert(intent.route, `"${message}" routes to local desktop bridge`, intent.reason);
  assert(intent.kind === expectedKind, `"${message}" kind = ${expectedKind}`, `saw ${intent.kind}`);
  verify(intent);
  const plan = buildChatAutomationPlan({ message });
  assert(plan.execution.kind === 'run_openswan', `"${message}" stays in OpenSwan/local bridge routing`, `saw ${plan.execution.kind}`);
  assert(plan.execution.kind !== 'run_computer_task', `"${message}" does not start Computer Use`);
}

function main() {
  assertIntent(
    'are you able to see all of the Chrome tabs I have open?',
    'browser_tabs',
  );
  assertIntent(
    'what apps are open on my computer?',
    'running_apps',
  );
  assertIntent(
    'what is the active window on my screen?',
    'window_state',
  );
  assertIntent(
    'what is on my clipboard?',
    'clipboard',
  );
  assertIntent(
    'copy launch checklist to my clipboard',
    'clipboard_write',
    { text: 'launch checklist' },
  );
  assertIntent(
    'set my clipboard to deploy notes',
    'clipboard_write',
    { text: 'deploy notes' },
  );
  assertIntent(
    'clear my clipboard',
    'clipboard_clear',
  );
  assertIntent(
    'open Chrome',
    'launch_app',
    { appQuery: 'Chrome' },
  );
  assertIntent(
    'switch to Slack',
    'focus_app',
    { appQuery: 'Slack' },
  );
  assertIntent(
    'bring Safari to front',
    'focus_app',
    { appQuery: 'Safari' },
  );
  assertIntent(
    'open https://example.com/dashboard',
    'open_url',
    { url: 'https://example.com/dashboard' },
  );
  assertIntent(
    'open example.com/docs',
    'open_url',
    { url: 'https://example.com/docs' },
  );
  assertIntent(
    'open ~/Downloads',
    'open_path',
    { path: '~/Downloads' },
  );
  assertExtraIntent(
    'list files in Downloads',
    'file_list',
    (intent) => assert(intent.path === 'Downloads', 'file list path parsed', `saw ${intent.path}`),
  );
  assertExtraIntent(
    'read ~/Downloads/report.txt',
    'file_read',
    (intent) => assert(intent.path === '~/Downloads/report.txt', 'file read path parsed', `saw ${intent.path}`),
  );
  assertExtraIntent(
    'search files in Downloads for invoice',
    'file_search',
    (intent) => {
      assert(intent.rootPath === 'Downloads', 'file search root parsed', `saw ${intent.rootPath}`);
      assert(intent.query === 'invoice', 'file search query parsed', `saw ${intent.query}`);
    },
  );
  assertExtraIntent(
    'list my Apple Shortcuts',
    'shortcuts_list',
    () => undefined,
  );
  assertExtraIntent(
    'run shortcut Resize Images',
    'shortcut_run',
    (intent) => assert(intent.shortcutName === 'Resize Images', 'shortcut name parsed', `saw ${intent.shortcutName}`),
  );
  assertExtraIntent(
    'confirm run shortcut Resize Images',
    'shortcut_run',
    (intent) => assert(intent.shortcutName === 'Resize Images', 'confirmed shortcut name parsed', `saw ${intent.shortcutName}`),
  );
  assertExtraIntent(
    'show clickable elements in Safari',
    'a11y_tree',
    (intent) => assert(intent.appQuery === 'Safari', 'a11y app parsed', `saw ${intent.appQuery}`),
  );
  assertExtraIntent(
    'minimize active window',
    'window_manage',
    (intent) => assert(intent.windowAction === 'minimize', 'window action parsed', `saw ${intent.windowAction}`),
  );
  assertExtraIntent(
    'resize Chrome window to 1200x800',
    'window_manage',
    (intent) => {
      assert(intent.windowAction === 'resize', 'resize action parsed', `saw ${intent.windowAction}`);
      assert(intent.appQuery === 'Chrome', 'resize app parsed', `saw ${intent.appQuery}`);
      assert(intent.width === 1200 && intent.height === 800, 'resize dimensions parsed', `saw ${intent.width}x${intent.height}`);
    },
  );
  assertIntent(
    'move mouse to 200,300',
    'mouse_move',
    { x: 200, y: 300 },
  );
  assertIntent(
    'right double click at 400,500',
    'mouse_click',
    { x: 400, y: 500, mouseButton: 'right', clickCount: 2 },
  );
  assertExtraIntent(
    'drag from 100,200 to 600,700',
    'mouse_drag',
    (intent) => {
      assert(intent.fromX === 100 && intent.fromY === 200, 'drag start parsed', `saw ${intent.fromX},${intent.fromY}`);
      assert(intent.toX === 600 && intent.toY === 700, 'drag end parsed', `saw ${intent.toX},${intent.toY}`);
    },
  );

  const browserPlan = buildChatAutomationPlan({
    message: 'Extract product names and prices from https://example.com/catalog as JSON',
  });
  assert(
    browserPlan.execution.kind === 'run_computer_task',
    'browser data extraction still routes to Computer Use',
    `saw ${browserPlan.execution.kind}`,
  );

  if (failures > 0) {
    console.error(`\n${failures} local desktop bridge intent smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll local desktop bridge intent smoke cases passed.');
}

main();
