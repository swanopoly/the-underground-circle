/**
 * swanbot-v2-stop-reason-smoketest — guard for the shared v2 stop-reason
 * classifier (AR2). Asserts every branch + precedence + case-insensitivity.
 *
 * Run: npm run smoke:swanbot-v2-stop-reason
 */

import { readFileSync } from 'node:fs';
import * as ts from 'typescript';

import { classifyV2StopReason } from '../src/lib/swanbotV2StopReason';

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function pass(message: string): void {
  console.log('pass:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

assert(
  classifyV2StopReason({ kind: 'pending', hitMax: false, modelStopReason: 'end_turn' }) === 'client_pending',
  'pending -> client_pending (modelStopReason ignored)',
);
assert(
  classifyV2StopReason({ kind: 'pending', hitMax: true }) === 'client_pending',
  'pending -> client_pending (hitMax ignored)',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: true, modelStopReason: 'end_turn' }) === 'max_tokens',
  'terminal + hitMax -> max_tokens (precedence over modelStopReason)',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: 'end_turn' }) === 'end_turn',
  'terminal end_turn -> end_turn',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: 'stop_sequence' }) === 'end_turn',
  'terminal stop_sequence -> end_turn',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: 'max_tokens' }) === 'max_tokens',
  'terminal max_tokens (no hitMax) -> max_tokens',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: 'garbage' }) === 'error',
  'terminal unknown -> error',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: 'tool_use' }) === 'error',
  'terminal tool_use (should not happen) -> error',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: '' }) === 'error',
  'terminal empty -> error',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: null }) === 'error',
  'terminal null -> error',
);
assert(
  classifyV2StopReason({ kind: 'terminal', hitMax: false, modelStopReason: '  END_TURN  ' }) === 'end_turn',
  'case/whitespace insensitivity',
);

const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
function sourceSection(start: string, end: string): string {
  const startIndex = edgeSource.indexOf(start);
  const endIndex = edgeSource.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) return '';
  return edgeSource.slice(startIndex, endIndex);
}

assert(
  edgeSource.includes('function classifySwanBotV2FinalStopReason'),
  'edge function carries local final_stop_reason classifier',
);
assert(
  edgeSource.includes('final_stop_reason: finalStopReason'),
  'edge terminal update persists normalized final_stop_reason',
);
assert(
  edgeSource.includes('function agentRunTokenUsageFields'),
  'edge maps usage totals into agent_runs token fields',
);
assert(
  edgeSource.includes('input_tokens: normalizeAgentRunInteger(usage.uncachedIn)'),
  'edge persists finite non-negative uncached input tokens',
);
assert(
  edgeSource.includes('output_tokens: normalizeAgentRunInteger(usage.output)'),
  'edge persists finite non-negative output tokens',
);
assert(
  edgeSource.includes('normalizeAgentRunInteger(usage.cacheCreate) + normalizeAgentRunInteger(usage.cacheRead)'),
  'edge persists finite non-negative cache create/read totals',
);
assert(
  edgeSource.includes('iteration_count: Math.max(1, normalizeAgentRunInteger(args.iterations))')
    && edgeSource.includes('tool_calls: Array.isArray(args.toolCalls) ? args.toolCalls : []'),
  'edge summary normalizer guarantees an array tool_calls and iteration_count >= 1',
);
assert(
  (edgeSource.match(/\.\.\.agentRunSummaryFields\(\{/g) || []).length >= 9,
  'edge uses the complete summary writer across pending, continuation, and terminal paths',
);
assert(
  edgeSource.includes('input_tokens: 0') && edgeSource.includes('output_tokens: 0') && edgeSource.includes('cached_tokens: 0'),
  'edge writes zero token fields on failed run updates',
);
assert(
  edgeSource.includes('tool_calls: []') && edgeSource.includes('iteration_count: 1'),
  'edge writes complete run-summary fields on failed run updates',
);
assert(
  !edgeSource.includes('final_stop_reason: result.stopReason'),
  'edge terminal update does not persist raw model stopReason',
);
assert(
  edgeSource.includes('rawStopReason: result.stopReason'),
  'edge terminal metadata preserves raw model stopReason for diagnostics',
);

const pendingWriterSource = sourceSection(
  'if (result.kind === "pending")',
  '// A loop-top cancel carries',
);
assert(
  (pendingWriterSource.match(/\.\.\.agentRunSummaryFields\(\{/g) || []).length >= 3,
  'pending, encryption-unavailable, and checkpoint-seal writers persist complete summaries',
);
assert(
  pendingWriterSource.includes('observeAgentRunTelemetryWrite(\n            "continuation_encryption_unavailable"')
    && pendingWriterSource.includes('observeAgentRunTelemetryWrite(\n            "continuation_checkpoint_seal_failed"'),
  'checkpoint terminal writes surface Supabase failures',
);

const continuationCloseSource = sourceSection(
  'async function closeUnreadableContinuation',
  'async function executeEdgeToolUse',
);
assert(
  (continuationCloseSource.match(/\.\.\.agentRunSummaryFieldsFromRow\(/g) || []).length === 2
    && (continuationCloseSource.match(/\.\.\.agentRunSummaryFields\(\{/g) || []).length === 2,
  'all four continuation close/seal writers repair complete run summaries',
);
assert(
  edgeSource.includes('.select("id, user_id, circle_id, metadata, status, final_stop_reason, tool_calls, iteration_count, input_tokens, output_tokens, cached_tokens")'),
  'continuation close paths load the durable summary fields they normalize',
);

const telemetryLoggerSource = sourceSection(
  'function safeAgentRunTelemetryErrorCode',
  'const SENSITIVE_TOOL_NAMES',
);
assert(
  telemetryLoggerSource.includes('agent_runs telemetry write failed')
    && telemetryLoggerSource.includes('operation,')
    && telemetryLoggerSource.includes('code: safeAgentRunTelemetryErrorCode(error)')
    && !telemetryLoggerSource.includes('.message'),
  'agent-run telemetry failures log only a bounded operation and error code',
);
assert(
  edgeSource.includes('"finalize_cancelled_run"')
    && edgeSource.includes('"fresh_run_failure"'),
  'cancelled and fresh failure terminal updates are observed instead of fire-and-forget',
);
assert(
  edgeSource.includes('"persist_next_pending_continuation"')
    && edgeSource.includes('"persist_resumed_terminal"')
    && edgeSource.includes('"persist_fresh_terminal"')
    && !edgeSource.includes('pendingPersisted?.error || "claim no longer active"')
    && !edgeSource.includes('terminalPersisted?.error || "claim no longer active"'),
  'pending and terminal CAS failures use bounded diagnostics instead of raw Supabase errors',
);

const postLoopSummarySource = sourceSection(
  'const result = await runLoop({',
  '// ── M2 pending response',
);
assert(
  postLoopSummarySource.includes('if (continuationClaim && continuationRunRow)')
    && postLoopSummarySource.includes('toolCalls: result.toolCalls')
    && postLoopSummarySource.includes('iterations: result.iterations')
    && postLoopSummarySource.includes('usage: result.usage'),
  'resumed close/seal fallback authority carries the newest available result summary',
);

assert(
  // Honest STOP + terminal integrity: cancellation wins, an unverified
  // dispatched client mutation cannot be converted to success by model
  // end_turn, and only an otherwise-clean end_turn is completed.
  edgeSource.includes('function classifySwanBotTerminalStatus(')
    && edgeSource.includes('if (args.cancelled) return "cancelled";')
    && edgeSource.includes('if (args.clientMutationIntegrity.status === "outcome_unknown") return "failed";')
    && edgeSource.includes('return args.finalStopReason === "end_turn" ? "completed" : "failed";')
    && edgeSource.includes('let terminalStatus = classifySwanBotTerminalStatus({'),
  'edge classifier marks cancellations as cancelled, unverified mutations/max_tokens/errors as failed, and only clean end_turn as completed',
);

type EvaluatedTelemetryHelpers = {
  agentRunSummaryFields: (args: {
    toolCalls: unknown;
    iterations: unknown;
    usage: {
      uncachedIn: number;
      output: number;
      cacheCreate: number;
      cacheRead: number;
    };
  }) => {
    tool_calls: unknown[];
    iteration_count: number;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
  };
  agentRunSummaryFieldsFromRow: (row: Record<string, unknown>) => {
    tool_calls: unknown[];
    iteration_count: number;
    input_tokens: number;
    output_tokens: number;
    cached_tokens: number;
  };
  safeAgentRunTelemetryErrorCode: (error: unknown) => string;
  observeAgentRunTelemetryWrite: (
    operation: string,
    write: PromiseLike<{ error?: unknown } | null>,
  ) => Promise<boolean>;
};

async function runExecutableTelemetryHelperAssertions(): Promise<void> {
  const helperSource = sourceSection(
    'function agentRunTokenUsageFields',
    'const SENSITIVE_TOOL_NAMES',
  );
  const helperJavaScript = ts.transpileModule(helperSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  }).outputText;
  const warningCalls: unknown[][] = [];
  const evaluateHelpers = new Function(
    'console',
    `${helperJavaScript}\nreturn { agentRunSummaryFields, agentRunSummaryFieldsFromRow, safeAgentRunTelemetryErrorCode, observeAgentRunTelemetryWrite };`,
  ) as (consoleLike: { warn: (...args: unknown[]) => void }) => EvaluatedTelemetryHelpers;
  const helpers = evaluateHelpers({
    warn: (...args: unknown[]) => warningCalls.push(args),
  });

  const normalized = helpers.agentRunSummaryFields({
    toolCalls: 'not-an-array',
    iterations: 0,
    usage: {
      uncachedIn: -3,
      output: 4.9,
      cacheCreate: Number.POSITIVE_INFINITY,
      cacheRead: 2.8,
    },
  });
  assert(
    Array.isArray(normalized.tool_calls)
      && normalized.tool_calls.length === 0
      && normalized.iteration_count === 1
      && normalized.input_tokens === 0
      && normalized.output_tokens === 4
      && normalized.cached_tokens === 2,
    'executable edge summary helper clamps malformed counts and preserves a valid summary shape',
  );

  const normalizedRow = helpers.agentRunSummaryFieldsFromRow({
    tool_calls: [{ toolName: 'desktop.launch_app' }],
    iteration_count: Number.NaN,
    input_tokens: Number.NEGATIVE_INFINITY,
    output_tokens: '7.9',
    cached_tokens: -1,
  });
  assert(
    normalizedRow.tool_calls.length === 1
      && normalizedRow.iteration_count === 1
      && normalizedRow.input_tokens === 0
      && normalizedRow.output_tokens === 7
      && normalizedRow.cached_tokens === 0,
    'executable row-summary helper repairs non-finite, fractional, and negative telemetry values',
  );

  assert(
    helpers.safeAgentRunTelemetryErrorCode({ code: 'PGRST204' }) === 'PGRST204'
      && helpers.safeAgentRunTelemetryErrorCode({ code: 'bad code private-value' }) === 'unknown'
      && helpers.safeAgentRunTelemetryErrorCode(new Error('private-value')) === 'unknown',
    'executable telemetry error-code helper accepts only bounded machine codes',
  );

  const resolvedFailure = await helpers.observeAgentRunTelemetryWrite(
    'test_resolved_failure',
    Promise.resolve({ error: { code: 'PGRST204', message: 'private-value' } }),
  );
  const thrownFailure = await helpers.observeAgentRunTelemetryWrite(
    'test_thrown_failure',
    Promise.reject({ code: '42501', message: 'another-private-value' }),
  );
  const success = await helpers.observeAgentRunTelemetryWrite(
    'test_success',
    Promise.resolve({}),
  );
  const serializedWarnings = JSON.stringify(warningCalls);
  assert(
    resolvedFailure === false
      && thrownFailure === false
      && success === true
      && warningCalls.length === 2
      && serializedWarnings.includes('test_resolved_failure')
      && serializedWarnings.includes('PGRST204')
      && serializedWarnings.includes('test_thrown_failure')
      && serializedWarnings.includes('42501')
      && !serializedWarnings.includes('private-value'),
    'executable telemetry observer reports resolved/thrown failures without logging error payloads',
  );
}

runExecutableTelemetryHelperAssertions()
  .catch((error) => fail(`executable telemetry helper assertions threw — ${String(error)}`))
  .finally(() => {
    if (failures > 0) {
      console.error(`\n${failures} assertion(s) failed.`);
      process.exitCode = 1;
      return;
    }
    console.log('\nswanbot-v2-stop-reason-smoketest: all assertions passed.');
  });
