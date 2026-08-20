/**
 * Pure pre-dispatch model fallback selection for ordinary hosted Chat turns.
 *
 * The shared account catalog remains the only readiness authority. This core
 * may select a different model before provider I/O, but it never retries a
 * request, mutates the saved picker selection, or treats a disconnected or
 * unlisted catalog row as runnable.
 */
import {
  MODEL_ALIASES,
  resolvePlainChatModelRoute,
  type ProviderModelAliases,
} from './crossProviderRouter';
import {
  resolveModelRouteIdentity,
  resolveModelSelectionReadiness,
  type ModelSelectionCatalogGroup,
  type ModelSelectionReadiness,
  type ModelSelectionReadinessState,
} from './modelCatalogReadinessCore';
import { getModelCapabilityFlags } from './modelCapabilities';
import { MAX_INTENT_INPUT_CHARS, resolveLeadingChatActionVerb } from './chatMultiIntentCore';

export interface ReadyChatModelTurnSelection {
  modelId: string;
  provider: string | null;
  selectedCatalogStatus: ModelSelectionReadiness['catalogStatus'];
  fallbackFromModelId: string | null;
  requestedReadiness: ModelSelectionReadinessState;
  source: 'requested' | 'equivalent_ready' | 'preferred_ready' | 'baseline_ready' | 'catalog_ready';
}

export interface ReadyChatModelTurnInput {
  requestedModelId: string;
  groups: readonly ModelSelectionCatalogGroup[];
  /** Task-aware Auto candidates are considered before safe baselines. */
  preferredModelIds?: readonly (string | null | undefined)[];
  /** Excludes a runtime family that is inappropriate for this exact turn. */
  excludedGroupProviders?: readonly string[];
  /** Excludes an exact execution identity even if another group advertises it. */
  excludedModelIds?: readonly string[];
  /** Multi-action/OpenSwan turns must select an executor that can call tools. */
  requireToolUse?: boolean;
}

export type ProviderFreeChatTurnReason =
  | 'ui_sentinel'
  | 'command_help'
  | 'local_plan'
  | 'local_settings'
  | 'local_data_command';

export interface ProviderFreeChatTurnInput {
  content: string;
  /** The caller already ran the canonical plan classifier for this turn. */
  isPlanDraftTurn?: boolean;
  /** The caller already recognized its local transcript/model audit question. */
  isLocalAuditTurn?: boolean;
  /** Canonical local matcher; caller must separately exclude compound turns. */
  isLocalSwanBotCommandTurn?: boolean;
  /** The caller's canonical automation parser produced a review-only proposal. */
  isAutomationProposalTurn?: boolean;
}

export interface ChatModelDispatchIdentity {
  model: string;
  catalogGeneration: number;
}

export const CHAT_MODEL_CATALOG_LOAD_TIMEOUT_MS = 8_000;
export const CHAT_TRANSIENT_PROVIDER_COOLDOWN_MS = 60_000;

const PROVIDER_FREE_COMPOUND_COMMAND_HEAD_RE =
  /^(?:\/?(research|wiki|poll|propose|search|schedule|remember|forget|trace|context|watch|mission|room|vault|cron|screen|apps|desktop|v2|v2loop|memory-bank|mb|record|replay|automation|automations|integrations?)|search[^\S\r\n]+(research|wiki))(?=[^\S\r\n]+\S)/i;
const PROVIDER_FREE_STRONG_CONTINUATION_RE =
  /([;,&]|[.!?](?=\s|$)|[\r\n]+|\b(?:and\s+then|then|also|plus|afterwards?|next|followed\s+by|along\s+with|separately)\b)[\s,:;.!?-]*/gi;
const PROVIDER_FREE_SIMPLE_AND_RE = /\band\b[\s,:;.!?-]*/gi;
const PROVIDER_FREE_KNOWN_OPEN_TARGETS = new Set([
  'app', 'application', 'browser', 'calendar', 'chrome', 'excel', 'figma',
  'finder', 'firefox', 'illustrator', 'indesign', 'mail', 'notes', 'notion',
  'photoshop', 'powerpoint', 'safari', 'settings', 'slack', 'terminal', 'word',
]);
const PROVIDER_FREE_KNOWN_ACTION_TARGETS = new Set([
  'app', 'application', 'automation', 'branch', 'build', 'code', 'dashboard',
  'database', 'deployment', 'design', 'document', 'email', 'file', 'folder',
  'image', 'issue', 'message', 'page', 'photo', 'post', 'pr', 'project',
  'proposal', 'pull-request', 'repo', 'repository', 'roadmap', 'server', 'service',
  'sheet', 'spreadsheet', 'table', 'task', 'test', 'ticket', 'website', 'workflow',
  'credential', 'memory',
]);
const PROVIDER_FREE_ALWAYS_EXTERNAL_VERBS = new Set([
  'approve', 'authorize', 'book', 'buy', 'call', 'charge', 'checkout', 'clear',
  'click', 'commit', 'connect', 'delete', 'disconnect', 'dm', 'download',
  'email', 'erase', 'grant', 'install', 'invite', 'kill', 'log', 'login',
  'merge', 'message', 'notify', 'order', 'pay', 'post', 'publish', 'purchase',
  'push', 'rebase', 'remove', 'revoke', 'rotate', 'send', 'share', 'submit',
  'text', 'uninstall', 'upload', 'wipe',
]);

function isHighConfidenceActionTarget(rawTarget: string, knownTargets: ReadonlySet<string>): boolean {
  if (!rawTarget) return false;
  const normalizedTarget = rawTarget.toLowerCase();
  return knownTargets.has(normalizedTarget)
    || /^(?:https?:\/\/|\/|~\/|[a-z]:\\)/i.test(rawTarget)
    || /^[A-Z0-9][A-Za-z0-9+._-]*$/.test(rawTarget);
}

function hasHighConfidenceActionObject(
  rawPhrase: string,
  knownTargets: ReadonlySet<string> = PROVIDER_FREE_KNOWN_ACTION_TARGETS,
): boolean {
  const rawTokens = rawPhrase.match(/[A-Za-z0-9+._~:\\/-]+/g)?.slice(0, 4) || [];
  for (const rawToken of rawTokens) {
    const normalized = rawToken.toLowerCase();
    const singular = normalized.endsWith('ies')
      ? `${normalized.slice(0, -3)}y`
      : normalized.endsWith('s') && normalized.length > 3
        ? normalized.slice(0, -1)
        : normalized;
    if (knownTargets.has(normalized) || knownTargets.has(singular)) return true;
    if (/^(?:https?:\/\/|\/|~\/|[a-z]:\\)/i.test(rawToken)) return true;
    if (/^[A-Z0-9][A-Za-z0-9+._-]*$/.test(rawToken)) return true;
  }
  return false;
}

function normalizedContinuationTail(value: string): string {
  return value
    .replace(/^[\s,:;.!?-]+/, '')
    .replace(/^(?:(?:right\s+now|separately)\b[\s,:;.!?-]*)+/i, '')
    .trim();
}

function structuredPayloadStartsWithAction(value: string): boolean {
  const simpleAndIndex = value.search(/\band\b/i);
  const prefix = (simpleAndIndex >= 0 ? value.slice(0, simpleAndIndex) : value)
    .trim()
    .replace(/^(?:(?:we|i|the\s+team|team)\s+(?:will|should|can|could|would)\s+)/i, '')
    .replace(/^(?:(?:goal|plan|objective)\s+is\s+to\s+)/i, '')
    .replace(/^(?:(?:today|tomorrow|this\s+week|next\s+week)\s+)/i, '')
    .trim();
  return Boolean(prefix && resolveLeadingChatActionVerb(prefix));
}

function highConfidenceSimpleContinuation(value: string): boolean {
  const tail = normalizedContinuationTail(value);
  const verb = resolveLeadingChatActionVerb(tail);
  if (!verb) return false;
  if (PROVIDER_FREE_ALWAYS_EXTERNAL_VERBS.has(verb)) return true;
  const verbIndex = tail.toLowerCase().search(new RegExp(`\\b${verb}\\b`, 'i'));
  if (verbIndex < 0) return false;
  const targetPhrase = tail.slice(verbIndex + verb.length).trim();
  if (verb === 'open' || verb === 'launch') {
    return hasHighConfidenceActionObject(targetPhrase, PROVIDER_FREE_KNOWN_OPEN_TARGETS);
  }
  return hasHighConfidenceActionObject(targetPhrase);
}

function hasExternalActionContinuation(
  value: string,
  options: {
    allowCommaBoundary: boolean;
    suppressSimpleAnd: boolean;
    suppressSimpleAndWhenActionLed: boolean;
  },
): boolean {
  const strongRe = new RegExp(PROVIDER_FREE_STRONG_CONTINUATION_RE.source, 'gi');
  for (const match of value.matchAll(strongRe)) {
    if (!options.allowCommaBoundary && match[1] === ',') continue;
    const tail = normalizedContinuationTail(value.slice((match.index || 0) + match[0].length));
    if (resolveLeadingChatActionVerb(tail)) return true;
  }

  if (options.suppressSimpleAnd) return false;
  if (options.suppressSimpleAndWhenActionLed && structuredPayloadStartsWithAction(value)) return false;
  const simpleAndRe = new RegExp(PROVIDER_FREE_SIMPLE_AND_RE.source, 'gi');
  for (const match of value.matchAll(simpleAndRe)) {
    const tail = value.slice((match.index || 0) + match[0].length);
    if (highConfidenceSimpleContinuation(tail)) return true;
  }
  return false;
}

/**
 * Shared continuation guard for caller-recognized local commands and local
 * automation proposals. Strong sequence connectors use the canonical action
 * vocabulary; a plain "and" additionally requires a high-confidence external
 * verb/target so ordinary prose is not promoted accidentally.
 */
export function hasIndependentChatActionContinuation(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  const candidate = input.trim();
  if (!candidate) return false;
  if (candidate.length > MAX_INTENT_INPUT_CHARS) return true;
  const isCapabilityQuestion = /^(?:can|could|would)\s+you\s+use\b/i.test(candidate);
  return hasExternalActionContinuation(candidate, {
    allowCommaBoundary: true,
    suppressSimpleAnd: false,
    suppressSimpleAndWhenActionLed: isCapabilityQuestion,
  });
}

/**
 * Bound the complete connected-model catalog read, not only each provider's
 * list-models request. Supabase key/integration reads can also stall; Chat must
 * return control to the composer instead of leaving Send locked indefinitely.
 * The caller's generation fence owns any late completion from `load`.
 */
export async function loadChatModelCatalogWithinDeadline<T>(
  load: () => Promise<T>,
  timeoutMs = CHAT_MODEL_CATALOG_LOAD_TIMEOUT_MS,
): Promise<T> {
  const requestedTimeout = Number(timeoutMs);
  const boundedTimeout = Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(30_000, Math.floor(requestedTimeout)))
    : CHAT_MODEL_CATALOG_LOAD_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      load(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Connected model verification timed out.')),
          boundedTimeout,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Return only currently active provider exclusions; callers may prune the rest. */
export function collectActiveChatProviderQuarantines(
  quarantine: ReadonlyMap<string, number>,
  nowMs = Date.now(),
): Set<string> {
  const active = new Set<string>();
  for (const [provider, expiresAt] of quarantine) {
    if (provider && (expiresAt === Number.POSITIVE_INFINITY || expiresAt > nowMs)) {
      active.add(provider);
    }
  }
  return active;
}

export function sameChatModelDispatchIdentity(
  left: ChatModelDispatchIdentity,
  right: ChatModelDispatchIdentity,
): boolean {
  return left.model === right.model
    && left.catalogGeneration === right.catalogGeneration;
}

/**
 * Build model-dependent prompt/context only against a stable catalog
 * generation. A generation/model change during an await discards that build
 * and retries from the newest capture. Null is a bounded fail-closed result.
 */
export async function prepareStableChatModelDispatch<
  TSnapshot extends ChatModelDispatchIdentity,
  TPrepared,
>(input: {
  capture: () => TSnapshot | null;
  prepare: (model: string) => Promise<TPrepared>;
  maxAttempts?: number;
}): Promise<Readonly<{ snapshot: TSnapshot; prepared: TPrepared }> | null> {
  const requestedAttempts = Number(input.maxAttempts ?? 3);
  const maxAttempts = Number.isFinite(requestedAttempts)
    ? Math.max(1, Math.min(5, Math.floor(requestedAttempts)))
    : 3;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = input.capture();
    if (!before) return null;
    const prepared = await input.prepare(before.model);
    const after = input.capture();
    if (after && sameChatModelDispatchIdentity(before, after)) {
      return Object.freeze({ snapshot: after, prepared });
    }
  }
  return null;
}

/**
 * Detect a compound hidden behind a provider-free command head that the
 * general segmenter does not treat as an imperative. It recognizes only a
 * high-confidence independent external-action tail, and respects the poll
 * question / proposal description boundaries so ordinary prose such as
 * "build and launch?" or "design and build" stays locally usable. The original
 * turn remains byte-for-byte intact for catalog/OpenSwan ownership. Oversized
 * command turns fail closed because their unscanned tail could contain an ask.
 */
export function hasProviderFreeChatCompoundIntent(input: unknown): boolean {
  try {
    if (typeof input !== 'string') return false;
    const candidate = input.trim();
    if (!candidate) return false;
    const head = candidate.match(PROVIDER_FREE_COMPOUND_COMMAND_HEAD_RE);
    if (!head) return false;
    if (candidate.length > MAX_INTENT_INPUT_CHARS) return true;

    const command = String(head[1] || head[2] || '').toLowerCase();
    const payload = candidate.slice(head[0].length).trim();
    if (!payload) return false;

    if (command === 'poll') {
      const quotedParts = payload.match(/"[^"]*"/g) || [];
      if (quotedParts.length >= 3) {
        const lastQuote = payload.lastIndexOf('"');
        return hasExternalActionContinuation(payload.slice(lastQuote + 1), {
          allowCommaBoundary: true,
          suppressSimpleAnd: false,
          suppressSimpleAndWhenActionLed: false,
        });
      }
      const questionBoundary = payload.indexOf('?');
      return hasExternalActionContinuation(
        questionBoundary >= 0 ? payload.slice(questionBoundary + 1) : payload,
        { allowCommaBoundary: false, suppressSimpleAnd: false, suppressSimpleAndWhenActionLed: true },
      );
    }

    if (command === 'propose') {
      const descriptionBoundary = payload.indexOf('|');
      return hasExternalActionContinuation(
        descriptionBoundary >= 0 ? payload.slice(descriptionBoundary + 1) : payload,
        { allowCommaBoundary: false, suppressSimpleAnd: false, suppressSimpleAndWhenActionLed: true },
      );
    }

    return hasExternalActionContinuation(payload, {
      allowCommaBoundary: true,
      suppressSimpleAnd: false,
      suppressSimpleAndWhenActionLed: false,
    });
  } catch {
    return false;
  }
}

/**
 * Poll options and proposal descriptions may contain ordinary action verbs.
 * Their command grammar owns those words unless the bounded compound detector
 * found a separate external-action tail after the `?` / `|` boundary.
 */
export function isProviderFreeStructuredSingleIntent(input: unknown): boolean {
  if (typeof input !== 'string') return false;
  const candidate = input.trim();
  if (!candidate || candidate.length > MAX_INTENT_INPUT_CHARS) return false;
  if (!/^\/?(?:poll|propose)(?=\s)\s+\S/i.test(candidate)) return false;
  return !hasProviderFreeChatCompoundIntent(candidate);
}

/**
 * Classify the narrow Chat lanes that finish without a hosted model. A few
 * read-only recovery commands may probe local bridge/app state, but they never
 * dispatch the selected model or perform a bridge mutation. This is
 * deliberately token-bound and fail-closed: unknown slash commands still
 * require normal catalog authority.
 */
export function classifyProviderFreeChatTurn(
  input: ProviderFreeChatTurnInput,
): ProviderFreeChatTurnReason | null {
  const content = normalizedId(input.content);
  if (!content) return null;
  if (/^__(?:SEND_CRYPTO|TIP|SPAWN_AGENT|SPAWN_AGENTS)__$/.test(content)) {
    return 'ui_sentinel';
  }
  if (input.isLocalAuditTurn) return 'local_data_command';
  if (input.isLocalSwanBotCommandTurn) return 'local_data_command';
  if (input.isAutomationProposalTurn) return 'local_data_command';
  if (input.isPlanDraftTurn) return 'local_plan';

  if (/^\/(?:help|commands)$/i.test(content)) return 'command_help';
  if (/^(?:help|commands|what can you do|what can i do|capabilities)\s*[?!]?$/i.test(content)) {
    return 'command_help';
  }
  if (
    /^(?:what|which|wht) model (?:are you|r u|is this|is it|are u) (?:using|on|running)(?: to respond(?: with)?)?\s*[?!]?$/i.test(content)
    || /^(?:what|which|wht) model (?:is this|are you on)\s*[?!]?$/i.test(content)
    || /^what model\s*[?!]?$/i.test(content)
  ) {
    return 'local_data_command';
  }
  if (/^(?:\/lanes|lane health|lane status)\s*[?!]?$/i.test(content)) return 'local_data_command';
  if (/^(?:my tasks?|status|stats|my streak|streak|leaderboard|rankings|members)$/i.test(content)) {
    return 'local_data_command';
  }
  if (/^(?:who(?: has|'s)? checked in|checked in|who.*in.*circle)\??$/i.test(content)) {
    return 'local_data_command';
  }
  if (/^(?:\/research|search research|research|\/wiki|search wiki|wiki) +\S/i.test(content)) {
    return 'local_data_command';
  }
  if (/^\/(?:diag|bridges)$/i.test(content)) return 'local_data_command';
  if (/^\/desktop(?: +(?:diag(?:nose)?(?: +\S.*)?|health))?$/i.test(content)) {
    return 'local_data_command';
  }
  if (/^\/(?:screen|apps)(?: +\S.*)?$/i.test(content)) return 'local_data_command';
  if (/^\/assign$/i.test(content)) return 'local_data_command';
  if (/^\/(?:v2|v2loop)(?: +|$)/i.test(content)) return 'local_settings';
  if (/^\/(?:memory-bank|mb)(?: +|$)/i.test(content)) return 'local_data_command';
  if (/^\/record(?: +|$)/i.test(content)) return 'local_settings';
  if (/^\/replay$/i.test(content)) return 'command_help';
  if (/^\/automation(?: +|$)/i.test(content)) {
    const execution = content.match(/^\/automation +(?:run|trigger|test|dry-?run)(?: +(.+))?$/i);
    return execution?.[1]?.trim() ? null : 'local_settings';
  }
  if (/^\/integrations?(?: +(?:(?:list|show|status)|connect +\S.*))?$/i.test(content)) {
    return 'command_help';
  }

  if (
    /^\/(?:poll|propose|search|schedule)(?: +\S.*)?$/i.test(content)
    || /^\/(?:vote|votes|proposals|pin|pins|pinned|reasoning-standard|deep-reasoning|memories|memory|summary|status)$/i.test(content)
    || /^\/(?:trace|remember|forget|cron|context|watch|mission|room|vault)(?: +|$)/i.test(content)
  ) {
    return 'local_data_command';
  }
  if (/^(?:poll|propose) +/i.test(content)) return 'local_data_command';
  return null;
}

function normalizedId(value: string | null | undefined): string {
  return String(value || '').trim();
}

function normalizedFallbackProvider(value: string | null | undefined): string {
  const provider = normalizedId(value).toLowerCase();
  if (provider === 'hugging_face') return 'huggingface';
  if (provider === 'z_ai') return 'zai';
  return provider;
}

const EQUIVALENT_PROVIDER_PRIORITY: ReadonlyArray<keyof ProviderModelAliases> = [
  'anthropic',
  'openai',
  'google_ai',
  'groq',
  'mistral_ai',
  'deepseek',
  'cohere',
  'perplexity',
  'together_ai',
  'fireworks_ai',
  'zai',
  'minimax',
  'openrouter',
  'huggingface',
];

/**
 * Explicitly reviewed, non-premium plain-Chat baselines. Unknown live catalog
 * rows and manual-only premium tiers are intentionally absent: an upstream
 * list reorder must never turn into surprise spend.
 */
export const SAFE_CHAT_FALLBACK_BASELINES: readonly string[] = Object.freeze([
  'openai/gpt-5.6-terra',
  'openai/gpt-5.6-luna',
  'github-models/openai/gpt-4.1-mini',
  'google_ai/gemini-3.6-flash',
  'google_ai/gemini-3.5-flash-lite',
  'groq/llama-3.3-70b-versatile',
  'groq/openai/gpt-oss-120b',
  'openrouter/anthropic/claude-sonnet-4-6',
  'openrouter/openai/gpt-5.6-terra',
  'openrouter/openai/gpt-5.6-luna',
  'openrouter/google/gemini-3.6-flash',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
  'mistral_ai/mistral-medium-3-5',
  'mistral_ai/mistral-small-2603',
  'deepseek/deepseek-v4-flash',
  'cohere/command-a-plus-05-2026',
  'cohere/command-r7b-12-2024',
  'perplexity/sonar-pro',
  'perplexity/sonar',
  'together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo',
  'fireworks_ai/accounts/fireworks/models/gpt-oss-120b',
  'zai/glm-5.1',
  'minimax/MiniMax-M2.7-highspeed',
  'minimax/MiniMax-M2.5-highspeed',
  'huggingface/Qwen/Qwen3-32B',
  'huggingface/meta-llama/Llama-3.1-8B-Instruct',
  'huggingface/cswan801/BlackSwan-v5',
]);

/**
 * Provider-native aliases that are the same reviewed model family but have
 * both a stable picker id and a dated provider execution id. Keep this list
 * deliberately small: it is equivalence policy, not fuzzy name matching.
 */
const REVIEWED_PROVIDER_NATIVE_EQUIVALENTS: readonly (readonly string[])[] = Object.freeze([
  Object.freeze(['claude-sonnet-4-6', 'claude-sonnet-4-6-20260301']),
  Object.freeze(['claude-haiku-4-5', 'claude-haiku-4-5-20251001']),
]);

/**
 * The current visual-brief transport is the authenticated Anthropic stream.
 * Keep this list separate from general vision capability claims so Chat never
 * sends image bytes to a model whose connected API cannot carry them.
 */
export const CHAT_VISUAL_BRIEF_MODELS: readonly string[] = Object.freeze([
  'claude-sonnet-4-6',
  'claude-sonnet-4-6-20260301',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5',
]);

export function resolveReadyChatVisualBriefModel(
  groups: readonly ModelSelectionCatalogGroup[],
  preferredModelId?: string | null,
): string | null {
  const preferred = normalizedId(preferredModelId);
  const ordered = [
    ...(CHAT_VISUAL_BRIEF_MODELS.includes(preferred) ? [preferred] : []),
    ...CHAT_VISUAL_BRIEF_MODELS,
  ].filter((modelId, index, all) => all.indexOf(modelId) === index);
  for (const modelId of ordered) {
    const readiness = resolveModelSelectionReadiness({
      route: resolvePlainChatModelRoute(modelId),
      groups,
    });
    if (readiness.ready && readiness.provider === 'anthropic') return modelId;
  }
  return null;
}

/**
 * The circle-owned BlackSwan catalog is executed by its dedicated runtime,
 * not the user's ordinary hosted plain-Chat proxy. Likewise, an
 * `huggingface_endpoint/*` id cannot be sent through the public HF router.
 * Keep both out of automatic substitution until that exact transport owns a
 * pre-dispatch invocation contract.
 */
function isPlainFallbackTransportEligible(modelId: string): boolean {
  const identity = resolveModelRouteIdentity(resolvePlainChatModelRoute(modelId));
  return Boolean(identity && identity.provider !== 'huggingface_endpoint');
}

function aliasModelId(
  provider: keyof ProviderModelAliases,
  providerModelId: string,
): string | null {
  const model = normalizedId(providerModelId);
  if (!model) return null;
  if (provider === 'anthropic') return model;
  if (provider === 'openrouter') return `openrouter/${model}`;
  if (provider === 'huggingface') return `huggingface/${model}`;
  return `${provider}/${model}`;
}

function executionKey(modelId: string): string | null {
  const identity = resolveModelRouteIdentity(resolvePlainChatModelRoute(modelId));
  return identity ? `${identity.provider}\u0000${identity.model}` : null;
}

function modelMeetsTurnRequirements(
  modelId: string,
  input: Pick<ReadyChatModelTurnInput, 'requireToolUse'>,
): boolean {
  return !input.requireToolUse || getModelCapabilityFlags(modelId).toolUse;
}

function isAutomaticVerifiedCatalogFallbackAllowed(modelId: string): boolean {
  const normalized = normalizedId(modelId).toLowerCase();
  if (!normalized || getModelCapabilityFlags(modelId).imageOnly) return false;
  // These intentionally expensive/manual reasoning tiers never become an
  // automatic substitute merely because they are present in an account.
  return !/(?:^|\/)(?:claude-(?:opus|fable)|o3-pro|gpt-5\.5-pro)(?:$|[-/])/i.test(normalized);
}

function equivalentModelIds(requestedModelId: string): string[] {
  const requestedKey = executionKey(requestedModelId);
  if (!requestedKey) return [];
  const equivalents: string[] = [];
  const seen = new Set<string>();
  const reviewedFamily = REVIEWED_PROVIDER_NATIVE_EQUIVALENTS.find((family) => (
    family.includes(requestedModelId)
  ));
  const requestedFamilyKeys = new Set<string>([
    requestedKey,
    ...(reviewedFamily || [])
      .map((modelId) => executionKey(modelId))
      .filter((key): key is string => !!key),
  ]);
  for (const modelId of reviewedFamily || []) {
    const key = executionKey(modelId);
    if (!key || key === requestedKey || seen.has(key)) continue;
    seen.add(key);
    equivalents.push(modelId);
  }
  for (const aliases of Object.values(MODEL_ALIASES)) {
    const familyIds = EQUIVALENT_PROVIDER_PRIORITY
      .map((provider) => aliasModelId(provider, aliases[provider] || ''))
      .filter((modelId): modelId is string => !!modelId);
    if (!familyIds.some((modelId) => {
      const key = executionKey(modelId);
      return !!key && requestedFamilyKeys.has(key);
    })) continue;
    for (const modelId of familyIds) {
      const key = executionKey(modelId);
      if (!key || key === requestedKey || seen.has(key)) continue;
      seen.add(key);
      equivalents.push(modelId);
    }
  }
  return equivalents;
}

function catalogConfidenceRank(group: ModelSelectionCatalogGroup): number {
  return group.catalogStatus === 'account_verified' || group.catalogStatus === 'circle_integration'
    ? 0
    : 1;
}

/**
 * Resolve exactly one model for a turn. A ready requested model is preserved.
 * If it is unavailable, a verified equivalent route wins, followed by a
 * verified task-aware candidate and the explicit safe baseline policy. A
 * curated-fallback row is considered only after every verified candidate.
 * Catalog/provider response order is never selection authority. Null means no
 * connected hosted Chat model is currently authorized.
 */
export function resolveReadyChatModelForTurn(
  input: ReadyChatModelTurnInput,
): ReadyChatModelTurnSelection | null {
  const requestedModelId = normalizedId(input.requestedModelId);
  if (!requestedModelId || requestedModelId.toLowerCase() === 'auto') return null;
  const requestedRoute = resolvePlainChatModelRoute(requestedModelId);
  const excludedProviders = new Set(
    (input.excludedGroupProviders || []).map(normalizedFallbackProvider),
  );
  const requestedIdentity = resolveModelRouteIdentity(requestedRoute);
  const requestedProviderExcluded = requestedIdentity
    ? excludedProviders.has(normalizedFallbackProvider(requestedIdentity.provider))
    : true;

  const requestedReadiness = resolveModelSelectionReadiness({
    route: requestedRoute,
    groups: input.groups,
  });
  if (
    requestedReadiness.ready
    && !requestedProviderExcluded
    && isPlainFallbackTransportEligible(requestedModelId)
    && modelMeetsTurnRequirements(requestedModelId, input)
  ) {
    const requestedKey = executionKey(requestedModelId);
    const exactRows = input.groups.flatMap((group) => (
      group.connected
        ? group.models
            .filter((model) => model.ready && executionKey(model.id) === requestedKey)
            .map((model) => ({
              modelId: normalizedId(model.id),
              catalogStatus: group.catalogStatus,
              catalogRank: catalogConfidenceRank(group),
            }))
        : []
    )).filter((row) => !!row.modelId);
    exactRows.sort((left, right) => (
      left.catalogRank - right.catalogRank
      || (left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0)
    ));
    const exactModelId = exactRows[0]?.modelId || requestedModelId;
    return Object.freeze({
      modelId: exactModelId,
      provider: requestedReadiness.provider,
      selectedCatalogStatus: exactRows[0]?.catalogStatus || requestedReadiness.catalogStatus,
      fallbackFromModelId: null,
      requestedReadiness: requestedReadiness.state,
      source: 'requested',
    });
  }

  const eligibleGroups = input.groups.filter((group) => (
    group.connected
    && normalizedFallbackProvider(group.provider) !== 'blackswan'
    && !excludedProviders.has(normalizedFallbackProvider(group.provider))
  ));
  const requestedExecutionKey = executionKey(requestedModelId);
  const excludedExecutionKeys = new Set(
    (input.excludedModelIds || [])
      .map((modelId) => executionKey(modelId))
      .filter((key): key is string => !!key),
  );
  const candidates: Array<{
    modelId: string;
    source: 'equivalent_ready' | 'preferred_ready' | 'baseline_ready' | 'catalog_ready';
    sourceRank: number;
    policyRank: number;
  }> = [];
  const seenExecutionKeys = new Set<string>(requestedExecutionKey ? [requestedExecutionKey] : []);

  const appendCandidate = (
    candidateModelId: string | null | undefined,
    source: 'equivalent_ready' | 'preferred_ready' | 'baseline_ready' | 'catalog_ready',
    sourceRank: number,
    policyRank: number,
  ) => {
    const modelId = normalizedId(candidateModelId);
    const key = executionKey(modelId);
    if (
      !modelId
      || !key
      || !isPlainFallbackTransportEligible(modelId)
      || !modelMeetsTurnRequirements(modelId, input)
      || seenExecutionKeys.has(key)
      || excludedExecutionKeys.has(key)
    ) return;
    seenExecutionKeys.add(key);
    candidates.push({ modelId, source, sourceRank, policyRank });
  };

  equivalentModelIds(requestedModelId).forEach((modelId, index) => {
    appendCandidate(modelId, 'equivalent_ready', 0, index);
  });
  (input.preferredModelIds || []).forEach((modelId, index) => {
    appendCandidate(modelId, 'preferred_ready', 1, index);
  });
  SAFE_CHAT_FALLBACK_BASELINES.forEach((modelId, index) => {
    appendCandidate(modelId, 'baseline_ready', 2, index);
  });

  const readyRows = eligibleGroups.flatMap((group) => (
    group.models
      .filter((model) => model.ready)
      .map((model) => {
        const modelId = normalizedId(model.id);
        const key = executionKey(modelId);
        if (
          !modelId
          || !key
          || !isPlainFallbackTransportEligible(modelId)
          || !modelMeetsTurnRequirements(modelId, input)
        ) return null;
        return {
          modelId,
          key,
          catalogRank: catalogConfidenceRank(group),
          catalogStatus: group.catalogStatus,
        };
      })
      .filter((row): row is {
        modelId: string;
        key: string;
        catalogRank: number;
        catalogStatus: ModelSelectionCatalogGroup['catalogStatus'];
      } => !!row)
  ));

  readyRows
    .filter((row) => (
      row.catalogStatus === 'account_verified'
      && isAutomaticVerifiedCatalogFallbackAllowed(row.modelId)
    ))
    .sort((left, right) => (
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    ))
    .forEach((row, index) => {
      appendCandidate(row.modelId, 'catalog_ready', 3, index);
    });

  const eligible = candidates.flatMap((candidate) => {
    const key = executionKey(candidate.modelId);
    if (!key) return [];
    const matches = readyRows.filter((row) => row.key === key);
    if (matches.length === 0) return [];
    matches.sort((a, b) => (
      a.catalogRank - b.catalogRank
      || (a.modelId < b.modelId ? -1 : a.modelId > b.modelId ? 1 : 0)
    ));
    const exactRegistryRow = matches[0];
    const route = resolvePlainChatModelRoute(exactRegistryRow.modelId);
    const readiness = resolveModelSelectionReadiness({ route, groups: eligibleGroups });
    if (!readiness.ready) return [];
    return [{
      ...candidate,
      modelId: exactRegistryRow.modelId,
      catalogRank: exactRegistryRow.catalogRank,
      catalogStatus: exactRegistryRow.catalogStatus,
      readiness,
      key,
    }];
  });

  eligible.sort((a, b) => (
    a.catalogRank - b.catalogRank
    || a.sourceRank - b.sourceRank
    || a.policyRank - b.policyRank
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  ));
  const selected = eligible[0];
  if (selected) {
    return Object.freeze({
      modelId: selected.modelId,
      provider: selected.readiness.provider,
      selectedCatalogStatus: selected.catalogStatus,
      fallbackFromModelId: requestedModelId,
      requestedReadiness: requestedReadiness.state,
      source: selected.source,
    });
  }

  return null;
}
