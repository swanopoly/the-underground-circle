import type { ChatAutomationExecutionKind } from './chatAutomationPlanner';
import { looksLikeLocalComputerAwarenessRequest } from './localComputerAwarenessIntent';

export type ChatTerminalTransportPath =
  | 'specialized_agent_run'
  | 'stream_plain_chat'
  | 'batch_openswan';

export type ChatTerminalTransportReason =
  | 'selected_mode'
  | 'planner_forced_openswan'
  | 'parallel_delegation'
  | 'recovery_option'
  | 'figma_build'
  | 'coding_generation'
  | 'tool_catalog_required'
  | 'stream_unavailable'
  | 'simple_streamable_plain_chat';

export type ChatTerminalTransportDecision = {
  path: ChatTerminalTransportPath;
  reason: ChatTerminalTransportReason;
  canStream: boolean;
};

export type ChatTerminalTransportPolicyInput = {
  executionKind?: ChatAutomationExecutionKind | null;
  chatMode?: string | null;
  sessionDelegationMode?: string | null;
  hasSelectedRecoveryOption?: boolean;
  isFigmaBuildRequest?: boolean;
  isCodingGenerationRequest?: boolean;
  looksLikeActionRequest?: boolean;
  canStreamAnthropic?: boolean;
};

/**
 * Loose detector for messages that probably need tool use.
 *
 * The streaming fast path has no tool catalog. False positives are cheap
 * because they only choose the batch OpenSwan path for one turn; false
 * negatives leave BlackSwan unable to run the tool the user asked for.
 */
const ACTION_INTENT_RE = /\b(create|make|add|new|start|rename|archive|unarchive|update|change|edit|set|toggle|pause|resume|raise|lower|bump|assign|unassign|remove|delete|pin|unpin|forget|log|mark|complete|switch|connect|disconnect|list|show|post|send)\b[^\n]{0,60}?\b(room|rooms|circle|agent|agent'?s?|mission|missions|task|tasks|memory|memories|automation|automations|automations?|check[\s-]?in|check[\s-]?ins|budget|cap|caps|theme|setting|settings|name|description|icon|vibe|spirit|appearance|public|private|accent|schedule|integration|integrations)\b/i;

export function looksLikeTerminalActionRequest(message: string): boolean {
  return ACTION_INTENT_RE.test(message) || looksLikeLocalComputerAwarenessRequest(message);
}

export function chooseChatTerminalTransport(
  input: ChatTerminalTransportPolicyInput,
): ChatTerminalTransportDecision {
  const chatMode = input.chatMode || 'none';
  if (chatMode !== 'none' && chatMode !== 'talk') {
    return { path: 'specialized_agent_run', reason: 'selected_mode', canStream: false };
  }

  if (input.executionKind === 'run_openswan' && chatMode !== 'talk') {
    return { path: 'batch_openswan', reason: 'planner_forced_openswan', canStream: false };
  }

  if (input.sessionDelegationMode === 'parallel') {
    return { path: 'batch_openswan', reason: 'parallel_delegation', canStream: false };
  }

  if (input.hasSelectedRecoveryOption) {
    return { path: 'batch_openswan', reason: 'recovery_option', canStream: false };
  }

  if (input.isFigmaBuildRequest) {
    return { path: 'batch_openswan', reason: 'figma_build', canStream: false };
  }

  if (input.isCodingGenerationRequest) {
    return { path: 'batch_openswan', reason: 'coding_generation', canStream: false };
  }

  if (input.looksLikeActionRequest) {
    return { path: 'batch_openswan', reason: 'tool_catalog_required', canStream: false };
  }

  if (!input.canStreamAnthropic) {
    return { path: 'batch_openswan', reason: 'stream_unavailable', canStream: false };
  }

  return { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true };
}
