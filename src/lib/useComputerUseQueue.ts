/**
 * useComputerUseQueue — multi-task version of useComputerUseTask.
 *
 * Lets the user kick off several autonomous browser tasks in parallel
 * (e.g. "research A", "research B", "book C") and track each one's
 * streaming state independently. Each task lives under its own `id`;
 * cards render one per slot.
 *
 * Beyond parallel slots it now also carries a real WAITING QUEUE: tasks
 * added while the slots are full (or while auto-start is disabled) sit in
 * `pending` and only start when (a) a slot is free AND (b) the user
 * explicitly enabled auto-start (`autoStartEnabled`, default OFF —
 * parallel mutating automation must be opt-in) or manually starts the
 * item. Approval/floor semantics are untouched: every task runs through
 * `startComputerUseAgent`, whose edge loop still raises
 * confirmation-required events before risky actions.
 *
 * The single-task hook stays for simpler UIs (the existing live card in
 * chat). This hook is for surfaces that want a task-queue experience.
 *
 * Heavy runtime deps (`computerUseAgent`, `computerUseCreds`) are
 * lazy-imported inside `start` so this module stays dependency-light and
 * its pure helpers smoke-testable under tsx.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentHandle } from './computerUseAgent';
import type {
  ComputerUseTaskState,
  LiveUsage,
  PendingConfirmation,
} from './useComputerUseTask';
import type { LiveAction, LiveScreenshot } from '../components/ComputerUseLiveCard';

const EMPTY_TASK: ComputerUseTaskState = {
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

// Hard ceiling — the Browserbase free tier caps at 3 concurrent sessions
// and it's rare that a human can track more than that visually anyway.
const MAX_CONCURRENT_TASKS = 3;

// Waiting-queue bound: enough for "line up the afternoon", small enough
// that an unattended queue can't accumulate a backlog of mutations.
export const MAX_QUEUED_COMPUTER_USE_TASKS = 6;

export interface QueueSlot {
  id: string;
  state: ComputerUseTaskState;
}

/** A task waiting for a free slot (not yet started — no session exists). */
export interface QueuedComputerUseTask {
  id: string;
  task: string;
  queuedAtIso: string;
}

// ─── Pure helpers (smoke-testable) ──────────────────────────────────────────

/** Slots currently occupying a concurrency slot (starting or running). */
export function countActiveComputerUseSlots(
  slots: Array<{ state: Pick<ComputerUseTaskState, 'status'> }>,
): number {
  return slots.filter((s) => s.state.status === 'running' || s.state.status === 'starting').length;
}

/**
 * Pure auto-start gate: should the queue pull the next pending task into a
 * slot right now? Requires the explicit user opt-in — a populated queue
 * with the toggle off NEVER starts anything by itself.
 */
export function planComputerUseQueueAutoStart(args: {
  activeCount: number;
  pendingCount: number;
  autoStartEnabled: boolean;
  maxConcurrent?: number;
}): { shouldStart: boolean; reason: string } {
  const max = args.maxConcurrent ?? MAX_CONCURRENT_TASKS;
  if (args.pendingCount <= 0) return { shouldStart: false, reason: 'queue_empty' };
  if (!args.autoStartEnabled) return { shouldStart: false, reason: 'auto_start_disabled' };
  if (args.activeCount >= max) return { shouldStart: false, reason: 'slots_full' };
  return { shouldStart: true, reason: 'slot_free' };
}

/**
 * Pure enqueue: trims, rejects empties and exact duplicates already
 * waiting, and enforces the queue bound. Returns the next pending list
 * plus the added entry (or a refusal reason).
 */
export function appendQueuedComputerUseTask(
  pending: QueuedComputerUseTask[],
  task: string,
  opts?: { nowIso?: string; id?: string },
): { pending: QueuedComputerUseTask[]; added: QueuedComputerUseTask | null; reason?: string } {
  const trimmed = String(task || '').trim();
  if (!trimmed) return { pending, added: null, reason: 'Empty task.' };
  if (pending.length >= MAX_QUEUED_COMPUTER_USE_TASKS) {
    return { pending, added: null, reason: `Queue full (max ${MAX_QUEUED_COMPUTER_USE_TASKS} waiting tasks).` };
  }
  if (pending.some((item) => item.task === trimmed)) {
    return { pending, added: null, reason: 'That task is already queued.' };
  }
  const added: QueuedComputerUseTask = {
    id: opts?.id || `cuq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    task: trimmed,
    queuedAtIso: opts?.nowIso || new Date().toISOString(),
  };
  return { pending: [...pending, added], added };
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useComputerUseQueue(circleId: string, userId?: string) {
  const [slots, setSlots] = useState<QueueSlot[]>([]);
  const [pending, setPending] = useState<QueuedComputerUseTask[]>([]);
  // Opt-in gate for unattended starts. Deliberately NOT persisted — every
  // session starts with parallel automation off.
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const handlesRef = useRef<Map<string, AgentHandle>>(new Map());
  // Serializes auto-starts: `start` awaits creds before claiming a slot, so
  // two concurrent dequeues could both pass the concurrency check.
  const autoStartInFlightRef = useRef(false);

  const mutate = useCallback((id: string, patch: Partial<ComputerUseTaskState> | ((s: ComputerUseTaskState) => ComputerUseTaskState)) => {
    setSlots((prev) => prev.map((slot) => {
      if (slot.id !== id) return slot;
      const next = typeof patch === 'function' ? (patch as any)(slot.state) : { ...slot.state, ...patch };
      return { ...slot, state: next };
    }));
  }, []);

  /** Kick off a new task. Returns the slot id (or null if we refused). */
  const start = useCallback(async (
    task: string,
    options?: { sessionId?: string; model?: string | null },
  ): Promise<{ id: string | null; reason?: string }> => {
    const trimmed = task.trim();
    if (!trimmed) return { id: null, reason: 'Empty task.' };
    if (countActiveComputerUseSlots(slots) >= MAX_CONCURRENT_TASKS) {
      return { id: null, reason: `Queue full (max ${MAX_CONCURRENT_TASKS} concurrent tasks). Wait for one to finish.` };
    }

    const [{ startComputerUseAgent }, { resolveComputerUseCreds }] = await Promise.all([
      import('./computerUseAgent'),
      import('./computerUseCreds'),
    ]);
    const creds = await resolveComputerUseCreds(circleId);
    if (!creds.ok) return { id: null, reason: creds.reason };

    const id = `cu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSlots((prev) => [...prev, { id, state: { ...EMPTY_TASK, status: 'starting', task: trimmed } }]);

    const handle = startComputerUseAgent({
      task: trimmed,
      circleId,
      userId,
      model: options?.model || undefined,
      sessionId: options?.sessionId,
      browserbase: creds.creds.browserbase,
      onRunStarted: ({ runId }) => mutate(id, { runId }),
      onSessionStarted: (info) => mutate(id, { status: 'running', sessionId: info.sessionId, liveUrl: info.liveUrl }),
      onAction: (info) => mutate(id, (s) => ({ ...s, actions: [...s.actions, { ...info, at: Date.now() } as LiveAction] })),
      onScreenshot: ({ b64, url }) => mutate(id, (s) => ({ ...s, screenshots: [...s.screenshots, { b64, url, at: Date.now() } as LiveScreenshot] })),
      onReasoning: (text) => { if (text.trim()) mutate(id, (s) => ({ ...s, reasoning: [...s.reasoning, text] })); },
      onUsage: (u: LiveUsage) => mutate(id, { usage: u }),
      onConfirmationRequired: (info) => mutate(id, { pendingConfirmation: { ...info, askedAt: Date.now() } as PendingConfirmation }),
      onConfirmationResolved: () => mutate(id, { pendingConfirmation: null }),
      onResult: ({ summary, iterations, tokens, findings, runId }) => {
        mutate(id, (s) => ({
          ...s,
          status: 'done',
          runId: runId || s.runId,
          result: { summary, iterations, tokens, findings: findings ?? null },
        }));
        handlesRef.current.delete(id);
      },
      onError: (msg) => {
        mutate(id, { status: 'error', errorMessage: msg });
        handlesRef.current.delete(id);
      },
    });
    handlesRef.current.set(id, handle);
    return { id };
  }, [circleId, userId, slots, mutate]);

  /** Add a task to the waiting queue (does not start anything by itself). */
  const enqueue = useCallback((task: string): { id: string | null; reason?: string } => {
    const next = appendQueuedComputerUseTask(pending, task);
    if (!next.added) return { id: null, reason: next.reason };
    setPending(next.pending);
    return { id: next.added.id };
  }, [pending]);

  /** Remove a waiting task without starting it. */
  const removePending = useCallback((id: string) => {
    setPending((prev) => prev.filter((item) => item.id !== id));
  }, []);

  /**
   * Start a specific waiting task NOW (explicit user action — allowed even
   * with auto-start off). The item leaves the queue BEFORE the async start
   * so the auto-start effect can't dequeue it again mid-await; a refusal
   * puts it back at the front with the reason for the caller to show.
   */
  const startPending = useCallback(async (id: string): Promise<{ id: string | null; reason?: string }> => {
    const item = pending.find((entry) => entry.id === id);
    if (!item) return { id: null, reason: 'That task is no longer queued.' };
    setPending((prev) => prev.filter((entry) => entry.id !== id));
    const result = await start(item.task);
    if (!result.id) {
      setPending((prev) => (prev.some((entry) => entry.id === id) ? prev : [item, ...prev]));
    }
    return result;
  }, [pending, start]);

  // Auto-start: when the user enabled it, pull the next waiting task into a
  // free slot. One dequeue at a time; a creds/start failure surfaces as an
  // error slot (visible card) instead of silently looping.
  useEffect(() => {
    const plan = planComputerUseQueueAutoStart({
      activeCount: countActiveComputerUseSlots(slots),
      pendingCount: pending.length,
      autoStartEnabled,
    });
    if (!plan.shouldStart || autoStartInFlightRef.current) return;
    const nextTask = pending[0];
    autoStartInFlightRef.current = true;
    setPending((prev) => prev.filter((item) => item.id !== nextTask.id));
    void start(nextTask.task)
      .then((result) => {
        if (!result.id) {
          // Make the refusal visible as its own error card; never retry the
          // same task in a loop.
          setSlots((prev) => [...prev, {
            id: `cu-failed-${nextTask.id}`,
            state: { ...EMPTY_TASK, status: 'error', task: nextTask.task, errorMessage: result.reason || 'Could not start the queued task.' },
          }]);
        }
      })
      .finally(() => {
        autoStartInFlightRef.current = false;
      });
  }, [slots, pending, autoStartEnabled, start]);

  const cancel = useCallback((id: string) => {
    const h = handlesRef.current.get(id);
    if (h) { try { h.cancel(); } catch {} handlesRef.current.delete(id); }
    mutate(id, (s) => s.status === 'running' || s.status === 'starting'
      ? { ...s, status: 'error', errorMessage: 'Cancelled by user.' }
      : s);
  }, [mutate]);

  const dismiss = useCallback((id: string) => {
    setSlots((prev) => prev.filter((slot) => slot.id !== id));
    const h = handlesRef.current.get(id);
    if (h) { try { h.cancel(); } catch {} handlesRef.current.delete(id); }
  }, []);

  const clear = useCallback(() => {
    for (const h of handlesRef.current.values()) { try { h.cancel(); } catch {} }
    handlesRef.current.clear();
    setSlots([]);
    setPending([]);
  }, []);

  return {
    slots,
    pending,
    autoStartEnabled,
    setAutoStartEnabled,
    start,
    enqueue,
    startPending,
    removePending,
    cancel,
    dismiss,
    clear,
    maxConcurrent: MAX_CONCURRENT_TASKS,
  };
}
