import { getSupabaseClientForAccessToken, supabase } from '../lib/supabase';
import { useEffect, useState } from 'react';
import { safeGetUserForAccessToken } from '../lib/authSession';

export interface AgentApprovalsExactAuthority {
  userId: string;
  circleId: string;
  accessToken: string;
  authorityGeneration: number;
}

export type AgentApprovalAuthorityGuard = () => boolean;

export type ResolveAgentApprovalResult =
  | { ok: true; approval: AgentApproval }
  | { ok: false; error: string };

export interface AgentApproval {
  id: string;
  circle_id: string;
  session_key: string;
  agent_name: string;
  action_type: string;
  description: string;
  payload: Record<string, any>;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';
  requested_at: string;
  resolved_at?: string;
  timeout_seconds: number;
}

export interface AgentControl {
  id: string;
  circle_id: string;
  session_key: string;
  agent_name: string;
  is_paused: boolean;
  spending_limit_daily: number;
  require_approval_for: string[];
}

export type AgentControlExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type AgentControlAuthorityFence = (
  authority: AgentControlExactAuthority,
) => boolean;

export type AgentControlExactResult =
  | { ok: true; control: AgentControl | null }
  | { ok: false; error: string };

function normalizeAgentControlAuthority(
  circleId: string,
  authority: AgentControlExactAuthority | null | undefined,
): AgentControlExactAuthority | null {
  const userId = String(authority?.userId || '').trim();
  const authorityCircleId = String(authority?.circleId || '').trim();
  const accessToken = String(authority?.accessToken || '').trim();
  const generation = Number(authority?.generation || 0);
  if (
    !circleId
    || !userId
    || authorityCircleId !== circleId
    || !accessToken
    || accessToken.length > 16_384
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId: authorityCircleId, accessToken, generation };
}

function normalizeAgentControlSessionKey(sessionKey: string): string | null {
  const value = String(sessionKey || '').trim();
  return value && value.length <= 240 ? value : null;
}

/**
 * Exact Office control read. It binds the caller-captured bearer, verifies the
 * captured user, and rejects every late result through the supplied lifecycle
 * fence. It never consults the mutable global auth session.
 */
export async function getAgentControlExact(
  circleId: string,
  sessionKey: string,
  capturedAuthority: AgentControlExactAuthority,
  isCurrent: AgentControlAuthorityFence,
): Promise<AgentControlExactResult> {
  const authority = normalizeAgentControlAuthority(circleId, capturedAuthority);
  const exactSessionKey = normalizeAgentControlSessionKey(sessionKey);
  if (!authority || !exactSessionKey || typeof isCurrent !== 'function' || !isCurrent(authority)) {
    return { ok: false, error: 'This agent control belongs to a retired Office session.' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (verifiedUser?.id !== authority.userId || !isCurrent(authority)) {
    return { ok: false, error: 'The signed-in Office account changed while controls were loading.' };
  }
  const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
  const { data, error } = await exactClient
    .from('agent_controls')
    .select('*')
    .eq('circle_id', authority.circleId)
    .eq('session_key', exactSessionKey)
    .maybeSingle();
  if (!isCurrent(authority)) {
    return { ok: false, error: 'The Office session changed while controls were loading.' };
  }
  if (error) return { ok: false, error: 'Agent controls could not be loaded.' };
  if (data && (data.circle_id !== authority.circleId || data.session_key !== exactSessionKey)) {
    return { ok: false, error: 'Agent controls returned an invalid identity receipt.' };
  }
  return { ok: true, control: data || null };
}

/** Exact pause/settings mutation with one verified row receipt. */
export async function upsertAgentControlExact(
  circleId: string,
  sessionKey: string,
  agentName: string,
  updates: Partial<Omit<AgentControl, 'id' | 'circle_id' | 'session_key' | 'agent_name'>>,
  capturedAuthority: AgentControlExactAuthority,
  isCurrent: AgentControlAuthorityFence,
): Promise<AgentControlExactResult> {
  const authority = normalizeAgentControlAuthority(circleId, capturedAuthority);
  const exactSessionKey = normalizeAgentControlSessionKey(sessionKey);
  const exactAgentName = String(agentName || '').trim().slice(0, 200);
  if (
    !authority
    || !exactSessionKey
    || !exactAgentName
    || typeof isCurrent !== 'function'
    || !isCurrent(authority)
  ) return { ok: false, error: 'This agent control belongs to a retired Office session.' };
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (verifiedUser?.id !== authority.userId || !isCurrent(authority)) {
    return { ok: false, error: 'The signed-in Office account changed before the control could be saved.' };
  }
  const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
  const { data, error } = await exactClient
    .from('agent_controls')
    .upsert({
      ...updates,
      circle_id: authority.circleId,
      session_key: exactSessionKey,
      agent_name: exactAgentName,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'circle_id,session_key' })
    .select('*');
  if (!isCurrent(authority)) {
    return { ok: false, error: 'The Office session changed while the control was saving.' };
  }
  if (error) return { ok: false, error: 'Agent controls could not be saved.' };
  const row = Array.isArray(data) && data.length === 1 ? data[0] as AgentControl : null;
  if (
    !row
    || row.circle_id !== authority.circleId
    || row.session_key !== exactSessionKey
    || row.agent_name !== exactAgentName
    || (updates.is_paused !== undefined && row.is_paused !== updates.is_paused)
    || (
      updates.spending_limit_daily !== undefined
      && Number(row.spending_limit_daily) !== Number(updates.spending_limit_daily)
    )
    || (
      updates.require_approval_for !== undefined
      && (
        !Array.isArray(row.require_approval_for)
        || row.require_approval_for.length !== updates.require_approval_for.length
        || row.require_approval_for.some((value, index) => value !== updates.require_approval_for?.[index])
      )
    )
  ) return { ok: false, error: 'Agent controls returned an invalid save receipt.' };
  return { ok: true, control: row };
}

export async function requestApproval(
  circleId: string,
  sessionKey: string,
  agentName: string,
  actionType: string,
  description: string,
  payload?: Record<string, any>,
  timeoutSeconds = 300,
): Promise<AgentApproval> {
  const { data, error } = await supabase
    .from('agent_approvals')
    .insert({
      circle_id: circleId,
      session_key: sessionKey,
      agent_name: agentName,
      action_type: actionType,
      description,
      payload: payload || {},
      timeout_seconds: timeoutSeconds,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function resolveApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  userId: string,
): Promise<void> {
  // Pending-only transition (mirrors runApprovalsService.resolveRunApproval):
  // a late click after another approver — or after expiry — must not flip an
  // already-resolved row. 0 rows matched → silent no-op (the realtime refresh
  // clears the card); real errors still throw. Downstream apply is safe either
  // way: agentApprovalsWorker re-checks status + applied_at itself.
  const { data, error } = await supabase
    .from('agent_approvals')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq('id', approvalId)
    .eq('status', 'pending')
    .select('id');
  if (error) throw error;
  if (!Array.isArray(data) || data.length === 0) return; // already resolved/expired
}

/**
 * Office-safe pending-only decision. The captured bearer is verified as the
 * captured user, the row is bound to the captured circle, and a returned row
 * must prove who resolved it before the UI may continue to any runtime-owned
 * action. A retired lifecycle always fails closed.
 */
export async function resolveApprovalExact(
  approvalId: string,
  status: 'approved' | 'rejected',
  authority: AgentApprovalsExactAuthority,
  isCurrent: AgentApprovalAuthorityGuard,
): Promise<ResolveAgentApprovalResult> {
  const id = String(approvalId || '').trim();
  const userId = String(authority?.userId || '').trim();
  const circleId = String(authority?.circleId || '').trim();
  const accessToken = String(authority?.accessToken || '').trim();
  if (
    !id
    || !userId
    || !circleId
    || !accessToken
    || accessToken.length > 16_384
    || !Number.isSafeInteger(authority?.authorityGeneration)
    || authority.authorityGeneration <= 0
    || !isCurrent()
  ) return { ok: false, error: 'This approval belongs to a retired Office session.' };
  const { value: verifiedUser } = await safeGetUserForAccessToken(accessToken);
  if (verifiedUser?.id !== userId || !isCurrent()) {
    return { ok: false, error: 'The signed-in Office account changed before this approval could be resolved.' };
  }
  const { data, error } = await supabase
    .from('agent_approvals')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq('id', id)
    .eq('circle_id', circleId)
    .eq('status', 'pending')
    .setHeader('Authorization', `Bearer ${accessToken}`)
    .select('*');
  if (!isCurrent()) {
    return { ok: false, error: 'The Office account changed while the approval was resolving.' };
  }
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) && data.length === 1 ? data[0] as AgentApproval & { resolved_by?: string } : null;
  if (
    !row
    || row.id !== id
    || row.circle_id !== circleId
    || row.status !== status
    || row.resolved_by !== userId
  ) {
    return { ok: false, error: 'This approval is no longer pending or its resolution receipt was invalid.' };
  }
  return { ok: true, approval: row };
}

export async function getPendingApprovals(
  circleId: string,
  authority?: AgentApprovalsExactAuthority | null,
): Promise<AgentApproval[]> {
  const normalizedCircleId = String(circleId || '').trim();
  const normalizedUserId = String(authority?.userId || '').trim();
  const authorityCircleId = String(authority?.circleId || '').trim();
  const accessToken = String(authority?.accessToken || '').trim();
  if (authority && (
    !normalizedCircleId
    || !normalizedUserId
    || authorityCircleId !== normalizedCircleId
    || !accessToken
    || !Number.isSafeInteger(authority.authorityGeneration)
    || authority.authorityGeneration <= 0
  )) return [];
  if (authority) {
    const { value: verifiedUser } = await safeGetUserForAccessToken(accessToken);
    if (verifiedUser?.id !== normalizedUserId) return [];
  }
  let query = supabase
    .from('agent_approvals')
    .select('*')
    .eq('circle_id', normalizedCircleId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (authority) query = query.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).filter((row) => row?.circle_id === normalizedCircleId);
}

export async function getAgentControl(
  circleId: string,
  sessionKey: string,
): Promise<AgentControl | null> {
  try {
    const { data, error } = await supabase
      .from('agent_controls')
      .select('*')
      .eq('circle_id', circleId)
      .eq('session_key', sessionKey)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * O4: the most restrictive `spending_limit_daily` configured across the
 * circle's agent control rows, in USD. Controls are per office agent
 * (session_key), but subagent delegation is a circle-level multiplier on
 * spend, so the gate honors the tightest configured budget. Returns null
 * when no control row exists or the read fails — callers treat null as
 * "no limit configured" (the delegation budget guard fails open).
 */
export async function getCircleMinSpendingLimit(circleId: string): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('agent_controls')
      .select('spending_limit_daily')
      .eq('circle_id', circleId);
    if (error || !data || data.length === 0) return null;
    const limits = data
      .map(row => Number(row.spending_limit_daily))
      .filter(value => Number.isFinite(value) && value >= 0);
    if (limits.length === 0) return null;
    return Math.min(...limits);
  } catch {
    return null;
  }
}

export async function upsertAgentControl(
  circleId: string,
  sessionKey: string,
  agentName: string,
  updates: Partial<Omit<AgentControl, 'id' | 'circle_id' | 'session_key' | 'agent_name'>>,
): Promise<void> {
  const { error } = await supabase.from('agent_controls').upsert(
    {
      circle_id: circleId,
      session_key: sessionKey,
      agent_name: agentName,
      ...updates,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'circle_id,session_key' },
  );
  if (error) throw error;
}

export function useAgentApprovals(
  circleId?: string,
  authority?: AgentApprovalsExactAuthority | null,
): AgentApproval[] {
  const [approvals, setApprovals] = useState<AgentApproval[]>([]);
  const authorityKey = authority
    ? `${authority.userId}\u0000${authority.circleId}\u0000${authority.accessToken}\u0000${authority.authorityGeneration}`
    : 'compatibility';

  useEffect(() => {
    let cancelled = false;
    setApprovals([]);
    if (!circleId) return () => { cancelled = true; };
    const capturedAuthority = authority ? { ...authority } : null;
    const publish = (rows: AgentApproval[]) => {
      if (!cancelled) setApprovals(rows);
    };
    const refresh = () => getPendingApprovals(circleId, capturedAuthority).then(publish).catch(() => {});
    void refresh();
    const channel = supabase
      .channel(`agent_approvals_${circleId}_${capturedAuthority?.userId || 'compat'}_${capturedAuthority?.authorityGeneration || 0}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_approvals',
          filter: 'circle_id=eq.' + circleId,
        },
        () => { void refresh(); },
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [authorityKey, circleId]);

  return approvals;
}

export function useAgentControl(
  circleId?: string,
  sessionKey?: string,
): AgentControl | null {
  const [control, setControl] = useState<AgentControl | null>(null);

  useEffect(() => {
    if (!circleId || !sessionKey) return;
    getAgentControl(circleId, sessionKey).then(setControl);
    const channel = supabase
      .channel('agent_control_' + circleId + '_' + sessionKey)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_controls',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload: any) => {
          // Only refetch if this change is for our session
          if (!payload.new?.session_key || payload.new.session_key === sessionKey) {
            getAgentControl(circleId, sessionKey).then(setControl);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, sessionKey]);

  return control;
}
