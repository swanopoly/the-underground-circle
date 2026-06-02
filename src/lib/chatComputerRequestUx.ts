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
  };
}

export function formatChatComputerRequestUserNotice(notice: ChatComputerRequestUserNotice): string {
  if (notice.visibility === 'hidden') return '';
  const primaryUserAction = notice.autonomy.primaryUserAction;
  const firstBlocker = notice.autonomy.userActionBlockers[0] || null;
  const lines = [
    notice.summary,
    notice.primaryAction ? `${notice.primaryAction.label}: ${notice.primaryAction.detail}` : null,
    !notice.primaryAction && primaryUserAction ? `Next: ${primaryUserAction}` : null,
    firstBlocker && firstBlocker !== primaryUserAction ? `Blocker: ${firstBlocker}` : null,
    notice.proof.length ? `Proof: ${notice.proof.join('; ')}` : null,
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
