/**
 * codingModelSplitPolicy — plan/execute model split for complex coding (PURE).
 *
 * Coding-agent P5 (docs/CODING_AGENT_UPGRADE_PLAN.md): route complex coding
 * turns through a "strong planner turn → fast executor tool loop" split,
 * mirroring the LIVE computer-use arrangement (BlackSwan plans, Sonnet/Haiku
 * executes — see BLACKSWAN_TOOL_EXECUTOR_MODEL_ID in blackswanRouting.ts and
 * MARKETPLACE_TOOL_EXECUTOR_MODEL_ID in marketplaceToolTierPolicy.ts).
 *
 * `decideCodingModelSplit` is the ONE decider for a coding turn:
 *
 *   - 'single'            — today's behavior, byte-identical: one model runs
 *                           the whole turn. Chosen fail-closed whenever the
 *                           flag is off, the turn isn't complex coding, there
 *                           are no tools to loop over, the USER explicitly
 *                           picked a model (explicit pick stays authoritative,
 *                           same rule as serviceProfileSouls), or the resolved
 *                           model isn't a 'strong' coder.
 *   - 'plan_then_execute' — the resolved strong coder does ONE text-only
 *                           planning turn (`buildCodingPlannerPrompt`), then a
 *                           fast/reliable executor runs the tool loop with the
 *                           plan injected (`buildCodingPlanHandoffNote`).
 *                           Executor ladder: Anthropic planner → Haiku (the
 *                           Composer split: Sonnet-class plans, Haiku
 *                           executes); non-Anthropic planner → Sonnet when
 *                           Anthropic keys are usable; otherwise stay single.
 *
 * `decideAutoBestOfN` is the opt-in (DEFAULT OFF — races cost real money)
 * best-of-N decider for complex coding TEXT turns: race up to 3 strong coders
 * across connected providers and keep the best answer. Tool runs never race.
 *
 * Capability truth comes from `modelCapabilities` (`codingTier`, `toolUse`),
 * which fails closed for unknown ids, so an unknown model can never become a
 * planner and a no-tool planner can never be left running the tool loop.
 *
 * Purity: imports ONLY './modelCapabilities'; dependency-light,
 * tsx/esbuild-loadable (no react-native, no supabase, no network). Every
 * export is total — degenerate input never throws.
 * Smoke: `scripts/coding-model-split-policy-smoketest.ts`.
 */

import { getModelCapabilityFlags, getModelCodingTier, normalizeModelId } from './modelCapabilities';

// ─── Feature flags (marketplaceToolTierPolicy seam, explicit-param override) ─
//
// Both readers follow the marketplaceToolTierPolicy flag seam: an explicit
// `flagEnabled` boolean (smoke tests / callers that already resolved the flag
// / native surfaces without localStorage) wins outright; otherwise the same
// defensive globalThis.localStorage read decides; storage errors fall through
// to the default.

/**
 * Plan/execute split flag — DEFAULT ON (like
 * `isStreamEscalateOnToolUseEnabled`): the split only fires for complex
 * coding turns that pass every fail-closed gate below, so the default-on
 * posture is safe. Opt out on web with
 * `localStorage.setItem('uc_coding_plan_split', '0')` ('false'/'off' also
 * disable); native callers pass `flagEnabled` explicitly.
 */
export const CODING_PLAN_SPLIT_FLAG = 'uc_coding_plan_split';

export function isCodingPlanSplitEnabled(flagEnabled?: boolean): boolean {
  // Precedence: explicit param (smokes/native) → localStorage opt-out
  // ('false'/'0'/'off') → default ON.
  if (typeof flagEnabled === 'boolean') return flagEnabled;
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(CODING_PLAN_SPLIT_FLAG);
    if (value === 'false' || value === '0' || value === 'off') return false;
  } catch { /* storage unavailable (native) → default ON unless overridden */ }
  return true;
}

/**
 * Auto best-of-N flag — DEFAULT OFF: racing N models costs real money on
 * every raced turn, so the user opts in. Opt in on web with
 * `localStorage.setItem('uc_auto_best_of_n', '1')` ('true'/'on' also enable);
 * native callers pass `flagEnabled` explicitly.
 */
export const AUTO_BEST_OF_N_FLAG = 'uc_auto_best_of_n';

export function isAutoBestOfNEnabled(flagEnabled?: boolean): boolean {
  // Precedence: explicit param (smokes/native) → localStorage opt-in
  // ('1'/'true'/'on') → default OFF (races cost real money).
  if (typeof flagEnabled === 'boolean') return flagEnabled;
  try {
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const value = store?.getItem?.(AUTO_BEST_OF_N_FLAG);
    if (value === '1' || value === 'true' || value === 'on') return true;
  } catch { /* storage unavailable (native) → default OFF unless overridden */ }
  return false;
}

// ─── Split decider ───────────────────────────────────────────────────────────

/**
 * The fast tool-loop executor for Anthropic planners — the Composer split:
 * a Sonnet/Opus/Fable-class model plans, Haiku executes. Matches the
 * BLACKSWAN_TOOL_EXECUTOR_MODEL_ID precedent in blackswanRouting.ts.
 */
export const CODING_FAST_EXECUTOR_MODEL_ID = 'claude-haiku-4-5';

/**
 * The reliable strong executor for NON-Anthropic planners (only used when
 * Anthropic keys are usable). Mirrors MARKETPLACE_TOOL_EXECUTOR_MODEL_ID /
 * modelCollaborationPolicy's SAFE_DEFAULT_MODEL.
 */
export const CODING_STRONG_EXECUTOR_MODEL_ID = 'claude-sonnet-4-6';

export interface CodingModelSplitInput {
  /** Planner-detected turn intent (split fires only for build/debug/review). */
  intent?: string | null;
  /** Planner-detected complexity (split fires only for 'complex'). */
  complexity?: string | null;
  /** The model the USER picked in the UI ('auto'/empty = no explicit pick). */
  selectedModel?: string | null;
  /** The model this turn actually resolved to (the planner candidate). */
  resolvedModel: string;
  /** Tool names enabled for this run — no tools means no executor loop. */
  allowedToolNames?: readonly string[] | null;
  /** Providers the user/circle has keys for. Empty/undefined = default-key
   *  mode (platform Anthropic keys usable). */
  connectedProviders?: Iterable<string> | null;
  /** Explicit flag override. When omitted, `isCodingPlanSplitEnabled()`
   *  decides (DEFAULT ON). */
  flagEnabled?: boolean;
}

export interface CodingModelSplitDecision {
  mode: 'single' | 'plan_then_execute';
  /** Present only for 'plan_then_execute': the strong text-only planner. */
  plannerModelId?: string;
  /** Present only for 'plan_then_execute': the tool-loop executor. */
  executorModelId?: string;
  /** Short deterministic human reason (telemetry-safe, no secrets). */
  reason: string;
}

/** Intents that count as coding work for the split and best-of-N deciders. */
const CODING_INTENTS: ReadonlySet<string> = new Set(['build', 'debug', 'review']);

/** Lowercase/trim a possibly-junk enum-ish value ('' when not a string). */
function normToken(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Materialize `connectedProviders` into a normalized lowercase set. Total:
 * null/undefined → empty; a bare string is ONE provider name (never iterated
 * char-by-char); non-string entries and junk non-iterables are dropped.
 */
function toProviderSet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (value == null) return out;
  if (typeof value === 'string') {
    const one = value.trim().toLowerCase();
    if (one) out.add(one);
    return out;
  }
  try {
    for (const entry of value as Iterable<unknown>) {
      if (typeof entry !== 'string') continue;
      const provider = entry.trim().toLowerCase();
      if (provider) out.add(provider);
    }
  } catch { /* non-iterable junk → treated as no providers listed */ }
  return out;
}

/**
 * Decide whether ONE coding turn runs single-model (today's behavior) or as
 * a strong-planner → fast-executor split. Fail-closed: every gate falls back
 * to `{ mode: 'single' }` so a wrong answer can only ever cost the split's
 * upside, never break the run.
 */
export function decideCodingModelSplit(input: CodingModelSplitInput): CodingModelSplitDecision {
  const single = (reason: string): CodingModelSplitDecision => ({ mode: 'single', reason });

  if (!isCodingPlanSplitEnabled(input?.flagEnabled)) {
    return single("Coding plan-split flag is off — single-model run (today's behavior).");
  }
  const intent = normToken(input?.intent);
  if (!CODING_INTENTS.has(intent)) {
    return single(`Intent '${intent || 'unknown'}' is not a coding intent (build/debug/review) — single-model run.`);
  }
  const complexity = normToken(input?.complexity);
  if (complexity !== 'complex') {
    return single(`Complexity '${complexity || 'unknown'}' is not 'complex' — the plan/execute split is reserved for complex coding; single-model run.`);
  }
  const rawTools: unknown = input?.allowedToolNames;
  const toolCount = Array.isArray(rawTools)
    ? rawTools.filter((name) => typeof name === 'string' && name.trim().length > 0).length
    : 0;
  if (toolCount === 0) {
    return single('No tools are enabled for this run — there is no executor tool loop to hand off to; single-model run.');
  }
  const selected = typeof input?.selectedModel === 'string' ? input.selectedModel.trim() : '';
  if (selected && selected.toLowerCase() !== 'auto') {
    return single(`User explicitly selected ${selected} — an explicit model pick stays authoritative; single-model run.`);
  }
  const resolvedModel = typeof input?.resolvedModel === 'string' ? input.resolvedModel.trim() : '';
  if (!resolvedModel) {
    return single('No resolved model for this run — single-model run (fail closed).');
  }
  const tier = getModelCodingTier(resolvedModel);
  if (tier !== 'strong') {
    return single(`Resolved model ${resolvedModel} has coding tier '${tier}' — the planner must be a 'strong' coder; single-model run.`);
  }

  // Every gate passed: the resolved strong coder is the planner. Pick an
  // executor down the ladder.
  const planner = resolvedModel;
  const plannerNorm = normalizeModelId(planner);
  const split = (executor: string, why: string): CodingModelSplitDecision => {
    if (normalizeModelId(executor) === plannerNorm) {
      return single(`Planner and executor resolve to the same model (${planner}) — a split adds no value; single-model run.`);
    }
    return {
      mode: 'plan_then_execute',
      plannerModelId: planner,
      executorModelId: executor,
      reason: `complex ${intent}: ${planner} plans, ${executor} executes the tool loop (${why}).`,
    };
  };

  // (a) Anthropic planner → fast Haiku executor (the Composer split; matches
  //     the BLACKSWAN_TOOL_EXECUTOR_MODEL_ID precedent).
  if (plannerNorm.startsWith('claude-')) {
    return split(CODING_FAST_EXECUTOR_MODEL_ID, 'Anthropic planner → fast Anthropic executor, the live computer-use split');
  }

  // (b) Non-Anthropic planner → reliable Claude executor, but ONLY when
  //     Anthropic keys are usable: default-key mode (no connected providers
  //     listed) or 'anthropic' explicitly connected.
  const providers = toProviderSet(input?.connectedProviders);
  if (providers.size === 0 || providers.has('anthropic')) {
    return split(CODING_STRONG_EXECUTOR_MODEL_ID, 'non-Anthropic planner → reliable Claude executor');
  }

  // (c) No Claude executor available; the planner can run its own tools.
  if (getModelCapabilityFlags(planner).toolUse) {
    return single(`${planner} is already tool-capable and no better executor is available (Anthropic is not connected) — single-model run.`);
  }

  // (d) No Claude executor and the planner cannot call tools: keep today's
  //     path rather than inventing an executor (fail safe).
  return single(`${planner} cannot call tools and no tool-capable executor is available (Anthropic is not connected) — keeping today's single-model path (fail safe).`);
}

// ─── Planner turn + executor handoff text ────────────────────────────────────

/** Task text quoted into the planner prompt is capped at this many chars. */
const PLANNER_TASK_CHAR_CAP = 2_000;
/** Plan text carried into the executor handoff note is capped at this many
 *  chars (persisted chat metadata stays bounded). */
const HANDOFF_PLAN_CHAR_CAP = 6_000;

/**
 * The ONE text-only planning turn instruction for the strong planner. The
 * planner must NOT call tools and must NOT write the code itself — it hands a
 * concise plan to the executor loop, ending with the literal line
 * `HANDOFF TO EXECUTOR` so callers can detect a completed plan.
 */
export function buildCodingPlannerPrompt(args: { message: string; profile?: string | null }): string {
  const rawMessage = typeof args?.message === 'string' ? args.message.trim() : '';
  const task = rawMessage.length > PLANNER_TASK_CHAR_CAP
    ? `${rawMessage.slice(0, PLANNER_TASK_CHAR_CAP)}…`
    : rawMessage;
  const profile = typeof args?.profile === 'string' ? args.profile.trim() : '';
  const role = profile
    ? `You are acting as the senior implementation planner for the ${profile} profile.`
    : 'You are acting as the senior implementation planner.';
  return [
    `${role} A faster executor model will carry out your plan with real tools, so plan for it instead of doing the work yourself.`,
    '',
    'Produce a CONCISE implementation plan:',
    '- numbered steps in execution order;',
    '- the exact files/symbols to touch when known;',
    '- key risks;',
    '- the verification to run (typecheck/tests).',
    '',
    'Do NOT call tools. Do NOT write full code — short snippets only where a step is ambiguous. Keep the plan under 600 words.',
    '',
    'Task:',
    '"""',
    task,
    '"""',
    '',
    'End your reply with the literal line:',
    'HANDOFF TO EXECUTOR',
  ].join('\n');
}

/**
 * The user-note injected into the executor tool loop carrying the planner's
 * plan. Degenerate/empty plan text returns '' — the caller skips injection
 * and the executor runs the turn as usual.
 */
export function buildCodingPlanHandoffNote(args: {
  planText: string;
  plannerModelId: string;
  executorModelId: string;
}): string {
  const plan = typeof args?.planText === 'string' ? args.planText.trim() : '';
  if (!plan) return '';
  const planner = typeof args?.plannerModelId === 'string' && args.plannerModelId.trim()
    ? args.plannerModelId.trim()
    : 'the planning model';
  const executor = typeof args?.executorModelId === 'string' && args.executorModelId.trim()
    ? args.executorModelId.trim()
    : 'this executor';
  const capped = plan.length > HANDOFF_PLAN_CHAR_CAP
    ? `${plan.slice(0, HANDOFF_PLAN_CHAR_CAP)}… (plan truncated)`
    : plan;
  return [
    '[coding plan handoff]',
    `A stronger planning model (${planner}) prepared this implementation plan for you (${executor}) to execute: follow it step by step, run the listed verification, and deviate ONLY when live tool evidence contradicts it (note any deviation).`,
    '',
    capped,
  ].join('\n');
}

// ─── Auto best-of-N decider ──────────────────────────────────────────────────

export interface AutoBestOfNInput {
  /** Planner-detected turn intent (race only for build/debug/review). */
  intent?: string | null;
  /** Planner-detected complexity (race only for 'complex'). */
  complexity?: string | null;
  /** True when this turn runs tools — tool runs NEVER race (text-only). */
  useRuntime?: boolean;
  /** True when the message is an explicit /command — commands keep their own
   *  behavior and never race. */
  messageStartsWithCommand?: boolean;
  /** Providers the user/circle has keys for. */
  connectedProviders?: Iterable<string> | null;
  /** Explicit flag override. When omitted, `isAutoBestOfNEnabled()` decides
   *  (DEFAULT OFF — races cost real money). */
  flagEnabled?: boolean;
}

export interface AutoBestOfNDecision {
  race: boolean;
  /** Concrete model ids to race (2–3), in provider priority order. Empty when
   *  race is false. */
  models: string[];
  /** Short deterministic human reason (telemetry-safe, no secrets). */
  reason: string;
}

/** Race candidates in priority order — one concrete strong coder per
 *  eligible provider. */
const BEST_OF_N_PRIORITY: ReadonlyArray<{ provider: string; modelId: string }> = [
  { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  { provider: 'openai', modelId: 'gpt-5.5' },
  { provider: 'google_ai', modelId: 'google_ai/gemini-2.5-pro' },
  { provider: 'deepseek', modelId: 'deepseek/deepseek-v3.2' },
  { provider: 'openrouter', modelId: 'openrouter/auto' },
];

/** Hard cap on raced models — three answers is plenty; each extra one is
 *  pure spend. */
const MAX_BEST_OF_N_MODELS = 3;

/**
 * Decide whether ONE complex coding TEXT turn should race best-of-N across
 * connected providers. Fail-closed to `{ race: false }`: the flag is DEFAULT
 * OFF (races cost real money), tool runs never race, explicit /commands keep
 * their own behavior, and a race needs at least 2 eligible providers.
 */
export function decideAutoBestOfN(input: AutoBestOfNInput): AutoBestOfNDecision {
  const noRace = (reason: string): AutoBestOfNDecision => ({ race: false, models: [], reason });

  if (!isAutoBestOfNEnabled(input?.flagEnabled)) {
    return noRace('Auto best-of-N flag is off (default — races cost real money; the user opts in) — single-model run.');
  }
  const intent = normToken(input?.intent);
  if (!CODING_INTENTS.has(intent)) {
    return noRace(`Intent '${intent || 'unknown'}' is not a coding intent (build/debug/review) — no best-of-N race.`);
  }
  const complexity = normToken(input?.complexity);
  if (complexity !== 'complex') {
    return noRace(`Complexity '${complexity || 'unknown'}' is not 'complex' — no best-of-N race.`);
  }
  if (input?.useRuntime) {
    return noRace('This turn runs tools — best-of-N races are text-only; no race.');
  }
  if (input?.messageStartsWithCommand) {
    return noRace('Message starts with an explicit /command — the command keeps its own behavior; no race.');
  }
  const providers = toProviderSet(input?.connectedProviders);
  const models: string[] = [];
  for (const rung of BEST_OF_N_PRIORITY) {
    if (models.length >= MAX_BEST_OF_N_MODELS) break;
    if (providers.has(rung.provider) && !models.includes(rung.modelId)) {
      models.push(rung.modelId);
    }
  }
  if (models.length < 2) {
    return noRace(`Only ${models.length} of the race-eligible providers (anthropic, openai, google_ai, deepseek, openrouter) are connected — best-of-N needs at least 2; single-model run.`);
  }
  return {
    race: true,
    models,
    reason: `Auto best-of-N: racing ${models.length} models for this complex ${intent} turn — ${models.join(', ')} — best answer wins.`,
  };
}
