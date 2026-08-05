// agentFileLeaseCore — the PURE coordination brain that lets multiple agents
// (this app's chat/SwanBot/OpenSwan + subagents, AND external agents such as a
// second Claude Code / Cursor) work on the same local repo without clobbering
// each other. See docs/MULTI_AGENT_FILE_COORDINATION.md.
//
// Two independent guarantees live here as pure functions (the runtime does I/O):
//   1. CONTENT-HASH CAS (universal): `hashContent` + `checkWriteConflict` — an
//      agent records a file's hash when it reads it; before writing, the runtime
//      re-hashes the file on disk and refuses if it changed. Needs NO cooperation
//      from other agents — it catches a concurrent write from anyone.
//   2. ADVISORY LEASES (cooperating agents): a registry mapping path → lease with
//      owner + TTL + heartbeat; `acquireLease`/`renewLease`/`releaseLease` are a
//      deterministic state machine. Stale (expired) leases are auto-reclaimable so
//      a crashed agent can never deadlock the file.
//
// PURITY: zero imports, tsx-loadable (smoke: agent-file-lease-core). Every
// function takes `now` (epoch ms) from the caller so it stays deterministic; it
// never reads the clock or the filesystem. Never throws.

export const LEASE_DEFAULT_TTL_MS = 90_000; // ~3x a 30s heartbeat
export const LEASE_MIN_TTL_MS = 5_000;
export const LEASE_MAX_TTL_MS = 1_800_000; // 30 min ceiling for a long edit
export const MAX_INTENT_LEN = 200;

export interface FileLease {
  /** Normalized file path (the coordinated resource). */
  path: string;
  /** Stable per-agent-session id (opaque). */
  ownerId: string;
  /** Human label for the awareness view (e.g. "claude-code:main"). */
  ownerLabel: string;
  acquiredAt: number;
  /** Last heartbeat time. */
  renewedAt: number;
  /** renewedAt + ttl; the lease is dead once now > expiresAt. */
  expiresAt: number;
  /** Hash of the content the owner is working AGAINST (the CAS baseline). */
  contentHash: string;
  /** Short, bounded note ("editing the edit handler"). */
  intent: string;
}

export interface LeaseRegistry {
  version: 1;
  leases: Record<string, FileLease>;
}

export type AcquireOutcome = 'granted' | 'renewed' | 'reclaimed_stale' | 'held_by_other';
export interface AcquireResult {
  ok: boolean;
  outcome: AcquireOutcome;
  registry: LeaseRegistry;
  /** The lease now in effect (the requester's), when ok. */
  lease?: FileLease;
  /** The current holder, when denied (held_by_other). */
  holder?: FileLease;
  reason: string;
}

export interface AcquireRequest {
  path: string;
  ownerId: string;
  ownerLabel?: string;
  contentHash?: string;
  intent?: string;
  ttlMs?: number;
}

// ── Hashing (dependency-free, change-detection grade — NOT cryptographic) ─────
// FNV-1a(32) + djb2(32) + length → 16 hex chars + length. Any realistic edit
// changes the hash; collisions are astronomically unlikely for this purpose.
export function hashContent(text: unknown): string {
  const s = typeof text === 'string' ? text : String(text ?? '');
  let h1 = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i += 1) {
    h1 ^= s.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  let h2 = 5381; // djb2
  for (let i = 0; i < s.length; i += 1) {
    h2 = (Math.imul(h2, 33) ^ s.charCodeAt(i)) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}-${s.length}`;
}

function clampTtl(ttlMs: unknown): number {
  const n = typeof ttlMs === 'number' && Number.isFinite(ttlMs) ? Math.floor(ttlMs) : LEASE_DEFAULT_TTL_MS;
  return Math.max(LEASE_MIN_TTL_MS, Math.min(LEASE_MAX_TTL_MS, n));
}

/** Normalize a lease key: trim, collapse duplicate slashes, drop a trailing slash.
 *  Case-preserving (POSIX paths are case-sensitive). */
export function normalizeLeasePath(raw: unknown): string {
  let p = typeof raw === 'string' ? raw.trim() : '';
  if (!p) return '';
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function emptyRegistry(): LeaseRegistry {
  return { version: 1, leases: {} };
}

/** Coerce arbitrary parsed JSON into a valid registry (defensive — a corrupt or
 *  partial registry file must never throw or grant a bogus lease). */
export function normalizeRegistry(raw: unknown): LeaseRegistry {
  if (!raw || typeof raw !== 'object') return emptyRegistry();
  const leasesRaw = (raw as any).leases;
  if (!leasesRaw || typeof leasesRaw !== 'object') return emptyRegistry();
  const leases: Record<string, FileLease> = {};
  for (const [key, v] of Object.entries(leasesRaw)) {
    const l = v as any;
    if (
      l && typeof l === 'object' &&
      typeof l.ownerId === 'string' &&
      typeof l.expiresAt === 'number' &&
      typeof l.path === 'string'
    ) {
      leases[normalizeLeasePath(key) || key] = {
        path: String(l.path),
        ownerId: String(l.ownerId),
        ownerLabel: typeof l.ownerLabel === 'string' ? l.ownerLabel : 'agent',
        acquiredAt: Number.isFinite(l.acquiredAt) ? l.acquiredAt : 0,
        renewedAt: Number.isFinite(l.renewedAt) ? l.renewedAt : 0,
        expiresAt: l.expiresAt,
        contentHash: typeof l.contentHash === 'string' ? l.contentHash : '',
        intent: typeof l.intent === 'string' ? l.intent.slice(0, MAX_INTENT_LEN) : '',
      };
    }
  }
  return { version: 1, leases };
}

function isExpired(lease: FileLease, now: number): boolean {
  return now >= lease.expiresAt;
}

function cloneWith(registry: LeaseRegistry, path: string, lease: FileLease | null): LeaseRegistry {
  const leases = { ...registry.leases };
  if (lease) leases[path] = lease;
  else delete leases[path];
  return { version: 1, leases };
}

/**
 * Acquire (or renew, or reclaim-if-stale) an exclusive lease on a file. Pure:
 * returns the decision + the NEW registry. Never throws.
 */
export function acquireLease(registryRaw: unknown, reqRaw: AcquireRequest, now: number): AcquireResult {
  const registry = normalizeRegistry(registryRaw);
  const req = (reqRaw ?? {}) as AcquireRequest;
  const path = normalizeLeasePath(req.path);
  const ownerId = typeof req.ownerId === 'string' ? req.ownerId.trim() : '';
  if (!path || !ownerId) {
    return { ok: false, outcome: 'held_by_other', registry, reason: 'path and ownerId are required' };
  }
  const ttl = clampTtl(req.ttlMs);
  const mkLease = (acquiredAt: number): FileLease => ({
    path,
    ownerId,
    ownerLabel: (typeof req.ownerLabel === 'string' && req.ownerLabel.trim()) ? req.ownerLabel.trim().slice(0, 80) : 'agent',
    acquiredAt,
    renewedAt: now,
    expiresAt: now + ttl,
    contentHash: typeof req.contentHash === 'string' ? req.contentHash : '',
    intent: typeof req.intent === 'string' ? req.intent.slice(0, MAX_INTENT_LEN) : '',
  });

  const existing = registry.leases[path];
  if (!existing) {
    const lease = mkLease(now);
    return { ok: true, outcome: 'granted', registry: cloneWith(registry, path, lease), lease, reason: 'lease granted' };
  }
  if (existing.ownerId === ownerId) {
    const lease = mkLease(existing.acquiredAt); // keep original acquiredAt on renew
    return { ok: true, outcome: 'renewed', registry: cloneWith(registry, path, lease), lease, reason: 'lease renewed (already owner)' };
  }
  if (isExpired(existing, now)) {
    const lease = mkLease(now);
    return { ok: true, outcome: 'reclaimed_stale', registry: cloneWith(registry, path, lease), lease, reason: `reclaimed a stale lease from ${existing.ownerLabel}` };
  }
  return {
    ok: false,
    outcome: 'held_by_other',
    registry,
    holder: existing,
    reason: `held by ${existing.ownerLabel} for ${Math.max(0, Math.round((existing.expiresAt - now) / 1000))}s more`,
  };
}

export type RenewOutcome = 'renewed' | 'not_holder' | 'gone';
/** Heartbeat: extend the lease if (and only if) the caller still owns it. */
export function renewLease(
  registryRaw: unknown,
  reqRaw: { path: string; ownerId: string; ttlMs?: number; contentHash?: string },
  now: number,
): { ok: boolean; outcome: RenewOutcome; registry: LeaseRegistry; lease?: FileLease } {
  const registry = normalizeRegistry(registryRaw);
  const req = (reqRaw ?? {}) as { path: string; ownerId: string; ttlMs?: number; contentHash?: string };
  const path = normalizeLeasePath(req.path);
  const existing = registry.leases[path];
  if (!existing) return { ok: false, outcome: 'gone', registry };
  if (existing.ownerId !== req.ownerId) return { ok: false, outcome: 'not_holder', registry };
  const ttl = clampTtl(req.ttlMs);
  const lease: FileLease = {
    ...existing,
    renewedAt: now,
    expiresAt: now + ttl,
    contentHash: typeof req.contentHash === 'string' ? req.contentHash : existing.contentHash,
  };
  return { ok: true, outcome: 'renewed', registry: cloneWith(registry, path, lease), lease };
}

export type ReleaseOutcome = 'released' | 'not_holder' | 'gone';
/** Release a lease the caller owns (idempotent-ish; a non-owner cannot release). */
export function releaseLease(
  registryRaw: unknown,
  reqRaw: { path: string; ownerId: string },
  now: number,
): { ok: boolean; outcome: ReleaseOutcome; registry: LeaseRegistry } {
  const registry = normalizeRegistry(registryRaw);
  const req = (reqRaw ?? {}) as { path: string; ownerId: string };
  const path = normalizeLeasePath(req.path);
  const existing = registry.leases[path];
  if (!existing) return { ok: true, outcome: 'gone', registry };
  // A non-owner may reclaim a STALE lease by releasing it; otherwise not_holder.
  if (existing.ownerId !== req.ownerId && !isExpired(existing, now)) {
    return { ok: false, outcome: 'not_holder', registry };
  }
  return { ok: true, outcome: 'released', registry: cloneWith(registry, path, null) };
}

// ── Content-hash CAS (the universal, cooperation-free guarantee) ──────────────
export type WriteConflictVerdict = 'clean' | 'conflict' | 'unknown';
/**
 * Compare the baseline hash (recorded when the agent read the file) against the
 * current on-disk hash (re-read right before the write). `conflict` = the file
 * changed underneath us → the caller MUST refuse the write and re-read. `unknown`
 * = we had no baseline (e.g. first-ever read) → the caller decides (usually allow
 * a create, refuse an overwrite).
 */
export function checkWriteConflict(input: { baselineHash?: string | null; currentHash?: string | null }): {
  verdict: WriteConflictVerdict;
  reason: string;
} {
  const baseline = typeof input.baselineHash === 'string' ? input.baselineHash : '';
  const current = typeof input.currentHash === 'string' ? input.currentHash : '';
  if (!baseline) return { verdict: 'unknown', reason: 'no baseline hash recorded for this file' };
  if (!current) return { verdict: 'unknown', reason: 'no current hash available' };
  if (baseline === current) return { verdict: 'clean', reason: 'file unchanged since it was read' };
  return { verdict: 'conflict', reason: 'file changed on disk since it was read — re-read and re-apply' };
}

/** Drop expired leases (housekeeping before persisting). */
export function pruneExpired(registryRaw: unknown, now: number): LeaseRegistry {
  const registry = normalizeRegistry(registryRaw);
  const leases: Record<string, FileLease> = {};
  for (const [k, l] of Object.entries(registry.leases)) {
    if (!isExpired(l, now)) leases[k] = l;
  }
  return { version: 1, leases };
}

/** Active (non-expired) leases, for the awareness/status view. */
export function listActiveLeases(registryRaw: unknown, now: number): FileLease[] {
  const registry = normalizeRegistry(registryRaw);
  return Object.values(registry.leases).filter((l) => !isExpired(l, now)).sort((a, b) => a.path.localeCompare(b.path));
}

/** Is this path free for `ownerId` to edit right now? (free = no lease, own it,
 *  or the holder's lease is stale). */
export function isPathFree(registryRaw: unknown, path: string, ownerId: string, now: number): boolean {
  const registry = normalizeRegistry(registryRaw);
  const existing = registry.leases[normalizeLeasePath(path)];
  if (!existing) return true;
  if (existing.ownerId === ownerId) return true;
  return isExpired(existing, now);
}

/** One-line human summary of the active territory. Never throws. */
export function describeLeases(registryRaw: unknown, now: number): string {
  const active = listActiveLeases(registryRaw, now);
  if (!active.length) return 'No files are currently leased by any agent.';
  return active
    .map((l) => `${l.path} — ${l.ownerLabel}${l.intent ? ` (${l.intent})` : ''}, ${Math.max(0, Math.round((l.expiresAt - now) / 1000))}s left`)
    .join('\n');
}
