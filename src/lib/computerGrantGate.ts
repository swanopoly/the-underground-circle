/**
 * computerGrantGate — sticky per-site / per-app "always allow" scopes (T7 UX).
 *
 * Pattern validated against Claude in Chrome's shipped permission model
 * (docs/TOOLTREE_DESKTOP_RESEARCH_2026-06-10.md §2.6): a user can answer an
 * approval ask with "allow this action" (once) or "always allow actions on
 * this site" (persistent, reviewable, revocable with history). This module is
 * the pure model: scope shape, normalization, matching, partitioning, and
 * lifecycle (create → use → expire/revoke → prune). Persistence lives in
 * `computerGrantGateStore.ts`; routing consumption lives in
 * `chatComputerRequestRouter.ts`; the reviewable surface is the PERMISSIONS
 * section of `ComputerUseConsole`.
 *
 * Hard invariant: the always-confirm floor (pay / delete / login / grant) can
 * NEVER be inside a sticky scope, can never be auto-approved by one, and is
 * filtered out even from maliciously crafted persisted scope objects. The
 * floor list is canonical here and re-exported by the router as
 * `ALWAYS_CONFIRM_FLOOR` so the two can never drift.
 *
 * Dependency-light on purpose (type-only imports) so tsx smoke tests can load
 * it without react-native.
 */

import type { ChatComputerConstraintCategory } from './chatComputerRequestRouter';

/**
 * Canonical always-confirm floor (T7). Re-exported by
 * `chatComputerRequestRouter.ALWAYS_CONFIRM_FLOOR`. Never grantable, never
 * downgradable, not user-disableable.
 */
export const STICKY_FLOOR_CATEGORIES: readonly ChatComputerConstraintCategory[] = ['pay', 'delete', 'login', 'grant'];

const FLOOR_SET = new Set<ChatComputerConstraintCategory>(STICKY_FLOOR_CATEGORIES);

/** The only categories a sticky scope may carry — every category minus the floor. */
export const STICKY_GRANTABLE_CATEGORIES: readonly ChatComputerConstraintCategory[] = [
  'submit', 'send', 'publish', 'download', 'upload', 'save',
];

const GRANTABLE_SET = new Set<ChatComputerConstraintCategory>(STICKY_GRANTABLE_CATEGORIES);

export type StickyAllowScopeKind = 'site' | 'app';

export interface StickyAllowScopeRevocation {
  atIso: string;
  byUserId: string | null;
}

export interface StickyAllowScope {
  id: string;
  scopeKind: StickyAllowScopeKind;
  /** Normalized hostname (eTLD+1-ish, e.g. "acme.com") or lowercased app name. */
  scopeKey: string;
  /** Subset of router constraint categories — floor categories are rejected at creation. */
  allowedCategories: ChatComputerConstraintCategory[];
  grantedByUserId: string | null;
  grantedAtIso: string;
  /** Default 30 days from grant. Null means no expiry (discouraged; not created here). */
  expiresAtIso: string | null;
  lastUsedAtIso: string | null;
  useCount: number;
  revoked: StickyAllowScopeRevocation | null;
}

export const STICKY_SCOPE_DEFAULT_TTL_DAYS = 30;
export const STICKY_SCOPE_MAX_ACTIVE = 50;
export const STICKY_SCOPE_MAX_HISTORY = 20;

// ─── Normalization ───────────────────────────────────────────────────────────

/** Multi-part public suffixes we collapse to eTLD+1 correctly without a full PSL. */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'co.nz',
  'co.jp', 'or.jp', 'ne.jp',
  'com.br', 'com.mx', 'com.ar',
  'co.in', 'co.za', 'com.sg', 'com.hk', 'com.tw', 'co.kr',
]);

// Private/platform suffixes where each subdomain is a SEPARATE tenant. These are
// not registry public suffixes, so plain eTLD+1 collapse would wrongly merge
// distinct tenants (a.myshopify.com + b.myshopify.com → one scope), leaking a
// grant across tenants. Keep the tenant label so scopes stay isolated.
const PRIVATE_MULTI_TENANT_SUFFIXES = new Set([
  'myshopify.com', 'wordpress.com', 'blogspot.com', 'tumblr.com',
  'vercel.app', 'netlify.app', 'pages.dev', 'web.app', 'firebaseapp.com',
  'github.io', 'gitlab.io', 'herokuapp.com', 'glitch.me', 'repl.co',
  'surge.sh', 'pythonanywhere.com', 'workers.dev', 'onrender.com',
]);

/**
 * Normalize a scope key. Sites: strip scheme/credentials/port/path/query,
 * lowercase, drop leading `www.`, collapse to eTLD+1-ish so subdomains of the
 * same registrable domain share one scope ("shop.acme.com" → "acme.com").
 * Apps: lowercase, collapse whitespace. Returns '' when nothing usable.
 */
export function normalizeScopeKey(scopeKind: StickyAllowScopeKind, raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (scopeKind === 'app') {
    return value.toLowerCase().replace(/\s+/g, ' ').replace(/\s+(app|application)$/i, '').trim().slice(0, 80);
  }
  let host = value.toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // scheme
  host = host.replace(/^[^/@\s]+@/, ''); // credentials
  host = host.split(/[/?#\s]/)[0] || ''; // path/query/fragment
  host = host.replace(/:\d+$/, ''); // port
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  if (!host) return '';
  // IPs and single-label hosts pass through untouched.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || !host.includes('.')) return host.slice(0, 120);
  const labels = host.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.').slice(0, 120);
  const lastTwo = labels.slice(-2).join('.');
  const keep = MULTI_PART_TLDS.has(lastTwo) || PRIVATE_MULTI_TENANT_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-keep).join('.').slice(0, 120);
}

function stickyScopeId(scopeKind: StickyAllowScopeKind, scopeKey: string): string {
  const cleaned = scopeKey.replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `sticky_${scopeKind}_${cleaned || 'unknown'}`;
}

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function sanitizeCategories(values: unknown): ChatComputerConstraintCategory[] {
  if (!Array.isArray(values)) return [];
  const out: ChatComputerConstraintCategory[] = [];
  for (const value of values) {
    const cat = String(value || '').trim().toLowerCase() as ChatComputerConstraintCategory;
    // Floor categories are silently dropped here (defense against malicious
    // persisted data); createStickyScope rejects them loudly at creation.
    if (GRANTABLE_SET.has(cat) && !out.includes(cat)) out.push(cat);
  }
  return out;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export type CreateStickyScopeResult =
  | { ok: true; scope: StickyAllowScope }
  | { ok: false; error: string };

/**
 * Create a sticky allow scope. Rejects floor categories (pay/delete/login/
 * grant) outright — degrading them silently would let a "grant everything"
 * UI bug create an unbypassable-floor bypass.
 */
export function createStickyScope(input: {
  scopeKind: StickyAllowScopeKind;
  scopeKey: string;
  allowedCategories: ChatComputerConstraintCategory[];
  grantedByUserId?: string | null;
  nowIso?: string;
  ttlDays?: number;
}): CreateStickyScopeResult {
  const scopeKind: StickyAllowScopeKind = input.scopeKind === 'app' ? 'app' : 'site';
  const scopeKey = normalizeScopeKey(scopeKind, input.scopeKey);
  if (!scopeKey) {
    return { ok: false, error: `Could not normalize "${String(input.scopeKey || '')}" into a ${scopeKind} scope key.` };
  }
  const requested = Array.isArray(input.allowedCategories) ? input.allowedCategories : [];
  const floorRequested = requested.filter((cat) => FLOOR_SET.has(cat));
  if (floorRequested.length > 0) {
    return {
      ok: false,
      error: `Floor categories can never be in a sticky allow scope: ${floorRequested.join(', ')} always require fresh confirmation.`,
    };
  }
  const allowedCategories = sanitizeCategories(requested);
  if (allowedCategories.length === 0) {
    return { ok: false, error: 'A sticky allow scope needs at least one grantable category.' };
  }
  const nowIso = safeIso(input.nowIso) || new Date().toISOString();
  const ttlDays = Number.isFinite(input.ttlDays) ? Math.max(1, Math.min(90, Math.floor(input.ttlDays as number))) : STICKY_SCOPE_DEFAULT_TTL_DAYS;
  const expiresAtIso = new Date(Date.parse(nowIso) + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    ok: true,
    scope: {
      id: stickyScopeId(scopeKind, scopeKey),
      scopeKind,
      scopeKey,
      allowedCategories,
      grantedByUserId: input.grantedByUserId ? String(input.grantedByUserId) : null,
      grantedAtIso: nowIso,
      expiresAtIso,
      lastUsedAtIso: null,
      useCount: 0,
      revoked: null,
    },
  };
}

export function isStickyScopeExpired(scope: StickyAllowScope, nowMs = Date.now()): boolean {
  if (!scope.expiresAtIso) return false;
  const ts = Date.parse(scope.expiresAtIso);
  return Number.isFinite(ts) && ts <= nowMs;
}

export function isStickyScopeActive(scope: StickyAllowScope, nowMs = Date.now()): boolean {
  return !scope.revoked && !isStickyScopeExpired(scope, nowMs) && scope.allowedCategories.length > 0;
}

export function revokeStickyScope(
  scopes: StickyAllowScope[],
  scopeId: string,
  byUserId?: string | null,
  nowIso = new Date().toISOString(),
): StickyAllowScope[] {
  return scopes.map((scope) => (
    scope.id === scopeId && !scope.revoked
      ? { ...scope, revoked: { atIso: nowIso, byUserId: byUserId ? String(byUserId) : null } }
      : scope
  ));
}

/** Bump usage bookkeeping on the scopes that auto-approved a route. */
export function markStickyScopesUsed(
  scopes: StickyAllowScope[],
  usedScopeIds: string[],
  nowIso = new Date().toISOString(),
): StickyAllowScope[] {
  if (!usedScopeIds.length) return scopes;
  const used = new Set(usedScopeIds);
  return scopes.map((scope) => (
    used.has(scope.id)
      ? { ...scope, useCount: Math.min(99999, (scope.useCount || 0) + 1), lastUsedAtIso: nowIso }
      : scope
  ));
}

export interface StickyScopePruneResult {
  /** Unexpired, unrevoked scopes — the only ones routing may consume. */
  active: StickyAllowScope[];
  /** Revoked/expired scopes kept as reviewable history (bounded). */
  history: StickyAllowScope[];
}

/** Partition and bound the list: ≤50 active, ≤20 history, newest first. */
export function pruneStickyScopes(scopes: StickyAllowScope[], nowMs = Date.now()): StickyScopePruneResult {
  const byNewest = (a: StickyAllowScope, b: StickyAllowScope) =>
    (Date.parse(b.revoked?.atIso || b.grantedAtIso) || 0) - (Date.parse(a.revoked?.atIso || a.grantedAtIso) || 0);
  const active = scopes.filter((scope) => isStickyScopeActive(scope, nowMs)).sort(byNewest).slice(0, STICKY_SCOPE_MAX_ACTIVE);
  const history = scopes.filter((scope) => !isStickyScopeActive(scope, nowMs)).sort(byNewest).slice(0, STICKY_SCOPE_MAX_HISTORY);
  return { active, history };
}

/** Tolerant parser for persisted scope lists — bad entries are dropped. */
export function compactStickyAllowScopes(raw: unknown): StickyAllowScope[] {
  if (!Array.isArray(raw)) return [];
  const out: StickyAllowScope[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const scopeKind: StickyAllowScopeKind = record.scopeKind === 'app' ? 'app' : 'site';
    const scopeKey = normalizeScopeKey(scopeKind, String(record.scopeKey || ''));
    const allowedCategories = sanitizeCategories(record.allowedCategories);
    if (!scopeKey || allowedCategories.length === 0) continue;
    const revokedRecord = record.revoked && typeof record.revoked === 'object' ? record.revoked as Record<string, unknown> : null;
    const revokedAt = revokedRecord ? safeIso(revokedRecord.atIso) : null;
    out.push({
      id: String(record.id || stickyScopeId(scopeKind, scopeKey)).slice(0, 160),
      scopeKind,
      scopeKey,
      allowedCategories,
      grantedByUserId: record.grantedByUserId ? String(record.grantedByUserId).slice(0, 120) : null,
      grantedAtIso: safeIso(record.grantedAtIso) || new Date(0).toISOString(),
      expiresAtIso: safeIso(record.expiresAtIso),
      lastUsedAtIso: safeIso(record.lastUsedAtIso),
      useCount: Number.isFinite(record.useCount as number) ? Math.max(0, Math.floor(record.useCount as number)) : 0,
      revoked: revokedAt ? { atIso: revokedAt, byUserId: revokedRecord?.byUserId ? String(revokedRecord.byUserId).slice(0, 120) : null } : null,
    });
  }
  return out.slice(0, STICKY_SCOPE_MAX_ACTIVE + STICKY_SCOPE_MAX_HISTORY);
}

// ─── Matching + partitioning ─────────────────────────────────────────────────

export interface StickyScopeTaskTarget {
  hostname?: string | null;
  appName?: string | null;
}

/** Does this scope cover the task's target site/app right now? */
export function scopeMatchesTask(
  scope: StickyAllowScope,
  target: StickyScopeTaskTarget,
  nowMs = Date.now(),
): boolean {
  if (!isStickyScopeActive(scope, nowMs)) return false;
  if (scope.scopeKind === 'site') {
    const host = normalizeScopeKey('site', String(target.hostname || ''));
    return Boolean(host) && host === scope.scopeKey;
  }
  const app = normalizeScopeKey('app', String(target.appName || ''));
  return Boolean(app) && app === scope.scopeKey;
}

export interface StickyScopeApplication {
  /** Requested categories a matching scope covers — safe to auto-approve. */
  autoApproved: ChatComputerConstraintCategory[];
  /** Requested categories that still need a fresh ask (always includes floor categories). */
  stillRequired: ChatComputerConstraintCategory[];
  /** Scopes that matched the target and contributed coverage. */
  usedScopeIds: string[];
}

/**
 * Partition the requested categories against the user's sticky scopes.
 * Floor categories ALWAYS land in `stillRequired` — even when a (maliciously
 * crafted) scope object claims to allow them. A route may downgrade approval
 * only when `usedScopeIds` is non-empty and `stillRequired` is empty: a
 * matching site/app scope stands in for "always allow actions on this
 * site/app", so a category-less mutation is covered by any matching scope.
 */
export function applyStickyScopes(
  scopes: StickyAllowScope[],
  target: StickyScopeTaskTarget,
  requestedCategories: ChatComputerConstraintCategory[],
  nowMs = Date.now(),
): StickyScopeApplication {
  const requested = Array.from(new Set(requestedCategories || []));
  const floorRequested = requested.filter((cat) => FLOOR_SET.has(cat));
  const nonFloorRequested = requested.filter((cat) => !FLOOR_SET.has(cat));
  const matching = (scopes || []).filter((scope) => scopeMatchesTask(scope, target, nowMs));

  const autoApproved: ChatComputerConstraintCategory[] = [];
  const stillRequired: ChatComputerConstraintCategory[] = [...floorRequested];
  const usedScopeIds = new Set<string>();

  for (const category of nonFloorRequested) {
    const covering = matching.find((scope) => sanitizeCategories(scope.allowedCategories).includes(category));
    if (covering) {
      autoApproved.push(category);
      usedScopeIds.add(covering.id);
    } else {
      stillRequired.push(category);
    }
  }
  // Generic "actions on this site/app": a matching scope counts as used even
  // when the task text exposed no concrete category.
  if (nonFloorRequested.length === 0 && floorRequested.length === 0 && matching.length > 0) {
    usedScopeIds.add(matching[0].id);
  }
  return { autoApproved, stillRequired, usedScopeIds: Array.from(usedScopeIds) };
}

// ─── Task target extraction ──────────────────────────────────────────────────

/** Last-label tokens that look like domains but are file names. */
const FILE_EXTENSION_TLD_DENYLIST = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'pdf', 'csv', 'tsv', 'txt', 'md',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'tar', 'gz', 'dmg', 'pkg',
  'mp3', 'mp4', 'mov', 'wav', 'psd', 'psb', 'indd', 'idml', 'ai', 'fig', 'json',
  'yaml', 'yml', 'ts', 'tsx', 'js', 'jsx', 'exe', 'bin', 'iso', 'heic',
]);

const KNOWN_APP_NAMES = [
  'photoshop', 'indesign', 'illustrator', 'lightroom', 'premiere', 'after effects', 'acrobat',
  'figma', 'canva', 'sketch', 'blender', 'autocad', 'solidworks', 'fusion 360', 'matlab', 'simulink', 'ableton',
  'notion', 'slack', 'obsidian', 'finder', 'preview', 'terminal', 'xcode', 'vs code', 'vscode',
  'excel', 'word', 'powerpoint', 'outlook', 'pages', 'numbers', 'keynote', 'mail', 'calendar',
  'notes', 'reminders', 'music', 'spotify', 'discord', 'zoom', 'obs',
];

export interface StickyTaskTargets {
  hostname: string | null;
  appName: string | null;
}

/**
 * Extract the task's target site and/or app from its text. Conservative:
 * a missed target just means the sticky downgrade never fires (fail closed
 * to asking for approval).
 */
export function extractStickyTaskTargets(text: string): StickyTaskTargets {
  const value = String(text || '');
  let hostname: string | null = null;
  const urlMatch = value.match(/\bhttps?:\/\/[^\s)>'"]+/i);
  if (urlMatch) {
    hostname = normalizeScopeKey('site', urlMatch[0]) || null;
  }
  if (!hostname) {
    for (const match of value.matchAll(/\b((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,16})\b/gi)) {
      const candidate = match[1].toLowerCase();
      const lastLabel = candidate.split('.').pop() || '';
      if (FILE_EXTENSION_TLD_DENYLIST.has(lastLabel)) continue;
      hostname = normalizeScopeKey('site', candidate) || null;
      if (hostname) break;
    }
  }

  let appName: string | null = null;
  const lower = value.toLowerCase();
  for (const known of KNOWN_APP_NAMES) {
    if (new RegExp(`\\b${known.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) {
      appName = known;
      break;
    }
  }
  if (!appName) {
    const appMatch = value.match(/\b(?:in|inside|on|using|with|open|launch|focus)\s+(?:the\s+)?([A-Za-z][\w.+-]*(?:\s+[A-Za-z0-9][\w.+-]*){0,2})\s+(?:app|application|window|program)\b/i);
    if (appMatch) appName = normalizeScopeKey('app', appMatch[1]) || null;
  }
  return { hostname, appName: appName ? normalizeScopeKey('app', appName) || null : null };
}

// ─── Route notice + post-task offer ──────────────────────────────────────────

export interface StickyScopeAppliedSummary {
  scopeId: string;
  scopeKey: string;
  scopeKind: StickyAllowScopeKind;
  categories: ChatComputerConstraintCategory[];
}

/** The single visible line chat/console show when a standing grant fires. */
export function formatStickyScopeAppliedNotice(applied: Pick<StickyScopeAppliedSummary, 'scopeKey'>): string {
  return `Auto-approved via your standing grant for ${applied.scopeKey} — revoke in Computer Use → Permissions.`;
}

export interface StickyScopeOffer {
  scopeKind: StickyAllowScopeKind;
  scopeKey: string;
  categories: ChatComputerConstraintCategory[];
  label: string;
}

/**
 * Build the one-tap "Always allow <categories> on <scopeKey>" offer shown on
 * a COMPLETED task that needed approval. Floor categories are stripped; when
 * the task exposed no concrete category, the offer falls back to the generic
 * non-destructive mutation category ('save') so the grant stays bounded.
 * Returns null when no target site/app can be extracted.
 */
export function buildStickyScopeOfferFromTask(args: {
  task: string;
  categories?: ChatComputerConstraintCategory[] | null;
}): StickyScopeOffer | null {
  const targets = extractStickyTaskTargets(args.task);
  const scopeKind: StickyAllowScopeKind | null = targets.hostname ? 'site' : targets.appName ? 'app' : null;
  if (!scopeKind) return null;
  const scopeKey = scopeKind === 'site' ? targets.hostname! : targets.appName!;
  const categories = sanitizeCategories(args.categories || []);
  const offered = categories.length > 0 ? categories : (['save'] as ChatComputerConstraintCategory[]);
  return {
    scopeKind,
    scopeKey,
    categories: offered,
    label: `Always allow ${offered.join(', ')} on ${scopeKey} (${STICKY_SCOPE_DEFAULT_TTL_DAYS} days)`,
  };
}

// ─── In-memory active registry ───────────────────────────────────────────────

/**
 * The chat router is pure + synchronous, so it cannot read async device
 * storage. The store hydrates this registry on load/save; the router reads
 * it as its default scope source. Empty until the store first loads — that
 * failure mode is fail-closed (the route just keeps asking for approval).
 */
let activeStickyScopesRegistry: StickyAllowScope[] = [];

export function setActiveStickyScopes(scopes: StickyAllowScope[]): void {
  activeStickyScopesRegistry = compactStickyAllowScopes(scopes);
}

export function getActiveStickyScopes(): StickyAllowScope[] {
  return activeStickyScopesRegistry;
}
