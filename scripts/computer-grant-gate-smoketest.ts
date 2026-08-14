/**
 * computer-grant-gate-smoketest — pins the local vault grant/readiness
 * rules used before agents can automate logins with saved credentials,
 * plus the sticky per-site/per-app "always allow" scope model (T7 UX):
 * floor exclusion, normalization, matching, expiry/revocation, partitioning,
 * and bounded history.
 *
 * Run: npm run smoke:computer-grant-gate
 */

import {
  applyStickyScopes,
  buildStickyScopeOfferFromTask,
  compactStickyAllowScopes,
  createStickyScope,
  extractStickyTaskTargets,
  formatStickyScopeAppliedNotice,
  getActiveStickyScopes,
  normalizeScopeKey,
  scopeMatchesTask,
  setActiveStickyScopes,
  STICKY_FLOOR_CATEGORIES,
  STICKY_GRANTABLE_CATEGORIES,
  type StickyAllowScope,
} from '../src/lib/computerGrantGate';
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

  stickyScopeCases();

  if (failures > 0) {
    console.error(`\n${failures} computer-grant-gate smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll computer-grant-gate smoke cases passed.');
}

// ─── T7 UX: sticky per-site/per-app "always allow" scopes ───────────────────

function stickyScopeCases() {
  const NOW = '2026-06-10T12:00:00Z';
  const NOW_MS = Date.parse(NOW);

  // Floor exclusion is structural: the floor and grantable sets are disjoint
  // and together cover every router category that matters here.
  assert(
    STICKY_FLOOR_CATEGORIES.every((cat) => !STICKY_GRANTABLE_CATEGORIES.includes(cat)),
    'sticky: floor and grantable category sets are disjoint',
  );
  for (const cat of ['pay', 'delete', 'login', 'grant'] as const) {
    assert(STICKY_FLOOR_CATEGORIES.includes(cat), `sticky: floor includes ${cat}`);
  }

  // Creation rejects floor categories loudly.
  for (const cat of STICKY_FLOOR_CATEGORIES) {
    const rejected = createStickyScope({
      scopeKind: 'site',
      scopeKey: 'acme.com',
      allowedCategories: ['publish', cat],
      nowIso: NOW,
    });
    assert(!rejected.ok, `sticky: creation rejects floor category ${cat}`);
  }
  assert(
    !createStickyScope({ scopeKind: 'site', scopeKey: 'acme.com', allowedCategories: [], nowIso: NOW }).ok,
    'sticky: creation rejects empty categories',
  );
  assert(
    !createStickyScope({ scopeKind: 'site', scopeKey: '   ', allowedCategories: ['publish'], nowIso: NOW }).ok,
    'sticky: creation rejects empty scope key',
  );

  // Normalization: www./subdomains/case/scheme/path collapse to eTLD+1-ish.
  assert(normalizeScopeKey('site', 'https://WWW.Acme.com/checkout?x=1') === 'acme.com', 'sticky: url normalizes to acme.com');
  assert(normalizeScopeKey('site', 'shop.acme.com') === 'acme.com', 'sticky: subdomain collapses to acme.com');
  assert(normalizeScopeKey('site', 'deep.shop.acme.co.uk') === 'acme.co.uk', 'sticky: multi-part TLD keeps acme.co.uk');
  assert(normalizeScopeKey('site', 'localhost') === 'localhost', 'sticky: single-label host passes through');
  assert(normalizeScopeKey('app', '  Adobe  Photoshop App ') === 'adobe photoshop', 'sticky: app name lowercases and trims');
  // Private multi-tenant hosting suffixes: each subdomain is a separate tenant,
  // so eTLD+1 collapse must KEEP the tenant label (no cross-tenant grant leak).
  assert(normalizeScopeKey('site', 'alice.myshopify.com') === 'alice.myshopify.com', 'sticky: multi-tenant suffix keeps tenant label');
  assert(normalizeScopeKey('site', 'alice.myshopify.com') !== normalizeScopeKey('site', 'bob.myshopify.com'), 'sticky: distinct tenants → distinct scopes');
  assert(normalizeScopeKey('site', 'myblog.wordpress.com') === 'myblog.wordpress.com', 'sticky: wordpress.com tenant isolated');
  assert(normalizeScopeKey('site', 'app.vercel.app') === 'app.vercel.app', 'sticky: vercel.app tenant isolated');

  // Every current router mutation category is exact. No broad sticky scope can
  // be created until a future reversible category is added to the canonical
  // effect policy.
  assert(STICKY_GRANTABLE_CATEGORIES.length === 0, 'sticky: no broad mutation category is grantable');
  const broad = createStickyScope({
    scopeKind: 'site',
    scopeKey: 'www.Acme.com',
    allowedCategories: ['publish', 'upload'],
    grantedByUserId: 'user_1',
    nowIso: NOW,
  });
  assert(!broad.ok, 'sticky: broad publish/upload scope is rejected');

  // A malicious legacy object is inactive after canonical sanitization and
  // cannot cover concrete or category-less work.
  const malicious: StickyAllowScope = {
    id: 'legacy_scope',
    scopeKind: 'site',
    scopeKey: 'acme.com',
    allowedCategories: ['publish', 'pay', 'delete', 'login', 'grant'],
    grantedByUserId: 'user_1',
    grantedAtIso: NOW,
    expiresAtIso: '2099-01-01T00:00:00.000Z',
    lastUsedAtIso: null,
    useCount: 0,
    revoked: null,
  };
  assert(!scopeMatchesTask(malicious, { hostname: 'acme.com' }, NOW_MS), 'sticky: exact-only legacy scope is inactive');
  const partition = applyStickyScopes([malicious], { hostname: 'acme.com' }, ['publish', 'pay', 'login'], NOW_MS);
  assert(partition.autoApproved.length === 0, 'sticky: malicious scope auto-approves nothing');
  assert(partition.stillRequired.join(',') === 'publish,pay,login', 'sticky: every exact category stays required');
  assert(partition.usedScopeIds.length === 0, 'sticky: malicious scope contributes no authority');
  const generic = applyStickyScopes([malicious], { hostname: 'acme.com' }, [], NOW_MS);
  assert(generic.usedScopeIds.length === 0, 'sticky: exact-only scope cannot cover category-less work');

  const compacted = compactStickyAllowScopes([
    { scopeKind: 'site', scopeKey: 'WWW.Acme.com', allowedCategories: ['publish', 'pay'], grantedAtIso: NOW },
    { scopeKind: 'site', scopeKey: '', allowedCategories: ['publish'] },
    { scopeKind: 'app', scopeKey: 'Notion', allowedCategories: ['login'] },
    'garbage',
    null,
  ]);
  assert(compacted.length === 0, 'sticky: compaction drops malformed and exact-only legacy entries');

  // Target extraction: urls, bare domains, app names; file names excluded.
  assert(extractStickyTaskTargets('publish the post on https://shop.acme.com/admin').hostname === 'acme.com', 'sticky: url target extracted');
  assert(extractStickyTaskTargets('upload the logo to acme.com').hostname === 'acme.com', 'sticky: bare domain extracted');
  assert(extractStickyTaskTargets('open banner.png and save it').hostname === null, 'sticky: file name not mistaken for domain');
  assert(extractStickyTaskTargets('in the Notion app, publish the page').appName === 'notion', 'sticky: known app extracted');

  // Post-task offers are absent when only exact categories remain.
  const offer = buildStickyScopeOfferFromTask({ task: 'log into acme.com and publish the post', categories: ['login', 'publish'] });
  assert(offer === null, 'sticky: exact categories produce no standing-grant offer');
  const noTargetOffer = buildStickyScopeOfferFromTask({ task: 'tidy up my desktop files', categories: ['save'] });
  assert(noTargetOffer === null, 'sticky: no offer without a target site/app');

  // Notice copy is the single approved line.
  assert(
    formatStickyScopeAppliedNotice({ scopeKey: 'acme.com' }) === 'Auto-approved via your standing grant for acme.com — revoke in Computer Use → Permissions.',
    'sticky: applied notice copy pinned',
  );

  // Registry round-trip (router default source) — compaction applies.
  setActiveStickyScopes([malicious]);
  const registry = getActiveStickyScopes();
  assert(registry.length === 0, 'sticky: registry drops exact-only legacy scopes');
  setActiveStickyScopes([]);
  assert(getActiveStickyScopes().length === 0, 'sticky: registry resets');
}

main();
