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
import { buildChatPlanApprovalIntentFingerprint } from './runChatAutomationPlan';
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
   * Deprecated compatibility hook. Exact commands and mutation values are
   * never persisted in approval descriptions; the gate uses a redacted
   * structural summary regardless of caller-provided copy.
   */
  describe?: (plan: ChatAutomationPlan, ctx: ChatTransportContext) => string;
};

type ChatApprovalLookupRow = {
  id: string;
  status: unknown;
  resolved_at: unknown;
  resolved_by: unknown;
  requested_at: unknown;
  timeout_seconds: unknown;
  /** Absent only on the explicitly detected pre-§10b legacy schema. */
  applied_at?: unknown;
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

/**
 * Some deployed projects still have the original `agent_approvals` table but
 * have not applied the additive `applied_at` migration yet. PostgREST reports
 * that drift as either PostgreSQL 42703 or a stale-schema PGRST204 error.
 *
 * Keep this predicate deliberately narrow: only a confirmed missing
 * `agent_approvals.applied_at` column may use the legacy status-CAS claim.
 * Network, RLS, payload-filter, and all other lookup failures still fail
 * closed.
 */
export function isMissingApprovalAppliedAtColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const code = String(record.code ?? '').trim().toUpperCase();
  const message = [record.message, record.details, record.hint]
    .map((value) => String(value ?? ''))
    .join(' ')
    .toLowerCase();
  if (!message.includes('applied_at')) return false;
  if (code === '42703') return true;
  return code === 'PGRST204'
    && (message.includes('schema cache') || message.includes('could not find'));
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
      const approvalIntentFingerprint = await buildApprovalIntentFingerprint(plan, ctx);
      if (!approvalIntentFingerprint) {
        return {
          pass: false,
          deferred: {
            approvalId: '',
            message: 'Could not bind this policy waiver to an exact approval intent. Nothing was executed.',
            category: 'error',
            retryable: false,
          },
        };
      }
      return {
        pass: true,
        notice: `Auto-approved by the circle's ${category} policy for this exact action.`,
        authority: {
          schemaVersion: 1,
          kind: 'policy_auto_waiver',
          approvalIntentFingerprint,
          policyCategory: category,
        },
      };
    }

    if (!plan.approval.required && waiver !== 'confirm_required') {
      return { pass: true };
    }
    const actionType = planActionType(plan);
    const approvalIntentFingerprint = await buildApprovalIntentFingerprint(plan, ctx);
    if (!approvalIntentFingerprint) {
      return {
        pass: false,
        deferred: {
          approvalId: '',
          message: 'Could not bind this action to an exact approval intent. Nothing was executed.',
          category: 'error',
          retryable: false,
        },
      };
    }
    const description = describeDefault(plan);

    // Look for any existing proposal with the same idempotency key on this
    // circle. If found, branch by status.
    const modernLookup = await supabase
      .from('agent_approvals')
      .select('id, status, resolved_at, resolved_by, requested_at, timeout_seconds, applied_at')
      .eq('circle_id', ctx.circleId)
      .eq('session_key', sessionKey)
      .eq('action_type', actionType)
      .contains('payload', {
        approvalSchemaVersion: 2,
        approvalIntentFingerprint,
      })
      .order('requested_at', { ascending: false })
      .limit(1);

    let existing = modernLookup.data as ChatApprovalLookupRow[] | null;
    let lookupError = modernLookup.error;
    let useLegacyStatusClaim = false;

    if (lookupError && isMissingApprovalAppliedAtColumn(lookupError)) {
      // Backward-compatible safety path for deployments that have the JSONB
      // intent binding but not §10b's additive `applied_at` column. The
      // approved row is consumed with an atomic approved -> consumed status
      // compare-and-set below. That retains exact SHA/session/scope/timing
      // binding and one-shot authority without weakening other schema errors.
      const legacyLookup = await supabase
        .from('agent_approvals')
        .select('id, status, resolved_at, resolved_by, requested_at, timeout_seconds')
        .eq('circle_id', ctx.circleId)
        .eq('session_key', sessionKey)
        .eq('action_type', actionType)
        .contains('payload', {
          approvalSchemaVersion: 2,
          approvalIntentFingerprint,
        })
        .order('requested_at', { ascending: false })
        .limit(1);
      existing = legacyLookup.data as ChatApprovalLookupRow[] | null;
      lookupError = legacyLookup.error;
      useLegacyStatusClaim = !lookupError;
    }

    if (lookupError) {
      // Fail closed: can't verify whether an approval exists, so don't run.
      // Transient — re-running may succeed once the DB is reachable. Database
      // messages can contain schema details or user values, so never surface
      // them through a Chat outcome.
      return {
        pass: false,
        deferred: {
          approvalId: '',
          message: 'Approval lookup failed. The plan was not executed; retry when the approval service is available.',
          category: 'error',
          retryable: true,
        },
      };
    }

    const top = existing && existing.length > 0 ? existing[0] : null;
    let previousExpired = false;
    let previousConsumed = false;
    if (top) {
      const status = String(top.status || '');
      if (status === 'approved' || status === 'auto_approved') {
        const expiresAt = resolveApprovalRowExpiresAt(top.requested_at, top.timeout_seconds);
        const requestedAt = Date.parse(String(top.requested_at || ''));
        const resolvedAt = Date.parse(String(top.resolved_at || ''));
        if (
          !isUuid(String(top.resolved_by || ''))
          || !Number.isFinite(requestedAt)
          || !Number.isFinite(resolvedAt)
          || resolvedAt < requestedAt
          || resolvedAt > Date.now()
          || expiresAt === null
          || resolvedAt >= expiresAt
        ) {
          return {
            pass: false,
            deferred: {
              approvalId: top.id,
              message: 'The approval authority was malformed or resolved outside its valid window. Nothing was executed; request a fresh approval.',
              category: 'rejected',
              retryable: false,
            },
          };
        }
        if (expiresAt === null || expiresAt <= Date.now()) {
          previousExpired = true;
          try {
            const expireQuery = supabase
              .from('agent_approvals')
              .update({ status: 'expired', resolved_at: new Date().toISOString() })
              .eq('id', top.id)
              .eq('circle_id', ctx.circleId)
              .eq('session_key', sessionKey)
              .eq('action_type', actionType)
              .in('status', ['approved', 'auto_approved'])
              .contains('payload', {
                approvalSchemaVersion: 2,
                approvalIntentFingerprint,
              });
            if (useLegacyStatusClaim) await expireQuery;
            else await expireQuery.is('applied_at', null);
          } catch { /* fail closed below by filing a fresh proposal */ }
        } else if (!useLegacyStatusClaim && top.applied_at) {
          // An approval authorizes one dispatch only. A completed/ambiguous
          // prior attempt must never be replayed by reusing the same row.
          previousConsumed = true;
        } else {
          // Claim the exact approval before handing control to a transport.
          // `applied_at` is the preferred durable boundary. Older deployed
          // schemas atomically transition the same exact approved row to a
          // terminal `consumed` status instead. Both claims bind the complete
          // fingerprint, session, resolver, and timing fields and can have
          // only one winner.
          const claimBase = supabase
            .from('agent_approvals')
            .update(useLegacyStatusClaim
              ? { status: 'consumed' }
              : { applied_at: new Date().toISOString() })
            .eq('id', top.id)
            .eq('circle_id', ctx.circleId)
            .eq('session_key', sessionKey)
            .eq('action_type', actionType)
            .eq('requested_at', top.requested_at)
            .eq('resolved_at', top.resolved_at)
            .eq('resolved_by', top.resolved_by)
            .eq('timeout_seconds', top.timeout_seconds)
            .in('status', ['approved', 'auto_approved'])
            .contains('payload', {
              approvalSchemaVersion: 2,
              approvalIntentFingerprint,
            });
          const { data: consumed, error: consumeError } = useLegacyStatusClaim
            ? await claimBase.select('id').maybeSingle()
            : await claimBase.is('applied_at', null).select('id').maybeSingle();
          if (consumeError) {
            return {
              pass: false,
              deferred: {
                approvalId: top.id,
                message: 'Could not claim the exact approval safely. Nothing was executed.',
                category: 'error',
                retryable: false,
              },
            };
          }
          if (!consumed?.id) {
            return {
              pass: false,
              deferred: {
                approvalId: top.id,
                message: 'That approval was already consumed by another dispatch. Nothing was replayed.',
                category: 'rejected',
                retryable: false,
              },
            };
          }
          // The network round-trip that won the CAS can itself cross the
          // expiry boundary. Burn the one-shot row but do not dispatch.
          if (Date.now() >= expiresAt) {
            return {
              pass: false,
              deferred: {
                approvalId: top.id,
                message: 'That approval expired while it was being claimed. Nothing was executed.',
                category: 'rejected',
                retryable: false,
              },
            };
          }

          const shortId = String(top.id).slice(0, 8);
          return {
            pass: true,
            approvalId: top.id,
            authority: {
              schemaVersion: 1,
              kind: 'claimed_approval_row',
              approvalId: top.id,
              approvalIntentFingerprint,
            },
            notice: status === 'auto_approved'
              ? `Claimed one-time auto-approval \`${shortId}\` for this exact action.`
              : `Claimed one-time approval \`${shortId}\` for this exact action.`,
          };
        }
      }
      if (status === 'consumed') {
        // Legacy schemas without `applied_at` record the one-shot claim as a
        // terminal status. Never reuse it; file a fresh approval below.
        previousConsumed = true;
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
          approvalSchemaVersion: 2,
          approvalIntentFingerprint,
          source: plan.source,
          intentKind: plan.intent.kind,
          executionKind: plan.execution.kind,
          risk: plan.risk,
          // Bounded structural label (enum, no user values) so the approval
          // banner can offer the matching "remember: auto-approve <category>"
          // opt-in — without it, gate-filed rows carry no plan and the banner
          // could never derive a category for chat-plan deferrals.
          autoApproveCategory: category ?? null,
          userId: ctx.userId,
          roomId: ctx.roomId ?? null,
          threadId: ctx.threadId ?? null,
          redacted: true,
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
          message: 'Could not file the approval request. Nothing was executed; retry when the approval service is available.',
          category: 'error',
          retryable: true,
        },
      };
    }

    const filedPrefix = previousExpired
      ? `Your earlier approval for ${actionType} expired before anyone decided. Filed a fresh approval \`${inserted!.id.slice(0, 8)}\``
      : previousConsumed
        ? `The earlier one-time approval for ${actionType} was already consumed. Filed a fresh approval \`${inserted!.id.slice(0, 8)}\``
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
 * Cryptographic binding for the complete normalized plan and dispatch scope.
 * The digest is persisted; raw commands, notes, paths, credentials, and
 * mutation values are deliberately absent from the approval audit payload.
 */
export async function buildApprovalIntentFingerprint(
  plan: ChatAutomationPlan,
  ctx: ChatTransportContext,
): Promise<string> {
  return buildChatPlanApprovalIntentFingerprint(plan, ctx);
}

function describeDefault(plan: ChatAutomationPlan): string {
  const route = plan.execution.routeId ? ` (${plan.execution.routeId})` : '';
  return `Approve one exact ${plan.execution.kind}${route} chat action. Sensitive arguments are redacted and cryptographically bound.`;
}
