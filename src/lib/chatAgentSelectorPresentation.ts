import {
  normalizeChatAgentProvider,
  type ChatAgentTargetStatus,
} from './chatAgentTargets';
import {
  getOpenSwanModePolicy,
  type OpenSwanChatMode,
} from './openswanModePolicy';

export interface ChatAgentSelectorTargetSnapshot {
  label?: string | null;
  provider?: string | null;
  connected?: boolean | null;
  status?: ChatAgentTargetStatus | string | null;
  isDefault?: boolean | null;
}

export interface ChatAgentSelectorPresentation {
  /** The selected route/mode, for example `Chat` or `Execute`. */
  routeLabel: string;
  /** Availability or route state with the target name included. */
  targetStateLabel: string;
  /** Availability or route state without repeating the target name. */
  stateLabel: string;
  /** Compact selector copy rendered beneath the selected target. */
  summaryLabel: string;
  /** True only when an OpenSwan runtime mode is selected. */
  openSwanRuntimeActive: boolean;
}

function humanizeStatus(status: string | null | undefined): string {
  return String(status || 'ready').trim().toLowerCase().replace(/[_-]+/g, ' ');
}

/**
 * Resolves the selector's route-aware status copy without changing routing.
 *
 * `active` on a ChatAgentTarget describes target availability. It must not be
 * presented as an active OpenSwan route while normal Chat mode (`none`) is
 * selected. Keeping those two state domains separate prevents contradictory
 * UI such as `Off · active`.
 */
export function resolveChatAgentSelectorPresentation(
  chatMode: OpenSwanChatMode | string | null | undefined,
  target?: ChatAgentSelectorTargetSnapshot | null,
): ChatAgentSelectorPresentation {
  const modePolicy = getOpenSwanModePolicy(chatMode);
  const openSwanRuntimeActive = modePolicy.key !== 'none';
  const targetLabel = String(target?.label || 'OpenSwan').trim() || 'OpenSwan';
  const isOpenSwanTarget =
    !target
    || target.isDefault === true
    || normalizeChatAgentProvider(target.provider) === 'openswan';
  const connected = target?.connected !== false;
  const normalizedStatus = humanizeStatus(target?.status);

  let stateLabel: string;
  if (!connected || normalizedStatus === 'setup required') {
    stateLabel = 'setup required';
  } else if (normalizedStatus === 'offline') {
    stateLabel = 'offline';
  } else if (normalizedStatus === 'building') {
    stateLabel = 'building';
  } else if (isOpenSwanTarget) {
    // Mode selection is the source of truth for whether this chat is using the
    // OpenSwan runtime. Target status only tells us whether it is available.
    stateLabel = openSwanRuntimeActive ? 'active' : 'available';
  } else {
    stateLabel = normalizedStatus;
  }

  const targetStateLabel = `${targetLabel} ${stateLabel}`;
  return {
    routeLabel: modePolicy.label,
    targetStateLabel,
    stateLabel,
    summaryLabel: `${modePolicy.label} · ${targetStateLabel}`,
    openSwanRuntimeActive,
  };
}
