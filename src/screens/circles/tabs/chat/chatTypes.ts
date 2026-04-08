// chatTypes.ts — Core types for the agent-native ChatTab CLI system

export type ChatMode = 'talk' | 'plan' | 'execute' | 'review';
export type ChatTargetKind = 'blackswan' | 'office-agent' | 'shared-agent';
export type ChatSessionStatus = 'active' | 'running' | 'paused' | 'completed' | 'failed' | 'archived';
export type ChatRunStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'cancelled';
export type ChatEntryRole = 'user' | 'assistant' | 'system';
export type ChatEntryType = 'message' | 'summary' | 'notice' | 'run-link' | 'approval-link';
export type ChatStepKind = 'thought' | 'tool' | 'hf_tool' | 'output' | 'status' | 'approval' | 'error';
export type ChatArtifactKind = 'text' | 'link' | 'file' | 'diff' | 'summary' | 'image' | 'translation' | 'classification' | 'vision' | 'audio' | 'code' | 'webpage';
export type ChatApprovalKind = 'execute' | 'external-write' | 'message-send' | 'sensitive-access';
export type ChatApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ChatContextSourceKind = 'tasks' | 'goals' | 'room' | 'github' | 'members' | 'files' | 'activity' | 'custom';

export interface ChatSession {
  id: string;
  circleId: string;
  createdBy: string;
  title: string;
  status: ChatSessionStatus;
  mode: ChatMode;
  targetKind: ChatTargetKind;
  targetAgentId: string | null;
  model: string | null;
  isPinned: boolean;
  lastEntryAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatEntry {
  id: string;
  sessionId: string;
  circleId: string;
  authorUserId: string | null;
  role: ChatEntryRole;
  entryType: ChatEntryType;
  content: string;
  replyToEntryId: string | null;
  parentEntryId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatRun {
  id: string;
  sessionId: string;
  circleId: string;
  triggeringEntryId: string | null;
  createdBy: string | null;
  targetKind: ChatTargetKind;
  targetAgentId: string | null;
  targetLabel: string;
  mode: ChatMode;
  model: string | null;
  status: ChatRunStatus;
  summary: string | null;
  errorText: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRunStep {
  id: string;
  runId: string;
  sessionId: string;
  circleId: string;
  stepKind: ChatStepKind;
  title: string;
  body: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatRunArtifact {
  id: string;
  runId: string;
  sessionId: string;
  circleId: string;
  artifactKind: ChatArtifactKind;
  title: string;
  content: string | null;
  url: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatRunApproval {
  id: string;
  runId: string;
  sessionId: string;
  circleId: string;
  requestedBy: string | null;
  approvalKind: ChatApprovalKind;
  title: string;
  description: string | null;
  status: ChatApprovalStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ChatContextSource {
  id: string;
  sessionId: string;
  circleId: string;
  sourceKind: ChatContextSourceKind;
  sourceRef: string | null;
  isEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// HF tool action type
export interface ChatToolAction {
  kind: 'hf_tool';
  toolName: string;
  title: string;
  status: 'completed' | 'failed';
  model?: string | null;
  inputPreview?: string | null;
  outputPreview?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChatHfArtifactMetadata {
  toolName: string;
  model?: string | null;
  command?: string | null;
  source?: 'chat_command' | 'assistant_choice';
  [key: string]: unknown;
}

// Command system
export interface ChatCommand {
  name: string;
  description: string;
  usage: string;
  enabled: boolean;
}

export const CHAT_COMMANDS: ChatCommand[] = [
  { name: '/new', description: 'Create a new session', usage: '/new [title]', enabled: true },
  { name: '/resume', description: 'Resume a previous session', usage: '/resume [session]', enabled: true },
  { name: '/plan', description: 'Switch to Plan mode', usage: '/plan [prompt]', enabled: true },
  { name: '/execute', description: 'Switch to Execute mode', usage: '/execute [prompt]', enabled: true },
  { name: '/review', description: 'Switch to Review mode', usage: '/review [prompt]', enabled: true },
  { name: '/talk', description: 'Switch to Talk mode', usage: '/talk [prompt]', enabled: true },
  { name: '/share', description: 'Share session with circle', usage: '/share', enabled: false },
  { name: '/compact', description: 'Summarize and compact history', usage: '/compact', enabled: false },
  // HF tool commands
  { name: '/openmodel', description: 'Ask an open model for a second opinion', usage: '/openmodel [prompt]', enabled: true },
  { name: '/compare-models', description: 'Compare how an open model answers a prompt', usage: '/compare-models [prompt]', enabled: true },
  { name: '/summarize', description: 'Summarize pasted text or recent context', usage: '/summarize [text]', enabled: true },
  { name: '/translate', description: 'Translate text to another language', usage: '/translate to:fr [text]', enabled: true },
  { name: '/vision', description: 'Ask a question about an image or screenshot', usage: '/vision [url] [question]', enabled: true },
  { name: '/qa', description: 'Answer a question from provided context', usage: '/qa q:[question] context:[text]', enabled: true },
  { name: '/classify', description: 'Classify or analyze sentiment', usage: '/classify [text]', enabled: true },
  { name: '/zero-shot', description: 'Classify text into custom labels', usage: '/zero-shot labels:a,b,c text:[text]', enabled: true },
  { name: '/imagine', description: 'Generate an image from a prompt', usage: '/imagine [prompt]', enabled: true },
  { name: '/build-page', description: 'Generate a landing page or web UI draft', usage: '/build-page [brief]', enabled: true },
  { name: '/code', description: 'Generate or refactor code with a coding model', usage: '/code [task]', enabled: true },
  { name: '/speak', description: 'Generate spoken audio from text', usage: '/speak [text]', enabled: true },
  { name: '/transcribe', description: 'Transcribe audio into text', usage: '/transcribe [audio-url]', enabled: true },
];

// Mode display config
export const MODE_CONFIG: Record<ChatMode, { label: string; color: string; icon: string }> = {
  talk: { label: 'Talk', color: '#22c55e', icon: '..' },
  plan: { label: 'Plan', color: '#6366f1', icon: 'P' },
  execute: { label: 'Execute', color: '#f59e0b', icon: '!' },
  review: { label: 'Review', color: '#22d3ee', icon: '?' },
};

// Run status display
export const RUN_STATUS_CONFIG: Record<ChatRunStatus, { label: string; color: string }> = {
  queued: { label: 'Queued', color: '#606075' },
  running: { label: 'Running', color: '#f59e0b' },
  waiting_approval: { label: 'Awaiting Approval', color: '#a855f7' },
  completed: { label: 'Completed', color: '#22c55e' },
  failed: { label: 'Failed', color: '#ef4444' },
  cancelled: { label: 'Cancelled', color: '#606075' },
};
