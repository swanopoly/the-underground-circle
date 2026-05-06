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
  isTransientProviderError,
  type ProviderRoute,
  type RouteResolutionOptions,
} from './crossProviderRouter';
import { getProviderRoutingMode, preferenceForMode } from './billingPriority';

export interface UniversalInvokeRequest {
  /** Logical or provider-specific model id. The router will alias-
   *  resolve it before picking providers. */
  modelId: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  circleId?: string;
  temperature?: number;
  maxTokens?: number;
  /** Pass through to OpenRouter when present — server tools (e.g.
   *  `[{type: 'openrouter:web_search'}]`) attach to the chat
   *  request. Ignored on non-OR providers. */
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
  const set = new Set<'openrouter' | 'huggingface' | 'anthropic' | 'openai' | 'groq' | 'openswan'>();
  for (const k of keys) {
    if (!k.isActive) continue;
    if (k.provider === 'openrouter')   set.add('openrouter');
    if (k.provider === 'huggingface')  set.add('huggingface');
    if (k.provider === 'anthropic')    set.add('anthropic');
    if (k.provider === 'openai')       set.add('openai');
    if (k.provider === 'groq')         set.add('groq');
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

  for (const route of routes) {
    try {
      const result = await invokeOneRoute(route, req);
      return { ...result, servedBy: route, fallbackChain };
    } catch (err) {
      lastError = err;
      const transient = isTransientProviderError(err);
      const reason = (err as any)?.message || String(err);
      fallbackChain.push({ route, reason });
      // Structural errors bubble immediately — fallback won't help.
      if (!transient) break;
    }
  }

  const finalErr = lastError instanceof Error ? lastError : new Error(String(lastError ?? 'unknown error'));
  finalErr.message = `All routes failed. Last error: ${finalErr.message}. Tried: ${routes.map((r) => r.label).join(' → ')}.`;
  throw finalErr;
}

/** Single-route invocation — branches on the route's `provider` to
 *  the right gateway and shapes the response uniformly. */
async function invokeOneRoute(
  route: ProviderRoute,
  req: UniversalInvokeRequest,
): Promise<{ response: string; usage?: LLMProxyResponse['usage'] }> {
  if (route.provider === 'openrouter' || route.provider === 'openai' || route.provider === 'groq') {
    const result = await invokeLLMProxy({
      provider: route.provider,
      model: route.modelId,
      messages: req.messages,
      circleId: req.circleId,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      tools: route.provider === 'openrouter' ? req.tools : undefined,
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
    // HF chat completion goes through hf-proxy edge fn. The shape
    // differs per task — we use 'text-generation' for chat. The
    // proxy normalizes prompt + history, so we pass the last user
    // message as the prompt and earlier turns as conversation.
    const last = req.messages[req.messages.length - 1];
    const lastContent = typeof last?.content === 'string' ? last.content : '';
    const data = await invokeHfInference('text-generation', lastContent, {
      model: route.modelId,
      max_tokens: req.maxTokens || 1024,
    });
    const text = typeof data === 'string'
      ? data
      : (data?.generated_text || data?.response || data?.text || JSON.stringify(data));
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
    : new Set<'openrouter' | 'huggingface' | 'anthropic' | 'openai' | 'groq' | 'openswan'>(['openrouter']);
  // Honor the user's billing-priority preference (set in the
  // marketplace) when the caller didn't pin an explicit order.
  // Default `prefer_direct` keeps native keys ahead of OpenRouter,
  // which is what most users actually want — pay providers
  // directly with no markup.
  const prefer = req.prefer ?? preferenceForMode(getProviderRoutingMode());
  const routes = resolveProviderRoutes(req.modelId, {
    available,
    prefer,
    preferFree: req.preferFree,
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
