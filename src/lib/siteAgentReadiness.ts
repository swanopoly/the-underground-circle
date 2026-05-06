import { auditComputerCapabilities, type ComputerCapabilityAudit, type ComputerCapabilityId, type ComputerCapabilityStatus } from './computerCapabilityRegistry';
import { listSiteCredentialVault, type SiteCredentialVaultEntry } from './siteAutomation';
import { buildVaultSecurityReport, type VaultSecurityReport } from './vaultAgentAccess';
import type { CircleIntegrationGroupKey } from './circleIntegrationCatalog';

export type SiteAgentReadinessPriority = 'critical' | 'high' | 'medium' | 'low';
export type SiteAgentReadinessGrade = 'ready' | 'review' | 'setup' | 'blocked';
export type SiteAgentReadinessArea = 'access' | 'vault' | 'guardrails' | 'observability' | 'cost';
export type SiteAgentReadinessTargetTab = 'CHAT' | 'VAULT' | 'INTEGRATIONS' | 'OFFICE';

export interface SiteAgentReadinessTarget {
  tab: SiteAgentReadinessTargetTab;
  task?: string | null;
  marketplaceItemId?: string | null;
  marketplaceGroupKey?: CircleIntegrationGroupKey | null;
}

export interface SiteAgentReadinessRecommendation {
  id: string;
  priority: SiteAgentReadinessPriority;
  area: SiteAgentReadinessArea;
  title: string;
  detail: string;
  actionLabel: string;
  target: SiteAgentReadinessTarget;
}

export interface SiteAgentReadinessSnapshot {
  score: number;
  grade: SiteAgentReadinessGrade;
  statusLabel: string;
  summary: string;
  updatedAt: string;
  stats: {
    capabilitiesReady: number;
    capabilitiesPartial: number;
    capabilitiesMissing: number;
    vaultCredentials: number;
    vaultScore: number | null;
    vaultHighRiskIssues: number;
    vaultCriticalIssues: number;
    activeBridgeProviders: number;
    activeMcpToolCount: number;
    observabilityConnected: boolean;
  };
  recommendations: SiteAgentReadinessRecommendation[];
  blockers: string[];
  capabilityAudit: ComputerCapabilityAudit | null;
  vaultReport: VaultSecurityReport | null;
  vaultError?: string | null;
  capabilityError?: string | null;
}

export interface SiteAgentReadinessBuildInput {
  capabilityAudit?: ComputerCapabilityAudit | null;
  capabilityError?: string | null;
  vaultEntries?: SiteCredentialVaultEntry[] | null;
  vaultError?: string | null;
  vaultMissing?: boolean;
}

const PRIORITY_WEIGHT: Record<SiteAgentReadinessPriority, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const OBSERVABILITY_PROVIDERS = new Set(['braintrust', 'datadog', 'posthog', 'sentry']);

function capabilityStatus(
  audit: ComputerCapabilityAudit | null,
  id: ComputerCapabilityId,
): ComputerCapabilityStatus | 'unknown' {
  return audit?.findings.find((finding) => finding.id === id)?.status || 'unknown';
}

function isReady(status: ComputerCapabilityStatus | 'unknown'): boolean {
  return status === 'ready';
}

function isMissing(status: ComputerCapabilityStatus | 'unknown'): boolean {
  return status === 'missing' || status === 'unknown';
}

function addRecommendation(
  list: SiteAgentReadinessRecommendation[],
  recommendation: SiteAgentReadinessRecommendation,
) {
  if (!list.some((item) => item.id === recommendation.id)) list.push(recommendation);
}

function sortRecommendations(items: SiteAgentReadinessRecommendation[]): SiteAgentReadinessRecommendation[] {
  return [...items].sort((a, b) => {
    const byPriority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (byPriority !== 0) return byPriority;
    return a.title.localeCompare(b.title);
  });
}

function readinessGrade(score: number, blockers: string[]): SiteAgentReadinessGrade {
  if (blockers.length > 0 || score < 50) return 'blocked';
  if (score < 70) return 'setup';
  if (score < 86) return 'review';
  return 'ready';
}

function statusLabelForGrade(grade: SiteAgentReadinessGrade): string {
  if (grade === 'ready') return 'Ready for supervised automation';
  if (grade === 'review') return 'Usable with review';
  if (grade === 'setup') return 'Setup needed';
  return 'Blocked';
}

export function buildSiteAgentReadiness(input: SiteAgentReadinessBuildInput): SiteAgentReadinessSnapshot {
  const capabilityAudit = input.capabilityAudit || null;
  const capabilityError = input.capabilityError || null;
  const vaultEntries = input.vaultEntries || [];
  const vaultError = input.vaultError || null;
  const vaultReport = vaultError || input.vaultMissing ? null : buildVaultSecurityReport(vaultEntries);

  const capabilitiesReady = capabilityAudit?.findings.filter((finding) => finding.status === 'ready').length || 0;
  const capabilitiesPartial = capabilityAudit?.findings.filter((finding) => finding.status === 'partial').length || 0;
  const capabilitiesMissing = capabilityAudit?.findings.filter((finding) => finding.status === 'missing').length || 0;
  const capabilityTotal = capabilityAudit?.findings.length || 8;
  const capabilityScore = capabilityAudit
    ? ((capabilitiesReady + capabilitiesPartial * 0.55) / Math.max(1, capabilityTotal)) * 42
    : 8;

  const browserStatus = capabilityStatus(capabilityAudit, 'browser_automation');
  const browserSessionStatus = capabilityStatus(capabilityAudit, 'browser_sessions');
  const bridgeStatus = capabilityStatus(capabilityAudit, 'agent_bridges');
  const desktopStatus = capabilityStatus(capabilityAudit, 'desktop_control');
  const appToolStatus = capabilityStatus(capabilityAudit, 'app_tools');

  const vaultScore = vaultReport
    ? vaultEntries.length > 0
      ? (vaultReport.score / 100) * 25
      : 9
    : 0;
  const guardrailScore = (
    (isReady(browserStatus) || isReady(desktopStatus) ? 5 : 0) +
    (vaultReport && vaultReport.counts.critical === 0 && vaultReport.counts.high === 0 ? 6 : 0) +
    (isReady(bridgeStatus) || isReady(appToolStatus) ? 4 : 0)
  );
  const observabilityConnected = !!capabilityAudit?.availableIntegrationProviders.some((provider) => (
    OBSERVABILITY_PROVIDERS.has(provider)
  ));
  const observabilityScore = observabilityConnected ? 12 : 4;
  const score = Math.max(0, Math.min(100, Math.round(capabilityScore + vaultScore + guardrailScore + observabilityScore)));

  const blockers: string[] = [];
  if (capabilityError) blockers.push('Capability audit failed.');
  if (input.vaultMissing) blockers.push('Vault RPCs are not deployed.');
  if (vaultError && !input.vaultMissing) blockers.push('Vault readiness audit failed.');
  if (isMissing(browserStatus) && isMissing(desktopStatus) && isMissing(appToolStatus)) {
    blockers.push('No browser, desktop, or app-control capability is ready.');
  }
  if (vaultReport?.counts.critical) {
    blockers.push(`${vaultReport.counts.critical} critical vault issue${vaultReport.counts.critical === 1 ? '' : 's'}.`);
  }

  const recommendations: SiteAgentReadinessRecommendation[] = [];
  if (isMissing(browserStatus)) {
    addRecommendation(recommendations, {
      id: 'connect-browser-automation',
      priority: 'high',
      area: 'access',
      title: 'Connect browser automation',
      detail: 'Website tasks need a real browser runtime before agents can click, fill forms, or verify pages safely.',
      actionLabel: 'Open Marketplace',
      target: { tab: 'INTEGRATIONS', marketplaceItemId: 'browserbase', marketplaceGroupKey: 'ai_agents_services' },
    });
  }
  if (browserSessionStatus === 'partial' || browserSessionStatus === 'missing' || browserSessionStatus === 'unknown') {
    addRecommendation(recommendations, {
      id: 'durable-browser-sessions',
      priority: isReady(browserStatus) ? 'medium' : 'high',
      area: 'access',
      title: 'Add durable browser sessions',
      detail: 'Remote or isolated browser sessions reduce credential leakage and make long website automations easier to replay.',
      actionLabel: 'Review Browserbase',
      target: { tab: 'INTEGRATIONS', marketplaceItemId: 'browserbase', marketplaceGroupKey: 'ai_agents_services' },
    });
  }
  if (isMissing(bridgeStatus) || isMissing(desktopStatus)) {
    addRecommendation(recommendations, {
      id: 'connect-local-control',
      priority: 'high',
      area: 'access',
      title: 'Connect local agent and desktop control',
      detail: 'Native app automation needs a live bridge so agents can launch, focus, read, type, and verify desktop apps.',
      actionLabel: 'Open Control Panel',
      target: {
        tab: 'CHAT',
        task: 'Scan local bridges and connect browser, desktop, app, and OpenSwan gateway access before launching an automation.',
      },
    });
  }
  if (input.vaultMissing || vaultError) {
    addRecommendation(recommendations, {
      id: 'deploy-vault-rpcs',
      priority: input.vaultMissing ? 'critical' : 'high',
      area: 'vault',
      title: input.vaultMissing ? 'Deploy vault database controls' : 'Fix vault readiness audit',
      detail: input.vaultMissing
        ? 'Agents cannot safely use saved logins until the vault RPCs and audit controls are deployed.'
        : vaultError || 'The app could not audit vault credentials for automation readiness.',
      actionLabel: 'Open Vault',
      target: { tab: 'VAULT' },
    });
  } else if (vaultEntries.length === 0) {
    addRecommendation(recommendations, {
      id: 'add-first-vault-login',
      priority: 'medium',
      area: 'vault',
      title: 'Add the first saved website login',
      detail: 'Saved credentials let agents log in through approved tools instead of asking users to paste secrets into chat.',
      actionLabel: 'Open Vault',
      target: { tab: 'VAULT' },
    });
  }
  if (vaultReport && (vaultReport.counts.critical > 0 || vaultReport.counts.high > 0)) {
    addRecommendation(recommendations, {
      id: 'harden-vault',
      priority: vaultReport.counts.critical > 0 ? 'critical' : 'high',
      area: 'vault',
      title: 'Harden risky vault credentials',
      detail: `${vaultReport.counts.critical} critical and ${vaultReport.counts.high} high-risk issue${vaultReport.counts.high === 1 ? '' : 's'} need approval, origin, rotation, or test fixes.`,
      actionLabel: 'Open Vault',
      target: { tab: 'VAULT' },
    });
  }
  if (vaultReport && vaultReport.expiredGrantCount > 0) {
    addRecommendation(recommendations, {
      id: 'prune-expired-grants',
      priority: 'medium',
      area: 'vault',
      title: 'Remove expired agent grants',
      detail: `${vaultReport.expiredGrantCount} expired automation grant${vaultReport.expiredGrantCount === 1 ? '' : 's'} should be pruned from vault metadata.`,
      actionLabel: 'Clean Vault',
      target: { tab: 'VAULT' },
    });
  }
  addRecommendation(recommendations, {
    id: 'set-task-guardrails',
    priority: score < 86 ? 'medium' : 'low',
    area: 'guardrails',
    title: 'Set task-specific guardrails before launch',
    detail: 'Use allowed domains, allowed actions, isolated browser preference, and live trace before agents touch external sites or local apps.',
    actionLabel: 'Open Control Panel',
    target: {
      tab: 'CHAT',
      task: 'Prepare guardrails for a browser or desktop automation: allowed domains, allowed actions, approval checkpoints, isolated browser, and live trace.',
    },
  });
  if (!observabilityConnected) {
    addRecommendation(recommendations, {
      id: 'connect-agent-observability',
      priority: 'medium',
      area: 'observability',
      title: 'Add agent evals or monitoring',
      detail: 'High-trust automations need trace review, regression checks, and quality signals across runs.',
      actionLabel: 'Review Evals',
      target: { tab: 'INTEGRATIONS', marketplaceItemId: 'braintrust', marketplaceGroupKey: 'ai_agents_services' },
    });
  }
  addRecommendation(recommendations, {
    id: 'cost-preflight',
    priority: 'low',
    area: 'cost',
    title: 'Use cost preflight for large tasks',
    detail: 'Research, build, and browser tasks should start from the Control Panel so the app can preview model/tool spend and reduce unnecessary tool loops.',
    actionLabel: 'Open Control Panel',
    target: {
      tab: 'CHAT',
      task: 'Estimate the safest and lowest-cost route for this automation before launching it.',
    },
  });

  const grade = readinessGrade(score, blockers);
  const statusLabel = statusLabelForGrade(grade);
  const topRecommendation = sortRecommendations(recommendations)[0];
  const summary = topRecommendation
    ? `${statusLabel}. Next: ${topRecommendation.title}.`
    : `${statusLabel}. No immediate setup recommendations.`;

  return {
    score,
    grade,
    statusLabel,
    summary,
    updatedAt: new Date().toISOString(),
    stats: {
      capabilitiesReady,
      capabilitiesPartial,
      capabilitiesMissing,
      vaultCredentials: vaultEntries.length,
      vaultScore: vaultReport ? vaultReport.score : null,
      vaultHighRiskIssues: vaultReport?.counts.high || 0,
      vaultCriticalIssues: vaultReport?.counts.critical || 0,
      activeBridgeProviders: capabilityAudit?.activeBridgeProviders.length || 0,
      activeMcpToolCount: capabilityAudit?.activeMcpToolCount || 0,
      observabilityConnected,
    },
    recommendations: sortRecommendations(recommendations),
    blockers,
    capabilityAudit,
    vaultReport,
    vaultError,
    capabilityError,
  };
}

export async function loadSiteAgentReadiness(circleId: string): Promise<SiteAgentReadinessSnapshot> {
  const [capabilityResult, vaultResult] = await Promise.allSettled([
    auditComputerCapabilities(circleId),
    listSiteCredentialVault(circleId),
  ]);

  const capabilityAudit = capabilityResult.status === 'fulfilled' ? capabilityResult.value : null;
  const capabilityError = capabilityResult.status === 'rejected'
    ? capabilityResult.reason instanceof Error ? capabilityResult.reason.message : 'Capability audit failed.'
    : null;

  if (vaultResult.status === 'rejected') {
    return buildSiteAgentReadiness({
      capabilityAudit,
      capabilityError,
      vaultEntries: [],
      vaultError: vaultResult.reason instanceof Error ? vaultResult.reason.message : 'Vault audit failed.',
    });
  }

  return buildSiteAgentReadiness({
    capabilityAudit,
    capabilityError,
    vaultEntries: vaultResult.value.entries,
    vaultError: vaultResult.value.error || null,
    vaultMissing: vaultResult.value.vaultMissing,
  });
}

export function formatSiteAgentReadinessReport(snapshot: SiteAgentReadinessSnapshot): string {
  const lines = [
    `**Automation Readiness** - ${snapshot.score}/100 (${snapshot.statusLabel})`,
    '',
    `Capabilities: ${snapshot.stats.capabilitiesReady} ready | ${snapshot.stats.capabilitiesPartial} partial | ${snapshot.stats.capabilitiesMissing} missing`,
    `Vault: ${snapshot.stats.vaultCredentials} credential${snapshot.stats.vaultCredentials === 1 ? '' : 's'}${snapshot.stats.vaultScore == null ? '' : ` | ${snapshot.stats.vaultScore}/100 security`}`,
    `Bridges: ${snapshot.stats.activeBridgeProviders} provider${snapshot.stats.activeBridgeProviders === 1 ? '' : 's'} | ${snapshot.stats.activeMcpToolCount} MCP tool${snapshot.stats.activeMcpToolCount === 1 ? '' : 's'}`,
    `Observability: ${snapshot.stats.observabilityConnected ? 'connected' : 'not connected'}`,
  ];

  if (snapshot.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of snapshot.blockers) lines.push(`- ${blocker}`);
  }

  lines.push('', 'Next best actions:');
  for (const item of snapshot.recommendations.slice(0, 8)) {
    lines.push(`- [${item.priority.toUpperCase()}] ${item.title} - ${item.detail}`);
  }

  return lines.join('\n');
}
