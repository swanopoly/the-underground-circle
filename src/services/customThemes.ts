// Custom Themes Service — Supabase CRUD + React hook
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { OfficeTheme, EnvironmentType, OFFICE_THEMES } from '../lib/officeConfig';
import { safeGetUserForAccessToken } from '../lib/authSession';

export const CUSTOM_THEME_PREFIX = 'custom_';

export interface CustomThemeRecord {
  id: string;
  user_id: string;
  circle_id: string | null;
  name: string;
  environment_type: EnvironmentType;
  colors: Partial<Omit<OfficeTheme, 'id' | 'name' | 'environmentType'>>;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export type CustomThemeExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type CustomThemeAuthorityGuard = (
  authority: CustomThemeExactAuthority,
) => boolean;

export type CustomThemeExactError =
  | 'invalid_authority'
  | 'authority_retired'
  | 'authority_mismatch'
  | 'invalid_request'
  | 'invalid_response'
  | 'request_failed'
  | 'aborted';

export interface CustomThemeInput {
  id?: string;
  name: string;
  environment_type: EnvironmentType;
  colors: Partial<Omit<OfficeTheme, 'id' | 'name' | 'environmentType'>>;
  circle_id?: string | null;
  is_shared?: boolean;
}

export type CustomThemeExactListResult = Readonly<{
  ok: boolean;
  themes: CustomThemeRecord[];
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: CustomThemeExactError | string;
}>;

export type CustomThemeExactMutationResult = Readonly<{
  ok: boolean;
  theme?: CustomThemeRecord;
  deletedId?: string;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: CustomThemeExactError | string;
}>;

export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_THEME_PREFIX);
}

export function extractCustomThemeDbId(themeId: string): string {
  return themeId.replace(CUSTOM_THEME_PREFIX, '');
}

export function customThemeToOfficeTheme(record: CustomThemeRecord): OfficeTheme {
  // Start from the base environment theme or underground fallback
  const baseEnv = record.environment_type || 'office';
  const baseTheme = Object.values(OFFICE_THEMES).find(t => t.environmentType === baseEnv) || OFFICE_THEMES.underground;

  return {
    ...baseTheme,
    id: CUSTOM_THEME_PREFIX + record.id,
    name: record.name,
    environmentType: baseEnv,
    ...record.colors,
  };
}

const MAX_EXACT_SCOPE_PART_LENGTH = 240;
const MAX_EXACT_ACCESS_TOKEN_LENGTH = 16_384;
const MAX_THEME_ROWS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENVIRONMENT_TYPES = new Set<EnvironmentType>([
  'office', 'ship', 'castle', 'station', 'submarine', 'mansion', 'lair',
  'cabin', 'temple', 'garden', 'cyber', 'arctic', 'cathedral',
]);

function normalizeCustomThemeExactAuthority(
  input: CustomThemeExactAuthority | null | undefined,
): CustomThemeExactAuthority | null {
  const userId = typeof input?.userId === 'string' ? input.userId.trim() : '';
  const circleId = typeof input?.circleId === 'string' ? input.circleId.trim() : '';
  const accessToken = typeof input?.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input?.generation;
  if (
    !userId
    || !circleId
    || userId.length > MAX_EXACT_SCOPE_PART_LENGTH
    || circleId.length > MAX_EXACT_SCOPE_PART_LENGTH
    || !accessToken
    || accessToken.length > MAX_EXACT_ACCESS_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || Number(generation) <= 0
  ) return null;
  return Object.freeze({ userId, circleId, accessToken, generation: Number(generation) });
}

function customThemeAuthorityIsCurrent(
  authority: CustomThemeExactAuthority,
  isCurrent: CustomThemeAuthorityGuard | null | undefined,
): boolean {
  if (!isCurrent) return false;
  try {
    return isCurrent(authority) === true;
  } catch {
    return false;
  }
}

async function resolveCustomThemeExactAuthority(
  input: CustomThemeExactAuthority | null | undefined,
  isCurrent: CustomThemeAuthorityGuard | null | undefined,
  signal?: AbortSignal,
): Promise<
  | { ok: true; authority: CustomThemeExactAuthority }
  | { ok: false; authority: CustomThemeExactAuthority | null; error: CustomThemeExactError }
> {
  const authority = normalizeCustomThemeExactAuthority(input);
  if (!authority) return { ok: false, authority: null, error: 'invalid_authority' };
  if (signal?.aborted) return { ok: false, authority, error: 'aborted' };
  if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (signal?.aborted) return { ok: false, authority, error: 'aborted' };
  if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  if (verifiedUser?.id !== authority.userId) {
    return { ok: false, authority, error: 'authority_mismatch' };
  }
  return { ok: true, authority };
}

function exactThemeListFailure(
  authority: CustomThemeExactAuthority | null,
  error: CustomThemeExactError | string,
): CustomThemeExactListResult {
  return {
    ok: false,
    themes: [],
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function exactThemeMutationFailure(
  authority: CustomThemeExactAuthority | null,
  error: CustomThemeExactError | string,
): CustomThemeExactMutationResult {
  return {
    ok: false,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function parseThemeColors(value: unknown): CustomThemeRecord['colors'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const colors: Record<string, string> = {};
  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof color !== 'string' || color.length > 128) {
      return null;
    }
    colors[key] = color;
  }
  return colors as CustomThemeRecord['colors'];
}

function parseCustomThemeRecord(value: unknown): CustomThemeRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const colors = parseThemeColors(row.colors);
  if (
    typeof row.id !== 'string'
    || !UUID_RE.test(row.id)
    || typeof row.user_id !== 'string'
    || typeof row.name !== 'string'
    || !row.name.trim()
    || row.name.length > 120
    || typeof row.environment_type !== 'string'
    || !ENVIRONMENT_TYPES.has(row.environment_type as EnvironmentType)
    || (row.circle_id !== null && typeof row.circle_id !== 'string')
    || typeof row.is_shared !== 'boolean'
    || typeof row.created_at !== 'string'
    || typeof row.updated_at !== 'string'
    || !colors
  ) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    circle_id: row.circle_id as string | null,
    name: row.name,
    environment_type: row.environment_type as EnvironmentType,
    colors,
    is_shared: row.is_shared,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function isAbortedError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
  );
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function loadCustomThemes(circleId?: string): Promise<CustomThemeRecord[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Fetch own themes
  let query = supabase
    .from('user_custom_themes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const { data: ownThemes, error: ownErr } = await query;
  if (ownErr) console.error('loadCustomThemes own:', ownErr);

  let sharedThemes: CustomThemeRecord[] = [];
  if (circleId) {
    const { data, error } = await supabase
      .from('user_custom_themes')
      .select('*')
      .eq('circle_id', circleId)
      .eq('is_shared', true)
      .neq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) console.error('loadCustomThemes shared:', error);
    sharedThemes = (data || []) as CustomThemeRecord[];
  }

  return [...(ownThemes || []), ...sharedThemes] as CustomThemeRecord[];
}

export async function saveCustomTheme(theme: CustomThemeInput): Promise<CustomThemeRecord | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const record = {
    user_id: user.id,
    name: theme.name,
    environment_type: theme.environment_type,
    colors: theme.colors,
    circle_id: theme.circle_id || null,
    is_shared: theme.is_shared ?? false,
    updated_at: new Date().toISOString(),
  };

  if (theme.id) {
    // Update existing
    const { data, error } = await supabase
      .from('user_custom_themes')
      .update(record)
      .eq('id', theme.id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) { console.error('saveCustomTheme update:', error); return null; }
    return data as CustomThemeRecord;
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('user_custom_themes')
      .insert(record)
      .select()
      .single();

    if (error) { console.error('saveCustomTheme insert:', error); return null; }
    return data as CustomThemeRecord;
  }
}

export async function deleteCustomTheme(id: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('user_custom_themes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) { console.error('deleteCustomTheme:', error); return false; }
  return true;
}

/**
 * Load only data attributable to this exact Office authority: the user's own
 * global/current-circle themes plus themes explicitly shared into this circle.
 */
export async function loadCustomThemesExact(
  capturedAuthority: CustomThemeExactAuthority,
  isCurrent: CustomThemeAuthorityGuard,
  signal?: AbortSignal,
): Promise<CustomThemeExactListResult> {
  const resolved = await resolveCustomThemeExactAuthority(capturedAuthority, isCurrent, signal);
  if (!resolved.ok) return exactThemeListFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
    return exactThemeListFailure(authority, 'authority_retired');
  }

  try {
    const withExactBearer = <T extends { setHeader: (name: string, value: string) => T; abortSignal: (nextSignal: AbortSignal) => T }>(query: T): T => {
      let request = query;
      if (signal) request = request.abortSignal(signal);
      return request.setHeader('Authorization', `Bearer ${authority.accessToken}`);
    };
    const ownCircleRequest = withExactBearer(supabase
      .from('user_custom_themes')
      .select('*')
      .eq('user_id', authority.userId)
      .eq('circle_id', authority.circleId)
      .order('created_at', { ascending: false }));
    const ownGlobalRequest = withExactBearer(supabase
      .from('user_custom_themes')
      .select('*')
      .eq('user_id', authority.userId)
      .is('circle_id', null)
      .order('created_at', { ascending: false }));
    const sharedRequest = withExactBearer(supabase
      .from('user_custom_themes')
      .select('*')
      .eq('circle_id', authority.circleId)
      .eq('is_shared', true)
      .neq('user_id', authority.userId)
      .order('created_at', { ascending: false }));
    const [ownCircle, ownGlobal, shared] = await Promise.all([
      ownCircleRequest,
      ownGlobalRequest,
      sharedRequest,
    ]);
    if (signal?.aborted) return exactThemeListFailure(authority, 'aborted');
    if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
      return exactThemeListFailure(authority, 'authority_retired');
    }
    if (ownCircle.error || ownGlobal.error || shared.error) {
      return exactThemeListFailure(
        authority,
        ownCircle.error?.message || ownGlobal.error?.message || shared.error?.message || 'request_failed',
      );
    }
    const rows = [
      ...(Array.isArray(ownCircle.data) ? ownCircle.data : []),
      ...(Array.isArray(ownGlobal.data) ? ownGlobal.data : []),
      ...(Array.isArray(shared.data) ? shared.data : []),
    ];
    if (rows.length > MAX_THEME_ROWS) return exactThemeListFailure(authority, 'invalid_response');
    const themes: CustomThemeRecord[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const theme = parseCustomThemeRecord(row);
      const isOwned = theme?.user_id === authority.userId
        && (theme.circle_id === authority.circleId || theme.circle_id === null);
      const isSharedHere = theme?.user_id !== authority.userId
        && theme?.circle_id === authority.circleId
        && theme?.is_shared === true;
      if (!theme || (!isOwned && !isSharedHere) || seen.has(theme.id)) {
        return exactThemeListFailure(authority, 'invalid_response');
      }
      seen.add(theme.id);
      themes.push(theme);
    }
    return {
      ok: true,
      themes,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactThemeListFailure(authority, isAbortedError(error) || signal?.aborted
      ? 'aborted'
      : 'request_failed');
  }
}

/** Save a theme into this exact circle, never an ownerless/other-circle lane. */
export async function saveCustomThemeExact(
  theme: CustomThemeInput,
  capturedAuthority: CustomThemeExactAuthority,
  isCurrent: CustomThemeAuthorityGuard,
  signal?: AbortSignal,
): Promise<CustomThemeExactMutationResult> {
  const resolved = await resolveCustomThemeExactAuthority(capturedAuthority, isCurrent, signal);
  if (!resolved.ok) return exactThemeMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const name = typeof theme?.name === 'string' ? theme.name.trim() : '';
  const colors = parseThemeColors(theme?.colors);
  if (
    !name
    || name.length > 120
    || !ENVIRONMENT_TYPES.has(theme?.environment_type)
    || !colors
    || (theme.id !== undefined && !UUID_RE.test(theme.id))
    || (theme.circle_id != null && theme.circle_id !== authority.circleId)
  ) return exactThemeMutationFailure(authority, 'invalid_request');
  if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
    return exactThemeMutationFailure(authority, 'authority_retired');
  }

  const record = {
    user_id: authority.userId,
    circle_id: authority.circleId,
    name,
    environment_type: theme.environment_type,
    colors,
    is_shared: theme.is_shared ?? false,
    updated_at: new Date().toISOString(),
  };
  try {
    const executeRequest = async () => {
      if (theme.id) {
        let query = supabase
          .from('user_custom_themes')
          .update(record)
          .eq('id', theme.id)
          .eq('user_id', authority.userId)
          .eq('circle_id', authority.circleId)
          .select('*');
        if (signal) query = query.abortSignal(signal);
        return query
          .single()
          .setHeader('Authorization', `Bearer ${authority.accessToken}`);
      }
      let query = supabase
        .from('user_custom_themes')
        .insert(record)
        .select('*');
      if (signal) query = query.abortSignal(signal);
      return query
        .single()
        .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    };
    const { data, error } = await executeRequest();
    if (signal?.aborted) return exactThemeMutationFailure(authority, 'aborted');
    if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
      return exactThemeMutationFailure(authority, 'authority_retired');
    }
    if (error) return exactThemeMutationFailure(authority, error.message || 'request_failed');
    const saved = parseCustomThemeRecord(data);
    if (
      !saved
      || saved.user_id !== authority.userId
      || saved.circle_id !== authority.circleId
      || (theme.id && saved.id !== theme.id)
    ) return exactThemeMutationFailure(authority, 'invalid_response');
    return {
      ok: true,
      theme: saved,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactThemeMutationFailure(authority, isAbortedError(error) || signal?.aborted
      ? 'aborted'
      : 'request_failed');
  }
}

/** Delete a theme only when it is owned in this exact circle. */
export async function deleteCustomThemeExact(
  id: string,
  capturedAuthority: CustomThemeExactAuthority,
  isCurrent: CustomThemeAuthorityGuard,
  signal?: AbortSignal,
): Promise<CustomThemeExactMutationResult> {
  const resolved = await resolveCustomThemeExactAuthority(capturedAuthority, isCurrent, signal);
  if (!resolved.ok) return exactThemeMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedId = typeof id === 'string' ? id.trim() : '';
  if (!UUID_RE.test(normalizedId)) return exactThemeMutationFailure(authority, 'invalid_request');
  if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
    return exactThemeMutationFailure(authority, 'authority_retired');
  }

  try {
    let request = supabase
      .from('user_custom_themes')
      .delete()
      .eq('id', normalizedId)
      .eq('user_id', authority.userId)
      .eq('circle_id', authority.circleId)
      .select('id');
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (signal?.aborted) return exactThemeMutationFailure(authority, 'aborted');
    if (!customThemeAuthorityIsCurrent(authority, isCurrent)) {
      return exactThemeMutationFailure(authority, 'authority_retired');
    }
    if (error) return exactThemeMutationFailure(authority, error.message || 'request_failed');
    if (!Array.isArray(data) || data.length !== 1 || data[0]?.id !== normalizedId) {
      return exactThemeMutationFailure(authority, 'invalid_response');
    }
    return {
      ok: true,
      deletedId: normalizedId,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactThemeMutationFailure(authority, isAbortedError(error) || signal?.aborted
      ? 'aborted'
      : 'request_failed');
  }
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export function useCustomThemes(circleId?: string) {
  const [themes, setThemes] = useState<CustomThemeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await loadCustomThemes(circleId);
    setThemes(data);
    setLoading(false);
  }, [circleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { themes, loading, refresh };
}

/** Exact-authority Office hook; stale scope data is hidden in the same render. */
export function useCustomThemesExact(
  capturedAuthority: CustomThemeExactAuthority | null | undefined,
  isCurrent: CustomThemeAuthorityGuard,
) {
  const normalizedAuthority = normalizeCustomThemeExactAuthority(capturedAuthority);
  const scopeKey = normalizedAuthority
    ? `${normalizedAuthority.userId}\u0000${normalizedAuthority.circleId}\u0000${normalizedAuthority.generation}`
    : '';
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    themes: CustomThemeRecord[];
    loading: boolean;
    error?: string;
  }>({ scopeKey: '', themes: [], loading: false });
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const authority = normalizeCustomThemeExactAuthority(capturedAuthority);
    const sequence = ++sequenceRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    if (!authority || !customThemeAuthorityIsCurrent(authority, isCurrent)) {
      if (mountedRef.current) setSnapshot({ scopeKey: '', themes: [], loading: false });
      return;
    }
    const requestScopeKey = `${authority.userId}\u0000${authority.circleId}\u0000${authority.generation}`;
    const controller = new AbortController();
    abortRef.current = controller;
    if (mountedRef.current) setSnapshot({ scopeKey: requestScopeKey, themes: [], loading: true });
    const result = await loadCustomThemesExact(authority, isCurrent, controller.signal);
    if (
      !mountedRef.current
      || controller.signal.aborted
      || sequence !== sequenceRef.current
      || !customThemeAuthorityIsCurrent(authority, isCurrent)
    ) return;
    abortRef.current = null;
    setSnapshot({
      scopeKey: requestScopeKey,
      themes: result.ok ? result.themes : [],
      loading: false,
      ...(result.error ? { error: result.error } : {}),
    });
  }, [
    capturedAuthority?.accessToken,
    capturedAuthority?.circleId,
    capturedAuthority?.generation,
    capturedAuthority?.userId,
    isCurrent,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    sequenceRef.current += 1;
    abortRef.current?.abort();
    setSnapshot({ scopeKey, themes: [], loading: Boolean(normalizedAuthority) });
    if (normalizedAuthority) void refresh();
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [refresh, scopeKey]);

  const snapshotIsCurrent = Boolean(
    normalizedAuthority
    && snapshot.scopeKey === scopeKey
    && customThemeAuthorityIsCurrent(normalizedAuthority, isCurrent)
  );
  return {
    themes: snapshotIsCurrent ? snapshot.themes : [],
    loading: snapshotIsCurrent ? snapshot.loading : Boolean(normalizedAuthority),
    error: snapshotIsCurrent ? snapshot.error : undefined,
    refresh,
  };
}
