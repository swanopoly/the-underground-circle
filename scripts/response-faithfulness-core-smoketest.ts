/**
 * response-faithfulness-core-smoketest — the PURE groundedness/faithfulness
 * heuristic (src/lib/responseFaithfulnessCore.ts), RESPONSE_QUALITY R6. Advisory
 * signal only: it NEVER suppresses output. Load-bearing behavior pinned here:
 *   - a response whose specifics all appear in context → score high, flag 'ok',
 *     no unsupported claims;
 *   - a response with INVENTED specifics not in context (and no citation) → low
 *     score, unsupportedClaims populated, flag 'review'/'ungrounded';
 *   - explicit citations CREDIT the response (citation tokens ground a claim, and
 *     a small global credit raises score);
 *   - empty / generic (no specific claim) input → neutral, non-flagging 'ok';
 *   - claim-bearing but zero-context, zero-citation → 'ungrounded' (the R6 case);
 *   - salience: numbers/versions, proper nouns, code identifiers, camelCase are
 *     specifics; short filler is not;
 *   - bounded, deterministic, secret-safe, and TOTAL (hostile input never throws).
 *
 * Pure — loads under tsx (responseFaithfulnessCore has zero imports).
 */

import {
  assessFaithfulness,
  faithfulnessFlag,
  CLAIM_SUPPORT_THRESHOLD,
  FAITHFULNESS_OK_THRESHOLD,
  FAITHFULNESS_REVIEW_THRESHOLD,
  CITATION_CREDIT,
  type FaithfulnessSignal,
} from '../src/lib/responseFaithfulnessCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra !== undefined ? ` :: ${extra}` : ''}`); }
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = Object.is(actual, expected);
  if (ok) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg} :: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`); }
}
const FLAGS = new Set(['ok', 'review', 'ungrounded']);
function validShape(r: FaithfulnessSignal, msg: string): void {
  assert(r && typeof r === 'object', `${msg} :: is object`);
  assert(typeof r.score === 'number' && r.score >= 0 && r.score <= 1, `${msg} :: score in [0,1]`, String(r?.score));
  assert(typeof r.groundedRatio === 'number' && r.groundedRatio >= 0 && r.groundedRatio <= 1, `${msg} :: groundedRatio in [0,1]`, String(r?.groundedRatio));
  assert(Array.isArray(r.unsupportedClaims), `${msg} :: unsupportedClaims is array`);
  assert(FLAGS.has(r.flag), `${msg} :: flag in set`, r?.flag);
}
function includesSub(arr: string[], sub: string): boolean {
  return arr.some((s) => s.toLowerCase().includes(sub.toLowerCase()));
}

// Shared context describing a real deployment; reused across grounded tests.
const NETLIFY_CTX = 'Our deployment runs on Netlify. The web app is served at port 8081. Supabase provides Postgres and auth for the circle.';

function main(): void {
  // ─── (1) fully grounded → score high, flag ok, no unsupported claims ───────
  {
    const r = assessFaithfulness({
      responseText: 'The deployment runs on Netlify at port 8081. Supabase provides Postgres and auth.',
      contextText: NETLIFY_CTX,
    });
    validShape(r, '(1) grounded shape');
    assert(r.score >= 0.9, '(1) grounded score is high', String(r.score));
    assertEq(r.flag, 'ok', '(1) grounded flag ok');
    assertEq(r.groundedRatio, 1, '(1) grounded ratio 1');
    assertEq(r.unsupportedClaims.length, 0, '(1) no unsupported claims');
  }

  // ─── (2) invented specifics, NO citation → low score, ungrounded ──────────
  const invented = 'The deployment runs on Vercel at port 9999 using MongoDB.';
  let uncitedInvented: FaithfulnessSignal;
  {
    const r = assessFaithfulness({ responseText: invented, contextText: NETLIFY_CTX });
    uncitedInvented = r;
    validShape(r, '(2) invented shape');
    assert(r.score <= FAITHFULNESS_REVIEW_THRESHOLD, '(2) invented score low', String(r.score));
    assertEq(r.flag, 'ungrounded', '(2) invented flag ungrounded');
    assertEq(r.groundedRatio, 0, '(2) invented ratio 0');
    assertEq(r.unsupportedClaims.length, 1, '(2) one unsupported claim');
    assert(includesSub(r.unsupportedClaims, 'Vercel'), '(2) unsupported claim quotes the invented specific', JSON.stringify(r.unsupportedClaims));
  }

  // ─── (3) partial (multi-claim) → review, ratio 0.5 ────────────────────────
  let partialUncited: FaithfulnessSignal;
  {
    const r = assessFaithfulness({
      responseText: 'The deployment runs on Netlify at port 8081. It also uses Vercel and MongoDB on port 9999.',
      contextText: NETLIFY_CTX,
    });
    partialUncited = r;
    validShape(r, '(3) partial shape');
    assertEq(r.groundedRatio, 0.5, '(3) partial ratio 0.5');
    assertEq(r.score, 0.5, '(3) partial score 0.5 (no citation credit)');
    assertEq(r.flag, 'review', '(3) partial flag review');
    assertEq(r.unsupportedClaims.length, 1, '(3) one unsupported claim (2nd sentence)');
    assert(includesSub(r.unsupportedClaims, 'Vercel'), '(3) unsupported sentence is the invented one', JSON.stringify(r.unsupportedClaims));
  }

  // ─── (4) citations CREDIT the response ────────────────────────────────────
  {
    // 4a: citation tokens directly ground the otherwise-invented claim.
    const r = assessFaithfulness({
      responseText: invented,
      contextText: NETLIFY_CTX,
      citations: ['Vercel deployment guide', 'port 9999 config', 'MongoDB Atlas cluster'],
    });
    validShape(r, '(4a) cited shape');
    assertEq(r.groundedRatio, 1, '(4a) citation tokens ground the claim → ratio 1');
    assertEq(r.flag, 'ok', '(4a) cited flag ok');
    assertEq(r.unsupportedClaims.length, 0, '(4a) cited → no unsupported claims');
    assert(r.score > uncitedInvented.score, '(4a) citing raises score vs the same uncited response', `${r.score} > ${uncitedInvented.score}`);
  }
  {
    // 4b: global credit path — citations present but do NOT add the missing
    // tokens, so ratio is unchanged yet score rises by CITATION_CREDIT.
    const r = assessFaithfulness({
      responseText: 'The deployment runs on Netlify at port 8081. It also uses Vercel and MongoDB on port 9999.',
      contextText: NETLIFY_CTX,
      citations: ['see the changelog notes'],
    });
    validShape(r, '(4b) global-credit shape');
    assertEq(r.groundedRatio, 0.5, '(4b) ratio unchanged (citation tokens irrelevant)');
    assertEq(r.score, 0.6, '(4b) score = ratio + citation credit');
    assert(r.score > partialUncited.score, '(4b) citation credit raises score vs uncited partial', `${r.score} > ${partialUncited.score}`);
    assertEq(r.flag, 'review', '(4b) still review');
  }
  {
    // 4c: a bare string citation also credits (string is tokenized).
    const r = assessFaithfulness({ responseText: invented, contextText: NETLIFY_CTX, citations: 'Vercel 9999 MongoDB source' });
    assertEq(r.flag, 'ok', '(4c) string citation grounds the claim');
    assert(r.score > uncitedInvented.score, '(4c) string citation raises score', `${r.score} > ${uncitedInvented.score}`);
  }

  // ─── (5) empty / generic → neutral, non-flagging ok ───────────────────────
  {
    const empties: Array<[string, FaithfulnessSignal]> = [
      ['empty response', assessFaithfulness({ responseText: '', contextText: NETLIFY_CTX })],
      ['empty everything', assessFaithfulness({})],
      ['generic fluff', assessFaithfulness({ responseText: 'Sure, I can help with that. Let me know what you need.', contextText: '' })],
      ['whitespace only', assessFaithfulness({ responseText: '   \n\t  ', contextText: 'x' })],
    ];
    for (const [label, r] of empties) {
      validShape(r, `(5) ${label} shape`);
      assertEq(r.score, 1, `(5) ${label} → score 1`);
      assertEq(r.groundedRatio, 1, `(5) ${label} → ratio 1`);
      assertEq(r.flag, 'ok', `(5) ${label} → flag ok`);
      assertEq(r.unsupportedClaims.length, 0, `(5) ${label} → no claims`);
    }
  }

  // ─── (6) R6 core: claim-bearing but zero context/citation → ungrounded ────
  const dbClaim = 'The migration ran on Postgres and updated 42 rows in the circle_members table.';
  {
    const r = assessFaithfulness({ responseText: dbClaim, contextText: '' });
    validShape(r, '(6) no-context shape');
    assertEq(r.flag, 'ungrounded', '(6) specific claim + no evidence → ungrounded');
    assertEq(r.groundedRatio, 0, '(6) ratio 0');
    assertEq(r.score, 0, '(6) score 0');
    assertEq(r.unsupportedClaims.length, 1, '(6) claim surfaced');
    assert(includesSub(r.unsupportedClaims, 'circle_members'), '(6) code identifier preserved in claim', JSON.stringify(r.unsupportedClaims));
  }
  {
    // Same claim, now grounded by context → flips to ok.
    const r = assessFaithfulness({
      responseText: dbClaim,
      contextText: 'The migration ran on Postgres and updated 42 rows in the circle_members table successfully.',
    });
    assertEq(r.flag, 'ok', '(6) same claim with matching context → ok');
    assertEq(r.groundedRatio, 1, '(6) grounded ratio 1 when context matches');
    assertEq(r.unsupportedClaims.length, 0, '(6) no unsupported claims when grounded');
  }

  // ─── (7) salience: which tokens make a sentence a checkable claim ──────────
  {
    // 7a number is a specific; grounded when the number is in context.
    assertEq(assessFaithfulness({ responseText: 'The value is 8081.', contextText: 'the value is 8081' }).flag, 'ok', '(7a) number grounded → ok');
    const rNum = assessFaithfulness({ responseText: 'The value is 8081.', contextText: '' });
    assertEq(rNum.flag, 'ungrounded', '(7a) number ungrounded when absent');
    assertEq(rNum.unsupportedClaims.length, 1, '(7a) number sentence is a claim');
  }
  {
    // 7b proper noun mid-sentence is a specific.
    const r = assessFaithfulness({ responseText: 'We use Cloudflare.', contextText: 'netlify only' });
    assertEq(r.unsupportedClaims.length, 1, '(7b) proper noun makes it a claim');
    assertEq(r.flag, 'ungrounded', '(7b) unknown proper noun → ungrounded');
    assertEq(assessFaithfulness({ responseText: 'We use Cloudflare.', contextText: 'we run on cloudflare cdn' }).flag, 'ok', '(7b) proper noun grounded → ok');
  }
  {
    // 7c code path identifier is a specific.
    const r = assessFaithfulness({ responseText: 'Edit src/lib/foo.ts now.', contextText: '' });
    assertEq(r.unsupportedClaims.length, 1, '(7c) code path makes it a claim');
    assertEq(assessFaithfulness({ responseText: 'Edit src/lib/foo.ts now.', contextText: 'the file src/lib/foo.ts exists' }).flag, 'ok', '(7c) code path grounded → ok');
  }
  {
    // 7d camelCase identifier is a specific.
    const r = assessFaithfulness({ responseText: 'Call assessFaithfulness here.', contextText: '' });
    assertEq(r.unsupportedClaims.length, 1, '(7d) camelCase makes it a claim');
    assert(includesSub(r.unsupportedClaims, 'assessFaithfulness'), '(7d) camelCase token preserved', JSON.stringify(r.unsupportedClaims));
  }
  {
    // 7e pure fluff is NOT a claim (no specifics) → neutral even with no context.
    const r = assessFaithfulness({ responseText: 'I think it looks great!', contextText: '' });
    assertEq(r.flag, 'ok', '(7e) fluff → ok');
    assertEq(r.unsupportedClaims.length, 0, '(7e) fluff → no claims');
    assertEq(r.groundedRatio, 1, '(7e) fluff → ratio 1');
  }
  {
    // 7f fluff sentences are skipped; the one real claim decides the outcome.
    const r = assessFaithfulness({ responseText: 'Sure! The port is 8081.', contextText: 'port 8081 is open' });
    assertEq(r.flag, 'ok', '(7f) mixes fluff + grounded claim → ok');
    assertEq(r.groundedRatio, 1, '(7f) only the real claim is scored');
  }

  // ─── (8) faithfulnessFlag thresholds + exported constants ─────────────────
  {
    assertEq(faithfulnessFlag(1), 'ok', '(8) flag(1) ok');
    assertEq(faithfulnessFlag(FAITHFULNESS_OK_THRESHOLD), 'ok', '(8) flag(ok threshold) ok');
    assertEq(faithfulnessFlag(0.699), 'review', '(8) flag(just under ok) review');
    assertEq(faithfulnessFlag(FAITHFULNESS_REVIEW_THRESHOLD), 'review', '(8) flag(review threshold) review');
    assertEq(faithfulnessFlag(0.399), 'ungrounded', '(8) flag(just under review) ungrounded');
    assertEq(faithfulnessFlag(0), 'ungrounded', '(8) flag(0) ungrounded');
    assertEq(faithfulnessFlag(NaN), 'ungrounded', '(8) flag(NaN) → ungrounded (non-finite reads 0)');
    assertEq(CLAIM_SUPPORT_THRESHOLD, 0.5, '(8) CLAIM_SUPPORT_THRESHOLD');
    assertEq(FAITHFULNESS_OK_THRESHOLD, 0.7, '(8) OK threshold');
    assertEq(FAITHFULNESS_REVIEW_THRESHOLD, 0.4, '(8) REVIEW threshold');
    assertEq(CITATION_CREDIT, 0.1, '(8) CITATION_CREDIT');
  }

  // ─── (9) bounds / determinism / secret-safety ─────────────────────────────
  {
    // 9a deterministic: identical inputs → byte-identical result.
    const inp = { responseText: 'The Netlify build at port 8081 shipped v5.', contextText: NETLIFY_CTX };
    const a = assessFaithfulness(inp);
    const b = assessFaithfulness(inp);
    assertEq(JSON.stringify(a), JSON.stringify(b), '(9a) deterministic across calls');
  }
  {
    // 9b huge repeated input: bounded, deduped, never hangs/throws.
    const r = assessFaithfulness({ responseText: 'The Netlify port 9999 broke. '.repeat(20000), contextText: '' });
    validShape(r, '(9b) huge shape');
    assertEq(r.flag, 'ungrounded', '(9b) huge repeated invented → ungrounded');
    assertEq(r.unsupportedClaims.length, 1, '(9b) identical claims deduped to 1');
  }
  {
    // 9c secret redaction: a long hex run in an unsupported claim is redacted.
    const secret = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const r = assessFaithfulness({ responseText: `The key is ${secret} and it failed.`, contextText: '' });
    assertEq(r.unsupportedClaims.length, 1, '(9c) secret-bearing claim surfaced');
    assert(includesSub(r.unsupportedClaims, '[redacted]'), '(9c) long hex redacted', JSON.stringify(r.unsupportedClaims));
    assert(!includesSub(r.unsupportedClaims, secret), '(9c) raw secret never echoed', JSON.stringify(r.unsupportedClaims));
  }
  {
    // 9d claim clamp: an over-long single sentence is truncated with an ellipsis.
    const longSentence = `Xylophone 9999 ${'grape '.repeat(120)}end.`;
    const r = assessFaithfulness({ responseText: longSentence, contextText: '' });
    assertEq(r.unsupportedClaims.length, 1, '(9d) long claim surfaced');
    assert(r.unsupportedClaims[0].length <= 200, '(9d) claim clamped to <= 200 chars', String(r.unsupportedClaims[0].length));
    assert(r.unsupportedClaims[0].endsWith('…'), '(9d) clamp marks truncation with ellipsis', r.unsupportedClaims[0].slice(-3));
  }
  {
    // 9e MAX_UNSUPPORTED_CLAIMS bound: 20 distinct claims → capped at 12.
    const lines: string[] = [];
    for (let i = 0; i < 20; i += 1) lines.push(`Widget${i} failed at port ${9000 + i}.`);
    const r = assessFaithfulness({ responseText: lines.join('\n'), contextText: '' });
    assertEq(r.unsupportedClaims.length, 12, '(9e) unsupported claims capped at 12');
    assertEq(r.flag, 'ungrounded', '(9e) all invented → ungrounded');
    assertEq(r.groundedRatio, 0, '(9e) ratio 0 across 20 claims');
  }
  {
    // 9f context never echoed into the output (secret-safe): a context-only secret
    // does not leak, and grounded claims produce no claim strings at all.
    const r = assessFaithfulness({
      responseText: 'The token is 8081.',
      contextText: 'the token is 8081 and the api_secret is hunter2supersecretvalue',
    });
    assertEq(r.unsupportedClaims.length, 0, '(9f) grounded → nothing emitted');
    assert(!includesSub([JSON.stringify(r)], 'hunter2supersecretvalue'), '(9f) context secret never surfaces in signal', JSON.stringify(r));
  }

  // ─── (10) hostile / total no-throw ────────────────────────────────────────
  {
    const throwingInput: Record<string, unknown> = {};
    Object.defineProperty(throwingInput, 'responseText', { get() { throw new Error('boom'); }, enumerable: true });

    const throwingCite: Record<string, unknown> = {};
    Object.defineProperty(throwingCite, 'url', { get() { throw new Error('x'); }, enumerable: true });

    const cyclic: Record<string, unknown> = { title: 'Netlify' };
    cyclic.self = cyclic;

    const hostileCases: Array<[string, () => FaithfulnessSignal]> = [
      ['null input', () => assessFaithfulness(null)],
      ['undefined input', () => assessFaithfulness(undefined)],
      ['number input', () => assessFaithfulness(42 as unknown as null)],
      ['string input', () => assessFaithfulness('nope' as unknown as null)],
      ['boolean input', () => assessFaithfulness(true as unknown as null)],
      ['array input', () => assessFaithfulness([] as unknown as null)],
      ['responseText number', () => assessFaithfulness({ responseText: 123, contextText: 'x' })],
      ['responseText object', () => assessFaithfulness({ responseText: { a: 1 }, contextText: 'x' })],
      ['responseText array', () => assessFaithfulness({ responseText: ['a', 'b'] })],
      ['contextText number', () => assessFaithfulness({ responseText: 'The Vercel 9999 broke.', contextText: 99 })],
      ['citations number', () => assessFaithfulness({ responseText: 'The Vercel 9999 broke.', citations: 7 })],
      ['citations boolean', () => assessFaithfulness({ responseText: 'The Vercel 9999 broke.', citations: false })],
      ['citations junk array', () => assessFaithfulness({ responseText: 'x', citations: [null, undefined, 5, {}, [], 'ok'] })],
      ['citations throwing getter', () => assessFaithfulness({ responseText: 'The Vercel 9999 broke.', contextText: '', citations: [throwingCite] })],
      ['citations cyclic', () => assessFaithfulness({ responseText: 'x', citations: cyclic })],
      ['responseText throwing getter', () => assessFaithfulness(throwingInput)],
      ['symbol responseText', () => assessFaithfulness({ responseText: Symbol('s') as unknown as string })],
      ['huge context', () => assessFaithfulness({ responseText: 'The port is 8081.', contextText: 'x '.repeat(500000) })],
    ];

    let threw = false;
    const results: FaithfulnessSignal[] = [];
    for (const [label, fn] of hostileCases) {
      try {
        results.push(fn());
      } catch (e) {
        threw = true;
        failures += 1;
        console.error(`FAIL: (10) hostile "${label}" threw: ${(e as Error)?.message}`);
      }
    }
    assert(!threw, '(10) no hostile case throws');
    for (let i = 0; i < results.length; i += 1) validShape(results[i], `(10) hostile[${i}] valid shape`);

    // Specific hostile expectations.
    assertEq(assessFaithfulness(null).flag, 'ok', '(10) null → neutral ok');
    assertEq(assessFaithfulness(null).score, 1, '(10) null → score 1');
    assertEq(assessFaithfulness(throwingInput).flag, 'ok', '(10) throwing responseText → neutral ok');
    // A throwing citation getter is swallowed; the claim stays ungrounded.
    assertEq(assessFaithfulness({ responseText: 'The Vercel 9999 broke.', contextText: '', citations: [throwingCite] }).flag, 'ungrounded', '(10) throwing citation → still ungrounded, not thrown');
  }

  const total = passes + failures;
  console.log(`response-faithfulness-core smoke: ${passes} passed, ${failures} failed (of ${total})`);
  if (failures > 0) process.exit(1);
  console.log('response-faithfulness-core smoke: ALL PASS');
}

main();
