/**
 * desktop-runtime-wiring-smoketest
 *
 * Source-level coverage for the local desktop automation stack. This avoids
 * importing React Native app modules in Node while still locking the critical
 * wiring:
 *   prompt planner -> OpenSwan tool catalog -> runtime case -> desktopBridge
 *   client -> claude-bridge HTTP endpoint.
 *
 * Run: npm run smoke:desktop-runtime-wiring
 */

import fs from 'node:fs';

const files = {
  planner: fs.readFileSync('src/lib/openswanTaskPlanner.ts', 'utf8'),
  runtime: fs.readFileSync('src/lib/openswanToolRuntime.ts', 'utf8'),
  client: fs.readFileSync('src/lib/desktopBridge.ts', 'utf8'),
  browserClient: fs.readFileSync('src/lib/browserBridge.ts', 'utf8'),
  browserServer: fs.readFileSync('scripts/browser-bridge.js', 'utf8'),
  computerUse: fs.readFileSync('src/lib/computerUse.ts', 'utf8'),
  bridge: fs.readFileSync('scripts/claude-bridge.js', 'utf8'),
  pkg: JSON.parse(fs.readFileSync('package.json', 'utf8')),
};

let failures = 0;
function pass(name) { console.log('pass:', name); }
function fail(name, detail = '') {
  failures += 1;
  console.error('FAIL:', `${name}${detail ? ` — ${detail}` : ''}`);
}
function assert(condition, name, detail) {
  if (condition) pass(name);
  else fail(name, detail);
}

const tools = [
  { name: 'desktop.list_browser_tabs', endpoint: '/desktop/browser_tabs', client: 'listBrowserTabs', health: 'browser_tabs', readOnly: true },
  { name: 'desktop.window_state', endpoint: '/desktop/window_state', client: 'getWindowState', health: 'window_state', readOnly: true },
  { name: 'desktop.clipboard', endpoint: '/desktop/clipboard', client: 'readClipboard', health: 'clipboard', readOnly: true },
  { name: 'desktop.clipboard_write', endpoint: '/desktop/clipboard_write', client: 'writeClipboard', health: 'clipboard_write', writeMode: true },
  { name: 'desktop.clipboard_clear', endpoint: '/desktop/clipboard_clear', client: 'clearClipboard', health: 'clipboard_clear', writeMode: true },
  { name: 'desktop.file_list', endpoint: '/desktop/file_list', client: 'listFiles', health: 'file_list', readOnly: true },
  { name: 'desktop.file_read', endpoint: '/desktop/file_read', client: 'readFile', health: 'file_read', readOnly: true },
  { name: 'desktop.file_search', endpoint: '/desktop/file_search', client: 'searchFiles', health: 'file_search', readOnly: true },
  { name: 'desktop.shortcuts_list', endpoint: '/desktop/shortcuts/list', client: 'listShortcuts', health: 'shortcuts_list', readOnly: true },
  { name: 'desktop.shortcuts_run', endpoint: '/desktop/shortcuts/run', client: 'runShortcut', health: 'shortcuts_run', writeMode: true },
  { name: 'desktop.window_manage', endpoint: '/desktop/window_manage', client: 'manageWindow', health: 'window_manage', writeMode: true },
  { name: 'desktop.mouse_move', endpoint: '/desktop/mouse_move', client: 'mouseMove', health: 'mouse_move', writeMode: true },
  { name: 'desktop.mouse_click', endpoint: '/desktop/mouse_click', client: 'mouseClick', health: 'mouse_click', writeMode: true },
  { name: 'desktop.mouse_drag', endpoint: '/desktop/mouse_drag', client: 'mouseDrag', health: 'mouse_drag', writeMode: true },
  { name: 'desktop.mouse_scroll', endpoint: '/desktop/mouse_scroll', client: 'mouseScroll', health: 'mouse_scroll', writeMode: true },
  { name: 'desktop.read_a11y_tree', endpoint: '/desktop/a11y_tree', client: 'readA11yTree', health: 'a11y_tree', readOnly: true },
  { name: 'desktop.click_element', endpoint: '/desktop/click_element', client: 'clickElement', health: 'click_element', writeMode: true },
];

const browserTools = [
  { name: 'browser.open_url', endpoint: '/browser/open_url', client: 'openUrl', handler: 'handleOpenUrl', writeMode: true },
  { name: 'browser.dom_snapshot', endpoint: '/browser/dom_snapshot', client: 'domSnapshot', handler: 'handleDomSnapshot', readOnly: true },
  { name: 'browser.click_role', endpoint: '/browser/click_role', client: 'clickRole', handler: 'handleClickRole', writeMode: true },
  { name: 'browser.fill_field', endpoint: '/browser/fill', client: 'fillField', handler: 'handleFill', writeMode: true },
  { name: 'browser.select_option', endpoint: '/browser/select', client: 'selectOption', handler: 'handleSelect', writeMode: true },
  { name: 'browser.press_key', endpoint: '/browser/press', client: 'pressKey', handler: 'handlePress', writeMode: true },
  { name: 'browser.screenshot', endpoint: '/browser/screenshot', client: 'screenshot', handler: 'handleScreenshot', readOnly: true },
  { name: 'browser.close', endpoint: '/browser/close', client: 'closeBrowser', handler: 'handleClose', writeMode: true },
];

for (const tool of tools) {
  assert(files.runtime.includes(`name: '${tool.name}'`), `${tool.name}: tool catalog entry`);
  assert(files.runtime.includes(`case '${tool.name}'`), `${tool.name}: runtime execution case`);
  assert(files.runtime.includes(`'${tool.name}'`), `${tool.name}: runtime type coverage`);
  assert(files.client.includes(`function ${tool.client}`), `${tool.name}: desktopBridge client ${tool.client}`);
  assert(files.client.includes(tool.endpoint), `${tool.name}: desktopBridge endpoint ${tool.endpoint}`);
  assert(files.bridge.includes(`url === '${tool.endpoint}'`) || files.bridge.includes(`p === '${tool.endpoint}'`), `${tool.name}: bridge endpoint ${tool.endpoint}`);
  assert(files.bridge.includes(`'${tool.health}'`), `${tool.name}: health advertises ${tool.health}`);
  if (tool.readOnly) {
    assert(files.runtime.includes(`'${tool.name}',`) && /const readOnlyTools = new Set\([\s\S]*?]\);/.test(files.runtime), `${tool.name}: read-only policy listed`);
  }
  if (tool.writeMode) {
    assert(files.runtime.includes(`'${tool.name}': ['execute']`), `${tool.name}: execute-mode gated`);
  }
}

for (const tool of browserTools) {
  assert(files.runtime.includes(`name: '${tool.name}'`), `${tool.name}: tool catalog entry`);
  assert(files.runtime.includes(`case '${tool.name}'`), `${tool.name}: runtime execution case`);
  assert(files.runtime.includes(`'${tool.name}'`), `${tool.name}: runtime type coverage`);
  assert(files.browserClient.includes(`function ${tool.client}`), `${tool.name}: browserBridge client ${tool.client}`);
  assert(files.browserClient.includes(tool.endpoint), `${tool.name}: browserBridge endpoint ${tool.endpoint}`);
  assert(files.bridge.includes(tool.endpoint), `${tool.name}: claude bridge routes ${tool.endpoint}`);
  assert(files.bridge.includes(tool.handler), `${tool.name}: claude bridge handler ${tool.handler}`);
  if (tool.writeMode) {
    assert(files.runtime.includes(`'${tool.name}': ['execute']`) || files.runtime.includes(`'${tool.name}': ['execute', 'support']`), `${tool.name}: execute-mode gated`);
  }
}

for (const plannerTool of [
  'desktop.list_browser_tabs',
  'desktop.window_state',
  'desktop.clipboard_write',
  'desktop.file_search',
  'desktop.shortcuts_run',
  'desktop.window_manage',
  'desktop.mouse_move',
  'desktop.mouse_click',
  'desktop.mouse_drag',
  'desktop.mouse_scroll',
  'desktop.read_a11y_tree',
  'browser.open_url',
  'browser.dom_snapshot',
  'browser.click_role',
  'browser.fill_field',
  'browser.select_option',
  'browser.press_key',
  'browser.screenshot',
]) {
  assert(files.planner.includes(plannerTool), `${plannerTool}: planner can recommend`);
}

assert(Boolean(files.pkg.scripts['smoke:local-desktop-bridge-intent']), 'package script: smoke:local-desktop-bridge-intent');
assert(Boolean(files.pkg.scripts['smoke:openswan-task-planner']), 'package script: smoke:openswan-task-planner');
assert(Boolean(files.pkg.scripts['smoke:desktop-runtime-wiring']), 'package script: smoke:desktop-runtime-wiring');
assert(Boolean(files.pkg.scripts['smoke:computer-use-backend']), 'package script: smoke:computer-use-backend');
assert(Boolean(files.pkg.scripts['build:input-helper']), 'package script: build:input-helper');
assert(files.bridge.includes('ensureInputHelper();'), 'bridge boot auto-builds input helper');
assert(files.computerUse.includes('localBrowserOpenUrl'), 'computerUse: local navigation uses browser bridge directly');
assert(files.computerUse.includes('runLocalBrowserReadAction'), 'computerUse: local observe/extract uses browser bridge DOM snapshot');
assert(files.computerUse.includes('chooseBrowserAutomationBackendPreference'), 'computerUse: backend optimizer is wired');
assert(files.computerUse.includes('ensureDesktopBridgePaired'), 'computerUse: legacy MCP fallback sends paired desktop token');
assert(files.computerUse.includes("jsonrpc: '2.0'") && files.computerUse.includes("id: `computer-use-"), 'computerUse: legacy MCP fallback sends JSON-RPC id');
assert(files.browserClient.includes('ensureDesktopBridgePaired'), 'browserBridge: browser actions auto-pair with desktop bridge');
assert(files.browserServer.includes('selectOption({ label: value }'), 'browser bridge: select falls back from option value to label');
assert(files.browserServer.includes("getByRole('option'"), 'browser bridge: custom dropdown select falls back to role=option');
assert(files.bridge.includes('function isBridgeOriginAllowed'), 'bridge security: origin allowlist helper exists');
assert(files.bridge.includes('function isDesktopTokenValid'), 'bridge security: token validation helper exists');
assert(files.bridge.includes("publicMcpMethods") && files.bridge.includes("!isDesktopTokenValid(req)"), 'bridge security: /mcp tool/resource calls require token');
assert(files.bridge.includes('function buildCorsHeaders'), 'bridge security: per-request CORS helper exists');
assert(files.bridge.includes("'Access-Control-Allow-Origin': origin") && files.bridge.includes("'Vary': 'Origin'"), 'bridge security: CORS reflects allowed origin instead of wildcard for browser requests');

if (failures > 0) {
  console.error(`\n${failures} desktop runtime wiring failure(s)`);
  process.exit(1);
}

console.log('\nAll desktop runtime wiring smoke cases passed.');
