/**
 * failureRecoveryCopyCore — pure raw-failure → friendly recovery copy for the
 * SwanBot chat agent.
 *
 * Problem this fixes: today, when a turn fails, the user sees the raw exception
 * verbatim — "Failed to fetch", "Desktop bridge offline.", "Edge Function
 * returned a non-2xx status code", a bare edge 500, or an "AbortError". None of
 * those tell a non-engineer what happened or what to do, and the app can't tell
 * which failures are transient (retry silently) from which need the user. This
 * core maps ANY raw failure (Error / string / status object / hostile input)
 * into:
 *   (a) a friendly one-line explanation in plain language,
 *   (b) the concrete next action the user (or the app) should take, and
 *   (c) whether the app should AUTO-RETRY transparently instead of bothering
 *       the user.
 *
 * Callers (wiring — NOT this module):
 *   - ChatTab's outer sendMessage catch + the chat-lane error boundary can turn
 *     a caught error into buildFailureRecovery(err, { context, attempt }) and
 *     render { title, message, action } with a Retry affordance gated on
 *     `retryable`; when `autoRetry` is true they re-run the turn silently
 *     (bounded by AUTO_RETRY_MAX_ATTEMPT) before ever surfacing the copy.
 *   - Any log/telemetry sink can call redactSecretsInError(err) to record a
 *     bounded, secret-masked form of the raw failure.
 *
 * PURITY CONTRACT (load-bearing — smoke test runs under tsx/esbuild):
 *   - Zero runtime imports; zero side effects at import; deterministic
 *     (no Date.now()/Math.random() anywhere).
 *   - Every export is TOTAL: it never throws on any input (null / undefined /
 *     Error / string / number / bigint / symbol / function / array / huge /
 *     circular / Proxy with throwing getters / hostile object) — it returns a
 *     safe neutral value instead.
 *   - Bounded output: titles/messages/actions are capped; the raw error is
 *     NEVER echoed into the friendly copy. redactSecretsInError masks
 *     token/key/bearer/password/sk-…/authorization values, and the only
 *     free-text channel into buildFailureRecovery (opts.context) is redacted +
 *     whitelisted + bounded, so no secret can leak through the copy.
 */

// ---------------------------------------------------------------------------
// Contract types
// ---------------------------------------------------------------------------

export type FailureClass =
  | 'network'
  | 'bridge_offline'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'model_config'
  | 'not_found'
  | 'permission'
  | 'edge_5xx'
  | 'unknown';

export interface FailureRecovery {
  /** Short human title, e.g. 'Desktop bridge not connected'. */
  title: string;
  /** Friendly one-line explanation in plain language (< 200 chars). */
  message: string;
  /** The concrete next action the user (or app) should take (< 200 chars). */
  action: string;
  /** True when the app should silently re-run instead of surfacing the copy. */
  autoRetry: boolean;
  /** True when a Retry affordance makes sense at all (after any user step). */
  retryable: boolean;
  /** The classified failure category. */
  class: FailureClass;
}

/**
 * Max number of attempts before auto-retry stops and the user is asked. An
 * `attempt` value of 0 or 1 is still auto-retryable for transient classes; 2+
 * stops. (0-indexed count of attempts already made.)
 */
export const AUTO_RETRY_MAX_ATTEMPT = 2;

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

/** Bounded scan window applied to any coerced raw text before work. */
const SCAN_MAX = 4000;
/** Hard cap on the string redactSecretsInError returns. */
const REDACT_OUTPUT_MAX = 500;
/** Message/action stay strictly under 200 chars per the contract. */
const MESSAGE_MAX = 190;
const ACTION_MAX = 190;
const TITLE_MAX = 60;
/** Sanitized opts.context clause cap. */
const CONTEXT_MAX = 48;

// ---------------------------------------------------------------------------
// Secret redaction (self-contained — no imports; mirrors messagingNotify intent)
// ---------------------------------------------------------------------------

const REDACTION = '[redacted]';

/**
 * Secret-shaped substrings that must never survive into logged text or copy.
 * Ordered so the more-specific vendor prefixes are tried before the generic
 * key=VALUE catch-all. Whole matches are replaced with `[redacted]`.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Bearer / Authorization inline.
  /\bBearer\s+[A-Za-z0-9._\-]{4,}/gi,
  /\bAuthorization\b\s*[:=]\s*["']?[A-Za-z0-9._\-]{4,}["']?/gi,
  // Common vendor key prefixes (sk-ant before sk-).
  /\bsk-ant-[A-Za-z0-9._\-]{6,}/gi,
  /\bsk-[A-Za-z0-9]{3,}/gi,
  /\bxox[baprs]-[A-Za-z0-9-]{6,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{12,}/g,
  /\bAKIA[0-9A-Z]{10,}/g,
  /\bAIza[0-9A-Za-z._\-]{12,}/g,
  /\bhf_[A-Za-z0-9]{8,}/gi,
  // JWT (header.payload.signature).
  /\beyJ[A-Za-z0-9._\-]{6,}\.[A-Za-z0-9._\-]{4,}\.[A-Za-z0-9._\-]{4,}/g,
  // key=VALUE / secret: VALUE where the key name is secret-shaped.
  /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential|auth[_-]?token|session[_-]?token|bearer)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+=]{3,}["']?/gi,
];

/** Replace every secret-shaped substring with `[redacted]`. Never throws. */
function redact(text: string): string {
  let out = typeof text === 'string' ? text : '';
  for (const pattern of SECRET_PATTERNS) {
    try {
      out = out.replace(pattern, REDACTION);
    } catch {
      /* a bad replace never breaks totality */
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Total helpers
// ---------------------------------------------------------------------------

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

/** Coerce a primitive to a string without throwing ('' for non-primitives). */
function primitiveToString(v: unknown): string {
  try {
    if (v === null || v === undefined) return '';
    const t = typeof v;
    if (t === 'string') return v as string;
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
    if (t === 'symbol') return (v as symbol).toString();
    return '';
  } catch {
    return '';
  }
}

/** Cap text to `max` chars; when truncated, end with a single '…'. */
function capText(s: string, max: number): string {
  if (typeof s !== 'string') return '';
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).replace(/\s+$/, '')}…`;
}

/** Collapse control chars + whitespace into single spaces, trimmed. */
function collapseWs(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Common text-bearing fields on Error-like / API-error objects. */
const ERROR_TEXT_FIELDS: readonly string[] = [
  'message',
  'error_description',
  'description',
  'detail',
  'details',
  'reason',
  'statusText',
  'msg',
  'hint',
  'error',
  'body',
];

/**
 * Best-effort, bounded, throw-proof conversion of any raw failure into text we
 * can scan/redact. Reads known error fields (never `stack` — avoids leaking
 * paths/secrets), a couple of numeric status fields, and one nested layer of
 * cause/context/response. Depth-guarded so circular refs terminate.
 */
function coerceToText(raw: unknown, depth = 0): string {
  try {
    if (raw === null || raw === undefined) return '';
    const t = typeof raw;
    if (t === 'string') return raw as string;
    if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
      return primitiveToString(raw);
    }
    if (t === 'function') {
      const name = safeGet(raw, 'name');
      return typeof name === 'string' && name ? `function ${name}` : 'function';
    }
    if (Array.isArray(raw)) {
      if (depth > 2) return '';
      const parts: string[] = [];
      for (let i = 0; i < raw.length && i < 20; i += 1) {
        const s = coerceToText(raw[i], depth + 1);
        if (s) parts.push(s);
        if (parts.join(' ; ').length > SCAN_MAX) break;
      }
      return parts.join(' ; ');
    }
    if (t === 'object') {
      const parts: string[] = [];
      const nameV = safeGet(raw, 'name');
      const name = typeof nameV === 'string' ? nameV.trim() : '';
      // Keep a meaningful error-type name (AbortError, FunctionsHttpError, …)
      // but drop the noisy generics so they don't pollute classification.
      if (name && !/^(error|object|typeerror)$/i.test(name)) parts.push(name);

      for (const field of ERROR_TEXT_FIELDS) {
        const v = safeGet(raw, field);
        if (typeof v === 'string' && v.trim()) parts.push(v.trim());
        else if (typeof v === 'number' || typeof v === 'boolean') parts.push(String(v));
        else if (v && typeof v === 'object' && depth < 2) {
          const nested = coerceToText(v, depth + 1);
          if (nested) parts.push(nested);
        }
        if (parts.join(' ').length > SCAN_MAX) break;
      }

      // Numeric status/code helps text-level classification even without fields.
      for (const field of ['status', 'statusCode', 'httpStatus', 'code']) {
        const v = safeGet(raw, field);
        if (typeof v === 'number' && Number.isFinite(v)) parts.push(`${field} ${v}`);
        else if (typeof v === 'string' && v.trim() && v.length < 40) parts.push(`${field} ${v.trim()}`);
      }

      if (depth < 2) {
        for (const field of ['cause', 'context', 'response', 'originalError']) {
          const v = safeGet(raw, field);
          if (v && typeof v === 'object') {
            const nested = coerceToText(v, depth + 1);
            if (nested) parts.push(nested);
          }
        }
      }

      let joined = parts.filter(Boolean).join(' ');
      if (!joined) {
        try {
          joined = Object.prototype.toString.call(raw) || '';
        } catch {
          joined = '';
        }
      }
      return joined;
    }
    return '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Signal extraction + classification
// ---------------------------------------------------------------------------

interface FailureSignals {
  /** Lowercased, redacted, whitespace-collapsed, bounded scan text. */
  haystack: string;
  /** Authoritative HTTP status when one could be read, else null. */
  status: number | null;
}

/** Parse a small finite integer (HTTP-status shaped) or null. */
function firstFiniteInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string') {
    const m = v.trim().match(/^-?\d{1,4}$/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Read an authoritative HTTP status from fields or (with context) from text. */
function extractStatus(raw: unknown, haystack: string): number | null {
  const statusFields = ['status', 'statusCode', 'httpStatus', 'status_code'];
  for (const field of statusFields) {
    const n = firstFiniteInt(safeGet(raw, field));
    if (n !== null && n >= 100 && n <= 599) return n;
  }
  // A numeric `code` only counts as a status if it looks like an HTTP one.
  const codeN = firstFiniteInt(safeGet(raw, 'code'));
  if (codeN !== null && codeN >= 400 && codeN <= 599) return codeN;

  for (const field of ['context', 'response', 'cause', 'originalError']) {
    const nested = safeGet(raw, field);
    if (nested && typeof nested === 'object') {
      for (const g of statusFields) {
        const n = firstFiniteInt(safeGet(nested, g));
        if (n !== null && n >= 100 && n <= 599) return n;
      }
    }
  }

  // Only trust a 3-digit number in text when a status-context word precedes it,
  // so "under 500 characters" / "503 items" never read as an HTTP status.
  const m = haystack.match(/\b(?:status(?:\s*code)?|http|https|error|returned|response|code)\D{0,8}(\d{3})\b/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 100 && n <= 599) return n;
  }
  return null;
}

/** Build the redacted, bounded, lowercased haystack + status for a raw value. */
function buildSignals(raw: unknown): FailureSignals {
  let text = '';
  try {
    text = coerceToText(raw);
  } catch {
    text = '';
  }
  if (typeof text !== 'string') text = '';
  if (text.length > SCAN_MAX) text = text.slice(0, SCAN_MAX);
  const haystack = collapseWs(redact(text)).toLowerCase();
  let status: number | null = null;
  try {
    status = extractStatus(raw, haystack);
  } catch {
    status = null;
  }
  return { haystack, status };
}

type Detector = { cls: FailureClass; test: (h: string, status: number | null) => boolean };

/** Words that, next to "bridge", mean the local bridge process is down. */
const BRIDGE_STATE_RE =
  /\b(offline|unavailable|not\s+(?:running|connected|paired|reachable|up)|unreachable|disconnected|down|refused|econnrefused|connection refused|no bridge|not found)\b/;

/**
 * Ordered classifiers — first match wins. Order encodes precedence:
 *   bridge (localhost:7778 / ECONNREFUSED-to-bridge) before generic network;
 *   rate_limit (429/529) before edge_5xx so 529 "overloaded" isn't a 5xx;
 *   edge_5xx skips 4xx statuses so auth/permission/not_found win those;
 *   model_config before not_found so "model not found" reads as model_config.
 */
const DETECTORS: readonly Detector[] = [
  {
    cls: 'bridge_offline',
    test: (h) =>
      (/\bbridge\b/.test(h) && BRIDGE_STATE_RE.test(h)) ||
      /(?:localhost|127\.0\.0\.1):\s*(?:777\d|1879\d)\b/.test(h) ||
      /:\s*(?:7778|7779|7780|7781|18790)\b/.test(h) ||
      (/\beconnrefused\b/.test(h) && /\b(?:bridge|localhost|127\.0\.0\.1|777\d|1879\d)\b/.test(h)),
  },
  {
    cls: 'rate_limit',
    test: (h, s) =>
      s === 429 ||
      s === 529 ||
      /\b(?:rate.?limit(?:ed|ing)?|too many requests|429|529|quota exceeded|over quota|overloaded|at capacity)\b/.test(h),
  },
  {
    cls: 'edge_5xx',
    test: (h, s) => {
      if (s !== null && s >= 400 && s < 500) return false; // let 4xx handlers win
      if (s !== null && s >= 500) return true;
      return /\bnon-?2xx\b|\bedge function\b|\binternal server error\b|\bbad gateway\b|\bservice unavailable\b|\bgateway timeout\b|\bserver error\b|\b(?:status(?:\s*code)?|http|error|returned|code)\D{0,8}5\d\d\b/.test(
        h,
      );
    },
  },
  {
    cls: 'timeout',
    test: (h, s) => {
      if (s !== null && s >= 500) return false; // a 5xx is edge, not a timeout
      return /\btimed?\s?out\b|\btimeout\b|\betimedout\b|\bdeadline (?:exceeded|reached)\b|\babort(?:ed|error|ing)?\b|\bconnection timed\b/.test(
        h,
      );
    },
  },
  {
    cls: 'auth',
    test: (h, s) => {
      if (s === 401) return true;
      if (s === 403) return false;
      return /\b401\b|\bnot authenticated\b|\bunauthenticated\b|\bunauthorized\b|\bsession\b|\bnot (?:logged|signed) in\b|\b(?:log|sign) ?in required\b|\bjwt\b|\bauth session\b|\bauthentication (?:required|failed|error|expired)\b|\binvalid (?:credentials?|session)\b|\b(?:token|credentials?) expired\b/.test(
        h,
      );
    },
  },
  {
    cls: 'permission',
    test: (h, s) => {
      if (s === 403) return true;
      if (s === 401) return false;
      return /\b403\b|\bforbidden\b|\bpermission\b|\bnot permitted\b|\bnot allowed\b|\baccess denied\b|\bpermission denied\b|\binsufficient (?:permission|access|privileges?|scope)\b|\bnot authorized to\b|\brow[- ]level security\b/.test(
        h,
      );
    },
  },
  {
    cls: 'model_config',
    test: (h) =>
      /\bmodel_unsupported\b|\bkey_missing\b|\bunsupported model\b|\bmodel (?:not (?:found|available|supported)|unavailable|unsupported)\b|\bno (?:such )?model\b|\b(?:model|provider) not configured\b|\bmissing api key\b|\bno api key\b|\bapi key (?:missing|required|not configured|invalid)\b|\binvalid api key\b|\bbyok\b|\bunsupported\b|\bmodel\b/.test(
        h,
      ),
  },
  {
    cls: 'not_found',
    test: (h, s) =>
      s === 404 ||
      /\b404\b|\bnot found\b|\bno such\b|\bdoes ?n['’]?t exist\b|\bdoesnt exist\b|\bno matching\b|\bunknown (?:endpoint|route|resource|record)\b/.test(
        h,
      ),
  },
  {
    cls: 'network',
    test: (h, s) =>
      s === 0 ||
      /\bfailed to fetch\b|\bnetwork ?error\b|\bnetworkerror\b|\bfetch failed\b|\becon(?:nreset|naborted|nrefused)\b|\benotfound\b|\berr_(?:connection|network|name_not_resolved|internet_disconnected)\b|\bnet::\b|\bsocket hang ?up\b|\bbroken pipe\b|\bconnection (?:reset|closed|refused|error|aborted)\b|\bdns\b|\bload failed\b|\boffline\b|\bnetwork\b/.test(
        h,
      ),
  },
];

/**
 * Classify a raw failure (Error / string / status object / anything) into a
 * FailureClass. Deterministic first-match ordering; unrecognized → 'unknown'.
 * Never throws.
 */
export function classifyFailure(raw: unknown): FailureClass {
  try {
    const { haystack, status } = buildSignals(raw);
    if (!haystack && status === null) return 'unknown';
    for (const detector of DETECTORS) {
      let ok = false;
      try {
        ok = detector.test(haystack, status);
      } catch {
        ok = false;
      }
      if (ok) return detector.cls;
    }
    // Status-only fallback (a bare status object with no text cues).
    if (status !== null) {
      if (status === 429) return 'rate_limit';
      if (status === 401) return 'auth';
      if (status === 403) return 'permission';
      if (status === 404) return 'not_found';
      if (status >= 500) return 'edge_5xx';
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Friendly copy
// ---------------------------------------------------------------------------

interface ClassSpec {
  title: string;
  /** Message body WITHOUT a trailing period (period added at assembly). */
  messageCore: string;
  retryable: boolean;
  /** Eligible for silent auto-retry (gated by attempt < AUTO_RETRY_MAX_ATTEMPT). */
  transient: boolean;
  /** Action copy shown while auto-retry is still in effect. */
  autoAction: string;
  /** Action copy shown when the user must act (or auto-retry is exhausted). */
  manualAction: string;
}

const SPECS: Record<FailureClass, ClassSpec> = {
  network: {
    title: 'Connection problem',
    messageCore: "I couldn't reach the server just now",
    retryable: true,
    transient: true,
    autoAction: "I'll try again automatically in a moment — no action needed.",
    manualAction: 'Check your internet connection, then tap Retry.',
  },
  bridge_offline: {
    title: 'Desktop bridge not connected',
    messageCore: "I can't reach your Mac's local bridge right now",
    retryable: true,
    transient: false,
    autoAction: 'Start it with `npm run bridge`, then tap Retry.',
    manualAction: 'Start it with `npm run bridge`, then tap Retry.',
  },
  auth: {
    title: 'Session expired',
    messageCore: "Your session expired, so I couldn't finish that securely",
    retryable: true,
    transient: false,
    autoAction: 'Sign in again, then tap Retry.',
    manualAction: 'Sign in again, then tap Retry.',
  },
  rate_limit: {
    title: 'Too many requests',
    messageCore: "We're being rate-limited, so I'm giving it a moment before trying again",
    retryable: true,
    transient: true,
    autoAction: "Hang tight — I'll retry in a few seconds.",
    manualAction: 'Wait a minute, then tap Retry.',
  },
  timeout: {
    title: 'That took too long',
    messageCore: 'The request timed out before it finished',
    retryable: true,
    transient: true,
    autoAction: "I'll try again automatically in a moment — no action needed.",
    manualAction: 'Try again in a moment.',
  },
  model_config: {
    title: 'Model not available here',
    messageCore: "That model isn't available on this path — try another model",
    retryable: false,
    transient: false,
    autoAction: 'Pick a different model, then try again.',
    manualAction: 'Pick a different model, then try again.',
  },
  not_found: {
    title: 'Not found',
    messageCore: "I couldn't find what that request pointed to",
    retryable: false,
    transient: false,
    autoAction: 'Double-check the name or link, then try again.',
    manualAction: 'Double-check the name or link, then try again.',
  },
  permission: {
    title: "You don't have access",
    messageCore: "That was blocked because you don't have permission for it",
    retryable: true,
    transient: false,
    autoAction: 'Ask an admin for access or approve the action, then tap Retry.',
    manualAction: 'Ask an admin for access or approve the action, then tap Retry.',
  },
  edge_5xx: {
    title: 'Server error',
    messageCore: 'The server hit an error while finishing that request',
    retryable: true,
    transient: true,
    autoAction: "I'll try again automatically in a moment — no action needed.",
    manualAction: 'Try again in a moment; if it keeps failing, tell the team.',
  },
  unknown: {
    title: 'Something went wrong',
    messageCore: "That didn't finish, and I couldn't tell exactly why",
    retryable: true,
    transient: false,
    autoAction: 'Try again in a moment; if it keeps happening, start a fresh chat.',
    manualAction: 'Try again in a moment; if it keeps happening, start a fresh chat.',
  },
};

/** Normalize the attempt count: finite non-negative int, else 0; bounded. */
function normalizeAttempt(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.min(Math.trunc(v), 1000);
  return 0;
}

/**
 * Sanitize opts.context into a short, secret-free, whitelisted label safe to
 * fold into user-facing copy. Redacts first (defense in depth), then strips to
 * a plain charset and bounds it. Returns '' when nothing usable remains.
 */
function sanitizeContext(v: unknown): string {
  if (typeof v !== 'string' || !v) return '';
  let s = redactSecretsInError(v);
  s = s.replace(/[^A-Za-z0-9 ._/-]+/g, ' ');
  s = collapseWs(s);
  if (!s) return '';
  return capText(s, CONTEXT_MAX);
}

/**
 * Turn a raw failure into user-friendly recovery copy: a plain-language title +
 * message + next action, whether the app should auto-retry silently, and
 * whether a manual Retry makes sense. The raw error text is NEVER echoed into
 * the copy — only a redacted, whitelisted opts.context label can appear — so no
 * secret can leak through this function. Never throws.
 */
export function buildFailureRecovery(
  raw: unknown,
  opts?: { context?: string; attempt?: number },
): FailureRecovery {
  const cls = classifyFailure(raw);
  const spec = SPECS[cls] ?? SPECS.unknown;

  let attempt = 0;
  let context = '';
  if (opts && typeof opts === 'object' && !Array.isArray(opts)) {
    try {
      attempt = normalizeAttempt((opts as { attempt?: unknown }).attempt);
    } catch {
      attempt = 0;
    }
    try {
      context = sanitizeContext((opts as { context?: unknown }).context);
    } catch {
      context = '';
    }
  }

  const autoRetry = spec.transient === true && attempt < AUTO_RETRY_MAX_ATTEMPT;
  const core = context ? `${spec.messageCore} (during ${context})` : spec.messageCore;
  const message = capText(`${core}.`, MESSAGE_MAX);
  const action = capText(autoRetry ? spec.autoAction : spec.manualAction, ACTION_MAX);

  return {
    title: capText(spec.title, TITLE_MAX),
    message,
    action,
    autoRetry,
    retryable: spec.retryable === true,
    class: cls,
  };
}

/**
 * Bounded, secret-masked string form of any raw error, for safe logging/reuse.
 * Coerces Error/string/object/array/primitive into text (never reads `stack`),
 * collapses whitespace, masks token/key/bearer/password/sk-…/authorization
 * values, and caps the result. Never throws; returns '' for empty input.
 */
export function redactSecretsInError(raw: unknown): string {
  let text = '';
  try {
    text = coerceToText(raw);
  } catch {
    text = '';
  }
  if (typeof text !== 'string') text = '';
  if (text.length > SCAN_MAX) text = text.slice(0, SCAN_MAX);
  // Redact BEFORE collapsing whitespace so secret masking runs on the raw form.
  return capText(collapseWs(redact(text)), REDACT_OUTPUT_MAX);
}
