/**
 * toolReplaySafetyCore — the REPLAY-SAFETY gate for a failed, side-effecting
 * tool call. It answers ONE question the rest of the app never asks: "if we
 * re-issue this exact tool call, could we DOUBLE an external effect that may
 * have ALREADY landed?"
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * Every recovery path in the app decides "retry" on side-effect-BLIND grounds.
 * `swanbotToolErrorRecoveryCore.decideToolErrorRecovery` returns `retry` for any
 * transient error with no notion of what the tool mutated; `toolFailureFeedback`
 * literally tells the model "Transient error; a single retry is OK." The edge /
 * session retry loops are careful to note that the thing THEY retry (the
 * model-message fetch) is idempotent "so a retry can never double-execute a
 * tool" — but that reasoning does NOT extend to the actual tool dispatch, which
 * runs client-side after. So a NON-idempotent, side-effecting tool that fails
 * with an OUTCOME-UNKNOWN error (timeout AFTER the request was sent, 502/503/504,
 * connection reset mid-flight, aborted post-dispatch, empty body) can be blindly
 * replayed — and the effect may already have landed. Concrete double-effect
 * hazards across the live catalog: `git.run` push/commit, `gsheets.append_row`,
 * `gmail` send/draft, `gdocs` write, `local.run_shell` mutations, browser
 * fill/submit, integration action sends.
 *
 * The distinction between "the request never reached the target" (safe to replay
 * even a destructive write) and "the outcome is ambiguous" (replay may duplicate)
 * is the crux of safe retry. `wikiData.ts` already states the principle — "Retry
 * only when idempotency or fresh evidence prevents duplicate side effects" — but
 * no core implements it. This is that core. It is the ORTHOGONAL gate that
 * CONSTRAINS a `retry`: different inputs (side-effect class × failure disposition
 * × verification availability), different output (a replay-safety verdict). It
 * composes IN FRONT of `swanbotToolErrorRecoveryCore` without importing it.
 *
 * ─── The two axes ────────────────────────────────────────────────────────────
 *   side-effect class — what the tool DOES:
 *     read_only        no state change → replay can never double anything.
 *     idempotent_write same call → same end state (PUT/upsert) → replay-safe.
 *     unsafe_write     non-idempotent external mutation (send/append/commit/push).
 *     unknown          no metadata → treated conservatively, like unsafe_write.
 *   failure disposition — WHERE the failure happened relative to the effect:
 *     not_sent         request provably never reached the target (conn refused,
 *                      DNS/ENOTFOUND, bridge offline, client-side invalid_args,
 *                      pre-send 401/403) → no effect possible.
 *     outcome_unknown  request was/may have been sent, response lost/ambiguous
 *                      (timeout, 502/503/504, reset mid-flight, aborted, empty
 *                      body) → the effect MIGHT have landed. (Conservative
 *                      DEFAULT when the disposition is unclear.)
 *     rejected         target processed and explicitly declined (400/409/422) →
 *                      no partial effect.
 *
 * ─── Verdict table ───────────────────────────────────────────────────────────
 *   read_only | idempotent_write                     → replay_safe (any dispo).
 *   unsafe_write | unknown:
 *     not_sent                                        → replay_safe.
 *     rejected                                        → replay_safe.
 *     outcome_unknown + freshVerificationAvailable    → verify_first
 *                       (re-observe whether it landed, THEN retry only if not).
 *     outcome_unknown + no verification available     → unsafe_replay
 *                       (do NOT replay as-is; escalate to ask_user / skip / stop).
 *
 * ─── Purity (load-bearing) ───────────────────────────────────────────────────
 * ZERO runtime imports (structural inputs — the ToolParallelPolicy / MCP hint
 * fields are read off `unknown`, never imported). No `Date.now()` /
 * `Math.random()`. DETERMINISTIC. Every export is TOTAL: any hostile input
 * (null / undefined / wrong type / huge / throwing getter / circular / symbol /
 * function) yields a safe, bounded verdict, never a throw. FAIL-CLOSED: an
 * uncomputable decision returns `unsafe_replay` (never a silent blind replay).
 * BOUNDED + SECRET-SAFE: the `reason` is clamped and the ONLY echoed value — the
 * tool label — is sanitized (backticks / control / line-separator / bidi /
 * zero-width / fence chars stripped) and secret-shape-redacted; the raw error is
 * never echoed. Loadable under tsx/esbuild for smoke testing and safe in Deno
 * edge functions.
 */

// ─── Public types ────────────────────────────────────────────────────────────

/** What the tool DOES, on the "could a replay double an effect?" axis. */
export type ToolSideEffectClass = 'read_only' | 'idempotent_write' | 'unsafe_write' | 'unknown';

/** WHERE the failure happened relative to the side effect. */
export type ToolFailureDisposition = 'not_sent' | 'outcome_unknown' | 'rejected';

/** The replay-safety verdict that gates a `retry`. */
export type ToolReplaySafety = 'replay_safe' | 'verify_first' | 'unsafe_replay';

/**
 * The decision. `reason` is short, bounded, and secret-safe — safe to surface
 * into a loop event, a persisted run row, or a model-visible note.
 */
export interface ToolReplaySafetyDecision {
  safety: ToolReplaySafety;
  sideEffectClass: ToolSideEffectClass;
  disposition: ToolFailureDisposition;
  reason: string;
}

/**
 * Loosely-typed input (every field `unknown` — the loop passes raw runtime
 * values; this core coerces + validates defensively).
 *   sideEffect                 a canonical class string, a `ToolParallelPolicy`
 *                              ({mutatesState, externalSideEffect}), or MCP
 *                              annotation hints ({readOnlyHint, destructiveHint,
 *                              idempotentHint}). Absent/garbage → `unknown`.
 *   disposition                a canonical disposition string, an error-kind /
 *                              HTTP status / free-text, or an error object.
 *                              Unclear → `outcome_unknown` (conservative).
 *   freshVerificationAvailable true iff a read/observe tool exists to re-check
 *                              whether the effect landed (only literal `true`).
 *   toolName                   the tool's name (reason only — sanitized, never
 *                              trusted, never widens exposure).
 */
export interface ToolReplaySafetyInput {
  sideEffect?: unknown;
  disposition?: unknown;
  freshVerificationAvailable?: unknown;
  toolName?: unknown;
}

// ─── Bounds (exported caps) ──────────────────────────────────────────────────
/** Hard cap on the emitted reason (it flows verbatim into events / run rows). */
export const MAX_REPLAY_REASON_LENGTH = 200;
/** Longest slice of a tool name echoed into the reason. */
export const MAX_REPLAY_TOOL_LABEL_LENGTH = 48;
/** Free-text / label is clamped to this before any scan (megabyte-input guard). */
export const MAX_REPLAY_SCAN_LENGTH = 200;

// ─── Total helpers ───────────────────────────────────────────────────────────

/** String() that never throws (throwing toString, Symbol under `'' + sym`).
 *  null/undefined collapse to ''. */
function safeStr(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    return '';
  }
}

function clampStr(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** Read a property off an unknown value without ever throwing (throwing getters
 *  / Proxies are caught). Non-objects (except functions) read as undefined. */
function safeGet(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Collapse a value to a canonical lowercase token: non-alphanumeric runs → `_`,
 *  edge `_` stripped. Bounded first so a huge string can't slow the work. */
function normalizeToken(value: unknown): string {
  const raw = clampStr(safeStr(value), MAX_REPLAY_SCAN_LENGTH).toLowerCase().trim();
  if (!raw) return '';
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Coerce a value to a finite HTTP-status number (a number, or a 3-digit
 *  numeric string), else undefined. */
function toStatus(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (/^\d{3}$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Best-effort status parse from free text: a bare 3-digit body, or a
 *  "status code NNN" / "http NNN" phrase. Deliberately does NOT match bare
 *  embedded numbers (avoids false positives on token counts / durations). */
function statusFromText(msg: string): number | undefined {
  if (!msg) return undefined;
  const whole = msg.trim();
  if (/^\d{3}$/.test(whole)) {
    const n = Number(whole);
    if (n >= 100 && n <= 599) return n;
  }
  const m = msg.match(/(?:status(?:\s*code)?|http)\s*[:=]?\s*(\d{3})/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 100 && n <= 599) return n;
  }
  return undefined;
}

// ─── Secret-safe tool label ──────────────────────────────────────────────────

/** Common secret shapes — if a tool label matches any, it is redacted rather
 *  than echoed. Tool names are never actually secrets; this is defense-in-depth
 *  for the SECRET-SAFE guarantee against a hostile `toolName`. Compiled once. */
const SECRET_SHAPE_RES: readonly RegExp[] = [
  /sk-[a-z0-9-]{12,}/i, // OpenAI / Anthropic keys (sk-, sk-ant-)
  /\bgh[opsur]_[a-z0-9]{16,}/i, // GitHub tokens (ghp_/gho_/ghs_/ghu_/ghr_)
  /\bxox[baprs]-[a-z0-9-]{8,}/i, // Slack tokens
  /\bAKIA[0-9A-Z]{12,}/, // AWS access key id
  /\bAIza[0-9a-z_-]{16,}/i, // Google API key
  /eyJ[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}\.[a-z0-9_-]{6,}/i, // JWT
  /\bbearer\s+[a-z0-9._-]{12,}/i, // bearer token
  /[a-f0-9]{40,}/i, // long hex run (sha/token)
];

function looksSecret(s: string): boolean {
  for (const re of SECRET_SHAPE_RES) {
    if (re.test(s)) return true;
  }
  return false;
}

/**
 * A safe, bounded label for the tool, e.g. "git.run", else "the tool". Strips
 * backticks, C0/C1 control chars, DEL, angle-bracket fences, Unicode line/para
 * separators, and zero-width / bidi marks so a model-authored name can neither
 * break the reason formatting nor smuggle content. Uses charCodeAt (not a
 * control-char regex literal) so this source file stays pure ASCII. A
 * secret-shaped label is redacted entirely.
 *
 * NOTE: unlike `swanbotToolErrorRecoveryCore.sanitizeToolLabel`, the result is
 * NOT wrapped in backticks — the emitted `reason` is deliberately backtick-free,
 * so no fence char (injected or formatting) can ever appear in it.
 */
function sanitizeToolLabel(toolName: unknown): string {
  // Scan a wider window (up to the scan cap) for secret shapes BEFORE clamping to
  // the label width — a truncated secret can lose the pattern that identifies it
  // (e.g. a JWT's three dot-segments) yet still leak a sensitive prefix.
  const raw = clampStr(safeStr(toolName), MAX_REPLAY_SCAN_LENGTH);
  let stripped = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    const unsafe =
      c <= 0x1f || // C0 controls (incl. NUL / tab / newline)
      c === 0x7f || // DEL
      (c >= 0x80 && c <= 0x9f) || // C1 controls
      c === 0x60 || // backtick
      c === 0x3c || // <
      c === 0x3e || // >
      c === 0x2028 || // line separator
      c === 0x2029 || // paragraph separator
      (c >= 0x200b && c <= 0x200f) || // zero-width + bidi marks
      (c >= 0x202a && c <= 0x202e) || // bidi embedding / override
      c === 0xfeff; // BOM / zero-width no-break space
    stripped += unsafe ? ' ' : raw[i];
  }
  const strippedTrimmed = stripped.replace(/\s+/g, ' ').trim();
  if (!strippedTrimmed || looksSecret(strippedTrimmed)) return 'the tool';
  const clamped = clampStr(strippedTrimmed, MAX_REPLAY_TOOL_LABEL_LENGTH).trim();
  if (!clamped || looksSecret(clamped)) return 'the tool';
  return clamped;
}

// ─── Side-effect classification ──────────────────────────────────────────────

const SIDE_EFFECT_CLASSES: ReadonlySet<string> = new Set<ToolSideEffectClass>([
  'read_only',
  'idempotent_write',
  'unsafe_write',
  'unknown',
]);

/**
 * Alias table for a canonical side-effect STRING (after {@link normalizeToken}).
 * Ambiguous writes map to `unsafe_write` — the SAFE direction (a bare "write"
 * with no idempotency claim must be gated). Frozen; no per-call allocation.
 */
const SIDE_EFFECT_ALIASES: Readonly<Record<string, ToolSideEffectClass>> = {
  read_only: 'read_only',
  readonly: 'read_only',
  read: 'read_only',
  reads: 'read_only',
  ro: 'read_only',
  observe: 'read_only',
  query: 'read_only',
  idempotent_write: 'idempotent_write',
  idempotent: 'idempotent_write',
  idempotentwrite: 'idempotent_write',
  upsert: 'idempotent_write',
  unsafe_write: 'unsafe_write',
  unsafe: 'unsafe_write',
  unsafewrite: 'unsafe_write',
  destructive: 'unsafe_write',
  mutate: 'unsafe_write',
  mutates: 'unsafe_write',
  mutating: 'unsafe_write',
  write: 'unsafe_write',
  writes: 'unsafe_write',
  external: 'unsafe_write',
  externalsideeffect: 'unsafe_write',
  side_effect: 'unsafe_write',
  sideeffect: 'unsafe_write',
  unknown: 'unknown',
  unclassified: 'unknown',
  unspecified: 'unknown',
};

function classifySideEffectString(value: string): ToolSideEffectClass {
  const token = normalizeToken(value);
  if (!token) return 'unknown';
  if (SIDE_EFFECT_CLASSES.has(token)) return token as ToolSideEffectClass;
  // Own-property guard: SIDE_EFFECT_ALIASES is a plain object literal, so a bare
  // `[token]` walks Object.prototype and would return an inherited member for a
  // token like `constructor` (the Object function) — breaking the TOTAL/enum
  // contract. Only accept the map's own keys; anything else falls through.
  const alias = Object.prototype.hasOwnProperty.call(SIDE_EFFECT_ALIASES, token)
    ? SIDE_EFFECT_ALIASES[token]
    : undefined;
  return alias ?? 'unknown';
}

/**
 * Classify a structural side-effect descriptor: `ToolParallelPolicy`
 * ({mutatesState, externalSideEffect}) and/or MCP annotation hints
 * ({readOnlyHint, destructiveHint, idempotentHint}). Cascade (spec order):
 *   read_only        readOnlyHint===true, OR (mutatesState===false AND
 *                    externalSideEffect===false).
 *   idempotent_write idempotentHint===true AND destructiveHint!==true.
 *   unsafe_write     destructiveHint===true, OR externalSideEffect===true, OR
 *                    (mutatesState===true without an idempotent hint).
 *   unknown          otherwise (no decisive metadata).
 * Only literal booleans count, so a missing / garbage field never flips a class.
 */
function classifySideEffectStruct(obj: unknown): ToolSideEffectClass {
  const readOnlyHint = safeGet(obj, 'readOnlyHint');
  const destructiveHint = safeGet(obj, 'destructiveHint');
  const idempotentHint = safeGet(obj, 'idempotentHint');
  const mutatesState = safeGet(obj, 'mutatesState');
  const externalSideEffect = safeGet(obj, 'externalSideEffect');

  if (readOnlyHint === true) return 'read_only';
  if (mutatesState === false && externalSideEffect === false) return 'read_only';

  if (idempotentHint === true && destructiveHint !== true) return 'idempotent_write';

  if (destructiveHint === true) return 'unsafe_write';
  if (externalSideEffect === true) return 'unsafe_write';
  if (mutatesState === true && idempotentHint !== true) return 'unsafe_write';

  return 'unknown';
}

/**
 * Normalize any side-effect descriptor into a {@link ToolSideEffectClass}.
 * Accepts a canonical/alias string, a `ToolParallelPolicy`, or MCP annotation
 * hints. TOTAL: hostile input yields `unknown` (the conservative class), never
 * throws.
 */
export function classifyToolSideEffect(sideEffect: unknown): ToolSideEffectClass {
  try {
    if (typeof sideEffect === 'string') return classifySideEffectString(sideEffect);
    if (sideEffect !== null && (typeof sideEffect === 'object' || typeof sideEffect === 'function')) {
      return classifySideEffectStruct(sideEffect);
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ─── Failure-disposition classification ──────────────────────────────────────

/**
 * Alias table for a canonical disposition STRING (after {@link normalizeToken}).
 * A bare `unknown` maps to `outcome_unknown` — the conservative default.
 */
const DISPOSITION_ALIASES: Readonly<Record<string, ToolFailureDisposition>> = {
  not_sent: 'not_sent',
  notsent: 'not_sent',
  unsent: 'not_sent',
  never_sent: 'not_sent',
  not_reached: 'not_sent',
  unreached: 'not_sent',
  outcome_unknown: 'outcome_unknown',
  outcomeunknown: 'outcome_unknown',
  unknown_outcome: 'outcome_unknown',
  unknown: 'outcome_unknown',
  ambiguous: 'outcome_unknown',
  indeterminate: 'outcome_unknown',
  rejected: 'rejected',
  declined: 'rejected',
};

// Message keyword matchers (word-bounded where a bare substring would
// false-positive). Compiled once at module scope — no per-call allocation.
const NOT_SENT_RE =
  /econnrefused|connection refused|\brefused\b|enotfound|getaddrinfo|\bdns\b|bridge (?:offline|not ready|unavailable|down)|not reached|never reached|\bunreached\b|never sent|\bunsent\b|client[ _-]?side validation|pre[ _-]?send|presend|invalid[_ ]arg|invalid[_ ]input|invalid[_ ]param|bad[_ ]arg|unauthenticated|unauthorized|\bforbidden\b|permission denied|access denied|invalid[ _-]?api[ _-]?key|missing[ _-]?api[ _-]?key/;
const REJECTED_RE =
  /\bconflict\b|already exists|\bduplicate\b|duplicate key|unprocessable|\bvalidation\b|bad request|\brejected\b|\bdeclined\b|not acceptable|precondition failed/;
const OUTCOME_UNKNOWN_RE =
  /timeout|timed ?out|etimedout|econnreset|connection reset|reset by peer|\breset\b|socket hang ?up|\bhang ?up\b|\babort|\bempty\b|empty body|empty response|no response|no body|bad gateway|gateway timeout|\bgateway\b|mid[ _-]?flight|in[ _-]?flight|unknown outcome|outcome unknown|\bambiguous\b|may have (?:landed|applied)|\bcanceled\b|\bcancelled\b/;

/** 5xx (and 408 request-timeout) → the effect might have landed server-side. */
function statusIsOutcomeUnknown(s: number | undefined): boolean {
  if (s === undefined) return false;
  if (s === 408) return true;
  return s >= 500 && s <= 599;
}
/** 401 / 403 auth gates reject BEFORE any side effect → not_sent. */
function statusIsNotSent(s: number | undefined): boolean {
  return s === 401 || s === 403;
}
/** 400 / 404 / 409 / 422 — target processed and declined, no partial effect. */
function statusIsRejected(s: number | undefined): boolean {
  return s === 400 || s === 404 || s === 409 || s === 422;
}

/** Pull a numeric HTTP status out of the common error shapes; never throws. */
function dispoStatus(v: unknown): number | undefined {
  const direct = toStatus(v);
  if (direct !== undefined) return direct;
  if (!isRecord(v)) return undefined;
  const s =
    toStatus(safeGet(v, 'status')) ??
    toStatus(safeGet(v, 'statusCode')) ??
    toStatus(safeGet(v, 'status_code')) ??
    toStatus(safeGet(v, 'code'));
  if (s !== undefined) return s;
  const resp = safeGet(v, 'response');
  if (isRecord(resp)) {
    const rs = toStatus(safeGet(resp, 'status')) ?? toStatus(safeGet(resp, 'statusCode'));
    if (rs !== undefined) return rs;
  }
  return undefined;
}

/** Build a single lowercased, length-bounded haystack from a string, primitive,
 *  or error object. Each field is clamped so a hostile megabyte field is cheap. */
function dispoText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return clampStr(v, MAX_REPLAY_SCAN_LENGTH).toLowerCase();
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v).toLowerCase();
  }
  if (!isRecord(v) && typeof v !== 'function') return ''; // symbol
  const parts: string[] = [];
  const push = (x: unknown): void => {
    if (typeof x === 'string' && x) parts.push(clampStr(x, MAX_REPLAY_SCAN_LENGTH));
  };
  push(safeGet(v, 'message'));
  push(safeGet(v, 'code'));
  push(safeGet(v, 'type'));
  push(safeGet(v, 'name'));
  push(safeGet(v, 'reason'));
  push(safeGet(v, 'disposition'));
  push(safeGet(v, 'errorKind'));
  push(safeGet(v, 'kind'));
  const inner = safeGet(v, 'error');
  if (isRecord(inner)) {
    push(safeGet(inner, 'message'));
    push(safeGet(inner, 'code'));
    push(safeGet(inner, 'type'));
  } else if (typeof inner === 'string') {
    push(inner);
  }
  return clampStr(parts.join(' '), MAX_REPLAY_SCAN_LENGTH).toLowerCase();
}

/**
 * Classify any failure descriptor into a {@link ToolFailureDisposition}.
 * Accepts a canonical/alias string, an HTTP status (number or 3-digit string),
 * free text, or an error object. Precedence is CONSERVATIVE: an outcome_unknown
 * signal dominates (so an ambiguous-plus-anything failure is treated as "the
 * effect might have landed"). The DEFAULT when nothing is decisive is
 * `outcome_unknown`. TOTAL: hostile input yields `outcome_unknown`, never throws.
 */
export function classifyFailureDisposition(disposition: unknown): ToolFailureDisposition {
  try {
    if (typeof disposition === 'string') {
      // Own-property guard: DISPOSITION_ALIASES is a plain object literal, so a
      // bare `[token]` walks Object.prototype and would return an inherited
      // member for a token like `constructor` (the Object function) — breaking
      // the TOTAL/enum contract. Only accept the map's own keys.
      const token = normalizeToken(disposition);
      const alias = Object.prototype.hasOwnProperty.call(DISPOSITION_ALIASES, token)
        ? DISPOSITION_ALIASES[token]
        : undefined;
      if (alias) return alias;
    }
    const text = dispoText(disposition);
    const status = dispoStatus(disposition) ?? statusFromText(text);

    // Conservative ordering: outcome_unknown wins whenever it is signalled.
    if (statusIsOutcomeUnknown(status) || OUTCOME_UNKNOWN_RE.test(text)) return 'outcome_unknown';
    if (statusIsNotSent(status) || NOT_SENT_RE.test(text)) return 'not_sent';
    if (statusIsRejected(status) || REJECTED_RE.test(text)) return 'rejected';
    return 'outcome_unknown';
  } catch {
    return 'outcome_unknown';
  }
}

// ─── Decision ────────────────────────────────────────────────────────────────

function decision(
  safety: ToolReplaySafety,
  sideEffectClass: ToolSideEffectClass,
  disposition: ToolFailureDisposition,
  reason: string,
): ToolReplaySafetyDecision {
  return { safety, sideEffectClass, disposition, reason: clampStr(reason, MAX_REPLAY_REASON_LENGTH) };
}

/**
 * Decide whether a failed tool call may be replayed AS-IS. This is the gate that
 * constrains a `retry`: see the module header for the full verdict table.
 *
 * TOTAL: never throws. FAIL-CLOSED: any input or decision that cannot be
 * computed returns `unsafe_replay` — never a silent blind replay of a
 * potentially-already-landed side effect.
 */
export function decideToolReplaySafety(input: ToolReplaySafetyInput): ToolReplaySafetyDecision {
  try {
    const src: unknown = input;
    const sideEffectClass = classifyToolSideEffect(safeGet(src, 'sideEffect'));
    const disposition = classifyFailureDisposition(safeGet(src, 'disposition'));
    const freshVerification = safeGet(src, 'freshVerificationAvailable') === true;
    const tool = sanitizeToolLabel(safeGet(src, 'toolName'));

    // read_only / idempotent_write: replaying can never double an effect.
    if (sideEffectClass === 'read_only') {
      return decision(
        'replay_safe',
        sideEffectClass,
        disposition,
        `${tool} is read-only — replaying cannot double an effect (safe to retry as-is).`,
      );
    }
    if (sideEffectClass === 'idempotent_write') {
      return decision(
        'replay_safe',
        sideEffectClass,
        disposition,
        `${tool} is an idempotent write — a replay converges to the same state (safe to retry as-is).`,
      );
    }

    // unsafe_write | unknown — the disposition decides.
    if (disposition === 'not_sent') {
      return decision(
        'replay_safe',
        sideEffectClass,
        disposition,
        `${tool} never reached the target, so no effect could have landed — safe to replay.`,
      );
    }
    if (disposition === 'rejected') {
      return decision(
        'replay_safe',
        sideEffectClass,
        disposition,
        `${tool} was declined with no partial effect — safe to replay.`,
      );
    }

    // disposition === 'outcome_unknown' → the effect MIGHT have landed.
    if (freshVerification) {
      return decision(
        'verify_first',
        sideEffectClass,
        disposition,
        `${tool} outcome is unknown and its effect may have landed — re-observe first, then retry only if it did not.`,
      );
    }
    return decision(
      'unsafe_replay',
      sideEffectClass,
      disposition,
      `${tool} may have already applied a side effect and cannot be verified — do not replay as-is; escalate.`,
    );
  } catch {
    // Fail closed: an uncomputable decision refuses the replay.
    return {
      safety: 'unsafe_replay',
      sideEffectClass: 'unknown',
      disposition: 'outcome_unknown',
      reason: 'replay safety could not be decided — failing closed (do not replay as-is).',
    };
  }
}

/** Convenience predicate: true iff the verdict is `replay_safe`. TOTAL. */
export function isReplaySafe(input: ToolReplaySafetyInput): boolean {
  try {
    return decideToolReplaySafety(input).safety === 'replay_safe';
  } catch {
    return false;
  }
}
