# Chat Streaming Latency / Time-To-First-Token (TTFT) — Deep Research

> Research doc, not a change. Combines external streaming/caching best practice
> with the current reality of this codebase's chat stream path.
> Author: latency research pass. Date: 2026-07-16.
> Scope: the main-chat SSE stream (`chat-stream` edge fn → `swanbotStream` →
> `ChatTab`), the just-landed prompt-cache-boundary split, and the typed
> tool loop's first-response path. Read-only — no code was edited.

Load-bearing files (all read for this pass):

- `supabase/functions/chat-stream/index.ts` — the SSE loop + cache-boundary split.
- `src/lib/swanbotStream.ts` — the client SSE consumer + coalescing.
- `src/lib/promptCacheSplitCore.ts` — pure split/`cache_control` render core.
- `src/lib/chatPromptAssembly.ts` — boundary marker + section stability tags.
- `src/lib/swanbot.ts` — `buildStreamableSystemPrompt` / `buildSystemPromptAsync`
  (frozen prefix + volatile tail composition; context wave).
- `src/screens/circles/tabs/ChatTab.tsx` — the `streamChatResponse` call site.
- `src/lib/agentExecutionCore.ts` — the typed loop's first provider turn.
- `src/lib/streamHealthCore.ts` — the TTFT/idle state machine.

---

## TL;DR — the one finding that dominates

**The cache-boundary split landed and is wired end-to-end, but the frozen
prefix it caches is ~1,280 tokens — below the 4,096-token minimum cacheable
prefix for the default chat model (Haiku 4.5) and for every Opus model.** So on
the default path the ephemeral cache **silently never writes**
(`cache_creation_input_tokens: 0`), and the highest-leverage optimization in the
tree is presently inert. Every other win is secondary until the frozen prefix is
grown past the model's minimum. The mechanism to grow it already exists in the
codebase (`CHAT_PROMPT_SECTION_STABILITY` tags, all currently `'turn'`) — it just
hasn't been used.

TTFT on this app is dominated, in rough order, by: (1) **edge cold start + serial
pre-fetch DB round-trips** before the Anthropic request even starts, (2)
**context-assembly wall-clock** (already parallelized, still on the critical
path), (3) **model prefill** (which prompt caching would cut — but only once the
prefix is cacheable), and (4) **client-side coalescing** of the first chunk.

---

## How a chat turn reaches its first token today

Critical path, in series, for one streamed turn:

1. **`ChatTab` awaits `buildStreamableSystemPrompt(...)`**
   (`ChatTab.tsx:9750`). This runs the whole context wave (memory, circle
   snapshot, skills, missions, retrieval, connected resources, …) before any
   network call to the model. The wave is **already parallelized** into one
   barrier — "collapses ~12 serial network round-trips … into one wave whose
   wall-clock is the SLOWEST single loader" (`swanbot.ts:2908-2913`). Good, but
   it is still fully `await`ed *before* the SSE fetch — so its wall-clock is
   additive to TTFT.
2. **`streamChatResponse(...)`** (`ChatTab.tsx:9808`) → `getSession()` for the
   JWT (`swanbotStream.ts:263`) → `POST /functions/v1/chat-stream`
   (`swanbotStream.ts:271`).
3. **Edge fn pre-fetch work, all serial, all before the Anthropic call:**
   - `svc = createClient(...)` (`chat-stream/index.ts:46`) + a second anon
     client for auth (`:53`).
   - `anon.auth.getUser()` — a network round-trip to resolve `userId`
     (`chat-stream/index.ts:58`).
   - `resolveUserModelApiKey(...)` — a DB lookup for the BYOK key
     (`chat-stream/index.ts:87-92`).
   - `checkCircleClaudeBudget(...)` — another DB round-trip, when `circleId` is
     present (`chat-stream/index.ts:108`).
4. **`fetch("https://api.anthropic.com/v1/messages", { stream:true })`**
   (`chat-stream/index.ts:190`). Model prefill happens here; first
   `content_block_delta` is the true TTFT event.
5. **First delta reaches the client** and is **coalesced** before it paints:
   buffered until 8 chars / a natural break / 80 ms idle
   (`swanbotStream.ts:187-189, 354-372`).

Everything in steps 1 and 3 is dead air the user waits through before the model
even starts. The generous 40 s pre-first-token budget in
`streamHealthCore.ts:75` (`STREAM_TTFT_SLOW_MS`) is itself a tell that long TTFT
is a known, tolerated condition here.

---

## The cache-boundary split: what landed, and why it's currently inert

**What landed (DONE).** The prompt is composed as
`base + CHAT_PROMPT_CACHE_BOUNDARY + dynamicTail`
(`chatPromptAssembly.ts:258-259, 316-319`; `swanbot.ts:2946-2947`). The edge fn
splits on that marker and puts `cache_control:{type:'ephemeral'}` on the
**frozen prefix only**, leaving the per-turn tail uncached
(`chat-stream/index.ts:19, 148-159`; `promptCacheSplitCore.ts:135-180`). This is
the correct Anthropic pattern — caching is a prefix match, so a single breakpoint
at the very *end* (the old behavior) re-keyed the cache every turn and never hit.
The frozen `stable` block carries **zero per-turn interpolation**
(`swanbot.ts:3041-3089`) — it is byte-identical across turns *and users*, which
is exactly what a cache prefix wants.

**Why it's inert on the default path (the finding).** The frozen prefix is only
~5,123 chars ≈ **~1,280 tokens** (`swanbot.ts:3045-3089`, measured). The default
chat model is **Haiku 4.5** (`ChatTab.tsx:9666`; `chat-stream/index.ts:133`), and
Anthropic's **minimum cacheable prefix is 4,096 tokens** for Haiku 4.5 and every
Opus model (2,048 for Sonnet 4.6 / Fable 5; 1,024 for Sonnet 4.5 and earlier).
A prefix under the minimum **caches silently as a no-op** — no error, just
`cache_creation_input_tokens: 0`. So:

- **Escalation OFF (pure text):** cached prefix ≈ frozen system ≈ 1,280 tok →
  **below 4,096 → never caches on Haiku/Opus.**
- **Escalation ON (default since 2026-07-01, `swanbot.ts:293`):** the stream also
  advertises the pinned tool palette (`ChatTab.tsx:9776-9787`), which renders
  *before* `system` and is therefore captured under the same system breakpoint.
  The palette is **≤9 pinned tools + `tools.search`**
  (`openswanToolRuntime.ts:5216-5220`; 9 `disclosure:'pinned'`), roughly
  1–3K tokens of schema. Combined prefix lands **right at or just under the
  4,096 Haiku minimum** — caching is unreliable-to-absent and *must be verified
  empirically*, not assumed.

Either way, the **system half of the split delivers little today**. Prompt
caching's value — both the ~90% input-cost cut *and* the prefill-time (TTFT)
reduction — scales with the cached-prefix token count. At ~1.3K tokens even a
guaranteed hit saves only a small slice of prefill. The split is correct
plumbing waiting for a payload.

**The fix is already scaffolded.** `chatPromptAssembly.ts:203-243` defines a
`CHAT_PROMPT_SECTION_STABILITY` tag per section (`'frozen' | 'turn'`), and every
section is tagged `'turn'` today with an explicit note: *"The tag exists so a
future pass can promote genuinely stable sections (e.g. skills metadata) above
the boundary."* Promoting the static capability docs, tool-usage guidance,
formatting rules, and skills metadata above the boundary would (a) push the
frozen prefix comfortably past 4,096 tokens so it actually writes, and (b) make
each cache read worth a meaningful prefill saving.

---

## Ranked latency wins (DONE vs TODO)

Ranked by leverage on real TTFT/cost for the default path. "Effort" is relative
implementation size; none of these were applied in this pass.

### 1. Grow the frozen prefix past the model's cache minimum — TODO — highest leverage
The single move that makes the landed split real. Promote genuinely stable
content (capability docs `swanbot.ts:3059-3072`, "How to Think"/"How to Respond"
static rules, formatting rules, skills *metadata*) from the dynamic tail into the
frozen `base`, using the existing `CHAT_PROMPT_SECTION_STABILITY` tags
(`chatPromptAssembly.ts:203-243`) rather than inventing a second ordering
mechanism. Target a frozen prefix comfortably over **4,096 tokens** so it caches
on Haiku/Opus (not just the ~1,280 today). Guard with
`isVolatileAboveBoundary()` (`promptCacheSplitCore.ts:191-206`) so no per-turn
field (`## Current Context`, `## Recent Chat Context`, `## How to Respond`) leaks
above the line and re-poisons the cache. **Effort: medium. Payoff: unlocks every
downstream caching win.**

### 2. Cache-boundary split — DONE (verify it's hitting)
`chat-stream/index.ts:148-159` + `promptCacheSplitCore.ts`. Correct and wired.
The edge already captures `cache_read_input_tokens` / `cache_creation_input_tokens`
off `message_start` / `message_delta` (`chat-stream/index.ts:282-284`) and logs
them to `user_ai_usage` (`:326-340`). **Action: surface a
cache-hit-rate metric from that data.** Per Anthropic guidance, if
`cache_read_input_tokens` is 0 across repeated turns, a silent invalidator (or a
sub-minimum prefix, i.e. finding #1) is at work. This is the empirical proof for
#1 and the regression alarm afterward.

### 3. Pre-warm the frozen-prefix cache on thread/session open — TODO
Anthropic's documented pattern: fire a `max_tokens: 0` request at session start
so prefill writes the cache before the first *real* turn, eliminating the
cold-cache prefill from that turn's TTFT. Depends on #1 (nothing worth warming at
1.3K tokens). **Must be non-streaming** — `max_tokens: 0` is rejected with
`stream: true`. Place `cache_control` on the same frozen block the real request
uses. Worth it here because first-turn TTFT is user-visible and the frozen prefix
is shared across all turns/users on a model. **Effort: small-medium.**

### 4. Parallelize the edge pre-fetch round-trips — TODO
Today `getUser` → `resolveUserModelApiKey` → `checkCircleClaudeBudget` run
strictly serially before the Anthropic fetch (`chat-stream/index.ts:58, 87-92,
108`). `resolveUserModelApiKey` and `checkCircleClaudeBudget` both only need
`userId` (from `getUser`) and `circleId` (from the body) — they can run
concurrently with `Promise.all`, removing ~1 DB round-trip from the critical
path. External corroboration: one Supabase practitioner reported *"~95% of my
latency improvement from … running [independent requests] in parallel"*
([studyraid](https://app.studyraid.com/en/read/8395/231619/optimizing-edge-function-performance)).
**Effort: small. Payoff: direct TTFT.**

### 5. Cut/keep-warm the edge cold start — TODO
Supabase edge cold start is **~200–500 ms** (median ~400 ms cold vs ~125 ms warm)
per Supabase's own support figures
([discussion #29301](https://github.com/orgs/supabase/discussions/29301)). Two
levers: (a) hoist the Supabase client construction out of the per-request
handler where possible (it's created inside `Deno.serve` today —
`chat-stream/index.ts:46, 53, 327`); (b) a scheduled keep-warm ping every few
minutes so the highest-volume streaming surface rarely pays a cold boot. **Effort:
small. Payoff: removes a 200–400 ms spike from cold TTFT.**

### 6. Flush the first delta immediately (speculative first chunk) — TODO
The client coalescer buffers the first token up to 8 chars / 80 ms
(`swanbotStream.ts:187-189, 354-372`) to avoid jitter — but that budget also
delays the *first* paint, which is the most perceptually important one. Bypass
coalescing for the **first** delta only (flush on first byte, then resume
coalescing) so the bubble starts writing the instant the model produces. General
streaming best practice: emit the first chunk with buffering disabled to minimize
perceived latency. **Effort: tiny. Payoff: perceived TTFT.**

### 7. Keep the pinned tool palette byte-stable across turns — TODO / verify
With escalation on by default, tools sit in the cached prefix (before `system`).
Anthropic's invalidation hierarchy: **any** tool add/remove/reorder invalidates
tools + system + messages caches. If `getStreamEscalationPinnedToolNames`
(`swanbot.ts:4784-4788`) ever returns a per-intent/per-surface-varying set, or
serializes tools non-deterministically, it poisons the whole prefix every turn.
Verify the palette is deterministic and stable; serialize tool defs in a fixed
order. Note the edge forwards tools with **no** `cache_control` of their own
(`chat-stream/index.ts:167-170`) — fine *because* the system breakpoint covers
them, but only while the frozen system block is non-empty (an empty frozen block
would drop tools out of the cache too — `promptCacheSplitCore.ts:166-180`).
**Effort: small (audit). Payoff: protects #1/#2.**

### 8. Use the 1-hour cache TTL for chat — TODO (after #1)
Default ephemeral TTL is 5 min; chat turns often gap longer, so the prefix
expires between turns and each cold turn re-pays prefill. The 1 h TTL (2× write
cost, break-even ~3 reads) retains the frozen prefix across a normal chat cadence.
Pair with #3. Set `cache_control:{type:'ephemeral', ttl:'1h'}` on the frozen
block in `buildCacheableSystemBlocks` (`promptCacheSplitCore.ts:174`). **Effort:
tiny. Payoff: more cache hits → lower TTFT on gappy conversations.**

### 9. Overlap context assembly with a pre-warm / ack — TODO (depends on #1/#3)
The full context wave is `await`ed before the fetch (`ChatTab.tsx:9750`). It's
already parallelized internally (`swanbot.ts:2908-2913`) so it can't easily
shrink, but its wall-clock can be *hidden*: while the dynamic wave runs, fire the
#3 pre-warm on the (static) frozen prefix and/or paint an immediate UI ack so the
user sees motion before the model call starts. **Effort: medium. Payoff: hides
assembly latency behind existing dead time.**

### 10. Fast mode for Opus-tier chats — OPTIONAL / TODO
Anthropic "fast mode" runs Opus 4.8/4.7 at up to 2.5× output tokens/sec (beta,
premium price, `speed:"fast"` + `fast-mode-2026-02-01`). This is inter-token
throughput, **not** TTFT, and doesn't touch the default Haiku path — but for
users who pick an Opus model in chat it's the biggest perceived-speed lever.
Caveat: switching `speed` invalidates the prompt cache, so don't toggle it
per-turn. **Effort: small. Payoff: throughput on Opus chats only.**

### Already good (leave as-is)
- **Default model = Haiku 4.5** (`ChatTab.tsx:9666`) — the lowest-TTFT Claude
  model; correct default for a chat surface.
- **Context wave parallelized** (`swanbot.ts:2908-2913`) — DONE.
- **Post-stream work is off the critical path** — memory extraction and
  persistence run in the background after the stream completes
  (`ChatTab.tsx:9888-9899`).
- **Prompt caching needs no beta header** — the edge correctly sends none
  (`chat-stream/index.ts:190-198`); caching is GA.
- **Interrupted-stream contract** — `swanbotStream.ts` never silently retries a
  post-handshake failure (`classifyStreamTermination`, `:152-166`), which is the
  right resilience posture and doesn't cost TTFT.

---

## External best-practice checklist mapped to this repo

From Anthropic's prompt-caching / streaming guidance and general SSE/TTFT
practice, cross-referenced to what this codebase does:

| Best practice | Source | State here |
|---|---|---|
| Static content at the front, volatile at the end | Anthropic prompt-caching | DONE structurally (`chatPromptAssembly.ts`), but frozen prefix < model minimum → #1 |
| Frozen prefix must exceed the model's min cacheable tokens (4,096 Haiku/Opus) | Anthropic prompt-caching | **NOT MET** — ~1,280 tok → #1 |
| Keep the cached prefix byte-identical across turns | Anthropic prompt-caching | DONE for system (`swanbot.ts:3045-3089`); verify for tools → #7 |
| Verify hits via `cache_read_input_tokens` | Anthropic prompt-caching | Data captured (`chat-stream/index.ts:282-284`); not yet surfaced → #2 |
| Pre-warm the prefix cache (`max_tokens:0`, non-streaming) | Anthropic prompt-caching | Absent → #3 |
| 1 h TTL for bursty/gappy traffic | Anthropic prompt-caching | Absent (5 min default) → #8 |
| Move init outside the handler; keep-warm; parallelize independent work | Supabase edge guidance | Serial pre-fetch + in-handler init → #4, #5 |
| Flush the first chunk immediately; disable buffering on every hop | general SSE/TTFT | Coalescer delays first paint → #6 |
| Prompt the model to answer directly (no long preamble) | general TTFT | Response directives already push brevity (`swanbot.ts:2956-3013`) — OK |
| Fast mode / higher tokens-per-sec for throughput | Anthropic fast mode | Unused; Opus-only → #10 |

---

## How to measure (before/after any change)

1. **Cache hit rate:** read `cache_read_tokens` / `cache_creation_tokens` already
   logged to `user_ai_usage` (`chat-stream/index.ts:326-340`). A non-zero
   `cache_read` across consecutive turns on the same model proves #1 worked; zero
   proves the prefix is still sub-minimum or invalidated.
2. **Server TTFT:** stamp a monotonic clock in the edge fn at request entry and
   at the first `content_block_delta` (`chat-stream/index.ts:248-251`); the delta
   isolates prefill+queue from the pre-fetch overhead in step 3 above.
3. **Client TTFT:** the `streamHealthCore` machine already distinguishes
   `waiting_first_token` → `streaming` on the first byte
   (`streamHealthCore.ts:180-181`); log the wall-clock of that transition to
   capture network + gateway buffering the server can't see.
4. **Isolate edge overhead:** compare cold vs warm invocations (the ~200–500 ms
   vs ~125 ms Supabase gap) to size the #4/#5 win independently of model prefill.

---

## Sources

External:
- [Supabase Edge Functions — Poor performance / cold-start latency (discussion #29301)](https://github.com/orgs/supabase/discussions/29301)
- [Persistent Storage and 97% Faster Cold Starts for Edge Functions (Supabase blog)](https://supabase.com/blog/persistent-storage-for-faster-edge-functions)
- [Optimizing edge function performance (parallelize / init-outside-handler / keep-warm)](https://app.studyraid.com/en/read/8395/231619/optimizing-edge-function-performance)
- [Supabase Edge Functions docs — Web Stream / SSE](https://supabase.com/docs/guides/functions)
- Anthropic prompt-caching, streaming, pre-warming, fast-mode, and cache-minimum
  guidance (bundled `claude-api` skill reference: `shared/prompt-caching.md`,
  `SKILL.md` §Prompt Caching / §Fast Mode).

Codebase (primary evidence): `supabase/functions/chat-stream/index.ts`,
`src/lib/swanbotStream.ts`, `src/lib/promptCacheSplitCore.ts`,
`src/lib/chatPromptAssembly.ts`, `src/lib/swanbot.ts`,
`src/screens/circles/tabs/ChatTab.tsx`, `src/lib/agentExecutionCore.ts`,
`src/lib/streamHealthCore.ts`, `src/lib/openswanToolRuntime.ts`.
