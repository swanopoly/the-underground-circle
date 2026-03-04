/**
 * BlackSwan LLM — Client library for calling local BlackSwan model.
 *
 * Connects to the BlackSwan Bridge (port 7779) which proxies to
 * Ollama or vLLM running the fine-tuned BlackSwan model.
 *
 * Features:
 *  - Blocking + streaming chat completions
 *  - Circle context injection (streak, members, activity)
 *  - Intelligent fallback: local BlackSwan → direct Ollama → cloud
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
  backend: 'blackswan' | 'ollama' | 'cloud';
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

export interface CircleContext {
  circleName?: string;
  userName?: string;
  userStreak?: number;
  memberCount?: number;
  recentActivity?: string;
  date?: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const BRIDGE_URL   = 'http://localhost:7779';
const OLLAMA_URL   = 'http://localhost:11434';
const DEFAULT_TIMEOUT  = 30_000;
const HEALTH_TIMEOUT   = 2_000;
const HEALTH_CACHE_TTL = 30_000;

let healthCache: { status: boolean; checkedAt: number } | null = null;

// ─── Health ─────────────────────────────────────────────────────────────────

export async function isBlackSwanAvailable(): Promise<boolean> {
  const now = Date.now();
  if (healthCache && now - healthCache.checkedAt < HEALTH_CACHE_TTL) {
    return healthCache.status;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT);
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: ctrl.signal });
    clearTimeout(t);
    const data: BlackSwanHealth = await res.json();
    const ok = res.ok && data.status === 'ok';
    healthCache = { status: ok, checkedAt: now };
    return ok;
  } catch {
    healthCache = { status: false, checkedAt: now };
    return false;
  }
}

/** Force-refresh health cache */
export function invalidateHealthCache(): void {
  healthCache = null;
}

// ─── Circle context prompt ───────────────────────────────────────────────────

export function buildCircleSystemPrompt(ctx: CircleContext = {}): string {
  const {
    circleName = 'The Underground Circle',
    userName = 'a member',
    userStreak = 0,
    memberCount = 0,
    recentActivity,
    date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
  } = ctx;

  const streakLine = userStreak > 0
    ? `${userName} is on a ${userStreak}-day streak.`
    : `${userName} has not started a streak yet.`;

  const memberLine = memberCount > 0
    ? `The circle has ${memberCount} member${memberCount !== 1 ? 's' : ''}.`
    : '';

  const activityLine = recentActivity
    ? `\n\nRecent circle activity:\n${recentActivity}`
    : '';

  return `You are BlackSwan — an AI accountability partner embedded in ${circleName}, a productivity and accountability app for serious builders.

## Today
${date}

## Circle Context
${streakLine} ${memberLine}${activityLine}

## Personality
- Quiet confidence — knowledgeable but never arrogant
- Direct. No fluff, no corporate speak, no filler
- Warm but never soft — real feedback when it is needed
- Dry wit when it fits. Never trying too hard
- Short responses for casual chat, structured for real guidance
- You NEVER say "I am just an AI" — you are BlackSwan, full stop

## Knowledge
- Productivity, accountability, goal-setting, human performance
- Help people think clearly: planning, prioritizing, working through blockers
- Practical and specific advice — not generic motivational noise
- Design, code architecture, business strategy — all on the table`;
}

// ─── Blocking chat ───────────────────────────────────────────────────────────

export async function callBlackSwan(
  messages: BlackSwanMessage[],
  options: BlackSwanOptions = {},
): Promise<BlackSwanResponse> {
  const {
    temperature = 0.7,
    maxTokens = 512,
    topP = 0.9,
    timeoutMs = DEFAULT_TIMEOUT,
  } = options;

  const start = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${BRIDGE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'blackswan',
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BlackSwan bridge error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const usage = data.usage ?? {};

    return {
      content: data.choices?.[0]?.message?.content ?? '',
      model: data.model ?? 'blackswan',
      backend: 'blackswan',
      tokenUsage: {
        prompt:     usage.prompt_tokens     ?? 0,
        completion: usage.completion_tokens ?? 0,
        total:      usage.total_tokens      ?? 0,
      },
      latencyMs: Date.now() - start,
    };
  } catch (err: unknown) {
    clearTimeout(t);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`BlackSwan timeout (${timeoutMs}ms)`);
    }
    throw err;
  }
}

// ─── Streaming chat ──────────────────────────────────────────────────────────

/**
 * Stream tokens from BlackSwan as they are generated.
 *
 * @param messages     Chat history
 * @param options      Generation options + optional abort signal
 * @param onToken      Called for each text token chunk
 * @param onDone       Called when stream ends (with final full text)
 */
export async function callBlackSwanStream(
  messages: BlackSwanMessage[],
  options: BlackSwanOptions & { signal?: AbortSignal } = {},
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
): Promise<void> {
  const {
    temperature = 0.7,
    maxTokens = 512,
    topP = 0.9,
    timeoutMs = DEFAULT_TIMEOUT,
    signal: externalSignal,
  } = options;

  const ctrl = new AbortController();
  const combinedSignal = externalSignal
    ? (() => {
        // Abort our controller if either signal fires
        externalSignal.addEventListener('abort', () => ctrl.abort());
        return ctrl.signal;
      })()
    : ctrl.signal;

  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${BRIDGE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'blackswan',
        messages,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
        stream: true,
      }),
      signal: combinedSignal,
    });
    clearTimeout(t);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BlackSwan stream error ${res.status}: ${text}`);
    }

    if (!res.body) throw new Error('BlackSwan: no response body');

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText  = '';
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data:')) continue;

        try {
          const json = JSON.parse(trimmed.slice(5).trim());
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            onToken(delta);
          }
        } catch {
          // Malformed chunk — skip
        }
      }
    }

    onDone(fullText);
  } catch (err: unknown) {
    clearTimeout(t);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`BlackSwan stream aborted`);
    }
    throw err;
  }
}

// ─── Fallback chain ──────────────────────────────────────────────────────────

/**
 * Try local BlackSwan first; if unavailable fall back to direct Ollama,
 * then give up and signal the caller to use cloud.
 *
 * Returns {content, backend} so callers can show which backend answered.
 */
export async function callWithFallback(
  messages: BlackSwanMessage[],
  options: BlackSwanOptions = {},
): Promise<{ content: string; backend: 'blackswan' | 'ollama' | 'cloud' }> {
  // 1. Try bridge
  const available = await isBlackSwanAvailable();
  if (available) {
    try {
      const res = await callBlackSwan(messages, options);
      return { content: res.content, backend: 'blackswan' };
    } catch (err) {
      console.warn('[blackswanLLM] bridge failed, trying direct Ollama:', err);
      invalidateHealthCache();
    }
  }

  // 2. Try direct Ollama (no bridge, native API)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT);
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'blackswan',
        messages: messages.map(m => ({ role: m.role, content: m.content })),
        stream: false,
        options: {
          temperature: options.temperature ?? 0.7,
          num_predict: options.maxTokens  ?? 512,
          top_p:       options.topP       ?? 0.9,
        },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json();
      const content: string = data.message?.content ?? '';
      if (content) return { content, backend: 'ollama' };
    }
  } catch (err) {
    console.warn('[blackswanLLM] direct Ollama failed:', err);
  }

  // 3. Signal caller to use cloud
  return { content: '', backend: 'cloud' };
}

// ─── Convenience: Single-shot quick chat ────────────────────────────────────

export async function quickChat(
  systemPrompt: string,
  userMessage: string,
  options?: BlackSwanOptions,
): Promise<string | null> {
  try {
    const { content, backend } = await callWithFallback(
      [
        { role: 'system',    content: systemPrompt },
        { role: 'user',      content: userMessage  },
      ],
      options,
    );
    if (backend === 'cloud' || !content) return null;
    return content;
  } catch (err) {
    console.warn('[blackswanLLM] quickChat error:', err);
    return null;
  }
}
