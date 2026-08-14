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
    channelConfig: { config: { broadcast: { self: true } } },
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
// The DB-side RPC tracks the prior snapshot key so bridge restarts cannot
// reset daily/all-time aggregates back to zero.

let _tokenSnapshotSyncDisabled = false;
let _tokenSnapshotSyncWarningShown = false;
const _overflowDisabledTokenSnapshotIds = new Set<string>();
const _invalidTokenSnapshotWarnings = new Set<string>();

const POSTGRES_INTEGER_MAX = 2_147_483_647;
// circle_office_agent_usage_snapshots.estimated_cost and the Office aggregate
// columns are numeric(12,6). Values above this cannot be represented without
// rounding into a 13th digit.
const OFFICE_TOKEN_SNAPSHOT_COST_MAX = 999_999.999_999;
const TOKEN_SNAPSHOT_DIAGNOSTIC_VALUE_MAX = 64;

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
  const normalizedSnapshotKey = normalizeTokenSnapshotKey(agentName, snapshotKey);
  const snapshotId = tokenSnapshotIdentity(circleId, agentName, normalizedSnapshotKey);
  if (_overflowDisabledTokenSnapshotIds.has(snapshotId)) return;

  const validation = validateTokenSnapshotUsage(
    inputTokens,
    outputTokens,
    cachedTokens,
    messageCount,
    estimatedCost,
  );
  if (validation.valid === false) {
    warnInvalidTokenSnapshotOnce(snapshotId, agentName, validation);
    return;
  }

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
      p_snapshot_key:   normalizedSnapshotKey,
    });

    if (error) {
      if (isTokenSnapshotNumericOverflow(error)) {
        disableOverflowingTokenSnapshotForSession(
          snapshotId,
          agentName,
          normalizedSnapshotKey,
        );
        return;
      }
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
        if (isTokenSnapshotNumericOverflow(legacyError)) {
          disableOverflowingTokenSnapshotForSession(
            snapshotId,
            agentName,
            normalizedSnapshotKey,
          );
          return;
        }
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
    if (isTokenSnapshotNumericOverflow(err)) {
      disableOverflowingTokenSnapshotForSession(
        snapshotId,
        agentName,
        normalizedSnapshotKey,
      );
      return;
    }
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
