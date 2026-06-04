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
  appAdapter: fs.readFileSync('src/lib/computerAppAdapter.ts', 'utf8'),
  intent: fs.readFileSync('src/lib/localComputerAwarenessIntent.ts', 'utf8'),
  capabilities: fs.readFileSync('src/lib/computerCapabilityRegistry.ts', 'utf8'),
  fileAdapter: fs.readFileSync('src/lib/computerFileAdapter.ts', 'utf8'),
  fileSearchQuery: fs.readFileSync('src/lib/fileSearchQuery.ts', 'utf8'),
  failureRecovery: fs.readFileSync('src/lib/agentFailureRecovery.ts', 'utf8'),
  connectedAgentDispatch: fs.readFileSync('src/lib/connectedAgentDispatch.ts', 'utf8'),
  chatFailureRecovery: fs.readFileSync('src/lib/chatFailureRecovery.ts', 'utf8'),
  assetAcquisitionPolicy: fs.readFileSync('src/lib/agentAssetAcquisitionPolicy.ts', 'utf8'),
  aiModalAdvisor: fs.readFileSync('src/lib/desktopAIModalAdvisor.ts', 'utf8'),
  browserAiModalAdvisor: fs.readFileSync('src/lib/browserAIModalAdvisor.ts', 'utf8'),
  chatTab: fs.readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8'),
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
  { name: 'desktop.file_stat', endpoint: '/desktop/file_stat', client: 'statFile', health: 'file_stat', readOnly: true },
  { name: 'desktop.file_rename', endpoint: '/desktop/file_rename', client: 'renameFile', health: 'file_rename', writeMode: true },
  { name: 'desktop.file_write_text', endpoint: '/desktop/file_write_text', client: 'writeTextFile', health: 'file_write_text', writeMode: true },
  { name: 'desktop.file_copy', endpoint: '/desktop/file_copy', client: 'copyFile', health: 'file_copy', writeMode: true },
  { name: 'desktop.file_trash', endpoint: '/desktop/file_trash', client: 'trashFile', health: 'file_trash', writeMode: true },
  { name: 'desktop.file_mkdir', endpoint: '/desktop/file_mkdir', client: 'createDirectory', health: 'file_mkdir', writeMode: true },
  { name: 'desktop.shortcuts_list', endpoint: '/desktop/shortcuts/list', client: 'listShortcuts', health: 'shortcuts_list', readOnly: true },
  { name: 'desktop.shortcuts_run', endpoint: '/desktop/shortcuts/run', client: 'runShortcut', health: 'shortcuts_run', writeMode: true },
  { name: 'desktop.window_manage', endpoint: '/desktop/window_manage', client: 'manageWindow', health: 'window_manage', writeMode: true },
  { name: 'desktop.mouse_move', endpoint: '/desktop/mouse_move', client: 'mouseMove', health: 'mouse_move', writeMode: true },
  { name: 'desktop.mouse_click', endpoint: '/desktop/mouse_click', client: 'mouseClick', health: 'mouse_click', writeMode: true },
  { name: 'desktop.mouse_down', endpoint: '/desktop/mouse_down', client: 'mouseDown', health: 'mouse_down', writeMode: true },
  { name: 'desktop.mouse_up', endpoint: '/desktop/mouse_up', client: 'mouseUp', health: 'mouse_up', writeMode: true },
  { name: 'desktop.mouse_drag', endpoint: '/desktop/mouse_drag', client: 'mouseDrag', health: 'mouse_drag', writeMode: true },
  { name: 'desktop.mouse_scroll', endpoint: '/desktop/mouse_scroll', client: 'mouseScroll', health: 'mouse_scroll', writeMode: true },
  { name: 'desktop.paste_text', endpoint: '/desktop/paste_text', client: 'pasteText', health: 'paste_text', writeMode: true },
  { name: 'desktop.menu_click', endpoint: '/desktop/menu_click', client: 'clickMenu', health: 'menu_click', writeMode: true },
  { name: 'desktop.indesign_document_status', endpoint: '/desktop/indesign_document_status', client: 'indesignDocumentStatus', health: 'indesign_document_status', readOnly: true },
  { name: 'desktop.indesign_text_inventory', endpoint: '/desktop/indesign_text_inventory', client: 'indesignTextInventory', health: 'indesign_text_inventory', readOnly: true },
  { name: 'desktop.indesign_set_layer_state', endpoint: '/desktop/indesign_set_layer_state', client: 'indesignSetLayerState', health: 'indesign_set_layer_state', writeMode: true },
  { name: 'desktop.indesign_batch_find_change', endpoint: '/desktop/indesign_batch_find_change', client: 'indesignBatchFindChange', health: 'indesign_batch_find_change', writeMode: true },
  { name: 'desktop.indesign_batch_update_text_layers', endpoint: '/desktop/indesign_batch_update_text_layers', client: 'indesignBatchUpdateTextLayers', health: 'indesign_batch_update_text_layers', writeMode: true },
  { name: 'desktop.indesign_update_text_layer', endpoint: '/desktop/indesign_update_text_layer', client: 'indesignUpdateTextLayer', health: 'indesign_update_text_layer', writeMode: true },
  { name: 'desktop.indesign_relink_asset', endpoint: '/desktop/indesign_relink_asset', client: 'indesignRelinkAsset', health: 'indesign_relink_asset', writeMode: true },
  { name: 'desktop.indesign_package_document', endpoint: '/desktop/indesign_package_document', client: 'indesignPackageDocument', health: 'indesign_package_document', writeMode: true },
  { name: 'desktop.indesign_export_proof', endpoint: '/desktop/indesign_export_proof', client: 'indesignExportProof', health: 'indesign_export_proof', writeMode: true },
  { name: 'desktop.photoshop_document_status', endpoint: '/desktop/photoshop_document_status', client: 'photoshopDocumentStatus', health: 'photoshop_document_status', readOnly: true },
  { name: 'desktop.photoshop_layer_inventory', endpoint: '/desktop/photoshop_layer_inventory', client: 'photoshopLayerInventory', health: 'photoshop_layer_inventory', readOnly: true },
  { name: 'desktop.photoshop_set_layer_state', endpoint: '/desktop/photoshop_set_layer_state', client: 'photoshopSetLayerState', health: 'photoshop_set_layer_state', writeMode: true },
  { name: 'desktop.photoshop_update_text_layer', endpoint: '/desktop/photoshop_update_text_layer', client: 'photoshopUpdateTextLayer', health: 'photoshop_update_text_layer', writeMode: true },
  { name: 'desktop.photoshop_place_asset', endpoint: '/desktop/photoshop_place_asset', client: 'photoshopPlaceAsset', health: 'photoshop_place_asset', writeMode: true },
  { name: 'desktop.photoshop_export_proof', endpoint: '/desktop/photoshop_export_proof', client: 'photoshopExportProof', health: 'photoshop_export_proof', writeMode: true },
  { name: 'desktop.read_a11y_tree', endpoint: '/desktop/a11y_tree', client: 'readA11yTree', health: 'a11y_tree', readOnly: true },
  { name: 'desktop.click_element', endpoint: '/desktop/click_element', client: 'clickElement', health: 'click_element', writeMode: true },
  { name: 'desktop.set_element_value', endpoint: '/desktop/set_element_value', client: 'setElementValue', health: 'set_element_value', writeMode: true },
];

const browserTools = [
  { name: 'browser.open_url', endpoint: '/browser/open_url', client: 'openUrl', handler: 'handleOpenUrl', writeMode: true },
  { name: 'browser.dom_snapshot', endpoint: '/browser/dom_snapshot', client: 'domSnapshot', handler: 'handleDomSnapshot', readOnly: true },
  { name: 'browser.click_role', endpoint: '/browser/click_role', client: 'clickRole', handler: 'handleClickRole', writeMode: true },
  { name: 'browser.fill_field', endpoint: '/browser/fill', client: 'fillField', handler: 'handleFill', writeMode: true },
  { name: 'browser.select_option', endpoint: '/browser/select', client: 'selectOption', handler: 'handleSelect', writeMode: true },
  { name: 'browser.upload_file', endpoint: '/browser/upload_file', client: 'uploadFile', handler: 'handleUploadFile', writeMode: true },
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
  'desktop.file_stat',
  'desktop.file_rename',
  'desktop.file_write_text',
  'desktop.file_copy',
  'desktop.file_trash',
  'desktop.file_mkdir',
  'desktop.shortcuts_run',
  'desktop.window_manage',
  'desktop.mouse_move',
  'desktop.mouse_click',
  'desktop.mouse_down',
  'desktop.mouse_up',
  'desktop.mouse_drag',
  'desktop.mouse_scroll',
  'desktop.paste_text',
  'desktop.menu_click',
  'desktop.indesign_set_layer_state',
  'desktop.indesign_batch_find_change',
  'desktop.indesign_batch_update_text_layers',
  'desktop.indesign_relink_asset',
  'desktop.indesign_package_document',
  'desktop.indesign_export_proof',
  'desktop.photoshop_document_status',
  'desktop.photoshop_layer_inventory',
  'desktop.photoshop_set_layer_state',
  'desktop.photoshop_export_proof',
  'desktop.read_a11y_tree',
  'desktop.set_element_value',
  'browser.open_url',
  'browser.dom_snapshot',
  'browser.click_role',
  'browser.fill_field',
  'browser.select_option',
  'browser.upload_file',
  'agent.codex_acquire_asset',
  'agent.recover_failed_task',
  'browser.press_key',
  'browser.screenshot',
]) {
  assert(files.planner.includes(plannerTool), `${plannerTool}: planner can recommend`);
}

assert(Boolean(files.pkg.scripts['smoke:local-desktop-bridge-intent']), 'package script: smoke:local-desktop-bridge-intent');
assert(Boolean(files.pkg.scripts['smoke:photoshop-save-dialog']), 'package script: smoke:photoshop-save-dialog');
assert(Boolean(files.pkg.scripts['smoke:desktop-ai-modal-advisor']), 'package script: smoke:desktop-ai-modal-advisor');
assert(Boolean(files.pkg.scripts['smoke:browser-ai-modal-advisor']), 'package script: smoke:browser-ai-modal-advisor');
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
assert(files.browserClient.includes('requiredEvidence') && files.browserClient.includes('recoveryHint') && files.browserClient.includes('browserFailureResult'), 'browserBridge: failures preserve structured recovery fields');
assert(files.browserServer.includes('selectOption({ label: value }'), 'browser bridge: select falls back from option value to label');
assert(files.browserServer.includes("getByRole('option'"), 'browser bridge: custom dropdown select falls back to role=option');
assert(files.browserServer.includes('handleUploadFile') && files.browserServer.includes('setInputFiles') && files.browserServer.includes('filechooser'), 'browser bridge: upload_file supports file input and file chooser paths');
assert(files.runtime.includes("case 'browser.upload_file'") && files.runtime.includes('requestLocalFileSessionGrant'), 'OpenSwan runtime: browser upload auto-prepares a scoped local file grant');
assert(!files.runtime.includes('hasActiveLocalFileSessionGrant'), 'OpenSwan runtime: desktop tools do not block on stale local file verification prechecks');
assert(files.runtime.includes('type BrowserToolExecutionResult') && files.runtime.includes('requiredEvidence?: string[]') && files.runtime.includes('browserToolFailureResult'), 'OpenSwan runtime: browser failures preserve recovery metadata');
assert(files.runtime.includes("name: 'agent.codex_acquire_asset'") && files.runtime.includes("case 'agent.codex_acquire_asset'") && files.runtime.includes('fetchCodexSessions') && files.runtime.includes('launchCodexSessions'), 'OpenSwan runtime: Codex asset acquisition is exposed and executable');
assert(files.runtime.includes("'agent.codex_acquire_asset': ['execute', 'build']") && files.runtime.includes("tool === 'agent.codex_acquire_asset'"), 'OpenSwan runtime: Codex asset acquisition is action-mode and approval gated');
assert(files.runtime.includes("name: 'agent.recover_failed_task'") && files.runtime.includes("case 'agent.recover_failed_task'") && files.runtime.includes('startConnectedAgentFailureRecovery'), 'OpenSwan runtime: failed-task recovery is exposed and executable');
assert(files.runtime.includes("'agent.recover_failed_task': ['execute', 'support', 'build']") && files.runtime.includes("tool === 'agent.recover_failed_task'"), 'OpenSwan runtime: failed-task recovery is mode-scoped and approval gated');
assert(
  files.failureRecovery.includes('buildAgentFailureRecoveryPolicy')
  && files.failureRecovery.includes('dispatchConnectedAgentTask')
  && files.connectedAgentDispatch.includes('sendTerminalAgentSessionMessage')
  && /launch(?:Codex|ClaudeCode|GeminiCli|CursorComposer)Sessions/.test(files.connectedAgentDispatch),
  'failure recovery policy can reuse or launch connected agent sessions (provider-agnostic dispatch)',
);
assert(files.chatTab.includes('startMainChatFailureRecovery') && files.chatTab.includes('startChatFailureRecovery') && files.chatTab.includes('Chat failure recovery'), 'ChatTab: chat/computer failures hand off to bounded connected-agent recovery');
assert(files.chatTab.includes('addRecoverableChatErrorMessage') && files.chatTab.includes('terminal_agent_control_error') && files.chatTab.includes('memory_bank_command_error') && files.chatTab.includes('desktop_diag_error') && files.chatTab.includes('agent_plan_mode_error'), 'ChatTab: first-pass command errors use shared recovery handoff');
assert(files.chatTab.includes('bridge_probe_command_error') && files.chatTab.includes('assign_agent_command_error') && files.chatTab.includes('schedule_command_error') && files.chatTab.includes('github_command_error') && files.chatTab.includes('web_search_failure') && files.chatTab.includes('pair_desktop_bridge_error'), 'ChatTab: command/bridge/provider exceptions use shared recovery handoff');
assert(files.chatFailureRecovery.includes('buildChatFailureRecoveryFingerprint') && files.chatFailureRecovery.includes('shouldSuppressDuplicateChatFailureHandoff') && files.chatFailureRecovery.includes('lastSuccessfulHandoffAt') && files.chatTab.includes('CHAT_FAILURE_RECOVERY_REPEAT_WINDOW_MS'), 'ChatTab: repeated chat failures are fingerprinted and duplicate handoffs are success-aware');
assert(files.chatTab.includes('Resolved send model:') && files.chatTab.includes('Connected providers:') && files.chatTab.includes('Route intent:'), 'ChatTab: recovery prompt includes route, model, and provider context');
assert(files.chatFailureRecovery.includes('buildChatFailureRecoveryVerificationPlan') && files.chatFailureRecovery.includes('verificationCommands') && files.chatFailureRecovery.includes('recoveryRunbook') && files.chatFailureRecovery.includes('npm run smoke:openswan-task-planner') && files.chatFailureRecovery.includes('npm run smoke:browser-bridge') && files.chatFailureRecovery.includes('npm run typecheck'), 'Chat failure recovery includes source-specific verification commands and runbook metadata');
assert(files.failureRecovery.includes('AgentFailureRecoveryRunbook') && files.failureRecovery.includes('coordinationMode') && files.failureRecovery.includes('decompose-complex-task') && files.failureRecovery.includes('CHECKPOINTS') && files.runtime.includes('recoveryRunbook'), 'failure recovery exposes a machine-readable runbook with complex-task checkpoints through OpenSwan tools');
assert(files.assetAcquisitionPolicy.includes('buildAgentAssetAcquisitionPolicy') && files.runtime.includes('formatAgentAssetAcquisitionPolicySummary'), 'asset acquisition runtime uses the bounded acquisition policy');
assert(files.bridge.includes('function isBridgeOriginAllowed'), 'bridge security: origin allowlist helper exists');
assert(files.bridge.includes('function isDesktopTokenValid'), 'bridge security: token validation helper exists');
assert(files.bridge.includes("publicMcpMethods") && files.bridge.includes("!isDesktopTokenValid(req)"), 'bridge security: /mcp tool/resource calls require token');
assert(files.bridge.includes('function buildCorsHeaders'), 'bridge security: per-request CORS helper exists');
assert(files.bridge.includes("'Access-Control-Allow-Origin': origin") && files.bridge.includes("'Vary': 'Origin'"), 'bridge security: CORS reflects allowed origin instead of wildcard for browser requests');
assert(/const\s+url\s*=\s*req\.url\.split\(['"]\?['"]\)\[0\]/.test(files.bridge), 'bridge routing: desktop endpoints ignore query string');
assert(files.client.includes("openPath(rawPath: string, options: { appName?: string }") && files.bridge.includes("'-a', resolved?.appPath || targetAppName") && files.appAdapter.includes("bridgeOpenPath(openPath, intent.appQuery ? { appName: intent.appQuery }"), 'open file search: app-specific file open is wired for design documents');
assert(files.client.includes("focusMode?: 'require' | 'best_effort' | 'skip'"), 'desktopBridge: paste supports focus modes');
assert(files.bridge.includes("focusMode === 'best_effort'") && files.bridge.includes("focusMode === 'skip'"), 'bridge paste: supports best-effort and skip focus');
assert(files.bridge.includes('focusWarning') && files.client.includes('focusWarning'), 'bridge paste: returns non-fatal focus warnings');
assert(files.appAdapter.includes("focusMode: options.sequenceMode ? 'best_effort' : 'require'"), 'app adapter: deterministic sequences use best-effort paste focus');
assert(files.appAdapter.includes('desktop_focus_app warning before key press') && files.appAdapter.includes('desktop_focus_app warning before typing'), 'app adapter: deterministic sequences do not fail on non-fatal focus warnings');
assert(files.appAdapter.includes('appName: options.sequenceMode ? undefined : intent.appQuery'), 'app adapter: deterministic sequence paste remains compatible with older bridges');
assert(files.bridge.includes('function menuLabelVariants') && files.bridge.includes('menu item not found'), 'bridge menu click: supports ellipsis menu label variants');
assert(files.client.includes('function indesignFindChange') && files.client.includes('/desktop/indesign_find_change'), 'desktopBridge: InDesign script-backed Find/Change client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_find_change'") && files.bridge.includes('buildInDesignFindChangeScript'), 'bridge endpoint: InDesign script-backed Find/Change is wired');
assert(files.intent.includes("'indesign_find_change'") && files.appAdapter.includes('bridgeInDesignFindChange'), 'app adapter: exact InDesign Find/Change avoids fragile AX field targeting');
assert(files.client.includes('function indesignDocumentStatus') && files.client.includes('/desktop/indesign_document_status'), 'desktopBridge: read-only InDesign document status client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_document_status'") && files.bridge.includes('buildInDesignDocumentStatusScript'), 'bridge endpoint: read-only InDesign document status is wired');
assert(files.intent.includes("'indesign_document_status'") && files.appAdapter.includes('bridgeInDesignDocumentStatus'), 'app adapter: InDesign status probe is available to chat');
assert(files.client.includes('function indesignTextInventory') && files.client.includes('/desktop/indesign_text_inventory'), 'desktopBridge: read-only InDesign text inventory client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_text_inventory'") && files.bridge.includes('buildInDesignTextInventoryScript'), 'bridge endpoint: read-only InDesign text inventory is wired');
assert(files.intent.includes("'indesign_text_inventory'") && files.appAdapter.includes('bridgeInDesignTextInventory'), 'app adapter: InDesign text inventory can diagnose missing layer targets');
assert(files.bridge.includes('stringifyInDesignTextInventory') && files.bridge.includes('oversetFrames') && files.bridge.includes('contentPreview') && files.bridge.includes('queryMatches') && files.bridge.includes('matchCount'), 'bridge endpoint: InDesign text inventory returns JSON-free frame diagnostics with per-frame query match counts');
assert(files.client.includes('function indesignUpdateTextLayer') && files.client.includes('/desktop/indesign_update_text_layer'), 'desktopBridge: script-backed InDesign text layer update client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_update_text_layer'") && files.bridge.includes('buildInDesignUpdateTextLayerScript'), 'bridge endpoint: script-backed InDesign text layer update is wired');
assert(files.intent.includes("'indesign_update_text_layer'") && files.appAdapter.includes('bridgeInDesignUpdateTextLayer'), 'app adapter: InDesign text layer updates avoid fragile Layers panel clicking');
assert(files.bridge.includes('fieldAliases') && files.bridge.includes('updatedFrames') && files.bridge.includes('stringifyInDesignTextLayerResult'), 'bridge endpoint: InDesign text layer update supports dealer field aliases and JSON-free ExtendScript results');
assert(files.client.includes('function indesignSetLayerState') && files.client.includes('/desktop/indesign_set_layer_state'), 'desktopBridge: script-backed InDesign layer-state client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_set_layer_state'") && files.bridge.includes('buildInDesignSetLayerStateScript'), 'bridge endpoint: script-backed InDesign layer-state is wired');
assert(files.bridge.includes('layer.visible = true') && files.bridge.includes('layer.locked = true') && files.bridge.includes('Layer target is ambiguous'), 'bridge endpoint: InDesign layer state uses DOM visible/locked state and refuses ambiguity');
assert(files.intent.includes("'indesign_set_layer_state'") && files.intent.includes('local-indesign-set-layer-state'), 'local intent: InDesign layer-state routes directly to bridge tool');
assert(files.appAdapter.includes('bridgeInDesignSetLayerState') && files.appAdapter.includes('desktop_indesign_set_layer_state'), 'app adapter: InDesign layer-state executes through bridge tool');
assert(files.runtime.includes("name: 'desktop.indesign_set_layer_state'") && files.runtime.includes("case 'desktop.indesign_set_layer_state'"), 'OpenSwan runtime: InDesign layer-state is exposed and executable');
assert(files.bridge.includes('temporarilyUnlockDocument') && files.bridge.includes('find-change-unlocked'), 'bridge endpoint: InDesign Find/Change has lock-safe recovery');
assert(files.appAdapter.includes('indesign_find_change used lock-safe recovery') && files.client.includes('unlockedCount'), 'app adapter: InDesign lock-safe recovery is surfaced to chat');
assert(files.bridge.includes('remaining = countCurrentMatches(findText)') && files.client.includes('replacementMatches') && files.appAdapter.includes('Verified no original matches remain'), 'InDesign Find/Change verifies remaining source text after execution');
assert(files.appAdapter.includes('indesign_find_change inspected text inventory') && files.client.includes('queryMatches') && files.runtime.includes('matchCount'), 'InDesign Find/Change can diagnose unchanged text with inventory match counts');
assert(files.client.includes('function indesignBatchFindChange') && files.client.includes('/desktop/indesign_batch_find_change'), 'desktopBridge: batch InDesign Find/Change client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_batch_find_change'") && files.bridge.includes('buildInDesignBatchFindChangeScript'), 'bridge endpoint: batch InDesign Find/Change is wired');
assert(files.intent.includes("'indesign_batch_find_change'") && files.intent.includes('replacements?:') && files.appAdapter.includes('bridgeInDesignBatchFindChange'), 'app adapter: batch InDesign Find/Change avoids per-step UI targeting');
assert(files.runtime.includes("name: 'desktop.indesign_batch_find_change'") && files.runtime.includes("case 'desktop.indesign_batch_find_change'"), 'OpenSwan runtime: batch InDesign Find/Change is exposed and executable');
assert(files.bridge.includes('stringifyBatchResult') && files.bridge.includes('stringifyPairResult') && files.bridge.includes('replacementMatches') && files.bridge.includes('find-change-unlocked'), 'bridge endpoint: batch InDesign Find/Change has JSON-free per-pair verification and lock-safe recovery');
assert(files.client.includes('function indesignBatchUpdateTextLayers') && files.client.includes('/desktop/indesign_batch_update_text_layers'), 'desktopBridge: batch InDesign text-layer update client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_batch_update_text_layers'") && files.bridge.includes('buildInDesignBatchUpdateTextLayersScript'), 'bridge endpoint: batch InDesign text-layer update is wired');
assert(files.intent.includes("'indesign_batch_update_text_layers'") && files.intent.includes('fieldUpdates?:') && files.appAdapter.includes('bridgeInDesignBatchUpdateTextLayers'), 'app adapter: batch InDesign text-layer updates avoid repeated UI targeting');
assert(files.runtime.includes("name: 'desktop.indesign_batch_update_text_layers'") && files.runtime.includes("case 'desktop.indesign_batch_update_text_layers'"), 'OpenSwan runtime: batch InDesign text-layer update is exposed and executable');
assert(files.bridge.includes('stringifyBatchTextLayerResult') && files.bridge.includes('applyFieldUpdate') && files.bridge.includes('replacementMatches'), 'bridge endpoint: batch InDesign text-layer update returns JSON-free per-field verification');
assert(files.client.includes('function indesignRelinkAsset') && files.client.includes('/desktop/indesign_relink_asset'), 'desktopBridge: InDesign asset relink client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_relink_asset'") && files.bridge.includes('buildInDesignRelinkAssetScript'), 'bridge endpoint: InDesign asset relink is wired');
assert(files.bridge.includes('targets[t].relink(newFile)') && files.bridge.includes('collectItemLinks'), 'bridge endpoint: InDesign asset relink uses app-native link relink');
assert(files.bridge.includes("requireLocalFileAccessGrant(req, parsedUrl, assetPath, 'read')"), 'bridge endpoint: InDesign asset relink requires local file read grant');
assert(files.client.includes("ensureLocalFileGrantHeaders([assetPathResult.path], 'read'"), 'desktopBridge: InDesign asset relink auto-prepares local read grant headers');
assert(files.intent.includes("'indesign_relink_asset'") && files.intent.includes('local-indesign-relink-asset'), 'local intent: InDesign relink asset routes directly to bridge tool');
assert(files.appAdapter.includes('bridgeInDesignRelinkAsset') && files.appAdapter.includes('desktop_indesign_relink_asset'), 'app adapter: InDesign asset relink executes through bridge tool');
assert(files.runtime.includes("name: 'desktop.indesign_relink_asset'") && files.runtime.includes("case 'desktop.indesign_relink_asset'"), 'OpenSwan runtime: InDesign asset relink is exposed and executable');
assert(files.client.includes('function indesignPackageDocument') && files.client.includes('/desktop/indesign_package_document'), 'desktopBridge: InDesign package document client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_package_document'") && files.bridge.includes('buildInDesignPackageDocumentScript'), 'bridge endpoint: InDesign package document is wired');
assert(files.bridge.includes('doc.packageForPrint') && files.bridge.includes('summarizeDesktopDirectory'), 'bridge endpoint: InDesign package uses app-native packageForPrint and summarizes output');
assert(files.bridge.includes("requireLocalFileAccessGrant(req, parsedUrl, outputFolderPath, 'write')"), 'bridge endpoint: InDesign package requires local output folder write grant');
assert(files.client.includes("ensureLocalFileGrantHeaders([outputPathResult.path], 'write'"), 'desktopBridge: InDesign package auto-prepares local write grant headers');
assert(files.intent.includes("'indesign_package_document'") && files.intent.includes('local-indesign-package-document'), 'local intent: InDesign package handoff routes directly to bridge tool');
assert(files.appAdapter.includes('bridgeInDesignPackageDocument') && files.appAdapter.includes('desktop_indesign_package_document'), 'app adapter: InDesign package executes through bridge tool');
assert(files.runtime.includes("name: 'desktop.indesign_package_document'") && files.runtime.includes("case 'desktop.indesign_package_document'"), 'OpenSwan runtime: InDesign package document is exposed and executable');
assert(files.client.includes('function indesignExportProof') && files.client.includes('/desktop/indesign_export_proof'), 'desktopBridge: InDesign proof export client is wired');
assert(files.bridge.includes("url === '/desktop/indesign_export_proof'") && files.bridge.includes('buildInDesignExportProofScript'), 'bridge endpoint: InDesign proof export is wired');
assert(files.bridge.includes('doc.exportFile(pdfType, outputFile, false)') && files.bridge.includes('ExportFormat.PDF_TYPE'), 'bridge endpoint: InDesign proof export uses app-native PDF export');
assert(files.bridge.includes('requireLocalFileAccessGrant(req, parsedUrl, outputPath, \'write\')'), 'bridge endpoint: InDesign proof export requires local file write grant');
assert(files.client.includes("ensureLocalFileGrantHeaders([outputPathResult.path], 'write'"), 'desktopBridge: proof exports auto-prepare local write grant headers');
assert(files.intent.includes("'indesign_export_proof'") && files.intent.includes('local-indesign-proof-export'), 'local intent: InDesign proof PDF export routes directly to bridge tool');
assert(files.appAdapter.includes('bridgeInDesignExportProof') && files.appAdapter.includes('desktop_indesign_export_proof'), 'app adapter: InDesign proof export executes through bridge tool');
assert(files.runtime.includes("name: 'desktop.indesign_export_proof'") && files.runtime.includes("case 'desktop.indesign_export_proof'"), 'OpenSwan runtime: InDesign proof export is exposed and executable');
assert(files.bridge.includes('stringifyInDesignResult') && !files.bridge.includes('return JSON.stringify(result);'), 'InDesign Find/Change serializes results without relying on ExtendScript JSON');
assert(files.bridge.includes('stringifyInDesignStatus') && files.bridge.includes('missingLinks') && files.bridge.includes('missingFonts'), 'InDesign status serializes preflight-style diagnostics without relying on ExtendScript JSON');
assert(files.appAdapter.includes('indesign_find_change already applied') && files.appAdapter.includes('appears to already be applied'), 'app adapter: InDesign retry after successful partial response is reported as already applied');
assert(files.bridge.includes('Active InDesign document mismatch') && files.client.includes('expectedDocumentName') && files.appAdapter.includes('expectedInDesignDocumentName'), 'InDesign Find/Change guards against editing the wrong active document');
assert(files.bridge.includes('sourceDocumentPath') && files.bridge.includes('openSourceDocument') && files.appAdapter.includes('expectedInDesignDocumentPath'), 'InDesign Find/Change can reopen the exact source file when no document is active');
assert(files.bridge.includes('macAppVersionRank') && files.bridge.includes('versionRank > best.versionRank'), 'bridge app resolver: generic Adobe app names prefer the newest installed version');
assert(files.bridge.includes('function resolveInDesignMacApp') && files.bridge.includes('getRunningInDesignDocumentCount') && files.bridge.includes('resolveInDesignMacApp(appName ||'), 'bridge app resolver: generic InDesign commands prefer the running instance with an open document');
assert(files.client.includes('function photoshopDocumentStatus') && files.client.includes('/desktop/photoshop_document_status'), 'desktopBridge: read-only Photoshop document status client is wired');
assert(files.client.includes('function photoshopLayerInventory') && files.client.includes('/desktop/photoshop_layer_inventory'), 'desktopBridge: read-only Photoshop layer inventory client is wired');
assert(files.client.includes('function photoshopSetLayerState') && files.client.includes('/desktop/photoshop_set_layer_state'), 'desktopBridge: script-backed Photoshop layer-state client is wired');
assert(files.client.includes('function photoshopUpdateTextLayer') && files.client.includes('/desktop/photoshop_update_text_layer'), 'desktopBridge: Photoshop text layer update client is wired');
assert(files.client.includes('function photoshopPlaceAsset') && files.client.includes('/desktop/photoshop_place_asset'), 'desktopBridge: Photoshop place asset client is wired');
assert(files.client.includes('function photoshopExportProof') && files.client.includes('/desktop/photoshop_export_proof'), 'desktopBridge: Photoshop proof export client is wired');
assert(files.bridge.includes("url === '/desktop/photoshop_document_status'") && files.bridge.includes('buildPhotoshopDocumentStatusScript'), 'bridge endpoint: read-only Photoshop document status is wired');
assert(files.bridge.includes("url === '/desktop/photoshop_layer_inventory'") && files.bridge.includes('buildPhotoshopLayerInventoryScript'), 'bridge endpoint: read-only Photoshop layer inventory is wired');
assert(files.bridge.includes("url === '/desktop/photoshop_set_layer_state'") && files.bridge.includes('buildPhotoshopSetLayerStateScript'), 'bridge endpoint: script-backed Photoshop layer-state is wired');
assert(files.bridge.includes("url === '/desktop/photoshop_update_text_layer'") && files.bridge.includes('buildPhotoshopUpdateTextLayerScript'), 'bridge endpoint: Photoshop text layer update is wired');
assert(files.bridge.includes("url === '/desktop/photoshop_place_asset'") && files.bridge.includes('buildPhotoshopPlaceAssetScript'), 'bridge endpoint: Photoshop place asset is wired');
assert(files.bridge.includes("url === '/desktop/photoshop_export_proof'") && files.bridge.includes('buildPhotoshopExportProofScript'), 'bridge endpoint: Photoshop proof export is wired');
assert(files.runtime.includes("name: 'desktop.photoshop_document_status'") && files.runtime.includes("case 'desktop.photoshop_document_status'"), 'OpenSwan runtime: Photoshop document status is exposed and executable');
assert(files.runtime.includes("name: 'desktop.photoshop_layer_inventory'") && files.runtime.includes("case 'desktop.photoshop_layer_inventory'"), 'OpenSwan runtime: Photoshop layer inventory is exposed and executable');
assert(files.runtime.includes("name: 'desktop.photoshop_set_layer_state'") && files.runtime.includes("case 'desktop.photoshop_set_layer_state'"), 'OpenSwan runtime: Photoshop layer-state is exposed and executable');
assert(files.runtime.includes("name: 'desktop.photoshop_update_text_layer'") && files.runtime.includes("case 'desktop.photoshop_update_text_layer'"), 'OpenSwan runtime: Photoshop text layer update is exposed and executable');
assert(files.runtime.includes("name: 'desktop.photoshop_place_asset'") && files.runtime.includes("case 'desktop.photoshop_place_asset'"), 'OpenSwan runtime: Photoshop asset placement is exposed and executable');
assert(files.runtime.includes("name: 'desktop.photoshop_export_proof'") && files.runtime.includes("case 'desktop.photoshop_export_proof'"), 'OpenSwan runtime: Photoshop proof export is exposed and executable');
assert(files.bridge.includes('function resolvePhotoshopMacApp') && files.bridge.includes('getRunningPhotoshopDocumentCount') && files.bridge.includes('resolvePhotoshopMacApp(appName ||'), 'bridge app resolver: generic Photoshop commands prefer the running instance with an open document');
assert(files.bridge.includes('do javascript') && files.bridge.includes('photoshopJsxPrelude') && files.bridge.includes('layerHasMask'), 'bridge endpoint: Photoshop tools use script-backed document/layer inspection instead of only coordinates');
assert(files.bridge.includes('requireLocalFileAccessGrant(req, parsedUrl, outputPath, \'write\')'), 'bridge endpoint: Photoshop proof export requires local file write grant');
assert(files.bridge.includes('requireLocalFileAccessGrant(req, parsedUrl, assetPath, \'read\')'), 'bridge endpoint: Photoshop asset placement requires local file read grant');
assert(files.bridge.includes('return { ok: true, root: realpathOrResolve(parent) }'), 'bridge file grants accept file/output paths by granting their containing folder');
assert(files.client.includes('homeAlias') && files.client.includes('root.startsWith(`${homeAlias}/`)'), 'desktopBridge: cached absolute home grants cover tilde file paths');
assert(files.client.includes("ensureLocalFileGrantHeaders([assetPathResult.path], 'read'") && files.client.includes("ensureLocalFileGrantHeaders([outputPathResult.path], 'write'"), 'desktopBridge: Photoshop asset/proof tools auto-prepare scoped local file grant headers');
assert(files.appAdapter.includes('bridgePhotoshopDocumentStatus') && files.appAdapter.includes('desktop_photoshop_document_status'), 'app adapter: Photoshop document status executes through bridge tool');
assert(files.appAdapter.includes('bridgePhotoshopLayerInventory') && files.appAdapter.includes('desktop_photoshop_layer_inventory'), 'app adapter: Photoshop layer inventory executes through bridge tool');
assert(files.intent.includes("'photoshop_set_layer_state'") && files.intent.includes('local-photoshop-set-layer-state'), 'local intent: Photoshop layer-state routes directly to bridge tool');
assert(files.appAdapter.includes('bridgePhotoshopSetLayerState') && files.appAdapter.includes('desktop_photoshop_set_layer_state'), 'app adapter: Photoshop layer-state executes through bridge tool');
assert(files.appAdapter.includes('bridgePhotoshopUpdateTextLayer') && files.appAdapter.includes('desktop_photoshop_update_text_layer'), 'app adapter: Photoshop text-layer update executes through bridge tool');
assert(files.appAdapter.includes('bridgePhotoshopPlaceAsset') && files.appAdapter.includes('desktop_photoshop_place_asset'), 'app adapter: Photoshop asset placement executes through bridge tool');
assert(files.appAdapter.includes('bridgePhotoshopExportProof') && files.appAdapter.includes('desktop_photoshop_export_proof'), 'app adapter: Photoshop proof export executes through bridge tool');
assert(files.appAdapter.includes('runPhotoshopSaveForWebExportFallback') && files.appAdapter.includes('desktop_photoshop_save_for_web_fallback'), 'app adapter: stale Photoshop proof endpoint falls back to Save for Web');
assert(files.appAdapter.includes('setSaveDialogFilename') && files.appAdapter.includes('desktop_save_dialog_missing'), 'app adapter: save-as filename path verifies dialog before reporting success');
assert(files.appAdapter.includes('maybeConfirmPostSaveOptions') && files.appAdapter.includes('desktop_save_options_confirmed'), 'app adapter: confirms post-save image options when present');
assert(files.appAdapter.includes('treeLooksLikeSaveExtensionMismatchDialog') && files.appAdapter.includes('desktop_save_extension_mismatch_confirmed'), 'app adapter: keeps requested extension on macOS save extension mismatch');
assert(files.appAdapter.includes('treeLooksLikeSaveReplaceExistingDialog') && files.appAdapter.includes('desktop_save_replace_existing_confirmed'), 'app adapter: replaces the requested existing Photoshop export file when the user asked to overwrite');
assert(files.appAdapter.includes('decideBlockingModalWithAdvisor') && files.appAdapter.includes('callBlackSwan') && files.appAdapter.includes('desktop_ai_modal_decision_needed'), 'app adapter: unknown blocking modals route through guarded AI modal advisor');
assert(files.aiModalAdvisor.includes('buildDesktopAIModalDecisionPrompt') && files.aiModalAdvisor.includes('validateDesktopAIModalCandidate') && files.aiModalAdvisor.includes('parseDesktopAIModalCandidate') && files.aiModalAdvisor.includes('Never auto-click credentials'), 'AI modal advisor: prompt and guardrail validator exist');
assert(files.aiModalAdvisor.includes('keep_requested_extension') && files.aiModalAdvisor.includes('findPreferredSaveExtensionMismatchButton') && files.aiModalAdvisor.includes('taskMentionsExtension') && files.aiModalAdvisor.includes('Auto-click a file-extension mismatch only when the popup keeps the extension requested by the user task.'), 'AI modal advisor: requested-extension mismatch popups are guarded by task intent');
assert(files.browserAiModalAdvisor.includes('buildBrowserAIModalDecisionPrompt') && files.browserAiModalAdvisor.includes('validateBrowserAIModalCandidate') && files.browserAiModalAdvisor.includes('parseBrowserAIModalCandidate') && files.browserAiModalAdvisor.includes('Never accept credentials'), 'browser AI modal advisor: prompt and guardrail validator exist');
assert(files.browserServer.includes('runWithBrowserDialogHandling') && files.browserServer.includes('browser_dialog_blocked') && files.browserServer.includes('decideBrowserDialogAction'), 'browser bridge: native browser dialogs route through guarded popup policy');
assert(files.computerUse.includes('taskContext: browserTaskContext') && files.browserClient.includes('taskContext?: string'), 'browser runtime: original task context reaches browser popup handling');
assert(files.appAdapter.includes('verifySaveDialogOutputFile') && files.appAdapter.includes('desktop_save_output_verified'), 'app adapter: verifies local Photoshop save output before reporting completion');
assert(files.appAdapter.includes('ensureSaveForWebFormat') && files.appAdapter.includes('desktop_save_for_web_format_selected'), 'app adapter: sets the requested Save for Web format before clicking Save');
assert(files.intent.includes('local-save-for-web-save-button') && files.intent.includes('Cmd+Opt+Shift+S') && files.intent.includes('format: format || undefined'), 'local intent: Photoshop image exports carry the requested Save for Web format before filename dialog');
assert(files.intent.includes('expandPhotoshopTaskMacro') && files.intent.includes('local-photoshop-generative-fill') && files.intent.includes('local-photoshop-generate-image'), 'local intent: Photoshop edit and AI task macros are wired');
assert(files.intent.includes('expandInDesignTaskMacro') && files.intent.includes('local-indesign-place-file') && files.intent.includes('local-indesign-export-file'), 'local intent: InDesign layout and export task macros are wired');
assert(files.intent.includes('expandMacDashboardMacro') && files.intent.includes('local-mac-mission-control') && files.intent.includes('local-mac-system-settings-query'), 'local intent: Mac dashboard macros are wired');
assert(!files.chatTab.includes('getPredictiveChatCommands') && files.chatTab.includes('const showPredictiveCommands = false'), 'chat composer: predictive command pop-up is hidden');
assert(files.appAdapter.includes('clickSaveForWebSaveButton') && files.appAdapter.includes('desktop_save_for_web_save_clicked'), 'app adapter: verifies Save for Web dialog before clicking Save');
assert(files.capabilities.includes("bridgeTools.has('file_search')") && files.capabilities.includes("bridgeTools.has('file_read')") && files.capabilities.includes("bridgeTools.has('file_stat')") && files.capabilities.includes("bridgeTools.has('file_rename')"), 'capability audit: desktop bridge advertises file_search/file_read/file_stat/file_rename');
assert(files.fileAdapter.includes('executeDesktopBridgeFileTask') && files.fileAdapter.includes('searchFiles(plan.rootPath, query') && files.fileAdapter.includes('statFile(') && files.fileAdapter.includes('renameFile(source.path, toPath') && files.fileAdapter.includes('copyFile(source.path, toPath') && files.fileAdapter.includes('trashFile(source.path') && files.fileAdapter.includes('writeTextFile(targetPath') && files.fileAdapter.includes('createDirectory(targetPath'), 'file adapter: uses desktop bridge file search/stat/write tools before MCP fallback');
assert(files.fileSearchQuery.includes('extractFilenameLikeFromText') && files.fileSearchQuery.includes('normalizeDesktopFileSearchQuery'), 'file search query: shared sanitizer exists');
assert(files.client.includes('normalizeDesktopFileSearchQuery(query)'), 'desktopBridge: file search normalizes natural-language queries');
assert(files.fileAdapter.includes('normalizeDesktopFileSearchQuery(task)'), 'file adapter: plan query uses shared sanitizer');
assert(files.fileAdapter.includes('extractRenameIntent') && files.fileAdapter.includes("mode: 'rename'"), 'file adapter: natural-language rename intent is parsed');
assert(files.fileSearchQuery.includes('TOKEN_FILENAME_RE'), 'file search query: prefers filename tokens inside commands');
assert(files.chatTab.includes('requestLocalFileSessionGrant') && files.chatTab.includes('Prepared scoped local file') && !files.chatTab.includes('Local file access could not be verified'), 'ChatTab: local file access is prepared without a separate browser verification prompt');

if (failures > 0) {
  console.error(`\n${failures} desktop runtime wiring failure(s)`);
  process.exit(1);
}

console.log('\nAll desktop runtime wiring smoke cases passed.');
