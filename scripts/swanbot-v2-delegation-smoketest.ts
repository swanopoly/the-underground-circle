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
import type { DesktopNativeUiTargetGuard } from '../src/lib/desktopBridge';

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
const observedNativeApps: string[] = [];
const receivedTargetGuards: Array<{
  tool: string;
  guard: DesktopNativeUiTargetGuard;
}> = [];
function recordTargetGuard(
  tool: string,
  guard: DesktopNativeUiTargetGuard,
): void {
  receivedTargetGuards.push({ tool, guard });
}

const stubBridge: StubBridge = {
  launchApp: async (name) => ({ ok: true, data: { appName: name } }),
  focusApp: async (name) => ({ ok: true, data: { appName: name } }),
  observeApp: async ({ appName = '' }) => {
    observedNativeApps.push(appName);
    return {
      ok: true,
      data: {
        requestedAppName: appName,
        resolvedAppName: appName,
        pid: 4_567,
        processIdentityVersion: 1 as const,
        app: appName,
        appRunning: true,
        frontmost: true,
        frontmostApp: appName,
        windowCount: 1,
        windowTitles: ['Fixture'],
        targetWindow: { id: 91_234, x: 0, y: 0, width: 1920, height: 1080 },
        tree: null,
        budget_used: 0,
      },
    };
  },
  typeText: async (text, targetGuard) => {
    recordTargetGuard('desktop.type_text', targetGuard);
    return { ok: true, data: { chars: text.length } };
  },
  pasteText: async (text, options) => {
    recordTargetGuard('desktop.paste_text', options.targetGuard);
    return { ok: true, data: { chars: text.length, appName: options.appName, restoredClipboard: options.restoreClipboard !== false } };
  },
  runDesktopAppleScript: async (program) => ({ ok: true, data: { output: program.scriptLines.join('\n'), args: program.args || [] } }),
  convertImage: async (args) => ({ ok: true, data: { source: args.source, format: args.format || 'png', outputPath: '/Users/cswanson/Desktop/pearsoncdjr-img.png', bytes: 1234 } }),
  pressKeys: async (combo, targetGuard) => {
    recordTargetGuard('desktop.press_keys', targetGuard);
    return { ok: true, data: { combo } };
  },
  clickMenu: async (args) => {
    recordTargetGuard('desktop.menu_click', args.targetGuard);
    return { ok: true, data: { appName: args.appName, menuPath: args.menuPath } };
  },
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
  clickAt: async (x, y, targetGuard) => {
    recordTargetGuard('desktop.click_at', targetGuard);
    return { ok: true, data: { x, y, via: 'guarded-native-helper' } };
  },
  mouseMove: async (x, y, targetGuard) => {
    recordTargetGuard('desktop.mouse_move', targetGuard);
    return { ok: true, data: { x, y } };
  },
  mouseClick: async (args) => {
    recordTargetGuard('desktop.mouse_click', args.targetGuard);
    return { ok: true, data: { x: args.x, y: args.y, button: args.button || 'left', count: args.count || 1 } };
  },
  mouseDown: async (args) => {
    recordTargetGuard('desktop.mouse_down', args.targetGuard);
    return { ok: true, data: { x: args.x, y: args.y, button: args.button || 'left' } };
  },
  mouseUp: async (args) => {
    recordTargetGuard('desktop.mouse_up', args.targetGuard);
    return { ok: true, data: { x: args.x, y: args.y, button: args.button || 'left' } };
  },
  mouseDrag: async (args) => {
    recordTargetGuard('desktop.mouse_drag', args.targetGuard);
    return { ok: true, data: { ...args, durationMs: args.durationMs || 450 } };
  },
  mouseScroll: async (args) => {
    recordTargetGuard('desktop.mouse_scroll', args.targetGuard);
    return { ok: true, data: { x: args.x, y: args.y, deltaX: args.deltaX || 0, deltaY: args.deltaY || 0 } };
  },
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
    { id: 'tu_3', name: 'desktop.type_text', input: { appName: 'TextEdit', text: 'hello world' } },
    { id: 'tu_4', name: 'desktop.paste_text', input: { text: 'hello world', appName: 'TextEdit' } },
    { id: 'tu_5', name: 'desktop.run_applescript', input: { intent: 'create_reminder', params: { text: 'call mom', listName: 'Personal' } } },
    { id: 'tu_6', name: 'desktop.press_keys', input: { appName: 'TextEdit', combo: 'Cmd+T' } },
    { id: 'tu_7', name: 'desktop.menu_click', input: { appName: 'Photoshop', menuPath: ['File', 'Save'] } },
    { id: 'tu_8', name: 'desktop.list_running_apps', input: {} },
    { id: 'tu_9', name: 'desktop.wait_for_app', input: { appName: 'Zoom', timeoutMs: 3000 } },
    { id: 'tu_10', name: 'desktop.screenshot', input: {} },
    { id: 'tu_11', name: 'desktop.open_url', input: { url: 'https://example.com' } },
    { id: 'tu_12', name: 'desktop.open_path', input: { path: '~/Downloads' } },
    { id: 'tu_13', name: 'desktop.file_search', input: { rootPath: '~/Desktop', query: 'logo.png', maxResults: 5, extensions: ['png'] } },
    { id: 'tu_14', name: 'desktop.file_stat', input: { path: '~/Desktop/logo.png' } },
    { id: 'tu_15', name: 'desktop.convert_image', input: { source: 'pearsoncdjr-img', format: 'png' } },
    { id: 'tu_16', name: 'desktop.click_at', input: { appName: 'TextEdit', x: 100, y: 200 } },
    { id: 'tu_17', name: 'desktop.mouse_move', input: { appName: 'TextEdit', x: 90, y: 180 } },
    { id: 'tu_18', name: 'desktop.mouse_click', input: { appName: 'TextEdit', x: 100, y: 200, button: 'right', count: 2 } },
    { id: 'tu_19', name: 'desktop.mouse_down', input: { appName: 'TextEdit', x: 100, y: 200 } },
    { id: 'tu_20', name: 'desktop.mouse_up', input: { appName: 'TextEdit', x: 120, y: 240 } },
    { id: 'tu_21', name: 'desktop.mouse_drag', input: { appName: 'TextEdit', fromX: 100, fromY: 200, toX: 300, toY: 400 } },
    // x/y are REQUIRED for scroll: the bridge coerces a missing coordinate to 0,
    // so a coord-less scroll would act at the screen's top-left with the
    // coordinate preflight skipped. The dispatcher now fails closed.
    { id: 'tu_22', name: 'desktop.mouse_scroll', input: { appName: 'TextEdit', deltaY: 500, x: 640, y: 400 } },
    { id: 'tu_23', name: 'desktop.screen_size', input: {} },
    { id: 'tu_24', name: 'desktop.read_a11y_tree', input: { appName: 'Safari', maxNodes: 25 } },
    { id: 'tu_25', name: 'desktop.click_element', input: { pid: 456, path: '0.1' } },
    { id: 'tu_26', name: 'desktop.set_element_value', input: { action: 'set_value', appName: 'TextEdit', pid: 123, path: '0.2.1', expectedRole: 'AXTextField', expectedLabel: 'Project name', expectedCurrentValue: '', text: 'hello field' } },
  ];
  // Four native-app actions are DELIBERATELY refused by this raw dispatcher
  // and must go through the sealed approval + fresh-proof runtime gateway
  // instead. They still return a well-formed result — they just decline, with a
  // reason — so the loop below asserts the refusal rather than treating it as a
  // routing failure.
  const GATEWAY_ONLY_TOOLS = new Set([
    'desktop.launch_app',
    'desktop.focus_app',
    'desktop.click_element',
    'desktop.set_element_value',
  ]);

  const results = await executeClientToolCalls(stubBridge, calls);
  assert(results.length === 26, 'all 26 desktop tools produce a result');
  for (let i = 0; i < results.length; i++) {
    assert(results[i].tool_use_id === calls[i].id, `result ${i}: tool_use_id matches call id`);
    const parsed = JSON.parse(results[i].content);
    if (GATEWAY_ONLY_TOOLS.has(calls[i].name)) {
      assert(parsed.ok === false, `result ${i} (${calls[i].name}): gateway-only tool is refused here`);
      assert(
        typeof parsed.error === 'string' && /gateway|runtime/i.test(parsed.error),
        `result ${i} (${calls[i].name}): refusal explains the required runtime`,
      );
      continue;
    }
    assert(!results[i].is_error, `result ${i}: is_error=false for stub success`);
    assert(parsed.ok === true, `result ${i}: content.ok=true`);
  }
  assert(
    GATEWAY_ONLY_TOOLS.size === 4
      && calls.filter((c) => GATEWAY_ONLY_TOOLS.has(c.name)).length === 4,
    'every gateway-only tool is actually exercised by this fixture',
  );
  const GUARDED_NATIVE_TOOLS = new Set([
    'desktop.type_text',
    'desktop.paste_text',
    'desktop.press_keys',
    'desktop.menu_click',
    'desktop.click_at',
    'desktop.mouse_move',
    'desktop.mouse_click',
    'desktop.mouse_down',
    'desktop.mouse_up',
    'desktop.mouse_drag',
    'desktop.mouse_scroll',
  ]);
  assert(
    observedNativeApps.length === GUARDED_NATIVE_TOOLS.size,
    'every direct native input dispatch obtains one fresh exact app observation',
  );
  assert(
    receivedTargetGuards.length === GUARDED_NATIVE_TOOLS.size
      && receivedTargetGuards.every(({ guard }) => (
        guard.appName.length > 0
        && guard.pid === 4_567
        && guard.window.id === 91_234
        && guard.window.width === 1_920
        && guard.window.height === 1_080
      )),
    'every direct native input bridge call receives app/PID/CGWindow/bounds authority',
  );
  assert(
    new Set(receivedTargetGuards.map(({ guard }) => guard)).size
      === GUARDED_NATIVE_TOOLS.size,
    'each native input dispatch receives a distinct one-shot target guard',
  );
  for (const [index, call] of calls.entries()) {
    if (!GUARDED_NATIVE_TOOLS.has(call.name)) continue;
    assert(
      !results[index].content.includes('targetGuard')
        && !results[index].content.includes('91234'),
      `${call.name}: transient target authority is absent from serialized result`,
    );
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

  // click_element no longer reaches the raw bridge at all — it requires the
  // sealed native semantic-action runtime — so there is no bridge method to
  // preserve. What must hold instead is that it refuses WITHOUT touching the
  // bridge and says why.
  const clickElementResult = results.find((r) => r.tool_use_id === 'tu_25')!;
  const clickElementParsed = JSON.parse(clickElementResult.content);
  assert(clickElementParsed.ok === false, 'click_element: refused by the raw dispatcher');
  assert(
    /semantic-action runtime/i.test(String(clickElementParsed.error ?? '')),
    'click_element: refusal names the runtime it requires',
  );
  assert(
    clickElementParsed.data === undefined,
    'click_element: no bridge payload leaks from a refused call',
  );

  // ─── Unknown tool → is_error + explanation ──────────────────────
  const unknown = await executeClientToolCalls(stubBridge, [
    { id: 'tu_x', name: 'desktop.not_a_real_tool', input: {} },
  ]);
  assert(unknown[0].is_error === true, 'unknown tool: is_error=true');
  const parsed = JSON.parse(unknown[0].content);
  assert(!parsed.ok, 'unknown tool: content.ok=false');
  assert(/unknown/i.test(parsed.error || ''), 'unknown tool: error mentions unknown');

  // ─── Bridge throws → graceful is_error path ─────────────────────
  // Uses a tool that actually REACHES the bridge. `desktop.launch_app` was the
  // original fixture here, but it is now refused before dispatch (see
  // GATEWAY_ONLY_TOOLS above) — so the stub could never throw and this test
  // would pass for the wrong reason.
  const throwingBridge: StubBridge = {
    ...stubBridge,
    readA11yTree: async () => { throw new Error('bridge unreachable'); },
  };
  const throwResult = await executeClientToolCalls(throwingBridge, [
    { id: 'tu_t', name: 'desktop.read_a11y_tree', input: { pid: 456 } },
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
