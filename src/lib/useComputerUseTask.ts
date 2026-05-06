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

export function useComputerUseTask(circleId: string, userId?: string) {
  const [state, setState] = useState<ComputerUseTaskState>(EMPTY_STATE);
  const handleRef = useRef<AgentHandle | null>(null);

  const run = useCallback(async (
    task: string,
    options?: { sessionId?: string },
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
      sessionId: options?.sessionId,
      browserbase: credsResult.creds.browserbase,
      onRunStarted: ({ runId }) => {
        setState((prev) => ({ ...prev, runId }));
      },
      onSessionStarted: ({ sessionId, liveUrl }) => {
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
        setState((prev) => ({
          ...prev,
          pendingConfirmation: { ...info, askedAt: Date.now() },
        }));
      },
      onConfirmationResolved: () => {
        setState((prev) => ({ ...prev, pendingConfirmation: null }));
      },
      onUsage: (info) => {
        setState((prev) => ({ ...prev, usage: info }));
      },
      onResult: ({ summary, iterations, tokens, findings, extractedData, runId }) => {
        setState((prev) => ({
          ...prev,
          status: 'done',
          runId: runId || prev.runId,
          result: { summary, iterations, tokens, findings: findings ?? null, extractedData: extractedData ?? null },
        }));
        handleRef.current = null;
      },
      onError: (msg) => {
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
    setState((prev) => prev.status === 'running' || prev.status === 'starting'
      ? { ...prev, status: 'error', errorMessage: 'Cancelled by user.' }
      : prev);
  }, []);

  const reset = useCallback(() => {
    cancel();
    setState(EMPTY_STATE);
  }, [cancel]);

  return { state, run, cancel, reset };
}
