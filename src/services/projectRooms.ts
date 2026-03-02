/**
 * Project Rooms Service
 * Supabase-backed shared workspaces where agents group to work on a project.
 * All circle members see the same rooms and agent presence in real time.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RoomStatus = 'active' | 'paused' | 'completed';
export type AgentStatus = 'active' | 'idle' | 'offline';
export type ActivityType =
  | 'joined' | 'left'
  | 'task_started' | 'task_completed' | 'task_failed'
  | 'checkpoint' | 'message' | 'file_changed' | 'handoff';

export interface ProjectRoom {
  id: string;
  circle_id: string;
  name: string;
  slug: string;
  description?: string;
  color: string;
  status: RoomStatus;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface RoomAgent {
  id: string;
  room_id: string;
  agent_session_key: string;
  agent_name: string;
  current_task?: string;
  status: AgentStatus;
  source: string;
  joined_at: string;
  last_active_at: string;
}

export interface RoomActivity {
  id: string;
  room_id: string;
  agent_session_key?: string;
  agent_name: string;
  activity_type: ActivityType;
  title: string;
  body?: string;
  metadata: Record<string, any>;
  created_at: string;
}

// ─── Room CRUD ────────────────────────────────────────────────────────────────

export async function getRooms(circleId: string): Promise<ProjectRoom[]> {
  const { data, error } = await supabase
    .from('project_rooms')
    .select('*')
    .eq('circle_id', circleId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createRoom(params: {
  circleId: string;
  name: string;
  description?: string;
  color?: string;
  tags?: string[];
}): Promise<ProjectRoom> {
  const slug = params.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('project_rooms')
    .insert({
      circle_id: params.circleId,
      name: params.name,
      slug,
      description: params.description,
      color: params.color ?? '#6366f1',
      tags: params.tags ?? [],
      created_by: user?.id,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateRoomStatus(roomId: string, status: RoomStatus): Promise<void> {
  const { error } = await supabase
    .from('project_rooms')
    .update({ status })
    .eq('id', roomId);
  if (error) throw error;
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { error } = await supabase.from('project_rooms').delete().eq('id', roomId);
  if (error) throw error;
}

// ─── Agent Presence ───────────────────────────────────────────────────────────

export async function joinRoom(params: {
  roomId: string;
  circleId: string;
  agentSessionKey: string;
  agentName?: string;
  currentTask?: string;
  source?: string;
}): Promise<void> {
  await supabase.from('project_room_agents').upsert({
    room_id: params.roomId,
    circle_id: params.circleId,
    agent_session_key: params.agentSessionKey,
    agent_name: params.agentName ?? 'BlackSwan',
    current_task: params.currentTask,
    status: 'active',
    source: params.source ?? 'system',
    last_active_at: new Date().toISOString(),
  }, { onConflict: 'room_id,agent_session_key' });

  await logActivity({
    roomId: params.roomId,
    circleId: params.circleId,
    agentSessionKey: params.agentSessionKey,
    agentName: params.agentName ?? 'BlackSwan',
    activityType: 'joined',
    title: `${params.agentName ?? 'BlackSwan'} joined the room`,
    source: params.source,
  });
}

export async function leaveRoom(roomId: string, agentSessionKey: string): Promise<void> {
  await supabase
    .from('project_room_agents')
    .update({ status: 'offline' })
    .eq('room_id', roomId)
    .eq('agent_session_key', agentSessionKey);
}

export async function heartbeatRoom(params: {
  roomId: string;
  agentSessionKey: string;
  currentTask?: string;
  status?: AgentStatus;
}): Promise<void> {
  await supabase
    .from('project_room_agents')
    .update({
      last_active_at: new Date().toISOString(),
      current_task: params.currentTask,
      status: params.status ?? 'active',
    })
    .eq('room_id', params.roomId)
    .eq('agent_session_key', params.agentSessionKey);
}

export async function getRoomAgents(roomId: string): Promise<RoomAgent[]> {
  const { data, error } = await supabase
    .from('project_room_agents')
    .select('*')
    .eq('room_id', roomId)
    .order('last_active_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

export async function logActivity(params: {
  roomId: string;
  circleId: string;
  agentSessionKey?: string;
  agentName: string;
  activityType: ActivityType;
  title: string;
  body?: string;
  source?: string;
  metadata?: Record<string, any>;
}): Promise<void> {
  await supabase.from('project_room_activity').insert({
    room_id: params.roomId,
    circle_id: params.circleId,
    agent_session_key: params.agentSessionKey,
    agent_name: params.agentName,
    activity_type: params.activityType,
    title: params.title,
    body: params.body,
    metadata: { source: params.source, ...params.metadata },
  });
}

export async function getRoomActivity(roomId: string, limit = 50): Promise<RoomActivity[]> {
  const { data, error } = await supabase
    .from('project_room_activity')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useProjectRooms(circleId: string | null) {
  const [rooms, setRooms] = useState<ProjectRoom[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!circleId) return;
    const data = await getRooms(circleId).catch(() => []);
    setRooms(data);
    setIsLoading(false);
  }, [circleId]);

  useEffect(() => {
    if (!circleId) return;
    fetch();
    const ch = supabase
      .channel(`project_rooms:${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_rooms', filter: `circle_id=eq.${circleId}` },
        () => fetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [circleId, fetch]);

  return { rooms, isLoading, refresh: fetch };
}

export function useRoomAgents(roomId: string | null) {
  const [agents, setAgents] = useState<RoomAgent[]>([]);

  const fetch = useCallback(async () => {
    if (!roomId) return;
    const data = await getRoomAgents(roomId).catch(() => []);
    setAgents(data);
  }, [roomId]);

  useEffect(() => {
    if (!roomId) return;
    fetch();
    const ch = supabase
      .channel(`room_agents:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_room_agents', filter: `room_id=eq.${roomId}` },
        () => fetch())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId, fetch]);

  return { agents, refresh: fetch };
}

export function useRoomActivity(roomId: string | null) {
  const [activity, setActivity] = useState<RoomActivity[]>([]);

  useEffect(() => {
    if (!roomId) return;
    getRoomActivity(roomId).then(setActivity).catch(() => {});
    const ch = supabase
      .channel(`room_activity:${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_room_activity', filter: `room_id=eq.${roomId}` },
        (payload) => setActivity(prev => [payload.new as RoomActivity, ...prev].slice(0, 50)))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  return { activity };
}
