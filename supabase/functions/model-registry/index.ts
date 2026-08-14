import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { getAuthenticatedUser, isServiceRoleRequest } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface ModelEntry {
  provider: string;
  model_id: string;
  label: string;
  category: 'chat' | 'reasoning' | 'code' | 'image' | 'embedding' | 'audio' | 'other';
  tier: 'frontier' | 'mid' | 'budget' | 'free';
  input_cost_per_m: number;   // per 1M input tokens
  output_cost_per_m: number;  // per 1M output tokens
  context_window: number;
  supports_vision: boolean;
  supports_tools: boolean;
  released_at: string | null;
  is_active: boolean;
  api_compatible: string;     // 'openai' | 'google' | 'anthropic' | 'huggingface'
  last_verified_at: string;
}

// ─── Provider Fetchers ──────────────────────────────────────────────────────

async function fetchOpenAIModels(apiKey: string): Promise<ModelEntry[]> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();

    // Filter to chat-relevant models only
    const CHAT_PREFIXES = ['gpt-4', 'gpt-5', 'chatgpt', 'o3'];
    const SKIP_PATTERNS = ['realtime', 'audio', 'tts', 'whisper', 'dall-e', 'davinci', 'babbage', 'embedding', 'moderation', 'search', 'instruct-preview'];
    const RETIRED = new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-nano', 'o3-mini', 'o4-mini']);

    const now = new Date().toISOString();
    const models: ModelEntry[] = [];

    for (const m of data.data || []) {
      const id = m.id as string;
      // Skip non-chat models
      if (SKIP_PATTERNS.some(p => id.includes(p))) continue;
      if (!CHAT_PREFIXES.some(p => id.startsWith(p))) continue;
      if (RETIRED.has(id)) continue;
      // Skip dated snapshots (keep the alias)
      if (/\d{4}-\d{2}-\d{2}$/.test(id)) continue;

      const isReasoning = id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') || id === 'gpt-5.6-sol';
      const isCode = id.includes('codex');
      const isMini = id.includes('mini');
      const isNano = id.includes('nano');
      const isLuna = id === 'gpt-5.6-luna';
      const isTerra = id === 'gpt-5.6-terra';
      const isFrontier = id.includes('gpt-5') || id === 'o3' || id === 'o3-pro';

      models.push({
        provider: 'openai',
        model_id: id,
        label: formatOpenAILabel(id),
        category: isCode ? 'code' : isReasoning ? 'reasoning' : 'chat',
        tier: isLuna ? 'budget' : isTerra ? 'mid' : isFrontier ? 'frontier' : (isMini || isNano) ? 'budget' : 'mid',
        input_cost_per_m: estimateOpenAICost(id, 'input'),
        output_cost_per_m: estimateOpenAICost(id, 'output'),
        context_window: id.includes('gpt-5.6') ? 1050000 : id.includes('gpt-4.1') ? 1000000 : id.includes('gpt-5') ? 1000000 : 128000,
        supports_vision: id.includes('gpt-5.6') ? true : !isReasoning && !isCode,
        supports_tools: true,
        released_at: m.created ? new Date(m.created * 1000).toISOString() : null,
        is_active: true,
        api_compatible: 'openai',
        last_verified_at: now,
      });
    }
    return models;
  } catch (e) {
    console.error('OpenAI fetch error:', e);
    return [];
  }
}

function formatOpenAILabel(id: string): string {
  return id
    .replace('gpt-', 'GPT-')
    .replace('-mini', ' Mini')
    .replace('-nano', ' Nano')
    .replace('-pro', ' Pro')
    .replace('o1', 'O1')
    .replace('o3', 'O3')
    .replace('o4', 'O4');
}

function estimateOpenAICost(id: string, type: 'input' | 'output'): number {
  // Exact current production tiers first; broad family fallbacks come later.
  if (id === 'gpt-5.6-sol') return type === 'input' ? 5.00 : 30.00;
  if (id === 'gpt-5.6-terra') return type === 'input' ? 2.50 : 15.00;
  if (id === 'gpt-5.6-luna') return type === 'input' ? 1.00 : 6.00;
  if (id === 'gpt-5.5-pro') return type === 'input' ? 30.00 : 180.00;
  if (id === 'gpt-5.5') return type === 'input' ? 5.00 : 30.00;
  if (id === 'gpt-5.4') return type === 'input' ? 2.50 : 15.00;
  if (id === 'gpt-5.4-mini') return type === 'input' ? 0.75 : 4.50;
  if (id === 'gpt-5.4-nano') return type === 'input' ? 0.20 : 1.20;
  if (id.includes('nano')) return type === 'input' ? 0.10 : 0.40;
  if (id.includes('mini') && id.includes('4o')) return type === 'input' ? 0.15 : 0.60;
  if (id.includes('mini') && id.includes('4.1')) return type === 'input' ? 0.40 : 1.60;
  if (id.includes('mini')) return type === 'input' ? 0.40 : 1.60;
  if (id.includes('gpt-4o') && !id.includes('mini')) return type === 'input' ? 2.50 : 10.00;
  if (id.includes('gpt-4.1') && !id.includes('mini')) return type === 'input' ? 2.00 : 8.00;
  if (id.includes('gpt-5')) return type === 'input' ? 5.00 : 30.00;
  if (id === 'o3-pro') return type === 'input' ? 20.00 : 80.00;
  if (id === 'o3') return type === 'input' ? 10.00 : 40.00;
  if (id.includes('o4-mini') || id.includes('o3-mini')) return type === 'input' ? 1.10 : 4.40;
  if (id === 'o1') return type === 'input' ? 15.00 : 60.00;
  return type === 'input' ? 2.50 : 10.00;
}

async function fetchGeminiModels(apiKey: string): Promise<ModelEntry[]> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (!res.ok) return [];
    const data = await res.json();

    const CHAT_PATTERNS = ['gemini'];
    const SKIP = ['embedding', 'aqa', 'text-'];
    const RETIRED = new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview']);
    const now = new Date().toISOString();
    const models: ModelEntry[] = [];
    const seen = new Set<string>();

    for (const m of data.models || []) {
      const fullName = m.name as string; // "models/gemini-2.5-flash"
      const id = fullName.replace('models/', '');

      if (SKIP.some(p => id.includes(p))) continue;
      if (!CHAT_PATTERNS.some(p => id.includes(p))) continue;
      if (RETIRED.has(id)) continue;
      if (Array.isArray(m.supportedGenerationMethods) && !m.supportedGenerationMethods.includes('generateContent')) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      const isPro = id.includes('pro');
      const isLite = id.includes('lite');

      const [inputCost, outputCost] = estimateGeminiCost(id);
      models.push({
        provider: 'google',
        model_id: id,
        label: formatGeminiLabel(id),
        category: id.includes('image') ? 'image' : 'chat',
        tier: isPro ? 'frontier' : isLite ? 'budget' : 'mid',
        input_cost_per_m: inputCost,
        output_cost_per_m: outputCost,
        context_window: m.inputTokenLimit || 1000000,
        supports_vision: m.supportedGenerationMethods?.includes('generateContent') ?? true,
        supports_tools: !id.includes('image'),
        released_at: null,
        is_active: true,
        api_compatible: 'google',
        last_verified_at: now,
      });
    }
    return models;
  } catch (e) {
    console.error('Gemini fetch error:', e);
    return [];
  }
}

function formatGeminiLabel(id: string): string {
  return id
    .replace('gemini-', 'Gemini ')
    .replace('-preview', ' (Preview)')
    .replace('-flash', ' Flash')
    .replace('-pro', ' Pro')
    .replace('-lite', ' Lite')
    .split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
    .replace(/\s+/g, ' ').trim();
}

function estimateGeminiCost(id: string): [number, number] {
  if (id === 'gemini-3.6-flash') return [1.50, 7.50];
  if (id === 'gemini-3.5-flash-lite') return [0.30, 2.50];
  if (id.includes('lite')) return [0.25, 0.50];
  if (id.includes('flash')) return [0.15, 0.60];
  if (id.includes('pro')) return [1.25, 10.00];
  return [0.50, 2.00];
}

async function fetchHuggingFaceModels(): Promise<ModelEntry[]> {
  try {
    const res = await fetch(
      'https://huggingface.co/api/models?sort=trending&filter=text-generation&limit=50',
      { headers: { 'Accept': 'application/json' } }
    );
    if (!res.ok) return [];
    const data = await res.json();

    // Only include models available via HF Inference API
    const RELEVANT_ORGS = ['meta-llama', 'Qwen', 'mistralai', 'google', 'deepseek-ai', 'microsoft', 'nvidia', 'alibaba'];
    const MIN_DOWNLOADS = 10000;
    const now = new Date().toISOString();
    const models: ModelEntry[] = [];

    for (const m of data) {
      const id = m.modelId || m.id;
      if (!id) continue;
      const org = id.split('/')[0];
      if (!RELEVANT_ORGS.some(o => org.toLowerCase().includes(o.toLowerCase()))) continue;
      if ((m.downloads || 0) < MIN_DOWNLOADS) continue;
      // Skip base models (want Instruct/Chat variants)
      const name = id.split('/').pop() || '';

      const isQwen = org === 'Qwen';
      const isLlama = org === 'meta-llama';
      const isMistral = org === 'mistralai';
      const isDeepSeek = org === 'deepseek-ai';

      // Extract param count from name for tier classification
      const paramMatch = name.match(/(\d+)[Bb]/);
      const params = paramMatch ? parseInt(paramMatch[1]) : 0;

      models.push({
        provider: 'huggingface',
        model_id: id,
        label: name.replace(/-/g, ' '),
        category: name.toLowerCase().includes('coder') ? 'code' : 'chat',
        tier: params >= 70 ? 'frontier' : params >= 14 ? 'mid' : 'budget',
        input_cost_per_m: 0, // HF Inference API pricing varies
        output_cost_per_m: 0,
        context_window: isQwen ? 131072 : isLlama ? 131072 : 32768,
        supports_vision: name.includes('VL') || name.includes('Vision'),
        supports_tools: params >= 7,
        released_at: m.lastModified || null,
        is_active: true,
        api_compatible: 'openai', // HF uses OpenAI-compatible API
        last_verified_at: now,
      });
    }
    return models;
  } catch (e) {
    console.error('HuggingFace fetch error:', e);
    return [];
  }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── GET: Return cached models ──────────────────────────────────────────
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("model_registry")
        .select("*")
        .eq("is_active", true)
        .order("provider")
        .order("tier")
        .order("label");

      if (error) throw error;

      return new Response(
        JSON.stringify({
          models: data || [],
          count: data?.length || 0,
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── POST: Refresh models from provider APIs ────────────────────────────
    if (req.method === "POST") {
      // AUTHENTICATION — this branch spends money and writes with the service
      // role. It previously ran for ANY caller holding the public anon key,
      // which ships in the web bundle: `{"action":"refresh"}` triggered
      // outbound provider calls billed to the PLATFORM keys plus a ~100-row
      // service-role upsert that bypasses model_registry's SELECT-only RLS,
      // with no rate limit. Verified live 2026-08-06: an anon-key POST reached
      // the action validator, proving no identity was required.
      //
      // GET (the cached catalog) stays public — that is the read path the app
      // and the model picker rely on.
      const caller = await getAuthenticatedUser(req);
      const callerIsService = isServiceRoleRequest(req);
      if (!caller && !callerIsService) {
        return new Response(
          JSON.stringify({ error: "unauthorized" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const body = await req.json().catch(() => ({}));
      const { action, provider: targetProvider } = body;

      if (action !== "refresh") {
        return new Response(
          JSON.stringify({ error: 'Use { "action": "refresh" } or { "action": "refresh", "provider": "openai" }' }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Fetch API keys from environment or user_api_keys table
      const allowPlatformKeys = Deno.env.get("ALLOW_SERVICE_ROLE_PLATFORM_MODEL_KEYS") === "true";
      const openaiKey = allowPlatformKeys ? Deno.env.get("OPENAI_API_KEY") || "" : "";
      const geminiKey = allowPlatformKeys ? Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_KEY") || "" : "";

      const results: { provider: string; fetched: number; error?: string }[] = [];
      const allModels: ModelEntry[] = [];

      // Fetch from each provider (or just the target)
      if (!targetProvider || targetProvider === "openai") {
        if (openaiKey) {
          const models = await fetchOpenAIModels(openaiKey);
          allModels.push(...models);
          results.push({ provider: "openai", fetched: models.length });
        } else {
          results.push({ provider: "openai", fetched: 0, error: "No API key" });
        }
      }

      if (!targetProvider || targetProvider === "google") {
        if (geminiKey) {
          const models = await fetchGeminiModels(geminiKey);
          allModels.push(...models);
          results.push({ provider: "google", fetched: models.length });
        } else {
          results.push({ provider: "google", fetched: 0, error: "No API key" });
        }
      }

      if (!targetProvider || targetProvider === "huggingface") {
        // HuggingFace doesn't need an API key for public model listing
        const models = await fetchHuggingFaceModels();
        allModels.push(...models);
        results.push({ provider: "huggingface", fetched: models.length });
      }

      // Upsert into model_registry
      if (allModels.length > 0) {
        const { error: upsertError } = await supabase
          .from("model_registry")
          .upsert(
            allModels.map(m => ({
              ...m,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "provider,model_id" },
          );

        if (upsertError) {
          console.error("Upsert error:", upsertError);
          results.push({ provider: "db", fetched: 0, error: upsertError.message });
        }

        // Mark models not in the fresh fetch as inactive (for refreshed providers only)
        const refreshedProviders = allModels.map(m => m.provider);
        const freshIds = allModels.map(m => m.model_id);
        for (const prov of [...new Set(refreshedProviders)]) {
          const provModels = allModels.filter(m => m.provider === prov).map(m => m.model_id);
          // Don't deactivate — just mark last_verified_at so stale ones can be filtered
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          results,
          totalFetched: allModels.length,
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("model-registry error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
