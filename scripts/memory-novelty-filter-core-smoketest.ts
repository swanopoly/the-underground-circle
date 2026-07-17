/**
 * memory-novelty-filter-core-smoketest — the PURE anchor-relative novelty filter
 * (src/lib/memoryNoveltyFilterCore.ts) that drops a discrete candidate memory
 * item whose fact is ALREADY stated in an always-present free-text anchor doc, so
 * scarce retrieval budget is spent on NEW information. Load-bearing assertions:
 *
 *   normalizeNoveltyText(v): lowercase + collapse unicode non-alnum runs to one
 *     space + trim + scan cap; non-string → ''.
 *   buildAnchorIndex(anchors): explode blob(s) into normalized lines (bounded).
 *   isCoveredByAnchors(text, index, opts): {covered, reason} — exact / containment
 *     / jaccard, cheapest first; malformed index → not covered.
 *   filterNovelAgainstAnchors(candidates, anchors, opts): NoveltyVerdict — keep ∪
 *     drop partitions every valid candidate; drops carry only id/source/reason/
 *     matched (NEVER any candidate or anchor text); chaining dedups survivors
 *     against earlier-kept candidates; maxKeep caps kept items.
 *
 *   And: every export is TOTAL — null/undefined/number/{}/[]/NaN/huge string/
 *   control chars/cyclic/throwing-getter/proxy input ⇒ a valid bounded verdict,
 *   never a throw, never a leaked text field.
 *
 * Pure — loads under tsx (the core imports nothing at runtime).
 *   npx tsx scripts/memory-novelty-filter-core-smoketest.ts
 */

import {
  normalizeNoveltyText,
  buildAnchorIndex,
  isCoveredByAnchors,
  filterNovelAgainstAnchors,
  MAX_CANDIDATES,
  MAX_ANCHOR_CHARS,
  MAX_ANCHOR_LINES,
  MAX_TOKENS_PER_UNIT,
  MAX_TEXT_SCAN,
  SIG_CHARS,
  MIN_CONTAINMENT_CHARS,
  MAX_KEEP,
  MAX_ID_LEN,
  MAX_SOURCE_LEN,
  COMPARE_WINDOW,
  DEFAULT_REDUNDANCY_THRESHOLD,
  DEFAULT_MIN_TOKENS,
  type AnchorInput,
  type NoveltyFilterOptions,
  type NoveltyVerdict,
  type NoveltyDrop,
} from '../src/lib/memoryNoveltyFilterCore';

// The core caps a returned kept item's text defensively; mirror that ceiling
// locally for the huge-text assertion (not part of the public cap surface).
const MAX_TEXT_OUT_LIMIT = 100000;

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── call wrappers (keep hostile fixtures cast-free at the call sites) ─────────
function f(candidates?: unknown, anchors?: unknown, opts?: unknown): NoveltyVerdict {
  return filterNovelAgainstAnchors(
    candidates,
    anchors,
    opts as NoveltyFilterOptions | undefined,
  );
}
function cov(text?: unknown, index?: unknown, opts?: unknown) {
  return isCoveredByAnchors(
    text,
    index as never,
    opts as NoveltyFilterOptions | undefined,
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
function hasUnsafeChars(s: string): boolean {
  if (/[\x00-\x1f\x7f`<>]/.test(s)) return true;
  return s.indexOf(LINE_SEP[0]) >= 0 || s.indexOf(LINE_SEP[1]) >= 0;
}
function keptIds(v: NoveltyVerdict): string[] {
  return v.keep.map((k) => k.id);
}
function dropFor(v: NoveltyVerdict, id: string): NoveltyDrop | undefined {
  return v.drop.find((d) => d.id === id);
}
const DROP_KEYS = ['id', 'matched', 'reason', 'source']; // sorted
function dropShapeOk(d: NoveltyDrop): boolean {
  const keys = Object.keys(d).sort();
  if (keys.length !== 4) return false;
  for (let i = 0; i < 4; i += 1) if (keys[i] !== DROP_KEYS[i]) return false;
  if (!['exact', 'containment', 'jaccard', 'capacity'].includes(d.reason)) return false;
  if (!['anchor', 'candidate'].includes(d.matched)) return false;
  return true;
}
/** A valid verdict: arrays, counts match, drops well-shaped, keep carries text. */
function verdictOk(v: unknown): v is NoveltyVerdict {
  if (!v || typeof v !== 'object') return false;
  const vv = v as NoveltyVerdict;
  if (!Array.isArray(vv.keep) || !Array.isArray(vv.drop)) return false;
  if (vv.keptCount !== vv.keep.length || vv.droppedCount !== vv.drop.length) return false;
  for (const k of vv.keep) {
    if (!k || typeof k !== 'object') return false;
    if (typeof k.id !== 'string' || typeof k.text !== 'string') return false;
    if (k.id.length > MAX_ID_LEN) return false;
    if (k.source !== undefined && (typeof k.source !== 'string' || k.source.length > MAX_SOURCE_LEN)) return false;
  }
  for (const d of vv.drop) {
    if (!d || typeof d !== 'object') return false;
    if (typeof d.id !== 'string' || typeof d.source !== 'string') return false;
    if (d.id.length > MAX_ID_LEN || d.source.length > MAX_SOURCE_LEN) return false;
    if (!dropShapeOk(d)) return false;
    // secret-safe: a drop must NOT carry any text field
    if ('text' in (d as Record<string, unknown>)) return false;
  }
  return true;
}
function totalOn(candidates: unknown, anchors: unknown, opts?: unknown): boolean {
  try {
    return verdictOk(f(candidates, anchors, opts));
  } catch {
    return false;
  }
}

function main(): void {
  // ─── [normalize] ────────────────────────────────────────────────────────────
  {
    assertEq(normalizeNoveltyText('Deploys  on\nFridays!'), 'deploys on fridays', '[normalize] collapse + lowercase + trim');
    assertEq(normalizeNoveltyText('  Uses   Postgres-16  '), 'uses postgres 16', '[normalize] hyphen + spaces');
    assertEq(normalizeNoveltyText('café RÉSUMÉ 2026'), 'café résumé 2026', '[normalize] unicode letters kept, lowercased');
    assertEq(normalizeNoveltyText('!!!___###'), '', '[normalize] punctuation-only → empty');
    assertEq(normalizeNoveltyText(''), '', '[normalize] empty → empty');
    assertEq(normalizeNoveltyText(42 as never), '', '[normalize] non-string number → empty');
    assertEq(normalizeNoveltyText(null as never), '', '[normalize] null → empty');
    assertEq(normalizeNoveltyText(undefined as never), '', '[normalize] undefined → empty');
    assertEq(normalizeNoveltyText({} as never), '', '[normalize] object → empty');
    assertEq(normalizeNoveltyText([] as never), '', '[normalize] array → empty');
    // scan cap: a huge string does not throw and stays bounded
    const huge = 'a '.repeat(5000); // 10k chars
    const nhuge = normalizeNoveltyText(huge);
    assert(nhuge.length <= MAX_TEXT_SCAN, '[normalize] scan-capped output bounded', String(nhuge.length));
    // determinism
    assertEq(normalizeNoveltyText('Ships On Fridays'), normalizeNoveltyText('ships on fridays'), '[normalize] deterministic + case-insensitive');
  }

  // ─── [exact-line drop] ───────────────────────────────────────────────────────
  {
    const anchors = 'Ships on Fridays\nUses Postgres 16';
    const r = f(
      [
        { id: 'a', text: 'ships on fridays' },
        { id: 'b', text: 'prefers dark mode' },
      ],
      anchors,
    );
    assert(verdictOk(r), '[exact] verdict valid');
    const da = dropFor(r, 'a');
    assert(!!da, '[exact] candidate a dropped');
    assertEq(da?.reason, 'exact', '[exact] reason exact');
    assertEq(da?.matched, 'anchor', '[exact] matched anchor');
    assertJson(keptIds(r), ['b'], '[exact] only the novel candidate b is kept');
    assertEq(r.keptCount, 1, '[exact] keptCount 1');
    assertEq(r.droppedCount, 1, '[exact] droppedCount 1');
    // the kept candidate carries its own text faithfully
    assertEq(r.keep[0].text, 'prefers dark mode', '[exact] kept text preserved');
  }

  // ─── [containment] ───────────────────────────────────────────────────────────
  {
    const anchors = 'Notes: the team deploys to production every friday afternoon without fail.';
    const r = f([{ id: 'c1', text: 'team deploys to production every friday afternoon' }], anchors);
    const d = dropFor(r, 'c1');
    assert(!!d, '[containment] long sub-span dropped');
    assertEq(d?.reason, 'containment', '[containment] reason containment');
    assertEq(d?.matched, 'anchor', '[containment] matched anchor');
    // isCoveredByAnchors agrees
    const idx = buildAnchorIndex(anchors);
    assertEq(cov('team deploys to production every friday afternoon', idx).reason, 'containment', '[containment] isCoveredByAnchors agrees');
  }
  {
    // short candidate contained inside a longer anchor word/phrase is NOT dropped
    const r = f([{ id: 'g', text: 'go' }], 'good morning everyone');
    assertJson(keptIds(r), ['g'], '[containment] short candidate kept (length gate holds)');
    assertEq(cov('go', buildAnchorIndex('good morning everyone')).covered, false, '[containment] "go" not covered by "good morning"');
    // a >=16-char phrase that is NOT a token-boundary substring stays novel
    const r2 = f([{ id: 'h', text: 'entirely unrelated topic here' }], 'good morning everyone team');
    assertJson(keptIds(r2), ['h'], '[containment] non-substring phrase kept');
  }
  {
    // containment can be disabled
    const anchors = 'the team deploys to production every friday afternoon reliably';
    const on = f([{ id: 'x', text: 'team deploys to production every friday afternoon' }], anchors);
    assertEq(dropFor(on, 'x')?.reason, 'containment', '[containment] on by default');
    const off = f([{ id: 'x', text: 'team deploys to production every friday afternoon' }], anchors, { containment: false, redundancyThreshold: 1 });
    // with containment off AND threshold 1, the sub-span survives (jaccard < 1)
    assertJson(keptIds(off), ['x'], '[containment] disabling containment keeps the sub-span');
  }

  // ─── [jaccard blob-vs-item] ──────────────────────────────────────────────────
  {
    // loose paraphrase (jaccard ~0.64) — dropped only at a lowered threshold.
    const anchor = 'chris prefers minimal code not heavy frameworks when shipping';
    const cand = { id: 'p', text: 'prefers minimal code over heavy frameworks when shipping features' };
    const lowered = f([cand], anchor, { redundancyThreshold: 0.6 });
    assertEq(dropFor(lowered, 'p')?.reason, 'jaccard', '[jaccard] paraphrase dropped at threshold 0.6');
    assertEq(dropFor(lowered, 'p')?.matched, 'anchor', '[jaccard] matched anchor');
    // at the STRICT default (0.82) the same loose paraphrase survives
    const strict = f([cand], anchor);
    assertJson(keptIds(strict), ['p'], '[jaccard] loose paraphrase kept at default strict threshold');
  }
  {
    // near-identical (reorder + 1 extra token) IS caught at the default threshold.
    const anchor = 'chris prefers minimal code not heavy frameworks when shipping stuff daily';
    // reorder of all 11 anchor tokens + 1 new token → 11 shared of 12 union ≈ 0.916
    const cand = { id: 'q', text: 'daily shipping stuff prefers minimal not heavy frameworks code when chris often' };
    const r = f([cand], anchor);
    assertEq(dropFor(r, 'q')?.reason, 'jaccard', '[jaccard] near-identical reorder dropped at default');
  }
  {
    // same-subject-DIFFERENT-value pair is NOT falsely collapsed (both kept).
    const a = { id: 'ts', text: 'likes typescript for the frontend work' };
    const b = { id: 'pg', text: 'likes postgres for the backend work' };
    const r = f([a, b], ''); // no anchors; chaining on by default
    assertJson(keptIds(r), ['ts', 'pg'], '[jaccard] different-value facts both kept (jaccard 0.5 < 0.82)');
    assertEq(r.droppedCount, 0, '[jaccard] no false collapse');
  }
  {
    // short facts (< minTokens) never get a jaccard verdict even if similar
    const r = f([{ id: 's1', text: 'likes typescript' }, { id: 's2', text: 'likes postgres' }], 'likes go');
    assertJson(keptIds(r), ['s1', 's2'], '[jaccard] short facts use exact/containment only → both kept');
  }

  // ─── [chaining] ──────────────────────────────────────────────────────────────
  {
    const near = [
      { id: 'first', text: 'deploys every friday afternoon to production reliably' },
      { id: 'second', text: 'deploys every friday afternoon into production reliably' },
    ];
    const chained = f(near, '', { redundancyThreshold: 0.6 });
    assertJson(keptIds(chained), ['first'], '[chaining] second near-dup dropped vs earlier-kept candidate');
    const d = dropFor(chained, 'second');
    assertEq(d?.reason, 'jaccard', '[chaining] reason jaccard');
    assertEq(d?.matched, 'candidate', '[chaining] matched candidate (not anchor)');
    // disabling chaining keeps both
    const unchained = f(near, '', { redundancyThreshold: 0.6, chainAcceptedCandidates: false });
    assertJson(keptIds(unchained), ['first', 'second'], '[chaining] chainAcceptedCandidates:false keeps both');
  }
  {
    // exact-duplicate candidates: second dropped as exact vs the first kept one
    const dups = [{ id: 'd1', text: 'Uses Postgres 16' }, { id: 'd2', text: 'uses postgres 16' }];
    const r = f(dups, '');
    assertJson(keptIds(r), ['d1'], '[chaining] exact dup collapses to first');
    assertEq(dropFor(r, 'd2')?.reason, 'exact', '[chaining] exact dup reason');
    assertEq(dropFor(r, 'd2')?.matched, 'candidate', '[chaining] exact dup matched candidate');
  }

  // ─── [budget / threshold] ────────────────────────────────────────────────────
  {
    const novel = [
      { id: 'n1', text: 'alpha bravo charlie delta echo' },
      { id: 'n2', text: 'foxtrot golf hotel india juliet' },
      { id: 'n3', text: 'kilo lima mike november oscar' },
    ];
    const capped = f(novel, '', { maxKeep: 1 });
    assertEq(capped.keptCount, 1, '[budget] maxKeep:1 keeps exactly 1');
    assertEq(capped.droppedCount, 2, '[budget] the rest are classified as drops');
    assertJson(keptIds(capped), ['n1'], '[budget] first novel item kept, in input order');
    assertEq(dropFor(capped, 'n2')?.reason, 'capacity', '[budget] overflow reason capacity');
    assertEq(dropFor(capped, 'n2')?.matched, 'candidate', '[budget] overflow matched candidate');
    assert(verdictOk(capped), '[budget] capped verdict valid');
    // maxKeep:0 → keep nothing, all valid become capacity drops
    const zero = f(novel, '', { maxKeep: 0 });
    assertEq(zero.keptCount, 0, '[budget] maxKeep:0 keeps nothing');
    assertEq(zero.droppedCount, 3, '[budget] maxKeep:0 drops all three');
  }
  {
    // threshold 1 → only exact/containment fire (a paraphrase survives)
    const anchor = 'the quick brown fox jumps over the lazy dog today';
    const cand = { id: 't', text: 'quick brown fox leaps over a lazy dog now' };
    const strict = f([cand], anchor, { redundancyThreshold: 1, containment: false });
    assertJson(keptIds(strict), ['t'], '[threshold] threshold 1 keeps a non-exact paraphrase');
    // exact still fires at threshold 1
    const exactHit = f([{ id: 'e', text: 'the quick brown fox jumps over the lazy dog today' }], anchor, { redundancyThreshold: 1 });
    assertEq(dropFor(exactHit, 'e')?.reason, 'exact', '[threshold] exact still fires at threshold 1');
  }

  // ─── [anchor shapes] ─────────────────────────────────────────────────────────
  {
    // array of blobs + item-like rows all coerce into anchors
    const anchors: AnchorInput = ['Ships on Fridays', { text: 'Uses Postgres 16' }];
    const r = f([{ id: 'a', text: 'ships on fridays' }, { id: 'b', text: 'uses postgres 16' }, { id: 'c', text: 'novel unseen fact here' }], anchors);
    assertJson(keptIds(r), ['c'], '[anchor-shapes] both facts from mixed anchor shapes are matched');
    assertEq(r.droppedCount, 2, '[anchor-shapes] two dropped');
  }
  {
    // prebuilt index is reused directly by filterNovelAgainstAnchors
    const idx = buildAnchorIndex('Ships on Fridays\nUses Postgres 16');
    const r = f([{ id: 'a', text: 'ships on fridays' }, { id: 'z', text: 'brand new note' }], idx);
    assertJson(keptIds(r), ['z'], '[anchor-shapes] a prebuilt AnchorIndex is accepted as anchors');
    assertEq(dropFor(r, 'a')?.reason, 'exact', '[anchor-shapes] prebuilt index still matches exact');
  }
  {
    // bare-string candidates (text IS the string) get positional ids
    const r = f(['ships on fridays', 'a genuinely novel line'], 'Ships on Fridays');
    assertEq(r.keptCount, 1, '[anchor-shapes] one bare-string candidate kept');
    assertEq(r.keep[0].id, 'c1', '[anchor-shapes] bare-string kept gets positional id c1');
    assertEq(dropFor(r, 'c0')?.reason, 'exact', '[anchor-shapes] bare-string dup dropped with positional id c0');
  }

  // ─── [invariants] ────────────────────────────────────────────────────────────
  {
    const input = [
      { id: 'v1', text: 'ships on fridays' },        // dropped (exact)
      null,                                           // junk → skipped
      { id: 'v2', text: '' },                         // blank text → skipped
      { id: 'v3', text: 'a completely fresh insight about caching layers' }, // kept
      42,                                             // junk → skipped
      { id: 'v4', text: 'uses postgres 16' },         // dropped (exact)
      { text: 'novel and unseen and distinct enough' }, // kept, positional id
    ];
    const r = f(input, 'Ships on Fridays\nUses Postgres 16');
    // 4 VALID candidates: v1 (drop), v3 (keep), v4 (drop), positional c6 (keep).
    // null / blank-text / number rows are junk → skipped (not counted).
    assertEq(r.keptCount + r.droppedCount, 4, '[invariants] keep ∪ drop covers every valid candidate exactly once');
    assert(verdictOk(r), '[invariants] verdict valid');
    // keep order === input order
    assertJson(keptIds(r), ['v3', 'c6'], '[invariants] keep preserves input order with positional id');
    // every drop reason ∈ the enum and carries no text
    for (const d of r.drop) {
      assert(['exact', 'containment', 'jaccard', 'capacity'].includes(d.reason), '[invariants] drop reason in enum');
      assert(!('text' in (d as Record<string, unknown>)), '[invariants] drop carries no text field');
    }
  }
  {
    // determinism: same input twice → byte-identical result
    const input = [
      { id: 'a', text: 'ships on fridays' },
      { id: 'b', text: 'prefers minimal code over heavy frameworks when shipping features' },
      { id: 'c', text: 'a novel line about vector indexes' },
      { id: 'd', text: 'a novel line about vector indexes' }, // dup of c
    ];
    const anchors = 'chris prefers minimal code not heavy frameworks when shipping\nShips on Fridays';
    const r1 = f(input, anchors, { redundancyThreshold: 0.6 });
    const r2 = f(input, anchors, { redundancyThreshold: 0.6 });
    assertJson(r1, r2, '[invariants] deterministic — identical input twice → identical verdict');
    // buildAnchorIndex determinism (compare serialized exact keys)
    const i1 = buildAnchorIndex(anchors);
    const i2 = buildAnchorIndex(anchors);
    assertJson(Array.from(i1.exact).sort(), Array.from(i2.exact).sort(), '[invariants] buildAnchorIndex deterministic');
  }

  // ─── [exported bounds] ───────────────────────────────────────────────────────
  assertEq(MAX_CANDIDATES, 2000, '[bounds] MAX_CANDIDATES');
  assertEq(MAX_ANCHOR_CHARS, 20000, '[bounds] MAX_ANCHOR_CHARS');
  assertEq(MAX_ANCHOR_LINES, 512, '[bounds] MAX_ANCHOR_LINES');
  assertEq(MAX_TOKENS_PER_UNIT, 60, '[bounds] MAX_TOKENS_PER_UNIT');
  assertEq(MAX_TEXT_SCAN, 4000, '[bounds] MAX_TEXT_SCAN');
  assertEq(SIG_CHARS, 140, '[bounds] SIG_CHARS');
  assertEq(MIN_CONTAINMENT_CHARS, 16, '[bounds] MIN_CONTAINMENT_CHARS');
  assertEq(MAX_KEEP, 2000, '[bounds] MAX_KEEP');
  assertEq(MAX_ID_LEN, 200, '[bounds] MAX_ID_LEN');
  assertEq(MAX_SOURCE_LEN, 64, '[bounds] MAX_SOURCE_LEN');
  assertEq(COMPARE_WINDOW, 256, '[bounds] COMPARE_WINDOW');
  assertEq(DEFAULT_REDUNDANCY_THRESHOLD, 0.82, '[bounds] DEFAULT_REDUNDANCY_THRESHOLD');
  assertEq(DEFAULT_MIN_TOKENS, 5, '[bounds] DEFAULT_MIN_TOKENS');

  // ─── [secret-safe] ───────────────────────────────────────────────────────────
  {
    // a unique sentinel in candidate text that gets dropped must NOT appear in any drop
    const SENTINEL = 'zzsecretsentinelzz';
    const anchor = SENTINEL + ' alpha bravo charlie delta echo foxtrot';
    const r = f([{ id: 'leaky', source: 'user_notes', text: SENTINEL.toUpperCase() + ' alpha bravo charlie delta echo foxtrot' }], anchor);
    assert(r.droppedCount === 1, '[secret-safe] the restated fact was dropped');
    assert(!JSON.stringify(r.drop).includes(SENTINEL), '[secret-safe] sentinel text never appears in a drop record', JSON.stringify(r.drop));
    assert(!JSON.stringify(r.drop).toLowerCase().includes('secretsentinel'), '[secret-safe] no case-variant text leaks into drop');
    // the drop still carries the safe id + source
    assertEq(dropFor(r, 'leaky')?.source, 'user_notes', '[secret-safe] drop keeps the safe source identifier');
  }
  {
    // control / line-sep / fence chars in id + source are stripped from the drop
    const nastyId = 'id' + String.fromCharCode(0) + 'x' + String.fromCharCode(9) + LINE_SEP + '`<b>';
    const nastySource = 'src' + String.fromCharCode(10) + '</untrusted>';
    const r = f([{ id: nastyId, source: nastySource, text: 'ships on fridays' }], 'Ships on Fridays');
    const d = dropFor(r, 'idxx') ?? r.drop[0];
    assert(!!d, '[secret-safe] drop present for nasty-id candidate');
    assert(!hasUnsafeChars(d.id), '[secret-safe] no control/fence chars in drop id', JSON.stringify(d.id));
    assert(!hasUnsafeChars(d.source), '[secret-safe] no control/fence chars in drop source', JSON.stringify(d.source));
  }

  // ─── [HOSTILE] totality: never throw, never leak ─────────────────────────────
  try {
    // f(null, null) → the fully-empty verdict
    assertJson(f(null, null), { keep: [], drop: [], keptCount: 0, droppedCount: 0 }, '[hostile] f(null,null) → empty verdict');

    for (const badC of [null, undefined, 42, NaN, true, 'str', {}, () => 1, Symbol('s'), 9n]) {
      assert(totalOn(badC, 'anchor blob'), '[hostile] junk candidates arg is total', String(badC).slice(0, 12));
    }
    for (const badA of [null, undefined, 42, NaN, true, {}, [], () => 1, Symbol('s'), 9n]) {
      assert(totalOn([{ id: 'a', text: 'hello world' }], badA), '[hostile] junk anchors arg is total', String(badA).slice(0, 12));
    }

    // a battery of hostile candidate rows: undefined / number / throwing toString /
    // cyclic / throwing text-getter / throwing id-getter (text ok) — never throws.
    const cyc: Record<string, unknown> = { id: 'cyc', text: 'a cyclic novel row about graphs' };
    cyc.self = cyc;
    const throwText = {} as Record<string, unknown>;
    Object.defineProperty(throwText, 'text', { get() { throw new Error('boom text'); }, enumerable: true });
    const throwId: Record<string, unknown> = { text: 'x' };
    Object.defineProperty(throwId, 'id', { get() { throw new Error('boom id'); }, enumerable: true });
    const hostileRows: unknown[] = [
      undefined,
      42,
      { text: { toString() { throw new Error('nope'); } } },
      cyc,
      throwText,
      throwId,
      { id: 'ok', text: 'a distinct fresh fact worth keeping' },
    ];
    const hr = f(hostileRows, null);
    assert(verdictOk(hr), '[hostile] hostile candidate battery → valid verdict');
    // the good rows survive; the junk rows are skipped without throwing
    assert(keptIds(hr).includes('ok'), '[hostile] a clean row still kept amid hostile rows');
    assert(keptIds(hr).includes('cyc'), '[hostile] a cyclic-but-scalar row resolves its text');
    // throwId row kept with a positional id (its throwing id getter → positional)
    assert(hr.keep.some((k) => k.text === 'x'), '[hostile] throwing id-getter row kept with positional id');

    // candidates as a throwing proxy array element
    const proxyRow = new Proxy({}, { get() { throw new Error('proxy boom'); } });
    assert(totalOn([proxyRow, { id: 'q', text: 'still fine here friend' }], 'anchor'), '[hostile] throwing-proxy row is total');

    // opts hostile
    assert(totalOn([{ id: 'a', text: 'hello there world' }], 'x', 42), '[hostile] numeric opts total');
    assert(totalOn([{ id: 'a', text: 'hello there world' }], 'x', 'nope'), '[hostile] string opts total');
    assert(totalOn([{ id: 'a', text: 'hello there world' }], 'x', { redundancyThreshold: NaN, minTokens: -5, maxKeep: Infinity }), '[hostile] garbage opts fields total');
    const throwingOpts = new Proxy({}, { get() { throw new Error('opts boom'); } });
    assert(totalOn([{ id: 'a', text: 'ships on fridays' }], 'Ships on Fridays', throwingOpts), '[hostile] throwing-proxy opts falls back to defaults');

    // anchors = 5MB string → bounded, no throw
    const bigStr = 'x'.repeat(5_000_000);
    const rBig = f([{ id: 'a', text: 'hello world friend' }], bigStr);
    assert(verdictOk(rBig), '[hostile] 5MB anchor string → valid verdict');

    // anchors = 100k-line blob → bounded (line cap), no throw
    const bigLines = 'line\n'.repeat(100_000);
    const idxBig = buildAnchorIndex(bigLines);
    assert(idxBig.exact.size <= MAX_ANCHOR_LINES, '[hostile] 100k-line blob → exact keys ≤ MAX_ANCHOR_LINES', String(idxBig.exact.size));
    assert(idxBig.joined.length <= MAX_ANCHOR_CHARS + 2, '[hostile] joined blob bounded', String(idxBig.joined.length));
    assert(verdictOk(f([{ id: 'a', text: 'a novel fact amid the flood' }], bigLines)), '[hostile] 100k-line anchors → valid verdict');

    // anchors array with 100k blobs → bounded blob scan
    const manyBlobs: string[] = new Array(100_000).fill('');
    manyBlobs[0] = 'Ships on Fridays';
    const rMany = f([{ id: 'a', text: 'ships on fridays' }], manyBlobs);
    assert(verdictOk(rMany), '[hostile] 100k-blob anchor array → valid verdict');
    assertEq(dropFor(rMany, 'a')?.reason, 'exact', '[hostile] first blob still indexed under the cap');

    // MAX_CANDIDATES flood → bounded scan
    const flood: unknown[] = [];
    for (let i = 0; i < MAX_CANDIDATES + 500; i += 1) flood.push({ id: 'flood' + i, text: 'unique novel fact number ' + i });
    const rFlood = f(flood, '');
    assert(verdictOk(rFlood), '[hostile] candidate flood → valid verdict');
    assert(rFlood.keptCount + rFlood.droppedCount <= MAX_CANDIDATES, '[hostile] candidate scan capped at MAX_CANDIDATES', String(rFlood.keptCount + rFlood.droppedCount));

    // buildAnchorIndex(Symbol()) → empty index
    const symIdx = buildAnchorIndex(Symbol('s') as never);
    assertEq(symIdx.exact.size, 0, '[hostile] buildAnchorIndex(Symbol) → empty exact');
    assertEq(symIdx.lineTokens.length, 0, '[hostile] buildAnchorIndex(Symbol) → empty lineTokens');
    assertJson(buildAnchorIndex(null).exact.size, 0, '[hostile] buildAnchorIndex(null) → empty');

    // isCoveredByAnchors on a malformed index → not covered
    assertJson(cov('x', {}), { covered: false, reason: null }, '[hostile] isCoveredByAnchors({} index) → not covered');
    assertJson(cov('anything at all here', null), { covered: false, reason: null }, '[hostile] isCoveredByAnchors(null index) → not covered');
    assertJson(cov(null, buildAnchorIndex('Ships on Fridays')), { covered: false, reason: null }, '[hostile] isCoveredByAnchors(null text) → not covered');
    assertJson(cov({ get x() { throw 1; } }, buildAnchorIndex('a b c')), { covered: false, reason: null }, '[hostile] isCoveredByAnchors(hostile text) → not covered');

    // huge candidate text (2MB) → scan-capped, no throw, kept text bounded
    const bigText = 'y'.repeat(2_000_000);
    const rHugeText = f([{ id: 'big', text: bigText }], '');
    assert(verdictOk(rHugeText), '[hostile] 2MB candidate text → valid verdict');
    assert(rHugeText.keptCount === 1, '[hostile] 2MB novel text kept');
    assert(rHugeText.keep[0].text.length <= MAX_TEXT_OUT_LIMIT, '[hostile] kept huge text length-bounded', String(rHugeText.keep[0].text.length));

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: [HOSTILE] sweep threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll memory-novelty-filter-core smoke cases passed (${passes} passed).`);
}

main();
