import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient } from '@supabase/supabase-js';

import {
  SWANBOT_OPENSWAN_DEFAULT_MIN_TELEMETRY_RUNS,
  SWANBOT_OPENSWAN_REQUIRED_SMOKES,
  buildSwanBotOpenSwanReadinessSnapshot,
  deriveSwanbotV2ToolParityFromSource,
  formatSwanBotOpenSwanReadinessPromptBlock,
  loadSwanBotOpenSwanAgentRunTelemetry,
  type SwanBotOpenSwanProductionTelemetry,
  type SwanBotOpenSwanProductionContractCheck,
  type SwanBotOpenSwanReadinessSnapshot,
  type SwanBotOpenSwanSmokeCheck,
  type SwanBotOpenSwanTelemetryCompleteness,
} from '../src/lib/swanbotOpenSwanReadiness';

type OutputFormat = 'summary' | 'json' | 'prompt';

interface CliOptions {
  repoRoot: string;
  circleId?: string;
  since?: string;
  until?: string;
  days: number;
  minRuns: number;
  pageSize: number;
  smokesPassed: boolean;
  failOnBlocked: boolean;
  failOnNotReady: boolean;
  outputFormat: OutputFormat;
  appOrigin?: string;
}

interface SchemaColumnRequirement {
  column: string;
  expectedType: string;
}

interface SchemaReport {
  ok: boolean;
  requiredColumns: SchemaColumnRequirement[];
  checkedVia: string[];
  blockers: string[];
  warnings: string[];
  columns: Array<{
    column_name?: string | null;
    data_type?: string | null;
    is_nullable?: string | null;
    column_default?: string | null;
  }>;
}

interface ProductionDatabaseContractReport {
  contractVersion: number | null;
  checks: SwanBotOpenSwanProductionContractCheck[];
  warnings: string[];
}

interface ProductionCheckDefinition {
  id: string;
  label: string;
  recovery: string;
}

interface RequiredEdgeFunction {
  slug: string;
  verifyJwt: boolean;
}

const ENV_FILES = ['.env', '.env.local', '.env.production', 'supabase/.env'];
const REQUIRED_AGENT_RUN_COLUMNS: SchemaColumnRequirement[] = [
  { column: 'tool_calls', expectedType: 'jsonb' },
  { column: 'iteration_count', expectedType: 'integer' },
  { column: 'final_stop_reason', expectedType: 'text' },
  { column: 'input_tokens', expectedType: 'bigint' },
  { column: 'output_tokens', expectedType: 'bigint' },
  { column: 'cached_tokens', expectedType: 'bigint' },
];

const DEFAULT_APP_ORIGIN = 'https://app.chrisswanson.xyz';
const DATABASE_CHECK_DEFINITIONS: ProductionCheckDefinition[] = [
  {
    id: 'database.circle_chat_threads',
    label: 'circle_chat_threads table',
    recovery: 'Apply the Chat thread-lineage migrations, reload PostgREST, and rerun the production report.',
  },
  {
    id: 'database.messages_thread_contract',
    label: 'messages.thread_id UUID NOT NULL contract',
    recovery: 'Apply RUN_THIS_SQL.sql section 31, reload PostgREST, and rerun the production report.',
  },
  {
    id: 'database.messages_authority',
    label: 'thread-scoped messages RLS and mutation guard',
    recovery: 'Reapply RUN_THIS_SQL.sql section 31 and verify the four canonical message policies and mutation trigger.',
  },
  {
    id: 'database.message_reaction_rpc',
    label: 'set_message_reaction RPC authority',
    recovery: 'Reapply RUN_THIS_SQL.sql section 31 and reload the PostgREST schema cache.',
  },
  {
    id: 'database.thread_realtime',
    label: 'circle_chat_threads Realtime publication',
    recovery: 'Add circle_chat_threads to supabase_realtime by reapplying RUN_THIS_SQL.sql section 31.',
  },
  {
    id: 'database.approval_contract',
    label: 'agent_approvals.applied_at single-use approval column',
    recovery: 'Apply RUN_THIS_SQL.sql section 10b and reload the PostgREST schema cache.',
  },
  {
    id: 'database.agent_run_contract',
    label: 'agent_runs tool and stop-reason telemetry columns',
    recovery: 'Apply RUN_THIS_SQL.sql section 9 and reload the PostgREST schema cache.',
  },
];
const REQUIRED_EDGE_FUNCTIONS: RequiredEdgeFunction[] = [
  { slug: 'google-oauth', verifyJwt: false },
  { slug: 'swanbot-ai', verifyJwt: false },
  { slug: 'swanbot-v2-ai', verifyJwt: true },
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repoRoot: resolve(__dirname, '..'),
    days: 7,
    minRuns: SWANBOT_OPENSWAN_DEFAULT_MIN_TELEMETRY_RUNS,
    pageSize: 500,
    smokesPassed: false,
    failOnBlocked: false,
    failOnNotReady: false,
    outputFormat: 'summary',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    const eqIdx = raw.indexOf('=');
    const flag = eqIdx >= 0 ? raw.slice(0, eqIdx) : raw;
    const inlineValue = eqIdx >= 0 ? raw.slice(eqIdx + 1) : undefined;
    const nextValue = () => {
      const value = inlineValue ?? argv[i + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (inlineValue === undefined) i += 1;
      return value;
    };

    if (flag === '--help' || flag === '-h') {
      printHelp();
      process.exit(0);
    } else if (flag === '--repo') {
      options.repoRoot = resolve(nextValue());
    } else if (flag === '--circle' || flag === '--circle-id') {
      options.circleId = nextValue();
    } else if (flag === '--since') {
      options.since = parseIsoDate(nextValue(), flag);
    } else if (flag === '--until') {
      options.until = parseIsoDate(nextValue(), flag);
    } else if (flag === '--days') {
      options.days = parseInteger(nextValue(), flag, 1, 90);
    } else if (flag === '--min-runs') {
      options.minRuns = parseInteger(nextValue(), flag, 1, 10000);
    } else if (flag === '--page-size') {
      options.pageSize = parseInteger(nextValue(), flag, 1, 1000);
    } else if (flag === '--origin' || flag === '--app-origin') {
      options.appOrigin = parseHttpOrigin(nextValue(), flag);
    } else if (flag === '--json') {
      options.outputFormat = 'json';
    } else if (flag === '--prompt') {
      options.outputFormat = 'prompt';
    } else if (flag === '--smokes-passed') {
      options.smokesPassed = true;
    } else if (flag === '--fail-on-blocked') {
      options.failOnBlocked = true;
    } else if (flag === '--fail-on-not-ready' || flag === '--fail-on-watch') {
      options.failOnBlocked = true;
      options.failOnNotReady = true;
    } else {
      throw new Error(`Unknown option: ${raw}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log([
    'Usage: npx tsx scripts/swanbot-openswan-readiness-report.ts [options]',
    '',
    'Live production report for the SwanBot v2 default-flip decision.',
    '',
    'Required env:',
    '  SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL',
    '  SUPABASE_SERVICE_ROLE_KEY (optional when the Supabase CLI is authenticated)',
    '  Authenticated Supabase CLI access for function/JWT-mode and secret-name checks',
    '',
    'Options:',
    '  --circle <uuid>          Limit telemetry to one circle.',
    '  --since <iso/date>       Start of telemetry window. Defaults to --days ago.',
    '  --until <iso/date>       End of telemetry window. Defaults to now.',
    '  --days <n>               Window size when --since is omitted. Default: 7.',
    '  --min-runs <n>           Required v1/v2 sample count. Default: 50.',
    '  --page-size <n>          Supabase page size. Default: 500.',
    `  --origin <url>           Production web origin. Default: ${DEFAULT_APP_ORIGIN}.`,
    '  --smokes-passed         Mark required local smokes as passed in the snapshot.',
    '  --json                  Print machine-readable report.',
    '  --prompt                Print only the hidden readiness prompt block.',
    '  --fail-on-blocked       Exit 2 when readiness is blocked.',
    '  --fail-on-not-ready     Exit non-zero unless can_flip_default is yes.',
    '',
    'Default-flip flow:',
    '  npm run check:swanbot-v2:release',
    '  npm run report:swanbot-openswan-readiness -- --smokes-passed --since <iso>',
  ].join('\n'));
}

function parseInteger(value: string, flag: string, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.floor(parsed) !== parsed || parsed < min || parsed > max) {
    throw new Error(`${flag} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function parseIsoDate(value: string, flag: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${flag} must be a valid date or ISO timestamp`);
  return date.toISOString();
}

function parseHttpOrigin(value: string, flag: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${flag} must be a valid HTTP(S) origin`);
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
    throw new Error(`${flag} must be a credential-free HTTP(S) origin`);
  }
  return url.origin;
}

function loadEnvFiles(repoRoot: string): void {
  for (const file of ENV_FILES) {
    const abs = resolve(repoRoot, file);
    if (!existsSync(abs)) continue;
    const raw = readFileSync(abs, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

function buildWindow(options: CliOptions): { since: string; until: string } {
  const until = options.until || new Date().toISOString();
  const since = options.since || new Date(new Date(until).getTime() - options.days * 86400000).toISOString();
  return { since, until };
}

function buildSmokeChecks(options: CliOptions): SwanBotOpenSwanSmokeCheck[] {
  return SWANBOT_OPENSWAN_REQUIRED_SMOKES.map((smoke) => ({
    ...smoke,
    status: options.smokesPassed ? 'pass' : 'unknown',
    detail: options.smokesPassed ? 'Assumed from fresh local release check.' : 'Run check:swanbot-v2:release, then rerun with --smokes-passed.',
  }));
}

function deriveToolParity(repoRoot: string): {
  total: number;
  server: number;
  clientDelegated: number;
  blockers: string[];
} {
  const sourcePath = resolve(repoRoot, 'supabase/functions/swanbot-v2-ai/index.ts');
  try {
    const source = readFileSync(sourcePath, 'utf8');
    return { ...deriveSwanbotV2ToolParityFromSource(source), blockers: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      total: 0,
      server: 0,
      clientDelegated: 0,
      blockers: [`Could not derive v2 tool parity from ${sourcePath}: ${message}`],
    };
  }
}

async function verifyAgentRunsSchema(client: any): Promise<SchemaReport> {
  const requiredNames = REQUIRED_AGENT_RUN_COLUMNS.map((item) => item.column);
  const report: SchemaReport = {
    ok: true,
    requiredColumns: REQUIRED_AGENT_RUN_COLUMNS,
    checkedVia: [],
    blockers: [],
    warnings: [],
    columns: [],
  };

  const selectColumns = ['id', ...requiredNames].join(', ');
  const probe = await client.from('agent_runs').select(selectColumns).limit(1);
  report.checkedVia.push('agent_runs select probe');
  if (probe.error) {
    report.blockers.push(`agent_runs required column probe failed: ${probe.error.message || 'unknown error'}`);
  }

  if (typeof client.schema === 'function') {
    try {
      const schemaClient = client.schema('information_schema');
      const { data, error } = await schemaClient
        .from('columns')
        .select('column_name, data_type, is_nullable, column_default')
        .eq('table_schema', 'public')
        .eq('table_name', 'agent_runs')
        .in('column_name', requiredNames);
      if (error) {
        report.warnings.push(`information_schema type check unavailable: ${error.message || 'unknown error'}.`);
      } else {
        report.checkedVia.push('information_schema.columns');
        report.columns = data || [];
        const byName = new Map(report.columns.map((column) => [column.column_name, column]));
        for (const required of REQUIRED_AGENT_RUN_COLUMNS) {
          const column = byName.get(required.column);
          if (!column) {
            report.blockers.push(`agent_runs.${required.column} is missing.`);
          } else if (column.data_type !== required.expectedType) {
            report.blockers.push(`agent_runs.${required.column} has type ${column.data_type || 'unknown'}; expected ${required.expectedType}.`);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.warnings.push(`information_schema type check unavailable: ${message}.`);
    }
  } else {
    report.warnings.push('information_schema type check unavailable: Supabase client has no schema() helper.');
  }

  report.ok = report.blockers.length === 0;
  return report;
}

async function verifyProductionDatabaseContract(client: any): Promise<ProductionDatabaseContractReport> {
  const report: ProductionDatabaseContractReport = {
    contractVersion: null,
    checks: [],
    warnings: [],
  };
  const { data, error } = await client.rpc('openswan_production_readiness_contract');
  if (error) {
    report.checks.push({
      id: 'database.readiness_rpc',
      label: 'service-role OpenSwan readiness RPC',
      status: 'fail',
      detail: 'The value-free production contract RPC is missing or unavailable.',
      recovery: 'Apply RUN_THIS_SQL.sql section 32, reload PostgREST, and rerun the production report.',
    });
    return report;
  }

  const parsed = parseDatabaseContractPayload(data);
  if (!parsed) {
    report.checks.push({
      id: 'database.readiness_rpc',
      label: 'service-role OpenSwan readiness RPC',
      status: 'fail',
      detail: 'The RPC returned an unsupported or malformed value-free contract.',
      recovery: 'Reapply RUN_THIS_SQL.sql section 32 and redeploy the matching readiness report.',
    });
    return report;
  }

  report.contractVersion = parsed.contractVersion;
  report.checks.push({
    id: 'database.readiness_rpc',
    label: 'service-role OpenSwan readiness RPC',
    status: 'pass',
    detail: `Contract version ${parsed.contractVersion}.`,
    recovery: 'Reapply RUN_THIS_SQL.sql section 32 and reload PostgREST.',
  });
  for (const definition of DATABASE_CHECK_DEFINITIONS) {
    const ok = parsed.checks.get(definition.id);
    report.checks.push({
      ...definition,
      status: ok === true ? 'pass' : ok === false ? 'fail' : 'unknown',
      detail: ok === undefined
        ? 'The database contract did not return this required check.'
        : ok
          ? 'Verified by the service-role catalog contract.'
          : 'The live database does not satisfy the required catalog contract.',
    });
  }
  return report;
}

function parseDatabaseContractPayload(input: unknown): {
  contractVersion: number;
  checks: Map<string, boolean>;
} | null {
  if (!isRecord(input) || input.contractVersion !== 1 || !Array.isArray(input.checks)) return null;
  const checks = new Map<string, boolean>();
  for (const raw of input.checks) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.ok !== 'boolean') return null;
    const id = raw.id.trim();
    if (!id || id.length > 120 || checks.has(id)) return null;
    checks.set(id, raw.ok);
  }
  return { contractVersion: input.contractVersion, checks };
}

function deriveProjectRef(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  const projectRef = url.hostname.split('.')[0] || '';
  if (!/^[a-z0-9]{20}$/u.test(projectRef)) {
    throw new Error('Could not derive a valid Supabase project ref from SUPABASE_URL.');
  }
  return projectRef;
}

function buildManagementProductionChecks(
  repoRoot: string,
  projectRef: string,
): SwanBotOpenSwanProductionContractCheck[] {
  return [
    ...buildFunctionDeploymentChecks(repoRoot, projectRef),
    ...buildSecretPresenceChecks(repoRoot, projectRef),
  ];
}

function buildFunctionDeploymentChecks(
  repoRoot: string,
  projectRef: string,
): SwanBotOpenSwanProductionContractCheck[] {
  let payload: unknown;
  try {
    payload = runSupabaseCliJson(repoRoot, [
      'functions',
      'list',
      '--project-ref',
      projectRef,
      '--output-format',
      'json',
    ]);
  } catch {
    return REQUIRED_EDGE_FUNCTIONS.map((requirement) => ({
      id: `function.${requirement.slug}`,
      label: `${requirement.slug} deployment and JWT mode`,
      status: 'unknown',
      detail: 'Authenticated Supabase CLI function metadata was unavailable.',
      recovery: 'Authenticate the Supabase CLI for this project, then rerun the production report.',
    }));
  }

  const functions = parseFunctionList(payload);
  if (!functions) {
    return REQUIRED_EDGE_FUNCTIONS.map((requirement) => ({
      id: `function.${requirement.slug}`,
      label: `${requirement.slug} deployment and JWT mode`,
      status: 'unknown',
      detail: 'Supabase CLI returned an unsupported function-list shape.',
      recovery: 'Update or repair the Supabase CLI, then rerun the production report.',
    }));
  }

  const bySlug = new Map(functions.map((item) => [item.slug, item]));
  return REQUIRED_EDGE_FUNCTIONS.map((requirement) => {
    const deployed = bySlug.get(requirement.slug);
    const ok = deployed?.status === 'ACTIVE' && deployed.verifyJwt === requirement.verifyJwt;
    return {
      id: `function.${requirement.slug}`,
      label: `${requirement.slug} deployment and JWT mode`,
      status: ok ? 'pass' : 'fail',
      detail: !deployed
        ? 'Function is not deployed.'
        : deployed.status !== 'ACTIVE'
          ? `Function status is ${deployed.status || 'unknown'}; expected ACTIVE.`
          : `verify_jwt is ${String(deployed.verifyJwt)}; expected ${String(requirement.verifyJwt)}.`,
      recovery: `Deploy ${requirement.slug} with the canonical supabase/config.toml JWT mode, then rerun the report.`,
    };
  });
}

function parseFunctionList(input: unknown): Array<{
  slug: string;
  status: string;
  verifyJwt: boolean | null;
}> | null {
  if (!isRecord(input) || !Array.isArray(input.functions)) return null;
  const parsed: Array<{ slug: string; status: string; verifyJwt: boolean | null }> = [];
  for (const raw of input.functions) {
    if (!isRecord(raw) || typeof raw.slug !== 'string') continue;
    parsed.push({
      slug: raw.slug.trim().slice(0, 120),
      status: typeof raw.status === 'string' ? raw.status.trim().slice(0, 40) : '',
      verifyJwt: typeof raw.verify_jwt === 'boolean' ? raw.verify_jwt : null,
    });
  }
  return parsed;
}

function buildSecretPresenceChecks(
  repoRoot: string,
  projectRef: string,
): SwanBotOpenSwanProductionContractCheck[] {
  let payload: unknown;
  try {
    payload = runSupabaseCliJson(repoRoot, [
      'secrets',
      'list',
      '--project-ref',
      projectRef,
      '--output-format',
      'json',
    ]);
  } catch {
    return secretChecksFromNames(null);
  }
  return secretChecksFromNames(parseSecretNames(payload));
}

function parseSecretNames(input: unknown): Set<string> | null {
  if (!isRecord(input) || !Array.isArray(input.secrets)) return null;
  const names = new Set<string>();
  for (const raw of input.secrets) {
    if (isRecord(raw) && typeof raw.name === 'string' && /^[A-Z0-9_]{1,120}$/u.test(raw.name)) {
      names.add(raw.name);
    }
  }
  return names;
}

function secretChecksFromNames(names: Set<string> | null): SwanBotOpenSwanProductionContractCheck[] {
  const unavailable = names === null;
  const hasContinuationKeys = names?.has('SWANBOT_CONTINUATION_ENCRYPTION_SECRET') === true
    && names.has('SWANBOT_CONTINUATION_ENCRYPTION_KEY_VERSION');
  const hasGoogleCredentials = (
    names?.has('GOOGLE_OAUTH_CLIENT_ID') === true
      && names.has('GOOGLE_OAUTH_CLIENT_SECRET')
  ) || (
    names?.has('GOOGLE_CLIENT_ID') === true
      && names.has('GOOGLE_CLIENT_SECRET')
  );
  const definitions: Array<{
    id: string;
    label: string;
    ok: boolean;
    recovery: string;
  }> = [
    {
      id: 'secret.swanbot_continuation',
      label: 'SwanBot continuation encryption secret names',
      ok: hasContinuationKeys,
      recovery: 'Set the continuation encryption secret and key-version secrets, then redeploy SwanBot v2.',
    },
    {
      id: 'secret.anthropic_platform',
      label: 'platform Anthropic secret name',
      ok: names?.has('ANTHROPIC_API_KEY') === true,
      recovery: 'Set ANTHROPIC_API_KEY for the platform SwanBot path or intentionally change this contract with the provider route.',
    },
    {
      id: 'secret.google_oauth',
      label: 'Google OAuth client secret names',
      ok: hasGoogleCredentials,
      recovery: 'Set a complete GOOGLE_OAUTH_CLIENT_ID/SECRET or GOOGLE_CLIENT_ID/SECRET pair, then redeploy google-oauth.',
    },
  ];
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    status: unavailable ? 'unknown' : definition.ok ? 'pass' : 'fail',
    detail: unavailable
      ? 'Authenticated Supabase CLI secret metadata was unavailable.'
      : definition.ok
        ? 'Required secret names are present; values were not read or printed.'
        : 'One or more required secret names are missing.',
    recovery: unavailable
      ? 'Authenticate the Supabase CLI for this project, then rerun the production report.'
      : definition.recovery,
  }));
}

function runSupabaseCliJson(repoRoot: string, args: string[]): unknown {
  const candidates: Array<{ command: string; prefix: string[] }> = [
    { command: 'supabase', prefix: [] },
    { command: 'npx', prefix: ['--no-install', 'supabase'] },
  ];
  for (const candidate of candidates) {
    try {
      const output = execFileSync(candidate.command, [...candidate.prefix, ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return JSON.parse(output) as unknown;
    } catch {
      // Try the next argv-only CLI path. Captured stderr is intentionally not
      // surfaced because management commands can include sensitive metadata.
    }
  }
  throw new Error('Authenticated Supabase CLI metadata unavailable.');
}

function resolveServiceRoleKey(repoRoot: string, projectRef: string): string {
  const fromEnv = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (fromEnv) return fromEnv;

  let payload: unknown;
  try {
    payload = runSupabaseCliJson(repoRoot, [
      'projects',
      'api-keys',
      '--project-ref',
      projectRef,
      '--reveal',
      '--output-format',
      'json',
    ]);
  } catch {
    throw new Error(
      'Missing SUPABASE_SERVICE_ROLE_KEY and authenticated Supabase CLI API-key access.',
    );
  }
  if (!isRecord(payload) || !Array.isArray(payload.keys)) {
    throw new Error('Supabase CLI returned an unsupported API-key metadata shape.');
  }
  for (const raw of payload.keys) {
    if (!isRecord(raw) || typeof raw.api_key !== 'string') continue;
    const serviceRole = raw.id === 'service_role'
      || (
        raw.type === 'secret'
        && isRecord(raw.secret_jwt_template)
        && raw.secret_jwt_template.role === 'service_role'
      );
    const key = raw.api_key.trim();
    if (serviceRole && key.length >= 32 && key.length <= 4096) return key;
  }
  throw new Error('Supabase CLI did not return a usable service-role API key.');
}

async function buildNetworkProductionChecks(
  supabaseUrl: string,
  appOrigin: string,
): Promise<SwanBotOpenSwanProductionContractCheck[]> {
  const checks = [await verifyAppOrigin(appOrigin)];
  for (const requirement of REQUIRED_EDGE_FUNCTIONS) {
    checks.push(await verifyFunctionCors(supabaseUrl, appOrigin, requirement.slug));
  }
  return checks;
}

async function verifyAppOrigin(appOrigin: string): Promise<SwanBotOpenSwanProductionContractCheck> {
  try {
    const response = await fetchWithTimeout(appOrigin, { method: 'GET', redirect: 'follow' });
    await response.body?.cancel();
    const contentType = response.headers.get('content-type') || '';
    const ok = response.ok && contentType.toLowerCase().includes('text/html');
    return {
      id: 'web.production_origin',
      label: 'production OpenSwan web origin',
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `HTTP ${response.status} returned HTML.`
        : `HTTP ${response.status} returned ${contentType || 'an unknown content type'}.`,
      recovery: 'Repair or redeploy the production web origin, then rerun the report.',
    };
  } catch {
    return {
      id: 'web.production_origin',
      label: 'production OpenSwan web origin',
      status: 'fail',
      detail: 'The production origin was unreachable within the bounded probe.',
      recovery: 'Repair or redeploy the production web origin, then rerun the report.',
    };
  }
}

async function verifyFunctionCors(
  supabaseUrl: string,
  appOrigin: string,
  slug: string,
): Promise<SwanBotOpenSwanProductionContractCheck> {
  try {
    const response = await fetchWithTimeout(`${supabaseUrl.replace(/\/$/u, '')}/functions/v1/${slug}`, {
      method: 'OPTIONS',
      headers: {
        Origin: appOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
      },
    });
    await response.body?.cancel();
    const allowOrigin = response.headers.get('access-control-allow-origin') || '';
    const allowMethods = splitHeaderTokens(response.headers.get('access-control-allow-methods'));
    const allowHeaders = splitHeaderTokens(response.headers.get('access-control-allow-headers'));
    const originOk = allowOrigin === '*' || allowOrigin === appOrigin;
    const requiredHeaders = ['authorization', 'apikey', 'content-type', 'x-client-info'];
    const ok = response.ok
      && originOk
      && allowMethods.has('options')
      && allowMethods.has('post')
      && requiredHeaders.every(header => allowHeaders.has(header));
    return {
      id: `cors.${slug}`,
      label: `${slug} browser CORS preflight`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `HTTP ${response.status} allows the production origin and required headers.`
        : `HTTP ${response.status} did not return the complete production CORS contract.`,
      recovery: `Deploy the canonical ${slug} OPTIONS handler and verify it from ${appOrigin}.`,
    };
  } catch {
    return {
      id: `cors.${slug}`,
      label: `${slug} browser CORS preflight`,
      status: 'fail',
      detail: 'The bounded browser preflight probe could not reach the function.',
      recovery: `Deploy or repair ${slug}, then rerun the production-origin CORS probe.`,
    };
  }
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function splitHeaderTokens(value: string | null): Set<string> {
  return new Set((value || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyTelemetry(minRuns: number, since: string, until: string): SwanBotOpenSwanProductionTelemetry {
  return {
    telemetry: {
      minRuns,
      v1StopReasons: {},
      v2StopReasons: {},
      missingFinalStopReason: { v1: 0, v2: 0 },
    },
    rowsScanned: 0,
    missingFinalStopReason: { v1: 0, v2: 0 },
    completeness: {
      v1: emptyCompleteness(),
      v2: emptyCompleteness(),
    },
    ignoredRows: 0,
    window: { since, until },
    warnings: [],
  };
}

function emptyCompleteness(): SwanBotOpenSwanTelemetryCompleteness {
  return {
    rows: 0,
    missingFinalStopReason: 0,
    missingToolCalls: 0,
    badIterationCount: 0,
    missingTokenFields: 0,
    zeroTokenRows: 0,
  };
}

function formatReport(args: {
  snapshot: SwanBotOpenSwanReadinessSnapshot;
  productionTelemetry: SwanBotOpenSwanProductionTelemetry;
  schema: SchemaReport;
  databaseContract: ProductionDatabaseContractReport;
  smokesPassed: boolean;
}): string {
  const { snapshot, productionTelemetry, schema, databaseContract, smokesPassed } = args;
  const lines = [
    `SwanBot/OpenSwan production readiness: ${snapshot.label} (${snapshot.score})`,
    `status: ${snapshot.status}`,
    `can_flip_default: ${snapshot.canFlipDefault ? 'yes' : 'no'}`,
    `window: ${productionTelemetry.window.since || 'none'} -> ${productionTelemetry.window.until || 'none'}`,
    `rows: ${productionTelemetry.rowsScanned} scanned, ${productionTelemetry.ignoredRows} ignored`,
    `schema: ${schema.ok ? 'ok' : 'blocked'} (${schema.checkedVia.join(', ') || 'not checked'})`,
    `production contract: ${snapshot.productionContract.summary}`,
    `smokes: ${smokesPassed ? 'assumed passed from fresh local release check' : 'unknown; run check:swanbot-v2:release and rerun with --smokes-passed'}`,
    `tool parity: ${snapshot.toolParity.summary}`,
    `telemetry: ${snapshot.telemetry.summary}`,
    `v1 completeness: ${formatCompleteness(productionTelemetry.completeness.v1)}`,
    `v2 completeness: ${formatCompleteness(productionTelemetry.completeness.v2)}`,
    `v1 stops: ${formatStopReasons(snapshot.telemetry.v1StopReasons)}`,
    `v2 stops: ${formatStopReasons(snapshot.telemetry.v2StopReasons)}`,
  ];

  appendList(lines, 'blockers', snapshot.blockers);
  appendList(lines, 'warnings', [
    ...schema.warnings,
    ...databaseContract.warnings,
    ...productionTelemetry.warnings,
    ...snapshot.warnings,
  ]);
  appendList(lines, 'next actions', snapshot.nextActions);
  return lines.join('\n');
}

function appendList(lines: string[], title: string, items: string[]): void {
  const unique = Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
  if (!unique.length) {
    lines.push(`${title}: none`);
    return;
  }
  lines.push(`${title}:`);
  lines.push(...unique.map((item) => `- ${item}`));
}

function formatCompleteness(summary: SwanBotOpenSwanTelemetryCompleteness): string {
  if (summary.rows <= 0) return 'no rows';
  return [
    `${summary.rows} rows`,
    `${summary.missingFinalStopReason} missing final_stop_reason`,
    `${summary.missingToolCalls} missing tool_calls`,
    `${summary.badIterationCount} bad iteration_count`,
    `${summary.missingTokenFields} missing token fields`,
    `${summary.zeroTokenRows} zero-token rows`,
  ].join(', ');
}

function formatStopReasons(summary: SwanBotOpenSwanReadinessSnapshot['telemetry']['v1StopReasons']): string {
  if (summary.total <= 0) return 'none';
  return summary.breakdown
    .slice(0, 5)
    .map((entry) => `${entry.reason}:${entry.count}`)
    .join(', ');
}

async function main(): Promise<void> {
  try {
    const options = parseArgs(process.argv.slice(2));
    loadEnvFiles(options.repoRoot);

    const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error('Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL.');
    const appOrigin = parseHttpOrigin(
      options.appOrigin || process.env.OPENSWAN_APP_ORIGIN || DEFAULT_APP_ORIGIN,
      'OpenSwan app origin',
    );
    const projectRef = deriveProjectRef(supabaseUrl);
    const serviceKey = resolveServiceRoleKey(options.repoRoot, projectRef);

    const window = buildWindow(options);
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const schema = await verifyAgentRunsSchema(supabase as any);
    const databaseContract = await verifyProductionDatabaseContract(supabase as any);
    if (databaseContract.checks.some(
      check => check.id === 'database.agent_run_contract' && check.status === 'pass',
    )) {
      schema.checkedVia.push('service-role readiness contract');
      schema.warnings = schema.warnings.filter(
        warning => !warning.startsWith('information_schema type check unavailable:'),
      );
    }
    const managementChecks = buildManagementProductionChecks(options.repoRoot, projectRef);
    const networkChecks = await buildNetworkProductionChecks(supabaseUrl, appOrigin);
    const productionChecks = [
      ...databaseContract.checks,
      ...managementChecks,
      ...networkChecks,
    ];
    const parity = deriveToolParity(options.repoRoot);
    const blockers = [...schema.blockers, ...parity.blockers];
    let productionTelemetry = emptyTelemetry(options.minRuns, window.since, window.until);

    if (schema.ok) {
      try {
        productionTelemetry = await loadSwanBotOpenSwanAgentRunTelemetry({
          circleId: options.circleId,
          since: window.since,
          until: window.until,
          minRuns: options.minRuns,
          pageSize: options.pageSize,
        }, supabase as any);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        blockers.push(`Production telemetry query failed: ${message}`);
      }
    }

    const snapshot = buildSwanBotOpenSwanReadinessSnapshot({
      v2ToolCatalogCount: parity.total,
      serverToolCount: parity.server,
      clientDelegatedToolCount: parity.clientDelegated,
      requiredSmokes: buildSmokeChecks(options),
      telemetry: productionTelemetry.telemetry,
      telemetryCompleteness: productionTelemetry.completeness,
      productionContract: {
        required: true,
        checks: productionChecks,
      },
      blockers,
    });

    if (options.outputFormat === 'json') {
      console.log(JSON.stringify({
        snapshot,
        productionTelemetry,
        schema,
        databaseContract,
        productionChecks,
        smokesAssumedPassed: options.smokesPassed,
        circleId: options.circleId || null,
        projectRef,
        appOrigin,
      }, null, 2));
    } else if (options.outputFormat === 'prompt') {
      console.log(formatSwanBotOpenSwanReadinessPromptBlock(snapshot));
    } else {
      console.log(formatReport({
        snapshot,
        productionTelemetry,
        schema,
        databaseContract,
        smokesPassed: options.smokesPassed,
      }));
    }

    if (snapshot.status === 'blocked' && options.failOnBlocked) process.exit(2);
    if (!snapshot.canFlipDefault && options.failOnNotReady) process.exit(snapshot.status === 'blocked' ? 2 : 3);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[swanbot-openswan-readiness-report] ${message}`);
    process.exit(1);
  }
}

main();
