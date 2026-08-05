import { supabase } from '../lib/supabase';
import { useEffect, useState } from 'react';

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

export async function getPendingApprovals(circleId: string): Promise<AgentApproval[]> {
  const { data, error } = await supabase
    .from('agent_approvals')
    .select('*')
    .eq('circle_id', circleId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return data || [];
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

export function useAgentApprovals(circleId?: string): AgentApproval[] {
  const [approvals, setApprovals] = useState<AgentApproval[]>([]);

  useEffect(() => {
    if (!circleId) return;
    getPendingApprovals(circleId).then(setApprovals);
    const channel = supabase
      .channel('agent_approvals_' + circleId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_approvals',
          filter: 'circle_id=eq.' + circleId,
        },
        () => getPendingApprovals(circleId).then(setApprovals),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId]);

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
