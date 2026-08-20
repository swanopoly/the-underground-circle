/**
 * Agent Invocation — Phase 3
 * Real agent execution via OpenSwan gateway
 */

import { supabase } from './supabase';
import { CircleOfficeAgent, BLACKSWAN_AGENT_ID } from './circleOffice';
import { loadBudgetConfig, checkHardLimit, type BudgetConfig } from './budgetAlerts';
import { loadOfficeUserPreferences } from './officeDashboardPersistence';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';
import {
  buildAgentRuntimeSubject,
  isUuidLike,
  type AgentRuntimeSubject,
  type AgentRuntimeSubjectMetadata,
} from './agentRuntimeSubject';
import { fetchBridgeAuthenticated } from './bridgeAuth';
import { safeGetUserForAccessToken } from './authSession';
import { buildConnectedAgentHandoffReceipt } from './connectedAgentHandoffCore';
import { recordConnectedAgentAcceptedRun } from './agentRunSystem';
import { sendSessionMessage } from './openswanService';
import {
  isInvokeAgentV2Unavailable,
  readOfficeAgentSessionBinding,
  resolveOfficeAgentSessionBinding,
  type OfficeSessionSnapshot,
} from './officeAgentSessionBinding';
import type { OfficeAgentSessionBinding } from './officeAgentSessionBindingCore';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvocationRequest {
  messageId: string;
  circleId: string;
  command: string;
  senderId?: string;
  targetAgentId?: string;
  targetAgentName: string;
  agentSubjectKey?: string;
  agentDbId?: string | null;
  agentSessionKey?: string | null;
  agentLegacyIds?: string[];
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata;
  targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
  promptName?: string;
  promptLabel?: string;
  model?: string | null;
}

export interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface AgentInvocationResult {
  success: boolean;
  /**
   * `accepted` proves only that an external runtime took ownership. It is not
   * a completed task. `outcome_unknown` means one attempt may have crossed the
   * transport boundary and therefore must not be replayed automatically.
   */
  disposition?: 'completed' | 'accepted' | 'failed' | 'outcome_unknown';
  completionVerified?: boolean;
  /** Provider-owned correlation. Never substitute this for the local run id. */
  providerRunId?: string;
  /** Exact provider session correlation, kept separate from every run id. */
  sessionId?: string;
  /** Structured provider phase/status; never parsed from response prose. */
  providerStatus?: string;
  externalDispatchKind?: 'sessions_send' | 'sessions_spawn';
  externalConnectionId?: string;
  /** Canonical local `agent_runs.id`, populated only after accepted-run persistence. */
  runId?: string;
  /** Allowlisted local pre-dispatch failure; never populated from provider prose. */
  failureCode?: 'openswan_session_binding_required';
  responseId?: string;
  responseText?: string;
  tokenCount?: number;
  latencyMs?: number;
  error?: string;
  model?: string;
  tokens?: TokenBreakdown;
}

function resolveInvocationDisposition(
  result: AgentInvocationResult,
): NonNullable<AgentInvocationResult['disposition']> {
  if (
    result.disposition === 'completed'
    || result.disposition === 'accepted'
    || result.disposition === 'failed'
    || result.disposition === 'outcome_unknown'
  ) return result.disposition;
  return result.success ? 'completed' : 'failed';
}

export interface OfficeInvocationClaim {
  responseId: string;
  messageId: string;
  circleId: string;
  senderId: string;
  command: string;
  targetAgentId: string | null;
  targetAgentIds: string[] | null;
  targetAgentName: string;
  model: string | null;
  agentId: string | null;
  agentSubjectKey: string;
  agentName: string;
  bindingContractVersion: 1 | null;
  bindingStatus: 'bound' | 'missing' | null;
  binding: OfficeAgentSessionBinding | null;
  /**
   * The durable response row was claimed, but the caller-owned Office
   * lifecycle retired before the claim returned. The claim must never be
   * replayed and no provider dispatch may follow it.
   */
  authorityRetiredAfterClaim?: true;
}

/**
 * Immutable account/circle authority captured before an Office terminal
 * dispatch starts. This contract is opt-in so non-Office legacy callers keep
 * their existing behavior while Office can fence every asynchronous boundary.
 */
export type OfficeInvocationExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type OfficeInvocationAuthorityGuard = (
  authority: OfficeInvocationExactAuthority,
) => boolean;

export type OfficeInvocationExactExecution = Readonly<{
  authority: OfficeInvocationExactAuthority;
  isCurrent: OfficeInvocationAuthorityGuard;
  /** Abort when the owning Office lifecycle is replaced or unmounted. */
  signal?: AbortSignal;
}>;

const OFFICE_INVOCATION_AUTHORITY_RETIRED =
  'Office invocation authority retired after the durable claim. Nothing was replayed.';
const OFFICE_INVOCATION_AUTHORITY_UNAVAILABLE =
  'Office invocation authority could not be verified. Nothing was dispatched.';
const OFFICE_BUDGET_SETTINGS_UNAVAILABLE =
  'Office budget settings could not be verified. Nothing was dispatched.';
const OFFICE_BUDGET_USAGE_UNAVAILABLE =
  'Office budget usage could not be verified. Nothing was dispatched.';
const OFFICE_BUDGET_USAGE_PAGE_SIZE = 1000;
const OFFICE_ESTIMATED_COST_PER_TOKEN = 0.0000005;

function normalizeOfficeInvocationExactAuthority(
  input: OfficeInvocationExactAuthority | null | undefined,
): OfficeInvocationExactAuthority | null {
  const userId = String(input?.userId || '').trim();
  const circleId = String(input?.circleId || '').trim();
  const accessToken = String(input?.accessToken || '').trim();
  const generation = Number(input?.generation);
  if (
    !isUuidLike(userId)
    || !isUuidLike(circleId)
    || !accessToken
    || accessToken.length > 16_384
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return Object.freeze({ userId, circleId, accessToken, generation });
}

function officeInvocationExecutionIsCurrent(
  execution: OfficeInvocationExactExecution | null | undefined,
): boolean {
  if (!execution) return true;
  if (execution.signal?.aborted) return false;
  try {
    return execution.isCurrent(execution.authority) === true;
  } catch {
    return false;
  }
}

async function resolveOfficeInvocationExactExecution(
  input: OfficeInvocationExactExecution | null | undefined,
  req: InvocationRequest,
): Promise<OfficeInvocationExactExecution | null> {
  if (!input) return null;
  const authority = normalizeOfficeInvocationExactAuthority(input.authority);
  if (
    !authority
    || authority.circleId !== req.circleId
  ) return null;
  const execution = Object.freeze({
    authority,
    isCurrent: input.isCurrent,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!officeInvocationExecutionIsCurrent(execution)) return null;
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (
    verifiedUser?.id !== authority.userId
    || !officeInvocationExecutionIsCurrent(execution)
  ) return null;
  return execution;
}

function buildOfficeInvocationAuthorityUnavailableResult(): AgentInvocationResult {
  return {
    success: false,
    disposition: 'failed',
    completionVerified: false,
    error: OFFICE_INVOCATION_AUTHORITY_UNAVAILABLE,
  };
}

function buildOfficeInvocationRetiredAfterClaimResult(
  responseId?: string,
): AgentInvocationResult {
  return {
    success: false,
    disposition: 'outcome_unknown',
    completionVerified: false,
    ...(responseId ? { responseId } : {}),
    responseText: OFFICE_INVOCATION_AUTHORITY_RETIRED,
    error: OFFICE_INVOCATION_AUTHORITY_RETIRED,
  };
}

// invokeAndStream deliberately retains the historical two-argument claimant
// call for legacy source compatibility. An exact execution is scoped to that
// request object only and is removed immediately after the claim returns.
const exactExecutionByInvocationRequest = new WeakMap<
  InvocationRequest,
  OfficeInvocationExactExecution
>();

// ─── DB: Create response row (atomic) ───────────────────────────────────────

export async function invokeAgent(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
): Promise<OfficeInvocationClaim | null> {
  try {
    const exactExecution = exactExecutionByInvocationRequest.get(req);
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return null;
    const blackSwan = isBlackSwanAgent(agent);
    const durableAgentId = !blackSwan && isUuidLike(agent.id) ? agent.id : null;
    if (!blackSwan && !durableAgentId) return null;

    const claimArgs = {
      p_message_id: req.messageId,
      p_circle_id: req.circleId,
      p_expected_command_text: req.command,
      p_agent_id: durableAgentId,
    };
    const needsOpenSwanBinding = agent.provider === 'openswan' && durableAgentId !== null;
    let usedBindingClaim = needsOpenSwanBinding;
    let claimRpc = supabase.rpc(
      needsOpenSwanBinding ? 'invoke_agent_v2' : 'invoke_agent',
      claimArgs,
    );
    if (exactExecution) {
      claimRpc = claimRpc.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
    }
    let { data, error } = await claimRpc;
    let authorityRetiredAfterClaim = Boolean(
      exactExecution && !officeInvocationExecutionIsCurrent(exactExecution),
    );

    // §36 is forward-only and may not be deployed yet. A missing v2 RPC did
    // not execute the claim, so the legacy claim is safe exactly once; the
    // returned missing binding then prevents provider dispatch.
    if (error && needsOpenSwanBinding && isInvokeAgentV2Unavailable(error)) {
      if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return null;
      usedBindingClaim = false;
      let fallbackClaimRpc = supabase.rpc('invoke_agent', claimArgs);
      if (exactExecution) {
        fallbackClaimRpc = fallbackClaimRpc.setHeader(
          'Authorization',
          `Bearer ${exactExecution.authority.accessToken}`,
        );
      }
      ({ data, error } = await fallbackClaimRpc);
      authorityRetiredAfterClaim = Boolean(
        exactExecution && !officeInvocationExecutionIsCurrent(exactExecution),
      );
    }

    if (error) {
      console.error('[agentInvocation] office_claim_failed');
      return null;
    }

    if (Array.isArray(data) && data.length !== 1) {
      console.error('[agentInvocation] office_claim_cardinality_rejected');
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    const responseId = String(row?.response_id || '');
    const messageId = String(row?.canonical_message_id || '');
    const circleId = String(row?.canonical_circle_id || '');
    const senderId = String(row?.canonical_sender_id || '');
    const command = typeof row?.canonical_command_text === 'string'
      ? row.canonical_command_text
      : '';
    const canonicalAgentId = typeof row?.canonical_agent_id === 'string'
      ? row.canonical_agent_id
      : null;
    const agentSubjectKey = String(row?.canonical_agent_subject_key || '');
    const agentName = String(row?.canonical_agent_name || '');
    const targetAgentId = typeof row?.canonical_target_agent_id === 'string'
      ? row.canonical_target_agent_id
      : null;
    const rawTargetAgentIds = Array.isArray(row?.canonical_target_agent_ids)
      ? row.canonical_target_agent_ids
      : null;
    const targetAgentIds = rawTargetAgentIds
      ? rawTargetAgentIds.map(id => String(id)).filter(isUuidLike)
      : null;
    const targetAgentName = typeof row?.canonical_target_agent_name === 'string'
      ? row.canonical_target_agent_name
      : '';
    let bindingContractVersion: 1 | null = null;
    let bindingStatus: 'bound' | 'missing' | null = null;
    let binding: OfficeAgentSessionBinding | null = null;
    if (needsOpenSwanBinding && usedBindingClaim) {
      bindingContractVersion = row?.binding_contract_version === 1 ? 1 : null;
      bindingStatus = row?.binding_status === 'bound' || row?.binding_status === 'missing'
        ? row.binding_status
        : null;
      if (bindingStatus === 'bound') {
        binding = {
          id: typeof row?.binding_id === 'string' ? row.binding_id : '',
          officeAgentId: canonicalAgentId || '',
          agentBotId: typeof row?.binding_agent_bot_id === 'string'
            ? row.binding_agent_bot_id
            : '',
          sessionKey: typeof row?.binding_session_key === 'string'
            ? row.binding_session_key
            : '',
        };
      }
    } else if (needsOpenSwanBinding) {
      bindingStatus = 'missing';
    }
    const normalizedTargetName = targetAgentName.trim().toLowerCase();
    const canonicalScopeMatches = blackSwan
      ? (
          targetAgentId === null
          && (
            normalizedTargetName === 'all'
            || normalizedTargetName === '@all'
            || normalizedTargetName === 'blackswan'
            || normalizedTargetName === '@blackswan'
            || normalizedTargetName === 'swan'
            || normalizedTargetName === '@swan'
            || normalizedTargetName.includes('blackswan')
            || normalizedTargetName.includes('@swan')
          )
        )
      : (
          targetAgentId === durableAgentId
          || targetAgentIds?.includes(durableAgentId!) === true
          || (
            targetAgentId === null
            && (targetAgentIds?.length || 0) === 0
            && (normalizedTargetName === 'all' || normalizedTargetName === '@all')
          )
        );
    if (
      row?.claim_disposition !== 'claimed'
      || !isUuidLike(responseId)
      || !isUuidLike(senderId)
      || messageId !== req.messageId
      || circleId !== req.circleId
      || command !== req.command
      || (req.senderId && senderId !== req.senderId)
      || (exactExecution && (
        circleId !== exactExecution.authority.circleId
      ))
      || (!blackSwan && canonicalAgentId !== durableAgentId)
      || (blackSwan && canonicalAgentId !== null)
      || agentSubjectKey !== (
        blackSwan ? 'blackswan' : `office-agent:${durableAgentId}`
      )
      || !agentName
      || !targetAgentName
      || (rawTargetAgentIds !== null && targetAgentIds?.length !== rawTargetAgentIds.length)
      || !canonicalScopeMatches
      || (usedBindingClaim && (
        bindingContractVersion !== 1
        || bindingStatus === null
        || (bindingStatus === 'bound' && !binding)
        || (bindingStatus === 'missing' && (
          row?.binding_id != null
          || row?.binding_agent_bot_id != null
          || row?.binding_session_key != null
        ))
      ))
    ) {
      console.error('[agentInvocation] office_claim_rejected');
      return null;
    }

    return {
      responseId,
      messageId,
      circleId,
      senderId,
      command,
      targetAgentId,
      targetAgentIds,
      targetAgentName,
      model: typeof row?.canonical_model === 'string' ? row.canonical_model : null,
      agentId: canonicalAgentId,
      agentSubjectKey,
      agentName,
      bindingContractVersion,
      bindingStatus,
      binding,
      ...(authorityRetiredAfterClaim ? { authorityRetiredAfterClaim: true as const } : {}),
    };
  } catch {
    console.error('[agentInvocation] office_claim_exception');
    return null;
  }
}

// ─── DB: Stream response updates ───────────────────────────────────────────

export async function streamResponse(
  responseId: string,
  text: string,
  status: 'pending' | 'streaming' | 'done' | 'error',
  tokenCount: number = 0,
  latencyMs?: number,
  model?: string,
  tokens?: TokenBreakdown,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<boolean> {
  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return false;
    let responseRpc = supabase.rpc('stream_response', {
      p_response_id: responseId,
      p_text: text,
      p_status: status,
      p_tokens: tokenCount,
      p_latency_ms: latencyMs ?? null,
      p_model: model ?? null,
      p_input_tokens: tokens?.inputTokens ?? 0,
      p_output_tokens: tokens?.outputTokens ?? 0,
      p_cache_creation_tokens: tokens?.cacheCreationTokens ?? 0,
      p_cache_read_tokens: tokens?.cacheReadTokens ?? 0,
    });
    if (exactExecution) {
      responseRpc = responseRpc.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
    }
    const { data, error } = await responseRpc;

    if (
      error
      || data !== true
      || (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution))
    ) {
      console.error('[agentInvocation] office_response_update_failed');
      return false;
    }

    return true;
  } catch {
    console.error('[agentInvocation] office_response_update_exception');
    return false;
  }
}

// ─── DB: Mark message complete ──────────────────────────────────────────────

export async function markMessageDone(
  messageId: string,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<boolean> {
  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return false;
    let completionRpc = supabase.rpc('mark_message_done', {
      p_message_id: messageId,
    });
    if (exactExecution) {
      completionRpc = completionRpc.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
    }
    const { data, error } = await completionRpc;

    if (error || (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution))) {
      console.error('[agentInvocation] office_completion_failed');
      return false;
    }

    return data === true;
  } catch {
    console.error('[agentInvocation] office_completion_exception');
    return false;
  }
}

// ─── BlackSwan: Invoke via swanbot-ai edge function ─────────────────────────

function isBlackSwanAgent(agent: CircleOfficeAgent): boolean {
  return agent.provider === 'blackswan' || agent.id === BLACKSWAN_AGENT_ID;
}

function uniqueSubjectIds(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
}

function cleanTargetAgentDisplayName(value: string | null | undefined): string | null {
  const cleaned = String(value || '').trim().replace(/^@+/, '').trim();
  if (!cleaned || cleaned.toLowerCase() === 'all') return null;
  return cleaned;
}

function buildInvocationAgentSubject(agent: CircleOfficeAgent, req: InvocationRequest): AgentRuntimeSubject {
  const displayName = cleanTargetAgentDisplayName(req.targetAgentName) || agent.name || 'Agent';
  const base = buildAgentRuntimeSubject({
    id: req.targetAgentId || agent.id,
    name: displayName,
    providerType: agent.provider as any,
    spirit: agent.spirit,
  }, {
    dbAgentId: req.agentDbId || (isUuidLike(agent.id) ? agent.id : null),
  });
  const supplied = findSubjectMetadataForAgent(req, agent);
  const subjectKey = supplied?.agentSubjectKey || req.agentSubjectKey || base.subjectKey;
  const dbAgentId = supplied?.agentDbId ?? req.agentDbId ?? base.dbAgentId;
  const sessionKey = supplied?.agentSessionKey ?? req.agentSessionKey ?? base.sessionKey;
  const legacyIds = uniqueSubjectIds([
    ...base.legacyIds,
    ...(supplied?.legacyAgentIds || []),
    ...(req.agentLegacyIds || []),
  ]).filter(alias => alias !== subjectKey);
  const metadata: AgentRuntimeSubjectMetadata = {
    ...base.metadata,
    ...supplied,
    agentSubjectKey: subjectKey,
    agentDisplayName: supplied?.agentDisplayName || displayName,
    agentDbId: dbAgentId,
    agentProvider: supplied?.agentProvider ?? base.providerType,
    agentSessionKey: sessionKey,
    agentSpiritId: supplied?.agentSpiritId ?? base.spiritId,
    legacyAgentIds: legacyIds,
  };
  const aliases = uniqueSubjectIds([
    subjectKey,
    dbAgentId,
    sessionKey,
    agent.id,
    req.targetAgentId,
    displayName,
    ...base.memoryAgentAliases,
    ...legacyIds,
  ]);
  return {
    ...base,
    displayName,
    subjectKey,
    dbAgentId,
    sessionKey,
    memoryAgentId: subjectKey,
    runAgentId: subjectKey,
    memoryAgentAliases: aliases,
    runAgentAliases: aliases,
    legacyIds,
    metadata,
  };
}

function buildInvocationSwanBotContext(subject: AgentRuntimeSubject) {
  return {
    agentId: subject.subjectKey,
    agentName: subject.displayName,
    agentSubjectKey: subject.subjectKey,
    agentDbId: subject.dbAgentId,
    agentSessionKey: subject.sessionKey,
    agentLegacyIds: subject.legacyIds,
    agentSubjectMetadata: subject.metadata,
  };
}

function normalizeSubjectLookupValue(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim().replace(/^@+/, '').trim().toLowerCase();
  return normalized || null;
}

function metadataMatchesAgent(subject: AgentRuntimeSubjectMetadata, agent: CircleOfficeAgent): boolean {
  const agentLookups = new Set(
    uniqueSubjectIds([
      agent.id,
      agent.name,
      isUuidLike(agent.id) ? agent.id : null,
    ]).map(value => normalizeSubjectLookupValue(value)).filter(Boolean)
  );
  const subjectLookups = uniqueSubjectIds([
    subject.agentSubjectKey,
    subject.agentDbId,
    subject.agentSessionKey,
    subject.agentDisplayName,
    ...subject.legacyAgentIds,
  ]).map(value => normalizeSubjectLookupValue(value)).filter(Boolean);
  return subjectLookups.some(value => agentLookups.has(value));
}

function findSubjectMetadataForAgent(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
): AgentRuntimeSubjectMetadata | undefined {
  if (req.agentSubjectMetadata && metadataMatchesAgent(req.agentSubjectMetadata, agent)) {
    return req.agentSubjectMetadata;
  }
  return (req.targetAgentSubjects || []).find(subject => metadataMatchesAgent(subject, agent));
}

function buildPerAgentInvocationRequest(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
): InvocationRequest {
  const agentSubjectMetadata = findSubjectMetadataForAgent(req, agent);
  return {
    ...req,
    targetAgentId: agent.id,
    targetAgentName: `@${agent.name}`,
    ...(agentSubjectMetadata ? { agentSubjectMetadata } : {}),
  };
}

async function invokeBlackSwan(
  command: string,
  circleId: string,
  senderId: string,
  model?: string | null,
  targetAgentName?: string,
  agentSubject?: AgentRuntimeSubjectMetadata | null,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult> {
  const start = Date.now();
  if (shouldBlockExternalAiProvider('anthropic')) {
    return { success: false, error: getStrictLocalAiModeMessage('anthropic') };
  }

  // Strip thinking level suffix from model (e.g. "claude-sonnet::deep")
  let cleanModel = model;
  if (cleanModel && cleanModel.includes('::')) {
    cleanModel = cleanModel.split('::')[0];
  }

  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      body: {
        message: command,
        circleId,
        userId: senderId,
        model: cleanModel || null,
        targetAgentName: agentSubject?.agentDisplayName || targetAgentName || undefined,
        targetAgentSubjectKey: agentSubject?.agentSubjectKey,
        targetAgentDbId: agentSubject?.agentDbId || undefined,
        targetAgentLegacyIds: agentSubject?.legacyAgentIds,
        agentSubject: agentSubject || undefined,
      },
      ...(exactExecution ? {
        headers: {
          Authorization: `Bearer ${exactExecution.authority.accessToken}`,
        },
        signal: exactExecution.signal,
      } : {}),
    });

    const latencyMs = Date.now() - start;

    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }

    if (error) {
      return {
        success: false,
        error: `BlackSwan edge function error: ${error.message}`,
      };
    }

    const responseText = data?.response || 'BlackSwan is thinking...';
    const usage = data?.usage;
    const tokenCount = usage?.total_tokens || estimateTokens(command, responseText);

    return {
      success: true,
      responseText,
      tokenCount,
      latencyMs,
      model: usage?.model || 'blackswan',
      tokens: {
        inputTokens: usage?.input_tokens || 0,
        outputTokens: usage?.output_tokens || 0,
        cacheCreationTokens: usage?.cache_creation_tokens || 0,
        cacheReadTokens: usage?.cache_read_tokens || 0,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'BlackSwan invocation failed',
    };
  }
}

// ─── Claude Code: Invoke via structured local bridge POST /spawn ───────────

function isClaudeCodeAgent(agent: CircleOfficeAgent): boolean {
  return agent.provider === 'claude-code';
}

function isGeminiCliAgent(agent: CircleOfficeAgent): boolean {
  return agent.provider === 'gemini' && (agent.gatewayUrl?.includes('localhost:7780') || agent.name === 'Gemini CLI');
}

async function invokeClaudeCode(
  command: string,
  bridgeUrl: string = 'http://localhost:7778',
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult> {
  const start = Date.now();
  const controller = new AbortController();
  const retire = () => controller.abort();
  exactExecution?.signal?.addEventListener('abort', retire, { once: true });
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }
    const response = await fetchBridgeAuthenticated(`${bridgeUrl}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: command, useWorktree: false }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;

    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }

    if (!response.ok) {
      return {
        success: false,
        disposition: 'failed',
        completionVerified: false,
        error: `Claude Code bridge error: HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }
    const results = Array.isArray(data?.results) ? data.results : [];
    const successfulResults = results.filter((item: any) => item && item.ok === true);
    const safeSuccessfulHandles = successfulResults.filter((item: any) => (
      typeof item?.spawnId === 'string' && /^[a-f0-9]{36}$/.test(item.spawnId)
    ));

    if (!data.ok) {
      // A malformed response that simultaneously claims a launched child and
      // top-level failure cannot prove whether work started. Never replay it.
      if (successfulResults.length > 0) {
        return {
          success: false,
          disposition: 'outcome_unknown',
          completionVerified: false,
          ...(safeSuccessfulHandles.length === 1
            ? { providerRunId: safeSuccessfulHandles[0].spawnId }
            : {}),
          responseText: 'Claude Code may have accepted this task, but the bridge response was inconsistent. The task was not replayed; check the Claude session before retrying.',
          error: 'Claude Code dispatch outcome is unknown',
          latencyMs,
        };
      }
      return {
        success: false,
        disposition: 'failed',
        completionVerified: false,
        error: data.error || data.message || 'Claude Code task could not be started',
      };
    }

    const accepted = successfulResults.length === 1
      && safeSuccessfulHandles.length === 1
      && results.length === 1
      && Number(data.spawned) === 1
      && Number(data.total) === 1
      ? safeSuccessfulHandles[0]
      : null;
    if (!accepted) {
      return {
        success: false,
        disposition: 'outcome_unknown',
        completionVerified: false,
        responseText: 'Claude Code may have accepted this task, but the bridge did not return one exact spawn handle. The task was not replayed; check the Claude session before retrying.',
        error: 'Claude Code dispatch outcome is unknown',
        latencyMs,
      };
    }

    const responseText = `Claude Code accepted the task (handle ${accepted.spawnId}). Completion has not been verified yet.`;

    const tokenCount = estimateTokens(command, responseText);

    return {
      success: true,
      disposition: 'accepted',
      completionVerified: false,
      providerRunId: accepted.spawnId,
      responseText,
      tokenCount,
      latencyMs,
    };
  } catch (err: any) {
    const timedOut = err?.name === 'AbortError';
    return {
      success: false,
      disposition: 'outcome_unknown',
      completionVerified: false,
      responseText: timedOut
        ? 'Claude Code did not confirm the spawn before the 35-second boundary. The task was not replayed; check the Claude session before retrying.'
        : 'The Claude Code bridge response was lost after one spawn attempt. The task was not replayed; check the Claude session before retrying.',
      error: timedOut
        ? 'Claude Code dispatch outcome is unknown after timeout'
        : 'Claude Code dispatch outcome is unknown after a transport error',
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeout);
    exactExecution?.signal?.removeEventListener('abort', retire);
  }
}

// ─── Gemini CLI: Invoke via local bridge ──────────────────────────────────────

async function invokeGeminiCli(
  command: string,
  bridgeUrl: string = 'http://localhost:7780',
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult> {
  const start = Date.now();
  const controller = new AbortController();
  const retire = () => controller.abort();
  exactExecution?.signal?.addEventListener('abort', retire, { once: true });
  const timeout = setTimeout(() => controller.abort(), 35000);

  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }

    const response = await fetchBridgeAuthenticated(`${bridgeUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });

    const latencyMs = Date.now() - start;

    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }

    if (!response.ok) {
      return {
        success: false,
        error: `Gemini CLI bridge error: HTTP ${response.status}`,
      };
    }

    const data = await response.json();
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }

    if (!data.ok) {
      return {
        success: false,
        error: data.error || 'Gemini CLI command failed',
      };
    }

    const responseText = (data.response || '').trim()
      || 'Command executed (no output)';

    const tokenCount = estimateTokens(command, responseText);

    return {
      success: true,
      responseText,
      tokenCount,
      latencyMs,
      model: data.model || 'gemini-3.6-flash',
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Gemini CLI bridge command timed out (35s)',
      };
    }
    return {
      success: false,
      error: err.message || 'Gemini CLI bridge not reachable',
    };
  } finally {
    clearTimeout(timeout);
    exactExecution?.signal?.removeEventListener('abort', retire);
  }
}

// ─── BYO LLM: Invoke via llm-proxy edge function ────────────────────────────

const BYO_LLM_PROVIDERS = ['openai', 'anthropic', 'openrouter', 'groq', 'ollama', 'github-models', 'huggingface', 'zai', 'minimax'];

function isBYOLLMAgent(agent: CircleOfficeAgent): boolean {
  return BYO_LLM_PROVIDERS.includes(agent.provider);
}

/**
 * Parse a BYO model key like "openai/gpt-5.6-terra" into provider + model.
 * Falls back to the agent's provider if no prefix found.
 */
function parseBYOModel(modelKey: string | null | undefined, agentProvider: string): { provider: string; model: string; thinkingLevel?: string } {
  // Strip thinking level suffix (e.g. "openai/gpt-5.6-terra::deep" → thinkingLevel = "deep")
  let thinkingLevel: string | undefined;
  let cleanKey = modelKey;
  if (cleanKey && cleanKey.includes('::')) {
    const [base, level] = cleanKey.split('::');
    cleanKey = base;
    if (['fast', 'balanced', 'deep'].includes(level)) thinkingLevel = level;
  }

  if (!cleanKey) {
    const defaults: Record<string, string> = {
      openai: 'gpt-5.6-terra',
      anthropic: 'claude-sonnet-5',
      openrouter: 'openrouter/auto',
      groq: 'openai/gpt-oss-120b',
      ollama: 'blackswan',
      'github-models': 'openai/gpt-4.1-mini',
      huggingface: 'Qwen/Qwen3-32B',
      zai: 'glm-5.1',
      minimax: 'MiniMax-M2.7',
    };
    return { provider: agentProvider, model: defaults[agentProvider] || 'gpt-5.6-terra', thinkingLevel };
  }
  const parts = cleanKey.split('/');
  if (parts.length >= 2 && BYO_LLM_PROVIDERS.includes(parts[0])) {
    return { provider: parts[0], model: parts.slice(1).join('/'), thinkingLevel };
  }
  return { provider: agentProvider, model: cleanKey, thinkingLevel };
}

async function invokeBYOLLM(
  command: string,
  agentProvider: string,
  model?: string | null,
  circleId?: string,
  senderId?: string,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult> {
  const start = Date.now();
  const { provider, model: resolvedModel, thinkingLevel } = parseBYOModel(model, agentProvider);
  if (shouldBlockExternalAiProvider(provider)) {
    return { success: false, error: getStrictLocalAiModeMessage(provider) };
  }

  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        provider,
        model: resolvedModel,
        messages: [{ role: 'user', content: command }],
        circleId,
        userId: senderId,
        ...(thinkingLevel && thinkingLevel !== 'balanced' ? { thinkingLevel } : {}),
      },
      ...(exactExecution ? {
        headers: {
          Authorization: `Bearer ${exactExecution.authority.accessToken}`,
        },
        signal: exactExecution.signal,
      } : {}),
    });

    const latencyMs = Date.now() - start;

    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }

    if (error) {
      return { success: false, error: `LLM Proxy error: ${error.message}` };
    }
    if (data?.error) {
      return { success: false, error: data.error };
    }

    return {
      success: true,
      responseText: data.response,
      tokenCount: data.usage?.total_tokens || 0,
      latencyMs,
      model: data.usage?.model || resolvedModel,
      tokens: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
        cacheCreationTokens: data.usage?.cache_creation_tokens || 0,
        cacheReadTokens: data.usage?.cache_read_tokens || 0,
      },
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'BYO LLM invocation failed' };
  }
}

// ─── OpenSwan Gateway: Invoke Agent ─────────────────────────────────────────

const EXACT_OPENSWAN_TARGET_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function parseExactOpenSwanSessionTarget(agentId: string): {
  connectionId: string;
  sessionKey: string;
} | null {
  if (typeof agentId !== 'string' || agentId !== agentId.trim()) return null;
  const separator = agentId.indexOf('::');
  if (separator <= 0) return null;
  const connectionId = agentId.slice(0, separator);
  const sessionKey = agentId.slice(separator + 2);
  if (
    connectionId.length > 160
    || sessionKey.length > 160
    || !EXACT_OPENSWAN_TARGET_RE.test(connectionId)
    || !EXACT_OPENSWAN_TARGET_RE.test(sessionKey)
  ) return null;
  return { connectionId, sessionKey };
}

/**
 * Send one exact OpenSwan session turn through the canonical structured
 * sessions_send adapter. A provider turn ending is still only a handoff: no
 * current OpenSwan status verifies that the user's task itself completed.
 */
export async function callOpenSwanAgent(
  command: string,
  agentId: string,
  agentName: string,
  gatewayUrl: string,
  timeoutMs: number = 60000,
  model?: string | null,
  authToken?: string,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult> {
  if (!gatewayUrl) {
    return {
      success: false,
      disposition: 'failed',
      completionVerified: false,
      error: 'No gateway URL configured — add a connection in ⚙️ → Connections',
    };
  }

  const start = Date.now();
  void timeoutMs;
  const target = parseExactOpenSwanSessionTarget(agentId);
  if (!target) {
    return {
      success: false,
      disposition: 'failed',
      completionVerified: false,
      failureCode: 'openswan_session_binding_required',
      error: 'This Office agent is not linked to a live OpenSwan session. Choose a connected session, then send a new command. Nothing was dispatched.',
    };
  }

  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }
    const sent = await sendSessionMessage(
      { endpoint: gatewayUrl, token: authToken || '' },
      target.sessionKey,
      command,
    );
    const latencyMs = Date.now() - start;
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult();
    }
    const lineage = {
      ...(sent.providerRunId ? { providerRunId: sent.providerRunId } : {}),
      ...(sent.sessionKey ? { sessionId: sent.sessionKey } : {}),
      ...(sent.providerStatus ? { providerStatus: sent.providerStatus } : {}),
      externalDispatchKind: 'sessions_send' as const,
      externalConnectionId: target.connectionId,
    };

    if (sent.transportAccepted === true) {
      const responseText = sent.reply
        || `${agentName} accepted the OpenSwan session turn. Completion has not been verified yet.`;
      return {
        success: true,
        disposition: 'accepted',
        completionVerified: false,
        responseText,
        tokenCount: estimateTokens(command, responseText),
        latencyMs,
        model: model || undefined,
        ...lineage,
      };
    }
    if (sent.transportAccepted === false) {
      return {
        success: false,
        disposition: 'failed',
        completionVerified: false,
        error: sent.error || `OpenSwan rejected the session send for ${agentName}.`,
        latencyMs,
        ...lineage,
      };
    }
    return {
      success: false,
      disposition: 'outcome_unknown',
      completionVerified: false,
      responseText: sent.error
        || `OpenSwan could not confirm whether ${agentName} received the task. It was not replayed; check the exact session before retrying.`,
      error: 'OpenSwan dispatch outcome is unknown',
      latencyMs,
      ...lineage,
    };
  } catch {
    return {
      success: false,
      disposition: 'outcome_unknown',
      completionVerified: false,
      responseText: `The OpenSwan response was lost after one session-send attempt for ${agentName}. It was not replayed; check the exact session before retrying.`,
      error: 'OpenSwan dispatch outcome is unknown after a transport error',
      latencyMs: Date.now() - start,
      externalDispatchKind: 'sessions_send',
      externalConnectionId: target.connectionId,
      sessionId: target.sessionKey,
    };
  }
}

// ─── Fallback: Estimate tokens (until real tokens come from agent) ────────

function estimateTokens(command: string, response: string): number {
  // Rough estimate: ~1.3 tokens per word
  const totalChars = command.length + response.length;
  return Math.ceil(totalChars / 4);
}

// ─── Agent Task Tracking: Auto-create tasks from agent prompts ─────────────

/** Create a task when an agent starts processing a prompt */
async function createAgentTask(
  circleId: string,
  senderId: string,
  agentName: string,
  command: string,
  messageId: string,
  model?: string | null,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<string | null> {
  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return null;
    const title = `${agentName}: ${command.slice(0, 80)}${command.length > 80 ? '...' : ''}`;
    const description = [
      `**Prompt**`,
      `\`\`\``,
      command,
      `\`\`\``,
      ``,
      `**Agent:** ${agentName}`,
      model ? `**Model:** ${model}` : '',
      `**Message ID:** ${messageId}`,
      `**Started:** ${new Date().toISOString()}`,
      ``,
      `---`,
      `*Processing...*`,
    ].filter(Boolean).join('\n');

    let insertTask = supabase
      .from('tasks')
      .insert({
        circle_id: circleId,
        created_by: senderId,
        title,
        description,
        status: 'in_progress',
        priority: 'normal',
        position: 0,
      })
      .select('id')
      .single();
    if (exactExecution) {
      insertTask = insertTask.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
    }
    const { data, error } = await insertTask;

    if (error || (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution))) {
      console.warn('[agentInvocation] task_tracking_create_failed');
      return null;
    }
    return data?.id || null;
  } catch {
    return null;
  }
}

/** Update the task with response data and mark done/failed */
async function completeAgentTask(
  taskId: string,
  agentName: string,
  command: string,
  responseText: string | undefined,
  tokenCount: number,
  latencyMs: number | undefined,
  model: string | undefined,
  success: boolean,
  messageId: string,
  tokens?: TokenBreakdown,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<void> {
  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return;
    const duration = latencyMs ? `${(latencyMs / 1000).toFixed(1)}s` : 'N/A';
    const tokenStr = tokenCount > 0 ? tokenCount.toLocaleString() : 'N/A';
    const tokenBreakdown = tokens
      ? `  - Input: ${tokens.inputTokens.toLocaleString()}\n  - Output: ${tokens.outputTokens.toLocaleString()}\n  - Cache Read: ${tokens.cacheReadTokens.toLocaleString()}\n  - Cache Write: ${tokens.cacheCreationTokens.toLocaleString()}`
      : '';

    const description = [
      `**Prompt**`,
      `\`\`\``,
      command,
      `\`\`\``,
      ``,
      `**Agent:** ${agentName}`,
      model ? `**Model:** ${model}` : '',
      `**Status:** ${success ? 'Completed' : 'Failed'}`,
      `**Duration:** ${duration}`,
      `**Tokens:** ${tokenStr}`,
      tokenBreakdown ? `**Token Breakdown:**\n${tokenBreakdown}` : '',
      `**Message ID:** ${messageId}`,
      `**Completed:** ${new Date().toISOString()}`,
      ``,
      `---`,
      ``,
      `**Response**`,
      `\`\`\``,
      (responseText || '(no response)').slice(0, 4000),
      `\`\`\``,
    ].filter(Boolean).join('\n');

    let updateTask = supabase
      .from('tasks')
      .update({
        description,
        status: success ? 'done' : 'review',
        completed_at: success ? new Date().toISOString() : null,
      })
      .eq('id', taskId);
    if (exactExecution) {
      updateTask = updateTask.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
    }
    await updateTask;
  } catch {}
}

/**
 * Persist a provider-owned handoff without terminalizing the tracking task.
 * Accepted work stays in progress; an uncertain transport moves to review so
 * the user checks the external session before deciding whether to retry.
 */
async function updateAgentTaskHandoff(
  taskId: string,
  agentName: string,
  command: string,
  result: AgentInvocationResult,
  messageId: string,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<void> {
  try {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) return;
    const disposition = resolveInvocationDisposition(result);
    if (disposition !== 'accepted' && disposition !== 'outcome_unknown') return;
    const accepted = disposition === 'accepted';
    const description = [
      '**Prompt**',
      '```',
      command,
      '```',
      '',
      `**Agent:** ${agentName}`,
      `**Status:** ${accepted ? 'Accepted — awaiting verified result' : 'Outcome unknown — check external session before retrying'}`,
      result.providerRunId ? `**Provider Run:** ${result.providerRunId}` : '',
      result.runId ? `**Office Run:** ${result.runId}` : '',
      `**Message ID:** ${messageId}`,
      '',
      '---',
      '',
      result.responseText || result.error || 'The connected-agent result is not verified.',
    ].filter(Boolean).join('\n');

    let updateTask = supabase
      .from('tasks')
      .update({
        description: description.slice(0, 8000),
        status: accepted ? 'in_progress' : 'review',
        completed_at: null,
      })
      .eq('id', taskId);
    if (exactExecution) {
      updateTask = updateTask.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
    }
    await updateTask;
  } catch {}
}

// Module-level map: responseId → taskId. A message can fan out to several
// agents, so messageId alone would let parallel completions steal each other's
// tracking task.
const pendingAgentTasks = new Map<string, string>();
const OFFICE_PROVIDER_FAILURE = 'Agent invocation failed (provider_error).';
const OFFICE_RUNTIME_FAILURE = 'Agent invocation failed (runtime_error).';
const OFFICE_PERSISTENCE_FAILURE = 'Agent response could not be persisted safely.';
const OFFICE_OPENSWAN_BINDING_REQUIRED = 'This Office agent is not linked to a live OpenSwan session. Choose a connected session, then send a new command. Nothing was dispatched.';

function buildOpenSwanBindingRequiredResult(): AgentInvocationResult {
  return {
    success: false,
    disposition: 'failed',
    completionVerified: false,
    failureCode: 'openswan_session_binding_required',
    error: OFFICE_OPENSWAN_BINDING_REQUIRED,
  };
}

function getOfficeProviderFailureCopy(result: AgentInvocationResult): string {
  return result.failureCode === 'openswan_session_binding_required'
    ? OFFICE_OPENSWAN_BINDING_REQUIRED
    : OFFICE_PROVIDER_FAILURE;
}

type InvocationBudgetConfigRead =
  | { ok: true; config: BudgetConfig }
  | { ok: false; reason: 'authority' | 'settings' };

type InvocationBudgetSpend = Readonly<{
  today: number;
  week: number;
  month: number;
}>;

type InvocationBudgetSpendRead =
  | { ok: true; spend: InvocationBudgetSpend }
  | { ok: false; reason: 'authority' | 'usage' };

type InvocationBudgetWindow = Readonly<{
  todayStartMs: number;
  weekStartMs: number;
  monthStartMs: number;
  monthStartIso: string;
  snapshotEndMs: number;
  snapshotEndIso: string;
}>;

function normalizeInvocationBudgetConfig(value: unknown): BudgetConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.enabled !== 'boolean') return null;
  if (row.hardLimit !== undefined && typeof row.hardLimit !== 'boolean') return null;

  const config: BudgetConfig = {
    enabled: row.enabled,
    ...(row.hardLimit === undefined ? {} : { hardLimit: row.hardLimit }),
  };
  for (const period of ['daily', 'weekly', 'monthly'] as const) {
    const amount = row[period];
    if (amount === undefined) continue;
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return null;
    config[period] = amount;
  }
  return config;
}

function readCanonicalOfficeBudgetConfig(
  preferences: Record<string, unknown> | null,
): BudgetConfig | null {
  if (!preferences || !Object.prototype.hasOwnProperty.call(preferences, 'budgetConfig')) {
    return { enabled: false };
  }
  return normalizeInvocationBudgetConfig(preferences.budgetConfig);
}

async function loadInvocationBudgetConfig(
  circleId: string,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<InvocationBudgetConfigRead> {
  if (!exactExecution) {
    // Compatibility callers have no immutable account authority. Retain their
    // device-local setting without attempting to infer a user or circle.
    const config = normalizeInvocationBudgetConfig(await loadBudgetConfig());
    return config
      ? { ok: true, config }
      : { ok: false, reason: 'settings' };
  }
  if (
    exactExecution.authority.circleId !== circleId
    || !officeInvocationExecutionIsCurrent(exactExecution)
  ) return { ok: false, reason: 'authority' };

  const preferenceResult = await loadOfficeUserPreferences(
    exactExecution.authority.circleId,
    {
      userId: exactExecution.authority.userId,
      accessToken: exactExecution.authority.accessToken,
    },
  );
  if (!officeInvocationExecutionIsCurrent(exactExecution)) {
    return { ok: false, reason: 'authority' };
  }
  if (!preferenceResult.ok) return { ok: false, reason: 'settings' };

  const config = readCanonicalOfficeBudgetConfig(preferenceResult.preferences);
  return config
    ? { ok: true, config }
    : { ok: false, reason: 'settings' };
}

function buildInvocationBudgetWindow(nowMs: number): InvocationBudgetWindow | null {
  if (!Number.isFinite(nowMs) || nowMs <= 0) return null;
  const snapshotEndMs = Math.floor(nowMs);
  const snapshotEnd = new Date(snapshotEndMs);
  const snapshotEndIso = snapshotEnd.toISOString();
  const todayStart = new Date(
    snapshotEnd.getFullYear(),
    snapshotEnd.getMonth(),
    snapshotEnd.getDate(),
  );
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = new Date(snapshotEnd.getFullYear(), snapshotEnd.getMonth(), 1);
  const todayStartMs = todayStart.getTime();
  const weekStartMs = weekStart.getTime();
  const monthStartMs = monthStart.getTime();
  return {
    todayStartMs,
    weekStartMs,
    monthStartMs,
    monthStartIso: new Date(monthStartMs).toISOString(),
    snapshotEndMs,
    snapshotEndIso,
  };
}

function readBudgetTokenCount(value: unknown): number | null {
  const numeric = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
  return typeof numeric === 'number'
    && Number.isSafeInteger(numeric)
    && numeric >= 0
    ? numeric
    : null;
}

function accumulateInvocationBudgetUsagePage(
  rows: unknown,
  circleId: string,
  window: InvocationBudgetWindow,
): InvocationBudgetSpend | null {
  if (!Array.isArray(rows)) return null;
  let todayTokens = 0;
  let weekTokens = 0;
  let monthTokens = 0;

  for (const value of rows) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const createdAtMs = typeof row.created_at === 'string'
      ? Date.parse(row.created_at)
      : Number.NaN;
    const tokenCount = readBudgetTokenCount(row.token_count);
    if (
      !isUuidLike(String(row.id || ''))
      || row.circle_id !== circleId
      || !Number.isFinite(createdAtMs)
      || createdAtMs < window.monthStartMs
      || createdAtMs >= window.snapshotEndMs
      || tokenCount === null
      || !['pending', 'streaming', 'done', 'error'].includes(String(row.status || ''))
    ) return null;
    monthTokens += tokenCount;
    if (createdAtMs >= window.weekStartMs) weekTokens += tokenCount;
    if (createdAtMs >= window.todayStartMs) todayTokens += tokenCount;
    if (
      !Number.isSafeInteger(monthTokens)
      || !Number.isSafeInteger(weekTokens)
      || !Number.isSafeInteger(todayTokens)
    ) return null;
  }

  return {
    today: todayTokens * OFFICE_ESTIMATED_COST_PER_TOKEN,
    week: weekTokens * OFFICE_ESTIMATED_COST_PER_TOKEN,
    month: monthTokens * OFFICE_ESTIMATED_COST_PER_TOKEN,
  };
}

async function loadInvocationBudgetSpend(
  circleId: string,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<InvocationBudgetSpendRead> {
  const window = buildInvocationBudgetWindow(Date.now());
  if (!window) return { ok: false, reason: 'usage' };

  let expectedCount: number | null = null;
  let offset = 0;
  let spend: InvocationBudgetSpend = { today: 0, week: 0, month: 0 };

  while (expectedCount === null || offset < expectedCount) {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return { ok: false, reason: 'authority' };
    }
    let query = supabase
      .from('office_terminal_responses')
      .select('id, circle_id, status, token_count, created_at', { count: 'exact' })
      .eq('circle_id', circleId)
      .gte('created_at', window.monthStartIso)
      .lt('created_at', window.snapshotEndIso)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + OFFICE_BUDGET_USAGE_PAGE_SIZE - 1);
    if (exactExecution) {
      query = query.setHeader(
        'Authorization',
        `Bearer ${exactExecution.authority.accessToken}`,
      );
      if (exactExecution.signal) query = query.abortSignal(exactExecution.signal);
    }

    const { data, error, count } = await query;
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return { ok: false, reason: 'authority' };
    }
    if (
      error
      || !Number.isSafeInteger(count)
      || Number(count) < 0
      || (expectedCount !== null && count !== expectedCount)
    ) return { ok: false, reason: 'usage' };
    if (expectedCount === null) expectedCount = Number(count);

    const pageSpend = accumulateInvocationBudgetUsagePage(data, circleId, window);
    if (!pageSpend || !Array.isArray(data)) return { ok: false, reason: 'usage' };
    spend = {
      today: spend.today + pageSpend.today,
      week: spend.week + pageSpend.week,
      month: spend.month + pageSpend.month,
    };
    offset += data.length;
    if (offset > expectedCount) return { ok: false, reason: 'usage' };
    if (offset === expectedCount) break;
    if (data.length === 0) return { ok: false, reason: 'usage' };
  }

  return { ok: true, spend };
}

function buildOfficeBudgetPreflightFailure(
  error: string,
): AgentInvocationResult {
  return {
    success: false,
    disposition: 'failed',
    completionVerified: false,
    error,
  };
}

// ─── Invoke & Stream: Main entry point ──────────────────────────────────────

/**
 * Orchestrate the full invocation:
 * 1. Create response row (atomic)
 * 2. Call agent via gateway
 * 3. Stream updates in realtime
 * 4. Persist a verified final, or retain a nonterminal accepted/unknown handoff
 */
// --- Direct Invoke: Shared routing without terminal rows -------------------

export async function invokeDirect(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
  gatewayUrl?: string,
  authToken?: string,
  officeSessionSnapshot?: OfficeSessionSnapshot,
): Promise<AgentInvocationResult> {
  try {
    const budgetConfig = await loadBudgetConfig();
    if (budgetConfig.enabled && budgetConfig.hardLimit) {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const monthAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const [todayRes, weekRes, monthRes] = await Promise.all([
        supabase.from('office_terminal_responses').select('token_count').eq('circle_id', req.circleId).gte('created_at', todayStr).eq('status', 'done'),
        supabase.from('office_terminal_responses').select('token_count').eq('circle_id', req.circleId).gte('created_at', weekAgo).eq('status', 'done'),
        supabase.from('office_terminal_responses').select('token_count').eq('circle_id', req.circleId).gte('created_at', monthAgo).eq('status', 'done'),
      ]);

      const estimateCost = (rows: any[]) => (rows || []).reduce((s: number, r: any) => s + (r.token_count || 0), 0) * 0.0000005;
      const blocked = checkHardLimit(budgetConfig, estimateCost(todayRes.data || []), estimateCost(weekRes.data || []), estimateCost(monthRes.data || []));
      if (blocked) {
        return { success: false, error: blocked };
      }
    }
  } catch {
    console.warn('[agentInvocation] direct_budget_check_unavailable');
  }

  const blackSwan = isBlackSwanAgent(agent);
  const claudeCode = isClaudeCodeAgent(agent);
  const geminiCli = isGeminiCliAgent(agent);
  const byoLLM = isBYOLLMAgent(agent);
  const openSwanSessionAgent = agent.provider === 'openswan';
  const agentSubject = buildInvocationAgentSubject(agent, req);
  const swanBotContext = buildInvocationSwanBotContext(agentSubject);

  const resolvedUrl = agent.gatewayUrl || gatewayUrl;
  if (!resolvedUrl && !blackSwan && !claudeCode && !geminiCli && !byoLLM && !openSwanSessionAgent) {
    return {
      success: false,
      error: `No gateway URL for ${agent.name} - configure one in Connections`,
    };
  }

  if (!blackSwan && !claudeCode && !geminiCli && !byoLLM && !agent.isOwn && !agent.isPublic) {
    return {
      success: false,
      error: `${agent.name} is local-only - they need a public URL for cross-machine commands`,
    };
  }

  if (blackSwan) {
    if (req.model === 'gemini-flash') {
      const geminiStart = Date.now();
      try {
        const { getSwanBotResponse } = await import('./swanbot');
        const geminiResult = await getSwanBotResponse(req.command, {
          userId: req.senderId || req.messageId,
          circleId: req.circleId,
          ...swanBotContext,
        });
        return {
          success: true,
          responseText: geminiResult,
          tokenCount: estimateTokens(req.command, geminiResult),
          latencyMs: Date.now() - geminiStart,
        };
      } catch (err: any) {
        return { success: false, error: `Gemini fallback failed: ${err.message}` };
      }
    }
    return invokeBlackSwan(req.command, req.circleId, req.senderId || req.messageId, req.model, agentSubject.displayName, agentSubject.metadata);
  }

  if (claudeCode) {
    return invokeClaudeCode(req.command, resolvedUrl);
  }

  if (geminiCli) {
    const geminiUrl = resolvedUrl || 'http://localhost:7780';
    return invokeGeminiCli(req.command, geminiUrl);
  }

  if (byoLLM) {
    return invokeBYOLLM(req.command, agent.provider, req.model, req.circleId, req.senderId);
  }

  if (openSwanSessionAgent) {
    const binding = await readOfficeAgentSessionBinding(agent.id);
    const resolution = resolveOfficeAgentSessionBinding({
      officeAgentId: agent.id,
      binding,
      connections: officeSessionSnapshot?.connections,
      sessionsByConnection: officeSessionSnapshot?.sessionsByConnection,
      sessionFingerprintsByConnection: officeSessionSnapshot?.sessionFingerprintsByConnection,
    });
    if (!resolution.ok) return buildOpenSwanBindingRequiredResult();
    return callOpenSwanAgent(
      req.command,
      resolution.target.compositeAgentId,
      agent.name,
      resolution.target.config.endpoint,
      30000,
      req.model,
      resolution.target.config.token,
    );
  }

  return callOpenSwanAgent(
    req.command,
    agent.id,
    agent.name,
    resolvedUrl!,
    30000,
    req.model,
    authToken
  );
}

export async function invokeAndStream(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
  gatewayUrl?: string,
  authToken?: string,
  officeSessionSnapshot?: OfficeSessionSnapshot,
  exactExecutionInput?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult> {
  const resolvedExactExecution = exactExecutionInput
    ? await resolveOfficeInvocationExactExecution(exactExecutionInput, req)
    : undefined;
  if (exactExecutionInput && !resolvedExactExecution) {
    return buildOfficeInvocationAuthorityUnavailableResult();
  }
  const exactExecution = resolvedExactExecution || undefined;
  if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
    return buildOfficeInvocationAuthorityUnavailableResult();
  }

  // Budget authority is a pre-dispatch gate. Exact Office executions read the
  // captured account's canonical per-circle preferences; compatibility calls
  // retain the historical device-local configuration without guessing scope.
  let budgetConfigRead: InvocationBudgetConfigRead;
  try {
    budgetConfigRead = await loadInvocationBudgetConfig(req.circleId, exactExecution);
  } catch {
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationAuthorityUnavailableResult();
    }
    return buildOfficeBudgetPreflightFailure(OFFICE_BUDGET_SETTINGS_UNAVAILABLE);
  }
  if (!budgetConfigRead.ok) {
    return budgetConfigRead.reason === 'authority'
      ? buildOfficeInvocationAuthorityUnavailableResult()
      : buildOfficeBudgetPreflightFailure(OFFICE_BUDGET_SETTINGS_UNAVAILABLE);
  }

  const budgetConfig = budgetConfigRead.config;
  if (budgetConfig.enabled && budgetConfig.hardLimit) {
    let spendRead: InvocationBudgetSpendRead;
    try {
      spendRead = await loadInvocationBudgetSpend(req.circleId, exactExecution);
    } catch {
      if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
        return buildOfficeInvocationAuthorityUnavailableResult();
      }
      return buildOfficeBudgetPreflightFailure(OFFICE_BUDGET_USAGE_UNAVAILABLE);
    }
    if (!spendRead.ok) {
      return spendRead.reason === 'authority'
        ? buildOfficeInvocationAuthorityUnavailableResult()
        : buildOfficeBudgetPreflightFailure(OFFICE_BUDGET_USAGE_UNAVAILABLE);
    }

    const blocked = checkHardLimit(
      budgetConfig,
      spendRead.spend.today,
      spendRead.spend.week,
      spendRead.spend.month,
    );
    if (blocked) return buildOfficeBudgetPreflightFailure(blocked);
  }

  // Detect agent type for routing
  const blackSwan = isBlackSwanAgent(agent);
  const claudeCode = isClaudeCodeAgent(agent);
  const geminiCli = isGeminiCliAgent(agent);
  const byoLLM = isBYOLLMAgent(agent);
  const openSwanSessionAgent = agent.provider === 'openswan';

  // Resolve the actual gateway URL to use:
  // 1. Use agent's stored gatewayUrl if available
  // 2. Fall back to the passed-in gatewayUrl (caller's local)
  // Resolve gateway URL: agent's stored URL > caller's URL > fail
  const resolvedUrl = agent.gatewayUrl || gatewayUrl;
  if (!resolvedUrl && !blackSwan && !claudeCode && !geminiCli && !byoLLM && !openSwanSessionAgent) {
    return {
      success: false,
      error: `No gateway URL for ${agent.name} — configure one in ⚙️ → Connections`,
    };
  }

  // Cross-machine guard: if agent is not ours and not public, fail clearly
  // BlackSwan is always public (server-side edge function)
  // Claude Code is local-only but invoked by its owner
  if (!blackSwan && !claudeCode && !geminiCli && !byoLLM && !agent.isOwn && !agent.isPublic) {
    return {
      success: false,
      error: `${agent.name} is local-only — they need to set up a public URL to receive cross-machine commands`,
    };
  }

  // The Realtime envelope and local request are only a wake-up hint. Atomically
  // claim the durable row, then execute only the command, scope, sender, model,
  // and agent identity returned by the database.
  if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
    return buildOfficeInvocationAuthorityUnavailableResult();
  }
  if (exactExecution) req = { ...req };
  if (exactExecution) exactExecutionByInvocationRequest.set(req, exactExecution);
  const claim = await invokeAgent(req, agent);
  if (exactExecution) exactExecutionByInvocationRequest.delete(req);
  if (!claim) {
    console.error('[agentInvocation] office_claim_unavailable');
    return {
      success: false,
      error: 'Office invocation could not be claimed safely.',
    };
  }
  if (
    claim.authorityRetiredAfterClaim
    || (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution))
  ) {
    return buildOfficeInvocationRetiredAfterClaimResult(claim.responseId);
  }

  const responseId = claim.responseId;
  const canonicalAgent: CircleOfficeAgent = {
    ...agent,
    name: claim.agentName,
  };
  const canonicalReq: InvocationRequest = {
    messageId: claim.messageId,
    circleId: claim.circleId,
    command: claim.command,
    senderId: claim.senderId,
    targetAgentId: claim.agentId || BLACKSWAN_AGENT_ID,
    targetAgentName: `@${claim.agentName}`,
    agentSubjectKey: claim.agentSubjectKey,
    agentDbId: claim.agentId,
    agentSessionKey: null,
    agentLegacyIds: [],
    agentSubjectMetadata: undefined,
    targetAgentSubjects: null,
    promptName: undefined,
    promptLabel: undefined,
    model: claim.model,
  };
  const agentSubject = buildInvocationAgentSubject(canonicalAgent, canonicalReq);
  const swanBotContext = buildInvocationSwanBotContext(agentSubject);
  console.log('[agentInvocation] office_claimed');

  // Create the tracking task only after the durable command is claimed.
  const taskId = await createAgentTask(
    canonicalReq.circleId,
    canonicalReq.senderId!,
    canonicalAgent.name,
    canonicalReq.command,
    canonicalReq.messageId,
    canonicalReq.model,
    exactExecution,
  );
  if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
    return buildOfficeInvocationRetiredAfterClaimResult(responseId);
  }
  if (taskId) pendingAgentTasks.set(responseId, taskId);

  try {
    // Call the selected provider with canonical durable inputs.
    let result: AgentInvocationResult;

    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }

    if (blackSwan) {
      if (canonicalReq.model === 'gemini-flash') {
        // Gemini selected — use client-side Gemini path (edge fn only has Anthropic key)
        console.log('[agentInvocation] provider_route_gemini_client');
        const geminiStart = Date.now();
        try {
          const { getSwanBotResponse } = await import('./swanbot');
          if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
            return buildOfficeInvocationRetiredAfterClaimResult(responseId);
          }
          const geminiResult = await getSwanBotResponse(canonicalReq.command, {
            userId: canonicalReq.senderId!,
            circleId: canonicalReq.circleId,
            ...swanBotContext,
          });
          result = {
            success: true,
            responseText: geminiResult,
            tokenCount: estimateTokens(canonicalReq.command, geminiResult),
            latencyMs: Date.now() - geminiStart,
          };
        } catch {
          result = { success: false, error: OFFICE_PROVIDER_FAILURE };
        }
      } else {
        console.log('[agentInvocation] provider_route_blackswan');
        result = await invokeBlackSwan(
          canonicalReq.command,
          canonicalReq.circleId,
          canonicalReq.senderId!,
          canonicalReq.model,
          agentSubject.displayName,
          agentSubject.metadata,
          exactExecution,
        );
      }
    } else if (claudeCode) {
      console.log('[agentInvocation] provider_route_claude_code');
      result = await invokeClaudeCode(canonicalReq.command, resolvedUrl, exactExecution);
    } else if (geminiCli) {
      const geminiUrl = resolvedUrl || 'http://localhost:7780';
      console.log('[agentInvocation] provider_route_gemini_cli');
      result = await invokeGeminiCli(canonicalReq.command, geminiUrl, exactExecution);
    } else if (byoLLM) {
      console.log('[agentInvocation] provider_route_byo_llm');
      result = await invokeBYOLLM(
        canonicalReq.command,
        canonicalAgent.provider,
        canonicalReq.model,
        canonicalReq.circleId,
        canonicalReq.senderId,
        exactExecution,
      );
    } else if (openSwanSessionAgent) {
      console.log('[agentInvocation] provider_route_openswan_gateway');
      const resolution = resolveOfficeAgentSessionBinding({
        officeAgentId: claim.agentId,
        binding: claim.binding,
        connections: officeSessionSnapshot?.connections,
        sessionsByConnection: officeSessionSnapshot?.sessionsByConnection,
        sessionFingerprintsByConnection: officeSessionSnapshot?.sessionFingerprintsByConnection,
      });
      result = resolution.ok
        ? await callOpenSwanAgent(
            canonicalReq.command,
            resolution.target.compositeAgentId,
            canonicalAgent.name,
            resolution.target.config.endpoint,
            30000,
            canonicalReq.model,
            resolution.target.config.token,
            exactExecution,
          )
        : buildOpenSwanBindingRequiredResult();
    } else {
      result = await callOpenSwanAgent(
        canonicalReq.command,
        canonicalAgent.id,
        canonicalAgent.name,
        resolvedUrl!,
        30000,
        canonicalReq.model,
        authToken,
        exactExecution,
      );
    }

    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }

    const disposition = resolveInvocationDisposition(result);
    if (disposition === 'accepted' || disposition === 'outcome_unknown') {
      let canonicalRunId: string | undefined;
      if (disposition === 'accepted') {
        try {
          const receipt = buildConnectedAgentHandoffReceipt({
            status: 'accepted',
            provider: canonicalAgent.provider || 'connected-agent',
            actor: canonicalAgent.name,
            sessionId: result.sessionId || null,
            providerRunId: result.providerRunId || null,
            runId: null,
            message: result.responseText || `${canonicalAgent.name} accepted the task. Completion has not been verified yet.`,
          });
          const acceptedRun = await recordConnectedAgentAcceptedRun({
            circleId: canonicalReq.circleId,
            userId: canonicalReq.senderId!,
            task: canonicalReq.command,
            surface: 'office_terminal',
            externalDispatchKind: result.externalDispatchKind || null,
            externalConnectionId: result.externalConnectionId || null,
            receipt,
            agentSubjectMetadata: agentSubject.metadata,
          });
          if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
            return buildOfficeInvocationRetiredAfterClaimResult(responseId);
          }
          canonicalRunId = acceptedRun?.id || undefined;
        } catch {
          // The provider already owns the task. A local ledger outage can drop
          // the deep link, but it must never rewrite acceptance as failure.
          console.warn('[agentInvocation] accepted_run_persistence_exception');
        }
      }

      result = {
        ...result,
        completionVerified: false,
        ...(canonicalRunId ? { runId: canonicalRunId } : {}),
      };
      const handoffCopy = result.responseText
        || (disposition === 'accepted'
          ? `${canonicalAgent.name} accepted the task. Completion has not been verified yet.`
          : `${canonicalAgent.name} may have received the task, but dispatch could not be confirmed. It was not replayed; check the external session before retrying.`);

      // `streaming` is the existing durable nonterminal Office response state.
      // Do not call markMessageDone: no typed provider final result exists yet.
      const persisted = await streamResponse(
        responseId,
        handoffCopy,
        'streaming',
        result.tokenCount || 0,
        result.latencyMs,
        result.model,
        result.tokens,
        exactExecution,
      );
      if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
        return buildOfficeInvocationRetiredAfterClaimResult(responseId);
      }
      console.log(disposition === 'accepted'
        ? '[agentInvocation] provider_handoff_accepted'
        : '[agentInvocation] provider_handoff_outcome_unknown');
      if (!persisted) {
        console.warn('[agentInvocation] provider_handoff_tracking_unavailable');
      }

      const handoffTaskId = pendingAgentTasks.get(responseId);
      if (handoffTaskId) {
        pendingAgentTasks.delete(responseId);
        updateAgentTaskHandoff(
          handoffTaskId,
          canonicalAgent.name,
          canonicalReq.command,
          result,
          canonicalReq.messageId,
          exactExecution,
        ).catch(() => {});
      }

      return {
        ...result,
        responseId,
        responseText: handoffCopy,
      };
    }

    if (!result.success) {
      console.error('[agentInvocation] provider_error');
      const providerFailureCopy = getOfficeProviderFailureCopy(result);
      const persisted = exactExecution
        ? await streamResponse(
            responseId,
            providerFailureCopy,
            'error',
            0,
            undefined,
            undefined,
            undefined,
            exactExecution,
          )
        : await streamResponse(
            responseId,
            providerFailureCopy,
            'error',
          );
      if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
        return buildOfficeInvocationRetiredAfterClaimResult(responseId);
      }
      if (persisted) await markMessageDone(canonicalReq.messageId, exactExecution);
      if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
        return buildOfficeInvocationRetiredAfterClaimResult(responseId);
      }
      const failedTaskId = pendingAgentTasks.get(responseId);
      if (failedTaskId) {
        pendingAgentTasks.delete(responseId);
        completeAgentTask(
          failedTaskId,
          canonicalAgent.name,
          canonicalReq.command,
          providerFailureCopy,
          0,
          undefined,
          undefined,
          false,
          canonicalReq.messageId,
          undefined,
          exactExecution,
        ).catch(() => {});
      }
      return {
        success: false,
        responseId,
        error: providerFailureCopy,
      };
    }

    console.log('[agentInvocation] provider_completed');

    // Persist the final response before allowing message completion.
    const updated = await streamResponse(
      responseId,
      result.responseText || '',
      'done',
      result.tokenCount || 0,
      result.latencyMs,
      result.model,
      result.tokens,
      exactExecution,
    );
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }
    if (!updated) {
      const failedTaskId = pendingAgentTasks.get(responseId);
      if (failedTaskId) {
        pendingAgentTasks.delete(responseId);
        completeAgentTask(
          failedTaskId,
          canonicalAgent.name,
          canonicalReq.command,
          OFFICE_PERSISTENCE_FAILURE,
          0,
          undefined,
          undefined,
          false,
          canonicalReq.messageId,
          undefined,
          exactExecution,
        ).catch(() => {});
      }
      return {
        success: false,
        responseId,
        error: OFFICE_PERSISTENCE_FAILURE,
      };
    }

    await markMessageDone(canonicalReq.messageId, exactExecution);
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }
    console.log('[agentInvocation] office_response_completed');

    const completedTaskId = pendingAgentTasks.get(responseId);
    if (completedTaskId) {
      pendingAgentTasks.delete(responseId);
      completeAgentTask(
        completedTaskId,
        canonicalAgent.name,
        canonicalReq.command,
        result.responseText,
        result.tokenCount || 0,
        result.latencyMs,
        result.model,
        true,
        canonicalReq.messageId,
        result.tokens,
        exactExecution,
      ).catch(() => {});
    }

    return {
      success: true,
      responseId,
      responseText: result.responseText,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
    };
  } catch {
    console.error('[agentInvocation] runtime_error');
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }
    const persisted = await streamResponse(
      responseId,
      OFFICE_RUNTIME_FAILURE,
      'error',
      0,
      undefined,
      undefined,
      undefined,
      exactExecution,
    );
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }
    if (persisted) await markMessageDone(canonicalReq.messageId, exactExecution);
    if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
      return buildOfficeInvocationRetiredAfterClaimResult(responseId);
    }

    const failedTaskId = pendingAgentTasks.get(responseId);
    if (failedTaskId) {
      pendingAgentTasks.delete(responseId);
      completeAgentTask(
        failedTaskId,
        canonicalAgent.name,
        canonicalReq.command,
        OFFICE_RUNTIME_FAILURE,
        0,
        undefined,
        undefined,
        false,
        canonicalReq.messageId,
        undefined,
        exactExecution,
      ).catch(() => {});
    }

    return {
      success: false,
      responseId,
      error: OFFICE_RUNTIME_FAILURE,
    };
  }
}

// ─── Multi-Agent: Invoke all agents in parallel ──────────────────────────────

export async function invokeAllAgents(
  req: InvocationRequest,
  agents: CircleOfficeAgent[],
  gatewayUrl?: string,
  authToken?: string,
  officeSessionSnapshot?: OfficeSessionSnapshot,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult[]> {
  if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
    return [buildOfficeInvocationAuthorityUnavailableResult()];
  }
  // Only connected states are dispatchable. `error` is visible diagnostic
  // state, not evidence that a provider can accept work.
  const onlineAgents = agents.filter(a => (
    a.status === 'active' || a.status === 'building' || a.status === 'idle'
  ));

  if (onlineAgents.length === 0) {
    return [{
      success: false,
      error: 'No agents online',
    }];
  }

  // Invoke all in parallel
  const promises = onlineAgents.map(agent =>
    invokeAndStream(
      buildPerAgentInvocationRequest(req, agent),
      agent,
      gatewayUrl,
      authToken,
      officeSessionSnapshot,
      exactExecution,
    )
  );

  return Promise.all(promises);
}

// ─── Multi-Agent: Invoke selected agents in parallel ────────────────────────

export async function invokeSelectedAgents(
  req: InvocationRequest,
  agents: CircleOfficeAgent[],
  targetIds: string[],
  gatewayUrl?: string,
  authToken?: string,
  officeSessionSnapshot?: OfficeSessionSnapshot,
  exactExecution?: OfficeInvocationExactExecution,
): Promise<AgentInvocationResult[]> {
  if (exactExecution && !officeInvocationExecutionIsCurrent(exactExecution)) {
    return [buildOfficeInvocationAuthorityUnavailableResult()];
  }
  // Filter to online agents matching the selected IDs
  const selectedAgents = agents.filter(
    a => (
      a.status === 'active' || a.status === 'building' || a.status === 'idle'
    ) && targetIds.includes(a.id)
  );

  if (selectedAgents.length === 0) {
    return [{
      success: false,
      error: 'No selected agents are online',
    }];
  }

  const promises = selectedAgents.map(agent =>
    invokeAndStream(
      buildPerAgentInvocationRequest(req, agent),
      agent,
      gatewayUrl,
      authToken,
      officeSessionSnapshot,
      exactExecution,
    )
  );

  return Promise.all(promises);
}
