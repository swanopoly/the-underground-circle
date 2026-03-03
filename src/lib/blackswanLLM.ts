/**
 * BlackSwan LLM — Client library for calling local BlackSwan model.
 *
 * Connects to the BlackSwan Bridge (port 7779) which proxies to
 * Ollama or vLLM running the fine-tuned BlackSwan model.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BlackSwanMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BlackSwanOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  timeoutMs?: number;
}

export interface BlackSwanResponse {
  content: string;
  model: string;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  latencyMs: number;
}

export interface BlackSwanHealth {
  status: 'ok' | 'no_backend';
  backend: 'vllm' | 'ollama' | null;
  model: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const BRIDGE_URL = 'http://localhost:7779';
const DEFAULT_TIMEOUT = 30000;
const HEALTH_TIMEOUT = 2000;

// Cache health status for 30 seconds
let healthCache: { status: boolean; checkedAt: number } | null = null;
const HEALTH_CACHE_TTL = 30000;

// ─── Health check ───────────────────────────────────────────────────────────

/**
 * Check if the BlackSwan bridge is running and has a backend.
 * Results are cached for 30 seconds.
 */
export async function isBlackSwanAvailable(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && (now - healthCache.checkedAt) < HEALTH_CACHE_TTL) {
    return healthCache.status;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);

    const response = await fetch(`${BRIDGE_URL}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      healthCache = { status: false, checkedAt: now };
      return false;
    }

    const data: BlackSwanHealth = await response.json();
    const available = data.status === 'ok';
    healthCache = { status: available, checkedAt: now };
    return available;
  } catch {
    healthCache = { status: false, checkedAt: now };
    return false;
  }
}

// ─── Chat completion ────────────────────────────────────────────────────────

/**
 * Call the local BlackSwan LLM via the bridge.
 *
 * Uses OpenAI-compatible /v1/chat/completions format.
 * The bridge handles routing to Ollama or vLLM.
 */
export async function callBlackSwan(
  messages: BlackSwanMessage[],
  options: BlackSwanOptions = {}
): Promise<BlackSwanResponse> {
  const {
    temperature = 0.7,
    maxTokens = 500,
    topP = 0.9,
    timeoutMs = DEFAULT_TIMEOUT,
  } = options;

  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BRIDGE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'blackswan',
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`BlackSwan bridge error: ${response.status} — ${errorText}`);
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content || '';
    const usage = data.usage || {};

    return {
      content,
      model: data.model || 'blackswan',
      tokenUsage: {
        prompt: usage.prompt_tokens || 0,
        completion: usage.completion_tokens || 0,
        total: usage.total_tokens || 0,
      },
      latencyMs,
    };
  } catch (err: any) {
    clearTimeout(timeout);

    if (err.name === 'AbortError') {
      throw new Error(`BlackSwan timeout (${timeoutMs}ms)`);
    }

    throw err;
  }
}

// ─── Convenience: Single-shot chat ──────────────────────────────────────────

/**
 * Quick one-shot call: system prompt + user message → response text.
 * Returns null if BlackSwan is unavailable (caller should fallback).
 */
export async function quickChat(
  systemPrompt: string,
  userMessage: string,
  options?: BlackSwanOptions
): Promise<string | null> {
  try {
    const available = await isBlackSwanAvailable();
    if (!available) return null;

    const result = await callBlackSwan(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      options
    );

    return result.content || null;
  } catch (err) {
    console.warn('[blackswanLLM] quickChat failed:', err);
    return null;
  }
}
