import { launchClaudeCodeSessions } from './claudeCodeDetector';
import { launchCodexSessions } from './codexDetector';
import { launchCursorComposerSessions } from './cursorDetector';
import { launchGeminiCliSessions } from './geminiCliDetector';
import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';
import {
  formatVisualBriefsForConnectedAgent,
  type ChatVisualBriefArtifact,
} from './chatVisualBriefCore';
import {
  formatTerminalAgentLaunchResponse,
  parseTerminalAgentLaunchRequest,
  type TerminalAgentLaunchPlan,
  type TerminalAgentLaunchResult,
} from './terminalAgentLaunchParser';

export {
  formatTerminalAgentLaunchResponse,
  parseTerminalAgentLaunchRequest,
};

export type {
  TerminalAgentLaunchPlan,
  TerminalAgentLaunchResult,
  TerminalAgentProvider,
} from './terminalAgentLaunchParser';

export interface TerminalAgentLaunchExecution {
  plan: TerminalAgentLaunchPlan;
  result: TerminalAgentLaunchResult;
  message: string;
}

async function launchForProvider(
  plan: TerminalAgentLaunchPlan,
  context: { circleId?: string; userId?: string; visionArtifacts?: readonly ChatVisualBriefArtifact[] },
): Promise<TerminalAgentLaunchResult> {
  const visualContext = formatVisualBriefsForConnectedAgent(context.visionArtifacts);
  const prompts = plan.prompts.map((prompt) => {
    const promptWithVisualContext = visualContext ? `${prompt}\n\n${visualContext}` : prompt;
    return applyAgentDevelopmentStandardsToPrompt(promptWithVisualContext, {
      taskDescription: [promptWithVisualContext, plan.basePrompt || '', plan.raw].filter(Boolean).join('\n'),
      label: 'The launched terminal agent must follow these repo standards for this chat-launched task.',
    });
  });
  const input = {
    count: plan.count,
    prompts,
    names: plan.names,
    useWorktree: plan.useWorktree,
    circleId: context.circleId,
    userId: context.userId,
  };

  if (plan.provider === 'claude-code') return launchClaudeCodeSessions(input);
  if (plan.provider === 'codex') return launchCodexSessions(input);
  if (plan.provider === 'cursor') return launchCursorComposerSessions(input);
  return launchGeminiCliSessions(input);
}

export async function executeTerminalAgentLaunchFromChat(
  message: string,
  context: { circleId?: string; userId?: string; visionArtifacts?: readonly ChatVisualBriefArtifact[] },
): Promise<TerminalAgentLaunchExecution | null> {
  const plan = parseTerminalAgentLaunchRequest(message);
  if (!plan) return null;
  const result = await launchForProvider(plan, context);
  return { plan, result, message: formatTerminalAgentLaunchResponse(plan, result) };
}
