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
import { computeCostUsd, checkCircleClaudeBudget, logClaudeUsage, type UsageBreakdown } from "../_claude/anthropic.ts";
import {
  byokMissingMessage,
  byokUnreadableMessage,
  resolveUserModelApiKey,
  type ResolvedApiKey,
  StoredApiKeyLookupError,
} from "../_shared/edge.ts";
import { splitPromptAtCacheBoundary, buildCacheableSystemBlocks } from "../../../src/lib/promptCacheSplitCore.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

type ChatStreamTextBlock = { type: "text"; text: string };
type ChatStreamImageBlock = {
  type: "image";
  source: {
    type: "base64";
    media_type: SupportedImageMediaType;
    data: string;
  };
};
type ChatStreamContent = string | Array<ChatStreamTextBlock | ChatStreamImageBlock>;
type NormalizedChatStreamMessage = {
  role: "user" | "assistant" | "system";
  content: ChatStreamContent;
};

interface ChatStreamRequest {
  model?: string;
  messages: unknown;
  system?: unknown;
  max_tokens?: number;
  temperature?: number;
  circleId?: string;
  // Optional Anthropic tool definitions. When absent/empty, the stream is
  // text-only and behaves exactly as before — every current caller sends no
  // tools, so this is the safety boundary for the stream->tool seam.
  tools?: unknown[];
  tool_choice?: unknown;
}

const MAX_STREAM_MESSAGES = 64;
const MAX_BLOCKS_PER_MESSAGE = 16;
const MAX_TOTAL_CONTENT_BLOCKS = 256;
const MAX_TEXT_CHARS_PER_BLOCK = 120_000;
const MAX_SYSTEM_TEXT_CHARS = 200_000;
const MAX_TOTAL_TEXT_CHARS = 400_000;
const MAX_IMAGE_COUNT = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
// 10 MiB decoded images expand to ~13.34 MiB in base64. Leave bounded room
// for text + JSON framing, while rejecting obvious oversized bodies before
// `req.json()` allocates them. Chunked bodies still face the per-field guards.
const MAX_REQUEST_CONTENT_LENGTH = 16 * 1024 * 1024;
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set<SupportedImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

type ValidationState = {
  textChars: number;
  contentBlocks: number;
  imageCount: number;
  imageBytes: number;
};

type NormalizedChatInput = {
  messages: NormalizedChatStreamMessage[];
  systemPrompt: string | undefined;
};

type ChatInputValidation =
  | { ok: true; value: NormalizedChatInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isBase64AlphabetCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47
  );
}

/** Return decoded byte length for strict, unwrapped base64; null when malformed. */
function decodedBase64Length(value: string): number | null {
  if (!value || value.length > MAX_BASE64_CHARS || value.length % 4 !== 0) return null;
  let padding = 0;
  if (value.endsWith("==")) padding = 2;
  else if (value.endsWith("=")) padding = 1;
  const dataEnd = value.length - padding;
  for (let i = 0; i < dataEnd; i += 1) {
    if (!isBase64AlphabetCode(value.charCodeAt(i))) return null;
  }
  for (let i = dataEnd; i < value.length; i += 1) {
    if (value.charCodeAt(i) !== 61) return null;
  }
  // A single leftover base64 symbol cannot encode a byte. Canonical padded
  // input therefore has 2 data chars before `==` or 3 before `=`.
  const quartetDataChars = dataEnd % 4;
  if ((padding === 2 && quartetDataChars !== 2) || (padding === 1 && quartetDataChars !== 3)) return null;
  if (padding === 0 && quartetDataChars !== 0) return null;
  const bytes = (value.length / 4) * 3 - padding;
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null;
}

function imageSignatureMatches(data: string, mediaType: SupportedImageMediaType): boolean {
  try {
    // Decode only the small prefix needed for magic-byte validation. Full
    // length/alphabet/padding validation happened above, so image bytes never
    // need to be materialized a second time inside the edge function.
    const prefixChars = Math.min(data.length, 24);
    const alignedChars = prefixChars - (prefixChars % 4);
    const binary = atob(data.slice(0, alignedChars));
    const bytes = Array.from(binary, (char) => char.charCodeAt(0));
    if (mediaType === "image/jpeg") {
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    }
    if (mediaType === "image/png") {
      return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    }
    if (mediaType === "image/gif") {
      const signature = binary.slice(0, 6);
      return signature === "GIF87a" || signature === "GIF89a";
    }
    return binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP";
  } catch {
    return false;
  }
}

function addTextToBudget(text: unknown, state: ValidationState, maxChars = MAX_TEXT_CHARS_PER_BLOCK): string | null {
  if (typeof text !== "string" || text.length > maxChars) return null;
  state.textChars += text.length;
  if (state.textChars > MAX_TOTAL_TEXT_CHARS) return null;
  return text;
}

function normalizeImageBlock(
  block: Record<string, unknown>,
  role: "user" | "assistant" | "system",
  state: ValidationState,
): ChatStreamImageBlock | null {
  if (role !== "user" || !isRecord(block.source)) return null;
  const source = block.source;
  if (source.type !== "base64" || typeof source.media_type !== "string" || typeof source.data !== "string") return null;
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.has(source.media_type as SupportedImageMediaType)) return null;
  const mediaType = source.media_type as SupportedImageMediaType;
  const decodedBytes = decodedBase64Length(source.data);
  if (decodedBytes === null || decodedBytes > MAX_IMAGE_BYTES || !imageSignatureMatches(source.data, mediaType)) return null;
  if (state.imageCount >= MAX_IMAGE_COUNT || state.imageBytes + decodedBytes > MAX_TOTAL_IMAGE_BYTES) return null;
  state.imageCount += 1;
  state.imageBytes += decodedBytes;
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: source.data },
  };
}

function normalizeMessageContent(
  raw: unknown,
  role: "user" | "assistant" | "system",
  state: ValidationState,
): ChatStreamContent | null {
  if (typeof raw === "string") return addTextToBudget(raw, state);
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BLOCKS_PER_MESSAGE) return null;
  const normalized: Array<ChatStreamTextBlock | ChatStreamImageBlock> = [];
  for (const rawBlock of raw) {
    state.contentBlocks += 1;
    if (state.contentBlocks > MAX_TOTAL_CONTENT_BLOCKS || !isRecord(rawBlock)) return null;
    if (rawBlock.type === "text") {
      const text = addTextToBudget(rawBlock.text, state);
      if (text === null) return null;
      normalized.push({ type: "text", text });
      continue;
    }
    if (rawBlock.type === "image") {
      const image = normalizeImageBlock(rawBlock, role, state);
      if (!image) return null;
      normalized.push(image);
      continue;
    }
    return null;
  }
  return normalized;
}

function textOnlyContent(content: ChatStreamContent): string | null {
  if (typeof content === "string") return content;
  if (content.some((block) => block.type !== "text")) return null;
  return content.map((block) => (block as ChatStreamTextBlock).text).join("\n");
}

/**
 * Validate and normalize all model-visible input before credentials are used.
 * Errors are intentionally generic: no text, bytes, file metadata, or URLs
 * from the request are copied into responses or logs.
 */
function validateChatInput(rawMessages: unknown, rawSystem: unknown): ChatInputValidation {
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_STREAM_MESSAGES) {
    return { ok: false, error: `messages must contain 1-${MAX_STREAM_MESSAGES} items` };
  }
  const state: ValidationState = { textChars: 0, contentBlocks: 0, imageCount: 0, imageBytes: 0 };
  let directSystem = "";
  if (rawSystem !== undefined && rawSystem !== null) {
    const normalized = addTextToBudget(rawSystem, state, MAX_SYSTEM_TEXT_CHARS);
    if (normalized === null) return { ok: false, error: "system prompt is invalid or too large" };
    directSystem = normalized;
  }

  const messages: NormalizedChatStreamMessage[] = [];
  const systemParts: string[] = directSystem ? [directSystem] : [];
  for (const rawMessage of rawMessages) {
    if (!isRecord(rawMessage)) return { ok: false, error: "message is invalid" };
    const role = rawMessage.role;
    if (role !== "user" && role !== "assistant" && role !== "system") {
      return { ok: false, error: "message role is invalid" };
    }
    const content = normalizeMessageContent(rawMessage.content, role, state);
    if (content === null) {
      return { ok: false, error: "message content or image input is invalid, unsupported, or over the size limit" };
    }
    if (role === "system") {
      const text = textOnlyContent(content);
      if (text === null) return { ok: false, error: "system messages must be text-only" };
      systemParts.push(text);
    } else {
      // normalizeMessageContent already rejects image blocks for assistant.
      messages.push({ role, content });
    }
  }
  if (messages.length === 0) return { ok: false, error: "at least one user or assistant message is required" };
  const systemPrompt = systemParts.filter(Boolean).join("\n\n") || undefined;
  if (systemPrompt && systemPrompt.length > MAX_SYSTEM_TEXT_CHARS) {
    return { ok: false, error: "combined system prompt is too large" };
  }
  return { ok: true, value: { messages, systemPrompt } };
}

function credentialErrorResponse(
  status: 400 | 409,
  code: "key_missing" | "credential_unreadable",
  message: string,
): Response {
  return new Response(JSON.stringify({ error: message, code }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

  const declaredContentLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(declaredContentLength) && declaredContentLength > MAX_REQUEST_CONTENT_LENGTH) {
    return new Response(JSON.stringify({ error: "Request body is too large", code: "validation" }), {
      status: 413,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
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

  const { max_tokens, temperature, circleId, tools, tool_choice } = body;
  const validatedInput = validateChatInput(body.messages, body.system);
  if (!validatedInput.ok) {
    return new Response(JSON.stringify({ error: validatedInput.error, code: "validation" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { messages, systemPrompt } = validatedInput.value;
  // Single source of truth for "are we in tool mode": only true when the
  // caller actually supplied tool definitions. Everything tool-related below
  // is gated on this so the no-tools path stays byte-for-byte unchanged.
  const hasTools = Array.isArray(tools) && tools.length > 0;
  let anthropicKey: ResolvedApiKey | null;
  try {
    anthropicKey = await resolveUserModelApiKey({
      supabase: svc,
      userId,
      provider: "anthropic",
      label: null,
      credentialPolicy: "user_required",
    });
  } catch (error) {
    if (error instanceof StoredApiKeyLookupError) {
      return credentialErrorResponse(
        409,
        "credential_unreadable",
        byokUnreadableMessage("anthropic"),
      );
    }
    throw error;
  }
  if (!anthropicKey) {
    return credentialErrorResponse(
      400,
      "key_missing",
      byokMissingMessage("anthropic"),
    );
  }

  // Circle attribution guard — circleId is caller-supplied and drives the
  // service-role budget read (whose numbers are echoed in the 429 body) and
  // both usage ledgers. Confirm the authenticated caller belongs to the circle
  // before consuming it; on a non-member, drop attribution (effectiveCircleId
  // = undefined) so spend is recorded un-attributed instead of disclosing or
  // mis-charging another circle. userId is guaranteed non-null here.
  let effectiveCircleId = circleId;
  if (effectiveCircleId) {
    const { data: membership } = await svc
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", effectiveCircleId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) effectiveCircleId = undefined;
  }

  // Umbrella circle cap — chat-stream is the highest-volume streaming
  // surface so the 24h total-spend ceiling matters here. Skip when
  // caller didn't pass a circleId (e.g. prompt playground previews).
  if (effectiveCircleId) {
    try {
      const cap = await checkCircleClaudeBudget(svc, effectiveCircleId);
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
  // Canonical short IDs per Anthropic — no date suffixes. Opus points at 4.8
  // (latest Opus); callers who need 4.6/4.7 can pass those IDs directly.
  const MODEL_MAP: Record<string, string> = {
    "claude-haiku": "claude-haiku-4-5",
    "claude-haiku-4-5": "claude-haiku-4-5",
    "claude-sonnet": "claude-sonnet-5",
    "claude-fable": "claude-fable-5",
    "claude-fable-5": "claude-fable-5",
    "claude-opus-5": "claude-opus-5",
    "claude-sonnet-5": "claude-sonnet-5",
    "claude-opus": "claude-opus-5",
    "claude-opus-4-8": "claude-opus-4-8",
    "claude-opus-4-7": "claude-opus-4-7",
  };
  const rawModel = body.model || "claude-haiku-4-5";
  const model = MODEL_MAP[rawModel] || rawModel;

  // Build Anthropic request with streaming enabled
  const chatMessages = messages.map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));

  const anthropicBody: Record<string, unknown> = {
    model,
    messages: chatMessages,
    max_tokens: max_tokens || 2048,
    stream: true,
  };
  // Split the system prompt at the shared cache boundary so cache_control sits
  // on the STABLE prefix ONLY. Prompt caching is a prefix match, so a single
  // breakpoint at the end (the old behavior) cached the volatile tail too and
  // the key changed every turn → ~never a hit. Splitting freezes the stable
  // prefix (identity/personality/how-to-think) and leaves the per-turn tail
  // (current context, directive, recent chat, extras) uncached. When the prompt
  // carries no boundary marker, this degrades to a single cached block —
  // byte-identical to the old single-breakpoint behavior.
  if (systemPrompt) {
    const split = splitPromptAtCacheBoundary(systemPrompt);
    anthropicBody.system = buildCacheableSystemBlocks(split.frozenPrefix, split.dynamicTail);
  }
  if (temperature !== undefined && !model.includes("opus")) {
    anthropicBody.temperature = temperature;
  }
  // Tool mode: forward the caller's tool definitions to the Messages stream so
  // it can emit tool_use content blocks. Default tool_choice to auto. Guarded
  // by hasTools — when no tools are passed, neither field is added and the
  // request to Anthropic is identical to the text-only path.
  if (hasTools) {
    anthropicBody.tools = tools;
    anthropicBody.tool_choice = tool_choice ?? { type: "auto" };
  }

  // Forward the stream via SSE
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(data: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }
      // Named SSE event (adds an `event:` line before `data:`). Only used for
      // the tool_use channel introduced by the stream->tool seam; plain text
      // deltas keep using the unnamed `emit` above so their wire bytes are
      // unchanged.
      function emitNamedEvent(eventName: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`),
        );
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

        // Tool-use reassembly state (tool mode only). Anthropic streams a
        // tool_use block as content_block_start -> input_json_delta(s) ->
        // content_block_stop; we accumulate the partial JSON per block index
        // and parse it on stop. `stopReason` is captured from message_delta so
        // it can ride along on the terminal `done` event.
        const toolBlocks: Record<number, { id: string; name: string; jsonbuf: string }> = {};
        let stopReason: string | null = null;

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
                } else if (hasTools && delta?.type === "input_json_delta") {
                  // Accumulate streamed tool-input JSON for the matching block.
                  const block = toolBlocks[event.index];
                  if (block) block.jsonbuf += (delta.partial_json || "");
                }
              } else if (hasTools && eventType === "content_block_start") {
                // Begin tracking a tool_use block; ignore text blocks (they go
                // through the text_delta path above unchanged).
                const cb = event.content_block;
                if (cb?.type === "tool_use") {
                  toolBlocks[event.index] = { id: cb.id, name: cb.name, jsonbuf: "" };
                }
              } else if (hasTools && eventType === "content_block_stop") {
                // A tool_use block finished — parse its accumulated input and
                // emit it as a named tool_use SSE event. Empty buffer means a
                // no-argument tool, which parses as {}.
                const block = toolBlocks[event.index];
                if (block) {
                  delete toolBlocks[event.index];
                  let input: unknown = {};
                  try {
                    input = block.jsonbuf ? JSON.parse(block.jsonbuf) : {};
                  } catch {
                    input = {};
                  }
                  emitNamedEvent("tool_use", { id: block.id, name: block.name, input });
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
                // Capture the final stop_reason (e.g. "tool_use" | "end_turn")
                // for the terminal done event. Tool mode only — keeps the
                // text-only path untouched.
                if (hasTools && event.delta?.stop_reason) {
                  stopReason = event.delta.stop_reason;
                }
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

        // Track usage in both ledgers:
        // - user_ai_usage powers per-message cost drawers.
        // - claude_api_usage powers the 24h Claude spend cap/dashboard.
        try {
          const supabase = createClient(supabaseUrl, serviceKey);
          await Promise.allSettled([
            supabase.from("user_ai_usage").insert({
              user_id: userId,
              circle_id: effectiveCircleId || null,
              model,
              provider: "anthropic",
              input_tokens: usage.uncachedIn,
              output_tokens: usage.output,
              cache_creation_tokens: usage.cacheCreate,
              cache_read_tokens: usage.cacheRead,
              estimated_cost: estimatedCost,
              source: "chat-stream",
            }),
            logClaudeUsage(supabase, {
              circleId: effectiveCircleId || null,
              userId,
              source: "chat-stream",
              model,
              usage,
              metadata: { streaming: true },
            }),
          ]);
        } catch { /* non-critical */ }

        // Terminal event. In tool mode, carry the captured stop_reason so the
        // client can decide whether to escalate to the tool loop (stop_reason
        // === "tool_use"). The text-only path emits the original {type:"done"}
        // unchanged.
        emit(hasTools ? { type: "done", stop_reason: stopReason } : { type: "done" });
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
