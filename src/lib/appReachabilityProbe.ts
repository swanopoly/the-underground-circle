/**
 * appReachabilityProbe — the LIVE composition over the pure ladder in
 * `appReachability.ts`: gathers real probe data from the desktop bridge
 * (health → installed → running → window state → tiny a11y probe) and
 * returns the classified report + chat-ready text.
 *
 * Single owner for this composition: both the `desktop.app_reachability`
 * tool handler (openswanToolRuntime) and the `/apps` chat command
 * (ChatTab) call this, so the two surfaces can never drift.
 *
 * Impure by design (drives the bridge); all bridge access is lazy-imported
 * so pure modules and smokes never pull it in accidentally.
 */

import type { AppReachabilityReport } from './appReachability';

export interface AppReachabilityProbeResult {
  report: AppReachabilityReport;
  text: string;
}

export async function runAppReachabilityProbe(appName: string): Promise<AppReachabilityProbeResult> {
  const { resolveAppAutomationDoc } = await import('./appAutomationDocsIndex');
  const {
    buildAppReachabilityReport,
    describeAppReachabilityForChat,
    requiredBridgeCommandsForDocSlug,
  } = await import('./appReachability');
  const bridge = await import('./desktopBridge');

  const cleanName = String(appName || '').trim().slice(0, 120);
  const appDoc = resolveAppAutomationDoc(cleanName) || resolveAppAutomationDoc(null, cleanName);

  const health = await bridge.getDesktopBridgeHealth().catch(() => null);
  const bridgeOnline = !!health?.ok && health.supported !== false;
  const bridgeToolNames = Array.isArray((health as any)?.tools) ? ((health as any).tools as string[]) : null;

  let installed: { installed: boolean; resolvedName?: string | null } | null = null;
  let runningApps: string[] | null = null;
  let windowState: { frontmostApp?: string | null; appHasWindow?: boolean | null } | null = null;
  let a11yProbe: { ok: boolean; nodeCount?: number | null; error?: string | null } | null = null;

  const isWebApp = appDoc?.status === 'web_only' || appDoc?.status === 'cloud_service';
  if (bridgeOnline && !isWebApp) {
    const [installedRes, runningRes, windowRes] = await Promise.all([
      bridge.checkAppInstalled(cleanName).catch(() => null),
      bridge.listRunningApps().catch(() => null),
      bridge.getWindowState().catch(() => null),
    ]);
    if (installedRes?.ok && installedRes.data) {
      installed = { installed: installedRes.data.installed === true, resolvedName: installedRes.data.resolvedName || null };
    }
    if (runningRes?.ok && Array.isArray(runningRes.data)) runningApps = runningRes.data;
    if (windowRes?.ok && windowRes.data) {
      windowState = {
        frontmostApp: windowRes.data.frontmostApp || null,
        appHasWindow: Array.isArray(windowRes.data.windows) ? windowRes.data.windows.length > 0 : null,
      };
    }
    // Tiny a11y probe only when the app looks running — it is the last rung
    // and the only probe with real latency (~50ms-1s).
    const lname = cleanName.toLowerCase();
    const resolvedLower = (installed?.resolvedName || '').toLowerCase();
    const looksRunning = (runningApps || []).some((name) => {
      const n = String(name || '').toLowerCase();
      return n.includes(lname) || lname.includes(n) || (!!resolvedLower && (n.includes(resolvedLower) || resolvedLower.includes(n)));
    });
    if (looksRunning) {
      const treeRes = await bridge.readA11yTree({ appName: cleanName, maxDepth: 2, maxNodes: 5 }).catch(() => null);
      if (treeRes?.ok && treeRes.data) {
        const count = Number((treeRes.data as any).budget_used ?? 0);
        a11yProbe = { ok: true, nodeCount: Number.isFinite(count) ? count : null };
      } else if (treeRes && !treeRes.ok) {
        a11yProbe = { ok: false, error: treeRes.error || 'a11y read failed' };
      }
    }
  }

  const report = buildAppReachabilityReport({
    appName: cleanName,
    bridgeOnline,
    bridgeToolNames,
    requiredBridgeCommands: requiredBridgeCommandsForDocSlug(appDoc?.slug),
    appDoc,
    installed,
    runningApps,
    windowState,
    a11yProbe,
  });
  return { report, text: describeAppReachabilityForChat(report) };
}
