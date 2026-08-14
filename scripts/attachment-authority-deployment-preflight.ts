/**
 * Deployment preflight for the attachment/approval authority SQL chain
 * through the OpenSwan Chat approval-resume authority in canonical §44.
 *
 * The default mode is intentionally local-only: it reads repository files,
 * never loads env files, never opens a socket, and never applies SQL.
 *
 * Optional live modes are also read-only and require two independent gates:
 * an explicit CLI switch plus the matching RUN_LIVE_* environment variable.
 * See --help for the complete operator contract.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

type SectionId = 28 | 38 | 39 | 40 | 41 | 44;

interface CliOptions {
  repoRoot: string;
  json: boolean;
  liveCatalog: boolean;
  liveCanary: boolean;
  localBridgeHealth: boolean;
}

interface SectionSpec {
  id: SectionId;
  label: string;
  migration: string;
  uniqueSuffix: string;
  consolidatedHeader: string;
  consolidatedSourceMarker?: string;
  consolidatedFooter?: string;
  contentMarkers: string[];
  readinessProvider: 38 | 39 | 40 | 41 | 44;
  readinessMarker: string;
  readinessAliases: string[];
}

interface SectionSource {
  spec: SectionSpec;
  source: string | null;
  readinessQuery: string | null;
  tailGrammarReady: boolean;
}

interface LocalSectionReport {
  id: SectionId;
  label: string;
  migration: string;
  sourcePresent: boolean;
  uniqueCanonicalMigration: boolean;
  dependencyOrderReady: boolean;
  consolidatedOrderReady: boolean;
  consolidatedPrefixReady: boolean;
  consolidatedTailReady: boolean;
  consolidatedParityReady: boolean;
  tailGrammarReady: boolean;
  requiredContentReady: boolean;
  readinessQueryAvailable: boolean;
  readinessProviderSection: number;
  ready: boolean;
  blockers: string[];
}

interface LocalSourceReport {
  mode: 'local_source';
  ready: boolean;
  canonicalConsolidatedSqlReady: boolean;
  automatedMigrationPushReady: boolean;
  networkAttempted: false;
  mutationsPerformed: false;
  migrationVersionInventory: Array<{
    version: string;
    files: string[];
  }>;
  duplicateMigrationVersions: Array<{
    version: string;
    files: string[];
  }>;
  sections: LocalSectionReport[];
  blockers: string[];
}

interface LiveCheck {
  id: string;
  ok: boolean;
  detail: string;
}

interface LiveReport {
  mode: 'live_catalog' | 'authenticated_read_canary';
  status: 'not_run' | 'pass' | 'fail';
  attempted: boolean;
  networkAttempted: boolean;
  mutationsPerformed: false;
  projectIdentityVerified: boolean;
  checks: LiveCheck[];
  blocker?: string;
}

interface LocalBridgeReport {
  mode: 'local_bridge_health';
  status: 'not_run' | 'pass' | 'watch' | 'fail';
  attempted: boolean;
  networkAttempted: boolean;
  mutationsPerformed: false;
  loopbackOnly: true;
  opaqueAttachmentCapability: boolean | null;
  classification?: LocalBridgeClassification;
  sourceChanged?: boolean | null;
  safeToRefresh?: boolean | null;
  blocker?: string;
}

export type LocalBridgeClassification =
  | 'current'
  | 'source_changed'
  | 'capability_missing'
  | 'source_changed_capability_missing'
  | 'restart_blocked'
  | 'idle_safe_restart';

interface LocalBridgeHealthClassification {
  classification: LocalBridgeClassification;
  capabilityReady: boolean;
  sourceChanged: boolean | null;
  safeToRefresh: boolean | null;
  blocker?: string;
}

interface ProjectIdentity {
  origin: string;
  projectRef: string;
}

interface CatalogConfig extends ProjectIdentity {
  databaseUrl: URL;
  psqlPath: string;
  sslRootCert: string;
}

interface CanaryConfig extends ProjectIdentity {
  anonKey: string;
  userAToken: string;
  userBToken: string;
  userAId: string;
  userBId: string;
  circleId: string;
  artifactId: string;
  privateAttachmentId: string;
  devicePrivateApprovalId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/u;

const SECTION_SPECS: SectionSpec[] = [
  {
    id: 28,
    label: 'Database approval state-machine authority',
    migration: '20260726_database_authority_guards.sql',
    uniqueSuffix: '_database_authority_guards.sql',
    consolidatedHeader: '-- §28. Database authority guards (2026-07-26)',
    contentMarkers: [
      'CREATE OR REPLACE FUNCTION public.is_valid_tool_v2_approval_payload(',
      'CREATE OR REPLACE FUNCTION public.guard_tool_v2_run_approval()',
      'CREATE TRIGGER trg_guard_tool_v2_run_approval_update',
    ],
    // §28 predates per-section readiness rows. §41 is the canonical
    // dependency/catalog probe for the exact §28 function and trigger it uses.
    readinessProvider: 41,
    readinessMarker: '-- §41 readiness',
    readinessAliases: ['device_private_approval_state_machine_ready'],
  },
  {
    id: 38,
    label: 'Agent-run artifact integrity',
    migration: '20260812_agent_run_artifact_integrity.sql',
    uniqueSuffix: '_agent_run_artifact_integrity.sql',
    consolidatedHeader: '-- §38. Agent-run artifact integrity (2026-08-12)',
    contentMarkers: [
      'CREATE POLICY agent_runs_owner_insert_guard_v1',
      'CREATE TRIGGER trg_guard_authenticated_agent_run_identity_v1',
      'CREATE POLICY agent_run_artifacts_insert_run_owner',
    ],
    readinessProvider: 38,
    readinessMarker: '-- Catalog readiness only.',
    readinessAliases: [
      'agent_run_artifacts_ready',
      'agent_run_identity_guard_ready',
      'agent_run_owner_policies_ready',
      'artifact_policies_converged',
      'authenticated_artifact_grants_ready',
    ],
  },
  {
    id: 39,
    label: 'Message-attachment link integrity',
    migration: '20260813160000_message_attachment_link_integrity.sql',
    uniqueSuffix: '_message_attachment_link_integrity.sql',
    consolidatedHeader: '-- §39. Message-attachment link integrity (2026-08-13)',
    contentMarkers: [
      'CREATE OR REPLACE FUNCTION public.message_attachment_link_target_is_valid_v1(',
      'CREATE OR REPLACE FUNCTION public.guard_authenticated_message_attachment_update_v1()',
      'CREATE TRIGGER trg_guard_authenticated_message_attachment_update_v1',
    ],
    readinessProvider: 39,
    readinessMarker: '-- §39 readiness',
    readinessAliases: [
      'message_attachments_ready',
      'attachment_link_validator_ready',
      'attachment_update_guard_ready',
      'attachment_insert_policy_converged',
      'attachment_update_policy_converged',
      'stored_attachment_links_valid',
      'authenticated_attachment_write_grants_ready',
    ],
  },
  {
    id: 40,
    label: 'Attachment visibility and private Storage integrity',
    migration: '20260813170000_message_attachment_visibility_integrity.sql',
    uniqueSuffix: '_message_attachment_visibility_integrity.sql',
    consolidatedHeader: '-- §40. Message-attachment visibility and Storage integrity (2026-08-13)',
    contentMarkers: [
      'message_attachment_visibility_integrity: apply SQL section 39 and canonical message-thread RLS first',
      'CREATE OR REPLACE FUNCTION public.message_attachment_row_visible_v1(',
      'CREATE POLICY chat_attachments_anon_select_deny_v1',
    ],
    readinessProvider: 40,
    readinessMarker: '-- §40 readiness',
    readinessAliases: [
      'attachment_bucket_private_ready',
      'attachment_link_integrity_compatible',
      'attachment_storage_path_identity_ready',
      'attachment_visibility_helpers_ready',
      'attachment_table_policies_converged',
      'attachment_storage_policies_converged',
      'attachment_table_grants_ready',
    ],
  },
  {
    id: 41,
    label: 'Device-private run-approval authority',
    migration: '20260813180000_device_private_run_approval_authority.sql',
    uniqueSuffix: '_device_private_run_approval_authority.sql',
    consolidatedHeader: '-- §41. Device-private run-approval privacy and authority (2026-08-13)',
    contentMarkers: [
      'device_private_run_approval_authority: apply SQL section 28 first',
      'CREATE POLICY agent_run_approvals_device_private_select_guard_v1',
      'CREATE POLICY agent_run_approvals_device_private_update_guard_v1',
    ],
    readinessProvider: 41,
    readinessMarker: '-- §41 readiness',
    readinessAliases: [
      'device_private_approval_select_guard_ready',
      'device_private_approval_update_guard_ready',
      'device_private_approval_state_machine_ready',
    ],
  },
  {
    id: 44,
    label: 'OpenSwan Chat approval-resume authority',
    migration: '20260813210000_openswan_chat_approval_resume_authority.sql',
    uniqueSuffix: '_openswan_chat_approval_resume_authority.sql',
    consolidatedHeader: '-- BEGIN SECTION 44: OpenSwan Chat approval-resume authority',
    consolidatedSourceMarker: '-- Source: supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql',
    consolidatedFooter: '-- END SECTION 44: OpenSwan Chat approval-resume authority',
    contentMarkers: [
      'openswan_chat_approval_resume_authority: apply SQL section 28 first',
      'openswan_chat_approval_resume_authority: apply SQL section 31 first',
      'CREATE TRIGGER trg_guard_agent_run_chat_lineage_v1',
      'CREATE POLICY agent_run_approvals_chat_ask_requester_update_v1',
      'CREATE FUNCTION public.can_consume_openswan_chat_approval_resume_v1(',
      'CREATE FUNCTION public.consume_openswan_chat_approval_resume_v1(',
    ],
    readinessProvider: 44,
    readinessMarker: '-- Catalog readiness only.',
    readinessAliases: [
      'openswan_chat_run_lineage_columns_ready',
      'openswan_chat_run_lineage_constraints_ready',
      'openswan_chat_run_lineage_exact_fks_ready',
      'openswan_chat_run_lineage_trigger_ready',
      'openswan_chat_run_lineage_owner_policies_ready',
      'openswan_chat_approval_requester_policy_ready',
      'openswan_chat_approval_resume_preflight_rpc_ready',
      'openswan_chat_approval_resume_rpc_ready',
    ],
  },
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repoRoot: resolve(__dirname, '..'),
    json: false,
    liveCatalog: false,
    liveCanary: false,
    localBridgeHealth: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--live-catalog') {
      options.liveCatalog = true;
      continue;
    }
    if (arg === '--live-canary') {
      options.liveCanary = true;
      continue;
    }
    if (arg === '--local-bridge-health') {
      options.localBridgeHealth = true;
      continue;
    }
    if (arg === '--repo') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --repo.');
      options.repoRoot = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log([
    'Usage: npx tsx scripts/attachment-authority-deployment-preflight.ts [options]',
    '',
    'Default: local source readiness only. No env files, sockets, database calls,',
    'Storage calls, migrations, or writes are used.',
    'The canonical local chain is §§28, 38-41, and 44 in dependency order.',
    '',
    'Options:',
    '  --json           Print machine-readable output.',
    '  --repo <path>    Override the repository root.',
    '  --live-catalog   Execute canonical readiness SELECTs in one READ ONLY transaction.',
    '  --live-canary    Run exact two-user read/visibility canaries. No mutation is sent.',
    '  --local-bridge-health',
    '                   GET fixed loopback /desktop/health and require the opaque capability.',
    '',
    'Live catalog gates (all required):',
    '  RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG=1',
    '  UC_ATTACHMENT_AUTHORITY_PROJECT_REF=<exact 20-character project ref>',
    '  UC_ATTACHMENT_AUTHORITY_SUPABASE_URL=https://<project-ref>.supabase.co',
    '  UC_ATTACHMENT_AUTHORITY_DATABASE_URL=<matching direct/pooler PostgreSQL URL>',
    '  UC_ATTACHMENT_AUTHORITY_PSQL_PATH=<absolute trusted non-symlink psql binary>',
    '  UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT=<absolute trusted CA bundle path>',
    '',
    'Authenticated read-canary gates (all required):',
    '  RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY=1',
    '  UC_ATTACHMENT_AUTHORITY_PROJECT_REF',
    '  UC_ATTACHMENT_AUTHORITY_SUPABASE_URL',
    '  UC_ATTACHMENT_AUTHORITY_ANON_KEY',
    '  UC_ATTACHMENT_AUTHORITY_USER_A_ACCESS_TOKEN',
    '  UC_ATTACHMENT_AUTHORITY_USER_B_ACCESS_TOKEN',
    '  UC_ATTACHMENT_AUTHORITY_CIRCLE_ID',
    '  UC_ATTACHMENT_AUTHORITY_ARTIFACT_ID',
    '  UC_ATTACHMENT_AUTHORITY_PRIVATE_ATTACHMENT_ID',
    '  UC_ATTACHMENT_AUTHORITY_DEVICE_PRIVATE_APPROVAL_ID',
    '',
    'Fixture contract: users A/B are distinct current members of the exact configured',
    'circle; the artifact, staged attachment, approval, and approval parent run all belong',
    'to that circle. The attachment is owned by A; the canonical schema-v2',
    'desktop.open_attachment approval and its parent run are owned by A. Fixture values',
    'are never printed.',
    '',
    'This command has no apply mode. Run the documented SQL separately after review.',
    'Duplicate legacy migration versions block automated push without invalidating',
    'the canonical consolidated SQL; use the reviewed RUN_THIS_SQL.sql workflow.',
    '',
    'Exit codes (highest applicable precedence):',
    '  1  Configuration or preflight runtime error.',
    '  2  Canonical local SQL source is blocked.',
    '  3  A requested bridge, catalog, or authenticated canary probe failed.',
    '  4  Bridge capability is watch-blocked; no requested probe failed.',
    '  5  Local SQL is ready but duplicate migration versions block automated push.',
    '  0  Selected checks passed and automated migration push is unblocked.',
  ].join('\n'));
}

function countOccurrences(source: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const index = source.indexOf(needle, cursor);
    if (index < 0) break;
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

function normalizeExecutableSql(source: string): string {
  return source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*--/u.test(line))
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{2,}/gu, '\n')
    .trim();
}

function extractReadinessTail(
  source: string,
  marker: string,
): { query: string | null; tailGrammarReady: boolean } {
  if (countOccurrences(source, marker) !== 1) {
    return { query: null, tailGrammarReady: false };
  }
  const markerIndex = source.indexOf(marker);
  const markerLineEnd = source.indexOf('\n', markerIndex);
  if (markerLineEnd < 0) return { query: null, tailGrammarReady: false };
  const selectIndex = source.indexOf('SELECT\n', markerIndex);
  if (selectIndex < 0) return { query: null, tailGrammarReady: false };
  const betweenMarkerAndSelect = source.slice(markerLineEnd + 1, selectIndex);
  if (normalizeExecutableSql(betweenMarkerAndSelect)) {
    return { query: null, tailGrammarReady: false };
  }
  const endIndex = source.indexOf(';', selectIndex);
  if (endIndex < 0) return { query: null, tailGrammarReady: false };
  const query = source.slice(selectIndex, endIndex + 1);
  const trailingSource = source.slice(endIndex + 1);
  return {
    query,
    tailGrammarReady: !normalizeExecutableSql(trailingSource),
  };
}

function sectionTailGrammarReady(spec: SectionSpec, source: string): {
  readinessQuery: string | null;
  tailGrammarReady: boolean;
} {
  const notify = "NOTIFY pgrst, 'reload schema';";
  if (spec.id === 28) {
    const executable = normalizeExecutableSql(source);
    return {
      readinessQuery: null,
      tailGrammarReady: countOccurrences(source, notify) === 1
        && executable.endsWith(notify),
    };
  }
  const tail = extractReadinessTail(source, spec.readinessMarker);
  const notifyIndex = source.indexOf(notify);
  const markerIndex = source.indexOf(spec.readinessMarker);
  const preReadinessTail = notifyIndex >= 0 && markerIndex > notifyIndex
    ? source.slice(notifyIndex + notify.length, markerIndex)
    : source;
  return {
    readinessQuery: tail.query,
    tailGrammarReady: tail.tailGrammarReady
      && countOccurrences(source, notify) === 1
      && markerIndex > notifyIndex
      && !normalizeExecutableSql(preReadinessTail),
  };
}

function extractConsolidatedSection(
  consolidated: string,
  spec: SectionSpec,
): string | null {
  if (countOccurrences(consolidated, spec.consolidatedHeader) !== 1) return null;
  const startIndex = consolidated.indexOf(spec.consolidatedHeader);
  // Consolidated SQL predates one uniform section-header grammar. Preserve the
  // numbered § form while also bounding sections before the established
  // `BEGIN SECTION N:` / `SECTION N:` forms used by later migrations.
  const nextHeaderPattern = /^-- (?:§\d+\.|(?:BEGIN )?SECTION \d+:)/gmu;
  nextHeaderPattern.lastIndex = startIndex + spec.consolidatedHeader.length;
  const nextHeader = nextHeaderPattern.exec(consolidated);
  return consolidated.slice(startIndex, nextHeader?.index ?? consolidated.length);
}

function containsOneExactCanonicalSource(
  consolidatedSection: string,
  source: string,
  spec: SectionSpec,
): boolean {
  if (spec.consolidatedSourceMarker && spec.consolidatedFooter) {
    const exactPrefix = `${spec.consolidatedHeader}\n${spec.consolidatedSourceMarker}\n`;
    if (!consolidatedSection.startsWith(exactPrefix)) return false;
    if (countOccurrences(consolidatedSection, spec.consolidatedFooter) !== 1) return false;
    const footerIndex = consolidatedSection.indexOf(spec.consolidatedFooter, exactPrefix.length);
    if (footerIndex < 0) return false;
    const canonicalBody = consolidatedSection.slice(exactPrefix.length, footerIndex);
    if (canonicalBody !== source) return false;
    return !normalizeExecutableSql(
      consolidatedSection.slice(footerIndex + spec.consolidatedFooter.length),
    );
  }
  const canonicalStart = spec.id === 28 ? 0 : source.indexOf('BEGIN;');
  if (canonicalStart < 0) return false;
  const sourcePrefix = source.slice(0, canonicalStart);
  if (normalizeExecutableSql(sourcePrefix)) return false;
  const canonicalSource = source.slice(canonicalStart).trim();
  if (!canonicalSource || countOccurrences(consolidatedSection, canonicalSource) !== 1) return false;
  const sourceIndex = consolidatedSection.indexOf(canonicalSource);
  const surroundingSource = [
    consolidatedSection.slice(0, sourceIndex),
    consolidatedSection.slice(sourceIndex + canonicalSource.length),
  ].join('\n');
  return surroundingSource
    .split(/\r?\n/u)
    .every((line) => !line.trim() || /^\s*--/u.test(line));
}

function loadSectionSources(repoRoot: string): Map<SectionId, SectionSource> {
  const sources = new Map<SectionId, SectionSource>();
  for (const spec of SECTION_SPECS) {
    const path = resolve(repoRoot, 'supabase', 'migrations', spec.migration);
    const source = existsSync(path) ? readFileSync(path, 'utf8') : null;
    const tail = source
      ? sectionTailGrammarReady(spec, source)
      : { readinessQuery: null, tailGrammarReady: false };
    sources.set(spec.id, {
      spec,
      source,
      readinessQuery: tail.readinessQuery,
      tailGrammarReady: tail.tailGrammarReady,
    });
  }
  return sources;
}

function buildLocalSourceReport(repoRoot: string): {
  report: LocalSourceReport;
  sources: Map<SectionId, SectionSource>;
} {
  const migrationDirectory = resolve(repoRoot, 'supabase', 'migrations');
  const consolidatedPath = resolve(repoRoot, 'docs', 'RUN_THIS_SQL.sql');
  if (!existsSync(migrationDirectory)) throw new Error('Migration directory is unavailable.');
  if (!existsSync(consolidatedPath)) throw new Error('docs/RUN_THIS_SQL.sql is unavailable.');

  const migrationNames = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const migrationFilesByVersion = new Map<string, string[]>();
  for (const name of migrationNames) {
    const separator = name.indexOf('_');
    const version = separator > 0 ? name.slice(0, separator) : name.replace(/\.sql$/u, '');
    const files = migrationFilesByVersion.get(version) || [];
    files.push(name);
    migrationFilesByVersion.set(version, files);
  }
  const migrationVersionInventory = Array.from(migrationFilesByVersion.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([version, files]) => ({ version, files: [...files].sort() }));
  const duplicateMigrationVersions = migrationVersionInventory
    .filter((entry) => entry.files.length > 1);
  const consolidated = readFileSync(consolidatedPath, 'utf8');
  const sources = loadSectionSources(repoRoot);
  const orderedMigrationIndexes = SECTION_SPECS.map((spec) => migrationNames.indexOf(spec.migration));
  const dependencyOrderReady = orderedMigrationIndexes.every((value, index) => (
    value >= 0 && (index === 0 || orderedMigrationIndexes[index - 1] < value)
  ));
  const consolidatedIndexes = SECTION_SPECS.map((spec) => consolidated.indexOf(spec.consolidatedHeader));
  const consolidatedOrderReady = consolidatedIndexes.every((value, index) => (
    value >= 0 && (index === 0 || consolidatedIndexes[index - 1] < value)
  )) && SECTION_SPECS.every((spec) => countOccurrences(consolidated, spec.consolidatedHeader) === 1);

  const sections: LocalSectionReport[] = SECTION_SPECS.map((spec) => {
    const blockers: string[] = [];
    const sectionSource = sources.get(spec.id);
    const source = sectionSource?.source || null;
    const sourcePresent = source !== null;
    const uniqueCanonicalMigration = migrationNames.filter(
      (name) => name.endsWith(spec.uniqueSuffix),
    ).length === 1 && migrationNames.includes(spec.migration);
    const consolidatedSection = extractConsolidatedSection(consolidated, spec);
    const consolidatedPrefixReady = countOccurrences(consolidated, spec.consolidatedHeader) === 1
      && Boolean(consolidatedSection)
      && (!spec.consolidatedSourceMarker || (
        countOccurrences(consolidated, spec.consolidatedSourceMarker) === 1
        && consolidatedSection?.startsWith(
          `${spec.consolidatedHeader}\n${spec.consolidatedSourceMarker}\n`,
        ) === true
      ));
    const consolidatedTailReady = !spec.consolidatedFooter || Boolean(
      consolidatedSection
      && countOccurrences(consolidated, spec.consolidatedFooter) === 1
      && countOccurrences(consolidatedSection, spec.consolidatedFooter) === 1
      && !normalizeExecutableSql(
        consolidatedSection.slice(
          consolidatedSection.indexOf(spec.consolidatedFooter) + spec.consolidatedFooter.length,
        ),
      )
    );
    const consolidatedParityReady = Boolean(
      source
      && consolidatedSection
      && consolidatedPrefixReady
      && consolidatedTailReady
      && containsOneExactCanonicalSource(consolidatedSection, source, spec),
    );
    const tailGrammarReady = sectionSource?.tailGrammarReady === true;
    const requiredContentReady = Boolean(
      source && spec.contentMarkers.every((marker) => source.includes(marker)),
    );
    const readinessSource = sources.get(spec.readinessProvider);
    const readinessQuery = spec.id === spec.readinessProvider
      ? sectionSource?.readinessQuery || null
      : readinessSource?.readinessQuery || null;
    const readinessQueryAvailable = Boolean(
      readinessQuery
      && readinessQuery.trimStart().startsWith('SELECT')
      && spec.readinessAliases.every((alias) => readinessQuery.includes(`AS ${alias}`))
      && countOccurrences(consolidated, readinessQuery) === 1
    );

    if (!sourcePresent) blockers.push('canonical migration is missing');
    if (!uniqueCanonicalMigration) blockers.push('canonical migration suffix is missing or duplicated');
    if (!dependencyOrderReady) blockers.push('migration dependency order is not canonical');
    if (!consolidatedOrderReady) blockers.push('consolidated section order is not canonical');
    if (!consolidatedPrefixReady) blockers.push('consolidated section prefix marker is missing or ambiguous');
    if (!consolidatedTailReady) blockers.push('consolidated section tail marker is missing, ambiguous, or followed by executable SQL');
    if (!consolidatedParityReady) blockers.push('consolidated SQL section is not one exact executable source copy');
    if (!tailGrammarReady) blockers.push('canonical migration tail contains missing, ambiguous, or extra executable SQL');
    if (!requiredContentReady) blockers.push('required authority markers are incomplete');
    if (!readinessQueryAvailable) blockers.push('canonical readiness SELECT is unavailable or incomplete');

    return {
      id: spec.id,
      label: spec.label,
      migration: spec.migration,
      sourcePresent,
      uniqueCanonicalMigration,
      dependencyOrderReady,
      consolidatedOrderReady,
      consolidatedPrefixReady,
      consolidatedTailReady,
      consolidatedParityReady,
      tailGrammarReady,
      requiredContentReady,
      readinessQueryAvailable,
      readinessProviderSection: spec.readinessProvider,
      ready: blockers.length === 0,
      blockers,
    };
  });
  const blockers = sections.flatMap((section) => (
    section.blockers.map((blocker) => `§${section.id}: ${blocker}`)
  ));
  const canonicalConsolidatedSqlReady = blockers.length === 0;
  const automatedMigrationPushReady = duplicateMigrationVersions.length === 0;

  return {
    sources,
    report: {
      mode: 'local_source',
      ready: canonicalConsolidatedSqlReady,
      canonicalConsolidatedSqlReady,
      automatedMigrationPushReady,
      networkAttempted: false,
      mutationsPerformed: false,
      migrationVersionInventory,
      duplicateMigrationVersions,
      sections,
      blockers,
    },
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function readProjectIdentity(): ProjectIdentity {
  const projectRef = requiredEnv('UC_ATTACHMENT_AUTHORITY_PROJECT_REF');
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PROJECT_REF must be an exact 20-character lowercase project ref.');
  }
  const rawUrl = requiredEnv('UC_ATTACHMENT_AUTHORITY_SUPABASE_URL');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('UC_ATTACHMENT_AUTHORITY_SUPABASE_URL must be an exact HTTPS project URL.');
  }
  const expectedHost = `${projectRef}.supabase.co`;
  if (
    url.protocol !== 'https:'
    || url.hostname !== expectedHost
    || url.port
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new Error('Supabase URL does not match the exact confirmed HTTPS project identity.');
  }
  return { origin: url.origin, projectRef };
}

function readCatalogConfig(): CatalogConfig {
  if (process.env.RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG !== '1') {
    throw new Error('Refusing live catalog checks without RUN_LIVE_ATTACHMENT_AUTHORITY_CATALOG=1.');
  }
  const identity = readProjectIdentity();
  const rawDatabaseUrl = requiredEnv('UC_ATTACHMENT_AUTHORITY_DATABASE_URL');
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new Error('UC_ATTACHMENT_AUTHORITY_DATABASE_URL must be a PostgreSQL connection URL.');
  }
  const username = decodeURIComponent(databaseUrl.username);
  const directIdentity = databaseUrl.hostname === `db.${identity.projectRef}.supabase.co`
    && username === 'postgres';
  const poolerIdentity = databaseUrl.hostname.endsWith('.pooler.supabase.com')
    && username === `postgres.${identity.projectRef}`;
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol)
    || (!directIdentity && !poolerIdentity)
    || !databaseUrl.password
    || databaseUrl.pathname !== '/postgres'
    || databaseUrl.search
    || databaseUrl.hash
  ) {
    throw new Error('Database URL does not match the exact confirmed Supabase project identity.');
  }
  const psqlPath = requiredEnv('UC_ATTACHMENT_AUTHORITY_PSQL_PATH');
  if (!psqlPath.startsWith('/') || resolve(psqlPath) !== psqlPath) {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PSQL_PATH must be an exact absolute trusted binary path.');
  }
  let psqlStat;
  try {
    psqlStat = lstatSync(psqlPath);
  } catch {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PSQL_PATH is unavailable.');
  }
  if (
    psqlStat.isSymbolicLink()
    || !psqlStat.isFile()
    || psqlStat.size < 1
    || psqlStat.size > 200 * 1024 * 1024
    || (psqlStat.mode & 0o111) === 0
    || (psqlStat.mode & 0o022) !== 0
  ) {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PSQL_PATH must be a non-writable, executable, non-symlink regular file up to 200 MiB.');
  }

  const sslRootCert = requiredEnv('UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT');
  if (!sslRootCert.startsWith('/') || resolve(sslRootCert) !== sslRootCert) {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT must be an exact absolute trusted CA bundle path.');
  }
  let sslRootCertStat;
  try {
    sslRootCertStat = lstatSync(sslRootCert);
  } catch {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT is unavailable.');
  }
  if (
    sslRootCertStat.isSymbolicLink()
    || !sslRootCertStat.isFile()
    || sslRootCertStat.size < 1
    || sslRootCertStat.size > 10 * 1024 * 1024
    || (sslRootCertStat.mode & 0o022) !== 0
  ) {
    throw new Error('UC_ATTACHMENT_AUTHORITY_PGSSLROOTCERT must be a non-writable, non-symlink regular CA bundle up to 10 MiB.');
  }
  return { ...identity, databaseUrl, psqlPath, sslRootCert };
}

function buildCatalogSql(sources: Map<SectionId, SectionSource>): string {
  const statements = ['BEGIN TRANSACTION READ ONLY;', "SET LOCAL statement_timeout = '15000ms';"];
  for (const sectionId of [38, 39, 40, 41, 44] as const) {
    const query = sources.get(sectionId)?.readinessQuery;
    if (!query) throw new Error(`Local readiness query for §${sectionId} is unavailable.`);
    const withoutSemicolon = query.trim().replace(/;$/u, '');
    statements.push(
      `SELECT json_build_object('section', ${sectionId}, 'checks', row_to_json(readiness_row))::text\n`
      + `FROM (\n${withoutSemicolon}\n) AS readiness_row;`,
    );
  }
  statements.push('ROLLBACK;');
  return statements.join('\n');
}

function runLiveCatalog(sources: Map<SectionId, SectionSource>): LiveReport {
  const config = readCatalogConfig();
  const databaseUrl = config.databaseUrl;
  const password = decodeURIComponent(databaseUrl.password);
  const username = decodeURIComponent(databaseUrl.username);
  const port = databaseUrl.port || (databaseUrl.protocol === 'postgresql:' ? '5432' : '5432');
  const sql = buildCatalogSql(sources);
  let output: string;
  try {
    output = execFileSync(config.psqlPath, [
      '-X',
      '-qAt',
      '-v', 'ON_ERROR_STOP=1',
      '-h', databaseUrl.hostname,
      '-p', port,
      '-U', username,
      '-d', 'postgres',
      '-c', sql,
    ], {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        LANG: 'C',
        LC_ALL: 'C',
        PGPASSWORD: password,
        PGCONNECT_TIMEOUT: '10',
        PGSSLMODE: 'verify-full',
        PGSSLROOTCERT: config.sslRootCert,
      },
    });
  } catch {
    return {
      mode: 'live_catalog',
      status: 'fail',
      attempted: true,
      networkAttempted: true,
      mutationsPerformed: false,
      projectIdentityVerified: true,
      checks: [],
      blocker: 'Read-only catalog transaction failed; no SQL was applied.',
    };
  }

  const rows = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const parsed = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    try {
      const value = JSON.parse(row) as unknown;
      if (!isRecord(value) || typeof value.section !== 'number' || !isRecord(value.checks)) continue;
      parsed.set(value.section, value.checks);
    } catch {
      // psql command tags and unsupported output are ignored, then exact
      // section/key coverage below fails closed.
    }
  }

  const checks: LiveCheck[] = [];
  for (const spec of SECTION_SPECS) {
    const providerChecks = parsed.get(spec.readinessProvider);
    for (const alias of spec.readinessAliases) {
      const ok = providerChecks?.[alias] === true;
      checks.push({
        id: `section_${spec.id}.${alias}`,
        ok,
        detail: ok ? 'catalog check returned true' : 'catalog check was missing or false',
      });
    }
  }
  const passed = checks.length > 0 && checks.every((check) => check.ok);
  return {
    mode: 'live_catalog',
    status: passed ? 'pass' : 'fail',
    attempted: true,
    networkAttempted: true,
    mutationsPerformed: false,
    projectIdentityVerified: true,
    checks,
    blocker: passed ? undefined : 'One or more live catalog readiness checks were false or unavailable.',
  };
}

function decodeJwtSubject(token: string, envName: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error(`${envName} must be a complete access-token JWT.`);
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new Error(`${envName} has an unreadable JWT payload.`);
  }
  if (!isRecord(payload) || typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
    throw new Error(`${envName} is missing an exact UUID subject.`);
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now() + 30_000) {
    throw new Error(`${envName} is expired or too close to expiry.`);
  }
  return payload.sub;
}

function readUuidEnv(name: string): string {
  const value = requiredEnv(name);
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be an exact UUID.`);
  return value;
}

function readCanaryConfig(): CanaryConfig {
  if (process.env.RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY !== '1') {
    throw new Error('Refusing live canary without RUN_LIVE_ATTACHMENT_AUTHORITY_CANARY=1.');
  }
  const identity = readProjectIdentity();
  const anonKey = requiredEnv('UC_ATTACHMENT_AUTHORITY_ANON_KEY');
  const userAToken = requiredEnv('UC_ATTACHMENT_AUTHORITY_USER_A_ACCESS_TOKEN');
  const userBToken = requiredEnv('UC_ATTACHMENT_AUTHORITY_USER_B_ACCESS_TOKEN');
  if (anonKey.length < 20) throw new Error('UC_ATTACHMENT_AUTHORITY_ANON_KEY is malformed.');
  const userAId = decodeJwtSubject(userAToken, 'UC_ATTACHMENT_AUTHORITY_USER_A_ACCESS_TOKEN');
  const userBId = decodeJwtSubject(userBToken, 'UC_ATTACHMENT_AUTHORITY_USER_B_ACCESS_TOKEN');
  if (userAId === userBId) throw new Error('Authenticated canary users must be distinct.');
  return {
    ...identity,
    anonKey,
    userAToken,
    userBToken,
    userAId,
    userBId,
    circleId: readUuidEnv('UC_ATTACHMENT_AUTHORITY_CIRCLE_ID'),
    artifactId: readUuidEnv('UC_ATTACHMENT_AUTHORITY_ARTIFACT_ID'),
    privateAttachmentId: readUuidEnv('UC_ATTACHMENT_AUTHORITY_PRIVATE_ATTACHMENT_ID'),
    devicePrivateApprovalId: readUuidEnv('UC_ATTACHMENT_AUTHORITY_DEVICE_PRIVATE_APPROVAL_ID'),
  };
}

const MAX_HTTP_RESPONSE_BYTES = 64 * 1024;

async function readResponseTextBounded(
  response: Response,
  maxBytes = MAX_HTTP_RESPONSE_BYTES,
): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && /^\d+$/u.test(declaredLength) && Number(declaredLength) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Bounded read response exceeded its byte limit.');
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new Error('Bounded read response exceeded its byte limit.');
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

async function fetchBoundedText(
  input: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal, redirect: 'error' });
    const body = await readResponseTextBounded(response);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    if (error instanceof Error && error.message === 'Bounded read response exceeded its byte limit.') {
      throw error;
    }
    throw new Error('Bounded read request failed.');
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

async function fetchBoundedStatus(
  input: string,
  init: RequestInit,
): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal, redirect: 'error' });
    const status = response.status;
    await response.body?.cancel();
    return status;
  } catch {
    throw new Error('Bounded read request failed.');
  } finally {
    controller.abort();
    clearTimeout(timeout);
  }
}

async function readFilteredRows(
  config: CanaryConfig,
  table: string,
  select: string,
  filters: Record<string, string>,
  token: string,
  maxRows: number,
): Promise<Record<string, unknown>[]> {
  const query = new URLSearchParams({ select, ...filters });
  const response = await fetchBoundedText(`${config.origin}/rest/v1/${table}?${query.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Authenticated ${table} read returned HTTP ${response.status}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(`Authenticated ${table} read returned malformed JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length > maxRows || !parsed.every(isRecord)) {
    throw new Error(`Authenticated ${table} read returned an unexpected row shape.`);
  }
  return parsed;
}

async function readExactRows(
  config: CanaryConfig,
  table: string,
  select: string,
  id: string,
  token: string,
): Promise<Record<string, unknown>[]> {
  const rows = await readFilteredRows(config, table, select, { id: `eq.${id}` }, token, 1);
  if (rows.some((row) => row.id !== id)) {
    throw new Error(`Authenticated ${table} read returned a mismatched row identity.`);
  }
  return rows;
}

async function readCanaryMemberships(
  config: CanaryConfig,
  token: string,
): Promise<Record<string, unknown>[]> {
  return readFilteredRows(
    config,
    'circle_members',
    'circle_id,user_id',
    {
      circle_id: `eq.${config.circleId}`,
      user_id: `in.(${config.userAId},${config.userBId})`,
    },
    token,
    2,
  );
}

function hasExactCanaryMemberships(
  rows: Record<string, unknown>[],
  config: CanaryConfig,
): boolean {
  const userIds = rows
    .filter((row) => row.circle_id === config.circleId && typeof row.user_id === 'string')
    .map((row) => row.user_id)
    .sort();
  return rows.length === 2
    && userIds.join(',') === [config.userAId, config.userBId].sort().join(',');
}

async function probeStorageRead(
  config: CanaryConfig,
  storagePath: string,
  token: string,
): Promise<number> {
  const encodedPath = storagePath.split('/').map(encodeURIComponent).join('/');
  return fetchBoundedStatus(
    `${config.origin}/storage/v1/object/authenticated/chat-attachments/${encodedPath}`,
    {
      method: 'GET',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        Range: 'bytes=0-0',
      },
    },
  );
}

function addCheck(checks: LiveCheck[], id: string, ok: boolean, pass: string, fail: string): void {
  checks.push({ id, ok, detail: ok ? pass : fail });
}

async function runAuthenticatedReadCanary(): Promise<LiveReport> {
  const config = readCanaryConfig();
  const checks: LiveCheck[] = [];
  try {
    const [membershipsA, membershipsB] = await Promise.all([
      readCanaryMemberships(config, config.userAToken),
      readCanaryMemberships(config, config.userBToken),
    ]);
    const membershipsReady = hasExactCanaryMemberships(membershipsA, config)
      && hasExactCanaryMemberships(membershipsB, config);
    addCheck(
      checks,
      'fixture.exact_two_member_circle',
      membershipsReady,
      'both authenticated users independently see the exact two fixture memberships',
      'the authenticated users are not both proven members of the exact configured circle',
    );
    if (!membershipsReady) {
      throw new Error('Exact shared-circle fixture membership was not proven; downstream canaries were withheld.');
    }

    const [artifactA, artifactB] = await Promise.all([
      readExactRows(config, 'agent_run_artifacts', 'id,run_id,circle_id', config.artifactId, config.userAToken),
      readExactRows(config, 'agent_run_artifacts', 'id,run_id,circle_id', config.artifactId, config.userBToken),
    ]);
    const artifactReady = artifactA.length === 1
      && artifactB.length === 1
      && artifactA[0]?.id === config.artifactId
      && artifactB[0]?.id === config.artifactId
      && artifactA[0]?.circle_id === config.circleId
      && artifactB[0]?.circle_id === config.circleId
      && artifactA[0]?.run_id === artifactB[0]?.run_id
      && typeof artifactA[0]?.run_id === 'string'
      && UUID_PATTERN.test(artifactA[0].run_id);
    addCheck(
      checks,
      'section_38.two_member_artifact_read',
      artifactReady,
      'both exact circle members read the same exact artifact in the configured circle',
      'artifact identity, circle binding, or two-member visibility did not match',
    );

    const [attachmentA, attachmentB] = await Promise.all([
      readExactRows(
        config,
        'message_attachments',
        'id,circle_id,thread_id,user_id,message_id,storage_path',
        config.privateAttachmentId,
        config.userAToken,
      ),
      readExactRows(
        config,
        'message_attachments',
        'id,circle_id,thread_id,user_id,message_id,storage_path',
        config.privateAttachmentId,
        config.userBToken,
      ),
    ]);
    const attachmentRow = attachmentA[0];
    const storagePath = typeof attachmentRow?.storage_path === 'string'
      ? attachmentRow.storage_path
      : '';
    const pathSegments = storagePath.split('/');
    const privateFixtureReady = attachmentA.length === 1
      && attachmentB.length === 0
      && attachmentRow?.id === config.privateAttachmentId
      && attachmentRow?.circle_id === config.circleId
      && attachmentRow?.user_id === config.userAId
      && attachmentRow?.message_id === null
      && pathSegments.length === 4
      && pathSegments[0] === config.circleId
      && pathSegments[1] === (attachmentRow?.thread_id === null ? '_direct' : attachmentRow?.thread_id)
      && pathSegments[2] === config.userAId
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$/iu.test(pathSegments[3] || '');
    addCheck(
      checks,
      'sections_39_40.staged_attachment_visibility',
      privateFixtureReady,
      'owner sees one exact staged row and the peer sees none',
      'staged attachment fixture identity or private visibility did not match',
    );

    if (privateFixtureReady) {
      const ownerStorageStatus = await probeStorageRead(config, storagePath, config.userAToken);
      const peerStorageStatus = await probeStorageRead(config, storagePath, config.userBToken);
      addCheck(
        checks,
        'section_40.private_storage_visibility',
        [200, 206].includes(ownerStorageStatus) && [400, 401, 403, 404].includes(peerStorageStatus),
        'owner can read the exact object while the peer receives a denial/not-found response',
        'private Storage visibility did not match the exact staged-row authority',
      );
    } else {
      addCheck(
        checks,
        'section_40.private_storage_visibility',
        false,
        '',
        'Storage probe was withheld because staged metadata identity was not exact',
      );
    }

    const [approvalA, approvalB] = await Promise.all([
      readExactRows(
        config,
        'agent_run_approvals',
        'id,run_id,circle_id,requested_by,payload',
        config.devicePrivateApprovalId,
        config.userAToken,
      ),
      readExactRows(
        config,
        'agent_run_approvals',
        'id,run_id,circle_id,requested_by,payload',
        config.devicePrivateApprovalId,
        config.userBToken,
      ),
    ]);
    const approvalRow = approvalA[0];
    const approvalPayload = isRecord(approvalRow?.payload) ? approvalRow.payload : null;
    const approvalReady = approvalA.length === 1
      && approvalB.length === 0
      && approvalRow?.id === config.devicePrivateApprovalId
      && approvalRow?.circle_id === config.circleId
      && approvalRow?.requested_by === config.userAId
      && typeof approvalRow?.run_id === 'string'
      && UUID_PATTERN.test(approvalRow.run_id)
      && approvalPayload?.approvalSchemaVersion === 2
      && approvalPayload?.toolName === 'desktop.open_attachment';
    addCheck(
      checks,
      'sections_28_41.device_private_approval_read',
      approvalReady,
      'requester sees the canonical row and the exact peer sees none',
      'device-private approval fixture identity or visibility did not match',
    );

    if (approvalReady && typeof approvalRow?.run_id === 'string') {
      const [approvalRunA, approvalRunB] = await Promise.all([
        readExactRows(
          config,
          'agent_runs',
          'id,circle_id,user_id',
          approvalRow.run_id,
          config.userAToken,
        ),
        readExactRows(
          config,
          'agent_runs',
          'id,circle_id,user_id',
          approvalRow.run_id,
          config.userBToken,
        ),
      ]);
      const parentRunReady = approvalRunA.length === 1
        && approvalRunB.length === 1
        && approvalRunA[0]?.id === approvalRow.run_id
        && approvalRunB[0]?.id === approvalRow.run_id
        && approvalRunA[0]?.circle_id === config.circleId
        && approvalRunB[0]?.circle_id === config.circleId
        && approvalRunA[0]?.user_id === config.userAId
        && approvalRunB[0]?.user_id === config.userAId;
      addCheck(
        checks,
        'sections_28_38_41.approval_parent_run_binding',
        parentRunReady,
        'the approval parent is one exact user-A run in the configured shared circle',
        'approval parent-run identity, circle, owner, or member visibility did not match',
      );
    } else {
      addCheck(
        checks,
        'sections_28_38_41.approval_parent_run_binding',
        false,
        '',
        'parent-run probe was withheld because approval identity was not exact',
      );
    }
  } catch (error) {
    const blocker = error instanceof Error ? error.message : 'Authenticated read canary failed.';
    return {
      mode: 'authenticated_read_canary',
      status: 'fail',
      attempted: true,
      networkAttempted: true,
      mutationsPerformed: false,
      projectIdentityVerified: true,
      checks,
      blocker,
    };
  }

  const passed = checks.length === 6 && checks.every((check) => check.ok);
  return {
    mode: 'authenticated_read_canary',
    status: passed ? 'pass' : 'fail',
    attempted: true,
    networkAttempted: true,
    mutationsPerformed: false,
    projectIdentityVerified: true,
    checks,
    blocker: passed ? undefined : 'One or more authenticated read canaries failed.',
  };
}

function readRestartSafety(value: unknown): {
  sourceChanged: boolean;
  safeToRefresh: boolean;
  blockers: string[];
} | null {
  if (!isRecord(value)) return null;
  if (typeof value.sourceChanged !== 'boolean' || typeof value.safeToRefresh !== 'boolean') return null;
  if (!Array.isArray(value.blockers) || value.blockers.length > 64) return null;
  const blockers: string[] = [];
  for (const blocker of value.blockers) {
    if (typeof blocker !== 'string' || !/^[a-z0-9_]{1,96}$/u.test(blocker)) return null;
    if (!blockers.includes(blocker)) blockers.push(blocker);
  }
  return { sourceChanged: value.sourceChanged, safeToRefresh: value.safeToRefresh, blockers };
}

export function classifyLocalBridgeHealthPayload(parsed: unknown): LocalBridgeHealthClassification {
  if (!isRecord(parsed) || parsed.ok !== true || !Array.isArray(parsed.tools)) {
    throw new Error('Loopback desktop health returned an unsupported shape.');
  }
  const tools = parsed.tools.filter((tool): tool is string => typeof tool === 'string');
  const capabilityReady = parsed.supported === true
    && tools.includes('attachment_open_capability');
  const hasRestartSafety = Object.prototype.hasOwnProperty.call(parsed, 'restartSafety');
  const restartSafety = readRestartSafety(parsed.restartSafety);

  if (hasRestartSafety && !restartSafety) {
    return {
      classification: 'restart_blocked',
      capabilityReady,
      sourceChanged: null,
      safeToRefresh: false,
      blocker: 'Running bridge returned malformed restart-safety evidence; no restart was requested.',
    };
  }
  if (!restartSafety) {
    return capabilityReady
      ? {
          classification: 'restart_blocked',
          capabilityReady: true,
          sourceChanged: null,
          safeToRefresh: false,
          blocker: 'Running bridge advertises the capability but provides no restart-safety evidence; source currency is unproven.',
        }
      : {
          classification: 'capability_missing',
          capabilityReady: false,
          sourceChanged: null,
          safeToRefresh: null,
          blocker: 'Running bridge does not advertise attachment_open_capability. Source drift is unproven; no restart was requested.',
        };
  }

  if (!capabilityReady) {
    return {
      classification: restartSafety.sourceChanged
        ? 'source_changed_capability_missing'
        : 'capability_missing',
      capabilityReady: false,
      sourceChanged: restartSafety.sourceChanged,
      safeToRefresh: restartSafety.safeToRefresh,
      blocker: restartSafety.sourceChanged
        ? 'Running bridge reports source drift and lacks attachment_open_capability. This read-only preflight did not request refresh.'
        : 'Running bridge does not advertise attachment_open_capability. No restart was requested.',
    };
  }
  if (!restartSafety.sourceChanged) {
    return {
      classification: 'current',
      capabilityReady: true,
      sourceChanged: false,
      safeToRefresh: false,
    };
  }
  if (restartSafety.safeToRefresh) {
    return {
      classification: 'idle_safe_restart',
      capabilityReady: true,
      sourceChanged: true,
      safeToRefresh: true,
      blocker: 'Running bridge reports an idle-safe source refresh is available. This read-only preflight did not request it.',
    };
  }
  const boundedBlockers = restartSafety.blockers.slice(0, 12).join(', ');
  return {
    classification: 'restart_blocked',
    capabilityReady: true,
    sourceChanged: true,
    safeToRefresh: false,
    blocker: boundedBlockers
      ? `Running bridge reports source drift, but refresh is blocked: ${boundedBlockers}.`
      : 'Running bridge reports source drift, but did not provide safe refresh authority.',
  };
}

async function runLocalBridgeHealth(): Promise<LocalBridgeReport> {
  const endpoint = 'http://127.0.0.1:7778/desktop/health';
  try {
    const response = await fetchBoundedText(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        mode: 'local_bridge_health',
        status: 'fail',
        attempted: true,
        networkAttempted: true,
        mutationsPerformed: false,
        loopbackOnly: true,
        opaqueAttachmentCapability: null,
        blocker: `Loopback desktop health returned HTTP ${response.status}.`,
      };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body) as unknown;
    } catch {
      throw new Error('Loopback desktop health returned malformed JSON.');
    }
    const classified = classifyLocalBridgeHealthPayload(parsed);
    const current = classified.classification === 'current';
    return {
      mode: 'local_bridge_health',
      status: current ? 'pass' : 'watch',
      attempted: true,
      networkAttempted: true,
      mutationsPerformed: false,
      loopbackOnly: true,
      opaqueAttachmentCapability: classified.capabilityReady,
      classification: classified.classification,
      sourceChanged: classified.sourceChanged,
      safeToRefresh: classified.safeToRefresh,
      blocker: classified.blocker,
    };
  } catch (error) {
    const blocker = error instanceof Error ? error.message : 'Loopback desktop health failed.';
    return {
      mode: 'local_bridge_health',
      status: 'fail',
      attempted: true,
      networkAttempted: true,
      mutationsPerformed: false,
      loopbackOnly: true,
      opaqueAttachmentCapability: null,
      blocker,
    };
  }
}

function bridgeNotRun(): LocalBridgeReport {
  return {
    mode: 'local_bridge_health',
    status: 'not_run',
    attempted: false,
    networkAttempted: false,
    mutationsPerformed: false,
    loopbackOnly: true,
    opaqueAttachmentCapability: null,
  };
}

function notRun(mode: LiveReport['mode']): LiveReport {
  return {
    mode,
    status: 'not_run',
    attempted: false,
    networkAttempted: false,
    mutationsPerformed: false,
    projectIdentityVerified: false,
    checks: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatText(args: {
  local: LocalSourceReport;
  localBridge: LocalBridgeReport;
  liveCatalog: LiveReport;
  authenticatedCanary: LiveReport;
}): string {
  const lines = [
    `Attachment authority deployment preflight: ${
      !args.local.canonicalConsolidatedSqlReady
        ? 'LOCAL SOURCE BLOCKED'
        : args.local.automatedMigrationPushReady
          ? 'LOCAL SOURCE READY; AUTOMATED PUSH READY'
          : 'LOCAL SOURCE READY; AUTOMATED PUSH BLOCKED'
    }`,
    'default mode: local repository reads only',
    `network_attempted: ${args.localBridge.networkAttempted || args.liveCatalog.networkAttempted || args.authenticatedCanary.networkAttempted ? 'yes' : 'no'}`,
    'mutations_performed: no',
    '',
    'local source readiness:',
  ];
  for (const section of args.local.sections) {
    const readiness = section.readinessProviderSection === section.id
      ? 'own readiness SELECT'
      : `readiness supplied by §${section.readinessProviderSection}`;
    lines.push(`- §${section.id}: ${section.ready ? 'ready' : 'blocked'} (${readiness})`);
    for (const blocker of section.blockers) lines.push(`  - ${blocker}`);
  }
  lines.push(
    `canonical consolidated SQL: ${args.local.canonicalConsolidatedSqlReady ? 'ready' : 'blocked'}`,
    `automated migration push: ${args.local.automatedMigrationPushReady ? 'ready' : 'blocked'}`,
  );
  if (!args.local.automatedMigrationPushReady) {
    lines.push('duplicate migration versions:');
    for (const duplicate of args.local.duplicateMigrationVersions) {
      lines.push(`- ${duplicate.version} (${duplicate.files.length} files)`);
    }
    lines.push('recovery: use the reviewed docs/RUN_THIS_SQL.sql workflow; do not rename legacy migrations during deployment.');
  }
  lines.push('', `local bridge health: ${args.localBridge.status}`);
  if (args.localBridge.classification) {
    lines.push(`- classification: ${args.localBridge.classification}`);
  }
  if (args.localBridge.blocker) lines.push(`- ${args.localBridge.blocker}`);
  lines.push(`live catalog readiness: ${args.liveCatalog.status}`);
  if (args.liveCatalog.blocker) lines.push(`- ${args.liveCatalog.blocker}`);
  lines.push(`authenticated read canary: ${args.authenticatedCanary.status}`);
  if (args.authenticatedCanary.blocker) lines.push(`- ${args.authenticatedCanary.blocker}`);
  if (args.liveCatalog.status === 'not_run' || args.authenticatedCanary.status === 'not_run') {
    lines.push('', 'Live status is intentionally unverified. Use --help for the separately gated read-only modes.');
  }
  lines.push('No migration was applied and no write request was sent.');
  return lines.join('\n');
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { report: local, sources } = buildLocalSourceReport(options.repoRoot);
    if (!local.ready) {
      const payload = {
        local,
        localBridge: bridgeNotRun(),
        liveCatalog: notRun('live_catalog'),
        authenticatedCanary: notRun('authenticated_read_canary'),
      };
      console.log(options.json ? JSON.stringify(payload, null, 2) : formatText(payload));
      process.exit(2);
    }

    const localBridge = options.localBridgeHealth
      ? await runLocalBridgeHealth()
      : bridgeNotRun();
    const liveCatalog = options.liveCatalog
      ? runLiveCatalog(sources)
      : notRun('live_catalog');
    const authenticatedCanary = options.liveCanary
      ? await runAuthenticatedReadCanary()
      : notRun('authenticated_read_canary');
    const payload = { local, localBridge, liveCatalog, authenticatedCanary };
    console.log(options.json ? JSON.stringify(payload, null, 2) : formatText(payload));

    if (localBridge.status === 'fail' || liveCatalog.status === 'fail' || authenticatedCanary.status === 'fail') process.exit(3);
    if (localBridge.status === 'watch') process.exit(4);
    if (!local.automatedMigrationPushReady) process.exit(5);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Attachment authority preflight failed.';
    console.error(`[attachment-authority-deployment-preflight] ${message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
