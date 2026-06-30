import type { ChatAutomationExecutionKind } from './chatAutomationPlanner';
import { looksLikeLocalComputerAwarenessRequest } from './localComputerAwarenessIntent';

export type ChatTerminalTransportPath =
  | 'specialized_agent_run'
  | 'stream_plain_chat'
  // Phase 2 seam (DEFAULT OFF): stream the turn plainly AND carry a tiny pinned
  // core + `tools.search` so the model can signal mid-turn that it needs a
  // capability. On that signal the caller upgrades THIS turn into the batch
  // OpenSwan tool loop. While the STREAM_ESCALATE_ON_TOOL_USE flag is OFF this
  // path is never produced and `stream_plain_chat` is returned unchanged.
  | 'stream_then_escalate'
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
  | 'simple_streamable_plain_chat'
  | 'stream_escalate_on_tool_use';

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
  /**
   * Phase 2 seam override (DEFAULT OFF). When omitted, the live
   * `STREAM_ESCALATE_ON_TOOL_USE_FLAG` flag decides. Pass an explicit boolean
   * to force the decision deterministically (used by smoke tests and any caller
   * that already resolved the flag). When the effective value is `false`, the
   * simple-streamable turn returns the legacy `stream_plain_chat` decision
   * unchanged; when `true`, it returns the escalation-capable
   * `stream_then_escalate` path so the caller carries the pinned core +
   * `tools.search` and upgrades the turn on a tool_use signal.
   */
  streamEscalateOnToolUse?: boolean;
};

/**
 * Loose detector for messages that probably need tool use.
 *
 * The streaming fast path has no tool catalog. False positives are cheap
 * because they only choose the batch OpenSwan path for one turn; false
 * negatives leave BlackSwan unable to run the tool the user asked for.
 */
const ACTION_INTENT_RE = /\b(create|make|add|new|start|run|call|invoke|rename|archive|unarchive|update|change|edit|set|toggle|pause|resume|raise|lower|bump|assign|unassign|remove|delete|pin|unpin|forget|log|mark|complete|switch|connect|disconnect|list|show|post|send)\b[^\n]{0,60}?\b(room|rooms|circle|agent|agent'?s?|mission|missions|task|tasks|memory|memories|automation|automations|automations?|check[\s-]?in|check[\s-]?ins|budget|cap|caps|theme|setting|settings|name|description|icon|vibe|spirit|appearance|public|private|accent|schedule|integration|integrations|custom\s+api|api\s+actions?|rest\s+api|http\s+api|apis?|endpoints?|webhooks?|connectors?)\b/i;

export function looksLikeTerminalActionRequest(message: string): boolean {
  return ACTION_INTENT_RE.test(message) || looksLikeLocalComputerAwarenessRequest(message);
}

// ─── Phase 2: stream-by-default → escalate-on-tool-use (DEFAULT OFF) ─────────
//
// AI-models-first: a normal chat turn should stream plainly and fast. The plain
// streaming turn carries only a tiny pinned core + `tools.search`, so the moment
// the model wants a real capability it can emit a `tool_use` (or stop with a
// tool-use intent). On that signal the caller upgrades THAT turn into the batch
// OpenSwan tool loop ("then it activates swanbot/openswan").
//
// This is not runtime-proven yet, so it ships DARK behind a DEFAULT-OFF flag and
// is instantly revertible. While OFF, `chooseChatTerminalTransport` is
// byte-for-byte the legacy decision: the simple-streamable branch keeps
// returning `stream_plain_chat`/`simple_streamable_plain_chat` and no
// `stream_then_escalate` decision is ever produced. The flag follows the same
// idiom as the OpenSwan typed-core / tools-first flags (localStorage opt-in;
// native has no localStorage → try/catch leaves the default OFF).
export const STREAM_ESCALATE_ON_TOOL_USE_FLAG = 'uc_stream_escalate_on_tool_use';

export function isStreamEscalateOnToolUseEnabled(): boolean {
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(STREAM_ESCALATE_ON_TOOL_USE_FLAG);
    if (value === '1' || value === 'true' || value === 'on') return true;
  } catch { /* storage unavailable (native) → default OFF */ }
  return false;
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

  // Simple, streamable, non-action chat. DEFAULT path is the legacy plain
  // stream (no tool catalog). Only when the Phase 2 flag is explicitly ON does
  // this same turn become escalation-capable: it still streams (`canStream:
  // true`) but carries a tiny pinned core + `tools.search` so a tool_use signal
  // can upgrade THIS turn into the batch OpenSwan tool loop. OFF ⇒ byte-for-byte
  // the previous `stream_plain_chat` / `simple_streamable_plain_chat` decision.
  const escalateOnToolUse = input.streamEscalateOnToolUse ?? isStreamEscalateOnToolUseEnabled();
  if (escalateOnToolUse) {
    return { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true };
  }

  return { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true };
}
