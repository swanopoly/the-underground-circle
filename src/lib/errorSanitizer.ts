/**
 * errorSanitizer — pure, zero-import sanitizer for error strings that are about
 * to be handed back to a model or client (tool `resultsText`, edge responses).
 *
 * Dependency-light on purpose (no react-native, no fetch, no runtime imports)
 * so it is `tsx`-loadable in smoke tests. Mirrors the SECRETISH patterns used
 * across the codebase (messagingNotify.scrubSecrets, integrationActionComposer,
 * marketplaceIntegrationContext) but applied to raw error *messages*.
 *
 * Design goals (A8 security backlog):
 *  - FAIL-VISIBLE. We never swallow an error into a fake success. The model
 *    still learns the actionable CLASS (not-found / permission / timeout /
 *    rate-limit / bad-request / conflict / network / unavailable) plus a short
 *    honest hint. We only strip raw schema/secret/infra text.
 *  - Strip secret-shaped substrings (bearer / token / api_key / password /
 *    sk- / authorization / cookie / JWT / vendor key prefixes) → `[redacted]`.
 *  - Strip DB/PostgREST schema + infra leakage (relation/column/constraint
 *    names, connection strings, internal hostnames/IPs, file paths, SQLSTATE
 *    dumps) down to a generic-but-honest phrase, while PRESERVING the class.
 *  - Bounded (≤300 chars). Degenerate inputs (null, undefined, circular,
 *    throwing getters, huge blobs) NEVER throw.
 */

const MAX_LEN = 300;
const REDACTION = '[redacted]';

// ── Secret-shaped substrings (mirrors messagingNotify SECRET_TOKEN_PATTERNS +
//    integrationActionComposer SECRETISH_KEY_RE). Applied to VALUE content. ──
const SECRET_TOKEN_PATTERNS: RegExp[] = [
  // Authorization / Bearer inline (scheme + payload).
  /\bAuthorization\s*[:=]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._\-]{8,}/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/gi,
  // Cookie / Set-Cookie headers carry session material.
  /\b(?:Set-)?Cookie\s*[:=]\s*\S+/gi,
  // Common vendor key prefixes.
  /\bsk-ant-[A-Za-z0-9._\-]{12,}/g, // Anthropic-style (before generic sk-)
  /\bsk-[A-Za-z0-9]{16,}/g, // OpenAI-style
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi, // Slack tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // GitHub fine-grained PAT
  /\bAKIA[0-9A-Z]{12,}/g, // AWS access key id
  /\bAIza[0-9A-Za-z._\-]{20,}/g, // Google API key
  /\bhf_[A-Za-z0-9]{16,}/g, // Hugging Face token
  // JWT (header.payload.signature).
  /\beyJ[A-Za-z0-9._\-]{10,}\.[A-Za-z0-9._\-]{8,}\.[A-Za-z0-9._\-]{8,}/g,
  // key=VALUE / key: VALUE where the key name is secret-shaped.
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential|auth[_-]?token|session[_-]?(?:id|token)|x[_-]?api[_-]?key)\b\s*[:=]\s*["']?[^\s"',;)]{4,}["']?/gi,
];

// ── Infra / DB / schema leakage patterns → replaced with neutral placeholders.
//    We PRESERVE the actionable class (handled separately) and only remove the
//    identifiers/topology an attacker could use. ──
const INFRA_PATTERNS: { re: RegExp; to: string }[] = [
  // Connection strings: postgres://user:pass@host:port/db, redis://, mongodb://,
  // amqp://, mysql://, etc. (covers the credential too).
  {
    re: /\b[a-z][a-z0-9+.\-]*:\/\/[^\s'")]+/gi,
    to: '[endpoint]',
  },
  // PostgREST/Postgres schema leakage: relation/table/column/constraint/type
  // names in double quotes after the tell-tale keyword.
  {
    re: /\b(relation|table|column|constraint|schema|view|function|type|index|sequence|role|database)\s+"[^"]*"/gi,
    to: '$1',
  },
  // `column x.y` / `relation foo.bar` without quotes (Postgres also emits this).
  {
    re: /\b(relation|table|column|constraint|schema|view|index|sequence)\s+[a-z_][a-z0-9_$.]*(?=\s|$|[,.;)])/gi,
    to: '$1',
  },
  // PostgREST hint/detail JSON fragments that echo schema. Drop the value.
  {
    re: /"(?:details|hint|schema|table|column|constraint)"\s*:\s*("[^"]*"|null)/gi,
    to: '"$1_omitted"',
  },
  // SQLSTATE codes and "ERROR:  ..." Postgres prefixes → keep it generic.
  { re: /\bSQLSTATE\s*[:=]?\s*[0-9A-Z]{5}\b/gi, to: 'SQLSTATE' },
  // Internal-ish hostnames (*.internal, *.local, *.svc, *.cluster.local, and
  // the supabase/pooler/RDS infra hosts) → [host]. The optional leading-label
  // group lets us catch both `db.<ref>.supabase.co` and a bare
  // `pooler.supabase.com`.
  {
    re: /\b(?:[a-z0-9](?:[a-z0-9\-]{0,61}[a-z0-9])?\.)*(?:internal|local|svc|cluster\.local|supabase\.co|supabase\.in|pooler\.supabase\.com|rds\.amazonaws\.com|compute\.internal)\b(?::\d+)?/gi,
    to: '[host]',
  },
  // Bare IPv4 (optionally with :port) → [ip]. Skips version-looking dotted nums
  // only loosely; error topology leakage matters more than a stray version.
  {
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b(?::\d+)?/g,
    to: '[ip]',
  },
  // Absolute filesystem paths (unix + windows) that leak deploy layout.
  { re: /(?:^|\s)\/(?:[\w.\-]+\/){2,}[\w.\-]*/g, to: ' [path]' },
  { re: /\b[A-Za-z]:\\(?:[\w.\-]+\\){1,}[\w.\-]*/g, to: '[path]' },
];

/** Actionable error classes we preserve so the model still learns what to do. */
export type SanitizedErrorClass =
  | 'not-found'
  | 'permission'
  | 'timeout'
  | 'rate-limit'
  | 'conflict'
  | 'bad-request'
  | 'unavailable'
  | 'network'
  | 'unknown';

const CLASS_HINT: Record<SanitizedErrorClass, string> = {
  'not-found': 'The requested record or route was not found.',
  permission: 'Permission was denied for this operation.',
  timeout: 'The operation timed out.',
  'rate-limit': 'The service is rate-limiting requests; retry shortly.',
  conflict: 'The operation conflicted with existing data.',
  'bad-request': 'The request was rejected as invalid.',
  unavailable: 'The service is temporarily unavailable.',
  network: 'A network error occurred reaching the service.',
  unknown: 'The operation failed.',
};

/**
 * Best-effort coercion of any thrown value to a bounded raw string WITHOUT ever
 * throwing (guards circular refs, throwing getters, symbols, huge blobs).
 */
function coerceMessage(err: unknown): string {
  try {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    if (typeof err === 'number' || typeof err === 'boolean' || typeof err === 'bigint') {
      return String(err);
    }
    if (err instanceof Error) {
      // .message can be a throwing getter on exotic error subclasses.
      const m = (() => { try { return err.message; } catch { return ''; } })();
      if (typeof m === 'string' && m.trim()) return m;
    }
    // Supabase/PostgREST error objects expose { message, details, hint, code }.
    if (typeof err === 'object') {
      const anyErr = err as Record<string, unknown>;
      for (const key of ['message', 'error', 'msg', 'description', 'statusText']) {
        try {
          const v = anyErr[key];
          if (typeof v === 'string' && v.trim()) return v;
        } catch { /* throwing getter — skip */ }
      }
      // Fall back to a bounded JSON dump (may still carry class keywords).
      try {
        const json = JSON.stringify(err);
        if (typeof json === 'string' && json.trim() && json !== '{}') return json;
      } catch { /* circular — skip */ }
    }
    // Last resort — String() can itself throw via Symbol.toPrimitive.
    try { return String(err); } catch { return ''; }
  } catch {
    return '';
  }
  return '';
}

/**
 * Classify the raw (pre-scrub) message into an actionable class. Order matters:
 * more specific signals win over generic ones. Also consults a numeric HTTP
 * status if present in the text.
 */
export function classifyError(raw: string): SanitizedErrorClass {
  const s = String(raw || '').toLowerCase();
  if (!s) return 'unknown';

  // HTTP status hints (e.g. "HTTP 404", "status 429", "(503)").
  const status = (() => {
    const m = s.match(/\b(?:http|status|code)\s*[:=]?\s*(\d{3})\b/) || s.match(/\((\d{3})\)/) || s.match(/\b(4\d\d|5\d\d)\b/);
    return m ? Number(m[1]) : 0;
  })();

  if (/\btimed?\s?out\b|\btimeout\b|etimedout|deadline exceeded|deadline_exceeded/.test(s)) return 'timeout';
  if (/\brate[\s_-]?limit|too many requests|throttl|quota exceeded/.test(s) || status === 429) return 'rate-limit';
  if (/\bnot\s+found\b|no rows|0 rows|does not exist|no such|could not find|pgrst116|unknown route|no matching/.test(s) || status === 404) return 'not-found';
  if (/permission|forbidden|not authorized|unauthori[sz]ed|access denied|rls|row-level security|violates row-level|not allowed|insufficient/.test(s) || status === 401 || status === 403) return 'permission';
  if (/\bconflict\b|duplicate key|already exists|unique constraint|violates unique/.test(s) || status === 409) return 'conflict';
  if (/network|fetch failed|failed to fetch|econnrefused|econnreset|enotfound|dns|socket hang up|connection (refused|reset|closed)|unable to connect/.test(s)) return 'network';
  if (/unavailable|service is (down|unavailable)|bad gateway|gateway timeout|temporarily/.test(s) || status === 502 || status === 503 || status === 504) return 'unavailable';
  if (/invalid|malformed|bad request|violates|constraint|required|expected|must be|parse|syntax|not-null|check constraint/.test(s) || status === 400 || status === 422) return 'bad-request';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

/** Strip secret-shaped substrings from arbitrary text. Never throws. */
function stripSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_TOKEN_PATTERNS) {
    try { out = out.replace(re, REDACTION); } catch { /* pathological input */ }
  }
  return out;
}

/** Strip DB/schema/infra leakage from arbitrary text. Never throws. */
function stripInfra(text: string): string {
  let out = text;
  for (const { re, to } of INFRA_PATTERNS) {
    try { out = out.replace(re, to); } catch { /* pathological input */ }
  }
  return out;
}

/** Collapse whitespace + control chars and hard-bound to MAX_LEN with ellipsis. */
function normalizeAndBound(text: string): string {
  const collapsed = text
    .replace(/[ -]+/g, ' ') // control chars (incl. newlines/tabs)
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length <= MAX_LEN) return collapsed;
  return `${collapsed.slice(0, MAX_LEN - 1).trimEnd()}…`;
}

/**
 * Sanitize an arbitrary thrown/returned error for model or client consumption.
 *
 * Fail-VISIBLE: always returns a non-empty, honest phrase describing the error
 * CLASS plus (when safe) a scrubbed hint. Never throws; always bounded.
 *
 * Examples (before → after):
 *   'relation "circle_github_events" does not exist'
 *     → 'This operation could not be completed (not-found). The requested
 *        record or route was not found. relation does not exist'
 *   'connect ECONNREFUSED 10.0.0.5:5432'
 *     → '...(network). A network error occurred reaching the service. connect
 *        ECONNREFUSED [ip]'
 *   'Invalid token: Bearer sk-ant-abc123...'
 *     → '...(bad-request). The request was rejected as invalid. Invalid token:
 *        [redacted]'
 */
export function sanitizeErrorForModel(err: unknown, opts?: { context?: string }): string {
  let raw = '';
  try { raw = coerceMessage(err); } catch { raw = ''; }

  // Classify from the RAW text (before scrubbing) so class keywords like
  // "does not exist" survive to inform the class even though we then strip the
  // schema identifier.
  const cls = classifyError(raw);
  const classHint = CLASS_HINT[cls];

  // Scrub secrets first (so a secret embedded in a path/host can't survive an
  // infra rewrite), then strip infra/schema, then bound.
  let hint = '';
  try {
    hint = normalizeAndBound(stripInfra(stripSecrets(raw)));
  } catch {
    hint = '';
  }

  const contextLabel = (() => {
    const c = typeof opts?.context === 'string' ? opts.context.trim() : '';
    if (!c) return '';
    // The context label is caller-supplied and low-risk, but scrub + bound it
    // too so a caller can't accidentally pipe a secret through it.
    return normalizeAndBound(stripSecrets(c)).slice(0, 80);
  })();

  // Assemble: "<context> failed (<class>). <class hint>[ Detail: <safe hint>]".
  // The class + hint keep it fail-visible; the scrubbed detail is optional.
  const head = contextLabel ? `${contextLabel} failed (${cls}).` : `Operation failed (${cls}).`;

  // If the scrubbed hint is empty, fully-redacted, or just echoes the class
  // hint, omit it — the class hint already carries the honest signal.
  const detailUseful =
    hint &&
    hint !== REDACTION &&
    hint.toLowerCase() !== classHint.toLowerCase() &&
    // Avoid a detail that is nothing but our own placeholders.
    !/^(?:\[(?:redacted|endpoint|host|ip|path)\]|\s)+$/i.test(hint);

  const assembled = detailUseful ? `${head} ${classHint} Detail: ${hint}` : `${head} ${classHint}`;
  // Final defensive bound (context + hint concatenation could exceed MAX_LEN).
  return normalizeAndBound(assembled);
}
