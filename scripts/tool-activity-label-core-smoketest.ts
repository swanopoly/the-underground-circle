/**
 * tool-activity-label-core-smoketest — pins the pure tool → present-tense
 * activity label core (src/lib/toolActivityLabelCore.ts) that replaces the
 * generic rotating "is typing…" verb during stream-escalated tool loops and
 * SwanBot v2 client-tool continuations. Load-bearing assertions:
 *
 *   MAP: the 16 spec'd tool labels are exact ("rooms.create" → "Creating the
 *   room…", "verification.tests" → "Running tests…", …); the map is frozen,
 *   has 25+ entries, and every key is canonical lowercase with a bounded
 *   non-empty label ending in "…".
 *
 *   REFINEMENT: local.run_shell derives "Running npm test…" from argv (path
 *   basenames, character whitelisting, per-token + total caps) and git.run
 *   derives "git commit…" from its verb field; both fall back to their base
 *   map labels on junk/hostile args.
 *
 *   DERIVATION: unknown tools resolve through family/verb — "x.create" →
 *   "Creating…", "*.list_posts" → "Loading…", "verification.*" → "Checking…"
 *   — and bottom out at "Working…". toolFamilyVerb returns the bare canonical
 *   verb ('create', 'read', 'run', 'search', …) or 'work', including for
 *   prototype-key names like "constructor".
 *
 *   TOTALITY: every export survives null / undefined / wrong types / Proxies
 *   with throwing getters / megabyte strings without throwing, and every
 *   label stays a non-empty, control-char-free string of at most 80 chars.
 *
 * Pure — loads under tsx (toolActivityLabelCore has zero imports).
 */

import {
  TOOL_ACTIVITY_LABELS,
  MAX_ACTIVITY_LABEL_CHARS,
  FALLBACK_ACTIVITY_LABEL,
  toolActivityLabel,
  toolFamilyVerb,
} from '../src/lib/toolActivityLabelCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 32 || (c >= 127 && c <= 159)) return true;
  }
  return false;
}

function isBoundedLabel(s: unknown): boolean {
  return typeof s === 'string' && s.length > 0 && s.length <= MAX_ACTIVITY_LABEL_CHARS && !hasControlChars(s);
}

function main(): void {
  // ─── (1) TOOL_ACTIVITY_LABELS map shape + the 16 spec'd entries ───────────
  assertEq(TOOL_ACTIVITY_LABELS['rooms.create'], 'Creating the room…', '(1) rooms.create label');
  assertEq(TOOL_ACTIVITY_LABELS['tasks.create'], 'Adding the task…', '(1) tasks.create label');
  assertEq(TOOL_ACTIVITY_LABELS['local.run_shell'], 'Running the command…', '(1) local.run_shell label');
  assertEq(TOOL_ACTIVITY_LABELS['git.run'], 'Checking git…', '(1) git.run label');
  assertEq(TOOL_ACTIVITY_LABELS['verification.tests'], 'Running tests…', '(1) verification.tests label');
  assertEq(TOOL_ACTIVITY_LABELS['verification.typecheck'], 'Type-checking…', '(1) verification.typecheck label');
  assertEq(TOOL_ACTIVITY_LABELS['desktop.read_a11y_tree'], 'Reading the screen…', '(1) desktop.read_a11y_tree label');
  assertEq(TOOL_ACTIVITY_LABELS['desktop.screenshot'], 'Taking a screenshot…', '(1) desktop.screenshot label');
  assertEq(TOOL_ACTIVITY_LABELS['browser.open_url'], 'Opening the page…', '(1) browser.open_url label');
  assertEq(TOOL_ACTIVITY_LABELS['browser.dom_snapshot'], 'Reading the page…', '(1) browser.dom_snapshot label');
  assertEq(TOOL_ACTIVITY_LABELS['codebase.search'], 'Searching the codebase…', '(1) codebase.search label');
  assertEq(TOOL_ACTIVITY_LABELS['desktop.edit_file'], 'Editing the file…', '(1) desktop.edit_file label');
  assertEq(TOOL_ACTIVITY_LABELS['save_memory'], 'Saving to memory…', '(1) save_memory label');
  assertEq(TOOL_ACTIVITY_LABELS['search_memories'], 'Recalling…', '(1) search_memories label');
  assertEq(TOOL_ACTIVITY_LABELS['fetch_url'], 'Fetching…', '(1) fetch_url label');
  assertEq(TOOL_ACTIVITY_LABELS['gmail.write'], 'Sending the email…', '(1) gmail.write label');
  const keys = Object.keys(TOOL_ACTIVITY_LABELS);
  assert(keys.length >= 25, '(1) map covers 25+ common tools', `got ${keys.length}`);
  assert(Object.isFrozen(TOOL_ACTIVITY_LABELS), '(1) map is frozen');
  try { (TOOL_ACTIVITY_LABELS as Record<string, string>)['rooms.create'] = 'HACKED'; } catch { /* frozen throws in strict mode */ }
  assertEq(TOOL_ACTIVITY_LABELS['rooms.create'], 'Creating the room…', '(1) map is immutable after write attempt');
  assert(keys.every((k) => k === k.trim() && k === k.toLowerCase()), '(1) every key is canonical trimmed lowercase');
  assert(
    keys.every((k) => isBoundedLabel(TOOL_ACTIVITY_LABELS[k]) && (TOOL_ACTIVITY_LABELS[k] as string).endsWith('…')),
    '(1) every label is bounded, non-empty, control-free, ends with ellipsis',
  );
  assertEq(MAX_ACTIVITY_LABEL_CHARS, 80, '(1) MAX_ACTIVITY_LABEL_CHARS is 80');
  assertEq(FALLBACK_ACTIVITY_LABEL, 'Working…', '(1) FALLBACK_ACTIVITY_LABEL is Working…');

  // ─── (2) toolActivityLabel direct map lookups ─────────────────────────────
  assertEq(toolActivityLabel('rooms.create'), 'Creating the room…', '(2) rooms.create lookup');
  assertEq(toolActivityLabel('verification.typecheck'), 'Type-checking…', '(2) verification.typecheck lookup');
  assertEq(toolActivityLabel('desktop.read_a11y_tree'), 'Reading the screen…', '(2) desktop.read_a11y_tree lookup');
  assertEq(toolActivityLabel('browser.dom_snapshot'), 'Reading the page…', '(2) browser.dom_snapshot lookup');
  assertEq(toolActivityLabel('save_memory'), 'Saving to memory…', '(2) save_memory lookup');
  assertEq(toolActivityLabel('gmail.write'), 'Sending the email…', '(2) gmail.write lookup');
  assertEq(toolActivityLabel('ROOMS.CREATE'), 'Creating the room…', '(2) lookup is case-insensitive');
  assertEq(toolActivityLabel('  codebase.search  '), 'Searching the codebase…', '(2) lookup trims whitespace');
  assertEq(toolActivityLabel('gsheets.write'), 'Updating the sheet…', '(2) gsheets.write lookup');
  assertEq(toolActivityLabel('todo.write'), 'Updating the plan…', '(2) todo.write lookup');

  // ─── (3) local.run_shell refinement from args ─────────────────────────────
  assertEq(toolActivityLabel('local.run_shell'), 'Running the command…', '(3) no args → base label');
  assertEq(toolActivityLabel('local.run_shell', null), 'Running the command…', '(3) null args → base label');
  assertEq(toolActivityLabel('local.run_shell', { argv: ['npm', 'test'] }), 'Running npm test…', '(3) argv npm test');
  assertEq(toolActivityLabel('local.run_shell', { argv: ['npx', 'tsx', 'scripts/x.ts'] }), 'Running npx tsx…', '(3) argv trims to first two words');
  assertEq(toolActivityLabel('local.run_shell', { argv: ['/opt/homebrew/bin/node', 'server.js'] }), 'Running node server.js…', '(3) argv0 path reduced to basename');
  assertEq(toolActivityLabel('local.run_shell', { command: 'npm run typecheck' }), 'Running npm run…', '(3) command-string fallback shape');
  assertEq(toolActivityLabel('local.run_shell', { argv: [] }), 'Running the command…', '(3) empty argv → base label');
  assertEq(toolActivityLabel('local.run_shell', { argv: [42, {}, null, 'ls', '-la'] }), 'Running ls -la…', '(3) non-string argv entries skipped');
  assertEq(
    toolActivityLabel('local.run_shell', { argv: [`${BEL}npm`, `te${NUL}st`] }),
    'Running npm test…',
    '(3) control bytes stripped from argv tokens',
  );
  const hugeShell = toolActivityLabel('local.run_shell', { argv: ['a'.repeat(500), 'b'.repeat(500)] });
  assert(isBoundedLabel(hugeShell), '(3) huge argv stays bounded', `len ${hugeShell.length}`);
  assert(hugeShell.startsWith('Running a'), '(3) huge argv still names the command', hugeShell.slice(0, 20));
  assertEq(toolActivityLabel('local.run_shell', { argv: 'not-an-array' }), 'Running the command…', '(3) non-array argv → base label');

  // ─── (4) git.run refinement from args ─────────────────────────────────────
  assertEq(toolActivityLabel('git.run'), 'Checking git…', '(4) no args → base label');
  assertEq(toolActivityLabel('git.run', { verb: 'commit' }), 'git commit…', '(4) verb commit');
  assertEq(toolActivityLabel('git.run', { verb: 'PUSH' }), 'git push…', '(4) verb lowercased');
  assertEq(toolActivityLabel('git.run', { verb: 'sta tus;rm' }), 'git statusrm…', '(4) verb sanitized to safe charset');
  assertEq(toolActivityLabel('git.run', { verb: '' }), 'Checking git…', '(4) empty verb → base label');
  assertEq(toolActivityLabel('git.run', { verb: 123 }), 'Checking git…', '(4) non-string verb → base label');
  const hugeGit = toolActivityLabel('git.run', { verb: 'x'.repeat(300) });
  assert(isBoundedLabel(hugeGit), '(4) huge verb stays bounded', `len ${hugeGit.length}`);
  assert(hugeGit.startsWith('git x'), '(4) huge verb still reads as git', hugeGit.slice(0, 10));

  // ─── (5) unknown tools derive from family/verb ────────────────────────────
  assertEq(toolActivityLabel('x.create'), 'Creating…', '(5) x.create → Creating…');
  assertEq(toolActivityLabel('wp.list_posts'), 'Loading…', '(5) wp.list_posts → Loading…');
  assertEq(toolActivityLabel('missions.create_task'), 'Creating…', '(5) missions.create_task → Creating…');
  assertEq(toolActivityLabel('desktop.file_trash'), 'Removing…', '(5) desktop.file_trash → Removing…');
  assertEq(toolActivityLabel('goals.update_progress'), 'Updating…', '(5) goals.update_progress → Updating…');
  assertEq(toolActivityLabel('memory.forget'), 'Removing…', '(5) memory.forget → Removing…');
  assertEq(toolActivityLabel('desktop.run_applescript'), 'Running…', '(5) desktop.run_applescript → Running…');
  assertEq(toolActivityLabel('anything.search_stuff'), 'Searching…', '(5) *.search_* → Searching…');
  assertEq(toolActivityLabel('verification.security_scan'), 'Checking…', '(5) verification family fallback → Checking…');
  assertEq(toolActivityLabel('desktop.focus_app'), 'Opening…', '(5) focus synonym → Opening…');
  assertEq(toolActivityLabel('github.list_repos'), 'Loading…', '(5) github.list_repos → Loading…');
  assertEq(toolActivityLabel('messages.search'), 'Searching…', '(5) messages.search → Searching…');
  assertEq(toolActivityLabel('foo.frobnicate'), 'Working…', '(5) unrecognizable action → Working…');
  assertEq(toolActivityLabel('nodotsnoverb'), 'Working…', '(5) dot-less unknown name → Working…');
  assertEq(toolActivityLabel('constructor'), 'Working…', '(5) prototype key name → Working…');
  assertEq(toolActivityLabel('constructor.frobnicate'), 'Working…', '(5) prototype key family → Working…');

  // ─── (6) toolFamilyVerb bare verbs ────────────────────────────────────────
  assertEq(toolFamilyVerb('rooms.create'), 'create', '(6) rooms.create → create');
  assertEq(toolFamilyVerb('desktop.file_read'), 'read', '(6) desktop.file_read → read');
  assertEq(toolFamilyVerb('local.run_shell'), 'run', '(6) local.run_shell → run');
  assertEq(toolFamilyVerb('codebase.search'), 'search', '(6) codebase.search → search');
  assertEq(toolFamilyVerb('tasks.list'), 'list', '(6) tasks.list → list');
  assertEq(toolFamilyVerb('gmail.write'), 'write', '(6) gmail.write → write');
  assertEq(toolFamilyVerb('memory.forget'), 'delete', '(6) memory.forget → delete');
  assertEq(toolFamilyVerb('desktop.launch_app'), 'open', '(6) desktop.launch_app → open');
  assertEq(toolFamilyVerb('verification.tests'), 'check', '(6) verification.tests → check (plural strip)');
  assertEq(toolFamilyVerb('verification.typecheck'), 'check', '(6) verification.typecheck → check (family fallback)');
  assertEq(toolFamilyVerb('fetch_url'), 'read', '(6) fetch_url → read');
  assertEq(toolFamilyVerb('save_memory'), 'save', '(6) save_memory → save');
  assertEq(toolFamilyVerb('browser.dom_snapshot'), 'read', '(6) browser.dom_snapshot → read');
  assertEq(toolFamilyVerb('TASKS.LIST'), 'list', '(6) verb lookup is case-insensitive');
  assertEq(toolFamilyVerb('messaging.notify'), 'send', '(6) messaging.notify → send');
  assertEq(toolFamilyVerb('desktop.click_element'), 'click', '(6) desktop.click_element → click');
  assertEq(toolFamilyVerb('rooms.rename'), 'update', '(6) rooms.rename → update');
  assertEq(toolFamilyVerb('desktop.file_trash'), 'delete', '(6) desktop.file_trash → delete');
  assertEq(toolFamilyVerb('x.constructor'), 'work', '(6) prototype key action → work');
  assertEq(toolFamilyVerb(null), 'work', '(6) null → work');
  assertEq(toolFamilyVerb(''), 'work', '(6) empty string → work');

  // ─── (7) bounds + user-safety on hostile strings ──────────────────────────
  assertEq(toolActivityLabel('a'.repeat(5000)), 'Working…', '(7) 5000-char tool name → Working…');
  assertEq(toolActivityLabel(`rooms${NUL}.create`), 'Creating…', '(7) NUL inside name still derives the verb');
  const escLabel = toolActivityLabel('local.run_shell', { argv: [`${ESC}[31mred`, 'x'] });
  assert(!hasControlChars(escLabel), '(7) ANSI escape bytes never reach the label', JSON.stringify(escLabel));
  const fuzzNames: unknown[] = [
    'rooms.create', 'x.create', 'foo.frobnicate', 'constructor', '__proto__', 'a'.repeat(300),
    `b${NUL}c`, ' spaced.name ', 'UPPER.CASE', 'dots...everywhere', '.', '..', '_', 'x.', '.x',
  ];
  assert(fuzzNames.every((n) => isBoundedLabel(toolActivityLabel(n))), '(7) every fuzz name yields a bounded non-empty label');
  assert(
    fuzzNames.every((n) => {
      const v = toolFamilyVerb(n);
      return typeof v === 'string' && v.length > 0 && v === v.toLowerCase();
    }),
    '(7) every fuzz name yields a non-empty lowercase verb',
  );
  const hugeCommand = toolActivityLabel('local.run_shell', { command: 'x'.repeat(100000) });
  assert(isBoundedLabel(hugeCommand), '(7) 100k-char command string stays bounded', `len ${hugeCommand.length}`);

  // ─── (8) degenerate/hostile inputs never throw at any export ──────────────
  try {
    const junk: unknown[] = [
      null, undefined, {}, [], ['x'], 0, -1, Number.NaN, Number.POSITIVE_INFINITY, true, false, 42.5,
      '', '   ', Symbol('s'), () => 'x', { name: {} }, { argv: { deep: [{}] } }, { command: 9 },
      new Map(), new Set(), { verb: ['commit'] },
    ];
    for (const j of junk) {
      const a = toolActivityLabel(j);
      const b = toolActivityLabel(j, j);
      const c = toolActivityLabel('local.run_shell', j);
      const d = toolActivityLabel('git.run', j);
      const v = toolFamilyVerb(j);
      if (![a, b, c, d].every((s) => typeof s === 'string' && s.length > 0) || typeof v !== 'string' || v.length === 0) {
        assert(false, '(8) degenerate input produced an empty or non-string result', String(j));
      }
    }
    const evil = new Proxy({}, { get() { throw new Error('boom'); } });
    assertEq(toolActivityLabel('local.run_shell', evil), 'Running the command…', '(8) throwing-getter args → base run_shell label');
    assertEq(toolActivityLabel('git.run', evil), 'Checking git…', '(8) throwing-getter args → base git label');
    assertEq(toolActivityLabel(evil), 'Working…', '(8) throwing-getter tool name → fallback');
    assertEq(toolFamilyVerb(evil), 'work', '(8) throwing-getter tool name → work');
    const toStringBomb = { toString() { throw new Error('nope'); } };
    assertEq(toolActivityLabel(toStringBomb), 'Working…', '(8) toString bomb name → fallback');
    assertEq(toolFamilyVerb(toStringBomb), 'work', '(8) toString bomb name → work');
    assertEq(TOOL_ACTIVITY_LABELS['no.such_tool'], undefined, '(8) missing map key reads as undefined');
    assert(true, '(8) full degenerate barrage completed without throwing');
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (8) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll tool-activity-label-core smoke cases passed (${passes} passed).`);
}

main();
