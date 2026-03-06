// llm-proxy — Unified LLM Proxy Edge Function
//
// Routes requests to any LLM provider using user-stored API keys.
// Supports: OpenAI, Anthropic, OpenRouter, Groq, Ollama
// All keys are stored encrypted in user_api_keys table.
//
// Deploy: npx supabase functions deploy llm-proxy

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Types ──────────────────────────────────────────────────────────────────

type Provider = "openai" | "anthropic" | "openrouter" | "groq" | "ollama";

interface LLMProxyRequest {
  provider: Provider;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  circleId?: string;
  userId?: string;
  thinkingLevel?: "fast" | "balanced" | "deep";
  // Direct key (for testing — bypasses DB lookup)
  api_key?: string;
}

interface LLMProxyResponse {
  response: string;
  usage: {
    model: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    total_tokens: number;
    estimated_cost: number;
  };
}

// ─── Provider endpoints ─────────────────────────────────────────────────────

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
};

// OpenAI-compatible providers (same request/response format)
const OPENAI_COMPATIBLE: Provider[] = ["openai", "openrouter", "groq", "ollama"];

// ─── Cost estimation ────────────────────────────────────────────────────────

const MODEL_COSTS: Record<string, [number, number]> = {
  // OpenAI
  "gpt-4o": [2.50, 10.00],
  "gpt-4o-mini": [0.15, 0.60],
  "o1": [15.00, 60.00],
  "o3-mini": [1.10, 4.40],
  // Anthropic
  "claude-opus-4-6": [15.00, 75.00],
  "claude-sonnet-4-6": [3.00, 15.00],
  "claude-haiku-4-5-20251001": [0.80, 4.00],
  // Groq (free tier / very cheap)
  "llama-3.3-70b-versatile": [0.59, 0.79],
  "mixtral-8x7b-32768": [0.24, 0.24],
  // OpenRouter (pass-through — use underlying model costs)
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try exact match first, then partial match
  let costs = MODEL_COSTS[model];
  if (!costs) {
    const key = Object.keys(MODEL_COSTS).find((k) => model.includes(k));
    costs = key ? MODEL_COSTS[key] : [1.0, 3.0]; // fallback estimate
  }
  return (inputTokens * costs[0] + outputTokens * costs[1]) / 1_000_000;
}

// ─── Thinking level config ──────────────────────────────────────────────────

interface ThinkingConfig {
  temperature: number;
  max_tokens: number;
}

const THINKING_LEVELS: Record<string, ThinkingConfig> = {
  fast: { temperature: 0.3, max_tokens: 512 },
  balanced: { temperature: 0.7, max_tokens: 1024 },
  deep: { temperature: 0.9, max_tokens: 4096 },
};

// ─── Get user API key from encrypted storage ────────────────────────────────

async function getUserApiKey(
  supabase: any,
  userId: string,
  provider: string,
): Promise<{ apiKey: string; endpoint?: string } | null> {
  const { data, error } = await supabase.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: provider,
    p_label: "default",
  });

  if (error || !data || data.length === 0) return null;
  return { apiKey: data[0].api_key, endpoint: data[0].endpoint };
}

// ─── Load agent personality ─────────────────────────────────────────────────

async function loadPersonality(
  supabase: any,
  userId: string,
  circleId?: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("agent_personalities")
    .select("personality")
    .eq("user_id", userId)
    .eq("circle_id", circleId || null)
    .limit(1)
    .maybeSingle();

  return data?.personality || null;
}

// ─── Gather light circle context ────────────────────────────────────────────

async function gatherLightContext(supabase: any, circleId: string): Promise<string> {
  const { data: circle } = await supabase
    .from("circles")
    .select("name, description")
    .eq("id", circleId)
    .single();

  if (!circle) return "";

  const { count: memberCount } = await supabase
    .from("circle_members")
    .select("*", { count: "exact", head: true })
    .eq("circle_id", circleId);

  const today = new Date().toISOString().split("T")[0];
  const { count: checkinCount } = await supabase
    .from("check_ins")
    .select("*", { count: "exact", head: true })
    .eq("circle_id", circleId)
    .gte("created_at", today);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  return `Circle: ${circle.name}\nDate: ${dateStr}\nMembers: ${memberCount || 0}\nChecked in today: ${checkinCount || 0}/${memberCount || 0}`;
}

// ─── Call OpenAI-compatible API ─────────────────────────────────────────────

async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number,
  provider: Provider,
): Promise<LLMProxyResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  // OpenRouter-specific headers
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://app.chrisswanson.xyz";
    headers["X-Title"] = "The Underground Circle";
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${provider} API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  const usage = data.usage || {};
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;

  return {
    response: choice?.message?.content || "No response generated.",
    usage: {
      model: data.model || model,
      provider,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: inputTokens + outputTokens,
      estimated_cost: estimateCost(model, inputTokens, outputTokens),
    },
  };
}

// ─── Call Anthropic API ─────────────────────────────────────────────────────

async function callAnthropic(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number,
): Promise<LLMProxyResponse> {
  // Separate system messages from user/assistant messages
  const systemMessages = messages.filter((m) => m.role === "system");
  const chatMessages = messages.filter((m) => m.role !== "system");
  const systemPrompt = systemMessages.map((m) => m.content).join("\n\n");

  // Map model shortcuts to full IDs
  const MODEL_MAP: Record<string, string> = {
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    "claude-haiku": "claude-haiku-4-5-20251001",
    "claude-sonnet": "claude-sonnet-4-6",
    "claude-opus": "claude-opus-4-6",
  };
  const resolvedModel = MODEL_MAP[model] || model;

  const body: any = {
    model: resolvedModel,
    max_tokens: maxTokens,
    messages: chatMessages.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    })),
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  // Only set temperature for non-thinking models
  if (temperature !== undefined && !resolvedModel.includes("opus")) {
    body.temperature = temperature;
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const cacheCreation = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  return {
    response: data.content?.[0]?.text || "No response generated.",
    usage: {
      model: resolvedModel,
      provider: "anthropic",
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_tokens: cacheCreation,
      cache_read_tokens: cacheRead,
      total_tokens: inputTokens + outputTokens,
      estimated_cost: estimateCost(resolvedModel, inputTokens, outputTokens),
    },
  };
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", service: "llm-proxy", providers: Object.keys(PROVIDER_ENDPOINTS).concat(["anthropic", "ollama"]) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const body: LLMProxyRequest = await req.json();
    const { provider, model, messages, circleId, thinkingLevel } = body;

    if (!provider || !model || !messages?.length) {
      return new Response(
        JSON.stringify({ error: "Missing provider, model, or messages" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Create service role client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the user from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = body.userId || null;

    if (token && !userId) {
      // Create anon client to get user from JWT
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Get API key — from request body (testing) or from encrypted DB
    let apiKey = body.api_key;
    let customEndpoint: string | undefined;

    if (!apiKey) {
      const keyData = await getUserApiKey(supabase, userId, provider);
      if (!keyData) {
        // Fallback: try platform's own Anthropic key for anthropic provider
        if (provider === "anthropic") {
          apiKey = Deno.env.get("ANTHROPIC_API_KEY") || null;
        }
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: `No API key stored for provider: ${provider}. Add your key in Settings → API Keys.` }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        apiKey = keyData.apiKey;
        customEndpoint = keyData.endpoint || undefined;
      }
    }

    // Apply thinking level config
    const thinkConfig = THINKING_LEVELS[thinkingLevel || "balanced"];
    const temperature = body.temperature ?? thinkConfig.temperature;
    const maxTokens = body.max_tokens ?? thinkConfig.max_tokens;

    // Build messages with personality and context
    const finalMessages = [...messages];

    // Load and inject agent personality
    const personality = await loadPersonality(supabase, userId, circleId);

    // Inject circle context
    let contextStr = "";
    if (circleId) {
      contextStr = await gatherLightContext(supabase, circleId);
    }

    // Prepend system message if we have personality or context
    if (personality || contextStr) {
      const systemParts: string[] = [];
      if (personality) systemParts.push(personality);
      if (contextStr) systemParts.push(`\n## Circle Context\n${contextStr}`);

      // Check if first message is already system
      if (finalMessages[0]?.role === "system") {
        finalMessages[0] = {
          role: "system",
          content: `${systemParts.join("\n\n")}\n\n${finalMessages[0].content}`,
        };
      } else {
        finalMessages.unshift({ role: "system", content: systemParts.join("\n\n") });
      }
    }

    // Route to provider
    let result: LLMProxyResponse;

    if (provider === "anthropic") {
      result = await callAnthropic(apiKey!, model, finalMessages, temperature, maxTokens);
    } else if (OPENAI_COMPATIBLE.includes(provider)) {
      let endpoint: string;
      if (provider === "ollama") {
        endpoint = (customEndpoint || "http://localhost:11434") + "/v1/chat/completions";
      } else {
        endpoint = PROVIDER_ENDPOINTS[provider];
      }
      result = await callOpenAICompatible(endpoint, apiKey!, model, finalMessages, temperature, maxTokens, provider);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported provider: ${provider}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Track usage in user_ai_usage if available
    try {
      await supabase.from("user_ai_usage").insert({
        user_id: userId,
        circle_id: circleId || null,
        model: result.usage.model,
        provider: result.usage.provider,
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
        cache_creation_tokens: result.usage.cache_creation_tokens,
        cache_read_tokens: result.usage.cache_read_tokens,
        estimated_cost: result.usage.estimated_cost,
        source: "llm-proxy",
      });
    } catch {
      // Non-critical — don't fail if tracking table doesn't exist
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("llm-proxy error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
