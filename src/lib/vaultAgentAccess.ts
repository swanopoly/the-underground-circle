import type { SiteCredentialVaultEntry } from './siteAutomation';

async function loadSiteAutomationVaultApi() {
  const mod = await import('./siteAutomation');
  return {
    listSiteCredentialVault: mod.listSiteCredentialVault,
    updateSiteCredentialVaultControls: mod.updateSiteCredentialVaultControls,
  };
}

export type VaultGranteeType = 'agent' | 'runtime' | 'chat' | 'member' | 'openswan';

export interface VaultAccessGrant {
  id: string;
  grantee: string;
  granteeType: VaultGranteeType;
  actions: string[];
  expiresAt?: string | null;
  note?: string | null;
  createdAt: string;
  createdBy?: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export type VaultSecuritySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface VaultSecurityIssue {
  id: string;
  credentialId: string;
  severity: VaultSecuritySeverity;
  title: string;
  detail: string;
  fix: string;
}

export interface VaultSecurityReport {
  score: number;
  grade: 'excellent' | 'good' | 'needs_work' | 'critical';
  counts: Record<VaultSecuritySeverity, number>;
  issues: VaultSecurityIssue[];
  credentialCount: number;
  affectedCredentialCount: number;
  expiredGrantCount: number;
  permanentGrantCount: number;
}

type VaultEntrySearchInput = {
  credentialId?: string | null;
  query?: string | null;
  platform?: string | null;
  action?: string | null;
};

type VaultGrantInput = VaultEntrySearchInput & {
  grantee: string;
  granteeType?: VaultGranteeType | null;
  actions?: string[] | null;
  expiresAt?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

type VaultRevokeInput = VaultEntrySearchInput & {
  grantee: string;
  granteeType?: VaultGranteeType | null;
};

export type VaultEntrySelection =
  | { ok: true; entry: SiteCredentialVaultEntry }
  | { ok: false; error: string; matches?: SiteCredentialVaultEntry[]; vaultMissing?: boolean };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeAction(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '');
}

function normalizeActions(values?: string[] | null): string[] {
  const actions = Array.from(new Set((values || []).map(normalizeAction).filter(Boolean)));
  return actions.length > 0 ? actions : ['login'];
}

function normalizeGranteeType(value?: string | null): VaultGranteeType {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'runtime') return 'runtime';
  if (normalized === 'chat') return 'chat';
  if (normalized === 'member') return 'member';
  if (normalized === 'openswan' || normalized === 'open_swan' || normalized === 'open-swan') return 'openswan';
  return 'agent';
}

function normalizeGrantee(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function grantKey(type: VaultGranteeType, grantee: string): string {
  const cleaned = `${type}:${grantee}`
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || `${type}:unknown`;
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

function safeDate(value?: string | null): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString();
}

function metadataBoolean(entry: SiteCredentialVaultEntry, key: string): boolean | null {
  const value = asRecord(entry.metadata)[key];
  return typeof value === 'boolean' ? value : null;
}

function metadataString(entry: SiteCredentialVaultEntry, key: string): string {
  const value = asRecord(entry.metadata)[key];
  return typeof value === 'string' ? value : '';
}

export function normalizedOrigin(value?: string | null): string | null {
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function tagsForEntry(entry: SiteCredentialVaultEntry): string[] {
  return stringArray(asRecord(entry.metadata).tags).map((tag) => tag.toLowerCase());
}

function entrySearchText(entry: SiteCredentialVaultEntry): string {
  return [
    entry.id,
    entry.platform,
    entry.label,
    entry.siteUrl || '',
    entry.loginUrl || '',
    entry.username || '',
    entry.secretKind,
    tagsForEntry(entry).join(' '),
    getVaultAccessGrants(entry).map((grant) => `${grant.granteeType}:${grant.grantee}`).join(' '),
  ].join(' ').toLowerCase();
}

export function getVaultEntryAllowedActions(entry: SiteCredentialVaultEntry): string[] {
  const actions = normalizeActions(stringArray(asRecord(entry.accessPolicy).allowed_actions));
  return actions.length > 0 ? actions : ['login'];
}

export function getVaultEntryAllowedOrigins(entry: SiteCredentialVaultEntry): string[] {
  const policyOrigins = stringArray(asRecord(entry.accessPolicy).allowed_origins);
  if (policyOrigins.length > 0) return policyOrigins;
  return [entry.siteUrl, entry.loginUrl].filter(Boolean).map(String);
}

export function getVaultAccessGrants(entry: SiteCredentialVaultEntry): VaultAccessGrant[] {
  const meta = asRecord(entry.metadata);
  const raw = Array.isArray(meta.agentGrants)
    ? meta.agentGrants
    : Array.isArray(meta.automationGrants)
      ? meta.automationGrants
      : [];

  const grants: VaultAccessGrant[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    const grantee = normalizeGrantee(String(record.grantee || ''));
    if (!grantee) continue;
    const granteeType = normalizeGranteeType(String(record.granteeType || record.grantee_type || 'agent'));
    const actions = normalizeActions(stringArray(record.actions));
    const id = String(record.id || grantKey(granteeType, grantee));
    grants.push({
      id,
      grantee,
      granteeType,
      actions,
      expiresAt: safeDate(String(record.expiresAt || record.expires_at || '')) || null,
      note: typeof record.note === 'string' ? record.note : null,
      createdAt: safeDate(String(record.createdAt || record.created_at || '')) || new Date(0).toISOString(),
      createdBy: typeof record.createdBy === 'string' ? record.createdBy : typeof record.created_by === 'string' ? record.created_by : null,
      updatedAt: safeDate(String(record.updatedAt || record.updated_at || '')) || null,
      updatedBy: typeof record.updatedBy === 'string' ? record.updatedBy : typeof record.updated_by === 'string' ? record.updated_by : null,
    });
  }
  return grants;
}

export function isVaultAccessGrantExpired(grant: VaultAccessGrant, now = Date.now()): boolean {
  if (!grant.expiresAt) return false;
  const ts = Date.parse(grant.expiresAt);
  return Number.isFinite(ts) && ts <= now;
}

export function isVaultEntryAutomationReady(entry: SiteCredentialVaultEntry): { ready: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!entry.isActive) issues.push('inactive');
  if (!entry.loginUrl && !entry.siteUrl) issues.push('missing login URL');
  if (!entry.username) issues.push('missing username');
  if (!getVaultEntryAllowedActions(entry).includes('login')) issues.push('login action not allowed');
  if (getVaultEntryAllowedOrigins(entry).length === 0) issues.push('missing allowed origin');
  if (entry.rotationDueAt && Number.isFinite(Date.parse(entry.rotationDueAt)) && Date.parse(entry.rotationDueAt) <= Date.now()) {
    issues.push('rotation due');
  }
  return { ready: issues.length === 0, issues };
}

export function analyzeVaultEntrySecurity(entry: SiteCredentialVaultEntry, now = Date.now()): VaultSecurityIssue[] {
  const issues: VaultSecurityIssue[] = [];
  const add = (severity: VaultSecuritySeverity, id: string, title: string, detail: string, fix: string) => {
    issues.push({ id: `${entry.id}:${id}`, credentialId: entry.id, severity, title, detail, fix });
  };
  const policy = asRecord(entry.accessPolicy);
  const actions = getVaultEntryAllowedActions(entry);
  const origins = getVaultEntryAllowedOrigins(entry);
  const grants = getVaultAccessGrants(entry);
  const expiredGrants = grants.filter((grant) => isVaultAccessGrantExpired(grant, now));
  const permanentGrants = grants.filter((grant) => !grant.expiresAt);
  const highRiskActions = actions.filter((action) => ['billing', 'settings', 'delete', 'purchase', 'publish', 'send'].includes(action));

  if (metadataBoolean(entry, 'breachFound') === true) {
    add('critical', 'breached-secret', 'Breached secret', 'This credential was found in known breach corpora during the last check.', 'Rotate the secret immediately and re-test.');
  }
  if (!entry.isActive) {
    add('low', 'inactive', 'Inactive credential', 'Inactive credentials still create vault inventory and audit noise.', 'Delete it if it is no longer needed.');
  }
  if (policy.require_approval === false) {
    add('high', 'approval-disabled', 'Approval disabled', 'Agents can use this credential without an explicit approval checkpoint.', 'Turn approval back on.');
  }
  if (origins.length === 0) {
    add('high', 'no-origin-scope', 'Missing origin scope', 'The credential has no allowed origin, so automation cannot strongly bind it to the expected website.', 'Set an allowed origin from the site or login URL.');
  }
  if (origins.some((origin) => origin === '*' || origin.includes('*'))) {
    add('high', 'wildcard-origin', 'Wildcard origin', 'Wildcard origins make it too easy for an agent to use the credential on the wrong website.', 'Replace wildcards with exact HTTPS origins.');
  }
  if (origins.some((origin) => /^http:\/\//i.test(origin))) {
    add('medium', 'plaintext-origin', 'Plain HTTP origin', 'A plaintext HTTP origin weakens protection for credential entry.', 'Use HTTPS origins whenever the service supports it.');
  }
  if (!entry.username && entry.secretKind !== 'api_token' && entry.secretKind !== 'oauth_token') {
    add('medium', 'missing-username', 'Missing username', 'Login automation may have to ask the user which account to use.', 'Add the username or account email.');
  }
  if (!entry.loginUrl && !entry.siteUrl) {
    add('high', 'missing-login-url', 'Missing login URL', 'Agents need an exact login destination to avoid searching or landing on phishing pages.', 'Add a login URL.');
  }
  if (entry.rotationDueAt && Number.isFinite(Date.parse(entry.rotationDueAt)) && Date.parse(entry.rotationDueAt) <= now) {
    add('medium', 'rotation-due', 'Rotation due', 'The rotation reminder is past due.', 'Rotate the secret or push the reminder forward after validation.');
  }
  if (metadataString(entry, 'lastTestedAt') && metadataBoolean(entry, 'lastTestSuccess') === false) {
    add('high', 'test-failed', 'Last test failed', 'The last connection test failed, so agents may burn time and API calls retrying a broken login.', 'Fix or rotate the credential, then run Test login again.');
  }
  if (!metadataString(entry, 'lastTestedAt')) {
    add('medium', 'not-tested', 'Never tested', 'This credential has not been validated for automation.', 'Run a non-destructive connection test or record a manual verification.');
  }
  if (expiredGrants.length > 0) {
    add('medium', 'expired-grants', 'Expired grants still stored', `${expiredGrants.length} expired automation grant${expiredGrants.length === 1 ? '' : 's'} remain in metadata.`, 'Remove expired grants.');
  }
  if (permanentGrants.length > 0) {
    add('medium', 'permanent-grants', 'Permanent automation grant', `${permanentGrants.length} grant${permanentGrants.length === 1 ? '' : 's'} have no expiration.`, 'Prefer short-lived grants for agents and runtimes.');
  }
  if (highRiskActions.length > 0 && metadataBoolean(entry, 'highTrust') !== true) {
    add('high', 'high-risk-actions', 'High-risk actions need high-trust gate', `Allowed actions include ${highRiskActions.join(', ')}.`, 'Enable high-trust confirmation and keep approval required.');
  }
  if (entry.secretKind === 'session_cookie') {
    add('high', 'session-cookie', 'Session cookie stored', 'Session cookies bypass normal login controls and can be highly sensitive.', 'Prefer API tokens or app passwords; if unavoidable, keep high-trust enabled and rotate often.');
  }
  const revealDuration = Number(policy.reveal_duration_seconds || 0);
  if (Number.isFinite(revealDuration) && revealDuration > 120) {
    add('medium', 'long-reveal', 'Long reveal window', `Manual reveal stays visible for ${revealDuration} seconds.`, 'Keep reveal windows at 30-60 seconds for normal credentials.');
  }

  return issues.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
}

function severityWeight(severity: VaultSecuritySeverity): number {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

export function buildVaultSecurityReport(entries: SiteCredentialVaultEntry[]): VaultSecurityReport {
  const issues = entries.flatMap((entry) => analyzeVaultEntrySecurity(entry));
  const counts: Record<VaultSecuritySeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
  for (const issue of issues) counts[issue.severity] += 1;
  const affectedCredentialCount = new Set(issues.map((issue) => issue.credentialId)).size;
  const expiredGrantCount = entries.reduce(
    (sum, entry) => sum + getVaultAccessGrants(entry).filter((grant) => isVaultAccessGrantExpired(grant)).length,
    0,
  );
  const permanentGrantCount = entries.reduce(
    (sum, entry) => sum + getVaultAccessGrants(entry).filter((grant) => !grant.expiresAt).length,
    0,
  );
  const score = Math.max(
    0,
    Math.min(100, 100 - counts.critical * 28 - counts.high * 14 - counts.medium * 7 - counts.low * 2),
  );
  const grade: VaultSecurityReport['grade'] =
    counts.critical > 0 ? 'critical' :
    score >= 90 ? 'excellent' :
    score >= 75 ? 'good' :
    'needs_work';
  return {
    score,
    grade,
    counts,
    issues,
    credentialCount: entries.length,
    affectedCredentialCount,
    expiredGrantCount,
    permanentGrantCount,
  };
}

export function formatVaultSecurityReport(entries: SiteCredentialVaultEntry[]): string {
  const report = buildVaultSecurityReport(entries);
  const lines = [
    `**Vault Security** — ${report.score}/100 (${report.grade.replace('_', ' ')})`,
    '',
    `Credentials: ${report.credentialCount}`,
    `Affected credentials: ${report.affectedCredentialCount}`,
    `Issues: ${report.counts.critical} critical · ${report.counts.high} high · ${report.counts.medium} medium · ${report.counts.low} low`,
    `Expired grants: ${report.expiredGrantCount}`,
    `Permanent grants: ${report.permanentGrantCount}`,
  ];
  if (report.issues.length > 0) {
    lines.push('', 'Top fixes:');
    for (const issue of report.issues.slice(0, 12)) {
      const entry = entries.find((item) => item.id === issue.credentialId);
      const name = entry ? `${entry.platform}/${entry.label}` : issue.credentialId.slice(0, 8);
      lines.push(`- [${issue.severity.toUpperCase()}] ${name}: ${issue.title} — ${issue.fix}`);
    }
  }
  return lines.join('\n');
}

export async function pruneExpiredVaultAccessGrants(
  circleId: string,
  entry: SiteCredentialVaultEntry,
  actorId?: string | null,
): Promise<{ ok: boolean; entry?: SiteCredentialVaultEntry; removed: number; resultsText: string }> {
  const grants = getVaultAccessGrants(entry);
  const activeGrants = grants.filter((grant) => !isVaultAccessGrantExpired(grant));
  const removed = grants.length - activeGrants.length;
  if (removed === 0) {
    return { ok: true, entry, removed: 0, resultsText: `${entry.platform}/${entry.label} has no expired grants.` };
  }
  const { updateSiteCredentialVaultControls } = await loadSiteAutomationVaultApi();
  const result = await updateSiteCredentialVaultControls({
    credentialId: entry.id,
    metadata: {
      agentGrants: activeGrants,
      automationAccessVersion: 1,
      expiredGrantPrunedAt: new Date().toISOString(),
      expiredGrantPrunedBy: actorId || null,
      circleId,
    },
  });
  if (result.error || !result.entry) {
    return { ok: false, removed: 0, resultsText: result.vaultMissing ? 'Vault controls RPC is not deployed yet.' : result.error || 'Failed to remove expired grants.' };
  }
  return {
    ok: true,
    entry: result.entry,
    removed,
    resultsText: `Removed ${removed} expired grant${removed === 1 ? '' : 's'} from ${result.entry.platform}/${result.entry.label}.`,
  };
}

export async function hardenVaultCredential(
  circleId: string,
  entry: SiteCredentialVaultEntry,
  actorId?: string | null,
): Promise<{ ok: boolean; entry?: SiteCredentialVaultEntry; resultsText: string }> {
  const policy = asRecord(entry.accessPolicy);
  const origins = getVaultEntryAllowedOrigins(entry);
  const inferredOrigins = Array.from(new Set([
    ...origins,
    normalizedOrigin(entry.siteUrl),
    normalizedOrigin(entry.loginUrl),
  ].filter(Boolean) as string[]));
  const grants = getVaultAccessGrants(entry).filter((grant) => !isVaultAccessGrantExpired(grant));
  const highRisk = analyzeVaultEntrySecurity(entry).some((issue) =>
    issue.severity === 'critical' || issue.severity === 'high',
  );
  const currentReveal = Number(policy.reveal_duration_seconds || 30);
  const { updateSiteCredentialVaultControls } = await loadSiteAutomationVaultApi();
  const result = await updateSiteCredentialVaultControls({
    credentialId: entry.id,
    accessPolicy: {
      ...policy,
      require_approval: true,
      allowed_actions: getVaultEntryAllowedActions(entry).includes('login')
        ? getVaultEntryAllowedActions(entry)
        : ['login', ...getVaultEntryAllowedActions(entry)],
      allowed_origins: inferredOrigins,
      reveal_duration_seconds: Number.isFinite(currentReveal) ? Math.min(Math.max(currentReveal, 15), 60) : 30,
    },
    metadata: {
      agentGrants: grants,
      automationAccessVersion: 1,
      highTrust: highRisk ? true : metadataBoolean(entry, 'highTrust') === true,
      securityHardenedAt: new Date().toISOString(),
      securityHardenedBy: actorId || null,
      circleId,
    },
  });
  if (result.error || !result.entry) {
    return { ok: false, resultsText: result.vaultMissing ? 'Vault controls RPC is not deployed yet.' : result.error || 'Failed to harden credential.' };
  }
  return {
    ok: true,
    entry: result.entry,
    resultsText: `Hardened ${result.entry.platform}/${result.entry.label}: approval on, origins scoped, reveal window capped, expired grants removed${highRisk ? ', high-trust enabled' : ''}.`,
  };
}

export async function findVaultAutomationEntries(
  circleId: string,
  input: Omit<VaultEntrySearchInput, 'credentialId'> = {},
): Promise<{ entries: SiteCredentialVaultEntry[]; error?: string; vaultMissing?: boolean }> {
  const platform = input.platform?.trim().toLowerCase() || undefined;
  const { listSiteCredentialVault } = await loadSiteAutomationVaultApi();
  const result = await listSiteCredentialVault(circleId, platform);
  if (result.error) return { entries: [], error: result.error, vaultMissing: result.vaultMissing };

  const action = normalizeAction(input.action || '');
  const terms = (input.query || '').trim().toLowerCase();
  const entries = result.entries.filter((entry) => {
    if (action && !getVaultEntryAllowedActions(entry).includes(action)) return false;
    if (!terms) return true;
    if (terms.startsWith('#')) return tagsForEntry(entry).includes(terms.slice(1));
    return entrySearchText(entry).includes(terms);
  });
  return { entries };
}

export async function selectVaultAutomationEntry(
  circleId: string,
  input: VaultEntrySearchInput,
): Promise<VaultEntrySelection> {
  const result = await findVaultAutomationEntries(circleId, {
    query: input.query,
    platform: input.platform,
    action: input.action,
  });
  if (result.error) return { ok: false, error: result.error, vaultMissing: result.vaultMissing };

  const credentialId = input.credentialId?.trim();
  let matches = result.entries;
  if (credentialId) {
    const exact = matches.find((entry) => entry.id === credentialId);
    if (exact) return { ok: true, entry: exact };
    matches = matches.filter((entry) => entry.id.startsWith(credentialId));
  }

  if (matches.length === 1) return { ok: true, entry: matches[0] };
  if (matches.length === 0) {
    return { ok: false, error: 'No matching vault credential found.' };
  }
  return {
    ok: false,
    error: `Multiple vault credentials match. Narrow the query or pass a credentialId: ${matches.slice(0, 8).map((entry) => `${entry.platform}/${entry.label} (${entry.id.slice(0, 8)})`).join(', ')}`,
    matches,
  };
}

export function formatVaultEntryAutomationSummary(entry: SiteCredentialVaultEntry): string {
  const readiness = isVaultEntryAutomationReady(entry);
  const activeGrants = getVaultAccessGrants(entry).filter((grant) => !isVaultAccessGrantExpired(grant));
  const grantText = activeGrants.length
    ? activeGrants.map((grant) => `${grant.granteeType}:${grant.grantee} [${grant.actions.join(',')}]`).join('; ')
    : 'none';
  return [
    `- ${entry.platform}/${entry.label} (${entry.id.slice(0, 8)}) ${readiness.ready ? '[ready]' : '[review]'}`,
    `  site: ${entry.siteUrl || 'not set'}`,
    `  login: ${entry.loginUrl || entry.siteUrl || 'not set'}`,
    `  username: ${entry.username || 'not set'}`,
    `  actions: ${getVaultEntryAllowedActions(entry).join(', ') || 'login'}`,
    `  origins: ${getVaultEntryAllowedOrigins(entry).join(', ') || 'not set'}`,
    `  grants: ${grantText}`,
    readiness.issues.length ? `  issues: ${readiness.issues.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

export function formatVaultGrantList(entry: SiteCredentialVaultEntry): string {
  const grants = getVaultAccessGrants(entry);
  if (grants.length === 0) return `${entry.platform}/${entry.label} (${entry.id.slice(0, 8)}) has no automation grants.`;
  const lines = [`${entry.platform}/${entry.label} (${entry.id.slice(0, 8)}) automation grants:`];
  for (const grant of grants) {
    const expired = isVaultAccessGrantExpired(grant);
    const expiry = grant.expiresAt ? ` until ${grant.expiresAt.slice(0, 10)}` : '';
    lines.push(`- ${grant.granteeType}:${grant.grantee} -> ${grant.actions.join(', ')}${expiry}${expired ? ' [expired]' : ''}${grant.note ? ` - ${grant.note}` : ''}`);
  }
  return lines.join('\n');
}

export function buildVaultAgentRunbook(
  entry: SiteCredentialVaultEntry,
  opts: { task?: string | null; grantee?: string | null; granteeType?: VaultGranteeType | null } = {},
): string {
  const actions = getVaultEntryAllowedActions(entry);
  const origins = getVaultEntryAllowedOrigins(entry);
  const metadata = asRecord(entry.metadata);
  const onePasswordItem = typeof metadata.onePasswordItem === 'string'
    ? metadata.onePasswordItem.trim()
    : typeof metadata.one_password_item === 'string'
      ? metadata.one_password_item.trim()
      : '';
  const task = opts.task?.trim();
  const grantee = normalizeGrantee(opts.grantee || 'OpenSwan');
  const granteeType = normalizeGranteeType(opts.granteeType || 'openswan');
  const expectedOrigin = origins[0] || entry.loginUrl || entry.siteUrl || '';
  return [
    `Vault runbook: ${entry.platform}/${entry.label}`,
    `Credential ID: ${entry.id}`,
    `Task: ${task || 'website automation requiring a saved login'}`,
    `Login URL: ${entry.loginUrl || entry.siteUrl || 'not set'}`,
    `Username: ${entry.username || 'not set'}`,
    `Allowed actions: ${actions.join(', ') || 'login'}`,
    `Allowed origins: ${origins.join(', ') || 'not set'}`,
    `Approval required: ${asRecord(entry.accessPolicy).require_approval === false ? 'no' : 'yes'}`,
    `Automation grantee: ${granteeType}:${grantee}`,
    '',
    'Agent instructions:',
    '1. Navigate to the login URL and confirm the current hostname matches an allowed origin.',
    '2. If the credential requires approval, ask the user before using it.',
    `3. For remote Computer Use, call fill_saved_login with credential_id="${entry.id}", grantee="${grantee}", grantee_type="${granteeType}", and a short purpose.`,
    onePasswordItem
      ? `4. For the local OpenSwan browser, use browser.fill_credential_field with item="${onePasswordItem}", expectedOrigin="${expectedOrigin}", and credentialField=username/email/password. Do not call credentials.get unless the safe browser-fill tool is unavailable.`
      : '4. For the local OpenSwan browser, use browser.fill_credential_field only when the task or credential metadata supplies the matching 1Password item name; otherwise pause and ask for the safe local credential mapping instead of fetching raw secrets.',
    '5. Never print, summarize, paste into chat, or store the secret outside the approved vault/browser tool.',
    '6. After login, only perform actions included in the allowed actions list and ask for approval before publish/delete/purchase/send.',
  ].join('\n');
}

export async function grantVaultAutomationAccess(
  circleId: string,
  input: VaultGrantInput,
): Promise<{ ok: boolean; entry?: SiteCredentialVaultEntry; grant?: VaultAccessGrant; resultsText: string }> {
  const selection = await selectVaultAutomationEntry(circleId, input);
  if (!selection.ok) return { ok: false, resultsText: selection.error };

  const grantee = normalizeGrantee(input.grantee);
  if (!grantee) return { ok: false, resultsText: 'A grantee name is required.' };
  const granteeType = normalizeGranteeType(input.granteeType);
  const requestedActions = normalizeActions(input.actions);
  const allowedActions = getVaultEntryAllowedActions(selection.entry);
  const blockedActions = requestedActions.filter((action) => !allowedActions.includes(action));
  if (blockedActions.length > 0) {
    return {
      ok: false,
      resultsText: `Cannot grant ${blockedActions.join(', ')} because ${selection.entry.platform}/${selection.entry.label} only allows: ${allowedActions.join(', ')}.`,
    };
  }

  const now = new Date().toISOString();
  const expiresAt = safeDate(input.expiresAt || null);
  const id = grantKey(granteeType, grantee);
  const existing = getVaultAccessGrants(selection.entry);
  const grant: VaultAccessGrant = {
    id,
    grantee,
    granteeType,
    actions: requestedActions,
    expiresAt,
    note: input.note?.trim() || null,
    createdAt: existing.find((item) => item.id === id)?.createdAt || now,
    createdBy: existing.find((item) => item.id === id)?.createdBy || input.createdBy || null,
    updatedAt: now,
    updatedBy: input.createdBy || null,
  };
  const nextGrants = [...existing.filter((item) => item.id !== id), grant];

  const { updateSiteCredentialVaultControls } = await loadSiteAutomationVaultApi();
  const updated = await updateSiteCredentialVaultControls({
    credentialId: selection.entry.id,
    metadata: {
      agentGrants: nextGrants,
      automationAccessVersion: 1,
      lastGrantUpdatedAt: now,
      lastGrantUpdatedBy: input.createdBy || null,
    },
  });
  if (updated.error || !updated.entry) {
    return { ok: false, resultsText: updated.vaultMissing ? 'Vault controls RPC is not deployed yet.' : updated.error || 'Failed to update vault grant.' };
  }

  const expiry = grant.expiresAt ? ` until ${grant.expiresAt.slice(0, 10)}` : '';
  return {
    ok: true,
    entry: updated.entry,
    grant,
    resultsText: `Granted ${granteeType}:${grantee} ${grant.actions.join(', ')} access to ${updated.entry.platform}/${updated.entry.label}${expiry}.`,
  };
}

export async function revokeVaultAutomationAccess(
  circleId: string,
  input: VaultRevokeInput,
): Promise<{ ok: boolean; entry?: SiteCredentialVaultEntry; resultsText: string }> {
  const selection = await selectVaultAutomationEntry(circleId, input);
  if (!selection.ok) return { ok: false, resultsText: selection.error };

  const grantee = normalizeGrantee(input.grantee);
  if (!grantee) return { ok: false, resultsText: 'A grantee name is required.' };
  const granteeType = normalizeGranteeType(input.granteeType);
  const id = grantKey(granteeType, grantee);
  const grants = getVaultAccessGrants(selection.entry);
  const nextGrants = grants.filter((grant) => grant.id !== id);
  if (nextGrants.length === grants.length) {
    return { ok: true, entry: selection.entry, resultsText: `${granteeType}:${grantee} did not have a grant on ${selection.entry.platform}/${selection.entry.label}.` };
  }

  const now = new Date().toISOString();
  const { updateSiteCredentialVaultControls } = await loadSiteAutomationVaultApi();
  const updated = await updateSiteCredentialVaultControls({
    credentialId: selection.entry.id,
    metadata: {
      agentGrants: nextGrants,
      automationAccessVersion: 1,
      lastGrantUpdatedAt: now,
    },
  });
  if (updated.error || !updated.entry) {
    return { ok: false, resultsText: updated.vaultMissing ? 'Vault controls RPC is not deployed yet.' : updated.error || 'Failed to revoke vault grant.' };
  }
  return {
    ok: true,
    entry: updated.entry,
    resultsText: `Revoked ${granteeType}:${grantee} access from ${updated.entry.platform}/${updated.entry.label}.`,
  };
}

export async function resolveVaultCredentialForTask(
  circleId: string,
  input: { task: string; platform?: string | null; siteUrl?: string | null; action?: string | null },
): Promise<{ ok: boolean; entry?: SiteCredentialVaultEntry; resultsText: string }> {
  const task = input.task.trim();
  const host = hostnameFromUrl(input.siteUrl || '') || '';
  const result = await findVaultAutomationEntries(circleId, {
    platform: input.platform,
    action: input.action || 'login',
  });
  if (result.error) return { ok: false, resultsText: result.vaultMissing ? 'Vault is not deployed yet.' : result.error };

  let matches = result.entries;
  if (host) {
    matches = matches.filter((entry) => {
      const hosts = [entry.siteUrl, entry.loginUrl, ...getVaultEntryAllowedOrigins(entry)]
        .map((value) => hostnameFromUrl(value))
        .filter(Boolean);
      return hosts.some((entryHost) => entryHost === host || host.endsWith(`.${entryHost}`));
    });
  }
  if (matches.length === 0) {
    return {
      ok: false,
      resultsText: `No vault credential is ready for "${task}". Use /vault list or add a credential in the Vault dashboard.`,
    };
  }

  const stopWords = new Set(['the', 'and', 'for', 'with', 'into', 'login', 'log', 'sign', 'website', 'site', 'task', 'using', 'saved', 'credential', 'credentials']);
  const tokens = Array.from(new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !stopWords.has(token))));
  const scored = matches.map((entry) => {
    const search = entrySearchText(entry);
    const ready = isVaultEntryAutomationReady(entry).ready;
    const updatedAt = Date.parse(entry.updatedAt || '') || 0;
    let score = ready ? 25 : 0;
    if (input.platform && entry.platform === input.platform.trim().toLowerCase()) score += 35;
    if (host) score += 100;
    for (const token of tokens) {
      if (search.includes(token)) score += token === entry.platform ? 30 : 8;
    }
    return { entry, score, updatedAt };
  }).sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);

  if (!host && !input.platform && scored[0].score === 0) {
    return {
      ok: false,
      resultsText: `No vault credential strongly matches "${task}". Narrow with a platform, site URL, or credential label.`,
    };
  }

  if (!host && !input.platform && scored.length > 1 && scored[0].score > 0 && scored[0].score === scored[1].score) {
    return {
      ok: false,
      resultsText: `Multiple vault credentials could fit "${task}". Narrow with a platform, site URL, or credential label: ${scored.slice(0, 6).map((item) => `${item.entry.platform}/${item.entry.label} (${item.entry.id.slice(0, 8)})`).join(', ')}`,
    };
  }

  const entry = scored[0].entry;
  return {
    ok: true,
    entry,
    resultsText: [
      `Best vault credential for "${task}":`,
      formatVaultEntryAutomationSummary(entry),
      '',
      buildVaultAgentRunbook(entry, { task, grantee: 'OpenSwan', granteeType: 'openswan' }),
    ].join('\n'),
  };
}
