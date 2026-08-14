/**
 * Server authority for per-user/per-circle Office dashboard state.
 *
 * The legacy profile `office_layout` blob is deliberately not read or written:
 * it has no circle owner and can leak one workspace's layout into another.
 * The canonical path is the versioned `office_layouts` row, which prevents two
 * circles and out-of-order network responses from overwriting each other.
 */

import type { OfficeFloor } from './officeConfig';
import {
  buildOfficeFloorPresetSnapshot,
  normalizeOfficeFloorPresetDescription,
  normalizeOfficeFloorPresetName,
  readOfficeFloorPresetSnapshot,
  type OfficeFloorPresetRecord,
} from './officeFloorPresetCore';
import { validateOfficeLayout } from './officeValidation';
import { interpretOfficeLayoutSaveReceipt } from './officeLayoutSaveReceiptCore';
import {
  OfficeLayoutRequestDeadlineError,
  runOfficeLayoutRequestWithDeadline,
} from './officeLayoutSaveQueueCore';
import { safeGetUserForAccessToken } from './authSession';
import { supabase } from './supabase';

export interface OfficeLayoutDocument {
  floors: OfficeFloor[];
  currentFloorId: string;
  updatedAt: number;
}

export type OfficeLayoutSource = 'circle_server' | 'none';

export interface OfficeLayoutLoadResult {
  ok: boolean;
  layout: OfficeLayoutDocument | null;
  version: number;
  source: OfficeLayoutSource;
  error?: string;
}

export interface OfficeLayoutSaveResult {
  ok: boolean;
  conflict?: boolean;
  version: number;
  source: Exclude<OfficeLayoutSource, 'none'> | 'none';
  error?: string;
}

export interface OfficeLayoutAuthScope {
  userId: string;
  accessToken: string;
}

/**
 * Immutable account/circle authority captured by Office before an asynchronous
 * dashboard operation starts. `authorityGeneration` lets the caller retire an
 * otherwise-identical user/circle/token snapshot when its owning UI lifecycle
 * is replaced.
 */
export type OfficeDashboardExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  authorityGeneration: number;
}>;

/**
 * Must compare the captured authority to the caller's current authority. It is
 * evaluated before dispatch, after token verification, after meaningful
 * awaits, and immediately before every mutation.
 */
export type OfficeDashboardAuthorityGuard = () => boolean;

export type OfficeSessionMemoryMode = 'private' | 'shared';

export type OfficeSessionMemoryModeLoadResult =
  | { ok: true; mode: OfficeSessionMemoryMode }
  | { ok: false; mode: 'private'; error: string };

export type OfficeDashboardMutationResult =
  | { ok: true }
  | { ok: false; error: string };

export type OfficeCircleMembershipResult =
  | { ok: true }
  | { ok: false; denied: boolean; error: string };

export interface OfficeUserPreferencesLoadResult {
  ok: boolean;
  preferences: Record<string, unknown> | null;
  revision: number;
  unavailable?: boolean;
  error?: string;
}

export interface OfficeUserPreferencesPatchResult {
  ok: boolean;
  revision: number;
  unavailable?: boolean;
  retryable: boolean;
  error?: string;
}

function normalizeLayoutAuthScope(input: OfficeLayoutAuthScope): OfficeLayoutAuthScope | null {
  const userId = String(input?.userId || '').trim();
  const accessToken = String(input?.accessToken || '').trim();
  if (!userId || !accessToken || accessToken.length > 16_384) return null;
  return { userId, accessToken };
}

function normalizeOfficeResourceId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= 200 ? normalized : null;
}

function normalizeExactAuthority(
  circleId: string,
  input: OfficeDashboardExactAuthority | undefined,
): OfficeDashboardExactAuthority | null {
  const normalizedCircleId = normalizeOfficeResourceId(circleId);
  const userId = normalizeOfficeResourceId(input?.userId);
  const authorityCircleId = normalizeOfficeResourceId(input?.circleId);
  const accessToken = String(input?.accessToken || '').trim();
  const authorityGeneration = input?.authorityGeneration;
  if (
    !normalizedCircleId
    || !userId
    || authorityCircleId !== normalizedCircleId
    || !accessToken
    || accessToken.length > 16_384
    || !Number.isSafeInteger(authorityGeneration)
    || Number(authorityGeneration) <= 0
  ) return null;
  return Object.freeze({
    userId,
    circleId: normalizedCircleId,
    accessToken,
    authorityGeneration: Number(authorityGeneration),
  });
}

function authorityGuardPasses(guard: OfficeDashboardAuthorityGuard | undefined): boolean {
  if (!guard) return false;
  try {
    return guard() === true;
  } catch {
    return false;
  }
}

async function resolveExactAuthority(
  circleId: string,
  capturedAuthority: OfficeDashboardExactAuthority | undefined,
  isCurrent: OfficeDashboardAuthorityGuard | undefined,
): Promise<OfficeDashboardExactAuthority | null> {
  const authority = normalizeExactAuthority(circleId, capturedAuthority);
  if (!authority || !authorityGuardPasses(isCurrent)) return null;
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (verifiedUser?.id !== authority.userId || !authorityGuardPasses(isCurrent)) return null;
  return authority;
}

const OFFICE_AUTHORITY_RETIRED_ERROR = 'The signed-in Office account changed before this request could be completed.';

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return 'Office server request failed.';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim()
    ? message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180)
    : 'Office server request failed.';
}

function isMissingOfficeDashboardSql(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code || '');
  const message = String((error as { message?: unknown }).message || '').toLowerCase();
  if (code === '42501' || /permission|row.level|rls|not authorized/.test(message)) return false;
  return ['42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(code)
    || /relation ["']?(office_layouts|office_floor_presets|office_attention_acknowledgements)["']? does not exist/.test(message)
    || /relation ["']?(office_layouts|office_floor_presets|office_attention_acknowledgements|office_user_preferences)["']? does not exist/.test(message)
    || /function ["']?(save_office_layout_v2|read_my_office_preferences_v1|patch_my_office_preferences_v1)/.test(message)
      && /does not exist|schema cache/.test(message);
}

function firstRpcRecord(value: unknown): Record<string, unknown> | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : null;
}

/**
 * Proves the exact signed-in subject still belongs to the requested circle
 * before Office is allowed to reveal any account/circle-private surface.
 * A successful empty RLS read is deliberately treated as denial, not as an
 * empty workspace, because an Office layout row by itself is not membership
 * evidence.
 */
export async function verifyOfficeCircleMembership(
  circleId: string,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<OfficeCircleMembershipResult> {
  const authority = await resolveExactAuthority(circleId, capturedAuthority, isCurrent);
  if (!authority) {
    return { ok: false, denied: true, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  }
  try {
    const { data, error } = await runOfficeLayoutRequestWithDeadline((signal) => (
      supabase
        .from('circle_members')
        .select('circle_id,user_id')
        .eq('circle_id', authority.circleId)
        .eq('user_id', authority.userId)
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .abortSignal(signal)
        .maybeSingle()
    ));
    if (!authorityGuardPasses(isCurrent)) {
      return { ok: false, denied: true, error: OFFICE_AUTHORITY_RETIRED_ERROR };
    }
    if (error) {
      return { ok: false, denied: false, error: errorText(error) };
    }
    const row = data as { circle_id?: unknown; user_id?: unknown } | null;
    if (row?.circle_id !== authority.circleId || row?.user_id !== authority.userId) {
      return {
        ok: false,
        denied: true,
        error: 'This signed-in account is not a member of this circle.',
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      denied: false,
      error: error instanceof OfficeLayoutRequestDeadlineError
        ? 'The circle access check timed out. Check your connection and retry.'
        : errorText(error),
    };
  }
}

export async function loadOfficeUserPreferences(
  circleId: string,
  authScope: OfficeLayoutAuthScope,
): Promise<OfficeUserPreferencesLoadResult> {
  const normalizedCircleId = String(circleId || '').trim();
  const authority = normalizeLayoutAuthScope(authScope);
  if (!normalizedCircleId || !authority) {
    return { ok: false, preferences: null, revision: 0, error: 'Sign in required.' };
  }
  try {
    const { data, error } = await runOfficeLayoutRequestWithDeadline((signal) => (
      supabase.rpc('read_my_office_preferences_v1', { p_circle_id: normalizedCircleId })
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .abortSignal(signal)
    ));
    if (error) {
      const unavailable = isMissingOfficeDashboardSql(error);
      return {
        ok: false,
        preferences: null,
        revision: 0,
        unavailable,
        error: unavailable
          ? 'Private per-circle Office preferences are not installed. Device-only settings remain available.'
          : errorText(error),
      };
    }
    const row = firstRpcRecord(data);
    if (!row) return { ok: true, preferences: null, revision: 0 };
    const preferences = row.preferences;
    const revision = row.revision;
    if (
      !preferences
      || typeof preferences !== 'object'
      || Array.isArray(preferences)
      || typeof revision !== 'number'
      || !Number.isSafeInteger(revision)
      || revision < 0
      || JSON.stringify(preferences).length > 131_072
    ) {
      return { ok: false, preferences: null, revision: 0, error: 'The saved Office preferences are invalid.' };
    }
    return { ok: true, preferences: preferences as Record<string, unknown>, revision };
  } catch (error) {
    return {
      ok: false,
      preferences: null,
      revision: 0,
      error: error instanceof OfficeLayoutRequestDeadlineError
        ? 'The private Office preference check timed out. Device-only settings remain available.'
        : errorText(error),
    };
  }
}

export async function patchOfficeUserPreferences(
  circleId: string,
  partial: Readonly<Record<string, unknown>>,
  authScope: OfficeLayoutAuthScope,
  signal?: AbortSignal,
): Promise<OfficeUserPreferencesPatchResult> {
  const normalizedCircleId = String(circleId || '').trim();
  const authority = normalizeLayoutAuthScope(authScope);
  if (!normalizedCircleId || !authority || !partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { ok: false, revision: 0, retryable: false, error: 'Office preferences failed validation.' };
  }
  try {
    let request = supabase.rpc('patch_my_office_preferences_v1', {
      p_circle_id: normalizedCircleId,
      p_patch: partial,
    }).setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (error) {
      const unavailable = isMissingOfficeDashboardSql(error);
      return {
        ok: false,
        revision: 0,
        unavailable,
        retryable: !unavailable,
        error: unavailable
          ? 'Private per-circle Office preferences are not installed. Device-only settings remain available.'
          : errorText(error),
      };
    }
    const receipt = firstRpcRecord(data);
    const revision = receipt?.revision;
    const accepted = receipt?.accepted === true;
    return accepted && typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
      ? { ok: true, revision, retryable: false }
      : { ok: false, revision: 0, retryable: false, error: 'The Office preference receipt was invalid.' };
  } catch (error) {
    return { ok: false, revision: 0, retryable: true, error: errorText(error) };
  }
}

function readLayoutDocument(input: unknown): OfficeLayoutDocument | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  const validation = validateOfficeLayout(candidate);
  if (!validation.valid || !validation.sanitizedLayout) return null;
  const sanitized = validation.sanitizedLayout as Record<string, unknown>;
  if (!Array.isArray(sanitized.floors) || sanitized.floors.length === 0) return null;
  const currentFloorId = typeof sanitized.currentFloorId === 'string'
    ? sanitized.currentFloorId.trim().slice(0, 200)
    : '';
  const updatedAt = typeof sanitized.updatedAt === 'number' && Number.isFinite(sanitized.updatedAt)
    ? Math.max(0, Math.floor(sanitized.updatedAt))
    : 0;
  return {
    floors: sanitized.floors as OfficeFloor[],
    currentFloorId,
    updatedAt,
  };
}

export async function loadOfficeLayoutState(
  circleId: string,
  authScope: OfficeLayoutAuthScope,
): Promise<OfficeLayoutLoadResult> {
  const normalizedCircleId = String(circleId || '').trim();
  if (!normalizedCircleId) return { ok: false, layout: null, version: 0, source: 'none', error: 'Missing circle.' };
  const authority = normalizeLayoutAuthScope(authScope);
  if (!authority) return { ok: false, layout: null, version: 0, source: 'none', error: 'Sign in required.' };

  let response: { data: unknown; error: unknown };
  try {
    response = await runOfficeLayoutRequestWithDeadline((signal) => (
      supabase
        .from('office_layouts')
        .select('layout, layout_version, updated_at')
        .eq('user_id', authority.userId)
        .eq('circle_id', normalizedCircleId)
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .abortSignal(signal)
        .maybeSingle()
    ));
  } catch (error) {
    return {
      ok: false,
      layout: null,
      version: 0,
      source: 'none',
      error: error instanceof OfficeLayoutRequestDeadlineError
        ? 'The Office server layout check timed out. Local editing remains available.'
        : errorText(error),
    };
  }
  const { data, error } = response;
  if (error) {
    if (isMissingOfficeDashboardSql(error)) {
      return {
        ok: false,
        layout: null,
        version: 0,
        source: 'none',
        error: 'Per-circle Office storage is unavailable. Local-only editing remains available.',
      };
    }
    return { ok: false, layout: null, version: 0, source: 'none', error: errorText(error) };
  }
  const row = data as { layout?: unknown; layout_version?: unknown } | null;
  if (!row) return { ok: true, layout: null, version: 0, source: 'none' };
  const layout = readLayoutDocument(row?.layout);
  if (!layout) {
    return {
      ok: false,
      layout: null,
      version: 0,
      source: 'none',
      error: 'The saved Office layout is invalid. Reload or restore a known-good floor before editing.',
    };
  }
  const version = typeof row?.layout_version === 'number' && Number.isFinite(row.layout_version)
    ? Math.max(0, Math.floor(row.layout_version))
    : layout.updatedAt;
  return { ok: true, layout, version, source: 'circle_server' };
}

export async function saveOfficeLayoutState(
  circleId: string,
  input: unknown,
  version: number,
  authScope: OfficeLayoutAuthScope,
): Promise<OfficeLayoutSaveResult> {
  const normalizedCircleId = String(circleId || '').trim();
  const normalizedVersion = Number.isSafeInteger(version) && version > 0 ? version : 0;
  const layout = readLayoutDocument(input);
  const authority = normalizeLayoutAuthScope(authScope);
  if (!normalizedCircleId || !layout || normalizedVersion <= 0 || !authority) {
    return { ok: false, version: 0, source: 'none', error: 'Office layout failed validation.' };
  }
  const payload: OfficeLayoutDocument = { ...layout, updatedAt: normalizedVersion };
  let response: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    response = await runOfficeLayoutRequestWithDeadline((signal) => (
      supabase.rpc('save_office_layout_v2', {
        p_circle_id: normalizedCircleId,
        p_layout: payload,
        p_layout_version: normalizedVersion,
      })
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .abortSignal(signal)
    ));
  } catch (error) {
    return {
      ok: false,
      version: normalizedVersion,
      source: 'none',
      error: error instanceof OfficeLayoutRequestDeadlineError
        ? 'The Office server save timed out. Your local layout remains available.'
        : errorText(error),
    };
  }
  const { data, error } = response;
  if (!error) {
    const receipt = interpretOfficeLayoutSaveReceipt(data, normalizedVersion);
    return {
      ...receipt,
      source: receipt.ok || receipt.conflict ? 'circle_server' : 'none',
    };
  }
  return {
    ok: false,
    version: normalizedVersion,
    source: 'none',
    error: isMissingOfficeDashboardSql(error)
      ? 'Per-circle Office storage is unavailable. Local-only editing remains available.'
      : errorText(error),
  };
}

// Once a target reports the server-clock follow-up RPC missing, skip straight
// to the legacy fallback for the rest of the session instead of paying (and
// console-logging) a 404 on every Office mount. Reset on reload so an applied
// migration is picked up without further action.
let attentionRpcMissingThisSession = false;

export async function listOfficeAttentionAcknowledgements(
  circleId: string,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<string[]> {
  const authority = await resolveExactAuthority(circleId, capturedAuthority, isCurrent);
  if (!authority) return [];
  const { data, error } = attentionRpcMissingThisSession
    ? { data: null, error: { code: 'PGRST202', message: 'cached: rpc missing this session' } }
    : await supabase.rpc('list_active_office_attention_acknowledgements', {
        p_circle_id: authority.circleId,
      }).setHeader('Authorization', `Bearer ${authority.accessToken}`);
  if (!authorityGuardPasses(isCurrent)) return [];
  if (error) {
    if (!isMissingOfficeDashboardSql(error)) {
      console.warn('[OfficeDashboardPersistence] attention load failed:', errorText(error));
      return [];
    }
    attentionRpcMissingThisSession = true;
    // Compatibility for a target that has the historical §37 objects but has
    // not installed the server-clock follow-up yet. Keep current dismissals
    // working; once the migration lands, every read uses the RPC above.
    const { data: legacyData, error: legacyError } = await supabase
      .from('office_attention_acknowledgements')
      .select('attention_id,expires_at')
      .eq('user_id', authority.userId)
      .eq('circle_id', authority.circleId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .limit(500);
    if (legacyError || !authorityGuardPasses(isCurrent)) return [];
    const nowMs = Date.now();
    return (legacyData || [])
      .filter((row: { expires_at?: unknown }) => {
        const expiresAtMs = typeof row.expires_at === 'string' ? Date.parse(row.expires_at) : Number.NaN;
        return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
      })
      .map((row: { attention_id?: unknown }) => typeof row.attention_id === 'string' ? row.attention_id : '')
      .filter(Boolean);
  }
  return (data || [])
    .map((row: { attention_id?: unknown }) => typeof row.attention_id === 'string' ? row.attention_id : '')
    .filter(Boolean);
}

export async function acknowledgeOfficeAttention(
  circleId: string,
  attentionId: string,
  runId?: string | null,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<OfficeDashboardMutationResult> {
  const normalizedCircleId = normalizeOfficeResourceId(circleId);
  const id = String(attentionId || '').trim().slice(0, 240);
  if (!normalizedCircleId || !id) return { ok: false, error: 'Missing attention item.' };
  const authority = await resolveExactAuthority(normalizedCircleId, capturedAuthority, isCurrent);
  if (!authority) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  // Compatibility for targets that still have the historical §37 table but
  // not the server-stamping trigger: an upsert must renew an expired row, not
  // merely update its run_id. The hardened trigger overwrites both values with
  // database time once the follow-up migration is installed.
  const acknowledgedAt = new Date();
  const expiresAt = new Date(acknowledgedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { error } = await supabase.from('office_attention_acknowledgements').upsert({
    user_id: authority.userId,
    circle_id: authority.circleId,
    attention_id: id,
    run_id: typeof runId === 'string' ? runId.trim().slice(0, 240) || null : null,
    acknowledged_at: acknowledgedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  }, { onConflict: 'user_id,circle_id,attention_id' })
    .setHeader('Authorization', `Bearer ${authority.accessToken}`);
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (error) return { ok: false, error: isMissingOfficeDashboardSql(error) ? 'Office state SQL §37 is not installed.' : errorText(error) };
  return { ok: true };
}

function mapFloorPresetRow(value: unknown): OfficeFloorPresetRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const snapshot = readOfficeFloorPresetSnapshot(row.snapshot);
  const id = typeof row.id === 'string' ? row.id : '';
  const circleId = typeof row.circle_id === 'string' ? row.circle_id : '';
  const userId = typeof row.user_id === 'string' ? row.user_id : '';
  const name = normalizeOfficeFloorPresetName(row.name);
  if (!snapshot || !id || !circleId || !userId || !name) return null;
  return {
    id,
    circleId,
    userId,
    name,
    description: normalizeOfficeFloorPresetDescription(row.description) || null,
    snapshot,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

export async function listOfficeFloorPresets(
  circleId: string,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<{ ok: boolean; presets: OfficeFloorPresetRecord[]; error?: string }> {
  const authority = await resolveExactAuthority(circleId, capturedAuthority, isCurrent);
  if (!authority) return { ok: false, presets: [], error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { data, error } = await supabase
    .from('office_floor_presets')
    .select('id,circle_id,user_id,name,description,snapshot,created_at,updated_at')
    .eq('user_id', authority.userId)
    .eq('circle_id', authority.circleId)
    .setHeader('Authorization', `Bearer ${authority.accessToken}`)
    .order('updated_at', { ascending: false })
    .limit(50);
  if (!authorityGuardPasses(isCurrent)) return { ok: false, presets: [], error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (error) return { ok: false, presets: [], error: isMissingOfficeDashboardSql(error) ? 'Office state SQL §37 is not installed.' : errorText(error) };
  return {
    ok: true,
    presets: (data || [])
      .map(mapFloorPresetRow)
      .filter((row): row is OfficeFloorPresetRecord => Boolean(
        row
        && row.circleId === authority.circleId
        && row.userId === authority.userId,
      )),
  };
}

export async function saveOfficeFloorPreset(input: {
  circleId: string;
  name: string;
  description?: string | null;
  floor: OfficeFloor;
}, capturedAuthority?: OfficeDashboardExactAuthority, isCurrent?: OfficeDashboardAuthorityGuard): Promise<{
  ok: boolean;
  preset?: OfficeFloorPresetRecord;
  error?: string;
}> {
  const name = normalizeOfficeFloorPresetName(input.name);
  const description = normalizeOfficeFloorPresetDescription(input.description);
  const snapshot = buildOfficeFloorPresetSnapshot(input.floor);
  if (!name || !snapshot) return { ok: false, error: 'Preset name or floor snapshot is invalid.' };
  const authority = await resolveExactAuthority(input.circleId, capturedAuthority, isCurrent);
  if (!authority) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { data, error } = await supabase
    .from('office_floor_presets')
    .upsert({
      user_id: authority.userId,
      circle_id: authority.circleId,
      name,
      description: description || null,
      snapshot,
    }, { onConflict: 'user_id,circle_id,name' })
    .setHeader('Authorization', `Bearer ${authority.accessToken}`)
    .select('id,circle_id,user_id,name,description,snapshot,created_at,updated_at')
    .single();
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (error) return { ok: false, error: isMissingOfficeDashboardSql(error) ? 'Office state SQL §37 is not installed.' : errorText(error) };
  const preset = mapFloorPresetRow(data);
  return preset?.circleId === authority.circleId && preset.userId === authority.userId
    ? { ok: true, preset }
    : { ok: false, error: 'Server returned an invalid preset.' };
}

export async function deleteOfficeFloorPreset(
  id: string,
  circleId: string,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<OfficeDashboardMutationResult> {
  const normalizedId = String(id || '').trim();
  const normalizedCircleId = normalizeOfficeResourceId(circleId);
  if (!normalizedId || !normalizedCircleId) return { ok: false, error: 'Missing preset or circle.' };
  const authority = await resolveExactAuthority(normalizedCircleId, capturedAuthority, isCurrent);
  if (!authority) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { data, error } = await supabase
    .from('office_floor_presets')
    .delete()
    .eq('id', normalizedId)
    .eq('user_id', authority.userId)
    .eq('circle_id', authority.circleId)
    .setHeader('Authorization', `Bearer ${authority.accessToken}`)
    .select('id,circle_id,user_id');
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (error) return { ok: false, error: isMissingOfficeDashboardSql(error) ? 'Office state SQL §37 is not installed.' : errorText(error) };
  const deleted = Array.isArray(data)
    && data.length === 1
    && data[0]?.id === normalizedId
    && data[0]?.circle_id === authority.circleId
    && data[0]?.user_id === authority.userId;
  return deleted
    ? { ok: true }
    : { ok: false, error: 'The preset was not found in this circle and was not deleted.' };
}

/** Exact-authority Office wrapper for the circle's shared session-memory mode. */
export async function loadOfficeCircleSessionMemoryMode(
  circleId: string,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<OfficeSessionMemoryModeLoadResult> {
  const authority = await resolveExactAuthority(circleId, capturedAuthority, isCurrent);
  if (!authority) return { ok: false, mode: 'private', error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { data, error } = await supabase
    .from('circles')
    .select('id,settings')
    .eq('id', authority.circleId)
    .setHeader('Authorization', `Bearer ${authority.accessToken}`)
    .maybeSingle();
  if (!authorityGuardPasses(isCurrent)) {
    return { ok: false, mode: 'private', error: OFFICE_AUTHORITY_RETIRED_ERROR };
  }
  if (error) return { ok: false, mode: 'private', error: errorText(error) };
  if (!data || data.id !== authority.circleId) {
    return { ok: false, mode: 'private', error: 'The circle memory setting was not found.' };
  }
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
    ? data.settings as Record<string, unknown>
    : {};
  return { ok: true, mode: settings.sessionMemoryMode === 'shared' ? 'shared' : 'private' };
}

/**
 * Read-modify-write the circle setting with one captured bearer. A retired
 * account/generation is rejected after the read and immediately before the
 * update, so an account switch can never redirect the mutation to a new user.
 */
export async function saveOfficeCircleSessionMemoryMode(
  circleId: string,
  mode: OfficeSessionMemoryMode,
  capturedAuthority?: OfficeDashboardExactAuthority,
  isCurrent?: OfficeDashboardAuthorityGuard,
): Promise<OfficeDashboardMutationResult> {
  if (mode !== 'private' && mode !== 'shared') {
    return { ok: false, error: 'The circle memory setting is invalid.' };
  }
  const authority = await resolveExactAuthority(circleId, capturedAuthority, isCurrent);
  if (!authority) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { data, error } = await supabase
    .from('circles')
    .select('id,settings')
    .eq('id', authority.circleId)
    .setHeader('Authorization', `Bearer ${authority.accessToken}`)
    .maybeSingle();
  if (!authorityGuardPasses(isCurrent)) {
    return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  }
  if (error) return { ok: false, error: errorText(error) };
  if (!data || data.id !== authority.circleId) {
    return { ok: false, error: 'The circle memory setting was not found.' };
  }
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)
    ? data.settings as Record<string, unknown>
    : {};
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  const { data: updatedRows, error: updateError } = await supabase
    .from('circles')
    .update({ settings: { ...settings, sessionMemoryMode: mode } })
    .eq('id', authority.circleId)
    .setHeader('Authorization', `Bearer ${authority.accessToken}`)
    .select('id');
  if (!authorityGuardPasses(isCurrent)) return { ok: false, error: OFFICE_AUTHORITY_RETIRED_ERROR };
  if (updateError) return { ok: false, error: errorText(updateError) };
  const updated = Array.isArray(updatedRows)
    && updatedRows.length === 1
    && updatedRows[0]?.id === authority.circleId;
  return updated
    ? { ok: true }
    : { ok: false, error: 'The circle memory setting was not updated.' };
}
