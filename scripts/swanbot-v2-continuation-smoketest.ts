import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS,
  SWANBOT_MAX_CLIENT_TOOL_RESULTS,
  validateSwanBotResumeToolResults,
} from '../supabase/functions/_shared/swanbot-continuation';

function ok<T>(value: { ok: true; results: T } | { ok: false; error: string }): T {
  assert.equal(value.ok, true, 'expected validation success');
  return (value as { ok: true; results: T }).results;
}

function fail(
  value: { ok: true; results: unknown } | { ok: false; error: string },
  pattern: RegExp,
  label: string,
): void {
  assert.equal(value.ok, false, `${label}: expected validation failure`);
  assert.match((value as { ok: false; error: string }).error, pattern, label);
}

const valid = ok(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_b', content: { ok: true, data: { beta: 2 } }, is_error: true },
  { tool_use_id: 'tool_a', content: '{"ok":true}' },
], ['tool_a', 'tool_b']));

assert.deepEqual(valid.map(result => result.tool_use_id), ['tool_a', 'tool_b'], 'results preserve pending tool order');
assert.equal(valid[0].content, '{"ok":true}', 'string content preserved');
assert.equal(valid[1].content, JSON.stringify({ ok: true, data: { beta: 2 } }), 'object content normalized to JSON');
assert.equal(valid[1].is_error, true, 'is_error preserved');

const alias = ok(validateSwanBotResumeToolResults([
  { id: 'tool_a', content: 'alias-id' },
], ['tool_a']));
assert.equal(alias[0].tool_use_id, 'tool_a', 'id alias accepted for client compatibility');

fail(validateSwanBotResumeToolResults(null, ['tool_a']), /array/, 'non-array toolResults rejected');
fail(validateSwanBotResumeToolResults([], []), /no pending tool ids/, 'empty pending ids rejected');
fail(validateSwanBotResumeToolResults([], ['tool_a']), /missing tool_result id/, 'missing result rejected');
fail(validateSwanBotResumeToolResults([{ tool_use_id: 'tool_x', content: '' }], ['tool_a']), /unexpected tool_result id: tool_x/, 'extra result rejected');
fail(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_a', content: 'one' },
  { tool_use_id: 'tool_a', content: 'two' },
], ['tool_a']), /duplicate tool_result id: tool_a/, 'duplicate result rejected');
fail(validateSwanBotResumeToolResults([{ content: 'missing id' }], ['tool_a']), /include tool_use_id/, 'blank result id rejected');
fail(validateSwanBotResumeToolResults([], ['tool_a', 'tool_a']), /duplicate pending tool ids/, 'duplicate pending id rejected');

const tooManyPending = Array.from({ length: SWANBOT_MAX_CLIENT_TOOL_RESULTS + 1 }, (_, i) => `tool_${i}`);
fail(validateSwanBotResumeToolResults([], tooManyPending), /too many pending client tool calls/, 'too many pending tools rejected');

const tooManyResults = Array.from({ length: SWANBOT_MAX_CLIENT_TOOL_RESULTS + 1 }, (_, i) => ({
  tool_use_id: `tool_${i}`,
  content: 'x',
}));
fail(validateSwanBotResumeToolResults(tooManyResults, ['tool_0']), /too many toolResults/, 'too many result rows rejected');

// Oversized client tool results are now SUMMARIZED (head + tail + error-signal
// lines), not hard-truncated — parity with the client loop's
// toolResultSummaryCore (LOCKSTEP: supabase/functions/_shared/tool-result-summary.ts).
// The summary keeps the tail, stays under the legacy char cap, and carries the
// summarization marker instead of the old truncation marker.
const longText = `A${'x'.repeat(SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS * 2)}TAIL`;
const capped = ok(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_a', content: longText },
], ['tool_a']));
assert(capped[0].content.length <= SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS, 'summarized result stays under the char budget');
assert.match(capped[0].content, /tool result summarized/, 'oversized result carries the summarization marker');
assert(capped[0].content.includes('TAIL'), 'summarization preserves the payload tail (unlike the old hard truncation)');

const circular: Record<string, unknown> = {};
circular.self = circular;
const circularResult = ok(validateSwanBotResumeToolResults([
  { tool_use_id: 'tool_a', content: circular },
], ['tool_a']));
assert.equal(circularResult[0].content, '[object Object]', 'circular non-string content falls back safely');

const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');
assert(
  edgeSource.includes('SWANBOT_MAX_CLIENT_TOOL_RESULTS'),
  'edge imports the pending client tool cap',
);
assert(
  edgeSource.includes('serverToolResults?: SwanBotResumeToolResult[]'),
  'continuation snapshot can carry server-side results for mixed batches',
);
assert(
  edgeSource.includes('pendingToolUseIds: clientUses.map'),
  'pending continuation stores only client-side tool ids',
);
assert(
  edgeSource.includes('const clientToolCalls = clientUses.map'),
  'pending response returns only client-side tool calls',
);
assert(
  !edgeSource.includes('const clientToolCalls = uses.map'),
  'edge does not hand the full mixed tool batch to the client',
);
assert(
  edgeSource.includes('mergeContinuationToolResults(cont, validatedResults.results)'),
  'resume merges persisted server tool results with client tool results',
);
assert(
  edgeSource.includes('Cannot pause for client-side tools because the run was not persisted.'),
  'edge fails closed before pending when no run id exists',
);
assert(
  edgeSource.includes('Too many client-side tool calls'),
  'edge caps pending client-side calls before dispatching to the client',
);
assert(
  edgeSource.includes('runRow.status !== "running" || runRow.final_stop_reason !== "client_pending"'),
  'resume rejects continuations that are no longer pending',
);
assert(
  edgeSource.includes('SWANBOT_CONTINUATION_MAX_AGE_MS') && edgeSource.includes('continuation_stale'),
  'resume rejects stale continuations before replaying tool results',
);

console.log('swanbot-v2-continuation smoke passed');
