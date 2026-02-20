// OpenClaw Gateway API client for the Office Dashboard
// Connects to a user's OpenClaw instance to get real agent data

export interface OpenClawConfig {
  endpoint: string;  // e.g. http://localhost:18789
  token: string;     // gateway auth token
}

export interface OpenClawSession {
  sessionKey: string;
  kind: string;
  agentId?: string;
  model?: string;
  lastActivity?: string;
  messageCount?: number;
  lastMessages?: Array<{ role: string; content: string; timestamp?: string }>;
}

export interface OpenClawSessionStatus {
  sessionKey: string;
  model?: string;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  totalCost?: number;
  turns?: number;
  uptime?: string;
}

export interface OpenClawToolResult {
  ok: boolean;
  result?: any;
  error?: { type: string; message: string };
}

// ─── Low-level API ────────────────────────────────────

async function invokeToolRaw(
  config: OpenClawConfig,
  tool: string,
  args: Record<string, any> = {},
): Promise<OpenClawToolResult> {
  const res = await fetch(`${config.endpoint}/tools/invoke`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tool, args }),
  });
  return res.json();
}

async function chatCompletion(
  config: OpenClawConfig,
  message: string,
  agentId = 'main',
  sessionKey?: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': agentId,
    };
    if (sessionKey) headers['x-openclaw-session-key'] = sessionKey;

    const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: `openclaw:${agentId}`,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || '';
    return { ok: true, reply };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── High-level API ────────────────────────────────────

export async function testConnection(config: OpenClawConfig): Promise<{
  ok: boolean;
  error?: string;
  sessions?: OpenClawSession[];
}> {
  try {
    const result = await invokeToolRaw(config, 'sessions_list', {
      limit: 20,
      messageLimit: 1,
    });
    if (!result.ok) {
      return { ok: false, error: result.error?.message || 'Failed to connect' };
    }
    // Parse sessions from result
    const sessions = parseSessionsList(result.result);
    return { ok: true, sessions };
  } catch (e: any) {
    return { ok: false, error: e.message || 'Network error' };
  }
}

export async function listSessions(config: OpenClawConfig): Promise<{
  ok: boolean;
  sessions?: OpenClawSession[];
  error?: string;
}> {
  try {
    const result = await invokeToolRaw(config, 'sessions_list', {
      limit: 30,
      messageLimit: 3,
    });
    if (!result.ok) return { ok: false, error: result.error?.message };
    return { ok: true, sessions: parseSessionsList(result.result) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getSessionStatus(
  config: OpenClawConfig,
  sessionKey: string,
): Promise<{ ok: boolean; status?: OpenClawSessionStatus; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'session_status', { sessionKey });
    if (!result.ok) return { ok: false, error: result.error?.message };
    return { ok: true, status: parseSessionStatus(result.result, sessionKey) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getSessionHistory(
  config: OpenClawConfig,
  sessionKey: string,
  limit = 10,
): Promise<{ ok: boolean; messages?: Array<{ role: string; content: string }>; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'sessions_history', {
      sessionKey,
      limit,
      includeTools: false,
    });
    if (!result.ok) return { ok: false, error: result.error?.message };
    return { ok: true, messages: parseHistory(result.result) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendMessageToSession(
  config: OpenClawConfig,
  sessionKey: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'sessions_send', {
      sessionKey,
      message,
    });
    // sessions_send may be on the deny list for HTTP, fall back to chat completions
    if (!result.ok) {
      // Try chat completions as fallback
      const chatResult = await chatCompletion(config, message, 'main', sessionKey);
      return chatResult;
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendAgentTask(
  config: OpenClawConfig,
  task: string,
  agentId = 'main',
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  return chatCompletion(config, task, agentId);
}

export async function listAgents(
  config: OpenClawConfig,
): Promise<{ ok: boolean; agents?: string[]; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'agents_list', {});
    if (!result.ok) return { ok: false, error: result.error?.message };
    // Result is typically an array of agent ids
    const agents = Array.isArray(result.result) ? result.result : [];
    return { ok: true, agents };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function listCronJobs(
  config: OpenClawConfig,
): Promise<{ ok: boolean; jobs?: any[]; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'cron', { action: 'list' });
    if (!result.ok) return { ok: false, error: result.error?.message };
    return { ok: true, jobs: Array.isArray(result.result) ? result.result : [] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function runWebSearch(
  config: OpenClawConfig,
  query: string,
): Promise<{ ok: boolean; results?: any[]; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'web_search', { query, count: 5 });
    if (!result.ok) return { ok: false, error: result.error?.message };
    return { ok: true, results: result.result?.results || [] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Parsers ────────────────────────────────────

function parseSessionsList(raw: any): OpenClawSession[] {
  if (!raw) return [];
  // The result can be a string (formatted) or structured data
  if (typeof raw === 'string') {
    // Try to parse session lines from formatted output
    return parseSessionsFromText(raw);
  }
  if (Array.isArray(raw)) {
    return raw.map((s: any) => ({
      sessionKey: s.sessionKey || s.key || '',
      kind: s.kind || 'unknown',
      agentId: s.agentId || s.agent || undefined,
      model: s.model || undefined,
      lastActivity: s.lastActivity || undefined,
      messageCount: s.messageCount || s.messages || undefined,
      lastMessages: s.lastMessages || [],
    }));
  }
  if (raw.sessions && Array.isArray(raw.sessions)) {
    return parseSessionsList(raw.sessions);
  }
  return [];
}

function parseSessionsFromText(text: string): OpenClawSession[] {
  // Best-effort parse of formatted session list
  const sessions: OpenClawSession[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/session[:\s]+(\S+)/i);
    if (match) {
      sessions.push({
        sessionKey: match[1],
        kind: line.includes('main') ? 'main' : line.includes('sub') ? 'subagent' : 'unknown',
      });
    }
  }
  return sessions;
}

function parseSessionStatus(raw: any, sessionKey: string): OpenClawSessionStatus {
  if (!raw) return { sessionKey };
  if (typeof raw === 'object') {
    return {
      sessionKey,
      model: raw.model || raw.currentModel || undefined,
      totalInputTokens: raw.totalInputTokens || raw.inputTokens || undefined,
      totalOutputTokens: raw.totalOutputTokens || raw.outputTokens || undefined,
      totalCost: raw.totalCost || raw.cost || undefined,
      turns: raw.turns || raw.turnCount || undefined,
      uptime: raw.uptime || undefined,
    };
  }
  return { sessionKey };
}

function parseHistory(raw: any): Array<{ role: string; content: string }> {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((m: any) => ({
      role: m.role || 'unknown',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''),
    }));
  }
  return [];
}

// ─── Polling Manager ────────────────────────────────────

export type OpenClawUpdate = {
  sessions: OpenClawSession[];
  timestamp: number;
};

export class OpenClawPoller {
  private config: OpenClawConfig;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (update: OpenClawUpdate) => void;

  constructor(config: OpenClawConfig, onUpdate: (update: OpenClawUpdate) => void) {
    this.config = config;
    this.onUpdate = onUpdate;
  }

  start(intervalMs = 10000) {
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  updateConfig(config: OpenClawConfig) {
    this.config = config;
  }

  private async poll() {
    const result = await listSessions(this.config);
    if (result.ok && result.sessions) {
      this.onUpdate({ sessions: result.sessions, timestamp: Date.now() });
    }
  }
}
