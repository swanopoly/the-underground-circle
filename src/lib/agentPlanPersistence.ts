import { supabase } from './supabase';
import { safeGetUserForAccessToken } from './authSession';
import type {
  AgentPlanDraft,
  AgentPlanPersisted,
  AgentPlanStatus,
  AgentPlanStepDraft,
} from './agentPlanMode';
import { buildAgentPlanMetadataSummary } from './agentPlanMode';

export type SaveAgentPlanResult =
  | { ok: true; plan: AgentPlanPersisted; warnings: string[] }
  | { ok: false; plan: AgentPlanDraft; error: string; code?: string | null };

export type AgentPlanExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type AgentPlanAuthorityFence = (authority: AgentPlanExactAuthority) => boolean;

export type AgentPlanExactError =
  | 'invalid_authority'
  | 'authority_mismatch'
  | 'authority_retired'
  | 'scope_mismatch'
  | 'receipt_mismatch'
  | 'remote_error';

export type SaveAgentPlanExactResult =
  | Readonly<{
      ok: true;
      plan: AgentPlanPersisted;
      warnings: string[];
      userId: string;
      circleId: string;
      generation: number;
    }>
  | Readonly<{
      ok: false;
      plan: AgentPlanDraft;
      error: string;
      exactError: AgentPlanExactError;
      code?: string | null;
      userId: string | null;
      circleId: string | null;
      generation: number | null;
    }>;

export type AgentPlanExactListResult = Readonly<{
  ok: boolean;
  plans: AgentPlanPersisted[];
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: AgentPlanExactError;
}>;

export type AgentPlanExactMutationResult = Readonly<{
  ok: boolean;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: AgentPlanExactError;
}>;

const MAX_EXACT_SCOPE_PART_LENGTH = 240;
const MAX_EXACT_ACCESS_TOKEN_LENGTH = 16_384;

function normalizeExactScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_EXACT_SCOPE_PART_LENGTH) return null;
  return normalized;
}

function normalizeAgentPlanExactAuthority(
  input: AgentPlanExactAuthority | null | undefined,
): AgentPlanExactAuthority | null {
  const userId = normalizeExactScopePart(input?.userId);
  const circleId = normalizeExactScopePart(input?.circleId);
  const accessToken = typeof input?.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input?.generation;
  if (
    !userId
    || !circleId
    || !accessToken
    || accessToken.length > MAX_EXACT_ACCESS_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || Number(generation) <= 0
  ) return null;
  return Object.freeze({ userId, circleId, accessToken, generation: Number(generation) });
}

function agentPlanAuthorityIsCurrent(
  authority: AgentPlanExactAuthority,
  fence: AgentPlanAuthorityFence | null | undefined,
): boolean {
  if (!fence) return false;
  try {
    return fence(authority) === true;
  } catch {
    return false;
  }
}

async function resolveAgentPlanExactAuthority(
  input: AgentPlanExactAuthority | null | undefined,
  fence: AgentPlanAuthorityFence | null | undefined,
): Promise<
  | { ok: true; authority: AgentPlanExactAuthority }
  | { ok: false; authority: AgentPlanExactAuthority | null; error: AgentPlanExactError }
> {
  const authority = normalizeAgentPlanExactAuthority(input);
  if (!authority) return { ok: false, authority: null, error: 'invalid_authority' };
  if (!agentPlanAuthorityIsCurrent(authority, fence)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (!agentPlanAuthorityIsCurrent(authority, fence)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  if (verifiedUser?.id !== authority.userId) {
    return { ok: false, authority, error: 'authority_mismatch' };
  }
  return { ok: true, authority };
}

function errorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && 'message' in error) return String((error as any).message || 'Unknown error');
  return String(error);
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) return String((error as any).code || '');
  return null;
}

function stepRow(circleId: string, planId: string, step: AgentPlanStepDraft) {
  return {
    plan_id: planId,
    circle_id: circleId,
    step_order: step.order,
    kind: step.kind,
    status: step.status,
    title: step.title,
    detail: step.detail,
    tool_names: step.toolNames,
    target_refs: step.targetRefs,
    requires_approval: step.requiresApproval,
    checkpoint_policy: step.checkpointPolicy,
    estimated_effort: step.estimatedEffort || null,
    acceptance: step.acceptance,
    metadata: step.metadata || {},
  };
}

export async function saveAgentPlanDraft(input: {
  circleId: string;
  userId?: string | null;
  threadId?: string | null;
  sourceMessageId?: string | null;
  draft: AgentPlanDraft;
}): Promise<SaveAgentPlanResult> {
  const { circleId, userId, threadId, sourceMessageId } = input;
  const draft: AgentPlanDraft = {
    ...input.draft,
    circleId,
    threadId: threadId ?? input.draft.threadId ?? null,
    sourceMessageId: sourceMessageId ?? input.draft.sourceMessageId ?? null,
    createdBy: userId ?? input.draft.createdBy ?? null,
  };

  try {
    const { data: planRow, error: planError } = await supabase
      .from('agent_plans')
      .insert({
        circle_id: circleId,
        thread_id: draft.threadId || null,
        source_message_id: draft.sourceMessageId || null,
        created_by: draft.createdBy || null,
        title: draft.title,
        task: draft.task,
        mode: draft.mode,
        status: draft.status,
        risk: draft.risk,
        summary: draft.summary,
        confidence: draft.confidence,
        selected_model: draft.selectedModel || null,
        build_ready: draft.buildReady,
        metadata: {
          ...draft.metadata,
          summary: buildAgentPlanMetadataSummary(draft),
        },
      })
      .select('id,created_at,updated_at')
      .single();

    if (planError || !planRow?.id) {
      return {
        ok: false,
        plan: draft,
        error: errorMessage(planError || 'Plan row was not returned.'),
        code: errorCode(planError),
      };
    }

    const persisted: AgentPlanPersisted = {
      ...draft,
      id: planRow.id,
      createdAt: planRow.created_at || null,
      updatedAt: planRow.updated_at || null,
    };
    const warnings: string[] = [];

    if (draft.steps.length > 0) {
      const { error } = await supabase
        .from('agent_plan_steps')
        .insert(draft.steps.map((step) => stepRow(circleId, persisted.id, step)));
      if (error) warnings.push(`Steps did not save: ${errorMessage(error)}`);
    }

    if (draft.questions.length > 0) {
      const { error } = await supabase
        .from('agent_plan_questions')
        .insert(draft.questions.map((question) => ({
          plan_id: persisted.id,
          circle_id: circleId,
          question_order: question.order,
          question: question.question,
          why: question.why,
          status: question.status,
          answer: question.answer || null,
        })));
      if (error) warnings.push(`Questions did not save: ${errorMessage(error)}`);
    }

    if (draft.artifacts.length > 0) {
      const { error } = await supabase
        .from('agent_plan_artifacts')
        .insert(draft.artifacts.map((artifact) => ({
          plan_id: persisted.id,
          circle_id: circleId,
          kind: artifact.kind,
          title: artifact.title,
          content: artifact.content || null,
          url: artifact.url || null,
          metadata: artifact.metadata || {},
        })));
      if (error) warnings.push(`Artifacts did not save: ${errorMessage(error)}`);
    }

    return { ok: true, plan: persisted, warnings };
  } catch (error) {
    return {
      ok: false,
      plan: draft,
      error: errorMessage(error),
      code: errorCode(error),
    };
  }
}

export async function updateAgentPlanStatus(
  planId: string,
  status: AgentPlanStatus,
): Promise<{ ok: true } | { ok: false; error: string; code?: string | null }> {
  const { error } = await supabase
    .from('agent_plans')
    .update({ status })
    .eq('id', planId);
  if (error) return { ok: false, error: errorMessage(error), code: errorCode(error) };
  return { ok: true };
}

function mapAgentPlanRow(row: any): AgentPlanPersisted {
  return {
    id: row.id,
    circleId: row.circle_id,
    threadId: row.thread_id,
    sourceMessageId: row.source_message_id,
    createdBy: row.created_by,
    title: row.title,
    task: row.task,
    mode: row.mode,
    status: row.status,
    risk: row.risk,
    summary: row.summary || '',
    confidence: Number(row.confidence || 0),
    selectedModel: row.selected_model,
    buildReady: !!row.build_ready,
    steps: [],
    questions: [],
    artifacts: [],
    flow: row.metadata?.summary?.flow || {
      chat: { source: 'plain_chat', executionKind: 'run_plain_chat', routeId: null, confidence: 0 },
      swanbot: { role: 'planner', mode: row.mode || 'plan', model: row.selected_model || null },
      openswan: { taskKind: 'general', profile: 'senior', recommendedTools: [], verificationKinds: [] },
      office: { handoffReady: false, agentSessionCompatible: true, ledgerPreviewId: null },
    },
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listAgentPlans(input: {
  circleId: string;
  threadId?: string | null;
  limit?: number;
}): Promise<AgentPlanPersisted[]> {
  let query = supabase
    .from('agent_plans')
    .select('*')
    .eq('circle_id', input.circleId)
    .order('updated_at', { ascending: false })
    .limit(input.limit || 20);

  if (input.threadId) query = query.eq('thread_id', input.threadId);

  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];

  return data.map(mapAgentPlanRow) as AgentPlanPersisted[];
}

function exactListFailure(
  authority: AgentPlanExactAuthority | null,
  error: AgentPlanExactError,
): AgentPlanExactListResult {
  return {
    ok: false,
    plans: [],
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function exactMutationFailure(
  authority: AgentPlanExactAuthority | null,
  error: AgentPlanExactError,
): AgentPlanExactMutationResult {
  return {
    ok: false,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function exactSaveFailure(
  plan: AgentPlanDraft,
  authority: AgentPlanExactAuthority | null,
  exactError: AgentPlanExactError,
  error: string,
  code?: string | null,
): SaveAgentPlanExactResult {
  return {
    ok: false,
    plan,
    error,
    exactError,
    code,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
  };
}

/**
 * Persist one plan through the caller-captured account/circle bearer. Every
 * child row is bound to the returned plan id and exact circle; a retired
 * generation is checked after every await and before every following write.
 */
export async function saveAgentPlanDraftExact(
  input: {
    circleId: string;
    userId?: string | null;
    threadId?: string | null;
    sourceMessageId?: string | null;
    draft: AgentPlanDraft;
  },
  authorityInput: AgentPlanExactAuthority,
  isCurrent: AgentPlanAuthorityFence,
): Promise<SaveAgentPlanExactResult> {
  const unresolvedDraft: AgentPlanDraft = { ...input.draft };
  const resolved = await resolveAgentPlanExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) {
    return exactSaveFailure(unresolvedDraft, resolved.authority, resolved.error, 'The captured plan authority is no longer valid.');
  }
  const { authority } = resolved;
  const inputCircleId = normalizeExactScopePart(input.circleId);
  const inputUserId = input.userId == null ? authority.userId : normalizeExactScopePart(input.userId);
  const draftCircleId = input.draft.circleId == null ? authority.circleId : normalizeExactScopePart(input.draft.circleId);
  const draftCreatedBy = input.draft.createdBy == null ? authority.userId : normalizeExactScopePart(input.draft.createdBy);
  if (
    inputCircleId !== authority.circleId
    || inputUserId !== authority.userId
    || draftCircleId !== authority.circleId
    || draftCreatedBy !== authority.userId
  ) {
    return exactSaveFailure(unresolvedDraft, authority, 'scope_mismatch', 'The plan does not belong to the captured account and circle.');
  }

  const draft: AgentPlanDraft = {
    ...input.draft,
    circleId: authority.circleId,
    threadId: input.threadId ?? input.draft.threadId ?? null,
    sourceMessageId: input.sourceMessageId ?? input.draft.sourceMessageId ?? null,
    createdBy: authority.userId,
  };

  try {
    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed before the plan could be saved.');
    }
    const { data: planRow, error: planError } = await supabase
      .from('agent_plans')
      .insert({
        circle_id: authority.circleId,
        thread_id: draft.threadId || null,
        source_message_id: draft.sourceMessageId || null,
        created_by: authority.userId,
        title: draft.title,
        task: draft.task,
        mode: draft.mode,
        status: draft.status,
        risk: draft.risk,
        summary: draft.summary,
        confidence: draft.confidence,
        selected_model: draft.selectedModel || null,
        build_ready: draft.buildReady,
        metadata: {
          ...draft.metadata,
          summary: buildAgentPlanMetadataSummary(draft),
        },
      })
      .select('id,circle_id,created_by,created_at,updated_at')
      .single()
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed while the plan was saving.');
    }
    if (planError || !planRow?.id) {
      return exactSaveFailure(draft, authority, 'remote_error', errorMessage(planError || 'Plan row was not returned.'), errorCode(planError));
    }
    if (planRow.circle_id !== authority.circleId || planRow.created_by !== authority.userId) {
      return exactSaveFailure(draft, authority, 'receipt_mismatch', 'The saved plan receipt did not match the captured account and circle.');
    }

    const persisted: AgentPlanPersisted = {
      ...draft,
      id: planRow.id,
      createdAt: planRow.created_at || null,
      updatedAt: planRow.updated_at || null,
    };
    const warnings: string[] = [];

    if (draft.steps.length > 0) {
      if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
        return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed before plan steps could be saved.');
      }
      const { data, error } = await supabase
        .from('agent_plan_steps')
        .insert(draft.steps.map((step) => stepRow(authority.circleId, persisted.id, step)))
        .select('plan_id,circle_id')
        .setHeader('Authorization', `Bearer ${authority.accessToken}`);
      if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
        return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed while plan steps were saving.');
      }
      if (error) warnings.push(`Steps did not save: ${errorMessage(error)}`);
      else if (
        !Array.isArray(data)
        || data.length !== draft.steps.length
        || data.some((row: any) => row?.plan_id !== persisted.id || row?.circle_id !== authority.circleId)
      ) return exactSaveFailure(draft, authority, 'receipt_mismatch', 'The saved plan-step receipts did not match the plan.');
    }

    if (draft.questions.length > 0) {
      if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
        return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed before plan questions could be saved.');
      }
      const { data, error } = await supabase
        .from('agent_plan_questions')
        .insert(draft.questions.map((question) => ({
          plan_id: persisted.id,
          circle_id: authority.circleId,
          question_order: question.order,
          question: question.question,
          why: question.why,
          status: question.status,
          answer: question.answer || null,
        })))
        .select('plan_id,circle_id')
        .setHeader('Authorization', `Bearer ${authority.accessToken}`);
      if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
        return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed while plan questions were saving.');
      }
      if (error) warnings.push(`Questions did not save: ${errorMessage(error)}`);
      else if (
        !Array.isArray(data)
        || data.length !== draft.questions.length
        || data.some((row: any) => row?.plan_id !== persisted.id || row?.circle_id !== authority.circleId)
      ) return exactSaveFailure(draft, authority, 'receipt_mismatch', 'The saved plan-question receipts did not match the plan.');
    }

    if (draft.artifacts.length > 0) {
      if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
        return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed before plan artifacts could be saved.');
      }
      const { data, error } = await supabase
        .from('agent_plan_artifacts')
        .insert(draft.artifacts.map((artifact) => ({
          plan_id: persisted.id,
          circle_id: authority.circleId,
          kind: artifact.kind,
          title: artifact.title,
          content: artifact.content || null,
          url: artifact.url || null,
          metadata: artifact.metadata || {},
        })))
        .select('plan_id,circle_id')
        .setHeader('Authorization', `Bearer ${authority.accessToken}`);
      if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
        return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed while plan artifacts were saving.');
      }
      if (error) warnings.push(`Artifacts did not save: ${errorMessage(error)}`);
      else if (
        !Array.isArray(data)
        || data.length !== draft.artifacts.length
        || data.some((row: any) => row?.plan_id !== persisted.id || row?.circle_id !== authority.circleId)
      ) return exactSaveFailure(draft, authority, 'receipt_mismatch', 'The saved plan-artifact receipts did not match the plan.');
    }

    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactSaveFailure(draft, authority, 'authority_retired', 'The signed-in account changed before the saved plan could be returned.');
    }
    return {
      ok: true,
      plan: persisted,
      warnings,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactSaveFailure(draft, authority, 'remote_error', errorMessage(error), errorCode(error));
  }
}

/** List circle plans using only a verified captured bearer, with late-result fencing. */
export async function listAgentPlansExact(
  input: { circleId: string; threadId?: string | null; limit?: number },
  authorityInput: AgentPlanExactAuthority,
  isCurrent: AgentPlanAuthorityFence,
): Promise<AgentPlanExactListResult> {
  const resolved = await resolveAgentPlanExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactListFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  if (normalizeExactScopePart(input.circleId) !== authority.circleId) {
    return exactListFailure(authority, 'scope_mismatch');
  }
  try {
    let query = supabase
      .from('agent_plans')
      .select('*')
      .eq('circle_id', authority.circleId)
      .order('updated_at', { ascending: false })
      .limit(Math.max(1, Math.min(Number(input.limit) || 20, 100)))
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (input.threadId) query = query.eq('thread_id', input.threadId);
    const { data, error } = await query;
    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactListFailure(authority, 'authority_retired');
    }
    if (error || !Array.isArray(data)) return exactListFailure(authority, 'remote_error');
    if (data.some((row: any) => row?.circle_id !== authority.circleId || !normalizeExactScopePart(row?.id))) {
      return exactListFailure(authority, 'receipt_mismatch');
    }
    const plans = data.map(mapAgentPlanRow);
    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactListFailure(authority, 'authority_retired');
    }
    return {
      ok: true,
      plans,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactListFailure(authority, 'remote_error');
  }
}

/** Update only a plan created by the captured user in the captured circle. */
export async function updateAgentPlanStatusExact(
  planId: string,
  status: AgentPlanStatus,
  authorityInput: AgentPlanExactAuthority,
  isCurrent: AgentPlanAuthorityFence,
): Promise<AgentPlanExactMutationResult> {
  const resolved = await resolveAgentPlanExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedPlanId = normalizeExactScopePart(planId);
  if (!normalizedPlanId) return exactMutationFailure(authority, 'scope_mismatch');
  try {
    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    const { data, error } = await supabase
      .from('agent_plans')
      .update({ status })
      .eq('id', normalizedPlanId)
      .eq('circle_id', authority.circleId)
      .eq('created_by', authority.userId)
      .select('id,circle_id,created_by,status')
      .maybeSingle()
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!agentPlanAuthorityIsCurrent(authority, isCurrent)) {
      return exactMutationFailure(authority, 'authority_retired');
    }
    if (error) return exactMutationFailure(authority, 'remote_error');
    if (
      data?.id !== normalizedPlanId
      || data?.circle_id !== authority.circleId
      || data?.created_by !== authority.userId
      || data?.status !== status
    ) return exactMutationFailure(authority, 'receipt_mismatch');
    return {
      ok: true,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactMutationFailure(authority, 'remote_error');
  }
}
