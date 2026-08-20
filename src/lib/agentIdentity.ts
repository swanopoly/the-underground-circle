// Agent Identity System - Persistent agent data based on sessionKey
// This ensures agents keep their identity even when connections change.
//
// Dual-persisted (as of 2026-04-30): localStorage stays as the fast cache,
// agent_identities table is the durable source of truth across browser
// clears + devices. saveAgentIdentities writes to both. loadAgentIdentities
// reads localStorage first then asynchronously refreshes from DB.
//
// See migration 20260430_agent_identities.sql.

import { Platform } from 'react-native';
import { storage } from './storage';
import { supabase } from './supabase';
import type { OfficeAgent } from './officeAgents';
import { DEFAULT_APPEARANCE, type AgentAppearance } from './officeConfig';
import { getAgentIdentityKey, type AgentIdentityKeyInput } from './agentIdentityKey';

export { getAgentIdentityKey } from './agentIdentityKey';

const STORAGE_KEY_AGENT_IDENTITY = '@agent_identity_store';
const STORAGE_KEY_AGENT_IDENTITY_EXACT_PREFIX = '@agent_identity_store_v2';
const TERMINAL_CONFIG_TAG_PREFIX = 'uc_terminal_config:';
const MAX_AGENT_IDENTITY_SCOPE_PART_LENGTH = 200;
const MAX_AGENT_IDENTITY_ACCESS_TOKEN_LENGTH = 16_384;
const MAX_AGENT_IDENTITY_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_AGENT_IDENTITIES_PER_SCOPE = 5_000;
const AGENT_IDENTITY_CACHE_LOCK_TIMEOUT_MS = 8_000;

/**
 * A caller-captured identity authority. Exact APIs never obtain a replacement
 * session from mutable global auth state. `circleId` scopes the device cache;
 * the current server schema remains owner-global (`user_id, session_key`).
 */
export interface AgentIdentityExactAuthority {
  userId: string;
  accessToken: string;
  circleId?: string | null;
  /**
   * Monotonic lifecycle generation captured by the owning surface. Read-only
   * compatibility callers may omit it, but every exact mutation requires it.
   */
  generation?: number;
}

interface NormalizedAgentIdentityExactAuthority {
  userId: string;
  accessToken: string;
  circleId: string | null;
  generation: number | undefined;
}

export type AgentIdentityExactWriteAuthority = Readonly<{
  userId: string;
  accessToken: string;
  circleId: string;
  generation: number;
}>;

export type AgentIdentityExactAuthorityFence = (
  authority: AgentIdentityExactWriteAuthority,
) => boolean;

export interface AgentIdentityExactSyncResult {
  ok: boolean;
  identities: Map<string, AgentIdentity>;
  error?: 'invalid_authority' | 'authority_mismatch' | 'server_unavailable' | 'invalid_response';
}

export type AgentIdentityExactRefreshError =
  | 'invalid_authority'
  | 'authority_mismatch'
  | 'authority_retired'
  | 'server_unavailable'
  | 'invalid_response'
  | 'invalid_local_data'
  | 'local_write_failed';

export interface AgentIdentityExactRefreshResult {
  /** True only when the count-complete server snapshot also reached the exact cache. */
  ok: boolean;
  identities: Map<string, AgentIdentity>;
  /** True means `identities` is verified server truth and is safe for immediate UI adoption. */
  serverVerified: boolean;
  localSaved: boolean;
  error?: AgentIdentityExactRefreshError;
}

export interface AgentIdentityExactSaveResult {
  ok: boolean;
  localSaved: boolean;
  /** Null means the RPC returned 2xx, but its receipt could not prove the outcome. */
  serverSaved: boolean | null;
  error?:
    | 'invalid_authority'
    | 'authority_mismatch'
    | 'authority_retired'
    | 'invalid_payload'
    | 'invalid_local_data'
    | 'invalid_receipt'
    | 'outcome_unknown'
    | 'mutation_superseded'
    | 'local_write_failed'
    | 'server_unavailable';
}

export type AgentPublishedSpiritAssignmentInput = Readonly<{
  officeAgentId: string;
  sessionKey: string;
  spiritId: string | null;
  spiritEmoji: string | null;
  customProfileId: string | null;
}>;

export interface AgentCustomProfileDeleteResult {
  ok: boolean;
  /** Null means the RPC returned 2xx, but its receipt could not prove the outcome. */
  serverDeleted: boolean | null;
  error?:
    | 'invalid_authority'
    | 'authority_mismatch'
    | 'authority_retired'
    | 'invalid_payload'
    | 'invalid_receipt'
    | 'outcome_unknown'
    | 'mutation_superseded'
    | 'profile_referenced'
    | 'server_unavailable';
}

function normalizeAgentIdentityScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_AGENT_IDENTITY_SCOPE_PART_LENGTH) return null;
  return normalized;
}

function isAgentIdentityUuidLike(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function normalizeAgentIdentityExactAuthority(
  authority: AgentIdentityExactAuthority | null | undefined,
): NormalizedAgentIdentityExactAuthority | null {
  if (!authority || typeof authority !== 'object') return null;
  const userId = normalizeAgentIdentityScopePart(authority.userId);
  const accessToken = typeof authority.accessToken === 'string' ? authority.accessToken.trim() : '';
  if (!userId || !accessToken || accessToken.length > MAX_AGENT_IDENTITY_ACCESS_TOKEN_LENGTH) return null;
  const hasCircleId = authority.circleId !== undefined && authority.circleId !== null;
  const circleId = hasCircleId ? normalizeAgentIdentityScopePart(authority.circleId) : null;
  if (hasCircleId && !circleId) return null;
  const hasGeneration = authority.generation !== undefined && authority.generation !== null;
  const generation = hasGeneration ? Number(authority.generation) : undefined;
  if (hasGeneration && (!Number.isSafeInteger(generation) || Number(generation) <= 0)) return null;
  return { userId, accessToken, circleId, generation };
}

function normalizeAgentIdentityExactWriteAuthority(
  authority: AgentIdentityExactWriteAuthority | null | undefined,
): AgentIdentityExactWriteAuthority | null {
  const normalized = normalizeAgentIdentityExactAuthority(authority);
  if (!normalized?.circleId || normalized.generation === undefined) return null;
  return {
    userId: normalized.userId,
    accessToken: normalized.accessToken,
    circleId: normalized.circleId,
    generation: normalized.generation,
  };
}

function isAgentIdentityExactAuthorityCurrent(
  authority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): boolean {
  try {
    return fence(authority);
  } catch {
    return false;
  }
}

type AgentIdentityExactCommandEpoch = Readonly<{ key: string; epoch: number }>;

const _agentIdentityExactCommandEpochs = new Map<string, number>();
const _agentIdentityExactCachePublicationTails = new Map<string, Promise<void>>();

type AgentIdentityWebLockManager = Readonly<{
  request<T>(
    name: string,
    options: Readonly<{ mode: 'exclusive'; signal: AbortSignal }>,
    callback: () => Promise<T>,
  ): Promise<T>;
}>;

type AgentIdentityExactCacheLockResult<T> =
  | Readonly<{ acquired: true; value: T }>
  | Readonly<{ acquired: false }>;

function beginAgentIdentityExactCommand(
  kind: 'primary' | 'published_spirit' | 'profile_delete',
  authority: AgentIdentityExactWriteAuthority,
  target: string,
): AgentIdentityExactCommandEpoch {
  // The key is exact-scope metadata only; bearer material never enters it.
  const key = JSON.stringify([kind, authority.userId, authority.circleId, target]);
  const epoch = (_agentIdentityExactCommandEpochs.get(key) || 0) + 1;
  _agentIdentityExactCommandEpochs.set(key, epoch);
  return { key, epoch };
}

function isAgentIdentityExactCommandEpochCurrent(
  command: AgentIdentityExactCommandEpoch,
): boolean {
  return _agentIdentityExactCommandEpochs.get(command.key) === command.epoch;
}

function makeAgentIdentityExactCommandFence(
  fence: AgentIdentityExactAuthorityFence,
  command: AgentIdentityExactCommandEpoch,
): AgentIdentityExactAuthorityFence {
  return authority => isAgentIdentityExactAuthorityCurrent(authority, fence)
    && isAgentIdentityExactCommandEpochCurrent(command);
}

function agentIdentityExactCommandRetirementError(
  authority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
  command: AgentIdentityExactCommandEpoch,
): 'authority_retired' | 'mutation_superseded' {
  return isAgentIdentityExactAuthorityCurrent(authority, fence)
    && !isAgentIdentityExactCommandEpochCurrent(command)
    ? 'mutation_superseded'
    : 'authority_retired';
}

function isAgentIdentityExactWebCacheRealm(): boolean {
  return Platform.OS === 'web';
}

function getAgentIdentityWebLockManager(): AgentIdentityWebLockManager | null {
  try {
    const locks = (globalThis as unknown as {
      navigator?: { locks?: AgentIdentityWebLockManager };
    }).navigator?.locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

async function runAgentIdentityExactCachePublicationInRealm<T>(
  cacheKey: string,
  task: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  const prior = _agentIdentityExactCachePublicationTails.get(cacheKey) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tail = prior.catch(() => undefined).then(() => gate);
  _agentIdentityExactCachePublicationTails.set(cacheKey, tail);
  await prior.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (_agentIdentityExactCachePublicationTails.get(cacheKey) === tail) {
      _agentIdentityExactCachePublicationTails.delete(cacheKey);
    }
  }
}

async function runBoundedAgentIdentityExactCachePublication<T>(
  cacheKey: string,
  task: (signal?: AbortSignal) => Promise<T>,
): Promise<AgentIdentityExactCacheLockResult<T>> {
  if (typeof AbortController === 'undefined') return { acquired: false };
  const operationController = new AbortController();
  const operationTimedOut = Symbol('agent_identity_cache_publication_timeout');
  let operationTimer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<typeof operationTimedOut>(resolve => {
    operationTimer = setTimeout(() => {
      operationController.abort();
      resolve(operationTimedOut);
    }, AGENT_IDENTITY_CACHE_LOCK_TIMEOUT_MS);
  });
  try {
    const operation = runAgentIdentityExactCachePublicationInRealm(
      cacheKey,
      () => task(operationController.signal),
    ).then(
      value => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
    const result = await Promise.race([operation, timeout]);
    if (result === operationTimedOut || !result.ok || operationController.signal.aborted) {
      return { acquired: false };
    }
    return { acquired: true, value: result.value };
  } finally {
    if (operationTimer) clearTimeout(operationTimer);
  }
}

/**
 * Serialize one exact cache publication across same-origin tabs/windows in
 * the same storage partition. Web storage is shared across those realms, so
 * an in-module promise tail is insufficient. Web Locks has the same
 * origin/storage-partition boundary as localStorage. Secure web contexts
 * without Web Locks fail local publication closed; native keeps the
 * in-process queue because it has no browser tabs.
 *
 * Both lock acquisition and the server reread performed by `task` are
 * bounded. The same abort signal is passed into PostgREST, so a timed-out task
 * cannot later resume and write after the exclusive lock has been released.
 */
async function withAgentIdentityExactCachePublicationLock<T>(
  cacheKey: string,
  task: (signal?: AbortSignal) => Promise<T>,
): Promise<AgentIdentityExactCacheLockResult<T>> {
  if (!isAgentIdentityExactWebCacheRealm()) {
    return runBoundedAgentIdentityExactCachePublication(cacheKey, task);
  }
  const locks = getAgentIdentityWebLockManager();
  if (!locks || typeof AbortController === 'undefined') return { acquired: false };

  const acquisitionController = new AbortController();
  const acquisitionTimer = setTimeout(
    () => acquisitionController.abort(),
    AGENT_IDENTITY_CACHE_LOCK_TIMEOUT_MS,
  );
  try {
    return await locks.request(
      `uc-agent-identity-cache:${cacheKey}`,
      { mode: 'exclusive', signal: acquisitionController.signal },
      async () => {
        clearTimeout(acquisitionTimer);
        return runBoundedAgentIdentityExactCachePublication(cacheKey, task);
      },
    );
  } catch {
    return { acquired: false };
  } finally {
    clearTimeout(acquisitionTimer);
  }
}

/**
 * Exact cache key used by authenticated callers. Returns null on an invalid
 * boundary and intentionally never aliases the ownerless legacy key.
 */
export function agentIdentityExactStorageKey(
  authority: AgentIdentityExactAuthority | null | undefined,
): string | null {
  const normalized = normalizeAgentIdentityExactAuthority(authority);
  if (!normalized) return null;
  const ownerPart = encodeURIComponent(normalized.userId);
  const circlePart = normalized.circleId
    ? `circle:${encodeURIComponent(normalized.circleId)}`
    : 'account';
  return `${STORAGE_KEY_AGENT_IDENTITY_EXACT_PREFIX}:user:${ownerPart}:${circlePart}`;
}

export type TerminalLaunchMode = 'safe' | 'auto' | 'full-auto';

export interface TerminalAgentOfficeConfig {
  defaultCwd?: string;
  defaultModel?: string;
  defaultPrompt?: string;
  launchMode?: TerminalLaunchMode;
  autoSaveMemory?: boolean;
}

export interface AgentIdentity {
  sessionKey: string; // The stable identifier (e.g., "rapid-slug")

  // Persistent identity
  customName?: string;
  customColor?: string;
  appearance?: AgentAppearance;
  spiritId?: string | null;
  spiritEmoji?: string | null;
  soulPrompt?: string | null;
  customProfileId?: string | null;
  customProfileName?: string | null;

  // Historical data
  totalCostAllTime: number;
  totalTokensAllTime: number;
  totalSessionsAllTime: number;
  firstSeen: number; // timestamp
  lastSeen: number; // timestamp

  // Activity tracking
  totalMessages: number;
  totalTurns: number;

  // Floor assignment
  assignedFloorId?: string;
  deskIndex?: number;

  // Metadata
  mostUsedModel?: string;
  tags?: string[]; // Quick access to common tags

  // Bonding (local cache of server-side bond state)
  bondId?: string;             // UUID from agent_bonds table
  bondLevel?: number;          // 1-10
  bondXP?: number;             // XP toward next level
  isPrimary?: boolean;         // Is this the user's primary agent?
  isCustomized?: boolean;      // Has the user customized this agent?
  boundAiProvider?: string;    // 'claude' | 'gemini' | 'blackswan'
  boundModel?: string;         // Specific model this agent uses
  terminalConfig?: TerminalAgentOfficeConfig;
  soulTraits?: Record<string, number>; // Trait strengths (local cache)
}

type AgentIdentityLike = AgentIdentityKeyInput & Partial<OfficeAgent>;

export function getAgentIdentityByAgent(
  identities: Map<string, AgentIdentity>,
  agent: AgentIdentityLike | null | undefined,
): AgentIdentity | null {
  const key = getAgentIdentityKey(agent);
  if (!key) return null;
  return identities.get(key) || null;
}

export function applyIdentityToAgent(agent: OfficeAgent, identity?: AgentIdentity | null): OfficeAgent {
  if (!identity) return agent;

  const next: OfficeAgent = {
    ...agent,
    name: identity.customName || agent.name,
    color: identity.customColor || agent.color,
    // Identity history is lifetime data. Never hydrate it into the daily
    // field: doing so made a logout/login replace today's server total with an
    // arbitrary cached all-time maximum.
    costTotal: Math.max(agent.costTotal, identity.totalCostAllTime),
    tokensUsed: Math.max(agent.tokensUsed, identity.totalTokensAllTime),
    messagesProcessed: Math.max(agent.messagesProcessed, identity.totalMessages),
    spirit: identity.spiritId || agent.spirit,
  };

  const preferredModel = identity.terminalConfig?.defaultModel || identity.boundModel;
  if (preferredModel && (!agent.model || agent.model === 'unknown' || identity.terminalConfig?.defaultModel)) {
    next.model = preferredModel;
  }

  return next;
}

function sanitizeTerminalConfig(value: unknown): TerminalAgentOfficeConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const launchMode = raw.launchMode === 'auto' || raw.launchMode === 'full-auto' || raw.launchMode === 'safe'
    ? raw.launchMode
    : undefined;
  const config: TerminalAgentOfficeConfig = {
    defaultCwd: typeof raw.defaultCwd === 'string' ? raw.defaultCwd.slice(0, 500) : undefined,
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel.slice(0, 120) : undefined,
    defaultPrompt: typeof raw.defaultPrompt === 'string' ? raw.defaultPrompt.slice(0, 4000) : undefined,
    launchMode,
    autoSaveMemory: typeof raw.autoSaveMemory === 'boolean' ? raw.autoSaveMemory : undefined,
  };
  return Object.values(config).some(v => v !== undefined && v !== '') ? config : undefined;
}

function encodeTerminalConfigTag(config: TerminalAgentOfficeConfig | undefined): string | null {
  const clean = sanitizeTerminalConfig(config);
  if (!clean) return null;
  try {
    const json = JSON.stringify(clean);
    if (typeof btoa === 'function') return `${TERMINAL_CONFIG_TAG_PREFIX}${btoa(unescape(encodeURIComponent(json)))}`;
    return `${TERMINAL_CONFIG_TAG_PREFIX}${Buffer.from(json, 'utf8').toString('base64')}`;
  } catch {
    return null;
  }
}

function decodeTerminalConfigTag(tags: unknown): TerminalAgentOfficeConfig | undefined {
  if (!Array.isArray(tags)) return undefined;
  const encoded = tags.find(tag => typeof tag === 'string' && tag.startsWith(TERMINAL_CONFIG_TAG_PREFIX));
  if (!encoded || typeof encoded !== 'string') return undefined;
  try {
    const payload = encoded.slice(TERMINAL_CONFIG_TAG_PREFIX.length);
    const json = typeof atob === 'function'
      ? decodeURIComponent(escape(atob(payload)))
      : Buffer.from(payload, 'base64').toString('utf8');
    return sanitizeTerminalConfig(JSON.parse(json));
  } catch {
    return undefined;
  }
}

function publicIdentityTags(tags: unknown): string[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  return tags
    .filter((tag): tag is string => typeof tag === 'string')
    .filter(tag => !tag.startsWith(TERMINAL_CONFIG_TAG_PREFIX));
}

function identityTagsForRow(identity: AgentIdentity): string[] {
  const tags = Array.isArray(identity.tags) ? identity.tags.filter(tag => !tag.startsWith(TERMINAL_CONFIG_TAG_PREFIX)) : [];
  const configTag = encodeTerminalConfigTag(identity.terminalConfig);
  return configTag ? [...tags, configTag] : tags;
}

// ─── Load/Save Identity Store ──────────────────────────────

export async function loadAgentIdentities(): Promise<Map<string, AgentIdentity>> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_AGENT_IDENTITY);
    if (!raw) return new Map();
    
    const data = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch (error) {
    console.error('Failed to load agent identities:', error);
    return new Map();
  }
}

function isAgentIdentityNonNegativeFiniteNumber(value: unknown): boolean {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= Number.MAX_SAFE_INTEGER;
}

function isAgentIdentityNonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isAgentIdentityServerNonNegativeNumber(value: unknown): boolean {
  if (typeof value === 'number') return isAgentIdentityNonNegativeFiniteNumber(value);
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)
  ) return false;
  return isAgentIdentityNonNegativeFiniteNumber(Number(value));
}

function isAgentIdentityServerNonNegativeSafeInteger(value: unknown): boolean {
  if (typeof value === 'number') return isAgentIdentityNonNegativeSafeInteger(value);
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || !/^(?:0|[1-9]\d*)$/u.test(value)
  ) return false;
  return isAgentIdentityNonNegativeSafeInteger(Number(value));
}

function parseExactAgentIdentityCache(raw: string | null): Map<string, AgentIdentity> | null {
  // A missing cache is the normal first-device/new-scope state. Present but
  // empty or malformed bytes are corruption and must not become verified
  // emptiness for an exact writer.
  if (raw === null) return new Map();
  if (!raw) return null;
  if (raw.length > MAX_AGENT_IDENTITY_CACHE_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.length > MAX_AGENT_IDENTITIES_PER_SCOPE) return null;
    const identities = new Map<string, AgentIdentity>();
    for (const [key, value] of entries) {
      const normalizedKey = normalizeAgentIdentityScopePart(key);
      if (
        !normalizedKey
        || normalizedKey !== key
        || !value
        || typeof value !== 'object'
        || Array.isArray(value)
      ) return null;
      const identity = value as Partial<AgentIdentity>;
      if (identity.sessionKey !== key) return null;
      if (
        !isAgentIdentityNonNegativeFiniteNumber(identity.totalCostAllTime)
        || !isAgentIdentityNonNegativeSafeInteger(identity.totalTokensAllTime)
        || !isAgentIdentityNonNegativeSafeInteger(identity.totalSessionsAllTime)
        || !isAgentIdentityNonNegativeSafeInteger(identity.firstSeen)
        || !isAgentIdentityNonNegativeSafeInteger(identity.lastSeen)
        || !isAgentIdentityNonNegativeSafeInteger(identity.totalMessages)
        || !isAgentIdentityNonNegativeSafeInteger(identity.totalTurns)
      ) {
        return null;
      }
      identities.set(key, identity as AgentIdentity);
    }
    return identities;
  } catch {
    return null;
  }
}

async function verifyAgentIdentityExactAuthority(
  input: AgentIdentityExactAuthority | null | undefined,
  fence?: AgentIdentityExactAuthorityFence,
): Promise<NormalizedAgentIdentityExactAuthority | null> {
  const authority = normalizeAgentIdentityExactAuthority(input);
  if (!authority) return null;
  const writeAuthority = authority.circleId && authority.generation !== undefined
    ? normalizeAgentIdentityExactWriteAuthority({
      userId: authority.userId,
      accessToken: authority.accessToken,
      circleId: authority.circleId,
      generation: authority.generation,
    })
    : null;
  if (fence && (!writeAuthority || !isAgentIdentityExactAuthorityCurrent(writeAuthority, fence))) return null;
  try {
    const { data, error } = await supabase.auth.getUser(authority.accessToken);
    if (error || !data.user || data.user.id !== authority.userId) return null;
    if (fence && (!writeAuthority || !isAgentIdentityExactAuthorityCurrent(writeAuthority, fence))) return null;
    return authority;
  } catch {
    return null;
  }
}

/**
 * Read only the cache owned by the exact verified user/circle authority.
 * This never reads or migrates `@agent_identity_store`.
 */
export async function loadAgentIdentitiesExact(
  capturedAuthority: AgentIdentityExactAuthority,
  fence?: AgentIdentityExactAuthorityFence,
): Promise<Map<string, AgentIdentity>> {
  const authority = await verifyAgentIdentityExactAuthority(capturedAuthority, fence);
  if (!authority) return new Map();
  const writeAuthority = fence
    ? normalizeAgentIdentityExactWriteAuthority(capturedAuthority as AgentIdentityExactWriteAuthority)
    : null;
  if (fence && (!writeAuthority || !isAgentIdentityExactAuthorityCurrent(writeAuthority, fence))) return new Map();
  const key = agentIdentityExactStorageKey(authority);
  if (!key) return new Map();
  try {
    const raw = await storage.getItem(key);
    if (fence && (!writeAuthority || !isAgentIdentityExactAuthorityCurrent(writeAuthority, fence))) return new Map();
    return parseExactAgentIdentityCache(raw) || new Map();
  } catch {
    return new Map();
  }
}

/**
 * Fetch the durable owner-global identities using only the caller-captured
 * bearer. A response containing another owner or malformed identity fails as
 * a whole rather than being partially accepted.
 */
async function fetchAgentIdentitiesServerSnapshotExact(
  authority: NormalizedAgentIdentityExactAuthority,
  signal?: AbortSignal,
): Promise<AgentIdentityExactSyncResult> {
  if (signal?.aborted) {
    return { ok: false, identities: new Map(), error: 'server_unavailable' };
  }
  try {
    let query = supabase
      .from('agent_identities')
      .select('*', { count: 'exact' })
      .eq('user_id', authority.userId)
      .limit(MAX_AGENT_IDENTITIES_PER_SCOPE + 1)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (signal) query = query.abortSignal(signal);
    const { data, error, count } = await query;
    if (signal?.aborted || error || !Array.isArray(data)) {
      return { ok: false, identities: new Map(), error: 'server_unavailable' };
    }
    // PostgREST deployments may enforce a response-row cap below our client
    // bound. Exact count equality prevents a truncated page from replacing a
    // complete device cache while still keeping this one bounded statement.
    if (
      typeof count !== 'number'
      || !Number.isSafeInteger(count)
      || count < 0
      || count > MAX_AGENT_IDENTITIES_PER_SCOPE
      || data.length !== count
    ) {
      return { ok: false, identities: new Map(), error: 'invalid_response' };
    }
    const identities = new Map<string, AgentIdentity>();
    for (const row of data as Array<Record<string, unknown>>) {
      if (signal?.aborted) {
        return { ok: false, identities: new Map(), error: 'server_unavailable' };
      }
      const sessionKey = normalizeAgentIdentityScopePart(row?.session_key);
      const updatedAt = typeof row?.updated_at === 'string' ? row.updated_at : '';
      const firstSeen = new Date(String(row?.first_seen || '')).getTime();
      const lastSeen = new Date(String(row?.last_seen || '')).getTime();
      if (
        row?.user_id !== authority.userId
        || !sessionKey
        || !Number.isFinite(new Date(updatedAt).getTime())
        || !Number.isFinite(firstSeen)
        || !Number.isFinite(lastSeen)
        || !isAgentIdentityServerNonNegativeNumber(row?.total_cost_all_time)
        || !isAgentIdentityServerNonNegativeSafeInteger(row?.total_tokens_all_time)
        || !isAgentIdentityServerNonNegativeSafeInteger(row?.total_sessions_all_time)
        || !isAgentIdentityServerNonNegativeSafeInteger(row?.total_messages)
        || !isAgentIdentityServerNonNegativeSafeInteger(row?.total_turns)
        || identities.has(sessionKey)
      ) {
        return { ok: false, identities: new Map(), error: 'invalid_response' };
      }
      const identity = rowToIdentity(row);
      if (identity.sessionKey !== sessionKey) {
        return { ok: false, identities: new Map(), error: 'invalid_response' };
      }
      identities.set(sessionKey, identity);
    }
    const validated = parseExactAgentIdentityCache(JSON.stringify(Object.fromEntries(identities.entries())));
    return validated && validated.size === identities.size
      ? { ok: true, identities: validated }
      : { ok: false, identities: new Map(), error: 'invalid_response' };
  } catch {
    return { ok: false, identities: new Map(), error: 'server_unavailable' };
  }
}

export async function syncAgentIdentitiesFromServerExact(
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSyncResult> {
  const syntacticAuthority = normalizeAgentIdentityExactAuthority(capturedAuthority);
  if (!syntacticAuthority) {
    return { ok: false, identities: new Map(), error: 'invalid_authority' };
  }
  const authority = await verifyAgentIdentityExactAuthority(syntacticAuthority);
  if (!authority) {
    return { ok: false, identities: new Map(), error: 'authority_mismatch' };
  }
  return fetchAgentIdentitiesServerSnapshotExact(authority);
}

/**
 * Seed-up: if the user has identities in localStorage but the server
 * has no rows yet (e.g. the agent_identities table was just created
 * via migration), push the local copies up so nothing's lost. Bounded
 * to one upsert per call. Returns the number of rows seeded so the
 * caller can show feedback.
 *
 * Idempotent: if the server already has any identity rows for this
 * user, returns 0 without writing.
 */
export async function seedIdentitiesIfServerEmpty(): Promise<number> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;
    // Probe the server count. head:true + count makes this a 1-row HEAD.
    const { count, error: countErr } = await supabase
      .from('agent_identities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if (countErr) return 0;  // table likely missing — kill switch will fire on first save anyway
    if ((count || 0) > 0) return 0;  // server already has data, nothing to seed
    const local = await loadAgentIdentities();
    if (local.size === 0) return 0;
    const rows = Array.from(local.values()).map(id => identityToCompatibilityRow(user.id, id));
    const { error } = await supabase
      .from('agent_identities')
      .upsert(rows, { onConflict: 'user_id,session_key' });
    if (error) return 0;
    console.log(`[agentIdentity] seeded ${rows.length} identities to server`);
    return rows.length;
  } catch {
    return 0;
  }
}

export async function saveAgentIdentities(identities: Map<string, AgentIdentity>): Promise<void> {
  // 1. Local cache — always wins for read latency.
  try {
    const obj = Object.fromEntries(identities.entries());
    await storage.setItem(STORAGE_KEY_AGENT_IDENTITY, JSON.stringify(obj));
  } catch (error) {
    console.error('Failed to save agent identities to localStorage:', error);
  }

  // 2. Durable Supabase upsert — fire-and-forget. Skips silently when
  // the migration hasn't been applied yet (PGRST205) so the UI keeps
  // working until the user runs the SQL.
  void persistIdentitiesToServer(identities);
}

/**
 * Refresh local identities from the agent_identities table. Returns the
 * merged map (server entries win when both exist with different
 * last_seen). Caller should call saveAgentIdentities-without-server-push
 * to write the merge back to localStorage. Used on app boot / sign-in
 * to backfill a fresh device or post-cache-clear browser.
 */
export async function syncAgentIdentitiesFromServer(): Promise<Map<string, AgentIdentity>> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Map();
    const { data, error } = await supabase
      .from('agent_identities')
      .select('*')
      .eq('user_id', user.id);
    if (error || !data) return new Map();
    const merged = new Map<string, AgentIdentity>();
    for (const row of data as any[]) {
      merged.set(row.session_key, rowToIdentity(row));
    }
    return merged;
  } catch {
    return new Map();
  }
}

function rowToIdentity(row: any): AgentIdentity {
  const terminalConfig = sanitizeTerminalConfig(row.terminal_config) || decodeTerminalConfigTag(row.tags);
  return {
    sessionKey: row.session_key,
    customName: row.custom_name || undefined,
    customColor: row.custom_color || undefined,
    appearance: row.appearance && Object.keys(row.appearance).length > 0 ? row.appearance : undefined,
    spiritId: row.spirit_id ?? null,
    spiritEmoji: row.spirit_emoji ?? null,
    soulPrompt: row.soul_prompt ?? null,
    customProfileId: row.custom_profile_id ?? null,
    customProfileName: row.custom_profile_name ?? null,
    totalCostAllTime: Number(row.total_cost_all_time || 0),
    totalTokensAllTime: Number(row.total_tokens_all_time || 0),
    totalSessionsAllTime: Number(row.total_sessions_all_time || 0),
    firstSeen: row.first_seen ? new Date(row.first_seen).getTime() : Date.now(),
    lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : Date.now(),
    totalMessages: Number(row.total_messages || 0),
    totalTurns: Number(row.total_turns || 0),
    assignedFloorId: row.assigned_floor_id || undefined,
    deskIndex: typeof row.desk_index === 'number' ? row.desk_index : undefined,
    mostUsedModel: row.most_used_model || undefined,
    tags: publicIdentityTags(row.tags),
    bondId: row.bond_id || undefined,
    bondLevel: typeof row.bond_level === 'number' ? row.bond_level : undefined,
    bondXP: typeof row.bond_xp === 'number' ? row.bond_xp : undefined,
    isPrimary: !!row.is_primary,
    isCustomized: !!row.is_customized,
    boundAiProvider: row.bound_ai_provider || undefined,
    boundModel: row.bound_model || undefined,
    terminalConfig,
  };
}

function identityToRow(userId: string, identity: AgentIdentity) {
  return {
    user_id: userId,
    session_key: identity.sessionKey,
    custom_name: identity.customName ?? null,
    custom_color: identity.customColor ?? null,
    spirit_id: identity.spiritId ?? null,
    spirit_emoji: identity.spiritEmoji ?? null,
    soul_prompt: identity.soulPrompt ?? null,
    custom_profile_id: identity.customProfileId ?? null,
    custom_profile_name: identity.customProfileName ?? null,
    appearance: identity.appearance || {},
    assigned_floor_id: identity.assignedFloorId ?? null,
    desk_index: typeof identity.deskIndex === 'number' ? identity.deskIndex : null,
    bond_id: identity.bondId ?? null,
    bond_level: typeof identity.bondLevel === 'number' ? identity.bondLevel : null,
    bond_xp: typeof identity.bondXP === 'number' ? identity.bondXP : null,
    is_customized: !!identity.isCustomized,
    bound_ai_provider: identity.boundAiProvider ?? null,
    bound_model: identity.boundModel ?? null,
    terminal_config: sanitizeTerminalConfig(identity.terminalConfig) || {},
    most_used_model: identity.mostUsedModel ?? null,
    tags: identityTagsForRow(identity),
    total_messages: identity.totalMessages || 0,
    total_turns: identity.totalTurns || 0,
    total_cost_all_time: identity.totalCostAllTime || 0,
    total_tokens_all_time: identity.totalTokensAllTime || 0,
    total_sessions_all_time: identity.totalSessionsAllTime || 0,
    first_seen: new Date(identity.firstSeen).toISOString(),
    last_seen: new Date(identity.lastSeen).toISOString(),
  };
}

function identityToCompatibilityRow(userId: string, identity: AgentIdentity) {
  // Ambient/full-row compatibility saves cannot author provider or primary
  // authority. Provider metadata belongs to exact targeted mutations; primary
  // status belongs exclusively to the transactional §47 RPC.
  const { bound_ai_provider: _boundAiProvider, ...row } = identityToRow(userId, identity);
  return row;
}

// Session-level kill switch. The first time the upsert fails because
// the table or one of its columns is missing from the schema cache
// (PGRST204 / PGRST205 / generic 404), we flip this and stop firing
// further requests for the rest of the page session. localStorage
// keeps working, so no data loss — just no spam in the network panel.
//
// Reset by reloading the page (after the migration is applied).
let _identitiesPersistDisabled = false;
let _identitiesPersistWarningShown = false;

function shouldDisableIdentityPersistence(error: any): boolean {
  const code = String(error?.code || '');
  const status = Number(error?.status || 0);
  const message = String(error?.message || error?.details || '').toLowerCase();
  return (
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    code === '42P10' ||
    code === '42703' ||
    status === 400 ||
    status === 404 ||
    message.includes('schema cache') ||
    message.includes('agent_identities') ||
    message.includes('terminal_config') ||
    message.includes('no unique') ||
    message.includes('on conflict') ||
    message.includes('does not exist') ||
    message.includes('could not find')
  );
}

function disableIdentityPersistenceForSession(error?: any) {
  _identitiesPersistDisabled = true;
  if (_identitiesPersistWarningShown) return;
  _identitiesPersistWarningShown = true;
  const detail = error?.message ? ` Last error: ${error.message}` : '';
  console.warn(
    '[agentIdentity] agent_identities persistence disabled for this page session; localStorage remains active. ' +
    'Apply the agent identity repair migration and reload to re-enable durable persistence.' +
    detail,
  );
}

async function persistIdentitiesToServer(identities: Map<string, AgentIdentity>): Promise<void> {
  if (_identitiesPersistDisabled) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const rows = Array.from(identities.values()).map(id => identityToCompatibilityRow(user.id, id));
    if (rows.length === 0) return;
    // Batch upsert — single round-trip per save.
    let { error } = await supabase
      .from('agent_identities')
      .upsert(rows, { onConflict: 'user_id,session_key' });
    if (error) {
      // PGRST205 = table not in schema cache (migration not applied).
      // PGRST204 = column not in schema cache (older migration version).
      // 404      = generic schema/table miss from the REST gateway.
      const code = (error as any).code;
      if (code === 'PGRST204' && String(error.message || '').includes('terminal_config')) {
        const fallbackRows = rows.map(({ terminal_config, ...row }) => row);
        const retry = await supabase
          .from('agent_identities')
          .upsert(fallbackRows, { onConflict: 'user_id,session_key' });
        error = retry.error;
        if (!error) return;
      }
      if (shouldDisableIdentityPersistence(error)) {
        disableIdentityPersistenceForSession(error);
        return;
      }
      console.warn('[agentIdentity] DB save failed:', error.message);
    }
  } catch (err) {
    console.warn('[agentIdentity] persist threw:', err);
  }
}

declare const VERIFIED_AGENT_IDENTITY_EXACT_WRITE_AUTHORITY: unique symbol;

type VerifiedAgentIdentityExactWriteAuthority = AgentIdentityExactWriteAuthority & Readonly<{
  [VERIFIED_AGENT_IDENTITY_EXACT_WRITE_AUTHORITY]: true;
}>;

type AgentIdentityExactMutationLoadResult =
  | {
    ok: true;
    authority: VerifiedAgentIdentityExactWriteAuthority;
    identities: Map<string, AgentIdentity>;
    serverIdentities: Map<string, AgentIdentity>;
    /** Raw server version used for optimistic concurrency; absence means INSERT. */
    serverVersions: Map<string, string>;
  }
  | {
    ok: false;
    error: 'authority_mismatch' | 'authority_retired' | 'invalid_local_data' | 'invalid_receipt' | 'server_unavailable';
  };

/**
 * Load the mutation base from the exact device lane plus the durable owner
 * row(s). Unlike the compatibility read API, malformed local data and remote
 * failures are explicit and can never be reinterpreted as a new identity.
 */
async function loadAgentIdentityMutationBaseExact(
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
  sessionKey: string | null,
): Promise<AgentIdentityExactMutationLoadResult> {
  const syntacticAuthority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (!syntacticAuthority || !isAgentIdentityExactAuthorityCurrent(syntacticAuthority, fence)) {
    return { ok: false, error: 'authority_retired' };
  }
  const verified = await verifyAgentIdentityExactAuthority(syntacticAuthority, fence);
  const authority = normalizeAgentIdentityExactWriteAuthority(verified as AgentIdentityExactWriteAuthority);
  if (!authority) {
    return isAgentIdentityExactAuthorityCurrent(syntacticAuthority, fence)
      ? { ok: false, error: 'authority_mismatch' }
      : { ok: false, error: 'authority_retired' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, error: 'authority_retired' };
  }
  const key = agentIdentityExactStorageKey(authority);
  if (!key) return { ok: false, error: 'invalid_local_data' };

  let identities: Map<string, AgentIdentity>;
  try {
    const raw = await storage.getItem(key);
    if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
      return { ok: false, error: 'authority_retired' };
    }
    const parsed = parseExactAgentIdentityCache(raw);
    if (!parsed) return { ok: false, error: 'invalid_local_data' };
    identities = parsed;
  } catch {
    return { ok: false, error: 'invalid_local_data' };
  }

  if (_identitiesPersistDisabled) return { ok: false, error: 'server_unavailable' };
  try {
    const serverVersions = new Map<string, string>();
    const serverIdentities = new Map<string, AgentIdentity>();
    let query = supabase
      .from('agent_identities')
      .select('*')
      .eq('user_id', authority.userId);
    query = sessionKey
      ? query.eq('session_key', sessionKey).limit(2)
      : query.limit(MAX_AGENT_IDENTITIES_PER_SCOPE + 1);
    const { data, error } = await query
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
      return { ok: false, error: 'authority_retired' };
    }
    if (error) {
      if (shouldDisableIdentityPersistence(error)) disableIdentityPersistenceForSession(error);
      return { ok: false, error: 'server_unavailable' };
    }
    if (
      !Array.isArray(data)
      || data.length > MAX_AGENT_IDENTITIES_PER_SCOPE
      || (sessionKey !== null && data.length > 1)
    ) return { ok: false, error: 'invalid_receipt' };

    const seen = new Set<string>();
    for (const candidate of data) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        return { ok: false, error: 'invalid_receipt' };
      }
      const row = candidate as Record<string, unknown>;
      const rowSessionKey = normalizeAgentIdentityScopePart(row.session_key);
      const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
      const firstSeen = new Date(String(row.first_seen || '')).getTime();
      const lastSeen = new Date(String(row.last_seen || '')).getTime();
      const requiredCounters = [
        row.total_cost_all_time,
        row.total_tokens_all_time,
        row.total_sessions_all_time,
        row.total_messages,
        row.total_turns,
      ];
      if (
        row.user_id !== authority.userId
        || !rowSessionKey
        || !Number.isFinite(new Date(updatedAt).getTime())
        || !Number.isFinite(firstSeen)
        || !Number.isFinite(lastSeen)
        || requiredCounters.some(value => !Number.isFinite(Number(value)) || Number(value) < 0)
        || (sessionKey !== null && rowSessionKey !== sessionKey)
        || seen.has(rowSessionKey)
      ) return { ok: false, error: 'invalid_receipt' };
      const serverIdentity = rowToIdentity(row);
      const validated = parseExactAgentIdentityCache(JSON.stringify({ [rowSessionKey]: serverIdentity }));
      if (!validated || validated.size !== 1) return { ok: false, error: 'invalid_receipt' };
      const current = identities.get(rowSessionKey);
      if (!current || serverIdentity.lastSeen >= current.lastSeen) {
        identities.set(rowSessionKey, serverIdentity);
      }
      serverIdentities.set(rowSessionKey, serverIdentity);
      serverVersions.set(rowSessionKey, updatedAt);
      seen.add(rowSessionKey);
    }
    return {
      ok: true,
      authority: authority as VerifiedAgentIdentityExactWriteAuthority,
      identities,
      serverIdentities,
      serverVersions,
    };
  } catch {
    return isAgentIdentityExactAuthorityCurrent(authority, fence)
      ? { ok: false, error: 'server_unavailable' }
      : { ok: false, error: 'authority_retired' };
  }
}

type AgentIdentityRow = ReturnType<typeof identityToRow>;

type AgentIdentityExactPersistResult =
  | { ok: true }
  | { ok: false; error: 'authority_retired' | 'invalid_receipt' | 'server_unavailable' };

const AGENT_IDENTITY_ROW_COLUMN_BY_FIELD: Readonly<Record<string, keyof AgentIdentityRow>> = {
  customName: 'custom_name',
  customColor: 'custom_color',
  appearance: 'appearance',
  spiritId: 'spirit_id',
  spiritEmoji: 'spirit_emoji',
  soulPrompt: 'soul_prompt',
  customProfileId: 'custom_profile_id',
  customProfileName: 'custom_profile_name',
  totalCostAllTime: 'total_cost_all_time',
  totalTokensAllTime: 'total_tokens_all_time',
  totalSessionsAllTime: 'total_sessions_all_time',
  firstSeen: 'first_seen',
  lastSeen: 'last_seen',
  totalMessages: 'total_messages',
  totalTurns: 'total_turns',
  assignedFloorId: 'assigned_floor_id',
  deskIndex: 'desk_index',
  mostUsedModel: 'most_used_model',
  tags: 'tags',
  bondId: 'bond_id',
  bondLevel: 'bond_level',
  bondXP: 'bond_xp',
  isCustomized: 'is_customized',
  boundAiProvider: 'bound_ai_provider',
  boundModel: 'bound_model',
  terminalConfig: 'terminal_config',
  soulTraits: 'tags',
};

function stableIdentityReceiptValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableIdentityReceiptValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableIdentityReceiptValue(entry)]),
    );
  }
  return value;
}

function identityReceiptColumnMatches(
  column: keyof AgentIdentityRow,
  actual: unknown,
  expected: unknown,
): boolean {
  if (column === 'first_seen' || column === 'last_seen') {
    const actualTime = new Date(String(actual || '')).getTime();
    const expectedTime = new Date(String(expected || '')).getTime();
    return Number.isFinite(actualTime) && actualTime === expectedTime;
  }
  if (typeof expected === 'number') return Number(actual) === expected;
  if (typeof expected === 'boolean') return actual === expected;
  if (expected === null) return actual === null;
  if (typeof expected === 'object') {
    return JSON.stringify(stableIdentityReceiptValue(actual))
      === JSON.stringify(stableIdentityReceiptValue(expected));
  }
  return actual === expected;
}

function expectedIdentityReceiptColumns(
  updates: Partial<AgentIdentity> | null,
): ReadonlySet<keyof AgentIdentityRow> {
  if (!updates) return new Set<keyof AgentIdentityRow>();
  const columns = new Set<keyof AgentIdentityRow>();
  for (const field of Object.keys(updates)) {
    const column = AGENT_IDENTITY_ROW_COLUMN_BY_FIELD[field];
    if (column) columns.add(column);
  }
  return columns;
}

function validateIdentityServerReceipts(
  data: unknown,
  expectedRows: AgentIdentityRow[],
  expectedColumnsBySessionKey?: ReadonlyMap<string, ReadonlySet<keyof AgentIdentityRow>>,
): boolean {
  if (!Array.isArray(data) || data.length !== expectedRows.length) return false;
  const expectedBySessionKey = new Map(expectedRows.map(row => [row.session_key, row]));
  const seen = new Set<string>();
  for (const candidate of data) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    const receipt = candidate as Record<string, unknown>;
    const sessionKey = normalizeAgentIdentityScopePart(receipt.session_key);
    if (!sessionKey || seen.has(sessionKey)) return false;
    const expected = expectedBySessionKey.get(sessionKey);
    if (!expected || receipt.user_id !== expected.user_id) return false;
    const requestedColumns = expectedColumnsBySessionKey?.get(sessionKey);
    const columns = requestedColumns && requestedColumns.size > 0
      ? requestedColumns
      : new Set(Object.keys(expected) as Array<keyof AgentIdentityRow>);
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(receipt, column)) return false;
      if (!identityReceiptColumnMatches(column, receipt[column], expected[column])) return false;
    }
    seen.add(sessionKey);
  }
  return seen.size === expectedRows.length;
}

type AgentIdentityPrimaryRpcReceipt = {
  providerIdentities: Map<string, AgentIdentity>;
};

/**
 * Validate the complete versioned receipt returned by the transactional
 * primary-agent RPC. Provider rows are a bounded, owner-exact snapshot and
 * the requested session must be the sole primary in that snapshot.
 */
function parseAgentIdentityPrimaryRpcReceipt(
  data: unknown,
  authority: AgentIdentityExactWriteAuthority,
  sessionKey: string,
  providerType: string,
): AgentIdentityPrimaryRpcReceipt | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  try {
    if (JSON.stringify(data).length > MAX_AGENT_IDENTITY_CACHE_BYTES) return null;
  } catch {
    return null;
  }
  const receipt = data as Record<string, unknown>;
  const receiptKeys = [
    'schemaVersion',
    'userId',
    'providerType',
    'requestedSessionKey',
    'primarySessionKey',
    'primaryId',
    'primaryUpdatedAt',
    'inserted',
    'clearedCount',
    'targetRowCount',
    'rowCount',
    'rows',
  ] as const;
  if (
    Object.keys(receipt).length !== receiptKeys.length
    || receiptKeys.some(key => !Object.prototype.hasOwnProperty.call(receipt, key))
    || receipt.schemaVersion !== 1
    || receipt.userId !== authority.userId
    || receipt.providerType !== providerType
    || receipt.requestedSessionKey !== sessionKey
    || receipt.primarySessionKey !== sessionKey
    || typeof receipt.primaryId !== 'string'
    || normalizeAgentIdentityScopePart(receipt.primaryId) !== receipt.primaryId
    || !isAgentIdentityUuidLike(receipt.primaryId)
    || typeof receipt.primaryUpdatedAt !== 'string'
    || !Number.isFinite(new Date(receipt.primaryUpdatedAt).getTime())
    || typeof receipt.inserted !== 'boolean'
    || typeof receipt.clearedCount !== 'number'
    || !Number.isSafeInteger(receipt.clearedCount)
    || receipt.clearedCount < 0
    || receipt.clearedCount > 1
    || receipt.targetRowCount !== 1
    || typeof receipt.rowCount !== 'number'
    || !Number.isSafeInteger(receipt.rowCount)
    || receipt.rowCount < 1
    || receipt.rowCount > MAX_AGENT_IDENTITIES_PER_SCOPE
    || !Array.isArray(receipt.rows)
    || receipt.rows.length !== receipt.rowCount
  ) return null;

  const providerIdentities = new Map<string, AgentIdentity>();
  const seenIds = new Set<string>();
  let primaryCount = 0;
  let primaryRow: Record<string, unknown> | null = null;
  for (const candidate of receipt.rows) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const row = candidate as Record<string, unknown>;
    const rowId = normalizeAgentIdentityScopePart(row.id);
    const rowSessionKey = normalizeAgentIdentityScopePart(row.session_key);
    const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : '';
    const firstSeen = new Date(String(row.first_seen || '')).getTime();
    const lastSeen = new Date(String(row.last_seen || '')).getTime();
    const requiredCounters = [
      row.total_cost_all_time,
      row.total_tokens_all_time,
      row.total_sessions_all_time,
      row.total_messages,
      row.total_turns,
    ];
    if (
      !rowId
      || !rowSessionKey
      || row.id !== rowId
      || !isAgentIdentityUuidLike(rowId)
      || row.session_key !== rowSessionKey
      || row.user_id !== authority.userId
      || row.bound_ai_provider !== providerType
      || typeof row.is_primary !== 'boolean'
      || !Number.isFinite(new Date(updatedAt).getTime())
      || !Number.isFinite(firstSeen)
      || !Number.isFinite(lastSeen)
      || requiredCounters.some(value => (
        (typeof value !== 'number' && typeof value !== 'string')
        || value === ''
        || !Number.isFinite(Number(value))
        || Number(value) < 0
      ))
      || seenIds.has(rowId)
      || providerIdentities.has(rowSessionKey)
    ) return null;
    const identity = rowToIdentity(row);
    const validated = parseExactAgentIdentityCache(JSON.stringify({ [rowSessionKey]: identity }));
    if (!validated || validated.size !== 1) return null;
    providerIdentities.set(rowSessionKey, identity);
    seenIds.add(rowId);
    if (row.is_primary) {
      primaryCount += 1;
      primaryRow = row;
    }
  }

  if (
    primaryCount !== 1
    || !primaryRow
    || primaryRow.session_key !== sessionKey
    || primaryRow.id !== receipt.primaryId
    || primaryRow.updated_at !== receipt.primaryUpdatedAt
    || providerIdentities.get(sessionKey)?.isPrimary !== true
  ) return null;
  return { providerIdentities };
}

type AgentPublishedSpiritRpcReceipt = {
  identity: AgentIdentity;
};

function parseCustomProfileDeleteRpcReceipt(
  data: unknown,
  authority: AgentIdentityExactWriteAuthority,
  profileId: string,
): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  try {
    if (JSON.stringify(data).length > 1_048_576) return false;
  } catch {
    return false;
  }
  const receipt = data as Record<string, unknown>;
  const keys = ['schemaVersion', 'userId', 'profileId', 'deletedRowCount', 'profile'] as const;
  if (
    Object.keys(receipt).length !== keys.length
    || keys.some(key => !Object.prototype.hasOwnProperty.call(receipt, key))
    || receipt.schemaVersion !== 1
    || receipt.userId !== authority.userId
    || receipt.profileId !== profileId
    || receipt.deletedRowCount !== 1
    || !receipt.profile
    || typeof receipt.profile !== 'object'
    || Array.isArray(receipt.profile)
  ) return false;
  const profile = receipt.profile as Record<string, unknown>;
  return profile.id === profileId
    && profile.user_id === authority.userId;
}

function parsePublishedAgentSpiritRpcReceipt(
  data: unknown,
  authority: AgentIdentityExactWriteAuthority,
  input: AgentPublishedSpiritAssignmentInput,
): AgentPublishedSpiritRpcReceipt | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  try {
    if (JSON.stringify(data).length > MAX_AGENT_IDENTITY_CACHE_BYTES) return null;
  } catch {
    return null;
  }
  const receipt = data as Record<string, unknown>;
  const receiptKeys = [
    'schemaVersion',
    'userId',
    'circleId',
    'officeAgentId',
    'sessionKey',
    'spiritId',
    'spiritEmoji',
    'customProfileId',
    'customProfileName',
    'officeRowCount',
    'identityRowCount',
    'officeAgent',
    'identity',
  ] as const;
  const customAssignment = input.customProfileId !== null;
  const customProfileName = receipt.customProfileName;
  if (
    Object.keys(receipt).length !== receiptKeys.length
    || receiptKeys.some(key => !Object.prototype.hasOwnProperty.call(receipt, key))
    || receipt.schemaVersion !== 1
    || receipt.userId !== authority.userId
    || receipt.circleId !== authority.circleId
    || receipt.officeAgentId !== input.officeAgentId
    || receipt.sessionKey !== input.sessionKey
    || receipt.spiritId !== input.spiritId
    || receipt.officeRowCount !== 1
    || receipt.identityRowCount !== 1
    || receipt.customProfileId !== input.customProfileId
    || (
      customAssignment
        ? typeof customProfileName !== 'string'
          || normalizeAgentIdentityScopePart(customProfileName) !== customProfileName
          || /[\u0000-\u001f\u007f]/u.test(customProfileName)
        : customProfileName !== null
    )
    || (
      customAssignment
        ? receipt.spiritEmoji !== null
          && (
            typeof receipt.spiritEmoji !== 'string'
            || receipt.spiritEmoji.trim() !== receipt.spiritEmoji
            || receipt.spiritEmoji.length > 64
            || /[\u0000-\u001f\u007f]/u.test(receipt.spiritEmoji)
          )
        : receipt.spiritEmoji !== input.spiritEmoji
    )
    || !receipt.officeAgent
    || typeof receipt.officeAgent !== 'object'
    || Array.isArray(receipt.officeAgent)
    || !receipt.identity
    || typeof receipt.identity !== 'object'
    || Array.isArray(receipt.identity)
  ) return null;

  const officeRow = receipt.officeAgent as Record<string, unknown>;
  const identityRow = receipt.identity as Record<string, unknown>;
  const officeUpdatedAt = typeof officeRow.updated_at === 'string' ? officeRow.updated_at : '';
  const identityUpdatedAt = typeof identityRow.updated_at === 'string' ? identityRow.updated_at : '';
  const firstSeen = new Date(String(identityRow.first_seen || '')).getTime();
  const lastSeen = new Date(String(identityRow.last_seen || '')).getTime();
  const requiredCounters = [
    identityRow.total_cost_all_time,
    identityRow.total_tokens_all_time,
    identityRow.total_sessions_all_time,
    identityRow.total_messages,
    identityRow.total_turns,
  ];
  if (
    officeRow.id !== input.officeAgentId
    || officeRow.circle_id !== authority.circleId
    || officeRow.owner_id !== authority.userId
    || officeRow.is_published !== true
    || officeRow.spirit !== input.spiritId
    || officeRow.spirit_emoji !== receipt.spiritEmoji
    || !Number.isFinite(new Date(officeUpdatedAt).getTime())
    || !isAgentIdentityUuidLike(identityRow.id)
    || identityRow.user_id !== authority.userId
    || identityRow.session_key !== input.sessionKey
    || identityRow.spirit_id !== input.spiritId
    || identityRow.spirit_emoji !== receipt.spiritEmoji
    || identityRow.custom_profile_id !== input.customProfileId
    || identityRow.custom_profile_name !== customProfileName
    || identityRow.is_customized !== true
    || !Number.isFinite(new Date(identityUpdatedAt).getTime())
    || !Number.isFinite(firstSeen)
    || !Number.isFinite(lastSeen)
    || requiredCounters.some(value => (
      (typeof value !== 'number' && typeof value !== 'string')
      || value === ''
      || !Number.isFinite(Number(value))
      || Number(value) < 0
    ))
  ) return null;
  const identity = rowToIdentity(identityRow);
  const validated = parseExactAgentIdentityCache(JSON.stringify({ [input.sessionKey]: identity }));
  return validated?.size === 1 ? { identity } : null;
}

function agentIdentityExactServerWriteMode(
  serverVersions: ReadonlyMap<string, string>,
  sessionKey: string,
): 'update' | 'insert' {
  return serverVersions.has(sessionKey) ? 'update' : 'insert';
}

async function persistIdentitiesToServerExact(
  identities: Map<string, AgentIdentity>,
  authority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
  expectedColumnsBySessionKey?: ReadonlyMap<string, ReadonlySet<keyof AgentIdentityRow>>,
  serverVersions?: ReadonlyMap<string, string>,
): Promise<AgentIdentityExactPersistResult> {
  if (_identitiesPersistDisabled) return { ok: false, error: 'server_unavailable' };
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, error: 'authority_retired' };
  }
  const rows = Array.from(identities.values()).map(identity => identityToRow(authority.userId, identity));
  if (rows.length === 0) return { ok: false, error: 'invalid_receipt' };
  try {
    // Targeted panel mutations update only the requested columns and compare
    // the exact server version observed immediately before the write. This
    // prevents two tabs changing disjoint fields from silently replacing each
    // other's full identity row. A missing version is an exact INSERT lane.
    if (expectedColumnsBySessionKey && serverVersions) {
      for (const row of rows) {
        if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
          return { ok: false, error: 'authority_retired' };
        }
        const expectedColumns = expectedColumnsBySessionKey.get(row.session_key);
        if (!expectedColumns || expectedColumns.size === 0) {
          return { ok: false, error: 'invalid_receipt' };
        }
        const writeMode = agentIdentityExactServerWriteMode(serverVersions, row.session_key);
        const serverVersion = serverVersions.get(row.session_key);
        let response: { data: unknown; error: any };
        if (writeMode === 'update') {
          if (!serverVersion) return { ok: false, error: 'invalid_receipt' };
          const patch: Record<string, unknown> = {};
          for (const column of expectedColumns) {
            if (column === 'user_id' || column === 'session_key') continue;
            patch[column] = row[column];
          }
          if (Object.keys(patch).length === 0) return { ok: false, error: 'invalid_receipt' };
          response = await supabase
            .from('agent_identities')
            .update(patch)
            .eq('user_id', authority.userId)
            .eq('session_key', row.session_key)
            .eq('updated_at', serverVersion)
            .select('*')
            .setHeader('Authorization', `Bearer ${authority.accessToken}`);
        } else {
          response = await supabase
            .from('agent_identities')
            .insert(row)
            .select('*')
            .setHeader('Authorization', `Bearer ${authority.accessToken}`);
        }
        if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
          return { ok: false, error: 'authority_retired' };
        }
        if (response.error) {
          if (shouldDisableIdentityPersistence(response.error)) {
            disableIdentityPersistenceForSession(response.error);
          }
          return { ok: false, error: 'server_unavailable' };
        }
        const receiptColumns = serverVersion ? expectedColumns : undefined;
        if (!validateIdentityServerReceipts(
          response.data,
          [row],
          receiptColumns ? new Map([[row.session_key, receiptColumns]]) : undefined,
        )) return { ok: false, error: 'invalid_receipt' };
      }
      return { ok: true };
    }

    const { data, error } = await supabase
      .from('agent_identities')
      .upsert(rows, { onConflict: 'user_id,session_key' })
      .select('*')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
      return { ok: false, error: 'authority_retired' };
    }
    if (error) {
      if (shouldDisableIdentityPersistence(error)) disableIdentityPersistenceForSession(error);
      return { ok: false, error: 'server_unavailable' };
    }
    return validateIdentityServerReceipts(data, rows, expectedColumnsBySessionKey)
      ? { ok: true }
      : { ok: false, error: 'invalid_receipt' };
  } catch {
    return isAgentIdentityExactAuthorityCurrent(authority, fence)
      ? { ok: false, error: 'server_unavailable' }
      : { ok: false, error: 'authority_retired' };
  }
}

function serializeExactIdentityMap(identities: Map<string, AgentIdentity>): string | null {
  try {
    const serialized = JSON.stringify(Object.fromEntries(identities.entries()));
    if (serialized.length > MAX_AGENT_IDENTITY_CACHE_BYTES) return null;
    const parsed = parseExactAgentIdentityCache(serialized);
    return parsed?.size === identities.size ? serialized : null;
  } catch {
    return null;
  }
}

async function publishVerifiedAgentIdentityCacheExact(
  identities: Map<string, AgentIdentity>,
  authority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const serialized = serializeExactIdentityMap(identities);
  const key = agentIdentityExactStorageKey(authority);
  if (!serialized || !key) {
    return { ok: false, localSaved: false, serverSaved: true, error: 'invalid_local_data' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: true, error: 'authority_retired' };
  }
  try {
    await storage.setItem(key, serialized);
    if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
      return { ok: false, localSaved: false, serverSaved: true, error: 'authority_retired' };
    }
    const readback = await storage.getItem(key);
    if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
      return { ok: false, localSaved: false, serverSaved: true, error: 'authority_retired' };
    }
    return readback === serialized
      ? { ok: true, localSaved: true, serverSaved: true }
      : { ok: false, localSaved: false, serverSaved: true, error: 'local_write_failed' };
  } catch {
    return { ok: false, localSaved: false, serverSaved: true, error: 'local_write_failed' };
  }
}

/**
 * Read and publish one count-complete server snapshot while the exact cache
 * lane is exclusive. This owner never calls a durable mutation API: absence
 * in the locked reread remains absence and cannot be reinterpreted as an
 * identity to insert from an earlier device snapshot.
 */
async function refreshVerifiedAgentIdentitiesFromServerExact(
  authority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactRefreshResult> {
  const key = agentIdentityExactStorageKey(authority);
  if (!key) {
    return {
      ok: false,
      identities: new Map(),
      serverVerified: false,
      localSaved: false,
      error: 'invalid_authority',
    };
  }
  const locked = await withAgentIdentityExactCachePublicationLock(
    key,
    async signal => {
      const publicationFence: AgentIdentityExactAuthorityFence = candidate => (
        !signal?.aborted && isAgentIdentityExactAuthorityCurrent(candidate, fence)
      );
      if (signal?.aborted) {
        return {
          ok: false,
          identities: new Map<string, AgentIdentity>(),
          serverVerified: false,
          localSaved: false,
          error: 'local_write_failed',
        } as const;
      }
      if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
        return {
          ok: false,
          identities: new Map<string, AgentIdentity>(),
          serverVerified: false,
          localSaved: false,
          error: 'authority_retired',
        } as const;
      }
      const snapshot = await fetchAgentIdentitiesServerSnapshotExact(authority, signal);
      if (signal?.aborted) {
        return {
          ok: false,
          identities: new Map<string, AgentIdentity>(),
          serverVerified: false,
          localSaved: false,
          error: 'local_write_failed',
        } as const;
      }
      if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
        return {
          ok: false,
          identities: new Map<string, AgentIdentity>(),
          serverVerified: false,
          localSaved: false,
          error: 'authority_retired',
        } as const;
      }
      if (!snapshot.ok) {
        return {
          ok: false,
          identities: new Map<string, AgentIdentity>(),
          serverVerified: false,
          localSaved: false,
          error: snapshot.error || 'server_unavailable',
        } as const;
      }
      const identities = new Map(snapshot.identities);
      const publication = await publishVerifiedAgentIdentityCacheExact(
        identities,
        authority,
        publicationFence,
      );
      if (publication.ok) {
        return {
          ok: true,
          identities,
          serverVerified: true,
          localSaved: true,
        } as const;
      }
      const publicationError: AgentIdentityExactRefreshError =
        publication.error === 'authority_retired'
        || publication.error === 'invalid_local_data'
        || publication.error === 'local_write_failed'
          ? publication.error
          : 'local_write_failed';
      return {
        ok: false,
        identities,
        serverVerified: true,
        localSaved: false,
        error: publicationError,
      } as const;
    },
  );
  return locked.acquired
    ? locked.value
    : {
      ok: false,
      identities: new Map(),
      serverVerified: false,
      localSaved: false,
      error: 'local_write_failed',
    };
}

/**
 * Refresh the exact cache from durable server truth without inserting or
 * updating any identity row. The returned map is the same verified snapshot
 * considered for cache publication, so the initiating realm can converge
 * without relying on a same-window storage event.
 */
export async function refreshAgentIdentitiesFromServerExact(
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactRefreshResult> {
  const syntacticAuthority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (!syntacticAuthority || typeof fence !== 'function') {
    return {
      ok: false,
      identities: new Map(),
      serverVerified: false,
      localSaved: false,
      error: 'invalid_authority',
    };
  }
  if (!isAgentIdentityExactAuthorityCurrent(syntacticAuthority, fence)) {
    return {
      ok: false,
      identities: new Map(),
      serverVerified: false,
      localSaved: false,
      error: 'authority_retired',
    };
  }
  const verified = await verifyAgentIdentityExactAuthority(syntacticAuthority, fence);
  const authority = normalizeAgentIdentityExactWriteAuthority(
    verified as AgentIdentityExactWriteAuthority | null,
  );
  if (!authority) {
    return {
      ok: false,
      identities: new Map(),
      serverVerified: false,
      localSaved: false,
      error: isAgentIdentityExactAuthorityCurrent(syntacticAuthority, fence)
        ? 'authority_mismatch'
        : 'authority_retired',
    };
  }
  return refreshVerifiedAgentIdentitiesFromServerExact(authority, fence);
}

/**
 * Publish only a complete server snapshot captured while the cross-realm cache
 * lane is exclusive. The mutation receipt proves that this caller's server
 * write completed, but it is deliberately not used as ordering authority: a
 * later server command in another tab may already have committed. Rereading
 * under the shared lock makes either completion publish current server truth.
 */
async function publishCurrentAgentIdentityServerTruthExact(
  authority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const refresh = await refreshVerifiedAgentIdentitiesFromServerExact(authority, fence);
  if (refresh.ok) {
    return { ok: true, localSaved: true, serverSaved: true };
  }
  return {
    ok: false,
    localSaved: false,
    serverSaved: true,
    error: refresh.error === 'invalid_authority' || refresh.error === 'authority_retired'
      ? refresh.error
      : 'local_write_failed',
  };
}

async function saveAgentIdentityMapExact(
  identities: Map<string, AgentIdentity>,
  verifiedAuthority: VerifiedAgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
  persistedIdentities: Map<string, AgentIdentity>,
  expectedColumnsBySessionKey?: ReadonlyMap<string, ReadonlySet<keyof AgentIdentityRow>>,
  serverVersions?: ReadonlyMap<string, string>,
): Promise<AgentIdentityExactSaveResult> {
  // This private helper is reachable only after
  // loadAgentIdentityMutationBaseExact has verified the captured bearer and
  // returned its normalized authority. Repeating the remote bearer check here
  // added a network round trip but could not eliminate the write-time TOCTOU
  // window; the bearer-bound database mutation and RLS remain the durable
  // authority check. Keep every caller routed through that verified base.
  const authority = normalizeAgentIdentityExactWriteAuthority(verifiedAuthority);
  if (!authority || typeof fence !== 'function') {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_authority' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  if (
    !(identities instanceof Map)
    || !(persistedIdentities instanceof Map)
    || identities.size > MAX_AGENT_IDENTITIES_PER_SCOPE
    || persistedIdentities.size === 0
    || persistedIdentities.size > identities.size
  ) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  const serialized = serializeExactIdentityMap(identities);
  if (!serialized) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  for (const [sessionKey, identity] of persistedIdentities) {
    if (identities.get(sessionKey) !== identity || identity.sessionKey !== sessionKey) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
    }
  }

  // Durable mutation comes first. A retired generation can therefore never
  // publish its speculative map into the current device cache.
  const serverResult = await persistIdentitiesToServerExact(
    persistedIdentities,
    authority,
    fence,
    expectedColumnsBySessionKey,
    serverVersions,
  );
  if (!serverResult.ok) {
    return { ok: false, localSaved: false, serverSaved: false, error: serverResult.error };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: true, error: 'authority_retired' };
  }

  return publishCurrentAgentIdentityServerTruthExact(authority, fence);
}

/**
 * Persist an exact scope synchronously enough to return a truthful receipt.
 * Both local and durable writes are bound to the same verified captured owner;
 * this function never re-reads the current global session.
 */
export async function saveAgentIdentitiesExact(
  identities: Map<string, AgentIdentity>,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (!authority || typeof fence !== 'function') {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_authority' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  const mutationBase = await loadAgentIdentityMutationBaseExact(authority, fence, null);
  if (!mutationBase.ok) {
    return { ok: false, localSaved: false, serverSaved: false, error: mutationBase.error };
  }
  // This broad API is used to reconcile a freshly fetched durable snapshot
  // into the device cache. Existing server rows win unconditionally because
  // the caller has not declared field-level mutation intent. Only identities
  // proven absent by the immediately preceding read are inserted. Targeted
  // updates must use updateAgentIdentityExact/customize/etc. with CAS fields.
  const reconciled = new Map(mutationBase.serverIdentities);
  const newIdentities = new Map<string, AgentIdentity>();
  const allExpectedColumns = new Map<string, ReadonlySet<keyof AgentIdentityRow>>();
  for (const [sessionKey, identity] of identities) {
    if (mutationBase.serverVersions.has(sessionKey)) continue;
    reconciled.set(sessionKey, identity);
    newIdentities.set(sessionKey, identity);
    const row = identityToRow(mutationBase.authority.userId, identity);
    allExpectedColumns.set(
      sessionKey,
      new Set(
        (Object.keys(row) as Array<keyof AgentIdentityRow>)
          .filter(column => column !== 'user_id' && column !== 'session_key'),
      ),
    );
  }
  if (newIdentities.size === 0) {
    // loadAgentIdentityMutationBaseExact already supplied the exact, validated
    // server receipt. No durable mutation is necessary; reread current server
    // truth under the cross-realm publication lane so an older tab cannot
    // replace a newer exact cache snapshot.
    return publishCurrentAgentIdentityServerTruthExact(
      mutationBase.authority,
      fence,
    );
  }
  return saveAgentIdentityMapExact(
    reconciled,
    mutationBase.authority,
    fence,
    newIdentities,
    allExpectedColumns,
    mutationBase.serverVersions,
  );
}

// ─── Update Agent Identity ─────────────────────────────────

export async function updateAgentIdentity(
  sessionKey: string,
  updates: Partial<AgentIdentity>
): Promise<void> {
  const identities = await loadAgentIdentities();
  const existing = identities.get(sessionKey);
  
  if (existing) {
    identities.set(sessionKey, {
      ...existing,
      ...updates,
      lastSeen: Date.now(),
    });
  } else {
    // New agent identity
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: 0,
      totalTokensAllTime: 0,
      totalSessionsAllTime: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      totalMessages: 0,
      totalTurns: 0,
      ...updates,
    });
  }
  
  await saveAgentIdentities(identities);
}

export async function updateAgentIdentityExact(
  sessionKey: string,
  updates: Partial<AgentIdentity>,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const normalizedSessionKey = normalizeAgentIdentityScopePart(sessionKey);
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (
    !normalizedSessionKey
    || !authority
    || typeof fence !== 'function'
    || Object.prototype.hasOwnProperty.call(updates, 'isPrimary')
  ) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  const mutationBase = await loadAgentIdentityMutationBaseExact(authority, fence, normalizedSessionKey);
  if (!mutationBase.ok) {
    return { ok: false, localSaved: false, serverSaved: false, error: mutationBase.error };
  }
  const identities = mutationBase.identities;
  const existing = identities.get(normalizedSessionKey);
  const now = Date.now();
  const nextIdentity: AgentIdentity = existing
    ? { ...existing, ...updates, sessionKey: normalizedSessionKey, lastSeen: now }
    : {
      totalCostAllTime: 0,
      totalTokensAllTime: 0,
      totalSessionsAllTime: 0,
      firstSeen: now,
      lastSeen: now,
      totalMessages: 0,
      totalTurns: 0,
      ...updates,
      sessionKey: normalizedSessionKey,
    };
  identities.set(normalizedSessionKey, nextIdentity);
  const expectedColumns = expectedIdentityReceiptColumns({ ...updates, lastSeen: now });
  return saveAgentIdentityMapExact(
    identities,
    mutationBase.authority,
    fence,
    new Map([[normalizedSessionKey, nextIdentity]]),
    new Map([[normalizedSessionKey, expectedColumns]]),
    mutationBase.serverVersions,
  );
}

/**
 * Atomically project one published Office agent's Spirit into both the
 * peer-visible office row and its owner-private durable identity. A published
 * DB agent's canonical identity key is its office-agent UUID; no caller may
 * bind an arbitrary session key to a public row.
 */
export async function updatePublishedAgentSpiritExact(
  input: AgentPublishedSpiritAssignmentInput,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  const officeAgentId = typeof input?.officeAgentId === 'string' ? input.officeAgentId.trim() : '';
  const sessionKey = normalizeAgentIdentityScopePart(input?.sessionKey);
  const spiritId = input?.spiritId === null
    ? null
    : normalizeAgentIdentityScopePart(input?.spiritId);
  const spiritEmoji = input?.spiritEmoji === null
    ? null
    : typeof input?.spiritEmoji === 'string'
      ? input.spiritEmoji.trim()
      : null;
  const customProfileId = input?.customProfileId === null
    ? null
    : typeof input?.customProfileId === 'string'
      ? input.customProfileId.trim()
      : null;
  const isCustomAssignment = customProfileId !== null;
  if (
    !authority
    || typeof fence !== 'function'
    || !isAgentIdentityUuidLike(officeAgentId)
    || officeAgentId !== officeAgentId.toLowerCase()
    || !sessionKey
    || sessionKey !== officeAgentId
    || (input.spiritId !== null && (
      !spiritId
      || spiritId !== input.spiritId
      || /[\u0000-\u001f\u007f]/u.test(spiritId)
    ))
    || (input.spiritEmoji !== null && (
      spiritEmoji !== input.spiritEmoji
      || !spiritEmoji
      || spiritEmoji.length > 64
      || /[\u0000-\u001f\u007f]/u.test(spiritEmoji)
    ))
    || (input.customProfileId !== null && (
      !customProfileId
      || customProfileId !== input.customProfileId
      || !isAgentIdentityUuidLike(customProfileId)
      || customProfileId !== customProfileId.toLowerCase()
    ))
    || (spiritId === null && (spiritEmoji !== null || customProfileId !== null))
    || (isCustomAssignment && spiritId !== `custom::${customProfileId}`)
    || (!isCustomAssignment && spiritId?.startsWith('custom::'))
  ) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  const command = beginAgentIdentityExactCommand('published_spirit', authority, officeAgentId);
  const commandFence = makeAgentIdentityExactCommandFence(fence, command);
  const verified = await verifyAgentIdentityExactAuthority(authority, commandFence);
  const verifiedAuthority = normalizeAgentIdentityExactWriteAuthority(
    verified as AgentIdentityExactWriteAuthority,
  );
  if (!verifiedAuthority) {
    if (!isAgentIdentityExactCommandEpochCurrent(command)) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'mutation_superseded' };
    }
    return isAgentIdentityExactAuthorityCurrent(authority, fence)
      ? { ok: false, localSaved: false, serverSaved: false, error: 'authority_mismatch' }
      : { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
    return {
      ok: false,
      localSaved: false,
      serverSaved: false,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }
  if (_identitiesPersistDisabled) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'server_unavailable' };
  }

  const normalizedInput: AgentPublishedSpiritAssignmentInput = {
    officeAgentId,
    sessionKey,
    spiritId,
    spiritEmoji,
    customProfileId,
  };
  let data: unknown;
  let rpcError: any;
  try {
    const response = await supabase
      .rpc('set_published_agent_spirit_v1', {
        p_circle_id: verifiedAuthority.circleId,
        p_office_agent_id: officeAgentId,
        p_spirit_id: spiritId,
        p_spirit_emoji: spiritEmoji,
        p_custom_profile_id: customProfileId,
      })
      .setHeader('Authorization', `Bearer ${verifiedAuthority.accessToken}`);
    data = response.data;
    rpcError = response.error;
  } catch {
    return isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)
      ? { ok: false, localSaved: false, serverSaved: false, error: 'server_unavailable' }
      : {
          ok: false,
          localSaved: false,
          serverSaved: false,
          error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
        };
  }
  if (rpcError) {
    if (shouldDisableIdentityPersistence(rpcError)) disableIdentityPersistenceForSession(rpcError);
    return isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)
      ? { ok: false, localSaved: false, serverSaved: false, error: 'server_unavailable' }
      : {
          ok: false,
          localSaved: false,
          serverSaved: false,
          error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
        };
  }
  const receipt = parsePublishedAgentSpiritRpcReceipt(
    data,
    verifiedAuthority,
    normalizedInput,
  );
  if (!receipt) {
    return { ok: false, localSaved: false, serverSaved: null, error: 'outcome_unknown' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
    return {
      ok: false,
      localSaved: false,
      serverSaved: true,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }

  const publication = await publishCurrentAgentIdentityServerTruthExact(
    verifiedAuthority,
    commandFence,
  );
  if (publication.error === 'authority_retired') {
    return {
      ...publication,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }
  return publication;
}

/** Delete one owner profile only after the server proves it is unreferenced. */
export async function deleteUnreferencedCustomAgentProfileExact(
  profileIdInput: string,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentCustomProfileDeleteResult> {
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  const profileId = typeof profileIdInput === 'string' ? profileIdInput.trim() : '';
  if (
    !authority
    || typeof fence !== 'function'
    || !isAgentIdentityUuidLike(profileId)
    || profileId !== profileIdInput
    || profileId !== profileId.toLowerCase()
  ) {
    return { ok: false, serverDeleted: false, error: 'invalid_payload' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, serverDeleted: false, error: 'authority_retired' };
  }
  const command = beginAgentIdentityExactCommand('profile_delete', authority, profileId);
  const commandFence = makeAgentIdentityExactCommandFence(fence, command);
  const verified = await verifyAgentIdentityExactAuthority(authority, commandFence);
  const verifiedAuthority = normalizeAgentIdentityExactWriteAuthority(
    verified as AgentIdentityExactWriteAuthority,
  );
  if (!verifiedAuthority) {
    if (!isAgentIdentityExactCommandEpochCurrent(command)) {
      return { ok: false, serverDeleted: false, error: 'mutation_superseded' };
    }
    return isAgentIdentityExactAuthorityCurrent(authority, fence)
      ? { ok: false, serverDeleted: false, error: 'authority_mismatch' }
      : { ok: false, serverDeleted: false, error: 'authority_retired' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
    return {
      ok: false,
      serverDeleted: false,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }
  let data: unknown;
  let rpcError: any;
  try {
    const response = await supabase
      .rpc('delete_unreferenced_custom_agent_profile_v1', {
        p_profile_id: profileId,
      })
      .setHeader('Authorization', `Bearer ${verifiedAuthority.accessToken}`);
    data = response.data;
    rpcError = response.error;
  } catch {
    return isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)
      ? { ok: false, serverDeleted: false, error: 'server_unavailable' }
      : {
          ok: false,
          serverDeleted: false,
          error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
        };
  }
  if (rpcError) {
    if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
      return {
        ok: false,
        serverDeleted: false,
        error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
      };
    }
    const errorMessage = String(rpcError?.message || rpcError?.details || '');
    return errorMessage.includes('custom_agent_profile_still_referenced')
      ? { ok: false, serverDeleted: false, error: 'profile_referenced' }
      : { ok: false, serverDeleted: false, error: 'server_unavailable' };
  }
  if (!parseCustomProfileDeleteRpcReceipt(data, verifiedAuthority, profileId)) {
    return { ok: false, serverDeleted: null, error: 'outcome_unknown' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
    return {
      ok: false,
      serverDeleted: true,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }
  return { ok: true, serverDeleted: true };
}

// ─── Record Agent Activity ─────────────────────────────────

export async function recordAgentActivity(agent: OfficeAgent): Promise<void> {
  const sessionKey = getAgentIdentityKey(agent);
  const identities = await loadAgentIdentities();
  const existing = identities.get(sessionKey);
  const lifetimeCost = Math.max(
    agent.costTotal || 0,
    agent.sessionCostToday || 0,
    agent.costToday || 0,
  );
  
  if (existing) {
    // Update existing identity with cumulative data
    identities.set(sessionKey, {
      ...existing,
      totalCostAllTime: Math.max(existing.totalCostAllTime, lifetimeCost),
      totalTokensAllTime: Math.max(existing.totalTokensAllTime, agent.tokensUsed),
      totalMessages: Math.max(existing.totalMessages, agent.messagesProcessed),
      mostUsedModel: agent.model,
      boundModel: agent.model || existing.boundModel,
      lastSeen: Date.now(),
    });
  } else {
    // New agent - create identity
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: lifetimeCost,
      totalTokensAllTime: agent.tokensUsed,
      totalSessionsAllTime: 1,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      totalMessages: agent.messagesProcessed,
      totalTurns: 0,
      mostUsedModel: agent.model,
      boundModel: agent.model,
    });
  }
  
  await saveAgentIdentities(identities);
}

export async function recordAgentActivityExact(
  agent: OfficeAgent,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const sessionKey = normalizeAgentIdentityScopePart(getAgentIdentityKey(agent));
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (!sessionKey || !authority || typeof fence !== 'function') {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  const mutationBase = await loadAgentIdentityMutationBaseExact(authority, fence, sessionKey);
  if (!mutationBase.ok) {
    return { ok: false, localSaved: false, serverSaved: false, error: mutationBase.error };
  }
  const identities = mutationBase.identities;
  const existing = identities.get(sessionKey);
  const lifetimeCost = Math.max(
    agent.costTotal || 0,
    agent.sessionCostToday || 0,
    agent.costToday || 0,
  );
  const now = Date.now();
  const nextIdentity: AgentIdentity = existing
    ? {
      ...existing,
      totalCostAllTime: Math.max(existing.totalCostAllTime, lifetimeCost),
      totalTokensAllTime: Math.max(existing.totalTokensAllTime, agent.tokensUsed),
      totalMessages: Math.max(existing.totalMessages, agent.messagesProcessed),
      mostUsedModel: agent.model,
      boundAiProvider: existing.boundAiProvider || agent.providerType,
      boundModel: agent.model || existing.boundModel,
      lastSeen: now,
    }
    : {
      sessionKey,
      totalCostAllTime: lifetimeCost,
      totalTokensAllTime: agent.tokensUsed,
      totalSessionsAllTime: 1,
      firstSeen: now,
      lastSeen: now,
      totalMessages: agent.messagesProcessed,
      totalTurns: 0,
      mostUsedModel: agent.model,
      boundAiProvider: agent.providerType,
      boundModel: agent.model,
    };
  identities.set(sessionKey, nextIdentity);
  const expectedColumns = expectedIdentityReceiptColumns({
    totalCostAllTime: nextIdentity.totalCostAllTime,
    totalTokensAllTime: nextIdentity.totalTokensAllTime,
    totalMessages: nextIdentity.totalMessages,
    mostUsedModel: nextIdentity.mostUsedModel,
    boundAiProvider: nextIdentity.boundAiProvider,
    boundModel: nextIdentity.boundModel,
    lastSeen: now,
  });
  return saveAgentIdentityMapExact(
    identities,
    mutationBase.authority,
    fence,
    new Map([[sessionKey, nextIdentity]]),
    new Map([[sessionKey, expectedColumns]]),
    mutationBase.serverVersions,
  );
}

// ─── Restore Agent from Identity ──────────────────────────

export async function restoreAgentIdentity(agent: OfficeAgent): Promise<OfficeAgent> {
  const sessionKey = getAgentIdentityKey(agent);
  const identities = await loadAgentIdentities();
  const identity = identities.get(sessionKey);
  
  if (!identity) {
    return agent;
  }

  return applyIdentityToAgent(agent, identity);
}

// ─── Batch Restore Agents ──────────────────────────────────

export async function restoreAllAgents(agents: OfficeAgent[]): Promise<OfficeAgent[]> {
  const identities = await loadAgentIdentities();

  const restored = agents.map(agent => {
    return applyIdentityToAgent(agent, getAgentIdentityByAgent(identities, agent));
  });

  // Sort: primary/bonded/customized agents first, then by bond level
  return restored.sort((a, b) => {
    const keyA = getAgentIdentityKey(a);
    const keyB = getAgentIdentityKey(b);
    const idA = identities.get(keyA);
    const idB = identities.get(keyB);

    // Primary agent always first
    if (idA?.isPrimary && !idB?.isPrimary) return -1;
    if (!idA?.isPrimary && idB?.isPrimary) return 1;

    // Customized agents before non-customized
    if (idA?.isCustomized && !idB?.isCustomized) return -1;
    if (!idA?.isCustomized && idB?.isCustomized) return 1;

    // Higher bond level first
    const levelA = idA?.bondLevel || 0;
    const levelB = idB?.bondLevel || 0;
    if (levelA !== levelB) return levelB - levelA;

    return 0; // preserve existing order otherwise
  });
}

export async function restoreAllAgentsExact(
  agents: OfficeAgent[],
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<OfficeAgent[]> {
  const identities = await loadAgentIdentitiesExact(capturedAuthority);
  const restored = agents.map(agent => (
    applyIdentityToAgent(agent, getAgentIdentityByAgent(identities, agent))
  ));
  return restored.sort((a, b) => {
    const idA = identities.get(getAgentIdentityKey(a));
    const idB = identities.get(getAgentIdentityKey(b));
    if (idA?.isPrimary && !idB?.isPrimary) return -1;
    if (!idA?.isPrimary && idB?.isPrimary) return 1;
    if (idA?.isCustomized && !idB?.isCustomized) return -1;
    if (!idA?.isCustomized && idB?.isCustomized) return 1;
    return (idB?.bondLevel || 0) - (idA?.bondLevel || 0);
  });
}

// ─── Agent Statistics ──────────────────────────────────────

export async function getAgentStats(sessionKey: string): Promise<AgentIdentity | null> {
  const identities = await loadAgentIdentities();
  return identities.get(sessionKey) || null;
}

export async function getAllAgentStats(): Promise<AgentIdentity[]> {
  const identities = await loadAgentIdentities();
  return Array.from(identities.values());
}

// ─── Rename Agent ──────────────────────────────────────────

export async function renameAgent(sessionKey: string, newName: string): Promise<void> {
  await updateAgentIdentity(sessionKey, { customName: newName, isCustomized: true });
}

export async function renameAgentExact(
  sessionKey: string,
  newName: string,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  return updateAgentIdentityExact(
    sessionKey,
    { customName: newName.slice(0, 200), isCustomized: true },
    capturedAuthority,
    fence,
  );
}

// ─── Set Main Agent for Provider ──────────────────────────

/**
 * Set one agent as the main pixel agent for its provider type.
 * Clears isPrimary from all other agents of the same provider.
 */
export async function setMainAgentForProvider(
  _sessionKey: string,
  _providerType: string,
): Promise<void> {
  throw new Error('setMainAgentForProviderExact requires captured Office authority');
}

export async function setMainAgentForProviderExact(
  sessionKey: string,
  providerType: string,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const normalizedSessionKey = normalizeAgentIdentityScopePart(sessionKey);
  const normalizedProviderType = normalizeAgentIdentityScopePart(providerType);
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (!normalizedSessionKey || !normalizedProviderType || !authority || typeof fence !== 'function') {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  const command = beginAgentIdentityExactCommand('primary', authority, normalizedProviderType);
  const commandFence = makeAgentIdentityExactCommandFence(fence, command);
  const verified = await verifyAgentIdentityExactAuthority(authority, commandFence);
  const verifiedAuthority = normalizeAgentIdentityExactWriteAuthority(
    verified as AgentIdentityExactWriteAuthority,
  );
  if (!verifiedAuthority) {
    if (!isAgentIdentityExactCommandEpochCurrent(command)) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'mutation_superseded' };
    }
    return isAgentIdentityExactAuthorityCurrent(authority, fence)
      ? { ok: false, localSaved: false, serverSaved: false, error: 'authority_mismatch' }
      : { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
    return {
      ok: false,
      localSaved: false,
      serverSaved: false,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }
  if (_identitiesPersistDisabled) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'server_unavailable' };
  }

  let data: unknown;
  let rpcError: any;
  try {
    const response = await supabase
      .rpc('set_main_agent_for_provider_v1', {
        p_session_key: normalizedSessionKey,
        p_provider_type: normalizedProviderType,
      })
      .setHeader('Authorization', `Bearer ${verifiedAuthority.accessToken}`);
    data = response.data;
    rpcError = response.error;
  } catch {
    return isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)
      ? { ok: false, localSaved: false, serverSaved: false, error: 'server_unavailable' }
      : {
          ok: false,
          localSaved: false,
          serverSaved: false,
          error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
        };
  }
  if (rpcError) {
    if (shouldDisableIdentityPersistence(rpcError)) disableIdentityPersistenceForSession(rpcError);
    return isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)
      ? { ok: false, localSaved: false, serverSaved: false, error: 'server_unavailable' }
      : {
          ok: false,
          localSaved: false,
          serverSaved: false,
          error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
        };
  }
  const receipt = parseAgentIdentityPrimaryRpcReceipt(
    data,
    verifiedAuthority,
    normalizedSessionKey,
    normalizedProviderType,
  );
  if (!receipt) {
    return { ok: false, localSaved: false, serverSaved: null, error: 'outcome_unknown' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(verifiedAuthority, commandFence)) {
    return {
      ok: false,
      localSaved: false,
      serverSaved: true,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }

  const publication = await publishCurrentAgentIdentityServerTruthExact(
    verifiedAuthority,
    commandFence,
  );
  if (publication.error === 'authority_retired') {
    return {
      ...publication,
      error: agentIdentityExactCommandRetirementError(verifiedAuthority, fence, command),
    };
  }
  return publication;
}

// ─── Customize Agent Appearance ────────────────────────────

export async function customizeAgent(
  sessionKey: string,
  appearance: Partial<AgentAppearance>
): Promise<void> {
  const identities = await loadAgentIdentities();
  const existing = identities.get(sessionKey);
  await updateAgentIdentity(sessionKey, {
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(existing?.appearance || {}),
      ...appearance,
    },
  });
}

export async function customizeAgentExact(
  sessionKey: string,
  appearance: Partial<AgentAppearance>,
  capturedAuthority: AgentIdentityExactWriteAuthority,
  fence: AgentIdentityExactAuthorityFence,
): Promise<AgentIdentityExactSaveResult> {
  const normalizedSessionKey = normalizeAgentIdentityScopePart(sessionKey);
  const authority = normalizeAgentIdentityExactWriteAuthority(capturedAuthority);
  if (!normalizedSessionKey || !authority || typeof fence !== 'function') {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  if (!isAgentIdentityExactAuthorityCurrent(authority, fence)) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_retired' };
  }
  const mutationBase = await loadAgentIdentityMutationBaseExact(
    authority,
    fence,
    normalizedSessionKey,
  );
  if (!mutationBase.ok) {
    return { ok: false, localSaved: false, serverSaved: false, error: mutationBase.error };
  }
  const identities = mutationBase.identities;
  const existing = identities.get(normalizedSessionKey);
  const now = Date.now();
  const nextIdentity: AgentIdentity = existing
    ? {
      ...existing,
      appearance: {
        ...DEFAULT_APPEARANCE,
        ...(existing.appearance || {}),
        ...appearance,
      },
      lastSeen: now,
    }
    : {
      sessionKey: normalizedSessionKey,
      totalCostAllTime: 0,
      totalTokensAllTime: 0,
      totalSessionsAllTime: 0,
      firstSeen: now,
      lastSeen: now,
      totalMessages: 0,
      totalTurns: 0,
      appearance: { ...DEFAULT_APPEARANCE, ...appearance },
    };
  identities.set(normalizedSessionKey, nextIdentity);
  return saveAgentIdentityMapExact(
    identities,
    mutationBase.authority,
    fence,
    new Map([[normalizedSessionKey, nextIdentity]]),
    new Map([[
      normalizedSessionKey,
      expectedIdentityReceiptColumns({ appearance: nextIdentity.appearance, lastSeen: now }),
    ]]),
    mutationBase.serverVersions,
  );
}

// ─── Get All Session Keys ──────────────────────────────────

export async function getAllKnownSessionKeys(): Promise<string[]> {
  const identities = await loadAgentIdentities();
  return Array.from(identities.keys());
}

// ─── Cleanup Old Agents ────────────────────────────────────

export async function cleanupOldAgents(daysOld: number = 90): Promise<number> {
  const identities = await loadAgentIdentities();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  
  let cleaned = 0;
  for (const [key, identity] of identities.entries()) {
    if (identity.lastSeen < cutoff) {
      identities.delete(key);
      cleaned++;
    }
  }
  
  await saveAgentIdentities(identities);
  return cleaned;
}

// ─── Export/Import ─────────────────────────────────────────

export async function exportAgentIdentities(): Promise<string> {
  const identities = await loadAgentIdentities();
  const data = Object.fromEntries(identities.entries());
  return JSON.stringify(data, null, 2);
}

export async function importAgentIdentities(jsonData: string): Promise<number> {
  try {
    const data = JSON.parse(jsonData) as Record<string, AgentIdentity>;
    const identities = new Map<string, AgentIdentity>(Object.entries(data));
    await saveAgentIdentities(identities);
    return identities.size;
  } catch (error) {
    console.error('Failed to import agent identities:', error);
    throw error;
  }
}
