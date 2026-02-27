import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type ActivitySource = 'discord' | 'webchat' | 'cron' | 'system';
export type ActivityType =
  | 'message_in'
  | 'message_out'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'tool_call';
export type ActivityStatus = 'running' | 'completed' | 'failed';

export interface AgentActivity {
  id: string;
  circle_id: string;
  agent_name: string;
  source: ActivitySource;
  source_detail?: string;
  activity_type: ActivityType;
  title: string;
  body?: string;
  status: ActivityStatus;
  metadata: Record<string, any>;
  created_at: string;
}

export interface LogActivityParams {
  circle_id: string;
  agent_name?: string;
  source: ActivitySource;
  source_detail?: string;
  activity_type: ActivityType;
  title: string;
  body?: string;
  status?: ActivityStatus;
  metadata?: Record<string, any>;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const { error } = await supabase.from('agent_activity').insert({
    circle_id: params.circle_id,
    agent_name: params.agent_name ?? 'SwanBot',
    source: params.source,
    source_detail: params.source_detail,
    activity_type: params.activity_type,
    title: params.title,
    body: params.body,
    status: params.status ?? 'completed',
    metadata: params.metadata ?? {},
  });
  if (error) {
    console.warn('[agentActivityLogger] Insert failed:', error.message);
  }
}

export function useAgentActivity(circleId: string | null) {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    if (!circleId) return;
    const { data, error } = await supabase
      .from('agent_activity')
      .select('*')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(500);
    if (!error && data) {
      setActivities(data as AgentActivity[]);
    }
    setIsLoading(false);
  }, [circleId]);

  useEffect(() => {
    if (!circleId) return;
    fetchActivities();

    // Realtime subscription
    const channel = supabase
      .channel(`agent_activity:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_activity',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload) => {
          setActivities((prev) => [payload.new as AgentActivity, ...prev].slice(0, 500));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, fetchActivities]);

  return { activities, isLoading, refresh: fetchActivities };
}
