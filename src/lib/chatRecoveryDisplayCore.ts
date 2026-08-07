// Decomposition unit U2 (see docs/CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md).
//
// Pure display/formatting for the failure-recovery + computer-handoff cards and
// the customer-safe visible-message sanitizers. These functions were moved
// VERBATIM out of src/screens/circles/tabs/ChatTab.tsx so that the god-component
// can import them as thin wrappers and delete the inline copies. No behavior
// rewrite — the goldens in scripts/chat-recovery-display-core-smoketest.ts pin
// the exact output of each formatter.
//
// PURITY: this module is smoke-testable under `npx tsx`. It pulls in exactly one
// runtime helper (`buildChatFailureRecoveryExecutionPlan` from the already-pure
// `chatFailureRecovery` lib); every other dependency is `import type` only, so no
// react-native / supabase / deno code is loaded.
//
// DEFERRED to after U0 (shared ChatMessage type): buildRecoveryOptionComposerPrompt,
// findLatestRecoveryOptionsMessage, findPriorUserPromptForMessage — those take
// ChatMessage[] and stay in the component until the shared type is extracted.

import {
  buildChatFailureRecoveryExecutionPlan,
  type ChatFailureRecoveryOption,
} from './chatFailureRecovery';
import type { PersistedChatRecoveryReliabilitySummary } from './persistedChatMetadata';
import type { ChatComputerHandoffMetadata } from './chatComputerHandoffContext';

export function appendCustomerSafeRecoveryMessage(message: string, recoveryMessage?: string | null): string {
  const base = message.trim().replace(/\s+$/g, '');
  const recovery = String(recoveryMessage || '').trim();
  return recovery ? `${base}\n\n${recovery}` : base;
}

export function isSupportOnlyComputerTaskWarning(warning: string): boolean {
  return /\b(?:desktop\.[a-z_]+|\/desktop\/|stale_bridge|errorCode|MCP|endpoint|fetch failed|TypeError|ECONN|ETIMEDOUT|EADDR|unknown error|Desktop bridge .*failed)\b/i.test(String(warning || ''));
}

export function sanitizeVisibleComputerTaskMessage(message: string, status: string): string {
  const text = String(message || '').trim();
  if (!text || status === 'completed') return text;
  if (!/\b(?:desktop\.[a-z_]+|\/desktop\/|Desktop bridge|local bridge|unknown bridge error|errorCode|MCP|endpoint|fetch failed|TypeError|ECONN|ETIMEDOUT|EADDR|EACCES|EPERM|ENOENT|File or folder does not exist|Transport .*threw|Transport threw)\b/i.test(text)) {
    return text;
  }
  return 'I could not finish that app or file action. Technical details were saved for recovery.';
}

export function getRecoveryOptionActorLabel(actor: ChatFailureRecoveryOption['actor']): string {
  switch (actor) {
    case 'openswan':
      return 'OpenSwan';
    case 'connected_agent':
      return 'Connected agent';
    case 'llm':
      return 'LLM';
    case 'user':
      return 'User';
    default:
      return 'Stop';
  }
}

export function getRecoveryOptionAccent(option: ChatFailureRecoveryOption): string {
  if (option.actor === 'connected_agent') return '#22c55e';
  if (option.actor === 'openswan') return '#38bdf8';
  if (option.actor === 'user') return '#f59e0b';
  if (option.actor === 'llm') return '#a78bfa';
  return '#ef4444';
}

export function formatRecoverySurfaceKind(kind?: string | null): string {
  switch (kind) {
    case 'desktop_app':
      return 'Desktop app';
    case 'local_file':
      return 'Local files';
    case 'browser':
      return 'Browser';
    case 'hybrid':
      return 'Multi-surface';
    case 'agent_buildout':
      return 'Capability buildout';
    default:
      return 'Task';
  }
}

export function formatRecoveryFailureArea(area?: string | null): string {
  return String(area || 'recovery')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatRecoveryEvidenceLabel(value: string): string {
  return value
    .replace(/^desktop\./, '')
    .replace(/^browser\./, '')
    .replace(/^agent\./, '')
    .replace(/[_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Historical computer-task messages may still carry the former lowercase
// `browser` route label. The handoff surface remains a useful display fallback
// for those rows and for route chips that do not have a persisted plan preview.
// New plan cards use the canonical `computerRequestRoute.kind` label from the
// preview instead (see `resolveChatAutomationPlanDisplayRouteLabel`).
export function formatHandoffSurfaceRouteLabel(
  handoff?: ChatComputerHandoffMetadata | null,
): string | null {
  switch (handoff?.surface) {
    case 'desktop':
      return 'Desktop app';
    case 'local_files':
      return 'Local files';
    case 'browser':
      return 'Browser';
    case 'computer':
      return 'Computer';
    default:
      return null;
  }
}

/**
 * Select the plan card's display-only route label without letting the coarser
 * legacy handoff surface erase a canonical planner label. In particular, a
 * `computer` handoff cannot distinguish a true hybrid task from capability
 * buildout, while the persisted plan preview can.
 *
 * The override is retained only to repair historical previews whose route was
 * persisted as the old lowercase `browser`/`direct` placeholder. Execution
 * continues to use the typed plan and never reads this display value.
 */
export function resolveChatAutomationPlanDisplayRouteLabel(
  previewRouteLabel: string | null | undefined,
  legacyHandoffOverride?: string | null,
): string {
  const previewLabel = String(previewRouteLabel || '').trim();
  const fallbackLabel = String(legacyHandoffOverride || '').trim();

  if (previewLabel && previewLabel !== 'browser' && previewLabel !== 'direct') {
    return previewLabel;
  }
  return fallbackLabel || previewLabel || 'Direct';
}

// P22: the one always-visible compact summary line for a computer/desktop/
// app-task message. Prefers the concise user-facing notice summary the route
// already produced, then the app-choice ("Using <app> · <surface>"), then the
// first sentence of the body. Bounded so the collapsed row stays one glance.
export function buildComputerTaskSummaryLine(args: {
  handoff?: ChatComputerHandoffMetadata | null;
  appChoiceCard: { selectedAppName: string; surfaceLabel: string } | null;
  body: string;
}): string {
  const notice = args.handoff?.requestNotice;
  const noticeSummary = String(notice?.summary || '').replace(/\s+/g, ' ').trim();
  const appLine = args.appChoiceCard
    ? `Using ${args.appChoiceCard.selectedAppName} · ${args.appChoiceCard.surfaceLabel}`
    : '';
  const firstSentence = String(args.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s/)[0] || '';
  const base = noticeSummary || appLine || firstSentence || 'Computer task';
  return base.length > 140 ? `${base.slice(0, 139)}…` : base;
}

export function getRecoveryReliabilityStatus(summary?: PersistedChatRecoveryReliabilitySummary | null): {
  label: string;
  color: string;
  detail: string;
} | null {
  if (!summary) return null;
  if (summary.userActionRequired) {
    return { label: 'User step', color: '#f59e0b', detail: 'Waiting for a permission, login, approval, bridge, or app blocker to be resolved.' };
  }
  if (summary.connectedAgentAllowed) {
    return { label: 'Agent repair', color: '#22c55e', detail: 'A connected agent can repair the missing adapter or runtime capability before retrying.' };
  }
  if (summary.retryAllowed) {
    if (summary.readinessStatus === 'ready') {
      return { label: 'Ready', color: '#22c55e', detail: 'Required evidence is fresh enough for one bounded retry.' };
    }
    return { label: 'Needs evidence', color: '#38bdf8', detail: 'Fresh evidence is required before retrying the failed step.' };
  }
  return { label: 'Stopped', color: '#ef4444', detail: 'The recovery path is blocked until the cause is reviewed.' };
}

export function buildRecoveryReliabilityCard(summary?: PersistedChatRecoveryReliabilitySummary | null): {
  title: string;
  subtitle: string;
  statusLabel: string;
  color: string;
  detail: string;
  chips: string[];
} | null {
  const status = getRecoveryReliabilityStatus(summary);
  if (!summary || !status) return null;
  const surface = formatRecoverySurfaceKind(summary.surfaceKind);
  const area = formatRecoveryFailureArea(summary.failureArea);
  const needed = (summary.requiredFreshEvidence || [])[0]
    || (summary.nextEvidenceTools || [])[0]
    || (summary.requiredEvidenceTools || [])[0]
    || status.detail;
  const chips = [
    summary.readinessStatus ? `Evidence ${summary.readinessStatus}` : null,
    ...(summary.nextEvidenceTools || summary.requiredEvidenceTools || [])
      .slice(0, 2)
      .map(formatRecoveryEvidenceLabel),
    summary.verificationCommands?.length ? `${summary.verificationCommands.length} checks` : null,
  ].filter(Boolean) as string[];
  return {
    title: `${surface} recovery`,
    subtitle: summary.targetName
      ? `${summary.targetName} · ${area}`
      : area,
    statusLabel: status.label,
    color: status.color,
    detail: typeof needed === 'string' ? needed : status.detail,
    chips,
  };
}

export function buildChatAppChoiceCard(handoff?: ChatComputerHandoffMetadata | null): {
  selectedAppName: string;
  surfaceLabel: string;
  availabilityLabel: string;
  reason: string;
  switchHint: string | null;
  alternatives: string[];
  openStep: string | null;
} | null {
  const notice = handoff?.requestNotice;
  const choice = notice?.appChoice;
  if (choice && choice.visibility === 'user') {
    const surfaceLabel = choice.selectedSurface === 'desktop' ? 'Desktop app' : 'Web app';
    const availabilityLabel = choice.availability === 'installed'
      ? 'Installed'
      : choice.availability === 'maybe'
        ? 'Bridge check'
        : choice.availability === 'web'
          ? 'Web ready'
          : surfaceLabel;
    return {
      selectedAppName: choice.selectedAppName,
      surfaceLabel,
      availabilityLabel,
      reason: choice.reason || 'best available app for this task',
      switchHint: choice.switchHint,
      alternatives: (choice.alternatives || []).slice(0, 3),
      openStep: choice.openStepLines?.[0] || null,
    };
  }
  const fallbackLine = notice?.appChoiceLine;
  if (!fallbackLine) return null;
  const selectedMatch = fallbackLine.match(/^Using\s+(.+?)(?:\s+\(|\.|$)/);
  return {
    selectedAppName: selectedMatch?.[1]?.trim() || 'Selected app',
    surfaceLabel: handoff?.surface === 'desktop' ? 'Desktop app' : handoff?.surface === 'browser' ? 'Web app' : 'App task',
    availabilityLabel: 'Selected',
    reason: fallbackLine.replace(/^Using\s+.+?\s+\((.+?)\).*$/i, '$1'),
    switchHint: /say\s+"use\s+(.+?)"/i.test(fallbackLine) ? fallbackLine.replace(/^.*?(say\s+"use\s+.+?").*$/i, '$1') : null,
    alternatives: [],
    openStep: null,
  };
}

export function stripChatAppChoiceLine(content: string, appChoiceLine?: string | null): string {
  const target = String(appChoiceLine || '').trim();
  if (!target) return content;
  return String(content || '')
    .split('\n')
    .filter((line) => line.trim() !== target)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getRecoveryOptionPolicyBadges(option: ChatFailureRecoveryOption): string[] {
  const plan = buildChatFailureRecoveryExecutionPlan(option);
  const policy = plan.policy;
  const badges: string[] = [];
  if (policy.requiresApproval) badges.push('APPROVAL');
  if (policy.requiresFreshEvidence) badges.push('FRESH EVIDENCE');
  if (policy.userActionRequired) badges.push('USER STEP');
  if (policy.allowConnectedAgent) badges.push('CONNECTED AGENT');
  if (policy.allowRuntimePatch) badges.push('PATCH');
  if (policy.maxAttempts > 0) badges.push(`${policy.maxAttempts} TRY`);
  if (policy.safetyMode === 'stop') badges.push('NO RETRY');
  return badges.slice(0, 4);
}

export function getRecoveryReliabilityFromArchive(
  metadata?: Record<string, unknown> | null,
): PersistedChatRecoveryReliabilitySummary | null {
  const summary = metadata?.recoveryReliability;
  return summary && typeof summary === 'object'
    ? summary as PersistedChatRecoveryReliabilitySummary
    : null;
}
