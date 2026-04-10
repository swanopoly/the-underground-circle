/**
 * Unified Agent Run System
 *
 * Single API for creating, tracking, and completing agent runs across ALL surfaces.
 * Replaces surface-specific run tracking with shared primitives.
 *
 * Surfaces: main_chat, room_chat, feed_task, office_terminal, floating_chat, scheduled, api
 */

import { supabase } from './supabase';

// ── Types ───────────────────────────────────────────────────────────────────

export type RunSurface = 'main_chat' | 'room_chat' | 'feed_task' | 'office_terminal' | 'floating_chat' | 'scheduled' | 'api';
export type RunStatus = 'queued' | 'planning' | 'running' | 'waiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepKind = 'plan' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'artifact_create' | 'approval_request' | 'approval_result' | 'delegation' | 'error' | 'finalize' | 'context_edit';
export type ArtifactKind = 'text' | 'code_patch' | 'image' | 'screenshot' | 'report' | 'webpage' | 'table' | 'research_brief' | 'design_spec' | 'social_post' | 'email_draft' | 'spec_doc' | 'checklist' | 'link_bundle' | 'audio' | 'video' | 'file' | 'diff' | 'translation' | 'classification' | 'test_result';
export type ApprovalKind = 'tool_use' | 'publish' | 'external_send' | 'file_write' | 'browser_action' | 'cost_threshold' | 'privileged_action' | 'plan_approval' | 'deliverable_review';
export type MemoryScope = 'org' | 'circle' | 'room' | 'user' | 'session';
export type MemoryKind = 'fact' | 'instruction' | 'preference' | 'decision' | 'finding' | 'policy' | 'context';
export type SessionMemoryMode = 'private' | 'shared';

export interface AgentRun {
  id: string;
  circle_id: string;
  user_id: string;
  surface: RunSurface;
  room_id?: string;
  task_id?: string;
  chat_session_id?: string;
  title: string;
  goal?: string;
  mode: string;
  model?: string;
  provider?: string;
  status: RunStatus;
  plan_summary?: string;
  current_step_index: number;
  total_steps: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  estimated_cost: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  parent_run_id?: string;
  delegated_to?: string;
  metadata: Record<string, unknown>;
}

export interface RunStep {
  id: string;
  run_id: string;
  step_index: number;
  step_kind: StepKind;
  title: string;
  body?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  delegated_to?: string;
  child_run_id?: string;
  status: string;
  duration_ms?: number;
  tokens_used: number;
  created_at: string;
}

export interface RunArtifact {
  id: string;
  run_id: string;
  step_id?: string;
  artifact_kind: ArtifactKind;
  title: string;
  content?: string;
  url?: string;
  file_path?: string;
  version: number;
  is_published: boolean;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface RunApproval {
  id: string;
  run_id: string;
  approval_kind: ApprovalKind;
  title: string;
  description?: string;
  payload: Record<string, unknown>;
  status: string;
  requested_by?: string;
  resolved_by?: string;
  requested_at: string;
  resolved_at?: string;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  circle_id?: string;
  room_id?: string;
  user_id?: string;
  session_id?: string;
  memory_kind: MemoryKind;
  title: string;
  content: string;
  source_run_id?: string;
  source_surface?: string;
  is_active: boolean;
  visibility?: 'private' | 'room_shared' | 'circle_shared' | 'org_shared';
  importance?: number;
  retrieval_mode?: 'startup' | 'on_demand' | 'manual_only';
  status?: string;
  access_count?: number;
  last_accessed_at?: string;
  updated_at?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export async function getCircleSessionMemoryMode(circleId: string): Promise<SessionMemoryMode> {
  const { data } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .single();

  return data?.settings?.sessionMemoryMode === 'shared' ? 'shared' : 'private';
}

// ── 1. Create Run ───────────────────────────────────────────────────────────

export async function createRun(opts: {
  circleId: string;
  userId: string;
  surface: RunSurface;
  title: string;
  goal?: string;
  mode?: string;
  model?: string;
  provider?: string;
  roomId?: string;
  taskId?: string;
  chatSessionId?: string;
  parentRunId?: string;
  delegatedTo?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentRun | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      circle_id: opts.circleId,
      user_id: opts.userId,
      surface: opts.surface,
      title: opts.title,
      goal: opts.goal,
      mode: opts.mode || 'talk',
      model: opts.model,
      provider: opts.provider,
      room_id: opts.roomId,
      task_id: opts.taskId,
      chat_session_id: opts.chatSessionId,
      parent_run_id: opts.parentRunId,
      delegated_to: opts.delegatedTo,
      status: 'queued',
      metadata: opts.metadata || {},
    })
    .select()
    .single();

  if (error) { console.error('[AgentRunSystem] createRun error:', error); return null; }
  return mapRun(data);
}

// ── 2. Update Run Status ────────────────────────────────────────────────────

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  extra?: Partial<{ plan_summary: string; current_step_index: number; total_steps: number; completed_at: string; input_tokens: number; output_tokens: number; cached_tokens: number; estimated_cost: number; started_at: string }>,
): Promise<boolean> {
  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'running' && !extra?.started_at) updates.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'failed' || status === 'cancelled') updates.completed_at = new Date().toISOString();
  if (extra) Object.assign(updates, extra);

  const { error } = await supabase.from('agent_runs').update(updates).eq('id', runId);
  if (error) { console.error('[AgentRunSystem] updateRunStatus error:', error); return false; }
  return true;
}

// ── 3. Add Step ─────────────────────────────────────────────────────────────

export async function addStep(opts: {
  runId: string;
  circleId: string;
  stepIndex: number;
  stepKind: StepKind;
  title: string;
  body?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  delegatedTo?: string;
  childRunId?: string;
  status?: string;
  durationMs?: number;
  tokensUsed?: number;
}): Promise<RunStep | null> {
  const { data, error } = await supabase
    .from('agent_run_steps')
    .insert({
      run_id: opts.runId,
      circle_id: opts.circleId,
      step_index: opts.stepIndex,
      step_kind: opts.stepKind,
      title: opts.title,
      body: opts.body,
      tool_name: opts.toolName,
      tool_input: opts.toolInput,
      tool_output: opts.toolOutput,
      delegated_to: opts.delegatedTo,
      child_run_id: opts.childRunId,
      status: opts.status || 'completed',
      duration_ms: opts.durationMs,
      tokens_used: opts.tokensUsed || 0,
    })
    .select()
    .single();

  if (error) { console.error('[AgentRunSystem] addStep error:', error); return null; }
  return mapStep(data);
}

// ── 4. Add Artifact ─────────────────────────────────────────────────────────

export async function addArtifact(opts: {
  runId: string;
  circleId: string;
  stepId?: string;
  artifactKind: ArtifactKind;
  title: string;
  content?: string;
  url?: string;
  filePath?: string;
  metadata?: Record<string, unknown>;
}): Promise<RunArtifact | null> {
  const { data, error } = await supabase
    .from('agent_run_artifacts')
    .insert({
      run_id: opts.runId,
      circle_id: opts.circleId,
      step_id: opts.stepId,
      artifact_kind: opts.artifactKind,
      title: opts.title,
      content: opts.content,
      url: opts.url,
      file_path: opts.filePath,
      metadata: opts.metadata || {},
    })
    .select()
    .single();

  if (error) { console.error('[AgentRunSystem] addArtifact error:', error); return null; }
  return mapArtifact(data);
}

// ── 5. Request Approval ─────────────────────────────────────────────────────

export async function requestRunApproval(opts: {
  runId: string;
  circleId: string;
  stepId?: string;
  approvalKind: ApprovalKind;
  title: string;
  description?: string;
  requestedBy?: string;
  payload?: Record<string, unknown>;
  timeoutSeconds?: number;
}): Promise<RunApproval | null> {
  const { data, error } = await supabase
    .from('agent_run_approvals')
    .insert({
      run_id: opts.runId,
      circle_id: opts.circleId,
      step_id: opts.stepId,
      approval_kind: opts.approvalKind,
      title: opts.title,
      description: opts.description,
      requested_by: opts.requestedBy,
      payload: opts.payload || {},
      timeout_seconds: opts.timeoutSeconds || 300,
    })
    .select()
    .single();

  if (error) { console.error('[AgentRunSystem] requestApproval error:', error); return null; }
  return mapApproval(data);
}

export async function resolveRunApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  userId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('agent_run_approvals')
    .update({ status, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', approvalId);
  return !error;
}

// ── 6. Query Runs ───────────────────────────────────────────────────────────

export async function getRun(runId: string): Promise<AgentRun | null> {
  const { data, error } = await supabase.from('agent_runs').select('*').eq('id', runId).single();
  if (error || !data) return null;
  return mapRun(data);
}

export async function listRuns(
  circleId: string,
  opts?: { surface?: RunSurface; status?: RunStatus; roomId?: string; userId?: string; limit?: number },
): Promise<AgentRun[]> {
  let query = supabase.from('agent_runs').select('*').eq('circle_id', circleId).order('created_at', { ascending: false }).limit(opts?.limit || 50);
  if (opts?.surface) query = query.eq('surface', opts.surface);
  if (opts?.status) query = query.eq('status', opts.status);
  if (opts?.roomId) query = query.eq('room_id', opts.roomId);
  if (opts?.userId) query = query.eq('user_id', opts.userId);
  const { data, error } = await query;
  if (error || !data) return [];
  return data.map(mapRun);
}

export async function getActiveRuns(circleId: string): Promise<AgentRun[]> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('circle_id', circleId)
    .in('status', ['queued', 'planning', 'running', 'waiting_approval', 'paused'])
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(mapRun);
}

export async function getRunSteps(runId: string): Promise<RunStep[]> {
  const { data, error } = await supabase.from('agent_run_steps').select('*').eq('run_id', runId).order('step_index');
  if (error || !data) return [];
  return data.map(mapStep);
}

export async function getRunArtifacts(runId: string): Promise<RunArtifact[]> {
  const { data, error } = await supabase.from('agent_run_artifacts').select('*').eq('run_id', runId).order('created_at');
  if (error || !data) return [];
  return data.map(mapArtifact);
}

export async function getPendingApprovals(circleId: string): Promise<RunApproval[]> {
  const { data, error } = await supabase.from('agent_run_approvals').select('*').eq('circle_id', circleId).eq('status', 'pending').order('requested_at', { ascending: false });
  if (error || !data) return [];
  return data.map(mapApproval);
}

// ── 7. Memory System ────────────────────────────────────────────────────────

export async function saveMemory(opts: {
  scope: MemoryScope;
  circleId?: string;
  roomId?: string;
  userId?: string;
  sessionId?: string;
  memoryKind: MemoryKind;
  title: string;
  content: string;
  sourceRunId?: string;
  sourceSurface?: string;
  visibility?: 'private' | 'room_shared' | 'circle_shared' | 'org_shared';
  importance?: number;
  retrievalMode?: 'startup' | 'on_demand' | 'manual_only';
  metadata?: Record<string, unknown>;
}): Promise<MemoryEntry | null> {
  // Auto-set visibility based on scope
  const visibility = opts.visibility || (
    opts.scope === 'user' ? 'private' :
    opts.scope === 'room' ? 'room_shared' :
    opts.scope === 'session' ? 'private' :
    'circle_shared'
  );

  const { data, error } = await supabase
    .from('memory_entries')
    .insert({
      scope: opts.scope,
      circle_id: opts.circleId,
      room_id: opts.roomId,
      user_id: opts.userId,
      session_id: opts.sessionId,
      memory_kind: opts.memoryKind,
      title: opts.title,
      content: opts.content,
      source_run_id: opts.sourceRunId,
      source_surface: opts.sourceSurface,
      visibility,
      importance: opts.importance,
      retrieval_mode: opts.retrievalMode,
      metadata: opts.metadata || {},
    })
    .select()
    .single();

  if (error) {
    console.error('[AgentRunSystem] saveMemory FAILED:', error.message, '| code:', error.code, '| hint:', error.hint, '| details:', error.details);
    console.error('[AgentRunSystem] saveMemory params: scope=', opts.scope, 'circleId=', opts.circleId, 'userId=', opts.userId, 'kind=', opts.memoryKind);
    return null;
  }
  console.log('[AgentRunSystem] saveMemory OK:', opts.title?.slice(0, 50));
  return mapMemory(data);
}

export async function loadMemories(opts: {
  circleId: string;
  roomId?: string;
  userId?: string;
  scopes?: MemoryScope[];
  limit?: number;
}): Promise<MemoryEntry[]> {
  // Load shared memories separately from user-private memories.
  // Session memories are visibility-aware and may be either private or circle-shared.
  const results: MemoryEntry[] = [];

  // 1. Load shared non-session memories (visible to all circle members)
  const sharedScopes = (opts.scopes || ['circle', 'room', 'session', 'org'])
    .filter(s => s !== 'user' && s !== 'session');
  if (sharedScopes.length > 0) {
    let sharedQuery = supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('is_active', true)
      .in('scope', sharedScopes)
      .order('created_at', { ascending: false })
      .limit(opts.limit || 30);

    if (opts.roomId) sharedQuery = sharedQuery.or(`room_id.eq.${opts.roomId},room_id.is.null`);

    const { data } = await sharedQuery;
    if (data) results.push(...data.map(mapMemory));
  }

  // 2. Load session memories:
  // - circle_shared session memories are visible to the whole circle
  // - private session memories are only visible to the owner
  const wantsSession = !opts.scopes || opts.scopes.includes('session');
  if (wantsSession) {
    const { data: sharedSessionData } = await supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('scope', 'session')
      .eq('visibility', 'circle_shared')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(opts.limit || 30);

    if (sharedSessionData) results.push(...sharedSessionData.map(mapMemory));
  }

  if (wantsSession && opts.userId) {
    const { data: privateSessionData } = await supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('scope', 'session')
      .eq('visibility', 'private')
      .eq('user_id', opts.userId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(opts.limit || 30);

    if (privateSessionData) results.push(...privateSessionData.map(mapMemory));
  }

  // 3. Load user-private memories (only if userId is provided, only that user's memories)
  const wantsUser = !opts.scopes || opts.scopes.includes('user');
  if (wantsUser && opts.userId) {
    const { data } = await supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('user_id', opts.userId)
      .eq('scope', 'user')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) results.push(...data.map(mapMemory));
  }

  // Sort combined results by recency and cap
  results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return results.slice(0, opts.limit || 50);
}

export async function promoteMemory(
  memoryId: string,
  newScope: MemoryScope,
  newScopeId?: { circleId?: string; roomId?: string },
): Promise<boolean> {
  const existing = await supabase.from('memory_entries').select('*').eq('id', memoryId).single();
  if (!existing.data) return false;

  const { error } = await supabase.from('memory_entries').insert({
    ...existing.data,
    id: undefined,
    scope: newScope,
    circle_id: newScopeId?.circleId || existing.data.circle_id,
    room_id: newScopeId?.roomId || null,
    promoted_from: memoryId,
    created_at: new Date().toISOString(),
  });

  return !error;
}

/**
 * Build a bounded memory context string for prompt injection.
 *
 * Privacy: userId is required to load user-private memories safely.
 * Budget: capped at ~3000 chars to prevent context bloat.
 * Priority: instructions > preferences > decisions > facts > findings > context
 */
export async function buildMemoryContext(circleId: string, roomId?: string, userId?: string): Promise<string> {
  const memories = (await loadMemories({
    circleId,
    roomId,
    userId, // REQUIRED for safe user-scope loading
    scopes: ['circle', 'room', 'user'],
    limit: 25,
  }))
    .filter(m => m.retrieval_mode !== 'manual_only');
  if (memories.length === 0) return '';

  // Priority sort: by importance (if available) then kind
  const kindPriority: Record<string, number> = {
    instruction: 0, preference: 1, policy: 2, decision: 3, fact: 4, finding: 5, context: 6,
  };
  memories.sort((a, b) => {
    const aStartupBoost = a.retrieval_mode === 'startup' ? 0.25 : 0;
    const bStartupBoost = b.retrieval_mode === 'startup' ? 0.25 : 0;
    const aImp = (a.importance ?? (1.0 - (kindPriority[a.memory_kind] ?? 9) / 10)) + aStartupBoost;
    const bImp = (b.importance ?? (1.0 - (kindPriority[b.memory_kind] ?? 9) / 10)) + bStartupBoost;
    if (bImp !== aImp) return bImp - aImp;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Keep the highest-value version when multiple active memories have the same title.
  const seenTitles = new Set<string>();
  const deduped = memories.filter(m => {
    const key = `${m.scope}:${m.title.trim().toLowerCase()}`;
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  // Group by scope for readable output
  const grouped: Record<string, MemoryEntry[]> = {};
  for (const m of deduped) {
    if (!grouped[m.scope]) grouped[m.scope] = [];
    grouped[m.scope].push(m);
  }

  // Build output with token budget (~3000 chars ≈ ~750 tokens)
  const MAX_CHARS = 3000;
  let totalChars = 0;
  const sections: string[] = [];

  // Render in priority order: room > user > circle
  for (const scope of ['room', 'user', 'circle'] as const) {
    const entries = grouped[scope];
    if (!entries || entries.length === 0) continue;

    const lines: string[] = [];
    for (const e of entries) {
      const line = `- [${e.memory_kind}] ${e.title}: ${e.content.slice(0, 150)}`;
      if (totalChars + line.length > MAX_CHARS) break;
      lines.push(line);
      totalChars += line.length;
    }
    if (lines.length > 0) {
      const label = scope === 'room' ? 'Project' : scope === 'user' ? 'Personal' : 'Circle';
      sections.push(`### ${label} Memory\n${lines.join('\n')}`);
    }
  }

  // Log memory access (non-blocking) — tracks which memories were loaded into each run
  if (deduped.length > 0) {
    try {
      const accessLogs = deduped.slice(0, 15).map(m => ({
        memory_id: m.id,
        user_id: userId,
        surface: 'system_prompt',
        reason: 'startup' as const,
      }));
      supabase.from('memory_access_log').insert(accessLogs).then(() => {});
      // Increment access counts
      for (const m of deduped.slice(0, 15)) {
        supabase.from('memory_entries').update({ access_count: (m.access_count || 0) + 1, last_accessed_at: new Date().toISOString() }).eq('id', m.id).then(() => {});
      }
    } catch {}
  }

  return sections.length > 0 ? `## Agent Memory (${deduped.length} entries)\n${sections.join('\n\n')}` : '';
}

// ── 8. Realtime Subscriptions ───────────────────────────────────────────────

export function subscribeToRun(runId: string, callback: (run: AgentRun) => void) {
  return supabase
    .channel(`run:${runId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_runs', filter: `id=eq.${runId}` }, (payload) => {
      callback(mapRun(payload.new));
    })
    .subscribe();
}

export function subscribeToRunSteps(runId: string, callback: (step: RunStep) => void) {
  return supabase
    .channel(`run-steps:${runId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_run_steps', filter: `run_id=eq.${runId}` }, (payload) => {
      callback(mapStep(payload.new));
    })
    .subscribe();
}

export function subscribeToApprovals(circleId: string, callback: (approval: RunApproval) => void) {
  return supabase
    .channel(`approvals:${circleId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_run_approvals', filter: `circle_id=eq.${circleId}` }, (payload) => {
      callback(mapApproval(payload.new));
    })
    .subscribe();
}

// ── 9. High-Level Orchestrated Run ──────────────────────────────────────────

export async function executeTrackedRun(opts: {
  circleId: string;
  userId: string;
  surface: RunSurface;
  title: string;
  goal?: string;
  mode?: string;
  model?: string;
  provider?: string;
  roomId?: string;
  taskId?: string;
  executeFn: (run: AgentRun) => Promise<{ response: string; artifacts?: Array<{ kind: ArtifactKind; title: string; content?: string; url?: string }>; tokens?: { input: number; output: number; cached?: number } }>;
}): Promise<{ run: AgentRun; response: string; artifacts: RunArtifact[] }> {
  // Create the run
  const run = await createRun(opts);
  if (!run) throw new Error('Failed to create agent run');

  // Mark running
  await updateRunStatus(run.id, 'running');

  // Add planning step
  await addStep({ runId: run.id, circleId: opts.circleId, stepIndex: 0, stepKind: 'plan', title: opts.title, body: opts.goal });

  try {
    // Execute the actual work
    const startMs = Date.now();
    const result = await opts.executeFn(run);
    const durationMs = Date.now() - startMs;

    // Record the message step
    await addStep({
      runId: run.id, circleId: opts.circleId, stepIndex: 1, stepKind: 'message',
      title: 'Response', body: result.response.slice(0, 5000), durationMs,
      tokensUsed: (result.tokens?.input || 0) + (result.tokens?.output || 0),
    });

    // Record artifacts
    const savedArtifacts: RunArtifact[] = [];
    if (result.artifacts) {
      for (const art of result.artifacts) {
        const saved = await addArtifact({
          runId: run.id, circleId: opts.circleId,
          artifactKind: art.kind, title: art.title,
          content: art.content, url: art.url,
        });
        if (saved) savedArtifacts.push(saved);
      }
    }

    // Mark completed with token totals
    await updateRunStatus(run.id, 'completed', {
      input_tokens: result.tokens?.input || 0,
      output_tokens: result.tokens?.output || 0,
      cached_tokens: result.tokens?.cached || 0,
      current_step_index: 2,
      total_steps: 2,
    });

    return { run: { ...run, status: 'completed' }, response: result.response, artifacts: savedArtifacts };
  } catch (err: any) {
    await addStep({ runId: run.id, circleId: opts.circleId, stepIndex: 99, stepKind: 'error', title: 'Run failed', body: err.message });
    await updateRunStatus(run.id, 'failed');
    throw err;
  }
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function mapRun(d: any): AgentRun {
  return {
    id: d.id, circle_id: d.circle_id, user_id: d.user_id, surface: d.surface,
    room_id: d.room_id, task_id: d.task_id, chat_session_id: d.chat_session_id,
    title: d.title, goal: d.goal, mode: d.mode, model: d.model, provider: d.provider,
    status: d.status, plan_summary: d.plan_summary,
    current_step_index: d.current_step_index || 0, total_steps: d.total_steps || 0,
    input_tokens: d.input_tokens || 0, output_tokens: d.output_tokens || 0,
    cached_tokens: d.cached_tokens || 0, estimated_cost: parseFloat(d.estimated_cost || '0'),
    started_at: d.started_at, completed_at: d.completed_at, created_at: d.created_at,
    parent_run_id: d.parent_run_id, delegated_to: d.delegated_to, metadata: d.metadata || {},
  };
}

function mapStep(d: any): RunStep {
  return {
    id: d.id, run_id: d.run_id, step_index: d.step_index, step_kind: d.step_kind,
    title: d.title, body: d.body, tool_name: d.tool_name, tool_input: d.tool_input,
    tool_output: d.tool_output, delegated_to: d.delegated_to, child_run_id: d.child_run_id,
    status: d.status, duration_ms: d.duration_ms, tokens_used: d.tokens_used || 0,
    created_at: d.created_at,
  };
}

function mapArtifact(d: any): RunArtifact {
  return {
    id: d.id, run_id: d.run_id, step_id: d.step_id, artifact_kind: d.artifact_kind,
    title: d.title, content: d.content, url: d.url, file_path: d.file_path,
    version: d.version || 1, is_published: d.is_published || false,
    created_at: d.created_at, metadata: d.metadata || {},
  };
}

function mapApproval(d: any): RunApproval {
  return {
    id: d.id, run_id: d.run_id, approval_kind: d.approval_kind,
    title: d.title, description: d.description, payload: d.payload || {},
    status: d.status, requested_by: d.requested_by, resolved_by: d.resolved_by,
    requested_at: d.requested_at, resolved_at: d.resolved_at,
  };
}

function mapMemory(d: any): MemoryEntry {
  return {
    id: d.id, scope: d.scope, circle_id: d.circle_id, room_id: d.room_id,
    session_id: d.session_id,
    user_id: d.user_id, memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, source_surface: d.source_surface,
    is_active: d.is_active, visibility: d.visibility, importance: d.importance,
    retrieval_mode: d.retrieval_mode, status: d.status, access_count: d.access_count,
    last_accessed_at: d.last_accessed_at, updated_at: d.updated_at, created_at: d.created_at,
    metadata: d.metadata || {},
  };
}
