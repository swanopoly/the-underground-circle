/**
 * marketplaceToolTierPolicy — "break the model wall" tier decision (PURE).
 *
 * Phase 2 (item 2.2): today the SwanBot Tier 1.5 marketplace path sends
 * OpenRouter/HF/Groq/etc. models a TOOL-LESS text turn via `llm-proxy`, even
 * when the user asked for an action ("list my open tabs"). But the edge relay
 * already executes tools for marketplace models (client `executeToolUseLoop`
 * -> swanbot-ai relay branch -> `callMarketplaceProviderWithTools`). This
 * module decides, for one marketplace turn, which tier it should run on:
 *
 *   - 'relay_tool_loop'   — the selected marketplace model is tool-capable AND
 *                           the turn is action-shaped: run the EXISTING
 *                           `executeToolUseLoop` with the marketplace model so
 *                           the edge relay executes real tools (all v1
 *                           reliability layers apply automatically).
 *   - 'delegate_executor' — the turn is action-shaped but the selected model
 *                           cannot call tools (or is unknown — fail closed):
 *                           run the tool loop on a reliable Claude executor
 *                           (`claude-sonnet-4-6`, mirroring
 *                           modelCollaborationPolicy's SAFE_DEFAULT_MODEL) and
 *                           tell the user "<selected> plans, <executor>
 *                           executes" — never enter Anthropic silently.
 *   - 'plain_text'        — conversational turn, or the runtime flag is off:
 *                           keep today's tool-less `llm-proxy` text behavior
 *                           byte-identical.
 *
 * Action-shape REUSES the existing detectors (no new taxonomy):
 *   - `decideChatOrchestration` from `aiFirstChatPolicy` (capability families +
 *     the planner-grounded generic action verbs), and
 *   - `looksLikeTerminalActionRequest` from `chatTerminalTransportPolicy`
 *     (ACTION_INTENT_RE + local computer awareness, so "list my open tabs"
 *     counts as an action).
 *
 * Capability truth comes from `modelCapabilities.getModelCapabilityFlags`,
 * which fails closed (unknown model ids => toolUse:false), so an unknown
 * marketplace id can NEVER be routed onto the relay tool loop.
 *
 * Purity: dependency-light, tsx/esbuild-loadable (no react-native, no
 * supabase, no network). Smoke: `scripts/marketplace-tool-tier-smoketest.ts`.
 */

import { decideChatOrchestration } from './aiFirstChatPolicy';
import { looksLikeTerminalActionRequest } from './chatTerminalTransportPolicy';
import { getModelCapabilityFlags } from './modelCapabilities';

// ─── Runtime flag (DEFAULT OFF until a logged runtime proof exists) ──────────
//
// Follows the `chatTerminalTransportPolicy.ts` flag pattern exactly (storage
// key + native runtime override), but with the OPPOSITE default: OFF.
//
// Plan discipline: this stays DEFAULT OFF until a real runtime proof is logged.
// Proof recipe: pick an OpenRouter model in chat, send "list my open tabs",
// and confirm a REAL tool event lands in `agent_run_events` (relay round-trip
// through swanbot-ai `callMarketplaceProviderWithTools`). Once that proof is
// recorded, the default may flip ON in its own change.
//
// Opt in:
//   - web: localStorage.setItem('uc_marketplace_tool_loop', '1')  ('true'/'on')
//   - native (no localStorage): call `setMarketplaceToolLoopOverride(true)` at
//     startup — the runtime override is checked BEFORE storage.
export const MARKETPLACE_TOOL_LOOP_FLAG = 'uc_marketplace_tool_loop';

// Runtime override so surfaces without localStorage (native) can opt in/out.
// `null` = no override (fall through to storage, then the OFF default). Not
// persisted — a caller that wants a durable native opt-in must re-apply it at
// startup.
let marketplaceToolLoopOverride: boolean | null = null;

export function setMarketplaceToolLoopOverride(value: boolean | null): void {
  marketplaceToolLoopOverride = value;
}

export function isMarketplaceToolLoopEnabled(): boolean {
  // Precedence: runtime override (native path) → localStorage opt-in
  // ('1'/'true'/'on') → default OFF (no runtime proof logged yet).
  if (marketplaceToolLoopOverride !== null) return marketplaceToolLoopOverride;
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(MARKETPLACE_TOOL_LOOP_FLAG);
    if (value === '1' || value === 'true' || value === 'on') return true;
  } catch { /* storage unavailable (native) → default OFF unless overridden */ }
  return false;
}

// ─── Tier decision ────────────────────────────────────────────────────────────

export type MarketplaceToolTier = 'relay_tool_loop' | 'plain_text' | 'delegate_executor';

/**
 * The reliable tool executor for marketplace models that can't call tools.
 * Mirrors `modelCollaborationPolicy`'s SAFE_DEFAULT_MODEL (the concrete
 * fail-safe Claude id its collaboration plans resolve to) so the "selected
 * model plans, executor executes" arrangement matches the collaboration
 * policy's executor choice. Centralized here so a new executor only changes in
 * one place.
 */
export const MARKETPLACE_TOOL_EXECUTOR_MODEL_ID = 'claude-sonnet-4-6';

export interface MarketplaceToolTierDecision {
  tier: MarketplaceToolTier;
  /** Short human-readable reason (telemetry-safe, no secrets). */
  reason: string;
  /** Present only for 'delegate_executor': the reliable Claude executor id. */
  executorModelId?: string;
}

export interface MarketplaceToolTierInput {
  /** The selected marketplace model id (provider-prefixed or raw). */
  modelId: string;
  /** The raw user message for this turn. */
  message: string;
  /**
   * Explicit flag override. When omitted, the live
   * `MARKETPLACE_TOOL_LOOP_FLAG` reader decides (DEFAULT OFF). Smoke tests and
   * callers that already resolved the flag pass an explicit boolean.
   */
  flagEnabled?: boolean;
}

/**
 * True when the turn is action-shaped per the EXISTING detectors — the
 * aiFirstChatPolicy orchestration decision (anything above 'plain_model') or
 * the terminal transport action detector (ACTION_INTENT_RE + local computer
 * awareness). Defensive: a detector throwing counts as "not action-shaped"
 * (fails toward the cheaper plain-text tier).
 */
export function isMarketplaceTurnActionShaped(message: string): boolean {
  const text = String(message ?? '');
  if (!text.trim()) return false;
  let orchestrated = false;
  try {
    orchestrated = decideChatOrchestration({ message: text }).tier !== 'plain_model';
  } catch { orchestrated = false; }
  if (orchestrated) return true;
  try {
    return looksLikeTerminalActionRequest(text) === true;
  } catch { return false; }
}

/**
 * Decide which tier one marketplace chat turn runs on. See the module doc for
 * the three tiers. Fail-closed properties:
 *   - flag off (the default) => 'plain_text' — today's behavior, byte-identical;
 *   - unknown model id => toolUse:false => NEVER 'relay_tool_loop';
 *   - non-action turn => 'plain_text' (no tool loop cost for chat).
 */
export function decideMarketplaceToolTier(input: MarketplaceToolTierInput): MarketplaceToolTierDecision {
  const flagEnabled = input?.flagEnabled ?? isMarketplaceToolLoopEnabled();
  if (!flagEnabled) {
    return {
      tier: 'plain_text',
      reason: 'Marketplace tool-loop flag is off (default) — tool-less llm-proxy text tier, legacy behavior.',
    };
  }
  const modelId = String(input?.modelId ?? '');
  if (!isMarketplaceTurnActionShaped(String(input?.message ?? ''))) {
    return {
      tier: 'plain_text',
      reason: 'Conversational turn — plain marketplace text answer, no tool loop needed.',
    };
  }
  const flags = getModelCapabilityFlags(modelId);
  if (flags.toolUse) {
    return {
      tier: 'relay_tool_loop',
      reason: `Action-shaped turn and ${modelId || 'the selected model'} supports tool use — run the existing tool loop through the edge marketplace relay.`,
    };
  }
  return {
    tier: 'delegate_executor',
    executorModelId: MARKETPLACE_TOOL_EXECUTOR_MODEL_ID,
    reason: `Action-shaped turn but ${modelId || 'the selected model'} cannot call tools (or is unknown — fail closed) — ${MARKETPLACE_TOOL_EXECUTOR_MODEL_ID} executes the tool loop with a visible notice.`,
  };
}

// ─── llm-proxy tool-call escalation (consumer side of agent 2.4) ─────────────

/** The optional tool-call shape `llm-proxy` may return (agent 2.4). Defensive:
 *  every field may be missing/malformed on the wire. */
export interface LlmProxyToolCall {
  id?: unknown;
  name?: unknown;
  /** JSON string or already-parsed object, provider-dependent. */
  arguments?: unknown;
}

/** Bound how many proxy tool calls we convert — a runaway provider response
 *  must not balloon the escalated turn (persisted payloads stay bounded). */
const MAX_PROXY_TOOL_CALLS = 8;

/**
 * True when a plain-text marketplace proxy response that carried `toolCalls`
 * should be treated as an escalation trigger into the existing
 * stream->escalate seam (`maybeEscalateStreamedTurnToToolLoop`) instead of
 * rendering the raw text. Requires ALL of:
 *   - the marketplace tool-loop flag ON (default OFF),
 *   - at least one well-enough-formed tool call (a non-empty name),
 *   - the selected model id resolving toolUse:true (unknown ids fail closed —
 *     never escalate onto the relay for a model we can't vouch for).
 */
export function shouldEscalateProxyToolCalls(input: {
  modelId: string;
  toolCalls: unknown;
  flagEnabled?: boolean;
}): boolean {
  const flagEnabled = input?.flagEnabled ?? isMarketplaceToolLoopEnabled();
  if (!flagEnabled) return false;
  if (proxyToolCallsToAnthropicContent(input?.toolCalls).length === 0) return false;
  return getModelCapabilityFlags(String(input?.modelId ?? '')).toolUse === true;
}

/**
 * Convert `llm-proxy` toolCalls into Anthropic-shaped `tool_use` content
 * blocks, the shape `detectStreamedTurnToolUseIntent` /
 * `maybeEscalateStreamedTurnToToolLoop` consume as the streamed turn's
 * terminal content. Defensive against malformed entries (skipped) and JSON
 * string arguments (parsed; unparseable => {}). Bounded to
 * `MAX_PROXY_TOOL_CALLS`.
 */
export function proxyToolCallsToAnthropicContent(
  toolCalls: unknown,
): Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> {
  if (!Array.isArray(toolCalls)) return [];
  const blocks: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
  for (const raw of toolCalls) {
    if (blocks.length >= MAX_PROXY_TOOL_CALLS) break;
    const call = raw as LlmProxyToolCall | null;
    const name = typeof call?.name === 'string' ? call.name.trim() : '';
    if (!name) continue;
    let input: Record<string, unknown> = {};
    const args = call?.arguments;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      input = args as Record<string, unknown>;
    } else if (typeof args === 'string' && args.trim()) {
      try {
        const parsed = JSON.parse(args);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
      } catch { input = {}; }
    }
    const id = typeof call?.id === 'string' && call.id.trim()
      ? call.id.trim()
      : `proxy_tool_${blocks.length}`;
    blocks.push({ type: 'tool_use', id, name, input });
  }
  return blocks;
}

/**
 * The single short visible notice line for the 'delegate_executor'
 * arrangement — "<selected model> plans, <executor> executes." Kept here so
 * chat surfaces and smoke tests share the exact wording. Prepend it (plus a
 * blank line) to the executor loop's response.
 */
export function buildDelegateExecutorNotice(selectedModelId: string, executorModelId: string): string {
  const selected = String(selectedModelId ?? '').trim() || 'Selected model';
  const executor = String(executorModelId ?? '').trim() || MARKETPLACE_TOOL_EXECUTOR_MODEL_ID;
  return `${selected} plans, ${executor} executes.`;
}
