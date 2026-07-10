/**
 * appScreenObserver — the LIVE composition behind the `/screen` chat command:
 * one bridge round trip (`observeApp`, frontmost app when no name is given)
 * → `snapshotA11ySummary` → diff vs this module's own last-look baseline →
 * `classifyA11yDiffOutcome` → `buildAppScreenNextStep` → a structured
 * observation plus ready-to-render chat text.
 *
 * Sibling of the `desktop.observe_app` tool handler in
 * src/lib/openswanToolRuntime.ts — same composition, DIFFERENT owner and a
 * SEPARATE snapshot cache on purpose: chat `/screen` reads must not perturb
 * the tool loop's Δ-since-last-read baselines (and vice versa). The cache
 * policy is identical to the runtime's P15 cache: ≤8 apps, FIFO eviction of
 * the first-inserted key, keyed by lowercased app name because the Mac's app
 * state is physically global.
 *
 * House pattern: mirrors appReachabilityProbe.ts — impure by design (drives
 * the bridge); ALL runtime imports are lazy so pure modules and tsx smokes
 * never pull the bridge in accidentally. The pure formatting lives in
 * src/lib/screenChatCommand.ts, which also owns the observation input type
 * (dependency direction stays pure ← impure).
 */

import type { A11ySummaryNode } from './a11yTreeDiff';
import type { ScreenChatObservation } from './screenChatCommand';

export interface AppScreenObservationResult extends ScreenChatObservation {
  /** Ready-to-render chat card (formatScreenReportForChat output, ≤1200 chars). */
  describeForChat: string;
}

/** Cache bound — LOCKSTEP with the P15 cache policy in openswanToolRuntime.ts. */
const MAX_CACHED_APPS = 8;

// OWN last-look baseline per app (bounded ≤8 apps × ≤400 summary nodes) so a
// second /screen on the same app reports a structured +/−/~ delta. Kept
// separate from the tool runtime's cache by design (see module header).
const lastScreenA11ySnapshotByApp = new Map<string, A11ySummaryNode[]>();

/**
 * Observe one app's screen for chat. `appName` empty/absent → the frontmost
 * app. Returns null when no observation is possible (desktop bridge offline
 * or the observe call failed) — the caller shows the bridge-offline hint.
 * A NON-RUNNING app is a successful observation (advice: launch_app), not
 * null.
 */
export async function runAppScreenObservation(args: {
  appName?: string;
  taskHint?: string;
}): Promise<AppScreenObservationResult | null> {
  const bridge = await import('./desktopBridge');
  const online = await bridge.isDesktopBridgeAvailable().catch(() => false);
  if (!online) return null;

  const cleanName = String(args?.appName || '').trim().slice(0, 120);
  const taskHint = String(args?.taskHint || '').trim().slice(0, 300) || null;

  const r = await bridge.observeApp({ appName: cleanName || undefined }).catch(() => null);
  if (!r?.ok || !r.data) return null;
  const d = r.data;

  const { snapshotA11ySummary, diffA11ySummaries, classifyA11yDiffOutcome } = await import('./a11yTreeDiff');
  const { buildAppScreenNextStep } = await import('./appScreenNextStep');
  const { formatScreenReportForChat } = await import('./screenChatCommand');

  const summary = d.tree ? snapshotA11ySummary(d.tree) : [];

  // Diff vs our own baseline, then advance it (same key + eviction semantics
  // as the runtime's cache: first-inserted key evicts once size exceeds 8).
  const appKey = String(d.app || cleanName || 'frontmost').trim().toLowerCase();
  const prev = lastScreenA11ySnapshotByApp.get(appKey);
  if (summary.length > 0) {
    lastScreenA11ySnapshotByApp.set(appKey, summary);
    if (lastScreenA11ySnapshotByApp.size > MAX_CACHED_APPS) {
      const oldest = lastScreenA11ySnapshotByApp.keys().next().value;
      if (oldest !== undefined) lastScreenA11ySnapshotByApp.delete(oldest);
    }
  }

  let diff: ScreenChatObservation['diff'] = null;
  if (prev && summary.length > 0) {
    const rawDiff = diffA11ySummaries(prev, summary);
    diff = {
      added: rawDiff.addedTotal,
      removed: rawDiff.removedTotal,
      changed: rawDiff.changedTotal,
      outcome: classifyA11yDiffOutcome(rawDiff),
    };
  }

  const appName = d.app || cleanName || 'frontmost app';
  const advice = buildAppScreenNextStep({
    appName,
    taskHint,
    appRunning: d.appRunning,
    frontmost: d.frontmost,
    frontmostApp: d.frontmostApp,
    windowCount: d.windowCount,
    windowTitles: d.windowTitles,
    a11ySummary: summary,
    diffOutcome: diff ? diff.outcome : null,
    lastActionKind: null,
  });

  const observation: ScreenChatObservation = {
    appName,
    appRunning: d.appRunning === true,
    frontmost: d.frontmost === true,
    frontmostApp: d.frontmostApp ?? null,
    windowCount: Math.max(0, Number(d.windowCount || 0)),
    // RAW untrusted titles — the pure formatter fences them; nothing else
    // may render them into model- or user-visible text unfenced.
    windowTitles: Array.isArray(d.windowTitles) ? d.windowTitles : [],
    a11yNodeCount: Math.max(0, Number(d.budget_used || 0)),
    diff,
    advice,
  };
  return { ...observation, describeForChat: formatScreenReportForChat(observation) };
}
