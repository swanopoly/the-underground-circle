import { storage } from './storage';
import { safeGetUserForAccessToken } from './authSession';
import { supabase } from './supabase';

export type WorkspaceTabKey = 'CHAT' | 'OFFICE' | 'FEED' | 'ROOMS' | 'INTEGRATIONS' | 'ANALYTICS' | 'MEMBERS' | 'CHALLENGES' | 'BACKPACK' | 'PROFILE';
export type FeedMobileMode = 'missions' | 'goals' | 'activity' | 'agents' | 'board' | 'ai-tools' | 'plan';
export type FeedLowerMode = 'activity' | 'agents' | 'ai-tools';
export type OfficeFocusMode = 'workspace' | 'runtime' | 'intelligence';

export interface CircleWorkspaceProfile {
  circleId: string;
  updatedAt: string;
  tabVisits: Partial<Record<WorkspaceTabKey, number>>;
  chat: {
    messagesSent: number;
    slashCommandsUsed: number;
    assignmentActions: number;
    pluginActions: number;
  };
  feed: {
    searchExpands: number;
    mobileTabVisits: Partial<Record<FeedMobileMode, number>>;
    desktopLowerTabVisits: Partial<Record<FeedLowerMode, number>>;
    marketplaceJumps: number;
  };
  office: {
    selectedAgents: number;
    workspaceActions: number;
    runtimeActions: number;
    intelligenceActions: number;
    terminalCommandOpens: number;
    terminalAutomationOpens: number;
  };
}

export interface AdaptiveWorkspaceSettings {
  enabled: boolean;
  pinLandingTab?: WorkspaceTabKey | null;
  pinFeedMobileTab?: FeedMobileMode | null;
  pinFeedLowerTab?: FeedLowerMode | null;
  pinChatDensity?: 'compact' | 'cozy' | null;
  pinOfficeTerminalTab?: 'commands' | 'automations' | null;
}

const PROFILE_PREFIX = '@workspace_adaptation_v1:';
const SETTINGS_PREFIX = '@workspace_adaptation_settings_v1:';
const EXACT_PROFILE_PREFIX = '@workspace_adaptation_v2';
const EXACT_SETTINGS_PREFIX = '@workspace_adaptation_settings_v2';
const EXACT_STORAGE_SCHEMA_VERSION = 2;
const MAX_EXACT_SCOPE_PART_LENGTH = 240;
const MAX_EXACT_ACCESS_TOKEN_LENGTH = 16_384;
const MAX_EXACT_ACTIVITY_COUNT = 1_000_000_000;
const MAX_EXACT_PREFERENCES_BYTES = 1_048_576;

const WORKSPACE_TAB_KEYS: readonly WorkspaceTabKey[] = [
  'CHAT', 'OFFICE', 'FEED', 'ROOMS', 'INTEGRATIONS', 'ANALYTICS',
  'MEMBERS', 'CHALLENGES', 'BACKPACK', 'PROFILE',
];
const FEED_MOBILE_MODES: readonly FeedMobileMode[] = [
  'missions', 'goals', 'activity', 'agents', 'board', 'ai-tools', 'plan',
];
const FEED_LOWER_MODES: readonly FeedLowerMode[] = ['activity', 'agents', 'ai-tools'];
const CHAT_ACTIVITY_KINDS = ['message', 'slash', 'assignment', 'plugin'] as const;
const FEED_ACTIVITY_KINDS = ['search_expand', 'marketplace_jump', 'mobile_tab', 'desktop_lower_tab'] as const;
const OFFICE_ACTIVITY_KINDS = [
  'select_agent', 'workspace', 'runtime', 'intelligence',
  'terminal_commands', 'terminal_automations',
] as const;

export type WorkspaceAdaptationExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type WorkspaceAdaptationAuthorityFence = (
  authority: WorkspaceAdaptationExactAuthority,
) => boolean;

export type WorkspaceAdaptationExactError =
  | 'invalid_authority'
  | 'authority_mismatch'
  | 'authority_retired'
  | 'invalid_profile'
  | 'invalid_settings'
  | 'invalid_activity'
  | 'invalid_local_data'
  | 'invalid_remote_data'
  | 'local_storage_failed'
  | 'remote_unavailable'
  | 'remote_write_conflict'
  | 'remote_receipt_mismatch';

type WorkspaceAdaptationExactScopeReceipt = Readonly<{
  userId: string | null;
  circleId: string | null;
  generation: number | null;
}>;

export type WorkspaceProfileExactLoadResult = WorkspaceAdaptationExactScopeReceipt & Readonly<{
  ok: boolean;
  profile: CircleWorkspaceProfile | null;
  localLoaded: boolean;
  error?: WorkspaceAdaptationExactError;
}>;

export type WorkspaceProfileExactMutationResult = WorkspaceAdaptationExactScopeReceipt & Readonly<{
  ok: boolean;
  profile: CircleWorkspaceProfile | null;
  localSaved: boolean;
  error?: WorkspaceAdaptationExactError;
}>;

export type AdaptiveWorkspaceSettingsExactLoadResult = WorkspaceAdaptationExactScopeReceipt & Readonly<{
  ok: boolean;
  settings: AdaptiveWorkspaceSettings | null;
  localLoaded: boolean;
  remoteLoaded: boolean;
  error?: WorkspaceAdaptationExactError;
}>;

export type AdaptiveWorkspaceSettingsExactMutationResult = WorkspaceAdaptationExactScopeReceipt & Readonly<{
  ok: boolean;
  settings: AdaptiveWorkspaceSettings | null;
  localSaved: boolean;
  remoteSaved: boolean;
  error?: WorkspaceAdaptationExactError;
}>;

type WorkspaceProfileExactEnvelope = Readonly<{
  schemaVersion: typeof EXACT_STORAGE_SCHEMA_VERSION;
  userId: string;
  circleId: string;
  profile: CircleWorkspaceProfile;
}>;

type AdaptiveWorkspaceSettingsExactEnvelope = Readonly<{
  schemaVersion: typeof EXACT_STORAGE_SCHEMA_VERSION;
  userId: string;
  circleId: string;
  settings: AdaptiveWorkspaceSettings;
}>;

const exactProfileWriteTails = new Map<string, Promise<void>>();
const exactSettingsWriteTails = new Map<string, Promise<void>>();

function defaultProfile(circleId: string): CircleWorkspaceProfile {
  return {
    circleId,
    updatedAt: new Date().toISOString(),
    tabVisits: {},
    chat: {
      messagesSent: 0,
      slashCommandsUsed: 0,
      assignmentActions: 0,
      pluginActions: 0,
    },
    feed: {
      searchExpands: 0,
      mobileTabVisits: {},
      desktopLowerTabVisits: {},
      marketplaceJumps: 0,
    },
    office: {
      selectedAgents: 0,
      workspaceActions: 0,
      runtimeActions: 0,
      intelligenceActions: 0,
      terminalCommandOpens: 0,
      terminalAutomationOpens: 0,
    },
  };
}

function profileKey(circleId: string) {
  return `${PROFILE_PREFIX}${circleId}`;
}

function settingsKey(circleId: string) {
  return `${SETTINGS_PREFIX}${circleId}`;
}

function bump<T extends string>(map: Partial<Record<T, number>>, key: T, amount = 1): Partial<Record<T, number>> {
  return { ...map, [key]: (map[key] || 0) + amount };
}

type ChatActivityKind = typeof CHAT_ACTIVITY_KINDS[number];
type FeedActivityKind = typeof FEED_ACTIVITY_KINDS[number];
type OfficeActivityKind = typeof OFFICE_ACTIVITY_KINDS[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && allowed.includes(value as T);
}

function normalizeExactScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= MAX_EXACT_SCOPE_PART_LENGTH
    ? normalized
    : null;
}

function normalizeWorkspaceAdaptationExactAuthority(
  input: WorkspaceAdaptationExactAuthority | null | undefined,
): WorkspaceAdaptationExactAuthority | null {
  const userId = normalizeExactScopePart(input?.userId);
  const circleId = normalizeExactScopePart(input?.circleId);
  const accessToken = typeof input?.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input?.generation;
  if (
    !userId
    || !circleId
    || !accessToken
    || accessToken.length > MAX_EXACT_ACCESS_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || Number(generation) <= 0
  ) return null;
  return Object.freeze({
    userId,
    circleId,
    accessToken,
    generation: Number(generation),
  });
}

function workspaceAdaptationAuthorityIsCurrent(
  authority: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence | null | undefined,
): boolean {
  if (!isCurrent) return false;
  try {
    return isCurrent(authority) === true;
  } catch {
    return false;
  }
}

/** Exact user/circle profile key. Bearer material and generation are never persisted. */
export function workspaceProfileExactStorageKey(
  authorityInput: WorkspaceAdaptationExactAuthority | null | undefined,
): string | null {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return null;
  return [
    EXACT_PROFILE_PREFIX,
    'user', encodeURIComponent(authority.userId),
    'circle', encodeURIComponent(authority.circleId),
  ].join(':');
}

/** Exact user/circle settings key. It never aliases the circle-only legacy lane. */
export function adaptiveWorkspaceSettingsExactStorageKey(
  authorityInput: WorkspaceAdaptationExactAuthority | null | undefined,
): string | null {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return null;
  return [
    EXACT_SETTINGS_PREFIX,
    'user', encodeURIComponent(authority.userId),
    'circle', encodeURIComponent(authority.circleId),
  ].join(':');
}

function exactScopeReceipt(
  authority: WorkspaceAdaptationExactAuthority | null,
): WorkspaceAdaptationExactScopeReceipt {
  return {
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
  };
}

function profileLoadFailure(
  authority: WorkspaceAdaptationExactAuthority | null,
  error: WorkspaceAdaptationExactError,
): WorkspaceProfileExactLoadResult {
  return {
    ok: false,
    profile: null,
    localLoaded: false,
    ...exactScopeReceipt(authority),
    error,
  };
}

function profileMutationFailure(
  authority: WorkspaceAdaptationExactAuthority | null,
  error: WorkspaceAdaptationExactError,
  localSaved = false,
): WorkspaceProfileExactMutationResult {
  return {
    ok: false,
    profile: null,
    localSaved,
    ...exactScopeReceipt(authority),
    error,
  };
}

function settingsLoadFailure(
  authority: WorkspaceAdaptationExactAuthority | null,
  error: WorkspaceAdaptationExactError,
  localLoaded = false,
): AdaptiveWorkspaceSettingsExactLoadResult {
  return {
    ok: false,
    settings: null,
    localLoaded,
    remoteLoaded: false,
    ...exactScopeReceipt(authority),
    error,
  };
}

function settingsMutationFailure(
  authority: WorkspaceAdaptationExactAuthority | null,
  error: WorkspaceAdaptationExactError,
  localSaved = false,
): AdaptiveWorkspaceSettingsExactMutationResult {
  return {
    ok: false,
    settings: null,
    localSaved,
    remoteSaved: false,
    ...exactScopeReceipt(authority),
    error,
  };
}

function normalizeActivityCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_EXACT_ACTIVITY_COUNT
    ? value
    : null;
}

function normalizeCountMap<T extends string>(
  input: unknown,
  allowed: readonly T[],
): Partial<Record<T, number>> | null {
  if (!isRecord(input)) return null;
  const normalized: Partial<Record<T, number>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!isAllowedValue(key, allowed)) return null;
    const count = normalizeActivityCount(value);
    if (count === null) return null;
    normalized[key] = count;
  }
  return normalized;
}

function normalizeCircleWorkspaceProfile(
  input: unknown,
  circleId: string,
): CircleWorkspaceProfile | null {
  if (!isRecord(input) || input.circleId !== circleId) return null;
  if (typeof input.updatedAt !== 'string' || !Number.isFinite(Date.parse(input.updatedAt))) return null;
  const tabVisits = normalizeCountMap(input.tabVisits, WORKSPACE_TAB_KEYS);
  const chat = isRecord(input.chat) ? input.chat : null;
  const feed = isRecord(input.feed) ? input.feed : null;
  const office = isRecord(input.office) ? input.office : null;
  if (!tabVisits || !chat || !feed || !office) return null;
  const chatCounts = {
    messagesSent: normalizeActivityCount(chat.messagesSent),
    slashCommandsUsed: normalizeActivityCount(chat.slashCommandsUsed),
    assignmentActions: normalizeActivityCount(chat.assignmentActions),
    pluginActions: normalizeActivityCount(chat.pluginActions),
  };
  const feedCounts = {
    searchExpands: normalizeActivityCount(feed.searchExpands),
    marketplaceJumps: normalizeActivityCount(feed.marketplaceJumps),
  };
  const mobileTabVisits = normalizeCountMap(feed.mobileTabVisits, FEED_MOBILE_MODES);
  const desktopLowerTabVisits = normalizeCountMap(feed.desktopLowerTabVisits, FEED_LOWER_MODES);
  const officeCounts = {
    selectedAgents: normalizeActivityCount(office.selectedAgents),
    workspaceActions: normalizeActivityCount(office.workspaceActions),
    runtimeActions: normalizeActivityCount(office.runtimeActions),
    intelligenceActions: normalizeActivityCount(office.intelligenceActions),
    terminalCommandOpens: normalizeActivityCount(office.terminalCommandOpens),
    terminalAutomationOpens: normalizeActivityCount(office.terminalAutomationOpens),
  };
  if (
    Object.values(chatCounts).some(value => value === null)
    || Object.values(feedCounts).some(value => value === null)
    || Object.values(officeCounts).some(value => value === null)
    || !mobileTabVisits
    || !desktopLowerTabVisits
  ) return null;
  return {
    circleId,
    updatedAt: input.updatedAt,
    tabVisits,
    chat: chatCounts as CircleWorkspaceProfile['chat'],
    feed: {
      ...(feedCounts as Pick<CircleWorkspaceProfile['feed'], 'searchExpands' | 'marketplaceJumps'>),
      mobileTabVisits,
      desktopLowerTabVisits,
    },
    office: officeCounts as CircleWorkspaceProfile['office'],
  };
}

function normalizeAdaptiveWorkspaceSettings(
  input: unknown,
  allowMissingEnabled = true,
): AdaptiveWorkspaceSettings | null {
  if (!isRecord(input)) return null;
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return null;
  if (!allowMissingEnabled && typeof input.enabled !== 'boolean') return null;
  if (input.pinLandingTab !== undefined && input.pinLandingTab !== null
      && !isAllowedValue(input.pinLandingTab, WORKSPACE_TAB_KEYS)) return null;
  if (input.pinFeedMobileTab !== undefined && input.pinFeedMobileTab !== null
      && !isAllowedValue(input.pinFeedMobileTab, FEED_MOBILE_MODES)) return null;
  if (input.pinFeedLowerTab !== undefined && input.pinFeedLowerTab !== null
      && !isAllowedValue(input.pinFeedLowerTab, FEED_LOWER_MODES)) return null;
  if (input.pinChatDensity !== undefined && input.pinChatDensity !== null
      && !isAllowedValue(input.pinChatDensity, ['compact', 'cozy'] as const)) return null;
  if (input.pinOfficeTerminalTab !== undefined && input.pinOfficeTerminalTab !== null
      && !isAllowedValue(input.pinOfficeTerminalTab, ['commands', 'automations'] as const)) return null;
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
    ...(input.pinLandingTab !== undefined ? { pinLandingTab: input.pinLandingTab as WorkspaceTabKey | null } : {}),
    ...(input.pinFeedMobileTab !== undefined ? { pinFeedMobileTab: input.pinFeedMobileTab as FeedMobileMode | null } : {}),
    ...(input.pinFeedLowerTab !== undefined ? { pinFeedLowerTab: input.pinFeedLowerTab as FeedLowerMode | null } : {}),
    ...(input.pinChatDensity !== undefined ? { pinChatDensity: input.pinChatDensity as 'compact' | 'cozy' | null } : {}),
    ...(input.pinOfficeTerminalTab !== undefined ? { pinOfficeTerminalTab: input.pinOfficeTerminalTab as 'commands' | 'automations' | null } : {}),
  };
}

function normalizeExactProfileEnvelope(
  raw: string | null,
  authority: WorkspaceAdaptationExactAuthority,
): CircleWorkspaceProfile | null | undefined {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<WorkspaceProfileExactEnvelope>;
    if (
      parsed.schemaVersion !== EXACT_STORAGE_SCHEMA_VERSION
      || parsed.userId !== authority.userId
      || parsed.circleId !== authority.circleId
    ) return undefined;
    return normalizeCircleWorkspaceProfile(parsed.profile, authority.circleId) || undefined;
  } catch {
    return undefined;
  }
}

function normalizeExactSettingsEnvelope(
  raw: string | null,
  authority: WorkspaceAdaptationExactAuthority,
): AdaptiveWorkspaceSettings | null | undefined {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AdaptiveWorkspaceSettingsExactEnvelope>;
    if (
      parsed.schemaVersion !== EXACT_STORAGE_SCHEMA_VERSION
      || parsed.userId !== authority.userId
      || parsed.circleId !== authority.circleId
    ) return undefined;
    return normalizeAdaptiveWorkspaceSettings(parsed.settings, false) || undefined;
  } catch {
    return undefined;
  }
}

function enqueueExactWrite<T>(
  tails: Map<string, Promise<void>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = tails.get(key) || Promise.resolve();
  const run = predecessor.catch(() => undefined).then(operation);
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}

function bumpExact<T extends string>(map: Partial<Record<T, number>>, key: T): Partial<Record<T, number>> {
  const current = normalizeActivityCount(map[key]) || 0;
  return { ...map, [key]: Math.min(MAX_EXACT_ACTIVITY_COUNT, current + 1) };
}

async function persistExactProfile(
  profile: CircleWorkspaceProfile,
  authority: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
  key: string,
): Promise<WorkspaceProfileExactMutationResult> {
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return profileMutationFailure(authority, 'authority_retired');
  }
  const persistedProfile = normalizeCircleWorkspaceProfile({
    ...profile,
    circleId: authority.circleId,
    updatedAt: new Date().toISOString(),
  }, authority.circleId);
  if (!persistedProfile) return profileMutationFailure(authority, 'invalid_profile');
  const envelope: WorkspaceProfileExactEnvelope = {
    schemaVersion: EXACT_STORAGE_SCHEMA_VERSION,
    userId: authority.userId,
    circleId: authority.circleId,
    profile: persistedProfile,
  };
  const serialized = JSON.stringify(envelope);
  try {
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return profileMutationFailure(authority, 'authority_retired');
    }
    await storage.setItem(key, serialized);
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return profileMutationFailure(authority, 'authority_retired', true);
    }
    const receipt = await storage.getItem(key);
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return profileMutationFailure(authority, 'authority_retired', true);
    }
    if (receipt !== serialized) return profileMutationFailure(authority, 'local_storage_failed');
    return {
      ok: true,
      profile: persistedProfile,
      localSaved: true,
      ...exactScopeReceipt(authority),
    };
  } catch {
    return profileMutationFailure(authority, 'local_storage_failed');
  }
}

type RemoteAuthorityResolution =
  | { ok: true }
  | { ok: false; error: 'authority_mismatch' | 'authority_retired' | 'remote_unavailable' };

async function verifyRemoteWorkspaceAuthority(
  authority: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<RemoteAuthorityResolution> {
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, error: 'authority_retired' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, error: 'authority_retired' };
  }
  if (!verifiedUser) return { ok: false, error: 'remote_unavailable' };
  if (verifiedUser.id !== authority.userId) return { ok: false, error: 'authority_mismatch' };
  return { ok: true };
}

type RemotePreferencesReadResult =
  | { ok: true; raw: Record<string, unknown> | null; preferences: Record<string, unknown> }
  | { ok: false; error: 'authority_retired' | 'invalid_remote_data' | 'remote_unavailable' };

function normalizeRemotePreferencesRow(
  data: unknown,
  authority: WorkspaceAdaptationExactAuthority,
): RemotePreferencesReadResult {
  if (data === null || data === undefined) return { ok: true, raw: null, preferences: {} };
  if (!isRecord(data) || data.id !== authority.userId) {
    return { ok: false, error: 'invalid_remote_data' };
  }
  const raw = data.office_preferences;
  if (raw === null || raw === undefined) return { ok: true, raw: null, preferences: {} };
  if (!isRecord(raw)) return { ok: false, error: 'invalid_remote_data' };
  try {
    if (JSON.stringify(raw).length > MAX_EXACT_PREFERENCES_BYTES) {
      return { ok: false, error: 'invalid_remote_data' };
    }
  } catch {
    return { ok: false, error: 'invalid_remote_data' };
  }
  return { ok: true, raw, preferences: raw };
}

async function readRemoteWorkspacePreferences(
  authority: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<RemotePreferencesReadResult> {
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, error: 'authority_retired' };
  }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id,office_preferences')
      .eq('id', authority.userId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`)
      .maybeSingle();
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return { ok: false, error: 'authority_retired' };
    }
    if (error) return { ok: false, error: 'remote_unavailable' };
    return normalizeRemotePreferencesRow(data, authority);
  } catch {
    return { ok: false, error: 'remote_unavailable' };
  }
}

function settingsFromRemotePreferences(
  preferences: Record<string, unknown>,
  circleId: string,
): AdaptiveWorkspaceSettings | null {
  const adaptiveWorkspace = preferences.adaptiveWorkspace;
  if (adaptiveWorkspace === undefined || adaptiveWorkspace === null) return { enabled: true };
  if (!isRecord(adaptiveWorkspace)) return null;
  const circleSettings = adaptiveWorkspace[circleId];
  if (circleSettings === undefined || circleSettings === null) return { enabled: true };
  return normalizeAdaptiveWorkspaceSettings(circleSettings);
}

function adaptiveSettingsEqual(
  left: AdaptiveWorkspaceSettings,
  right: AdaptiveWorkspaceSettings,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeRemoteWorkspaceSettings(
  settings: AdaptiveWorkspaceSettings,
  authority: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<{ saved: boolean; error?: WorkspaceAdaptationExactError }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await readRemoteWorkspacePreferences(authority, isCurrent);
    if (current.ok === false) return { saved: false, error: current.error };
    const adaptiveWorkspace = current.preferences.adaptiveWorkspace;
    if (adaptiveWorkspace !== undefined && adaptiveWorkspace !== null && !isRecord(adaptiveWorkspace)) {
      return { saved: false, error: 'invalid_remote_data' };
    }
    const nextPreferences: Record<string, unknown> = {
      ...current.preferences,
      adaptiveWorkspace: {
        ...(isRecord(adaptiveWorkspace) ? adaptiveWorkspace : {}),
        [authority.circleId]: settings,
      },
    };
    try {
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return { saved: false, error: 'authority_retired' };
      }
      const updateBase = supabase
        .from('profiles')
        .update({ office_preferences: nextPreferences })
        .eq('id', authority.userId);
      const updateMatched = current.raw === null
        ? updateBase.is('office_preferences', null)
        : updateBase.eq('office_preferences', current.raw);
      const { data, error } = await updateMatched
        .select('id,office_preferences')
        .setHeader('Authorization', `Bearer ${authority.accessToken}`)
        .maybeSingle();
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return { saved: false, error: 'authority_retired' };
      }
      if (error) return { saved: false, error: 'remote_unavailable' };
      if (!data) continue;
      const receipt = normalizeRemotePreferencesRow(data, authority);
      if (receipt.ok === false) return { saved: false, error: receipt.error };
      const accepted = settingsFromRemotePreferences(receipt.preferences, authority.circleId);
      if (!accepted || !adaptiveSettingsEqual(accepted, settings)) {
        return { saved: false, error: 'remote_receipt_mismatch' };
      }
      return { saved: true };
    } catch {
      return { saved: false, error: 'remote_unavailable' };
    }
  }
  return { saved: false, error: 'remote_write_conflict' };
}

/**
 * Load local activity from one exact user+circle envelope. This path never
 * reads or migrates the legacy circle-only profile key.
 */
export async function loadCircleWorkspaceProfileExact(
  authorityInput: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactLoadResult> {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return profileLoadFailure(null, 'invalid_authority');
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return profileLoadFailure(authority, 'authority_retired');
  }
  const key = workspaceProfileExactStorageKey(authority);
  if (!key) return profileLoadFailure(authority, 'invalid_authority');
  try {
    const raw = await storage.getItem(key);
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return profileLoadFailure(authority, 'authority_retired');
    }
    const parsed = normalizeExactProfileEnvelope(raw, authority);
    if (parsed === undefined) return profileLoadFailure(authority, 'invalid_local_data');
    return {
      ok: true,
      profile: parsed || defaultProfile(authority.circleId),
      localLoaded: parsed !== null,
      ...exactScopeReceipt(authority),
    };
  } catch {
    return profileLoadFailure(authority, 'local_storage_failed');
  }
}

/** Save one exact activity profile with a byte-identical local receipt. */
export async function saveCircleWorkspaceProfileExact(
  profile: CircleWorkspaceProfile,
  authorityInput: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactMutationResult> {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return profileMutationFailure(null, 'invalid_authority');
  const key = workspaceProfileExactStorageKey(authority);
  if (!key) return profileMutationFailure(authority, 'invalid_authority');
  const normalizedProfile = normalizeCircleWorkspaceProfile(profile, authority.circleId);
  if (!normalizedProfile) return profileMutationFailure(authority, 'invalid_profile');
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return profileMutationFailure(authority, 'authority_retired');
  }
  return enqueueExactWrite(exactProfileWriteTails, key, () => (
    persistExactProfile(normalizedProfile, authority, isCurrent, key)
  ));
}

/** Serialized read-modify-write for exact activity counters. */
export async function updateCircleWorkspaceProfileExact(
  authorityInput: WorkspaceAdaptationExactAuthority,
  updater: (profile: CircleWorkspaceProfile) => CircleWorkspaceProfile,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactMutationResult> {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return profileMutationFailure(null, 'invalid_authority');
  const key = workspaceProfileExactStorageKey(authority);
  if (!key || typeof updater !== 'function') return profileMutationFailure(authority, 'invalid_profile');
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return profileMutationFailure(authority, 'authority_retired');
  }
  return enqueueExactWrite(exactProfileWriteTails, key, async () => {
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return profileMutationFailure(authority, 'authority_retired');
    }
    try {
      const raw = await storage.getItem(key);
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return profileMutationFailure(authority, 'authority_retired');
      }
      const parsed = normalizeExactProfileEnvelope(raw, authority);
      if (parsed === undefined) return profileMutationFailure(authority, 'invalid_local_data');
      let updated: CircleWorkspaceProfile;
      try {
        updated = updater(parsed || defaultProfile(authority.circleId));
      } catch {
        return profileMutationFailure(authority, 'invalid_profile');
      }
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return profileMutationFailure(authority, 'authority_retired');
      }
      const normalized = normalizeCircleWorkspaceProfile(updated, authority.circleId);
      if (!normalized) return profileMutationFailure(authority, 'invalid_profile');
      return persistExactProfile(normalized, authority, isCurrent, key);
    } catch {
      return profileMutationFailure(authority, 'local_storage_failed');
    }
  });
}

export async function recordWorkspaceTabVisitExact(
  authority: WorkspaceAdaptationExactAuthority,
  tab: WorkspaceTabKey,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactMutationResult> {
  if (!isAllowedValue(tab, WORKSPACE_TAB_KEYS)) {
    return profileMutationFailure(normalizeWorkspaceAdaptationExactAuthority(authority), 'invalid_activity');
  }
  return updateCircleWorkspaceProfileExact(authority, profile => ({
    ...profile,
    tabVisits: bumpExact(profile.tabVisits, tab),
  }), isCurrent);
}

export async function recordChatActivityExact(
  authority: WorkspaceAdaptationExactAuthority,
  kind: ChatActivityKind,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactMutationResult> {
  if (!isAllowedValue(kind, CHAT_ACTIVITY_KINDS)) {
    return profileMutationFailure(normalizeWorkspaceAdaptationExactAuthority(authority), 'invalid_activity');
  }
  return updateCircleWorkspaceProfileExact(authority, profile => ({
    ...profile,
    chat: {
      ...profile.chat,
      messagesSent: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.chat.messagesSent + (kind === 'message' ? 1 : 0)),
      slashCommandsUsed: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.chat.slashCommandsUsed + (kind === 'slash' ? 1 : 0)),
      assignmentActions: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.chat.assignmentActions + (kind === 'assignment' ? 1 : 0)),
      pluginActions: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.chat.pluginActions + (kind === 'plugin' ? 1 : 0)),
    },
  }), isCurrent);
}

export async function recordFeedActivityExact(
  authority: WorkspaceAdaptationExactAuthority,
  kind: FeedActivityKind,
  value: FeedMobileMode | FeedLowerMode | undefined,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactMutationResult> {
  const validValue = kind === 'mobile_tab'
    ? isAllowedValue(value, FEED_MOBILE_MODES)
    : kind === 'desktop_lower_tab'
      ? isAllowedValue(value, FEED_LOWER_MODES)
      : value === undefined;
  if (!isAllowedValue(kind, FEED_ACTIVITY_KINDS) || !validValue) {
    return profileMutationFailure(normalizeWorkspaceAdaptationExactAuthority(authority), 'invalid_activity');
  }
  return updateCircleWorkspaceProfileExact(authority, profile => ({
    ...profile,
    feed: {
      ...profile.feed,
      searchExpands: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.feed.searchExpands + (kind === 'search_expand' ? 1 : 0)),
      marketplaceJumps: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.feed.marketplaceJumps + (kind === 'marketplace_jump' ? 1 : 0)),
      mobileTabVisits: kind === 'mobile_tab'
        ? bumpExact(profile.feed.mobileTabVisits, value as FeedMobileMode)
        : profile.feed.mobileTabVisits,
      desktopLowerTabVisits: kind === 'desktop_lower_tab'
        ? bumpExact(profile.feed.desktopLowerTabVisits, value as FeedLowerMode)
        : profile.feed.desktopLowerTabVisits,
    },
  }), isCurrent);
}

export async function recordOfficeActivityExact(
  authority: WorkspaceAdaptationExactAuthority,
  kind: OfficeActivityKind,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<WorkspaceProfileExactMutationResult> {
  if (!isAllowedValue(kind, OFFICE_ACTIVITY_KINDS)) {
    return profileMutationFailure(normalizeWorkspaceAdaptationExactAuthority(authority), 'invalid_activity');
  }
  return updateCircleWorkspaceProfileExact(authority, profile => ({
    ...profile,
    office: {
      ...profile.office,
      selectedAgents: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.office.selectedAgents + (kind === 'select_agent' ? 1 : 0)),
      workspaceActions: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.office.workspaceActions + (kind === 'workspace' ? 1 : 0)),
      runtimeActions: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.office.runtimeActions + (kind === 'runtime' ? 1 : 0)),
      intelligenceActions: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.office.intelligenceActions + (kind === 'intelligence' ? 1 : 0)),
      terminalCommandOpens: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.office.terminalCommandOpens + (kind === 'terminal_commands' ? 1 : 0)),
      terminalAutomationOpens: Math.min(MAX_EXACT_ACTIVITY_COUNT, profile.office.terminalAutomationOpens + (kind === 'terminal_automations' ? 1 : 0)),
    },
  }), isCurrent);
}

/**
 * Load exact local settings and merge only the captured user's remote profile.
 * A network/auth outage keeps the exact device-local result available, while
 * a proven subject mismatch or malformed remote document fails closed.
 */
export async function loadAdaptiveWorkspaceSettingsExact(
  authorityInput: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<AdaptiveWorkspaceSettingsExactLoadResult> {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return settingsLoadFailure(null, 'invalid_authority');
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return settingsLoadFailure(authority, 'authority_retired');
  }
  const key = adaptiveWorkspaceSettingsExactStorageKey(authority);
  if (!key) return settingsLoadFailure(authority, 'invalid_authority');
  let localSettings: AdaptiveWorkspaceSettings | null;
  try {
    const raw = await storage.getItem(key);
    if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
      return settingsLoadFailure(authority, 'authority_retired');
    }
    const parsed = normalizeExactSettingsEnvelope(raw, authority);
    if (parsed === undefined) return settingsLoadFailure(authority, 'invalid_local_data');
    localSettings = parsed;
  } catch {
    return settingsLoadFailure(authority, 'local_storage_failed');
  }

  const verified = await verifyRemoteWorkspaceAuthority(authority, isCurrent);
  if (verified.ok === false) {
    if (verified.error !== 'remote_unavailable') {
      return settingsLoadFailure(authority, verified.error, localSettings !== null);
    }
    return {
      ok: true,
      settings: localSettings || { enabled: true },
      localLoaded: localSettings !== null,
      remoteLoaded: false,
      ...exactScopeReceipt(authority),
      error: 'remote_unavailable',
    };
  }
  const remote = await readRemoteWorkspacePreferences(authority, isCurrent);
  if (remote.ok === false) {
    if (remote.error === 'authority_retired') {
      return settingsLoadFailure(authority, remote.error, localSettings !== null);
    }
    if (remote.error === 'invalid_remote_data') {
      return settingsLoadFailure(authority, remote.error, localSettings !== null);
    }
    return {
      ok: true,
      settings: localSettings || { enabled: true },
      localLoaded: localSettings !== null,
      remoteLoaded: false,
      ...exactScopeReceipt(authority),
      error: remote.error,
    };
  }
  const remoteSettings = settingsFromRemotePreferences(remote.preferences, authority.circleId);
  if (!remoteSettings) return settingsLoadFailure(authority, 'invalid_remote_data', localSettings !== null);
  const merged = normalizeAdaptiveWorkspaceSettings({
    ...remoteSettings,
    ...(localSettings || {}),
  });
  if (!merged) return settingsLoadFailure(authority, 'invalid_remote_data', localSettings !== null);
  return {
    ok: true,
    settings: merged,
    localLoaded: localSettings !== null,
    remoteLoaded: true,
    ...exactScopeReceipt(authority),
  };
}

/**
 * Save exact settings locally with readback proof, then synchronize the same
 * captured user's remote profile with an optimistic owner-bound receipt.
 */
export async function saveAdaptiveWorkspaceSettingsExact(
  settingsInput: AdaptiveWorkspaceSettings,
  authorityInput: WorkspaceAdaptationExactAuthority,
  isCurrent: WorkspaceAdaptationAuthorityFence,
): Promise<AdaptiveWorkspaceSettingsExactMutationResult> {
  const authority = normalizeWorkspaceAdaptationExactAuthority(authorityInput);
  if (!authority) return settingsMutationFailure(null, 'invalid_authority');
  const settings = normalizeAdaptiveWorkspaceSettings(settingsInput, false);
  if (!settings) return settingsMutationFailure(authority, 'invalid_settings');
  const key = adaptiveWorkspaceSettingsExactStorageKey(authority);
  if (!key) return settingsMutationFailure(authority, 'invalid_authority');
  if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
    return settingsMutationFailure(authority, 'authority_retired');
  }
  const laneKey = `user:${encodeURIComponent(authority.userId)}`;
  return enqueueExactWrite(exactSettingsWriteTails, laneKey, async () => {
    const verified = await verifyRemoteWorkspaceAuthority(authority, isCurrent);
    if (verified.ok === false && verified.error !== 'remote_unavailable') {
      return settingsMutationFailure(authority, verified.error);
    }
    const envelope: AdaptiveWorkspaceSettingsExactEnvelope = {
      schemaVersion: EXACT_STORAGE_SCHEMA_VERSION,
      userId: authority.userId,
      circleId: authority.circleId,
      settings,
    };
    const serialized = JSON.stringify(envelope);
    try {
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return settingsMutationFailure(authority, 'authority_retired');
      }
      await storage.setItem(key, serialized);
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return settingsMutationFailure(authority, 'authority_retired', true);
      }
      const receipt = await storage.getItem(key);
      if (!workspaceAdaptationAuthorityIsCurrent(authority, isCurrent)) {
        return settingsMutationFailure(authority, 'authority_retired', true);
      }
      if (receipt !== serialized) return settingsMutationFailure(authority, 'local_storage_failed');
    } catch {
      return settingsMutationFailure(authority, 'local_storage_failed');
    }
    if (verified.ok === false) {
      return {
        ok: true,
        settings,
        localSaved: true,
        remoteSaved: false,
        ...exactScopeReceipt(authority),
        error: verified.error,
      };
    }
    const remote = await writeRemoteWorkspaceSettings(settings, authority, isCurrent);
    if (remote.error === 'authority_retired' || remote.error === 'authority_mismatch') {
      return settingsMutationFailure(authority, remote.error, true);
    }
    return {
      ok: true,
      settings,
      localSaved: true,
      remoteSaved: remote.saved,
      ...exactScopeReceipt(authority),
      ...(remote.error ? { error: remote.error } : {}),
    };
  });
}

export async function loadCircleWorkspaceProfile(circleId: string): Promise<CircleWorkspaceProfile> {
  try {
    const raw = await storage.getItem(profileKey(circleId));
    if (!raw) return defaultProfile(circleId);
    return { ...defaultProfile(circleId), ...JSON.parse(raw) };
  } catch {
    return defaultProfile(circleId);
  }
}

export async function loadAdaptiveWorkspaceSettings(circleId: string): Promise<AdaptiveWorkspaceSettings> {
  try {
    const raw = await storage.getItem(settingsKey(circleId));
    const local = raw ? JSON.parse(raw) : {};
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return { enabled: true, ...local };
    const { data } = await supabase
      .from('profiles')
      .select('office_preferences')
      .eq('id', userId)
      .single();
    const remote = (data?.office_preferences as any)?.adaptiveWorkspace?.[circleId] || {};
    return {
      enabled: true,
      ...remote,
      ...local,
    };
  } catch {
    return { enabled: true };
  }
}

export async function saveAdaptiveWorkspaceSettings(circleId: string, settings: AdaptiveWorkspaceSettings): Promise<void> {
  try {
    await storage.setItem(settingsKey(circleId), JSON.stringify(settings));
  } catch {}
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('profiles')
      .select('office_preferences')
      .eq('id', userId)
      .single();
    const current = (data?.office_preferences || {}) as Record<string, any>;
    const adaptiveWorkspace = {
      ...(current.adaptiveWorkspace || {}),
      [circleId]: settings,
    };
    await supabase
      .from('profiles')
      .update({
        office_preferences: {
          ...current,
          adaptiveWorkspace,
        },
      })
      .eq('id', userId);
  } catch {}
}

export async function saveCircleWorkspaceProfile(profile: CircleWorkspaceProfile): Promise<void> {
  try {
    await storage.setItem(profileKey(profile.circleId), JSON.stringify({
      ...profile,
      updatedAt: new Date().toISOString(),
    }));
  } catch {}
}

export async function updateCircleWorkspaceProfile(
  circleId: string,
  updater: (profile: CircleWorkspaceProfile) => CircleWorkspaceProfile,
): Promise<CircleWorkspaceProfile> {
  const current = await loadCircleWorkspaceProfile(circleId);
  const next = updater(current);
  await saveCircleWorkspaceProfile(next);
  return next;
}

export async function recordWorkspaceTabVisit(circleId: string, tab: WorkspaceTabKey): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    tabVisits: bump(profile.tabVisits, tab),
  }));
}

export async function recordChatActivity(
  circleId: string,
  kind: 'message' | 'slash' | 'assignment' | 'plugin',
): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    chat: {
      ...profile.chat,
      messagesSent: profile.chat.messagesSent + (kind === 'message' ? 1 : 0),
      slashCommandsUsed: profile.chat.slashCommandsUsed + (kind === 'slash' ? 1 : 0),
      assignmentActions: profile.chat.assignmentActions + (kind === 'assignment' ? 1 : 0),
      pluginActions: profile.chat.pluginActions + (kind === 'plugin' ? 1 : 0),
    },
  }));
}

export async function recordFeedActivity(
  circleId: string,
  kind: 'search_expand' | 'marketplace_jump' | 'mobile_tab' | 'desktop_lower_tab',
  value?: FeedMobileMode | FeedLowerMode,
): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    feed: {
      ...profile.feed,
      searchExpands: profile.feed.searchExpands + (kind === 'search_expand' ? 1 : 0),
      marketplaceJumps: profile.feed.marketplaceJumps + (kind === 'marketplace_jump' ? 1 : 0),
      mobileTabVisits: kind === 'mobile_tab' && value
        ? bump(profile.feed.mobileTabVisits, value as FeedMobileMode)
        : profile.feed.mobileTabVisits,
      desktopLowerTabVisits: kind === 'desktop_lower_tab' && value
        ? bump(profile.feed.desktopLowerTabVisits, value as FeedLowerMode)
        : profile.feed.desktopLowerTabVisits,
    },
  }));
}

export async function recordOfficeActivity(
  circleId: string,
  kind: 'select_agent' | 'workspace' | 'runtime' | 'intelligence' | 'terminal_commands' | 'terminal_automations',
): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    office: {
      ...profile.office,
      selectedAgents: profile.office.selectedAgents + (kind === 'select_agent' ? 1 : 0),
      workspaceActions: profile.office.workspaceActions + (kind === 'workspace' ? 1 : 0),
      runtimeActions: profile.office.runtimeActions + (kind === 'runtime' ? 1 : 0),
      intelligenceActions: profile.office.intelligenceActions + (kind === 'intelligence' ? 1 : 0),
      terminalCommandOpens: profile.office.terminalCommandOpens + (kind === 'terminal_commands' ? 1 : 0),
      terminalAutomationOpens: profile.office.terminalAutomationOpens + (kind === 'terminal_automations' ? 1 : 0),
    },
  }));
}

function topKey<T extends string>(counts: Partial<Record<T, number>>, fallback: T): T {
  const ranked = Object.entries(counts).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  return (ranked[0]?.[0] as T) || fallback;
}

export function getRecommendedLandingTab(profile: CircleWorkspaceProfile): WorkspaceTabKey {
  const weighted: Partial<Record<WorkspaceTabKey, number>> = { ...profile.tabVisits };
  weighted.CHAT = (weighted.CHAT || 0) + profile.chat.messagesSent * 0.6 + profile.chat.slashCommandsUsed * 0.3;
  weighted.FEED = (weighted.FEED || 0) + profile.feed.marketplaceJumps * 0.3 + profile.feed.searchExpands * 0.2;
  weighted.OFFICE = (weighted.OFFICE || 0) + profile.office.selectedAgents * 0.5 + profile.office.runtimeActions * 0.4;
  return topKey(weighted, 'OFFICE');
}

export function getAdaptiveFeedDefaults(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings) {
  if (settings?.enabled === false) {
    return {
      mobileTab: settings.pinFeedMobileTab || 'missions',
      desktopLowerTab: settings.pinFeedLowerTab || 'activity',
      searchExpanded: false,
    };
  }
  return {
    mobileTab: settings?.pinFeedMobileTab || topKey(profile.feed.mobileTabVisits, 'missions'),
    desktopLowerTab: settings?.pinFeedLowerTab || topKey(profile.feed.desktopLowerTabVisits, 'activity'),
    searchExpanded: profile.feed.searchExpands >= 4,
  };
}

export function getAdaptiveOfficeDefaults(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings) {
  const focus: OfficeFocusMode =
    profile.office.runtimeActions >= profile.office.workspaceActions &&
    profile.office.runtimeActions >= profile.office.intelligenceActions
      ? 'runtime'
      : profile.office.intelligenceActions > profile.office.workspaceActions
        ? 'intelligence'
        : 'workspace';

  return {
    focus,
    terminalInitialTab: settings?.pinOfficeTerminalTab || (profile.office.terminalAutomationOpens > profile.office.terminalCommandOpens ? 'automations' as const : 'commands' as const),
  };
}

export function getAdaptiveChatDefaults(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings) {
  return {
    messageDensity: settings?.pinChatDensity || (profile.chat.messagesSent > 40 || profile.chat.slashCommandsUsed > 10 ? 'compact' as const : 'cozy' as const),
  };
}

export function getAdaptiveLandingTab(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings): WorkspaceTabKey {
  if (settings?.enabled === false) return settings?.pinLandingTab || 'OFFICE';
  return settings?.pinLandingTab || getRecommendedLandingTab(profile);
}

export function buildAdaptiveWorkspaceSummary(profile: CircleWorkspaceProfile): string[] {
  const topTab = getRecommendedLandingTab(profile);
  const feedDefaults = getAdaptiveFeedDefaults(profile);
  const officeDefaults = getAdaptiveOfficeDefaults(profile);
  const chatDefaults = getAdaptiveChatDefaults(profile);
  return [
    `Most-used landing tab: ${topTab}`,
    `Chat style trend: ${chatDefaults.messageDensity}`,
    `Feed default focus: ${feedDefaults.mobileTab} / ${feedDefaults.desktopLowerTab}`,
    `Office runtime default: ${officeDefaults.terminalInitialTab}`,
    `Chat messages sent: ${profile.chat.messagesSent}`,
    `Office runtime actions: ${profile.office.runtimeActions}`,
    `Feed marketplace jumps: ${profile.feed.marketplaceJumps}`,
  ];
}
