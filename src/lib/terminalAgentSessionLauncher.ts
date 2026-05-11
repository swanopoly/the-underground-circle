import { launchClaudeCodeSessions } from './claudeCodeDetector';
import { launchCodexSessions } from './codexDetector';
import { launchGeminiCliSessions } from './geminiCliDetector';
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
  context: { circleId?: string; userId?: string },
): Promise<TerminalAgentLaunchResult> {
  const input = {
    count: plan.count,
    prompts: plan.prompts,
    names: plan.names,
    circleId: context.circleId,
    userId: context.userId,
  };

  if (plan.provider === 'claude-code') return launchClaudeCodeSessions(input);
  if (plan.provider === 'codex') return launchCodexSessions(input);
  return launchGeminiCliSessions(input);
}

export async function executeTerminalAgentLaunchFromChat(
  message: string,
  context: { circleId?: string; userId?: string },
): Promise<TerminalAgentLaunchExecution | null> {
  const plan = parseTerminalAgentLaunchRequest(message);
  if (!plan) return null;
  const result = await launchForProvider(plan, context);
  return { plan, result, message: formatTerminalAgentLaunchResponse(plan, result) };
}
