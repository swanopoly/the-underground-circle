import { supabase } from './supabase';
import { deleteLocalSecret, readLocalSecret, writeLocalSecret } from './localSecrets';
import { buildWordPressPostBody } from './wordpressRestPayload';
import { redactRestError } from './wordpressRestError';
import {
  buildCaptionFollowUpBody,
  buildMediaUploadHeaders,
  resolveUploadMimeType,
} from './wordpressMediaUpload';
import {
  MAX_LIST_PAGES,
  parsePaginationHeaders,
  shouldFetchNextPage,
  type WpListResult,
} from './wordpressListPagination';
import { getVaultEntryAllowedActions, getVaultEntryAllowedOrigins } from './vaultAgentAccess';
import {
  escapedParagraph,
  escapedHeading,
  escapedList,
  escapedQuote,
  escapedImageAlt,
} from './wordpressContentMetadata';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SiteCredential {
  id: string;
  platform: string;
  siteUrl: string | null;
  loginUrl?: string | null;
  username: string | null;
  label: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  secretKind?: string;
  updatedAt?: string | null;
  lastUsedAt?: string | null;
}

interface CredentialRow {
  id: string;
  platform: string;
  site_url: string | null;
  login_url?: string | null;
  username: string | null;
  label: string;
  is_active: boolean;
  metadata?: Record<string, unknown>;
  secret_kind?: string;
  updated_at?: string | null;
  last_used_at?: string | null;
}

interface StoredCredentialRow {
  id: string;
  platform: string;
  label: string;
  metadata?: Record<string, unknown>;
  credential_encrypted?: string | null;
  user_id?: string | null;
  circle_id?: string | null;
}

export type SiteCredentialSecretKind =
  | 'password'
  | 'application_password'
  | 'api_token'
  | 'oauth_token'
  | 'session_cookie'
  | 'totp_seed';

export interface SiteCredentialVaultEntry {
  id: string;
  circleId: string;
  platform: string;
  siteUrl: string | null;
  loginUrl: string | null;
  username: string | null;
  label: string;
  secretKind: SiteCredentialSecretKind;
  metadata: Record<string, unknown>;
  accessPolicy: Record<string, unknown>;
  isActive: boolean;
  createdBy?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  lastUsedAt?: string | null;
  lastUsedBy?: string | null;
  expiresAt?: string | null;
  rotationDueAt?: string | null;
}

export interface SiteCredentialAuditEntry {
  id: string;
  credentialId: string | null;
  circleId: string;
  actorId: string | null;
  action: 'store' | 'list' | 'reveal' | 'delete' | 'use' | 'rotate' | 'update' | 'test';
  purpose: string | null;
  success: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface StoreSiteCredentialVaultInput {
  circleId: string;
  platform: string;
  siteUrl?: string | null;
  loginUrl?: string | null;
  username?: string | null;
  secret: string;
  label?: string;
  secretKind?: SiteCredentialSecretKind;
  metadata?: Record<string, unknown>;
  accessPolicy?: Record<string, unknown>;
  expiresAt?: string | null;
  rotationDueAt?: string | null;
}

export interface UpdateSiteCredentialVaultControlsInput {
  credentialId: string;
  siteUrl?: string | null;
  loginUrl?: string | null;
  username?: string | null;
  label?: string | null;
  metadata?: Record<string, unknown> | null;
  accessPolicy?: Record<string, unknown> | null;
  expiresAt?: string | null;
  rotationDueAt?: string | null;
  isActive?: boolean | null;
}

export interface RevealSiteCredentialSecretResult {
  entry: SiteCredentialVaultEntry;
  secret: string;
}

export type WordPressPostStatus = 'publish' | 'draft' | 'pending' | 'future' | 'private';

export interface WordPressPostRequest {
  siteUrl: string;
  username: string;
  appPassword: string;
  title: string;
  content: string;
  status: WordPressPostStatus;
  featuredImageUrl?: string;
  categories?: number[];
  tags?: number[];
  excerpt?: string;
  slug?: string;
  date?: string;  // ISO 8601 — for scheduled posts, set future date + status: 'future'
  dateGmt?: string;  // UTC wall-clock (no tz suffix) for `date_gmt`; preferred for scheduling so the hour doesn't shift with the runtime timezone
  meta?: Record<string, string>;  // SEO meta: _yoast_wpseo_title, rank_math_title, etc.
}

export interface WordPressPost {
  id: number;
  title: string;
  slug: string;
  status: string;
  date: string;
  modified: string;
  link: string;
  excerpt: string;
  categories: number[];
  tags: number[];
  featured_media: number;
}

export interface WordPressSiteInfo {
  name: string;
  description: string;
  url: string;
  gmt_offset: number;
  timezone_string: string;
}

export interface WordPressPage {
  id: number;
  title: string;
  slug: string;
  status: string;
  date: string;
  modified: string;
  link: string;
  parent: number;
}

export interface WordPressPostResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
  /**
   * Meta object WordPress echoed back on a create response. WP only echoes
   * show_in_rest + editable keys, so this lets callers detect dropped SEO meta
   * honestly (see diffPersistedSeoMeta). Absent when WP returned no meta.
   */
  returnedMeta?: Record<string, unknown>;
}

export interface WordPressConnectionResult {
  connected: boolean;
  siteName?: string;
  error?: string;
}

export interface WordPressCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface WordPressTag {
  id: number;
  name: string;
  slug: string;
  count: number;
}

let userSiteCredentialsUnavailable = false;

function toSiteCredential(row: CredentialRow): SiteCredential {
  return {
    id: row.id,
    platform: row.platform,
    siteUrl: row.site_url,
    loginUrl: row.login_url || null,
    username: row.username,
    label: row.label,
    isActive: row.is_active,
    metadata: row.metadata || {},
    secretKind: row.secret_kind,
    updatedAt: row.updated_at || null,
    lastUsedAt: row.last_used_at || null,
  };
}

function isMissingRelationError(error: any, relation: string): boolean {
  if (!error) return false;
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return error?.code === 'PGRST205'
    || error?.status === 404
    || message.includes(`'public.${relation.toLowerCase()}'`)
    || message.includes(relation.toLowerCase());
}

export function isSiteCredentialVaultMissing(error: any): boolean {
  const code = String(error?.code || '');
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  return code === 'PGRST202'
    || code === 'PGRST204'
    || code === '42883'
    || message.includes('list_circle_site_credentials')
    || message.includes('store_circle_site_credential')
    || message.includes('get_circle_site_credential_secret')
    || message.includes('delete_circle_site_credential')
    || message.includes('list_circle_site_credential_access_log')
    || message.includes('update_circle_site_credential_controls')
    || message.includes('record_circle_site_credential_test_result')
    || message.includes('could not find the function');
}

function normalizeRpcPayload(data: unknown): any {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

function normalizeVaultEntry(row: any): SiteCredentialVaultEntry {
  return {
    id: String(row.id),
    circleId: String(row.circleId || row.circle_id),
    platform: String(row.platform || '').toLowerCase(),
    siteUrl: row.siteUrl ?? row.site_url ?? null,
    loginUrl: row.loginUrl ?? row.login_url ?? null,
    username: row.username ?? null,
    label: row.label || 'default',
    secretKind: (row.secretKind || row.secret_kind || 'password') as SiteCredentialSecretKind,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    accessPolicy: (row.accessPolicy || row.access_policy || {}) as Record<string, unknown>,
    isActive: row.isActive ?? row.is_active ?? true,
    createdBy: row.createdBy ?? row.created_by ?? null,
    createdAt: row.createdAt ?? row.created_at ?? null,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    lastUsedAt: row.lastUsedAt ?? row.last_used_at ?? null,
    lastUsedBy: row.lastUsedBy ?? row.last_used_by ?? null,
    expiresAt: row.expiresAt ?? row.expires_at ?? null,
    rotationDueAt: row.rotationDueAt ?? row.rotation_due_at ?? null,
  };
}

function normalizeVaultAuditEntry(row: any): SiteCredentialAuditEntry {
  return {
    id: String(row.id),
    credentialId: row.credentialId ?? row.credential_id ?? null,
    circleId: String(row.circleId || row.circle_id),
    actorId: row.actorId ?? row.actor_id ?? null,
    action: (row.action || 'use') as SiteCredentialAuditEntry['action'],
    purpose: row.purpose ?? null,
    success: row.success !== false,
    metadata: (row.metadata || {}) as Record<string, unknown>,
    createdAt: row.createdAt || row.created_at || new Date().toISOString(),
  };
}

export async function listSiteCredentialVault(
  circleId: string,
  platform?: string,
): Promise<{ entries: SiteCredentialVaultEntry[]; error?: string; vaultMissing?: boolean }> {
  const { data, error } = await supabase.rpc('list_circle_site_credentials', {
    p_circle_id: circleId,
    p_platform: platform || null,
  });

  if (error) {
    return { entries: [], error: error.message, vaultMissing: isSiteCredentialVaultMissing(error) };
  }

  const payload = normalizeRpcPayload(data);
  const rows = Array.isArray(payload) ? payload : [];
  return { entries: rows.map(normalizeVaultEntry) };
}

export async function storeSiteCredentialVault(
  input: StoreSiteCredentialVaultInput,
): Promise<{ entry?: SiteCredentialVaultEntry; error?: string; vaultMissing?: boolean }> {
  const { data, error } = await supabase.rpc('store_circle_site_credential', {
    p_circle_id: input.circleId,
    p_platform: input.platform.trim().toLowerCase(),
    p_site_url: input.siteUrl?.trim() || null,
    p_username: input.username?.trim() || null,
    p_secret: input.secret,
    p_label: input.label?.trim() || 'default',
    p_metadata: input.metadata || {},
    p_secret_kind: input.secretKind || 'password',
    p_login_url: input.loginUrl?.trim() || null,
    p_access_policy: input.accessPolicy || { require_approval: true },
    p_expires_at: input.expiresAt || null,
    p_rotation_due_at: input.rotationDueAt || null,
  });

  if (error) {
    return { error: error.message, vaultMissing: isSiteCredentialVaultMissing(error) };
  }

  return { entry: normalizeVaultEntry(normalizeRpcPayload(data)) };
}

export async function revealSiteCredentialSecret(
  credentialId: string,
  purpose: string = 'manual_reveal',
): Promise<{ result?: RevealSiteCredentialSecretResult; error?: string; vaultMissing?: boolean }> {
  const { data, error } = await supabase.rpc('get_circle_site_credential_secret', {
    p_credential_id: credentialId,
    p_purpose: purpose,
  });

  if (error) {
    return { error: error.message, vaultMissing: isSiteCredentialVaultMissing(error) };
  }

  const payload = normalizeRpcPayload(data);
  return {
    result: {
      entry: normalizeVaultEntry(payload),
      secret: typeof payload?.secret === 'string' ? payload.secret : '',
    },
  };
}

export async function deleteSiteCredentialVault(
  credentialId: string,
): Promise<{ success: boolean; error?: string; vaultMissing?: boolean }> {
  const { data, error } = await supabase.rpc('delete_circle_site_credential', {
    p_credential_id: credentialId,
  });

  if (error) {
    return { success: false, error: error.message, vaultMissing: isSiteCredentialVaultMissing(error) };
  }

  return { success: data !== false };
}

// Session-level kill switch for the audit-log RPC — when this RPC
// isn't deployed (404 / PGRST202), every panel open re-fires it and
// supabase-js logs the failure even though our code handles it.
// First failure flips this and subsequent calls skip the network
// hop. Reset on full page reload.
let _auditLogRpcDisabled = false;

export async function listSiteCredentialVaultAudit(
  circleId: string,
  credentialId?: string | null,
  limit: number = 25,
): Promise<{ entries: SiteCredentialAuditEntry[]; error?: string; vaultMissing?: boolean }> {
  if (_auditLogRpcDisabled) {
    return { entries: [], vaultMissing: true };
  }
  const { data, error } = await supabase.rpc('list_circle_site_credential_access_log', {
    p_circle_id: circleId,
    p_credential_id: credentialId || null,
    p_limit: limit,
  });

  if (error) {
    const missing = isSiteCredentialVaultMissing(error);
    if (missing) _auditLogRpcDisabled = true;
    return { entries: [], error: error.message, vaultMissing: missing };
  }

  const payload = normalizeRpcPayload(data);
  const rows = Array.isArray(payload) ? payload : [];
  return { entries: rows.map(normalizeVaultAuditEntry) };
}

export async function updateSiteCredentialVaultControls(
  input: UpdateSiteCredentialVaultControlsInput,
): Promise<{ entry?: SiteCredentialVaultEntry; error?: string; vaultMissing?: boolean }> {
  const { data, error } = await supabase.rpc('update_circle_site_credential_controls', {
    p_credential_id: input.credentialId,
    p_site_url: input.siteUrl === undefined ? null : input.siteUrl,
    p_login_url: input.loginUrl === undefined ? null : input.loginUrl,
    p_username: input.username === undefined ? null : input.username,
    p_label: input.label === undefined ? null : input.label,
    p_metadata: input.metadata ?? null,
    p_access_policy: input.accessPolicy ?? null,
    p_expires_at: input.expiresAt === undefined ? null : input.expiresAt,
    p_rotation_due_at: input.rotationDueAt === undefined ? null : input.rotationDueAt,
    p_is_active: input.isActive ?? null,
    p_set_site_url: input.siteUrl !== undefined,
    p_set_login_url: input.loginUrl !== undefined,
    p_set_username: input.username !== undefined,
    p_set_label: input.label !== undefined,
    p_set_expires_at: input.expiresAt !== undefined,
    p_set_rotation_due_at: input.rotationDueAt !== undefined,
    p_set_is_active: input.isActive !== undefined,
  });

  if (error) {
    return { error: error.message, vaultMissing: isSiteCredentialVaultMissing(error) };
  }

  return { entry: normalizeVaultEntry(normalizeRpcPayload(data)) };
}

export async function recordSiteCredentialVaultTestResult(
  credentialId: string,
  success: boolean,
  message?: string | null,
  metadata?: Record<string, unknown>,
): Promise<{ entry?: SiteCredentialVaultEntry; error?: string; vaultMissing?: boolean }> {
  const { data, error } = await supabase.rpc('record_circle_site_credential_test_result', {
    p_credential_id: credentialId,
    p_success: success,
    p_message: message || null,
    p_metadata: metadata || {},
  });

  if (error) {
    return { error: error.message, vaultMissing: isSiteCredentialVaultMissing(error) };
  }

  return { entry: normalizeVaultEntry(normalizeRpcPayload(data)) };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const SITE_CREDENTIAL_PLACEHOLDER = '__local_secret__';

/** Legacy Base64 encoding used only to migrate older remotely stored credentials. */
function encodeCredential(credential: string): string {
  try {
    return btoa(unescape(encodeURIComponent(credential)));
  } catch {
    return btoa(credential);
  }
}

function decodeCredential(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return atob(encoded);
  }
}

function userSiteSecretId(userId: string, platform: string, label: string): string {
  return `${userId}:${platform}:${label}`;
}

function circleSiteSecretId(circleId: string, platform: string, label: string): string {
  return `${circleId}:${platform}:${label}`;
}

function getStoredSecretId(
  row: StoredCredentialRow | null | undefined,
  scope: 'user' | 'circle',
): string | null {
  if (!row) {
    return null;
  }

  if (typeof row.metadata?.secretKey === 'string') {
    return row.metadata.secretKey;
  }

  if (scope === 'circle') {
    return row.circle_id ? circleSiteSecretId(row.circle_id, row.platform, row.label) : null;
  }

  return row.user_id ? userSiteSecretId(row.user_id, row.platform, row.label) : null;
}

async function resolveStoredCredential(
  row: StoredCredentialRow | null | undefined,
  scope: 'user' | 'circle',
): Promise<string | null> {
  const secretId = getStoredSecretId(row, scope);
  if (!row || !secretId) {
    return null;
  }

  const namespace = scope === 'circle' ? 'circle_site_credential' : 'user_site_credential';
  const localCredential = await readLocalSecret(namespace, secretId);
  if (localCredential) {
    return localCredential;
  }

  const legacyRemoteCredential = typeof row.credential_encrypted === 'string'
    && row.credential_encrypted !== SITE_CREDENTIAL_PLACEHOLDER
    ? decodeCredential(row.credential_encrypted)
    : null;

  if (!legacyRemoteCredential) {
    return null;
  }

  await writeLocalSecret(namespace, secretId, legacyRemoteCredential);

  void supabase
    .from(scope === 'circle' ? 'circle_site_credentials' : 'user_site_credentials')
    .update({
      credential_encrypted: SITE_CREDENTIAL_PLACEHOLDER,
      metadata: {
        ...(row.metadata || {}),
        secretStorage: 'local_only',
        secretKey: secretId,
        hasLocalCredential: true,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id);

  return legacyRemoteCredential;
}

/** Build Basic Auth header for WordPress REST API */
function wpAuthHeader(username: string, appPassword: string): string {
  return 'Basic ' + btoa(`${username}:${appPassword}`);
}

/** Normalize site URL — ensure trailing slash, strip trailing /wp-json etc. */
function normalizeSiteUrl(url: string): string {
  let normalized = url.trim();
  // Remove trailing paths that shouldn't be there
  normalized = normalized.replace(/\/wp-json\/?.*$/, '');
  normalized = normalized.replace(/\/wp-admin\/?.*$/, '');
  // Ensure https if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  // Remove trailing slash for consistency
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

// ─── 1. Store Credential ────────────────────────────────────────────────────

export async function storeSiteCredential(
  platform: string,
  siteUrl: string | null,
  username: string | null,
  credential: string,
  label: string = 'default',
  metadata: Record<string, unknown> = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    if (userSiteCredentialsUnavailable) {
      return { success: false, error: 'user_site_credentials table is unavailable in this project' };
    }
    const { data: userData, error: userError } = await supabase.auth.getUser().catch(() => ({
      data: null as any,
      error: { message: 'Auth error' },
    }));
    if (userError || !userData?.user) {
      return { success: false, error: 'Not authenticated' };
    }

    const secretId = userSiteSecretId(userData.user.id, platform, label);
    await writeLocalSecret('user_site_credential', secretId, credential);

    const { error } = await supabase.from('user_site_credentials').upsert(
      {
        user_id: userData.user.id,
        platform,
        site_url: siteUrl,
        username,
        credential_encrypted: SITE_CREDENTIAL_PLACEHOLDER,
        label,
        metadata: {
          ...metadata,
          secretStorage: 'local_only',
          secretKey: secretId,
          hasLocalCredential: true,
        },
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform,label' },
    );

    if (error) {
      if (isMissingRelationError(error, 'user_site_credentials')) {
        userSiteCredentialsUnavailable = true;
      }
      if (!isMissingRelationError(error, 'user_site_credentials')) {
        console.error('[SiteAutomation] Store credential error:', error);
      }
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('[SiteAutomation] Store credential exception:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}

export async function storeCircleSiteCredential(
  circleId: string,
  platform: string,
  siteUrl: string | null,
  username: string | null,
  credential: string,
  label: string = 'default',
  metadata: Record<string, unknown> = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser().catch(() => ({
      data: null as any,
      error: { message: 'Auth error' },
    }));
    if (userError || !userData?.user) {
      return { success: false, error: 'Not authenticated' };
    }

    const vaultResult = await storeSiteCredentialVault({
      circleId,
      platform,
      siteUrl,
      loginUrl: platform === 'wordpress' && siteUrl ? `${normalizeSiteUrl(siteUrl)}/wp-login.php` : siteUrl,
      username,
      secret: credential,
      label,
      secretKind: platform === 'wordpress' ? 'application_password' : 'password',
      metadata: {
        ...metadata,
        circleId,
        source: 'siteAutomation',
      },
      accessPolicy: {
        require_approval: true,
        allowed_origins: siteUrl ? [siteUrl] : [],
        allowed_actions: ['login', 'post', 'edit', 'publish', 'delete'],
      },
    });

    if (vaultResult.entry) {
      return { success: true };
    }

    if (vaultResult.error && !vaultResult.vaultMissing) {
      console.error('[SiteAutomation] Store circle vault credential error:', vaultResult.error);
      return { success: false, error: vaultResult.error };
    }

    const secretId = circleSiteSecretId(circleId, platform, label);
    await writeLocalSecret('circle_site_credential', secretId, credential);
    const { error } = await supabase.from('circle_site_credentials').upsert(
      {
        circle_id: circleId,
        created_by: userData.user.id,
        platform,
        site_url: siteUrl,
        username,
        credential_encrypted: SITE_CREDENTIAL_PLACEHOLDER,
        label,
        metadata: {
          ...metadata,
          circleId,
          secretStorage: 'local_only',
          secretKey: secretId,
          hasLocalCredential: true,
        },
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'circle_id,platform,label' },
    );

    if (error) {
      console.error('[SiteAutomation] Store circle credential error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('[SiteAutomation] Store circle credential exception:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── 2. Load Credentials ───────────────────────────────────────────────────

export async function loadSiteCredentials(
  platform?: string,
): Promise<SiteCredential[]> {
  try {
    if (userSiteCredentialsUnavailable) return [];
    let query = supabase
      .from('user_site_credentials')
      .select('id, platform, site_url, username, label, is_active, metadata')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) {
      if (isMissingRelationError(error, 'user_site_credentials')) {
        userSiteCredentialsUnavailable = true;
      }
      // PGRST205 = table missing from schema cache. The hint says to use
      // `circle_site_credentials` — the migration hasn't landed yet. Return
      // empty quietly instead of a scary red log on every page load.
      if (!isMissingRelationError(error, 'user_site_credentials')) {
        console.warn('[SiteAutomation] Load credentials error:', error.message);
      }
      return [];
    }

    return (data || []).map((row: CredentialRow) => toSiteCredential(row));
  } catch (err) {
    console.error('[SiteAutomation] Load credentials exception:', err);
    return [];
  }
}

export async function loadCircleSiteCredentials(
  circleId: string,
  platform?: string,
): Promise<SiteCredential[]> {
  try {
    const vaultResult = await listSiteCredentialVault(circleId, platform);
    if (!vaultResult.error) {
      return vaultResult.entries.map((entry) => ({
        id: entry.id,
        platform: entry.platform,
        siteUrl: entry.siteUrl,
        loginUrl: entry.loginUrl,
        username: entry.username,
        label: entry.label,
        isActive: entry.isActive,
        metadata: entry.metadata,
        secretKind: entry.secretKind,
        updatedAt: entry.updatedAt || null,
        lastUsedAt: entry.lastUsedAt || null,
      }));
    }

    if (!vaultResult.vaultMissing) {
      console.error('[SiteAutomation] Load circle vault credentials error:', vaultResult.error);
      return [];
    }

    let query = supabase
      .from('circle_site_credentials')
      .select('id, platform, site_url, username, label, is_active, metadata')
      .eq('circle_id', circleId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[SiteAutomation] Load circle credentials error:', error);
      return [];
    }

    return (data || []).map((row: CredentialRow) => toSiteCredential(row));
  } catch (err) {
    console.error('[SiteAutomation] Load circle credentials exception:', err);
    return [];
  }
}

// ─── 3. Delete Credential ──────────────────────────────────────────────────

export async function deleteSiteCredential(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (userSiteCredentialsUnavailable) {
      return { success: true };
    }
    const { data: row, error: rowError } = await supabase
      .from('user_site_credentials')
      .select('id, user_id, platform, label, metadata')
      .eq('id', id)
      .maybeSingle();

    if (isMissingRelationError(rowError, 'user_site_credentials')) {
      userSiteCredentialsUnavailable = true;
      return { success: true };
    }

    const { error } = await supabase
      .from('user_site_credentials')
      .delete()
      .eq('id', id);

    if (error) {
      if (isMissingRelationError(error, 'user_site_credentials')) {
        userSiteCredentialsUnavailable = true;
        return { success: true };
      }
      return { success: false, error: error.message };
    }
    const secretId = getStoredSecretId(row as StoredCredentialRow | null, 'user');
    if (secretId) {
      await deleteLocalSecret('user_site_credential', secretId);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── 4. Test WordPress Connection ──────────────────────────────────────────

export async function testWordPressConnection(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<WordPressConnectionResult> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const url = `${base}/wp-json/wp/v2/users/me`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: wpAuthHeader(username, appPassword),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401) {
        return { connected: false, error: 'Invalid username or application password' };
      }
      if (response.status === 403) {
        return { connected: false, error: 'Access forbidden \u2014 check user permissions' };
      }
      if (response.status === 404) {
        return { connected: false, error: 'WordPress REST API not found at this URL' };
      }
      return { connected: false, error: redactRestError(errorText, response.status) };
    }

    const data = await response.json();
    // The /users/me endpoint returns the authenticated user
    // We can get the site name from a separate call
    let siteName = data.name || username;

    // Try to get site name from /wp-json root
    try {
      const rootRes = await fetch(`${base}/wp-json`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (rootRes.ok) {
        const rootData = await rootRes.json();
        if (rootData.name) siteName = rootData.name;
      }
    } catch {
      // Non-critical, ignore
    }

    return { connected: true, siteName };
  } catch (err: any) {
    // Network errors, CORS issues, etc.
    if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
      return {
        connected: false,
        error: 'Network error \u2014 the site may block cross-origin requests. A proxy may be required.',
      };
    }
    return { connected: false, error: err.message || 'Connection failed' };
  }
}

// ─── 4b. Generic per-platform connection tests ────────────────────────────
//
// Each test sends one cheap auth-only probe to a platform's "who am I"
// endpoint. 200 means the credential is valid; 401/403 means bad creds;
// anything else (network error, CORS, 5xx) returns a useful error string.
// Used by the Vault panel's "Test connection" button to give honest
// readiness scoring beyond WordPress.

export interface PlatformConnectionResult {
  connected: boolean;
  /** Display name pulled from the probe response when available. */
  identity?: string;
  /** Human-readable error when connected = false. */
  error?: string;
}

function networkErrorMessage(err: any): string {
  if (err?.message?.includes('NetworkError') || err?.message?.includes('Failed to fetch')) {
    return 'Network error — the site may block cross-origin requests. A proxy may be required.';
  }
  return err?.message || 'Connection failed';
}

/**
 * Shopify Admin API. The credential should be a private-app password
 * or admin API access token. Probes /admin/api/2024-01/shop.json which
 * requires only the read_shop_information scope.
 */
export async function testShopifyConnection(
  shopUrl: string,
  accessToken: string,
): Promise<PlatformConnectionResult> {
  try {
    const base = normalizeSiteUrl(shopUrl);
    // Shopify credentials use the X-Shopify-Access-Token header for
    // admin API tokens; private-app credentials use Basic auth.
    const looksLikeAdminToken = accessToken.startsWith('shpat_') || accessToken.startsWith('shpca_');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (looksLikeAdminToken) {
      headers['X-Shopify-Access-Token'] = accessToken;
    } else {
      // Fallback: assume it's a Basic-auth-style "key:password" pair.
      headers['Authorization'] = `Basic ${typeof btoa === 'function' ? btoa(accessToken) : Buffer.from(accessToken).toString('base64')}`;
    }
    const res = await fetch(`${base}/admin/api/2024-01/shop.json`, { method: 'GET', headers });
    if (res.status === 401) return { connected: false, error: 'Invalid Shopify access token' };
    if (res.status === 403) return { connected: false, error: 'Access forbidden — token missing read_shop_information scope' };
    if (res.status === 404) return { connected: false, error: 'Shopify Admin API not found — check the shop URL' };
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { connected: true, identity: data?.shop?.name || data?.shop?.domain };
  } catch (err: any) {
    return { connected: false, error: networkErrorMessage(err) };
  }
}

/**
 * Stripe API. The credential is a secret key (sk_test_ / sk_live_ /
 * rk_*). Probes /v1/balance which only requires the key to be valid;
 * no charges or customer reads.
 */
export async function testStripeConnection(
  secretKey: string,
): Promise<PlatformConnectionResult> {
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 401) return { connected: false, error: 'Invalid Stripe secret key' };
    if (res.status === 403) return { connected: false, error: 'Access forbidden — restricted key may lack the required permission' };
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    // The response includes the available balance — useful as identity
    // confirmation. Live vs test mode is visible in the key prefix.
    const mode = secretKey.startsWith('sk_live') ? 'live' : secretKey.startsWith('sk_test') ? 'test' : 'restricted';
    return { connected: true, identity: `Stripe (${mode})` };
  } catch (err: any) {
    return { connected: false, error: networkErrorMessage(err) };
  }
}

/**
 * GitHub API. The credential is a personal access token (classic or
 * fine-grained) or an OAuth token. Probes /user which the token
 * always has access to.
 */
export async function testGitHubConnection(
  token: string,
): Promise<PlatformConnectionResult> {
  try {
    const res = await fetch('https://api.github.com/user', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 401) return { connected: false, error: 'Invalid GitHub token' };
    if (res.status === 403) return { connected: false, error: 'Access forbidden — token may have hit the rate limit or lacks scope' };
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { connected: true, identity: data?.login || data?.name };
  } catch (err: any) {
    return { connected: false, error: networkErrorMessage(err) };
  }
}

/**
 * Cloudflare API. The credential is a token created via "Create
 * Token". Probes /user/tokens/verify which the token always has
 * access to and which returns metadata about the token itself.
 */
export async function testCloudflareConnection(
  token: string,
): Promise<PlatformConnectionResult> {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    if (res.status === 401) return { connected: false, error: 'Invalid Cloudflare token' };
    if (!res.ok) return { connected: false, error: `HTTP ${res.status}` };
    const data = await res.json().catch(() => ({}));
    if (data?.success === false) {
      const errs = (data?.errors || []).map((e: any) => e?.message).filter(Boolean);
      return { connected: false, error: errs[0] || 'Token verify returned success=false' };
    }
    return { connected: true, identity: data?.result?.id ? `token ${String(data.result.id).slice(0, 10)}` : 'Cloudflare' };
  } catch (err: any) {
    return { connected: false, error: networkErrorMessage(err) };
  }
}

// ─── 4c. Have I Been Pwned breach check ───────────────────────────────────
//
// Uses the k-anonymity protocol so we never send the secret itself —
// only the first 5 chars of its SHA-1 hash. The API returns every
// breached hash starting with that prefix and we filter locally.
// See: https://haveibeenpwned.com/API/v3#PwnedPasswords

export interface HaveIBeenPwnedResult {
  breached: boolean;
  /** How many times the secret has appeared in known breach corpora. */
  count: number;
  /** Set when the lookup failed (network, CSP, runtime missing crypto). */
  error?: string;
}

async function sha1Hex(text: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle?.digest) {
    throw new Error('SHA-1 hashing unavailable in this runtime');
  }
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-1', encoder.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkHaveIBeenPwned(secret: string): Promise<HaveIBeenPwnedResult> {
  // Don't waste a request on empty / trivially short input.
  if (!secret || secret.length < 4) {
    return { breached: false, count: 0 };
  }
  try {
    const hash = await sha1Hex(secret);
    const prefix = hash.slice(0, 5).toUpperCase();
    const suffix = hash.slice(5).toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      // Add-Padding pads the response to a fixed length so an observer
      // can't fingerprint which prefix you queried by response size.
      headers: { 'Add-Padding': 'true' },
    });
    if (!res.ok) {
      return { breached: false, count: 0, error: `HIBP returned HTTP ${res.status}` };
    }
    const body = await res.text();
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const sepIdx = line.indexOf(':');
      if (sepIdx <= 0) continue;
      const hashSuffix = line.slice(0, sepIdx).toUpperCase();
      if (hashSuffix !== suffix) continue;
      const count = Number.parseInt(line.slice(sepIdx + 1), 10);
      if (Number.isFinite(count) && count > 0) {
        return { breached: true, count };
      }
    }
    return { breached: false, count: 0 };
  } catch (err: any) {
    return { breached: false, count: 0, error: networkErrorMessage(err) };
  }
}

// ─── 5. Publish to WordPress ───────────────────────────────────────────────

export async function publishToWordPress(
  request: WordPressPostRequest,
): Promise<WordPressPostResult> {
  try {
    const base = normalizeSiteUrl(request.siteUrl);
    const auth = wpAuthHeader(request.username, request.appPassword);
    let featuredMediaId: number | undefined;

    // Step 1: Upload featured image if provided
    if (request.featuredImageUrl) {
      try {
        // Fetch the image
        const imgResponse = await fetch(request.featuredImageUrl);
        if (!imgResponse.ok) {
          console.warn('[WordPress] Failed to fetch featured image, continuing without it');
        } else {
          const imgBlob = await imgResponse.blob();
          // Determine filename from URL
          const urlParts = request.featuredImageUrl.split('/');
          const fileName = urlParts[urlParts.length - 1]?.split('?')[0] || 'featured-image.jpg';

          // R6: prefer the raw-binary upload (Content-Type + Content-Disposition)
          // when the mime is determinable, matching uploadWordPressMedia /
          // wpAdmin.uploadMedia; fall back to multipart FormData otherwise so an
          // indeterminate mime never breaks the upload. Result shape unchanged.
          const mimeType = resolveUploadMimeType((imgBlob as Blob).type, fileName);
          let mediaRes: Response;
          if (mimeType) {
            mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
              method: 'POST',
              headers: buildMediaUploadHeaders({ authorization: auth, mimeType, filename: fileName }),
              body: imgBlob,
            });
          } else {
            const formData = new FormData();
            formData.append('file', imgBlob, fileName);
            mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
              method: 'POST',
              headers: {
                Authorization: auth,
              },
              body: formData,
            });
          }

          if (mediaRes.ok) {
            const mediaData = await mediaRes.json();
            featuredMediaId = mediaData.id;
          } else {
            console.warn('[WordPress] Failed to upload featured image:', redactRestError(await mediaRes.text().catch(() => ''), mediaRes.status));
          }
        }
      } catch (imgErr) {
        console.warn('[WordPress] Image upload error, continuing without image:', imgErr);
      }
    }

    // Step 2: Create the post
    const postBody = buildWordPressPostBody(request, featuredMediaId);

    // Scheduling: WP reads `date` as site-local and `date_gmt` as UTC. Send the
    // UTC instant in `date_gmt` (and drop any local `date`) so the publish hour
    // is correct regardless of the runtime timezone. Layered here because the
    // shared payload builder is read-only and only emits `date`.
    if (request.dateGmt) {
      (postBody as Record<string, unknown>).date_gmt = request.dateGmt;
      delete (postBody as Record<string, unknown>).date;
    }

    const postRes = await fetch(`${base}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postBody),
    });

    if (!postRes.ok) {
      const errorText = await postRes.text().catch(() => '');
      return {
        success: false,
        error: `Failed to create post: ${redactRestError(errorText, postRes.status)}`,
      };
    }

    const postData = await postRes.json();

    return {
      success: true,
      postId: postData.id,
      postUrl: postData.link || postData.guid?.rendered,
      returnedMeta: (postData && typeof postData.meta === 'object' && postData.meta)
        ? postData.meta as Record<string, unknown>
        : undefined,
    };
  } catch (err: any) {
    console.error('[WordPress] Publish error:', err);
    if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
      return {
        success: false,
        error: 'Network error \u2014 CORS may be blocking the request. Consider using a proxy.',
      };
    }
    return { success: false, error: err.message || 'Publishing failed' };
  }
}

// ─── 6. Fetch WordPress Categories ─────────────────────────────────────────

export async function fetchWordPressCategories(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<WordPressCategory[]> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const response = await fetch(`${base}/wp-json/wp/v2/categories?per_page=100`, {
      method: 'GET',
      headers: {
        Authorization: wpAuthHeader(username, appPassword),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data || []).map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      count: cat.count || 0,
    }));
  } catch (err) {
    console.error('[WordPress] Fetch categories error:', err);
    return [];
  }
}

// ─── 7. Fetch WordPress Tags ───────────────────────────────────────────────

export async function fetchWordPressTags(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<WordPressTag[]> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const response = await fetch(`${base}/wp-json/wp/v2/tags?per_page=100`, {
      method: 'GET',
      headers: {
        Authorization: wpAuthHeader(username, appPassword),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data || []).map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      count: tag.count || 0,
    }));
  } catch (err) {
    console.error('[WordPress] Fetch tags error:', err);
    return [];
  }
}

// ─── Utility: Decode stored credential (for use in automation) ──────────────

export async function getDecryptedCredential(
  credentialId: string,
): Promise<string | null> {
  try {
    const vaultResult = await revealSiteCredentialSecret(credentialId, 'site_automation_use');
    if (vaultResult.result?.secret) {
      return vaultResult.result.secret;
    }

    const { data, error } = await supabase
      .from('circle_site_credentials')
      .select('id, circle_id, platform, label, metadata, credential_encrypted')
      .eq('id', credentialId)
      .maybeSingle();

    if (!error && data) {
      return resolveStoredCredential(data as StoredCredentialRow, 'circle');
    }

    if (userSiteCredentialsUnavailable) return null;
    const { data: userData, error: userError } = await supabase
      .from('user_site_credentials')
      .select('id, user_id, platform, label, metadata, credential_encrypted')
      .eq('id', credentialId)
      .single();

    if (userError) {
      if (isMissingRelationError(userError, 'user_site_credentials')) {
        userSiteCredentialsUnavailable = true;
        return null;
      }
      return null;
    }
    if (!userData) return null;
    return resolveStoredCredential(userData as StoredCredentialRow, 'user');
  } catch {
    return null;
  }
}

// ─── 8. Get Site Info ─────────────────────────────────────────────────────────

export async function getWordPressSiteInfo(
  siteUrl: string,
): Promise<WordPressSiteInfo | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    return { name: d.name || '', description: d.description || '', url: d.url || base, gmt_offset: d.gmt_offset || 0, timezone_string: d.timezone_string || '' };
  } catch { return null; }
}

// ─── 9. List Posts ────────────────────────────────────────────────────────────

export async function listWordPressPosts(
  siteUrl: string, username: string, appPassword: string,
  opts: { status?: string; search?: string; perPage?: number; page?: number; orderby?: string } = {},
): Promise<{ posts: WordPressPost[]; total: number }> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const params = new URLSearchParams();
    params.set('per_page', String(opts.perPage || 20));
    params.set('page', String(opts.page || 1));
    params.set('orderby', opts.orderby || 'date');
    params.set('order', 'desc');
    if (opts.status) params.set('status', opts.status);
    if (opts.search) params.set('search', opts.search);

    const res = await fetch(`${base}/wp-json/wp/v2/posts?${params}`, {
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { posts: [], total: 0 };
    const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
    const data = await res.json();
    return {
      total,
      posts: (data || []).map((p: any) => ({
        id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
        date: p.date, modified: p.modified, link: p.link,
        excerpt: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
        categories: p.categories || [], tags: p.tags || [], featured_media: p.featured_media || 0,
      })),
    };
  } catch { return { posts: [], total: 0 }; }
}

// ─── 10. Get Single Post ──────────────────────────────────────────────────────

export async function getWordPressPost(
  siteUrl: string, username: string, appPassword: string, postId: number,
): Promise<WordPressPost | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}`, {
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const p = await res.json();
    return {
      id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
      date: p.date, modified: p.modified, link: p.link,
      excerpt: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
      categories: p.categories || [], tags: p.tags || [], featured_media: p.featured_media || 0,
    };
  } catch { return null; }
}

// ─── 11. Update Post ──────────────────────────────────────────────────────────

export async function updateWordPressPost(
  siteUrl: string, username: string, appPassword: string,
  postId: number, updates: Partial<{ title: string; content: string; status: WordPressPostStatus; excerpt: string; categories: number[]; tags: number[]; meta: Record<string, string> }>,
): Promise<WordPressPostResult> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}`, {
      method: 'POST', // WP REST API uses POST for updates
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: redactRestError(err, res.status) };
    }
    const d = await res.json();
    return { success: true, postId: d.id, postUrl: d.link };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 12. Delete Post ──────────────────────────────────────────────────────────

export async function deleteWordPressPost(
  siteUrl: string, username: string, appPassword: string,
  postId: number, force: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const url = `${base}/wp-json/wp/v2/posts/${postId}${force ? '?force=true' : ''}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: redactRestError(err, res.status) };
    }
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 13. List Pages ───────────────────────────────────────────────────────────

export async function listWordPressPages(
  siteUrl: string, username: string, appPassword: string,
  opts: { status?: string; perPage?: number } = {},
): Promise<WordPressPage[]> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const params = new URLSearchParams();
    params.set('per_page', String(opts.perPage || 50));
    if (opts.status) params.set('status', opts.status);

    const res = await fetch(`${base}/wp-json/wp/v2/pages?${params}`, {
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map((p: any) => ({
      id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
      date: p.date, modified: p.modified, link: p.link, parent: p.parent || 0,
    }));
  } catch { return []; }
}

// ─── 13b. Paginated, error-vs-empty Result variants (R7) ────────────────────
//
// Parallel to the four []-returning helpers above. These page-walk via the
// X-WP-TotalPages header (bounded by MAX_LIST_PAGES) and return a WpListResult
// tuple so callers can tell an HTTP/network error apart from a genuinely-empty
// list. The legacy helpers are left untouched so existing callers are
// unaffected; adopt these only where the error-vs-empty distinction matters.

async function pageWalkWordPressList<T>(
  url: (page: number) => string,
  auth: string,
  mapItem: (raw: any) => T,
): Promise<WpListResult<T>> {
  try {
    const items: T[] = [];
    let total = 0;
    let totalPages = 0;
    let page = 1;
    // First page resolves totalPages; subsequent pages gated by shouldFetchNextPage.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await fetch(url(page), {
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: redactRestError(body, res.status), status: res.status };
      }
      const headerInfo = parsePaginationHeaders(res.headers);
      if (page === 1) {
        total = headerInfo.total;
        totalPages = headerInfo.totalPages;
      }
      const data = await res.json();
      for (const raw of (data || [])) items.push(mapItem(raw));
      if (!shouldFetchNextPage(page, totalPages, MAX_LIST_PAGES)) break;
      page += 1;
    }
    return { ok: true, items, total, totalPages };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Network error' };
  }
}

export async function fetchWordPressCategoriesResult(
  siteUrl: string, username: string, appPassword: string,
): Promise<WpListResult<WordPressCategory>> {
  const base = normalizeSiteUrl(siteUrl);
  return pageWalkWordPressList<WordPressCategory>(
    (page) => `${base}/wp-json/wp/v2/categories?per_page=100&page=${page}`,
    wpAuthHeader(username, appPassword),
    (cat) => ({ id: cat.id, name: cat.name, slug: cat.slug, count: cat.count || 0 }),
  );
}

export async function fetchWordPressTagsResult(
  siteUrl: string, username: string, appPassword: string,
): Promise<WpListResult<WordPressTag>> {
  const base = normalizeSiteUrl(siteUrl);
  return pageWalkWordPressList<WordPressTag>(
    (page) => `${base}/wp-json/wp/v2/tags?per_page=100&page=${page}`,
    wpAuthHeader(username, appPassword),
    (tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, count: tag.count || 0 }),
  );
}

export async function listWordPressPostsResult(
  siteUrl: string, username: string, appPassword: string,
  opts: { status?: string; search?: string; perPage?: number; orderby?: string } = {},
): Promise<WpListResult<WordPressPost>> {
  const base = normalizeSiteUrl(siteUrl);
  const perPage = opts.perPage || 100;
  return pageWalkWordPressList<WordPressPost>(
    (page) => {
      const params = new URLSearchParams();
      params.set('per_page', String(perPage));
      params.set('page', String(page));
      params.set('orderby', opts.orderby || 'date');
      params.set('order', 'desc');
      if (opts.status) params.set('status', opts.status);
      if (opts.search) params.set('search', opts.search);
      return `${base}/wp-json/wp/v2/posts?${params}`;
    },
    wpAuthHeader(username, appPassword),
    (p) => ({
      id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
      date: p.date, modified: p.modified, link: p.link,
      excerpt: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
      categories: p.categories || [], tags: p.tags || [], featured_media: p.featured_media || 0,
    }),
  );
}

export async function listWordPressPagesResult(
  siteUrl: string, username: string, appPassword: string,
  opts: { status?: string; perPage?: number } = {},
): Promise<WpListResult<WordPressPage>> {
  const base = normalizeSiteUrl(siteUrl);
  const perPage = opts.perPage || 100;
  return pageWalkWordPressList<WordPressPage>(
    (page) => {
      const params = new URLSearchParams();
      params.set('per_page', String(perPage));
      params.set('page', String(page));
      if (opts.status) params.set('status', opts.status);
      return `${base}/wp-json/wp/v2/pages?${params}`;
    },
    wpAuthHeader(username, appPassword),
    (p) => ({
      id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
      date: p.date, modified: p.modified, link: p.link, parent: p.parent || 0,
    }),
  );
}

// ─── 14. Create/Update Page ───────────────────────────────────────────────────

export async function publishWordPressPage(
  siteUrl: string, username: string, appPassword: string,
  page: { title: string; content: string; status: WordPressPostStatus; slug?: string; parent?: number },
): Promise<WordPressPostResult> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/pages`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify(page),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: redactRestError(err, res.status) };
    }
    const d = await res.json();
    return { success: true, postId: d.id, postUrl: d.link };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 15. Upload Media ─────────────────────────────────────────────────────────

export async function uploadWordPressMedia(
  siteUrl: string, username: string, appPassword: string,
  file: Blob, fileName: string, altText?: string, caption?: string,
): Promise<{ success: boolean; mediaId?: number; url?: string; error?: string }> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const authorization = wpAuthHeader(username, appPassword);

    // R6: prefer the raw-binary upload (Content-Type + Content-Disposition)
    // when the mime is determinable; fall back to multipart otherwise so an
    // indeterminate mime never breaks the upload.
    const mimeType = resolveUploadMimeType((file as Blob).type, fileName);
    let res: Response;
    if (mimeType) {
      res = await fetch(`${base}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: buildMediaUploadHeaders({ authorization, mimeType, filename: fileName }),
        body: file,
      });
    } else {
      const formData = new FormData();
      formData.append('file', file, fileName);
      if (altText) formData.append('alt_text', altText);
      res = await fetch(`${base}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: { Authorization: authorization },
        body: formData,
      });
    }
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: redactRestError(err, res.status) };
    }
    const d = await res.json();
    // WP often ignores alt_text / caption on media create. Confirm them with a
    // single JSON follow-up POST; non-fatal — keep the mediaId on failure.
    if (d.id) {
      const captionBody = buildCaptionFollowUpBody(caption);
      const followUp: Record<string, unknown> = {};
      if (altText) followUp.alt_text = altText;
      if (captionBody) followUp.caption = captionBody.caption;
      if (Object.keys(followUp).length > 0) {
        try {
          await fetch(`${base}/wp-json/wp/v2/media/${d.id}`, {
            method: 'POST',
            headers: { Authorization: authorization, 'Content-Type': 'application/json' },
            body: JSON.stringify(followUp),
          });
        } catch (followErr) {
          console.warn('[WP] media alt_text/caption follow-up failed:', followErr);
        }
      }
    }
    return { success: true, mediaId: d.id, url: d.source_url };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 16. Create Category/Tag ──────────────────────────────────────────────────

export async function createWordPressCategory(
  siteUrl: string, username: string, appPassword: string, name: string,
): Promise<{ id: number } | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/categories`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { id: d.id };
  } catch { return null; }
}

export async function createWordPressTag(
  siteUrl: string, username: string, appPassword: string, name: string,
): Promise<{ id: number } | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/tags`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { id: d.id };
  } catch { return null; }
}

// ─── 17. Gutenberg Block Builder ──────────────────────────────────────────────

export const wpBlock = {
  // Text-bearing blocks escape their TEXT args (defense against unescaped
  // user/AI text breaking markup); `html`/`code` keep their raw behavior.
  paragraph: (text: string) => escapedParagraph(text),
  heading: (text: string, level: 2 | 3 | 4 = 2) => escapedHeading(text, level),
  image: (url: string, alt: string = '', id?: number) => escapedImageAlt(url, alt, id),
  list: (items: string[], ordered: boolean = false) => escapedList(items, ordered),
  quote: (text: string, citation?: string) => escapedQuote(text, citation),
  code: (code: string) =>
    `<!-- wp:code -->\n<pre class="wp-block-code"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>\n<!-- /wp:code -->`,
  separator: () =>
    `<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`,
  spacer: (height: number = 20) =>
    `<!-- wp:spacer {"height":"${height}px"} -->\n<div style="height:${height}px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`,
  html: (raw: string) =>
    `<!-- wp:html -->\n${raw}\n<!-- /wp:html -->`,
};

// ─── 18. Auto-load WordPress credentials for agent use ────────────────────────

export interface WordPressVaultPolicy {
  accessPolicy: Record<string, unknown>;
  allowedActions: string[];
  allowedOrigins: string[];
}

export interface ActiveWordPressCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
  /**
   * Present ONLY when the credentials came from the circle vault — carries the
   * row's accessPolicy taxonomy/origins so mutation handlers can enforce it
   * (R19). Legacy circle-table / user-table fallbacks omit it, so their
   * behavior is unchanged (policy-less).
   */
  vaultPolicy?: WordPressVaultPolicy;
}

export async function getActiveWordPressCredentials(circleId?: string): Promise<ActiveWordPressCredentials | null> {
  try {
    const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null as any }));
    if (!userData?.user) return null;

    if (circleId) {
      const vaultResult = await listSiteCredentialVault(circleId, 'wordpress');
      if (!vaultResult.error && vaultResult.entries.length > 0) {
        const primary = vaultResult.entries.find(cred => cred.isActive) || vaultResult.entries[0];
        const reveal = await revealSiteCredentialSecret(primary.id, 'wordpress_chat_command');
        if (reveal.result?.secret && primary.siteUrl && primary.username) {
          return {
            siteUrl: primary.siteUrl,
            username: primary.username,
            appPassword: reveal.result.secret,
            vaultPolicy: {
              accessPolicy: (primary.accessPolicy || {}) as Record<string, unknown>,
              allowedActions: getVaultEntryAllowedActions(primary),
              allowedOrigins: getVaultEntryAllowedOrigins(primary),
            },
          };
        }
      }

      const { data: circleData, error: circleError } = await supabase
        .from('circle_site_credentials')
        .select('id, circle_id, site_url, username, platform, label, metadata, credential_encrypted')
        .eq('circle_id', circleId)
        .eq('platform', 'wordpress')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!circleError && circleData) {
        const appPassword = await resolveStoredCredential(circleData as StoredCredentialRow, 'circle');
        if (!appPassword) return null;
        return {
          siteUrl: circleData.site_url,
          username: circleData.username,
          appPassword,
        };
      }
    }

    if (userSiteCredentialsUnavailable) {
      return null;
    }
    const { data, error } = await supabase
      .from('user_site_credentials')
      .select('id, user_id, site_url, username, platform, label, credential_encrypted, metadata')
      .eq('user_id', userData.user.id)
      .eq('platform', 'wordpress')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(10);

    if (error && isMissingRelationError(error, 'user_site_credentials')) {
      userSiteCredentialsUnavailable = true;
      return null;
    }
    if (error || !data || data.length === 0) return null;
    const preferred = circleId
      ? (data as any[]).find(row => row?.metadata?.circleId === circleId) || data[0]
      : data[0];
    const appPassword = await resolveStoredCredential(preferred as StoredCredentialRow, 'user');
    if (!appPassword) return null;
    return {
      siteUrl: preferred.site_url,
      username: preferred.username,
      appPassword,
    };
  } catch { return null; }
}
