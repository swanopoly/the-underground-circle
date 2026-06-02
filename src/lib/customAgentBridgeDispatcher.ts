import type { AgentConnection } from './connectionManager';
import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';

export interface CustomAgentBridgeTarget {
  id?: string | null;
  name: string;
  provider: string;
  gatewayUrl?: string | null;
  circleId?: string | null;
  model?: string | null;
  sessionKey?: string | null;
}

export interface CustomAgentBridgeDispatchResult {
  ok: boolean;
  response?: string;
  error?: string;
  endpoint?: string;
  path?: string;
  provider: string;
}

const TASK_ENDPOINTS = ['/task', '/tasks', '/message', '/chat', '/run'];
const AGENT_PROVIDERS_WITH_GENERIC_BRIDGES = new Set([
  'generic-agent',
  'opencode',
  'aider',
  'cline',
  'windsurf',
  'copilot',
  'continue',
  'amp',
]);

export function normalizeCustomAgentProvider(provider: string | null | undefined): string {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  if (normalized === 'open-code' || normalized === 'opencode-ai') return 'opencode';
  if (normalized === 'custom' || normalized === 'other') return 'generic-agent';
  return normalized;
}

export function supportsGenericCustomAgentDispatch(provider: string | null | undefined): boolean {
  return AGENT_PROVIDERS_WITH_GENERIC_BRIDGES.has(normalizeCustomAgentProvider(provider));
}

export function findCustomAgentConnection(
  target: CustomAgentBridgeTarget,
  connections: AgentConnection[],
): AgentConnection | null {
  const provider = normalizeCustomAgentProvider(target.provider);
  const targetName = normalizeName(target.name);
  const gateway = normalizeEndpoint(target.gatewayUrl);

  const candidates = connections.filter((conn) => {
    if (!conn.enabled) return false;
    const connProvider = normalizeCustomAgentProvider(conn.provider);
    if (connProvider === provider) return true;
    if (provider !== 'generic-agent' && connProvider === 'generic-agent') return true;
    if (gateway && normalizeEndpoint(conn.endpoint) === gateway) return true;
    return targetName && normalizeName(conn.name) === targetName;
  });

  return candidates.find((conn) => normalizeEndpoint(conn.endpoint) === gateway)
    || candidates.find((conn) => normalizeCustomAgentProvider(conn.provider) === provider)
    || candidates[0]
    || null;
}

export async function dispatchCustomAgentBridgeTask(
  target: CustomAgentBridgeTarget,
  task: string,
  connections: AgentConnection[],
): Promise<CustomAgentBridgeDispatchResult> {
  const provider = normalizeCustomAgentProvider(target.provider);
  if (!supportsGenericCustomAgentDispatch(provider)) {
    return {
      ok: false,
      error: `Generic bridge dispatch is not enabled for ${target.provider || 'this provider'}.`,
      provider,
    };
  }

  const connection = findCustomAgentConnection(target, connections);
  const targetGateway = normalizeEndpoint(target.gatewayUrl);
  if (!connection && !targetGateway) {
    return {
      ok: false,
      error: `No enabled ${formatProviderLabel(provider)} bridge connection is available. Connect the agent from Office, or publish it with a gateway URL.`,
      provider,
    };
  }

  const endpoint = normalizeEndpoint(target.gatewayUrl || connection?.endpoint);
  if (!endpoint || !isValidBridgeEndpoint(endpoint)) {
    return {
      ok: false,
      error: `The ${formatProviderLabel(provider)} bridge endpoint is missing or invalid.`,
      provider,
    };
  }

  const headers = buildHeaders(connection?.token);
  const profiledTask = applyAgentDevelopmentStandardsToPrompt(task, {
    label: 'The selected external agent bridge must follow these repo standards for this chat handoff.',
  });
  const body = {
    task: profiledTask,
    message: profiledTask,
    prompt: profiledTask,
    originalTask: task,
    agentName: target.name,
    provider,
    model: target.model || undefined,
    sessionId: target.sessionKey || undefined,
    circleId: target.circleId || undefined,
    source: 'underground-circle-chat',
  };

  const errors: string[] = [];
  for (const path of TASK_ENDPOINTS) {
    const url = `${endpoint}${path}`;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const text = await res.text().catch(() => '');
      const json = parseJson(text);
      if (res.ok && isSuccessfulBody(json, text)) {
        return {
          ok: true,
          response: extractResponse(json, text) || `${formatProviderLabel(provider)} accepted the task.`,
          endpoint,
          path,
          provider,
        };
      }

      const detail = extractError(json, text) || `HTTP ${res.status}`;
      errors.push(`${path}: ${detail}`);
      if (res.status === 404 || res.status === 405) continue;
      if (res.status === 401 || res.status === 403) break;
    } catch (error: any) {
      errors.push(`${path}: ${error?.name === 'AbortError' ? 'request timed out' : error?.message || 'request failed'}`);
    }
  }

  return {
    ok: false,
    error: errors.length
      ? `Could not dispatch to ${formatProviderLabel(provider)} bridge. ${errors.join('; ')}`
      : `Could not dispatch to ${formatProviderLabel(provider)} bridge.`,
    endpoint,
    provider,
  };
}

function normalizeEndpoint(endpoint: string | null | undefined): string {
  return String(endpoint || '').trim().replace(/\/+$/, '');
}

function isValidBridgeEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ');
}

function buildHeaders(token: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const cleanToken = String(token || '').trim();
  if (cleanToken) {
    headers.Authorization = `Bearer ${cleanToken}`;
    headers['X-UC-Agent-Token'] = cleanToken;
    headers['X-UC-Desktop-Token'] = cleanToken;
  }
  return headers;
}

function parseJson(text: string): any | null {
  if (!text.trim()) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function isSuccessfulBody(json: any | null, text: string): boolean {
  if (!json) return Boolean(text.trim());
  if (json.ok === false || json.success === false || json.error) return false;
  if (json.ok === true || json.success === true || json.accepted === true) return true;
  if (typeof json.response === 'string' || typeof json.message === 'string' || typeof json.result === 'string') return true;
  return true;
}

function extractResponse(json: any | null, text: string): string {
  if (!json) return text.trim();
  const value = json.response || json.reply || json.message || json.result || json.output || json.status;
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return JSON.stringify(value, null, 2);
  return text.trim();
}

function extractError(json: any | null, text: string): string {
  if (!json) return text.trim();
  const value = json.error || json.message || json.detail;
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return JSON.stringify(value);
  return text.trim();
}

function formatProviderLabel(provider: string): string {
  if (provider === 'opencode') return 'OpenCode';
  if (provider === 'generic-agent') return 'custom agent';
  return provider
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
