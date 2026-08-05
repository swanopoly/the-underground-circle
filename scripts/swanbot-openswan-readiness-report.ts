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

const ENV_FILES = ['.env', '.env.local', '.env.production', 'supabase/.env'];
const REQUIRED_AGENT_RUN_COLUMNS: SchemaColumnRequirement[] = [
  { column: 'tool_calls', expectedType: 'jsonb' },
  { column: 'iteration_count', expectedType: 'integer' },
  { column: 'final_stop_reason', expectedType: 'text' },
  { column: 'input_tokens', expectedType: 'bigint' },
  { column: 'output_tokens', expectedType: 'bigint' },
  { column: 'cached_tokens', expectedType: 'bigint' },
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
    '  SUPABASE_SERVICE_ROLE_KEY',
    '',
    'Options:',
    '  --circle <uuid>          Limit telemetry to one circle.',
    '  --since <iso/date>       Start of telemetry window. Defaults to --days ago.',
    '  --until <iso/date>       End of telemetry window. Defaults to now.',
    '  --days <n>               Window size when --since is omitted. Default: 7.',
    '  --min-runs <n>           Required v1/v2 sample count. Default: 50.',
    '  --page-size <n>          Supabase page size. Default: 500.',
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
  smokesPassed: boolean;
}): string {
  const { snapshot, productionTelemetry, schema, smokesPassed } = args;
  const lines = [
    `SwanBot/OpenSwan production readiness: ${snapshot.label} (${snapshot.score})`,
    `status: ${snapshot.status}`,
    `can_flip_default: ${snapshot.canFlipDefault ? 'yes' : 'no'}`,
    `window: ${productionTelemetry.window.since || 'none'} -> ${productionTelemetry.window.until || 'none'}`,
    `rows: ${productionTelemetry.rowsScanned} scanned, ${productionTelemetry.ignoredRows} ignored`,
    `schema: ${schema.ok ? 'ok' : 'blocked'} (${schema.checkedVia.join(', ') || 'not checked'})`,
    `smokes: ${smokesPassed ? 'assumed passed from fresh local release check' : 'unknown; run check:swanbot-v2:release and rerun with --smokes-passed'}`,
    `tool parity: ${snapshot.toolParity.summary}`,
    `telemetry: ${snapshot.telemetry.summary}`,
    `v1 completeness: ${formatCompleteness(productionTelemetry.completeness.v1)}`,
    `v2 completeness: ${formatCompleteness(productionTelemetry.completeness.v2)}`,
    `v1 stops: ${formatStopReasons(snapshot.telemetry.v1StopReasons)}`,
    `v2 stops: ${formatStopReasons(snapshot.telemetry.v2StopReasons)}`,
  ];

  appendList(lines, 'blockers', snapshot.blockers);
  appendList(lines, 'warnings', [...schema.warnings, ...productionTelemetry.warnings, ...snapshot.warnings]);
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
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      throw new Error('Missing SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL plus SUPABASE_SERVICE_ROLE_KEY.');
    }

    const window = buildWindow(options);
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const schema = await verifyAgentRunsSchema(supabase as any);
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
      blockers,
    });

    if (options.outputFormat === 'json') {
      console.log(JSON.stringify({
        snapshot,
        productionTelemetry,
        schema,
        smokesAssumedPassed: options.smokesPassed,
        circleId: options.circleId || null,
      }, null, 2));
    } else if (options.outputFormat === 'prompt') {
      console.log(formatSwanBotOpenSwanReadinessPromptBlock(snapshot));
    } else {
      console.log(formatReport({
        snapshot,
        productionTelemetry,
        schema,
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
