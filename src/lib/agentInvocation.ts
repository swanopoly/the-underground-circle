/**
 * Agent Invocation — Phase 3
 * Real agent execution via OpenClaw gateway
 */

import { supabase } from './supabase';
import { CircleOfficeAgent, BLACKSWAN_AGENT_ID } from './circleOffice';
import { loadBudgetConfig, checkHardLimit } from './budgetAlerts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvocationRequest {
  messageId: string;
  circleId: string;
  command: string;
  senderId?: string;
  targetAgentId?: string;
  targetAgentName: string;
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

// ─── DB: Create response row (atomic) ───────────────────────────────────────

export async function invokeAgent(
  messageId: string,
  agentId: string,
  agentName: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('invoke_agent', {
      p_message_id: messageId,
      p_agent_id: agentId,
      p_agent_name: agentName,
    });

    if (error) {
      console.error('[agentInvocation] invoke_agent RPC failed:', error);
      return null;
    }

    return data as string;
  } catch (err) {
    console.error('[agentInvocation] invokeAgent error:', err);
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
    const { error } = await supabase.rpc('stream_response', {
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

    if (error) {
      console.error('[agentInvocation] stream_response failed:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[agentInvocation] streamResponse error:', err);
    return false;
  }
}

// ─── DB: Mark message complete ──────────────────────────────────────────────

export async function markMessageDone(messageId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('mark_message_done', {
      p_message_id: messageId,
    });

    if (error) {
      console.error('[agentInvocation] mark_message_done failed:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[agentInvocation] markMessageDone error:', err);
    return false;
  }
}

// ─── BlackSwan: Invoke via swanbot-ai edge function ─────────────────────────

function isBlackSwanAgent(agent: CircleOfficeAgent): boolean {
  return agent.provider === 'blackswan' || agent.id === BLACKSWAN_AGENT_ID;
}

async function invokeBlackSwan(
  command: string,
  circleId: string,
  senderId: string,
  model?: string | null,
): Promise<AgentInvocationResult> {
  const start = Date.now();

  try {
    const { data, error } = await supabase.functions.invoke('swanbot-ai', {
      body: { message: command, circleId, userId: senderId, model: model || null },
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

// ─── Claude Code: Invoke via local bridge POST /exec ────────────────────────

function isClaudeCodeAgent(agent: CircleOfficeAgent): boolean {
  return agent.provider === 'claude-code';
}

async function invokeClaudeCode(
  command: string,
  bridgeUrl: string = 'http://localhost:7778',
): Promise<AgentInvocationResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);

    const response = await fetch(`${bridgeUrl}/exec`, {
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
        error: `Claude Code bridge error: HTTP ${response.status}`,
      };
    }

    const data = await response.json();

    if (!data.ok) {
      return {
        success: false,
        error: data.error || `Command failed with exit code ${data.code}`,
      };
    }

    const responseText = (data.stdout || '').trim()
      || (data.stderr || '').trim()
      || 'Command executed (no output)';

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

// ─── OpenClaw Gateway: Invoke Agent ─────────────────────────────────────────

/**
 * Call the OpenClaw agent via gateway with timeout.
 * Gateway endpoint: http://localhost:18790/tools/invoke
 * 
 * Returns: { response: string, tokenCount: number, latencyMs: number }
 */
export async function callOpenClawAgent(
  command: string,
  agentId: string,
  agentName: string,
  gatewayUrl: string,
  timeoutMs: number = 30000,
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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': agentId,
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool: 'execute_command',
          params: {
            command,
            agentName,
            model: model || undefined,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - start;

      if (!response.ok) {
        return {
          success: false,
          error: `Gateway error: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json();
      const responseText = data.result || data.response || 'Agent executed successfully';

      // Extract token count from response headers or body
      const tokenCount = data.tokenCount
        || data.tokens
        || parseInt(response.headers.get('x-token-count') || '0')
        || estimateTokens(command, responseText);

      return {
        success: true,
        responseText,
        tokenCount,
        latencyMs,
      };
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      
      // Timeout error
      if (fetchErr.name === 'AbortError') {
        return {
          success: false,
          error: `Agent timeout (${timeoutMs}ms) — no response from gateway`,
        };
      }

      throw fetchErr;
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Agent invocation failed',
    };
  }
}

// ─── Fallback: Estimate tokens (until real tokens come from agent) ────────

function estimateTokens(command: string, response: string): number {
  // Rough estimate: ~1.3 tokens per word
  const totalChars = command.length + response.length;
  return Math.ceil(totalChars / 4);
}

// ─── Invoke & Stream: Main entry point ──────────────────────────────────────

/**
 * Orchestrate the full invocation:
 * 1. Create response row (atomic)
 * 2. Call agent via gateway
 * 3. Stream updates in realtime
 * 4. Mark complete
 */
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
  } catch (e) {
    console.warn('[agentInvocation] Budget check failed, proceeding:', e);
  }

  // Detect agent type for routing
  const blackSwan = isBlackSwanAgent(agent);
  const claudeCode = isClaudeCodeAgent(agent);

  // Resolve the actual gateway URL to use:
  // 1. Use agent's stored gatewayUrl if available
  // 2. Fall back to the passed-in gatewayUrl (caller's local)
  // Resolve gateway URL: agent's stored URL > caller's URL > fail
  const resolvedUrl = agent.gatewayUrl || gatewayUrl;
  if (!resolvedUrl && !blackSwan && !claudeCode) {
    return {
      success: false,
      error: `No gateway URL for ${agent.name} — configure one in ⚙️ → Connections`,
    };
  }

  // Cross-machine guard: if agent is not ours and not public, fail clearly
  // BlackSwan is always public (server-side edge function)
  // Claude Code is local-only but invoked by its owner
  if (!blackSwan && !claudeCode && !agent.isOwn && !agent.isPublic) {
    return {
      success: false,
      error: `${agent.name} is local-only — they need to set up a public URL to receive cross-machine commands`,
    };
  }

  const via = blackSwan ? 'swanbot-ai' : claudeCode ? `bridge:${resolvedUrl}` : resolvedUrl;
  console.log(`[agentInvocation] Starting: ${agent.name} ← "${req.command}" via ${via}`);

  // Step 1: Create response row
  const responseId = await invokeAgent(req.messageId, agent.id, agent.name);
  if (!responseId) {
    console.error(`[agentInvocation] Failed to create response row for ${agent.name}`);
    return {
      success: false,
      error: 'Failed to create response row',
    };
  }

  console.log(`[agentInvocation] Response row created: ${responseId}`);

  try {
    // Step 1b: Resolve prompt if referenced
    let promptVersionId: string | undefined;
    if (req.promptName) {
      try {
        const { getPrompt } = await import('./promptManager');
        const compiled = await getPrompt(req.promptName, req.promptLabel || 'production', {}, req.circleId);
        if (compiled) {
          promptVersionId = compiled.versionId;
          console.log(`[agentInvocation] Resolved prompt: ${req.promptName} v${compiled.version} (${compiled.label})`);
        }
      } catch (e) {
        console.warn('[agentInvocation] Prompt resolution failed:', e);
      }
    }

    // Step 2: Call agent (route by provider type)
    let result: AgentInvocationResult;

    if (blackSwan) {
      if (req.model === 'gemini-flash') {
        // Gemini selected — use client-side Gemini path (edge fn only has Anthropic key)
        console.log(`[agentInvocation] Invoking Gemini client-side for BlackSwan`);
        const geminiStart = Date.now();
        try {
          const { getSwanBotResponse } = await import('./swanbot');
          const geminiResult = await getSwanBotResponse(req.command, {
            userId: req.senderId || req.messageId,
            circleId: req.circleId,
          });
          result = {
            success: true,
            responseText: geminiResult,
            tokenCount: estimateTokens(req.command, geminiResult),
            latencyMs: Date.now() - geminiStart,
          };
        } catch (err: any) {
          result = { success: false, error: `Gemini fallback failed: ${err.message}` };
        }
      } else {
        console.log(`[agentInvocation] Invoking BlackSwan via swanbot-ai edge function (model: ${req.model || 'auto'})`);
        result = await invokeBlackSwan(req.command, req.circleId, req.senderId || req.messageId, req.model);
      }
    } else if (claudeCode) {
      console.log(`[agentInvocation] Invoking Claude Code via bridge: ${resolvedUrl}/exec`);
      result = await invokeClaudeCode(req.command, resolvedUrl);
    } else {
      console.log(`[agentInvocation] Invoking gateway: ${resolvedUrl}/tools/invoke`);
      result = await callOpenClawAgent(
        req.command,
        agent.id,
        agent.name,
        resolvedUrl!,
        30000,  // 30 second timeout
        req.model,
        authToken
      );
    }

    if (!result.success) {
      console.error(`[agentInvocation] Agent error: ${result.error}`);
      await streamResponse(responseId, result.error || 'Invocation failed', 'error');
      return result;
    }

    console.log(`[agentInvocation] Agent responded: ${result.tokenCount} tokens, ${result.latencyMs}ms latency`);

    // Step 3: Stream final response with token breakdown
    const updated = await streamResponse(
      responseId,
      result.responseText || '',
      'done',
      result.tokenCount || 0,
      result.latencyMs,
      result.model,
      result.tokens
    );

    // Step 4: Mark message complete
    await markMessageDone(req.messageId);
    console.log(`[agentInvocation] Complete: ${agent.name}`);

    return {
      success: true,
      responseId,
      responseText: result.responseText,
      tokenCount: result.tokenCount,
      latencyMs: result.latencyMs,
    };
  } catch (err: any) {
    console.error(`[agentInvocation] Exception: ${err.message}`);
    await streamResponse(responseId, `Error: ${err.message}`, 'error');
    return {
      success: false,
      error: err.message,
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
      {
        ...req,
        targetAgentId: agent.id,
        targetAgentName: `@${agent.name}`,
      },
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
      {
        ...req,
        targetAgentId: agent.id,
        targetAgentName: `@${agent.name}`,
      },
      agent,
      gatewayUrl,
      authToken
    )
  );

  return Promise.all(promises);
}
