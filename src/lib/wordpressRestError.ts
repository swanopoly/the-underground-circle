/**
 * wordpressRestError — pure redactor for WordPress REST error bodies before
 * they reach chat copy, logs, or persisted metadata.
 *
 * Dependency-light on purpose: no react-native, no fetch, no runtime imports.
 * The project's general redactText lives in a root-owned module that cannot be
 * imported from here, so this is a minimal, self-contained redactor scoped to
 * WP REST responses.
 *
 * Goals:
 *  - Map known WP REST error codes (rest_not_logged_in, rest_forbidden,
 *    rest_cannot_create/edit/delete, rest_post_invalid_id, ...) to short, safe
 *    human messages.
 *  - Never echo a raw response body. Strip HTML tags and any
 *    Authorization/Basic/Bearer/app-password-like fragments, then cap length.
 *  - Preserve the HTTP status so callers keep useful signal.
 */

const KNOWN_CODE_MESSAGES: Record<string, string> = {
  rest_not_logged_in: 'WordPress rejected the request as unauthenticated (check the app password).',
  rest_cannot_create: 'WordPress denied creating this resource (insufficient permissions).',
  rest_cannot_edit: 'WordPress denied editing this resource (insufficient permissions).',
  rest_cannot_delete: 'WordPress denied deleting this resource (insufficient permissions).',
  rest_forbidden: 'WordPress forbade this request (insufficient permissions).',
  rest_forbidden_context: 'WordPress forbade this request context (insufficient permissions).',
  rest_post_invalid_id: 'WordPress could not find a post with that ID.',
  rest_invalid_param: 'WordPress rejected an invalid request parameter.',
  rest_no_route: 'WordPress REST route not found at this URL (REST API may be disabled).',
  rest_user_cannot_view: 'WordPress denied viewing this resource (insufficient permissions).',
};

const STATUS_MESSAGES: Record<number, string> = {
  401: 'WordPress authentication failed (check the app password).',
  403: 'WordPress denied the request (insufficient permissions).',
  404: 'WordPress could not find that resource or REST route.',
  409: 'WordPress reported a conflict with the existing resource.',
  413: 'WordPress rejected the request as too large.',
  429: 'WordPress is rate-limiting requests; try again shortly.',
  500: 'WordPress returned a server error.',
  502: 'WordPress is unreachable (bad gateway).',
  503: 'WordPress is temporarily unavailable.',
};

const MAX_LEN = 160;

/** Strip secret-bearing and markup fragments from an arbitrary string. */
function stripSensitive(input: string): string {
  return String(input)
    .replace(/<[^>]*>/g, ' ') // HTML tags
    .replace(/&[a-z#0-9]+;/gi, ' ') // HTML entities
    // Strip Basic/Bearer token (incl. any "Authorization:" prefix) before the
    // generic header strip so the base64/token payload is removed, not just
    // the scheme word.
    .replace(/(?:\bAuthorization\s*:\s*)?\bBasic\s+[A-Za-z0-9+/=]+/gi, '[redacted]')
    .replace(/(?:\bAuthorization\s*:\s*)?\bBearer\s+[A-Za-z0-9._-]+/gi, '[redacted]')
    .replace(/\bAuthorization\s*:\s*\S+/gi, '[redacted]')
    // WP application passwords: 4-char groups separated by spaces (24 chars).
    .replace(/\b(?:[A-Za-z0-9]{4}\s+){5}[A-Za-z0-9]{4}\b/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Try to pull a `code` field from a JSON WP error body without trusting it. */
function extractCode(body: string): string | undefined {
  const m = body.match(/"code"\s*:\s*"([a-z0-9_]+)"/i);
  return m ? m[1] : undefined;
}

/**
 * Produce a short, safe, secret-free message for a WP REST failure. Never
 * returns the raw body. `codeHint` lets callers pass a known code directly;
 * otherwise a best-effort `code` is parsed from the JSON body.
 */
export function redactRestError(
  rawBody: unknown,
  status: number,
  codeHint?: string,
): string {
  const body = typeof rawBody === 'string' ? rawBody : '';
  const code = (codeHint || extractCode(body) || '').toLowerCase();

  const codeMsg = code && KNOWN_CODE_MESSAGES[code];
  const statusMsg = STATUS_MESSAGES[status];
  const base = codeMsg || statusMsg || 'WordPress rejected the request.';

  const safeStatus = Number.isFinite(status) && status > 0 ? `HTTP ${status}` : 'HTTP error';
  // If we matched a known code/status message, that is enough — do NOT append
  // any slice of the raw body. Only when we have no mapping do we surface a
  // sanitized, capped hint so a novel error is not totally opaque.
  if (codeMsg || statusMsg) {
    return `${safeStatus}: ${base}`;
  }
  const sanitized = stripSensitive(body).slice(0, MAX_LEN);
  return sanitized ? `${safeStatus}: ${base} (${sanitized})` : `${safeStatus}: ${base}`;
}
