import type { ChatAutomationExecutionKind } from './chatAutomationPlanner';
import { looksLikeLocalComputerAwarenessRequest } from './localComputerAwarenessIntent';

export type ChatTerminalTransportPath =
  | 'specialized_agent_run'
  | 'stream_plain_chat'
  | 'batch_plain_chat'
  // Phase 2 seam (DEFAULT ON since 2026-07-01): stream the turn plainly AND
  // carry a tiny pinned core + `tools.search` so the model can signal mid-turn
  // that it needs a capability. On that signal the caller upgrades THIS turn
  // into the batch OpenSwan tool loop. When the STREAM_ESCALATE_ON_TOOL_USE
  // seam is opted out this path is never produced and `stream_plain_chat` is
  // returned unchanged.
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
  | 'conversation_only_plain_chat'
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
   * A greeting/thanks/check-in with no substantive request. These turns must
   * stay on the selected text model and never advertise or enter tool lanes.
   */
  conversationOnly?: boolean;
  /**
   * Phase 2 seam override (the seam itself is DEFAULT ON). When omitted, the
   * live `STREAM_ESCALATE_ON_TOOL_USE_FLAG` flag decides. Pass an explicit boolean
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

// ─── Phase 2: stream-by-default → escalate-on-tool-use (DEFAULT ON) ──────────
//
// AI-models-first: a normal chat turn should stream plainly and fast. The plain
// streaming turn carries only a tiny pinned core + `tools.search`, so the moment
// the model wants a real capability it can emit a `tool_use` (or stop with a
// tool-use intent). On that signal the caller upgrades THAT turn into the batch
// OpenSwan tool loop ("then it activates swanbot/openswan").
//
// LIVE and DEFAULT ON since 2026-07-01 (user enabled), instantly revertible:
//   - web: set the localStorage key to '0' / 'false' / 'off';
//   - native (no localStorage): call `setStreamEscalateOnToolUseOverride(false)`
//     at startup — the runtime override is checked BEFORE storage.
// When opted out, `chooseChatTerminalTransport` is byte-for-byte the legacy
// decision: the simple-streamable branch returns
// `stream_plain_chat`/`simple_streamable_plain_chat` and no
// `stream_then_escalate` decision is ever produced.
export const STREAM_ESCALATE_ON_TOOL_USE_FLAG = 'uc_stream_escalate_on_tool_use';

// Runtime override so surfaces without localStorage (native) can opt out of the
// seam. `null` = no override (fall through to storage, then the ON default);
// `true`/`false` force the seam on/off for this JS runtime. Not persisted — a
// caller that wants a durable native opt-out must re-apply it at startup.
let streamEscalateOnToolUseOverride: boolean | null = null;

export function setStreamEscalateOnToolUseOverride(value: boolean | null): void {
  streamEscalateOnToolUseOverride = value;
}

export function isStreamEscalateOnToolUseEnabled(): boolean {
  // Precedence: runtime override (native opt-out path) → localStorage opt-out
  // ('0'/'false'/'off') → default ON (as of 2026-07-01, user enabled).
  if (streamEscalateOnToolUseOverride !== null) return streamEscalateOnToolUseOverride;
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(STREAM_ESCALATE_ON_TOOL_USE_FLAG);
    if (value === '0' || value === 'false' || value === 'off') return false;
  } catch { /* storage unavailable (native) → default ON unless overridden */ }
  return true;
}

export function chooseChatTerminalTransport(
  input: ChatTerminalTransportPolicyInput,
): ChatTerminalTransportDecision {
  // A conversational acknowledgement is not a task. Keep it away from the
  // OpenSwan escalation palette even while stream->tool escalation is enabled
  // globally. This veto deliberately outranks saved modes, parallel delegation,
  // recovery state, and planner residue from an earlier task. Non-streamable
  // selected models use the plain batch model path, not the batch OpenSwan task
  // runtime.
  if (input.conversationOnly) {
    return input.canStreamAnthropic
      ? { path: 'stream_plain_chat', reason: 'conversation_only_plain_chat', canStream: true }
      : { path: 'batch_plain_chat', reason: 'conversation_only_plain_chat', canStream: false };
  }

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
    // Transport capability must never expand execution authority. A turn the
    // canonical planner classified as plain Chat stays plain Chat when SSE is
    // unavailable; it simply uses the selected provider's batch endpoint.
    // Only the earlier explicit `run_openswan` branch may enter OpenSwan.
    return { path: 'batch_plain_chat', reason: 'stream_unavailable', canStream: false };
  }

  // Simple, streamable, non-action chat. With the Phase 2 seam ON (the default
  // since 2026-07-01) this turn is escalation-capable: it still streams
  // (`canStream: true`) but carries a tiny pinned core + `tools.search` so a
  // tool_use signal can upgrade THIS turn into the batch OpenSwan tool loop.
  // Opted out ⇒ byte-for-byte the legacy `stream_plain_chat` /
  // `simple_streamable_plain_chat` decision.
  const escalateOnToolUse = input.streamEscalateOnToolUse ?? isStreamEscalateOnToolUseEnabled();
  if (escalateOnToolUse) {
    return { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true };
  }

  return { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true };
}
