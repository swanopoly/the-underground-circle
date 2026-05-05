import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

interface Props {
  circleId: string;
  accentColor: string;
  fullHeight?: boolean;
}

type RiskFilter = 'all' | 'ready' | 'needs_test' | 'rotation_due' | 'inactive';

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

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=?';

function webCursor(cursor: string = 'pointer') {
  return Platform.OS === 'web' ? ({ cursor } as any) : null;
}

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

function generateVaultPassword(length: number = 28): string {
  const cryptoObj = (globalThis as any).crypto;
  if (!cryptoObj?.getRandomValues) {
    throw new Error('Secure random generator unavailable in this browser.');
  }
  const bytes = new Uint32Array(length);
  cryptoObj.getRandomValues(bytes);
  return Array.from(bytes, (value) => PASSWORD_CHARS[value % PASSWORD_CHARS.length]).join('');
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
  const [entries, setEntries] = useState<SiteCredentialVaultEntry[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>('new');
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
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const readiness = automationReadiness(entry);
      if (rotationOnly && !isRotationDue(entry)) return false;
      if (riskFilter === 'ready' && readiness.label !== 'Ready') return false;
      if (riskFilter === 'needs_test' && entryMetadataString(entry, 'lastTestedAt') && entryMetadataBoolean(entry, 'lastTestSuccess') !== false) return false;
      if (riskFilter === 'rotation_due' && !isRotationDue(entry)) return false;
      if (riskFilter === 'inactive' && entry.isActive) return false;
      if (!q) return true;
      return [
        entry.platform,
        entry.label,
        entry.siteUrl || '',
        entry.loginUrl || '',
        entry.username || '',
        entry.secretKind,
        entryAllowedActions(entry).join(' '),
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [entries, query, riskFilter, rotationOnly]);

  const loadVault = useCallback(async () => {
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
  }, [circleId]);

  const loadAudit = useCallback(async (credentialId: string) => {
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
  }, [circleId]);

  const [globalAuditOpen, setGlobalAuditOpen] = useState(false);
  const [globalAuditLoading, setGlobalAuditLoading] = useState(false);
  const [globalAuditError, setGlobalAuditError] = useState<string>('');
  const [globalAuditEntries, setGlobalAuditEntries] = useState<SiteCredentialAuditEntry[]>([]);

  const loadGlobalAudit = useCallback(async () => {
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
  }, [circleId]);

  useEffect(() => {
    if (globalAuditOpen) loadGlobalAudit();
  }, [globalAuditOpen, loadGlobalAudit]);

  useEffect(() => {
    loadVault();
  }, [loadVault]);

  useEffect(() => {
    if (!expandedId || expandedId === 'new') return;
    loadAudit(expandedId);
  }, [expandedId, loadAudit]);

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
    setExpandedId('new');
    setStatus(`Rotating ${entry.platform}/${entry.label}. Enter the new secret and save.`);
  };

  const handleReveal = async (entry: SiteCredentialVaultEntry) => {
    setStatus('');
    const duration = typeof entry.accessPolicy?.reveal_duration_seconds === 'number'
      ? Math.max(15, Math.min(300, entry.accessPolicy.reveal_duration_seconds))
      : 30;
    const result = await revealSiteCredentialSecret(entry.id, 'office_vault_reveal');
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

  return (
    <View
      style={[
        styles.root,
        fullHeight ? styles.rootFullHeight : styles.rootPanelHeight,
      ]}
      nativeID="section-site-credential-vault"
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.kicker}>SITE VAULT</Text>
          <Text style={styles.title}>Agent login vault</Text>
          <Text style={styles.subtitle}>
            Store website credentials, restrict what agents can do, and test readiness without putting passwords in prompts.
          </Text>
        </View>
        <Pressable
          onPress={loadVault}
          disabled={loading}
          style={[styles.refreshBtn, { borderColor: accentColor + '55' }, webCursor(loading ? 'wait' : 'pointer')]}
        >
          {loading ? <ActivityIndicator size="small" color={accentColor} /> : <Text style={[styles.refreshText, { color: accentColor }]}>Refresh</Text>}
        </Pressable>
      </View>

      {status ? <Text style={[styles.status, { borderColor: accentColor + '33' }]}>{status}</Text> : null}

      <ScrollView
        style={[styles.scroller, fullHeight ? styles.scrollerFullHeight : styles.scrollerPanelHeight]}
        contentContainerStyle={styles.scrollerContent}
        showsVerticalScrollIndicator
      >
        <View style={styles.statsGrid}>
          <MetricCard label="Credentials" value={String(entries.length)} />
          <MetricCard label="Ready" value={String(readinessStats.ready)} color="#22c55e" />
          <MetricCard label="Needs Test" value={String(readinessStats.needsTest)} color="#f59e0b" />
          <MetricCard label="Rotation Due" value={String(readinessStats.rotationDue)} color="#f97316" />
        </View>

        <View style={styles.card}>
          <Pressable
            onPress={() => setExpandedId(expandedId === 'new' ? null : 'new')}
            style={[styles.cardHeader, webCursor()]}
          >
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Add or Change Credentials</Text>
              <Text style={styles.cardMeta}>Encrypted at rest. Existing platform + label rotates the secret.</Text>
            </View>
            <Text style={[styles.chevron, { color: accentColor }]}>{expandedId === 'new' ? '-' : '+'}</Text>
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
          </View>
        ) : null}

        <View style={styles.card}>
          <Pressable
            onPress={() => setGlobalAuditOpen((value) => !value)}
            style={[styles.cardHeader, webCursor()]}
          >
            <View style={styles.cardHeaderText}>
              <Text style={styles.cardTitle}>Recent activity</Text>
              <Text style={styles.cardMeta}>Last 50 vault events across every credential. Use this for audits and incident review.</Text>
            </View>
            <Text style={[styles.chevron, { color: accentColor }]}>{globalAuditOpen ? '-' : '+'}</Text>
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

        {visibleEntries.map((entry) => {
          const expanded = expandedId === entry.id;
          const reveal = revealed[entry.id];
          const revealSeconds = reveal ? Math.max(0, Math.ceil((reveal.expiresAt - Date.now()) / 1000)) : 0;
          const rotationDue = isRotationDue(entry);
          const readiness = automationReadiness(entry);
          const actions = entryAllowedActions(entry);
          const origins = entryAllowedOrigins(entry);
          const isBusy = !!updating[entry.id] || !!testing[entry.id];
          return (
            <View key={entry.id} style={styles.card}>
              <Pressable onPress={() => setExpandedId(expanded ? null : entry.id)} style={[styles.cardHeader, webCursor()]}>
                <View style={styles.cardHeaderText}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{entry.platform} / {entry.label}</Text>
                    <Text style={[styles.readinessBadge, { color: readiness.color, borderColor: readiness.color + '55' }]}>{readiness.label}</Text>
                    {rotationDue ? <Text style={styles.rotationBadge}>Rotation due</Text> : null}
                    {!entry.isActive ? <Text style={styles.inactiveBadge}>Inactive</Text> : null}
                  </View>
                  <Text style={styles.cardMeta}>{entry.siteUrl || 'No site URL'} {entry.username ? `- ${entry.username}` : ''}</Text>
                </View>
                <Text style={[styles.chevron, { color: accentColor }]}>{expanded ? '-' : '+'}</Text>
              </Pressable>

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

                  <View style={styles.sectionBox}>
                    <Text style={styles.sectionTitle}>Service details</Text>
                    <InfoLine label="Login URL" value={entry.loginUrl || entry.siteUrl || 'Not set'} />
                    <InfoLine label="Secret type" value={entry.secretKind.replace(/_/g, ' ')} />
                    <InfoLine label="Username" value={entry.username || 'Not set'} />
                    <InfoLine label="Updated" value={formatDate(entry.updatedAt)} />
                    <InfoLine label="Last used" value={formatDate(entry.lastUsedAt)} />
                    <InfoLine label="Last tested" value={formatDate(entryMetadataString(entry, 'lastTestedAt'))} />
                    <InfoLine label="Rotation due" value={formatDate(entry.rotationDueAt)} />
                  </View>

                  <View style={styles.sectionBox}>
                    <Text style={styles.sectionTitle}>Security controls</Text>
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

                  <View style={styles.secretBox}>
                    <Text style={styles.secretLabel}>SECRET</Text>
                    <Text style={styles.secretValue}>{reveal ? reveal.secret : '••••••••••••••••'}</Text>
                    {reveal ? <Text style={styles.secretTimer}>Clears in {revealSeconds}s</Text> : null}
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable onPress={() => handleRotateFromEntry(entry)} style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor()]}>
                      <Text style={[styles.secondaryText, { color: accentColor }]}>Rotate</Text>
                    </Pressable>
                    <Pressable onPress={() => handleReveal(entry)} style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, webCursor()]}>
                      <Text style={[styles.secondaryText, { color: accentColor }]}>Reveal</Text>
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
          );
        })}
      </ScrollView>
    </View>
  );
}

function MetricCard({ label, value, color = '#cbd5e1' }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  root: {
    width: '100%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#ffffff18',
    backgroundColor: '#080d14',
    overflow: 'hidden',
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
  kicker: {
    color: '#8b95a7',
    fontSize: 10,
    letterSpacing: 1.6,
    fontFamily: 'monospace',
  },
  title: {
    marginTop: 4,
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    maxWidth: 720,
    color: '#9ca3af',
    fontSize: 12,
    lineHeight: 18,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    minWidth: 130,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff12',
    backgroundColor: '#050914',
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  metricLabel: {
    marginTop: 3,
    color: '#7c8798',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ffffff14',
    backgroundColor: '#0d1320',
    overflow: 'hidden',
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
  cardHeaderText: {
    flex: 1,
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
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff14',
    backgroundColor: '#050914',
  },
  secretLabel: {
    color: '#7c8798',
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  secretValue: {
    marginTop: 6,
    color: '#f8fafc',
    fontSize: 14,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  secretTimer: {
    marginTop: 6,
    color: '#fbbf24',
    fontSize: 11,
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
