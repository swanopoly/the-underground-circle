import type { BridgeProbeResult, BridgeStatus } from './bridgeHealthDiag';

export type OfficeBridgeReadinessTone = 'good' | 'warn' | 'danger' | 'muted';

export interface OfficeBridgeReadinessSnapshot {
  available: boolean;
  total: number;
  healthy: number;
  degraded: number;
  offline: number;
  activeSessions: number;
  score: number;
  statusLabel: string;
  summary: string;
  tone: OfficeBridgeReadinessTone;
  primaryIssue?: string;
  actionLabel: string;
  actionDetail: string;
  results: BridgeProbeResult[];
}

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

  const tone: OfficeBridgeReadinessTone = counts.offline > 0 ? 'danger' : 'warn';
  const statusLabel = counts.offline > 0 ? 'BRIDGES NEED ATTENTION' : 'BRIDGES PARTIAL';
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
    score,
    statusLabel,
    summary,
    tone,
    primaryIssue: issue ? `${issue.label}: ${issue.detail}` : undefined,
    actionLabel: counts.offline > 0 ? 'Start missing bridges' : 'Finish bridge setup',
    actionDetail: issue?.hint || 'Refresh bridge health after repairing the affected bridge.',
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

function bridgeUnavailableSummary(reason: string | undefined): string {
  if (reason === 'production-web') {
    return 'Local bridges are skipped on production web unless explicit bridge URLs or bridge opt-in are configured.';
  }
  if (reason) return `Local bridges are not available in this runtime (${reason}).`;
  return 'Local bridges are not available in this runtime.';
}
