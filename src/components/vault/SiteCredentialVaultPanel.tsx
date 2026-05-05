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
  revealSiteCredentialSecret,
  SiteCredentialAuditEntry,
  SiteCredentialSecretKind,
  SiteCredentialVaultEntry,
  storeSiteCredentialVault,
} from '../../lib/siteAutomation';

interface Props {
  circleId: string;
  accentColor: string;
  fullHeight?: boolean;
}

const SECRET_KINDS: Array<{ value: SiteCredentialSecretKind; label: string }> = [
  { value: 'password', label: 'Password' },
  { value: 'application_password', label: 'App password' },
  { value: 'api_token', label: 'API token' },
  { value: 'oauth_token', label: 'OAuth token' },
  { value: 'session_cookie', label: 'Session cookie' },
];

const PLATFORM_PRESETS: Array<{
  platform: string;
  label: string;
  secretKind: SiteCredentialSecretKind;
  loginPath?: string;
  hint: string;
}> = [
  { platform: 'wordpress', label: 'default', secretKind: 'application_password', loginPath: '/wp-login.php', hint: 'posts + pages' },
  { platform: 'shopify', label: 'admin', secretKind: 'password', loginPath: '/admin', hint: 'store admin' },
  { platform: 'webflow', label: 'workspace', secretKind: 'password', hint: 'designer' },
  { platform: 'cpanel', label: 'hosting', secretKind: 'password', hint: 'hosting panel' },
  { platform: 'github', label: 'automation', secretKind: 'api_token', hint: 'repo tasks' },
  { platform: 'stripe', label: 'restricted', secretKind: 'api_token', hint: 'payments' },
];

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=?';

function formatDate(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
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

function inferLoginUrl(platform: string, siteUrl: string): string {
  const base = normalizeBaseUrl(siteUrl);
  if (!base) return '';
  const normalizedPlatform = platform.trim().toLowerCase();
  if (normalizedPlatform === 'wordpress') return `${base}/wp-login.php`;
  if (normalizedPlatform === 'shopify') return `${base}/admin`;
  if (normalizedPlatform === 'webflow') return 'https://webflow.com/dashboard';
  if (normalizedPlatform === 'squarespace') return `${base}/config`;
  return base;
}

function isRotationDue(entry: SiteCredentialVaultEntry): boolean {
  if (!entry.rotationDueAt) return false;
  const due = new Date(entry.rotationDueAt).getTime();
  return Number.isFinite(due) && due <= Date.now();
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
  const [query, setQuery] = useState('');
  const [rotationOnly, setRotationOnly] = useState(false);

  const [platform, setPlatform] = useState('wordpress');
  const [label, setLabel] = useState('default');
  const [siteUrl, setSiteUrl] = useState('');
  const [loginUrl, setLoginUrl] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [secretKind, setSecretKind] = useState<SiteCredentialSecretKind>('application_password');
  const [requiresApproval, setRequiresApproval] = useState(true);

  const activeRevealCount = useMemo(
    () => Object.values(revealed).filter((item) => item.expiresAt > Date.now()).length,
    [revealed],
  );
  const secretStrength = useMemo(() => scoreSecretStrength(secret), [secret]);
  const visibleEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (rotationOnly && !isRotationDue(entry)) return false;
      if (!q) return true;
      return [
        entry.platform,
        entry.label,
        entry.siteUrl || '',
        entry.loginUrl || '',
        entry.username || '',
        entry.secretKind,
      ].some((value) => value.toLowerCase().includes(q));
    });
  }, [entries, query, rotationOnly]);
  const rotationDueCount = useMemo(
    () => entries.filter(isRotationDue).length,
    [entries],
  );

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

  const handlePreset = (preset: typeof PLATFORM_PRESETS[number]) => {
    setPlatform(preset.platform);
    setLabel(preset.label);
    setSecretKind(preset.secretKind);
    if (siteUrl.trim() && preset.loginPath) {
      setLoginUrl(`${normalizeBaseUrl(siteUrl)}${preset.loginPath}`);
    } else if (preset.platform === 'webflow') {
      setLoginUrl('https://webflow.com/dashboard');
    }
    setExpandedId('new');
  };

  const handleInferLoginUrl = () => {
    const next = inferLoginUrl(platform, siteUrl);
    if (!next) {
      setStatus('Enter a site URL first.');
      return;
    }
    setLoginUrl(next);
  };

  const handleSave = async () => {
    if (!platform.trim() || !secret) {
      setStatus('Platform and secret are required.');
      return;
    }

    setSaving(true);
    setStatus('');
    const result = await storeSiteCredentialVault({
      circleId,
      platform,
      siteUrl,
      loginUrl,
      username,
      secret,
      label,
      secretKind,
      accessPolicy: {
        require_approval: requiresApproval,
        allowed_origins: siteUrl.trim() ? [siteUrl.trim()] : [],
        allowed_actions: ['login', 'post', 'edit'],
      },
      metadata: {
        source: 'office_vault',
        savedAt: new Date().toISOString(),
      },
      // Rotation date is opt-in — left unset so users aren't forced
      // into a 90-day cadence they didn't ask for. The DB column
      // stays available for any future "schedule rotation" workflow.
      rotationDueAt: null,
    });

    if (result.error) {
      setStatus(result.error);
    } else {
      resetForm();
      setExpandedId(result.entry?.id || null);
      setStatus('Credential saved.');
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
    setExpandedId('new');
    setStatus(`Rotating ${entry.platform}/${entry.label}. Enter the new secret and save.`);
  };

  const handleReveal = async (entry: SiteCredentialVaultEntry) => {
    setStatus('');
    const result = await revealSiteCredentialSecret(entry.id, 'office_vault_reveal');
    if (result.error || !result.result) {
      setStatus(result.error || 'Could not reveal secret.');
      return;
    }

    setRevealed((current) => ({
      ...current,
      [entry.id]: {
        secret: result.result!.secret,
        expiresAt: Date.now() + 30_000,
      },
    }));
    setEntries((current) => current.map((item) => item.id === entry.id ? result.result!.entry : item));
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
        <View>
          <Text style={styles.kicker}>SITE VAULT</Text>
          <Text style={styles.title}>Agent login vault</Text>
          <Text style={styles.subtitle}>
            Store website credentials for approved automation without putting passwords in prompts.
          </Text>
        </View>
        <Pressable
          onPress={loadVault}
          disabled={loading}
          style={[styles.refreshBtn, { borderColor: accentColor + '55' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
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
        <View style={styles.card}>
          <Pressable
            onPress={() => setExpandedId(expandedId === 'new' ? null : 'new')}
            style={[styles.cardHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <View>
              <Text style={styles.cardTitle}>Add or rotate credential</Text>
              <Text style={styles.cardMeta}>Encrypted at rest. Existing platform + label rotates the secret.</Text>
            </View>
            <Text style={[styles.chevron, { color: accentColor }]}>{expandedId === 'new' ? '-' : '+'}</Text>
          </Pressable>

          {expandedId === 'new' ? (
            <View style={styles.form}>
              <View style={styles.presetGrid}>
                {PLATFORM_PRESETS.map((preset) => (
                  <Pressable
                    key={preset.platform}
                    onPress={() => handlePreset(preset)}
                    style={[
                      styles.presetChip,
                      platform === preset.platform && { borderColor: accentColor + '88', backgroundColor: accentColor + '14' },
                      Platform.OS === 'web' && { cursor: 'pointer' } as any,
                    ]}
                  >
                    <Text style={[styles.presetName, platform === preset.platform && { color: accentColor }]}>
                      {preset.platform}
                    </Text>
                    <Text style={styles.presetHint}>{preset.hint}</Text>
                  </Pressable>
                ))}
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
                <Pressable
                  onPress={handleInferLoginUrl}
                  style={[styles.inlineHelperBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
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
                    <Pressable
                      onPress={handleGeneratePassword}
                      style={[styles.generateBtn, { borderColor: accentColor + '55' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
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
                </View>
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
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={[styles.kindText, active && { color: accentColor }]}>{kind.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                onPress={() => setRequiresApproval((value) => !value)}
                style={[styles.approvalRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <View style={[styles.checkbox, requiresApproval && { backgroundColor: accentColor, borderColor: accentColor }]} />
                <Text style={styles.approvalText}>Require human approval before agents use this credential</Text>
              </Pressable>

              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={[styles.primaryBtn, { backgroundColor: accentColor }, saving && styles.disabledBtn, Platform.OS === 'web' && { cursor: saving ? 'wait' : 'pointer' } as any]}
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
              placeholder="Search by platform, site, user, or label"
              placeholderTextColor="#535b66"
            />
            <Pressable
              onPress={() => setRotationOnly((value) => !value)}
              style={[
                styles.filterToggle,
                rotationOnly && { borderColor: accentColor + '88', backgroundColor: accentColor + '14' },
                Platform.OS === 'web' && { cursor: 'pointer' } as any,
              ]}
            >
              <Text style={[styles.filterToggleText, rotationOnly && { color: accentColor }]}>
                Rotation due ({rotationDueCount})
              </Text>
            </Pressable>
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
            <Text style={styles.emptyText}>Clear search or turn off the rotation filter to see all saved credentials.</Text>
          </View>
        ) : null}

        {visibleEntries.map((entry) => {
          const expanded = expandedId === entry.id;
          const reveal = revealed[entry.id];
          const revealSeconds = reveal ? Math.max(0, Math.ceil((reveal.expiresAt - Date.now()) / 1000)) : 0;
          const rotationDue = isRotationDue(entry);
          return (
            <View key={entry.id} style={styles.card}>
              <Pressable
                onPress={() => setExpandedId(expanded ? null : entry.id)}
                style={[styles.cardHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.cardTitleRow}>
                    <Text style={styles.cardTitle}>{entry.platform} / {entry.label}</Text>
                    {rotationDue ? <Text style={styles.rotationBadge}>Rotation due</Text> : null}
                  </View>
                  <Text style={styles.cardMeta}>{entry.siteUrl || 'No site URL'} {entry.username ? `- ${entry.username}` : ''}</Text>
                </View>
                <Text style={[styles.chevron, { color: accentColor }]}>{expanded ? '-' : '+'}</Text>
              </Pressable>

              {expanded ? (
                <View style={styles.entryBody}>
                  <InfoLine label="Login URL" value={entry.loginUrl || entry.siteUrl || 'Not set'} />
                  <InfoLine label="Secret type" value={entry.secretKind.replace(/_/g, ' ')} />
                  <InfoLine label="Approval" value={entry.accessPolicy?.require_approval === false ? 'Not required' : 'Required'} />
                  <InfoLine label="Updated" value={formatDate(entry.updatedAt)} />
                  <InfoLine label="Last used" value={formatDate(entry.lastUsedAt)} />
                  <InfoLine label="Rotation due" value={formatDate(entry.rotationDueAt)} />

                  <View style={styles.secretBox}>
                    <Text style={styles.secretLabel}>SECRET</Text>
                    <Text style={styles.secretValue}>
                      {reveal ? reveal.secret : '••••••••••••••••'}
                    </Text>
                    {reveal ? <Text style={styles.secretTimer}>Clears in {revealSeconds}s</Text> : null}
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable
                      onPress={() => handleRotateFromEntry(entry)}
                      style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={[styles.secondaryText, { color: accentColor }]}>Rotate</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleReveal(entry)}
                      style={[styles.secondaryBtn, { borderColor: accentColor + '55' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={[styles.secondaryText, { color: accentColor }]}>Reveal 30s</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleCopyUsername(entry)}
                      disabled={!entry.username}
                      style={[styles.secondaryBtn, !entry.username && styles.disabledBtn, Platform.OS === 'web' && { cursor: entry.username ? 'pointer' : 'not-allowed' } as any]}
                    >
                      <Text style={styles.secondaryText}>Copy user</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleCopySecret(entry)}
                      disabled={!reveal}
                      style={[styles.secondaryBtn, !reveal && styles.disabledBtn, Platform.OS === 'web' && { cursor: reveal ? 'pointer' : 'not-allowed' } as any]}
                    >
                      <Text style={styles.secondaryText}>Copy</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(entry)}
                      style={[styles.dangerBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
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
    maxWidth: 620,
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
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetChip: {
    minWidth: 118,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ffffff16',
    backgroundColor: '#050914',
  },
  presetName: {
    color: '#d7e1ee',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  presetHint: {
    marginTop: 3,
    color: '#7c8798',
    fontSize: 10,
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
    alignSelf: 'flex-start',
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
  entryBody: {
    borderTopWidth: 1,
    borderTopColor: '#ffffff10',
    padding: 14,
    gap: 10,
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
