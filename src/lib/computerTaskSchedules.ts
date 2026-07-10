/**
 * computerTaskSchedules — Phase 6a "recurring computer-task watches".
 * CRUD over the `computer_use_schedules` table: per-circle standing
 * watches ("check X every day, tell me what changed") that the app
 * re-runs on a cadence while it is open and reports findings/diffs
 * back into chat.
 *
 * Public surface:
 *
 *   list / listDue — read watches for the Office panel and the due-watch
 *       runner (active + next_run_at <= now, soonest first).
 *   create — insert a watch; refuses past MAX_ACTIVE_WATCHES and seeds
 *       next_run_at one full interval out (creating a watch is not
 *       itself a run — the first check happens after one cadence).
 *   setActive — pause/resume; resuming re-seeds next_run_at from the
 *       row's cadence so a long-paused watch doesn't instantly fire.
 *   delete — remove the watch entirely.
 *   claimRun — compare-and-set on next_run_at so the client runner and
 *       the server-side cron scheduler cannot both run the same due watch.
 *   markRun — stamp last_run_at / findings / diff summary and schedule
 *       the next check.
 *
 * Every function fails soft (empty array / false / { ok: false }): the
 * table's migration may not be applied in production yet, and a missing
 * table must degrade to "no watches" — never throw into the UI.
 */

import { supabase } from './supabase';
import {
  computeNextRunAtIso,
  MAX_ACTIVE_WATCHES,
  type ComputerTaskScheduleCadence,
  type ComputerTaskScheduleNotifyOn,
  type ComputerTaskScheduleRow,
} from './computerTaskScheduleModel';

const SCHEDULES_TABLE = 'computer_use_schedules';

/** All watches for a circle (active and paused), soonest check first. */
export async function listComputerTaskSchedules(circleId: string): Promise<ComputerTaskScheduleRow[]> {
  try {
    const { data, error } = await supabase
      .from(SCHEDULES_TABLE)
      .select('*')
      .eq('circle_id', circleId)
      .order('next_run_at', { ascending: true })
      .limit(50);
    if (error || !Array.isArray(data)) return [];
    return data as ComputerTaskScheduleRow[];
  } catch {
    return [];
  }
}

/** Active watches whose next check is due (next_run_at <= now), soonest first. */
export async function listDueComputerTaskSchedules(
  circleId: string,
  nowIso?: string,
): Promise<ComputerTaskScheduleRow[]> {
  try {
    const cutoffIso = nowIso ?? new Date().toISOString();
    const { data, error } = await supabase
      .from(SCHEDULES_TABLE)
      .select('*')
      .eq('circle_id', circleId)
      .eq('active', true)
      .lte('next_run_at', cutoffIso)
      .order('next_run_at', { ascending: true })
      .limit(5);
    if (error || !Array.isArray(data)) return [];
    return data as ComputerTaskScheduleRow[];
  } catch {
    return [];
  }
}

/**
 * Create a watch. Counts the circle's active watches first and refuses
 * at MAX_ACTIVE_WATCHES with an actionable error. The first check is
 * scheduled one full interval out via `computeNextRunAtIso`.
 */
export async function createComputerTaskSchedule(input: {
  circleId: string;
  createdBy: string;
  task: string;
  cadence: ComputerTaskScheduleCadence;
  notifyOn: ComputerTaskScheduleNotifyOn;
  threadId?: string | null;
}): Promise<{ ok: true; schedule: ComputerTaskScheduleRow } | { ok: false; error: string }> {
  try {
    const task = String(input.task || '').trim();
    if (!task) return { ok: false, error: 'A watch needs a task to check.' };

    const { count, error: countError } = await supabase
      .from(SCHEDULES_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('circle_id', input.circleId)
      .eq('active', true);
    if (countError) {
      return { ok: false, error: countError.message || 'Could not check the active watch count.' };
    }
    if ((count ?? 0) >= MAX_ACTIVE_WATCHES) {
      return {
        ok: false,
        error: `This circle already has ${MAX_ACTIVE_WATCHES} active watches. Pause or delete one before adding another.`,
      };
    }

    const { data, error } = await supabase
      .from(SCHEDULES_TABLE)
      .insert({
        circle_id: input.circleId,
        created_by: input.createdBy,
        task,
        cadence: input.cadence,
        notify_on: input.notifyOn,
        thread_id: input.threadId ?? null,
        active: true,
        next_run_at: computeNextRunAtIso(input.cadence, Date.now()),
      })
      .select('*')
      .single();
    if (error || !data) {
      return { ok: false, error: error?.message || 'Could not create the watch.' };
    }
    return { ok: true, schedule: data as ComputerTaskScheduleRow };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Could not create the watch.' };
  }
}

/**
 * Pause or resume a watch (bumps updated_at). Resuming re-seeds
 * next_run_at from the row's cadence so a watch paused for weeks waits
 * one fresh interval instead of firing immediately.
 */
export async function setComputerTaskScheduleActive(id: string, active: boolean): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = {
      active,
      updated_at: new Date().toISOString(),
    };
    if (active) {
      const { data, error } = await supabase
        .from(SCHEDULES_TABLE)
        .select('cadence')
        .eq('id', id)
        .single();
      if (error || !data) return false;
      patch.next_run_at = computeNextRunAtIso(data.cadence as ComputerTaskScheduleCadence, Date.now());
    }
    const { error } = await supabase.from(SCHEDULES_TABLE).update(patch).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/** Delete a watch entirely. */
export async function deleteComputerTaskSchedule(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(SCHEDULES_TABLE).delete().eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Atomically claim a due schedule by advancing next_run_at ONLY IF it still
 * has the expected value — the compare-and-set that keeps the client runner
 * and the server scheduler from double-running the same watch. Returns true
 * only when THIS caller won the claim.
 */
export async function claimComputerTaskScheduleRun(
  id: string,
  expectedNextRunAtIso: string,
  nextRunAtIso: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from(SCHEDULES_TABLE)
      .update({ next_run_at: nextRunAtIso, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('next_run_at', expectedNextRunAtIso)
      .eq('active', true)
      .select('id');
    if (error || !Array.isArray(data)) return false;
    return data.length === 1;
  } catch {
    return false;
  }
}

/**
 * Record a status note on a schedule WITHOUT advancing it: only
 * last_diff_summary (and updated_at) change, so next_run_at — and with it
 * dueness and the claim CAS — is untouched. Used for non-run conditions
 * like a folder watch's "skipped: desktop bridge offline", where the
 * watch must stay due and retry on a later tick instead of burning a
 * cadence interval.
 */
export async function recordComputerTaskScheduleNote(id: string, note: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(SCHEDULES_TABLE)
      .update({
        last_diff_summary: String(note || '').slice(0, 400),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

/** Record a completed check: last run, findings, diff summary, next check. */
export async function markComputerTaskScheduleRun(
  id: string,
  input: {
    lastRunAtIso: string;
    nextRunAtIso: string;
    lastFindings: unknown[] | null;
    lastDiffSummary: string | null;
  },
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from(SCHEDULES_TABLE)
      .update({
        last_run_at: input.lastRunAtIso,
        next_run_at: input.nextRunAtIso,
        last_findings: input.lastFindings,
        last_diff_summary: input.lastDiffSummary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    return !error;
  } catch {
    return false;
  }
}
