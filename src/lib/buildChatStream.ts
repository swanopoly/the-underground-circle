/**
 * buildChatStream — streaming chat responses for conversational-build turns.
 *
 * Uses the existing `chat-stream` edge function instead of `swanbot-ai` so:
 *   - tokens appear as Claude writes them (feels ~3-5× faster)
 *   - we skip the circle-context / wiki / memory bundles (none of that
 *     matters for a build clarifying question)
 *   - the <DIRECTIVE> is the full behavior spec, sent as system prompt
 *
 * Non-build chat still goes through `swanbot-ai` via `getSwanBotResponse`;
 * this module is strictly the build-conversation fast path.
 */

import { streamChatResponse, type StreamHandle } from './swanbotStream';
import { buildSystemAddendum, type BuildConversationState } from './conversationalBuild';

export interface BuildChatStreamOpts {
  userMessage: string;
  /** Recent conversation history. The streaming edge function only looks
   *  at the last few turns — we trim to 6 to keep prefill cheap. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Current build-conversation state — decides which directive text and
   *  which model to use. */
  buildState: Extract<BuildConversationState, 'exploring' | 'converging'>;
  /** Called for every coalesced text chunk (~word to sentence worth). */
  onDelta: (text: string) => void;
  /** Called with the full assistant text when the stream completes. */
  onDone: (fullText: string) => void;
  /** Called if the stream fails. */
  onError: (message: string) => void;
  /** Optional circle id for usage logging in the edge function. */
  circleId?: string;
}

export function streamBuildChat(opts: BuildChatStreamOpts): StreamHandle {
  const { userMessage, history, buildState, onDelta, onDone, onError, circleId } = opts;

  const system = buildSystemAddendum(buildState);

  // Pair exploring with Haiku for speed; converging with Opus for reasoning
  // depth. Matches the non-streaming adaptive router in serviceProfileSouls.
  const model = buildState === 'converging' ? 'claude-opus-4-7' : 'claude-haiku-4-5';

  // Keep the last 6 turns only — the directive carries all the behavior
  // rules. Extra history is just token bloat that slows prefill.
  const trimmedHistory = history.slice(-6);
  const messages: Array<{ role: string; content: string }> = [
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ];

  // Per-turn max-tokens budget. Exploring asks 2-3 sentences; converging
  // writes a brief paragraph + <BUILD_READY> JSON block.
  const maxTokens = buildState === 'converging' ? 3072 : 768;

  let accumulated = '';

  return streamChatResponse({
    messages,
    system,
    model,
    circleId,
    maxTokens,
    onDelta: (chunk) => {
      accumulated += chunk;
      onDelta(chunk);
    },
    onDone: () => onDone(accumulated),
    onError,
  });
}
