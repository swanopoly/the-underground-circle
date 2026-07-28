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
import {
  buildComputerUsePolicyEnvelope,
  startComputerUseAgent,
  type AgentHandle,
  type ComputerUseAlwaysConfirmCategory,
  type ComputerUsePreRunBrowserPermission,
} from './computerUseAgent';
import { resolveComputerUseCreds } from './computerUseCreds';
import {
  fireComputerTaskWebNotification,
  recordComputerTaskPartialResultNotification,
  recordComputerTaskPendingQuestion,
  resolveComputerTaskPendingQuestionState,
} from './computerTaskState';
import type { LiveAction, LiveScreenshot } from '../components/ComputerUseLiveCard';
import {
  resolveComputerTaskLoopModel,
  type ComputerTaskModelResolution,
} from './chatComputerHandoffContext';
import { translateComputerUseErrorMessage } from './chatUserFacingOutcomes';
import { buildChatComputerUsePolicyInputs } from './chatComputerRequestRouter';

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
  /**
   * Model substitution visibility (2.5): non-null ONLY when the requested
   * model was swapped for the Sonnet computer-use pin, so cards can render
   * the substitution notice (see
   * `formatComputerTaskModelResolutionNotice`). Mirrors the edge
   * loop's `model_resolved` SSE event deterministically at start time (the
   * edge coercion is a pure function of the requested model). Optional so
   * existing state literals (e.g. useComputerUseQueue) stay valid — absent
   * means the same as null: no substitution to show.
   */
  modelResolution?: ComputerTaskModelResolution | null;
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
  rawErrorMessage?: string | null;
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
  modelResolution: null,
  pendingConfirmation: null,
  result: null,
  errorMessage: null,
  rawErrorMessage: null,
};

// Phase 2b (docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md): display policy lives
// in the chatUserFacingOutcomes owner — classified failures render as plain
// language + one next action instead of the old strip-jargon-or-generic
// fallback. Raw text still lands in `rawErrorMessage` for recovery/debug.
const sanitizeComputerUseErrorMessage = translateComputerUseErrorMessage;

export function useComputerUseTask(circleId: string, userId?: string, threadId?: string | null) {
  const [state, setState] = useState<ComputerUseTaskState>(EMPTY_STATE);
  const handleRef = useRef<AgentHandle | null>(null);
  // Synchronous reservation closes the await-creds race: two run() calls in
  // the same render can no longer both pass the empty handle check.
  const startReservationRef = useRef<object | null>(null);
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
    options?: {
      sessionId?: string;
      model?: string | null;
      /** Booking-class run: raises edge caps (iterations/tokens/cost/wall)
       *  so a multi-leg checkout can complete. Non-booking runs unchanged. */
      booking?: boolean;
      /** Explicit per-run cost cap. Omit to defer to booking-class / circle
       *  / edge defaults. */
      maxCostUsd?: number;
      maxIterations?: number;
      maxTokensBudget?: number;
      /** User-authored limits copied into the bounded edge policy envelope. */
      userConstraints?: string[];
      /** Categories the user wants confirmed even when another grant exists. */
      alwaysConfirmCategories?: ComputerUseAlwaysConfirmCategory[];
      /** Optional short-lived signal from an explicit browser permission UI. */
      preRunBrowserPermission?: ComputerUsePreRunBrowserPermission;
    },
  ): Promise<{ started: boolean; reason?: string }> => {
    if (!task.trim()) return { started: false, reason: 'Empty task.' };
    if (handleRef.current || startReservationRef.current) {
      return { started: false, reason: 'Another task is already running.' };
    }
    const startReservation = {};
    startReservationRef.current = startReservation;
    const releaseStartReservation = () => {
      if (startReservationRef.current === startReservation) startReservationRef.current = null;
    };

    let credsResult: Awaited<ReturnType<typeof resolveComputerUseCreds>>;
    try {
      credsResult = await resolveComputerUseCreds(circleId);
    } catch {
      const wasCancelled = startReservationRef.current !== startReservation;
      releaseStartReservation();
      if (wasCancelled) return { started: false, reason: 'Task start was cancelled.' };
      const reason = 'Could not load Computer Use credentials.';
      setState({ ...EMPTY_STATE, status: 'error', task, errorMessage: reason });
      return { started: false, reason };
    }
    if (startReservationRef.current !== startReservation) {
      return { started: false, reason: 'Task start was cancelled.' };
    }
    if (!credsResult.ok) {
      releaseStartReservation();
      const reason = 'reason' in credsResult ? credsResult.reason : 'Computer Use credentials are unavailable.';
      setState({ ...EMPTY_STATE, status: 'error', task, errorMessage: reason });
      return { started: false, reason };
    }

    // 2.5 substitution visibility: consume the edge loop's model coercion
    // into task state up front. `startComputerUseAgent`'s SSE dispatcher
    // ignores unknown events, so mirror the (deterministic) `model_resolved`
    // event locally — same inputs, same shape. Null when the requested model
    // already drives the native loop (no substitution → no notice).
    const modelResolution = resolveComputerTaskLoopModel(options?.model);
    const derivedPolicy = buildChatComputerUsePolicyInputs(task, {
      booking: options?.booking === true,
    });
    setState({
      ...EMPTY_STATE,
      status: 'starting',
      task,
      modelResolution: modelResolution.substituted ? modelResolution : null,
    });
    let startedHandle: AgentHandle;
    try {
      startedHandle = startComputerUseAgent({
        task,
        circleId,
        userId,
        model: options?.model || undefined,
        sessionId: options?.sessionId,
        booking: options?.booking,
        maxCostUsd: options?.maxCostUsd,
        maxIterations: options?.maxIterations,
        maxTokensBudget: options?.maxTokensBudget,
        policy: buildComputerUsePolicyEnvelope({
          executionMode: 'interactive',
          source: 'chat',
          userConstraints: options?.userConstraints ?? derivedPolicy.userConstraints,
          // Native computer targets are coordinate/focus based today. Mark the
          // opacity explicitly so no broad or stale grant can skip the live gate.
          alwaysConfirmCategories:
            options?.alwaysConfirmCategories ?? derivedPolicy.alwaysConfirmCategories,
          preRunBrowserPermission: options?.preRunBrowserPermission,
        }),
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
        onSteeringApplied: ({ note }) => {
          // Steering confirmation rides the reasoning stream the live card
          // already renders — the user sees exactly when their note landed.
          const text = `🧭 Steering applied: ${String(note || '').slice(0, 200)}`;
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
          // D6: persist the partial-result notification on the durable record
          // so a walked-away user learns about the bounded stop on return.
          void recordComputerTaskPartialResultNotification(circleId, threadId, {
            summary,
            runId: runId || runIdRef.current,
          });
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
          // D6 progressive enhancement: page hidden + permission already
          // granted → native web notification. Silent no-op otherwise.
          fireComputerTaskWebNotification({
            kind: 'completed',
            title: 'Computer task finished',
            body: summary || task,
          });
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
          const visibleError = sanitizeComputerUseErrorMessage(msg);
          fireComputerTaskWebNotification({
            kind: 'failed',
            title: 'Computer task failed',
            body: visibleError || task,
          });
          setState((prev) => ({ ...prev, status: 'error', errorMessage: visibleError, rawErrorMessage: msg }));
          handleRef.current = null;
        },
      });
    } catch {
      releaseStartReservation();
      const reason = 'Could not start the Computer Use task.';
      setState({ ...EMPTY_STATE, status: 'error', task, errorMessage: reason });
      return { started: false, reason };
    }
    if (startReservationRef.current !== startReservation) {
      try { startedHandle.cancel(); } catch {}
      return { started: false, reason: 'Task start was cancelled.' };
    }
    handleRef.current = startedHandle;
    releaseStartReservation();
    return { started: true };
  }, [circleId, userId, persistQuestionAsked, persistQuestionResolved]);

  const cancel = useCallback(() => {
    // Invalidate an in-flight credential lookup before it can create a run.
    startReservationRef.current = null;
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
