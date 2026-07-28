/**
 * desktopBridgeDiag — step-by-step health probe for the local desktop
 * bridge. Exists because "open Zoom" can fail at several layers and
 * the previous UX only surfaced a generic URL-scheme fallback. Now
 * users can run `/desktop diag` in chat and get a checklist of which
 * layer is broken: bridge reachable → health/capabilities → paired →
 * authenticated read-only request.
 *
 * This lane NEVER launches, focuses, opens, clicks, or types. When an app is
 * supplied it returns a non-executable typed-runtime handoff so the mutation
 * can continue only under OpenSwan's authenticated run, exact provider-call
 * identity, approval, dispatch-receipt, and proof gates.
 */
import { matchKnownApp, resolveMacLaunchName } from './knownAppShortcuts';

export type DiagStep = {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  hint?: string;
};

export const DESKTOP_DIAG_LAUNCH_REQUIRED_CONTEXT = [
  'authenticated_user_id',
  'circle_id',
  'persisted_agent_run_id',
  'provider_tool_name',
  'provider_tool_use_id',
  'tool_iteration',
  'exact_openswan_runtime_approval',
  'fresh_native_app_observation',
  'runtime_mutation_dispatch_receipt',
  'post_launch_focus_proof',
] as const;

export type DesktopDiagLaunchRuntimeRequirement =
  typeof DESKTOP_DIAG_LAUNCH_REQUIRED_CONTEXT[number];

export type DesktopDiagLaunchRuntimeHandoff = {
  kind: 'openswan_typed_tool';
  tool: 'desktop.launch_app';
  sourceLane: 'desktop_bridge_diag';
  reasonCode: 'sealed_runtime_identity_required';
  executable: false;
  carriesExecutableInput: false;
  carriesIdentity: false;
  carriesApproval: false;
  carriesProof: false;
  target: {
    requestedApp: string;
    matchedShortcutId: string | null;
    displayName: string;
    canonicalAppName: string | null;
  };
  requiredContext: DesktopDiagLaunchRuntimeRequirement[];
  message: string;
};

export type DesktopBridgeDiagResult = {
  steps: DiagStep[];
  overall: 'healthy' | 'degraded' | 'offline';
  runtimeHandoff?: DesktopDiagLaunchRuntimeHandoff;
};

function boundedDiagAppRequest(value: unknown): string {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Pure handoff builder. It proposes a canonical typed tool and safe app label,
 * but deliberately carries none of the sealed identity/approval/proof fields
 * required to execute that tool.
 */
export function buildDesktopDiagLaunchRuntimeHandoff(
  sampleAppTask: string,
): DesktopDiagLaunchRuntimeHandoff | null {
  const requestedApp = boundedDiagAppRequest(sampleAppTask);
  if (!requestedApp) return null;
  const candidate = matchKnownApp(requestedApp);
  const displayName = candidate?.displayName || requestedApp;
  return {
    kind: 'openswan_typed_tool',
    tool: 'desktop.launch_app',
    sourceLane: 'desktop_bridge_diag',
    reasonCode: 'sealed_runtime_identity_required',
    executable: false,
    carriesExecutableInput: false,
    carriesIdentity: false,
    carriesApproval: false,
    carriesProof: false,
    target: {
      requestedApp,
      matchedShortcutId: candidate?.id || null,
      displayName,
      canonicalAppName: candidate ? resolveMacLaunchName(candidate) : null,
    },
    requiredContext: [...DESKTOP_DIAG_LAUNCH_REQUIRED_CONTEXT],
    message:
      `Diagnostics did not launch ${displayName}. Continue through the OpenSwan desktop.launch_app typed runtime only after it receives current authenticated run/provider-call identity, exact approval, a fresh app observation, a runtime dispatch receipt, and post-launch focus proof.`,
  };
}

export async function runDesktopBridgeDiag(
  sampleAppTask?: string,
): Promise<DesktopBridgeDiagResult> {
  const steps: DiagStep[] = [];
  const runtimeHandoff = sampleAppTask
    ? buildDesktopDiagLaunchRuntimeHandoff(sampleAppTask)
    : null;
  const finish = (
    overall: DesktopBridgeDiagResult['overall'],
  ): DesktopBridgeDiagResult => ({
    steps,
    overall,
    ...(runtimeHandoff ? { runtimeHandoff } : {}),
  });
  // Keep the production module safe to import in pure renderer/handoff tests;
  // the bridge dependency is loaded only when the asynchronous probe runs.
  const {
    ensureDesktopBridgePaired,
    getDesktopBridgeHealthUrl,
    getDesktopBridgeHealth,
    isDesktopBridgeAvailable,
    listRunningApps,
  } = await import('./desktopBridge');

  // 1. Bridge reachable?
  let reachable = false;
  try {
    reachable = await isDesktopBridgeAvailable();
  } catch { /* already handled */ }

  steps.push(
    reachable
      ? { name: 'Bridge reachable', status: 'pass', detail: `desktop bridge responding at ${getDesktopBridgeHealthUrl() || 'configured bridge URL'}` }
      : {
          name: 'Bridge reachable',
          status: 'fail',
          detail: 'No response from the configured desktop bridge.',
          hint: 'Run `node scripts/claude-bridge.js` locally, or configure EXPO_PUBLIC_CLAUDE_BRIDGE_URL for a tunnel.',
        },
  );

  if (!reachable) {
    return finish('offline');
  }

  // 2. Full health shape
  const health = await getDesktopBridgeHealth();
  if (!health) {
    steps.push({
      name: 'Bridge health JSON',
      status: 'fail',
      detail: 'Bridge responded but /desktop/health did not return JSON with { supported }.',
      hint: 'Older bridge build — restart it after `git pull`.',
    });
    return finish('degraded');
  }
  steps.push({
    name: 'Bridge health JSON',
    status: 'pass',
    detail: `platform=${health.platform} · supported=${health.supported} · tools=${(health.tools || []).length}`,
  });

  if (!health.supported) {
    steps.push({
      name: 'Desktop automation support',
      status: 'fail',
      detail: `Bridge is on ${health.platform} — desktop automation is macOS-only for now.`,
      hint: 'Run the bridge on the Mac you want to automate.',
    });
    return finish('degraded');
  }

  // 3. Paired?
  const paired = await ensureDesktopBridgePaired();
  if (!paired.ok) {
    steps.push({
      name: 'Paired with bridge',
      status: 'fail',
      detail: paired.error || 'Pairing failed',
      hint:
        paired.errorCode === 'origin_blocked'
          ? 'Bridge rejected this origin. Check the bridge is the latest build and CORS allows X-UC-Desktop-Token.'
          : 'Tap ⎇ Pair Desktop Bridge in Chat Actions.',
    });
    return finish('degraded');
  }
  steps.push({
    name: 'Paired with bridge',
    status: 'pass',
    detail: paired.data?.autoPaired ? 'Auto-paired on this run.' : 'Token cached in localStorage.',
  });

  // 4. Authenticated read-only request round-trip. This catches CORS/header
  // regressions without changing app state.
  let runningAppsResult: Awaited<ReturnType<typeof listRunningApps>> | null = null;
  try {
    runningAppsResult = await listRunningApps();
  } catch {
    runningAppsResult = { ok: false, error: 'read-only bridge probe threw', errorCode: 'unknown' };
  }
  if (runningAppsResult.ok) {
    steps.push({
      name: 'Authenticated read-only probe',
      status: 'pass',
      detail: `Listed ${(runningAppsResult.data || []).length} running app${(runningAppsResult.data || []).length === 1 ? '' : 's'} without changing desktop state.`,
    });
  } else {
    steps.push({
      name: 'Authenticated read-only probe',
      status: 'fail',
      detail: runningAppsResult.error || 'Read-only running-app query failed.',
      hint:
        runningAppsResult.errorCode === 'origin_blocked'
          ? 'Bridge CORS must allow X-UC-Desktop-Token in Access-Control-Allow-Headers.'
          : runningAppsResult.errorCode === 'not_paired'
            ? 'Pair the Desktop Bridge, then run the diagnostic again.'
            : 'Check `node scripts/claude-bridge.js` terminal output for the read-only request error.',
    });
  }

  if (runtimeHandoff) {
    const candidate = matchKnownApp(runtimeHandoff.target.requestedApp);
    if (candidate) {
      steps.push({
        name: `Alias match for "${runtimeHandoff.target.requestedApp.slice(0, 40)}"`,
        status: 'pass',
        detail: `${candidate.displayName} (id: ${candidate.id})`,
      });
    } else {
      steps.push({
        name: `Alias match for "${runtimeHandoff.target.requestedApp.slice(0, 40)}"`,
        status: 'skip',
        detail: 'Unknown shortcut alias. The typed runtime must resolve the installed app from fresh evidence.',
      });
    }
    steps.push({
      name: 'App launch handoff',
      status: 'skip',
      detail: `Not executed here. Proposed typed tool: ${runtimeHandoff.tool}.`,
      hint: 'Continue through the authenticated OpenSwan runtime; diagnostics never launch, focus, or open apps.',
    });
  }

  const anyFail = steps.some((s) => s.status === 'fail');
  return finish(anyFail ? 'degraded' : 'healthy');
}

/**
 * Renders the diag result as a chat-ready Markdown block.
 */
export function renderDesktopBridgeDiag(
  result: DesktopBridgeDiagResult,
): string {
  const header = result.overall === 'healthy'
    ? '**Desktop bridge: healthy**'
    : result.overall === 'offline'
      ? '**Desktop bridge: OFFLINE**'
      : '**Desktop bridge: degraded**';

  const lines: string[] = [header, ''];
  for (const step of result.steps) {
    const icon = step.status === 'pass' ? 'OK' : step.status === 'fail' ? 'FAIL' : 'SKIP';
    lines.push(`- **[${icon}] ${step.name}** — ${step.detail}`);
    if (step.hint) lines.push(`  - Try: ${step.hint}`);
  }
  if (result.overall === 'offline') {
    lines.push('', 'Start it with: `node scripts/claude-bridge.js` (or `npm run bridge`), then retry.');
  }
  if (result.runtimeHandoff) {
    const handoff = result.runtimeHandoff;
    lines.push(
      '',
      '**OpenSwan runtime handoff (not executed)**',
      `- Tool: \`${handoff.tool}\``,
      `- Target: ${handoff.target.displayName}`,
      `- Required context: ${handoff.requiredContext.join(', ')}`,
      `- ${handoff.message}`,
    );
  }
  return lines.join('\n');
}
