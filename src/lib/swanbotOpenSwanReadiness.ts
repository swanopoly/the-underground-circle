export type SwanBotOpenSwanReadinessStatus = 'ready' | 'watch' | 'blocked';
export type SwanBotOpenSwanSmokeStatus = 'pass' | 'fail' | 'missing' | 'unknown';
export type SwanBotOpenSwanAgentRunVersion = 'swanbot-ai' | 'swanbot-v2-ai';
export type SwanBotOpenSwanTelemetrySide = 'v1' | 'v2';

export interface SwanBotOpenSwanSmokeCheck {
  id: string;
  command: string;
  status: SwanBotOpenSwanSmokeStatus;
  detail?: string;
}

export interface SwanBotOpenSwanTelemetryInput {
  v1EndTurnRate?: number | null;
  v2EndTurnRate?: number | null;
  v1RunCount?: number;
  v2RunCount?: number;
  minRuns?: number;
  v1StopReasons?: SwanBotOpenSwanStopReasonCounts;
  v2StopReasons?: SwanBotOpenSwanStopReasonCounts;
  missingFinalStopReason?: Partial<Record<SwanBotOpenSwanTelemetrySide, number>>;
}

export interface SwanBotOpenSwanAgentRunTelemetryRow {
  id?: string;
  circle_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  status?: string | null;
  surface?: string | null;
  final_stop_reason?: string | null;
  tool_calls?: unknown;
  iteration_count?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface SwanBotOpenSwanTelemetryReadOptions {
  circleId?: string;
  since?: string;
  until?: string;
  minRuns?: number;
  pageSize?: number;
}

export interface SwanBotOpenSwanProductionTelemetry {
  telemetry: SwanBotOpenSwanTelemetryInput;
  rowsScanned: number;
  missingFinalStopReason: Record<SwanBotOpenSwanTelemetrySide, number>;
  completeness: Record<SwanBotOpenSwanTelemetrySide, SwanBotOpenSwanTelemetryCompleteness>;
  ignoredRows: number;
  window: { since: string | null; until: string | null };
  warnings: string[];
}

export interface SwanBotOpenSwanTelemetryCompleteness {
  rows: number;
  missingFinalStopReason: number;
  missingToolCalls: number;
  badIterationCount: number;
  missingTokenFields: number;
  zeroTokenRows: number;
}

export interface SwanBotOpenSwanReadinessInput {
  v2EnabledDefault?: boolean;
  v2ToolCatalogCount?: number;
  serverToolCount?: number;
  clientDelegatedToolCount?: number;
  requiredSmokes?: SwanBotOpenSwanSmokeCheck[];
  telemetry?: SwanBotOpenSwanTelemetryInput;
  telemetryCompleteness?: Partial<Record<SwanBotOpenSwanTelemetrySide, Partial<SwanBotOpenSwanTelemetryCompleteness>>>;
  blockers?: string[];
}

export interface SwanBotOpenSwanToolParity {
  expectedTotal: number;
  expectedClientDelegated: number;
  actualTotal: number;
  actualServer: number;
  actualClientDelegated: number;
  ok: boolean;
  summary: string;
}

export type SwanBotOpenSwanStopReasonCounts =
  | Record<string, number>
  | Array<{ reason?: string | null; count?: number | null }>;

export interface SwanBotOpenSwanStopReasonBreakdownEntry {
  reason: string;
  count: number;
  rate: number;
}

export interface SwanBotOpenSwanStopReasonSummary {
  total: number;
  endTurnCount: number;
  nonEndTurnCount: number;
  nonEndTurnRate: number | null;
  topNonEndTurnReason: string | null;
  topNonEndTurnCount: number;
  breakdown: SwanBotOpenSwanStopReasonBreakdownEntry[];
  summary: string;
}

export interface SwanBotOpenSwanTelemetrySnapshot {
  minRuns: number;
  v1RunCount: number;
  v2RunCount: number;
  v1EnoughSamples: boolean;
  v2EnoughSamples: boolean;
  v1EndTurnRate: number | null;
  v2EndTurnRate: number | null;
  v1StopReasons: SwanBotOpenSwanStopReasonSummary;
  v2StopReasons: SwanBotOpenSwanStopReasonSummary;
  missingFinalStopReason: Record<SwanBotOpenSwanTelemetrySide, number>;
  enoughSamples: boolean;
  rateComparable: boolean;
  ok: boolean;
  summary: string;
}

export interface SwanBotOpenSwanReadinessSnapshot {
  status: SwanBotOpenSwanReadinessStatus;
  score: number;
  label: string;
  summary: string;
  canFlipDefault: boolean;
  defaultAlreadyEnabled: boolean;
  blockers: string[];
  warnings: string[];
  nextActions: string[];
  requiredSmokes: SwanBotOpenSwanSmokeCheck[];
  toolParity: SwanBotOpenSwanToolParity;
  telemetry: SwanBotOpenSwanTelemetrySnapshot;
}

// Expected counts are pinned against the live `swanbot-v2-ai` TOOLS array by
// the readiness smoke via deriveSwanbotV2ToolParityFromSource — if the edge
// catalog grows or shrinks, the smoke fails until these are re-pinned here.
// (Re-pinned 2026-06-26: v2 exposes 73 tools, 48 of them client-delegated.)
export const SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL = 73;
export const SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS = 48;
export const SWANBOT_OPENSWAN_DEFAULT_MIN_TELEMETRY_RUNS = 50;

export const SWANBOT_OPENSWAN_REQUIRED_SMOKES: SwanBotOpenSwanSmokeCheck[] = [
  { id: 'swanbot-routing', command: 'npm run smoke:swanbot-routing', status: 'unknown' },
  { id: 'swanbot-v2-delegation', command: 'npm run smoke:swanbot-v2-delegation', status: 'unknown' },
  { id: 'swanbot-v2-continuation', command: 'npm run smoke:swanbot-v2-continuation', status: 'unknown' },
  { id: 'swanbot-v2-writers', command: 'npm run smoke:swanbot-v2-writers', status: 'unknown' },
  { id: 'swanbot-v2-workspace', command: 'npm run smoke:swanbot-v2-workspace', status: 'unknown' },
  { id: 'swanbot-v2-approvals', command: 'npm run smoke:swanbot-v2-approvals', status: 'unknown' },
  { id: 'swanbot-v2-wp', command: 'npm run smoke:swanbot-v2-wp', status: 'unknown' },
  { id: 'swanbot-v2-dispatcher-parity', command: 'npm run smoke:swanbot-v2-dispatcher-parity', status: 'unknown' },
  { id: 'swanbot-v2-stop-reason', command: 'npm run smoke:swanbot-v2-stop-reason', status: 'unknown' },
  { id: 'wordpress-admin-source-intelligence', command: 'npm run smoke:wordpress-admin-source-intelligence', status: 'unknown' },
  { id: 'openswan-runtime-approval', command: 'npm run smoke:openswan-runtime-approval', status: 'unknown' },
  { id: 'openswan-task-planner', command: 'npm run smoke:openswan-task-planner', status: 'unknown' },
  { id: 'agent-failure-recovery', command: 'npm run smoke:agent-failure-recovery', status: 'unknown' },
];

export interface SwanbotV2DerivedToolParity {
  total: number;
  server: number;
  clientDelegated: number;
}

type SupabaseQueryLike = {
  select: (columns: string) => SupabaseQueryLike;
  eq: (column: string, value: unknown) => SupabaseQueryLike;
  gte: (column: string, value: unknown) => SupabaseQueryLike;
  lt: (column: string, value: unknown) => SupabaseQueryLike;
  order: (column: string, options?: Record<string, unknown>) => SupabaseQueryLike;
  range: (from: number, to: number) => Promise<{ data?: SwanBotOpenSwanAgentRunTelemetryRow[] | null; error?: { message?: string } | null }>;
};

type SupabaseClientLike = {
  from: (table: string) => SupabaseQueryLike;
};

/**
 * Derives the REAL tool counts from the `swanbot-v2-ai` edge-function source.
 *
 * The edge function is Deno-only (https imports), so smoke scripts cannot
 * import it directly; this textual derivation is the parity ground truth the
 * R16 readiness check runs against. Counting rules (pinned by the readiness
 * smoke against the live file):
 * - every tool object in the `TOOLS` array has exactly one `input_schema:` key
 *   (nested schema properties never use that name), so total = input_schema count;
 * - client-delegated tools are either inside a `...[ ... ].map((spec) => ({`
 *   group whose decoration sets `clientOnly: true`, or carry an inline
 *   `clientOnly: true` line of their own.
 */
export function deriveSwanbotV2ToolParityFromSource(source: string): SwanbotV2DerivedToolParity {
  const lines = source.split('\n');
  const startIdx = lines.findIndex(line => /const TOOLS:\s*ToolDef\[\]\s*=\s*\[/.test(line));
  if (startIdx < 0) {
    throw new Error('deriveSwanbotV2ToolParityFromSource: `const TOOLS: ToolDef[] = [` not found');
  }
  let endIdx = -1;
  for (let i = startIdx + 1; i < lines.length; i += 1) {
    if (/^\];\s*$/.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    throw new Error('deriveSwanbotV2ToolParityFromSource: TOOLS array terminator `];` not found');
  }

  let total = 0;
  let clientDelegated = 0;
  let inGroup = false;
  let groupToolCount = 0;

  for (let i = startIdx + 1; i < endIdx; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    if (/^\.\.\.\[\s*$/.test(trimmed)) {
      inGroup = true;
      groupToolCount = 0;
      continue;
    }

    if (/^\]\.map\(\(spec\)/.test(trimmed) && inGroup) {
      // Scan the map decoration (up to its `satisfies ToolDef)),` close) for
      // the clientOnly flag, then skip past it so the decoration's own
      // `clientOnly: true` line is not double-counted as an inline marker.
      let decorationEnd = Math.min(i + 15, endIdx - 1);
      for (let j = i; j <= decorationEnd; j += 1) {
        if (/satisfies ToolDef\)\),\s*$/.test(lines[j].trim())) {
          decorationEnd = j;
          break;
        }
      }
      const decoration = lines.slice(i, decorationEnd + 1).join('\n');
      if (/clientOnly:\s*true/.test(decoration)) {
        clientDelegated += groupToolCount;
      }
      inGroup = false;
      groupToolCount = 0;
      i = decorationEnd;
      continue;
    }

    if (/(^|\s)input_schema:/.test(trimmed)) {
      total += 1;
      if (inGroup) groupToolCount += 1;
      continue;
    }

    if (/^clientOnly:\s*true,?$/.test(trimmed) && !inGroup) {
      clientDelegated += 1;
    }
  }

  return { total, server: total - clientDelegated, clientDelegated };
}

export function buildSwanBotOpenSwanTelemetryInputFromAgentRunRows(
  rows: SwanBotOpenSwanAgentRunTelemetryRow[],
  opts: { minRuns?: number } = {},
): SwanBotOpenSwanProductionTelemetry {
  const v1StopReasons: Record<string, number> = {};
  const v2StopReasons: Record<string, number> = {};
  const missingFinalStopReason: Record<SwanBotOpenSwanTelemetrySide, number> = { v1: 0, v2: 0 };
  const completeness: Record<SwanBotOpenSwanTelemetrySide, SwanBotOpenSwanTelemetryCompleteness> = {
    v1: emptyTelemetryCompleteness(),
    v2: emptyTelemetryCompleteness(),
  };
  const warnings: string[] = [];
  let ignoredRows = 0;
  let activePendingRows = 0;

  for (const row of rows || []) {
    if (row.surface && row.surface !== 'main_chat') {
      ignoredRows += 1;
      continue;
    }
    const version = getAgentRunVersion(row);
    const side = version === 'swanbot-ai'
      ? 'v1'
      : version === 'swanbot-v2-ai'
        ? 'v2'
        : null;
    if (!side) {
      ignoredRows += 1;
      continue;
    }

    const rawReason = row.final_stop_reason;
    const reason = normalizeStopReason(rawReason);
    if (row.status === 'running' && reason === 'client_pending') {
      ignoredRows += 1;
      activePendingRows += 1;
      continue;
    }
    const sideCompleteness = completeness[side];
    sideCompleteness.rows += 1;
    if (typeof rawReason !== 'string' || rawReason.trim().length === 0) {
      missingFinalStopReason[side] += 1;
      sideCompleteness.missingFinalStopReason += 1;
    }
    if (row.tool_calls == null) {
      sideCompleteness.missingToolCalls += 1;
    }
    if (!isPositiveIntegerLike(row.iteration_count)) {
      sideCompleteness.badIterationCount += 1;
    }
    if (row.input_tokens == null || row.output_tokens == null || row.cached_tokens == null) {
      sideCompleteness.missingTokenFields += 1;
    } else if (Number(row.input_tokens) === 0 && Number(row.output_tokens) === 0 && Number(row.cached_tokens) === 0) {
      sideCompleteness.zeroTokenRows += 1;
    }

    const target = side === 'v1' ? v1StopReasons : v2StopReasons;
    target[reason] = (target[reason] || 0) + 1;
  }

  if (activePendingRows > 0) {
    warnings.push(`Ignored ${activePendingRows} active client_pending SwanBot run${activePendingRows === 1 ? '' : 's'}; readiness counts terminal rows only.`);
  }
  const ignoredNonPendingRows = ignoredRows - activePendingRows;
  if (ignoredNonPendingRows > 0) {
    warnings.push(`Ignored ${ignoredNonPendingRows} non-SwanBot agent_run row${ignoredNonPendingRows === 1 ? '' : 's'}.`);
  }

  return {
    telemetry: {
      minRuns: opts.minRuns,
      v1StopReasons,
      v2StopReasons,
      missingFinalStopReason,
    },
    rowsScanned: rows.length,
    missingFinalStopReason,
    completeness,
    ignoredRows,
    window: { since: null, until: null },
    warnings,
  };
}

export async function loadSwanBotOpenSwanAgentRunTelemetry(
  opts: SwanBotOpenSwanTelemetryReadOptions = {},
  client?: SupabaseClientLike,
): Promise<SwanBotOpenSwanProductionTelemetry> {
  const supabaseClient = client || await loadDefaultSupabaseClient();
  const pageSize = clamp(Math.floor(opts.pageSize || 500), 1, 1000);
  const rows: SwanBotOpenSwanAgentRunTelemetryRow[] = [];

  for (const version of ['swanbot-ai', 'swanbot-v2-ai'] as const) {
    let offset = 0;
    while (true) {
      let query = supabaseClient
        .from('agent_runs')
        .select('id, circle_id, started_at, completed_at, status, surface, final_stop_reason, tool_calls, iteration_count, input_tokens, output_tokens, cached_tokens, metadata')
        .eq('metadata->>version', version)
        .eq('surface', 'main_chat');
      if (opts.circleId) query = query.eq('circle_id', opts.circleId);
      if (opts.since) query = query.gte('started_at', opts.since);
      if (opts.until) query = query.lt('started_at', opts.until);

      const { data, error } = await query
        .order('started_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (error) {
        throw new Error(error.message || `Failed to load SwanBot ${version} telemetry`);
      }

      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }

  const result = buildSwanBotOpenSwanTelemetryInputFromAgentRunRows(rows, { minRuns: opts.minRuns });
  return {
    ...result,
    window: {
      since: opts.since || null,
      until: opts.until || null,
    },
  };
}

export function buildSwanBotOpenSwanReadinessSnapshot(
  input: SwanBotOpenSwanReadinessInput = {},
): SwanBotOpenSwanReadinessSnapshot {
  const requiredSmokes = mergeRequiredSmokes(input.requiredSmokes);
  const toolParity = buildToolParity(input);
  const telemetry = buildTelemetrySnapshot(input.telemetry);
  const blockers = normalizeMessages(input.blockers);
  const warnings: string[] = [];
  const nextActions: string[] = [];

  for (const smoke of requiredSmokes) {
    if (smoke.status === 'fail') {
      blockers.push(`${smoke.command} is failing${smoke.detail ? `: ${smoke.detail}` : ''}.`);
    } else if (smoke.status === 'missing') {
      blockers.push(`${smoke.command} is missing from the SwanBot/OpenSwan readiness suite.`);
    } else if (smoke.status === 'unknown') {
      warnings.push(`${smoke.command} has not been verified in this readiness snapshot.`);
    }
  }

  if (!toolParity.ok) {
    blockers.push(toolParity.summary);
  }

  const completeness = buildTelemetryCompletenessAssessment(input.telemetryCompleteness);
  blockers.push(...completeness.blockers);
  warnings.push(...completeness.warnings);

  if (!telemetry.enoughSamples) {
    warnings.push(telemetry.summary);
  } else if (!telemetry.rateComparable) {
    blockers.push(telemetry.summary);
  }

  if (input.v2EnabledDefault && blockers.length > 0) {
    blockers.push('SwanBot v2 is already default-enabled while readiness blockers remain.');
  }

  if (blockers.length > 0) {
    nextActions.push('Keep v1 fallback available and fix the blocking smoke, parity, or telemetry item first.');
  }

  if (!toolParity.ok) {
    nextActions.push('Reconcile the v2 tool catalog with the OpenSwan runtime catalog before changing defaults.');
  }

  const failedOrMissingSmoke = requiredSmokes.find(smoke => smoke.status === 'fail' || smoke.status === 'missing');
  if (failedOrMissingSmoke) {
    nextActions.push(`Start with ${failedOrMissingSmoke.command}; it is the first blocking smoke.`);
  }

  const unknownSmoke = requiredSmokes.find(smoke => smoke.status === 'unknown');
  if (!failedOrMissingSmoke && unknownSmoke) {
    nextActions.push('Run the full SwanBot/OpenSwan readiness smoke suite and refresh this snapshot.');
  }

  if (telemetry.enoughSamples && !telemetry.rateComparable) {
    nextActions.push(buildTelemetryRepairAction(telemetry));
  } else if (!telemetry.enoughSamples) {
    nextActions.push(`Collect at least ${telemetry.minRuns} v1 and v2 runs with final_stop_reason telemetry before M4.`);
  }

  const allSmokesPass = requiredSmokes.every(smoke => smoke.status === 'pass');
  const status: SwanBotOpenSwanReadinessStatus = blockers.length > 0
    ? 'blocked'
    : allSmokesPass && toolParity.ok && telemetry.ok
      ? 'ready'
      : 'watch';
  const score = scoreReadiness({ status, requiredSmokes, toolParity, telemetry, blockers, warnings });
  const canFlipDefault = status === 'ready';
  const label = status === 'ready'
    ? 'READY TO FLIP'
    : status === 'watch'
      ? 'WATCH TELEMETRY'
      : 'BLOCKED';
  const summary = buildSummary({ status, toolParity, telemetry, requiredSmokes, blockers, warnings });

  if (canFlipDefault) {
    nextActions.push('Flip the v2 default behind the documented rollback path, then keep v1 opt-out available.');
  }

  return {
    status,
    score,
    label,
    summary,
    canFlipDefault,
    defaultAlreadyEnabled: input.v2EnabledDefault === true,
    blockers: uniqueMessages(blockers),
    warnings: uniqueMessages(warnings),
    nextActions: uniqueMessages(nextActions),
    requiredSmokes,
    toolParity,
    telemetry,
  };
}

export function formatSwanBotOpenSwanReadinessPromptBlock(
  snapshot: SwanBotOpenSwanReadinessSnapshot,
): string {
  const smokeSummary = snapshot.requiredSmokes
    .map(smoke => `${smoke.id}:${smoke.status}`)
    .join(', ');
  const blockers = snapshot.blockers.length ? snapshot.blockers.join(' | ') : 'none';
  const warnings = snapshot.warnings.length ? snapshot.warnings.join(' | ') : 'none';
  const actions = snapshot.nextActions.length ? snapshot.nextActions.join(' | ') : 'none';

  return [
    '## SwanBot/OpenSwan Readiness',
    `status: ${snapshot.status}`,
    `label: ${snapshot.label}`,
    `score: ${snapshot.score}`,
    `can_flip_default: ${snapshot.canFlipDefault ? 'yes' : 'no'}`,
    `default_already_enabled: ${snapshot.defaultAlreadyEnabled ? 'yes' : 'no'}`,
    `tool_parity: ${snapshot.toolParity.summary}`,
    `telemetry: ${snapshot.telemetry.summary}`,
    `stop_reasons: ${formatStopReasonPromptLine(snapshot.telemetry.v2StopReasons)}`,
    `smokes: ${smokeSummary}`,
    `blockers: ${blockers}`,
    `warnings: ${warnings}`,
    `next_actions: ${actions}`,
  ].join('\n');
}

function mergeRequiredSmokes(overrides: SwanBotOpenSwanSmokeCheck[] | undefined): SwanBotOpenSwanSmokeCheck[] {
  const byId = new Map<string, SwanBotOpenSwanSmokeCheck>();

  for (const smoke of SWANBOT_OPENSWAN_REQUIRED_SMOKES) {
    byId.set(smoke.id, { ...smoke });
  }

  for (const smoke of overrides || []) {
    const base = byId.get(smoke.id);
    byId.set(smoke.id, {
      id: smoke.id,
      command: smoke.command || base?.command || smoke.id,
      status: smoke.status,
      detail: smoke.detail,
    });
  }

  return Array.from(byId.values());
}

function buildToolParity(input: SwanBotOpenSwanReadinessInput): SwanBotOpenSwanToolParity {
  const actualServer = Math.max(0, input.serverToolCount ?? 0);
  const actualClientDelegated = Math.max(0, input.clientDelegatedToolCount ?? 0);
  const actualTotal = Math.max(0, input.v2ToolCatalogCount ?? (actualServer + actualClientDelegated));
  const ok = actualTotal >= SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL
    && actualClientDelegated >= SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS;
  const summary = ok
    ? `${actualTotal}/${SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL} tools with ${actualClientDelegated}/${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS} client-delegated tools.`
    : `Tool parity incomplete: ${actualTotal}/${SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL} tools and ${actualClientDelegated}/${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS} client-delegated tools.`;

  return {
    expectedTotal: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
    expectedClientDelegated: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
    actualTotal,
    actualServer,
    actualClientDelegated,
    ok,
    summary,
  };
}

function buildTelemetrySnapshot(input: SwanBotOpenSwanTelemetryInput | undefined): SwanBotOpenSwanTelemetrySnapshot {
  const minRuns = Math.max(1, input?.minRuns ?? SWANBOT_OPENSWAN_DEFAULT_MIN_TELEMETRY_RUNS);
  const v1StopReasons = summarizeStopReasons(input?.v1StopReasons);
  const v2StopReasons = summarizeStopReasons(input?.v2StopReasons);
  const v1RunCount = Math.max(0, input?.v1RunCount ?? v1StopReasons.total);
  const v2RunCount = Math.max(0, input?.v2RunCount ?? v2StopReasons.total);
  const v1EnoughSamples = v1RunCount >= minRuns;
  const v2EnoughSamples = v2RunCount >= minRuns;
  const v1EndTurnRate = normalizeRate(input?.v1EndTurnRate) ?? deriveEndTurnRate(v1StopReasons);
  const v2EndTurnRate = normalizeRate(input?.v2EndTurnRate) ?? deriveEndTurnRate(v2StopReasons);
  const missingFinalStopReason = {
    v1: Math.max(0, input?.missingFinalStopReason?.v1 ?? 0),
    v2: Math.max(0, input?.missingFinalStopReason?.v2 ?? 0),
  };
  const enoughSamples = v1EnoughSamples && v2EnoughSamples;
  const rateComparable = v1EndTurnRate === null || v2EndTurnRate === null
    ? false
    : v2EndTurnRate >= v1EndTurnRate;
  const ok = enoughSamples && rateComparable;
  const summary = !enoughSamples
    ? `Telemetry needs ${minRuns} v1 and v2 runs before default flip; currently v1=${v1RunCount}, v2=${v2RunCount}.`
    : rateComparable
      ? `v2 end-turn rate ${(v2EndTurnRate ?? 0).toFixed(3)} is >= v1 ${(v1EndTurnRate ?? 0).toFixed(3)} across ${v1RunCount} v1 / ${v2RunCount} v2 runs.`
      : `v2 end-turn rate ${(v2EndTurnRate ?? 0).toFixed(3)} is below v1 ${(v1EndTurnRate ?? 0).toFixed(3)}.`;

  return {
    minRuns,
    v1RunCount,
    v2RunCount,
    v1EnoughSamples,
    v2EnoughSamples,
    v1EndTurnRate,
    v2EndTurnRate,
    v1StopReasons,
    v2StopReasons,
    missingFinalStopReason,
    enoughSamples,
    rateComparable,
    ok,
    summary,
  };
}

function summarizeStopReasons(input: SwanBotOpenSwanStopReasonCounts | undefined): SwanBotOpenSwanStopReasonSummary {
  const counts = normalizeStopReasonCounts(input);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  const endTurnCount = counts
    .filter(entry => normalizeStopReason(entry.reason) === 'end_turn')
    .reduce((sum, entry) => sum + entry.count, 0);
  const nonEndTurnCount = Math.max(0, total - endTurnCount);
  const nonEndTurnBreakdown = counts
    .filter(entry => normalizeStopReason(entry.reason) !== 'end_turn')
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const top = nonEndTurnBreakdown[0] || null;
  const breakdown = counts
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .map(entry => ({
      reason: entry.reason,
      count: entry.count,
      rate: total > 0 ? entry.count / total : 0,
    }));
  const summary = total === 0
    ? 'No final_stop_reason breakdown provided.'
    : top
      ? `${top.reason} is the top non-end_turn stop reason (${top.count}/${total}).`
      : `All ${total} runs ended with end_turn.`;

  return {
    total,
    endTurnCount,
    nonEndTurnCount,
    nonEndTurnRate: total > 0 ? nonEndTurnCount / total : null,
    topNonEndTurnReason: top?.reason || null,
    topNonEndTurnCount: top?.count || 0,
    breakdown,
    summary,
  };
}

function normalizeStopReasonCounts(input: SwanBotOpenSwanStopReasonCounts | undefined): Array<{ reason: string; count: number }> {
  if (!input) return [];
  const rawEntries = Array.isArray(input)
    ? input.map(entry => ({ reason: entry.reason, count: entry.count }))
    : Object.entries(input).map(([reason, count]) => ({ reason, count }));
  const merged = new Map<string, number>();

  for (const entry of rawEntries) {
    const reason = normalizeStopReason(entry.reason);
    const count = typeof entry.count === 'number' && Number.isFinite(entry.count)
      ? Math.max(0, Math.floor(entry.count))
      : 0;
    if (count <= 0) continue;
    merged.set(reason, (merged.get(reason) || 0) + count);
  }

  return Array.from(merged.entries()).map(([reason, count]) => ({ reason, count }));
}

function emptyTelemetryCompleteness(): SwanBotOpenSwanTelemetryCompleteness {
  return {
    rows: 0,
    missingFinalStopReason: 0,
    missingToolCalls: 0,
    badIterationCount: 0,
    missingTokenFields: 0,
    zeroTokenRows: 0,
  };
}

function buildTelemetryCompletenessAssessment(
  input: SwanBotOpenSwanReadinessInput['telemetryCompleteness'],
): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input) return { blockers, warnings };

  for (const side of ['v1', 'v2'] as const) {
    const summary = input[side];
    const rows = Math.max(0, Math.floor(Number(summary?.rows || 0)));
    if (rows <= 0) continue;
    const missingFinalStopReason = Math.max(0, Math.floor(Number(summary?.missingFinalStopReason || 0)));
    const missingToolCalls = Math.max(0, Math.floor(Number(summary?.missingToolCalls || 0)));
    const badIterationCount = Math.max(0, Math.floor(Number(summary?.badIterationCount || 0)));
    const missingTokenFields = Math.max(0, Math.floor(Number(summary?.missingTokenFields || 0)));
    const zeroTokenRows = Math.max(0, Math.floor(Number(summary?.zeroTokenRows || 0)));

    if (missingFinalStopReason > 0) {
      blockers.push(`${side} agent_runs telemetry is missing final_stop_reason on ${missingFinalStopReason}/${rows} row(s).`);
    }
    if (missingToolCalls > 0) {
      blockers.push(`${side} agent_runs telemetry is missing tool_calls on ${missingToolCalls}/${rows} row(s).`);
    }
    if (badIterationCount > 0) {
      blockers.push(`${side} agent_runs telemetry is missing valid iteration_count on ${badIterationCount}/${rows} row(s).`);
    }
    if (missingTokenFields > 0) {
      blockers.push(`${side} agent_runs telemetry is missing token fields on ${missingTokenFields}/${rows} row(s).`);
    }
    if (zeroTokenRows > 0) {
      warnings.push(`${side} agent_runs telemetry has ${zeroTokenRows}/${rows} zero-token row(s); review errors or pre-model failures before using spend parity.`);
    }
  }

  return { blockers, warnings };
}

function isPositiveIntegerLike(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return Math.floor(value) === value && value >= 1;
}

function normalizeStopReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim().toLowerCase() : '';
  return text || 'unknown';
}

function deriveEndTurnRate(summary: SwanBotOpenSwanStopReasonSummary): number | null {
  if (summary.total <= 0) return null;
  return clamp(summary.endTurnCount / summary.total, 0, 1);
}

function buildTelemetryRepairAction(telemetry: SwanBotOpenSwanTelemetrySnapshot): string {
  const topReason = telemetry.v2StopReasons.topNonEndTurnReason;
  if (!topReason) {
    return 'Compare failed v2 runs against v1 traces and repair the highest-volume stop reason.';
  }
  return `Repair v2 final_stop_reason="${topReason}" first (${telemetry.v2StopReasons.topNonEndTurnCount}/${telemetry.v2StopReasons.total} v2 runs), then recompare against v1 traces.`;
}

function formatStopReasonPromptLine(summary: SwanBotOpenSwanStopReasonSummary): string {
  if (summary.total === 0) return 'not_provided';
  const top = summary.breakdown
    .slice(0, 4)
    .map(entry => `${entry.reason}:${entry.count}`)
    .join(', ');
  return `${top}; ${summary.summary}`;
}

function scoreReadiness(args: {
  status: SwanBotOpenSwanReadinessStatus;
  requiredSmokes: SwanBotOpenSwanSmokeCheck[];
  toolParity: SwanBotOpenSwanToolParity;
  telemetry: SwanBotOpenSwanTelemetrySnapshot;
  blockers: string[];
  warnings: string[];
}): number {
  const smokePasses = args.requiredSmokes.filter(smoke => smoke.status === 'pass').length;
  const smokeScore = args.requiredSmokes.length > 0
    ? (smokePasses / args.requiredSmokes.length) * 45
    : 0;
  const parityScore = args.toolParity.ok ? 30 : Math.min(25, (args.toolParity.actualTotal / args.toolParity.expectedTotal) * 25);
  const telemetryScore = args.telemetry.ok
    ? 25
    : args.telemetry.enoughSamples
      ? 12
      : Math.min(
        10,
        (Math.min(args.telemetry.v1RunCount, args.telemetry.v2RunCount) / args.telemetry.minRuns) * 10,
      );
  const penalty = args.blockers.length * 6 + args.warnings.length * 2;
  const raw = smokeScore + parityScore + telemetryScore - penalty;

  if (args.status === 'ready') return 100;
  return clamp(Math.round(raw), 0, 94);
}

function buildSummary(args: {
  status: SwanBotOpenSwanReadinessStatus;
  toolParity: SwanBotOpenSwanToolParity;
  telemetry: SwanBotOpenSwanTelemetrySnapshot;
  requiredSmokes: SwanBotOpenSwanSmokeCheck[];
  blockers: string[];
  warnings: string[];
}): string {
  if (args.status === 'ready') {
    return 'SwanBot v2 has tool parity, passing required smokes, and enough clean telemetry to become the default.';
  }

  if (args.blockers.length > 0) {
    return `SwanBot v2 default flip is blocked by ${args.blockers.length} item${args.blockers.length === 1 ? '' : 's'}.`;
  }

  const unknownSmokes = args.requiredSmokes.filter(smoke => smoke.status === 'unknown').length;
  if (unknownSmokes > 0) {
    return `SwanBot v2 is close, but ${unknownSmokes} required smoke${unknownSmokes === 1 ? '' : 's'} still need fresh evidence.`;
  }

  return `SwanBot v2 is on watch: ${args.telemetry.summary}`;
}

function normalizeRate(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return clamp(value, 0, 1);
}

function normalizeMessages(messages: string[] | undefined): string[] {
  return uniqueMessages((messages || []).map(message => message.trim()).filter(Boolean));
}

function uniqueMessages(messages: string[]): string[] {
  return Array.from(new Set(messages));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAgentRunVersion(row: SwanBotOpenSwanAgentRunTelemetryRow): SwanBotOpenSwanAgentRunVersion | null {
  const metadata = row.metadata || {};
  const version = metadata.version;
  return version === 'swanbot-ai' || version === 'swanbot-v2-ai' ? version : null;
}

async function loadDefaultSupabaseClient(): Promise<SupabaseClientLike> {
  const mod = await import('./supabase');
  return mod.supabase as unknown as SupabaseClientLike;
}
