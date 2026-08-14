// Agent Identity System - Persistent agent data based on sessionKey
// This ensures agents keep their identity even when connections change.
//
// Dual-persisted (as of 2026-04-30): localStorage stays as the fast cache,
// agent_identities table is the durable source of truth across browser
// clears + devices. saveAgentIdentities writes to both. loadAgentIdentities
// reads localStorage first then asynchronously refreshes from DB.
//
// See migration 20260430_agent_identities.sql.

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

/**
 * A caller-captured identity authority. Exact APIs never obtain a replacement
 * session from mutable global auth state. `circleId` scopes the device cache;
 * the current server schema remains owner-global (`user_id, session_key`).
 */
export interface AgentIdentityExactAuthority {
  userId: string;
  accessToken: string;
  circleId?: string | null;
}

interface NormalizedAgentIdentityExactAuthority {
  userId: string;
  accessToken: string;
  circleId: string | null;
}

export interface AgentIdentityExactSyncResult {
  ok: boolean;
  identities: Map<string, AgentIdentity>;
  error?: 'invalid_authority' | 'authority_mismatch' | 'server_unavailable' | 'invalid_response';
}

export interface AgentIdentityExactSaveResult {
  ok: boolean;
  localSaved: boolean;
  serverSaved: boolean;
  error?: 'invalid_authority' | 'authority_mismatch' | 'invalid_payload' | 'local_write_failed' | 'server_unavailable';
}

function normalizeAgentIdentityScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_AGENT_IDENTITY_SCOPE_PART_LENGTH) return null;
  return normalized;
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
  return { userId, accessToken, circleId };
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

function parseExactAgentIdentityCache(raw: string | null): Map<string, AgentIdentity> | null {
  if (!raw) return new Map();
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
      const requiredNumbers = [
        identity.totalCostAllTime,
        identity.totalTokensAllTime,
        identity.totalSessionsAllTime,
        identity.firstSeen,
        identity.lastSeen,
        identity.totalMessages,
        identity.totalTurns,
      ];
      if (requiredNumbers.some(number => typeof number !== 'number' || !Number.isFinite(number) || number < 0)) {
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
): Promise<NormalizedAgentIdentityExactAuthority | null> {
  const authority = normalizeAgentIdentityExactAuthority(input);
  if (!authority) return null;
  try {
    const { data, error } = await supabase.auth.getUser(authority.accessToken);
    if (error || !data.user || data.user.id !== authority.userId) return null;
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
): Promise<Map<string, AgentIdentity>> {
  const authority = await verifyAgentIdentityExactAuthority(capturedAuthority);
  if (!authority) return new Map();
  const key = agentIdentityExactStorageKey(authority);
  if (!key) return new Map();
  try {
    return parseExactAgentIdentityCache(await storage.getItem(key)) || new Map();
  } catch {
    return new Map();
  }
}

/**
 * Fetch the durable owner-global identities using only the caller-captured
 * bearer. A response containing another owner or malformed identity fails as
 * a whole rather than being partially accepted.
 */
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
  try {
    const { data, error } = await supabase
      .from('agent_identities')
      .select('*')
      .eq('user_id', authority.userId)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (error || !Array.isArray(data)) {
      return { ok: false, identities: new Map(), error: 'server_unavailable' };
    }
    if (data.length > MAX_AGENT_IDENTITIES_PER_SCOPE) {
      return { ok: false, identities: new Map(), error: 'invalid_response' };
    }
    const identities = new Map<string, AgentIdentity>();
    for (const row of data as Array<Record<string, unknown>>) {
      const sessionKey = normalizeAgentIdentityScopePart(row?.session_key);
      if (row?.user_id !== authority.userId || !sessionKey || identities.has(sessionKey)) {
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
    const rows = Array.from(local.values()).map(id => identityToRow(user.id, id));
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
    is_primary: !!identity.isPrimary,
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
    const rows = Array.from(identities.values()).map(id => identityToRow(user.id, id));
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

async function persistIdentitiesToServerExact(
  identities: Map<string, AgentIdentity>,
  authority: NormalizedAgentIdentityExactAuthority,
): Promise<boolean> {
  if (_identitiesPersistDisabled) return false;
  const rows = Array.from(identities.values()).map(identity => identityToRow(authority.userId, identity));
  if (rows.length === 0) return true;
  try {
    let { error } = await supabase
      .from('agent_identities')
      .upsert(rows, { onConflict: 'user_id,session_key' })
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (error) {
      const code = String((error as { code?: unknown }).code || '');
      if (code === 'PGRST204' && String(error.message || '').includes('terminal_config')) {
        const fallbackRows = rows.map(({ terminal_config, ...row }) => row);
        const retry = await supabase
          .from('agent_identities')
          .upsert(fallbackRows, { onConflict: 'user_id,session_key' })
          .setHeader('Authorization', `Bearer ${authority.accessToken}`);
        error = retry.error;
        if (!error) return true;
      }
      if (shouldDisableIdentityPersistence(error)) disableIdentityPersistenceForSession(error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Persist an exact scope synchronously enough to return a truthful receipt.
 * Both local and durable writes are bound to the same verified captured owner;
 * this function never re-reads the current global session.
 */
export async function saveAgentIdentitiesExact(
  identities: Map<string, AgentIdentity>,
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSaveResult> {
  const syntacticAuthority = normalizeAgentIdentityExactAuthority(capturedAuthority);
  if (!syntacticAuthority) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_authority' };
  }
  if (!(identities instanceof Map) || identities.size > MAX_AGENT_IDENTITIES_PER_SCOPE) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  const authority = await verifyAgentIdentityExactAuthority(syntacticAuthority);
  if (!authority) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'authority_mismatch' };
  }
  const key = agentIdentityExactStorageKey(authority);
  if (!key) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_authority' };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(Object.fromEntries(identities.entries()));
    if (
      serialized.length > MAX_AGENT_IDENTITY_CACHE_BYTES
      || parseExactAgentIdentityCache(serialized)?.size !== identities.size
    ) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'local_write_failed' };
    }
    await storage.setItem(key, serialized);
    if (await storage.getItem(key) !== serialized) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'local_write_failed' };
    }
  } catch {
    return { ok: false, localSaved: false, serverSaved: false, error: 'local_write_failed' };
  }

  const serverSaved = await persistIdentitiesToServerExact(identities, authority);
  return serverSaved
    ? { ok: true, localSaved: true, serverSaved: true }
    : { ok: false, localSaved: true, serverSaved: false, error: 'server_unavailable' };
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
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSaveResult> {
  const normalizedSessionKey = normalizeAgentIdentityScopePart(sessionKey);
  if (!normalizedSessionKey) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  const identities = await loadAgentIdentitiesExact(capturedAuthority);
  const existing = identities.get(normalizedSessionKey);
  const now = Date.now();
  identities.set(normalizedSessionKey, existing
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
    });
  return saveAgentIdentitiesExact(identities, capturedAuthority);
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
      boundAiProvider: existing.boundAiProvider || agent.providerType,
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
      boundAiProvider: agent.providerType,
      boundModel: agent.model,
    });
  }
  
  await saveAgentIdentities(identities);
}

export async function recordAgentActivityExact(
  agent: OfficeAgent,
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSaveResult> {
  const sessionKey = normalizeAgentIdentityScopePart(getAgentIdentityKey(agent));
  if (!sessionKey) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  const identities = await loadAgentIdentitiesExact(capturedAuthority);
  const existing = identities.get(sessionKey);
  const lifetimeCost = Math.max(
    agent.costTotal || 0,
    agent.sessionCostToday || 0,
    agent.costToday || 0,
  );
  const now = Date.now();
  identities.set(sessionKey, existing
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
    });
  return saveAgentIdentitiesExact(identities, capturedAuthority);
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
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSaveResult> {
  return updateAgentIdentityExact(
    sessionKey,
    { customName: newName.slice(0, 200), isCustomized: true },
    capturedAuthority,
  );
}

// ─── Set Main Agent for Provider ──────────────────────────

/**
 * Set one agent as the main pixel agent for its provider type.
 * Clears isPrimary from all other agents of the same provider.
 */
export async function setMainAgentForProvider(
  sessionKey: string,
  providerType: string,
): Promise<void> {
  const identities = await loadAgentIdentities();

  // Clear isPrimary from all agents of same provider
  for (const [key, identity] of identities) {
    if (identity.boundAiProvider === providerType && identity.isPrimary) {
      identities.set(key, { ...identity, isPrimary: false });
    }
  }

  // Set this agent as primary
  const existing = identities.get(sessionKey);
  if (existing) {
    identities.set(sessionKey, { ...existing, isPrimary: true, boundAiProvider: providerType });
  } else {
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: 0, totalTokensAllTime: 0, totalSessionsAllTime: 0,
      firstSeen: Date.now(), lastSeen: Date.now(), totalMessages: 0, totalTurns: 0,
      isPrimary: true, boundAiProvider: providerType,
    });
  }

  await saveAgentIdentities(identities);
}

export async function setMainAgentForProviderExact(
  sessionKey: string,
  providerType: string,
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSaveResult> {
  const normalizedSessionKey = normalizeAgentIdentityScopePart(sessionKey);
  const normalizedProviderType = normalizeAgentIdentityScopePart(providerType);
  if (!normalizedSessionKey || !normalizedProviderType) {
    return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
  }
  const identities = await loadAgentIdentitiesExact(capturedAuthority);
  for (const [key, identity] of identities) {
    if (identity.boundAiProvider === normalizedProviderType && identity.isPrimary) {
      identities.set(key, { ...identity, isPrimary: false });
    }
  }
  const existing = identities.get(normalizedSessionKey);
  const now = Date.now();
  identities.set(normalizedSessionKey, existing
    ? { ...existing, isPrimary: true, boundAiProvider: normalizedProviderType, lastSeen: now }
    : {
      sessionKey: normalizedSessionKey,
      totalCostAllTime: 0,
      totalTokensAllTime: 0,
      totalSessionsAllTime: 0,
      firstSeen: now,
      lastSeen: now,
      totalMessages: 0,
      totalTurns: 0,
      isPrimary: true,
      boundAiProvider: normalizedProviderType,
    });
  return saveAgentIdentitiesExact(identities, capturedAuthority);
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
  capturedAuthority: AgentIdentityExactAuthority,
): Promise<AgentIdentityExactSaveResult> {
  const identities = await loadAgentIdentitiesExact(capturedAuthority);
  const existing = identities.get(sessionKey);
  return updateAgentIdentityExact(sessionKey, {
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(existing?.appearance || {}),
      ...appearance,
    },
  }, capturedAuthority);
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
