/**
 * chat-composer-seed-core-smoketest — verifies src/lib/chatComposerSeedCore.ts.
 *
 * The cross-surface composer-seed protocol: empty-state chips dispatch a
 * `uc:seed-composer` CustomEvent before `uc:switch-tab` so ChatTab can
 * pre-fill its composer. Both sides of the protocol are under test:
 *
 *   BUILD (sender): only well-formed chat text / real-shaped slash commands
 *   become payloads — handler tokens (office:*), shell-ish paths, control
 *   chars, oversize, and empties are rejected or normalized.
 *
 *   PARSE (receiver): total over hostile event detail — any page script can
 *   dispatch this event, so objects, numbers, nested junk, and forged carets
 *   must never throw and never inject un-validated text.
 *
 *   ROUND-TRIP: parse(build(x)) is deep-equal to build(x) for every accepted
 *   seed, and the caret always lands at end-of-text when built.
 *
 * Run: npx tsx scripts/chat-composer-seed-core-smoketest.ts
 */

import assert from 'node:assert/strict';

import {
  SEED_EVENT_NAME,
  SEED_TEXT_MAX,
  buildComposerSeedDetail,
  parseComposerSeedDetail,
  type ComposerSeedDetail,
} from '../src/lib/chatComposerSeedCore';

let passCount = 0;
function pass(label: string) {
  passCount += 1;
  console.log(`  ok ${passCount}. ${label}`);
}

// ── 1. Protocol constants ────────────────────────────────────────────────────

assert.equal(SEED_EVENT_NAME, 'uc:seed-composer');
pass('SEED_EVENT_NAME is the documented uc:seed-composer');

assert.equal(SEED_TEXT_MAX, 280);
pass('SEED_TEXT_MAX is 280');

// ── 2. Good command seeds (the real emptyStateSuggestions values) ────────────

const GOOD_COMMANDS = [
  '/create ',
  '/watch ',
  '/review ',
  '/imagine ',
  '/apps',
  '/screen',
  '/room list',
  '/room files ',
  '/mission create',
  '/task new',
];
for (const cmd of GOOD_COMMANDS) {
  const detail = buildComposerSeedDetail(cmd);
  assert.ok(detail, `expected ${JSON.stringify(cmd)} to build`);
  assert.equal(detail!.text, cmd.trim());
  assert.equal(detail!.caret, detail!.text.length);
}
pass(`all ${GOOD_COMMANDS.length} real chip command seeds build (trimmed, caret at end)`);

const roomFiles = buildComposerSeedDetail('/room files ')!;
assert.deepEqual(roomFiles, { text: '/room files', caret: 11 });
pass('trailing-space command seed trims to visible text with caret at its end');

// ── 3. Plain-text seeds ──────────────────────────────────────────────────────

const plain = buildComposerSeedDetail('generate an image of a sunset');
assert.deepEqual(plain, { text: 'generate an image of a sunset', caret: 29 });
pass('plain text seed passes through verbatim with caret at end');

const padded = buildComposerSeedDetail('  ask about the deploy  ');
assert.deepEqual(padded, { text: 'ask about the deploy', caret: 20 });
pass('surrounding whitespace is trimmed before caret math');

const colonSentence = buildComposerSeedDetail('todo: review the PR and merge');
assert.ok(colonSentence, 'a colon inside a sentence is not a handler token');
assert.equal(colonSentence!.text, 'todo: review the PR and merge');
pass('multi-word text containing a colon is NOT mistaken for a handler token');

const unicode = buildComposerSeedDetail('résumé the plan → step 2');
assert.ok(unicode);
assert.equal(unicode!.caret, unicode!.text.length);
pass('non-ASCII text survives and caret matches its length');

// ── 4. Length ceiling ────────────────────────────────────────────────────────

const exactly280 = 'a'.repeat(280);
assert.deepEqual(buildComposerSeedDetail(exactly280), { text: exactly280, caret: 280 });
pass('exactly 280 chars is accepted');

assert.equal(buildComposerSeedDetail('a'.repeat(281)), null);
pass('281 chars is rejected');

assert.deepEqual(
  buildComposerSeedDetail(`  ${'b'.repeat(280)}  `),
  { text: 'b'.repeat(280), caret: 280 },
);
pass('length ceiling is measured AFTER trim');

// ── 5. Control-char stripping ────────────────────────────────────────────────

assert.deepEqual(
  buildComposerSeedDetail('hello\u0000\u0007world'),
  { text: 'helloworld', caret: 10 },
);
pass('C0 control chars (NUL, BEL) are stripped');

assert.deepEqual(
  buildComposerSeedDetail('line1\nline2\ttabbed\r'),
  { text: 'line1line2tabbed', caret: 16 },
);
pass('newline / tab / CR are stripped (seeds are single-line)');

assert.deepEqual(
  buildComposerSeedDetail('del\u007fand\u009bc1'),
  { text: 'delandc1', caret: 8 },
);
pass('DEL and C1 control chars are stripped');

assert.equal(buildComposerSeedDetail('\u0000\u0001\n\r\t'), null);
pass('a seed that is ONLY control chars strips to empty → null');

// The stripped result is re-validated: control chars can't smuggle a bad
// command past the token check ("/cre\nate" → "/create" is fine, but
// "/\nOffice" → "/Office" must still fail the lowercase token rule).
assert.deepEqual(buildComposerSeedDetail('/cre\u0000ate now'), {
  text: '/create now',
  caret: 11,
});
assert.equal(buildComposerSeedDetail('/\nOFFICE'), null);
pass('token rules apply AFTER stripping (no control-char smuggling)');

// ── 6. Empty / non-string rejection ──────────────────────────────────────────

assert.equal(buildComposerSeedDetail(''), null);
assert.equal(buildComposerSeedDetail('   '), null);
pass('empty and whitespace-only seeds are rejected');

assert.equal(buildComposerSeedDetail(42 as unknown as string), null);
assert.equal(buildComposerSeedDetail(null as unknown as string), null);
assert.equal(buildComposerSeedDetail(undefined as unknown as string), null);
assert.equal(buildComposerSeedDetail({} as unknown as string), null);
pass('non-string builder input is rejected, never throws');

// ── 7. Handler-token rejection (office:*, mission:*, …) ──────────────────────

assert.equal(buildComposerSeedDetail('office:deploy-agent'), null);
pass('office:deploy-agent handler token is rejected');

assert.equal(buildComposerSeedDetail('mission:create'), null);
assert.equal(buildComposerSeedDetail('room:open-files'), null);
assert.equal(buildComposerSeedDetail('office:'), null);
pass('other namespaced handler tokens (mission:*, room:*, bare namespace) are rejected');

// ── 8. Slash-command token validation (shell-ish rejection) ──────────────────

assert.equal(buildComposerSeedDetail('/bin/sh'), null);
assert.equal(buildComposerSeedDetail('/usr/bin/env bash'), null);
pass('shell-ish paths (/bin/sh, /usr/bin/env) are rejected');

assert.equal(buildComposerSeedDetail('/'), null);
assert.equal(buildComposerSeedDetail('/ create'), null);
pass('bare "/" and "/ command" are rejected');

assert.equal(buildComposerSeedDetail('/Create page'), null);
assert.equal(buildComposerSeedDetail('/CREATE'), null);
pass('uppercase command tokens are rejected (registry ids are lowercase)');

assert.equal(buildComposerSeedDetail('/rm;whoami'), null);
assert.equal(buildComposerSeedDetail('/cmd$(id)'), null);
assert.equal(buildComposerSeedDetail('/cmd`id`'), null);
assert.equal(buildComposerSeedDetail('/cmd|cat'), null);
pass('shell metacharacters inside the command token are rejected');

assert.equal(buildComposerSeedDetail('/9lives'), null);
assert.equal(buildComposerSeedDetail('/-flag'), null);
pass('tokens not starting with a lowercase letter are rejected');

assert.ok(buildComposerSeedDetail('/mission-create'), 'hyphenated command ids are valid');
assert.ok(buildComposerSeedDetail('/create a page with `code` in it'), 'arguments after a valid token are free text');
pass('hyphenated ids valid; args after a valid token are unrestricted chat text');

// ── 9. parseComposerSeedDetail — hostile details never throw, never leak ─────

const HOSTILE: unknown[] = [
  null,
  undefined,
  42,
  'just a string',
  true,
  [],
  ['text', 'caret'],
  {},
  { text: 42 },
  { text: null },
  { text: { nested: 'junk' } },
  { text: ['array'] },
  { caret: 5 },
  { text: '' },
  { text: '   ' },
  { text: 'office:deploy-agent' },
  { text: '/bin/sh' },
  { text: '/Office' },
  { text: 'a'.repeat(281) },
  { text: '\u0000\n' },
  Object.create(null),
  new Date(),
  Symbol('x'),
  () => 'text',
];
for (let i = 0; i < HOSTILE.length; i++) {
  const detail = HOSTILE[i];
  let result: ComposerSeedDetail | null = 'unset' as unknown as null;
  assert.doesNotThrow(() => {
    result = parseComposerSeedDetail(detail);
  });
  // NOTE: hostile values include Object.create(null), which String() cannot
  // stringify — identify failures by index instead.
  assert.equal(result, null, `expected null for hostile detail #${i}`);
}
pass(`all ${HOSTILE.length} hostile details parse to null without throwing`);

// A getter that throws must not escape the parser.
const throwingDetail = {
  get text(): string {
    throw new Error('hostile getter');
  },
};
assert.equal(parseComposerSeedDetail(throwingDetail), null);
pass('a throwing property getter is contained (try/catch), returns null');

// Extra junk fields are ignored, not reflected.
const junky = parseComposerSeedDetail({
  text: '/apps',
  caret: 5,
  __proto__: { evil: true },
  onclick: 'alert(1)',
  nested: { deep: ['junk'] },
});
assert.deepEqual(junky, { text: '/apps', caret: 5 });
assert.equal(Object.keys(junky!).length, 2);
pass('unknown fields on a valid detail are dropped; output is exactly {text, caret}');

// ── 10. Caret handling on parse ──────────────────────────────────────────────

assert.deepEqual(parseComposerSeedDetail({ text: 'hello world', caret: 5 }), {
  text: 'hello world',
  caret: 5,
});
assert.deepEqual(parseComposerSeedDetail({ text: 'hello', caret: 0 }), { text: 'hello', caret: 0 });
pass('a valid in-range caret (including 0) is preserved');

for (const badCaret of [-1, 3.5, 999, NaN, Infinity, -Infinity, '5', null, undefined, {}]) {
  const parsed = parseComposerSeedDetail({ text: 'hello', caret: badCaret });
  assert.deepEqual(parsed, { text: 'hello', caret: 5 }, `caret=${String(badCaret)}`);
}
pass('negative/fractional/oversized/NaN/non-number carets degrade to end-of-text');

// Caret is clamped against the NORMALIZED text length, not the raw one.
const trimmedCaret = parseComposerSeedDetail({ text: '  hi  ', caret: 6 });
assert.deepEqual(trimmedCaret, { text: 'hi', caret: 2 });
pass('caret out of range after trim degrades to normalized end-of-text');

// ── 11. Round-trip build → parse identity ────────────────────────────────────

const ROUND_TRIP_SEEDS = [
  ...GOOD_COMMANDS,
  'generate an image of a sunset',
  'summarize this PR',
  '  padded plain text  ',
  'a'.repeat(280),
  '/create a landing page for my bakery',
];
for (const seed of ROUND_TRIP_SEEDS) {
  const built = buildComposerSeedDetail(seed);
  assert.ok(built, `expected ${JSON.stringify(seed.slice(0, 40))} to build`);
  const parsed = parseComposerSeedDetail(built);
  assert.deepEqual(parsed, built, `round-trip mismatch for ${JSON.stringify(seed.slice(0, 40))}`);
  assert.equal(built!.caret, built!.text.length, 'built caret is always end-of-text');
}
pass(`round-trip parse(build(x)) is identity for all ${ROUND_TRIP_SEEDS.length} accepted seeds`);

// Round-trip also survives JSON serialization (CustomEvent detail crossing
// a structured-clone boundary behaves like this).
const wire = buildComposerSeedDetail('/watch https://example.com/pricing')!;
assert.deepEqual(parseComposerSeedDetail(JSON.parse(JSON.stringify(wire))), wire);
pass('round-trip survives JSON serialize/parse (event-boundary shape)');

// Every rejected build input also parses to null when wrapped as a detail —
// the two sides can never disagree about validity.
for (const bad of ['office:deploy-agent', '/bin/sh', '', '   ', '/Office', 'a'.repeat(281)]) {
  assert.equal(buildComposerSeedDetail(bad), null);
  assert.equal(parseComposerSeedDetail({ text: bad, caret: 0 }), null);
}
pass('build and parse agree on every rejected seed (no validity skew)');

console.log(`\nchat-composer-seed-core-smoketest: ${passCount} checks passed`);
