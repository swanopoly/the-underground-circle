/**
 * integrationActionReceipt — closes the action→proof loop for the integrations
 * arc (P30-P33). Given the RESULT of a `custom_api.request` or
 * `messaging.notify` tool call, it extracts a structured, secret-safe outcome:
 * a verdict (from HTTP status), a one-line summary, and — when the API returned
 * one — the created/affected resource's URL or id (e.g. the new GitHub issue's
 * html_url, the Jira key, the Linear issue url). That resource is the PROOF the
 * accountability card (agentReceipt / AgentReceiptCard) and the tool result
 * surface, so "it created a Linear issue" is verifiable, not buried in the raw
 * response preview.
 *
 * Pure module — no imports, no side effects — so it loads under tsx for
 * scripts/integration-action-receipt-smoketest.ts and can be used from both
 * openswanToolRuntime (result formatting) and the receipt builder.
 *
 * Secret-safe by construction: it only ever surfaces URL/id-shaped values under
 * a known-safe set of keys, strips secret-shaped query params from URLs, and
 * rejects token-shaped id values. It never echoes auth, bodies, or headers.
 */

export type IntegrationActionVerdict =
  | 'success'
  | 'client_error'
  | 'server_error'
  | 'blocked'
  | 'unknown';

export interface IntegrationActionResource {
  /** A clickable https URL, or a short human id/key. */
  kind: 'link' | 'id';
  /** The URL or id — bounded and secret-scrubbed. */
  ref: string;
  /** Best-effort label, e.g. "GitHub issue", "Jira key", "resource". */
  label: string;
}

export interface IntegrationActionOutcome {
  ok: boolean;
  verdict: IntegrationActionVerdict;
  status: number | null;
  /** "HTTP 201" / "blocked" / "HTTP 404". */
  statusLine: string;
  /** "POST /issues on GitHub" / "Post to Slack". */
  action: string;
  /** The created/affected resource, when the response exposed one. */
  resource: IntegrationActionResource | null;
  /** Provider echo for messaging posts (e.g. "ok"), bounded. */
  providerMessage: string | null;
  /** One line for chat/receipt: "✅ Created GitHub issue: https://…". */
  summary: string;
}

export interface CustomApiActionResultInput {
  tool: 'custom_api.request';
  ok?: boolean;
  status?: number | null;
  method?: string | null;
  /** The visible URL the proxy returned (origin+path, no secrets). */
  url?: string | null;
  integrationLabel?: string | null;
  /** The response body preview the proxy returned (capped, untrusted). */
  bodyPreview?: string | null;
}

export interface MessagingActionResultInput {
  tool: 'messaging.notify';
  ok?: boolean;
  status?: number | null;
  provider?: string | null;
  integrationLabel?: string | null;
  providerMessage?: string | null;
}

export type IntegrationActionResultInput = CustomApiActionResultInput | MessagingActionResultInput;

// ── Bounds + secret defenses ─────────────────────────────────────────────────

const MAX_REF_LENGTH = 400;
const MAX_ID_LENGTH = 120;
const MAX_LABEL_LENGTH = 40;
const MAX_PROVIDER_MESSAGE_LENGTH = 160;
const MAX_SUMMARY_LENGTH = 240;
const MAX_WALK_DEPTH = 6;
const MAX_WALK_NODES = 400;

/** Mirrors the server SECRETISH_KEY_RE — a value under such a key is never surfaced. */
const SECRETISH_KEY_RE =
  /(secret|token|password|passwd|private|credential|api[_-]?key|access[_-]?key|refresh|client[_-]?secret|authorization|auth|bearer|apikey|cookie|session|signature|sig)/i;

/** URL-valued keys, in preference order — the created-resource permalink. */
const URL_KEYS = [
  'html_url',
  'permalink_url',
  'permalink',
  'web_url',
  'browser_url',
  'short_url',
  'shortUrl',
  'url',
  'link',
  'self',
  'uri',
];

/** Id/key-valued keys, in preference order — the human-facing handle. */
const ID_KEYS = ['identifier', 'key', 'number', 'iid', 'id', 'gid', 'sid', 'ts', 'slug', 'name'];

/** A value that looks like a leaked secret/token — never surfaced as an id. */
const TOKEN_SHAPED_RE = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_\-]{28,}$/;

function clip(value: string, max: number): string {
  const t = String(value || '').replace(/[\r\n\t]+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Keep only an https URL; strip any secret-shaped query params; bound length. */
function sanitizeUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^https:\/\/[^\s]+$/i.test(s)) return null; // https only, no spaces
  const qIndex = s.indexOf('?');
  if (qIndex < 0) return s.length <= MAX_REF_LENGTH ? s : null;
  const base = s.slice(0, qIndex);
  const query = s.slice(qIndex + 1);
  const kept = query
    .split('&')
    .filter((pair) => {
      const key = pair.split('=')[0] || '';
      return key && !SECRETISH_KEY_RE.test(key);
    });
  const rebuilt = kept.length > 0 ? `${base}?${kept.join('&')}` : base;
  return rebuilt.length <= MAX_REF_LENGTH ? rebuilt : base.slice(0, MAX_REF_LENGTH);
}

/** Accept a short, non-secret scalar id/key. */
function sanitizeId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > MAX_ID_LENGTH) return null;
  if (TOKEN_SHAPED_RE.test(s)) return null; // looks like a token → drop
  if (/^https?:\/\//i.test(s)) return null; // URL-shaped ids are handled by the URL path
  return s;
}

/**
 * Walk a parsed JSON value (bounded) collecting the best URL-keyed https value
 * and the best id-keyed scalar, honoring key preference order and skipping
 * secret-shaped keys entirely.
 */
function walkForResource(root: unknown): { url?: { key: string; value: string }; id?: { key: string; value: string } } {
  let bestUrl: { rank: number; key: string; value: string } | undefined;
  let bestId: { rank: number; key: string; value: string } | undefined;
  let nodes = 0;

  const visit = (value: unknown, depth: number): void => {
    if (nodes >= MAX_WALK_NODES || depth > MAX_WALK_DEPTH) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (nodes >= MAX_WALK_NODES) break;
        nodes += 1;
        visit(item, depth + 1);
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [rawKey, v] of Object.entries(value as Record<string, unknown>)) {
      if (nodes >= MAX_WALK_NODES) break;
      nodes += 1;
      const key = rawKey.toLowerCase();
      if (SECRETISH_KEY_RE.test(key)) continue; // never surface anything under a secret-shaped key

      const urlRank = URL_KEYS.indexOf(rawKey) >= 0 ? URL_KEYS.indexOf(rawKey) : URL_KEYS.indexOf(key);
      if (urlRank >= 0) {
        const clean = sanitizeUrl(v);
        if (clean && (!bestUrl || urlRank < bestUrl.rank)) bestUrl = { rank: urlRank, key: rawKey, value: clean };
      }
      const idRank = ID_KEYS.indexOf(rawKey) >= 0 ? ID_KEYS.indexOf(rawKey) : ID_KEYS.indexOf(key);
      if (idRank >= 0) {
        const clean = sanitizeId(v);
        if (clean && (!bestId || idRank < bestId.rank)) bestId = { rank: idRank, key: rawKey, value: clean };
      }
      if (v && typeof v === 'object') visit(v, depth + 1);
    }
  };

  visit(root, 0);
  return {
    url: bestUrl ? { key: bestUrl.key, value: bestUrl.value } : undefined,
    id: bestId ? { key: bestId.key, value: bestId.value } : undefined,
  };
}

/** Best-effort JSON parse of a (possibly truncated) response preview. */
function tryParseJson(text: string | null | undefined): unknown {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // A truncated preview won't parse; try the first balanced object.
    const start = raw.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < raw.length; i += 1) {
      const ch = raw[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { if (inString) escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; } } }
    }
    return null;
  }
}

function verdictFromStatus(ok: boolean, status: number | null): IntegrationActionVerdict {
  if (status !== null) {
    if (status >= 200 && status < 300) return ok ? 'success' : 'client_error';
    if (status >= 400 && status < 500) return 'client_error';
    if (status >= 500) return 'server_error';
  }
  if (ok) return 'success';
  return status === null ? 'blocked' : 'unknown';
}

/** Label the resource from the URL host or the API label — never a secret. */
function labelResource(apiLabel: string | null | undefined, url: string | null, idKey: string | null): string {
  const api = apiLabel ? clip(apiLabel, 24) : '';
  if (idKey && /key|identifier|number|iid/i.test(idKey)) return clip(`${api || 'resource'} ${idKey}`, MAX_LABEL_LENGTH);
  if (api) return clip(`${api} resource`, MAX_LABEL_LENGTH);
  return 'resource';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Build a structured, secret-safe outcome from an integration tool result.
 * Never throws.
 */
export function buildIntegrationActionOutcome(input: IntegrationActionResultInput): IntegrationActionOutcome {
  const ok = input?.ok === true;
  const status = typeof input?.status === 'number' && Number.isFinite(input.status) ? input.status : null;
  const verdict = verdictFromStatus(ok, status);
  const statusLine = status !== null ? `HTTP ${status}` : (ok ? 'ok' : 'blocked');

  if (input?.tool === 'messaging.notify') {
    const provider = clip(input.provider || input.integrationLabel || 'channel', 24) || 'channel';
    const providerMessage = input.providerMessage ? clip(input.providerMessage, MAX_PROVIDER_MESSAGE_LENGTH) : null;
    const action = `Post to ${provider}`;
    const summary = verdict === 'success'
      ? `✅ Posted to ${provider}${status !== null ? ` (${statusLine})` : ''}`
      : `⚠️ Could not post to ${provider} — ${statusLine}${providerMessage ? `: ${providerMessage}` : ''}`;
    return { ok, verdict, status, statusLine, action, resource: null, providerMessage, summary: clip(summary, MAX_SUMMARY_LENGTH) };
  }

  // custom_api.request
  const apiLabel = input.integrationLabel ? clip(input.integrationLabel, 24) : 'Custom API';
  const method = input.method ? String(input.method).toUpperCase() : 'REQUEST';
  const visibleUrl = typeof input.url === 'string' ? input.url : '';
  const pathPart = visibleUrl.replace(/^https?:\/\/[^/]+/i, '') || visibleUrl;
  const action = `${method} ${pathPart || '(endpoint)'} on ${apiLabel}`;

  let resource: IntegrationActionResource | null = null;
  if (verdict === 'success') {
    const found = walkForResource(tryParseJson(input.bodyPreview));
    if (found.url) {
      resource = { kind: 'link', ref: found.url.value, label: labelResource(apiLabel, found.url.value, found.id?.key || null) };
    } else if (found.id) {
      resource = { kind: 'id', ref: found.id.value, label: labelResource(apiLabel, null, found.id.key) };
    }
  }

  let summary: string;
  const verbed = method === 'POST' ? 'Created' : method === 'DELETE' ? 'Deleted' : 'Updated';
  if (verdict === 'success') {
    if (resource) {
      summary = `✅ ${verbed} ${resource.label}: ${resource.ref}`;
    } else {
      summary = `✅ ${verbed} on ${apiLabel} (${statusLine})`;
    }
  } else if (verdict === 'client_error') {
    summary = `⚠️ ${apiLabel} rejected the ${method} — ${statusLine} (check the path/body).`;
  } else if (verdict === 'server_error') {
    summary = `⚠️ ${apiLabel} server error on ${method} — ${statusLine} (retry later).`;
  } else if (verdict === 'blocked') {
    summary = `⚠️ ${method} on ${apiLabel} was blocked before sending.`;
  } else {
    summary = `${method} on ${apiLabel} — ${statusLine}.`;
  }

  return { ok, verdict, status, statusLine, action, resource, providerMessage: null, summary: clip(summary, MAX_SUMMARY_LENGTH) };
}

/**
 * The receipt lines to lead a tool result with — the proof first, then the
 * caller appends the raw preview. Bounded; safe to show the model + the user.
 */
export function buildIntegrationReceiptLines(outcome: IntegrationActionOutcome): string[] {
  const lines = [outcome.summary];
  if (outcome.resource && outcome.resource.kind === 'id') {
    // Make the id explicit as a separate line so it's easy to reference.
    lines.push(`Ref: ${outcome.resource.ref}`);
  }
  return lines;
}

export interface ExtractedIntegrationReceipt {
  /** Proof label, e.g. "Created GitHub issue: https://…" (leading ✅ stripped). */
  label: string;
  /** A scrubbed https URL when the result carried one, else null. */
  ref: string | null;
}

/**
 * Pull a proof from a persisted integration TOOL EVENT — the receipt-card
 * bridge (agentReceipt). The event's `result` text was produced by the
 * openswanToolRuntime formatter, which leads a successful write/post with a
 * "✅ Created <resource>: <url>" line (see buildIntegrationReceiptLines). This
 * reads that structured lead line back out so an `/integrations act` turn shows
 * a real proof in the accountability card. Returns null for non-integration
 * tools, failed events, or results with no ✅ success line (so only genuine
 * successes become proof). Secret-safe — any URL is scrubbed by sanitizeUrl.
 */
export function extractIntegrationReceiptFromToolEvent(input: {
  tool?: string | null;
  result?: string | null;
  status?: string | null;
}): ExtractedIntegrationReceipt | null {
  const tool = String(input?.tool || '');
  if (tool !== 'custom_api.request' && tool !== 'messaging.notify') return null;
  if (input?.status && input.status !== 'completed') return null;
  const text = String(input?.result || '');
  if (!text) return null;
  const firstLine = text.split('\n').map((s) => s.trim()).find(Boolean) || '';
  if (!/^✅/.test(firstLine)) return null; // only a success proof becomes a receipt
  const urlMatch = text.match(/https:\/\/[^\s)\]]+/);
  const ref = urlMatch ? sanitizeUrl(urlMatch[0]) : null;
  const label = clip(firstLine.replace(/^✅\s*/, ''), 90) || 'Integration action';
  return { label, ref };
}
