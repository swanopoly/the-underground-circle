/**
 * hf-proxy — Supabase Edge Function
 *
 * Multi-task Hugging Face inference proxy.
 * Supports: chat, text-to-image, summarization, sentiment, embeddings,
 * speech-to-text, translation, and raw Space invocation.
 *
 * Uses the new HF Inference Providers router (router.huggingface.co).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const hfToken = Deno.env.get('HF_TOKEN');
    if (!hfToken) throw new Error('HF_TOKEN not set');

    const body = await req.json();
    const { task, model, inputs, toolId, circleId, options } = body;

    // If toolId is provided, verify access via RLS
    if (toolId) {
      const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
      );

      const { data: tool, error: toolError } = await supabaseClient
        .from('circle_hf_tools')
        .select('*')
        .eq('id', toolId)
        .single();

      if (toolError || !tool) {
        throw new Error('Tool not found or access denied');
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
    console.error('hf-proxy error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
