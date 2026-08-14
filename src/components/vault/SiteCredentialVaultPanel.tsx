import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  deleteSiteCredentialVault,
  listSiteCredentialVaultAudit,
  listSiteCredentialVault,
  recordSiteCredentialVaultTestResult,
  revealSiteCredentialSecret,
  SiteCredentialAuditEntry,
  SiteCredentialSecretKind,
  SiteCredentialVaultEntry,
  storeSiteCredentialVault,
  testWordPressConnection,
  testShopifyConnection,
  testStripeConnection,
  testGitHubConnection,
  testCloudflareConnection,
  checkHaveIBeenPwned,
  type HaveIBeenPwnedResult,
  type PlatformConnectionResult,
  updateSiteCredentialVaultControls,
} from '../../lib/siteAutomation';
import {
  analyzeVaultEntrySecurity,
  buildVaultSecurityReport,
  getVaultAccessGrants,
  hardenVaultCredential,
  isVaultAccessGrantExpired,
  pruneExpiredVaultAccessGrants,
} from '../../lib/vaultAgentAccess';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';

interface Props {
  circleId: string;
  accentColor: string;
  fullHeight?: boolean;
}

type RiskFilter = 'all' | 'ready' | 'needs_test' | 'rotation_due' | 'inactive' | 'security_risk';

interface PlatformPreset {
  key: string;
  label: string;
  loginPath: string;
  secretKind: SiteCredentialSecretKind;
  actions: string[];
  notes: string;
}

const SECRET_KINDS: Array<{ value: SiteCredentialSecretKind; label: string }> = [
  { value: 'password', label: 'Password' },
  { value: 'application_password', label: 'App password' },
  { value: 'api_token', label: 'API token' },
  { value: 'oauth_token', label: 'OAuth token' },
  { value: 'session_cookie', label: 'Session cookie' },
  { value: 'totp_seed', label: 'TOTP seed' },
];

const PLATFORM_PRESETS: PlatformPreset[] = [
  {
    key: 'wordpress',
    label: 'WordPress',
    loginPath: '/wp-login.php',
    secretKind: 'application_password',
    actions: ['login', 'post', 'edit', 'upload'],
    notes: 'Best path: WordPress application password for REST publishing, browser login only when admin UI edits are required.',
  },
  {
    key: 'shopify',
    label: 'Shopify',
    loginPath: '/admin',
    secretKind: 'password',
    actions: ['login', 'post', 'edit'],
    notes: 'Use a staff account with the minimum permissions needed for products, pages, or orders.',
  },
  {
    key: 'webflow',
    label: 'Webflow',
    loginPath: 'https://webflow.com/dashboard',
    secretKind: 'api_token',
    actions: ['login', 'post', 'edit'],
    notes: 'Prefer API tokens for CMS item work; browser login is only for designer/admin tasks.',
  },
  {
    key: 'squarespace',
    label: 'Squarespace',
    loginPath: '/config',
    secretKind: 'password',
    actions: ['login', 'post', 'edit'],
    notes: 'Use a dedicated contributor login so publishing actions are auditable.',
  },
  {
    key: 'wix',
    label: 'Wix',
    loginPath: 'https://manage.wix.com',
    secretKind: 'password',
    actions: ['login', 'post', 'edit'],
    notes: 'Keep 2FA recovery and manual approval enabled for site settings changes.',
  },
  {
    key: 'custom',
    label: 'Custom',
    loginPath: '',
    secretKind: 'password',
    actions: ['login', 'edit'],
    notes: 'Add the exact login URL and allowed origin before giving an agent access.',
  },
];

const ACTION_OPTIONS = [
  { key: 'login', label: 'Login' },
  { key: 'post', label: 'Post' },
  { key: 'edit', label: 'Edit' },
  { key: 'upload', label: 'Upload' },
  { key: 'settings', label: 'Settings' },
  { key: 'billing', label: 'Billing' },
];

const REVEAL_OPTIONS = [15, 30, 60, 120];
const ROTATION_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: 'Off', days: null },
  { label: '30d', days: 30 },
  { label: '60d', days: 60 },
  { label: '90d', days: 90 },
  { label: '180d', days: 180 },
];

const PASSWORD_CHAR_GROUPS = [
  'ABCDEFGHJKLMNPQRSTUVWXYZ',
  'abcdefghijkmnopqrstuvwxyz',
  '23456789',
  '!@#$%^&*_-+=?',
];
const PASSWORD_CHARS = PASSWORD_CHAR_GROUPS.join('');

function webCursor(cursor: string = 'pointer') {
  return Platform.OS === 'web' ? ({ cursor } as any) : null;
}

function webTransition(properties: string = 'background-color, box-shadow, transform') {
  return Platform.OS === 'web' ? ({ transition: `${properties} 0.18s ease` } as any) : null;
}

function accordionHoverStyle(accent: string) {
  return Platform.select({
    web: {
      backgroundColor: '#121a2c',
      boxShadow: `inset 0 0 0 1px ${accent}66, 0 8px 24px ${accent}1f`,
    } as any,
    default: { backgroundColor: '#121a2c' },
  });
}

function accordionPressedStyle(accent: string) {
  return Platform.select({
    web: {
      backgroundColor: '#0a1322',
      boxShadow: `inset 0 0 0 1px ${accent}aa`,
      transform: [{ scale: 0.997 }],
    } as any,
    default: { backgroundColor: '#0a1322' },
  });
}

function accordionExpandedStyle(accent: string) {
  return Platform.select({
    web: {
      backgroundColor: '#101828',
      boxShadow: `inset 0 -1px 0 ${accent}33`,
    } as any,
    default: { backgroundColor: '#101828' },
  });
}

function AccordionChevron({ open, accent }: { open: boolean; accent: string }) {
  return (
    <View
      style={[
        accordionChevronWrapStyle,
        webTransition('transform, color'),
        { transform: [{ rotate: open ? '90deg' : '0deg' }] },
      ]}
    >
      <Text style={[accordionChevronTextStyle, { color: accent }]}>›</Text>
    </View>
  );
}

const accordionChevronWrapStyle = {
  width: 24,
  height: 24,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

const accordionChevronTextStyle = {
  fontSize: 22,
  fontWeight: '900' as const,
  lineHeight: 22,
};

function formatDate(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
}

function formatAuditTime(value?: string | null): string {
  if (!value) return '—';
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return '—';
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

function secureRandomIndex(maxExclusive: number): number {
  const cryptoObj = (globalThis as any).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('Secure random generator unavailable in this browser.');
  }
  const bucket = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  do {
    cryptoObj.getRandomValues(bucket);
  } while (bucket[0] >= limit);
  return bucket[0] % maxExclusive;
}

function securePick(chars: string): string {
  return chars[secureRandomIndex(chars.length)];
}

function secureShuffle(chars: string[]): string[] {
  const next = chars.slice();
  for (let i = next.length - 1; i > 0; i--) {
    const j = secureRandomIndex(i + 1);
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

function generateVaultPassword(length: number = 32): string {
  const safeLength = Math.max(length, PASSWORD_CHAR_GROUPS.length + 8);
  const chars = PASSWORD_CHAR_GROUPS.map(securePick);
  while (chars.length < safeLength) {
    chars.push(securePick(PASSWORD_CHARS));
  }
  return secureShuffle(chars).join('');
}

function scoreSecretStrength(value: string): { score: number; label: string; color: string } {
  if (!value) return { score: 0, label: 'Empty', color: '#475569' };
  let score = Math.min(4, Math.floor(value.length / 6));
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  score = Math.max(1, Math.min(5, score));
  if (score <= 2) return { score, label: 'Weak', color: '#ef4444' };
  if (score === 3) return { score, label: 'Good', color: '#f59e0b' };
  if (score === 4) return { score, label: 'Strong', color: '#22c55e' };
  return { score, label: 'Excellent', color: '#14b8a6' };
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`;
  } catch {
    return withProtocol.replace(/\/+$/, '');
  }
}

function presetForPlatform(platform: string): PlatformPreset {
  const normalized = platform.trim().toLowerCase();
  return PLATFORM_PRESETS.find((preset) => preset.key === normalized) || PLATFORM_PRESETS[PLATFORM_PRESETS.length - 1];
}

function inferLoginUrl(platform: string, siteUrl: string): string {
  const preset = presetForPlatform(platform);
  const path = preset.loginPath;
  if (/^https?:\/\//i.test(path)) return path;
  const base = normalizeBaseUrl(siteUrl);
  if (!base) return '';
  return path ? `${base}${path}` : base;
}

function hostnameFromUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProtocol).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function buildAllowedOrigins(siteUrl: string, loginUrl: string): string[] {
  const origins = new Set<string>();
  for (const value of [siteUrl, loginUrl]) {
    const base = normalizeBaseUrl(value);
    if (base) origins.add(base);
  }
  return Array.from(origins);
}

function isRotationDue(entry: SiteCredentialVaultEntry): boolean {
  if (!entry.rotationDueAt) return false;
  const due = new Date(entry.rotationDueAt).getTime();
  return Number.isFinite(due) && due <= Date.now();
}

function entryMetadataString(entry: SiteCredentialVaultEntry, key: string): string {
  const value = entry.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

function entryMetadataBoolean(entry: SiteCredentialVaultEntry, key: string): boolean | null {
  const value = entry.metadata?.[key];
  return typeof value === 'boolean' ? value : null;
}

function entryTags(entry: SiteCredentialVaultEntry): string[] {
  const meta = (entry.metadata || {}) as Record<string, unknown>;
  const raw = meta.tags;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const cleaned = value.trim().toLowerCase();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function parseTagInput(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, ''))
    .filter(Boolean);
}

function entryAllowedActions(entry: SiteCredentialVaultEntry): string[] {
  const raw = entry.accessPolicy?.allowed_actions;
  if (!Array.isArray(raw)) return ['login'];
  return raw.map(String).filter(Boolean);
}

function entryAllowedOrigins(entry: SiteCredentialVaultEntry): string[] {
  const raw = entry.accessPolicy?.allowed_origins;
  if (!Array.isArray(raw)) return buildAllowedOrigins(entry.siteUrl || '', entry.loginUrl || '');
  return raw.map(String).filter(Boolean);
}

function dueDateFromCadence(days: number | null): string | null {
  if (!days) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function siteUrlFromEntry(entry: SiteCredentialVaultEntry): string {
  return entry.siteUrl || entry.loginUrl || '';
}

function buildAgentRunbook(entry: SiteCredentialVaultEntry): string {
  const actions = entryAllowedActions(entry).join(', ') || 'login';
  const origins = entryAllowedOrigins(entry).join(', ') || 'not set';
  return [
    `Credential: ${entry.platform}/${entry.label}`,
    `Site: ${entry.siteUrl || 'not set'}`,
    `Login: ${entry.loginUrl || entry.siteUrl || 'not set'}`,
    `Username: ${entry.username || 'not set'}`,
    `Allowed actions: ${actions}`,
    `Allowed origins: ${origins}`,
    `Approval required: ${entry.accessPolicy?.require_approval === false ? 'no' : 'yes'}`,
    `Agent instruction: Use the saved vault credential only through the approved login tool. Never ask the user to paste the secret into chat.`,
  ].join('\n');
}

function automationReadiness(entry: SiteCredentialVaultEntry): { score: number; label: string; color: string; issues: string[] } {
  const issues: string[] = [];
  if (!entry.isActive) issues.push('Inactive');
  if (!entry.loginUrl && !entry.siteUrl) issues.push('Missing login URL');
  if (!entry.username) issues.push('Missing username');
  if (entryAllowedOrigins(entry).length === 0) issues.push('No allowed origin');
  if (!entryAllowedActions(entry).includes('login')) issues.push('Login not allowed');
  if (isRotationDue(entry)) issues.push('Rotation due');
  const lastTested = entryMetadataString(entry, 'lastTestedAt');
  const lastTestSuccess = entryMetadataBoolean(entry, 'lastTestSuccess');
  if (!lastTested) issues.push('Not tested');
  if (lastTested && lastTestSuccess === false) issues.push('Last test failed');
  if (entryMetadataBoolean(entry, 'breachFound') === true) issues.push('Found in breach corpora');

  const score = Math.max(0, 100 - issues.length * 14);
  if (score >= 86) return { score, label: 'Ready', color: '#22c55e', issues };
  if (score >= 60) return { score, label: 'Needs review', color: '#f59e0b', issues };
  return { score, label: 'Blocked', color: '#ef4444', issues };
}

export default function SiteCredentialVaultPanel({ circleId, accentColor, fullHeight = false }: Props) {
  const { user } = useAuth();
  const currentUserId = user?.id || null;
  const [vaultUnlocked, setVaultUnlocked] = useState(false);
  const [vaultOpening, setVaultOpening] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const doorProgress = useRef(new Animated.Value(0)).current;
  const lockShake = useRef(new Animated.Value(0)).current;
  // Red ACCESS DENIED pulse on a failed unlock (runs alongside the shake).
  const denyFlash = useRef(new Animated.Value(0)).current;
  // Carries the end-of-open flash ACROSS the lock→dashboard mount so the
  // reveal reads as "light floods in", not a hard component swap.
  const revealFlash = useRef(new Animated.Value(0)).current;
  const [revealing, setRevealing] = useState(false);
  const [entries, setEntries] = useState<SiteCredentialVaultEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [revealed, setRevealed] = useState<Record<string, { secret: string; expiresAt: number }>>({});
  const [auditEntries, setAuditEntries] = useState<Record<string, SiteCredentialAuditEntry[]>>({});
  const [auditLoading, setAuditLoading] = useState<Record<string, boolean>>({});
  const [auditErrors, setAuditErrors] = useState<Record<string, string>>({});
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [rotationOnly, setRotationOnly] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [securityOpen, setSecurityOpen] = useState(false);
  // Single gate for everything that is not day-to-day credential work
  // (security posture, CSV import, activity log, vault facts).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Per-entry counterpart: which credential has its settings/audit fold open.
  const [entrySettingsOpenId, setEntrySettingsOpenId] = useState<string | null>(null);

  const [platform, setPlatform] = useState('wordpress');
  const [label, setLabel] = useState('default');
  const [siteUrl, setSiteUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [secretKind, setSecretKind] = useState<SiteCredentialSecretKind>('application_password');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [allowedActions, setAllowedActions] = useState<string[]>(['login', 'post', 'edit', 'upload']);
  const [notes, setNotes] = useState(PLATFORM_PRESETS[0].notes);
  const [revealDurationSeconds, setRevealDurationSeconds] = useState(30);
  const [rotationCadenceDays, setRotationCadenceDays] = useState<number | null>(90);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const activeRevealCount = useMemo(
    () => Object.values(revealed).filter((item) => item.expiresAt > Date.now()).length,
    [revealed],
  );
  const secretStrength = useMemo(() => scoreSecretStrength(secret), [secret]);
  const [breachState, setBreachState] = useState<{
    status: 'idle' | 'checking' | 'safe' | 'breached' | 'error';
    count: number;
    error?: string;
  }>({ status: 'idle', count: 0 });

  useEffect(() => {
    if (!secret || secret.length < 4) {
      setBreachState({ status: 'idle', count: 0 });
      return;
    }
    let cancelled = false;
    setBreachState((prev) => ({ ...prev, status: 'checking' }));
    const handle = setTimeout(async () => {
      const result: HaveIBeenPwnedResult = await checkHaveIBeenPwned(secret);
      if (cancelled) return;
      if (result.error) {
        setBreachState({ status: 'error', count: 0, error: result.error });
      } else if (result.breached) {
        setBreachState({ status: 'breached', count: result.count });
      } else {
        setBreachState({ status: 'safe', count: 0 });
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [secret]);
  const readinessStats = useMemo(() => {
    const ready = entries.filter((entry) => automationReadiness(entry).label === 'Ready').length;
    const needsTest = entries.filter((entry) => !entryMetadataString(entry, 'lastTestedAt') || entryMetadataBoolean(entry, 'lastTestSuccess') === false).length;
    const rotationDue = entries.filter(isRotationDue).length;
    const inactive = entries.filter((entry) => !entry.isActive).length;
    return { ready, needsTest, rotationDue, inactive };
  }, [entries]);
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entryTags(entry)) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entries]);

  const [members, setMembers] = useState<Array<{ user_id: string; display_name: string; username: string }>>([]);
  const loadMembers = useCallback(async () => {
    if (!vaultUnlocked) return;
    const { data } = await supabase
      .from('circle_members')
      .select('user_id, profiles!user_id(display_name, username)')
      .eq('circle_id', circleId);
    if (Array.isArray(data)) {
      setMembers(
        data.map((row: any) => ({
          user_id: row.user_id,
          display_name: row.profiles?.display_name || row.profiles?.username || 'Member',
          username: row.profiles?.username || '',
        })),
      );
    }
  }, [circleId, vaultUnlocked]);
  useEffect(() => {
    if (vaultUnlocked) loadMembers();
  }, [loadMembers, vaultUnlocked]);

  const allowedMemberIds = (entry: SiteCredentialVaultEntry): string[] => {
    const meta = (entry.metadata || {}) as Record<string, unknown>;
    const raw = meta.allowedMemberIds;
    if (!Array.isArray(raw)) return [];
    return raw.filter((value): value is string => typeof value === 'string');
  };

  const isVisibleToCurrentUser = (entry: SiteCredentialVaultEntry): boolean => {
    const list = allowedMemberIds(entry);
    if (list.length === 0) return true;
    if (!currentUserId) return false;
    if (entry.createdBy === currentUserId) return true;
    return list.includes(currentUserId);
  };

  const userVisibleEntries = useMemo(
    () => entries.filter((entry) => isVisibleToCurrentUser(entry)),
    [entries, currentUserId],
  );

  const securityReport = useMemo(
    () => buildVaultSecurityReport(userVisibleEntries),
    [userVisibleEntries],
  );

  const securityIssuesByCredential = useMemo(() => {
    const map = new Map<string, ReturnType<typeof analyzeVaultEntrySecurity>>();
    for (const entry of userVisibleEntries) {
      map.set(entry.id, analyzeVaultEntrySecurity(entry));
    }
    return map;
  }, [userVisibleEntries]);

  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return userVisibleEntries.filter((entry) => {
      const readiness = automationReadiness(entry);
      if (rotationOnly && !isRotationDue(entry)) return false;
      if (riskFilter === 'ready' && readiness.label !== 'Ready') return false;
      if (riskFilter === 'needs_test' && entryMetadataString(entry, 'lastTestedAt') && entryMetadataBoolean(entry, 'lastTestSuccess') !== false) return false;
      if (riskFilter === 'rotation_due' && !isRotationDue(entry)) return false;
      if (riskFilter === 'inactive' && entry.isActive) return false;
      if (riskFilter === 'security_risk' && !(securityIssuesByCredential.get(entry.id) || []).some((issue) => issue.severity === 'critical' || issue.severity === 'high')) return false;
      if (tagFilter && !entryTags(entry).includes(tagFilter)) return false;
      if (!q) return true;
      return [
        entry.platform,
        entry.label,
        entry.siteUrl || '',
        entry.loginUrl || '',
        entry.username || '',
        entry.secretKind,
        entryAllowedActions(entry).join(' '),
        entryTags(entry).join(' '),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [query, riskFilter, rotationOnly, securityIssuesByCredential, tagFilter, userVisibleEntries]);

  const loadVault = useCallback(async () => {
    if (!vaultUnlocked) return;
    setLoading(true);
    const result = await listSiteCredentialVault(circleId);
    if (result.error) {
      setStatus(result.vaultMissing
        ? 'Vault migration is not deployed yet.'
        : result.error);
    } else {
      setEntries(result.entries);
      setStatus('');
    }
    setLoading(false);
  }, [circleId, vaultUnlocked]);

  const loadAudit = useCallback(async (credentialId: string) => {
    if (!vaultUnlocked) return;
    setAuditLoading((current) => ({ ...current, [credentialId]: true }));
    const result = await listSiteCredentialVaultAudit(circleId, credentialId, 20);
    if (!result.error) {
      setAuditEntries((current) => ({ ...current, [credentialId]: result.entries }));
      setAuditErrors((current) => {
        const next = { ...current };
        delete next[credentialId];
        return next;
      });
    } else {
      setAuditErrors((current) => ({
        ...current,
        [credentialId]: result.vaultMissing
          ? 'Audit RPC is missing. Run the latest vault migration.'
          : result.error || 'Could not load audit trail.',
      }));
    }
    setAuditLoading((current) => ({ ...current, [credentialId]: false }));
  }, [circleId, vaultUnlocked]);

  const [globalAuditOpen, setGlobalAuditOpen] = useState(false);
  const [globalAuditLoading, setGlobalAuditLoading] = useState(false);
  const [globalAuditError, setGlobalAuditError] = useState<string>('');
  const [globalAuditEntries, setGlobalAuditEntries] = useState<SiteCredentialAuditEntry[]>([]);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importParseResult, setImportParseResult] = useState<import('../../lib/vaultImport').VaultImportParseResult | null>(null);
  const [importSelected, setImportSelected] = useState<Set<number>>(() => new Set());
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState('');

  const [totpCodes, setTotpCodes] = useState<Record<string, { code: string; remainingSeconds: number; period: number; error?: string }>>({});

  const [confirmReveal, setConfirmReveal] = useState<{ entryId: string; input: string } | null>(null);
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());
  const selectVisible = () => {
    setSelectedIds(new Set(visibleEntries.map((entry) => entry.id)));
  };

  const loadGlobalAudit = useCallback(async () => {
    if (!vaultUnlocked) return;
    setGlobalAuditLoading(true);
    setGlobalAuditError('');
    const result = await listSiteCredentialVaultAudit(circleId, null, 50);
    if (result.error) {
      setGlobalAuditError(
        result.vaultMissing
          ? 'Audit RPC is missing. Run the latest vault migration.'
          : result.error,
      );
      setGlobalAuditEntries([]);
    } else {
      setGlobalAuditEntries(result.entries);
    }
    setGlobalAuditLoading(false);
  }, [circleId, vaultUnlocked]);

  useEffect(() => {
    if (vaultUnlocked && globalAuditOpen) loadGlobalAudit();
  }, [globalAuditOpen, loadGlobalAudit, vaultUnlocked]);

  useEffect(() => {
    if (vaultUnlocked) loadVault();
  }, [loadVault, vaultUnlocked]);

  useEffect(() => {
    if (!vaultUnlocked) return;
    if (!expandedId || expandedId === 'new') return;
    loadAudit(expandedId);
  }, [expandedId, loadAudit, vaultUnlocked]);

  useEffect(() => {
    if (activeRevealCount === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setRevealed((current) => Object.fromEntries(
        Object.entries(current).filter(([, item]) => item.expiresAt > now),
      ));
    }, 1000);
    return () => clearInterval(timer);
  }, [activeRevealCount]);

  useEffect(() => {
    // Continually refresh TOTP codes for any revealed totp_seed entry until
    // the reveal expires. Clears codes for entries whose seed is no longer
    // in memory.
    const totpEntries = entries.filter((entry) => entry.secretKind === 'totp_seed' && revealed[entry.id]);
    if (totpEntries.length === 0) {
      if (Object.keys(totpCodes).length > 0) setTotpCodes({});
      return;
    }
    let cancelled = false;
    const compute = async () => {
      const { generateTotp } = await import('../../lib/totp');
      const next: typeof totpCodes = {};
      for (const entry of totpEntries) {
        const seed = revealed[entry.id]?.secret;
        if (!seed) continue;
        try {
          const result = await generateTotp(seed);
          if (cancelled) return;
          next[entry.id] = { code: result.code, remainingSeconds: result.remainingSeconds, period: result.period };
        } catch (err: any) {
          if (cancelled) return;
          next[entry.id] = { code: '------', remainingSeconds: 0, period: 30, error: err?.message || 'TOTP error' };
        }
      }
      if (!cancelled) setTotpCodes(next);
    };
    compute();
    const ticker = setInterval(compute, 1000);
    return () => {
      cancelled = true;
      clearInterval(ticker);
    };
  }, [entries, revealed]);

  const resetForm = () => {
    setPlatform('wordpress');
    setLabel('default');
    setSiteUrl('');
    setLoginUrl('');
    setUsername('');
    setSecret('');
    setSecretKind('application_password');
    setRequiresApproval(true);
    setAllowedActions(['login', 'post', 'edit', 'upload']);
    setNotes(PLATFORM_PRESETS[0].notes);
    setRevealDurationSeconds(30);
    setRotationCadenceDays(90);
    setTags([]);
    setTagInput('');
  };

  const addTag = (value: string) => {
    const cleaned = parseTagInput(value);
    if (cleaned.length === 0) return;
    setTags((current) => {
      const next = [...current];
      for (const tag of cleaned) {
        if (!next.includes(tag)) next.push(tag);
      }
      return next.slice(0, 8);
    });
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags((current) => current.filter((value) => value !== tag));
  };

  const applyPreset = (preset: PlatformPreset) => {
    setPlatform(preset.key);
    setSecretKind(preset.secretKind);
    setAllowedActions(preset.actions);
    setNotes(preset.notes);
    if (siteUrl.trim() || /^https?:\/\//i.test(preset.loginPath)) {
      setLoginUrl(inferLoginUrl(preset.key, siteUrl));
    }
  };

  const handleGeneratePassword = () => {
    try {
      setSecret(generateVaultPassword());
      setSecretKind('password');
      setStatus('Generated a secure password. Save to rotate the credential.');
    } catch (err: any) {
      setStatus(err?.message || 'Could not generate a secure password.');
    }
  };

  const handleInferLoginUrl = () => {
    const next = inferLoginUrl(platform, siteUrl);
    if (!next) {
      setStatus('Enter a site URL first.');
      return;
    }
    setLoginUrl(next);
  };

  const toggleAllowedAction = (action: string) => {
    setAllowedActions((current) => (
      current.includes(action)
        ? current.filter((item) => item !== action)
        : [...current, action]
    ));
  };

  const replaceEntry = (entry: SiteCredentialVaultEntry) => {
    setEntries((current) => current.map((item) => item.id === entry.id ? entry : item));
  };

  const updateEntryControls = async (
    entry: SiteCredentialVaultEntry,
    patch: {
      accessPolicy?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
      rotationDueAt?: string | null;
      isActive?: boolean;
    },
    successMessage: string,
  ) => {
    setUpdating((current) => ({ ...current, [entry.id]: true }));
    setStatus('');
    const result = await updateSiteCredentialVaultControls({
      credentialId: entry.id,
      accessPolicy: patch.accessPolicy,
      metadata: patch.metadata,
      rotationDueAt: patch.rotationDueAt,
      isActive: patch.isActive,
    });
    if (result.error || !result.entry) {
      setStatus(result.vaultMissing ? 'Vault controls migration is not deployed yet.' : result.error || 'Could not update vault controls.');
    } else {
      replaceEntry(result.entry);
      setStatus(successMessage);
      await loadAudit(entry.id);
    }
    setUpdating((current) => ({ ...current, [entry.id]: false }));
  };

  const handleSave = async () => {
    if (!platform.trim() || !secret) {
      setStatus('Platform and secret are required.');
      return;
    }
    if (!allowedActions.includes('login')) {
      setStatus('Keep Login enabled so agents can authenticate safely.');
      return;
    }

    setSaving(true);
    setStatus('');
    const resolvedLoginUrl = loginUrl.trim() || inferLoginUrl(platform, siteUrl);
    const finalBreach = await checkHaveIBeenPwned(secret);
    const result = await storeSiteCredentialVault({
      circleId,
      platform,
      siteUrl,
      loginUrl: resolvedLoginUrl,
      username,
      secret,
      label,
      secretKind,
      accessPolicy: {
        require_approval: requiresApproval,
        allowed_origins: buildAllowedOrigins(siteUrl, resolvedLoginUrl),
        allowed_actions: allowedActions,
        reveal_duration_seconds: revealDurationSeconds,
      },
      metadata: {
        source: 'office_vault',
        savedAt: new Date().toISOString(),
        notes: notes.trim(),
        platformPreset: presetForPlatform(platform).key,
        breachCheckedAt: new Date().toISOString(),
        breachFound: finalBreach.error ? null : finalBreach.breached,
        breachCount: finalBreach.error ? null : finalBreach.count,
        breachCheckError: finalBreach.error || null,
        tags: tags.slice(0, 8),
      },
      rotationDueAt: dueDateFromCadence(rotationCadenceDays),
    });

    if (result.error) {
      setStatus(result.error);
    } else {
      resetForm();
      setExpandedId(result.entry?.id || null);
      const breachNote = finalBreach.breached
        ? ` Warning: secret found in ${finalBreach.count.toLocaleString()} known breach record${finalBreach.count === 1 ? '' : 's'} — consider rotating.`
        : '';
      setStatus(`Credential saved.${breachNote}`);
      await loadVault();
      if (result.entry?.id) await loadAudit(result.entry.id);
    }
    setSaving(false);
  };

  const handleRotateFromEntry = (entry: SiteCredentialVaultEntry) => {
    setPlatform(entry.platform);
    setLabel(entry.label);
    setSiteUrl(entry.siteUrl || '');
    setLoginUrl(entry.loginUrl || '');
    setUsername(entry.username || '');
    setSecret('');
    setSecretKind(entry.secretKind);
    setRequiresApproval(entry.accessPolicy?.require_approval !== false);
    setAllowedActions(entryAllowedActions(entry));
    setRevealDurationSeconds(typeof entry.accessPolicy?.reveal_duration_seconds === 'number' ? entry.accessPolicy.reveal_duration_seconds : 30);
    setRotationCadenceDays(null);
    setNotes(entryMetadataString(entry, 'notes') || presetForPlatform(entry.platform).notes);
    setTags(entryTags(entry));
    setTagInput('');
    setExpandedId('new');
    setStatus(`Rotating ${entry.platform}/${entry.label}. Enter the new secret and save.`);
  };

  const isHighTrust = (entry: SiteCredentialVaultEntry): boolean => {
    return entryMetadataBoolean(entry, 'highTrust') === true;
  };

  const performReveal = async (entry: SiteCredentialVaultEntry, purpose: string) => {
    const duration = typeof entry.accessPolicy?.reveal_duration_seconds === 'number'
      ? Math.max(15, Math.min(300, entry.accessPolicy.reveal_duration_seconds))
      : 30;
    const result = await revealSiteCredentialSecret(entry.id, purpose);
    if (result.error || !result.result) {
      setStatus(result.error || 'Could not reveal secret.');
      return;
    }
    setRevealed((current) => ({
      ...current,
      [entry.id]: {
        secret: result.result!.secret,
        expiresAt: Date.now() + duration * 1000,
      },
    }));
    replaceEntry(result.result.entry);
    await loadAudit(entry.id);
  };

  const handleReveal = async (entry: SiteCredentialVaultEntry) => {
    setStatus('');
    if (isHighTrust(entry)) {
      setConfirmReveal({ entryId: entry.id, input: '' });
      return;
    }
    await performReveal(entry, 'office_vault_reveal');
  };

  const cancelConfirmReveal = () => setConfirmReveal(null);

  const submitConfirmReveal = async () => {
    if (!confirmReveal) return;
    const entry = entries.find((item) => item.id === confirmReveal.entryId);
    if (!entry) {
      setConfirmReveal(null);
      setStatus('Credential is no longer available.');
      return;
    }
    const expected = `${entry.platform}/${entry.label}`.toLowerCase();
    if (confirmReveal.input.trim().toLowerCase() !== expected) {
      setStatus(`Confirmation did not match — type "${expected}" exactly to reveal.`);
      return;
    }
    setConfirmReveal(null);
    await performReveal(entry, 'office_vault_reveal_high_trust_confirmed');
  };

  const handleCopyUsername = async (entry: SiteCredentialVaultEntry) => {
    if (!entry.username) return;
    const copied = await copyText(entry.username).catch(() => false);
    setStatus(copied ? 'Username copied.' : 'Copy is only available in the web app.');
  };

  const handleCopySecret = async (entry: SiteCredentialVaultEntry) => {
    const value = revealed[entry.id]?.secret;
    if (!value) return;
    const copied = await copyText(value).catch(() => false);
    setStatus(copied ? 'Secret copied. It will clear from screen shortly.' : 'Copy is only available in the web app.');
  };

  const handleCopyRunbook = async (entry: SiteCredentialVaultEntry) => {
    const copied = await copyText(buildAgentRunbook(entry)).catch(() => false);
    setStatus(copied ? 'Agent runbook copied.' : 'Copy is only available in the web app.');
  };

  const handleCopyTotp = async (entry: SiteCredentialVaultEntry) => {
    const code = totpCodes[entry.id]?.code;
    if (!code) return;
    const copied = await copyText(code).catch(() => false);
    setStatus(copied ? 'TOTP code copied.' : 'Copy is only available in the web app.');
  };

  const handleOpenLogin = (entry: SiteCredentialVaultEntry) => {
    const target = entry.loginUrl || entry.siteUrl;
    if (!target) {
      setStatus('No login URL saved.');
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    setStatus(target);
  };

  const handleTest = async (entry: SiteCredentialVaultEntry) => {
    // Per-platform probes — each platform has a cheap auth-only
    // endpoint that confirms the credential works without taking any
    // destructive action. WordPress, Shopify, Stripe, GitHub,
    // Cloudflare have first-class probes; everything else records
    // "needs manual test" so the readiness score still updates.
    const platform = (entry.platform || '').toLowerCase();
    const supportedPlatforms = ['wordpress', 'shopify', 'stripe', 'github', 'cloudflare'];
    if (!supportedPlatforms.includes(platform)) {
      await updateEntryControls(entry, {
        metadata: {
          lastTestedAt: new Date().toISOString(),
          lastTestSuccess: false,
          lastTestMessage: 'Automated test not yet wired for this platform — record a manual verification in your runbook.',
        },
      }, `Recorded that ${entry.platform} needs a manual test.`);
      return;
    }
    if (platform === 'wordpress' && (!entry.username || !siteUrlFromEntry(entry))) {
      setStatus('WordPress test needs a saved site URL and username.');
      return;
    }
    if (platform === 'shopify' && !siteUrlFromEntry(entry)) {
      setStatus('Shopify test needs a saved shop URL (e.g. mystore.myshopify.com).');
      return;
    }

    setTesting((current) => ({ ...current, [entry.id]: true }));
    setStatus('');
    const secretResult = await revealSiteCredentialSecret(entry.id, 'vault_connection_test');
    if (secretResult.error || !secretResult.result?.secret) {
      setStatus(secretResult.error || 'Could not retrieve credential for test.');
      setTesting((current) => ({ ...current, [entry.id]: false }));
      return;
    }

    const secret = secretResult.result.secret;
    const siteUrl = siteUrlFromEntry(entry);
    let connection: PlatformConnectionResult & { siteName?: string };
    if (platform === 'wordpress') {
      const wp = await testWordPressConnection(siteUrl, entry.username || '', secret);
      connection = { connected: wp.connected, identity: wp.siteName, error: wp.error, siteName: wp.siteName };
    } else if (platform === 'shopify') {
      connection = await testShopifyConnection(siteUrl, secret);
    } else if (platform === 'stripe') {
      connection = await testStripeConnection(secret);
    } else if (platform === 'github') {
      connection = await testGitHubConnection(secret);
    } else {
      // cloudflare
      connection = await testCloudflareConnection(secret);
    }

    const platformLabel = entry.platform.charAt(0).toUpperCase() + entry.platform.slice(1);
    const successMessage = connection.identity
      ? `Connected to ${platformLabel}: ${connection.identity}`
      : `${platformLabel} credential verified.`;
    const record = await recordSiteCredentialVaultTestResult(
      entry.id,
      connection.connected,
      connection.connected ? successMessage : connection.error || 'Connection failed.',
      {
        platform: entry.platform,
        identity: connection.identity || null,
        // Keep the legacy field for WordPress entries
        siteName: (connection as any).siteName || null,
        testedFrom: 'office_vault',
      },
    );
    if (record.entry) replaceEntry(record.entry);
    setStatus(connection.connected ? successMessage : connection.error || record.error || 'Connection test failed.');
    await loadAudit(entry.id);
    setTesting((current) => ({ ...current, [entry.id]: false }));
  };

  const handleDelete = async (entry: SiteCredentialVaultEntry) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const ok = window.confirm(`Remove ${entry.platform}/${entry.label} from the vault?`);
      if (!ok) return;
    }

    const result = await deleteSiteCredentialVault(entry.id);
    if (!result.success) {
      setStatus(result.error || 'Delete failed.');
      return;
    }

    setRevealed((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setAuditEntries((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setAuditErrors((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    setStatus('Credential removed.');
  };

  const runBulkEntries = async (
    label: string,
    targetEntries: SiteCredentialVaultEntry[],
    operate: (entry: SiteCredentialVaultEntry) => Promise<{ ok: boolean; reason?: string }>,
  ) => {
    if (targetEntries.length === 0) return;
    setBulkBusy(true);
    setStatus('');
    let successes = 0;
    const failures: string[] = [];
    for (const entry of targetEntries) {
      try {
        const result = await operate(entry);
        if (result.ok) successes++;
        else failures.push(`${entry.platform}/${entry.label}: ${result.reason || 'failed'}`);
      } catch (err: any) {
        failures.push(`${entry.platform}/${entry.label}: ${err?.message || 'unknown error'}`);
      }
    }
    await loadVault();
    clearSelection();
    setBulkBusy(false);
    if (failures.length === 0) {
      setStatus(`${label} succeeded for ${successes} credential${successes === 1 ? '' : 's'}.`);
    } else {
      setStatus(`${label} done. ${successes} succeeded, ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`);
    }
  };

  const runBulk = async (
    label: string,
    operate: (entry: SiteCredentialVaultEntry) => Promise<{ ok: boolean; reason?: string }>,
  ) => {
    const ids = Array.from(selectedIds);
    const targets = ids.map((id) => entries.find((item) => item.id === id)).filter(Boolean) as SiteCredentialVaultEntry[];
    await runBulkEntries(label, targets, operate);
  };

  const handleBulkDisable = () =>
    runBulk('Disable', async (entry) => {
      if (!entry.isActive) return { ok: true };
      const result = await updateSiteCredentialVaultControls({ credentialId: entry.id, isActive: false });
      return { ok: !result.error, reason: result.error };
    });

  const handleBulkEnable = () =>
    runBulk('Enable', async (entry) => {
      if (entry.isActive) return { ok: true };
      const result = await updateSiteCredentialVaultControls({ credentialId: entry.id, isActive: true });
      return { ok: !result.error, reason: result.error };
    });

  const handleBulkMarkRotation = () =>
    runBulk('Mark rotation due', async (entry) => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const result = await updateSiteCredentialVaultControls({ credentialId: entry.id, rotationDueAt: yesterday });
      return { ok: !result.error, reason: result.error };
    });

  const handleBulkHarden = () =>
    runBulk('Harden', async (entry) => {
      const result = await hardenVaultCredential(circleId, entry, currentUserId);
      return { ok: result.ok, reason: result.ok ? undefined : result.resultsText };
    });

  const handleBulkPruneExpiredGrants = () =>
    runBulk('Remove expired grants', async (entry) => {
      const result = await pruneExpiredVaultAccessGrants(circleId, entry, currentUserId);
      return { ok: result.ok, reason: result.ok ? undefined : result.resultsText };
    });

  const handleHardenHighRisk = async () => {
    const highRiskIds = new Set(
      securityReport.issues
        .filter((issue) => issue.severity === 'critical' || issue.severity === 'high')
        .map((issue) => issue.credentialId),
    );
    const targets = userVisibleEntries.filter((entry) => highRiskIds.has(entry.id));
    if (targets.length === 0) {
      setStatus('No high-risk credentials need hardening.');
      return;
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const ok = window.confirm(`Harden ${targets.length} high-risk credential${targets.length === 1 ? '' : 's'}? This turns approval on, caps reveal windows, scopes origins, removes expired grants, and enables high-trust where needed.`);
      if (!ok) return;
    }
    await runBulkEntries('Harden high-risk', targets, async (entry) => {
      const result = await hardenVaultCredential(circleId, entry, currentUserId);
      return { ok: result.ok, reason: result.ok ? undefined : result.resultsText };
    });
  };

  const handlePruneAllExpiredGrants = async () => {
    const targets = userVisibleEntries.filter((entry) =>
      getVaultAccessGrants(entry).some((grant) => isVaultAccessGrantExpired(grant)),
    );
    if (targets.length === 0) {
      setStatus('No expired grants to remove.');
      return;
    }
    await runBulkEntries('Remove expired grants', targets, async (entry) => {
      const result = await pruneExpiredVaultAccessGrants(circleId, entry, currentUserId);
      return { ok: result.ok, reason: result.ok ? undefined : result.resultsText };
    });
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const ok = window.confirm(`Permanently remove ${count} credential${count === 1 ? '' : 's'} from the vault?`);
      if (!ok) return;
    }
    await runBulk('Delete', async (entry) => {
      const result = await deleteSiteCredentialVault(entry.id);
      return { ok: result.success, reason: result.error };
    });
  };

  const handleImportFile = async (file: File) => {
    setImportStatus('');
    setImportBusy(true);
    try {
      const text = await file.text();
      const { parseVaultCsv } = await import('../../lib/vaultImport');
      const parsed = parseVaultCsv(text);
      setImportParseResult(parsed);
      // Pre-select every complete row by default.
      setImportSelected(new Set(parsed.rows.filter((r) => r.isComplete).map((r) => r.index)));
      const formatLabel = parsed.format === 'unknown' ? 'unknown format' : parsed.format;
      setImportStatus(
        `Detected ${formatLabel} with ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}. Review below and import.`,
      );
    } catch (err: any) {
      setImportStatus(err?.message || 'Could not parse CSV file.');
      setImportParseResult(null);
    } finally {
      setImportBusy(false);
    }
  };

  const toggleImportSelected = (index: number) => {
    setImportSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const runImport = async () => {
    if (!importParseResult) return;
    const targets = importParseResult.rows.filter((row) => importSelected.has(row.index) && row.isComplete);
    if (targets.length === 0) {
      setImportStatus('Select at least one complete row before importing.');
      return;
    }
    setImportBusy(true);
    setImportStatus(`Importing ${targets.length} credential${targets.length === 1 ? '' : 's'}...`);
    const { buildVaultImportInput } = await import('../../lib/vaultImport');
    let successes = 0;
    const failures: string[] = [];
    for (const row of targets) {
      const input = buildVaultImportInput(row, circleId);
      const result = await storeSiteCredentialVault(input);
      if (result.error) {
        failures.push(`${row.platform}/${row.label}: ${result.error}`);
      } else {
        successes++;
      }
    }
    await loadVault();
    setImportBusy(false);
    if (failures.length === 0) {
      setImportStatus(`Imported ${successes} credential${successes === 1 ? '' : 's'}.`);
      setImportParseResult(null);
      setImportSelected(new Set());
    } else {
      setImportStatus(`Imported ${successes}, ${failures.length} failed: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`);
    }
  };

  const playUnlockFailure = () => {
    lockShake.setValue(0);
    denyFlash.setValue(0);
    Animated.parallel([
      Animated.sequence([
        // Softer than ±10 — the old shake felt cartoonish. ±4 reads as
        // "denied" without making the card look broken.
        Animated.timing(lockShake, { toValue: 4, duration: 42, useNativeDriver: true }),
        Animated.timing(lockShake, { toValue: -4, duration: 42, useNativeDriver: true }),
        Animated.timing(lockShake, { toValue: 3, duration: 42, useNativeDriver: true }),
        Animated.timing(lockShake, { toValue: -3, duration: 42, useNativeDriver: true }),
        Animated.timing(lockShake, { toValue: 0, duration: 58, useNativeDriver: true }),
      ]),
      // Red pulse: snap on, decay slow — reads as the mechanism refusing.
      Animated.sequence([
        Animated.timing(denyFlash, { toValue: 1, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(denyFlash, { toValue: 0, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
    ]).start();
  };

  const handleUnlockVault = async () => {
    const password = unlockPassword;
    if (!password.trim()) {
      setUnlockError('Enter your account password to unlock the vault.');
      playUnlockFailure();
      return;
    }

    setUnlocking(true);
    setUnlockError('');
    const sessionUserEmail = user?.email;
    const email = sessionUserEmail || (await supabase.auth.getUser().catch(() => ({ data: null as any })))?.data?.user?.email;
    if (!email) {
      setUnlocking(false);
      setUnlockPassword('');
      setUnlockError('Could not confirm your signed-in email. Sign in again, then unlock the vault.');
      playUnlockFailure();
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setUnlocking(false);
      setUnlockPassword('');
      setUnlockError(error.message || 'Password check failed.');
      playUnlockFailure();
      return;
    }

    setUnlocking(false);
    setUnlockPassword('');
    setVaultOpening(true);
    doorProgress.setValue(0);
    const reduceMotion = Platform.OS === 'web'
      && typeof window !== 'undefined'
      && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    // Four mechanical phases, each with its own easing (a single eased ramp
    // reads as one motion; a vault opening is a SEQUENCE):
    //   A 0→0.28  wheel     — the combination wheel accelerates
    //   B →0.45   dogs      — eight locking dogs retract toward the hub
    //   C →0.58   seal      — the pressure ring releases and the door settles
    //   D →1      swing     — the circular plate opens on its hinge into light
    const open = reduceMotion
      ? Animated.timing(doorProgress, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true })
      : Animated.sequence([
          Animated.timing(doorProgress, { toValue: 0.28, duration: 560, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
          Animated.timing(doorProgress, { toValue: 0.45, duration: 280, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(doorProgress, { toValue: 0.58, duration: 240, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(doorProgress, { toValue: 1, duration: 640, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
        ]);
    open.start(() => {
      // Mount the dashboard UNDER the flash, then fade the flash out over
      // it — the reveal carries across the component swap instead of
      // hard-cutting from the open vault to a data table.
      if (!reduceMotion) {
        setRevealing(true);
        revealFlash.setValue(1);
      }
      setVaultUnlocked(true);
      setVaultOpening(false);
      if (!reduceMotion) {
        Animated.timing(revealFlash, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => setRevealing(false));
      }
    });
  };

  const handleLockVault = () => {
    setVaultUnlocked(false);
    setVaultOpening(false);
    setRevealing(false);
    revealFlash.setValue(0);
    denyFlash.setValue(0);
    doorProgress.setValue(0);
    setUnlockPassword('');
    setUnlockError('');
    setEntries([]);
    setMembers([]);
    setRevealed({});
    setAuditEntries({});
    setAuditErrors({});
    setGlobalAuditEntries([]);
    setGlobalAuditOpen(false);
    setSelectedIds(new Set());
    setExpandedId(null);
    setSecurityOpen(false);
    setImportOpen(false);
    setStatus('');
  };

  if (!vaultUnlocked) {
    return (
      <VaultLockScreen
        accentColor={accentColor}
        circleId={circleId}
        fullHeight={fullHeight}
        password={unlockPassword}
        error={unlockError}
        unlocking={unlocking}
        opening={vaultOpening}
        doorProgress={doorProgress}
        shake={lockShake}
        denyFlash={denyFlash}
        onPasswordChange={setUnlockPassword}
        onUnlock={handleUnlockVault}
      />
    );
  }

  return (
    <View
      style={[
        styles.root,
        fullHeight ? styles.rootFullHeight : styles.rootPanelHeight,
      ]}
      nativeID="section-site-credential-vault"
    >
      {/* One-line header — trust badges, subtitle, and the serial moved
          into the Advanced accordion; the list is the interface. */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <View style={styles.kickerRow}>
            <Text style={styles.title}>Site Vault</Text>
            <Text style={[styles.lockedPill, { color: accentColor, borderColor: accentColor + '55', backgroundColor: accentColor + '14' }]}>● OPEN</Text>
            <Text style={styles.headerCount}>
              {entries.length} credential{entries.length === 1 ? '' : 's'}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={loadVault}
            disabled={loading}
            style={[styles.refreshBtn, { borderColor: accentColor + '55' }, webCursor(loading ? 'wait' : 'pointer')]}
          >
            {loading ? <ActivityIndicator size="small" color={accentColor} /> : <Text style={[styles.refreshText, { color: accentColor }]}>↻</Text>}
          </Pressable>
          <Pressable
            onPress={handleLockVault}
            style={[styles.refreshBtn, styles.lockNowBtn, { borderColor: '#f59e0b66' }, webCursor()]}
          >
            <Text style={[styles.refreshText, { color: '#f59e0b' }]}>LOCK</Text>
          </Pressable>
        </View>
      </View>

      {status ? <Text style={[styles.status, { borderColor: accentColor + '33' }]}>{status}</Text> : null}

      <ScrollView
        style={[styles.scroller, fullHeight ? styles.scrollerFullHeight : styles.scrollerPanelHeight]}
        contentContainerStyle={styles.scrollerContent}
        showsVerticalScrollIndicator
      >
        <View style={[styles.card, expandedId === 'new' && styles.cardExpanded]}>
          <Pressable
            onPress={() => setExpandedId(expandedId === 'new' ? null : 'new')}
            style={({ hovered, pressed }: any) => [
              styles.cardHeader,
              webTransition(),
              expandedId === 'new' && accordionExpandedStyle(accentColor),
              hovered && accordionHoverStyle(accentColor),
              pressed && accordionPressedStyle(accentColor),
              webCursor(),
            ]}
          >
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>+ Add credential</Text>
              <Text style={styles.cardMeta}>Encrypted at rest. Existing platform + label rotates the secret.</Text>
            </View>
            <AccordionChevron open={expandedId === 'new'} accent={accentColor} />
          </Pressable>

          {expandedId === 'new' ? (
            <View style={styles.form}>
              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>Platform preset</Text>
                <View style={styles.kindRow}>
                  {PLATFORM_PRESETS.map((preset) => {
                    const active = platform.trim().toLowerCase() === preset.key;
                    return (
                      <Pressable
                        key={preset.key}
                        onPress={() => applyPreset(preset)}
                        style={[
                          styles.kindChip,
                          active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                          webCursor(),
                        ]}
                      >
                        <Text style={[styles.kindText, active && { color: accentColor }]}>{preset.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.helperText}>{presetForPlatform(platform).notes}</Text>
              </View>

              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.label}>PLATFORM</Text>
                  <TextInput style={styles.input} value={platform} onChangeText={setPlatform} autoCapitalize="none" placeholder="wordpress" placeholderTextColor="#535b66" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>LABEL</Text>
                  <TextInput style={styles.input} value={label} onChangeText={setLabel} autoCapitalize="none" placeholder="default" placeholderTextColor="#535b66" />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>SITE URL</Text>
                <TextInput style={styles.input} value={siteUrl} onChangeText={setSiteUrl} autoCapitalize="none" placeholder="https://example.com" placeholderTextColor="#535b66" />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>LOGIN URL</Text>
                <TextInput style={styles.input} value={loginUrl} onChangeText={setLoginUrl} autoCapitalize="none" placeholder="https://example.com/wp-login.php" placeholderTextColor="#535b66" />
                <Pressable onPress={handleInferLoginUrl} style={[styles.inlineHelperBtn, webCursor()]}>
                  <Text style={[styles.inlineHelperText, { color: accentColor }]}>Suggest login URL</Text>
                </Pressable>
              </View>

              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.label}>USERNAME</Text>
                  <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" placeholder="admin@example.com" placeholderTextColor="#535b66" />
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>SECRET</Text>
                  <View style={styles.secretInputRow}>
                    <TextInput style={[styles.input, styles.secretInput]} value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" placeholder="password or token" placeholderTextColor="#535b66" />
                    <Pressable onPress={handleGeneratePassword} style={[styles.generateBtn, { borderColor: accentColor + '55' }, webCursor()]}>
                      <Text style={[styles.generateText, { color: accentColor }]}>Generate</Text>
                    </Pressable>
                  </View>
                  <View style={styles.strengthRow}>
                    {[1, 2, 3, 4, 5].map((bar) => (
                      <View
                        key={bar}
                        style={[
                          styles.strengthBar,
                          bar <= secretStrength.score && { backgroundColor: secretStrength.color },
                        ]}
                      />
                    ))}
                    <Text style={[styles.strengthText, { color: secretStrength.color }]}>{secretStrength.label}</Text>
                  </View>
                  {breachState.status === 'breached' ? (
                    <View style={styles.breachBox}>
                      <Text style={styles.breachTitle}>Found in known breaches</Text>
                      <Text style={styles.breachBody}>
                        This secret has appeared {breachState.count.toLocaleString()} time
                        {breachState.count === 1 ? '' : 's'} in public breach corpora (HaveIBeenPwned).
                        Use Generate to create a fresh one, or save anyway if this is a temporary placeholder.
                      </Text>
                    </View>
                  ) : breachState.status === 'safe' ? (
                    <Text style={styles.breachSafeText}>Not found in known breaches.</Text>
                  ) : breachState.status === 'checking' ? (
                    <Text style={styles.breachCheckText}>Checking against known breaches...</Text>
                  ) : breachState.status === 'error' ? (
                    <Text style={styles.breachCheckText}>Breach check unavailable ({breachState.error || 'network error'}).</Text>
                  ) : null}
                </View>
              </View>

              <View style={styles.sectionBox}>
                <Text style={styles.sectionTitle}>Allowed agent actions</Text>
                <View style={styles.kindRow}>
                  {ACTION_OPTIONS.map((action) => {
                    const active = allowedActions.includes(action.key);
                    return (
                      <Pressable
                        key={action.key}
                        onPress={() => toggleAllowedAction(action.key)}
                        style={[
                          styles.kindChip,
                          active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                          webCursor(),
                        ]}
                      >
                        <Text style={[styles.kindText, active && { color: accentColor }]}>{action.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.helperText}>Agents are blocked from using this credential for actions not listed here.</Text>
              </View>

              <View style={styles.kindRow}>
                {SECRET_KINDS.map((kind) => {
                  const active = secretKind === kind.value;
                  return (
                    <Pressable
                      key={kind.value}
                      onPress={() => setSecretKind(kind.value)}
                      style={[
                        styles.kindChip,
                        active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                        webCursor(),
                      ]}
                    >
                      <Text style={[styles.kindText, active && { color: accentColor }]}>{kind.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.row}>
                <View style={styles.field}>
                  <Text style={styles.label}>REVEAL WINDOW</Text>
                  <View style={styles.kindRow}>
                    {REVEAL_OPTIONS.map((seconds) => {
                      const active = revealDurationSeconds === seconds;
                      return (
                        <Pressable
                          key={seconds}
                          onPress={() => setRevealDurationSeconds(seconds)}
                          style={[
                            styles.kindChip,
                            active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                            webCursor(),
                          ]}
                        >
                          <Text style={[styles.kindText, active && { color: accentColor }]}>{seconds}s</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>ROTATION REMINDER</Text>
                  <View style={styles.kindRow}>
                    {ROTATION_OPTIONS.map((option) => {
                      const active = rotationCadenceDays === option.days;
                      return (
                        <Pressable
                          key={option.label}
                          onPress={() => setRotationCadenceDays(option.days)}
                          style={[
                            styles.kindChip,
                            active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                            webCursor(),
                          ]}
                        >
                          <Text style={[styles.kindText, active && { color: accentColor }]}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>AUTOMATION NOTES</Text>
                <TextInput
                  style={[styles.input, styles.notesInput]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  placeholder="When should agents use this credential? Any site-specific rules?"
                  placeholderTextColor="#535b66"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>TAGS / FOLDER</Text>
                <View style={styles.tagInputRow}>
                  <TextInput
                    style={[styles.input, styles.tagInput]}
                    value={tagInput}
                    onChangeText={setTagInput}
                    onSubmitEditing={() => addTag(tagInput)}
                    onBlur={() => { if (tagInput.trim()) addTag(tagInput); }}
                    autoCapitalize="none"
                    placeholder="client-acme, prod, billing (comma or enter to add)"
                    placeholderTextColor="#535b66"
                  />
                  <Pressable onPress={() => addTag(tagInput)} style={[styles.generateBtn, { borderColor: accentColor + '55' }, webCursor()]}>
                    <Text style={[styles.generateText, { color: accentColor }]}>Add</Text>
                  </Pressable>
                </View>
                {tags.length > 0 ? (
                  <View style={styles.kindRow}>
                    {tags.map((tag) => (
                      <Pressable
                        key={tag}
                        onPress={() => removeTag(tag)}
                        style={[styles.tagChip, { borderColor: accentColor + '88', backgroundColor: accentColor + '18' }, webCursor()]}
                      >
                        <Text style={[styles.tagChipText, { color: accentColor }]}>{tag} ×</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.helperText}>
                  Group credentials by client, environment, or use-case. Up to 8 tags. Searchable from /vault find.
                </Text>
              </View>

              <Pressable onPress={() => setRequiresApproval((value) => !value)} style={[styles.approvalRow, webCursor()]}>
                <View style={[styles.checkbox, requiresApproval && { backgroundColor: accentColor, borderColor: accentColor }]} />
                <Text style={styles.approvalText}>Require human approval before agents use this credential</Text>
              </Pressable>

              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={[styles.primaryBtn, { backgroundColor: accentColor }, saving && styles.disabledBtn, webCursor(saving ? 'wait' : 'pointer')]}
              >
                {saving ? <ActivityIndicator size="small" color="#061018" /> : <Text style={styles.primaryText}>Save to Vault</Text>}
              </Pressable>
            </View>
          ) : null}
        </View>

        {entries.length > 0 ? (
          <View style={styles.filterCard}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              placeholder="Search by platform, site, user, label, or action"
              placeholderTextColor="#535b66"
            />
            <View style={styles.kindRow}>
              {[
                { key: 'all', label: `All (${entries.length})` },
                { key: 'ready', label: `Ready (${readinessStats.ready})` },
                { key: 'needs_test', label: `Needs test (${readinessStats.needsTest})` },
                { key: 'rotation_due', label: `Rotation due (${readinessStats.rotationDue})` },
                { key: 'security_risk', label: `Security risk (${securityReport.counts.critical + securityReport.counts.high})` },
                { key: 'inactive', label: `Inactive (${readinessStats.inactive})` },
              ].map((filter) => {
                const active = riskFilter === filter.key;
                return (
                  <Pressable
                    key={filter.key}
                    onPress={() => setRiskFilter(filter.key as RiskFilter)}
                    style={[
                      styles.filterToggle,
                      active && { borderColor: accentColor + '88', backgroundColor: accentColor + '14' },
                      webCursor(),
                    ]}
                  >
                    <Text style={[styles.filterToggleText, active && { color: accentColor }]}>{filter.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setRotationOnly((value) => !value)}
                style={[
                  styles.filterToggle,
                  rotationOnly && { borderColor: accentColor + '88', backgroundColor: accentColor + '14' },
                  webCursor(),
                ]}
              >
                <Text style={[styles.filterToggleText, rotationOnly && { color: accentColor }]}>Only due</Text>
              </Pressable>
            </View>
            {allTags.length > 0 ? (
              <View style={styles.kindRow}>
                <Pressable
                  onPress={() => setTagFilter(null)}
                  style={[
                    styles.tagFilterChip,
                    tagFilter === null && { borderColor: accentColor + '88', backgroundColor: accentColor + '14' },
                    webCursor(),
                  ]}
                >
                  <Text style={[styles.tagFilterText, tagFilter === null && { color: accentColor }]}>All tags</Text>
                </Pressable>
                {allTags.map(([tag, count]) => {
                  const active = tagFilter === tag;
                  return (
                    <Pressable
                      key={tag}
                      onPress={() => setTagFilter(active ? null : tag)}
                      style={[
                        styles.tagFilterChip,
                        active && { borderColor: accentColor + '88', backgroundColor: accentColor + '14' },
                        webCursor(),
                      ]}
                    >
                      <Text style={[styles.tagFilterText, active && { color: accentColor }]}>#{tag} ({count})</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        ) : null}
        {entries.length === 0 && !loading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No saved site credentials yet.</Text>
            <Text style={styles.emptyText}>Add WordPress, Shopify, Webflow, cPanel, or any client website login your agents need to operate.</Text>
          </View>
        ) : null}

        {entries.length > 0 && visibleEntries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No matching credentials.</Text>
            <Text style={styles.emptyText}>Clear search or change the readiness filters to see all saved credentials.</Text>
          </View>
        ) : null}

        {selectedIds.size > 0 ? (
          <View style={[styles.bulkBar, { borderColor: accentColor + '55' }]}>
            <Text style={styles.bulkLabel}>{selectedIds.size} selected</Text>
            <View style={styles.bulkActionRow}>
              <Pressable disabled={bulkBusy} onPress={handleBulkDisable} style={[styles.secondaryBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={styles.secondaryText}>Disable</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={handleBulkEnable} style={[styles.secondaryBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={styles.secondaryText}>Enable</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={handleBulkMarkRotation} style={[styles.secondaryBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={styles.secondaryText}>Mark rotation due</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={handleBulkHarden} style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={[styles.secondaryText, { color: accentColor }]}>Harden</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={handleBulkPruneExpiredGrants} style={[styles.secondaryBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={styles.secondaryText}>Remove expired grants</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={handleBulkDelete} style={[styles.secondaryBtn, { borderColor: '#ef444466' }, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={[styles.secondaryText, { color: '#fca5a5' }]}>Delete</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={selectVisible} style={[styles.secondaryBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={styles.secondaryText}>Select all</Text>
              </Pressable>
              <Pressable disabled={bulkBusy} onPress={clearSelection} style={[styles.secondaryBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}>
                <Text style={styles.secondaryText}>Clear</Text>
              </Pressable>
            </View>
            {bulkBusy ? <ActivityIndicator size="small" color={accentColor} /> : null}
          </View>
        ) : null}

        {visibleEntries.map((entry) => {
          const expanded = expandedId === entry.id;
          const entrySettingsOpen = entrySettingsOpenId === entry.id;
          const reveal = revealed[entry.id];
          const revealSeconds = reveal ? Math.max(0, Math.ceil((reveal.expiresAt - Date.now()) / 1000)) : 0;
          const rotationDue = isRotationDue(entry);
          const readiness = automationReadiness(entry);
          const actions = entryAllowedActions(entry);
          const origins = entryAllowedOrigins(entry);
          const automationGrants = getVaultAccessGrants(entry);
          const entrySecurityIssues = securityIssuesByCredential.get(entry.id) || [];
          const highSecurityIssueCount = entrySecurityIssues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high').length;
          const expiredGrantCount = automationGrants.filter((grant) => isVaultAccessGrantExpired(grant)).length;
          const isBusy = !!updating[entry.id] || !!testing[entry.id];
          const isSelected = selectedIds.has(entry.id);
          const lastTestedAt = entryMetadataString(entry, 'lastTestedAt');
          const lastTestSuccess = entryMetadataBoolean(entry, 'lastTestSuccess');
          // Collapsed rows only flag ATTENTION states — a passing test is the
          // expected condition and lives in the entry's Service details.
          const lastTestPill: { label: string; color: string } | null =
            lastTestedAt && lastTestSuccess === false
              ? { label: `TEST FAIL · ${formatAuditTime(lastTestedAt)}`, color: '#f87171' }
              : null;
          const lastUsedRelative = entry.lastUsedAt ? formatAuditTime(entry.lastUsedAt) : null;
          const cardMetaBits = [
            entry.siteUrl || 'No site URL',
            entry.username || null,
            lastUsedRelative ? `last used ${lastUsedRelative}` : null,
          ].filter(Boolean) as string[];
          return (
            <View key={entry.id} style={[styles.card, expanded && styles.cardExpanded, isSelected && { borderColor: accentColor + '66' }]}>
              <View style={[styles.cardHeader, isSelected && { backgroundColor: accentColor + '0c' }]}>
                <Pressable
                  onPress={() => toggleSelected(entry.id)}
                  style={[styles.bulkCheckbox, isSelected && { backgroundColor: accentColor, borderColor: accentColor }, webCursor()]}
                  hitSlop={8}
                />
                <Pressable
                  onPress={() => setExpandedId(expanded ? null : entry.id)}
                  style={({ hovered, pressed }: any) => [
                    styles.cardHeaderTouch,
                    webTransition(),
                    expanded && accordionExpandedStyle(accentColor),
                    hovered && accordionHoverStyle(accentColor),
                    pressed && accordionPressedStyle(accentColor),
                    webCursor(),
                  ]}
                >
                  <View style={styles.cardHeaderText}>
                    <View style={styles.cardTitleRow}>
                      <Text style={styles.cardTitle}>{entry.platform} / {entry.label}</Text>
                      <Text style={[styles.readinessBadge, { color: readiness.color, borderColor: readiness.color + '55' }]}>{readiness.label}</Text>
                      {lastTestPill ? (
                        <Text style={[styles.testPill, { color: lastTestPill.color, borderColor: lastTestPill.color + '55' }]}>{lastTestPill.label}</Text>
                      ) : null}
                      {rotationDue ? <Text style={styles.rotationBadge}>Rotation due</Text> : null}
                      {!entry.isActive ? <Text style={styles.inactiveBadge}>Inactive</Text> : null}
                      {highSecurityIssueCount > 0 ? <Text style={styles.securityRiskBadge}>SECURITY ×{highSecurityIssueCount}</Text> : null}
                    </View>
                    <Text style={styles.cardMeta}>{cardMetaBits.join(' · ')}</Text>
                  </View>
                  <AccordionChevron open={expanded} accent={accentColor} />
                </Pressable>
              </View>

              {expanded ? (
                <View style={styles.entryBody}>
                  <View style={styles.readinessBox}>
                    <View style={styles.readinessTop}>
                      <Text style={[styles.readinessScore, { color: readiness.color }]}>{readiness.score}% automation ready</Text>
                      {isBusy ? <ActivityIndicator size="small" color={accentColor} /> : null}
                    </View>
                    {readiness.issues.length > 0 ? (
                      <Text style={styles.helperText}>{readiness.issues.join(' • ')}</Text>
                    ) : (
                      <Text style={styles.helperText}>Ready for approved login and website automation.</Text>
                    )}
                  </View>

                  {confirmReveal && confirmReveal.entryId === entry.id ? (
                    <View style={styles.confirmRevealBox}>
                      <Text style={styles.confirmRevealTitle}>Confirm reveal</Text>
                      <Text style={styles.helperText}>
                        This credential is marked high-trust. Type{' '}
                        <Text style={styles.confirmRevealTarget}>{entry.platform}/{entry.label}</Text>{' '}
                        to proceed.
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={confirmReveal.input}
                        onChangeText={(text) => setConfirmReveal({ entryId: entry.id, input: text })}
                        autoCapitalize="none"
                        autoFocus
                        placeholder={`${entry.platform}/${entry.label}`}
                        placeholderTextColor="#535b66"
                      />
                      <View style={styles.actionRow}>
                        <Pressable onPress={submitConfirmReveal} style={[styles.primaryBtn, { backgroundColor: '#f59e0b' }, webCursor()]}>
                          <Text style={styles.primaryText}>Confirm and reveal</Text>
                        </Pressable>
                        <Pressable onPress={cancelConfirmReveal} style={[styles.secondaryBtn, webCursor()]}>
                          <Text style={styles.secondaryText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  <View style={[styles.secretBox, { borderColor: reveal ? accentColor + '88' : '#ffffff20' }]}>
                    <View style={styles.secretHeadRow}>
                      <Text style={styles.secretLabel}>{entry.secretKind === 'totp_seed' ? 'TOTP SEED' : 'SECRET'}</Text>
                      <Text style={[styles.secretStatePill, reveal ? { color: accentColor, borderColor: accentColor + '55', backgroundColor: accentColor + '14' } : null]}>
                        {reveal ? '◉ DECRYPTED' : '◌ ENCRYPTED'}
                      </Text>
                    </View>
                    <Text style={[styles.secretValue, reveal && { color: accentColor }]}>
                      {reveal ? reveal.secret : '••••••••••••••••'}
                    </Text>
                    {reveal ? <Text style={styles.secretTimer}>Clears in {revealSeconds}s</Text> : null}
                  </View>

                  {entry.secretKind === 'totp_seed' && totpCodes[entry.id] ? (
                    <View style={[styles.totpBox, { borderColor: accentColor + '55' }]}>
                      <Text style={styles.totpLabel}>CURRENT CODE</Text>
                      {totpCodes[entry.id].error ? (
                        <Text style={styles.helperText}>{totpCodes[entry.id].error}</Text>
                      ) : (
                        <>
                          <Text style={[styles.totpCode, { color: accentColor }]}>{totpCodes[entry.id].code}</Text>
                          <Text style={styles.totpTimer}>
                            Refreshes in {totpCodes[entry.id].remainingSeconds}s
                          </Text>
                          <Pressable onPress={() => handleCopyTotp(entry)} style={[styles.secondaryBtn, webCursor()]}>
                            <Text style={styles.secondaryText}>Copy code</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  ) : null}

                  <View style={styles.actionRow}>
                    <Pressable onPress={() => handleRotateFromEntry(entry)} style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor()]}>
                      <Text style={[styles.secondaryText, { color: accentColor }]}>Rotate</Text>
                    </Pressable>
                    <Pressable onPress={() => handleReveal(entry)} style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor()]}>
                      <Text style={[styles.secondaryText, { color: accentColor }]}>{entry.secretKind === 'totp_seed' ? 'Show code' : 'Reveal'}</Text>
                    </Pressable>
                    <Pressable onPress={() => handleOpenLogin(entry)} style={[styles.secondaryBtn, webCursor()]}>
                      <Text style={styles.secondaryText}>Open login</Text>
                    </Pressable>
                    <Pressable onPress={() => handleCopyRunbook(entry)} style={[styles.secondaryBtn, webCursor()]}>
                      <Text style={styles.secondaryText}>Copy runbook</Text>
                    </Pressable>
                    <Pressable onPress={() => handleCopyUsername(entry)} disabled={!entry.username} style={[styles.secondaryBtn, !entry.username && styles.disabledBtn, webCursor(entry.username ? 'pointer' : 'not-allowed')]}>
                      <Text style={styles.secondaryText}>Copy user</Text>
                    </Pressable>
                    <Pressable onPress={() => handleCopySecret(entry)} disabled={!reveal} style={[styles.secondaryBtn, !reveal && styles.disabledBtn, webCursor(reveal ? 'pointer' : 'not-allowed')]}>
                      <Text style={styles.secondaryText}>Copy secret</Text>
                    </Pressable>
                    <Pressable onPress={() => handleDelete(entry)} style={[styles.dangerBtn, webCursor()]}>
                      <Text style={styles.dangerText}>Remove</Text>
                    </Pressable>
                  </View>

                  {/* Per-entry settings & activity — config sections and the
                      audit trail fold behind one row so the expanded view
                      leads with the secret and the actions. */}
                  <Pressable
                    onPress={() => setEntrySettingsOpenId(entrySettingsOpen ? null : entry.id)}
                    style={({ hovered }: any) => [
                      styles.entrySettingsToggle,
                      webTransition(),
                      hovered && { borderColor: accentColor + '55' },
                      webCursor(),
                    ]}
                  >
                    <Text style={styles.entrySettingsToggleText}>Settings & activity</Text>
                    <AccordionChevron open={entrySettingsOpen} accent={accentColor} />
                  </Pressable>
                  {entrySettingsOpen ? (
                    <View style={styles.entrySettingsBody}>
                      <View style={styles.sectionBox}>
                        <Text style={styles.sectionTitle}>Service details</Text>
                        <InfoLine label="Login URL" value={entry.loginUrl || entry.siteUrl || 'Not set'} />
                        <InfoLine label="Secret type" value={entry.secretKind.replace(/_/g, ' ')} />
                        <InfoLine label="Updated" value={formatDate(entry.updatedAt)} />
                        <InfoLine label="Last used" value={formatDate(entry.lastUsedAt)} />
                        <InfoLine label="Last tested" value={formatDate(entryMetadataString(entry, 'lastTestedAt'))} />
                        <InfoLine label="Rotation due" value={formatDate(entry.rotationDueAt)} />
                        <InfoLine label="Tags" value={entryTags(entry).join(', ') || 'None'} />
                      </View>

                      <View style={styles.sectionBox}>
                        <Text style={styles.sectionTitle}>Security controls</Text>
                        {entrySecurityIssues.length > 0 ? (
                          <View style={styles.entrySecurityList}>
                            {entrySecurityIssues.slice(0, 5).map((issue) => {
                              const severityColor =
                                issue.severity === 'critical' ? '#ef4444' :
                                issue.severity === 'high' ? '#fb7185' :
                                issue.severity === 'medium' ? '#f59e0b' :
                                '#94a3b8';
                              return (
                                <View key={issue.id} style={styles.entrySecurityIssue}>
                                  <Text style={[styles.securitySeverity, { color: severityColor }]}>{issue.severity}</Text>
                                  <Text style={styles.helperText}>{issue.title}: {issue.fix}</Text>
                                </View>
                              );
                            })}
                          </View>
                        ) : (
                          <Text style={styles.helperText}>No security issues detected on this credential.</Text>
                        )}
                        <View style={styles.actionRow}>
                          <Pressable
                            onPress={() => updateEntryControls(entry, {}, 'No changes needed.')}
                            disabled
                            style={[styles.secondaryBtn, styles.disabledBtn]}
                          >
                            <Text style={styles.secondaryText}>{entrySecurityIssues.length} issue{entrySecurityIssues.length === 1 ? '' : 's'}</Text>
                          </Pressable>
                          <Pressable
                            onPress={async () => {
                              setUpdating((current) => ({ ...current, [entry.id]: true }));
                              const result = await hardenVaultCredential(circleId, entry, currentUserId);
                              if (result.entry) replaceEntry(result.entry);
                              setStatus(result.resultsText);
                              await loadAudit(entry.id);
                              setUpdating((current) => ({ ...current, [entry.id]: false }));
                            }}
                            disabled={!!updating[entry.id]}
                            style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                          >
                            <Text style={[styles.secondaryText, { color: accentColor }]}>Harden now</Text>
                          </Pressable>
                          {expiredGrantCount > 0 ? (
                            <Pressable
                              onPress={async () => {
                                setUpdating((current) => ({ ...current, [entry.id]: true }));
                                const result = await pruneExpiredVaultAccessGrants(circleId, entry, currentUserId);
                                if (result.entry) replaceEntry(result.entry);
                                setStatus(result.resultsText);
                                await loadAudit(entry.id);
                                setUpdating((current) => ({ ...current, [entry.id]: false }));
                              }}
                              disabled={!!updating[entry.id]}
                              style={[styles.secondaryBtn, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                            >
                              <Text style={styles.secondaryText}>Remove {expiredGrantCount} expired grant{expiredGrantCount === 1 ? '' : 's'}</Text>
                            </Pressable>
                          ) : null}
                        </View>
                        <Pressable
                          onPress={() => updateEntryControls(entry, {
                            accessPolicy: {
                              ...entry.accessPolicy,
                              require_approval: entry.accessPolicy?.require_approval === false,
                            },
                          }, 'Approval policy updated.')}
                          disabled={!!updating[entry.id]}
                          style={[styles.approvalRow, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                        >
                          <View style={[styles.checkbox, entry.accessPolicy?.require_approval !== false && { backgroundColor: accentColor, borderColor: accentColor }]} />
                          <Text style={styles.approvalText}>Require approval before use</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => updateEntryControls(entry, {
                            metadata: { ...entry.metadata, highTrust: !isHighTrust(entry) },
                          }, isHighTrust(entry) ? 'High-trust gate disabled.' : 'High-trust gate enabled.')}
                          disabled={!!updating[entry.id]}
                          style={[styles.approvalRow, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                        >
                          <View style={[styles.checkbox, isHighTrust(entry) && { backgroundColor: '#f59e0b', borderColor: '#f59e0b' }]} />
                          <Text style={styles.approvalText}>High-trust — require typed confirmation before reveal</Text>
                        </Pressable>
                        <View style={styles.kindRow}>
                          {ACTION_OPTIONS.map((action) => {
                            const active = actions.includes(action.key);
                            const nextActions = active
                              ? actions.filter((item) => item !== action.key)
                              : [...actions, action.key];
                            return (
                              <Pressable
                                key={action.key}
                                onPress={() => updateEntryControls(entry, {
                                  accessPolicy: {
                                    ...entry.accessPolicy,
                                    allowed_actions: nextActions.includes('login') ? nextActions : ['login', ...nextActions],
                                    allowed_origins: origins,
                                  },
                                }, 'Allowed actions updated.')}
                                disabled={!!updating[entry.id]}
                                style={[
                                  styles.kindChip,
                                  active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                                  webCursor(updating[entry.id] ? 'wait' : 'pointer'),
                                ]}
                              >
                                <Text style={[styles.kindText, active && { color: accentColor }]}>{action.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={styles.helperText}>Allowed origins: {origins.join(', ') || 'not set'}</Text>
                      </View>

                      <View style={styles.sectionBox}>
                        <Text style={styles.sectionTitle}>Sharing</Text>
                        <Text style={styles.helperText}>
                          {allowedMemberIds(entry).length === 0
                            ? 'Visible to every circle member. Pick specific people to restrict access.'
                            : `Restricted to ${allowedMemberIds(entry).length} member${allowedMemberIds(entry).length === 1 ? '' : 's'} plus the credential creator.`}
                        </Text>
                        <View style={styles.kindRow}>
                          {members.map((member) => {
                            const list = allowedMemberIds(entry);
                            const active = list.includes(member.user_id);
                            const isCreator = entry.createdBy === member.user_id;
                            return (
                              <Pressable
                                key={member.user_id}
                                onPress={() => {
                                  if (isCreator) return;
                                  const next = active ? list.filter((id) => id !== member.user_id) : [...list, member.user_id];
                                  updateEntryControls(entry, {
                                    metadata: { ...entry.metadata, allowedMemberIds: next },
                                  }, active ? `Removed ${member.display_name} from sharing.` : `Shared with ${member.display_name}.`);
                                }}
                                disabled={!!updating[entry.id] || isCreator}
                                style={[
                                  styles.kindChip,
                                  active && { borderColor: accentColor + '88', backgroundColor: accentColor + '18' },
                                  isCreator && { borderColor: '#22c55e55', backgroundColor: '#22c55e14' },
                                  webCursor(isCreator ? 'default' : updating[entry.id] ? 'wait' : 'pointer'),
                                ]}
                              >
                                <Text style={[
                                  styles.kindText,
                                  active && { color: accentColor },
                                  isCreator && { color: '#22c55e' },
                                ]}>
                                  {isCreator ? `${member.display_name} · creator` : member.display_name}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        {allowedMemberIds(entry).length > 0 ? (
                          <Pressable
                            onPress={() => updateEntryControls(entry, {
                              metadata: { ...entry.metadata, allowedMemberIds: [] },
                            }, 'Restored open sharing.')}
                            disabled={!!updating[entry.id]}
                            style={[styles.secondaryBtn, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                          >
                            <Text style={styles.secondaryText}>Open to everyone</Text>
                          </Pressable>
                        ) : null}
                      </View>

                      <View style={styles.sectionBox}>
                        <Text style={styles.sectionTitle}>Agent access</Text>
                        {automationGrants.length === 0 ? (
                          <Text style={styles.helperText}>
                            No agent grants yet. Use /vault grant from chat to give OpenSwan, chat, or a named agent scoped login access.
                          </Text>
                        ) : (
                          <>
                            {automationGrants.slice(0, 8).map((grant) => {
                              const expired = isVaultAccessGrantExpired(grant);
                              const expiry = grant.expiresAt ? ` until ${grant.expiresAt.slice(0, 10)}` : '';
                              return (
                                <Text key={grant.id} style={styles.helperText}>
                                  {grant.granteeType}:{grant.grantee} - {grant.actions.join(', ')}{expiry}{expired ? ' [expired]' : ''}
                                </Text>
                              );
                            })}
                            {automationGrants.length > 8 ? (
                              <Text style={styles.helperText}>+ {automationGrants.length - 8} more grant{automationGrants.length - 8 === 1 ? '' : 's'}</Text>
                            ) : null}
                          </>
                        )}
                        <Text style={styles.helperText}>Agents receive credential IDs and runbooks only. Secrets stay inside the approved vault/browser tools.</Text>
                      </View>

                      <View style={styles.sectionBox}>
                        <Text style={styles.sectionTitle}>Rotation and test</Text>
                        <View style={styles.kindRow}>
                          {ROTATION_OPTIONS.map((option) => (
                            <Pressable
                              key={option.label}
                              onPress={() => updateEntryControls(entry, { rotationDueAt: dueDateFromCadence(option.days) }, 'Rotation reminder updated.')}
                              disabled={!!updating[entry.id]}
                              style={[styles.kindChip, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                            >
                              <Text style={styles.kindText}>{option.label}</Text>
                            </Pressable>
                          ))}
                        </View>
                        <View style={styles.actionRow}>
                          <Pressable
                            onPress={() => handleTest(entry)}
                            disabled={!!testing[entry.id]}
                            style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor(testing[entry.id] ? 'wait' : 'pointer')]}
                          >
                            <Text style={[styles.secondaryText, { color: accentColor }]}>{testing[entry.id] ? 'Testing...' : 'Test login'}</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => updateEntryControls(entry, { isActive: !entry.isActive }, entry.isActive ? 'Credential disabled.' : 'Credential enabled.')}
                            disabled={!!updating[entry.id]}
                            style={[styles.secondaryBtn, webCursor(updating[entry.id] ? 'wait' : 'pointer')]}
                          >
                            <Text style={styles.secondaryText}>{entry.isActive ? 'Disable' : 'Enable'}</Text>
                          </Pressable>
                        </View>
                        {entryMetadataString(entry, 'lastTestMessage') ? <Text style={styles.helperText}>{entryMetadataString(entry, 'lastTestMessage')}</Text> : null}
                      </View>

                      <View style={styles.auditBox}>
                        <View style={styles.auditHeader}>
                          <Text style={styles.auditTitle}>Audit trail</Text>
                          {auditLoading[entry.id] ? <ActivityIndicator size="small" color={accentColor} /> : null}
                        </View>
                        {(auditEntries[entry.id] || []).length === 0 && !auditLoading[entry.id] ? (
                          <Text style={styles.auditEmpty}>{auditErrors[entry.id] || 'No access events loaded yet.'}</Text>
                        ) : null}
                        {(auditEntries[entry.id] || []).slice(0, 8).map((event) => (
                          <View key={event.id} style={styles.auditRow}>
                            <Text style={[styles.auditAction, event.success ? null : styles.auditActionFailed]}>
                              {event.action.toUpperCase()}
                            </Text>
                            <Text style={styles.auditPurpose}>{event.purpose || 'no purpose'}</Text>
                            <Text style={styles.auditDate}>{formatDate(event.createdAt)}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {/* ── Advanced — security posture, CSV import, and the audit log live
            behind one collapsed row so the default view is just credentials. */}
        <View style={[styles.card, advancedOpen && styles.cardExpanded]}>
          <Pressable
            onPress={() => setAdvancedOpen((value) => !value)}
            style={({ hovered, pressed }: any) => [
              styles.cardHeader,
              webTransition(),
              advancedOpen && accordionExpandedStyle(accentColor),
              hovered && accordionHoverStyle(accentColor),
              pressed && accordionPressedStyle(accentColor),
              webCursor(),
            ]}
          >
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Advanced</Text>
              <Text style={styles.cardMeta}>
                Security {securityReport.score}/100
                {securityReport.counts.critical + securityReport.counts.high > 0
                  ? ` · ${securityReport.counts.critical + securityReport.counts.high} high-risk`
                  : ''} · CSV import · activity log
              </Text>
            </View>
            <AccordionChevron open={advancedOpen} accent={accentColor} />
          </Pressable>
          {advancedOpen ? (
            <View style={styles.advancedBody}>
            <View style={[styles.card, securityOpen && styles.cardExpanded]}>
              <Pressable
                onPress={() => setSecurityOpen((value) => !value)}
                style={({ hovered, pressed }: any) => [
                  styles.cardHeader,
                  webTransition(),
                  securityOpen && accordionExpandedStyle(accentColor),
                  hovered && accordionHoverStyle(accentColor),
                  pressed && accordionPressedStyle(accentColor),
                  webCursor(),
                ]}
              >
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>Security Command Center</Text>
                  <Text style={styles.cardMeta}>
                    {securityReport.score}/100 · {securityReport.counts.critical} critical · {securityReport.counts.high} high · {securityReport.expiredGrantCount} expired grant{securityReport.expiredGrantCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <AccordionChevron open={securityOpen} accent={accentColor} />
              </Pressable>
              {securityOpen ? (
                <View style={styles.form}>
                  <View style={styles.securityHero}>
                    <View style={styles.securityScoreRing}>
                      <Text
                        style={[
                          styles.securityScoreValue,
                          {
                            color: securityReport.grade === 'critical'
                              ? '#ef4444'
                              : securityReport.score >= 90
                                ? '#22c55e'
                                : securityReport.score >= 75
                                  ? '#f59e0b'
                                  : '#fb7185',
                          },
                        ]}
                      >
                        {securityReport.score}
                      </Text>
                      <Text style={styles.securityScoreLabel}>score</Text>
                    </View>
                    <View style={styles.securitySummaryBody}>
                      <Text style={styles.sectionTitle}>
                        {securityReport.grade === 'excellent'
                          ? 'Vault posture is strong'
                          : securityReport.grade === 'good'
                            ? 'Vault posture is good'
                            : securityReport.grade === 'critical'
                              ? 'Critical vault fixes needed'
                              : 'Vault needs hardening'}
                      </Text>
                      <Text style={styles.helperText}>
                        Tracks approval gaps, scoped origins, high-risk actions, stale grants, rotation debt, failed tests, and breached-secret flags.
                      </Text>
                      <View style={styles.securityCountGrid}>
                        <SecurityCount label="Critical" value={securityReport.counts.critical} color="#ef4444" />
                        <SecurityCount label="High" value={securityReport.counts.high} color="#fb7185" />
                        <SecurityCount label="Medium" value={securityReport.counts.medium} color="#f59e0b" />
                        <SecurityCount label="Low" value={securityReport.counts.low} color="#94a3b8" />
                      </View>
                    </View>
                  </View>

                  {securityReport.issues.length > 0 ? (
                    <View style={styles.securityIssueList}>
                      {securityReport.issues.slice(0, 8).map((issue) => {
                        const entry = entries.find((item) => item.id === issue.credentialId);
                        const severityColor =
                          issue.severity === 'critical' ? '#ef4444' :
                          issue.severity === 'high' ? '#fb7185' :
                          issue.severity === 'medium' ? '#f59e0b' :
                          '#94a3b8';
                        return (
                          <View key={issue.id} style={[styles.securityIssueRow, { borderColor: severityColor + '44' }]}>
                            <View style={styles.securityIssueTop}>
                              <Text style={[styles.securitySeverity, { color: severityColor }]}>{issue.severity}</Text>
                              <Text style={styles.securityIssueTarget}>
                                {entry ? `${entry.platform}/${entry.label}` : issue.credentialId.slice(0, 8)}
                              </Text>
                            </View>
                            <Text style={styles.securityIssueTitle}>{issue.title}</Text>
                            <Text style={styles.helperText}>{issue.detail}</Text>
                            <Text style={[styles.helperText, { color: severityColor }]}>Fix: {issue.fix}</Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.helperText}>No vault security issues detected for credentials visible to you.</Text>
                  )}

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => setRiskFilter('security_risk')}
                      style={[styles.secondaryBtn, { borderColor: '#ef444466' }, webCursor()]}
                    >
                      <Text style={[styles.secondaryText, { color: '#fca5a5' }]}>Review high-risk</Text>
                    </Pressable>
                    <Pressable
                      onPress={handleHardenHighRisk}
                      disabled={bulkBusy || securityReport.counts.critical + securityReport.counts.high === 0}
                      style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, (bulkBusy || securityReport.counts.critical + securityReport.counts.high === 0) && styles.disabledBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}
                    >
                      <Text style={[styles.secondaryText, { color: accentColor }]}>Harden high-risk</Text>
                    </Pressable>
                    <Pressable
                      onPress={handlePruneAllExpiredGrants}
                      disabled={bulkBusy || securityReport.expiredGrantCount === 0}
                      style={[styles.secondaryBtn, (bulkBusy || securityReport.expiredGrantCount === 0) && styles.disabledBtn, webCursor(bulkBusy ? 'wait' : 'pointer')]}
                    >
                      <Text style={styles.secondaryText}>Remove expired grants</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>

            <View style={[styles.card, importOpen && styles.cardExpanded]}>
              <Pressable
                onPress={() => setImportOpen((value) => !value)}
                style={({ hovered, pressed }: any) => [
                  styles.cardHeader,
                  webTransition(),
                  importOpen && accordionExpandedStyle(accentColor),
                  hovered && accordionHoverStyle(accentColor),
                  pressed && accordionPressedStyle(accentColor),
                  webCursor(),
                ]}
              >
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>Import from CSV</Text>
                  <Text style={styles.cardMeta}>1Password, Bitwarden, or LastPass exports. Auto-detects format.</Text>
                </View>
                <AccordionChevron open={importOpen} accent={accentColor} />
              </Pressable>
              {importOpen ? (
                <View style={styles.form}>
                  {Platform.OS === 'web' ? (
                    <View style={styles.actionRow}>
                      {/* @ts-ignore — RN Web exposes the underlying input */}
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e: any) => {
                          const file: File | undefined = e?.target?.files?.[0];
                          if (file) handleImportFile(file);
                          // Reset so re-selecting the same file fires onChange again.
                          e.target.value = '';
                        }}
                        style={{
                          color: '#cbd5e1',
                          fontSize: 12,
                          padding: 6,
                          borderRadius: 8,
                          border: '1px solid #ffffff20',
                          backgroundColor: '#050914',
                        }}
                      />
                    </View>
                  ) : (
                    <Text style={styles.helperText}>CSV import is web-only. Open the app on desktop to import a vault export.</Text>
                  )}
                  {importBusy && !importParseResult ? <ActivityIndicator size="small" color={accentColor} /> : null}
                  {importStatus ? <Text style={[styles.status, { borderColor: accentColor + '33' }]}>{importStatus}</Text> : null}
                  {importParseResult ? (
                    <View style={styles.sectionBox}>
                      <Text style={styles.sectionTitle}>
                        Preview ({importParseResult.format}) — {importParseResult.rows.length} row{importParseResult.rows.length === 1 ? '' : 's'}, {importSelected.size} selected
                      </Text>
                      {importParseResult.warnings.map((warning, idx) => (
                        <Text key={idx} style={styles.helperText}>{warning}</Text>
                      ))}
                      <View style={styles.importPreviewList}>
                        {importParseResult.rows.slice(0, 100).map((row) => {
                          const checked = importSelected.has(row.index);
                          return (
                            <Pressable
                              key={row.index}
                              onPress={() => toggleImportSelected(row.index)}
                              style={[styles.importPreviewRow, checked && { borderColor: accentColor + '88', backgroundColor: accentColor + '0c' }, webCursor()]}
                            >
                              <View style={[styles.bulkCheckbox, checked && { backgroundColor: accentColor, borderColor: accentColor }]} />
                              <View style={styles.importPreviewBody}>
                                <Text style={styles.importPreviewTitle}>
                                  {row.platform}/{row.label}
                                  {!row.isComplete ? ' · skipped (missing password)' : ''}
                                </Text>
                                <Text style={styles.importPreviewMeta}>
                                  {row.title || '—'}{row.url ? ` · ${row.url}` : ''}{row.username ? ` · ${row.username}` : ''}
                                </Text>
                                {row.tags.length > 0 ? (
                                  <Text style={styles.importPreviewMeta}>tags: {row.tags.join(', ')}</Text>
                                ) : null}
                              </View>
                            </Pressable>
                          );
                        })}
                        {importParseResult.rows.length > 100 ? (
                          <Text style={styles.helperText}>+ {importParseResult.rows.length - 100} more rows hidden in preview but still imported if selected.</Text>
                        ) : null}
                      </View>
                      <View style={styles.actionRow}>
                        <Pressable
                          disabled={importBusy}
                          onPress={runImport}
                          style={[styles.primaryBtn, { backgroundColor: accentColor }, importBusy && styles.disabledBtn, webCursor(importBusy ? 'wait' : 'pointer')]}
                        >
                          {importBusy ? <ActivityIndicator size="small" color="#061018" /> : <Text style={styles.primaryText}>Import {importSelected.size}</Text>}
                        </Pressable>
                        <Pressable
                          onPress={() => { setImportParseResult(null); setImportSelected(new Set()); setImportStatus(''); }}
                          style={[styles.secondaryBtn, webCursor()]}
                        >
                          <Text style={styles.secondaryText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>

            <View style={[styles.card, globalAuditOpen && styles.cardExpanded]}>
              <Pressable
                onPress={() => setGlobalAuditOpen((value) => !value)}
                style={({ hovered, pressed }: any) => [
                  styles.cardHeader,
                  webTransition(),
                  globalAuditOpen && accordionExpandedStyle(accentColor),
                  hovered && accordionHoverStyle(accentColor),
                  pressed && accordionPressedStyle(accentColor),
                  webCursor(),
                ]}
              >
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardTitle}>Recent activity</Text>
                  <Text style={styles.cardMeta}>
                    {globalAuditEntries.length > 0
                      ? `Last ${globalAuditEntries.length} vault events across every credential.`
                      : 'Last 50 vault events across every credential. Use this for audits and incident review.'}
                  </Text>
                </View>
                <AccordionChevron open={globalAuditOpen} accent={accentColor} />
              </Pressable>
              {globalAuditOpen ? (
                <View style={styles.form}>
                  {globalAuditLoading ? (
                    <ActivityIndicator size="small" color={accentColor} />
                  ) : globalAuditError ? (
                    <Text style={styles.helperText}>{globalAuditError}</Text>
                  ) : globalAuditEntries.length === 0 ? (
                    <Text style={styles.helperText}>No vault events recorded yet.</Text>
                  ) : (
                    <View style={styles.globalAuditList}>
                      {globalAuditEntries.map((entry) => {
                        const credential = entries.find((c) => c.id === entry.credentialId);
                        const tag = credential ? `${credential.platform}/${credential.label}` : entry.credentialId ? 'deleted credential' : '—';
                        return (
                          <View key={entry.id} style={[styles.globalAuditRow, !entry.success && styles.globalAuditRowFailed]}>
                            <View style={styles.globalAuditRowHead}>
                              <Text style={[styles.globalAuditAction, !entry.success && { color: '#ef4444' }]}>
                                {entry.action.toUpperCase()}{entry.success ? '' : ' · FAILED'}
                              </Text>
                              <Text style={styles.globalAuditTime}>{formatAuditTime(entry.createdAt)}</Text>
                            </View>
                            <Text style={styles.globalAuditTarget}>{tag}</Text>
                            {entry.purpose ? <Text style={styles.globalAuditPurpose}>{entry.purpose}</Text> : null}
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <Pressable
                    onPress={loadGlobalAudit}
                    disabled={globalAuditLoading}
                    style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor(globalAuditLoading ? 'wait' : 'pointer')]}
                  >
                    <Text style={[styles.secondaryText, { color: accentColor }]}>
                      {globalAuditLoading ? 'Loading...' : 'Refresh activity'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

              <Text style={styles.advancedFacts}>
                VAULT-{(circleId || '').replace(/-/g, '').slice(0, 8).toUpperCase() || '00000000'} · encrypted at rest · RLS scoped to circle members · every access audited
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {/* End-of-unlock light flood — mounted already at full opacity in the
          same frame the dashboard appears, then fades to reveal it. */}
      {revealing ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.revealFlashOverlay, { opacity: revealFlash }]}
        />
      ) : null}
    </View>
  );
}

function VaultLockScreen({
  accentColor,
  circleId,
  fullHeight,
  password,
  error,
  unlocking,
  opening,
  doorProgress,
  shake,
  denyFlash,
  onPasswordChange,
  onUnlock,
}: {
  accentColor: string;
  circleId: string;
  fullHeight: boolean;
  password: string;
  error: string;
  unlocking: boolean;
  opening: boolean;
  doorProgress: Animated.Value;
  shake: Animated.Value;
  denyFlash: Animated.Value;
  onPasswordChange: (value: string) => void;
  onUnlock: () => void;
}) {
  // ── Unlock choreography ─────────────────────────────────────────────
  // One shared 0→1 progress value, but every layer keys off its own phase
  // window so the open reads as a MECHANISM, not a crossfade:
  //   A 0→0.28 wheel · B →0.45 locking dogs · C →0.58 seal · D →1 swing.
  // The plate is frozen through A/B so the release has believable weight.
  const wheelRotate = doorProgress.interpolate({
    inputRange: [0, 0.28, 0.45, 1],
    outputRange: ['0deg', '540deg', '585deg', '585deg'],
  });
  const wheelScale = doorProgress.interpolate({
    inputRange: [0, 0.28, 0.45, 1],
    outputRange: [1, 1.035, 0.98, 0.98],
  });
  const dogRetreat = doorProgress.interpolate({
    inputRange: [0, 0.28, 0.44, 1],
    outputRange: [0, 0, 14, 14],
  });
  const sealOpacity = doorProgress.interpolate({
    inputRange: [0, 0.44, 0.58, 1],
    outputRange: [0.72, 0.72, 0.12, 0],
  });
  const doorSwing = doorProgress.interpolate({
    inputRange: [0, 0.46, 0.58, 1],
    outputRange: ['0deg', '0deg', '-6deg', '-72deg'],
  });
  const doorTranslateX = doorProgress.interpolate({
    inputRange: [0, 0.46, 0.58, 1],
    outputRange: [0, 0, -8, -118],
  });
  const doorScaleX = doorProgress.interpolate({
    inputRange: [0, 0.5, 0.64, 1],
    outputRange: [1, 1, 0.96, 0.68],
  });
  const doorDropY = doorProgress.interpolate({
    inputRange: [0, 0.3, 0.36, 1],
    outputRange: [0, 0, 2, 2],
  });
  const chamberOpacity = doorProgress.interpolate({
    inputRange: [0, 0.5, 0.64, 1],
    outputRange: [0.12, 0.12, 0.72, 1],
  });
  const chamberScale = doorProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.92, 0.92, 1.06],
  });
  const stageScale = doorProgress.interpolate({
    inputRange: [0, 0.28, 0.52, 1],
    outputRange: [1, 0.994, 1, 1.035],
  });
  const flashOpacity = doorProgress.interpolate({
    inputRange: [0, 0.8, 0.94, 1],
    outputRange: [0, 0, 0.72, 1],
  });
  const serial = (circleId || '').replace(/-/g, '').slice(0, 8).toUpperCase() || '00000000';

  // ── Idle ambient animation ──────────────────────────────────────────
  // A slow reflection and status pulse add material depth without making a
  // locked mechanical wheel rotate on its own.
  const idleProgress = useRef(new Animated.Value(0)).current;
  const reduceMotion = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  useEffect(() => {
    if (reduceMotion) {
      idleProgress.setValue(0.45);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idleProgress, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }),
        Animated.timing(idleProgress, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [idleProgress, reduceMotion]);

  const steelSweepX = idleProgress.interpolate({ inputRange: [0, 1], outputRange: [-180, 180] });
  const statusPulse = idleProgress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.45, 1, 0.45],
  });
  const reflectionOpacity = doorProgress.interpolate({
    inputRange: [0, 0.28, 0.48, 1],
    outputRange: [0.34, 0.2, 0, 0],
  });

  return (
    <View
      style={[
        styles.lockRoot,
        fullHeight ? styles.rootFullHeight : styles.rootPanelHeight,
      ]}
      nativeID="section-site-credential-vault-lock"
    >
      <Animated.View style={[styles.lockShell, { transform: [{ translateX: shake }] }]}>
        <View style={styles.lockCopy}>
          <View style={styles.lockEyebrowRow}>
            <Animated.View style={[styles.lockStatusDot, { backgroundColor: accentColor, opacity: statusPulse }]} />
            <Text style={styles.lockEyebrow}>UNDERGROUND CIRCLE / SECURE STORAGE</Text>
          </View>
          <Text style={styles.lockTitle}>The vault is sealed.</Text>
          <Text style={styles.lockSubtitle}>
            Re-authenticate to release the mechanical lock. Credentials remain unloaded until access is confirmed.
          </Text>
        </View>

        <Animated.View style={[styles.vaultStage, { transform: [{ scale: stageScale }, { translateY: doorDropY }] }]}>
          <View pointerEvents="none" style={styles.vaultWallPanelLeft}>
            <View style={styles.vaultWallInset} />
            <View style={styles.vaultWallInset} />
          </View>
          <View pointerEvents="none" style={styles.vaultWallPanelRight}>
            <View style={styles.vaultWallInset} />
            <View style={styles.vaultWallInset} />
          </View>

          {/* The chamber exists behind the seal from the first frame. Dim
              deposit boxes and converging floor lines create real depth as
              soon as the circular door starts to swing away. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.vaultChamber,
              { opacity: chamberOpacity, transform: [{ scale: chamberScale }] },
            ]}
          >
            <View style={styles.vaultChamberCeiling} />
            <View style={styles.vaultDepositWallLeft}>
              {Array.from({ length: 8 }).map((_, index) => (
                <View key={'left-box-' + index} style={styles.vaultDepositBox} />
              ))}
            </View>
            <View style={styles.vaultDepositWallRight}>
              {Array.from({ length: 8 }).map((_, index) => (
                <View key={'right-box-' + index} style={styles.vaultDepositBox} />
              ))}
            </View>
            <View style={styles.vaultChamberFloor}>
              <View style={[styles.vaultFloorLine, styles.vaultFloorLineLeft]} />
              <View style={[styles.vaultFloorLine, styles.vaultFloorLineCenter]} />
              <View style={[styles.vaultFloorLine, styles.vaultFloorLineRight]} />
            </View>
            <View style={[styles.vaultChamberLight, { backgroundColor: accentColor + '55' }]} />
          </Animated.View>

          {/* A fixed three-ring jamb makes the door feel installed in a thick
              wall. Its fasteners remain planted while the door face moves. */}
          <View pointerEvents="none" style={styles.vaultJambOuter}>
            {Array.from({ length: 16 }).map((_, index) => {
              const angle = (index / 16) * 360;
              return (
                <View
                  key={'frame-bolt-' + index}
                  style={[
                    styles.vaultFrameBolt,
                    { transform: [{ rotate: String(angle) + 'deg' }, { translateY: -137 }] },
                  ]}
                />
              );
            })}
            <View style={styles.vaultJambMiddle}>
              <View style={styles.vaultJambWell} />
            </View>
          </View>

          <View pointerEvents="none" style={styles.vaultHingeSpine}>
            <View style={styles.vaultHingeCap} />
            <View style={styles.vaultHingeKnuckle} />
            <View style={styles.vaultHingeKnuckle} />
            <View style={styles.vaultHingeKnuckle} />
            <View style={styles.vaultHingeCap} />
          </View>

          <Animated.View
            pointerEvents="none"
            style={[
              styles.vaultDoorAssembly,
              {
                transform: [
                  { perspective: 900 },
                  { translateX: doorTranslateX },
                  { rotateY: doorSwing },
                  { scaleX: doorScaleX },
                ],
              },
            ]}
          >
            <View style={styles.vaultDoorDepth} />
            <View style={styles.vaultDoorPlate}>
              <View style={styles.vaultDoorOuterRing} />
              <View style={styles.vaultDoorInnerRing} />

              {Array.from({ length: 12 }).map((_, index) => {
                const angle = (index / 12) * 360;
                return (
                  <View
                    key={'door-rivet-' + index}
                    style={[
                      styles.vaultDoorRivet,
                      { transform: [{ rotate: String(angle) + 'deg' }, { translateY: -101 }] },
                    ]}
                  />
                );
              })}

              {Array.from({ length: 8 }).map((_, index) => {
                const angle = (index / 8) * 360;
                return (
                  <Animated.View
                    key={'locking-dog-' + index}
                    style={[
                      styles.vaultLockingDog,
                      {
                        transform: [
                          { rotate: String(angle) + 'deg' },
                          { translateY: -113 },
                          { translateY: dogRetreat },
                        ],
                      },
                    ]}
                  >
                    <View style={styles.vaultLockingDogFace} />
                  </Animated.View>
                );
              })}

              <Animated.View
                style={[
                  styles.vaultSteelReflection,
                  { opacity: reflectionOpacity, transform: [{ translateX: steelSweepX }, { rotate: '16deg' }] },
                ]}
              />

              <Animated.View
                style={[
                  styles.vaultWheel,
                  { transform: [{ rotate: wheelRotate }, { scale: wheelScale }] },
                ]}
              >
                <View style={styles.vaultWheelNumberRing}>
                  {Array.from({ length: 24 }).map((_, index) => {
                    const angle = (index / 24) * 360;
                    return (
                      <View
                        key={'wheel-tick-' + index}
                        style={[
                          styles.vaultWheelTick,
                          index % 3 === 0 && styles.vaultWheelTickMajor,
                          { transform: [{ rotate: String(angle) + 'deg' }, { translateY: -54 }] },
                        ]}
                      />
                    );
                  })}
                </View>
                {Array.from({ length: 3 }).map((_, index) => (
                  <View
                    key={'wheel-spoke-' + index}
                    style={[styles.vaultWheelSpoke, { transform: [{ rotate: String(index * 60) + 'deg' }] }]}
                  >
                    <View style={[styles.vaultWheelHandle, styles.vaultWheelHandleLeft]} />
                    <View style={[styles.vaultWheelHandle, styles.vaultWheelHandleRight]} />
                  </View>
                ))}
                <View style={styles.vaultWheelHubOuter}>
                  <View style={[styles.vaultWheelHub, { borderColor: accentColor + '88' }]}>
                    <View style={[styles.vaultWheelHubPin, { backgroundColor: accentColor }]} />
                  </View>
                </View>
              </Animated.View>

              <View style={styles.vaultDoorMakerPlate}>
                <Text style={styles.vaultDoorMakerText}>UC / CLASS IV</Text>
              </View>
            </View>
            <View style={[styles.vaultHingeArm, styles.vaultHingeArmTop]} />
            <View style={[styles.vaultHingeArm, styles.vaultHingeArmBottom]} />
          </Animated.View>

          <Animated.View
            pointerEvents="none"
            style={[styles.vaultPressureSeal, { borderColor: accentColor + '99', opacity: sealOpacity }]}
          />

          <View pointerEvents="none" style={styles.vaultStageReadout}>
            <Animated.View style={[styles.vaultStageReadoutDot, { backgroundColor: accentColor, opacity: statusPulse }]} />
            <Text style={styles.vaultStageReadoutText}>{opening ? 'RELEASING' : 'SEALED'}</Text>
          </View>
          <View pointerEvents="none" style={styles.vaultSerialPlate}>
            <Text style={styles.vaultSerialPlateText}>VAULT-{serial}</Text>
          </View>

          <Animated.View
            pointerEvents="none"
            style={[styles.vaultDenyOverlay, { opacity: denyFlash }]}
          />
        </Animated.View>

        <View style={styles.unlockPanel}>
          <View style={styles.unlockPanelHeader}>
            <View style={styles.unlockPanelHeading}>
              <Text style={styles.unlockPanelTitle}>{opening ? 'Access granted' : 'Release the lock'}</Text>
              <Text style={styles.unlockPanelText}>
                {opening ? 'The locking dogs are retracting.' : 'Confirm your account password. It is checked once and never stored.'}
              </Text>
            </View>
            <View style={[styles.unlockStepBadge, { borderColor: accentColor + '55' }]}>
              <Text style={[styles.unlockStepBadgeText, { color: accentColor }]}>RE-AUTH</Text>
            </View>
          </View>
          <Text style={styles.unlockFieldLabel}>Account password</Text>
          <TextInput
            value={password}
            onChangeText={onPasswordChange}
            onSubmitEditing={onUnlock}
            editable={!unlocking && !opening}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={Platform.OS === 'web'}
            accessibilityLabel="Vault account password"
            accessibilityHint="Re-authenticates your account and opens the credential vault"
            placeholder="Enter account password"
            placeholderTextColor="#657186"
            style={[styles.unlockInput, error ? styles.unlockInputError : null]}
          />
          {error ? <Text style={styles.unlockError}>{error}</Text> : null}
          <Pressable
            onPress={onUnlock}
            disabled={unlocking || opening}
            accessibilityState={{ disabled: unlocking || opening, busy: unlocking || opening }}
            style={[
              styles.unlockButton,
              { backgroundColor: accentColor },
              (unlocking || opening) && styles.disabledBtn,
              webCursor(unlocking || opening ? 'wait' : 'pointer'),
            ]}
          >
            {unlocking || opening ? (
              <ActivityIndicator size="small" color="#061018" />
            ) : (
              <Text style={styles.unlockButtonText}>Open Vault</Text>
            )}
          </Pressable>
          <View style={styles.unlockAssuranceRow}>
            <Text style={styles.unlockAssurance}>ENCRYPTED AT REST</Text>
            <View style={styles.unlockAssuranceDivider} />
            <Text style={styles.unlockAssurance}>CIRCLE SCOPED</Text>
            <View style={styles.unlockAssuranceDivider} />
            <Text style={styles.unlockAssurance}>ACCESS LOGGED</Text>
          </View>
        </View>
      </Animated.View>
      {/* Terminal light flood — peaks as the door clears, and the parent
          hands the same brightness to a fading overlay on the dashboard so
          the swap happens inside the flash. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.vaultFlashOverlay,
          {
            opacity: flashOpacity,
            ...(Platform.OS === 'web'
              ? { boxShadow: `inset 0 0 120px ${accentColor}66` } as any
              : {}),
          },
        ]}
      />
    </View>
  );
}

function SecurityCount({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={[styles.securityCountPill, { borderColor: color + '44' }]}>
      <Text style={[styles.securityCountValue, { color }]}>{value}</Text>
      <Text style={styles.securityCountLabel}>{label}</Text>
    </View>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoLine}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  lockRoot: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    overflow: 'hidden',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        backgroundImage:
          'radial-gradient(circle at 50% 18%, rgba(148,163,184,0.09), transparent 34%), linear-gradient(160deg, #151b23 0%, #090d12 48%, #05070a 100%)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.48), inset 0 1px 0 rgba(255,255,255,0.05)',
      } as any,
      default: {},
    }) as any,
  },
  lockShell: {
    flex: 1,
    minHeight: 0,
    padding: 16,
    gap: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockCopy: {
    width: '100%',
    maxWidth: 680,
    alignItems: 'center',
    gap: 4,
  },
  lockEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  lockStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  lockEyebrow: {
    color: '#8b949e',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.9,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
    textAlign: 'center',
  },
  lockTitle: {
    color: '#e6edf3',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  lockSubtitle: {
    maxWidth: 620,
    color: '#8b949e',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  vaultStage: {
    width: '100%',
    maxWidth: 680,
    height: 310,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#3d4652',
    backgroundColor: '#111820',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        backgroundImage:
          'repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0 1px, transparent 1px 22px), linear-gradient(115deg, #222b35 0%, #111820 44%, #080c11 100%)',
        boxShadow:
          'inset 0 0 0 8px rgba(4,7,10,0.46), inset 0 0 72px rgba(0,0,0,0.8), 0 16px 36px rgba(0,0,0,0.42)',
      } as any,
      default: {},
    }) as any,
  },
  vaultWallPanelLeft: {
    position: 'absolute' as any,
    top: 10,
    bottom: 10,
    left: 10,
    width: 126,
    padding: 8,
    gap: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#ffffff0c',
    backgroundColor: '#0a0f15',
    zIndex: 0,
  },
  vaultWallPanelRight: {
    position: 'absolute' as any,
    top: 10,
    bottom: 10,
    right: 10,
    width: 126,
    padding: 8,
    gap: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#ffffff0c',
    backgroundColor: '#0a0f15',
    zIndex: 0,
  },
  vaultWallInset: {
    flex: 1,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ffffff0b',
    backgroundColor: '#111820',
    ...Platform.select({
      web: {
        boxShadow: 'inset 4px 5px 12px rgba(0,0,0,0.58), inset -1px -1px 0 rgba(255,255,255,0.035)',
      } as any,
      default: {},
    }) as any,
  },
  vaultChamber: {
    position: 'absolute' as any,
    width: 238,
    height: 238,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#53617144',
    backgroundColor: '#020408',
    overflow: 'hidden',
    zIndex: 4,
    ...Platform.select({
      web: {
        backgroundImage: 'radial-gradient(circle at 50% 42%, #17212a 0%, #060a0e 54%, #010203 100%)',
        boxShadow: 'inset 0 0 54px rgba(0,0,0,0.95)',
      } as any,
      default: {},
    }) as any,
  },
  vaultChamberCeiling: {
    position: 'absolute' as any,
    top: 0,
    left: 30,
    right: 30,
    height: 74,
    borderBottomLeftRadius: 42,
    borderBottomRightRadius: 42,
    borderBottomWidth: 1,
    borderBottomColor: '#7f8b9822',
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(180deg, rgba(123,139,153,0.18), rgba(20,28,36,0.02))',
      } as any,
      default: { backgroundColor: '#141d26' },
    }) as any,
  },
  vaultDepositWallLeft: {
    position: 'absolute' as any,
    left: 22,
    top: 52,
    width: 56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  vaultDepositWallRight: {
    position: 'absolute' as any,
    right: 22,
    top: 52,
    width: 56,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 3,
  },
  vaultDepositBox: {
    width: 26,
    height: 25,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#76839233',
    backgroundColor: '#1b2630',
    ...Platform.select({
      web: {
        boxShadow: 'inset 1px 1px 0 rgba(255,255,255,0.05), inset -2px -2px 5px rgba(0,0,0,0.5)',
      } as any,
      default: {},
    }) as any,
  },
  vaultChamberFloor: {
    position: 'absolute' as any,
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
    overflow: 'hidden',
    borderTopWidth: 1,
    borderTopColor: '#ffffff12',
    backgroundColor: '#070b0f',
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(180deg, #111820 0%, #030507 100%)',
      } as any,
      default: {},
    }) as any,
  },
  vaultFloorLine: {
    position: 'absolute' as any,
    bottom: -14,
    width: 1,
    height: 100,
    backgroundColor: '#8b98a51f',
  },
  vaultFloorLineLeft: {
    left: 68,
    transform: [{ rotate: '24deg' }],
  },
  vaultFloorLineCenter: {
    left: '50%',
  },
  vaultFloorLineRight: {
    right: 68,
    transform: [{ rotate: '-24deg' }],
  },
  vaultChamberLight: {
    position: 'absolute' as any,
    left: '50%',
    top: 72,
    marginLeft: -19,
    width: 38,
    height: 38,
    borderRadius: 999,
    ...Platform.select({
      web: {
        filter: 'blur(18px)',
        boxShadow: '0 0 38px rgba(255,255,255,0.16)',
      } as any,
      default: { opacity: 0.28 },
    }) as any,
  },
  vaultJambOuter: {
    position: 'absolute' as any,
    width: 294,
    height: 294,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#65717d',
    backgroundColor: '#29323c',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    ...Platform.select({
      web: {
        backgroundImage:
          'radial-gradient(circle at 38% 30%, #56616d 0%, #343e48 34%, #1a222b 67%, #0b1016 100%)',
        boxShadow:
          '0 18px 38px rgba(0,0,0,0.66), inset 0 2px 2px rgba(255,255,255,0.16), inset 0 -8px 18px rgba(0,0,0,0.62)',
      } as any,
      default: {},
    }) as any,
  },
  vaultFrameBolt: {
    position: 'absolute' as any,
    left: '50%',
    top: '50%',
    marginLeft: -4,
    marginTop: -4,
    width: 8,
    height: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0b1016',
    backgroundColor: '#b0b8c0',
    zIndex: 2,
    ...Platform.select({
      web: {
        boxShadow: 'inset 1px 1px 1px rgba(255,255,255,0.65), 0 2px 3px rgba(0,0,0,0.7)',
      } as any,
      default: {},
    }) as any,
  },
  vaultJambMiddle: {
    width: 270,
    height: 270,
    borderRadius: 999,
    borderWidth: 9,
    borderColor: '#111820',
    backgroundColor: '#353f49',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.1), inset 0 0 30px rgba(0,0,0,0.82)',
      } as any,
      default: {},
    }) as any,
  },
  vaultJambWell: {
    width: 242,
    height: 242,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#020305',
    backgroundColor: '#05080c',
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 0 32px rgba(0,0,0,0.96), 0 0 0 1px rgba(140,151,162,0.16)',
      } as any,
      default: {},
    }) as any,
  },
  vaultHingeSpine: {
    position: 'absolute' as any,
    left: '50%',
    top: '50%',
    marginLeft: -164,
    marginTop: -89,
    width: 24,
    height: 178,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#747f8a',
    backgroundColor: '#222b34',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 8,
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(90deg, #111820, #66717b 48%, #1b232c)',
        boxShadow: '4px 8px 12px rgba(0,0,0,0.62), inset 1px 0 0 rgba(255,255,255,0.18)',
      } as any,
      default: {},
    }) as any,
  },
  vaultHingeCap: {
    width: 28,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#8a949d',
    backgroundColor: '#39444e',
  },
  vaultHingeKnuckle: {
    width: 30,
    height: 38,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#8b96a1',
    backgroundColor: '#303a44',
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(90deg, #151c23, #7b8690 48%, #202932)',
        boxShadow: '3px 4px 7px rgba(0,0,0,0.5)',
      } as any,
      default: {},
    }) as any,
  },
  vaultDoorAssembly: {
    position: 'absolute' as any,
    width: 260,
    height: 260,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 7,
  },
  vaultDoorDepth: {
    position: 'absolute' as any,
    top: 7,
    left: -9,
    width: 260,
    height: 260,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#070a0d',
    backgroundColor: '#0b1015',
    ...Platform.select({
      web: {
        boxShadow: '-12px 16px 22px rgba(0,0,0,0.72)',
      } as any,
      default: {},
    }) as any,
  },
  vaultDoorPlate: {
    width: 252,
    height: 252,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#7a8590',
    backgroundColor: '#303a44',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        backgroundImage:
          'radial-gradient(circle at 35% 28%, rgba(255,255,255,0.2), transparent 22%), radial-gradient(circle at 50% 50%, #48535e 0%, #27313a 47%, #121920 78%, #090d12 100%)',
        boxShadow:
          'inset 0 2px 2px rgba(255,255,255,0.2), inset 0 -16px 24px rgba(0,0,0,0.5), 0 8px 18px rgba(0,0,0,0.58)',
      } as any,
      default: {},
    }) as any,
  },
  vaultDoorOuterRing: {
    position: 'absolute' as any,
    width: 220,
    height: 220,
    borderRadius: 999,
    borderWidth: 7,
    borderColor: '#121920',
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.13), 0 0 0 1px rgba(0,0,0,0.8)',
      } as any,
      default: {},
    }) as any,
  },
  vaultDoorInnerRing: {
    position: 'absolute' as any,
    width: 170,
    height: 170,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#69758066',
    backgroundColor: '#10161c55',
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 0 22px rgba(0,0,0,0.48), 0 2px 4px rgba(0,0,0,0.5)',
      } as any,
      default: {},
    }) as any,
  },
  vaultDoorRivet: {
    position: 'absolute' as any,
    left: '50%',
    top: '50%',
    marginLeft: -3,
    marginTop: -3,
    width: 6,
    height: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#12171d',
    backgroundColor: '#a5afb8',
    zIndex: 2,
  },
  vaultLockingDog: {
    position: 'absolute' as any,
    left: '50%',
    top: '50%',
    marginLeft: -9,
    marginTop: -14,
    width: 18,
    height: 28,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#0b0f14',
    backgroundColor: '#717c86',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(90deg, #263039, #a5afb8 50%, #303a43)',
        boxShadow: '0 3px 5px rgba(0,0,0,0.68)',
      } as any,
      default: {},
    }) as any,
  },
  vaultLockingDogFace: {
    width: 8,
    height: 15,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#ffffff30',
    backgroundColor: '#263039',
  },
  vaultSteelReflection: {
    position: 'absolute' as any,
    top: -44,
    width: 44,
    height: 340,
    backgroundColor: '#ffffff',
    zIndex: 3,
    ...Platform.select({
      web: {
        filter: 'blur(18px)',
      } as any,
      default: {},
    }) as any,
  },
  vaultWheel: {
    width: 124,
    height: 124,
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#b6bec6',
    backgroundColor: '#111820cc',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    ...Platform.select({
      web: {
        backgroundImage: 'radial-gradient(circle, #303a43 0%, #151c23 58%, #090d12 100%)',
        boxShadow:
          '0 10px 22px rgba(0,0,0,0.7), inset 0 1px 2px rgba(255,255,255,0.24), inset 0 -7px 12px rgba(0,0,0,0.6)',
      } as any,
      default: {},
    }) as any,
  },
  vaultWheelNumberRing: {
    position: 'absolute' as any,
    width: 112,
    height: 112,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d2d8dd33',
  },
  vaultWheelTick: {
    position: 'absolute' as any,
    left: '50%',
    top: '50%',
    marginLeft: -0.5,
    marginTop: -2.5,
    width: 1,
    height: 5,
    borderRadius: 1,
    backgroundColor: '#87919a',
  },
  vaultWheelTickMajor: {
    marginLeft: -1,
    marginTop: -4,
    width: 2,
    height: 8,
    backgroundColor: '#d4d9de',
  },
  vaultWheelSpoke: {
    position: 'absolute' as any,
    width: 94,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4f5a64',
    backgroundColor: '#b9c1c8',
    zIndex: 2,
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(180deg, #eef1f3, #7f8992 55%, #3d4650)',
        boxShadow: '0 3px 4px rgba(0,0,0,0.62), inset 0 1px 0 rgba(255,255,255,0.7)',
      } as any,
      default: {},
    }) as any,
  },
  vaultWheelHandle: {
    position: 'absolute' as any,
    top: -4,
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#535d66',
    backgroundColor: '#d8dde1',
  },
  vaultWheelHandleLeft: {
    left: -6,
  },
  vaultWheelHandleRight: {
    right: -6,
  },
  vaultWheelHubOuter: {
    width: 44,
    height: 44,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: '#747f88',
    backgroundColor: '#0d1319',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
    ...Platform.select({
      web: {
        boxShadow: '0 5px 10px rgba(0,0,0,0.68), inset 0 1px 1px rgba(255,255,255,0.14)',
      } as any,
      default: {},
    }) as any,
  },
  vaultWheelHub: {
    width: 28,
    height: 28,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: '#303943',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vaultWheelHubPin: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  vaultDoorMakerPlate: {
    position: 'absolute' as any,
    bottom: 27,
    minWidth: 92,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#77828c66',
    backgroundColor: '#0a0f14d9',
    zIndex: 4,
  },
  vaultDoorMakerText: {
    color: '#aeb7bf',
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.8,
    textAlign: 'center',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  vaultHingeArm: {
    position: 'absolute' as any,
    left: -22,
    width: 74,
    height: 16,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#707b85',
    backgroundColor: '#3d4750',
    zIndex: 8,
    ...Platform.select({
      web: {
        backgroundImage: 'linear-gradient(180deg, #808a93, #313b44 58%, #161e25)',
        boxShadow: '2px 5px 8px rgba(0,0,0,0.62)',
      } as any,
      default: {},
    }) as any,
  },
  vaultHingeArmTop: {
    top: 66,
    transform: [{ rotate: '-9deg' }],
  },
  vaultHingeArmBottom: {
    bottom: 66,
    transform: [{ rotate: '9deg' }],
  },
  vaultPressureSeal: {
    position: 'absolute' as any,
    width: 262,
    height: 262,
    borderRadius: 999,
    borderWidth: 2,
    zIndex: 9,
    ...Platform.select({
      web: {
        boxShadow: '0 0 12px rgba(255,255,255,0.08), inset 0 0 8px rgba(255,255,255,0.06)',
      } as any,
      default: {},
    }) as any,
  },
  vaultStageReadout: {
    position: 'absolute' as any,
    top: 13,
    right: 13,
    minHeight: 24,
    paddingHorizontal: 9,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#05080cd9',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 12,
  },
  vaultStageReadoutDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  vaultStageReadoutText: {
    color: '#b7c0c8',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.7,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  vaultSerialPlate: {
    position: 'absolute' as any,
    left: 13,
    bottom: 13,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#05080cd9',
    zIndex: 12,
  },
  vaultSerialPlateText: {
    color: '#8b949e',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.7,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  vaultDenyOverlay: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#f85149',
    backgroundColor: '#f8514912',
    zIndex: 20,
    ...Platform.select({
      web: {
        boxShadow: 'inset 0 0 48px rgba(248,81,73,0.22)',
      } as any,
      default: {},
    }) as any,
  },
  vaultFlashOverlay: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: '#e6edf3',
    zIndex: 50,
  },
  revealFlashOverlay: {
    position: 'absolute' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 18,
    backgroundColor: '#e6edf3',
    zIndex: 999,
  },
  unlockPanel: {
    width: '100%',
    maxWidth: 520,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#11161ddf',
    gap: 8,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(14px)',
        boxShadow: '0 14px 36px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.04)',
      } as any,
      default: {},
    }) as any,
  },
  unlockPanelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  unlockPanelHeading: {
    flex: 1,
    gap: 2,
  },
  unlockPanelTitle: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '700',
  },
  unlockPanelText: {
    color: '#8b949e',
    fontSize: 11,
    lineHeight: 16,
  },
  unlockStepBadge: {
    minHeight: 24,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unlockStepBadgeText: {
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.7,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  unlockFieldLabel: {
    color: '#c9d1d9',
    fontSize: 11,
    fontWeight: '600',
  },
  unlockInput: {
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
    color: '#e6edf3',
    paddingHorizontal: 12,
    fontSize: 14,
    ...Platform.select({
      web: {
        outlineStyle: 'none',
      } as any,
      default: {},
    }) as any,
  },
  unlockInputError: {
    borderColor: '#f85149',
  },
  unlockError: {
    color: '#ff7b72',
    fontSize: 12,
    lineHeight: 17,
  },
  unlockButton: {
    minHeight: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: {
        transition: 'background-color 0.18s ease, opacity 0.18s ease',
      } as any,
      default: {},
    }) as any,
  },
  unlockButtonText: {
    color: '#061018',
    fontSize: 12,
    fontWeight: '700',
  },
  unlockAssuranceRow: {
    minHeight: 16,
    marginTop: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  unlockAssurance: {
    color: '#6e7781',
    fontSize: 8.5,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  unlockAssuranceDivider: {
    width: 3,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#484f58',
  },
  root: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#080d14',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.04) 1px, transparent 0)',
        backgroundSize: '14px 14px',
      },
      default: {},
    }) as any,
  },
  rootPanelHeight: {
    maxHeight: 560,
  },
  rootFullHeight: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff12',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerText: {
    flex: 1,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  lockedPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  headerCount: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  refreshBtn: {
    alignSelf: 'flex-start',
    minWidth: 84,
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  refreshText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  lockNowBtn: {
    minWidth: 84,
    backgroundColor: '#1c1408',
  },
  status: {
    margin: 12,
    marginBottom: 0,
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
    color: '#d7e1ee',
    backgroundColor: '#0f172a',
    fontSize: 12,
  },
  scroller: {
    flex: 1,
  },
  scrollerPanelHeight: {
    maxHeight: 440,
  },
  scrollerFullHeight: {
    minHeight: 0,
  },
  scrollerContent: {
    padding: 12,
    gap: 12,
  },
  advancedBody: {
    padding: 12,
    paddingTop: 4,
    gap: 10,
  },
  advancedFacts: {
    color: '#64748b',
    fontSize: 10,
    letterSpacing: 0.8,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff14',
    backgroundColor: '#0d1320',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset, 0 4px 14px rgba(0,0,0,0.35)',
        transition: 'border-color 0.18s ease, box-shadow 0.18s ease',
      },
      default: {},
    }) as any,
  },
  cardExpanded: {
    borderColor: '#ffffff22',
    ...Platform.select({
      web: {
        boxShadow: '0 1px 0 rgba(255,255,255,0.06) inset, 0 8px 28px rgba(0,0,0,0.5)',
      },
      default: {},
    }) as any,
  },
  cardHeader: {
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardHeaderTouch: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardHeaderText: {
    flex: 1,
  },
  bulkCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#ffffff35',
    backgroundColor: '#050914',
  },
  bulkBar: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#0b1220',
    gap: 10,
  },
  bulkLabel: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  bulkActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tagInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'stretch',
  },
  tagInput: {
    flex: 1,
  },
  tagChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tagFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#050914',
  },
  tagFilterText: {
    color: '#aab4c2',
    fontSize: 11,
    fontWeight: '700',
  },
  importPreviewList: {
    gap: 6,
    maxHeight: 380,
  },
  importPreviewRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffffff10',
    backgroundColor: '#050914',
    alignItems: 'flex-start',
  },
  importPreviewBody: {
    flex: 1,
    gap: 2,
  },
  importPreviewTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
  },
  importPreviewMeta: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  securityHero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'stretch',
  },
  securityScoreRing: {
    width: 116,
    minHeight: 116,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#050914',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    ...Platform.select({
      web: {
        backgroundImage: 'radial-gradient(circle at center, rgba(20,184,166,0.14), transparent 66%)',
      } as any,
      default: {},
    }) as any,
  },
  securityScoreValue: {
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  securityScoreLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  securitySummaryBody: {
    flex: 1,
    minWidth: 240,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#070b13',
    gap: 8,
  },
  securityCountGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  securityCountPill: {
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#050914',
  },
  securityCountValue: {
    fontSize: 15,
    fontWeight: '900',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  securityCountLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  securityIssueList: {
    gap: 8,
  },
  securityIssueRow: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#050914',
    gap: 4,
  },
  securityIssueTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  securitySeverity: {
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  securityIssueTarget: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
  },
  securityIssueTitle: {
    color: '#eef2ff',
    fontSize: 12,
    fontWeight: '900',
  },
  entrySecurityList: {
    gap: 6,
  },
  entrySecurityIssue: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  totpBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#070b13',
    gap: 6,
    alignItems: 'flex-start',
  },
  totpLabel: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  totpCode: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 6,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  totpTimer: {
    color: '#7c8798',
    fontSize: 11,
    fontWeight: '700',
  },
  entrySettingsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffffff14',
    backgroundColor: '#0a101c',
  },
  entrySettingsToggleText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  entrySettingsBody: {
    gap: 10,
  },
  confirmRevealBox: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f59e0b55',
    backgroundColor: '#7c2d1212',
    gap: 8,
  },
  confirmRevealTitle: {
    color: '#fcd34d',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  confirmRevealTarget: {
    color: '#fcd34d',
    fontWeight: '900',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardTitle: {
    color: '#eef2ff',
    fontSize: 14,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  readinessBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  rotationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#451a03',
    color: '#fbbf24',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  inactiveBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#2b0b0b',
    color: '#fecaca',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  securityRiskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  testPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  cardMeta: {
    marginTop: 3,
    color: '#8b95a7',
    fontSize: 11,
  },
  chevron: {
    fontSize: 22,
    fontWeight: '800',
  },
  form: {
    borderTopWidth: 1,
    borderTopColor: '#ffffff10',
    padding: 14,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  field: {
    flex: 1,
    minWidth: 220,
    gap: 6,
  },
  label: {
    color: '#7c8798',
    fontSize: 10,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  input: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#050914',
    color: '#f8fafc',
    paddingHorizontal: 12,
    fontSize: 13,
  },
  notesInput: {
    minHeight: 78,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  inlineHelperBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  inlineHelperText: {
    fontSize: 11,
    fontWeight: '800',
  },
  secretInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  secretInput: {
    flex: 1,
  },
  generateBtn: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050914',
  },
  generateText: {
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  strengthBar: {
    height: 5,
    flex: 1,
    borderRadius: 99,
    backgroundColor: '#1f2937',
  },
  strengthText: {
    minWidth: 62,
    fontSize: 10,
    fontWeight: '800',
    textAlign: 'right',
  },
  breachBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#ef444412',
    gap: 4,
  },
  breachTitle: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  breachBody: {
    color: '#fecaca',
    fontSize: 11,
    lineHeight: 16,
  },
  breachSafeText: {
    marginTop: 6,
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  breachCheckText: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
    fontStyle: 'italic',
  },
  kindRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  kindChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#050914',
  },
  kindText: {
    color: '#aab4c2',
    fontSize: 11,
    fontWeight: '700',
  },
  sectionBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#070b13',
    gap: 9,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  helperText: {
    color: '#8b95a7',
    fontSize: 11,
    lineHeight: 16,
  },
  approvalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffffff35',
    backgroundColor: '#050914',
  },
  approvalText: {
    color: '#b9c3d0',
    fontSize: 12,
  },
  primaryBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#061018',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  disabledBtn: {
    opacity: 0.45,
  },
  filterCard: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#090f1a',
    gap: 10,
  },
  filterToggle: {
    minHeight: 32,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#050914',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterToggleText: {
    color: '#9ca3af',
    fontSize: 11,
    fontWeight: '800',
  },
  emptyCard: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#050914',
  },
  emptyTitle: {
    color: '#eef2ff',
    fontWeight: '800',
    fontSize: 14,
  },
  emptyText: {
    marginTop: 6,
    color: '#8793a3',
    fontSize: 12,
    lineHeight: 18,
  },
  globalAuditList: {
    gap: 6,
  },
  globalAuditRow: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffffff10',
    backgroundColor: '#050914',
    gap: 3,
  },
  globalAuditRowFailed: {
    borderColor: '#ef444433',
    backgroundColor: '#7f1d1d10',
  },
  globalAuditRowHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  globalAuditAction: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  globalAuditTime: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
  },
  globalAuditTarget: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  globalAuditPurpose: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 15,
  },
  entryBody: {
    borderTopWidth: 1,
    borderTopColor: '#ffffff10',
    padding: 14,
    gap: 10,
  },
  readinessBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#050914',
    gap: 6,
  },
  readinessTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  readinessScore: {
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  infoLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  infoLabel: {
    color: '#7c8798',
    fontSize: 11,
  },
  infoValue: {
    flex: 1,
    color: '#d7e1ee',
    fontSize: 11,
    textAlign: 'right',
  },
  secretBox: {
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff14',
    backgroundColor: '#040711',
    gap: 8,
    ...Platform.select({
      web: {
        backgroundImage:
          'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, transparent 1px), linear-gradient(180deg, transparent 50%, rgba(255,255,255,0.012) 50%)',
        backgroundSize: '100% 4px',
        transition: 'border-color 0.2s ease',
      } as any,
      default: {},
    }) as any,
  },
  secretHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  secretLabel: {
    color: '#94a3b8',
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: '900',
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  secretStatePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff18',
    color: '#64748b',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  secretValue: {
    color: '#f8fafc',
    fontSize: 15,
    letterSpacing: 1.4,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  secretTimer: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    fontFamily: Platform.select({ web: 'ui-monospace, "SF Mono", Menlo, monospace', default: 'monospace' }),
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  auditBox: {
    marginTop: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#070b13',
    gap: 8,
  },
  auditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  auditTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  auditEmpty: {
    color: '#7c8798',
    fontSize: 11,
  },
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#ffffff0d',
  },
  auditAction: {
    width: 54,
    color: '#93c5fd',
    fontSize: 10,
    fontWeight: '900',
  },
  auditActionFailed: {
    color: '#fca5a5',
  },
  auditPurpose: {
    flex: 1,
    color: '#cbd5e1',
    fontSize: 11,
  },
  auditDate: {
    color: '#7c8798',
    fontSize: 10,
    textAlign: 'right',
  },
  secondaryBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff20',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
  },
  dangerBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#2b0b0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: {
    color: '#fecaca',
    fontSize: 11,
    fontWeight: '800',
  },
});
