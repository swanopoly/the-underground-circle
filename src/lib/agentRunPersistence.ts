/**
 * agentRunPersistence — adapter that wires AgentExecutionCore events into the
 * existing agent_runs / agent_run_events tables.
 *
 * Call `createPersistedRun()` before `runAgent(...)`; pass the returned
 * `onEvent` handler into the core. Tool calls, results, model turns, and
 * final response all end up in `agent_run_events` (for trajectory replay
 * + the future evaluator), while per-run totals (iteration count, stop
 * reason, aggregate tool calls) land on `agent_runs` itself so the run
 * list UI shows accurate summaries without joining.
 *
 * Failures are non-fatal: we never block the agent loop on a DB write.
 * A bad row on the telemetry side should not kill a user-visible run.
 */

import { supabase } from './supabase';
import { createRun, updateRunStatus, type AgentRun, type RunSurface } from './agentRunSystem';
import type { AgentEvent, AgentRunResult, AgentToolResult } from './agentExecutionCore';

export type PersistedRunHandle = {
  run: AgentRun;
  /** Pass this into `runAgent({ onEvent })`. */
  onEvent: (event: AgentEvent) => void;
  /** Call once the core finishes. Writes totals + final status. */
  finalize: (result: AgentRunResult, err?: unknown) => Promise<void>;
};

export type CreatePersistedRunOptions = {
  circleId: string;
  userId: string;
  surface: RunSurface;
  title: string;
  goal?: string;
  mode?: string;
  model?: string;
  provider?: string;
  roomId?: string;
  chatSessionId?: string;
  parentRunId?: string;
  /**
   * If true, every AgentEvent is written to agent_run_events in real time.
   * Default true for durability. Set false for latency-critical paths where
   * you only care about the final summary.
   */
  streamEvents?: boolean;
  /** Optional extra metadata merged onto the run row. */
  metadata?: Record<string, unknown>;
};

export async function createPersistedRun(opts: CreatePersistedRunOptions): Promise<PersistedRunHandle | null> {
  const run = await createRun({
    circleId: opts.circleId,
    userId: opts.userId,
    surface: opts.surface,
    title: opts.title,
    goal: opts.goal,
    mode: opts.mode,
    model: opts.model,
    provider: opts.provider,
    roomId: opts.roomId,
    chatSessionId: opts.chatSessionId,
    parentRunId: opts.parentRunId,
    metadata: opts.metadata,
  });
  if (!run) return null;

  const streamEvents = opts.streamEvents !== false;

  // Aggregates we roll up into agent_runs at finalize-time.
  const toolCalls: Array<{
    toolName: string;
    toolUseId: string;
    input: unknown;
    ok: boolean;
    durationMs: number;
    error?: string;
  }> = [];
  let lastStopReason: string | undefined;
  let finalIteration = 0;
  let sawUsage = false;
  const tokenTotals = {
    input: 0,
    output: 0,
    cached: 0,
  };

  const writeEvent = async (kind: string, payload: Record<string, unknown>) => {
    if (!streamEvents) return;
    try {
      await supabase.from('agent_run_events').insert({
        run_id: run.id,
        kind,
        payload,
      });
    } catch (e) {
      // Non-fatal — telemetry failures should never bubble.
      console.warn('[agentRunPersistence] event insert failed:', e);
    }
  };

  // Map each AgentEvent to a storage-friendly row. Fire-and-forget; we do
  // NOT await each write so the loop is not bottlenecked on Supabase
  // latency. The small accepted tradeoff: if the process dies mid-run,
  // the last few events may be lost.
  const onEvent = (event: AgentEvent) => {
    switch (event.kind) {
      case 'turn_start':
        void writeEvent('turn_start', { iteration: event.iteration });
        break;
      case 'turn_end':
        finalIteration = event.iteration;
        lastStopReason = event.stop_reason;
        if (event.usage) {
          sawUsage = true;
          tokenTotals.input += Math.max(0, Math.floor(event.usage.input_tokens || 0));
          tokenTotals.output += Math.max(0, Math.floor(event.usage.output_tokens || 0));
          tokenTotals.cached += Math.max(0, Math.floor(
            (event.usage.cache_read_input_tokens || 0) + (event.usage.cache_creation_input_tokens || 0),
          ));
        }
        void writeEvent('turn_end', {
          iteration: event.iteration,
          stop_reason: event.stop_reason,
          usage: event.usage || null,
        });
        break;
      case 'model_delta':
        // Skip streaming deltas for the event log — they're fine-grained
        // UI signal, not durable state. Keeping them would 10x the row
        // count for marginal replay value.
        break;
      case 'context_compressed':
        void writeEvent('context_compressed', {
          iteration: event.iteration,
          dropped_count: event.droppedCount,
          tokens_before: event.tokensBefore,
          tokens_after: event.tokensAfter,
        });
        break;
      case 'iteration_complete':
        // Checkpoint boundary (R12). Store the marker + size only — the
        // message snapshot itself is for in-process checkpoint consumers,
        // not the event log (it can be hundreds of KB).
        void writeEvent('iteration_complete', {
          iteration: event.iteration,
          message_count: event.messages.length,
        });
        break;
      case 'tool_call_start':
        void writeEvent('tool_call_start', {
          iteration: event.iteration,
          tool: event.toolName,
          tool_use_id: event.toolUseId,
          input: event.input,
        });
        break;
      case 'tool_call_result': {
        const tr = event.result as AgentToolResult;
        toolCalls.push({
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: undefined, // kept in tool_call_start event to save bytes
          ok: tr.ok,
          durationMs: event.durationMs,
          error: tr.ok ? undefined : tr.error,
        });
        void writeEvent('tool_call_result', {
          iteration: event.iteration,
          tool: event.toolName,
          tool_use_id: event.toolUseId,
          ok: tr.ok,
          duration_ms: event.durationMs,
          ...(tr.ok ? {} : { error: tr.error }),
        });
        break;
      }
      case 'final_response':
        void writeEvent('final_response', {
          iteration: event.iteration,
          preview: event.text.slice(0, 400),
          length: event.text.length,
        });
        break;
      case 'max_iterations_exceeded':
        void writeEvent('max_iterations_exceeded', { iteration: event.iteration });
        break;
    }
  };

  const finalize = async (result: AgentRunResult, err?: unknown) => {
    const status = err
      ? 'failed'
      : result.hitMaxIterations
        ? 'failed'
        : 'completed';

    try {
      await supabase
        .from('agent_runs')
        .update({
          tool_calls: toolCalls,
          iteration_count: result.iterations || finalIteration,
          final_stop_reason: result.stopReason || lastStopReason || null,
          ...(sawUsage ? {
            input_tokens: tokenTotals.input,
            output_tokens: tokenTotals.output,
            cached_tokens: tokenTotals.cached,
          } : {}),
        })
        .eq('id', run.id);
    } catch (e) {
      console.warn('[agentRunPersistence] finalize columns update failed:', e);
    }

    await updateRunStatus(run.id, status, {
      completed_at: new Date().toISOString(),
    });

    if (err) {
      await writeEvent('error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  };

  return { run, onEvent, finalize };
}
