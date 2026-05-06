# OpenRouter Integration — Deep Research

Date: 2026-05-06
Status: Research + phased implementation plan
Scope: Current OpenRouter surface, untapped capabilities, integration opportunities across chat / agents / automations / marketplace / profile, and a phased build plan.

## Executive Summary

OpenRouter today is treated as just-another-provider in `llm-proxy`: API key in, chat in, response out. That's roughly 10% of the value the platform offers. The other 90% — auto-routing, model array fallback, server-side web search, dynamic model discovery, true per-request cost reporting, BYOK passthrough, throughput / price sorting — is sitting unused.

The strategic move is to make OpenRouter the **primary universal LLM gateway** for the app, with Anthropic-direct as an opt-in fast path for users who care about Claude prompt caching and the native Anthropic tool loop. This unlocks:

- One marketplace key → 300+ models available everywhere (chat, agents, automations, evals)
- Server-side web search for any model with one toggle
- Automatic price / latency / throughput optimization per task
- Real per-call cost from `/v1/generation/{id}` instead of the proxy's estimates
- Free-tier models for users who haven't connected paid keys
- A real fallback story for Anthropic 529 / OpenAI rate-limit incidents
- Spending visibility and credit caps from `/v1/key`

This document audits what exists, catalogs what's available, maps each capability to a concrete surface in the app, and proposes a four-phase build plan.

## Current State Audit

### What works

- **Edge proxy passes through.** `supabase/functions/llm-proxy/index.ts:228-284` calls OpenRouter via `callOpenAICompatible`, sets `HTTP-Referer` + `X-Title` headers, returns response. Cost estimation is a static lookup in the same file.
- **Per-user key storage.** `provider_keys` table + `storeApiKey` / `useUserApiKeys` hook (`src/lib/llmProviders.ts`). Marketplace card writes here; chat reads via `invokeLLMProxy`.
- **Marketplace card.** `src/components/marketplace/LlmProviderMarketplace.tsx` shows connect / disconnect / replace with a real key validation step.
- **Profile chip.** Connected providers surface as chips on the profile page (`ProfileScreen.tsx`).
- **Static model list.** `PROVIDER_MODELS.openrouter` hardcodes 6 models (Claude Sonnet 4.6, GPT-4o, Gemini 2.5 Pro/Flash, Llama 3.3 70B, Qwen 3 235B). New models the user might want require a code change.
- **Fallback chain shell.** `src/lib/agentProviders/fallbackChain.ts` defines the contract for cascading providers, but is not currently wrapping OpenRouter as a fallback for Anthropic-direct in the chat path.

### What doesn't work — gaps

| Gap | Impact |
|---|---|
| Static 6-model list | Users see < 2% of available OpenRouter models. Auto-router, free models, and new releases are invisible. |
| No web search | "What were the major AI announcements this week?" returns 2024 stale data even on Claude 4.6. |
| No `:nitro` / `:floor` shortcuts | No way to say "fastest" or "cheapest" for a task. |
| No `models:` fallback array | A single model string per request — when Anthropic 529s the user sees an error. |
| Cost is estimated, not measured | The proxy uses a static price table. Real cost from `/v1/generation/{id}` is never read. Off by 5-30% on cached / tool-using requests. |
| No `/v1/key` integration | No rate-limit visibility; no credit-cap surfacing in UI. Users hit limits and don't know why. |
| No BYOK passthrough | Users who have OpenAI + Anthropic + Gemini keys all separately can't tell OpenRouter to use them for cheap routing. |
| Anthropic-only chat path | The default chat model is Claude direct. When Anthropic is overloaded, the chain doesn't fall through to OpenRouter's Anthropic. |
| No "auto" model | OpenRouter's `openrouter/auto` picks the right model per prompt. Never exposed. |
| No streaming through proxy | Edge function awaits full response before returning. Users wait 5-15s instead of seeing the first token in 200ms. |
| Per-circle preferences not wired | No "this circle defaults to OpenRouter for all agents" toggle. |

## OpenRouter Capabilities Catalog

Current as of late 2026 per OpenRouter docs.

### Routing & Provider Selection

- **`models: [a, b, c]`** — try array in order, fall through on failure. Replaces our manual fallback chain entirely for OpenRouter-backed surfaces.
- **`provider.sort: 'price' | 'throughput' | 'latency' | 'exacto'`** — sort underlying providers by criterion before picking.
- **`provider.order: ['together', 'fireworks', 'lepton']`** — prefer specific underlying providers (latency-stable for production).
- **`provider.allow_fallbacks: false`** — hard-pin to one underlying provider (use sparingly; usually we want fallback).
- **`provider.partition: 'none'`** — ignore BYOK/non-BYOK partition; lets OR fall through to BYOK on a different model.
- **`:nitro` suffix** — `meta-llama/llama-3.3-70b-instruct:nitro` shortcut for `sort: 'throughput'`.
- **`:floor` suffix** — shortcut for `sort: 'price'`.
- **`:free` suffix** — free-tier variant.
- **`openrouter/auto`** — let OR pick a model based on the prompt content. Useful default for new users.

### Server Tools

- **`tools: [{ type: 'openrouter:web_search' }]`** — server-side web search injected into the response. Replaces `:online` suffix (deprecated).
- **`tools: [{ type: 'openrouter:datetime' }]`** — current date/time grounding. Tiny but eliminates "I don't know what year it is" answers.
- **`plugins: [{ id: 'web' }]`** — equivalent to web_search server tool, keeps tool calling free for user-defined tools.

### Discovery & Cost

- **`GET /api/v1/models`** — full model catalog: id, name, description, pricing.prompt, pricing.completion, context_length, supported_parameters (`tools`, `json_mode`, `structured_outputs`, `web_search`, `reasoning`).
- **`GET /api/v1/generation/{id}`** — true cost + provider used for any past request. Replaces our static estimate.
- **`GET /api/v1/key`** — usage (all-time / daily / weekly / monthly), limit, BYOK usage breakdown, free_tier flag. Powers a "you've used X of Y credits" UI.

### Output Modes

- **Streaming** — standard SSE; supported on every model. We must adopt this in the proxy or lose the user's perception of speed.
- **Structured outputs** — `response_format: { type: 'json_schema', json_schema: ... }`. Useful for the planner / validator stages of computer-use tasks.
- **Reasoning** — `reasoning: { effort: 'low' | 'medium' | 'high', exclude: bool }` for o-series + Claude Opus thinking. Returns `reasoning_details` in response.
- **Tool calling** — normalized OpenAI shape across all models including Anthropic / Gemini under the hood.
- **Vision** — `image_url` content blocks; supported on every vision-capable model with a single shape.
- **PDF input** — `file` content blocks; OR handles parsing.

### Caching

- **Anthropic prompt caching** — passthrough. `cache_control: { type: 'ephemeral' }` markers on system / user blocks work identically to direct Anthropic. Critical because UC's cost discipline (per CLAUDE.md) depends on caching.

### BYOK

- Users add their OpenAI / Anthropic / Gemini keys directly to OpenRouter. OR uses them for cheaper rates and unified billing. We can mirror this story by surfacing OpenRouter's BYOK flow in our marketplace.

## Integration Opportunities (Mapped to App Surfaces)

### Chat composer

**Today:** Hardcoded 6-model dropdown + 4 custom HF models. No web search, no auto-router, no fallback.

**Better:**
- **Web Search toggle** — globe icon next to the model picker. When on, every send includes `tools: [{type: 'openrouter:web_search'}]`. Routes through OpenRouter regardless of selected model (we wrap the request).
- **Auto / Smart model** — first item in the dropdown: "Smart (Auto-pick)" → `openrouter/auto`. Onboarding-friendly.
- **Speed / Cost variants** — under each model, show "fast" (`:nitro`) and "cheap" (`:floor`) toggle chips.
- **Free model catalog** — section labeled "Free" surfacing OpenRouter `:free` models. Powers users who haven't connected paid keys.
- **Live model search** — text input that hits `/api/v1/models` and filters. Replaces hardcoded list. Cache the catalog per session.
- **Per-message model override** — already exists; unchanged.

### Agent dispatch / OpenSwan runtime

**Today:** `agentInvocation.ts` routes by provider type (BlackSwan / Claude Code / OpenSwan). When the agent layer needs a specific model it goes through `invokeLLMProxy` with `provider: 'anthropic'` direct.

**Better:**
- **OpenRouter as the universal fallback.** Wrap every Anthropic-direct call site in `fallbackChain` with OpenRouter `anthropic/claude-sonnet-4.5` as the second link. Same model, different ingress — when Anthropic 529s, OR usually has capacity. Already designed for this in `fallbackChain.ts`; just needs wiring.
- **Multi-model array on long-running agent runs.** Computer-use tasks should send `models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5.2', 'google/gemini-3-pro']`. If one provider degrades mid-run, the next turn picks up on the fallback without losing state.
- **Reasoning level mapped to thinking effort.** UC has a `ThinkingLevel: 'fast' | 'balanced' | 'deep'`. Map directly to OR's `reasoning.effort` + an o3-class fallback when the primary doesn't support reasoning natively.

### Automations

**Today:** Automation executor uses BlackSwan or hardcoded Claude.

**Better:**
- **Per-automation model picker.** Each automation rule (`github_summary`, `nudge_inactive_members`, etc.) lets the circle owner pick "Cheap & fast" (`:floor`), "Smart" (auto), or a specific model. Powers automations that crunch through many GitHub events without burning Opus credits.
- **Web search in scheduled summaries.** Daily digest can include "What shipped in the broader ecosystem?" via `openrouter:web_search` — turns BlackSwan from a repo-only summarizer into a real briefing.

### Marketplace

**Today:** OpenRouter is one card among ten in the AI Models grid.

**Better:**
- **Promote OpenRouter to "Recommended" tier.** Visual treatment (badge + sub-cards: "Auto-route", "Web search", "Free models"). Conveys that one connection = many models.
- **Show live credit balance + usage.** When connected, the card reads `/api/v1/key` and shows `5,000 / 10,000 credits used this month`.
- **BYOK linker.** Below the OpenRouter card, an "Add your provider keys to OpenRouter" link → opens https://openrouter.ai/settings/integrations with deep-context guidance. Lets users save 10-50% on routed requests.

### Profile / account

**Today:** Chips for connected providers.

**Better:**
- **OpenRouter chip shows "300+ models"** instead of just the provider name. Hint that it's a multi-model gateway.
- **Spend ticker** — small text under the chip: "this month: $4.20" pulled from `/api/v1/key`.

### Cost / usage telemetry

**Today:** Static price table in `llm-proxy`. Estimates are off by 5-30% for cached / tool-using calls.

**Better:**
- **Replace estimate with measurement.** After each OpenRouter call, the proxy fires `GET /api/v1/generation/{id}` (1-2s after the response, since OR finalizes async) and updates the persisted run's `estimated_cost` to the real cost. Same shape, different number — the UI doesn't care.
- **Persist provider-used.** OR returns `data.provider` in the body. Log it so we can answer "which underlying provider served this request?" — useful when a user reports a quality issue.

### Computer Use / browser agent

**Today:** Computer Use uses Anthropic direct via the `computer-use-agent` edge fn.

**Better:**
- **Validator / planner stages routed through OpenRouter.** Per the chat automation audit doc, the hybrid task graph has a Planner → Executor → Validator loop. Planner and Validator are pure-text reasoning steps that don't need the native Anthropic computer-use tool. Route them through OpenRouter `anthropic/claude-sonnet-4.5:nitro` for throughput on the planning passes. Saves cost when the user runs many short tasks.
- **Free-tier validator option.** For light tasks, `validator: 'meta-llama/llama-3.3-70b:free'` is good enough and saves credits. Surface as an opt-in.

## Build Plan

Phases scoped so each lands as one shippable commit.

### Phase 0 — Quick wins (1 commit, ~250 lines)

**Goal:** Unlock auto-router, web search, and free models in chat without touching infra.

1. Add `openrouter/auto`, `:nitro`, `:floor` to `PROVIDER_MODELS.openrouter` so they appear in the dropdown immediately.
2. Add a Web Search toggle in the chat composer — when on, append `tools: [{type: 'openrouter:web_search'}]` to the request body. Visual: globe icon, off by default, persists per-circle in `circles.settings.useWebSearch`.
3. When the toggle is on AND the selected model is not OpenRouter-backed, transparently route through OpenRouter using the equivalent OR model id (e.g. Claude Sonnet 4.6 direct → `anthropic/claude-sonnet-4.5`).
4. Update `llm-proxy` to forward `tools` and `plugins` arrays through to OpenRouter (today they're stripped).

**Acceptance:** "What were the major AI announcements this week?" returns up-to-date facts when the toggle is on.

### Phase 1 — Dynamic model discovery (1 commit, ~400 lines)

**Goal:** Replace the static 6-model list with a live, searchable, filterable catalog.

1. Edge function `/openrouter-catalog`: hits `GET /api/v1/models`, normalizes, caches in Postgres for 1 hour (`openrouter_model_cache` table). Returns slimmed payload: id, name, pricing, context, capabilities (`tools`, `web_search`, `reasoning`, `vision`).
2. Client hook `useOpenRouterCatalog()` reads from the cache, with a 5-minute SWR layer.
3. Replace the chat model dropdown's hardcoded `OPENROUTER_MODELS` with catalog-driven groups: Recommended, Free, Vision, Reasoning, Fast (Nitro), Cheap (Floor).
4. Add a search input at the top of the dropdown that filters the catalog.

**Acceptance:** A user can find and select a brand-new OpenRouter model that didn't exist when the code was deployed.

### Phase 2 — True cost + key telemetry (1 commit, ~300 lines)

**Goal:** Show users what they're actually spending, with real numbers.

1. Edge fn updates `computer_use_runs.estimated_cost` and any LLM call audit row from `/api/v1/generation/{id}` 2s after the response (background fetch from the proxy, not user-blocking).
2. Edge fn `/openrouter-key-status`: returns `{ usage_monthly, limit, is_free_tier, byok_usage_monthly }`. Throttled per-user 60s.
3. Marketplace card surfaces "$X this month / $Y limit" when connected.
4. Profile chip surfaces same data, smaller.
5. New chat composer hint when balance < 10%: "OpenRouter credits low — top up?"

**Acceptance:** A run that touches Claude prompt caching shows real cost (lower than the static estimate), not an overstatement.

### Phase 3 — Universal fallback wiring (1 commit, ~350 lines)

**Goal:** Anthropic 529s become invisible to users.

1. Wrap `agentRuntime.executeAgentRun` Anthropic-direct calls in `fallbackChain`:
   - Primary: `anthropic.direct` (current).
   - Fallback 1: OpenRouter `anthropic/claude-sonnet-4.5` (same model, different gateway).
   - Fallback 2: OpenRouter `openrouter/auto` (let OR pick).
2. `fallbackChain.onFallback` writes to `agent_activity` so the office activity feed shows the swap.
3. New circle setting `circles.settings.fallbackPolicy: 'aggressive' | 'conservative' | 'none'` controls how eagerly the chain advances. Default: aggressive.

**Acceptance:** During a real Anthropic 529 incident, chat keeps working transparently and the activity feed shows the fallback hop.

### Phase 4 — Streaming + reasoning (1 commit, ~500 lines)

**Goal:** First token in 200ms, not 8s. Reasoning models exposed properly.

1. Convert `llm-proxy` to a streaming edge function. Returns SSE for OpenAI-compatible providers (OpenRouter, OpenAI, Groq) when the client requests `stream: true`.
2. Client-side: chat composer subscribes to the stream, renders tokens as they arrive.
3. Map UC's `ThinkingLevel` to OR's `reasoning.effort`. Render `reasoning_details` blocks (when present) as a collapsed "thinking" section above the response.

**Acceptance:** A long Claude Opus thinking response renders the first sentence of "thinking…" within 500ms; user can read along.

### Phase 5 — Per-automation model + per-circle defaults (1 commit, ~250 lines)

**Goal:** Owners can pick "cheap" for automations and "smart" for chat without mental gymnastics.

1. Add a model picker to the automation editor. Same component as the chat composer dropdown.
2. Add a `circles.settings.defaults.chatModel` and `circles.settings.defaults.automationModel`. Per-circle, per-surface.
3. Profile-level user default fallback (so a user can pin "I always want gpt-4o" globally).

**Acceptance:** Daily digest automation runs on `:floor` Llama, chat runs on Sonnet, and neither requires per-message model selection.

### Phase 6 — Computer Use validator + planner via OR (1 commit, ~400 lines)

**Goal:** Cheaper hybrid tasks without losing quality.

1. Per the chat-automation audit doc Refinement L, validator + planner stages are pure reasoning. Route them through OpenRouter `anthropic/claude-sonnet-4.5:nitro` (planner) and `meta-llama/llama-3.3-70b-instruct:floor` (validator).
2. Executor stage stays on Anthropic direct (needs the native computer_use tool).
3. New `circles.settings.computerUse.routerStrategy: 'all_anthropic' | 'split_or' | 'cheapest'`.

**Acceptance:** A 30-step hybrid task costs ~30% less with no observable quality regression on the eval fixtures.

## Risks & Tradeoffs

### Risk: vendor lock-in to OpenRouter

OpenRouter is a startup. If they have an outage or change pricing, our agents stop. **Mitigation:** every OR-backed call site has an Anthropic-direct or OpenAI-direct fallback. The `fallbackChain` already enforces this contract. Don't make OpenRouter the only ingress.

### Risk: prompt caching — does it survive OR passthrough?

Anthropic prompt caching works on `cache_control` markers. Per OR docs, these are passed through verbatim. **Verification:** Phase 3 commits should include a smoke test that confirms `cache_read_input_tokens > 0` on a repeat call routed through OpenRouter.

### Risk: model array fallback breaks tool / function-call state

When OR falls through `models: [a, b, c]`, tool definitions remain identical but the second model may format tool calls differently. **Mitigation:** only use array fallback for non-tool turns (chat, planner, validator). Tool-using executor stays on a single pinned model.

### Risk: web search introduces prompt-injection surface

Per Anthropic computer-use docs and the chat automation audit doc Refinement E, untrusted text needs trust labels. Web search results are untrusted by definition. **Mitigation:** wrap web_search results in an `<evidence trust=untrusted>` block in the system prompt before delivering to the user-facing model. Same pattern as DOM snapshots and screenshots.

### Risk: cost telemetry — `/v1/generation/{id}` is async

OR finalizes generation cost ~1-2s after the response returns. Reading immediately returns null. **Mitigation:** background fetch from the proxy 2s after response, with one retry at 5s. Don't block the user.

### Risk: free-tier rate limits

OR's free models are rate-limited (~20 RPM). **Mitigation:** when a user is on free tier, surface the rate via the credit chip and rate-limit our own free-route requests proactively. Phase 2 covers the data; Phase 5 the throttling.

## What's not in scope (yet)

- **Full streaming for Anthropic native loop** (ComputerUseLiveCard already streams via SSE from edge — separate concern).
- **OpenRouter Apps integrations** (OR has its own marketplace of apps — interesting future direction but not core).
- **Inline image generation through OR** — they support image gen via DALL-E and SDXL but UC has its own image-gen path through `image-generate` edge fn.

## TL;DR Build Sequence

```
Phase 0  →  Quick wins                    [auto, web search, free models]      ~250 LOC
Phase 1  →  Dynamic catalog               [/v1/models + cache]                  ~400 LOC
Phase 2  →  Real cost + key telemetry     [/v1/generation, /v1/key]            ~300 LOC
Phase 3  →  Universal fallback chain      [Anthropic direct ⇢ OR ⇢ auto]       ~350 LOC
Phase 4  →  Streaming + reasoning         [SSE proxy + reasoning_details]      ~500 LOC
Phase 5  →  Per-surface defaults          [chat / automation pickers]          ~250 LOC
Phase 6  →  Computer Use split routing    [planner cheap, executor direct]     ~400 LOC
```

Total: ~2.5k lines, six commits, two weeks of focused build. Each phase is independently shippable and produces a real user-visible win.

## Recommendation

**Ship Phase 0 next.** It's the highest-leverage, smallest commit: web search + auto-router + free models + tools/plugins forwarding in the proxy. After that, Phase 2 (cost telemetry) and Phase 3 (fallback wiring) deliver the most user trust per LOC. Phase 4 (streaming) is the biggest UX delta but the biggest commit; tackle it after the foundational phases land.
