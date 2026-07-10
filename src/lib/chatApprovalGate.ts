/**
 * chatApprovalGate — concrete `ApprovalGate` implementation for
 * `dispatchChatAutomationPlan` (see `runChatAutomationPlan.ts`).
 *
 * Phase CA-4 of `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`. The
 * planner already assigns `risk` + `approval.required`; this file
 * translates that into real `agent_approvals` rows + dedupe against
 * existing pending proposals.
 *
 * Policy (kept here, not in the planner):
 *
 *   plan.approval.required = false           → pass immediately
 *   plan.approval.required = true, no match → file a new proposal, defer
 *   plan.approval.required = true,  match   → check status
 *                                              * pending  → defer to existing
 *                                              * approved → pass (and mark applied downstream)
 *                                              * rejected → deny (deferred with a reject note)
 *
 * "Match" means an identical pending proposal for the same (circleId,
 * sessionKey, action_type, idempotency_key). `idempotency_key` is
 * synthesised from the plan's execution kind + serialized parameters so
 * retries of the same action don't spawn duplicate rows.
 *
 * No direct writes except into `agent_approvals`. Destructive follow-up
 * (the actual side effect) lives in the transport handler; the gate's
 * only job is "may I proceed?".
 */

import { supabase } from './supabase';
import type { ChatAutomationPlan } from './chatAutomationPlanner';
import type {
  ApprovalGate,
  ChatTransportContext,
} from './runChatAutomationPlan';
import { resolveAutoApproveDecision, type AutoApproveDecision } from './chatAutoApproveSettings';
import { detectAlwaysConfirmFloorCategories, type ChatComputerConstraintCategory } from './chatComputerRequestRouter';

export type CreateApprovalGateOptions = {
  /** Session key stored on the approval row. Defaults to default::blackswan. */
  sessionKey?: string;
  /** Agent name shown in the approval banner. Defaults to BlackSwan. */
  agentName?: string;
  /**
   * How long (seconds) a proposal is allowed to sit before auto-expiring.
   * Default 15 minutes — chat automations shouldn't linger overnight
   * (skill/memory writes use a longer window; those are different gates).
   */
  timeoutSeconds?: number;
  /**
   * Extra transform on the synthesised description. Caller can prepend
   * a circle prefix / localize / etc.
   */
  describe?: (plan: ChatAutomationPlan, ctx: ChatTransportContext) => string;
};

/**
 * Destructive floor for the `'auto'` waiver — the same always-confirm
 * category list as `computerGrantGate.STICKY_FLOOR_CATEGORIES`
 * (pay / delete / login / grant), detected with the router's canonical
 * verb anchors so the two policies can never drift. Returns the first
 * matching floor category, or null when the plan carries no floor intent.
 */
export function destructiveFloorCategoryForPlan(
  plan: ChatAutomationPlan,
): ChatComputerConstraintCategory | null {
  const intent = plan.intent;
  let intentText = '';
  if (intent.kind === 'slash_command' || intent.kind === 'natural_command') intentText = intent.commandText;
  else if (intent.kind === 'quick_action') intentText = intent.actionText;
  else if (intent.kind === 'direct_chat') intentText = intent.message;
  else {
    try { intentText = JSON.stringify(intent.intent).slice(0, 400); } catch { intentText = ''; }
  }
  const text = [plan.execution.commandText || '', intentText].filter(Boolean).join('\n');
  const categories = detectAlwaysConfirmFloorCategories(text);
  return categories.length > 0 ? categories[0] : null;
}

/**
 * Pure policy for the per-category `'auto'` waiver:
 *   - 'pass'             → 'auto' waives the proposal, plan runs immediately
 *   - 'confirm_required' → 'auto' hit the destructive floor; the gate MUST
 *                          route through the normal proposal/confirm flow
 *                          even if the planner marked approval not required
 *   - 'default'          → not 'auto'; existing behavior applies
 * The floor mirrors `computerGrantGate` (pay/delete/login/grant): no
 * auto-approve setting can waive those, in any autonomy mode.
 */
export function resolveAutoApproveWaiver(
  decision: AutoApproveDecision,
  plan: ChatAutomationPlan,
): 'pass' | 'confirm_required' | 'default' {
  if (decision !== 'auto') return 'default';
  return destructiveFloorCategoryForPlan(plan) ? 'confirm_required' : 'pass';
}

export function createHitlApprovalGate(opts: CreateApprovalGateOptions = {}): ApprovalGate {
  const sessionKey = opts.sessionKey ?? 'default::blackswan';
  const agentName  = opts.agentName  ?? 'BlackSwan';
  const timeoutSeconds = opts.timeoutSeconds ?? 15 * 60;

  return async (plan, ctx) => {
    // Consult per-category auto-approve settings (Cline research item 2)
    // BEFORE falling back to the planner's coarse `approval.required`
    // bit. Category-level `never` can block a plan the planner thought
    // was safe; `auto` can skip a proposal the planner flagged as
    // needing review. Missing category → default flow.
    const { category, decision } = await resolveAutoApproveDecision(plan, {
      circleId: ctx.circleId,
      userId: ctx.userId,
    }).catch(() => ({ category: null as any, decision: 'ask' as const }));

    if (category && decision === 'never') {
      return {
        pass: false,
        deferred: {
          approvalId: '',
          message: `Blocked by circle policy: category \`${category}\` is set to never.`,
          category: 'blocked_policy',
          retryable: false,
        },
      };
    }
    // 'auto' cannot waive the destructive floor (pay/delete/login/grant) —
    // those plans fall through to the confirm/proposal flow below even when
    // the planner marked approval not required.
    const waiver = category ? resolveAutoApproveWaiver(decision, plan) : 'default';
    if (waiver === 'pass') {
      return { pass: true };
    }

    if (!plan.approval.required && waiver !== 'confirm_required') {
      return { pass: true };
    }
    const actionType = planActionType(plan);
    const idemKey = buildIdempotencyKey(plan, ctx);
    const description = opts.describe ? opts.describe(plan, ctx) : describeDefault(plan);

    // Look for any existing proposal with the same idempotency key on this
    // circle. If found, branch by status.
    const { data: existing, error: lookupError } = await supabase
      .from('agent_approvals')
      .select('id, status, resolved_at, requested_at, timeout_seconds')
      .eq('circle_id', ctx.circleId)
      .eq('action_type', actionType)
      .contains('payload', { idempotencyKey: idemKey })
      .order('requested_at', { ascending: false })
      .limit(1);

    if (lookupError) {
      // Fail closed: can't verify whether an approval exists, so don't run.
      // Transient — re-running may succeed once the DB is reachable.
      return {
        pass: false,
        deferred: {
          approvalId: '',
          message: `Approval lookup failed: ${lookupError.message}. Plan not executed.`,
          category: 'error',
          retryable: true,
        },
      };
    }

    const top = existing && existing.length > 0 ? existing[0] : null;
    let previousExpired = false;
    if (top) {
      const status = String(top.status || '');
      if (status === 'approved' || status === 'auto_approved') {
        // Silent-reuse fix: the idempotency key matches near-identical
        // requests, so tell the user an earlier approval is covering this
        // run instead of passing without a word.
        const shortId = String(top.id).slice(0, 8);
        return {
          pass: true,
          approvalId: top.id,
          notice: status === 'auto_approved'
            ? `Covered by auto-approval \`${shortId}\` for this action. Change the category in approval settings if this shouldn't run automatically.`
            : `Covered by the approval \`${shortId}\` you already granted for this action — not asking again. Reject that approval if this shouldn't be covered.`,
        };
      }
      if (status === 'pending') {
        const expiresAt = resolveApprovalRowExpiresAt(top.requested_at, top.timeout_seconds);
        if (expiresAt !== null && expiresAt <= Date.now()) {
          // Nothing sweeps timed-out rows to `expired`, so without this a
          // stale proposal deferred every retry forever ("Waiting on
          // approval…" against a dead card). Flip it best-effort and fall
          // through to file a fresh proposal.
          previousExpired = true;
          try {
            await supabase
              .from('agent_approvals')
              .update({ status: 'expired', resolved_at: new Date().toISOString() })
              .eq('id', top.id)
              .eq('status', 'pending');
          } catch { /* best-effort — the fresh proposal below is what matters */ }
        } else {
          return {
            pass: false,
            deferred: {
              approvalId: top.id,
              message: `Waiting on approval \`${String(top.id).slice(0, 8)}\` for ${actionType}.`,
              category: 'pending',
              retryable: false,
              expiresAt,
            },
          };
        }
      }
      if (status === 'rejected') {
        return {
          pass: false,
          deferred: {
            approvalId: top.id,
            message: `Approval \`${String(top.id).slice(0, 8)}\` for ${actionType} was rejected. Retry or adjust the request to propose again.`,
            category: 'rejected',
            retryable: false,
          },
        };
      }
      if (status === 'expired') {
        // Fall through and file a fresh proposal below — but say so, since
        // "your approval quietly died" was the old (bad) experience.
        previousExpired = true;
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from('agent_approvals')
      .insert({
        circle_id: ctx.circleId,
        session_key: sessionKey,
        agent_name: agentName,
        action_type: actionType,
        description,
        payload: {
          plan: {
            source: plan.source,
            intentKind: plan.intent.kind,
            executionKind: plan.execution.kind,
            routeId: plan.execution.routeId,
            commandText: plan.execution.commandText ?? null,
            modalKey: plan.execution.modalKey ?? null,
            risk: plan.risk,
            confidence: plan.confidence,
            notes: plan.notes,
          },
          approvalReason: plan.approval.reason,
          idempotencyKey: idemKey,
          userId: ctx.userId,
          roomId: ctx.roomId ?? null,
          threadId: ctx.threadId ?? null,
        },
        timeout_seconds: timeoutSeconds,
      })
      .select('id')
      .single();

    if (insertError) {
      return {
        pass: false,
        deferred: {
          approvalId: '',
          message: `Could not file approval: ${insertError.message}.`,
          category: 'error',
          retryable: true,
        },
      };
    }

    const filedPrefix = previousExpired
      ? `Your earlier approval for ${actionType} expired before anyone decided. Filed a fresh approval \`${inserted!.id.slice(0, 8)}\``
      : `Filed approval \`${inserted!.id.slice(0, 8)}\` for ${actionType}`;
    return {
      pass: false,
      deferred: {
        approvalId: inserted!.id,
        message: `${filedPrefix} — a circle member must approve before it runs.`,
        category: 'filed',
        retryable: false,
        // requested_at is stamped server-side ≈ now; close enough for a UI countdown.
        expiresAt: Date.now() + timeoutSeconds * 1000,
      },
    };
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Epoch ms when a proposal row auto-expires, tolerating the loosely-typed
 * row we get back from the jsonb-filtered select. Mirrors
 * `chatAttentionQueue.resolveApprovalExpiresAt` (kept local because this
 * file imports Supabase and the attention module must stay pure).
 */
function resolveApprovalRowExpiresAt(requestedAt: unknown, timeoutSeconds: unknown): number | null {
  const requested = Date.parse(String(requestedAt ?? ''));
  if (!Number.isFinite(requested)) return null;
  const timeout = Number(timeoutSeconds);
  if (!Number.isFinite(timeout) || timeout <= 0) return null;
  return requested + timeout * 1000;
}

/**
 * Deterministic action_type for an approval row. Used for both dedupe
 * lookups and for categorising rows in the HITL banner. Shape:
 *   "chat.<executionKind>[.<routeId>]"
 */
function planActionType(plan: ChatAutomationPlan): string {
  const route = plan.execution.routeId ? `.${plan.execution.routeId}` : '';
  return `chat.${plan.execution.kind}${route}`;
}

/**
 * Cheap, stable-ish fingerprint of the plan + command text. Not a hash —
 * Postgres' `jsonb @> jsonb` match just needs equality. We trim / lower
 * the command text so trivial variations don't spawn multiple proposals.
 */
function buildIdempotencyKey(plan: ChatAutomationPlan, ctx: ChatTransportContext): string {
  const command = (plan.execution.commandText || '').toLowerCase().trim().slice(0, 200);
  const modal = plan.execution.modalKey || '';
  return [
    'v1',
    ctx.circleId,
    plan.execution.kind,
    plan.execution.routeId ?? '',
    modal,
    command,
  ].join('::');
}

function describeDefault(plan: ChatAutomationPlan): string {
  const route = plan.execution.routeId ? ` (${plan.execution.routeId})` : '';
  const reason = plan.approval.required && plan.approval.reason ? ` — ${plan.approval.reason}` : '';
  const command = plan.execution.commandText ? `: "${plan.execution.commandText.slice(0, 120)}"` : '';
  return `Approve chat action ${plan.execution.kind}${route}${command}${reason}`;
}
