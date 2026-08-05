/**
 * proactiveSurfacingRuntime — the IMPURE loader behind the per-turn
 * "## Proactive Heads-Up" prompt section. The decision brain is the pure
 * `proactiveSurfacingCore` (smoke: proactive-surfacing-core); the source
 * adapters + renderer are the pure `proactiveSurfacingSignals` (smoke:
 * proactive-surfacing-signals). This module owns only the I/O:
 *
 *   - pulls the TTL-cached circle context snapshot (warm on any moderate+
 *     turn, since the circle_snapshot section already builds it);
 *   - merges snapshot-derived signals with the caller's live attention
 *     signals (blocked approvals from ChatTab's "Needs you" strip);
 *   - runs `selectProactiveSurfacings` against the per-circle anti-nag state
 *     (turn counter + SurfacingMemory) and renders the section, but does NOT
 *     persist here — it returns `{ section, commit }` and the caller runs
 *     `commit()` ONLY once the section actually reached the model (see the
 *     commit-on-delivery note below);
 *   - renders `## Proactive Heads-Up` + fenced body, or null when silent.
 *
 * Anti-nag state lives in a module Map mirrored to localStorage
 * (`uc_proactive_surfacing:v1:<circleId>`, contextDepthPolicy storage
 * pattern: try/catch, fail-soft to in-memory on native/node) so cooldown /
 * decay / retirement survive a web reload. The payload is bounded by the
 * core's own caps (MAX_MEMORY_KEYS) and contains only sanitized keys +
 * counters — never titles or secrets.
 *
 * Commit-on-delivery (stateful-timeout-race fix): the caller wraps this builder
 * in a 3s `withTimeout` — a `Promise.race` that resolves `null` on overrun but
 * does NOT cancel the builder. A cold build that finishes AFTER that race is
 * discarded by the caller, so persisting the turn++/shownCount++ inside the
 * builder would mute a heads-up that never reached the prompt for the whole
 * cooldown window. The builder is therefore COMPUTE-ONLY and hands back a
 * `commit()` the caller runs iff it used the result (surfaced OR silent-but-
 * delivered) — never on the timeout/discard.
 *
 * A 30s memo keyed (circleId + message + a hash of the merged signal KEYS)
 * returns the cached section WITHOUT re-running the decision, so the stream →
 * tool-loop escalation path (which rebuilds the prompt for the SAME turn) hits
 * an identical key and its no-op commit cannot double-bump shownCount. Folding
 * the signal-key hash into the key means a genuinely-new turn whose live
 * signals changed (e.g. the failed run was re-run and now passes) re-evaluates
 * instead of replaying a stale/resolved alert. Signal keys are structured ids
 * (never the untrusted title) and are hashed into the internal Map key only.
 */

import type { SurfacingSignal } from './proactiveSurfacingCore';

// ─── Per-circle anti-nag state (module Map + localStorage mirror) ───────────

export const PROACTIVE_SURFACING_STORAGE_PREFIX = 'uc_proactive_surfacing:v1:';

/** `memory` stays `unknown` here — `selectProactiveSurfacings` normalizes it. */
type CircleSurfacingState = { turn: number; memory: unknown };

const stateByCircle = new Map<string, CircleSurfacingState>();

const MAX_TURN = 1_000_000_000;

function normalizeTurn(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
  if (n < 0) return 0;
  if (n > MAX_TURN) return MAX_TURN;
  return n;
}

function loadState(circleId: string): CircleSurfacingState {
  const inMemory = stateByCircle.get(circleId);
  if (inMemory) return inMemory;
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const raw = store?.getItem?.(`${PROACTIVE_SURFACING_STORAGE_PREFIX}${circleId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { turn?: unknown; memory?: unknown };
      const state: CircleSurfacingState = {
        turn: normalizeTurn(parsed?.turn),
        memory: parsed?.memory ?? null,
      };
      stateByCircle.set(circleId, state);
      return state;
    }
  } catch { /* storage unavailable / corrupt → fresh state */ }
  const fresh: CircleSurfacingState = { turn: 0, memory: null };
  stateByCircle.set(circleId, fresh);
  return fresh;
}

function saveState(circleId: string, state: CircleSurfacingState): void {
  stateByCircle.set(circleId, state);
  try {
    const store = (globalThis as { localStorage?: { setItem?: (k: string, v: string) => void } }).localStorage;
    if (!store?.setItem) return;
    store.setItem(
      `${PROACTIVE_SURFACING_STORAGE_PREFIX}${circleId}`,
      JSON.stringify({ turn: state.turn, memory: state.memory }),
    );
  } catch { /* fail-soft: in-memory state still advanced */ }
}

// ─── Same-turn memo (stream → tool-loop rebuilds must not burn showings) ────

export const PROACTIVE_SURFACING_MEMO_TTL_MS = 30_000;
const MEMO_MAX_ENTRIES = 8;

const memo = new Map<string, { section: string | null; atMs: number }>();

function memoGet(key: string, nowMs: number): string | null | undefined {
  const hit = memo.get(key);
  if (!hit) return undefined;
  if (nowMs - hit.atMs > PROACTIVE_SURFACING_MEMO_TTL_MS) {
    memo.delete(key);
    return undefined;
  }
  return hit.section;
}

function memoSet(key: string, section: string | null, nowMs: number): void {
  memo.set(key, { section, atMs: nowMs });
  if (memo.size > MEMO_MAX_ENTRIES) {
    // Drop the oldest entries (insertion order ≈ recency here).
    for (const k of memo.keys()) {
      if (memo.size <= MEMO_MAX_ENTRIES) break;
      memo.delete(k);
    }
  }
}

/** Test/dev hook: drop all in-memory surfacing state + memo (storage kept). */
export function clearProactiveSurfacingRuntimeState(): void {
  stateByCircle.clear();
  memo.clear();
}

// ─── Section builder ────────────────────────────────────────────────────────

export const PROACTIVE_SURFACING_HEADING = '## Proactive Heads-Up';

/** Structured result of a section build — see the commit-on-delivery note. */
export interface ProactiveSurfacingBuildResult {
  /** The rendered `## Proactive Heads-Up` section, or null when silent. */
  section: string | null;
  /**
   * Persist the advanced anti-nag state (turn++ + surfaced-signal showings) and
   * seed the same-turn memo. The CALLER invokes this ONLY after the section has
   * actually reached the model, so a build the caller's 3s `withTimeout`
   * discarded never advances the counter or burns a showing. A memo-hit result
   * returns a no-op commit (the turn's first pass already persisted).
   */
  commit: () => void;
}

const NOOP_COMMIT = (): void => {};

/**
 * Stable, bounded, secret-safe fingerprint of the merged signal SET, folded
 * into the same-turn memo key as a freshness discriminator. Keys off each
 * signal's STRUCTURED id (its anti-nag key / entityId / kind — never the raw
 * untrusted title) and is order-independent, so the two prompt builds of ONE
 * turn hash identically (→ memo hit, no double-count) while a genuinely-new
 * turn whose live signals changed hashes differently (→ re-evaluate, no stale
 * replay). The underlying ids are HASHED into the internal Map key, never
 * echoed into the prompt.
 */
function hashSignalKeys(signals: SurfacingSignal[]): string {
  if (!Array.isArray(signals) || signals.length === 0) return '0';
  const tokens: string[] = [];
  for (const sig of signals) {
    if (!sig || typeof sig !== 'object') continue;
    const kind = typeof sig.kind === 'string' ? sig.kind : '?';
    const idSource = sig.key || sig.entityId || sig.title || '';
    const id = typeof idSource === 'string' ? idSource : '';
    tokens.push(`${kind}:${id}`.slice(0, 160));
    if (tokens.length >= 256) break;
  }
  tokens.sort();
  const joined = tokens.join('|');
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV-1a prime
  }
  return (h >>> 0).toString(16);
}

/**
 * Build the per-turn Proactive Heads-Up section for a circle. Returns a
 * `{ section, commit }` result (section null when the anti-nag core stays
 * silent), or null on an empty circle / any loader-storage error — a heads-up
 * must never break a turn. COMPUTE-ONLY: the state-advancing side effect lives
 * in `commit()`, which the caller runs only when the section reached the model.
 */
export async function buildProactiveSurfacingSection(args: {
  circleId?: string | null;
  message?: string | null;
  attentionSignals?: SurfacingSignal[] | null;
}): Promise<ProactiveSurfacingBuildResult | null> {
  try {
    const circleId = String(args.circleId || '').trim();
    if (!circleId) return null;
    const nowMs = Date.now();
    const message = typeof args.message === 'string' ? args.message : '';

    // Snapshot is TTL-cached (60s) and already warm on moderate+ turns — the
    // circle_snapshot section task builds it in the same context wave. Fetched
    // BEFORE the memo check so the memo key can carry the live signal-set hash.
    const { getCircleContextSnapshot } = await import('./circleContextSnapshot');
    const snapshot = await getCircleContextSnapshot(circleId).catch(() => null);

    const { deriveSnapshotSurfacingSignals, renderProactiveSurfacingBody } = await import('./proactiveSurfacingSignals');
    const { selectProactiveSurfacings } = await import('./proactiveSurfacingCore');

    const signals: SurfacingSignal[] = [
      ...deriveSnapshotSurfacingSignals(snapshot, nowMs),
      ...(Array.isArray(args.attentionSignals) ? args.attentionSignals : []),
    ];

    // Same-turn memo keyed (circle + message + signal-set hash). A hit is the
    // stream → tool-loop rebuild of the SAME turn: replay the cached section
    // with a no-op commit (the first pass already advanced state + seeded it),
    // so the escalation pass never double-bumps a showing.
    const memoKey = `${circleId}\u0000${message}\u0000${hashSignalKeys(signals)}`;
    const memoized = memoGet(memoKey, nowMs);
    if (memoized !== undefined) return { section: memoized, commit: NOOP_COMMIT };

    const state = loadState(circleId);
    const decision = selectProactiveSurfacings(
      signals,
      { turnIndex: state.turn, nowMs, message },
      state.memory,
    );

    const body = renderProactiveSurfacingBody(decision);
    const section = body ? `${PROACTIVE_SURFACING_HEADING}\n${body}` : null;

    // COMPUTE-ONLY: defer the state advance to commit(). The turn counter always
    // moves on a DELIVERED turn (cooldown counts turns) and nextMemory carries
    // the shownCount bumps / retirement for whatever surfaced, but only once the
    // caller confirms the section survived its 3s withTimeout race.
    const commit = (): void => {
      try {
        saveState(circleId, { turn: normalizeTurn(state.turn + 1), memory: decision.nextMemory });
        memoSet(memoKey, section, nowMs);
      } catch { /* fail-soft: a heads-up must never break a turn */ }
    };
    return { section, commit };
  } catch {
    return null;
  }
}
