/**
 * response-register-core-smoketest — the PURE, per-turn RESPONSE-REGISTER decision
 * (src/lib/responseRegisterCore.ts). It derives how the ASSISTANT's answer should be
 * shaped THIS turn (verbosity + format + explain-vs-do + formality) from the current
 * message, explicit inline directives, prior-turn corrective feedback, a sticky
 * session preference, and (as a low-priority default) the aggregate profileHint —
 * and renders one compact imperative directive. Asserted here (spec groups 1-6):
 *
 *   (1) EXPLICIT inline — "just the code, no explanation" -> just_do + code_first +
 *       terse + non-empty directive; "keep it short"/"tl;dr"/"one line" -> terse/brief;
 *       "explain step by step"/"eli5" -> detailed + explain; "bullet points" -> bullets.
 *   (2) PRIOR-TURN FEEDBACK — last user turn "that was way too long" steps verbosity
 *       DOWN vs the same message with no history; "give me more detail" steps UP;
 *       "stop explaining, just do it" -> just_do; source === 'feedback'.
 *   (3) STICKY + COMMAND — setStored('brief') then a neutral message -> brief/sticky;
 *       parse of '/style brief', '/detail', '/code' -> expected partials; unknown -> null.
 *   (4) NEUTRAL DEFAULT — a plain question with no history/prefs -> EMPTY directive
 *       (byte-identical no-op) + source 'default'.
 *   (5) PRECEDENCE — explicit beats sticky beats feedback beats profileHint beats default.
 *   (6) HOSTILE — null/undefined/number/bool/{}/[]/NaN/bigint/huge/control-chars/astral-
 *       at-boundary/lone-surrogate/cyclic/throwing-proxy/__proto__+constructor keys never
 *       throw and yield a valid, bounded, surrogate-safe, control-char-free register.
 *
 * Pure — loads under tsx (type-only imports in the core). Run:
 *   npx tsx scripts/response-register-core-smoketest.ts
 */

import {
  resolveResponseRegister,
  buildResponseRegisterDirective,
  parseResponseRegisterCommand,
  describeResponseRegisterSetting,
  getStoredResponseRegisterPreference,
  setStoredResponseRegisterPreference,
  MAX_DIRECTIVE_CHARS,
  MAX_STATUS_CHARS,
  MAX_ANALYZE_CHARS,
  MAX_PRIOR_SCAN,
  MAX_WORDS,
  RESPONSE_REGISTER_STORAGE_KEY,
  type ResponseRegister,
  type ResponseVerbosity,
} from '../src/lib/responseRegisterCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertLE(a: number, b: number, m: string): void {
  assert(typeof a === 'number' && a <= b, m, 'got ' + a + ' want <= ' + b);
}
function assertNoThrow(fn: () => void, m: string): void {
  let threw = false;
  let err = '';
  try { fn(); } catch (e) { threw = true; err = String(e); }
  assert(!threw, m, err);
}

// ── control-char / code-point helpers (build control chars, never raw literals) ──
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const RLO = String.fromCharCode(0x202e);
const BOM = String.fromCharCode(0xfeff);
const COMBINING_ACUTE = String.fromCharCode(0x0301);
const TAG = String.fromCodePoint(0xe0041);
const LONE_SUR = String.fromCharCode(0xd83d); // lone high surrogate
const MATH3 = String.fromCodePoint(0x1d7db); // 𝟛 astral digit
const FAMILY =
  String.fromCodePoint(0x1f468) + ZWJ + String.fromCodePoint(0x1f469) + ZWJ +
  String.fromCodePoint(0x1f467) + ZWJ + String.fromCodePoint(0x1f466);

const cpLen = (s: string): number => Array.from(s).length;

/** No control / DEL / C1 / line-sep / format (zero-width, bidi) / Tag / lone-surrogate / fence chars. */
function isCleanLabel(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of Array.from(s)) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return false;
    if (c === 0x2028 || c === 0x2029) return false;
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x200e || c === 0x200f) return false;
    if (c === 0x2060 || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (c >= 0xe0000 && c <= 0xe007f) return false;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return false;
    if (c === 0x60 || c === 0x3c || c === 0x3e) return false; // ` < >
  }
  return true;
}
/** Like isCleanLabel but permits backticks (`/brief`) — for the user-facing status line. */
function isCleanStatus(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of Array.from(s)) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return false;
    if (c === 0x2028 || c === 0x2029) return false;
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x200e || c === 0x200f) return false;
    if (c === 0x2060 || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (c >= 0xe0000 && c <= 0xe007f) return false;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return false;
  }
  return true;
}
function hasLoneSurrogate(s: string): boolean {
  for (const ch of Array.from(s)) {
    if (ch.length === 1) {
      const c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
  }
  return false;
}

const VERBOSITY = new Set(['terse', 'brief', 'normal', 'detailed']);
const FORMAT = new Set(['prose', 'bullets', 'code_first', 'auto']);
const POSTURE = new Set(['just_do', 'explain', 'auto']);
const FORMALITY = new Set(['casual', 'neutral', 'formal']);
const SOURCES = new Set(['explicit', 'sticky', 'feedback', 'message_style', 'profile', 'default']);
const ORDER = ['terse', 'brief', 'normal', 'detailed'];
const rankOf = (v: string): number => ORDER.indexOf(v);

/** Structural + bounds + safety check for a register (used across groups). */
function wellFormed(r: ResponseRegister): boolean {
  return (
    !!r && typeof r === 'object' &&
    VERBOSITY.has(r.verbosity) && FORMAT.has(r.format) &&
    POSTURE.has(r.posture) && FORMALITY.has(r.formality) &&
    SOURCES.has(r.source) &&
    typeof r.directive === 'string' &&
    cpLen(r.directive) <= MAX_DIRECTIVE_CHARS + 1 &&
    isCleanLabel(r.directive) && !hasLoneSurrogate(r.directive) &&
    // empty directive iff (and only meaningfully for) the neutral default
    (r.directive.length > 0 || (r.verbosity === 'normal' && r.format === 'auto' && r.posture === 'auto' && r.formality === 'neutral'))
  );
}

function reset(): void {
  setStoredResponseRegisterPreference(null);
}

function main(): void {
  // Sanity on exported caps.
  assert(MAX_ANALYZE_CHARS > 0 && MAX_PRIOR_SCAN > 0 && MAX_WORDS > 0, 'caps positive');
  assert(MAX_DIRECTIVE_CHARS > 20 && MAX_STATUS_CHARS > 20, 'render caps sane');
  assertEq(RESPONSE_REGISTER_STORAGE_KEY, 'uc_response_register', 'storage key stable');

  // ─── (1) EXPLICIT inline directives ─────────────────────────────────────────
  reset();
  {
    const codeOnly = resolveResponseRegister({ currentMessage: 'just the code, no explanation' });
    assert(wellFormed(codeOnly), '(1) code-only well-formed');
    assertEq(codeOnly.posture, 'just_do', '(1) just the code -> just_do');
    assertEq(codeOnly.format, 'code_first', '(1) just the code -> code_first');
    assertEq(codeOnly.verbosity, 'terse', '(1) just the code -> terse');
    assert(codeOnly.directive.length > 0, '(1) explicit -> non-empty directive');
    assertEq(codeOnly.source, 'explicit', '(1) source explicit');
    assert(codeOnly.directive.includes('code'), '(1) directive mentions leading with code');

    const keepShort = resolveResponseRegister({ currentMessage: 'answer this but keep it short please' });
    assert(keepShort.verbosity === 'brief' || keepShort.verbosity === 'terse', '(1) keep it short -> brief/terse');
    assertEq(keepShort.source, 'explicit', '(1) keep it short source explicit');

    const tldr = resolveResponseRegister({ currentMessage: 'tl;dr' });
    assert(rankOf(tldr.verbosity) <= rankOf('brief'), '(1) tl;dr -> terse/brief');

    const oneLine = resolveResponseRegister({ currentMessage: 'give me the answer in one line' });
    assertEq(oneLine.verbosity, 'terse', '(1) one line -> terse');

    const stepwise = resolveResponseRegister({ currentMessage: 'explain step by step how promises work' });
    assertEq(stepwise.verbosity, 'detailed', '(1) step by step -> detailed');
    assertEq(stepwise.posture, 'explain', '(1) step by step -> explain');

    const eli5 = resolveResponseRegister({ currentMessage: 'eli5 how does dns actually work' });
    assertEq(eli5.verbosity, 'detailed', '(1) eli5 -> detailed');
    assertEq(eli5.posture, 'explain', '(1) eli5 -> explain');
    assertEq(eli5.formality, 'casual', '(1) eli5 -> casual');

    const bullets = resolveResponseRegister({ currentMessage: 'give it to me as bullet points' });
    assertEq(bullets.format, 'bullets', '(1) bullet points -> bullets');
    assertEq(bullets.source, 'explicit', '(1) bullets source explicit');

    const prose = resolveResponseRegister({ currentMessage: 'write it in prose, no bullets' });
    assertEq(prose.format, 'prose', '(1) in prose -> prose');

    const formal = resolveResponseRegister({ currentMessage: 'please answer in a professional tone' });
    assertEq(formal.formality, 'formal', '(1) professional tone -> formal');

    // secret-safe: the message text is NEVER echoed into the directive
    const secret = resolveResponseRegister({ currentMessage: 'just the code SECRET_TOKEN_9f3a2b' });
    assert(!secret.directive.includes('SECRET_TOKEN'), '(1) directive does NOT echo message text');
    assert(isCleanLabel(secret.directive), '(1) directive clean');
  }

  // ─── (2) PRIOR-TURN corrective feedback ─────────────────────────────────────
  reset();
  {
    const msg = 'and what about caching?';
    const noHist = resolveResponseRegister({ currentMessage: msg });
    assertEq(noHist.source, 'default', '(2) baseline (no history) is default');

    const tooLong = resolveResponseRegister({
      currentMessage: msg,
      priorMessages: [
        { role: 'user', content: 'explain the whole auth flow' },
        { role: 'assistant', content: 'a very long answer ...' },
        { role: 'user', content: 'that was way too long' },
      ],
    });
    assert(wellFormed(tooLong), '(2) too-long feedback well-formed');
    assert(rankOf(tooLong.verbosity) < rankOf(noHist.verbosity), '(2) "too long" steps verbosity DOWN vs no-history');
    assertEq(tooLong.source, 'feedback', '(2) too long -> source feedback');
    assert(tooLong.directive.length > 0, '(2) feedback -> non-empty directive');

    const moreDetail = resolveResponseRegister({
      currentMessage: msg,
      priorMessages: [
        { role: 'user', content: 'summarize the design' },
        { role: 'assistant', content: 'short answer' },
        { role: 'user', content: 'give me more detail' },
      ],
    });
    assert(rankOf(moreDetail.verbosity) > rankOf(noHist.verbosity), '(2) "more detail" steps verbosity UP vs no-history');
    assertEq(moreDetail.source, 'feedback', '(2) more detail -> source feedback');

    const stopExplain = resolveResponseRegister({
      currentMessage: msg,
      priorMessages: [
        { role: 'user', content: 'walk me through it' },
        { role: 'assistant', content: '...' },
        { role: 'user', content: 'stop explaining, just do it' },
      ],
    });
    assertEq(stopExplain.posture, 'just_do', '(2) "stop explaining, just do it" -> just_do');
    assertEq(stopExplain.source, 'feedback', '(2) stop explaining -> source feedback');

    // feedback reads the LAST user turn only — a stale non-feedback tail = no feedback
    const noFeedback = resolveResponseRegister({
      currentMessage: msg,
      priorMessages: [
        { role: 'user', content: 'that was too long' },
        { role: 'assistant', content: 'ok shorter' },
        { role: 'user', content: 'thanks, perfect' },
      ],
    });
    assertEq(noFeedback.source, 'default', '(2) non-corrective last turn -> no feedback');
  }

  // ─── (3) STICKY + COMMAND ───────────────────────────────────────────────────
  reset();
  {
    const persisted = setStoredResponseRegisterPreference('brief');
    assert(persisted === true || persisted === false, '(3) setStored returns a boolean');
    const stored = getStoredResponseRegisterPreference();
    assert(!!stored && stored.verbosity === 'brief', '(3) stored pref is brief');

    const stickyReg = resolveResponseRegister({ currentMessage: 'what is a monad?' });
    assertEq(stickyReg.verbosity, 'brief', '(3) sticky -> brief verbosity');
    assertEq(stickyReg.source, 'sticky', '(3) sticky -> source sticky');
    assert(stickyReg.directive.length > 0, '(3) sticky -> non-empty directive');

    reset();
    assertEq(getStoredResponseRegisterPreference(), null, '(3) reset clears sticky');
    const afterClear = resolveResponseRegister({ currentMessage: 'what is a monad?' });
    assertEq(afterClear.source, 'default', '(3) after clear -> default');

    // command parsing
    const pStyle = parseResponseRegisterCommand('/style brief');
    assert(!!pStyle && pStyle.verbosity === 'brief', '(3) /style brief -> {verbosity:brief}');
    const pDetail = parseResponseRegisterCommand('/detail');
    assert(!!pDetail && pDetail.verbosity === 'detailed' && pDetail.posture === 'explain', '(3) /detail -> detailed+explain');
    const pCode = parseResponseRegisterCommand('/code');
    assert(!!pCode && pCode.format === 'code_first', '(3) /code -> code_first');
    const pBrief = parseResponseRegisterCommand('/brief');
    assert(!!pBrief && pBrief.verbosity === 'brief', '(3) /brief -> brief');
    const pCasual = parseResponseRegisterCommand('/casual');
    assert(!!pCasual && pCasual.formality === 'casual', '(3) /casual -> casual');
    assertEq(parseResponseRegisterCommand('/xyz'), null, '(3) unknown command -> null');
    assertEq(parseResponseRegisterCommand('/style bogus'), null, '(3) /style bogus -> null');
    // natural phrasing through the same parser
    const pNat = parseResponseRegisterCommand('keep it short');
    assert(!!pNat && (pNat.verbosity === 'brief' || pNat.verbosity === 'terse'), '(3) natural "keep it short" parses');
    assertEq(parseResponseRegisterCommand('hello there friend'), null, '(3) non-style phrase -> null');

    // setStored accepts a command/partial and reset tokens clear it
    setStoredResponseRegisterPreference('/style detail');
    const s2 = getStoredResponseRegisterPreference();
    assert(!!s2 && s2.verbosity === 'detailed', '(3) setStored("/style detail") stores detailed');
    setStoredResponseRegisterPreference('reset');
    assertEq(getStoredResponseRegisterPreference(), null, '(3) "reset" token clears sticky');
    setStoredResponseRegisterPreference({ format: 'bullets' });
    const s3 = getStoredResponseRegisterPreference();
    assert(!!s3 && s3.format === 'bullets', '(3) setStored(partial object) works');
    reset();
  }

  // ─── (4) NEUTRAL DEFAULT (byte-identical no-op) ──────────────────────────────
  reset();
  {
    const plain = resolveResponseRegister({ currentMessage: 'What is the capital of France?' });
    assertEq(plain.directive, '', '(4) plain question -> EMPTY directive');
    assertEq(plain.source, 'default', '(4) plain question -> source default');
    assertEq(plain.verbosity, 'normal', '(4) default verbosity normal');
    assertEq(plain.format, 'auto', '(4) default format auto');
    assertEq(plain.posture, 'auto', '(4) default posture auto');
    assertEq(plain.formality, 'neutral', '(4) default formality neutral');
    assert(wellFormed(plain), '(4) default well-formed');

    const empty = resolveResponseRegister({});
    assertEq(empty.directive, '', '(4) empty input -> empty directive');
    assertEq(empty.source, 'default', '(4) empty input -> default');

    const none = resolveResponseRegister(undefined as unknown);
    assertEq(none.source, 'default', '(4) undefined input -> default');

    // building the neutral register directly yields the byte-identical no-op
    assertEq(buildResponseRegisterDirective({ verbosity: 'normal', format: 'auto', posture: 'auto', formality: 'neutral' }), '', '(4) neutral register -> empty directive');
  }

  // ─── (5) PRECEDENCE ──────────────────────────────────────────────────────────
  reset();
  {
    // explicit beats sticky
    setStoredResponseRegisterPreference('detailed');
    const eBeatsS = resolveResponseRegister({ currentMessage: 'just the code' });
    assertEq(eBeatsS.source, 'explicit', '(5) explicit beats sticky');
    assertEq(eBeatsS.format, 'code_first', '(5) explicit content wins over sticky');
    reset();

    // sticky beats feedback
    setStoredResponseRegisterPreference('brief');
    const sBeatsF = resolveResponseRegister({
      currentMessage: 'ok',
      priorMessages: [{ role: 'user', content: 'give me more detail' }],
    });
    assertEq(sBeatsF.source, 'sticky', '(5) sticky beats feedback');
    assertEq(sBeatsF.verbosity, 'brief', '(5) sticky content wins over feedback');
    reset();

    // feedback beats profileHint
    const fBeatsP = resolveResponseRegister({
      currentMessage: 'ok',
      priorMessages: [{ role: 'user', content: 'that was too long' }],
      profileHint: { prefersStructuredOutput: true },
    });
    assertEq(fBeatsP.source, 'feedback', '(5) feedback beats profileHint');

    // profileHint beats default
    const pBeatsD = resolveResponseRegister({ currentMessage: 'ok', profileHint: { prefersStructuredOutput: true } });
    assertEq(pBeatsD.source, 'profile', '(5) profileHint beats default');
    assertEq(pBeatsD.format, 'bullets', '(5) profileHint contributes format');
    assert(fBeatsP.source !== pBeatsD.source, '(5) feedback and profile are distinct outcomes');

    // profileHint with the middle 'detailed' length stays neutral (no directive)
    const pNeutral = resolveResponseRegister({ currentMessage: 'ok', profileHint: { preferredResponseLength: 'detailed' } });
    assertEq(pNeutral.source, 'default', '(5) profileHint middle length -> default (no-op)');

    // message-style (layer 4) fires only on a strong signal, and below profile
    const styleNovice = resolveResponseRegister({ currentMessage: "i'm new to programming, how do i start?" });
    assertEq(styleNovice.source, 'message_style', '(5) novice cue -> message_style');
    assertEq(styleNovice.posture, 'explain', '(5) novice -> explain');
    reset();
  }

  // ─── determinism ─────────────────────────────────────────────────────────────
  reset();
  {
    const inpA = {
      currentMessage: 'explain step by step how X works',
      priorMessages: [{ role: 'user', content: 'that was too long' }],
      profileHint: { preferredResponseLength: 'thorough' },
    };
    assertEq(JSON.stringify(resolveResponseRegister(inpA)), JSON.stringify(resolveResponseRegister(inpA)), 'determinism: resolve stable');
    const inpB = { currentMessage: 'ok', priorMessages: [{ role: 'user', content: 'give me more detail' }] };
    assertEq(JSON.stringify(resolveResponseRegister(inpB)), JSON.stringify(resolveResponseRegister(inpB)), 'determinism: feedback stable');
    assertEq(
      buildResponseRegisterDirective({ verbosity: 'brief', format: 'code_first', posture: 'just_do', formality: 'neutral' }),
      buildResponseRegisterDirective({ verbosity: 'brief', format: 'code_first', posture: 'just_do', formality: 'neutral' }),
      'determinism: directive stable',
    );
    assertEq(describeResponseRegisterSetting({ verbosity: 'brief' }), describeResponseRegisterSetting({ verbosity: 'brief' }), 'determinism: status stable');
  }

  // ─── bounds ──────────────────────────────────────────────────────────────────
  reset();
  {
    const hugeMsg = 'x'.repeat(1_000_000);
    const hugePlain = resolveResponseRegister({ currentMessage: hugeMsg });
    assert(wellFormed(hugePlain), 'bounds: huge plain msg well-formed');
    assertEq(hugePlain.directive, '', 'bounds: huge plain msg -> default (no signal)');

    const hugeWithDir = resolveResponseRegister({ currentMessage: 'just the code ' + hugeMsg });
    assertLE(cpLen(hugeWithDir.directive), MAX_DIRECTIVE_CHARS + 1, 'bounds: huge+directive directive bounded');
    assertEq(hugeWithDir.format, 'code_first', 'bounds: leading directive parsed despite huge tail');

    // astral char straddling the analyze-slice boundary must not split / crash
    const astralAtBoundary = 'a'.repeat(MAX_ANALYZE_CHARS - 1) + MATH3 + 'just the code';
    assertNoThrow(() => {
      const r = resolveResponseRegister({ currentMessage: astralAtBoundary });
      assert(wellFormed(r), 'bounds: astral-at-boundary well-formed');
      assert(!hasLoneSurrogate(r.directive), 'bounds: no lone surrogate leaked');
    }, 'bounds: astral at slice boundary never throws');

    // very deep priorMessages tail is bounded by MAX_PRIOR_SCAN
    const deep: Array<{ role: string; content: string }> = [];
    for (let i = 0; i < MAX_PRIOR_SCAN + 50; i++) deep.push({ role: 'user', content: 'filler line number ' + i });
    deep.push({ role: 'user', content: 'that was too long' });
    assertNoThrow(() => resolveResponseRegister({ currentMessage: 'ok', priorMessages: deep }), 'bounds: deep history never throws');

    // status line bounded + clean (keeps backticks)
    const status = describeResponseRegisterSetting({ verbosity: 'terse', format: 'code_first', posture: 'just_do', formality: 'formal' });
    assertLE(cpLen(status), MAX_STATUS_CHARS + 1, 'bounds: status bounded');
    assert(isCleanStatus(status), 'bounds: status clean');
    const statusNeutral = describeResponseRegisterSetting({ verbosity: 'normal', format: 'auto', posture: 'auto', formality: 'neutral' });
    assert(statusNeutral.length > 0 && isCleanStatus(statusNeutral), 'bounds: neutral status non-empty + clean');
  }

  // ─── (6) HOSTILE — never throws, always valid + bounded + clean ─────────────
  reset();
  {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const throwingProxy = new Proxy({}, {
      get() { throw new Error('boom-get'); },
      has() { throw new Error('boom-has'); },
      ownKeys() { throw new Error('boom-keys'); },
      getOwnPropertyDescriptor() { throw new Error('boom-desc'); },
    });
    const astral = FAMILY + ' ' + 'privet ' + MATH3 + ' cafe' + COMBINING_ACUTE;
    const ctrl = 'line' + NUL + BEL + ESC + LS + PS + DEL + TAG + BOM + RLO + ZWSP;
    const loneSur = 'abc' + LONE_SUR + 'def';
    const protoDoc = JSON.parse('{"__proto__":{"polluted":true},"preferredResponseLength":"brief"}');
    const throwingContent = { role: 'user', content: { toString() { throw new Error('no-string'); } } };

    const hostiles: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['number', 42],
      ['negative', -1],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['boolean', true],
      ['empty-object', {}],
      ['array', []],
      ['bigint', 10n],
      ['symbol', Symbol('s')],
      ['empty-string', ''],
      ['whitespace', '   ' + String.fromCharCode(9) + '  '],
      ['cyclic', cyclic],
      ['throwing-proxy', throwingProxy],
      ['astral', astral],
      ['control-chars', ctrl],
      ['lone-surrogate', loneSur],
      ['proto-doc', protoDoc],
    ];

    // whole-input hostile
    for (const [label, inp] of hostiles) {
      assertNoThrow(() => {
        const r = resolveResponseRegister(inp);
        assert(wellFormed(r), '(6) whole-input register valid :: ' + label);
      }, '(6) resolve(whole) never throws :: ' + label);
    }

    // hostile in each slot
    const slots = ['currentMessage', 'sticky', 'profileHint', 'priorMessages'] as const;
    for (const [label, inp] of hostiles) {
      for (const slot of slots) {
        assertNoThrow(() => {
          const r = resolveResponseRegister({ [slot]: inp } as Record<string, unknown>);
          assert(wellFormed(r), '(6) slot register valid :: ' + slot + '/' + label);
        }, '(6) resolve never throws :: ' + slot + '/' + label);
      }
    }

    // hostile priorMessages shapes
    const badPriors: unknown[] = [
      null, undefined, 42, 'a string', {},
      [null, undefined, 1, 'x', true, NaN],
      [{ role: 'user', content: 123 }, { role: 'user' }, { content: 'orphan' }, throwingContent],
      [{ role: 'user', content: throwingProxy }],
      [{ role: 'user', content: 'that was too long' }, throwingProxy],
      throwingProxy,
    ];
    for (let i = 0; i < badPriors.length; i++) {
      assertNoThrow(() => {
        const r = resolveResponseRegister({ currentMessage: 'ok', priorMessages: badPriors[i] });
        assert(wellFormed(r), '(6) bad-priors register valid #' + i);
      }, '(6) resolve never throws with bad priors #' + i);
    }

    // prototype pollution never happens via profileHint / stored doc
    resolveResponseRegister({ currentMessage: 'ok', profileHint: protoDoc });
    assert(({} as Record<string, unknown>).polluted === undefined, '(6) no Object.prototype pollution (instance)');
    assert((Object.prototype as Record<string, unknown>).polluted === undefined, '(6) Object.prototype untouched');
    // protoDoc still contributes its real field
    const proReg = resolveResponseRegister({ currentMessage: 'ok', profileHint: protoDoc });
    assertEq(proReg.verbosity, 'brief', '(6) proto-doc real field (preferredResponseLength) honored');

    // buildResponseRegisterDirective hostile
    for (const [label, inp] of hostiles) {
      assertNoThrow(() => {
        const d = buildResponseRegisterDirective(inp);
        assert(typeof d === 'string', '(6) directive is string :: ' + label);
        assertLE(cpLen(d), MAX_DIRECTIVE_CHARS + 1, '(6) directive bounded :: ' + label);
        assert(isCleanLabel(d), '(6) directive clean :: ' + label);
        assert(!hasLoneSurrogate(d), '(6) directive surrogate-safe :: ' + label);
      }, '(6) buildDirective never throws :: ' + label);
    }
    // a register carrying hostile axis values renders neutrally (validated), never leaks
    const hostileReg = buildResponseRegisterDirective({ verbosity: RLO + 'terse', format: '<script>', posture: '__proto__', formality: 'constructor' });
    assertEq(hostileReg, '', '(6) hostile axis values -> validated to neutral -> empty directive');

    // parseResponseRegisterCommand hostile + proto keys
    for (const [label, inp] of hostiles) {
      assertNoThrow(() => {
        const p = parseResponseRegisterCommand(inp);
        assert(p === null || typeof p === 'object', '(6) parse result safe :: ' + label);
      }, '(6) parseCommand never throws :: ' + label);
    }
    assertEq(parseResponseRegisterCommand('/style __proto__'), null, '(6) /style __proto__ -> null (no proto hazard)');
    assertEq(parseResponseRegisterCommand('/style constructor'), null, '(6) /style constructor -> null');
    assertEq(parseResponseRegisterCommand('/style toString'), null, '(6) /style toString -> null');
    assertEq(parseResponseRegisterCommand('/__proto__'), null, '(6) /__proto__ -> null');

    // describeResponseRegisterSetting hostile
    for (const [label, inp] of hostiles) {
      assertNoThrow(() => {
        const s = describeResponseRegisterSetting(inp);
        assert(typeof s === 'string' && s.length > 0, '(6) status is non-empty string :: ' + label);
        assertLE(cpLen(s), MAX_STATUS_CHARS + 1, '(6) status bounded :: ' + label);
        assert(isCleanStatus(s), '(6) status clean :: ' + label);
        assert(!hasLoneSurrogate(s), '(6) status surrogate-safe :: ' + label);
      }, '(6) describeSetting never throws :: ' + label);
    }

    // setStoredResponseRegisterPreference hostile (must not throw; leaves state clean)
    for (const [label, inp] of hostiles) {
      assertNoThrow(() => { setStoredResponseRegisterPreference(inp); }, '(6) setStored never throws :: ' + label);
    }
    reset();
    assertEq(getStoredResponseRegisterPreference(), null, '(6) sticky cleared after hostile sets');

    // getStored tolerates a hostile stored raw value (simulate a corrupt localStorage)
    const g = globalThis as { localStorage?: unknown };
    const hadLS = 'localStorage' in g;
    const prevLS = g.localStorage;
    try {
      let bad = '{not json' + NUL + RLO;
      g.localStorage = {
        getItem: (_k: string) => bad,
        setItem: (_k: string, _v: string) => { /* noop */ },
        removeItem: (_k: string) => { bad = ''; },
      };
      assertNoThrow(() => {
        const pref = getStoredResponseRegisterPreference();
        assert(pref === null || (typeof pref === 'object'), '(6) corrupt stored value -> safe');
      }, '(6) getStored never throws on corrupt localStorage');
    } finally {
      if (hadLS) g.localStorage = prevLS;
      else delete (g as Record<string, unknown>).localStorage;
    }
  }

  reset();
  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll response-register-core smoke cases passed (' + passes + ' passed).');
}

main();
