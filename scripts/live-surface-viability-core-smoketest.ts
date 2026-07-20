/**
 * live-surface-viability-core-smoketest — the PURE pre-flight execution-surface
 * reconciler (src/lib/liveSurfaceViabilityCore.ts) that reads a plan's
 * preferredSurfaceOrder against LIVE per-app reachability report(s) and emits a
 * LiveSurfaceViabilityResult: {startSurface, startPrecondition, startChatCanFix,
 * degraded, degradeNote, surfaceMismatch, desktopViable, userAction, findings,
 * prunedSurfaces, disposition, summary}.
 *
 * Load-bearing assertions:
 *   reconcileLiveSurfaceViability({ preferredSurfaceOrder, reachability })
 *     - reachable desktop + [desktop_a11y,desktop_vision] → start=desktop_a11y,
 *       precondition none, degraded false.
 *     - a11y_blocked → desktop_a11y dead, start=desktop_vision, degraded true,
 *       degradeNote mentions accessibility.
 *     - needs_launch → start=desktop_a11y, precondition launch_app,
 *       chatCanFix true, userAction non-null.
 *     - needs_focus → precondition focus_app, chatCanFix true.
 *     - bridge_outdated → precondition restart_bridge, chatCanFix false, NOT dead.
 *     - bridge_offline → all desktop dead, start=null (or first browser),
 *       userAction=restart, chatCanFix false.
 *     - not_installed → dead, precondition install_app.
 *     - web_app + desktop-top order → surfaceMismatch true, start falls to
 *       browser_semantic (else null), precondition switch_to_browser.
 *     - multi-report worst-case (reachable + not_installed) → not_installed wins.
 *   summarizeLiveSurfaceViability(result) — bounded structural telemetry line.
 *
 * And: every export is TOTAL — null/undefined/number/string/NaN/{}/[]-as-input,
 * a huge (10k) reachability array, a cyclic/throwing-proxy report, a report with
 * a non-string status, junk/duplicate/unknown surface strings, and an extremely
 * long / secret-shaped app name ⇒ a valid bounded result, never a throw, never a
 * leaked secret, findings ≤ order length.
 *
 * Pure — loads under tsx (the core has ZERO runtime imports).
 */

import {
  reconcileLiveSurfaceViability,
  summarizeLiveSurfaceViability,
  MAX_SURFACES,
  MAX_REPORTS,
  MAX_APP_NAME_CHARS,
  MAX_REASON_CHARS,
  MAX_ACTION_CHARS,
  MAX_NOTE_CHARS,
  MAX_SUMMARY_CHARS,
  type LiveSurfaceViabilityResult,
  type LiveSurfaceViabilityStatus,
  type LiveSurfacePreconditionKind,
  type LiveSurfaceDisposition,
} from '../src/lib/liveSurfaceViabilityCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── vocab (validation source of truth, local to the smoke) ───────────────────
const STATUSES: LiveSurfaceViabilityStatus[] = ['viable', 'unverified', 'precondition', 'mismatch', 'dead'];
const PRECONDITION_KINDS: LiveSurfacePreconditionKind[] = [
  'launch_app',
  'focus_app',
  'restart_bridge',
  'install_app',
  'grant_accessibility',
  'switch_to_browser',
];
const DISPOSITIONS: LiveSurfaceDisposition[] = [
  'reachable',
  'unverified',
  'needs_launch',
  'needs_focus',
  'needs_restart',
  'a11y_degraded',
  'bridge_offline',
  'not_installed',
  'web_mismatch',
  'no_desktop_reports',
];
const KNOWN_SURFACES = new Set<string>([
  'model_only',
  'integration_api',
  'browser_semantic',
  'browser_stagehand',
  'browser_remote',
  'desktop_bridge',
  'desktop_a11y',
  'desktop_vision',
  'terminal_bridge',
  'code_tools',
  'vault',
  'memory',
  'office',
  'human_takeover',
]);
const DESKTOP = new Set<string>(['desktop_bridge', 'desktop_a11y', 'desktop_vision']);

// Detect any control / DEL / C1 / fence char OR the two Unicode line separators
// + zero-width/bidi markers (built via fromCharCode so no raw invisibles here).
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
const ZW = String.fromCharCode(0x200b, 0x200f, 0x202e, 0x2066, 0xfeff);
function hasUnsafeChars(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (/[\x00-\x1f\x7f-\x9f`<>]/.test(s)) return true;
  for (const ch of LINE_SEP + ZW) if (s.indexOf(ch) >= 0) return true;
  return false;
}

// ── report fixture builder (keeps hostile call sites cast-free) ──────────────
type St =
  | 'reachable'
  | 'needs_launch'
  | 'needs_focus'
  | 'bridge_offline'
  | 'bridge_outdated'
  | 'not_installed'
  | 'a11y_blocked'
  | 'web_app'
  | 'unknown';
function rep(status: St, opts?: { name?: string; userAction?: string | null; chatCanFix?: boolean }): unknown {
  return {
    status,
    resolvedAppName: opts?.name ?? 'Photoshop',
    userAction: opts?.userAction === undefined ? `fix-${status}` : opts.userAction,
    chatCanFix: opts?.chatCanFix ?? false,
  };
}

// ── call wrapper (hostile fixtures stay cast-free at the call sites) ──────────
function run(order?: unknown, reachability?: unknown): LiveSurfaceViabilityResult {
  return reconcileLiveSurfaceViability({
    preferredSurfaceOrder: order as never,
    reachability: reachability as never,
  });
}

/** Structural invariants any result must satisfy. */
function resultIsValid(r: unknown, orderLen: number): r is LiveSurfaceViabilityResult {
  if (!r || typeof r !== 'object') return false;
  const rr = r as LiveSurfaceViabilityResult;
  if (typeof rr.appName !== 'string' || rr.appName.length === 0 || rr.appName.length > MAX_APP_NAME_CHARS + 1) return false;
  if (hasUnsafeChars(rr.appName)) return false;
  if (typeof rr.reportCount !== 'number' || rr.reportCount < 0) return false;
  if (!DISPOSITIONS.includes(rr.disposition)) return false;
  if (rr.startSurface !== null && !KNOWN_SURFACES.has(rr.startSurface)) return false;
  if (typeof rr.startChatCanFix !== 'boolean') return false;
  if (typeof rr.degraded !== 'boolean') return false;
  if (typeof rr.surfaceMismatch !== 'boolean') return false;
  if (typeof rr.desktopViable !== 'boolean') return false;
  if (typeof rr.degradeNote !== 'string' || rr.degradeNote.length > MAX_NOTE_CHARS || hasUnsafeChars(rr.degradeNote)) return false;
  if (typeof rr.summary !== 'string' || rr.summary.length === 0 || rr.summary.length > MAX_SUMMARY_CHARS || hasUnsafeChars(rr.summary)) return false;
  if (rr.userAction !== null) {
    if (typeof rr.userAction !== 'string' || rr.userAction.length > MAX_ACTION_CHARS || hasUnsafeChars(rr.userAction)) return false;
  }
  if (!Array.isArray(rr.findings) || rr.findings.length > orderLen) return false;
  const seenSurface = new Set<string>();
  for (const f of rr.findings) {
    if (!f || typeof f !== 'object') return false;
    if (!KNOWN_SURFACES.has(f.surface)) return false;
    if (seenSurface.has(f.surface)) return false; // deduped
    seenSurface.add(f.surface);
    if (!STATUSES.includes(f.status)) return false;
    if (typeof f.reason !== 'string' || f.reason.length === 0 || f.reason.length > MAX_REASON_CHARS || hasUnsafeChars(f.reason)) return false;
  }
  if (!Array.isArray(rr.prunedSurfaces) || rr.prunedSurfaces.length > rr.findings.length) return false;
  for (const s of rr.prunedSurfaces) if (!KNOWN_SURFACES.has(s)) return false;
  if (rr.startPrecondition !== null) {
    const p = rr.startPrecondition;
    if (!p || typeof p !== 'object') return false;
    if (!PRECONDITION_KINDS.includes(p.kind)) return false;
    if (p.surface !== null && !KNOWN_SURFACES.has(p.surface)) return false;
    if (typeof p.chatCanFix !== 'boolean') return false;
    if (typeof p.action !== 'string' || p.action.length === 0 || p.action.length > MAX_ACTION_CHARS || hasUnsafeChars(p.action)) return false;
  }
  // cross-field invariants
  if (rr.startSurface !== null && rr.prunedSurfaces.includes(rr.startSurface)) return false; // start is never pruned
  if (rr.startChatCanFix !== (rr.startPrecondition ? rr.startPrecondition.chatCanFix : false)) return false;
  if (rr.degraded && rr.degradeNote.length === 0) return false;
  if (!rr.degraded && rr.degradeNote.length !== 0) return false;
  if (summarizeLiveSurfaceViability(rr) !== rr.summary) return false; // summary is stable
  return true;
}

function totalOn(order: unknown, reachability: unknown, orderLen: number): boolean {
  try {
    const r = run(order, reachability);
    if (!resultIsValid(r, orderLen)) return false;
    // summarize must also be total on the produced result
    const s = summarizeLiveSurfaceViability(r);
    return typeof s === 'string' && s.length <= MAX_SUMMARY_CHARS && !hasUnsafeChars(s);
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (A) reachable desktop — happy path ─────────────────────────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('reachable'));
    assertEq(r.startSurface, 'desktop_a11y', '(A) start=desktop_a11y');
    assertEq(r.startPrecondition, null, '(A) no precondition');
    assertEq(r.startChatCanFix, false, '(A) chatCanFix false (nothing to fix)');
    assertEq(r.degraded, false, '(A) not degraded');
    assertEq(r.degradeNote, '', '(A) no degrade note');
    assertEq(r.surfaceMismatch, false, '(A) no mismatch');
    assertEq(r.desktopViable, true, '(A) desktop viable');
    assertEq(r.userAction, null, '(A) no user action');
    assertEq(r.disposition, 'reachable', '(A) disposition reachable');
    assertJson(r.prunedSurfaces, [], '(A) nothing pruned');
    assertEq(r.findings.length, 2, '(A) one finding per surface');
    assertEq(r.findings[0].status, 'viable', '(A) desktop_a11y viable');
    assert(resultIsValid(r, 2), '(A) result valid');
    assert(/Photoshop/.test(r.appName), '(A) app name resolved', r.appName);
  }

  // ─── (B) a11y_blocked → degrade to vision ───────────────────────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('a11y_blocked'));
    assertEq(r.startSurface, 'desktop_vision', '(B) start=desktop_vision');
    assertEq(r.degraded, true, '(B) degraded true');
    assert(/accessib/i.test(r.degradeNote), '(B) degradeNote mentions accessibility', r.degradeNote);
    assertEq(r.startPrecondition, null, '(B) degrade is not a precondition');
    assertEq(r.userAction, null, '(B) can proceed on vision → no user action');
    assertEq(r.disposition, 'a11y_degraded', '(B) disposition a11y_degraded');
    assertJson(r.prunedSurfaces, ['desktop_a11y'], '(B) a11y pruned');
    assertEq(r.findings[0].status, 'dead', '(B) desktop_a11y dead');
    assertEq(r.findings[1].status, 'viable', '(B) desktop_vision viable');
    assertEq(r.desktopViable, true, '(B) desktop still viable (vision)');
    // no vision fallback → cannot degrade, must grant accessibility
    const r2 = run(['desktop_a11y'], rep('a11y_blocked'));
    assertEq(r2.startSurface, null, '(B) a11y-only order → no start');
    assertEq(r2.degraded, false, '(B) cannot degrade without a fallback');
    assertEq(r2.startPrecondition?.kind, 'grant_accessibility', '(B) precondition grant_accessibility');
    assert(r2.userAction !== null, '(B) userAction present (grant)');
    assert(resultIsValid(r, 2) && resultIsValid(r2, 1), '(B) results valid');
  }

  // ─── (C) needs_launch → launch precondition (chat-fixable) ──────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('needs_launch', { chatCanFix: true, userAction: 'launch it after approval' }));
    assertEq(r.startSurface, 'desktop_a11y', '(C) start=desktop_a11y');
    assertEq(r.startPrecondition?.kind, 'launch_app', '(C) precondition launch_app');
    assertEq(r.startPrecondition?.surface, 'desktop_a11y', '(C) precondition on start surface');
    assertEq(r.startChatCanFix, true, '(C) chat can fix a launch');
    assert(r.userAction !== null, '(C) userAction non-null', String(r.userAction));
    assertEq(r.degraded, false, '(C) not degraded');
    assertEq(r.desktopViable, true, '(C) desktop viable via precondition');
    assertEq(r.disposition, 'needs_launch', '(C) disposition needs_launch');
    assertEq(r.findings[0].status, 'precondition', '(C) desktop_a11y precondition');
    assert(resultIsValid(r, 2), '(C) result valid');
  }

  // ─── (D) needs_focus → focus precondition (chat-fixable) ────────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('needs_focus', { chatCanFix: true }));
    assertEq(r.startSurface, 'desktop_a11y', '(D) start=desktop_a11y');
    assertEq(r.startPrecondition?.kind, 'focus_app', '(D) precondition focus_app');
    assertEq(r.startChatCanFix, true, '(D) chat can fix a focus');
    assert(r.userAction !== null, '(D) userAction non-null');
    assertEq(r.disposition, 'needs_focus', '(D) disposition needs_focus');
    assert(resultIsValid(r, 2), '(D) result valid');
  }

  // ─── (E) bridge_outdated → restart precondition (NOT dead, not chat-fixable) ─
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('bridge_outdated', { userAction: 'restart with npm run bridge' }));
    assertEq(r.startSurface, 'desktop_a11y', '(E) start=desktop_a11y (not dead)');
    assertEq(r.startPrecondition?.kind, 'restart_bridge', '(E) precondition restart_bridge');
    assertEq(r.startChatCanFix, false, '(E) chat cannot restart the bridge');
    assert(r.userAction !== null, '(E) userAction non-null (restart)');
    assertEq(r.disposition, 'needs_restart', '(E) disposition needs_restart');
    assertEq(r.findings[0].status, 'precondition', '(E) desktop_a11y precondition (not dead)');
    assertJson(r.prunedSurfaces, [], '(E) nothing pruned on outdated bridge');
    assert(resultIsValid(r, 2), '(E) result valid');
  }

  // ─── (F) bridge_offline → all desktop dead ──────────────────────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('bridge_offline', { userAction: 'Start the desktop bridge: npm run bridge' }));
    assertEq(r.startSurface, null, '(F) no start (all desktop dead)');
    assertEq(r.startPrecondition?.kind, 'restart_bridge', '(F) precondition restart_bridge');
    assertEq(r.startPrecondition?.surface, null, '(F) precondition surface null (nothing survives)');
    assertEq(r.startChatCanFix, false, '(F) chat cannot fix an offline bridge');
    assert(r.userAction !== null, '(F) userAction = restart bridge');
    assert(/bridge/i.test(String(r.userAction)), '(F) userAction mentions the bridge', String(r.userAction));
    assertEq(r.desktopViable, false, '(F) desktop not viable');
    assertEq(r.disposition, 'bridge_offline', '(F) disposition bridge_offline');
    assertJson(r.prunedSurfaces, ['desktop_a11y', 'desktop_vision'], '(F) both desktop surfaces pruned');
    assert(resultIsValid(r, 2), '(F) result valid');
    // with a browser surface present, the first survivor is the browser
    const r2 = run(['desktop_a11y', 'desktop_vision', 'browser_semantic'], rep('bridge_offline'));
    assertEq(r2.startSurface, 'browser_semantic', '(F) first survivor is the browser surface');
    assertEq(r2.desktopViable, false, '(F) desktop still not viable with a browser present');
    assert(resultIsValid(r2, 3), '(F) browser-fallback result valid');
  }

  // ─── (G) not_installed → dead / install ─────────────────────────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('not_installed', { name: 'FreeCAD', userAction: 'Install FreeCAD, then ask again.' }));
    assertEq(r.startSurface, null, '(G) not installed → no start');
    assertEq(r.startPrecondition?.kind, 'install_app', '(G) precondition install_app');
    assert(r.userAction !== null, '(G) userAction present (install)');
    assertEq(r.disposition, 'not_installed', '(G) disposition not_installed');
    assertEq(r.desktopViable, false, '(G) desktop not viable');
    assertEq(r.findings[0].status, 'dead', '(G) desktop_a11y dead');
    assert(/FreeCAD/.test(r.appName), '(G) app name from install probe', r.appName);
    assert(resultIsValid(r, 2), '(G) result valid');
  }

  // ─── (H) web_app → surface mismatch ─────────────────────────────────────────
  {
    // desktop-top order WITH a browser surface → falls to browser
    const r = run(['desktop_a11y', 'desktop_vision', 'browser_semantic'], rep('web_app', { name: 'Notion', userAction: null }));
    assertEq(r.surfaceMismatch, true, '(H) surfaceMismatch true');
    assertEq(r.startSurface, 'browser_semantic', '(H) start falls to browser_semantic');
    assertEq(r.startPrecondition?.kind, 'switch_to_browser', '(H) precondition switch_to_browser');
    assertEq(r.startChatCanFix, true, '(H) switching to browser is automatic');
    assertEq(r.userAction, null, '(H) no OS-level user action for a reroute');
    assertEq(r.disposition, 'web_mismatch', '(H) disposition web_mismatch');
    assertEq(r.desktopViable, false, '(H) desktop not viable for a web app');
    assertJson(r.prunedSurfaces, ['desktop_a11y', 'desktop_vision'], '(H) desktop pruned as mismatch');
    assertEq(r.findings[0].status, 'mismatch', '(H) desktop_a11y mismatch');
    assert(resultIsValid(r, 3), '(H) result valid');
    // desktop-only order → nothing survives
    const r2 = run(['desktop_a11y', 'desktop_vision'], rep('web_app'));
    assertEq(r2.surfaceMismatch, true, '(H) mismatch with desktop-only order');
    assertEq(r2.startSurface, null, '(H) no browser → no start');
    assertEq(r2.startPrecondition?.kind, 'switch_to_browser', '(H) still recommends switch_to_browser');
    assertEq(r2.startPrecondition?.chatCanFix, false, '(H) cannot auto-switch without a browser surface');
    assert(resultIsValid(r2, 2), '(H) desktop-only mismatch valid');
    // order without any desktop surface → NOT a mismatch (plan already browser)
    const r3 = run(['integration_api', 'browser_semantic'], rep('web_app'));
    assertEq(r3.surfaceMismatch, false, '(H) no desktop surface in order → no mismatch');
    assertEq(r3.startSurface, 'integration_api', '(H) start=integration_api');
    assert(resultIsValid(r3, 2), '(H) browser-plan result valid');
  }

  // ─── (I) unknown → unverified (never pruned without evidence) ───────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('unknown'));
    assertEq(r.startSurface, 'desktop_a11y', '(I) unknown keeps desktop_a11y startable');
    assertEq(r.findings[0].status, 'unverified', '(I) desktop_a11y unverified');
    assertEq(r.startPrecondition, null, '(I) no precondition on unverified');
    assertEq(r.degraded, false, '(I) not degraded');
    assertEq(r.userAction, null, '(I) no user action');
    assertJson(r.prunedSurfaces, [], '(I) nothing pruned without evidence');
    assert(resultIsValid(r, 2), '(I) result valid');
  }

  // ─── (J) multi-report worst-case fold ───────────────────────────────────────
  {
    // reachable + not_installed → not_installed (worst) wins for desktop
    const r = run(['desktop_a11y', 'desktop_vision'], [rep('reachable', { name: 'Photoshop' }), rep('not_installed', { name: 'FreeCAD' })]);
    assertEq(r.disposition, 'not_installed', '(J) worst-case not_installed wins');
    assertEq(r.startSurface, null, '(J) no start (dead)');
    assertEq(r.reportCount, 2, '(J) both reports counted');
    assert(resultIsValid(r, 2), '(J) result valid');
    // reachable + web_app → desktop still governs (a real desktop app needs it)
    const r2 = run(['desktop_a11y', 'desktop_vision', 'browser_semantic'], [rep('reachable'), rep('web_app', { name: 'Notion' })]);
    assertEq(r2.surfaceMismatch, false, '(J) mixed desktop+web → not a pure mismatch');
    assertEq(r2.disposition, 'reachable', '(J) disposition reachable (desktop governs)');
    assertEq(r2.startSurface, 'desktop_a11y', '(J) start=desktop_a11y');
    assert(resultIsValid(r2, 3), '(J) mixed result valid');
    // worst-of desktop preconditions: needs_launch (worse) beats needs_focus
    const r3 = run(['desktop_a11y'], [rep('needs_focus'), rep('needs_launch')]);
    assertEq(r3.disposition, 'needs_launch', '(J) needs_launch outranks needs_focus');
    assertEq(r3.startPrecondition?.kind, 'launch_app', '(J) precondition launch_app');
    assert(resultIsValid(r3, 1), '(J) precondition-fold result valid');
  }

  // ─── (K) order normalization + findings ≤ order length ──────────────────────
  {
    // duplicates deduped, unknown/junk dropped
    const r = run(['desktop_a11y', 'desktop_a11y', 'nonsense', 'desktop_vision', 42, null], rep('reachable'));
    assertEq(r.findings.length, 2, '(K) dupes/junk removed → 2 findings');
    assertEq(r.findings[0].surface, 'desktop_a11y', '(K) first surface preserved');
    assertEq(r.findings[1].surface, 'desktop_vision', '(K) second surface preserved');
    assert(r.findings.length <= 6, '(K) findings ≤ input order length');
    assert(resultIsValid(r, 6), '(K) result valid');
    // full 14-surface order still bounded and valid
    const full = [
      'model_only', 'integration_api', 'browser_semantic', 'browser_stagehand', 'browser_remote',
      'desktop_bridge', 'desktop_a11y', 'desktop_vision', 'terminal_bridge', 'code_tools',
      'vault', 'memory', 'office', 'human_takeover',
    ];
    const rf = run(full, rep('reachable'));
    assert(rf.findings.length <= MAX_SURFACES, '(K) findings ≤ MAX_SURFACES', String(rf.findings.length));
    assertEq(rf.findings.length, 14, '(K) all 14 valid surfaces kept');
    assert(resultIsValid(rf, 14), '(K) full-order result valid');
    // empty / no valid surfaces
    const re = run([], rep('reachable'));
    assertEq(re.startSurface, null, '(K) empty order → no start');
    assertJson(re.findings, [], '(K) empty order → no findings');
    assert(resultIsValid(re, 0), '(K) empty-order result valid');
  }

  // ─── (L) bounds / caps / clamping ───────────────────────────────────────────
  {
    assertEq(MAX_SURFACES, 16, '(L) MAX_SURFACES');
    assertEq(MAX_REPORTS, 24, '(L) MAX_REPORTS');
    assertEq(MAX_APP_NAME_CHARS, 48, '(L) MAX_APP_NAME_CHARS');
    assertEq(MAX_REASON_CHARS, 160, '(L) MAX_REASON_CHARS');
    assertEq(MAX_ACTION_CHARS, 200, '(L) MAX_ACTION_CHARS');
    assertEq(MAX_NOTE_CHARS, 200, '(L) MAX_NOTE_CHARS');
    assertEq(MAX_SUMMARY_CHARS, 240, '(L) MAX_SUMMARY_CHARS');
    // extremely long app name → clamped, not echoed raw
    const longName = 'Photoshop ' + 'Creative '.repeat(200);
    const r = run(['desktop_a11y'], rep('needs_launch', { name: longName, userAction: 'x '.repeat(400) }));
    assert(r.appName.length <= MAX_APP_NAME_CHARS + 1, '(L) appName clamped', String(r.appName.length));
    assert(String(r.userAction).length <= MAX_ACTION_CHARS, '(L) userAction clamped', String(String(r.userAction).length));
    for (const f of r.findings) assert(f.reason.length <= MAX_REASON_CHARS, '(L) reason clamped', String(f.reason.length));
    assert(r.summary.length <= MAX_SUMMARY_CHARS, '(L) summary clamped', String(r.summary.length));
    assert(resultIsValid(r, 1), '(L) long-name result valid');
    // huge (10k) reachability array → capped, still total
    const huge = new Array(10000).fill(rep('reachable'));
    const rh = run(['desktop_a11y', 'desktop_vision'], huge);
    assert(rh.reportCount <= MAX_REPORTS, '(L) reports capped at MAX_REPORTS', String(rh.reportCount));
    assert(resultIsValid(rh, 2), '(L) huge-array result valid');
  }

  // ─── (M) determinism (same input twice → identical JSON) ────────────────────
  {
    const cases: Array<[unknown, unknown]> = [
      [['desktop_a11y', 'desktop_vision'], rep('reachable')],
      [['desktop_a11y', 'desktop_vision'], rep('a11y_blocked')],
      [['desktop_a11y', 'desktop_vision'], rep('needs_launch', { chatCanFix: true })],
      [['desktop_a11y', 'desktop_vision'], rep('bridge_offline')],
      [['desktop_a11y', 'desktop_vision', 'browser_semantic'], rep('web_app')],
      [['desktop_a11y'], [rep('reachable'), rep('not_installed')]],
      [['integration_api', 'browser_semantic'], rep('unknown')],
    ];
    for (const [o, rc] of cases) {
      const a = run(o, rc);
      const b = run(o, rc);
      assertJson(a, b, `(M) deterministic: ${JSON.stringify(o)}`);
      assertEq(summarizeLiveSurfaceViability(a), summarizeLiveSurfaceViability(b), '(M) summary deterministic');
    }
  }

  // ─── (N) summarize helper ───────────────────────────────────────────────────
  {
    const r = run(['desktop_a11y', 'desktop_vision'], rep('a11y_blocked'));
    const s = summarizeLiveSurfaceViability(r);
    assert(s.length > 0 && s.length <= MAX_SUMMARY_CHARS, '(N) summary bounded');
    assert(/start=desktop_vision/.test(s), '(N) summary shows start surface', s);
    assert(/degraded=1/.test(s), '(N) summary shows degraded flag', s);
    assert(/disp=a11y_degraded/.test(s), '(N) summary shows disposition', s);
    // total on garbage
    assertEq(summarizeLiveSurfaceViability(null), summarizeLiveSurfaceViability(null), '(N) summarize(null) stable');
    assert(typeof summarizeLiveSurfaceViability(undefined) === 'string', '(N) summarize(undefined) is a string');
    assert(typeof summarizeLiveSurfaceViability(42 as never) === 'string', '(N) summarize(number) is a string');
    assert(typeof summarizeLiveSurfaceViability({} as never) === 'string', '(N) summarize({}) is a string');
  }

  // ─── (HOSTILE) totality: never throw, never leak ────────────────────────────
  try {
    // hostile order values
    for (const badOrder of [null, undefined, 42, NaN, true, {}, 'desktop_a11y', () => 1, Symbol('s'), 9n, Infinity]) {
      assert(totalOn(badOrder, rep('reachable'), 0), 'hostile order is total', JSON.stringify(String(badOrder).slice(0, 16)));
    }
    // hostile reachability values
    for (const badReach of [null, undefined, 42, NaN, true, 'nope', () => [], Symbol('x'), 7n, Infinity, -0]) {
      assert(totalOn(['desktop_a11y', 'desktop_vision'], badReach, 2), 'hostile reachability is total', JSON.stringify(String(badReach).slice(0, 16)));
    }
    // empty object / array as reachability
    assert(totalOn(['desktop_a11y'], {}, 1), 'reachability {} is total');
    assert(totalOn(['desktop_a11y'], [], 1), 'reachability [] is total');
    // a bare {} report → unknown status → unverified (a desktop report exists)
    {
      const r = run(['desktop_a11y'], {});
      assertEq(r.disposition, 'unverified', 'bare {} → unknown status → unverified disposition');
      assertEq(r.findings[0].status, 'unverified', 'bare {} → unverified surface');
      assert(resultIsValid(r, 1), 'bare {} result valid');
    }
    // truly empty reports → no_desktop_reports (nothing governs the desktop)
    {
      const r = run(['desktop_a11y'], []);
      assertEq(r.disposition, 'no_desktop_reports', '[] reachability → no_desktop_reports');
      assertEq(r.findings[0].status, 'unverified', 'no reports → surface unverified, not pruned');
      assert(resultIsValid(r, 1), 'no-reports result valid');
    }
    // array of junk report entries → all dropped except objects (→ unknown)
    assert(totalOn(['desktop_a11y'], [null, undefined, 1, 'x', true, {}, []], 1), 'junk-entry reachability is total');
    // report with a non-string status
    assert(totalOn(['desktop_a11y'], [{ status: 123, resolvedAppName: 'X' }], 1), 'non-string status is total');
    {
      const r = run(['desktop_a11y'], [{ status: 999, resolvedAppName: 'X' } as never]);
      assertEq(r.findings[0].status, 'unverified', 'non-string status → unverified surface');
    }
    // report with NaN / weird fields
    assert(totalOn(['desktop_a11y'], [{ status: NaN, userAction: NaN, chatCanFix: NaN }], 1), 'NaN-field report is total');

    // throwing-getter report: one bad report must not nuke the result
    const throwing = {} as Record<string, unknown>;
    Object.defineProperty(throwing, 'status', { get() { throw new Error('status boom'); }, enumerable: true });
    Object.defineProperty(throwing, 'resolvedAppName', { get() { throw new Error('name boom'); }, enumerable: true });
    assert(totalOn(['desktop_a11y', 'desktop_vision'], [throwing, rep('reachable')], 2), 'throwing-getter report is total');

    // whole reachability is a throwing proxy (Array.isArray false) → single unknown report
    const throwingProxy = new Proxy({}, { get() { throw new Error('proxy boom'); } });
    assert(totalOn(['desktop_a11y'], throwingProxy, 1), 'throwing-proxy reachability is total');

    // cyclic reachability array (contains itself)
    const cyc: unknown[] = [rep('reachable')];
    cyc.push(cyc);
    assert(totalOn(['desktop_a11y', 'desktop_vision'], cyc, 2), 'cyclic reachability is total');
    assert(resultIsValid(run(['desktop_a11y', 'desktop_vision'], cyc), 2), 'cyclic reachability → valid result');

    // junk / duplicate / unknown surface strings in the order
    assert(totalOn(['desktop_a11y', 'desktop_a11y', 'DESKTOP_A11Y', 'foobar', '', '  '], rep('reachable'), 6), 'junk order strings total');
    {
      const r = run(['desktop_a11y', 'desktop_a11y', 'foobar', '', 'desktop_vision'], rep('reachable'));
      assertEq(r.findings.length, 2, 'junk order → 2 valid deduped surfaces');
    }

    // secret-shaped app name → never echoed anywhere in the result
    const SK = 'sk-ant-' + 'a'.repeat(48);
    const rSecret = run(['desktop_a11y'], rep('not_installed', { name: `App ${SK}`, userAction: `install ${SK} now` }));
    assert(resultIsValid(rSecret, 1), 'secret-name result valid');
    assert(!JSON.stringify(rSecret).includes('sk-ant'), 'secret never leaks into the result', JSON.stringify(rSecret).slice(0, 100));
    assert(!JSON.stringify(rSecret).includes('aaaaaaaaaa'), 'secret body never leaks');

    // JWT-shaped name → masked
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const rJwt = run(['desktop_a11y'], rep('needs_launch', { name: `Doc ${JWT}` }));
    assert(!JSON.stringify(rJwt).includes('eyJ'), 'JWT never leaks into the result');

    // bidi / zero-width / control injection in name + action → stripped
    const inj = 'Ph' + String.fromCharCode(0x202e) + 'oto' + String.fromCharCode(0x200b) + 'shop';
    const injAction = 'do' + String.fromCharCode(0) + ' `it` <now>' + String.fromCharCode(0x2028);
    const rInj = run(['desktop_a11y'], rep('needs_launch', { name: inj, userAction: injAction }));
    assert(resultIsValid(rInj, 1), 'injection input → valid result');
    assert(!hasUnsafeChars(JSON.stringify(rInj)), 'no control/bidi/zero-width/fence chars anywhere in the result');

    // huge order (many repeated + junk) stays bounded
    const bigOrder = new Array(500).fill('desktop_a11y').concat(new Array(500).fill('junk'));
    assert(totalOn(bigOrder, rep('reachable'), bigOrder.length), 'huge order is total');
    {
      const r = run(bigOrder, rep('reachable'));
      assert(r.findings.length <= MAX_SURFACES, 'huge order capped by dedupe/MAX_SURFACES', String(r.findings.length));
    }

    // a battery of mixed inputs all obey the invariants
    const battery: Array<[unknown, unknown, number]> = [
      [['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'human_takeover'], rep('reachable'), 4],
      [['vault', 'browser_semantic', 'desktop_bridge'], rep('web_app'), 3],
      [['desktop_a11y', 'desktop_vision'], rep('needs_focus', { chatCanFix: true }), 2],
      [['desktop_a11y'], rep('bridge_outdated'), 1],
      [['integration_api'], rep('unknown'), 1],
      [['desktop_a11y', 'browser_stagehand'], [rep('not_installed'), rep('web_app')], 2],
      [['model_only'], null, 1],
    ];
    for (const [o, rc, len] of battery) {
      assert(totalOn(o, rc, len), 'battery input total', JSON.stringify(o));
    }

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  // ─── (O) TOTAL contract: throwing top-level reads / proxy / array elements ───
  // Regression: reconcile must NEVER throw when the READ of preferredSurfaceOrder
  // / reachability itself throws (a throwing accessor, or a throwing Proxy input),
  // nor when an order/reachability ARRAY element getter throws. Cases 1–3 bypass
  // run()'s plain-object wrapper by calling the export directly (that wrapper is
  // what previously hid the top-level throwing-read from the sibling smoke). No
  // throwing value is ever String()-ed into an assert message.
  {
    const safeReconcile = (bad: unknown): LiveSurfaceViabilityResult | null => {
      try {
        return reconcileLiveSurfaceViability(bad as never);
      } catch {
        return null; // a throw here IS the bug
      }
    };

    // 1) top-level throwing getter on preferredSurfaceOrder (the exact failing input)
    const throwOrderProp = Object.defineProperty({ reachability: null }, 'preferredSurfaceOrder', {
      get() { throw new Error('order-prop boom'); },
      enumerable: true,
      configurable: true,
    });
    const rO1 = safeReconcile(throwOrderProp);
    assert(rO1 !== null && resultIsValid(rO1, 0), '(O) throwing preferredSurfaceOrder getter → valid result, no throw');
    assertEq(rO1?.disposition, 'no_desktop_reports', '(O) throwing order getter → no_desktop_reports');
    assertEq(rO1?.startSurface, null, '(O) throwing order getter → no start surface');

    // 2) top-level throwing getter on reachability (order still normalizes → partial progress kept)
    const throwReachProp = Object.defineProperty({ preferredSurfaceOrder: ['desktop_a11y'] }, 'reachability', {
      get() { throw new Error('reach-prop boom'); },
      enumerable: true,
      configurable: true,
    });
    const rO2 = safeReconcile(throwReachProp);
    assert(rO2 !== null && resultIsValid(rO2, 1), '(O) throwing reachability getter → valid result, no throw');
    assertEq(rO2?.findings.length, 1, '(O) throwing reachability getter → order findings preserved');

    // 3) whole input is a throwing Proxy (every property read throws)
    const throwInputProxy = new Proxy({}, { get() { throw new Error('input-proxy boom'); } });
    const rO3 = safeReconcile(throwInputProxy);
    assert(rO3 !== null && resultIsValid(rO3, 0), '(O) throwing-proxy input → valid result, no throw');

    // 4) preferredSurfaceOrder is an array whose index-0 getter throws (through run())
    const throwOrderArr: unknown[] = ['desktop_a11y'];
    Object.defineProperty(throwOrderArr, 0, { get() { throw new Error('order-el boom'); }, enumerable: true, configurable: true });
    assert(totalOn(throwOrderArr, rep('reachable'), 1), '(O) throwing order-array element getter → total');

    // 5) reachability is an array whose index-0 getter throws (through run())
    const throwReachArr: unknown[] = [rep('reachable')];
    Object.defineProperty(throwReachArr, 0, { get() { throw new Error('reach-el boom'); }, enumerable: true, configurable: true });
    assert(totalOn(['desktop_a11y', 'desktop_vision'], throwReachArr, 2), '(O) throwing reachability-array element getter → total');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll live-surface-viability-core smoke cases passed (${passes} assertions).`);
}

main();
