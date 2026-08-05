/**
 * liveSurfaceViabilityCore — PRE-FLIGHT execution-surface reconciler.
 *
 * Given a plan's static `preferredSurfaceOrder` (ExecutionSurface[], from
 * scenarioPolicies / executionSurfaceRouter) and ONE-OR-MANY LIVE per-app
 * reachability reports (AppReachabilityReport, from appReachability +
 * appReachabilityProbe), this core:
 *   1. prunes the desktop surfaces the probe PROVES dead (bridge offline,
 *      app not installed, accessibility unreadable, wrong route);
 *   2. picks the effective START surface — the first surviving surface in the
 *      plan's own priority order — so the doomed a11y/launch/desktop attempt
 *      never runs;
 *   3. emits the ONE precondition (launch/focus/restart/install/switch) or the
 *      ONE degrade (accessibility blocked → start on vision) needed to proceed.
 *
 * Distinct from the neighbours (do NOT fold together):
 *   - executionSurfaceRouter picks primary+fallbacks from a COARSE
 *     boolean|'unknown' readiness with no "installed+bridge-up but not running,
 *     chat-fixable" state and no precondition ACTION; this core produces exactly
 *     those from the live ladder and can FEED it.
 *   - planSurfaceEscalation is MID-RUN over a real FAILURE signal; this is
 *     PRE-FLIGHT over a read-only probe (nothing has run yet).
 *   - appReachability emits the per-app status but makes no surface-plan
 *     decision (single app, no ExecutionSurface awareness); this CONSUMES its
 *     report and is the missing fuse.
 *   - appScreenNextStep advises micro-steps for an ALREADY-chosen desktop app
 *     assuming the bridge is up; it composes AFTER this core selects a surface.
 *
 * HOUSE PATTERN: dependency-light (type-only imports — loads under tsx),
 * TOTAL (never throws on null/undefined/wrong-type/cyclic/proxy/huge input),
 * BOUNDED (exported MAX_* caps; every string clamped, every array capped),
 * DETERMINISTIC (no Date/Math.random; frozen const maps), SECRET-SAFE (control
 * / line-separator / zero-width / bidi / prompt-fence chars stripped and
 * secret-shaped tokens masked before any value reaches reason/summary/action).
 *
 * Smoke: scripts/live-surface-viability-core-smoketest.ts
 */

import type { ExecutionSurface } from './scenarioPolicies';
import type { AppReachabilityReport, AppReachabilityStatus } from './appReachability';

// ─── Bounds (exported so the smoke can pin them) ─────────────────────────────

export const MAX_SURFACES = 16;
export const MAX_REPORTS = 24;
export const MAX_APP_NAME_CHARS = 48;
export const MAX_REASON_CHARS = 160;
export const MAX_ACTION_CHARS = 200;
export const MAX_NOTE_CHARS = 200;
export const MAX_SUMMARY_CHARS = 240;

// ─── Public shapes ───────────────────────────────────────────────────────────

/** Per-surface verdict after reconciling the plan order with the live probe. */
export type LiveSurfaceViabilityStatus =
  | 'viable' // usable now
  | 'unverified' // not proven dead — usable, but the probe gave no live confirmation
  | 'precondition' // usable after ONE precondition (launch / focus / bridge restart)
  | 'mismatch' // wrong surface family (desktop surface chosen for a web app)
  | 'dead'; // the live probe proved this surface unusable for this task

/** The one thing to do before the chosen start surface can be used. */
export type LiveSurfacePreconditionKind =
  | 'launch_app'
  | 'focus_app'
  | 'restart_bridge'
  | 'install_app'
  | 'grant_accessibility'
  | 'switch_to_browser';

/** Coarse pre-flight disposition folded across every governing report. */
export type LiveSurfaceDisposition =
  | 'reachable'
  | 'unverified'
  | 'needs_launch'
  | 'needs_focus'
  | 'needs_restart'
  | 'a11y_degraded'
  | 'bridge_offline'
  | 'not_installed'
  | 'web_mismatch'
  | 'no_desktop_reports';

export interface LiveSurfaceViabilityFinding {
  surface: ExecutionSurface;
  status: LiveSurfaceViabilityStatus;
  /** ≤{@link MAX_REASON_CHARS} chars, structural wording only. */
  reason: string;
}

export interface LiveSurfacePrecondition {
  kind: LiveSurfacePreconditionKind;
  /** The surface it unblocks, or null when it is a route switch / no surface survives. */
  surface: ExecutionSurface | null;
  /** True only when chat/automation can clear it after approval (launch/focus/reroute). */
  chatCanFix: boolean;
  /** ≤{@link MAX_ACTION_CHARS} chars, sanitized. */
  action: string;
}

export interface LiveSurfaceViabilityResult {
  /** Sanitized best-known app name across the reports, or 'the app'. */
  appName: string;
  /** How many governing reports were considered (after normalization/cap). */
  reportCount: number;
  /** Coarse folded disposition (telemetry-friendly). */
  disposition: LiveSurfaceDisposition;
  /** First surviving surface in plan order, or null when none survives. */
  startSurface: ExecutionSurface | null;
  /** The single precondition to satisfy before starting, or null. */
  startPrecondition: LiveSurfacePrecondition | null;
  /** Mirrors {@link startPrecondition}.chatCanFix (false when there is none). */
  startChatCanFix: boolean;
  /** True when we start on a lesser desktop surface (vision) because a11y is blocked. */
  degraded: boolean;
  /** ≤{@link MAX_NOTE_CHARS} chars; '' unless {@link degraded}. */
  degradeNote: string;
  /** True when the plan wants a desktop surface but the app is a web app. */
  surfaceMismatch: boolean;
  /** True when at least one desktop surface is startable (viable/unverified/precondition). */
  desktopViable: boolean;
  /** The single user action to surface, or null when the run can proceed as-is. */
  userAction: string | null;
  /** One finding per normalized surface (length ≤ input order length). */
  findings: LiveSurfaceViabilityFinding[];
  /** Surfaces proven dead or mismatched, in plan order. */
  prunedSurfaces: ExecutionSurface[];
  /** ≤{@link MAX_SUMMARY_CHARS} chars, structural telemetry line. */
  summary: string;
}

export interface LiveSurfaceViabilityInput {
  preferredSurfaceOrder: ExecutionSurface[];
  /** One report or a list — desktop apps govern desktop surfaces; a web app trips the mismatch. */
  reachability: AppReachabilityReport | AppReachabilityReport[] | null | undefined;
}

// ─── Frozen vocabulary (lockstep with scenarioPolicies.ExecutionSurface) ─────

const KNOWN_EXECUTION_SURFACES: ReadonlySet<string> = new Set<string>([
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

const DESKTOP_SURFACES: ReadonlySet<ExecutionSurface> = new Set<ExecutionSurface>([
  'desktop_bridge',
  'desktop_a11y',
  'desktop_vision',
]);

const BROWSER_SURFACES: ReadonlySet<ExecutionSurface> = new Set<ExecutionSurface>([
  'browser_semantic',
  'browser_stagehand',
  'browser_remote',
]);

const KNOWN_REACHABILITY_STATUSES: ReadonlySet<string> = new Set<string>([
  'reachable',
  'needs_launch',
  'needs_focus',
  'bridge_offline',
  'bridge_outdated',
  'not_installed',
  'a11y_blocked',
  'web_app',
  'unknown',
]);

/** Internal per-app disposition (before folding). */
type DesktopDisposition =
  | 'reachable'
  | 'unverified'
  | 'needs_launch'
  | 'needs_focus'
  | 'needs_restart'
  | 'a11y_degraded'
  | 'bridge_offline'
  | 'not_installed';

/** Lower = worse. The worst governing report wins the fold. */
const DESKTOP_DISPOSITION_SEVERITY: Readonly<Record<DesktopDisposition, number>> = Object.freeze({
  bridge_offline: 0,
  not_installed: 1,
  needs_restart: 2,
  needs_launch: 3,
  needs_focus: 4,
  a11y_degraded: 5,
  unverified: 6,
  reachable: 7,
});

const FALLBACK_ACTIONS: Readonly<Record<LiveSurfacePreconditionKind, (app: string) => string>> = Object.freeze({
  launch_app: (a) => `Launch ${a} first — chat can do this directly and verify the foreground app.`,
  focus_app: (a) => `Bring ${a} to the front first — chat can do this directly and verify the foreground app.`,
  restart_bridge: () => 'Restart the desktop bridge (npm run bridge), then try again.',
  install_app: (a) => `Install ${a} on this machine, then try again.`,
  grant_accessibility: (a) =>
    `Grant Accessibility permission for ${a} to the bridge host in System Settings, then restart the bridge.`,
  switch_to_browser: (a) => `${a} runs in the browser — using the browser surface instead of the desktop surface.`,
});

// ─── Sanitation helpers (self-contained, never throw) ────────────────────────

/**
 * Mask secret-shaped tokens deterministically BEFORE any value is echoed.
 * Specific shapes run first, then hex/generic long-token catch-alls.
 */
function maskSecrets(input: string): string {
  let out = input;
  try {
    out = out.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, '[redacted]'); // JWT
    out = out.replace(/sk-[A-Za-z0-9-]{6,}/gi, '[redacted]'); // sk- / sk-ant-
    out = out.replace(/(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{6,}/gi, '[redacted]');
    out = out.replace(/xox[baprs]-[A-Za-z0-9-]{6,}/gi, '[redacted]');
    out = out.replace(/AKIA[0-9A-Z]{8,}/g, '[redacted]'); // AWS access key id
    out = out.replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [redacted]');
    out = out.replace(/[A-Fa-f0-9]{32,}/g, '[redacted]'); // long hex (hashes/keys)
    out = out.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]'); // generic long opaque token
  } catch {
    return '[redacted]';
  }
  return out;
}

/**
 * Strip control / DEL / C1 / line-and-paragraph separators / zero-width / bidi
 * / prompt-fence chars, mask secrets, and collapse whitespace. Never throws.
 */
function baseSanitize(raw: unknown): string {
  let s: string;
  try {
    s = raw === null || raw === undefined ? '' : String(raw);
  } catch {
    return '';
  }
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff`<>]/g, ' ');
  s = maskSecrets(s);
  return s.replace(/\s+/g, ' ').trim();
}

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

function safeAction(raw: unknown): string {
  return clampText(baseSanitize(raw), MAX_ACTION_CHARS);
}

function safeReason(raw: unknown): string {
  return clampText(baseSanitize(raw), MAX_REASON_CHARS);
}

function safeNote(raw: unknown): string {
  return clampText(baseSanitize(raw), MAX_NOTE_CHARS);
}

/** App names live OUTSIDE any fence — charset-restrict to a trustworthy set. */
function safeName(raw: unknown, fallback = 'the app'): string {
  const cleaned = baseSanitize(raw)
    .replace(/[^A-Za-z0-9 ._()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_APP_NAME_CHARS)
    .trim();
  return cleaned || fallback;
}

// ─── Report + order normalization ────────────────────────────────────────────

interface SafeReport {
  status: AppReachabilityStatus;
  resolvedAppName: string;
  userAction: string | null;
  chatCanFix: boolean;
}

function readField(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function toSafeReport(raw: unknown): SafeReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const statusRaw = readField(raw, 'status');
  const status: AppReachabilityStatus =
    typeof statusRaw === 'string' && KNOWN_REACHABILITY_STATUSES.has(statusRaw)
      ? (statusRaw as AppReachabilityStatus)
      : 'unknown';

  let nameRaw = readField(raw, 'resolvedAppName');
  if (typeof nameRaw !== 'string' || !nameRaw.trim()) nameRaw = readField(raw, 'appName');
  const resolvedAppName = typeof nameRaw === 'string' && nameRaw.trim() ? safeName(nameRaw, '') : '';

  const actionRaw = readField(raw, 'userAction');
  const userAction = typeof actionRaw === 'string' && actionRaw.trim() ? safeAction(actionRaw) : null;

  const chatCanFix = readField(raw, 'chatCanFix') === true;
  return { status, resolvedAppName, userAction, chatCanFix };
}

function normalizeReports(input: unknown): SafeReport[] {
  let arr: unknown[];
  if (Array.isArray(input)) arr = input;
  else if (input && typeof input === 'object') arr = [input]; // a single report object
  else return [];
  const out: SafeReport[] = [];
  const limit = Math.min(arr.length, MAX_REPORTS);
  for (let i = 0; i < limit; i += 1) {
    const safe = toSafeReport(arr[i]);
    if (safe) out.push(safe);
  }
  return out;
}

function normalizeOrder(input: unknown): ExecutionSurface[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ExecutionSurface[] = [];
  for (const raw of input) {
    if (out.length >= MAX_SURFACES) break;
    if (typeof raw !== 'string') continue;
    const surface = raw.trim();
    if (!KNOWN_EXECUTION_SURFACES.has(surface)) continue; // drop junk/unknown surface strings
    if (seen.has(surface)) continue; // dedupe
    seen.add(surface);
    out.push(surface as ExecutionSurface);
  }
  return out;
}

// ─── Disposition mapping ─────────────────────────────────────────────────────

/** One reachability status → its desktop disposition ('web' routes to the mismatch axis). */
function statusToDesktopDisposition(status: AppReachabilityStatus): DesktopDisposition | 'web' {
  switch (status) {
    case 'reachable':
      return 'reachable';
    case 'needs_launch':
      return 'needs_launch';
    case 'needs_focus':
      return 'needs_focus';
    case 'bridge_outdated':
      return 'needs_restart';
    case 'a11y_blocked':
      return 'a11y_degraded';
    case 'bridge_offline':
      return 'bridge_offline';
    case 'not_installed':
      return 'not_installed';
    case 'web_app':
      return 'web';
    case 'unknown':
    default:
      return 'unverified';
  }
}

function dispositionToPreconditionKind(disposition: DesktopDisposition): LiveSurfacePreconditionKind {
  switch (disposition) {
    case 'needs_launch':
      return 'launch_app';
    case 'needs_focus':
      return 'focus_app';
    case 'needs_restart':
      return 'restart_bridge';
    default:
      return 'restart_bridge';
  }
}

/** Precondition kind when NO surface survives (start is null), keyed by the blocker. */
function deadDispositionToPreconditionKind(disposition: DesktopDisposition): LiveSurfacePreconditionKind | null {
  switch (disposition) {
    case 'bridge_offline':
      return 'restart_bridge';
    case 'not_installed':
      return 'install_app';
    case 'a11y_degraded':
      return 'grant_accessibility';
    case 'needs_restart':
      return 'restart_bridge';
    case 'needs_launch':
      return 'launch_app';
    case 'needs_focus':
      return 'focus_app';
    default:
      return null; // reachable / unverified → nothing to fix
  }
}

// ─── Per-surface classification ──────────────────────────────────────────────

function classifySurface(
  surface: ExecutionSurface,
  desktopDisposition: DesktopDisposition,
  surfaceMismatch: boolean,
): LiveSurfaceViabilityStatus {
  if (!DESKTOP_SURFACES.has(surface)) return 'viable'; // not governed by desktop reachability
  if (surfaceMismatch) return 'mismatch';
  switch (desktopDisposition) {
    case 'reachable':
      return 'viable';
    case 'unverified':
      return 'unverified';
    case 'needs_launch':
    case 'needs_focus':
    case 'needs_restart':
      return 'precondition';
    case 'bridge_offline':
    case 'not_installed':
      return 'dead';
    case 'a11y_degraded':
      // Accessibility read is blocked: the a11y surface is dead, vision/bridge survive.
      return surface === 'desktop_a11y' ? 'dead' : 'viable';
    default:
      return 'unverified';
  }
}

function reasonFor(
  surface: ExecutionSurface,
  status: LiveSurfaceViabilityStatus,
  desktopDisposition: DesktopDisposition,
  appName: string,
): string {
  if (!DESKTOP_SURFACES.has(surface)) {
    return safeReason(`${surface} is not gated by the desktop reachability probe.`);
  }
  if (status === 'mismatch') {
    return safeReason(`${appName} runs in the browser — ${surface} does not apply.`);
  }
  if (status === 'viable') {
    if (desktopDisposition === 'a11y_degraded' && surface !== 'desktop_a11y') {
      return safeReason(`${appName}'s accessibility is blocked — ${surface} is the viable fallback.`);
    }
    return safeReason(`${appName} is reachable — ${surface} is usable now.`);
  }
  if (status === 'unverified') {
    return safeReason(`${surface} is not confirmed by the live probe — usable but unverified.`);
  }
  if (status === 'precondition') {
    if (desktopDisposition === 'needs_launch') return safeReason(`${appName} is not running — ${surface} needs a launch first.`);
    if (desktopDisposition === 'needs_focus') return safeReason(`${appName} is not frontmost — ${surface} needs a focus first.`);
    if (desktopDisposition === 'needs_restart') return safeReason(`The desktop bridge is on an older build — ${surface} needs a bridge restart first.`);
    return safeReason(`${surface} needs a precondition first.`);
  }
  // dead
  if (desktopDisposition === 'bridge_offline') return safeReason(`The desktop bridge is offline — ${surface} is unavailable.`);
  if (desktopDisposition === 'not_installed') return safeReason(`${appName} is not installed — ${surface} is unavailable.`);
  if (desktopDisposition === 'a11y_degraded') return safeReason(`${appName}'s accessibility tree is unreadable — ${surface} is unavailable.`);
  return safeReason(`${surface} is unavailable.`);
}

function buildPrecondition(
  kind: LiveSurfacePreconditionKind,
  surface: ExecutionSurface | null,
  appName: string,
  governingAction: string | null,
): LiveSurfacePrecondition {
  const chatCanFix =
    kind === 'launch_app' || kind === 'focus_app'
      ? true
      : kind === 'switch_to_browser'
        ? !!surface && BROWSER_SURFACES.has(surface)
        : false;
  const actionRaw = governingAction && governingAction.trim() ? governingAction : FALLBACK_ACTIONS[kind](appName);
  return { kind, surface: surface ?? null, chatCanFix, action: safeAction(actionRaw) };
}

// ─── Main reconciler ─────────────────────────────────────────────────────────

/**
 * Reconcile the plan's preferred surface order against the live reachability
 * report(s). Never throws — degenerate input yields a well-formed empty result.
 */
export function reconcileLiveSurfaceViability(
  input: LiveSurfaceViabilityInput | null | undefined,
): LiveSurfaceViabilityResult {
  const raw = input && typeof input === 'object' ? (input as unknown as Record<string, unknown>) : {};
  // TOTAL contract: the reads of preferredSurfaceOrder / reachability — and the
  // normalize passes that consume them — are the ONLY throw sources in this
  // reconciler (everything after runs on normalized plain values through guarded
  // sanitizers). A hostile input (a throwing accessor, a throwing Proxy, or an
  // array whose element/length getter throws) must NOT propagate: degrade each
  // read independently to empty so the normal degenerate path yields a
  // well-formed result instead of re-throwing.
  let order: ExecutionSurface[] = [];
  try {
    order = normalizeOrder(raw.preferredSurfaceOrder);
  } catch {
    order = [];
  }
  let reports: SafeReport[] = [];
  try {
    reports = normalizeReports(raw.reachability);
  } catch {
    reports = [];
  }

  // Fold the desktop disposition across governing (non-web) reports, worst-wins,
  // and collect the web reports separately for the mismatch axis.
  let foldedDesktop: DesktopDisposition | null = null;
  let governing: SafeReport | null = null;
  let webReportCount = 0;
  let appName = 'the app';
  for (const report of reports) {
    if (appName === 'the app' && report.resolvedAppName) appName = report.resolvedAppName;
    const disposition = statusToDesktopDisposition(report.status);
    if (disposition === 'web') {
      webReportCount += 1;
      continue;
    }
    if (foldedDesktop === null || DESKTOP_DISPOSITION_SEVERITY[disposition] < DESKTOP_DISPOSITION_SEVERITY[foldedDesktop]) {
      foldedDesktop = disposition;
      governing = report;
    }
  }
  const haveDesktopReport = foldedDesktop !== null;
  const effectiveDesktop: DesktopDisposition = foldedDesktop ?? 'unverified';

  const orderHasDesktop = order.some((surface) => DESKTOP_SURFACES.has(surface));
  const surfaceMismatch = webReportCount > 0 && !haveDesktopReport && orderHasDesktop;

  // Findings (one per normalized surface) + start selection + pruning.
  const findings: LiveSurfaceViabilityFinding[] = [];
  const prunedSurfaces: ExecutionSurface[] = [];
  let startSurface: ExecutionSurface | null = null;
  let startStatus: LiveSurfaceViabilityStatus | null = null;
  let desktopViable = false;
  for (const surface of order) {
    const status = classifySurface(surface, effectiveDesktop, surfaceMismatch);
    findings.push({ surface, status, reason: reasonFor(surface, status, effectiveDesktop, appName) });
    if (status === 'dead' || status === 'mismatch') prunedSurfaces.push(surface);
    const startable = status === 'viable' || status === 'unverified' || status === 'precondition';
    if (startable && DESKTOP_SURFACES.has(surface)) desktopViable = true;
    if (startable && startSurface === null) {
      startSurface = surface;
      startStatus = status;
    }
  }

  // Degrade: we start on a lesser desktop surface (vision/bridge) because the
  // accessibility surface was pruned by an a11y block.
  const degraded =
    effectiveDesktop === 'a11y_degraded' &&
    !!startSurface &&
    DESKTOP_SURFACES.has(startSurface) &&
    startSurface !== 'desktop_a11y';
  const degradeNote = degraded
    ? safeNote(`${appName}'s accessibility surface is blocked — starting on ${startSurface} (screenshot/vision) instead of the accessibility surface.`)
    : '';

  // The single precondition to satisfy before the chosen start surface runs.
  const governingAction = governing?.userAction ?? null;
  let startPrecondition: LiveSurfacePrecondition | null = null;
  if (startSurface !== null) {
    if (startStatus === 'precondition') {
      startPrecondition = buildPrecondition(dispositionToPreconditionKind(effectiveDesktop), startSurface, appName, governingAction);
    } else if (surfaceMismatch && BROWSER_SURFACES.has(startSurface)) {
      startPrecondition = buildPrecondition('switch_to_browser', startSurface, appName, null);
    }
    // else: viable/unverified start (incl. the vision degrade) → no precondition.
  } else if (surfaceMismatch) {
    startPrecondition = buildPrecondition('switch_to_browser', null, appName, null);
  } else if (haveDesktopReport) {
    const kind = deadDispositionToPreconditionKind(effectiveDesktop);
    if (kind) startPrecondition = buildPrecondition(kind, null, appName, governingAction);
  }

  const startChatCanFix = startPrecondition ? startPrecondition.chatCanFix : false;

  // userAction: only when the user actually has to do something. A
  // switch_to_browser reroute is automatic (or blocked by a missing browser
  // surface) → no OS-level user action; the surfaceMismatch flag drives that.
  const userAction =
    startPrecondition && startPrecondition.kind !== 'switch_to_browser' ? startPrecondition.action : null;

  const disposition: LiveSurfaceDisposition = surfaceMismatch
    ? 'web_mismatch'
    : haveDesktopReport
      ? (effectiveDesktop as LiveSurfaceDisposition)
      : 'no_desktop_reports';

  const result: LiveSurfaceViabilityResult = {
    appName,
    reportCount: reports.length,
    disposition,
    startSurface,
    startPrecondition,
    startChatCanFix,
    degraded,
    degradeNote,
    surfaceMismatch,
    desktopViable,
    userAction,
    findings,
    prunedSurfaces,
    summary: '',
  };
  result.summary = summarizeLiveSurfaceViability(result);
  return result;
}

// ─── Telemetry summary ───────────────────────────────────────────────────────

/**
 * Compact ≤{@link MAX_SUMMARY_CHARS}-char structural line for the route-decision
 * telemetry/handoff summary. Total on any input (never throws).
 */
export function summarizeLiveSurfaceViability(result: LiveSurfaceViabilityResult | null | undefined): string {
  const r = result && typeof result === 'object' ? result : ({} as Partial<LiveSurfaceViabilityResult>);
  const app = safeName(r.appName, 'the app');
  const start = typeof r.startSurface === 'string' && r.startSurface ? r.startSurface : 'none';
  const disp = typeof r.disposition === 'string' && r.disposition ? r.disposition : 'no_desktop_reports';
  const pre = r.startPrecondition && typeof r.startPrecondition === 'object' && typeof r.startPrecondition.kind === 'string'
    ? r.startPrecondition.kind
    : 'none';
  const findings = Array.isArray(r.findings) ? r.findings.length : 0;
  const pruned = Array.isArray(r.prunedSurfaces) ? r.prunedSurfaces.length : 0;
  const line = `live-surface app=${app} start=${start} disp=${disp} pre=${pre} degraded=${r.degraded ? 1 : 0} mismatch=${r.surfaceMismatch ? 1 : 0} desktopViable=${r.desktopViable ? 1 : 0} pruned=${pruned}/${findings}`;
  return clampText(baseSanitize(line), MAX_SUMMARY_CHARS);
}
