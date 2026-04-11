/**
 * Circle Missions — CRUD, realtime, and React hooks
 * See docs/NEXT_LEVEL_PLAN.md Phase 1.1
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type MissionStatus = 'draft' | 'active' | 'completed' | 'archived';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'blocked';
export type AgentRole = 'monitor' | 'executor' | 'reviewer';
export type PowType = 'commit' | 'pr' | 'deploy' | 'agent_run' | 'checkin' | 'manual';

export interface Mission {
  id: string;
  circle_id: string;
  title: string;
  description: string | null;
  owner_id: string;
  status: MissionStatus;
  deadline: string | null;
  template_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  owner_profile?: { display_name: string; username: string };
  tasks?: MissionTask[];
  agents?: MissionAgent[];
}

export interface MissionTask {
  id: string;
  mission_id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  agent_name: string | null;
  status: TaskStatus;
  sort_order: number;
  evidence: any[];
  created_at: string;
  completed_at: string | null;
  // Joined
  assignee_profile?: { display_name: string; username: string };
}

export interface MissionAgent {
  id: string;
  mission_id: string;
  agent_name: string;
  role: AgentRole;
  assigned_at: string;
}

export interface ProofOfWork {
  id: string;
  circle_id: string;
  mission_id: string | null;
  user_id: string | null;
  agent_name: string | null;
  pow_type: PowType;
  title: string;
  detail: Record<string, any>;
  created_at: string;
  // Joined
  user_profile?: { display_name: string; username: string };
}

// ─── Mission CRUD ────────────────────────────────────────────────────────────

export async function getMissions(circleId: string): Promise<Mission[]> {
  // Simple query without profile join — avoids FK naming issues
  const { data, error } = await supabase
    .from('circle_missions')
    .select('*')
    .eq('circle_id', circleId)
    .neq('status', 'archived')
    .order('created_at', { ascending: false });

  if (error) {
    console.warn('getMissions error:', error.message);
    return [];
  }
  return (data || []) as Mission[];
}

export async function getMission(missionId: string): Promise<Mission | null> {
  const { data, error } = await supabase
    .from('circle_missions')
    .select('*')
    .eq('id', missionId)
    .single();

  if (error) return null;
  return data as Mission;
}

export async function createMission(
  circleId: string,
  ownerId: string,
  title: string,
  description?: string,
  deadline?: string,
  templateId?: string,
): Promise<{ mission: Mission | null; error: string | null }> {
  const { data, error } = await supabase
    .from('circle_missions')
    .insert({
      circle_id: circleId,
      owner_id: ownerId,
      title,
      description: description || null,
      deadline: deadline || null,
      template_id: templateId || null,
      status: 'active',
    })
    .select()
    .single();

  if (error) return { mission: null, error: error.message };
  return { mission: data as Mission, error: null };
}

export async function updateMission(
  missionId: string,
  updates: Partial<Pick<Mission, 'title' | 'description' | 'status' | 'deadline'>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('circle_missions')
    .update(updates)
    .eq('id', missionId);

  return { error: error?.message || null };
}

export async function deleteMission(missionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('circle_missions')
    .delete()
    .eq('id', missionId);

  return { error: error?.message || null };
}

// ─── Mission Tasks CRUD ──────────────────────────────────────────────────────

export async function getMissionTasks(missionId: string): Promise<MissionTask[]> {
  const { data } = await supabase
    .from('mission_tasks')
    .select('*')
    .eq('mission_id', missionId)
    .order('sort_order', { ascending: true });

  return (data || []) as MissionTask[];
}

export async function createMissionTask(
  missionId: string,
  title: string,
  opts?: { description?: string; assigneeId?: string; agentName?: string },
): Promise<{ task: MissionTask | null; error: string | null }> {
  const { data, error } = await supabase
    .from('mission_tasks')
    .insert({
      mission_id: missionId,
      title,
      description: opts?.description || null,
      assignee_id: opts?.assigneeId || null,
      agent_name: opts?.agentName || null,
    })
    .select()
    .single();

  if (error) return { task: null, error: error.message };
  return { task: data as MissionTask, error: null };
}

export async function updateMissionTask(
  taskId: string,
  updates: Partial<Pick<MissionTask, 'title' | 'status' | 'assignee_id' | 'agent_name' | 'description'>>,
): Promise<{ error: string | null }> {
  const payload: Record<string, any> = { ...updates };
  if (updates.status === 'done') payload.completed_at = new Date().toISOString();
  if (updates.status && updates.status !== 'done') payload.completed_at = null;

  const { error } = await supabase
    .from('mission_tasks')
    .update(payload)
    .eq('id', taskId);

  return { error: error?.message || null };
}

export async function deleteMissionTask(taskId: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('mission_tasks')
    .delete()
    .eq('id', taskId);

  return { error: error?.message || null };
}

// ─── Mission Agents ──────────────────────────────────────────────────────────

export async function getMissionAgents(missionId: string): Promise<MissionAgent[]> {
  const { data } = await supabase
    .from('mission_agents')
    .select('*')
    .eq('mission_id', missionId);

  return (data || []) as MissionAgent[];
}

export async function assignAgent(
  missionId: string,
  agentName: string,
  role: AgentRole = 'executor',
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('mission_agents')
    .upsert({ mission_id: missionId, agent_name: agentName, role }, { onConflict: 'mission_id,agent_name' });

  return { error: error?.message || null };
}

export async function unassignAgent(missionId: string, agentName: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('mission_agents')
    .delete()
    .eq('mission_id', missionId)
    .eq('agent_name', agentName);

  return { error: error?.message || null };
}

// ─── Proof of Work ───────────────────────────────────────────────────────────

export async function getProofOfWork(circleId: string, limit = 50): Promise<ProofOfWork[]> {
  const { data } = await supabase
    .from('proof_of_work')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []) as ProofOfWork[];
}

export async function getMissionProof(missionId: string): Promise<ProofOfWork[]> {
  const { data } = await supabase
    .from('proof_of_work')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false });

  return (data || []) as ProofOfWork[];
}

export async function addProofOfWork(entry: {
  circle_id: string;
  mission_id?: string;
  user_id?: string;
  agent_name?: string;
  pow_type: PowType;
  title: string;
  detail?: Record<string, any>;
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('proof_of_work')
    .insert({
      circle_id: entry.circle_id,
      mission_id: entry.mission_id || null,
      user_id: entry.user_id || null,
      agent_name: entry.agent_name || null,
      pow_type: entry.pow_type,
      title: entry.title,
      detail: entry.detail || {},
    });

  return { error: error?.message || null };
}

// ─── Realtime subscriptions ──────────────────────────────────────────────────

export function subscribeToMissions(circleId: string, onChange: () => void) {
  const channel = supabase
    .channel(`missions:${circleId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'circle_missions',
      filter: `circle_id=eq.${circleId}`,
    }, onChange)
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

export function subscribeToMissionTasks(missionId: string, onChange: () => void) {
  const channel = supabase
    .channel(`mission-tasks:${missionId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'mission_tasks',
      filter: `mission_id=eq.${missionId}`,
    }, onChange)
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

export function subscribeToProofOfWork(circleId: string, onChange: () => void) {
  const channel = supabase
    .channel(`pow:${circleId}`)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'proof_of_work',
      filter: `circle_id=eq.${circleId}`,
    }, onChange)
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}

// ─── React Hooks ─────────────────────────────────────────────────────────────

export function useMissions(circleId: string) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await getMissions(circleId);
    setMissions(data);
    setLoading(false);
  }, [circleId]);

  useEffect(() => {
    refresh();
    const unsub = subscribeToMissions(circleId, refresh);
    return unsub;
  }, [circleId, refresh]);

  return { missions, loading, refresh };
}

export function useMissionDetail(missionId: string | null) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [tasks, setTasks] = useState<MissionTask[]>([]);
  const [agents, setAgents] = useState<MissionAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!missionId) { setLoading(false); return; }
    const [m, t, a] = await Promise.all([
      getMission(missionId),
      getMissionTasks(missionId),
      getMissionAgents(missionId),
    ]);
    setMission(m);
    setTasks(t);
    setAgents(a);
    setLoading(false);
  }, [missionId]);

  useEffect(() => {
    refresh();
    if (!missionId) return;
    const unsub = subscribeToMissionTasks(missionId, refresh);
    return unsub;
  }, [missionId, refresh]);

  return { mission, tasks, agents, loading, refresh };
}

export function useProofOfWork(circleId: string) {
  const [entries, setEntries] = useState<ProofOfWork[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await getProofOfWork(circleId);
    setEntries(data);
    setLoading(false);
  }, [circleId]);

  useEffect(() => {
    refresh();
    const unsub = subscribeToProofOfWork(circleId, refresh);
    return unsub;
  }, [circleId, refresh]);

  return { entries, loading, refresh };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute mission progress as 0-100 percentage based on task completion */
export function missionProgress(tasks: MissionTask[]): number {
  if (tasks.length === 0) return 0;
  const done = tasks.filter(t => t.status === 'done').length;
  return Math.round((done / tasks.length) * 100);
}

/** Check if a mission is overdue */
export function isOverdue(mission: Mission): boolean {
  if (!mission.deadline) return false;
  return new Date(mission.deadline) < new Date() && mission.status === 'active';
}

/** Format deadline relative to now */
export function formatDeadline(deadline: string | null): string {
  if (!deadline) return 'No deadline';
  const d = new Date(deadline);
  const now = new Date();
  const diff = d.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  if (days <= 7) return `${days}d left`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const POW_ICONS: Record<PowType, string> = {
  commit: '>_',
  pr: '[]',
  deploy: '//',
  agent_run: '$',
  checkin: '#',
  manual: '+',
};

export function powIcon(type: PowType): string {
  return POW_ICONS[type] || '+';
}
