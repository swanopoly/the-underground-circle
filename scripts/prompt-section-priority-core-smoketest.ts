/**
 * prompt-section-priority-core-smoketest — src/lib/promptSectionPriorityCore.ts,
 * the priority-aware fit that keeps the MOST valuable prompt sections when the
 * extras budget is tight, instead of blindly clipping the tail (which kills
 * `last_session` first). Load-bearing assertions:
 *
 *   GROUNDING: DEFAULT_SECTION_PRIORITY covers EXACTLY the real registry
 *   (`CHAT_PROMPT_SECTION_ORDER` from chatPromptAssembly.ts), SECTION_EMIT_ORDER
 *   mirrors it byte-for-byte, and the ranking puts identity/current-task high and
 *   decorative low — with `last_session` above every decorative section (the
 *   whole point of the module).
 *
 *   FIT: budget-fits-all → keep all; a tight budget drops the LOWEST-PRIORITY
 *   sections first (NOT the emit tail — a late high-value section outranks an
 *   early decorative one); a high-priority over-budget section TRUNCATES rather
 *   than drops; a low-priority over-budget section drops; keptTokens ≤ budget.
 *
 *   TOTALITY: deterministic, stable emit-order output, exact partition
 *   (keep ∪ drop ∪ truncate, each key once), and every export total on
 *   null/undefined/wrong/huge/hostile/cyclic input (no throw).
 *
 * Pure — loads under tsx (promptSectionPriorityCore + chatPromptAssembly are
 * both dependency-light pure modules).
 */

import {
  planSectionFit,
  resolveSectionPriority,
  DEFAULT_SECTION_PRIORITY,
  SECTION_EMIT_ORDER,
  SECTION_PRIORITY_NEUTRAL,
  DEFAULT_TRUNCATE_MIN_PRIORITY,
  DEFAULT_MIN_TRUNCATE_TOKENS,
  EMPTY_SECTION_FIT_PLAN,
  type SectionInput,
  type PlanSectionFitResult,
} from '../src/lib/promptSectionPriorityCore';
import { CHAT_PROMPT_SECTION_ORDER, type ChatPromptSectionKey } from '../src/lib/chatPromptAssembly';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertDeep(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function noThrow(fn: () => unknown, msg: string): void {
  try { fn(); passes += 1; }
  catch (e) { failures += 1; console.error(`FAIL: ${msg} :: threw ${String(e)}`); }
}

const sec = (key: string, tokens: number, priority?: number): SectionInput => ({
  key,
  tokens,
  priority: priority ?? resolveSectionPriority(key),
});

function isValidPlan(p: unknown): p is PlanSectionFitResult {
  if (!p || typeof p !== 'object') return false;
  const r = p as PlanSectionFitResult;
  return (
    Array.isArray(r.keep) && r.keep.every((k) => typeof k === 'string') &&
    Array.isArray(r.drop) && r.drop.every((k) => typeof k === 'string') &&
    Array.isArray(r.truncate) &&
    r.truncate.every((t) => t && typeof t.key === 'string' && Number.isFinite(t.toTokens) && t.toTokens >= 0) &&
    typeof r.keptTokens === 'number' && Number.isFinite(r.keptTokens) && r.keptTokens >= 0
  );
}
/** Keys are a strictly-increasing subsequence of the canonical emit order. */
function isEmitOrdered(keys: string[]): boolean {
  let last = -1;
  for (const k of keys) {
    const i = SECTION_EMIT_ORDER.indexOf(k as ChatPromptSectionKey);
    if (i < 0) continue; // unknown keys are order-checked separately
    if (i <= last) return false;
    last = i;
  }
  return true;
}
function allKeys(p: PlanSectionFitResult): string[] {
  return [...p.keep, ...p.drop, ...p.truncate.map((t) => t.key)];
}

const DECORATIVE: ChatPromptSectionKey[] = ['soul_wisdom', 'missions', 'wiki_context', 'circle_snapshot'];

function main(): void {
  // ─── (1) DEFAULT_SECTION_PRIORITY grounded to the REAL registry ────────────
  const priKeys = Object.keys(DEFAULT_SECTION_PRIORITY);
  assertEq(priKeys.length, CHAT_PROMPT_SECTION_ORDER.length, '(1) priority map covers whole registry (count)');
  for (const key of CHAT_PROMPT_SECTION_ORDER) {
    const v = (DEFAULT_SECTION_PRIORITY as Record<string, number>)[key];
    assert(typeof v === 'number' && Number.isFinite(v), `(1) ranked: ${key}`, String(v));
  }
  const registrySet = new Set<string>(CHAT_PROMPT_SECTION_ORDER);
  for (const k of priKeys) assert(registrySet.has(k), `(1) no phantom key: ${k}`);
  // Ranking intent: identity/current-task high; decorative low.
  assert(DEFAULT_SECTION_PRIORITY.runtime_bundle >= 90, '(1) runtime_bundle is top-tier');
  assert(DEFAULT_SECTION_PRIORITY.agent_identity >= 90, '(1) agent_identity is top-tier');
  assert(DEFAULT_SECTION_PRIORITY.task_pipeline >= 85, '(1) current-task (task_pipeline) high');
  assert(DEFAULT_SECTION_PRIORITY.attachment_context >= 80, '(1) user-supplied (attachment) high');
  assert(DEFAULT_SECTION_PRIORITY.circle_snapshot < 50, '(1) circle_snapshot decorative');
  assert(DEFAULT_SECTION_PRIORITY.wiki_context < 50, '(1) wiki_context decorative');
  // THE POINT: last_session outranks EVERY decorative section, so a tight budget
  // keeps continuity over decoration (the legacy tail-clip did the reverse).
  for (const d of DECORATIVE) {
    assert(DEFAULT_SECTION_PRIORITY.last_session > DEFAULT_SECTION_PRIORITY[d], `(1) last_session > ${d}`);
  }
  assert(DEFAULT_SECTION_PRIORITY.runtime_bundle > DEFAULT_SECTION_PRIORITY.circle_snapshot, '(1) identity > decorative');

  // ─── (2) SECTION_EMIT_ORDER mirrors CHAT_PROMPT_SECTION_ORDER (lockstep) ────
  assertEq(SECTION_EMIT_ORDER.length, CHAT_PROMPT_SECTION_ORDER.length, '(2) emit order same length');
  for (let i = 0; i < CHAT_PROMPT_SECTION_ORDER.length; i += 1) {
    assertEq(SECTION_EMIT_ORDER[i], CHAT_PROMPT_SECTION_ORDER[i], `(2) emit[${i}] matches registry`);
  }

  // ─── (3) resolveSectionPriority ────────────────────────────────────────────
  assertEq(resolveSectionPriority('runtime_bundle'), DEFAULT_SECTION_PRIORITY.runtime_bundle, '(3) known → default');
  assertEq(resolveSectionPriority('last_session'), DEFAULT_SECTION_PRIORITY.last_session, '(3) known last_session → default');
  assertEq(resolveSectionPriority('totally-unknown'), SECTION_PRIORITY_NEUTRAL, '(3) unknown → neutral');
  assertEq(resolveSectionPriority(''), SECTION_PRIORITY_NEUTRAL, '(3) empty → neutral');
  assertEq(resolveSectionPriority(null), SECTION_PRIORITY_NEUTRAL, '(3) null → neutral');
  assertEq(resolveSectionPriority(42 as unknown), SECTION_PRIORITY_NEUTRAL, '(3) number → neutral');
  assertEq(resolveSectionPriority({} as unknown), SECTION_PRIORITY_NEUTRAL, '(3) object → neutral');
  noThrow(() => resolveSectionPriority(Symbol('x') as unknown), '(3) symbol no-throw');

  // ─── (4) budget fits all → keep all ────────────────────────────────────────
  {
    const s = [sec('runtime_bundle', 100), sec('last_session', 50), sec('circle_snapshot', 30)];
    const p = planSectionFit(s, 10_000);
    assertEq(p.keep.length, 3, '(4) all kept');
    assertEq(p.drop.length, 0, '(4) nothing dropped');
    assertEq(p.truncate.length, 0, '(4) nothing truncated');
    assertEq(p.keptTokens, 180, '(4) keptTokens = sum');
    assert(p.keptTokens <= 10_000, '(4) keptTokens ≤ budget');
    assert(isEmitOrdered(p.keep), '(4) keep in emit order');
    assertDeep(p.keep, ['runtime_bundle', 'circle_snapshot', 'last_session'], '(4) keep sorted to emit order');
  }

  // ─── (5) tight budget drops LOWEST priority first (not the tail blindly) ───
  {
    // runtime_bundle (hi) + last_session (hi, EMIT-TAIL) + soul_wisdom + circle_snapshot (both decorative).
    const s = [sec('runtime_bundle', 100), sec('last_session', 100), sec('soul_wisdom', 100), sec('circle_snapshot', 100)];
    const p = planSectionFit(s, 200);
    assert(p.keep.includes('last_session'), '(5) tail-but-high last_session SURVIVES', JSON.stringify(p.keep));
    assert(p.keep.includes('runtime_bundle'), '(5) runtime_bundle survives');
    assert(p.drop.includes('soul_wisdom'), '(5) decorative soul_wisdom dropped');
    assert(p.drop.includes('circle_snapshot'), '(5) decorative circle_snapshot dropped');
    assert(!p.keep.includes('circle_snapshot'), '(5) decorative NOT kept over continuity');
    assertEq(p.keptTokens, 200, '(5) keptTokens exact');
    assert(p.keptTokens <= 200, '(5) keptTokens ≤ budget');
    assert(isEmitOrdered(p.keep) && isEmitOrdered(p.drop), '(5) both arrays emit-ordered');
  }

  // ─── (5b) priority beats emit POSITION (early-low drops, late-high survives) ─
  {
    // design_object_manifest is EARLY in emit order (idx ~9) but mid priority;
    // last_session is LAST (idx 34) but higher priority. Budget fits one.
    const s = [sec('design_object_manifest', 100), sec('last_session', 100)];
    const p = planSectionFit(s, 100);
    assert(p.keep.includes('last_session'), '(5b) late high-value kept');
    assert(p.drop.includes('design_object_manifest'), '(5b) early low-value dropped — position did NOT win');
    assertEq(p.keptTokens, 100, '(5b) keptTokens exact');
  }

  // ─── (6) high-priority over-budget section TRUNCATES (not drops) ───────────
  {
    const p = planSectionFit([sec('memory_user_notes', 500)], 300);
    assertEq(p.keep.length, 0, '(6) not kept whole');
    assertEq(p.drop.length, 0, '(6) not dropped');
    assertEq(p.truncate.length, 1, '(6) truncated');
    assertEq(p.truncate[0]?.key, 'memory_user_notes', '(6) truncated key');
    assertEq(p.truncate[0]?.toTokens, 300, '(6) truncated to remaining budget');
    assertEq(p.keptTokens, 300, '(6) keptTokens = budget after truncate');
    assert(p.keptTokens <= 300, '(6) keptTokens ≤ budget');
  }

  // ─── (7) low-priority over-budget section DROPS (not truncate) ─────────────
  {
    const p = planSectionFit([sec('circle_snapshot', 500)], 300);
    assertEq(p.truncate.length, 0, '(7) decorative not truncated');
    assert(p.drop.includes('circle_snapshot'), '(7) decorative dropped whole');
    assertEq(p.keptTokens, 0, '(7) nothing kept');
  }

  // ─── (8) truncate fills remaining, then the rest drops ─────────────────────
  {
    const s = [sec('runtime_bundle', 100), sec('memory_user_notes', 200), sec('circle_snapshot', 100)];
    const p = planSectionFit(s, 250);
    assertDeep(p.keep, ['runtime_bundle'], '(8) whole-fit kept');
    assertEq(p.truncate.length, 1, '(8) one truncate');
    assertEq(p.truncate[0]?.key, 'memory_user_notes', '(8) higher-priority section truncated');
    assertEq(p.truncate[0]?.toTokens, 150, '(8) truncated to leftover (250-100)');
    assert(p.drop.includes('circle_snapshot'), '(8) lowest dropped after budget exhausted');
    assertEq(p.keptTokens, 250, '(8) keptTokens = budget');
    assert(p.keptTokens <= 250, '(8) keptTokens ≤ budget');
  }

  // ─── (9) output ordering is canonical emit order regardless of input order ─
  {
    const scrambled = [sec('last_session', 10), sec('runtime_bundle', 10), sec('circle_snapshot', 10), sec('memory_user_notes', 10)];
    const p = planSectionFit(scrambled, 10_000);
    assertDeep(p.keep, ['runtime_bundle', 'memory_user_notes', 'circle_snapshot', 'last_session'], '(9) keep re-sorted to emit order');
    // Budget 0 → all drop, still emit-ordered.
    const z = planSectionFit(scrambled, 0);
    assertDeep(z.drop, ['runtime_bundle', 'memory_user_notes', 'circle_snapshot', 'last_session'], '(9) drop emit-ordered');
    assertEq(z.keptTokens, 0, '(9) zero budget keeps nothing');
    assert(isEmitOrdered(z.drop), '(9) zero-budget drop emit-ordered');
  }

  // ─── (10) full-registry realistic tier: last_session beats ALL decorative ──
  {
    const all = SECTION_EMIT_ORDER.map((k) => sec(k, 100));
    // Budget 1200 = 12×100 → keeps the 12 highest-priority sections.
    const p = planSectionFit(all, 1200);
    assertEq(p.keep.length, 12, '(10) keeps top-12 by priority');
    assertEq(p.keptTokens, 1200, '(10) keptTokens = budget');
    assert(p.keptTokens <= 1200, '(10) keptTokens ≤ budget');
    assert(p.keep.includes('last_session'), '(10) last_session survives the tier');
    for (const d of DECORATIVE) assert(p.drop.includes(d), `(10) decorative dropped: ${d}`);
    assert(!p.keep.includes('circle_snapshot'), '(10) circle_snapshot not kept');
    assert(isEmitOrdered(p.keep), '(10) keep emit-ordered');
    assert(isEmitOrdered(p.drop), '(10) drop emit-ordered');
    // Exact partition: every registry key lands in exactly one bucket, once.
    const keys = allKeys(p);
    assertEq(keys.length, SECTION_EMIT_ORDER.length, '(10) partition covers all sections');
    assertEq(new Set(keys).size, keys.length, '(10) no key in two buckets');
  }

  // ─── (11) determinism ──────────────────────────────────────────────────────
  {
    const s = SECTION_EMIT_ORDER.map((k, i) => sec(k, 40 + (i % 5) * 30));
    const a = planSectionFit(s, 900);
    const b = planSectionFit(s, 900);
    assertDeep(a, b, '(11) same input → identical plan');
    assert(a.keptTokens <= 900, '(11) keptTokens ≤ budget');
  }

  // ─── (12) dedup (duplicate keys collapse, first wins) ──────────────────────
  {
    const p = planSectionFit([sec('runtime_bundle', 100), sec('runtime_bundle', 999)], 10_000);
    const keys = allKeys(p);
    assertEq(keys.filter((k) => k === 'runtime_bundle').length, 1, '(12) duplicate key appears once');
    assertEq(p.keep.length, 1, '(12) only one kept');
    assertEq(p.keptTokens, 100, '(12) first occurrence tokens used');
  }

  // ─── (13) unknown keys handled, ordered AFTER known, insertion-stable ──────
  {
    const p = planSectionFit([sec('runtime_bundle', 10), sec('zzz_custom_block', 10, 100)], 10_000);
    assertDeep(p.keep, ['runtime_bundle', 'zzz_custom_block'], '(13) unknown sorts after known');
    // Two unknowns keep INSERTION order (not alphabetical).
    const q = planSectionFit([sec('bbb', 10, 10), sec('aaa', 10, 10)], 10_000);
    assertDeep(q.keep, ['bbb', 'aaa'], '(13) unknown ties keep insertion order');
  }

  // ─── (14) NaN priority falls back to the key's REAL default ────────────────
  {
    // If both fell back to neutral they'd tie and emit-order would keep the
    // EARLIER circle_snapshot; correct fallback makes last_session (78) win.
    const s: SectionInput[] = [
      { key: 'last_session', tokens: 100, priority: NaN as unknown as number },
      { key: 'circle_snapshot', tokens: 100, priority: NaN as unknown as number },
    ];
    const p = planSectionFit(s, 100);
    assert(p.keep.includes('last_session'), '(14) NaN priority → key default (last_session wins)');
    assert(p.drop.includes('circle_snapshot'), '(14) lower-default section dropped');
  }

  // ─── (15) opts overrides ───────────────────────────────────────────────────
  {
    // Raise the truncate threshold above memory_user_notes' priority → it drops.
    const p = planSectionFit([sec('memory_user_notes', 500)], 300, { truncateMinPriority: 95 });
    assertEq(p.truncate.length, 0, '(15) high truncateMinPriority → no truncate');
    assert(p.drop.includes('memory_user_notes'), '(15) over-budget section dropped instead');
    // Raise the min-truncate floor above the remaining budget → drop not truncate.
    const q = planSectionFit([sec('memory_user_notes', 500)], 300, { minTruncateTokens: 400 });
    assertEq(q.truncate.length, 0, '(15) min-truncate floor too high → no truncate');
    assert(q.drop.includes('memory_user_notes'), '(15) dropped when truncation not worthwhile');
    // Default (no opts) still truncates — proves the override changed behavior.
    const d = planSectionFit([sec('memory_user_notes', 500)], 300);
    assertEq(d.truncate.length, 1, '(15) default still truncates');
  }

  // ─── (16) keptTokens ≤ budget invariant across a spread of budgets ─────────
  {
    const s = SECTION_EMIT_ORDER.map((k, i) => sec(k, 20 + (i * 37) % 260));
    for (const budget of [0, 1, 50, 137, 500, 1000, 3000, 50_000]) {
      const p = planSectionFit(s, budget);
      assert(isValidPlan(p), `(16) valid plan @${budget}`);
      assert(p.keptTokens <= budget, `(16) keptTokens ≤ budget @${budget}`, String(p.keptTokens));
      assert(p.keptTokens >= 0, `(16) keptTokens ≥ 0 @${budget}`);
      // Partition completeness at every budget.
      const keys = allKeys(p);
      assertEq(new Set(keys).size, keys.length, `(16) partition unique @${budget}`);
    }
  }

  // ─── (17) zero-token sections are never dropped for budget reasons ─────────
  {
    const p = planSectionFit([sec('runtime_bundle', 0), sec('last_session', 100)], 100);
    assert(p.keep.includes('runtime_bundle'), '(17) 0-token section kept (costless)');
    assert(p.keep.includes('last_session'), '(17) real section still fits');
    assertEq(p.keptTokens, 100, '(17) 0-token adds nothing to keptTokens');
  }

  // ─── (18) exported constants + EMPTY plan are sane ─────────────────────────
  assert(Number.isFinite(SECTION_PRIORITY_NEUTRAL), '(18) neutral is finite');
  assert(Number.isFinite(DEFAULT_TRUNCATE_MIN_PRIORITY), '(18) truncate threshold finite');
  assert(DEFAULT_MIN_TRUNCATE_TOKENS >= 0, '(18) min-truncate ≥ 0');
  assert(isValidPlan(EMPTY_SECTION_FIT_PLAN as unknown), '(18) EMPTY plan is a valid plan');
  assertEq(EMPTY_SECTION_FIT_PLAN.keptTokens, 0, '(18) EMPTY plan keeps nothing');

  // ─── (19) hostile / degenerate input — no throw, safe valid plan ───────────
  const hostileSections: unknown[] = [
    null, undefined, 42, 'nope', true, {}, { key: 123 }, { key: '' }, { key: '   ' },
    [sec('runtime_bundle', 10)], NaN, Symbol('x'),
  ];
  for (const h of hostileSections) {
    noThrow(() => planSectionFit(h, 500), `(19) hostile sections no-throw :: ${String(h)}`);
    assert(isValidPlan(planSectionFit(h, 500)), `(19) hostile sections valid plan :: ${String(h)}`);
  }
  const hostileBudgets: unknown[] = [null, undefined, NaN, Infinity, -Infinity, -5, '300', 'abc', {}, [], true];
  const okSections = [sec('runtime_bundle', 100), sec('last_session', 100)];
  for (const b of hostileBudgets) {
    noThrow(() => planSectionFit(okSections, b), `(19) hostile budget no-throw :: ${String(b)}`);
    const p = planSectionFit(okSections, b);
    assert(isValidPlan(p), `(19) hostile budget valid plan :: ${String(b)}`);
  }
  // Section elements: cyclic object, throwing getters, junk tokens/priority.
  const cyc: Record<string, unknown> = { key: 'runtime_bundle', tokens: 100, priority: 90 };
  cyc.self = cyc;
  noThrow(() => planSectionFit([cyc], 1000), '(19) cyclic section no-throw');
  assert(planSectionFit([cyc], 1000).keep.includes('runtime_bundle'), '(19) cyclic section still processed');
  const evilKey = { get key(): string { throw new Error('boom'); }, tokens: 100, priority: 90 };
  noThrow(() => planSectionFit([evilKey], 1000), '(19) throwing key getter no-throw');
  {
    const p = planSectionFit([evilKey, sec('runtime_bundle', 50)], 1000);
    assert(p.keep.includes('runtime_bundle'), '(19) throwing getter skipped, sibling kept');
    assert(!allKeys(p).includes(undefined as unknown as string), '(19) no undefined key leaked');
  }
  const evilTokens = { key: 'last_session', get tokens(): number { throw new Error('x'); }, priority: 5 };
  noThrow(() => planSectionFit([evilTokens], 1000), '(19) throwing tokens getter no-throw');
  // Junk numeric fields sanitize, never NaN out.
  {
    const s: unknown[] = [
      { key: 'runtime_bundle', tokens: NaN, priority: 'high' },
      { key: 'last_session', tokens: Infinity, priority: -Infinity },
      { key: 'circle_snapshot', tokens: -50, priority: NaN },
      { key: 'wiki_context', tokens: '250', priority: '40' },
    ];
    const p = planSectionFit(s, 500);
    assert(isValidPlan(p), '(19) junk numeric fields valid plan');
    assert(p.keptTokens <= 500, '(19) junk fields keptTokens ≤ budget', String(p.keptTokens));
    assert(Number.isInteger(p.keptTokens), '(19) keptTokens is integer');
  }
  // Huge array bounded to MAX_SECTIONS; Infinity budget keeps within bounds.
  {
    const huge = Array.from({ length: 20_000 }, (_, i) => ({ key: `k${i}`, tokens: 1, priority: 1 }));
    noThrow(() => planSectionFit(huge, 100), '(19) huge array no-throw');
    const p = planSectionFit(huge, Infinity);
    assert(isValidPlan(p), '(19) huge array valid plan');
    assert(allKeys(p).length <= 5_000, '(19) huge array bounded to MAX_SECTIONS', String(allKeys(p).length));
    assert(p.keptTokens >= 0, '(19) huge array keptTokens ≥ 0');
  }
  // opts itself hostile.
  noThrow(() => planSectionFit(okSections, 200, null as unknown as undefined), '(19) null opts no-throw');
  noThrow(() => planSectionFit(okSections, 200, { truncateMinPriority: NaN, minTruncateTokens: -5 }), '(19) NaN/neg opts no-throw');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll prompt-section-priority-core smoke cases passed (${passes} passed).`);
}

main();
