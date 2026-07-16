// connectionStatusCore — the PURE app-wide realtime-connection-health brain.
//
// The app opens ~76 Supabase Realtime `.subscribe()` channels across
// Chat/Office/Feed. Finding 1 of docs/CHAT_OFFICE_FEED_NEXT_GAPS.md extracts the
// per-channel reconnect machinery (the `resilientSubscriptionCore` / Finding 1
// layer) so every channel exposes a health snapshot. Finding 5 is the missing
// GLOBAL signal: there is no single "is my live data fresh?" indicator — the one
// connection-status UI (OfficeTab.tsx:5586-5588, driven by
// agentPresence.ts:47's `ConnectionStatus`) is scoped to Office circle-presence.
//
// This core rolls MANY per-subscription healths into ONE app-wide status and a
// WARN/DANGER-only banner model that a top-level provider can render across
// Chat/Office/Feed:
//   - `aggregateConnectionStatus(subs, opts?)` — all healthy → online; some
//     stale/reconnecting → degraded/reconnecting; all down → offline.
//   - `connectionBannerModel(status)`           — null when online; 'Reconnecting…'
//     (warn) / "You're offline — data may be stale" (danger) otherwise.
//
// It accepts the per-channel `ConnectionStatus` vocab (connecting | live |
// reconnecting | offline) AND raw Supabase channel statuses (SUBSCRIBED |
// CHANNEL_ERROR | TIMED_OUT | CLOSED), so it can consume Finding 1's snapshots or
// a raw `.subscribe((status) => …)` callback directly.
//
// PURITY: zero runtime imports, tsx-loadable (smoke: connection-status-core). No
// Date.now / Math.random — staleness is a caller-supplied *relative* `staleMs`,
// never an absolute clock read, so every result is deterministic. Bounded (scans
// at most MAX_CHANNELS, caps every list/string). TOTAL: every export guards
// null / undefined / wrong-type / huge / hostile (throwing getters) / cyclic
// input and degrades to a calm neutral (online / no banner) — it NEVER throws.

// ── Public types ──────────────────────────────────────────────────────────────

/** The one app-wide connection signal a global banner/strip renders from. */
export type AppConnectionStatus = 'online' | 'degraded' | 'offline' | 'reconnecting';

/** All app-wide statuses, in worsening order (handy for tests / ordering). */
export const APP_CONNECTION_STATUSES: readonly AppConnectionStatus[] = [
  'online',
  'reconnecting',
  'degraded',
  'offline',
] as const;

/**
 * One per-subscription health snapshot (the shape Finding 1's
 * `resilientSubscriptionCore` / a raw `.subscribe` callback produces). All fields
 * are read defensively — nothing here is trusted.
 */
export interface SubscriptionHealth {
  /** Human channel name, e.g. 'circle-runs', 'kanban-tasks'. */
  name?: unknown;
  /** Per-channel state: 'live'|'reconnecting'|'connecting'|'offline', or a raw
   *  Supabase status ('SUBSCRIBED'|'CHANNEL_ERROR'|'TIMED_OUT'|'CLOSED'). */
  state?: unknown;
  /** Milliseconds since this channel last received fresh data (relative, not a
   *  clock read). Only consulted when `degradedIfAnyStale` is on. */
  staleMs?: unknown;
}

export interface AggregateConnectionOptions {
  /**
   * When true, a live channel whose `staleMs` exceeds the stale threshold is
   * treated as a degraded contributor (the socket is up but the data is old).
   * Off by default: a `live` channel is healthy regardless of `staleMs`, since a
   * healthy socket normally repaints within seconds. Reconnecting/down channels
   * always degrade regardless of this flag.
   */
  degradedIfAnyStale?: boolean;
  /** Overrides DEFAULT_STALE_THRESHOLD_MS for the `degradedIfAnyStale` check. */
  staleThresholdMs?: number;
}

/** The rolled-up app-wide result. */
export interface AggregateConnectionResult {
  status: AppConnectionStatus;
  /** Names of every channel that is NOT healthy (reconnecting / stale / down),
   *  in input order, bounded to DEGRADED_LIST_CAP. Always empty when online. */
  degradedChannels: string[];
  /** Short, bounded human summary of the roll-up. */
  summary: string;
}

/** The WARN/DANGER banner a global strip renders; null means "show nothing". */
export interface ConnectionBannerModel {
  show: boolean;
  tone: 'warn' | 'danger';
  text: string;
}

// ── Tunables (all bounded, no clock) ────────────────────────────────────────────

/** A live channel older than this counts as stale (only with degradedIfAnyStale). */
export const DEFAULT_STALE_THRESHOLD_MS = 60_000;
/** Hard cap on channels scanned per call — protects against a hostile huge array. */
export const MAX_CHANNELS = 1000;
/** Cap on the returned degradedChannels list. */
export const DEGRADED_LIST_CAP = 50;
/** How many names to inline into the summary before "+N more". */
const SUMMARY_NAME_PREVIEW = 5;
/** Cap on any single channel name we keep. */
const MAX_NAME_LEN = 80;
/** Cap on the summary string. */
const MAX_SUMMARY_LEN = 240;

/** Exact banner copy (matches OfficeTab.tsx:5586-5588 + the doc's Finding 5 text). */
export const RECONNECTING_BANNER_TEXT = 'Reconnecting…';
export const DEGRADED_BANNER_TEXT = 'Some live data may be stale';
export const OFFLINE_BANNER_TEXT = "You're offline — data may be stale";

// ── One normalized channel health ───────────────────────────────────────────────

type ChannelHealth = 'healthy' | 'reconnecting' | 'stale' | 'down';
type BaseState = 'healthy' | 'reconnecting' | 'down' | 'unknown';

// State-string synonym tables (lower-cased). Covers the app's per-channel
// `ConnectionStatus` vocab AND raw Supabase `RealtimeChannel` statuses so this
// core can consume either without a translation layer.
const HEALTHY_STATES: Record<string, true> = {
  live: true, online: true, connected: true, subscribed: true, healthy: true,
  ok: true, ready: true, open: true, joined: true, active: true,
};
const RECONNECTING_STATES: Record<string, true> = {
  reconnecting: true, connecting: true, pending: true, joining: true,
  retrying: true, recovering: true, resubscribing: true,
};
const DOWN_STATES: Record<string, true> = {
  offline: true, closed: true, error: true, errored: true, failed: true,
  down: true, disconnected: true, timed_out: true, timedout: true,
  channel_error: true, channelerror: true, dead: true,
};

/** Map any state value to a coarse base bucket. Unknown/garbage → 'unknown'. */
function normalizeState(raw: unknown): BaseState {
  if (typeof raw !== 'string') return 'unknown';
  const t = raw.trim().toLowerCase();
  if (!t) return 'unknown';
  if (HEALTHY_STATES[t]) return 'healthy';
  if (RECONNECTING_STATES[t]) return 'reconnecting';
  if (DOWN_STATES[t]) return 'down';
  return 'unknown';
}

/** Coerce anything to a finite, non-negative number (else 0). */
function finiteNonNeg(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Normalize one entry to a single ChannelHealth. Wrapped so a hostile object
 * (throwing `.state`/`.staleMs` getter) degrades to the neutral 'healthy' —
 * garbage must never be able to flip the app into a false alarm.
 *   down / reconnecting states  → that bucket (always, flag-independent).
 *   healthy or unknown state    → 'stale' iff degradedIfAnyStale && staleMs>thr,
 *                                 else 'healthy'.
 */
function normalizeChannelHealth(
  entry: unknown,
  degradedIfAnyStale: boolean,
  thresholdMs: number,
): ChannelHealth {
  try {
    const e = entry as { state?: unknown; staleMs?: unknown };
    const base = normalizeState(e?.state);
    if (base === 'down') return 'down';
    if (base === 'reconnecting') return 'reconnecting';
    // base is 'healthy' or 'unknown' → both count as a live socket.
    if (degradedIfAnyStale && finiteNonNeg(e?.staleMs) > thresholdMs) return 'stale';
    return 'healthy';
  } catch {
    return 'healthy';
  }
}

/** Safely read/clip a channel name (never throws; falls back to channel-<i>). */
function readName(entry: unknown, index: number): string {
  const fallback = `channel-${index}`;
  try {
    const v = (entry as { name?: unknown })?.name;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t.length > MAX_NAME_LEN ? t.slice(0, MAX_NAME_LEN) : t;
    }
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return fallback;
  } catch {
    return fallback;
  }
}

/** Clip a string to a bounded length with an ellipsis. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/** Inline up to SUMMARY_NAME_PREVIEW degraded names, then "+N more". */
function previewNames(names: string[], troubleCount: number): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, SUMMARY_NAME_PREVIEW);
  let s = shown.join(', ');
  const remaining = troubleCount - shown.length;
  if (remaining > 0) s += ` +${remaining} more`;
  return s;
}

// ── The aggregator ──────────────────────────────────────────────────────────────

/**
 * Roll many per-subscription healths into ONE app-wide connection status.
 *
 * Priority (deterministic, order matters):
 *   1. no valid channels          → 'online'  (nothing can be stale)
 *   2. every channel down         → 'offline'
 *   3. every channel healthy      → 'online'
 *   4. nothing healthy + any reconnecting → 'reconnecting' (mid-recovery, hopeful)
 *   5. otherwise                  → 'degraded' (partial: some healthy, some not)
 *
 * `degradedChannels` lists every non-healthy channel name (input order, capped).
 * Never throws: non-object entries are skipped, hostile getters are trapped, and
 * a huge array is scanned only up to MAX_CHANNELS.
 */
export function aggregateConnectionStatus(
  subscriptions: unknown,
  opts?: AggregateConnectionOptions,
): AggregateConnectionResult {
  // Defensive option read (opts may be anything, including a throwing getter).
  let degradedIfAnyStale = false;
  let thresholdMs = DEFAULT_STALE_THRESHOLD_MS;
  try {
    if (opts && typeof opts === 'object') {
      degradedIfAnyStale = (opts as AggregateConnectionOptions).degradedIfAnyStale === true;
      const th = (opts as AggregateConnectionOptions).staleThresholdMs;
      if (typeof th === 'number' && Number.isFinite(th) && th >= 0) thresholdMs = th;
    }
  } catch {
    degradedIfAnyStale = false;
    thresholdMs = DEFAULT_STALE_THRESHOLD_MS;
  }

  const arr = Array.isArray(subscriptions) ? subscriptions : [];
  const limit = Math.min(arr.length, MAX_CHANNELS);

  let healthy = 0;
  let reconnecting = 0;
  let stale = 0;
  let down = 0;
  let total = 0;
  const degradedChannels: string[] = [];

  for (let i = 0; i < limit; i++) {
    const entry = arr[i];
    // Skip scalar/garbage entries — they must not drive the app-wide signal.
    if (entry === null || typeof entry !== 'object') continue;
    total += 1;
    const health = normalizeChannelHealth(entry, degradedIfAnyStale, thresholdMs);
    if (health === 'healthy') continue;
    if (health === 'reconnecting') reconnecting += 1;
    else if (health === 'stale') stale += 1;
    else down += 1;
    if (degradedChannels.length < DEGRADED_LIST_CAP) {
      degradedChannels.push(readName(entry, i));
    }
  }
  healthy = total - reconnecting - stale - down;

  let status: AppConnectionStatus;
  if (total === 0) status = 'online';
  else if (down === total) status = 'offline';
  else if (healthy === total) status = 'online';
  else if (healthy === 0 && reconnecting > 0) status = 'reconnecting';
  else status = 'degraded';

  const plural = total === 1 ? '' : 's';
  const trouble = total - healthy;
  let summary: string;
  if (total === 0) {
    summary = 'No live connections';
  } else if (status === 'online') {
    summary = `All ${total} live connection${plural} healthy`;
  } else if (status === 'offline') {
    summary = `All ${total} live connection${plural} offline — data may be stale`;
  } else if (status === 'reconnecting') {
    summary = `Reconnecting ${trouble} of ${total} live connection${plural}…`;
  } else {
    const names = previewNames(degradedChannels, trouble);
    summary = `${trouble} of ${total} live connection${plural} degraded${names ? `: ${names}` : ''}`;
  }

  return { status, degradedChannels, summary: clip(summary, MAX_SUMMARY_LEN) };
}

// ── Status coercion / banner ────────────────────────────────────────────────────

/** Type guard for a canonical AppConnectionStatus. */
export function isAppConnectionStatus(v: unknown): v is AppConnectionStatus {
  return v === 'online' || v === 'degraded' || v === 'offline' || v === 'reconnecting';
}

/**
 * Coerce loose input to an AppConnectionStatus. Accepts a status string
 * (case/space-insensitive) OR an object carrying a `.status` (e.g. an
 * AggregateConnectionResult). Unrecognized / hostile input → null, which every
 * consumer treats as "online / no alarm".
 */
function coerceStatus(input: unknown): AppConnectionStatus | null {
  try {
    let raw: unknown = input;
    if (input && typeof input === 'object') raw = (input as { status?: unknown }).status;
    if (typeof raw !== 'string') return null;
    const t = raw.trim().toLowerCase();
    return isAppConnectionStatus(t) ? (t as AppConnectionStatus) : null;
  } catch {
    return null;
  }
}

/**
 * The WARN/DANGER-only banner model for a global strip. Returns null when online
 * (or when the status is unrecognized — an unknown status never alarms). Accepts
 * a status string or an AggregateConnectionResult-shaped object. Total.
 *
 *   reconnecting → warn   'Reconnecting…'
 *   degraded     → warn   'Some live data may be stale'
 *   offline      → danger "You're offline — data may be stale"
 *   online/other → null
 */
export function connectionBannerModel(status: unknown): ConnectionBannerModel | null {
  switch (coerceStatus(status)) {
    case 'offline':
      return { show: true, tone: 'danger', text: OFFLINE_BANNER_TEXT };
    case 'reconnecting':
      return { show: true, tone: 'warn', text: RECONNECTING_BANNER_TEXT };
    case 'degraded':
      return { show: true, tone: 'warn', text: DEGRADED_BANNER_TEXT };
    default:
      return null;
  }
}

/**
 * Short label for a compact header/strip indicator (the "live / reconnecting /
 * stale" chip Finding 5 wants in the Chat & Feed headers). Unrecognized input →
 * 'Live', consistent with connectionBannerModel treating unknown as no-alarm.
 */
export function connectionStatusLabel(status: unknown): string {
  switch (coerceStatus(status)) {
    case 'offline':
      return 'Offline';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'degraded':
      return 'Degraded';
    default:
      return 'Live';
  }
}
