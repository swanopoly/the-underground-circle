import { Platform } from 'react-native';
import { listMcpServers, fetchAllMcpTools, type McpTool } from './mcpClient';
import { loadConnections, type AgentConnection } from './connectionManager';
import {
  getCircleIntegrationCapabilities,
  getInstalledIntegrationProviders,
  type CircleIntegrationProvider,
} from './circleIntegrations';

export type ComputerCapabilityId =
  | 'browser_automation'
  | 'browser_sessions'
  | 'file_search'
  | 'file_read'
  | 'file_write'
  | 'app_tools'
  | 'agent_bridges'
  | 'desktop_control';

export type ComputerCapabilityStatus = 'ready' | 'partial' | 'missing';

export interface ComputerCapabilityFinding {
  id: ComputerCapabilityId;
  label: string;
  status: ComputerCapabilityStatus;
  detail: string;
  sources: string[];
}

export interface ComputerCapabilityAudit {
  findings: ComputerCapabilityFinding[];
  missing: ComputerCapabilityId[];
  availableIntegrationProviders: CircleIntegrationProvider[];
  availableIntegrationCapabilities: string[];
  activeBridgeProviders: string[];
  activeMcpServerCount: number;
  activeMcpToolCount: number;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function toolMatches(tool: Pick<McpTool, 'name' | 'description'>, needles: string[]): boolean {
  const haystack = `${normalizeText(tool.name)} ${normalizeText(tool.description)}`;
  return needles.some((needle) => haystack.includes(needle));
}

function isFilesystemTool(tool: Pick<McpTool, 'name' | 'description'>): boolean {
  return toolMatches(tool, [
    'filesystem',
    'file system',
    'read file',
    'write file',
    'search files',
    'list directory',
    'glob',
    'ripgrep',
    'search path',
    'find file',
  ]);
}

function isDesktopOrAppTool(tool: Pick<McpTool, 'name' | 'description'>): boolean {
  return toolMatches(tool, [
    'desktop',
    'application',
    'window',
    'slack',
    'figma',
    'notion',
    'github',
    'browser',
    'playwright',
    'computer',
    'app',
  ]);
}

function hasCapability(capabilities: string[], capability: string): boolean {
  return new Set(capabilities).has(capability);
}

/**
 * Probe the local desktop bridge with a short timeout. Returns true
 * when /desktop/health responds with `supported: true` — i.e. we can
 * actually launch / focus / type / read the AX tree on this machine.
 * Any failure (timeout, DNS, network) returns false without throwing
 * so the audit stays non-blocking.
 */
async function probeDesktopBridge(): Promise<boolean> {
  if (typeof fetch === 'undefined') return false;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 500) : null;
    const res = await fetch('http://localhost:7778/desktop/health', {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return false;
    const json = (await res.json()) as { ok?: boolean; supported?: boolean };
    return !!json?.supported;
  } catch { return false; }
}

/**
 * Probe the Claude bridge at localhost:7778/health. Returns true when the
 * bridge responds with `{ ok: true }` — meaning filesystem ops via /exec
 * are available on this machine.
 *
 * Only runs on web (where the audit runs). Native skips immediately.
 * Uses a 1500ms hard timeout so the audit stays non-blocking.
 * All errors are swallowed — bridge absence is the common case for non-dev
 * users and should never surface a warning.
 */
async function probeClaudeBridge(): Promise<boolean> {
  if (Platform.OS !== 'web') return false;
  if (typeof fetch === 'undefined') return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const resp = await fetch('http://localhost:7778/health', {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return false;
    const data = await resp.json().catch(() => null) as { ok?: boolean } | null;
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

function summarizeSources(parts: Array<string | null | undefined>): string[] {
  const unique = new Set<string>();
  for (const part of parts) {
    const text = String(part || '').trim();
    if (text) unique.add(text);
  }
  return Array.from(unique);
}

export async function auditComputerCapabilities(circleId: string): Promise<ComputerCapabilityAudit> {
  // UC-5 follow-up: the local desktop bridge IS an app-control
  // capability — the original audit only counted MCP tools +
  // integrations, so the agent got told "missing: app_tools" even when
  // /desktop/health was reporting launch/focus/type/keys/a11y_tree.
  // Probing here (unauthenticated health endpoint) stays cheap and
  // never blocks — a 500ms timeout falls through to "no bridge".
  const [connections, integrationProviders, integrationCapabilities, mcpServers, bridgeAlive, claudeBridgeAvailable] = await Promise.all([
    loadConnections().catch(() => [] as AgentConnection[]),
    getInstalledIntegrationProviders(circleId).catch(() => [] as CircleIntegrationProvider[]),
    getCircleIntegrationCapabilities(circleId).catch(() => [] as string[]),
    listMcpServers(circleId).catch(() => []),
    probeDesktopBridge().catch(() => false),
    probeClaudeBridge().catch(() => false),
  ]);

  const mcpTools = mcpServers.length > 0
    ? await fetchAllMcpTools(circleId).catch(() => [] as McpTool[])
    : [];

  const enabledConnections = connections.filter((conn) => conn.enabled);
  const filesystemTools = mcpTools.filter(isFilesystemTool);
  const appTools = mcpTools.filter(isDesktopOrAppTool);

  const browserAvailable =
    hasCapability(integrationCapabilities, 'web_automation') ||
    hasCapability(integrationCapabilities, 'remote_browser_sessions');
  const browserSources = summarizeSources([
    browserAvailable ? 'circle integration: browser automation' : null,
    integrationProviders.includes('browserbase') ? 'integration: Browserbase' : null,
  ]);

  const bridgeSources = enabledConnections.map((conn) => `bridge: ${conn.provider}`);
  const fileSources = summarizeSources([
    filesystemTools.length > 0 ? `mcp tools: ${filesystemTools.length} filesystem tool${filesystemTools.length === 1 ? '' : 's'}` : null,
    enabledConnections.some((conn) => conn.provider === 'openswan') ? 'bridge: openswan' : null,
  ]);

  const appSources = summarizeSources([
    appTools.length > 0 ? `mcp tools: ${appTools.length} app/desktop tool${appTools.length === 1 ? '' : 's'}` : null,
    integrationProviders.length > 0 ? `integrations: ${integrationProviders.length}` : null,
    enabledConnections.length > 0 ? `bridges: ${enabledConnections.length}` : null,
    bridgeAlive ? 'desktop bridge: launch/focus/type/keys/a11y_tree' : null,
  ]);

  const findings: ComputerCapabilityFinding[] = [
    {
      id: 'browser_automation',
      label: 'Browser automation',
      status: browserAvailable ? 'ready' : 'missing',
      detail: browserAvailable
        ? 'The circle can launch browser/computer tasks through the existing computer-use flow.'
        : 'No active browser automation integration is visible for this circle yet.',
      sources: browserSources,
    },
    {
      id: 'browser_sessions',
      label: 'Remote browser sessions',
      status: hasCapability(integrationCapabilities, 'remote_browser_sessions') ? 'ready' : browserAvailable ? 'partial' : 'missing',
      detail: hasCapability(integrationCapabilities, 'remote_browser_sessions')
        ? 'Remote browser session infrastructure is installed.'
        : browserAvailable
          ? 'Browser automation exists, but durable session capability is not clearly exposed in the capability map.'
          : 'No remote browser session provider is configured.',
      sources: browserSources,
    },
    {
      id: 'file_search',
      label: 'File search',
      status: filesystemTools.length > 0
        ? 'ready'
        : claudeBridgeAvailable || enabledConnections.length > 0
          ? 'partial'
          : 'missing',
      detail: filesystemTools.length > 0
        ? 'Filesystem-oriented MCP tools are available for locating files/content.'
        : claudeBridgeAvailable
          ? 'Local Claude bridge available for filesystem ops via /exec.'
          : enabledConnections.length > 0
            ? 'Bridges exist, but no canonical filesystem toolset is visible yet.'
            : 'No filesystem capability source is active yet.',
      sources: summarizeSources([
        ...fileSources,
        claudeBridgeAvailable ? 'Claude bridge (localhost:7778)' : null,
      ]),
    },
    {
      id: 'file_read',
      label: 'File read access',
      status: filesystemTools.length > 0
        ? 'ready'
        : claudeBridgeAvailable || enabledConnections.length > 0
          ? 'partial'
          : 'missing',
      detail: filesystemTools.length > 0
        ? 'The circle can likely read granted files through MCP filesystem tools.'
        : claudeBridgeAvailable
          ? 'Local Claude bridge available for filesystem ops via /exec.'
          : enabledConnections.length > 0
            ? 'A bridge may support file access, but there is no canonical read contract yet.'
            : 'No file-read surface is discoverable yet.',
      sources: summarizeSources([
        ...fileSources,
        claudeBridgeAvailable ? 'Claude bridge (localhost:7778)' : null,
      ]),
    },
    {
      id: 'file_write',
      label: 'File write access',
      status: toolMatches({ name: filesystemTools.map((tool) => tool.name).join(' '), description: filesystemTools.map((tool) => tool.description || '').join(' ') }, ['write file', 'edit file', 'save file']) ? 'partial' : 'missing',
      detail: toolMatches({ name: filesystemTools.map((tool) => tool.name).join(' '), description: filesystemTools.map((tool) => tool.description || '').join(' ') }, ['write file', 'edit file', 'save file'])
        ? 'Some filesystem tooling suggests write/edit support, but write scopes are not normalized yet.'
        : 'Write-capable file access is not yet modeled as a trusted computer capability.',
      sources: fileSources,
    },
    {
      id: 'app_tools',
      label: 'App tools',
      status:
        bridgeAlive || appTools.length > 0 || integrationProviders.length > 0
          ? 'ready'
          : enabledConnections.length > 0
            ? 'partial'
            : 'missing',
      detail: bridgeAlive
        ? 'Desktop bridge is live on localhost:7778 — launch/focus/type/keys/a11y_tree/click_element are all available.'
        : appTools.length > 0 || integrationProviders.length > 0
          ? 'The circle has app-level capability sources through MCP tools and/or installed integrations.'
          : enabledConnections.length > 0
            ? 'Local or remote bridges exist, but app access is not normalized into a shared capability map yet.'
            : 'No app-tool surface is currently visible.',
      sources: appSources,
    },
    {
      id: 'agent_bridges',
      label: 'Agent bridges',
      status: enabledConnections.length > 0 ? 'ready' : 'missing',
      detail: enabledConnections.length > 0
        ? 'Local or remote agent bridges are enabled and can extend what the circle can do.'
        : 'No enabled agent bridges are visible.',
      sources: bridgeSources,
    },
    {
      id: 'desktop_control',
      label: 'Desktop/native app control',
      status: bridgeAlive
        ? 'ready'
        : appTools.length > 0 && appTools.some((tool) => toolMatches(tool, ['desktop', 'window', 'computer']))
          ? 'partial'
          : 'missing',
      detail: bridgeAlive
        ? 'The local desktop bridge exposes native launch/focus/type/keys + AX tree reads and semantic clicks — first-class native control on this machine.'
        : appTools.length > 0 && appTools.some((tool) => toolMatches(tool, ['desktop', 'window', 'computer']))
          ? 'There are early signals of desktop-oriented tools, but native app control is not yet a mature first-class runtime.'
          : 'Native desktop control is not yet a real canonical capability in the app.',
      sources: appSources,
    },
  ];

  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: integrationProviders,
    availableIntegrationCapabilities: integrationCapabilities,
    activeBridgeProviders: enabledConnections.map((conn) => conn.provider),
    activeMcpServerCount: mcpServers.length,
    activeMcpToolCount: mcpTools.length,
  };
}

export function summarizeComputerCapabilityAudit(audit: ComputerCapabilityAudit): string {
  const ready = audit.findings.filter((finding) => finding.status === 'ready').length;
  const partial = audit.findings.filter((finding) => finding.status === 'partial').length;
  const missing = audit.findings.filter((finding) => finding.status === 'missing').length;

  return [
    `Computer capability audit: ${ready} ready, ${partial} partial, ${missing} missing.`,
    audit.findings.map((finding) => `${finding.label}: ${finding.status.toUpperCase()} — ${finding.detail}`).join('\n'),
  ].join('\n');
}
