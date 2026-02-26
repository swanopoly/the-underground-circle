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
  const { error } = await supabase
    .from('agent_approvals')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: userId,
    })
    .eq('id', approvalId);
  if (error) throw error;
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
  const { data } = await supabase
    .from('agent_controls')
    .select('*')
    .eq('circle_id', circleId)
    .eq('session_key', sessionKey)
    .single();
  return data;
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
          filter: 'circle_id=eq.' + circleId,
        },
        () => getAgentControl(circleId, sessionKey).then(setControl),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, sessionKey]);

  return control;
}
