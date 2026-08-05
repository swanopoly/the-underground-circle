/**
 * computerTaskAutoStart — WI-1 pure decision for zero-tap browser auto-start.
 *
 * The permission dialog (`setShowComputerUsePermission(true)`) at the
 * `browser_runtime` branch of `executeSharedComputerTask` currently fires
 * UNCONDITIONALLY (ChatTab.tsx ~3204-3216), so every browser run — even a
 * pure read/extract — costs the user one tap before anything moves. The
 * zero-friction spec (§2 gate #1) removes that tap for browser-runtime tasks
 * that carry no user "ask me first" constraint and no active always-confirm
 * floor, while KEEPING the dialog for:
 *
 *   - desktop / local-bridge mutations (route kind desktop_app / local_file /
 *     hybrid, or a non-`browser_runtime` entrypoint),
 *   - WordPress / website-admin credentialed browser flows (they keep their
 *     checkpoint — the login/credential floor is untouched),
 *   - any user constraint that demands pre-approval (`approvalBefore`
 *     categories) or forbids a category outright, or a stop-condition.
 *
 * CRITICAL — this decides ONLY the START tap, never the pay floor. A browser
 * route may legitimately carry a stamped `alwaysConfirmFloor` (e.g. a "buy X"
 * phrasing) and STILL auto-start: the pay/purchase/checkout confirmation is a
 * MID-RUN gate enforced per-step at the payment submission, not at launch.
 * Auto-start being true here does not weaken that floor — the edge loop's
 * single pay confirmation (WI-3 / WI-7) still fires. The one case where a
 * stamped floor DOES keep the dialog is when the user explicitly asked to be
 * consulted before that category via `approvalBefore` (handled below).
 *
 * This module is dependency-light (`import type` only) so it is tsx-smoke
 * testable; ChatTab consumes the exported `decideBrowserAutoStart` at the
 * call site and reads back `autoStart` to branch the dialog vs. inline-run.
 */

import type {
  ChatComputerRequestRouteKind,
  ChatComputerConstraintCategory,
  ChatComputerUserConstraints,
} from './chatComputerRequestRouter';

/**
 * Minimal, ChatTab-populatable input. Every field is derivable at the
 * `browser_runtime` outcome branch from the resolved route
 * (`ChatComputerRequestRoute`) and the execution envelope
 * (`ComputerTaskExecutionEnvelope`).
 */
export interface BrowserAutoStartInput {
  /** `route.kind`. Only `'browser'` is eligible for auto-start. */
  routeKind: ChatComputerRequestRouteKind;
  /**
   * `envelope.entrypoint`. Must be `'browser_runtime'`. `'agent_runtime'`
   * (desktop/local/hybrid dispatch) always keeps the dialog.
   */
  entrypoint: 'browser_runtime' | 'agent_runtime';
  /**
   * `route.alwaysConfirmFloor` (may be undefined on routes persisted before
   * the floor field existed). A non-empty floor does NOT by itself block
   * auto-start — the floor is enforced mid-run at the pay step. It only
   * blocks the START tap when combined with a user `approvalBefore` for a
   * floor category (see below).
   */
  alwaysConfirmFloor?: ChatComputerConstraintCategory[] | null;
  /**
   * `route.userConstraints`. Any `approvalBefore` / `forbidden` category or
   * `stopConditions` entry keeps the dialog (the user asked to be consulted
   * up front, so we do not silently auto-start).
   */
  userConstraints?: ChatComputerUserConstraints | null;
  /**
   * True when this is a WordPress / website-admin credentialed browser route
   * (route kind resolves to `website_platform_admin`, i.e. the selected
   * pipeline / strategy is `credentialed_browser` or
   * `approval_sensitive_browser`). These keep their approval checkpoint.
   * Derive in ChatTab from the route's selectedPipeline / appStrategy.
   */
  websitePlatformAdmin?: boolean | null;
}

export interface BrowserAutoStartDecision {
  /** True → skip the dialog and run inline; false → keep the dialog. */
  autoStart: boolean;
  /** Machine-stable reason token, safe for logs/metadata (no secrets). */
  reason: string;
}

const D = (autoStart: boolean, reason: string): BrowserAutoStartDecision => ({ autoStart, reason });

/**
 * Pure zero-tap auto-start decision. Fails closed: any signal that is not a
 * clean browser-runtime read/extract keeps the permission dialog.
 */
export function decideBrowserAutoStart(input: BrowserAutoStartInput): BrowserAutoStartDecision {
  // 1. Only browser routes auto-start.
  if (input.routeKind !== 'browser') {
    return D(false, `keep_dialog:route_kind_${input.routeKind}`);
  }

  // 2. Only the browser-runtime entrypoint. Desktop/local/hybrid dispatch
  //    (agent_runtime) keeps the dialog even if the route kind said browser.
  if (input.entrypoint !== 'browser_runtime') {
    return D(false, `keep_dialog:entrypoint_${input.entrypoint}`);
  }

  // 3. WordPress / website-admin credentialed flows keep their checkpoint.
  if (input.websitePlatformAdmin) {
    return D(false, 'keep_dialog:website_platform_admin');
  }

  const constraints = input.userConstraints;
  if (constraints) {
    // 4. User forbade a category outright — never silently auto-start.
    if (constraints.forbidden.length > 0) {
      return D(false, `keep_dialog:user_forbidden_${constraints.forbidden.join('+')}`);
    }
    // 5. User asked to be consulted before a category ("ask me before ...").
    if (constraints.approvalBefore.length > 0) {
      return D(false, `keep_dialog:user_approval_before_${constraints.approvalBefore.join('+')}`);
    }
    // 6. User set a stop-condition ("stop if it needs my password").
    if (constraints.stopConditions.length > 0) {
      return D(false, 'keep_dialog:user_stop_condition');
    }
  }

  // 7. Clean browser-runtime task. Auto-start regardless of a stamped
  //    always-confirm floor — the floor (pay/purchase/checkout) is enforced
  //    MID-RUN at the payment step, not at the start tap.
  const floor = input.alwaysConfirmFloor ?? [];
  if (floor.length > 0) {
    return D(true, `auto_start:browser_runtime:floor_deferred_${floor.join('+')}`);
  }
  return D(true, 'auto_start:browser_runtime');
}
