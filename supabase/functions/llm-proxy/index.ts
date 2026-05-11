// llm-proxy — Unified LLM Proxy Edge Function
//
// Routes requests to any LLM provider using user-stored API keys.
// Supports marketplace BYOK providers surfaced by the chat model picker.
// All keys are stored encrypted in user_api_keys table.
//
// Deploy: npx supabase functions deploy llm-proxy

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { computeCostUsd, logClaudeUsage, type UsageBreakdown } from "../_claude/anthropic.ts";
import { byokMissingMessage, resolveUserModelApiKey } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ErrorCode =
  | "validation"
  | "unauthenticated"
  | "key_missing"
  | "unsupported_provider"
  | "upstream_error"
  | "internal";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errResponse(status: number, code: ErrorCode, message: string): Response {
  return jsonResponse({ error: message, code }, status);
}

function mapUpstreamError(message: string): Response {
  if (/ API \d{3}: /.test(message)) {
    return errResponse(502, "upstream_error", message);
  }
  return errResponse(500, "internal", message);
}

// ─── Types ──────────────────────────────────────────────────────────────────

type Provider =
  | "openai"
  | "openai_compatible"
  | "anthropic"
  | "openrouter"
  | "groq"
  | "ollama"
  | "github-models"
  | "huggingface"
  | "zai"
  | "minimax"
  | "google_ai"
  | "mistral_ai"
  | "cohere"
  | "perplexity"
  | "together_ai"
  | "fireworks_ai"
  | "deepseek"
  | "openai-embed";

interface LLMProxyRequest {
  provider: Provider;
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  circleId?: string;
  userId?: string;
  thinkingLevel?: "fast" | "balanced" | "deep";
  // Optional caller-supplied key for one-off testing before saving.
  api_key?: string;
  // Optional caller-supplied endpoint for one-off OpenAI-compatible key tests.
  endpoint?: string;
  // Embedding-mode input (only used when provider === 'openai-embed').
  // Accepts either a single string or a batch; batches are more efficient.
  input?: string | string[];
}

interface EmbeddingProxyResponse {
  embeddings: number[][];          // one vector per input string
  model: string;
  provider: "openai-embed";
  dimensions: number;
  input_tokens: number;
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
  "github-models": "https://models.inference.ai.azure.com/chat/completions",
  huggingface: "https://router.huggingface.co/v1/chat/completions",
  zai: "https://api.z.ai/api/paas/v4/chat/completions",
  minimax: "https://api.minimax.io/v1/chat/completions",
  google_ai: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  mistral_ai: "https://api.mistral.ai/v1/chat/completions",
  cohere: "https://api.cohere.ai/compatibility/v1/chat/completions",
  perplexity: "https://api.perplexity.ai/chat/completions",
  together_ai: "https://api.together.xyz/v1/chat/completions",
  fireworks_ai: "https://api.fireworks.ai/inference/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
};

// OpenAI-compatible providers (same request/response format)
const OPENAI_COMPATIBLE: Provider[] = [
  "openai",
  "openai_compatible",
  "openrouter",
  "groq",
  "ollama",
  "github-models",
  "huggingface",
  "zai",
  "minimax",
  "google_ai",
  "mistral_ai",
  "cohere",
  "perplexity",
  "together_ai",
  "fireworks_ai",
  "deepseek",
];

function normalizeOpenAICompatibleEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/\/chat\/completions(?:\?|$)/i.test(trimmed)) return endpoint.trim();
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function normalizeProviderModel(provider: Provider, model: string): string {
  if (provider === "openrouter" && model === "openrouter/auto") return model;
  const prefixes = provider === "huggingface"
    ? ["huggingface_endpoint/", "huggingface/", "hugging_face/"]
    : provider === "zai"
      ? ["zai/", "z_ai/"]
      : [`${provider}/`];
  for (const prefix of prefixes) {
    if (model.startsWith(prefix)) return model.slice(prefix.length);
  }
  return model;
}

// ─── Cost estimation ────────────────────────────────────────────────────────

const MODEL_COSTS: Record<string, [number, number]> = {
  // OpenAI
  "gpt-4.1": [2.00, 8.00],
  "gpt-4.1-mini": [0.40, 1.60],
  "gpt-4.1-nano": [0.10, 0.40],
  "gpt-4o": [2.50, 10.00],
  "gpt-4o-mini": [0.15, 0.60],
  "o3": [10.00, 40.00],
  "o4-mini": [1.10, 4.40],
  "o1": [15.00, 60.00],
  "o3-mini": [1.10, 4.40],
  // Google
  "gemini-2.5-pro": [1.25, 10.00],
  "gemini-2.5-flash": [0.15, 0.60],
  // Anthropic
  "claude-opus-4-7": [5.00, 25.00],
  "claude-opus-4-6": [5.00, 25.00],
  "claude-sonnet-4-6": [3.00, 15.00],
  "claude-haiku-4-5": [1.00, 5.00],
  "claude-haiku-4-5-20251001": [1.00, 5.00],
  // Groq (free tier / very cheap)
  "llama-3.3-70b-versatile": [0.59, 0.79],
  "mixtral-8x7b-32768": [0.24, 0.24],
  // OpenRouter (pass-through — use underlying model costs)
  // GitHub Models (free tier — zero cost)
  "Meta-Llama-3.1-405B-Instruct": [0, 0],
  "Meta-Llama-3.1-70B-Instruct": [0, 0],
  "Mistral-Large-2411": [0, 0],
  "Phi-4": [0, 0],
  "cohere-command-r-plus": [0, 0],
  // Hugging Face (free tier for small models, cheap for large)
  "meta-llama/Llama-3.3-70B-Instruct": [0.59, 0.79],
  "mistralai/Mistral-Large-2411": [2.00, 6.00],
  "Qwen/Qwen2.5-72B-Instruct": [0.59, 0.79],
  "deepseek-ai/DeepSeek-R1": [0.55, 2.19],
  "google/gemma-2-27b-it": [0.27, 0.27],
  "meta-llama/Llama-3.1-8B-Instruct": [0, 0],
  "mistralai/Mistral-7B-Instruct-v0.3": [0, 0],
  // z.ai
  "glm-5": [0.50, 1.50],
  "glm-4-plus": [0.50, 1.50],
  "glm-4-air": [0.10, 0.30],
  "glm-4-flash": [0, 0],
  // MiniMax
  "MiniMax-M1": [0.40, 2.20],
  "MiniMax-Text-01": [0.20, 1.10],
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
  // Phase 0: forward server-tool requests (e.g. OpenRouter web_search)
  // and plugin specs through to OpenRouter unchanged. Other OpenAI-
  // compatible providers (OpenAI, Groq, etc.) accept `tools` natively
  // for function-calling, so passing them through is safe — they just
  // won't trigger the OpenRouter-specific `openrouter:web_search`
  // server tool that needs OR's host to handle it.
  extra?: { tools?: Array<Record<string, unknown>>; plugins?: Array<Record<string, unknown>> },
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

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  if (extra?.tools && Array.isArray(extra.tools) && extra.tools.length > 0) {
    requestBody.tools = extra.tools;
  }
  if (extra?.plugins && Array.isArray(extra.plugins) && extra.plugins.length > 0) {
    requestBody.plugins = extra.plugins;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
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

  // Map model shortcuts to full IDs. Canonical short form (no date suffixes)
  // per Anthropic. `claude-opus` follows the latest opus — currently 4.7.
  const MODEL_MAP: Record<string, string> = {
    "claude-opus-4-7": "claude-opus-4-7",
    "claude-opus-4-6": "claude-opus-4-6",
    "claude-sonnet-4-6": "claude-sonnet-4-6",
    "claude-haiku-4-5": "claude-haiku-4-5",
    "claude-haiku": "claude-haiku-4-5",
    "claude-sonnet": "claude-sonnet-4-6",
    "claude-opus": "claude-opus-4-7",
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
    // cache_control so BYO-proxy callers with stable system prompts get
    // ephemeral cache reads on repeat calls.
    body.system = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ];
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
  const u = data.usage || {};
  const usage: UsageBreakdown = {
    uncachedIn:  u.input_tokens                ?? 0,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
    cacheRead:   u.cache_read_input_tokens     ?? 0,
    output:      u.output_tokens               ?? 0,
  };

  return {
    response: data.content?.[0]?.text || "No response generated.",
    usage: {
      model: resolvedModel,
      provider: "anthropic",
      // `input_tokens` stays the uncached count for backwards-compat with
      // BYO-key dashboards that sum `input_tokens + output_tokens`.
      input_tokens:          usage.uncachedIn,
      output_tokens:         usage.output,
      cache_creation_tokens: usage.cacheCreate,
      cache_read_tokens:     usage.cacheRead,
      total_tokens:          usage.uncachedIn + usage.cacheCreate + usage.cacheRead + usage.output,
      // Cache-aware cost via the shared pricing table. Replaces the old
      // `estimateCost(...)` call that ignored cache tokens entirely.
      estimated_cost:        computeCostUsd(resolvedModel, usage),
    },
  };
}

// ─── OpenAI embeddings ──────────────────────────────────────────────────────
// Dedicated branch because the request/response shape, endpoint, and token
// accounting are all different from chat. We skip personality + context
// injection entirely — embeddings of "You are a senior engineer..." would
// poison retrieval.

async function callOpenAIEmbed(
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<EmbeddingProxyResponse> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: inputs }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`openai-embed API ${res.status}: ${err}`);
  }

  const data = await res.json();
  // Response: { data: [{ embedding: number[], index: number }, ...], usage: { prompt_tokens } }
  const embeddings: number[][] = (data.data || [])
    .sort((a: any, b: any) => a.index - b.index)
    .map((row: any) => row.embedding as number[]);
  const firstDim = embeddings[0]?.length || 0;

  return {
    embeddings,
    model: data.model || model,
    provider: "openai-embed",
    dimensions: firstDim,
    input_tokens: data.usage?.prompt_tokens || 0,
  };
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return jsonResponse({ status: "ok", service: "llm-proxy", providers: Object.keys(PROVIDER_ENDPOINTS).concat(["anthropic", "ollama"]) });
  }

  try {
    const body: LLMProxyRequest & {
      tools?: Array<Record<string, unknown>>;
      plugins?: Array<Record<string, unknown>>;
    } = await req.json();
    const { provider, model: rawModel, messages, circleId, thinkingLevel } = body;
    const model = rawModel && provider !== "openai-embed"
      ? normalizeProviderModel(provider, rawModel)
      : rawModel;

    // Embedding requests use a completely different request shape — validate
    // and dispatch early so the chat-path guards don't reject `!messages`.
    const isEmbed = provider === "openai-embed";
    if (!isEmbed && (!provider || !model || !messages?.length)) {
      return errResponse(400, "validation", "Missing provider, model, or messages.");
    }
    if (isEmbed && !body.input) {
      return errResponse(400, "validation", "openai-embed requires `input` (string or string[]).");
    }

    // Create service role client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the user from JWT — never trust userId from request body
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    let userId: string | null = null;

    if (token) {
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return errResponse(401, "unauthenticated", "Not authenticated — valid JWT required.");
    }

    // ── Embedding fast-path ────────────────────────────────────────────────
    // Resolved BEFORE chat-path work so we don't waste time loading
    // personality / context strings that don't apply to embeddings.
    if (isEmbed) {
      const rawInput = body.input!;
      const inputs = Array.isArray(rawInput) ? rawInput : [rawInput];
      // Truncate per-item to 8k tokens worth (~30k chars). OpenAI's limit is
      // 8192 tokens for text-embedding-3-small; we leave slack for safety.
      const bounded = inputs.map(s => (s || "").slice(0, 30000)).filter(Boolean);
      if (bounded.length === 0) {
        return errResponse(400, "validation", "openai-embed input is empty.");
      }

      const embedKey = await resolveUserModelApiKey({
        supabase,
        userId,
        provider: "openai",
        requestApiKey: body.api_key,
        envVarName: "OPENAI_API_KEY",
      });
      if (!embedKey) {
        return errResponse(
          400,
          "key_missing",
          byokMissingMessage("openai"),
        );
      }

      const embedModel = model || "text-embedding-3-small";
      try {
        const result = await callOpenAIEmbed(embedKey.apiKey, embedModel, bounded);

        // Light usage tracking — reuse the existing table
        try {
          await supabase.from("user_ai_usage").insert({
            user_id: userId,
            circle_id: circleId || null,
            model: result.model,
            provider: result.provider,
            input_tokens: result.input_tokens,
            output_tokens: 0,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            // OpenAI text-embedding-3-small: $0.02 per 1M input tokens
            estimated_cost: (result.input_tokens * 0.02) / 1_000_000,
            source: "llm-proxy-embed",
          });
        } catch { /* non-critical */ }

        return jsonResponse(result);
      } catch (err: any) {
        return mapUpstreamError(err?.message || "Embedding call failed");
      }
    }

    let apiKey: string | null | undefined;
    let customEndpoint: string | undefined;

    const envVarName =
      provider === "anthropic" ? "ANTHROPIC_API_KEY" :
      provider === "zai" ? "ZAI_API_KEY" :
      provider === "minimax" ? "MINIMAX_API_KEY" :
      undefined;
    const keyData = await resolveUserModelApiKey({
      supabase,
      userId,
      provider,
      requestApiKey: body.api_key,
      envVarName,
    });
    if (!keyData) {
      return errResponse(400, "key_missing", byokMissingMessage(provider));
    }
    apiKey = keyData.apiKey;
    customEndpoint = body.endpoint || keyData.endpoint || undefined;

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
      } else if (provider === "openai_compatible") {
        endpoint = customEndpoint ? normalizeOpenAICompatibleEndpoint(customEndpoint) : "";
        if (!endpoint) {
          return errResponse(400, "validation", "OpenAI-compatible provider requires a saved endpoint URL.");
        }
      } else {
        endpoint = PROVIDER_ENDPOINTS[provider];
      }
      result = await callOpenAICompatible(
        endpoint,
        apiKey!,
        model,
        finalMessages,
        temperature,
        maxTokens,
        provider,
        { tools: body.tools, plugins: body.plugins },
      );
    } else {
      return errResponse(400, "unsupported_provider", `Unsupported provider: ${provider}`);
    }

    // Track usage in both ledgers. Keep these independent so a missing legacy
    // table cannot suppress the canonical Anthropic cost row.
    const usageLogs: Promise<unknown>[] = [
      Promise.resolve(supabase.from("user_ai_usage").insert({
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
      })),
    ];
    if (provider === "anthropic") {
      usageLogs.push(
        logClaudeUsage(supabase, {
          userId,
          circleId: circleId || null,
          source: "llm-proxy",
          model: result.usage.model,
          usage: {
            uncachedIn:  result.usage.input_tokens || 0,
            output:      result.usage.output_tokens || 0,
            cacheCreate: result.usage.cache_creation_tokens || 0,
            cacheRead:   result.usage.cache_read_tokens || 0,
          },
          metadata: { proxy: true },
        }),
      );
    }
    await Promise.allSettled(usageLogs);

    return jsonResponse(result);
  } catch (err: any) {
    console.error("llm-proxy error:", err);
    return mapUpstreamError(err?.message || "Internal server error");
  }
});
