/**
 * appScreenNextStep — pure "examine the app screen, decide what to do
 * next" advisor for desktop-app automation.
 *
 * Pairs with the bridge's one-round-trip observation endpoint
 * (`/desktop/observe_app`, client `observeApp` in src/lib/desktopBridge.ts):
 * the caller observes once, flattens the tree with `snapshotA11ySummary`
 * (src/lib/a11yTreeDiff.ts), optionally classifies a before/after diff
 * with `classifyA11yDiffOutcome`, then asks this module for the
 * assessment + next step. DETERMINISTIC by contract — a fixed priority
 * ladder, no model call, no I/O — so the same observation always yields
 * the same advice and the smoke test can pin every branch.
 *
 * Priority ladder (lower number wins — smoke-pinned):
 *   1. app not running          → launch_app (chat can launch after approval)
 *   2. running, not frontmost   → focus_app
 *   3. dialog/sheet/alert nodes → handle_dialog; destructive/save wording
 *      → confirm_with_user + approvals.request (NEVER auto-dismiss)
 *   4. mutation + no_change     → reobserve once; with an empty view
 *      (0 windows or empty summary) → escalate_to_screenshot
 *   5. empty a11y summary       → escalate_to_screenshot (possible TCC gap)
 *   6. zero windows             → proceed, but open the target document first
 *   7. otherwise                → proceed
 *
 * Dependency-light by contract (MEMORY: smoke-tests-need-pure-modules):
 * type-only imports ONLY — scripts/app-screen-next-step-smoketest.ts
 * executes this module under tsx.
 *
 * SECURITY: dialog labels and window titles are app/page-controlled
 * UNTRUSTED text (same channel as the fence note on
 * `describeA11yDiffForModel` in src/lib/a11yTreeDiff.ts). `dialogLabels`
 * is returned RAW — callers MUST fence each label before rendering it
 * into model-visible output. `describeAppScreenNextStepForModel` routes
 * every dialog-label fragment through its injectable `fence`.
 * `assessment`, `hint`, and `blockers` stay structural — our own fixed
 * wording plus charset-sanitized app names — so they remain trustworthy
 * outside the fence, and window titles / dialog labels are never
 * embedded in them.
 */

import type { A11ySummaryNode } from './a11yTreeDiff';

// ─── Public shapes ───────────────────────────────────────────────────

export interface AppScreenObservationInput {
  /** Target app (task-side identity, not observed content). */
  appName: string;
  /** What the task is trying to do next (referenced by proceed hints). */
  taskHint?: string | null;
  appRunning: boolean;
  frontmost: boolean;
  frontmostApp?: string | null;
  windowCount?: number | null;
  windowTitles?: string[] | null;
  /** Flattened tree from snapshotA11ySummary(observeApp(...).tree). */
  a11ySummary?: A11ySummaryNode[] | null;
  /** classifyA11yDiffOutcome result for the last before/after diff. */
  diffOutcome?: 'state_changed' | 'no_change' | 'target_appeared' | 'target_disappeared' | null;
  lastActionKind?: 'mutation' | 'navigation' | 'observation' | null;
}

export type AppScreenNextStepKind =
  | 'launch_app'
  | 'focus_app'
  | 'handle_dialog'
  | 'confirm_with_user'
  | 'proceed'
  | 'reobserve'
  | 'escalate_to_screenshot'
  | 'stop_and_report';

/** Real registered tool names only (src/lib/openswanToolRuntime.ts). */
export type AppScreenNextStepTool =
  | 'desktop.launch_app'
  | 'desktop.focus_app'
  | 'desktop.read_a11y_tree'
  | 'desktop.screenshot'
  | 'approvals.request';

export interface AppScreenNextStep {
  kind: AppScreenNextStepKind;
  /** One of {@link AppScreenNextStepTool} or null when no tool applies. */
  tool: string | null;
  /** ≤{@link APP_SCREEN_HINT_MAX_CHARS} chars, structural wording. */
  hint: string;
}

export interface AppScreenNextStepResult {
  /** 1-2 plain sentences of structural state (no untrusted labels). */
  assessment: string;
  nextStep: AppScreenNextStep;
  /** ≤{@link APP_SCREEN_MAX_DIALOG_LABELS} labels, each
   *  ≤{@link APP_SCREEN_DIALOG_LABEL_MAX_CHARS} chars. RAW app-controlled
   *  text — the caller MUST fence before model-visible use. */
  dialogLabels: string[];
  blockers: string[];
}

// ─── Bounds ──────────────────────────────────────────────────────────

export const APP_SCREEN_MAX_DIALOG_LABELS = 4;
export const APP_SCREEN_DIALOG_LABEL_MAX_CHARS = 80;
export const APP_SCREEN_HINT_MAX_CHARS = 200;
export const APP_SCREEN_ASSESSMENT_MAX_CHARS = 240;
export const APP_SCREEN_DESCRIBE_MAX_CHARS = 500;
const MAX_BLOCKERS = 4;
const BLOCKER_MAX_CHARS = 160;
const SAFE_NAME_MAX_CHARS = 60;

// ─── Helpers (self-contained, never throw) ───────────────────────────

function collapseWhitespace(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1))}…`;
}

/**
 * App names appear inside assessment/hint text OUTSIDE the untrusted
 * fence, so they are charset-stripped to [A-Za-z0-9 ._()-] and bounded —
 * same posture as `displayRole` in src/lib/a11yTreeDiff.ts (structural
 * tokens must stay trustworthy).
 */
function safeAppName(raw: unknown, fallback = 'the app'): string {
  const cleaned = collapseWhitespace(raw)
    .replace(/[^A-Za-z0-9 ._()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAFE_NAME_MAX_CHARS)
    .trim();
  return cleaned || fallback;
}

/** 'AXDialog' / ' dialog ' / 'Sheet' → 'dialog' / 'dialog' / 'sheet'. */
function normalizeRole(raw: unknown): string {
  return collapseWhitespace(raw).toLowerCase().replace(/^ax/, '');
}

const DIALOG_ROLES = new Set(['dialog', 'sheet', 'alert']);

/**
 * Save/destructive wording that must NEVER be auto-dismissed. Matches
 * plain 'Save' too by design: any dialog offering a save-shaped choice
 * needs the user's decision.
 */
const DESTRUCTIVE_DIALOG_LABEL_RE = /save|don.?t save|overwrite|replace|delete|discard/i;

interface DialogScan {
  /** Number of dialog/sheet/alert nodes in the summary. */
  count: number;
  /** Bounded output labels (≤4 × ≤80 chars), RAW. */
  labels: string[];
  /** Destructive wording anywhere in the dialog labels (checked PRE-cap
   *  so a destructive button never escapes by being the 5th label). */
  destructive: boolean;
}

/**
 * Dialog/sheet/alert detection over a flat snapshot. Labels come from
 * the dialog nodes themselves AND from nodes inside them (key-prefix
 * descendants) — macOS save sheets usually carry the "Don't Save"/"Save"
 * wording on their buttons, not on the sheet node.
 */
function scanDialogs(summary: readonly A11ySummaryNode[] | null): DialogScan {
  const list = Array.isArray(summary) ? summary : [];
  const dialogKeys: string[] = [];
  let count = 0;
  for (const node of list) {
    if (!node || typeof node !== 'object') continue;
    if (!DIALOG_ROLES.has(normalizeRole(node.role))) continue;
    count += 1;
    if (typeof node.key === 'string' && node.key) dialogKeys.push(node.key);
  }
  if (count === 0) return { count: 0, labels: [], destructive: false };

  const allLabels: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown): void => {
    const label = collapseWhitespace(raw).slice(0, APP_SCREEN_DIALOG_LABEL_MAX_CHARS);
    if (!label) return;
    const dedupeKey = label.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    allLabels.push(label);
  };
  // Dialog nodes' own labels first (document order), then descendants.
  for (const node of list) {
    if (!node || typeof node !== 'object') continue;
    if (DIALOG_ROLES.has(normalizeRole(node.role))) push(node.label);
  }
  for (const node of list) {
    if (!node || typeof node !== 'object' || typeof node.key !== 'string') continue;
    if (DIALOG_ROLES.has(normalizeRole(node.role))) continue;
    if (dialogKeys.some((key) => node.key.startsWith(`${key}/`))) push(node.label);
  }
  return {
    count,
    labels: allLabels.slice(0, APP_SCREEN_MAX_DIALOG_LABELS),
    destructive: allLabels.some((label) => DESTRUCTIVE_DIALOG_LABEL_RE.test(label)),
  };
}

// ─── buildAppScreenNextStep ──────────────────────────────────────────

/**
 * Turn one app-screen observation into a deterministic assessment +
 * next step. Never throws: degenerate input degrades to
 * `stop_and_report`. See the module header for the priority ladder.
 */
export function buildAppScreenNextStep(input: AppScreenObservationInput): AppScreenNextStepResult {
  const obs: AppScreenObservationInput | null =
    input && typeof input === 'object' ? input : null;

  const hasName = collapseWhitespace(obs?.appName).length > 0;
  const name = safeAppName(obs?.appName);
  const appRunning = obs?.appRunning === true;
  const frontmost = obs?.frontmost === true;
  const frontName = safeAppName(obs?.frontmostApp, '');
  const windowCount =
    typeof obs?.windowCount === 'number' && Number.isFinite(obs.windowCount)
      ? Math.max(0, Math.floor(obs.windowCount))
      : null;
  const summary = Array.isArray(obs?.a11ySummary)
    ? (obs!.a11ySummary as A11ySummaryNode[]).filter(
        (node): node is A11ySummaryNode => !!node && typeof node === 'object',
      )
    : null;
  const summaryEmpty = !summary || summary.length === 0;
  const taskHint = collapseWhitespace(obs?.taskHint);

  const finish = (
    kind: AppScreenNextStepKind,
    tool: string | null,
    hint: string,
    assessment: string,
    dialogLabels: string[] = [],
    blockers: string[] = [],
  ): AppScreenNextStepResult => ({
    assessment: clampText(assessment, APP_SCREEN_ASSESSMENT_MAX_CHARS),
    nextStep: { kind, tool, hint: clampText(hint, APP_SCREEN_HINT_MAX_CHARS) },
    dialogLabels: dialogLabels.slice(0, APP_SCREEN_MAX_DIALOG_LABELS),
    blockers: blockers.slice(0, MAX_BLOCKERS).map((b) => clampText(b, BLOCKER_MAX_CHARS)),
  });

  // 0. Degenerate: no observation object, or nothing to act on (an
  // unnamed app that is not running cannot be launched or focused).
  if (!obs || (!hasName && !appRunning)) {
    return finish(
      'stop_and_report',
      null,
      'Observation lacks a usable app identity — re-observe with an app name before deciding a step.',
      'No usable app observation was provided.',
      [],
      ['Observation missing app identity — cannot advise a concrete step.'],
    );
  }

  // 1. Not running → launch (approval-gated on the chat side).
  if (!appRunning) {
    return finish(
      'launch_app',
      'desktop.launch_app',
      `${name} is not running — chat can launch it after approval.`,
      `${name} is not running${frontName ? ` (frontmost app: ${frontName})` : ''}.`,
    );
  }

  // 2. Running but another app is in front.
  if (!frontmost) {
    return finish(
      'focus_app',
      'desktop.focus_app',
      `Bring ${name} to the front before reading or acting on its UI.`,
      `${name} is running but not frontmost${frontName ? ` — ${frontName} is in front` : ''}.`,
    );
  }

  // 3. Dialog / sheet / alert open — handle it before the main task.
  const dialogs = scanDialogs(summary);
  if (dialogs.count > 0) {
    if (dialogs.destructive) {
      return finish(
        'confirm_with_user',
        'approvals.request',
        'A save/destructive dialog is open — ask the user which choice to make; never auto-dismiss it.',
        `${name} is frontmost with a save/destructive dialog open that needs a user decision.`,
        dialogs.labels,
        ['A destructive/save dialog is open — needs your decision'],
      );
    }
    return finish(
      'handle_dialog',
      'desktop.read_a11y_tree',
      'A dialog is open — read its controls with a targeted a11y slice, then complete or dismiss it before continuing.',
      `${name} is frontmost with ${dialogs.count === 1 ? 'a dialog/sheet' : `${dialogs.count} dialog/sheet nodes`} open.`,
      dialogs.labels,
    );
  }

  // 4. A mutation reported no observable change.
  if (obs.lastActionKind === 'mutation' && obs.diffOutcome === 'no_change') {
    if (windowCount === 0 || summaryEmpty) {
      return finish(
        'escalate_to_screenshot',
        'desktop.screenshot',
        'The mutation changed nothing and the a11y view is empty — take a screenshot to see the real screen state.',
        `${name} shows no a11y change after the last mutation and the observed view is empty.`,
      );
    }
    return finish(
      'reobserve',
      'desktop.read_a11y_tree',
      'The last mutation produced no visible a11y change — re-read the tree once before retrying or escalating.',
      `${name} is frontmost but the last mutation produced no visible change.`,
    );
  }

  // 5. Frontmost + running but the a11y view is empty → vision fallback.
  if (summaryEmpty) {
    return finish(
      'escalate_to_screenshot',
      'desktop.screenshot',
      `The a11y tree for ${name} is empty — fall back to a screenshot to observe it.`,
      `${name} is running and frontmost but its accessibility tree came back empty.`,
      [],
      ['Empty a11y tree — the bridge helper may be missing macOS Accessibility (TCC) permission.'],
    );
  }

  // 6. No document/window open yet.
  if (windowCount === 0) {
    return finish(
      'proceed',
      null,
      `${name} has no open windows — open the target document first.`,
      `${name} is running and frontmost but has no open windows.`,
    );
  }

  // 7. Screen looks ready.
  return finish(
    'proceed',
    null,
    taskHint
      ? `Screen state looks ready — continue with: ${taskHint}`
      : 'Screen state looks ready — continue with the next planned action.',
    `${name} is frontmost with ${
      windowCount === null ? 'its windows' : `${windowCount} window${windowCount === 1 ? '' : 's'}`
    } visible and no dialogs.`,
  );
}

// ─── describeAppScreenNextStepForModel ───────────────────────────────

/**
 * Compact ≤{@link APP_SCREEN_DESCRIBE_MAX_CHARS}-char one-liner for the
 * tool loop, e.g.
 * `Pages is frontmost with a save/destructive dialog open… | next:
 * confirm_with_user via approvals.request — … | dialogs: 'Don't Save',
 * 'Cancel' | blockers: A destructive/save dialog is open…`.
 *
 * `fence` is the UNTRUSTED-CONTENT FENCE — every dialog-label fragment
 * (app/page-controlled text; window titles would need the same
 * treatment if a caller ever adds them) passes through it. Defaults to
 * identity — callers building MODEL-VISIBLE text MUST pass the
 * runtime's fencing helper (`fenceUntrustedObservationText` in
 * src/lib/openswanToolRuntime.ts) or an equivalent, same convention as
 * `describeA11yDiffForModel` in src/lib/a11yTreeDiff.ts. Structural
 * fragments (assessment, next-step kind/tool/hint, blockers — our own
 * wording) stay outside the fence by design. Assembly is atomic per
 * fragment, so an expanding fence is never cut mid-tag and the char
 * budget always holds.
 */
export function describeAppScreenNextStepForModel(
  result: AppScreenNextStepResult | null | undefined,
  fence?: (fragment: string) => string,
): string {
  if (!result || typeof result !== 'object' || !result.nextStep || typeof result.nextStep !== 'object') {
    return 'no app screen assessment available';
  }
  const wrap = typeof fence === 'function' ? fence : (s: string) => s;
  const maxChars = APP_SCREEN_DESCRIBE_MAX_CHARS;
  const ELLIPSIS = ' …';

  const parts: string[] = [];
  let used = 0;
  let exhausted = false;
  const tryPush = (fragment: string): boolean => {
    if (used + fragment.length > maxChars - ELLIPSIS.length) {
      exhausted = true;
      return false;
    }
    parts.push(fragment);
    used += fragment.length;
    return true;
  };

  tryPush(clampText(collapseWhitespace(result.assessment), APP_SCREEN_ASSESSMENT_MAX_CHARS));
  const kind = collapseWhitespace(result.nextStep.kind) || 'proceed';
  const tool = typeof result.nextStep.tool === 'string' && result.nextStep.tool ? ` via ${result.nextStep.tool}` : '';
  tryPush(` | next: ${kind}${tool} — ${clampText(collapseWhitespace(result.nextStep.hint), APP_SCREEN_HINT_MAX_CHARS)}`);

  const labels = (Array.isArray(result.dialogLabels) ? result.dialogLabels : [])
    .map((label) => collapseWhitespace(label).slice(0, APP_SCREEN_DIALOG_LABEL_MAX_CHARS))
    .filter(Boolean)
    .slice(0, APP_SCREEN_MAX_DIALOG_LABELS);
  for (let i = 0; i < labels.length; i += 1) {
    const fenced = `'${wrap(labels[i])}'`;
    if (!tryPush(i === 0 ? ` | dialogs: ${fenced}` : `, ${fenced}`)) break;
  }

  const blockers = (Array.isArray(result.blockers) ? result.blockers : [])
    .map((blocker) => clampText(collapseWhitespace(blocker), BLOCKER_MAX_CHARS))
    .filter(Boolean)
    .slice(0, MAX_BLOCKERS);
  for (let i = 0; i < blockers.length; i += 1) {
    if (!tryPush(i === 0 ? ` | blockers: ${blockers[i]}` : `; ${blockers[i]}`)) break;
  }

  if (exhausted) parts.push(ELLIPSIS);
  return parts.join('');
}
