export type SwanBotOpenSwanReadinessStatus = 'ready' | 'watch' | 'blocked';
export type SwanBotOpenSwanSmokeStatus = 'pass' | 'fail' | 'missing' | 'unknown';

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
}

export interface SwanBotOpenSwanReadinessInput {
  v2EnabledDefault?: boolean;
  v2ToolCatalogCount?: number;
  serverToolCount?: number;
  clientDelegatedToolCount?: number;
  requiredSmokes?: SwanBotOpenSwanSmokeCheck[];
  telemetry?: SwanBotOpenSwanTelemetryInput;
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
  v1EndTurnRate: number | null;
  v2EndTurnRate: number | null;
  v1StopReasons: SwanBotOpenSwanStopReasonSummary;
  v2StopReasons: SwanBotOpenSwanStopReasonSummary;
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
    nextActions.push(`Collect at least ${telemetry.minRuns} v2 runs with final_stop_reason telemetry before M4.`);
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
  const v1EndTurnRate = normalizeRate(input?.v1EndTurnRate) ?? deriveEndTurnRate(v1StopReasons);
  const v2EndTurnRate = normalizeRate(input?.v2EndTurnRate) ?? deriveEndTurnRate(v2StopReasons);
  const enoughSamples = v2RunCount >= minRuns;
  const rateComparable = v1EndTurnRate === null || v2EndTurnRate === null
    ? false
    : v2EndTurnRate >= v1EndTurnRate;
  const ok = enoughSamples && rateComparable;
  const summary = !enoughSamples
    ? `Telemetry needs ${minRuns} v2 runs before default flip; currently ${v2RunCount}.`
    : rateComparable
      ? `v2 end-turn rate ${(v2EndTurnRate ?? 0).toFixed(3)} is >= v1 ${(v1EndTurnRate ?? 0).toFixed(3)} across ${v2RunCount} v2 runs.`
      : `v2 end-turn rate ${(v2EndTurnRate ?? 0).toFixed(3)} is below v1 ${(v1EndTurnRate ?? 0).toFixed(3)}.`;

  return {
    minRuns,
    v1RunCount,
    v2RunCount,
    v1EndTurnRate,
    v2EndTurnRate,
    v1StopReasons,
    v2StopReasons,
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
      : Math.min(10, (args.telemetry.v2RunCount / args.telemetry.minRuns) * 10);
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
