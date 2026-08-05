/**
 * v2-tool-selection-core-smoketest — the pure, Deno-importable tool-GROUP
 * selector (src/lib/v2ToolSelectionCore.ts) that replaces the blind keyword
 * union in supabase/functions/swanbot-v2-ai/index.ts :: selectToolsForTurn
 * (~2148-2161). Load-bearing assertions:
 *
 *   SUPERSET / REGRESSION-SAFE: every legacy keyword (single word AND the
 *   multi-word phrases: "pull request", "save this", "post in chat", "not a
 *   robot", "photo shop", "dealer inspire", "1password", "str_replace") still
 *   maps to its original group — selection can only GROW, never shrink.
 *
 *   CAPABILITY EDGES (real-gap fixes only): credentials⇒browser,
 *   browser-login⇒credentials, and a STRICT file-path⇒coding — e.g.
 *   "log into the dealer site" yields BOTH credentials AND browser, while a
 *   bare "photos folder" gets desktop but NOT coding (strict-path gating).
 *   We do NOT add the redundant coding→verification / wordpress→browser edges.
 *
 *   IMPERATIVE FLOOR: a real do/make/fix/change/build command widens to
 *   workspace+tasks+research, but an interrogative ("do you…?", "can you…?",
 *   "what…", "why…", "is it done?") does NOT widen.
 *
 *   MODE PARITY: research/build/design/review/execute reproduce the edge's
 *   mode→group block; talk/plan/support add nothing.
 *
 *   TOTALITY: every export survives null/undefined/wrong-type/huge/hostile
 *   input (incl. an object whose toString throws) with a valid, bounded,
 *   canonically-ordered result — never throws.
 *
 * Pure — loads under tsx (v2ToolSelectionCore has zero runtime imports).
 */

import {
  selectToolGroups,
  TOOL_GROUP_KEYS,
  isImperativeActionText,
  isToolGroupKey,
  type ToolSelection,
} from '../src/lib/v2ToolSelectionCore';

let passes = 0,
  failures = 0;
function assert(c: unknown, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// ── local helpers ────────────────────────────────────────────────────────────
function sel(text: unknown, mode: unknown): ToolSelection {
  return selectToolGroups(text, mode);
}
function hasGroup(s: ToolSelection, key: string): boolean {
  return Array.isArray(s.groups) && s.groups.indexOf(key) >= 0;
}
function assertHas(text: string, mode: string, key: string, m: string) {
  assert(hasGroup(sel(text, mode), key), m, 'groups=' + JSON.stringify(sel(text, mode).groups));
}
function assertNot(text: string, mode: string, key: string, m: string) {
  assert(!hasGroup(sel(text, mode), key), m, 'groups=' + JSON.stringify(sel(text, mode).groups));
}
function canonicalOrdered(groups: unknown): boolean {
  if (!Array.isArray(groups)) return false;
  let last = -1;
  for (const g of groups) {
    const i = TOOL_GROUP_KEYS.indexOf(g as string);
    if (i < 0) return false; // unknown key leaked
    if (i <= last) return false; // out of order or duplicate
    last = i;
  }
  return true;
}
function noThrow(fn: () => unknown, m: string): unknown {
  try {
    const v = fn();
    assert(true, m);
    return v;
  } catch (err) {
    assert(false, m, String(err));
    return undefined;
  }
}
function isValidSelection(v: unknown): v is ToolSelection {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray((v as ToolSelection).groups) &&
    typeof (v as ToolSelection).reason === 'string'
  );
}

function main() {
  // ── Group 1: structural / TOOL_GROUP_KEYS + isToolGroupKey ────────────────
  assertEq(TOOL_GROUP_KEYS.length, 14, 'G1 14 canonical group keys');
  const expectedKeys = [
    'research', 'memory', 'tasks', 'messages', 'rooms', 'workspace',
    'approvals', 'browser', 'desktop', 'wordpress', 'credentials',
    'rewards', 'verification', 'coding',
  ];
  for (const k of expectedKeys) assert(TOOL_GROUP_KEYS.indexOf(k) >= 0, 'G1 keys include ' + k);
  assertEq(JSON.stringify([...TOOL_GROUP_KEYS]), JSON.stringify(expectedKeys), 'G1 canonical order stable');
  assert(isToolGroupKey('research'), 'G1 isToolGroupKey research');
  assert(isToolGroupKey('coding'), 'G1 isToolGroupKey coding');
  assert(!isToolGroupKey('nope'), 'G1 isToolGroupKey rejects unknown');
  assert(!isToolGroupKey(''), 'G1 isToolGroupKey rejects empty');
  assert(!isToolGroupKey(null), 'G1 isToolGroupKey rejects null');
  assert(!isToolGroupKey(123), 'G1 isToolGroupKey rejects number');
  assert(!isToolGroupKey(undefined), 'G1 isToolGroupKey rejects undefined');

  // ── Group 2: legacy keyword SUPERSET (mode="talk" adds nothing) ───────────
  const KW: Array<[string, string]> = [
    ['research the latest docs', 'research'],
    ['cite your source', 'research'],
    ['open the pull request', 'research'], // multi-word
    ['check the github repo', 'research'],
    ['this uses http and https', 'research'],
    ['please remember this preference', 'memory'],
    ['save this decision now', 'memory'], // multi-word "save this"
    ['recall what we agreed', 'memory'],
    ['forget that note', 'memory'],
    ['show my todo list', 'tasks'],
    ['assign the mission', 'tasks'],
    ['the kanban deadline', 'tasks'],
    ['reply in the thread', 'messages'],
    ['post in chat', 'messages'], // multi-word
    ['send to chat', 'messages'], // multi-word
    ['open the workspace preview', 'workspace'],
    ['render the component page', 'workspace'],
    ['the artifact and the room', 'workspace'],
    ['use my chrome browser', 'browser'],
    ['fill the form', 'browser'],
    ['it says not a robot', 'browser'], // multi-word "not a robot"
    ['handle the cloudflare captcha', 'browser'],
    ['open photoshop', 'desktop'],
    ['use the photo shop editor', 'desktop'], // multi-word "photo shop"
    ['take a screenshot', 'desktop'],
    ['focus the finder window', 'desktop'],
    ['the wordpress slide', 'wordpress'],
    ['dealer inspire admin', 'wordpress'], // multi-word "dealer inspire"
    ['reload cache on the cms', 'wordpress'],
    ['my saved password', 'credentials'],
    ['the 1password vault', 'credentials'], // "1password"
    ['check the leaderboard rank', 'rewards'],
    ['my xp and badges', 'rewards'],
    ['the streak and karma', 'rewards'],
    ['review the lint and typecheck', 'verification'],
    ['verify the ci smoke', 'verification'],
    ['the git commit diff', 'coding'],
    ['a str_replace in the codebase', 'coding'], // "str_replace"
    ['pnpm and vitest and eslint', 'coding'],
    ['submit the external request', 'approvals'],
  ];
  for (const [text, group] of KW) {
    assertHas(text, 'talk', group, 'G2 keyword "' + text + '" ⇒ ' + group);
  }

  // ── Group 3: capability co-occurrence edges ───────────────────────────────
  // Headline: "log into the dealer site" must yield credentials AND browser.
  assertHas('log into the dealer site', 'talk', 'credentials', 'G3 login ⇒ credentials');
  assertHas('log into the dealer site', 'talk', 'browser', 'G3 login ⇒ browser');
  assertEq(
    JSON.stringify(sel('log into the dealer site', 'talk').groups),
    JSON.stringify(['browser', 'credentials']),
    'G3 login exact groups (canonical order)',
  );
  // "log in" / "sign in" / "log on" space variants the legacy regex missed.
  assertHas('log on to the portal', 'talk', 'browser', 'G3 "log on" ⇒ browser');
  assertHas('log on to the portal', 'talk', 'credentials', 'G3 "log on" ⇒ credentials');
  assertHas('please sign in to gmail', 'talk', 'credentials', 'G3 "sign in" ⇒ credentials');
  // credentials⇒browser (no login word, just a credential).
  assertHas('i forgot my password', 'talk', 'credentials', 'G3 credential keyword present');
  assertHas('i forgot my password', 'talk', 'browser', 'G3 credentials⇒browser edge');
  // desktop-file-path⇒coding (STRICT: real path/extension only).
  assertHas('the config lives at /users/me/app/config.json', 'talk', 'desktop', 'G3 path ⇒ desktop');
  assertHas('the config lives at /users/me/app/config.json', 'talk', 'coding', 'G3 file-path⇒coding edge');
  assertHas('open the file at ~/work/main.ts', 'talk', 'coding', 'G3 ~/ path ⇒ coding');
  // Strict gating: a bare folder word is desktop but NOT coding.
  assertHas('look in my photos folder', 'talk', 'desktop', 'G3 folder word ⇒ desktop');
  assertNot('look in my photos folder', 'talk', 'coding', 'G3 folder word does NOT ⇒ coding');
  // We intentionally did NOT add wordpress→browser as a NEW edge, but the
  // wordpress GROUP already ships browser tools, so parity is fine — assert the
  // legacy wordpress mapping is intact (already covered in G2). Assert the
  // coding→verification non-edge: plain "commit" gives coding, not a spurious
  // standalone verification-only widening beyond the coding group itself.
  assertHas('the git commit diff', 'talk', 'coding', 'G3 coding keyword intact');

  // ── Group 4: imperative-action recall floor ───────────────────────────────
  // Imperatives widen to workspace + tasks + research.
  for (const key of ['workspace', 'tasks', 'research']) {
    assertHas('fix the login bug', 'talk', key, 'G4 imperative "fix" widens ' + key);
    assertHas('build a new dashboard from scratch', 'talk', key, 'G4 imperative "build" widens ' + key);
    assertHas('make the change to the header', 'talk', key, 'G4 imperative "make" widens ' + key);
    assertHas('please update the readme file', 'talk', key, 'G4 imperative "update" widens ' + key);
    assertHas('do the task right now', 'talk', key, 'G4 imperative "do" widens ' + key);
  }
  // Imperative still keeps its keyword+edge groups too.
  assertHas('fix the login bug', 'talk', 'browser', 'G4 imperative keeps browser (login)');
  assertHas('fix the login bug', 'talk', 'credentials', 'G4 imperative keeps credentials (edge)');
  // Interrogatives must NOT widen.
  for (const key of ['workspace', 'tasks', 'research']) {
    assertNot('do you have a browser?', 'talk', key, 'G4 "do you…?" no widen ' + key);
    assertNot('can you fix the login bug?', 'talk', key, 'G4 "can you…?" no widen ' + key);
  }
  // But the interrogative still gets its keyword/edge groups.
  assertHas('do you have a browser?', 'talk', 'browser', 'G4 interrogative keeps browser keyword');
  assertHas('can you fix the login bug?', 'talk', 'browser', 'G4 interrogative keeps browser (login)');
  assertHas('can you fix the login bug?', 'talk', 'credentials', 'G4 interrogative keeps credentials (edge)');
  // "why is the build broken?" — workspace via keyword, but NOT tasks/research widen.
  assertHas('why is the build broken?', 'talk', 'workspace', 'G4 "build" keyword ⇒ workspace');
  assertNot('why is the build broken?', 'talk', 'tasks', 'G4 "why…?" no tasks widen');
  assertNot('why is the build broken?', 'talk', 'research', 'G4 "why…?" no research widen');

  // ── Group 5: isImperativeActionText (direct predicate) ────────────────────
  const IMP_TRUE = [
    'fix the login bug',
    'please update the config',
    'make the change',
    'build it',
    'do the task',
    'refactor this module',
    'go ahead and deploy the app',
    "let's create a room",
    'i need you to write the test',
    'you should rename the file',
  ];
  for (const s of IMP_TRUE) assert(isImperativeActionText(s) === true, 'G5 imperative TRUE: ' + s);
  const IMP_FALSE = [
    'do you have a browser?',
    'can you help me?',
    'what is the status?',
    'why did it fail?',
    'is it done?',
    'the build is green',
    'adding a new feature', // gerund, not imperative
    'changelog updated', // word-boundary guard vs "change"
    'thanks for the help',
    'how do i deploy?',
  ];
  for (const s of IMP_FALSE) assert(isImperativeActionText(s) === false, 'G5 imperative FALSE: ' + s);

  // ── Group 6: mode→group parity (empty text so mode dominates) ─────────────
  assertHas('', 'research', 'research', 'G6 mode research');
  assertHas('', 'build', 'workspace', 'G6 mode build ⇒ workspace');
  assertHas('', 'build', 'coding', 'G6 mode build ⇒ coding');
  assertHas('', 'design', 'workspace', 'G6 mode design ⇒ workspace');
  assertHas('', 'design', 'coding', 'G6 mode design ⇒ coding');
  assertHas('', 'review', 'workspace', 'G6 mode review ⇒ workspace');
  assertHas('', 'execute', 'tasks', 'G6 mode execute ⇒ tasks');
  assertHas('', 'execute', 'approvals', 'G6 mode execute ⇒ approvals');
  assertEq(sel('', 'talk').groups.length, 0, 'G6 mode talk ⇒ empty');
  assertEq(sel('', 'plan').groups.length, 0, 'G6 mode plan ⇒ empty');
  assertEq(sel('', 'support').groups.length, 0, 'G6 mode support ⇒ empty');
  // Mode + keyword compose (superset).
  assertHas('use my chrome browser', 'build', 'coding', 'G6 build mode + browser kw keeps coding');
  assertHas('use my chrome browser', 'build', 'browser', 'G6 build mode + browser kw keeps browser');

  // ── Group 7: determinism, ordering, bounds ────────────────────────────────
  const a = sel('log into the dealer site and open photoshop', 'build');
  const b = sel('log into the dealer site and open photoshop', 'build');
  assertEq(JSON.stringify(a.groups), JSON.stringify(b.groups), 'G7 deterministic groups');
  assertEq(a.reason, b.reason, 'G7 deterministic reason');
  assert(canonicalOrdered(a.groups), 'G7 groups canonically ordered');
  assert(canonicalOrdered(sel('fix the login bug', 'talk').groups), 'G7 imperative groups ordered');
  assert(a.groups.length <= TOOL_GROUP_KEYS.length, 'G7 groups bounded ≤ key count');
  assert(typeof a.reason === 'string' && a.reason.length > 0 && a.reason.length <= 320, 'G7 reason bounded string');
  // No duplicate groups.
  assertEq(new Set(a.groups).size, a.groups.length, 'G7 no duplicate groups');
  // Every returned group is a real key.
  assert(a.groups.every((g) => isToolGroupKey(g)), 'G7 all groups are valid keys');

  // ── Group 8: degenerate / hostile input — NO THROW ────────────────────────
  const hostileInputs: Array<[unknown, unknown, string]> = [
    [null, null, 'null,null'],
    [undefined, undefined, 'undefined,undefined'],
    [123, 456, 'number,number'],
    [true, false, 'bool,bool'],
    [{}, {}, 'obj,obj'],
    [[], [], 'arr,arr'],
    [NaN, Infinity, 'NaN,Infinity'],
    ['normal text', 99999, 'string,number-mode'],
    ['normal text', 'a'.repeat(100), 'string,overlong-mode'],
    ['normal text', {}, 'string,object-mode'],
    [Symbol.iterator as unknown, 'talk', 'symbol-ish,talk'],
    [{ toString() { throw new Error('boom'); } }, 'talk', 'throwing-toString,talk'],
    ['x'.repeat(200000), 'build', 'huge-string,build'],
  ];
  for (const [text, mode, label] of hostileInputs) {
    const v = noThrow(() => selectToolGroups(text, mode), 'G8 no-throw ' + label);
    assert(isValidSelection(v), 'G8 valid shape ' + label);
    if (isValidSelection(v)) {
      assert(canonicalOrdered(v.groups), 'G8 ordered+valid groups ' + label);
      assert(v.groups.length <= TOOL_GROUP_KEYS.length, 'G8 bounded groups ' + label);
      assert(typeof v.reason === 'string' && v.reason.length <= 320, 'G8 bounded reason ' + label);
    }
  }
  // Object-with-throwing-toString must yield empty (coercion never calls it).
  const thrower = selectToolGroups({ toString() { throw new Error('boom'); } }, 'talk');
  assertEq(thrower.groups.length, 0, 'G8 throwing-toString ⇒ empty groups');
  // Huge string + build mode still returns the mode groups, bounded.
  const huge = selectToolGroups('x'.repeat(200000), 'build');
  assert(hasGroup(huge, 'workspace') && hasGroup(huge, 'coding'), 'G8 huge string keeps build-mode groups');
  // isImperativeActionText totality.
  for (const bad of [null, undefined, {}, [], 123, true, NaN, Symbol.iterator as unknown]) {
    assertEq(noThrow(() => isImperativeActionText(bad), 'G8 isImperativeActionText no-throw'), false, 'G8 imperative(bad)=false');
  }
  // isToolGroupKey totality.
  for (const bad of [null, undefined, {}, [], 123, true, NaN]) {
    assertEq(isToolGroupKey(bad), false, 'G8 isToolGroupKey(bad)=false');
  }
  // Empty string yields empty groups + a neutral reason (never throws / never junk).
  const empty = selectToolGroups('', 'talk');
  assertEq(empty.groups.length, 0, 'G8 empty string ⇒ empty groups');
  assert(empty.reason === 'no-signal', 'G8 empty ⇒ no-signal reason');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll v2-tool-selection-core smoke cases passed (' + passes + ' passed).');
}

main();
