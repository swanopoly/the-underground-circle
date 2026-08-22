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

import { getSupabaseClientForAccessToken, supabase } from './supabase';
import { subscribeWithReconnect, type ResilientSubscriptionHandle } from './subscribeWithReconnect';
import { RealtimeChannel } from '@supabase/supabase-js';
import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';
import { safeGetUserForAccessToken } from './authSession';

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

/**
 * Immutable account/circle authority captured before a terminal operation
 * yields. `generation` is owned by the mounting surface and retires every
 * in-flight operation when its authenticated subject or token changes.
 */
export interface TerminalExactAuthority {
  readonly userId: string;
  readonly circleId: string;
  readonly accessToken: string;
  readonly generation: number;
}

export type TerminalAuthorityCurrentGuard = (
  authority: TerminalExactAuthority,
) => boolean;

export interface TerminalCommandTargetReceipt {
  readonly targetAgentId: string | null;
  readonly targetAgentIds: readonly string[] | null;
  readonly targetAgentName: string;
  readonly fingerprint: string;
}

/**
 * Proof handed from persistence to the local dispatcher. A direct invocation
 * may proceed only while this exact authority is still current and its target
 * fingerprint still matches the pre-await selection.
 */
export interface TerminalCommandDispatchReceipt {
  readonly messageId: string;
  readonly authority: TerminalExactAuthority;
  readonly target: TerminalCommandTargetReceipt;
}

/**
 * Exact proof returned only after Postgres deleted the sender-owned durable
 * message. Responses are removed by the message FK's ON DELETE CASCADE in the
 * same database statement, so there is no client-side child-delete gap.
 */
export interface TerminalMessageDeleteReceipt {
  readonly messageId: string;
  readonly circleId: string;
  readonly senderId: string;
  readonly authority: TerminalExactAuthority;
}

export interface DeleteTerminalMessageResult {
  readonly receipt?: TerminalMessageDeleteReceipt;
  readonly error?: string;
}

export interface SendTerminalCommandResult {
  messageId?: string;
  error?: string;
  /** Present only when exact persistence completed under still-current authority. */
  receipt?: TerminalCommandDispatchReceipt;
}

export interface AuthorizedTerminalCommand {
  readonly command: BroadcastCommandPayload;
  readonly receipt: TerminalCommandDispatchReceipt;
}

export interface TerminalNativeCommandTarget {
  id: string;
  name: string;
  provider: string;
  connectionId: string | null;
  terminalTargetName: string;
}

export interface BuildTerminalNativeCommandTargetsInput {
  currentUserId: string;
  connections: ReadonlyArray<{
    id: string;
    name: string;
    provider: string;
    enabled: boolean;
    status: string;
  }>;
  officeAgents: ReadonlyArray<{
    id: string;
    ownerId: string;
    name: string;
    provider: string;
  }>;
  openSwanReadyAgentIds?: ReadonlySet<string>;
  virtualDisplayName?: string;
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

/** Normalize and freeze an exact authority snapshot; malformed input fails closed. */
export function normalizeTerminalExactAuthority(
  value: TerminalExactAuthority | null | undefined,
): TerminalExactAuthority | null {
  const userId = String(value?.userId || '').trim();
  const circleId = String(value?.circleId || '').trim();
  const accessToken = String(value?.accessToken || '').trim();
  const generation = Number(value?.generation);
  if (
    !isTerminalUuid(userId)
    || !isTerminalUuid(circleId)
    || !accessToken
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return Object.freeze({ userId, circleId, accessToken, generation });
}

export function terminalExactAuthorityMatches(
  expected: TerminalExactAuthority | null | undefined,
  current: TerminalExactAuthority | null | undefined,
): boolean {
  const normalizedExpected = normalizeTerminalExactAuthority(expected);
  const normalizedCurrent = normalizeTerminalExactAuthority(current);
  return Boolean(
    normalizedExpected
    && normalizedCurrent
    && normalizedExpected.userId === normalizedCurrent.userId
    && normalizedExpected.circleId === normalizedCurrent.circleId
    && normalizedExpected.accessToken === normalizedCurrent.accessToken
    && normalizedExpected.generation === normalizedCurrent.generation,
  );
}

function terminalAuthorityGuardPasses(
  authority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
): boolean {
  try {
    return isCurrent(authority) === true;
  } catch {
    return false;
  }
}

export interface TerminalAuthorityOperationFence {
  readonly authority: TerminalExactAuthority;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly stop: () => void;
}

/**
 * Abort an abort-aware request as soon as its captured Office generation is
 * retired. Callers must still fence the result after await: an upstream side
 * effect may win the race with a client abort, but its late result must never
 * enter the replacement account's UI.
 */
export function createTerminalAuthorityOperationFence(
  capturedAuthority: TerminalExactAuthority | null | undefined,
  isCurrent: TerminalAuthorityCurrentGuard,
  pollIntervalMs = 25,
): TerminalAuthorityOperationFence | null {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  if (!authority || !terminalAuthorityGuardPasses(authority, isCurrent)) return null;

  const controller = new AbortController();
  let stopped = false;
  const requestIsCurrent = () => (
    !stopped
    && !controller.signal.aborted
    && terminalAuthorityGuardPasses(authority, isCurrent)
  );
  const retireIfStale = () => {
    if (!stopped && !terminalAuthorityGuardPasses(authority, isCurrent)) {
      controller.abort();
    }
  };
  const timer = setInterval(retireIfStale, Math.max(10, pollIntervalMs));
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };

  return Object.freeze({ authority, signal: controller.signal, isCurrent: requestIsCurrent, stop });
}

export function buildTerminalCommandTargetReceipt(input: {
  targetAgentId: string | null;
  targetAgentIds: readonly string[] | null;
  targetAgentName: string;
}): TerminalCommandTargetReceipt {
  const safeTargets = sanitizeTerminalTargetIds(input.targetAgentId, input.targetAgentIds);
  const targetAgentName = persistableTerminalTargetName(
    input.targetAgentName,
    safeTargets.includesBlackSwan,
  );
  const targetAgentIds = safeTargets.targetAgentIds
    ? Object.freeze([...safeTargets.targetAgentIds])
    : null;
  const fingerprint = `terminal-target-v1:${JSON.stringify([
    safeTargets.targetAgentId,
    targetAgentIds,
    targetAgentName,
  ])}`;
  return Object.freeze({
    targetAgentId: safeTargets.targetAgentId,
    targetAgentIds,
    targetAgentName,
    fingerprint,
  });
}

function buildTerminalCommandDispatchReceipt(input: {
  messageId: string;
  authority: TerminalExactAuthority;
  target: TerminalCommandTargetReceipt;
}): TerminalCommandDispatchReceipt | null {
  const authority = normalizeTerminalExactAuthority(input.authority);
  if (!isTerminalUuid(input.messageId) || !authority) return null;
  const target = buildTerminalCommandTargetReceipt(input.target);
  if (target.fingerprint !== input.target.fingerprint) return null;
  return Object.freeze({ messageId: input.messageId, authority, target });
}

/** Final synchronous gate for a local direct dispatcher. */
export function isTerminalCommandDispatchReceiptCurrent(input: {
  receipt: TerminalCommandDispatchReceipt | null | undefined;
  expectedAuthority: TerminalExactAuthority | null | undefined;
  expectedTargetFingerprint: string;
  isCurrent: TerminalAuthorityCurrentGuard;
}): boolean {
  const receiptAuthority = normalizeTerminalExactAuthority(input.receipt?.authority);
  const expectedAuthority = normalizeTerminalExactAuthority(input.expectedAuthority);
  if (
    !input.receipt
    || !isTerminalUuid(input.receipt.messageId)
    || !receiptAuthority
    || !expectedAuthority
    || !terminalExactAuthorityMatches(receiptAuthority, expectedAuthority)
    || input.receipt.target.fingerprint !== input.expectedTargetFingerprint
  ) return false;
  const rebuiltTarget = buildTerminalCommandTargetReceipt(input.receipt.target);
  return rebuiltTarget.fingerprint === input.receipt.target.fingerprint
    && terminalAuthorityGuardPasses(receiptAuthority, input.isCurrent);
}

/** Final synchronous gate before a verified durable delete changes local UI. */
export function isTerminalMessageDeleteReceiptCurrent(input: {
  receipt: TerminalMessageDeleteReceipt | null | undefined;
  expectedAuthority: TerminalExactAuthority | null | undefined;
  expectedMessageId: string;
  isCurrent: TerminalAuthorityCurrentGuard;
}): boolean {
  const receiptAuthority = normalizeTerminalExactAuthority(input.receipt?.authority);
  const expectedAuthority = normalizeTerminalExactAuthority(input.expectedAuthority);
  return Boolean(
    input.receipt
    && isTerminalUuid(input.expectedMessageId)
    && input.receipt.messageId === input.expectedMessageId
    && receiptAuthority
    && expectedAuthority
    && terminalExactAuthorityMatches(receiptAuthority, expectedAuthority)
    && input.receipt.circleId === expectedAuthority.circleId
    && input.receipt.senderId === expectedAuthority.userId
    && terminalAuthorityGuardPasses(receiptAuthority, input.isCurrent)
  );
}

/**
 * Convert presentation/runtime connection data into identities the durable
 * Office terminal can actually persist and claim. Name/provider matching is
 * exact and only selects one owner row; ambiguity always omits the target.
 */
export function buildTerminalNativeCommandTargets(
  input: BuildTerminalNativeCommandTargetsInput,
): TerminalNativeCommandTarget[] {
  const targets: TerminalNativeCommandTarget[] = [{
    id: BLACKSWAN_VIRTUAL_AGENT_ID,
    name: input.virtualDisplayName?.trim() || 'OpenSwan',
    provider: 'blackswan',
    connectionId: null,
    terminalTargetName: '@BlackSwan',
  }];
  if (!input.currentUserId) return targets;

  const activeConnections = input.connections.filter(connection => (
    connection.enabled && connection.status === 'connected'
  ));
  const connectionCountsByPublishIdentity = new Map<string, number>();
  const connectionCountsById = new Map<string, number>();
  for (const connection of activeConnections) {
    const key = JSON.stringify([connection.name, connection.provider]);
    connectionCountsByPublishIdentity.set(
      key,
      (connectionCountsByPublishIdentity.get(key) || 0) + 1,
    );
    connectionCountsById.set(
      connection.id,
      (connectionCountsById.get(connection.id) || 0) + 1,
    );
  }
  const seenTargetIds = new Set<string>([BLACKSWAN_VIRTUAL_AGENT_ID]);
  for (const connection of activeConnections) {
    const connectionIdentity = JSON.stringify([connection.name, connection.provider]);
    // A publish identity must bind in both directions: one live connection to
    // one durable row. Choosing the first duplicate would make the picker and
    // dispatcher disagree about which endpoint owns the command.
    if (
      connectionCountsByPublishIdentity.get(connectionIdentity) !== 1
      || connectionCountsById.get(connection.id) !== 1
    ) continue;
    const matches = input.officeAgents.filter(agent => (
      agent.ownerId === input.currentUserId
      && isTerminalUuid(agent.id)
      && agent.name === connection.name
      && agent.provider === connection.provider
    ));
    if (matches.length !== 1) continue;
    const agent = matches[0];
    if (
      seenTargetIds.has(agent.id)
      || (agent.provider === 'openswan' && !input.openSwanReadyAgentIds?.has(agent.id))
    ) continue;
    seenTargetIds.add(agent.id);
    targets.push({
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      connectionId: connection.id,
      terminalTargetName: `@${agent.name}`,
    });
  }
  return targets;
}

export type TerminalTargetSelection = {
  ok: true;
  targetAgentId: string | null;
  targetAgentIds: string[] | null;
  targetAgentName: string;
} | {
  ok: false;
  error: string;
};

/**
 * Resolve the terminal's one canonical selected-id state into the legacy DB
 * columns at the final persistence boundary. Unknown/stale ids fail closed;
 * they are never silently removed or replaced with @all.
 */
export function resolveTerminalTargetSelection(
  selectedIds: readonly string[] | null,
  availableTargets: ReadonlyArray<{ id: string; name: string }>,
): TerminalTargetSelection {
  if (!selectedIds || selectedIds.length === 0) {
    return {
      ok: true,
      targetAgentId: null,
      targetAgentIds: null,
      targetAgentName: '@all',
    };
  }
  const uniqueIds = Array.from(new Set(selectedIds));
  const byId = new Map(availableTargets.map(target => [target.id, target]));
  const resolved = uniqueIds.map(id => byId.get(id));
  if (resolved.some(target => !target)) {
    return {
      ok: false,
      error: 'A selected agent is no longer connected. Choose an available target and try again.',
    };
  }
  if (uniqueIds.length === 1) {
    const target = resolved[0]!;
    return {
      ok: true,
      targetAgentId: target.id,
      targetAgentIds: [target.id],
      targetAgentName: target.id === BLACKSWAN_VIRTUAL_AGENT_ID
        ? '@BlackSwan'
        : `@${target.name}`,
    };
  }
  return {
    ok: true,
    targetAgentId: null,
    targetAgentIds: uniqueIds,
    targetAgentName: `${uniqueIds.length} agents`,
  };
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

/**
 * Exact-authority variant used by authenticated Office runtimes. It never
 * reacquires the mutable browser session: both token verification and the row
 * read are bound to the captured bearer, with current-generation checks around
 * every await.
 */
export async function loadAuthorizedTerminalCommandFromWakeupExact(
  expectedCircleId: string,
  payload: unknown,
  capturedAuthority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
  client: TerminalAuthorityClient = supabase,
): Promise<AuthorizedTerminalCommand | null> {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  const expected = parseTerminalCommandWakeup(expectedCircleId, payload);
  if (
    !authority
    || !expected
    || authority.circleId !== expected.circleId
    || !terminalAuthorityGuardPasses(authority, isCurrent)
  ) return null;

  try {
    const { data: authData, error: authError } = await client.auth.getUser(authority.accessToken);
    if (
      authError
      || authData.user?.id !== authority.userId
      || !terminalAuthorityGuardPasses(authority, isCurrent)
    ) return null;

    const { data, error } = await client
      .from('office_terminal_messages')
      .select(
        'id,circle_id,sender_id,sender_name,target_agent_id,target_agent_name,target_agent_ids,model,command_text,status,created_at',
      )
      .eq('id', expected.messageId)
      .eq('circle_id', authority.circleId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .maybeSingle();
    if (error || !data || !terminalAuthorityGuardPasses(authority, isCurrent)) return null;

    const reconstructed = reconstructExecutableTerminalCommand(expected, data);
    if (!reconstructed) return null;
    const target = buildTerminalCommandTargetReceipt({
      targetAgentId: reconstructed.targetAgentId,
      targetAgentIds: reconstructed.targetAgentIds,
      targetAgentName: reconstructed.targetAgentName,
    });
    const receipt = buildTerminalCommandDispatchReceipt({
      messageId: reconstructed.messageId,
      authority,
      target,
    });
    if (!receipt || !terminalAuthorityGuardPasses(authority, isCurrent)) return null;
    const command = Object.freeze({
      ...reconstructed,
      targetAgentIds: reconstructed.targetAgentIds
        ? Object.freeze([...reconstructed.targetAgentIds])
        : null,
    }) as BroadcastCommandPayload;
    return Object.freeze({ command, receipt });
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
// Authenticated Office mounts never share the compatibility caches above.
// Even though Circle history is shared among members, an RLS result belongs to
// the exact user/circle/generation that fetched it and cannot be reused by a
// second account on the same browser profile.
const terminalExactHistoryCache = new Map<string, { at: number; messages: TerminalMessage[] }>();
const terminalExactHistoryInflight = new Map<string, Promise<{ messages: TerminalMessage[]; error?: string }>>();
const terminalExactResponsesCache = new Map<string, { at: number; responses: TerminalResponse[] }>();
const terminalExactResponsesInflight = new Map<string, Promise<{ responses: TerminalResponse[]; error?: string }>>();

// ─── Send a command ───────────────────────────────────────────────────────────

export async function sendTerminalCommand(
  params: SendCommandParams
): Promise<SendTerminalCommandResult> {
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
  try {
    const channel = await getOrCreateCommandChannel(circleId);
    const wakeupStatus = await channel.send({
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
    if (wakeupStatus !== 'ok') {
      return {
        messageId,
        error: 'Command saved, but the real-time delivery wake-up could not be confirmed.',
      };
    }
  } catch {
    // Persistence is authoritative. Return its id so the local sender can use
    // the direct invocation seam without replaying and duplicating the row.
    return {
      messageId,
      error: 'Command saved, but the real-time delivery wake-up could not be confirmed.',
    };
  }

  return { messageId };
}

function terminalTargetIdsMatch(
  left: unknown,
  right: readonly string[] | null,
): boolean {
  if (left === null || left === undefined) return right === null;
  if (!Array.isArray(left) || right === null || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function exactPersistenceReceiptMatches(input: {
  row: unknown;
  authority: TerminalExactAuthority;
  target: TerminalCommandTargetReceipt;
}): boolean {
  const row = asTerminalRow(input.row);
  return Boolean(
    row
    && isTerminalUuid(row.id)
    && row.circle_id === input.authority.circleId
    && row.sender_id === input.authority.userId
    && row.status === 'pending'
    && (row.target_agent_id ?? null) === input.target.targetAgentId
    && row.target_agent_name === input.target.targetAgentName
    && terminalTargetIdsMatch(row.target_agent_ids, input.target.targetAgentIds),
  );
}

type TerminalCommandWakeupChannel = Pick<RealtimeChannel, 'send'>;

/**
 * Persist one Office command under an immutable bearer snapshot. Unlike the
 * compatibility sender above, this path verifies that the bearer subject is
 * the declared sender, applies that bearer directly to the insert, validates
 * the returned row, and withholds dispatch authority after any generation
 * change.
 */
export async function sendTerminalCommandExact(
  params: SendCommandParams,
  capturedAuthority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
  client: TerminalAuthorityClient = supabase,
  getCommandChannel: (circleId: string) => Promise<TerminalCommandWakeupChannel> = getOrCreateCommandChannel,
): Promise<SendTerminalCommandResult> {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  if (
    !authority
    || params.circleId !== authority.circleId
    || params.senderId !== authority.userId
    || !String(params.commandText || '').trim()
    || !terminalAuthorityGuardPasses(authority, isCurrent)
  ) {
    return { error: 'The terminal session changed before this command could be authorized.' };
  }

  const target = buildTerminalCommandTargetReceipt({
    targetAgentId: params.targetAgentId ?? null,
    targetAgentIds: params.targetAgentIds ?? null,
    targetAgentName: params.targetAgentName || '@all',
  });

  try {
    const { data: authData, error: authError } = await client.auth.getUser(authority.accessToken);
    if (
      authError
      || authData.user?.id !== authority.userId
      || !terminalAuthorityGuardPasses(authority, isCurrent)
    ) {
      return { error: 'The terminal session could not verify the command sender.' };
    }

    const { data, error } = await client
      .from('office_terminal_messages')
      .insert({
        circle_id: authority.circleId,
        sender_id: authority.userId,
        sender_name: params.senderName,
        target_agent_id: target.targetAgentId,
        target_agent_name: target.targetAgentName,
        target_agent_ids: target.targetAgentIds ? [...target.targetAgentIds] : null,
        model: params.model ?? null,
        command_text: params.commandText,
        status: 'pending',
      })
      .select('id,circle_id,sender_id,target_agent_id,target_agent_name,target_agent_ids,status')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .single();

    const row = asTerminalRow(data);
    const messageId = isTerminalUuid(row?.id) ? row.id : undefined;
    if (error) return { error: error.message };
    if (!messageId || !exactPersistenceReceiptMatches({ row, authority, target })) {
      return {
        messageId,
        error: 'Terminal command persistence did not return the exact sender and target receipt.',
      };
    }
    if (!terminalAuthorityGuardPasses(authority, isCurrent)) {
      return {
        messageId,
        error: 'Command saved, but local dispatch was cancelled because the terminal session changed.',
      };
    }

    const receipt = buildTerminalCommandDispatchReceipt({
      messageId,
      authority,
      target,
    });
    if (!receipt) {
      return { messageId, error: 'Terminal command receipt could not be verified.' };
    }

    let wakeupError: string | undefined;
    try {
      const channel = await getCommandChannel(authority.circleId);
      if (!terminalAuthorityGuardPasses(authority, isCurrent)) {
        return {
          messageId,
          error: 'Command saved, but local dispatch was cancelled because the terminal session changed.',
        };
      }
      const wakeupStatus = await channel.send({
        type: 'broadcast',
        event: 'command',
        payload: {
          messageId,
          circleId: authority.circleId,
          targetAgentId: target.targetAgentId,
          targetAgentIds: target.targetAgentIds ? [...target.targetAgentIds] : null,
          timestamp: new Date().toISOString(),
        } satisfies BroadcastCommandWakeupPayload,
      });
      if (wakeupStatus !== 'ok') {
        wakeupError = 'Command saved, but the real-time delivery wake-up could not be confirmed.';
      }
    } catch {
      wakeupError = 'Command saved, but the real-time delivery wake-up could not be confirmed.';
    }

    if (!terminalAuthorityGuardPasses(authority, isCurrent)) {
      return {
        messageId,
        error: 'Command saved, but local dispatch was cancelled because the terminal session changed.',
      };
    }
    return Object.freeze({ messageId, receipt, ...(wakeupError ? { error: wakeupError } : {}) });
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Terminal command could not be saved.',
    };
  }
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
    channelConfig: { config: { private: true, broadcast: { self: true } } },
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

/**
 * Account-bound command listener for Office. Its durable row reload uses the
 * captured bearer and every async continuation checks the caller's generation
 * guard before the command or receipt reaches an agent dispatcher.
 */
export function subscribeToTerminalCommandsExact(
  capturedAuthority: TerminalExactAuthority,
  myAgentIds: string[],
  isCurrent: TerminalAuthorityCurrentGuard,
  onCommand: (authorized: AuthorizedTerminalCommand) => void | Promise<void>,
  loadAuthorized: typeof loadAuthorizedTerminalCommandFromWakeupExact = loadAuthorizedTerminalCommandFromWakeupExact,
): () => void {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  const listenerIds = new Set(
    myAgentIds.filter((id) => isTerminalUuid(id) || id === BLACKSWAN_VIRTUAL_AGENT_ID),
  );
  if (!authority || listenerIds.size === 0 || !terminalAuthorityGuardPasses(authority, isCurrent)) {
    return () => {};
  }

  let retired = false;
  const requestIsCurrent = () => (
    !retired && terminalAuthorityGuardPasses(authority, isCurrent)
  );
  const channelName = `office-terminal-cmd-${authority.circleId}`;
  const authorizedMessageIds = new Set<string>();
  const authorityReadsInFlight = new Set<string>();
  const existing = commandChannels.get(authority.circleId);
  if (existing) existing.unsubscribe();

  const handle = subscribeWithReconnect({
    channelName,
    channelConfig: { config: { private: true, broadcast: { self: true } } },
    setup: (channel) => channel
      .on('broadcast', { event: 'command' }, ({ payload }) => {
        if (!requestIsCurrent()) return;
        const expected = parseTerminalCommandWakeup(authority.circleId, payload);
        if (
          !expected
          || authorizedMessageIds.has(expected.messageId)
          || authorityReadsInFlight.has(expected.messageId)
        ) return;

        authorityReadsInFlight.add(expected.messageId);
        void loadAuthorized(authority.circleId, payload, authority, requestIsCurrent)
          .then(async (authorized) => {
            if (!authorized || !requestIsCurrent()) return;
            if (!isTerminalCommandForListener(authorized.command, listenerIds)) return;
            authorizedMessageIds.add(authorized.command.messageId);
            await onCommand(authorized);
          })
          .catch(() => {
            // Fail closed. Broadcast data and retired authority never dispatch.
          })
          .finally(() => {
            authorityReadsInFlight.delete(expected.messageId);
          });
      }),
  });

  commandChannels.set(authority.circleId, handle);
  return () => {
    retired = true;
    authorityReadsInFlight.clear();
    authorizedMessageIds.clear();
    if (commandChannels.get(authority.circleId) === handle) {
      commandChannels.delete(authority.circleId);
    }
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
    channelConfig: { config: { private: true } },
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

export interface TerminalExactResponsesResult {
  responses: TerminalResponse[];
  error?: string;
}

export interface TerminalExactReadOptions {
  /** Realtime notifications are advisory; bypass a pre-event cache on catch-up. */
  forceRefresh?: boolean;
}

const TERMINAL_MESSAGE_STATUSES = new Set<TerminalMessageStatus>([
  'pending',
  'invoked',
  'streaming',
  'done',
  'error',
  'deleted',
]);
const TERMINAL_RESPONSE_STATUSES = new Set<TerminalResponse['status']>([
  'pending',
  'streaming',
  'done',
  'error',
]);

function terminalBearerCacheFingerprint(accessToken: string): string {
  // This is a cache discriminator, not a credential hash. Keeping the bearer
  // itself out of module-map keys also keeps it out of diagnostic snapshots.
  let hash = 0x811c9dc5;
  for (let index = 0; index < accessToken.length; index += 1) {
    hash ^= accessToken.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${accessToken.length}:${(hash >>> 0).toString(16)}`;
}

function terminalExactReadScopeKey(authority: TerminalExactAuthority): string {
  return [
    authority.userId,
    authority.circleId,
    String(authority.generation),
    terminalBearerCacheFingerprint(authority.accessToken),
  ].join('\u0000');
}

function mapExactTerminalMessageRow(
  value: unknown,
  expectedCircleId: string,
): TerminalMessage | null {
  const row = asTerminalRow(value);
  if (
    !row
    || !isTerminalUuid(row.id)
    || row.circle_id !== expectedCircleId
    || !isTerminalUuid(row.sender_id)
    || typeof row.sender_name !== 'string'
    || !row.sender_name.trim()
    || typeof row.target_agent_name !== 'string'
    || !row.target_agent_name.trim()
    || (row.target_agent_id !== null && row.target_agent_id !== undefined && !isTerminalUuid(row.target_agent_id))
    || (
      row.target_agent_ids !== null
      && row.target_agent_ids !== undefined
      && (!Array.isArray(row.target_agent_ids) || row.target_agent_ids.some(id => !isTerminalUuid(id)))
    )
    || (row.model !== null && row.model !== undefined && typeof row.model !== 'string')
    || typeof row.command_text !== 'string'
    || !TERMINAL_MESSAGE_STATUSES.has(row.status as TerminalMessageStatus)
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) return null;
  return fromRow(row);
}

function mapExactTerminalResponseRow(
  value: unknown,
  expectedCircleId: string,
  expectedMessageIds: ReadonlySet<string>,
): TerminalResponse | null {
  const row = asTerminalRow(value);
  if (
    !row
    || !isTerminalUuid(row.id)
    || row.circle_id !== expectedCircleId
    || !isTerminalUuid(row.message_id)
    || !expectedMessageIds.has(row.message_id)
    || typeof row.agent_name !== 'string'
    || !row.agent_name.trim()
    || typeof row.response_text !== 'string'
    || !TERMINAL_RESPONSE_STATUSES.has(row.status as TerminalResponse['status'])
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
  ) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    agentId: typeof row.agent_id === 'string'
      ? row.agent_id
      : typeof row.agent_subject_key === 'string'
        ? row.agent_subject_key
        : '',
    agentName: row.agent_name,
    responseText: row.response_text,
    status: row.status as TerminalResponse['status'],
    tokenCount: typeof row.token_count === 'number' && Number.isFinite(row.token_count)
      ? row.token_count
      : 0,
    latencyMs: typeof row.latency_ms === 'number' && Number.isFinite(row.latency_ms)
      ? row.latency_ms
      : undefined,
    errorMessage: typeof row.error_message === 'string' ? row.error_message : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Load response content through one captured bearer. No compatibility cache or
 * mutable-session query is consulted, and every row must belong to the exact
 * circle and requested message set before it can enter React state.
 */
export async function loadResponsesForMessagesExact(
  messageIds: string[],
  capturedAuthority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
  client?: TerminalAuthorityClient,
  options: TerminalExactReadOptions = {},
): Promise<TerminalExactResponsesResult> {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  const exactMessageIds = Array.from(new Set(messageIds));
  if (
    !authority
    || exactMessageIds.some(messageId => !isTerminalUuid(messageId))
    || !terminalAuthorityGuardPasses(authority, isCurrent)
  ) {
    return { responses: [], error: 'The terminal session changed before responses could be loaded.' };
  }
  if (exactMessageIds.length === 0) return { responses: [] };

  const cacheKey = `${terminalExactReadScopeKey(authority)}\u0000${[...exactMessageIds].sort().join(',')}`;
  if (!options.forceRefresh) {
    const cached = terminalExactResponsesCache.get(cacheKey);
    if (
      cached
      && Date.now() - cached.at < TERMINAL_RESPONSES_CACHE_TTL_MS
      && terminalAuthorityGuardPasses(authority, isCurrent)
    ) return { responses: cached.responses };
    const inflight = terminalExactResponsesInflight.get(cacheKey);
    if (inflight) {
      const result = await inflight;
      return terminalAuthorityGuardPasses(authority, isCurrent)
        ? result
        : { responses: [], error: 'The terminal session changed before responses could be loaded.' };
    }
  }

  const run = (async (): Promise<TerminalExactResponsesResult> => {
    const fence = createTerminalAuthorityOperationFence(authority, isCurrent);
    if (!fence) {
      return { responses: [], error: 'The terminal session changed before responses could be loaded.' };
    }
    try {
      const exactClient = client || getSupabaseClientForAccessToken(authority.accessToken);
      const { data: authData, error: authError } = await exactClient.auth.getUser(authority.accessToken);
      if (authError || authData.user?.id !== authority.userId || !fence.isCurrent()) {
        return { responses: [], error: 'The terminal session could not verify response access.' };
      }
      const { data, error } = await exactClient
        .from('office_terminal_responses')
        .select('*')
        .eq('circle_id', authority.circleId)
        .in('message_id', exactMessageIds)
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .abortSignal(fence.signal);
      if (error) return { responses: [], error: error.message };
      if (!fence.isCurrent()) {
        return { responses: [], error: 'The terminal session changed before responses could be loaded.' };
      }
      const expectedMessageIds = new Set(exactMessageIds);
      const responses: TerminalResponse[] = [];
      for (const row of (data as unknown[]) || []) {
        const response = mapExactTerminalResponseRow(row, authority.circleId, expectedMessageIds);
        if (!response) {
          return { responses: [], error: 'Terminal responses returned outside the exact requested scope.' };
        }
        responses.push(response);
      }
      if (!fence.isCurrent()) {
        return { responses: [], error: 'The terminal session changed before responses could be loaded.' };
      }
      terminalExactResponsesCache.set(cacheKey, { at: Date.now(), responses });
      return { responses };
    } catch (error) {
      return {
        responses: [],
        error: error instanceof Error ? error.message : 'Terminal responses could not be loaded.',
      };
    } finally {
      fence.stop();
    }
  })();
  if (!options.forceRefresh) terminalExactResponsesInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    if (!options.forceRefresh && terminalExactResponsesInflight.get(cacheKey) === run) {
      terminalExactResponsesInflight.delete(cacheKey);
    }
  }
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

      if (error) {
        throw new Error(error.message || 'Terminal responses could not be loaded.');
      }
      if (!data) return [];

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

/**
 * Exact-authority Office transcript read. The result cache is partitioned by
 * user, circle, bearer discriminator, and lifecycle generation; it never reads
 * or falls back to the legacy circle-only cache above.
 */
export async function loadTerminalHistoryExact(
  capturedAuthority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
  limit = 50,
  client?: TerminalAuthorityClient,
  options: TerminalExactReadOptions = {},
): Promise<{ messages: TerminalMessage[]; error?: string }> {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 && limit <= 100
    ? limit
    : 50;
  if (!authority || !terminalAuthorityGuardPasses(authority, isCurrent)) {
    return { messages: [], error: 'The terminal session changed before history could be loaded.' };
  }
  const cacheKey = `${terminalExactReadScopeKey(authority)}\u0000${safeLimit}`;
  if (!options.forceRefresh) {
    const cached = terminalExactHistoryCache.get(cacheKey);
    if (
      cached
      && Date.now() - cached.at < TERMINAL_HISTORY_CACHE_TTL_MS
      && terminalAuthorityGuardPasses(authority, isCurrent)
    ) return { messages: cached.messages };
    const inflight = terminalExactHistoryInflight.get(cacheKey);
    if (inflight) {
      const result = await inflight;
      return terminalAuthorityGuardPasses(authority, isCurrent)
        ? result
        : { messages: [], error: 'The terminal session changed before history could be loaded.' };
    }
  }

  const run = (async (): Promise<{ messages: TerminalMessage[]; error?: string }> => {
    const fence = createTerminalAuthorityOperationFence(authority, isCurrent);
    if (!fence) {
      return { messages: [], error: 'The terminal session changed before history could be loaded.' };
    }
    try {
      const exactClient = client || getSupabaseClientForAccessToken(authority.accessToken);
      const { data: authData, error: authError } = await exactClient.auth.getUser(authority.accessToken);
      if (authError || authData.user?.id !== authority.userId || !fence.isCurrent()) {
        return { messages: [], error: 'The terminal session could not verify history access.' };
      }
      const { data, error } = await exactClient
        .from('office_terminal_messages')
        .select('*')
        .eq('circle_id', authority.circleId)
        .order('created_at', { ascending: false })
        .limit(safeLimit)
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .abortSignal(fence.signal);
      if (error) return { messages: [], error: error.message };
      if (!fence.isCurrent()) {
        return { messages: [], error: 'The terminal session changed before history could be loaded.' };
      }
      const messages: TerminalMessage[] = [];
      for (const row of (data as unknown[]) || []) {
        const message = mapExactTerminalMessageRow(row, authority.circleId);
        if (!message) {
          return { messages: [], error: 'Terminal history returned outside the exact requested scope.' };
        }
        messages.push(message);
      }
      messages.reverse();
      if (!fence.isCurrent()) {
        return { messages: [], error: 'The terminal session changed before history could be loaded.' };
      }
      terminalExactHistoryCache.set(cacheKey, { at: Date.now(), messages });
      return { messages };
    } catch (error) {
      return {
        messages: [],
        error: error instanceof Error ? error.message : 'Terminal history could not be loaded.',
      };
    } finally {
      fence.stop();
    }
  })();
  if (!options.forceRefresh) terminalExactHistoryInflight.set(cacheKey, run);
  try {
    return await run;
  } finally {
    if (!options.forceRefresh && terminalExactHistoryInflight.get(cacheKey) === run) {
      terminalExactHistoryInflight.delete(cacheKey);
    }
  }
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
  /** Namespace only. Exact mounts still treat every event as an advisory and
   *  re-read through their captured bearer before rendering content. */
  subscriptionScope?: string,
): () => void {
  const safeSubscriptionScope = String(subscriptionScope || 'compat')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 180);
  const handle = subscribeWithReconnect({
    channelName: `terminal-db-${circleId}-${safeSubscriptionScope}`,
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

/**
 * Delete one sender-owned Office message under a captured bearer. The parent
 * delete is the only mutation: `office_terminal_responses.message_id` already
 * has `ON DELETE CASCADE`, which keeps child removal atomic and avoids the old
 * client-side two-statement partial-delete failure.
 */
export async function deleteTerminalMessageExact(
  messageId: string,
  capturedAuthority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
  client: TerminalAuthorityClient = supabase,
): Promise<DeleteTerminalMessageResult> {
  const authority = normalizeTerminalExactAuthority(capturedAuthority);
  if (
    !isTerminalUuid(messageId)
    || !authority
    || !terminalAuthorityGuardPasses(authority, isCurrent)
  ) {
    return { error: 'The terminal session changed before this message could be deleted.' };
  }

  const fence = createTerminalAuthorityOperationFence(authority, isCurrent);
  if (!fence) {
    return { error: 'The terminal session changed before this message could be deleted.' };
  }

  try {
    const { data: authData, error: authError } = await client.auth.getUser(authority.accessToken);
    if (
      authError
      || authData.user?.id !== authority.userId
      || !fence.isCurrent()
    ) {
      return { error: 'The terminal session could not verify the message sender.' };
    }

    const { data, error } = await client
      .from('office_terminal_messages')
      .delete()
      .eq('id', messageId)
      .eq('circle_id', authority.circleId)
      .eq('sender_id', authority.userId)
      .select('id,circle_id,sender_id')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .abortSignal(fence.signal)
      .maybeSingle();

    if (error) return { error: error.message };
    const row = asTerminalRow(data);
    if (
      !row
      || row.id !== messageId
      || row.circle_id !== authority.circleId
      || row.sender_id !== authority.userId
      || !fence.isCurrent()
    ) {
      return {
        error: fence.isCurrent()
          ? 'No sender-owned terminal message matched this delete request.'
          : 'The message delete completed after the terminal session changed; refresh to reconcile its status.',
      };
    }

    // Prevent a short-lived cached transcript from resurrecting the row after
    // the verified deletion. Component state still changes only after receipt.
    for (const [cacheKey, cached] of terminalHistoryCache) {
      if (!cacheKey.startsWith(`${authority.circleId}:`)) continue;
      terminalHistoryCache.set(cacheKey, {
        at: cached.at,
        messages: cached.messages.filter(message => message.id !== messageId),
      });
    }
    for (const [cacheKey, cached] of terminalResponsesCache) {
      if (!cached.responses.some(response => response.messageId === messageId)) continue;
      terminalResponsesCache.set(cacheKey, {
        at: cached.at,
        responses: cached.responses.filter(response => response.messageId !== messageId),
      });
    }
    for (const [cacheKey, cached] of terminalExactHistoryCache) {
      if (!cacheKey.includes(`\u0000${authority.circleId}\u0000`)) continue;
      terminalExactHistoryCache.set(cacheKey, {
        at: cached.at,
        messages: cached.messages.filter(message => message.id !== messageId),
      });
    }
    for (const [cacheKey, cached] of terminalExactResponsesCache) {
      if (!cacheKey.includes(`\u0000${authority.circleId}\u0000`)) continue;
      terminalExactResponsesCache.set(cacheKey, {
        at: cached.at,
        responses: cached.responses.filter(response => response.messageId !== messageId),
      });
    }

    const receipt = Object.freeze({
      messageId,
      circleId: authority.circleId,
      senderId: authority.userId,
      authority,
    });
    return { receipt };
  } catch (error) {
    return {
      error: error instanceof Error
        ? error.message
        : 'The sender-owned terminal message could not be deleted.',
    };
  } finally {
    fence.stop();
  }
}

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
// The v1 profile RPC owns a private, per-user/session lifetime ledger even
// when the agent is not published to the Circle Office. The older RPC remains
// a rollout-only compatibility path for published-agent daily aggregates.

let _tokenSnapshotSyncDisabled = false;
let _tokenSnapshotSyncWarningShown = false;
let _profileUsageSyncRpcUnavailable = false;
let _profileUsageSyncWarningShown = false;
const _overflowDisabledTokenSnapshotIds = new Set<string>();
const _invalidTokenSnapshotWarnings = new Set<string>();

const POSTGRES_INTEGER_MAX = 2_147_483_647;
// circle_office_agent_usage_snapshots.estimated_cost and the Office aggregate
// columns are numeric(12,6). Values above this cannot be represented without
// rounding into a 13th digit.
const OFFICE_TOKEN_SNAPSHOT_COST_MAX = 999_999.999_999;
const TOKEN_SNAPSHOT_DIAGNOSTIC_VALUE_MAX = 64;
const OFFICE_AGENT_USAGE_PROFILE_LIMIT = 5_000;
const OFFICE_USAGE_TEXT_MAX = 200;

type TokenSnapshotUsageValidation = {
  valid: true;
} | {
  valid: false;
  field: 'inputTokens' | 'outputTokens' | 'cachedTokens' | 'messageCount' | 'estimatedCost';
  reason: string;
};

export function normalizeTokenSnapshotKey(agentName: string, snapshotKey?: string): string {
  const explicitKey = snapshotKey?.trim();
  return explicitKey || agentName.toLowerCase();
}

export interface OfficeAgentUsageProfile {
  readonly sessionKey: string;
  readonly agentName: string;
  readonly providerType: string;
  readonly modelName: string | null;
  readonly lifetimeTokens: number;
  readonly lifetimeInputTokens: number;
  readonly lifetimeOutputTokens: number;
  readonly lifetimeCachedTokens: number;
  readonly lifetimeMessages: number;
  readonly lifetimeCost: number;
  readonly sessionCount: number;
  readonly lastObservedAt: string;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly updatedAt: string;
}

export interface SyncAgentTokenSnapshotInput {
  readonly authority: TerminalExactAuthority;
  readonly isCurrent: TerminalAuthorityCurrentGuard;
  readonly agentName: string;
  readonly providerType: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly messageCount: number;
  readonly estimatedCost: number;
  readonly model?: string;
  readonly snapshotKey: string;
  /** Exact bridge/session observation timestamp used to reject delayed lower
   *  meters before they can masquerade as a fresh counter reset. */
  readonly observedAt: string;
}

export type SyncAgentTokenSnapshotResult =
  | Readonly<{
      ok: true;
      profile: OfficeAgentUsageProfile;
      officeAgentUpdated: boolean;
      observationDisposition: 'applied' | 'unchanged' | 'stale';
    }>
  | Readonly<{
      ok: false;
      error: 'invalid_snapshot' | 'authority_mismatch' | 'authority_retired' | 'profile_rpc_unavailable' | 'server_unavailable';
      legacySaved?: boolean;
    }>;

function isBoundedOfficeUsageText(value: unknown, allowEmpty = false): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return (allowEmpty || normalized.length > 0)
    && normalized.length <= OFFICE_USAGE_TEXT_MAX
    && !/[\u0000-\u001f\u007f]/u.test(normalized);
}

function readOfficeUsageSafeInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readOfficeUsageCost(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseOfficeAgentUsageProfileRow(
  value: unknown,
  expectedUserId?: string,
): OfficeAgentUsageProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const userId = typeof row.owner_id === 'string' ? row.owner_id : '';
  const sessionKey = typeof row.session_key === 'string' ? row.session_key : '';
  const agentName = typeof row.agent_name === 'string' ? row.agent_name : '';
  const providerType = typeof row.provider_type === 'string' ? row.provider_type : '';
  const modelName = row.model_name === null || row.model_name === undefined
    ? null
    : typeof row.model_name === 'string' && isBoundedOfficeUsageText(row.model_name)
      ? row.model_name.trim()
      : undefined;
  const lifetimeTokens = readOfficeUsageSafeInteger(row.lifetime_tokens);
  const lifetimeInputTokens = readOfficeUsageSafeInteger(row.lifetime_input_tokens);
  const lifetimeOutputTokens = readOfficeUsageSafeInteger(row.lifetime_output_tokens);
  const lifetimeCachedTokens = readOfficeUsageSafeInteger(row.lifetime_cached_tokens);
  const lifetimeMessages = readOfficeUsageSafeInteger(row.lifetime_messages);
  const lifetimeCost = readOfficeUsageCost(row.lifetime_cost);
  const sessionCount = readOfficeUsageSafeInteger(row.session_count);
  const lastObservedAt = typeof row.last_observed_at === 'string' ? row.last_observed_at : '';
  const firstSeenAt = typeof row.first_seen_at === 'string' ? row.first_seen_at : '';
  const lastSeenAt = typeof row.last_seen_at === 'string' ? row.last_seen_at : '';
  const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
  if (
    (expectedUserId && userId !== expectedUserId)
    || !isBoundedOfficeUsageText(sessionKey)
    || !isBoundedOfficeUsageText(agentName)
    || !isBoundedOfficeUsageText(providerType)
    || modelName === undefined
    || lifetimeTokens === null
    || lifetimeInputTokens === null
    || lifetimeOutputTokens === null
    || lifetimeCachedTokens === null
    || lifetimeMessages === null
    || lifetimeCost === null
    || sessionCount === null
    || sessionCount < 1
    || !Number.isFinite(Date.parse(lastObservedAt))
    || !Number.isFinite(Date.parse(firstSeenAt))
    || !Number.isFinite(Date.parse(lastSeenAt))
    || !Number.isFinite(Date.parse(updatedAt))
  ) return null;
  return Object.freeze({
    sessionKey: sessionKey.trim(),
    agentName: agentName.trim(),
    providerType: providerType.trim(),
    modelName,
    lifetimeTokens,
    lifetimeInputTokens,
    lifetimeOutputTokens,
    lifetimeCachedTokens,
    lifetimeMessages,
    lifetimeCost,
    sessionCount,
    lastObservedAt,
    firstSeenAt,
    lastSeenAt,
    updatedAt,
  });
}

function parseOfficeAgentUsageSyncReceipt(
  value: unknown,
  authority: TerminalExactAuthority,
  expectedSessionKey: string,
): {
  profile: OfficeAgentUsageProfile;
  officeAgentUpdated: boolean;
  observationDisposition: 'applied' | 'unchanged' | 'stale';
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  const officeAgentRowCount = readOfficeUsageSafeInteger(receipt.officeAgentRowCount);
  const observationDisposition = String(receipt.observationDisposition);
  const expectedProjectionDisposition = officeAgentRowCount === 0
    ? 'not_found'
    : officeAgentRowCount !== null && officeAgentRowCount > 1
      ? 'ambiguous'
      : observationDisposition === 'stale'
        ? 'stale'
        : 'applied';
  if (
    receipt.schemaVersion !== 1
    || receipt.userId !== authority.userId
    || receipt.circleId !== authority.circleId
    || receipt.sessionKey !== expectedSessionKey
    || officeAgentRowCount === null
    || officeAgentRowCount > OFFICE_AGENT_USAGE_PROFILE_LIMIT
    || !['applied', 'unchanged', 'stale'].includes(observationDisposition)
    || receipt.publicProjectionDisposition !== expectedProjectionDisposition
    || typeof receipt.publicProjectionApplied !== 'boolean'
    || receipt.publicProjectionApplied !== (expectedProjectionDisposition === 'applied')
  ) return null;
  const profile = parseOfficeAgentUsageProfileRow(receipt.profile, authority.userId);
  if (!profile || profile.sessionKey !== expectedSessionKey) return null;
  return {
    profile,
    officeAgentUpdated: receipt.publicProjectionApplied,
    observationDisposition: observationDisposition as 'applied' | 'unchanged' | 'stale',
  };
}

export async function loadOfficeAgentUsageProfilesExact(
  capturedAuthority: TerminalExactAuthority,
  isCurrent: TerminalAuthorityCurrentGuard,
): Promise<Readonly<{ ok: true; profiles: Map<string, OfficeAgentUsageProfile> }> | Readonly<{ ok: false; error: string }>> {
  const operation = createTerminalAuthorityOperationFence(capturedAuthority, isCurrent);
  if (!operation) return { ok: false, error: 'The Office usage authority is unavailable.' };
  try {
    const { value: verifiedUser } = await safeGetUserForAccessToken(operation.authority.accessToken);
    if (verifiedUser?.id !== operation.authority.userId || !operation.isCurrent()) {
      return { ok: false, error: 'The Office usage authority changed before the ledger loaded.' };
    }
    const exactClient = getSupabaseClientForAccessToken(operation.authority.accessToken);
    const { data, error, count } = await exactClient
      .from('office_agent_usage_profiles')
      .select('*', { count: 'exact' })
      .eq('owner_id', operation.authority.userId)
      .limit(OFFICE_AGENT_USAGE_PROFILE_LIMIT + 1)
      .abortSignal(operation.signal);
    if (error || !Array.isArray(data) || !operation.isCurrent()) {
      return { ok: false, error: 'The lifetime usage ledger could not be loaded.' };
    }
    if (
      typeof count !== 'number'
      || !Number.isSafeInteger(count)
      || count < 0
      || count > OFFICE_AGENT_USAGE_PROFILE_LIMIT
      || data.length !== count
    ) return { ok: false, error: 'The lifetime usage ledger returned an incomplete snapshot.' };
    const profiles = new Map<string, OfficeAgentUsageProfile>();
    for (const row of data) {
      const profile = parseOfficeAgentUsageProfileRow(row, operation.authority.userId);
      if (!profile || profiles.has(profile.sessionKey)) {
        return { ok: false, error: 'The lifetime usage ledger returned an invalid row.' };
      }
      profiles.set(profile.sessionKey, profile);
    }
    if (!operation.isCurrent()) {
      return { ok: false, error: 'The Office usage authority changed before the ledger loaded.' };
    }
    return { ok: true, profiles };
  } catch {
    return { ok: false, error: 'The lifetime usage ledger could not be loaded.' };
  } finally {
    operation.stop();
  }
}

export function validateTokenSnapshotUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  messageCount: number,
  estimatedCost: number,
): TokenSnapshotUsageValidation {
  const tokenFields = [
    ['inputTokens', inputTokens],
    ['outputTokens', outputTokens],
    ['cachedTokens', cachedTokens],
  ] as const;
  for (const [field, value] of tokenFields) {
    if (!Number.isSafeInteger(value) || value < 0) {
      return {
        valid: false,
        field,
        reason: 'must be a finite, nonnegative safe integer',
      };
    }
  }
  if (inputTokens > Number.MAX_SAFE_INTEGER - outputTokens) {
    return {
      valid: false,
      field: 'outputTokens',
      reason: 'would make the combined token count exceed the safe integer range',
    };
  }
  if (!Number.isSafeInteger(messageCount) || messageCount < 0 || messageCount > POSTGRES_INTEGER_MAX) {
    return {
      valid: false,
      field: 'messageCount',
      reason: `must be a nonnegative PostgreSQL integer no greater than ${POSTGRES_INTEGER_MAX}`,
    };
  }
  if (!Number.isFinite(estimatedCost) || estimatedCost < 0 || estimatedCost > OFFICE_TOKEN_SNAPSHOT_COST_MAX) {
    return {
      valid: false,
      field: 'estimatedCost',
      reason: `must fit PostgreSQL numeric(12,6), from 0 through ${OFFICE_TOKEN_SNAPSHOT_COST_MAX}`,
    };
  }
  return { valid: true };
}

function tokenSnapshotIdentity(
  circleId: string,
  agentName: string,
  normalizedSnapshotKey: string,
): string {
  // The server uniqueness boundary also includes circle and agent. Including
  // both here prevents a bad snapshot key on one agent from muting a healthy
  // agent that happens to reuse the same bridge/session key.
  return JSON.stringify([circleId, agentName.toLowerCase(), normalizedSnapshotKey]);
}

function boundedTokenSnapshotDiagnosticValue(value: string): string {
  const normalized = value.replace(/[\r\n\t]/g, ' ').trim();
  if (normalized.length <= TOKEN_SNAPSHOT_DIAGNOSTIC_VALUE_MAX) return normalized;
  return `${normalized.slice(0, TOKEN_SNAPSHOT_DIAGNOSTIC_VALUE_MAX - 1)}…`;
}

function tokenSnapshotErrorText(error: any): string {
  return [error?.message, error?.details, error?.hint]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function isTokenSnapshotNumericOverflow(error: any): boolean {
  return String(error?.code || '') === '22003'
    || tokenSnapshotErrorText(error).includes('numeric field overflow');
}

function disableOverflowingTokenSnapshotForSession(
  snapshotId: string,
  agentName: string,
  normalizedSnapshotKey: string,
) {
  if (_overflowDisabledTokenSnapshotIds.has(snapshotId)) return;
  _overflowDisabledTokenSnapshotIds.add(snapshotId);
  console.warn(
    '[syncAgentTokenSnapshot] Snapshot disabled for this page session after a database numeric overflow; ' +
    `other agent snapshots will continue. agent="${boundedTokenSnapshotDiagnosticValue(agentName)}" ` +
    `key="${boundedTokenSnapshotDiagnosticValue(normalizedSnapshotKey)}". ` +
    'No usage values were clamped or written.',
  );
}

function warnInvalidTokenSnapshotOnce(
  snapshotId: string,
  agentName: string,
  validation: Exclude<TokenSnapshotUsageValidation, { valid: true }>,
) {
  if (_invalidTokenSnapshotWarnings.has(snapshotId)) return;
  _invalidTokenSnapshotWarnings.add(snapshotId);
  console.warn(
    '[syncAgentTokenSnapshot] Rejected an invalid local snapshot before database sync; ' +
    `agent="${boundedTokenSnapshotDiagnosticValue(agentName)}" ` +
    `field=${validation.field} (${validation.reason}). No usage values were clamped or written.`,
  );
}

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

function isProfileUsageRpcUnavailable(error: any): boolean {
  const code = String(error?.code || '');
  const status = Number(error?.status || 0);
  const message = String(error?.message || error?.details || '').toLowerCase();
  return code === 'PGRST202'
    || code === 'PGRST204'
    || status === 404
    || message.includes('sync_agent_profile_usage_v1')
    || message.includes('schema cache')
    || message.includes('could not find the function');
}

function markProfileUsageRpcUnavailable(error?: any) {
  _profileUsageSyncRpcUnavailable = true;
  if (_profileUsageSyncWarningShown) return;
  _profileUsageSyncWarningShown = true;
  const detail = error?.message ? ` Last error: ${error.message}` : '';
  console.warn(
    '[syncAgentTokenSnapshot] Owner-private lifetime usage RPC unavailable; ' +
    'using the published-agent compatibility ledger until §51 is applied.' +
    detail,
  );
}

function disableTokenSnapshotSyncForSession(error?: any) {
  _tokenSnapshotSyncDisabled = true;
  if (_tokenSnapshotSyncWarningShown) return;
  _tokenSnapshotSyncWarningShown = true;
  const detail = error?.message ? ` Last error: ${error.message}` : '';
  console.warn(
    '[syncAgentTokenSnapshot] RPC unavailable; disabled Office token snapshot sync for this page session. ' +
    'Apply the Office lifetime usage migration and reload to re-enable DB sync.' +
    detail,
  );
}

async function syncLegacyPublishedAgentSnapshot(
  exactClient: ReturnType<typeof getSupabaseClientForAccessToken>,
  authority: TerminalExactAuthority,
  input: SyncAgentTokenSnapshotInput,
  normalizedSnapshotKey: string,
  signal: AbortSignal,
): Promise<{ saved: boolean; error?: any }> {
  const { error } = await exactClient.rpc('sync_agent_token_snapshot', {
    p_circle_id: authority.circleId,
    p_owner_id: authority.userId,
    p_agent_name: input.agentName,
    p_input_tokens: input.inputTokens,
    p_output_tokens: input.outputTokens,
    p_cached_tokens: input.cachedTokens,
    p_message_count: input.messageCount,
    p_estimated_cost: input.estimatedCost,
    p_model: input.model || null,
    p_snapshot_key: normalizedSnapshotKey,
  }).abortSignal(signal);
  return error ? { saved: false, error } : { saved: true };
}

export async function syncAgentTokenSnapshot(
  input: SyncAgentTokenSnapshotInput,
): Promise<SyncAgentTokenSnapshotResult> {
  if (_tokenSnapshotSyncDisabled) return { ok: false, error: 'server_unavailable' };
  const authority = normalizeTerminalExactAuthority(input.authority);
  const normalizedSnapshotKey = normalizeTokenSnapshotKey(input.agentName, input.snapshotKey);
  if (
    !authority
    || authority.circleId !== input.authority.circleId
    || typeof input.isCurrent !== 'function'
    || !isBoundedOfficeUsageText(input.agentName)
    || !isBoundedOfficeUsageText(input.providerType)
    || !isBoundedOfficeUsageText(normalizedSnapshotKey)
    || (input.model !== undefined && !isBoundedOfficeUsageText(input.model))
    || !Number.isFinite(Date.parse(input.observedAt))
  ) return { ok: false, error: 'invalid_snapshot' };
  const snapshotId = tokenSnapshotIdentity(authority.circleId, input.agentName, normalizedSnapshotKey);
  if (_overflowDisabledTokenSnapshotIds.has(snapshotId)) return { ok: false, error: 'invalid_snapshot' };

  const validation = validateTokenSnapshotUsage(
    input.inputTokens,
    input.outputTokens,
    input.cachedTokens,
    input.messageCount,
    input.estimatedCost,
  );
  if (validation.valid === false) {
    warnInvalidTokenSnapshotOnce(snapshotId, input.agentName, validation);
    return { ok: false, error: 'invalid_snapshot' };
  }

  const operation = createTerminalAuthorityOperationFence(authority, input.isCurrent);
  if (!operation) return { ok: false, error: 'authority_retired' };
  try {
    const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
    if (verifiedUser?.id !== authority.userId) return { ok: false, error: 'authority_mismatch' };
    if (!operation.isCurrent()) return { ok: false, error: 'authority_retired' };
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);

    if (!_profileUsageSyncRpcUnavailable) {
      const { data, error } = await exactClient.rpc('sync_agent_profile_usage_v1', {
        p_circle_id: authority.circleId,
        p_agent_name: input.agentName.trim(),
        p_provider_type: input.providerType.trim(),
        p_input_tokens: input.inputTokens,
        p_output_tokens: input.outputTokens,
        p_cached_tokens: input.cachedTokens,
        p_message_count: input.messageCount,
        p_estimated_cost: input.estimatedCost,
        p_model: input.model?.trim() || null,
        p_session_key: normalizedSnapshotKey,
        p_observed_at: input.observedAt,
      }).abortSignal(operation.signal);
      if (!error) {
        if (!operation.isCurrent()) return { ok: false, error: 'authority_retired' };
        const parsed = parseOfficeAgentUsageSyncReceipt(data, authority, normalizedSnapshotKey);
        return parsed
          ? { ok: true, ...parsed }
          : { ok: false, error: 'server_unavailable' };
      }
      if (isTokenSnapshotNumericOverflow(error)) {
        disableOverflowingTokenSnapshotForSession(
          snapshotId,
          input.agentName,
          normalizedSnapshotKey,
        );
        return { ok: false, error: 'invalid_snapshot' };
      }
      if (!isProfileUsageRpcUnavailable(error)) {
        console.warn('[syncAgentTokenSnapshot] Lifetime usage RPC failed:', error.message);
        return { ok: false, error: 'server_unavailable' };
      }
      markProfileUsageRpcUnavailable(error);
    }

    if (!operation.isCurrent()) return { ok: false, error: 'authority_retired' };
    const legacy = await syncLegacyPublishedAgentSnapshot(
      exactClient,
      authority,
      input,
      normalizedSnapshotKey,
      operation.signal,
    );
    if (!operation.isCurrent()) return { ok: false, error: 'authority_retired' };
    if (legacy.saved) return { ok: false, error: 'profile_rpc_unavailable', legacySaved: true };
    if (isTokenSnapshotNumericOverflow(legacy.error)) {
      disableOverflowingTokenSnapshotForSession(snapshotId, input.agentName, normalizedSnapshotKey);
      return { ok: false, error: 'invalid_snapshot' };
    }
    if (shouldDisableTokenSnapshotSync(legacy.error)) {
      disableTokenSnapshotSyncForSession(legacy.error);
      return { ok: false, error: 'profile_rpc_unavailable' };
    }
    console.warn('[syncAgentTokenSnapshot] Compatibility RPC failed:', legacy.error?.message || 'unknown error');
    return { ok: false, error: 'server_unavailable' };
  } catch (err) {
    if (isTokenSnapshotNumericOverflow(err)) {
      disableOverflowingTokenSnapshotForSession(
        snapshotId,
        input.agentName,
        normalizedSnapshotKey,
      );
      return { ok: false, error: 'invalid_snapshot' };
    }
    console.warn('[syncAgentTokenSnapshot] Error:', err);
    return operation.isCurrent()
      ? { ok: false, error: 'server_unavailable' }
      : { ok: false, error: 'authority_retired' };
  } finally {
    operation.stop();
  }
}

// ─── Update agent position ────────────────────────────────────────────────────

export async function updateAgentPosition(
  agentId: string,
  x: number,
  y: number
): Promise<void> {
  if (!agentId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('A valid agent and position are required.');
  }

  const { data, error } = await supabase
    .from('circle_office_agents')
    .update({
      position_x: Math.max(0, Math.min(1, x)),
      position_y: Math.max(0, Math.min(1, y)),
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('The agent position was not updated. Check your circle access and try again.');
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
    config: { private: true, broadcast: { self: true } },
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
