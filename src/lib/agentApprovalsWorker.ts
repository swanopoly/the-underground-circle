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
 *         - skill.create/patch/delete/write_file/remove_file
 *                                      → applyApprovedSkillAction
 *         - memory.compact             → applyApprovedMemoryCompaction
 *         - user_memory.replace/delete → applyApprovedUserMemoryAction
 *         - chat.review_comment        → applyApprovedReviewCommentAction (new)
 *     → `agent_approvals.applied_at` stamped; re-runs are no-ops.
 *
 * The dispatcher coalesces same-process calls by approval id. Each handler
 * performs its read-only validation/preflight first, then atomically consumes
 * `applied_at` immediately before its first mutation or transport. The durable
 * claim is the cross-tab/process safety boundary; post-dispatch ambiguity is
 * never replayed automatically.
 * Unknown `action_type`s mark the approval row with a `worker_skipped_at`
 * metadata note and return silently — we never throw across the approval UI
 * boundary.
 */

import { supabase } from './supabase';
import { applyApprovedSkillAction } from './skillLibraryWrite';
import { applyApprovedMemoryCompaction } from './circleMemoryCompaction';
import { createPullRequestComment } from './github';
import {
  looksLikeCredentialMemoryContent,
  USER_MEMORY_CAP_ERROR,
  USER_MEMORY_CREDENTIAL_ERROR,
  USER_MEMORY_HARD_CAP,
} from './userMemoryCaps';
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
import { createApprovalSingleFlight } from './approvalSingleFlight';
import { claimApprovalExecution } from './approvalExecutionClaim';

export type ApprovalApplyResult =
  | { ok: true; actionType: string; applied: boolean; reason?: string; skillId?: string }
  | { ok: false; actionType: string | null; error: string };

/**
 * Approval families whose side effect is owned by a runtime that performs its
 * own exact one-shot claim immediately before dispatch. `chat.review_comment`
 * is intentionally excluded: it has a real worker handler below.
 */
export function isRuntimeOwnedAgentApprovalActionType(actionType: unknown): boolean {
  const normalized = String(actionType || '').trim();
  return normalized.startsWith('scheduled_action.')
    || (normalized.startsWith('chat.') && normalized !== REVIEW_COMMENT_ACTION_TYPE);
}

/**
 * Apply a single approved row. Idempotent: re-running on an already-applied
 * or non-approved row short-circuits BEFORE any side-effecting handler runs,
 * so a double-click / resubmit / network retry / sweep race can never
 * double-execute (idempotency key = the approval id). Process-local calls are
 * coalesced as an optimization; every handler also wins a durable one-row CAS
 * after validation and directly before its first side effect. Safe to call from UI approve handlers
 * without awaiting the result — the return value is for telemetry/toasts.
 */
const runApprovedActionSingleFlight = createApprovalSingleFlight<ApprovalApplyResult>();

export function applyApprovedAction(approvalId: string): Promise<ApprovalApplyResult> {
  return runApprovedActionSingleFlight(
    approvalId,
    () => applyApprovedActionOnce(approvalId),
  );
}

async function applyApprovedActionOnce(approvalId: string): Promise<ApprovalApplyResult> {
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
  if (isRuntimeOwnedAgentApprovalActionType(actionType)) {
    return {
      ok: true,
      actionType,
      applied: false,
      reason: 'deferred to the exact runtime-owned dispatch gate',
    };
  }

  // ── Durable one-shot consumption guard ───────────────────────────────────
  // APIs with side effects aren't safe to retry unless they provide
  // idempotency. The approval `id` is the logical-operation key; `applied_at`
  // is the durable "already consumed" claim. This snapshot check avoids
  // needless handler preflight on ordinary retries; the handler-local guarded
  // UPDATE is what arbitrates concurrent tabs/processes immediately before the
  // mutation.
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

    // Unknown kind — don't guess. Atomically seal it as a terminal worker skip
    // so a mount sweep cannot process it forever, while preserving the same
    // one-winner/status/action binding as every side-effecting family.
    const skippedAt = new Date().toISOString();
    const { data: skippedRows, error: skipError } = await supabase
      .from('agent_approvals')
      .update({
        applied_at: skippedAt,
        payload: {
          ...(data.payload || {}),
          // Persist the logical-operation key so any (pathological) re-file
          // under this id with mutated params is caught by detectParamMismatch.
          workerIdempotencyKey: incomingKey,
          worker_skipped_at: skippedAt,
          worker_skipped_reason: `no handler for action_type "${actionType}"`,
        },
      })
      .eq('id', approvalId)
      .eq('action_type', actionType)
      .in('status', ['approved', 'auto_approved'])
      .is('applied_at', null)
      .select('id');
    if (skipError) {
      return { ok: false, actionType, error: 'Could not record the unsupported approval action.' };
    }
    if (!skippedRows || skippedRows.length !== 1) {
      return buildIdempotentSkipResult({ ...data, applied_at: skippedAt, action_type: actionType });
    }
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
  const rawCircleId = payload.circleId;
  const circleId = rawCircleId == null
    ? null
    : typeof rawCircleId === 'string' && rawCircleId.trim()
      ? rawCircleId.trim()
      : undefined;
  const action = String(payload.action || '').trim();
  if (!userId) return { ok: false, error: 'payload missing userId' };
  if (circleId === undefined) return { ok: false, error: 'payload has invalid circleId' };
  if (action !== 'replace' && action !== 'delete') {
    return { ok: false, error: `unexpected user_memory action "${action}"` };
  }
  const expectedActionType = `user_memory.${action}`;
  if (row.action_type !== expectedActionType) {
    return { ok: false, error: 'approval action_type does not match its user-memory payload' };
  }
  if ((row.circle_id ?? null) !== circleId) {
    return { ok: false, error: 'approval circle_id does not match its user-memory payload' };
  }

  const proposed = action === 'replace' && typeof payload.proposedContent === 'string'
    ? payload.proposedContent.trim()
    : null;
  if (action === 'replace') {
    if (!proposed) return { ok: false, error: 'replace: empty proposedContent' };
    if (looksLikeCredentialMemoryContent(proposed)) {
      return { ok: false, error: USER_MEMORY_CREDENTIAL_ERROR };
    }
    if (proposed.length > USER_MEMORY_HARD_CAP) {
      return { ok: false, error: USER_MEMORY_CAP_ERROR };
    }
  }

  // Read-only target/access preflight. The approval remains unconsumed on a
  // lookup/RLS failure, and the winning CAS sits directly beside the eventual
  // update/insert/delete instead of before helper-internal validation.
  let targetQuery = supabase
    .from('user_memory')
    .select('id')
    .eq('user_id', userId);
  targetQuery = circleId === null
    ? targetQuery.is('circle_id', null)
    : targetQuery.eq('circle_id', circleId);
  const { data: existing, error: lookupError } = await targetQuery.maybeSingle();
  if (lookupError) return { ok: false, error: `user memory lookup failed: ${lookupError.message}` };

  const claim = await claimApprovalExecution(approvalId, expectedActionType);
  if (!claim.ok) return { ok: false, error: claim.error };
  if (!claim.claimed) return { ok: true, applied: false, reason: 'already applied' };

  if (action === 'replace') {
    const mutation = existing
      ? await supabase
          .from('user_memory')
          .update({ content: proposed, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
      : await supabase
          .from('user_memory')
          .insert({ user_id: userId, circle_id: circleId, content: proposed });
    if (mutation.error) return { ok: false, error: `replace failed: ${mutation.error.message}` };
    return { ok: true, applied: true };
  }

  if (!existing) {
    return { ok: true, applied: false, reason: 'no user memory row to delete' };
  }
  const { error: deleteError } = await supabase
    .from('user_memory')
    .delete()
    .eq('id', existing.id);
  if (deleteError) return { ok: false, error: `delete failed: ${deleteError.message}` };
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
  if (row.action_type !== REVIEW_COMMENT_ACTION_TYPE) {
    return { ok: false, error: 'approval action_type is not chat.review_comment' };
  }
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

  const commentBody = composeReviewCommentBody(body);
  const postComment = deps.postComment ?? createPullRequestComment;
  const claim = await claimApprovalExecution(approvalId, REVIEW_COMMENT_ACTION_TYPE);
  if (!claim.ok) return { ok: false, error: claim.error };
  if (!claim.claimed) return { ok: true, applied: false, reason: 'already applied' };

  let posted: { success: boolean; error?: string };
  try {
    posted = await postComment(owner, repo, number, commentBody, token);
  } catch {
    return {
      ok: false,
      error: `GitHub comment dispatch on ${owner}/${repo}#${number} has an unknown outcome and was not retried automatically.`,
    };
  }
  if (!posted.success) {
    // The one-shot claim remains consumed: a transport failure after dispatch
    // can be outcome-unknown, so an automatic retry could duplicate a comment.
    return { ok: false, error: `GitHub comment on ${owner}/${repo}#${number} failed and was not retried automatically: ${posted.error || 'unknown error'}` };
  }

  return { ok: true, applied: true };
}
