/**
 * chatTransportHandlers — the single "executor handler map" for
 * `dispatchChatAutomationPlan` (Phase CA-1b / C1).
 *
 * ## Why this exists
 *
 * `ChatTab.sendMessage` already calls `buildChatAutomationPlan(...)` to
 * classify a message, but it then consumes the plan with ad-hoc
 * `if (plan.execution.kind === ...)` branches AND a second, parallel
 * classifier (`conversationalRouter`). C1 unifies that: route every plan
 * through ONE executor (`dispatchChatAutomationPlan`) backed by ONE
 * handler map.
 *
 * The handlers are inherently coupled to ChatTab component state
 * (`addBotMessage`, the model-call closure, navigation, etc.), so this
 * module is a **factory**: `createChatTransportHandlers(deps)` takes those
 * functions as injected dependencies and returns a
 * `ChatTransportHandlers` map. That keeps the routing logic pure and
 * smoke-testable with mock deps while the real wiring lives in ChatTab.
 *
 * ## Contract
 *
 *   - Every handler returns a normalized `ChatAutomationOutcome` and NEVER
 *     throws — a thrown dep is caught and reported as `status: 'failed'`,
 *     matching `dispatchChatAutomationPlan`'s transport contract.
 *   - A kind whose dep is not provided is omitted from the map. The
 *     dispatcher then yields `status: 'skipped'`, so a partially-migrated
 *     ChatTab still falls back to its legacy path for un-wired kinds
 *     (see `runChatAutomationPlan.ts` — "partially-migrated ChatTab can
 *     still run legacy flows for kinds it hasn't yet connected").
 *
 * This file imports TYPES ONLY from the planner/dispatcher, so it stays
 * dependency-light and Node-smoke-testable (no Supabase / React Native).
 */

import type {
  ChatAutomationPlan,
  ChatAutomationExecutionKind,
} from './chatAutomationPlanner';
import type {
  ChatAutomationOutcome,
  ChatTransportContext,
  ChatTransportHandler,
  ChatTransportHandlers,
} from './runChatAutomationPlan';

/**
 * What a dep may return. Returning `void`/`undefined` means "handled, no
 * extra payload"; a partial lets the dep surface a message / data / runId
 * / warnings / a non-completed status that the handler folds into the
 * normalized outcome.
 */
export type ChatTransportDepResult =
  | void
  | undefined
  | {
      /** Override the default `completed`. e.g. a no-op dep → `skipped`. */
      status?: ChatAutomationOutcome['status'];
      message?: string;
      data?: Record<string, unknown>;
      warnings?: string[];
      runId?: string | null;
      approvalId?: string | null;
      /**
       * For pre-check style deps (computer-task / local-desktop): when the
       * dep declines to handle the plan, set `handled: false` so the
       * handler returns `skipped` and the caller's legacy fallback runs.
       */
      handled?: boolean;
    };

export type ChatTransportDep = (
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
) => Promise<ChatTransportDepResult> | ChatTransportDepResult;

/**
 * Injected ChatTab transports, one (optional) per execution kind. Omit a
 * dep to leave that kind on the legacy fallback. `defaultMessage` per kind
 * keeps copy out of the pure layer; deps can override via their return.
 */
export interface ChatTransportDeps {
  local_reply?: ChatTransportDep;
  run_plain_chat?: ChatTransportDep;
  open_modal?: ChatTransportDep;
  run_command_handler?: ChatTransportDep;
  run_openswan?: ChatTransportDep;
  run_computer_task?: ChatTransportDep;
  run_build_discovery?: ChatTransportDep;
  run_browser_plan?: ChatTransportDep;
  run_circle_automation?: ChatTransportDep;
  create_circle_automation?: ChatTransportDep;
  suggest_automation_conversion?: ChatTransportDep;
  ask_clarification?: ChatTransportDep;
}

const ALL_KINDS: ChatAutomationExecutionKind[] = [
  'local_reply',
  'run_plain_chat',
  'open_modal',
  'run_command_handler',
  'run_openswan',
  'run_computer_task',
  'run_build_discovery',
  'run_browser_plan',
  'run_circle_automation',
  'create_circle_automation',
  'suggest_automation_conversion',
  'ask_clarification',
];

/** Wrap one dep into a contract-safe `ChatTransportHandler`. */
function toHandler(kind: ChatAutomationExecutionKind, dep: ChatTransportDep): ChatTransportHandler {
  return async (plan: ChatAutomationPlan, ctx: ChatTransportContext): Promise<ChatAutomationOutcome> => {
    try {
      const res = await dep(plan, ctx);
      // A dep that explicitly declines (`handled: false`) → skipped, so the
      // caller's legacy fallback can take over without an error.
      if (res && res.handled === false) {
        return {
          executionKind: 'skipped',
          status: 'skipped',
          message: res.message ?? `Transport for "${kind}" declined; falling back to legacy path.`,
          ...(res.data ? { data: res.data } : {}),
          ...(res.warnings ? { warnings: res.warnings } : {}),
        };
      }
      return {
        executionKind: kind,
        status: res?.status ?? 'completed',
        message: res?.message ?? '',
        ...(res?.data ? { data: res.data } : {}),
        ...(res?.warnings ? { warnings: res.warnings } : {}),
        ...(res?.runId !== undefined ? { runId: res.runId } : {}),
        ...(res?.approvalId !== undefined ? { approvalId: res.approvalId } : {}),
      };
    } catch (err) {
      // Transports MUST NOT throw across the dispatcher boundary.
      return {
        executionKind: kind,
        status: 'failed',
        message: `Transport "${kind}" threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  };
}

/**
 * Build the handler map from injected deps. Only kinds with a provided dep
 * appear in the map; the rest are left to the dispatcher's `skipped`
 * fallback (and thus the caller's legacy routing).
 */
export function createChatTransportHandlers(deps: ChatTransportDeps): ChatTransportHandlers {
  const handlers: ChatTransportHandlers = {};
  for (const kind of ALL_KINDS) {
    const dep = deps[kind];
    if (dep) handlers[kind] = toHandler(kind, dep);
  }
  return handlers;
}
