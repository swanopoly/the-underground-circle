/**
 * serviceProfileSouls — Phase C3 of the OpenSwan/Chat Architecture Plan.
 *
 * Single source of truth that maps the OpenSwan service menu's
 * `sessionProfile` (Build/Review/Debug/Arch) to SOUL spirit IDs and
 * preferred models. Every file that cares about "which SOUL is active"
 * imports from here instead of guessing.
 */

import type { SessionCodingProfile } from './chatSessionProfile';
import {
  BLACKSWAN_ENDPOINT_MODEL_ID,
  BLACKSWAN_PUBLIC_MODEL_ID,
  describeBlackSwanEscalation,
  isLocalOllamaBlackSwan,
  shouldEscalateBlackSwanToFrontier,
} from './blackswanRouting';

export const PROFILE_SOUL_MAP: Record<SessionCodingProfile, string> = {
  auto:      'sr-engineer',
  senior:    'sr-engineer',
  review:    'code-reviewer',
  debug:     'sr-engineer',     // debug shares the engineer SOUL; no distinct debugger spirit yet
  architect: 'architect',
  research:  'ai-researcher',
  design:    'designer',
  support:   'civil-engineer',
};

export function soulKeyForProfile(profile: SessionCodingProfile): string {
  return `soul:${PROFILE_SOUL_MAP[profile] || 'sr-engineer'}`;
}

export function spiritIdForProfile(profile: SessionCodingProfile): string {
  return PROFILE_SOUL_MAP[profile] || 'sr-engineer';
}

export function resolveModelForProfile(
  profile: SessionCodingProfile,
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  connectedProviders?: ConnectedProviderSet,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  opts?: { appGroundedHint?: boolean },
  /** Raw user message text. Optional — forwarded to resolveModelForSoul so
   *  the BlackSwan reliability guard can escalate the hard subset of the
   *  grounded lane. Omit it to keep the pre-guard behaviour unchanged. */
  message?: string | null,
): string {
  // USER DIRECTIVE (2026-07-31): the chat Auto picker DEFAULTS to Claude
  // Sonnet. The routing ladder (resolveModelForSoul) no longer decides the
  // chat turn — it powers suggestAutoModelAlternative, which RECOMMENDS a
  // cheaper/specialist model to the user instead of silently switching.
  // Explicit picks still pass verbatim (including the BlackSwan endpoint
  // normalization inside resolveModelForSoul).
  if (userModelPick && userModelPick !== 'auto') {
    return resolveModelForSoul(
      spiritIdForProfile(profile),
      userModelPick,
      intent,
      complexity,
      undefined,
      undefined,
      connectedProviders,
      opts,
      message,
    );
  }
  // Sonnet-first: bill to the user's OpenRouter key when that is the only
  // Sonnet route they have connected; otherwise the direct Anthropic model.
  const anthropicConnected = hasProvider(connectedProviders, 'anthropic');
  const orConnected = hasProvider(connectedProviders, 'openrouter');
  if (!anthropicConnected && orConnected) return 'openrouter/anthropic/claude-sonnet-4-6';
  return 'claude-sonnet-4-6';
}

/** What Auto WOULD have routed to under the cost/speciality ladder. Returned
 *  as a user-facing recommendation ("Haiku would be cheaper for this") —
 *  never applied automatically. Null when the ladder agrees with the Sonnet
 *  default (or lands on any Sonnet variant). */
export function suggestAutoModelAlternative(
  profile: SessionCodingProfile,
  intent?: import('./agenticCodingProfile').MessageIntent,
  connectedProviders?: ConnectedProviderSet,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  opts?: { appGroundedHint?: boolean },
  message?: string | null,
): { model: string; reason: string } | null {
  const ladderPick = resolveModelForSoul(
    spiritIdForProfile(profile),
    'auto',
    intent,
    complexity,
    undefined,
    undefined,
    connectedProviders,
    opts,
    message,
  );
  if (!ladderPick || /claude-sonnet|anthropic\/claude-sonnet/i.test(ladderPick)) return null;
  const reason = /blackswan/i.test(ladderPick)
    ? 'BlackSwan is trained on this app’s own data and handles grounded status/memory turns well.'
    : /haiku|nano|mini|flash|lite|llama3\.2|small/i.test(ladderPick)
      ? 'A lighter model would answer this kind of turn faster and cheaper.'
      : /sonar|perplexity/i.test(ladderPick)
        ? 'A search-grounded model fits this research request.'
        : 'A specialist model fits this request.';
  return { model: ladderPick, reason };
}

/** Recommendation for an EXPLICIT weak-tier pick on action/tool work — the
 *  gpt-5.4-nano-drives-a-desktop-sequence failure mode. Advisory only. */
export function suggestModelForManualPick(
  userModelPick: string | null | undefined,
  draft: string | null | undefined,
): { model: string; reason: string } | null {
  const pick = String(userModelPick || '').trim();
  if (!pick || pick === 'auto') return null;
  if (!/nano|mini|lite|flash|3\.2|small/i.test(pick)) return null;
  const text = String(draft || '');
  if (!/\b(open|launch|create|click|type|run|build|fix|edit|automate|photoshop|browser|desktop|file|project|document)\b/i.test(text)) return null;
  return {
    model: 'claude-sonnet-4-6',
    reason: `${pick} is a light model and often fails multi-step tool work — Claude Sonnet is recommended for this task.`,
  };
}

// Per-SOUL model preferences. User's explicit model pick always wins;
// this is the fallback when the user has "auto" selected.
//
// Sonnet is the baseline across all souls — casual/social/status turns
// are still routed to Haiku below, but any task with real intent
// (build, review, question, research) gets at least Sonnet capability.
// This prevents "auto" from silently routing a non-trivial coding
// message to GPT-4.1 Mini or a nano-tier model just because a cheap
// provider is connected.
const SOUL_MODEL_DEFAULTS: Record<string, string> = {
  'sr-engineer':   'claude-sonnet-4-6',
  'code-reviewer': 'claude-sonnet-4-6',
  architect:       'claude-sonnet-4-6',
  'civil-engineer':'claude-sonnet-4-6',
  debugger:        'claude-sonnet-4-6',
  designer:        'claude-sonnet-4-6',
  writer:          'claude-sonnet-4-6',
  'ml-engineer':   'claude-sonnet-4-6',
  'ai-researcher': 'claude-sonnet-4-6',
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Resolve the model to use for a given SOUL + user preference.
 *
 * Priority:
 *   1. User's explicit dropdown pick (when not `auto`) — always wins.
 *   2. Intent × complexity table below — routes between Haiku, Sonnet,
 *      and stronger non-Anthropic connected providers based on how much
 *      reasoning the message needs.
 *   3. SOUL defaults.
 *   4. Haiku fallback.
 *
 * Opus is intentionally not part of Auto (explicit pick only — no surprise
 * spend). BlackSwan (P8) IS part of Auto, but ONLY for the lanes its
 * training actually wins: app-grounded conversational turns (status /
 * memory / casual / social intents, plus light questions the caller has
 * flagged as app-domain via `appGroundedHint`). It never gets tool,
 * computer-use, coding, research, or heavy-reasoning turns — callers strip
 * the 'blackswan' provider for action requests, and the OpenSwan typed
 * loop swaps it for the tool executor (`resolveOpenSwanToolLoopModel`)
 * while keeping BlackSwan as grounding context.
 */
/**
 * Connected marketplace providers used to bias the Auto router. OpenRouter
 * still gets first preference when present because it can route across
 * multiple vendors. Direct BYOK providers then let Auto use each user's own
 * stored key through llm-proxy instead of falling back to platform keys.
 */
export type ConnectedProviderSet = ReadonlySet<string>;

function hasProvider(providers: ConnectedProviderSet | undefined, provider: string): boolean {
  if (!providers) return false;
  if (providers.has(provider)) return true;
  if (provider === 'huggingface') return providers.has('hugging_face');
  if (provider === 'zai') return providers.has('z_ai');
  return false;
}

function firstConnected(
  providers: ConnectedProviderSet | undefined,
  candidates: Array<[provider: string, model: string | null]>,
): string | null {
  for (const [provider, model] of candidates) {
    if (model && hasProvider(providers, provider)) return model;
  }
  return null;
}

export function resolveModelForSoul(
  spiritId: string | null | undefined,
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  /** When true (the Phase-1 `converging` state), use a stronger model
   *  than Haiku, but do not auto-escalate to Opus. */
  buildConverging?: boolean,
  /** When true, the current message is in the `exploring` phase — the bot
   *  is just asking the next clarifying question. Haiku handles this at a
   *  fraction of the latency of Sonnet/Opus. */
  buildExploring?: boolean,
  /** Marketplace integrations the team has connected. Lets Auto bias
   *  toward the user's BYOK keys — e.g., when OpenRouter is connected,
   *  routes through OR-prefixed Anthropic / OpenAI models so the bill
   *  goes to their OR account instead of the platform key. */
  connectedProviders?: ConnectedProviderSet,
  /** P8 caller hints. `appGroundedHint`: the message text reads as an
   *  app-domain turn (blackswanRouting.looksLikeAppGroundedMessage) —
   *  lets light questions route to BlackSwan, which is trained on the
   *  app's own data. Optional everywhere; omitting it only means
   *  questions stay on frontier models. */
  opts?: { appGroundedHint?: boolean },
  /** Reliability guard input. The raw user message text for the turn.
   *  Optional everywhere: when present it lets the BlackSwan Auto lane
   *  ESCALATE the genuinely-hard subset (multi-step / action / technical /
   *  long-compound / ambiguous) to the lane's frontier fallback — a
   *  confidence proxy for "beyond a 4B model's reliable discrimination,"
   *  NOT a BlackSwan removal. Omitting it (the pre-guard 8-arg call shape)
   *  simply keeps BlackSwan on every lane it already owned. */
  message?: string | null,
): string {
  // LOCKSTEP: explainAutoModelChoice / classifyAutoModelReasonKind (below in
  // this file) mirror this decision ladder branch-for-branch, in this exact
  // order, to tell users WHY Auto chose a model. If you add, remove, or
  // reorder a lane here, update the classifier + reason table in the same
  // commit — the anti-drift matrix in
  // scripts/blackswan-auto-routing-smoketest.ts fails when the two disagree.
  if (userModelPick && userModelPick !== 'auto') {
    // P8 hard rule: cswan801/BlackSwan-v5 on the dedicated endpoint is the
    // ONLY BlackSwan. The local Ollama weight is retired from the catalog;
    // stale persisted picks ('blackswan' / 'ollama/blackswan') normalize to
    // the v5 endpoint instead of hitting the deprecated local weight. This
    // is the one sanctioned exception to explicit-picks-pass-verbatim —
    // a same-family upgrade, never a cross-vendor rewrite.
    if (isLocalOllamaBlackSwan(userModelPick)) return BLACKSWAN_ENDPOINT_MODEL_ID;
    return userModelPick;
  }

  const HAIKU = 'claude-haiku-4-5';
  const SONNET = 'claude-sonnet-4-6';
  // Auto should prefer user-connected BYOK providers first, not the
  // platform Claude key. The ladders below model provider strengths:
  // cheap/local for low-value turns, search-grounded for research,
  // long-context for large reads, code-specialists for builds, and
  // browser-safe chat models for Stagehand/browser planning.
  const orConnected = hasProvider(connectedProviders, 'openrouter');
  const anthropicConnected = hasProvider(connectedProviders, 'anthropic');

  const directNano = firstConnected(connectedProviders, [
    ['ollama', 'ollama/llama3.2'],
    ['openai', 'openai/gpt-5.4-nano'],
    ['groq', 'groq/llama-3.3-70b-versatile'],
    ['google_ai', 'google_ai/gemini-3.1-flash-lite'],
    ['deepseek', 'deepseek/deepseek-chat'],
    ['mistral_ai', 'mistral_ai/mistral-small-latest'],
    ['zai', 'zai/glm-4-flash'],
    ['minimax', 'minimax/MiniMax-Text-01'],
  ]);
  const directFast = firstConnected(connectedProviders, [
    ['groq', 'groq/llama-3.3-70b-versatile'],
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['openai', 'openai/gpt-5.4-mini'],
    ['deepseek', 'deepseek/deepseek-chat'],
    ['mistral_ai', 'mistral_ai/mistral-large-latest'],
    ['together_ai', 'together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/llama-v3p1-405b-instruct'],
    ['huggingface', 'huggingface/Qwen/Qwen3-32B'],
    ['zai', 'zai/glm-4-air'],
    ['minimax', 'minimax/MiniMax-Text-01'],
  ]);
  const directStrong = firstConnected(connectedProviders, [
    ['openai', 'openai/gpt-5.5'],
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['deepseek', 'deepseek/deepseek-reasoner'],
    ['mistral_ai', 'mistral_ai/mistral-large-latest'],
    ['cohere', 'cohere/command-r-plus'],
    ['together_ai', 'together_ai/Qwen/Qwen3-235B-A22B-fp8-tput'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/deepseek-r1'],
    ['zai', 'zai/glm-5'],
    ['minimax', 'minimax/MiniMax-M1'],
    ['huggingface', 'huggingface/Qwen/Qwen3-235B-A22B'],
  ]);
  const directCode = firstConnected(connectedProviders, [
    ['openai', 'openai/gpt-5.5'],
    ['mistral_ai', 'mistral_ai/codestral-latest'],
    ['deepseek', 'deepseek/deepseek-chat'],
    ['together_ai', 'together_ai/Qwen/Qwen3-235B-A22B-fp8-tput'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/deepseek-r1'],
    ['zai', 'zai/glm-5'],
    ['huggingface', 'huggingface/Qwen/Qwen3-235B-A22B'],
  ]) || directStrong;
  const directReasoner = firstConnected(connectedProviders, [
    ['openai', 'openai/gpt-5.5'],
    ['deepseek', 'deepseek/deepseek-reasoner'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/deepseek-r1'],
    ['together_ai', 'together_ai/Qwen/Qwen3-235B-A22B-fp8-tput'],
  ]) || directStrong;
  const directResearch = firstConnected(connectedProviders, [
    ['perplexity', 'perplexity/sonar-deep-research'],
    ['perplexity', 'perplexity/sonar-reasoning-pro'],
    ['perplexity', 'perplexity/sonar-pro'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['openai', 'openai/gpt-5.5'],
    ['cohere', 'cohere/command-r-plus'],
    ['deepseek', 'deepseek/deepseek-reasoner'],
  ]) || directReasoner || directStrong;
  const directBrowser = firstConnected(connectedProviders, [
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['openai', 'openai/gpt-5.4-mini'],
    ['anthropic', SONNET],
    ['mistral_ai', 'mistral_ai/mistral-large-latest'],
    ['deepseek', 'deepseek/deepseek-chat'],
  ]) || directFast || directStrong;
  const directLong = firstConnected(connectedProviders, [
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['minimax', 'minimax/MiniMax-M1'],
    ['cohere', 'cohere/command-r-plus'],
    ['openai', 'openai/gpt-5.5'],
  ]) || directStrong;

  const OR_SONNET = 'openrouter/anthropic/claude-sonnet-4-6';
  const OR_REASONER = 'openrouter/openai/gpt-5.5';
  const OR_FAST = 'openrouter/openai/gpt-5.4-mini';
  const OR_LONG = 'openrouter/google/gemini-3.5-flash';
  const OR_BROWSER = 'openrouter/google/gemini-3.5-flash';

  // Exploring phase: ask one focused question — Haiku is plenty, ~2-3x
  // faster than Sonnet. User-visible latency drops hard here because
  // discovery turns are the most latency-sensitive part of the flow
  // (each one gates the next user action).
  if (buildExploring) return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);

  // Build-converging needs more reasoning than a clarifying question, but
  // Sonnet / connected reasoners are enough for the first brief. Opus stays
  // opt-in so Auto cannot create high-cost surprises.
  if (buildConverging) return directStrong || (orConnected ? OR_REASONER : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);

  if (intent) {
    const isLight = complexity === 'trivial' || complexity === 'simple';
    const isHeavy = complexity === 'complex';

    // P8 — BlackSwan lane. The app-trained model wins exactly where its
    // training data lives: circle status, memory recall, and the app's
    // social voice. Only when the BlackSwan marketplace integration is
    // connected; the dedicated endpoint id is the production route and
    // carries a defined failover chain (MODEL_FAILOVER below), so a cold
    // endpoint degrades to Haiku/Sonnet instead of erroring the turn.
    // Callers strip 'blackswan' from the provider set for action-shaped
    // messages, and the tool loops swap in the executor — so this lane
    // can never receive tool or computer-use work.
    const blackswanConnected = hasProvider(connectedProviders, 'blackswan');
    if (blackswanConnected) {
      // Reliability guard (confidence proxy, NOT a BlackSwan removal):
      // BlackSwan-v5 is a small (Qwen3.5-4B) fine-tune that mis-discriminates
      // on hard/broad/ambiguous inputs, which reads to the user as the model
      // "getting dumber." When the SAME app-grounded lane carries a
      // genuinely-hard signal, we ESCALATE just that subset to the frontier
      // model this lane would otherwise pick — by falling THROUGH to the
      // non-BlackSwan branches below (casual_lane / question_*), which ARE
      // the lane's frontier fallback (single source of truth, no ladder
      // duplication). BlackSwan still wins every simple grounded turn: the
      // guard is conservative and returns false for status/streak/decision/
      // count/casual phrasing. `message` is optional; absent it, escalation
      // never fires and every lane behaves exactly as before.
      const blackswanEscalation = message
        ? shouldEscalateBlackSwanToFrontier(message)
        : { escalate: false, reason: null };
      if (!blackswanEscalation.escalate) {
        if (intent === 'status' || intent === 'memory' || intent === 'casual' || intent === 'social') {
          return BLACKSWAN_ENDPOINT_MODEL_ID;
        }
        if (intent === 'question' && !isHeavy && opts?.appGroundedHint) {
          return BLACKSWAN_ENDPOINT_MODEL_ID;
        }
      }
      // else: escalate → do NOT return here; fall through to the frontier
      // lanes below so the turn lands on the exact model Auto would have used
      // for this intent absent BlackSwan.
    }

    // Always-Haiku-class intents regardless of complexity — low
    // signal, low cost. When OpenAI is connected we lean on the
    // nano tier (gpt-4.1-nano) which is even cheaper than Haiku on
    // a per-token basis.
    if (intent === 'casual' || intent === 'social' || intent === 'status' || intent === 'memory') {
      return directNano || directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }

    // Questions: Haiku is the new default. Only escalate when the
    // question is heavy (compare / tradeoffs / which-is-better caught
    // as `complex`) — and even then, only Sonnet, not Opus.
    if (intent === 'question') {
      if (isHeavy) {
        return directStrong || (orConnected ? OR_SONNET : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
      }
      return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }

    // Research + architect use strong connected providers first and only
    // fall back to Sonnet on Anthropic. Opus is explicit-pick only.
    if (intent === 'research') {
      return directResearch || directLong || (orConnected ? OR_LONG : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
    }
    if (intent === 'architect') {
      return directReasoner || directStrong || (orConnected ? OR_REASONER : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
    }

    // Coding intents — Sonnet minimum even for non-heavy turns.
    // Real code tasks need a capable model regardless of complexity
    // classification; routing a build message to a nano-tier model
    // because it looked "simple" produces bad diffs and missed context.
    if (intent === 'build' || intent === 'debug' || intent === 'review') {
      if (isHeavy) {
        return directCode || (orConnected ? OR_REASONER : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
      }
      return directFast || (orConnected ? OR_SONNET : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
    }

    // Design / creative — directFast (now GPT-4.1 / Gemini Flash tier)
    // is plenty for one-shot variations and edits.
    if (intent === 'design' || intent === 'creative') {
      return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }

    // Browser / computer-use planning must use a chat-compatible model.
    // Dedicated CUA execution is handled by the browser/computer runtime
    // (computer-use-agent edge function) which always enforces Sonnet.
    if (intent === 'browser') {
      if (directBrowser) return directBrowser;
      if (orConnected) return OR_BROWSER;
      return anthropicConnected ? SONNET : DEFAULT_MODEL;
    }

    // Task management / support — directFast (GPT-4.1 / Flash) is
    // fine; these are mostly state lookups not deep reasoning turns.
    if (intent === 'task_mgmt' || intent === 'support') {
      return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }
  }

  // Unknown intent or empty input — use Sonnet as the safe default so
  // the user never sees a mini-tier model chosen before they've typed
  // anything meaningful.
  const soulDefault = spiritId ? (SOUL_MODEL_DEFAULTS[spiritId] || DEFAULT_MODEL) : DEFAULT_MODEL;
  return directFast || (orConnected ? OR_SONNET : null) || (anthropicConnected ? soulDefault : DEFAULT_MODEL);
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-model transparency — name WHY Auto chose a model, not just which.
// Cursor shows which model runs but never why; we surface the reason
// ("BlackSwan — app-domain question", "GPT-5.5 — complex build via your
// OpenAI key"). Pure presentation layer: ZERO routing changes.
//
// LOCKSTEP: classifyAutoModelReasonKind mirrors resolveModelForSoul's ladder
// branch-for-branch, in the same order, but never picks the model itself —
// the id is always delegated to resolveModelForSoul with the same arguments
// (single source of truth); the explainer only names the lane that fired.
// New/changed/reordered lanes in resolveModelForSoul must update the
// classifier + reason table here in the same commit — the anti-drift matrix
// in scripts/blackswan-auto-routing-smoketest.ts fails when they disagree.
// ─────────────────────────────────────────────────────────────────────────────

/** Which resolveModelForSoul lane produced the Auto model choice. */
export type AutoModelChoiceReasonKind =
  | 'explicit_pick' | 'legacy_blackswan_normalized'
  | 'blackswan_app_lane' | 'blackswan_app_question'
  | 'blackswan_escalated_to_frontier'
  | 'build_exploring' | 'build_converging'
  | 'casual_lane' | 'question_light' | 'question_heavy'
  | 'research_lane' | 'architect_lane' | 'coding_lane'
  | 'design_lane' | 'browser_lane' | 'task_support_lane'
  | 'soul_default';

export interface AutoModelChoiceExplanation {
  model: string;
  reasonKind: AutoModelChoiceReasonKind;
  /** One short user-facing clause, ≤60 chars, no jargon — e.g. 'app question → BlackSwan', 'complex build → strongest coder', 'quick reply → fast tier'. */
  reason: string;
}

// Base reason per lane. Record<...> keeps this exhaustive: adding a new
// reasonKind without wording fails typecheck. All strings must stay ≤60
// chars and human — no provider ids, no router jargon (smoke-enforced).
const AUTO_CHOICE_REASONS: Record<AutoModelChoiceReasonKind, string> = {
  explicit_pick:               'you picked this model',
  legacy_blackswan_normalized: 'old BlackSwan pick → current v5',
  blackswan_app_lane:          'app-domain turn → app-trained BlackSwan',
  blackswan_app_question:      'app question → app-trained BlackSwan',
  blackswan_escalated_to_frontier: 'hard app turn → frontier fallback',
  build_exploring:             'scoping questions → fast tier',
  build_converging:            'plan converging → stronger reasoner',
  casual_lane:                 'quick reply → fast tier',
  question_light:              'quick question → fast tier',
  question_heavy:              'complex question → stronger reasoner',
  research_lane:               'research → search-grounded model',
  architect_lane:              'architecture → deep reasoner',
  coding_lane:                 'code work → capable coder',
  design_lane:                 'design/creative → fast tier',
  browser_lane:                'browser planning → chat-safe model',
  task_support_lane:           'task/support lookup → fast tier',
  soul_default:                'no clear intent → safe default',
};

/** Light intent/complexity-aware wording on top of the base table. */
function reasonTextForAutoChoice(
  kind: AutoModelChoiceReasonKind,
  intent?: import('./agenticCodingProfile').MessageIntent,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  message?: string | null,
): string {
  if (kind === 'blackswan_escalated_to_frontier') {
    // Name WHY the grounded lane escaped BlackSwan (multi-step / action /
    // technical / long / ambiguous). Recomputed from the same guard so the
    // wording tracks the real reason; ≤60 chars by construction.
    const { reason } = shouldEscalateBlackSwanToFrontier(message);
    return describeBlackSwanEscalation(reason);
  }
  if (kind === 'blackswan_app_lane') {
    if (intent === 'status') return 'status check → app-trained BlackSwan';
    if (intent === 'memory') return 'memory recall → app-trained BlackSwan';
  }
  if (kind === 'casual_lane') {
    if (intent === 'status') return 'status check → fast tier';
    if (intent === 'memory') return 'memory recall → fast tier';
  }
  if (kind === 'coding_lane' && complexity === 'complex') {
    if (intent === 'debug') return 'complex debug → strongest coder';
    if (intent === 'review') return 'complex review → strongest coder';
    return 'complex build → strongest coder';
  }
  return AUTO_CHOICE_REASONS[kind];
}

/**
 * LOCKSTEP mirror of resolveModelForSoul's ladder — same branches, same
 * order, same guards. Classifies WHICH lane fires; never returns a model.
 */
function classifyAutoModelReasonKind(
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  buildConverging?: boolean,
  buildExploring?: boolean,
  connectedProviders?: ConnectedProviderSet,
  opts?: { appGroundedHint?: boolean },
  message?: string | null,
): AutoModelChoiceReasonKind {
  // 1. Explicit pick — incl. the one sanctioned normalization (stale local
  //    BlackSwan picks upgrade to the v5 endpoint, same family only).
  if (userModelPick && userModelPick !== 'auto') {
    return isLocalOllamaBlackSwan(userModelPick) ? 'legacy_blackswan_normalized' : 'explicit_pick';
  }
  // 2/3. Build phases (checked before intent, exactly like the ladder).
  if (buildExploring) return 'build_exploring';
  if (buildConverging) return 'build_converging';
  if (intent) {
    const isHeavy = complexity === 'complex';
    // 4. P8 BlackSwan lanes — only when the integration is connected.
    //    Mirrors resolveModelForSoul's reliability guard branch-for-branch:
    //    when the SAME grounded lane carries a hard-for-a-small-model signal
    //    the resolver falls through to the frontier fallback, so here we name
    //    the escalation ('blackswan_escalated_to_frontier'). The model id is
    //    delegated to resolveModelForSoul (never re-derived), so the id still
    //    equals the frontier fallback even though the reason names the escape.
    if (hasProvider(connectedProviders, 'blackswan')) {
      const escalation = message
        ? shouldEscalateBlackSwanToFrontier(message)
        : { escalate: false, reason: null };
      if (!escalation.escalate) {
        if (intent === 'status' || intent === 'memory' || intent === 'casual' || intent === 'social') {
          return 'blackswan_app_lane';
        }
        if (intent === 'question' && !isHeavy && opts?.appGroundedHint) {
          return 'blackswan_app_question';
        }
      } else if (
        intent === 'status' || intent === 'memory' || intent === 'casual' || intent === 'social'
        || (intent === 'question' && !isHeavy && opts?.appGroundedHint)
      ) {
        // Only name the escalation for turns that WOULD have been BlackSwan's;
        // other intents were never BlackSwan and keep their own lane below.
        return 'blackswan_escalated_to_frontier';
      }
    }
    // 5+. Intent branches, ladder order.
    if (intent === 'casual' || intent === 'social' || intent === 'status' || intent === 'memory') {
      return 'casual_lane';
    }
    if (intent === 'question') return isHeavy ? 'question_heavy' : 'question_light';
    if (intent === 'research') return 'research_lane';
    if (intent === 'architect') return 'architect_lane';
    if (intent === 'build' || intent === 'debug' || intent === 'review') return 'coding_lane';
    if (intent === 'design' || intent === 'creative') return 'design_lane';
    if (intent === 'browser') return 'browser_lane';
    if (intent === 'task_mgmt' || intent === 'support') return 'task_support_lane';
  }
  // Final fallback — unknown intent / empty input.
  return 'soul_default';
}

/**
 * Explain the Auto model choice for display ("BlackSwan — app-domain
 * question"). Takes the exact resolveModelForSoul argument list; the model
 * id is delegated to resolveModelForSoul (never re-derived), so the
 * explanation can never disagree with what actually runs.
 */
export function explainAutoModelChoice(
  spiritId: string | null | undefined,
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  buildConverging?: boolean,
  buildExploring?: boolean,
  connectedProviders?: ConnectedProviderSet,
  opts?: { appGroundedHint?: boolean },
  message?: string | null,
): AutoModelChoiceExplanation {
  const model = resolveModelForSoul(
    spiritId,
    userModelPick,
    intent,
    complexity,
    buildConverging,
    buildExploring,
    connectedProviders,
    opts,
    message,
  );
  const reasonKind = classifyAutoModelReasonKind(
    userModelPick,
    intent,
    complexity,
    buildConverging,
    buildExploring,
    connectedProviders,
    opts,
    message,
  );
  return { model, reasonKind, reason: reasonTextForAutoChoice(reasonKind, intent, complexity, message) };
}

// BlackSwan failover chain: if primary model fails (rate limit,
// billing, auth), automatically try the next model in the chain.
const MODEL_FAILOVER: Record<string, string[]> = {
  [BLACKSWAN_ENDPOINT_MODEL_ID]:     ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  [BLACKSWAN_PUBLIC_MODEL_ID]:       ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  'claude-sonnet-4-6':          ['claude-haiku-4-5-20251001', 'gemini-2.5-flash'],
  'claude-fable-5':             ['claude-opus-4-8', 'claude-sonnet-4-6'],
  'claude-opus-4-8':            ['claude-opus-4-7', 'claude-sonnet-4-6'],
  'claude-opus-4-7':            ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-opus-4-6':            ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'gpt-5.5-pro':                ['gpt-5.5', 'gpt-5.4', 'claude-sonnet-4-6'],
  'gpt-5.5':                    ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4-6'],
  'gpt-5.4':                    ['gpt-5.4-mini', 'gpt-4.1', 'claude-sonnet-4-6'],
  'gpt-5.4-mini':               ['gpt-4.1', 'gemini-3.1-flash-lite'],
  'claude-haiku-4-5-20251001':  ['gemini-2.5-flash'],
  'gemini-3.5-flash':           ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'gemini-3.1-pro-preview':     ['gemini-2.5-pro', 'claude-sonnet-4-6'],
  'gemini-3.1-flash-lite':      ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  'gemini-2.5-pro':             ['claude-haiku-4-5-20251001'],
  'gemini-2.5-flash':           ['claude-haiku-4-5-20251001'],
  'sonar-deep-research':        ['sonar-reasoning-pro', 'sonar-pro'],
  'sonar-reasoning-pro':        ['sonar-pro', 'sonar'],
};

export function getModelFailoverChain(model: string): string[] {
  return MODEL_FAILOVER[model] || [DEFAULT_MODEL];
}
