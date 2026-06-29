/**
 * browserActionVerification — ADVISORY post-action verification planning.
 *
 * Given a browser mutation (click/fill/select/navigate/...), returns the
 * recommended post-state observations the recovery/contract layer and prompt
 * builders should request so the agent confirms an action took effect instead
 * of assuming success.
 *
 * IMPORTANT: this is advisory metadata ONLY. It does NOT call the bridge and
 * is deliberately NOT wired into the mutating dispatchers (clickRole/fillField
 * etc.) — wiring it into live credentialed mutations is a separate,
 * higher-risk change that must re-clear the behavior-contract gate.
 *
 * Dependency-light: type-only imports, no react-native / fetch / supabase, so
 * the smoke harness can load it directly.
 */

export type BrowserActionType =
  | 'click'
  | 'fill'
  | 'select'
  | 'navigate'
  | 'press_key'
  | 'upload'
  | 'check'
  | 'hover'
  | string;

export interface BrowserActionDescriptor {
  type: BrowserActionType;
  target?: string;
  value?: string;
}

export interface PostActionVerificationPlan {
  /** Whether a post-action observation is recommended at all. */
  shouldVerify: boolean;
  /** Human-readable checks to perform after the action. */
  checks: string[];
  /** Evidence/observation tools that satisfy those checks. */
  evidence: string[];
}

/**
 * Plans the recommended post-action verification for a single browser action.
 * Pure — safe to call from prompt builders and the recovery/contract layer.
 */
export function planPostActionVerification(action: BrowserActionDescriptor): PostActionVerificationPlan {
  const type = String(action?.type || '').toLowerCase();
  const target = action?.target ? ` "${String(action.target).slice(0, 80)}"` : '';

  switch (type) {
    case 'fill':
    case 'type': {
      return {
        shouldVerify: true,
        checks: [
          `Confirm field${target} now holds the intended value (value/char-count match).`,
        ],
        evidence: ['browser.dom_snapshot'],
      };
    }
    case 'select': {
      return {
        shouldVerify: true,
        checks: [`Confirm the selected option for${target || ' the control'} matches the requested value.`],
        evidence: ['browser.dom_snapshot'],
      };
    }
    case 'check':
    case 'uncheck': {
      return {
        shouldVerify: true,
        checks: [`Confirm the checkbox/toggle${target} reflects the intended checked state.`],
        evidence: ['browser.dom_snapshot'],
      };
    }
    case 'click': {
      return {
        shouldVerify: true,
        checks: [
          `Confirm the expected state change after clicking${target} (new view, control state, or content).`,
        ],
        evidence: ['browser.dom_snapshot', 'browser.screenshot'],
      };
    }
    case 'press_key': {
      return {
        shouldVerify: true,
        checks: ['Confirm the key press produced the expected page/control change.'],
        evidence: ['browser.dom_snapshot'],
      };
    }
    case 'upload': {
      return {
        shouldVerify: true,
        checks: [`Confirm the file appears attached/listed after the upload${target}.`],
        evidence: ['browser.dom_snapshot', 'browser.screenshot'],
      };
    }
    case 'navigate': {
      return {
        shouldVerify: true,
        checks: ['Confirm the resulting URL and page title match the navigation target.'],
        evidence: ['browser.verification_state', 'browser.dom_snapshot'],
      };
    }
    // Pure observations (hover, scroll) and unknown types don't mutate state.
    case 'hover':
    case 'scroll':
      return { shouldVerify: false, checks: [], evidence: [] };
    default:
      return { shouldVerify: false, checks: [], evidence: [] };
  }
}
