// chatSessions.ts — Database IO for the agent-native ChatTab CLI system
// All DB interaction for chat_sessions, chat_entries, chat_runs, chat_run_steps,
// chat_run_artifacts, chat_run_approvals, chat_session_context_sources.
// No JSX. Snake_case DB rows mapped to camelCase TypeScript objects.

import { supabase } from './supabase';
import type {
  ChatSession,
  ChatEntry,
  ChatRun,
  ChatRunStep,
  ChatRunArtifact,
  ChatRunApproval,
  ChatContextSource,
  ChatMode,
  ChatTargetKind,
  ChatEntryRole,
  ChatEntryType,
  ChatStepKind,
  ChatArtifactKind,
  ChatApprovalKind,
  ChatApprovalStatus,
} from '../screens/circles/tabs/chat/chatTypes';

// ─── Row mappers (snake_case → camelCase) ─────────────────────────────────────

function mapSession(row: any): ChatSession {
  return {
    id: row.id,
    circleId: row.circle_id,
    createdBy: row.created_by,
    title: row.title,
    status: row.status,
    mode: row.mode,
    targetKind: row.target_kind,
    targetAgentId: row.target_agent_id ?? null,
    model: row.model ?? null,
    isPinned: row.is_pinned,
    lastEntryAt: row.last_entry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntry(row: any): ChatEntry {
  return {
    id: row.id,
    sessionId: row.session_id,
    circleId: row.circle_id,
    authorUserId: row.author_user_id ?? null,
    role: row.role,
    entryType: row.entry_type,
    content: row.content,
    replyToEntryId: row.reply_to_entry_id ?? null,
    parentEntryId: row.parent_entry_id ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapRun(row: any): ChatRun {
  return {
    id: row.id,
    sessionId: row.session_id,
    circleId: row.circle_id,
    triggeringEntryId: row.triggering_entry_id ?? null,
    createdBy: row.created_by ?? null,
    targetKind: row.target_kind,
    targetAgentId: row.target_agent_id ?? null,
    targetLabel: row.target_label,
    mode: row.mode,
    model: row.model ?? null,
    status: row.status,
    summary: row.summary ?? null,
    errorText: row.error_text ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRunStep(row: any): ChatRunStep {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    circleId: row.circle_id,
    stepKind: row.step_kind,
    title: row.title,
    body: row.body ?? null,
    status: row.status,
    sortOrder: row.sort_order,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapArtifact(row: any): ChatRunArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    circleId: row.circle_id,
    artifactKind: row.artifact_kind,
    title: row.title,
    content: row.content ?? null,
    url: row.url ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapApproval(row: any): ChatRunApproval {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    circleId: row.circle_id,
    requestedBy: row.requested_by ?? null,
    approvalKind: row.approval_kind,
    title: row.title,
    description: row.description ?? null,
    status: row.status,
    resolvedBy: row.resolved_by ?? null,
    resolvedAt: row.resolved_at ?? null,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

function mapContextSource(row: any): ChatContextSource {
  return {
    id: row.id,
    sessionId: row.session_id,
    circleId: row.circle_id,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref ?? null,
    isEnabled: row.is_enabled,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  };
}

// ─── Sessions ──────────────────────────────────────────────────────────────────

export async function loadSessions(circleId: string): Promise<ChatSession[]> {
  try {
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('circle_id', circleId)
      .order('last_entry_at', { ascending: false });

    if (error) {
      console.error('loadSessions error:', error);
      return [];
    }
    return (data ?? []).map(mapSession);
  } catch (err) {
    console.error('loadSessions exception:', err);
    return [];
  }
}

export async function createSession(
  circleId: string,
  userId: string,
  title: string,
  mode: ChatMode,
  targetKind: ChatTargetKind,
  model?: string,
): Promise<ChatSession | null> {
  try {
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({
        circle_id: circleId,
        created_by: userId,
        title,
        mode,
        target_kind: targetKind,
        model: model ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('createSession error:', error);
      return null;
    }
    return mapSession(data);
  } catch (err) {
    console.error('createSession exception:', err);
    return null;
  }
}

export async function updateSession(
  sessionId: string,
  updates: Partial<{
    title: string;
    status: string;
    mode: string;
    targetKind: string;
    targetAgentId: string | null;
    model: string | null;
    isPinned: boolean;
    lastEntryAt: string;
  }>,
): Promise<ChatSession | null> {
  try {
    const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (updates.title !== undefined) dbUpdates.title = updates.title;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.mode !== undefined) dbUpdates.mode = updates.mode;
    if (updates.targetKind !== undefined) dbUpdates.target_kind = updates.targetKind;
    if (updates.targetAgentId !== undefined) dbUpdates.target_agent_id = updates.targetAgentId;
    if (updates.model !== undefined) dbUpdates.model = updates.model;
    if (updates.isPinned !== undefined) dbUpdates.is_pinned = updates.isPinned;
    if (updates.lastEntryAt !== undefined) dbUpdates.last_entry_at = updates.lastEntryAt;

    const { data, error } = await supabase
      .from('chat_sessions')
      .update(dbUpdates)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      console.error('updateSession error:', error);
      return null;
    }
    return mapSession(data);
  } catch (err) {
    console.error('updateSession exception:', err);
    return null;
  }
}

// ─── Entries ───────────────────────────────────────────────────────────────────

export async function loadEntries(sessionId: string, limit?: number): Promise<ChatEntry[]> {
  try {
    let query = supabase
      .from('chat_entries')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });

    if (limit) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('loadEntries error:', error);
      return [];
    }
    return (data ?? []).map(mapEntry);
  } catch (err) {
    console.error('loadEntries exception:', err);
    return [];
  }
}

export async function appendEntry(
  sessionId: string,
  circleId: string,
  role: ChatEntryRole,
  content: string,
  authorUserId?: string,
  entryType?: ChatEntryType,
  metadata?: Record<string, unknown>,
): Promise<ChatEntry | null> {
  try {
    const { data, error } = await supabase
      .from('chat_entries')
      .insert({
        session_id: sessionId,
        circle_id: circleId,
        role,
        content,
        author_user_id: authorUserId ?? null,
        entry_type: entryType ?? 'message',
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error('appendEntry error:', error);
      return null;
    }

    // Update session last_entry_at
    const { error: updateErr } = await supabase
      .from('chat_sessions')
      .update({ last_entry_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (updateErr) console.error('appendEntry update session error:', updateErr);

    return mapEntry(data);
  } catch (err) {
    console.error('appendEntry exception:', err);
    return null;
  }
}

// ─── Runs ──────────────────────────────────────────────────────────────────────

export async function createRun(
  sessionId: string,
  circleId: string,
  userId: string,
  triggeringEntryId: string | null,
  targetKind: ChatTargetKind,
  targetLabel: string,
  mode: ChatMode,
  model?: string,
): Promise<ChatRun | null> {
  try {
    const { data, error } = await supabase
      .from('chat_runs')
      .insert({
        session_id: sessionId,
        circle_id: circleId,
        created_by: userId,
        triggering_entry_id: triggeringEntryId,
        target_kind: targetKind,
        target_label: targetLabel,
        mode,
        model: model ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('createRun error:', error);
      return null;
    }
    return mapRun(data);
  } catch (err) {
    console.error('createRun exception:', err);
    return null;
  }
}

export async function updateRun(
  runId: string,
  updates: Partial<{
    status: string;
    summary: string | null;
    errorText: string | null;
    startedAt: string | null;
    completedAt: string | null;
  }>,
): Promise<ChatRun | null> {
  try {
    const dbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.summary !== undefined) dbUpdates.summary = updates.summary;
    if (updates.errorText !== undefined) dbUpdates.error_text = updates.errorText;
    if (updates.startedAt !== undefined) dbUpdates.started_at = updates.startedAt;
    if (updates.completedAt !== undefined) dbUpdates.completed_at = updates.completedAt;

    const { data, error } = await supabase
      .from('chat_runs')
      .update(dbUpdates)
      .eq('id', runId)
      .select()
      .single();

    if (error) {
      console.error('updateRun error:', error);
      return null;
    }
    return mapRun(data);
  } catch (err) {
    console.error('updateRun exception:', err);
    return null;
  }
}

export async function loadRuns(sessionId: string): Promise<ChatRun[]> {
  try {
    const { data, error } = await supabase
      .from('chat_runs')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadRuns error:', error);
      return [];
    }
    return (data ?? []).map(mapRun);
  } catch (err) {
    console.error('loadRuns exception:', err);
    return [];
  }
}

// ─── Run Steps ─────────────────────────────────────────────────────────────────

export async function appendRunStep(
  runId: string,
  sessionId: string,
  circleId: string,
  stepKind: ChatStepKind,
  title: string,
  body?: string,
  sortOrder?: number,
  metadata?: Record<string, unknown>,
): Promise<ChatRunStep | null> {
  try {
    const { data, error } = await supabase
      .from('chat_run_steps')
      .insert({
        run_id: runId,
        session_id: sessionId,
        circle_id: circleId,
        step_kind: stepKind,
        title,
        body: body ?? null,
        sort_order: sortOrder ?? 0,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error('appendRunStep error:', error);
      return null;
    }
    return mapRunStep(data);
  } catch (err) {
    console.error('appendRunStep exception:', err);
    return null;
  }
}

export async function loadRunSteps(runId: string): Promise<ChatRunStep[]> {
  try {
    const { data, error } = await supabase
      .from('chat_run_steps')
      .select('*')
      .eq('run_id', runId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadRunSteps error:', error);
      return [];
    }
    return (data ?? []).map(mapRunStep);
  } catch (err) {
    console.error('loadRunSteps exception:', err);
    return [];
  }
}

// ─── Artifacts ─────────────────────────────────────────────────────────────────

export async function appendArtifact(
  runId: string,
  sessionId: string,
  circleId: string,
  artifactKind: ChatArtifactKind,
  title: string,
  content?: string,
  url?: string,
  metadata?: Record<string, unknown>,
): Promise<ChatRunArtifact | null> {
  try {
    const { data, error } = await supabase
      .from('chat_run_artifacts')
      .insert({
        run_id: runId,
        session_id: sessionId,
        circle_id: circleId,
        artifact_kind: artifactKind,
        title,
        content: content ?? null,
        url: url ?? null,
        metadata: metadata ?? {},
      })
      .select()
      .single();

    if (error) {
      console.error('appendArtifact error:', error);
      return null;
    }
    return mapArtifact(data);
  } catch (err) {
    console.error('appendArtifact exception:', err);
    return null;
  }
}

export async function loadArtifacts(runId: string): Promise<ChatRunArtifact[]> {
  try {
    const { data, error } = await supabase
      .from('chat_run_artifacts')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadArtifacts error:', error);
      return [];
    }
    return (data ?? []).map(mapArtifact);
  } catch (err) {
    console.error('loadArtifacts exception:', err);
    return [];
  }
}

// ─── Approvals ─────────────────────────────────────────────────────────────────

export async function createApproval(
  runId: string,
  sessionId: string,
  circleId: string,
  requestedBy: string,
  approvalKind: ChatApprovalKind,
  title: string,
  description?: string,
): Promise<ChatRunApproval | null> {
  try {
    const { data, error } = await supabase
      .from('chat_run_approvals')
      .insert({
        run_id: runId,
        session_id: sessionId,
        circle_id: circleId,
        requested_by: requestedBy,
        approval_kind: approvalKind,
        title,
        description: description ?? null,
      })
      .select()
      .single();

    if (error) {
      console.error('createApproval error:', error);
      return null;
    }
    return mapApproval(data);
  } catch (err) {
    console.error('createApproval exception:', err);
    return null;
  }
}

export async function resolveApproval(
  approvalId: string,
  resolvedBy: string,
  status: ChatApprovalStatus,
): Promise<ChatRunApproval | null> {
  try {
    const { data, error } = await supabase
      .from('chat_run_approvals')
      .update({
        status,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', approvalId)
      .select()
      .single();

    if (error) {
      console.error('resolveApproval error:', error);
      return null;
    }
    return mapApproval(data);
  } catch (err) {
    console.error('resolveApproval exception:', err);
    return null;
  }
}

export async function loadApprovals(runId: string): Promise<ChatRunApproval[]> {
  try {
    const { data, error } = await supabase
      .from('chat_run_approvals')
      .select('*')
      .eq('run_id', runId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('loadApprovals error:', error);
      return [];
    }
    return (data ?? []).map(mapApproval);
  } catch (err) {
    console.error('loadApprovals exception:', err);
    return [];
  }
}

// ─── Realtime Subscriptions ────────────────────────────────────────────────────

export function subscribeToEntries(
  sessionId: string,
  callback: (entry: ChatEntry) => void,
) {
  const channel = supabase
    .channel(`chat_entries:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_entries',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callback(mapEntry(payload.new));
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToRuns(
  sessionId: string,
  callback: (run: ChatRun) => void,
) {
  const channel = supabase
    .channel(`chat_runs:${sessionId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_runs',
        filter: `session_id=eq.${sessionId}`,
      },
      (payload) => {
        callback(mapRun(payload.new));
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToRunSteps(
  runId: string,
  callback: (step: ChatRunStep) => void,
) {
  const channel = supabase
    .channel(`chat_run_steps:${runId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_run_steps',
        filter: `run_id=eq.${runId}`,
      },
      (payload) => {
        callback(mapRunStep(payload.new));
      },
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
