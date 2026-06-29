/**
 * scriptable-mac-apps-smoketest — verifies the AppleScript knowledge layer
 * that lets the agent drive scriptable Mac apps without a per-app adapter.
 *
 * Run: npm run smoke:scriptable-mac-apps
 */

import assert from 'node:assert/strict';
import {
  isScriptableMacApp,
  canonicalScriptableApp,
  buildCreateNoteProgram,
  buildCreateReminderProgram,
  buildScriptableProgram,
  buildRawAppleScriptProgram,
  buildProgramFromToolInput,
} from '../src/lib/scriptableMacApps';

// ─── scriptable-app detection ────────────────────────────────────────────────
assert.equal(isScriptableMacApp('Notes'), true, 'Notes is scriptable');
assert.equal(isScriptableMacApp('apple notes'), true, 'alias resolves');
assert.equal(isScriptableMacApp('Reminders'), true, 'Reminders is scriptable');
assert.equal(isScriptableMacApp('Calendar'), true, 'Calendar is scriptable');
assert.equal(isScriptableMacApp('Photoshop'), false, 'Photoshop is not in the scriptable common-app set');
assert.equal(isScriptableMacApp(''), false, 'empty is not scriptable');
assert.equal(isScriptableMacApp(null), false, 'null is not scriptable');
assert.equal(canonicalScriptableApp('iCal'), 'calendar', 'iCal canonicalizes to calendar');
assert.equal(canonicalScriptableApp('System Events'), 'system events', 'system events canonicalizes');

// ─── create-note recipe ──────────────────────────────────────────────────────
{
  const p = buildCreateNoteProgram({ body: 'hell ya fuckin right bitch' });
  // Uses the safe on-run-argv pattern; user text travels as argv, not inline.
  assert.ok(p.scriptLines.includes('on run argv'), 'note program uses on run argv');
  assert.ok(p.scriptLines.some((l) => l.includes('make new note')), 'note program creates a note');
  assert.equal(p.args[0], 'hell ya fuckin right bitch', 'note body passed as argv, unescaped');
  // No user content is interpolated into the script lines themselves.
  assert.ok(!p.scriptLines.some((l) => l.includes('hell ya')), 'user text is NOT inlined into the script (injection-safe)');
  assert.ok(p.summary.includes('Create a Notes note'), 'note summary describes the effect');
}

// Title becomes the first line so the note is named as requested.
{
  const p = buildCreateNoteProgram({ body: 'the body', title: 'My Title' });
  assert.equal(p.args[0], 'My Title\nthe body', 'title prepended to body as first line');
}

// ─── create-reminder recipe ──────────────────────────────────────────────────
{
  const p = buildCreateReminderProgram({ text: 'buy milk' });
  assert.ok(p.scriptLines.some((l) => l.includes('make new reminder')), 'reminder program creates a reminder');
  assert.equal(p.args[0], 'buy milk', 'reminder text as argv');
  assert.equal(p.args[1], '', 'no list -> empty list arg');
  const withList = buildCreateReminderProgram({ text: 'buy milk', listName: 'Groceries' });
  assert.equal(withList.args[1], 'Groceries', 'list name passed as argv');
  assert.ok(withList.summary.includes('Groceries'), 'summary names the list');
}

// ─── intent dispatcher ───────────────────────────────────────────────────────
{
  const note = buildScriptableProgram('create_note', { text: 'hi' });
  assert.ok(note && note.args[0] === 'hi', 'dispatcher maps create_note (text alias)');
  const rem = buildScriptableProgram('create_reminder', { text: 'call mom' });
  assert.ok(rem && rem.args[0] === 'call mom', 'dispatcher maps create_reminder');
  assert.equal(buildScriptableProgram('create_note', { body: '' })?.args[0], '', 'empty body still builds (caller validates)');
}

// ─── raw research-path program (any app the agent figured out) ───────────────
{
  const raw = buildRawAppleScriptProgram(
    ['on run argv', 'tell application "Music" to play', 'end run'],
    [],
    'Play Music',
  );
  assert.ok(raw && raw.scriptLines.length === 3, 'raw program passes through script lines');
  assert.equal(raw!.summary, 'Play Music', 'raw summary preserved');
  assert.equal(buildRawAppleScriptProgram([], []), null, 'empty raw program -> null');
  // Oversized script is rejected so a runaway can't be posted.
  const huge = buildRawAppleScriptProgram(['x'.repeat(11_000)], []);
  assert.equal(huge, null, 'oversized raw program rejected');
  // argv is bounded.
  const manyArgs = buildRawAppleScriptProgram(['on run argv', 'return 1', 'end run'], Array(40).fill('a'));
  assert.ok(manyArgs && manyArgs.args.length <= 16, 'raw program args bounded to 16');
}

// ─── buildProgramFromToolInput (the desktop.run_applescript tool glue) ───────
{
  // Recipe via intent + params (what the model sends).
  const note = buildProgramFromToolInput({ intent: 'create_note', params: { body: 'hello' } });
  assert.ok(note && note.args[0] === 'hello', 'tool input: intent+params -> note program');
  // Recipe with params at the top level (model omitted the params wrapper).
  const flat = buildProgramFromToolInput({ intent: 'create_reminder', text: 'call mom' });
  assert.ok(flat && flat.args[0] === 'call mom', 'tool input: top-level params tolerated');
  // Raw research path.
  const raw = buildProgramFromToolInput({ scriptLines: ['on run argv', 'tell application "Music" to play', 'end run'], args: [] });
  assert.ok(raw && raw.scriptLines.length === 3, 'tool input: raw scriptLines -> program');
  // Nothing usable -> null (caller fails with a clear message).
  assert.equal(buildProgramFromToolInput({}), null, 'tool input: empty -> null');
  assert.equal(buildProgramFromToolInput(null), null, 'tool input: null -> null');
  assert.equal(buildProgramFromToolInput({ intent: 'unknown_intent' }), null, 'tool input: unknown intent + no scriptLines -> null');
}

console.log('All scriptable-mac-apps smoke cases passed.');
