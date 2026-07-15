/**
 * context-depth-policy-smoketest — the pure user-controlled context dial
 * (src/lib/contextDepthPolicy.ts) behind the `/context` command. Load-bearing
 * assertions:
 *
 *   IDENTITY: 'standard' is a true identity transform — applyContextDepthToPolicy
 *   returns the SAME policy object for every complexity tier, so users who never
 *   touch the dial get byte-identical prompts.
 *
 *   LEAN: caps extras/retrieval budgets and drops wisdom/missions, but never
 *   RAISES a budget that was already below the cap.
 *
 *   MAX: forces every context family on, boosts budgets to at least the MAX_*
 *   constants (never lowers a larger incoming budget), and floors complexity at
 *   'complex' via resolveContextDepthComplexityFloor + composeComplexityFloors.
 *
 *   RECEIPT: renders section labels + char counts + total, adds the clip note
 *   and the `/context max` tip only when clipped below max depth, tolerates
 *   null/degenerate input, and the label map covers EVERY section key in
 *   CHAT_PROMPT_SECTION_ORDER (drift guard for new sections).
 *
 *   STORAGE: fail-soft in node (no localStorage) → 'standard' + setter returns
 *   false without throwing; with a stubbed localStorage the roundtrip works and
 *   junk stored values fall back to 'standard'.
 *
 * Pure — loads under tsx (contextDepthPolicy + chatPromptAssembly are both
 * dependency-light pure modules).
 */

import {
  parseContextDepth,
  resolveStoredContextDepth,
  setStoredContextDepth,
  resolveContextDepthComplexityFloor,
  composeComplexityFloors,
  applyContextDepthToPolicy,
  describeContextDepthSetting,
  buildContextReceipt,
  recordContextReceipt,
  getLastContextReceipt,
  CONTEXT_SECTION_LABELS,
  CONTEXT_DEPTH_STORAGE_KEY,
  LEAN_DEPTH_EXTRAS_CHARS,
  MAX_DEPTH_EXTRAS_CHARS,
  MAX_DEPTH_RETRIEVAL_BUDGET,
  MAX_DEPTH_RETRIEVAL_COUNT,
} from '../src/lib/contextDepthPolicy';
import {
  CHAT_PROMPT_SECTION_ORDER,
  resolveChatPromptContextPolicy,
  type ChatPromptComplexity,
} from '../src/lib/chatPromptAssembly';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const TIERS: ChatPromptComplexity[] = ['trivial', 'simple', 'moderate', 'complex'];

function main(): void {
  // ─── (1) parser ───────────────────────────────────────────────────────────
  for (const v of ['lean', 'minimal', 'LOW', ' fast ']) assertEq(parseContextDepth(v), 'lean', `(1) "${v}" → lean`);
  for (const v of ['standard', 'default', 'auto', 'off']) assertEq(parseContextDepth(v), 'standard', `(1) "${v}" → standard`);
  for (const v of ['max', 'FULL', 'everything', 'deep']) assertEq(parseContextDepth(v), 'max', `(1) "${v}" → max`);
  for (const v of ['', 'huge', 42, null, undefined, {}]) assertEq(parseContextDepth(v as never), null, `(1) ${JSON.stringify(v)} → null`);

  // ─── (2) standard is a true identity ──────────────────────────────────────
  for (const tier of TIERS) {
    const p = resolveChatPromptContextPolicy(tier);
    assert(applyContextDepthToPolicy(p, 'standard') === p, `(2) standard returns the SAME object for ${tier}`);
  }

  // ─── (3) lean caps, never raises ──────────────────────────────────────────
  const leanComplex = applyContextDepthToPolicy(resolveChatPromptContextPolicy('complex'), 'lean');
  assertEq(leanComplex.loadWisdom, false, '(3) lean drops wisdom');
  assertEq(leanComplex.loadMissions, false, '(3) lean drops missions');
  assertEq(leanComplex.maxExtrasChars, LEAN_DEPTH_EXTRAS_CHARS, '(3) lean caps complex extras to the lean budget');
  assert(leanComplex.loadMemory && leanComplex.loadSkills && leanComplex.loadProfile, '(3) lean keeps profile+memory+skills');
  const leanTrivial = applyContextDepthToPolicy(resolveChatPromptContextPolicy('trivial'), 'lean');
  assertEq(leanTrivial.maxExtrasChars, resolveChatPromptContextPolicy('trivial').maxExtrasChars, '(3) lean never raises a smaller budget');

  // ─── (4) max boosts, never lowers ─────────────────────────────────────────
  const maxTrivial = applyContextDepthToPolicy(resolveChatPromptContextPolicy('trivial'), 'max');
  assert(
    maxTrivial.loadProfile && maxTrivial.loadMemory && maxTrivial.loadWisdom
      && maxTrivial.loadRetrieval && maxTrivial.loadMissions && maxTrivial.loadSkills,
    '(4) max forces every context family on',
  );
  assertEq(maxTrivial.maxExtrasChars, MAX_DEPTH_EXTRAS_CHARS, '(4) max boosts extras budget');
  assertEq(maxTrivial.retrievalBudget, MAX_DEPTH_RETRIEVAL_BUDGET, '(4) max boosts retrieval budget');
  assertEq(maxTrivial.retrievalCount, MAX_DEPTH_RETRIEVAL_COUNT, '(4) max boosts retrieval count');
  const bigIncoming = { ...resolveChatPromptContextPolicy('complex'), maxExtrasChars: 50_000 };
  assertEq(applyContextDepthToPolicy(bigIncoming, 'max').maxExtrasChars, 50_000, '(4) max never lowers a larger incoming budget');

  // ─── (5) floors ───────────────────────────────────────────────────────────
  assertEq(resolveContextDepthComplexityFloor('max'), 'complex', '(5) max floors complex');
  assertEq(resolveContextDepthComplexityFloor('standard'), null, '(5) standard has no floor');
  assertEq(resolveContextDepthComplexityFloor('lean'), null, '(5) lean has no floor');
  assertEq(composeComplexityFloors('moderate', 'complex'), 'complex', '(5) compose takes the higher floor');
  assertEq(composeComplexityFloors('complex', 'moderate'), 'complex', '(5) compose is order-independent');
  assertEq(composeComplexityFloors(null, 'moderate'), 'moderate', '(5) compose tolerates null a');
  assertEq(composeComplexityFloors('simple', null), 'simple', '(5) compose tolerates null b');
  assertEq(composeComplexityFloors(null, undefined), null, '(5) compose of nothing is null');

  // ─── (6) receipt ──────────────────────────────────────────────────────────
  for (const key of CHAT_PROMPT_SECTION_ORDER) {
    assert(Boolean(CONTEXT_SECTION_LABELS[key]), `(6) label exists for section "${key}"`);
  }
  const receipt = buildContextReceipt({
    depth: 'standard',
    complexity: 'moderate',
    rendered: [
      { key: 'last_session', chars: 1200 },
      { key: 'turn_retrieval', chars: 800 },
    ],
    clipped: true,
    maxExtrasChars: 5500,
  });
  assert(receipt.includes('Previous sessions + persistent knowledge'), '(6) receipt uses human labels');
  assert(receipt.includes('2,000'), '(6) receipt totals chars');
  assert(receipt.includes('clipped'), '(6) receipt notes clipping');
  assert(receipt.includes('/context max'), '(6) clipped-below-max receipt carries the upgrade tip');
  const maxReceipt = buildContextReceipt({ depth: 'max', complexity: 'complex', rendered: [{ key: 'skills', chars: 10 }], clipped: true, maxExtrasChars: 16_000 });
  assert(!maxReceipt.includes('/context max'), '(6) no upgrade tip at max depth');
  const cleanReceipt = buildContextReceipt({ depth: 'standard', complexity: 'simple', rendered: [{ key: 'skills', chars: 10 }], clipped: false, maxExtrasChars: 3000 });
  assert(!cleanReceipt.includes('clipped'), '(6) unclipped receipt has no clip note');
  assert(buildContextReceipt(null).includes('No context receipt yet'), '(6) null input → friendly empty message');
  assert(buildContextReceipt({ depth: 'standard', complexity: 'trivial', rendered: [], clipped: false, maxExtrasChars: 1200 }).includes('base prompt only'), '(6) empty rendered → base-only note');

  // ─── (7) storage fail-soft in node (order matters: before any setter) ─────
  assertEq(resolveStoredContextDepth(), 'standard', '(7) no localStorage, no session set → standard');
  assertEq(resolveStoredContextDepth('max'), 'max', '(7) explicit override wins');
  // Junk stored value falls back to standard (tested before the session
  // override exists, which would otherwise mask storage entirely).
  const backing = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => { backing.set(k, v); },
  };
  try {
    backing.set(CONTEXT_DEPTH_STORAGE_KEY, 'garbage-value');
    assertEq(resolveStoredContextDepth(), 'standard', '(7) junk stored value falls back to standard');
    backing.set(CONTEXT_DEPTH_STORAGE_KEY, 'max');
    assertEq(resolveStoredContextDepth(), 'max', '(7) valid stored value reads through');

    // ─── (8) setter: session-applies always, persistence when storage exists ─
    assertEq(setStoredContextDepth('lean'), true, '(8) setter persists through the stub');
    assertEq(backing.get(CONTEXT_DEPTH_STORAGE_KEY), 'lean', '(8) stored under the canonical key');
    assertEq(resolveStoredContextDepth(), 'lean', '(8) reader roundtrips');
  } finally {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  }
  // Without storage the set still applies for the session (native fallback)…
  assertEq(setStoredContextDepth('max'), false, '(8) no storage → returns false (not persisted)');
  assertEq(resolveStoredContextDepth(), 'max', '(8) …but the session override still applies');

  // ─── (9) receipt store ────────────────────────────────────────────────────
  recordContextReceipt({ depth: 'max', complexity: 'complex', rendered: [{ key: 'skills', chars: 5 }], clipped: false, maxExtrasChars: 16_000 });
  assertEq(getLastContextReceipt()?.depth, 'max', '(9) record/get roundtrip');
  recordContextReceipt(null as never);
  assertEq(getLastContextReceipt()?.depth, 'max', '(9) degenerate record is ignored, last receipt kept');

  // ─── (10) describe lines exist for each level ─────────────────────────────
  for (const d of ['lean', 'standard', 'max'] as const) {
    assert(describeContextDepthSetting(d).toLowerCase().includes(d), `(10) describe(${d}) names the level`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll context-depth-policy smoke cases passed (${passes} passed).`);
}

main();
