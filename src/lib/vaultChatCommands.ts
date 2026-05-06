/**
 * Vault Chat Commands — /vault slash commands for ChatTab.
 *
 * Same shape as missionChatCommands.ts and wordpressChatCommands.ts so the
 * ChatTab dispatcher pattern stays uniform. All operations go through the
 * existing siteAutomation library so the panel and the chat surface read
 * the same data.
 */
import {
  listSiteCredentialVault,
  type SiteCredentialVaultEntry,
} from './siteAutomation';
import {
  buildVaultSecurityReport,
  buildVaultAgentRunbook,
  findVaultAutomationEntries,
  formatVaultSecurityReport,
  formatVaultGrantList,
  grantVaultAutomationAccess,
  hardenVaultCredential,
  pruneExpiredVaultAccessGrants,
  resolveVaultCredentialForTask,
  revokeVaultAutomationAccess,
  selectVaultAutomationEntry,
  type VaultGranteeType,
} from './vaultAgentAccess';

interface VaultCommandContext {
  circleId: string;
  userId: string;
}

interface VaultCommandResult {
  message: string;
  success: boolean;
}

const HELP_TEXT = [
  '**Vault Commands**',
  '`/vault` — show readiness summary',
  '`/vault list` — list every credential',
  '`/vault find <query>` — search by platform / label / username / URL',
  '`/vault grants [query]` — show which agents can use matching credentials',
  '`/vault grant <credential> to <agent|openswan|chat|member:name> actions=login,post [until=YYYY-MM-DD]` — give automation access',
  '`/vault revoke <credential> from <agent|openswan|chat|member:name>` — remove automation access',
  '`/vault runbook <query>` — safe instructions agents can use without seeing the secret',
  '`/vault resolve <task>` — find the best saved login for a website task',
  '`/vault status` — readiness counts (ready / needs test / rotation due)',
  '`/vault security` — security posture, risky grants, approval gaps, and top fixes',
  '`/vault harden <query>` — apply safer defaults to one credential',
  '`/vault cleanup expired-grants` — remove expired automation grants',
  '`/vault rotation` — credentials with overdue rotation',
  '`/vault help` — show this help',
].join('\n');

function entryMetadataString(entry: SiteCredentialVaultEntry, key: string): string {
  const meta = (entry.metadata || {}) as Record<string, unknown>;
  const value = meta[key];
  return typeof value === 'string' ? value : '';
}

function entryMetadataBoolean(entry: SiteCredentialVaultEntry, key: string): boolean | null {
  const meta = (entry.metadata || {}) as Record<string, unknown>;
  const value = meta[key];
  return typeof value === 'boolean' ? value : null;
}

function isRotationDue(entry: SiteCredentialVaultEntry): boolean {
  if (!entry.rotationDueAt) return false;
  const due = Date.parse(entry.rotationDueAt);
  return Number.isFinite(due) && due <= Date.now();
}

function readinessLabel(entry: SiteCredentialVaultEntry): { label: string; issues: string[] } {
  const issues: string[] = [];
  if (!entry.isActive) issues.push('inactive');
  if (!entry.loginUrl && !entry.siteUrl) issues.push('no login URL');
  if (!entry.username) issues.push('no username');
  if (isRotationDue(entry)) issues.push('rotation due');
  const lastTested = entryMetadataString(entry, 'lastTestedAt');
  const lastTestSuccess = entryMetadataBoolean(entry, 'lastTestSuccess');
  if (!lastTested) issues.push('not tested');
  if (lastTested && lastTestSuccess === false) issues.push('last test failed');
  if (entryMetadataBoolean(entry, 'breachFound') === true) issues.push('breached');

  if (issues.length === 0) return { label: 'READY', issues };
  if (issues.length <= 2) return { label: 'NEEDS REVIEW', issues };
  return { label: 'BLOCKED', issues };
}

function relativeAge(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'unknown';
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

function formatEntry(entry: SiteCredentialVaultEntry, indent = '  '): string {
  const readiness = readinessLabel(entry);
  const tag = `${entry.platform}/${entry.label}`;
  const target = entry.siteUrl || entry.loginUrl || '—';
  const userBit = entry.username ? ` · ${entry.username}` : '';
  const ageBit = entry.updatedAt ? ` · updated ${relativeAge(entry.updatedAt)}` : '';
  return `${indent}[${readiness.label}] ${tag}${userBit} → ${target}${ageBit}`;
}

async function loadEntries(circleId: string): Promise<{ entries: SiteCredentialVaultEntry[]; error?: string }> {
  const result = await listSiteCredentialVault(circleId);
  if (result.error) {
    if (result.vaultMissing) return { entries: [], error: 'Vault is not deployed yet — ask the owner to run the credential vault migration.' };
    return { entries: [], error: result.error };
  }
  return { entries: result.entries };
}

async function vaultStatus(ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const { entries, error } = await loadEntries(ctx.circleId);
  if (error) return { message: error, success: false };
  if (entries.length === 0) {
    return { message: 'Vault is empty. Open the **Office → Vault** panel and add a credential to get started.', success: true };
  }
  const ready = entries.filter((e) => readinessLabel(e).label === 'READY').length;
  const needsTest = entries.filter((e) => {
    const tested = entryMetadataString(e, 'lastTestedAt');
    return !tested || entryMetadataBoolean(e, 'lastTestSuccess') === false;
  }).length;
  const rotation = entries.filter(isRotationDue).length;
  const inactive = entries.filter((e) => !e.isActive).length;
  const breached = entries.filter((e) => entryMetadataBoolean(e, 'breachFound') === true).length;

  const lines: string[] = [];
  lines.push(`**Vault Status** — ${entries.length} credential${entries.length === 1 ? '' : 's'}`);
  lines.push('');
  lines.push(`  READY ........... ${ready}`);
  lines.push(`  NEEDS TEST ...... ${needsTest}`);
  lines.push(`  ROTATION DUE .... ${rotation}`);
  lines.push(`  INACTIVE ........ ${inactive}`);
  if (breached > 0) lines.push(`  BREACHED ........ ${breached}`);
  return { message: lines.join('\n'), success: true };
}

async function vaultList(ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const { entries, error } = await loadEntries(ctx.circleId);
  if (error) return { message: error, success: false };
  if (entries.length === 0) {
    return { message: 'Vault is empty. Open the **Office → Vault** panel to add the first credential.', success: true };
  }
  const lines = [`**Vault** — ${entries.length} credential${entries.length === 1 ? '' : 's'}`, ''];
  for (const entry of entries.slice(0, 50)) {
    lines.push(formatEntry(entry));
  }
  if (entries.length > 50) lines.push('', `…and ${entries.length - 50} more. Use \`/vault find <query>\` to narrow.`);
  return { message: lines.join('\n'), success: true };
}

function entryTagList(entry: SiteCredentialVaultEntry): string[] {
  const meta = (entry.metadata || {}) as Record<string, unknown>;
  const raw = meta.tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === 'string').map((tag) => tag.toLowerCase());
}

async function vaultFind(query: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const trimmed = query.trim();
  if (!trimmed) return { message: 'Usage: `/vault find <query>` — searches platform, label, username, URL, tags.', success: false };
  const { entries, error } = await loadEntries(ctx.circleId);
  if (error) return { message: error, success: false };
  const isTagQuery = trimmed.startsWith('#');
  const q = (isTagQuery ? trimmed.slice(1) : trimmed).toLowerCase();
  const matches = entries.filter((entry) => {
    if (isTagQuery) return entryTagList(entry).includes(q);
    return [
      entry.platform,
      entry.label,
      entry.siteUrl || '',
      entry.loginUrl || '',
      entry.username || '',
      entry.secretKind,
      entryTagList(entry).join(' '),
    ].some((value) => String(value).toLowerCase().includes(q));
  });
  if (matches.length === 0) {
    return { message: `No credentials match \`${trimmed}\`. Try \`/vault list\` to see everything stored.`, success: true };
  }
  const lines = [`**Vault search** — ${matches.length} match${matches.length === 1 ? '' : 'es'} for \`${trimmed}\``, ''];
  for (const entry of matches.slice(0, 20)) {
    lines.push(formatEntry(entry));
    const readiness = readinessLabel(entry);
    if (readiness.issues.length > 0) {
      lines.push(`        issues: ${readiness.issues.join(', ')}`);
    }
  }
  if (matches.length > 20) lines.push('', `…and ${matches.length - 20} more. Refine the query.`);
  return { message: lines.join('\n'), success: true };
}

async function vaultRotation(ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const { entries, error } = await loadEntries(ctx.circleId);
  if (error) return { message: error, success: false };
  const due = entries.filter(isRotationDue);
  if (due.length === 0) {
    return { message: 'No credentials are past their rotation deadline.', success: true };
  }
  const lines = [`**Rotation due** — ${due.length} credential${due.length === 1 ? '' : 's'}`, ''];
  for (const entry of due) {
    const dueIso = entry.rotationDueAt || '';
    const overdueDays = dueIso ? Math.max(0, Math.floor((Date.now() - Date.parse(dueIso)) / (1000 * 60 * 60 * 24))) : 0;
    lines.push(`${formatEntry(entry, '  ')}`);
    if (overdueDays > 0) lines.push(`        ${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`);
  }
  return { message: lines.join('\n'), success: true };
}

async function vaultSecurity(ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const { entries, error } = await loadEntries(ctx.circleId);
  if (error) return { message: error, success: false };
  if (entries.length === 0) {
    return { message: 'Vault is empty. Add credentials before running a security posture review.', success: true };
  }
  return { message: formatVaultSecurityReport(entries), success: true };
}

async function vaultHarden(query: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const trimmed = query.trim();
  if (!trimmed) return { message: 'Usage: `/vault harden <credential query>`', success: false };
  const selection = await selectVaultAutomationEntry(ctx.circleId, { query: trimmed });
  if (!selection.ok) return { message: selection.error, success: false };
  const result = await hardenVaultCredential(ctx.circleId, selection.entry, ctx.userId);
  return { message: result.resultsText, success: result.ok };
}

async function vaultCleanupExpiredGrants(ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const { entries, error } = await loadEntries(ctx.circleId);
  if (error) return { message: error, success: false };
  const report = buildVaultSecurityReport(entries);
  if (report.expiredGrantCount === 0) {
    return { message: 'No expired vault grants to clean up.', success: true };
  }
  let removed = 0;
  const failures: string[] = [];
  for (const entry of entries) {
    const result = await pruneExpiredVaultAccessGrants(ctx.circleId, entry, ctx.userId);
    if (result.ok) removed += result.removed;
    else failures.push(result.resultsText);
  }
  const suffix = failures.length > 0
    ? ` ${failures.length} credential${failures.length === 1 ? '' : 's'} failed: ${failures.slice(0, 3).join('; ')}`
    : '';
  return {
    message: `Removed ${removed} expired vault grant${removed === 1 ? '' : 's'}.${suffix}`,
    success: failures.length === 0,
  };
}

function parseOptionTail(value: string): {
  text: string;
  actions?: string[];
  until?: string;
  granteeType?: VaultGranteeType;
  note?: string;
} {
  let text = value;
  const actionsMatch = text.match(/\bactions=([a-z0-9_,:-]+)/i);
  const untilMatch = text.match(/\b(?:until|expires)=([0-9T:Z+_.-]+)/i);
  const typeMatch = text.match(/\btype=(agent|runtime|chat|member|openswan)\b/i);
  const noteMatch = text.match(/\bnote=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  text = text
    .replace(/\bactions=([a-z0-9_,:-]+)/ig, '')
    .replace(/\b(?:until|expires)=([0-9T:Z+_.-]+)/ig, '')
    .replace(/\btype=(agent|runtime|chat|member|openswan)\b/ig, '')
    .replace(/\bnote=(?:"([^"]+)"|'([^']+)'|([^\s]+))/ig, '')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    text,
    actions: actionsMatch ? actionsMatch[1].split(',').map((item) => item.trim()).filter(Boolean) : undefined,
    until: untilMatch ? untilMatch[1].replace(/_/g, ':') : undefined,
    granteeType: typeMatch ? typeMatch[1].toLowerCase() as VaultGranteeType : undefined,
    note: noteMatch ? (noteMatch[1] || noteMatch[2] || noteMatch[3] || '').trim() : undefined,
  };
}

function parseGrantee(value: string, fallbackType?: VaultGranteeType): { grantee: string; granteeType: VaultGranteeType } {
  const trimmed = value.trim();
  const prefixed = trimmed.match(/^(agent|runtime|chat|member|openswan):(.+)$/i);
  if (prefixed) {
    return {
      granteeType: prefixed[1].toLowerCase() as VaultGranteeType,
      grantee: prefixed[2].trim(),
    };
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'openswan' || lower === 'open swan') return { granteeType: 'openswan', grantee: 'OpenSwan' };
  if (lower === 'chat') return { granteeType: 'chat', grantee: 'chat' };
  return { granteeType: fallbackType || 'agent', grantee: trimmed };
}

async function vaultGrants(query: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const trimmed = query.trim();
  if (trimmed) {
    const selection = await selectVaultAutomationEntry(ctx.circleId, { query: trimmed });
    if (!selection.ok) return { message: selection.error, success: false };
    return { message: formatVaultGrantList(selection.entry), success: true };
  }

  const result = await findVaultAutomationEntries(ctx.circleId);
  if (result.error) {
    return {
      message: result.vaultMissing ? 'Vault is not deployed yet.' : result.error,
      success: false,
    };
  }
  const withGrants = result.entries.filter((entry) => formatVaultGrantList(entry).includes('->'));
  if (withGrants.length === 0) {
    return { message: 'No automation grants yet. Use `/vault grant <credential> to openswan actions=login` to grant access.', success: true };
  }
  return {
    message: ['**Vault grants**', '', ...withGrants.slice(0, 20).map(formatVaultGrantList)].join('\n\n'),
    success: true,
  };
}

async function vaultGrant(command: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const parsed = parseOptionTail(command);
  const match = parsed.text.match(/^(.+?)\s+to\s+(.+)$/i);
  if (!match) {
    return {
      message: 'Usage: `/vault grant <credential query> to <agent|openswan|chat|member:name> actions=login,post [until=YYYY-MM-DD]`',
      success: false,
    };
  }
  const grantee = parseGrantee(match[2], parsed.granteeType);
  const result = await grantVaultAutomationAccess(ctx.circleId, {
    query: match[1].trim(),
    grantee: grantee.grantee,
    granteeType: grantee.granteeType,
    actions: parsed.actions || ['login'],
    expiresAt: parsed.until,
    note: parsed.note,
    createdBy: ctx.userId,
  });
  return { message: result.resultsText, success: result.ok };
}

async function vaultRevoke(command: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const parsed = parseOptionTail(command);
  const match = parsed.text.match(/^(.+?)\s+from\s+(.+)$/i);
  if (!match) {
    return {
      message: 'Usage: `/vault revoke <credential query> from <agent|openswan|chat|member:name>`',
      success: false,
    };
  }
  const grantee = parseGrantee(match[2], parsed.granteeType);
  const result = await revokeVaultAutomationAccess(ctx.circleId, {
    query: match[1].trim(),
    grantee: grantee.grantee,
    granteeType: grantee.granteeType,
  });
  return { message: result.resultsText, success: result.ok };
}

async function vaultRunbook(query: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const trimmed = query.trim();
  if (!trimmed) return { message: 'Usage: `/vault runbook <credential query>`', success: false };
  const selection = await selectVaultAutomationEntry(ctx.circleId, { query: trimmed });
  if (!selection.ok) return { message: selection.error, success: false };
  return {
    message: buildVaultAgentRunbook(selection.entry, { task: `Use saved login for ${trimmed}`, grantee: 'OpenSwan', granteeType: 'openswan' }),
    success: true,
  };
}

async function vaultResolve(task: string, ctx: VaultCommandContext): Promise<VaultCommandResult> {
  const trimmed = task.trim();
  if (!trimmed) return { message: 'Usage: `/vault resolve <website task>`', success: false };
  const result = await resolveVaultCredentialForTask(ctx.circleId, { task: trimmed });
  return { message: result.resultsText, success: result.ok };
}

export async function executeVaultCommand(
  raw: string,
  ctx: VaultCommandContext,
): Promise<VaultCommandResult> {
  const args = raw.replace(/^\/vault\s*/i, '').trim();
  const cmd = args.toLowerCase();

  if (!args || cmd === 'status' || cmd === 'summary') return vaultStatus(ctx);
  if (cmd === 'list' || cmd === 'ls' || cmd === 'all') return vaultList(ctx);
  if (cmd === 'rotation' || cmd === 'rotations' || cmd === 'due') return vaultRotation(ctx);
  if (cmd === 'security' || cmd === 'audit security' || cmd === 'posture') return vaultSecurity(ctx);
  if (cmd === 'cleanup expired-grants' || cmd === 'cleanup expired grants' || cmd === 'prune expired-grants' || cmd === 'prune expired grants') {
    return vaultCleanupExpiredGrants(ctx);
  }
  if (cmd === 'help') return { message: HELP_TEXT, success: true };
  if (cmd === 'grants' || cmd === 'access') return vaultGrants('', ctx);
  if (cmd.startsWith('grants ') || cmd.startsWith('access ')) {
    const query = cmd.startsWith('grants ') ? args.slice(7) : args.slice(7);
    return vaultGrants(query, ctx);
  }
  if (cmd.startsWith('grant ')) return vaultGrant(args.slice(6), ctx);
  if (cmd.startsWith('harden ')) return vaultHarden(args.slice(7), ctx);
  if (cmd.startsWith('revoke ')) return vaultRevoke(args.slice(7), ctx);
  if (cmd.startsWith('runbook ')) return vaultRunbook(args.slice(8), ctx);
  if (cmd.startsWith('resolve ')) return vaultResolve(args.slice(8), ctx);
  if (cmd.startsWith('find ') || cmd.startsWith('search ')) {
    const query = cmd.startsWith('find ') ? args.slice(5) : args.slice(7);
    return vaultFind(query, ctx);
  }
  // Bare `find` / `search` with no query — give helpful hint.
  if (cmd === 'find' || cmd === 'search') {
    return { message: 'Usage: `/vault find <query>` — searches platform, label, username, URL.', success: false };
  }

  // Unknown subcommand — fall back to help so the user can self-correct.
  return { message: `Unknown vault subcommand: \`${args}\`.\n\n${HELP_TEXT}`, success: false };
}
