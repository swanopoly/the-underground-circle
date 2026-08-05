import type { ChatFailureRecoveryOption } from './chatFailureRecovery';

export type DesktopBridgeRecoveryReason =
  | 'unreachable'
  | 'unsupported'
  | 'pair_failed';

export interface DesktopBridgeRecoveryPayload {
  content: string;
  recoveryOptions: ChatFailureRecoveryOption[];
  touched: string[];
}

function clean(value: unknown, max = 600): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildDesktopBridgeRecoveryOptions(
  reason: DesktopBridgeRecoveryReason = 'unreachable',
  detail?: string | null,
): ChatFailureRecoveryOption[] {
  const reasonText = clean(detail || reason, 220);
  if (reason === 'unsupported') {
    return [
      {
        id: 'stop_and_report',
        label: 'Show desktop support details',
        detail: reasonText || 'Desktop automation is currently supported on macOS only.',
        actor: 'none',
        recommended: true,
        source: 'safety_stop',
      },
    ];
  }

  return [
    {
      id: 'repair_or_restart_bridge',
      label: 'Start or repair the bridge',
      detail: reason === 'pair_failed'
        ? `Pairing failed: ${reasonText || 'unknown error'}. Tap DESKTOP to retry pairing, or restart the bridge with npm run bridge.`
        : 'Tap DESKTOP to retry the local one-click connect path. If nothing local is listening, run npm run bridge or start the app with npm run start.',
      actor: 'user',
      recommended: true,
      source: 'recovery_policy',
    },
    {
      id: 'let_connected_agent_repair',
      label: 'Diagnose bridge setup',
      detail: 'Have a connected agent inspect desktop bridge routing, CORS, token pairing, and startup scripts for the bounded fix.',
      actor: 'connected_agent',
      recommended: false,
      source: 'connected_agent_runbook',
    },
    {
      id: 'stop_and_report',
      label: 'Stop and show details',
      detail: reasonText || 'Keep the bridge failure visible without retrying or patching anything.',
      actor: 'none',
      recommended: false,
      source: 'safety_stop',
    },
  ];
}

export function renderDesktopBridgeRecoveryMessage(
  reason: DesktopBridgeRecoveryReason = 'unreachable',
  detail?: string | null,
): string {
  if (reason === 'unsupported') {
    return [
      '**Desktop bridge is not supported on this platform.**',
      '',
      clean(detail) || 'Desktop automation is macOS-only in the current phase.',
    ].join('\n');
  }

  if (reason === 'pair_failed') {
    return [
      '**Desktop bridge pairing failed.**',
      '',
      clean(detail) || 'The bridge responded, but the browser could not complete pairing.',
      '',
      'Try restarting the bridge, then tap **Pair Desktop Bridge** again:',
      '',
      '```',
      'npm run bridge',
      '```',
    ].join('\n');
  }

  return [
    '**Desktop bridge unreachable.**',
    '',
    'Tap **DESKTOP** again to retry the local connect path. If the browser still cannot reach a local starter, start it from this repo:',
    '',
    '```',
    'npm run start',
    '# or only the bridge:',
    'npm run bridge',
    '```',
  ].join('\n');
}

export function buildDesktopBridgeRecoveryPayload(
  reason: DesktopBridgeRecoveryReason = 'unreachable',
  detail?: string | null,
): DesktopBridgeRecoveryPayload {
  return {
    content: renderDesktopBridgeRecoveryMessage(reason, detail),
    recoveryOptions: buildDesktopBridgeRecoveryOptions(reason, detail),
    touched: [
      'surface:desktop_bridge',
      'src/lib/desktopBridge.ts',
      'scripts/claude-bridge.js',
      `desktop_bridge:${reason}`,
    ],
  };
}
