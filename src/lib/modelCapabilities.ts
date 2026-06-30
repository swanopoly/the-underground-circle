/**
 * Model Capability Router
 *
 * Detects what the user wants (image, video, webpage, code, etc.)
 * and routes to the appropriate API based on the selected model.
 * Returns structured results with rendered artifacts.
 */

import { supabase } from './supabase';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS === 'true'
  ? process.env.EXPO_PUBLIC_GEMINI_API_KEY || ''
  : '';

// ── Model capability definitions ────────────────────────────────────────────

export type ModelCapability = 'text' | 'code' | 'image_gen' | 'image_understand' | 'video_gen' | 'audio_gen' | 'webpage_gen' | 'reasoning';

const MODEL_CAPABILITIES: Record<string, ModelCapability[]> = {
  // Image generation models
  'flux-schnell':        ['image_gen'],
  'flux-dev':            ['image_gen'],
  'stable-diffusion-xl': ['image_gen'],

  // Multimodal (text + image understanding + generation)
  'gpt-4o':                     ['text', 'code', 'image_understand', 'image_gen', 'webpage_gen'],
  'gemini-2.5-flash-preview':   ['text', 'code', 'image_understand', 'image_gen', 'webpage_gen'],
  'gemini-3.5-flash':           ['text', 'code', 'image_understand', 'reasoning', 'webpage_gen'],
  'gemini-3.1-pro-preview':     ['text', 'code', 'image_understand', 'reasoning', 'webpage_gen'],
  'gemini-3.1-flash-lite':      ['text', 'code', 'image_understand', 'webpage_gen'],
  'gemini-2.5-pro':             ['text', 'code', 'image_understand', 'reasoning', 'webpage_gen'],
  'gemini-2.5-flash':           ['text', 'code', 'image_understand', 'webpage_gen'],
  'gemini-2.5-flash-lite':      ['text', 'code', 'image_understand', 'webpage_gen'],

  // Coding models
  'claude-fable-5':      ['text', 'code', 'reasoning', 'webpage_gen'],
  'claude-opus-4-8':     ['text', 'code', 'reasoning', 'webpage_gen'],
  'claude-opus-4-7':     ['text', 'code', 'reasoning', 'webpage_gen'],
  'claude-opus-4-6':     ['text', 'code', 'reasoning', 'webpage_gen'],
  'claude-sonnet-4-6':   ['text', 'code', 'webpage_gen'],
  'claude-haiku-4-5':          ['text', 'code', 'webpage_gen'],
  'claude-haiku-4-5-20251001': ['text', 'code', 'webpage_gen'],
  'gpt-5.5-pro':         ['text', 'code', 'reasoning', 'webpage_gen'],
  'gpt-5.5':             ['text', 'code', 'reasoning', 'webpage_gen'],
  'gpt-5.4':             ['text', 'code', 'reasoning', 'webpage_gen'],
  'gpt-5.4-mini':        ['text', 'code', 'reasoning', 'webpage_gen'],
  'gpt-5.4-nano':        ['text', 'code'],
  'codex-mini':          ['text', 'code'],
  'deepseek-v3.2':       ['text', 'code'],
  'qwen-3.5-coder':      ['text', 'code'],

  // Reasoning
  'deepseek-r1': ['text', 'reasoning', 'code'],
  'sonar-deep-research': ['text', 'reasoning'],
  'sonar-reasoning-pro': ['text', 'reasoning'],
  'sonar-pro': ['text', 'reasoning'],

  // Speed
  'gpt-4.1-nano':   ['text', 'code'],
  'qwen-3.5-flash': ['text', 'code'],

  // Open Source
  'llama-4-scout':    ['text', 'code'],
  'llama-4-maverick': ['text', 'code', 'reasoning'],
  'qwen-3.5-plus':    ['text', 'code'],
  'mistral-large-3':  ['text', 'code'],
  'deepseek-v3':      ['text', 'code'],
};

export function getModelCapabilities(modelId: string): ModelCapability[] {
  return MODEL_CAPABILITIES[modelId] || ['text'];
}

export function modelCanDo(modelId: string, cap: ModelCapability): boolean {
  return getModelCapabilities(modelId).includes(cap);
}

// ── Intent detection ────────────────────────────────────────────────────────

export type UserIntent =
  | 'image_gen'
  | 'webpage_gen'
  | 'code_gen'
  | 'video_gen'
  | 'audio_gen'
  | 'text';

const IMAGE_PATTERNS = [
  /\b(generate|create|make|draw|paint|design|render|show me)\b.*(image|picture|photo|illustration|artwork|icon|logo|avatar|banner|thumbnail|poster|meme|wallpaper|sprite|pixel art)/i,
  /\b(image|picture|photo|illustration|artwork|logo|icon|banner|poster|meme)\b/i,
  /\bimagine\b/i,
  /\b(visuali[sz]e|depict|sketch|portrait)\b/i,
  /\b(generate|create|make|draw|paint|render)\b.*\b(best|cool|beautiful|stunning|epic|amazing)/i,
];

// WEBPAGE_PATTERNS is intentionally empty. This detector used to auto-fire
// `generateWebpage` on any natural-language "build a landing page" message,
// which short-circuited the conversational build orchestrator (see
// src/lib/conversationalBuild.ts) before it ever got a chance to run.
// Build intent now lives in ONE place: the orchestrator. Explicit slash
// commands (/build-page, /build, /code) still fire directly via their
// dedicated handlers in ChatTab.tsx.
const WEBPAGE_PATTERNS: RegExp[] = [];

const CODE_PATTERNS = [
  /\b(write|create|build|generate|make)\b.*(function|class|component|script|code|api|endpoint|module|utility|hook|test)/i,
  /\b(refactor|optimize|debug|fix)\b.*(code|function|component|bug)/i,
  /\bcode\b.*\b(for|that|to|which)\b/i,
];

const VIDEO_PATTERNS = [
  /\b(generate|create|make)\b.*(video|animation|clip|gif|motion)/i,
  /\b(animate|video of)\b/i,
];

const AUDIO_PATTERNS = [
  /\b(generate|create|make|speak|say|read|narrate)\b.*(audio|speech|voice|sound|music|tts|text.to.speech)/i,
  /\b(say this|read this|speak this)\b/i,
];

export function detectIntent(message: string, modelId: string): UserIntent {
  // If an image-capable model is selected (especially image-only), assume image intent
  const caps = getModelCapabilities(modelId);
  const isImageModel = caps.includes('image_gen');
  const isImageOnlyModel = isImageModel && caps.length === 1;

  // Image-only model: every message is an image prompt
  if (isImageOnlyModel) return 'image_gen';

  // Image-capable model + message mentions anything image-related
  if (isImageModel && IMAGE_PATTERNS.some(p => p.test(message))) return 'image_gen';

  // Any model: detect intent from message
  if (IMAGE_PATTERNS.some(p => p.test(message))) return 'image_gen';
  if (VIDEO_PATTERNS.some(p => p.test(message))) return 'video_gen';
  if (AUDIO_PATTERNS.some(p => p.test(message))) return 'audio_gen';
  if (WEBPAGE_PATTERNS.some(p => p.test(message))) return 'webpage_gen';
  if (CODE_PATTERNS.some(p => p.test(message))) return 'code_gen';
  return 'text';
}

// ── Best model picker for auto mode ─────────────────────────────────────────

export function pickBestModel(intent: UserIntent): string {
  switch (intent) {
    case 'image_gen': return 'flux-schnell';
    case 'webpage_gen': return 'gemini-2.5-flash';
    case 'code_gen': return 'auto'; // keep default AI path
    case 'video_gen': return 'auto';
    case 'audio_gen': return 'auto';
    case 'text': return 'auto';
  }
}

// ── Capability result type ──────────────────────────────────────────────────

export interface CapabilityResult {
  handled: boolean;
  response: string;
  artifacts?: Array<{
    kind: 'image' | 'webpage' | 'code' | 'video' | 'audio' | 'summary';
    title: string;
    content?: string;
    url?: string;
    html?: string;
    metadata?: Record<string, unknown>;
  }>;
}

// ── Image Generation via HF Inference API ───────────────────────────────────

async function generateImageHF(prompt: string, model: string): Promise<{ url: string } | null> {
  const hfModelMap: Record<string, string> = {
    'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
    'flux-dev': 'black-forest-labs/FLUX.1-dev',
    'stable-diffusion-xl': 'stabilityai/stable-diffusion-xl-base-1.0',
  };

  const hfModel = hfModelMap[model];
  if (!hfModel) return null;

  try {
    console.log(`[ImageGen] Calling HF model: ${hfModel} with prompt: "${prompt.slice(0, 80)}"`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    const resp = await fetch(`https://api-inference.huggingface.co/models/${hfModel}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.warn(`[ImageGen] HF returned ${resp.status} for ${hfModel}`);
      // 503 = model loading, try waiting and retrying once
      if (resp.status === 503) {
        const body = await resp.json().catch(() => ({}));
        const wait = (body as any)?.estimated_time || 10;
        console.log(`[ImageGen] Model loading, waiting ${Math.min(wait, 20)}s...`);
        await new Promise(r => setTimeout(r, Math.min(wait, 20) * 1000));
        const retry = await fetch(`https://api-inference.huggingface.co/models/${hfModel}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: prompt }),
          signal: AbortSignal.timeout(30000),
        });
        if (retry.ok) {
          const blob = await retry.blob();
          return { url: URL.createObjectURL(blob) };
        }
      }
      return null;
    }

    // HF returns binary image data
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.startsWith('image/')) {
      const blob = await resp.blob();
      return { url: URL.createObjectURL(blob) };
    }
    // Sometimes HF returns JSON error even with 200
    console.warn('[ImageGen] HF returned non-image content type:', contentType);
    return null;
  } catch (e) {
    console.warn('[ImageGen] HF error:', e);
    return null;
  }
}

// ── Image Generation via Gemini ─────────────────────────────────────────────

async function generateImageGemini(prompt: string): Promise<{ url: string; text?: string } | null> {
  if (!GEMINI_API_KEY) return null;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Generate an image: ${prompt}` }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
      }
    );

    if (!resp.ok) return null;
    const data = await resp.json();

    const parts = data?.candidates?.[0]?.content?.parts || [];
    let imageUrl = '';
    let textResp = '';

    for (const part of parts) {
      if (part.inlineData?.mimeType?.startsWith('image/')) {
        const b64 = part.inlineData.data;
        imageUrl = `data:${part.inlineData.mimeType};base64,${b64}`;
      }
      if (part.text) textResp += part.text;
    }

    if (imageUrl) return { url: imageUrl, text: textResp };
    return null;
  } catch {
    return null;
  }
}

// ── Webpage Generation via Gemini ───────────────────────────────────────────

async function generateWebpage(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `You are a web developer. Generate a complete, self-contained HTML page with inline CSS and JavaScript based on this request: "${prompt}"\n\nRequirements:\n- Single HTML file, all CSS/JS inline\n- Modern, dark theme design\n- Responsive layout\n- Use modern CSS (flexbox/grid)\n- Make it visually impressive\n- Return ONLY the HTML code, no markdown fences, no explanation before or after`,
            }],
          }],
          generationConfig: { maxOutputTokens: 8192, temperature: 0.7 },
        }),
      }
    );

    if (!resp.ok) return null;
    const data = await resp.json();
    let html = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip markdown fences if present
    html = html.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();
    if (html.includes('<html') || html.includes('<!DOCTYPE') || html.includes('<body')) {
      return html;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main router ─────────────────────────────────────────────────────────────

export async function routeByCapability(
  message: string,
  modelId: string,
): Promise<CapabilityResult> {
  const intent = detectIntent(message, modelId);
  const effectiveModel = modelId === 'auto' ? pickBestModel(intent) : modelId;

  // ── Image Generation ──────────────────────────────────────────────────────
  if (intent === 'image_gen') {
    const imagePrompt = message
      .replace(/^(generate|create|make|draw|paint|design|render|show me|imagine)\s*/i, '')
      .replace(/\b(an?|the)\s+(image|picture|photo|illustration|artwork)\s*(of|for|with|showing)?\s*/i, '')
      .trim() || message;

    // Try HF first for dedicated image models
    if (['flux-schnell', 'flux-dev', 'stable-diffusion-xl'].includes(effectiveModel)) {
      const hfResult = await generateImageHF(imagePrompt, effectiveModel);
      if (hfResult) {
        return {
          handled: true,
          response: `Generated with ${effectiveModel}`,
          artifacts: [{
            kind: 'image',
            title: imagePrompt.slice(0, 60),
            url: hfResult.url,
            metadata: { model: effectiveModel, prompt: imagePrompt },
          }],
        };
      }
    }

    // Fallback to Gemini image gen
    const geminiResult = await generateImageGemini(imagePrompt);
    if (geminiResult) {
      return {
        handled: true,
        response: geminiResult.text || `Generated image for: "${imagePrompt.slice(0, 80)}"`,
        artifacts: [{
          kind: 'image',
          title: imagePrompt.slice(0, 60),
          url: geminiResult.url,
          metadata: { model: 'gemini-2.0-flash-exp', prompt: imagePrompt },
        }],
      };
    }

    // All image gen APIs failed — still handle it so text AI doesn't give a canned "I can't" response
    return {
      handled: true,
      response: `Image generation is temporarily unavailable. The model "${effectiveModel}" didn't respond. Try again in a moment, or switch to a different image model (Flux Schnell, Flux Dev, or Stable Diffusion XL).`,
    };
  }

  // ── Webpage Generation ────────────────────────────────────────────────────
  if (intent === 'webpage_gen') {
    const html = await generateWebpage(message);
    if (html) {
      return {
        handled: true,
        response: `Built a web page for you. Click to preview it live.`,
        artifacts: [{
          kind: 'webpage',
          title: message.slice(0, 60),
          html,
          metadata: { model: 'gemini-2.5-flash', prompt: message },
        }],
      };
    }
    return { handled: false, response: '' };
  }

  // ── Video Generation (placeholder — describe intent) ──────────────────────
  if (intent === 'video_gen') {
    return { handled: false, response: '' };
  }

  // ── Audio Generation (placeholder) ────────────────────────────────────────
  if (intent === 'audio_gen') {
    return { handled: false, response: '' };
  }

  // ── Everything else — pass through to normal AI ───────────────────────────
  return { handled: false, response: '' };
}
