// computerTaskSteps.ts — DB CRUD over `computer_task_steps` plus the
// useHybridSteps Realtime hook. Mirrors the pattern in
// computerUseHistory.ts.
//
// All writes are best-effort with logging on failure. Reads return
// empty arrays on failure so callers don't have to handle null.

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type {
  HybridStep,
  HybridStepRecord,
  HybridStepStatus,
} from './computerHybridTypes';

/**
 * Insert all steps of a HybridPlan as pending rows.
 * Returns inserted records (with server-assigned ids), or [] on failure.
 */
export async function insertHybridSteps(args: {
  runId: string;
  circleId: string;
  steps: HybridStep[];
}): Promise<HybridStepRecord[]> {
  const rows = args.steps.map((step, index) => ({
    run_id: args.runId,
    circle_id: args.circleId,
    step_index: index,
    step_kind: step.kind,
    task: step.task,
    rationale: step.rationale || null,
    needs_approval: step.needsApproval,
    status: 'pending' as HybridStepStatus,
  }));

  const { data, error } = await supabase
    .from('computer_task_steps')
    .insert(rows)
    .select('*');

  if (error) {
    console.warn('[computerTaskSteps] insert failed', error.message);
    return [];
  }
  return (data || []) as HybridStepRecord[];
}

/**
 * Patch a single step row. Common patches: mark active (sets started_at),
 * mark completed (sets completed_at + output), mark blocked (sets error).
 */
export async function updateStepStatus(args: {
  stepId: string;
  status: HybridStepStatus;
  output?: unknown;
  error?: string | null;
}): Promise<void> {
  const patch: Record<string, unknown> = { status: args.status };
  const now = new Date().toISOString();

  if (args.status === 'active') patch.started_at = now;
  if (args.status === 'completed' || args.status === 'blocked' || args.status === 'skipped') {
    patch.completed_at = now;
  }
  if (args.output !== undefined) patch.output = args.output;
  if (args.error !== undefined) patch.error = args.error;

  const { error } = await supabase
    .from('computer_task_steps')
    .update(patch)
    .eq('id', args.stepId);

  if (error) {
    console.warn('[computerTaskSteps] update failed', error.message);
  }
}

/** Mark a step as approved (sets approved_at). Caller flips to 'active' separately. */
export async function approveStep(stepId: string): Promise<void> {
  const { error } = await supabase
    .from('computer_task_steps')
    .update({ approved_at: new Date().toISOString() })
    .eq('id', stepId);
  if (error) console.warn('[computerTaskSteps] approve failed', error.message);
}

/**
 * Wait for a step row to be approved (approved_at non-null) or declined
 * (status='blocked'). Resolves true on approval, false on decline or
 * timeout. Used by the hybrid orchestrator's onApprovalRequired callback.
 *
 * Uses a Realtime subscription with a polling backup so we don't hang
 * forever if the channel drops.
 */
export async function awaitStepApproval(args: {
  stepId: string;
  runId: string;
  timeoutMs?: number;
}): Promise<boolean> {
  const timeoutMs = args.timeoutMs ?? 5 * 60_000; // 5 min default

  // First check: maybe the user already responded before we subscribed.
  const initial = await readStepDecision(args.stepId);
  if (initial !== 'pending') return initial === 'approved';

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (v: boolean) => {
      if (settled) return;
      settled = true;
      try { supabase.removeChannel(channel); } catch { /* noop */ }
      clearTimeout(timeoutHandle);
      clearInterval(pollHandle);
      resolve(v);
    };

    // Realtime subscription on the parent run's steps; check the specific
    // step on every change.
    const channel = supabase
      .channel(`step_approval:${args.stepId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'computer_task_steps',
          filter: `id=eq.${args.stepId}`,
        },
        () => {
          readStepDecision(args.stepId)
            .then((decision) => {
              if (decision === 'approved') settle(true);
              else if (decision === 'declined') settle(false);
            })
            .catch(() => { /* keep waiting */ });
        },
      )
      .subscribe();

    // Polling backup — every 3s, check the row directly. Realtime can drop;
    // this keeps the wait correct even when the channel dies.
    const pollHandle = setInterval(() => {
      readStepDecision(args.stepId)
        .then((decision) => {
          if (decision === 'approved') settle(true);
          else if (decision === 'declined') settle(false);
        })
        .catch(() => { /* keep waiting */ });
    }, 3000);

    // Hard timeout — if the user walks away, decline by inaction.
    const timeoutHandle = setTimeout(() => settle(false), timeoutMs);
  });
}

/** Read a single step's approval decision. */
async function readStepDecision(stepId: string): Promise<'pending' | 'approved' | 'declined'> {
  const { data, error } = await supabase
    .from('computer_task_steps')
    .select('approved_at, status')
    .eq('id', stepId)
    .single();
  if (error || !data) return 'pending';
  if (data.status === 'blocked') return 'declined';
  if (data.approved_at) return 'approved';
  return 'pending';
}

/**
 * User declines a step — marks it blocked with reason. The orchestrator
 * will see this via awaitStepApproval and continue with the cascade-skip
 * path for dependents.
 */
export async function declineStep(stepId: string, reason: string = 'user_declined'): Promise<void> {
  const { error } = await supabase
    .from('computer_task_steps')
    .update({
      status: 'blocked',
      error: reason,
      completed_at: new Date().toISOString(),
    })
    .eq('id', stepId);
  if (error) console.warn('[computerTaskSteps] decline failed', error.message);
}

/** One-shot fetch of all steps for a run, ordered by step_index. */
export async function fetchHybridSteps(runId: string): Promise<HybridStepRecord[]> {
  const { data, error } = await supabase
    .from('computer_task_steps')
    .select('*')
    .eq('run_id', runId)
    .order('step_index', { ascending: true });
  if (error) {
    console.warn('[computerTaskSteps] fetch failed', error.message);
    return [];
  }
  return (data || []) as HybridStepRecord[];
}

/**
 * React hook: subscribes to live changes on the run's steps via Supabase
 * Realtime. Returns the current ordered step list. Used by both the
 * owner's UI (which is also writing) and observers (read-only).
 */
export function useHybridSteps(runId: string | null): {
  steps: HybridStepRecord[];
  loading: boolean;
} {
  const [steps, setSteps] = useState<HybridStepRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(!!runId);

  useEffect(() => {
    if (!runId) {
      setSteps([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchHybridSteps(runId)
      .then((rows) => {
        if (!cancelled) {
          setSteps(rows);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('[computerTaskSteps] initial fetch failed:', err?.message || err);
        if (!cancelled) setLoading(false);
      });

    const channel = supabase
      .channel(`computer_task_steps:${runId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'computer_task_steps',
          filter: `run_id=eq.${runId}`,
        },
        () => {
          // Re-sort on every change — list is small (≤ ~10 steps), simpler
          // than reconciling individual events.
          fetchHybridSteps(runId)
            .then((rows) => {
              if (!cancelled) setSteps(rows);
            })
            .catch((err) => console.warn('[computerTaskSteps] realtime fetch failed:', err?.message || err));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      try { supabase.removeChannel(channel); } catch { /* best-effort cleanup */ }
    };
  }, [runId]);

  return { steps, loading };
}
