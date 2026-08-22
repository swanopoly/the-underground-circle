/**
 * Source/deployment preflight for the Office Agent authority rollout:
 *
 * - §47 transactional primary-agent identity selection
 * - §48 atomic published-agent Spirit projection
 * - exact assigned-Spirit context in SwanBot v1 and v2
 *
 * The default command is deliberately repository-only. It reads canonical
 * source files, never loads environment files or process.env credentials,
 * never opens a socket, and has no SQL/function deployment path.
 *
 * An operator may explicitly supply a value-free catalog snapshot produced by
 * a separately reviewed read-only workflow. That snapshot can prove catalog
 * presence and exact source-fingerprint agreement, but this command still
 * performs no remote access or mutation itself.
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

type SectionId = 47 | 48;

interface CliOptions {
  repoRoot: string;
  json: boolean;
  catalogSnapshotPath: string | null;
  requireDeployed: boolean;
}

interface SectionSpec {
  id: SectionId;
  label: string;
  migration: string;
  header: string;
  sourceMarker: string;
  footer: string;
  markers: string[];
}

interface SectionReport {
  id: SectionId;
  label: string;
  migration: string;
  migrationPresent: boolean;
  uniqueMigrationVersion: boolean;
  transactionShapeReady: boolean;
  consolidatedBoundaryReady: boolean;
  consolidatedParityReady: boolean;
  requiredMarkersReady: boolean;
  ready: boolean;
  blockers: string[];
}

interface EdgeSourceReport {
  ready: boolean;
  exactTargetParserReady: boolean;
  exactResolverReady: boolean;
  privateCustomBoundaryReady: boolean;
  exactSpiritBehaviorSmokeReady: boolean;
  v1WiringReady: boolean;
  v2WiringReady: boolean;
  deploymentConfigReady: boolean;
  sourceDigests: Record<string, string>;
  blockers: string[];
}

interface TriggerContract {
  identity: string;
  timing: 'BEFORE' | 'AFTER' | 'INSTEAD OF';
  events: string[];
  updateColumns: string[];
  functionIdentity: string;
}

interface IndexContract {
  identity: string;
  unique: boolean;
  accessMethod: string;
  columns: string[];
  predicate: string;
}

interface PolicyContract {
  identity: string;
  command: string;
  roles: string[];
  usingExpression: string | null;
  withCheckExpression: string | null;
}

interface DatabaseSourceContractReport {
  ready: boolean;
  functionBodyDigests: Record<string, string>;
  triggers: TriggerContract[];
  primaryIndex: IndexContract | null;
  policies: PolicyContract[];
  customProfilePolicies: PolicyContract[];
  blockers: string[];
}

interface LocalSourceReport {
  mode: 'local_source';
  status: 'ready' | 'blocked';
  sourceReady: boolean;
  deploymentChecked: false;
  networkAttempted: false;
  mutationsPerformed: false;
  migrationOrderReady: boolean;
  consolidatedOrderReady: boolean;
  roadmapDeploymentTruthReady: boolean;
  roadmapDeploymentState: 'pending' | 'partial' | 'applied' | 'invalid';
  sections: SectionReport[];
  databaseContract: DatabaseSourceContractReport;
  edge: EdgeSourceReport;
  blockers: string[];
}

interface CatalogFunction {
  identity: string;
  ownerRole: string;
  securityDefiner: boolean;
  searchPath: string;
  executeRoles: string[];
  bodySha256: string;
}

interface CatalogTrigger extends TriggerContract {
  enabled: boolean;
}

interface CatalogIndex {
  identity: string;
  unique: boolean;
  valid: boolean;
  ready: boolean;
  accessMethod: string;
  columns: string[];
  predicate: string | null;
}

interface DeploymentCatalogSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  targetRef: string;
  database: {
    migrationVersions: string[];
    functions: CatalogFunction[];
    triggers: CatalogTrigger[];
    indexes: CatalogIndex[];
    columns: string[];
    rlsEnabledRelations: string[];
    policyCompleteRelations: string[];
    policies: PolicyContract[];
    tablePrivileges: Array<{
      identity: string;
      role: string;
      select: boolean;
      insert: boolean;
      update: boolean;
      delete: boolean;
    }>;
  };
  edge: {
    functions: Array<{ slug: string; active: boolean }>;
    sourceDigests: Record<string, string>;
  };
}

interface DeploymentReport {
  mode: 'not_checked' | 'catalog_snapshot';
  status: 'not_checked' | 'catalog_matches_unattested' | 'blocked';
  checked: boolean;
  ready: boolean;
  catalogMatches: boolean;
  networkAttempted: false;
  mutationsPerformed: false;
  exactSourceVerified: boolean;
  targetRef: string | null;
  capturedAt: string | null;
  blockers: string[];
  releaseBlockers: string[];
}

interface PreflightReport {
  schemaVersion: 1;
  status: 'source_ready_deployment_unverified' | 'catalog_contract_matches_unattested' | 'blocked';
  source: LocalSourceReport;
  deployment: DeploymentReport;
  releaseReady: boolean;
}

const SECTION_SPECS: SectionSpec[] = [
  {
    id: 47,
    label: 'Transactional primary-agent identity selection',
    migration: '20260817130000_agent_identity_primary_rpc.sql',
    header: '-- BEGIN SECTION 47: Transactional primary-agent identity selection',
    sourceMarker: '-- Source: supabase/migrations/20260817130000_agent_identity_primary_rpc.sql',
    footer: '-- END SECTION 47: Transactional primary-agent identity selection',
    markers: [
      'CREATE UNIQUE INDEX IF NOT EXISTS agent_identities_one_primary_per_provider_idx',
      'CREATE OR REPLACE FUNCTION public.set_main_agent_for_provider_v1(',
      'SECURITY DEFINER',
      "SET search_path = ''",
      'pg_catalog.pg_advisory_xact_lock(',
      'CREATE OR REPLACE FUNCTION public.guard_agent_identity_primary_columns_v1()',
      'CREATE TRIGGER agent_identity_primary_columns_guard',
      'CREATE TRIGGER agent_identity_primary_delete_guard',
      'REVOKE ALL ON FUNCTION public.set_main_agent_for_provider_v1(text, text)',
      'GRANT EXECUTE ON FUNCTION public.set_main_agent_for_provider_v1(text, text)\n  TO authenticated',
    ],
  },
  {
    id: 48,
    label: 'Atomic published-agent Spirit projection',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    header: '-- BEGIN SECTION 48: Atomic published-agent Spirit projection',
    sourceMarker: '-- Source: supabase/migrations/20260817140000_agent_spirit_assignment_rpc.sql',
    footer: '-- END SECTION 48: Atomic published-agent Spirit projection',
    markers: [
      'ADD COLUMN IF NOT EXISTS spirit text',
      'ADD COLUMN IF NOT EXISTS spirit_emoji text',
      'CREATE OR REPLACE FUNCTION public.set_published_agent_spirit_v1(',
      'CREATE OR REPLACE FUNCTION public.delete_unreferenced_custom_agent_profile_v1(',
      "SET search_path = ''",
      'FOR KEY SHARE;',
      'FOR UPDATE;',
      'CREATE OR REPLACE FUNCTION public.guard_circle_office_agent_spirit_columns_v1()',
      'CREATE OR REPLACE FUNCTION public.guard_published_agent_identity_spirit_columns_v1()',
      'CREATE TRIGGER circle_office_agent_spirit_columns_guard',
      'CREATE TRIGGER published_agent_identity_spirit_columns_guard',
      'GRANT EXECUTE ON FUNCTION public.set_published_agent_spirit_v1(uuid, uuid, text, text, uuid)\n  TO authenticated',
      'GRANT EXECUTE ON FUNCTION public.delete_unreferenced_custom_agent_profile_v1(uuid)\n  TO authenticated',
      'REVOKE DELETE ON TABLE public.custom_agent_profiles FROM authenticated',
    ],
  },
];

const EDGE_SOURCE_FILES = [
  'src/lib/agentSpiritPromptCore.ts',
  'src/lib/agentSpirits.ts',
  'src/lib/spiritCareerProfiles.ts',
  'src/lib/spiritOperationsProfiles.ts',
  'supabase/functions/_shared/agent-spirit-context.ts',
  'supabase/functions/swanbot-ai/index.ts',
  'supabase/functions/swanbot-ai/deno.json',
  'supabase/functions/swanbot-v2-ai/index.ts',
  'supabase/functions/swanbot-v2-ai/deno.json',
  'supabase/config.toml',
] as const;

const EXPECTED_FUNCTIONS = [
  {
    identity: 'public.set_main_agent_for_provider_v1(text,text)',
    migration: '20260817130000_agent_identity_primary_rpc.sql',
    sourceMarker: 'CREATE OR REPLACE FUNCTION public.set_main_agent_for_provider_v1(',
    securityDefiner: true,
    ownerRole: 'postgres',
    executeRoles: ['authenticated'],
  },
  {
    identity: 'public.guard_agent_identity_primary_columns_v1()',
    migration: '20260817130000_agent_identity_primary_rpc.sql',
    sourceMarker: 'CREATE OR REPLACE FUNCTION public.guard_agent_identity_primary_columns_v1()',
    securityDefiner: false,
    ownerRole: 'postgres',
    executeRoles: [],
  },
  {
    identity: 'public.set_published_agent_spirit_v1(uuid,uuid,text,text,uuid)',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    sourceMarker: 'CREATE OR REPLACE FUNCTION public.set_published_agent_spirit_v1(',
    securityDefiner: true,
    ownerRole: 'postgres',
    executeRoles: ['authenticated'],
  },
  {
    identity: 'public.delete_unreferenced_custom_agent_profile_v1(uuid)',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    sourceMarker: 'CREATE OR REPLACE FUNCTION public.delete_unreferenced_custom_agent_profile_v1(',
    securityDefiner: true,
    ownerRole: 'postgres',
    executeRoles: ['authenticated'],
  },
  {
    identity: 'public.guard_circle_office_agent_spirit_columns_v1()',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    sourceMarker: 'CREATE OR REPLACE FUNCTION public.guard_circle_office_agent_spirit_columns_v1()',
    securityDefiner: false,
    ownerRole: 'postgres',
    executeRoles: [],
  },
  {
    identity: 'public.guard_published_agent_identity_spirit_columns_v1()',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    sourceMarker: 'CREATE OR REPLACE FUNCTION public.guard_published_agent_identity_spirit_columns_v1()',
    securityDefiner: false,
    ownerRole: 'postgres',
    executeRoles: [],
  },
] as const;

const EXPECTED_TRIGGERS = [
  {
    identity: 'public.agent_identities.agent_identity_primary_columns_guard',
    migration: '20260817130000_agent_identity_primary_rpc.sql',
    name: 'agent_identity_primary_columns_guard',
  },
  {
    identity: 'public.agent_identities.agent_identity_primary_delete_guard',
    migration: '20260817130000_agent_identity_primary_rpc.sql',
    name: 'agent_identity_primary_delete_guard',
  },
  {
    identity: 'public.circle_office_agents.circle_office_agent_spirit_columns_guard',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    name: 'circle_office_agent_spirit_columns_guard',
  },
  {
    identity: 'public.agent_identities.published_agent_identity_spirit_columns_guard',
    migration: '20260817140000_agent_spirit_assignment_rpc.sql',
    name: 'published_agent_identity_spirit_columns_guard',
  },
] as const;

const EXPECTED_COLUMNS = [
  'public.circle_office_agents.spirit:text',
  'public.circle_office_agents.spirit_emoji:text',
] as const;

const EXPECTED_RLS_RELATIONS = [
  'public.agent_identities',
  'public.circle_members',
  'public.circle_office_agents',
  'public.custom_agent_profiles',
] as const;

const EXPECTED_POLICY_SPECS = [
  { relation: 'public.agent_identities', table: 'agent_identities', name: 'Users read own agent identities', migration: '20260522_repair_agent_identity_and_office_usage.sql' },
  { relation: 'public.agent_identities', table: 'agent_identities', name: 'Users insert own agent identities', migration: '20260522_repair_agent_identity_and_office_usage.sql' },
  { relation: 'public.agent_identities', table: 'agent_identities', name: 'Users update own agent identities', migration: '20260522_repair_agent_identity_and_office_usage.sql' },
  { relation: 'public.agent_identities', table: 'agent_identities', name: 'Users delete own agent identities', migration: '20260522_repair_agent_identity_and_office_usage.sql' },
  { relation: 'public.circle_office_agents', table: 'circle_office_agents', name: 'circle members can view office agents', migration: '20260225_circle_office.sql', optionalSafeLegacy: true },
  { relation: 'public.circle_office_agents', table: 'circle_office_agents', name: 'owners can manage their office agents', migration: '20260225_circle_office.sql', optionalSafeLegacy: true },
  { relation: 'public.circle_office_agents', table: 'circle_office_agents', name: 'rls_oa_select', migration: '20260318_rls_hardening.sql' },
  { relation: 'public.circle_office_agents', table: 'circle_office_agents', name: 'rls_oa_insert', migration: '20260318_rls_hardening.sql' },
  { relation: 'public.circle_office_agents', table: 'circle_office_agents', name: 'rls_oa_update', migration: '20260318_rls_hardening.sql' },
  { relation: 'public.circle_office_agents', table: 'circle_office_agents', name: 'rls_oa_delete', migration: '20260318_rls_hardening.sql' },
  { relation: 'public.custom_agent_profiles', table: 'custom_agent_profiles', name: 'custom_profiles_own', migration: '20260327_custom_agent_profiles.sql' },
  { relation: 'public.custom_agent_profiles', table: 'custom_agent_profiles', name: 'custom_profiles_shared_read', migration: '20260327_custom_agent_profiles.sql' },
] as const;

const EXPECTED_AUTHENTICATED_TABLE_PRIVILEGES = [
  { identity: 'public.agent_identities', select: true, insert: true, update: true, delete: true },
  { identity: 'public.circle_office_agents', select: true, insert: true, update: true, delete: true },
  { identity: 'public.custom_agent_profiles', select: true, insert: true, update: true, delete: false },
] as const;

const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_SNAPSHOT_BYTES = 256 * 1_024;
const TARGET_REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const SECRETISH_KEY_PATTERN = /(secret|token|password|credential|api[_-]?key|private[_-]?key|service[_-]?role|authorization|cookie|row[_-]?data)/iu;

function usage(): string {
  return `Office Agent authority deployment preflight

Usage:
  npm run preflight:office-agent-authority-deployment -- [options]

Options:
  --json                     Print machine-readable JSON.
  --repo-root <path>         Inspect another repository root (test fixtures).
  --catalog-snapshot <path>  Read an explicit value-free deployment snapshot.
  --require-deployed         Fail closed: unsigned snapshots cannot prove deployment.
  --help                     Show this help.

Default behavior is local-source only. It performs no network requests, reads
no environment credentials, and applies no SQL or Edge functions. A catalog
snapshot is untrusted catalog-shape evidence only; it must contain no row data
or secrets and cannot prove deployment or release readiness. Function
bodySha256 values are SHA-256 of
the exact pg_proc.prosrc after CRLF-to-LF normalization and outer trim; trigger
fields come from the target catalog definition, not migration-version claims.
This command has no apply mode.`;
}

function parseArgs(argv: string[]): CliOptions | null {
  const options: CliOptions = {
    repoRoot: resolve(__dirname, '..'),
    json: false,
    catalogSnapshotPath: null,
    requireDeployed: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return null;
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--require-deployed') {
      options.requireDeployed = true;
      continue;
    }
    if (arg === '--repo-root' || arg === '--catalog-snapshot') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path`);
      index += 1;
      if (arg === '--repo-root') options.repoRoot = resolve(value);
      else options.catalogSnapshotPath = resolve(value);
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }
  if (options.requireDeployed && !options.catalogSnapshotPath) {
    throw new Error('--require-deployed requires --catalog-snapshot');
  }
  return options;
}

function read(repoRoot: string, relativePath: string): string | null {
  const path = resolve(repoRoot, relativePath);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8');
}

function sha256(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

function uniqueMigrationVersionReady(repoRoot: string, migration: string): boolean {
  const migrationDir = resolve(repoRoot, 'supabase/migrations');
  if (!existsSync(migrationDir)) return false;
  const version = migration.slice(0, migration.indexOf('_'));
  return readdirSync(migrationDir).filter((name) => name.startsWith(`${version}_`) && name.endsWith('.sql')).length === 1;
}

function inspectSection(repoRoot: string, consolidated: string | null, spec: SectionSpec): SectionReport {
  const blockers: string[] = [];
  const migration = read(repoRoot, `supabase/migrations/${spec.migration}`);
  const migrationPresent = migration !== null;
  const uniqueMigrationVersion = uniqueMigrationVersionReady(repoRoot, spec.migration);
  if (!migrationPresent) blockers.push(`missing canonical migration ${spec.migration}`);
  if (!uniqueMigrationVersion) blockers.push(`migration version for ${spec.migration} is missing or duplicated`);

  const transactionShapeReady = !!migration
    && migration.startsWith(spec.id === 47 ? '-- Transactional primary-agent selection for durable agent identities.' : '-- Atomic published-agent Spirit projection.')
    && migration.includes('\nBEGIN;\n')
    && migration.includes('\nCOMMIT;\n\nNOTIFY pgrst, \'reload schema\';\n')
    && migration.indexOf('\nBEGIN;\n') < migration.indexOf('\nCOMMIT;\n');
  if (!transactionShapeReady) blockers.push(`§${spec.id} transaction/notify shape is not canonical`);

  const prefix = `${spec.header}\n${spec.sourceMarker}\n`;
  const start = consolidated?.indexOf(prefix) ?? -1;
  const end = start >= 0 ? consolidated!.indexOf(spec.footer, start + prefix.length) : -1;
  const headerCount = consolidated ? consolidated.split(spec.header).length - 1 : 0;
  const sourceMarkerCount = consolidated ? consolidated.split(spec.sourceMarker).length - 1 : 0;
  const footerCount = consolidated ? consolidated.split(spec.footer).length - 1 : 0;
  const consolidatedBoundaryReady = start >= 0
    && end > start
    && headerCount === 1
    && sourceMarkerCount === 1
    && footerCount === 1;
  if (!consolidatedBoundaryReady) blockers.push(`§${spec.id} consolidated boundaries are missing or duplicated`);
  const consolidatedParityReady = !!migration
    && consolidatedBoundaryReady
    && consolidated!.slice(start + prefix.length, end) === migration;
  if (!consolidatedParityReady) blockers.push(`§${spec.id} RUN_THIS_SQL body is not byte-exact with its migration`);

  const missingMarkers = migration ? spec.markers.filter((marker) => !migration.includes(marker)) : spec.markers;
  const requiredMarkersReady = missingMarkers.length === 0;
  if (!requiredMarkersReady) blockers.push(`§${spec.id} is missing ${missingMarkers.length} required authority marker(s)`);

  return {
    id: spec.id,
    label: spec.label,
    migration: spec.migration,
    migrationPresent,
    uniqueMigrationVersion,
    transactionShapeReady,
    consolidatedBoundaryReady,
    consolidatedParityReady,
    requiredMarkersReady,
    ready: blockers.length === 0,
    blockers,
  };
}

function normalizedFunctionBody(source: string, sourceMarker: string): string | null {
  const functionAt = source.indexOf(sourceMarker);
  if (functionAt < 0) return null;
  const delimiter = 'AS $function$';
  const bodyAt = source.indexOf(delimiter, functionAt + sourceMarker.length);
  if (bodyAt < 0) return null;
  const bodyEnd = source.indexOf('$function$;', bodyAt + delimiter.length);
  if (bodyEnd < 0) return null;
  return source
    .slice(bodyAt + delimiter.length, bodyEnd)
    .replace(/\r\n?/gu, '\n')
    .trim();
}

function deriveTriggerContract(
  source: string,
  expected: (typeof EXPECTED_TRIGGERS)[number],
): TriggerContract | null {
  const triggerAt = source.indexOf(`CREATE TRIGGER ${expected.name}`);
  if (triggerAt < 0) return null;
  const statementEnd = source.indexOf(';', triggerAt);
  if (statementEnd < 0) return null;
  const statement = source.slice(triggerAt, statementEnd + 1).replace(/\r\n?/gu, '\n');
  const timing = statement.match(/CREATE TRIGGER\s+\S+\s+(BEFORE|AFTER|INSTEAD OF)\s+/u)?.[1];
  const functionIdentity = statement.match(/EXECUTE FUNCTION\s+(public\.[a-z0-9_]+\(\))/iu)?.[1];
  if (timing !== 'BEFORE' && timing !== 'AFTER' && timing !== 'INSTEAD OF') return null;
  if (!functionIdentity) return null;
  const events = ['DELETE', 'INSERT', 'UPDATE'].filter((event) => new RegExp(`\\b${event}\\b`, 'u').test(statement));
  let updateColumns: string[] = [];
  const updateAt = statement.indexOf('UPDATE OF ');
  const tableAt = statement.indexOf('\n  ON public.', updateAt);
  if (updateAt >= 0) {
    if (tableAt < 0) return null;
    updateColumns = statement
      .slice(updateAt + 'UPDATE OF '.length, tableAt)
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
      .sort();
  }
  return {
    identity: expected.identity,
    timing,
    events,
    updateColumns,
    functionIdentity,
  };
}

function normalizeIndexPredicate(value: string): string {
  return value
    .replace(/"/gu, '')
    .replace(/[()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function derivePrimaryIndexContract(source: string): IndexContract | null {
  const marker = 'CREATE UNIQUE INDEX IF NOT EXISTS agent_identities_one_primary_per_provider_idx';
  const indexAt = source.indexOf(marker);
  if (indexAt < 0) return null;
  const statementEnd = source.indexOf(';', indexAt);
  if (statementEnd < 0) return null;
  const statement = source.slice(indexAt, statementEnd + 1).replace(/\r\n?/gu, '\n');
  const match = statement.match(
    /ON\s+public\.agent_identities\s*\(([^)]+)\)\s*WHERE\s+([\s\S]+);$/u,
  );
  if (!match) return null;
  const columns = match[1].split(',').map((column) => column.trim()).filter(Boolean);
  const predicate = normalizeIndexPredicate(match[2]);
  if (columns.length === 0 || !predicate) return null;
  return {
    identity: 'public.agent_identities.agent_identities_one_primary_per_provider_idx',
    unique: true,
    accessMethod: 'btree',
    columns,
    predicate,
  };
}

function stripBalancedOuterParens(value: string): string {
  let current = value.trim();
  while (current.startsWith('(') && current.endsWith(')')) {
    let depth = 0;
    let wrapsWhole = true;
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] === '(') depth += 1;
      else if (current[index] === ')') depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        wrapsWhole = false;
        break;
      }
      if (depth < 0) return current;
    }
    if (!wrapsWhole || depth !== 0) break;
    current = current.slice(1, -1).trim();
  }
  return current;
}

function normalizePolicyExpression(value: string | null): string | null {
  if (value === null) return null;
  return stripBalancedOuterParens(
    value.replace(/"/gu, '').replace(/\s+/gu, ' ').trim().toLowerCase(),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function extractBalancedPolicyClause(statement: string, keyword: 'USING' | 'WITH CHECK'): string | null {
  const keywordPattern = keyword === 'USING' ? /\bUSING\s*\(/iu : /\bWITH\s+CHECK\s*\(/iu;
  const match = keywordPattern.exec(statement);
  if (!match) return null;
  const openAt = statement.indexOf('(', match.index);
  if (openAt < 0) return null;
  let depth = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = openAt; index < statement.length; index += 1) {
    const char = statement[index];
    const next = statement[index + 1];
    if (singleQuoted) {
      if (char === "'" && next === "'") {
        index += 1;
      } else if (char === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (doubleQuoted) {
      if (char === '"' && next === '"') {
        index += 1;
      } else if (char === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (char === "'") {
      singleQuoted = true;
      continue;
    }
    if (char === '"') {
      doubleQuoted = true;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return statement.slice(openAt + 1, index);
      if (depth < 0) return null;
    }
  }
  return null;
}

function derivePolicyContract(
  source: string,
  spec: (typeof EXPECTED_POLICY_SPECS)[number],
): PolicyContract | null {
  const escapedName = escapeRegExp(spec.name);
  const escapedTable = escapeRegExp(spec.table);
  const marker = new RegExp(
    `CREATE\\s+POLICY\\s+(?:"${escapedName}"|${escapedName})\\s+ON\\s+(?:public\\.)?${escapedTable}\\b`,
    'iu',
  );
  const match = marker.exec(source);
  if (!match) return null;
  const statementEnd = source.indexOf(';', match.index);
  if (statementEnd < 0) return null;
  const statement = source.slice(match.index, statementEnd + 1).replace(/\r\n?/gu, '\n');
  const command = statement.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/iu)?.[1]?.toUpperCase() || 'ALL';
  const rolesText = statement.match(/\bTO\s+([\s\S]*?)(?=\bUSING\b|\bWITH\s+CHECK\b|;)/iu)?.[1] || 'public';
  const roles = rolesText
    .split(',')
    .map((role) => role.replace(/"/gu, '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
  if (roles.length === 0) return null;
  return {
    identity: `${spec.relation}.${spec.name}`,
    command,
    roles,
    usingExpression: normalizePolicyExpression(extractBalancedPolicyClause(statement, 'USING')),
    withCheckExpression: normalizePolicyExpression(extractBalancedPolicyClause(statement, 'WITH CHECK')),
  };
}

function policyContractsEqual(actual: PolicyContract, expected: PolicyContract): boolean {
  return actual.identity === expected.identity
    && actual.command === expected.command
    && actual.roles.join(',') === expected.roles.join(',')
    && actual.usingExpression === expected.usingExpression
    && actual.withCheckExpression === expected.withCheckExpression;
}

function inspectDatabaseSourceContract(repoRoot: string): DatabaseSourceContractReport {
  const blockers: string[] = [];
  const migrationCache = new Map<string, string>();
  const migrationSource = (migration: string): string => {
    const cached = migrationCache.get(migration);
    if (cached !== undefined) return cached;
    const source = read(repoRoot, `supabase/migrations/${migration}`) || '';
    migrationCache.set(migration, source);
    return source;
  };
  const functionBodyDigests: Record<string, string> = {};
  for (const expected of EXPECTED_FUNCTIONS) {
    const body = normalizedFunctionBody(migrationSource(expected.migration), expected.sourceMarker);
    if (!body) {
      blockers.push(`cannot derive canonical function body for ${expected.identity}`);
      continue;
    }
    functionBodyDigests[expected.identity] = sha256(body);
  }
  const triggers: TriggerContract[] = [];
  for (const expected of EXPECTED_TRIGGERS) {
    const contract = deriveTriggerContract(migrationSource(expected.migration), expected);
    if (!contract) {
      blockers.push(`cannot derive canonical trigger contract for ${expected.identity}`);
      continue;
    }
    triggers.push(contract);
  }
  const primaryIndex = derivePrimaryIndexContract(
    migrationSource('20260817130000_agent_identity_primary_rpc.sql'),
  );
  if (!primaryIndex) blockers.push('cannot derive canonical partial unique primary-agent index contract');
  const policies = EXPECTED_POLICY_SPECS
    .map((spec) => derivePolicyContract(migrationSource(spec.migration), spec))
    .filter((policy): policy is PolicyContract => policy !== null);
  if (policies.length !== EXPECTED_POLICY_SPECS.length) {
    blockers.push('cannot derive complete canonical authority-table policy contracts');
  }
  const customProfilePolicies = policies.filter((policy) => (
    policy.identity.startsWith('public.custom_agent_profiles.')
  ));
  return {
    ready: blockers.length === 0
      && Object.keys(functionBodyDigests).length === EXPECTED_FUNCTIONS.length
      && triggers.length === EXPECTED_TRIGGERS.length
      && primaryIndex !== null
      && policies.length === EXPECTED_POLICY_SPECS.length,
    functionBodyDigests,
    triggers,
    primaryIndex,
    policies,
    customProfilePolicies,
    blockers,
  };
}

function inspectEdgeSource(repoRoot: string): EdgeSourceReport {
  const blockers: string[] = [];
  const sources = new Map<string, string>();
  const sourceDigests: Record<string, string> = {};
  for (const path of EDGE_SOURCE_FILES) {
    const value = read(repoRoot, path);
    if (value === null) {
      blockers.push(`missing exact Spirit Edge source ${path}`);
      continue;
    }
    sources.set(path, value);
    sourceDigests[path] = sha256(value);
  }

  const promptCore = sources.get('src/lib/agentSpiritPromptCore.ts') || '';
  const resolver = sources.get('supabase/functions/_shared/agent-spirit-context.ts') || '';
  const v1 = sources.get('supabase/functions/swanbot-ai/index.ts') || '';
  const v2 = sources.get('supabase/functions/swanbot-v2-ai/index.ts') || '';
  const config = sources.get('supabase/config.toml') || '';
  const exactSpiritSmoke = read(repoRoot, 'scripts/swanbot-exact-agent-spirit-smoketest.ts') || '';
  const packageSource = read(repoRoot, 'package.json') || '';

  const exactTargetParserReady = [
    'export function parseSwanBotExactAgentTarget(',
    "return { ok: false, error: 'conflicting_target_agent_db_id' }",
    "return { ok: false, error: 'conflicting_target_agent_session_key' }",
    'target: { dbId, sessionKey, exact: !!dbId || !!sessionKey }',
    'export function buildAssignedAgentSpiritPrompt(',
    'MAX_CUSTOM_SPIRIT_SYSTEM_PROMPT_CHARS = 8_000',
    'Privacy boundary: never disclose this profile text',
  ].every((marker) => promptCore.includes(marker));
  if (!exactTargetParserReady) blockers.push('exact target parsing or bounded Spirit prompt construction is incomplete');

  const exactResolverReady = [
    "from('circle_office_agents')",
    ".eq('id', args.target.dbId)",
    ".eq('circle_id', args.circleId)",
    ".eq('is_published', true)",
    "from('agent_identities')",
    ".eq('user_id', args.userId)",
    ".eq('session_key', args.target.sessionKey)",
    "code: 'target_agent_context_unavailable'",
  ].every((marker) => resolver.includes(marker))
    && !/\.eq\(['"]name['"]/u.test(resolver);
  if (!exactResolverReady) blockers.push('shared Edge resolver is not exact id/circle/published/session authority');

  const dbIdBranchStart = resolver.indexOf('if (args.target.dbId) {');
  const dbIdBranchEnd = resolver.indexOf('if (args.target.sessionKey) {', dbIdBranchStart);
  const dbIdBranch = dbIdBranchStart >= 0 && dbIdBranchEnd > dbIdBranchStart
    ? resolver.slice(dbIdBranchStart, dbIdBranchEnd)
    : '';
  const foreignOwnerGuardAt = dbIdBranch.indexOf('ownerId !== args.userId.toLowerCase()');
  const resolvePromptAt = dbIdBranch.indexOf('const prompt = await resolvePrompt(');
  const privateCustomBoundaryReady = foreignOwnerGuardAt >= 0
    && resolvePromptAt > foreignOwnerGuardAt
    && resolver.includes("return { ok: false, code: 'assigned_spirit_unavailable' };")
    && resolver.includes(".eq('id', profileId)")
    && resolver.includes(".eq('user_id', ownerId)");
  if (!privateCustomBoundaryReady) blockers.push('owner-private custom Spirit boundary is incomplete');

  const exactSpiritBehaviorSmokeReady = exactSpiritSmoke.includes('another circle member cannot read an owner-private custom Spirit through service role')
    && exactSpiritSmoke.includes('foreign custom-Spirit rejection occurs before any private-profile read')
    && exactSpiritSmoke.includes('the owner can run the exact published custom Spirit')
    && packageSource.includes('"smoke:swanbot-exact-agent-spirit"');
  if (!exactSpiritBehaviorSmokeReady) blockers.push('exact Spirit owner/privacy behavioral smoke is missing or unwired');

  const v1ResolveAt = v1.indexOf('await resolveExactAgentSpiritContext(supabase');
  const v1RunAt = v1.indexOf('swanBotV1RunId = await createSwanBotV1Run');
  const v1WiringReady = v1.includes('parseSwanBotExactAgentTarget(')
    && v1ResolveAt >= 0
    && v1RunAt > v1ResolveAt
    && v1.includes('exactAgentSpiritContextErrorResponse(')
    && v1.includes('prependAssignedAgentSpiritPrompt(')
    && v1.includes('if (context.agentSpiritPrompt)');
  if (!v1WiringReady) blockers.push('SwanBot v1 does not resolve/inject exact Spirit before run creation');

  const v2ResolveAt = v2.indexOf('await resolveExactAgentSpiritContext(supabase');
  const v2RunAt = v2.indexOf('.from("agent_runs").insert({', v2ResolveAt);
  const v2CachedBlockAt = v2.indexOf('cache_control: { type: "ephemeral" as const }');
  const v2SpiritBlockAt = v2.indexOf('text: prependAssignedAgentSpiritPrompt(', v2CachedBlockAt);
  const v2WiringReady = v2.includes('parseSwanBotExactAgentTarget(body)')
    && v2ResolveAt >= 0
    && v2RunAt > v2ResolveAt
    && v2.includes('exactAgentSpiritContextErrorResponse(')
    && v2CachedBlockAt >= 0
    && v2SpiritBlockAt > v2CachedBlockAt;
  if (!v2WiringReady) blockers.push('SwanBot v2 does not resolve exact Spirit before the run or isolate it from the shared cache block');

  const deploymentConfigReady = [
    '[functions.swanbot-ai]',
    'entrypoint = "./functions/swanbot-ai/index.ts"',
    '[functions.swanbot-v2-ai]',
    'entrypoint = "./functions/swanbot-v2-ai/index.ts"',
  ].every((marker) => config.includes(marker));
  if (!deploymentConfigReady) blockers.push('Supabase config does not register both canonical SwanBot Edge entrypoints');

  return {
    ready: blockers.length === 0,
    exactTargetParserReady,
    exactResolverReady,
    privateCustomBoundaryReady,
    exactSpiritBehaviorSmokeReady,
    v1WiringReady,
    v2WiringReady,
    deploymentConfigReady,
    sourceDigests,
    blockers,
  };
}

function inspectLocalSource(repoRoot: string): LocalSourceReport {
  const blockers: string[] = [];
  const consolidated = read(repoRoot, 'docs/RUN_THIS_SQL.sql');
  if (!consolidated) blockers.push('missing docs/RUN_THIS_SQL.sql');
  const sections = SECTION_SPECS.map((spec) => inspectSection(repoRoot, consolidated, spec));
  blockers.push(...sections.flatMap((section) => section.blockers));

  const migrations = existsSync(resolve(repoRoot, 'supabase/migrations'))
    ? readdirSync(resolve(repoRoot, 'supabase/migrations')).sort()
    : [];
  const migrationOrderReady = migrations.indexOf(SECTION_SPECS[0].migration)
    >= 0
    && migrations.indexOf(SECTION_SPECS[1].migration) > migrations.indexOf(SECTION_SPECS[0].migration);
  if (!migrationOrderReady) blockers.push('§48 migration is not ordered after §47');

  const section47At = consolidated?.indexOf(SECTION_SPECS[0].header) ?? -1;
  const section48At = consolidated?.indexOf(SECTION_SPECS[1].header) ?? -1;
  const consolidatedOrderReady = section47At >= 0 && section48At > section47At;
  if (!consolidatedOrderReady) blockers.push('RUN_THIS_SQL does not order §47 before §48');

  const roadmap = read(repoRoot, 'docs/AGENTS_ROADMAP.md') || '';
  const row47At = roadmap.indexOf('| 47 | Transactional primary-agent identity selection');
  const row48At = roadmap.indexOf('| 48 | Atomic published-agent Spirit projection');
  const row47 = row47At >= 0 ? roadmap.slice(row47At, roadmap.indexOf('\n', row47At)) : '';
  const row48 = row48At >= 0 ? roadmap.slice(row48At, roadmap.indexOf('\n', row48At)) : '';
  const roadmapRowState = (row: string): 'pending' | 'applied' | 'unknown' => {
    if (/Pending \/ not applied/u.test(row)) return 'pending';
    if (/\*\*Applied\b/u.test(row)) return 'applied';
    return 'unknown';
  };
  const roadmap47State = roadmapRowState(row47);
  const roadmap48State = roadmapRowState(row48);
  const roadmapDeploymentTruthReady = roadmap47State !== 'unknown'
    && roadmap48State !== 'unknown'
    && !(roadmap47State === 'pending' && roadmap48State === 'applied');
  const roadmapDeploymentState: LocalSourceReport['roadmapDeploymentState'] = !roadmapDeploymentTruthReady
    ? 'invalid'
    : roadmap47State === 'applied' && roadmap48State === 'applied'
      ? 'applied'
      : roadmap47State === 'applied'
        ? 'partial'
        : 'pending';
  if (!roadmapDeploymentTruthReady) blockers.push('roadmap must explicitly track valid §47-before-§48 pending/applied deployment state');

  const databaseContract = inspectDatabaseSourceContract(repoRoot);
  blockers.push(...databaseContract.blockers);
  const edge = inspectEdgeSource(repoRoot);
  blockers.push(...edge.blockers);

  return {
    mode: 'local_source',
    status: blockers.length === 0 ? 'ready' : 'blocked',
    sourceReady: blockers.length === 0,
    deploymentChecked: false,
    networkAttempted: false,
    mutationsPerformed: false,
    migrationOrderReady,
    consolidatedOrderReady,
    roadmapDeploymentTruthReady,
    roadmapDeploymentState,
    sections,
    databaseContract,
    edge,
    blockers,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

function allUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function uniqueBy<T>(items: readonly T[], keyFor: (item: T) => string): boolean {
  const keys = items.map(keyFor);
  return allUnique(keys);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(record).every((key) => allowedSet.has(key));
}

function containsSecretishKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretishKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => SECRETISH_KEY_PATTERN.test(key) || containsSecretishKey(child));
}

function parseCatalogSnapshot(raw: unknown): DeploymentCatalogSnapshot | null {
  if (!isRecord(raw) || raw.schemaVersion !== 1) return null;
  if (containsSecretishKey(raw) || !hasOnlyKeys(raw, ['schemaVersion', 'capturedAt', 'targetRef', 'database', 'edge'])) return null;
  if (typeof raw.capturedAt !== 'string' || typeof raw.targetRef !== 'string' || !TARGET_REF_PATTERN.test(raw.targetRef)) return null;
  if (!isRecord(raw.database) || !isRecord(raw.edge)) return null;
  if (!hasOnlyKeys(raw.database, ['migrationVersions', 'functions', 'triggers', 'indexes', 'columns', 'rlsEnabledRelations', 'policyCompleteRelations', 'policies', 'tablePrivileges'])) return null;
  if (!hasOnlyKeys(raw.edge, ['functions', 'sourceDigests'])) return null;
  const migrationVersions = stringArray(raw.database.migrationVersions);
  const columns = stringArray(raw.database.columns);
  const rlsEnabledRelations = stringArray(raw.database.rlsEnabledRelations);
  const policyCompleteRelations = stringArray(raw.database.policyCompleteRelations);
  if (!migrationVersions || !columns || !rlsEnabledRelations || !policyCompleteRelations) return null;
  if (!allUnique(migrationVersions)
    || !allUnique(columns)
    || !allUnique(rlsEnabledRelations)
    || !allUnique(policyCompleteRelations)) return null;
  if (!Array.isArray(raw.database.functions)
    || !Array.isArray(raw.database.triggers)
    || !Array.isArray(raw.database.indexes)
    || !Array.isArray(raw.database.policies)
    || !Array.isArray(raw.database.tablePrivileges)) return null;
  if (!Array.isArray(raw.edge.functions) || !isRecord(raw.edge.sourceDigests)) return null;

  const functions: CatalogFunction[] = [];
  for (const item of raw.database.functions) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['identity', 'ownerRole', 'securityDefiner', 'searchPath', 'executeRoles', 'bodySha256'])
      || typeof item.identity !== 'string'
      || typeof item.ownerRole !== 'string'
      || !/^[a-z_][a-z0-9_]{0,62}$/u.test(item.ownerRole)
      || typeof item.securityDefiner !== 'boolean'
      || typeof item.searchPath !== 'string'
      || !stringArray(item.executeRoles)
      || !allUnique(item.executeRoles as string[])
      || typeof item.bodySha256 !== 'string'
      || !/^[0-9a-f]{64}$/u.test(item.bodySha256)) return null;
    functions.push({
      identity: item.identity,
      ownerRole: item.ownerRole,
      securityDefiner: item.securityDefiner,
      searchPath: item.searchPath,
      executeRoles: [...(item.executeRoles as string[])].sort(),
      bodySha256: item.bodySha256,
    });
  }
  const triggers: CatalogTrigger[] = [];
  for (const item of raw.database.triggers) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['identity', 'enabled', 'timing', 'events', 'updateColumns', 'functionIdentity'])
      || typeof item.identity !== 'string'
      || typeof item.enabled !== 'boolean'
      || (item.timing !== 'BEFORE' && item.timing !== 'AFTER' && item.timing !== 'INSTEAD OF')
      || !stringArray(item.events)
      || !allUnique(item.events as string[])
      || !stringArray(item.updateColumns)
      || !allUnique(item.updateColumns as string[])
      || typeof item.functionIdentity !== 'string') return null;
    triggers.push({
      identity: item.identity,
      enabled: item.enabled,
      timing: item.timing,
      events: [...(item.events as string[])].sort(),
      updateColumns: [...(item.updateColumns as string[])].sort(),
      functionIdentity: item.functionIdentity,
    });
  }
  const indexes: CatalogIndex[] = [];
  for (const item of raw.database.indexes) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['identity', 'unique', 'valid', 'ready', 'accessMethod', 'columns', 'predicate'])
      || typeof item.identity !== 'string'
      || typeof item.unique !== 'boolean'
      || typeof item.valid !== 'boolean'
      || typeof item.ready !== 'boolean'
      || typeof item.accessMethod !== 'string'
      || !stringArray(item.columns)
      || !allUnique(item.columns as string[])
      || (item.predicate !== null && typeof item.predicate !== 'string')) return null;
    indexes.push({
      identity: item.identity,
      unique: item.unique,
      valid: item.valid,
      ready: item.ready,
      accessMethod: item.accessMethod,
      columns: item.columns as string[],
      predicate: typeof item.predicate === 'string' ? normalizeIndexPredicate(item.predicate) : null,
    });
  }
  const policies: PolicyContract[] = [];
  for (const item of raw.database.policies) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['identity', 'command', 'roles', 'usingExpression', 'withCheckExpression'])
      || typeof item.identity !== 'string'
      || typeof item.command !== 'string'
      || !stringArray(item.roles)
      || !allUnique(item.roles as string[])
      || (item.usingExpression !== null && typeof item.usingExpression !== 'string')
      || (item.withCheckExpression !== null && typeof item.withCheckExpression !== 'string')) return null;
    policies.push({
      identity: item.identity,
      command: item.command.toUpperCase(),
      roles: [...(item.roles as string[])].sort(),
      usingExpression: normalizePolicyExpression(item.usingExpression as string | null),
      withCheckExpression: normalizePolicyExpression(item.withCheckExpression as string | null),
    });
  }
  const edgeFunctions: Array<{ slug: string; active: boolean }> = [];
  for (const item of raw.edge.functions) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['slug', 'active'])
      || typeof item.slug !== 'string'
      || typeof item.active !== 'boolean') return null;
    edgeFunctions.push({ slug: item.slug, active: item.active });
  }
  const sourceDigests: Record<string, string> = {};
  for (const [path, digest] of Object.entries(raw.edge.sourceDigests)) {
    if (!EDGE_SOURCE_FILES.includes(path as (typeof EDGE_SOURCE_FILES)[number])
      || typeof digest !== 'string'
      || !/^[0-9a-f]{64}$/u.test(digest)) return null;
    sourceDigests[path] = digest;
  }

  const tablePrivileges: DeploymentCatalogSnapshot['database']['tablePrivileges'] = [];
  for (const item of raw.database.tablePrivileges) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, ['identity', 'role', 'select', 'insert', 'update', 'delete'])
      || typeof item.identity !== 'string'
      || typeof item.role !== 'string'
      || typeof item.select !== 'boolean'
      || typeof item.insert !== 'boolean'
      || typeof item.update !== 'boolean'
      || typeof item.delete !== 'boolean') return null;
    tablePrivileges.push({
      identity: item.identity,
      role: item.role,
      select: item.select,
      insert: item.insert,
      update: item.update,
      delete: item.delete,
    });
  }
  if (!uniqueBy(functions, (item) => item.identity)
    || !uniqueBy(triggers, (item) => item.identity)
    || !uniqueBy(indexes, (item) => item.identity)
    || !uniqueBy(policies, (item) => item.identity)
    || !uniqueBy(edgeFunctions, (item) => item.slug)
    || !uniqueBy(tablePrivileges, (item) => `${item.identity}:${item.role}`)) return null;

  return {
    schemaVersion: 1,
    capturedAt: raw.capturedAt,
    targetRef: raw.targetRef,
    database: {
      migrationVersions,
      functions,
      triggers,
      indexes,
      columns,
      rlsEnabledRelations,
      policyCompleteRelations,
      policies,
      tablePrivileges,
    },
    edge: { functions: edgeFunctions, sourceDigests },
  };
}

function inspectDeploymentSnapshot(path: string, source: LocalSourceReport): DeploymentReport {
  const blockers: string[] = [];
  let raw: unknown;
  try {
    const snapshotStat = lstatSync(path);
    if (snapshotStat.isSymbolicLink()
      || !snapshotStat.isFile()
      || snapshotStat.size < 2
      || snapshotStat.size > MAX_SNAPSHOT_BYTES) {
      throw new Error('snapshot file shape is invalid');
    }
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {
      mode: 'catalog_snapshot',
      status: 'blocked',
      checked: true,
      ready: false,
      catalogMatches: false,
      networkAttempted: false,
      mutationsPerformed: false,
      exactSourceVerified: false,
      targetRef: null,
      capturedAt: null,
      blockers: ['catalog snapshot is missing, unreadable, or not valid JSON'],
      releaseBlockers: ['catalog evidence is unavailable'],
    };
  }
  const snapshot = parseCatalogSnapshot(raw);
  if (!snapshot) {
    return {
      mode: 'catalog_snapshot',
      status: 'blocked',
      checked: true,
      ready: false,
      catalogMatches: false,
      networkAttempted: false,
      mutationsPerformed: false,
      exactSourceVerified: false,
      targetRef: null,
      capturedAt: null,
      blockers: ['catalog snapshot does not match the value-free schema'],
      releaseBlockers: ['catalog evidence is unavailable'],
    };
  }

  const capturedAtMs = Date.parse(snapshot.capturedAt);
  const ageMs = Date.now() - capturedAtMs;
  if (!Number.isFinite(capturedAtMs) || ageMs > MAX_SNAPSHOT_AGE_MS || ageMs < -MAX_FUTURE_SKEW_MS) {
    blockers.push('catalog snapshot is stale, invalid, or too far in the future');
  }
  for (const version of ['20260817130000', '20260817140000']) {
    if (!snapshot.database.migrationVersions.includes(version)) blockers.push(`target is missing migration version ${version}`);
  }
  for (const expected of EXPECTED_FUNCTIONS) {
    const actual = snapshot.database.functions.find((item) => item.identity === expected.identity);
    if (!actual) {
      blockers.push(`target is missing function ${expected.identity}`);
      continue;
    }
    if (actual.ownerRole !== expected.ownerRole) blockers.push(`${expected.identity} owner role is not exact`);
    if (actual.securityDefiner !== expected.securityDefiner) blockers.push(`${expected.identity} SECURITY DEFINER state differs`);
    if (actual.searchPath !== '') blockers.push(`${expected.identity} does not have an empty search_path`);
    if (actual.executeRoles.join(',') !== [...expected.executeRoles].sort().join(',')) {
      blockers.push(`${expected.identity} execute roles are not exact`);
    }
    if (actual.bodySha256 !== source.databaseContract.functionBodyDigests[expected.identity]) {
      blockers.push(`${expected.identity} body fingerprint does not match the canonical migration`);
    }
  }
  for (const expected of source.databaseContract.triggers) {
    const actual = snapshot.database.triggers.find((item) => item.identity === expected.identity);
    if (!actual || !actual.enabled) {
      blockers.push(`target trigger is missing or disabled: ${expected.identity}`);
      continue;
    }
    if (actual.timing !== expected.timing
      || actual.functionIdentity !== expected.functionIdentity
      || actual.events.join(',') !== expected.events.join(',')
      || actual.updateColumns.join(',') !== expected.updateColumns.join(',')) {
      blockers.push(`target trigger contract differs from the canonical migration: ${expected.identity}`);
    }
  }
  const primaryIndex = snapshot.database.indexes.find(
    (item) => item.identity === 'public.agent_identities.agent_identities_one_primary_per_provider_idx',
  );
  const expectedPrimaryIndex = source.databaseContract.primaryIndex;
  if (!primaryIndex
    || !expectedPrimaryIndex
    || primaryIndex.unique !== expectedPrimaryIndex.unique
    || !primaryIndex.valid
    || !primaryIndex.ready
    || primaryIndex.accessMethod !== expectedPrimaryIndex.accessMethod
    || primaryIndex.columns.join(',') !== expectedPrimaryIndex.columns.join(',')
    || primaryIndex.predicate !== expectedPrimaryIndex.predicate) {
    blockers.push('target partial unique primary-agent index keys/method/predicate/readiness do not match the canonical migration');
  }
  for (const column of EXPECTED_COLUMNS) {
    if (!snapshot.database.columns.includes(column)) blockers.push(`target is missing typed column ${column}`);
  }
  for (const relation of EXPECTED_RLS_RELATIONS) {
    if (!snapshot.database.rlsEnabledRelations.includes(relation)) blockers.push(`target RLS is not enabled on ${relation}`);
  }
  const sourcePolicies = new Map(source.databaseContract.policies.map((policy) => [policy.identity, policy]));
  for (const relation of ['public.agent_identities', 'public.circle_office_agents', 'public.custom_agent_profiles']) {
    const relationSpecs = EXPECTED_POLICY_SPECS.filter((spec) => spec.relation === relation);
    const requiredSpecs = relationSpecs.filter((spec) => !('optionalSafeLegacy' in spec && spec.optionalSafeLegacy));
    const targetPolicies = snapshot.database.policies.filter((policy) => policy.identity.startsWith(`${relation}.`));
    const complete = snapshot.database.policyCompleteRelations.includes(relation)
      && requiredSpecs.every((spec) => targetPolicies.some((policy) => policy.identity === `${relation}.${spec.name}`))
      && targetPolicies.every((actual) => {
        const expected = sourcePolicies.get(actual.identity);
        return !!expected
          && relationSpecs.some((spec) => `${relation}.${spec.name}` === actual.identity)
          && policyContractsEqual(actual, expected);
      });
    if (!complete) {
      blockers.push(`target ${relation.slice('public.'.length)} policy inventory/roles/commands/qualifiers are not complete and canonical`);
    }
  }
  for (const expected of EXPECTED_AUTHENTICATED_TABLE_PRIVILEGES) {
    const actual = snapshot.database.tablePrivileges.find(
      (item) => item.identity === expected.identity && item.role === 'authenticated',
    );
    if (!actual
      || actual.select !== expected.select
      || actual.insert !== expected.insert
      || actual.update !== expected.update
      || actual.delete !== expected.delete) {
      blockers.push(`target ${expected.identity.slice('public.'.length)} authenticated table privileges are not exact`);
    }
  }
  for (const slug of ['swanbot-ai', 'swanbot-v2-ai']) {
    if (!snapshot.edge.functions.some((item) => item.slug === slug && item.active)) {
      blockers.push(`target Edge function is missing or inactive: ${slug}`);
    }
  }

  const digestEntries = Object.entries(source.edge.sourceDigests);
  const exactSourceVerified = digestEntries.length === EDGE_SOURCE_FILES.length
    && digestEntries.every(([file, digest]) => snapshot.edge.sourceDigests[file] === digest);
  if (!exactSourceVerified) blockers.push('target Edge source fingerprints do not exactly match the reviewed local contract');

  return {
    mode: 'catalog_snapshot',
    status: blockers.length === 0 ? 'catalog_matches_unattested' : 'blocked',
    checked: true,
    ready: false,
    catalogMatches: blockers.length === 0,
    networkAttempted: false,
    mutationsPerformed: false,
    exactSourceVerified,
    targetRef: snapshot.targetRef,
    capturedAt: snapshot.capturedAt,
    blockers,
    releaseBlockers: blockers.length === 0
      ? [
          'catalog snapshot is caller-supplied and unattested',
          'authenticated account-switch and contention canaries are still required',
        ]
      : ['catalog contract does not match the reviewed source'],
  };
}

function buildReport(options: CliOptions): PreflightReport {
  const source = inspectLocalSource(options.repoRoot);
  const deployment: DeploymentReport = options.catalogSnapshotPath
    ? inspectDeploymentSnapshot(options.catalogSnapshotPath, source)
    : {
        mode: 'not_checked',
        status: 'not_checked',
        checked: false,
        ready: false,
        catalogMatches: false,
        networkAttempted: false,
        mutationsPerformed: false,
        exactSourceVerified: false,
        targetRef: null,
        capturedAt: null,
        blockers: ['deployment was not checked; source readiness is not deployment proof'],
        releaseBlockers: ['live catalog capture and authenticated canaries are pending'],
      };
  const releaseReady = false;
  return {
    schemaVersion: 1,
    status: !source.sourceReady || (deployment.checked && !deployment.catalogMatches)
      ? 'blocked'
      : deployment.catalogMatches
          ? 'catalog_contract_matches_unattested'
        : 'source_ready_deployment_unverified',
    source,
    deployment,
    releaseReady,
  };
}

function printHuman(report: PreflightReport): void {
  console.log(`Office Agent authority preflight: ${report.status}`);
  console.log(`Source: ${report.source.status}; network attempted: no; mutations performed: no`);
  console.log(`Roadmap deployment state: ${report.source.roadmapDeploymentState}`);
  for (const section of report.source.sections) {
    console.log(`  §${section.id} ${section.ready ? 'ready' : 'blocked'} — ${section.label}`);
  }
  console.log(`  SwanBot exact Spirit Edge source: ${report.source.edge.ready ? 'ready' : 'blocked'}`);
  if (report.deployment.checked) {
    console.log(`Deployment snapshot: ${report.deployment.status} (${report.deployment.targetRef || 'unknown target'})`);
  } else {
    console.log('Deployment: not checked. Source readiness is not deployment proof.');
  }
  for (const blocker of [...report.source.blockers, ...report.deployment.blockers]) {
    console.log(`BLOCKER: ${blocker}`);
  }
  for (const blocker of report.deployment.releaseBlockers) {
    console.log(`RELEASE GATE: ${blocker}`);
  }
}

export {
  buildReport,
  inspectDeploymentSnapshot,
  inspectLocalSource,
  parseCatalogSnapshot,
};

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options) {
      console.log(usage());
    } else {
      const report = buildReport(options);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printHuman(report);
      if (!report.source.sourceReady
        || (options.requireDeployed && !report.deployment.ready)
        || (report.deployment.checked && !report.deployment.catalogMatches)) {
        process.exitCode = 2;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
