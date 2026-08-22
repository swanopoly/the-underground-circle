/**
 * hf-proxy — Supabase Edge Function
 *
 * Multi-task Hugging Face inference proxy.
 * Supports: chat, text-to-image, summarization, sentiment, embeddings,
 * speech-to-text, translation, and raw Space invocation.
 *
 * Uses the new HF Inference Providers router (router.huggingface.co).
 *
 * Error response shape: { error: string, code: ErrorCode }
 *   token_missing      — HF_TOKEN env var not set on the edge function
 *   token_invalid      — HF returned 401 (token rejected)
 *   token_rate_limited — HF returned 429
 *   tool_not_found     — toolId provided but RLS denied access
 *   model_not_found    — HF returned 404 for the requested model
 *   bad_request        — Malformed inputs
 *   upstream_error     — Other HF API failure (passes through status + body)
 *   internal           — Unclassified
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.3';
import { byokMissingMessage, getAuthenticatedUser, resolveUserModelApiKey } from '../_shared/edge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type ErrorCode =
  | 'token_missing'
  | 'token_invalid'
  | 'token_rate_limited'
  | 'unauthenticated'
  | 'forbidden'
  | 'authority_unavailable'
  | 'key_missing'
  | 'tool_not_found'
  | 'model_not_found'
  | 'bad_request'
  | 'upstream_error'
  | 'internal';

function errResponse(status: number, code: ErrorCode, message: string) {
  return new Response(
    JSON.stringify({ error: message, code }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Translate an HF API error into a structured response. Status-driven so
 * downstream clients can show the right "fix this by…" guidance.
 */
async function hfApiErrorResponse(response: Response): Promise<Response> {
  const body = await response.text();
  if (response.status === 401) {
    return errResponse(401, 'token_invalid',
      'HuggingFace rejected the API token. Generate a new token at https://huggingface.co/settings/tokens and update your saved Hugging Face key.');
  }
  if (response.status === 429) {
    return errResponse(429, 'token_rate_limited',
      'HuggingFace rate limit hit. Wait a minute and retry, or upgrade your HF account for higher quotas.');
  }
  if (response.status === 404) {
    return errResponse(404, 'model_not_found',
      `HuggingFace doesn't recognize the requested model. ${body.slice(0, 200)}`);
  }
  return errResponse(502, 'upstream_error', `HF API ${response.status}: ${body.slice(0, 300)}`);
}

// Task-specific default models
const DEFAULT_MODELS: Record<string, string> = {
  'chat':              'Qwen/Qwen3.5-72B-Instruct',
  'text-generation':   'Qwen/Qwen3.5-27B-Instruct',
  'code':              'Qwen/Qwen3-Coder-Next',
  'text-to-image':     'black-forest-labs/FLUX.1-schnell',
  'summarization':     'facebook/bart-large-cnn',
  'sentiment':         'distilbert-base-uncased-finetuned-sst-2-english',
  'text-classification': 'distilbert-base-uncased-finetuned-sst-2-english',
  'embeddings':        'sentence-transformers/all-MiniLM-L6-v2',
  'feature-extraction': 'sentence-transformers/all-MiniLM-L6-v2',
  'translation':       'facebook/mbart-large-50-many-to-many-mmt',
  'speech-to-text':    'openai/whisper-large-v3',
  'text-to-speech':    'espnet/kan-bayashi_ljspeech_vits',
  'vision':            'Qwen/Qwen2.5-VL-7B-Instruct',
};

// Tasks that return binary (image/audio) instead of JSON
const BINARY_TASKS = new Set(['text-to-image', 'text-to-speech']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { task, model, inputs, toolId, options } = body;

    if (!inputs && task !== 'help') {
      return errResponse(400, 'bad_request', 'Missing `inputs` in request body.');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const isServiceRole = Boolean(serviceKey && token === serviceKey);
    const authUser = isServiceRole ? null : await getAuthenticatedUser(req);
    const userId = isServiceRole ? (typeof body.userId === 'string' ? body.userId : null) : authUser?.id;
    if (!userId) {
      return errResponse(401, 'unauthenticated', 'Valid user JWT required, or service role must pass body.userId.');
    }

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const serviceCircleId = isServiceRole && typeof body.circleId === 'string'
      ? body.circleId.trim()
      : '';
    if (isServiceRole) {
      // An internal caller naming a user is not, by itself, authority to spend
      // that user's personal Hugging Face key. Bind the delegation to a
      // current exact Circle membership before key resolution or provider IO.
      if (!serviceCircleId) {
        return errResponse(400, 'bad_request', 'Service calls require an exact Circle.');
      }
      const { data: membership, error: membershipError } = await serviceClient
        .from('circle_members')
        .select('circle_id')
        .eq('circle_id', serviceCircleId)
        .eq('user_id', userId)
        .maybeSingle();
      if (membershipError) {
        return errResponse(503, 'authority_unavailable', 'Circle access could not be verified.');
      }
      if (!membership) {
        return errResponse(403, 'forbidden', 'The delegated user is not a current member of this Circle.');
      }
    }
    const hfKey = await resolveUserModelApiKey({
      supabase: serviceClient,
      userId,
      provider: 'huggingface',
      envVarName: 'HF_TOKEN',
    });
    if (!hfKey) {
      return errResponse(400, 'key_missing', byokMissingMessage('huggingface'));
    }
    const hfToken = hfKey.apiKey;

    // If toolId is provided, verify exact access. User calls use their own RLS;
    // trusted service calls are pinned to the delegated Circle above rather
    // than forwarding the service key through an apparent anon client.
    if (toolId) {
      const toolClient = isServiceRole
        ? serviceClient
        : createClient(
          supabaseUrl,
          Deno.env.get('SUPABASE_ANON_KEY') ?? '',
          { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
        );
      let toolQuery = toolClient
        .from('circle_hf_tools')
        .select('*')
        .eq('id', toolId);
      if (isServiceRole) toolQuery = toolQuery.eq('circle_id', serviceCircleId);
      const { data: tool, error: toolError } = await toolQuery.single();

      if (toolError || !tool) {
        return errResponse(403, 'tool_not_found',
          'HuggingFace tool not found or access denied (you may not be a member of this circle).');
      }
    }

    // Determine the task type and model
    const taskType = task || 'chat';
    const modelId = model || DEFAULT_MODELS[taskType] || DEFAULT_MODELS['chat'];

    let result: any;

    // ── Chat completion (OpenAI-compatible) ──────────────────────────────
    if (taskType === 'chat' || taskType === 'text-generation') {
      const messages = inputs.messages || [{ role: 'user', content: String(inputs) }];
      const response = await fetch('https://router.huggingface.co/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${hfToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelId,
          messages,
          max_tokens: options?.max_tokens || 1024,
          temperature: options?.temperature ?? 0.7,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Chat Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Text-to-Image ────────────────────────────────────────────────────
    else if (taskType === 'text-to-image') {
      const prompt = typeof inputs === 'string' ? inputs : inputs.prompt || inputs.inputs;
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: prompt }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Image Error: ${response.status} — ${err}`);
      }

      // Convert image blob to base64 data URL
      const imageBlob = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBlob)));
      const contentType = response.headers.get('content-type') || 'image/png';
      result = {
        image: `data:${contentType};base64,${base64}`,
        model: modelId,
        prompt,
      };
    }

    // ── Summarization ────────────────────────────────────────────────────
    else if (taskType === 'summarization') {
      const text = typeof inputs === 'string' ? inputs : inputs.inputs || inputs.text;
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: text,
            parameters: {
              max_length: options?.max_length || 150,
              min_length: options?.min_length || 30,
            },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Summarization Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Sentiment Analysis / Text Classification ─────────────────────────
    else if (taskType === 'sentiment' || taskType === 'text-classification') {
      const text = typeof inputs === 'string' ? inputs : inputs.inputs || inputs.text;
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: text }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Classification Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Embeddings / Feature Extraction ───────────────────────────────────
    else if (taskType === 'embeddings' || taskType === 'feature-extraction') {
      const text = typeof inputs === 'string' ? inputs : inputs.inputs || inputs.text;
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: text }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Embedding Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Translation ──────────────────────────────────────────────────────
    else if (taskType === 'translation') {
      const text = typeof inputs === 'string' ? inputs : inputs.inputs || inputs.text;
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: text,
            parameters: {
              src_lang: options?.src_lang || 'en_XX',
              tgt_lang: options?.tgt_lang || 'fr_XX',
            },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Translation Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Text-to-Speech ──────────────────────────────────────────────────
    else if (taskType === 'text-to-speech') {
      const text = typeof inputs === 'string' ? inputs : inputs.inputs || inputs.text;
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: text }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF TTS Error: ${response.status} — ${err}`);
      }

      const audioBlob = await response.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(audioBlob)));
      const contentType = response.headers.get('content-type') || 'audio/wav';
      result = { data: `data:${contentType};base64,${base64}`, content_type: contentType };
    }

    // ── Zero-Shot Classification ─────────────────────────────────────────
    else if (taskType === 'zero-shot-classification') {
      const text = typeof inputs === 'string' ? inputs : inputs.inputs || inputs.text;
      const labels = inputs.parameters?.candidate_labels || options?.candidate_labels || ['positive', 'negative', 'neutral'];
      const zeroShotModel = model || 'facebook/bart-large-mnli';
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${zeroShotModel}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputs: text,
            parameters: { candidate_labels: labels },
          }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Zero-Shot Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Question Answering ───────────────────────────────────────────────
    else if (taskType === 'question-answering') {
      const question = inputs.question || (typeof inputs === 'string' ? inputs : '');
      const context = inputs.context || '';
      const qaModel = model || 'deepset/roberta-base-squad2';
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${qaModel}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: { question, context } }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF QA Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Image to Text (OCR / Captioning) ─────────────────────────────────
    else if (taskType === 'image-to-text') {
      const imageUrl = typeof inputs === 'string' ? inputs : inputs.url || inputs.image;
      const captionModel = model || 'Salesforce/blip-image-captioning-base';
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${captionModel}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: imageUrl }),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF Image-to-Text Error: ${response.status} — ${err}`);
      }
      result = await response.json();
    }

    // ── Generic / Raw model call ─────────────────────────────────────────
    else {
      const response = await fetch(
        `https://router.huggingface.co/hf-inference/models/${modelId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${hfToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(typeof inputs === 'string' ? { inputs } : inputs),
        }
      );

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`HF API Error: ${response.status} — ${err}`);
      }

      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        result = await response.json();
      } else {
        // Binary response (image/audio) — return base64
        const blob = await response.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(blob)));
        result = { data: `data:${ct};base64,${base64}`, content_type: ct };
      }
    }

    return new Response(JSON.stringify({ result, task: taskType, model: modelId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[hf-proxy] request failed', {
      name: error instanceof Error ? error.name : typeof error,
    });
    const message = error?.message || 'Internal error';
    // Pattern-match the per-task throws (`HF Chat Error: 401 — …`) into
    // structured codes so the client UI can show specific guidance.
    if (/\b401\b/.test(message)) {
      return errResponse(401, 'token_invalid',
        'HuggingFace rejected the API token. Generate a new one at https://huggingface.co/settings/tokens and update your saved Hugging Face key.');
    }
    if (/\b429\b/.test(message)) {
      return errResponse(429, 'token_rate_limited',
        'HuggingFace rate limit hit. Wait a minute and retry.');
    }
    if (/\b404\b/.test(message)) {
      return errResponse(404, 'model_not_found',
        'HuggingFace does not recognize that model.');
    }
    return errResponse(500, 'internal', 'Hugging Face request failed.');
  }
});
