/**
 * tool-result-dedup-core-smoketest — the PURE token-saving tool-result dedup
 * core (src/lib/toolResultDedupCore.ts). Load-bearing assertions:
 *
 *   computeToolResultKey: stable two-part digest; object-key order does not
 *   change the key; same args + DIFFERENT content → same argsKey, different
 *   contentHash; DIFFERENT args → different argsKey; DIFFERENT tool → different
 *   argsKey; secret-safe (no raw secret in either digest); bounded (huge
 *   content → short digest; differing lengths never collide via the prefix).
 *
 *   planToolResultDedup: a repeated identical (tool, args, content) → duplicate
 *   + referToIndex = the earlier result's firstIndex; different args → not
 *   duplicate; same args + different content → not duplicate; different tool →
 *   not duplicate; empty priors → not duplicate; accepts a raw
 *   {toolName,args,content} AND a pre-hashed {toolName,argsKey,contentHash}
 *   next; skips junk priors; fails OPEN on indeterminate input.
 *
 *   buildToolResultRef / formatDedupReferenceText: correct ref + compact,
 *   secret-safe reference text carrying only tool name + index.
 *
 *   And: every export is total — degenerate / hostile / cyclic input never
 *   throws.
 *
 * Pure — loads under tsx (toolResultDedupCore has zero imports).
 */

import {
  computeToolResultKey,
  planToolResultDedup,
  buildToolResultRef,
  formatDedupReferenceText,
  TOOL_RESULT_ARGS_HASH_MAX_CHARS,
  TOOL_RESULT_CONTENT_HASH_MAX_CHARS,
  DEDUP_MAX_PRIOR_SCAN,
  DEDUP_TOOL_NAME_MAX_CHARS,
  type ToolResultRef,
} from '../src/lib/toolResultDedupCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Build a ref inline (mirrors what the loop stores for a fresh result). */
function ref(toolName: unknown, args: unknown, content: unknown, index: number): ToolResultRef {
  return buildToolResultRef({ toolName, args, content, index });
}

function main(): void {
  // ─── (1) computeToolResultKey — shape, determinism, stability ─────────────
  const k1 = computeToolResultKey({ toolName: 'read_file', args: { path: '/a' }, content: 'hello' });
  assertEq(typeof k1.argsKey, 'string', '(1) argsKey is a string');
  assertEq(typeof k1.contentHash, 'string', '(1) contentHash is a string');
  assert(k1.argsKey.length > 0 && k1.contentHash.length > 0, '(1) both digests non-empty');
  const k1b = computeToolResultKey({ toolName: 'read_file', args: { path: '/a' }, content: 'hello' });
  assertEq(k1.argsKey, k1b.argsKey, '(1) argsKey deterministic (same input → same key)');
  assertEq(k1.contentHash, k1b.contentHash, '(1) contentHash deterministic');
  // Digests are short/bounded (length-prefix + FNV), not the raw payload.
  assert(k1.argsKey.length < 40, '(1) argsKey is short/bounded');
  assert(k1.contentHash.length < 40, '(1) contentHash is short/bounded');

  // ─── (2) argsKey stability — object key order is irrelevant ───────────────
  const kOrderA = computeToolResultKey({ toolName: 't', args: { a: 1, b: 2, c: 3 }, content: 'x' });
  const kOrderB = computeToolResultKey({ toolName: 't', args: { c: 3, b: 2, a: 1 }, content: 'x' });
  assertEq(kOrderA.argsKey, kOrderB.argsKey, '(2) reordered arg keys → identical argsKey');
  assertEq(kOrderA.contentHash, kOrderB.contentHash, '(2) same content → identical contentHash');
  // Nested key order too.
  const kNestA = computeToolResultKey({ toolName: 't', args: { o: { x: 1, y: 2 } }, content: 'x' });
  const kNestB = computeToolResultKey({ toolName: 't', args: { o: { y: 2, x: 1 } }, content: 'x' });
  assertEq(kNestA.argsKey, kNestB.argsKey, '(2) nested reordered keys → identical argsKey');

  // ─── (3) content sensitivity — same call, output changed → NOT identical ──
  const same1 = computeToolResultKey({ toolName: 'ls', args: { dir: '/' }, content: 'A' });
  const same2 = computeToolResultKey({ toolName: 'ls', args: { dir: '/' }, content: 'B' });
  assertEq(same1.argsKey, same2.argsKey, '(3) identical (tool,args) → identical argsKey');
  assert(same1.contentHash !== same2.contentHash, '(3) content "A" vs "B" → different contentHash');
  // A change deep in a long body is caught (full-content hash, not a prefix).
  const long = 'x'.repeat(5000);
  const deepA = computeToolResultKey({ toolName: 'ls', args: {}, content: `${long}END-A` });
  const deepB = computeToolResultKey({ toolName: 'ls', args: {}, content: `${long}END-B` });
  assert(deepA.contentHash !== deepB.contentHash, '(3) change near the tail of a long body → different contentHash');

  // ─── (4) args sensitivity — different args → different argsKey ────────────
  const argA = computeToolResultKey({ toolName: 'ls', args: { dir: '/a' }, content: 'same' });
  const argB = computeToolResultKey({ toolName: 'ls', args: { dir: '/b' }, content: 'same' });
  assert(argA.argsKey !== argB.argsKey, '(4) different args → different argsKey');
  assertEq(argA.contentHash, argB.contentHash, '(4) identical content → identical contentHash');
  // Empty/absent args differ from populated args.
  const argEmpty = computeToolResultKey({ toolName: 'ls', args: {}, content: 'same' });
  assert(argEmpty.argsKey !== argA.argsKey, '(4) empty args ≠ populated args');

  // ─── (5) tool sensitivity — different tool → different argsKey ────────────
  const toolA = computeToolResultKey({ toolName: 'read_file', args: { path: '/x' }, content: 'same' });
  const toolB = computeToolResultKey({ toolName: 'write_file', args: { path: '/x' }, content: 'same' });
  assert(toolA.argsKey !== toolB.argsKey, '(5) same args, different tool → different argsKey (tool folded in)');
  assertEq(toolA.contentHash, toolB.contentHash, '(5) identical content → identical contentHash across tools');

  // ─── (6) secret-safe key — no raw secret leaks into either digest ─────────
  const SECRET = 'sk-live-SUPERSECRET-DEADBEEF-0xCAFE';
  const sec = computeToolResultKey({
    toolName: 'vault.read',
    args: { token: SECRET },
    content: `the value is ${SECRET} and more ${SECRET}`,
  });
  assert(!sec.argsKey.includes('SUPERSECRET'), '(6) argsKey does not contain the raw secret');
  assert(!sec.contentHash.includes('SUPERSECRET'), '(6) contentHash does not contain the raw secret');
  assert(!sec.argsKey.includes(SECRET) && !sec.contentHash.includes(SECRET), '(6) neither digest contains the full secret');
  // The dedup reason / reference text must not carry the secret either.
  const secRef = ref('vault.read', { token: SECRET }, `the value is ${SECRET}`, 0);
  const secPlan = planToolResultDedup([secRef], { toolName: 'vault.read', args: { token: SECRET }, content: `the value is ${SECRET}` });
  assert(secPlan.duplicate, '(6) secret result still deduped correctly');
  assert(!secPlan.reason.includes('SUPERSECRET'), '(6) dedup reason does not leak the secret');
  assert(!formatDedupReferenceText(0, 'vault.read').includes('SUPERSECRET'), '(6) reference text carries no payload');

  // ─── (7) bounded — huge content, length-prefix distinguishes lengths ──────
  const huge = 'z'.repeat(TOOL_RESULT_CONTENT_HASH_MAX_CHARS + 50_000);
  const kHuge = computeToolResultKey({ toolName: 't', args: {}, content: huge });
  assert(kHuge.contentHash.length < 40, '(7) huge content still yields a short bounded contentHash');
  // Two huge bodies differing only in LENGTH must not collide (length prefix).
  const kHuge2 = computeToolResultKey({ toolName: 't', args: {}, content: `${huge}z` });
  assert(kHuge.contentHash !== kHuge2.contentHash, '(7) differing content length → different contentHash (prefix)');
  // A giant args blob is also bounded and stable.
  const bigArgs = { blob: 'q'.repeat(TOOL_RESULT_ARGS_HASH_MAX_CHARS + 1000) };
  const kBigArgs = computeToolResultKey({ toolName: 't', args: bigArgs, content: 'x' });
  assert(kBigArgs.argsKey.length < 40, '(7) giant args → short bounded argsKey');
  assertEq(kBigArgs.argsKey, computeToolResultKey({ toolName: 't', args: bigArgs, content: 'x' }).argsKey, '(7) giant-args key is deterministic');

  // ─── (8) planToolResultDedup — repeated identical → duplicate + index ─────
  const priors8: ToolResultRef[] = [
    ref('ls', { dir: '/' }, '[a, b, c]', 0),
    ref('read_file', { path: '/x' }, 'contents', 1),
  ];
  const dupPlan = planToolResultDedup(priors8, { toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]' });
  assertEq(dupPlan.duplicate, true, '(8) exact repeat → duplicate:true');
  assertEq(dupPlan.referToIndex, 0, '(8) referToIndex points to the earlier result firstIndex');
  assert(dupPlan.reason.includes('#0'), '(8) reason names the referenced index');
  assert(dupPlan.reason.includes('ls'), '(8) reason names the tool');
  // Reordered args still dedupe (canonical argsKey).
  const dupReorder = planToolResultDedup(priors8, { toolName: 'read_file', args: { path: '/x' }, content: 'contents' });
  assertEq(dupReorder.duplicate, true, '(8) second prior also matches');
  assertEq(dupReorder.referToIndex, 1, '(8) matches the correct prior index');

  // ─── (9) different args → NOT duplicate ───────────────────────────────────
  const diffArgs = planToolResultDedup(priors8, { toolName: 'ls', args: { dir: '/other' }, content: '[a, b, c]' });
  assertEq(diffArgs.duplicate, false, '(9) same tool+content but different args → not duplicate');
  assertEq(diffArgs.referToIndex, null, '(9) referToIndex null when not duplicate');
  assert(diffArgs.reason.includes('new result'), '(9) reason says new result');

  // ─── (10) same args, different content → NOT duplicate (content changed) ──
  const diffContent = planToolResultDedup(priors8, { toolName: 'ls', args: { dir: '/' }, content: '[a, b, c, d]' });
  assertEq(diffContent.duplicate, false, '(10) identical call but changed output → not duplicate');
  assertEq(diffContent.referToIndex, null, '(10) referToIndex null when output differs');

  // ─── (11) different tool → NOT duplicate ──────────────────────────────────
  const diffTool = planToolResultDedup(priors8, { toolName: 'stat', args: { dir: '/' }, content: '[a, b, c]' });
  assertEq(diffTool.duplicate, false, '(11) different tool, same args+content → not duplicate');
  // Empty priors → never duplicate.
  const emptyPlan = planToolResultDedup([], { toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]' });
  assertEq(emptyPlan.duplicate, false, '(11) empty priors → not duplicate');
  assertEq(emptyPlan.referToIndex, null, '(11) empty priors → referToIndex null');

  // ─── (12) next accepts a PRE-HASHED ref-like candidate ────────────────────
  const key12 = computeToolResultKey({ toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]' });
  const preHashedPlan = planToolResultDedup(priors8, {
    toolName: 'ls',
    argsKey: key12.argsKey,
    contentHash: key12.contentHash,
  });
  assertEq(preHashedPlan.duplicate, true, '(12) pre-hashed next matches the same prior');
  assertEq(preHashedPlan.referToIndex, 0, '(12) pre-hashed next resolves the same index');
  // Raw and pre-hashed candidates agree.
  const rawPlan = planToolResultDedup(priors8, { toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]' });
  assertEq(rawPlan.duplicate, preHashedPlan.duplicate, '(12) raw and pre-hashed next agree on duplicate');

  // ─── (13) junk priors skipped; correct match still found ──────────────────
  const messyPriors = [
    null,
    42,
    'nope',
    {},
    { argsKey: 'x' }, // missing contentHash
    { argsKey: 'x', contentHash: 'y' }, // missing/invalid firstIndex → skipped
    { argsKey: 'x', contentHash: 'y', firstIndex: -1 }, // negative → skipped
    ref('ls', { dir: '/' }, '[a, b, c]', 7), // the real match
  ];
  const messyPlan = planToolResultDedup(messyPriors, { toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]' });
  assertEq(messyPlan.duplicate, true, '(13) valid match found amid junk priors');
  assertEq(messyPlan.referToIndex, 7, '(13) referToIndex is the valid ref firstIndex');
  // A ref whose firstIndex is invalid cannot be a reference target.
  const badIndexOnly = planToolResultDedup(
    [{ argsKey: key12.argsKey, contentHash: key12.contentHash, toolName: 'ls', firstIndex: NaN }],
    { toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]' },
  );
  assertEq(badIndexOnly.duplicate, false, '(13) ref with NaN firstIndex is skipped (not a target)');

  // ─── (14) buildToolResultRef + formatDedupReferenceText ───────────────────
  const built = buildToolResultRef({ toolName: 'ls', args: { dir: '/' }, content: '[a, b, c]', index: 3 });
  assertEq(built.firstIndex, 3, '(14) buildToolResultRef stamps the index');
  assertEq(built.argsKey, key12.argsKey, '(14) built ref argsKey matches computeToolResultKey');
  assertEq(built.contentHash, key12.contentHash, '(14) built ref contentHash matches computeToolResultKey');
  assertEq(built.toolName, 'ls', '(14) built ref carries the tool name');
  // invalid index defaults to 0
  assertEq(buildToolResultRef({ toolName: 't', args: {}, content: 'x', index: 'nope' }).firstIndex, 0, '(14) invalid index → 0');
  const refText = formatDedupReferenceText(5, 'ls');
  assert(refText.includes('#5'), '(14) reference text names the index');
  assert(refText.includes('ls'), '(14) reference text names the tool');
  assert(refText.includes('omitted'), '(14) reference text explains payload omitted');
  assert(formatDedupReferenceText(null).length > 0 && !formatDedupReferenceText(null).includes('#'), '(14) invalid index → generic reference, no #N');

  // ─── (15) an actual round-trip: dedup only fires on the identical repeat ──
  // Simulate a loop keeping a running ref list and only storing NON-duplicates.
  const seen: ToolResultRef[] = [];
  const results = [
    { toolName: 'ls', args: { dir: '/' }, content: 'A' },   // idx 0 new
    { toolName: 'ls', args: { dir: '/' }, content: 'A' },   // dup of 0
    { toolName: 'ls', args: { dir: '/' }, content: 'B' },   // idx 2 new (content changed)
    { toolName: 'ls', args: { dir: '/' }, content: 'A' },   // dup of 0 again
    { toolName: 'read', args: { p: 1 }, content: 'A' },     // idx 4 new (diff tool)
  ];
  const outcomes: Array<{ dup: boolean; idx: number | null }> = [];
  results.forEach((r, i) => {
    const plan = planToolResultDedup(seen, r);
    outcomes.push({ dup: plan.duplicate, idx: plan.referToIndex });
    if (!plan.duplicate) seen.push(buildToolResultRef({ ...r, index: i }));
  });
  assertEq(outcomes[0].dup, false, '(15) first result is new');
  assertEq(outcomes[1].dup, true, '(15) identical repeat is a duplicate');
  assertEq(outcomes[1].idx, 0, '(15) duplicate references index 0');
  assertEq(outcomes[2].dup, false, '(15) content change is new');
  assertEq(outcomes[3].dup, true, '(15) second identical repeat is a duplicate');
  assertEq(outcomes[3].idx, 0, '(15) references the FIRST occurrence, not the middle one');
  assertEq(outcomes[4].dup, false, '(15) different tool is new');
  assertEq(seen.length, 3, '(15) only distinct results are stored (3 of 5)');

  // ─── (16) exported bounds are sane ────────────────────────────────────────
  assert(TOOL_RESULT_ARGS_HASH_MAX_CHARS > 0, '(16) args cap positive');
  assert(TOOL_RESULT_CONTENT_HASH_MAX_CHARS > TOOL_RESULT_ARGS_HASH_MAX_CHARS, '(16) content cap > args cap');
  assert(DEDUP_MAX_PRIOR_SCAN > 0, '(16) scan cap positive');
  assertEq(DEDUP_TOOL_NAME_MAX_CHARS, 200, '(16) tool-name cap default');

  // ─── (17) hostile / degenerate — never throws ─────────────────────────────
  try {
    // computeToolResultKey degenerate inputs
    assertEq(typeof computeToolResultKey(undefined as any).argsKey, 'string', '(17) computeKey(undefined) → string');
    assertEq(typeof computeToolResultKey(null as any).contentHash, 'string', '(17) computeKey(null) → string');
    assertEq(typeof computeToolResultKey({ toolName: 42, args: 7, content: false } as any).argsKey, 'string', '(17) computeKey(wrong types) → string');
    assertEq(typeof computeToolResultKey('nope' as any).argsKey, 'string', '(17) computeKey(string) → string');

    // BigInt / Symbol / function in args and content (JSON.stringify would throw)
    const kBig = computeToolResultKey({ toolName: 't', args: { n: 10n, f: () => 1, s: Symbol('z') } as any, content: 99n as any });
    assert(kBig.argsKey.length > 0 && kBig.contentHash.length > 0, '(17) bigint/symbol/function args+content → digests');
    assertEq(kBig.argsKey, computeToolResultKey({ toolName: 't', args: { n: 10n, f: () => 2, s: Symbol('z') } as any, content: 88n as any }).argsKey, '(17) bigint args key deterministic (functions ignored)');

    // Cyclic args + cyclic content
    const cyc: any = { a: 1 }; cyc.self = cyc;
    const cyc2: any = { a: 1 }; cyc2.self = cyc2;
    const kc1 = computeToolResultKey({ toolName: 't', args: cyc, content: cyc });
    const kc2 = computeToolResultKey({ toolName: 't', args: cyc2, content: cyc2 });
    assert(kc1.argsKey.length > 0, '(17) cyclic args → non-empty argsKey, no throw');
    assertEq(kc1.argsKey, kc2.argsKey, '(17) structurally-identical cyclic args → same key (deterministic)');

    // toolName as a Symbol / object with throwing toString
    const throwName: any = { toString() { throw new Error('boom'); } };
    assertEq(typeof computeToolResultKey({ toolName: throwName, args: {}, content: 'x' }).argsKey, 'string', '(17) throwing toString toolName → string');

    // planToolResultDedup hostile inputs
    const p1 = planToolResultDedup(null, null);
    assertEq(p1.duplicate, false, '(17) planDedup(null,null) → not duplicate');
    assertEq(p1.referToIndex, null, '(17) planDedup(null,null) referToIndex null');
    assertEq(typeof p1.reason, 'string', '(17) planDedup(null,null) reason string');
    assertEq(planToolResultDedup(undefined, undefined).duplicate, false, '(17) planDedup(undefined,undefined) → not duplicate');
    assertEq(planToolResultDedup(42, 'x').duplicate, false, '(17) planDedup(number,string) → not duplicate');
    assertEq(planToolResultDedup('nope', { toolName: 't' }).duplicate, false, '(17) planDedup(string priors) → not duplicate');
    assertEq(planToolResultDedup([undefined, null, 1, 'x', {}], { toolName: 't', args: {}, content: 'x' }).duplicate, false, '(17) all-junk priors → not duplicate');

    // Cyclic next, and a giant priors array (work-bounded scan)
    const cycNext: any = { toolName: 't', args: {}, content: {} }; cycNext.content.self = cycNext.content;
    assertEq(planToolResultDedup([], cycNext).duplicate, false, '(17) cyclic next → not duplicate, no throw');
    const giant: any[] = new Array(DEDUP_MAX_PRIOR_SCAN + 500).fill({ argsKey: 'a', contentHash: 'b', toolName: 't', firstIndex: 0 });
    assertEq(planToolResultDedup(giant, { toolName: 'zzz', args: {}, content: 'zzz' }).duplicate, false, '(17) giant priors scanned bounded, no throw');

    // buildToolResultRef + formatDedupReferenceText hostile
    assertEq(typeof buildToolResultRef(undefined as any).argsKey, 'string', '(17) buildRef(undefined) → ref, no throw');
    assertEq(buildToolResultRef(null as any).firstIndex, 0, '(17) buildRef(null) firstIndex 0');
    assertEq(typeof formatDedupReferenceText(undefined), 'string', '(17) formatRef(undefined) → string');
    assertEq(typeof formatDedupReferenceText('nope', 12345), 'string', '(17) formatRef(bad index, number tool) → string');
    assertEq(typeof formatDedupReferenceText(-5, Symbol('x')), 'string', '(17) formatRef(negative, symbol tool) → string');

    // Giant tool name is bounded in the reason/reference text
    const bigName = 'N'.repeat(5000);
    const bigNameRef = ref(bigName, {}, 'same', 0);
    const bigPlan = planToolResultDedup([bigNameRef], { toolName: bigName, args: {}, content: 'same' });
    assertEq(bigPlan.duplicate, true, '(17) giant tool name still matches itself');
    assert(bigPlan.reason.length < 400, '(17) reason stays bounded despite 5000-char tool name');
    assert(formatDedupReferenceText(0, bigName).length < 200, '(17) reference text stays bounded for giant tool name');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (17) hostile inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll tool-result-dedup-core smoke cases passed (${passes} passed).`);
}

main();
