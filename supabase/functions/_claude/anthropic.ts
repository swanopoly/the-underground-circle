/**
 * _claude/anthropic.ts — Deno-side provider adapter for Anthropic Messages API.
 *
 * This is the canonical way for edge functions to call Claude, matching the
 * in-app `src/lib/agentProviders/anthropic.ts`. Per AGENTS_ROADMAP.md §6
 * Rule #3, no edge function should hand-roll a POST to /v1/messages — they
 * all route through `callClaude()` here so pricing, cache accounting, and
 * usage logging stay in lock-step with the rest of the codebase.
 *
 * What this gives you:
 *   - Central pricing constants (matching src/lib/modelPricing.ts + 25% buffer)
 *   - Automatic parsing of cache_creation_input_tokens + cache_read_input_tokens
 *   - Cache-aware cost math (cache reads 10% of input; creates 1.25x)
 *   - One-liner `logClaudeUsage()` that writes cache columns correctly
 *
 * What this does NOT do yet:
 *   - Streaming (SSE). Edge functions that need live events still build
 *     their own stream (see computer-use-agent). May factor out once 3+
 *     functions need it.
 *   - Tool-loop orchestration. Lives in `agentExecutionCore` in-app;
 *     Phase 1c target is a Deno equivalent.
 *
 * Located in `_claude/` instead of `_shared/` because the latter is owned
 * by root and can't be written without sudo. Move when perms are fixed.
 */

export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Default model every new edge function should use unless there's a specific
 * reason otherwise. Haiku 4.5 is the right trade for chat / summarization /
 * classification — cheap, fast, still capable enough for tool use.
 */
export const DEFAULT_MODEL = "claude-haiku-4-5";

// ── Pricing (per 1M tokens, USD) ────────────────────────────────────────
// Published rates + 25% buffer. MUST stay in sync with src/lib/modelPricing.ts.
// Cache-creation is billed at 1.25x input; cache-read at 0.10x input.

interface RateRow { in: number; out: number; cacheCreate: number; cacheRead: number; }

const RATES: Record<string, RateRow> = {
  // Fable 5 — published $10/$50
  "claude-fable-5":    { in: 12.50, out: 62.50, cacheCreate: 15.625, cacheRead: 1.25 },
  // Opus 4.6+ — published $5/$25
  "claude-opus-4-8":   { in: 6.25,  out: 31.25, cacheCreate: 7.8125, cacheRead: 0.625 },
  "claude-opus-4-7":   { in: 6.25,  out: 31.25, cacheCreate: 7.8125, cacheRead: 0.625 },
  "claude-opus-4-6":   { in: 6.25,  out: 31.25, cacheCreate: 7.8125, cacheRead: 0.625 },
  // Sonnet 4.6 / 4.5 — published $3/$15
  "claude-sonnet-4-6": { in: 3.75,  out: 18.75, cacheCreate: 4.6875, cacheRead: 0.375 },
  "claude-sonnet-4-5": { in: 3.75,  out: 18.75, cacheCreate: 4.6875, cacheRead: 0.375 },
  // Haiku 4.5 — published $1/$5
  "claude-haiku-4-5":  { in: 1.25,  out: 6.25,  cacheCreate: 1.5625, cacheRead: 0.125 },
};

function resolveRate(model: string): RateRow {
  // Longest-prefix match so date-suffixed variants (`-20251001`) still resolve.
  const norm = model.toLowerCase();
  let best: RateRow | null = null;
  let bestLen = 0;
  for (const key of Object.keys(RATES)) {
    if (norm.includes(key) && key.length > bestLen) {
      best = RATES[key];
      bestLen = key.length;
    }
  }
  // Fall back to Haiku if we don't recognize the model — safer to over-charge
  // (budget caps trigger early) than under-charge.
  return best ?? RATES["claude-haiku-4-5"];
}

// ── Types ──────────────────────────────────────────────────────────────

export interface UsageBreakdown {
  /** Fresh input tokens billed at the full input rate. */
  uncachedIn: number;
  /** Tokens written to the prompt cache on this request (1.25x input). */
  cacheCreate: number;
  /** Tokens served from the prompt cache (0.10x input). */
  cacheRead: number;
  /** Output tokens billed at output rate. */
  output: number;
}

export const EMPTY_USAGE: UsageBreakdown = { uncachedIn: 0, cacheCreate: 0, cacheRead: 0, output: 0 };

export interface CallClaudeOpts {
  apiKey: string;
  model?: string;
  messages: Array<{ role: string; content: any }>;
  /** Pass a string to wrap it automatically with cache_control, or pass the
   *  array form to control cache breakpoints yourself. Omit to send no
   *  system prompt. */
  system?: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>;
  tools?: any[];
  maxTokens?: number;
  /** Extra `anthropic-beta` header values. Joined with "," per API spec. */
  betaHeaders?: string[];
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /**
   * How many retries the transient-error loop should attempt on
   * 429/529/5xx/network failures. Total attempts = 1 + maxRetries.
   * Default 2 (so 3 attempts total, ~3.5s worst-case wall time with
   * backoff + jitter). Set to 0 when the caller has its own retry
   * strategy — cron workers that run per-minute don't need internal
   * retry too. */
  maxRetries?: number;
}

/**
 * Exponential backoff with full jitter for retryable Anthropic errors.
 * Attempt 0 → 0..500ms, attempt 1 → 0..1000ms, attempt 2 → 0..2000ms.
 * Capped at 2s to keep the total wait within an edge function's
 * budget even if we bump maxRetries higher in the future.
 *
 * Exported so tests can verify the shape without actually sleeping.
 */
export function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, Math.max(0, attempt));
  const capped = Math.min(base, 2000);
  return Math.floor(Math.random() * capped);
}

/**
 * Parse RFC 7231 Retry-After header. Anthropic emits this on 429 / 529
 * responses to tell us exactly how long to wait. Two accepted forms:
 *   - Integer seconds: "5"  → 5000ms
 *   - HTTP-date:       "Wed, 21 Oct 2026 07:28:00 GMT" → (date - now)ms
 * Returns null if the header is missing, malformed, or resolves to a
 * non-positive delta.
 *
 * Capped at 10s so a buggy / hostile server can't hang an edge
 * function for the rest of its budget. Exported so the smoke test
 * can exercise both forms.
 */
export function parseRetryAfterMs(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const HARD_CAP_MS = 10_000;
  // Integer seconds form
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return Math.min(sec * 1000, HARD_CAP_MS);
  }
  // HTTP-date form
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const deltaMs = parsed - nowMs;
  if (deltaMs <= 0) return null;
  return Math.min(deltaMs, HARD_CAP_MS);
}

/** Sleep for `ms`, but wake early (and throw AbortError) if `signal` fires. */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function delayWithJitter(attempt: number, retryAfterMs: number | null, signal?: AbortSignal): Promise<void> {
  // When the server tells us how long to wait (Retry-After), honor it
  // but clamp to our own upper bound so a hostile/buggy value can't eat
  // the function's whole budget.
  const ms = retryAfterMs != null ? retryAfterMs : backoffMs(attempt);
  if (ms > 0) await sleepAbortable(ms, signal);
}

export interface CallClaudeResult {
  content: any[];
  stop_reason: string;
  /** Parsed usage with cache fields split out. */
  usage: UsageBreakdown;
  /** Raw response body for advanced callers that need tool_use_id / model / id. */
  raw: any;
}

// ── Core call ──────────────────────────────────────────────────────────

/**
 * POST /v1/messages. Automatically wraps string `system` with cache_control
 * so the frozen prompt gets cached from turn 1 (~90% input cost savings
 * from turn 2 onwards).
 *
 * Throws on non-200 responses with the body text included.
 */
export async function callClaude(opts: CallClaudeOpts): Promise<CallClaudeResult> {
  const model = opts.model || DEFAULT_MODEL;
  const system = typeof opts.system === "string"
    ? [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }]
    : opts.system;

  const headers: Record<string, string> = {
    "x-api-key": opts.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };
  if (opts.betaHeaders && opts.betaHeaders.length) {
    headers["anthropic-beta"] = opts.betaHeaders.join(",");
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 4096,
    messages: opts.messages,
  };
  if (system) body.system = system;
  if (opts.tools && opts.tools.length) body.tools = opts.tools;

  // Resilience: retry on transient failures (529 Overloaded, 429 rate
  // limit, 5xx gateway errors, network drops) with exponential backoff
  // + jitter. Structural errors (4xx except 429) fail fast — same-
  // input retry won't fix a malformed request.
  //
  // Retry budget: 3 attempts total, ~0.5s + ~1s + ~2s backoff (plus
  // jitter). Total wall-time added on a genuine outage is ~3.5s before
  // we give up — well inside the edge function's default 150s budget.
  // Callers with their own retry strategy (automation-executor cron)
  // can override via opts.maxRetries=0.
  const maxRetries = opts.maxRetries ?? 2;
  let attempt = 0;
  let res: Response;
  while (true) {
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (fetchErr) {
      // Network-level failure (ECONNRESET, DNS, abort, etc.). Retryable.
      if (attempt < maxRetries && !opts.signal?.aborted) {
        await delayWithJitter(attempt, null, opts.signal);
        attempt += 1;
        continue;
      }
      throw fetchErr;
    }

    if (res.ok) break;

    const isRetryable =
      res.status === 429 ||
      res.status === 529 ||
      (res.status >= 500 && res.status <= 599);
    if (!isRetryable || attempt >= maxRetries || opts.signal?.aborted) {
      const errText = await res.text().catch(() => "");
      const suffix = attempt > 0 ? ` (after ${attempt} retr${attempt === 1 ? "y" : "ies"})` : "";
      throw new Error(`Anthropic ${res.status}${suffix}: ${errText.slice(0, 400)}`);
    }
    // Server hint: Retry-After (seconds or HTTP-date). If present, honor
    // it; otherwise fall back to exponential backoff with jitter.
    const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
    // Drain the response body so the connection can be reused.
    try { await res.text(); } catch {}
    await delayWithJitter(attempt, retryAfterMs, opts.signal);
    attempt += 1;
  }

  const raw = await res.json();
  const u = raw.usage ?? {};
  const usage: UsageBreakdown = {
    uncachedIn:  u.input_tokens                ?? 0,
    cacheCreate: u.cache_creation_input_tokens ?? 0,
    cacheRead:   u.cache_read_input_tokens     ?? 0,
    output:      u.output_tokens               ?? 0,
  };
  return { content: raw.content ?? [], stop_reason: raw.stop_reason ?? "", usage, raw };
}

// ── Cost math ──────────────────────────────────────────────────────────

/**
 * Cache-aware running cost. Matches the four-rate Anthropic billing model.
 * Returns USD.
 */
export function computeCostUsd(model: string, u: UsageBreakdown): number {
  const r = resolveRate(model);
  return (
    u.uncachedIn  * r.in +
    u.cacheCreate * r.cacheCreate +
    u.cacheRead   * r.cacheRead +
    u.output      * r.out
  ) / 1_000_000;
}

/** Sum two usage breakdowns (helper for running totals inside loops). */
export function addUsage(a: UsageBreakdown, b: UsageBreakdown): UsageBreakdown {
  return {
    uncachedIn:  a.uncachedIn  + b.uncachedIn,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead:   a.cacheRead   + b.cacheRead,
    output:      a.output      + b.output,
  };
}

// ── Usage telemetry ────────────────────────────────────────────────────

export interface LogUsageParams {
  circleId?: string | null;
  userId?: string | null;
  source: string;
  model: string;
  usage: UsageBreakdown;
  metadata?: Record<string, unknown>;
}

// ── Umbrella budget cap (Rule #12 — unified across every agent) ───────
// Every agent that writes to `claude_api_usage` contributes to the same
// 24h circle-level sum. `checkCircleClaudeBudget` is the pre-flight
// guard: any edge function can call it before making a Claude request
// and bail out cleanly if the circle is over its total-spend cap.
//
// Distinct from the per-source caps:
//   - computer_use_max_cost_usd   (per-run, Computer Use only)
//   - automation_max_cost_usd      (rolling 24h, Automations only)
//   - claude_total_max_cost_usd    (rolling 24h, ALL Claude agents)  ← this one
//
// The total cap is a safety net: if all per-source caps are set to
// sensible values, this one rarely trips. It exists for the agents
// that don't have a per-source cap (swanbot-ai, boss-agent, room-task-
// executor, build-stream, heartbeat-agent, chat-stream) so they aren't
// running totally ungated.

export interface CircleBudgetCheck {
  allowed: boolean;
  spent24h: number;
  cap: number;
  /** Human-readable reason when `!allowed`. */
  reason?: string;
}

/**
 * Query `claude_api_usage` for the circle's rolling 24h sum and compare
 * to the configured cap. Default cap is $10/day — tuned to be loose
 * enough that real usage doesn't trip it but tight enough to stop a
 * runaway. Users can raise or lower via `circles.settings.claude_total_max_cost_usd`.
 *
 * Fail-open: if either DB query fails we return `allowed: true` so a
 * broken telemetry table can't brick every agent in the app.
 */
export async function checkCircleClaudeBudget(
  supabase: any,
  circleId: string | null | undefined,
  defaultCapUsd = 10,
): Promise<CircleBudgetCheck> {
  if (!supabase || !circleId) {
    return { allowed: true, spent24h: 0, cap: defaultCapUsd };
  }
  try {
    // Read the configured cap. Users who haven't set one fall through
    // to the default.
    const capRow = await supabase
      .from("circles")
      .select("settings")
      .eq("id", circleId)
      .maybeSingle();
    const configured = (capRow?.data?.settings as any)?.claude_total_max_cost_usd;
    const cap = typeof configured === "number" && configured > 0 ? configured : defaultCapUsd;

    // Sum 24h spend across every source. Uses the (circle_id, source,
    // created_at) composite index — a single index scan over the
    // circle's last-24h rows. Cheap at any realistic volume.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("claude_api_usage")
      .select("estimated_cost")
      .eq("circle_id", circleId)
      .gte("created_at", since);
    const spent24h = (data || []).reduce(
      (s: number, r: any) => s + Number(r.estimated_cost || 0),
      0,
    );

    if (spent24h >= cap) {
      return {
        allowed: false,
        spent24h,
        cap,
        reason: `Circle's daily AI budget reached: $${spent24h.toFixed(4)} ≥ $${cap.toFixed(2)}. Raise 'claude_total_max_cost_usd' in circle settings or wait for the 24h window to roll.`,
      };
    }
    return { allowed: true, spent24h, cap };
  } catch {
    // Fail-open. Telemetry drift must not take the whole app offline.
    return { allowed: true, spent24h: 0, cap: defaultCapUsd };
  }
}

/**
 * Fire-and-forget insert to `claude_api_usage`. Swallows errors — telemetry
 * should never block the agent. Call on every successful turn so the
 * dashboard shows real cache-hit rates.
 */
export async function logClaudeUsage(
  supabase: any,
  p: LogUsageParams,
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("claude_api_usage").insert({
      circle_id: p.circleId ?? null,
      user_id: p.userId ?? null,
      source: p.source,
      model: p.model,
      input_tokens:          p.usage.uncachedIn,
      output_tokens:         p.usage.output,
      cache_creation_tokens: p.usage.cacheCreate,
      cache_read_tokens:     p.usage.cacheRead,
      estimated_cost:        computeCostUsd(p.model, p.usage),
      metadata:              p.metadata ?? {},
    });
  } catch { /* telemetry only */ }
}
