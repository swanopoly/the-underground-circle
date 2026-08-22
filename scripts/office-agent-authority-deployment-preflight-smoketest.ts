/**
 * Source-only smoke for the Office Agent authority deployment preflight.
 *
 * It proves that default execution cannot consult live credentials or a
 * network, that source/parity drift fails closed, and that even an exact fresh
 * caller-supplied catalog snapshot remains unattested and cannot certify a
 * deployment or release without a reviewed live capture plus canaries.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { inspectLocalSource } from './office-agent-authority-deployment-preflight';

const root = resolve(__dirname, '..');
const scriptPath = resolve(root, 'scripts/office-agent-authority-deployment-preflight.ts');
const source = readFileSync(scriptPath, 'utf8');

const fixtureFiles = [
  'package.json',
  'docs/AGENTS_ROADMAP.md',
  'docs/RUN_THIS_SQL.sql',
  'supabase/config.toml',
  'supabase/migrations/20260225_circle_office.sql',
  'supabase/migrations/20260318_rls_hardening.sql',
  'supabase/migrations/20260327_custom_agent_profiles.sql',
  'supabase/migrations/20260522_repair_agent_identity_and_office_usage.sql',
  'supabase/migrations/20260817130000_agent_identity_primary_rpc.sql',
  'supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql',
  'src/lib/agentSpiritPromptCore.ts',
  'src/lib/agentSpirits.ts',
  'src/lib/spiritCareerProfiles.ts',
  'src/lib/spiritOperationsProfiles.ts',
  'supabase/functions/_shared/agent-spirit-context.ts',
  'supabase/functions/swanbot-ai/index.ts',
  'supabase/functions/swanbot-ai/deno.json',
  'supabase/functions/swanbot-v2-ai/index.ts',
  'supabase/functions/swanbot-v2-ai/deno.json',
  'scripts/swanbot-exact-agent-spirit-smoketest.ts',
] as const;

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
      maxBuffer: 4 * 1_024 * 1_024,
    },
  );
}

function makeFixture(): string {
  const fixture = mkdtempSync(join(tmpdir(), 'uc-office-agent-preflight-'));
  for (const relativePath of fixtureFiles) {
    const destination = resolve(fixture, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(resolve(root, relativePath), destination);
  }
  return fixture;
}

function writeFixtureFile(fixture: string, relativePath: string, value: string): void {
  writeFileSync(resolve(fixture, relativePath), value, 'utf8');
}

function readFixtureFile(fixture: string, relativePath: string): string {
  return readFileSync(resolve(fixture, relativePath), 'utf8');
}

function withRoadmapDeploymentStates(
  roadmap: string,
  section47State: 'pending' | 'applied',
  section48State: 'pending' | 'applied',
): string {
  const stateBySection = new Map([
    [47, section47State],
    [48, section48State],
  ] as const);

  return roadmap
    .split('\n')
    .map((line) => {
      const section = line.startsWith('| 47 |') ? 47 : line.startsWith('| 48 |') ? 48 : null;
      if (section === null) return line;

      const state = stateBySection.get(section);
      const marker = state === 'pending'
        ? '**Pending / not applied.**'
        : '**Applied / catalog-ready.**';
      return line.replace(/\*\*(?:Pending \/ not applied|Applied\b[^*]*)\*\*/u, marker);
    })
    .join('\n');
}

function expectedSnapshot(repoRoot: string): Record<string, unknown> {
  const local = inspectLocalSource(repoRoot);
  check(local.sourceReady, 'snapshot fixture starts from source-ready canonical files');
  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    targetRef: 'reviewed-read-only-target',
    database: {
      migrationVersions: ['20260817130000', '20260817140000'],
      functions: [
        {
          identity: 'public.set_main_agent_for_provider_v1(text,text)',
          ownerRole: 'postgres',
          securityDefiner: true,
          searchPath: '',
          executeRoles: ['authenticated'],
          bodySha256: local.databaseContract.functionBodyDigests['public.set_main_agent_for_provider_v1(text,text)'],
        },
        {
          identity: 'public.guard_agent_identity_primary_columns_v1()',
          ownerRole: 'postgres',
          securityDefiner: false,
          searchPath: '',
          executeRoles: [],
          bodySha256: local.databaseContract.functionBodyDigests['public.guard_agent_identity_primary_columns_v1()'],
        },
        {
          identity: 'public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)',
          ownerRole: 'postgres',
          securityDefiner: true,
          searchPath: '',
          executeRoles: ['authenticated'],
          bodySha256: local.databaseContract.functionBodyDigests['public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)'],
        },
        {
          identity: 'public.delete_unreferenced_custom_agent_profile_v1(uuid)',
          ownerRole: 'postgres',
          securityDefiner: true,
          searchPath: '',
          executeRoles: ['authenticated'],
          bodySha256: local.databaseContract.functionBodyDigests['public.delete_unreferenced_custom_agent_profile_v1(uuid)'],
        },
        {
          identity: 'public.guard_circle_office_agent_spirit_columns_v1()',
          ownerRole: 'postgres',
          securityDefiner: false,
          searchPath: '',
          executeRoles: [],
          bodySha256: local.databaseContract.functionBodyDigests['public.guard_circle_office_agent_spirit_columns_v1()'],
        },
        {
          identity: 'public.guard_published_agent_identity_spirit_columns_v1()',
          ownerRole: 'postgres',
          securityDefiner: false,
          searchPath: '',
          executeRoles: [],
          bodySha256: local.databaseContract.functionBodyDigests['public.guard_published_agent_identity_spirit_columns_v1()'],
        },
      ],
      triggers: local.databaseContract.triggers.map((trigger) => ({ ...trigger, enabled: true })),
      indexes: [{
        ...local.databaseContract.primaryIndex,
        valid: true,
        ready: true,
      }],
      columns: [
        'public.circle_office_agents.spirit:text',
        'public.circle_office_agents.spirit_emoji:text',
      ],
      rlsEnabledRelations: [
        'public.agent_identities',
        'public.circle_members',
        'public.circle_office_agents',
        'public.custom_agent_profiles',
      ],
      policyCompleteRelations: [
        'public.agent_identities',
        'public.circle_office_agents',
        'public.custom_agent_profiles',
      ],
      policies: local.databaseContract.policies,
      tablePrivileges: [
        {
          identity: 'public.agent_identities',
          role: 'authenticated',
          select: true,
          insert: true,
          update: true,
          delete: true,
        },
        {
          identity: 'public.circle_office_agents',
          role: 'authenticated',
          select: true,
          insert: true,
          update: true,
          delete: true,
        },
        {
          identity: 'public.custom_agent_profiles',
          role: 'authenticated',
          select: true,
          insert: true,
          update: true,
          delete: false,
        },
      ],
    },
    edge: {
      functions: [
        { slug: 'swanbot-ai', active: true },
        { slug: 'swanbot-v2-ai', active: true },
      ],
      sourceDigests: local.edge.sourceDigests,
    },
  };
}

function writeSnapshot(fixture: string, snapshot: Record<string, unknown>, name = 'catalog.json'): string {
  const path = resolve(fixture, name);
  writeFileSync(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return path;
}

// Static default-safety contract. The preflight has read/parse/hash imports,
// but no transport, subprocess, environment-secret, or write primitive.
check(!source.includes("from 'node:child_process'"), 'preflight has no subprocess execution surface');
check(!source.includes('fetch('), 'preflight has no HTTP transport');
check(!source.includes('process.env.'), 'preflight does not access environment credentials');
check(!source.includes('dotenv'), 'preflight does not load environment files');
check(!source.includes('writeFileSync') && !source.includes('appendFileSync'), 'preflight cannot write repository or snapshot files');
check(!source.includes('supabase db push') && !source.includes('functions deploy'), 'preflight has no deployment command');
check(source.includes('lstatSync(path)') && source.includes('snapshotStat.isSymbolicLink()'), 'explicit snapshot reads reject final symlinks');
check(source.includes('MAX_SNAPSHOT_BYTES'), 'explicit snapshot reads are size-bounded');
check(source.includes('This command has no apply mode.'), 'operator help states the no-apply boundary');
check(source.includes("mode: 'not_checked'"), 'deployment begins in an explicit not-checked state');
check(source.includes('networkAttempted: false'), 'every report makes the no-network boundary machine-readable');
check(source.includes('mutationsPerformed: false'), 'every report makes the no-mutation boundary machine-readable');
check(source.includes('resolvePromptAt > foreignOwnerGuardAt'), 'foreign-owner custom Spirit denial precedes prompt resolution in the dbId branch');
check(source.includes('exactSpiritBehaviorSmokeReady'), 'source readiness depends on the executable exact-Spirit privacy smoke');

// Default behavior ignores hostile-looking live environment values because no
// environment key can opt the process into deployment or remote access.
const hostileEnv = {
  ...process.env,
  SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-read',
  DATABASE_URL: 'postgresql://must-not-be-read',
  RUN_LIVE_OFFICE_AGENT_AUTHORITY: '1',
};
const defaultRun = runPreflight(['--json'], hostileEnv);
check(defaultRun.status === 0, 'default local-source preflight succeeds for canonical source');
const defaultReport = JSON.parse(defaultRun.stdout) as Record<string, any>;
check(defaultReport.status === 'source_ready_deployment_unverified', 'default status distinguishes source-ready from deployed');
check(defaultReport.source?.sourceReady === true, 'canonical local source is ready');
check(defaultReport.deployment?.status === 'not_checked', 'default does not fabricate deployment evidence');
check(defaultReport.releaseReady === false, 'source readiness alone is never release readiness');
check(defaultReport.source?.networkAttempted === false, 'default reports zero network attempts');
check(defaultReport.source?.mutationsPerformed === false, 'default reports zero mutations');

const missingSnapshotGate = runPreflight(['--require-deployed', '--json']);
check(missingSnapshotGate.status === 2, 'require-deployed without explicit snapshot fails closed');
check(missingSnapshotGate.stderr.includes('--require-deployed requires --catalog-snapshot'), 'missing snapshot gate is actionable');

const fixture = makeFixture();
try {
  const snapshot = expectedSnapshot(fixture);
  const snapshotPath = writeSnapshot(fixture, snapshot);
  const catalogRun = runPreflight([
    '--repo-root', fixture,
    '--catalog-snapshot', snapshotPath,
    '--json',
  ]);
  check(catalogRun.status === 0, 'fresh exact value-free catalog snapshot can match the source contract');
  const catalogReport = JSON.parse(catalogRun.stdout) as Record<string, any>;
  check(catalogReport.status === 'catalog_contract_matches_unattested', 'matching caller-supplied catalog evidence is explicitly unattested');
  check(catalogReport.deployment?.catalogMatches === true, 'explicit snapshot matches the catalog contract');
  check(catalogReport.deployment?.ready === false, 'caller-supplied JSON never certifies deployment');
  check(catalogReport.releaseReady === false, 'unattested catalog evidence is never release readiness');
  check(catalogReport.deployment?.exactSourceVerified === true, 'all Edge source fingerprints match');
  check(catalogReport.deployment?.networkAttempted === false, 'snapshot mode still performs no network access');
  check(catalogReport.deployment?.mutationsPerformed === false, 'snapshot mode still performs no mutations');

  const deploymentGate = runPreflight([
    '--repo-root', fixture,
    '--catalog-snapshot', snapshotPath,
    '--require-deployed',
    '--json',
  ]);
  check(deploymentGate.status === 2, 'unsigned catalog JSON cannot satisfy the explicit deployment gate');
  check(JSON.parse(deploymentGate.stdout).deployment.ready === false, 'require-deployed fails on the machine-readable deployment state');

  const roadmapPath = 'docs/AGENTS_ROADMAP.md';
  const canonicalRoadmap = readFixtureFile(fixture, roadmapPath);
  const invalidRoadmap = withRoadmapDeploymentStates(canonicalRoadmap, 'pending', 'applied');
  writeFixtureFile(fixture, roadmapPath, invalidRoadmap);
  const invalidRoadmapRun = runPreflight(['--repo-root', fixture, '--json']);
  check(invalidRoadmapRun.status === 2, '§48-applied while §47 remains pending is invalid ordering');
  check(JSON.parse(invalidRoadmapRun.stdout).source.roadmapDeploymentState === 'invalid', 'invalid docs ordering is called out');

  const partialRoadmap = withRoadmapDeploymentStates(canonicalRoadmap, 'applied', 'pending');
  writeFixtureFile(fixture, roadmapPath, partialRoadmap);
  const partialRun = runPreflight(['--repo-root', fixture, '--json']);
  check(partialRun.status === 0, 'valid §47-applied/§48-pending rollout remains source-checkable');
  check(JSON.parse(partialRun.stdout).source.roadmapDeploymentState === 'partial', 'partial rollout is explicitly reported');

  const appliedRoadmap = withRoadmapDeploymentStates(canonicalRoadmap, 'applied', 'applied');
  writeFixtureFile(fixture, roadmapPath, appliedRoadmap);
  const appliedCatalogRun = runPreflight([
    '--repo-root', fixture,
    '--catalog-snapshot', snapshotPath,
    '--json',
  ]);
  check(appliedCatalogRun.status === 0, 'applied roadmap remains inspectable with matching catalog evidence');
  const appliedCatalogReport = JSON.parse(appliedCatalogRun.stdout) as Record<string, any>;
  check(appliedCatalogReport.status === 'catalog_contract_matches_unattested', 'applied docs cannot attest caller-authored catalog JSON');
  check(appliedCatalogReport.releaseReady === false, 'applied docs plus unsigned JSON still cannot claim release readiness');

  const wrongIndexKeys = structuredClone(snapshot) as Record<string, any>;
  wrongIndexKeys.database.indexes[0].columns = ['user_id', 'session_key'];
  const wrongIndexKeysPath = writeSnapshot(fixture, wrongIndexKeys, 'wrong-index-keys.json');
  const wrongIndexKeysRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', wrongIndexKeysPath, '--json']);
  check(wrongIndexKeysRun.status === 2, 'same-name partial unique index on wrong keys blocks deployment evidence');
  check(JSON.parse(wrongIndexKeysRun.stdout).deployment.blockers.some((item: string) => item.includes('index keys/method/predicate')), 'exact index-contract drift is named');

  const wrongIndexPredicate = structuredClone(snapshot) as Record<string, any>;
  wrongIndexPredicate.database.indexes[0].predicate = '(is_primary IS TRUE) OR (bound_ai_provider IS NOT NULL)';
  const wrongIndexPredicatePath = writeSnapshot(fixture, wrongIndexPredicate, 'wrong-index-predicate.json');
  const wrongIndexPredicateRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', wrongIndexPredicatePath, '--json']);
  check(wrongIndexPredicateRun.status === 2, 'non-canonical partial-index predicate blocks deployment evidence');

  const duplicateFunction = structuredClone(snapshot) as Record<string, any>;
  duplicateFunction.database.functions.push({
    ...duplicateFunction.database.functions[0],
    executeRoles: ['anon'],
  });
  const duplicateFunctionPath = writeSnapshot(fixture, duplicateFunction, 'duplicate-function.json');
  const duplicateFunctionRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', duplicateFunctionPath, '--json']);
  check(duplicateFunctionRun.status === 2, 'duplicate function identities are rejected rather than trusting the first row');

  const duplicatePrivilege = structuredClone(snapshot) as Record<string, any>;
  duplicatePrivilege.database.tablePrivileges.push({
    ...duplicatePrivilege.database.tablePrivileges[0],
    delete: true,
  });
  const duplicatePrivilegePath = writeSnapshot(fixture, duplicatePrivilege, 'duplicate-privilege.json');
  const duplicatePrivilegeRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', duplicatePrivilegePath, '--json']);
  check(duplicatePrivilegeRun.status === 2, 'duplicate privilege rows cannot hide a widened later row');

  const permissivePolicy = structuredClone(snapshot) as Record<string, any>;
  permissivePolicy.database.policies.find(
    (item: Record<string, unknown>) => item.identity === 'public.custom_agent_profiles.custom_profiles_own',
  ).usingExpression = 'true';
  const permissivePolicyPath = writeSnapshot(fixture, permissivePolicy, 'permissive-policy.json');
  const permissivePolicyRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', permissivePolicyPath, '--json']);
  check(permissivePolicyRun.status === 2, 'owner-unsafe custom-profile policy qualifier blocks deployment evidence');
  check(JSON.parse(permissivePolicyRun.stdout).deployment.blockers.some((item: string) => item.includes('policy inventory')), 'policy fingerprint drift is named');

  const missingPolicy = structuredClone(snapshot) as Record<string, any>;
  missingPolicy.database.policies = missingPolicy.database.policies.filter(
    (item: Record<string, unknown>) => item.identity !== 'public.custom_agent_profiles.custom_profiles_shared_read',
  );
  const missingPolicyPath = writeSnapshot(fixture, missingPolicy, 'missing-policy.json');
  const missingPolicyRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', missingPolicyPath, '--json']);
  check(missingPolicyRun.status === 2, 'incomplete declared custom-profile policy inventory blocks deployment evidence');

  const digestMismatch = structuredClone(snapshot) as Record<string, any>;
  digestMismatch.edge.sourceDigests['supabase/functions/_shared/agent-spirit-context.ts'] = '0'.repeat(64);
  const digestPath = writeSnapshot(fixture, digestMismatch, 'digest-mismatch.json');
  const digestRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', digestPath, '--json']);
  check(digestRun.status === 2, 'Edge source-fingerprint drift blocks deployment evidence');
  check(JSON.parse(digestRun.stdout).deployment.blockers.some((item: string) => item.includes('fingerprints')), 'digest blocker is explicit');

  const extraRole = structuredClone(snapshot) as Record<string, any>;
  extraRole.database.functions[0].executeRoles.push('anon');
  const extraRolePath = writeSnapshot(fixture, extraRole, 'extra-role.json');
  const extraRoleRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', extraRolePath, '--json']);
  check(extraRoleRun.status === 2, 'widened execute grants block deployment evidence');
  check(JSON.parse(extraRoleRun.stdout).deployment.blockers.some((item: string) => item.includes('execute roles')), 'grant drift is named');

  const wrongFunctionOwner = structuredClone(snapshot) as Record<string, any>;
  wrongFunctionOwner.database.functions[0].ownerRole = 'authenticated';
  const wrongFunctionOwnerPath = writeSnapshot(fixture, wrongFunctionOwner, 'wrong-function-owner.json');
  const wrongFunctionOwnerRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', wrongFunctionOwnerPath, '--json']);
  check(wrongFunctionOwnerRun.status === 2, 'wrong function owner cannot inherit the trusted trigger/RPC boundary');
  check(JSON.parse(wrongFunctionOwnerRun.stdout).deployment.blockers.some((item: string) => item.includes('owner role')), 'function-owner drift is named');

  const permissiveIdentityPolicy = structuredClone(snapshot) as Record<string, any>;
  permissiveIdentityPolicy.database.policies.find(
    (item: Record<string, unknown>) => item.identity === 'public.agent_identities.Users update own agent identities',
  ).usingExpression = 'true';
  const permissiveIdentityPolicyPath = writeSnapshot(fixture, permissiveIdentityPolicy, 'permissive-identity-policy.json');
  const permissiveIdentityPolicyRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', permissiveIdentityPolicyPath, '--json']);
  check(permissiveIdentityPolicyRun.status === 2, 'permissive agent-identity policy blocks catalog evidence');

  const extraOfficePolicy = structuredClone(snapshot) as Record<string, any>;
  extraOfficePolicy.database.policies.push({
    identity: 'public.circle_office_agents.everyone_updates',
    command: 'UPDATE',
    roles: ['public'],
    usingExpression: 'true',
    withCheckExpression: 'true',
  });
  const extraOfficePolicyPath = writeSnapshot(fixture, extraOfficePolicy, 'extra-office-policy.json');
  const extraOfficePolicyRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', extraOfficePolicyPath, '--json']);
  check(extraOfficePolicyRun.status === 2, 'unknown permissive Office policy blocks complete catalog evidence');

  const noLegacyOfficePolicies = structuredClone(snapshot) as Record<string, any>;
  noLegacyOfficePolicies.database.policies = noLegacyOfficePolicies.database.policies.filter(
    (item: Record<string, unknown>) => ![
      'public.circle_office_agents.circle members can view office agents',
      'public.circle_office_agents.owners can manage their office agents',
    ].includes(item.identity as string),
  );
  const noLegacyOfficePoliciesPath = writeSnapshot(fixture, noLegacyOfficePolicies, 'no-legacy-office-policies.json');
  const noLegacyOfficePoliciesRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', noLegacyOfficePoliciesPath, '--json']);
  check(noLegacyOfficePoliciesRun.status === 0, 'known-safe legacy Office policies are optional when the four canonical policies remain exact');

  const oldFunctionBody = structuredClone(snapshot) as Record<string, any>;
  oldFunctionBody.database.functions.find(
    (item: Record<string, unknown>) => item.identity === 'public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)',
  ).bodySha256 = '1'.repeat(64);
  const oldFunctionBodyPath = writeSnapshot(fixture, oldFunctionBody, 'old-function-body.json');
  const oldFunctionBodyRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', oldFunctionBodyPath, '--json']);
  check(oldFunctionBodyRun.status === 2, 'same-version target with an old function body blocks deployment evidence');
  check(JSON.parse(oldFunctionBodyRun.stdout).deployment.blockers.some((item: string) => item.includes('body fingerprint')), 'function body drift is named');

  const disabledTrigger = structuredClone(snapshot) as Record<string, any>;
  disabledTrigger.database.triggers[0].enabled = false;
  const disabledTriggerPath = writeSnapshot(fixture, disabledTrigger, 'disabled-trigger.json');
  const disabledTriggerRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', disabledTriggerPath, '--json']);
  check(disabledTriggerRun.status === 2, 'disabled target trigger blocks deployment evidence');

  const incompleteTrigger = structuredClone(snapshot) as Record<string, any>;
  const publishedIdentityTrigger = incompleteTrigger.database.triggers.find(
    (item: Record<string, unknown>) => item.identity === 'public.agent_identities.published_agent_identity_spirit_columns_guard',
  );
  publishedIdentityTrigger.updateColumns = publishedIdentityTrigger.updateColumns.filter((column: string) => column !== 'session_key');
  const incompleteTriggerPath = writeSnapshot(fixture, incompleteTrigger, 'incomplete-trigger.json');
  const incompleteTriggerRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', incompleteTriggerPath, '--json']);
  check(incompleteTriggerRun.status === 2, 'same-name trigger missing session_key coverage blocks deployment evidence');
  check(JSON.parse(incompleteTriggerRun.stdout).deployment.blockers.some((item: string) => item.includes('trigger contract differs')), 'trigger transition drift is named');

  const widenedDelete = structuredClone(snapshot) as Record<string, any>;
  widenedDelete.database.tablePrivileges.find(
    (item: Record<string, unknown>) => item.identity === 'public.custom_agent_profiles' && item.role === 'authenticated',
  ).delete = true;
  const widenedDeletePath = writeSnapshot(fixture, widenedDelete, 'widened-delete.json');
  const widenedDeleteRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', widenedDeletePath, '--json']);
  check(widenedDeleteRun.status === 2, 'authenticated direct custom-profile DELETE blocks deployment evidence');
  check(JSON.parse(widenedDeleteRun.stdout).deployment.blockers.some((item: string) => item.includes('table privileges')), 'table privilege drift is named');

  const stale = structuredClone(snapshot) as Record<string, any>;
  stale.capturedAt = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString();
  const stalePath = writeSnapshot(fixture, stale, 'stale.json');
  const staleRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', stalePath, '--json']);
  check(staleRun.status === 2, 'stale catalog evidence fails closed');

  const secretBearing = structuredClone(snapshot) as Record<string, any>;
  secretBearing.service_role_key = 'forbidden';
  const secretPath = writeSnapshot(fixture, secretBearing, 'secret-bearing.json');
  const secretRun = runPreflight(['--repo-root', fixture, '--catalog-snapshot', secretPath, '--json']);
  check(secretRun.status === 2, 'secret-bearing or non-schema snapshot fields are rejected');
  check(JSON.parse(secretRun.stdout).deployment.blockers.some((item: string) => item.includes('value-free schema')), 'value-free schema rejection is explicit');

  // One-byte consolidated drift is enough to block; source readiness never
  // accepts a semantically similar but non-canonical SQL copy.
  const consolidatedPath = 'docs/RUN_THIS_SQL.sql';
  const consolidated = readFixtureFile(fixture, consolidatedPath);
  writeFixtureFile(fixture, consolidatedPath, consolidated.replace(
    'At most one durable primary identity per exact owner and provider.',
    'At most one durable primary identity per owner and provider.',
  ));
  const parityRun = runPreflight(['--repo-root', fixture, '--json']);
  check(parityRun.status === 2, 'RUN_THIS_SQL parity drift blocks local source readiness');
  check(JSON.parse(parityRun.stdout).source.blockers.some((item: string) => item.includes('byte-exact')), 'parity blocker names the exact boundary');
  writeFixtureFile(fixture, consolidatedPath, consolidated);

  writeFixtureFile(
    fixture,
    consolidatedPath,
    `-- BEGIN SECTION 47: Transactional primary-agent identity selection\n${consolidated}`,
  );
  const strayBoundaryRun = runPreflight(['--repo-root', fixture, '--json']);
  check(strayBoundaryRun.status === 2, 'a stray duplicate section boundary before the canonical prefix blocks readiness');
  check(JSON.parse(strayBoundaryRun.stdout).source.blockers.some((item: string) => item.includes('boundaries')), 'duplicate-boundary blocker names the consolidated boundary');
  writeFixtureFile(fixture, consolidatedPath, consolidated);

  cpSync(
    resolve(fixture, 'supabase/migrations/20260817130000_agent_identity_primary_rpc.sql'),
    resolve(fixture, 'supabase/migrations/20260817130000_duplicate_primary_rpc.sql'),
  );
  const duplicateRun = runPreflight(['--repo-root', fixture, '--json']);
  check(duplicateRun.status === 2, 'duplicate migration version blocks rollout ordering');
  rmSync(resolve(fixture, 'supabase/migrations/20260817130000_duplicate_primary_rpc.sql'));

  const resolverPath = 'supabase/functions/_shared/agent-spirit-context.ts';
  const resolver = readFixtureFile(fixture, resolverPath);
  writeFixtureFile(fixture, resolverPath, resolver.replace(
    ".eq('is_published', true)",
    ".eq('name', args.target.dbId)",
  ));
  const nameLookupRun = runPreflight(['--repo-root', fixture, '--json']);
  check(nameLookupRun.status === 2, 'display-name authority drift blocks exact Spirit source readiness');
  check(JSON.parse(nameLookupRun.stdout).source.edge.exactResolverReady === false, 'resolver drift is classified exactly');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log(`PASS Office Agent authority deployment preflight smoke (${assertions} assertions)`);
