/**
 * agentDeployModelPolicy — Phase-3 mass-agent-deploy model resolution.
 *
 * Decides the concrete model a deployed agent should run, and fails closed
 * when that model can't be honored on the chosen channel.
 *
 * Two channels:
 *   - 'web'    — runs through the in-app OpenSwan -> swanbot-ai / llm-proxy
 *                path (Netlify-safe). Any catalog model id is allowed.
 *   - 'bridge' — runs through the local Claude Code CLI bridge, which only
 *                reliably runs `claude-*` models. A non-claude id over the
 *                bridge FAILS CLOSED (never silently swapped to a different
 *                model).
 *
 * Imports are limited to other tsx-loadable pure-ish modules
 * (serviceProfileSouls, llmProviders, crossProviderRouter) so this file
 * stays loadable in the deploy smoke test.
 *
 * Alias rule: we normalize only the PROVIDER PREFIX token
 * (`hugging_face` -> `huggingface`, `z_ai` -> `zai`). We NEVER rewrite the
 * model id itself — if the user asked for an exact id, that exact id flows
 * through (so a typo fails validation instead of being "helpfully" changed).
 */

import { resolveModelForSoul } from './serviceProfileSouls';
import { findAliasKey } from './crossProviderRouter';

export interface ResolvedDeployModel {
  model: string;
  ok: boolean;
  reason?: string;
}

// NOTE on catalog validation source:
//   The interface contract names `llmProviders.PROVIDER_MODELS` as the
//   catalog. In this repo `llmProviders.ts` imports React + the supabase
//   singleton at module top, so importing its *values* makes this module
//   un-loadable under tsx (esbuild then tries to transform react-native).
//   `crossProviderRouter.findAliasKey` is the tsx-loadable proxy for "is
//   this a recognized canonical model id" — it resolves every catalog model
//   id (claude / gpt / gemini / sonar / llama / mistral / qwen / deepseek /
//   glm …) to its canonical alias key and returns null for unknown ids. We
//   use it for BARE ids and keep a structural check for provider-prefixed
//   ids. This preserves smoke-loadability without weakening the fail-closed
//   gate (an unknown bare id still returns ok:false).

/** Provider prefix tokens that are valid heads for a provider-prefixed id.
 *  Mirrors crossProviderRouter.providerFromModelPrefix (not exported there)
 *  plus the BlackSwan/HF endpoint head used across the app. */
const VALID_PROVIDER_PREFIXES = new Set<string>([
  'openai',
  'openai_compatible',
  'anthropic',
  'openrouter',
  'groq',
  'ollama',
  'replicate',
  'github-models',
  'huggingface',
  'huggingface_endpoint',
  'zai',
  'minimax',
  'google_ai',
  'mistral_ai',
  'cohere',
  'perplexity',
  'together_ai',
  'fireworks_ai',
  'deepseek',
  'openswan',
]);

export function resolveDeployModel(
  requested: string,
  opts: { connectedProviders: string[]; channel: 'web' | 'bridge' },
): ResolvedDeployModel {
  const channel = opts?.channel === 'bridge' ? 'bridge' : 'web';
  const raw = (requested || '').trim();

  if (!raw) {
    return { model: raw, ok: false, reason: 'No model requested.' };
  }

  // 'auto' → let the soul router pick a concrete model. We bias it with the
  // team's connected providers so auto leans on their BYOK keys, exactly
  // like the chat auto path. The senior-engineer soul is the deploy default.
  let resolved = raw;
  if (raw.toLowerCase() === 'auto') {
    const connectedSet = new Set((opts?.connectedProviders || []).map((p) => String(p)));
    resolved = resolveModelForSoul('sr-engineer', 'auto', undefined, undefined, undefined, undefined, connectedSet);
  } else {
    // Normalize ONLY the provider-prefix token; never touch the model id.
    resolved = normalizeProviderPrefix(raw);
  }

  // Validate the (possibly prefix-normalized) id exists in the catalog or is
  // a structurally valid provider-prefixed id. This is the fail-closed gate:
  // an unknown id never launches.
  if (!isResolvableModelId(resolved)) {
    return {
      model: resolved,
      ok: false,
      reason: `Model "${resolved}" is not in the provider catalog and is not a valid provider-prefixed id.`,
    };
  }

  // Bridge channel only runs claude-* reliably. A non-claude id fails closed
  // rather than being swapped — never silently run a different model.
  if (channel === 'bridge' && !isClaudeModelId(resolved)) {
    return {
      model: resolved,
      ok: false,
      reason: `The CLI bridge channel only runs claude-* models reliably; "${resolved}" cannot be deployed over the bridge. Use the web channel or pick a claude-* model.`,
    };
  }

  return { model: resolved, ok: true };
}

/**
 * Normalize the leading provider token of a prefixed id:
 *   hugging_face/... -> huggingface/...
 *   z_ai/...         -> zai/...
 * Bare ids (no `/`) and already-normalized ids pass through unchanged. The
 * portion after the first `/` (the real model id) is never modified.
 */
function normalizeProviderPrefix(id: string): string {
  const slashIdx = id.indexOf('/');
  if (slashIdx <= 0) return id;
  const head = id.slice(0, slashIdx);
  const rest = id.slice(slashIdx); // includes the leading '/'
  if (head === 'hugging_face') return `huggingface${rest}`;
  if (head === 'z_ai') return `zai${rest}`;
  return id;
}

/** True when the id is a recognized canonical (bare) catalog id OR a
 *  structurally valid provider-prefixed id (`<knownProvider>/<non-empty
 *  model id>`). Bare-id membership is checked via crossProviderRouter's
 *  alias resolver (see the catalog-validation note above). */
function isResolvableModelId(id: string): boolean {
  const slashIdx = id.indexOf('/');
  if (slashIdx <= 0) {
    // Bare id: must resolve to a known canonical alias key.
    return findAliasKey(id) !== null;
  }
  // Provider-prefixed id: known provider head + non-empty model id portion.
  const head = id.slice(0, slashIdx);
  const tail = id.slice(slashIdx + 1);
  if (!tail.trim()) return false;
  return VALID_PROVIDER_PREFIXES.has(head);
}

/** True for Anthropic Claude ids in either bare (`claude-sonnet-4-6`) or
 *  provider-prefixed (`anthropic/claude-...`, `openrouter/anthropic/claude-...`)
 *  form. The bridge needs an actual claude model behind whatever prefixing. */
function isClaudeModelId(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.startsWith('claude-')) return true;
  // Allow prefixed claude ids: the last path segment (or the segment right
  // after an `anthropic/` head) must start with `claude-`.
  const segments = lower.split('/');
  const last = segments[segments.length - 1] || '';
  if (last.startsWith('claude-')) return true;
  // openrouter/anthropic/claude-... — any segment being a claude id counts.
  return segments.some((seg) => seg.startsWith('claude-'));
}
