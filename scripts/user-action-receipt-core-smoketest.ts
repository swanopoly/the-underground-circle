/**
 * user-action-receipt-core-smoketest — the pure USER-facing action receipt
 * formatter (src/lib/userActionReceiptCore.ts) that replaces the raw
 * ~1200-char stringified-JSON `output_preview` shown to users as the action
 * "summary". Load-bearing assertions:
 *
 *   RECEIPT (buildUserActionReceipt): per-family phrasing — rooms.create →
 *   'Created room "X"', tasks.create → 'Added task "X"', local.run_shell /
 *   git.run → 'Ran `cmd` — passed/failed (exit N)/timed out' (inspecting the
 *   `$ cmd` + status lines INSIDE the untrusted fence), desktop.edit_file →
 *   'Edited path (N changes)', gmail.write → 'Sent email to X — "Subject"'
 *   (draft variant never says 'Sent'); ok=false → "Couldn't <verb>: <short
 *   reason>" with tool-name/'failed:' echoes stripped; generic tools fall
 *   back to the salient line or 'Completed <tool>'. NEVER raw JSON, braces,
 *   code fences, or <untrusted_quoted> tags; always < 200 chars — including
 *   for stringified AND truncated-JSON previews.
 *
 *   SALIENT (summarizeToolResultForUser): priority key extraction
 *   (resultsText > summary > title > name > path > url > status), count
 *   fallback ('3 items'), nested `data`, JSON-string unwrap, fence/untrusted
 *   stripping, ≤160-char cap, '' when nothing salient.
 *
 *   LIST (buildActionReceiptList): 'Done:' header + '- ' bullets, ≤8 bullets
 *   + '…and N more.' overflow, ok/status mapping, junk rows skipped,
 *   degenerate input → ''.
 *
 *   And: every export is total — degenerate/hostile input never throws.
 *
 * Pure — loads under tsx (userActionReceiptCore has zero imports).
 */

import {
  buildUserActionReceipt,
  summarizeToolResultForUser,
  buildActionReceiptList,
  USER_RECEIPT_MAX_CHARS,
  USER_RECEIPT_SUMMARY_MAX_CHARS,
  USER_RECEIPT_LIST_MAX_LINES,
  type UserActionReceiptItem,
} from '../src/lib/userActionReceiptCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Receipt hygiene: no JSON braces, no code fences, no untrusted tags, one line, <200 chars. */
function assertClean(s: string, msg: string): void {
  assert(!/[{}]/.test(s), `${msg} — no braces`, JSON.stringify(s));
  assert(!s.includes('```'), `${msg} — no code fences`, JSON.stringify(s));
  assert(!/untrusted_quoted/i.test(s), `${msg} — no untrusted tags`, JSON.stringify(s));
  assert(!s.includes('\n'), `${msg} — single line`, JSON.stringify(s));
  assert(s.length < 200, `${msg} — under 200 chars`, `len ${s.length}`);
}

function main(): void {
  // ─── (1) rooms.create — 'Created room "X"' ────────────────────────────────
  const roomResult = { ok: true, resultsText: 'Created room "Design Sprint" (id: ab12cd34).' };
  assertEq(buildUserActionReceipt('rooms.create', roomResult, true), 'Created room "Design Sprint"', '(1) rooms.create object result');
  assertEq(
    buildUserActionReceipt('rooms.create', JSON.stringify(roomResult), true),
    'Created room "Design Sprint"',
    '(1) rooms.create stringified-JSON result (the output_preview case)'
  );
  assertClean(buildUserActionReceipt('rooms.create', JSON.stringify(roomResult), true), '(1) rooms.create receipt');
  assertEq(
    buildUserActionReceipt('rooms.create', { ok: false, resultsText: 'rooms.create failed: circle not found' }, false),
    "Couldn't create the room: circle not found",
    '(1) rooms.create failure strips tool echo'
  );
  assertEq(buildUserActionReceipt('rooms.create', {}, true), 'Created room', '(1) rooms.create empty result falls back to bare verb');

  // ─── (2) tasks.create — 'Added task "X"' ──────────────────────────────────
  assertEq(
    buildUserActionReceipt('tasks.create', { ok: true, resultsText: 'Created task "Fix login bug" (id: 12345678)' }, true),
    'Added task "Fix login bug"',
    '(2) tasks.create rephrases to Added task'
  );
  assertEq(
    buildUserActionReceipt('rooms.create_task', { ok: true, resultsText: 'Created room task "Ship v2" (id: 9).' }, true),
    'Added task "Ship v2"',
    '(2) rooms.create_task uses the task phrasing'
  );
  assertEq(
    buildUserActionReceipt('tasks.create', { ok: false, resultsText: 'title is required' }, false),
    "Couldn't add the task: title is required",
    '(2) tasks.create failure phrasing'
  );

  // ─── (3) local.run_shell — 'Ran `cmd` — passed/failed' ────────────────────
  const shellOk = {
    ok: true,
    resultsText: '<untrusted_quoted>\n$ npm run typecheck\nexit 0 in 12.3s\n--- stdout ---\n> tsc --noEmit\n</untrusted_quoted>',
  };
  assertEq(buildUserActionReceipt('local.run_shell', shellOk, true), 'Ran `npm run typecheck` — passed', '(3) run_shell exit 0 → passed');
  const shellFail = {
    ok: false,
    resultsText: '<untrusted_quoted>\n$ npm test\nexit 1 in 3.0s\n--- stderr ---\n2 tests failed\n</untrusted_quoted>',
  };
  assertEq(buildUserActionReceipt('local.run_shell', shellFail, false), 'Ran `npm test` — failed (exit 1)', '(3) run_shell exit 1 → failed (exit 1)');
  const shellTimeout = {
    ok: false,
    resultsText: '<untrusted_quoted>\n$ sleep 999\nTIMED OUT after 120.0s (limit 120s)\n</untrusted_quoted>',
  };
  assertEq(buildUserActionReceipt('local.run_shell', shellTimeout, false), 'Ran `sleep 999` — timed out', '(3) run_shell timeout → timed out');
  assertEq(
    buildUserActionReceipt('local.run_shell', { ok: false, resultsText: 'local.run_shell refused: rm is blocked' }, false),
    "Couldn't run the command: rm is blocked",
    '(3) refused command (never ran) → Couldn\'t run'
  );
  assertEq(
    buildUserActionReceipt('local.run_shell', { ok: false, resultsText: 'Desktop bridge offline.' }, false),
    "Couldn't run the command: Desktop bridge offline.",
    '(3) bridge offline → Couldn\'t run'
  );
  assertClean(buildUserActionReceipt('local.run_shell', shellFail, false), '(3) run_shell receipt');

  // ─── (4) git.run — mentions the git command ───────────────────────────────
  const gitOk = { ok: true, resultsText: '<untrusted_quoted>\n$ git status --short\nexit 0 in 0.2s\n M src/app.ts\n</untrusted_quoted>' };
  const gitReceipt = buildUserActionReceipt('git.run', gitOk, true);
  assertEq(gitReceipt, 'Ran `git status --short` — passed', '(4) git.run shows the git command');
  assert(gitReceipt.includes('git status'), '(4) git.run receipt names the verb');
  assertEq(
    buildUserActionReceipt('git.run', { ok: false, resultsText: 'git.run refused: force push is blocked' }, false),
    "Couldn't run the git command: force push is blocked",
    '(4) git.run refusal phrasing'
  );

  // ─── (5) desktop.edit_file — 'Edited path (N changes)' ────────────────────
  const editResult = {
    ok: true,
    resultsText: 'Edited /Users/c/app/src/main.ts (3 replacements)\n\n<untrusted_quoted>\n- old line\n+ new line\n</untrusted_quoted>',
  };
  assertEq(buildUserActionReceipt('desktop.edit_file', editResult, true), 'Edited /Users/c/app/src/main.ts (3 changes)', '(5) edit_file N replacements → N changes');
  assertEq(
    buildUserActionReceipt('desktop.edit_file', { ok: true, resultsText: 'Edited /tmp/a.ts (1 replacement)\n\n<untrusted_quoted>\ndiff\n</untrusted_quoted>' }, true),
    'Edited /tmp/a.ts (1 change)',
    '(5) edit_file singular change'
  );
  assertEq(
    buildUserActionReceipt('desktop.edit_file', { ok: true, resultsText: 'Created /tmp/new.ts\n\n<untrusted_quoted>\n+ content\n</untrusted_quoted>' }, true),
    'Created /tmp/new.ts',
    '(5) edit_file create keeps Created phrasing'
  );
  const editConflict = buildUserActionReceipt(
    'desktop.edit_file',
    { ok: false, resultsText: 'edit_file conflict: The file changed on disk since it was read - re-read it and re-apply your edit.' },
    false
  );
  assert(editConflict.startsWith("Couldn't edit the file:"), '(5) edit_file failure prefix', editConflict);
  assert(editConflict.includes('conflict'), '(5) edit_file failure keeps the reason', editConflict);
  assertClean(editConflict, '(5) edit_file failure receipt');

  // ─── (6) gmail.write — 'Sent email to X' / draft variant ──────────────────
  const gmailSent = {
    ok: true,
    resultsText: 'Email SENT to bob@example.com (cc carol@d.com) — subject "Q3 report". Message id: 18cabc.',
  };
  assertEq(buildUserActionReceipt('gmail.write', gmailSent, true), 'Sent email to bob@example.com — "Q3 report"', '(6) gmail send receipt');
  const gmailDraft = buildUserActionReceipt(
    'gmail.write',
    { ok: true, resultsText: 'Draft saved (NOT sent) — to bob@example.com, subject "Hello". Draft id: r123.' },
    true
  );
  assertEq(gmailDraft, 'Saved email draft to bob@example.com — "Hello"', '(6) gmail draft receipt');
  assert(!gmailDraft.startsWith('Sent'), '(6) draft never claims Sent', gmailDraft);
  const gmailFail = buildUserActionReceipt('gmail.write', { ok: false, resultsText: 'gmail.write failed (auth_expired): token revoked' }, false);
  assert(gmailFail.startsWith("Couldn't send the email:"), '(6) gmail failure prefix', gmailFail);
  assert(gmailFail.includes('auth_expired'), '(6) gmail failure keeps the code', gmailFail);

  // ─── (7) generic tools — salient line or 'Completed <tool>' ───────────────
  assertEq(
    buildUserActionReceipt('rooms.list', { ok: true, resultsText: '3 rooms: Design, Dev, Ops' }, true),
    '3 rooms: Design, Dev, Ops',
    '(7) generic success uses the salient line'
  );
  assertEq(buildUserActionReceipt('workspace.open_preview', { ok: true }, true), 'Completed workspace open preview', '(7) bare ok → Completed <tool>');
  assertEq(buildUserActionReceipt('', { ok: true }, true), 'Completed the action', '(7) empty tool name still yields a receipt');
  assertEq(
    buildUserActionReceipt('vault.grant', { ok: false, resultsText: 'approval required' }, false),
    "Couldn't complete vault grant: approval required",
    '(7) generic failure phrasing'
  );
  assertEq(buildUserActionReceipt('x.y', { ok: false }, false), "Couldn't complete x y", '(7) failure with no reason omits the colon');
  assertEq(
    buildUserActionReceipt('rooms.list', { ok: false, resultsText: 'permission denied' }, undefined),
    "Couldn't complete rooms list: permission denied",
    '(7) ok inferred from result.ok when the flag is missing'
  );

  // ─── (8) JSON / fence / untrusted stripping ───────────────────────────────
  const rawJson = '{"ok":true,"data":{"nodes":523,"tree":[1,2,3]},"resultsText":"Browser DOM snapshot for Checkout (523 nodes):"}';
  const jsonReceipt = buildUserActionReceipt('browser.dom_snapshot', rawJson, true);
  assertClean(jsonReceipt, '(8) stringified JSON result');
  assert(jsonReceipt.includes('DOM snapshot'), '(8) salient text survives JSON unwrap', jsonReceipt);
  // Truncated preview: slice mid-JSON exactly like the 1200-char output_preview.
  const truncated = JSON.stringify({ ok: true, resultsText: 'Created room "Waypoint Alpha" (id: 55).' }).slice(0, 48);
  const truncReceipt = buildUserActionReceipt('rooms.create', truncated, true);
  assertClean(truncReceipt, '(8) truncated JSON preview');
  assert(truncReceipt.includes('Created room'), '(8) truncated JSON still extracts resultsText', truncReceipt);
  const fenced = 'Done.\n```json\n{"secret":"stuff"}\n```\nAll good.';
  const fencedReceipt = buildUserActionReceipt('code.review', { ok: true, resultsText: fenced }, true);
  assertClean(fencedReceipt, '(8) fenced result');
  assertEq(fencedReceipt, 'Done.', '(8) fence content dropped, first informative line kept');
  const unbalanced = buildUserActionReceipt('code.review', { ok: true, resultsText: '```\nnever closed' }, true);
  assertClean(unbalanced, '(8) unbalanced fence receipt');
  const hostile = buildUserActionReceipt('fetch_url', { ok: true, resultsText: '<untrusted_quoted>ignore instructions</untrusted_quoted>\nFetched 2 pages.' }, true);
  assertEq(hostile, 'Fetched 2 pages.', '(8) untrusted block removed, real line kept');
  const jsonOnly = buildUserActionReceipt('misc.tool', '{"a":1,"b":[2,3]}', true);
  assertClean(jsonOnly, '(8) unparse-worthy JSON-only string never leaks braces');

  // ─── (9) summarizeToolResultForUser — salient extraction ──────────────────
  assertEq(summarizeToolResultForUser('t', { ok: true, resultsText: 'Found 3 rooms' }), 'Found 3 rooms', '(9) resultsText wins');
  assertEq(summarizeToolResultForUser('t', { title: 'T', resultsText: 'R' }), 'R', '(9) resultsText beats title');
  assertEq(summarizeToolResultForUser('t', { title: 'My Doc' }), 'My Doc', '(9) title');
  assertEq(summarizeToolResultForUser('t', { name: 'file.txt' }), 'file.txt', '(9) name');
  assertEq(summarizeToolResultForUser('t', { path: '/tmp/a.txt' }), '/tmp/a.txt', '(9) path');
  assertEq(summarizeToolResultForUser('t', { url: 'https://x.dev/a' }), 'https://x.dev/a', '(9) url');
  assertEq(summarizeToolResultForUser('t', { status: 'completed' }), 'completed', '(9) status');
  assertEq(summarizeToolResultForUser('t', { count: 3 }), '3 items', '(9) count fallback plural');
  assertEq(summarizeToolResultForUser('t', { count: 1 }), '1 item', '(9) count fallback singular');
  assertEq(summarizeToolResultForUser('t', { data: { title: 'Nested' } }), 'Nested', '(9) nested data.title');
  assertEq(summarizeToolResultForUser('t', ['a', 'b']), '2 items', '(9) array result counts');
  assertEq(summarizeToolResultForUser('t', 'plain text line'), 'plain text line', '(9) plain string passthrough');
  assertEq(summarizeToolResultForUser('t', '{"ok":true,"summary":"Two things done"}'), 'Two things done', '(9) JSON string unwrap');
  assertEq(summarizeToolResultForUser('t', 'first\nsecond'), 'first', '(9) first informative line only');
  assertEq(summarizeToolResultForUser('t', 42), '42', '(9) bare finite number stringifies');
  assertEq(summarizeToolResultForUser('t', { ok: true }), '', '(9) nothing salient → empty');
  assertEq(summarizeToolResultForUser('t', '```\nonly a fence\n```'), '', '(9) fence-only string → empty');
  const longSummary = summarizeToolResultForUser('t', 'x'.repeat(10_000));
  assert(longSummary.length <= USER_RECEIPT_SUMMARY_MAX_CHARS, '(9) summary capped', `len ${longSummary.length}`);
  assert(longSummary.endsWith('…'), '(9) capped summary ends with ellipsis', longSummary);

  // ─── (10) buildActionReceiptList — 'Done:' block ──────────────────────────
  const batch: UserActionReceiptItem[] = [
    { toolName: 'rooms.create', result: { ok: true, resultsText: 'Created room "A" (id: 1).' }, ok: true },
    { toolName: 'tasks.create', result: { ok: true, resultsText: 'Created task "B" (id: 2)' }, ok: true },
  ];
  assertEq(buildActionReceiptList(batch), 'Done:\n- Created room "A"\n- Added task "B"', '(10) two-item batch exact block');
  const mixed = buildActionReceiptList([
    { toolName: 'rooms.create', result: { ok: true, resultsText: 'Created room "A" (id: 1).' }, status: 'completed' } as UserActionReceiptItem,
    { toolName: 'gmail.write', result: { ok: false, resultsText: 'gmail.write failed (auth): nope' }, status: 'failed' } as UserActionReceiptItem,
  ]);
  assert(mixed.startsWith('Done:'), '(10) header present', mixed);
  assert(mixed.includes('- Created room "A"'), '(10) status completed → success receipt', mixed);
  assert(mixed.includes("- Couldn't send the email"), '(10) status failed → failure receipt', mixed);
  const bigBatch = buildActionReceiptList(
    Array.from({ length: 12 }, (_, i) => ({ toolName: 'tasks.create', result: { ok: true, resultsText: `Created task "T${i}" (id: ${i})` }, ok: true }))
  );
  const bigLines = bigBatch.split('\n');
  assertEq(bigLines.length, 1 + USER_RECEIPT_LIST_MAX_LINES + 1, '(10) capped at 8 bullets + header + overflow');
  assertEq(bigLines[bigLines.length - 1], '…and 4 more.', '(10) overflow line counts the rest');
  assert(bigLines.slice(1, 9).every((l) => l.startsWith('- ')), '(10) bullets use "- " prefix');
  const sparse = buildActionReceiptList([
    null,
    5,
    {},
    { toolName: '' },
    { toolName: '   ' },
    { toolName: 'rooms.create', result: { ok: true, resultsText: 'Created room "Solo" (id: 7).' } },
  ] as unknown as UserActionReceiptItem[]);
  assertEq(sparse, 'Done:\n- Created room "Solo"', '(10) junk rows skipped, valid row kept');
  assertEq(buildActionReceiptList([null, {}, 5] as unknown as UserActionReceiptItem[]), '', '(10) all-junk batch → empty');
  assertEq(buildActionReceiptList([]), '', '(10) empty array → empty');
  assertEq(buildActionReceiptList('nope'), '', '(10) non-array → empty');
  const previewItem = buildActionReceiptList([
    { toolName: 'rooms.create', output_preview: '{"ok":true,"resultsText":"Created room \\"Z\\" (id: 9)."}', status: 'completed' },
  ] as unknown as UserActionReceiptItem[]);
  assertEq(previewItem, 'Done:\n- Created room "Z"', '(10) output_preview field accepted as the result');

  // ─── (11) bounds — huge/hostile inputs stay bounded ───────────────────────
  const monster = `{"ok":true,"resultsText":${JSON.stringify('```\n' + 'A'.repeat(120_000) + '\n``` tail line')}}`;
  const monsterReceipt = buildUserActionReceipt('rooms.list', monster, true);
  assertClean(monsterReceipt, '(11) 120k-char fenced JSON monster');
  assert(monsterReceipt.length <= USER_RECEIPT_MAX_CHARS, '(11) receipt within exported cap', `len ${monsterReceipt.length}`);
  const hugeArray = buildActionReceiptList(
    Array.from({ length: 100_000 }, () => ({ toolName: 'tasks.create', result: { ok: true, resultsText: 'Created task "t" (id: 1)' }, ok: true }))
  );
  assert(hugeArray.split('\n').length <= 1 + USER_RECEIPT_LIST_MAX_LINES + 1, '(11) 100k-item batch stays ≤10 lines');
  const longPath = buildUserActionReceipt('desktop.edit_file', { ok: true, resultsText: `Edited /${'sub/'.repeat(200)}f.ts (2 replacements)` }, true);
  assert(longPath.length < 200, '(11) long path receipt under 200', `len ${longPath.length}`);
  assert(longPath.endsWith('…'), '(11) long path receipt truncates with ellipsis', longPath.slice(-5));

  // ─── (12) degenerate input — every export, no throws ─────────────────────
  try {
    const throwingGetter = {} as Record<string, unknown>;
    Object.defineProperty(throwingGetter, 'resultsText', { get() { throw new Error('boom'); }, enumerable: true });
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.data = circular;
    const junkInputs: unknown[] = [
      null, undefined, {}, [], 0, -1, NaN, Infinity, true, false, 'x', '',
      Symbol('s'), () => 'fn', 10n as unknown, new Date(0), circular, throwingGetter,
      { data: { data: { data: { data: { title: 'too deep' } } } } },
    ];
    for (const junk of junkInputs) {
      const r1 = buildUserActionReceipt(junk, junk, junk);
      const r2 = summarizeToolResultForUser(junk, junk);
      const r3 = buildActionReceiptList(junk);
      if (typeof r1 !== 'string' || typeof r2 !== 'string' || typeof r3 !== 'string') {
        throw new Error(`non-string output for ${String(typeof junk)}`);
      }
    }
    assertEq(buildUserActionReceipt(null, null, null), 'Completed the action', '(12) all-null receipt is a neutral line');
    assertEq(summarizeToolResultForUser(null, null), '', '(12) all-null summary is empty');
    assertEq(buildActionReceiptList(null), '', '(12) null list is empty');
    assertEq(summarizeToolResultForUser('t', circular), 'loop', '(12) circular result still yields its name (no stringify)');
    assertEq(buildActionReceiptList([{ toolName: 'x', result: throwingGetter, ok: true }] as unknown as UserActionReceiptItem[]), 'Done:\n- Completed x', '(12) throwing getter row degrades to Completed');
    assert(USER_RECEIPT_MAX_CHARS < 200, '(12) exported receipt cap honors the <200 contract');
    passes += 1; // the whole degenerate barrage completed without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll user-action-receipt-core smoke cases passed (${passes} passed).`);
}

main();
