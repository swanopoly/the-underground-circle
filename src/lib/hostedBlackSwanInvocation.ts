/**
 * hostedBlackSwanInvocation — Phase-4 invocation route for the app-trained
 * BlackSwan model (PURE).
 *
 * BlackSwan-v5 (`cswan801/BlackSwan-v5`) is the future "model created using all
 * of the data of the website/application": a first-class collaborator that
 * slots in alongside the frontier models. Before the proxy/edge can actually
 * call it, every BlackSwan-aware path needs to agree on ONE thing — *which
 * channel* a given BlackSwan id resolves to, and what that channel requires:
 *
 *   - 'hf_endpoint'  — the dedicated HuggingFace Inference Endpoint
 *     (`huggingface_endpoint/cswan801/BlackSwan-v5`). This is the production
 *     route for the app-trained checkpoint. It is NOT the public HF router;
 *     the proxy must target a dedicated endpoint URL carried in an env var.
 *   - 'hf_public'    — the public HuggingFace model
 *     (`huggingface/cswan801/BlackSwan-v5`), served by the shared HF router.
 *   - 'local_ollama' — the on-device Ollama `blackswan` weight (native/desktop
 *     only, via the local `blackswanLLM` bridge).
 *   - 'unsupported'  — anything that is not BlackSwan in any form.
 *
 * This module is the single declaration of that contract. It is intentionally
 * dependency-light: its only value import is `blackswanRouting` (itself pure —
 * `import type` only), so it is tsx-loadable for smoke tests. It makes NO
 * network calls and reads NO secrets; it only names the env var the proxy WOULD
 * read so the endpoint URL never has to live in app code.
 *
 * Design intent (so a new checkpoint is one-line to onboard): the channel and
 * tool-executor decisions are derived from `blackswanRouting`'s canonical
 * predicates + id sets. Register a future checkpoint there and this route picks
 * it up automatically.
 */

import {
  BLACKSWAN_ENDPOINT_MODEL_ID,
  BLACKSWAN_PUBLIC_MODEL_ID,
  BLACKSWAN_TOOL_EXECUTOR_MODEL_ID,
  isHostedBlackSwanModel,
  isLocalOllamaBlackSwan,
} from './blackswanRouting';

/**
 * Which transport a BlackSwan id resolves to. Anything non-BlackSwan is
 * 'unsupported' — callers must fail closed rather than guess a transport.
 */
export type BlackSwanChannel = 'hf_endpoint' | 'hf_public' | 'local_ollama' | 'unsupported';

/**
 * The env var the llm-proxy WOULD read to find the dedicated HuggingFace
 * Inference Endpoint base URL for BlackSwan-v5. Named here (not the URL itself)
 * so the real endpoint never lives in app code, prompts, logs, or git. Only the
 * 'hf_endpoint' channel needs it; every other channel reports `null`.
 */
export const HF_BLACKSWAN_ENDPOINT_ENV_VAR = 'HF_BLACKSWAN_ENDPOINT';

/**
 * The reliable Claude tool executor that drives the runtime tool loop when a
 * BlackSwan model is selected. BlackSwan is the app-grounding collaborator; the
 * frontier executor owns native tool/function calling. Re-exported from
 * `blackswanRouting` so there is exactly one source of truth for this id.
 */
export const BLACKSWAN_TOOL_EXECUTOR_MODEL = BLACKSWAN_TOOL_EXECUTOR_MODEL_ID;

/**
 * The resolved invocation contract for a BlackSwan model id. This is the shape
 * the proxy/edge needs to honor to actually invoke the app-trained model —
 * including which env var carries the endpoint URL and which frontier model
 * runs the tool loop while BlackSwan stays in the grounding context.
 */
export interface BlackSwanInvocationRoute {
  /** The (trimmed) model id this route was resolved for. */
  modelId: string;
  /** Which transport this id maps to. */
  channel: BlackSwanChannel;
  /**
   * Name of the env var the proxy reads for the dedicated endpoint base URL.
   * Only set for 'hf_endpoint'; `null` for every other channel.
   */
  endpointEnvVar: string | null;
  /**
   * Whether the BlackSwan app-grounding contract must be injected for this
   * route. True for every real BlackSwan channel (BlackSwan is grounded on app
   * state by design); false only for 'unsupported'.
   */
  requiresGrounding: boolean;
  /**
   * The frontier Claude model that should drive any runtime tool loop for a
   * BlackSwan turn. BlackSwan itself is not a reliable native-tool caller yet,
   * so tool-heavy turns delegate to this executor while BlackSwan remains
   * grounding context.
   */
  toolExecutorModel: string;
  /** Human-readable explanation of why this channel/contract was chosen. */
  reason: string;
}

/**
 * Resolve the invocation route for a model id.
 *
 * Hosted BlackSwan splits into the dedicated endpoint vs. the public model:
 *   - the endpoint id (or any `huggingface_endpoint/...blackswan...`) →
 *     'hf_endpoint' + the endpoint env var,
 *   - the public id (or any `huggingface/...blackswan...`) → 'hf_public'.
 * The local Ollama weight → 'local_ollama'. Everything else → 'unsupported'.
 *
 * Order matters: we classify LOCAL first (the bridge weight), then split HOSTED
 * into endpoint vs. public by prefix, mirroring `blackswanRouting`'s own
 * local/hosted split so the two never disagree.
 */
export function resolveBlackSwanInvocation(modelId: string): BlackSwanInvocationRoute {
  const trimmed = (modelId || '').trim();
  const normalized = trimmed.toLowerCase();

  // LOCAL on-device Ollama weight — must NOT be confused with the HF ids even
  // though they all contain "blackswan". `blackswanRouting` already guards
  // huggingface(_endpoint)/ ids out of the local predicate.
  if (isLocalOllamaBlackSwan(trimmed)) {
    return {
      modelId: trimmed,
      channel: 'local_ollama',
      endpointEnvVar: null,
      requiresGrounding: true,
      toolExecutorModel: BLACKSWAN_TOOL_EXECUTOR_MODEL,
      reason:
        'Local on-device Ollama BlackSwan weight; runs through the local blackswanLLM bridge (native/desktop only).',
    };
  }

  // HOSTED HuggingFace BlackSwan — split the dedicated endpoint from the public
  // model. The dedicated endpoint is the production route for the app-trained
  // checkpoint and needs a dedicated endpoint URL (carried by the env var),
  // NOT the shared public HF router.
  if (isHostedBlackSwanModel(trimmed)) {
    const isDedicatedEndpoint =
      normalized === BLACKSWAN_ENDPOINT_MODEL_ID.toLowerCase() ||
      normalized.startsWith('huggingface_endpoint/');
    if (isDedicatedEndpoint) {
      return {
        modelId: trimmed,
        channel: 'hf_endpoint',
        endpointEnvVar: HF_BLACKSWAN_ENDPOINT_ENV_VAR,
        requiresGrounding: true,
        toolExecutorModel: BLACKSWAN_TOOL_EXECUTOR_MODEL,
        reason: `Dedicated HuggingFace Inference Endpoint for the app-trained BlackSwan-v5; proxy must target the URL in ${HF_BLACKSWAN_ENDPOINT_ENV_VAR} (not the public HF router).`,
      };
    }
    return {
      modelId: trimmed,
      channel: 'hf_public',
      endpointEnvVar: null,
      requiresGrounding: true,
      toolExecutorModel: BLACKSWAN_TOOL_EXECUTOR_MODEL,
      reason: 'Public HuggingFace BlackSwan model; served by the shared HuggingFace router endpoint.',
    };
  }

  // Not BlackSwan in any form — fail closed. Callers must NOT invent a
  // transport for a non-BlackSwan id.
  return {
    modelId: trimmed,
    channel: 'unsupported',
    endpointEnvVar: null,
    requiresGrounding: false,
    toolExecutorModel: BLACKSWAN_TOOL_EXECUTOR_MODEL,
    reason: 'Not a BlackSwan model id; no BlackSwan invocation channel applies.',
  };
}

/** Convenience: true only for the production dedicated-endpoint route. */
export function isDedicatedEndpointRoute(route: BlackSwanInvocationRoute): boolean {
  return route.channel === 'hf_endpoint';
}

/** Convenience: every real BlackSwan channel (i.e. not 'unsupported'). */
export function isBlackSwanChannel(channel: BlackSwanChannel): boolean {
  return channel !== 'unsupported';
}

/** The full public reference set so callers don't re-derive id ↔ channel. */
export const HOSTED_BLACKSWAN_ENDPOINT_MODEL_ID = BLACKSWAN_ENDPOINT_MODEL_ID;
export const HOSTED_BLACKSWAN_PUBLIC_MODEL_ID = BLACKSWAN_PUBLIC_MODEL_ID;
