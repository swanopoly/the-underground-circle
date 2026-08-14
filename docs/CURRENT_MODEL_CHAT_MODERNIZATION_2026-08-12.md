# Current Model And Chat Modernization — 2026-08-12

## Outcome

The site-wide catalog slice is source-complete. The app now recognizes current
exact OpenAI, Anthropic, Google, Groq, GitHub Models, Z.AI, MiniMax, Mistral,
Cohere, Perplexity, Together, Fireworks, DeepSeek, Hugging Face, and OpenRouter
text-model families across catalog, routing, capability, context, pricing,
Chat, Rooms, Office, registry, and Edge owners. Connected providers can return
the models enabled for the signed-in user's own account through an
authenticated, fixed-endpoint `list_models` proxy; curated rows remain the
offline fallback. The change does **not** silently migrate saved agents, saved
threads, or the established `claude-sonnet-4-6` Chat fallback.

This document is a dated research and rollout record. Canonical runtime
ownership remains in `docs/AGENTS_ROADMAP.md`.

## Verified Model Set

The following facts were checked against provider documentation on 2026-08-12.
Prices are standard input/output USD per million tokens, before the app's
deliberate 25% display/guardrail buffer.

| Exact ID | Intended UC role | Context / max output | Published price |
|---|---|---:|---:|
| `gpt-5.6-sol` | Deep reasoning, coding, hard agent work | 1.05M / 128K | $5 / $30 |
| `gpt-5.6-terra` | Balanced everyday agent and tool work | 1.05M / 128K | $2.50 / $15 |
| `gpt-5.6-luna` | Fast extraction, summaries, bounded workers | 1.05M / 128K | $1 / $6 |
| `claude-opus-5` | Premium long-horizon architecture and coding | 1M / 128K | $5 / $25 |
| `claude-sonnet-5` | Balanced Claude coding and tool work | 1M / 128K | $3 / $15 standard |
| `claude-fable-5` | Explicit highest-capability Claude option | 1M / 128K | $10 / $50 |
| `gemini-3.6-flash` | Fast multimodal and grounded agent work | 1,048,576 / 65,536 | $1.50 / $7.50 |
| `gemini-3.5-flash-lite` | Low-latency high-volume work | 1,048,576 / 65,536 | $0.30 / $2.50 |

The curated direct-provider fallback also covers current account-independent
anchors such as Groq GPT-OSS/Compound, publisher-qualified GitHub Models,
GLM-5.1, MiniMax M2.7, Mistral Medium 3.5/Small 2603/Codestral, Cohere Command
A, Perplexity Sonar, Together-hosted Qwen/Kimi/DeepSeek, Fireworks GPT-OSS,
and DeepSeek V4. It is intentionally not treated as an exhaustive entitlement
list: where a provider exposes a model-list endpoint, the signed-in account's
live response is merged into the picker.

Primary references:

- OpenAI: [models](https://developers.openai.com/api/docs/models),
  [latest-model guide](https://developers.openai.com/api/docs/guides/latest-model),
  [pricing](https://developers.openai.com/api/docs/pricing), and
  [changelog](https://developers.openai.com/api/docs/changelog).
- Anthropic: [model overview](https://platform.claude.com/docs/en/about-claude/models/overview),
  [model IDs and versions](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions),
  and [deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations).
- Google: [Gemini models](https://ai.google.dev/gemini-api/docs/models),
  [latest-model guide](https://ai.google.dev/gemini-api/docs/latest-model),
  [pricing](https://ai.google.dev/gemini-api/docs/pricing), and
  [changelog](https://ai.google.dev/gemini-api/docs/changelog).
- OpenRouter: the exact mirrored slugs were also checked against the live
  [OpenAI](https://openrouter.ai/openai),
  [Anthropic](https://openrouter.ai/anthropic), and
  [Google](https://openrouter.ai/google) catalogs on 2026-08-12.
- Other provider-owned references: [Groq models](https://console.groq.com/docs/models),
  [GitHub Models REST](https://docs.github.com/en/rest/models),
  [Mistral models](https://docs.mistral.ai/models/overview),
  [Cohere models](https://docs.cohere.com/v1/docs/models),
  [Perplexity Sonar](https://docs.perplexity.ai/docs/sonar/models),
  [Together serverless models](https://docs.together.ai/docs/serverless-models),
  [DeepSeek models/pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [Z.AI GLM migration](https://docs.z.ai/guides/overview/migrate-to-glm-new),
  and [MiniMax models](https://platform.minimax.io/docs/guides/models-intro).

Provider marketing descriptions are not comparable latency benchmarks. UC
must collect its own p50/p95 first-token time, total latency, verified task
completion, recovery rate, and cost before changing a default.

## Source Changes In This Slice

The current models are additive exact-ID choices in:

- `src/lib/llmProviders.ts` direct and OpenRouter catalogs;
- `src/lib/crossProviderRouter.ts` direct/OpenRouter aliases;
- `src/lib/modelCapabilities.ts` explicit fail-closed capability rows;
- `src/lib/modelContextBudgetCore.ts` exact context windows;
- `src/lib/modelPricing.ts` buffered UI/budget rates;
- `src/lib/runCostRollupCore.ts` exact current run-accountability rates;
- `src/lib/modelRegistry.ts` offline registry fallback;
- `src/lib/integrations/modelProviderRegistry.ts` parallel bounded live-catalog
  hydration plus curated fallback;
- `src/lib/serviceProfileSouls.ts` connected-provider Auto ladders;
- `supabase/functions/model-registry/index.ts` live discovery estimates;
- `supabase/functions/llm-proxy/index.ts` proxy costs and direct GPT-5.6
  reasoning-effort adaptation, plus authenticated provider-owned model-list
  endpoints with fixed hosts, response bounds, and non-chat/retired filtering;
- `supabase/functions/{chat-stream,swanbot-ai,swanbot-v2-ai}/index.ts` plus
  `src/lib/swanbotV2BatchRuntimeCore.ts` exact Claude allowlist parity;
- `src/screens/circles/tabs/ChatTab.tsx` model picker and turn routing;
- Rooms playground, Office prompts/terminal, agent-spawn, automation, and
  Marketplace labels/default probes;
- the built-in model knowledge cards and Kanban/agent model labels, so
  site-wide explanatory UI does not describe retired generations as current.

Live catalogs are cached by authenticated user plus provider, never globally
across accounts. Credential writes invalidate the cache. An anonymous request
is not cached, provider requests run in parallel behind a 3.5-second picker
wait, provider payloads are capped at 5 MB and 1,000 rows, and callers cannot
submit their own catalog URL. Known audio, image, embedding, realtime,
computer-use, Codex-only, retired direct, and otherwise non-chat rows are
filtered before they can become a selectable Chat model.

OpenRouter now uses that same authenticated and bounded catalog path instead
of a second direct browser fetch, removing a serial network wait and keeping
all provider discovery under one credential and response-size boundary.

The shared Chat, Rooms, and agent-spawn registry also filters every merged
model through the actual plain-Chat route resolver. Ollama and arbitrary
OpenAI-compatible endpoints remain available through their guarded local
OpenSwan/tool paths, but are not presented as hosted Chat choices because the
edge intentionally refuses caller-supplied destinations.

Chat now resolves Auto once per turn before capability routing and reuses that
exact result for the final transport. Previously capability routing could see
the literal `auto` value while the later transport used a different model.
The most recent assistant message also contributes its last 2,000 characters
to conversation context, fixing the prior prefix-only behavior for “continue.”

## Preserved Compatibility And Safety

- Future or unconfigured Chat threads still default to
  `claude-sonnet-4-6`.
- An explicitly saved `auto` selection remains Auto.
- Existing saved exact model IDs are never rewritten.
- If a saved exact ID is absent from today's curated/live catalog, Chat shows a
  dedicated Saved Conversation Model row instead of visually changing it to
  Auto. It remains an existing choice, not a new default recommendation.
- Current models are addressed by pinned tier IDs. Floating `latest` aliases
  are not stored for Office agents.
- OpenAI/Gemini built-in computer-use capability is not confused with UC's
  Anthropic-native screenshot/action loop. Their model capability rows keep
  that specific `computerUse` flag false.
- Direct GPT-5.6 turns map UC thinking posture to `reasoning_effort`, while
  current Gemini requests omit the deprecated `temperature`, `top_p`, and
  `top_k` controls and use provider defaults.
- New provider-native multi-agent or dynamic-tool features do not bypass UC's
  approval, immutable action, no-replay, evidence, or completion contracts.
- Static fallback metadata is availability information, not a claim that a
  user's key, account, model entitlement, hosted Edge deployment, or provider
  route was live-tested.

## Research Findings

### 1. Model truth is fragmented

Availability, aliases, capability flags, context windows, costs, Auto
recommendations, and Edge allowlists have separate owners. A model can look
selectable while one later owner is stale. The new
`smoke:current-model-family` gate checks those owners together, but the runtime
still needs one composed read-only readiness profile.

### 2. Large context was not improving continuation

Ordinary Chat currently builds a short formatted transcript rather than a
typed, tool-pair-safe long-context history. Fixing the latest answer's tail is
the immediate correctness win. The next context release should use typed
messages, semantic compaction, retrieval, provider conversation state, and
cache telemetry rather than resending a million-token transcript.

### 3. Optional context delays first token

Prompt assembly awaits archive, retrieval, memory, skills, identity, mission,
circle, and connected-resource work before model dispatch. Existing
`retrievalMemoCore`, `promptBuildMemoCore`, and `streamFirstChunkCore` owners
are not yet on the plain-Chat production path. The next latency slice should
separate required turn context from optional late/bounded enrichments and
measure each section.

### 4. Provider controls are not interchangeable

OpenAI reasoning effort, Anthropic adaptive thinking/effort, and Gemini
thinking level have different fields and supported values. This slice maps
UC's three-level control to direct GPT-5.6 `reasoning_effort` and avoids its
legacy temperature path. A later adapter layer must do the same deliberately
for Anthropic, Gemini, and OpenRouter rather than spraying one sampler payload
across providers.

### 5. The OpenSwan panel must show execution truth

The panel should eventually show one compact execution profile:

`requested choice -> effective exact model -> effort owner -> Crew policy -> verified tools -> price state`

Unknown or stale model metadata should say unavailable/unverified. Crew
eligibility must come from the real delegation policy. STOP must not imply it
cancels provider-owned work when it only changes local UI state.

## Next Eval-Gated Phases

The first bounded readiness slice is now in source: provider discovery retains
`verified | fallback | unsupported` instead of collapsing a verified empty
inventory, a timeout, and an unsupported endpoint into `[]`. Verified account
inventories contribute only their exact listed IDs; curated rows can enrich an
exact match but cannot add an absent ID. Chat, Rooms, Office terminal, agent
spawn, and Marketplace show the same account-checked, verified-empty,
curated-fallback, or not-connected state. This is inventory evidence, not a
successful live inference claim. Chat's curated category and popular shelves
now resolve hosted models through the same exact provider/model identity:
unavailable rows remain visible but disabled, Auto excludes provider accounts
with zero ready models, and an unavailable Auto result stops before provider
work. Saved connected exact choices remain attemptable for compatibility and
are never silently rewritten; separate image/tool capability models are not
misclassified as hosted-chat rows. Office no longer exposes bare GPT, Gemini,
GLM, MiniMax, or DeepSeek shortcuts whose labels lacked exact provider routing;
those families enter the terminal through the provider-qualified account
catalog instead. Same-runtime key writes, rotations, and deletes invalidate the
catalog cache and refresh every `useUserApiKeys` consumer without a reload.
Rooms threads only providers with at least one ready exact model into its
OpenSwan Auto resolver, so Auto can use a connected OpenRouter account instead
of forgetting that authority and defaulting to the direct Anthropic lane. The
OpenRouter Popular section uses a current, non-ranked fallback until the live
weekly feed succeeds. Both the Edge feed and Chat filter known retired IDs and
the project's excluded vendor families before a result can become selectable.

1. **Chat Model Readiness Contract (in progress).** Compose the catalog
   readiness slice with the existing
   capability, context, price, route, and verification owners into one profile
   consumed by picker, capability routing, transport, Office, and cost UI.
2. **Typed conversation continuity.** Preserve typed roles and tool-call/result
   pairs, summarize older turns, retain the newest answer tail, and budget by
   the effective model's verified context window.
3. **First-token latency.** Instrument prompt sections, memoize same-turn
   retrieval/build work, split required from optional context, and expand
   streaming beyond the Anthropic-only lane where the provider adapter is
   proven.
4. **OpenAI Responses pilot.** Shadow-test direct OpenAI Responses with
   Conversations, persisted reasoning, tool search, programmatic tool calling,
   and compaction. Do not migrate Chat until tool parity, approval/no-replay,
   usage accounting, recovery, and rollback evals pass.
5. **Provider-specific effort adapters.** Translate UC Fast/Balanced/Deep into
   exact supported controls and hide the control when mapping is unverified.
6. **Simple user-facing tiers.** Evaluate Fast, Balanced, Deep, and Voice as
   presentation choices; keep exact provider/model under Advanced and persist
   both requested tier and resolved exact model on every run.
7. **Production eval gate.** Compare proof-backed completion, tool-schema
   failure, recovery, first-token latency, total latency, cache behavior, and
   cost on UC's real task classes before changing any default.

## Verification Boundary

The focused source checks cover catalog/routing/capability/context/pricing/Edge
parity, every built-in Chat text route, site-wide selector wiring, authenticated
catalog trust boundaries, and TypeScript compilation. The main gates are
`smoke:model-catalog`, `smoke:current-model-family`,
`smoke:sitewide-model-catalog`, `smoke:model-catalog-readiness`,
`smoke:model-context-budget-core`,
`smoke:model-pricing`, `smoke:run-cost-rollup-core`, `typecheck:app`, and
`typecheck:functions`. They do not prove that new model access is enabled on a
specific provider account, that the edited Edge functions are deployed, or
that live streaming/tool/computer-use behavior passed end-to-end.
