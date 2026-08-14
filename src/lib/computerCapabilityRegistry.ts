import { listMcpServers, fetchAllMcpTools, type McpTool } from './mcpClient';
import { loadConnections, type AgentConnection } from './connectionManager';
import {
  getCircleIntegrationCapabilities,
  getInstalledIntegrationProviders,
  type CircleIntegrationProvider,
} from './circleIntegrations';
import { getBridgeUrl } from './bridgeEnvironment';
import { isAgentBridgeCapabilityReady } from './computerCapabilityReadiness';
import {
  classifyDesktopBridgeHealth,
  type DesktopBridgeHealthClassification,
} from './desktopBridgeProtocol';
import {
  normalizeComputerCapabilityPreparedSnapshot,
  resolveComputerBrowserCapabilityStatuses,
  shouldProbeDesktopBridgeForCapabilityAudit,
  type AuditComputerCapabilitiesOptions,
  type ComputerCapabilityPreparedSnapshotSummary,
} from './computerTaskCapabilitySnapshot';

export { isAgentBridgeCapabilityReady } from './computerCapabilityReadiness';
export {
  COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS,
  buildComputerCapabilityPreparedSnapshot,
  normalizeComputerCapabilityPreparedSnapshot,
  resolveComputerBrowserCapabilityStatuses,
  shouldProbeDesktopBridgeForCapabilityAudit,
} from './computerTaskCapabilitySnapshot';
export type {
  AcceptedComputerCapabilityPreparedSnapshot,
  AuditComputerCapabilitiesOptions,
  BuildComputerCapabilityPreparedSnapshotInput,
  ComputerBrowserCapabilityStatus,
  ComputerBrowserCapabilityStatuses,
  ComputerCapabilityPreparedSnapshot,
  ComputerCapabilityPreparedSnapshotRejectionCode,
  ComputerCapabilityPreparedSnapshotSummary,
  NormalizeComputerCapabilityPreparedSnapshotOptions,
  RejectedComputerCapabilityPreparedSnapshot,
} from './computerTaskCapabilitySnapshot';

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
  /** Additive exact-feature/source readiness. Broad capability findings keep
   * ordinary advertised desktop tools compatible in non-current states. */
  desktopBridgeReadiness?: DesktopBridgeHealthClassification;
  /** Whether task-start capability evidence was accepted. This is deliberately
   * value-free: it carries process/freshness identity, never browser content. */
  preparedSnapshot: ComputerCapabilityPreparedSnapshotSummary;
}

type DesktopBridgeProbe = {
  readiness: DesktopBridgeHealthClassification;
};

function unavailableDesktopReadiness(): DesktopBridgeHealthClassification {
  return classifyDesktopBridgeHealth(null);
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
 * Probe the local desktop bridge with a short timeout. Returns the advertised
 * tool list when /desktop/health responds with `supported: true`, otherwise
 * null. Any failure (timeout, DNS, network) returns null without throwing so
 * the audit stays non-blocking.
 */
async function probeDesktopBridge(): Promise<DesktopBridgeProbe | null> {
  if (typeof fetch === 'undefined') return null;
  const base = getBridgeUrl(7778);
  if (!base) return null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    timer = controller ? setTimeout(() => controller.abort(), 500) : null;
    const res = await fetch(`${base}/desktop/health`, {
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const json = await res.json() as unknown;
    const readiness = classifyDesktopBridgeHealth(json);
    return {
      readiness,
    };
  } catch { return null; }
  finally {
    if (timer) clearTimeout(timer);
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

export async function auditComputerCapabilities(
  circleId: string,
  options: AuditComputerCapabilitiesOptions = {},
): Promise<ComputerCapabilityAudit> {
  // UC-5 follow-up: the local desktop bridge IS an app-control
  // capability — the original audit only counted MCP tools +
  // integrations, so the agent got told "missing: app_tools" even when
  // /desktop/health was reporting launch/focus/type/keys/a11y_tree.
  // Legacy callers still receive the bounded live probe. A caller that already
  // prepared the bridge passes one immutable snapshot instead: its presence is
  // authoritative, so rejected/stale evidence fails closed without a second
  // probe racing the task-start observation.
  const shouldProbeDesktopBridge = shouldProbeDesktopBridgeForCapabilityAudit(options);
  const preparedSnapshotWasProvided = !shouldProbeDesktopBridge;
  const preparedSnapshot = preparedSnapshotWasProvided
    ? normalizeComputerCapabilityPreparedSnapshot(options.preparedSnapshot, {
        expectedBridgeInstanceId: options.expectedBridgeInstanceId,
        nowMs: options.nowMs,
      })
    : null;
  const acceptedPreparedSnapshot = preparedSnapshot?.status === 'accepted'
    ? preparedSnapshot
    : null;
  const [connections, integrationProviders, integrationCapabilities, mcpServers, bridgeProbe] = await Promise.all([
    loadConnections().catch(() => [] as AgentConnection[]),
    getInstalledIntegrationProviders(circleId).catch(() => [] as CircleIntegrationProvider[]),
    getCircleIntegrationCapabilities(circleId).catch(() => [] as string[]),
    listMcpServers(circleId).catch(() => []),
    shouldProbeDesktopBridge
      ? probeDesktopBridge().catch(() => null)
      : Promise.resolve(null),
  ]);

  const mcpTools = mcpServers.length > 0
    ? await fetchAllMcpTools(circleId).catch(() => [] as McpTool[])
    : [];

  const enabledConnections = connections.filter((conn) => conn.enabled);
  const filesystemTools = mcpTools.filter(isFilesystemTool);
  const appTools = mcpTools.filter(isDesktopOrAppTool);
  const desktopBridgeReadiness = acceptedPreparedSnapshot?.desktopBridgeReadiness
    || bridgeProbe?.readiness
    || unavailableDesktopReadiness();
  // A stale or capability-limited bridge can still serve every exact ordinary
  // tool it advertises. Attachment-specific callers inspect the additive
  // readiness object instead of downgrading all desktop work.
  const bridgeAlive = desktopBridgeReadiness.genericToolsReady;
  const bridgeTools = new Set(desktopBridgeReadiness.advertisedTools);
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

  const remoteBrowserAutomationReady = hasCapability(integrationCapabilities, 'web_automation');
  const remoteBrowserSessionsReady = hasCapability(integrationCapabilities, 'remote_browser_sessions');
  const localBrowserReady = acceptedPreparedSnapshot?.localBrowser.ready === true;
  const localBrowserContextOpen = localBrowserReady
    && acceptedPreparedSnapshot?.localBrowser.contextOpen === true;
  const browserStatuses = resolveComputerBrowserCapabilityStatuses({
    remoteAutomationReady: remoteBrowserAutomationReady,
    remoteSessionsReady: remoteBrowserSessionsReady,
    localBrowserReady,
    localBrowserContextOpen,
  });
  const browserSources = summarizeSources([
    remoteBrowserAutomationReady ? 'circle integration: browser automation' : null,
    remoteBrowserSessionsReady ? 'circle integration: remote browser sessions' : null,
    integrationProviders.includes('browserbase') ? 'integration: Browserbase' : null,
    localBrowserReady
      ? localBrowserContextOpen
        ? 'local browser bridge: Playwright ready with an active context'
        : 'local browser bridge: Playwright ready'
      : null,
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
    bridgeAlive && enabledConnections.length === 0
      ? acceptedPreparedSnapshot
        ? `desktop bridge: localhost:7778 (prepared snapshot ${acceptedPreparedSnapshot.bridgeInstanceId})`
        : 'desktop bridge: localhost:7778 (live health probe)'
      : null,
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
    bridgeAlive ? `desktop bridge: ${desktopBridgeReadiness.advertisedTools.length} advertised tools` : null,
    bridgeProbe || acceptedPreparedSnapshot ? `desktop bridge readiness: ${desktopBridgeReadiness.state}` : null,
  ]);

  const bridgeReadinessNote = desktopBridgeReadiness.state === 'current'
    ? ' Uploaded-file opening is current.'
    : desktopBridgeReadiness.state === 'capability_missing'
      ? ' Ordinary advertised tools remain available, but uploaded-file opening needs a supervisor restart and health recheck.'
      : desktopBridgeReadiness.state === 'source_changed'
        ? ' Ordinary advertised tools remain available; newer local source is ready for a user-owned supervisor restart.'
        : desktopBridgeReadiness.state === 'restart_blocked'
          ? ' Ordinary advertised tools remain available; restart is currently blocked or its safety evidence is incomplete.'
          : '';

  const findings: ComputerCapabilityFinding[] = [
    {
      id: 'browser_automation',
      label: 'Browser automation',
      status: browserStatuses.browserAutomation,
      detail: localBrowserReady && !remoteBrowserAutomationReady && !remoteBrowserSessionsReady
        ? 'The verified local Playwright bridge can launch browser tasks on this computer.'
        : browserStatuses.browserAutomation === 'ready'
          ? 'The circle can launch browser/computer tasks through the existing computer-use flow.'
          : 'No active browser automation integration is visible for this circle yet.',
      sources: browserSources,
    },
    {
      id: 'browser_sessions',
      label: 'Browser sessions',
      status: browserStatuses.browserSessions,
      detail: remoteBrowserSessionsReady
        ? 'Remote browser session infrastructure is installed.'
        : localBrowserContextOpen
          ? 'The verified local Playwright bridge has an active browser context.'
          : browserStatuses.browserSessions === 'partial'
            ? 'Browser automation is ready, but no active or durable session context is currently verified.'
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
        ? `Desktop bridge is live on localhost:7778 with ${desktopBridgeReadiness.advertisedTools.length} exact advertised tool${desktopBridgeReadiness.advertisedTools.length === 1 ? '' : 's'}.${bridgeReadinessNote}`
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
        ? `The local desktop bridge exposes a supported native-control tool surface on this machine.${bridgeReadinessNote}`
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
    desktopBridgeReadiness,
    preparedSnapshot: preparedSnapshotWasProvided
      ? preparedSnapshot?.status === 'accepted'
        ? {
            status: 'accepted',
            rejectionCode: null,
            observedAt: preparedSnapshot.observedAt,
            bridgeInstanceId: preparedSnapshot.bridgeInstanceId,
            localBrowserReady: preparedSnapshot.localBrowser.ready,
            localBrowserContextOpen: preparedSnapshot.localBrowser.contextOpen,
          }
        : {
            status: 'rejected',
            rejectionCode: preparedSnapshot?.rejectionCode || 'invalid_snapshot',
            observedAt: preparedSnapshot?.observedAt || null,
            bridgeInstanceId: preparedSnapshot?.bridgeInstanceId || null,
            localBrowserReady: false,
            localBrowserContextOpen: false,
          }
      : {
          status: 'not_provided',
          rejectionCode: null,
          observedAt: null,
          bridgeInstanceId: null,
          localBrowserReady: false,
          localBrowserContextOpen: false,
        },
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
