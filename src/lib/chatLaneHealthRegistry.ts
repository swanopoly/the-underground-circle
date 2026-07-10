/**
 * chatLaneHealthRegistry — X7 (P48): the per-lane quality signal.
 *
 * The postmortem lesson this implements (Anthropic 2025-09-17: three infra
 * bugs read as weeks of vague global degradation because no per-path signal
 * existed; GPT-5 router outage 2025-08: one silently-failing lane read as
 * "the model got dumber"): record every chat lane TERMINAL — successes and
 * failures — so one degraded lane is legible as THAT lane degrading, and a
 * multi-lane pattern is legible as global. Consumes the P39/P42/P45
 * `chatLaneOutcome` envelopes.
 *
 * Mirrors providerHealthRegistry / integrationHealthRegistry: in-memory,
 * per-session, bounded, time-injectable (`nowMs` everywhere; `*Now` shims
 * for production callers). OBSERVABILITY ONLY — never suppresses, retries,
 * reroutes, or hides an error (fail-visible invariant).
 *
 * Pure by construction: `import type` only, tsx-loadable, bounded, never
 * throws.
 */

import type { ChatLaneId, ChatLaneStatus, ChatLaneOutcome } from './chatLaneOutcome';

// ─── Bounds / windows ───────────────────────────────────────────────────────

export const MAX_LANES = 16;
export const MAX_EVENTS_PER_LANE = 50;
/** Beyond this age, recorded outcomes are too stale to alarm on. Applied
 *  PER EVENT: stale events are excluded from the streak/rate floors (so old
 *  failures can never resurrect an alarm once a fresh event lands), and a
 *  lane whose newest event is stale never alarms at all. */
export const LANE_HEALTH_STALENESS_MS = 30 * 60 * 1000; // 30 min

/** Degradation thresholds: a lane is degraded when its trailing failure
 *  streak reaches the streak floor, OR its recent window has enough volume
 *  and a failure share at/over the rate floor. */
export const DEGRADED_STREAK_FLOOR = 3;
export const DEGRADED_MIN_WINDOW = 4;
export const DEGRADED_FAILURE_RATE_FLOOR = 0.5;

/** Statuses that count against a lane. `interrupted` is a real terminal the
 *  user experienced (partial answer) — it counts. Deferred/blocked/skipped/
 *  needs_input are policy outcomes, not lane failures — neutral. */
const FAILURE_STATUSES: ReadonlySet<ChatLaneStatus> = new Set(['failed', 'interrupted']);
const NEUTRAL_STATUSES: ReadonlySet<ChatLaneStatus> = new Set([
  'deferred', 'blocked', 'skipped', 'needs_input',
]);

// ─── Storage ────────────────────────────────────────────────────────────────

interface LaneEvent {
  atMs: number;
  status: ChatLaneStatus;
  reason: string | null;
  fallback: boolean;
}

const registry = new Map<string, LaneEvent[]>();

function evictStalestLane(): void {
  let stalestKey: string | null = null;
  let stalestNewest = Infinity;
  for (const [key, ring] of registry) {
    const newest = ring.length ? ring[ring.length - 1].atMs : -Infinity;
    if (newest < stalestNewest) { stalestNewest = newest; stalestKey = key; }
  }
  if (stalestKey != null) registry.delete(stalestKey);
}

// ─── Record ─────────────────────────────────────────────────────────────────

export interface ChatLaneTerminalRecord {
  lane: ChatLaneId | string;
  status: ChatLaneStatus;
  /** Classification reason on non-completed outcomes (e.g. 'provider_5xx'). */
  reason?: string | null;
  /** True when the turn was served by a visible fallback (never silent). */
  fallback?: boolean;
}

/** Record one lane terminal. Accepts the full outcome or a compact record. */
export function recordChatLaneTerminal(record: ChatLaneTerminalRecord, nowMs: number): void {
  if (!record || typeof record.lane !== 'string' || !record.lane) return;
  const lane = record.lane.trim().slice(0, 40);
  if (!lane) return;
  let ring = registry.get(lane);
  if (!ring) {
    if (registry.size >= MAX_LANES) evictStalestLane();
    ring = [];
    registry.set(lane, ring);
  }
  ring.push({
    atMs: nowMs,
    status: record.status,
    reason: typeof record.reason === 'string' && record.reason ? record.reason.slice(0, 80) : null,
    fallback: record.fallback === true,
  });
  if (ring.length > MAX_EVENTS_PER_LANE) {
    ring.splice(0, ring.length - MAX_EVENTS_PER_LANE);
  }
}

/** Convenience: record a full ChatLaneOutcome envelope. */
export function recordChatLaneOutcome(outcome: ChatLaneOutcome, nowMs: number): void {
  if (!outcome) return;
  recordChatLaneTerminal({
    lane: outcome.lane,
    status: outcome.status,
    reason: outcome.recovery?.reason ?? null,
    fallback: outcome.servedBy?.fallback === true,
  }, nowMs);
}

/** Wall-clock shims for production call sites. */
export function recordChatLaneOutcomeNow(outcome: ChatLaneOutcome): void {
  recordChatLaneOutcome(outcome, Date.now());
}
export function recordChatLaneTerminalNow(record: ChatLaneTerminalRecord): void {
  recordChatLaneTerminal(record, Date.now());
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export interface ChatLaneHealth {
  lane: string;
  total: number;
  completed: number;
  failed: number;
  interrupted: number;
  neutral: number;
  fallbacks: number;
  /** Trailing failure streak (newest→oldest, success clears, neutral skips)
   *  over FRESH events only when a `nowMs` was supplied. */
  consecutiveFailures: number;
  /** failed+interrupted share of FRESH non-neutral outcomes in the window. */
  failureRate: number;
  /** failed+interrupted count among FRESH non-neutral outcomes. */
  freshFailures: number;
  /** FRESH non-neutral outcome count — the window the floors apply to. */
  freshWindow: number;
  lastStatus: ChatLaneStatus;
  lastReason: string | null;
  lastAtMs: number;
  degraded: boolean;
}

/**
 * Health for one lane. When `nowMs` is supplied, the alarm inputs — trailing
 * streak, failure rate, and the degradation floors — consider FRESH events
 * only (age ≤ LANE_HEALTH_STALENESS_MS), so stale failures can never
 * resurrect an alarm after a fresh event lands. Whole-ring session counts
 * (total/completed/failed/…) are kept for history surfaces like `/lanes`.
 * Without `nowMs`, every recorded event counts (legacy whole-ring behavior).
 */
function laneHealthFromRing(lane: string, ring: LaneEvent[], nowMs?: number): ChatLaneHealth {
  let completed = 0;
  let failed = 0;
  let interrupted = 0;
  let neutral = 0;
  let fallbacks = 0;
  const freshFloorMs = typeof nowMs === 'number' ? nowMs - LANE_HEALTH_STALENESS_MS : -Infinity;
  const fresh: LaneEvent[] = [];
  for (const event of ring) {
    if (event.status === 'completed') completed += 1;
    else if (event.status === 'failed') failed += 1;
    else if (event.status === 'interrupted') interrupted += 1;
    else if (NEUTRAL_STATUSES.has(event.status)) neutral += 1;
    if (event.fallback) fallbacks += 1;
    if (event.atMs >= freshFloorMs) fresh.push(event);
  }
  let consecutiveFailures = 0;
  for (let i = fresh.length - 1; i >= 0; i -= 1) {
    const status = fresh[i].status;
    if (status === 'completed') break;
    if (FAILURE_STATUSES.has(status)) consecutiveFailures += 1;
    // neutral statuses neither break nor extend the streak
  }
  let freshCompleted = 0;
  let freshFailures = 0;
  for (const event of fresh) {
    if (event.status === 'completed') freshCompleted += 1;
    else if (FAILURE_STATUSES.has(event.status)) freshFailures += 1;
  }
  const freshWindow = freshCompleted + freshFailures;
  const failureRate = freshWindow > 0 ? freshFailures / freshWindow : 0;
  const last = ring[ring.length - 1];
  const degraded =
    consecutiveFailures >= DEGRADED_STREAK_FLOOR
    || (freshWindow >= DEGRADED_MIN_WINDOW && failureRate >= DEGRADED_FAILURE_RATE_FLOOR);
  return {
    lane,
    total: ring.length,
    completed,
    failed,
    interrupted,
    neutral,
    fallbacks,
    consecutiveFailures,
    failureRate,
    freshFailures,
    freshWindow,
    lastStatus: last.status,
    lastReason: last.reason,
    lastAtMs: last.atMs,
    degraded,
  };
}

/** Per-lane health for every recorded lane (unordered map → sorted by lane).
 *  Pass `nowMs` so streak/rate/degraded consider fresh events only; without
 *  it, every recorded event counts (whole-ring legacy behavior). */
export function getChatLaneHealthSnapshot(nowMs?: number): ChatLaneHealth[] {
  const out: ChatLaneHealth[] = [];
  for (const [lane, ring] of registry) {
    if (ring.length === 0) continue;
    out.push(laneHealthFromRing(lane, ring, nowMs));
  }
  return out.sort((a, b) => a.lane.localeCompare(b.lane));
}

// ─── Degradation classification (the postmortem primitive) ─────────────────

export type ChatLaneDegradationScope = 'none' | 'lane_isolated' | 'multi_lane';

export interface ChatLaneDegradationAssessment {
  scope: ChatLaneDegradationScope;
  degradedLanes: string[];
  healthyLanes: string[];
  /** One plain-language line stating what the pattern means. */
  summary: string;
}

/**
 * Classify the current pattern. Staleness-aware twice over: lanes whose
 * newest event is older than the staleness window are ignored entirely (no
 * crying wolf about a failure from an hour ago), and within a live lane only
 * fresh events feed the streak/rate floors (stale failures cannot resurrect
 * an alarm just because a fresh event landed). `lane_isolated` = exactly the
 * situation the postmortems say must be legible; `multi_lane` = systemic.
 */
export function assessChatLaneDegradation(nowMs: number): ChatLaneDegradationAssessment {
  const fresh = getChatLaneHealthSnapshot(nowMs).filter(
    (health) => nowMs - health.lastAtMs <= LANE_HEALTH_STALENESS_MS,
  );
  const degraded = fresh.filter((h) => h.degraded).map((h) => h.lane);
  const healthy = fresh.filter((h) => !h.degraded).map((h) => h.lane);
  if (degraded.length === 0) {
    return { scope: 'none', degradedLanes: [], healthyLanes: healthy, summary: 'All recorded lanes healthy.' };
  }
  if (degraded.length === 1 && healthy.length >= 1) {
    return {
      scope: 'lane_isolated',
      degradedLanes: degraded,
      healthyLanes: healthy,
      summary: `Lane-isolated degradation: ${degraded[0]} is failing while ${healthy.length} other lane(s) stay healthy — suspect that lane's transport/model, not global quality.`,
    };
  }
  return {
    scope: degraded.length > 1 ? 'multi_lane' : 'lane_isolated',
    degradedLanes: degraded,
    healthyLanes: healthy,
    summary: degraded.length > 1
      ? `Multi-lane degradation: ${degraded.join(', ')} failing — treat as systemic (provider/auth/network), not a single lane.`
      : `Degradation on ${degraded[0]} (no healthy-lane baseline recorded this session).`,
  };
}

// ─── Hints + report (surfacing) ─────────────────────────────────────────────

function formatAge(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / (60 * 60_000))}h ago`;
}

/**
 * WARN-only hint for one lane — null when healthy, unrecorded, or stale.
 * Mirrors integrationHealthRegistry semantics: a healthy lane gets no line.
 */
export function getChatLaneHealthHint(lane: string, nowMs: number): string | null {
  const ring = registry.get(String(lane || '').trim().slice(0, 40));
  if (!ring || ring.length === 0) return null;
  const health = laneHealthFromRing(lane, ring, nowMs);
  if (!health.degraded) return null;
  if (nowMs - health.lastAtMs > LANE_HEALTH_STALENESS_MS) return null;
  const reasonPart = health.lastReason ? ` (last: ${health.lastReason})` : '';
  return `⚠️ ${lane}: ${describeDegradation(health)}${reasonPart}, ${formatAge(nowMs - health.lastAtMs)}`;
}

/** One phrase naming WHY the lane is degraded: the streak when the streak
 *  floor fired, otherwise the fresh-window failure rate (never "0 fail(s)"). */
function describeDegradation(health: ChatLaneHealth): string {
  return health.consecutiveFailures >= DEGRADED_STREAK_FLOOR
    ? `${health.consecutiveFailures} consecutive failure(s)`
    : `${health.freshFailures} of last ${health.freshWindow} failed`;
}

/** Archive-safe tags for a failure site: lane health + degradation scope. */
export function buildChatLaneHealthTags(lane: string, nowMs: number): string[] {
  const tags: string[] = [];
  const ring = registry.get(String(lane || '').trim().slice(0, 40));
  if (ring && ring.length > 0) {
    const health = laneHealthFromRing(lane, ring, nowMs);
    if (health.degraded) tags.push('lane_degraded:yes', `lane_failure_streak:${health.consecutiveFailures}`);
  }
  const assessment = assessChatLaneDegradation(nowMs);
  if (assessment.scope !== 'none') tags.push(`lane_degradation_scope:${assessment.scope}`);
  return tags;
}

/**
 * Compact multi-line report for the local `/lanes` status command. Bounded;
 * plain language; shows the degradation classification first.
 */
export function formatChatLaneHealthReport(nowMs: number): string {
  const snapshot = getChatLaneHealthSnapshot(nowMs);
  if (snapshot.length === 0) {
    return 'Lane health: no chat lane terminals recorded this session yet. Lanes report here as turns complete or fail (stream, batch, openswan_v2, computer_task, …).';
  }
  const assessment = assessChatLaneDegradation(nowMs);
  const lines: string[] = ['**Lane health (this session)**', assessment.summary, ''];
  for (const health of snapshot.slice(0, MAX_LANES)) {
    // Session-wide share so it stays consistent with the counts shown beside
    // it (health.failureRate is fresh-window-only and drives alarms instead).
    const nonNeutral = health.completed + health.failed + health.interrupted;
    const okShare = nonNeutral > 0 ? Math.round((health.completed / nonNeutral) * 100) : 100;
    const flag = health.degraded ? '⚠️' : '✅';
    const parts = [
      `${flag} ${health.lane}: ${health.completed} ok / ${health.failed} failed`
        + (health.interrupted ? ` / ${health.interrupted} interrupted` : '')
        + (health.neutral ? ` / ${health.neutral} neutral` : ''),
      `${okShare}% ok`,
      `last ${health.lastStatus}${health.lastReason ? ` (${health.lastReason})` : ''} ${formatAge(nowMs - health.lastAtMs)}`,
    ];
    if (health.fallbacks > 0) parts.push(`${health.fallbacks} fallback(s)`);
    lines.push(`- ${parts.join(' · ')}`);
  }
  return lines.join('\n');
}

/** Wall-clock shim. */
export function formatChatLaneHealthReportNow(): string {
  return formatChatLaneHealthReport(Date.now());
}

// ─── Office strip model (X7 tail / P53) ─────────────────────────────────────

/**
 * Presentation model for the Office lane-health strip. Mirrors the
 * OfficeBridgeReadinessStrip contract: WARN/DANGER-ONLY — returns null when
 * nothing is recorded, everything is healthy, or the degradation is stale
 * (silent when healthy; the `/lanes` command owns the full report).
 * `danger` = multi-lane (systemic pattern); `warn` = lane-isolated.
 */
export interface ChatLaneHealthStripModel {
  tone: 'warn' | 'danger';
  headline: string;
  detail: string;
}

export function buildChatLaneHealthStripModel(nowMs: number): ChatLaneHealthStripModel | null {
  const assessment = assessChatLaneDegradation(nowMs);
  if (assessment.scope === 'none') return null;
  const snapshot = getChatLaneHealthSnapshot(nowMs);
  const degraded = snapshot.filter((h) => assessment.degradedLanes.includes(h.lane));
  if (degraded.length === 0) return null;
  const first = degraded[0];
  // Streak floor fired → name the streak; otherwise the rate floor fired
  // (streak may be 0), so name the fresh-window rate — never "0 fail(s)".
  const firstDetail = first.consecutiveFailures >= DEGRADED_STREAK_FLOOR
    ? `${first.consecutiveFailures} fail(s)`
    : `${first.freshFailures} of last ${first.freshWindow} failed`;
  const headline = assessment.scope === 'multi_lane'
    ? `LANES DEGRADED — ${assessment.degradedLanes.slice(0, 3).join(', ')}`
    : `LANE DEGRADED — ${first.lane}: ${firstDetail}${first.lastReason ? ` (${first.lastReason})` : ''}`;
  return {
    tone: assessment.scope === 'multi_lane' ? 'danger' : 'warn',
    headline: headline.slice(0, 120),
    detail: `${assessment.summary} Type /lanes in chat for the full report.`.slice(0, 220),
  };
}

/** Wall-clock shim for the Office strip. */
export function buildChatLaneHealthStripModelNow(): ChatLaneHealthStripModel | null {
  return buildChatLaneHealthStripModel(Date.now());
}

/** Test hook — wipe all recorded lane health. */
export function resetChatLaneHealth(): void {
  registry.clear();
}
