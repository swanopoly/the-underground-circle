/**
 * hf-proxy client — typed wrapper around the HuggingFace inference edge fn.
 *
 * Why a dedicated client? `huggingFaceChatCommands.ts` historically routed
 * EVERY command (including /imagine, /speak) through SwanBot/Claude. That
 * meant /imagine returned text descriptions of images instead of actual
 * images. This module finally calls the real HF Inference API.
 *
 * Error contract — the edge function returns:
 *   { result, task, model }                     on success
 *   { error: string, code: HfProxyErrorCode }   on failure
 *
 * Callers should pattern-match on `code` to render the right user-facing
 * guidance ("HuggingFace not configured" vs "model not found" etc.).
 */

import { supabase } from './supabase';

export type HfProxyErrorCode =
  | 'token_missing'        // HF_TOKEN env var not set on the edge function
  | 'token_invalid'        // HF rejected the token (401)
  | 'token_rate_limited'   // HF returned 429
  | 'tool_not_found'       // toolId provided but RLS denied access
  | 'model_not_found'      // 404 from HF
  | 'bad_request'          // validation failure
  | 'upstream_error'       // other HF API failure
  | 'internal'             // unclassified
  | 'network';             // edge function unreachable

export interface HfProxyOk<T = unknown> {
  ok: true;
  result: T;
  task: string;
  model: string;
}

export interface HfProxyErr {
  ok: false;
  error: string;
  code: HfProxyErrorCode;
}

export type HfProxyResult<T = unknown> = HfProxyOk<T> | HfProxyErr;

export interface HfProxyRequest {
  task: 'chat' | 'text-generation' | 'code' | 'text-to-image' | 'summarization'
      | 'sentiment' | 'text-classification' | 'embeddings' | 'feature-extraction'
      | 'translation' | 'speech-to-text' | 'text-to-speech' | 'vision';
  inputs: unknown;
  model?: string;
  toolId?: string;
  circleId?: string;
  options?: { max_tokens?: number; temperature?: number; [key: string]: unknown };
}

/**
 * Invoke hf-proxy. All responses are normalized to a discriminated union so
 * the caller doesn't have to wrap every call in try/catch.
 */
export async function callHfProxy<T = unknown>(req: HfProxyRequest): Promise<HfProxyResult<T>> {
  try {
    const { data, error } = await supabase.functions.invoke('hf-proxy', {
      body: req,
    });

    // Transport-level failure (function not deployed, CORS, network).
    if (error) {
      return {
        ok: false,
        error: `Could not reach hf-proxy: ${error.message}. Deploy with \`npx supabase functions deploy hf-proxy\`.`,
        code: 'network',
      };
    }

    // Edge function returned a structured error.
    if (data?.error) {
      return {
        ok: false,
        error: data.error as string,
        code: (data.code as HfProxyErrorCode) || 'internal',
      };
    }

    if (!data?.result) {
      return {
        ok: false,
        error: 'hf-proxy returned no result. Check edge function logs.',
        code: 'internal',
      };
    }

    return {
      ok: true,
      result: data.result as T,
      task: data.task,
      model: data.model,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      code: 'internal',
    };
  }
}

/**
 * User-facing message for an error code — surfaces the actionable next step
 * ("set HF_TOKEN" / "rotate your token" / etc.) instead of a generic failure.
 */
export function hfErrorGuidance(code: HfProxyErrorCode): string {
  switch (code) {
    case 'token_missing':
      return 'HuggingFace isn\'t configured. An admin needs to set HF_TOKEN via `npx supabase secrets set HF_TOKEN=hf_xxx` and redeploy hf-proxy.';
    case 'token_invalid':
      return 'The HuggingFace token was rejected. Generate a new one at huggingface.co/settings/tokens and update HF_TOKEN.';
    case 'token_rate_limited':
      return 'HuggingFace rate limit hit — wait a minute and try again, or upgrade your HF account for higher quotas.';
    case 'tool_not_found':
      return 'That HuggingFace tool isn\'t available in this circle.';
    case 'model_not_found':
      return 'HuggingFace doesn\'t have that model. Try a different one or check spelling.';
    case 'network':
      return 'Couldn\'t reach the HuggingFace proxy. Try again — if it persists, an admin needs to redeploy the edge function.';
    case 'bad_request':
      return 'The request was malformed. Try a simpler prompt or report this if it keeps happening.';
    case 'upstream_error':
      return 'HuggingFace returned an error. Check the model is online (some models have cold starts).';
    default:
      return 'Something went wrong with HuggingFace.';
  }
}
