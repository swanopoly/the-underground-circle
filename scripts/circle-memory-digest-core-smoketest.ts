/**
 * Smoke test for src/lib/circleMemoryDigestCore.ts
 *
 * Run: npx tsx scripts/circle-memory-digest-core-smoketest.ts
 *
 * Verifies the pure multi-doc Circle Memory digest: up to 3 docs under ONE
 * shared budget (NOT per-doc), recency ordering, untrusted fencing, label
 * safety, budget clamps, and total no-throw behavior on hostile input.
 */
import {
  formatCircleMemoryDigest,
  selectMemoryDocsForBudget,
  type MemoryDoc,
} from '../src/lib/circleMemoryDigestCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function noThrow(fn: () => unknown, m: string): unknown {
  try {
    const v = fn();
    passes++;
    return v;
  } catch (err) {
    failures++;
    console.error('FAIL: ' + m + ' :: threw ' + String(err));
    return undefined;
  }
}

const OPEN = '<untrusted_quoted>';
const CLOSE = '</untrusted_quoted>';
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
const contentLen = (docs: MemoryDoc[]) =>
  docs.reduce((s, d) => s + (typeof d.content === 'string' ? d.content.length : 0), 0);

// Build a doc with a repeated-char body of a given length.
function doc(kind: string, len: number, ts?: string): Record<string, unknown> {
  return { doc_kind: kind, content: 'x'.repeat(len), updated_at: ts };
}

function main() {
  // ── Group 1: empty / falsy → '' and [] ────────────────────────────────────
  assertEq(formatCircleMemoryDigest(null), '', '1.1 null → ""');
  assertEq(formatCircleMemoryDigest(undefined), '', '1.2 undefined → ""');
  assertEq(formatCircleMemoryDigest({}), '', '1.3 {} → ""');
  assertEq(formatCircleMemoryDigest([]), '', '1.4 [] → ""');
  assertEq(formatCircleMemoryDigest(''), '', '1.5 "" → ""');
  assertEq(formatCircleMemoryDigest(0), '', '1.6 0 → ""');
  assertEq(formatCircleMemoryDigest(false), '', '1.7 false → ""');
  assertEq(
    formatCircleMemoryDigest({ brief: null, active_context: null, progress: null }),
    '',
    '1.8 all-null record → ""',
  );
  assert(Array.isArray(selectMemoryDocsForBudget(null, 1000)), '1.9 select null → array');
  assertEq(selectMemoryDocsForBudget(null, 1000).length, 0, '1.10 select null → []');
  assertEq(selectMemoryDocsForBudget({}, 1000).length, 0, '1.11 select {} → []');
  assertEq(
    formatCircleMemoryDigest([{ content: '   ' }, { content: '\n\t ' }]),
    '',
    '1.12 whitespace-only content → ""',
  );

  // ── Group 2: single doc → just it ─────────────────────────────────────────
  const one = [doc('brief', 300, '2026-01-01T00:00:00Z')];
  const sel1 = selectMemoryDocsForBudget(one, 1000);
  assertEq(sel1.length, 1, '2.1 one doc → 1 selected');
  assertEq((sel1[0].content as string).length, 300, '2.2 fits budget → full content');
  const dig1 = formatCircleMemoryDigest(one, { totalBudgetChars: 1000 });
  assert(dig1.includes('Brief'), '2.3 label present');
  assert(dig1.includes(OPEN) && dig1.includes(CLOSE), '2.4 fenced');
  assert(dig1.includes('x'.repeat(300)), '2.5 content present in full');
  assertEq(count(dig1, OPEN), 1, '2.6 exactly one fence open');
  assertEq(count(dig1, CLOSE), 1, '2.7 exactly one fence close');
  assert(!dig1.includes('Active Context') && !dig1.includes('Progress'), '2.8 no other labels');

  // Single doc from the getAllMemoryDocs record shape (one populated kind).
  const recOne = { brief: doc('brief', 120, '2026-01-01T00:00:00Z'), active_context: null, progress: null };
  const digRecOne = formatCircleMemoryDigest(recOne, { totalBudgetChars: 500 });
  assert(digRecOne.includes('Brief') && digRecOne.includes('x'.repeat(120)), '2.9 record w/ one populated doc renders');
  assertEq(count(digRecOne, OPEN), 1, '2.10 record-one → single fence');

  // ── Group 3: three docs share ONE budget (block doesn't triple) ───────────
  const three = {
    brief: doc('brief', 2000, '2026-01-01T00:00:00Z'),
    active_context: doc('active_context', 2000, '2026-02-01T00:00:00Z'),
    progress: doc('progress', 2000, '2026-03-01T00:00:00Z'),
  };
  const sel3 = selectMemoryDocsForBudget(three, 1000);
  assertEq(sel3.length, 3, '3.1 three docs → 3 selected');
  const sum3 = contentLen(sel3);
  assert(sum3 <= 1000, '3.2 Σ content ≤ budget (shared, not per-doc)', 'sum=' + sum3);
  assert(sum3 >= 900, '3.3 budget well-utilized across docs', 'sum=' + sum3);
  // Per-doc budgeting would give each min(2000,1000)=1000 → 3000 total.
  assert(sum3 < 3000, '3.4 NOT per-doc (would be 3000)', 'sum=' + sum3);
  for (const d of sel3) {
    assert((d.content as string).length < 2000, '3.5 each doc trimmed below its original 2000');
    const L = (d.content as string).length;
    assert(L >= 300 && L <= 400, '3.6 each doc ≈ budget/3', 'len=' + L);
  }
  const dig3 = formatCircleMemoryDigest(three, { totalBudgetChars: 1000 });
  assert(dig3.includes('Brief') && dig3.includes('Active Context') && dig3.includes('Progress'), '3.7 all 3 labels');
  assertEq(count(dig3, OPEN), 3, '3.8 three fences');
  assert(dig3.length <= 1000 + 600, '3.9 total block bounded near budget', 'len=' + dig3.length);
  const digSingleFull = formatCircleMemoryDigest([doc('brief', 2000)], { totalBudgetChars: 2000 });
  assert(dig3.length < digSingleFull.length, '3.10 3-doc block (1000) < single full doc (2000) — did not triple');

  // ── Group 4: budget split is shared, not per-doc (explicit) ───────────────
  const equalBig = [doc('brief', 5000, '2026-03-01Z'), doc('active_context', 5000, '2026-02-01Z'), doc('progress', 5000, '2026-01-01Z')];
  const selEq = selectMemoryDocsForBudget(equalBig, 900);
  assertEq(selEq.length, 3, '4.1 three big docs selected');
  assert(contentLen(selEq) <= 900, '4.2 Σ ≤ 900', 'sum=' + contentLen(selEq));
  assert(contentLen(selEq) >= 850, '4.3 near-full utilization', 'sum=' + contentLen(selEq));
  // Uneven: one tiny doc donates its slack to the big ones.
  const uneven = [doc('brief', 10, '2026-03-01Z'), doc('active_context', 5000, '2026-02-01Z'), doc('progress', 5000, '2026-01-01Z')];
  const selUn = selectMemoryDocsForBudget(uneven, 900);
  assert(contentLen(selUn) <= 900, '4.4 uneven Σ ≤ 900', 'sum=' + contentLen(selUn));
  const briefDoc = selUn.find((d) => d.doc_kind === 'brief');
  assertEq((briefDoc?.content as string).length, 10, '4.5 tiny doc kept whole (10)');
  const bigDoc = selUn.find((d) => d.doc_kind === 'active_context');
  assert((bigDoc?.content as string).length > 300, '4.6 big doc got donated slack (> even 300 share)', 'len=' + (bigDoc?.content as string).length);

  // ── Group 5: recency ordering (updated_at + last_edited_at fallback) ───────
  const recency = {
    brief: doc('brief', 100, '2026-01-01T00:00:00Z'), // oldest
    active_context: doc('active_context', 100, '2026-06-01T00:00:00Z'), // newest
    progress: doc('progress', 100, '2026-03-01T00:00:00Z'), // middle
  };
  const digR = formatCircleMemoryDigest(recency, { totalBudgetChars: 1000 });
  assert(digR.indexOf('Active Context') < digR.indexOf('Progress'), '5.1 newest (active) before middle (progress)');
  assert(digR.indexOf('Progress') < digR.indexOf('Brief'), '5.2 middle (progress) before oldest (brief)');
  const selR = selectMemoryDocsForBudget(recency, 1000);
  assertEq(selR[0].doc_kind, 'active_context', '5.3 first selected is newest');
  assertEq(selR[2].doc_kind, 'brief', '5.4 last selected is oldest');
  // last_edited_at (raw Supabase row) is honored when updated_at is absent.
  const rawRows = [
    { doc_kind: 'brief', content: 'A'.repeat(100), last_edited_at: '2026-01-01T00:00:00Z' },
    { doc_kind: 'progress', content: 'B'.repeat(100), last_edited_at: '2026-09-01T00:00:00Z' },
  ];
  const selRaw = selectMemoryDocsForBudget(rawRows, 1000);
  assertEq(selRaw[0].doc_kind, 'progress', '5.5 last_edited_at drives recency (progress newest)');
  // Numeric epoch timestamps also work.
  const epochRows = [
    { doc_kind: 'brief', content: 'A'.repeat(50), updated_at: 1000 },
    { doc_kind: 'progress', content: 'B'.repeat(50), updated_at: 9_000_000_000_000 },
  ];
  assertEq(selectMemoryDocsForBudget(epochRows, 1000)[0].doc_kind, 'progress', '5.6 numeric ts recency');
  // Missing timestamps → stable input order preserved.
  const noTs = [doc('brief', 50), doc('active_context', 50), doc('progress', 50)];
  const selNoTs = selectMemoryDocsForBudget(noTs, 1000);
  assertEq(selNoTs[0].doc_kind, 'brief', '5.7 no ts → stable order [0]');
  assertEq(selNoTs[2].doc_kind, 'progress', '5.8 no ts → stable order [2]');

  // ── Group 6: array shape == record shape ──────────────────────────────────
  const asArray = [three.brief, three.active_context, three.progress];
  const digArr = formatCircleMemoryDigest(asArray, { totalBudgetChars: 1000 });
  const digRec = formatCircleMemoryDigest(three, { totalBudgetChars: 1000 });
  assertEq(digArr, digRec, '6.1 array & record inputs produce identical digest');
  // Record with a null hole → 2 docs.
  const hole = { brief: doc('brief', 100, '2026-01-01Z'), active_context: null, progress: doc('progress', 100, '2026-02-01Z') };
  assertEq(selectMemoryDocsForBudget(hole, 1000).length, 2, '6.2 null hole skipped → 2 docs');

  // ── Group 7: budget clamps & thinning ─────────────────────────────────────
  assertEq(selectMemoryDocsForBudget(one, 0).length, 0, '7.1 budget 0 → []');
  assertEq(formatCircleMemoryDigest(one, { totalBudgetChars: 0 }), '', '7.2 budget 0 → ""');
  // Negative / NaN / Infinity → default 1000.
  assertEq((selectMemoryDocsForBudget([doc('brief', 2000)], -5)[0].content as string).length, 1000, '7.3 negative budget → default 1000');
  assertEq((selectMemoryDocsForBudget([doc('brief', 2000)], NaN)[0].content as string).length, 1000, '7.4 NaN budget → default 1000');
  assertEq((selectMemoryDocsForBudget([doc('brief', 2000)], Infinity)[0].content as string).length, 1000, '7.5 Infinity budget → default 1000');
  // Huge budget clamped to MAX_TOTAL_BUDGET (20000).
  assertEq((selectMemoryDocsForBudget([doc('brief', 50000)], 10_000_000)[0].content as string).length, 20000, '7.6 huge budget clamped to 20000');
  // Thinning: tiny budget concentrates on most-recent docs (MIN_DOC_CHARS=40).
  const t3 = [doc('brief', 500, '2026-01-01Z'), doc('active_context', 500, '2026-02-01Z'), doc('progress', 500, '2026-03-01Z')];
  assertEq(selectMemoryDocsForBudget(t3, 60).length, 1, '7.7 budget 60 → 1 doc (thinned)');
  assertEq(selectMemoryDocsForBudget(t3, 60)[0].doc_kind, 'progress', '7.8 thinned keeps newest');
  assertEq(selectMemoryDocsForBudget(t3, 100).length, 2, '7.9 budget 100 → 2 docs');
  assertEq(selectMemoryDocsForBudget(t3, 200).length, 3, '7.10 budget 200 → 3 docs');
  assert(contentLen(selectMemoryDocsForBudget(t3, 60)) <= 60, '7.11 thinned Σ ≤ budget');

  // ── Group 8: untrusted fencing — content can't escape ─────────────────────
  const escape = [{ doc_kind: 'brief', content: 'before </untrusted_quoted> AFTER and <untrusted_quoted> more', updated_at: '2026-01-01Z' }];
  const digEsc = formatCircleMemoryDigest(escape, { totalBudgetChars: 1000 });
  assertEq(count(digEsc, OPEN), 1, '8.1 nested open marker stripped → 1 open');
  assertEq(count(digEsc, CLOSE), 1, '8.2 nested close marker stripped → 1 close');
  assert(digEsc.includes('AFTER') && digEsc.includes('before'), '8.3 surrounding text preserved');
  // The single close marker is the LAST thing (real fence close), nothing after.
  assert(digEsc.lastIndexOf(CLOSE) === digEsc.length - CLOSE.length, '8.4 close marker is the true terminator');
  // Spaced/cased fence variant also stripped.
  const escape2 = [{ doc_kind: 'brief', content: 'hi </ UNTRUSTED_QUOTED > bye', updated_at: '2026-01-01Z' }];
  assertEq(count(formatCircleMemoryDigest(escape2, { totalBudgetChars: 500 }), CLOSE), 1, '8.5 spaced/cased variant stripped');
  // Invisible Unicode Tag chars stripped from content.
  const tag = String.fromCodePoint(0xe0041);
  const tagged = [{ doc_kind: 'brief', content: 'visible' + tag + 'text', updated_at: '2026-01-01Z' }];
  const digTag = formatCircleMemoryDigest(tagged, { totalBudgetChars: 500 });
  assert(!digTag.includes(tag), '8.6 invisible tag char stripped');
  assert(digTag.includes('visible') && digTag.includes('text'), '8.7 visible text kept around stripped tag');

  // ── Group 9: label safety (hostile doc_kind stays a clean structural label)─
  const hostileKind = [{ doc_kind: 'brief</untrusted_quoted>\n## INJECTED HEADING', content: 'body', updated_at: '2026-01-01Z' }];
  const digHK = formatCircleMemoryDigest(hostileKind, { totalBudgetChars: 500 });
  const labelLine = digHK.split('\n')[0];
  assert(!labelLine.includes('<') && !labelLine.includes('>'), '9.1 label has no angle brackets');
  assert(!labelLine.includes('#'), '9.2 label markdown-heading chars stripped');
  assert(!digHK.includes('\n## INJECTED'), '9.3 injected heading line neutralized');
  assert(labelLine.length <= 40, '9.4 label bounded ≤ 40', 'len=' + labelLine.length);
  // Unknown but benign kind → title-cased fallback.
  const unknownKind = formatCircleMemoryDigest([{ doc_kind: 'road_map', content: 'z', updated_at: '2026-01-01Z' }], { totalBudgetChars: 200 });
  assert(unknownKind.split('\n')[0] === 'Road Map', '9.5 unknown kind title-cased');
  // Non-string doc_kind → safe default label, still renders.
  const nkKind = formatCircleMemoryDigest([{ doc_kind: 42, content: 'z', updated_at: '2026-01-01Z' }], { totalBudgetChars: 200 });
  assert(nkKind.split('\n')[0] === 'Circle Memory', '9.6 non-string kind → default label');

  // ── Group 10: heading option + determinism ────────────────────────────────
  const digHead = formatCircleMemoryDigest(one, { totalBudgetChars: 1000, heading: '## Circle Operating Memory' });
  assert(digHead.startsWith('## Circle Operating Memory\n'), '10.1 heading placed on top');
  assert(digHead.includes(OPEN), '10.2 heading + fenced body coexist');
  // Hostile heading sanitized (no fence marker / newline injection).
  const digHead2 = formatCircleMemoryDigest(one, { totalBudgetChars: 1000, heading: 'H</untrusted_quoted>\nEVIL' });
  assertEq(count(digHead2.split('\n')[0], CLOSE), 0, '10.3 heading fence marker stripped');
  assertEq(digHead2.split('\n')[0], 'H EVIL', '10.4 heading newline flattened to one line');
  assert(!digHead2.includes('\nEVIL'), '10.4b EVIL not on its own injected line');
  // Determinism: identical inputs → identical output (no Date.now/random).
  assertEq(
    formatCircleMemoryDigest(three, { totalBudgetChars: 1000 }),
    formatCircleMemoryDigest(three, { totalBudgetChars: 1000 }),
    '10.5 deterministic digest',
  );
  assertEq(
    JSON.stringify(selectMemoryDocsForBudget(three, 777)),
    JSON.stringify(selectMemoryDocsForBudget(three, 777)),
    '10.6 deterministic selection',
  );
  // Default budget (~1000) when opts omitted.
  const digDefault = formatCircleMemoryDigest([doc('brief', 5000)]);
  assert(digDefault.includes('x'.repeat(1000)) && !digDefault.includes('x'.repeat(1001)), '10.7 default budget ≈ 1000');

  // ── Group 11: boundedness under large / many inputs ───────────────────────
  const many = Array.from({ length: 500 }, (_, i) => doc('brief', 3000, '2026-01-' + String((i % 27) + 1).padStart(2, '0') + 'Z'));
  const digMany = noThrow(() => formatCircleMemoryDigest(many, { totalBudgetChars: 1000 }), '11.1 500 huge docs no-throw') as string;
  assert(typeof digMany === 'string', '11.2 many-docs result is string');
  assert(digMany.length <= 1000 + 600, '11.3 many-docs block still bounded', 'len=' + digMany.length);
  assertEq(count(digMany, OPEN), 3, '11.4 at most 3 docs rendered from 500');
  const selMany = selectMemoryDocsForBudget(many, 1000);
  assert(selMany.length <= 3, '11.5 select caps at 3 docs');
  assert(contentLen(selMany) <= 1000, '11.6 Σ content ≤ budget even w/ 500 inputs');

  // ── Group 12: hostile / degenerate inputs → no throw, safe type ───────────
  const cyc: any = { doc_kind: 'brief', content: 'ok', updated_at: '2026-01-01Z' };
  cyc.self = cyc; // cyclic
  const cycContent: any = { doc_kind: 'brief', updated_at: '2026-01-01Z' };
  cycContent.content = cycContent; // content is a cyclic object (wrong type)
  const hostile: unknown[] = [
    42,
    'a string',
    true,
    NaN,
    Infinity,
    -Infinity,
    () => 'fn',
    Symbol('s'),
    [1, 2, 3],
    [null, undefined, 42, 'x', {}],
    { content: 123 }, // wrong-type content
    { content: { nested: true } }, // object content
    { content: [1, 2, 3] }, // array content
    { content: null }, // null content
    { doc_kind: 'brief' }, // no content
    cyc, // cyclic doc
    cycContent, // cyclic wrong-type content
    { brief: 'not-an-object', active_context: 5 }, // record of junk
    new Date(), // exotic object
  ];
  for (let i = 0; i < hostile.length; i++) {
    const h = hostile[i];
    const r = noThrow(() => formatCircleMemoryDigest(h, { totalBudgetChars: 1000 }), '12.f.' + i + ' format no-throw');
    assert(typeof r === 'string', '12.fs.' + i + ' format → string');
    const s = noThrow(() => selectMemoryDocsForBudget(h, 1000), '12.s.' + i + ' select no-throw');
    assert(Array.isArray(s), '12.ss.' + i + ' select → array');
  }
  // Hostile budgets on a valid doc.
  const badBudgets: unknown[] = [NaN, Infinity, -1, '100', null, undefined, {}, [], true];
  for (let i = 0; i < badBudgets.length; i++) {
    const b = badBudgets[i] as number;
    const r = noThrow(() => formatCircleMemoryDigest(one, { totalBudgetChars: b }), '12.b.' + i + ' bad budget no-throw');
    assert(typeof r === 'string', '12.bs.' + i + ' bad budget → string');
  }
  // Hostile opts container itself.
  assert(typeof (noThrow(() => formatCircleMemoryDigest(one, null as any), '12.o.1 null opts no-throw')) === 'string', '12.o.1s null opts → string');
  assert(typeof (noThrow(() => formatCircleMemoryDigest(one, 42 as any), '12.o.2 numeric opts no-throw')) === 'string', '12.o.2s numeric opts → string');
  // Doc with an enormous single content string is bounded.
  const giant = noThrow(() => formatCircleMemoryDigest([doc('brief', 5_000_00)], { totalBudgetChars: 1000 }), '12.g.1 giant content no-throw') as string;
  assert(typeof giant === 'string' && giant.length <= 1000 + 600, '12.g.2 giant content bounded');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll circleMemoryDigestCore smoke cases passed (' + passes + ' passed).');
}
main();
