/**
 * integrationHealthRegistry — fail-visible, per-session health for connected
 * integrations (CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN Wave 2 · W4). Mirrors
 * providerHealthRegistry's in-memory, bounded, time-injectable design.
 *
 * ─── What this does ─────────────────────────────────────────────────
 * Records the outcome of each `custom_api.request` / `messaging.notify` call
 * (keyed by integration id, or `messaging:<provider>`), so a later
 * `integrations.list` can surface "⚠️ last call failed (HTTP 500), 2 in a row"
 * next to a connected-but-failing integration. That directly attacks the
 * Known Risk Area: a connected integration that is actually failing reads as
 * "works" until a task dies mid-run.
 *
 * ─── FAIL-VISIBLE, never silent ─────────────────────────────────────
 * This is an OBSERVABILITY signal only. It never suppresses, retries, or hides
 * an error, and it never removes an integration from any list. It only annotates
 * what already happened so the agent + user can SEE a flaky integration.
 *
 * ─── Purity / testability ───────────────────────────────────────────
 * No I/O, no react-native, no Date.now() in the hot logic — every function that
 * cares about time takes an explicit `nowMs` (smoke passes fixed clocks). The
 * `*Now` shims read the wall clock for production callers.
 */

/** Verdict buckets — aligned with integrationActionReceipt's outcome verdict. */
export type IntegrationHealthVerdict =
  | 'success'
  | 'client_error'
  | 'server_error'
  | 'blocked'
  | 'unknown';

/** Verdicts that count as a health failure (raise a hint). `unknown` is neutral
 *  — it neither raises an alarm nor clears one. `success` clears. */
const FAILURE_VERDICTS: ReadonlySet<IntegrationHealthVerdict> = new Set([
  'client_error',
  'server_error',
  'blocked',
]);

/** Beyond this age, a recorded outcome is too stale to surface as "current" health. */
export const HEALTH_STALENESS_MS = 15 * 60 * 1000; // 15 min

/** Hard memory bounds. */
export const MAX_INTEGRATIONS = 128;
export const MAX_EVENTS_PER_INTEGRATION = 8;

export interface IntegrationOutcome {
  verdict: IntegrationHealthVerdict;
  /** HTTP status when known. */
  status?: number | null;
}

interface HealthEvent {
  atMs: number;
  verdict: IntegrationHealthVerdict;
  status: number | null;
}

/** integration key → bounded ring of recent events (newest last). */
const registry = new Map<string, HealthEvent[]>();

function normalizeKey(key: string): string {
  return String(key || '').trim().slice(0, 200);
}

/**
 * Record one observed integration outcome. Call from the tool handler that
 * already sees the result. Pure w.r.t. time (caller injects `nowMs`).
 */
export function recordIntegrationOutcome(key: string, outcome: IntegrationOutcome, nowMs: number): void {
  const k = normalizeKey(key);
  if (!k || !outcome) return;

  let ring = registry.get(k);
  if (!ring) {
    if (registry.size >= MAX_INTEGRATIONS) evictStalest();
    ring = [];
    registry.set(k, ring);
  }
  ring.push({
    atMs: nowMs,
    verdict: outcome.verdict || 'unknown',
    status: typeof outcome.status === 'number' && Number.isFinite(outcome.status) ? outcome.status : null,
  });
  if (ring.length > MAX_EVENTS_PER_INTEGRATION) {
    ring.splice(0, ring.length - MAX_EVENTS_PER_INTEGRATION);
  }
}

/** Wall-clock shim for production callers. */
export function recordIntegrationOutcomeNow(key: string, outcome: IntegrationOutcome): void {
  recordIntegrationOutcome(key, outcome, Date.now());
}

function evictStalest(): void {
  let stalestKey: string | null = null;
  let stalestNewest = Infinity;
  for (const [k, ring] of registry) {
    const newest = ring.length ? ring[ring.length - 1].atMs : -Infinity;
    if (newest < stalestNewest) { stalestNewest = newest; stalestKey = k; }
  }
  if (stalestKey != null) registry.delete(stalestKey);
}

export interface IntegrationHealth {
  lastVerdict: IntegrationHealthVerdict;
  lastStatus: number | null;
  lastAtMs: number;
  /** Trailing count of failure-verdict events (stops at the first success). */
  consecutiveFailures: number;
  /** True when the most recent non-neutral outcome was a failure. */
  failing: boolean;
}

/**
 * Current health for one integration, or null when nothing is recorded. Does
 * NOT apply staleness — that's the describe layer's job (so callers can inspect
 * raw state). Never throws.
 */
export function getIntegrationHealth(key: string): IntegrationHealth | null {
  const ring = registry.get(normalizeKey(key));
  if (!ring || ring.length === 0) return null;
  const last = ring[ring.length - 1];

  // Trailing consecutive failures: walk newest→oldest, count failures until a
  // success clears the streak. `unknown` is neutral and doesn't break it.
  let consecutiveFailures = 0;
  let failing = false;
  let sawNonNeutral = false;
  for (let i = ring.length - 1; i >= 0; i -= 1) {
    const v = ring[i].verdict;
    if (v === 'success') break;
    if (FAILURE_VERDICTS.has(v)) {
      consecutiveFailures += 1;
      if (!sawNonNeutral) { failing = true; sawNonNeutral = true; }
    } else {
      // 'unknown' — neutral: if it's the most recent non-neutral, not failing.
      if (!sawNonNeutral) sawNonNeutral = true;
    }
  }
  return {
    lastVerdict: last.verdict,
    lastStatus: last.status,
    lastAtMs: last.atMs,
    consecutiveFailures,
    failing,
  };
}

/**
 * A bounded, chat-safe hint to surface next to an integration — or null when it
 * looks healthy, has no record, or the record is too stale to trust. Only ever
 * WARNS (fail-visible); a healthy integration gets no line (no noise).
 */
export function describeIntegrationHealth(health: IntegrationHealth | null, nowMs: number): string | null {
  if (!health) return null;
  if (!health.failing) return null;
  if (nowMs - health.lastAtMs > HEALTH_STALENESS_MS) return null; // stale — don't cry wolf
  const statusPart = health.lastStatus !== null ? ` (HTTP ${health.lastStatus})` : '';
  const streakPart = health.consecutiveFailures > 1 ? `, ${health.consecutiveFailures} in a row` : '';
  return `⚠️ last call failed${statusPart}${streakPart}`;
}

/** Convenience: record → nothing; read → the hint for a key, or null. */
export function getIntegrationHealthHint(key: string, nowMs: number): string | null {
  return describeIntegrationHealth(getIntegrationHealth(key), nowMs);
}

/** Wall-clock shim. */
export function getIntegrationHealthHintNow(key: string): string | null {
  return getIntegrationHealthHint(key, Date.now());
}

/** Test hook — wipe all recorded health. */
export function resetIntegrationHealth(): void {
  registry.clear();
}
