/**
 * useComputerUseQueue — multi-task version of useComputerUseTask.
 *
 * Lets the user kick off several autonomous browser tasks in parallel
 * (e.g. "research A", "research B", "book C") and track each one's
 * streaming state independently. Each task lives under its own `id`;
 * cards render one per slot.
 *
 * The single-task hook stays for simpler UIs (the existing live card in
 * chat). This hook is for surfaces that want a task-queue experience.
 */

import { useCallback, useRef, useState } from 'react';
import { startComputerUseAgent, type AgentHandle } from './computerUseAgent';
import { resolveComputerUseCreds } from './computerUseCreds';
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

export interface QueueSlot {
  id: string;
  state: ComputerUseTaskState;
}

export function useComputerUseQueue(circleId: string, userId?: string) {
  const [slots, setSlots] = useState<QueueSlot[]>([]);
  const handlesRef = useRef<Map<string, AgentHandle>>(new Map());

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
    options?: { sessionId?: string },
  ): Promise<{ id: string | null; reason?: string }> => {
    const trimmed = task.trim();
    if (!trimmed) return { id: null, reason: 'Empty task.' };
    if (slots.filter((s) => s.state.status === 'running' || s.state.status === 'starting').length >= MAX_CONCURRENT_TASKS) {
      return { id: null, reason: `Queue full (max ${MAX_CONCURRENT_TASKS} concurrent tasks). Wait for one to finish.` };
    }

    const creds = await resolveComputerUseCreds(circleId);
    if (!creds.ok) return { id: null, reason: creds.reason };

    const id = `cu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setSlots((prev) => [...prev, { id, state: { ...EMPTY_TASK, status: 'starting', task: trimmed } }]);

    const handle = startComputerUseAgent({
      task: trimmed,
      circleId,
      userId,
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
  }, []);

  return { slots, start, cancel, dismiss, clear, maxConcurrent: MAX_CONCURRENT_TASKS };
}
