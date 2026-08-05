/**
 * computerTaskActivation — P58: the consolidated "activate what it needs"
 * contract for computer tasks.
 *
 * The pieces already existed but were scattered: preflight WARNS about a
 * dead bridge, the complexity plan HINTS at opening the chosen app, grants
 * list what's outstanding, and the reachability ladder exists as a tool —
 * yet the run itself discovered missing prerequisites through mid-loop
 * failures. This module derives ONE ordered activation sequence from the
 * route facts and injects it at the head of the task (via the execution
 * envelope's dispatchPrefix, which BOTH lanes consume — the app/file/hybrid
 * agent prompt and the browser planner's planningContext).
 *
 * The sequence is instructions for the agent to execute WITH ITS EXISTING
 * TOOLS under the existing gates — activation never bypasses approvals; it
 * front-loads the checks so failures happen in step 1 with a clear message
 * instead of round 7 with a confusing one.
 *
 * Order (fixed): bridge → grants → app/session → target → observe.
 *
 * Pure: type-only imports, bounded, never throws. Owned by
 * prepareComputerTaskExecution (the envelope builder).
 */

import type { ComputerTaskKind } from './computerTaskPlanner';

export type ComputerTaskActivationStepKind =
  | 'verify_bridge'
  | 'resolve_grants'
  | 'launch_or_focus_app'
  | 'open_browser_target'
  | 'verify_target_open'
  | 'observe_before_act';

export interface ComputerTaskActivationStep {
  order: number;
  kind: ComputerTaskActivationStepKind;
  /** One imperative line the agent can act on with existing tools. */
  instruction: string;
  /** True when later steps are pointless if this one fails (stop + report). */
  blocking: boolean;
}

export interface ComputerTaskActivationPlan {
  steps: ComputerTaskActivationStep[];
  /** One-line summary for cards/telemetry. */
  summary: string;
}

export interface ComputerTaskActivationInput {
  kind: ComputerTaskKind;
  /** Resolved best-app choice, when the route picked one. */
  appResolution?: {
    displayName: string;
    openVia?: 'desktop_launch' | 'url_scheme' | 'browser_url';
    openTarget?: string;
    availability?: 'installed' | 'maybe' | 'web';
  } | null;
  /** Outstanding (not-yet-approved) grant labels. */
  outstandingGrantLabels?: ReadonlyArray<string> | null;
  /** Preflight blockers already detected (label + fix). */
  preflightBlockerLabels?: ReadonlyArray<string> | null;
}

const MAX_STEP_CHARS = 260;
const MAX_LIST_ITEMS = 4;

function clip(text: string): string {
  return text.length > MAX_STEP_CHARS ? `${text.slice(0, MAX_STEP_CHARS - 1)}…` : text;
}

function boundedList(items: ReadonlyArray<string> | null | undefined): string[] {
  return (items ?? []).map((item) => String(item).trim()).filter(Boolean).slice(0, MAX_LIST_ITEMS);
}

/**
 * Derive the ordered activation sequence for a routed computer task.
 * `unknown` kind gets the minimal safe pair (bridge check + observe) — the
 * loop's own routing will refine from there.
 */
export function buildComputerTaskActivationPlan(
  input: ComputerTaskActivationInput,
): ComputerTaskActivationPlan {
  const steps: ComputerTaskActivationStep[] = [];
  const kind = input?.kind || 'unknown';
  const isBrowser = kind === 'browser_task';
  const usesDesktop = kind === 'app_task' || kind === 'file_task' || kind === 'hybrid_task' || kind === 'unknown';
  let order = 1;

  if (usesDesktop) {
    steps.push({
      order: order++,
      kind: 'verify_bridge',
      blocking: true,
      instruction: clip(
        'Confirm the desktop bridge responds (a cheap read like desktop.list_running_apps or desktop.app_reachability). If it does not respond, STOP and tell the user to start the local bridge — nothing after this can work.',
      ),
    });
  }

  const grants = boundedList(input?.outstandingGrantLabels);
  if (grants.length > 0) {
    steps.push({
      order: order++,
      kind: 'resolve_grants',
      blocking: true,
      instruction: clip(
        `Outstanding grant(s) must be approved before any mutation: ${grants.join('; ')}. Reads/observation may proceed; stop before the first mutating step if still unapproved.`,
      ),
    });
  }

  const app = input?.appResolution;
  if (app && app.displayName && !isBrowser) {
    const via = app.openVia === 'browser_url' || app.openVia === 'url_scheme'
      ? `open its target (${clip(String(app.openTarget || 'the app URL'))}) via desktop.open_url`
      : 'launch it via desktop.launch_app (or focus it if already running)';
    const availabilityTail = app.availability === 'maybe'
      ? ' If launch fails because it is not installed, report that and fall back per the route instead of retrying.'
      : '';
    steps.push({
      order: order++,
      kind: 'launch_or_focus_app',
      blocking: true,
      instruction: clip(
        `Ensure ${app.displayName} is running and frontmost: ${via}, then verify it is frontmost before any in-app action.${availabilityTail}`,
      ),
    });
  }

  if (isBrowser) {
    steps.push({
      order: order++,
      kind: 'open_browser_target',
      blocking: true,
      instruction: clip(
        'Navigate to the exact site/page the task names before acting; if login is required use vault credentials (never ask the user to paste secrets), and stop for the user at CAPTCHA/MFA.',
      ),
    });
  } else if (kind === 'file_task' || kind === 'hybrid_task' || (app && app.displayName)) {
    steps.push({
      order: order++,
      kind: 'verify_target_open',
      blocking: true,
      instruction: clip(
        'Verify the exact target named in the task (document/file/project) is open and is the ACTIVE one before editing — never edit whatever happens to be frontmost.',
      ),
    });
  }

  steps.push({
    order: order++,
    kind: 'observe_before_act',
    blocking: false,
    instruction: clip(
      isBrowser
        ? 'Take one fresh observation of the page (DOM snapshot/observe) before the first action, and re-observe after any navigation.'
        : 'Take one fresh observation (a11y tree / document status / screenshot per the surface ladder) before the first action — never act on remembered state.',
    ),
  });

  const blockers = boundedList(input?.preflightBlockerLabels);
  const summary = blockers.length > 0
    ? `Activation: ${steps.length} step(s); preflight already flags ${blockers.join('; ')}`
    : `Activation: ${steps.length} step(s) before the task`;

  return { steps, summary: clip(summary) };
}

/**
 * Prompt block appended to the execution envelope's dispatchPrefix. Bounded;
 * imperative; explicitly subordinate to the existing gates.
 */
export function formatComputerTaskActivationBlock(plan: ComputerTaskActivationPlan | null | undefined): string {
  if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return '';
  return [
    '## Activation sequence (do these IN ORDER before the task itself)',
    ...plan.steps.map((step) => `${step.order}. ${step.instruction}${step.blocking ? '' : ' (non-blocking)'}`),
    'A blocking step that fails means STOP and report — do not attempt the task around it. All approval gates and constraints apply to every step above.',
  ].join('\n');
}
