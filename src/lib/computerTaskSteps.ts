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

    fetchHybridSteps(runId).then((rows) => {
      if (!cancelled) {
        setSteps(rows);
        setLoading(false);
      }
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
          fetchHybridSteps(runId).then((rows) => {
            if (!cancelled) setSteps(rows);
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [runId]);

  return { steps, loading };
}
