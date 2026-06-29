import type { BridgeProbeResult, BridgeStatus } from './bridgeHealthDiag';

export type OfficeBridgeReadinessTone = 'good' | 'warn' | 'danger' | 'muted';

export interface OfficeBridgeReadinessSnapshot {
  available: boolean;
  total: number;
  healthy: number;
  degraded: number;
  offline: number;
  activeSessions: number;
  coreReady: boolean;
  executionReady: boolean;
  readyForAgentTasks: boolean;
  optionalIssues: string[];
  requiredIssue?: string;
  score: number;
  statusLabel: string;
  summary: string;
  tone: OfficeBridgeReadinessTone;
  primaryIssue?: string;
  actionLabel: string;
  actionDetail: string;
  results: BridgeProbeResult[];
}

const CORE_BRIDGE_NAME = 'openswan-proxy';
const EXECUTION_BRIDGE_NAMES = new Set<BridgeProbeResult['name']>([
  'claude-code',
  'codex',
  'gemini-cli',
  'cursor',
]);

export function buildOfficeBridgeReadinessSnapshot(
  results: BridgeProbeResult[],
  opts: {
    available?: boolean;
    unavailableReason?: string;
    error?: string | null;
  } = {},
): OfficeBridgeReadinessSnapshot {
  const available = opts.available !== false;
  const normalizedResults = [...(results || [])];

  if (!available) {
    return {
      available: false,
      total: normalizedResults.length,
      healthy: 0,
      degraded: 0,
      offline: normalizedResults.length,
      activeSessions: 0,
      coreReady: false,
      executionReady: false,
      readyForAgentTasks: false,
      optionalIssues: normalizedResults.map(result => `${result.label}: disabled`),
      requiredIssue: 'Local agent bridges are disabled in this runtime.',
      score: 0,
      statusLabel: 'BRIDGES DISABLED',
      summary: bridgeUnavailableSummary(opts.unavailableReason),
      tone: 'muted',
      primaryIssue: 'Local agent bridges are disabled in this runtime.',
      actionLabel: 'Configure bridge access',
      actionDetail: 'Use local development, explicit bridge URLs, or the production opt-in before probing local agents.',
      results: normalizedResults,
    };
  }

  if (opts.error) {
    return {
      available: true,
      total: normalizedResults.length,
      healthy: 0,
      degraded: 0,
      offline: normalizedResults.length || 1,
      activeSessions: 0,
      coreReady: false,
      executionReady: false,
      readyForAgentTasks: false,
      optionalIssues: [],
      requiredIssue: opts.error,
      score: 0,
      statusLabel: 'BRIDGE AUDIT FAILED',
      summary: opts.error,
      tone: 'danger',
      primaryIssue: opts.error,
      actionLabel: 'Retry bridge audit',
      actionDetail: 'Refresh bridge health and inspect localhost bridge logs if the audit fails again.',
      results: normalizedResults,
    };
  }

  const counts = countBridgeStatuses(normalizedResults);
  const total = normalizedResults.length;
  const activeSessions = normalizedResults.reduce((sum, result) => sum + Math.max(0, result.sessionCount ?? 0), 0);
  const coreBridge = normalizedResults.find(result => result.name === CORE_BRIDGE_NAME);
  const coreReady = coreBridge?.status === 'healthy';
  const executionReady = normalizedResults.some(result => (
    EXECUTION_BRIDGE_NAMES.has(result.name) && result.status === 'healthy'
  ));
  const readyForAgentTasks = coreReady && executionReady;
  const requiredIssue = buildRequiredIssue(coreBridge, executionReady);
  const optionalIssues = normalizedResults
    .filter(result => result.status !== 'healthy' && !isRequiredBridgeIssue(result, coreReady, executionReady))
    .map(result => `${result.label}: ${result.detail}`);
  const score = total > 0
    ? Math.round(((counts.healthy + counts.degraded * 0.5) / total) * 100)
    : 0;
  const issue = normalizedResults.find(result => result.status === 'offline' || result.status === 'degraded');

  if (total === 0) {
    return {
      available: true,
      total,
      healthy: 0,
      degraded: 0,
      offline: 0,
      activeSessions,
      coreReady,
      executionReady,
      readyForAgentTasks,
      optionalIssues: [],
      requiredIssue,
      score,
      statusLabel: 'NO BRIDGES CHECKED',
      summary: 'No bridge probe results are available yet.',
      tone: 'muted',
      actionLabel: 'Refresh bridge audit',
      actionDetail: 'Run the Office bridge health audit to verify local agent bridge status.',
      results: normalizedResults,
    };
  }

  if (counts.offline === 0 && counts.degraded === 0) {
    return {
      available: true,
      total,
      healthy: counts.healthy,
      degraded: 0,
      offline: 0,
      activeSessions,
      coreReady,
      executionReady,
      readyForAgentTasks,
      optionalIssues,
      requiredIssue,
      score,
      statusLabel: 'ALL BRIDGES READY',
      summary: activeSessions > 0
        ? `${counts.healthy}/${total} bridges reachable with ${activeSessions} active session${activeSessions === 1 ? '' : 's'}.`
        : `${counts.healthy}/${total} bridges reachable. Launch sessions from Office or Chat when needed.`,
      tone: 'good',
      actionLabel: 'Keep monitoring',
      actionDetail: 'Office will keep refreshing bridge health while the dashboard is open.',
      results: normalizedResults,
    };
  }

  if (readyForAgentTasks) {
    return {
      available: true,
      total,
      healthy: counts.healthy,
      degraded: counts.degraded,
      offline: counts.offline,
      activeSessions,
      coreReady,
      executionReady,
      readyForAgentTasks,
      optionalIssues,
      requiredIssue,
      score,
      statusLabel: 'CORE BRIDGES READY',
      summary: [
        'OpenSwan and an execution bridge are ready',
        `${counts.healthy}/${total} healthy`,
        optionalIssues.length ? `${optionalIssues.length} optional issue${optionalIssues.length === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(' · '),
      tone: 'warn',
      primaryIssue: optionalIssues[0],
      actionLabel: 'Connect optional bridges',
      actionDetail: optionalIssues[0] || 'Optional bridges can be repaired without blocking SwanBot work.',
      results: normalizedResults,
    };
  }

  const tone: OfficeBridgeReadinessTone = 'danger';
  const statusLabel = 'BRIDGES NEED ATTENTION';
  const summary = [
    `${counts.healthy}/${total} healthy`,
    counts.degraded ? `${counts.degraded} degraded` : null,
    counts.offline ? `${counts.offline} offline` : null,
  ].filter(Boolean).join(' · ');

  return {
    available: true,
    total,
    healthy: counts.healthy,
    degraded: counts.degraded,
    offline: counts.offline,
    activeSessions,
    coreReady,
    executionReady,
    readyForAgentTasks,
    optionalIssues,
    requiredIssue,
    score,
    statusLabel,
    summary,
    tone,
    primaryIssue: requiredIssue || (issue ? `${issue.label}: ${issue.detail}` : undefined),
    actionLabel: 'Repair required bridge path',
    actionDetail: requiredIssue || issue?.hint || 'Refresh bridge health after repairing the affected bridge.',
    results: normalizedResults,
  };
}

function countBridgeStatuses(results: BridgeProbeResult[]): Record<BridgeStatus, number> {
  return results.reduce<Record<BridgeStatus, number>>(
    (counts, result) => {
      counts[result.status] += 1;
      return counts;
    },
    { healthy: 0, degraded: 0, offline: 0 },
  );
}

function buildRequiredIssue(
  coreBridge: BridgeProbeResult | undefined,
  executionReady: boolean,
): string | undefined {
  if (!coreBridge) return 'OpenSwan Proxy: not checked';
  if (coreBridge.status !== 'healthy') return `${coreBridge.label}: ${coreBridge.detail}`;
  if (!executionReady) return 'No execution bridge is healthy. Start Claude Code, Codex, Gemini CLI, or Cursor.';
  return undefined;
}

function isRequiredBridgeIssue(
  result: BridgeProbeResult,
  coreReady: boolean,
  executionReady: boolean,
): boolean {
  if (result.name === CORE_BRIDGE_NAME && !coreReady) return true;
  if (!executionReady && EXECUTION_BRIDGE_NAMES.has(result.name)) return true;
  return false;
}

function bridgeUnavailableSummary(reason: string | undefined): string {
  if (reason === 'production-web') {
    return 'Local bridges are skipped on production web unless explicit bridge URLs or bridge opt-in are configured.';
  }
  if (reason) return `Local bridges are not available in this runtime (${reason}).`;
  return 'Local bridges are not available in this runtime.';
}
