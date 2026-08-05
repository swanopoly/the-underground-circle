/**
 * providerErrorAdvanceCore — decide whether a cross-provider fallback
 * chain should ADVANCE to the next route after a route throws.
 *
 * ─── Why this exists ────────────────────────────────────────────────
 * `universalInvoke.executeRouteChain` currently does:
 *
 *     const transient = isTransientProviderError(err);
 *     ...
 *     if (!transient) break;   // ← aborts the WHOLE chain
 *
 * That is too blunt. An AUTH failure (401/403) or a "model not found"
 * (404) on provider A says nothing about provider B — a *different*
 * provider with a *different* key / catalog may well succeed. Breaking
 * the chain throws away those still-viable routes. Conversely, a
 * rate-limit / overload / transient wobble is worth retrying even on the
 * SAME provider with a different model id (a legit same-provider route).
 *
 * This core splits the decision into two total, pure functions:
 *   - `classifyProviderError` buckets any thrown value into a coarse
 *     `ProviderErrorClass`.
 *   - `shouldAdvanceAfterError` turns that class + "what routes remain"
 *     into a single advance/stop boolean the loop can act on.
 *
 * ─── Purity (load-bearing) ──────────────────────────────────────────
 * Zero runtime imports. No `Date.now()` / `Math.random()`. Every export
 * is TOTAL: any hostile input (null, wrong type, huge string, object
 * with throwing getters, circular) yields a safe neutral value, never a
 * throw. Output is bounded (a small enum string / a boolean). This keeps
 * the module loadable under tsx/esbuild for smoke testing.
 */

/**
 * Coarse buckets for a provider failure, chosen for the ONE decision
 * this module makes: "advance the fallback chain, and if so, only to a
 * different provider or to any remaining route?"
 *
 *   auth       → 401 / 403 / bad-or-missing key. The SAME key will keep
 *                failing, so a same-provider retry is pointless; a
 *                different provider might work.
 *   rate_limit → 429 / throttling. Provider-side + transient; a
 *                same-provider different-model route can still succeed.
 *   overload   → 529 / "overloaded" / saturation. Same as rate_limit
 *                for advancement purposes.
 *   transient  → 5xx / timeout / network reset. Retry-worthy anywhere.
 *   not_found  → 404 / unknown-model. The model is absent on THIS
 *                provider; only a different provider's catalog can help.
 *   permanent  → everything else (bad request, unclassifiable). Treated
 *                conservatively — only a different provider is tried.
 */
export type ProviderErrorClass =
  | 'auth'
  | 'rate_limit'
  | 'overload'
  | 'transient'
  | 'not_found'
  | 'permanent';

// ── Message keyword matchers (word-bounded where a bare substring
//    would false-positive, e.g. "rate" inside "generate"). Compiled once
//    at module scope — no per-call allocation, no clock/RNG. ───────────
const AUTH_RE =
  /unauthor|not authorized|forbidden|permission denied|access denied|api[\s_-]?key|invalid[\s_-]?api|authenticat|invalid key|missing key|bad api key|no api key|\bcredential/;
const RATE_RE = /rate[\s_-]?limit|\brate\b|too many request|quota exceeded|\bquota\b|throttl/;
const OVERLOAD_RE =
  /overload|over capacity|at capacity|\bcapacity\b|service unavailable|service_unavailable|temporarily unavailable|server is busy|servers are busy|too busy|high demand/;
const NOT_FOUND_RE =
  /not found|no such|does not exist|doesn'?t exist|unknown model|unrecognized model|no model|model_not_found|nonexistent|deprecated model/;
const TRANSIENT_RE =
  /timeout|timed out|etimedout|enotfound|enetunreach|epipe|econn|network|fetch failed|failed to fetch|load failed|failed to send a request|socket hang up|connection reset|connection refused|connection closed|connection error|abort|bad gateway|gateway timeout|temporar|try again|getaddrinfo|\bdns\b|reset by peer|server error|internal error/;

type UnknownRecord = Record<string, unknown>;

function isRecord(v: unknown): v is UnknownRecord {
  return typeof v === 'object' && v !== null;
}

/** Coerce a value to a finite HTTP-status number, or undefined. Accepts
 *  a number, or a 3-digit numeric string. */
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

/** Pull a numeric status out of the common error shapes (fetch/axios/
 *  Anthropic/OpenAI SDK). Reads only fields; never throws (caller wraps
 *  in try/catch too). */
function extractStatus(err: unknown): number | undefined {
  if (typeof err === 'number' && Number.isFinite(err)) return err;
  if (!isRecord(err)) return undefined;
  const direct =
    toStatus(err.status) ?? toStatus(err.statusCode) ?? toStatus(err.status_code) ?? toStatus(err.code);
  if (direct !== undefined) return direct;
  const resp = err.response;
  if (isRecord(resp)) {
    const rs = toStatus(resp.status) ?? toStatus(resp.statusCode);
    if (rs !== undefined) return rs;
  }
  const cause = err.cause;
  if (isRecord(cause)) {
    const cs = toStatus(cause.status) ?? toStatus(cause.statusCode);
    if (cs !== undefined) return cs;
  }
  return undefined;
}

/** Best-effort status parse from free text: a bare 3-digit body, or a
 *  "status code NNN" / "http NNN" phrase (axios-style). Deliberately does
 *  NOT match bare embedded numbers to avoid false positives on token
 *  counts / durations. */
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

/** Build a single lowercased, length-bounded haystack from the many
 *  places providers stash their error text. Bounding keeps regex work
 *  cheap on hostile megabyte-sized inputs. */
function extractMessage(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return cap(err).toLowerCase();
  if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
    return String(err).toLowerCase();
  }
  if (!isRecord(err)) return ''; // symbol / function
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) parts.push(v);
  };
  push(err.message);
  push(err.code);
  push(err.type);
  push(err.name);
  push(err.reason);
  const inner = err.error;
  if (isRecord(inner)) {
    push(inner.message);
    push(inner.type);
    push(inner.code);
  } else if (typeof inner === 'string') {
    push(inner);
  }
  const resp = err.response;
  if (isRecord(resp)) {
    const data = resp.data;
    if (isRecord(data)) {
      push(data.message);
      const derr = data.error;
      if (isRecord(derr)) {
        push(derr.message);
        push(derr.code);
        push(derr.type);
      } else if (typeof derr === 'string') {
        push(derr);
      }
    }
  }
  const cause = err.cause;
  if (isRecord(cause)) {
    push(cause.code);
    push(cause.message);
  }
  if (parts.length === 0) {
    try {
      const s = String(err);
      if (s && s !== '[object Object]') parts.push(s);
    } catch {
      /* toString threw — ignore, leave empty */
    }
  }
  return cap(parts.join(' ')).toLowerCase();
}

function cap(s: string): string {
  return s.length > 4096 ? s.slice(0, 4096) : s;
}

/**
 * Bucket any thrown value into a `ProviderErrorClass`.
 *
 * Precedence: an explicit numeric HTTP status is the most reliable
 * signal, so it is consulted first (specific codes before the generic
 * 5xx range — note 529 is overload, not transient). Only 4xx codes that
 * aren't decisive on their own (400/402/409/413/422/…) fall through to
 * message heuristics, so a `400 "invalid api key"` still reads as auth.
 * Anything unrecognized is `permanent` (the "else" bucket).
 *
 * TOTAL: never throws. A hostile object (throwing getter, circular) is
 * caught and mapped to the neutral `permanent`.
 */
export function classifyProviderError(err: unknown): ProviderErrorClass {
  try {
    const msg = extractMessage(err);
    const status = extractStatus(err) ?? statusFromText(msg);

    if (typeof status === 'number' && Number.isFinite(status)) {
      if (status === 401 || status === 403) return 'auth';
      if (status === 429) return 'rate_limit';
      if (status === 529) return 'overload';
      if (status === 404) return 'not_found';
      if (status === 408 || status === 425) return 'transient';
      // 529 already handled above; remaining 5xx are treated as transient
      // per the app's fallback discipline (5xx / timeout / ECONN).
      if (status >= 500 && status <= 599) return 'transient';
      // Other explicit 4xx fall through to the message heuristics below.
    }

    if (AUTH_RE.test(msg)) return 'auth';
    if (RATE_RE.test(msg)) return 'rate_limit';
    if (OVERLOAD_RE.test(msg)) return 'overload';
    if (NOT_FOUND_RE.test(msg)) return 'not_found';
    if (TRANSIENT_RE.test(msg)) return 'transient';

    return 'permanent';
  } catch {
    return 'permanent';
  }
}

/** What still remains to try after the route that just failed. Both
 *  flags are supplied by the loop from its own position in the chain. */
export interface RouteRemainingContext {
  /** True when a route to a provider DIFFERENT from the one that just
   *  failed still remains in the chain. */
  differentProviderRemains: boolean;
  /** True when ANY route (including a same-provider, different-model
   *  route) still remains in the chain. */
  anyRouteRemains: boolean;
}

/**
 * Decide whether the fallback loop should ADVANCE to the next route.
 *
 *   auth / not_found / permanent → advance IFF a DIFFERENT provider
 *       still remains. The same key / same catalog would just re-fail,
 *       so a same-provider different-model retry is pointless; only a
 *       different provider can help.
 *   rate_limit / overload / transient → advance whenever ANY route
 *       remains. These are provider-side wobbles; even a same-provider
 *       different-model retry is a legitimate next attempt.
 *
 * TOTAL: a null / garbage ctx, or non-boolean flags, are treated as
 * "nothing remains" (only literal `true` counts), so the safe neutral is
 * `false` (stop). An unrecognized class is handled conservatively like
 * `permanent`. Never throws.
 */
export function shouldAdvanceAfterError(cls: ProviderErrorClass, ctx: RouteRemainingContext): boolean {
  try {
    const differentProviderRemains = isRecord(ctx) && ctx.differentProviderRemains === true;
    const anyRouteRemains = isRecord(ctx) && ctx.anyRouteRemains === true;

    switch (cls) {
      case 'rate_limit':
      case 'overload':
      case 'transient':
        return anyRouteRemains;
      case 'auth':
      case 'not_found':
      case 'permanent':
        return differentProviderRemains;
      default:
        // Unknown / hostile class → conservative, like 'permanent'.
        return differentProviderRemains;
    }
  } catch {
    return false;
  }
}
