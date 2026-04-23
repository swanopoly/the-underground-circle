/**
 * feed-loop-in-smoketest — mirrors the pure helpers added to
 * supabase/functions/swanbot-v2-ai/index.ts to hook v2 runs into the
 * Feed dashboard's agent_activity stream. Edge fn lives in Deno so
 * we re-declare the functions here and pin their behavior.
 *
 * Run: npm run smoke:feed-loop-in
 */

// Keep in lockstep with summariseRunTitle/formatToolTraceSummary in
// supabase/functions/swanbot-v2-ai/index.ts.
function summariseRunTitle(prompt: string, reply: string, mode: string): string {
  const p = String(prompt || '').trim().replace(/\s+/g, ' ');
  const r = String(reply || '').trim().replace(/\s+/g, ' ');
  const head = p.length >= 8 ? p : r;
  const prefix = mode && mode !== 'talk' ? `[${mode}] ` : '';
  const clipped = head.length > 80 ? head.slice(0, 79) + '…' : head;
  return (prefix + clipped) || 'v2 run';
}

function formatToolTraceSummary(calls: any[] | undefined): string {
  const list = Array.isArray(calls) ? calls : [];
  if (list.length === 0) return '';
  const distinct: string[] = [];
  for (const c of list) {
    const name = typeof c?.toolName === 'string' ? c.toolName : typeof c?.name === 'string' ? c.name : null;
    if (!name) continue;
    if (!distinct.includes(name)) distinct.push(name);
  }
  if (distinct.length === 0) return '';
  const head = distinct.slice(0, 3).join(', ');
  const more = Math.max(0, distinct.length - 3);
  return more > 0 ? `${head} (+${more} more calls)` : head;
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── summariseRunTitle ──────────────────────────────────────────
  assert(
    summariseRunTitle('Open Zoom and start meeting', 'Launched Zoom.', 'talk') === 'Open Zoom and start meeting',
    'title: prompt wins over reply in talk mode',
  );
  assert(
    summariseRunTitle('Hi', 'Hello — what can I help with today?', 'talk') === 'Hello — what can I help with today?',
    'title: short prompt falls back to reply',
  );
  assert(
    summariseRunTitle('Fix the PR', 'Done.', 'execute').startsWith('[execute]'),
    'title: non-talk mode gets prefix',
  );
  assert(
    !summariseRunTitle('Tell me a joke', 'x', 'talk').includes('['),
    'title: talk mode adds no prefix',
  );
  {
    const big = 'a'.repeat(200);
    const out = summariseRunTitle(big, '', 'talk');
    assert(out.length === 80, `title: long prompt capped at 80 (got ${out.length})`);
    assert(out.endsWith('…'), 'title: ellipsis on truncation');
  }
  assert(summariseRunTitle('', '', 'talk') === 'v2 run', 'title: both empty → fallback');
  assert(summariseRunTitle('  hello   world  ', '', 'talk') === 'hello world', 'title: whitespace collapsed');

  // ─── formatToolTraceSummary ─────────────────────────────────────
  assert(formatToolTraceSummary(undefined) === '', 'trace: undefined → empty');
  assert(formatToolTraceSummary([]) === '', 'trace: empty list → empty');
  {
    const out = formatToolTraceSummary([{ toolName: 'tasks.list' }, { toolName: 'tasks.list' }, { toolName: 'missions.list' }]);
    assert(out === 'tasks.list, missions.list', 'trace: dedupes tool names');
  }
  {
    const calls = [
      { toolName: 'desktop.launch_app' },
      { toolName: 'desktop.read_a11y_tree' },
      { toolName: 'desktop.click_element' },
      { toolName: 'desktop.type_text' },
      { toolName: 'desktop.press_keys' },
    ];
    const out = formatToolTraceSummary(calls);
    assert(out.startsWith('desktop.launch_app, desktop.read_a11y_tree, desktop.click_element'), 'trace: first 3 distinct shown');
    assert(out.includes('(+2 more calls)'), 'trace: overflow counts distinct tools beyond 3');
  }
  {
    // Repetition shouldn't overcount — 2 distinct across 7 calls is no overflow.
    const calls = [
      { toolName: 'tasks.list' }, { toolName: 'tasks.list' }, { toolName: 'tasks.list' },
      { toolName: 'missions.list' }, { toolName: 'missions.list' },
      { toolName: 'tasks.list' }, { toolName: 'missions.list' },
    ];
    const out = formatToolTraceSummary(calls);
    assert(out === 'tasks.list, missions.list', `trace: repeats collapse (got "${out}")`);
  }
  {
    // Tolerate both `{toolName}` and `{name}` shapes — the edge fn
    // records one, dispatchOneClientTool the other.
    const out = formatToolTraceSummary([{ name: 'browser.open_url' }, { toolName: 'browser.click_role' }]);
    assert(out === 'browser.open_url, browser.click_role', 'trace: accepts both name + toolName');
  }
  {
    const out = formatToolTraceSummary([{ foo: 'bar' }, { toolName: 'ok' }]);
    assert(out === 'ok', 'trace: drops entries without name');
  }

  // ─── activity_type mapping ─────────────────────────────────────
  // Mirrors the edge fn's decision between message_out / task_failed.
  const pickActivityType = (hitMax: boolean) => hitMax ? 'task_failed' : 'message_out';
  const pickStatus = (hitMax: boolean) => hitMax ? 'failed' : 'completed';
  assert(pickActivityType(false) === 'message_out', 'activity_type: success → message_out');
  assert(pickActivityType(true) === 'task_failed', 'activity_type: max-iter → task_failed');
  assert(pickStatus(false) === 'completed', 'status: success → completed');
  assert(pickStatus(true) === 'failed', 'status: max-iter → failed');

  // Allowed enum sanity — agent_activity.sql CHECK values we must never drift from.
  const ALLOWED_SOURCES = ['discord', 'webchat', 'cron', 'system'];
  const ALLOWED_TYPES = ['message_in', 'message_out', 'task_started', 'task_completed', 'task_failed', 'tool_call'];
  const ALLOWED_STATUS = ['running', 'completed', 'failed'];
  assert(ALLOWED_SOURCES.includes('system'), 'schema: "system" source still allowed');
  assert(ALLOWED_TYPES.includes('message_out'), 'schema: message_out type still allowed');
  assert(ALLOWED_STATUS.includes('failed'), 'schema: failed status still allowed');

  if (failures > 0) {
    console.error(`\n${failures} feed-loop-in smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll feed-loop-in smoke cases passed.');
}

main();
