// computer-use-agent — autonomous browser/computer use via Anthropic's
// native computer_use tool, streamed back as SSE so the client can render
// the agent thinking + acting live (same pattern as Perplexity's
// Personal Computer feature).
//
// Flow:
//   1. Client POSTs { task, circleId, browserbase: {apiKey, projectId} }
//   2. Server opens a Browserbase session (or reuses one by sessionId).
//   3. Loop:
//        - Call Claude with conversation + tool_result from previous turn.
//        - Claude returns either (a) a tool_use asking for a browser action,
//          or (b) a final text answer (stop_reason: 'end_turn').
//        - If tool_use: execute against Browserbase → capture screenshot +
//          current_url → emit SSE → feed back to Claude as tool_result.
//        - If end_turn: emit `result` SSE with the final answer + session
//          link, close stream.
//   4. Safety rails: max 20 iterations, 200k token budget, 5-minute wall
//      clock, per-action timeout.
//
// SSE protocol (outbound):
//   event: action      data: {"tool":"screenshot","input":{...}}
//   event: screenshot  data: {"b64":"...","url":"https://..."}
//   event: reasoning   data: {"text":"I'll search for..."}
//   event: result      data: {"summary":"Found 5 matches","url":"...","tokens":1234}
//   event: error       data: {"message":"..."}

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import {
  callClaude,
  computeCostUsd,
  addUsage,
  checkCircleClaudeBudget,
  logClaudeUsage,
  EMPTY_USAGE,
  type UsageBreakdown,
} from "../_claude/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Opus 4.7 is the right choice here — computer use wants the best planning
// and screenshot-understanding the app has. Haiku is too thin for visual
// reasoning, Sonnet works but Opus is markedly more reliable on multi-step
// tasks where a bad click early snowballs.
const AGENT_MODEL = "claude-opus-4-7";

// Anthropic's computer-use tool spec. The viewport is a reasonable
// middle-ground — matches what Browserbase ships by default.
const COMPUTER_USE_TOOL = {
  type: "computer_20250124",
  name: "computer",
  display_width_px: 1280,
  display_height_px: 800,
  display_number: 1,
};

// Basic bash tool so the agent can think out loud or do small shell tasks
// inside the Browserbase container (rare but useful for file downloads).
const BASH_TOOL = {
  type: "bash_20250124",
  name: "bash",
};

// Custom `ask_user` tool — Claude calls it before taking any action the
// system prompt flagged as risky (purchases, submissions, credential
// entry, anything irreversible). The edge function inserts a row in
// `computer_use_confirmations`, emits an SSE event, and polls the row
// until the user picks an option (or a timeout). This is the stop-and-
// confirm flow without needing a second transport channel.
const ASK_USER_TOOL = {
  name: "ask_user",
  description:
    "Pause and ask the user to confirm before taking a risky or irreversible action. " +
    "Always call this before clicking 'Confirm Purchase', 'Submit Payment', 'Delete', " +
    "'Send', or similar buttons; before entering credentials or payment info; and before " +
    "posting publicly. The tool returns the user's choice as a string.",
  input_schema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "The specific question to ask the user, e.g. 'Confirm purchase of $2,499.00 " +
          "to Amazon for the Sony A7IV camera?' — include the amount and merchant where possible.",
      },
      options: {
        type: "array",
        description:
          "Choices to offer. Defaults to ['Yes, continue', 'No, cancel'] when omitted. " +
          "Keep labels short (<30 chars).",
        items: { type: "string" },
      },
      context: {
        type: "string",
        description:
          "Optional one-line context — what page you're on, what you're about to do.",
      },
    },
    required: ["question"],
  },
};

interface AgentRequest {
  task: string;
  circleId: string;
  userId?: string;
  /** Optional: resume an existing Browserbase session. */
  sessionId?: string;
  /** Credentials for Browserbase. Caller pulls these from circle
   *  integrations + passes through. */
  browserbase: {
    apiKey: string;
    projectId: string;
    region?: string;
  };
  /** Max iterations. Defaults to 20. */
  maxIterations?: number;
  /** Max tokens budget. Defaults to 200_000. */
  maxTokensBudget?: number;
  /** Max USD cost for this task. Aborts the run gracefully if the
   *  estimated cost would exceed this. Defaults to the circle's
   *  `computer_use_max_cost_usd` setting, else $2.00. */
  maxCostUsd?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!body.task || !body.browserbase?.apiKey) {
    return new Response(JSON.stringify({ error: "task and browserbase credentials required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Service-role Supabase client for persistence + follow-up-context reads.
  const svcUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = svcUrl && svcKey ? createClient(svcUrl, svcKey) : null;

  // Pull the most recent completed run for this circle to inject as
  // follow-up context. Caps the window at 30 minutes so day-old tasks
  // don't bleed into unrelated sessions.
  let followUpContext = "";
  if (supabase && body.circleId) {
    try {
      const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("computer_use_runs")
        .select("task, summary, findings")
        .eq("circle_id", body.circleId)
        .eq("status", "done")
        .gte("completed_at", since)
        .order("completed_at", { ascending: false })
        .limit(1);
      const prev = data?.[0];
      if (prev?.summary) {
        const findingsBlurb = Array.isArray(prev.findings) && prev.findings.length
          ? `\nKey items from that run:\n${(prev.findings as any[])
              .slice(0, 5)
              .map((f: any, i: number) => `${i + 1}. ${f.title || "(untitled)"}${f.url ? ` — ${f.url}` : ""}${f.price ? ` (${f.price})` : ""}`)
              .join("\n")}`
          : "";
        followUpContext = `Your previous task in this circle:\n"${prev.task}"\n\nWhat you found:\n${String(prev.summary).slice(0, 1200)}${findingsBlurb}\n\nIf the user's new task is a follow-up ("tell me more about #3", "continue", "the cheapest one"), leverage that context. If it's unrelated, ignore it.`;
      }
    } catch { /* follow-up context is a nice-to-have; never block the run */ }
  }

  // Insert the initial run row so clients can track it in real-time even
  // before completion.
  let runId: string | null = null;
  if (supabase) {
    try {
      const { data } = await supabase
        .from("computer_use_runs")
        .insert({
          circle_id: body.circleId,
          user_id: body.userId || null,
          task: body.task,
          status: "running",
        })
        .select("id")
        .single();
      runId = data?.id || null;
    } catch { /* persistence is best-effort */ }
  }

  const maxIterations = Math.min(body.maxIterations ?? 20, 40);
  const maxTokensBudget = Math.min(body.maxTokensBudget ?? 200_000, 500_000);

  // Per-circle budget cap — read from `circles.settings.computer_use_max_cost_usd`
  // unless the caller passed an explicit override. Defaults to $2. Any
  // iteration that would push running cost above this aborts the run
  // gracefully with a summary of what was done so far.
  let maxCostUsd = typeof body.maxCostUsd === "number" && body.maxCostUsd > 0 ? body.maxCostUsd : 2;
  if (supabase && body.circleId && typeof body.maxCostUsd !== "number") {
    try {
      const { data } = await supabase
        .from("circles")
        .select("settings")
        .eq("id", body.circleId)
        .maybeSingle();
      const configured = (data?.settings as any)?.computer_use_max_cost_usd;
      if (typeof configured === "number" && configured > 0) maxCostUsd = configured;
    } catch { /* fall back to default */ }
  }

  // Umbrella Claude cap — a tighter `claude_total_max_cost_usd` than
  // the per-run CU cap should block the launch. Return a 429 BEFORE we
  // spin up a Browserbase session (those cost real $ too). Fail-open if
  // the check itself errors.
  if (supabase && body.circleId) {
    const umbrella = await checkCircleClaudeBudget(supabase, body.circleId);
    if (!umbrella.allowed) {
      return new Response(JSON.stringify({
        error: "circle_claude_budget_exceeded",
        detail: umbrella.reason,
        spent24h: umbrella.spent24h,
        cap: umbrella.cap,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* stream may be closed */ }
      };
      const closeStream = () => { try { controller.close(); } catch {} };

      // Running totals via the shared `UsageBreakdown` type — matches
      // Anthropic's billing structure (cache reads 10% of input, creates 1.25x).
      let usage: UsageBreakdown = { ...EMPTY_USAGE };
      const startTime = Date.now();
      const DEADLINE_MS = 5 * 60 * 1000;

      // Conversation messages for the Claude loop. Prepend follow-up
      // context (from the most recent completed run in this circle) so
      // the agent can thread continuity across tasks without requiring
      // the user to restate history.
      const userContent = followUpContext
        ? `${followUpContext}\n\n---\n\nNew task:\n${body.task}`
        : body.task;
      const messages: Array<{ role: string; content: any }> = [
        { role: "user", content: userContent },
      ];

      if (runId) emit("run_started", { runId });

      // Heartbeat every 10s so the client's stream reader has a reason to
      // show "still thinking" progress even when Claude is mid-reasoning
      // and no `action` / `reasoning` events are firing for a while. Keeps
      // the connection alive through proxies that idle-close after 30s.
      const heartbeat = setInterval(() => {
        emit("heartbeat", { at: Date.now() });
      }, 10_000);
      const clearHeartbeat = () => { try { clearInterval(heartbeat); } catch {} };

      try {
        // ── Open or reuse Browserbase session ─────────────────────────
        const { sessionId, liveUrl } = body.sessionId
          ? { sessionId: body.sessionId, liveUrl: `https://www.browserbase.com/sessions/${body.sessionId}` }
          : await openBrowserbaseSession(body.browserbase);
        emit("session_started", { sessionId, liveUrl });

        // ── Agent loop ────────────────────────────────────────────────
        for (let iter = 0; iter < maxIterations; iter++) {
          if (Date.now() - startTime > DEADLINE_MS) {
            emit("error", {
              message: `Timed out after ${iter} iteration${iter === 1 ? '' : 's'} (5-minute limit). The task is too long for one run — try splitting it, or narrow the scope (e.g. "just the top 3 results").`,
            });
            break;
          }
          // Token cap is "new work only" — cache reads don't count because
          // they're free re-use of prior context. Uncached input + output +
          // cache creates (these write real new tokens) is the right budget.
          const newWorkTokens = usage.uncachedIn + usage.cacheCreate + usage.output;
          if (newWorkTokens > maxTokensBudget) {
            emit("error", {
              message: `Token budget reached: ${newWorkTokens.toLocaleString()} > ${maxTokensBudget.toLocaleString()}. Too much to read this run — narrow the task or break it up.`,
            });
            break;
          }
          const runningCost = computeCostUsd(AGENT_MODEL, usage);
          if (runningCost > maxCostUsd) {
            emit("error", { message: `Budget cap reached: $${runningCost.toFixed(4)} > $${maxCostUsd.toFixed(2)}. Raise the cap in circle settings or run a narrower task.` });
            break;
          }

          const claudeResponse = await callClaudeWithTools(apiKey, messages);
          usage = addUsage(usage, claudeResponse.usage);
          // Running ticker — cache-aware. `inputTokens` stays the total
          // input-side count (uncached + create + read) for backwards
          // compat with old clients; new clients read `cachedTokens`
          // separately to surface the cache-hit rate.
          const totalInputSide = usage.uncachedIn + usage.cacheCreate + usage.cacheRead;
          emit("usage", {
            iteration: iter + 1,
            inputTokens:  totalInputSide,
            outputTokens: usage.output,
            uncachedInputTokens: usage.uncachedIn,
            cacheCreateTokens:   usage.cacheCreate,
            cacheReadTokens:     usage.cacheRead,
            estimatedCost: computeCostUsd(AGENT_MODEL, usage),
          });

          // Record the assistant's turn verbatim so tool_use_id refs resolve
          // next iteration.
          messages.push({ role: "assistant", content: claudeResponse.content });

          // Surface any thinking / text blocks as reasoning events.
          for (const block of claudeResponse.content) {
            if (block.type === "text" && block.text) {
              emit("reasoning", { text: block.text });
            }
          }

          // End turn — agent believes it's done.
          if (claudeResponse.stop_reason === "end_turn") {
            const finalText = claudeResponse.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n")
              .trim();

            // Parse structured findings if the agent emitted them.
            // Supports either <FINDINGS>[...]</FINDINGS> tags OR a single
            // fenced ```json code block containing an array. The array
            // items are intentionally loosely typed — caller renders
            // whatever fields exist (title, url, price, rating, notes,
            // thumbnail, etc.) so the agent has freedom to shape output
            // for different task types.
            const { findings, summaryWithoutFindings } = extractStructuredFindings(finalText);
            const summary = summaryWithoutFindings || "(agent finished without a written summary)";
            // Mark the run complete in DB (best-effort — do this BEFORE
            // emitting so a disconnected client can still see the final
            // state via the follow-up-context read on the next run).
            const finalCost = computeCostUsd(AGENT_MODEL, usage);
            const totalInputSideFinal = usage.uncachedIn + usage.cacheCreate + usage.cacheRead;
            if (supabase && runId) {
              try {
                await supabase
                  .from("computer_use_runs")
                  .update({
                    status: "done",
                    session_id: sessionId,
                    live_url: liveUrl,
                    summary,
                    findings,
                    iterations: iter + 1,
                    input_tokens: totalInputSideFinal,
                    output_tokens: usage.output,
                    estimated_cost: finalCost,
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", runId);
              } catch { /* best-effort */ }
            }
            emit("result", {
              summary,
              findings,
              sessionId,
              liveUrl,
              tokens: {
                input:       totalInputSideFinal,
                output:      usage.output,
                uncachedIn:  usage.uncachedIn,
                cacheCreate: usage.cacheCreate,
                cacheRead:   usage.cacheRead,
              },
              iterations: iter + 1,
              runId,
            });
            break;
          }

          // Otherwise expect tool_use blocks; execute each and reply.
          const toolUses = claudeResponse.content.filter((b: any) => b.type === "tool_use");
          if (toolUses.length === 0) {
            emit("error", {
              message: "Agent stalled — Claude neither finished nor asked for a tool. Try re-running the task; if it repeats, rephrase it more concretely.",
            });
            break;
          }

          const toolResults: Array<{ type: string; tool_use_id: string; content: any }> = [];
          for (const tu of toolUses) {
            emit("action", { tool: tu.name, input: tu.input });
            try {
              // Stop-and-confirm: when Claude calls `ask_user`, pause the
              // loop and wait for the client to write a decision. No real
              // browser action fires until the user answers (or times out).
              if (tu.name === "ask_user") {
                const question = String((tu.input as any)?.question || "Confirm this action?");
                const options = Array.isArray((tu.input as any)?.options) && (tu.input as any).options.length
                  ? ((tu.input as any).options as string[])
                  : ["Yes, continue", "No, cancel"];
                const ctx = typeof (tu.input as any)?.context === "string" ? (tu.input as any).context : null;
                const choice = await askUserAndWait(supabase, runId, question, options, ctx, emit);
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: tu.id,
                  content: [{ type: "text", text: `User chose: ${choice}` }],
                });
                continue;
              }

              const out = await runTool(body.browserbase, sessionId, tu.name, tu.input);
              if (out.screenshot) {
                emit("screenshot", { b64: out.screenshot, url: out.currentUrl });
              }
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: out.screenshot
                  ? [
                      { type: "image", source: { type: "base64", media_type: "image/png", data: out.screenshot } },
                      ...(out.text ? [{ type: "text", text: out.text }] : []),
                    ]
                  : [{ type: "text", text: out.text || "(no output)" }],
              });
            } catch (err: any) {
              emit("error", { message: `Tool ${tu.name} failed: ${err?.message || err}` });
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: [{ type: "text", text: `Tool error: ${err?.message || err}` }],
              });
            }
          }
          messages.push({ role: "user", content: toolResults });
        }

        // Fire usage log to claude_api_usage (best-effort). The shared
        // helper handles cache columns + cost math so every edge function
        // reports the same way.
        await logClaudeUsage(supabase, {
          circleId: body.circleId || null,
          userId:   body.userId   || null,
          source:   "computer-use-agent",
          model:    AGENT_MODEL,
          usage,
          metadata: { task: body.task.slice(0, 200), runId },
        });
      } catch (err: any) {
        const errMsg = err?.message || "agent crashed unexpectedly";
        // Mark the run failed in DB too so the history panel and
        // follow-up context both reflect the outcome.
        if (supabase && runId) {
          try {
            await supabase
              .from("computer_use_runs")
              .update({
                status: "error",
                error_message: errMsg,
                iterations: 0,
                input_tokens: usage.uncachedIn + usage.cacheCreate + usage.cacheRead,
                output_tokens: usage.output,
                estimated_cost: computeCostUsd(AGENT_MODEL, usage),
                completed_at: new Date().toISOString(),
              })
              .eq("id", runId);
          } catch {}
        }
        emit("error", { message: errMsg });
      } finally {
        clearHeartbeat();
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
});

// ── Helpers ─────────────────────────────────────────────────────────────

// System prompt the agent reads on every turn. Kept stable across calls so
// prompt caching (cache_control below) turns the second+ turn into a cache
// hit — ~10% of the input-token cost.
const AGENT_SYSTEM_PROMPT = `You are an autonomous web agent driving a real Chrome browser on behalf of a user.

BEHAVIOR
- Take screenshots frequently (before acting, after a page loads, and whenever you're unsure what's visible).
- Navigate by clicking on what you actually see in the screenshot — do NOT invent pixel coordinates.
- When you type, type the exact text you intend. Don't type "username" literally unless that's the value.
- When you're unsure which element to click, scroll to bring it into view first, then re-screenshot.
- Prefer reading visible text to guessing layout. If you can't see it, take a screenshot.

TASK COMPLETION
- When you've completed the user's task, write a concise summary (3-8 bullets or 1-3 paragraphs) and STOP. Do NOT emit another tool call.
- The summary should include concrete findings (prices, links, names, quotes) — not meta-commentary about what you did.
- If the task can't be completed (blocked by login, paywall, captcha, stale info), explain what stopped you and stop.

SAFETY
- ALWAYS call the \`ask_user\` tool BEFORE clicking any "Purchase", "Buy now", "Confirm", "Pay", "Submit", "Send", "Delete", "Publish", or similar button that commits a change. Include the specific amount and merchant/target in the question.
- ALWAYS call \`ask_user\` before entering credentials, payment info, personal info, or posting publicly.
- If the user's task explicitly asked for that exact action ("buy X for $Y"), still call \`ask_user\` once at the commit step to confirm the final details.
- Never guess credentials. If a site requires login you weren't given, call \`ask_user\` with the question "Log in as who?" and wait for direction.
- If a site shows a CAPTCHA or 2FA, stop and report via a text summary — do not keep trying.

DO NOT
- Do not use the bash tool for anything — it's not available here. Use the computer tool for everything.
- Do not emit a <BUILD_READY> or <TOOL> marker. This is a computer-use agent, not a codegen agent.

STRUCTURED FINDINGS (for research / comparison / list tasks)
If the user asked for a list of items — products, articles, results, places, options, anything
countable — end your response with a structured <FINDINGS> block AFTER your human summary.
Format, verbatim including the tags:

<FINDINGS>
[
  {"title": "...", "url": "...", "price": "...", "rating": "...", "notes": "one short sentence", "thumbnail": "..."},
  ...
]
</FINDINGS>

- Fields are all optional EXCEPT \`title\`. Include what you actually found.
- \`url\` should be the direct product/article/page link, not a search results page.
- \`price\` is a plain string with currency ("$499", "£12/mo", "Free").
- \`thumbnail\` is optional; include only if you saw a clean product image URL.
- Emit at most 10 items.
- Do NOT emit a FINDINGS block for non-list tasks (single-fact lookups, transactions, etc).`;

// Thin wrapper around the shared `callClaude()` — pins the computer-use
// beta header + the frozen system prompt (cached automatically). The
// agent loop uses `.content`, `.stop_reason`, and `.usage` directly.
async function callClaudeWithTools(apiKey: string, messages: Array<{ role: string; content: any }>) {
  return await callClaude({
    apiKey,
    model: AGENT_MODEL,
    maxTokens: 8192,
    system: AGENT_SYSTEM_PROMPT,
    tools: [COMPUTER_USE_TOOL, BASH_TOOL, ASK_USER_TOOL],
    messages,
    betaHeaders: ["computer-use-2025-01-24"],
  });
}

// ── Stop-and-confirm helper ─────────────────────────────────────────────
// Inserts a row in `computer_use_confirmations`, emits an SSE event so the
// client can render an approval card, and polls for the user's choice.
// If the client doesn't answer within 2 minutes we treat the action as
// rejected — better to stall than silently execute a risky action.

async function askUserAndWait(
  supabase: any,
  runId: string | null,
  question: string,
  options: string[],
  context: string | null,
  emit: (event: string, data: unknown) => void,
): Promise<string> {
  if (!supabase || !runId) {
    // No persistence available — can't park the decision anywhere.
    // Emit the event so the client sees it and default to reject so
    // nothing risky happens without user input.
    emit("confirmation_required", { id: null, question, options, context, timeoutSec: 0 });
    return options.find((o) => /^no/i.test(o) || /cancel/i.test(o)) || "No";
  }

  const TIMEOUT_MS = 120_000;
  const POLL_MS = 500;

  let confirmationId: string | null = null;
  try {
    const { data } = await supabase
      .from("computer_use_confirmations")
      .insert({ run_id: runId, question, options, context })
      .select("id")
      .single();
    confirmationId = data?.id || null;
  } catch {
    // DB insert failed — same conservative fallback as above.
    emit("confirmation_required", { id: null, question, options, context, timeoutSec: 0 });
    return options.find((o) => /^no/i.test(o) || /cancel/i.test(o)) || "No";
  }

  emit("confirmation_required", {
    id: confirmationId,
    question,
    options,
    context,
    timeoutSec: Math.floor(TIMEOUT_MS / 1000),
  });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const { data } = await supabase
        .from("computer_use_confirmations")
        .select("choice, resolved_at")
        .eq("id", confirmationId)
        .maybeSingle();
      if (data?.choice && data?.resolved_at) {
        emit("confirmation_resolved", { id: confirmationId, choice: data.choice });
        return String(data.choice);
      }
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  // Timeout: mark rejected so stale rows don't hang around as "pending".
  try {
    await supabase
      .from("computer_use_confirmations")
      .update({ choice: "__timeout__", resolved_at: new Date().toISOString() })
      .eq("id", confirmationId);
  } catch {}
  emit("confirmation_resolved", { id: confirmationId, choice: "__timeout__" });
  return "User did not respond within 2 minutes — treating as a No / cancel. Try again and wait for the user.";
}

// ── Structured findings extractor ───────────────────────────────────────

interface Finding {
  title: string;
  url?: string;
  price?: string;
  rating?: string;
  notes?: string;
  thumbnail?: string;
  [extra: string]: unknown;
}

const FINDINGS_TAG_RE = /<FINDINGS>\s*([\s\S]*?)\s*<\/FINDINGS>/i;
const FINDINGS_FENCE_RE = /```(?:json)?\s*(\[[\s\S]*?\])\s*```/;

function extractStructuredFindings(text: string): {
  findings: Finding[] | null;
  summaryWithoutFindings: string;
} {
  if (!text) return { findings: null, summaryWithoutFindings: "" };

  let payload: string | null = null;
  let stripped = text;

  const tagMatch = text.match(FINDINGS_TAG_RE);
  if (tagMatch) {
    payload = tagMatch[1];
    stripped = text.replace(FINDINGS_TAG_RE, "").trim();
  } else {
    // Fallback: a bare JSON code block at the end that parses as an array.
    const fenceMatch = text.match(FINDINGS_FENCE_RE);
    if (fenceMatch) {
      payload = fenceMatch[1];
      stripped = text.replace(FINDINGS_FENCE_RE, "").trim();
    }
  }

  if (!payload) return { findings: null, summaryWithoutFindings: text.trim() };

  try {
    const parsed = JSON.parse(payload);
    if (!Array.isArray(parsed)) return { findings: null, summaryWithoutFindings: text.trim() };
    const clean: Finding[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const title = typeof (item as any).title === "string" ? (item as any).title.trim() : "";
      if (!title) continue;
      clean.push({
        title,
        url: typeof (item as any).url === "string" ? (item as any).url : undefined,
        price: typeof (item as any).price === "string" ? (item as any).price : undefined,
        rating: typeof (item as any).rating === "string" ? (item as any).rating : undefined,
        notes: typeof (item as any).notes === "string" ? (item as any).notes : undefined,
        thumbnail: typeof (item as any).thumbnail === "string" ? (item as any).thumbnail : undefined,
      });
      if (clean.length >= 10) break;
    }
    return {
      findings: clean.length > 0 ? clean : null,
      summaryWithoutFindings: stripped,
    };
  } catch {
    // Bad JSON — keep the raw text in the summary, don't throw.
    return { findings: null, summaryWithoutFindings: text.trim() };
  }
}

// ── Browserbase glue ────────────────────────────────────────────────────
//
// We call Browserbase's REST API directly from the edge function. A full
// browser session lives in the cloud; we only send actions and receive
// screenshot/URL responses. This is the same shape Stagehand uses — we're
// just removing its subprocess indirection.

interface BrowserbaseCreds { apiKey: string; projectId: string; region?: string }

async function openBrowserbaseSession(c: BrowserbaseCreds): Promise<{ sessionId: string; liveUrl: string }> {
  const res = await fetch("https://www.browserbase.com/v1/sessions", {
    method: "POST",
    headers: {
      "X-BB-API-Key": c.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      projectId: c.projectId,
      region: c.region || "us-east-1",
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Browserbase session create ${res.status}: ${t.slice(0, 300)}`);
  }
  const j = await res.json();
  return {
    sessionId: j.id,
    liveUrl: `https://www.browserbase.com/sessions/${j.id}`,
  };
}

interface ToolOutcome {
  screenshot?: string;   // base64 PNG
  currentUrl?: string;
  text?: string;
}

async function runTool(
  creds: BrowserbaseCreds,
  sessionId: string,
  name: string,
  input: any,
): Promise<ToolOutcome> {
  if (name === "bash") {
    // We don't expose a real shell from the cloud browser — return a polite
    // refusal so Claude keeps driving the computer tool instead of trying
    // to use bash for everything.
    return { text: "bash is not available in this environment. Use the `computer` tool instead." };
  }

  // Everything else routes through the computer tool. Browserbase exposes
  // Playwright-compatible actions; we map the Anthropic action names
  // (`screenshot`, `left_click`, `type`, `key`, `mouse_move`, `scroll`) to
  // Playwright calls via the REST bridge.
  const action = input.action as string;
  switch (action) {
    case "screenshot":
      return await bbCommand(creds, sessionId, "screenshot", {});
    case "left_click":
      return await bbCommand(creds, sessionId, "click", { x: input.coordinate?.[0], y: input.coordinate?.[1] });
    case "right_click":
      return await bbCommand(creds, sessionId, "click", { x: input.coordinate?.[0], y: input.coordinate?.[1], button: "right" });
    case "double_click":
      return await bbCommand(creds, sessionId, "dblclick", { x: input.coordinate?.[0], y: input.coordinate?.[1] });
    case "mouse_move":
      return await bbCommand(creds, sessionId, "mouse_move", { x: input.coordinate?.[0], y: input.coordinate?.[1] });
    case "type":
      return await bbCommand(creds, sessionId, "type", { text: input.text });
    case "key":
      return await bbCommand(creds, sessionId, "key", { key: input.text });
    case "scroll":
      return await bbCommand(creds, sessionId, "scroll", { dx: input.scroll_direction === "right" ? 300 : input.scroll_direction === "left" ? -300 : 0, dy: input.scroll_direction === "down" ? 300 : input.scroll_direction === "up" ? -300 : 0 });
    case "wait":
      await new Promise((r) => setTimeout(r, Math.min((input.duration ?? 1) * 1000, 5000)));
      return { text: "waited" };
    default:
      return { text: `Unknown action: ${action}` };
  }
}

/** Thin wrapper around Browserbase's session-command REST endpoint.
 *  Retries on transient errors (5xx, 429, network blips) with a short
 *  exponential backoff. Never retries on 4xx client errors — those are
 *  programming bugs that won't fix themselves by waiting. */
async function bbCommand(
  creds: BrowserbaseCreds,
  sessionId: string,
  command: string,
  params: Record<string, any>,
): Promise<ToolOutcome> {
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://www.browserbase.com/v1/sessions/${sessionId}/commands`, {
        method: "POST",
        headers: {
          "X-BB-API-Key": creds.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ command, params, returnScreenshot: true }),
        // 30s per-call cap — Browserbase commands are generally sub-5s,
        // so anything beyond this almost certainly means the session is
        // wedged and we're better off giving up.
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        const j = await res.json();
        return {
          screenshot: j.screenshot,
          currentUrl: j.currentUrl,
          text: j.text || j.message,
        };
      }
      // Don't burn retries on deterministic 4xx errors (bad params, auth).
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        const t = await res.text().catch(() => "");
        throw new Error(`Browserbase command ${command} ${res.status}: ${t.slice(0, 300)}`);
      }
      const t = await res.text().catch(() => "");
      lastErr = new Error(`Browserbase command ${command} ${res.status}: ${t.slice(0, 300)}`);
    } catch (err) {
      lastErr = err;
    }
    // Backoff: 500ms, 1500ms. Don't wait on the last attempt.
    if (attempt < MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1) * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || "Browserbase command failed"));
}
