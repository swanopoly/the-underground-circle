/**
 * circleBudgetSnapshot — the ONE cached read of a circle's Claude spend cap and
 * its recent (24h) spend, feeding the Auto-model budget downshift guard.
 *
 * WHY: `budgetModelDownshiftCore` is a PURE classifier + substitution table; it
 * needs two live numbers (cap + spend) to decide whether an 'auto'/'blackswan'
 * pick should drop to a cheaper tier. This runtime adapter is the only place
 * that reads those numbers, behind a ~60s TTL so a burst of chat turns costs at
 * most one usage RPC per circle.
 *
 * FAIL-OPEN: any read error — or a missing circle — resolves to `null`. The
 * caller then leaves the turn un-downshifted. We NEVER fabricate a cap or an
 * alarm from a failed read.
 *
 * CAP SEMANTICS: `capUsd` is ONLY the EXPLICIT, positive
 * `circles.settings.claude_total_max_cost_usd`. We deliberately DO NOT apply the
 * $10 UI default here — an unconfigured circle must not silently downshift.
 * (The OpenSwan Control Panel applies the $10 default for DISPLAY only; the
 * guard must not.) When no explicit positive cap is set, `capUsd` is `null` and
 * the classifier treats the guard as OFF.
 *
 * SPEND SEMANTICS: `spentUsd` is the 24h Claude spend
 * (`getClaudeUsageSummary(circleId, 1).total_cost`) — the window the cap
 * documents ("24h Claude cap"). It is only read when a cap actually exists, so
 * the common no-cap circle never pays for the usage RPC.
 *
 * SECRET-SAFE: the snapshot holds two numbers and nothing else.
 */

import { supabase } from './supabase';
import { getClaudeUsageSummary } from './claudeUsage';

export interface CircleBudgetSnapshot {
  /** 24h Claude spend in USD (>= 0). 0 when no cap exists (spend not read). */
  spentUsd: number;
  /** Explicit positive per-circle cap in USD, or null when unset (guard OFF). */
  capUsd: number | null;
}

/** ~60s TTL so a burst of turns collapses to at most one usage RPC per circle. */
const TTL_MS = 60_000;

interface CacheEntry {
  at: number;
  value: CircleBudgetSnapshot;
}

const snapshotCache = new Map<string, CacheEntry>();

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Read a circle's { spentUsd, capUsd } behind a ~60s TTL. Returns `null` on any
 * failure or when `circleId` is missing — the caller fails open (no downshift).
 * The usage RPC is skipped entirely when the circle has no explicit cap.
 */
export async function getCircleBudgetSnapshot(
  circleId: string | null | undefined,
): Promise<CircleBudgetSnapshot | null> {
  if (!circleId) return null;
  try {
    const cached = snapshotCache.get(circleId);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

    // Explicit positive cap ONLY — never the $10 UI default. Same select shape
    // the OpenSwan Control Panel budget probe uses.
    const { data: circleRow } = await supabase
      .from('circles')
      .select('settings')
      .eq('id', circleId)
      .single();
    const capUsd = positiveNumberOrNull((circleRow?.settings as any)?.claude_total_max_cost_usd);

    // No cap → the guard is OFF; don't pay for the usage RPC.
    let spentUsd = 0;
    if (capUsd !== null) {
      const summary = await getClaudeUsageSummary(circleId, 1); // 1 day = 24h window
      const spent = summary.total_cost;
      spentUsd = typeof spent === 'number' && Number.isFinite(spent) && spent > 0 ? spent : 0;
    }

    const value: CircleBudgetSnapshot = { spentUsd, capUsd };
    snapshotCache.set(circleId, { at: Date.now(), value });
    return value;
  } catch {
    return null; // fail-open — a budget read must never block or alter a turn
  }
}

/** Test-only: clear the TTL cache so a test can force a fresh read. */
export function __clearCircleBudgetSnapshotCache(): void {
  snapshotCache.clear();
}
