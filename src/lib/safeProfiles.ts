import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase } from './supabase';

/**
 * The only profile fields that may be projected to another Circle member.
 * Keep this list in lockstep with the intentionally bounded safe_profiles
 * view. Raw profiles owns private Office, wallet, training, and account data.
 */
export const SAFE_PROFILE_SELECT = [
  'id',
  'username',
  'display_name',
  'avatar_url',
  'bio',
  'current_streak',
  'longest_streak',
  'created_at',
  'wallet_address',
  'wallet_chain',
].join(', ');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROFILE_IDS = 200;

export interface SafeProfile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  current_streak: number | null;
  longest_streak: number | null;
  created_at: string | null;
  /** The server projection deliberately returns peer wallet fields as null. */
  wallet_address: string | null;
  wallet_chain: string | null;
}

export interface LoadSafeCircleProfilesOptions {
  circleId: string;
  userIds: readonly string[];
  client?: SupabaseClient;
}

function normalizeUuid(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Hydrate presentation-only profiles for members of one exact Circle.
 *
 * `safe_profiles` proves that caller and peer share *a* Circle. The explicit
 * membership intersection below additionally prevents a stale component for
 * Circle A from hydrating somebody merely because the caller also shares
 * Circle B with them. Missing, malformed, nonmember, and excess ids are
 * omitted fail closed.
 */
export async function loadSafeCircleProfiles({
  circleId,
  userIds,
  client = supabase,
}: LoadSafeCircleProfilesOptions): Promise<SafeProfile[]> {
  const exactCircleId = normalizeUuid(circleId);
  if (!exactCircleId) return [];

  const requestedIds = Array.from(new Set(userIds.map(normalizeUuid).filter((id): id is string => !!id)))
    .slice(0, MAX_PROFILE_IDS);
  if (requestedIds.length === 0) return [];

  const { data: membershipRows, error: membershipError } = await client
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', exactCircleId)
    .in('user_id', requestedIds)
    .limit(MAX_PROFILE_IDS);
  if (membershipError) throw membershipError;

  const exactMemberIds = new Set(
    (membershipRows || [])
      .map((row: { user_id?: unknown }) => normalizeUuid(row.user_id))
      .filter((id): id is string => !!id),
  );
  const allowedIds = requestedIds.filter(id => exactMemberIds.has(id));
  if (allowedIds.length === 0) return [];

  const { data: profileRows, error: profileError } = await client
    .from('safe_profiles')
    .select(SAFE_PROFILE_SELECT)
    .in('id', allowedIds)
    .limit(MAX_PROFILE_IDS);
  if (profileError) throw profileError;

  // Revalidate the exact Circle after the profile I/O. This closes the
  // mutable-singleton race where the browser account could change between the
  // first membership read and safe_profiles response. Exact-authority callers
  // should still pass their captured-token client and generation-fence render.
  const { data: confirmedMembershipRows, error: confirmationError } = await client
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', exactCircleId)
    .in('user_id', allowedIds)
    .limit(MAX_PROFILE_IDS);
  if (confirmationError) throw confirmationError;
  const confirmedMemberIds = new Set(
    (confirmedMembershipRows || [])
      .map((row: { user_id?: unknown }) => normalizeUuid(row.user_id))
      .filter((id): id is string => !!id),
  );

  return ((profileRows || []) as unknown[]).filter((row: unknown): row is SafeProfile => {
    if (!row || typeof row !== 'object') return false;
    const id = normalizeUuid((row as { id?: unknown }).id);
    return !!id && exactMemberIds.has(id) && confirmedMemberIds.has(id);
  });
}

export function indexSafeProfiles(rows: readonly SafeProfile[]): Map<string, SafeProfile> {
  return new Map(rows.map(row => [row.id, row]));
}

export async function findSafeCircleProfileByUsername(
  circleId: string,
  username: string,
  client: SupabaseClient = supabase,
): Promise<SafeProfile | null> {
  const normalizedUsername = String(username || '').trim().replace(/^@/, '').toLowerCase();
  if (!normalizedUsername || normalizedUsername.length > 64) return null;
  const exactCircleId = normalizeUuid(circleId);
  if (!exactCircleId) return null;

  const { data: memberships, error } = await client
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', exactCircleId)
    .limit(MAX_PROFILE_IDS);
  if (error) throw error;
  const profiles = await loadSafeCircleProfiles({
    circleId: exactCircleId,
    userIds: (memberships || []).map((row: { user_id?: unknown }) => String(row.user_id || '')),
    client,
  });
  return profiles.find(profile => profile.username?.trim().toLowerCase() === normalizedUsername) || null;
}
