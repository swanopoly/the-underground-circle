import type { AgentConnection } from './connectionManager';
import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';

export interface CustomAgentBridgeTarget {
  id?: string | null;
  name: string;
  provider: string;
  gatewayUrl?: string | null;
  /** Public Office ownership. Used only to prohibit borrowing local secrets. */
  ownerId?: string | null;
  currentUserId?: string | null;
  isOwn?: boolean;
  source?: 'db' | 'openswan-session' | 'bridge-session' | 'default';
  /** Optional immutable local connection identity for a locally selected target. */
  connectionId?: string | null;
  circleId?: string | null;
  model?: string | null;
  sessionKey?: string | null;
}

export interface CustomAgentBridgeDispatchResult {
  ok: boolean;
  /** true=explicitly accepted; false=proven pre-dispatch rejection; null=do not replay. */
  transportAccepted: boolean | null;
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

  if (target.connectionId) {
    const exactId = connections.filter((conn) => conn.enabled && conn.id === target.connectionId);
    return exactId.length === 1 ? exactId[0] : null;
  }

  if (gateway) {
    const exactEndpoint = connections.filter((conn) => (
      conn.enabled && normalizeEndpoint(conn.endpoint) === gateway
    ));
    return exactEndpoint.length === 1 ? exactEndpoint[0] : null;
  }

  // A published Office row is a public profile, not a private connection
  // capability. Provider/name similarity must never select a local endpoint or
  // authorize its token for that row. Published targets require either an
  // immutable connection id or an explicit gateway whose endpoint matches.
  if (target.source === 'db') return null;

  const candidates = connections.filter((conn) => {
    if (!conn.enabled) return false;
    const connProvider = normalizeCustomAgentProvider(conn.provider);
    if (connProvider === provider) return true;
    if (provider !== 'generic-agent' && connProvider === 'generic-agent') return true;
    return targetName && normalizeName(conn.name) === targetName;
  });

  const providerMatches = candidates.filter((conn) => normalizeCustomAgentProvider(conn.provider) === provider);
  if (providerMatches.length === 1) return providerMatches[0];
  if (providerMatches.length > 1) return null;
  const genericMatches = candidates.filter((conn) => normalizeCustomAgentProvider(conn.provider) === 'generic-agent');
  return genericMatches.length === 1 ? genericMatches[0] : null;
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
      transportAccepted: false,
      error: `Generic bridge dispatch is not enabled for ${target.provider || 'this provider'}.`,
      provider,
    };
  }

  const connection = findCustomAgentConnection(target, connections);
  const targetGateway = normalizeEndpoint(target.gatewayUrl);
  const isPublishedOfficeTarget = target.source === 'db';
  const ownerId = String(target.ownerId || '').trim();
  const currentUserId = String(target.currentUserId || '').trim();
  const ownerIdsAgree = !!ownerId
    && !!currentUserId
    && ownerId === currentUserId;
  const hasOwnerAuthority = target.isOwn === true && ownerIdsAgree;
  const mayUseLocalConnection = targetGateway || isPublishedOfficeTarget
    ? hasOwnerAuthority
    : true;
  if (isPublishedOfficeTarget && target.isOwn === true && !hasOwnerAuthority) {
    return {
      ok: false,
      transportAccepted: false,
      error: `This published ${formatProviderLabel(provider)} agent is missing exact owner authorization. Nothing was dispatched.`,
      provider,
    };
  }
  if (!connection && !targetGateway) {
    return {
      ok: false,
      transportAccepted: false,
      error: `No enabled ${formatProviderLabel(provider)} bridge connection is available. Connect the agent from Office, or publish it with a gateway URL.`,
      provider,
    };
  }
  if (!targetGateway && !mayUseLocalConnection) {
    return {
      ok: false,
      transportAccepted: false,
      error: `This published ${formatProviderLabel(provider)} agent belongs to another circle member and has no explicitly authorized remote gateway. Nothing was dispatched.`,
      provider,
    };
  }

  const endpoint = normalizeEndpoint(target.gatewayUrl || connection?.endpoint);
  if (!endpoint || !isValidBridgeEndpoint(endpoint)) {
    return {
      ok: false,
      transportAccepted: false,
      error: `The ${formatProviderLabel(provider)} bridge endpoint is missing or invalid.`,
      provider,
    };
  }

  // A provider/name match is never authority to send a local secret to a
  // published gateway. Credentials require both owner authority and one exact
  // normalized endpoint match.
  const credentialConnection = mayUseLocalConnection
    && connection
    && connection.enabled
    && normalizeEndpoint(connection.endpoint) === endpoint
      ? connection
      : null;
  const headers = buildHeaders(credentialConnection?.token);
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
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 20_000);
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      timeout = null;

      const text = await res.text().catch(() => '');
      const json = parseJson(text);
      if (res.ok && isSuccessfulBody(json, text)) {
        return {
          ok: true,
          transportAccepted: true,
          response: extractResponse(json, text) || `${formatProviderLabel(provider)} accepted the task.`,
          endpoint,
          path,
          provider,
        };
      }

      const detail = extractError(json, text) || `HTTP ${res.status}`;
      errors.push(`${path}: ${detail}`);
      if (res.status === 404 || res.status === 405) continue;
      const provenPreDispatchRejection = res.status >= 400
        && res.status < 500
        && res.status !== 408
        && res.status !== 409;
      return {
        ok: false,
        transportAccepted: provenPreDispatchRejection ? false : null,
        error: provenPreDispatchRejection
          ? `The ${formatProviderLabel(provider)} bridge rejected the request before dispatch. ${detail}`
          : `The ${formatProviderLabel(provider)} bridge did not return trustworthy acceptance evidence. The task was not replayed. ${detail}`,
        endpoint,
        path,
        provider,
      };
    } catch (error: any) {
      const detail = error?.name === 'AbortError' ? 'request timed out' : error?.message || 'request failed';
      errors.push(`${path}: ${detail}`);
      return {
        ok: false,
        transportAccepted: null,
        error: `The ${formatProviderLabel(provider)} bridge response was lost or unavailable. The task was not replayed. ${detail}`,
        endpoint,
        path,
        provider,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  return {
    ok: false,
    transportAccepted: false,
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
  if (!json) return false;
  const status = typeof json.status === 'string' ? json.status.trim().toLowerCase() : '';
  if (['failed', 'failure', 'error', 'rejected', 'cancelled', 'canceled'].includes(status)) return false;
  if (json.ok === false || json.success === false || json.error) return false;
  if (json.ok === true || json.success === true || json.accepted === true) return true;
  return ['accepted', 'queued', 'started', 'running', 'ok', 'success'].includes(status);
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
  const value = json.error || json.message || json.detail || json.status;
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
