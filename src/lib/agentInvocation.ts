/**
 * Agent Invocation — Phase 3
 * Real agent execution via OpenClaw gateway
 */

import { supabase } from './supabase';
import { CircleOfficeAgent } from './circleOffice';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvocationRequest {
  messageId: string;
  circleId: string;
  command: string;
  targetAgentId?: string;
  targetAgentName: string;
}

export interface AgentInvocationResult {
  success: boolean;
  responseId?: string;
  responseText?: string;
  tokenCount?: number;
  latencyMs?: number;
  error?: string;
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
  latencyMs?: number
): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('stream_response', {
      p_response_id: responseId,
      p_text: text,
      p_status: status,
      p_tokens: tokenCount,
      p_latency_ms: latencyMs ?? null,
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
  gatewayUrl: string = 'http://localhost:18790',
  timeoutMs: number = 30000
): Promise<AgentInvocationResult> {
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${gatewayUrl}/tools/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': agentId,
        },
        body: JSON.stringify({
          tool: 'execute_command',
          params: {
            command,
            agentName,
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
  gatewayUrl: string = 'http://localhost:18790'
): Promise<AgentInvocationResult> {
  // Resolve the actual gateway URL to use:
  // 1. Use agent's stored gatewayUrl if available
  // 2. Fall back to the passed-in gatewayUrl (caller's local)
  const resolvedUrl = agent.gatewayUrl || gatewayUrl;

  // Cross-machine guard: if agent is not ours and not public, fail clearly
  if (!agent.isOwn && !agent.isPublic) {
    return {
      success: false,
      error: `${agent.name} is local-only — they need to set up a public URL to receive cross-machine commands`,
    };
  }

  console.log(`[agentInvocation] Starting: ${agent.name} ← "${req.command}" via ${resolvedUrl}`);

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
    // Step 2: Call agent
    console.log(`[agentInvocation] Invoking gateway: ${resolvedUrl}/tools/invoke`);
    const result = await callOpenClawAgent(
      req.command,
      agent.id,
      agent.name,
      resolvedUrl,
      30000  // 30 second timeout
    );

    if (!result.success) {
      console.error(`[agentInvocation] Agent error: ${result.error}`);
      await streamResponse(responseId, result.error || 'Invocation failed', 'error');
      return result;
    }

    console.log(`[agentInvocation] Agent responded: ${result.tokenCount} tokens, ${result.latencyMs}ms latency`);

    // Step 3: Stream final response
    const updated = await streamResponse(
      responseId,
      result.responseText || '',
      'done',
      result.tokenCount || 0,
      result.latencyMs
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
  gatewayUrl?: string
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
      gatewayUrl
    )
  );

  return Promise.all(promises);
}
