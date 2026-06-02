import type { AppAutomationRouteDecisionStatus } from './appAutomationControlSurfaces';
import type { ChatComputerRequestRoute, ChatComputerRequestRouteKind } from './chatComputerRequestRouter';

export type ChatComputerTaskUserEffort =
  | 'none'
  | 'approve'
  | 'unblock'
  | 'review';

export interface ChatComputerTaskAutonomy {
  userEffort: ChatComputerTaskUserEffort;
  shouldShowUserNotice: boolean;
  canRunQuietly: boolean;
  canAutoPrepare: boolean;
  autoPreparationTargets: string[];
  primaryUserAction: string | null;
  hiddenReason: string | null;
  reason: string;
  userActionBlockers: string[];
  guardrails: string[];
  automationSteps: string[];
}

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, max);
}

function routeNeedsDesktopPreparation(kind: ChatComputerRequestRouteKind): boolean {
  return kind === 'desktop_app' || kind === 'local_file' || kind === 'hybrid' || kind === 'agent_buildout';
}

function statusRequiresUserAction(status?: AppAutomationRouteDecisionStatus | null): boolean {
  return status === 'needs_user_action';
}

function statusNeedsSupportReview(status?: AppAutomationRouteDecisionStatus | null): boolean {
  return status === 'needs_connected_agent_buildout';
}

function blockedSurfaceReasons(route: ChatComputerRequestRoute): string[] {
  const surfacePlan = route.surfacePlan;
  if (!surfacePlan) return [];
  if (surfacePlan.status !== 'blocked' && surfacePlan.status !== 'human_takeover_required') return [];
  return uniqueCompact([
    ...surfacePlan.readinessFindings
      .filter((finding) => finding.status === 'blocked')
      .map((finding) => finding.reason),
    surfacePlan.failureAssessment?.recommendedRecovery,
    surfacePlan.status === 'human_takeover_required' ? 'The task requires a human takeover before execution can continue.' : null,
    surfacePlan.status === 'blocked' ? 'The preferred execution surface is blocked for this run.' : null,
  ], 4);
}

function userActionBlockers(route: ChatComputerRequestRoute): string[] {
  return uniqueCompact([
    ...(route.appAutomationRouteDecision?.userActionBlockers || []),
    ...blockedSurfaceReasons(route),
  ], 5);
}

function autoPreparationTargets(route: ChatComputerRequestRoute): string[] {
  if (!routeNeedsDesktopPreparation(route.kind)) return [];
  return uniqueCompact([
    'local desktop bridge',
    route.kind === 'local_file' ? 'scoped local file grant' : null,
    route.kind === 'desktop_app' || route.kind === 'hybrid' || route.kind === 'agent_buildout'
      ? 'active app/window observation'
      : null,
    route.designExecutionPipeline?.appName,
    route.appAutomationRouteDecision?.targetName,
  ], 5);
}

function primaryUserActionForEffort(route: ChatComputerRequestRoute, userEffort: ChatComputerTaskUserEffort, blockers: string[]): string | null {
  switch (userEffort) {
    case 'unblock':
      return blockers[0] || 'Clear the required local app, browser, credential, or permission blocker, then retry.';
    case 'approve':
      return route.approvalReason || route.appAutomationRouteDecision?.missingApprovals[0] || 'Approve the prepared computer task before mutation or side effects.';
    case 'review':
      return 'Review the proposed connected-agent support buildout before execution continues.';
    case 'none':
    default:
      return null;
  }
}

function reasonForEffort(route: ChatComputerRequestRoute, userEffort: ChatComputerTaskUserEffort, blockers: string[]): string {
  switch (userEffort) {
    case 'unblock':
      return blockers[0] || 'A user-controlled surface is blocked.';
    case 'approve':
      return route.approvalReason || 'The request crosses an approval boundary.';
    case 'review':
      return 'The app path needs support review before the agent should build or run a missing capability.';
    case 'none':
    default:
      return 'The route can run with existing capabilities and does not need a user step before useful work starts.';
  }
}

function buildGuardrails(route: ChatComputerRequestRoute): string[] {
  return uniqueCompact([
    'Observe the current page, window, document, or file scope before acting.',
    route.kind === 'browser'
      ? 'Prefer role, label, text, title, and test-id locators before CSS or coordinates.'
      : 'Prefer app-native APIs, scripts, menus, or accessibility trees before screenshots or coordinates.',
    'Stop before submit, publish, payment, send, delete, overwrite, credential, MFA, or human-verification steps unless approved.',
    'For unexpected desktop or browser popups, read the accessible text/buttons and use the guarded modal advisor; auto-click only high-confidence safe acknowledgements or the requested output overwrite.',
    'Verify immediately after each mutation with refreshed state, proof, or an exact blocker.',
    ...(route.evidenceContract?.failClosedRules || []),
  ], 6);
}

function buildAutomationSteps(route: ChatComputerRequestRoute, canAutoPrepare: boolean): string[] {
  return uniqueCompact([
    canAutoPrepare ? `Prepare ${autoPreparationTargets(route).join(', ')} quietly when possible.` : null,
    ...(route.evidenceContract?.observeBefore || []),
    ...(route.evidenceContract?.actionabilityChecks || []),
    ...(route.evidenceContract?.proofAfter || []),
  ], 8);
}

export function buildChatComputerTaskAutonomy(route: ChatComputerRequestRoute): ChatComputerTaskAutonomy {
  const blockers = userActionBlockers(route);
  const routeDecisionStatus = route.appAutomationRouteDecision?.status || null;
  const hasBlockedSurface = blockers.length > 0 || statusRequiresUserAction(routeDecisionStatus);
  const needsSupportReview = route.kind === 'agent_buildout' || statusNeedsSupportReview(routeDecisionStatus);
  const userEffort: ChatComputerTaskUserEffort = hasBlockedSurface
    ? 'unblock'
    : route.approvalRequired || routeDecisionStatus === 'needs_approval'
      ? 'approve'
      : needsSupportReview
        ? 'review'
        : 'none';
  const canAutoPrepare = routeNeedsDesktopPreparation(route.kind) && userEffort !== 'unblock';
  const shouldShowUserNotice = userEffort !== 'none';
  return {
    userEffort,
    shouldShowUserNotice,
    canRunQuietly: userEffort === 'none',
    canAutoPrepare,
    autoPreparationTargets: autoPreparationTargets(route),
    primaryUserAction: primaryUserActionForEffort(route, userEffort, blockers),
    hiddenReason: shouldShowUserNotice
      ? null
      : 'No user step is needed yet; keep setup and routing hidden until approval, proof, or an actionable blocker exists.',
    reason: reasonForEffort(route, userEffort, blockers),
    userActionBlockers: blockers,
    guardrails: buildGuardrails(route),
    automationSteps: buildAutomationSteps(route, canAutoPrepare),
  };
}

export function formatChatComputerTaskAutonomyPromptBlock(route: ChatComputerRequestRoute): string {
  const autonomy = buildChatComputerTaskAutonomy(route);
  return [
    '## Least User Effort Policy',
    `User effort: ${autonomy.userEffort}`,
    `Can run quietly: ${autonomy.canRunQuietly ? 'yes' : 'no'}`,
    `Can auto-prepare: ${autonomy.canAutoPrepare ? 'yes' : 'no'}`,
    `Show user notice: ${autonomy.shouldShowUserNotice ? 'yes' : 'no'}`,
    autonomy.primaryUserAction ? `Primary user action: ${autonomy.primaryUserAction}` : null,
    `Reason: ${autonomy.reason}`,
    `Auto-prep targets: ${autonomy.autoPreparationTargets.join(' | ') || 'none'}`,
    `User blockers: ${autonomy.userActionBlockers.join(' | ') || 'none'}`,
    `Automation steps: ${autonomy.automationSteps.slice(0, 5).join(' | ') || 'none'}`,
    `Guardrails: ${autonomy.guardrails.slice(0, 5).join(' | ') || 'none'}`,
    autonomy.userEffort === 'none'
      ? 'Execution rule: start useful work quietly and only surface proof, result, or actionable blockers.'
      : autonomy.userEffort === 'approve'
        ? 'Execution rule: prepare quietly where allowed, then stop at the approval boundary with one clear action.'
        : autonomy.userEffort === 'unblock'
          ? 'Execution rule: do not continue execution until the user-controlled blocker is cleared.'
          : 'Execution rule: ask for bounded support review/buildout before creating or running missing capability code.',
  ].filter(Boolean).join('\n');
}
