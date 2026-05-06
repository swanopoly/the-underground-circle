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

export interface StreamChatOpts {
  messages: Array<{ role: string; content: string }>;
  system?: string;
  model?: string;
  circleId?: string;
  maxTokens?: number;
  temperature?: number;
  onDelta: (text: string) => void;
  onUsage?: (usage: { model: string; input_tokens: number; output_tokens: number; total_tokens: number }) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export interface StreamHandle {
  cancel: () => void;
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

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === '[DONE]') continue;

          try {
            const event = JSON.parse(raw);
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
              case 'done':
                // Flush any remaining coalesced text
                if (coalesceTimer) clearTimeout(coalesceTimer);
                if (coalesceBuf) { opts.onDelta(coalesceBuf); coalesceBuf = ''; }
                opts.onDone();
                return;
              case 'error':
                opts.onError(event.message || 'Stream error');
                return;
            }
          } catch { /* skip unparseable lines */ }
        }
      }

      // If we exited the loop without a done event
      if (!cancelled) opts.onDone();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      opts.onError(err?.message || 'Stream failed');
    }
  };

  void run();

  return {
    cancel: () => {
      cancelled = true;
      controller.abort();
    },
  };
}
