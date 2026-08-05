/**
 * officeBridgeReadinessProbe — the LIVE composition over the pure snapshot
 * builder in `officeBridgeReadiness.ts`: environment gate → probe the local
 * bridges (openswan-proxy core + claude-code/codex/gemini-cli/cursor
 * execution) → classified snapshot.
 *
 * Single owner for this composition (O5, P39): both the Office Whiteboard's
 * bridge card and the main-view readiness strip (OfficeTab) call this, so the
 * two surfaces can never drift. Mirrors the appReachabilityProbe pattern.
 *
 * Impure by design (local bridge fetches); all impure deps are lazy-imported
 * so pure modules and smokes never pull them in accidentally. Never throws —
 * failures land in the snapshot as fail-visible states.
 */

import type { OfficeBridgeReadinessSnapshot } from './officeBridgeReadiness';

export async function runOfficeBridgeReadinessProbe(opts?: {
  timeoutMs?: number;
}): Promise<OfficeBridgeReadinessSnapshot> {
  const { buildOfficeBridgeReadinessSnapshot } = await import('./officeBridgeReadiness');
  try {
    const { getBridgeEnvironment, getBridgeUrl } = await import('./bridgeEnvironment');
    const env = getBridgeEnvironment();
    if (!env.available) {
      return buildOfficeBridgeReadinessSnapshot([], {
        available: false,
        unavailableReason: env.reason,
      });
    }
    const { probeBridges } = await import('./bridgeHealthDiag');
    const results = await probeBridges({
      timeoutMs: opts?.timeoutMs ?? 1500,
      urlForPort: (port) => getBridgeUrl(port),
    });
    return buildOfficeBridgeReadinessSnapshot(results, { available: true });
  } catch (error: any) {
    return buildOfficeBridgeReadinessSnapshot([], {
      available: true,
      error: error?.message || 'Bridge health audit failed.',
    });
  }
}
