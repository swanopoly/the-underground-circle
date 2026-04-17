// image-generate — AI Image Generation Edge Function
//
// Supports: OpenAI DALL-E 3 / GPT Image, Replicate Flux
// Uses user-stored API keys from user_api_keys table.
//
// Deploy: npx supabase functions deploy image-generate

import {
  corsHeaders,
  createServiceRoleClient,
  errResponse,
  getAuthenticatedUser,
  jsonResponse,
} from "../_shared/edge.ts";

// ─── Types ──────────────────────────────────────────────────────────────────

type ImageProvider = "openai" | "replicate";

interface ImageRequest {
  provider: ImageProvider;
  prompt: string;
  model?: string;        // dall-e-3, flux-schnell, flux-dev
  size?: string;         // 1024x1024, 1024x1792, etc.
  quality?: string;      // standard, hd (OpenAI only)
  style?: string;        // vivid, natural (OpenAI only)
  circleId?: string;
  // Direct key for testing
  api_key?: string;
}

interface ImageResponse {
  url: string;
  provider: ImageProvider;
  model: string;
  revised_prompt?: string;
  estimated_cost: number;
}

type ErrorCode =
  | "validation"
  | "unauthenticated"
  | "key_missing"
  | "upstream_error"
  | "internal";

// ─── Cost estimates ─────────────────────────────────────────────────────────

const IMAGE_COSTS: Record<string, number> = {
  "dall-e-3-1024x1024-standard": 0.040,
  "dall-e-3-1024x1024-hd": 0.080,
  "dall-e-3-1024x1792-standard": 0.080,
  "dall-e-3-1024x1792-hd": 0.120,
  "dall-e-3-1792x1024-standard": 0.080,
  "dall-e-3-1792x1024-hd": 0.120,
  "flux-schnell": 0.003,
  "flux-dev": 0.055,
};

// ─── Get user API key ───────────────────────────────────────────────────────

async function getUserApiKey(
  supabase: any,
  userId: string,
  provider: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: provider,
    p_label: "default",
  });
  if (error || !data) return null;
  return data;
}

// ─── OpenAI DALL-E ──────────────────────────────────────────────────────────

async function generateOpenAI(
  apiKey: string,
  prompt: string,
  model: string,
  size: string,
  quality: string,
  style: string,
): Promise<ImageResponse> {
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || "dall-e-3",
      prompt,
      n: 1,
      size: size || "1024x1024",
      quality: quality || "standard",
      style: style || "vivid",
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI Image API error: ${resp.status} ${err}`);
  }

  const data = await resp.json();
  const image = data.data?.[0];
  const costKey = `${model || "dall-e-3"}-${size || "1024x1024"}-${quality || "standard"}`;

  return {
    url: image?.url || "",
    provider: "openai",
    model: model || "dall-e-3",
    revised_prompt: image?.revised_prompt,
    estimated_cost: IMAGE_COSTS[costKey] || 0.04,
  };
}

// ─── Replicate Flux ─────────────────────────────────────────────────────────

async function generateReplicate(
  apiKey: string,
  prompt: string,
  model: string,
): Promise<ImageResponse> {
  const modelMap: Record<string, string> = {
    "flux-schnell": "black-forest-labs/flux-schnell",
    "flux-dev": "black-forest-labs/flux-dev",
  };

  const replicateModel = modelMap[model] || modelMap["flux-schnell"];

  // Create prediction
  const createResp = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: replicateModel,
      input: { prompt },
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Replicate API error: ${createResp.status} ${err}`);
  }

  const prediction = await createResp.json();

  // Poll for completion (max 60s)
  let result = prediction;
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    if (result.status === "succeeded" || result.status === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));

    const pollResp = await fetch(
      `https://api.replicate.com/v1/predictions/${result.id}`,
      { headers: { "Authorization": `Bearer ${apiKey}` } },
    );
    result = await pollResp.json();
  }

  if (result.status !== "succeeded") {
    throw new Error(`Replicate prediction failed: ${result.status} - ${result.error || "timeout"}`);
  }

  const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output;

  return {
    url: outputUrl || "",
    provider: "replicate",
    model: model || "flux-schnell",
    estimated_cost: IMAGE_COSTS[model] || 0.003,
  };
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: ImageRequest = await req.json();
    const { provider, prompt, model, size, quality, style, circleId, api_key } = body;

    if (!prompt) {
      return errResponse(400, "validation", "prompt is required");
    }

    const supabase = createServiceRoleClient();
    const user = await getAuthenticatedUser(req);
    const userId = user?.id || null;

    if (!userId) {
      return errResponse(401, "unauthenticated", "Not authenticated — valid JWT required");
    }

    // Get API key — user's own key from DB, or request body for testing, or platform fallback
    let apiKey = api_key;
    if (!apiKey) {
      const resolvedProvider = provider === "replicate" ? "replicate" : "openai";
      apiKey = await getUserApiKey(supabase, userId, resolvedProvider);
    }
    if (!apiKey) {
      // Fallback to platform key for OpenAI
      if (provider !== "replicate") {
        apiKey = Deno.env.get("OPENAI_API_KEY") || "";
      }
      if (!apiKey) {
        return errResponse(
          400,
          "key_missing",
          `No API key found for ${provider}. Add one in Settings > API Keys.`,
        );
      }
    }

    let result: ImageResponse;

    if (provider === "replicate") {
      result = await generateReplicate(apiKey, prompt, model || "flux-schnell");
    } else {
      result = await generateOpenAI(apiKey, prompt, model || "dall-e-3", size || "1024x1024", quality || "standard", style || "vivid");
    }

    // Track usage (non-critical)
    try {
      await supabase.from("user_ai_usage").insert({
        user_id: userId,
        circle_id: circleId || null,
        model: result.model,
        provider: result.provider,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost: result.estimated_cost,
        command_type: "image_generate",
      });
    } catch { /* non-critical */ }

    return jsonResponse(result);
  } catch (err: any) {
    const message = err?.message || "Image generation failed";
    if (/API error|prediction failed/.test(message)) {
      return errResponse(502, "upstream_error", message);
    }
    return errResponse(500, "internal", message);
  }
});
