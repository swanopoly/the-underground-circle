// Project Management Compatibility Layer
// Legacy office flows still import this module, but the backing store is now
// the Supabase project_rooms + project_room_agents architecture.

import { supabase } from './supabase';
import { storage } from './storage';

export interface Project {
  id: string;
  name: string;
  description: string;
  agentIds: string[];
  createdAt: string;
  color: string;
}

const STORAGE_KEY_PROJECTS = '@office_projects';
const STORAGE_KEY_PROJECTS_ARCHIVE = '@office_projects_archive';
const STORAGE_KEY_PROJECTS_MIGRATION = '@office_projects_migration';
const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#14b8a6', '#f472b6', '#fb923c',
];

type LegacyProject = Project;

async function loadLegacyProjects(): Promise<LegacyProject[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_PROJECTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveLegacyProjects(projects: LegacyProject[]): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
  } catch {
    console.error('Failed to save legacy projects');
  }
}

async function archiveLegacyProjects(projects: LegacyProject[], mappings: Array<{
  legacyId: string;
  roomId: string;
  name: string;
}>): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY_PROJECTS_ARCHIVE, JSON.stringify({
      archivedAt: new Date().toISOString(),
      count: projects.length,
      mappings,
      projects,
    }));
    await storage.setItem(STORAGE_KEY_PROJECTS_MIGRATION, JSON.stringify({
      migratedAt: new Date().toISOString(),
      count: projects.length,
      mappings,
    }));
    await storage.removeItem(STORAGE_KEY_PROJECTS);
  } catch {
    console.error('Failed to archive migrated legacy projects');
  }
}

async function resolveDefaultCircleId(): Promise<string | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return null;

    const { data } = await supabase
      .from('circle_members')
      .select('circle_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    return data?.[0]?.circle_id || null;
  } catch {
    return null;
  }
}

async function listUserCircleIds(): Promise<string[]> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return [];

    const { data } = await supabase
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', userId)
      .limit(25);

    return Array.from(new Set((data || []).map((row: any) => row.circle_id).filter(Boolean)));
  } catch {
    return [];
  }
}

async function fetchProjectRooms(circleId: string): Promise<Project[]> {
  const { data: rooms, error } = await supabase
    .from('project_rooms')
    .select('id, name, description, color, created_at')
    .eq('circle_id', circleId)
    .order('updated_at', { ascending: false });

  if (error || !rooms) return [];

  const roomIds = rooms.map((room: any) => room.id);
  let agentsByRoom = new Map<string, string[]>();

  if (roomIds.length > 0) {
    const { data: roomAgents } = await supabase
      .from('project_room_agents')
      .select('room_id, agent_session_key, status')
      .in('room_id', roomIds)
      .neq('status', 'offline');

    for (const row of roomAgents || []) {
      const existing = agentsByRoom.get(row.room_id) || [];
      if (row.agent_session_key && !existing.includes(row.agent_session_key)) {
        existing.push(row.agent_session_key);
      }
      agentsByRoom.set(row.room_id, existing);
    }
  }

  return rooms.map((room: any) => ({
    id: room.id,
    name: room.name,
    description: room.description || '',
    agentIds: agentsByRoom.get(room.id) || [],
    createdAt: room.created_at,
    color: room.color || '#6366f1',
  }));
}

export async function loadProjects(circleId?: string): Promise<Project[]> {
  const resolvedCircleId = circleId || await resolveDefaultCircleId();
  if (resolvedCircleId) {
    const rooms = await fetchProjectRooms(resolvedCircleId);
    if (rooms.length > 0) return rooms;
  }
  return loadLegacyProjects();
}

export async function saveProjects(projects: Project[]): Promise<void> {
  // Legacy compatibility only. New writes should use createProject/update room APIs.
  await saveLegacyProjects(projects);
}

export async function createProject(
  name: string,
  description: string,
  agentIds: string[] = [],
  circleId?: string,
): Promise<Project> {
  const resolvedCircleId = circleId || await resolveDefaultCircleId();
  if (!resolvedCircleId) {
    const legacyProjects = await loadLegacyProjects();
    const project: Project = {
      id: `project_${Date.now()}`,
      name,
      description,
      agentIds,
      createdAt: new Date().toISOString(),
      color: PROJECT_COLORS[legacyProjects.length % PROJECT_COLORS.length],
    };
    legacyProjects.push(project);
    await saveLegacyProjects(legacyProjects);
    return project;
  }

  const { data: auth } = await supabase.auth.getUser();
  const { data: room, error } = await supabase
    .from('project_rooms')
    .insert({
      circle_id: resolvedCircleId,
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      description,
      color: PROJECT_COLORS[Math.floor(Math.random() * PROJECT_COLORS.length)],
      created_by: auth.user?.id || null,
    })
    .select()
    .single();

  if (error || !room) {
    throw new Error(error?.message || 'Failed to create project room');
  }

  if (agentIds.length > 0) {
    const rows = agentIds.map((agentId, index) => ({
      room_id: room.id,
      circle_id: resolvedCircleId,
      agent_session_key: agentId,
      agent_name: agentId,
      status: 'active',
      source: 'legacy_project_bridge',
      last_active_at: new Date().toISOString(),
      current_task: null,
      joined_at: new Date().toISOString(),
    }));
    await supabase.from('project_room_agents').upsert(rows as any, { onConflict: 'room_id,agent_session_key' });
  }

  return {
    id: room.id,
    name: room.name,
    description: room.description || '',
    agentIds,
    createdAt: room.created_at,
    color: room.color || '#6366f1',
  };
}

export async function assignAgentToProject(projectId: string, agentId: string): Promise<void> {
  const circleId = await resolveDefaultCircleId();
  if (!circleId) {
    const projects = await loadLegacyProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    if (!project.agentIds.includes(agentId)) {
      project.agentIds.push(agentId);
      await saveLegacyProjects(projects);
    }
    return;
  }

  await supabase.from('project_room_agents').upsert({
    room_id: projectId,
    circle_id: circleId,
    agent_session_key: agentId,
    agent_name: agentId,
    status: 'active',
    source: 'legacy_project_bridge',
    last_active_at: new Date().toISOString(),
  }, { onConflict: 'room_id,agent_session_key' });
}

export async function unassignAgentFromProject(projectId: string, agentId: string): Promise<void> {
  const circleId = await resolveDefaultCircleId();
  if (!circleId) {
    const projects = await loadLegacyProjects();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    project.agentIds = project.agentIds.filter(id => id !== agentId);
    await saveLegacyProjects(projects);
    return;
  }

  await supabase
    .from('project_room_agents')
    .delete()
    .eq('room_id', projectId)
    .eq('agent_session_key', agentId);
}

export async function deleteProject(projectId: string): Promise<void> {
  const circleId = await resolveDefaultCircleId();
  if (!circleId) {
    const projects = await loadLegacyProjects();
    await saveLegacyProjects(projects.filter(p => p.id !== projectId));
    return;
  }

  await supabase.from('project_rooms').delete().eq('id', projectId);
}

export async function migrateLegacyProjectsToSupabase(circleId?: string): Promise<Array<{
  legacyId: string;
  roomId: string;
  name: string;
}>> {
  if (!circleId) {
    const circleIds = await listUserCircleIds();
    if (circleIds.length > 1) {
      throw new Error('Legacy migration is ambiguous because your account belongs to multiple circles. Run migration from a circle-scoped UI path or pass an explicit circleId.');
    }
  }

  const resolvedCircleId = circleId || await resolveDefaultCircleId();
  if (!resolvedCircleId) return [];

  const legacyProjects = await loadLegacyProjects();
  if (legacyProjects.length === 0) return [];

  const existingRooms = await fetchProjectRooms(resolvedCircleId);
  const mappings: Array<{ legacyId: string; roomId: string; name: string }> = [];

  for (const legacy of legacyProjects) {
    const existing = existingRooms.find(room =>
      room.name.trim().toLowerCase() === legacy.name.trim().toLowerCase()
    );
    if (existing) {
      mappings.push({ legacyId: legacy.id, roomId: existing.id, name: existing.name });
      continue;
    }

    const created = await createProject(legacy.name, legacy.description, legacy.agentIds, resolvedCircleId);
    mappings.push({ legacyId: legacy.id, roomId: created.id, name: created.name });
  }

  if (mappings.length > 0) {
    await archiveLegacyProjects(legacyProjects, mappings);
  }

  return mappings;
}

export function getAgentProjects(agentId: string, projects: Project[]): Project[] {
  return projects.filter(p => p.agentIds.includes(agentId));
}

export function getProjectAgentIds(projectId: string, projects: Project[]): string[] {
  const project = projects.find(p => p.id === projectId);
  return project?.agentIds || [];
}
