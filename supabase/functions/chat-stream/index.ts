// chat-stream — Phase C2 of the OpenSwan/Chat Architecture Plan.
//
// SSE streaming for chat: forwards Anthropic Messages API streaming
// deltas directly to the client so the bubble updates token-by-token
// instead of arriving in a single batch after 5-10s.
//
// Events emitted:
//   data: {"type":"delta","text":"..."}      — a text chunk
//   data: {"type":"phase","phase":"thinking"} — model is thinking
//   data: {"type":"usage","usage":{...}}     — final token counts
//   data: {"type":"done"}                    — stream complete
//   data: {"type":"error","message":"..."}   — terminal error
//
// Deploy: npx supabase functions deploy chat-stream

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { computeCostUsd, checkCircleClaudeBudget, type UsageBreakdown } from "../_claude/anthropic.ts";
import { byokMissingMessage, resolveUserModelApiKey } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

interface ChatStreamRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  system?: string;
  max_tokens?: number;
  temperature?: number;
  circleId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  // Auth: resolve user from JWT
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  let userId: string | null = null;
  if (token) {
    const anon = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY") || serviceKey,
      { global: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const { data: { user } } = await anon.auth.getUser();
    userId = user?.id || null;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: "Unauthenticated" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: ChatStreamRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { messages, system, max_tokens, temperature, circleId } = body;
  if (!messages?.length) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const anthropicKey = await resolveUserModelApiKey({
    supabase: svc,
    userId,
    provider: "anthropic",
    envVarName: "ANTHROPIC_API_KEY",
  });
  if (!anthropicKey) {
    return new Response(JSON.stringify({
      error: byokMissingMessage("anthropic"),
      code: "key_missing",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Umbrella circle cap — chat-stream is the highest-volume streaming
  // surface so the 24h total-spend ceiling matters here. Skip when
  // caller didn't pass a circleId (e.g. prompt playground previews).
  if (circleId) {
    try {
      const cap = await checkCircleClaudeBudget(svc, circleId);
      if (!cap.allowed) {
        return new Response(JSON.stringify({
          error: "circle_claude_budget_exceeded",
          detail: cap.reason,
          spent24h: cap.spent24h,
          cap: cap.cap,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch { /* fail-open by design */ }
  }

  // Model resolution: default Haiku, respect caller's pick.
  // Canonical short IDs per Anthropic — no date suffixes. Opus points at 4.7
  // (latest); callers who need 4.6 can pass `claude-opus-4-6` directly.
  const MODEL_MAP: Record<string, string> = {
    "claude-haiku": "claude-haiku-4-5",
    "claude-haiku-4-5": "claude-haiku-4-5",
    "claude-sonnet": "claude-sonnet-4-6",
    "claude-opus": "claude-opus-4-7",
  };
  const rawModel = body.model || "claude-haiku-4-5";
  const model = MODEL_MAP[rawModel] || rawModel;

  // Build Anthropic request with streaming enabled
  const chatMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
  const systemPrompt = system || messages.filter(m => m.role === "system").map(m => m.content).join("\n\n") || undefined;

  const anthropicBody: Record<string, unknown> = {
    model,
    messages: chatMessages,
    max_tokens: max_tokens || 2048,
    stream: true,
  };
  // Wrap the system prompt in a cache_control block so repeated calls with
  // the same system prefix hit the ephemeral cache (~10% of input cost).
  // Caller-supplied system prompts should be kept stable byte-for-byte across
  // requests for this to pay off.
  if (systemPrompt) {
    anthropicBody.system = [
      { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
    ];
  }
  if (temperature !== undefined && !model.includes("opus")) {
    anthropicBody.temperature = temperature;
  }

  // Forward the stream via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(anthropicBody),
        });

        if (!res.ok) {
          const err = await res.text();
          emit({ type: "error", message: `Anthropic ${res.status}: ${err.slice(0, 300)}` });
          controller.close();
          return;
        }

        if (!res.body) {
          emit({ type: "error", message: "No response body from Anthropic" });
          controller.close();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        // Track usage in the shared UsageBreakdown shape so cost math uses
        // the single pricing table. Anthropic's streaming protocol puts
        // usage in two places: `message_start.message.usage` has initial
        // input + cache fields; `message_delta.usage` has the final
        // output_tokens (and may restate cache read/create).
        const usage: UsageBreakdown = { uncachedIn: 0, cacheCreate: 0, cacheRead: 0, output: 0 };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const lines = buf.split("\n");
          buf = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") continue;

            try {
              const event = JSON.parse(raw);
              const eventType = event.type;

              if (eventType === "content_block_delta") {
                const delta = event.delta;
                if (delta?.type === "text_delta" && delta.text) {
                  emit({ type: "delta", text: delta.text });
                }
              } else if (eventType === "message_start") {
                const u = event.message?.usage;
                if (u) {
                  usage.uncachedIn  = u.input_tokens                ?? 0;
                  usage.cacheCreate = u.cache_creation_input_tokens ?? 0;
                  usage.cacheRead   = u.cache_read_input_tokens     ?? 0;
                  // output_tokens on message_start may exist but is
                  // preliminary; trust message_delta's value at the end.
                }
              } else if (eventType === "message_delta") {
                const u = event.usage;
                if (u?.output_tokens !== undefined) usage.output = u.output_tokens;
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        const totalInputSide = usage.uncachedIn + usage.cacheCreate + usage.cacheRead;
        const estimatedCost = computeCostUsd(model, usage);

        // Final usage event — cache-aware. Keeps `input_tokens` as the
        // total input-side count for backwards compat with clients that
        // sum input+output.
        emit({
          type: "usage",
          usage: {
            model,
            input_tokens: totalInputSide,
            output_tokens: usage.output,
            total_tokens: totalInputSide + usage.output,
            cache_creation_tokens: usage.cacheCreate,
            cache_read_tokens: usage.cacheRead,
            estimated_cost: estimatedCost,
          },
        });

        // Track usage in DB (fire-and-forget). Writes to user_ai_usage
        // (per-user, chat-specific) rather than claude_api_usage.
        try {
          const supabase = createClient(supabaseUrl, serviceKey);
          await supabase.from("user_ai_usage").insert({
            user_id: userId,
            circle_id: circleId || null,
            model,
            provider: "anthropic",
            input_tokens: usage.uncachedIn,
            output_tokens: usage.output,
            cache_creation_tokens: usage.cacheCreate,
            cache_read_tokens: usage.cacheRead,
            estimated_cost: estimatedCost,
            source: "chat-stream",
          });
        } catch { /* non-critical */ }

        emit({ type: "done" });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
