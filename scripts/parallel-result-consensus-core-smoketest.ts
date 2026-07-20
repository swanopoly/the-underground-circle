/**
 * parallel-result-consensus-core-smoketest — the pure majority-vote /
 * self-consistency reconciler (src/lib/parallelResultConsensusCore.ts). A caller
 * with N candidate answers to the SAME task (best-of-N race, provider fan-out,
 * subagent panel) runs reconcileParallelResults to cluster the answers, elect a
 * winner by plurality, and decide accept / judge / escalate BEFORE paying for an
 * LLM judge. Load-bearing behavior:
 *
 *   VERDICT LADDER — none (0 valid) / unanimous (1 cluster) / split (all
 *   singletons) / tie (top-two equal weight) / consensus (majority) / plurality.
 *   CONFIDENCE — rises with BOTH agreement and sample size (lone candidate 0.5,
 *   3 identical 0.75). WEIGHT — a high-weight minority can outvote a larger
 *   cluster; NaN/Inf/<=0 weight → 1; > cap → clamped. MEDOID — a weight tie elects
 *   the most central phrasing, deterministically. DETERMINISM — identical input
 *   twice → identical result.
 *
 *   TOTAL: null / undefined / wrong-type / NaN / Infinity / bigint / symbol /
 *   control-char / huge / cyclic / throwing-getter / Proxy input never throws, and
 *   NO candidate TEXT ever appears in any output field.
 *
 * Pure — loads under tsx (parallelResultConsensusCore has zero imports).
 * Run: npx tsx scripts/parallel-result-consensus-core-smoketest.ts
 */

import {
  reconcileParallelResults,
  resolveConsensusAction,
  normalizeConsensusText,
  MAX_CONSENSUS_CANDIDATES,
  MAX_CONSENSUS_TOKENS,
  CONSENSUS_TEXT_SCAN_MAX,
  DEFAULT_CONSENSUS_SIMILARITY,
  DEFAULT_MAJORITY_FRACTION,
  CONSENSUS_WEIGHT_CAP,
  CONSENSUS_CONFIDENCE_SMOOTHING,
  type ConsensusResult,
  type ConsensusVerdict,
  type ConsensusAction,
} from '../src/lib/parallelResultConsensusCore';

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
  assert(a === b, msg, `got ${safeJson(a)} want ${safeJson(b)}`);
}
function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '[unstringifiable]';
  }
}

const REASON_MAX = 200; // mirrors CONSENSUS_REASON_MAX (internal)

const VERDICTS: ReadonlySet<string> = new Set([
  'unanimous',
  'consensus',
  'plurality',
  'tie',
  'split',
  'none',
]);
const ACTIONS: ReadonlySet<string> = new Set(['accept', 'judge', 'escalate']);

/** A reason must carry no control / DEL / C1 / line-separator char. */
function noControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) {
      return false;
    }
  }
  return true;
}

function isIntGe(n: unknown, min: number): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= min;
}

/** A result is well-formed: valid verdict/action; winnerIndex null iff 'none' and
 *  otherwise === clusters[0].representativeIndex; clusters carry only integer
 *  indices + finite non-negative weight; ratio/confidence finite in [0,1]; reason
 *  bounded, non-empty, control-free. */
function wellFormed(r: ConsensusResult): boolean {
  if (!r || typeof r !== 'object') return false;
  if (!VERDICTS.has(r.verdict)) return false;
  if (!(r.winnerIndex === null || isIntGe(r.winnerIndex, 0))) return false;
  if (!Array.isArray(r.clusters)) return false;
  for (const c of r.clusters) {
    if (!c || typeof c !== 'object') return false;
    if (!Array.isArray(c.members)) return false;
    for (const m of c.members) if (!isIntGe(m, 0)) return false;
    if (!isIntGe(c.representativeIndex, 0)) return false;
    if (!isIntGe(c.size, 1)) return false;
    if (typeof c.weight !== 'number' || !Number.isFinite(c.weight) || c.weight < 0) return false;
    if (c.members.length !== c.size) return false;
  }
  if (!isIntGe(r.votedCount, 0)) return false;
  if (
    typeof r.agreementRatio !== 'number' ||
    !Number.isFinite(r.agreementRatio) ||
    r.agreementRatio < 0 ||
    r.agreementRatio > 1
  ) {
    return false;
  }
  if (
    typeof r.confidence !== 'number' ||
    !Number.isFinite(r.confidence) ||
    r.confidence < 0 ||
    r.confidence > 1
  ) {
    return false;
  }
  if (!ACTIONS.has(r.recommendedAction)) return false;
  if (typeof r.reason !== 'string' || r.reason.length === 0 || r.reason.length > REASON_MAX) {
    return false;
  }
  if (!noControlChars(r.reason)) return false;
  if ((r.verdict === 'none') !== (r.winnerIndex === null)) return false;
  if (r.verdict !== 'none' && r.clusters.length > 0 && r.winnerIndex !== r.clusters[0].representativeIndex) {
    return false;
  }
  return true;
}

const NONE_FALLBACK: ConsensusResult = {
  verdict: 'none',
  winnerIndex: null,
  clusters: [],
  votedCount: 0,
  agreementRatio: 0,
  confidence: 0,
  recommendedAction: 'escalate',
  reason: 'threw',
};

/** Runs reconcile on hostile input; records a failure (not a crash) on throw.
 *  NEVER String()s the hostile input — only the fixed label + err. */
function noThrow(label: string, input: unknown, opts?: unknown): ConsensusResult {
  try {
    const r = reconcileParallelResults(input as never, opts as never);
    assert(wellFormed(r), `${label} -> well-formed result`, safeJson(r));
    return r;
  } catch (err) {
    assert(false, `${label} -> must not throw`, String(err));
    return NONE_FALLBACK;
  }
}

function main(): void {
  // ─── (1) exported caps / defaults ─────────────────────────────────────────
  assertEq(MAX_CONSENSUS_CANDIDATES, 64, '(1) max candidates = 64');
  assertEq(MAX_CONSENSUS_TOKENS, 80, '(1) max tokens = 80');
  assertEq(CONSENSUS_TEXT_SCAN_MAX, 8000, '(1) text scan max = 8000');
  assertEq(DEFAULT_CONSENSUS_SIMILARITY, 0.8, '(1) default similarity = 0.8');
  assertEq(DEFAULT_MAJORITY_FRACTION, 0.5, '(1) default majority fraction = 0.5');
  assertEq(CONSENSUS_WEIGHT_CAP, 1e6, '(1) weight cap = 1e6');
  assertEq(CONSENSUS_CONFIDENCE_SMOOTHING, 1, '(1) confidence smoothing = 1');

  // ─── (2) UNANIMOUS — 3 identical answers ──────────────────────────────────
  const uni = reconcileParallelResults(['the answer is 42', 'the answer is 42', 'the answer is 42']);
  assert(wellFormed(uni), '(2) unanimous well-formed', safeJson(uni));
  assertEq(uni.verdict, 'unanimous', '(2) 3 identical -> unanimous');
  assertEq(uni.recommendedAction, 'accept', '(2) unanimous -> accept');
  assertEq(uni.winnerIndex, 0, '(2) winner is the earliest of the identical cluster');
  assertEq(uni.votedCount, 3, '(2) votedCount 3');
  assertEq(uni.clusters.length, 1, '(2) exactly one cluster');
  assertEq(uni.agreementRatio, 1, '(2) agreementRatio 1');
  assertEq(uni.confidence, 0.75, '(2) confidence 0.75 (agreement 1, n 3)');
  assert(uni.reason.includes('3/3'), '(2) reason carries the count', uni.reason);
  assert(uni.reason.includes('unanimous'), '(2) reason names the verdict', uni.reason);

  // ─── (3) CONSENSUS — 2 near-identical (Jaccard 1 via reorder) + 1 divergent ─
  const con = reconcileParallelResults([
    'the sky is blue today',
    'today the sky is blue', // same token set → clusters with the first
    'grass is green',
  ]);
  assert(wellFormed(con), '(3) consensus well-formed', safeJson(con));
  assertEq(con.verdict, 'consensus', '(3) 2-vs-1 majority -> consensus');
  assertEq(con.recommendedAction, 'accept', '(3) consensus -> accept');
  assertEq(con.clusters.length, 2, '(3) two clusters');
  assertEq(con.votedCount, 3, '(3) votedCount 3');
  assertEq(con.winnerIndex, 0, '(3) winner from the agreeing pair (earliest)');
  assertEq(con.agreementRatio, 0.67, '(3) agreementRatio round2(2/3) = 0.67');
  assertEq(con.confidence, 0.5, '(3) confidence round2(0.67 * 3/4) = 0.5');
  assert(con.reason.includes('2/3'), '(3) reason carries 2/3', con.reason);

  // ─── (4) PLURALITY — 4 answers as 2+1+1 ───────────────────────────────────
  const plu = reconcileParallelResults(['yes', 'yes', 'no', 'maybe']);
  assert(wellFormed(plu), '(4) plurality well-formed', safeJson(plu));
  assertEq(plu.verdict, 'plurality', '(4) 2+1+1, leader not a majority -> plurality');
  assertEq(plu.recommendedAction, 'judge', '(4) plurality -> judge');
  assertEq(plu.clusters.length, 3, '(4) three clusters');
  assertEq(plu.votedCount, 4, '(4) votedCount 4');
  assertEq(plu.winnerIndex, 0, '(4) leader is the yes cluster');
  assertEq(plu.agreementRatio, 0.5, '(4) agreementRatio 2/4 = 0.5 (not > majority)');

  // ─── (5) TIE — 2v2 clusters ───────────────────────────────────────────────
  const tie = reconcileParallelResults(['yes', 'no', 'yes', 'no']);
  assert(wellFormed(tie), '(5) tie well-formed', safeJson(tie));
  assertEq(tie.verdict, 'tie', '(5) top-two equal weight -> tie');
  assertEq(tie.recommendedAction, 'judge', '(5) tie -> judge');
  assertEq(tie.clusters.length, 2, '(5) two clusters');
  assertEq(tie.confidence, 0.4, '(5) tie confidence round2(0.5 * 4/5) = 0.4');
  assertEq(tie.winnerIndex, 0, '(5) tie winner is the earliest leading cluster');

  // ─── (6) SPLIT — 3 all-distinct answers ───────────────────────────────────
  const split = reconcileParallelResults(['apple', 'banana', 'cherry']);
  assert(wellFormed(split), '(6) split well-formed', safeJson(split));
  assertEq(split.verdict, 'split', '(6) all singletons -> split');
  assertEq(split.recommendedAction, 'escalate', '(6) split -> escalate');
  assertEq(split.clusters.length, 3, '(6) three singleton clusters');
  assertEq(split.votedCount, 3, '(6) votedCount 3');
  assertEq(split.winnerIndex, 0, '(6) split still points at the leading candidate');
  assertEq(split.agreementRatio, 0.33, '(6) agreementRatio round2(1/3) = 0.33');
  assert(split.reason.includes('split'), '(6) reason names split', split.reason);

  // ─── (7) SINGLE valid, others ok:false ────────────────────────────────────
  const single = reconcileParallelResults([
    { text: 'discard me', ok: false },
    { text: 'real answer', id: 'model-b' },
    { text: 'me too', ok: false },
  ]);
  assert(wellFormed(single), '(7) single-valid well-formed', safeJson(single));
  assertEq(single.verdict, 'unanimous', '(7) one survivor -> unanimous');
  assertEq(single.recommendedAction, 'accept', '(7) single -> accept');
  assertEq(single.votedCount, 1, '(7) only 1 valid vote');
  assertEq(single.winnerIndex, 1, '(7) winner is the ORIGINAL index of the survivor');
  assertEq(single.confidence, 0.5, '(7) lone candidate -> confidence 0.5 (no corroboration)');
  assert(single.reason.includes('model-b'), '(7) reason carries the cleaned winner id', single.reason);
  assert(!single.reason.includes('real answer'), '(7) reason NEVER carries candidate text', single.reason);

  // ─── (8) NONE — empty / all-failed / non-array ────────────────────────────
  const noneCases: Array<[string, unknown]> = [
    ['empty array', []],
    ['all ok:false', [{ text: 'a', ok: false }, { text: 'b', ok: false }]],
    ['all blank text', [{ text: '' }, '   ', { text: '!!!' }]],
    ['non-array string', 'not an array'],
    ['null', null],
    ['undefined', undefined],
    ['plain object', {}],
  ];
  for (const [label, input] of noneCases) {
    const r = reconcileParallelResults(input as never);
    assert(wellFormed(r), `(8) ${label} well-formed`, safeJson(r));
    assertEq(r.verdict, 'none', `(8) ${label} -> none`);
    assertEq(r.winnerIndex, null, `(8) ${label} -> winnerIndex null`);
    assertEq(r.recommendedAction, 'escalate', `(8) ${label} -> escalate`);
    assertEq(r.votedCount, 0, `(8) ${label} -> votedCount 0`);
    assertEq(r.clusters.length, 0, `(8) ${label} -> no clusters`);
    assertEq(r.agreementRatio, 0, `(8) ${label} -> agreementRatio 0`);
    assertEq(r.confidence, 0, `(8) ${label} -> confidence 0`);
  }

  // ─── (9) MEDOID tie-break + determinism ───────────────────────────────────
  // {red, red blue, red blue}: all one cluster (containment). "red blue" agrees
  // with two members, "red" only via containment → medoid elects index 1.
  const med = reconcileParallelResults(['red', 'red blue', 'red blue']);
  assert(wellFormed(med), '(9) medoid well-formed', safeJson(med));
  assertEq(med.verdict, 'unanimous', '(9) all in one cluster -> unanimous');
  assertEq(med.clusters.length, 1, '(9) single cluster of 3');
  assertEq(med.winnerIndex, 1, '(9) medoid picks the most central phrasing (index 1)');
  // determinism across several shapes.
  const detInputs: unknown[] = [
    ['the answer is 42', 'the answer is 42', 'the answer is 42'],
    ['the sky is blue today', 'today the sky is blue', 'grass is green'],
    ['yes', 'no', 'yes', 'no'],
    ['apple', 'banana', 'cherry'],
    ['red', 'red blue', 'red blue'],
    [{ text: 'x', weight: 5 }, { text: 'y' }, { text: 'y' }],
  ];
  for (const inp of detInputs) {
    const a = reconcileParallelResults(inp as never);
    const b = reconcileParallelResults(inp as never);
    assertEq(safeJson(a), safeJson(b), `(9) deterministic: ${safeJson(inp).slice(0, 42)}`);
  }

  // ─── (10) WEIGHT — trust folds into the vote ──────────────────────────────
  // A high-weight minority (1 candidate, weight 5) outvotes a 2-candidate cluster.
  const w1 = reconcileParallelResults([
    { text: 'minority but trusted', weight: 5 },
    { text: 'popular answer' },
    { text: 'popular answer' },
  ]);
  assert(wellFormed(w1), '(10) weighted well-formed', safeJson(w1));
  assertEq(w1.winnerIndex, 0, '(10) high-weight minority wins the vote');
  assertEq(w1.verdict, 'consensus', '(10) weight 5 of 7 total -> consensus');
  assertEq(w1.clusters[0].weight, 5, '(10) leading cluster weight = 5');
  assertEq(w1.agreementRatio, 0.71, '(10) agreementRatio round2(5/7) = 0.71');
  // NaN / Infinity / <=0 weight all fall back to 1.
  const w2 = reconcileParallelResults([
    { text: 'a', weight: Number.NaN },
    { text: 'a', weight: Infinity },
    { text: 'a', weight: -3 },
    { text: 'a', weight: 0 },
  ]);
  assertEq(w2.verdict, 'unanimous', '(10) four identical -> unanimous');
  assertEq(w2.clusters[0].weight, 4, '(10) NaN/Inf/<=0 weights each default to 1 (sum 4)');
  // weight over the cap is clamped.
  const w3 = reconcileParallelResults([
    { text: 'huge weight', weight: 1e12 },
    { text: 'small', weight: 1 },
    { text: 'small', weight: 1 },
  ]);
  assertEq(w3.clusters[0].weight, CONSENSUS_WEIGHT_CAP, '(10) weight 1e12 -> clamped to cap 1e6');
  assertEq(w3.winnerIndex, 0, '(10) clamped-but-huge weight still wins');

  // majorityFraction option: raising it can demote a consensus to a plurality.
  const strictMajority = reconcileParallelResults(['a', 'a', 'b'], { majorityFraction: 0.9 });
  assertEq(strictMajority.verdict, 'plurality', '(10) 2/3 < 0.9 majorityFraction -> plurality');
  const defaultMajority = reconcileParallelResults(['a', 'a', 'b']);
  assertEq(defaultMajority.verdict, 'consensus', '(10) 2/3 > 0.5 default -> consensus');

  // ─── (11) normalizeConsensusText + resolveConsensusAction (direct) ────────
  assertEq(normalizeConsensusText('Hello, World!'), 'hello world', '(11) normalize lowercases + splits');
  assertEq(normalizeConsensusText('  Multiple   Spaces  '), 'multiple spaces', '(11) collapse + trim');
  assertEq(normalizeConsensusText(42), '42', '(11) number coerced');
  assertEq(normalizeConsensusText(123n), '123', '(11) bigint coerced');
  assertEq(normalizeConsensusText(true), 'true', '(11) boolean coerced');
  assertEq(normalizeConsensusText({}), '', '(11) object -> empty');
  assertEq(normalizeConsensusText(null), '', '(11) null -> empty');
  assertEq(normalizeConsensusText(undefined), '', '(11) undefined -> empty');
  assertEq(normalizeConsensusText('__proto__'), 'proto', '(11) prototype-key text normalizes to plain token');
  // astral char (emoji) is one code point, stripped as non-alnum, not split.
  const emoji = String.fromCodePoint(0x1f600);
  assertEq(normalizeConsensusText(emoji + 'Hi'), 'hi', '(11) astral char stripped, ascii kept');
  assertEq(normalizeConsensusText(emoji + emoji + emoji), '', '(11) all-emoji -> empty (no lone surrogate)');
  // scan cap: a huge text normalizes to a bounded, deterministic string.
  const longText = 'word '.repeat(3000);
  const longNorm = normalizeConsensusText(longText);
  assert(longNorm.length <= CONSENSUS_TEXT_SCAN_MAX, '(11) normalized length bounded by scan max', String(longNorm.length));
  assertEq(normalizeConsensusText(longText), longNorm, '(11) normalize is deterministic on huge input');

  assertEq(resolveConsensusAction('unanimous'), 'accept', '(11) unanimous -> accept');
  assertEq(resolveConsensusAction('consensus'), 'accept', '(11) consensus -> accept');
  assertEq(resolveConsensusAction('plurality'), 'judge', '(11) plurality -> judge');
  assertEq(resolveConsensusAction('tie'), 'judge', '(11) tie -> judge');
  assertEq(resolveConsensusAction('split'), 'escalate', '(11) split -> escalate');
  assertEq(resolveConsensusAction('none'), 'escalate', '(11) none -> escalate');
  assertEq(resolveConsensusAction('garbage' as ConsensusVerdict), 'escalate', '(11) unknown verdict -> escalate (total)');

  // ─── (12) SECRET-SAFETY — no candidate text leaks; ids cleaned ────────────
  const SECRET = 'SUPERSECRETVALUE_abc123XYZ';
  const leak = reconcileParallelResults([
    { text: SECRET, id: 'model-a' },
    { text: SECRET, id: 'model-a' },
  ]);
  assert(wellFormed(leak), '(12) secret-safety result well-formed', safeJson(leak));
  assertEq(leak.verdict, 'unanimous', '(12) identical secret texts -> unanimous');
  assertEq(typeof leak.winnerIndex, 'number', '(12) winner is an INDEX, not text');
  assert(!safeJson(leak).includes('SUPERSECRET'), '(12) NO candidate text anywhere in the result', leak.reason);
  assert(leak.reason.includes('model-a'), '(12) cleaned winner id may appear', leak.reason);
  // id with control / line-sep / prompt-fence chars is stripped.
  const NUL = String.fromCharCode(0);
  const LSEP = String.fromCharCode(0x2028);
  const dirtyId = 'mod' + NUL + 'el' + LSEP + '`x`';
  const clean = reconcileParallelResults([{ text: 'answer', id: dirtyId }]);
  assert(wellFormed(clean), '(12) dirty-id result well-formed', safeJson(clean));
  assert(noControlChars(clean.reason), '(12) reason has no control chars after id clean', safeJson(clean.reason));
  assert(!clean.reason.includes('`'), '(12) reason strips prompt-fence backticks', clean.reason);
  assert(clean.reason.includes('modelx'), '(12) cleaned id fragments survive', clean.reason);

  // ─── (13) HOSTILE — never throws, always well-formed ──────────────────────
  const cyclic: Record<string, unknown> = { text: 'a' };
  cyclic.self = cyclic;

  const throwingCandidate: Record<string, unknown> = {};
  for (const k of ['id', 'text', 'ok', 'weight']) {
    Object.defineProperty(throwingCandidate, k, {
      get() {
        throw new Error(`boom:${k}`);
      },
      enumerable: true,
    });
  }

  const throwingProxy = new Proxy(
    {},
    {
      get() {
        throw new Error('boom-get');
      },
      has() {
        throw new Error('boom-has');
      },
      ownKeys() {
        throw new Error('boom-keys');
      },
      getOwnPropertyDescriptor() {
        throw new Error('boom-desc');
      },
    },
  );
  const throwingArrayProxy = new Proxy([{ text: 'a' }], {
    get(target, key) {
      if (key === 'length') throw new Error('boom-length');
      return (target as unknown as Record<string | symbol, unknown>)[key];
    },
  });

  const hugeStr = 'a'.repeat(10 * 1024 * 1024); // 10 MB
  const emojiStorm = String.fromCodePoint(0x1f600).repeat(5000); // 10k UTF-16 units
  const bigArray = new Array(200000).fill({ text: 'same' });

  // Whole-input hostiles: each must yield a valid 'none' (non-array or all-junk).
  const wholeHostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['NaN', Number.NaN],
    ['Infinity', Infinity],
    ['bigint', 10n],
    ['symbol', Symbol('s')],
    ['boolean', true],
    ['plain-object', {}],
    ['cyclic-non-array', (() => { const o: Record<string, unknown> = {}; o.self = o; return o; })()],
    ['throwing-proxy', throwingProxy],
    ['throwing-array-proxy', throwingArrayProxy],
  ];
  for (const [label, input] of wholeHostiles) {
    const r = noThrow(`(13) whole:${label}`, input);
    assertEq(r.verdict, 'none', `(13) whole:${label} -> none`);
    assertEq(r.winnerIndex, null, `(13) whole:${label} -> winnerIndex null`);
  }

  // Candidate-element hostiles inside a real array.
  const junkElements = [
    null,
    undefined,
    42,
    {},
    [],
    Number.NaN,
    true,
    Symbol('s'),
    10n,
    { text: {} },
    { text: null },
    throwingCandidate,
    throwingProxy,
  ];
  const junk = noThrow('(13) array-of-junk-elements', junkElements);
  assertEq(junk.verdict, 'none', '(13) all junk elements skipped -> none');
  assertEq(junk.votedCount, 0, '(13) no junk element counts as a vote');

  // Mixed: junk elements alongside one valid answer -> that one wins.
  const mixed = noThrow('(13) junk-plus-one-valid', [null, { text: 'the good one', id: 'g' }, {}, 42]);
  assertEq(mixed.verdict, 'unanimous', '(13) one valid among junk -> unanimous');
  assertEq(mixed.votedCount, 1, '(13) exactly one valid vote among junk');

  // Cyclic / throwing-getter candidates never throw.
  const cyc = noThrow('(13) cyclic-candidate', [cyclic, cyclic]);
  assert(cyc.verdict === 'unanimous' || cyc.verdict === 'none', '(13) cyclic candidate handled', cyc.verdict);
  noThrow('(13) throwing-getter-candidate', [throwingCandidate, { text: 'ok' }]);

  // Huge text is scan-bounded; huge array is candidate-bounded.
  const bigText = noThrow('(13) 10MB-text', [{ text: hugeStr, id: 'big' }]);
  assertEq(bigText.verdict, 'unanimous', '(13) one 10MB candidate -> unanimous (bounded)');
  assertEq(bigText.votedCount, 1, '(13) 10MB candidate is one vote');
  const storm = noThrow('(13) emoji-storm-text', [{ text: emojiStorm }]);
  assertEq(storm.verdict, 'none', '(13) all-emoji text normalizes to blank -> none');
  const big = noThrow('(13) 200k-array', bigArray);
  assertEq(big.votedCount, MAX_CONSENSUS_CANDIDATES, '(13) 200k candidates capped at MAX_CONSENSUS_CANDIDATES');
  assertEq(big.verdict, 'unanimous', '(13) 64 identical (capped) -> unanimous');

  // Prototype-key texts used as clustering keys never pollute / crash.
  const proto = noThrow('(13) prototype-key-texts', [
    { text: 'constructor' },
    { text: 'constructor' },
    { text: 'hasOwnProperty' },
    { text: '__proto__' },
  ]);
  assertEq(proto.votedCount, 4, '(13) prototype-shaped texts still counted');
  assertEq(proto.verdict, 'plurality', '(13) 2x constructor + hasOwnProperty + __proto__ -> plurality (2/4)');
  assert(!({}.hasOwnProperty === undefined), '(13) Object.prototype intact (no pollution)');

  // Hostile determinism: same hostile input twice -> identical result.
  const h1 = reconcileParallelResults(junkElements as never);
  const h2 = reconcileParallelResults(junkElements as never);
  assertEq(safeJson(h1), safeJson(h2), '(13) hostile determinism');

  // Every hostile reason stays bounded, non-empty, control-free.
  for (const r of [junk, mixed, bigText, storm, big, proto, cyc]) {
    assert(
      r.reason.length > 0 && r.reason.length <= REASON_MAX && noControlChars(r.reason),
      '(13) sweep: reason bounded/clean',
      safeJson(r.reason),
    );
  }

  // Bad opts never break the pass.
  const badOpts1 = noThrow('(13) opts-null', ['a', 'a'], null);
  assertEq(badOpts1.verdict, 'unanimous', '(13) null opts -> defaults applied');
  const badOpts2 = noThrow('(13) opts-throwing', ['a', 'a'], throwingProxy);
  assertEq(badOpts2.verdict, 'unanimous', '(13) throwing opts -> defaults applied');
  const badOpts3 = noThrow('(13) opts-oob', ['a', 'a', 'b'], {
    similarityThreshold: 99,
    majorityFraction: -5,
  });
  assert(wellFormed(badOpts3), '(13) out-of-range opts -> still well-formed', safeJson(badOpts3));
}

main();

if (failures > 0) {
  console.error(`\nparallelResultConsensusCore smoke: ${failures} FAILED, ${passes} passed`);
  process.exit(1);
}
console.log(`\nAll ${passes} assertions passed — parallelResultConsensusCore is sound.`);
