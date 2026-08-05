/**
 * officeTerminal.ts — Shared Office Terminal relay
 *
 * Two-layer architecture:
 *   1. Supabase DB — durable history (office_terminal_messages)
 *   2. Supabase Broadcast — ephemeral real-time fan-out
 *
 * Flow:
 *   Sender calls sendTerminalCommand()
 *     → writes row to DB
 *     → broadcasts on `office:terminal:{circleId}`
 *   Each member subscribes via subscribeToTerminalCommands()
 *     → authenticates and reloads the exact durable row
 *     → filters for @all or their own agent IDs
 *     → hands the command to agentInvocation's claimant RPC flow
 *   Execution state is written only through invoke_agent, stream_response, and
 *   mark_message_done; clients read updates via Realtime Postgres changes.
 */

import { supabase } from './supabase';
import { subscribeWithReconnect, type ResilientSubscriptionHandle } from './subscribeWithReconnect';
import { RealtimeChannel } from '@supabase/supabase-js';
import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';

const TERMINAL_HISTORY_CACHE_TTL_MS = 15_000;
const TERMINAL_RESPONSES_CACHE_TTL_MS = 15_000;
const TERMINAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXECUTABLE_TERMINAL_MESSAGE_STATUSES = new Set<TerminalMessageStatus>(['pending', 'invoked']);
// BlackSwan is a virtual Office agent rather than a UUID-backed row. It must
// never be written into UUID columns or relayed as if it were a durable id.
const BLACKSWAN_VIRTUAL_AGENT_ID = 'blackswan-default';

// ─── Types ────────────────────────────────────────────────────────────────────

export type TerminalMessageStatus = 'pending' | 'invoked' | 'streaming' | 'done' | 'error' | 'deleted';

export interface TerminalMessage {
  id: string;
  circleId: string;
  senderId: string;
  senderName: string;
  targetAgentId: string | null;    // null = @all (legacy single target)
  targetAgentName: string;         // "@all" or agent name
  targetAgentIds: string[] | null; // multi-select: array of agent IDs
  model: string | null;            // model preference: 'blackswan', 'claude-haiku', etc.
  commandText: string;
  // Phase 2 response fields removed — responses now live in office_terminal_responses table.
  // These are kept as null stubs for backward-compat with UI components that check them.
  responseText: string | null;
  responseAgentId: string | null;
  responseAgentName: string | null;
  tokenCost: number;
  latencyMs: number | null;
  status: TerminalMessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SendCommandParams {
  circleId: string;
  senderId: string;
  senderName: string;
  commandText: string;
  targetAgentId?: string | null;
  targetAgentName?: string;
  targetAgentIds?: string[] | null;
  targetAgentSubject?: AgentRuntimeSubjectMetadata | null;
  targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
  model?: string | null;
}

export interface BroadcastCommandPayload {
  messageId: string;
  circleId: string;
  senderId: string;
  senderName: string;
  commandText: string;
  targetAgentId: string | null;
  targetAgentName: string;
  targetAgentIds: string[] | null;
  targetAgentSubject?: AgentRuntimeSubjectMetadata | null;
  targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
  model: string | null;
  timestamp: string;
}

interface BroadcastCommandWakeupPayload {
  messageId: string;
  circleId: string;
  targetAgentId: string | null;
  targetAgentIds: string[] | null;
  timestamp: string;
}

export interface BroadcastResponsePayload {
  messageId: string;
  circleId: string;
  responseAgentId: string;
  responseAgentName: string;
  responseText: string;
  tokenCost: number;
  latencyMs: number;
  status: TerminalMessageStatus;
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function isTerminalUuid(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_UUID_RE.test(value);
}

function asTerminalRow(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sanitizeTerminalTargetIds(
  targetAgentId: unknown,
  targetAgentIds: unknown,
): {
  targetAgentId: string | null;
  targetAgentIds: string[] | null;
  includesBlackSwan: boolean;
} {
  const rawIds = Array.isArray(targetAgentIds) ? targetAgentIds : [];
  const safeIds = Array.from(new Set(rawIds.filter(isTerminalUuid)));
  return {
    targetAgentId: isTerminalUuid(targetAgentId) ? targetAgentId : null,
    targetAgentIds: safeIds.length > 0 ? safeIds : null,
    includesBlackSwan:
      targetAgentId === BLACKSWAN_VIRTUAL_AGENT_ID
      || rawIds.includes(BLACKSWAN_VIRTUAL_AGENT_ID),
  };
}

function persistableTerminalTargetName(
  value: unknown,
  includesBlackSwan: boolean,
): string {
  const name = typeof value === 'string' && value.trim() ? value.trim() : '@all';
  if (!includesBlackSwan || /blackswan|\bswan\b/i.test(name)) return name;
  // Mixed multi-selects otherwise lose the virtual BlackSwan target when their
  // UUID-only target list is persisted. Keep a bounded, non-id routing marker
  // in the already-durable display-name column.
  return `${name.slice(0, 160)} · @BlackSwan`;
}

function parseTerminalCommandWakeup(
  expectedCircleId: string,
  payload: unknown,
): { messageId: string; circleId: string } | null {
  const wakeup = asTerminalRow(payload);
  if (
    !isTerminalUuid(expectedCircleId)
    || !wakeup
    || !isTerminalUuid(wakeup.messageId)
    || !isTerminalUuid(wakeup.circleId)
    || wakeup.circleId !== expectedCircleId
  ) {
    return null;
  }
  return {
    messageId: wakeup.messageId,
    circleId: wakeup.circleId,
  };
}

function reconstructExecutableTerminalCommand(
  expected: { messageId: string; circleId: string },
  value: unknown,
): BroadcastCommandPayload | null {
  const row = asTerminalRow(value);
  if (
    !row
    || row.id !== expected.messageId
    || row.circle_id !== expected.circleId
    || !isTerminalUuid(row.id)
    || !isTerminalUuid(row.circle_id)
    || !isTerminalUuid(row.sender_id)
    || !EXECUTABLE_TERMINAL_MESSAGE_STATUSES.has(row.status as TerminalMessageStatus)
    || typeof row.command_text !== 'string'
    || !row.command_text.trim()
    || typeof row.sender_name !== 'string'
  ) {
    return null;
  }

  const rawTargetId = row.target_agent_id;
  const rawTargetIds = row.target_agent_ids;
  if (
    (rawTargetId !== null && rawTargetId !== undefined && !isTerminalUuid(rawTargetId))
    || (
      rawTargetIds !== null
      && rawTargetIds !== undefined
      && (
        !Array.isArray(rawTargetIds)
        || rawTargetIds.some((id) => !isTerminalUuid(id))
      )
    )
    || (row.model !== null && row.model !== undefined && typeof row.model !== 'string')
  ) {
    return null;
  }

  const targets = sanitizeTerminalTargetIds(rawTargetId, rawTargetIds);
  const createdAt = typeof row.created_at === 'string' && row.created_at
    ? row.created_at
    : null;
  if (
    !createdAt
    || !row.sender_name.trim()
    || typeof row.target_agent_name !== 'string'
    || !row.target_agent_name.trim()
  ) {
    return null;
  }

  return {
    messageId: row.id,
    circleId: row.circle_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    commandText: row.command_text,
    targetAgentId: targets.targetAgentId,
    targetAgentName: persistableTerminalTargetName(row.target_agent_name, false),
    targetAgentIds: targets.targetAgentIds,
    model: typeof row.model === 'string' ? row.model : null,
    // Subject metadata has no durable office_terminal_messages column. Never
    // reconstruct it from the untrusted wake-up envelope.
    timestamp: createdAt,
  };
}

type TerminalAuthorityClient = Pick<typeof supabase, 'auth' | 'from'>;

/**
 * Resolve a Realtime wake-up into the exact RLS-visible durable command.
 * Realtime Broadcast is not an authority boundary: only the authenticated row
 * supplies command, sender, targets, model, timestamp, and executable state.
 */
export async function loadAuthorizedTerminalCommandFromWakeup(
  expectedCircleId: string,
  payload: unknown,
  client: TerminalAuthorityClient = supabase,
): Promise<BroadcastCommandPayload | null> {
  const expected = parseTerminalCommandWakeup(expectedCircleId, payload);
  if (!expected) return null;

  try {
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user || !isTerminalUuid(authData.user.id)) return null;

    const { data, error } = await client
      .from('office_terminal_messages')
      .select(
        'id,circle_id,sender_id,sender_name,target_agent_id,target_agent_name,target_agent_ids,model,command_text,status,created_at',
      )
      .eq('id', expected.messageId)
      .eq('circle_id', expected.circleId)
      .maybeSingle();

    if (error || !data) return null;
    return reconstructExecutableTerminalCommand(expected, data);
  } catch {
    return null;
  }
}

function isTerminalCommandForListener(
  payload: BroadcastCommandPayload,
  myAgentIds: ReadonlySet<string>,
): boolean {
  const targetsBlackSwan = /blackswan|\bswan\b/i.test(payload.targetAgentName);
  if (payload.targetAgentIds?.length) {
    return payload.targetAgentIds.some((id) => myAgentIds.has(id))
      || (targetsBlackSwan && myAgentIds.has(BLACKSWAN_VIRTUAL_AGENT_ID));
  }
  if (payload.targetAgentId) return myAgentIds.has(payload.targetAgentId);
  if (targetsBlackSwan) return myAgentIds.has(BLACKSWAN_VIRTUAL_AGENT_ID);

  const targetName = payload.targetAgentName.trim().toLowerCase();
  return !targetName || targetName === 'all' || targetName === '@all';
}

function fromRow(row: Record<string, unknown>): TerminalMessage {
  return {
    id:              row.id as string,
    circleId:        row.circle_id as string,
    senderId:        row.sender_id as string,
    senderName:      row.sender_name as string,
    targetAgentId:   (row.target_agent_id as string | null) ?? null,
    targetAgentName: (row.target_agent_name as string) || '@all',
    targetAgentIds:  (row.target_agent_ids as string[] | null) ?? null,
    model:           (row.model as string | null) ?? null,
    commandText:     row.command_text as string,
    // Phase 3: response fields moved to office_terminal_responses table.
    // Return null/0 stubs — UI reads from the responses map instead.
    responseText:    null,
    responseAgentId: null,
    responseAgentName: null,
    tokenCost:       0,
    latencyMs:       null,
    status:          (row.status as TerminalMessageStatus) || 'pending',
    createdAt:       row.created_at as string,
    updatedAt:       row.updated_at as string,
  };
}

// ─── Module state (broadcast channels) ───────────────────────────────────────

const commandChannels  = new Map<string, ResilientSubscriptionHandle>();
// Send-only fallback: a broadcast channel for callers that dispatch commands
// without ever subscribing. Kept separate from `commandChannels` so the two
// lifecycles (handle vs raw channel) never collide.
const sendOnlyCommandChannels = new Map<string, RealtimeChannel>();
const responseChannels = new Map<string, ResilientSubscriptionHandle>();
const terminalHistoryCache = new Map<string, { at: number; messages: TerminalMessage[] }>();
const terminalHistoryInflight = new Map<string, Promise<{ messages: TerminalMessage[]; error?: string }>>();
const terminalResponsesCache = new Map<string, { at: number; responses: TerminalResponse[] }>();
const terminalResponsesInflight = new Map<string, Promise<TerminalResponse[]>>();

// ─── Send a command ───────────────────────────────────────────────────────────

export async function sendTerminalCommand(
  params: SendCommandParams
): Promise<{ messageId?: string; error?: string }> {
  const {
    circleId, senderId, senderName,
    commandText, targetAgentId = null, targetAgentName = '@all',
    targetAgentIds = null, model = null,
  } = params;

  if (!isTerminalUuid(circleId) || !isTerminalUuid(senderId)) {
    return { error: 'Invalid terminal command identity.' };
  }
  const safeTargets = sanitizeTerminalTargetIds(targetAgentId, targetAgentIds);
  const safeTargetName = persistableTerminalTargetName(
    targetAgentName,
    safeTargets.includesBlackSwan,
  );

  // 1. Write to DB
  const { data, error } = await supabase
    .from('office_terminal_messages')
    .insert({
      circle_id:         circleId,
      sender_id:         senderId,
      sender_name:       senderName,
      target_agent_id:   safeTargets.targetAgentId,
      target_agent_name: safeTargetName,
      target_agent_ids:  safeTargets.targetAgentIds,
      model:             model,
      command_text:      commandText,
      status:            'pending',
    })
    .select('id')
    .single();

  if (error) return { error: error.message };
  const messageId = (data as Record<string, unknown>).id as string;
  if (!isTerminalUuid(messageId)) {
    return { error: 'Terminal command persistence returned an invalid message id.' };
  }

  // 2. Broadcast an advisory wake-up only. Receivers must fetch the exact
  // authenticated durable row before any invocation.
  const channel = await getOrCreateCommandChannel(circleId);
  await channel.send({
    type: 'broadcast',
    event: 'command',
    payload: {
      messageId,
      circleId,
      targetAgentId: safeTargets.targetAgentId,
      targetAgentIds: safeTargets.targetAgentIds,
      timestamp: new Date().toISOString(),
    } satisfies BroadcastCommandWakeupPayload,
  });

  return { messageId };
}

// ─── Subscribe to incoming commands (for agent gateways) ─────────────────────

export function subscribeToTerminalCommands(
  circleId: string,
  myAgentIds: string[],
  onCommand: (payload: BroadcastCommandPayload) => void | Promise<void>
): () => void {
  const channelName = `office-terminal-cmd-${circleId}`;
  const listenerIds = new Set(
    myAgentIds.filter((id) => isTerminalUuid(id) || id === BLACKSWAN_VIRTUAL_AGENT_ID),
  );
  const authorizedMessageIds = new Set<string>();
  const authorityReadsInFlight = new Set<string>();
  if (!isTerminalUuid(circleId) || listenerIds.size === 0) return () => {};

  // Remove existing
  const existing = commandChannels.get(circleId);
  if (existing) existing.unsubscribe();

  // Broadcast is ephemeral — there is no backlog to refetch, so no onCatchUp.
  // Reconnect alone is the fix: a dropped command channel used to mean the
  // terminal silently stopped dispatching to this agent until a full remount.
  // `channelConfig` MUST be re-applied on reconnect or `self: true` is lost and
  // the sender stops seeing its own commands after the first drop.
  const handle = subscribeWithReconnect({
    channelName,
    channelConfig: { config: { broadcast: { self: true } } },
    setup: (channel) => channel
      .on('broadcast', { event: 'command' }, ({ payload }) => {
        const expected = parseTerminalCommandWakeup(circleId, payload);
        if (
          !expected
          || authorizedMessageIds.has(expected.messageId)
          || authorityReadsInFlight.has(expected.messageId)
        ) {
          return;
        }

        authorityReadsInFlight.add(expected.messageId);
        void loadAuthorizedTerminalCommandFromWakeup(circleId, payload)
          .then(async (command) => {
            if (!command) return;
            authorizedMessageIds.add(command.messageId);
            if (!isTerminalCommandForListener(command, listenerIds)) return;
            await onCommand(command);
          })
          .catch(() => {
            // Fail closed. Broadcast data and read errors never reach an agent.
          })
          .finally(() => {
            authorityReadsInFlight.delete(expected.messageId);
          });
      }),
  });

  commandChannels.set(circleId, handle);

  return () => {
    commandChannels.delete(circleId);
    handle.unsubscribe();
  };
}

// ─── Subscribe to response updates ───────────────────────────────────────────

export function subscribeToTerminalResponses(
  circleId: string,
  onResponse: (payload: BroadcastResponsePayload) => void
): () => void {
  const channelName = `office-terminal-resp-${circleId}`;

  const existing = responseChannels.get(circleId);
  if (existing) existing.unsubscribe();

  const handle = subscribeWithReconnect({
    channelName,
    setup: (channel) => channel
      .on('broadcast', { event: 'response' }, ({ payload }) => {
        onResponse(payload as BroadcastResponsePayload);
      }),
  });

  responseChannels.set(circleId, handle);

  return () => {
    responseChannels.delete(circleId);
    handle.unsubscribe();
  };
}

// ─── Load responses for a set of messages ────────────────────────────────────

export interface TerminalResponse {
  id: string;
  messageId: string;
  agentId: string;
  agentName: string;
  responseText: string;
  status: 'pending' | 'streaming' | 'done' | 'error';
  tokenCount: number;
  latencyMs?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export async function loadResponsesForMessages(
  messageIds: string[]
): Promise<TerminalResponse[]> {
  if (messageIds.length === 0) return [];
  const cacheKey = [...messageIds].sort().join(',');
  const cached = terminalResponsesCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TERMINAL_RESPONSES_CACHE_TTL_MS) {
    return cached.responses;
  }
  const inflight = terminalResponsesInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async (): Promise<TerminalResponse[]> => {
    try {
      const { data, error } = await supabase
        .from('office_terminal_responses')
        .select('*')
        .in('message_id', messageIds);

      if (error || !data) return [];

      const responses = (data as Record<string, unknown>[]).map(row => ({
        id:           row.id as string,
        messageId:    row.message_id as string,
        agentId:      row.agent_id as string,
        agentName:    row.agent_name as string,
        responseText: row.response_text as string,
        status:       row.status as TerminalResponse['status'],
        tokenCount:   (row.token_count as number) || 0,
        latencyMs:    row.latency_ms as number | undefined,
        errorMessage: row.error_message as string | undefined,
        createdAt:    row.created_at as string,
        updatedAt:    row.updated_at as string,
      }));
      terminalResponsesCache.set(cacheKey, { at: Date.now(), responses });
      return responses;
    } finally {
      terminalResponsesInflight.delete(cacheKey);
    }
  })();
  terminalResponsesInflight.set(cacheKey, run);
  return run;
}

// ─── Load history ─────────────────────────────────────────────────────────────

export async function loadTerminalHistory(
  circleId: string,
  limit = 50
): Promise<{ messages: TerminalMessage[]; error?: string }> {
  const cacheKey = `${circleId}:${limit}`;
  const cached = terminalHistoryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TERMINAL_HISTORY_CACHE_TTL_MS) {
    return { messages: cached.messages };
  }
  const inflight = terminalHistoryInflight.get(cacheKey);
  if (inflight) return inflight;

  const run = (async (): Promise<{ messages: TerminalMessage[]; error?: string }> => {
    try {
      const { data, error } = await supabase
        .from('office_terminal_messages')
        .select('*')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) return { messages: [], error: error.message };

      // Reverse so oldest is first
      const messages = ((data as Record<string, unknown>[]) || [])
        .map(fromRow)
        .reverse();
      terminalHistoryCache.set(cacheKey, { at: Date.now(), messages });
      return { messages };
    } finally {
      terminalHistoryInflight.delete(cacheKey);
    }
  })();
  terminalHistoryInflight.set(cacheKey, run);
  return run;
}

// ─── Subscribe to Realtime DB changes on terminal messages ────────────────────

export function subscribeToTerminalMessages(
  circleId: string,
  onUpdate: (msg: TerminalMessage) => void,
  onDelete?: (id: string) => void,
  /** Optional refetch replayed after a reconnect / silent-staleness window.
   *  Terminal output that landed while the socket was down never arrives as an
   *  event, so without this the transcript is permanently missing that gap. */
  onCatchUp?: () => void,
): () => void {
  const handle = subscribeWithReconnect({
    channelName: `terminal-db-${circleId}`,
    onCatchUp,
    setup: (channel) => channel
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'office_terminal_messages',
      filter: `circle_id=eq.${circleId}`,
    }, ({ new: row, old: oldRow, eventType }) => {
      // Hard DELETE — notify component to remove from state
      if (eventType === 'DELETE') {
        const id = (oldRow as any)?.id;
        if (id && onDelete) onDelete(id);
        return;
      }
      if (!row) return;

      const msg = fromRow(row as Record<string, unknown>);
      onUpdate(msg);
    }),
  });

  return () => handle.unsubscribe();
}

// ─── Delete a terminal message (hard delete — removes row + responses) ───────

export async function deleteTerminalMessage(messageId: string): Promise<{ error?: string }> {
  try {
    // Delete responses first (child rows)
    await supabase
      .from('office_terminal_responses')
      .delete()
      .eq('message_id', messageId);

    // Delete the message itself
    const { error } = await supabase
      .from('office_terminal_messages')
      .delete()
      .eq('id', messageId);

    if (error) return { error: error.message };
    return {};
  } catch (e: any) {
    return { error: e.message };
  }
}

// ─── Update agent analytics ───────────────────────────────────────────────────

export async function updateAgentAnalytics(
  agentId: string,
  tokenDelta: number,
  latencyMs: number
): Promise<void> {
  // Try RPC first (atomic increment — best approach)
  const { error: rpcError } = await supabase.rpc('increment_agent_analytics', {
    p_agent_id:    agentId,
    p_tokens:      tokenDelta,
    p_latency_ms:  latencyMs,
  });

  if (rpcError) {
    // Fallback: use raw SQL via Supabase's built-in atomic increment
    // This avoids the read-then-write race condition
    await supabase.from('circle_office_agents').update({
      // Supabase doesn't support atomic increment via .update(), so we use rpc or raw SQL
      // For now: simple update (acceptable with low concurrency in MVP)
      last_response_ms: latencyMs,
      updated_at:       new Date().toISOString(),
    }).eq('id', agentId);

    // Note: token/message increments will be slightly lossy without the RPC.
    // Create this RPC in Supabase SQL Editor for atomic increments:
    // CREATE OR REPLACE FUNCTION increment_agent_analytics(p_agent_id uuid, p_tokens bigint, p_latency_ms int)
    // RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
    // BEGIN
    //   UPDATE circle_office_agents SET
    //     token_usage_today  = token_usage_today  + p_tokens,
    //     token_usage_total  = token_usage_total  + p_tokens,
    //     message_count_today = message_count_today + 1,
    //     message_count_total = message_count_total + 1,
    //     last_response_ms   = p_latency_ms,
    //     updated_at         = now()
    //   WHERE id = p_agent_id;
    // END; $$;
  }
}

// ─── Sync agent token snapshot to DB ──────────────────────────────────────────
// Called every 30s from OfficeTab with cumulative session token counts.
// The DB-side RPC tracks the prior snapshot key so bridge restarts cannot
// reset daily/all-time aggregates back to zero.

let _tokenSnapshotSyncDisabled = false;
let _tokenSnapshotSyncWarningShown = false;

function shouldDisableTokenSnapshotSync(error: any): boolean {
  const code = String(error?.code || '');
  const status = Number(error?.status || 0);
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    status === 404 ||
    message.includes('sync_agent_token_snapshot') ||
    message.includes('schema cache') ||
    message.includes('could not find the function') ||
    message.includes('function public.sync_agent_token_snapshot')
  );
}

function disableTokenSnapshotSyncForSession(error?: any) {
  _tokenSnapshotSyncDisabled = true;
  if (_tokenSnapshotSyncWarningShown) return;
  _tokenSnapshotSyncWarningShown = true;
  const detail = error?.message ? ` Last error: ${error.message}` : '';
  console.warn(
    '[syncAgentTokenSnapshot] RPC unavailable; disabled Office token snapshot sync for this page session. ' +
    'Apply the Office cost snapshot migration and reload to re-enable DB sync.' +
    detail,
  );
}

export async function syncAgentTokenSnapshot(
  circleId: string,
  agentName: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  messageCount: number,
  estimatedCost: number,
  model?: string,
  snapshotKey?: string,
): Promise<void> {
  if (_tokenSnapshotSyncDisabled) return;
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const { error } = await supabase.rpc('sync_agent_token_snapshot', {
      p_circle_id:      circleId,
      p_owner_id:       auth.user.id,
      p_agent_name:     agentName,
      p_input_tokens:   inputTokens,
      p_output_tokens:  outputTokens,
      p_cached_tokens:  cachedTokens,
      p_message_count:  messageCount,
      p_estimated_cost: estimatedCost,
      p_model:          model || null,
      p_snapshot_key:   snapshotKey || null,
    });

    if (error) {
      if (snapshotKey && /p_snapshot_key|sync_agent_token_snapshot|function/i.test(error.message || '')) {
        const { error: legacyError } = await supabase.rpc('sync_agent_token_snapshot', {
          p_circle_id:      circleId,
          p_owner_id:       auth.user.id,
          p_agent_name:     agentName,
          p_input_tokens:   inputTokens,
          p_output_tokens:  outputTokens,
          p_cached_tokens:  cachedTokens,
          p_message_count:  messageCount,
          p_estimated_cost: estimatedCost,
          p_model:          model || null,
        });
        if (!legacyError) return;
        if (shouldDisableTokenSnapshotSync(legacyError)) {
          disableTokenSnapshotSyncForSession(legacyError);
          return;
        }
      }
      if (shouldDisableTokenSnapshotSync(error)) {
        disableTokenSnapshotSyncForSession(error);
        return;
      }
      console.warn('[syncAgentTokenSnapshot] RPC failed:', error.message);
    }
  } catch (err) {
    console.warn('[syncAgentTokenSnapshot] Error:', err);
  }
}

// ─── Update agent position ────────────────────────────────────────────────────

export async function updateAgentPosition(
  agentId: string,
  x: number,
  y: number
): Promise<void> {
  await supabase
    .from('circle_office_agents')
    .update({
      position_x: Math.max(0, Math.min(1, x)),
      position_y: Math.max(0, Math.min(1, y)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId);
}

// ─── Update last command on agent row ────────────────────────────────────────

export async function updateAgentLastCommand(
  agentId: string,
  command: string
): Promise<void> {
  await supabase
    .from('circle_office_agents')
    .update({
      last_command:    command,
      last_command_at: new Date().toISOString(),
    })
    .eq('id', agentId);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function getOrCreateCommandChannel(circleId: string): Promise<RealtimeChannel> {
  // Prefer the live subscriber's channel — read through the handle, never
  // cached, because reconnect swaps the underlying channel object and a stale
  // reference would send into a removed channel (silently dropped commands).
  const subscribed = commandChannels.get(circleId)?.getChannel();
  if (subscribed) return subscribed;

  // No active subscription (send-only caller): keep a private channel.
  const existing = sendOnlyCommandChannels.get(circleId);
  if (existing) return existing;

  const channel = supabase.channel(`office-terminal-cmd-${circleId}`, {
    config: { broadcast: { self: true } },
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      resolve(); // Resolve anyway — channel may still work for broadcast
    }, 5000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  sendOnlyCommandChannels.set(circleId, channel);
  return channel;
}

// ─── Cleanup all channels for a circle ───────────────────────────────────────

export function cleanupTerminalChannels(circleId: string): void {
  const cmd = commandChannels.get(circleId);
  if (cmd) { cmd.unsubscribe(); commandChannels.delete(circleId); }

  const send = sendOnlyCommandChannels.get(circleId);
  if (send) { supabase.removeChannel(send); sendOnlyCommandChannels.delete(circleId); }

  const resp = responseChannels.get(circleId);
  if (resp) { resp.unsubscribe(); responseChannels.delete(circleId); }
}
