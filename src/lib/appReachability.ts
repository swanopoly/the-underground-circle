/**
 * appReachability — LIVE app-reachability classifier: "can chat actually reach
 * and automate app X on this machine right now?"
 *
 * Complements (does NOT replace) the static planner in computerAppPreflight.ts:
 * preflight reasons about capabilities/strategies/route decisions before
 * anything runs, while this module classifies injected LIVE probe results
 * (bridge /desktop/health, install/running/window probes, an a11y read) into
 * one status plus the first blocker and its exact fix. Blocker items follow
 * the same id/label/detail/fix conventions as ComputerAppPreflightItem.
 *
 * Probe vocabulary gotcha: `bridgeToolNames` and `requiredBridgeCommands` are
 * bridge COMMAND names exactly as GET /desktop/health reports them in `tools`
 * (e.g. 'a11y_tree', 'cad_compile', 'photoshop_document_status') — NOT
 * OpenSwan tool names. OpenSwan's `desktop.read_a11y_tree` maps to bridge
 * command 'a11y_tree'. Comparing the live health list against an app's
 * required commands is what detects the real "bridge online but started
 * before the newest endpoints" state (fix: restart with `npm run bridge`).
 *
 * Pure module (zero runtime imports; `import type` only) —
 * smoke: scripts/app-reachability-smoketest.ts
 */

import type { AppAutomationDocEntry } from './appAutomationDocsIndex';

/** Everything is injected — this module never talks to the bridge itself. */
export interface AppReachabilityProbeInputs {
  appName: string;
  bridgeOnline: boolean;
  /** `tools` array from GET /desktop/health (bridge command names). */
  bridgeToolNames?: string[] | null;
  /** Bridge commands this task needs (bridge command names, not OpenSwan tool names). */
  requiredBridgeCommands?: string[] | null;
  /** From resolveAppAutomationDoc — decides web/browser vs desktop routing. */
  appDoc?: AppAutomationDocEntry | null;
  /** From checkAppInstalled. */
  installed?: { installed: boolean; resolvedName?: string | null } | null;
  /** From listRunningApps. */
  runningApps?: string[] | null;
  /** From a window/focus probe. */
  windowState?: { frontmostApp?: string | null; appHasWindow?: boolean | null } | null;
  /** From a live accessibility-tree read of the target app. */
  a11yProbe?: { ok: boolean; nodeCount?: number | null; error?: string | null } | null;
}

export type AppReachabilityStatus =
  | 'reachable'
  | 'needs_launch'
  | 'needs_focus'
  | 'bridge_offline'
  | 'bridge_outdated'
  | 'not_installed'
  | 'a11y_blocked'
  | 'web_app'
  | 'unknown';

export type AppReachabilityCheckOutcome = 'pass' | 'fail' | 'skipped';

export interface AppReachabilityCheck {
  id: string;
  label: string;
  outcome: AppReachabilityCheckOutcome;
  detail: string;
}

/** Same shape conventions as ComputerAppPreflightItem (id/label/detail/fix). */
export interface AppReachabilityBlocker {
  id: string;
  label: string;
  detail: string;
  fix: string;
}

export interface AppReachabilityReport {
  appName: string;
  /** Best-known display name: live install probe > profile doc > raw input. */
  resolvedAppName: string;
  status: AppReachabilityStatus;
  /** Always all rungs, in ladder order; rungs after the first failure are 'skipped'. */
  checks: AppReachabilityCheck[];
  firstBlocker: AppReachabilityBlocker | null;
  /** The one thing the user must do (the first blocker's fix), or null. */
  userAction: string | null;
  /** True only when chat itself can clear the blocker after approval (launch/focus). */
  chatCanFix: boolean;
  docPath?: string;
}

// ── Required bridge commands per app profile ────────────────────────────────

/**
 * Minimal, honest bridge-command requirements for executable/partial app
 * profiles, keyed by appAutomationDocsIndex slug. Values are bridge COMMAND
 * names as listed by GET /desktop/health `tools` (e.g. 'cad_compile'),
 * NOT OpenSwan tool names (`desktop.read_a11y_tree` -> bridge 'a11y_tree').
 * Only the commands the app's primary recipes actually call today.
 */
export const REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG: Partial<Record<string, string[]>> = {
  photoshop: ['photoshop_document_status', 'photoshop_layer_inventory'],
  indesign: ['indesign_document_status'],
  illustrator: ['illustrator_document_status', 'illustrator_text_inventory'],
  freecad: ['cad_compile'],
  openscad: ['cad_compile'],
  blender: ['cad_compile'],
  autocad: ['a11y_tree'],
};

/**
 * Fallback requirement for any desktop app without a profile-specific list
 * (bridge command names from the health list).
 */
export const DEFAULT_REQUIRED_BRIDGE_COMMANDS: string[] = ['a11y_tree', 'screenshot'];

/** Profile-specific required bridge commands, else the desktop default. Returns a copy. */
export function requiredBridgeCommandsForDocSlug(slug: string | null | undefined): string[] {
  if (typeof slug === 'string') {
    const specific = REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG[slug.trim().toLowerCase()];
    if (specific && specific.length > 0) return [...specific];
  }
  return [...DEFAULT_REQUIRED_BRIDGE_COMMANDS];
}

// ── Internal helpers ────────────────────────────────────────────────────────

const CHECK_LABELS: Record<string, string> = {
  route: 'Automation route',
  bridge_online: 'Desktop bridge online',
  bridge_commands: 'Bridge commands current',
  installed: 'App installed',
  running: 'App running',
  frontmost: 'App frontmost',
  a11y: 'Accessibility readable',
};

const BRIDGE_OFFLINE_FIX = 'Start the desktop bridge: npm run bridge';
const BRIDGE_OUTDATED_FIX =
  'The bridge is running an older build — restart it with npm run bridge to pick up the new tools.';
const NEEDS_LAUNCH_FIX =
  'Not running — after your approval, chat can launch it directly (desktop.launch_app) and verify the foreground app.';
const A11Y_BLOCKED_FIX =
  "Grant Accessibility and Automation access to the bridge's host app in System Settings → " +
  'Privacy & Security, then restart the bridge process (npm run bridge) — grants can go stale ' +
  'after macOS updates.';

/** Install hints for apps chat automates through their command-line engines. */
const CLI_ENGINE_INSTALL_HINTS: Partial<Record<string, string>> = {
  freecad: 'Install FreeCAD (free, freecad.org) — chat automates it through its command-line engine once installed.',
  openscad: 'Install OpenSCAD (free, openscad.org) — chat compiles .scad files through its command-line engine once installed.',
  blender: 'Install Blender (free, blender.org) — chat automates it through its command-line engine once installed.',
};

function sanitizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const list: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) list.push(entry.trim());
  }
  return list;
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** Case-insensitive substring match in either direction against any target name. */
function fuzzyNameMatch(candidate: unknown, targets: Array<string | null>): boolean {
  const cand = normalizeName(candidate);
  if (!cand) return false;
  for (const target of targets) {
    const norm = normalizeName(target);
    if (!norm) continue;
    if (cand.includes(norm) || norm.includes(cand)) return true;
  }
  return false;
}

/** "a, b, c (+2 more)" — never dumps more than `max` names. */
function boundedList(values: string[], max = 6): string {
  const shown = values.slice(0, max).join(', ');
  const hidden = values.length - Math.min(values.length, max);
  return hidden > 0 ? `${shown} (+${hidden} more)` : shown;
}

function docString(doc: unknown, field: 'slug' | 'appName' | 'status' | 'docPath'): string {
  if (!doc || typeof doc !== 'object') return '';
  const value = (doc as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}

// ── Classifier ──────────────────────────────────────────────────────────────

/**
 * Classifies live probe results into one reachability status. Ladder order —
 * the first failing rung wins and every later rung becomes 'skipped':
 *   1. route           — web_only/cloud_service profile short-circuits to 'web_app'
 *   2. bridge_online   — 'bridge_offline'
 *   3. bridge_commands — required commands missing from health list → 'bridge_outdated'
 *   4. installed       — 'not_installed'
 *   5. running         — 'needs_launch'  (chat can fix after approval)
 *   6. frontmost       — 'needs_focus'   (chat can fix after approval)
 *   7. a11y            — 'a11y_blocked'
 * Missing/null probe sections (other than bridgeOnline) are 'skipped', never
 * failures. 'unknown' only when the bridge is online but no other probe or
 * profile doc was provided at all. Never throws, even on garbage inputs.
 */
export function buildAppReachabilityReport(inputs: AppReachabilityProbeInputs): AppReachabilityReport {
  const raw = (inputs && typeof inputs === 'object' ? inputs : {}) as Partial<AppReachabilityProbeInputs>;

  const appName = typeof raw.appName === 'string' ? raw.appName.trim() : '';
  const bridgeOnline = raw.bridgeOnline === true;
  const appDoc = raw.appDoc && typeof raw.appDoc === 'object' ? raw.appDoc : null;
  const docSlug = docString(appDoc, 'slug');
  const docName = docString(appDoc, 'appName');
  const docStatus = docString(appDoc, 'status');
  const docPath = docString(appDoc, 'docPath');

  const bridgeTools = sanitizeStringList(raw.bridgeToolNames);
  const requiredCommands = sanitizeStringList(raw.requiredBridgeCommands);

  const installedRaw = raw.installed && typeof raw.installed === 'object' ? raw.installed : null;
  const installedFlag =
    installedRaw === null ? null : installedRaw.installed === true ? true : installedRaw.installed === false ? false : null;
  const resolvedInstallName =
    installedRaw && typeof installedRaw.resolvedName === 'string' && installedRaw.resolvedName.trim()
      ? installedRaw.resolvedName.trim()
      : null;

  const runningApps = sanitizeStringList(raw.runningApps);
  const windowStateRaw = raw.windowState && typeof raw.windowState === 'object' ? raw.windowState : null;
  const frontmostApp =
    windowStateRaw && typeof windowStateRaw.frontmostApp === 'string' && windowStateRaw.frontmostApp.trim()
      ? windowStateRaw.frontmostApp.trim()
      : null;
  const a11yRaw = raw.a11yProbe && typeof raw.a11yProbe === 'object' ? raw.a11yProbe : null;

  const resolvedAppName = resolvedInstallName || docName || appName || 'this app';
  /** Fuzzy-match targets: the caller's app name AND the install probe's resolved name. */
  const matchTargets: Array<string | null> = [appName, resolvedInstallName];

  const checks: AppReachabilityCheck[] = [];
  let firstBlocker: AppReachabilityBlocker | null = null;
  let status: AppReachabilityStatus | null = null;
  let chatCanFix = false;

  const settled = () => status !== null;
  const skipReason = () =>
    status === 'web_app'
      ? 'Skipped — web/browser route; the desktop bridge is not involved.'
      : 'Skipped — blocked by an earlier check.';
  const pass = (id: string, detail: string) =>
    checks.push({ id, label: CHECK_LABELS[id] ?? id, outcome: 'pass', detail });
  const skip = (id: string, detail: string) =>
    checks.push({ id, label: CHECK_LABELS[id] ?? id, outcome: 'skipped', detail });
  const fail = (
    id: string,
    detail: string,
    fix: string,
    failStatus: AppReachabilityStatus,
    canFix = false,
  ) => {
    const label = CHECK_LABELS[id] ?? id;
    checks.push({ id, label, outcome: 'fail', detail });
    firstBlocker = { id, label, detail, fix };
    status = failStatus;
    chatCanFix = canFix;
  };

  // 1. route — web/cloud profiles never touch the desktop bridge at all.
  if (docStatus === 'web_only' || docStatus === 'cloud_service') {
    pass(
      'route',
      `${docName || resolvedAppName} is a ${docStatus === 'web_only' ? 'web' : 'cloud'} app — chat reaches it through the browser pipeline; desktop bridge checks do not apply.`,
    );
    status = 'web_app';
  } else if (appDoc) {
    pass(
      'route',
      `${docName || resolvedAppName} automates through the desktop route${docPath ? ` (profile: ${docPath}, status: ${docStatus || 'unknown'})` : ''}.`,
    );
  } else {
    skip('route', 'No app automation profile matched — assuming a desktop app route.');
  }

  // 2. bridge online
  if (settled()) {
    skip('bridge_online', skipReason());
  } else if (bridgeOnline) {
    pass('bridge_online', 'The local desktop bridge is online.');
  } else {
    fail(
      'bridge_online',
      'The local desktop bridge is not responding, so chat cannot see or control desktop apps.',
      BRIDGE_OFFLINE_FIX,
      'bridge_offline',
    );
  }

  // 3. bridge commands — health `tools` must cover the task's required commands.
  if (settled()) {
    skip('bridge_commands', skipReason());
  } else if (!requiredCommands || !bridgeTools) {
    skip(
      'bridge_commands',
      !requiredCommands
        ? 'No required-command list provided for this task.'
        : 'The health probe did not include the bridge tool list.',
    );
  } else {
    const toolSet = new Set(bridgeTools.map((tool) => tool.toLowerCase()));
    const uniqueRequired = [...new Set(requiredCommands.map((cmd) => cmd.toLowerCase()))];
    const missing = uniqueRequired.filter((cmd) => !toolSet.has(cmd));
    if (uniqueRequired.length === 0) {
      pass('bridge_commands', 'No app-specific bridge commands required.');
    } else if (missing.length === 0) {
      pass(
        'bridge_commands',
        `Bridge supports all ${uniqueRequired.length} required command(s): ${boundedList(uniqueRequired)}.`,
      );
    } else {
      fail(
        'bridge_commands',
        `Bridge is online but missing ${missing.length} required command(s): ${boundedList(missing)} — its running build predates those tools.`,
        BRIDGE_OUTDATED_FIX,
        'bridge_outdated',
      );
    }
  }

  // 4. installed
  if (settled()) {
    skip('installed', skipReason());
  } else if (installedFlag === null) {
    skip('installed', installedRaw ? 'Install probe result was unreadable.' : 'No install probe provided.');
  } else if (installedFlag === false) {
    fail(
      'installed',
      `${resolvedAppName} was not found on this machine.`,
      CLI_ENGINE_INSTALL_HINTS[docSlug] ?? `Install ${resolvedAppName} on this Mac, then ask again.`,
      'not_installed',
    );
  } else {
    pass('installed', `Installed${resolvedInstallName ? ` as "${resolvedInstallName}"` : ''}.`);
  }

  // 5. running — fuzzy match against appName and the install probe's resolved name.
  if (settled()) {
    skip('running', skipReason());
  } else if (!runningApps) {
    skip('running', 'No running-apps probe provided.');
  } else {
    const runningMatch = runningApps.find((app) => fuzzyNameMatch(app, matchTargets)) ?? null;
    if (runningMatch) {
      pass('running', `Running now (matched "${runningMatch}").`);
    } else {
      fail(
        'running',
        `${resolvedAppName} is not among the running apps.`,
        NEEDS_LAUNCH_FIX,
        'needs_launch',
        true,
      );
    }
  }

  // 6. frontmost
  if (settled()) {
    skip('frontmost', skipReason());
  } else if (!frontmostApp) {
    skip(
      'frontmost',
      windowStateRaw ? 'Window probe did not report a frontmost app.' : 'No window/focus probe provided.',
    );
  } else if (fuzzyNameMatch(frontmostApp, matchTargets)) {
    pass(
      'frontmost',
      `Frontmost app is "${frontmostApp}".${windowStateRaw?.appHasWindow === false ? ' No visible window reported yet.' : ''}`,
    );
  } else {
    fail(
      'frontmost',
      `"${frontmostApp}" is in front instead of ${resolvedAppName}.`,
      `Another app is in front — chat can bring ${resolvedAppName} forward (desktop.focus_app) and verify it directly.`,
      'needs_focus',
      true,
    );
  }

  // 7. a11y — a live read that fails or returns an empty tree means macOS TCC
  // permission trouble (grants can silently go stale after OS updates).
  if (settled()) {
    skip('a11y', skipReason());
  } else if (!a11yRaw) {
    skip('a11y', 'No accessibility probe provided.');
  } else if (!a11yRaw.ok || a11yRaw.nodeCount === 0) {
    const errorText =
      typeof a11yRaw.error === 'string' && a11yRaw.error.trim()
        ? ` (${a11yRaw.error.trim()})`
        : a11yRaw.nodeCount === 0
          ? ' (the tree came back with 0 nodes)'
          : '';
    fail(
      'a11y',
      `The bridge could not read ${resolvedAppName}'s accessibility tree${errorText}.`,
      A11Y_BLOCKED_FIX,
      'a11y_blocked',
    );
  } else {
    pass(
      'a11y',
      `Accessibility tree readable${typeof a11yRaw.nodeCount === 'number' ? ` (${a11yRaw.nodeCount} nodes)` : ''}.`,
    );
  }

  // Final status: 'unknown' only when the bridge is up but we learned nothing else.
  if (status === null) {
    const anyProbeProvided =
      raw.bridgeToolNames != null ||
      raw.requiredBridgeCommands != null ||
      raw.appDoc != null ||
      raw.installed != null ||
      raw.runningApps != null ||
      raw.windowState != null ||
      raw.a11yProbe != null;
    status = anyProbeProvided ? 'reachable' : 'unknown';
  }

  // `firstBlocker` is only assigned inside the fail() closure, which TS's flow
  // analysis does not track — without the cast it over-narrows to `null`.
  const blocker = firstBlocker as AppReachabilityBlocker | null;
  return {
    appName,
    resolvedAppName,
    status,
    checks,
    firstBlocker: blocker,
    userAction: blocker ? blocker.fix : null,
    chatCanFix,
    ...(docPath ? { docPath } : {}),
  };
}

// ── Chat copy ───────────────────────────────────────────────────────────────

const STATUS_HEADLINES: Record<AppReachabilityStatus, (name: string) => string> = {
  reachable: (name) => `${name} is reachable — chat can automate it right now.`,
  web_app: (name) => `${name} is a web app — chat reaches it through the browser, no desktop setup needed.`,
  bridge_offline: (name) => `Chat can't reach ${name} yet — the desktop bridge is offline.`,
  bridge_outdated: (name) => `Chat can't fully reach ${name} yet — the desktop bridge is running an older build.`,
  not_installed: (name) => `${name} doesn't appear to be installed on this Mac.`,
  needs_launch: (name) => `${name} is installed but not running yet.`,
  needs_focus: (name) => `${name} is running, but another app is in front.`,
  a11y_blocked: (name) => `${name} is open, but chat can't read its window contents yet.`,
  unknown: (name) => `The desktop bridge is online, but no app checks have run for ${name} yet.`,
};

const CHECK_MARKS: Record<string, string> = { pass: '✓', fail: '✗', skipped: '·' };

const CHECK_SHORT_NAMES: Record<string, string> = {
  route: 'route',
  bridge_online: 'bridge',
  bridge_commands: 'commands',
  installed: 'installed',
  running: 'running',
  frontmost: 'focus',
  a11y: 'a11y',
};

/**
 * Plain-language chat summary, hard-bounded to 600 chars: one status line,
 * one compact ✓/✗/· check line, and the single user action when present.
 * No command dumps; at most one tool name (only when chat itself can fix it).
 */
export function describeAppReachabilityForChat(report: AppReachabilityReport): string {
  const r = (report && typeof report === 'object' ? report : {}) as Partial<AppReachabilityReport>;
  const name =
    typeof r.resolvedAppName === 'string' && r.resolvedAppName.trim() ? r.resolvedAppName.trim() : 'This app';
  const headlineFor =
    typeof r.status === 'string' ? STATUS_HEADLINES[r.status as AppReachabilityStatus] : undefined;
  const rawHeadline =
    typeof headlineFor === 'function' ? headlineFor(name) : `${name}: reachability not determined yet.`;
  const headline = rawHeadline.charAt(0).toUpperCase() + rawHeadline.slice(1);
  const marks = Array.isArray(r.checks)
    ? r.checks
        .filter((check) => check && typeof check === 'object')
        .map((check) => {
          const mark = CHECK_MARKS[String(check.outcome)] ?? '·';
          const shortName = CHECK_SHORT_NAMES[String(check.id)] ?? String(check.id ?? 'check');
          return `${mark} ${shortName}`;
        })
        .join('  ')
    : '';
  const action =
    typeof r.userAction === 'string' && r.userAction.trim() ? `Next step: ${r.userAction.trim()}` : '';
  const text = [headline, marks, action].filter(Boolean).join('\n');
  return text.length <= 600 ? text : `${text.slice(0, 599)}…`;
}
