/**
 * context-compaction-tier-core-smoketest — the PURE compaction-tier SELECTOR
 * (src/lib/contextCompactionTierCore.ts). It turns a running token estimate + a
 * stale-tool-vs-load-bearing byte breakdown (+ optional turn count) into ONE
 * minimal-sufficient tier: none / drop_tool_noise / summarize_oldest /
 * hard_truncate, and detects the hard-limit emergency that forces truncation of
 * protected/recent content. Load-bearing behavior asserted here:
 *
 *   (A) DECISIONS: under-trigger → none; mild over-trigger a free drop clears →
 *       drop_tool_noise (afterDrop ≤ target); drop insufficient but drop+summarise
 *       fits → summarize_oldest; over-trigger yet everything protected & under the
 *       hard limit → none (matches openswan keepAll, NOT a summarise no-op); one
 *       giant PROTECTED recent tool_result over the window → hard_truncate with
 *       overage>0 + candidates ⊆ protected; proactive drop past turn 40.
 *   (B) OUTPUT/INVARIANTS: shouldCompact ⟺ tier!=='none'; tier==='hard_truncate'
 *       ⟺ overHardLimit && afterBoth>hardLimit; monotonic afterBoth≤afterDrop≤est;
 *       candidates ascending, ⊆ protected, ≤ cap; reason ≤240 & clean & secret-safe;
 *       pressureRatio rounded 3dp.
 *   (C) BOUNDARY: est exactly at softTrigger; window/keep/reserved clamps; candidate
 *       cap; est over hardLimit but freeable brings afterBoth under → summarize.
 *   (D) DETERMINISM: identical input → identical output; candidate tiebreak stable.
 *   (E) ALIGNMENT: the shared fractions/keep/summary/window/reason constants equal
 *       openswanContextCompactionCore's — the selector and partitioner can't drift.
 *   (F) HOSTILE: null/undefined/number/string/bool/{}/[]/NaN/±Infinity/negative/
 *       bigint/huge/cyclic/throwing-getter/throwing-proxy/hostile-array/__proto__+
 *       constructor keys/control+astral+lone-surrogate role never throw and yield a
 *       bounded, well-formed, surrogate-safe plan.
 *
 * Pure — the core imports nothing; this smoke additionally imports
 * openswanContextCompactionCore (type-only deps → tsx-loadable) to pin alignment.
 * Run: npx tsx scripts/context-compaction-tier-core-smoketest.ts
 */

import {
  planCompactionTier,
  CONTEXT_SAFETY_FRACTION,
  CONTEXT_TARGET_FRACTION,
  SUMMARY_KEEP_FRACTION,
  CHARS_PER_TOKEN,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  CONTEXT_WINDOW_MIN,
  CONTEXT_WINDOW_MAX,
  DEFAULT_KEEP_RECENT_COUNT,
  KEEP_RECENT_MIN,
  KEEP_RECENT_MAX,
  MAX_REASON_CHARS,
  MAX_HARD_TRUNCATE_CANDIDATES,
  MAX_MESSAGES,
  MAX_CONTENT_LEN,
  DEFAULT_RESERVED_OUTPUT_TOKENS,
  PROACTIVE_DROP_TURN_THRESHOLD,
  type CompactionTierPlan,
  type CompactionTierMessageView,
} from '../src/lib/contextCompactionTierCore';
import * as openswan from '../src/lib/openswanContextCompactionCore';

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
  try { fn(); } catch (e) { threw = true; try { err = String((e as { message?: unknown })?.message ?? e); } catch { err = 'unstringifiable'; } }
  assert(!threw, m, err);
}

// ── control-char / code-point helpers (build control chars, never raw literals) ──
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);
const C1 = String.fromCharCode(0x9b);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);
const BOM = String.fromCharCode(0xfeff);
const TAG = String.fromCodePoint(0xe0041);
const ASTRAL = String.fromCodePoint(0x1f600); // 😀 (surrogate pair)
const LONE_HI = String.fromCharCode(0xd83d); // lone high surrogate
const LONE_LO = String.fromCharCode(0xdc00); // lone low surrogate
const BACKTICK = String.fromCharCode(0x60);
const LT = String.fromCharCode(0x3c);
const GT = String.fromCharCode(0x3e);

/** No control / DEL / C1 / line-sep / format / Tag / lone-surrogate / fence chars. */
function isCleanLabel(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of Array.from(s)) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return false;
    if (c === 0x2028 || c === 0x2029) return false;
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x200e || c === 0x200f) return false;
    if (c === 0x2060 || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (c >= 0xe0000 && c <= 0xe007f) return false;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return false; // lone surrogate
    if (c === 0x60 || c === 0x3c || c === 0x3e) return false; // ` < >
  }
  return true;
}

// ── message-view builder ──────────────────────────────────────────────────────
interface ViewOpts { tool?: boolean; ref?: boolean; prot?: boolean; role?: string; }
function view(contentLen: number, opts: ViewOpts = {}): CompactionTierMessageView {
  const v: CompactionTierMessageView = { contentLen };
  if (opts.tool) v.isToolResult = true;
  if (opts.ref) v.referencedLater = true;
  if (opts.prot) v.protected = true;
  if (opts.role !== undefined) v.role = opts.role;
  return v;
}

const TIERS = new Set(['none', 'drop_tool_noise', 'summarize_oldest', 'hard_truncate']);

/** Full structural + bounds + invariant check for one plan (used everywhere). */
function wellFormedPlan(p: CompactionTierPlan): boolean {
  if (!p || typeof p !== 'object') return false;
  if (!TIERS.has(p.tier)) return false;
  if (p.shouldCompact !== (p.tier !== 'none')) return false;
  if (typeof p.overSoftTrigger !== 'boolean' || typeof p.overHardLimit !== 'boolean') return false;
  const nums = [
    p.pressureRatio, p.estimatedTokens, p.softTriggerTokens, p.targetTokens, p.hardLimitTokens,
    p.freeableByDropTokens, p.freeableBySummarizeTokens, p.projectedTokensAfterDrop,
    p.projectedTokensAfterDropAndSummarize, p.hardTruncateOverageTokens,
  ];
  for (const x of nums) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) return false;
  }
  // monotonic projection
  if (p.projectedTokensAfterDrop > p.estimatedTokens) return false;
  if (p.projectedTokensAfterDropAndSummarize > p.projectedTokensAfterDrop) return false;
  // candidates: array, bounded, integer, strictly ascending
  if (!Array.isArray(p.hardTruncateCandidates)) return false;
  if (p.hardTruncateCandidates.length > MAX_HARD_TRUNCATE_CANDIDATES) return false;
  let prev = -1;
  for (const c of p.hardTruncateCandidates) {
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 0) return false;
    if (c <= prev) return false;
    prev = c;
  }
  // emergency equivalence: tier==='hard_truncate' ⟺ overHardLimit && afterBoth>hardLimit
  //   && there is something to shave. The last term matters for the degenerate case
  //   (over the hard window but no protected messages to truncate, e.g. messages
  //   absent): that plan is 'none' with overHardLimit=true and no candidates, and must
  //   NOT be treated as an inconsistent emergency. Real emergencies always carry >=1
  //   candidate (the core only sets hard_truncate when protectedList.length > 0).
  const isEmergency = p.tier === 'hard_truncate';
  const cond =
    p.overHardLimit &&
    p.projectedTokensAfterDropAndSummarize > p.hardLimitTokens &&
    p.hardTruncateCandidates.length > 0;
  if (isEmergency !== cond) return false;
  if (!isEmergency && (p.hardTruncateOverageTokens !== 0 || p.hardTruncateCandidates.length !== 0)) return false;
  if (isEmergency && (p.hardTruncateOverageTokens <= 0 || p.hardTruncateCandidates.length === 0)) return false;
  // reason: bounded, clean, secret-safe (labels + numbers only)
  if (typeof p.reason !== 'string') return false;
  if (p.reason.length > MAX_REASON_CHARS) return false;
  if (!isCleanLabel(p.reason)) return false;
  return true;
}

function main(): void {
  // ─── (E) ALIGNMENT with openswanContextCompactionCore (pin the lockstep) ─────
  assertEq(CONTEXT_SAFETY_FRACTION, openswan.CONTEXT_SAFETY_FRACTION, '(E) CONTEXT_SAFETY_FRACTION aligned');
  assertEq(CONTEXT_TARGET_FRACTION, openswan.CONTEXT_TARGET_FRACTION, '(E) CONTEXT_TARGET_FRACTION aligned');
  assertEq(SUMMARY_KEEP_FRACTION, openswan.SUMMARY_KEEP_FRACTION, '(E) SUMMARY_KEEP_FRACTION aligned');
  assertEq(CHARS_PER_TOKEN, openswan.CHARS_PER_TOKEN, '(E) CHARS_PER_TOKEN aligned');
  assertEq(DEFAULT_CONTEXT_WINDOW_TOKENS, openswan.DEFAULT_CONTEXT_WINDOW_TOKENS, '(E) DEFAULT_CONTEXT_WINDOW_TOKENS aligned');
  assertEq(CONTEXT_WINDOW_MIN, openswan.CONTEXT_WINDOW_MIN, '(E) CONTEXT_WINDOW_MIN aligned');
  assertEq(CONTEXT_WINDOW_MAX, openswan.CONTEXT_WINDOW_MAX, '(E) CONTEXT_WINDOW_MAX aligned');
  assertEq(DEFAULT_KEEP_RECENT_COUNT, openswan.DEFAULT_KEEP_RECENT_COUNT, '(E) DEFAULT_KEEP_RECENT_COUNT aligned');
  assertEq(KEEP_RECENT_MIN, openswan.KEEP_RECENT_MIN, '(E) KEEP_RECENT_MIN aligned');
  assertEq(KEEP_RECENT_MAX, openswan.KEEP_RECENT_MAX, '(E) KEEP_RECENT_MAX aligned');
  assertEq(MAX_REASON_CHARS, openswan.MAX_REASON_CHARS, '(E) MAX_REASON_CHARS aligned');

  // Default-window landmarks reused throughout.
  const W = 200_000; // default window
  const SOFT = Math.floor(W * CONTEXT_SAFETY_FRACTION); // 150000
  const TARGET = Math.floor(W * CONTEXT_TARGET_FRACTION); // 110000
  const HARD = W - DEFAULT_RESERVED_OUTPUT_TOKENS; // 192000

  // ─── (A1) under soft trigger, short run → none ───────────────────────────────
  {
    const msgs = [view(2000, { role: 'system' }), view(1000), view(1000, { tool: true }), view(500)];
    const p = planCompactionTier({ estimatedTokens: 50_000, contextWindowTokens: W, messages: msgs });
    assert(wellFormedPlan(p), '(A1) well-formed');
    assertEq(p.tier, 'none', '(A1) under soft trigger → none');
    assertEq(p.shouldCompact, false, '(A1) shouldCompact false');
    assertEq(p.overSoftTrigger, false, '(A1) not over soft trigger');
    assertEq(p.softTriggerTokens, SOFT, '(A1) softTriggerTokens = floor(window*0.75)');
    assertEq(p.targetTokens, TARGET, '(A1) targetTokens = floor(window*0.55)');
    assertEq(p.hardLimitTokens, HARD, '(A1) hardLimitTokens = window - reserved');
    assertEq(p.pressureRatio, 0.25, '(A1) pressureRatio 50000/200000 rounded = 0.25');
    assertEq(p.hardTruncateCandidates.length, 0, '(A1) no candidates');
    assertEq(p.hardTruncateOverageTokens, 0, '(A1) no overage');
  }

  // ─── (A2) mild over-trigger a free DROP clears → drop_tool_noise ─────────────
  {
    // 8 unprotected tool_results (30000 chars each → drop 240000 chars = 60000 tokens),
    // 2 protected recent text messages. afterDrop = 160000 - 60000 = 100000 ≤ target.
    const msgs: CompactionTierMessageView[] = [];
    for (let i = 0; i < 8; i++) msgs.push(view(30_000, { tool: true }));
    msgs.push(view(500));
    msgs.push(view(500));
    const p = planCompactionTier({ estimatedTokens: 160_000, contextWindowTokens: W, keepRecentCount: 2, messages: msgs });
    assert(wellFormedPlan(p), '(A2) well-formed');
    assertEq(p.tier, 'drop_tool_noise', '(A2) free drop clears pressure → drop_tool_noise');
    assertEq(p.shouldCompact, true, '(A2) shouldCompact true');
    assert(p.projectedTokensAfterDrop <= p.targetTokens, '(A2) projectedAfterDrop ≤ target');
    assertEq(p.freeableByDropTokens, 60_000, '(A2) freeableByDropTokens = 240000/4');
    assertEq(p.freeableBySummarizeTokens, 0, '(A2) nothing summarizable');
    assertEq(p.projectedTokensAfterDrop, 100_000, '(A2) afterDrop = 100000');
    assert(!p.reason.includes('summarize'), '(A2) reason does not mention summarise');
  }

  // ─── (A2b) REGRESSION: over trigger, a free drop does NOT reach target, and there
  //     is nothing summarizable → stay on the cheaper drop tier (drop+summarise would
  //     free 0, i.e. a no-op summariser call). Was wrongly escalating to summarize_oldest.
  {
    const msgs: CompactionTierMessageView[] = [
      view(100_000, { tool: true }), // one unprotected tool_result → drop 100000 chars = 25000 tok
      view(500),
      view(500),
    ];
    const p = planCompactionTier({ estimatedTokens: 160_000, contextWindowTokens: W, keepRecentCount: 2, messages: msgs });
    assert(wellFormedPlan(p), '(A2b) well-formed');
    assertEq(p.freeableBySummarizeTokens, 0, '(A2b) nothing summarizable');
    assert(p.projectedTokensAfterDrop > p.targetTokens, '(A2b) drop alone does NOT reach target');
    assertEq(p.tier, 'drop_tool_noise', '(A2b) nothing to summarise → cheaper drop tier, not summarize_oldest');
    assert(!p.reason.includes('summarize'), '(A2b) reason does not mention summarise');
  }

  // ─── (A2c) REGRESSION: a large caller estimate over the hard window but NO messages
  //     to shave (empty/absent messages) must NOT produce an inconsistent hard_truncate
  //     plan with an empty candidate set. It flows to 'none' while overHardLimit=true.
  {
    const p = planCompactionTier({ estimatedTokens: 900_000, contextWindowTokens: W, messages: [] });
    assert(wellFormedPlan(p), '(A2c) well-formed (no empty-candidate hard_truncate)');
    assertEq(p.overHardLimit, true, '(A2c) overHardLimit still signals the over-window condition');
    assert(!(p.tier === 'hard_truncate' && p.hardTruncateCandidates.length === 0), '(A2c) never hard_truncate with nothing to shave');
    assertEq(p.tier, 'none', '(A2c) no shave targets → none');
    assertEq(p.hardTruncateCandidates.length, 0, '(A2c) no candidates');
    assertEq(p.hardTruncateOverageTokens, 0, '(A2c) no overage on a non-emergency tier');
    // omitting `messages` entirely reaches the same degenerate-safe plan
    const p2 = planCompactionTier({ estimatedTokens: 900_000, contextWindowTokens: W });
    assert(wellFormedPlan(p2), '(A2c) well-formed with messages omitted');
    assertEq(p2.tier, 'none', '(A2c) messages omitted → none, not empty hard_truncate');
  }

  // ─── (A3) drop insufficient but drop+summarise fits → summarize_oldest ───────
  {
    const msgs: CompactionTierMessageView[] = [];
    for (let i = 0; i < 4; i++) msgs.push(view(20_000, { tool: true })); // drop 80000 chars = 20000 tok
    for (let i = 0; i < 4; i++) msgs.push(view(20_000)); // summarize 80000*0.8=64000 chars = 16000 tok
    msgs.push(view(500));
    msgs.push(view(500));
    const p = planCompactionTier({ estimatedTokens: 180_000, contextWindowTokens: W, keepRecentCount: 2, messages: msgs });
    assert(wellFormedPlan(p), '(A3) well-formed');
    assertEq(p.tier, 'summarize_oldest', '(A3) drop alone insufficient → summarize_oldest');
    assertEq(p.freeableByDropTokens, 20_000, '(A3) drop tokens 20000');
    assertEq(p.freeableBySummarizeTokens, 16_000, '(A3) summarize tokens 16000');
    assert(p.projectedTokensAfterDrop > p.targetTokens, '(A3) afterDrop above target (why not drop-only)');
    assert(p.projectedTokensAfterDropAndSummarize <= p.hardLimitTokens, '(A3) afterBoth under hard limit (safe from 400)');
  }

  // ─── (A4) over-trigger, everything protected, under hard limit → none ────────
  {
    // matches openswan keepAll: over trigger but nothing compactable & under hard.
    const msgs = [view(300, { prot: true }), view(300, { prot: true }), view(300, { prot: true, tool: true }), view(300, { prot: true })];
    const p = planCompactionTier({ estimatedTokens: 170_000, contextWindowTokens: W, messages: msgs });
    assert(wellFormedPlan(p), '(A4) well-formed');
    assertEq(p.tier, 'none', '(A4) all protected & under hard → none (not a summarise no-op)');
    assertEq(p.shouldCompact, false, '(A4) shouldCompact false');
    assertEq(p.overSoftTrigger, true, '(A4) is over soft trigger');
    assertEq(p.overHardLimit, false, '(A4) under hard limit');
    assertEq(p.freeableByDropTokens, 0, '(A4) nothing droppable');
    assertEq(p.freeableBySummarizeTokens, 0, '(A4) nothing summarizable');
    assert(p.reason.includes('nothing compactable'), '(A4) reason explains nothing compactable');
  }

  // ─── (A5) one giant PROTECTED recent tool_result over window → hard_truncate ─
  {
    // 4 small unprotected text, msg4 = HUGE protected (4M chars), msg5 = small protected.
    // keepRecent 2 → recentStart 4 (msg4 not a tool_result → no pullback) → protected {4,5}.
    const msgs = [view(1000), view(1000), view(1000), view(1000), view(4_000_000, { tool: true, prot: true }), view(1000)];
    const p = planCompactionTier({ contextWindowTokens: W, keepRecentCount: 2, messages: msgs });
    assert(wellFormedPlan(p), '(A5) well-formed');
    assertEq(p.tier, 'hard_truncate', '(A5) giant protected recent → hard_truncate');
    assertEq(p.overHardLimit, true, '(A5) over hard limit');
    assert(p.hardTruncateOverageTokens > 0, '(A5) overage > 0');
    assert(p.hardTruncateCandidates.length > 0, '(A5) at least one candidate');
    assert(p.hardTruncateCandidates.every((i) => i === 4 || i === 5), '(A5) candidates ⊆ protected {4,5}');
    assert(p.hardTruncateCandidates.includes(4), '(A5) the huge msg (4) is a candidate');
    assert(!p.hardTruncateCandidates.some((i) => i <= 3), '(A5) no unprotected msg is a candidate');
    assert(p.projectedTokensAfterDropAndSummarize > p.hardLimitTokens, '(A5) afterBoth exceeds hard limit');
  }

  // ─── (A6) proactive drop past turn 40 (fight long-context rot) → drop_tool_noise ─
  {
    const msgs: CompactionTierMessageView[] = [];
    for (let i = 0; i < 8; i++) msgs.push(view(5_000, { tool: true })); // 40000 chars = 10000 tok droppable
    msgs.push(view(500));
    msgs.push(view(500));
    const p = planCompactionTier({ estimatedTokens: 100_000, contextWindowTokens: W, keepRecentCount: 2, turnCount: 50, messages: msgs });
    assert(wellFormedPlan(p), '(A6) well-formed');
    assertEq(p.tier, 'drop_tool_noise', '(A6) long run + droppable + moderate load → proactive drop');
    assertEq(p.overSoftTrigger, false, '(A6) still under the soft trigger');
    assert(p.freeableByDropTokens >= 2_000, '(A6) enough droppable to trigger proactive');
    assert(p.reason.includes('proactive'), '(A6) reason marks the proactive path');
  }

  // ─── (A7) proactive NOT triggered when turnCount below threshold → none ──────
  {
    const msgs: CompactionTierMessageView[] = [];
    for (let i = 0; i < 8; i++) msgs.push(view(5_000, { tool: true }));
    msgs.push(view(500)); msgs.push(view(500));
    const p = planCompactionTier({ estimatedTokens: 100_000, contextWindowTokens: W, keepRecentCount: 2, turnCount: 10, messages: msgs });
    assertEq(p.tier, 'none', '(A7) turnCount < 40 → no proactive drop');
    assert(PROACTIVE_DROP_TURN_THRESHOLD === 40, '(A7) threshold is 40');
  }

  // ─── (A8) proactive NOT triggered when load below pressure floor → none ──────
  {
    const msgs: CompactionTierMessageView[] = [];
    for (let i = 0; i < 8; i++) msgs.push(view(5_000, { tool: true }));
    msgs.push(view(500)); msgs.push(view(500));
    // est 85000 < softTrigger*0.6 = 90000 → below pressure floor.
    const p = planCompactionTier({ estimatedTokens: 85_000, contextWindowTokens: W, keepRecentCount: 2, turnCount: 99, messages: msgs });
    assertEq(p.tier, 'none', '(A8) below pressure floor → no proactive drop despite high turn count');
  }

  // ─── (B) OUTPUT/INVARIANTS on a representative plan ──────────────────────────
  {
    const p = planCompactionTier({ estimatedTokens: 175_500, contextWindowTokens: W, messages: [view(1000, { prot: true })] });
    assert(wellFormedPlan(p), '(B) representative plan well-formed');
    assertEq(p.pressureRatio, 0.878, '(B) pressureRatio rounds to 3dp (175500/200000=0.8775→0.878)');
    assertEq(p.estimatedTokens, 175_500, '(B) estimatedTokens echoed');
    assert(p.reason.length <= MAX_REASON_CHARS, '(B) reason within cap');
  }

  // ─── (C1) est exactly at soft trigger → none (strict >) ──────────────────────
  {
    const p = planCompactionTier({ estimatedTokens: SOFT, contextWindowTokens: W, messages: [view(1000, { tool: true }), view(1000, { tool: true }), view(1000, { tool: true })] });
    assertEq(p.tier, 'none', '(C1) est === softTrigger is NOT over (strict >) → none');
    assertEq(p.overSoftTrigger, false, '(C1) overSoftTrigger false at boundary');
  }
  // ─── (C1b) est one over the trigger with freeable → compaction ───────────────
  {
    const msgs = [view(400_000, { tool: true }), view(500), view(500)];
    const p = planCompactionTier({ estimatedTokens: SOFT + 1, contextWindowTokens: W, keepRecentCount: 2, messages: msgs });
    assertEq(p.overSoftTrigger, true, '(C1b) one over the trigger');
    assertEq(p.shouldCompact, true, '(C1b) compaction warranted');
    assert(p.tier === 'drop_tool_noise' || p.tier === 'summarize_oldest', '(C1b) picks a compaction tier');
  }

  // ─── (C2) window clamps ──────────────────────────────────────────────────────
  {
    const pHi = planCompactionTier({ contextWindowTokens: 999_999_999_999, messages: [view(10)] });
    assertEq(pHi.softTriggerTokens, Math.floor(CONTEXT_WINDOW_MAX * CONTEXT_SAFETY_FRACTION), '(C2) huge window clamped to CONTEXT_WINDOW_MAX');
    const pLo = planCompactionTier({ contextWindowTokens: 100, messages: [view(10)] });
    assertEq(pLo.softTriggerTokens, Math.floor(CONTEXT_WINDOW_MIN * CONTEXT_SAFETY_FRACTION), '(C2) tiny window clamped to CONTEXT_WINDOW_MIN');
    const pDef = planCompactionTier({ contextWindowTokens: 'not-a-number', messages: [view(10)] });
    assertEq(pDef.softTriggerTokens, Math.floor(DEFAULT_CONTEXT_WINDOW_TOKENS * CONTEXT_SAFETY_FRACTION), '(C2) garbage window → default');
  }

  // ─── (C3) reserved-output clamp drives hardLimit ─────────────────────────────
  {
    const pBig = planCompactionTier({ contextWindowTokens: W, reservedOutputTokens: 999_999, messages: [view(10)] });
    assertEq(pBig.hardLimitTokens, W - Math.floor(W / 2), '(C3) reserved clamped to floor(window/2)');
    const pNeg = planCompactionTier({ contextWindowTokens: W, reservedOutputTokens: -5, messages: [view(10)] });
    assertEq(pNeg.hardLimitTokens, W, '(C3) negative reserved clamped to 0 → hardLimit = window');
    const pDef = planCompactionTier({ contextWindowTokens: W, messages: [view(10)] });
    assertEq(pDef.hardLimitTokens, W - DEFAULT_RESERVED_OUTPUT_TOKENS, '(C3) default reserved applied');
  }

  // ─── (C4) candidate cap + deterministic tiebreak (40 equal huge protected) ───
  {
    const msgs: CompactionTierMessageView[] = [];
    for (let i = 0; i < 40; i++) msgs.push(view(4_000_000, { tool: true, prot: true }));
    const p = planCompactionTier({ contextWindowTokens: W, keepRecentCount: KEEP_RECENT_MAX, messages: msgs });
    assertEq(p.tier, 'hard_truncate', '(C4) 40 huge protected → hard_truncate');
    assertEq(p.hardTruncateCandidates.length, MAX_HARD_TRUNCATE_CANDIDATES, '(C4) candidates capped at MAX_HARD_TRUNCATE_CANDIDATES');
    const expected = Array.from({ length: MAX_HARD_TRUNCATE_CANDIDATES }, (_, i) => i);
    assertEq(JSON.stringify(p.hardTruncateCandidates), JSON.stringify(expected), '(C4) equal-size tiebreak = first 32 by index, ascending');
  }

  // ─── (C5) est over hardLimit but freeable brings afterBoth under → summarize ─
  {
    // est 195000 > hardLimit 192000 (overHardLimit true) yet drop+summarise fits.
    // msg0 tool 8000 chars (drop 2000 tok); msg1 text 10000 chars (summarize 2000 tok);
    // msg2,3 unprotected empty; msg4,5 protected. afterBoth = 195000-2000-2000 = 191000 ≤ hard.
    const msgs = [view(8_000, { tool: true }), view(10_000), view(0), view(0), view(300), view(300)];
    const p = planCompactionTier({ estimatedTokens: 195_000, contextWindowTokens: W, keepRecentCount: 2, messages: msgs });
    assert(wellFormedPlan(p), '(C5) well-formed');
    assertEq(p.tier, 'summarize_oldest', '(C5) over hard but compaction fits → summarize, NOT hard_truncate');
    assertEq(p.overHardLimit, true, '(C5) overHardLimit is true here');
    assertEq(p.hardTruncateCandidates.length, 0, '(C5) no hard-truncate candidates when compaction suffices');
    assertEq(p.hardTruncateOverageTokens, 0, '(C5) no overage when not hard_truncate');
    assert(p.projectedTokensAfterDropAndSummarize <= p.hardLimitTokens, '(C5) afterBoth fits the hard limit');
  }

  // ─── (C6) tiny window: est ≤ softTrigger but afterBoth > hardLimit → emergency ─
  {
    // window 4000 → soft 3000, reserved clamps to 2000 → hardLimit 2000. est 2500 is
    // UNDER the soft trigger yet OVER the hard limit; emergency must win over the
    // proactive/none path (emergency is evaluated first).
    const p = planCompactionTier({ estimatedTokens: 2_500, contextWindowTokens: 4_000, messages: [view(300, { prot: true }), view(300, { prot: true })] });
    assert(wellFormedPlan(p), '(C6) well-formed');
    assertEq(p.softTriggerTokens, 3_000, '(C6) softTrigger 3000');
    assertEq(p.hardLimitTokens, 2_000, '(C6) hardLimit 2000 (reserved clamped to window/2)');
    assertEq(p.overSoftTrigger, false, '(C6) est is UNDER the soft trigger');
    assertEq(p.tier, 'hard_truncate', '(C6) emergency evaluated FIRST → hard_truncate even under soft trigger');
    assert(p.hardTruncateOverageTokens > 0 && p.hardTruncateCandidates.length > 0, '(C6) overage + candidates present');
  }

  // ─── (D) DETERMINISM ─────────────────────────────────────────────────────────
  {
    const mk = () => ({ estimatedTokens: 900_000, contextWindowTokens: W, keepRecentCount: 2, turnCount: 7, messages: [view(1000), view(2_000_000, { tool: true, prot: true }), view(500)] });
    assertEq(JSON.stringify(planCompactionTier(mk())), JSON.stringify(planCompactionTier(mk())), '(D) identical input → identical output');
    const mk2 = () => ({ estimatedTokens: 160_000, contextWindowTokens: W, keepRecentCount: 2, messages: [view(30_000, { tool: true }), view(30_000, { tool: true }), view(500), view(500)] });
    assertEq(JSON.stringify(planCompactionTier(mk2())), JSON.stringify(planCompactionTier(mk2())), '(D) drop-decision stable');
  }

  // ─── (F) SECRET-SAFETY: no message-derived string leaks into the reason ──────
  {
    const p = planCompactionTier({ estimatedTokens: 900_000, contextWindowTokens: W, keepRecentCount: 2, messages: [view(1000, { role: 'ZZSECRETZZ_role' }), view(4_000_000, { tool: true, prot: true }), view(500)] });
    assert(isCleanLabel(p.reason), '(F) reason is a clean label');
    assert(!p.reason.includes('ZZSECRET'), '(F) role text never leaks into the reason');
    assert(!p.reason.includes(BACKTICK) && !p.reason.includes(LT) && !p.reason.includes(GT), '(F) no prompt-fence chars in reason');
  }

  // ─── (F) HOSTILE — never throws, always well-formed + bounded ────────────────
  const cyclic: Record<string, unknown> = { contentLen: 100, isToolResult: true };
  cyclic.self = cyclic;

  const throwingMsg = new Proxy({}, { get() { throw new Error('boom-get'); } });
  const topProxy = new Proxy({}, {
    get() { throw new Error('boom-get'); },
    has() { throw new Error('boom-has'); },
    ownKeys() { throw new Error('boom-keys'); },
    getOwnPropertyDescriptor() { throw new Error('boom-desc'); },
  });
  const arrayLengthProxy = new Proxy([], {
    get(t, k) { if (k === 'length') throw new Error('boom-length'); return (t as Record<string | symbol, unknown>)[k]; },
  });
  const throwingContentLen = { get contentLen(): number { throw new Error('boom-contentLen'); }, isToolResult: true };
  const protoMsg = JSON.parse('{"__proto__":{"contentLen":999999},"contentLen":50,"isToolResult":true}');
  const ctorMsg = JSON.parse('{"constructor":{"contentLen":888},"contentLen":40}');
  const hugeArray = Array.from({ length: MAX_MESSAGES + 25 }, () => view(20, { tool: true }));
  const roleControl = view(1000, { role: 'sys' + NUL + BEL + ESC + DEL + C1 + LS + PS + TAG + BOM + 'tem' });
  const roleAstral = view(1000, { role: ASTRAL + 'system' + ASTRAL });
  const roleLoneHi = view(1000, { role: LONE_HI + 'system' });
  const roleLoneLo = view(1000, { role: 'system' + LONE_LO });

  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['negative-number', -1],
    ['string', 'garbage'],
    ['boolean', true],
    ['empty-object', {}],
    ['array', []],
    ['bigint', 10n],
    ['symbol-field', { estimatedTokens: Symbol('s') as unknown }],
    ['NaN-est', { estimatedTokens: NaN, messages: [view(10)] }],
    ['Infinity-est', { estimatedTokens: Infinity, messages: [view(10)] }],
    ['neg-Infinity-est', { estimatedTokens: -Infinity, messages: [view(10)] }],
    ['huge-est', { estimatedTokens: 1e300, messages: [view(10)] }],
    ['bigint-est', { estimatedTokens: 9007199254740993n, contextWindowTokens: 1000000n, messages: [view(10)] }],
    ['huge-contentLen', { messages: [view(Number.MAX_SAFE_INTEGER), view(1e300)] }],
    ['negative-contentLen', { messages: [view(-500, { tool: true })] }],
    ['NaN-contentLen', { messages: [{ contentLen: NaN, isToolResult: true }] }],
    ['messages-not-array', { messages: 'nope' }],
    ['messages-with-nulls', { messages: [null, undefined, 5, 'x', true, {}] }],
    ['cyclic-message', { estimatedTokens: 900000, messages: [cyclic, view(4_000_000, { tool: true, prot: true }), view(10)] }],
    ['throwing-getter-message', { messages: [throwingMsg, view(10)] }],
    ['throwing-contentLen-getter', { messages: [throwingContentLen, view(10)] }],
    ['top-level-throwing-proxy', topProxy],
    ['hostile-array-length-proxy', { messages: arrayLengthProxy }],
    ['proto-key-message', { estimatedTokens: 900000, messages: [protoMsg, view(4_000_000, { tool: true, prot: true })] }],
    ['constructor-key-message', { messages: [ctorMsg] }],
    ['huge-array', { estimatedTokens: 900000, contextWindowTokens: W, messages: hugeArray }],
    ['control-char-role', { estimatedTokens: 900000, messages: [roleControl, view(4_000_000, { tool: true, prot: true })] }],
    ['astral-role', { messages: [roleAstral] }],
    ['lone-high-surrogate-role', { messages: [roleLoneHi] }],
    ['lone-low-surrogate-role', { messages: [roleLoneLo] }],
    ['turnCount-garbage', { estimatedTokens: 100000, contextWindowTokens: W, turnCount: 'lots' as unknown, messages: [view(5000, { tool: true })] }],
    ['turnCount-Infinity', { estimatedTokens: 100000, contextWindowTokens: W, turnCount: Infinity, messages: [view(5000, { tool: true })] }],
    ['negative-window', { contextWindowTokens: -50, messages: [view(10)] }],
    ['keepRecent-garbage', { keepRecentCount: {} as unknown, messages: [view(10), view(10)] }],
    ['everything-negative', { estimatedTokens: -9, contextWindowTokens: -9, reservedOutputTokens: -9, keepRecentCount: -9, turnCount: -9, messages: [view(-9, { tool: true })] }],
  ];

  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const p = planCompactionTier(input as never);
      assert(wellFormedPlan(p), '(F) well-formed plan :: ' + label);
      assert(isCleanLabel(p.reason), '(F) clean reason :: ' + label);
      assertLE(p.hardTruncateCandidates.length, MAX_HARD_TRUNCATE_CANDIDATES, '(F) candidates bounded :: ' + label);
      assertLE(p.freeableByDropTokens, MAX_MESSAGES * MAX_CONTENT_LEN, '(F) freeableDrop bounded :: ' + label);
    }, '(F) planCompactionTier never throws :: ' + label);
  }

  // no prototype pollution from __proto__ / constructor message keys
  assert(({} as Record<string, unknown>).polluted === undefined, '(F) no instance prototype pollution');
  assert((Object.prototype as Record<string, unknown>).polluted === undefined, '(F) Object.prototype untouched');
  assertEq(({} as Record<string, unknown>).contentLen, undefined, '(F) __proto__ contentLen did not leak onto plain objects');

  // control-char role still yields a clean, secret-safe plan
  {
    const p = planCompactionTier({ estimatedTokens: 900000, contextWindowTokens: W, keepRecentCount: 2, messages: [roleControl, view(4_000_000, { tool: true, prot: true }), view(10)] });
    assert(isCleanLabel(p.reason), '(F) control-char role → clean reason');
    assert(p.tier === 'hard_truncate', '(F) control-char role case still routes to hard_truncate');
  }

  // huge array is scanned but bounded; still a well-formed plan
  {
    const p = planCompactionTier({ estimatedTokens: 900000, contextWindowTokens: W, messages: hugeArray });
    assert(wellFormedPlan(p), '(F) huge array → well-formed');
    assert(Number.isFinite(p.pressureRatio) && p.pressureRatio >= 0, '(F) huge array → finite pressureRatio');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll context-compaction-tier-core smoke cases passed (' + passes + ' passed).');
}

main();
