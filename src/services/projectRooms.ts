/**
 * Project Rooms Service
 * Supabase-backed shared workspaces where agents group to work on a project.
 * All circle members see the same rooms and agent presence in real time.
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

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
  const { data, error } = await supabase
    .from('project_rooms')
    .update({ status })
    .eq('id', roomId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The project room was not updated. Check your circle access and try again.');
}

export async function deleteRoom(roomId: string): Promise<void> {
  const { data, error } = await supabase
    .from('project_rooms')
    .delete()
    .eq('id', roomId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('The project room was not deleted. Check your circle access and try again.');
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
  const [state, setState] = useState<{
    circleId: string | null;
    rooms: ProjectRoom[];
    isLoading: boolean;
    error: string | null;
  }>({
    circleId: null,
    rooms: [],
    isLoading: true,
    error: null,
  });
  const generationRef = useRef(0);

  const fetch = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!circleId) {
      setState({ circleId: null, rooms: [], isLoading: false, error: null });
      return [];
    }

    setState(previous => ({
      circleId,
      rooms: previous.circleId === circleId ? previous.rooms : [],
      isLoading: previous.circleId !== circleId,
      error: null,
    }));
    try {
      const data = await getRooms(circleId);
      if (generation !== generationRef.current) return undefined;
      setState({ circleId, rooms: data, isLoading: false, error: null });
      return data;
    } catch (loadError) {
      if (generation !== generationRef.current) return undefined;
      setState(previous => ({
        circleId,
        rooms: previous.circleId === circleId ? previous.rooms : [],
        isLoading: false,
        error: errorMessage(loadError, 'Project rooms could not be loaded.'),
      }));
      return null;
    }
  }, [circleId]);

  useEffect(() => {
    void fetch();
    if (!circleId) return () => { generationRef.current += 1; };
    const ch = supabase
      .channel(`project_rooms:${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_rooms', filter: `circle_id=eq.${circleId}` },
        () => { void fetch(); })
      .subscribe();
    return () => {
      generationRef.current += 1;
      supabase.removeChannel(ch);
    };
  }, [circleId, fetch]);

  const isCurrentScope = state.circleId === circleId;
  return {
    rooms: isCurrentScope ? state.rooms : [],
    isLoading: isCurrentScope ? state.isLoading : true,
    error: isCurrentScope ? state.error : null,
    refresh: fetch,
  };
}

export function useRoomAgents(roomId: string | null) {
  const [agents, setAgents] = useState<RoomAgent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const fetch = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!roomId) {
      setAgents([]);
      setError(null);
      setIsLoading(false);
      return [];
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await getRoomAgents(roomId);
      if (generation !== generationRef.current) return undefined;
      setAgents(data);
      return data;
    } catch (loadError) {
      if (generation !== generationRef.current) return undefined;
      setError(errorMessage(loadError, 'Room agents could not be loaded.'));
      return null;
    } finally {
      if (generation === generationRef.current) setIsLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void fetch();
    if (!roomId) return () => { generationRef.current += 1; };
    const ch = supabase
      .channel(`room_agents:${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'project_room_agents', filter: `room_id=eq.${roomId}` },
        () => { void fetch(); })
      .subscribe();
    return () => {
      generationRef.current += 1;
      supabase.removeChannel(ch);
    };
  }, [roomId, fetch]);

  return { agents, isLoading, error, refresh: fetch };
}

export function useRoomActivity(roomId: string | null) {
  const [activity, setActivity] = useState<RoomActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const fetch = useCallback(async () => {
    const generation = ++generationRef.current;
    if (!roomId) {
      setActivity([]);
      setError(null);
      setIsLoading(false);
      return [];
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await getRoomActivity(roomId);
      if (generation !== generationRef.current) return undefined;
      setActivity(data);
      return data;
    } catch (loadError) {
      if (generation !== generationRef.current) return undefined;
      setError(errorMessage(loadError, 'Room activity could not be loaded.'));
      return null;
    } finally {
      if (generation === generationRef.current) setIsLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void fetch();
    if (!roomId) return () => { generationRef.current += 1; };
    const ch = supabase
      .channel(`room_activity:${roomId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'project_room_activity', filter: `room_id=eq.${roomId}` },
        (payload) => setActivity(prev => [payload.new as RoomActivity, ...prev].slice(0, 50)))
      .subscribe();
    return () => {
      generationRef.current += 1;
      supabase.removeChannel(ch);
    };
  }, [roomId, fetch]);

  return { activity, isLoading, error, refresh: fetch };
}
