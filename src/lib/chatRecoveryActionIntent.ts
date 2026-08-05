import {
  buildChatFailureRecoveryExecutionPlan,
  type ChatFailureRecoveryOption,
  type ChatFailureRecoveryOptionSelection,
} from './chatFailureRecovery';

export type ChatRecoveryActionKind =
  | 'run_recovery'
  | 'connect_desktop_bridge'
  | 'draft_recovery'
  | 'show_user_step'
  | 'show_details';

export type ChatRecoveryActionIntent = {
  kind: ChatRecoveryActionKind;
  label: string;
  detail: string;
  autoSendsPrompt: boolean;
};

export type ChatRecoveryActionSource = ChatFailureRecoveryOption | ChatFailureRecoveryOptionSelection;

function compactDisplayText(value: unknown, maxChars = 160): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function isDesktopBridgeRecoverySurface(surface?: string | null): boolean {
  const normalized = String(surface || '').trim();
  return normalized === 'desktop_bridge'
    || normalized === 'main_chat_desktop_bridge'
    || normalized.startsWith('desktop_bridge_');
}

export function buildChatRecoveryActionIntent(
  option: ChatRecoveryActionSource,
  context: {
    sourceSurface?: string | null;
    platform?: string | null;
  } = {},
): ChatRecoveryActionIntent {
  const plan = buildChatFailureRecoveryExecutionPlan(option);
  const policy = plan.policy;
  const sourceSurface = context.sourceSurface || ('context' in option ? option.context?.sourceSurface : null);
  const onDesktopBridgeSurface = isDesktopBridgeRecoverySurface(sourceSurface);

  if (policy.action === 'repair_or_restart_bridge' && onDesktopBridgeSurface && context.platform === 'web') {
    return {
      kind: 'connect_desktop_bridge',
      label: 'START',
      detail: 'Start, pair, or repair the local desktop bridge now.',
      autoSendsPrompt: false,
    };
  }

  if (policy.action === 'repair_with_connected_agent') {
    return {
      kind: 'run_recovery',
      label: 'REPAIR',
      detail: 'Send this recovery option now so a connected agent can repair the missing runtime path.',
      autoSendsPrompt: true,
    };
  }

  if (policy.action === 'retry_with_fresh_evidence' || policy.action === 'switch_route_or_model' || policy.action === 'continue_recovery') {
    return {
      kind: 'run_recovery',
      label: 'RUN',
      detail: plan.userSummary,
      autoSendsPrompt: true,
    };
  }

  if (policy.action === 'request_user_unblock' || policy.userActionRequired || option.actor === 'user') {
    return {
      kind: 'show_user_step',
      label: 'GUIDE',
      detail: plan.userSummary,
      autoSendsPrompt: false,
    };
  }

  if (policy.action === 'stop_and_report' || policy.safetyMode === 'stop') {
    return {
      kind: 'show_details',
      label: 'DETAILS',
      detail: plan.userSummary,
      autoSendsPrompt: false,
    };
  }

  return {
    kind: 'draft_recovery',
    label: 'DRAFT',
    detail: plan.userSummary,
    autoSendsPrompt: false,
  };
}

export function formatChatRecoveryActionDisplayText(
  option: ChatRecoveryActionSource,
  intent: ChatRecoveryActionIntent = buildChatRecoveryActionIntent(option),
): string {
  const label = compactDisplayText(option.label, 96) || 'Recovery option';
  const display = (() => {
    switch (intent.kind) {
      case 'run_recovery':
        return intent.label === 'REPAIR'
          ? `Repair this with a connected agent: ${label}`
          : `Run recovery: ${label}`;
      case 'connect_desktop_bridge':
        return `Start desktop bridge: ${label}`;
      case 'show_user_step':
        return `Show me the user step: ${label}`;
      case 'show_details':
        return `Show failure details: ${label}`;
      case 'draft_recovery':
      default:
        return `Use recovery option: ${label}`;
    }
  })();
  return compactDisplayText(display, 160);
}
