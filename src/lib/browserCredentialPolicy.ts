/**
 * browserCredentialPolicy — per-domain, opt-in session reuse with isolated
 * browser profiles (Lane C).
 *
 * Product answer this encodes: "Yes — opt-in per domain, isolated profiles."
 * The browser may reuse a logged-in session for a domain ONLY when the user has
 * explicitly opted that domain in. Each opted-in domain gets its own ISOLATED
 * persistent browser profile so no cookie/session bleeds between domains. And
 * the model NEVER receives a secret value: a vault fill returns a model-safe
 * REFERENCE (`fieldRef`); the browser bridge resolves the real secret from the
 * vault and types it locally.
 *
 * Domains normalize through `computerGrantGate.normalizeScopeKey('site', …)`
 * (eTLD+1-ish), so an opt-in for `acme.com` and a sticky allow scope for
 * `acme.com` key identically — subdomains/www/scheme/port/path all collapse to
 * the same registrable domain and no lookalike sneaks in.
 *
 * HARD INVARIANT (mirrors `computerGrantGate`'s always-confirm floor): opt-in
 * governs SESSION REUSE only. The FIRST login on a domain still hits the
 * always-confirm floor ('login') — even for an opted-in domain, the initial
 * credential grant requires fresh user confirmation. Opt-in is a standing
 * "reuse the session you already established", never a standing "log in for me".
 *
 * Persistence lives with the caller; routing consumption lives in
 * `chatComputerRequestRouter.ts`; profile launch lives in the browser bridge.
 *
 * Dependency-light on purpose (type-only imports plus the pure
 * `normalizeScopeKey`) so tsx smoke tests can load it without react-native.
 */

import { normalizeScopeKey } from './computerGrantGate';

export const DOMAIN_OPT_IN_DEFAULT_TTL_DAYS = 30;
export const DOMAIN_OPT_IN_MAX_RECORDS = 200;

/** Prefix for every isolated per-domain browser profile id. */
const PROFILE_KEY_PREFIX = 'profile_';

// ─── Normalization + profile isolation ───────────────────────────────────────

/** Normalize a raw domain the same way sticky scopes do (eTLD+1-ish). '' when unusable. */
export function normalizeDomain(raw: string): string {
  return normalizeScopeKey('site', raw);
}

/**
 * Stable, filesystem-safe isolated-profile id for a domain, derived from the
 * normalized domain (e.g. "acme.com" → "profile_acme_com"). Distinct domains
 * yield distinct keys — that distinctness IS the isolation guarantee, so the
 * bridge launches a separate persistent context per key with no shared cookie
 * jar. Empty/garbage domains return '' (fail closed): there is deliberately no
 * shared default profile that unrelated domains could fall back into.
 */
export function profileKeyForDomain(domain: string): string {
  const normalized = normalizeDomain(domain);
  if (!normalized) return '';
  const slug = normalized.replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!slug) return '';
  return `${PROFILE_KEY_PREFIX}${slug}`.slice(0, 96);
}

// ─── Opt-in record shape + lifecycle ─────────────────────────────────────────

export interface DomainCredentialOptIn {
  /** Normalized registrable domain (eTLD+1-ish). */
  domain: string;
  /** Isolated persistent-profile id the bridge must launch for this domain. */
  profileKey: string;
  grantedByUserId: string | null;
  grantedAtIso: string;
  /** Default 30 days from grant. Null means no expiry (discouraged; not created here). */
  expiresAtIso: string | null;
  revoked: DomainOptInRevocation | null;
}

export interface DomainOptInRevocation {
  atIso: string;
  byUserId: string | null;
}

export type CreateDomainOptInResult =
  | { ok: true; optIn: DomainCredentialOptIn }
  | { ok: false; error: string };

function safeIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

/**
 * Create a per-domain session-reuse opt-in. Rejects un-normalizable domains
 * (fail closed) rather than minting an opt-in against a garbage key that would
 * never match a real navigation.
 */
export function createDomainCredentialOptIn(input: {
  domain: string;
  grantedByUserId?: string | null;
  ttlDays?: number;
  nowIso?: string;
}): CreateDomainOptInResult {
  const domain = normalizeDomain(input.domain);
  if (!domain) {
    return { ok: false, error: `Could not normalize "${String(input.domain || '')}" into a domain.` };
  }
  const profileKey = profileKeyForDomain(domain);
  if (!profileKey) {
    return { ok: false, error: `Could not derive an isolated profile for "${domain}".` };
  }
  const nowIso = safeIso(input.nowIso) || new Date().toISOString();
  const ttlDays = Number.isFinite(input.ttlDays)
    ? Math.max(1, Math.min(365, Math.floor(input.ttlDays as number)))
    : DOMAIN_OPT_IN_DEFAULT_TTL_DAYS;
  const expiresAtIso = new Date(Date.parse(nowIso) + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    ok: true,
    optIn: {
      domain,
      profileKey,
      grantedByUserId: input.grantedByUserId ? String(input.grantedByUserId) : null,
      grantedAtIso: nowIso,
      expiresAtIso,
      revoked: null,
    },
  };
}

export function isDomainOptInExpired(optIn: DomainCredentialOptIn, nowMs = Date.now()): boolean {
  if (!optIn.expiresAtIso) return false;
  const ts = Date.parse(optIn.expiresAtIso);
  return Number.isFinite(ts) && ts <= nowMs;
}

export function isDomainOptInActive(optIn: DomainCredentialOptIn, nowMs = Date.now()): boolean {
  return !optIn.revoked && !isDomainOptInExpired(optIn, nowMs);
}

/**
 * Is there an active (unexpired, unrevoked) opt-in for this domain? Compares on
 * the normalized domain so a request against `shop.acme.com` sees an opt-in
 * granted for `acme.com` but never one for `evilacme.com`.
 */
export function isDomainOptedIn(
  records: DomainCredentialOptIn[],
  domain: string,
  nowMs = Date.now(),
): boolean {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;
  return (records || []).some((record) => record.domain === normalized && isDomainOptInActive(record, nowMs));
}

/**
 * May the browser reuse an existing logged-in session for this domain? Alias of
 * `isDomainOptedIn` at the router's call site — reuse is permitted only when an
 * active opt-in exists. (This does NOT grant a fresh login; see
 * `requiresFreshLoginConfirmation`.)
 */
export function canReuseSession(
  records: DomainCredentialOptIn[],
  domain: string,
  nowMs = Date.now(),
): boolean {
  return isDomainOptedIn(records, domain, nowMs);
}

/** Revoke every active opt-in for a domain (records kept as reviewable history). */
export function revokeDomainOptIn(
  records: DomainCredentialOptIn[],
  domain: string,
  byUserId?: string | null,
  nowIso = new Date().toISOString(),
): DomainCredentialOptIn[] {
  const normalized = normalizeDomain(domain);
  if (!normalized) return records;
  return (records || []).map((record) => (
    record.domain === normalized && !record.revoked
      ? { ...record, revoked: { atIso: nowIso, byUserId: byUserId ? String(byUserId) : null } }
      : record
  ));
}

/** Tolerant parser for persisted opt-in lists — malformed entries are dropped. */
export function compactDomainCredentialOptIns(raw: unknown): DomainCredentialOptIn[] {
  if (!Array.isArray(raw)) return [];
  const out: DomainCredentialOptIn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const domain = normalizeDomain(String(record.domain || ''));
    if (!domain) continue;
    const profileKey = profileKeyForDomain(domain); // always re-derive: never trust a persisted key
    if (!profileKey) continue;
    const revokedRecord = record.revoked && typeof record.revoked === 'object' ? record.revoked as Record<string, unknown> : null;
    const revokedAt = revokedRecord ? safeIso(revokedRecord.atIso) : null;
    out.push({
      domain,
      profileKey,
      grantedByUserId: record.grantedByUserId ? String(record.grantedByUserId).slice(0, 120) : null,
      grantedAtIso: safeIso(record.grantedAtIso) || new Date(0).toISOString(),
      expiresAtIso: safeIso(record.expiresAtIso),
      revoked: revokedAt ? { atIso: revokedAt, byUserId: revokedRecord?.byUserId ? String(revokedRecord.byUserId).slice(0, 120) : null } : null,
    });
  }
  return out.slice(0, DOMAIN_OPT_IN_MAX_RECORDS);
}

// ─── Fresh-login floor (session reuse ≠ first login) ─────────────────────────

/**
 * Does the domain still need a fresh, user-confirmed login? True whenever there
 * is no stored session yet — REGARDLESS of opt-in. Opt-in is a standing "reuse
 * the session I already logged into", not a standing "log in for me": the first
 * login on any domain hits the always-confirm floor ('login') and requires
 * fresh user confirmation. Only once a session exists AND the domain is opted in
 * may the browser skip re-confirming and reuse that session.
 */
export function requiresFreshLoginConfirmation(input: {
  hasStoredSession: boolean;
  optedIn: boolean;
}): boolean {
  if (!input.hasStoredSession) return true; // no session yet → always confirm first login
  return !input.optedIn; // session exists but not opted in → still confirm before reuse
}

// ─── Model-safe vault fill contract ──────────────────────────────────────────

export interface VaultFillContract {
  /** Normalized domain the fill targets. */
  domain: string;
  /** Isolated profile the bridge fills within. */
  profileKey: string;
  /**
   * Opaque reference to a vault field (e.g. "vault:acme.com/password"). This is
   * the ONLY credential-shaped value the model ever sees. It is not a secret.
   */
  fieldRef: string;
  /** Structural marker: this descriptor carries no secret value, by construction. */
  neverReturnsSecret: true;
  /** The secret is resolved and typed by the browser bridge, never by the model. */
  fillVia: 'bridge';
}

/**
 * Build a MODEL-SAFE vault fill descriptor.
 *
 * The model only ever sees `fieldRef` — an opaque reference. The browser bridge
 * resolves the actual secret from the vault and types it locally. The secret
 * value must NEVER appear in prompts, model output, logs, or persisted chat
 * metadata; there is deliberately no field on this contract that could carry
 * one. `fieldRef` is sanitized to a reference-safe token so a caller cannot
 * smuggle a raw secret (e.g. newlines / long blobs) through it.
 *
 * Returns null when the domain cannot be normalized or the fieldRef is empty
 * (fail closed — no fill against a garbage target).
 */
export function buildVaultFillContract(input: {
  domain: string;
  fieldRef: string;
}): VaultFillContract | null {
  const domain = normalizeDomain(input.domain);
  if (!domain) return null;
  const profileKey = profileKeyForDomain(domain);
  if (!profileKey) return null;
  const fieldRef = String(input.fieldRef || '').replace(/\s+/g, '').slice(0, 160);
  if (!fieldRef) return null;
  return {
    domain,
    profileKey,
    fieldRef,
    neverReturnsSecret: true,
    fillVia: 'bridge',
  };
}

// ─── UI describe ─────────────────────────────────────────────────────────────

/** Single reviewable line for the opt-in list in Computer Use → Permissions. */
export function describeDomainOptIn(optIn: DomainCredentialOptIn, nowMs = Date.now()): string {
  const state = optIn.revoked
    ? `revoked ${optIn.revoked.atIso.slice(0, 10)}`
    : isDomainOptInExpired(optIn, nowMs)
      ? `expired ${(optIn.expiresAtIso || '').slice(0, 10)}`
      : optIn.expiresAtIso
        ? `active until ${optIn.expiresAtIso.slice(0, 10)}`
        : 'active';
  return `${optIn.domain} — session reuse ${state} (isolated profile ${optIn.profileKey}); first login still requires confirmation.`;
}
