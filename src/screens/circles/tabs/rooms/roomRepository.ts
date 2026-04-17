// roomRepository.ts — Data access layer for the Rooms module
// Abstracts all Supabase queries; maps snake_case DB columns to camelCase types.

import { supabase } from '../../../../lib/supabase';
import type { RoomSummary, RoomFile, RoomMessage, RoomTask, RoomAgent, RoomService } from './roomTypes';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map a project_rooms row + counts into a RoomSummary. */
function toRoomSummary(
  row: Record<string, any>,
  counts: { files: number; tasks: number; messages: number; agents: number },
): RoomSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    status: row.status ?? 'active',
    circleId: row.circle_id,
    createdBy: row.created_by ?? null,
    fileCount: counts.files,
    taskCount: counts.tasks,
    messageCount: counts.messages,
    activeAgentCount: counts.agents,
    lastActivityAt: row.updated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRoomFile(row: Record<string, any>): RoomFile {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name,
    folder: row.folder ?? '',
    fileType: row.file_type ?? '',
    content: row.content ?? '',
    storageUrl: row.storage_url ?? null,
    mimeType: row.mime_type ?? null,
    sizeBytes: row.size_bytes ?? 0,
    tags: row.tags ?? [],
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted ?? false,
  };
}

function toRoomMessage(row: Record<string, any>): RoomMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id ?? null,
    agentName: row.agent_name ?? null,
    content: row.content ?? '',
    messageType: row.message_type ?? 'chat',
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function toRoomTask(row: Record<string, any>): RoomTask {
  return {
    id: row.id,
    roomId: row.room_id,
    title: row.title ?? row.name ?? '',
    status: row.status ?? 'pending',
    assignedTo: row.assigned_to ?? row.agent ?? null,
    createdAt: row.created_at,
  };
}

function toRoomAgent(row: Record<string, any>): RoomAgent {
  return {
    id: row.id,
    roomId: row.room_id,
    agentName: row.agent_name ?? '',
    agentId: row.agent_session_key ?? row.agent_id ?? '',
    status: row.status ?? 'idle',
    joinedAt: row.joined_at ?? row.created_at ?? '',
  };
}

function toRoomService(row: Record<string, any>): RoomService {
  return {
    id: row.id,
    roomId: row.room_id,
    name: row.name ?? '',
    serviceType: row.type ?? row.service_type ?? '',
    config: row.config ?? {},
    isActive: row.status === 'running',
  };
}

// ─── Room CRUD ───────────────────────────────────────────────────────────────

/** Load all rooms for a circle, with aggregate counts. */
export async function loadRooms(circleId: string): Promise<RoomSummary[]> {
  try {
    const { data: rooms, error } = await supabase
      .from('project_rooms')
      .select('*')
      .eq('circle_id', circleId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    if (!rooms || rooms.length === 0) return [];

    // Fetch counts in parallel for each room
    const summaries = await Promise.all(
      rooms.map(async (room) => {
        const [files, tasks, messages, agents] = await Promise.all([
          supabase.from('room_files').select('id', { count: 'exact', head: true })
            .eq('room_id', room.id).eq('is_deleted', false),
          supabase.from('room_tasks').select('id', { count: 'exact', head: true })
            .eq('room_id', room.id),
          supabase.from('room_messages').select('id', { count: 'exact', head: true })
            .eq('room_id', room.id),
          supabase.from('project_room_agents').select('id', { count: 'exact', head: true })
            .eq('room_id', room.id).neq('status', 'offline'),
        ]);
        return toRoomSummary(room, {
          files: files.count ?? 0,
          tasks: tasks.count ?? 0,
          messages: messages.count ?? 0,
          agents: agents.count ?? 0,
        });
      }),
    );
    return summaries;
  } catch (err) {
    console.error('[roomRepository] loadRooms failed:', err);
    return [];
  }
}

/** Load a single room with counts. */
export async function loadRoom(roomId: string): Promise<RoomSummary | null> {
  try {
    const { data: room, error } = await supabase
      .from('project_rooms')
      .select('*')
      .eq('id', roomId)
      .single();
    if (error || !room) return null;

    const [files, tasks, messages, agents] = await Promise.all([
      supabase.from('room_files').select('id', { count: 'exact', head: true })
        .eq('room_id', roomId).eq('is_deleted', false),
      supabase.from('room_tasks').select('id', { count: 'exact', head: true })
        .eq('room_id', roomId),
      supabase.from('room_messages').select('id', { count: 'exact', head: true })
        .eq('room_id', roomId),
      supabase.from('project_room_agents').select('id', { count: 'exact', head: true })
        .eq('room_id', roomId).neq('status', 'offline'),
    ]);

    return toRoomSummary(room, {
      files: files.count ?? 0,
      tasks: tasks.count ?? 0,
      messages: messages.count ?? 0,
      agents: agents.count ?? 0,
    });
  } catch (err) {
    console.error('[roomRepository] loadRoom failed:', err);
    return null;
  }
}

/** Create a new room. Returns the new room id, or null on failure. */
export async function createRoom(
  circleId: string,
  name: string,
  description?: string,
): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('project_rooms')
      .insert({
        circle_id: circleId,
        name,
        description: description ?? null,
        status: 'active',
        created_by: user?.id ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    console.error('[roomRepository] createRoom failed:', err);
    return null;
  }
}

/** Update room fields (name, description, status). */
export async function updateRoom(
  roomId: string,
  updates: { name?: string; description?: string; status?: string },
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('project_rooms')
      .update(updates)
      .eq('id', roomId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[roomRepository] updateRoom failed:', err);
    return false;
  }
}

/** Hard-delete a room. */
export async function deleteRoom(roomId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('project_rooms')
      .delete()
      .eq('id', roomId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[roomRepository] deleteRoom failed:', err);
    return false;
  }
}

// ─── Files ───────────────────────────────────────────────────────────────────

/** Load non-deleted files for a room, ordered by folder then name. */
export async function loadFiles(roomId: string): Promise<RoomFile[]> {
  try {
    const { data, error } = await supabase
      .from('room_files')
      .select('*')
      .eq('room_id', roomId)
      .eq('is_deleted', false)
      .order('folder')
      .order('name');
    if (error) throw error;
    return (data ?? []).map(toRoomFile);
  } catch (err) {
    console.error('[roomRepository] loadFiles failed:', err);
    return [];
  }
}

/** Load a single file by id. */
export async function loadFile(fileId: string): Promise<RoomFile | null> {
  try {
    const { data, error } = await supabase
      .from('room_files')
      .select('*')
      .eq('id', fileId)
      .single();
    if (error || !data) return null;
    return toRoomFile(data);
  } catch (err) {
    console.error('[roomRepository] loadFile failed:', err);
    return null;
  }
}

/** Create a new file. Returns the new file id, or null on failure. */
export async function createFile(
  roomId: string,
  name: string,
  content: string,
  fileType: string,
): Promise<string | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('room_files')
      .insert({
        room_id: roomId,
        name,
        folder: '',
        file_type: fileType,
        content,
        size_bytes: new Blob([content]).size,
        tags: [],
        created_by: user?.id ?? null,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    console.error('[roomRepository] createFile failed:', err);
    return null;
  }
}

/** Update file content. */
export async function updateFileContent(fileId: string, content: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('room_files')
      .update({
        content,
        size_bytes: new Blob([content]).size,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fileId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[roomRepository] updateFileContent failed:', err);
    return false;
  }
}

/** Soft-delete a file (set is_deleted = true). */
export async function deleteFile(fileId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('room_files')
      .update({ is_deleted: true })
      .eq('id', fileId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[roomRepository] deleteFile failed:', err);
    return false;
  }
}

// ─── Messages ────────────────────────────────────────────────────────────────

/** Load messages for a room, ordered by created_at ascending. */
export async function loadMessages(roomId: string, limit = 200): Promise<RoomMessage[]> {
  try {
    const { data, error } = await supabase
      .from('room_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data ?? []).map(toRoomMessage);
  } catch (err) {
    console.error('[roomRepository] loadMessages failed:', err);
    return [];
  }
}

/** Send a user message. Returns the new message id, or null on failure. */
export async function sendMessage(
  roomId: string,
  userId: string,
  content: string,
  messageType: RoomMessage['messageType'] = 'chat',
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('room_messages')
      .insert({
        room_id: roomId,
        user_id: userId,
        content,
        message_type: messageType,
        metadata: metadata ?? {},
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    console.error('[roomRepository] sendMessage failed:', err);
    return null;
  }
}

/** Send an agent message. Returns the new message id, or null on failure. */
export async function sendAgentMessage(
  roomId: string,
  agentName: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('room_messages')
      .insert({
        room_id: roomId,
        agent_name: agentName,
        content,
        message_type: 'agent_output',
        metadata: metadata ?? {},
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    console.error('[roomRepository] sendAgentMessage failed:', err);
    return null;
  }
}

/** Delete a message by id. */
export async function deleteMessage(messageId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('room_messages')
      .delete()
      .eq('id', messageId);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[roomRepository] deleteMessage failed:', err);
    return false;
  }
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** Load tasks for a room. */
export async function loadTasks(roomId: string): Promise<RoomTask[]> {
  try {
    const { data, error } = await supabase
      .from('room_tasks')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toRoomTask);
  } catch (err) {
    console.error('[roomRepository] loadTasks failed:', err);
    return [];
  }
}

// ─── Agents ──────────────────────────────────────────────────────────────────

/** Load agents currently in a room. */
export async function loadAgents(roomId: string): Promise<RoomAgent[]> {
  try {
    const { data, error } = await supabase
      .from('project_room_agents')
      .select('*')
      .eq('room_id', roomId)
      .order('last_active_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toRoomAgent);
  } catch (err) {
    console.error('[roomRepository] loadAgents failed:', err);
    return [];
  }
}

// ─── Services ────────────────────────────────────────────────────────────────

/** Load services for a room. */
export async function loadServices(roomId: string): Promise<RoomService[]> {
  try {
    const { data, error } = await supabase
      .from('room_services')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at');
    if (error) throw error;
    return (data ?? []).map(toRoomService);
  } catch (err) {
    console.error('[roomRepository] loadServices failed:', err);
    return [];
  }
}

// ─── Realtime Subscriptions ──────────────────────────────────────────────────

/**
 * Subscribe to realtime file changes for a room.
 * Returns an unsubscribe function.
 */
export function subscribeToFiles(
  roomId: string,
  callback: () => void,
): () => void {
  const channel = supabase
    .channel(`room_files:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_files', filter: `room_id=eq.${roomId}` },
      callback,
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/**
 * Subscribe to realtime message changes for a room.
 * Returns an unsubscribe function.
 */
export function subscribeToMessages(
  roomId: string,
  callback: () => void,
): () => void {
  const channel = supabase
    .channel(`room_messages:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_messages', filter: `room_id=eq.${roomId}` },
      callback,
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/**
 * Subscribe to realtime task changes for a room.
 * Returns an unsubscribe function.
 */
export function subscribeToTasks(
  roomId: string,
  callback: () => void,
): () => void {
  const channel = supabase
    .channel(`room_tasks:${roomId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'room_tasks', filter: `room_id=eq.${roomId}` },
      callback,
    )
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}
