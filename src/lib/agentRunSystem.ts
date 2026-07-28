/**
 * Unified Agent Run System
 *
 * Single API for creating, tracking, and completing agent runs across ALL surfaces.
 * Replaces surface-specific run tracking with shared primitives.
 *
 * Surfaces: main_chat, room_chat, feed_task, office_terminal, floating_chat, scheduled, api
 */

import { supabase } from './supabase';
import type { BrowserPlanEvent } from './computerUse';
import { devLog } from './devLog';
import { mapLegacyToolEventToLedgerStatus, persistAgentRunToolEvent } from './agentRunLedgerPersistence';
import { subscribeWithReconnect } from './subscribeWithReconnect';
import { runMatchesAgent } from './agentRunSubjectSummary';
import {
  summarizeToolInputForPersistence,
  summarizeToolResultForPersistence,
} from './eventBoundCore';
import { detectCredentialMemoryContent, describeCredentialMemoryBlock } from './userMemoryCaps';
import {
  DEFAULT_AGENT_SCOPE_MEMORY_LIMIT,
  describeAgentScopeLookupWarning,
  isAgentScopeMissingLookupId,
  resolveMemoryLookupIds,
  resolveMemoryScopeQueryLimit,
  scopesRequestAgentMemory,
} from './memoryLookupKeyCore';
import {
  evaluateDedupeEligibility,
  memoryWriteScopePolicy,
} from './memoryWritePolicyCore';

/**
 * Fire-and-forget embed-on-write.
 *
 * DYNAMIC import on purpose: `memoryEmbeddings` → `privacyMode` → `react-native`,
 * and this module is transitively imported by tsx-loaded smoke tests, which
 * cannot load react-native. A static top-level import here would break every one
 * of them; `memoryService` already used a dynamic import of this module for
 * exactly that reason.
 */
function queueMemoryEmbeddingSafe(memoryId: string, title?: string | null, content?: string | null): void {
  if (!memoryId) return;
  void import('./memoryEmbeddings')
    .then(({ queueMemoryEmbedding }) => queueMemoryEmbedding({ memoryId, title, content }))
    .catch(() => { /* embedding must never affect the write */ });
}

// ── Types ───────────────────────────────────────────────────────────────────

export type RunSurface = 'main_chat' | 'room_chat' | 'feed_task' | 'office_terminal' | 'floating_chat' | 'scheduled' | 'api';
export type RunStatus = 'queued' | 'planning' | 'running' | 'waiting_approval' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type StepKind = 'plan' | 'thinking' | 'tool_call' | 'tool_result' | 'message' | 'artifact_create' | 'approval_request' | 'approval_result' | 'delegation' | 'error' | 'finalize' | 'context_edit';
export type ArtifactKind = 'text' | 'code_patch' | 'image' | 'screenshot' | 'report' | 'webpage' | 'table' | 'research_brief' | 'design_spec' | 'social_post' | 'email_draft' | 'spec_doc' | 'checklist' | 'link_bundle' | 'audio' | 'video' | 'file' | 'diff' | 'translation' | 'classification' | 'test_result';
export type ApprovalKind = 'tool_use' | 'publish' | 'external_send' | 'file_write' | 'browser_action' | 'cost_threshold' | 'privileged_action' | 'plan_approval' | 'deliverable_review';
export type MemoryScope = 'org' | 'circle' | 'room' | 'user' | 'session' | 'agent';
export type MemoryKind = 'fact' | 'instruction' | 'preference' | 'decision' | 'finding' | 'policy' | 'context';
export type SessionMemoryMode = 'private' | 'shared';

export interface AgentRun {
  id: string;
  agent_id?: string;
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
  /**
   * Last loop stop reason persisted at finalize/pause time. 'client_pending'
   * marks a user-paced continuation wait — legitimately silent, never reapable.
   */
  final_stop_reason?: string;
  /** Heartbeat column — bumped by the tool loop; runStallPolicyCore reads it. */
  updated_at?: string;
  created_at: string;
  parent_run_id?: string;
  delegated_to?: string;
  metadata: Record<string, unknown>;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function metadataStringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(metadataStringValues);
  return [];
}

function runMatchesAgentAliases(run: AgentRun, aliases: string[]): boolean {
  const normalizedAliases = new Set(aliases.map(value => value.toLowerCase()));
  if (normalizedAliases.size === 0) return true;
  const meta = run.metadata || {};
  const agentSubject = meta.agentSubject && typeof meta.agentSubject === 'object'
    ? meta.agentSubject as Record<string, unknown>
    : {};
  const values = uniqueStrings([
    run.agent_id,
    run.delegated_to,
    meta.agentSubjectKey as string | undefined,
    meta.targetAgentSubjectKey as string | undefined,
    meta.agentId as string | undefined,
    meta.agent_id as string | undefined,
    meta.agentName as string | undefined,
    meta.agent_name as string | undefined,
    meta.sessionKey as string | undefined,
    meta.session_key as string | undefined,
    meta.delegatedTo as string | undefined,
    meta.assignedAgentId as string | undefined,
    meta.assigned_agent_id as string | undefined,
    agentSubject.agentSubjectKey as string | undefined,
    agentSubject.agentDbId as string | undefined,
    ...metadataStringValues(meta.legacyAgentIds),
    ...metadataStringValues(meta.agentLegacyIds),
    ...metadataStringValues(meta.targetAgentLegacyIds),
    ...metadataStringValues(meta.runAgentAliases),
    ...metadataStringValues(meta.memoryAgentAliases),
    ...metadataStringValues(agentSubject.legacyAgentIds),
  ]);
  return values.some(value => normalizedAliases.has(value.toLowerCase()));
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
  metadata: Record<string, unknown>;
}

const PERSISTED_TOOL_OUTPUT_STATUSES = new Set([
  'planned',
  'running',
  'passed',
  'completed',
  'success',
  'verified',
  'manual_required',
  'blocked',
  'failed',
  'error',
  'skipped',
  'cancelled',
  'inconclusive',
  'outcome_unknown',
  'unknown',
]);
const PERSISTED_TOOL_OUTPUT_KINDS = new Set([
  'empty',
  'array',
  'object',
  'string',
  'number',
  'non_finite_number',
  'boolean',
  'bigint',
  'undefined',
  'unsupported',
  'unavailable',
]);

/**
 * Render durable tool-output telemetry without ever echoing a historical raw
 * command/result back into the UI. New rows contain a value-free structural
 * envelope; pre-boundary legacy rows are acknowledged but deliberately hidden.
 */
export function describePersistedToolOutput(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.redacted !== true) {
      return 'Tool result recorded · legacy value hidden';
    }
    const status = typeof parsed.status === 'string' && PERSISTED_TOOL_OUTPUT_STATUSES.has(parsed.status)
      ? parsed.status.replace(/_/g, ' ')
      : 'unknown';
    const kind = typeof parsed.resultKind === 'string' && PERSISTED_TOOL_OUTPUT_KINDS.has(parsed.resultKind)
      ? parsed.resultKind.replace(/_/g, ' ')
      : 'unavailable';
    return `Tool result: ${status} · ${kind} · values hidden`;
  } catch {
    return 'Tool result recorded · legacy value hidden';
  }
}

/**
 * Project a durable or legacy tool name through the same strict canonical
 * allowlist used at the write boundary. Historical path-, URL-, command-, or
 * secret-shaped values become `unknown` before reaching the UI.
 */
export function describePersistedToolName(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return String(summarizeToolInputForPersistence(value, undefined).tool || 'unknown');
}

export function projectPersistedRunStepForDisplay(step: Pick<
  RunStep,
  'step_kind' | 'title' | 'body' | 'tool_name' | 'tool_output'
>): {
  title: string;
  body: string | null;
  toolName: string | null;
  toolOutput: string | null;
} {
  const toolName = describePersistedToolName(step.tool_name);
  const toolBound = toolName !== null
    || step.step_kind === 'tool_call'
    || step.step_kind === 'tool_result';
  if (!toolBound) {
    return {
      title: `${step.step_kind.toUpperCase()} · ${step.title}`,
      body: step.body || null,
      toolName: null,
      toolOutput: null,
    };
  }
  const safeName = toolName || 'unknown';
  return {
    title: `${step.step_kind.toUpperCase()} · ${step.step_kind === 'tool_result' ? 'Tool result' : 'Tool call'}: ${safeName}`,
    body: null,
    toolName: safeName,
    toolOutput: describePersistedToolOutput(step.tool_output),
  };
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
  agent_id?: string;
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
  /** memory_entries.pinned — written by pinMemory/unpinMemory (memoryActions.ts).
   *  Must be projected in mapMemory or every pin-state UI reads `undefined`. */
  pinned?: boolean;
  access_count?: number;
  last_accessed_at?: string;
  updated_at?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export async function getCircleSessionMemoryMode(circleId: string): Promise<SessionMemoryMode> {
  try {
    const { data, error } = await supabase
      .from('circles')
      .select('settings')
      .eq('id', circleId)
      .maybeSingle();
    if (error || !data) return 'private';
    return (data as any)?.settings?.sessionMemoryMode === 'shared' ? 'shared' : 'private';
  } catch {
    return 'private';
  }
}

// ── 1. Create Run ───────────────────────────────────────────────────────────

/**
 * Read the canonical agent subject key back OUT of a run-metadata blob — the
 * inverse of `buildAgentRuntimeSubjectPayload`'s `runMetadata` stamp.
 *
 * Office plan O6: every run writer already puts subject identity into
 * `metadata`, so `createRun` derives the durable `agent_runs.agent_id` here, at
 * one chokepoint, instead of threading a new argument through all six call
 * sites. Key precedence mirrors `deriveRunSubjectIdentity` (officeOpsBoard) so
 * the column and the metadata fallback can never disagree about who ran a run.
 *
 * Private on purpose: `agentRuntimeSubject.ts` is the canonical owner of subject
 * identity and this belongs there, but that file is currently root-owned and
 * unwritable. Promote it (and drop this) once the permissions are fixed.
 *
 * Returns null for anything it can't confidently resolve — a wrong id is worse
 * than none, because it attributes work to the wrong agent.
 */
function readAgentSubjectKeyFromRunMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const clean = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text ? text : null;
  };
  const nested = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const agentSubject = nested(metadata.agentSubject);
  const targetSubject = nested(metadata.targetAgentSubject);
  // EXACTLY the four subject-key sources deriveRunSubjectIdentity reads from
  // metadata — no more. `metadata.agentId` is deliberately NOT consulted: the
  // subject payload does set it to the subject key, but other writers use that
  // field for connection/session ids, and persisting one of those would make
  // the column itself a false attribution that deriveRunSubjectIdentity would
  // then trust. Unresolvable → null → unchanged name-matching fallback.
  return clean(metadata.agentSubjectKey)
    || clean(metadata.targetAgentSubjectKey)
    || clean(agentSubject.agentSubjectKey)
    || clean(targetSubject.agentSubjectKey);
}

/** True for the PostgREST/Postgres shapes of "that column isn't there".
 *  Lets `createRun` write `agent_id` before the O6 migration has been applied to
 *  a given database without ever failing the run itself. */
function isMissingAgentIdColumnError(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  // 42703 = undefined_column (Postgres); PGRST204 = unknown column (PostgREST cache)
  if (e.code === '42703' || e.code === 'PGRST204') return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('agent_id') && (msg.includes('column') || msg.includes('schema cache'));
}

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
  /** Canonical agent runtime subject key (or the published agent's uuid) —
   *  Office plan O6. Persisting this is what lets the Office stop attributing
   *  runs to agents by matching display names. */
  agentId?: string;
  metadata?: Record<string, unknown>;
}): Promise<AgentRun | null> {
  const base = {
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
  };
  // O6 chokepoint: prefer an explicit agentId, else recover the canonical
  // subject key the writer already stamped into metadata. Doing it here means
  // every existing createRun caller starts persisting durable attribution
  // without a single call-site change.
  const agentId = (typeof opts.agentId === 'string' && opts.agentId.trim())
    ? opts.agentId.trim()
    : readAgentSubjectKeyFromRunMetadata(base.metadata);

  const insert = (payload: Record<string, unknown>) =>
    supabase.from('agent_runs').insert(payload).select().single();

  let { data, error } = await insert(agentId ? { ...base, agent_id: agentId } : base);

  // Fail-soft: a database that hasn't run RUN_THIS_SQL.sql §25 yet must still be
  // able to create runs. Retry without the column rather than losing the run —
  // attribution degrades to the name-matching fallback, which is exactly the
  // pre-O6 behaviour.
  if (error && agentId && isMissingAgentIdColumnError(error)) {
    console.warn('[AgentRunSystem] agent_runs.agent_id missing — run RUN_THIS_SQL.sql §25; falling back to name attribution');
    ({ data, error } = await insert(base));
  }

  if (error) { console.error('[AgentRunSystem] createRun error:', error); return null; }
  return mapRun(data);
}

// ── 2. Update Run Status ────────────────────────────────────────────────────

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  extra?: Partial<{ plan_summary: string; current_step_index: number; total_steps: number; completed_at: string; input_tokens: number; output_tokens: number; cached_tokens: number; estimated_cost: number; started_at: string; metadata: Record<string, unknown> }>,
): Promise<boolean> {
  const updates: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === 'running' && !extra?.started_at) updates.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'failed' || status === 'cancelled') updates.completed_at = new Date().toISOString();
  if (extra) Object.assign(updates, extra);

  const { error } = await supabase.from('agent_runs').update(updates).eq('id', runId);
  if (error) { console.error('[AgentRunSystem] updateRunStatus error:', error); return false; }
  return true;
}

// Honest STOP: promote a run to 'completed' only when the user has not already
// cancelled it. The console flips agent_runs.status to 'cancelled' without
// holding the runtime's abort signal, so even after the runtime re-checks the
// row there is a re-select→write race; the `.neq('status','cancelled')` guard
// closes it at the DB so a cancelled row can never be overwritten to
// 'completed'. Callers that KNOW the turn was cancelled should keep using
// updateRunStatus(runId, 'cancelled', extras) so the honest partial
// usage/cost receipt still lands on the row.
export async function completeRunUnlessCancelled(
  runId: string,
  extra?: Partial<{ plan_summary: string; current_step_index: number; total_steps: number; completed_at: string; input_tokens: number; output_tokens: number; cached_tokens: number; estimated_cost: number; metadata: Record<string, unknown> }>,
): Promise<boolean> {
  const updates: Record<string, unknown> = {
    status: 'completed',
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
  if (extra) Object.assign(updates, extra);

  const { error } = await supabase
    .from('agent_runs')
    .update(updates)
    .eq('id', runId)
    .neq('status', 'cancelled');
  if (error) { console.error('[AgentRunSystem] completeRunUnlessCancelled error:', error); return false; }
  return true;
}

// Cancel-guarded failure finalize: the mirror of completeRunUnlessCancelled but
// terminal status 'failed'. The `.neq('status','cancelled')` predicate means a
// run the user already STOPped is never overwritten to 'failed' — the honest
// user-cancel receipt wins. Used by the OpenSwan session runtime's outer
// try/catch to finalize a thrown turn immediately instead of leaving the row
// stuck at 'running' until a heartbeat reaper claims it ~RUN_STALL_DEAD_MS later.
export async function failRunUnlessCancelled(
  runId: string,
  extra?: Partial<{ plan_summary: string; current_step_index: number; total_steps: number; completed_at: string; input_tokens: number; output_tokens: number; cached_tokens: number; estimated_cost: number; metadata: Record<string, unknown> }>,
): Promise<boolean> {
  const updates: Record<string, unknown> = {
    status: 'failed',
    updated_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
  if (extra) Object.assign(updates, extra);

  const { error } = await supabase
    .from('agent_runs')
    .update(updates)
    .eq('id', runId)
    .neq('status', 'cancelled');
  if (error) { console.error('[AgentRunSystem] failRunUnlessCancelled error:', error); return false; }
  return true;
}

// Cancel-guarded 'running' progress write: same shape as
// updateRunStatus(runId, 'running', extra) but with the
// `.neq('status','cancelled')` predicate (mirroring completeRunUnlessCancelled)
// so a DEFERRED pre-loop progress write can never flip a console-cancelled row
// back to 'running'. Used by openswanSessionRuntime's telemetry-defer path,
// where step-progress writes are started immediately but not awaited.
export async function updateRunProgressUnlessCancelled(
  runId: string,
  extra?: Partial<{ current_step_index: number; total_steps: number; started_at: string }>,
): Promise<boolean> {
  const updates: Record<string, unknown> = { status: 'running', updated_at: new Date().toISOString() };
  if (!extra?.started_at) updates.started_at = new Date().toISOString();
  if (extra) Object.assign(updates, extra);

  const { error } = await supabase
    .from('agent_runs')
    .update(updates)
    .eq('id', runId)
    .neq('status', 'cancelled');
  if (error) { console.error('[AgentRunSystem] updateRunProgressUnlessCancelled error:', error); return false; }
  return true;
}

export async function mergeRunMetadata(runId: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .select('metadata')
      .eq('id', runId)
      .single();
    if (error) {
      console.error('[AgentRunSystem] mergeRunMetadata load error:', error);
      return false;
    }
    const nextMetadata = {
      ...((data as any)?.metadata || {}),
      ...patch,
    };
    const { error: updateError } = await supabase
      .from('agent_runs')
      .update({ metadata: nextMetadata, updated_at: new Date().toISOString() })
      .eq('id', runId);
    if (updateError) {
      console.error('[AgentRunSystem] mergeRunMetadata update error:', updateError);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[AgentRunSystem] mergeRunMetadata exception:', err);
    return false;
  }
}

/**
 * Run-reaper claim: flip a dead-heartbeat zombie to 'failed', conditionally at
 * the DB. The `.eq('status','running')` predicate means exactly one surface
 * wins when several dashboards reap the same dead run concurrently, and a run
 * the producer (or another surface) already moved off 'running' is never
 * touched. Only the claim winner writes the `reaped_reason` metadata marker,
 * so the non-atomic mergeRunMetadata read-modify-write is not duplicated
 * across surfaces. Returns true only when THIS caller claimed the row.
 */
export async function reapRun(runId: string, reason = 'heartbeat_stale'): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('agent_runs')
      .update({ status: 'failed', updated_at: nowIso, completed_at: nowIso })
      .eq('id', runId)
      .eq('status', 'running')
      .select('id');
    if (error) { console.error('[AgentRunSystem] reapRun error:', error); return false; }
    if (!Array.isArray(data) || data.length === 0) return false; // lost the claim / no longer running
    await mergeRunMetadata(runId, { reaped_reason: reason });
    return true;
  } catch (err) {
    console.error('[AgentRunSystem] reapRun exception:', err);
    return false;
  }
}

async function getNextRunStepIndex(runId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('agent_run_steps')
      .select('step_index')
      .eq('run_id', runId)
      .order('step_index', { ascending: false })
      .limit(1);
    if (error) return 0;
    return data && data.length > 0 ? ((data[0] as any).step_index || 0) + 1 : 0;
  } catch {
    return 0;
  }
}

export async function appendRunToolEvent(opts: {
  runId: string;
  circleId: string;
  event: {
    tool: string;
    status: 'planned' | 'running' | 'passed' | 'failed' | 'manual_required' | 'blocked' | 'not_applicable';
    summary: string;
    command?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<boolean> {
  const stepIndex = await getNextRunStepIndex(opts.runId);
  // O5: not_applicable is a terminal "nothing to run" state — recorded as a
  // skipped step but kept out of the typed ledger event stream below, whose
  // LegacyToolEventStatus union (and downstream event types) doesn't carry it.
  const stepStatus = opts.event.status === 'not_applicable'
    ? 'skipped'
    : mapLegacyToolEventToLedgerStatus(opts.event.status).rowStatus;
  const added = await addStep({
    runId: opts.runId,
    circleId: opts.circleId,
    stepIndex,
    stepKind: opts.event.status === 'planned' || opts.event.status === 'running' ? 'tool_call' : 'tool_result',
    title: opts.event.tool,
    body: opts.event.summary,
    toolName: opts.event.tool,
    toolOutput: opts.event.command,
    status: stepStatus,
    metadata: opts.event.metadata,
  });
  if (added && opts.event.status !== 'not_applicable') {
    const metadata = opts.event.metadata || {};
    void persistAgentRunToolEvent({
      runId: opts.runId,
      circleId: opts.circleId,
      stepId: added.id,
      scenarioId: typeof metadata.scenarioId === 'string' ? metadata.scenarioId : null,
      surface: typeof metadata.surface === 'string' ? metadata.surface : null,
      risk: typeof metadata.risk === 'string' ? metadata.risk : null,
      event: { ...opts.event, status: opts.event.status },
    });
  }
  return !!added;
}

function mapBrowserPlanEventToExecutionStatus(kind: BrowserPlanEvent['kind']): 'planned' | 'running' | 'passed' | 'failed' | 'manual_required' | 'blocked' {
  switch (kind) {
    case 'planned':
      return 'planned';
    case 'approval_requested':
      return 'manual_required';
    case 'launched':
      return 'running';
    case 'completed':
    case 'opened_live_session':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'blocked';
    default:
      return 'planned';
  }
}

function mapBrowserPlanEventToStepStatus(kind: BrowserPlanEvent['kind']): 'pending' | 'running' | 'completed' | 'failed' | 'blocked' {
  switch (kind) {
    case 'approval_requested':
      return 'pending';
    case 'launched':
      return 'running';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'blocked';
    default:
      return 'completed';
  }
}

export async function appendRunBrowserPlanEvent(opts: {
  runId: string;
  circleId: string;
  event: BrowserPlanEvent;
}): Promise<boolean> {
  const stepIndex = await getNextRunStepIndex(opts.runId);
  const executionStatus = mapBrowserPlanEventToExecutionStatus(opts.event.kind);
  const added = await addStep({
    runId: opts.runId,
    circleId: opts.circleId,
    stepIndex,
    stepKind: opts.event.kind === 'approval_requested' ? 'approval_request' : 'tool_call',
    title: `Browser ${opts.event.kind.replace(/_/g, ' ')}`,
    body: opts.event.summary,
    toolName: 'browser.session',
    toolOutput: opts.event.backendLiveUrl || opts.event.backendSessionId,
    status: mapBrowserPlanEventToStepStatus(opts.event.kind),
    metadata: {
      browserPlanEvent: opts.event,
      executions: [
        {
          status: executionStatus,
          mode: 'automatic',
          summary: opts.event.summary,
          toolName: 'browser.session',
          command: opts.event.backendSessionId || opts.event.backendLiveUrl,
          executed: executionStatus !== 'manual_required' && executionStatus !== 'planned',
          error: executionStatus === 'failed' ? opts.event.summary : null,
        },
      ],
    },
  });
  return !!added;
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
  metadata?: Record<string, unknown>;
}): Promise<RunStep | null> {
  // `addStep` is the final client-side persistence boundary for
  // agent_run_steps. Callers still need the exact arguments in memory for
  // approval, dispatch, verification, and recovery, but no caller-owned tool
  // argument/result/metadata value may cross through those durable columns.
  // Always derive a fresh canonical, key-free structural summary here—even
  // when a caller already appears to provide a summary—so a malformed or
  // mislabeled object cannot bypass the boundary. Preserve `undefined` for
  // steps that never carried tool input or output. `tool_output` is a text
  // column, so its structural envelope is serialized after sanitization; raw
  // commands, URLs, session identifiers, provider bodies, and observations
  // stay transient.
  const persistedStatus = opts.status || 'completed';
  const persistedToolName = opts.toolName === undefined
    ? undefined
    : String(summarizeToolInputForPersistence(opts.toolName, undefined).tool || 'unknown');
  const persistedToolInput = opts.toolInput === undefined
    ? undefined
    : summarizeToolInputForPersistence(persistedToolName, opts.toolInput);
  const persistedToolOutput = opts.toolOutput === undefined
    ? undefined
    : JSON.stringify(summarizeToolResultForPersistence(
      persistedToolName,
      opts.toolOutput,
      persistedStatus,
    ));
  const isToolBoundStep = persistedToolName !== undefined
    || opts.stepKind === 'tool_call'
    || opts.stepKind === 'tool_result';
  const safeToolLabel = persistedToolName || 'unknown';
  const persistedTitle = isToolBoundStep
    ? `${opts.stepKind === 'tool_result' ? 'Tool result' : 'Tool call'}: ${safeToolLabel}`
    : opts.title;
  const persistedBody = isToolBoundStep
    ? opts.body === undefined
      ? undefined
      : 'Tool details hidden'
    : opts.body;
  const persistedMetadata = opts.metadata === undefined
    ? {}
    : isToolBoundStep
      ? summarizeToolInputForPersistence(persistedToolName, opts.metadata)
      : opts.metadata;
  const { data, error } = await supabase
    .from('agent_run_steps')
    .insert({
      run_id: opts.runId,
      circle_id: opts.circleId,
      step_index: opts.stepIndex,
      step_kind: opts.stepKind,
      title: persistedTitle,
      body: persistedBody,
      tool_name: persistedToolName,
      tool_input: persistedToolInput,
      tool_output: persistedToolOutput,
      delegated_to: opts.delegatedTo,
      child_run_id: opts.childRunId,
      status: persistedStatus,
      duration_ms: opts.durationMs,
      tokens_used: opts.tokensUsed || 0,
      metadata: persistedMetadata,
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
  // Fail-closed + idempotent: only a still-PENDING approval can transition, so
  // an already-resolved / rejected / EXPIRED (timed-out) decision can never be
  // flipped or retroactively approved. The `.eq('status','pending')` predicate
  // + row-match check means a no-op update returns false rather than posing as
  // a fresh approval — protects the approval floor from a double/late resolve.
  const { data, error } = await supabase
    .from('agent_run_approvals')
    .update({ status, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', approvalId)
    .eq('status', 'pending')
    .select('id');
  if (error) return false;
  return Array.isArray(data) && data.length > 0;
}

// ── 6. Query Runs ───────────────────────────────────────────────────────────

export async function getRun(runId: string): Promise<AgentRun | null> {
  const { data, error } = await supabase.from('agent_runs').select('*').eq('id', runId).single();
  if (error || !data) return null;
  return mapRun(data);
}

export async function listRuns(
  circleId: string,
  opts?: { surface?: RunSurface; status?: RunStatus; roomId?: string; userId?: string; agentId?: string; agentAliases?: string[]; limit?: number },
): Promise<AgentRun[]> {
  const requestedLimit = opts?.limit || 50;
  const agentAliases = uniqueStrings([opts?.agentId, ...(opts?.agentAliases || [])]);
  const queryLimit = agentAliases.length > 0 ? Math.max(requestedLimit, 200) : requestedLimit;
  let query = supabase.from('agent_runs').select('*').eq('circle_id', circleId).order('created_at', { ascending: false }).limit(queryLimit);
  if (opts?.surface) query = query.eq('surface', opts.surface);
  if (opts?.status) query = query.eq('status', opts.status);
  if (opts?.roomId) query = query.eq('room_id', opts.roomId);
  if (opts?.userId) query = query.eq('user_id', opts.userId);
  const { data, error } = await query;
  if (error || !data) return [];
  const runs = data.map(mapRun);
  return agentAliases.length === 0
    ? runs
    : runs.filter(run => runMatchesAgentAliases(run, agentAliases)).slice(0, requestedLimit);
}

export async function listRunsForAgentSubject(
  circleId: string,
  opts: {
    surface?: RunSurface;
    status?: RunStatus;
    roomId?: string;
    userId?: string;
    agentId?: string;
    agentAliases?: string[];
    agentName?: string;
    limit?: number;
    scanPageSize?: number;
    maxScanRows?: number;
  },
): Promise<AgentRun[]> {
  const requestedLimit = Math.max(1, opts.limit || 50);
  const agentAliases = uniqueStrings([opts.agentId, ...(opts.agentAliases || [])]);
  if (agentAliases.length === 0 && !String(opts.agentName || '').trim()) {
    return listRuns(circleId, opts);
  }

  const scanPageSize = Math.max(requestedLimit, Math.min(Math.max(opts.scanPageSize || 200, 50), 500));
  const maxScanRows = Math.max(scanPageSize, opts.maxScanRows || 1000);
  const matches: AgentRun[] = [];
  let from = 0;

  while (from < maxScanRows && matches.length < requestedLimit) {
    const to = Math.min(from + scanPageSize - 1, maxScanRows - 1);
    let query = supabase
      .from('agent_runs')
      .select('*')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (opts.surface) query = query.eq('surface', opts.surface);
    if (opts.status) query = query.eq('status', opts.status);
    if (opts.roomId) query = query.eq('room_id', opts.roomId);
    if (opts.userId) query = query.eq('user_id', opts.userId);

    const { data, error } = await query;
    if (error || !data) {
      if (error) console.error('[AgentRunSystem] listRunsForAgentSubject error:', error);
      break;
    }

    for (const run of data.map(mapRun)) {
      if (runMatchesAgent(run, agentAliases, opts.agentName || '')) matches.push(run);
      if (matches.length >= requestedLimit) break;
    }

    if (data.length < scanPageSize) break;
    from += scanPageSize;
  }

  return matches.slice(0, requestedLimit);
}

export async function listChildRuns(
  parentRunId: string,
  limit = 20,
): Promise<AgentRun[]> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('parent_run_id', parentRunId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error || !data) return [];
  return data.map(mapRun);
}

export async function listChatSessionRuns(
  circleId: string,
  chatSessionId: string,
  limit = 50,
): Promise<AgentRun[]> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('circle_id', circleId)
    .eq('surface', 'main_chat')
    .eq('chat_session_id', chatSessionId)
    .order('created_at', { ascending: false })
    .limit(limit);
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

/**
 * Live-runs query for the Office ops board: every "building" run in the
 * circle plus runs that completed/failed within the recent window, newest
 * first. Selects only the columns the board model (officeOpsBoard.ts) needs.
 */
const LIVE_RUN_BOARD_FIELDS =
  'id,circle_id,title,status,surface,parent_run_id,delegated_to,started_at,created_at,completed_at,input_tokens,output_tokens,cached_tokens,estimated_cost,metadata';

export async function listCircleLiveRuns(
  circleId: string,
  opts?: { limit?: number; recentFinishedMs?: number },
): Promise<AgentRun[]> {
  const recentFinishedMs = opts?.recentFinishedMs ?? 10 * 60_000;
  const cutoffIso = new Date(Date.now() - recentFinishedMs).toISOString();
  const { data, error } = await supabase
    .from('agent_runs')
    .select(LIVE_RUN_BOARD_FIELDS)
    .eq('circle_id', circleId)
    .or(
      `status.in.(queued,planning,running,waiting_approval,paused),and(status.in.(completed,failed),completed_at.gte.${cutoffIso})`,
    )
    .order('created_at', { ascending: false })
    .limit(opts?.limit || 40);
  if (error || !data) {
    if (error) console.error('[AgentRunSystem] listCircleLiveRuns error:', error);
    return [];
  }
  return data.map(mapRun);
}

// ── 6b. L1: Desktop action-trace retrieval (learning loop) ──────────────────
// Client-side twin of the browser guided-replay query (D7c) in
// `supabase/functions/computer-use-agent/index.ts` (~lines 338-360): completed
// runs only, 45-day window, newest first, EXACT normalized-task match, first
// match wins. Traces are written by `computerTaskRuntime` into
// `agent_runs.metadata.desktopActionTrace` on successful desktop/app/hybrid
// runs. Additive helpers — no schema change.

/** Shape persisted at `agent_runs.metadata.desktopActionTrace` (v1). */
export interface DesktopRunActionTrace {
  v: 1;
  normalizedTask: string;
  capturedAtIso: string;
  actions: Array<{ tool: string; input: unknown }>;
}

function asDesktopRunActionTrace(candidate: unknown, normalizedTask: string): DesktopRunActionTrace | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const trace = candidate as DesktopRunActionTrace;
  if (trace.v !== 1) return null;
  if (typeof trace.normalizedTask !== 'string' || trace.normalizedTask.length === 0) return null;
  // EXACT match only — no fuzzy retrieval (conservative per verified finding
  // 5: self-experience retrieval can regress strong models).
  if (trace.normalizedTask !== normalizedTask) return null;
  if (!Array.isArray(trace.actions) || trace.actions.length === 0) return null;
  return trace;
}

/**
 * Find the most recent successful desktop action trace in this circle whose
 * normalized task text EXACTLY matches `normalizedTask` (normalize with
 * `normalizeDesktopTaskText` from computerTaskRuntime before calling).
 * jsonb-path filtering narrows the fetch; the exact match itself is applied
 * client-side over the recent window. Tolerant of errors → null.
 */
export async function findRecentDesktopActionTrace(
  circleId: string,
  normalizedTask: string,
  opts?: { windowDays?: number; limit?: number },
): Promise<DesktopRunActionTrace | null> {
  if (!circleId || !normalizedTask) return null;
  const windowDays = opts?.windowDays ?? 45;
  const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from('agent_runs')
      .select('id, created_at, metadata')
      .eq('circle_id', circleId)
      .eq('status', 'completed')
      .gte('created_at', sinceIso)
      .not('metadata->desktopActionTrace', 'is', null)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 20);
    if (error || !data) return null;
    for (const row of data) {
      const trace = asDesktopRunActionTrace((row as any)?.metadata?.desktopActionTrace, normalizedTask);
      if (trace) return trace; // newest-first → newest successful trace wins
    }
    return null;
  } catch {
    return null;
  }
}

// Event kinds that historically carried tool inputs in
// `agent_run_events.payload`: `tool_call_start` (server-dispatched +
// typed-core persisted runs) and `client_tool_call_pending` (swanbot-v2
// client-delegated desktop tools). Current writers may store only the
// value-free summary recognized below.
const DESKTOP_TRACEABLE_RUN_EVENT_KINDS = ['tool_call_start', 'client_tool_call_pending'];

const DESKTOP_TOOL_INPUT_SUMMARY_STRUCTURAL_KEYS = [
  'inputKind',
  'fieldKinds',
  'fields',
] as const;
const DESKTOP_TOOL_INPUT_SUMMARY_AUXILIARY_KEYS = [
  'tool',
  'fieldCount',
  'itemCount',
  'omittedFieldCount',
] as const;

/**
 * Durable tool events now replace exact arguments with a value-free structural
 * summary (`eventBoundCore.summarizeToolInputForPersistence`). Those summaries
 * are safe telemetry, but they are NOT executable arguments and must never be
 * learned as a desktop replay step.
 *
 * Versions 1 and 2 used `fields` / `fieldKinds` respectively. The broader
 * signature deliberately fails closed for malformed or partially migrated
 * summaries: once an object combines a summary envelope marker
 * (`redacted`/`schemaVersion`) with structural summary fields, discard the
 * action rather than risk replaying telemetry metadata as tool input.
 */
export function isPersistedToolInputSummaryLike(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);
  const hasRedactionMarker = hasOwn('redacted');
  const hasSchemaMarker = hasOwn('schemaVersion');
  const hasStructuralMarker = DESKTOP_TOOL_INPUT_SUMMARY_STRUCTURAL_KEYS.some(hasOwn);
  const hasAuxiliaryMarker = DESKTOP_TOOL_INPUT_SUMMARY_AUXILIARY_KEYS.some(hasOwn);
  const supportedSummaryVersion = record.schemaVersion === 1 || record.schemaVersion === 2;

  // Canonical v1/v2 summary, including a truncated/malformed instance that
  // lost its structural fields after the durable payload bound was applied.
  if (record.redacted === true && supportedSummaryVersion) return true;

  // Fail closed for partially migrated or malformed summary-shaped objects.
  if (hasStructuralMarker && (hasRedactionMarker || hasSchemaMarker)) return true;
  if (record.redacted === true && hasAuxiliaryMarker) return true;
  return false;
}

async function listRunActionEntriesForTrace(runId: string): Promise<Array<{ tool: string; input: unknown }>> {
  const { data, error } = await supabase
    .from('agent_run_events')
    .select('kind, payload, at')
    .eq('run_id', runId)
    .in('kind', DESKTOP_TRACEABLE_RUN_EVENT_KINDS)
    .order('at', { ascending: true })
    .limit(80);
  if (error || !data) return [];
  return data
    .flatMap((row: any) => {
      const tool = String(row?.payload?.tool || '').trim();
      const input = row?.payload?.input;
      if (!tool || isPersistedToolInputSummaryLike(input)) return [];
      return [{ tool, input }];
    });
}

/**
 * Harvest the raw `{tool, input}` action stream for a finished desktop/app
 * task so computerTaskRuntime can redact/bound/persist it as a trace.
 *
 * Two sources, in order:
 *   1. `agent_run_events` for the wrapper run id itself (typed-core /
 *      createPersistedRun paths write `tool_call_start` with input there).
 *   2. The swanbot-v2 sibling run: the chat computer-task path executes its
 *      desktop tools through the `swanbot-v2-ai` continuation loop, which
 *      persists tool inputs under ITS OWN `agent_runs` row
 *      (metadata.version = 'swanbot-v2-ai'), not the wrapper run created by
 *      `executeAgentRun`. Find the newest sibling created inside the task
 *      window for the same circle/user and harvest its events.
 *
 * Returns only genuine historical inputs — callers must still apply the
 * existing tool-aware exclusions and redact before persisting or injecting.
 * Value-free durable summaries are omitted because their structural metadata
 * cannot reconstruct an executable call. Tolerant of errors → [].
 */
export async function harvestDesktopRunActionEntries(args: {
  runId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  sinceIso?: string | null;
}): Promise<Array<{ tool: string; input: unknown }>> {
  try {
    if (args.runId) {
      const direct = await listRunActionEntriesForTrace(args.runId);
      if (direct.length > 0) return direct;
    }
    if (!args.circleId || !args.sinceIso) return [];
    let query = supabase
      .from('agent_runs')
      .select('id, created_at')
      .eq('circle_id', args.circleId)
      .gte('created_at', args.sinceIso)
      .eq('metadata->>version', 'swanbot-v2-ai')
      .order('created_at', { ascending: false })
      .limit(3);
    if (args.userId) query = query.eq('user_id', args.userId);
    const { data, error } = await query;
    if (error || !data) return [];
    for (const row of data) {
      const entries = await listRunActionEntriesForTrace(String((row as any).id));
      if (entries.length > 0) return entries;
    }
    return [];
  } catch {
    return [];
  }
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
  agentId?: string;
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
  // ── Secret hygiene gate (CLAUDE.md Critical Guarantees) ───────────────────
  // `saveMemory` is the single `memory_entries` chokepoint for the client —
  // `memoryService.saveMemoryWithContext` and every `saveSharedTaskMemory`-style
  // helper route through it. A memory row is permanent, embedded into pgvector
  // and re-injected into every later prompt, so a pasted key or a tool response
  // echoing a token would become a standing leak. We REFUSE rather than redact:
  // partial redaction of a multi-line secret still persists it, and the residue
  // is worth ~nothing. Never silent — always a console.warn naming the rule
  // (never the value) plus a null return the callers already treat as failure.
  // Guard source (LOCKSTEP with `supabase/functions/_shared/memory-credential-guard.ts`):
  // `src/lib/userMemoryCaps.ts`.
  const credentialFinding =
    detectCredentialMemoryContent(opts.content) || detectCredentialMemoryContent(opts.title);
  if (credentialFinding) {
    console.warn(
      '[AgentRunSystem] saveMemory REFUSED —',
      describeCredentialMemoryBlock(credentialFinding),
      `| rule=${credentialFinding.rule} scope=${opts.scope} kind=${opts.memoryKind}`,
      `surface=${opts.sourceSurface || 'unknown'} runId=${opts.sourceRunId || 'none'}`,
    );
    return null;
  }

  const basePayload = {
    scope: opts.scope,
    circle_id: opts.circleId,
    room_id: opts.roomId,
    agent_id: opts.agentId,
    user_id: opts.userId,
    session_id: opts.sessionId,
    memory_kind: opts.memoryKind,
    title: opts.title,
    content: opts.content,
    source_run_id: opts.sourceRunId,
    source_surface: opts.sourceSurface,
    importance: opts.importance,
    retrieval_mode: opts.retrievalMode,
    metadata: opts.metadata || {},
  };

  // Auto-set visibility based on scope.
  const visibility = opts.visibility || (
    opts.scope === 'user' ? 'private' :
    opts.scope === 'agent' ? 'private' :
    opts.scope === 'room' ? 'room_shared' :
    opts.scope === 'session' ? 'private' :
    'circle_shared'
  );

  const payload = {
    ...basePayload,
    visibility,
  };

  // Dedupe policy is now per-SCOPE, not session-only. A live production check
  // on 2026-07-28 found 4,621 of 4,716 active memories (98%) in 26 duplicate
  // title groups — one title repeated 3,020 times — because `circle` scope, the
  // shared team surface, fell straight through to an unconditional INSERT.
  // See memoryWritePolicyCore for the per-scope table and the reasoning.
  const dedupeEligibility = evaluateDedupeEligibility({
    scope: opts.scope,
    circleId: opts.circleId,
    title: opts.title,
  });
  const canDedupSessionMemory = dedupeEligibility.eligible;
  const findExistingSessionMemory = async () => {
    if (!canDedupSessionMemory) return null;
    const policy = memoryWriteScopePolicy(opts.scope);
    let query = supabase
      .from('memory_entries')
      .select('*')
      .eq('scope', opts.scope)
      .eq('circle_id', opts.circleId as string)
      .eq('title', opts.title)
      .eq('is_active', true)
      .limit(1);

    // Identity keys are per-scope: matching on a column the scope does not key
    // on would merge rows that are legitimately distinct.
    if (policy.identityKeys.includes('source_surface')) {
      query = opts.sourceSurface ? query.eq('source_surface', opts.sourceSurface) : query.is('source_surface', null);
    }
    if (policy.identityKeys.includes('user_id')) {
      query = opts.userId ? query.eq('user_id', opts.userId) : query.is('user_id', null);
    }
    if (policy.identityKeys.includes('agent_id')) {
      query = opts.agentId ? query.eq('agent_id', opts.agentId) : query.is('agent_id', null);
    }
    // 'content_identity': a title match alone is NOT enough. Production proved
    // why — one title covered 1,889 distinct contents, so overwriting on title
    // would have destroyed them. Require the content to be identical too.
    if (policy.strategy === 'content_identity') {
      query = query.eq('content', opts.content ?? '');
    }

    const { data: existing, error: existingError } = await query.maybeSingle();
    if (existingError) {
      devLog.trace('[AgentRunSystem] saveMemory session dedup lookup skipped:', existingError.message);
      return null;
    }
    return existing;
  };

  const updateExistingSessionMemory = async (id: string, fallback: any): Promise<MemoryEntry | null> => {
    const { data: updated, error: updateError } = await supabase
      .from('memory_entries')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      devLog.trace('[AgentRunSystem] saveMemory session dedup update skipped:', updateError.message);
      return fallback ? mapMemory(fallback) : null;
    }
    devLog.trace('[AgentRunSystem] saveMemory session dedup updated:', opts.title?.slice(0, 50));
    // Re-embed: the row's stored vector now describes the PREVIOUS content.
    queueMemoryEmbeddingSafe(updated.id, opts.title, opts.content);
    return mapMemory(updated);
  };

  const existingSessionMemory = await findExistingSessionMemory();
  if (existingSessionMemory?.id) {
    return updateExistingSessionMemory(existingSessionMemory.id, existingSessionMemory);
  }

  let { data, error } = await supabase
    .from('memory_entries')
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505' && error.message?.includes('idx_memory_session_dedup')) {
      const duplicateSessionMemory = await findExistingSessionMemory();
      if (duplicateSessionMemory?.id) {
        return updateExistingSessionMemory(duplicateSessionMemory.id, duplicateSessionMemory);
      }
      devLog.trace('[AgentRunSystem] saveMemory session duplicate ignored:', opts.title?.slice(0, 50));
      return null;
    }
    console.error('[AgentRunSystem] saveMemory FAILED:', error.message, '| code:', error.code, '| hint:', error.hint, '| details:', error.details);
    console.error('[AgentRunSystem] saveMemory params: scope=', opts.scope, 'circleId=', opts.circleId, 'userId=', opts.userId, 'kind=', opts.memoryKind);
    return null;
  }
  devLog.trace('[AgentRunSystem] saveMemory OK:', opts.title?.slice(0, 50));
  // Embed-on-write. This is the single client-side `memory_entries` insert
  // chokepoint, so one line here covers the save_memory tool, MemoryViewer
  // quick-save, saveMemoryWithContext, saveAgentMemory and saveSharedTaskMemory.
  // Before this, `embedAndStoreMemory` had only two call sites — both inside a
  // code path that was itself dead in the shipped config — so almost no row was
  // ever embedded, and `match_memories` filters `embedding IS NOT NULL`.
  // Synchronous, returns void, never throws: it structurally cannot become part
  // of the write's success condition.
  queueMemoryEmbeddingSafe(data.id, opts.title, opts.content);
  return mapMemory(data);
}

export async function loadMemories(opts: {
  circleId: string;
  roomId?: string;
  agentId?: string;
  agentAliases?: string[];
  userId?: string;
  scopes?: MemoryScope[];
  limit?: number;
}): Promise<MemoryEntry[]> {
  // Load shared memories separately from user-private memories.
  // Session memories are visibility-aware and may be either private or circle-shared.
  const results: MemoryEntry[] = [];

  // 1. Load shared non-session memories (visible to all circle members)
  const sharedScopes = (opts.scopes || ['circle', 'room', 'session', 'org'])
    .filter(s => s !== 'user' && s !== 'session' && s !== 'agent');
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
      .order('updated_at', { ascending: false })
      .limit(20);

    if (data) results.push(...data.map(mapMemory));
  }

  const agentLookupIds = resolveMemoryLookupIds(opts.agentId, opts.agentAliases);
  // FAIL LOUD (2026-07-24): `scopes:['agent']` with no agent id can never match
  // a row — the agent branch below is gated on a lookup id and the shared
  // branch above filters 'agent' out. Returning [] silently is what let two
  // SOUL-memory readers stay permanently empty without anyone noticing.
  if (isAgentScopeMissingLookupId({ scopes: opts.scopes, lookupIds: agentLookupIds })) {
    console.warn(describeAgentScopeLookupWarning({ scopes: opts.scopes, caller: 'loadMemories' }));
  }
  const wantsAgent = agentLookupIds.length > 0 && scopesRequestAgentMemory(opts.scopes);
  if (wantsAgent) {
    let agentQuery = supabase
      .from('memory_entries')
      .select('*')
      .eq('circle_id', opts.circleId)
      .eq('scope', 'agent')
      .eq('visibility', 'private')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      // Bug 3 (2026-07-24): this was pinned at 20 regardless of opts.limit, so
      // AgentMemoryPanel's request for 200 and the prompt context both
      // truncated silently at 20 rows.
      .limit(resolveMemoryScopeQueryLimit(opts.limit, DEFAULT_AGENT_SCOPE_MEMORY_LIMIT));
    agentQuery = agentLookupIds.length === 1
      ? agentQuery.eq('agent_id', agentLookupIds[0])
      : agentQuery.in('agent_id', agentLookupIds);

    if (opts.userId) agentQuery = agentQuery.eq('user_id', opts.userId);

    const { data } = await agentQuery;

    if (data) results.push(...data.map(mapMemory));
  }

  // Sort combined results by recency and cap
  results.sort((a, b) =>
    new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()
  );
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
export async function buildMemoryContext(
  circleId: string,
  roomId?: string,
  userId?: string,
  agentId?: string,
  agentName?: string,
  /**
   * Alias write-keys this agent has ever used — pass
   * `agentRuntimeSubject.memoryAgentAliases` (or the subject payload's
   * `legacyAgentIds` + db id + session key). Without them the MODEL reads
   * alias-blind while the Office UI (`AgentMemoryPanel`) reads alias-aware, so
   * after any subject-key rotation (session agent published to
   * `circle_office_agents`, or a bridge reconnect) the agent's own memory stays
   * on screen and disappears from its prompt.
   */
  agentAliases?: string[],
): Promise<string> {
  const agentLookupIds = resolveMemoryLookupIds(agentId, agentAliases);
  const memories = (await loadMemories({
    circleId,
    roomId,
    agentId,
    agentAliases: agentLookupIds.slice(1),
    userId, // REQUIRED for safe user-scope loading
    scopes: agentLookupIds.length > 0 ? ['circle', 'room', 'user', 'agent'] : ['circle', 'room', 'user'],
    limit: 25,
  }))
    .filter(m => m.retrieval_mode !== 'manual_only');

  // Priority sort: by importance (if available) then kind
  let activeSoulKey: string | null = null;
  try {
    if (agentId && userId) {
      const { getAgentSoulInfo } = await import('./agentSoulMemory');
      activeSoulKey = (await getAgentSoulInfo({ circleId, agentId, agentName, userId })).soulKey;
    }
  } catch {}
  const kindPriority: Record<string, number> = {
    instruction: 0, preference: 1, policy: 2, decision: 3, fact: 4, finding: 5, context: 6,
  };
  memories.sort((a, b) => {
    const aSoul = String(a.metadata?.soul_key || '');
    const bSoul = String(b.metadata?.soul_key || '');
    const aSoulBoost = activeSoulKey && a.scope === 'agent' ? (aSoul === activeSoulKey ? 0.3 : aSoul ? -0.05 : 0.08) : 0;
    const bSoulBoost = activeSoulKey && b.scope === 'agent' ? (bSoul === activeSoulKey ? 0.3 : bSoul ? -0.05 : 0.08) : 0;
    const aStartupBoost = a.retrieval_mode === 'startup' ? 0.25 : 0;
    const bStartupBoost = b.retrieval_mode === 'startup' ? 0.25 : 0;
    const aImp = (a.importance ?? (1.0 - (kindPriority[a.memory_kind] ?? 9) / 10)) + aStartupBoost + aSoulBoost;
    const bImp = (b.importance ?? (1.0 - (kindPriority[b.memory_kind] ?? 9) / 10)) + bStartupBoost + bSoulBoost;
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

  try {
    const { data: sharedDoc } = await supabase
      .from('circle_memory')
      .select('content, last_edited_at')
      .eq('circle_id', circleId)
      .single();

    const sharedContent = sharedDoc?.content?.trim();
    if (sharedContent) {
      const docBlock = `### Shared Circle Memory\n${sharedContent.slice(0, 900)}`;
      sections.push(docBlock);
      totalChars += docBlock.length;
    }
  } catch {}

  // Render in priority order: agent > room > user > circle
  const scopeOrder: MemoryScope[] = agentLookupIds.length > 0
    ? ['agent', 'room', 'user', 'circle']
    : ['room', 'user', 'circle'];
  for (const scope of scopeOrder) {
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
      const label =
        scope === 'agent' ? 'Agent' :
        scope === 'room' ? 'Project' :
        scope === 'user' ? 'Personal' :
        'Circle';
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

/**
 * Subscribe to INSERT/UPDATE on agent_runs for a circle (ops-board live
 * tracking). The callback is debounced so bursty tool-loop updates trigger
 * one refresh; it receives the most recent changed run (callers typically
 * just refetch via listCircleLiveRuns). Returns an unsubscribe function.
 */
export function subscribeToCircleRuns(
  circleId: string,
  callback: (latest: AgentRun | null) => void,
  opts?: { debounceMs?: number },
): () => void {
  const debounceMs = opts?.debounceMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: AgentRun | null = null;

  const handleChange = (payload: { new: unknown }) => {
    try {
      latest = payload?.new ? mapRun(payload.new) : latest;
    } catch {}
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        callback(latest);
      } catch (err) {
        console.error('[AgentRunSystem] subscribeToCircleRuns callback error:', err);
      }
    }, debounceMs);
  };

  // Route through the shared resilient wrapper so the live-run channel actively
  // reconnects after a socket drop instead of silently freezing. onCatchUp fires
  // only on a RE-subscribe (not first mount): re-fetch the active-run list so the
  // ops board self-heals rows it missed while the channel was down.
  const handle = subscribeWithReconnect({
    channelName: `circle-runs:${circleId}`,
    setup: (channel) =>
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'agent_runs', filter: `circle_id=eq.${circleId}` }, handleChange)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'agent_runs', filter: `circle_id=eq.${circleId}` }, handleChange),
    onCatchUp: () => {
      void getActiveRuns(circleId)
        .then((runs) => {
          try {
            callback(runs[0] ?? null);
          } catch (err) {
            console.error('[AgentRunSystem] subscribeToCircleRuns catch-up callback error:', err);
          }
        })
        .catch((err) => {
          console.error('[AgentRunSystem] subscribeToCircleRuns catch-up error:', err);
        });
    },
  });

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    handle.unsubscribe();
  };
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function mapRun(d: any): AgentRun {
  return {
    id: d.id, agent_id: d.agent_id, circle_id: d.circle_id, user_id: d.user_id, surface: d.surface,
    room_id: d.room_id, task_id: d.task_id, chat_session_id: d.chat_session_id,
    title: d.title, goal: d.goal, mode: d.mode, model: d.model, provider: d.provider,
    status: d.status, plan_summary: d.plan_summary,
    current_step_index: d.current_step_index || 0, total_steps: d.total_steps || 0,
    input_tokens: d.input_tokens || 0, output_tokens: d.output_tokens || 0,
    cached_tokens: d.cached_tokens || 0, estimated_cost: parseFloat(d.estimated_cost || '0'),
    final_stop_reason: d.final_stop_reason || undefined,
    started_at: d.started_at, completed_at: d.completed_at, updated_at: d.updated_at, created_at: d.created_at,
    parent_run_id: d.parent_run_id, delegated_to: d.delegated_to, metadata: d.metadata || {},
  };
}

function mapStep(d: any): RunStep {
  return {
    id: d.id, run_id: d.run_id, step_index: d.step_index, step_kind: d.step_kind,
    title: d.title, body: d.body, tool_name: d.tool_name, tool_input: d.tool_input,
    tool_output: d.tool_output, delegated_to: d.delegated_to, child_run_id: d.child_run_id,
    status: d.status, duration_ms: d.duration_ms, tokens_used: d.tokens_used || 0,
    created_at: d.created_at, metadata: d.metadata || {},
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
    session_id: d.session_id, agent_id: d.agent_id,
    user_id: d.user_id, memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, source_surface: d.source_surface,
    is_active: d.is_active, visibility: d.visibility, importance: d.importance,
    // `pinned` was never projected, so AgentMemoryPanel's Pin button read
    // undefined forever: the label was permanently "Pin", clicking an already
    // pinned memory re-pinned it, and unpinning from Office was impossible.
    pinned: d.pinned ?? false,
    retrieval_mode: d.retrieval_mode, status: d.status, access_count: d.access_count,
    last_accessed_at: d.last_accessed_at, updated_at: d.updated_at, created_at: d.created_at,
    metadata: d.metadata || {},
  };
}
