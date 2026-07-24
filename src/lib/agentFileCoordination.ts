// agentFileCoordination — the runtime that makes agentFileLeaseCore real:
// it persists the advisory lease registry to `<repoRoot>/.uc/agent-locks.json`
// via the desktop bridge, computes content hashes off disk, and exposes the
// safe-edit flow (claim → read → CAS → apply → write → release) that mutating
// file tools call so two agents never clobber each other's work.
// See docs/MULTI_AGENT_FILE_COORDINATION.md.
//
// This is a runtime module (it does I/O via the bridge) — NOT tsx-pure. Its logic
// lives in the pure `agentFileLeaseCore` (smoke-tested) + `fileEditCore`; this
// layer only wires those to the filesystem. It fails SOFT: if the bridge/registry
// is unavailable it degrades to CAS-only (still safe — a stale overwrite is still
// refused), never blocking work on the coordination layer.
//
// Owner identity is a stable per-process id so an agent renews/reclaims only its
// own leases. Nothing here is persisted server-side and no file CONTENT is stored
// in the registry — only paths, hashes, owner labels, and short intents.

import type { FileLease, LeaseRegistry } from './agentFileLeaseCore';
import {
  acquireLease,
  renewLease,
  releaseLease,
  checkWriteConflict,
  hashContent,
  listActiveLeases,
  describeLeases,
  normalizeLeasePath,
  pruneExpired,
  LEASE_DEFAULT_TTL_MS,
} from './agentFileLeaseCore';
import type { FileEdit, FileEditResult } from './fileEditCore';
import { applyFileEdits } from './fileEditCore';

const LOCK_RELATIVE_PATH = '.uc/agent-locks.json';
const MAX_LOCK_FILE_BYTES = 512_000;
const MAX_TARGET_BYTES = 4_000_000;

let OWNER_ID: string | null = null;
let OWNER_LABEL = 'openswan-agent';
let DEFAULT_REPO_ROOT = '';

/** Configure the coordination context once per session (repo root + a human
 *  label like "chat:main" or "subagent:coder"). Safe to call repeatedly. */
export function configureCoordination(opts: { repoRoot?: string; ownerLabel?: string }): void {
  if (opts.repoRoot && typeof opts.repoRoot === 'string') DEFAULT_REPO_ROOT = opts.repoRoot.replace(/\/+$/, '');
  if (opts.ownerLabel && typeof opts.ownerLabel === 'string') OWNER_LABEL = opts.ownerLabel.trim().slice(0, 80) || OWNER_LABEL;
}

/** Stable per-process owner id (agents renew/reclaim only their own leases). */
export function getOwnerId(): string {
  if (!OWNER_ID) {
    const rand = Math.random().toString(36).slice(2, 10);
    OWNER_ID = `agent-${Date.now().toString(36)}-${rand}`;
  }
  return OWNER_ID;
}

export function getOwnerLabel(): string {
  return OWNER_LABEL;
}

function nowMs(): number {
  return Date.now();
}

function resolveRoot(repoRoot?: string): string {
  const r = (repoRoot ?? DEFAULT_REPO_ROOT ?? '').replace(/\/+$/, '');
  return r;
}

function lockPathFor(repoRoot?: string): string {
  const root = resolveRoot(repoRoot);
  return root ? `${root}/${LOCK_RELATIVE_PATH}` : LOCK_RELATIVE_PATH;
}

type Bridge = typeof import('./desktopBridge');
async function bridge(): Promise<Bridge | null> {
  try {
    const b = (await import('./desktopBridge')) as Bridge;
    if (!(await b.isDesktopBridgeAvailable())) return null;
    return b;
  } catch {
    return null;
  }
}

// ── Registry persistence (fails soft to an empty registry) ────────────────────

async function readRegistry(repoRoot?: string): Promise<LeaseRegistry> {
  const b = await bridge();
  if (!b) return { version: 1, leases: {} };
  try {
    const r = await b.readFile(lockPathFor(repoRoot), MAX_LOCK_FILE_BYTES);
    if (!r.ok || r.data?.truncated) return { version: 1, leases: {} };
    const parsed = JSON.parse(r.data?.content || '{}');
    return pruneExpired(parsed, nowMs());
  } catch {
    return { version: 1, leases: {} };
  }
}

async function writeRegistry(registry: LeaseRegistry, repoRoot?: string): Promise<boolean> {
  const b = await bridge();
  if (!b) return false;
  try {
    const root = resolveRoot(repoRoot);
    if (root && typeof (b as any).makeDirectory === 'function') {
      try { await (b as any).makeDirectory(`${root}/.uc`); } catch { /* dir may exist */ }
    }
    const pruned = pruneExpired(registry, nowMs());
    const w = await b.writeTextFile(lockPathFor(repoRoot), JSON.stringify(pruned, null, 2), { overwrite: true });
    return !!w.ok;
  } catch {
    return false;
  }
}

// ── Content-hash CAS primitives ───────────────────────────────────────────────

export interface FileHashResult {
  ok: boolean;
  exists: boolean;
  hash: string;
  content: string | null;
  truncated: boolean;
  error?: string;
}

/** Read a file and hash it (the CAS baseline). exists:false when the file is new. */
export async function hashFile(path: string, repoRoot?: string): Promise<FileHashResult> {
  const b = await bridge();
  if (!b) return { ok: false, exists: false, hash: '', content: null, truncated: false, error: 'desktop bridge offline' };
  try {
    const r = await b.readFile(path, MAX_TARGET_BYTES);
    if (!r.ok) return { ok: true, exists: false, hash: '', content: null, truncated: false };
    if (r.data?.truncated) return { ok: false, exists: true, hash: '', content: null, truncated: true, error: 'file too large to hash fully' };
    const content = r.data?.content ?? '';
    return { ok: true, exists: true, hash: hashContent(content), content, truncated: false };
  } catch (e: any) {
    return { ok: false, exists: false, hash: '', content: null, truncated: false, error: e?.message || 'read failed' };
  }
}

/** CAS check: has `path` changed since it hashed to `baselineHash`? */
export async function verifyUnchanged(path: string, baselineHash: string, repoRoot?: string): Promise<{ verdict: 'clean' | 'conflict' | 'unknown'; reason: string; currentHash: string }> {
  const h = await hashFile(path, repoRoot);
  const currentHash = h.exists ? h.hash : '';
  const { verdict, reason } = checkWriteConflict({ baselineHash, currentHash });
  return { verdict, reason, currentHash };
}

// ── Lease lifecycle ────────────────────────────────────────────────────────────

export interface ClaimResult {
  ok: boolean;
  outcome: 'granted' | 'renewed' | 'reclaimed_stale' | 'held_by_other' | 'no_registry';
  lease?: FileLease;
  holder?: FileLease;
  reason: string;
}

/** Acquire (or renew/reclaim) an advisory lease on a file for THIS agent. */
export async function claimFile(path: string, opts?: { intent?: string; ttlMs?: number; contentHash?: string; repoRoot?: string }): Promise<ClaimResult> {
  const registry = await readRegistry(opts?.repoRoot);
  const res = acquireLease(registry, {
    path,
    ownerId: getOwnerId(),
    ownerLabel: getOwnerLabel(),
    intent: opts?.intent,
    ttlMs: opts?.ttlMs ?? LEASE_DEFAULT_TTL_MS,
    contentHash: opts?.contentHash,
  }, nowMs());
  if (!res.ok) {
    return { ok: false, outcome: res.outcome, holder: res.holder, reason: res.reason };
  }
  const persisted = await writeRegistry(res.registry, opts?.repoRoot);
  // Even if we couldn't persist (no bridge), the CAS layer still protects the
  // write — report the lease decision but note the registry was not durable.
  return { ok: true, outcome: persisted ? res.outcome : 'no_registry', lease: res.lease, reason: persisted ? res.reason : 'lease granted (registry not persisted — CAS still enforced)' };
}

/** Heartbeat: extend this agent's lease on a long edit. */
export async function heartbeatFile(path: string, opts?: { ttlMs?: number; contentHash?: string; repoRoot?: string }): Promise<boolean> {
  const registry = await readRegistry(opts?.repoRoot);
  const res = renewLease(registry, { path, ownerId: getOwnerId(), ttlMs: opts?.ttlMs, contentHash: opts?.contentHash }, nowMs());
  if (!res.ok) return false;
  return writeRegistry(res.registry, opts?.repoRoot);
}

export interface ReleaseResult {
  ok: boolean;
  outcome: 'released' | 'released_expired' | 'not_holder' | 'gone' | 'no_registry';
  /** The current holder, when refused (not_holder). */
  holder?: FileLease;
  reason: string;
}

/** Release this agent's lease (call on completion / error / handoff). Only this
 *  session's own lease — or a genuinely expired one — is released; another
 *  agent's ACTIVE claim is refused (`not_holder`) with the real holder and
 *  remaining time, never force-released. `no_registry` = the release decision
 *  was valid but could not be persisted (bridge offline / write failed), so
 *  other agents will still see the lease until it expires. */
export async function releaseFile(path: string, opts?: { repoRoot?: string }): Promise<ReleaseResult> {
  const registry = await readRegistry(opts?.repoRoot);
  const res = releaseLease(registry, { path, ownerId: getOwnerId() }, nowMs());
  if (!res.ok) {
    return { ok: false, outcome: res.outcome, holder: res.holder, reason: res.reason };
  }
  const persisted = await writeRegistry(res.registry, opts?.repoRoot);
  if (!persisted) {
    return { ok: false, outcome: 'no_registry', reason: 'release not persisted (desktop bridge offline or registry write failed) — the claim stays visible until its lease expires' };
  }
  return { ok: true, outcome: res.outcome, reason: res.reason };
}

// ── Awareness ────────────────────────────────────────────────────────────────

export async function listLeases(repoRoot?: string): Promise<FileLease[]> {
  return listActiveLeases(await readRegistry(repoRoot), nowMs());
}

export async function describeActiveTerritory(repoRoot?: string): Promise<string> {
  return describeLeases(await readRegistry(repoRoot), nowMs());
}

// ── The guarded safe-edit flow (what edit tools call) ─────────────────────────

export interface GuardedEditResult {
  ok: boolean;
  /** Why it failed, when !ok: 'held_by_other' | 'conflict' | 'read_error' | 'apply_error' | 'write_error' | 'bridge_offline'. */
  status: 'applied' | 'held_by_other' | 'conflict' | 'read_error' | 'apply_error' | 'write_error' | 'bridge_offline';
  reason: string;
  holder?: FileLease;
  edit?: FileEditResult;
  /** The hash the write was verified against (for the caller's next baseline). */
  finalHash?: string;
}

/**
 * The full coordinated edit: acquire an advisory lease, read the current file,
 * apply exact-string edits (fileEditCore), CAS-verify the file did not change
 * under us, write, and release. Refuses (without writing) if another agent holds
 * the file OR if the file changed since we read it. This is the entry point the
 * `desktop.edit_file` / `file_write_text` tools should call.
 */
export async function guardedApplyEdits(
  path: string,
  edits: FileEdit[],
  opts?: { intent?: string; repoRoot?: string; releaseAfter?: boolean },
): Promise<GuardedEditResult> {
  const b = await bridge();
  if (!b) return { ok: false, status: 'bridge_offline', reason: 'desktop bridge offline' };
  const releaseAfter = opts?.releaseAfter !== false;
  const norm = normalizeLeasePath(path);

  // 1) Read the current file → CAS baseline.
  const baseline = await hashFile(path, opts?.repoRoot);
  if (!baseline.ok && baseline.truncated) return { ok: false, status: 'read_error', reason: 'file too large to edit safely' };

  // 2) Acquire the advisory lease (record the baseline hash on the lease).
  const claim = await claimFile(path, { intent: opts?.intent, contentHash: baseline.hash, repoRoot: opts?.repoRoot });
  if (!claim.ok) {
    return { ok: false, status: 'held_by_other', reason: `${norm} is being edited by ${claim.holder?.ownerLabel || 'another agent'} — ${claim.reason}`, holder: claim.holder };
  }

  try {
    // 3) Apply edits against the content we just read.
    const currentContent = baseline.exists ? (baseline.content ?? '') : null;
    const applied = applyFileEdits(currentContent, edits, { path });
    if (!applied.ok) return { ok: false, status: 'apply_error', reason: applied.error || 'edit did not apply', edit: applied };

    // 4) CAS: re-read and confirm nothing changed under us between read and write.
    const recheck = await verifyUnchanged(path, baseline.hash, opts?.repoRoot);
    if (recheck.verdict === 'conflict') {
      return { ok: false, status: 'conflict', reason: `${norm} changed on disk since it was read — re-read and re-apply` };
    }

    // 5) Write.
    const w = await b.writeTextFile(path, applied.content, { overwrite: true });
    if (!w.ok) return { ok: false, status: 'write_error', reason: w.error || 'write failed', edit: applied };

    return { ok: true, status: 'applied', reason: applied.created ? 'created' : `applied ${applied.replacements} edit(s)`, edit: applied, finalHash: hashContent(applied.content) };
  } finally {
    if (releaseAfter) { try { await releaseFile(path, { repoRoot: opts?.repoRoot }); } catch { /* best-effort */ } }
  }
}
