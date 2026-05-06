// build-stream — Supabase Edge Function
//
// Streams a /build-page generation from Claude back to the client as
// Server-Sent Events. Kept separate from swanbot-ai intentionally: the
// main chat flow doesn't need to know about streaming, and any bug here
// cannot break the primary chat path.
//
// Protocol (output):
//   event: delta        data: {"text": "<html>"}
//   event: delta        data: {"text": "<head>…"}
//   event: phase        data: {"name": "writing index.html"}
//   event: done         data: {"text": "…full text…", "tokens_out": 1842}
//   event: error        data: {"error": "…"}
//
// Input body:
//   { "brief": "…required…", "model": "claude-haiku-4-5-20251001", "system_extra": "…optional…" }
//
// Deploy: npx supabase functions deploy build-stream
// Users must save their own Anthropic key. Platform key fallback is owner-only.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { logClaudeUsage, type UsageBreakdown } from "../_claude/anthropic.ts";
import { byokMissingMessage, getAuthenticatedUser, resolveUserModelApiKey } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "content-type",
};

// Canonical short IDs (no date suffix). `claude-opus` points at 4.7 (the
// latest), matching the rest of the app — build-stream had been left on
// 4.6 during the earlier sweep because it wasn't deployed yet.
const CLAUDE_MODEL_MAP: Record<string, string> = {
  "auto": "claude-haiku-4-5",
  "claude-haiku": "claude-haiku-4-5",
  "claude-haiku-4-5": "claude-haiku-4-5",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-opus": "claude-opus-4-7",
  "claude-opus-4-7": "claude-opus-4-7",
  "claude-opus-4-6": "claude-opus-4-6",
};

const DEFAULT_SYSTEM = `You are OpenSwan's Web Page Builder, a senior frontend engineer who ships
clean, responsive, single-file HTML landing pages.

RESPONSE RULES
- Return ONE complete HTML document starting with <!DOCTYPE html>. No prose.
- Include inline <style> in <head> and inline <script> only if interactive.
- Default to a modern look: system font stack, generous whitespace, semantic HTML.
- Responsive: single-column mobile → two-column ≥768px. No horizontal scrolling.
- Use real copy for the brief — no lorem ipsum, no placeholder brackets.
- Do NOT fabricate image URLs. Use CSS gradients or SVG for visuals unless the
  user specifies a real image URL.
- Accessibility: alt text on images, aria-label on icon buttons, contrast AA.
- Keep under ~400 lines. Beyond that you're probably adding unnecessary demo content.

ANTI-PATTERNS — do not do these
- Do not wrap the HTML in markdown fences (no \`\`\`html). Output the raw document.
- Do not include a chat preamble like "Here's your landing page".
- Do not emit placeholder URLs like "example.com" unless explicitly requested.
`;

interface StreamRequest {
  brief: string;
  model?: string;
  system_extra?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: StreamRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.brief || typeof body.brief !== "string") {
    return new Response(JSON.stringify({ error: "brief required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const user = await getAuthenticatedUser(req);
  if (!user) {
    return new Response(JSON.stringify({ error: "Valid JWT required", code: "unauthenticated" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = await resolveUserModelApiKey({
    supabase,
    userId: user.id,
    provider: "anthropic",
    envVarName: "ANTHROPIC_API_KEY",
  });
  if (!apiKey) {
    return new Response(JSON.stringify({ error: byokMissingMessage("anthropic"), code: "key_missing" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const modelKey = (body.model && CLAUDE_MODEL_MAP[body.model]) ? body.model : "auto";
  const model = CLAUDE_MODEL_MAP[modelKey];

  const system = body.system_extra
    ? `${DEFAULT_SYSTEM}\n\nADDITIONAL CONSTRAINTS\n${body.system_extra}`
    : DEFAULT_SYSTEM;

  // Kick off the upstream streaming request
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      // cache_control on the system prompt — DEFAULT_SYSTEM is stable across
      // all /build-stream calls and system_extra is typically short or
      // reused, so this yields ephemeral cache reads on repeat builds.
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      stream: true,
      messages: [
        { role: "user", content: `Build a landing page for: ${body.brief}` },
      ],
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(JSON.stringify({ error: `Anthropic ${upstream.status}: ${errText.slice(0, 500)}` }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pipe Anthropic SSE → our SSE. We translate event names into our small
  // protocol so the client doesn't depend on Anthropic wire format.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffered = "";
      let fullText = "";
      let tokensOut = 0;
      let lastPhaseEmit = 0;
      // Track full usage breakdown for cache-aware telemetry. message_start
      // has the initial input + cache numbers; message_delta updates output.
      const usage: UsageBreakdown = { uncachedIn: 0, cacheCreate: 0, cacheRead: 0, output: 0 };

      const emit = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const emitPhaseIfDue = () => {
        // Cheap phase heuristic — give the user *some* signal without relying
        // on Claude to think in explicit steps. Switches label at rough
        // character thresholds so the UI feels alive.
        const now = Date.now();
        if (now - lastPhaseEmit < 800) return;
        lastPhaseEmit = now;
        let phase = "planning";
        if (fullText.length > 80) phase = "scaffolding";
        if (fullText.includes("<head")) phase = "writing head";
        if (fullText.includes("<style")) phase = "writing styles";
        if (fullText.includes("<body")) phase = "writing body";
        if (fullText.includes("<script")) phase = "writing script";
        if (fullText.includes("</html>")) phase = "finalizing";
        emit("phase", { name: phase });
      };

      try {
        emit("phase", { name: "planning" });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });

          // SSE frames are separated by \n\n. Parse all complete frames we
          // have buffered; leave any partial frame for the next tick.
          const frames = buffered.split("\n\n");
          buffered = frames.pop() || "";

          for (const frame of frames) {
            const lines = frame.split("\n");
            let eventName = "";
            let dataStr = "";
            for (const line of lines) {
              if (line.startsWith("event: ")) eventName = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataStr += line.slice(6);
            }
            if (!dataStr) continue;
            let data: any;
            try { data = JSON.parse(dataStr); } catch { continue; }

            if (eventName === "content_block_delta") {
              const delta = data?.delta;
              if (delta?.type === "text_delta" && typeof delta.text === "string") {
                fullText += delta.text;
                emit("delta", { text: delta.text });
                emitPhaseIfDue();
              }
            } else if (eventName === "message_start") {
              const u = data?.message?.usage;
              if (u) {
                usage.uncachedIn  = u.input_tokens                ?? 0;
                usage.cacheCreate = u.cache_creation_input_tokens ?? 0;
                usage.cacheRead   = u.cache_read_input_tokens     ?? 0;
              }
            } else if (eventName === "message_delta" && data?.usage?.output_tokens) {
              tokensOut = data.usage.output_tokens;
              usage.output = data.usage.output_tokens;
            } else if (eventName === "error") {
              emit("error", { error: data?.error?.message || "upstream stream error" });
              controller.close();
              return;
            }
          }
        }
        emit("done", { text: fullText, tokens_out: tokensOut });
        controller.close();

        logClaudeUsage(supabase, {
          circleId: null,
          userId: user.id,
          source: "build-stream",
          model,
          usage,
          metadata: { brief_length: body.brief.length },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        emit("error", { error: msg });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
