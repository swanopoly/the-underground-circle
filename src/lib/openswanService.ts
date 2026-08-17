// OpenSwan Gateway API client for the Office Dashboard
// Connects to a user's OpenSwan instance to get real agent data
import { Platform } from 'react-native';
import { estimateCostWithCache } from './modelPricing';
import { diagnoseConnection, DiagnosticResult } from './connectionDiagnostics';
import {
  parseOpenSwanSessionSendHandle as parseOpenSwanSessionSendHandleCore,
  parseOpenSwanSpawnDisposition as parseOpenSwanSpawnDispositionCore,
  parseOpenSwanSpawnHandle as parseOpenSwanSpawnHandleCore,
  parseOpenSwanSubagentLifecycleSnapshot as parseOpenSwanSubagentLifecycleSnapshotCore,
  type OpenSwanSessionSendHandle,
  type OpenSwanSpawnDisposition,
  type OpenSwanSpawnHandle,
  type OpenSwanSubagentLifecycleSnapshot,
} from './openswanSubagentLifecycleCore';

export {
  classifyOpenSwanSubagentLifecycle,
  findOpenSwanSubagentLifecycleByProviderRunId,
  lookupOpenSwanSubagentLifecycleByProviderRunId,
  OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS,
} from './openswanSubagentLifecycleCore';
export type {
  OpenSwanSessionSendHandle,
  OpenSwanSessionSendPhase,
  OpenSwanSpawnDisposition,
  OpenSwanSpawnPhase,
  OpenSwanSpawnHandle,
  OpenSwanSubagentLifecycleClassification,
  OpenSwanSubagentLifecycleLookup,
  OpenSwanSubagentLifecycleRecord,
  OpenSwanSubagentLifecycleSnapshot,
  OpenSwanSubagentRuntimeStatus,
} from './openswanSubagentLifecycleCore';

const LEGACY_RUNTIME_PREFIX = `open${'claw'}`;
const LEGACY_AGENT_HEADER = `x-${LEGACY_RUNTIME_PREFIX}-agent-id`;
const LEGACY_SESSION_HEADER = `x-${LEGACY_RUNTIME_PREFIX}-session-key`;

export interface OpenSwanConfig {
  endpoint: string;  // e.g. http://localhost:18789 (direct gateway)
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

/** Read only the current gateway's structured details; never infer ids from prose. */
export function parseOpenSwanSpawnHandle(value: unknown): OpenSwanSpawnHandle | null {
  return parseOpenSwanSpawnHandleCore(value);
}

/** Preserve structured spawn errors whose child may already have started. */
export function parseOpenSwanSpawnDisposition(value: unknown): OpenSwanSpawnDisposition | null {
  return parseOpenSwanSpawnDispositionCore(value);
}

/** Read only the structured sessions_send disposition; visible prose is non-authoritative. */
export function parseOpenSwanSessionSendHandle(value: unknown): OpenSwanSessionSendHandle | null {
  return parseOpenSwanSessionSendHandleCore(value);
}

/** Read current structured subagents list buckets without inferring lifecycle from text. */
export function parseOpenSwanSubagentLifecycleSnapshot(
  value: unknown,
): OpenSwanSubagentLifecycleSnapshot | null {
  return parseOpenSwanSubagentLifecycleSnapshotCore(value);
}

function isWebDirectLocalGateway(endpoint: string): boolean {
  return Platform.OS === 'web' && /localhost:18789(?:\/|$)/.test(endpoint);
}

// ─── Low-level API ────────────────────────────────────

const unsupportedToolCache = new Map<string, number>();
const unsupportedToolEndpointCache = new Map<string, number>();
const unavailableEndpointCache = new Map<string, number>();
// Auth failures are time-boxed rather than permanently latched. The old
// behavior (Set) meant a single stale token at app start disabled Office
// for the rest of the session — even after the proxy or user fixed the
// token. 30s cooldown lets us detect recovery without hammering.
const authFailedEndpointCache = new Map<string, number>();

const UNAVAILABLE_ENDPOINT_COOLDOWN_MS = 30_000;
const AUTH_FAILED_COOLDOWN_MS = 30_000;
const UNSUPPORTED_TOOL_COOLDOWN_MS = 60_000;

function isToolUnsupportedCached(toolKey: string): boolean {
  const until = unsupportedToolCache.get(toolKey) || 0;
  if (until > Date.now()) return true;
  if (until > 0) unsupportedToolCache.delete(toolKey);
  return false;
}

function markToolUnsupported(endpoint: string, tool: string): void {
  unsupportedToolCache.set(`${normalizeEndpoint(endpoint)}::${tool}`, Date.now() + UNSUPPORTED_TOOL_COOLDOWN_MS);
}

function isToolRpcEndpointUnsupportedCached(endpoint: string): boolean {
  const normalized = normalizeEndpoint(endpoint);
  const until = unsupportedToolEndpointCache.get(normalized) || 0;
  if (until > Date.now()) return true;
  if (until > 0) unsupportedToolEndpointCache.delete(normalized);
  return false;
}

function markToolRpcEndpointUnsupported(endpoint: string): void {
  unsupportedToolEndpointCache.set(
    normalizeEndpoint(endpoint),
    Date.now() + UNSUPPORTED_TOOL_COOLDOWN_MS,
  );
}

function isExactToolUnavailable(error: unknown, tool: string): boolean {
  const record = error as { type?: unknown; message?: unknown } | null | undefined;
  if (record?.type === 'unsupported') return true;
  if (record?.type !== 'not_found' || typeof record.message !== 'string') return false;
  const message = record.message.replace(/\s+/g, ' ').trim().toLowerCase();
  return message === `tool not available: ${tool.toLowerCase()}`
    || message === `tool not found: ${tool.toLowerCase()}`;
}

function isAuthFailed(authKey: string): boolean {
  const until = authFailedEndpointCache.get(authKey) || 0;
  if (until <= Date.now()) {
    if (until > 0) authFailedEndpointCache.delete(authKey);
    return false;
  }
  return true;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/$/, '');
}

function getEndpointAuthKey(endpoint: string, token?: string): string {
  return `${normalizeEndpoint(endpoint)}::${token || ''}`;
}

export function supportsOpenSwanToolRpcEndpoint(endpoint: string): boolean {
  return !isToolRpcEndpointUnsupportedCached(endpoint);
}

export function getOpenSwanEndpointNotice(endpoint: string, token?: string): string | null {
  if (isWebDirectLocalGateway(endpoint)) {
    return 'OpenSwan local gateway is not available from web localhost.';
  }
  const normalized = normalizeEndpoint(endpoint);
  const authKey = getEndpointAuthKey(endpoint, token);
  if (isAuthFailed(authKey)) {
    return 'Authentication failed — wrong or missing token';
  }
  const unavailableUntil = unavailableEndpointCache.get(normalized) || 0;
  if (unavailableUntil > Date.now()) {
    return getUnavailableEndpointMessage(normalized);
  }
  if (isToolRpcEndpointUnsupportedCached(normalized)) {
    return 'Endpoint does not support OpenSwan tool RPCs.';
  }
  return null;
}

function getUnavailableEndpointMessage(endpoint: string): string {
  const until = unavailableEndpointCache.get(endpoint) || 0;
  const retryInMs = Math.max(0, until - Date.now());
  const retryInSec = Math.max(1, Math.ceil(retryInMs / 1000));
  return `Gateway unavailable — retrying in ${retryInSec}s`;
}

function markEndpointUnavailable(endpoint: string) {
  unavailableEndpointCache.set(endpoint, Date.now() + UNAVAILABLE_ENDPOINT_COOLDOWN_MS);
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
  const endpointAuthKey = getEndpointAuthKey(config.endpoint, config.token);
  const unavailableUntil = unavailableEndpointCache.get(endpointKey) || 0;
  if (unavailableUntil > Date.now()) {
    return {
      ok: false,
      error: { type: 'unavailable', message: getUnavailableEndpointMessage(endpointKey) },
    };
  }
  if (unavailableUntil > 0) unavailableEndpointCache.delete(endpointKey);
  if (isToolRpcEndpointUnsupportedCached(endpointKey)) {
    return {
      ok: false,
      error: { type: 'unsupported', message: 'Endpoint does not support OpenSwan tool RPCs' },
    };
  }
  if (isAuthFailed(endpointAuthKey)) {
    return {
      ok: false,
      error: { type: 'auth', message: 'Authentication failed — wrong or missing token' },
    };
  }

  const toolKey = `${endpointKey}::${tool}`;
  if (isToolUnsupportedCached(toolKey)) {
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
    markEndpointUnavailable(endpointKey);
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
    markToolUnsupported(endpointKey, tool);
    // An optional tool can be absent while the shared /tools/invoke endpoint
    // remains healthy. Only the baseline session inventory may classify the
    // endpoint itself as unsupported, and even that classification expires so
    // an in-place gateway upgrade can be discovered without a page reload.
    if (tool === 'sessions_list') markToolRpcEndpointUnsupported(endpointKey);
    unavailableEndpointCache.delete(endpointKey);
    return {
      ok: false,
      error: { type: 'unsupported', message: `Tool not supported: ${tool}` },
    };
  }
  if (res.status === 401 || res.status === 403) {
    authFailedEndpointCache.set(endpointAuthKey, Date.now() + AUTH_FAILED_COOLDOWN_MS);
    unavailableEndpointCache.delete(endpointKey);
    return {
      ok: false,
      error: { type: 'auth', message: 'Authentication failed — wrong or missing token' },
    };
  }
  authFailedEndpointCache.delete(endpointAuthKey);
  unavailableEndpointCache.delete(endpointKey);
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
    if (!sessions) {
      return { ok: false, error: 'OpenSwan returned no trustworthy structured session inventory.' };
    }
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
    const sessions = parseSessionsList(result.result);
    if (!sessions) {
      return { ok: false, error: 'OpenSwan returned no trustworthy structured session inventory.' };
    }
    return { ok: true, sessions };
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
    const status = parseSessionStatus(result.result, sessionKey);
    if (!status) return { ok: false, error: 'OpenSwan returned no trustworthy structured session status.' };
    return { ok: true, status };
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
    const messages = parseHistory(result.result, sessionKey);
    if (!messages) return { ok: false, error: 'OpenSwan returned no trustworthy structured session history.' };
    return { ok: true, messages };
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
  schedule?: string;
  payload?: string;
  delivery?: string;
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

export function formatCronSchedule(schedule: unknown): string {
  const candidate = typeof schedule === 'string'
    ? schedule
    : isProviderRecord(schedule)
      ? schedule.expr ?? schedule.cron ?? schedule.kind ?? schedule.label ?? schedule.when
      : undefined;
  const normalized = readOptionalProviderText(candidate, 256);
  return typeof normalized === 'string' ? normalized : '';
}

function firstDefinedProviderValue(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function readOptionalProviderSummary(value: unknown, maxChars: number): OptionalProviderText {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return readOptionalProviderContent(value, maxChars);
  if (!isProviderRecord(value) && !Array.isArray(value)) return INVALID_PROVIDER_FIELD;
  try {
    const encoded = JSON.stringify(value);
    return readOptionalProviderContent(encoded, maxChars);
  } catch {
    return INVALID_PROVIDER_FIELD;
  }
}

function normalizeCronJob(raw: unknown): CronJob | null {
  if (!isProviderRecord(raw)) return null;

  const id = readCronReceiptId(firstDefinedProviderValue(raw.id, raw.jobId, raw.job_id));
  if (!id) return null;

  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  if (raw.disabled !== undefined && typeof raw.disabled !== 'boolean') return null;
  if (raw.enabled === undefined && raw.disabled === undefined) return null;
  if (typeof raw.enabled === 'boolean' && typeof raw.disabled === 'boolean' && raw.enabled !== !raw.disabled) return null;
  const enabled = typeof raw.enabled === 'boolean'
    ? raw.enabled
    : typeof raw.disabled === 'boolean'
      ? !raw.disabled
      : !raw.disabled;

  const rawSchedule = firstDefinedProviderValue(raw.schedule, raw.cron, raw.when, raw.trigger, raw.expression);
  const schedule = rawSchedule === undefined ? undefined : formatCronSchedule(rawSchedule);
  if (rawSchedule !== undefined && !schedule) return null;
  const rawPayload = firstDefinedProviderValue(raw.payload, raw.job, raw.args, raw.input);
  const payload = readOptionalProviderSummary(rawPayload, 4_000);
  const delivery = readOptionalProviderSummary(firstDefinedProviderValue(raw.delivery, raw.output, raw.target), 2_000);
  const payloadRecord = isProviderRecord(raw.payload) ? raw.payload : null;
  const deliveryRecord = isProviderRecord(raw.delivery) ? raw.delivery : null;
  const sessionTarget = readOptionalProviderText(firstDefinedProviderValue(
    raw.sessionTarget,
    raw.session_target,
    raw.session,
    payloadRecord?.sessionTarget,
    deliveryRecord?.sessionTarget,
  ), 80);
  const name = readOptionalProviderText(firstDefinedProviderValue(raw.name, raw.title, raw.label), 160);
  const lastRun = readOptionalProviderDate(firstDefinedProviderValue(raw.lastRun, raw.last_run, raw.lastRunAt, raw.last_run_at));
  const nextRun = readOptionalProviderDate(firstDefinedProviderValue(raw.nextRun, raw.next_run, raw.nextRunAt, raw.next_run_at));
  const status = readOptionalProviderText(raw.status, 80);
  const timezone = readOptionalProviderText(firstDefinedProviderValue(raw.timezone, raw.tz), 120);
  const runCount = readOptionalProviderNumber(firstDefinedProviderValue(raw.runCount, raw.run_count));
  if (
    payload === INVALID_PROVIDER_FIELD
    || delivery === INVALID_PROVIDER_FIELD
    || sessionTarget === INVALID_PROVIDER_FIELD
    || name === INVALID_PROVIDER_FIELD
    || lastRun === INVALID_PROVIDER_FIELD
    || nextRun === INVALID_PROVIDER_FIELD
    || status === INVALID_PROVIDER_FIELD
    || timezone === INVALID_PROVIDER_FIELD
    || runCount === INVALID_PROVIDER_FIELD
    || (runCount !== undefined && !Number.isInteger(runCount))
  ) return null;

  return {
    id,
    enabled,
    ...(name ? { name } : {}),
    ...(schedule ? { schedule } : {}),
    ...(payload ? { payload } : {}),
    ...(delivery ? { delivery } : {}),
    ...(sessionTarget ? { sessionTarget } : {}),
    ...(lastRun ? { lastRun } : {}),
    ...(nextRun ? { nextRun } : {}),
    ...(status ? { status } : {}),
    ...(timezone ? { timezone } : {}),
    ...(runCount !== undefined ? { runCount } : {}),
  };
}

export async function listCronJobs(config: OpenSwanConfig): Promise<{
  ok: boolean;
  supported: boolean;
  jobs: CronJob[];
  error?: string;
}> {
  if (!supportsOpenSwanToolRpcEndpoint(config.endpoint)) {
    return { ok: true, supported: false, jobs: [] };
  }
  try {
    const data = await invokeToolRaw(config, 'cron', {
      action: 'list',
      includeDisabled: true,
    });
    if (!data.ok) {
      if (isExactToolUnavailable(data.error, 'cron')) {
        markToolUnsupported(config.endpoint, 'cron');
        return { ok: true, supported: false, jobs: [] };
      }
      return { ok: false, supported: true, jobs: [], error: data.error?.message || 'Failed to load cron jobs' };
    }
    // The response has content[0].text which is a text summary, and details
    // with the authoritative structured inventory. Reject the whole snapshot
    // if even one row is malformed or duplicated; a partial list is not safe
    // evidence for update/remove postconditions.
    const rawJobs = data?.result?.details?.jobs;
    if (Array.isArray(rawJobs) && rawJobs.length <= 1_000) {
      const jobs = rawJobs.map(normalizeCronJob);
      const ids = jobs.map(job => job?.id);
      if (jobs.every((job): job is CronJob => !!job) && new Set(ids).size === ids.length) {
        return { ok: true, supported: true, jobs };
      }
      return { ok: false, supported: true, jobs: [], error: 'Cron tool returned a malformed or duplicate job inventory' };
    }
    // Prose is not an inventory receipt. An empty list is trusted only when
    // the tool returns the structured details.jobs array above.
    return { ok: false, supported: true, jobs: [], error: 'Cron tool returned no structured jobs' };
  } catch (e: any) {
    return { ok: false, supported: true, jobs: [], error: e.message };
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
): Promise<{ ok: boolean; supported: boolean; agents?: string[]; error?: string }> {
  if (!supportsOpenSwanToolRpcEndpoint(config.endpoint)) {
    return { ok: true, supported: false, agents: [] };
  }
  try {
    const result = await invokeToolRaw(config, 'agents_list', {});
    if (!result.ok) {
      if (isExactToolUnavailable(result.error, 'agents_list')) {
        markToolUnsupported(config.endpoint, 'agents_list');
        return { ok: true, supported: false, agents: [] };
      }
      return { ok: false, supported: true, error: result.error?.message };
    }
    // Accept only a recognized structured inventory. Prose or a malformed
    // successful payload must not become a verified empty agent list.
    const raw = result.result;
    const rawAgents = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.details)
        ? raw.details
        : Array.isArray(raw?.details?.agents)
          ? raw.details.agents
          : null;
    if (!rawAgents || rawAgents.length > 1_000) {
      return { ok: false, supported: true, agents: [], error: 'Runtime returned no structured agent inventory' };
    }
    const agents: string[] = (rawAgents as unknown[])
      .map((value: unknown) => typeof value === 'string' ? value.trim() : '');
    if (agents.some(agent => !agent || agent.length > 160 || /[\u0000-\u001f\u007f]/.test(agent)) || new Set(agents).size !== agents.length) {
      return { ok: false, supported: true, agents: [], error: 'Runtime returned a malformed or duplicate agent inventory' };
    }
    return { ok: true, supported: true, agents };
  } catch (e: any) {
    return { ok: false, supported: true, error: e.message };
  }
}

export async function spawnSubAgent(
  config: OpenSwanConfig,
  task: string,
  model?: string,
): Promise<{
  ok: boolean;
  reply?: string;
  error?: string;
  providerRunId?: string;
  sessionKey?: string;
  providerStatus?: string;
  transportAccepted?: boolean | null;
}> {
  try {
    const params: any = { task };
    if (model) params.model = model;
    const result = await invokeToolRaw(config, 'sessions_spawn', params);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error?.message,
        transportAccepted: null,
      };
    }
    const disposition = parseOpenSwanSpawnDispositionCore(result.result);
    if (!disposition) {
      return {
        ok: false,
        error: 'OpenSwan returned no structured spawn disposition. The dispatch outcome is unknown; check the session list before retrying.',
        transportAccepted: null,
      };
    }
    const lineage = {
      providerRunId: disposition.providerRunId || undefined,
      sessionKey: disposition.childSessionKey || undefined,
      providerStatus: disposition.providerStatus,
      transportAccepted: disposition.transportAccepted,
    };
    if (disposition.transportAccepted === false) {
      return {
        ok: false,
        error: `OpenSwan rejected the session spawn (${disposition.providerStatus}).`,
        ...lineage,
      };
    }
    if (disposition.transportAccepted !== true) {
      return {
        ok: false,
        error: `OpenSwan returned ${disposition.providerStatus}, but could not prove whether the child session started. Check the session list before retrying.`,
        ...lineage,
      };
    }
    // Current OpenSwan acceptance includes both identities. A missing,
    // malformed, or non-accepted structured result cannot be promoted to a
    // successful handoff: the caller needs exact lineage before it creates a
    // canonical local run or offers another dispatch attempt.
    if (!disposition.providerRunId || !disposition.childSessionKey) {
      return {
        ok: false,
        error: 'OpenSwan did not return a trustworthy structured spawn acceptance. The dispatch outcome is unknown; check the session list before retrying.',
        ...lineage,
        transportAccepted: null,
      };
    }
    const text = result.result?.content?.[0]?.text || JSON.stringify(result.result);
    return {
      ok: true,
      reply: text,
      providerRunId: disposition.providerRunId,
      sessionKey: disposition.childSessionKey,
      providerStatus: disposition.providerStatus,
      transportAccepted: true,
    };
  } catch (e: any) {
    return { ok: false, error: e.message, transportAccepted: null };
  }
}

export interface CronMutationReceipt {
  readonly accepted: true;
  readonly action: 'create' | 'run' | 'update' | 'remove';
  readonly jobId: string;
  readonly runId?: string;
  readonly status?: string;
}

function readCronReceiptId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 160 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizeCronReceiptAction(value: unknown): CronMutationReceipt['action'] | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'add':
    case 'create':
    case 'created':
      return 'create';
    case 'run':
    case 'execute':
    case 'executed':
      return 'run';
    case 'update':
    case 'updated':
    case 'enable':
    case 'disable':
      return 'update';
    case 'remove':
    case 'removed':
    case 'delete':
    case 'deleted':
      return 'remove';
    default:
      return null;
  }
}

/**
 * Parse only a structured cron mutation acknowledgement. Visible prose is not
 * authority: a 2xx response without an exact action and job id remains an
 * unknown outcome and must be inspected before retrying.
 */
export function parseCronMutationReceipt(
  value: unknown,
  expectedAction: CronMutationReceipt['action'],
  expectedJobId?: string,
): CronMutationReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const outer = value as Record<string, unknown>;
  const receiptValue = outer.receipt;
  const record = receiptValue && typeof receiptValue === 'object' && !Array.isArray(receiptValue)
    ? receiptValue as Record<string, unknown>
    : outer;
  if (record.error || record.failure) return null;

  const nestedJob = record.job && typeof record.job === 'object' && !Array.isArray(record.job)
    ? record.job as Record<string, unknown>
    : null;
  const jobId = readCronReceiptId(record.jobId ?? record.job_id ?? record.id ?? nestedJob?.id);
  if (!jobId || (expectedJobId !== undefined && jobId !== expectedJobId)) return null;

  const action = normalizeCronReceiptAction(record.action ?? record.operation ?? record.event);
  const status = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
  if (action !== expectedAction || record.accepted !== true) return null;

  const runId = readCronReceiptId(record.runId ?? record.run_id);
  if (expectedAction === 'run' && !runId) return null;
  return {
    accepted: true,
    action: expectedAction,
    jobId,
    ...(runId ? { runId } : {}),
    ...(status ? { status } : {}),
  };
}

export async function manageCronJob(
  config: OpenSwanConfig,
  action: 'run' | 'update' | 'remove',
  jobId: string,
  patch?: any,
): Promise<{
  ok: boolean;
  reply?: string;
  error?: string;
  runId?: string;
  receipt?: CronMutationReceipt;
  outcomeUnknown?: boolean;
}> {
  try {
    const params: any = { action, jobId };
    if (action === 'update' && patch) params.patch = patch;
    if (action === 'run') params.runMode = 'force';
    const result = await invokeToolRaw(config, 'cron', params);
    if (!result.ok) {
      const knownRejection = result.error?.type === 'auth' || result.error?.type === 'unsupported';
      return {
        ok: false,
        error: result.error?.message,
        ...(!knownRejection ? { outcomeUnknown: true } : {}),
      };
    }
    const receipt = parseCronMutationReceipt(result.result?.details, action, jobId);
    if (!receipt) {
      return {
        ok: false,
        error: 'OpenSwan did not return a trustworthy structured cron acknowledgement. The outcome is unknown; inspect the schedule before retrying.',
        outcomeUnknown: true,
      };
    }
    const text = result.result?.content?.[0]?.text;
    return {
      ok: true,
      ...(typeof text === 'string' && text.trim() ? { reply: text } : {}),
      ...(receipt.runId ? { runId: receipt.runId } : {}),
      receipt,
    };
  } catch (e: any) {
    return { ok: false, error: e.message, outcomeUnknown: true };
  }
}

export async function createCronJob(
  config: OpenSwanConfig,
  opts: { name: string; schedule: string; task: string; sessionTarget?: string; timezone?: string; enabled?: boolean },
): Promise<{
  ok: boolean;
  jobId?: string;
  error?: string;
  receipt?: CronMutationReceipt;
  outcomeUnknown?: boolean;
}> {
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
    if (!result.ok) {
      const knownRejection = result.error?.type === 'auth' || result.error?.type === 'unsupported';
      return {
        ok: false,
        error: result.error?.message,
        ...(!knownRejection ? { outcomeUnknown: true } : {}),
      };
    }
    const receipt = parseCronMutationReceipt(result.result?.details, 'create');
    if (!receipt) {
      return {
        ok: false,
        error: 'OpenSwan did not return a trustworthy structured cron creation receipt. The outcome is unknown; inspect the schedule before retrying.',
        outcomeUnknown: true,
      };
    }
    return { ok: true, jobId: receipt.jobId, receipt };
  } catch (e: any) {
    return { ok: false, error: e.message, outcomeUnknown: true };
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
): Promise<{
  ok: boolean;
  reply?: string;
  error?: string;
  providerRunId?: string;
  sessionKey?: string;
  providerStatus?: string;
  transportAccepted?: boolean | null;
}> {
  try {
    // Keep a margin inside invokeToolRaw's 30s client timeout so OpenSwan can
    // return its structured `timeout` disposition instead of leaving dispatch
    // acceptance ambiguous at the HTTP boundary.
    const result = await invokeToolRaw(config, 'sessions_send', { sessionKey, message, timeoutSeconds: 25 });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error?.message,
        transportAccepted: null,
      };
    }
    const handle = parseOpenSwanSessionSendHandleCore(result.result);
    if (!handle) {
      return {
        ok: false,
        error: 'OpenSwan returned no structured session-send disposition; dispatch outcome is unknown.',
        transportAccepted: null,
      };
    }
    // Current accepted/ended/timeout dispositions carry both exact identities.
    // Require the provider run id and require the echoed session to match the
    // requested session before exposing any positive acceptance signal.
    if (
      handle.transportAccepted === true
      && (!handle.providerRunId || !handle.sessionKey || handle.sessionKey !== sessionKey)
    ) {
      return {
        ok: false,
        error: 'OpenSwan returned a session-send disposition without trustworthy matching lineage. The dispatch outcome is unknown; the task was not replayed.',
        providerRunId: handle.providerRunId || undefined,
        sessionKey: handle.sessionKey || undefined,
        providerStatus: handle.providerStatus,
        transportAccepted: null,
      };
    }
    const lineage = {
      providerRunId: handle.providerRunId || undefined,
      sessionKey: handle.sessionKey || undefined,
      providerStatus: handle.providerStatus,
      transportAccepted: handle.transportAccepted,
    };
    if (handle.transportAccepted === false) {
      return {
        ok: false,
        error: `OpenSwan rejected the session send (${handle.providerStatus}).`,
        ...lineage,
      };
    }
    if (handle.transportAccepted !== true) {
      return {
        ok: false,
        error: `OpenSwan returned ${handle.providerStatus}, but could not prove whether the session send began. The task was not replayed.`,
        ...lineage,
      };
    }
    if (handle.phase === 'response_timeout') {
      return {
        ok: true,
        reply: 'The session accepted the task. Its response is still pending.',
        ...lineage,
      };
    }
    let structuredReply = '';
    try {
      const rawReply = result.result?.details?.reply;
      if (typeof rawReply === 'string') structuredReply = rawReply.trim().slice(0, 4_000);
    } catch {}
    return {
      ok: true,
      reply: structuredReply || (handle.phase === 'turn_ended' ? 'The provider turn ended; task completion remains unverified.' : 'Message accepted.'),
      ...lineage,
    };
  } catch (e: any) {
    return { ok: false, error: e.message, transportAccepted: null };
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

export interface OpenSwanWebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet?: string;
}

function normalizeWebSearchCitation(value: unknown): OpenSwanWebSearchResult | null {
  if (!isProviderRecord(value)) return null;
  const title = readOptionalProviderText(value.title, 240);
  const urlText = readOptionalProviderText(value.url, 2_048);
  const snippet = readOptionalProviderContent(value.snippet ?? value.description, 1_200);
  if (!title || title === INVALID_PROVIDER_FIELD || !urlText || urlText === INVALID_PROVIDER_FIELD || snippet === INVALID_PROVIDER_FIELD) {
    return null;
  }
  try {
    const parsed = new URL(urlText);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return { title, url: parsed.toString(), ...(snippet ? { snippet } : {}) };
  } catch {
    return null;
  }
}

export async function runWebSearch(
  config: OpenSwanConfig,
  query: string,
): Promise<{ ok: boolean; results?: OpenSwanWebSearchResult[]; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'web_search', { query, count: 5 });
    if (!result.ok) return { ok: false, error: result.error?.message };
    const rawCitations = result.result?.details?.citations;
    if (!Array.isArray(rawCitations) || rawCitations.length > 50) {
      return { ok: false, error: 'OpenSwan returned no structured web-search citations' };
    }
    const results: Array<OpenSwanWebSearchResult | null> = (rawCitations as unknown[])
      .map(normalizeWebSearchCitation);
    const urls = results.map(citation => citation?.url);
    if (!results.every((citation): citation is OpenSwanWebSearchResult => !!citation) || new Set(urls).size !== urls.length) {
      return { ok: false, error: 'OpenSwan returned malformed or duplicate web-search citations' };
    }
    return { ok: true, results };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// ─── Parsers ────────────────────────────────────

const INVALID_PROVIDER_FIELD = Symbol('invalid-provider-field');
type OptionalProviderText = string | undefined | typeof INVALID_PROVIDER_FIELD;
type OptionalProviderNumber = number | undefined | typeof INVALID_PROVIDER_FIELD;

function isProviderRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readOptionalProviderText(value: unknown, maxChars: number): OptionalProviderText {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') return INVALID_PROVIDER_FIELD;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxChars || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) {
    return INVALID_PROVIDER_FIELD;
  }
  return normalized;
}

function readOptionalProviderContent(value: unknown, maxChars: number): OptionalProviderText {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return INVALID_PROVIDER_FIELD;
  if (value.length > maxChars || /[\u0000\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
    return INVALID_PROVIDER_FIELD;
  }
  return value;
}

function readOptionalProviderNumber(value: unknown): OptionalProviderNumber {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return INVALID_PROVIDER_FIELD;
  }
  return value;
}

function readOptionalProviderDate(value: unknown): OptionalProviderText {
  if (value === undefined || value === null || value === '') return undefined;
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.length > 80)) {
    return INVALID_PROVIDER_FIELD;
  }
  const millis = typeof value === 'number' && value < 10_000_000_000 ? value * 1_000 : Date.parse(String(value));
  const normalizedMillis = typeof value === 'number' && value >= 10_000_000_000 ? value : millis;
  if (!Number.isFinite(normalizedMillis)) return INVALID_PROVIDER_FIELD;
  try {
    return new Date(normalizedMillis).toISOString();
  } catch {
    return INVALID_PROVIDER_FIELD;
  }
}

function readExactSessionKey(value: unknown): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
    ? value
    : null;
}

function parseStructuredProviderMessages(
  value: unknown,
  maxRows: number,
): Array<{ role: string; content: string; timestamp?: string }> | null {
  if (!Array.isArray(value) || value.length > maxRows) return null;
  const messages: Array<{ role: string; content: string; timestamp?: string }> = [];
  for (const rawMessage of value) {
    if (!isProviderRecord(rawMessage)) return null;
    const role = readOptionalProviderText(rawMessage.role, 32);
    if (!role || role === INVALID_PROVIDER_FIELD) return null;
    let content = '';
    if (typeof rawMessage.content === 'string') {
      const parsed = readOptionalProviderContent(rawMessage.content, 12_000);
      if (parsed === INVALID_PROVIDER_FIELD) return null;
      content = parsed || '';
    } else if (Array.isArray(rawMessage.content)) {
      const pieces: string[] = [];
      if (rawMessage.content.length > 100) return null;
      for (const block of rawMessage.content) {
        if (!isProviderRecord(block)) return null;
        if (block.type !== 'text') continue;
        const text = readOptionalProviderContent(block.text, 12_000);
        if (text === INVALID_PROVIDER_FIELD) return null;
        if (text) pieces.push(text);
      }
      content = pieces.join('').slice(0, 12_000);
    } else if (rawMessage.content !== undefined && rawMessage.content !== null) {
      return null;
    }
    const timestamp = readOptionalProviderDate(rawMessage.timestamp);
    if (timestamp === INVALID_PROVIDER_FIELD) return null;
    messages.push({ role, content, ...(timestamp ? { timestamp } : {}) });
  }
  return messages;
}

/** Structured sessions_list evidence used for runtime identity and bindings. */
function parseSessionsList(raw: unknown): OpenSwanSession[] | null {
  if (!isProviderRecord(raw) || !isProviderRecord(raw.details) || !Array.isArray(raw.details.sessions)) {
    return null;
  }
  const rawSessions = raw.details.sessions;
  if (rawSessions.length > 512) return null;
  const sessions: OpenSwanSession[] = [];
  const seen = new Set<string>();
  for (const rawSession of rawSessions) {
    if (!isProviderRecord(rawSession)) return null;
    if (
      rawSession.sessionKey !== undefined
      && rawSession.key !== undefined
      && rawSession.sessionKey !== rawSession.key
    ) return null;
    const sessionKey = readExactSessionKey(rawSession.sessionKey ?? rawSession.key);
    if (!sessionKey || seen.has(sessionKey)) return null;
    seen.add(sessionKey);

    const kind = readOptionalProviderText(rawSession.kind, 64);
    const agentId = readOptionalProviderText(
      rawSession.agentId ?? rawSession.agent ?? rawSession.displayName,
      160,
    );
    const model = readOptionalProviderText(rawSession.model, 160);
    const lastActivity = readOptionalProviderDate(rawSession.updatedAt ?? rawSession.lastActivity);
    const messageCount = readOptionalProviderNumber(rawSession.totalTokens ?? rawSession.messageCount);
    if (
      kind === INVALID_PROVIDER_FIELD
      || agentId === INVALID_PROVIDER_FIELD
      || model === INVALID_PROVIDER_FIELD
      || lastActivity === INVALID_PROVIDER_FIELD
      || messageCount === INVALID_PROVIDER_FIELD
    ) return null;
    const lastMessages = rawSession.messages === undefined
      ? undefined
      : parseStructuredProviderMessages(rawSession.messages, 20);
    if (lastMessages === null) return null;
    sessions.push({
      sessionKey,
      kind: kind || 'unknown',
      ...(agentId ? { agentId } : {}),
      ...(model ? { model } : {}),
      ...(lastActivity ? { lastActivity } : {}),
      ...(messageCount !== undefined ? { messageCount } : {}),
      ...(lastMessages ? { lastMessages } : {}),
    });
  }
  return sessions;
}

function parseSessionStatus(raw: unknown, sessionKey: string): OpenSwanSessionStatus | null {
  if (!isProviderRecord(raw) || !isProviderRecord(raw.details)) return null;
  const details = raw.details;
  if (details.ok !== true || details.sessionKey !== sessionKey) return null;
  const statusText = readOptionalProviderContent(details.statusText, 20_000);
  if (!statusText || statusText === INVALID_PROVIDER_FIELD) return null;
  const text = statusText;

  // Parse the emoji-formatted status text
  const result: OpenSwanSessionStatus = { sessionKey };

  // Model: 🧠 Model: anthropic/claude-opus-4-6
  const modelMatch = text.match(/Model:\s*([^\s·]+)/);
  if (modelMatch) {
    const model = readOptionalProviderText(modelMatch[1], 160);
    if (model && model !== INVALID_PROVIDER_FIELD) result.model = model;
  }

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
    const cost = parseFloat(costMatch[1]);
    if (Number.isFinite(cost) && cost >= 0) result.totalCost = cost;
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
  if (uptimeMatch) {
    const uptime = readOptionalProviderText(uptimeMatch[1], 160);
    if (uptime && uptime !== INVALID_PROVIDER_FIELD) result.uptime = uptime;
  }

  return Object.keys(result).length > 1 ? result : null;
}

function parseTokenCount(s: string): number {
  const num = parseFloat(s);
  if (s.toLowerCase().endsWith('k')) return Math.round(num * 1000);
  if (s.toLowerCase().endsWith('m')) return Math.round(num * 1000000);
  return Math.round(num);
}

function parseHistory(raw: unknown, sessionKey: string): Array<{ role: string; content: string }> | null {
  if (!isProviderRecord(raw) || !isProviderRecord(raw.details)) return null;
  const details = raw.details;
  if (details.sessionKey !== sessionKey) return null;
  const messages = parseStructuredProviderMessages(details.messages, 200);
  return messages?.map(({ role, content }) => ({ role, content })) ?? null;
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

function readOpenSwanSubagentDisplayField(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.slice(0, maxChars);
}

function normalizeLegacyOpenSwanSubagent(value: unknown): OpenSwanSubAgent | null {
  if (!isProviderRecord(value)) return null;
  const id = readExactSessionKey(value.id ?? value.sessionKey);
  if (!id) return null;
  const sessionKey = value.sessionKey === undefined ? undefined : readExactSessionKey(value.sessionKey);
  if (value.sessionKey !== undefined && !sessionKey) return null;
  const name = readOptionalProviderText(value.name ?? value.displayName, 96);
  const status = readOptionalProviderText(value.status, 80);
  const model = readOptionalProviderText(value.model, 120);
  const task = readOptionalProviderText(value.task ?? value.description, 240);
  if (
    name === INVALID_PROVIDER_FIELD
    || status === INVALID_PROVIDER_FIELD
    || model === INVALID_PROVIDER_FIELD
    || task === INVALID_PROVIDER_FIELD
  ) return null;
  return {
    id,
    ...(name ? { name } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    status: status || 'unknown',
    ...(model ? { model } : {}),
    ...(task ? { task } : {}),
  };
}

export async function listSubAgentsDetailed(
  config: OpenSwanConfig,
): Promise<{ ok: boolean; subagents: OpenSwanSubAgent[]; error?: string }> {
  try {
    const result = await invokeToolRaw(config, 'subagents', { action: 'list' });
    if (!result.ok) return { ok: false, subagents: [], error: result.error?.message };
    const raw = result.result;
    let subagents: OpenSwanSubAgent[] = [];

    // Current OpenSwan returns exact active/recent lifecycle buckets. Lifecycle
    // identity/status comes only from the pure structured parser; label/task
    // fields below are bounded display copy and never completion evidence.
    const lifecycle = parseOpenSwanSubagentLifecycleSnapshotCore(raw);
    if (lifecycle) {
      const activeRows = Array.isArray(raw?.details?.active) ? raw.details.active : null;
      const recentRows = Array.isArray(raw?.details?.recent) ? raw.details.recent : null;
      if (
        !activeRows
        || !recentRows
        || lifecycle.active.length !== activeRows.length
        || lifecycle.recent.length !== recentRows.length
      ) {
        return { ok: false, subagents: [], error: 'OpenSwan returned a partial or malformed subagent inventory' };
      }
      const displayRows = [
        ...activeRows,
        ...recentRows,
      ];
      subagents = [...lifecycle.active, ...lifecycle.recent].map((record) => {
        let display: any = null;
        try {
          const matches = displayRows.filter((candidate: any) => (
            candidate
            && typeof candidate === 'object'
            && candidate.runId === record.providerRunId
            && candidate.sessionKey === record.childSessionKey
          ));
          if (matches.length === 1) display = matches[0];
        } catch {}
        const displayField = (key: 'label' | 'model' | 'task', maxChars: number) => {
          try { return readOpenSwanSubagentDisplayField(display?.[key], maxChars); } catch { return undefined; }
        };
        return {
          id: record.providerRunId,
          name: displayField('label', 96),
          sessionKey: record.childSessionKey,
          status: record.runtimeStatus,
          model: displayField('model', 120),
          task: displayField('task', 240),
        };
      });
      const exactIds = subagents.map(subagent => subagent.id);
      if (new Set(exactIds).size !== exactIds.length) {
        return { ok: false, subagents: [], error: 'OpenSwan returned an ambiguous duplicate subagent inventory' };
      }
    } else if (Array.isArray(raw?.details?.subagents) && raw.details.subagents.length <= 512) {
      // Structured legacy compatibility only. Prose/JSON-text fallback is
      // intentionally not used for lifecycle identity.
      const normalized: Array<OpenSwanSubAgent | null> = (raw.details.subagents as unknown[])
        .map(normalizeLegacyOpenSwanSubagent);
      const ids = normalized.map(subagent => subagent?.id);
      if (!normalized.every((subagent): subagent is OpenSwanSubAgent => !!subagent) || new Set(ids).size !== ids.length) {
        return { ok: false, subagents: [], error: 'OpenSwan returned a malformed or duplicate legacy subagent inventory' };
      }
      subagents = normalized;
    } else {
      return { ok: false, subagents: [], error: 'OpenSwan returned no structured subagent inventory' };
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
