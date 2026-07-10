import type { MessageComplexity, MessageIntent } from './agenticCodingProfile';
import type { PromptMemoryReference } from './memoryService';

export const BLACKSWAN_MODEL_ID = 'cswan801/BlackSwan-v5';
export const BLACKSWAN_PUBLIC_MODEL_ID = `huggingface/${BLACKSWAN_MODEL_ID}`;
export const BLACKSWAN_ENDPOINT_MODEL_ID = `huggingface_endpoint/${BLACKSWAN_MODEL_ID}`;
export const BLACKSWAN_TOOL_EXECUTOR_MODEL_ID = 'claude-haiku-4-5';

/**
 * Canonical set of every model id that means "BlackSwan" across the app.
 * Centralizing these here means a future app-trained checkpoint only has to
 * be registered in one place (add its id + classify it as local/hosted) and
 * every BlackSwan-aware code path picks it up.
 *
 * Two distinct routing classes live behind the BlackSwan brand:
 *   - LOCAL: the on-device Ollama `blackswan` weight (runs through the local
 *     `blackswanLLM` bridge, only available on native/desktop).
 *   - HOSTED: the HuggingFace public model + dedicated inference endpoint
 *     (`cswan801/BlackSwan-v5`), which must NOT take the local-Ollama path.
 */
export const BLACKSWAN_LOCAL_OLLAMA_MODEL_IDS = new Set<string>([
  'blackswan',
  'ollama/blackswan',
]);

export const BLACKSWAN_HOSTED_MODEL_IDS = new Set<string>([
  BLACKSWAN_MODEL_ID.toLowerCase(),
  BLACKSWAN_PUBLIC_MODEL_ID.toLowerCase(),
  BLACKSWAN_ENDPOINT_MODEL_ID.toLowerCase(),
]);

/** Every known BlackSwan id (local + hosted), for callers that just need
 *  "is this BlackSwan in any form?" membership without re-deriving it. */
export const BLACKSWAN_MODEL_IDS: ReadonlySet<string> = new Set<string>([
  ...BLACKSWAN_LOCAL_OLLAMA_MODEL_IDS,
  ...BLACKSWAN_HOSTED_MODEL_IDS,
]);

const MARKETPLACE_PREFIX_RE = /^(openai|openai_compatible|openrouter|huggingface|huggingface_endpoint|replicate|github-models|groq|google_ai|mistral_ai|cohere|perplexity|together_ai|fireworks_ai|deepseek|zai|z_ai|minimax|ollama)\//i;

/**
 * True only for the LOCAL Ollama BlackSwan weight. Use this to gate the
 * local `blackswanLLM` bridge path so the HOSTED HuggingFace endpoint id
 * stops being misrouted through on-device Ollama.
 */
export function isLocalOllamaBlackSwan(modelId: string | null | undefined): boolean {
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  if (BLACKSWAN_LOCAL_OLLAMA_MODEL_IDS.has(normalized)) return true;
  // A bare `ollama/<...>blackswan...>` weight is also local, but never treat a
  // huggingface(_endpoint)/ id as local even though it contains "blackswan".
  if (normalized.startsWith('huggingface/') || normalized.startsWith('huggingface_endpoint/')) {
    return false;
  }
  return normalized.startsWith('ollama/') && normalized.includes('blackswan');
}

/**
 * True for the HOSTED BlackSwan model: the HuggingFace public model, the
 * dedicated inference endpoint, or the bare `cswan801/BlackSwan-v5` repo id.
 */
export function isHostedBlackSwanModel(modelId: string | null | undefined): boolean {
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  if (BLACKSWAN_HOSTED_MODEL_IDS.has(normalized)) return true;
  if (normalized.startsWith('huggingface/') || normalized.startsWith('huggingface_endpoint/')) {
    return normalized.includes('blackswan');
  }
  // Bare repo form, e.g. `cswan801/blackswan-v5` (no provider prefix).
  return normalized.includes('cswan801/blackswan');
}

export function isBlackSwanModel(modelId: string | null | undefined): boolean {
  if (isLocalOllamaBlackSwan(modelId) || isHostedBlackSwanModel(modelId)) return true;
  // Backward-compat: the original greedy matcher treated any `*/blackswan*`
  // or `*cswan801/blackswan*` id as BlackSwan. Preserve that so existing
  // callers of this union predicate never lose a match after the split.
  const normalized = (modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes('/blackswan') || normalized.includes('cswan801/blackswan');
}

export function isMarketplaceRoutedModel(modelId: string | null | undefined): boolean {
  return MARKETPLACE_PREFIX_RE.test((modelId || '').trim());
}

export function isNativeAnthropicModel(modelId: string | null | undefined): boolean {
  return /^claude-/i.test((modelId || '').trim());
}

export function canUseAnthropicChatStream(modelId: string | null | undefined): boolean {
  return isNativeAnthropicModel(modelId) && !isMarketplaceRoutedModel(modelId);
}

/**
 * App-domain vocabulary detector for the Auto router (P8). BlackSwan-v5 is
 * trained on Underground Circle app data (conversations, missions,
 * check-ins, proof-of-work, XP/streaks, office agents) — for questions
 * ABOUT that domain it is the best-grounded model available; for general
 * knowledge it is not. High-precision term list on purpose: a false
 * negative just keeps the turn on a frontier model, a false positive
 * routes a general question to an app specialist — so only unambiguous
 * app vocabulary counts.
 */
const APP_GROUNDED_TERM_RE = new RegExp(
  [
    '\\bcircle members?\\b', '\\bmy circle\\b', '\\bour circle\\b',
    '\\bmissions?\\b', '\\bcheck-?ins?\\b', '\\bstreaks?\\b',
    '\\bproof of work\\b', '\\bnorth star\\b', '\\bmemory bank\\b',
    '\\bswan\\s?bot\\b', '\\bblack\\s?swan\\b', '\\bopen\\s?swan\\b',
    '\\boffice agents?\\b', '\\bxp\\b', '\\bshout-?outs?\\b',
    '\\bthe feed\\b', '\\bproof-of-work\\b',
  ].join('|'),
  'i',
);

/** True when a message reads as a question/statement about THIS app's domain. */
export function looksLikeAppGroundedMessage(message: string | null | undefined): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  return APP_GROUNDED_TERM_RE.test(text);
}

/**
 * Confidence proxy for the BlackSwan Auto lane (reliability guard).
 *
 * BlackSwan-v5 is a small fine-tuned model (Qwen3.5-4B). The published
 * small-model research is consistent: tiny models discriminate poorly on
 * HARD / BROAD / AMBIGUOUS inputs, and a wrong answer reads to the user as
 * "the model got dumber." This guard does NOT remove BlackSwan from Auto —
 * BlackSwan still owns every simple app-grounded turn it was trained for
 * (status / memory / casual / social + light `looksLikeAppGroundedMessage`
 * questions). It only ESCALATES the genuinely-hard SUBSET of that same lane
 * to the frontier model the lane would otherwise have used — a proxy for
 * "this turn is beyond a 4B model's reliable discrimination," never a
 * BlackSwan removal and never a route to any other BlackSwan id.
 *
 * Deliberately CONSERVATIVE: the whole point of the lane is BlackSwan, so we
 * bias toward KEEPING it. Escalate only on clear hard-for-a-small-model
 * signals; a false negative just leaves an easy turn on BlackSwan (fine),
 * while a false positive needlessly spends a frontier call, so the bar is
 * "unambiguous hard signal," mirroring the high-precision app-domain matcher.
 *
 * Hard signals (any one fires):
 *   1. Multi-step / sequenced work — "then", "after that", numbered lists,
 *      "step 1", bulleted sequences. Ordering + chaining is where small
 *      models drop or reorder steps.
 *   2. Explicit tool/action/execution verbs — "deploy", "run", "open",
 *      "book", "install", "refactor", etc. These imply DOING, not the Q&A
 *      recall BlackSwan is trained for. (The provider strip + tool-loop
 *      executor swap already handle true tool turns; this catches
 *      action-shaped phrasing that still lands in the conversational lane.)
 *   3. Code / technical reasoning — "debug", "why does", "explain the
 *      difference", "trade-offs", "architecture", "root cause", stack
 *      traces, code fences. Comparative / causal reasoning is exactly the
 *      hard-discrimination case for a 4B model.
 *   4. Long / compound messages — > ~400 chars OR > ~2 question marks.
 *      Length and multi-question compounds broaden the input past the small
 *      model's reliable band.
 *   5. Explicit ambiguity the small model would fumble — "not sure",
 *      "either ... or", "it depends", "figure out", "what's the best way".
 */
const BLACKSWAN_ESCALATION_SIGNALS: Array<{ reason: string; test: (text: string, lower: string) => boolean }> = [
  {
    reason: 'multi_step',
    // Sequencing words as whole words, or a numbered/bulleted list of steps.
    test: (_text, lower) =>
      /\b(?:then|and then|after that|afterwards?|next,|followed by|first\b.*\bthen|step\s*\d)\b/i.test(lower)
      // Two+ numbered items ("1. ... 2. ...") or two+ bullet lines.
      || /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+.*(?:\n\s*(?:[-*•]|\d+[.)])\s+)/.test(_text),
  },
  {
    reason: 'action_verb',
    // Execution verbs that imply DOING, not recall/Q&A. Whole-word matched so
    // "running total" / "opened issues" don't trip it; paired with word
    // boundaries and common object nouns to keep precision high.
    test: (_text, lower) =>
      /\b(?:deploy|redeploy|install|uninstall|configure|set\s?up|refactor|rebuild|migrate|provision|book|purchase|order|schedule|automate|execute|run\s+(?:the|a|this|that|my)|open\s+(?:the|a|this|that|my)|create\s+(?:a|the|an)|delete|remove|update\s+(?:the|my|a)|send\s+(?:a|the|an)|push\s+(?:the|a|to)|merge\s+(?:the|a|this)|fix\s+(?:the|this|my|a))\b/i.test(lower),
  },
  {
    reason: 'technical_reasoning',
    test: (_text, lower) =>
      /\b(?:debug|root\s?cause|stack\s?trace|traceback|exception|why\s+(?:does|is|isn'?t|are|aren'?t|do|did|can'?t|won'?t)|explain\s+(?:the\s+)?(?:difference|why|how)|difference\s+between|trade[\s-]?offs?|architecture|design\s+pattern|time\s+complexity|big\s?-?o|race\s+condition|memory\s+leak|refactor)\b/i.test(lower)
      // Fenced code / inline code blocks are a strong technical-reasoning tell.
      || /```/.test(_text),
  },
  {
    reason: 'ambiguous',
    test: (_text, lower) =>
      /\b(?:not\s+sure|i'?m\s+not\s+sure|unsure|it\s+depends|depends\s+on|figure\s+out|what'?s\s+the\s+best\s+way|which\s+(?:is\s+)?(?:better|best)|either\b.*\bor\b|should\s+i\s+.*\bor\b|help\s+me\s+(?:decide|choose|figure))\b/i.test(lower),
  },
];

const BLACKSWAN_LONG_MESSAGE_CHARS = 400;
const BLACKSWAN_MAX_QUESTION_MARKS = 2;

export type BlackSwanEscalationReason =
  | 'multi_step'
  | 'action_verb'
  | 'technical_reasoning'
  | 'long_compound'
  | 'ambiguous';

/**
 * Decide whether an app-grounded Auto turn should ESCALATE from BlackSwan to
 * the lane's frontier fallback. Pure + dependency-light (string only) so it
 * stays smoke-testable. Conservative by design — see the signal set above.
 *
 * Returns `escalate: false, reason: null` for the simple grounded turns
 * BlackSwan is designed for; `escalate: true` with the first matching reason
 * for the genuinely-hard subset.
 */
export function shouldEscalateBlackSwanToFrontier(
  message: string | null | undefined,
): { escalate: boolean; reason: BlackSwanEscalationReason | null } {
  const text = String(message || '').trim();
  // Empty / whitespace: nothing hard to detect — keep BlackSwan.
  if (!text) return { escalate: false, reason: null };
  const lower = text.toLowerCase();

  // Long / compound is a first-class signal (length + multi-question).
  const questionMarks = (text.match(/\?/g) || []).length;
  if (text.length > BLACKSWAN_LONG_MESSAGE_CHARS || questionMarks > BLACKSWAN_MAX_QUESTION_MARKS) {
    return { escalate: true, reason: 'long_compound' };
  }

  for (const signal of BLACKSWAN_ESCALATION_SIGNALS) {
    if (signal.test(text, lower)) {
      return { escalate: true, reason: signal.reason as BlackSwanEscalationReason };
    }
  }

  return { escalate: false, reason: null };
}

/**
 * Human-facing, ≤60-char clause naming WHY the BlackSwan lane escalated to a
 * frontier model. Companion to `shouldEscalateBlackSwanToFrontier`; used by
 * the Auto transparency layer so users see "hard turn → frontier fallback",
 * never a raw reason key. No provider ids, no jargon.
 */
export function describeBlackSwanEscalation(
  reason: BlackSwanEscalationReason | null | undefined,
): string {
  switch (reason) {
    case 'multi_step':
      return 'multi-step request → frontier fallback';
    case 'action_verb':
      return 'action request → frontier fallback';
    case 'technical_reasoning':
      return 'technical reasoning → frontier fallback';
    case 'long_compound':
      return 'long/compound request → frontier fallback';
    case 'ambiguous':
      return 'ambiguous request → frontier fallback';
    default:
      return 'app-domain turn → app-trained BlackSwan';
  }
}

/**
 * Composer-pattern plan/execute split for computer tasks (P9, from the
 * verified Cursor research: "create the plan with one model and build it
 * with another" — Cursor 2.0 Plan Mode; the browser loop itself stays a
 * separate tool-scoped agent). The TEXT-ONLY planner/validator pass for
 * browser/app automation is exactly where the app-trained model wins: it
 * knows the app's sites, pipelines, missions, and vocabulary. The native
 * screenshot/action loop is untouched — the edge function keeps its
 * Sonnet pin regardless of what plans.
 *
 * Returns the BlackSwan endpoint id ONLY for Auto turns when the
 * `blackswan` integration is connected; explicit picks return null so the
 * caller's model is used for planning too (explicit picks stay
 * authoritative everywhere).
 */
export function resolveComputerTaskPlannerModel(
  selectedModel: string | null | undefined,
  connectedProviders?: ReadonlySet<string> | null,
): string | null {
  const selected = String(selectedModel || '').trim();
  if (selected && selected !== 'auto') return null;
  if (!connectedProviders || !connectedProviders.has('blackswan')) return null;
  return BLACKSWAN_ENDPOINT_MODEL_ID;
}

export function externalProviderForModel(modelId: string | null | undefined): string | null {
  const model = (modelId || '').trim();
  if (!model || model === 'auto' || model === 'blackswan') return null;
  if (isNativeAnthropicModel(model)) return 'anthropic';
  const slashIdx = model.indexOf('/');
  if (slashIdx > 0) {
    const head = model.slice(0, slashIdx);
    if (head === 'huggingface_endpoint' || head === 'huggingface') return 'huggingface';
    if (head === 'z_ai') return 'zai';
    return head;
  }
  if (/^(gpt-|o\d|codex)/i.test(model)) return 'openai';
  if (/^(gemini|google)/i.test(model)) return 'google_ai';
  if (/^glm-/i.test(model)) return 'zai';
  if (/^minimax/i.test(model)) return 'minimax';
  return 'anthropic';
}

export function shouldUseBlackSwanForAuto(
  intent?: MessageIntent | null,
  complexity?: MessageComplexity | null,
): boolean {
  const level = complexity || 'simple';
  const isLight = level === 'trivial' || level === 'simple';
  const taskIntent = intent || 'question';

  if (taskIntent === 'casual' || taskIntent === 'social' || taskIntent === 'status' || taskIntent === 'memory') {
    return true;
  }

  if (taskIntent === 'question') return isLight;
  if (taskIntent === 'support' || taskIntent === 'task_mgmt') return isLight;

  // Tool-heavy and high-reasoning work should stay on frontier models; BlackSwan
  // can still be injected as context, but should not drive the execution loop.
  return false;
}

export function shouldUseToolExecutorInsteadOfBlackSwan(
  modelId: string | null | undefined,
  runtimeToolNames?: string[] | null,
): boolean {
  return isBlackSwanModel(modelId) && !!runtimeToolNames?.length;
}

export function resolveOpenSwanToolLoopModel(
  modelId: string | null | undefined,
  runtimeToolNames?: string[] | null,
): string {
  if (shouldUseToolExecutorInsteadOfBlackSwan(modelId, runtimeToolNames)) {
    return BLACKSWAN_TOOL_EXECUTOR_MODEL_ID;
  }
  return modelId || BLACKSWAN_TOOL_EXECUTOR_MODEL_ID;
}

export function buildBlackSwanRoutingMetadata(opts: {
  selectedModel?: string | null;
  resolvedModel?: string | null;
  toolLoopModel?: string | null;
  runtimeToolNames?: string[] | null;
}) {
  const blackSwanRequested = isBlackSwanModel(opts.selectedModel) || isBlackSwanModel(opts.resolvedModel);
  const toolExecutorUsed = blackSwanRequested
    && !!opts.runtimeToolNames?.length
    && !!opts.toolLoopModel
    && !isBlackSwanModel(opts.toolLoopModel);

  return {
    selectedModel: opts.selectedModel || null,
    resolvedModel: opts.resolvedModel || null,
    toolLoopModel: opts.toolLoopModel || null,
    blackSwanRequested,
    blackSwanRole: blackSwanRequested
      ? (toolExecutorUsed ? 'grounding_context' : 'primary_model')
      : 'not_used',
    toolExecutorUsed,
    toolExecutorReason: toolExecutorUsed
      ? 'OpenSwan runtime tools require a model with reliable native tool/function calling; BlackSwan remains in the grounding context.'
      : null,
  };
}

export function buildBlackSwanGroundingBlock(opts: {
  model?: string | null;
  intent?: MessageIntent | string | null;
  complexity?: MessageComplexity | string | null;
  memoryReferences?: PromptMemoryReference[] | null;
  source?: 'main_chat' | 'openswan' | 'office' | 'room_chat' | 'task_run';
}): string {
  const refs = (opts.memoryReferences || [])
    .filter((ref) => ref?.title)
    .slice(0, 8);
  const usingBlackSwan = isBlackSwanModel(opts.model);
  const shouldGround = usingBlackSwan || refs.length > 0 || opts.intent === 'status' || opts.intent === 'memory';
  if (!shouldGround) return '';

  const lines = [
    '## BlackSwan App-Grounding Contract',
    `Runtime route: ${opts.model || 'auto'}${usingBlackSwan ? ' (BlackSwan)' : ''}. Surface: ${opts.source || 'main_chat'}.`,
    'Use Underground Circle app data, memory references, mission state, and tool outputs as the highest-priority facts.',
    'Do not invent app state. If a fact is not present in context or tool output, say what is missing or ask to look it up.',
    'Never expose secrets, API keys, vault values, or integration tokens. Mention only connection status and safe metadata.',
  ];

  if (refs.length > 0) {
    lines.push('Memory/source references available this turn:');
    for (const ref of refs) {
      const score = typeof ref.score === 'number' ? ` score=${ref.score.toFixed(2)}` : '';
      const confidence = typeof ref.confidence === 'number' ? ` confidence=${ref.confidence.toFixed(2)}` : '';
      lines.push(`- ${ref.title} [${ref.memoryKind || 'memory'} · ${ref.scope || 'scope'}${score}${confidence}]`);
    }
  }

  return lines.join('\n');
}
