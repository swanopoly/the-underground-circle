/**
 * agentSystemPrompt — composes the Claude system prompt in a way that plays
 * well with prompt caching.
 *
 * Anthropic's Messages API accepts `system` as either a plain string or an
 * array of blocks. When using an array, individual blocks can carry
 * `cache_control: { type: 'ephemeral' }` to be cached across calls. The
 * frozen block (circle snapshot, skill metadata table, mode contract) is
 * stable across turns → cache it. The volatile block (last 30 messages,
 * current user id, now-timestamp) changes every turn → DO NOT cache it.
 *
 * This file returns the `AnthropicSystemBlock[]` shape that
 * `createAnthropicProvider({ system })` accepts directly.
 *
 * Splitting this out of both `swanbot-ai/index.ts` and
 * `openswanSessionRuntime.ts` prevents the old bug where the cache-control
 * markers drifted between the two surfaces and neither got cache hits.
 */

import type { AnthropicSystemBlock } from './agentProviders/anthropic';
import { buildOpenSwanModeResponseContract, type OpenSwanChatMode } from './openswanModePolicy';

export type BuildSystemPromptOptions = {
  /**
   * Stable identity + circle context. Cached. Include: agent persona,
   * circle snapshot, mission schema, skill metadata table, HITL rules.
   * Avoid: any timestamp, any member-specific id, anything changing per
   * turn.
   */
  frozen: string;
  /**
   * Per-turn volatile context. Not cached. Include: current timestamp,
   * last N messages summary, active user id, active mission id, mode +
   * profile routing hints.
   */
  volatile?: string;
  /** Optional mode — if provided, its response contract is appended to the frozen block. */
  mode?: OpenSwanChatMode | string | null;
  /**
   * Extra frozen sections (e.g. a SKILL.md metadata table once Phase 2
   * lands). Concatenated in order, still part of the cached block.
   */
  extraFrozen?: string[];
};

export function buildAgentSystemPrompt(opts: BuildSystemPromptOptions): AnthropicSystemBlock[] {
  const frozenParts: string[] = [opts.frozen];

  if (opts.mode) {
    const contract = buildOpenSwanModeResponseContract(opts.mode);
    if (contract) frozenParts.push(contract);
  }

  if (opts.extraFrozen?.length) {
    for (const section of opts.extraFrozen) {
      if (section && section.trim().length > 0) frozenParts.push(section);
    }
  }

  const blocks: AnthropicSystemBlock[] = [
    {
      type: 'text',
      text: frozenParts.join('\n\n'),
      cache_control: { type: 'ephemeral' },
    },
  ];

  if (opts.volatile && opts.volatile.trim().length > 0) {
    blocks.push({ type: 'text', text: opts.volatile });
  }

  return blocks;
}

/** Convenience — string form for callers that haven't moved to the array API yet. */
export function buildAgentSystemPromptString(opts: BuildSystemPromptOptions): string {
  return buildAgentSystemPrompt(opts)
    .map((b) => b.text)
    .join('\n\n');
}
