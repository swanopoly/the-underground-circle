/**
 * kanban.ts — Types and config for the Trello-style Kanban board
 */

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'peer_review' | 'review' | 'approved' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface KanbanTask {
  id: string;
  circle_id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string | null;
  assigned_agent_id: string | null;
  created_by: string;
  due_date: string | null;
  completed_at: string | null;
  position: number;
  created_at: string;
  goal_id?: string | null;
  // Peer review tracking
  peer_approvals?: string[];  // array of agent_ids that approved
  review_comments_count?: number;
  // Joined relations
  creator?: { username: string; display_name: string };
  assignee?: { username: string; display_name: string } | null;
  goal?: { id: string; name: string; status: string } | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  agent_id: string | null;
  content: string;
  created_at: string;
  user?: { username: string; display_name: string };
}

export interface KanbanColumnDef {
  key: TaskStatus;
  label: string;
  icon: string;
  color: string;
}

export const COLUMNS: KanbanColumnDef[] = [
  { key: 'backlog',     label: 'BACKLOG',      icon: '○', color: '#666680' },
  { key: 'todo',        label: 'TO DO',        icon: '●', color: '#6366f1' },
  { key: 'in_progress', label: 'IN PROGRESS',  icon: '◐', color: '#f59e0b' },
  { key: 'peer_review', label: 'PEER REVIEW',  icon: '◈', color: '#a855f7' },
  { key: 'review',      label: 'REVIEW',       icon: '◎', color: '#f97316' },
  { key: 'approved',    label: 'APPROVED',     icon: '◉', color: '#22c55e' },
  { key: 'done',        label: 'DONE',         icon: '✓', color: '#10b981' },
];

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#555',
  normal: '#888',
  high: '#e89b3e',
  urgent: '#e84040',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'LOW',
  normal: 'NORMAL',
  high: 'HIGH',
  urgent: 'URGENT',
};

const ALL_STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'peer_review', 'review', 'approved', 'done'];

export function normalizeStatus(s: string): TaskStatus {
  if (s === 'open') return 'todo';
  if (ALL_STATUSES.includes(s as TaskStatus)) return s as TaskStatus;
  return 'backlog';
}

export type TasksByColumn = Record<TaskStatus, KanbanTask[]>;

export function groupByColumn(tasks: KanbanTask[]): TasksByColumn {
  const result: TasksByColumn = {
    backlog: [], todo: [], in_progress: [], peer_review: [], review: [], approved: [], done: [],
  };
  for (const t of tasks) {
    const col = normalizeStatus(t.status);
    result[col].push(t);
  }
  // Sort each column by position
  for (const key of Object.keys(result) as TaskStatus[]) {
    result[key].sort((a, b) => a.position - b.position);
  }
  return result;
}

export interface Goal {
  id: string;
  circle_id: string;
  name: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed';
  assigned_agent_ids: string[];
  target_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  auto_task_count?: number;
  auto_task_frequency?: 'day' | 'week';
  last_auto_task_at?: string;
}

// ─── Agent Roles & Profiles ──────────────────────────────────────────────────

export type AgentRole = 'boss' | 'writer' | 'researcher' | 'strategist' | 'executor' | 'designer' | 'reviewer' | 'analyst' | 'custom';

export interface AgentProfile {
  id: string;
  name: string;
  emoji: string;
  role: AgentRole;
  roleLabel: string;
  specialty: string;
  personality: string;
  color: string;
  preferredModel: string;
  preferredProvider: string;
  modelReason: string;
}

export const MODEL_ICONS: Record<string, { icon: string; label: string; color: string }> = {
  'claude-haiku':  { icon: '\u26A1', label: 'Haiku',  color: '#f59e0b' },
  'claude-sonnet': { icon: '\u{1F3AF}', label: 'Sonnet', color: '#8b5cf6' },
  'claude-opus':   { icon: '\u{1F9E0}', label: 'Opus',   color: '#ef4444' },
  'gpt-4o':        { icon: '\u2728', label: 'GPT-4o', color: '#10b981' },
  'gemini-flash':  { icon: '\u264A', label: 'Gemini', color: '#4285f4' },
  'blackswan':     { icon: '\u{1F9A2}', label: 'BlackSwan', color: '#22c55e' },
};

export const DEFAULT_AGENT_ROSTER: AgentProfile[] = [
  { id: 'jon',      name: 'Jon Snow',   emoji: '\u{1F43A}', role: 'boss',       roleLabel: 'Boss',              specialty: 'Task creation, workflow coordination, promoting reviewed work', personality: 'Honorable, decisive, takes responsibility', color: '#555566',  preferredModel: 'claude-sonnet', preferredProvider: 'anthropic', modelReason: 'Coordination requires balanced reasoning and speed' },
  { id: 'tyrion',   name: 'Tyrion',     emoji: '\u{1F377}', role: 'writer',     roleLabel: 'Content Writer',    specialty: 'Tweets, threads, blog posts, landing pages, copy',            personality: 'Witty, clever, sharp prose',                color: '#f59e0b',  preferredModel: 'claude-sonnet', preferredProvider: 'anthropic', modelReason: 'Creative writing needs strong language generation' },
  { id: 'varys',    name: 'Varys',      emoji: '\u{1F577}\uFE0F', role: 'researcher', roleLabel: 'Researcher',        specialty: 'Web research, competitor analysis, data mining',              personality: 'Meticulous, finds hidden data',             color: '#8b5cf6',  preferredModel: 'claude-sonnet', preferredProvider: 'anthropic', modelReason: 'Deep research and synthesis needs strong reasoning' },
  { id: 'daenerys', name: 'Daenerys',   emoji: '\u{1F409}', role: 'strategist', roleLabel: 'Strategist',        specialty: 'Campaign planning, positioning, goal setting',                personality: 'Visionary, strategic, flags misalignment',  color: '#ef4444',  preferredModel: 'claude-opus',   preferredProvider: 'anthropic', modelReason: 'Strategic planning demands deepest reasoning' },
  { id: 'arya',     name: 'Arya',       emoji: '\u2694\uFE0F', role: 'executor',   roleLabel: 'Executor',          specialty: 'Publishing content, running automation, shipping',            personality: 'Fast, precise, no-nonsense',                color: '#22c55e',  preferredModel: 'claude-haiku',  preferredProvider: 'anthropic', modelReason: 'Fast execution — ship quickly, low latency' },
  { id: 'sansa',    name: 'Sansa',      emoji: '\u{1F985}', role: 'designer',   roleLabel: 'Designer',          specialty: 'Design briefs, visual concepts, branding',                    personality: 'Elegant, detail-oriented, brand-aware',     color: '#ec4899',  preferredModel: 'claude-sonnet', preferredProvider: 'anthropic', modelReason: 'Creative design thinking needs nuance' },
  { id: 'sandor',   name: 'Sandor',     emoji: '\u{1F5E1}\uFE0F', role: 'reviewer',   roleLabel: "Devil's Advocate",  specialty: 'Brutal honest feedback, catches BS and AI cliches',           personality: 'Blunt, skeptical, roasts bad work',         color: '#f97316',  preferredModel: 'claude-haiku',  preferredProvider: 'anthropic', modelReason: 'Fast, brutal feedback — speed over depth' },
  { id: 'bran',     name: 'Bran',       emoji: '\u{1F333}', role: 'analyst',    roleLabel: 'Data Analyst',      specialty: 'Analytics, metrics, insights, pattern recognition',           personality: 'Quiet, sees everything, data-driven',       color: '#06b6d4',  preferredModel: 'claude-opus',   preferredProvider: 'anthropic', modelReason: 'Deep data analysis requires maximum reasoning' },
  { id: 'samwell',  name: 'Samwell',    emoji: '\u{1F4DA}', role: 'writer',     roleLabel: 'Documentation',     specialty: 'Documentation, guides, knowledge base, SOPs',                 personality: 'Thorough, careful, encyclopedic',           color: '#84cc16',  preferredModel: 'claude-haiku',  preferredProvider: 'anthropic', modelReason: 'Structured documentation is fast and formulaic' },
  { id: 'petyr',    name: 'Petyr',      emoji: '\u{1F3E6}', role: 'strategist', roleLabel: 'Growth Hacker',     specialty: 'Growth tactics, viral loops, conversion optimization',        personality: 'Cunning, always has an angle',              color: '#a3a3a3',  preferredModel: 'claude-sonnet', preferredProvider: 'anthropic', modelReason: 'Growth strategy needs creative reasoning' },
  { id: 'jorah',    name: 'Jorah',      emoji: '\u{1F6E1}\uFE0F', role: 'executor',   roleLabel: 'QA / Testing',      specialty: 'Quality assurance, testing, bug hunting, edge cases',          personality: 'Loyal, persistent, catches what others miss', color: '#78716c', preferredModel: 'claude-haiku',  preferredProvider: 'anthropic', modelReason: 'Fast test generation and edge case scanning' },
  { id: 'brienne',  name: 'Brienne',    emoji: '\u269C\uFE0F', role: 'reviewer',   roleLabel: 'Code Reviewer',     specialty: 'Code review, architecture feedback, best practices',          personality: 'Principled, thorough, high standards',      color: '#3b82f6',  preferredModel: 'claude-sonnet', preferredProvider: 'anthropic', modelReason: 'Thorough code analysis needs strong reasoning' },
  { id: 'grey_worm', name: 'Grey Worm', emoji: '\u{1F5E1}\uFE0F', role: 'executor',   roleLabel: 'DevOps',            specialty: 'Deployment, CI/CD, infrastructure, monitoring',               personality: 'Disciplined, efficient, reliable',          color: '#64748b',  preferredModel: 'claude-haiku',  preferredProvider: 'anthropic', modelReason: 'Fast infrastructure ops — speed is critical' },
];
