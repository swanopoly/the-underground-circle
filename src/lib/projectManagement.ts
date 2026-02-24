// Project Management System for Multi-Agent Collaboration
import { storage } from './storage';

export interface Project {
  id: string;
  name: string;
  description: string;
  agentIds: string[]; // Agent IDs assigned to this project
  createdAt: string;
  color: string;
}

const STORAGE_KEY_PROJECTS = '@office_projects';

const PROJECT_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#14b8a6', '#f472b6', '#fb923c',
];

// ─── Storage Functions ──────────────────────────────────

export async function loadProjects(): Promise<Project[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_PROJECTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
  } catch {
    console.error('Failed to save projects');
  }
}

export async function createProject(name: string, description: string, agentIds: string[] = []): Promise<Project> {
  const projects = await loadProjects();
  const project: Project = {
    id: `project_${Date.now()}`,
    name,
    description,
    agentIds,
    createdAt: new Date().toISOString(),
    color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
  };
  projects.push(project);
  await saveProjects(projects);
  return project;
}

export async function assignAgentToProject(projectId: string, agentId: string): Promise<void> {
  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  
  if (!project.agentIds.includes(agentId)) {
    project.agentIds.push(agentId);
    await saveProjects(projects);
  }
}

export async function unassignAgentFromProject(projectId: string, agentId: string): Promise<void> {
  const projects = await loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return;
  
  project.agentIds = project.agentIds.filter(id => id !== agentId);
  await saveProjects(projects);
}

export async function deleteProject(projectId: string): Promise<void> {
  const projects = await loadProjects();
  const filtered = projects.filter(p => p.id !== projectId);
  await saveProjects(filtered);
}

export function getAgentProjects(agentId: string, projects: Project[]): Project[] {
  return projects.filter(p => p.agentIds.includes(agentId));
}

export function getProjectAgentIds(projectId: string, projects: Project[]): string[] {
  const project = projects.find(p => p.id === projectId);
  return project?.agentIds || [];
}
