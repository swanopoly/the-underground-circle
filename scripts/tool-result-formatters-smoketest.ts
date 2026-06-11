/**
 * tool-result-formatters-smoketest
 *
 * Locks the T10 composable result formatters + `response_format` contract:
 *
 *   1. Helper units (`toolResultFormatters.ts`): exact truncation-marker
 *      format, "+N more" bullet collapse, char-budget bounding, key/value
 *      selection, count pluralization, OK/Error prefixes, and the
 *      fail-to-concise normalization of `response_format`.
 *   2. Real-catalog cases (registerHooks stub technique, same as
 *      progressive-tool-disclosure-smoketest): with a stubbed desktop
 *      bridge, `desktop.file_list` and `desktop.read_a11y_tree` produce a
 *      SMALLER result for concise (default) than for detailed, and the
 *      concise output carries an explicit truncation marker that points the
 *      model at `response_format:'detailed'`.
 *   3. All 10 observation-heavy tools advertise `response_format` in their
 *      input schemas and mention the concise default in their descriptions.
 *
 * Run: npm run smoke:tool-result-formatters
 */

import { registerHooks } from 'node:module';

// The supabase singleton creates a client at import time — give it inert
// values BEFORE any app module loads. Never points at a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://formatters-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'formatters-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const NATIVE_STUB_SOURCE = `
export const Platform = { OS: 'web', select: (obj) => (obj ? (obj.web !== undefined ? obj.web : obj.default) : undefined) };
export const AppState = { currentState: 'active', addEventListener: () => ({ remove() {} }) };
export const Dimensions = { get: () => ({ width: 1280, height: 800, scale: 2, fontScale: 1 }) };
export const NativeModules = {};
export const StyleSheet = { create: (s) => s, flatten: (s) => s };
const asyncStorageStub = {
  getItem: async () => null, setItem: async () => {}, removeItem: async () => {},
  multiGet: async () => [], multiSet: async () => {}, multiRemove: async () => {}, getAllKeys: async () => [],
};
export default asyncStorageStub;
`;

// Deterministic desktop-bridge stub so the REAL runtime execution cases run
// without a live bridge: 120 file entries and a 300-node a11y tree, both big
// enough to exceed the concise caps.
const DESKTOP_BRIDGE_STUB_SOURCE = `
export async function isDesktopBridgeAvailable() { return true; }
export async function listFiles(path) {
  const entries = Array.from({ length: 120 }, (_, i) => ({ name: 'file-' + String(i).padStart(3, '0') + '.txt', kind: 'file', size: 100 + i }));
  return { ok: true, data: { path, entries, truncated: false } };
}
export async function readA11yTree(opts) {
  return { ok: true, data: { app: 'SmokeApp', pid: 4242, budget_used: 300, tree: { role: 'AXApplication' } } };
}
export function renderA11yTree(tree) {
  return Array.from({ length: 300 }, (_, i) => '  '.repeat(i % 4) + 'AXButton "Smoke control number ' + i + '" (enabled, position ' + i + ')');
}
`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier === './desktopBridge' && String(context.parentURL || '').includes('openswanToolRuntime')) {
      return { url: 'stub:desktopBridge', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'stub:desktopBridge') return { format: 'module', source: DESKTOP_BRIDGE_STUB_SOURCE, shortCircuit: true };
    if (url.startsWith('stub:')) return { format: 'module', source: NATIVE_STUB_SOURCE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

// Type-only imports are erased at compile time — safe before the hooks run.
import type { OpenSwanRuntimeToolContext, OpenSwanRuntimeToolName, OpenSwanToolDefinition, OpenSwanToolSurface } from '../src/lib/openswanToolRuntime';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  // ── 1) Pure helper units ──────────────────────────────────────────────
  const fmt = await import('../src/lib/toolResultFormatters');

  const truncated = fmt.truncateText('a'.repeat(120), 100);
  assert(
    truncated === `${'a'.repeat(100)}\n…[truncated 20 chars — ask for detailed if needed]`,
    'truncateText: exact marker format with removed-char count',
    JSON.stringify(truncated.slice(95)),
  );
  assert(fmt.truncateText('short', 100) === 'short', 'truncateText: under-cap text unchanged');
  assert(fmt.truncateText('', 10) === '', 'truncateText: empty input unchanged');
  assert(
    fmt.truncateText('a'.repeat(20), 10, { note: '(use maxBytes)' }).endsWith('— ask for detailed if needed] (use maxBytes)'),
    'truncateText: optional note appended after marker',
  );
  assert(fmt.truncationMarker(7) === '…[truncated 7 chars — ask for detailed if needed]', 'truncationMarker: canonical string');

  const bullets = fmt.formatBulletList(['alpha', 'beta', 'gamma', 'delta'], { max: 2 });
  assert(bullets === '- alpha\n- beta\n… +2 more', 'formatBulletList: caps at max with "+N more"', JSON.stringify(bullets));
  assert(fmt.formatBulletList([]) === '(none)', 'formatBulletList: empty input → (none)');
  assert(
    fmt.formatBulletList(['- already bulleted', '1. numbered'], { max: 5 }) === '- already bulleted\n1. numbered',
    'formatBulletList: keeps existing bullet/numbered prefixes',
  );
  const customMore = fmt.formatBulletList(['a', 'b', 'c'], { max: 1, more: (n) => `(${n} hidden)` });
  assert(customMore === '- a\n(2 hidden)', 'formatBulletList: custom more label receives hidden count', JSON.stringify(customMore));

  const budgeted = fmt.boundListWithBudget(['x'.repeat(40), 'y'.repeat(40), 'z'.repeat(40)], 90);
  assert(budgeted === `${'x'.repeat(40)}\n${'y'.repeat(40)}\n… +1 more`, 'boundListWithBudget: keeps items under budget, "+N more" for the rest', JSON.stringify(budgeted));
  assert(fmt.boundListWithBudget([], 100) === '(none)', 'boundListWithBudget: empty input → (none)');
  const oversizedFirst = fmt.boundListWithBudget(['q'.repeat(500)], 100);
  assert(
    oversizedFirst.startsWith('q'.repeat(100)) && oversizedFirst.includes('…[truncated 400 chars'),
    'boundListWithBudget: single oversized item truncated, never empty',
  );

  assert(
    fmt.formatKeyValues({ a: 1, b: '', c: null, d: 'x' }) === 'a: 1\nd: x',
    'formatKeyValues: skips empty/null values',
  );
  assert(
    fmt.formatKeyValues({ a: 1, b: 2 }, { keys: ['b'] }) === 'b: 2',
    'formatKeyValues: keys option selects + orders',
  );
  assert(fmt.formatCount('file', 1) === '1 file' && fmt.formatCount('file', 3) === '3 files', 'formatCount: pluralizes');
  assert(fmt.formatOkLine('done') === 'OK: done', 'formatOkLine: OK prefix');
  assert(fmt.formatErrorLine('nope') === 'Error: nope', 'formatErrorLine: Error prefix');

  assert(fmt.resolveResponseFormat(undefined) === 'concise', 'resolveResponseFormat: absent → concise');
  assert(fmt.resolveResponseFormat('DETAILED') === 'detailed', 'resolveResponseFormat: case-insensitive detailed');
  assert(fmt.resolveResponseFormat('verbose') === 'concise', 'resolveResponseFormat: garbage → concise (fail closed)');

  // ── 2) Real-catalog concise vs detailed (stubbed desktop bridge) ──────
  const runtime = await import('../src/lib/openswanToolRuntime');
  const ctx: OpenSwanRuntimeToolContext = { circleId: 'smoke-circle', userId: 'smoke-user' };

  const fileListConcise = await runtime.executeOpenSwanRuntimeTool('desktop.file_list', { path: '/tmp/smoke' }, ctx);
  const fileListDetailed = await runtime.executeOpenSwanRuntimeTool('desktop.file_list', { path: '/tmp/smoke', response_format: 'detailed' }, ctx);
  assert(fileListConcise.ok && fileListDetailed.ok, 'desktop.file_list: both formats execute against stub bridge');
  assert(
    fileListConcise.resultsText.length < fileListDetailed.resultsText.length,
    'desktop.file_list: concise (default) is smaller than detailed',
    `concise=${fileListConcise.resultsText.length} detailed=${fileListDetailed.resultsText.length}`,
  );
  assert(fileListConcise.resultsText.includes('… +70 more'), 'desktop.file_list: concise collapses overflow into "+N more"', fileListConcise.resultsText.slice(-80));
  assert(fileListConcise.resultsText.includes('(120)'), 'desktop.file_list: concise still reports the TRUE total count');

  const a11yConcise = await runtime.executeOpenSwanRuntimeTool('desktop.read_a11y_tree', {}, ctx);
  const a11yDetailed = await runtime.executeOpenSwanRuntimeTool('desktop.read_a11y_tree', { response_format: 'detailed' }, ctx);
  assert(a11yConcise.ok && a11yDetailed.ok, 'desktop.read_a11y_tree: both formats execute against stub bridge');
  assert(
    a11yConcise.resultsText.length < a11yDetailed.resultsText.length,
    'desktop.read_a11y_tree: concise (default) is smaller than detailed',
    `concise=${a11yConcise.resultsText.length} detailed=${a11yDetailed.resultsText.length}`,
  );
  assert(
    a11yConcise.resultsText.includes('ask for detailed if needed'),
    'desktop.read_a11y_tree: concise output carries the explicit truncation marker',
  );
  assert(a11yConcise.resultsText.length < 5200, 'desktop.read_a11y_tree: concise bounded near the 4k char budget', String(a11yConcise.resultsText.length));

  // ── 3) response_format advertised on all 10 observation-heavy tools ───
  const RESPONSE_FORMAT_TOOLS: OpenSwanRuntimeToolName[] = [
    'desktop.read_a11y_tree',
    'desktop.file_list',
    'desktop.file_search',
    'desktop.list_browser_tabs',
    'desktop.list_running_apps',
    'browser.dom_snapshot',
    'messages.list',
    'messages.search',
    'rooms.list_files',
    'github.activity',
  ];
  const surfaces: OpenSwanToolSurface[] = ['main_chat', 'room_chat', 'office', 'task_run'];
  const catalog = new Map<string, OpenSwanToolDefinition>();
  for (const surface of surfaces) {
    for (const def of runtime.listOpenSwanToolsForSurface(surface)) catalog.set(def.name, def);
  }
  for (const tool of RESPONSE_FORMAT_TOOLS) {
    const def = catalog.get(tool);
    if (!def) { fail(`${tool}: missing from catalog`); continue; }
    const properties = (def.inputSchema as any)?.properties || {};
    const prop = properties.response_format;
    assert(Boolean(prop), `${tool}: input schema advertises response_format`);
    assert(
      Array.isArray(prop?.enum) && prop.enum.includes('concise') && prop.enum.includes('detailed'),
      `${tool}: response_format enum is concise|detailed`,
    );
    assert(String(prop?.description || '').toLowerCase().includes('concise'), `${tool}: response_format documents the concise default`);
    assert(
      String(def.description || '').includes("response_format:'detailed'"),
      `${tool}: description tells the model how to request the full payload`,
    );
  }

  console.log(failures === 0 ? '\ntool-result-formatters smoketest: ALL PASS' : `\ntool-result-formatters smoketest: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('tool-result-formatters smoketest crashed:', error);
  process.exit(1);
});
