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
import { safeGetUserForAccessToken } from './authSession';

export type ComputerUseHistoryExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type ComputerUseHistoryAuthorityFence = (
  authority: ComputerUseHistoryExactAuthority,
) => boolean;

export type ComputerUseHistoryExactError =
  | 'invalid_authority'
  | 'authority_mismatch'
  | 'authority_retired'
  | 'scope_mismatch'
  | 'receipt_mismatch'
  | 'remote_error';

export type ComputerUseHistoryExactListResult<T> = Readonly<{
  ok: boolean;
  rows: T[];
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ComputerUseHistoryExactError;
}>;

export type ComputerUseHistoryExactRowResult<T> = Readonly<{
  ok: boolean;
  row: T | null;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ComputerUseHistoryExactError;
}>;

const MAX_EXACT_SCOPE_PART_LENGTH = 240;
const MAX_EXACT_ACCESS_TOKEN_LENGTH = 16_384;

function normalizeExactScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_EXACT_SCOPE_PART_LENGTH) return null;
  return normalized;
}

function normalizeComputerUseHistoryExactAuthority(
  input: ComputerUseHistoryExactAuthority | null | undefined,
): ComputerUseHistoryExactAuthority | null {
  const userId = normalizeExactScopePart(input?.userId);
  const circleId = normalizeExactScopePart(input?.circleId);
  const accessToken = typeof input?.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input?.generation;
  if (
    !userId
    || !circleId
    || !accessToken
    || accessToken.length > MAX_EXACT_ACCESS_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || Number(generation) <= 0
  ) return null;
  return Object.freeze({ userId, circleId, accessToken, generation: Number(generation) });
}

function computerUseHistoryAuthorityIsCurrent(
  authority: ComputerUseHistoryExactAuthority,
  fence: ComputerUseHistoryAuthorityFence | null | undefined,
): boolean {
  if (!fence) return false;
  try {
    return fence(authority) === true;
  } catch {
    return false;
  }
}

async function resolveComputerUseHistoryExactAuthority(
  input: ComputerUseHistoryExactAuthority | null | undefined,
  fence: ComputerUseHistoryAuthorityFence | null | undefined,
): Promise<
  | { ok: true; authority: ComputerUseHistoryExactAuthority }
  | { ok: false; authority: ComputerUseHistoryExactAuthority | null; error: ComputerUseHistoryExactError }
> {
  const authority = normalizeComputerUseHistoryExactAuthority(input);
  if (!authority) return { ok: false, authority: null, error: 'invalid_authority' };
  if (!computerUseHistoryAuthorityIsCurrent(authority, fence)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (!computerUseHistoryAuthorityIsCurrent(authority, fence)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  if (verifiedUser?.id !== authority.userId) {
    return { ok: false, authority, error: 'authority_mismatch' };
  }
  return { ok: true, authority };
}

function exactListFailure<T>(
  authority: ComputerUseHistoryExactAuthority | null,
  error: ComputerUseHistoryExactError,
): ComputerUseHistoryExactListResult<T> {
  return {
    ok: false,
    rows: [],
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function exactRowFailure<T>(
  authority: ComputerUseHistoryExactAuthority | null,
  error: ComputerUseHistoryExactError,
): ComputerUseHistoryExactRowResult<T> {
  return {
    ok: false,
    row: null,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

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

/** Circle history read bound to one verified captured bearer and UI generation. */
export async function listCircleComputerUseRunsExact(
  circleId: string,
  limit: number,
  authorityInput: ComputerUseHistoryExactAuthority,
  isCurrent: ComputerUseHistoryAuthorityFence,
): Promise<ComputerUseHistoryExactListResult<ComputerUseRunRow>> {
  const resolved = await resolveComputerUseHistoryExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactListFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  if (normalizeExactScopePart(circleId) !== authority.circleId) {
    return exactListFailure(authority, 'scope_mismatch');
  }
  try {
    const { data, error } = await supabase
      .from('computer_use_runs')
      .select('*')
      .eq('circle_id', authority.circleId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 20, 100)))
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!computerUseHistoryAuthorityIsCurrent(authority, isCurrent)) {
      return exactListFailure(authority, 'authority_retired');
    }
    if (error || !Array.isArray(data)) return exactListFailure(authority, 'remote_error');
    if (data.some((row: any) => row?.circle_id !== authority.circleId || !normalizeExactScopePart(row?.id))) {
      return exactListFailure(authority, 'receipt_mismatch');
    }
    if (!computerUseHistoryAuthorityIsCurrent(authority, isCurrent)) {
      return exactListFailure(authority, 'authority_retired');
    }
    return {
      ok: true,
      rows: data as ComputerUseRunRow[],
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactListFailure(authority, 'remote_error');
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

/** Narrow recent-history projection with the same exact authority boundary. */
export async function loadRecentComputerUseRunsExact(
  circleId: string,
  limit: number,
  authorityInput: ComputerUseHistoryExactAuthority,
  isCurrent: ComputerUseHistoryAuthorityFence,
): Promise<ComputerUseHistoryExactListResult<RecentComputerUseRun>> {
  const resolved = await resolveComputerUseHistoryExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactListFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  if (normalizeExactScopePart(circleId) !== authority.circleId) {
    return exactListFailure(authority, 'scope_mismatch');
  }
  try {
    const { data, error } = await supabase
      .from('computer_use_runs')
      .select('id, circle_id, task, estimated_cost, completed_at, status, iterations')
      .eq('circle_id', authority.circleId)
      .in('status', ['done', 'error'])
      .order('completed_at', { ascending: false })
      .limit(Math.max(1, Math.min(Number(limit) || 5, 100)))
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!computerUseHistoryAuthorityIsCurrent(authority, isCurrent)) {
      return exactListFailure(authority, 'authority_retired');
    }
    if (error || !Array.isArray(data)) return exactListFailure(authority, 'remote_error');
    if (data.some((row: any) => row?.circle_id !== authority.circleId || !normalizeExactScopePart(row?.id))) {
      return exactListFailure(authority, 'receipt_mismatch');
    }
    const rows = data.map((row: any) => ({
      id: row.id,
      task: String(row.task || ''),
      estimated_cost: Number(row.estimated_cost || 0),
      completed_at: row.completed_at || null,
      status: row.status,
      iterations: Number(row.iterations || 0),
    })) as RecentComputerUseRun[];
    if (!computerUseHistoryAuthorityIsCurrent(authority, isCurrent)) {
      return exactListFailure(authority, 'authority_retired');
    }
    return {
      ok: true,
      rows,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactListFailure(authority, 'remote_error');
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

/** Exact-id lookup cannot escape the captured circle and never returns late. */
export async function getComputerUseRunExact(
  runId: string,
  authorityInput: ComputerUseHistoryExactAuthority,
  isCurrent: ComputerUseHistoryAuthorityFence,
): Promise<ComputerUseHistoryExactRowResult<ComputerUseRunRow>> {
  const resolved = await resolveComputerUseHistoryExactAuthority(authorityInput, isCurrent);
  if (!resolved.ok) return exactRowFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedRunId = normalizeExactScopePart(runId);
  if (!normalizedRunId) return exactRowFailure(authority, 'scope_mismatch');
  try {
    const { data, error } = await supabase
      .from('computer_use_runs')
      .select('*')
      .eq('id', normalizedRunId)
      .eq('circle_id', authority.circleId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .maybeSingle();
    if (!computerUseHistoryAuthorityIsCurrent(authority, isCurrent)) {
      return exactRowFailure(authority, 'authority_retired');
    }
    if (error) return exactRowFailure(authority, 'remote_error');
    if (data === null) {
      return {
        ok: true,
        row: null,
        userId: authority.userId,
        circleId: authority.circleId,
        generation: authority.generation,
      };
    }
    if (data.id !== normalizedRunId || data.circle_id !== authority.circleId) {
      return exactRowFailure(authority, 'receipt_mismatch');
    }
    if (!computerUseHistoryAuthorityIsCurrent(authority, isCurrent)) {
      return exactRowFailure(authority, 'authority_retired');
    }
    return {
      ok: true,
      row: data as ComputerUseRunRow,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch {
    return exactRowFailure(authority, 'remote_error');
  }
}
