import type { ChatComputerRequestRoute, ChatComputerRequestRouteKind } from './chatComputerRequestRouter';
import {
  buildChatComputerTaskAutonomy,
  type ChatComputerTaskAutonomy,
} from './chatComputerTaskAutonomy';
import { formatGenericAppTaskFamilyForUser } from './genericAppNavigator';

export type ChatComputerRequestNoticeTone = 'quiet' | 'ready' | 'approval' | 'attention';
export type ChatComputerRequestNoticeVisibility = 'hidden' | 'user';
export type ChatComputerRequestNoticeActionKind =
  | 'approve_browser'
  | 'approve_desktop'
  | 'approve_local_files'
  | 'approve_app_buildout'
  | 'connect_bridge'
  | 'review_details';

export interface ChatComputerRequestNoticeAction {
  kind: ChatComputerRequestNoticeActionKind;
  label: string;
  detail: string;
}

export interface ChatComputerAppChoiceCard {
  /**
   * Separate from the full notice visibility. App tasks can run quietly while
   * still showing a compact "using this app" strip so the user can redirect.
   */
  visibility: 'hidden' | 'user';
  selectedAppId: string;
  selectedAppName: string;
  selectedSurface: 'desktop' | 'browser';
  openVia: 'desktop_launch' | 'url_scheme' | 'browser_url';
  availability?: 'installed' | 'maybe' | 'web';
  reason: string;
  line: string;
  alternatives: string[];
  switchHint: string | null;
  explicitAppNamed: boolean;
  namedAppIntent?: string | null;
  openStepLines: string[];
  recoveryFallbackName?: string | null;
}

export interface ChatComputerRequestUserNotice {
  visibility: ChatComputerRequestNoticeVisibility;
  tone: ChatComputerRequestNoticeTone;
  title: string;
  summary: string;
  autonomy: ChatComputerTaskAutonomy;
  primaryAction: ChatComputerRequestNoticeAction | null;
  secondaryActions: ChatComputerRequestNoticeAction[];
  badges: string[];
  proof: string[];
  hiddenReason: string | null;
  planPreview: ChatComputerTaskPlanPreviewCard | null;
  /**
   * Wave-2 task→app resolution: one compact "Using <app> (<why>) — say
   * 'use <alternative>' to switch" line. `formatChatComputerRequestUserNotice`
   * still gates this on the full notice visibility; `appChoice` below is the
   * separate chat chip that can show for quiet app tasks.
   */
  appChoiceLine?: string | null;
  /**
   * Structured app-choice chip. Optional so notices persisted before this field
   * keep parsing.
   */
  appChoice?: ChatComputerAppChoiceCard | null;
}

/**
 * User-facing plan preview (D1). The route already computes ordered
 * solution steps, surfaces, approval gates, and proof requirements — this
 * surfaces them BEFORE execution so the user can confirm or redirect at the
 * cheapest possible point, instead of discovering a misunderstanding at
 * step 8. Rides the same autonomy visibility gate as the notice: quiet
 * tasks stay quiet; the preview appears exactly when an approval/review
 * notice would anyway.
 */
export interface ChatComputerTaskPlanPreviewCard {
  visibility: ChatComputerRequestNoticeVisibility;
  target: string;
  steps: string[];
  surfaces: string[];
  approvalGates: string[];
  constraints: string[];
  proof: string[];
  /** How the user adjusts the plan — reply text, since the plan re-routes on the next message. */
  editHint: string;
}

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, max);
}

function labelForKind(kind: ChatComputerRequestRouteKind): string {
  switch (kind) {
    case 'browser':
      return 'Browser';
    case 'desktop_app':
      return 'Desktop app';
    case 'local_file':
      return 'Local files';
    case 'agent_buildout':
      return 'App support';
    case 'hybrid':
    default:
      return 'Computer';
  }
}

function targetLabel(route: ChatComputerRequestRoute): string {
  if (route.designExecutionPipeline?.appName) return route.designExecutionPipeline.appName;
  if (
    route.appAutomationRouteDecision?.targetName &&
    !/^native desktop app$/i.test(route.appAutomationRouteDecision.targetName)
  ) {
    return route.appAutomationRouteDecision.targetName;
  }
  if (route.appStrategy?.label) return route.appStrategy.label.replace(/\s+(Workflow|Control Loop|And Buildout Loop)$/i, '');
  return labelForKind(route.kind);
}

function taskFamilyContext(route: ChatComputerRequestRoute): string | null {
  if (route.appStrategy?.id !== 'universal_app_control') return null;
  const family = formatGenericAppTaskFamilyForUser(route.appAutomationRouteDecision?.taskFamily);
  if (!family || /^app change$/i.test(family)) return null;
  return family;
}

function summaryForRoute(route: ChatComputerRequestRoute): string {
  const target = targetLabel(route);
  const family = taskFamilyContext(route);
  const targetWithFamily = family ? `${target} ${family}` : target;
  switch (route.kind) {
    case 'browser':
      return `I found the browser path for this request. I will inspect the page first, use semantic controls when possible, and stop before any submit, publish, payment, upload, or credential step.`;
    case 'desktop_app':
      return `I found the desktop-app path for ${targetWithFamily}. I will observe the document or window first, use app-native tools when available, and verify the result before saying it is done.`;
    case 'local_file':
      return `I found the local-file path. I will use the scoped file tools and keep successful read/search work quiet unless there is an approval, result, or blocker to show.`;
    case 'agent_buildout':
      return `This app path needs connected-agent support before it can run safely. I will ask for approval, build only the missing capability, then retry once with fresh evidence.`;
    case 'hybrid':
    default:
      return `I found a combined computer path. I will resolve the files, browser, and app state first, then run one verified step at a time.`;
  }
}

function primaryActionForRoute(route: ChatComputerRequestRoute): ChatComputerRequestNoticeAction | null {
  if (!route.approvalRequired && route.appAutomationRouteDecision?.status !== 'needs_approval') return null;
  if (route.kind === 'agent_buildout') {
    return {
      kind: 'approve_app_buildout',
      label: 'Approve app support',
      detail: 'Let a connected agent build the smallest missing app adapter or recipe before retrying.',
    };
  }
  if (route.kind === 'browser') {
    return {
      kind: 'approve_browser',
      label: 'Approve browser run',
      detail: route.approvalReason || 'Review the browser path before any side effect.',
    };
  }
  if (route.kind === 'local_file') {
    return {
      kind: 'approve_local_files',
      label: 'Approve file access',
      detail: route.approvalReason || 'Review local file access before writes or broad scans.',
    };
  }
  return {
    kind: 'approve_desktop',
    label: 'Approve desktop run',
    detail: route.approvalReason || 'Review desktop control before app or file mutation.',
  };
}

function bridgeActionForRoute(route: ChatComputerRequestRoute): ChatComputerRequestNoticeAction | null {
  const needsDesktop = route.kind === 'desktop_app' || route.kind === 'local_file' || route.kind === 'hybrid' || route.kind === 'agent_buildout';
  const needsBrowser = route.kind === 'browser' || route.kind === 'hybrid';
  if (!needsDesktop && !needsBrowser) return null;
  return {
    kind: 'connect_bridge',
    label: needsDesktop ? 'Check desktop bridge' : 'Check browser bridge',
    detail: needsDesktop
      ? 'Use the desktop bridge only when local app or file access is needed.'
      : 'Use the browser bridge or Browserbase session only when live web execution is needed.',
  };
}

function effortBadge(autonomy: ChatComputerTaskAutonomy): string {
  switch (autonomy.userEffort) {
    case 'approve':
      return 'One approval';
    case 'unblock':
      return 'User unblock';
    case 'review':
      return 'Support review';
    case 'none':
    default:
      return 'No user step';
  }
}

function buildBadges(route: ChatComputerRequestRoute, autonomy: ChatComputerTaskAutonomy): string[] {
  const badges = [
    labelForKind(route.kind),
    effortBadge(autonomy),
    route.risk === 'safe'
      ? route.kind === 'desktop_app' || route.kind === 'hybrid'
        ? 'No approval'
        : 'Read-only'
      : route.approvalRequired ? 'Approval' : 'Review',
    route.designExecutionPipeline?.appName,
    route.appAutomationRouteDecision?.targetName && !/^native desktop app$/i.test(route.appAutomationRouteDecision.targetName)
      ? route.appAutomationRouteDecision.targetName
      : null,
    route.appStrategy?.id === 'universal_app_control' ? 'Build if missing' : null,
    route.surfacePlan?.primarySurface ? route.surfacePlan.primarySurface.replace(/_/g, ' ') : null,
  ];
  return uniqueCompact(badges, 5);
}

function appAlternativeName(value: string): string | null {
  return String(value || '').split(' — ')[0].trim() || null;
}

/** Wave-2: compact app-choice model, with the cheapest switch path. */
function appChoiceForRoute(route: ChatComputerRequestRoute): ChatComputerAppChoiceCard | null {
  const resolution = route.appResolution;
  if (!resolution) return null;
  const why = String(resolution.best.reason || '').split(';')[0].trim()
    || `best ${formatGenericAppTaskFamilyForUser(resolution.category)} match`;
  const alternatives = uniqueCompact(
    (resolution.alternativesSummary || [])
      .map(appAlternativeName)
      .filter((name): name is string => Boolean(name) && name !== resolution.best.displayName),
    3,
  );
  const topAlternative = alternatives[0] || '';
  const line = topAlternative
    ? `Using ${resolution.best.displayName} (${why}) — say "use ${topAlternative}" to switch.`
    : `Using ${resolution.best.displayName} (${why}).`;
  return {
    visibility: 'user',
    selectedAppId: resolution.best.appId,
    selectedAppName: resolution.best.displayName,
    selectedSurface: resolution.best.surface,
    openVia: resolution.best.openVia,
    availability: resolution.best.availability,
    reason: why,
    line,
    alternatives,
    switchHint: topAlternative ? `Say "use ${topAlternative}" to switch.` : null,
    explicitAppNamed: resolution.explicitAppNamed,
    namedAppIntent: resolution.namedAppIntent || null,
    openStepLines: uniqueCompact(resolution.openStepLines || [], 3),
    recoveryFallbackName: resolution.recoveryFallback?.displayName || null,
  };
}

function userFacingConstraintLines(route: ChatComputerRequestRoute): string[] {
  const constraints = route.userConstraints;
  if (!constraints) return [];
  const lines: string[] = [];
  if (constraints.forbidden.length) lines.push(`Won't: ${constraints.forbidden.join(', ')}`);
  if (constraints.approvalBefore.length) lines.push(`Will ask before: ${constraints.approvalBefore.join(', ')}`);
  if (constraints.stopConditions.length) lines.push(`Stops and hands back on: ${constraints.stopConditions.join(', ')}`);
  return lines;
}

export function buildChatComputerTaskPlanPreview(
  route: ChatComputerRequestRoute,
  autonomy?: ChatComputerTaskAutonomy,
): ChatComputerTaskPlanPreviewCard {
  const resolvedAutonomy = autonomy ?? buildChatComputerTaskAutonomy(route);
  const steps = uniqueCompact(
    route.actionItems && route.actionItems.length >= 2
      ? route.actionItems.map((item) => item.label)
      : route.designExecutionPipeline
      ? route.designExecutionPipeline.phases.map((phase) => String(phase.id).replace(/_/g, ' '))
      : route.selectedPipeline?.solutionSteps || [],
    6,
  );
  const surfaces = uniqueCompact(
    route.surfacePlan
      ? [route.surfacePlan.primarySurface, ...route.surfacePlan.fallbackSurfaces].map((s) => String(s).replace(/_/g, ' '))
      : [labelForKind(route.kind)],
    3,
  );
  const approvalGates = uniqueCompact(
    [
      route.approvalRequired ? route.approvalReason : null,
      ...(route.selectedPipeline?.approvalTriggers || []),
    ],
    3,
  );
  return {
    visibility: resolvedAutonomy.shouldShowUserNotice ? 'user' : 'hidden',
    target: targetLabel(route),
    steps,
    surfaces,
    approvalGates,
    constraints: userFacingConstraintLines(route),
    proof: uniqueCompact(route.completionProof, 3),
    editHint: 'Reply with changes to adjust this plan before approving.',
  };
}

export function formatChatComputerTaskPlanPreview(preview: ChatComputerTaskPlanPreviewCard): string {
  if (preview.visibility === 'hidden' || preview.steps.length < 2) return '';
  const lines = [
    `**Plan — ${preview.target}**`,
    ...preview.steps.map((step, i) => `${i + 1}. ${step}`),
    preview.approvalGates.length ? `I'll pause for approval: ${preview.approvalGates.join('; ')}` : null,
    ...preview.constraints,
    preview.proof.length ? `Proof when done: ${preview.proof.join('; ')}` : null,
    preview.editHint,
  ].filter((line): line is string => Boolean(line));
  return lines.join('\n');
}

export function buildChatComputerRequestUserNotice(route: ChatComputerRequestRoute): ChatComputerRequestUserNotice {
  const autonomy = buildChatComputerTaskAutonomy(route);
  const proof = uniqueCompact(route.completionProof, 3);
  const primaryAction = primaryActionForRoute(route);
  const bridgeAction = bridgeActionForRoute(route);
  const secondaryActions = [
    bridgeAction,
    {
      kind: 'review_details',
      label: 'Show details',
      detail: 'Reveal route, tools, fallback surfaces, and proof requirements only when requested.',
    } satisfies ChatComputerRequestNoticeAction,
  ].filter((action): action is ChatComputerRequestNoticeAction => Boolean(action)).slice(0, 2);
  const shouldShow = autonomy.shouldShowUserNotice;
  const tone: ChatComputerRequestNoticeTone = autonomy.userEffort === 'unblock'
    ? 'attention'
    : autonomy.userEffort === 'approve'
      ? 'approval'
      : shouldShow
        ? 'ready'
        : 'quiet';
  const title = autonomy.userEffort === 'unblock'
    ? 'Needs attention'
    : autonomy.userEffort === 'approve'
      ? 'Ready for review'
      : 'Ready';

  const planPreviewCard = buildChatComputerTaskPlanPreview(route, autonomy);
  const appChoice = appChoiceForRoute(route);

  return {
    visibility: shouldShow ? 'user' : 'hidden',
    tone,
    title,
    summary: summaryForRoute(route),
    autonomy,
    primaryAction,
    secondaryActions,
    badges: buildBadges(route, autonomy),
    proof,
    hiddenReason: autonomy.hiddenReason,
    planPreview: planPreviewCard.visibility === 'user' && planPreviewCard.steps.length >= 2 ? planPreviewCard : null,
    appChoiceLine: appChoice?.line || null,
    appChoice,
  };
}

export function formatChatComputerRequestUserNotice(notice: ChatComputerRequestUserNotice): string {
  if (notice.visibility === 'hidden') return '';
  const primaryUserAction = notice.autonomy.primaryUserAction;
  const firstBlocker = notice.autonomy.userActionBlockers[0] || null;
  const planBlock = notice.planPreview ? formatChatComputerTaskPlanPreview(notice.planPreview) : '';
  // Action and blocker lines come BEFORE the plan block: compact consumers
  // (handoff messages) keep only the leading lines, and the user's next
  // action must never be displaced by plan detail.
  const lines = [
    notice.summary,
    notice.appChoiceLine,
    notice.primaryAction ? `${notice.primaryAction.label}: ${notice.primaryAction.detail}` : null,
    !notice.primaryAction && primaryUserAction ? `Next: ${primaryUserAction}` : null,
    firstBlocker && firstBlocker !== primaryUserAction ? `Blocker: ${firstBlocker}` : null,
    planBlock || null,
    // Proof folds into the plan block when present — avoid stating it twice.
    !planBlock && notice.proof.length ? `Proof: ${notice.proof.join('; ')}` : null,
  ].filter((line): line is string => Boolean(line));
  return [`**${notice.title}**`, ...lines].join('\n');
}

export function summarizeChatComputerRequestUserNotice(route: ChatComputerRequestRoute): Record<string, unknown> {
  const notice = buildChatComputerRequestUserNotice(route);
  return {
    visibility: notice.visibility,
    tone: notice.tone,
    title: notice.title,
    summary: notice.summary,
    autonomy: {
      userEffort: notice.autonomy.userEffort,
      canRunQuietly: notice.autonomy.canRunQuietly,
      canAutoPrepare: notice.autonomy.canAutoPrepare,
      primaryUserAction: notice.autonomy.primaryUserAction,
      reason: notice.autonomy.reason,
      userActionBlockerCount: notice.autonomy.userActionBlockers.length,
      guardrails: notice.autonomy.guardrails.slice(0, 4),
      automationSteps: notice.autonomy.automationSteps.slice(0, 4),
    },
    primaryAction: notice.primaryAction,
    badges: notice.badges,
    proof: notice.proof,
    hiddenReason: notice.hiddenReason,
    appChoiceLine: notice.appChoiceLine,
    appChoice: notice.appChoice
      ? {
          visibility: notice.appChoice.visibility,
          selectedAppId: notice.appChoice.selectedAppId,
          selectedAppName: notice.appChoice.selectedAppName,
          selectedSurface: notice.appChoice.selectedSurface,
          availability: notice.appChoice.availability || null,
          reason: notice.appChoice.reason,
          alternativeCount: notice.appChoice.alternatives.length,
          alternatives: notice.appChoice.alternatives.slice(0, 3),
          switchHint: notice.appChoice.switchHint,
          explicitAppNamed: notice.appChoice.explicitAppNamed,
          recoveryFallbackName: notice.appChoice.recoveryFallbackName || null,
        }
      : null,
    planPreview: notice.planPreview
      ? {
          target: notice.planPreview.target,
          stepCount: notice.planPreview.steps.length,
          steps: notice.planPreview.steps.slice(0, 6),
          surfaces: notice.planPreview.surfaces,
          approvalGateCount: notice.planPreview.approvalGates.length,
          constraints: notice.planPreview.constraints.slice(0, 3),
        }
      : null,
    routeDecision: route.appAutomationRouteDecision
      ? {
          status: route.appAutomationRouteDecision.status,
          targetName: route.appAutomationRouteDecision.targetName,
          taskFamily: route.appAutomationRouteDecision.taskFamily,
          chosenSurfaceId: route.appAutomationRouteDecision.chosenSurface.id,
          chosenSurfaceLabel: route.appAutomationRouteDecision.chosenSurface.label,
          score: route.appAutomationRouteDecision.score,
          missingConfirmationCount: route.appAutomationRouteDecision.missingConfirmations.length,
          missingApprovalCount: route.appAutomationRouteDecision.missingApprovals.length,
        }
      : null,
  };
}
