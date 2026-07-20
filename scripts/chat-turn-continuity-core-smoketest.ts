/**
 * chat-turn-continuity-core-smoketest — the PURE cross-turn carry-forward
 * classifier (src/lib/chatTurnContinuityCore.ts) that reads the CURRENT user
 * message against a bounded window of PRIOR turns and emits a
 * TurnContinuityFrame: {relation, carriesForward, answersPriorQuestion,
 * priorQuestionText, danglingReferents, resolvable, antecedentHint, reason}.
 *
 * Load-bearing assertions:
 *   resolveTurnContinuity(currentMessage?, priorTurns?): TurnContinuityFrame
 *     - answer: last assistant turn asked + current reads as an answer →
 *       relation 'answer', answersPriorQuestion true, carriesForward+resolvable
 *       true, priorQuestionText/antecedentHint echo the question.
 *     - dangling-unresolvable: empty/greeting-only window + "delete them" →
 *       carriesForward true, resolvable false, referent listed.
 *     - dangling-resolvable: prior LoginPage context + "fix it" → resolvable
 *       true, antecedentHint non-empty.
 *     - continuation ("also add tests"), refinement ("no, use staging"),
 *       ordinal-needs-list ("the second one"), new-topic, meta ("never mind").
 *   carriesThreadContext(msg, turns) === frame.carriesForward && frame.resolvable
 *   endsWithQuestion(text): total assistant-question detector.
 *
 * And: every export is TOTAL — null/undefined/number/NaN/{}/[]-as-input, a
 * non-array / null-entry / throwing-getter / cyclic priorTurns, a huge message,
 * a secret-shaped message + bidi/zero-width injection ⇒ a valid bounded frame,
 * never a throw, never a leaked secret.
 *
 * Pure — loads under tsx (the core has ZERO runtime imports).
 */

import {
  resolveTurnContinuity,
  carriesThreadContext,
  endsWithQuestion,
  MAX_PRIOR_TURNS,
  MAX_TURN_CHARS,
  MAX_MESSAGE_CHARS,
  MAX_REFERENTS,
  MAX_REFERENT_LEN,
  MAX_HINT_LEN,
  MAX_QUESTION_LEN,
  type TurnContinuityFrame,
  type TurnRelation,
} from '../src/lib/chatTurnContinuityCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── vocab (validation source of truth, local to the smoke) ───────────────────
const RELATIONS: TurnRelation[] = ['answer', 'continuation', 'refinement', 'meta', 'new-topic'];

// Detect any control / DEL / C1 / fence char (regex literal, no raw bytes) OR
// the two Unicode line separators + a couple of zero-width/bidi markers (built
// via fromCharCode so no raw invisibles in this source).
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
const ZW = String.fromCharCode(0x200b, 0x202e, 0xfeff);
function hasUnsafeChars(s: string): boolean {
  if (/[\x00-\x1f\x7f-\x9f`<>]/.test(s)) return true;
  for (const ch of LINE_SEP + ZW) if (s.indexOf(ch) >= 0) return true;
  return false;
}

// ── call wrapper (keeps hostile fixtures cast-free at the call sites) ─────────
function r(msg?: unknown, turns?: unknown): TurnContinuityFrame {
  return resolveTurnContinuity(msg as string, turns as unknown[]);
}
function refs(f: TurnContinuityFrame): string[] {
  return f.danglingReferents;
}
function hasRef(f: TurnContinuityFrame, needle: string): boolean {
  return f.danglingReferents.some((x) => x.toLowerCase().includes(needle.toLowerCase()));
}

/** Structural invariants any frame must satisfy. */
function frameIsValid(f: unknown): f is TurnContinuityFrame {
  if (!f || typeof f !== 'object') return false;
  const ff = f as TurnContinuityFrame;
  if (!RELATIONS.includes(ff.relation)) return false;
  if (typeof ff.carriesForward !== 'boolean') return false;
  if (typeof ff.answersPriorQuestion !== 'boolean') return false;
  if (typeof ff.resolvable !== 'boolean') return false;
  if (typeof ff.priorQuestionText !== 'string' || ff.priorQuestionText.length > MAX_QUESTION_LEN) return false;
  if (typeof ff.antecedentHint !== 'string' || ff.antecedentHint.length > MAX_HINT_LEN) return false;
  if (typeof ff.reason !== 'string' || ff.reason.length === 0 || ff.reason.length > 40) return false;
  if (!Array.isArray(ff.danglingReferents) || ff.danglingReferents.length > MAX_REFERENTS) return false;
  for (const x of ff.danglingReferents) {
    if (typeof x !== 'string' || x.length === 0 || x.length > MAX_REFERENT_LEN) return false;
    if (hasUnsafeChars(x)) return false;
  }
  if (hasUnsafeChars(ff.priorQuestionText)) return false;
  if (hasUnsafeChars(ff.antecedentHint)) return false;
  // relation/flag invariants
  if (ff.relation === 'answer' && ff.answersPriorQuestion !== true) return false;
  if (ff.answersPriorQuestion && !ff.carriesForward) return false;
  if (ff.relation === 'new-topic' && (ff.carriesForward || ff.danglingReferents.length > 0)) return false;
  if (ff.relation === 'meta' && ff.carriesForward) return false;
  if (!ff.carriesForward && ff.resolvable) return false; // resolvable implies carriesForward
  return true;
}
function totalOn(msg: unknown, turns?: unknown): boolean {
  try {
    const f = r(msg, turns);
    // carriesThreadContext must agree with the frame and never throw
    const ctx = carriesThreadContext(msg as string, turns as unknown[]);
    if (ctx !== (f.carriesForward && f.resolvable)) return false;
    return frameIsValid(f);
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (A) answer-to-question ─────────────────────────────────────────────────
  {
    const f = r('production', [{ role: 'assistant', text: 'Which environment?' }]);
    assertEq(f.relation, 'answer', '(A) production answers the question');
    assertEq(f.answersPriorQuestion, true, '(A) answersPriorQuestion true');
    assertEq(f.carriesForward, true, '(A) carriesForward true');
    assertEq(f.resolvable, true, '(A) resolvable true');
    assert(/environment/i.test(f.priorQuestionText), '(A) priorQuestionText echoes the question', f.priorQuestionText);
    assert(f.antecedentHint.length > 0, '(A) antecedentHint non-empty', f.antecedentHint);
    assertJson(refs(f), [], '(A) no dangling referents on an answer');
    assertEq(carriesThreadContext('production', [{ role: 'assistant', text: 'Which environment?' }]), true, '(A) carriesThreadContext true');
    assert(frameIsValid(f), '(A) frame valid');
  }
  {
    const yes = r('yes', [{ role: 'assistant', text: 'Do you want me to deploy?' }]);
    assertEq(yes.relation, 'answer', '(A) bare "yes" answers a yes/no question');
    assertEq(yes.answersPriorQuestion, true, '(A) yes → answersPriorQuestion');
    const no = r('no', [{ role: 'assistant', text: 'Should I proceed?' }]);
    assertEq(no.relation, 'answer', '(A) bare "no" answers a yes/no question');
    const echo = r('staging', [{ role: 'assistant', text: 'Should I use production or staging?' }]);
    assertEq(echo.relation, 'answer', '(A) option-echo "staging" is an answer');
    const yesPlease = r('yes please', [{ role: 'assistant', text: 'Deploy now?' }]);
    assertEq(yesPlease.relation, 'answer', '(A) "yes please" is a bare affirmation answer');
  }
  {
    // a fresh new-work imperative after a question is NOT an answer (precision)
    const f = r('write a haiku about the ocean', [{ role: 'assistant', text: 'Which environment?' }]);
    assertEq(f.relation, 'new-topic', '(A) new-work verb after a question → new-topic, not answer');
    assertEq(f.answersPriorQuestion, false, '(A) not treated as an answer');
    assertEq(f.carriesForward, false, '(A) fresh imperative does not carry forward');
  }

  // ─── (B) dangling-unresolvable ──────────────────────────────────────────────
  {
    const f = r('delete them', []);
    assertEq(f.carriesForward, true, '(B) "delete them" carries forward');
    assertEq(f.resolvable, false, '(B) empty window → not resolvable');
    assert(hasRef(f, 'them'), '(B) "them" is listed as a dangling referent', JSON.stringify(refs(f)));
    assertEq(f.antecedentHint, '', '(B) no antecedent hint when unresolvable');
    assertEq(carriesThreadContext('delete them', []), false, '(B) carriesThreadContext false → caller should ASK');
    assert(frameIsValid(f), '(B) frame valid');
  }
  {
    // greeting-only window still supplies no subject
    const f = r('delete them', [{ role: 'user', text: 'hi there' }, { role: 'assistant', text: 'Hello!' }]);
    assertEq(f.resolvable, false, '(B) greeting-only window → not resolvable');
    assert(hasRef(f, 'them'), '(B) referent still listed with a greeting window');
  }

  // ─── (C) dangling-resolvable ────────────────────────────────────────────────
  {
    const window = [{ role: 'assistant', text: 'LoginPage.tsx is broken. I found 3 issues.' }];
    const f = r('fix it', window);
    assertEq(f.carriesForward, true, '(C) "fix it" carries forward');
    assertEq(f.resolvable, true, '(C) prior subject → resolvable');
    assert(hasRef(f, 'it'), '(C) "it" listed as referent');
    assert(f.antecedentHint.length > 0, '(C) antecedentHint non-empty', f.antecedentHint);
    assert(/login/i.test(f.antecedentHint), '(C) hint re-grounds on the prior subject', f.antecedentHint);
    assertEq(carriesThreadContext('fix it', window), true, '(C) carriesThreadContext true → PROCEED');
  }
  {
    // an in-message antecedent suppresses the dangling detection entirely
    const f = r('delete the temp files then remove them', []);
    assertJson(refs(f), [], '(C) in-message antecedent ("the temp files") → no dangling referent');
    assertEq(f.carriesForward, false, '(C) self-contained instruction does not carry forward');
    assertEq(f.relation, 'new-topic', '(C) → new-topic');
  }

  // ─── (D) continuation ───────────────────────────────────────────────────────
  {
    const window = [{ role: 'assistant', text: 'I fixed the login page.' }];
    const f = r('also add tests', window);
    assertEq(f.relation, 'continuation', '(D) "also add tests" is a continuation');
    assertEq(f.carriesForward, true, '(D) continuation carries forward');
    assertEq(f.resolvable, true, '(D) prior subject → resolvable');
    assert(f.antecedentHint.length > 0, '(D) hint present');
  }
  {
    const f = r('also add tests', []);
    assertEq(f.relation, 'continuation', '(D) continuation cue holds with empty window');
    assertEq(f.carriesForward, true, '(D) still carries forward');
    assertEq(f.resolvable, false, '(D) empty window → not resolvable');
    assertEq(carriesThreadContext('also add tests', []), false, '(D) carriesThreadContext false');
  }

  // ─── (E) refinement ─────────────────────────────────────────────────────────
  {
    const window = [{ role: 'assistant', text: "I'll deploy to production." }];
    const f = r('no, use staging instead', window);
    assertEq(f.relation, 'refinement', '(E) "no, use staging instead" is a refinement');
    assertEq(f.carriesForward, true, '(E) refinement carries forward');
    assertEq(f.resolvable, true, '(E) prior subject → resolvable');
    assertEq(f.answersPriorQuestion, false, '(E) not an answer');
    const f2 = r('actually, use staging', window);
    assertEq(f2.relation, 'refinement', '(E) "actually, ..." is a refinement');
  }

  // ─── (F) ordinal-needs-list ─────────────────────────────────────────────────
  {
    // a subject-bearing but NON-list prior turn does not resolve an ordinal
    const noList = r('use the second one', [{ role: 'assistant', text: 'I found some problems with the code.' }]);
    assertEq(noList.carriesForward, true, '(F) ordinal carries forward');
    assertEq(noList.resolvable, false, '(F) ordinal not resolvable without a prior list');
    assert(hasRef(noList, 'the second one'), '(F) "the second one" is the referent', JSON.stringify(refs(noList)));
    // an assistant LIST turn resolves it
    const withList = r('use the second one', [{ role: 'assistant', text: '1. Production\n2. Staging\n3. Preview' }]);
    assertEq(withList.resolvable, true, '(F) prior assistant list → resolvable');
    assert(withList.antecedentHint.length > 0, '(F) hint points at the list turn', withList.antecedentHint);
    // an "or"-alternatives question also counts as a list
    const orList = r('the second one', [{ role: 'assistant', text: 'Which one: Production, Staging, or Preview?' }]);
    // (this window is a question → answer path; assert it still resolves either way)
    assert(orList.carriesForward, '(F) ordinal against an "or" list carries forward');
    // a USER list turn does NOT satisfy the assistant-list requirement
    const userList = r('use the second one', [{ role: 'user', text: '1. apples\n2. oranges\n3. pears' }]);
    assertEq(userList.resolvable, false, '(F) a USER list does not resolve an ordinal (needs assistant list)');
  }

  // ─── (G) new-topic ──────────────────────────────────────────────────────────
  {
    const f = r('write a haiku about the ocean', []);
    assertEq(f.relation, 'new-topic', '(G) fresh request → new-topic');
    assertEq(f.carriesForward, false, '(G) does not carry forward');
    assertJson(refs(f), [], '(G) no referents');
    assertEq(f.resolvable, false, '(G) new-topic is not resolvable');
    assertEq(carriesThreadContext('write a haiku about the ocean', []), false, '(G) carriesThreadContext false');
    const q = r('what is the capital of France', [{ role: 'assistant', text: 'Anything else?' }]);
    assertEq(q.relation, 'new-topic', '(G) an unrelated question is a new topic');
  }

  // ─── (H) meta ───────────────────────────────────────────────────────────────
  {
    for (const m of ['never mind', 'stop', 'nvm', 'cancel that', 'wait', 'scratch that', 'undo']) {
      const f = r(m, [{ role: 'assistant', text: 'Working on it.' }]);
      assertEq(f.relation, 'meta', `(H) "${m}" is meta`);
      assertEq(f.carriesForward, false, `(H) "${m}" does not carry forward`);
      assertJson(refs(f), [], `(H) "${m}" has no referents`);
      assertEq(carriesThreadContext(m, []), false, `(H) "${m}" carriesThreadContext false`);
    }
    // "wait, ..." with content is NOT meta (it's a refinement)
    const notMeta = r('wait, use staging', [{ role: 'assistant', text: "I'll use prod." }]);
    assertEq(notMeta.relation, 'refinement', '(H) "wait, use staging" is a refinement, not meta');
  }

  // ─── (I) endsWithQuestion helper ────────────────────────────────────────────
  {
    assertEq(endsWithQuestion('Which environment?'), true, '(I) trailing ? → true');
    assertEq(endsWithQuestion('Which environment?   '), true, '(I) trailing whitespace after ? → true');
    assertEq(endsWithQuestion('Deploy the app.'), false, '(I) statement → false');
    assertEq(endsWithQuestion('Sure. Which one do you want?'), true, '(I) question in the last sentence → true');
    assertEq(endsWithQuestion('Let me know which one to use'), true, '(I) lead-ask shape without ? → true');
    assertEq(endsWithQuestion('Should I proceed'), true, '(I) "should I" lead → true');
    assertEq(endsWithQuestion('The fix is ready.'), false, '(I) declarative → false');
    assertEq(endsWithQuestion(''), false, '(I) empty → false');
    assertEq(endsWithQuestion(null), false, '(I) null → false');
    assertEq(endsWithQuestion(123), false, '(I) number → false');
    assertEq(endsWithQuestion({}), false, '(I) object → false');
  }

  // ─── (J) determinism ────────────────────────────────────────────────────────
  {
    const cases: Array<[unknown, unknown]> = [
      ['production', [{ role: 'assistant', text: 'Which environment?' }]],
      ['fix it', [{ role: 'assistant', text: 'LoginPage.tsx is broken.' }]],
      ['delete them', []],
      ['also add tests', [{ role: 'assistant', text: 'I fixed the login page.' }]],
      ['no, use staging instead', [{ role: 'assistant', text: "I'll deploy to production." }]],
      ['use the second one', [{ role: 'assistant', text: '1. Production\n2. Staging' }]],
      ['never mind', []],
      ['write a haiku about the ocean', []],
    ];
    for (const [m, t] of cases) {
      const a = r(m, t);
      const b = r(m, t);
      assertJson(a, b, `(J) deterministic: ${JSON.stringify(m)}`);
    }
  }

  // ─── (K) bounds / caps / exported values ────────────────────────────────────
  {
    assertEq(MAX_PRIOR_TURNS, 12, '(K) MAX_PRIOR_TURNS');
    assertEq(MAX_TURN_CHARS, 4000, '(K) MAX_TURN_CHARS');
    assertEq(MAX_MESSAGE_CHARS, 4000, '(K) MAX_MESSAGE_CHARS');
    assertEq(MAX_REFERENTS, 8, '(K) MAX_REFERENTS');
    assertEq(MAX_REFERENT_LEN, 40, '(K) MAX_REFERENT_LEN');
    assertEq(MAX_HINT_LEN, 160, '(K) MAX_HINT_LEN');
    assertEq(MAX_QUESTION_LEN, 200, '(K) MAX_QUESTION_LEN');
  }
  {
    // 500-turn window clamped, still resolves against a recent subject-bearing turn
    const big: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    for (let i = 0; i < 500; i += 1) big.push({ role: i % 2 ? 'assistant' : 'user', text: `turn ${i} touched the dashboard module` });
    const f = r('fix it', big);
    assert(frameIsValid(f), '(K) 500-turn window → valid frame');
    assertEq(f.resolvable, true, '(K) recent subject-bearing turn resolves "it"');
    assert(hasRef(f, 'it'), '(K) referent detected under a huge window');
  }
  {
    // 100k-char spaced message clamped, no throw
    const huge = 'please '.repeat(20000); // ~140k chars
    const f = r(huge, []);
    assert(frameIsValid(f), '(K) 100k message → valid frame');
  }
  {
    // referents hard cap: many distinct deictics
    const f = r('it them they that those this these him her it them', []);
    assert(refs(f).length <= MAX_REFERENTS, '(K) referents capped at MAX_REFERENTS', String(refs(f).length));
    assert(frameIsValid(f), '(K) many-deictics frame valid');
  }
  {
    // long question / long hint clamped
    const longQ = 'Which ' + 'very '.repeat(200) + 'environment?';
    const f = r('production', [{ role: 'assistant', text: longQ }]);
    assert(f.priorQuestionText.length <= MAX_QUESTION_LEN, '(K) priorQuestionText clamped', String(f.priorQuestionText.length));
    const longHint = 'The ' + 'dashboard '.repeat(200) + 'module is broken.';
    const f2 = r('fix it', [{ role: 'assistant', text: longHint }]);
    assert(f2.antecedentHint.length <= MAX_HINT_LEN, '(K) antecedentHint clamped', String(f2.antecedentHint.length));
  }

  // ─── (L) regression (QA) ─────────────────────────────────────────────────────
  {
    // Bug 1: an adverb-led fresh imperative (verb behind a leading adverb NOT in
    // COURTESY_TOKENS) must NOT be misclassified as an answer. Must match plain
    // 'build a login page' → new-topic, not carry forward.
    const q = [{ role: 'assistant', text: 'Anything else?' }];
    const adv = r('quickly build a login page', q);
    assertEq(adv.relation, 'new-topic', '(L) "quickly build a login page" after a question → new-topic, not answer');
    assertEq(adv.answersPriorQuestion, false, '(L) adverb-led imperative → answersPriorQuestion false');
    assertEq(adv.carriesForward, false, '(L) adverb-led imperative → carriesForward false');
    assertEq(adv.resolvable, false, '(L) adverb-led imperative → resolvable false');
    // and the dangling referent behind a leading adverb is NOT dropped
    for (const lead of ['quickly', 'just', 'now', 'simply']) {
      const f = r(`${lead} delete them`, q);
      assertEq(f.relation, 'continuation', `(L) "${lead} delete them" → continuation, not answer`);
      assertEq(f.answersPriorQuestion, false, `(L) "${lead} delete them" → answersPriorQuestion false`);
      assertEq(f.carriesForward, true, `(L) "${lead} delete them" → carriesForward true`);
      assert(hasRef(f, 'them'), `(L) "${lead} delete them" keeps the "them" referent`, JSON.stringify(refs(f)));
    }

    // Bug 2: clean/lower length desync (U+0130 'İ' lowercases to 2 code points)
    // must not garble the emitted referent span. Indices are computed against
    // `lower`, so spans must be sliced from `lower`.
    const I_DOT = String.fromCharCode(0x130); // U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE
    const themDesync = r(`${I_DOT} fix them`, [{ role: 'assistant', text: 'the login page' }]);
    assertJson(refs(themDesync), ['them'], '(L) İ length-desync → referent is "them" (not the shifted "hem")');
    assert(frameIsValid(themDesync), '(L) İ-them frame valid');
    const itDesync = r(`${I_DOT} delete it`, [{ role: 'assistant', text: 'the login page is broken' }]);
    assertJson(refs(itDesync), ['it'], '(L) İ length-desync → referent is "it" (not the shifted "t")');
    assert(frameIsValid(itDesync), '(L) İ-it frame valid');
  }

  // ─── (HOSTILE) totality: never throw, never leak ────────────────────────────
  try {
    for (const bad of [null, undefined, 42, NaN, true, {}, [], () => 1, Symbol('s'), 9n, Infinity, -0]) {
      assert(totalOn(bad), 'hostile message is total', JSON.stringify(String(bad).slice(0, 16)));
      const f = r(bad);
      assertEq(f.relation, 'new-topic', 'hostile message → new-topic');
      assertEq(f.carriesForward, false, 'hostile message → carriesForward false');
      assertJson(refs(f), [], 'hostile message → no referents');
    }

    // hostile priorTurns shapes
    for (const badTurns of [null, undefined, 42, 'nope', NaN, true, {}, Symbol('x'), 7n, () => []]) {
      assert(totalOn('fix it', badTurns), 'hostile priorTurns is total', JSON.stringify(String(badTurns).slice(0, 16)));
    }
    // array of nulls / junk entries → all dropped, still total
    assert(totalOn('fix it', [null, undefined, 1, 'x', true, {}, []]), 'junk-entry priorTurns is total');
    assertEq(r('fix it', [null, undefined, 1]).resolvable, false, 'all-junk window → not resolvable');
    // entries with wrong role / non-string text dropped
    assert(totalOn('fix it', [{ role: 'system', text: 'x' }, { role: 'user', text: 42 }]), 'invalid role/text dropped, total');

    // throwing-getter entries: one bad entry must not nuke the result
    const throwingEntry = {} as Record<string, unknown>;
    Object.defineProperty(throwingEntry, 'role', { get() { throw new Error('role boom'); }, enumerable: true });
    Object.defineProperty(throwingEntry, 'text', { get() { throw new Error('text boom'); }, enumerable: true });
    assert(totalOn('fix it', [throwingEntry, { role: 'assistant', text: 'the dashboard module is broken' }]), 'throwing-getter entry is total');
    assertEq(r('fix it', [throwingEntry, { role: 'assistant', text: 'the dashboard module is broken' }]).resolvable, true, 'good entry after a throwing one still resolves');

    // whole priorTurns is a throwing proxy (Array.isArray false) → treated as empty
    const throwingProxy = new Proxy({}, { get() { throw new Error('proxy boom'); } });
    assert(totalOn('fix it', throwingProxy), 'throwing-proxy priorTurns is total');

    // cyclic priorTurns array (contains itself)
    const cyc: unknown[] = [{ role: 'assistant', text: 'the login page is broken' }];
    cyc.push(cyc);
    assert(totalOn('fix it', cyc), 'cyclic priorTurns is total');
    assert(frameIsValid(r('fix it', cyc)), 'cyclic priorTurns → valid frame');

    // secret-shaped message → never echoed
    const SK = 'sk-ant-' + 'a'.repeat(48);
    const rSecretMsg = r(`delete ${SK}`, []);
    assert(frameIsValid(rSecretMsg), 'secret-shaped message → valid frame');
    assert(!JSON.stringify(rSecretMsg).includes('sk-ant'), 'secret-shaped message never leaks', JSON.stringify(rSecretMsg).slice(0, 80));

    // secret in a prior turn used as the hint → masked, never echoed
    const rSecretTurn = r('fix it', [{ role: 'assistant', text: `the api key is ${SK} and it is broken` }]);
    assert(frameIsValid(rSecretTurn), 'secret-in-turn → valid frame');
    assert(!JSON.stringify(rSecretTurn).includes('sk-ant'), 'secret in prior turn never leaks into the hint', rSecretTurn.antecedentHint);
    assert(rSecretTurn.antecedentHint.length > 0, 'hint still produced (masked) from a secret-bearing turn');

    // JWT-shaped prior question → masked in priorQuestionText
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const rJwt = r('production', [{ role: 'assistant', text: `Which ${JWT} environment?` }]);
    assert(!JSON.stringify(rJwt).includes('eyJ'), 'JWT never leaks into priorQuestionText');

    // bidi / zero-width injection in the message + prior turn → stripped
    const inj = 'fix' + String.fromCharCode(0x202e) + ' it' + String.fromCharCode(0x200b);
    const injTurn = 'the' + String.fromCharCode(0xfeff) + ' login' + String.fromCharCode(0x2028) + 'page is broken';
    const rInj = r(inj, [{ role: 'assistant', text: injTurn }]);
    assert(frameIsValid(rInj), 'injection input → valid frame (no unsafe chars anywhere)');
    assert(!hasUnsafeChars(JSON.stringify(rInj)), 'no control/bidi/zero-width/fence chars in any field');
    assert(hasRef(rInj, 'it'), 'referent still detected after stripping injection chars');

    // control / fence chars in a message
    const nasty = 'fix ' + String.fromCharCode(0) + 'it `code` <untrusted>';
    const rNasty = r(nasty, []);
    assert(frameIsValid(rNasty), 'control/fence message → valid frame');
    assert(!hasUnsafeChars(rNasty.antecedentHint + rNasty.priorQuestionText + refs(rNasty).join('')), 'fence/control chars stripped from echoes');

    // a battery of mixed inputs all obey the caps + invariants
    const battery: Array<[unknown, unknown]> = [
      ['send it', [{ role: 'assistant', text: 'The report is ready' }]],
      ['the other one', [{ role: 'assistant', text: 'Do you want A or B?' }]],
      ['do the same for the footer', [{ role: 'user', text: 'header updated' }]],
      ['', [{ role: 'assistant', text: 'hi' }]],
      ['   ', []],
      ['deploy', [{ role: 'assistant', text: 'ready when you are' }]],
      ['yes', [{ role: 'assistant', text: 'Ship it?' }]],
    ];
    for (const [m, t] of battery) {
      assert(totalOn(m, t), 'battery input total', JSON.stringify(m));
      const f = r(m, t);
      assert(frameIsValid(f), 'battery frame valid', JSON.stringify(m));
    }

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chat-turn-continuity-core smoke cases passed (${passes} passed).`);
}

main();
