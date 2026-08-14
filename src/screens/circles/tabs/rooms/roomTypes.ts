// roomTypes.ts — Canonical types for the Rooms module

export type RoomStatus = 'active' | 'paused' | 'archived' | 'completed';
export type RoomSection = 'overview' | 'files' | 'chat' | 'runs' | 'tasks' | 'integrations' | 'settings';

export interface RoomSummary {
  id: string;
  name: string;
  description: string | null;
  status: RoomStatus;
  circleId: string;
  createdBy: string | null;
  fileCount: number;
  taskCount: number;
  messageCount: number;
  activeAgentCount: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomFile {
  id: string;
  roomId: string;
  name: string;
  folder: string;
  fileType: string;
  content: string;
  storageUrl: string | null;
  mimeType: string | null;
  sizeBytes: number;
  tags: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  userId: string | null;
  agentName: string | null;
  content: string;
  messageType: 'chat' | 'agent_output' | 'edit_event' | 'system' | 'playground';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RoomTask {
  id: string;
  roomId: string;
  title: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  assignedTo: string | null;
  createdAt: string;
}

export interface RoomAgent {
  id: string;
  roomId: string;
  agentName: string;
  agentId: string;
  status: string;
  joinedAt: string;
}

export interface RoomService {
  id: string;
  roomId: string;
  name: string;
  serviceType: string;
  config: Record<string, unknown>;
  isActive: boolean;
}

// Section navigation config
export const ROOM_SECTIONS: { key: RoomSection; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'O' },
  { key: 'files', label: 'Files', icon: 'F' },
  { key: 'chat', label: 'Chat', icon: '..' },
  { key: 'runs', label: 'Runs', icon: '>' },
  { key: 'tasks', label: 'Tasks', icon: 'T' },
  { key: 'integrations', label: 'Marketplace', icon: '<>' },
  { key: 'settings', label: 'Settings', icon: '*' },
];

// Chat presets — replace hidden regex inference with explicit buttons
export interface ChatPreset {
  id: string;
  label: string;
  icon: string;
  color: string;
  prompt: string;
}

export const ROOM_CHAT_PRESETS: ChatPreset[] = [
  { id: 'review', label: 'Review Room', icon: '?', color: '#6366f1', prompt: '[CODE REVIEW MODE] Review all files in this room for correctness, bugs, and code quality.' },
  { id: 'security', label: 'Security Audit', icon: '!', color: '#ef4444', prompt: '[SECURITY AUDIT MODE] Analyze all files for security vulnerabilities.' },
  { id: 'performance', label: 'Performance', icon: '#', color: '#f59e0b', prompt: '[PERFORMANCE REVIEW MODE] Analyze all files for performance issues.' },
  { id: 'tests', label: 'Generate Tests', icon: 'T', color: '#22c55e', prompt: '[TEST GENERATION MODE] Generate comprehensive tests for the code.' },
  { id: 'research', label: 'Research', icon: 'R', color: '#6366f1', prompt: '[DEEP RESEARCH MODE] Provide thorough analysis.' },
  { id: 'debug', label: 'Debug', icon: 'D', color: '#a855f7', prompt: '[DEBUG MODE] Help diagnose and fix issues.' },
  { id: 'refactor', label: 'Refactor', icon: '{', color: '#ec4899', prompt: '[REFACTOR MODE] Suggest refactoring improvements.' },
  { id: 'docs', label: 'Docs', icon: 'D', color: '#3b82f6', prompt: '[DOCUMENTATION MODE] Generate documentation.' },
];
