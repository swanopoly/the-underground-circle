/**
 * Mission Agent Dispatch — send mission tasks to BlackSwan for execution
 * See docs/NEXT_LEVEL_PLAN.md Phase 2.2
 */
import { supabase } from './supabase';
import { updateMissionTask, addProofOfWork } from './missions';
import { getSwanBotResponse } from './swanbot';
import type { SwanBotContext } from './swanbot';

interface DispatchResult {
  success: boolean;
  response: string;
  error?: string;
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
}): Promise<DispatchResult> {
  const { taskId, taskTitle, taskDescription, missionId, missionTitle, circleId, agentName, userId } = opts;

  // Mark task as in progress
  await updateMissionTask(taskId, { status: 'in_progress' });

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

    const responseText = await getSwanBotResponse(prompt, context);

    // Mark task as done
    await updateMissionTask(taskId, { status: 'done' });

    // Create proof-of-work entry
    await addProofOfWork({
      circle_id: circleId,
      mission_id: missionId,
      user_id: user?.id,
      agent_name: agentName,
      pow_type: 'agent_run',
      title: `${agentName} completed: ${taskTitle}`,
      detail: {
        mission: missionTitle,
        task_id: taskId,
        task_title: taskTitle,
        response_preview: responseText.substring(0, 500),
      },
    });

    return { success: true, response: responseText };
  } catch (err: any) {
    // Mark task back to pending on failure
    await updateMissionTask(taskId, { status: 'pending' });
    return { success: false, response: '', error: err.message || 'Agent execution failed' };
  }
}

function buildTaskPrompt(taskTitle: string, taskDescription: string | undefined, missionTitle: string): string {
  let prompt = `You have been assigned a task from mission "${missionTitle}".\n\n`;
  prompt += `**Task:** ${taskTitle}\n`;
  if (taskDescription) {
    prompt += `**Details:** ${taskDescription}\n`;
  }
  prompt += `\nComplete this task to the best of your ability. Be concise and actionable in your response. If you need more information to complete the task, say what you need.`;
  return prompt;
}
