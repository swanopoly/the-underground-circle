// chatSessionResumptionCore — the PURE, deterministic RE-ENTRY posture picker
// for SwanBot / OpenSwan chat sessions.
//
// FINDING IT FIXES: when a chat thread is re-opened after a gap (or a run
// resumes), NOTHING decides the conversational re-entry posture. The runtime
// has per-machine resume plumbing but no core that reads "what was in flight +
// how long I've been away" and picks whether SwanBot should silently continue,
// briefly recap, re-confirm a now-stale pending action, or treat the thread as
// fresh. The only re-entry-ish rule that exists is a hardcoded 15-minute
// freshness window for a parked clarification, inline-triplicated at three
// ChatTab sites as `Date.now() - askedAt < 15 * 60 * 1000` (no shared constant,
// Date.now read inline → untestable, single binary threshold, clarification-only).
//
// THIS CORE supplies two things:
//   1. isPendingClarificationFresh(askedAt, now) + RESUMPTION_CLARIFICATION_FRESH_MS
//      — the deterministic, smoke-pinned drop-in for the triplicated literal
//      (byte-identical semantics: fresh ⇔ now - askedAt < 15 min).
//   2. decideSessionResumption(state) — folds the session summary (elapsed
//      dormancy bucket + pending clarification/approval freshness + in-flight
//      plan + open-task count + last outcome) into ONE re-entry posture and a
//      bounded, secret-safe prompt directive to inject at system-prompt assembly.
//
// RELATION TO SIBLINGS: chatTurnContinuityCore classifies a NEW user message
// against PRIOR turns (turn-to-turn, inside a live thread). This core fires at
// SESSION RE-ENTRY (thread re-open / run resume), keys off session STATE + a
// time-gap bucket, runs BEFORE/independent of any new message, and emits a
// posture — not a turn relation. Complementary, not overlapping.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which CANNOT load
// react-native/supabase): ZERO runtime imports; all types declared locally. No
// Date.now()/Math.random()/argless `new Date`; frozen const maps + Sets (so a
// '__proto__'/'constructor' key can never poison a lookup). Every export is
// TOTAL — never throws on any input (null/undefined/number/NaN/±Infinity/huge/
// bigint/symbol/cyclic/throwing-getter/proxy) and returns a safe, bounded,
// fully-populated decision. Output is BOUNDED (exported MAX_* caps; every echoed
// string clamped code-point-aware so an emoji/astral char is never split) and
// SECRET-SAFE: every echoed span is stripped of control / bidi / zero-width /
// line-separator / prompt-fence chars, secret-shaped tokens are redacted, and a
// wholly value-shaped span is dropped — a secret never reaches the directive.

// ── Public types ────────────────────────────────────────────────────────────

/** The chosen conversational re-entry posture for the re-opened session. */
export type ResumptionPosture =
  | 'continue-silently' // work in flight + barely any gap → just keep going, no recap
  | 'recap' // open work + a real gap, or a failed last run → one-line recap first
  | 'reconfirm' // a still-fresh pending action + a real gap → re-confirm before acting
  | 'reconfirm-stale-pending' // a pending action has gone stale → never act silently
  | 'fresh-start'; // nothing in flight → treat the thread as fresh (no directive)

/** Coarse human-dormancy bucket for the elapsed gap since last activity. */
export type ElapsedBucket =
  | 'brief' // < 2 min
  | 'short' // 2 min – 15 min
  | 'idle' // 15 min – 2 hr
  | 'long' // 2 hr – 24 hr
  | 'dormant' // >= 24 hr
  | 'unknown'; // elapsed could not be resolved

/** The session summary handed in at re-entry. Every field is optional +
 *  `unknown`-typed so callers can pass raw, partially-populated state. */
export interface SessionResumptionInput {
  /** Current wall-clock ms (the caller's Date.now()). */
  nowMs?: unknown;
  /** Last thread activity ms (e.g. thread.last_message_at → ms). */
  lastActivityAtMs?: unknown;
  /** Explicit elapsed-ms fallback used only when now/lastActivity can't resolve. */
  elapsedMs?: unknown;
  /** Count of open tasks tied to the thread. */
  openTaskCount?: unknown;
  /** ms a HITL clarification was asked (parked question). */
  pendingClarificationAskedAtMs?: unknown;
  /** ms a HITL approval was requested. */
  pendingApprovalRequestedAtMs?: unknown;
  /** Truthy when an agent run / plan is still resumable or alive. */
  inFlightPlan?: unknown;
  /** Last run outcome label (e.g. 'success' | 'failed' | 'error' | ...). */
  lastOutcome?: unknown;
  /** Human-readable "where we left off" label (untrusted → cleaned). */
  lastActivityLabel?: unknown;
}

/** The full re-entry decision. Deterministic, bounded, secret-safe. */
export interface SessionResumptionDecision {
  /** Chosen re-entry posture. */
  posture: ResumptionPosture;
  /** Dormancy bucket of the resolved gap. */
  elapsed: ElapsedBucket;
  /** Resolved elapsed ms since last activity, or null when unresolved. */
  elapsedMs: number | null;
  /** Whether a pending clarification (if any) is still within the fresh window. */
  clarificationStillFresh: boolean;
  /** Whether a pending approval (if any) is still within the fresh window. */
  approvalStillFresh: boolean;
  /** True iff any pending HITL action (clarification or approval) exists. */
  hasPendingAction: boolean;
  /** Bounded, secret-safe re-entry prompt block. '' for fresh-start. */
  directive: string;
  /** Short machine reason code (audit; never secret, never empty). */
  reason: string;
}

// ── Public bounds / thresholds (exported so wiring + smokes share exact caps) ──

/** The parked-clarification freshness window — the deterministic drop-in for the
 *  triplicated inline `15 * 60 * 1000`. A clarification asked < this ago is
 *  still fresh; at/after it is stale (must be re-confirmed, never acted on). */
export const RESUMPTION_CLARIFICATION_FRESH_MS = 15 * 60 * 1000; // 900_000

/** Exclusive upper bound of the 'brief' bucket (< 2 min). */
export const ELAPSED_BRIEF_MAX_MS = 120_000;
/** Exclusive upper bound of the 'short' bucket (< 15 min). */
export const ELAPSED_SHORT_MAX_MS = 900_000;
/** Exclusive upper bound of the 'idle' bucket (< 2 hr). */
export const ELAPSED_IDLE_MAX_MS = 7_200_000;
/** Exclusive upper bound of the 'long' bucket (< 24 hr); at/after → 'dormant'. */
export const ELAPSED_LONG_MAX_MS = 86_400_000;

/** Hard cap on the emitted directive length. */
export const MAX_DIRECTIVE_LEN = 400;
/** Hard cap on the cleaned last-activity label embedded in a directive. */
export const MAX_LABEL_LEN = 160;
/** Hard cap on the machine reason code. */
export const MAX_REASON_LEN = 80;

// ── Frozen vocab (deterministic; Sets/records so hostile keys can't poison) ───

const POSTURE_SET: ReadonlySet<string> = new Set<string>([
  'continue-silently', 'recap', 'reconfirm', 'reconfirm-stale-pending', 'fresh-start',
]);

/** Last-outcome labels that read as a FAILURE and warrant a recap. */
const FAILED_OUTCOMES: ReadonlySet<string> = new Set<string>([
  'failed', 'failure', 'fail', 'error', 'errored', 'errors', 'timeout',
  'timed-out', 'timed_out', 'cancelled', 'canceled', 'aborted', 'crashed',
  'interrupted', 'incomplete', 'blocked', 'rejected', 'stopped',
]);

/** Deterministic human phrase per bucket (never secret; ASCII, fence-free). */
const BUCKET_PHRASE: Readonly<Record<ElapsedBucket, string>> = Object.freeze({
  brief: 'a moment ago',
  short: 'a few minutes ago',
  idle: 'a little while ago',
  long: 'several hours ago',
  dormant: 'over a day ago',
  unknown: 'after a break',
});

// ── Internal coercion helpers (all total — never throw) ───────────────────────

/** Read one property without ever throwing (guards throwing getters / proxies /
 *  non-objects). */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** number | numeric-string → finite number; everything else (NaN/±Infinity/
 *  bigint/symbol/object/…) → null. Never throws. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Non-negative integer count; hostile / negative / non-numeric → 0. */
function toCount(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === null || n < 0) return 0;
  return Math.floor(n);
}

/** Lenient truthy read for a boolean-ish flag. Anything not clearly true → false. */
function truthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes' || t === 'on';
  }
  return false;
}

/** Byte-identical semantics to `now - askedAt < RESUMPTION_CLARIFICATION_FRESH_MS`
 *  for finite numbers; fails closed (false = stale) for anything unreadable so a
 *  pending action we cannot time is re-confirmed rather than acted on silently. */
function withinFreshWindow(askedAtMs: number | null, nowMs: number | null): boolean {
  if (askedAtMs === null || nowMs === null) return false;
  return nowMs - askedAtMs < RESUMPTION_CLARIFICATION_FRESH_MS;
}

/** Resolve elapsed ms: prefer now − lastActivity (clock-skew negative → 0),
 *  else the explicit elapsed fallback (must be >= 0), else null (unknown). */
function resolveElapsedMs(
  nowMs: number | null,
  lastActivityAtMs: number | null,
  elapsedFallback: number | null,
): number | null {
  if (nowMs !== null && lastActivityAtMs !== null) {
    const d = nowMs - lastActivityAtMs;
    if (Number.isFinite(d)) return d < 0 ? 0 : d;
  }
  if (elapsedFallback !== null && elapsedFallback >= 0) return elapsedFallback;
  return null;
}

/** Does the last-outcome label read as a failure? Non-strings → false. */
function isFailedOutcome(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  const key = v.trim().toLowerCase();
  if (!key) return false;
  return FAILED_OUTCOMES.has(key);
}

// ── Secret-safe text cleaning (inlined; keeps this core zero-runtime-import) ───

const HIDDEN = '[redacted]';

/**
 * True for injection / control / bidi / zero-width / line-separator code points
 * neutralized (→ space) before any span is emitted. Numeric ranges (no regex
 * literal) so the SOURCE stays free of the very invisible characters it guards
 * against. Keeps \t (0x09) \n (0x0a) \r (0x0d) — whitespace is collapsed later.
 */
function isDangerousCode(c: number): boolean {
  return (
    (c >= 0x00 && c <= 0x08)
    || c === 0x0b || c === 0x0c
    || (c >= 0x0e && c <= 0x1f)
    || c === 0x7f // DEL
    || (c >= 0x80 && c <= 0x9f) // C1 controls (incl. NEL 0x85)
    || c === 0x2028 || c === 0x2029 // line / paragraph separators
    || (c >= 0x200b && c <= 0x200f) // zero-width + LRM/RLM
    || (c >= 0x202a && c <= 0x202e) // bidi embeddings / overrides
    || c === 0x2060 // word joiner
    || (c >= 0x2066 && c <= 0x2069) // bidi isolates
    || c === 0xfeff // BOM / zero-width no-break space
    || (c >= 0xfff9 && c <= 0xfffb) // interlinear annotation
  );
}

/**
 * Replace every dangerous code point with a space and neutralize lone (unpaired)
 * surrogates so a truncated astral char can't leak a malformed unit. Valid
 * surrogate PAIRS (emoji / astral chars) are preserved intact. Total: never throws.
 */
function stripDangerous(input: string): string {
  try {
    let out = '';
    const len = input.length;
    for (let i = 0; i < len; i += 1) {
      const c = input.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff) {
        // High surrogate — valid only when immediately followed by a low surrogate.
        const next = i + 1 < len ? input.charCodeAt(i + 1) : 0;
        if (next >= 0xdc00 && next <= 0xdfff) {
          out += input.charAt(i) + input.charAt(i + 1);
          i += 1;
        } else {
          out += ' '; // lone high surrogate
        }
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) {
        out += ' '; // lone low surrogate
        continue;
      }
      out += isDangerousCode(c) ? ' ' : input.charAt(i);
    }
    return out;
  } catch {
    return input;
  }
}

/** Prompt-fence / tag chars neutralized so a span can't break out of a block. */
const FENCE_RE = /[<>`]/g;

/** Secret-shaped tokens → '[redacted]' (never echo a value that looks secret). */
const SECRET_PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT (3 segments)
  /\beyJ[A-Za-z0-9_-]{10,}/g, // bare JWT / base64url header segment
  /\bsk-[A-Za-z0-9_-]{12,}/gi, // sk-… / sk-ant-…
  /\bAKIA[0-9A-Z]{12,}\b/g, // AWS access key id
  /\bgh[posru]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi, // Slack tokens
  /-----BEGIN[A-Z0-9 ]+-----/g, // PEM header
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|bearer|authorization)\b\s*[:=]\s*[^\s'"]{6,}/gi,
  /\b[0-9a-fA-F]{32,}\b/g, // long hex run
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // long base64-ish run
];

function redactSecrets(input: string): string {
  let s = input;
  try {
    for (const re of SECRET_PATTERNS) {
      re.lastIndex = 0;
      s = s.replace(re, HIDDEN);
    }
  } catch {
    return input;
  }
  return s;
}

/** Does the whole (already control-stripped) string look like a bare secret VALUE? */
function looksLikeSecretValue(text: string): boolean {
  if (!text) return false;
  try {
    if (text.length > 40 && !/\s/.test(text)) return true; // long spaceless blob
    if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
    if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest
    if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
    if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-ant-… style
    if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub token
    if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack token
    if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
    if (/-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  } catch {
    return true; // fail closed: if the scan blows up, treat as secret
  }
  return false;
}

/** Code-point-aware truncation — never splits a surrogate pair. */
function clampCodePoints(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (max <= 0) return '';
  if (s.length <= max) return s; // UTF-16 length <= max ⇒ code-point count <= max
  try {
    const cps = Array.from(s);
    if (cps.length <= max) return s;
    return cps.slice(0, max).join('');
  } catch {
    return s.slice(0, max);
  }
}

/**
 * Flatten any input into ONE bounded, secret-safe line: coerce scalars, strip
 * control/bidi/zero-width + fence chars, collapse whitespace, redact
 * secret-shaped tokens, drop a wholly value-shaped span, clamp to `max`
 * code-points. Non-scalar / empty → ''. Total: never throws.
 */
function flatten(raw: unknown, max: number): string {
  try {
    let s: string;
    if (typeof raw === 'string') s = raw;
    else if (typeof raw === 'number' || typeof raw === 'boolean') s = String(raw);
    else return '';
    const capIn = Math.max(1, max) * 8;
    if (s.length > capIn) s = s.slice(0, capIn);
    s = stripDangerous(s).replace(FENCE_RE, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = redactSecrets(s);
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (looksLikeSecretValue(s)) return HIDDEN;
    return clampCodePoints(s, max);
  } catch {
    return '';
  }
}

/** Machine reason → lowercase [a-z0-9:_-], bounded, never empty. */
function sanitizeReason(reason: unknown): string {
  try {
    const s = (typeof reason === 'string' ? reason : '')
      .toLowerCase()
      .replace(/[^a-z0-9:_-]/g, '')
      .slice(0, MAX_REASON_LEN);
    return s || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Safe per-bucket phrase (guards the object-map lookup against hostile keys). */
function bucketPhrase(bucket: ElapsedBucket): string {
  if (Object.prototype.hasOwnProperty.call(BUCKET_PHRASE, bucket)) {
    return BUCKET_PHRASE[bucket];
  }
  return 'after a break';
}

// ── Directive assembly ────────────────────────────────────────────────────────

/** Final safety pass over an assembled directive: strip control/fence chars,
 *  collapse whitespace, clamp code-point-aware to MAX_DIRECTIVE_LEN. */
function finalizeDirective(raw: string): string {
  try {
    const s = stripDangerous(raw).replace(FENCE_RE, ' ').replace(/\s+/g, ' ').trim();
    return clampCodePoints(s, MAX_DIRECTIVE_LEN);
  } catch {
    return '';
  }
}

/** Build the bounded, secret-safe re-entry prompt block for a posture. */
function buildDirective(posture: ResumptionPosture, bucket: ElapsedBucket, label: string): string {
  const phrase = bucketPhrase(bucket);
  const withLabel = label ? ' (' + label + ')' : '';
  let raw: string;
  switch (posture) {
    case 'continue-silently':
      raw =
        'SESSION RESUME: Work is still in progress and almost no time has passed. '
        + 'Continue seamlessly and do NOT recap or re-introduce prior context.';
      break;
    case 'recap':
      raw =
        'SESSION RESUME: This thread was reopened ' + phrase + ' with work still open'
        + withLabel + '. Open with a one-line recap of where things stand, then continue.';
      break;
    case 'reconfirm':
      raw =
        'SESSION RESUME: A pending action from ' + phrase + ' is still open' + withLabel
        + '. Re-confirm it with the user before acting on it.';
      break;
    case 'reconfirm-stale-pending':
      raw =
        'SESSION RESUME: A pending action has gone stale' + withLabel
        + '. Do NOT act on it silently. Re-confirm the user still wants it, '
        + 'or treat it as expired and start clean.';
      break;
    case 'fresh-start':
    default:
      return '';
  }
  return finalizeDirective(raw);
}

/** The safe neutral decision (fresh-start; used on total failure). */
function neutralDecision(): SessionResumptionDecision {
  return {
    posture: 'fresh-start',
    elapsed: 'unknown',
    elapsedMs: null,
    clarificationStillFresh: false,
    approvalStillFresh: false,
    hasPendingAction: false,
    directive: '',
    reason: 'fresh-start:unknown:neutral',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Bucket an elapsed-ms gap into a coarse human-dormancy band. Boundaries are
 * exclusive-lower: exactly 120_000 → 'short', 900_000 → 'idle', 7_200_000 →
 * 'long', 86_400_000 → 'dormant'. Unreadable / negative → 'unknown'. Total.
 */
export function bucketElapsed(elapsedMs: unknown): ElapsedBucket {
  const n = toFiniteNumber(elapsedMs);
  if (n === null || n < 0) return 'unknown';
  if (n < ELAPSED_BRIEF_MAX_MS) return 'brief';
  if (n < ELAPSED_SHORT_MAX_MS) return 'short';
  if (n < ELAPSED_IDLE_MAX_MS) return 'idle';
  if (n < ELAPSED_LONG_MAX_MS) return 'long';
  return 'dormant';
}

/**
 * The precise, deterministic drop-in for the triplicated inline
 * `Date.now() - askedAt < 15 * 60 * 1000`. True iff a clarification asked at
 * `askedAtMs` is still within RESUMPTION_CLARIFICATION_FRESH_MS of `nowMs`.
 * Byte-identical to the old expression for finite numbers; fails closed
 * (false = treat as stale) for any unreadable input. Total: never throws.
 */
export function isPendingClarificationFresh(askedAtMs: unknown, nowMs: unknown): boolean {
  try {
    return withinFreshWindow(toFiniteNumber(askedAtMs), toFiniteNumber(nowMs));
  } catch {
    return false;
  }
}

/**
 * Decide the conversational re-entry posture for a re-opened session / resumed
 * run, plus a bounded secret-safe prompt directive to inject.
 *
 * Decision order (most-specific first):
 *   1. pending HITL action (clarification / approval):
 *        any present action stale        → reconfirm-stale-pending
 *        all fresh + brief gap           → continue-silently
 *        all fresh + a real gap          → reconfirm
 *   2. in-flight plan:  brief → continue-silently ; else → recap
 *   3. open tasks:      brief → continue-silently ; else → recap
 *   4. failed last outcome:              → recap
 *   5. otherwise (nothing in flight):    → fresh-start ('' directive)
 *
 * TOTAL: never throws; always returns a well-formed, bounded decision.
 */
export function decideSessionResumption(input: SessionResumptionInput): SessionResumptionDecision {
  try {
    const nowMs = toFiniteNumber(safeGet(input, 'nowMs'));
    const lastActivityAtMs = toFiniteNumber(safeGet(input, 'lastActivityAtMs'));
    const elapsedFallback = toFiniteNumber(safeGet(input, 'elapsedMs'));
    const resolvedElapsed = resolveElapsedMs(nowMs, lastActivityAtMs, elapsedFallback);
    const bucket = bucketElapsed(resolvedElapsed);
    const isBrief = bucket === 'brief';

    const clarAsked = toFiniteNumber(safeGet(input, 'pendingClarificationAskedAtMs'));
    const apprAsked = toFiniteNumber(safeGet(input, 'pendingApprovalRequestedAtMs'));
    const hasClar = clarAsked !== null;
    const hasAppr = apprAsked !== null;
    const clarificationStillFresh = hasClar ? withinFreshWindow(clarAsked, nowMs) : false;
    const approvalStillFresh = hasAppr ? withinFreshWindow(apprAsked, nowMs) : false;
    const hasPendingAction = hasClar || hasAppr;

    const openTaskCount = toCount(safeGet(input, 'openTaskCount'));
    const inFlightPlan = truthyFlag(safeGet(input, 'inFlightPlan'));
    const failedOutcome = isFailedOutcome(safeGet(input, 'lastOutcome'));
    const label = flatten(safeGet(input, 'lastActivityLabel'), MAX_LABEL_LEN);

    let posture: ResumptionPosture;
    let branch: string;

    if (hasPendingAction) {
      const anyStale = (hasClar && !clarificationStillFresh) || (hasAppr && !approvalStillFresh);
      const anyFresh = (hasClar && clarificationStillFresh) || (hasAppr && approvalStillFresh);
      if (anyStale) {
        // A stale pending action is the dangerous case — never continue silently.
        posture = 'reconfirm-stale-pending';
        branch = 'pending-stale';
      } else if (isBrief && anyFresh) {
        posture = 'continue-silently';
        branch = 'pending-fresh-brief';
      } else {
        posture = 'reconfirm';
        branch = 'pending-fresh';
      }
    } else if (inFlightPlan) {
      posture = isBrief ? 'continue-silently' : 'recap';
      branch = isBrief ? 'inflight-brief' : 'inflight';
    } else if (openTaskCount > 0) {
      posture = isBrief ? 'continue-silently' : 'recap';
      branch = isBrief ? 'open-tasks-brief' : 'open-tasks';
    } else if (failedOutcome) {
      posture = 'recap';
      branch = 'failed-outcome';
    } else {
      posture = 'fresh-start';
      branch = 'nothing';
    }

    if (!POSTURE_SET.has(posture)) posture = 'fresh-start';
    const directive = buildDirective(posture, bucket, label);
    const reason = sanitizeReason(posture + ':' + bucket + ':' + branch);

    return {
      posture,
      elapsed: bucket,
      elapsedMs: resolvedElapsed,
      clarificationStillFresh,
      approvalStillFresh,
      hasPendingAction,
      directive,
      reason,
    };
  } catch {
    return neutralDecision();
  }
}
