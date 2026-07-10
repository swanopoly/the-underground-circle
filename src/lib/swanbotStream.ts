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
 * Why a stream ended.
 *
 *   - `complete`    — the server emitted a terminal `done` SSE event. All
 *                     deltas that were going to arrive did. Safe to treat the
 *                     accumulated text as the whole answer.
 *   - `interrupted` — the feed stopped WITHOUT a terminal `done` event: a
 *                     mid-stream `error` event, a broken pipe / thrown read
 *                     error, or the socket closed (EOF) before `message_stop`.
 *                     The accumulated text is a PARTIAL answer and must not be
 *                     treated as complete.
 *
 * A mid-stream failure that arrives AFTER the 200 SSE handshake does NOT follow
 * the SDK's standard pre-200 retry — the partial bytes are already emitted and
 * can't be un-emitted. So this layer never silently retries the stream; it
 * surfaces `interrupted` and lets the caller fall back (non-streamed retry /
 * stream-then-escalate) with the interruption made explicit.
 */
export type StreamTerminalStatus = 'complete' | 'interrupted';

/** Discriminates how an `interrupted` stream failed, for caller telemetry. */
export type StreamInterruptReason =
  | 'error_event'    // server sent an `error` SSE event mid-stream
  | 'broken_pipe'    // read threw / network dropped after the handshake
  | 'truncated';     // socket closed (EOF) with no terminal `done` event

/**
 * The terminal result of a stream. Delivered additively: passed to `onDone(...)`
 * and resolved by `StreamHandle.done`. Carries the tool_use blocks reassembled
 * from the SSE feed plus the turn's `stop_reason`, so the stream→tool escalation
 * seam (see `maybeEscalateStreamedTurnToToolLoop`) can decide whether to upgrade
 * the streamed turn into the OpenSwan tool loop. Text-only turns leave `toolUses`
 * empty and `stopReason` whatever the server reported (typically `end_turn`).
 *
 * `status` / `incomplete` are the mid-stream-resilience contract: a clean end
 * is `status:'complete'` / `incomplete:false`; a feed that dropped after partial
 * output is `status:'interrupted'` / `incomplete:true` (with `interruptReason`).
 * Existing callers that read only `toolUses`/`stopReason` are unaffected.
 */
export interface StreamChatResult {
  toolUses: StreamToolUse[];
  stopReason: string | null;
  /** How the stream ended. Defaults conceptually to `complete` on a clean done. */
  status: StreamTerminalStatus;
  /** `true` iff `status === 'interrupted'` — convenience flag for callers. */
  incomplete: boolean;
  /** Set only when `status === 'interrupted'`; why the feed dropped. */
  interruptReason?: StreamInterruptReason;
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
   * Fired once on a CLEAN completion (`status:'complete'`). Receives the
   * terminal result additively; existing callers that ignore the argument are
   * unaffected. An interrupted stream fires `onError` instead of `onDone` so
   * callers that treat `onDone` as "the answer is whole" stay correct.
   */
  onDone: (result?: StreamChatResult) => void;
  /**
   * Fired on any failure — including a mid-stream interruption AFTER partial
   * text was already delivered via `onDelta`. The optional second argument
   * carries the interrupted terminal result (partial `toolUses`/`stopReason`,
   * `incomplete:true`) so a caller can inspect what it got before falling back.
   * Existing callers that take only `message` are unaffected.
   */
  onError: (message: string, result?: StreamChatResult) => void;
}

export interface StreamHandle {
  cancel: () => void;
  /**
   * Resolves when the stream reaches a terminal state:
   *   - clean end → the `complete` result;
   *   - mid-stream interruption after partial output → the `interrupted`
   *     result (`incomplete:true`) so a `done`-only caller can still tell a
   *     truncated answer from a whole one without racing `onError`;
   *   - cancellation → `null`.
   * Additive — existing callers can keep using `cancel`/`onDone`/`onError`.
   */
  done: Promise<StreamChatResult | null>;
}

/**
 * The kind of terminal signal the SSE reader observed. Pure input to
 * {@link classifyStreamTermination} — kept dependency-free so the resilience
 * smoke can mirror the exact contract (the runtime module itself can't be
 * imported under tsx because it pulls in the RN Supabase client).
 *
 *   - `done_event`   — a terminal `done` SSE event arrived (clean end).
 *   - `error_event`  — an `error` SSE event arrived mid-stream.
 *   - `eof_no_done`  — reader hit EOF before any terminal `done` event.
 *   - `read_threw`   — a read threw / the pipe broke after the handshake.
 */
export type StreamTerminationSignal = 'done_event' | 'error_event' | 'eof_no_done' | 'read_threw';

/**
 * Pure terminal-state classifier — the single source of truth for the
 * mid-stream-resilience contract. A `done_event` is the ONLY clean completion;
 * every other terminal signal is an interruption that leaves partial output on
 * screen, so it is NEVER treated as complete and NEVER auto-retried by this
 * layer. `sawAnyOutput` only refines the interrupt reason for a thrown read
 * (broken pipe vs. truncated), never the complete/interrupted verdict.
 */
export function classifyStreamTermination(
  signal: StreamTerminationSignal,
  sawAnyOutput: boolean,
): { status: StreamTerminalStatus; interruptReason?: StreamInterruptReason } {
  switch (signal) {
    case 'done_event':
      return { status: 'complete' };
    case 'error_event':
      return { status: 'interrupted', interruptReason: 'error_event' };
    case 'eof_no_done':
      return { status: 'interrupted', interruptReason: 'truncated' };
    case 'read_threw':
      return { status: 'interrupted', interruptReason: sawAnyOutput ? 'broken_pipe' : 'truncated' };
  }
}

/** Build the additive {@link StreamChatResult} for a classified termination. */
export function buildStreamResult(
  classification: { status: StreamTerminalStatus; interruptReason?: StreamInterruptReason },
  fields: { toolUses: StreamToolUse[]; stopReason: string | null },
): StreamChatResult {
  return {
    toolUses: fields.toolUses,
    stopReason: fields.stopReason,
    status: classification.status,
    incomplete: classification.status === 'interrupted',
    ...(classification.interruptReason ? { interruptReason: classification.interruptReason } : {}),
  };
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
  // Whether we've delivered (or buffered) any assistant text. Distinguishes a
  // pre-output failure from an interruption that truncated a partial answer.
  let sawAnyOutput = false;
  // Terminal guard — the stream reaches exactly one terminal state. Prevents a
  // late read error / EOF from firing a second callback after `done`/`error`.
  let settled = false;

  let resolveDone: (result: StreamChatResult | null) => void;
  const donePromise = new Promise<StreamChatResult | null>((resolve) => {
    resolveDone = resolve;
  });

  /** Flush whatever coalesced text remains so a terminal state never drops it. */
  const flushCoalesced = () => {
    if (coalesceTimer) { clearTimeout(coalesceTimer); coalesceTimer = null; }
    if (coalesceBuf) { opts.onDelta(coalesceBuf); coalesceBuf = ''; }
  };

  /** Clean terminal: fire onDone + resolve with a `complete` result. Once. */
  const finishComplete = () => {
    if (settled) return;
    settled = true;
    flushCoalesced();
    const result = buildStreamResult(classifyStreamTermination('done_event', sawAnyOutput), { toolUses, stopReason });
    opts.onDone(result);
    resolveDone(result);
  };

  /**
   * Interrupted terminal: the feed dropped after the 200 handshake without a
   * clean `done`. Fire onError WITH the partial result (so the caller can fall
   * back), then resolve `done` with the interrupted result — NOT null and NOT
   * complete — so a `done`-only caller can also tell it was truncated. Never
   * auto-retries the stream: partial output is already on screen.
   */
  const finishInterrupted = (message: string, signal: Exclude<StreamTerminationSignal, 'done_event'>) => {
    if (settled) return;
    settled = true;
    flushCoalesced();
    const result = buildStreamResult(classifyStreamTermination(signal, sawAnyOutput), { toolUses, stopReason });
    opts.onError(message, result);
    resolveDone(result);
  };

  /**
   * Pre-handshake failure: request never reached (or was rejected before) the
   * 200 SSE handshake, so nothing was delivered. Fire onError and resolve
   * `done` to null — this is a clean failure, NOT a truncated partial answer,
   * and it's the layer the caller/SDK retries normally. Guarded so a later
   * terminal can't double-fire.
   */
  const finishPreStreamError = (message: string) => {
    if (settled) return;
    settled = true;
    opts.onError(message);
    resolveDone(null);
  };

  const run = async () => {
    if (shouldBlockExternalAiProvider('anthropic')) {
      finishPreStreamError(getStrictLocalAiModeMessage('anthropic'));
      return;
    }
    // Get current session token for auth
    const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
    if (!session?.access_token) {
      finishPreStreamError('Not authenticated');
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
          finishPreStreamError(String(parsed.error || parsed.message || errText).slice(0, 300));
        } catch {
          finishPreStreamError(errText.slice(0, 300));
        }
        return;
      }

      if (!res.body) {
        finishPreStreamError('No response body — streaming not supported');
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
                sawAnyOutput = true;
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
                // Clean terminal. `finishComplete` flushes any remaining
                // coalesced text (same clear-timer-then-emit order as before),
                // fires onDone with a `complete` result, and resolves `done`.
                // Additive: capture stop_reason from the terminal event without
                // disturbing any existing `done` fields. Absent on text-only
                // turns from servers that don't emit it → stays null.
                if (typeof event.stop_reason === 'string') stopReason = event.stop_reason;
                finishComplete();
                return;
              }
              case 'error':
                // Mid-stream `error` event AFTER the 200 handshake. The partial
                // output already rendered can't be un-emitted, so we do NOT
                // retry the stream here — we surface an interruption and let the
                // caller fall back (non-streamed retry / escalate).
                finishInterrupted(event.message || 'Stream error', 'error_event');
                return;
              default:
                // Unknown event type — ignore (forward-compatible with new
                // server events, same as the old switch's implicit fallthrough).
                break;
            }
          } catch { /* skip unparseable lines */ }
        }
      }

      // Reader signalled `done:true`. A clean end would have `return`ed from the
      // `done` case above and never reach here; reaching here uncancelled means
      // the socket closed BEFORE a terminal `done` event — a truncated feed.
      // Treat it as an interruption, NOT a silent complete, so the caller can
      // fall back instead of rendering a partial answer as whole.
      if (cancelled) {
        if (!settled) { settled = true; resolveDone(null); }
      } else {
        finishInterrupted('Stream ended before completion (no terminal event)', 'eof_no_done');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (!settled) { settled = true; resolveDone(null); }
        return;
      }
      // A read threw / the pipe broke mid-stream (after the handshake). Surface
      // it as an interruption carrying whatever partial result we have — never
      // auto-retry. classifyStreamTermination refines the reason from
      // `sawAnyOutput` (broken_pipe when output had started, else truncated).
      finishInterrupted(err?.message || 'Stream failed', 'read_threw');
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
