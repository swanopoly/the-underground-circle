/**
 * agent-todo-core-smoketest — the pure agent-maintained live TODO state core
 * (src/lib/agentTodoCore.ts) behind the `todo.write` tool (P6 of
 * docs/CODING_AGENT_UPGRADE_PLAN.md). Load-bearing assertions:
 *
 *   WRITE (applyAgentTodoWrite, full-replacement TodoWrite semantics):
 *   happy-path replace keeps order/content/status; unknown or missing status
 *   defaults to 'pending' with an issue; non-string / empty-after-trim
 *   content is skipped; content at exactly MAX_AGENT_TODO_CONTENT_CHARS is
 *   kept as-is while cap+1 is truncated with a trailing '…'; the list caps at
 *   MAX_AGENT_TODO_ITEMS with a dropped-count issue; more than one
 *   'in_progress' keeps the FIRST and demotes later ones; exact duplicate
 *   content dedupes first-wins.
 *
 *   READ: renderAgentTodoList emits `TODO (n/m done):` + [x]/[>]/[ ] lines
 *   (empty → `TODO list is empty.`); summarizeAgentTodoProgress names the
 *   in-progress item; agentTodoStats counts by status.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (agentTodoCore has zero imports).
 */

import {
  applyAgentTodoWrite,
  renderAgentTodoList,
  summarizeAgentTodoProgress,
  agentTodoStats,
  MAX_AGENT_TODO_ITEMS,
  MAX_AGENT_TODO_CONTENT_CHARS,
  type AgentTodoItem,
} from '../src/lib/agentTodoCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: true when some issue message contains the given substring. */
function hasIssue(result: { issues: string[] }, needle: string): boolean {
  return result.issues.some((i) => i.includes(needle));
}

function main(): void {
  // ─── (1) happy path full replace ──────────────────────────────────────────
  const r1 = applyAgentTodoWrite([
    { content: 'Read the plan doc', status: 'completed' },
    { content: 'Write the core module', status: 'in_progress' },
    { content: 'Write the smoke test', status: 'pending' },
  ]);
  assertEq(r1.todos.length, 3, '(1) all three items kept');
  assertEq(r1.issues.length, 0, '(1) clean payload produces zero issues');
  assertEq(r1.todos[0].content, 'Read the plan doc', '(1) first content preserved');
  assertEq(r1.todos[0].status, 'completed', '(1) completed status preserved');
  assertEq(r1.todos[1].status, 'in_progress', '(1) in_progress status preserved');
  assertEq(r1.todos[2].status, 'pending', '(1) pending status preserved');

  // ─── (2) status normalization ─────────────────────────────────────────────
  const r2 = applyAgentTodoWrite([
    { content: 'unknown status', status: 'doing' },
    { content: 'missing status' },
    { content: 'numeric status', status: 7 },
  ]);
  assertEq(r2.todos.length, 3, '(2) items with bad status are kept (not skipped)');
  assertEq(r2.todos[0].status, 'pending', '(2) unknown status → pending');
  assertEq(r2.todos[1].status, 'pending', '(2) missing status → pending');
  assertEq(r2.todos[2].status, 'pending', '(2) non-string status → pending');
  assertEq(r2.issues.length, 3, '(2) one issue per coerced status');
  assert(hasIssue(r2, "unknown status"), '(2) unknown-status issue mentions the status problem');
  assert(hasIssue(r2, 'no status'), '(2) missing-status issue recorded');

  // ─── (3) bad content skipped ──────────────────────────────────────────────
  const r3 = applyAgentTodoWrite([
    { content: 'good one', status: 'pending' },
    { content: 42, status: 'pending' },
    { content: '   ', status: 'pending' },
    { content: '', status: 'pending' },
    { status: 'pending' },
    'just a string',
    null,
    [],
  ]);
  assertEq(r3.todos.length, 1, '(3) only the valid item survives');
  assertEq(r3.todos[0].content, 'good one', '(3) valid item content kept');
  assertEq(r3.issues.length, 7, '(3) one issue per skipped item');
  assert(hasIssue(r3, 'no string content'), '(3) non-string content issue recorded');
  assert(hasIssue(r3, 'empty content'), '(3) empty-after-trim issue recorded');
  assert(hasIssue(r3, 'not an object'), '(3) non-object item issue recorded');
  // whitespace is trimmed on kept items
  const r3b = applyAgentTodoWrite([{ content: '  padded  ', status: 'pending' }]);
  assertEq(r3b.todos[0].content, 'padded', '(3) content is trimmed');

  // ─── (4) content truncation at the exact cap boundary ────────────────────
  const atCap = 'a'.repeat(MAX_AGENT_TODO_CONTENT_CHARS);
  const overCap = 'b'.repeat(MAX_AGENT_TODO_CONTENT_CHARS + 1);
  const r4 = applyAgentTodoWrite([
    { content: atCap, status: 'pending' },
    { content: overCap, status: 'pending' },
  ]);
  assertEq(r4.todos[0].content, atCap, '(4) content at exactly the cap kept as-is');
  assertEq(r4.todos[0].content.length, MAX_AGENT_TODO_CONTENT_CHARS, '(4) at-cap length unchanged');
  assert(r4.todos[1].content.endsWith('…'), '(4) over-cap content ends with …');
  assertEq(r4.todos[1].content.length, MAX_AGENT_TODO_CONTENT_CHARS, '(4) truncated content fits the cap');
  assertEq(r4.issues.length, 1, '(4) exactly one truncation issue');
  assert(hasIssue(r4, 'truncated'), '(4) truncation issue recorded');

  // ─── (5) item cap with dropped-count issue ────────────────────────────────
  const many: AgentTodoItem[] = [];
  for (let i = 0; i < MAX_AGENT_TODO_ITEMS + 5; i += 1) {
    many.push({ content: `task ${i}`, status: 'pending' });
  }
  const r5 = applyAgentTodoWrite(many);
  assertEq(r5.todos.length, MAX_AGENT_TODO_ITEMS, '(5) list capped at MAX_AGENT_TODO_ITEMS');
  assertEq(r5.todos[0].content, 'task 0', '(5) cap keeps the head of the list');
  assertEq(r5.todos[MAX_AGENT_TODO_ITEMS - 1].content, `task ${MAX_AGENT_TODO_ITEMS - 1}`, '(5) last kept item is the cap boundary');
  assert(hasIssue(r5, '5 item(s) dropped'), '(5) issue records the dropped count');

  // ─── (6) multiple in_progress → first kept, later demoted ────────────────
  const r6 = applyAgentTodoWrite([
    { content: 'first active', status: 'in_progress' },
    { content: 'a done one', status: 'completed' },
    { content: 'second active', status: 'in_progress' },
    { content: 'third active', status: 'in_progress' },
  ]);
  assertEq(r6.todos[0].status, 'in_progress', '(6) first in_progress kept');
  assertEq(r6.todos[2].status, 'pending', '(6) second in_progress demoted to pending');
  assertEq(r6.todos[3].status, 'pending', '(6) third in_progress demoted to pending');
  assertEq(r6.todos.filter((t) => t.status === 'in_progress').length, 1, '(6) exactly one in_progress remains');
  assertEq(r6.issues.length, 2, '(6) one demotion issue per extra in_progress');
  assert(hasIssue(r6, 'demoted'), '(6) demotion issue recorded');

  // ─── (7) dedupe exact content (case-sensitive, first wins) ────────────────
  const r7 = applyAgentTodoWrite([
    { content: 'ship it', status: 'completed' },
    { content: 'ship it', status: 'pending' },
    { content: 'Ship it', status: 'pending' },
  ]);
  assertEq(r7.todos.length, 2, '(7) exact duplicate dropped; case-different kept');
  assertEq(r7.todos[0].status, 'completed', '(7) first occurrence (and its status) wins');
  assertEq(r7.todos[1].content, 'Ship it', '(7) case-sensitive: "Ship it" is not a duplicate');
  assert(hasIssue(r7, 'duplicates'), '(7) dedupe issue recorded');

  // ─── (8) order preservation ───────────────────────────────────────────────
  const r8 = applyAgentTodoWrite([
    { content: 'zeta', status: 'pending' },
    { content: 'alpha', status: 'completed' },
    { content: 'mid', status: 'in_progress' },
  ]);
  assertEq(r8.todos.map((t) => t.content).join(','), 'zeta,alpha,mid', '(8) incoming order preserved (no sorting)');

  // ─── (9) renderAgentTodoList formats ──────────────────────────────────────
  const list9: AgentTodoItem[] = [
    { content: 'done thing', status: 'completed' },
    { content: 'active thing', status: 'in_progress' },
    { content: 'todo thing', status: 'pending' },
    { content: 'done too', status: 'completed' },
  ];
  const rendered = renderAgentTodoList(list9);
  const lines = rendered.split('\n');
  assertEq(lines[0], 'TODO (2/4 done):', '(9) header shows done/total counts');
  assertEq(lines[1], '[x] done thing', '(9) completed renders [x]');
  assertEq(lines[2], '[>] active thing', '(9) in_progress renders [>]');
  assertEq(lines[3], '[ ] todo thing', '(9) pending renders [ ]');
  assertEq(lines[4], '[x] done too', '(9) second completed renders [x]');
  assertEq(lines.length, 5, '(9) one line per item plus header');
  assertEq(renderAgentTodoList([]), 'TODO list is empty.', '(9) empty array renders empty message');

  // ─── (10) summarizeAgentTodoProgress ─────────────────────────────────────
  assertEq(
    summarizeAgentTodoProgress(list9),
    '2/4 done; in progress: active thing',
    '(10) summary names the in-progress item'
  );
  assertEq(
    summarizeAgentTodoProgress([
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'pending' },
    ]),
    '1/2 done',
    '(10) summary without in_progress omits the clause'
  );
  assertEq(summarizeAgentTodoProgress([]), 'no TODO items', '(10) empty summary');

  // ─── (11) agentTodoStats ──────────────────────────────────────────────────
  const s11 = agentTodoStats(list9);
  assertEq(s11.total, 4, '(11) stats total');
  assertEq(s11.completed, 2, '(11) stats completed');
  assertEq(s11.inProgress, 1, '(11) stats inProgress');
  assertEq(s11.pending, 1, '(11) stats pending');
  const s11b = agentTodoStats([]);
  assertEq(s11b.total, 0, '(11) empty stats total 0');
  assertEq(s11b.completed + s11b.inProgress + s11b.pending, 0, '(11) empty stats all zero');

  // ─── (12) constants exported + sane ───────────────────────────────────────
  assertEq(MAX_AGENT_TODO_ITEMS, 20, '(12) MAX_AGENT_TODO_ITEMS default is 20');
  assertEq(MAX_AGENT_TODO_CONTENT_CHARS, 200, '(12) MAX_AGENT_TODO_CONTENT_CHARS default is 200');

  // ─── (13) degenerate / undefined never throws ─────────────────────────────
  try {
    // write
    const w1 = applyAgentTodoWrite(undefined);
    assertEq(w1.todos.length, 0, '(13) applyAgentTodoWrite(undefined) → empty list');
    assert(w1.issues.length > 0, '(13) non-array payload records an issue');
    assertEq(applyAgentTodoWrite(null).todos.length, 0, '(13) applyAgentTodoWrite(null) → empty');
    assertEq(applyAgentTodoWrite(42).todos.length, 0, '(13) applyAgentTodoWrite(number) → empty');
    assertEq(applyAgentTodoWrite('nope').todos.length, 0, '(13) applyAgentTodoWrite(string) → empty');
    assertEq(applyAgentTodoWrite({ content: 'x' }).todos.length, 0, '(13) applyAgentTodoWrite(object) → empty');
    assertEq(applyAgentTodoWrite([]).todos.length, 0, '(13) applyAgentTodoWrite([]) → empty, no throw');
    // render
    assertEq(renderAgentTodoList(undefined), 'TODO list is empty.', '(13) render(undefined) → empty message');
    assertEq(renderAgentTodoList(null), 'TODO list is empty.', '(13) render(null) → empty message');
    assertEq(renderAgentTodoList(99 as any), 'TODO list is empty.', '(13) render(number) → empty message');
    assertEq(
      renderAgentTodoList([null, 7, {}, { content: 5 }, { content: '  ' }, { content: 'ok', status: 'weird' }] as any),
      'TODO (0/1 done):\n[ ] ok',
      '(13) render salvages the one valid-ish item; bad status coerces to pending'
    );
    // summarize
    assertEq(summarizeAgentTodoProgress(undefined), 'no TODO items', '(13) summarize(undefined) → no TODO items');
    assertEq(summarizeAgentTodoProgress('x' as any), 'no TODO items', '(13) summarize(string) → no TODO items');
    // stats
    assertEq(agentTodoStats(undefined).total, 0, '(13) stats(undefined) → total 0');
    assertEq(agentTodoStats(null).total, 0, '(13) stats(null) → total 0');
    assertEq(agentTodoStats([null, { content: 'a', status: 'completed' }] as any).completed, 1, '(13) stats tolerates junk rows');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (13) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll agent-todo-core smoke cases passed (${passes} passed).`);
}

main();
