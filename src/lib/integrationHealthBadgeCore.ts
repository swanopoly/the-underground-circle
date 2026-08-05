/**
 * integrationHealthBadgeCore — pure health-badge policy for Marketplace
 * integration cards (the silent-bad-key trust bug).
 *
 * ─── The bug this exists to surface ─────────────────────────────────
 * `connectGenericCircleIntegration` probes a newly saved provider key and, on
 * rejection, stores `status: 'degraded'` + `metadata.last_validation_error` —
 * but the Marketplace UI historically hardcoded `connected: true` and never
 * read either field. A dead key showed a green pip and "Connected" copy until
 * an agent run died mid-task. This core turns the stored truth into one
 * bounded, secret-safe badge the UI can render without re-deriving policy.
 *
 * ─── Composition ────────────────────────────────────────────────────
 * - `status` / `lastValidationError` come from the `circle_integrations` row
 *   (`status`, `metadata.last_validation_error`).
 * - `validationOk` is an OPTIONAL fresh re-validation outcome (e.g. a live
 *   "Re-test key" probe just returned). `true` overrides stale stored
 *   degradation; `false` forces at least a warning.
 * - `healthHint` composes `integrationHealthRegistry`'s
 *   `getIntegrationHealthHintNow(key)` output (a bounded warn string like
 *   "⚠️ last call failed (HTTP 500), 2 in a row", or null). A non-null hint
 *   downgrades an otherwise-healthy badge to a warning — fail-visible.
 * - `buildIntegrationSaveHealthState` is the save-path twin used by
 *   `connectGenericCircleIntegration`: it makes a SUCCESSFUL (re-)save
 *   explicitly write the healthy state (`status: 'connected'`,
 *   `last_validation_error: null`) so `upsertCircleIntegration`'s
 *   metadata merge cannot resurrect a stale error.
 *
 * ─── Guarantees ─────────────────────────────────────────────────────
 * - Pure: no I/O, no react-native, no Date.now(). Smoke-testable via tsx.
 * - Total: never throws, for any input shape (unknown-typed fields are
 *   coerced defensively).
 * - Secret-safe: validation-error text is scrubbed of token-like content
 *   (sk-/hf-/ghp-style prefixes, Bearer values, JWTs, AKIA ids, key=value
 *   pairs, long opaque runs) before it can reach a label or detail line.
 * - Bounded: labels ≤ 60 chars, detail ≤ 120 chars, stored error ≤ 300.
 */

export type IntegrationHealthTone = 'ok' | 'warn' | 'danger';

export interface IntegrationHealthBadgeInput {
  /** `circle_integrations.status` — 'connected' | 'degraded' | 'disabled' | 'planned' (unknown values tolerated). */
  status?: unknown;
  /** `metadata.last_validation_error` from the integration row. */
  lastValidationError?: unknown;
  /** Fresh re-validation outcome, when one just ran. `true` overrides stale stored degradation. */
  validationOk?: boolean | null;
  /** `getIntegrationHealthHintNow(key)` output — bounded warn string or null. */
  healthHint?: unknown;
}

export interface IntegrationHealthBadge {
  tone: IntegrationHealthTone;
  /** Short badge copy, e.g. 'Connected' | 'Key rejected (401)' | 'Degraded' | 'Not connected'. */
  label: string;
  /** Bounded human sentence for the expandable line, or null when there is nothing to add. */
  detail: string | null;
  /** True when a "Re-test key" affordance makes sense (something is degraded and retestable). */
  showRetest: boolean;
}

/** Hard bound for the expandable detail line. */
export const HEALTH_DETAIL_MAX_CHARS = 120;
/** Hard bound for the badge label. */
export const HEALTH_LABEL_MAX_CHARS = 60;
/** Hard bound for the error text persisted into integration metadata. */
export const HEALTH_STORED_ERROR_MAX_CHARS = 300;

// ── Secret scrubbing ─────────────────────────────────────────────────

const SECRET_PATTERNS: RegExp[] = [
  // Bearer <token>
  /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  // key=value / token: value style pairs
  /\b(?:api[-_]?key|api[-_]?token|token|secret|password|authorization|x-subscription-token)\s*[:=]\s*\S+/gi,
  // common provider key prefixes (sk-, pk-, rk-, hf_, ghp_, glpat-, xoxb-, …)
  /\b(?:sk|pk|rk|hf|ghp|gho|ghu|ghs|ghr|glpat|npm|xox[a-z])[-_][A-Za-z0-9_-]{4,}/gi,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{6,}\b/g,
  // JWT-looking blobs
  /\beyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,}){0,2}/g,
  // any long opaque alphanumeric run — nothing human reads like this
  /\b[A-Za-z0-9_-]{24,}\b/g,
];

/** Coerce anything to a trimmed single-line string without ever throwing. */
function coerceText(value: unknown): string {
  if (value == null || typeof value === 'symbol' || typeof value === 'function') return '';
  let raw: string;
  try {
    raw = typeof value === 'string' ? value : String(value);
  } catch {
    return '';
  }
  // Objects stringify uselessly ('[object Object]') — treat as empty.
  if (/^\[object .*\]$/.test(raw)) return '';
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function boundText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Strip token-like content from arbitrary error/hint text and bound it.
 * Never throws; returns '' for unusable input.
 */
export function sanitizeIntegrationHealthText(
  value: unknown,
  maxChars: number = HEALTH_DETAIL_MAX_CHARS,
): string {
  let text = coerceText(value);
  if (!text) return '';
  for (const pattern of SECRET_PATTERNS) {
    try {
      text = text.replace(pattern, '[redacted]');
    } catch {
      return '';
    }
  }
  const max = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : HEALTH_DETAIL_MAX_CHARS;
  return boundText(text.replace(/\s+/g, ' ').trim(), max);
}

// ── Validation-error classification ──────────────────────────────────

type ErrorKind = 'unauthorized' | 'forbidden' | 'rate_limited' | 'network' | 'other';

function classifyValidationError(text: string): ErrorKind {
  if (/\b401\b|unauthori[sz]ed|invalid[ _-]?(?:api[ _-]?)?key|rejected the (?:key|token|api key)/i.test(text)) {
    return 'unauthorized';
  }
  if (/\b403\b|forbidden|permission denied/i.test(text)) return 'forbidden';
  if (/\b429\b|rate.?limit|too many requests|quota exceeded/i.test(text)) return 'rate_limited';
  if (/time[d]?[ -]?out|timeout|abort|network|fetch failed|failed to fetch|econn|enotfound|eai_again|socket|dns|offline|unreachable/i.test(text)) {
    return 'network';
  }
  return 'other';
}

const RETEST_DETAIL_401 = 'Re-paste the key or check the provider dashboard.';
const RETEST_DETAIL_403 = 'The provider refused this key (403). Check its permissions or create a new key.';
const RETEST_DETAIL_429 = 'The provider is rate limiting this key. Wait a minute, then re-test.';
const RETEST_DETAIL_NETWORK = 'The key check could not reach the provider. Check your network, then re-test.';
const DETAIL_SETUP_INCOMPLETE = 'Setup is incomplete for this integration. Open Setup & connect to finish it.';
const DETAIL_NOT_CONNECTED = 'Connect this provider to use it in chat, agents, and automations.';

function makeBadge(
  tone: IntegrationHealthTone,
  label: string,
  detail: string | null,
  showRetest: boolean,
): IntegrationHealthBadge {
  return {
    tone,
    label: boundText(label, HEALTH_LABEL_MAX_CHARS) || 'Degraded',
    detail: detail ? boundText(detail, HEALTH_DETAIL_MAX_CHARS) : null,
    showRetest: !!showRetest,
  };
}

function degradedBadgeFromError(errorText: string, hintText: string): IntegrationHealthBadge {
  const kind = classifyValidationError(errorText);
  switch (kind) {
    case 'unauthorized':
      return makeBadge('danger', 'Key rejected (401)', RETEST_DETAIL_401, true);
    case 'forbidden':
      return makeBadge('danger', 'Key rejected (403)', RETEST_DETAIL_403, true);
    case 'rate_limited':
      return makeBadge('warn', 'Rate limited (429)', RETEST_DETAIL_429, true);
    case 'network':
      return makeBadge('warn', 'Degraded', RETEST_DETAIL_NETWORK, true);
    case 'other': {
      const detail = sanitizeIntegrationHealthText(errorText)
        || sanitizeIntegrationHealthText(hintText)
        || DETAIL_SETUP_INCOMPLETE;
      return makeBadge('warn', 'Degraded', detail, true);
    }
  }
}

const NOT_CONNECTED_STATUSES = new Set(['disabled', 'planned', 'disconnected', 'inactive', 'revoked', 'pending']);

/**
 * Build the health badge for one integration. Total: any input shape returns
 * a well-formed badge; nothing token-like survives into label/detail.
 */
export function buildIntegrationHealthBadge(
  input?: IntegrationHealthBadgeInput | null,
): IntegrationHealthBadge {
  const inp = input && typeof input === 'object' ? input : ({} as IntegrationHealthBadgeInput);
  const status = coerceText(inp.status).toLowerCase();
  const errorText = coerceText(inp.lastValidationError);
  const hintText = coerceText(inp.healthHint);
  const validationOk = inp.validationOk === true ? true : inp.validationOk === false ? false : null;

  // No stored status at all → the integration is not connected.
  if (!status || NOT_CONNECTED_STATUSES.has(status)) {
    return makeBadge('warn', 'Not connected', DETAIL_NOT_CONNECTED, false);
  }

  // A fresh, explicit probe success overrides stale stored degradation —
  // but a live runtime-failure hint still downgrades (fail-visible).
  if (validationOk === true) {
    if (hintText) {
      return makeBadge('warn', 'Degraded', sanitizeIntegrationHealthText(hintText) || DETAIL_SETUP_INCOMPLETE, true);
    }
    return makeBadge('ok', 'Connected', null, false);
  }

  const looksDegraded = status === 'degraded' || status === 'error' || status === 'failed'
    || validationOk === false || !!errorText;

  if (!looksDegraded) {
    if (hintText) {
      // Connected on paper, but recent live calls are failing.
      return makeBadge('warn', 'Degraded', sanitizeIntegrationHealthText(hintText) || DETAIL_SETUP_INCOMPLETE, true);
    }
    return makeBadge('ok', 'Connected', null, false);
  }

  if (errorText) return degradedBadgeFromError(errorText, hintText);
  if (hintText) {
    return makeBadge('warn', 'Degraded', sanitizeIntegrationHealthText(hintText) || DETAIL_SETUP_INCOMPLETE, true);
  }
  return makeBadge('warn', 'Degraded', DETAIL_SETUP_INCOMPLETE, true);
}

// ── Save-path twin: explicit healthy/degraded write state ────────────

export interface IntegrationSaveHealthState {
  status: 'connected' | 'degraded';
  /** Merge into the metadata written by `upsertCircleIntegration`. `null`
   *  explicitly clears a stale `last_validation_error` through the merge. */
  metadataPatch: { last_validation_error: string | null };
}

/**
 * The state `connectGenericCircleIntegration` must write after (re-)validating
 * a save. On SUCCESS this explicitly clears `last_validation_error` (the
 * upsert merges metadata, so omission would preserve a stale error forever)
 * and resets status to 'connected'. On failure it stores a sanitized,
 * bounded error so the badge/agent layers can classify it without ever
 * persisting token-like content.
 */
export function buildIntegrationSaveHealthState(opts?: {
  status?: 'connected' | 'degraded' | null;
  validationMessage?: string | null;
} | null): IntegrationSaveHealthState {
  const o = opts && typeof opts === 'object' ? opts : {};
  const message = coerceText(o.validationMessage);
  const degraded = o.status === 'degraded' || !!message;
  if (!degraded) {
    return { status: 'connected', metadataPatch: { last_validation_error: null } };
  }
  const stored = sanitizeIntegrationHealthText(message, HEALTH_STORED_ERROR_MAX_CHARS);
  return {
    status: 'degraded',
    metadataPatch: { last_validation_error: stored || 'validation failed' },
  };
}
