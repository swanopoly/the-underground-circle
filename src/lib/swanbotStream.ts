/**
 * swanbotStream — Phase C2 UI client.
 *
 * Calls the `chat-stream` edge fn and yields token deltas via a callback.
 * Uses SwanClaw block coalescing: instead of firing onDelta for
 * every single token, we buffer chunks and flush at natural text breaks
 * (paragraph, newline, sentence). This prevents the jittery one-character-
 * at-a-time rendering on slow connections.
 *
 * Usage:
 *   const { cancel } = streamChatResponse({
 *     messages, system, model, circleId,
 *     onDelta: (text) => appendToBubble(text),
 *     onUsage: (usage) => setUsage(usage),
 *     onDone: () => markComplete(),
 *     onError: (msg) => showError(msg),
 *   });
 */

import { supabase } from './supabase';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

/** A reassembled `tool_use` content block emitted by the chat-stream SSE feed. */
export interface StreamToolUse {
  id: string;
  name: string;
  input: unknown;
}

/**
 * The terminal result of a stream. Delivered additively: passed to `onDone(...)`
 * and resolved by `StreamHandle.done`. Carries the tool_use blocks reassembled
 * from the SSE feed plus the turn's `stop_reason`, so the stream→tool escalation
 * seam (see `maybeEscalateStreamedTurnToToolLoop`) can decide whether to upgrade
 * the streamed turn into the OpenSwan tool loop. Text-only turns leave `toolUses`
 * empty and `stopReason` whatever the server reported (typically `end_turn`).
 */
export interface StreamChatResult {
  toolUses: StreamToolUse[];
  stopReason: string | null;
}

export interface StreamChatOpts {
  messages: Array<{ role: string; content: string }>;
  system?: string;
  model?: string;
  circleId?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Optional Anthropic tool definitions. When omitted/empty the request is
   * text-only and behavior is unchanged — all current callers send no tools.
   * When present, chat-stream forwards them (with `tool_choice`) to the
   * Anthropic messages stream and emits reassembled `tool_use` SSE events.
   */
  tools?: unknown[];
  /** Optional tool_choice forwarded alongside `tools` (server defaults to {type:'auto'}). */
  toolChoice?: unknown;
  onDelta: (text: string) => void;
  onUsage?: (usage: { model: string; input_tokens: number; output_tokens: number; total_tokens: number }) => void;
  /**
   * Fired once when the stream completes. Receives the terminal result
   * additively; existing callers that ignore the argument are unaffected.
   */
  onDone: (result?: StreamChatResult) => void;
  onError: (message: string) => void;
}

export interface StreamHandle {
  cancel: () => void;
  /**
   * Resolves with the terminal result when the stream completes successfully,
   * or `null` if it errored/was cancelled. Additive — existing callers can keep
   * using `cancel`/`onDone` and ignore this.
   */
  done: Promise<StreamChatResult | null>;
}

export function streamChatResponse(opts: StreamChatOpts): StreamHandle {
  const controller = new AbortController();
  let cancelled = false;

  // Block coalescing config — SwanClaw pattern
  const COALESCE_MIN = 8;     // min chars before flushing
  const COALESCE_MAX = 120;   // max chars before forced flush
  const COALESCE_IDLE_MS = 80; // ms of idle before flushing whatever we have
  let coalesceBuf = '';
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null;

  // Terminal-result accumulators. Collected from the additive `tool_use` SSE
  // events and the `stop_reason` field on the terminal `done` event. When no
  // tools were requested the server emits neither, so these stay empty/null and
  // the result is shaped exactly like a text-only turn.
  const toolUses: StreamToolUse[] = [];
  let stopReason: string | null = null;

  let resolveDone: (result: StreamChatResult | null) => void;
  const donePromise = new Promise<StreamChatResult | null>((resolve) => {
    resolveDone = resolve;
  });

  const run = async () => {
    if (shouldBlockExternalAiProvider('anthropic')) {
      opts.onError(getStrictLocalAiModeMessage('anthropic'));
      return;
    }
    // Get current session token for auth
    const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (!session?.access_token) {
      opts.onError('Not authenticated');
      return;
    }

    const url = `${SUPABASE_URL}/functions/v1/chat-stream`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages: opts.messages,
          system: opts.system,
          model: opts.model,
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          circleId: opts.circleId,
          // Additive: only present when the caller opts in. With no tools the
          // body is byte-identical to before, keeping every current caller
          // text-only. tool_choice rides along only when tools are sent
          // (server defaults it to {type:'auto'}).
          ...(opts.tools && opts.tools.length > 0
            ? { tools: opts.tools, ...(opts.toolChoice !== undefined ? { tool_choice: opts.toolChoice } : {}) }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        try {
          const parsed = JSON.parse(errText);
          opts.onError(String(parsed.error || parsed.message || errText).slice(0, 300));
        } catch {
          opts.onError(errText.slice(0, 300));
        }
        return;
      }

      if (!res.body) {
        opts.onError('No response body — streaming not supported');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      // Most recent SSE `event:` field, applied to the next `data:` line in the
      // same record. Only the additive `tool_use` event sets it.
      let sseEventName: string | null = null;

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          // Track the SSE `event:` field so we can discriminate the additive
          // `tool_use` event, whose `data:` payload ({id,name,input}) carries no
          // `type` field. Existing events (delta/usage/done/error) still key off
          // `event.type` below, so this only matters for the new branch.
          if (line.startsWith('event: ')) {
            sseEventName = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          // An SSE record ends at the blank line between blocks. Consume the
          // event name once per record so it can't leak onto a later data-only
          // line; capture it before the [DONE]/empty guards below.
          const recordEventName = sseEventName;
          sseEventName = null;
          if (!raw || raw === '[DONE]') continue;

          try {
            const event = JSON.parse(raw);
            // Additive: a reassembled tool_use content block. Identified by the
            // SSE `event: tool_use` line (the payload has no `type`). Collect
            // {id,name,input}; everything else is unchanged.
            if (recordEventName === 'tool_use' && event && event.type === undefined) {
              toolUses.push({ id: event.id, name: event.name, input: event.input });
              continue;
            }
            switch (event.type) {
              case 'delta': {
                // Block coalescing — buffer small chunks and flush at
                // natural breaks. Prevents jittery single-char renders.
                coalesceBuf += (event.text || '');
                if (coalesceTimer) clearTimeout(coalesceTimer);
                const shouldFlush = coalesceBuf.length >= COALESCE_MAX
                  || coalesceBuf.endsWith('\n\n')
                  || coalesceBuf.endsWith('. ')
                  || coalesceBuf.endsWith('.\n');
                if (shouldFlush && coalesceBuf.length >= COALESCE_MIN) {
                  opts.onDelta(coalesceBuf);
                  coalesceBuf = '';
                } else {
                  coalesceTimer = setTimeout(() => {
                    if (coalesceBuf) { opts.onDelta(coalesceBuf); coalesceBuf = ''; }
                  }, COALESCE_IDLE_MS);
                }
                break;
              }
              case 'usage':
                opts.onUsage?.(event.usage);
                break;
              case 'done': {
                // Flush any remaining coalesced text
                if (coalesceTimer) clearTimeout(coalesceTimer);
                if (coalesceBuf) { opts.onDelta(coalesceBuf); coalesceBuf = ''; }
                // Additive: capture stop_reason from the terminal event without
                // disturbing any existing `done` fields. Absent on text-only
                // turns from servers that don't emit it → stays null.
                if (typeof event.stop_reason === 'string') stopReason = event.stop_reason;
                const result: StreamChatResult = { toolUses, stopReason };
                opts.onDone(result);
                resolveDone(result);
                return;
              }
              case 'error':
                opts.onError(event.message || 'Stream error');
                resolveDone(null);
                return;
            }
          } catch { /* skip unparseable lines */ }
        }
      }

      // If we exited the loop without a done event
      if (!cancelled) {
        const result: StreamChatResult = { toolUses, stopReason };
        opts.onDone(result);
        resolveDone(result);
      } else {
        resolveDone(null);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') { resolveDone(null); return; }
      opts.onError(err?.message || 'Stream failed');
      resolveDone(null);
    }
  };

  void run();

  return {
    cancel: () => {
      cancelled = true;
      controller.abort();
    },
    done: donePromise,
  };
}
