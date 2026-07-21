/**
 * Model Capability Router
 *
 * Detects what the user wants (image, video, webpage, code, etc.)
 * and routes to the appropriate API based on the selected model.
 * Returns structured results with rendered artifacts.
 */

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

// ── Model id normalization ──────────────────────────────────────────────────
//
// Model ids arrive provider-prefixed from the marketplace/router surfaces
// (`openrouter/anthropic/claude-sonnet-4-6`, `google_ai/gemini-2.5-pro`,
// `huggingface_endpoint/cswan801/BlackSwan-v5`, ...). This normalizer strips
// those routing prefixes down to the bare model id so capability lookups key
// on one canonical form. It mirrors the prefix/alias treatment in
// src/lib/crossProviderRouter.ts (`providerFromModelPrefix`: heads are exact
// segment matches; `hugging_face` -> `huggingface`, `z_ai` -> `zai`) — keep
// the two in agreement when adding providers.

/** Routing/provider heads that get stripped. Includes the underscore/hyphen
 *  alias spellings so `hugging_face/x` === `huggingface/x` and
 *  `z_ai/x` === `zai/x`. */
const PROVIDER_PREFIX_HEADS = new Set<string>([
  'openrouter',
  'openai', 'openai_compatible',
  'anthropic',
  'google_ai', 'googleai', 'google',
  'deepseek',
  'huggingface', 'huggingface_endpoint', 'hugging_face', 'hf',
  'groq',
  'mistral', 'mistral_ai', 'mistralai',
  'cohere',
  'perplexity',
  'together', 'together_ai',
  'fireworks', 'fireworks_ai',
  'zai', 'z_ai',
  'minimax',
  'ollama',
  'github', 'github-models', 'github_models',
  'replicate',
  'openswan',
  // Vendor/org heads seen inside OpenRouter/HF-style ids.
  'meta-llama', 'deepseek-ai', 'qwen', 'black-forest-labs', 'stabilityai',
  'moonshotai', 'x-ai', 'z-ai', 'minimaxai',
]);

/**
 * Canonicalize a model id for capability lookup:
 *  - trims and lowercases,
 *  - iteratively strips known provider/vendor prefix segments
 *    (`openrouter/anthropic/claude-sonnet-4-6` -> `claude-sonnet-4-6`),
 *  - treats alias heads identically (`hugging_face` -> `huggingface`,
 *    `z_ai` -> `zai`) because both spellings are in the strip set.
 * Unknown heads (e.g. a HF org like `cswan801/`) are preserved so distinct
 * models never collapse into each other.
 */
export function normalizeModelId(modelId: string): string {
  let id = (modelId || '').trim().toLowerCase();
  if (!id) return '';
  // Iteratively strip known heads; each pass shortens the string.
  for (;;) {
    const slashIdx = id.indexOf('/');
    if (slashIdx <= 0) break;
    const head = id.slice(0, slashIdx);
    const rest = id.slice(slashIdx + 1);
    if (!rest || !PROVIDER_PREFIX_HEADS.has(head)) break;
    id = rest;
  }
  return id;
}

export function getModelCapabilities(modelId: string): ModelCapability[] {
  // Exact key first (back-compat), then the normalized form so
  // provider-prefixed ids resolve to the same registry entry.
  return MODEL_CAPABILITIES[modelId]
    || MODEL_CAPABILITIES[normalizeModelId(modelId)]
    || ['text'];
}

export function modelCanDo(modelId: string, cap: ModelCapability): boolean {
  return getModelCapabilities(modelId).includes(cap);
}

// ── Per-model capability flags ───────────────────────────────────────────────
//
// Boolean gates any layer can use to decide "can this model tool / see /
// drive a computer" without re-deriving it from ModelCapability arrays.
// UNKNOWN ids fail closed: no tool use, no computer use, no vision.

/**
 * Coding-capability tier (coding-agent P5). Expresses how trustworthy a model
 * is at AGENTIC CODE WORK — precise multi-file edits, tool-driven
 * build/debug/review loops — independent of the coarse 'code' capability
 * string (which nearly every text model carries).
 *   'strong' — frontier-coder class; safe as the PLANNER for complex coding
 *              and as an executor.
 *   'basic'  — fine for small/mechanical edits and as a fast EXECUTOR driving
 *              a strong model's plan; don't plan complex changes here.
 *   'none'   — never route coding work here (fail-closed default).
 * Note: codingTier is about code QUALITY — a 'strong' no-tool reasoner (e.g.
 * deepseek-r1) can plan but not execute; executors also need `toolUse`.
 */
export type ModelCodingTier = 'none' | 'basic' | 'strong';

export interface ModelCapabilityFlags {
  /** Model reliably supports structured tool/function calling. */
  toolUse: boolean;
  /** Model can drive the native Anthropic computer-use screenshot/action
   *  loop. Only Sonnet-capable Claude models qualify (edge-loop requirement
   *  in supabase/functions/computer-use-agent). */
  computerUse: boolean;
  /** Model accepts image inputs. */
  vision: boolean;
  /** Model supports token streaming. */
  streaming: boolean;
  /** Image-generation-only model — no chat/tool loop at all. */
  imageOnly: boolean;
  /** Conservative known-safe max output tokens (a floor, not the provider
   *  ceiling), or null when we have no verified number. */
  maxOutputTokens: number | null;
  /** Agentic-coding trust tier — see ModelCodingTier. Fail-closed 'none'. */
  codingTier: ModelCodingTier;
}

/** Fail-closed defaults for ids we do not recognize. */
export const UNKNOWN_MODEL_CAPABILITY_FLAGS: ModelCapabilityFlags = Object.freeze({
  toolUse: false,
  computerUse: false,
  vision: false,
  streaming: true,
  imageOnly: false,
  maxOutputTokens: null,
  codingTier: 'none',
});

function flagSet(partial: Partial<ModelCapabilityFlags>): ModelCapabilityFlags {
  return { ...UNKNOWN_MODEL_CAPABILITY_FLAGS, ...partial };
}

const IMAGE_ONLY_FLAGS = flagSet({ imageOnly: true, streaming: false });
const TOOL_CHAT_FLAGS = flagSet({ toolUse: true, codingTier: 'basic' });
const TOOL_VISION_FLAGS = flagSet({ toolUse: true, vision: true, codingTier: 'basic' });
/** Sonnet-capable Claude: full loop incl. native computer use. */
const CLAUDE_SONNET_FLAGS = flagSet({ toolUse: true, vision: true, computerUse: true, maxOutputTokens: 8192, codingTier: 'strong' });
/** Opus/Fable Claude tiers: tools + vision, frontier coders, no computer-use loop. */
const CLAUDE_CHAT_FLAGS = flagSet({ toolUse: true, vision: true, maxOutputTokens: 8192, codingTier: 'strong' });
/** Haiku-class Claude: fast tool executor — basic coding tier. */
const CLAUDE_FAST_FLAGS = flagSet({ toolUse: true, vision: true, maxOutputTokens: 8192, codingTier: 'basic' });
const GEMINI_FLAGS = flagSet({ toolUse: true, vision: true, maxOutputTokens: 8192, codingTier: 'basic' });
/** Gemini pro line: frontier coder. */
const GEMINI_PRO_FLAGS = flagSet({ toolUse: true, vision: true, maxOutputTokens: 8192, codingTier: 'strong' });
/** Perplexity sonar: search-grounded text, no function calling. */
const SONAR_FLAGS = flagSet({});
/** Strong coder over the plain tool-chat base (OpenAI/DeepSeek/Qwen coders). */
const STRONG_CODER_TOOL_FLAGS = flagSet({ toolUse: true, codingTier: 'strong' });
const STRONG_CODER_VISION_FLAGS = flagSet({ toolUse: true, vision: true, codingTier: 'strong' });

/** Explicit per-model flags, keyed by normalizeModelId() output. */
const MODEL_CAPABILITY_FLAGS: Record<string, ModelCapabilityFlags> = {
  // Image generation (imageOnly, never tool-loop)
  'flux-schnell':        IMAGE_ONLY_FLAGS,
  'flux-dev':            IMAGE_ONLY_FLAGS,
  'stable-diffusion-xl': IMAGE_ONLY_FLAGS,

  // BlackSwan-v5 (app-trained Qwen; P8) — now registered DELIBERATELY with
  // the same fail-closed tool/vision posture the unknown-default gave it by
  // accident, plus streaming:false (llm-proxy buffers HF responses and
  // Anthropic-native streaming never applies). Tool/computer work never
  // routes here — the Auto lane guards + executor swap own that guarantee.
  // One normalized key covers huggingface/…, huggingface_endpoint/…, and
  // the bare repo id.
  'cswan801/blackswan-v5': flagSet({ streaming: false }),

  // Anthropic
  'claude-sonnet-4-6':   CLAUDE_SONNET_FLAGS,
  'claude-fable-5':      CLAUDE_CHAT_FLAGS,
  'claude-opus-4-8':     CLAUDE_CHAT_FLAGS,
  'claude-opus-4-7':     CLAUDE_CHAT_FLAGS,
  'claude-opus-4-6':     CLAUDE_CHAT_FLAGS,
  'claude-haiku-4-5':          CLAUDE_FAST_FLAGS,
  'claude-haiku-4-5-20251001': CLAUDE_FAST_FLAGS,

  // OpenAI
  'gpt-4o':        TOOL_VISION_FLAGS,
  'gpt-5.5-pro':   STRONG_CODER_VISION_FLAGS,
  'gpt-5.5':       STRONG_CODER_VISION_FLAGS,
  'gpt-5.4':       STRONG_CODER_VISION_FLAGS,
  'gpt-5.4-mini':  TOOL_VISION_FLAGS,
  'gpt-5.4-nano':  TOOL_CHAT_FLAGS,
  'gpt-4.1-nano':  TOOL_VISION_FLAGS,
  'codex-mini':    STRONG_CODER_TOOL_FLAGS,

  // Google
  'gemini-3.5-flash':         GEMINI_FLAGS,
  'gemini-3.1-pro-preview':   GEMINI_PRO_FLAGS,
  'gemini-3.1-flash-lite':    GEMINI_FLAGS,
  'gemini-2.5-pro':           GEMINI_PRO_FLAGS,
  'gemini-2.5-flash':         GEMINI_FLAGS,
  'gemini-2.5-flash-lite':    GEMINI_FLAGS,
  'gemini-2.5-flash-preview': GEMINI_FLAGS,

  // DeepSeek — chat/v3 line supports function calling; the r1 reasoner
  // line does not, so it stays fail-closed on toolUse. Both lines are
  // frontier-class coders (r1 = strong PLANNER, no tools → never executor).
  'deepseek-v3':   STRONG_CODER_TOOL_FLAGS,
  'deepseek-v3.2': STRONG_CODER_TOOL_FLAGS,
  'deepseek-r1':   flagSet({ codingTier: 'strong' }),

  // Moonshot Kimi — K3 is a 1M-context multimodal reasoning flagship (tool +
  // vision + strong coding); K2.7 Code is a strong coder; K2.6 is general
  // tool-capable chat. The `^kimi` family fallback below keeps any future
  // Kimi variant tool-capable rather than fail-closed to text-only.
  'kimi-k3':          STRONG_CODER_VISION_FLAGS,
  'kimi-k2.7-code':   STRONG_CODER_TOOL_FLAGS,
  'kimi-k2.6':        TOOL_CHAT_FLAGS,

  // Mistral / Qwen / Llama (Groq-hosted etc.)
  'mistral-large-3':  TOOL_CHAT_FLAGS,
  'qwen-3.5-coder':   STRONG_CODER_TOOL_FLAGS,
  'qwen-3.5-flash':   TOOL_CHAT_FLAGS,
  'qwen-3.5-plus':    TOOL_CHAT_FLAGS,
  'llama-4-scout':    TOOL_VISION_FLAGS,
  'llama-4-maverick': TOOL_VISION_FLAGS,

  // Perplexity sonar — search answers, no tool loop.
  'sonar-pro':           SONAR_FLAGS,
  'sonar-reasoning-pro': SONAR_FLAGS,
  'sonar-deep-research': SONAR_FLAGS,
};

/** Family fallbacks for ids not in the explicit table (dated snapshots,
 *  provider variants). Ordered: first match wins; image-only families are
 *  checked before chat families. Anything unmatched stays fail-closed. */
const FAMILY_FLAG_PATTERNS: Array<{ pattern: RegExp; flags: ModelCapabilityFlags }> = [
  { pattern: /(^|[-_/.])(flux|sdxl|dall-e|dalle)([-_/.\d]|$)|stable-diffusion|(^|[-_/.])imagen([-_/.\d]|$)/, flags: IMAGE_ONLY_FLAGS },
  { pattern: /^claude-sonnet\b/,                 flags: CLAUDE_SONNET_FLAGS },
  { pattern: /^claude-(opus|fable)\b/,           flags: CLAUDE_CHAT_FLAGS },
  { pattern: /^claude-haiku\b/,                  flags: CLAUDE_FAST_FLAGS },
  { pattern: /^(gpt-4o|gpt-4\.1|gpt-5)/,         flags: TOOL_VISION_FLAGS },
  { pattern: /^gemini-/,                         flags: GEMINI_FLAGS },
  { pattern: /^(deepseek-v|deepseek-chat)/,      flags: TOOL_CHAT_FLAGS },
  { pattern: /^(mistral|ministral|magistral)-/,  flags: TOOL_CHAT_FLAGS },
  { pattern: /^llama-4/,                         flags: TOOL_VISION_FLAGS },
  { pattern: /^llama-3/,                         flags: TOOL_CHAT_FLAGS },
  { pattern: /^qwen/,                            flags: TOOL_CHAT_FLAGS },
  { pattern: /^kimi/,                            flags: TOOL_VISION_FLAGS },
  { pattern: /^glm-/,                            flags: TOOL_CHAT_FLAGS },
  { pattern: /^minimax-/,                        flags: TOOL_CHAT_FLAGS },
  { pattern: /^sonar\b/,                         flags: SONAR_FLAGS },
];

/**
 * Per-model capability flags for routing decisions. Accepts raw or
 * provider-prefixed ids (normalized internally). Unknown ids return the
 * conservative fail-closed defaults ({toolUse:false, computerUse:false,
 * vision:false, streaming:true, imageOnly:false, maxOutputTokens:null}).
 * Always returns a fresh object — safe for callers to mutate.
 */
export function getModelCapabilityFlags(modelId: string): ModelCapabilityFlags {
  const norm = normalizeModelId(modelId);
  if (!norm) return { ...UNKNOWN_MODEL_CAPABILITY_FLAGS };
  const exact = MODEL_CAPABILITY_FLAGS[norm];
  if (exact) return { ...exact };
  for (const family of FAMILY_FLAG_PATTERNS) {
    if (family.pattern.test(norm)) return { ...family.flags };
  }
  return { ...UNKNOWN_MODEL_CAPABILITY_FLAGS };
}

/** Convenience accessor for the coding tier (coding-agent P5). Fail-closed 'none'. */
export function getModelCodingTier(modelId: string): ModelCodingTier {
  return getModelCapabilityFlags(modelId).codingTier;
}

// ── Intent detection ────────────────────────────────────────────────────────

export type UserIntent =
  | 'image_gen'
  | 'webpage_gen'
  | 'code_gen'
  | 'video_gen'
  | 'audio_gen'
  | 'text';

// Image intent must be imperative (verb + image noun) or slash-command-style.
// Bare mentions of "photo"/"logo"/"imagine" in ordinary text used to hijack
// the whole turn into image generation before the selected model ever ran.
const IMAGE_PATTERNS = [
  /\b(generate|create|make|draw|paint|design|render|show me)\b.*(image|picture|photo|illustration|artwork|icon|logo|avatar|banner|thumbnail|poster|meme|wallpaper|sprite|pixel art)/i,
  /^\/?(imagine|image)\s/i,
  /\b(image|picture|photo|illustration|artwork) of\b/i,
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
  /**
   * Set when a capability lane was attempted but ALL its backends failed and
   * the result deliberately stays handled:false so the normal tiered chat
   * path recovers. Callers should show this one-liner (backend names + plain
   * next action, never key material) so the user learns why no image/page
   * artifact arrived instead of silently getting a text-only answer.
   */
  fallbackNotice?: string;
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
    const attemptedImageBackends: string[] = [];
    if (['flux-schnell', 'flux-dev', 'stable-diffusion-xl'].includes(effectiveModel)) {
      attemptedImageBackends.push(effectiveModel);
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
    if (GEMINI_API_KEY) attemptedImageBackends.push('Gemini image gen');
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

    // All image gen APIs failed — return handled:false so the caller's
    // normal tiered path recovers with the user's selected model instead of
    // rendering a dead-end "temporarily unavailable" bubble. The notice tells
    // the user WHY no image is coming (backend names only, never keys) with a
    // plain next action.
    const fallbackNotice = attemptedImageBackends.length > 0
      ? `Image generation didn't work just now (${attemptedImageBackends.join(' and ')} failed), so I'll answer in text instead. Try again in a minute, or pick a different image model.`
      : `Image generation isn't set up yet (no image backend is configured), so I'll answer in text instead. Add a Google AI key in Marketplace to enable it.`;
    return { handled: false, response: '', fallbackNotice };
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
