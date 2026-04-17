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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

  // Model resolution: default Haiku, respect caller's pick
  const MODEL_MAP: Record<string, string> = {
    "claude-haiku": "claude-haiku-4-5-20251001",
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    "claude-sonnet": "claude-sonnet-4-6",
    "claude-opus": "claude-opus-4-6",
  };
  const rawModel = body.model || "claude-haiku-4-5-20251001";
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
  if (systemPrompt) anthropicBody.system = systemPrompt;
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
            "x-api-key": anthropicKey!,
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
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

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
                const usage = event.message?.usage;
                if (usage?.input_tokens) totalInputTokens = usage.input_tokens;
              } else if (eventType === "message_delta") {
                const usage = event.usage;
                if (usage?.output_tokens) totalOutputTokens = usage.output_tokens;
              }
            } catch {
              // skip unparseable lines
            }
          }
        }

        // Final usage event
        emit({
          type: "usage",
          usage: {
            model,
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            total_tokens: totalInputTokens + totalOutputTokens,
          },
        });

        // Track usage in DB (fire-and-forget)
        try {
          const supabase = createClient(supabaseUrl, serviceKey);
          await supabase.from("user_ai_usage").insert({
            user_id: userId,
            circle_id: circleId || null,
            model,
            provider: "anthropic",
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            estimated_cost: (totalInputTokens * 0.8 + totalOutputTokens * 4.0) / 1_000_000,
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
