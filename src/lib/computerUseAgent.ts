/**
 * computerUseAgent — client helper for the `computer-use-agent` edge
 * function. Starts an autonomous browser task (Claude Opus 4.7 driving a
 * Browserbase session via Anthropic's native computer_use tool) and
 * streams the agent's actions, reasoning, screenshots, and final result
 * back via SSE.
 *
 * Usage:
 *   const { cancel } = startComputerUseAgent({
 *     task: "Research the top 5 espresso machines under $500 and summarize",
 *     circleId,
 *     browserbase: { apiKey, projectId },
 *     onAction: (a) => ...,
 *     onScreenshot: (s) => ...,
 *     onReasoning: (t) => ...,
 *     onResult: (r) => ...,
 *     onError: (e) => ...,
 *   });
 */

import { getFreshAccessToken } from './authSession';
import { shouldBlockExternalAiProvider, getStrictLocalAiModeMessage } from './privacyMode';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

export interface ComputerUseAgentOpts {
  task: string;
  circleId: string;
  userId?: string;
  model?: string | null;
  sessionId?: string;
  browserbase: { apiKey: string; projectId: string; region?: string };
  maxIterations?: number;
  maxTokensBudget?: number;
  /** Max USD cost for this run. Omit to defer to the circle setting / the
   *  edge default (booking-class runs default higher when `booking` is set). */
  maxCostUsd?: number;
  /** Booking-class flag. When true, the edge loop raises the run caps
   *  (iterations/tokens/cost/wall-clock) so a multi-leg checkout can finish.
   *  Non-booking runs are unchanged. */
  booking?: boolean;
  onRunStarted?: (info: { runId: string }) => void;
  onSessionStarted?: (info: { sessionId: string; liveUrl: string }) => void;
  /** Fired when the agent pauses for user approval via the `ask_user`
   *  tool. Client should render an inline card with the options and call
   *  `resolveComputerUseConfirmation(id, choice)` when the user picks. */
  onConfirmationRequired?: (info: {
    id: string | null;
    question: string;
    options: string[];
    context: string | null;
    timeoutSec: number;
  }) => void;
  /** Fired once the confirmation row is resolved (user picked, or the
   *  server timed out). Client should clear the pending card. */
  onConfirmationResolved?: (info: { id: string | null; choice: string }) => void;
  /** Mid-run steering note accepted by the loop (plan §4e/§5a) — fires when
   *  the note is injected at an iteration boundary, so the UI can show
   *  exactly when the user's guidance landed. */
  onSteeringApplied?: (info: { note: string }) => void;
  /** Running token / cost ticker. Fires once per Claude turn. The client
   *  uses it to show a live ticker so users know roughly how much the
   *  task has cost so far. `inputTokens` is the *total* input-side count
   *  (uncached + cache-create + cache-read). The three optional
   *  `*Tokens` fields break that down so the UI can show a cache-hit
   *  rate and prove the prompt-caching discipline is paying off. */
  onUsage?: (info: {
    iteration: number;
    inputTokens: number;
    outputTokens: number;
    uncachedInputTokens?: number;
    cacheCreateTokens?: number;
    cacheReadTokens?: number;
    estimatedCost: number;
  }) => void;
  onAction?: (info: { tool: string; input: any }) => void;
  /** Fired before run_started when the edge loop substitutes the requested
   *  model for the Sonnet computer-use pin, so the UI can say "running on X
   *  (your model plans/verifies)" instead of substituting silently. */
  onModelResolved?: (info: { requestedModel: string; resolvedModel: string; reason: string }) => void;
  onScreenshot?: (info: { b64: string; url?: string }) => void;
  onReasoning?: (text: string) => void;
  onResult?: (info: {
    summary: string;
    sessionId: string;
    liveUrl: string;
    tokens: { input: number; output: number };
    iterations: number;
    /** Row id in `computer_use_runs` — persisted for history / follow-up
     *  context. Null if persistence was disabled or failed. */
    runId?: string | null;
    /** Structured list output. Present when the agent ran a list / research
     *  / comparison task and emitted a <FINDINGS> block. Null for single-
     *  answer tasks. */
    findings?: Array<{
      title: string;
      url?: string;
      price?: string;
      rating?: string;
      notes?: string;
      thumbnail?: string;
    }> | null;
    extractedData?: unknown | null;
  }) => void;
  /**
   * Fired when the run stops on a bounded limit (timeout, token budget,
   * cost cap, stall) BEFORE the matching onError. Carries the progress
   * made so far plus the live session link, so a stopped run hands back
   * something checkable instead of just an error string (D8).
   */
  onPartialResult?: (info: {
    stopReason: string;
    message: string;
    summary: string;
    progress: Array<{ iter: number; tool: string; detail: string }>;
    lastReasoning: string | null;
    iterations: number;
    sessionId: string;
    liveUrl: string;
    runId?: string | null;
  }) => void;
  onError: (message: string) => void;
}

export interface AgentHandle {
  cancel: () => void;
}

export function startComputerUseAgent(opts: ComputerUseAgentOpts): AgentHandle {
  const controller = new AbortController();
  let cancelled = false;

  (async () => {
    if (shouldBlockExternalAiProvider('anthropic')) {
      opts.onError(getStrictLocalAiModeMessage('anthropic'));
      return;
    }
    const accessToken = await getFreshAccessToken();
    if (!accessToken) {
      opts.onError('Not authenticated.');
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/computer-use-agent`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: opts.task,
          circleId: opts.circleId,
          userId: opts.userId,
          model: opts.model,
          sessionId: opts.sessionId,
          browserbase: opts.browserbase,
          maxIterations: opts.maxIterations,
          maxTokensBudget: opts.maxTokensBudget,
          maxCostUsd: opts.maxCostUsd,
          booking: opts.booking,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        try {
          const parsed = JSON.parse(errText);
          opts.onError(String(parsed.error || parsed.message || errText).slice(0, 400));
        } catch {
          opts.onError(errText.slice(0, 400));
        }
        return;
      }
      if (!res.body) {
        opts.onError('No response body — streaming not supported by this transport.');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (const frame of frames) {
          const lines = frame.split('\n');
          let event = '';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) event = line.slice(7).trim();
            else if (line.startsWith('data: ')) data += line.slice(6);
          }
          if (!event || !data) continue;
          let parsed: any;
          try { parsed = JSON.parse(data); } catch { continue; }
          switch (event) {
            case 'run_started':             opts.onRunStarted?.(parsed); break;
            case 'model_resolved':          opts.onModelResolved?.(parsed); break;
            case 'session_started':         opts.onSessionStarted?.(parsed); break;
            case 'action':                  opts.onAction?.(parsed); break;
            case 'screenshot':              opts.onScreenshot?.(parsed); break;
            case 'reasoning':               opts.onReasoning?.(parsed?.text || ''); break;
            case 'result':                  opts.onResult?.(parsed); break;
            case 'partial_result':          opts.onPartialResult?.(parsed); break;
            case 'error':                   opts.onError(parsed?.message || 'agent error'); break;
            case 'confirmation_required':   opts.onConfirmationRequired?.(parsed); break;
            case 'confirmation_resolved':   opts.onConfirmationResolved?.(parsed); break;
            case 'steering_applied':        opts.onSteeringApplied?.(parsed); break;
            case 'usage':                   opts.onUsage?.(parsed); break;
            // Heartbeat is a keepalive — no callback needed, just drop it.
            case 'heartbeat':               break;
            // Unknown events: ignore. Forward compatibility with newer
            // edge function versions that add events we don't know yet.
            default:                        break;
          }
        }
      }
    } catch (err: any) {
      if (!cancelled) opts.onError(err?.message || 'agent request failed');
    }
  })();

  return {
    cancel: () => {
      cancelled = true;
      controller.abort();
    },
  };
}
