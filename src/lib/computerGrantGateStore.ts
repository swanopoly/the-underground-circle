/**
 * computerGrantGateStore — persistence for sticky per-site/per-app allow
 * scopes (T7 UX). Same fidelity decision as `computerUseUserTemplates` and
 * `computerTaskState`: these are personal standing grants for THIS device's
 * automation, stored via the cross-platform `storage` wrapper (localStorage
 * on web, AsyncStorage on native) — no new table or migration. Can graduate
 * to a circle-settings JSONB blob if cross-device sync is demanded.
 *
 * Every load/save re-hydrates the in-memory registry in `computerGrantGate`
 * so the synchronous chat router sees the current active scopes.
 */

import { storage } from './storage';
import {
  compactStickyAllowScopes,
  createStickyScope,
  markStickyScopesUsed,
  pruneStickyScopes,
  revokeStickyScope,
  setActiveStickyScopes,
  type CreateStickyScopeResult,
  type StickyAllowScope,
  type StickyAllowScopeKind,
  type StickyScopePruneResult,
} from './computerGrantGate';
import type { ChatComputerConstraintCategory } from './chatComputerRequestRouter';

const STORAGE_KEY = 'uc_sticky_allow_scopes_v1';

async function readAll(): Promise<StickyAllowScope[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return compactStickyAllowScopes(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeAll(scopes: StickyAllowScope[]): Promise<StickyScopePruneResult> {
  const pruned = pruneStickyScopes(scopes);
  try {
    await storage.setItem(STORAGE_KEY, JSON.stringify([...pruned.active, ...pruned.history]));
  } catch {
    // Storage failure degrades to session-only grants — routing still works
    // off the hydrated registry until reload.
  }
  setActiveStickyScopes(pruned.active);
  return pruned;
}

/** Load, prune, hydrate the router registry, and return active + history. */
export async function loadStickyAllowScopes(): Promise<StickyScopePruneResult> {
  const pruned = pruneStickyScopes(await readAll());
  setActiveStickyScopes(pruned.active);
  return pruned;
}

/**
 * Create + persist a sticky scope (replaces an existing active scope for the
 * same site/app so re-granting refreshes categories and expiry).
 */
export async function grantStickyAllowScope(input: {
  scopeKind: StickyAllowScopeKind;
  scopeKey: string;
  allowedCategories: ChatComputerConstraintCategory[];
  grantedByUserId?: string | null;
}): Promise<CreateStickyScopeResult & { scopes?: StickyScopePruneResult }> {
  const created = createStickyScope(input);
  if (!created.ok) return created;
  const existing = await readAll();
  const next = [created.scope, ...existing.filter((scope) => !(scope.id === created.scope.id && !scope.revoked))];
  const scopes = await writeAll(next);
  return { ...created, scopes };
}

/** Revoke a scope by id and persist (it moves to the dimmed history list). */
export async function revokeStickyAllowScope(
  scopeId: string,
  byUserId?: string | null,
): Promise<StickyScopePruneResult> {
  const existing = await readAll();
  return writeAll(revokeStickyScope(existing, scopeId, byUserId));
}

/** Record that scopes auto-approved a route (use count + last used). */
export async function recordStickyAllowScopeUse(usedScopeIds: string[]): Promise<StickyScopePruneResult> {
  const existing = await readAll();
  return writeAll(markStickyScopesUsed(existing, usedScopeIds));
}

/**
 * Fail closed on account exit: preserve the reviewable history but revoke every
 * currently active device grant. Grants are not re-used across accounts, even
 * when an older row predates the `grantedByUserId` field.
 */
export async function revokeAllActiveStickyAllowScopes(
  byUserId?: string | null,
): Promise<StickyScopePruneResult> {
  const existing = await readAll();
  let next = existing;
  for (const scope of existing) {
    if (!scope.revoked) next = revokeStickyScope(next, scope.id, byUserId);
  }
  return writeAll(next);
}
