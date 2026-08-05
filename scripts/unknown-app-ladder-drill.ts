/**
 * unknown-app-ladder-drill — LIVE end-to-end proof that the generic ladder can
 * do a task in an app it has never heard of (no docs/apps profile, no
 * dedicated adapter), using only generic bridge capabilities plus the REAL
 * verification core.
 *
 *   discover  →  menu_inventory (the app's command catalog, read-only)
 *   observe   →  a11y snapshot BEFORE
 *   act       →  type a marker into the app (frontmost-bracketed)
 *   verify    →  a11y snapshot AFTER → diff → nativeUiVerificationCore
 *                must return verdict 'verified' — attribution, not movement
 *
 * WHY A HARNESS AND NOT ANOTHER AD-HOC PROBE
 * The 2026-07-29 live probes kept catching bugs the source review missed
 * (layer locks, cold-start dictionary races, GL apps with empty menu bars).
 * Each was driven by throwaway inline node -e. This makes the unknown-app
 * drill repeatable so it can be re-run after ladder changes — it is LIVE and
 * MANUAL by design (launches a real app, sends real keystrokes) and must
 * never join the smoke chains.
 *
 * SAFETY MODEL
 *   - Discovery phases run against any app and are strictly read-only.
 *   - The MUTATION phase (typing) only runs for apps in SCRATCH_SAFE_APPS:
 *     typing goes to the FRONTMOST app via System Events, so the drill
 *     brackets it with window_state checks (frontmost before AND after must
 *     be the target) and aborts rather than type into anything else.
 *   - Teardown closes documents saving-no ONLY when every open document is
 *     an untitled scratch; any titled document freezes teardown and reports.
 *
 * Usage:
 *   npx tsx scripts/unknown-app-ladder-drill.ts               # TextEdit, :7778
 *   npx tsx scripts/unknown-app-ladder-drill.ts --port 17999
 *   npx tsx scripts/unknown-app-ladder-drill.ts --app Calculator   # discovery-only
 *   npx tsx scripts/unknown-app-ladder-drill.ts --keep        # skip teardown
 */

import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  diffA11ySummaries,
  snapshotA11ySummary,
  type A11ySummaryNode,
} from '../src/lib/a11yTreeDiff';
import {
  planNativeUiVerification,
  verifyNativeUiAfterState,
} from '../src/lib/nativeUiVerificationCore';

const execFileAsync = promisify(execFile);

// Mutation phase allowlist: apps where an untitled scratch document is cheap,
// obviously disposable, and closable without saving. Everything else gets the
// read-only discovery phases only.
const SCRATCH_SAFE_APPS = new Set(['TextEdit']);

const argv = process.argv.slice(2);
function argValue(flag: string, fallback: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const APP = argValue('--app', 'TextEdit');
const PORT = Number.parseInt(argValue('--port', '7778'), 10) || 7778;
const KEEP = argv.includes('--keep');
const MARKER = `UC unknown-app drill ${argValue('--marker', 'marker-text')}`;

type BridgeResponse = { status: number; body: any };
let bridgeToken = '';

function request(method: string, path: string, body?: unknown): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(bridgeToken ? { 'X-UC-Desktop-Token': bridgeToken } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode || 0, body: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode || 0, body: raw.slice(0, 300) }); }
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const steps: Array<{ name: string; ok: boolean; detail: string }> = [];
function step(name: string, ok: boolean, detail: string) {
  steps.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name} — ${detail}`);
  if (!ok) finish(1);
}
function note(text: string) { console.log(`  · ${text}`); }

function finish(code: number): never {
  const passed = steps.filter((s) => s.ok).length;
  console.log(`\n${passed}/${steps.length} steps passed — drill ${code === 0 ? 'PASSED' : 'FAILED'}`);
  process.exit(code);
}

async function frontmostApp(): Promise<string> {
  const w = await request('GET', '/desktop/window_state');
  return String(w.body?.frontmostApp || '');
}

async function a11ySnapshot(app: string): Promise<A11ySummaryNode[] | null> {
  const r = await request('GET', `/desktop/a11y_tree?app=${encodeURIComponent(app)}&slice=interactive`);
  if (!r.body?.ok || !r.body?.tree) return null;
  return snapshotA11ySummary(r.body.tree);
}

async function main() {
  console.log(`unknown-app ladder drill — app=${APP} port=${PORT}\n`);

  // ── 0. Pair ───────────────────────────────────────────────────────────────
  const challenge = await request('POST', '/desktop/pair', {});
  const paired = await request('POST', '/desktop/pair', { pairingChallenge: challenge.body?.challenge });
  bridgeToken = String(paired.body?.token || '');
  step('pair', !!bridgeToken, bridgeToken ? 'challenge/response token issued' : JSON.stringify(paired.body).slice(0, 120));

  // ── 1. Capabilities ───────────────────────────────────────────────────────
  const health = await request('GET', '/desktop/health');
  const tools: string[] = Array.isArray(health.body?.tools) ? health.body.tools : [];
  const needed = ['launch', 'focus', 'type', 'window_state', 'menu_inventory', 'a11y_tree', 'wait_for_app'];
  const missing = needed.filter((t) => !tools.includes(t));
  step('capabilities', missing.length === 0, missing.length ? `bridge missing: ${missing.join(', ')}` : `${needed.length}/${needed.length} generic capabilities advertised`);

  // ── 2. Launch + wait ──────────────────────────────────────────────────────
  await request('POST', '/desktop/launch', { appName: APP });
  const waited = await request('POST', '/desktop/wait_for_app', { appName: APP, timeoutMs: 20000 });
  step('launch', waited.body?.ok === true || waited.body?.running === true, `${APP} is running`);

  // ── 3. Discover: the command catalog ─────────────────────────────────────
  const inventory = await request('POST', '/desktop/menu_inventory', { appName: APP });
  const menus: Array<{ title: string; items: Array<{ name: string }> }> = inventory.body?.menus || [];
  const itemCount = Number(inventory.body?.itemCount || 0);
  // Fewer than ~4 menus (Apple + app + Window) means a custom-chrome app that
  // draws menus in its own window — the drill reports the routing signal and
  // continues on the a11y path, exactly as the runtime tool instructs.
  const nativeMenuApp = menus.length >= 4;
  step('menu_inventory', inventory.body?.ok === true,
    `${menus.length} menu(s), ${itemCount} item(s) — ${nativeMenuApp ? 'native menu-bar app' : 'custom-chrome app (route to a11y observation)'}`);
  note(`catalog: ${menus.map((m) => m.title).join(', ')}`);

  const fileMenu = menus.find((m) => m.title === 'File');
  if (fileMenu) {
    const deep = await request('POST', '/desktop/menu_inventory', { appName: APP, menuTitle: 'File' });
    const deepFile = (deep.body?.menus || []).find((m: any) => m.title === 'File');
    step('menu deep-read', (deepFile?.items?.length ?? 0) > 0, `File menu: ${deepFile?.items?.length ?? 0} items with enabled/submenu state`);
  }

  // ── 4. Observe BEFORE ─────────────────────────────────────────────────────
  const before = await a11ySnapshot(APP);
  step('a11y observe (before)', Array.isArray(before) && before.length > 0, `${before?.length ?? 0} accessibility nodes`);

  if (!SCRATCH_SAFE_APPS.has(APP)) {
    note(`${APP} is not in the scratch-safe allowlist — discovery-only drill, mutation phase skipped by design.`);
    finish(0);
  }

  // ── 5. Ensure a scratch document exists (generic path: File > New) ───────
  const hasTextArea = (nodes: A11ySummaryNode[] | null) =>
    (nodes || []).some((n) => /textarea|text area|AXTextArea/i.test(n.role));
  if (!hasTextArea(before)) {
    await request('POST', '/desktop/focus', { appName: APP });
    await request('POST', '/desktop/menu_click', { appName: APP, menuPath: ['File', 'New'] });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const ready = await a11ySnapshot(APP);
  step('scratch document', hasTextArea(ready), hasTextArea(ready) ? 'an editable text area is present' : 'no text area found after File > New');

  // ── 6. Act: type the marker, frontmost-bracketed ─────────────────────────
  await request('POST', '/desktop/focus', { appName: APP });
  await new Promise((r) => setTimeout(r, 400));
  const frontBefore = await frontmostApp();
  step('frontmost bracket (pre)', frontBefore === APP, `frontmost=${frontBefore}`);

  const preType = await a11ySnapshot(APP);
  const typed = await request('POST', '/desktop/type', { text: MARKER });
  step('type', typed.body?.ok === true, `sent ${MARKER.length} chars via System Events keystroke`);
  await new Promise((r) => setTimeout(r, 800));

  const frontAfter = await frontmostApp();
  step('frontmost bracket (post)', frontAfter === APP,
    frontAfter === APP ? 'focus held for the whole keystroke window' : `focus DRIFTED to ${frontAfter} — keystrokes may have landed elsewhere`);

  // ── 7. Verify: the REAL core must attribute the change ───────────────────
  const after = await a11ySnapshot(APP);
  const snapshotsUsable = Array.isArray(preType) && Array.isArray(after);
  const diff = snapshotsUsable ? diffA11ySummaries(preType, after) : null;
  const plan = planNativeUiVerification('desktop.type_text', { text: MARKER });
  const verdict = verifyNativeUiAfterState({ tool: 'desktop.type_text', plan, diff, snapshotsUsable });
  note(`diff: +${diff?.addedTotal ?? 0} -${diff?.removedTotal ?? 0} ~${diff?.changedTotal ?? 0} | verdict=${verdict.verdict}`);
  note(verdict.reason);
  step('verification', verdict.verdict === 'verified',
    verdict.verdict === 'verified'
      ? 'the sent text is IN the changed value — attributed, not inferred from movement'
      : `verdict=${verdict.verdict} (drill requires 'verified')`);

  // ── 8. Teardown: only if every document is an untitled scratch ───────────
  if (KEEP) { note('--keep: teardown skipped'); finish(0); }
  // Count BEFORE closing, and quit in a SEPARATE osascript with replies
  // ignored: `quit` inside the tell block kills the app before it can answer,
  // so the AppleEvent times out — which is exactly how this drill's first live
  // run failed at the finish line.
  const { stdout } = await execFileAsync('osascript', ['-e', `
tell application "${APP}"
  set docNames to name of every document
  set docTotal to count of docNames
  set allUntitled to true
  repeat with n in docNames
    if (n as text) does not start with "Untitled" then set allUntitled to false
  end repeat
  if allUntitled then
    close every document saving no
    return "closed:" & docTotal
  else
    return "FROZE: a titled document is open (" & (docNames as text) & ")"
  end if
end tell`]);
  const teardown = stdout.trim();
  try {
    await execFileAsync('osascript', ['-e', `ignoring application responses
  tell application "${APP}" to quit
end ignoring`]);
  } catch { /* quit is best-effort; the document close above is the safety-relevant part */ }
  step('teardown', teardown.startsWith('closed:'), teardown);

  finish(0);
}

main().catch((error) => {
  console.error('drill error:', error?.message || error);
  finish(2);
});
