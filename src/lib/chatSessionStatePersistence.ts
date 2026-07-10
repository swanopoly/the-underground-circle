/**
 * chatSessionStatePersistence — pure, dependency-light helpers for the
 * localStorage-mirror of two session-only chat state stores in ChatTab:
 *
 *   1. the chat failure-recovery ledger (duplicate-handoff suppression), and
 *   2. the last computer-app route resolution ("use X instead" diffing).
 *
 * ChatTab itself is not tsx-smoke-loadable (pulls in react-native), so the
 * bounding + (de)serialization logic lives here where a tsx smoke can import
 * it directly. Keep this module `import type` only — no runtime imports of
 * heavy modules — so it stays loadable under tsx/esbuild.
 *
 * The wiring in ChatTab is a thin wrapper: it owns the localStorage key,
 * the try/catch (native has no `localStorage`), and the ref/Map plumbing;
 * this module owns the "what survives and in what shape" decisions.
 */

import type { ChatComputerAppResolution } from './chatComputerRequestRouter';

/**
 * One ledger entry as persisted. Mirrors ChatFailureRecoveryLedgerEntry in
 * ChatTab (kept structurally in sync — five small numeric-ish fields). Declared
 * here so the pure bound/serialize helpers can be typed without importing the
 * component module.
 */
export type PersistedChatFailureLedgerEntry = {
  firstAt: number;
  lastAt: number;
  count: number;
  suppressedCount: number;
  lastSuccessfulHandoffAt: number | null;
};

/** A [fingerprint, entry] pair — the shape a Map yields via `entries()`. */
export type ChatFailureLedgerPair = [string, PersistedChatFailureLedgerEntry];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isValidLedgerEntry(value: unknown): value is PersistedChatFailureLedgerEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    isFiniteNumber(entry.firstAt) &&
    isFiniteNumber(entry.lastAt) &&
    isFiniteNumber(entry.count) &&
    isFiniteNumber(entry.suppressedCount) &&
    (entry.lastSuccessfulHandoffAt === null || isFiniteNumber(entry.lastSuccessfulHandoffAt))
  );
}

/** Normalize a raw entry down to exactly the persisted fields (drop extras). */
function normalizeLedgerEntry(entry: PersistedChatFailureLedgerEntry): PersistedChatFailureLedgerEntry {
  return {
    firstAt: entry.firstAt,
    lastAt: entry.lastAt,
    count: entry.count,
    suppressedCount: entry.suppressedCount,
    lastSuccessfulHandoffAt: entry.lastSuccessfulHandoffAt,
  };
}

/**
 * Bound the ledger the same way ChatTab does at runtime, so write and read
 * apply identical retention: drop entries whose `lastAt` is older than
 * `retentionMs`, then keep at most `max` entries, preferring the most recent
 * by `lastAt`. Invalid entries are dropped. Order of the returned pairs is
 * newest-`lastAt`-last (ascending), matching the Map insertion the resume
 * path expects, and stable for equal `lastAt` values.
 */
export function boundChatFailureLedgerEntries(
  pairs: Iterable<ChatFailureLedgerPair>,
  nowMs: number,
  retentionMs: number,
  max: number,
): ChatFailureLedgerPair[] {
  const fresh: ChatFailureLedgerPair[] = [];
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [key, entry] = pair;
    if (typeof key !== 'string' || !key) continue;
    if (!isValidLedgerEntry(entry)) continue;
    if (nowMs - entry.lastAt > retentionMs) continue;
    fresh.push([key, normalizeLedgerEntry(entry)]);
  }
  if (max >= 0 && fresh.length > max) {
    // Keep the `max` most-recent by lastAt. Sort a copy descending by lastAt,
    // take the top `max`, then restore ascending order for stable output.
    const kept = [...fresh]
      .sort((a, b) => b[1].lastAt - a[1].lastAt)
      .slice(0, max);
    const keptKeys = new Set(kept.map(([key]) => key));
    return fresh.filter(([key]) => keptKeys.has(key));
  }
  return fresh;
}

/**
 * Serialize a bounded ledger to a JSON string ready for localStorage, or
 * `null` when there is nothing worth writing (so the caller can `removeItem`).
 * Applies the same bounding as read so the stored snapshot never grows beyond
 * the retention window / cap.
 */
export function serializeChatFailureLedger(
  pairs: Iterable<ChatFailureLedgerPair>,
  nowMs: number,
  retentionMs: number,
  max: number,
): string | null {
  const bounded = boundChatFailureLedgerEntries(pairs, nowMs, retentionMs, max);
  if (bounded.length === 0) return null;
  return JSON.stringify(Object.fromEntries(bounded));
}

/**
 * Parse a persisted ledger snapshot back into bounded [key, entry] pairs.
 * Malformed / non-object / non-string JSON returns `[]` (never throws), and
 * the same retention + cap is re-applied so entries that went stale while the
 * tab was closed are dropped on hydrate.
 */
export function deserializeChatFailureLedger(
  raw: string | null | undefined,
  nowMs: number,
  retentionMs: number,
  max: number,
): ChatFailureLedgerPair[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
  const pairs: ChatFailureLedgerPair[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key !== 'string' || !key) continue;
    if (!isValidLedgerEntry(value)) continue;
    pairs.push([key, normalizeLedgerEntry(value)]);
  }
  return boundChatFailureLedgerEntries(pairs, nowMs, retentionMs, max);
}

// ── Last computer-app route resolution ────────────────────────────────────

/**
 * Guard against a persisted resolution string that is corrupt or has grown
 * unexpectedly large (a bounded, JSON-safe object should be tiny — a handful
 * of short strings and ≤3-entry arrays). 8 KB is comfortably above a normal
 * resolution yet rejects a payload that got polluted upstream.
 */
export const LAST_APP_RESOLUTION_MAX_SERIALIZED_BYTES = 8 * 1024;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Structural validation of a decoded resolution. We do not re-derive the full
 * union types (that would drag in heavy modules); we confirm the load-bearing
 * shape the follow-up "use X instead" diff relies on: a `category` string, a
 * `best` option with an `appId`, and a string-array `alternativesSummary`.
 */
function isValidResolutionShape(value: unknown): value is ChatComputerAppResolution {
  if (!value || typeof value !== 'object') return false;
  const resolution = value as Record<string, unknown>;
  if (!isNonEmptyString(resolution.category)) return false;
  const best = resolution.best as Record<string, unknown> | undefined;
  if (!best || typeof best !== 'object' || !isNonEmptyString(best.appId)) return false;
  if (!Array.isArray(resolution.alternativesSummary)) return false;
  if (typeof resolution.explicitAppNamed !== 'boolean') return false;
  return true;
}

/**
 * Serialize the single most-recent resolution for localStorage. Returns
 * `null` for a null/oversized/unserializable value so the caller can
 * `removeItem` and never persist junk.
 */
export function serializeLastAppResolution(
  resolution: ChatComputerAppResolution | null | undefined,
): string | null {
  if (!resolution) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(resolution);
  } catch {
    return null;
  }
  if (!serialized || serialized.length > LAST_APP_RESOLUTION_MAX_SERIALIZED_BYTES) return null;
  return serialized;
}

/**
 * Parse a persisted resolution back into an object, or `null` when the stored
 * value is absent, corrupt, oversized, or structurally invalid. Never throws —
 * a bad pointer just means the next "use X instead" has no route to diff, which
 * is the same as a fresh session.
 */
export function deserializeLastAppResolution(
  raw: string | null | undefined,
): ChatComputerAppResolution | null {
  if (!raw || raw.length > LAST_APP_RESOLUTION_MAX_SERIALIZED_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidResolutionShape(parsed)) return null;
  return parsed;
}
