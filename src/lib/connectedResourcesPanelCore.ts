// connectedResourcesPanelCore — the PURE model behind the user-facing
// "What's connected" panel. The AGENT already gets a rich per-turn Connected
// Resources prompt block (connectedResourcesRuntime → connectedResourcesDigest),
// but the USER had no single view of what their agent can touch: marketplace
// integrations, vault site logins, Google Workspace, and BYOK provider keys
// each live on their own dashboard. This module turns the SAME structured
// `ConnectedResourcesInput` snapshot the prompt path builds into four
// user-facing rows — Integrations · Vault logins · Google Workspace ·
// Provider keys — each with a bounded name list and a "Connect more →" action.
//
// SECRET SAFETY (lockstep with connectedResourcesDigest.ts): the panel model
// carries NAMES/labels only, never values. Every user-influenced string passes
// a value-shape guard (JWT/hex/base64/token-prefix/bearer patterns, spaceless
// high-entropy shapes) and is DROPPED when it looks like a secret value —
// a user panel never needs to render '[hidden]' noise. configuredSecretKeys
// are never surfaced at all (only their existence via the digest's prompt
// path); provider names route through `redactSecretishKeyName`.
//
// PURITY: imports ONLY the pure digest module (types + secret helpers), so it
// loads under tsx (smoke: connected-resources-panel-core). Every export is
// total — degenerate/undefined/junk input never throws; empty input yields the
// fresh-circle onboarding state (all rows "Not connected" with connect
// actions). Deterministic.

import {
  assertNoSecretValues,
  connectedResourcesStats,
  redactSecretishKeyName,
  type ConnectedResourcesInput,
} from './connectedResourcesDigest';

// ── Tunables ────────────────────────────────────────────────────────────────────

/** Max item names shown per row before collapsing into '+N more'. */
export const MAX_PANEL_ITEMS_PER_ROW = 6;
/** Max chars per rendered item name. */
export const MAX_PANEL_ITEM_CHARS = 48;

// ── Types ───────────────────────────────────────────────────────────────────────

export type ConnectedResourcePanelRowKey =
  | 'integrations'
  | 'vault'
  | 'google'
  | 'provider_keys';

/**
 * connected — at least one live connection; partial — something exists but
 * needs a step (integrations configured but none connected, a login without
 * its automation grant); empty — nothing connected yet.
 */
export type ConnectedResourcePanelTone = 'connected' | 'partial' | 'empty';

export interface ConnectedResourcePanelAction {
  label: string;
  /** CircleDetailScreen tab key for the `uc:switch-tab` event, when one exists. */
  targetTab?: string;
}

export interface ConnectedResourcePanelRow {
  key: ConnectedResourcePanelRowKey;
  icon: string;
  title: string;
  /** e.g. '3 connected' / 'Not connected'. */
  countLabel: string;
  tone: ConnectedResourcePanelTone;
  /** Bounded display names (≤ MAX_PANEL_ITEMS_PER_ROW, then one '+N more'). */
  items: string[];
  connectAction: ConnectedResourcePanelAction;
}

export interface ConnectedResourcesPanelModel {
  /** Always exactly four rows, in fixed order. */
  rows: ConnectedResourcePanelRow[];
  /** One-line collapsed summary: `Integrations 3 · Vault logins 2 · Google ✓ · Provider keys 4`. */
  summaryLine: string;
  /** How many of the four sections have at least one live connection (0–4). */
  connectedSectionCount: number;
}

// ── Secret-safe display helpers ─────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A user-facing display name: control chars/fences stripped, whitespace
 * collapsed, clipped — and DROPPED ('') when anything about it is
 * value-shaped. Stricter than the digest's prompt guard: short token
 * prefixes (`sk-…`, `ghp_…`, `xox…`) and `Bearer <x>` phrases are rejected
 * even below the digest's length thresholds, because a panel item is a
 * short human label and never legitimately contains them.
 */
function safeDisplayName(value: unknown, max: number = MAX_PANEL_ITEM_CHARS): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return '';
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/[<>`]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!text) return '';
  // Digest-shared value patterns (JWT, long hex, long base64, PEM, AWS, …).
  if (!assertNoSecretValues(text)) return '';
  // Short key-prefix shapes a human label never carries.
  if (/\b(?:sk|rk|pk)[-_][A-Za-z0-9_-]{3,}/i.test(text)) return '';
  if (/\bgh[pousr]_[A-Za-z0-9]{3,}/i.test(text)) return '';
  if (/\bxox[bpsae]-[A-Za-z0-9-]{3,}/i.test(text)) return '';
  if (/\bbearer\s+\S+/i.test(text)) return '';
  // Spaceless high-entropy / over-long runs are value-shaped, not labels.
  if (text.length > 40 && !/\s/.test(text)) return '';
  if (
    text.length >= 24 &&
    !/\s/.test(text) &&
    /[A-Za-z]/.test(text) &&
    /\d/.test(text) &&
    /^[A-Za-z0-9+/=._-]+$/.test(text)
  ) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Dedupe + bound a name list; overflow collapses into one '+N more' entry. */
function boundItems(names: string[], totalCount?: number): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(name);
  }
  const total = typeof totalCount === 'number' && totalCount > deduped.length
    ? totalCount
    : deduped.length;
  if (deduped.length <= MAX_PANEL_ITEMS_PER_ROW && total <= deduped.length) return deduped;
  const shown = deduped.slice(0, MAX_PANEL_ITEMS_PER_ROW);
  const rest = total - shown.length;
  if (rest > 0) shown.push(`+${rest} more`);
  return shown;
}

// ── Row builders ────────────────────────────────────────────────────────────────

function buildIntegrationsRow(input: Record<string, unknown>): ConnectedResourcePanelRow {
  const rows = Array.isArray(input.integrations) ? input.integrations : [];
  const named = rows
    .filter(isRecord)
    .map((row) => ({
      name: safeDisplayName(row.label) || safeDisplayName(row.provider),
      connected: row.connected === true,
    }))
    .filter((row) => Boolean(row.name));
  const connected = named.filter((row) => row.connected);
  const tone: ConnectedResourcePanelTone =
    connected.length > 0 ? 'connected' : named.length > 0 ? 'partial' : 'empty';
  return {
    key: 'integrations',
    icon: '🛍️',
    title: 'Integrations',
    countLabel:
      connected.length > 0
        ? `${connected.length} connected`
        : named.length > 0
          ? `${named.length} configured, none connected`
          : 'Not connected',
    tone,
    // Connected first — those are what the agent can actually touch.
    items: boundItems(
      [...connected, ...named.filter((row) => !row.connected)].map((row) => row.name),
      named.length,
    ),
    connectAction: { label: 'Connect more →', targetTab: 'INTEGRATIONS' },
  };
}

function buildVaultRow(input: Record<string, unknown>): ConnectedResourcePanelRow {
  const rows = Array.isArray(input.vaultCredentials) ? input.vaultCredentials : [];
  const valid = rows.filter(isRecord);
  const names: string[] = [];
  let ungranted = 0;
  for (const row of valid) {
    const label = safeDisplayName(row.label);
    const platform = safeDisplayName(row.platform, 24);
    const name = label && platform && label.toLowerCase() !== platform.toLowerCase()
      ? `${label} (${platform})`
      : label || platform;
    if (name) names.push(name);
    if (row.loginAllowed === true && row.hasLoginGrant !== true) ungranted += 1;
  }
  const count = names.length;
  const tone: ConnectedResourcePanelTone =
    count === 0 ? 'empty' : ungranted > 0 ? 'partial' : 'connected';
  return {
    key: 'vault',
    icon: '🔐',
    title: 'Vault logins',
    countLabel: count > 0 ? `${count} saved` : 'Not connected',
    tone,
    items: boundItems(names, count),
    connectAction: { label: 'Add a login →', targetTab: 'VAULT' },
  };
}

function buildGoogleRow(input: Record<string, unknown>): ConnectedResourcePanelRow {
  const gw = input.googleWorkspace;
  const connected = isRecord(gw) && gw.connected === true;
  const items: string[] = [];
  if (connected) {
    const record = gw as Record<string, unknown>;
    const email = safeDisplayName(record.email, 40);
    if (email) items.push(email);
    if (Array.isArray(record.services)) {
      for (const service of record.services) {
        const name = safeDisplayName(service, 20).toLowerCase();
        if (name) items.push(name);
        if (items.length >= MAX_PANEL_ITEMS_PER_ROW) break;
      }
    }
  }
  return {
    key: 'google',
    icon: '🗓️',
    title: 'Google Workspace',
    countLabel: connected ? 'Connected ✓' : 'Not connected',
    tone: connected ? 'connected' : 'empty',
    items: boundItems(items),
    // Google OAuth lives in Circle Settings (a screen, not a circle tab), so
    // there is no targetTab — the host decides how to navigate.
    connectAction: { label: connected ? 'Manage →' : 'Connect Google →' },
  };
}

function buildProviderKeysRow(input: Record<string, unknown>): ConnectedResourcePanelRow {
  const rows = Array.isArray(input.providerKeys) ? input.providerKeys : [];
  const names: string[] = [];
  for (const entry of rows) {
    const raw = typeof entry === 'string' ? entry : isRecord(entry) ? entry.provider : undefined;
    // Provider ids are identifier-shaped; a secretish NAME ('access_token') is
    // dropped by redactSecretishKeyName, and the panel's stricter value-shape
    // guard also drops short key prefixes ('sk-…') the digest's name guard allows.
    const named = redactSecretishKeyName(raw);
    if (!named || named === '[hidden]') continue;
    const name = safeDisplayName(named, 40);
    if (!name) continue;
    names.push(name);
  }
  const deduped = Array.from(new Set(names.map((n) => n.toLowerCase())));
  const count = deduped.length;
  return {
    key: 'provider_keys',
    icon: '🔑',
    title: 'Provider keys',
    countLabel: count > 0 ? `${count} key${count === 1 ? '' : 's'}` : 'Not connected',
    tone: count > 0 ? 'connected' : 'empty',
    items: boundItems(names, count),
    connectAction: { label: 'Add a key →', targetTab: 'INTEGRATIONS' },
  };
}

// ── Panel assembly ──────────────────────────────────────────────────────────────

/**
 * Build the four-row "What's connected" panel model from the same structured
 * snapshot the agent prompt block consumes. Total: null/undefined/junk input
 * yields the fresh-circle onboarding state (every row 'Not connected', each
 * with its connect action). Never surfaces secret values.
 */
export function buildConnectedResourcesPanel(
  input: ConnectedResourcesInput | null | undefined,
): ConnectedResourcesPanelModel {
  const record: Record<string, unknown> = isRecord(input) ? input : {};
  const rows: ConnectedResourcePanelRow[] = [
    buildIntegrationsRow(record),
    buildVaultRow(record),
    buildGoogleRow(record),
    buildProviderKeysRow(record),
  ];
  const stats = connectedResourcesStats(record);
  const connectedSectionCount = rows.filter((row) => row.tone === 'connected').length;
  const summaryLine = [
    `Integrations ${stats.integrations}`,
    `Vault logins ${stats.vaultCredentials}`,
    `Google ${stats.googleConnected ? '✓' : '✗'}`,
    `Provider keys ${stats.providerKeys}`,
  ].join(' · ');
  return { rows, summaryLine, connectedSectionCount };
}
