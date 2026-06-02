import { supabase } from './supabase';
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

  return data.map((row: any) => ({
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
  })) as AgentPlanPersisted[];
}
