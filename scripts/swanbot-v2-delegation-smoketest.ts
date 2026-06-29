/**
 * swanbot-v2-delegation-smoketest — verifies the client-side tool
 * dispatcher used by `callSwanBotV2`'s M2 continuation loop. We test
 * the shape of the `toolResults` it produces for every tool-call
 * scenario without hitting the real bridge.
 *
 * Run: npm run smoke:swanbot-v2-delegation
 */

import {
  SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS,
  dispatchSwanBotDesktopClientTool,
  serializeSwanBotClientToolError,
  serializeSwanBotClientToolResult,
  type SwanBotDesktopClientToolBridge,
} from '../src/lib/swanbotClientToolDispatcher';

type Call = { id: string; name: string; input: unknown };
type Result = { tool_use_id: string; content: string; is_error?: boolean };

type StubBridge = SwanBotDesktopClientToolBridge;

async function executeClientToolCalls(bridge: StubBridge, calls: Call[]): Promise<Result[]> {
  const out: Result[] = [];
  for (const call of calls) {
    try {
      const result = await dispatchSwanBotDesktopClientTool(bridge, call)
        || { ok: false, error: `Unknown client tool "${call.name}"` };
      out.push({
        tool_use_id: call.id,
        content: serializeSwanBotClientToolResult(result),
        is_error: !result.ok,
      });
    } catch (err: any) {
      out.push({
        tool_use_id: call.id,
        content: serializeSwanBotClientToolError(err),
        is_error: true,
      });
    }
  }
  return out;
}

// ─── Stub bridge ───────────────────────────────────────────────────
const stubBridge: StubBridge = {
  launchApp: async (name) => ({ ok: true, data: { appName: name } }),
  focusApp: async (name) => ({ ok: true, data: { appName: name } }),
  typeText: async (text) => ({ ok: true, data: { chars: text.length } }),
  pasteText: async (text, options) => ({ ok: true, data: { chars: text.length, appName: options?.appName || null, restoredClipboard: options?.restoreClipboard !== false } }),
  runDesktopAppleScript: async (program) => ({ ok: true, data: { output: program.scriptLines.join('\n'), args: program.args || [] } }),
  convertImage: async (args) => ({ ok: true, data: { source: args.source, format: args.format || 'png', outputPath: '/Users/cswanson/Desktop/pearsoncdjr-img.png', bytes: 1234 } }),
  pressKeys: async (combo) => ({ ok: true, data: { combo } }),
  clickMenu: async (args) => ({ ok: true, data: { appName: args.appName || null, menuPath: args.menuPath } }),
  listRunningApps: async () => ({ ok: true, data: ['Zoom', 'Terminal', 'Safari'] }),
  waitForApp: async (name) => ({ ok: true, data: { appName: name, elapsedMs: 350 } }),
  takeScreenshot: async () => ({ ok: true, data: { base64: 'iVBORw0KG'.repeat(200), mimeType: 'image/png', sizeBytes: 4096 } }),
  openUrl: async (url) => ({ ok: true, data: { url, scheme: 'https' } }),
  openPath: async (path) => ({ ok: true, data: { path } }),
  searchFiles: async (rootPath, query) => ({
    ok: true,
    data: {
      rootPath,
      query,
      matches: [{ path: `${rootPath}/logo.png`, name: 'logo.png', reason: 'name', size: 2048, modifiedAt: '2026-06-25T12:00:00.000Z' }],
      visited: 7,
      searchedContent: 0,
      truncated: false,
    },
  }),
  statFile: async (path) => ({
    ok: true,
    data: {
      path,
      exists: true,
      kind: 'file',
      size: 2048,
      modifiedAt: '2026-06-25T12:00:00.000Z',
      createdAt: '2026-06-25T11:00:00.000Z',
    },
  }),
  clickAt: async (x, y) => ({ ok: true, data: { x, y, via: 'applescript' } }),
  mouseMove: async (x, y) => ({ ok: true, data: { x, y } }),
  mouseClick: async (args) => ({ ok: true, data: { x: args.x, y: args.y, button: args.button || 'left', count: args.count || 1 } }),
  mouseDown: async (args) => ({ ok: true, data: { x: args.x, y: args.y, button: args.button || 'left' } }),
  mouseUp: async (args) => ({ ok: true, data: { x: args?.x ?? null, y: args?.y ?? null, button: args?.button || 'left' } }),
  mouseDrag: async (args) => ({ ok: true, data: { ...args, durationMs: args.durationMs || 450 } }),
  mouseScroll: async (args) => ({ ok: true, data: { x: args?.x || 0, y: args?.y || 0, deltaX: args?.deltaX || 0, deltaY: args?.deltaY || 0 } }),
  getScreenSize: async () => ({ ok: true, data: { width: 1920, height: 1080 } }),
  readA11yTree: async () => ({ ok: true, data: { app: 'Safari', pid: 456, budget_used: 3, tree: { role: 'window' } } }),
  renderA11yTree: () => ['[0] window "Safari"', '[0.1] button "Reload"', '[0.2] textField "Search"'],
  clickElement: async (args) => ({ ok: true, data: { method: 'ax_click', pid: args.pid, path: args.path } }),
  setElementValue: async (args) => ({ ok: true, data: { method: 'ax_set_value', chars: args.text.length, pid: args.pid, path: args.path } }),
};

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ─── Each tool routes to the right bridge method ────────────────
  const calls: Call[] = [
    { id: 'tu_1', name: 'desktop.launch_app', input: { appName: 'Zoom' } },
    { id: 'tu_2', name: 'desktop.focus_app', input: { appName: 'Terminal' } },
    { id: 'tu_3', name: 'desktop.type_text', input: { text: 'hello world' } },
    { id: 'tu_4', name: 'desktop.paste_text', input: { text: 'hello world', appName: 'TextEdit' } },
    { id: 'tu_5', name: 'desktop.run_applescript', input: { intent: 'create_reminder', params: { text: 'call mom', listName: 'Personal' } } },
    { id: 'tu_6', name: 'desktop.press_keys', input: { combo: 'Cmd+T' } },
    { id: 'tu_7', name: 'desktop.menu_click', input: { appName: 'Photoshop', menuPath: ['File', 'Save'] } },
    { id: 'tu_8', name: 'desktop.list_running_apps', input: {} },
    { id: 'tu_9', name: 'desktop.wait_for_app', input: { appName: 'Zoom', timeoutMs: 3000 } },
    { id: 'tu_10', name: 'desktop.screenshot', input: {} },
    { id: 'tu_11', name: 'desktop.open_url', input: { url: 'https://example.com' } },
    { id: 'tu_12', name: 'desktop.open_path', input: { path: '~/Downloads' } },
    { id: 'tu_13', name: 'desktop.file_search', input: { rootPath: '~/Desktop', query: 'logo.png', maxResults: 5, extensions: ['png'] } },
    { id: 'tu_14', name: 'desktop.file_stat', input: { path: '~/Desktop/logo.png' } },
    { id: 'tu_15', name: 'desktop.convert_image', input: { source: 'pearsoncdjr-img', format: 'png' } },
    { id: 'tu_16', name: 'desktop.click_at', input: { x: 100, y: 200 } },
    { id: 'tu_17', name: 'desktop.mouse_move', input: { x: 90, y: 180 } },
    { id: 'tu_18', name: 'desktop.mouse_click', input: { x: 100, y: 200, button: 'right', count: 2 } },
    { id: 'tu_19', name: 'desktop.mouse_down', input: { x: 100, y: 200 } },
    { id: 'tu_20', name: 'desktop.mouse_up', input: { x: 120, y: 240 } },
    { id: 'tu_21', name: 'desktop.mouse_drag', input: { fromX: 100, fromY: 200, toX: 300, toY: 400 } },
    { id: 'tu_22', name: 'desktop.mouse_scroll', input: { deltaY: 500 } },
    { id: 'tu_23', name: 'desktop.screen_size', input: {} },
    { id: 'tu_24', name: 'desktop.read_a11y_tree', input: { appName: 'Safari', maxNodes: 25 } },
    { id: 'tu_25', name: 'desktop.click_element', input: { pid: 456, path: '0.1' } },
    { id: 'tu_26', name: 'desktop.set_element_value', input: { pid: 123, path: '0.2.1', text: 'hello field' } },
  ];
  const results = await executeClientToolCalls(stubBridge, calls);
  assert(results.length === 26, 'all 26 desktop tools produce a result');
  for (let i = 0; i < results.length; i++) {
    assert(results[i].tool_use_id === calls[i].id, `result ${i}: tool_use_id matches call id`);
    assert(!results[i].is_error, `result ${i}: is_error=false for stub success`);
    const parsed = JSON.parse(results[i].content);
    assert(parsed.ok === true, `result ${i}: content.ok=true`);
  }

  // ─── Screenshot preview shape — content-cap for large base64 ────
  const shotResult = results.find((r) => r.tool_use_id === 'tu_10')!;
  const shotParsed = JSON.parse(shotResult.content);
  assert(shotParsed.data.preview.endsWith('…'), 'screenshot: preview truncated with ellipsis');
  assert(shotParsed.data.preview.length <= 130, `screenshot: preview ≤130 chars (got ${shotParsed.data.preview.length})`);
  assert(shotParsed.data.sizeBytes === 4096, 'screenshot: sizeBytes preserved');
  // Full base64 should NOT round-trip back into the model context.
  // Stub base64 was 200 × 'iVBORw0KG' (9 chars) = 1800 chars; preview
  // trims to ≤ 128 + ellipsis. Content-length-based check is more
  // robust than substring matching (preview inherently contains the
  // first fragment).
  assert(shotResult.content.length < 300, `screenshot: tool_result is compact (got ${shotResult.content.length} chars, full base64 would be ≥1800)`);

  const appleScriptResult = results.find((r) => r.tool_use_id === 'tu_5')!;
  const appleScriptParsed = JSON.parse(appleScriptResult.content);
  assert(appleScriptParsed.data.output.includes('make new reminder'), 'run_applescript: reminder script generated');
  assert(appleScriptParsed.data.args[0] === 'call mom', 'run_applescript: reminder text passed as argv');
  assert(appleScriptParsed.data.args[1] === 'Personal', 'run_applescript: reminder list passed as argv');

  const searchResult = results.find((r) => r.tool_use_id === 'tu_13')!;
  const searchParsed = JSON.parse(searchResult.content);
  assert(searchParsed.data.matches[0].path.endsWith('/logo.png'), 'file_search: match path preserved');
  assert(searchParsed.data.visited === 7, 'file_search: visited count preserved');

  const statResult = results.find((r) => r.tool_use_id === 'tu_14')!;
  const statParsed = JSON.parse(statResult.content);
  assert(statParsed.data.exists === true, 'file_stat: existence preserved');
  assert(statParsed.data.kind === 'file', 'file_stat: kind preserved');

  const convertResult = results.find((r) => r.tool_use_id === 'tu_15')!;
  const convertParsed = JSON.parse(convertResult.content);
  assert(convertParsed.data.outputPath.endsWith('/pearsoncdjr-img.png'), 'convert_image: output path preserved');
  assert(convertParsed.data.format === 'png', 'convert_image: format preserved');

  const mouseClickResult = results.find((r) => r.tool_use_id === 'tu_18')!;
  const mouseClickParsed = JSON.parse(mouseClickResult.content);
  assert(mouseClickParsed.data.button === 'right', 'mouse_click: button preserved');
  assert(mouseClickParsed.data.count === 2, 'mouse_click: count preserved');

  const a11yResult = results.find((r) => r.tool_use_id === 'tu_24')!;
  const a11yParsed = JSON.parse(a11yResult.content);
  assert(a11yParsed.data.app === 'Safari', 'read_a11y_tree: app preserved');
  assert(a11yParsed.data.nodeCount === 3, 'read_a11y_tree: node count preserved');
  assert(a11yParsed.data.text.includes('[0.1] button "Reload"'), 'read_a11y_tree: rendered text included');

  const clickElementResult = results.find((r) => r.tool_use_id === 'tu_25')!;
  const clickElementParsed = JSON.parse(clickElementResult.content);
  assert(clickElementParsed.data.method === 'ax_click', 'click_element: bridge method preserved');
  assert(clickElementParsed.data.path === '0.1', 'click_element: path preserved');

  // ─── Unknown tool → is_error + explanation ──────────────────────
  const unknown = await executeClientToolCalls(stubBridge, [
    { id: 'tu_x', name: 'desktop.not_a_real_tool', input: {} },
  ]);
  assert(unknown[0].is_error === true, 'unknown tool: is_error=true');
  const parsed = JSON.parse(unknown[0].content);
  assert(!parsed.ok, 'unknown tool: content.ok=false');
  assert(/unknown/i.test(parsed.error || ''), 'unknown tool: error mentions unknown');

  // ─── Bridge throws → graceful is_error path ─────────────────────
  const throwingBridge: StubBridge = {
    ...stubBridge,
    launchApp: async () => { throw new Error('bridge unreachable'); },
  };
  const throwResult = await executeClientToolCalls(throwingBridge, [
    { id: 'tu_t', name: 'desktop.launch_app', input: { appName: 'Zoom' } },
  ]);
  assert(throwResult[0].is_error === true, 'bridge throw: is_error=true');
  const throwParsed = JSON.parse(throwResult[0].content);
  assert(/bridge unreachable/.test(throwParsed.error || ''), 'bridge throw: error preserved');

  // ─── Arbitrary result payloads are capped and stay JSON-parseable ──
  const longPayload = `A${'x'.repeat(SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS * 2)}TAIL`;
  const serialized = serializeSwanBotClientToolResult({
    ok: true,
    data: { text: longPayload, nested: { path: '/tmp/proof.txt' } },
  });
  assert(serialized.length <= SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS, `serializer: capped at ${SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS} chars`);
  const serializedParsed = JSON.parse(serialized);
  assert(serializedParsed.ok === true, 'serializer: still parseable JSON');
  assert(serializedParsed.data.nested.path === '/tmp/proof.txt', 'serializer: small nested fields preserved');
  assert(/truncated from/.test(serializedParsed.data.text), 'serializer: long strings include truncation marker');
  assert(!serialized.includes('TAIL'), 'serializer: long payload tail removed');

  const sharedProof = { path: '/tmp/repeated-proof.txt', status: 'ok' };
  const cyclicProof: Record<string, unknown> = { path: '/tmp/cyclic-proof.txt' };
  cyclicProof.self = cyclicProof;
  const repeatedSerialized = serializeSwanBotClientToolResult({
    ok: true,
    data: { first: sharedProof, second: sharedProof, cyclic: cyclicProof },
  });
  const repeatedParsed = JSON.parse(repeatedSerialized);
  assert(repeatedParsed.data.first.path === '/tmp/repeated-proof.txt', 'serializer: repeated object first path preserved');
  assert(repeatedParsed.data.second.path === '/tmp/repeated-proof.txt', 'serializer: repeated object second path preserved');
  assert(repeatedParsed.data.cyclic.self === '[truncated: circular]', 'serializer: true circular reference clipped');

  // ─── Empty calls array → empty results ──────────────────────────
  const empty = await executeClientToolCalls(stubBridge, []);
  assert(empty.length === 0, 'empty calls → empty results');

  if (failures > 0) {
    console.error(`\n${failures} swanbot-v2-delegation smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll swanbot-v2-delegation smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
