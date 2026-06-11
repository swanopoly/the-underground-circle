/**
 * useComputerUseTask — React hook that owns a single Computer Use agent
 * task. Exposes `run(task)` + `cancel()` + the live state the chat card
 * renders.
 *
 * Designed to make chat integration trivial: ChatTab keeps a map from
 * message-id → hook instance, feeds live updates into the message, and
 * posts the final summary + screenshot as a follow-up chat message when
 * the agent completes.
 */

import { useCallback, useRef, useState } from 'react';
import { startComputerUseAgent, type AgentHandle } from './computerUseAgent';
import { resolveComputerUseCreds } from './computerUseCreds';
import {
  recordComputerTaskPendingQuestion,
  resolveComputerTaskPendingQuestionState,
} from './computerTaskState';
import type { LiveAction, LiveScreenshot } from '../components/ComputerUseLiveCard';

export type TaskStatus = 'idle' | 'starting' | 'running' | 'done' | 'error';

export interface PendingConfirmation {
  id: string | null;
  question: string;
  options: string[];
  context: string | null;
  timeoutSec: number;
  askedAt: number;
}

export interface LiveUsage {
  iteration: number;
  /** Total input-side tokens (uncached + cache-create + cache-read). */
  inputTokens: number;
  outputTokens: number;
  /** Fresh input tokens billed at the full input rate. */
  uncachedInputTokens?: number;
  /** Tokens written to the prompt cache this request (billed 1.25x input). */
  cacheCreateTokens?: number;
  /** Tokens read from the prompt cache (billed 0.10x input). */
  cacheReadTokens?: number;
  estimatedCost: number;
}

export interface ComputerUseTaskState {
  status: TaskStatus;
  task: string;
  /** Row id in `computer_use_runs` — used to link to history or run a
   *  follow-up referencing this task. */
  runId: string | null;
  sessionId: string | null;
  liveUrl: string | null;
  reasoning: string[];
  actions: LiveAction[];
  screenshots: LiveScreenshot[];
  /** Live token + cost ticker, updated per Claude turn. */
  usage: LiveUsage | null;
  /** Non-null while the agent is paused waiting for user approval. */
  pendingConfirmation: PendingConfirmation | null;
  result: {
    summary: string;
    iterations: number;
    tokens: { input: number; output: number };
    findings?: Array<{
      title: string;
      url?: string;
      price?: string;
      rating?: string;
      notes?: string;
      thumbnail?: string;
    }> | null;
    extractedData?: unknown | null;
  } | null;
  errorMessage: string | null;
}

const EMPTY_STATE: ComputerUseTaskState = {
  status: 'idle',
  task: '',
  runId: null,
  sessionId: null,
  liveUrl: null,
  reasoning: [],
  actions: [],
  screenshots: [],
  usage: null,
  pendingConfirmation: null,
  result: null,
  errorMessage: null,
};

export function useComputerUseTask(circleId: string, userId?: string, threadId?: string | null) {
  const [state, setState] = useState<ComputerUseTaskState>(EMPTY_STATE);
  const handleRef = useRef<AgentHandle | null>(null);
  // Mirrors the live pendingConfirmation id so terminal callbacks can
  // expire the persisted copy without reading React state.
  const pendingQuestionIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);

  // D2: mid-task questions survive reload — mirror confirmation lifecycle
  // onto the durable computerTaskState record. All writes are
  // fire-and-forget; persistence must never block or break the live loop.
  const persistQuestionAsked = useCallback((info: PendingConfirmation, ids: { sessionId: string | null; runId: string | null }) => {
    const id = info.id || `q_${info.askedAt}`;
    pendingQuestionIdRef.current = id;
    void recordComputerTaskPendingQuestion(circleId, threadId, {
      id,
      question: info.question,
      options: info.options,
      context: info.context,
      askedAt: new Date(info.askedAt).toISOString(),
      sessionId: ids.sessionId,
      runId: ids.runId,
      status: 'pending',
      answer: null,
      resolvedAt: null,
    });
  }, [circleId, threadId]);

  const persistQuestionResolved = useCallback((answer: string | null) => {
    const id = pendingQuestionIdRef.current;
    pendingQuestionIdRef.current = null;
    if (!id) return;
    void resolveComputerTaskPendingQuestionState(circleId, threadId, id, answer);
  }, [circleId, threadId]);

  const run = useCallback(async (
    task: string,
    options?: { sessionId?: string; model?: string | null },
  ): Promise<{ started: boolean; reason?: string }> => {
    if (!task.trim()) return { started: false, reason: 'Empty task.' };
    if (handleRef.current) return { started: false, reason: 'Another task is already running.' };

    const credsResult = await resolveComputerUseCreds(circleId);
    if (!credsResult.ok) {
      setState({ ...EMPTY_STATE, status: 'error', task, errorMessage: credsResult.reason });
      return { started: false, reason: credsResult.reason };
    }

    setState({ ...EMPTY_STATE, status: 'starting', task });
    handleRef.current = startComputerUseAgent({
      task,
      circleId,
      userId,
      model: options?.model || undefined,
      sessionId: options?.sessionId,
      browserbase: credsResult.creds.browserbase,
      onRunStarted: ({ runId }) => {
        runIdRef.current = runId;
        setState((prev) => ({ ...prev, runId }));
      },
      onSessionStarted: ({ sessionId, liveUrl }) => {
        sessionIdRef.current = sessionId;
        setState((prev) => ({ ...prev, status: 'running', sessionId, liveUrl }));
      },
      onAction: (info) => {
        setState((prev) => ({ ...prev, actions: [...prev.actions, { ...info, at: Date.now() }] }));
      },
      onScreenshot: ({ b64, url }) => {
        setState((prev) => ({ ...prev, screenshots: [...prev.screenshots, { b64, url, at: Date.now() }] }));
      },
      onReasoning: (text) => {
        if (!text.trim()) return;
        setState((prev) => ({ ...prev, reasoning: [...prev.reasoning, text] }));
      },
      onConfirmationRequired: (info) => {
        const pending: PendingConfirmation = { ...info, askedAt: Date.now() };
        persistQuestionAsked(pending, { sessionId: sessionIdRef.current, runId: runIdRef.current });
        setState((prev) => ({ ...prev, pendingConfirmation: pending }));
      },
      onConfirmationResolved: () => {
        persistQuestionResolved('resolved in session');
        setState((prev) => ({ ...prev, pendingConfirmation: null }));
      },
      onUsage: (info) => {
        setState((prev) => ({ ...prev, usage: info }));
      },
      onPartialResult: ({ summary, iterations, runId }) => {
        // D8: a bounded stop (timeout/budget/stall) hands back the progress
        // made so far. Populate `result` with the partial summary so the
        // card shows what WAS done; the matching onError that follows sets
        // the error status + message.
        setState((prev) => ({
          ...prev,
          runId: runId || prev.runId,
          result: prev.result || {
            summary,
            iterations,
            tokens: {
              input: prev.usage?.inputTokens || 0,
              output: prev.usage?.outputTokens || 0,
            },
            findings: null,
            extractedData: null,
          },
        }));
      },
      onResult: ({ summary, iterations, tokens, findings, extractedData, runId }) => {
        persistQuestionResolved(null); // task finished — expire any open question
        setState((prev) => ({
          ...prev,
          status: 'done',
          runId: runId || prev.runId,
          result: { summary, iterations, tokens, findings: findings ?? null, extractedData: extractedData ?? null },
        }));
        handleRef.current = null;
      },
      onError: (msg) => {
        persistQuestionResolved(null); // task errored — expire any open question
        setState((prev) => ({ ...prev, status: 'error', errorMessage: msg }));
        handleRef.current = null;
      },
    });
    return { started: true };
  }, [circleId, userId]);

  const cancel = useCallback(() => {
    if (handleRef.current) {
      try { handleRef.current.cancel(); } catch {}
      handleRef.current = null;
    }
    persistQuestionResolved(null); // cancelled — expire any open question
    setState((prev) => prev.status === 'running' || prev.status === 'starting'
      ? { ...prev, status: 'error', errorMessage: 'Cancelled by user.' }
      : prev);
  }, [persistQuestionResolved]);

  const reset = useCallback(() => {
    cancel();
    setState(EMPTY_STATE);
  }, [cancel]);

  return { state, run, cancel, reset };
}
