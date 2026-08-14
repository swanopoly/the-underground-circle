/**
 * Circle Missions — CRUD, realtime, and React hooks
 * See docs/NEXT_LEVEL_PLAN.md Phase 1.1
 */
import { useState, useEffect, useCallback, useRef } from 'react';
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

export interface MissionListOptions {
  /** Archived missions stay out of agent/context lists unless a UI explicitly asks for them. */
  includeArchived?: boolean;
  /** Batch task rows once for list progress instead of opening one detail hook per card. */
  includeTasks?: boolean;
}

const MISSION_TASK_BATCH_SIZE = 100;

async function getTasksForMissionList(missionIds: string[]): Promise<Map<string, MissionTask[]>> {
  const tasksByMission = new Map<string, MissionTask[]>();
  if (missionIds.length === 0) return tasksByMission;

  const chunks: string[][] = [];
  for (let index = 0; index < missionIds.length; index += MISSION_TASK_BATCH_SIZE) {
    chunks.push(missionIds.slice(index, index + MISSION_TASK_BATCH_SIZE));
  }
  const results = await Promise.all(chunks.map((ids) => (
    supabase
      .from('mission_tasks')
      .select('*')
      .in('mission_id', ids)
      .order('sort_order', { ascending: true })
  )));
  for (const { data, error } of results) {
    if (error) {
      console.warn('getMissionTaskSummaries error:', error.message);
      continue;
    }
    for (const task of (data || []) as MissionTask[]) {
      const current = tasksByMission.get(task.mission_id) || [];
      current.push(task);
      tasksByMission.set(task.mission_id, current);
    }
  }
  return tasksByMission;
}

export async function getMissions(
  circleId: string,
  options: MissionListOptions = {},
): Promise<Mission[]> {
  // Simple query without profile join — avoids FK naming issues
  let query = supabase
    .from('circle_missions')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });
  if (!options.includeArchived) query = query.neq('status', 'archived');
  const { data, error } = await query;

  if (error) {
    console.warn('getMissions error:', error.message);
    return [];
  }
  const missions = (data || []) as Mission[];
  if (!options.includeTasks || missions.length === 0) return missions;

  const tasksByMission = await getTasksForMissionList(missions.map((mission) => mission.id));
  return missions.map((mission) => ({
    ...mission,
    tasks: tasksByMission.get(mission.id) || [],
  }));
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
  const { data, error } = await supabase
    .from('mission_tasks')
    .select('*')
    .eq('mission_id', missionId)
    .order('sort_order', { ascending: true });

  if (error) console.warn('getMissionTasks error:', error.message);
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
}): Promise<{ error: string | null; data: { id: string } | null }> {
  const { data, error } = await supabase
    .from('proof_of_work')
    .insert({
      circle_id: entry.circle_id,
      mission_id: entry.mission_id || null,
      user_id: entry.user_id || null,
      agent_name: entry.agent_name || null,
      pow_type: entry.pow_type,
      title: entry.title,
      detail: entry.detail || {},
    })
    .select('id')
    .single();

  return { error: error?.message || null, data: (data as any) || null };
}

// ─── Favorites (per-user mission pins) ───────────────────────────────────────
// Small per-user bookmark so the mission list can float the user's most
// important 1–2 missions to the top. Backed by `mission_favorites`.

export async function getFavoriteMissionIds(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!user) return new Set();
  const { data } = await supabase
    .from('mission_favorites')
    .select('mission_id')
    .eq('user_id', user.id);
  return new Set((data || []).map((r: any) => r.mission_id));
}

export async function setMissionFavorite(missionId: string, favorite: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!user) return;
  if (favorite) {
    // ON CONFLICT DO NOTHING equivalent — primary key (user_id, mission_id)
    // makes the second insert a no-op if the user already pinned it.
    await supabase
      .from('mission_favorites')
      .upsert({ user_id: user.id, mission_id: missionId }, { onConflict: 'user_id,mission_id' });
  } else {
    await supabase
      .from('mission_favorites')
      .delete()
      .eq('user_id', user.id)
      .eq('mission_id', missionId);
  }
}

export function useFavoriteMissions(): { favorites: Set<string>; toggle: (missionId: string) => void; refresh: () => void } {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const refresh = useCallback(() => {
    getFavoriteMissionIds().then(setFavorites).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const toggle = useCallback((missionId: string) => {
    // Optimistic update — the DB call races in the background.
    setFavorites((prev) => {
      const next = new Set(prev);
      const isFav = next.has(missionId);
      if (isFav) next.delete(missionId);
      else next.add(missionId);
      setMissionFavorite(missionId, !isFav).catch(() => {
        // Roll back if the server rejected (RLS, etc.)
        refresh();
      });
      return next;
    });
  }, [refresh]);
  return { favorites, toggle, refresh };
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

export function useMissions(circleId: string, options: MissionListOptions = {}) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const missionIdsRef = useRef<Set<string>>(new Set());
  const includeArchived = options.includeArchived === true;
  const includeTasks = options.includeTasks === true;

  const refresh = useCallback(async () => {
    const data = await getMissions(circleId, { includeArchived, includeTasks });
    missionIdsRef.current = new Set(data.map((mission) => mission.id));
    setMissions(data);
    setLoading(false);
  }, [circleId, includeArchived, includeTasks]);

  useEffect(() => {
    refresh();
    const unsub = subscribeToMissions(circleId, refresh);
    return unsub;
  }, [circleId, refresh]);

  useEffect(() => {
    if (!includeTasks) return;
    // One list-level subscription replaces one query + one realtime channel
    // per mission card. RLS still scopes delivered rows; the local ID set
    // prevents task changes from another accessible circle refreshing this one.
    const channel = supabase
      .channel(`mission-list-tasks:${circleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'mission_tasks',
      }, (payload: any) => {
        const missionId = payload?.new?.mission_id || payload?.old?.mission_id;
        if (missionId && missionIdsRef.current.has(missionId)) void refresh();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, includeTasks, refresh]);

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

/** Compute mission analytics for a circle */
export async function getMissionAnalytics(circleId: string): Promise<{
  totalMissions: number;
  activeMissions: number;
  completedMissions: number;
  totalTasks: number;
  completedTasks: number;
  overdueCount: number;
  completionRate: number;
  avgTasksPerMission: number;
}> {
  const missions = await getMissions(circleId, { includeTasks: true });
  const allMissions = [...missions]; // getMissions excludes archived
  const active = allMissions.filter(m => m.status === 'active');
  const completed = allMissions.filter(m => m.status === 'completed');
  const overdue = active.filter(m => isOverdue(m));

  const sampledTasks = allMissions.slice(0, 20).flatMap((mission) => mission.tasks || []);
  const totalTasks = sampledTasks.length;
  const completedTasks = sampledTasks.filter((task) => task.status === 'done').length;

  return {
    totalMissions: allMissions.length,
    activeMissions: active.length,
    completedMissions: completed.length,
    totalTasks,
    completedTasks,
    overdueCount: overdue.length,
    completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    avgTasksPerMission: allMissions.length > 0 ? Math.round(totalTasks / allMissions.length) : 0,
  };
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
