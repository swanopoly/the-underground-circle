/**
 * agentApprovalsWorker — dispatches approved `agent_approvals` rows to the
 * right apply function.
 *
 * Without this, approved skill/memory proposals sit in the queue forever —
 * the HITL UI marks them `approved`, but no side-effect ever runs. This
 * worker closes the loop:
 *
 *   user taps Approve in HitlApprovalBanner
 *     → hitlService.resolveApproval(id, 'approved')
 *     → HitlApprovalBanner calls applyApprovedAction(id)   ← THIS FILE
 *     → dispatches by action_type:
 *         - skill.create/patch/delete  → applyApprovedSkillAction
 *         - memory.compact             → applyApprovedMemoryCompaction
 *         - user_memory.replace/delete → applyApprovedUserMemoryAction
 *         - chat.review_comment        → applyApprovedReviewCommentAction (new)
 *     → `agent_approvals.applied_at` stamped; re-runs are no-ops.
 *
 * The dispatcher enforces idempotency BEFORE dispatch (see
 * `./approvalIdempotency`): `applied_at` is the atomic executed-claim, so an
 * approved-then-retried row replays the cached success without re-invoking the
 * handler — no double publish/upload/comment/skill-write. Each apply function
 * also stamps `applied_at` itself, keeping the claim close to its side effect.
 * Unknown `action_type`s mark the approval row with a `worker_skipped_at`
 * metadata note and return silently — we never throw across the approval UI
 * boundary.
 */

import { supabase } from './supabase';
import { applyApprovedSkillAction } from './skillLibraryWrite';
import { applyApprovedMemoryCompaction } from './circleMemoryCompaction';
import { deleteUserMemory, replaceUserMemory } from './userMemory';
import { createPullRequestComment } from './github';
import {
  composeReviewCommentBody,
  resolveReviewGithubToken,
  REVIEW_COMMENT_ACTION_TYPE,
  validateReviewCommentApprovalPayload,
} from './reviewChatCommand';
import {
  buildApprovalIdempotencyKey,
  buildIdempotentSkipResult,
  detectParamMismatch,
  isAlreadyApplied,
  PARAM_MISMATCH_ERROR,
} from './approvalIdempotency';

export type ApprovalApplyResult =
  | { ok: true; actionType: string; applied: boolean; reason?: string; skillId?: string }
  | { ok: false; actionType: string | null; error: string };

/**
 * Apply a single approved row. Idempotent: re-running on an already-applied
 * or non-approved row short-circuits BEFORE any side-effecting handler runs,
 * so a double-click / resubmit / network retry / sweep race can never
 * double-execute (idempotency key = the approval id; applied_at = the executed
 * claim; see ./approvalIdempotency). Safe to call from UI approve handlers
 * without awaiting the result — the return value is for telemetry/toasts.
 */
export async function applyApprovedAction(approvalId: string): Promise<ApprovalApplyResult> {
  const { data, error } = await supabase
    .from('agent_approvals')
    .select('id, circle_id, action_type, status, applied_at, payload, resolved_by')
    .eq('id', approvalId)
    .maybeSingle();

  if (error) return { ok: false, actionType: null, error: `lookup failed: ${error.message}` };
  if (!data)  return { ok: false, actionType: null, error: `approval ${approvalId} not found` };

  const actionType = String(data.action_type || '');
  const status = String(data.status || '');
  if (status !== 'approved' && status !== 'auto_approved') {
    return { ok: true, actionType, applied: false, reason: `status is "${status}"` };
  }

  // Runtime-owned approvals are consumed by the exact runner immediately
  // before its transport dispatch. The generic UI worker must leave both the
  // one-shot applied_at field and the fingerprinted payload untouched.
  if (actionType.startsWith('scheduled_action.') || actionType.startsWith('chat.')) {
    return {
      ok: true,
      actionType,
      applied: false,
      reason: 'deferred to the exact runtime-owned dispatch gate',
    };
  }

  // ── Idempotency guard (atomic claim = applied_at) ─────────────────────────
  // APIs with side effects aren't safe to retry unless they provide
  // idempotency. The approval `id` is the logical-operation key; `applied_at`
  // is the server-cached "already executed" claim. This guard runs BEFORE we
  // dispatch to any side-effecting handler, so a double-click / resubmit /
  // network retry / sweep race on the SAME approved row can never re-publish,
  // re-upload, re-comment, or re-write a skill/memory — it replays the cached
  // success instead. (Read-only / unknown-handler action types are unaffected:
  // they only reach the dispatch below.)
  const incomingKey = buildApprovalIdempotencyKey({
    id: String(data.id),
    action_type: actionType,
    payload: data.payload,
  });
  const storedKey =
    data.payload && typeof (data.payload as any).workerIdempotencyKey === 'string'
      ? String((data.payload as any).workerIdempotencyKey)
      : null;
  // A retry that arrives under the same id but with different params is a
  // conflict — never execute against the new params; fail with a distinct error.
  if (detectParamMismatch(storedKey, incomingKey)) {
    return { ok: false, actionType, error: PARAM_MISMATCH_ERROR };
  }
  if (isAlreadyApplied(data)) {
    // Cached-success replay: applied:false (nothing new ran), handler NOT called.
    return buildIdempotentSkipResult({ ...data, action_type: actionType });
  }

  // Route by action_type prefix so we can add more kinds without touching
  // call sites that already work.
  try {
    if (actionType.startsWith('skill.')) {
      const r = await applyApprovedSkillAction(approvalId);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason, skillId: r.skillId };
    }
    if (actionType === 'memory.compact') {
      const r = await applyApprovedMemoryCompaction(approvalId);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason };
    }
    if (actionType.startsWith('user_memory.')) {
      const r = await applyApprovedUserMemoryAction(approvalId, data);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason };
    }
    if (actionType === REVIEW_COMMENT_ACTION_TYPE) {
      const r = await applyApprovedReviewCommentAction(approvalId, data);
      if (!r.ok) return { ok: false, actionType, error: r.error };
      return { ok: true, actionType, applied: r.applied, reason: r.reason };
    }

    // Unknown kind — don't guess, but do mark it so we can see it in the
    // dashboard and add a handler later.
    await supabase
      .from('agent_approvals')
      .update({
        applied_at: new Date().toISOString(),
        payload: {
          ...(data.payload || {}),
          // Persist the logical-operation key so any (pathological) re-file
          // under this id with mutated params is caught by detectParamMismatch.
          workerIdempotencyKey: incomingKey,
          worker_skipped_at: new Date().toISOString(),
          worker_skipped_reason: `no handler for action_type "${actionType}"`,
        },
      })
      .eq('id', approvalId);
    return { ok: true, actionType, applied: false, reason: `no handler for "${actionType}"` };
  } catch (e) {
    return { ok: false, actionType, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Scan for any approved-but-unapplied rows in a circle and apply each.
 * Useful as a one-shot catch-up on app mount, or a scheduled sweep.
 *
 * Limits to 20 per call so a backlog can't monopolise the UI thread;
 * callers loop if there's more work.
 */
export async function applyAllPendingApprovals(circleId: string): Promise<{
  processed: number;
  applied: number;
  failed: number;
  items: ApprovalApplyResult[];
}> {
  const { data, error } = await supabase
    .from('agent_approvals')
    .select('id, action_type, requested_at')
    .eq('circle_id', circleId)
    .in('status', ['approved', 'auto_approved'])
    .is('applied_at', null)
    .order('requested_at', { ascending: true })
    .limit(20);

  if (error || !data || data.length === 0) {
    return { processed: 0, applied: 0, failed: 0, items: [] };
  }
  const results: ApprovalApplyResult[] = [];
  let applied = 0;
  let failed = 0;
  for (const row of data) {
    const r = await applyApprovedAction(row.id);
    results.push(r);
    if (r.ok && r.applied) applied += 1;
    if (!r.ok) failed += 1;
  }
  return { processed: data.length, applied, failed, items: results };
}

// ─── user_memory apply path ────────────────────────────────────────────────
// Kept local (vs. a separate file) because it's a 20-line delegate around
// existing userMemory helpers and doesn't carry its own complexity.

type ApprovalRow = {
  id: string;
  circle_id?: string | null;
  action_type: string;
  status: string;
  applied_at?: string | null;
  payload?: Record<string, any> | null;
  resolved_by?: string | null;
};

async function applyApprovedUserMemoryAction(
  approvalId: string,
  row: ApprovalRow,
): Promise<{ ok: true; applied: boolean; reason?: string } | { ok: false; error: string }> {
  const payload = row.payload || {};
  const userId = String(payload.userId || '').trim();
  const circleId = (payload.circleId ?? null) as string | null;
  const action = String(payload.action || '').trim();
  if (!userId) return { ok: false, error: 'payload missing userId' };
  if (action !== 'replace' && action !== 'delete') {
    return { ok: false, error: `unexpected user_memory action "${action}"` };
  }

  // NB: `replaceUserMemory` + `deleteUserMemory` are user-owned writes (RLS
  // user_rw_own_memory). Running them from an approval handler is safe
  // because the HITL banner only lets the row's target user approve it.
  if (action === 'replace') {
    const proposed = String(payload.proposedContent || '');
    if (proposed.length === 0) return { ok: false, error: 'replace: empty proposedContent' };
    const r = await replaceUserMemory(userId, circleId, proposed);
    if (!r.ok) return { ok: false, error: r.error || 'replace failed' };
  } else {
    const r = await deleteUserMemory(userId, circleId);
    if (!r.ok) return { ok: false, error: r.error || 'delete failed' };
  }

  try {
    await supabase
      .from('agent_approvals')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', approvalId);
  } catch {}

  return { ok: true, applied: true };
}

// ─── chat.review_comment apply path ────────────────────────────────────────
// Posts approved `/review … --comment` findings to the PR as a GitHub
// comment. Payload validation, body composition (8k clamp + attribution
// line), and token resolution are imported from reviewChatCommand.ts — the
// same module that FILED the row — so filer and applier can never drift.
// Token resolution is the exact /review + githubChatCommands path: circle
// PAT via localSecrets → the approver's OAuth token in `user_github_tokens`.
//
// Exported with injectable seams because this file imports supabase →
// react-native and cannot load under tsx; the pure validation/composition
// pieces are covered by scripts/review-chat-command-smoketest.ts instead.

export interface ReviewCommentApplyDeps {
  /** GitHub token lookup; defaults to resolveReviewGithubToken. */
  resolveToken?: (circleId: string, userId: string) => Promise<string | null>;
  /** Comment poster; defaults to github.createPullRequestComment. */
  postComment?: (
    owner: string,
    repo: string,
    pullNumber: number,
    body: string,
    token: string,
  ) => Promise<{ success: boolean; error?: string }>;
}

export async function applyApprovedReviewCommentAction(
  approvalId: string,
  row: ApprovalRow,
  deps: ReviewCommentApplyDeps = {},
): Promise<{ ok: true; applied: boolean; reason?: string } | { ok: false; error: string }> {
  // Fail-closed payload validation (pure, shared with the filer).
  const validated = validateReviewCommentApprovalPayload(row.payload);
  if (!validated.ok) return { ok: false, error: validated.error };
  const { owner, repo, number, body } = validated.value;

  const circleId = String(row.circle_id || '').trim();
  if (!circleId) return { ok: false, error: 'approval row has no circle_id' };

  // Token — same path the review itself used; the OAuth fallback keys off the
  // approving user (resolved_by), who is authorizing the write.
  const resolveToken = deps.resolveToken ?? resolveReviewGithubToken;
  let token: string | null = null;
  try {
    token = await resolveToken(circleId, String(row.resolved_by || ''));
  } catch {
    token = null;
  }
  if (!token) {
    return {
      ok: false,
      error:
        'no GitHub token found for this circle — connect GitHub in Marketplace → GitHub, then approve again.',
    };
  }

  const postComment = deps.postComment ?? createPullRequestComment;
  const posted = await postComment(owner, repo, number, composeReviewCommentBody(body), token);
  if (!posted.success) {
    // Surface per the worker contract (dispatcher returns { ok:false, error })
    // and leave applied_at unstamped so a later sweep can retry.
    return { ok: false, error: `GitHub comment on ${owner}/${repo}#${number} failed: ${posted.error || 'unknown error'}` };
  }

  try {
    await supabase
      .from('agent_approvals')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', approvalId);
  } catch {}

  return { ok: true, applied: true };
}
