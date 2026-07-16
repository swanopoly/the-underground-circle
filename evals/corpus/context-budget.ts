// context-budget — a golden-case corpus module extending the deterministic
// eval net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md, ADD #1).
//
// Companion to evals/coreGoldenCorpus.ts: same `CoreGoldenCase` contract, same
// discipline (each `run()` executes a REAL pure core on a FROZEN input and
// returns true iff the output equals a golden value captured from the real core
// — never invented). This module pins the three cores that decide HOW MUCH
// context a chat turn loads:
//
//   • contextDepthPolicy            — the user `/context` dial (lean/standard/max)
//   • conversationComplexityFloorCore — the mid-task "don't forget the plan" floor
//   • modelContextBudgetCore        — scale the extras budget by the model window
//
// A regression in any of these silently changes what reaches the model (too
// little context → the agent forgets the task; too much → small-window overflow).
// The cases below pin the highest-signal invariant of each.
//
// PURITY: like the sibling corpus this IMPORTS the cores AT RUNTIME (the whole
// point — it exercises them). All three are dependency-light + tsx-loadable
// (type-only imports, no Date.now()/Math.random() at module scope), so the
// aggregator runs under tsx with no react-native / supabase in the graph. Every
// `run()` is self-contained + total: it compares via explicit field/`===` checks
// (never throws), and the aggregator catches anything that would.

import type { CoreGoldenCase } from '../coreGoldenCorpus';

import {
  applyContextDepthToPolicy,
  resolveContextDepthComplexityFloor,
  composeComplexityFloors,
} from '../../src/lib/contextDepthPolicy';
import {
  resolveConversationComplexityFloor,
  estimateTurnComplexity,
} from '../../src/lib/conversationComplexityFloorCore';
import {
  getModelContextWindow,
  resolveModelContextBudget,
} from '../../src/lib/modelContextBudgetCore';

// ─── Frozen inputs ────────────────────────────────────────────────────────────
// Plain policy literals matching resolveChatPromptContextPolicy('complex') and
// ('simple') — reproduced inline so the goldens never depend on the (react-
// tainted) chatPromptAssembly module. Frozen so a core can never mutate them and
// the identity cases (=== on the same reference) are structurally sound.

interface PolicyShape {
  loadProfile: boolean;
  loadMemory: boolean;
  loadWisdom: boolean;
  loadRetrieval: boolean;
  loadMissions: boolean;
  loadSkills: boolean;
  retrievalBudget: number;
  retrievalCount: number;
  maxExtrasChars: number;
}

/** The 'complex' tier policy (resolveChatPromptContextPolicy('complex')). */
const COMPLEX_POLICY: PolicyShape = Object.freeze({
  loadProfile: true,
  loadMemory: true,
  loadWisdom: true,
  loadRetrieval: true,
  loadMissions: true,
  loadSkills: true,
  retrievalBudget: 2500,
  retrievalCount: 12,
  maxExtrasChars: 8000,
});

/** The 'simple' tier policy (resolveChatPromptContextPolicy('simple')). */
const SIMPLE_POLICY: PolicyShape = Object.freeze({
  loadProfile: true,
  loadMemory: true,
  loadWisdom: false,
  loadRetrieval: true,
  loadMissions: false,
  loadSkills: true,
  retrievalBudget: 600,
  retrievalCount: 3,
  maxExtrasChars: 3000,
});

/** A prior COMPLEX user task (multi-clause: "implement … and then refactor …"),
 *  followed by an assistant reply — the classic "agent proposed a plan" trail. */
const PRIOR_COMPLEX_TASK: ReadonlyArray<unknown> = [
  { role: 'user', content: 'please implement the authentication layer and then refactor the token store' },
  { role: 'assistant', content: 'Here is the plan...' },
];

/** A prior MODERATE user task ("update the config file for me") + a reply. */
const PRIOR_MODERATE_TASK: ReadonlyArray<unknown> = [
  { role: 'user', content: 'update the config file for me' },
  { role: 'assistant', content: 'ok' },
];

/** The complex task, then two casual user follow-ups → the topic has wound down. */
const DECAYED_TRAIL: ReadonlyArray<unknown> = [
  { role: 'user', content: 'please implement the authentication layer and then refactor the token store' },
  { role: 'user', content: 'thanks' },
  { role: 'user', content: 'cool' },
];

// ─── Total field-wise policy compare (never throws) ──────────────────────────

function policyMatches(actual: unknown, expected: PolicyShape): boolean {
  if (!actual || typeof actual !== 'object') return false;
  const a = actual as Record<string, unknown>;
  return (
    a.loadProfile === expected.loadProfile &&
    a.loadMemory === expected.loadMemory &&
    a.loadWisdom === expected.loadWisdom &&
    a.loadRetrieval === expected.loadRetrieval &&
    a.loadMissions === expected.loadMissions &&
    a.loadSkills === expected.loadSkills &&
    a.retrievalBudget === expected.retrievalBudget &&
    a.retrievalCount === expected.retrievalCount &&
    a.maxExtrasChars === expected.maxExtrasChars
  );
}

// ─── The corpus ───────────────────────────────────────────────────────────────

export const CASES: CoreGoldenCase[] = [
  // ── suite: context-depth-policy (contextDepthPolicy) ────────────────────────
  {
    id: 'context-budget-depth-standard-is-identity',
    suite: 'context-depth-policy',
    describe:
      "the 'standard' dial is a byte-identical identity — it returns the SAME policy object (no allocation, no drift)",
    run: () => applyContextDepthToPolicy(COMPLEX_POLICY, 'standard') === COMPLEX_POLICY,
  },
  {
    id: 'context-budget-depth-lean-drops-wisdom-and-caps-budgets',
    suite: 'context-depth-policy',
    describe:
      "the 'lean' dial drops wisdom + missions and caps retrieval/extras to the lean floors (600/3/2500), keeping profile+memory+retrieval",
    run: () =>
      policyMatches(applyContextDepthToPolicy(COMPLEX_POLICY, 'lean'), {
        loadProfile: true,
        loadMemory: true,
        loadWisdom: false,
        loadRetrieval: true,
        loadMissions: false,
        loadSkills: true,
        retrievalBudget: 600,
        retrievalCount: 3,
        maxExtrasChars: 2500,
      }),
  },
  {
    id: 'context-budget-depth-max-loads-all-and-boosts',
    suite: 'context-depth-policy',
    describe:
      "the 'max' dial loads every context family and boosts budgets past the complex tier (5000/20/16000)",
    run: () =>
      policyMatches(applyContextDepthToPolicy(COMPLEX_POLICY, 'max'), {
        loadProfile: true,
        loadMemory: true,
        loadWisdom: true,
        loadRetrieval: true,
        loadMissions: true,
        loadSkills: true,
        retrievalBudget: 5000,
        retrievalCount: 20,
        maxExtrasChars: 16000,
      }),
  },
  {
    id: 'context-budget-depth-max-raises-a-small-policy-never-lowers',
    suite: 'context-depth-policy',
    describe:
      "the 'max' dial raises a small (simple-tier) policy's budgets up to the max floors and never below the incoming values",
    run: () => {
      const out = applyContextDepthToPolicy(SIMPLE_POLICY, 'max');
      return (
        policyMatches(out, {
          loadProfile: true,
          loadMemory: true,
          loadWisdom: true,
          loadRetrieval: true,
          loadMissions: true,
          loadSkills: true,
          retrievalBudget: 5000,
          retrievalCount: 20,
          maxExtrasChars: 16000,
        }) &&
        // never LOWERED the incoming small budgets
        out.retrievalBudget >= SIMPLE_POLICY.retrievalBudget &&
        out.maxExtrasChars >= SIMPLE_POLICY.maxExtrasChars
      );
    },
  },
  {
    id: 'context-budget-depth-max-floors-complexity-to-complex',
    suite: 'context-depth-policy',
    describe:
      "only 'max' imposes a 'complex' complexity floor; 'lean' and 'standard' impose none (null)",
    run: () =>
      resolveContextDepthComplexityFloor('max') === 'complex' &&
      resolveContextDepthComplexityFloor('lean') === null &&
      resolveContextDepthComplexityFloor('standard') === null,
  },
  {
    id: 'context-budget-compose-takes-higher-floor',
    suite: 'context-depth-policy',
    describe:
      'composeComplexityFloors returns the HIGHER of two floors, passes through when one is null, and null when both are absent',
    run: () =>
      composeComplexityFloors('simple', 'complex') === 'complex' &&
      composeComplexityFloors('complex', 'simple') === 'complex' &&
      composeComplexityFloors(null, 'moderate') === 'moderate' &&
      composeComplexityFloors(null, null) === null,
  },

  // ── suite: complexity-floor (conversationComplexityFloorCore) ───────────────
  {
    id: 'context-budget-floor-raises-thin-turn-after-complex-task',
    suite: 'complexity-floor',
    describe:
      "a bare/thin current turn after a COMPLEX prior task floors to 'moderate' (one tier below), raising the turn's context",
    run: () => resolveConversationComplexityFloor(PRIOR_COMPLEX_TASK, 'trivial') === 'moderate',
  },
  {
    id: 'context-budget-floor-moderate-prior-yields-simple',
    suite: 'complexity-floor',
    describe:
      "a thin current turn after a MODERATE prior task floors to 'simple' (one tier below the substantive turn)",
    run: () => resolveConversationComplexityFloor(PRIOR_MODERATE_TASK, 'trivial') === 'simple',
  },
  {
    id: 'context-budget-floor-never-lowers-a-substantive-turn',
    suite: 'complexity-floor',
    describe:
      "the floor is a no-op (null) when the current turn is already substantive ('complex'), so it can never LOWER a tier",
    run: () => resolveConversationComplexityFloor(PRIOR_COMPLEX_TASK, 'complex') === null,
  },
  {
    id: 'context-budget-floor-decays-after-casual-turns',
    suite: 'complexity-floor',
    describe:
      'the floor decays to null once two casual user follow-ups have passed since the substantive task (the topic wound down)',
    run: () => resolveConversationComplexityFloor(DECAYED_TRAIL, 'trivial') === null,
  },
  {
    id: 'context-budget-floor-thin-or-nonarray-trail-no-op',
    suite: 'complexity-floor',
    describe:
      'a single-message trail (no established task yet) or a non-array history both yield no floor (null)',
    run: () =>
      resolveConversationComplexityFloor([{ role: 'user', content: 'hi' }], 'trivial') === null &&
      resolveConversationComplexityFloor(null, 'trivial') === null,
  },
  {
    id: 'context-budget-estimate-buckets-tiers',
    suite: 'complexity-floor',
    describe:
      "the inline estimator buckets an affirmation → trivial, an imperative task → moderate, a multi-step plan → complex, a short question → simple",
    run: () =>
      estimateTurnComplexity('yes') === 'trivial' &&
      estimateTurnComplexity('build the whole auth system now') === 'moderate' &&
      estimateTurnComplexity('first scaffold the module and then wire it up') === 'complex' &&
      estimateTurnComplexity('what does this function do exactly') === 'simple' &&
      estimateTurnComplexity(12345 as unknown) === 'trivial',
  },

  // ── suite: model-context-budget (modelContextBudgetCore) ────────────────────
  {
    id: 'context-budget-window-small-default-large-ordered',
    suite: 'model-context-budget',
    describe:
      'the window table returns a small window for gpt-4 (8k) < the default band for Claude (200k) < a large window for Gemini (1M), strictly ordered',
    run: () => {
      const gpt4 = getModelContextWindow('gpt-4');
      const claude = getModelContextWindow('claude-opus-4-8');
      const gemini = getModelContextWindow('gemini-2.5-pro');
      return (
        gpt4 === 8_000 &&
        claude === 200_000 &&
        gemini === 1_000_000 &&
        gpt4 < claude &&
        claude < gemini
      );
    },
  },
  {
    id: 'context-budget-window-prefix-normalized-unknown-null',
    suite: 'model-context-budget',
    describe:
      'a provider-prefixed id normalizes to the same window as the bare id, while unknown/non-string ids fail open to null',
    run: () =>
      getModelContextWindow('google_ai/gemini-2.5-pro') === 1_000_000 &&
      getModelContextWindow('totally-made-up-model') === null &&
      getModelContextWindow(42 as unknown) === null,
  },
  {
    id: 'context-budget-model-large-window-raises-budget',
    suite: 'model-context-budget',
    describe:
      'a large-window (1M) model scales the extras/retrieval budget UP above the incoming complex policy (16000/5000/24)',
    run: () => {
      const out = resolveModelContextBudget(COMPLEX_POLICY, { modelContextWindow: 1_000_000 });
      return (
        out.maxExtrasChars === 16_000 &&
        out.retrievalBudget === 5_000 &&
        out.retrievalCount === 24 &&
        out.maxExtrasChars > COMPLEX_POLICY.maxExtrasChars &&
        out.retrievalCount > COMPLEX_POLICY.retrievalCount
      );
    },
  },
  {
    id: 'context-budget-model-small-window-lowers-budget',
    suite: 'model-context-budget',
    describe:
      'a small-window (8k) model scales the budget DOWN below the incoming complex policy (4000/1250/6) so it cannot overflow',
    run: () => {
      const out = resolveModelContextBudget(COMPLEX_POLICY, { modelContextWindow: 8_000 });
      return (
        out.maxExtrasChars === 4_000 &&
        out.retrievalBudget === 1_250 &&
        out.retrievalCount === 6 &&
        out.maxExtrasChars < COMPLEX_POLICY.maxExtrasChars &&
        out.retrievalCount < COMPLEX_POLICY.retrievalCount
      );
    },
  },
  {
    id: 'context-budget-model-mid-band-and-unknown-are-identity',
    suite: 'model-context-budget',
    describe:
      'a mid-band (200k) window OR an unknown (null) window returns the SAME policy object (identity — no regression for default models)',
    run: () =>
      resolveModelContextBudget(COMPLEX_POLICY, { modelContextWindow: 200_000 }) === COMPLEX_POLICY &&
      resolveModelContextBudget(COMPLEX_POLICY, { modelContextWindow: null }) === COMPLEX_POLICY,
  },
  {
    id: 'context-budget-model-scaling-is-deterministic',
    suite: 'model-context-budget',
    describe:
      'the budget transform is deterministic — repeated calls with the same window yield identical output',
    run: () => {
      const a = resolveModelContextBudget(COMPLEX_POLICY, { modelContextWindow: 1_000_000 });
      const b = resolveModelContextBudget(COMPLEX_POLICY, { modelContextWindow: 1_000_000 });
      return (
        JSON.stringify(a) === JSON.stringify(b) &&
        getModelContextWindow('gemini-2.5-pro') === getModelContextWindow('gemini-2.5-pro')
      );
    },
  },
];
