// OpenSwan Gateway API client for the Office Dashboard
// Connects to a user's OpenSwan instance to get real agent data
import { Platform } from 'react-native';
import { estimateCostWithCache } from './modelPricing';
import { diagnoseConnection, DiagnosticResult } from './connectionDiagnostics';

const LEGACY_RUNTIME_PREFIX = `open${'claw'}`;
const LEGACY_AGENT_HEADER = `x-${LEGACY_RUNTIME_PREFIX}-agent-id`;
const LEGACY_SESSION_HEADER = `x-${LEGACY_RUNTIME_PREFIX}-session-key`;

export interface OpenSwanConfig {
  endpoint: string;  // e.g. http://localhost:18790 (CORS proxy)
  token: string;     // gateway auth token
}

export interface OpenSwanSession {
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
  cachedTokens?: number;   // cumulative cached input tokens (for accurate billing)
  newTokens?: number;      // cumulative non-cached input tokens
  turns?: number;
  uptime?: string;
  // Subagent info
  isSubagent?: boolean;
  parentSessionKey?: string;
}

export interface OpenSwanSessionStatus {
  sessionKey: string;
  model?: string;
  totalInputTokens?: number;   // latest-turn input tokens
  totalOutputTokens?: number;  // latest-turn output tokens
  cachedTokens?: number;       // cumulative cached input tokens (session total, 10% price)
  newTokens?: number;          // cumulative non-cached input tokens (session total, full price)
  totalCost?: number;          // computed from cache-aware token math
  turns?: number;
  uptime?: string;
}

export interface OpenSwanToolResult {
  ok: boolean;
  result?: any;
  error?: { type: string; message: string };
}

function isWebDirectLocalGateway(endpoint: string): boolean {
  return Platform.OS === 'web' && /localhost:18789(?:\/|$)/.test(endpoint);
}

// ─── Low-level API ────────────────────────────────────

const unsupportedToolCache = new Set<string>();
const unsupportedToolEndpointCache = new Set<string>();

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

export function supportsOpenSwanToolRpcEndpoint(endpoint: string): boolean {
  return !unsupportedToolEndpointCache.has(normalizeEndpoint(endpoint));
}

// Per-tool timeouts. List-style calls should fail fast so a stalled
// gateway can't wedge the UI's polling loop; send/history can be slower
// because they touch long-running sessions.
const FAST_TOOL_TIMEOUT_MS = 8_000;
const SLOW_TOOL_TIMEOUT_MS = 30_000;
const FAST_TOOLS = new Set(['sessions_list', 'session_status']);

async function invokeToolRaw(
  config: OpenSwanConfig,
  tool: string,
  args: Record<string, any> = {},
): Promise<OpenSwanToolResult> {
  if (isWebDirectLocalGateway(config.endpoint)) {
    return {
      ok: false,
      error: { type: 'unavailable', message: 'Direct local gateway is not available on web' },
    };
  }

  const endpointKey = normalizeEndpoint(config.endpoint);
  if (unsupportedToolEndpointCache.has(endpointKey)) {
    return {
      ok: false,
      error: { type: 'unsupported', message: 'Endpoint does not support OpenSwan tool RPCs' },
    };
  }

  const toolKey = `${endpointKey}::${tool}`;
  if (unsupportedToolCache.has(toolKey)) {
    return {
      ok: false,
      error: { type: 'unsupported', message: `Tool not supported: ${tool}` },
    };
  }

  const timeoutMs = FAST_TOOLS.has(tool) ? FAST_TOOL_TIMEOUT_MS : SLOW_TOOL_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${endpointKey}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    const aborted = error?.name === 'AbortError';
    const message = aborted
      ? `Timeout after ${timeoutMs}ms — gateway unresponsive`
      : (typeof error?.message === 'string' ? error.message : 'Network request failed');
    return {
      ok: false,
      error: {
        type: aborted ? 'timeout' : (message.includes('CORS') ? 'cors' : 'network'),
        message,
      },
    };
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404 || res.status === 405) {
    unsupportedToolCache.add(toolKey);
    unsupportedToolEndpointCache.add(endpointKey);
    return {
      ok: false,
      error: { type: 'unsupported', message: 'Endpoint does not support OpenSwan tool RPCs' },
    };
  }
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      error: { type: 'auth', message: 'Authentication failed — wrong or missing token' },
    };
  }
  return res.json();
}
async function chatCompletion(
  config: OpenSwanConfig,
  message: string,
  agentId = 'main',
  sessionKey?: string,
  systemPrompt?: string,
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      [LEGACY_AGENT_HEADER]: agentId,
    };
    if (sessionKey) headers[LEGACY_SESSION_HEADER] = sessionKey;

    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: message });

    const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: `${LEGACY_RUNTIME_PREFIX}:${agentId}`,
        messages,
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

export async function testConnection(config: OpenSwanConfig): Promise<{
  ok: boolean;
  error?: string;
  sessions?: OpenSwanSession[];
  diagnostic?: DiagnosticResult;
}> {
  try {
    const result = await invokeToolRaw(config, 'sessions_list', {
      limit: 20,
      messageLimit: 1,
    });
    if (!result.ok) {
      if (result.error?.type === 'auth') {
        return {
          ok: false,
          error: result.error.message,
          diagnostic: {
            ok: false,
            errorCode: 'auth',
            message: result.error.message,
            fix: 'Get your token with this command:',
            fixAction: 'copy_command',
            fixValue: 'cat ~/.openswan/openswan.json | grep gatewayToken',
          },
        };
      }
      if (
        result.error?.type === 'unavailable' ||
        result.error?.type === 'cors' ||
        result.error?.type === 'network' ||
        result.error?.type === 'unsupported'
      ) {
        return { ok: false, error: result.error.message };
      }
      // Run diagnostics to get an actionable error
      const diagnostic = await diagnoseConnection(config.endpoint, config.token);
      return { ok: false, error: diagnostic.message, diagnostic };
    }
    const sessions = parseSessionsList(result.result);
    return { ok: true, sessions };
  } catch (e: any) {
    // Run diagnostics to get an actionable error
    const diagnostic = await diagnoseConnection(config.endpoint, config.token);
    return { ok: false, error: diagnostic.message, diagnostic };
  }
}

export async function listSessions(config: OpenSwanConfig): Promise<{
  ok: boolean;
  sessions?: OpenSwanSession[];
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
  config: OpenSwanConfig,
  sessionKey: string,
): Promise<{ ok: boolean; status?: OpenSwanSessionStatus; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'session_status', { sessionKey });
    if (!result.ok) return { ok: false, error: result.error?.message };
    return { ok: true, status: parseSessionStatus(result.result, sessionKey) };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getSessionHistory(
  config: OpenSwanConfig,
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
  config: OpenSwanConfig,
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
  status?: string;
  timezone?: string;
  runCount?: number;
}

export function isLikelyCronExpression(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^@(hourly|daily|weekly|monthly|yearly|annually|reboot)$/.test(normalized)) return true;
  return /^(\S+\s+){4,5}\S+$/.test(normalized);
}

export function formatCronSchedule(schedule: any): string {
  if (!schedule) return '';
  if (typeof schedule === 'string') return schedule;
  if (typeof schedule === 'object') {
    return schedule.expr || schedule.cron || schedule.kind || schedule.label || schedule.when || '';
  }
  return '';
}

function normalizeCronJob(raw: any): CronJob | null {
  if (!raw) return null;

  const id = raw.id || raw.jobId || raw.job_id;
  if (!id) return null;

  const schedule = raw.schedule || raw.cron || raw.when || raw.trigger || raw.expression;
  const payload = raw.payload || raw.job || raw.args || raw.input;
  const sessionTarget =
    raw.sessionTarget ||
    raw.session_target ||
    raw.session ||
    raw.payload?.sessionTarget ||
    raw.delivery?.sessionTarget;

  return {
    id,
    name: raw.name || raw.title || raw.label,
    enabled: raw.enabled !== false && raw.disabled !== true,
    schedule,
    payload,
    delivery: raw.delivery || raw.output || raw.target,
    sessionTarget,
    lastRun: raw.lastRun || raw.last_run || raw.lastRunAt || raw.last_run_at,
    nextRun: raw.nextRun || raw.next_run || raw.nextRunAt || raw.next_run_at,
    status: raw.status,
    timezone: raw.timezone || raw.tz,
    runCount:
      raw.runCount == null && raw.run_count == null
        ? undefined
        : typeof (raw.runCount ?? raw.run_count) === 'number'
          ? (raw.runCount ?? raw.run_count)
          : Number(raw.runCount ?? raw.run_count),
  };
}

export async function listCronJobs(config: OpenSwanConfig): Promise<{ ok: boolean; jobs: CronJob[]; error?: string }> {
  if (!supportsOpenSwanToolRpcEndpoint(config.endpoint)) {
    return { ok: true, jobs: [] };
  }
  try {
    const data = await invokeToolRaw(config, 'cron', {
      action: 'list',
      includeDisabled: true,
    });
    if (!data.ok) {
      if (data.error?.type === 'unsupported') {
        return { ok: true, jobs: [] };
      }
      return { ok: false, jobs: [], error: data.error?.message || 'Failed to load cron jobs' };
    }
    // The response has content[0].text which is a text summary, and details with structured data
    if (data?.result?.details?.jobs) {
      return {
        ok: true,
        jobs: data.result.details.jobs.map(normalizeCronJob).filter(Boolean) as CronJob[],
      };
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
          jobs.push({ id: match[2], name: match[1], enabled, schedule: line.includes(' - ') ? line.split(' - ').slice(-1)[0] : undefined });
        }
      }
      return { ok: true, jobs };
    }
    return { ok: false, jobs: [], error: 'Cron tool returned no structured jobs' };
  } catch (e: any) {
    return { ok: false, jobs: [], error: e.message };
  }
}
export async function sendAgentTask(
  config: OpenSwanConfig,
  task: string,
  agentId = 'main',
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  return chatCompletion(config, task, agentId);
}

export async function listAgents(
  config: OpenSwanConfig,
): Promise<{ ok: boolean; agents?: string[]; error?: string }> {
  if (!supportsOpenSwanToolRpcEndpoint(config.endpoint)) {
    return { ok: true, agents: [] };
  }
  try {
    const result = await invokeToolRaw(config, 'agents_list', {});
    if (!result.ok) {
      if (result.error?.type === 'unsupported') {
        return { ok: true, agents: [] };
      }
      return { ok: false, error: result.error?.message };
    }
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
  config: OpenSwanConfig,
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
  config: OpenSwanConfig,
  action: 'run' | 'update' | 'remove',
  jobId: string,
  patch?: any,
): Promise<{ ok: boolean; reply?: string; error?: string; runId?: string }> {
  try {
    const params: any = { action, jobId };
    if (action === 'update' && patch) params.patch = patch;
    if (action === 'run') params.runMode = 'force';
    const result = await invokeToolRaw(config, 'cron', params);
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || 'Done';
    const runIdMatch = text.match(/run(?:\s+id)?[:\s`]+([a-f0-9-]{8,})/i);
    return { ok: true, reply: text, runId: runIdMatch?.[1] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function createCronJob(
  config: OpenSwanConfig,
  opts: { name: string; schedule: string; task: string; sessionTarget?: string; timezone?: string; enabled?: boolean },
): Promise<{ ok: boolean; jobId?: string; error?: string }> {
  try {
    if (!isLikelyCronExpression(opts.schedule)) {
      return { ok: false, error: 'Invalid cron expression' };
    }
    const result = await invokeToolRaw(config, 'cron', {
      action: 'add',
      name: opts.name,
      cron: opts.schedule,
      task: opts.task,
      sessionTarget: opts.sessionTarget || 'isolated',
      tz: opts.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      enabled: opts.enabled !== false,
    });
    if (!result.ok) return { ok: false, error: result.error?.message };
    const text = result.result?.content?.[0]?.text || '';
    const idMatch = text.match(/`([a-f0-9-]+)`/) || text.match(/job(?:\s+id)?[:\s`]+([a-f0-9-]{8,})/i);
    const detailId = result.result?.details?.jobId || result.result?.details?.job_id;
    return { ok: true, jobId: detailId || idMatch?.[1] || 'created' };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function searchMemory(
  config: OpenSwanConfig,
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
  config: OpenSwanConfig,
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
  config: OpenSwanConfig,
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
  config: OpenSwanConfig,
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

function parseSessionsList(raw: any): OpenSwanSession[] {
  if (!raw) return [];

  // OpenSwan /tools/invoke returns { content: [...], details: { sessions: [...] } }
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

function parseSessionsFromText(text: string): OpenSwanSession[] {
  // Best-effort parse of formatted session list
  const sessions: OpenSwanSession[] = [];
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

function parseSessionStatus(raw: any, sessionKey: string): OpenSwanSessionStatus {
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
  const result: OpenSwanSessionStatus = { sessionKey };

  // Model: 🧠 Model: anthropic/claude-opus-4-6
  const modelMatch = text.match(/Model:\s*([^\s·]+)/);
  if (modelMatch) result.model = modelMatch[1];

  // Tokens: 🧮 Tokens: 7 in / 447 out  (latest turn — not cumulative)
  const tokensMatch = text.match(/Tokens:\s*([\d.]+[kKmM]?)\s*in\s*\/\s*([\d.]+[kKmM]?)\s*out/);
  if (tokensMatch) {
    result.totalInputTokens  = parseTokenCount(tokensMatch[1]);
    result.totalOutputTokens = parseTokenCount(tokensMatch[2]);
  }

  // Cache: 🗄️ Cache: 89% hit · 1.4m cached, 167k new
  // "cached" = prompt-cache hits (billed at ~10% of input rate)
  // "new"    = non-cached tokens    (billed at full input rate)
  // These are CUMULATIVE for the session — use them for accurate cost calculation
  const cacheMatch = text.match(/Cache:.*?([\d.]+[kKmM]?)\s*cached,\s*([\d.]+[kKmM]?)\s*new/);
  if (cacheMatch) {
    result.cachedTokens = parseTokenCount(cacheMatch[1]);
    result.newTokens    = parseTokenCount(cacheMatch[2]);
  }

  // Cost: 💰 Cost: $1.23  (explicit cost line — use if present)
  const costMatch = text.match(/Cost:\s*\$?([\d.]+)/);
  if (costMatch) {
    result.totalCost = parseFloat(costMatch[1]);
  } else if (result.model && (result.cachedTokens != null || result.newTokens != null)) {
    // No explicit cost — compute from cache-aware tokens + model pricing
    result.totalCost = estimateCostWithCache(
      result.model,
      result.cachedTokens   ?? 0,
      result.newTokens      ?? 0,
      result.totalOutputTokens ?? 0,
    );
  }

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

// ─── Subagent Enumeration ─────────────────────────────────

export interface OpenSwanSubAgent {
  id: string;
  name?: string;
  sessionKey?: string;
  status?: string;
  model?: string;
  task?: string;
}

export async function listSubAgentsDetailed(
  config: OpenSwanConfig,
): Promise<{ ok: boolean; subagents: OpenSwanSubAgent[]; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'subagents', { action: 'list' });
    if (!result.ok) return { ok: false, subagents: [], error: result.error?.message };
    const raw = result.result;
    let subagents: OpenSwanSubAgent[] = [];

    // Parse structured details if available
    if (raw?.details?.subagents && Array.isArray(raw.details.subagents)) {
      subagents = raw.details.subagents.map((s: any) => ({
        id: s.id || s.sessionKey || '',
        name: s.name || s.displayName || undefined,
        sessionKey: s.sessionKey || s.key || undefined,
        status: s.status || 'unknown',
        model: s.model || undefined,
        task: s.task || s.description || undefined,
      }));
    } else if (Array.isArray(raw)) {
      subagents = raw.map((s: any) => ({
        id: typeof s === 'string' ? s : s.id || '',
        name: s.name || undefined,
        sessionKey: s.sessionKey || undefined,
        status: s.status || 'unknown',
        model: s.model || undefined,
        task: s.task || undefined,
      }));
    } else if (raw?.content?.[0]?.text) {
      // Try parsing from text
      try {
        const parsed = JSON.parse(raw.content[0].text);
        if (Array.isArray(parsed)) {
          subagents = parsed.map((s: any) => ({
            id: typeof s === 'string' ? s : s.id || '',
            name: s.name || undefined,
            sessionKey: s.sessionKey || undefined,
            status: s.status || 'unknown',
          }));
        }
      } catch {}
    }

    return { ok: true, subagents };
  } catch (e: any) {
    return { ok: false, subagents: [], error: e.message };
  }
}

// ─── Polling Manager ────────────────────────────────────

export type OpenSwanUpdate = {
  sessions: OpenSwanSession[];
  subagents: OpenSwanSubAgent[];
  timestamp: number;
};

export class OpenSwanPoller {
  private config: OpenSwanConfig;
  private interval: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (update: OpenSwanUpdate) => void;
  private onError?: (error: string) => void;
  private pollCount = 0;
  private consecutiveFailures = 0;
  private baseIntervalMs = 10000;
  private currentIntervalMs = 10000;
  private static readonly MAX_INTERVAL_MS = 60000; // Cap at 60s

  constructor(config: OpenSwanConfig, onUpdate: (update: OpenSwanUpdate) => void, onError?: (error: string) => void) {
    this.config = config;
    this.onUpdate = onUpdate;
    this.onError = onError;
  }

  start(intervalMs = 10000) {
    this.baseIntervalMs = intervalMs;
    this.currentIntervalMs = intervalMs;
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  /** Reschedule with exponential backoff interval */
  private reschedule(intervalMs: number) {
    if (this.interval) clearInterval(this.interval);
    this.currentIntervalMs = intervalMs;
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  updateConfig(config: OpenSwanConfig) {
    this.config = config;
  }

  private async poll() {
    this.pollCount++;

    // Fetch sessions + subagents in parallel
    // Subagents are fetched every 3rd poll to reduce API load
    const fetchSubagents = this.pollCount % 3 === 1;
    const [sessionsResult, subagentsResult] = await Promise.all([
      listSessions(this.config),
      fetchSubagents
        ? listSubAgentsDetailed(this.config).catch(() => ({ ok: false, subagents: [] as OpenSwanSubAgent[] }))
        : Promise.resolve(null),
    ]);

    if (!sessionsResult.ok) {
      this.consecutiveFailures++;
      // Exponential backoff: 10s → 20s → 40s → 60s cap
      const backoffMs = Math.min(
        this.baseIntervalMs * Math.pow(2, this.consecutiveFailures - 1),
        OpenSwanPoller.MAX_INTERVAL_MS,
      );
      if (backoffMs !== this.currentIntervalMs) {
        this.reschedule(backoffMs);
      }
      // After 3 consecutive failures, notify error handler so connection can be retried
      if (this.consecutiveFailures >= 3 && this.onError) {
        this.onError(sessionsResult.error || 'Connection lost');
        this.stop();
      }
      return;
    }

    this.consecutiveFailures = 0;
    // Reset to base interval on success (if we had backed off)
    if (this.currentIntervalMs !== this.baseIntervalMs) {
      this.reschedule(this.baseIntervalMs);
    }

    if (sessionsResult.sessions) {
      // Enrich sessions with cost/token data from session_status
      const MAX_CONCURRENT = 10;
      const enriched: OpenSwanSession[] = [];

      for (let i = 0; i < sessionsResult.sessions.length; i += MAX_CONCURRENT) {
        const batch = sessionsResult.sessions.slice(i, i + MAX_CONCURRENT);
        const batchEnriched = await Promise.all(
          batch.map(async (s) => {
            try {
              const statusResult = await getSessionStatus(this.config, s.sessionKey);
              if (statusResult.ok && statusResult.status) {
                return {
                  ...s,
                  totalCost:        statusResult.status.totalCost,
                  totalInputTokens: statusResult.status.totalInputTokens,
                  totalOutputTokens:statusResult.status.totalOutputTokens,
                  cachedTokens:     statusResult.status.cachedTokens,
                  newTokens:        statusResult.status.newTokens,
                  turns:            statusResult.status.turns,
                  uptime:           statusResult.status.uptime,
                  model:            statusResult.status.model || s.model,
                };
              }
            } catch {}
            return s;
          })
        );
        enriched.push(...batchEnriched);
      }

      // Tag sessions that are subagents (match by sessionKey from subagent list)
      const subagents = subagentsResult?.subagents || [];
      const subagentSessionKeys = new Set(
        subagents.map(sa => sa.sessionKey).filter(Boolean)
      );
      for (const session of enriched) {
        if (session.kind === 'subagent' || subagentSessionKeys.has(session.sessionKey)) {
          session.isSubagent = true;
        }
      }

      // Also add subagent sessions not already in the sessions list
      if (subagents.length > 0) {
        const existingKeys = new Set(enriched.map(s => s.sessionKey));
        for (const sa of subagents) {
          if (sa.sessionKey && !existingKeys.has(sa.sessionKey)) {
            enriched.push({
              sessionKey: sa.sessionKey,
              kind: 'subagent',
              agentId: sa.id,
              model: sa.model,
              isSubagent: true,
            });
          }
        }
      }

      this.onUpdate({
        sessions: enriched,
        subagents,
        timestamp: Date.now(),
      });
    }
  }
}
