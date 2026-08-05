/**
 * swanbotToolErrorRecoveryCore — the LOOP-level decision for what to do when a
 * single tool call ERRORS mid-turn.
 *
 * ─── Why this exists ─────────────────────────────────────────────────────────
 * `agentExecutionCore.runAgent` dispatches tools and, on `!result.ok`, wraps the
 * error with a recovery preamble (`toolFailureFeedback.buildToolFailureFeedback`)
 * and lets the model try again — bounded only by the exact-repeat / oscillation
 * stuck guards (`toolLoopStuckCore.detectRepeatedToolFailure`,
 * `oscillationDetectorCore.detectOscillatingFailure`) and the iteration cap. That
 * is effectively a BLANKET "retry, then eventually hard-stop".
 *
 * But not every tool error deserves the same move:
 *   - a TRANSIENT wobble (bridge not ready yet, 5xx, timeout, reset) is worth
 *     re-running the SAME call — it may clear on its own;
 *   - INVALID ARGUMENTS mean re-running unchanged will fail identically; the
 *     model must FIX the arguments first;
 *   - an AUTH / PERMISSION failure keeps failing until a human supplies a
 *     credential or approval — retrying just burns rounds; ASK the user;
 *   - a NOT-FOUND target when an ALTERNATIVE approach exists is best SKIPPED
 *     (take the other route) rather than retried against a target that is absent;
 *   - once attempts are EXHAUSTED with nothing left to try, ABORT.
 *
 * This core turns those into ONE deterministic decision the loop can act on. It
 * is DISTINCT from `failureRecoveryCopyCore` (which produces USER-FACING copy for
 * a whole-turn failure — title/message/action) — this is the machine decision
 * INSIDE the tool loop. The `errorKind` vocabulary is the coarse
 * loop-facing bucket, deliberately compatible with the classes that
 * `providerErrorAdvanceCore.classifyProviderError` and
 * `failureRecoveryCopyCore.classifyFailure` already emit (rate_limit/overload/
 * network/timeout collapse to `transient`; 401/api-key → `auth`; 403/forbidden →
 * `permission`; 404/missing → `not_found`; 400/validation → `invalid_args`).
 *
 * ─── Action semantics (why the cap applies where it does) ────────────────────
 *   retry          re-dispatch the SAME call unchanged   → re-enters loop → CAPPED
 *   retry_with_fix re-dispatch after the model CHANGES input/target → CAPPED
 *   skip           abandon THIS call, take another route  → loop-breaking → uncapped
 *   ask_user       stop and ask a human                   → loop-breaking → uncapped
 *   abort          give up on this tool                   → terminal
 * The attempt cap only governs the two LOOPING actions (retry / retry_with_fix);
 * the loop-breaking ones (skip / ask_user) are terminal for THIS call, so an
 * attempt ceiling on them would be meaningless. When a looping action's attempts
 * are exhausted, an available alternative is preferred (skip) over a dead stop
 * (abort) — so `hasAlternative` stays meaningful past the cap.
 *
 * ─── Purity (load-bearing) ───────────────────────────────────────────────────
 * ZERO imports. No `Date.now()` / `Math.random()`. Deterministic. Every export is
 * TOTAL: any hostile input (null / undefined / wrong type / huge / throwing
 * getter / circular / symbol / function) yields a safe neutral decision, never a
 * throw. Output is bounded — a small enum action + a clamped, secret-safe reason.
 * Loadable under tsx/esbuild for smoke testing and safe in Deno edge functions.
 */

/**
 * Coarse loop-facing bucket for a tool error. The five named buckets are the
 * ones the loop can act on differently; anything unrecognized is `unknown`
 * (handled conservatively, like a change-your-approach recoverable).
 *
 *   transient    → wobble that may clear on a same-call retry (5xx, timeout,
 *                  reset, rate-limit, overload, bridge-not-ready).
 *   not_found    → the target does not exist (yet). A same-call retry is
 *                  pointless; take an alternative, or re-observe + fix the target.
 *   auth         → 401 / bad-or-missing credential. A human must fix it.
 *   invalid_args → the model malformed the tool input (400 / validation /
 *                  schema). Re-running unchanged re-fails; fix the args first.
 *   permission   → 403 / forbidden / policy block. Needs approval or access.
 *   unknown      → unclassifiable — treated conservatively.
 */
export type ToolErrorKind =
  | 'transient'
  | 'not_found'
  | 'auth'
  | 'invalid_args'
  | 'permission'
  | 'unknown';

/** The loop-control action the tool loop should take for a failed call. */
export type ToolErrorRecoveryAction =
  | 'retry'
  | 'retry_with_fix'
  | 'skip'
  | 'ask_user'
  | 'abort';

/**
 * Loosely-typed input (every field `unknown` — the loop passes raw runtime
 * values; this core coerces + validates defensively).
 *   errorKind      one of the {@link ToolErrorKind} buckets, an alias, or free
 *                  text (best-effort classified via {@link normalizeToolErrorKind}).
 *   attempts       how many times this tool call has ALREADY been attempted and
 *                  failed (>= 1 for a real failure). Absent/invalid → treated as
 *                  1. A numeric string ("2") is coerced. Clamped + bounded.
 *   toolName       the tool's name (only for the human-readable reason; sanitized
 *                  + clamped — never trusted, never widens exposure).
 *   hasAlternative true iff a DIFFERENT approach/route to the goal remains (only
 *                  literal `true` counts). Enables `skip` instead of a dead stop.
 */
export interface ToolErrorRecoveryInput {
  errorKind?: unknown;
  attempts?: unknown;
  toolName?: unknown;
  hasAlternative?: unknown;
}

/**
 * The decision. `action` is always one of the five valid actions; `reason` is a
 * short, bounded, secret-safe explanation safe to surface into a loop event, a
 * persisted run row, or a model-visible note.
 */
export interface ToolErrorRecoveryDecision {
  action: ToolErrorRecoveryAction;
  reason: string;
}

/**
 * Max attempts a single tool call gets before the LOOPING recoveries (retry /
 * retry_with_fix) give up. Mirrors the ~3-strike window the exact-repeat guard
 * uses in `agentExecutionCore` ("re-sampling the SAME failing call ~3 rounds in
 * a row"). At `attempts >= TOOL_ERROR_MAX_ATTEMPTS` a looping recovery converts
 * to `skip` (if an alternative exists) or `abort`.
 */
export const TOOL_ERROR_MAX_ATTEMPTS = 3;

// ─── Internal bounds (defensive clamps) ──────────────────────────────────────
/** Attempts read from a real failure default to 1 (at least one attempt happened). */
const DEFAULT_ATTEMPTS = 1;
/** Upper clamp on the attempt count so a hostile huge value stays bounded. */
const ATTEMPTS_CLAMP_MAX = 9999;
/** Longest slice of a model-authored tool name echoed into the reason. */
const TOOL_LABEL_MAX = 48;
/** errorKind text is clamped before matching so a megabyte string can't slow work. */
const KIND_SCAN_MAX = 200;
/** Hard cap on the emitted reason (it flows verbatim into events / run rows). */
const REASON_MAX = 200;

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

/** Read a property off an unknown value without ever throwing (throwing
 *  getters / Proxies are caught). Non-objects read as undefined. */
function safeGet(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

// ── errorKind normalization ──────────────────────────────────────────────────

const CANONICAL_KINDS: ReadonlySet<string> = new Set<ToolErrorKind>([
  'transient',
  'not_found',
  'auth',
  'invalid_args',
  'permission',
  'unknown',
]);

/**
 * Alias table: an exact canonical token (lowercased, non-alphanumeric runs →
 * single `_`, trimmed) → its bucket. Covers the vocabularies of
 * `providerErrorAdvanceCore` (rate_limit/overload/transient/not_found/auth) and
 * `failureRecoveryCopyCore` (network/timeout/rate_limit/permission/…), plus bare
 * HTTP statuses, so a caller can pass whatever classification it already has.
 */
const KIND_ALIASES: Readonly<Record<string, ToolErrorKind>> = {
  // transient (retry the same call)
  transient: 'transient',
  rate_limit: 'transient',
  rate_limited: 'transient',
  ratelimit: 'transient',
  ratelimited: 'transient',
  overload: 'transient',
  overloaded: 'transient',
  timeout: 'transient',
  timed_out: 'transient',
  network: 'transient',
  network_error: 'transient',
  temporary: 'transient',
  temporarily_unavailable: 'transient',
  unavailable: 'transient',
  service_unavailable: 'transient',
  retryable: 'transient',
  econnreset: 'transient',
  econnrefused: 'transient',
  etimedout: 'transient',
  enotfound: 'transient', // DNS wobble, NOT a "not found" target
  bridge_offline: 'transient',
  edge_5xx: 'transient',
  '429': 'transient',
  '529': 'transient',
  '500': 'transient',
  '502': 'transient',
  '503': 'transient',
  '504': 'transient',
  // not_found (target absent)
  not_found: 'not_found',
  notfound: 'not_found',
  missing: 'not_found',
  no_such: 'not_found',
  does_not_exist: 'not_found',
  unknown_target: 'not_found',
  unknown_element: 'not_found',
  '404': 'not_found',
  // auth (credential problem — ask user)
  auth: 'auth',
  authentication: 'auth',
  authentication_error: 'auth',
  unauthorized: 'auth',
  unauthenticated: 'auth',
  invalid_api_key: 'auth',
  api_key: 'auth',
  apikey: 'auth',
  token_expired: 'auth',
  expired_token: 'auth',
  session_expired: 'auth',
  '401': 'auth',
  // invalid_args (fix the input)
  invalid_args: 'invalid_args',
  invalid_arg: 'invalid_args',
  invalid_arguments: 'invalid_args',
  invalid_argument: 'invalid_args',
  invalid_input: 'invalid_args',
  invalid_params: 'invalid_args',
  invalid_parameters: 'invalid_args',
  bad_args: 'invalid_args',
  bad_arguments: 'invalid_args',
  bad_request: 'invalid_args',
  validation: 'invalid_args',
  validation_error: 'invalid_args',
  malformed: 'invalid_args',
  schema: 'invalid_args',
  schema_error: 'invalid_args',
  '400': 'invalid_args',
  '422': 'invalid_args',
  // permission (approval / access — ask user)
  permission: 'permission',
  permission_denied: 'permission',
  forbidden: 'permission',
  denied: 'permission',
  access_denied: 'permission',
  not_allowed: 'permission',
  not_permitted: 'permission',
  policy_block: 'permission',
  '403': 'permission',
};

/**
 * Best-effort classify any `errorKind` value into a {@link ToolErrorKind}.
 * Deterministic: exact canonical → alias table → word-bounded keyword scan (auth
 * / permission before the broader buckets so "invalid api key" reads as auth, not
 * invalid_args) → `unknown`. TOTAL: hostile input yields `unknown`, never throws.
 */
export function normalizeToolErrorKind(errorKind: unknown): ToolErrorKind {
  try {
    const raw = clampStr(safeStr(errorKind), KIND_SCAN_MAX).toLowerCase().trim();
    if (!raw) return 'unknown';
    // Canonical token: collapse non-alphanumeric runs to `_`, strip edge `_`.
    const token = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!token) return 'unknown';
    if (CANONICAL_KINDS.has(token)) return token as ToolErrorKind;
    const alias = KIND_ALIASES[token];
    if (alias) return alias;

    // Keyword fallback for looser free-text. Operate on a space-separated form
    // so `\b` word boundaries behave. Precedence encodes the tricky overlaps:
    // auth ("invalid api key") before invalid_args; permission before not_found.
    const words = ` ${token.replace(/_/g, ' ')} `;
    if (/\b(?:unauthor\w*|unauthenticated|authenticat\w*|api key|apikey|401)\b/.test(words)) return 'auth';
    if (/\b(?:forbidden|permission\w*|denied|not allowed|not permitted|policy block|403)\b/.test(words)) {
      return 'permission';
    }
    if (/\b(?:invalid (?:arg\w*|input|param\w*|request|json|body)|bad (?:arg\w*|request)|validation|malformed|schema|400|422)\b/.test(words)) {
      return 'invalid_args';
    }
    if (/\b(?:not found|no such|does not exist|doesnt exist|missing|unknown (?:target|element|selector)|404)\b/.test(words)) {
      return 'not_found';
    }
    if (/\b(?:transient|rate\w*|overload\w*|timeout|timed out|network|temporar\w*|unavailable|econn\w*|etimedout|reset|429|529|500|502|503|504)\b/.test(words)) {
      return 'transient';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ── attempts normalization ────────────────────────────────────────────────────

/** Coerce `attempts` to a bounded non-negative integer; absent/invalid → default
 *  (a real failure implies at least one attempt). A numeric string is accepted. */
function normalizeAttempts(attempts: unknown): number {
  try {
    if (typeof attempts === 'number' && Number.isFinite(attempts)) {
      const n = Math.floor(attempts);
      if (n < 0) return 0;
      return n > ATTEMPTS_CLAMP_MAX ? ATTEMPTS_CLAMP_MAX : n;
    }
    if (typeof attempts === 'string') {
      const t = attempts.trim();
      if (/^\d{1,7}$/.test(t)) {
        const n = Number(t);
        if (Number.isFinite(n)) return n > ATTEMPTS_CLAMP_MAX ? ATTEMPTS_CLAMP_MAX : n;
      }
    }
    return DEFAULT_ATTEMPTS;
  } catch {
    return DEFAULT_ATTEMPTS;
  }
}

// ── tool label (reason only — sanitized, never trusted) ───────────────────────

/** A safe, bounded label for the tool, e.g. "`click_element`", else "the tool".
 *  Strips backticks + control chars so a model-authored name can't break the
 *  reason formatting or smuggle content. Uses charCodeAt (not a control-char
 *  regex literal) so this source file stays pure ASCII. */
function sanitizeToolLabel(toolName: unknown): string {
  const raw = clampStr(safeStr(toolName), TOOL_LABEL_MAX * 2);
  let stripped = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw.charCodeAt(i);
    // Backtick (0x60), C0 control chars (<= 0x1F), and DEL (0x7F) → space.
    stripped += c <= 0x1f || c === 0x7f || c === 0x60 ? ' ' : raw[i];
  }
  const clamped = clampStr(stripped.replace(/\s+/g, ' ').trim(), TOOL_LABEL_MAX).trim();
  return clamped ? `\`${clamped}\`` : 'the tool';
}

function decision(action: ToolErrorRecoveryAction, reason: string): ToolErrorRecoveryDecision {
  return { action, reason: clampStr(reason, REASON_MAX) };
}

/**
 * Decide the loop-control move for a tool call that just ERRORED mid-turn.
 *
 * Rules (see the module header for the "why the cap applies where" rationale):
 *   - auth / permission            → ask_user  (a human must fix it; uncapped)
 *   - not_found + hasAlternative   → skip      (take the other route; uncapped)
 *   - transient, attempts left     → retry     (re-run the same call)
 *   - invalid_args, attempts left  → retry_with_fix (correct the input)
 *   - not_found (no alt), left     → retry_with_fix (re-observe + fix the target)
 *   - unknown, attempts left       → retry_with_fix (change approach)
 *   - exhausted + hasAlternative   → skip      (prefer the alternative over a stop)
 *   - exhausted (no alt)           → abort
 *
 * TOTAL: never throws. A hostile input or a decision that cannot be computed
 * fails CLOSED to `abort` (stop) — never a silent infinite retry.
 */
export function decideToolErrorRecovery(input: ToolErrorRecoveryInput): ToolErrorRecoveryDecision {
  try {
    const src: unknown = input;
    const kind = normalizeToolErrorKind(safeGet(src, 'errorKind'));
    const attempts = normalizeAttempts(safeGet(src, 'attempts'));
    const tool = sanitizeToolLabel(safeGet(src, 'toolName'));
    const hasAlt = safeGet(src, 'hasAlternative') === true;

    const exhausted = attempts >= TOOL_ERROR_MAX_ATTEMPTS;
    const kindText = kind.replace(/_/g, ' ');
    const nOfMax = `attempt ${attempts} of ${TOOL_ERROR_MAX_ATTEMPTS}`;

    // auth / permission: retrying can never succeed until a human supplies a
    // credential or approval. ask_user is loop-breaking → intentionally uncapped.
    if (kind === 'auth') {
      return decision(
        'ask_user',
        `${tool} failed on authentication; a valid credential is required — ask the user rather than retrying.`,
      );
    }
    if (kind === 'permission') {
      return decision(
        'ask_user',
        `${tool} was blocked by permissions; approval or access is required — ask the user rather than retrying.`,
      );
    }

    // not_found WITH an alternative: the target isn't there, but another route
    // exists — take it now instead of re-running a doomed call (skip is uncapped).
    if (kind === 'not_found' && hasAlt) {
      return decision(
        'skip',
        `${tool} target was not found, but an alternative approach is available — skipping this call.`,
      );
    }

    // Everything below is a LOOPING recovery and is capped. Once exhausted,
    // prefer an available alternative (skip) over a dead stop (abort).
    if (exhausted) {
      if (hasAlt) {
        return decision(
          'skip',
          `${tool} failed ${attempts}× (${kindText}); retries are exhausted — switching to the available alternative.`,
        );
      }
      return decision(
        'abort',
        `${tool} exhausted ${attempts} attempts on a ${kindText} error with no alternative — aborting this tool.`,
      );
    }

    // Attempts remain.
    if (kind === 'transient') {
      return decision('retry', `transient error on ${tool} (${nOfMax}); retrying the same call.`);
    }
    if (kind === 'invalid_args') {
      return decision(
        'retry_with_fix',
        `${tool} was called with invalid arguments; correct the input before retrying (${nOfMax}).`,
      );
    }
    if (kind === 'not_found') {
      return decision(
        'retry_with_fix',
        `${tool} target was not found; re-observe and correct the target before retrying (${nOfMax}).`,
      );
    }
    // unknown: unclassified — change approach, then retry (still capped above).
    return decision(
      'retry_with_fix',
      `${tool} failed with an unclassified error; change your approach before retrying (${nOfMax}).`,
    );
  } catch {
    // Fail closed: an uncomputable decision stops rather than risks a runaway.
    return { action: 'abort', reason: 'tool error recovery could not be decided — aborting to fail closed.' };
  }
}
