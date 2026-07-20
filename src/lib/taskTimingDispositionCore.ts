// taskTimingDispositionCore — the PURE "when does this task actually run?" brain
// that sits at the chat front door. Today the app has only two timing outcomes:
// run a request NOW (the default), or turn it into a RECURRING automation when the
// text literally says "every/daily/when X" (automationChatParser). Three real
// cases have no home:
//   (a) "email me the report once the nightly export finishes" — a dependency on
//       a resource that is currently UNAVAILABLE; it cannot run now and a fixed
//       wall-clock is meaningless → defer_until_unblocked.
//   (b) "tomorrow at 9am send the summary" — a ONE-SHOT at an explicit future T
//       (automationChatParser only makes recurring crons / event triggers, never
//       a single future instant) → schedule_once.
//   (c) "run the full site scrape" typed during work hours when it is expensive
//       and off-hours would be cheaper/safer → schedule_once at the next window.
//
// The pieces to ACT on each disposition already exist (interactive dispatch;
// scheduledActions rows with a scheduled_for; automationChatParser +
// scheduledIntegrationAction for recurring; deadlineSlaCore for tick math). What
// was missing is the front-door BRAIN that PICKS one disposition from signals and,
// when several signals collide, applies a fixed priority. This core is that
// router: it consumes the other pieces' OUTPUTS as opaque signals and never
// re-implements any of them (it does not parse time text into ms, does not parse a
// cadence into cron, and does not compute the next tick).
//
// PURITY (load-bearing): ZERO runtime imports — nothing is imported at all — so it
// loads under tsx/esbuild for smoke testing (which cannot load react-native /
// supabase). DETERMINISTIC: every time is INJECTED as epoch ms by the caller; the
// core never reads a clock (no Date.now / Math.random / argless `new Date`).
// Frozen const maps; HoursBucket + disposition matched by explicit `===` compares
// (no dynamic object indexing → no `constructor` / `__proto__` hazard). Text is
// code-POINT aware (spread iteration) so an astral char / emoji surrogate pair is
// never split, and any lone surrogate is dropped. BOUNDED: every output is clamped
// by the exported MAX_* caps; huge input is pre-sliced before per-code-point work.
// TOTAL: every export tolerates null / undefined / wrong-type / NaN / bigint /
// cyclic / throwing-proxy / hostile input and returns a well-formed value — it
// NEVER throws (outer try/catch + per-value guards). SECRET-SAFE: `reason` is drawn
// from a FIXED token set (never free-form); `blockedOn` / `recurrenceHint` are
// caller labels trimmed + bounded + control/line-sep/prompt-fence stripped (the
// same no-secrets contract as watch task text) so nothing can smuggle a fence or
// newline through.

// ── Public contract ───────────────────────────────────────────────────────────

/** What the front door decides to DO with a task's timing. */
export type TimingDisposition = 'run_now' | 'schedule_once' | 'recurring' | 'defer_until_unblocked';

/** Whether the user's LOCAL clock is in working hours. The CALLER computes this
 *  from the user's timezone; the core never reads a clock. */
export type HoursBucket = 'on_hours' | 'off_hours';

/**
 * Already-resolved signals for one task, gathered upstream by the planner. Every
 * time is epoch ms the CALLER supplied; the core reads no clock.
 *   - `nowMs`               — the reference "now" (epoch ms) the caller anchors on.
 *   - `explicitRunAtMs`     — a ONE-SHOT wall-clock the caller already resolved to
 *                             epoch ms ("tomorrow at 9" → ms). The core does NOT
 *                             parse time text.
 *   - `recurrenceHint`      — an opaque cadence phrase/token the caller detected
 *                             upstream (what made looksLikeAutomationRequest true).
 *                             Presence ⇒ a standing job; the core ECHOES it through,
 *                             it does NOT parse it into cron.
 *   - `blockingResource`    — a needed resource currently UNAVAILABLE (e.g.
 *                             "nightly export"); presence ⇒ cannot run now.
 *   - `hoursBucket`         — the user's local on/off-hours bucket.
 *   - `nextOffHoursStartMs` — epoch ms of the next off-hours window's start.
 *   - `estimatedCostUsd`    — forecast task cost (from agentCostForecastCore).
 *   - `estimatedDurationMs` — forecast task duration.
 */
export interface TaskTimingSignals {
  nowMs: number;
  explicitRunAtMs?: number | null;
  recurrenceHint?: string | null;
  blockingResource?: string | null;
  hoursBucket?: HoursBucket | null;
  nextOffHoursStartMs?: number | null;
  estimatedCostUsd?: number | null;
  estimatedDurationMs?: number | null;
}

/** The routed timing decision. Exactly one disposition; the sink-relevant field
 *  is populated (`runAtMs` for schedule_once, `recurrenceHint` for recurring,
 *  `blockedOn` for defer) and the rest are null. */
export interface TimingDecision {
  disposition: TimingDisposition;
  /** The instant to run at (schedule_once only); null otherwise. */
  runAtMs: number | null;
  /** The echoed cadence hint (recurring only); null otherwise. */
  recurrenceHint: string | null;
  /** The bounded resource label the task waits on (defer only); null otherwise. */
  blockedOn: string | null;
  /** A fixed-vocabulary reason code (never free-form). */
  reason: string;
  /** Heuristic confidence in [0, 1]. */
  confidence: number;
  /** Bounded diagnostic list of every input signal detected (fixed order). */
  signalsFired: string[];
}

// ── Bounds (exported caps) ──────────────────────────────────────────────────────

/** Longest `reason` / rendered label. */
export const MAX_REASON_CHARS = 120;
/** Longest echoed `blockedOn` resource label. */
export const MAX_BLOCKED_ON_CHARS = 80;
/** Longest echoed `recurrenceHint` cadence label. */
export const MAX_RECURRENCE_HINT_CHARS = 160;
/** Most diagnostic tokens kept in `signalsFired`. */
export const MAX_SIGNALS_FIRED = 8;
/** Task cost STRICTLY above this (USD) is "expensive" for off-hours deferral. */
export const OFF_HOURS_COST_THRESHOLD_USD = 0.5;
/** Task duration STRICTLY above this (ms, = 2 min) is "expensive" for deferral. */
export const OFF_HOURS_DURATION_THRESHOLD_MS = 120_000;

/**
 * The fixed reason-code vocabulary. `reason` on every decision is one of these —
 * never caller text — so a reason can be safely rendered / branched on / logged.
 */
export const TIMING_REASON = Object.freeze({
  DEFER_RESOURCE: 'defer_until_unblocked:resource',
  RECURRING_CADENCE: 'recurring:cadence',
  SCHEDULE_EXPLICIT: 'schedule_once:explicit_time',
  RUN_NOW_EXPLICIT_PAST: 'run_now:explicit_time_in_past',
  SCHEDULE_OFF_HOURS: 'schedule_once:off_hours_defer_expensive',
  RUN_NOW_DEFAULT: 'run_now:default',
} as const);

/** Every reason code, frozen, for callers/tests that validate membership. */
export const TIMING_REASON_CODES: readonly string[] = Object.freeze([
  TIMING_REASON.DEFER_RESOURCE,
  TIMING_REASON.RECURRING_CADENCE,
  TIMING_REASON.SCHEDULE_EXPLICIT,
  TIMING_REASON.RUN_NOW_EXPLICIT_PAST,
  TIMING_REASON.SCHEDULE_OFF_HOURS,
  TIMING_REASON.RUN_NOW_DEFAULT,
]);

/** Every diagnostic signal token, frozen, for callers/tests. */
export const TIMING_SIGNAL_TOKENS: readonly string[] = Object.freeze([
  'blocking_resource',
  'recurrence_hint',
  'explicit_time_future',
  'explicit_time_past',
  'expensive',
  'on_hours',
  'off_hours',
  'next_off_hours_known',
]);

// ── Internal constants ──────────────────────────────────────────────────────────

// Strip anything that could break a UI line, smuggle content past a section
// fence, or hide bidi tricks in an echoed label. Escape sequences only — a raw
// control / line-separator byte must NEVER appear in source.
const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g; // zero-width / bidi / BOM
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g; // C0 + DEL + C1
const LINE_SEP_RE = /[\u2028\u2029]/g; // LINE / PARAGRAPH separators
const FENCE_RE = /[`<>]/g; // prompt-fence chars
const WS_RUN_RE = /\s+/g;

/** Single-code-point ellipsis appended when a rendered label is truncated. */
const ELLIPSIS = '…';

/** The fail-safe decision when even the guarded body throws (should never fire). */
const SAFE_DEFAULT_DECISION: TimingDecision = Object.freeze({
  disposition: 'run_now',
  runAtMs: null,
  recurrenceHint: null,
  blockedOn: null,
  reason: TIMING_REASON.RUN_NOW_DEFAULT,
  confidence: 0.8,
  signalsFired: Object.freeze([]) as unknown as string[],
});

// ── Total helpers ───────────────────────────────────────────────────────────────

/** A finite number, else null. Non-numbers / NaN / ±Infinity / bigint → null. */
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Clamp an arbitrary value to a confidence in [0, 1]; junk → 0. */
function clampConfidence(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Accept only a real HoursBucket via explicit compare (no dynamic indexing). */
function normalizeHoursBucket(v: unknown): HoursBucket | null {
  return v === 'on_hours' || v === 'off_hours' ? v : null;
}

/** Accept only a real disposition via explicit compare; anything else → run_now. */
function normalizeDisposition(v: unknown): TimingDisposition {
  return v === 'run_now' ||
    v === 'schedule_once' ||
    v === 'recurring' ||
    v === 'defer_until_unblocked'
    ? v
    : 'run_now';
}

/**
 * Trim + bound + strip a caller label (resource name / cadence phrase) to a safe,
 * single-line, code-point-bounded token. Returns null when the input is not a
 * string, or reduces to empty (whitespace-only / all-control) — i.e. "absent".
 * Same no-secrets contract as watch task text: control / line-separator /
 * prompt-fence / zero-width chars are removed so nothing escapes a section, and a
 * lone surrogate is dropped so an emoji pair is never split.
 */
function sanitizeLabel(v: unknown, cap: number): string | null {
  if (typeof v !== 'string' || v.length === 0 || cap <= 0) return null;
  // Pre-slice on UTF-16 units so the regexes never scan a multi-MB hostile string;
  // a dangling surrogate from an odd cut is handled by the lone-surrogate drop.
  const ceil = cap * 4 + 64;
  let s = v.length > ceil ? v.slice(0, ceil) : v;
  s = s
    .replace(INVISIBLE_RE, '')
    .replace(CONTROL_RE, ' ')
    .replace(LINE_SEP_RE, ' ')
    .replace(FENCE_RE, ' ')
    .replace(WS_RUN_RE, ' ')
    .trim();
  if (!s) return null;
  // Code-point-safe bound: spread iterates whole code points, so a surrogate pair
  // stays intact; a LONE surrogate (its code point lands in [0xD800, 0xDFFF]) is
  // dropped rather than emitted split.
  const out: string[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c >= 0xd800 && c <= 0xdfff) continue;
    out.push(ch);
    if (out.length >= cap) break;
  }
  const bounded = out.join('');
  return bounded.length > 0 ? bounded : null;
}

/** Clamp a rendered label to MAX_REASON_CHARS code points (never splits a pair). */
function clampRendered(s: string): string {
  const points = [...s];
  if (points.length <= MAX_REASON_CHARS) return s;
  return points.slice(0, MAX_REASON_CHARS - 1).join('') + ELLIPSIS;
}

/** Build one immutable decision. `signalsFired` is already bounded by the caller. */
function makeDecision(
  disposition: TimingDisposition,
  runAtMs: number | null,
  recurrenceHint: string | null,
  blockedOn: string | null,
  reason: string,
  confidence: number,
  signalsFired: string[],
): TimingDecision {
  return { disposition, runAtMs, recurrenceHint, blockedOn, reason, confidence, signalsFired };
}

// ── Public: cost/duration gate ───────────────────────────────────────────────────

/**
 * Is this task "expensive enough" to prefer an off-hours window? True when the
 * forecast cost is STRICTLY above OFF_HOURS_COST_THRESHOLD_USD, OR the forecast
 * duration is STRICTLY above OFF_HOURS_DURATION_THRESHOLD_MS. Finite-guarded:
 * non-finite / negative / wrong-typed inputs read as "not over" (a threshold can
 * only ever ADD a defer, never force one). Total — never throws. Boundary: exactly
 * at a threshold is NOT over.
 */
export function isExpensiveForOffHours(costUsd: number, durationMs: number): boolean {
  const cost = finiteOrNull(costUsd);
  const dur = finiteOrNull(durationMs);
  const costOver = cost !== null && cost > OFF_HOURS_COST_THRESHOLD_USD;
  const durOver = dur !== null && dur > OFF_HOURS_DURATION_THRESHOLD_MS;
  return costOver || durOver;
}

// ── Public: the disposition router ───────────────────────────────────────────────

/**
 * Decide ONE timing disposition from the signals via a first-match priority
 * ladder, and route the sink-relevant datum onto the decision:
 *
 *   1. `blockingResource` non-blank      → defer_until_unblocked (blockedOn set,
 *      runAtMs null, confidence 0.9). HIGHEST: an unavailable dependency makes
 *      both "now" and a fixed T meaningless.
 *   2. else `recurrenceHint` non-blank   → recurring (recurrenceHint echoed,
 *      runAtMs null, confidence 0.85).
 *   3. else `explicitRunAtMs` finite (and a usable `nowMs`):
 *        > now  → schedule_once at that instant (confidence 0.9);
 *        <= now → run_now (explicit_time_in_past, confidence 0.7) — never schedule
 *                 at a PAST instant.
 *   4. else expensive AND on_hours AND a known FUTURE off-hours window
 *      → schedule_once at that window (confidence 0.6).
 *   5. else                              → run_now (default, confidence 0.8).
 *
 * `signalsFired` is an independent, fixed-order diagnostic snapshot of EVERY input
 * signal present, capped at MAX_SIGNALS_FIRED. Total: any input (null / wrong-type
 * / hostile / throwing-proxy) yields a well-formed decision and never throws.
 * Deterministic — reads no clock.
 */
export function decideTaskTiming(signals: TaskTimingSignals): TimingDecision {
  try {
    const s = (signals && typeof signals === 'object' ? signals : {}) as Partial<TaskTimingSignals>;

    // Resolve every signal defensively (each read is inside the outer try, so a
    // throwing-proxy field drops us to the fail-safe rather than escaping).
    const now = finiteOrNull(s.nowMs);
    const blockedOn = sanitizeLabel(s.blockingResource, MAX_BLOCKED_ON_CHARS);
    const recurrence = sanitizeLabel(s.recurrenceHint, MAX_RECURRENCE_HINT_CHARS);
    const runAt = finiteOrNull(s.explicitRunAtMs);
    const hours = normalizeHoursBucket(s.hoursBucket);
    const nextOff = finiteOrNull(s.nextOffHoursStartMs);
    // isExpensiveForOffHours is itself total; the casts only satisfy the typed
    // signature — a non-number coerces to "not over" inside it.
    const expensive = isExpensiveForOffHours(
      s.estimatedCostUsd as number,
      s.estimatedDurationMs as number,
    );

    // ── Diagnostic snapshot (fixed order; every present signal, not just the
    // winner). Explicit-time future/past is only classifiable with a usable now. ──
    const fired: string[] = [];
    if (blockedOn) fired.push('blocking_resource');
    if (recurrence) fired.push('recurrence_hint');
    if (runAt !== null && now !== null) {
      fired.push(runAt > now ? 'explicit_time_future' : 'explicit_time_past');
    }
    if (expensive) fired.push('expensive');
    if (hours === 'on_hours') fired.push('on_hours');
    else if (hours === 'off_hours') fired.push('off_hours');
    if (nextOff !== null) fired.push('next_off_hours_known');
    const signalsFired = fired.slice(0, MAX_SIGNALS_FIRED);

    // ── Priority ladder (first match wins) ──────────────────────────────────────

    // 1. Blocked on an unavailable dependency — cannot run now, no meaningful T.
    if (blockedOn) {
      return makeDecision('defer_until_unblocked', null, null, blockedOn, TIMING_REASON.DEFER_RESOURCE, 0.9, signalsFired);
    }

    // 2. A standing/recurring job — hand the cadence to the automation sink.
    if (recurrence) {
      return makeDecision('recurring', null, recurrence, null, TIMING_REASON.RECURRING_CADENCE, 0.85, signalsFired);
    }

    // 3. An explicit one-shot instant (only with a usable clock to compare against).
    if (runAt !== null && now !== null) {
      if (runAt > now) {
        return makeDecision('schedule_once', runAt, null, null, TIMING_REASON.SCHEDULE_EXPLICIT, 0.9, signalsFired);
      }
      // At/behind now — never schedule at a past instant; run it now instead.
      return makeDecision('run_now', null, null, null, TIMING_REASON.RUN_NOW_EXPLICIT_PAST, 0.7, signalsFired);
    }

    // 4. Expensive during on-hours with a known FUTURE off-hours window — defer it
    //    to the cheaper/safer window. Only when we KNOW it is on-hours.
    if (expensive && hours === 'on_hours' && nextOff !== null && now !== null && nextOff > now) {
      return makeDecision('schedule_once', nextOff, null, null, TIMING_REASON.SCHEDULE_OFF_HOURS, 0.6, signalsFired);
    }

    // 5. Default — run it now.
    return makeDecision('run_now', null, null, null, TIMING_REASON.RUN_NOW_DEFAULT, 0.8, signalsFired);
  } catch {
    // Absolute backstop — a front-door router must never break the chat turn.
    return {
      disposition: 'run_now',
      runAtMs: null,
      recurrenceHint: null,
      blockedOn: null,
      reason: SAFE_DEFAULT_DECISION.reason,
      confidence: SAFE_DEFAULT_DECISION.confidence,
      signalsFired: [],
    };
  }
}

// ── Public: one-line human label ─────────────────────────────────────────────────

/**
 * Render a compact, single-line label for a decision — bounded to MAX_REASON_CHARS
 * code points, secret-safe (re-sanitizes any echoed caller label), and never
 * throwing on a hostile/partial decision object.
 */
export function describeTimingDecision(decision: TimingDecision): string {
  try {
    const d = (decision && typeof decision === 'object' ? decision : {}) as Partial<TimingDecision>;
    const disposition = normalizeDisposition(d.disposition);
    const pct = `${Math.round(clampConfidence(d.confidence) * 100)}%`;

    switch (disposition) {
      case 'defer_until_unblocked': {
        const b = sanitizeLabel(d.blockedOn, MAX_BLOCKED_ON_CHARS);
        return clampRendered(b ? `Deferred until "${b}" is available · ${pct}` : `Deferred until unblocked · ${pct}`);
      }
      case 'recurring': {
        const h = sanitizeLabel(d.recurrenceHint, MAX_RECURRENCE_HINT_CHARS);
        return clampRendered(h ? `Recurring (${h}) · ${pct}` : `Recurring · ${pct}`);
      }
      case 'schedule_once': {
        const at = finiteOrNull(d.runAtMs);
        return clampRendered(at !== null ? `Scheduled once @ ${at} · ${pct}` : `Scheduled once · ${pct}`);
      }
      case 'run_now':
      default:
        return clampRendered(`Run now · ${pct}`);
    }
  } catch {
    return 'Run now';
  }
}
