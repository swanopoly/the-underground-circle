/**
 * coding-model-split-policy-smoketest — the pure plan/execute model-split +
 * auto best-of-N decider (src/lib/codingModelSplitPolicy.ts) behind coding-agent
 * P5 (docs/CODING_AGENT_UPGRADE_PLAN.md). Load-bearing assertions:
 *
 *   SPLIT DECIDER: fail-closed 'single' on ANY of: flag off, non-coding intent,
 *   non-complex complexity, no tools this run, explicit user model pick
 *   ('auto' does NOT count), non-'strong' resolved coding tier, degenerate
 *   resolved model. Executor ladder: Anthropic planner → Haiku fast executor
 *   (sonnet/opus/fable → claude-haiku-4-5); non-Anthropic planner → Sonnet
 *   executor ONLY in default-key mode or with 'anthropic' connected; otherwise
 *   tool-capable planner stays single ("already tool-capable") and a no-tool
 *   planner stays single (fail safe). No produced split ever has
 *   executor === planner.
 *
 *   PLANNER PROMPT / HANDOFF NOTE: numbered-steps + no-tools + 600-word-cap
 *   instructions, literal HANDOFF TO EXECUTOR terminator, 2k task cap;
 *   handoff note names both models, carries the deviation rule, caps the plan
 *   at 6k, and returns '' for a degenerate plan.
 *
 *   AUTO BEST-OF-N: DEFAULT OFF; races only complex build/debug/review TEXT
 *   turns (never tool runs, never /commands) with ≥2 eligible providers;
 *   models are concrete ids in priority order, deduped, capped at 3.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (codingModelSplitPolicy imports only modelCapabilities).
 * Flag reads use explicit `flagEnabled` overrides — never ambient storage —
 * except the two dedicated default-behavior checks.
 */

import {
  CODING_PLAN_SPLIT_FLAG,
  AUTO_BEST_OF_N_FLAG,
  CODING_FAST_EXECUTOR_MODEL_ID,
  CODING_STRONG_EXECUTOR_MODEL_ID,
  isCodingPlanSplitEnabled,
  isAutoBestOfNEnabled,
  decideCodingModelSplit,
  buildCodingPlannerPrompt,
  buildCodingPlanHandoffNote,
  decideAutoBestOfN,
  type CodingModelSplitDecision,
  type CodingModelSplitInput,
} from '../src/lib/codingModelSplitPolicy';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** A fully split-eligible baseline input; individual cases override one field. */
const BASE: CodingModelSplitInput = {
  intent: 'build',
  complexity: 'complex',
  selectedModel: 'auto',
  resolvedModel: 'claude-sonnet-4-6',
  allowedToolNames: ['fs.read_file', 'fs.write_file', 'shell.run'],
  connectedProviders: ['anthropic'],
  flagEnabled: true,
};

/** Every plan_then_execute decision produced anywhere in the run — swept at
 *  the end for the executor !== planner invariant. */
const producedSplits: CodingModelSplitDecision[] = [];
function decide(input: CodingModelSplitInput): CodingModelSplitDecision {
  const decision = decideCodingModelSplit(input);
  if (decision.mode === 'plan_then_execute') producedSplits.push(decision);
  return decision;
}

function main(): void {
  // ─── (1) feature flags: explicit override wins, defaults hold ─────────────
  assertEq(CODING_PLAN_SPLIT_FLAG, 'uc_coding_plan_split', '(1) split flag key');
  assertEq(AUTO_BEST_OF_N_FLAG, 'uc_auto_best_of_n', '(1) best-of-N flag key');
  assertEq(isCodingPlanSplitEnabled(true), true, '(1) split: explicit true wins');
  assertEq(isCodingPlanSplitEnabled(false), false, '(1) split: explicit false wins');
  assertEq(isCodingPlanSplitEnabled(), true, '(1) split: DEFAULT ON with no stored opt-out');
  assertEq(isAutoBestOfNEnabled(true), true, '(1) best-of-N: explicit true wins');
  assertEq(isAutoBestOfNEnabled(false), false, '(1) best-of-N: explicit false wins');
  assertEq(isAutoBestOfNEnabled(), false, '(1) best-of-N: DEFAULT OFF with no stored opt-in');
  assertEq(CODING_FAST_EXECUTOR_MODEL_ID, 'claude-haiku-4-5', '(1) fast executor id pinned');
  assertEq(CODING_STRONG_EXECUTOR_MODEL_ID, 'claude-sonnet-4-6', '(1) strong executor id pinned');

  // ─── (2) flag off → single (today's behavior) ─────────────────────────────
  const off = decide({ ...BASE, flagEnabled: false });
  assertEq(off.mode, 'single', '(2) flag off → single');
  assert(off.reason.includes('flag is off'), '(2) flag-off reason names the flag', off.reason);
  assertEq(off.plannerModelId, undefined, '(2) flag off carries no plannerModelId');
  assertEq(off.executorModelId, undefined, '(2) flag off carries no executorModelId');

  // ─── (3) each single gate individually ────────────────────────────────────
  const wrongIntent = decide({ ...BASE, intent: 'chat' });
  assertEq(wrongIntent.mode, 'single', '(3) intent chat → single');
  assert(wrongIntent.reason.includes('not a coding intent'), '(3) intent reason', wrongIntent.reason);
  assertEq(decide({ ...BASE, intent: undefined }).mode, 'single', '(3) intent undefined → single');
  assertEq(decide({ ...BASE, intent: 'research' }).mode, 'single', '(3) intent research → single');

  const moderate = decide({ ...BASE, complexity: 'moderate' });
  assertEq(moderate.mode, 'single', '(3) complexity moderate → single');
  assert(moderate.reason.includes("not 'complex'"), '(3) complexity reason', moderate.reason);
  assertEq(decide({ ...BASE, complexity: null }).mode, 'single', '(3) complexity null → single');

  const noTools = decide({ ...BASE, allowedToolNames: undefined });
  assertEq(noTools.mode, 'single', '(3) missing tools → single');
  assert(noTools.reason.includes('No tools'), '(3) no-tools reason', noTools.reason);
  assertEq(decide({ ...BASE, allowedToolNames: [] }).mode, 'single', '(3) empty tools → single');
  assertEq(decide({ ...BASE, allowedToolNames: ['', '   '] }).mode, 'single', '(3) blank-only tool names → single');

  const explicitPick = decide({ ...BASE, selectedModel: 'claude-opus-4-8' });
  assertEq(explicitPick.mode, 'single', '(3) explicit user pick → single');
  assert(explicitPick.reason.includes('explicitly selected claude-opus-4-8'), '(3) explicit-pick reason names the pick', explicitPick.reason);
  assertEq(decide({ ...BASE, selectedModel: 'auto' }).mode, 'plan_then_execute', "(3) selectedModel 'auto' does NOT block");
  assertEq(decide({ ...BASE, selectedModel: 'AUTO' }).mode, 'plan_then_execute', "(3) selectedModel 'AUTO' does NOT block (case-insensitive)");
  assertEq(decide({ ...BASE, selectedModel: '' }).mode, 'plan_then_execute', '(3) empty selectedModel does NOT block');
  assertEq(decide({ ...BASE, selectedModel: undefined }).mode, 'plan_then_execute', '(3) undefined selectedModel does NOT block');

  const basicTier = decide({ ...BASE, resolvedModel: 'claude-haiku-4-5' });
  assertEq(basicTier.mode, 'single', '(3) basic-tier resolved model → single');
  assert(basicTier.reason.includes("coding tier 'basic'"), '(3) tier reason names the tier', basicTier.reason);
  assertEq(decide({ ...BASE, resolvedModel: 'totally-unknown-model-9000' }).mode, 'single', "(3) unknown model (tier 'none') → single");

  const emptyResolved = decide({ ...BASE, resolvedModel: '' });
  assertEq(emptyResolved.mode, 'single', '(3) empty resolvedModel → single');
  assert(emptyResolved.reason.includes('No resolved model'), '(3) empty-resolved reason', emptyResolved.reason);
  assertEq(decide({ ...BASE, resolvedModel: '   ' }).mode, 'single', '(3) whitespace resolvedModel → single');

  // ─── (4) Anthropic planner → Haiku fast executor ──────────────────────────
  const sonnet = decide(BASE);
  assertEq(sonnet.mode, 'plan_then_execute', '(4) sonnet planner splits');
  assertEq(sonnet.plannerModelId, 'claude-sonnet-4-6', '(4) sonnet is the planner');
  assertEq(sonnet.executorModelId, CODING_FAST_EXECUTOR_MODEL_ID, '(4) haiku is the executor');
  assert(sonnet.reason.includes('claude-sonnet-4-6 plans, claude-haiku-4-5 executes the tool loop'), '(4) reason names both models + roles', sonnet.reason);
  assert(sonnet.reason.includes('complex build'), '(4) reason names the complex intent', sonnet.reason);

  const opus = decide({ ...BASE, resolvedModel: 'claude-opus-4-8' });
  assertEq(opus.mode, 'plan_then_execute', '(4) opus planner splits');
  assertEq(opus.plannerModelId, 'claude-opus-4-8', '(4) opus is the planner');
  assertEq(opus.executorModelId, 'claude-haiku-4-5', '(4) opus → haiku executor');

  const fable = decide({ ...BASE, resolvedModel: 'claude-fable-5' });
  assertEq(fable.mode, 'plan_then_execute', '(4) fable planner splits');
  assertEq(fable.plannerModelId, 'claude-fable-5', '(4) fable is the planner');
  assertEq(fable.executorModelId, 'claude-haiku-4-5', '(4) fable → haiku executor');

  const prefixed = decide({ ...BASE, resolvedModel: 'anthropic/claude-opus-4-8' });
  assertEq(prefixed.mode, 'plan_then_execute', '(4) provider-prefixed Anthropic id splits');
  assertEq(prefixed.plannerModelId, 'anthropic/claude-opus-4-8', '(4) planner keeps the original resolved id');
  assertEq(prefixed.executorModelId, 'claude-haiku-4-5', '(4) prefixed opus → haiku executor');

  assertEq(decide({ ...BASE, intent: 'debug' }).mode, 'plan_then_execute', '(4) debug intent splits');
  assertEq(decide({ ...BASE, intent: 'review' }).mode, 'plan_then_execute', '(4) review intent splits');
  assertEq(decide({ ...BASE, intent: ' Build ' }).mode, 'plan_then_execute', '(4) intent is trimmed + case-normalized');

  // ─── (5) non-Anthropic planner executor ladder ────────────────────────────
  // (b) strong no-tool reasoner + anthropic connected → Sonnet executor.
  const r1WithAnthropic = decide({ ...BASE, resolvedModel: 'deepseek-r1', connectedProviders: ['anthropic', 'deepseek'] });
  assertEq(r1WithAnthropic.mode, 'plan_then_execute', '(5) deepseek-r1 + anthropic → splits');
  assertEq(r1WithAnthropic.plannerModelId, 'deepseek-r1', '(5) r1 is the planner');
  assertEq(r1WithAnthropic.executorModelId, CODING_STRONG_EXECUTOR_MODEL_ID, '(5) r1 → sonnet executor');
  assert(r1WithAnthropic.reason.includes('deepseek-r1 plans, claude-sonnet-4-6 executes the tool loop'), '(5) r1 reason names both models', r1WithAnthropic.reason);

  // (d) strong no-tool reasoner + ONLY deepseek connected → single fail-safe.
  const r1Alone = decide({ ...BASE, resolvedModel: 'deepseek-r1', connectedProviders: ['deepseek'] });
  assertEq(r1Alone.mode, 'single', '(5) deepseek-r1 + only deepseek → single');
  assert(r1Alone.reason.includes('cannot call tools'), '(5) fail-safe reason: planner cannot call tools', r1Alone.reason);
  assert(r1Alone.reason.includes('fail safe'), '(5) fail-safe reason marked fail safe', r1Alone.reason);

  // (c) strong tool-capable planner + only deepseek connected → single.
  const v32Alone = decide({ ...BASE, resolvedModel: 'deepseek-v3.2', connectedProviders: ['deepseek'] });
  assertEq(v32Alone.mode, 'single', '(5) deepseek-v3.2 + only deepseek → single');
  assert(v32Alone.reason.includes('already tool-capable'), '(5) reason: planner already tool-capable', v32Alone.reason);

  // (b) strong tool-capable planner + anthropic connected → Sonnet executor.
  const v32WithAnthropic = decide({ ...BASE, resolvedModel: 'deepseek-v3.2', connectedProviders: ['deepseek', 'anthropic'] });
  assertEq(v32WithAnthropic.mode, 'plan_then_execute', '(5) deepseek-v3.2 + anthropic → splits');
  assertEq(v32WithAnthropic.executorModelId, 'claude-sonnet-4-6', '(5) v3.2 → sonnet executor');

  // (b) default-key mode: empty/undefined connectedProviders allows Sonnet.
  const gptDefaultKeys = decide({ ...BASE, resolvedModel: 'gpt-5.5', connectedProviders: undefined });
  assertEq(gptDefaultKeys.mode, 'plan_then_execute', '(5) gpt-5.5 + undefined providers (default-key mode) → splits');
  assertEq(gptDefaultKeys.plannerModelId, 'gpt-5.5', '(5) gpt-5.5 is the planner');
  assertEq(gptDefaultKeys.executorModelId, 'claude-sonnet-4-6', '(5) gpt-5.5 → sonnet executor');
  const v32EmptyProviders = decide({ ...BASE, resolvedModel: 'deepseek/deepseek-v3.2', connectedProviders: [] });
  assertEq(v32EmptyProviders.mode, 'plan_then_execute', '(5) prefixed v3.2 + [] providers → splits');
  assertEq(v32EmptyProviders.executorModelId, 'claude-sonnet-4-6', '(5) prefixed v3.2 → sonnet executor');

  // (c) again with a different provider mix: openai-only keys.
  const gptAlone = decide({ ...BASE, resolvedModel: 'gpt-5.5', connectedProviders: ['openai'] });
  assertEq(gptAlone.mode, 'single', '(5) gpt-5.5 + only openai → single (tool-capable planner)');
  assert(gptAlone.reason.includes('already tool-capable'), '(5) gpt-5.5 stays its own executor', gptAlone.reason);

  // Provider names are trimmed + case-normalized.
  const caseProviders = decide({ ...BASE, resolvedModel: 'deepseek-r1', connectedProviders: ['  Anthropic ', 'deepseek'] });
  assertEq(caseProviders.mode, 'plan_then_execute', "(5) 'Anthropic' (any case/space) counts as connected");
  const gemini = decide({ ...BASE, resolvedModel: 'google_ai/gemini-2.5-pro', connectedProviders: ['google_ai', 'anthropic'] });
  assertEq(gemini.mode, 'plan_then_execute', '(5) gemini-2.5-pro (strong) + anthropic → splits');
  assertEq(gemini.executorModelId, 'claude-sonnet-4-6', '(5) gemini → sonnet executor');

  // ─── (6) executor === planner is unreachable; split integrity sweep ───────
  // Resolving to the strong executor itself takes rung (a): sonnet is an
  // Anthropic planner, so the executor is haiku — never itself.
  const sonnetSelf = decide({ ...BASE, resolvedModel: CODING_STRONG_EXECUTOR_MODEL_ID, connectedProviders: ['anthropic'] });
  assertEq(sonnetSelf.mode, 'plan_then_execute', '(6) resolved=strong-executor still splits via rung (a)');
  assertEq(sonnetSelf.executorModelId, CODING_FAST_EXECUTOR_MODEL_ID, '(6) …with haiku, not itself');
  // Resolving to the fast executor (haiku) is blocked earlier by the
  // strong-tier gate — the (a)-rung equality case is unreachable by reason.
  const haikuSelf = decide({ ...BASE, resolvedModel: CODING_FAST_EXECUTOR_MODEL_ID });
  assertEq(haikuSelf.mode, 'single', '(6) resolved=fast-executor gated as basic tier (equality unreachable)');
  assert(haikuSelf.reason.includes("coding tier 'basic'"), '(6) …by the tier reason, before the ladder', haikuSelf.reason);
  assert(producedSplits.length >= 10, '(6) sweep saw a real split population', String(producedSplits.length));
  for (const split of producedSplits) {
    assert(
      typeof split.plannerModelId === 'string' && typeof split.executorModelId === 'string'
        && split.plannerModelId.length > 0 && split.executorModelId.length > 0
        && split.plannerModelId !== split.executorModelId,
      '(6) every produced split has distinct planner/executor',
      `${split.plannerModelId} vs ${split.executorModelId}`,
    );
    assert(
      split.reason.includes(String(split.plannerModelId)) && split.reason.includes(String(split.executorModelId)),
      '(6) every split reason names both models',
      split.reason,
    );
  }

  // ─── (7) planner prompt pins ──────────────────────────────────────────────
  const prompt = buildCodingPlannerPrompt({ message: 'Add dark mode to the settings screen', profile: 'mobile' });
  assert(prompt.includes('senior implementation planner for the mobile profile'), '(7) role line carries the profile');
  assert(prompt.includes('numbered steps'), '(7) numbered-steps instruction');
  assert(prompt.includes('files/symbols'), '(7) exact files/symbols instruction');
  assert(prompt.includes('key risks'), '(7) key-risks instruction');
  assert(prompt.includes('verification to run (typecheck/tests)'), '(7) verification instruction');
  assert(prompt.includes('Do NOT call tools'), '(7) no-tools instruction');
  assert(prompt.includes('Do NOT write full code'), '(7) no-full-code instruction');
  assert(prompt.includes('600 words'), '(7) 600-word cap mentioned');
  assert(prompt.includes('HANDOFF TO EXECUTOR'), '(7) HANDOFF TO EXECUTOR literal present');
  assert(prompt.trimEnd().endsWith('HANDOFF TO EXECUTOR'), '(7) prompt ends on the handoff line');
  assert(prompt.includes('Add dark mode to the settings screen'), '(7) task text quoted');
  const noProfile = buildCodingPlannerPrompt({ message: 'fix the flaky test' });
  assert(noProfile.includes('You are acting as the senior implementation planner.'), '(7) role line intact without profile');
  assert(!noProfile.includes('profile'), '(7) no stray profile mention when omitted');
  const longTask = 'X'.repeat(5_000);
  const longPrompt = buildCodingPlannerPrompt({ message: longTask });
  assert(longPrompt.includes('X'.repeat(2_000)), '(7) first 2000 chars of the task kept');
  assert(!longPrompt.includes('X'.repeat(2_001)), '(7) task capped at 2000 chars');
  assert(longPrompt.includes('…'), '(7) truncation marked with …');

  // ─── (8) handoff note pins ────────────────────────────────────────────────
  const note = buildCodingPlanHandoffNote({
    planText: '1. Edit src/a.ts\n2. Run npm run typecheck',
    plannerModelId: 'claude-opus-4-8',
    executorModelId: 'claude-haiku-4-5',
  });
  assert(note.startsWith('[coding plan handoff]'), '(8) header line first');
  assert(note.includes('claude-opus-4-8'), '(8) planner id present');
  assert(note.includes('claude-haiku-4-5'), '(8) executor id present');
  assert(note.includes('follow it step by step'), '(8) follow-the-plan language');
  assert(note.includes('run the listed verification'), '(8) verification language');
  assert(note.includes('deviate ONLY when live tool evidence contradicts it'), '(8) deviation rule');
  assert(note.includes('note any deviation'), '(8) deviation must be noted');
  assert(note.includes('1. Edit src/a.ts'), '(8) plan text carried');
  assert(!note.includes('plan truncated'), '(8) short plan not marked truncated');
  const longNote = buildCodingPlanHandoffNote({ planText: 'P'.repeat(7_000), plannerModelId: 'a-model', executorModelId: 'b-model' });
  assert(longNote.includes('P'.repeat(6_000)), '(8) first 6000 chars of the plan kept');
  assert(!longNote.includes('P'.repeat(6_001)), '(8) plan capped at 6000 chars');
  assert(longNote.endsWith('… (plan truncated)'), '(8) truncation suffix appended');
  assertEq(buildCodingPlanHandoffNote({ planText: '', plannerModelId: 'a', executorModelId: 'b' }), '', '(8) empty plan → empty note');
  assertEq(buildCodingPlanHandoffNote({ planText: '   \n  ', plannerModelId: 'a', executorModelId: 'b' }), '', '(8) whitespace plan → empty note');
  assertEq(buildCodingPlanHandoffNote({ planText: undefined as unknown as string, plannerModelId: 'a', executorModelId: 'b' }), '', '(8) undefined plan → empty note');

  // ─── (9) auto best-of-N decider ───────────────────────────────────────────
  const raceBase = {
    intent: 'build',
    complexity: 'complex',
    useRuntime: false,
    messageStartsWithCommand: false,
    flagEnabled: true,
  };
  const defaultOff = decideAutoBestOfN({ ...raceBase, connectedProviders: ['anthropic', 'openai'], flagEnabled: undefined });
  assertEq(defaultOff.race, false, '(9) default flag OFF → no race');
  assert(defaultOff.reason.includes('flag is off'), '(9) default-off reason names the flag', defaultOff.reason);
  assertEq(decideAutoBestOfN({ ...raceBase, connectedProviders: ['anthropic', 'openai'], flagEnabled: false }).race, false, '(9) explicit flag false → no race');

  const two = decideAutoBestOfN({ ...raceBase, connectedProviders: ['anthropic', 'openai'] });
  assertEq(two.race, true, '(9) anthropic+openai → race');
  assertEq(JSON.stringify(two.models), JSON.stringify(['claude-sonnet-5', 'gpt-5.6-sol']), '(9) exactly the two current concrete ids, priority order');
  assert(two.reason.includes('claude-sonnet-5') && two.reason.includes('gpt-5.6-sol'), '(9) race reason names the models', two.reason);

  const five = decideAutoBestOfN({ ...raceBase, connectedProviders: ['openrouter', 'deepseek', 'google_ai', 'openai', 'anthropic'] });
  assertEq(five.race, true, '(9) five providers → race');
  assertEq(five.models.length, 3, '(9) capped at 3 models');
  assertEq(JSON.stringify(five.models), JSON.stringify(['claude-sonnet-5', 'gpt-5.6-sol', 'google_ai/gemini-3.6-flash']), '(9) top-3 current models by priority');

  const tail = decideAutoBestOfN({ ...raceBase, connectedProviders: ['openrouter', 'deepseek'] });
  assertEq(tail.race, true, '(9) deepseek+openrouter → race');
  assertEq(JSON.stringify(tail.models), JSON.stringify(['deepseek/deepseek-v4-pro', 'openrouter/auto']), '(9) tail providers keep current priority order');

  const one = decideAutoBestOfN({ ...raceBase, connectedProviders: ['anthropic'] });
  assertEq(one.race, false, '(9) one provider → no race');
  assertEq(one.models.length, 0, '(9) no-race decision carries no models');
  assert(one.reason.includes('at least 2'), '(9) reason explains the 2-provider floor', one.reason);
  assertEq(decideAutoBestOfN({ ...raceBase, connectedProviders: [] }).race, false, '(9) zero providers → no race');
  assertEq(decideAutoBestOfN({ ...raceBase, connectedProviders: undefined }).race, false, '(9) undefined providers → no race');
  assertEq(decideAutoBestOfN({ ...raceBase, connectedProviders: ['anthropic', 'mistral'] }).race, false, '(9) unlisted provider does not count toward the floor');

  const deduped = decideAutoBestOfN({ ...raceBase, connectedProviders: ['anthropic', 'ANTHROPIC ', 'openai'] });
  assertEq(deduped.models.length, 2, '(9) duplicate provider entries deduped');
  const setInput = decideAutoBestOfN({ ...raceBase, connectedProviders: new Set(['openai', 'anthropic']) });
  assertEq(setInput.race, true, '(9) any Iterable (Set) accepted');

  const runtimeTurn = decideAutoBestOfN({ ...raceBase, useRuntime: true, connectedProviders: ['anthropic', 'openai'] });
  assertEq(runtimeTurn.race, false, '(9) useRuntime → no race (text-only)');
  assert(runtimeTurn.reason.includes('text-only'), '(9) runtime reason says text-only', runtimeTurn.reason);
  const commandTurn = decideAutoBestOfN({ ...raceBase, messageStartsWithCommand: true, connectedProviders: ['anthropic', 'openai'] });
  assertEq(commandTurn.race, false, '(9) explicit /command → no race');
  assert(commandTurn.reason.includes('/command'), '(9) command reason names /command', commandTurn.reason);
  assertEq(decideAutoBestOfN({ ...raceBase, complexity: 'moderate', connectedProviders: ['anthropic', 'openai'] }).race, false, '(9) moderate complexity → no race');
  assertEq(decideAutoBestOfN({ ...raceBase, intent: 'chat', connectedProviders: ['anthropic', 'openai'] }).race, false, '(9) non-coding intent → no race');
  assertEq(decideAutoBestOfN({ ...raceBase, intent: 'review', connectedProviders: ['anthropic', 'deepseek'] }).race, true, '(9) review intent races too');

  // ─── (10) degenerate / undefined never throws ─────────────────────────────
  try {
    const d1 = decideCodingModelSplit(undefined as unknown as CodingModelSplitInput);
    assertEq(d1.mode, 'single', '(10) decideCodingModelSplit(undefined) → single');
    assert(typeof d1.reason === 'string' && d1.reason.length > 0, '(10) …with a reason string');
    assertEq(decideCodingModelSplit(null as unknown as CodingModelSplitInput).mode, 'single', '(10) decideCodingModelSplit(null) → single');
    assertEq(decideCodingModelSplit({} as CodingModelSplitInput).mode, 'single', '(10) decideCodingModelSplit({}) → single');
    const junkSplit = decideCodingModelSplit({
      intent: 42, complexity: {}, selectedModel: 9, resolvedModel: null,
      allowedToolNames: 'not-an-array', connectedProviders: 12, flagEnabled: true,
    } as unknown as CodingModelSplitInput);
    assertEq(junkSplit.mode, 'single', '(10) junk-typed split input → single');
    decideCodingModelSplit({ ...BASE, allowedToolNames: [null, 42, 'ok'] as unknown as string[] });
    const stringProviders = decideCodingModelSplit({ ...BASE, resolvedModel: 'deepseek-r1', connectedProviders: 'anthropic' as unknown as string[] });
    assertEq(stringProviders.mode, 'plan_then_execute', '(10) bare-string provider treated as one provider, not chars');

    assert(typeof buildCodingPlannerPrompt(undefined as unknown as { message: string }) === 'string', '(10) planner prompt tolerates undefined args');
    assert(typeof buildCodingPlannerPrompt({} as { message: string }) === 'string', '(10) planner prompt tolerates missing message');
    assert(buildCodingPlannerPrompt({ message: 42 as unknown as string, profile: 7 as unknown as string }).includes('HANDOFF TO EXECUTOR'), '(10) junk-typed prompt args still yield the instruction');
    assertEq(buildCodingPlanHandoffNote(undefined as unknown as Parameters<typeof buildCodingPlanHandoffNote>[0]), '', '(10) handoff note tolerates undefined args');
    assertEq(buildCodingPlanHandoffNote({ planText: 12 } as unknown as Parameters<typeof buildCodingPlanHandoffNote>[0]), '', '(10) non-string plan → empty note');
    assert(buildCodingPlanHandoffNote({ planText: 'plan', plannerModelId: '', executorModelId: undefined as unknown as string }).includes('[coding plan handoff]'), '(10) missing model ids fall back to generic names');

    const n1 = decideAutoBestOfN(undefined as unknown as Parameters<typeof decideAutoBestOfN>[0]);
    assertEq(n1.race, false, '(10) decideAutoBestOfN(undefined) → no race');
    assert(Array.isArray(n1.models) && n1.models.length === 0, '(10) …with empty models');
    assertEq(decideAutoBestOfN(null as unknown as Parameters<typeof decideAutoBestOfN>[0]).race, false, '(10) decideAutoBestOfN(null) → no race');
    assertEq(decideAutoBestOfN({ connectedProviders: 42 } as unknown as Parameters<typeof decideAutoBestOfN>[0]).race, false, '(10) junk providers → no race');
    decideAutoBestOfN({ intent: 'build', complexity: 'complex', connectedProviders: ['anthropic', 'openai'], flagEnabled: true });
    assertEq(typeof isCodingPlanSplitEnabled(undefined), 'boolean', '(10) split flag reader total');
    assertEq(typeof isAutoBestOfNEnabled(undefined), 'boolean', '(10) best-of-N flag reader total');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll coding-model-split-policy smoke cases passed (${passes} passed).`);
}

main();
