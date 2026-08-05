// connectedResourcesDigest — the PURE formatter behind cross-dashboard
// "Connected Resources" awareness. Agents currently learn about marketplace
// integrations, vault site credentials, Google Workspace, and BYOK provider
// keys from four different surfaces (or not at all), so a task like "sign into
// the Acme WordPress admin" starts blind. This module turns already-fetched,
// already-sanitized snapshots of those four surfaces into ONE compact,
// model-safe prompt block ("## Connected Resources") so the agent knows what
// is connected and which tool/credential to reach for BEFORE it plans.
//
// The RUNTIME loader (a separate module) does all IO: it fetches integration
// rows, vault credential metadata, Google Workspace status, and provider-key
// names, then calls these pure functions. This module does ZERO IO.
//
// SECRET SAFETY (lockstep discipline with marketplaceIntegrationContext.ts):
//   - Secret VALUES never appear here — only key NAMES (e.g. `bot_token`),
//     and even those pass a value-shape guard so a mis-supplied VALUE in a
//     name slot (a JWT, a password, a long base64/hex blob) is replaced with
//     '[hidden]' instead of leaking into a prompt.
//   - `SECRETISH_KEY_RE` mirrors the canonical secret-shaped key pattern.
//   - `assertNoSecretValues` lets smokes/callers prove an output block carries
//     no obvious secret material (JWT `eyJ…`, long hex, long base64 runs,
//     known key prefixes, PEM headers).
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: connected-resources-
// digest). Every export is total — degenerate/undefined/junk input never
// throws; it returns empty/neutral results instead. Deterministic: the same
// input always renders the same block.

// ── Tunables (exported so the runtime loader shares the exact same limits) ──────

/** Max integration lines rendered by summarizeIntegrationsForModel. */
export const MAX_INTEGRATIONS_SHOWN = 20;
/** Max vault credential lines rendered by summarizeVaultForModel. */
export const MAX_VAULT_CREDS_SHOWN = 15;
/** Max provider-key names rendered inline by summarizeProviderKeysForModel. */
export const MAX_PROVIDER_KEYS_SHOWN = 24;
/** Hard cap on the assembled block; overflow is cut on a line boundary. */
export const MAX_BLOCK_CHARS = 4000;

// ── Types (what the runtime loader hands us — already fetched + sanitized) ──────

export interface ConnectedIntegrationSummary {
  provider: string;
  label: string;
  status: string;
  connected: boolean;
  capabilities?: string[];
  /** Secret key NAMES only (never values), e.g. ['bot_token']. */
  configuredSecretKeys?: string[];
}

export interface VaultCredentialSummary {
  platform: string;
  label: string;
  siteUrl?: string | null;
  username?: string | null;
  allowedActions?: string[];
  hasLoginGrant?: boolean;
  loginAllowed?: boolean;
}

export interface GoogleWorkspaceSummary {
  connected: boolean;
  email?: string | null;
  /** Service ids like ['gmail','calendar','drive','sheets','docs']. */
  services?: string[];
}

export interface ProviderKeySummary {
  provider: string;
  label?: string;
}

export interface ConnectedResourcesInput {
  integrations?: ConnectedIntegrationSummary[];
  vaultCredentials?: VaultCredentialSummary[];
  googleWorkspace?: GoogleWorkspaceSummary | null;
  providerKeys?: ProviderKeySummary[];
  /** One optional caller-provided line, e.g. where the vault dashboard lives. */
  vaultDashboardHint?: string;
}

// ── Secret safety ────────────────────────────────────────────────────────────────

/**
 * Canonical secret-shaped key pattern — kept in lockstep with
 * marketplaceIntegrationContext.ts / integrationActionComposer.ts so a
 * secret-shaped key NAME (`access_token`, `client_secret`, `authorization`,
 * `private_key`, …) is treated as secretish everywhere.
 */
export const SECRETISH_KEY_RE = /(token|secret|password|passwd|pwd|key|credential|refresh|authorization|auth[_-]?header|bearer|private|cookie|session|signature)/i;

/** Value-shaped secret material found ANYWHERE inside a string. */
function containsSecretPattern(text: string): boolean {
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
  if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest/key
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-ant-… style
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub tokens
  if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack tokens
  if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  return false;
}

/** Heuristic: does this string look like a secret VALUE (not a short name)? */
function looksLikeSecretValue(text: string): boolean {
  // Secrets are spaceless; a long HUMAN phrase (label, hint) is not a secret.
  if (text.length > 40 && !/\s/.test(text)) return true;
  if (containsSecretPattern(text)) return true;
  // High-entropy-ish: a longish, spaceless, base64-alphabet mix of letters
  // and digits (typical API-key shape) — never a human label or key name.
  if (
    text.length >= 24 &&
    !/\s/.test(text) &&
    /[A-Za-z]/.test(text) &&
    /\d/.test(text) &&
    /^[A-Za-z0-9+/=._-]+$/.test(text)
  ) return true;
  return false;
}

/**
 * Return a key NAME for model display only when it is NOT secretish AND does
 * not itself look like a secret value; otherwise '[hidden]'. Total.
 */
export function redactSecretishKeyName(name: unknown): string {
  const cleaned = cleanText(name, 500);
  if (!cleaned) return '[hidden]';
  if (cleaned.length > 40) return '[hidden]'; // a key NAME is never this long
  if (SECRETISH_KEY_RE.test(cleaned)) return '[hidden]';
  if (looksLikeSecretValue(cleaned)) return '[hidden]';
  return cleaned;
}

/**
 * True when `text` carries no obvious secret material (JWT, long hex, long
 * base64 runs, known token prefixes, PEM blocks). Used by the smoke to prove
 * every rendered block is value-free. Non-string input trivially passes.
 */
export function assertNoSecretValues(text: string): boolean {
  if (typeof text !== 'string') return true;
  return !containsSecretPattern(text);
}

// ── Internal sanitize helpers (this module cannot import untrustedContent) ──────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flatten a user-influenced field for a single prompt line: drop control
 * chars / line separators (no structure forging), strip fence/tag chars,
 * collapse whitespace, clip. Returns '' for non-scalar/empty input.
 */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

/** cleanText + secret-VALUE guard: a value-shaped string becomes '[hidden]'. */
function guardValue(value: unknown, max: number): string {
  const full = cleanText(value, 500);
  if (!full) return '';
  if (looksLikeSecretValue(full)) return '[hidden]';
  return full.length > max ? `${full.slice(0, max - 1)}…` : full;
}

/**
 * Site URL for display: scheme stripped, query/fragment DROPPED entirely (a
 * `?token=…` can never survive), trailing slash trimmed, secret-pattern path
 * segments hidden.
 */
function guardUrl(value: unknown): string {
  const raw = cleanText(value, 500);
  if (!raw) return '';
  const stripped = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split(/[?#\s]/)[0]
    .replace(/\/+$/, '');
  if (!stripped) return '';
  if (containsSecretPattern(stripped)) return '[hidden]';
  return stripped.length > 80 ? `${stripped.slice(0, 79)}…` : stripped;
}

/**
 * Display guard for a configured-secret-key NAME. These are SUPPOSED to be
 * secretish names ('bot_token'), so SECRETISH_KEY_RE does not apply — but a
 * mis-supplied VALUE must still be caught: only short identifier-shaped
 * strings pass; anything value-shaped becomes '[hidden]'.
 */
function secretKeyNameForDisplay(name: unknown): string {
  const cleaned = cleanText(name, 500);
  if (!cleaned) return '';
  if (cleaned.length > 40) return '[hidden]';
  if (!/^[A-Za-z0-9_.:/-]+$/.test(cleaned)) return '[hidden]';
  if (looksLikeSecretValue(cleaned)) return '[hidden]';
  return cleaned;
}

function guardStringList(value: unknown, maxItems: number, maxEach: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = guardValue(item, maxEach);
    if (!text || text === '[hidden]') continue;
    if (!out.includes(text)) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ── Row collectors (shared by summarizers, block builder, and stats) ────────────

function listIntegrationRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> =>
    isRecord(row) && Boolean(guardValue(row.provider, 40) || guardValue(row.label, 60)));
}

function listVaultRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> =>
    isRecord(row) && Boolean(guardValue(row.platform, 40) || guardValue(row.label, 60)));
}

/** Deduped, display-safe provider names ({provider} rows or bare strings). */
function listProviderKeyNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const raw = typeof entry === 'string' ? entry : isRecord(entry) ? entry.provider : undefined;
    const name = guardValue(raw, 40);
    if (!name || name === '[hidden]') continue;
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    names.push(name);
  }
  return names;
}

function isGoogleConnected(gw: unknown): boolean {
  return isRecord(gw) && gw.connected === true;
}

// ── Summarizers ─────────────────────────────────────────────────────────────────

/**
 * Vault site credentials → model lines like:
 *   `- wordpress/Acme Blog (acme.com) — login: user@acme.com; actions: login, post; grant: login ✓`
 * loginAllowed but no login grant → `grant: none — run vault.grant`.
 * Never emits secrets. Empty/degenerate → ''.
 */
export function summarizeVaultForModel(creds: unknown): string {
  const rows = listVaultRows(creds);
  if (rows.length === 0) return '';
  const shown = rows.slice(0, MAX_VAULT_CREDS_SHOWN);
  const lines = shown.map((row) => {
    const platform = guardValue(row.platform, 40) || 'unknown';
    const label = guardValue(row.label, 60) || platform;
    const site = guardUrl(row.siteUrl);
    const head = `- ${platform}/${label}${site ? ` (${site})` : ''}`;
    const parts: string[] = [];
    const username = guardValue(row.username, 60);
    if (username) parts.push(`login: ${username}`);
    const actions = guardStringList(row.allowedActions, 6, 30);
    if (actions.length > 0) parts.push(`actions: ${actions.join(', ')}`);
    if (row.hasLoginGrant === true) parts.push('grant: login ✓');
    else if (row.loginAllowed === true) parts.push('grant: none — run vault.grant');
    return parts.length > 0 ? `${head} — ${parts.join('; ')}` : head;
  });
  if (rows.length > shown.length) lines.push(`- (+${rows.length - shown.length} more credentials not shown)`);
  return lines.join('\n');
}

/**
 * Marketplace integrations → `Connected: N/M.` header + lines like:
 *   `- Slack [slack] connected — caps: send_message; secrets: bot_token (set)`
 * configuredSecretKeys are NAMES only, each passed through a value-shape guard
 * so a mis-supplied secret VALUE renders as '[hidden]'. Empty → ''.
 */
export function summarizeIntegrationsForModel(integrations: unknown): string {
  const rows = listIntegrationRows(integrations);
  if (rows.length === 0) return '';
  const connectedCount = rows.filter((row) => row.connected === true).length;
  const lines = [`Connected: ${connectedCount}/${rows.length}.`];
  for (const row of rows.slice(0, MAX_INTEGRATIONS_SHOWN)) {
    const provider = guardValue(row.provider, 40) || 'unknown';
    const label = guardValue(row.label, 60) || provider;
    const status = guardValue(row.status, 20) || (row.connected === true ? 'connected' : 'unknown');
    const segments: string[] = [];
    const caps = guardStringList(row.capabilities, 6, 40);
    if (caps.length > 0) segments.push(`caps: ${caps.join(', ')}`);
    const secretNames: string[] = [];
    if (Array.isArray(row.configuredSecretKeys)) {
      for (const key of row.configuredSecretKeys) {
        const name = secretKeyNameForDisplay(key);
        if (name && !secretNames.includes(name)) secretNames.push(name);
        if (secretNames.length >= 8) break;
      }
    }
    if (secretNames.length > 0) segments.push(`secrets: ${secretNames.join(', ')} (set)`);
    lines.push(`- ${label} [${provider}] ${status}${segments.length > 0 ? ` — ${segments.join('; ')}` : ''}`);
  }
  if (rows.length > MAX_INTEGRATIONS_SHOWN) lines.push(`- (+${rows.length - MAX_INTEGRATIONS_SHOWN} more integrations not shown)`);
  return lines.join('\n');
}

/** Service id → the tool names the agent should reach for. */
const GOOGLE_SERVICE_TOOLS: Readonly<Record<string, string>> = {
  gmail: 'gmail.read/gmail.write',
  calendar: 'gcal.read/gcal.write',
  drive: 'gdrive.read',
  sheets: 'gsheets.*',
  docs: 'gdocs.*',
};

const GOOGLE_NOT_CONNECTED_LINE =
  'Google Workspace: not connected — connect in Circle Settings → Google Workspace to enable gmail/docs/sheets/drive/calendar tools.';

/**
 * Google Workspace status → one line mapping present services to their tool
 * names. Not connected / degenerate → a stable "not connected" pointer line.
 */
export function summarizeGoogleWorkspaceForModel(gw: unknown): string {
  if (!isGoogleConnected(gw)) return GOOGLE_NOT_CONNECTED_LINE;
  const record = gw as Record<string, unknown>;
  const emailRaw = guardValue(record.email, 60);
  const email = emailRaw && emailRaw !== '[hidden]' ? emailRaw : '';
  const services: string[] = [];
  if (Array.isArray(record.services)) {
    for (const service of record.services) {
      const name = cleanText(service, 20).toLowerCase();
      if (name && !services.includes(name)) services.push(name);
      if (services.length >= 8) break;
    }
  }
  const tools = services
    .map((service) => GOOGLE_SERVICE_TOOLS[service])
    .filter((tool): tool is string => Boolean(tool));
  const who = email ? `connected as ${email}` : 'connected';
  if (services.length === 0) return `Google Workspace: ${who}.`;
  const toolNote = tools.length > 0 ? ` (tools: ${tools.join(', ')})` : '';
  return `Google Workspace: ${who} — ${services.join(', ')}${toolNote}.`;
}

/**
 * BYOK provider keys → `Provider keys: anthropic, openai (+N more).`
 * Names only, deduped; never values. Empty → ''.
 */
export function summarizeProviderKeysForModel(keys: unknown): string {
  const names = listProviderKeyNames(keys);
  if (names.length === 0) return '';
  const shown = names.slice(0, MAX_PROVIDER_KEYS_SHOWN);
  const rest = names.length - shown.length;
  return `Provider keys: ${shown.join(', ')}${rest > 0 ? ` (+${rest} more)` : ''}.`;
}

// ── Block assembly ──────────────────────────────────────────────────────────────

const BLOCK_INTRO =
  'What this circle has connected right now. Use the matching tool; for a site login pull the credential id via vault.resolve_for_task then browser.fill_credential_field or fill_saved_login.';

/** Cut on a line boundary so a truncated block never ends mid-credential. */
function truncateOnLineBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = '… (truncated)';
  const kept: string[] = [];
  let length = 0;
  for (const line of text.split('\n')) {
    const added = (kept.length > 0 ? 1 : 0) + line.length;
    if (length + added + marker.length + 1 > maxChars) break;
    kept.push(line);
    length += added;
  }
  return `${kept.join('\n')}\n${marker}`.slice(0, maxChars).trimStart() || marker.slice(0, maxChars);
}

/**
 * Assemble the full `## Connected Resources` prompt block. Skips empty
 * sub-sections; returns '' when genuinely nothing is connected (no
 * integrations, no vault creds, Google not connected, no provider keys) so
 * callers can skip pushing an empty section. Capped at MAX_BLOCK_CHARS.
 */
export function buildConnectedResourcesBlock(input: ConnectedResourcesInput | null | undefined): string {
  if (!isRecord(input)) return '';
  const integrations = summarizeIntegrationsForModel(input.integrations);
  const vault = summarizeVaultForModel(input.vaultCredentials);
  const googleConnected = isGoogleConnected(input.googleWorkspace);
  const providerKeys = summarizeProviderKeysForModel(input.providerKeys);
  if (!integrations && !vault && !googleConnected && !providerKeys) return '';

  const sections: string[] = [`## Connected Resources\n${BLOCK_INTRO}`];
  if (integrations) {
    const [head, ...rest] = integrations.split('\n');
    sections.push([`Marketplace integrations — ${head}`, ...rest].join('\n'));
  }
  if (vault) sections.push(`Vault site credentials:\n${vault}`);
  // The Google line is always informative once the block exists: either which
  // tools are live, or the stable pointer for connecting them.
  sections.push(summarizeGoogleWorkspaceForModel(input.googleWorkspace));
  if (providerKeys) sections.push(providerKeys);
  const hint = guardValue(input.vaultDashboardHint, 240);
  if (hint && hint !== '[hidden]') sections.push(hint);

  return truncateOnLineBoundary(sections.join('\n\n'), MAX_BLOCK_CHARS);
}

/** Cheap counts for logging/telemetry — same row validity rules as the block. */
export function connectedResourcesStats(input: unknown): {
  integrations: number;
  vaultCredentials: number;
  googleConnected: boolean;
  providerKeys: number;
} {
  if (!isRecord(input)) {
    return { integrations: 0, vaultCredentials: 0, googleConnected: false, providerKeys: 0 };
  }
  return {
    integrations: listIntegrationRows(input.integrations).length,
    vaultCredentials: listVaultRows(input.vaultCredentials).length,
    googleConnected: isGoogleConnected(input.googleWorkspace),
    providerKeys: listProviderKeyNames(input.providerKeys).length,
  };
}
