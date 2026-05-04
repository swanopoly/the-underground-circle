/**
 * bridgeOneClickConnect — single entry point the Office Connect
 * Bridges panel uses to probe every local bridge in parallel,
 * auto-pair the desktop bridge, and roll the results into one
 * structure the UI can render.
 *
 * Why this lib exists: ConnectAllBridgesPanel.tsx wants to fan out
 * a single "Connect Bridges" tap into N probe calls + 1 pair call,
 * combine the results, and surface them with restart commands per
 * offline bridge. Doing all of that inline in the panel was making
 * the component hard to read; this library is the seam.
 */
import { probeBridges, type BridgeProbeResult } from './bridgeHealthDiag';
import { ensureDesktopBridgePaired, isDesktopBridgePaired } from './desktopBridge';

/** Command we tell users to run from a fresh terminal to bring all
 *  bridges up if they haven't installed yet or the daemon died. */
export const REOPEN_COMMAND = 'npx @underground-circle/connect';

/** Shape rendered by ConnectAllBridgesPanel. */
export interface ConnectAllBridgesResult {
  /** Bridge probe results — one per bridge in the catalog. */
  bridges: BridgeProbeResult[];
  /** Total agent sessions discovered across all healthy bridges. */
  liveAgentCount: number;
  /** Map of bridge name → live agent count for that specific bridge. */
  liveAgentsByBridge: Record<string, number>;
  /** Desktop-bridge pairing state for the small "auto-paired" line. */
  desktopBridge: {
    reachable: boolean;
    paired: boolean;
    /** True when this run was the one that paired (vs already paired). */
    pairedJustNow: boolean;
    /** When pairing failed, why. */
    reason?: string;
  };
  /** One-line summary the header pill / main bot message can use. */
  summary: string;
}

/**
 * Probe every local bridge in parallel, auto-pair the desktop bridge
 * if reachable, and return a single combined result. Never throws —
 * partial failures end up as offline rows in the bridges array.
 */
export async function connectAllBridges(): Promise<ConnectAllBridgesResult> {
  const wasPairedBeforeRun = isDesktopBridgePaired();

  // Probe + pair fan out together so the user-visible latency is
  // bounded by the slowest bridge probe (3s default), not their sum.
  const [bridges, pairing] = await Promise.all([
    probeBridges(),
    ensureDesktopBridgePaired().catch((err) => ({
      ok: false as const,
      error: err?.message || 'pair failed',
      errorCode: 'unknown' as const,
    })),
  ]);

  const liveAgentsByBridge: Record<string, number> = {};
  let liveAgentCount = 0;
  for (const b of bridges) {
    const count = typeof b.sessionCount === 'number' ? b.sessionCount : 0;
    liveAgentsByBridge[b.name] = count;
    if (b.status === 'healthy') liveAgentCount += count;
  }

  const claudeBridge = bridges.find((b) => b.name === 'claude-code');
  const desktopReachable = !!claudeBridge && claudeBridge.status !== 'offline';
  const paired = pairing.ok;
  const desktopBridge = {
    reachable: desktopReachable,
    paired,
    pairedJustNow: paired && !wasPairedBeforeRun,
    reason: !paired
      ? (pairing as { error?: string }).error || 'pairing failed'
      : undefined,
  };

  const healthyCount = bridges.filter((b) => b.status === 'healthy').length;
  const summary = healthyCount === bridges.length
    ? `All ${bridges.length} bridges healthy${liveAgentCount > 0 ? ` · ${liveAgentCount} live agent${liveAgentCount === 1 ? '' : 's'} discovered` : ''}.`
    : healthyCount > 0
      ? `${healthyCount} of ${bridges.length} bridges healthy. Restart the offline ones to pick up their agents.`
      : `No bridges reachable. Run \`${REOPEN_COMMAND}\` in Terminal to install + start them.`;

  return {
    bridges,
    liveAgentCount,
    liveAgentsByBridge,
    desktopBridge,
    summary,
  };
}

/** Convenience predicate the panel uses to swap between primary and
 *  secondary action affordances. */
export function isFullyConnected(result: ConnectAllBridgesResult | null): boolean {
  if (!result) return false;
  if (result.bridges.length === 0) return false;
  return result.bridges.every((b) => b.status === 'healthy');
}
