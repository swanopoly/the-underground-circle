import { executeAgentRun, type AgentRunResult } from './agentRuntime';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  prepareComputerTaskExecution,
  type ComputerTaskExecutionEnvelope,
} from './computerTaskExecution';
import { executeComputerFileTask } from './computerFileAdapter';
import { executeComputerAppTask } from './computerAppAdapter';
import { listApiKeys } from './llmProviders';
import {
  loadCircleBusinessModelProfiles,
  buildImplicitBusinessModelProfiles,
  planBusinessModelForComputerTask,
  type BusinessModelTaskPlan,
} from './businessModelProfiles';

export type ComputerTaskRuntimeAdapterId =
  | 'browser_adapter'
  | 'file_adapter'
  | 'app_adapter'
  | 'hybrid_adapter';

export interface ComputerTaskRuntimeResult {
  adapterId: ComputerTaskRuntimeAdapterId;
  execution: ComputerTaskExecutionEnvelope;
  response: string;
  runId?: string | null;
  modeOutcomeSummary?: AgentRunResult['modeOutcomeSummary'];
  observedEval?: OpenSwanObservedEvalSummary | null;
  handoffSuggestion?: AgentRunResult['handoffSuggestion'];
  warnings: string[];
}

/**
 * Detects whether an app-task utterance has follow-up work beyond the
 * initial launch. "open Zoom" → false (we can short-circuit after
 * launching). "open Notes and create a note" → true (the agent needs
 * to keep going after launch). Conservative: any conjunction, any
 * action verb beyond open/launch/start/switch, or any "and then" / "then"
 * counts as follow-up.
 *
 * Exported for smoke tests — keeps the classifier pinned.
 */
export function hasFollowUpIntent(task: string): boolean {
  const lower = String(task || '').trim().toLowerCase();
  if (!lower) return false;
  if (/\b(then|and then|after|next|also|,)\b/i.test(lower)) return true;
  if (/\band\s+(?!(?:i|i'?m|the|a|an)\b)\w/i.test(lower)) return true;
  // Action verbs that imply work INSIDE the app — not just launching it.
  if (/\b(create|write|type|make|draft|send|post|compose|record|start a|new)\b/i.test(lower)) return true;
  // "with" / "about" / "for" + object — usually describes follow-up content.
  if (/\b(with|about|for)\s+\w+/i.test(lower) && lower.length > 25) return true;
  return false;
}

function adapterIdForKind(kind: ComputerTaskExecutionEnvelope['preview']['kind']): ComputerTaskRuntimeAdapterId {
  switch (kind) {
    case 'file_task':
      return 'file_adapter';
    case 'app_task':
      return 'app_adapter';
    case 'hybrid_task':
      return 'hybrid_adapter';
    case 'browser_task':
    case 'unknown':
    default:
      return 'browser_adapter';
  }
}

export async function executeComputerTaskWithAgent(args: {
  task: string;
  circleId: string;
  userId: string;
  userName?: string;
  model?: string;
  audit: ComputerCapabilityAudit | null;
  grantedIds?: import('./computerTaskGrants').ComputerTaskGrantId[];
  businessModelPlan?: BusinessModelTaskPlan | null;
  chatHistory?: string;
  sessionArchiveContext?: string;
  replyTo?: string;
}): Promise<ComputerTaskRuntimeResult> {
  const previewForRouting = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
  }).preview;
  const businessModelPlan = args.businessModelPlan || await (async () => {
    const [businessProfiles, providerKeys] = await Promise.all([
      loadCircleBusinessModelProfiles(args.circleId).catch(() => []),
      listApiKeys().catch(() => []),
    ]);
    return planBusinessModelForComputerTask({
      task: args.task,
      preview: previewForRouting,
      profiles: [...businessProfiles, ...buildImplicitBusinessModelProfiles(providerKeys)],
      providerKeys,
    });
  })();
  const execution = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
    businessModelPlan,
  });

  const warnings: string[] = [];
  if (!execution.readiness.ready && execution.readiness.missing.length > 0) {
    warnings.push(execution.readiness.summary);
  }
  if (execution.grants.approvalSummary) {
    warnings.push(execution.grants.approvalSummary);
  }

  if (execution.preview.kind === 'file_task') {
    const fileResult = await executeComputerFileTask({
      circleId: args.circleId,
      task: args.task,
    });
    if (fileResult.ok) {
      return {
        adapterId: 'file_adapter',
        execution,
        response: fileResult.message,
        warnings: [...warnings, ...fileResult.warnings],
      };
    }
    warnings.push(...fileResult.warnings);
  }

  // UC-5 follow-up: "open Notes and create a note" was returning right
  // after the bridge launch because appResult.ok short-circuited the
  // runtime. That's correct for pure-launch intents ("open Zoom") but
  // wrong for multi-verb requests where the user wants follow-up
  // actions inside the app. Detect the difference and let multi-intent
  // utterances fall through to the agent loop (which has desktop.*
  // tools and can press Cmd+N / type / etc.).
  let appAdapterMessage: string | null = null;
  let appBridgeLaunched = false;
  if (execution.preview.kind === 'app_task') {
    const appResult = await executeComputerAppTask({
      circleId: args.circleId,
      task: args.task,
    });
    warnings.push(...appResult.warnings);
    if (appResult.ok) {
      const hasFollowUp = hasFollowUpIntent(args.task);
      const wasBridgeLaunch = (appResult.data as any)?.kind === 'desktop_bridge_launch';
      if (!hasFollowUp) {
        // Pure launch — return the bridge result as-is, no agent needed.
        return {
          adapterId: 'app_adapter',
          execution,
          response: appResult.message,
          warnings,
        };
      }
      // Multi-intent: remember that the launch already happened (or at
      // least tried to) so the agent prompt can skip re-launching.
      appAdapterMessage = appResult.message;
      appBridgeLaunched = wasBridgeLaunch;
    }
  }

  const followUpPreamble = appAdapterMessage
    ? `Bridge already ${appBridgeLaunched ? 'launched the target app' : 'attempted the app action'}: ${appAdapterMessage}\n`
      + 'Continue from there — use desktop.wait_for_app / desktop.read_a11y_tree / desktop.press_keys / desktop.type_text as needed. Do NOT re-launch.\n\n'
    : '';
  const prompt = `${execution.dispatchPrefix}\n${followUpPreamble}USER COMPUTER TASK\n${args.task}`;

  // Belt-and-suspenders: if executeAgentRun throws (provider outage,
  // v2 continuation cap, model returns null), we still need to surface
  // SOMETHING to the user — otherwise the chat renders empty ("just
  // refreshed the chat" bug). Capture + fall back to a message that
  // at least confirms the bridge launch and names the error.
  let result: AgentRunResult;
  try {
    result = await executeAgentRun({
      surface: 'main_chat',
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      prompt,
      model: args.model,
      mode: execution.recommendedMode,
      capabilityProfile: execution.capabilityProfile,
      context: {
        chatHistory: args.chatHistory,
        sessionArchiveContext: args.sessionArchiveContext,
        replyTo: args.replyTo,
      },
    });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    warnings.push(`agent follow-up failed: ${errMsg}`);
    const fallback = appAdapterMessage
      ? `${appAdapterMessage}\n\n**Agent follow-up failed:** ${errMsg}\n\nThe app opened, but I couldn't complete the rest of the task. Try again or break it into smaller steps.`
      : `Agent follow-up failed: ${errMsg}`;
    return {
      adapterId: adapterIdForKind(execution.preview.kind),
      execution,
      response: fallback,
      runId: null,
      warnings,
    };
  }

  // Another silent-failure gap: executeAgentRun can return an empty
  // string when every provider tier punts. Keep the bridge-launch
  // message visible so the user isn't looking at a blank bubble.
  const agentResponse = String(result.response || '').trim();
  const combinedResponse = agentResponse
    ? (appAdapterMessage ? `${appAdapterMessage}\n\n${agentResponse}` : agentResponse)
    : (appAdapterMessage
        ? `${appAdapterMessage}\n\n_(Agent didn't return follow-up text. The app is open — say what to do next and I'll continue from there.)_`
        : '(No response from the agent — try rephrasing.)');

  return {
    adapterId: adapterIdForKind(execution.preview.kind),
    execution,
    response: combinedResponse,
    runId: result.runId,
    modeOutcomeSummary: result.modeOutcomeSummary,
    observedEval: result.observedEval,
    handoffSuggestion: result.handoffSuggestion,
    warnings,
  };
}
