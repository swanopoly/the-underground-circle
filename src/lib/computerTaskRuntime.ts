import { executeAgentRun, type AgentRunResult } from './agentRuntime';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  prepareComputerTaskExecution,
  type ComputerTaskExecutionEnvelope,
} from './computerTaskExecution';
import { executeComputerFileTask } from './computerFileAdapter';
import { executeComputerAppTask } from './computerAppAdapter';

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
  chatHistory?: string;
  sessionArchiveContext?: string;
  replyTo?: string;
}): Promise<ComputerTaskRuntimeResult> {
  const execution = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
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

  if (execution.preview.kind === 'app_task') {
    const appResult = await executeComputerAppTask({
      circleId: args.circleId,
      task: args.task,
    });
    if (appResult.ok) {
      return {
        adapterId: 'app_adapter',
        execution,
        response: appResult.message,
        warnings: [...warnings, ...appResult.warnings],
      };
    }
    warnings.push(...appResult.warnings);
  }

  const prompt = `${execution.dispatchPrefix}\n\nUSER COMPUTER TASK\n${args.task}`;
  const result = await executeAgentRun({
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

  return {
    adapterId: adapterIdForKind(execution.preview.kind),
    execution,
    response: result.response,
    runId: result.runId,
    modeOutcomeSummary: result.modeOutcomeSummary,
    observedEval: result.observedEval,
    handoffSuggestion: result.handoffSuggestion,
    warnings,
  };
}
