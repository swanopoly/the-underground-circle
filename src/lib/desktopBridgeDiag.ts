/**
 * desktopBridgeDiag — step-by-step health probe for the local desktop
 * bridge. Exists because "open Zoom" can fail at several layers and
 * the previous UX only surfaced a generic URL-scheme fallback. Now
 * users can run `/desktop diag` in chat and get a checklist of which
 * layer is broken: bridge reachable → CORS → paired → launch.
 *
 * No UI here — just the pure probe. `desktopBridgeDiagCommand.ts`
 * maps this into a chat message.
 */
import { matchKnownApp, resolveMacLaunchName } from './knownAppShortcuts';
import {
  BRIDGE_HEALTH_URL,
  ensureDesktopBridgePaired,
  getDesktopBridgeHealth,
  isDesktopBridgeAvailable,
  launchApp,
} from './desktopBridge';

export type DiagStep = {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
  hint?: string;
};

export async function runDesktopBridgeDiag(sampleAppTask?: string): Promise<{
  steps: DiagStep[];
  overall: 'healthy' | 'degraded' | 'offline';
}> {
  const steps: DiagStep[] = [];

  // 1. Bridge reachable?
  let reachable = false;
  try {
    reachable = await isDesktopBridgeAvailable();
  } catch { /* already handled */ }

  steps.push(
    reachable
      ? { name: 'Bridge reachable', status: 'pass', detail: `localhost:7778 responding at ${BRIDGE_HEALTH_URL}` }
      : {
          name: 'Bridge reachable',
          status: 'fail',
          detail: 'No response on localhost:7778/desktop/health.',
          hint: 'Run `node scripts/claude-bridge.js` in a terminal (or `npm run bridge`).',
        },
  );

  if (!reachable) {
    return { steps, overall: 'offline' };
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
    return { steps, overall: 'degraded' };
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
    return { steps, overall: 'degraded' };
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
    return { steps, overall: 'degraded' };
  }
  steps.push({
    name: 'Paired with bridge',
    status: 'pass',
    detail: paired.data?.autoPaired ? 'Auto-paired on this run.' : 'Token cached in localStorage.',
  });

  // 4. Authed request round-trip (list running apps — read-only probe)
  //    We deliberately use a real call so we catch CORS/header issues
  //    (the CORS regression that prompted this whole diag command).
  if (sampleAppTask) {
    const candidate = matchKnownApp(sampleAppTask);
    if (candidate) {
      steps.push({
        name: `Alias match for "${sampleAppTask.slice(0, 40)}"`,
        status: 'pass',
        detail: `${candidate.displayName} (id: ${candidate.id})`,
      });
      // Attempt launch.
      const launched = await launchApp(resolveMacLaunchName(candidate));
      if (launched.ok) {
        steps.push({
          name: 'Launch round-trip',
          status: 'pass',
          detail: `Opened ${candidate.displayName} successfully.`,
        });
      } else {
        steps.push({
          name: 'Launch round-trip',
          status: 'fail',
          detail: launched.error || 'launch failed',
          hint:
            launched.errorCode === 'permission_denied'
              ? 'System Settings → Privacy & Security → Accessibility → enable your terminal.'
              : launched.errorCode === 'app_not_found'
                ? `${candidate.displayName} isn't installed.`
                : launched.errorCode === 'origin_blocked'
                  ? 'Bridge CORS missing X-UC-Desktop-Token in Access-Control-Allow-Headers.'
                  : 'Check `node scripts/claude-bridge.js` terminal output for the error.',
        });
      }
    } else {
      steps.push({
        name: `Alias match for "${sampleAppTask.slice(0, 40)}"`,
        status: 'skip',
        detail: 'Unknown app. Add it to `src/lib/knownAppShortcuts.ts` or use a supported alias.',
      });
    }
  }

  const anyFail = steps.some((s) => s.status === 'fail');
  return { steps, overall: anyFail ? 'degraded' : 'healthy' };
}

/**
 * Renders the diag result as a chat-ready Markdown block.
 */
export function renderDesktopBridgeDiag(
  result: Awaited<ReturnType<typeof runDesktopBridgeDiag>>,
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
  return lines.join('\n');
}
