// Smoke test for src/lib/streamDegeneracyCore.ts
// Run: npx tsx scripts/stream-degeneracy-core-smoketest.ts
//
// Authored by hand: the build agent completed the core but stalled before writing
// this smoke. Covers healthy input, each degeneracy kind (char_run / phrase_loop /
// line_loop / low_diversity), bounds, secret-safety, determinism, describe copy,
// options clamping, and a hostile-input group.
import {
  assessStreamDegeneracy,
  describeStreamDegeneracy,
  MAX_SCAN_CHARS,
  CHAR_RUN_MIN,
  LOOP_SPAN_MIN,
  REPEAT_UNIT_MAX,
  DIVERSITY_MIN_WORDS,
  type StreamDegeneracyVerdict,
} from '../src/lib/streamDegeneracyCore';

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string): void {
  if (cond) passed += 1;
  else { failed += 1; console.error('  FAIL:', msg); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, `${msg} (got ${JSON.stringify(a)} want ${JSON.stringify(b)})`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)} want ${JSON.stringify(b)})`);
}

// ── (A) healthy / non-degenerate ────────────────────────────────────────────
for (const s of [
  'The quick brown fox jumps over the lazy dog and then keeps writing normal prose.',
  '', // empty
  'a', // single char
  '----------', // short divider well under CHAR_RUN_MIN
  'ab'.repeat(50), // 100 chars, span 100 < LOOP_SPAN_MIN → not a loop
  'name,age,city\nalice,30,nyc\nbob,25,sf\ncarol,41,la\n', // CSV-ish, diverse
  'a'.repeat(CHAR_RUN_MIN - 1), // one below the char-run threshold
]) {
  const v = assessStreamDegeneracy(s);
  assertEq(v.degenerate, false, `healthy stays non-degenerate: ${JSON.stringify(s.slice(0, 20))}`);
  assertEq(v.kind, 'none', 'healthy kind none');
  assertEq(v.confidence, 0, 'healthy confidence 0');
  assertEq(v.repeatUnit, '', 'healthy repeatUnit empty');
  assertEq(v.reason, '', 'healthy reason empty');
}

// ── (B) char_run ────────────────────────────────────────────────────────────
{
  const v = assessStreamDegeneracy('a'.repeat(CHAR_RUN_MIN));
  assertEq(v.degenerate, true, 'char_run at threshold is degenerate');
  assertEq(v.kind, 'char_run', 'char_run kind');
  assertEq(v.repeats, CHAR_RUN_MIN, 'char_run repeats = run length');
  assert(v.confidence > 0 && v.confidence <= 1, 'char_run confidence in (0,1]');
  assertEq(v.repeatUnit, 'a', 'char_run repeatUnit is the single char');
  assert(v.reason.length > 0, 'char_run has a reason');
  // huge input still caught, still bounded to tail scan
  const huge = assessStreamDegeneracy('a'.repeat(100000));
  assertEq(huge.degenerate, true, 'huge char run degenerate');
  assertEq(huge.kind, 'char_run', 'huge char run kind');
  assert(huge.repeats <= MAX_SCAN_CHARS, 'repeats bounded by scan window');
}

// ── (C) phrase_loop ─────────────────────────────────────────────────────────
{
  const v = assessStreamDegeneracy('ab'.repeat(150)); // 300 chars, p=2
  assertEq(v.degenerate, true, 'phrase_loop degenerate');
  assertEq(v.kind, 'phrase_loop', 'phrase_loop kind');
  assert(v.repeats >= 4, 'phrase_loop repeats >= 4');
  assert(v.repeatUnit.length > 0 && v.repeatUnit.length <= REPEAT_UNIT_MAX, 'phrase_loop repeatUnit bounded');
  // a realistic looping sentence
  const sent = assessStreamDegeneracy('I will help you. '.repeat(30));
  assertEq(sent.degenerate, true, 'looping sentence degenerate');
  assert(sent.kind === 'phrase_loop' || sent.kind === 'line_loop', 'looping sentence is a loop kind');
  // just under span → healthy
  const under = assessStreamDegeneracy('ab'.repeat(60)); // 120 < LOOP_SPAN_MIN
  assertEq(under.degenerate, false, `span under ${LOOP_SPAN_MIN} stays healthy`);
}

// ── (D) line_loop (unit contains a newline) ─────────────────────────────────
{
  const v = assessStreamDegeneracy('xy\n'.repeat(100)); // p=3, has newline
  assertEq(v.degenerate, true, 'line_loop degenerate');
  assertEq(v.kind, 'line_loop', 'line_loop kind');
  assert(v.repeatUnit.includes('\\n'), 'line_loop repeatUnit has escaped newline (no raw newline)');
  assert(!v.repeatUnit.includes('\n'), 'line_loop repeatUnit contains no raw newline');
}

// ── (E) low_diversity (non-periodic vocabulary collapse) ────────────────────
{
  // Many "the" tokens (dominant) + a few distinct tokens at the tail so the tail
  // is NOT cleanly periodic → periodic detector misses, low-diversity fires.
  const text = Array(DIVERSITY_MIN_WORDS + 50).fill('the').join(' ') + ' cat dog bird fish tree rock';
  const v = assessStreamDegeneracy(text);
  assertEq(v.degenerate, true, 'low_diversity degenerate');
  assertEq(v.kind, 'low_diversity', 'low_diversity kind');
  assertEq(v.repeats, 0, 'low_diversity repeats 0 (not periodic)');
  assert(v.confidence > 0, 'low_diversity confidence > 0');
  // diverse prose of the same length stays healthy
  const diverse = Array.from({ length: DIVERSITY_MIN_WORDS + 50 }, (_v, i) => 'word' + i).join(' ');
  assertEq(assessStreamDegeneracy(diverse).degenerate, false, 'diverse long prose healthy');
}

// ── (F) secret-safety in repeatUnit ─────────────────────────────────────────
{
  // A phrase loop whose unit is a base64/token-shaped run → redacted in the echo.
  const v = assessStreamDegeneracy('ABCDEFGHIJKLMNOPQRST'.repeat(15)); // p=20, secret-shaped
  assertEq(v.degenerate, true, 'secret-shaped loop degenerate');
  assert(v.repeatUnit.includes('redacted'), 'secret-shaped repeatUnit is redacted');
  assert(!v.repeatUnit.includes('ABCDEFGHIJKLMNOP'), 'raw secret run not echoed');
  // control chars never survive into repeatUnit (a genuine NUL via fromCharCode
  // so the source stays byte-clean; a raw newline is escaped, not stripped).
  const NUL = String.fromCharCode(0);
  const ctrl = assessStreamDegeneracy(('ab' + NUL).repeat(150));
  assert(ctrl.degenerate, 'NUL-bearing loop still detected');
  assert(ctrl.repeatUnit.indexOf(NUL) < 0, 'NUL stripped from repeatUnit');
  assertEq(ctrl.repeatUnit, 'ab', 'repeatUnit is the loop unit with the NUL removed');
  // reason never carries echoed content, only kind + numbers
  assert(!v.reason.includes('ABCDEF'), 'reason carries no echoed content');
}

// ── (G) bounds ──────────────────────────────────────────────────────────────
{
  const v = assessStreamDegeneracy('0123456789abcdefghij'.repeat(20)); // p=20 loop
  assert(v.repeatUnit.length <= REPEAT_UNIT_MAX, 'repeatUnit <= REPEAT_UNIT_MAX');
  assert(v.confidence >= 0 && v.confidence <= 1, 'confidence in [0,1]');
  assert(Number.isFinite(v.repeats) && v.repeats >= 0, 'repeats finite non-negative');
  // confidence is rounded to 2dp
  assertEq(Math.round(v.confidence * 100) / 100, v.confidence, 'confidence rounded to 2dp');
}

// ── (H) determinism ─────────────────────────────────────────────────────────
for (const s of ['a'.repeat(400), 'ab'.repeat(200), 'hello world normal text', 'li\n'.repeat(90)]) {
  assertJson(assessStreamDegeneracy(s), assessStreamDegeneracy(s), `deterministic: ${JSON.stringify(s.slice(0, 12))}`);
}

// ── (I) describeStreamDegeneracy ────────────────────────────────────────────
{
  assertEq(describeStreamDegeneracy(assessStreamDegeneracy('normal text')), '', 'healthy → empty copy');
  const run = describeStreamDegeneracy(assessStreamDegeneracy('a'.repeat(400)));
  assert(run.length > 0 && /repeat/i.test(run), 'char_run → repeat copy');
  const low = describeStreamDegeneracy({ degenerate: true, kind: 'low_diversity', confidence: 0.9, repeats: 0, repeatUnit: '', reason: 'x' });
  assert(/looping|progress/i.test(low), 'low_diversity → looping copy');
  assertEq(describeStreamDegeneracy({ kind: 'none' } as StreamDegeneracyVerdict), '', 'none kind → empty');
  assertEq(describeStreamDegeneracy({} as StreamDegeneracyVerdict), '', 'malformed verdict → empty');
  // prototype-pollution guard: "constructor" as kind must NOT resolve to Object.ctor
  assertEq(describeStreamDegeneracy({ kind: 'constructor' } as unknown as StreamDegeneracyVerdict), '', '"constructor" kind → empty (no proto leak)');
}

// ── (J) options clamping ────────────────────────────────────────────────────
{
  // hostile opts must not throw and must fall back to defaults
  assertEq(assessStreamDegeneracy('a'.repeat(400), { maxPeriod: 'x' as unknown as number }).degenerate, true, 'bad maxPeriod → default, still detects');
  assertEq(assessStreamDegeneracy('a'.repeat(400), { maxPeriod: -5 }).degenerate, true, 'negative maxPeriod clamps, still detects');
  // a stricter minRepeats can suppress a borderline loop
  const strict = assessStreamDegeneracy('ab'.repeat(150), { minRepeats: 4096 });
  assertEq(strict.degenerate, false, 'very high minRepeats suppresses the loop');
}

// ── (K) HOSTILE input — never throws, always neutral ────────────────────────
{
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  const throwing = new Proxy({}, { get() { throw new Error('boom'); } });
  // labels parallel to the hostiles array — never String() a hostile value (the
  // throwing Proxy would trap on stringify and blow up the message, not the core).
  const hostiles: unknown[] = [null, undefined, 42, NaN, Infinity, {}, [], true, Symbol('s'), cyclic, throwing, () => 0];
  const labels = ['null', 'undefined', '42', 'NaN', 'Infinity', '{}', '[]', 'true', 'Symbol', 'cyclic', 'throwing-proxy', 'fn'];
  for (let i = 0; i < hostiles.length; i++) {
    const lbl = labels[i];
    let v: StreamDegeneracyVerdict;
    try { v = assessStreamDegeneracy(hostiles[i] as unknown as string); }
    catch (e) { assert(false, `assess threw on hostile input ${lbl}: ${(e as Error).message}`); continue; }
    assertEq(v.degenerate, false, `hostile ${lbl} → not degenerate`);
    assertEq(v.kind, 'none', `hostile ${lbl} → kind none`);
    assertEq(v.repeatUnit, '', `hostile ${lbl} → empty repeatUnit`);
  }
  // hostile opts
  assert(assessStreamDegeneracy('hi', null as unknown as undefined) !== undefined, 'null opts tolerated');
  assert(assessStreamDegeneracy('hi', 42 as unknown as undefined) !== undefined, 'number opts tolerated');
  // hostile verdicts into describe
  const dhost: unknown[] = [null, undefined, 42, [], 'str', throwing];
  const dlabels = ['null', 'undefined', '42', '[]', 'str', 'throwing-proxy'];
  for (let i = 0; i < dhost.length; i++) {
    let out: string;
    try { out = describeStreamDegeneracy(dhost[i] as unknown as StreamDegeneracyVerdict); }
    catch (e) { assert(false, `describe threw on ${dlabels[i]}: ${(e as Error).message}`); continue; }
    assertEq(out, '', `describe hostile ${dlabels[i]} → empty`);
  }
}

// ── (L) non-BMP (astral) single-char run parity — REGRESSION ────────────────
// A repeated non-BMP char is ONE code point, not a two-code-unit "phrase". It must
// behave exactly like every BMP char: healthy until CHAR_RUN_MIN *code points*,
// then char_run (never phrase_loop). Astral input is built from a CODE POINT via
// String.fromCodePoint — never a raw surrogate/control char in this source.
{
  const EMOJI = String.fromCodePoint(0x1f389); // U+1F389 party popper (surrogate pair)
  // exact failing input: 120 emoji = 240 UTF-16 units = old FALSE p=2 phrase_loop.
  const v120 = assessStreamDegeneracy(EMOJI.repeat(120));
  assertEq(v120.degenerate, false, 'astral run of 120 is NOT degenerate (parity with BMP: 120 < CHAR_RUN_MIN)');
  assertEq(v120.kind, 'none', 'astral run of 120 → kind none (not phrase_loop)');
  assertEq(v120.repeatUnit, '', 'astral run of 120 → empty repeatUnit');
  // 119 emoji (238 units) was already correctly none; one below the boundary too.
  assertEq(assessStreamDegeneracy(EMOJI.repeat(119)).degenerate, false, 'astral run of 119 stays healthy');
  assertEq(assessStreamDegeneracy(EMOJI.repeat(CHAR_RUN_MIN - 1)).degenerate, false, 'astral run one below CHAR_RUN_MIN stays healthy');
  // at CHAR_RUN_MIN code points it fires — as char_run, counted in code points.
  const vRun = assessStreamDegeneracy(EMOJI.repeat(CHAR_RUN_MIN));
  assertEq(vRun.degenerate, true, 'astral run at CHAR_RUN_MIN is degenerate');
  assertEq(vRun.kind, 'char_run', 'astral run fires as char_run (not phrase_loop)');
  assertEq(vRun.repeats, CHAR_RUN_MIN, 'astral char_run repeats counted in code points');
  assertEq(vRun.repeatUnit, EMOJI, 'astral char_run repeatUnit is the single emoji');
  assert(/single-character run/.test(vRun.reason), 'astral char_run reason says single-character run');
  assert(!/phrase/.test(vRun.reason), 'astral char_run reason is NOT a phrase');
  // parity proof: a BMP char at the same counts behaves identically.
  assertEq(assessStreamDegeneracy('a'.repeat(120)).degenerate, false, 'BMP parity: 120 healthy');
  // a genuine TWO distinct alternating emoji IS still a real phrase_loop — the
  // defer is distinct-CODE-POINT==1 only, so legitimate astral loops are preserved.
  const EMOJI2 = String.fromCodePoint(0x1f38a); // U+1F38A confetti ball
  const two = assessStreamDegeneracy((EMOJI + EMOJI2).repeat(150));
  assertEq(two.degenerate, true, 'two distinct alternating emoji is still a real loop');
  assertEq(two.kind, 'phrase_loop', 'two distinct emoji → phrase_loop (not deferred as a char run)');
}

console.log(`stream-degeneracy-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('All stream-degeneracy-core smoke cases passed (' + passed + ' passed).');
