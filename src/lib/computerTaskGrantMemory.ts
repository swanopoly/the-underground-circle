import { storage } from './storage';
import type { ComputerUsePermission } from './computerUse';
import type { ComputerTaskGrantId } from './computerTaskGrants';

const STORAGE_KEY_PREFIX = 'computer_task_grants_v1';

type StoredComputerTaskGrant = {
  id: ComputerTaskGrantId;
  grantedAt: string;
};

type StoredComputerTaskGrantState = {
  grants: StoredComputerTaskGrant[];
};

function storageKey(circleId: string): string {
  return `${STORAGE_KEY_PREFIX}_${circleId}`;
}

function normalize(raw: string | null): StoredComputerTaskGrantState {
  if (!raw) return { grants: [] };
  try {
    const parsed = JSON.parse(raw);
    const grants = Array.isArray(parsed?.grants)
      ? parsed.grants
          .map((item: any) => ({
            id: String(item?.id || '') as ComputerTaskGrantId,
            grantedAt: String(item?.grantedAt || ''),
          }))
          .filter((item: StoredComputerTaskGrant) => !!item.id)
      : [];
    return { grants };
  } catch {
    return { grants: [] };
  }
}

export async function loadComputerTaskGrantIds(circleId: string): Promise<ComputerTaskGrantId[]> {
  const raw = await storage.getItem(storageKey(circleId));
  return normalize(raw).grants.map((grant) => grant.id);
}

export async function grantComputerTaskScopes(circleId: string, grantIds: ComputerTaskGrantId[]): Promise<void> {
  const ids = Array.from(new Set(grantIds.filter(Boolean)));
  if (!circleId || ids.length === 0) return;
  const existing = normalize(await storage.getItem(storageKey(circleId)));
  const nextMap = new Map(existing.grants.map((grant) => [grant.id, grant]));
  const now = new Date().toISOString();
  ids.forEach((id) => {
    nextMap.set(id, { id, grantedAt: now });
  });
  await storage.setItem(storageKey(circleId), JSON.stringify({ grants: Array.from(nextMap.values()) }));
}

export function deriveGrantedScopesFromBrowserPermission(
  permission: ComputerUsePermission,
  grantIds: ComputerTaskGrantId[],
): ComputerTaskGrantId[] {
  const available = new Set(grantIds);
  if (permission === 'trusted') {
    return Array.from(available).filter((id) => id === 'browser_navigation' || id === 'browser_side_effect');
  }
  if (permission === 'ask_for_new_sites') {
    return available.has('browser_navigation') ? ['browser_navigation'] : [];
  }
  return [];
}
