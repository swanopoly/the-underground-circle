/**
 * universalInvoke — high-level entry that wraps OpenRouter +
 * HuggingFace + OpenSwan + Anthropic-direct behind one call. Caller
 * passes a logical model id; we resolve a provider chain via
 * `crossProviderRouter`, execute each route in order until one
 * succeeds, and return a normalized response.
 *
 * Surfaces that should use this:
 *   - Chat composer when the user wants "the best available model"
 *     instead of pinning to a specific provider.
 *   - Automation executors that should keep working even when one
 *     provider rate-limits.
 *   - OpenSwan agent tool runs that need a quick LLM call without
 *     leaving the agent context.
 *
 * Surfaces that should NOT use this:
 *   - Hard-pinned model selections (user explicitly wants Claude
 *     Sonnet 4.6, not "anything close"). Those stay on
 *     `invokeLLMProxy({ provider: 'anthropic', model: ... })`.
 *   - Tool-using agent loops where the underlying provider's tool
 *     call shape matters. Cross-provider fallback can confuse the
 *     tool-result reconciliation.
 */

import { useUserApiKeys, invokeLLMProxy, type LLMProvider, type LLMProxyResponse } from './llmProviders';
import { invokeHfInference } from './hfService';
import {
  resolveProviderRoutes,
  type ProviderRoute,
  type RouteResolutionOptions,
} from './crossProviderRouter';
// Audit: class-specific advance decision so an auth error moves to a DIFFERENT
// provider instead of aborting the whole fallback chain. Aliased to avoid the
// name clash with providerHealthRegistry's classifyProviderError below.
import { shouldAdvanceAfterError, classifyProviderError as classifyProviderErrorForAdvance } from './providerErrorAdvanceCore';
import { recordProviderOutcomeNow, classifyProviderError } from './providerHealthRegistry';
import { getProviderRoutingMode, preferenceForMode } from './billingPriority';

export interface UniversalInvokeRequest {
  /** Logical or provider-specific model id. The router will alias-
   *  resolve it before picking providers. */
  modelId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  circleId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Passed through to every OpenAI-compatible proxy route. Standard
   *  function tools (`{type: 'function', function: {...}}`) reach all
   *  chat-capable providers; OpenRouter server tools (e.g.
   *  `[{type: 'openrouter:web_search'}]`) are only forwarded on the
   *  openrouter route since other providers reject unknown tool types. */
  tools?: Array<Record<string, unknown>>;
  /** Optional: caller can override provider preference (e.g. when
   *  cost is paramount, push openrouter-free first). */
  prefer?: Array<ProviderRoute['provider']>;
  preferFree?: boolean;
}

export interface UniversalInvokeResult {
  response: string;
  /** Which route in the chain actually succeeded. Useful for telemetry
   *  and for the cost-attribution layer that's coming in Phase 2. */
  servedBy: ProviderRoute;
  /** Routes attempted before this one (failed). Caller can use this
   *  to surface "fell back from X" in the UI when transparency
   *  matters. */
  fallbackChain: Array<{ route: ProviderRoute; reason: string }>;
  usage?: LLMProxyResponse['usage'];
}

/** Build the available-set from a per-user keys list. Pure — caller
 *  injects the keys so this stays smoke-testable. */
export function buildAvailableSet(
  keys: Array<{ provider: LLMProvider; isActive: boolean }>,
  opts?: { openswanReachable?: boolean },
): RouteResolutionOptions['available'] {
  const set = new Set<LLMProvider | 'anthropic' | 'openswan'>();
  for (const k of keys) {
    if (!k.isActive) continue;
    set.add(k.provider);
    if (k.provider === 'anthropic') set.add('anthropic');
  }
  if (opts?.openswanReachable) set.add('openswan');
  return set;
}

/**
 * Execute the cross-provider chain for one request. Returns the first
 * successful route's response; throws the LAST error if every route
 * fails (so the caller sees the most informative failure).
 *
 * Each route's invocation is wrapped in a try/catch — transient
 * errors (429, 5xx, timeouts) advance the chain. Structural errors
 * (400, 401, 403, 422) bubble immediately because the next provider
 * won't fix bad input.
 */
export async function executeRouteChain(
  routes: ProviderRoute[],
  req: UniversalInvokeRequest,
): Promise<UniversalInvokeResult> {
  if (routes.length === 0) {
    throw new Error('No providers available for this model. Connect a provider in Marketplace → AI Models & APIs.');
  }

  const fallbackChain: UniversalInvokeResult['fallbackChain'] = [];
  let lastError: unknown = null;

  for (let i = 0; i < routes.length; i += 1) {
    const route = routes[i];
    try {
      const result = await invokeOneRoute(route, req);
      // P29: record success so the health registry can prefer this provider.
      recordProviderOutcomeNow(route.provider, { ok: true });
      return { ...result, servedBy: route, fallbackChain };
    } catch (err) {
      lastError = err;
      const reason = (err as any)?.message || String(err);
      // P29: record the failure class so a flaky provider cools down for the
      // next turn's PRE-selection. This does NOT suppress the error below.
      recordProviderOutcomeNow(route.provider, { ok: false, errorClass: classifyProviderError(err) });
      fallbackChain.push({ route, reason });
      // Advance decision (audit): an AUTH error on this provider aborts the
      // chain only if no DIFFERENT provider remains (the same key just
      // re-fails); rate-limit/overload/transient advance while any route
      // remains (a same-provider different-model retry is legit). This
      // replaces the old "structural → break" that killed the whole chain on
      // a recoverable auth error when another provider could have answered.
      const differentProviderRemains = routes.slice(i + 1).some((r) => r.provider !== route.provider);
      const anyRouteRemains = i + 1 < routes.length;
      if (!shouldAdvanceAfterError(
        classifyProviderErrorForAdvance(err),
        { differentProviderRemains, anyRouteRemains },
      )) break;
    }
  }

  const finalErr = lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown error'));
  finalErr.message = `All routes failed. Last error: ${finalErr.message}. Tried: ${routes.map((r) => r.label).join(' → ')}.`;
  throw finalErr;
}

/** Which of the caller's tools go to a given proxy route. OpenRouter
 *  gets everything (it hosts server tools like `openrouter:web_search`);
 *  every other OpenAI-compatible chat route gets only standard
 *  function-calling tools, since non-OR providers reject unknown tool
 *  types with a 400 instead of ignoring them. Pure — smoke-testable. */
export function toolsForProxyRoute(
  provider: ProviderRoute['provider'],
  tools: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> | undefined {
  if (!tools || tools.length === 0) return undefined;
  if (provider === 'openrouter') return tools;
  const functionTools = tools.filter(
    (t) => t && (t.type === 'function' || typeof (t as { function?: unknown }).function === 'object'),
  );
  return functionTools.length > 0 ? functionTools : undefined;
}

/** Single-route invocation — branches on the route's `provider` to
 *  the right gateway and shapes the response uniformly. */
async function invokeOneRoute(
  route: ProviderRoute,
  req: UniversalInvokeRequest,
): Promise<{ response: string; usage?: LLMProxyResponse['usage'] }> {
  const proxyProviders: ReadonlySet<string> = new Set([
    'openrouter',
    'openai_compatible',
    'openai',
    'groq',
    'google_ai',
    'mistral_ai',
    'cohere',
    'perplexity',
    'together_ai',
    'fireworks_ai',
    'deepseek',
    'zai',
    'minimax',
    'ollama',
    'github-models',
  ]);
  if (proxyProviders.has(route.provider)) {
    const tools = toolsForProxyRoute(route.provider, req.tools);
    const result = await invokeLLMProxy({
      provider: route.provider as LLMProvider,
      model: route.modelId,
      messages: req.messages,
      circleId: req.circleId,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      tools,
    });
    return { response: result.response, usage: result.usage };
  }

  if (route.provider === 'anthropic-direct') {
    const result = await invokeLLMProxy({
      provider: 'anthropic',
      model: route.modelId,
      messages: req.messages,
      circleId: req.circleId,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    });
    return { response: result.response, usage: result.usage };
  }

  if (route.provider === 'huggingface') {
    // HF chat completion goes through hf-proxy edge fn. Its chat task
    // accepts an OpenAI-style `messages` array, so we forward the full
    // conversation — system prompt and history included — instead of
    // only the last user turn.
    const data = await invokeHfInference('chat', { messages: req.messages }, {
      model: route.modelId,
      max_tokens: req.maxTokens || 1024,
    });
    // hf-proxy wraps the OpenAI-compatible completion as `{ result, task, model }`.
    const completion = data?.result ?? data;
    const text = typeof completion === 'string'
      ? completion
      : (completion?.choices?.[0]?.message?.content
        || completion?.generated_text || completion?.response || completion?.text
        || JSON.stringify(completion));
    return { response: text };
  }

  if (route.provider === 'huggingface-task') {
    // Reserved for non-chat HF tasks (image gen, embeddings) —
    // caller would need to send a different payload shape.
    throw new Error('huggingface-task route requires task-specific invocation; not handled by executeRouteChain.');
  }

  if (route.provider === 'openswan') {
    // OpenSwan's chat path expects a session id + message. The unified
    // wrapper doesn't own session state, so we surface a clear error
    // pointing the caller at the OpenSwan-specific helper. This route
    // is only included when the OpenSwan gateway is reachable AND the
    // alias maps to an OpenSwan agent — usually for ad-hoc bridge use.
    throw new Error('OpenSwan routes require session-aware invocation. Use sendMessageToSession from openswanService.');
  }

  throw new Error(`Unsupported route provider: ${route.provider}`);
}

/**
 * Top-level convenience — resolves routes from the user's keys and
 * executes them. Most callers want this one.
 */
export async function invokeAnyChat(
  req: UniversalInvokeRequest & {
    /** When provided, resolved routes will be filtered to providers
     *  the user has connected. When omitted, the caller is expected
     *  to have already filtered. */
    userKeys?: Array<{ provider: LLMProvider; isActive: boolean }>;
    /** Whether the local OpenSwan gateway is reachable from this
     *  runtime. Caller injects so we don't probe in this lib. */
    openswanReachable?: boolean;
  },
): Promise<UniversalInvokeResult> {
  const available = req.userKeys
    ? buildAvailableSet(req.userKeys, { openswanReachable: req.openswanReachable })
    : new Set<LLMProvider | 'anthropic' | 'openswan'>(['openrouter']);
  // Honor the user's billing-priority preference (set in the
  // marketplace) when the caller didn't pin an explicit order.
  // Default is cost-sensitive: local/free/cheap connected providers before
  // direct Anthropic, unless the user explicitly changes Marketplace routing.
  const prefer = req.prefer ?? preferenceForMode(getProviderRoutingMode());
  const routes = resolveProviderRoutes(req.modelId, {
    available,
    prefer,
    preferFree: req.preferFree,
    // P29: health-aware PRE-selection — a provider that failed in the last
    // ~30s is tried LAST this turn (never dropped). Fail-visible: reorders
    // future attempts only; the surfaced error below is still surfaced.
    healthNowMs: Date.now(),
  });
  return executeRouteChain(routes, req);
}

/**
 * React hook — wraps `invokeAnyChat` with the user's connected keys
 * automatically pulled from `useUserApiKeys`. The returned function
 * is stable across renders.
 *
 * Use this from React components. For non-React callers (edge fns,
 * agent runtimes, automations), use `invokeAnyChat` directly with an
 * explicitly-loaded keys list.
 */
export function useInvokeAnyChat() {
  const { keys } = useUserApiKeys();
  return async (req: Omit<UniversalInvokeRequest, 'userKeys' | 'openswanReachable'> & {
    openswanReachable?: boolean;
  }): Promise<UniversalInvokeResult> => {
    return invokeAnyChat({
      ...req,
      userKeys: keys,
      openswanReachable: req.openswanReachable,
    });
  };
}
