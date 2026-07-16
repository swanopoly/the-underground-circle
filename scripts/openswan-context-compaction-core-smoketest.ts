/**
 * openswan-context-compaction-core-smoketest — the pure WHEN+WHAT context
 * compaction planner (src/lib/openswanContextCompactionCore.ts) that keeps long
 * OpenSwan tool loops under the model's context window. Load-bearing assertions:
 *
 *   TRIGGER: under the safety fraction of the window → shouldCompact=false and
 *   keepIndices = every index; over it → shouldCompact=true with a real
 *   summarize/drop set.
 *
 *   PROTECTION: the system message, the most-recent keepRecentCount messages,
 *   and any referencedLater message are ALWAYS kept — never summarised, never
 *   dropped — even when they are the oldest/bulkiest in the history.
 *
 *   WHAT: stale tool_results drop, narrative turns summarise, OLDEST first, and
 *   freeing stops once the running estimate reaches the target (newer middle
 *   messages survive). The kept recent suffix never starts with a tool_result
 *   (id-free pair guard pulls the boundary back).
 *
 *   PARTITION: keep ∪ summarize ∪ drop is exact + disjoint + ascending for
 *   every case. estimatedTokens falls back to the summed content when absent.
 *
 *   projectMessagesForCompaction maps real AgentMessage content → view fields
 *   (role/contentLen/isToolResult/referencedLater), image blocks by fixed weight.
 *
 *   And: every export is TOTAL — null/undefined/wrong/huge/hostile/cyclic input
 *   never throws.
 *
 * Pure — loads under tsx (the core has a type-only import).
 */

import {
  CONTEXT_SAFETY_FRACTION,
  CONTEXT_TARGET_FRACTION,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_KEEP_RECENT_COUNT,
  KEEP_RECENT_MIN,
  KEEP_RECENT_MAX,
  CHARS_PER_TOKEN,
  SUMMARY_KEEP_FRACTION,
  IMAGE_BLOCK_CHAR_ESTIMATE,
  MAX_REASON_CHARS,
  planContextCompaction,
  projectMessagesForCompaction,
  type CompactionMessageView,
  type CompactionPlan,
} from '../src/lib/openswanContextCompactionCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── shared helpers ────────────────────────────────────────────────────────────
function isAscending(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i += 1) if (arr[i] <= arr[i - 1]) return false;
  return true;
}
function partitionIsExact(plan: CompactionPlan, n: number): boolean {
  const all = [...plan.keepIndices, ...plan.summarizeIndices, ...plan.dropIndices];
  if (all.length !== n) return false;
  const seen = new Set(all);
  if (seen.size !== n) return false; // disjoint
  for (let i = 0; i < n; i += 1) if (!seen.has(i)) return false; // covers [0,n)
  return true;
}
function assertPartition(plan: CompactionPlan, n: number, label: string): void {
  assert(partitionIsExact(plan, n), `${label}: keep∪summarize∪drop is an exact partition of ${n}`);
  assert(isAscending(plan.keepIndices), `${label}: keepIndices ascending`);
  assert(isAscending(plan.summarizeIndices), `${label}: summarizeIndices ascending`);
  assert(isAscending(plan.dropIndices), `${label}: dropIndices ascending`);
  assert(plan.reason.length <= MAX_REASON_CHARS, `${label}: reason within cap`);
}
const view = (v: Partial<CompactionMessageView>): CompactionMessageView => ({
  role: v.role ?? 'assistant',
  contentLen: v.contentLen ?? 0,
  isToolResult: v.isToolResult ?? false,
  referencedLater: v.referencedLater ?? false,
});

function main(): void {
  // ─── (1) constants sanity ─────────────────────────────────────────────────
  assert(CONTEXT_SAFETY_FRACTION > CONTEXT_TARGET_FRACTION, '(1) safety fraction above target (single pass drops below trigger)');
  assert(CONTEXT_SAFETY_FRACTION < 1 && CONTEXT_TARGET_FRACTION > 0, '(1) fractions in (0,1)');
  assertEq(DEFAULT_CONTEXT_WINDOW_TOKENS, 200_000, '(1) default window 200k');
  assert(CONTEXT_WINDOW_MIN < CONTEXT_WINDOW_MAX, '(1) window bounds ordered');
  assert(KEEP_RECENT_MIN <= DEFAULT_KEEP_RECENT_COUNT && DEFAULT_KEEP_RECENT_COUNT <= KEEP_RECENT_MAX, '(1) keep-recent default within bounds');
  assertEq(CHARS_PER_TOKEN, 4, '(1) chars/token = 4 (matches agentContextCompression)');
  assert(SUMMARY_KEEP_FRACTION > 0 && SUMMARY_KEEP_FRACTION < 1, '(1) summary keep fraction in (0,1)');
  assert(IMAGE_BLOCK_CHAR_ESTIMATE > 1000, '(1) image weighted well above a text token');
  assert(MAX_REASON_CHARS >= 80, '(1) reason cap is generous enough to be useful');

  // ─── (2) empty / degenerate top-level → no-op ─────────────────────────────
  const empty = planContextCompaction({ messages: [] });
  assertEq(empty.shouldCompact, false, '(2) empty messages → no compaction');
  assertEq(empty.keepIndices.length, 0, '(2) empty → no keep indices');
  assertEq(empty.summarizeIndices.length + empty.dropIndices.length, 0, '(2) empty → nothing to compact');
  assertEq(planContextCompaction(null).shouldCompact, false, '(2) null input → no-op');
  assertEq(planContextCompaction(undefined).shouldCompact, false, '(2) undefined input → no-op');
  assertEq(planContextCompaction({}).shouldCompact, false, '(2) missing messages → no-op');
  assertEq(planContextCompaction({ messages: 'nope' }).shouldCompact, false, '(2) non-array messages → no-op');

  // ─── (3) under threshold → keep ALL ───────────────────────────────────────
  const under = planContextCompaction({
    estimatedTokens: 50_000, // 50k << 150k trigger on a 200k window
    contextWindowTokens: 200_000,
    keepRecentCount: 3,
    messages: [
      view({ role: 'system', contentLen: 4_000 }),
      view({ role: 'user', contentLen: 8_000 }),
      view({ role: 'assistant', contentLen: 8_000 }),
      view({ role: 'user', contentLen: 8_000, isToolResult: true }),
      view({ role: 'assistant', contentLen: 8_000 }),
    ],
  });
  assertEq(under.shouldCompact, false, '(3) under threshold → shouldCompact false');
  assertEq(under.keepIndices.length, 5, '(3) under threshold keeps every message');
  assertEq(under.summarizeIndices.length, 0, '(3) under threshold summarizes nothing');
  assertEq(under.dropIndices.length, 0, '(3) under threshold drops nothing');
  assert(under.reason.includes('within safety trigger'), '(3) reason explains under-threshold');
  assertPartition(under, 5, '(3)');

  // ─── (4) over threshold → oldest middle compacted; system+recent kept ─────
  // window 200k → trigger 150k, target 110k. est 170k.
  const overMsgs: CompactionMessageView[] = [
    view({ role: 'system', contentLen: 4_000 }),                 // 0 system → keep
    view({ role: 'user', contentLen: 120_000, isToolResult: true }), // 1 drop (frees 30k tok → 140k)
    view({ role: 'assistant', contentLen: 100_000 }),           // 2 summarize (+20k tok → 120k)
    view({ role: 'user', contentLen: 160_000, isToolResult: true }), // 3 drop (+40k tok → 80k ≤110k → stop)
    view({ role: 'user', contentLen: 20_000 }),                 // 4 newer middle → keep
    view({ role: 'assistant', contentLen: 20_000 }),            // 5 newer middle → keep
    view({ role: 'user', contentLen: 20_000, isToolResult: true }), // 6 newer middle → keep
    view({ role: 'assistant', contentLen: 4_000 }),             // 7 recent → keep
    view({ role: 'user', contentLen: 4_000 }),                  // 8 recent → keep
    view({ role: 'assistant', contentLen: 4_000 }),             // 9 recent → keep
  ];
  const over = planContextCompaction({
    estimatedTokens: 170_000,
    contextWindowTokens: 200_000,
    keepRecentCount: 3,
    messages: overMsgs,
  });
  assertEq(over.shouldCompact, true, '(4) over threshold → shouldCompact true');
  assert(over.dropIndices.includes(1), '(4) oldest stale tool_result dropped');
  assert(over.dropIndices.includes(3), '(4) second stale tool_result dropped');
  assert(over.summarizeIndices.includes(2), '(4) oldest narrative turn summarised');
  assert(over.keepIndices.includes(0), '(4) system message kept');
  assert(over.keepIndices.includes(7) && over.keepIndices.includes(8) && over.keepIndices.includes(9), '(4) most-recent turns kept');
  assert(over.keepIndices.includes(4) && over.keepIndices.includes(5) && over.keepIndices.includes(6), '(4) newer middle survives — only the OLDEST are compacted');
  assert(!over.dropIndices.includes(0) && !over.summarizeIndices.includes(0), '(4) system never compacted');
  assert(over.reason.includes('over trigger'), '(4) reason explains over-threshold');
  assertPartition(over, 10, '(4)');

  // ─── (5) a referenced-later tool_result is NEVER dropped ──────────────────
  const refMsgs: CompactionMessageView[] = [
    view({ role: 'system', contentLen: 2_000 }),                                   // 0
    view({ role: 'user', contentLen: 300_000, isToolResult: true, referencedLater: true }), // 1 OLD + bulky BUT referenced → keep
    view({ role: 'assistant', contentLen: 200_000 }),                              // 2 summarise candidate
    view({ role: 'user', contentLen: 200_000, isToolResult: true }),               // 3 drop candidate
    view({ role: 'assistant', contentLen: 3_000 }),                                // 4 recent
    view({ role: 'user', contentLen: 3_000 }),                                     // 5 recent
  ];
  const refPlan = planContextCompaction({
    estimatedTokens: 260_000, // way over 150k trigger
    contextWindowTokens: 200_000,
    keepRecentCount: 2,
    messages: refMsgs,
  });
  assertEq(refPlan.shouldCompact, true, '(5) still compacts around the protected message');
  assert(refPlan.keepIndices.includes(1), '(5) referenced-later tool_result is KEPT');
  assert(!refPlan.dropIndices.includes(1), '(5) referenced-later tool_result is NOT dropped');
  assert(!refPlan.summarizeIndices.includes(1), '(5) referenced-later tool_result is NOT summarised');
  assert(refPlan.summarizeIndices.includes(2) || refPlan.dropIndices.includes(3), '(5) an unprotected middle message is still compacted');
  assert(refPlan.reason.includes('referenced'), '(5) reason notes referenced protection');
  assertPartition(refPlan, 6, '(5)');

  // ─── (6) system message kept even when it is the oldest + biggest ─────────
  const sysBig = planContextCompaction({
    estimatedTokens: 400_000,
    contextWindowTokens: 200_000,
    keepRecentCount: 2,
    messages: [
      view({ role: 'system', contentLen: 900_000 }),             // huge system → still keep
      view({ role: 'assistant', contentLen: 100_000 }),          // candidate
      view({ role: 'user', contentLen: 100_000, isToolResult: true }), // candidate
      view({ role: 'assistant', contentLen: 5_000 }),            // recent
      view({ role: 'user', contentLen: 5_000 }),                 // recent
    ],
  });
  assert(sysBig.keepIndices.includes(0), '(6) oversized system message kept');
  assert(!sysBig.dropIndices.includes(0) && !sysBig.summarizeIndices.includes(0), '(6) system never dropped/summarised');
  assertPartition(sysBig, 5, '(6)');

  // ─── (7) keepRecentCount >= n → everything is "recent" → keep all ─────────
  const allRecent = planContextCompaction({
    estimatedTokens: 500_000,
    contextWindowTokens: 200_000,
    keepRecentCount: 10, // >= 5 messages
    messages: [
      view({ role: 'system', contentLen: 4_000 }),
      view({ role: 'assistant', contentLen: 200_000 }),
      view({ role: 'user', contentLen: 200_000, isToolResult: true }),
      view({ role: 'assistant', contentLen: 200_000 }),
      view({ role: 'user', contentLen: 4_000 }),
    ],
  });
  assertEq(allRecent.shouldCompact, false, '(7) over threshold but all protected → no compaction');
  assertEq(allRecent.keepIndices.length, 5, '(7) all-recent keeps everything');
  assert(allRecent.reason.includes('nothing to compact'), '(7) reason explains all-protected');
  assertPartition(allRecent, 5, '(7)');

  // ─── (8) minimal compaction — one big old tool_result suffices ────────────
  const minimal = planContextCompaction({
    estimatedTokens: 160_000, // just over 150k trigger
    contextWindowTokens: 200_000,
    keepRecentCount: 3,
    messages: [
      view({ role: 'system', contentLen: 2_000 }),                     // 0
      view({ role: 'user', contentLen: 800_000, isToolResult: true }), // 1 dropping this frees 200k tok → running < target → STOP
      view({ role: 'assistant', contentLen: 100_000 }),                // 2 should survive
      view({ role: 'user', contentLen: 100_000, isToolResult: true }), // 3 should survive
      view({ role: 'assistant', contentLen: 100_000 }),                // 4 should survive
      view({ role: 'user', contentLen: 3_000 }),                       // 5 recent
      view({ role: 'assistant', contentLen: 3_000 }),                  // 6 recent
      view({ role: 'user', contentLen: 3_000 }),                       // 7 recent
    ],
  });
  assertEq(minimal.dropIndices.length, 1, '(8) exactly one message compacted when it suffices');
  assert(minimal.dropIndices.includes(1), '(8) the oldest bulky tool_result is the one dropped');
  assertEq(minimal.summarizeIndices.length, 0, '(8) nothing summarised once target reached');
  assert(minimal.keepIndices.includes(2) && minimal.keepIndices.includes(3) && minimal.keepIndices.includes(4), '(8) later middle messages untouched (freeing stopped)');
  assertPartition(minimal, 8, '(8)');

  // ─── (9) pair guard — kept suffix never STARTS with a tool_result ─────────
  // n=8, keepRecent=2 → recentStart=6; index6 is a tool_result → pull back to
  // include its tool_use at index5. So index5 is kept even though 8-2=6.
  const pairMsgs: CompactionMessageView[] = [
    view({ role: 'system', contentLen: 2_000 }),                     // 0
    view({ role: 'user', contentLen: 200_000, isToolResult: true }), // 1 drop
    view({ role: 'assistant', contentLen: 200_000 }),                // 2 summarise (brings running ≤ target)
    view({ role: 'user', contentLen: 20_000 }),                      // 3
    view({ role: 'assistant', contentLen: 20_000 }),                 // 4
    view({ role: 'assistant', contentLen: 10_000 }),                 // 5 tool_use turn (isToolResult false)
    view({ role: 'user', contentLen: 30_000, isToolResult: true }),  // 6 tool_result — would-be suffix start
    view({ role: 'assistant', contentLen: 5_000 }),                  // 7 recent
  ];
  const pair = planContextCompaction({
    estimatedTokens: 190_000,
    contextWindowTokens: 200_000,
    keepRecentCount: 2,
    messages: pairMsgs,
  });
  assert(pair.keepIndices.includes(6), '(9) the trailing tool_result stays kept');
  assert(pair.keepIndices.includes(5), '(9) pair guard pulled the boundary back to keep its tool_use (index 5 kept despite n-keepRecent=6)');
  assert(!pair.dropIndices.includes(6) && !pair.summarizeIndices.includes(6), '(9) boundary tool_result never compacted');
  assertEq(pair.shouldCompact, true, '(9) still compacts the older region');
  assertPartition(pair, 8, '(9)');

  // ─── (10) estimatedTokens falls back to summed content when absent/invalid ─
  // 5 messages × 200k chars = 1,000,000 chars → ~250k tokens ÷ ... derived est
  // = ceil(1_000_000/4) = 250_000 > 150k trigger → compacts with NO estimate given.
  const derivedMsgs: CompactionMessageView[] = [
    view({ role: 'system', contentLen: 4_000 }),
    view({ role: 'user', contentLen: 300_000, isToolResult: true }),
    view({ role: 'assistant', contentLen: 300_000 }),
    view({ role: 'user', contentLen: 300_000, isToolResult: true }),
    view({ role: 'assistant', contentLen: 4_000 }),
  ];
  const derived = planContextCompaction({ contextWindowTokens: 200_000, keepRecentCount: 1, messages: derivedMsgs });
  assertEq(derived.shouldCompact, true, '(10) missing estimatedTokens derived from content → compacts');
  const derivedNaN = planContextCompaction({ estimatedTokens: 'abc', contextWindowTokens: 200_000, keepRecentCount: 1, messages: derivedMsgs });
  assertEq(derivedNaN.shouldCompact, true, '(10) invalid estimatedTokens string falls back to derived');
  const derivedInf = planContextCompaction({ estimatedTokens: Infinity, contextWindowTokens: 200_000, keepRecentCount: 1, messages: derivedMsgs });
  assertEq(derivedInf.shouldCompact, true, '(10) Infinity estimatedTokens falls back to derived');
  assertPartition(derived, 5, '(10)');

  // ─── (11) determinism — identical inputs → identical plan ─────────────────
  const p1 = planContextCompaction({ estimatedTokens: 170_000, contextWindowTokens: 200_000, keepRecentCount: 3, messages: overMsgs });
  const p2 = planContextCompaction({ estimatedTokens: 170_000, contextWindowTokens: 200_000, keepRecentCount: 3, messages: overMsgs });
  assertEq(JSON.stringify(p1), JSON.stringify(p2), '(11) planner is deterministic');

  // ─── (12) window clamping + defaults ──────────────────────────────────────
  // A tiny window (100 → clamped to 4_000) with a modest estimate still triggers.
  const tinyWin = planContextCompaction({
    estimatedTokens: 3_500, // > 0.75*4000 = 3000 trigger after clamp
    contextWindowTokens: 100,
    keepRecentCount: 2,
    messages: [
      view({ role: 'system', contentLen: 100 }),
      view({ role: 'user', contentLen: 40_000, isToolResult: true }),
      view({ role: 'assistant', contentLen: 200 }),
      view({ role: 'user', contentLen: 200 }),
    ],
  });
  assertEq(tinyWin.shouldCompact, true, '(12) sub-min window clamps to CONTEXT_WINDOW_MIN (still triggers)');
  const hugeWinNoop = planContextCompaction({
    estimatedTokens: 500_000, // 0.75 * 2M = 1.5M trigger → well under
    contextWindowTokens: 9_999_999_999, // clamps to 2M
    keepRecentCount: 2,
    messages: [
      view({ role: 'system', contentLen: 4_000 }),
      view({ role: 'user', contentLen: 400_000, isToolResult: true }),
      view({ role: 'assistant', contentLen: 4_000 }),
      view({ role: 'user', contentLen: 4_000 }),
    ],
  });
  assertEq(hugeWinNoop.shouldCompact, false, '(12) window clamps to CONTEXT_WINDOW_MAX (2M) → 500k est is under trigger');
  assertPartition(hugeWinNoop, 4, '(12)');

  // ─── (13) projectMessagesForCompaction maps real AgentMessage content ─────
  const projected = projectMessagesForCompaction([
    { role: 'system', content: 'sys prompt' },                                   // 0
    { role: 'user', content: 'hello' },                                          // 1
    { role: 'assistant', content: [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 'tu1', name: 'foo', input: { a: 1 } },
    ] },                                                                          // 2 (tool_use, not a tool_result)
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu1', content: 'result text' },
    ] },                                                                          // 3 tool_result
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu2', content: [
        { type: 'text', text: 'x' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA'.repeat(50_000) } },
      ] },
    ] },                                                                          // 4 image tool_result
  ] as any);
  assertEq(projected.length, 5, '(13) one view per message');
  assertEq(projected[0].role, 'system', '(13) system role preserved');
  assertEq(projected[0].contentLen, 'sys prompt'.length, '(13) string content measured by length');
  assertEq(projected[0].isToolResult, false, '(13) string-content system is not a tool_result');
  assertEq(projected[1].contentLen, 'hello'.length, '(13) plain user text length');
  assertEq(projected[2].isToolResult, false, '(13) tool_use turn is NOT a tool_result');
  assert(projected[2].contentLen! >= 2 + 3 + 32, '(13) tool_use content weighted by input+name+overhead');
  assertEq(projected[3].isToolResult, true, '(13) tool_result turn flagged');
  assertEq(projected[3].contentLen, 'result text'.length + 32, '(13) string tool_result length + overhead');
  assertEq(projected[4].isToolResult, true, '(13) image tool_result flagged');
  // image counted by FIXED weight, never by its ~200KB base64 length
  assertEq(projected[4].contentLen, 32 + 1 + IMAGE_BLOCK_CHAR_ESTIMATE, '(13) image weighted by fixed estimate, not base64 length');
  assert(projected[4].contentLen! < 10_000, '(13) huge base64 payload did NOT inflate the count');
  // referencedLater default false; opt-in via referencedToolUseIds
  assert(projected.every((v) => v.referencedLater === false), '(13) referencedLater false with no ids supplied');
  const projectedRef = projectMessagesForCompaction([
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'foo', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'x' }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu9', content: 'y' }] },
  ] as any, { referencedToolUseIds: ['tu1'] });
  assertEq(projectedRef[0].referencedLater, true, '(13) tool_use with referenced id flagged');
  assertEq(projectedRef[1].referencedLater, true, '(13) tool_result with referenced id flagged');
  assertEq(projectedRef[2].referencedLater, false, '(13) unreferenced tool_result not flagged');

  // projector feeds the planner end-to-end (recent suffix ends on non-tool_result
  // turns so the pair guard does not swallow the compactable middle).
  const e2ePlan = planContextCompaction({
    estimatedTokens: 200_000,
    contextWindowTokens: 200_000,
    keepRecentCount: 2,
    messages: projectMessagesForCompaction([
      { role: 'system', content: 'S'.repeat(4_000) },                                                     // 0 keep
      { role: 'assistant', content: 'A'.repeat(300_000) },                                                 // 1 summarise
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'R'.repeat(300_000) }] }, // 2 drop
      { role: 'assistant', content: 'B'.repeat(300_000) },                                                 // 3 candidate
      { role: 'assistant', content: 'done-1' },                                                            // 4 recent
      { role: 'assistant', content: 'done-2' },                                                            // 5 recent
    ] as any),
  });
  assertEq(e2ePlan.shouldCompact, true, '(13) projector → planner end-to-end compacts');
  assert(e2ePlan.keepIndices.includes(0) && e2ePlan.keepIndices.includes(4) && e2ePlan.keepIndices.includes(5), '(13) e2e keeps system + recent');
  assert(e2ePlan.dropIndices.includes(2), '(13) e2e drops the stale tool_result');
  assertPartition(e2ePlan, 6, '(13-e2e)');

  // ─── (14) order-preserving + bounded across a larger run ──────────────────
  const big: CompactionMessageView[] = [];
  big.push(view({ role: 'system', contentLen: 4_000 }));
  for (let i = 0; i < 200; i += 1) {
    big.push(view({ role: 'assistant', contentLen: 3_000 }));
    big.push(view({ role: 'user', contentLen: 5_000, isToolResult: true }));
  }
  const bigPlan = planContextCompaction({ estimatedTokens: 1_800_000, contextWindowTokens: 2_000_000, keepRecentCount: 8, messages: big });
  assertEq(bigPlan.shouldCompact, true, '(14) large run over threshold compacts');
  assertPartition(bigPlan, big.length, '(14)');
  assert(bigPlan.keepIndices.includes(0), '(14) system still kept in a large run');
  assert(bigPlan.keepIndices.includes(big.length - 1), '(14) newest message still kept in a large run');
  assert(bigPlan.reason.length <= MAX_REASON_CHARS, '(14) reason bounded even for a large run');

  // ─── (15) hostile / degenerate input never throws ─────────────────────────
  try {
    const cyclic: any = { role: 'user', content: [{ type: 'tool_use', id: 'x', name: 'n', input: {} }] };
    cyclic.content[0].input.self = cyclic.content[0].input; // cycle in tool_use input

    const hostiles: unknown[] = [
      undefined, null, 42, 'string', [], {},
      { messages: null },
      { messages: 42 },
      { messages: [null, 42, 'z', {}, [], true] },
      { messages: [{ role: 5, contentLen: 'big', isToolResult: 'yes', referencedLater: 1 }] },
      { estimatedTokens: NaN, contextWindowTokens: NaN, keepRecentCount: NaN, messages: [view({ contentLen: 999_999 })] },
      { estimatedTokens: -5, contextWindowTokens: -100, keepRecentCount: -9, messages: [view({ role: 'system' }), view({ isToolResult: true })] },
      { estimatedTokens: 1e18, contextWindowTokens: 0, keepRecentCount: 1e9, messages: [view({ contentLen: 1e12 })] },
      { messages: [cyclic, view({ role: 'user', contentLen: 100 })] },
    ];
    for (let i = 0; i < hostiles.length; i += 1) {
      const plan = planContextCompaction(hostiles[i] as any);
      assert(typeof plan.shouldCompact === 'boolean', `(15) hostile[${i}] returns a boolean shouldCompact`);
      assert(Array.isArray(plan.keepIndices) && Array.isArray(plan.summarizeIndices) && Array.isArray(plan.dropIndices), `(15) hostile[${i}] returns index arrays`);
      assert(typeof plan.reason === 'string' && plan.reason.length <= MAX_REASON_CHARS, `(15) hostile[${i}] reason is a bounded string`);
      const n = Array.isArray((hostiles[i] as any)?.messages) ? (hostiles[i] as any).messages.length : 0;
      assert(partitionIsExact(plan, n), `(15) hostile[${i}] still yields an exact partition of ${n}`);
    }

    // projector hostile inputs
    assertEq(projectMessagesForCompaction(null as any).length, 0, '(15) projector(null) → []');
    assertEq(projectMessagesForCompaction(undefined as any).length, 0, '(15) projector(undefined) → []');
    assertEq(projectMessagesForCompaction('nope' as any).length, 0, '(15) projector(string) → []');
    const junkProjected = projectMessagesForCompaction([null, 42, 'z', {}, { role: 'user', content: undefined }] as any);
    assertEq(junkProjected.length, 5, '(15) projector keeps index alignment for junk entries');
    assert(junkProjected.every((v) => typeof v.contentLen === 'number' && v.contentLen! >= 0), '(15) projector junk entries get safe contentLen');
    // cyclic tool_use input does not throw and yields a finite length
    const cyclicProjected = projectMessagesForCompaction([cyclic] as any);
    assert(Number.isFinite(cyclicProjected[0].contentLen as number), '(15) cyclic tool_use input measured without throwing');
    // hostile referencedToolUseIds (non-iterable / throwing iterator) ignored
    assertEq(projectMessagesForCompaction([{ role: 'user', content: 'x' }] as any, { referencedToolUseIds: 123 as any }).length, 1, '(15) non-iterable referenced ids tolerated');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (15) hostile inputs threw: ${(e as Error)?.message}`);
  }

  // ─── summary ───────────────────────────────────────────────────────────────
  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll openswan-context-compaction-core smoke cases passed (${passes} passed).`);
}

main();
