/**
 * capability-fallback-core-smoketest — the pure capability-aware model fallback
 * brain (src/lib/capabilityFallbackCore.ts). It maps (a turn's REQUIRED
 * capabilities + the picked model's capability PROFILE, both injected by the
 * caller) → the minimal capability-preserving substitute, or an honest
 * identity+gaps when the always-routable Anthropic spine can't cover the need.
 *
 * Load-bearing assertions:
 *   GAPS: detectCapabilityGaps reports tool_use / vision / computer_use /
 *   coding_tier / context_window in a STABLE order; an unknown context window
 *   yields NO context gap (fail-open, mirroring modelContextBudgetCore).
 *
 *   SUBSTITUTION: cheapest→strongest ladder — a no-tool/no-vision pick →
 *   claude-haiku-4-5; a computer-use need → claude-sonnet-4-6 (the only
 *   canonical with it); a >200k context need → gemini-2.5-pro / gpt-4.1 ONLY
 *   when that provider is connected, else identity+gaps (fail-closed honesty);
 *   the same-model guard escalates haiku→sonnet instead of a no-op swap.
 *
 *   TOTAL: every export guards null/undefined/number/string/symbol/{}/[]/NaN/
 *   huge/cyclic/throwing-getter input to a safe identity, never a throw.
 *
 *   SECRET-SAFE: a selected id shaped like `sk-ant-…` / `Bearer …` never
 *   appears in the `reason` free text. DETERMINISTIC across runs. BOUNDED.
 *
 * Pure — loads under tsx (capabilityFallbackCore has only a type-only import).
 */

import {
  detectCapabilityGaps,
  resolveCapabilityFallback,
  CANONICAL_CAPABILITY_CANDIDATES,
  MAX_CAPABILITY_GAPS,
  MAX_REASON_CHARS,
  type CapabilityCandidate,
  type RequiredCapabilities,
  type SelectedModelProfile,
} from '../src/lib/capabilityFallbackCore';
import type { ModelCapabilityFlags, ModelCodingTier } from '../src/lib/modelCapabilities';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const SATISFIES = 'model satisfies all required capabilities';

const BASE_FLAGS: ModelCapabilityFlags = {
  toolUse: false,
  computerUse: false,
  vision: false,
  streaming: true,
  imageOnly: false,
  maxOutputTokens: null,
  codingTier: 'none',
};
function mkFlags(partial: Partial<ModelCapabilityFlags>): ModelCapabilityFlags {
  return { ...BASE_FLAGS, ...partial };
}
function mkProfile(
  model: string,
  flags: Partial<ModelCapabilityFlags>,
  contextWindow?: number | null,
): SelectedModelProfile {
  return { model, flags: mkFlags(flags), contextWindow };
}

function main(): void {
  // ─── (1) identity — no gaps → caller's pick stands untouched ───────────────
  const satisfied = mkProfile('deepseek-v3', { toolUse: true, vision: true, codingTier: 'strong' }, 128_000);
  const r1a = resolveCapabilityFallback(satisfied, {});
  assertEq(r1a.model, 'deepseek-v3', '(1) empty required → model echoed unchanged');
  assertEq(r1a.substituted, false, '(1) empty required → not substituted');
  assertEq(r1a.gaps.length, 0, '(1) empty required → no gaps');
  assertEq(r1a.reason, SATISFIES, '(1) empty required → satisfies reason');

  const r1b = resolveCapabilityFallback(satisfied, { toolUse: false, vision: false, computerUse: false });
  assertEq(r1b.substituted, false, '(1) all-false required → not substituted');
  assertEq(r1b.gaps.length, 0, '(1) all-false required → no gaps');

  const allCap = mkProfile('my-frontier', { toolUse: true, vision: true, computerUse: true, codingTier: 'strong' }, 200_000);
  const r1c = resolveCapabilityFallback(allCap, {
    toolUse: true, vision: true, computerUse: true, minCodingTier: 'strong', minContextTokens: 100_000,
  });
  assertEq(r1c.substituted, false, '(1) model satisfying every requirement → identity');
  assertEq(r1c.model, 'my-frontier', '(1) satisfying model echoed');
  assertEq(detectCapabilityGaps(satisfied, {}).length, 0, '(1) detectCapabilityGaps empty required → []');
  assertEq(JSON.stringify(r1a), JSON.stringify(resolveCapabilityFallback(satisfied, {})), '(1) deterministic identity');

  // ─── (2) tool gap → cheapest tool-capable (claude-haiku-4-5) ───────────────
  const sonar = mkProfile('sonar-pro', { toolUse: false, vision: false }, 200_000);
  const r2 = resolveCapabilityFallback(sonar, { toolUse: true });
  assertEq(r2.model, 'claude-haiku-4-5', '(2) no-tool pick + tools → haiku');
  assertEq(r2.substituted, true, '(2) tool gap substitutes');
  assertEq(r2.gaps.join(','), 'tool_use', '(2) tool gap reported');
  assert(r2.reason.includes('claude-haiku-4-5') && r2.reason.includes('tool_use'), '(2) reason names substitute + gap', r2.reason);
  assertEq(detectCapabilityGaps(sonar, { toolUse: true }).join(','), 'tool_use', '(2) detect tool_use gap');
  // platform-default candidate is reachable even with NO providers connected.
  assertEq(resolveCapabilityFallback(sonar, { toolUse: true }, { connectedProviders: [] }).model, 'claude-haiku-4-5', '(2) haiku reachable with no providers (platform spine)');

  // ─── (3) vision gap → haiku ────────────────────────────────────────────────
  const noVision = mkProfile('deepseek-v3', { toolUse: true, vision: false }, 128_000);
  const r3 = resolveCapabilityFallback(noVision, { vision: true });
  assertEq(r3.model, 'claude-haiku-4-5', '(3) text-only pick + image → haiku');
  assertEq(r3.gaps.join(','), 'vision', '(3) vision gap reported');
  assertEq(r3.substituted, true, '(3) vision gap substitutes');

  // ─── (4) computer_use gap → claude-sonnet-4-6 (only canonical with it) ─────
  const noCua = mkProfile('gpt-4o', { toolUse: true, vision: true, computerUse: false }, 128_000);
  const r4 = resolveCapabilityFallback(noCua, { computerUse: true });
  assertEq(r4.model, 'claude-sonnet-4-6', '(4) computer-use need → sonnet');
  assert(r4.model !== 'claude-haiku-4-5', '(4) haiku (no computer-use) skipped');
  assertEq(r4.gaps.join(','), 'computer_use', '(4) computer_use gap reported');
  assert(r4.reason.includes('claude-sonnet-4-6') && r4.reason.includes('computer_use'), '(4) reason names sonnet + gap', r4.reason);

  // ─── (5) context gap → long-context anchor, gated on a connected provider ──
  const smallWindow = mkProfile('gpt-4', { toolUse: true, vision: true }, 8_000);
  const ctxReq: RequiredCapabilities = { minContextTokens: 300_000 };
  assertEq(detectCapabilityGaps(smallWindow, ctxReq).join(','), 'context_window', '(5) context gap when window < need');
  const r5google = resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: ['google_ai'] });
  assertEq(r5google.model, 'gemini-2.5-pro', '(5) >200k + google_ai connected → gemini');
  assertEq(r5google.substituted, true, '(5) context gap substitutes when provider connected');
  assertEq(r5google.gaps.join(','), 'context_window', '(5) context gap reported on substitute');
  const r5none = resolveCapabilityFallback(smallWindow, ctxReq);
  assertEq(r5none.substituted, false, '(5) >200k + NO providers → identity (Anthropic spine tops at 200k)');
  assertEq(r5none.model, 'gpt-4', '(5) no-substitute keeps selected model');
  assertEq(r5none.gaps.join(','), 'context_window', '(5) no-substitute still reports the gap');
  assert(r5none.reason.includes('no eligible substitute') && r5none.reason.includes('context_window'), '(5) fail-closed reason', r5none.reason);
  const r5openai = resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: ['openai'] });
  assertEq(r5openai.model, 'gpt-4.1', '(5) >200k + openai connected → gpt-4.1 (alt anchor)');
  const r5both = resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: ['google_ai', 'openai'] });
  assertEq(r5both.model, 'gemini-2.5-pro', '(5) both connected → gemini wins (first in ladder)');
  const r5deepseek = resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: ['deepseek'] });
  assertEq(r5deepseek.substituted, false, '(5) unrelated provider connected → still no substitute');
  // provider-name canonicalization + bare-string form
  assertEq(resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: ['google'] }).model, 'gemini-2.5-pro', '(5) provider alias "google" → google_ai');
  assertEq(resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: ['GoogleAI'] }).model, 'gemini-2.5-pro', '(5) provider alias "GoogleAI" → google_ai');
  assertEq(resolveCapabilityFallback(smallWindow, ctxReq, { connectedProviders: 'openai' }).model, 'gpt-4.1', '(5) bare-string connectedProviders = one provider');

  // ─── (6) unknown window → NO context gap (fail-open) ───────────────────────
  const unknownWindow = mkProfile('mystery-model', { toolUse: true, vision: true }, null);
  assertEq(detectCapabilityGaps(unknownWindow, { minContextTokens: 500_000 }).length, 0, '(6) null window → no context gap');
  assertEq(resolveCapabilityFallback(unknownWindow, { minContextTokens: 500_000 }).substituted, false, '(6) null window → identity');
  const undefWindow = mkProfile('mystery2', { toolUse: true }, undefined);
  assertEq(detectCapabilityGaps(undefWindow, { minContextTokens: 500_000 }).length, 0, '(6) undefined window → no context gap');
  // unknown window + a DIFFERENT gap: substitute must still satisfy the full set
  const unkTool = mkProfile('mystery3', { toolUse: false }, null);
  const r6a = resolveCapabilityFallback(unkTool, { toolUse: true, minContextTokens: 500_000 });
  assertEq(r6a.substituted, false, '(6) tool gap but 500k need + no long-ctx provider → no candidate satisfies full set');
  assertEq(r6a.gaps.join(','), 'tool_use', '(6) only tool_use is a gap (window unknown → not context_window)');
  const r6b = resolveCapabilityFallback(unkTool, { toolUse: true, minContextTokens: 500_000 }, { connectedProviders: ['google_ai'] });
  assertEq(r6b.model, 'gemini-2.5-pro', '(6) same, google_ai connected → gemini covers tool_use AND the 500k need');
  assertEq(r6b.gaps.join(','), 'tool_use', '(6) reported gaps are the selected model gaps (window unknown)');

  // ─── (7) coding_tier gap → first strong-enough candidate ───────────────────
  const basicCoder = mkProfile('gpt-4o', { toolUse: true, vision: true, codingTier: 'basic' }, 128_000);
  const r7 = resolveCapabilityFallback(basicCoder, { minCodingTier: 'strong' });
  assertEq(r7.model, 'claude-sonnet-4-6', '(7) basic coder + strong need → sonnet (haiku is basic)');
  assertEq(r7.gaps.join(','), 'coding_tier', '(7) coding_tier gap reported');
  assertEq(detectCapabilityGaps(basicCoder, { minCodingTier: 'strong' }).join(','), 'coding_tier', '(7) detect coding_tier gap');
  const noneCoder = mkProfile('unknown-x', { toolUse: true, codingTier: 'none' }, 128_000);
  assertEq(resolveCapabilityFallback(noneCoder, { minCodingTier: 'basic' }).model, 'claude-haiku-4-5', '(7) none→basic need satisfied by haiku');
  const strongCoder = mkProfile('opus-ish', { toolUse: true, codingTier: 'strong' }, 200_000);
  assertEq(detectCapabilityGaps(strongCoder, { minCodingTier: 'strong' }).length, 0, '(7) strong meets strong → no gap');
  assertEq(detectCapabilityGaps(basicCoder, { minCodingTier: 'basic' }).length, 0, '(7) basic meets basic → no gap');

  // ─── (8) multi-gap — one substitute must cover ALL, stable gap order ───────
  const noSee = mkProfile('text-only', { toolUse: true, vision: false, computerUse: false }, 128_000);
  const r8 = resolveCapabilityFallback(noSee, { vision: true, computerUse: true });
  assertEq(r8.model, 'claude-sonnet-4-6', '(8) vision+computer-use → sonnet covers both');
  assertEq(r8.gaps.join(','), 'vision,computer_use', '(8) multi-gap stable order (vision before computer_use)');
  assert(r8.reason.includes('vision') && r8.reason.includes('computer_use'), '(8) reason lists both gaps', r8.reason);
  const bare = mkProfile('bare', {}, 128_000);
  assertEq(resolveCapabilityFallback(bare, { toolUse: true, vision: true }).model, 'claude-haiku-4-5', '(8) tool+vision → haiku covers both');
  // all five gaps at once → full stable order; no single candidate covers
  // computer-use AND a >200k window, so identity+gaps even with every provider.
  const worst = mkProfile('bare2', {}, 8_000);
  const allReq: RequiredCapabilities = { toolUse: true, vision: true, computerUse: true, minCodingTier: 'strong', minContextTokens: 300_000 };
  assertEq(detectCapabilityGaps(worst, allReq).join(','), 'tool_use,vision,computer_use,coding_tier,context_window', '(8) all five gaps in stable order');
  assertEq(detectCapabilityGaps(worst, allReq).length, 5, '(8) exactly five gaps');
  const r8worst = resolveCapabilityFallback(worst, allReq, { connectedProviders: ['google_ai', 'openai'] });
  assertEq(r8worst.substituted, false, '(8) no candidate covers computer-use + >200k window → identity');
  assertEq(r8worst.gaps.length, 5, '(8) all gaps still reported on no-substitute');

  // ─── (9) same-model guard — escalate instead of a no-op swap ───────────────
  // Injected flags contradict the table for the SAME id → never "substitute"
  // the same model; escalate to the next capable one.
  const haikuNoTool = mkProfile('claude-haiku-4-5', { toolUse: false }, 200_000);
  assertEq(resolveCapabilityFallback(haikuNoTool, { toolUse: true }).model, 'claude-sonnet-4-6', '(9) selected==haiku (no-tool injected) → escalate to sonnet, not haiku');
  const prefixedHaiku = mkProfile('anthropic/claude-haiku-4-5', { toolUse: false }, 200_000);
  assertEq(resolveCapabilityFallback(prefixedHaiku, { toolUse: true }).model, 'claude-sonnet-4-6', '(9) provider-prefixed same-model normalized + escalated');
  assertEq(resolveCapabilityFallback(mkProfile('openrouter/anthropic/claude-haiku-4-5', { toolUse: false }, 200_000), { toolUse: true }).model, 'claude-sonnet-4-6', '(9) double-prefixed same-model normalized');
  // realistic composition: budget landed on haiku, but computer-use is needed →
  // haiku (correct flags) can't → escalate to sonnet.
  const realHaiku = mkProfile('claude-haiku-4-5', { toolUse: true, vision: true, computerUse: false, codingTier: 'basic' }, 200_000);
  assertEq(resolveCapabilityFallback(realHaiku, { computerUse: true }).model, 'claude-sonnet-4-6', '(9) haiku→sonnet computer-use escalation (overrides a downshift)');

  // ─── (10) HOSTILE input — never throws, safe identity ──────────────────────
  try {
    const junk: unknown[] = [null, undefined, 42, NaN, 'nonsense', Symbol('x'), {}, [], true, () => 0];
    for (const s of junk) {
      for (const req of junk) {
        assert(Array.isArray(detectCapabilityGaps(s as never, req as never)), '(10) detectCapabilityGaps always returns an array');
        const rr = resolveCapabilityFallback(s as never, req as never);
        assert(rr && typeof rr.model === 'string' && typeof rr.substituted === 'boolean' && Array.isArray(rr.gaps) && typeof rr.reason === 'string', '(10) resolveCapabilityFallback always returns a valid result');
        assertEq(rr.substituted, false, '(10) hostile input → not substituted');
      }
    }
    // non-string model → model field is '' (echo only when a string)
    assertEq(resolveCapabilityFallback(42 as never, {}).model, '', '(10) numeric selected → model ""');
    assertEq(resolveCapabilityFallback(null as never, null as never).model, '', '(10) null selected → model ""');
    assertEq(resolveCapabilityFallback('a-bare-string' as never, {}).model, '', '(10) bare-string selected has no .model → ""');

    // throwing-getter flags + contextWindow
    const evilFlags: SelectedModelProfile = {
      model: 'evil',
      get flags(): ModelCapabilityFlags { throw new Error('boom'); },
      get contextWindow(): number { throw new Error('boom'); },
    } as unknown as SelectedModelProfile;
    assertEq(detectCapabilityGaps(evilFlags, { toolUse: true }).join(','), 'tool_use', '(10) throwing flags getter → treated as no capabilities (tool gap)');
    assertEq(resolveCapabilityFallback(evilFlags, { toolUse: true }).model, 'claude-haiku-4-5', '(10) throwing getter still substitutes safely');

    // fully throwing Proxy for both selected + required
    const proxy = new Proxy({}, { get() { throw new Error('nope'); } }) as never;
    assertEq(detectCapabilityGaps(proxy, proxy).length, 0, '(10) throwing proxy → no gaps');
    assertEq(resolveCapabilityFallback(proxy, proxy).model, '', '(10) throwing proxy → identity model ""');

    // cyclic required
    const cyc: Record<string, unknown> = { toolUse: true };
    cyc.self = cyc;
    assertEq(resolveCapabilityFallback(mkProfile('m', {}, 128_000), cyc as never).model, 'claude-haiku-4-5', '(10) cyclic required → still resolves tool gap');

    // huge string model
    const huge = 'x'.repeat(200_000);
    const rHuge = resolveCapabilityFallback(mkProfile(huge, { toolUse: false }, 200_000), { toolUse: true });
    assertEq(rHuge.model, 'claude-haiku-4-5', '(10) huge model id → substitute still bounded literal');
    assert(rHuge.reason.length <= MAX_REASON_CHARS, '(10) reason bounded even for huge input', String(rHuge.reason.length));
    assert(!rHuge.reason.includes(huge), '(10) huge model id never echoed into reason');

    // hostile connectedProviders shapes
    const req5: RequiredCapabilities = { minContextTokens: 300_000 };
    assertEq(resolveCapabilityFallback(smallWindow, req5, { connectedProviders: 42 as never }).substituted, false, '(10) numeric connectedProviders → no providers');
    assertEq(resolveCapabilityFallback(smallWindow, req5, { connectedProviders: {} as never }).substituted, false, '(10) object connectedProviders → non-iterable → no providers');
    assertEq(resolveCapabilityFallback(smallWindow, req5, null as never).substituted, false, '(10) null opts → no providers');
    assertEq(resolveCapabilityFallback(smallWindow, req5, 99 as never).substituted, false, '(10) junk opts → no providers');
    // cyclic + huge provider arrays never throw / stay bounded
    const cycArr: unknown[] = ['google_ai'];
    cycArr.push(cycArr);
    assertEq(resolveCapabilityFallback(smallWindow, req5, { connectedProviders: cycArr as never }).model, 'gemini-2.5-pro', '(10) cyclic provider array → google_ai still read, gemini');
    const hugeArr = new Array(100_000).fill('deepseek');
    assertEq(resolveCapabilityFallback(smallWindow, req5, { connectedProviders: hugeArr }).substituted, false, '(10) huge provider array scanned bounded, no long-ctx provider');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) hostile inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (11) secret-safety — selected id shaped like a secret never in reason ─
  const skModel = 'sk-ant-api03-SECRETSECRETSECRETSECRET';
  const rSk = resolveCapabilityFallback(mkProfile(skModel, { toolUse: false }, 200_000), { toolUse: true });
  assert(!rSk.reason.includes('sk-ant') && !rSk.reason.includes(skModel), '(11) sk-ant selected id absent from substitute reason', rSk.reason);
  assertEq(rSk.model, 'claude-haiku-4-5', '(11) substitute model is the safe literal, not the secret');
  const rSkIdentity = resolveCapabilityFallback(mkProfile(skModel, { toolUse: true, vision: true }, 200_000), {});
  assertEq(rSkIdentity.model, skModel, '(11) identity echoes caller selected id (caller already has it)');
  assert(!rSkIdentity.reason.includes('sk-ant'), '(11) identity reason still secret-free');
  const bearerModel = 'Bearer abc123def456ghi789';
  const rBearer = resolveCapabilityFallback(mkProfile(bearerModel, { toolUse: true }, 8_000), { minContextTokens: 999_999 });
  assert(!rBearer.reason.includes('Bearer') && !rBearer.reason.includes('abc123'), '(11) Bearer selected id absent from no-substitute reason', rBearer.reason);
  assertEq(rBearer.substituted, false, '(11) unmet context need with no provider → identity');

  // ─── (12) determinism across a batch ───────────────────────────────────────
  const cases: Array<[SelectedModelProfile, RequiredCapabilities, { connectedProviders?: Iterable<string> } | undefined]> = [
    [sonar, { toolUse: true }, undefined],
    [noCua, { computerUse: true }, undefined],
    [smallWindow, { minContextTokens: 300_000 }, { connectedProviders: ['google_ai'] }],
    [basicCoder, { minCodingTier: 'strong' }, undefined],
    [noSee, { vision: true, computerUse: true }, undefined],
  ];
  for (let i = 0; i < cases.length; i += 1) {
    const [s, req, opts] = cases[i];
    const a = JSON.stringify(resolveCapabilityFallback(s, req, opts));
    const b = JSON.stringify(resolveCapabilityFallback(s, req, opts));
    assertEq(a, b, `(12) deterministic case ${i}`);
    assert(JSON.parse(a).reason.length <= MAX_REASON_CHARS, `(12) reason bounded case ${i}`);
    assert(JSON.parse(a).gaps.length <= MAX_CAPABILITY_GAPS, `(12) gaps bounded case ${i}`);
  }

  // ─── (13) exported bounds + canonical candidate facts mirror modelCapabilities ─
  assertEq(MAX_CAPABILITY_GAPS, 5, '(13) MAX_CAPABILITY_GAPS is 5');
  assertEq(MAX_REASON_CHARS, 160, '(13) MAX_REASON_CHARS is 160');
  assertEq(CANONICAL_CAPABILITY_CANDIDATES.length, 4, '(13) four canonical candidates');
  assertEq(CANONICAL_CAPABILITY_CANDIDATES.map((c) => c.id).join(','), 'claude-haiku-4-5,claude-sonnet-4-6,gemini-2.5-pro,gpt-4.1', '(13) ladder order cheapest→strongest');
  const byId = (id: string): CapabilityCandidate | undefined => CANONICAL_CAPABILITY_CANDIDATES.find((c) => c.id === id);
  const haiku = byId('claude-haiku-4-5')!;
  assert(haiku.platformDefault && haiku.provider === 'anthropic' && haiku.flags.toolUse && haiku.flags.vision && !haiku.flags.computerUse && haiku.flags.codingTier === 'basic' && haiku.contextWindow === 200_000, '(13) haiku facts mirror modelCapabilities');
  const sonnet = byId('claude-sonnet-4-6')!;
  assert(sonnet.platformDefault && sonnet.flags.computerUse && sonnet.flags.codingTier === 'strong' && sonnet.contextWindow === 200_000, '(13) sonnet is the computer-use / strong anchor');
  const gemini = byId('gemini-2.5-pro')!;
  assert(!gemini.platformDefault && gemini.provider === 'google_ai' && gemini.flags.codingTier === 'strong' && gemini.contextWindow === 1_000_000 && !gemini.flags.computerUse, '(13) gemini facts mirror modelCapabilities');
  const gpt41 = byId('gpt-4.1')!;
  assert(!gpt41.platformDefault && gpt41.provider === 'openai' && gpt41.contextWindow === 1_000_000 && gpt41.flags.codingTier === 'basic', '(13) gpt-4.1 = basic tier (mirrors getModelCapabilityFlags family pattern), 1M window');

  // ─── (14) tier-rank boundaries ─────────────────────────────────────────────
  const tiers: ModelCodingTier[] = ['none', 'basic', 'strong'];
  for (const have of tiers) {
    for (const need of ['basic', 'strong'] as const) {
      const p = mkProfile('m', { codingTier: have, toolUse: true }, 128_000);
      const gap = detectCapabilityGaps(p, { minCodingTier: need });
      const rankHave = have === 'strong' ? 2 : have === 'basic' ? 1 : 0;
      const rankNeed = need === 'strong' ? 2 : 1;
      assertEq(gap.includes('coding_tier'), rankNeed > rankHave, `(14) coding gap iff need(${need}) > have(${have})`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll capability-fallback-core smoke cases passed (${passes} passed).`);
}

main();
