/**
 * swanbot-v2-stop-reason-smoketest — guard for the shared v2 stop-reason
 * classifier (AR2). Asserts every branch + precedence + case-insensitivity.
 *
 * Run: npm run smoke:swanbot-v2-stop-reason
 */

import { readFileSync } from 'node:fs';

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
  edgeSource.includes('input_tokens: Math.max(0, Math.floor(usage.uncachedIn || 0))'),
  'edge persists uncached input tokens to agent_runs.input_tokens',
);
assert(
  edgeSource.includes('output_tokens: Math.max(0, Math.floor(usage.output || 0))'),
  'edge persists output tokens to agent_runs.output_tokens',
);
assert(
  edgeSource.includes('cached_tokens: Math.max(0, Math.floor((usage.cacheCreate || 0) + (usage.cacheRead || 0)))'),
  'edge persists cache create/read totals to agent_runs.cached_tokens',
);
assert(
  (edgeSource.match(/\.\.\.agentRunTokenUsageFields\(result\.usage\)/g) || []).length >= 2,
  'edge writes token fields on pending and terminal run updates',
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

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nswanbot-v2-stop-reason-smoketest: all assertions passed.');
