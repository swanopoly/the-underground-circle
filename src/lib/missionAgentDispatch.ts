/**
 * Mission Agent Dispatch — send mission tasks to BlackSwan for execution
 * See docs/NEXT_LEVEL_PLAN.md Phase 2.2
 */
import { supabase } from './supabase';
import { updateMissionTask, addProofOfWork } from './missions';
import { runOpenSwanSessionTurn, type OpenSwanToolEvent } from './openswanSessionRuntime';
import { resolveSessionCodingProfile } from './chatSessionProfile';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import type { SwanBotStructuredArtifact, SwanBotContext } from './swanbot';
import {
  buildMissionTaskReceiptText,
  buildProofOriginDetail,
  extractProofOriginThreadId,
} from './chatProofReceipts';
import { persistChatMessage } from './chatService';

interface DispatchResult {
  success: boolean;
  response: string;
  error?: string;
  runId?: string | null;
  completed?: boolean;
  artifacts?: SwanBotStructuredArtifact[];
  verificationResults?: OpenSwanVerificationResult[];
  toolEvents?: OpenSwanToolEvent[];
}

/**
 * Dispatch a mission task to BlackSwan for execution.
 * BlackSwan processes the task and returns a response.
 * The task is marked as in_progress during execution and done on success.
 * A proof-of-work entry is created with the results.
 */
export async function dispatchTaskToAgent(opts: {
  taskId: string;
  taskTitle: string;
  taskDescription?: string;
  missionId: string;
  missionTitle: string;
  circleId: string;
  agentName: string;
  userId?: string;
  /**
   * Originating chat thread for the receipt loop. When omitted, the
   * dispatcher resolves it from the mission's chat-origin proof stamp
   * (see `missionChatCommands.stampMissionChatOrigin`), so missions
   * created from chat get receipts no matter which surface dispatches.
   */
  originThreadId?: string | null;
}): Promise<DispatchResult> {
  const { taskId, taskTitle, taskDescription, missionId, missionTitle, circleId, agentName, userId } = opts;

  // Mark task as in progress
  await updateMissionTask(taskId, { status: 'in_progress' });

  const originThreadId = opts.originThreadId !== undefined
    ? opts.originThreadId
    : await findMissionOriginThreadId(missionId);

  try {
    // Build the prompt for BlackSwan
    const prompt = buildTaskPrompt(taskTitle, taskDescription, missionTitle);

    // Get current user info for context
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

    // Call BlackSwan
    const context: SwanBotContext = {
      circleId,
      userId: user?.id || userId || '',
      userName: 'Mission System',
    };

    const sessionProfile = resolveSessionCodingProfile('auto', prompt, 'main_chat');
    const structured = await runOpenSwanSessionTurn({
      message: prompt,
      context,
      surface: 'main_chat',
      runSurface: 'feed_task',
      taskId,
      mode: 'mission_task',
      title: `Mission: ${taskTitle}`.slice(0, 100),
      goal: `${missionTitle}: ${taskTitle}`.slice(0, 500),
      sessionProfile,
      metadata: {
        missionId,
        missionTitle,
        missionTaskId: taskId,
        missionTaskTitle: taskTitle,
        launchedFrom: 'missionAgentDispatch',
        agentName,
      },
    });
    const responseText = structured.response;
    const completed = shouldMarkMissionTaskComplete({
      response: responseText,
      artifacts: structured.artifacts || [],
      verificationResults: structured.verificationResults || [],
      toolEvents: structured.toolEvents || [],
    });

    await updateMissionTask(taskId, { status: completed ? 'done' : 'in_progress' });

    // Create proof-of-work entry
    await addProofOfWork({
      circle_id: circleId,
      mission_id: missionId,
      user_id: user?.id,
      agent_name: agentName,
      pow_type: 'agent_run',
      title: completed ? `${agentName} completed: ${taskTitle}` : `${agentName} updated: ${taskTitle}`,
      detail: {
        mission: missionTitle,
        task_id: taskId,
        task_title: taskTitle,
        run_id: structured.runId || null,
        completed,
        task_kind: structured.taskPlan.kind,
        profile: structured.taskPlan.profile,
        artifact_count: structured.artifacts?.length || 0,
        artifacts: summarizeArtifacts(structured.artifacts || []),
        verification: summarizeVerification(structured.verificationResults || []),
        tool_events: summarizeToolEvents(structured.toolEvents || []),
        response_preview: responseText.substring(0, 500),
        ...(originThreadId ? buildProofOriginDetail(originThreadId) : {}),
      },
    });

    // Receipt loop (Phase 3c): post a compact receipt back to the chat
    // thread the mission came from. Fire-and-forget — a failed receipt
    // never fails the dispatch.
    if (originThreadId) {
      try {
        await persistChatMessage({
          circleId,
          userId: user?.id || userId || '',
          content: buildMissionTaskReceiptText({
            taskTitle,
            missionTitle,
            agentName,
            completed,
            resultPreview: responseText.split('\n').find((line) => line.trim()) || null,
          }),
          isBot: true,
          threadId: originThreadId,
        });
      } catch { /* receipt is best-effort */ }
    }

    return {
      success: true,
      response: responseText,
      runId: structured.runId || null,
      completed,
      artifacts: structured.artifacts || [],
      verificationResults: structured.verificationResults || [],
      toolEvents: structured.toolEvents || [],
    };
  } catch (err: any) {
    // Mark task back to pending on failure
    await updateMissionTask(taskId, { status: 'pending' });
    return { success: false, response: '', error: err.message || 'Agent execution failed' };
  }
}

/**
 * Resolve the chat thread a mission originated from, via the `manual`
 * proof row `missionChatCommands` stamps at creation. Null for missions
 * created outside chat — the receipt loop simply stays off for those.
 */
async function findMissionOriginThreadId(missionId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('proof_of_work')
      .select('detail')
      .eq('mission_id', missionId)
      .eq('pow_type', 'manual')
      .order('created_at', { ascending: true })
      .limit(5);
    for (const row of data || []) {
      const threadId = extractProofOriginThreadId((row as { detail?: unknown }).detail);
      if (threadId) return threadId;
    }
  } catch { /* lookup is best-effort */ }
  return null;
}

function buildTaskPrompt(taskTitle: string, taskDescription: string | undefined, missionTitle: string): string {
  let prompt = `You have been assigned a task from mission "${missionTitle}".\n\n`;
  prompt += `**Task:** ${taskTitle}\n`;
  if (taskDescription) {
    prompt += `**Details:** ${taskDescription}\n`;
  }
  prompt += '\nWork like OpenSwan running a tracked mission task.';
  prompt += '\nPrefer concrete deliverables, structured artifacts, and explicit blockers over vague summaries.';
  prompt += '\nIf the task needs follow-up, missing context, approval, or external access, say that directly.';
  return prompt;
}

function shouldMarkMissionTaskComplete(opts: {
  response: string;
  artifacts: SwanBotStructuredArtifact[];
  verificationResults: OpenSwanVerificationResult[];
  toolEvents: OpenSwanToolEvent[];
}): boolean {
  const failedTools = opts.toolEvents.some((event) => event.status === 'failed' || event.status === 'blocked' || event.status === 'manual_required');
  if (failedTools) return false;

  const failedVerification = opts.verificationResults.some((result) => !result.ok || result.status === 'manual_required' || result.status === 'blocked');
  if (failedVerification) return false;

  if (/\b(need more information|need more info|need access|need approval|waiting on|blocked|cannot complete|can't complete|missing context|please provide)\b/i.test(opts.response)) {
    return false;
  }

  return true;
}

function summarizeArtifacts(artifacts: SwanBotStructuredArtifact[]): Array<{ kind: string; title: string }> {
  return artifacts.map((artifact) => ({ kind: artifact.kind, title: artifact.title }));
}

function summarizeVerification(results: OpenSwanVerificationResult[]): Array<{ ok: boolean; summary: string }> {
  return results.map((result) => ({ ok: result.ok, summary: result.summary }));
}

function summarizeToolEvents(events: OpenSwanToolEvent[]): Array<{ tool: string; status: string; summary: string }> {
  return events.map((event) => ({
    tool: event.tool,
    status: event.status,
    summary: event.summary,
  }));
}
