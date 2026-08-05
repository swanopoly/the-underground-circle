import { listMcpServers, fetchAllMcpTools, type McpTool } from './mcpClient';
import { loadConnections, type AgentConnection } from './connectionManager';
import {
  getCircleIntegrationCapabilities,
  getInstalledIntegrationProviders,
  type CircleIntegrationProvider,
} from './circleIntegrations';
import { getBridgeUrl } from './bridgeEnvironment';
import { isAgentBridgeCapabilityReady } from './computerCapabilityReadiness';

export { isAgentBridgeCapabilityReady } from './computerCapabilityReadiness';

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

type DesktopBridgeProbe = {
  supported: boolean;
  tools: string[];
};

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
 * Probe the local desktop bridge with a short timeout. Returns the advertised
 * tool list when /desktop/health responds with `supported: true`, otherwise
 * null. Any failure (timeout, DNS, network) returns null without throwing so
 * the audit stays non-blocking.
 */
async function probeDesktopBridge(): Promise<DesktopBridgeProbe | null> {
  if (typeof fetch === 'undefined') return null;
  const base = getBridgeUrl(7778);
  if (!base) return null;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 500) : null;
    const res = await fetch(`${base}/desktop/health`, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; supported?: boolean; tools?: unknown };
    if (!json?.supported) return null;
    return {
      supported: true,
      tools: Array.isArray(json.tools) ? json.tools.map(String) : [],
    };
  } catch { return null; }
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
  const [connections, integrationProviders, integrationCapabilities, mcpServers, bridgeProbe] = await Promise.all([
    loadConnections().catch(() => [] as AgentConnection[]),
    getInstalledIntegrationProviders(circleId).catch(() => [] as CircleIntegrationProvider[]),
    getCircleIntegrationCapabilities(circleId).catch(() => [] as string[]),
    listMcpServers(circleId).catch(() => []),
    probeDesktopBridge().catch(() => null),
  ]);

  const mcpTools = mcpServers.length > 0
    ? await fetchAllMcpTools(circleId).catch(() => [] as McpTool[])
    : [];

  const enabledConnections = connections.filter((conn) => conn.enabled);
  const filesystemTools = mcpTools.filter(isFilesystemTool);
  const appTools = mcpTools.filter(isDesktopOrAppTool);
  const bridgeAlive = !!bridgeProbe?.supported;
  const bridgeTools = new Set((bridgeProbe?.tools || []).map((tool) => tool.toLowerCase()));
  const bridgeHasFileSearch = bridgeAlive && (bridgeTools.has('file_search') || bridgeTools.has('file_list'));
  const bridgeHasFileRead = bridgeAlive && (bridgeTools.has('file_read') || bridgeTools.has('file_stat'));
  const bridgeHasFileWrite = bridgeAlive && (
    bridgeTools.has('file_write')
    || bridgeTools.has('file_rename')
    || bridgeTools.has('file_write_text')
    || bridgeTools.has('file_copy')
    || bridgeTools.has('file_trash')
    || bridgeTools.has('file_mkdir')
  );

  const browserAvailable =
    hasCapability(integrationCapabilities, 'web_automation') ||
    hasCapability(integrationCapabilities, 'remote_browser_sessions');
  const browserSources = summarizeSources([
    browserAvailable ? 'circle integration: browser automation' : null,
    integrationProviders.includes('browserbase') ? 'integration: Browserbase' : null,
  ]);

  // The live local bridge (claude-bridge.js on :7778) IS an agent bridge —
  // it's the Claude Code / Codex transport that serves the desktop endpoints.
  // So a successful health probe satisfies `agent_bridges` even when the
  // persisted connection store is empty (auto-connected bridges aren't always
  // written there). Without this, `agent_bridges` audited 'missing' while the
  // bridge was demonstrably alive — blocking unknown-app tasks (e.g. "create a
  // Notes note") with a phantom "Agent bridges missing" preflight.
  const agentBridgesReady = isAgentBridgeCapabilityReady({
    enabledConnectionCount: enabledConnections.length,
    bridgeAlive,
  });
  const bridgeSources = summarizeSources([
    ...enabledConnections.map((conn) => `bridge: ${conn.provider}`),
    bridgeAlive && enabledConnections.length === 0 ? 'desktop bridge: localhost:7778 (live health probe)' : null,
  ]);
  const fileSources = summarizeSources([
    bridgeHasFileSearch || bridgeHasFileRead || bridgeHasFileWrite
      ? `desktop bridge: ${[
          bridgeHasFileSearch ? 'file_search' : null,
          bridgeHasFileRead ? 'file_read/file_stat' : null,
          bridgeHasFileWrite ? 'file_write' : null,
        ].filter(Boolean).join('/')}`
      : null,
    filesystemTools.length > 0 ? `mcp tools: ${filesystemTools.length} filesystem tool${filesystemTools.length === 1 ? '' : 's'}` : null,
    enabledConnections.some((conn) => conn.provider === 'openswan') ? 'bridge: openswan' : null,
  ]);

  const appSources = summarizeSources([
    appTools.length > 0 ? `mcp tools: ${appTools.length} app/desktop tool${appTools.length === 1 ? '' : 's'}` : null,
    integrationProviders.length > 0 ? `integrations: ${integrationProviders.length}` : null,
    enabledConnections.length > 0 ? `bridges: ${enabledConnections.length}` : null,
    bridgeAlive ? 'desktop bridge: launch/focus/type/paste/keys/menu/mouse/a11y_tree' : null,
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
      status: bridgeHasFileSearch || filesystemTools.length > 0 ? 'ready' : enabledConnections.length > 0 || bridgeAlive ? 'partial' : 'missing',
      detail: bridgeHasFileSearch
        ? 'The local desktop bridge exposes scoped file search/list endpoints for approved local folders.'
        : filesystemTools.length > 0
        ? 'Filesystem-oriented MCP tools are available for locating files/content.'
        : enabledConnections.length > 0 || bridgeAlive
          ? 'Bridges exist, but no canonical filesystem toolset is visible yet.'
          : 'No filesystem capability source is active yet.',
      sources: fileSources,
    },
    {
      id: 'file_read',
	      label: 'File read access',
	      status: bridgeHasFileRead || filesystemTools.length > 0 ? 'ready' : enabledConnections.length > 0 || bridgeAlive ? 'partial' : 'missing',
	      detail: bridgeHasFileRead
	        ? 'The local desktop bridge exposes scoped file-read and metadata endpoints that the runtime can prepare automatically.'
        : filesystemTools.length > 0
        ? 'The circle can likely read granted files through MCP filesystem tools.'
        : enabledConnections.length > 0 || bridgeAlive
          ? 'A bridge may support file access, but there is no canonical read contract yet.'
          : 'No file-read surface is discoverable yet.',
      sources: fileSources,
    },
    {
      id: 'file_write',
      label: 'File write access',
      status: bridgeHasFileWrite
        ? 'ready'
        : toolMatches({ name: filesystemTools.map((tool) => tool.name).join(' '), description: filesystemTools.map((tool) => tool.description || '').join(' ') }, ['write file', 'edit file', 'save file']) ? 'partial' : 'missing',
	      detail: bridgeHasFileWrite
	        ? 'The local desktop bridge exposes scoped file-write, rename, copy, folder-create, and move-to-Trash endpoints that the runtime can prepare automatically.'
        : toolMatches({ name: filesystemTools.map((tool) => tool.name).join(' '), description: filesystemTools.map((tool) => tool.description || '').join(' ') }, ['write file', 'edit file', 'save file'])
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
        ? 'Desktop bridge is live on localhost:7778 — launch/focus/type/paste/keys/menu/mouse/a11y_tree/click_element/set_element_value are all available.'
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
      status: agentBridgesReady ? 'ready' : 'missing',
      detail: enabledConnections.length > 0
        ? 'Local or remote agent bridges are enabled and can extend what the circle can do.'
        : bridgeAlive
          ? 'The live local bridge on localhost:7778 (Claude Code / Codex transport) is reachable and can run agent tasks.'
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
        ? 'The local desktop bridge exposes native launch/focus/type/paste/keys/menu actions, mouse movement/click/hold/release/drag/scroll, AX tree reads, semantic clicks, and direct AX field value setting — first-class native control on this machine.'
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
