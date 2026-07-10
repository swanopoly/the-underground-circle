/**
 * AnthropicProvider — adapts Anthropic's Messages API to the AgentProvider
 * interface consumed by AgentExecutionCore.
 *
 * Works in any JS runtime that has `fetch` + `TextDecoder` (Node 18+, Deno,
 * browser, Expo web). The edge function (`supabase/functions/swanbot-ai`)
 * and the in-app gateway (`openswanService`) will both consume this.
 *
 * Supports:
 *   - Tool definitions passed through as `tools: [...]` on the request.
 *   - Prompt caching via `cache_control: { type: 'ephemeral' }` markers on
 *     system-prompt blocks (frozen block cached, volatile block uncached).
 *   - Non-streaming mode (sync request/response) for now. Streaming over
 *     SSE is planned in Phase 1c — the provider interface already exposes
 *     `onDelta` so the loop is future-compatible.
 *
 * Error handling:
 *   - Network or HTTP errors throw, consistent with the AgentProvider
 *     contract (the core catches tool handler errors; provider errors are
 *     legitimate fails and should bubble).
 *   - Tool-side errors are returned as `tool_result` blocks with
 *     `is_error: true` — the model sees them and can recover.
 */

import type {
  AgentMessage,
  AgentMessageContentBlock,
  AgentProvider,
  AgentToolDefinition,
  ProviderTurnResult,
} from '../agentExecutionCore';

export type AnthropicModelId =
  | 'claude-opus-4-7'
  | 'claude-opus-4-7-20260401'
  | 'claude-sonnet-4-6'
  | 'claude-sonnet-4-6-20260301'
  | 'claude-haiku-4-5-20251001'
  | 'claude-haiku-4-5';

export type AnthropicProviderOptions = {
  apiKey: string;
  model: AnthropicModelId | string;
  /** Max tokens per turn. Default 2048. */
  maxTokens?: number;
  /** Optional explicit API version header. */
  apiVersion?: string;
  /** Override the base URL for proxies / staging. Trailing slash tolerated. */
  baseUrl?: string;
  /**
   * System prompt. Can be a plain string (legacy) OR an array of content
   * blocks — use the array form when you want to cache the frozen block:
   *   [
   *     { type: 'text', text: FROZEN_BLOCK, cache_control: { type: 'ephemeral' } },
   *     { type: 'text', text: VOLATILE_BLOCK },
   *   ]
   */
  system?: string | AnthropicSystemBlock[];
  /** Default temperature. Default 0.7. */
  temperature?: number;
  /** Optional extra fetch options (e.g. signal). */
  fetch?: typeof fetch;
};

export type AnthropicSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
};

const DEFAULT_API_VERSION = '2023-06-01';
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export function createAnthropicProvider(opts: AnthropicProviderOptions): AgentProvider {
  const {
    apiKey, model,
    maxTokens = 2048,
    apiVersion = DEFAULT_API_VERSION,
    baseUrl = DEFAULT_BASE_URL,
    system,
    temperature = 0.7,
    fetch: fetchImpl = fetch,
  } = opts;

  if (!apiKey) throw new Error('createAnthropicProvider: apiKey is required');
  if (!model)  throw new Error('createAnthropicProvider: model is required');

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  return {
    async turn({ messages, tools }) {
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        temperature,
        messages: messages
          // Anthropic doesn't accept role=system in the messages array — that
          // moves into the top-level `system` field below.
          .filter((m) => m.role !== 'system')
          .map(toAnthropicMessage),
        tools: toolsToAnthropic(tools),
      };
      if (system !== undefined) body.system = system;

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': apiVersion,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await safeReadText(res);
        throw new Error(`Anthropic API ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return parseAnthropicResponse(data);
    },
  };
}

// ─── Conversions ────────────────────────────────────────────────────────────

function toAnthropicMessage(m: AgentMessage) {
  if (typeof m.content === 'string') {
    return { role: m.role, content: m.content };
  }
  return {
    role: m.role,
    content: m.content.map(toAnthropicBlock),
  };
}

function toAnthropicBlock(block: AgentMessageContentBlock) {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'tool_use') {
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
  }
  // tool_result
  return {
    type: 'tool_result',
    tool_use_id: block.tool_use_id,
    content: block.content,
    ...(block.is_error ? { is_error: true } : {}),
  };
}

function toolsToAnthropic(tools: AgentToolDefinition[]) {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
    // X4 (P47): forward curated input_examples when present (GA, no header).
    ...(t.input_examples ? { input_examples: t.input_examples } : {}),
  }));
}

export function parseAnthropicResponse(data: unknown): ProviderTurnResult {
  // Defensive parse — Anthropic can tweak response shapes; we validate
  // what we need and ignore extras.
  const d = data as any;
  const rawContent: unknown[] = Array.isArray(d?.content) ? d.content : [];
  const content: AgentMessageContentBlock[] = [];
  for (const b of rawContent) {
    const blk = b as any;
    if (blk?.type === 'text' && typeof blk.text === 'string') {
      content.push({ type: 'text', text: blk.text });
    } else if (blk?.type === 'tool_use' && typeof blk.id === 'string' && typeof blk.name === 'string') {
      content.push({ type: 'tool_use', id: blk.id, name: blk.name, input: blk.input ?? {} });
    }
    // tool_result blocks never appear on the assistant side; skip anything else.
  }
  const stop_reason = normalizeStopReason(d?.stop_reason);
  const usage = d?.usage
    ? {
        input_tokens: d.usage.input_tokens,
        output_tokens: d.usage.output_tokens,
        cache_read_input_tokens: d.usage.cache_read_input_tokens,
        cache_creation_input_tokens: d.usage.cache_creation_input_tokens,
      }
    : undefined;
  return { stop_reason, content, usage };
}

function normalizeStopReason(reason: unknown): ProviderTurnResult['stop_reason'] {
  if (reason === 'tool_use' || reason === 'end_turn' || reason === 'max_tokens' || reason === 'stop_sequence') {
    return reason;
  }
  // Fallback: treat unknown stop reasons as end_turn so the loop terminates.
  return 'end_turn';
}

async function safeReadText(res: Response): Promise<string> {
  try { return await res.text(); }
  catch { return '<unreadable body>'; }
}
