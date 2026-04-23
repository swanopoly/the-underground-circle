/**
 * computerUseHistory — queries for past Computer Use runs. Powers the
 * history panel, the "open live session" links, and any follow-up UI
 * that wants to reference a previous task.
 *
 * The edge function is responsible for writing rows; this file only
 * reads. All queries scope to the current user's circle membership via
 * RLS (`cu_runs_read_members`).
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';

export interface ComputerUseRunRow {
  id: string;
  circle_id: string;
  user_id: string | null;
  task: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  session_id: string | null;
  live_url: string | null;
  summary: string | null;
  findings: Array<{
    title: string;
    url?: string;
    price?: string;
    rating?: string;
    notes?: string;
    thumbnail?: string;
  }> | null;
  iterations: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
  error_message: string | null;
  final_screenshot_url: string | null;
  created_at: string;
  completed_at: string | null;
}

export async function listCircleComputerUseRuns(
  circleId: string,
  limit = 20,
): Promise<ComputerUseRunRow[]> {
  if (!circleId) return [];
  try {
    const { data, error } = await supabase
      .from('computer_use_runs')
      .select('*')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 100)));
    if (error) {
      console.warn('[computerUseHistory] list failed:', error.message);
      return [];
    }
    return (data as ComputerUseRunRow[]) || [];
  } catch (err: any) {
    console.warn('[computerUseHistory] list threw:', err?.message || err);
    return [];
  }
}

/**
 * Lightweight row shape for the Browser Task modal's "RECENT" chip
 * strip. Only pulls the columns the UI needs so the modal open path
 * stays fast even as the runs table grows.
 */
export interface RecentComputerUseRun {
  id: string;
  task: string;
  estimated_cost: number;
  completed_at: string | null;
  status: 'running' | 'done' | 'error' | 'cancelled';
  iterations: number;
}

/** One-shot narrow fetcher — returns only completed / errored runs so
 *  users don't see "running" noise in their "what did I just do" list. */
export async function loadRecentComputerUseRuns(
  circleId: string | null,
  limit = 5,
): Promise<RecentComputerUseRun[]> {
  if (!circleId) return [];
  try {
    const { data, error } = await supabase
      .from('computer_use_runs')
      .select('id, task, estimated_cost, completed_at, status, iterations')
      .eq('circle_id', circleId)
      .in('status', ['done', 'error'])
      .order('completed_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r: any) => ({
      id: r.id,
      task: String(r.task || ''),
      estimated_cost: Number(r.estimated_cost || 0),
      completed_at: r.completed_at || null,
      status: r.status,
      iterations: Number(r.iterations || 0),
    }));
  } catch {
    return [];
  }
}

/** Hook — refetches when circleId changes OR when the caller flips
 *  `refreshKey` (e.g. after a run completes in the same session). */
export function useRecentComputerUseRuns(
  circleId: string | null,
  limit = 5,
  refreshKey: number = 0,
): { runs: RecentComputerUseRun[]; loading: boolean; refresh: () => Promise<void> } {
  const [runs, setRuns] = useState<RecentComputerUseRun[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!circleId) { setRuns([]); return; }
    setLoading(true);
    const next = await loadRecentComputerUseRuns(circleId, limit);
    setRuns(next);
    setLoading(false);
  }, [circleId, limit]);

  useEffect(() => {
    refresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleId, limit, refreshKey]);

  return { runs, loading, refresh };
}

/** "5m" / "2h" / "3d" — tuned for tight chip labels (no "ago" suffix). */
export function relativeTimeShort(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60)        return `${s}s`;
  if (s < 3600)      return `${Math.floor(s / 60)}m`;
  if (s < 86400)     return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export async function getComputerUseRun(runId: string): Promise<ComputerUseRunRow | null> {
  if (!runId) return null;
  try {
    const { data, error } = await supabase
      .from('computer_use_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();
    if (error) return null;
    return (data as ComputerUseRunRow) || null;
  } catch {
    return null;
  }
}
