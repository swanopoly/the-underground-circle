/**
 * Agent Invocation — Phase 3
 * Real agent execution via OpenSwan gateway
 */

import { supabase } from './supabase';
import { CircleOfficeAgent, BLACKSWAN_AGENT_ID } from './circleOffice';
import { loadBudgetConfig, checkHardLimit } from './budgetAlerts';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';
import {
  buildAgentRuntimeSubject,
  isUuidLike,
  type AgentRuntimeSubject,
  type AgentRuntimeSubjectMetadata,
} from './agentRuntimeSubject';
import { fetchBridgeAuthenticated } from './bridgeAuth';

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
  responseId?: string;
  responseText?: string;
  tokenCount?: number;
  latencyMs?: number;
  error?: string;
  model?: string;
  tokens?: TokenBreakdown;
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
}

// ─── DB: Create response row (atomic) ───────────────────────────────────────

export async function invokeAgent(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
): Promise<OfficeInvocationClaim | null> {
  try {
    const blackSwan = isBlackSwanAgent(agent);
    const durableAgentId = !blackSwan && isUuidLike(agent.id) ? agent.id : null;
    if (!blackSwan && !durableAgentId) return null;

    const { data, error } = await supabase.rpc('invoke_agent', {
      p_message_id: req.messageId,
      p_circle_id: req.circleId,
      p_expected_command_text: req.command,
      p_agent_id: durableAgentId,
    });

    if (error) {
      console.error('[agentInvocation] office_claim_failed');
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
      || (!blackSwan && canonicalAgentId !== durableAgentId)
      || (blackSwan && canonicalAgentId !== null)
      || agentSubjectKey !== (
        blackSwan ? 'blackswan' : `office-agent:${durableAgentId}`
      )
      || !agentName
      || !targetAgentName
      || (rawTargetAgentIds !== null && targetAgentIds?.length !== rawTargetAgentIds.length)
      || !canonicalScopeMatches
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
  tokens?: TokenBreakdown
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('stream_response', {
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

    if (error || data !== true) {
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

export async function markMessageDone(messageId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('mark_message_done', {
      p_message_id: messageId,
    });

    if (error) {
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
    });

    const latencyMs = Date.now() - start;

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
): Promise<AgentInvocationResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    const response = await fetchBridgeAuthenticated(`${bridgeUrl}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: command, useWorktree: false }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        success: false,
        error: `Claude Code bridge error: HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    if (!data.ok) {
      return {
        success: false,
        error: data.error || data.message || 'Claude Code task could not be started',
      };
    }

    const spawned = Array.isArray(data.results) ? data.results.find((item: any) => item?.ok) : null;
    const responseText = spawned?.spawnId
      ? `Claude Code task started (handle ${spawned.spawnId}).`
      : (data.message || 'Claude Code task started.');

    const tokenCount = estimateTokens(command, responseText);

    return {
      success: true,
      responseText,
      tokenCount,
      latencyMs,
    };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Claude Code bridge command timed out (35s)',
      };
    }
    return {
      success: false,
      error: err.message || 'Claude Code bridge not reachable',
    };
  }
}

// ─── Gemini CLI: Invoke via local bridge ──────────────────────────────────────

async function invokeGeminiCli(
  command: string,
  bridgeUrl: string = 'http://localhost:7780',
): Promise<AgentInvocationResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    const response = await fetchBridgeAuthenticated(`${bridgeUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        success: false,
        error: `Gemini CLI bridge error: HTTP ${response.status}`,
      };
    }

    const data = await response.json();

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
      model: data.model || 'gemini-2.5-pro',
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
  }
}

// ─── BYO LLM: Invoke via llm-proxy edge function ────────────────────────────

const BYO_LLM_PROVIDERS = ['openai', 'anthropic', 'openrouter', 'groq', 'ollama', 'github-models', 'huggingface', 'zai', 'minimax'];

function isBYOLLMAgent(agent: CircleOfficeAgent): boolean {
  return BYO_LLM_PROVIDERS.includes(agent.provider);
}

/**
 * Parse a BYO model key like "openai/gpt-4o" into provider + model.
 * Falls back to the agent's provider if no prefix found.
 */
function parseBYOModel(modelKey: string | null | undefined, agentProvider: string): { provider: string; model: string; thinkingLevel?: string } {
  // Strip thinking level suffix (e.g. "openai/gpt-4o::deep" → thinkingLevel = "deep")
  let thinkingLevel: string | undefined;
  let cleanKey = modelKey;
  if (cleanKey && cleanKey.includes('::')) {
    const [base, level] = cleanKey.split('::');
    cleanKey = base;
    if (['fast', 'balanced', 'deep'].includes(level)) thinkingLevel = level;
  }

  if (!cleanKey) {
    const defaults: Record<string, string> = {
      openai: 'gpt-4o',
      anthropic: 'claude-sonnet-4-6',
      openrouter: 'anthropic/claude-sonnet-4-6',
      groq: 'llama-3.3-70b-versatile',
      ollama: 'blackswan',
      'github-models': 'gpt-4o-mini',
      huggingface: 'Qwen/Qwen3-32B',
      zai: 'glm-5',
      minimax: 'MiniMax-M1',
    };
    return { provider: agentProvider, model: defaults[agentProvider] || 'gpt-4o', thinkingLevel };
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
): Promise<AgentInvocationResult> {
  const start = Date.now();
  const { provider, model: resolvedModel, thinkingLevel } = parseBYOModel(model, agentProvider);
  if (shouldBlockExternalAiProvider(provider)) {
    return { success: false, error: getStrictLocalAiModeMessage(provider) };
  }

  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        provider,
        model: resolvedModel,
        messages: [{ role: 'user', content: command }],
        circleId,
        userId: senderId,
        ...(thinkingLevel && thinkingLevel !== 'balanced' ? { thinkingLevel } : {}),
      },
    });

    const latencyMs = Date.now() - start;

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

/**
 * Call the OpenSwan agent via gateway using sessions_send + response polling.
 *
 * Flow:
 * 1. Snapshot the last message timestamp from sessions_history
 * 2. Send the command via sessions_send
 * 3. Poll sessions_history for a new assistant response
 * 4. Return the response text
 */
export async function callOpenSwanAgent(
  command: string,
  agentId: string,
  agentName: string,
  gatewayUrl: string,
  timeoutMs: number = 60000,
  model?: string | null,
  authToken?: string
): Promise<AgentInvocationResult> {
  if (!gatewayUrl) {
    return {
      success: false,
      error: 'No gateway URL configured — add a connection in ⚙️ → Connections',
    };
  }

  const start = Date.now();

  // Extract session key from the agent ID (format: "connectionId::sessionKey")
  // Fall back to "agent:main:main" if we can't parse it
  let sessionKey = 'agent:main:main';
  if (agentId.includes('::')) {
    const parts = agentId.split('::');
    if (parts.length >= 2 && parts[1].startsWith('agent:')) {
      sessionKey = parts.slice(1).join('::');
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  async function invokeGatewayTool(tool: string, args: Record<string, any>): Promise<any> {
    const res = await fetch(`${gatewayUrl}/tools/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, args }),
    });
    if (!res.ok) throw new Error(`Gateway HTTP ${res.status}`);
    return res.json();
  }

  try {
    // Step 1: Snapshot the last assistant message timestamp
    let lastAssistantTimestamp = 0;
    try {
      const histBefore = await invokeGatewayTool('sessions_history', {
        sessionKey,
        limit: 3,
      });
      const msgs = histBefore?.result?.details?.messages || [];
      for (const m of msgs) {
        if (m.role === 'assistant' && m.timestamp) {
          lastAssistantTimestamp = Math.max(lastAssistantTimestamp, m.timestamp);
        }
      }
    } catch {
      // OK — we'll just look for any response
    }

    // Step 2: Send the command via sessions_send
    const sendResult = await invokeGatewayTool('sessions_send', {
      sessionKey,
      message: command,
    });

    if (!sendResult?.ok) {
      return {
        success: false,
        error: `Failed to send message to OpenSwan: ${sendResult?.error?.message || 'unknown error'}`,
      };
    }

    // Step 3: Poll sessions_history for a new assistant response.
    // Adaptive interval: start at 400ms so fast responses return quickly, then
    // ramp to 2s so we don't hammer the gateway for long-running agent turns.
    // Old loop had a fixed 2s wait before the first check, which meant even
    // instant completions felt sluggish — this shortens perceived latency by
    // up to ~1.6s on the common case while keeping total load comparable.
    const deadline = start + timeoutMs;
    let pollDelay = 400;
    const POLL_DELAY_MAX = 2000;

    // Early-exit after N consecutive sessions_history failures. Previously
    // poll errors were silently swallowed and the loop kept spinning to the
    // full `timeoutMs` (default 60 s) — which blocks the UI for the full
    // deadline when the gateway is dead. Hermes-style bounded retries: if
    // three back-to-back polls fail, surface the error instead of waiting.
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_POLL_FAILURES = 3;
    let lastPollError: string | null = null;

    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollDelay));
      // Ramp interval toward the max so we aren't polling at 400ms forever.
      pollDelay = Math.min(POLL_DELAY_MAX, Math.round(pollDelay * 1.5));

      try {
        const histAfter = await invokeGatewayTool('sessions_history', {
          sessionKey,
          limit: 3,
        });

        // Reset the failure counter on any successful call — a transient
        // hiccup shouldn't count against a gateway that just recovered.
        consecutiveFailures = 0;
        lastPollError = null;

        const msgs = histAfter?.result?.details?.messages || [];

        // Look for a new assistant message with text content
        for (const m of msgs) {
          if (m.role !== 'assistant') continue;
          if (m.timestamp && m.timestamp <= lastAssistantTimestamp) continue;
          if (m.stopReason === 'error') continue;

          // Extract text from content array
          const content = m.content;
          let text = '';
          if (typeof content === 'string') {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text)
              .join('');
          }

          if (text) {
            const latencyMs = Date.now() - start;
            return {
              success: true,
              responseText: text,
              tokenCount: estimateTokens(command, text),
              latencyMs,
              model: m.model || model || undefined,
            };
          }
        }
      } catch (err: any) {
        consecutiveFailures++;
        lastPollError = err?.message || String(err);
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          return {
            success: false,
            error:
              `OpenSwan gateway unreachable — ${consecutiveFailures} consecutive ` +
              `sessions_history failures. Last error: ${lastPollError || 'unknown'}`,
          };
        }
        // Otherwise keep trying — transient network blips recover quickly.
      }
    }

    return {
      success: false,
      error: `OpenSwan agent did not respond within ${Math.round(timeoutMs / 1000)}s`,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'OpenSwan invocation failed',
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
): Promise<string | null> {
  try {
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

    const { data, error } = await supabase
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

    if (error) {
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
): Promise<void> {
  try {
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

    await supabase
      .from('tasks')
      .update({
        description,
        status: success ? 'done' : 'review',
        completed_at: success ? new Date().toISOString() : null,
      })
      .eq('id', taskId);
  } catch {}
}

// Module-level map: responseId → taskId. A message can fan out to several
// agents, so messageId alone would let parallel completions steal each other's
// tracking task.
const pendingAgentTasks = new Map<string, string>();
const OFFICE_PROVIDER_FAILURE = 'Agent invocation failed (provider_error).';
const OFFICE_RUNTIME_FAILURE = 'Agent invocation failed (runtime_error).';
const OFFICE_PERSISTENCE_FAILURE = 'Agent response could not be persisted safely.';

// ─── Invoke & Stream: Main entry point ──────────────────────────────────────

/**
 * Orchestrate the full invocation:
 * 1. Create response row (atomic)
 * 2. Call agent via gateway
 * 3. Stream updates in realtime
 * 4. Mark complete
 */
// --- Direct Invoke: Shared routing without terminal rows -------------------

export async function invokeDirect(
  req: InvocationRequest,
  agent: CircleOfficeAgent,
  gatewayUrl?: string,
  authToken?: string
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
  const agentSubject = buildInvocationAgentSubject(agent, req);
  const swanBotContext = buildInvocationSwanBotContext(agentSubject);

  const resolvedUrl = agent.gatewayUrl || gatewayUrl;
  if (!resolvedUrl && !blackSwan && !claudeCode && !geminiCli && !byoLLM) {
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
  authToken?: string
): Promise<AgentInvocationResult> {
  // Check hard spending limits before invoking
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
    console.warn('[agentInvocation] budget_check_unavailable');
  }

  // Detect agent type for routing
  const blackSwan = isBlackSwanAgent(agent);
  const claudeCode = isClaudeCodeAgent(agent);
  const geminiCli = isGeminiCliAgent(agent);
  const byoLLM = isBYOLLMAgent(agent);

  // Resolve the actual gateway URL to use:
  // 1. Use agent's stored gatewayUrl if available
  // 2. Fall back to the passed-in gatewayUrl (caller's local)
  // Resolve gateway URL: agent's stored URL > caller's URL > fail
  const resolvedUrl = agent.gatewayUrl || gatewayUrl;
  if (!resolvedUrl && !blackSwan && !claudeCode && !geminiCli && !byoLLM) {
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
  const claim = await invokeAgent(req, agent);
  if (!claim) {
    console.error('[agentInvocation] office_claim_unavailable');
    return {
      success: false,
      error: 'Office invocation could not be claimed safely.',
    };
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
  );
  if (taskId) pendingAgentTasks.set(responseId, taskId);

  try {
    // Call the selected provider with canonical durable inputs.
    let result: AgentInvocationResult;

    if (blackSwan) {
      if (canonicalReq.model === 'gemini-flash') {
        // Gemini selected — use client-side Gemini path (edge fn only has Anthropic key)
        console.log('[agentInvocation] provider_route_gemini_client');
        const geminiStart = Date.now();
        try {
          const { getSwanBotResponse } = await import('./swanbot');
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
        );
      }
    } else if (claudeCode) {
      console.log('[agentInvocation] provider_route_claude_code');
      result = await invokeClaudeCode(canonicalReq.command, resolvedUrl);
    } else if (geminiCli) {
      const geminiUrl = resolvedUrl || 'http://localhost:7780';
      console.log('[agentInvocation] provider_route_gemini_cli');
      result = await invokeGeminiCli(canonicalReq.command, geminiUrl);
    } else if (byoLLM) {
      console.log('[agentInvocation] provider_route_byo_llm');
      result = await invokeBYOLLM(
        canonicalReq.command,
        canonicalAgent.provider,
        canonicalReq.model,
        canonicalReq.circleId,
        canonicalReq.senderId,
      );
    } else {
      console.log('[agentInvocation] provider_route_openswan_gateway');
      result = await callOpenSwanAgent(
        canonicalReq.command,
        canonicalAgent.id,
        canonicalAgent.name,
        resolvedUrl!,
        30000,
        canonicalReq.model,
        authToken
      );
    }

    if (!result.success) {
      console.error('[agentInvocation] provider_error');
      const persisted = await streamResponse(
        responseId,
        OFFICE_PROVIDER_FAILURE,
        'error',
      );
      if (persisted) await markMessageDone(canonicalReq.messageId);
      const failedTaskId = pendingAgentTasks.get(responseId);
      if (failedTaskId) {
        pendingAgentTasks.delete(responseId);
        completeAgentTask(
          failedTaskId,
          canonicalAgent.name,
          canonicalReq.command,
          OFFICE_PROVIDER_FAILURE,
          0,
          undefined,
          undefined,
          false,
          canonicalReq.messageId,
        ).catch(() => {});
      }
      return {
        success: false,
        responseId,
        error: OFFICE_PROVIDER_FAILURE,
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
      result.tokens
    );
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
        ).catch(() => {});
      }
      return {
        success: false,
        responseId,
        error: OFFICE_PERSISTENCE_FAILURE,
      };
    }

    await markMessageDone(canonicalReq.messageId);
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
    const persisted = await streamResponse(
      responseId,
      OFFICE_RUNTIME_FAILURE,
      'error',
    );
    if (persisted) await markMessageDone(canonicalReq.messageId);

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
  authToken?: string
): Promise<AgentInvocationResult[]> {
  // Filter to online agents only
  const onlineAgents = agents.filter(a => a.status !== 'offline');

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
      authToken
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
  authToken?: string
): Promise<AgentInvocationResult[]> {
  // Filter to online agents matching the selected IDs
  const selectedAgents = agents.filter(
    a => a.status !== 'offline' && targetIds.includes(a.id)
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
      authToken
    )
  );

  return Promise.all(promises);
}
