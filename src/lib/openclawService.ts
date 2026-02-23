// OpenClaw Gateway API client for the Office Dashboard
// Connects to a user's OpenClaw instance to get real agent data

export interface OpenClawConfig {
  endpoint: string;  // e.g. http://localhost:18790 (CORS proxy)
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
  // Enriched from session_status
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  turns?: number;
  uptime?: string;
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

export interface CronJob {
  id: string;
  name?: string;
  enabled: boolean;
  schedule?: any;
  payload?: any;
  delivery?: any;
  sessionTarget?: string;
  lastRun?: string;
  nextRun?: string;
}

export async function listCronJobs(config: OpenClawConfig): Promise<{ ok: boolean; jobs: CronJob[] }> {
  try {
    const res = await fetch(`${config.endpoint}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
      },
      body: JSON.stringify({ tool: 'cron', parameters: { action: 'list', includeDisabled: true } }),
    });
    const data = await res.json();
    // The response has content[0].text which is a text summary, and details with structured data
    if (data?.result?.details?.jobs) {
      return { ok: true, jobs: data.result.details.jobs };
    }
    // Try parsing from text content
    if (data?.result?.content?.[0]?.text) {
      const text = data.result.content[0].text;
      const jobs: CronJob[] = [];
      // Parse lines like: "1. **job-name** (id) - enabled/disabled - schedule"
      const lines = text.split('\n');
      for (const line of lines) {
        const match = line.match(/\*\*(.+?)\*\*.*?`([a-f0-9-]+)`/);
        if (match) {
          const enabled = !line.toLowerCase().includes('disabled');
          jobs.push({ id: match[2], name: match[1], enabled });
        }
      }
      return { ok: true, jobs };
    }
    return { ok: false, jobs: [] };
  } catch {
    return { ok: false, jobs: [] };
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
    // Extract agent ids from nested result
    const raw = result.result;
    let agents: string[] = [];
    if (Array.isArray(raw)) agents = raw;
    else if (raw?.details) agents = Array.isArray(raw.details) ? raw.details : [];
    else if (raw?.content?.[0]?.text) {
      try { const parsed = JSON.parse(raw.content[0].text); agents = Array.isArray(parsed) ? parsed : []; } catch {}
    }
    return { ok: true, agents };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function spawnSubAgent(
  config: OpenClawConfig,
  task: string,
  model?: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const params: any = { task };
    if (model) params.model = model;
    const result = await invokeToolRaw(config, 'sessions_spawn', params);
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || JSON.stringify(result.result);
    return { ok: true, reply: text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function manageCronJob(
  config: OpenClawConfig,
  action: 'run' | 'update' | 'remove',
  jobId: string,
  patch?: any,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const params: any = { action, jobId };
    if (action === 'update' && patch) params.patch = patch;
    if (action === 'run') params.runMode = 'force';
    const result = await invokeToolRaw(config, 'cron', params);
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || 'Done';
    return { ok: true, reply: text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function searchMemory(
  config: OpenClawConfig,
  query: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'memory_search', { query, maxResults: 5 });
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || JSON.stringify(result.result);
    return { ok: true, reply: text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendSessionMessage(
  config: OpenClawConfig,
  sessionKey: string,
  message: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'sessions_send', { sessionKey, message });
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || 'Message sent';
    return { ok: true, reply: text };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function listSubAgents(
  config: OpenClawConfig,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'subagents', { action: 'list' });
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || JSON.stringify(result.result);
    return { ok: true, reply: text };
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

  // OpenClaw /tools/invoke returns { content: [...], details: { sessions: [...] } }
  if (raw.details?.sessions) {
    return parseSessionsList(raw.details.sessions);
  }
  // Or it might be nested in content[0].text as JSON string
  if (raw.content && Array.isArray(raw.content)) {
    const textBlock = raw.content.find((c: any) => c.type === 'text' && c.text);
    if (textBlock) {
      try {
        const parsed = JSON.parse(textBlock.text);
        if (parsed.sessions) return parseSessionsList(parsed.sessions);
      } catch {}
    }
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.sessions) return parseSessionsList(parsed.sessions);
    } catch {}
    return parseSessionsFromText(raw);
  }
  if (raw.sessions && Array.isArray(raw.sessions)) {
    return parseSessionsList(raw.sessions);
  }
  if (Array.isArray(raw)) {
    return raw.map((s: any) => ({
      sessionKey: s.sessionKey || s.key || '',
      kind: s.kind || 'unknown',
      agentId: s.agentId || s.agent || s.displayName || undefined,
      model: s.model || undefined,
      lastActivity: s.updatedAt ? new Date(s.updatedAt).toISOString() : s.lastActivity || undefined,
      messageCount: s.totalTokens || s.messageCount || undefined,
      lastMessages: (s.messages || []).map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content :
          Array.isArray(m.content) ? m.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('') : '',
        timestamp: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
      })),
    }));
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

  // Extract the status text from the API response
  let text = '';
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw.details?.statusText) {
    text = raw.details.statusText;
  } else if (raw.content?.[0]?.text) {
    text = raw.content[0].text;
  } else if (typeof raw === 'object') {
    // Fallback: try direct fields
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

  if (!text) return { sessionKey };

  // Parse the emoji-formatted status text
  const result: OpenClawSessionStatus = { sessionKey };

  // Model: 🧠 Model: anthropic/claude-opus-4-6
  const modelMatch = text.match(/Model:\s*([^\s·]+)/);
  if (modelMatch) result.model = modelMatch[1];

  // Tokens: 🧮 Tokens: 7 in / 447 out
  const tokensMatch = text.match(/Tokens:\s*([\d.]+[kKmM]?)\s*in\s*\/\s*([\d.]+[kKmM]?)\s*out/);
  if (tokensMatch) {
    result.totalInputTokens = parseTokenCount(tokensMatch[1]);
    result.totalOutputTokens = parseTokenCount(tokensMatch[2]);
  }

  // Context: 📚 Context: 174k/200k (87%)
  const contextMatch = text.match(/Context:\s*([\d.]+[kKmM]?)\/([\d.]+[kKmM]?)/);

  // Cost: 💰 Cost: $1.23 (if present)
  const costMatch = text.match(/Cost:\s*\$?([\d.]+)/);
  if (costMatch) result.totalCost = parseFloat(costMatch[1]);

  // Session: 🧵 Session: agent:main:main • updated just now
  const uptimeMatch = text.match(/updated\s+(.+?)$/m);
  if (uptimeMatch) result.uptime = uptimeMatch[1].trim();

  return result;
}

function parseTokenCount(s: string): number {
  const num = parseFloat(s);
  if (s.toLowerCase().endsWith('k')) return Math.round(num * 1000);
  if (s.toLowerCase().endsWith('m')) return Math.round(num * 1000000);
  return Math.round(num);
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
      // Enrich sessions with cost/token data from session_status
      const enriched = await Promise.all(
        result.sessions.map(async (s) => {
          try {
            const statusResult = await getSessionStatus(this.config, s.sessionKey);
            if (statusResult.ok && statusResult.status) {
              return {
                ...s,
                totalCost: statusResult.status.totalCost,
                totalInputTokens: statusResult.status.totalInputTokens,
                totalOutputTokens: statusResult.status.totalOutputTokens,
                turns: statusResult.status.turns,
                uptime: statusResult.status.uptime,
                model: statusResult.status.model || s.model,
              };
            }
          } catch {}
          return s;
        })
      );
      this.onUpdate({ sessions: enriched, timestamp: Date.now() });
    }
  }
}
