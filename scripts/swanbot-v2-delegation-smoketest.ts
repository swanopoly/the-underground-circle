/**
 * swanbot-v2-delegation-smoketest — verifies the client-side tool
 * dispatcher used by `callSwanBotV2`'s M2 continuation loop. We test
 * the shape of the `toolResults` it produces for every tool-call
 * scenario without hitting the real bridge.
 *
 * Run: npm run smoke:swanbot-v2-delegation
 */

type Call = { id: string; name: string; input: unknown };
type Result = { tool_use_id: string; content: string; is_error?: boolean };

// Inline stub of dispatchOneClientTool — mirrors the real one in
// src/lib/swanbot.ts with an injected stub bridge. Keeps the smoke
// offline (no fetch, no auth, no localStorage).
interface StubBridge {
  launchApp: (name: string) => Promise<any>;
  focusApp: (name: string) => Promise<any>;
  typeText: (text: string) => Promise<any>;
  pressKeys: (combo: string) => Promise<any>;
  listRunningApps: () => Promise<any>;
  waitForApp: (name: string, timeout?: number) => Promise<any>;
  takeScreenshot: () => Promise<any>;
  openUrl: (url: string) => Promise<any>;
  openPath: (path: string) => Promise<any>;
  clickAt: (x: number, y: number) => Promise<any>;
  getScreenSize: () => Promise<any>;
}

async function dispatchOneClientTool(bridge: StubBridge, call: Call): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const input = (call.input || {}) as Record<string, any>;
  switch (call.name) {
    case 'desktop.launch_app':        return bridge.launchApp(String(input.appName || ''));
    case 'desktop.focus_app':         return bridge.focusApp(String(input.appName || ''));
    case 'desktop.type_text':         return bridge.typeText(String(input.text || ''));
    case 'desktop.press_keys':        return bridge.pressKeys(String(input.combo || ''));
    case 'desktop.list_running_apps': {
      const r = await bridge.listRunningApps();
      return r.ok ? { ok: true, data: { apps: r.data || [] } } : r;
    }
    case 'desktop.wait_for_app':
      return bridge.waitForApp(String(input.appName || ''), typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined);
    case 'desktop.screenshot': {
      const r = await bridge.takeScreenshot();
      if (!r.ok) return r;
      return {
        ok: true,
        data: {
          sizeBytes: r.data?.sizeBytes ?? 0,
          mimeType: r.data?.mimeType || 'image/png',
          preview: (r.data?.base64 || '').slice(0, 128) + '…',
        },
      };
    }
    case 'desktop.open_url':   return bridge.openUrl(String(input.url || ''));
    case 'desktop.open_path':  return bridge.openPath(String(input.path || ''));
    case 'desktop.click_at':   return bridge.clickAt(Number(input.x), Number(input.y));
    case 'desktop.screen_size':return bridge.getScreenSize();
    default:
      return { ok: false, error: `Unknown client tool "${call.name}"` };
  }
}

async function executeClientToolCalls(bridge: StubBridge, calls: Call[]): Promise<Result[]> {
  const out: Result[] = [];
  for (const call of calls) {
    try {
      const result = await dispatchOneClientTool(bridge, call);
      out.push({
        tool_use_id: call.id,
        content: JSON.stringify(result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error || 'failed' }),
        is_error: !result.ok,
      });
    } catch (err: any) {
      out.push({
        tool_use_id: call.id,
        content: JSON.stringify({ ok: false, error: err?.message || 'threw' }),
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
  pressKeys: async (combo) => ({ ok: true, data: { combo } }),
  listRunningApps: async () => ({ ok: true, data: ['Zoom', 'Terminal', 'Safari'] }),
  waitForApp: async (name) => ({ ok: true, data: { appName: name, elapsedMs: 350 } }),
  takeScreenshot: async () => ({ ok: true, data: { base64: 'iVBORw0KG'.repeat(200), mimeType: 'image/png', sizeBytes: 4096 } }),
  openUrl: async (url) => ({ ok: true, data: { url, scheme: 'https' } }),
  openPath: async (path) => ({ ok: true, data: { path } }),
  clickAt: async (x, y) => ({ ok: true, data: { x, y, via: 'applescript' } }),
  getScreenSize: async () => ({ ok: true, data: { width: 1920, height: 1080 } }),
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
    { id: 'tu_4', name: 'desktop.press_keys', input: { combo: 'Cmd+T' } },
    { id: 'tu_5', name: 'desktop.list_running_apps', input: {} },
    { id: 'tu_6', name: 'desktop.wait_for_app', input: { appName: 'Zoom', timeoutMs: 3000 } },
    { id: 'tu_7', name: 'desktop.screenshot', input: {} },
    { id: 'tu_8', name: 'desktop.open_url', input: { url: 'https://example.com' } },
    { id: 'tu_9', name: 'desktop.open_path', input: { path: '~/Downloads' } },
    { id: 'tu_10', name: 'desktop.click_at', input: { x: 100, y: 200 } },
    { id: 'tu_11', name: 'desktop.screen_size', input: {} },
  ];
  const results = await executeClientToolCalls(stubBridge, calls);
  assert(results.length === 11, 'all 11 tools produce a result');
  for (let i = 0; i < results.length; i++) {
    assert(results[i].tool_use_id === calls[i].id, `result ${i}: tool_use_id matches call id`);
    assert(!results[i].is_error, `result ${i}: is_error=false for stub success`);
    const parsed = JSON.parse(results[i].content);
    assert(parsed.ok === true, `result ${i}: content.ok=true`);
  }

  // ─── Screenshot preview shape — content-cap for large base64 ────
  const shotResult = results.find((r) => r.tool_use_id === 'tu_7')!;
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
