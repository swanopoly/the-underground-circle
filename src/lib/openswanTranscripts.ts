import type { RunSurface } from './agentRunSystem';
import { storage } from './storage';

export type OpenSwanTranscriptEventKind =
  | 'session_started'
  | 'user_turn'
  | 'context_loaded'
  | 'delegation_planned'
  | 'delegation_completed'
  | 'memory_loaded'
  | 'tool_activity'
  | 'browser_plans'
  | 'assistant_response'
  | 'artifacts_rendered'
  | 'verification_completed'
  | 'memory_recommendations'
  | 'run_finalized';

export type OpenSwanTranscriptEvent = {
  id: string;
  at: string;
  kind: OpenSwanTranscriptEventKind;
  title: string;
  summary?: string | null;
  data?: Record<string, unknown>;
};

export type OpenSwanSessionTranscript = {
  key: string;
  runId?: string | null;
  chatSessionId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  surface: RunSurface;
  taskKind?: string | null;
  profile?: string | null;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  events: OpenSwanTranscriptEvent[];
};

const OPENSWAN_TRANSCRIPT_PREFIX = 'uc_openswan_transcript_v1:';
const MAX_TRANSCRIPT_EVENTS = 200;

function buildStorageKey(transcriptKey: string): string {
  return `${OPENSWAN_TRANSCRIPT_PREFIX}${transcriptKey}`;
}

function buildEventId(kind: OpenSwanTranscriptEventKind, at: string): string {
  return `${kind}:${at}:${Math.random().toString(36).slice(2, 8)}`;
}

export function buildOpenSwanTranscriptKey(args: {
  runId?: string | null;
  chatSessionId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  surface: RunSurface;
}): string {
  if (args.chatSessionId) return `chat:${args.chatSessionId}`;
  if (args.runId) return `run:${args.runId}`;
  return [
    'session',
    args.circleId || 'no-circle',
    args.userId || 'no-user',
    args.surface,
  ].join(':');
}

export async function loadOpenSwanTranscript(transcriptKey: string): Promise<OpenSwanSessionTranscript | null> {
  try {
    const raw = await storage.getItem(buildStorageKey(transcriptKey));
    if (!raw) return null;
    return JSON.parse(raw) as OpenSwanSessionTranscript;
  } catch {
    return null;
  }
}

export async function upsertOpenSwanTranscriptHeader(args: {
  transcriptKey: string;
  runId?: string | null;
  chatSessionId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  surface: RunSurface;
  taskKind?: string | null;
  profile?: string | null;
  title?: string | null;
}): Promise<OpenSwanSessionTranscript> {
  const existing = await loadOpenSwanTranscript(args.transcriptKey);
  const timestamp = new Date().toISOString();
  const next: OpenSwanSessionTranscript = existing
    ? {
        ...existing,
        runId: args.runId ?? existing.runId ?? null,
        chatSessionId: args.chatSessionId ?? existing.chatSessionId ?? null,
        circleId: args.circleId ?? existing.circleId ?? null,
        userId: args.userId ?? existing.userId ?? null,
        surface: args.surface || existing.surface,
        taskKind: args.taskKind ?? existing.taskKind ?? null,
        profile: args.profile ?? existing.profile ?? null,
        title: args.title ?? existing.title ?? null,
        updatedAt: timestamp,
      }
    : {
        key: args.transcriptKey,
        runId: args.runId ?? null,
        chatSessionId: args.chatSessionId ?? null,
        circleId: args.circleId ?? null,
        userId: args.userId ?? null,
        surface: args.surface,
        taskKind: args.taskKind ?? null,
        profile: args.profile ?? null,
        title: args.title ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        events: [],
      };

  await storage.setItem(buildStorageKey(args.transcriptKey), JSON.stringify(next));
  return next;
}

export async function appendOpenSwanTranscriptEvent(args: {
  transcriptKey: string;
  event: Omit<OpenSwanTranscriptEvent, 'id' | 'at'> & Partial<Pick<OpenSwanTranscriptEvent, 'id' | 'at'>>;
}): Promise<OpenSwanSessionTranscript> {
  const transcript =
    (await loadOpenSwanTranscript(args.transcriptKey)) ||
    (await upsertOpenSwanTranscriptHeader({
      transcriptKey: args.transcriptKey,
      surface: 'main_chat',
    }));
  const at = args.event.at || new Date().toISOString();
  const event: OpenSwanTranscriptEvent = {
    id: args.event.id || buildEventId(args.event.kind, at),
    at,
    kind: args.event.kind,
    title: args.event.title,
    summary: args.event.summary ?? null,
    data: args.event.data,
  };
  const next: OpenSwanSessionTranscript = {
    ...transcript,
    updatedAt: at,
    events: [...transcript.events, event].slice(-MAX_TRANSCRIPT_EVENTS),
  };
  await storage.setItem(buildStorageKey(args.transcriptKey), JSON.stringify(next));
  return next;
}
