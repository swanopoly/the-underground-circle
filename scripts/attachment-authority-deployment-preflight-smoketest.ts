/**
 * Dry-run/source smoke for the attachment-authority deployment preflight.
 *
 * This smoke never requests a live mode and never opens a socket. It proves
 * the default process ignores even fully populated live-confirmation env and
 * that malformed local source parity blocks before any optional probe.
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { classifyLocalBridgeHealthPayload } from './attachment-authority-deployment-preflight';

const root = resolve(__dirname, '..');
const scriptPath = resolve(root, 'scripts/attachment-authority-deployment-preflight.ts');
const packagePath = resolve(root, 'package.json');
const roadmapPath = resolve(root, 'docs/AGENTS_ROADMAP.md');
const stackReferencePath = resolve(root, 'docs/UC_APP_STACK_REFERENCE.md');
const source = readFileSync(scriptPath, 'utf8');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  scripts?: Record<string, string>;
};
const roadmap = readFileSync(roadmapPath, 'utf8');
const stackReference = readFileSync(stackReferencePath, 'utf8');

const canonicalMigrations = [
  '20260726_database_authority_guards.sql',
  '20260812_agent_run_artifact_integrity.sql',
  '20260813160000_message_attachment_link_integrity.sql',
  '20260813170000_message_attachment_visibility_integrity.sql',
  '20260813180000_device_private_run_approval_authority.sql',
  '20260813210000_openswan_chat_approval_resume_authority.sql',
] as const;
const expectedMigrationInventory = Array.from(
  readdirSync(resolve(root, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reduce((inventory, name) => {
      const separator = name.indexOf('_');
      const version = separator > 0 ? name.slice(0, separator) : name.replace(/\.sql$/u, '');
      const files = inventory.get(version) || [];
      files.push(name);
      inventory.set(version, files);
      return inventory;
    }, new Map<string, string[]>()),
)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([version, files]) => ({ version, files: [...files].sort() }));
const expectedDuplicateVersions = expectedMigrationInventory.filter((entry) => entry.files.length > 1);

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function runPreflight(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return spawnSync(
    'npx',
    ['--no-install', 'tsx', scriptPath, ...args],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
}

// Static safety contract: there is no migration/apply path and every network
// mode is visibly read-only plus separately gated.
for (const migration of canonicalMigrations) {
  check(source.includes(migration), `preflight registers ${migration}`);
}
check(source.includes("RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG !== '1'"), 'catalog mode requires an exact env confirmation');
check(source.includes("RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY !== '1'"), 'authenticated canary requires an exact env confirmation');
check(source.includes("'--live-catalog'"), 'catalog mode additionally requires an explicit CLI switch');
check(source.includes("'--live-canary'"), 'authenticated canary additionally requires an explicit CLI switch');
check(source.includes("'--local-bridge-health'"), 'loopback bridge health is an explicit opt-in probe');
check(source.includes("'http://127.0.0.1:7778/desktop/health'"), 'bridge probe is pinned to the fixed loopback endpoint');
check(source.includes('BEGIN TRANSACTION READ ONLY;'), 'catalog probe enters an explicit read-only transaction');
check(source.includes('ROLLBACK;'), 'catalog probe closes with rollback');
check(source.includes("PGSSLMODE: 'verify-full'"), 'catalog subprocess pins certificate and hostname verification');
check(source.includes('PGSSLROOTCERT: config.sslRootCert'), 'catalog subprocess pins the reviewed CA bundle');
check(source.includes('execFileSync(config.psqlPath'), 'catalog subprocess executes only the explicitly reviewed psql path');
check(source.includes('lstatSync(psqlPath)'), 'psql identity is checked without following a final symlink');
check(source.includes('(psqlStat.mode & 0o111) === 0'), 'psql must be executable');
check(source.includes('(psqlStat.mode & 0o022) !== 0'), 'group/world-writable psql binaries fail closed');
check(source.includes('lstatSync(sslRootCert)'), 'CA bundle identity is checked without following a symlink');
check(source.includes('sslRootCertStat.isSymbolicLink()'), 'symlink CA bundles fail closed');
check(source.includes('sslRootCertStat.size > 10 * 1024 * 1024'), 'CA bundle size is bounded');
check(!source.includes('PATH: process.env.PATH'), 'catalog subprocess does not search a caller-controlled PATH');
check(!source.includes('...process.env,\n        PGPASSWORD'), 'catalog subprocess does not inherit arbitrary caller PG options');
check(source.includes("method: 'GET'"), 'REST, Storage, and bridge probes use read requests');
check(!/method:\s*'(?:POST|PUT|PATCH|DELETE)'/u.test(source), 'preflight contains no mutating HTTP method');
check(!source.includes('SUPABASE_SERVICE_ROLE_KEY'), 'preflight never requests a service-role secret');
check(!source.includes('dotenv') && !source.includes("ENV_FILES"), 'preflight never loads env files');
check(!/\b(?:supabase db push|supabase migration|psql[^\n]*-f)\b/u.test(source), 'preflight contains no migration application command');
check(source.includes('This command has no apply mode.'), 'operator help states the no-apply boundary');

const legacyMissingCapability = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: ['desktop_window_state'],
});
check(legacyMissingCapability.classification === 'capability_missing', 'legacy missing capability is classified without inferring source drift');
check(legacyMissingCapability.sourceChanged === null, 'legacy health cannot prove whether source changed');
check(legacyMissingCapability.blocker?.includes('Source drift is unproven'), 'legacy blocker states the exact evidence limit');

const legacyCapabilityWithoutSafety = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: ['attachment_open_capability'],
});
check(legacyCapabilityWithoutSafety.classification === 'restart_blocked', 'legacy capability presence does not fabricate source currency');
check(legacyCapabilityWithoutSafety.sourceChanged === null, 'legacy capable health still has unknown source currency');

const currentBridge = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: ['attachment_open_capability'],
  restartSafety: { sourceChanged: false, safeToRefresh: false, blockers: ['source_not_changed'] },
});
check(currentBridge.classification === 'current', 'source-current capable bridge passes the read-only classifier');

const safeDrift = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: ['attachment_open_capability'],
  restartSafety: { sourceChanged: true, safeToRefresh: true, blockers: [] },
});
check(safeDrift.classification === 'idle_safe_restart', 'fresh idle-safe restart evidence is distinct from current health');
check(safeDrift.blocker?.includes('did not request'), 'read-only preflight never turns restart evidence into restart authority');

const blockedDrift = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: ['attachment_open_capability'],
  restartSafety: {
    sourceChanged: true,
    safeToRefresh: false,
    blockers: ['possibly_active_sessions', 'browser_runtime_active'],
  },
});
check(blockedDrift.classification === 'restart_blocked', 'source drift with live authority remains watch-blocked');
check(blockedDrift.blocker?.includes('possibly_active_sessions'), 'value-free restart blockers remain visible');

const staleMissingCapability = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: [],
  restartSafety: { sourceChanged: true, safeToRefresh: false, blockers: ['possibly_active_sessions'] },
});
check(staleMissingCapability.classification === 'source_changed_capability_missing', 'proven drift and missing capability have a distinct classification');

const malformedRestartSafety = classifyLocalBridgeHealthPayload({
  ok: true,
  supported: true,
  tools: ['attachment_open_capability'],
  restartSafety: { sourceChanged: 'yes', safeToRefresh: true, blockers: [] },
});
check(malformedRestartSafety.classification === 'restart_blocked', 'malformed restart authority fails closed');

// Behavioral dry run: even hostile/fake live env cannot opt the default command
// into a socket or database attempt without the corresponding CLI switch.
const hostileLiveEnv: NodeJS.ProcessEnv = {
  ...process.env,
  RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG: '1',
  RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY: '1',
  UC_ATTACHMENT_AUTHORITY_PROJECT_REF: 'aaaaaaaaaaaaaaaaaaaa',
  UC_ATTACHMENT_AUTHORITY_SUPABASE_URL: 'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',
  UC_ATTACHMENT_AUTHORITY_DATABASE_URL: 'postgresql://postgres:do-not-use@db.aaaaaaaaaaaaaaaaaaaa.supabase.co/postgres',
  UC_ATTACHMENT_AUTHORITY_PSQL_PATH: '/do/not/use/fake-psql',
  UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT: '/do/not/use/fake-ca.pem',
  UC_ATTACHMENT_AUTHORITY_ANON_KEY: 'do-not-use-this-fake-anon-key',
  UC_ATTACHMENT_AUTHORITY_USER_A_ACCESS_TOKEN: 'do-not-use',
  UC_ATTACHMENT_AUTHORITY_USER_B_ACCESS_TOKEN: 'do-not-use',
  UC_ATTACHMENT_AUTHORITY_CIRCLE_ID: '44444444-4444-4444-8444-444444444444',
  UC_ATTACHMENT_AUTHORITY_ARTIFACT_ID: '11111111-1111-4111-8111-111111111111',
  UC_ATTACHMENT_AUTHORITY_PRIVATE_ATTACHMENT_ID: '22222222-2222-4222-8222-222222222222',
  UC_ATTACHMENT_AUTHORITY_DEVICE_PRIVATE_APPROVAL_ID: '33333333-3333-4333-8333-333333333333',
};
const dryRun = runPreflight(['--json'], hostileLiveEnv);
check(dryRun.status === 5, 'default local preflight blocks automated push without touching fake live targets');
const dryPayload = JSON.parse(dryRun.stdout) as Record<string, any>;
check(dryPayload.local?.ready === true, 'default preflight reports local source readiness');
check(dryPayload.local?.canonicalConsolidatedSqlReady === true, 'duplicate legacy versions do not invalidate canonical consolidated SQL');
check(dryPayload.local?.automatedMigrationPushReady === false, 'duplicate legacy versions block automated migration push');
check(dryPayload.local?.networkAttempted === false, 'local source pass records zero network attempts');
check(dryPayload.local?.mutationsPerformed === false, 'local source pass records zero mutations');
check(dryPayload.localBridge?.status === 'not_run', 'default leaves loopback bridge health unattempted');
check(dryPayload.liveCatalog?.status === 'not_run', 'default leaves live catalog unattempted');
check(dryPayload.authenticatedCanary?.status === 'not_run', 'default leaves authenticated canary unattempted');
check(dryPayload.liveCatalog?.networkAttempted === false, 'default records zero catalog network attempts');
check(dryPayload.authenticatedCanary?.networkAttempted === false, 'default records zero canary network attempts');
check(
  Array.isArray(dryPayload.local?.sections)
    && dryPayload.local.sections.map((section: any) => section.id).join(',') === '28,38,39,40,41,44',
  'default report preserves exact dependency order',
);
check(
  dryPayload.local.sections.every((section: any) => section.readinessQueryAvailable === true),
  'every dependency has a canonical readiness-query provider',
);
check(
  dryPayload.local.sections.every((section: any) => section.consolidatedParityReady === true),
  'every consolidated section contains one exact canonical migration body',
);
check(
  dryPayload.local.sections.every((section: any) => section.consolidatedPrefixReady === true),
  'every consolidated section has its exact canonical prefix marker',
);
check(
  dryPayload.local.sections.every((section: any) => section.consolidatedTailReady === true),
  'every consolidated section has a closed canonical tail boundary',
);
check(
  dryPayload.local.sections.every((section: any) => section.tailGrammarReady === true),
  'every canonical migration tail contains only its expected readiness grammar',
);
check(
  dryPayload.local.sections.find((section: any) => section.id === 28)?.readinessProviderSection === 41,
  '§28 readiness is explicitly supplied by the dependent §41 state-machine catalog check',
);
check(
  dryPayload.local.sections.find((section: any) => section.id === 44)?.readinessProviderSection === 44,
  '§44 supplies its own exact approval-resume catalog readiness query',
);
const drySection44 = dryPayload.local.sections.find((section: any) => section.id === 44);
check(drySection44?.migration === '20260813210000_openswan_chat_approval_resume_authority.sql', '§44 reports the exact canonical migration identity');
check(drySection44?.dependencyOrderReady === true, '§44 reports canonical migration dependency order');
check(drySection44?.consolidatedOrderReady === true, '§44 reports canonical consolidated dependency order');
check(drySection44?.consolidatedPrefixReady === true, '§44 reports its exact BEGIN and Source prefix');
check(drySection44?.consolidatedTailReady === true, '§44 reports its exact closed END boundary');
check(drySection44?.consolidatedParityReady === true, '§44 reports one byte-exact canonical executable body');
check(drySection44?.tailGrammarReady === true, '§44 reports a closed readiness tail');
check(drySection44?.requiredContentReady === true, '§44 reports all approval-resume authority markers');
check(drySection44?.readinessQueryAvailable === true, '§44 reports its complete canonical readiness SELECT');
check(
  JSON.stringify(dryPayload.local?.migrationVersionInventory) === JSON.stringify(expectedMigrationInventory),
  'preflight inventories every exact migration filename prefix',
);
check(
  JSON.stringify(dryPayload.local?.duplicateMigrationVersions) === JSON.stringify(expectedDuplicateVersions),
  'preflight reports every exact duplicate migration version and filename set',
);
check(
  dryPayload.local.duplicateMigrationVersions.some((entry: any) => (
    entry.version === '20260726'
      && entry.files.join(',') === [
        '20260726_agent_action_calls.sql',
        '20260726_database_authority_guards.sql',
        '20260726_scheduled_action_mutation_guard.sql',
        '20260726_swanbot_continuation_privacy.sql',
      ].join(',')
  )),
  'the known §28-era duplicate version is reported exactly without renaming it',
);

const textRun = runPreflight([]);
check(textRun.status === 5, 'human-readable preflight also blocks automated push');
check(
  textRun.stdout.includes('LOCAL SOURCE READY; AUTOMATED PUSH BLOCKED'),
  'text headline distinguishes canonical source readiness from push readiness',
);
check(
  textRun.stdout.includes('use the reviewed docs/RUN_THIS_SQL.sql workflow'),
  'text report directs recovery to the reviewed consolidated SQL workflow',
);
check(
  textRun.stdout.includes('- §44: ready (own readiness SELECT)'),
  'human-readable dry run includes canonical §44 readiness',
);

// CLI switches alone cannot contact a live target.
const unconfirmedCatalogEnv = { ...process.env };
delete unconfirmedCatalogEnv.RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG;
const unconfirmedCatalog = runPreflight(['--live-catalog'], unconfirmedCatalogEnv);
check(unconfirmedCatalog.status === 1, 'catalog CLI switch without env confirmation fails closed');
check(
  unconfirmedCatalog.stderr.includes('RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG=1'),
  'catalog refusal names the exact recovery flag without printing credentials',
);

const catalogGateRoot = mkdtempSync(join(tmpdir(), 'uc-attachment-catalog-gate-'));
try {
  const fakePsql = join(catalogGateRoot, 'reviewed-psql');
  writeFileSync(fakePsql, '#!/bin/sh\nexit 99\n', { mode: 0o555 });
  const missingCaEnv: NodeJS.ProcessEnv = {
    ...hostileLiveEnv,
    UC_ATTACHMENT_AUTHORITY_PSQL_PATH: fakePsql,
  };
  delete missingCaEnv.UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT;
  const missingCa = runPreflight(['--live-catalog'], missingCaEnv);
  check(missingCa.status === 1, 'live catalog refuses a missing reviewed CA bundle before psql execution');
  check(
    missingCa.stderr.includes('UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT'),
    'missing-CA refusal names only the required operator gate',
  );
  check(!missingCa.stderr.includes('do-not-use'), 'missing-CA refusal prints no database credential');
} finally {
  rmSync(catalogGateRoot, { recursive: true, force: true });
}

const unconfirmedCanaryEnv = { ...process.env };
delete unconfirmedCanaryEnv.RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY;
const unconfirmedCanary = runPreflight(['--live-canary'], unconfirmedCanaryEnv);
check(unconfirmedCanary.status === 1, 'canary CLI switch without env confirmation fails closed');
check(
  unconfirmedCanary.stderr.includes('RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY=1'),
  'canary refusal names the exact recovery flag without printing credentials',
);

function unsignedFixtureJwt(subject: string): string {
  const encode = (value: Record<string, unknown>) => Buffer
    .from(JSON.stringify(value), 'utf8')
    .toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
    sub: subject,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.fixture`;
}

const missingCircleEnv: NodeJS.ProcessEnv = {
  ...hostileLiveEnv,
  UC_ATTACHMENT_AUTHORITY_USER_A_ACCESS_TOKEN: unsignedFixtureJwt('50000000-0000-4000-8000-000000000001'),
  UC_ATTACHMENT_AUTHORITY_USER_B_ACCESS_TOKEN: unsignedFixtureJwt('50000000-0000-4000-8000-000000000002'),
};
delete missingCircleEnv.UC_ATTACHMENT_AUTHORITY_CIRCLE_ID;
const missingCircle = runPreflight(['--live-canary'], missingCircleEnv);
check(missingCircle.status === 1, 'live canary refuses a missing exact circle before any REST read');
check(
  missingCircle.stderr.includes('UC_ATTACHMENT_AUTHORITY_CIRCLE_ID'),
  'missing-circle refusal identifies the exact new fixture gate',
);
check(!missingCircle.stderr.includes('do-not-use'), 'missing-circle refusal prints no token or fixture value');

// A copied local catalog with a missing consolidated header blocks locally.
// It cannot fall through into any optional live check.
const tempRoot = mkdtempSync(join(tmpdir(), 'uc-attachment-authority-preflight-'));
try {
  const tempMigrations = join(tempRoot, 'supabase', 'migrations');
  const tempDocs = join(tempRoot, 'docs');
  mkdirSync(tempMigrations, { recursive: true });
  mkdirSync(tempDocs, { recursive: true });
  for (const migration of canonicalMigrations) {
    cpSync(
      resolve(root, 'supabase', 'migrations', migration),
      resolve(tempMigrations, migration),
    );
  }
  const consolidated = readFileSync(resolve(root, 'docs/RUN_THIS_SQL.sql'), 'utf8');
  writeFileSync(
    resolve(tempDocs, 'RUN_THIS_SQL.sql'),
    consolidated.replace(
      '-- §40. Message-attachment visibility and Storage integrity (2026-08-13)',
      '-- intentionally removed section 40 header',
    ),
  );
  const blocked = runPreflight(['--repo', tempRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'local consolidated-order drift blocks the preflight');
  const blockedPayload = JSON.parse(blocked.stdout) as Record<string, any>;
  check(blockedPayload.local?.ready === false, 'corrupted local copy is not deployment-ready');
  check(blockedPayload.localBridge?.status === 'not_run', 'local blocker prevents bridge probing');
  check(blockedPayload.liveCatalog?.status === 'not_run', 'local blocker prevents catalog probing');
  check(blockedPayload.authenticatedCanary?.status === 'not_run', 'local blocker prevents authenticated probing');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

function makeCopiedRepo(slug: string): string {
  const copiedRoot = mkdtempSync(join(tmpdir(), `uc-attachment-preflight-${slug}-`));
  const copiedMigrations = join(copiedRoot, 'supabase', 'migrations');
  const copiedDocs = join(copiedRoot, 'docs');
  mkdirSync(copiedMigrations, { recursive: true });
  mkdirSync(copiedDocs, { recursive: true });
  for (const migration of canonicalMigrations) {
    cpSync(
      resolve(root, 'supabase', 'migrations', migration),
      resolve(copiedMigrations, migration),
    );
  }
  cpSync(resolve(root, 'docs/RUN_THIS_SQL.sql'), resolve(copiedDocs, 'RUN_THIS_SQL.sql'));
  return copiedRoot;
}

// Mixed historical header grammars still delimit the preceding canonical
// section. Executable SQL in a later `BEGIN SECTION N:` block must not be
// mistaken for an executable tail belonging to §41, and a future `§N.` block
// must not be absorbed into the final canonical §44 body.
const mixedHeaderRoot = makeCopiedRepo('mixed-section-header');
try {
  const consolidatedPath = resolve(mixedHeaderRoot, 'docs', 'RUN_THIS_SQL.sql');
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  const currentBoundary = '-- BEGIN SECTION 42: Office OAuth credential control plane';
  check(consolidated.includes(currentBoundary), 'fixture contains the established BEGIN SECTION boundary');
  writeFileSync(
    consolidatedPath,
    consolidated.replace(
      currentBoundary,
      '-- BEGIN SECTION 99: mixed-header boundary regression',
    ),
  );
  const bounded = runPreflight(['--repo', mixedHeaderRoot, '--json'], hostileLiveEnv);
  check(bounded.status === 0, 'mixed BEGIN SECTION boundary preserves local canonical readiness');
  const payload = JSON.parse(bounded.stdout) as Record<string, any>;
  const section41 = payload.local.sections.find((section: any) => section.id === 41);
  check(section41?.consolidatedParityReady === true, 'later mixed-header SQL is excluded from §41 parity');
  check(section41?.ready === true, '§41 remains ready across mixed consolidated header grammars');
  check(payload.local?.networkAttempted === false, 'mixed-header regression remains a local-only check');
} finally {
  rmSync(mixedHeaderRoot, { recursive: true, force: true });
}

const futureMixedHeaderRoot = makeCopiedRepo('future-mixed-section-header');
try {
  const consolidatedPath = resolve(futureMixedHeaderRoot, 'docs', 'RUN_THIS_SQL.sql');
  writeFileSync(
    consolidatedPath,
    `${readFileSync(consolidatedPath, 'utf8')}\n\n-- §45. Future mixed-header boundary regression\nSELECT current_user;\n`,
  );
  const bounded = runPreflight(['--repo', futureMixedHeaderRoot, '--json'], hostileLiveEnv);
  check(bounded.status === 0, 'future §-style boundary is excluded from canonical §44 parity');
  const payload = JSON.parse(bounded.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.consolidatedParityReady === true, 'mixed future section SQL is not treated as a §44 executable tail');
  check(section44?.ready === true, '§44 stays locally ready across the supported next-header grammar');
  check(payload.local?.networkAttempted === false, 'future mixed-header regression remains local-only');
} finally {
  rmSync(futureMixedHeaderRoot, { recursive: true, force: true });
}

// Adversarial parity: a hidden executable tail in either canonical source or
// the consolidated section must fail locally before any live option is read.
const migrationTailRoot = makeCopiedRepo('migration-tail');
try {
  const migrationPath = resolve(
    migrationTailRoot,
    'supabase/migrations/20260813180000_device_private_run_approval_authority.sql',
  );
  writeFileSync(
    migrationPath,
    `${readFileSync(migrationPath, 'utf8')}\nSELECT current_user;\n`,
  );
  const blocked = runPreflight(['--repo', migrationTailRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'extra executable migration tail blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section41 = payload.local.sections.find((section: any) => section.id === 41);
  check(section41?.tailGrammarReady === false, 'extra migration tail is reported as invalid grammar');
  check(section41?.consolidatedParityReady === false, 'extra migration tail also breaks whole-section parity');
  check(payload.liveCatalog?.attempted === false, 'migration-tail drift cannot reach a live catalog');
} finally {
  rmSync(migrationTailRoot, { recursive: true, force: true });
}

const section44MigrationTailRoot = makeCopiedRepo('section-44-migration-tail');
try {
  const migrationPath = resolve(
    section44MigrationTailRoot,
    'supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql',
  );
  writeFileSync(
    migrationPath,
    `${readFileSync(migrationPath, 'utf8')}\nSELECT current_user;\n`,
  );
  const blocked = runPreflight(['--repo', section44MigrationTailRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'extra executable §44 migration tail blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.tailGrammarReady === false, '§44 rejects executable SQL after its readiness SELECT');
  check(section44?.consolidatedParityReady === false, '§44 migration-tail drift breaks exact consolidated parity');
  check(payload.liveCatalog?.attempted === false, '§44 migration-tail drift cannot reach a live catalog');
} finally {
  rmSync(section44MigrationTailRoot, { recursive: true, force: true });
}

const section44ReadinessMarkerRoot = makeCopiedRepo('section-44-readiness-marker');
try {
  const migrationPath = resolve(
    section44ReadinessMarkerRoot,
    'supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql',
  );
  writeFileSync(
    migrationPath,
    readFileSync(migrationPath, 'utf8').replace(
      '-- Catalog readiness only.',
      '-- Catalog readiness only.\n-- Catalog readiness only.',
    ),
  );
  const blocked = runPreflight(['--repo', section44ReadinessMarkerRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'ambiguous §44 readiness marker blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.tailGrammarReady === false, '§44 requires exactly one readiness marker');
  check(section44?.readinessQueryAvailable === false, 'ambiguous §44 marker cannot supply a catalog query');
  check(payload.authenticatedCanary?.attempted === false, '§44 readiness ambiguity blocks before optional probes');
} finally {
  rmSync(section44ReadinessMarkerRoot, { recursive: true, force: true });
}

const section44FilenameRoot = makeCopiedRepo('section-44-filename-prefix');
try {
  const migrationDirectory = resolve(section44FilenameRoot, 'supabase/migrations');
  renameSync(
    resolve(migrationDirectory, '20260813210000_openswan_chat_approval_resume_authority.sql'),
    resolve(migrationDirectory, '20260813175000_openswan_chat_approval_resume_authority.sql'),
  );
  const blocked = runPreflight(['--repo', section44FilenameRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'wrong §44 migration version prefix blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.sourcePresent === false, 'wrong-prefix file cannot impersonate the canonical §44 source');
  check(section44?.uniqueCanonicalMigration === false, '§44 requires one exact filename and version prefix');
  check(section44?.dependencyOrderReady === false, 'missing exact §44 filename breaks canonical dependency order');
} finally {
  rmSync(section44FilenameRoot, { recursive: true, force: true });
}

const section44OrderRoot = makeCopiedRepo('section-44-consolidated-order');
try {
  const consolidatedPath = resolve(section44OrderRoot, 'docs/RUN_THIS_SQL.sql');
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  const section44Header = '-- BEGIN SECTION 44: OpenSwan Chat approval-resume authority';
  const section44Footer = '-- END SECTION 44: OpenSwan Chat approval-resume authority';
  const section44Start = consolidated.indexOf(section44Header);
  const section44FooterStart = consolidated.indexOf(section44Footer, section44Start);
  check(section44Start >= 0 && section44FooterStart > section44Start, 'order fixture finds exact §44 boundaries');
  const section44End = section44FooterStart + section44Footer.length;
  const section44Block = consolidated.slice(section44Start, section44End);
  const withoutSection44 = consolidated.slice(0, section44Start) + consolidated.slice(section44End);
  const section41Start = withoutSection44.indexOf('-- §41. Device-private run-approval privacy and authority (2026-08-13)');
  check(section41Start >= 0, 'order fixture finds the §41 dependency boundary');
  writeFileSync(
    consolidatedPath,
    withoutSection44.slice(0, section41Start)
      + section44Block
      + '\n\n'
      + withoutSection44.slice(section41Start),
  );
  const blocked = runPreflight(['--repo', section44OrderRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, '§44 placed before §41 blocks canonical consolidated order');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.consolidatedOrderReady === false, '§44 reports its broken dependency order');
  check(section44?.consolidatedParityReady === true, 'reordering does not disguise otherwise byte-exact §44 source');
  check(payload.liveCatalog?.attempted === false, '§44 order drift blocks before any live catalog call');
} finally {
  rmSync(section44OrderRoot, { recursive: true, force: true });
}

const migrationPrefixRoot = makeCopiedRepo('migration-prefix');
try {
  const migrationPath = resolve(
    migrationPrefixRoot,
    'supabase/migrations/20260813160000_message_attachment_link_integrity.sql',
  );
  writeFileSync(
    migrationPath,
    readFileSync(migrationPath, 'utf8').replace(
      'BEGIN;',
      'SELECT current_user;\n\nBEGIN;',
    ),
  );
  const blocked = runPreflight(
    ['--repo', migrationPrefixRoot, '--json', '--live-catalog'],
    hostileLiveEnv,
  );
  check(blocked.status === 2, 'executable SQL before canonical BEGIN blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section39 = payload.local.sections.find((section: any) => section.id === 39);
  check(section39?.consolidatedParityReady === false, 'canonical-source prefix grammar rejects executable SQL');
  check(payload.liveCatalog?.attempted === false, 'invalid migration prefix cannot reach a live catalog');
  check(payload.localBridge?.attempted === false, 'invalid migration prefix prevents every optional probe');
} finally {
  rmSync(migrationPrefixRoot, { recursive: true, force: true });
}

const consolidatedTailRoot = makeCopiedRepo('consolidated-tail');
try {
  const consolidatedPath = resolve(consolidatedTailRoot, 'docs/RUN_THIS_SQL.sql');
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  writeFileSync(
    consolidatedPath,
    consolidated.replace(
      '-- §41. Device-private run-approval privacy and authority (2026-08-13)',
      'SELECT current_user;\n-- §41. Device-private run-approval privacy and authority (2026-08-13)',
    ),
  );
  const blocked = runPreflight(['--repo', consolidatedTailRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'extra executable consolidated-section tail blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section40 = payload.local.sections.find((section: any) => section.id === 40);
  check(section40?.consolidatedParityReady === false, 'consolidated executable tail is rejected by exact section parity');
  check(payload.authenticatedCanary?.attempted === false, 'consolidated drift cannot reach a live canary');
} finally {
  rmSync(consolidatedTailRoot, { recursive: true, force: true });
}

const section44ConsolidatedTailRoot = makeCopiedRepo('section-44-consolidated-tail');
try {
  const consolidatedPath = resolve(section44ConsolidatedTailRoot, 'docs/RUN_THIS_SQL.sql');
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  writeFileSync(
    consolidatedPath,
    consolidated.replace(
      '-- END SECTION 44: OpenSwan Chat approval-resume authority',
      'SELECT current_user;\n-- END SECTION 44: OpenSwan Chat approval-resume authority',
    ),
  );
  const blocked = runPreflight(['--repo', section44ConsolidatedTailRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'extra executable consolidated §44 tail blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.tailGrammarReady === true, 'canonical §44 migration tail remains independently valid');
  check(section44?.consolidatedParityReady === false, 'executable SQL outside the exact §44 source body is rejected');
  check(payload.localBridge?.attempted === false, 'consolidated §44 drift blocks before the loopback probe');
} finally {
  rmSync(section44ConsolidatedTailRoot, { recursive: true, force: true });
}

const section44ConsolidatedPrefixRoot = makeCopiedRepo('section-44-consolidated-prefix');
try {
  const consolidatedPath = resolve(section44ConsolidatedPrefixRoot, 'docs/RUN_THIS_SQL.sql');
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  writeFileSync(
    consolidatedPath,
    consolidated.replace(
      '-- Source: supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql',
      '-- Source: supabase/migrations/not-the-canonical-section-44-source.sql',
    ),
  );
  const blocked = runPreflight(['--repo', section44ConsolidatedPrefixRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'wrong consolidated §44 Source prefix blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.consolidatedPrefixReady === false, '§44 requires its exact Source marker immediately after BEGIN');
  check(section44?.consolidatedParityReady === false, 'wrong §44 Source lineage cannot pass byte-exact parity');
  check(payload.liveCatalog?.attempted === false, 'wrong §44 source prefix blocks before catalog access');
} finally {
  rmSync(section44ConsolidatedPrefixRoot, { recursive: true, force: true });
}

const section44ConsolidatedBoundaryRoot = makeCopiedRepo('section-44-consolidated-boundary');
try {
  const consolidatedPath = resolve(section44ConsolidatedBoundaryRoot, 'docs/RUN_THIS_SQL.sql');
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  writeFileSync(
    consolidatedPath,
    consolidated.replace(
      '-- END SECTION 44: OpenSwan Chat approval-resume authority',
      '-- removed canonical section 44 end boundary',
    ),
  );
  const blocked = runPreflight(['--repo', section44ConsolidatedBoundaryRoot, '--json'], hostileLiveEnv);
  check(blocked.status === 2, 'missing consolidated §44 END marker blocks local readiness');
  const payload = JSON.parse(blocked.stdout) as Record<string, any>;
  const section44 = payload.local.sections.find((section: any) => section.id === 44);
  check(section44?.consolidatedTailReady === false, '§44 requires one exact END boundary');
  check(section44?.consolidatedParityReady === false, 'unbounded §44 cannot pass byte-exact parity');
  check(payload.authenticatedCanary?.attempted === false, 'missing §44 end boundary blocks every optional canary');
} finally {
  rmSync(section44ConsolidatedBoundaryRoot, { recursive: true, force: true });
}

const help = execFileSync(
  'npx',
  ['--no-install', 'tsx', scriptPath, '--help'],
  { cwd: root, encoding: 'utf8', timeout: 20_000 },
);
check(help.includes('Default: local source readiness only.'), 'help leads with the local-only default');
check(help.includes('canonical local chain is §§28, 38-41, and 44'), 'help names the complete ordered local authority chain');
check(help.includes('This command has no apply mode.'), 'help repeats that SQL application is out of scope');
check(help.includes('Duplicate legacy migration versions block automated push'), 'help documents duplicate-version push blocking');
check(help.includes('reviewed RUN_THIS_SQL.sql workflow'), 'help identifies the reviewed consolidated workflow');
check(help.includes('--local-bridge-health'), 'help documents the loopback capability probe');
check(help.includes('READ ONLY transaction'), 'help distinguishes live catalog readiness');
check(help.includes('UC_ATTACHMENT_AUTHORITY_PSQL_PATH'), 'help requires an explicit trusted psql binary');
check(help.includes('UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT'), 'help requires an explicit trusted CA bundle for live catalog');
check(help.includes('two-user read/visibility canaries'), 'help distinguishes authenticated behavior canaries');
check(help.includes('UC_ATTACHMENT_AUTHORITY_CIRCLE_ID'), 'help requires one exact shared-circle fixture identity');
check(help.includes('approval parent run all belong'), 'help binds the approval and parent run to the exact fixture circle');
check(help.includes('Exit codes (highest applicable precedence):'), 'help documents deterministic combined-mode exit precedence');
check(help.includes('3  A requested bridge, catalog, or authenticated canary probe failed.'), 'help reserves exit 3 for requested probe failures');
check(help.includes('4  Bridge capability is watch-blocked; no requested probe failed.'), 'help makes bridge watch subordinate to probe failure');
check(help.includes('5  Local SQL is ready but duplicate migration versions block automated push.'), 'help explains the non-deployable local-ready exit');

check(source.includes('MAX_HTTP_RESPONSE_BYTES = 64 * 1024'), 'read responses have an exact byte ceiling');
check(source.includes('while (true)') && source.includes('bytesRead > maxBytes'), 'response bodies are bounded while streaming');
check(source.includes('controller.abort();\n    clearTimeout(timeout);'), 'request timeout remains armed through body handling');
check(source.includes("'fixture.exact_two_member_circle'"), 'live canary independently proves exact shared-circle membership');
check(source.includes("'sections_28_38_41.approval_parent_run_binding'"), 'live canary binds approval to its exact parent run');
check(source.includes('[38, 39, 40, 41, 44] as const'), 'read-only live catalog builder includes canonical §44 readiness');
check(source.includes('rows.some((row) => row.id !== id)'), 'REST result identity is checked after exact-id filtering');
check(
  source.indexOf("localBridge.status === 'fail'") < source.indexOf("localBridge.status === 'watch'"),
  'live/bridge failures take exit precedence over a bridge watch result',
);

check(
  packageJson.scripts?.['preflight:attachment-authority-deployment']
    === 'npx tsx scripts/attachment-authority-deployment-preflight.ts',
  'package exposes the local-default preflight',
);
check(
  packageJson.scripts?.['smoke:attachment-authority-deployment-preflight']
    === 'npx tsx scripts/attachment-authority-deployment-preflight-smoketest.ts',
  'package exposes the dry-run smoke',
);
check(
  packageJson.scripts?.['smoke:chat-desktop-attachment-recovery-durability']
    === 'npx tsx scripts/chat-desktop-attachment-recovery-durability-smoketest.ts',
  'package exposes the durable Chat attachment recovery smoke',
);
check(
  packageJson.scripts?.['smoke:desktop-bridge-safe-refresh']
    === 'npx tsx scripts/desktop-bridge-safe-refresh-smoketest.ts',
  'package exposes the idle-safe bridge refresh smoke',
);
check(
  (packageJson.scripts?.['check:openswan-multi-action'] || '')
    .includes('npm run smoke:attachment-authority-deployment-preflight'),
  'OpenSwan attachment aggregate includes the preflight smoke',
);
check(
  (packageJson.scripts?.['check:openswan-multi-action'] || '')
    .includes('npm run smoke:chat-desktop-attachment-recovery-durability'),
  'OpenSwan attachment aggregate includes durable Chat recovery proof',
);
check(
  (packageJson.scripts?.['check:openswan-multi-action'] || '')
    .includes('npm run smoke:desktop-bridge-safe-refresh'),
  'OpenSwan attachment aggregate includes safe-refresh proof',
);
check(roadmap.includes('attachment-authority-deployment-preflight'), 'roadmap ownership registers the canonical preflight');
check(stackReference.includes('attachment-authority-deployment-preflight'), 'stack reference registers the canonical preflight');
check(roadmap.includes('chat-desktop-attachment-recovery-durability-smoketest.ts'), 'roadmap ownership registers the recovery smoke');
check(stackReference.includes('chat-desktop-attachment-recovery-durability-smoketest.ts'), 'stack reference registers the recovery smoke');
check(
  roadmap.includes('desktop-bridge-safe-refresh-smoketest.ts')
    || roadmap.includes('scripts/{desktop-bridge-safe-refresh,desktop-bridge-capability-readiness}-smoketest.ts'),
  'roadmap ownership registers the safe-refresh smoke',
);
check(stackReference.includes('desktop-bridge-safe-refresh-smoketest.ts'), 'stack reference registers the safe-refresh smoke');

console.log(`Attachment authority deployment preflight smoke passed (${assertions} assertions).`);
