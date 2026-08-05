/**
 * capability-match-gate-core-smoketest — the PURE decision layer
 * (src/lib/capabilityMatchGateCore.ts) that arbitrates an already-scored
 * skill/capability/specialist/family candidate set into ONE deterministic 4-way
 * decision. Load-bearing assertions:
 *
 *   decideCapabilityMatch(candidates?, opts?): MatchGateDecision
 *     - normalizes → bounded, de-duped (by id, keeping MAX score), floored
 *       (drop score < minScore, non-finite, negative), score-desc/id-asc-sorted;
 *     - empty ⇒ { action:'none', primary:null, alternatives:[], confidence:0,
 *       margin:0, reason:'no-eligible-candidates' };
 *     - lone dominant leader & topScore>=strongScore ⇒ 'apply' (dominant-strong);
 *     - lone dominant leader & topScore<strongScore  ⇒ 'suggest' (dominant-weak);
 *     - #2 inside the dominance band                 ⇒ 'disambiguate' (near-tie),
 *       primary null, alternatives = the in-band cluster (>=2, leader first,
 *       capped to maxAlternatives+1);
 *     - margin = 1 - score2/score1 (1 when single); confidence = clamp01(top/
 *       strongScore); each choice carries share = score/topScore (leader 1).
 *
 *   And: every export is TOTAL — null/undefined/number/string/{}/[]-as-input,
 *   array-of-junk, cyclic object, throwing-getter candidate, throwing-proxy
 *   opts, __proto__/control/line-sep/fence-char ids+labels, a 10k-entry array,
 *   and non-finite opts ⇒ a valid bounded MatchGateDecision, never a throw,
 *   never a leaked control/fence char.
 *
 * Pure — loads under tsx (the core imports nothing at all).
 */

import {
  decideCapabilityMatch,
  MATCH_GATE_MIN_SCORE,
  MATCH_GATE_STRONG_SCORE,
  MATCH_GATE_DOMINANCE_MARGIN,
  MATCH_GATE_MAX_CANDIDATES,
  MATCH_GATE_MAX_ALTERNATIVES,
  MATCH_GATE_MAX_ID_LEN,
  MATCH_GATE_MAX_LABEL_LEN,
  MATCH_GATE_ACTIONS,
  MATCH_GATE_REASONS,
  type MatchGateDecision,
  type MatchGateChoice,
  type MatchGateOptions,
  type ScoredCandidate,
} from '../src/lib/capabilityMatchGateCore';

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
  assert(
    JSON.stringify(a) === JSON.stringify(b),
    msg,
    `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`,
  );
}

// ── unsafe-char detector (built via fromCharCode so no raw bytes in source) ────
const LINE_SEP = String.fromCharCode(0x2028, 0x2029);
function hasUnsafeChars(s: string): boolean {
  if (/[\x00-\x1f\x7f-\x9f`<>]/.test(s)) return true;
  return s.indexOf(LINE_SEP[0]) >= 0 || s.indexOf(LINE_SEP[1]) >= 0;
}

// ── call wrapper (keeps hostile fixtures cast-free at the call sites) ──────────
function g(input?: unknown, opts?: unknown): MatchGateDecision {
  return decideCapabilityMatch(input, opts as MatchGateOptions | undefined);
}

// ── structural validators ─────────────────────────────────────────────────────
function choiceIsValid(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const cc = c as MatchGateChoice;
  if (typeof cc.id !== 'string' || cc.id.length === 0 || cc.id.length > MATCH_GATE_MAX_ID_LEN) return false;
  if (typeof cc.label !== 'string' || cc.label.length === 0 || cc.label.length > MATCH_GATE_MAX_LABEL_LEN) return false;
  if (typeof cc.score !== 'number' || !Number.isFinite(cc.score) || cc.score < 0) return false;
  if (typeof cc.share !== 'number' || !Number.isFinite(cc.share) || cc.share < 0 || cc.share > 1) return false;
  if (hasUnsafeChars(cc.id) || hasUnsafeChars(cc.label)) return false;
  return true;
}
function decisionIsValid(r: unknown): r is MatchGateDecision {
  if (!r || typeof r !== 'object') return false;
  const rr = r as MatchGateDecision;
  if (!MATCH_GATE_ACTIONS.includes(rr.action)) return false;
  if (!MATCH_GATE_REASONS.includes(rr.reason)) return false;
  if (typeof rr.confidence !== 'number' || !Number.isFinite(rr.confidence) || rr.confidence < 0 || rr.confidence > 1) return false;
  if (typeof rr.margin !== 'number' || !Number.isFinite(rr.margin) || rr.margin < 0 || rr.margin > 1) return false;
  if (!Array.isArray(rr.alternatives)) return false;
  if (rr.alternatives.length > MATCH_GATE_MAX_ALTERNATIVES + 1) return false;
  if (!(rr.primary === null || choiceIsValid(rr.primary))) return false;
  for (const a of rr.alternatives) if (!choiceIsValid(a)) return false;
  // alternatives sorted by score desc, ids unique across the whole decision
  const seen = new Set<string>();
  if (rr.primary) seen.add(rr.primary.id);
  for (let i = 0; i < rr.alternatives.length; i += 1) {
    if (i > 0 && rr.alternatives[i].score > rr.alternatives[i - 1].score) return false;
    if (seen.has(rr.alternatives[i].id)) return false;
    seen.add(rr.alternatives[i].id);
  }
  // action ↔ shape invariants
  if (rr.action === 'none') return rr.primary === null && rr.alternatives.length === 0;
  if (rr.action === 'disambiguate') return rr.primary === null && rr.alternatives.length >= 2;
  if (rr.action === 'apply' || rr.action === 'suggest') {
    return rr.primary !== null && rr.alternatives.length <= MATCH_GATE_MAX_ALTERNATIVES;
  }
  return false;
}
function totalOn(input: unknown, opts?: unknown): boolean {
  try {
    return decisionIsValid(g(input, opts));
  } catch {
    return false;
  }
}
function choiceCount(r: MatchGateDecision): number {
  return (r.primary ? 1 : 0) + r.alternatives.length;
}

function main(): void {
  // ─── (A) happy path — dominant strong leader ⇒ apply ────────────────────────
  {
    const r = g([{ id: 'a', score: 9 }, { id: 'b', score: 2 }], { strongScore: 6 });
    assertEq(r.action, 'apply', '(A) action apply');
    assert(!!r.primary, '(A) has primary');
    assertEq(r.primary?.id, 'a', '(A) primary id a');
    assertEq(r.primary?.label, 'a', '(A) label defaults to id');
    assertEq(r.primary?.score, 9, '(A) primary score 9');
    assertEq(r.primary?.share, 1, '(A) leader share 1');
    assertEq(r.reason, 'dominant-strong', '(A) reason dominant-strong');
    assert(r.margin >= 0.75, '(A) margin >= 0.75', String(r.margin));
    assertEq(r.confidence, 1, '(A) confidence clamps to 1 (9/6)');
    assertEq(r.alternatives.length, 1, '(A) one alternative');
    assertEq(r.alternatives[0].id, 'b', '(A) alternative is b');
    assert(r.alternatives[0].share <= 1, '(A) alt share <= 1', String(r.alternatives[0].share));
    assert(decisionIsValid(r), '(A) result structurally valid');
  }

  // ─── (B) lone weak leader ⇒ suggest ─────────────────────────────────────────
  {
    const r = g([{ id: 'a', score: 4 }, { id: 'b', score: 1 }], { strongScore: 6 });
    assertEq(r.action, 'suggest', '(B) action suggest');
    assertEq(r.primary?.id, 'a', '(B) primary a');
    assertEq(r.reason, 'dominant-weak', '(B) reason dominant-weak');
    assert(r.confidence < 1, '(B) confidence < 1', String(r.confidence));
    assert(decisionIsValid(r), '(B) valid');
  }

  // ─── (C) near-tie ⇒ disambiguate ────────────────────────────────────────────
  {
    const r = g([{ id: 'a', score: 9 }, { id: 'b', score: 8.5 }], { strongScore: 6 });
    assertEq(r.action, 'disambiguate', '(C) action disambiguate');
    assertEq(r.primary, null, '(C) primary null');
    assert(r.alternatives.length >= 2, '(C) alternatives.length >= 2', String(r.alternatives.length));
    assertEq(r.alternatives[0].id, 'a', '(C) cluster leader a first');
    assertEq(r.alternatives[1].id, 'b', '(C) cluster b second');
    assertEq(r.alternatives[0].share, 1, '(C) leader share 1');
    assert(r.alternatives.every((a) => a.share <= 1), '(C) every share <= 1');
    assertEq(r.reason, 'near-tie', '(C) reason near-tie');
    assert(decisionIsValid(r), '(C) valid');
    // a weak near-tie ALSO disambiguates (dominance is independent of strength)
    const weak = g([{ id: 'a', score: 2 }, { id: 'b', score: 1.9 }], { strongScore: 6 });
    assertEq(weak.action, 'disambiguate', '(C) weak near-tie still disambiguates');
  }

  // ─── (D) below-floor ⇒ none ─────────────────────────────────────────────────
  {
    const r = g([{ id: 'a', score: 0.2 }], { minScore: 1 });
    assertEq(r.action, 'none', '(D) action none');
    assertEq(r.primary, null, '(D) primary null');
    assertEq(r.alternatives.length, 0, '(D) no alternatives');
    assertEq(r.reason, 'no-eligible-candidates', '(D) reason');
    assertEq(r.confidence, 0, '(D) confidence 0');
    assertEq(r.margin, 0, '(D) margin 0');
    assertEq(g([{ id: 'a', score: 0.5 }]).action, 'none', '(D) default floor drops 0.5');
    assertEq(g([{ id: 'a', score: 0 }]).action, 'none', '(D) zero score dropped by default floor');
    assertEq(g([{ id: 'a', score: -3 }]).action, 'none', '(D) negative score dropped');
    assertEq(g([{ id: 'a' }]).action, 'none', '(D) missing score dropped');
    assertEq(g([{ id: 42, score: 9 }]).action, 'none', '(D) numeric id dropped');
    assertEq(g([{ id: '', score: 9 }]).action, 'none', '(D) empty id dropped');
  }

  // ─── (E) single candidate ⇒ margin 1; apply iff strong ──────────────────────
  {
    const strong = g([{ id: 'solo', score: 9 }], { strongScore: 6 });
    assertEq(strong.action, 'apply', '(E) single strong ⇒ apply');
    assertEq(strong.margin, 1, '(E) single margin 1');
    assertEq(strong.primary?.id, 'solo', '(E) primary solo');
    assertEq(strong.primary?.share, 1, '(E) solo share 1');
    assertEq(strong.alternatives.length, 0, '(E) single ⇒ no alternatives');
    const weak = g([{ id: 'solo', score: 3 }], { strongScore: 6 });
    assertEq(weak.action, 'suggest', '(E) single weak ⇒ suggest');
    assertEq(weak.margin, 1, '(E) single weak margin 1');
    assertEq(weak.confidence, 0.5, '(E) confidence = top/strong (3/6)');
  }

  // ─── (F) dedupe keeps MAX score ─────────────────────────────────────────────
  {
    const r = g([{ id: 'a', score: 3 }, { id: 'a', score: 7 }], { strongScore: 6 });
    assertEq(choiceCount(r), 1, '(F) dedupe ⇒ exactly one choice');
    assertEq(r.primary?.id, 'a', '(F) deduped id a');
    assertEq(r.primary?.score, 7, '(F) dedupe keeps MAX score 7');
    assertEq(r.action, 'apply', '(F) 7 >= 6 ⇒ apply');
    assertEq(r.margin, 1, '(F) single after dedupe ⇒ margin 1');
    // order independent — MAX wins whichever way the dup rows arrive
    const r2 = g([{ id: 'a', score: 7 }, { id: 'a', score: 3 }], { strongScore: 6 });
    assertJson(r, r2, '(F) dedupe is order-independent');
  }

  // ─── (G) determinism + id-asc tiebreak on equal scores ──────────────────────
  {
    const base: ScoredCandidate[] = [
      { id: 'a', score: 5 }, { id: 'c', score: 9 }, { id: 'b', score: 5 }, { id: 'd', score: 2 },
    ];
    const shuffled: ScoredCandidate[] = [
      { id: 'd', score: 2 }, { id: 'b', score: 5 }, { id: 'c', score: 9 }, { id: 'a', score: 5 },
    ];
    const ra = g(base, { strongScore: 6 });
    const rb = g(shuffled, { strongScore: 6 });
    assertJson(ra, rb, '(G) shuffled input ⇒ identical decision');
    assertJson(g(base, { strongScore: 6 }), g(base, { strongScore: 6 }), '(G) same input twice identical');
    assertEq(ra.primary?.id, 'c', '(G) dominant leader c');
    assertEq(ra.alternatives[0].id, 'a', '(G) equal-score tiebreak: a before b');
    assertEq(ra.alternatives[1].id, 'b', '(G) equal-score tiebreak: b second');
  }

  // ─── (H) bounds / caps / clamps ─────────────────────────────────────────────
  {
    // margin math on a clean dominant pair
    const m = g([{ id: 'a', score: 10 }, { id: 'b', score: 4 }], { strongScore: 6 });
    assertEq(m.action, 'apply', '(H) 10 vs 4 ⇒ apply');
    assertEq(m.margin, 0.6, '(H) margin = 1 - 4/10 = 0.6');
    assert(Math.abs((m.alternatives[0].share ?? 0) - 0.4) < 1e-9, '(H) alt share = 4/10 = 0.4', String(m.alternatives[0].share));
  }
  {
    // 50 candidates, dominant leader, many below-band ⇒ apply, alts capped to maxAlt
    const many: ScoredCandidate[] = [{ id: 'lead', score: 100 }];
    for (let i = 0; i < 49; i += 1) many.push({ id: `w${i}`, score: 1 + (i % 40) });
    const r = g(many, { strongScore: 50, maxAlternatives: 4 });
    assertEq(r.action, 'apply', '(H) dominant leader among 50 ⇒ apply');
    assert(r.alternatives.length <= 4, '(H) alternatives capped to maxAlternatives 4', String(r.alternatives.length));
    assertEq(r.alternatives.length, 4, '(H) exactly maxAlternatives alts when many below-band');
    assert(decisionIsValid(r), '(H) 50-candidate result valid');
  }
  {
    // disambiguate cluster capped to maxAlternatives + 1
    const tie: ScoredCandidate[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, score: 10 }));
    const r = g(tie, { maxAlternatives: 2 });
    assertEq(r.action, 'disambiguate', '(H) 6-way tie ⇒ disambiguate');
    assertEq(r.alternatives.length, 3, '(H) cluster capped to maxAlternatives+1 (2+1)');
    assert(r.alternatives.every((a) => a.share === 1), '(H) all tied shares 1');
    assertJson(r.alternatives.map((a) => a.id), ['a', 'b', 'c'], '(H) cluster is top-3 by id asc');
  }
  {
    // apply alternatives honor a small maxAlternatives
    const r = g(
      [{ id: 'lead', score: 100 }, { id: 'a', score: 5 }, { id: 'b', score: 4 }, { id: 'c', score: 3 }, { id: 'd', score: 2 }],
      { strongScore: 50, maxAlternatives: 2 },
    );
    assertEq(r.action, 'apply', '(H) dominant ⇒ apply');
    assertEq(r.alternatives.length, 2, '(H) apply alts capped to maxAlternatives 2');
    assertEq(r.alternatives[0].id, 'a', '(H) top alt a');
    assertEq(r.alternatives[1].id, 'b', '(H) second alt b');
  }
  {
    // string clamping
    const rl = g([{ id: 'x', score: 9, label: 'L'.repeat(500) }], { strongScore: 6 });
    assert((rl.primary?.label.length ?? 0) <= MATCH_GATE_MAX_LABEL_LEN, '(H) long label clamped');
    const ri = g([{ id: 'i'.repeat(500), score: 9 }], { strongScore: 6 });
    assert((ri.primary?.id.length ?? 0) <= MATCH_GATE_MAX_ID_LEN, '(H) long id clamped to id cap');
    assert((ri.primary?.label.length ?? 0) <= MATCH_GATE_MAX_LABEL_LEN, '(H) id-as-label clamped to label cap');
  }
  {
    // 10k-entry array — bounded scan, valid decision, fast
    const huge: ScoredCandidate[] = [];
    for (let i = 0; i < 10000; i += 1) huge.push({ id: `h${i}`, score: (i % 100) + 1 });
    const t0 = Date.now();
    const rh = g(huge, { strongScore: 60 });
    const dt = Date.now() - t0;
    assert(decisionIsValid(rh), '(H) 10k array ⇒ valid bounded decision');
    assert(rh.alternatives.length <= MATCH_GATE_MAX_ALTERNATIVES + 1, '(H) alternatives bounded under 10k');
    assert(dt < 500, '(H) 10k array returns fast (< 500ms)', `${dt}ms`);
  }
  {
    // a strong candidate BEYOND the scan cap is ignored (bounded scan)
    const capArr: ScoredCandidate[] = [];
    for (let i = 0; i < MATCH_GATE_MAX_CANDIDATES; i += 1) capArr.push({ id: `c${i}`, score: 2 });
    capArr.push({ id: 'beyond', score: 100 });
    const r = g(capArr, { strongScore: 6 });
    assert(
      r.primary?.id !== 'beyond' && !r.alternatives.some((a) => a.id === 'beyond'),
      '(H) candidate beyond MATCH_GATE_MAX_CANDIDATES is ignored',
    );
    assert(decisionIsValid(r), '(H) scan-cap result valid');
  }

  // ─── (I) exported bound values ──────────────────────────────────────────────
  assertEq(MATCH_GATE_MIN_SCORE, 1, '(I) MATCH_GATE_MIN_SCORE');
  assertEq(MATCH_GATE_STRONG_SCORE, 6, '(I) MATCH_GATE_STRONG_SCORE');
  assertEq(MATCH_GATE_DOMINANCE_MARGIN, 0.25, '(I) MATCH_GATE_DOMINANCE_MARGIN');
  assertEq(MATCH_GATE_MAX_CANDIDATES, 200, '(I) MATCH_GATE_MAX_CANDIDATES');
  assertEq(MATCH_GATE_MAX_ALTERNATIVES, 4, '(I) MATCH_GATE_MAX_ALTERNATIVES');
  assert(MATCH_GATE_MAX_ID_LEN > 0, '(I) MATCH_GATE_MAX_ID_LEN positive');
  assert(MATCH_GATE_MAX_LABEL_LEN > 0, '(I) MATCH_GATE_MAX_LABEL_LEN positive');
  assertEq(MATCH_GATE_ACTIONS.length, 4, '(I) four actions');
  assertEq(MATCH_GATE_REASONS.length, 4, '(I) four reasons');
  // frozen enums can't be mutated
  try { (MATCH_GATE_ACTIONS as unknown as string[]).push('x'); } catch { /* frozen */ }
  assertEq(MATCH_GATE_ACTIONS.length, 4, '(I) MATCH_GATE_ACTIONS frozen');

  // ─── (HOSTILE) totality: never throw, never leak ────────────────────────────
  try {
    // scalars / wrong types ⇒ valid 'none'
    for (const bad of [null, undefined, 42, NaN, Infinity, -Infinity, true, false, 'x', '', {}, [], () => 1, Symbol('s'), 9n]) {
      assert(totalOn(bad), 'hostile input total', JSON.stringify(String(bad).slice(0, 16)));
      const r = g(bad);
      assertEq(r.action, 'none', 'hostile scalar ⇒ none');
      assertEq(r.primary, null, 'hostile scalar ⇒ primary null');
      assertEq(r.alternatives.length, 0, 'hostile scalar ⇒ no alternatives');
    }

    // array where every element is invalid ⇒ none
    const junk: unknown[] = [null, {}, { id: '' }, { id: 'x', score: NaN }, { id: 'y', score: -5 }, { id: 'z', score: Infinity }];
    assert(totalOn(junk), 'all-invalid array total');
    assertEq(g(junk).action, 'none', 'all-invalid array ⇒ none');
    assertJson(g(junk), g(junk), 'hostile determinism: junk array twice identical');

    // junk mixed with valid ⇒ only the valid survivors decide
    const mixed = g([null, { id: 'good', score: 8 }, { id: '', score: 5 }, { id: 'bad', score: NaN }, 'nope', 42, { id: 'good2', score: 2 }], { strongScore: 6 });
    assert(decisionIsValid(mixed), 'mixed junk+valid total');
    assertEq(mixed.action, 'apply', 'mixed ⇒ apply on the strong survivor');
    assertEq(mixed.primary?.id, 'good', 'mixed ⇒ primary is the valid strong candidate');
    assertEq(mixed.alternatives[0]?.id, 'good2', 'mixed ⇒ the other survivor is the alternative');

    // hostile opts VALUES clamp to safe defaults
    const ho = g([{ id: 'a', score: 9 }, { id: 'b', score: 8.6 }], { minScore: NaN, strongScore: -1, dominanceMargin: 5, maxAlternatives: 1e9 } as MatchGateOptions);
    assert(decisionIsValid(ho), 'hostile opts values total');
    assertEq(ho.action, 'disambiguate', 'hostile opts clamp ⇒ correct near-tie (margin 5→default 0.25)');
    assert(ho.alternatives.length <= MATCH_GATE_MAX_ALTERNATIVES + 1, 'hostile maxAlternatives 1e9 clamped');

    // opts as wrong types ⇒ defaults, candidates still decided
    for (const badOpts of [42, 'nope', [], null, true, NaN]) {
      assert(totalOn([{ id: 'a', score: 9 }], badOpts), `wrong-type opts total (${String(badOpts).slice(0, 8)})`);
    }

    // throwing-proxy opts ⇒ falls back to defaults, still decides candidates
    const throwingOpts = new Proxy({}, { get() { throw new Error('opts boom'); } });
    const rto = g([{ id: 'a', score: 9 }, { id: 'b', score: 2 }], throwingOpts);
    assert(decisionIsValid(rto), 'throwing-proxy opts total');
    assert(rto.action !== 'none', 'throwing-proxy opts ⇒ candidates still decided');
    assertEq(rto.primary?.id, 'a', 'throwing-proxy opts ⇒ still ranks candidates');

    // cyclic object as the WHOLE input (non-array) ⇒ none
    const cyc: Record<string, unknown> = { id: 'a', score: 5 };
    cyc.self = cyc;
    cyc.list = [cyc, cyc];
    assert(totalOn(cyc), 'cyclic non-array input total');
    assertEq(g(cyc).action, 'none', 'cyclic object (non-array) ⇒ none');

    // cyclic ELEMENT inside the array ⇒ still resolves its scalar id/score
    const cycEl: Record<string, unknown> = { id: 'cyc', score: 9 };
    cycEl.self = cycEl;
    cycEl.list = [cycEl];
    const rce = g([cycEl, { id: 'b', score: 2 }], { strongScore: 6 });
    assert(decisionIsValid(rce), 'cyclic element total');
    assertEq(rce.primary?.id, 'cyc', 'cyclic element ⇒ scalar id/score still read');

    // throwing score getter ⇒ that candidate skipped, siblings survive
    const boomScore: Record<string, unknown> = { id: 'boom' };
    Object.defineProperty(boomScore, 'score', { get() { throw new Error('boom'); }, enumerable: true });
    const rbs = g([boomScore, { id: 'ok', score: 7 }], { strongScore: 6 });
    assert(decisionIsValid(rbs), 'throwing score getter total');
    assert(rbs.primary?.id !== 'boom' && !rbs.alternatives.some((a) => a.id === 'boom'), 'throwing-score candidate skipped');
    assertEq(rbs.primary?.id, 'ok', 'sibling survives throwing score getter');

    // throwing id getter ⇒ skipped
    const boomId: Record<string, unknown> = { score: 7 };
    Object.defineProperty(boomId, 'id', { get() { throw new Error('boom id'); }, enumerable: true });
    const rbi = g([boomId, { id: 'ok2', score: 8 }], { strongScore: 6 });
    assert(decisionIsValid(rbi), 'throwing id getter total');
    assertEq(rbi.primary?.id, 'ok2', 'throwing id getter skipped, sibling survives');

    // throwing-proxy element ⇒ skipped
    const proxyEl = new Proxy({}, { get() { throw new Error('el boom'); } });
    const rpe = g([proxyEl, { id: 'ok3', score: 9 }], { strongScore: 6 });
    assert(decisionIsValid(rpe), 'throwing-proxy element total');
    assertEq(rpe.primary?.id, 'ok3', 'throwing-proxy element skipped');

    // __proto__ / constructor ids handled via Map (no prototype walk)
    const rp = g([{ id: '__proto__', score: 9 }, { id: 'constructor', score: 8.8 }], { strongScore: 6 });
    assert(decisionIsValid(rp), '__proto__ id total');
    assertEq(rp.action, 'disambiguate', '__proto__/constructor near-tie ⇒ disambiguate');
    assert(rp.alternatives.some((a) => a.id === '__proto__'), '__proto__ id surfaced as a choice');
    assert(rp.alternatives.some((a) => a.id === 'constructor'), 'constructor id surfaced as a choice');

    // control / line-sep / fence chars in id + label ⇒ stripped, clamped
    const nastyId = 'sk' + String.fromCharCode(0) + 'ill' + String.fromCharCode(9) + '<x>`';
    const nastyLabel = 'Code' + String.fromCharCode(0) + 'Review' + LINE_SEP + ' `<b>`';
    const rn = g([{ id: nastyId, score: 9, label: nastyLabel }], { strongScore: 6 });
    assert(decisionIsValid(rn), 'control/fence-char candidate total');
    assert(!!rn.primary, 'control/fence-char candidate still surfaced');
    assert(!hasUnsafeChars(rn.primary!.id), 'no unsafe chars leak into the id', JSON.stringify(rn.primary!.id));
    assert(!hasUnsafeChars(rn.primary!.label), 'no unsafe chars leak into the label', JSON.stringify(rn.primary!.label));

    // huge string id + label ⇒ clamped
    const rh = g([{ id: 'h'.repeat(20000), score: 9, label: 'L'.repeat(20000) }], { strongScore: 6 });
    assert(decisionIsValid(rh), 'huge string id/label total');
    assert(rh.primary!.id.length <= MATCH_GATE_MAX_ID_LEN, 'huge id clamped');
    assert(rh.primary!.label.length <= MATCH_GATE_MAX_LABEL_LEN, 'huge label clamped');

    // battery: every choice across many inputs obeys the caps + is clean
    const battery: unknown[] = [
      [{ id: 'a', score: 9 }, { id: 'b', score: 2 }],
      [{ id: 'a', score: 9 }, { id: 'b', score: 8.9 }, { id: 'c', score: 8.8 }],
      [{ id: 'only', score: 3 }],
      [{ id: 'x', score: 5 }, { id: 'x', score: 1 }],
      [],
      { not: 'an array' },
    ];
    for (const b of battery) {
      const r = g(b, { strongScore: 6 });
      assert(decisionIsValid(r), 'battery result valid', JSON.stringify(b).slice(0, 48));
      if (r.primary) {
        assert(r.primary.id.length <= MATCH_GATE_MAX_ID_LEN, 'battery primary id clamped');
        assert(r.primary.label.length <= MATCH_GATE_MAX_LABEL_LEN, 'battery primary label clamped');
      }
      for (const a of r.alternatives) {
        assert(a.id.length <= MATCH_GATE_MAX_ID_LEN, 'battery alt id clamped');
        assert(a.label.length <= MATCH_GATE_MAX_LABEL_LEN, 'battery alt label clamped');
        assert(a.share >= 0 && a.share <= 1, 'battery alt share in [0,1]');
      }
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
  console.log(`\nAll capability-match-gate-core smoke cases passed (${passes} passed).`);
}

main();
