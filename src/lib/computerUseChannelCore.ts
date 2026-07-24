// computerUseChannelCore — the PURE channel selector for the computer-use HYBRID
// FALLTHROUGH pattern (the mid-2026 computer-use frontier reliability posture).
// It does NOT drive any surface: it decides, given which automation channels are
// available and which have already been tried/failed, WHICH channel to attempt
// next — always preferring deterministic channels and dropping to pixels/vision
// only as a last resort.
//
// Posture (deterministic-first): the canonical priority is
//   api  >  accessibility  >  vision
// A structured API is the cheapest and most reliable channel, the accessibility
// tree is the next-most-deterministic, and vision (pixel/screenshot inference) is
// the most expensive and least reliable, so it is the last resort. selectChannel
// picks the highest-priority AVAILABLE channel that has NOT already failed; if the
// only remaining channel is vision AND a non-vision channel already failed, the
// decision is flagged `escalated` (we were forced down to pixels). When every
// available channel has failed, the decision is `exhausted` with a null channel.
//
// Fail-safe: every input is guarded to a safe default. Unknown/undefined
// availability is treated as "unavailable" (the deterministic channels are only
// used when explicitly present), and a malformed attempts list is treated as
// "nothing tried yet". This module never throws.
//
// PURITY: zero runtime imports, tsx-loadable (smoke: computer-use-channel-core).
// Deterministic — no Date.now / Math.random. Never throws.

export type AutomationChannel = 'api' | 'accessibility' | 'vision';

export interface ChannelAvailability {
  api: boolean;
  accessibility: boolean;
  vision: boolean;
}

export interface ChannelAttempt {
  channel: AutomationChannel;
  ok: boolean;
  reason?: string;
}

export interface ChannelDecision {
  /** The channel to attempt next, or null when every available channel has failed. */
  channel: AutomationChannel | null;
  /** true when we were forced down to vision after a non-vision channel failed. */
  escalated: boolean;
  /** true when no available channel remains untried. */
  exhausted: boolean;
  reason: string;
}

// Canonical deterministic-first priority. Index = expense/unreliability rank:
// lower is preferred. Vision is intentionally last.
export const CHANNEL_PRIORITY: readonly AutomationChannel[] = ['api', 'accessibility', 'vision'] as const;

/** The non-vision (deterministic) channels, in priority order. */
export const DETERMINISTIC_CHANNELS: readonly AutomationChannel[] = ['api', 'accessibility'] as const;

/** Default number of non-vision failures after which we escalate to vision. */
export const DEFAULT_MAX_NON_VISION_FAILURES = 2;

/** Coerce an unknown value to a strict boolean (only literal true counts). */
function asBool(value: unknown): boolean {
  return value === true;
}

/** Guard an arbitrary value into a safe ChannelAvailability. Never throws. */
function normalizeAvailability(availability: unknown): ChannelAvailability {
  const a = (availability && typeof availability === 'object' ? availability : {}) as Partial<ChannelAvailability>;
  return {
    api: asBool(a.api),
    accessibility: asBool(a.accessibility),
    vision: asBool(a.vision),
  };
}

/** Is this a channel we recognise? */
function isChannel(value: unknown): value is AutomationChannel {
  return value === 'api' || value === 'accessibility' || value === 'vision';
}

/** Guard an arbitrary value into a safe, well-typed attempts list. Never throws. */
function normalizeAttempts(priorAttempts: unknown): ChannelAttempt[] {
  if (!Array.isArray(priorAttempts)) return [];
  const out: ChannelAttempt[] = [];
  for (const raw of priorAttempts) {
    if (!raw || typeof raw !== 'object') continue;
    const attempt = raw as Partial<ChannelAttempt>;
    if (!isChannel(attempt.channel)) continue;
    out.push({
      channel: attempt.channel,
      ok: asBool(attempt.ok),
      reason: typeof attempt.reason === 'string' ? attempt.reason : undefined,
    });
  }
  return out;
}

/** Set of channels that have at least one FAILED (ok === false) attempt. */
function failedChannels(attempts: ChannelAttempt[]): Set<AutomationChannel> {
  const failed = new Set<AutomationChannel>();
  for (const a of attempts) {
    if (!a.ok) failed.add(a.channel);
  }
  return failed;
}

/**
 * Ordered fallthrough of the AVAILABLE channels, deterministic-first
 * (api > accessibility > vision). Unavailable channels are dropped. Never throws.
 */
export function describeChannelPlan(availability: ChannelAvailability): AutomationChannel[] {
  const a = normalizeAvailability(availability);
  return CHANNEL_PRIORITY.filter((channel) => a[channel]);
}

/**
 * Should we drop to vision (last-resort pixels) now? True when every non-vision
 * channel is unavailable or has already failed, OR when the number of distinct
 * failed non-vision channels reaches the threshold (default 2). Never throws.
 *
 * Note: this is a channel-level signal and does not itself require vision to be
 * available — callers combine it with availability via selectChannel.
 */
export function shouldEscalateToVision(
  priorAttempts: ChannelAttempt[],
  opts?: { maxNonVisionFailures?: number },
): boolean {
  const attempts = normalizeAttempts(priorAttempts);
  const failed = failedChannels(attempts);

  // Count distinct non-vision channels that have failed.
  let nonVisionFailures = 0;
  for (const channel of DETERMINISTIC_CHANNELS) {
    if (failed.has(channel)) nonVisionFailures += 1;
  }

  const rawMax = opts?.maxNonVisionFailures;
  const maxNonVisionFailures =
    typeof rawMax === 'number' && Number.isFinite(rawMax) && rawMax >= 1
      ? Math.floor(rawMax)
      : DEFAULT_MAX_NON_VISION_FAILURES;

  // Threshold reached → escalate.
  if (nonVisionFailures >= maxNonVisionFailures) return true;

  // All deterministic channels are "done" (each has failed) → nothing left but
  // vision. (With no attempts at all this is false: DETERMINISTIC_CHANNELS is
  // non-empty, so `every failed` is false and we have not yet earned vision.)
  return DETERMINISTIC_CHANNELS.every((channel) => failed.has(channel));
}

/**
 * Select the next channel to attempt under the hybrid fallthrough policy.
 *
 * Picks the highest-priority AVAILABLE channel that has NOT already failed. If
 * the only remaining available channel is vision AND at least one non-vision
 * channel already failed, the decision is flagged `escalated`. If every available
 * channel has failed, returns { channel: null, exhausted: true }. If no channel is
 * available at all, returns { channel: null } with an explanatory reason.
 *
 * `preferDeterministic` (default true) documents the deterministic-first posture;
 * it never makes vision preferred, and setting it false does not reorder the
 * canonical priority — vision always stays last. Never throws.
 */
export function selectChannel(
  availability: ChannelAvailability,
  priorAttempts: ChannelAttempt[],
  opts?: { preferDeterministic?: boolean },
): ChannelDecision {
  const a = normalizeAvailability(availability);
  const attempts = normalizeAttempts(priorAttempts);
  const failed = failedChannels(attempts);
  // Default true; only an explicit `false` relaxes the (documentary) posture.
  const preferDeterministic = opts?.preferDeterministic !== false;

  const plan = CHANNEL_PRIORITY.filter((channel) => a[channel]);

  if (plan.length === 0) {
    return {
      channel: null,
      escalated: false,
      exhausted: false,
      reason: 'no automation channel is available',
    };
  }

  const remaining = plan.filter((channel) => !failed.has(channel));

  if (remaining.length === 0) {
    return {
      channel: null,
      escalated: false,
      exhausted: true,
      reason: 'every available channel has been attempted and failed',
    };
  }

  const next = remaining[0];
  const nonVisionFailed = DETERMINISTIC_CHANNELS.some((channel) => failed.has(channel));
  // We were forced down to vision as a last resort (a deterministic channel
  // already failed and vision is all that is left to try).
  const escalated = next === 'vision' && nonVisionFailed;

  let reason: string;
  if (escalated) {
    reason = 'escalated to vision (last resort) after deterministic channel(s) failed';
  } else if (next === 'vision') {
    reason = preferDeterministic
      ? 'only vision is available'
      : 'selected vision';
  } else {
    reason = `selected ${next} (deterministic-first)`;
  }

  return { channel: next, escalated, exhausted: false, reason };
}
