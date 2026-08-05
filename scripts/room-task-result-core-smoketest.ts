/**
 * room-task-result-core-smoketest — every branch of the pure Room-task
 * honesty layer (`src/lib/roomTaskResultCore.ts`).
 *
 * Run: npx tsx scripts/room-task-result-core-smoketest.ts
 *
 * Error fixtures mirror the REAL `supabase.functions.invoke` failure shape:
 * invoke resolves `{ data: null, error }` (it does not throw on non-2xx);
 * `error` is a FunctionsHttpError with the fetch Response on `error.context`
 * (numeric `.status`, JSON body via `.clone().json()`) — verified against
 * `src/lib/swanbotV2Retry.ts` (isRetryableInvokeError reads
 * `error.context.status`), `src/lib/swanbot.ts` (readSwanBotInvokeErrorBody
 * reads `error.context.clone().json()`), and `src/lib/heliusTrading.ts`
 * (`error.context.json()`). Bodies mirror room-task-executor/index.ts +
 * _shared/edge.ts errResponse `{ error: message, code }`.
 */

import {
  describeRoomTaskInvokeError,
  describeRoomTaskResult,
  describeRoomTaskSchedule,
  describeRoomTaskType,
} from '../src/lib/roomTaskResultCore';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  ✗ FAIL: ${label}`);
  }
}

// FunctionsHttpError-style fixture: Response lives on `.context`.
function httpError(status: number) {
  return {
    name: 'FunctionsHttpError',
    message: 'Edge Function returned a non-2xx status code',
    context: { status },
  };
}

// ─── (a) describeRoomTaskResult ──────────────────────────────────────────────

console.log('describeRoomTaskResult');

{
  // The REAL success shape the edge writes (index.ts ~:442).
  const r = describeRoomTaskResult({
    taskType: 'general',
    status: 'done',
    lastResult: { responseLength: 1843, taskType: 'general', completedAt: '2026-07-31T09:00:00Z' },
  });
  assert(r.headline === 'Answered · 1,843 chars · posted to room chat', `real shape headline (got "${r.headline}")`);
  assert(r.tone === 'ok', 'real shape tone ok');
  assert(r.jumpToChat === true, 'real shape jumpToChat');
  assert(!r.headline.includes('{') && !r.headline.includes('responseLength'), 'no JSON leaks');
}

{
  // Thousands formatting at boundaries.
  assert(
    describeRoomTaskResult({ lastResult: { responseLength: 999 } }).headline.includes('999 chars'),
    'char count 999 unseparated',
  );
  assert(
    describeRoomTaskResult({ lastResult: { responseLength: 1234567 } }).headline.includes('1,234,567 chars'),
    'char count 1,234,567',
  );
}

{
  // Advisory types get honest not-executed verbs; taskType read from result first.
  const script = describeRoomTaskResult({ lastResult: { responseLength: 500, taskType: 'run_script' } });
  assert(script.headline.startsWith('Script drafted (not executed)'), `run_script verb (got "${script.headline}")`);
  const db = describeRoomTaskResult({ taskType: 'db_query', lastResult: { responseLength: 10 } });
  assert(db.headline.startsWith('Query reviewed (not executed)'), 'db_query verb from outer taskType');
  const api = describeRoomTaskResult({ lastResult: { responseLength: 10, taskType: 'api_call' } });
  assert(api.headline.startsWith('API call reviewed (not executed)'), 'api_call verb');
  const research = describeRoomTaskResult({ lastResult: { responseLength: 10, taskType: 'web_research' } });
  assert(research.headline.startsWith('Research posted'), 'web_research verb');
}

{
  // Legacy { preview } shape.
  const r = describeRoomTaskResult({ lastResult: { preview: 'Here is your summary of Q3 results' } });
  assert(r.headline === 'Here is your summary of Q3 results', 'legacy preview passes through');
  assert(r.tone === 'ok' && r.jumpToChat === true, 'legacy preview tone/jump');
}

{
  // Legacy/error { error } shape (edge catch writes { error: err.message }).
  const r = describeRoomTaskResult({ status: 'error', lastResult: { error: 'Anthropic API error 529' } });
  assert(r.headline === 'Failed', 'error shape headline');
  assert(r.detail === 'Anthropic API error 529', 'error shape detail');
  assert(r.tone === 'warn', 'error shape tone warn');
  assert(r.jumpToChat === false, 'error shape no jump');
}

{
  // Unknown object shape → 'Completed', never JSON.
  const r = describeRoomTaskResult({ status: 'done', lastResult: { weird: { nested: [1, 2, 3] } } });
  assert(r.headline === 'Completed', 'unknown shape → Completed');
  assert(!JSON.stringify(r).includes('nested'), 'unknown shape leaks nothing');
  const r2 = describeRoomTaskResult({ status: 'idle', lastResult: { weird: true } });
  assert(r2.tone === 'muted', 'unknown shape non-done tone muted');
}

{
  // No result yet: status carries the story.
  assert(describeRoomTaskResult({ status: 'running', lastResult: null }).headline === 'Running…', 'running headline');
  assert(describeRoomTaskResult({ status: 'error', lastResult: null }).tone === 'warn', 'error-no-result warn');
  const idle = describeRoomTaskResult({ status: 'idle', lastResult: undefined });
  assert(idle.headline === 'Not run yet' && idle.jumpToChat === false, 'idle not-run-yet');
}

{
  // Totality on garbage.
  assert(describeRoomTaskResult({} as any).headline === 'Not run yet', 'empty input total');
  assert(describeRoomTaskResult({ lastResult: 42 }).headline === 'Completed', 'number result total');
  assert(describeRoomTaskResult({ lastResult: [1, 2] }).headline === 'Completed', 'array result total');
  assert(describeRoomTaskResult({ lastResult: 'plain string result' }).headline === 'plain string result', 'string result shown');
  assert(describeRoomTaskResult({ lastResult: '   ' }).headline === 'Completed', 'blank string → Completed');
  assert(describeRoomTaskResult(null as any) !== undefined || true, 'null input does not throw pre-check');
  let threw = false;
  try {
    describeRoomTaskResult(null as any);
    describeRoomTaskResult(undefined as any);
    describeRoomTaskResult({ taskType: 7, status: {}, lastResult: { responseLength: NaN } } as any);
  } catch {
    threw = true;
  }
  assert(!threw, 'never throws on null/undefined/garbage');
  assert(describeRoomTaskResult({ lastResult: { responseLength: NaN } }).headline === 'Completed', 'NaN responseLength → unknown shape');
}

{
  // Boundedness + secret safety in preview/error strings.
  const long = 'x'.repeat(500);
  const r = describeRoomTaskResult({ lastResult: { preview: long } });
  assert(r.headline.length <= 120, `long preview bounded (${r.headline.length})`);
  const secret = describeRoomTaskResult({
    lastResult: { error: 'auth failed for key sk-ant-api03-abcdefghijklmnop1234' },
  });
  assert(!JSON.stringify(secret).includes('sk-ant-'), 'API key redacted from result error');
  assert((secret.detail ?? '').includes('[redacted]'), 'redaction marker present');
}

// ─── (b) describeRoomTaskInvokeError ─────────────────────────────────────────

console.log('describeRoomTaskInvokeError');

{
  // 429 budget cap — real body from index.ts ~:385.
  const body = { error: 'circle_claude_budget_exceeded', detail: 'cap', spent24h: 4.87, cap: 5 };
  const r = describeRoomTaskInvokeError(httpError(429), body);
  assert(r.headline === 'Daily AI budget reached', '429 headline');
  assert(r.detail.includes('$4.87 of $5.00'), `429 detail has spend (got "${r.detail}")`);
  assert(r.detail.includes('AI SPEND'), '429 detail points at settings');
  assert(r.tone === 'danger', '429 tone danger');
  // Status alone (body unreadable) still maps.
  const noBody = describeRoomTaskInvokeError(httpError(429));
  assert(noBody.headline === 'Daily AI budget reached', '429 without body still maps');
  assert(noBody.detail.includes('24h'), '429 without body generic detail');
}

{
  // 400 key_missing — errResponse(400, 'key_missing', byokMissingMessage(...)).
  const body = {
    error: 'Add your own Anthropic API key in Office > Customize > API Keys to use this model. Platform model keys are reserved for owner/test accounts.',
    code: 'key_missing',
  };
  const r = describeRoomTaskInvokeError(httpError(400), body);
  assert(r.headline === 'Anthropic key missing — add it in Marketplace', 'key_missing headline');
  assert(r.detail.includes('Anthropic API key'), 'key_missing detail carries edge copy');
  assert(r.tone === 'danger', 'key_missing tone');
}

{
  // 401 / 403 auth family.
  const unauth = describeRoomTaskInvokeError(httpError(401), { error: 'Valid JWT required.', code: 'unauthenticated' });
  assert(unauth.headline === 'Session expired — sign in again', '401 headline');
  const unauthNoBody = describeRoomTaskInvokeError(httpError(401));
  assert(unauthNoBody.headline === 'Session expired — sign in again', '401 without body');
  const forbidden = describeRoomTaskInvokeError(httpError(403), { error: 'Not authorized for this room.', code: 'forbidden' });
  assert(forbidden.headline === 'Not authorized for this room', '403 forbidden headline');
  const mismatch = describeRoomTaskInvokeError(httpError(403), { error: 'Task does not belong to this room.', code: 'task_mismatch' });
  assert(mismatch.headline === 'Not authorized for this room', 'task_mismatch maps to auth headline');
  const notFound = describeRoomTaskInvokeError(httpError(404), { error: 'Room not found.', code: 'room_not_found' });
  assert(notFound.headline === 'Room not found', '404 headline');
}

{
  // Other 4xx — missing required fields body (index.ts ~:349, no code field).
  const r = describeRoomTaskInvokeError(httpError(400), { error: 'Missing required fields: taskId, roomId, prompt' });
  assert(r.headline === 'Task request rejected', 'generic 400 headline');
  assert(r.detail.includes('Missing required fields'), 'generic 400 detail from body');
}

{
  // 5xx — edge catch block { error: err.message }.
  const r = describeRoomTaskInvokeError(httpError(500), { error: 'Anthropic API error: overloaded' });
  assert(r.headline === 'Task executor error', '500 headline');
  assert(r.detail.includes('overloaded'), '500 detail from body');
  const bare = describeRoomTaskInvokeError(httpError(503));
  assert(bare.headline === 'Task executor error' && bare.detail.length > 0, '503 without body has detail');
}

{
  // Network-shape errors (FunctionsFetchError / FunctionsRelayError).
  const fetchErr = describeRoomTaskInvokeError({ name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' });
  assert(fetchErr.headline === 'Could not reach the task executor', 'FunctionsFetchError headline');
  const relayErr = describeRoomTaskInvokeError({ name: 'FunctionsRelayError', message: 'relay error' });
  assert(relayErr.headline === 'Could not reach the task executor', 'FunctionsRelayError headline');
}

{
  // Plain Error / string / garbage — bounded generic mapping, total.
  const plain = describeRoomTaskInvokeError(new Error('boom'));
  assert(plain.headline === 'Task run failed' && plain.detail === 'boom', 'plain Error mapped');
  const str = describeRoomTaskInvokeError('string failure');
  assert(str.headline === 'Task run failed' && str.detail === 'string failure', 'string error mapped');
  let threw = false;
  try {
    describeRoomTaskInvokeError(null);
    describeRoomTaskInvokeError(undefined);
    describeRoomTaskInvokeError(42 as any);
    describeRoomTaskInvokeError({}, { code: 12345 });
    describeRoomTaskInvokeError({ context: 'not an object' } as any);
  } catch {
    threw = true;
  }
  assert(!threw, 'invoke-error mapping never throws');
  assert(describeRoomTaskInvokeError(null).headline === 'Task run failed', 'null → generic');
  assert(describeRoomTaskInvokeError({}).headline === 'Task run failed', 'empty object → generic');
}

{
  // Boundedness + secret safety: a leaked key in the error body never echoes.
  const secretBody = { error: `invalid x-api-key: sk-ant-api03-${'a'.repeat(40)}` };
  const r = describeRoomTaskInvokeError(httpError(500), secretBody);
  assert(!JSON.stringify(r).includes('sk-ant-'), 'API key in error body redacted');
  const longMsg = describeRoomTaskInvokeError({ message: 'e'.repeat(1000) });
  assert(longMsg.detail.length <= 220, `long message bounded (${longMsg.detail.length})`);
  const bearer = describeRoomTaskInvokeError({ message: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6.eyJzdWIiOiIxMjM0NTY3ODkwIn0' });
  assert(!bearer.detail.includes('eyJhbGci'), 'bearer/JWT redacted');
}

// ─── (c) describeRoomTaskType ────────────────────────────────────────────────

console.log('describeRoomTaskType');

{
  for (const key of ['general', 'web_research', 'file_ops']) {
    const t = describeRoomTaskType(key);
    assert(t.executes === true, `${key} executes:true`);
    assert(t.advisoryNote === undefined, `${key} no advisory note`);
  }
  for (const key of ['run_script', 'db_query', 'api_call']) {
    const t = describeRoomTaskType(key);
    assert(t.executes === false, `${key} executes:false`);
    assert(t.advisoryNote === 'Advisory — the agent explains, it does not execute', `${key} advisory note`);
  }
  assert(describeRoomTaskType('run_script').label === 'Run Script', 'run_script label');
  assert(describeRoomTaskType('general').label === 'General', 'general label');
}

{
  // Unknown/garbage types: total, executes:true (edge default → handleGeneral).
  const unknown = describeRoomTaskType('custom_thing');
  assert(unknown.executes === true && unknown.label === 'custom_thing', 'unknown type total');
  assert(describeRoomTaskType(null).label === 'General', 'null type → General');
  assert(describeRoomTaskType(undefined).executes === true, 'undefined type total');
  assert(describeRoomTaskType(99 as any).label === 'General', 'number type total');
  assert(describeRoomTaskType('x'.repeat(200)).label.length <= 40, 'unknown label bounded');
  // Returned objects are copies — mutation cannot poison the table.
  const a = describeRoomTaskType('run_script');
  (a as any).executes = true;
  assert(describeRoomTaskType('run_script').executes === false, 'type table immutable to callers');
}

// ─── (d) describeRoomTaskSchedule ────────────────────────────────────────────

console.log('describeRoomTaskSchedule');

{
  const daily = describeRoomTaskSchedule('0 9 * * *');
  assert(daily.scheduled === false, 'daily scheduled:false');
  assert(daily.label === 'Daily 9am — manual run only', `daily label (got "${daily.label}")`);
  assert(daily.warning === 'Manual run only — scheduling not yet wired', 'daily warning');
  const hourly = describeRoomTaskSchedule('0 * * * *');
  assert(hourly.scheduled === false && hourly.label.startsWith('Hourly'), 'hourly honest');
  const mon = describeRoomTaskSchedule('0 9 * * 1');
  assert(mon.label.startsWith('Mon 9am') && mon.warning !== undefined, 'mon honest');
  // Arbitrary cron string: still honest, bounded label.
  const custom = describeRoomTaskSchedule('*/5 * * * *');
  assert(custom.scheduled === false && custom.warning !== undefined, 'custom cron honest');
  assert(custom.label.includes('manual run only'), 'custom cron label carries honesty');
  const long = describeRoomTaskSchedule('x'.repeat(300));
  assert(long.label.length <= 60, `long schedule bounded (${long.label.length})`);
}

{
  // 'Once' never promised automation — no warning needed; totality.
  const once = describeRoomTaskSchedule('once');
  assert(once.scheduled === false && once.label === 'Once', 'once honest as-is');
  assert(once.warning === undefined, 'once needs no warning');
  assert(describeRoomTaskSchedule('ONCE').label === 'Once', 'once case-insensitive');
  assert(describeRoomTaskSchedule(null).label === 'Once', 'null schedule total');
  assert(describeRoomTaskSchedule(undefined).scheduled === false, 'undefined schedule total');
  assert(describeRoomTaskSchedule({} as any).label === 'Once', 'object schedule total');
  // scheduled is NEVER true — the honesty invariant.
  for (const v of ['0 9 * * *', 'once', 'whatever', null, 42]) {
    assert(describeRoomTaskSchedule(v as any).scheduled === false, `scheduled always false (${String(v)})`);
  }
}

// ─── summary ─────────────────────────────────────────────────────────────────

console.log(`\nroom-task-result-core smoketest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('OK');
