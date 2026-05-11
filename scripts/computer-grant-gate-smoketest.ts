/**
 * computer-grant-gate-smoketest — pins the local vault grant/readiness
 * rules used before agents can automate logins with saved credentials.
 *
 * Run: npm run smoke:computer-grant-gate
 */

import {
  analyzeVaultEntrySecurity,
  buildVaultSecurityReport,
  formatVaultGrantList,
  getVaultAccessGrants,
  getVaultEntryAllowedActions,
  getVaultEntryAllowedOrigins,
  isVaultAccessGrantExpired,
  isVaultEntryAutomationReady,
} from '../src/lib/vaultAgentAccess';
import type { SiteCredentialVaultEntry } from '../src/lib/siteAutomation';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, name: string, detail?: string) {
  if (condition) pass(name);
  else fail(`${name}${detail ? ' - ' + detail : ''}`);
}

function entry(patch: Partial<SiteCredentialVaultEntry> = {}): SiteCredentialVaultEntry {
  const now = new Date('2026-05-06T12:00:00Z').toISOString();
  return {
    id: 'cred_1234567890',
    circleId: 'circle_1',
    platform: 'wordpress',
    siteUrl: 'https://example.com',
    loginUrl: 'https://example.com/wp-login.php',
    username: 'editor@example.com',
    label: 'default',
    secretKind: 'application_password',
    metadata: { lastTestedAt: now, lastTestSuccess: true },
    accessPolicy: {
      require_approval: true,
      allowed_actions: ['login'],
      allowed_origins: ['https://example.com'],
      reveal_duration_seconds: 45,
    },
    isActive: true,
    createdBy: 'user_1',
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    lastUsedBy: null,
    expiresAt: null,
    rotationDueAt: null,
    ...patch,
  };
}

function main() {
  const base = entry();
  assert(isVaultEntryAutomationReady(base).ready, 'ready credential passes automation gate');
  assert(getVaultEntryAllowedActions(base).includes('login'), 'allowed actions normalize login');
  assert(getVaultEntryAllowedOrigins(base)[0] === 'https://example.com', 'allowed origin stays exact');

  const missingOrigin = entry({ accessPolicy: { ...base.accessPolicy, allowed_origins: [] }, siteUrl: null, loginUrl: null });
  const missingOriginReady = isVaultEntryAutomationReady(missingOrigin);
  assert(!missingOriginReady.ready, 'missing origin/login URL blocks automation readiness');
  assert(missingOriginReady.issues.includes('missing login URL'), 'missing login URL issue is reported');

  const expiredGrantEntry = entry({
    metadata: {
      lastTestedAt: '2026-05-06T12:00:00Z',
      lastTestSuccess: true,
      agentGrants: [
        {
          grantee: 'OpenSwan',
          granteeType: 'openswan',
          actions: ['login'],
          expiresAt: '2026-05-01T12:00:00Z',
          createdAt: '2026-04-01T12:00:00Z',
        },
      ],
    },
  });
  const grants = getVaultAccessGrants(expiredGrantEntry);
  assert(grants.length === 1, 'grant metadata is parsed');
  assert(isVaultAccessGrantExpired(grants[0], Date.parse('2026-05-06T12:00:00Z')), 'expired grant is blocked');
  assert(formatVaultGrantList(expiredGrantEntry).includes('[expired]'), 'expired grant is labeled in output');

  const risky = entry({
    accessPolicy: {
      require_approval: false,
      allowed_actions: ['login', 'publish', 'delete'],
      allowed_origins: ['*'],
      reveal_duration_seconds: 600,
    },
    metadata: { lastTestedAt: '2026-05-06T12:00:00Z', lastTestSuccess: true },
  });
  const issues = analyzeVaultEntrySecurity(risky, Date.parse('2026-05-06T12:00:00Z'));
  assert(issues.some((issue) => issue.id.endsWith(':approval-disabled') && issue.severity === 'high'), 'approval-disabled is high severity');
  assert(issues.some((issue) => issue.id.endsWith(':wildcard-origin') && issue.severity === 'high'), 'wildcard origin is high severity');
  assert(issues.some((issue) => issue.id.endsWith(':high-risk-actions') && issue.severity === 'high'), 'high-risk actions require high-trust gate');
  assert(issues.some((issue) => issue.id.endsWith(':long-reveal') && issue.severity === 'medium'), 'long reveal window is flagged');

  const report = buildVaultSecurityReport([base, expiredGrantEntry, risky]);
  assert(report.credentialCount === 3, 'report counts credentials');
  assert(report.expiredGrantCount === 1, 'report counts expired grants');
  assert(report.score < 100, 'report score drops for risky credential');

  if (failures > 0) {
    console.error(`\n${failures} computer-grant-gate smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll computer-grant-gate smoke cases passed.');
}

main();
