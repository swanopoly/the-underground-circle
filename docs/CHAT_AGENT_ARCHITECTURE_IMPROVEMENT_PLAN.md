# Chat Agent Architecture — Improvement Plan

> 2026-07-07 (P21). Synthesis of (a) an evidence-cited internal map of how a
> message becomes completed work, and (b) adversarially-verified research on
> 2025-26 production agent-harness architecture (18 load-bearing claims,
> 3-vote verified, zero refutations). This doc owns the architecture roadmap;
> items shipped in P21 are marked.

## Shipped from this plan

- **Item 1 — Deferred tool loading DEFAULT-ON (P25)** ✅ — progressive
  disclosure (pinned ~25-40 core + `tools.search` unlock) is now the default
  typed-loop palette; explicit opt-out via
  `localStorage['uc_openswan_tools_first']='0'`; per-turn fail-safe falls
  back to the full catalog on setup errors. Gated on the P24 search-ranking
  hardening (segment matching, CRUD-verb demotion, family synonyms — all
  smoke-pinned). NEW mode plumbing: the progressive path now applies the
  SAME TOOL_MODE_TAGS filter as the legacy path to both the pinned core and
  search-unlocked additions (plan mode can no longer leak execute-only
  tools — progressive smoke case3c).

- **Item 2 — Prompt-cache discipline + KV telemetry (P26)** ✅ — added a
  SECOND cache breakpoint on the swanbot-ai relay (last message block) so
  the growing tool-loop message history caches every round instead of being
  re-sent uncached (the 100:1 leak); closed the two telemetry gaps — the
  live relay path now logs usage via logClaudeUsage (was a black hole), and
  the client accumulator now carries cache_read vs cache_creation SEPARATELY
  into agent_runs metadata (the ratio that proves discipline works). HONEST
  LIMIT: P25's tool-APPEND still busts the tools tier on unlock rounds
  (render order tools→system→messages); this protects system+history. Native
  `defer_loading` (send full array, never append) is the deeper P27 fix.
- **Item 3 — Classify-once cutover (P26)** ✅ — `detectConversationalIntent`
  is no longer called on plain-chat turns (grep-proven: only comments remain).
  Ported the few legacy-only patterns ("work item", looser office-agent
  triggers) into the planner so it's a strict superset, then replaced the
  ChatTab legacy re-detect with a plan-derived guarded net (reuses
  plan.intent.intent, no re-classification). chat-planner 162, conv-router
  50, cutover-parity 8 — all green.
- **Item 7 — Persist session-critical state (P26)** ✅ — the failure-recovery
  ledger and last-app-resolution now mirror to localStorage (proven
  pendingClarificationRef pattern; no migration), so a reload-to-retry keeps
  duplicate-handoff suppression and app-override learning. Pure helpers in
  chatSessionStatePersistence.ts; smoke:chat-session-state-persistence (49).

- **P27 reliability wave (5 items)** ✅ — (1) route golden canaries (50-prompt CI, pins every P22-P24 bug) + routeDecisionTelemetry (silent-misroute detector); (2) BlackSwan escalation guard shouldEscalateBlackSwanToFrontier, wired live at all 5 resolveModelForProfile sites (keeps BlackSwan for simple grounded lanes); (3) classified tool-failure feedback + progress-based stuck breaker (loop_stopped_no_progress after 3 identical failing calls); (4) outcome-verdict + reaction→signal flywheel in persisted metadata; (5) SSE mid-stream interrupted state + full-jitter capped retry (429/500/504/529). Smokes: route-golden-canary, route-decision-telemetry, tool-failure-feedback, chat-outcome-signals, swanbot-stream-resilience.

- **P28 — final wave: every remaining research item (5, all flag-dark where behavior would change)** ✅ — (Item 2 deeper) **context_management passthrough**: the swanbot-ai relay now forwards Anthropic's `clear_tool_uses` context editing (beta header `context-management-2025-06-27`) with cache-safe large-chunk defaults, default-OFF (verified byte-identical) — the −84%-token/100-turn win once a client opts in. (Item 6) **execute→verify**: `outcomeVerifier` builds a FRESH-CONTEXT verify prompt grading a mutation task's produced outcome against its evidence contract (grade-outcome-not-path; UNSURE fail-safe never claims done); model call flag-dark. (Item 5) **EVPI clarification gate**: `clarificationGate.isDecisionRelevantAmbiguity` — the planner now asks ONLY when a missing slot changes the action/route/approval; fully-specified inputs never over-ask, underspecified still do. (Reliability) **approval idempotency**: `approvalIdempotency` + a guard in applyApprovedAction — an approved-then-retried action returns the cached skip and NEVER double-executes; params-mismatch fails closed. (Reliability) **provider health pre-selection**: `providerHealthRegistry` reorders recently-failed providers to the BACK (30s cooldown; rate-limit/overload/transient cool down, content-policy/auth don't) — fail-VISIBLE (reorders future attempts, never suppresses a surfaced error; no silent failover added). Smokes: anthropic-context-management, outcome-verifier, + extended clarify-timeout/chat-planner/run-approvals/fallback-chain.
- **P30 — app integrations + AI-composed API calls** ✅ — the chat can now
  reach the team's connected third-party APIs, and let the model figure out
  the call. Three pieces: (1) **`messaging.notify`** — an agent-invokable tool
  posting a completion summary / approval request / alert to a connected
  Slack, Discord, or MS Teams channel through a guarded incoming webhook
  (`src/lib/messagingNotify.ts` pure payload builders +
  `supabase/functions/messaging-notify/index.ts` edge fn mirroring the
  custom-api-proxy posture: server-side webhook-URL injection, private-host
  block, `requireApprovedToolCall` verification, secret-scrub, no-secret
  return). Registered across the 8 openswanToolRuntime seams
  (`family:'coordination', approvalMode:'ask', externalSideEffect:true`).
  (2) **AI integration-action composer** (`src/lib/integrationActionComposer.ts`)
  — turns a plain goal + non-secret integration metadata into a proposed
  `custom_api.request` (method∈allowedMethods, bounded path with no `..`/no
  foreign host, secret-strip, JSON≤8000B) that routes through the existing
  approval-gated `custom_api.request` tool — no new execution path, no new
  trust boundary. (3) **`/integrations` command**
  (`src/lib/integrationsChatCommand.ts`, wired in ChatTab + registry):
  `list` shows connected/available integrations, `connect <name>` gives
  honest setup steps (secrets go in Marketplace, never chat), `act <goal>`
  hands the goal to the main agent loop (which already has
  `integrations.list` + `custom_api.read/request`) to compose the call for
  approval. Secrets never enter prompts/chat; every external side effect stays
  approval-gated. Also swept the tool tree to `tool-description-lint` green
  (added when-to-use guidance to 6 pre-existing >3-sibling tools + schema
  prop descriptions on `messaging.notify.fields`). Smokes: messaging-notify
  (106), integration-action-composer (70), integrations-chat-command (52),
  tool-description-lint (green).
- **P31 — popular-API preset catalog (accurate connect + composer that "figures
  out the call")** ✅ — the AI-composed integration action is only as good as
  the metadata it reasons over, so `src/lib/integrationPresets.ts` adds a
  curated, NON-SECRET catalog of popular real APIs (GitHub, Linear, Sentry,
  Airtable, Asana, HubSpot, Jira, Zendesk, Slack Web API, Stripe read-first).
  Each preset carries only public facts (base URL, auth STYLE, example
  endpoints, docs, which secret key to paste) and is constrained to exactly
  what the guarded custom-api-proxy supports (authScheme ∈ bearer/x-api-key/
  basic; secret keys bearer_token / api_key / basic_username+password; JSON
  body; no query-auth, no `Token token=`, no mandatory extra headers — APIs
  outside that envelope like Notion's version header were deliberately
  excluded so guidance is never wrong). Two integration points: (1)
  `/integrations connect <name>` — a known API now gets accurate one-step
  setup (`buildPresetConnectGuide`) as a FALLBACK behind a first-class
  provider def (providerMeta wins, so real flows like GitHub `/gh` and the
  Slack webhook are never mis-overridden), and (2) `buildIntegrationActionPrompt`
  is enriched via `matchPresetForApi` (base-URL host, incl. `{site}`
  placeholders, then apiName) with the matched API's example endpoints, so the
  model composes a real path instead of guessing — for ANY `custom_api`
  connector, def-independent. `presetToCustomApiMetadata` maps a preset 1:1
  onto the `custom_api` metadata shape both the proxy and the composer read.
  Secrets stay in Marketplace; the composed call still routes through the
  approval-gated `custom_api.request`. Smoke: integration-presets (239 —
  catalog safety envelope, resolver, metadata contract, host matching, connect
  fallback layering, and preset→composer endpoint enrichment end-to-end),
  registered in package.json + smoke:all.
- **P32 — preset endpoint hints on the LIVE agent path** ✅ — P31's endpoint
  enrichment only reached the (still-unwired) composer prompt; the composer has
  zero runtime callers, and the live `/integrations act` path is the agent loop
  reading `integrations.list` → `custom_api.read` → `custom_api.request`. So a
  new pure `buildPresetEndpointHint(baseUrl/apiName)` (integrationPresets.ts) is
  injected into the `integrations.list` tool RESULT
  (openswanToolRuntime.ts): any connected `custom_api` integration whose base
  URL host matches a preset now shows a bounded `known <API> endpoints: …` line,
  so the model composes a real path on the flow it actually runs. Lazy-imported
  in the handler (module load order untouched; progressive-tool-disclosure +
  tool-result-formatters + tool-description-lint stay green). Bounded + secret-
  safe. Smoke: integration-presets extended to 246 (buildPresetEndpointHint
  coverage). (The composer library was still unwired at this point — closed in
  P33.)
- **P33 — composer is now a first-class tool (`integration.compose_action`)** ✅
  — closed the P32 gap: the validated structured-proposal path is wired into the
  runtime. New OpenSwan tool registered across all seams
  (`openswanToolRuntime.ts`): the loop model proposes a call
  (`integrationId/apiName` + `goal` + `method`/`path`/`query`/`body`), and the
  handler loads the connected `custom_api` integration, runs the SAME composer
  validators the pure module uses (`effectiveActionMethods` allowlist,
  `parseIntegrationActionProposal` → relative in-host path, no `..`,
  secret-strip on query/body, body byte cap), then returns a one-line
  `describeProposedIntegrationAction` preview + the EXACT `custom_api.request`
  args to run next — or a corrective error to fix and re-compose. It is
  read-only/auto (`family:'knowledge'`, `mutatesState:false`,
  `externalSideEffect:false`) and sends NOTHING; execution stays on the
  approval-gated `custom_api.request` (not a new execution path). The
  `/integrations act` prompt (ChatTab) now routes through it:
  integrations.list → optional custom_api.read → **compose_action** →
  custom_api.request. Chosen over an agent-in-a-tool (nested model call) because
  the loop model is already capable + now has the P32 preset hints, and
  `universalInvoke` is not tsx-loadable (would block smoke coverage). Smoke:
  integration-action-composer extended to 80 (the handler's validate→map→preview
  chain), plus typecheck (exhaustive tool maps/switches) + tool-description-lint
  + progressive-tool-disclosure + tool-result-formatters all green.
- **P34 — integration action receipts (Wave 2 · W1)** ✅ — closed the
  action→proof loop the integrations arc opened. New pure
  `src/lib/integrationActionReceipt.ts`: `buildIntegrationActionOutcome(result)`
  turns a `custom_api.request` / `messaging.notify` result into a structured,
  SECRET-SAFE outcome — a verdict from HTTP status (success / client_error /
  server_error / blocked), a one-line proof `summary`, and the created/affected
  resource's URL or id extracted from the response body (bounded recursive walk
  preferring `html_url`/`permalink`/`web_url`/`url`/`self` then
  `key`/`id`/`number`/`gid`, so GitHub `html_url`, Linear's nested GraphQL
  `url`, Jira `self`, Airtable `rec…` all resolve). Safety by construction:
  never surfaces a value under a secret-shaped key, strips secret-shaped query
  params from URLs, rejects token-shaped ids, bounded, never throws. Wired into
  `formatCustomApiProxyResult` so a write result now LEADS with
  `✅ Created <resource>: <url>` before the raw preview, and the
  `messaging.notify` success line uses the same outcome (`✅ Posted to Slack`).
  Static (dependency-free) import — progressive-tool-disclosure +
  tool-result-formatters stay green. Smoke: integration-action-receipt (30 —
  extraction across provider shapes, verdicts, secret-safety, truncated-JSON
  robustness, bounds), registered in package.json + smoke:all. Follow-up (W1
  tail): feed this outcome into the AgentReceiptCard proof list once the tool
  result reaches the card's input (the extraction is ready).
- **P35 — integration health registry (Wave 2 · W4)** ✅ — fail-visible
  observability so a connected-but-failing integration stops reading as
  "works" (a Known Risk Area). New pure `src/lib/integrationHealthRegistry.ts`
  (mirrors `providerHealthRegistry`: in-memory, per-session, bounded, time-
  injectable): `recordIntegrationOutcome(key, {verdict,status}, nowMs)` +
  `getIntegrationHealthHint(key, nowMs)` → a WARN-only
  `⚠️ last call failed (HTTP 500), 2 in a row`, or null when healthy / stale
  (>15 min) / unrecorded. Reuses the P34 verdict. Recorded in the
  `custom_api.read`/`request` handler (keyed by the proxy-resolved integration
  id) and the `messaging.notify` handler (keyed `messaging:<provider>`), and
  surfaced in the `integrations.list` tool RESULT so the agent won't blindly
  act on a dead integration. Observability only — never suppresses, retries,
  hides an error, or drops an integration (fail-visible invariant). Smoke:
  integration-health-registry (21 — warn/clear/streak/staleness/neutral-unknown/
  bounds/eviction), registered in package.json + smoke:all. Wave 2 status: W1 ✅
  W4 ✅; W2 (multi-step workflows), W3 (scheduled actions), W5 (unified prompt
  builder) open; the AgentReceiptCard tail of W1 open.
- **P36 — integration proof in the AgentReceiptCard (Wave 2 · W1 tail, closes W1)** ✅
  — the P34 receipts now surface in the SIGNATURE accountability card, not just
  the tool-result text. It rides the `toolEvents` that already flow run →
  persisted metadata → ChatMessage: `extractIntegrationReceiptFromToolEvent`
  (integrationActionReceipt) reads the `✅ Created <resource>: <url>` lead line
  + first scrubbed https URL back out of a completed `custom_api.request` /
  `messaging.notify` event; `agentReceipt.deriveProof` accepts `toolEvents` and
  pushes those as the FIRST proof entries (primary evidence for an
  `/integrations act` turn); ChatTab passes `item.toolEvents`. Only ✅ successes
  become proof — a failed write or a plain read never fabricates one — and the
  URL stays secret-scrubbed. Pure, dependency-free import keeps agentReceipt
  tsx-loadable. Smoke: agent-receipt extended (integration toolEvents → proof,
  failed/read → none, secret-param scrub). Wave 2 now: W1 ✅ (fully) · W4 ✅;
  open: W2 multi-step workflows, W3 scheduled actions, W5 unified prompt builder.
- **P37 — scheduled recurring integration actions: SAFETY CORE (Wave 2 · W3)** ✅ —
  a recurring action is an UNATTENDED external side effect, so the safety model
  ships first and the responsible order is enforced: get the guardrail right
  BEFORE enabling autonomous execution. New pure
  `src/lib/scheduledIntegrationAction.ts`: `validateScheduledIntegrationAction`
  refuses to schedule anything that hits the approval floor — a
  `detectScheduledFloorCategory` (pay/delete/login/grant, high-recall, mirrors
  computerGrantGate's sticky floor) rejects "pay the invoice monthly", "delete
  stale issues weekly", "log in and refresh nightly", "add contractors as admins"
  — while allowing ordinary read+post tasks ("post yesterday's merged PRs to
  Slack"). Plus bounded goal + a rate ceiling (`maxRunsPerDay`, clamped ≤ 24).
  `describeScheduledIntegrationAction` states the standing-approval scope
  (reads+posts only, N×/day, STOP on floor), and `buildScheduledIntegrationRunPrompt`
  bakes a HARD-STOP-on-floor guard into the run-time prompt so an EMERGENT floor
  action at run time still halts (belt + braces). Smoke:
  scheduled-integration-action (74 — floor refusals across 13 phrasings + safe
  goals allowed + rate/goal bounds + run-prompt guard). **Deliberately NOT
  enabled yet:** autonomous edge EXECUTION of the agentic read→compose→post turn
  — the `scheduled-action-runner` executes fixed-payload kinds and the
  `watch-scheduler` runs browser tasks; an agentic integration run server-side
  is the reviewed follow-up. The safety spec + run-prompt are ready to plug in.

- **P38 — unified prompt-assembly seam (Wave 2 · W5, part 1)** ✅ — the W5
  premise was re-verified first (internal map, 2026-07-09): the three lanes
  ALREADY share `buildSystemPromptAsync`; the real frictions were (a) the
  block ordering / complexity policy / extras budget / cache boundary lived
  inline in RN-tainted `swanbot.ts` where none of it could be smoke-pinned,
  and (b) each lane enters with differently-enriched context (stream thin;
  batch pre-resolves collab+memory; v2 duplicates the computer/design ladder
  and double-recalls memory). New pure `src/lib/chatPromptAssembly.ts` owns
  those decisions: `resolveChatPromptContextPolicy` (the exact legacy tier
  numbers), a 31-key canonical section registry (`CHAT_PROMPT_SECTION_ORDER`,
  runtime_bundle first — the legacy unshift), stability tags per section
  (Claude Code's dynamic-boundary pattern: breakpoints derive from tags, not
  hand placement), `assembleChatPromptExtras` (order + '\n\n' join + the
  0.7-lastBreak clip) and `composeChatSystemPrompt` (base + boundary + tail).
  `buildSystemPromptAsync` now pushes KEYED sections and delegates
  policy/order/clip/boundary to the seam — BYTE-IDENTICAL by construction and
  pinned against a verbatim legacy-compose oracle in the smoke. Lane specs
  (`getChatPromptLaneSpec`) encode the entering-context divergence as typed
  data, including the v2 lane's 13-section `duplicateSectionDebt` — the
  pinned spec for the dedupe follow-up. Research grounding (3-source
  consensus, fetched + dated): one assembly mechanism with lane variation as
  configuration (Claude Code, dbreunig 2026-04-04), volatile content out of
  the cacheable prefix (Anthropic context-engineering 2025-09-29; Manus
  KV-cache 2025-07-18). Smoke: chat-prompt-assembly (~60 — tier numbers,
  canonical order, byte-identity across 6 budgets, both clip branches,
  empty/whitespace behavior, boundary bytes, lane specs), registered in
  package.json + smoke:all.
- **P39 — unified lane error boundary (Wave 2 · W5, part 2)** ✅ — the map
  found 6-8 distinct lane result shapes and NO lane matching the target
  `{status, message, recoveryOptions}`. New pure `src/lib/chatLaneOutcome.ts`:
  `ChatLaneOutcome` (status = ChatAutomationOutcome's 6-value enum +
  `interrupted` for the stream lane's partial-output drop) + normalizers for
  every legacy shape (`normalizeAutomationOutcome`, `normalizeCommandResult`,
  `normalizeConversationalIntentResult`, `normalizeStreamResult`,
  `normalizeStructuredResponse`, `normalizeThrownError`) +
  `classifyChatLaneError` — the research-derived TWO-AXIS classification
  (who can recover: model/system/user/none × retry-side-effect-safe;
  LangGraph RetryPolicy / OpenAI guardrails pattern). Fail-closed: an
  unclassified error is NEVER retry-safe. Fail-visible: `servedBy` records
  which model/transport actually served + explicit `fallback` flag (the
  GPT-5-router / Anthropic-postmortem lesson — a silently degrading lane
  reads as global collapse). LIVE WIRING: ChatTab's stream lane previously
  dropped the interrupted terminal (`onError: (msg) => reject(...)`) and
  fell back to batch on EVERY stream error — re-running the whole turn with
  partial text already on screen (duplicate answer + possible double side
  effects via the escalation path). Now the interrupted result is captured,
  normalized, and an `interrupted`-with-partial-output terminal STOPS the
  lane visibly ("⚠️ stream interrupted — say continue") instead of silently
  re-running; pre-handshake failures (nothing delivered, retry-safe) keep
  the legacy batch fallback byte-for-byte. Boundary failure itself degrades
  to the legacy path (observability never takes down the turn). Smoke:
  chat-lane-outcome (~40 — two-axis classification incl. the
  "connection refused ≠ model refusal" pin, interrupted≠failed, pre-handshake
  retry-safe, visible fallback, bounded options/messages, telemetry shape),
  registered in package.json + smoke:all. W5 remaining tail: migrate the
  other ChatTab catches onto the boundary, v2 ladder dedupe per the P38 lane
  spec, single memory-recall for v2.

- **P40 — v2 single memory-recall (X1)** ✅ — the v2 tool-loop lane recalled
  memory TWICE (its own `buildOpenSwanMemoryStores` bundle + the assembler's
  internal recall, because `buildStreamableSystemPrompt` had no passthrough)
  and injected the content TWICE (the assembler's fenced store sections + the
  whole `memoryBundle.combined` pasted into `chatHistory` as
  "## Memory Context", unfenced). Fix: `buildStreamableSystemPrompt` gained
  `memoryStores` (forwarded into `SwanBotContext.memoryStores`, which the
  assembler already honored — the text-only path worked this way all along);
  the v2 call site now passes its bundle AND the chatHistory injection is
  reduced to ONLY `memoryBundle.userNotes` — the one slice the assembler's
  sections don't emit — now `wrapUntrusted`-fenced (member-authored → data,
  not instructions; closes a pre-existing rule-5 gap on this line). Finding
  recorded, not changed: `SwanBotContext.memoryContext` is dead plumbing (set
  by the batch lane, read by nothing), which means USER NOTES currently reach
  no lane's prompt except v2 — promoting `userNotes` to a first-class
  assembler section (`memory_user_notes`) is the follow-up, deferred because
  it changes every lane's prompt shape.
- **P41 — v2 ladder dedupe (X1)** ✅ — the v2 session runtime passes its
  block LADDER (mode contract + standards + pipeline + 12 computer/design
  blocks + agentic-coding prompt) as `currentMessage`, so the assembler's
  message-derived builders re-emitted the same blocks into the system tail —
  the model saw them twice (and detector false-positives on ladder text could
  add noise blocks). Fix: pure `omitChatPromptSections` in
  `chatPromptAssembly` + `SwanBotContext.omitPromptSections` +
  `buildStreamableSystemPrompt.omitSections`; the v2 call site passes
  `getChatPromptLaneSpec('openswan_v2').duplicateSectionDebt` (now 14 keys —
  `task_pipeline` added: the ladder builds it at limit 3, the assembler
  duplicated at limit 2). Dedupe direction SETTLED by the code read and
  recorded in the lane spec: the ladder KEEPS its copies (equal-or-richer,
  and volatile task framing belongs in the user message), the ASSEMBLER omits
  exactly the debt keys. Other lanes pass no omit list → byte-identical.
  Known follow-up: v2's `currentMessage` is still the ladder (routing
  complexity + memory-recall query see ladder text) — passing `cleanMessage`
  with a complexity floor is its own evaluated change.
- **P42 — lane-terminal telemetry on the ChatTab catches (X1 wave 1)** ✅ —
  the batch/OpenSwan catch and the outermost `sendMessage` catch now classify
  their failure through `chatLaneOutcome` and stamp
  `buildChatLaneOutcomeTags` (lane, status, recoverable_by, retry_safe,
  failure_reason, served_by_fallback) into the session-archive tags +
  a structured console line. Telemetry only — `startMainChatFailureRecovery`
  stays authoritative for user-facing recovery; boundary failure degrades to
  the legacy path. New `ChatLaneId: 'send_message'` for the outer boundary.
  This is the seed of the per-lane quality signal (X7): one degraded lane is
  now legible in the archive instead of reading as global decline. Remaining
  X1 tail: the other ~27 ChatTab catches (mechanical, per-lane cleanup
  preserved), and the `memory_user_notes` assembler section above. Smokes:
  chat-prompt-assembly extended (omit helper, task_pipeline debt, non-mutating
  no-op), chat-lane-outcome extended (tags: two-axis, success-minimal,
  fallback), openswan-session-core-adapter + openswan-typed-runtime-invariants
  re-run green.

- **P43 — user notes as a first-class assembler section (X1)** ✅ — closed
  the P40 finding: user-authored notes reached NO lane's prompt except v2
  (dead `memoryContext` plumbing on batch; stream never carried them). New
  canonical section `memory_user_notes` (32 keys now), ordered BEFORE the
  inferred profile per openswanMemoryStores' own "user-authored notes first
  (highest signal)" rule, emitted `wrapUntrusted`-fenced from
  `stores.userNotes` under the same loadMemory gate as the other stores. The
  P40 interim v2 chatHistory injection is RETIRED — notes now appear exactly
  once on EVERY lane (stream/batch recall them internally; v2 supplies its
  pre-resolved bundle). Deliberate prompt-shape change on all lanes.
- **P44 — v2 assembler sees the user's message, not the ladder (X1)** ✅ —
  `runOpenSwanSessionTurn` now passes `currentMessage: cleanMessage` +
  `complexityFloor: 'moderate'` (new pure `applyChatPromptComplexityFloor`,
  threaded `buildStreamableSystemPrompt.complexityFloor` →
  `SwanBotContext.promptComplexityFloor`). Effect: routing
  complexity/intent, turn-retrieval + skills queries, project discovery, and
  the collaboration seam right-size to the user's actual message instead of
  ladder text (which classified nearly everything complex and polluted
  retrieval queries); the floor guarantees the v2 lane never drops below the
  moderate context stack (memory/wisdom/missions) on short messages, and a
  genuinely complex message still classifies complex. The ladder stays the
  tool loop's userMessage; its blocks stay deduped via the P41 omit list.
- **P45 — computer-task lane terminals classified (X1 wave 2)** ✅ — all
  three computer-task failure sites funnel through ChatTab's
  `startTaskFailureRecovery` wrapper, so ONE seam now classifies the failure
  (`normalizeThrownError('computer_task', …)`) and appends
  `buildChatLaneOutcomeTags` to the recovery archive's `touched` tags +
  structured console line. Telemetry only; evidence-recovery flow stays
  authoritative. Lane coverage so far: stream (behavioral, P39),
  openswan_v2 + send_message (P42), computer_task (P45). Smokes:
  chat-prompt-assembly extended (~75 — 32-section order, notes-before-profile
  pin, floor cases), lane-outcome + openswan adapter/invariants re-run green.

- **P46 — API-native deferred tool loading (Wave 3 · X2), FLAG-DARK** ✅ —
  the deeper fix for P26's honest limit (P25's client-side tool-APPEND busts
  the tools cache tier on unlock rounds). New pure
  `src/lib/anthropicNativeToolSearch.ts`, wire shapes VERIFIED against the
  live tool-search doc (fetched 2026-07-09): search-tool entries
  (`tool_search_tool_regex_20251119` / `bm25`, GA — no beta header),
  `defer_loading: true` on non-pinned tools with the full catalog sent every
  round (the API excludes deferred defs from the context prefix server-side
  and expands `tool_reference` blocks on discovery — prefix untouched, cache
  preserved BY DESIGN; Anthropic-measured ~85% token cut, accuracy 49→74%).
  Encoded invariants (smoke-pinned): search tool first + never deferred;
  documented model list only (aliases/marketplace ids fail closed);
  10-tool / 10k-token decision thresholds; `cache_control` scrubbed from
  deferred defs (API 400); deterministic payload across rounds (the cache
  contract); client-side `tools.search` excluded when native is active;
  non-mutating. LIVE WIRING (dark): `executeToolUseLoop` builds the
  full-catalog native payload when `uc_native_deferred_tools`='1' AND the
  loop model is on the compatibility list — verified the swanbot-ai relay
  forwards `tools` verbatim with no tools-tier cache_control, so NO edge
  change is needed for the flip. Loop compatibility verified from the doc:
  search results arrive as `server_tool_use` + `tool_search_tool_result`
  blocks (never tool_result'd, passed back verbatim — both already true of
  our loop); discovered tools arrive as ordinary `tool_use`. Default OFF =
  byte-identical relay body. FLIP GATE: a live opted-in run measuring
  cache_read ratio + tool-selection behavior vs the P25 palette (joins the
  outcomeVerifier/context_management "awaiting runtime proof" row). Smoke:
  anthropic-native-tool-search (~40), registered in package.json + smoke:all;
  progressive-tool-disclosure + tool-loop smokes re-run green.

- **P47 — `input_examples` on the gnarliest schemas (Wave 3 · X4), LIVE** ✅ —
  Anthropic-measured 72→90% param accuracy on complex inputs; GA with NO beta
  header (verified against the define-tools doc, fetched 2026-07-09), so this
  ships live, not flag-dark. New pure `src/lib/toolInputExamples.ts`: curated
  examples for 12 gnarly tools (InDesign batch find/change + text layers,
  Photoshop adjustment/mask/resize/manage/transform, cad_compile,
  wp.update_post, integration.compose_action, messaging.notify) written
  against the EXACT registry schemas and exercising the confusing parts
  (enum-branch co-required fields, nested array items, optional-field
  omission); a structural validator covering the classes that would 400 the
  request (unknown key, missing required, enum, type, array bounds, nested
  items); and `attachToolInputExamples` which re-validates at runtime and
  DROPS non-conforming examples rather than sending them (an invalid example
  fails the WHOLE request — fail-safe beats a broken loop). Attached at the
  catalog chokepoint (`listOpenSwanAnthropicToolsForSurface`) so BOTH lanes
  get them, with carry-through added at every mapper that re-builds tool
  shapes (executeToolUseLoop legacy + P46 native catalog maps,
  openswanBridge → AgentToolDefinition, toAnthropicToolShapes adapter,
  agentProviders/anthropic). The edge relay forwards tools verbatim; the
  OpenAI-shape marketplace converter drops the field harmlessly; under P46
  native tool search a deferred tool's examples expand along with its
  definition on discovery. v2 edge (`swanbot-v2-ai` TOOLS) not yet decorated
  — its examples ride the next edge deploy cycle. Smoke:
  tool-input-examples (69 — the load-bearing case validates EVERY curated
  example against the LIVE catalog schema via the registerHooks RN-stub
  technique, so schema drift fails the smoke, not production; plus validator
  failure classes, fail-safe drop on a drifted schema, non-mutation,
  chokepoint integration, no secret VALUES), registered in package.json +
  smoke:all; tool-description-lint + agent-core + typed-runtime-invariants +
  progressive-tool-disclosure re-run green.

- **P48 — per-lane quality signal (Wave 3 · X7), LIVE** ✅ — the postmortem
  primitive: one degraded lane must read as THAT lane degrading, not global
  quality collapse (Anthropic postmortem 2025-09; GPT-5 router outage). New
  pure `src/lib/chatLaneHealthRegistry.ts` (mirrors provider/integration
  health registries: in-memory, per-session, bounded 16 lanes × 50 events,
  time-injectable, fail-VISIBLE): `recordChatLaneTerminal/Outcome` consumes
  the P39/P42/P45 envelopes; per-lane snapshot (ok/failed/interrupted/neutral
  buckets, trailing streak, failure rate over non-neutral outcomes, visible-
  fallback count); degradation thresholds (streak ≥3, or ≥50% failures at ≥4
  outcomes); and `assessChatLaneDegradation` — the classifier that separates
  `lane_isolated` ("suspect that lane's transport/model, not global quality")
  from `multi_lane` ("treat as systemic"), staleness-aware (30-min window, no
  crying wolf). LIVE WIRING: all four failure terminals now record + carry
  `lane_degraded`/`lane_failure_streak`/`lane_degradation_scope` archive
  tags; SUCCESSES recorded too (clean stream terminal + clean
  runOpenSwanSessionTurn, with routing-fallback carried) so failure rates
  have a denominator; and a new local `/lanes` command (also "lane health")
  renders the session report — classification line first, then per-lane
  ✅/⚠️ rows with ok-rate, last status/reason/age, fallback count.
  `interrupted` counts against a lane (the user saw a partial answer);
  deferred/blocked/skipped/needs_input are policy outcomes → neutral. Smoke:
  chat-lane-health (~35 — buckets/streak/rate, both degradation floors,
  isolated-vs-multi-vs-none incl. staleness, warn-only hints, tag shapes,
  report formatting, bounds/eviction/junk/reset), registered in package.json
  + smoke:all. X7's dashboard tail (Office surfacing, cross-session
  agent_runs aggregation pairing with the P27 route canaries) stays open.

- **P49 — server-side compaction passthrough (Wave 3 · X3), FLAG-DARK** ✅ —
  extends the P28 `context_management` seam with Anthropic's compaction beta
  (wire facts verified against the compaction doc, fetched 2026-07-09:
  edit `compact_20260112`, beta `compact-2026-01-12` — a DIFFERENT token
  from context editing's `context-management-2025-06-27`; trigger
  `input_tokens` with documented 50K floor / 150K default; optional
  `pause_after_compaction` → stop_reason 'compaction' and bounded custom
  `instructions` that REPLACE the default summarizer). Pure module
  additions (`anthropicContextManagement.ts`): `buildCompactionConfig`,
  compaction-aware `normalizeClientContextManagement` (client configs clamp
  through the builder; compaction ordered FIRST when mixed with
  clear_tool_uses — summarize before pruning), mode `'compact'` opt-in,
  `isCompactionSupportedModel` (documented list — NOT Haiku 4.5 / Opus 4.5)
  + `stripUnsupportedCompactionEdits` (the relay's fail-closed model gate:
  attaching compaction on an unsupported model would 400 the call),
  `requiredContextManagementBetas` / `appendContextManagementBetasForConfig`
  (each config carries exactly the beta tokens its edit types need), and
  response-side `containsCompactionBlock` helpers. Edge relay branch
  extended: resolve → model-gate → attach config + derived betas; still
  default OFF (no client sends either opt-in) → byte-identical relay.
  Verified end-to-end preservation contract: the relay forwards Anthropic's
  response content untouched and the client loop pushes `data.content`
  verbatim, so `compaction` blocks survive the round-trip by construction
  (the doc's critical requirement). Three pre-P49 smoke pins of "compaction
  unrecognized" were deliberately flipped and documented in place. Usage
  note for the flip: top-level usage EXCLUDES compaction costs — sum
  `usage.iterations`. Client opt-in one-liner:
  `context_management_mode: 'compact'` on the relay body; flip gate = a live
  long-loop run (joins outcomeVerifier/clear_tool_uses/X2 in the
  awaiting-runtime-proof row), and enabling server compaction on a path
  should disable the client-side Haiku compressor there (redundant work).
  Smoke: anthropic-context-management extended to 37 (wire tokens, builder
  defaults/clamps/optional-field emission, model gate, fail-closed stripping
  incl. mixed configs on Haiku, mode resolve, compaction-first ordering,
  per-config beta derivation, block detection). Edge deploy required before
  the flip (same op posture as P28).

- **P50 — Agent Skills standard audit (Wave 3 · X8), LIVE** ✅ — closes the
  Wave 3 table. New pure `src/lib/skillStandardCompat.ts` (composes with the
  existing `skillFrontmatter`/`skillRelPath` helpers — no new parsing
  dialects), spec constants verified against the agent-skills overview doc
  (fetched 2026-07-10): name ≤64 `[a-z0-9-]` with reserved words
  "anthropic"/"claude" banned, description non-empty ≤1024 no XML tags with
  a WHEN-signal quality warning, ~5k-token Level-2 body guidance, safe
  relative supporting-file paths. `auditSkillStandardCompat` (error =
  upload-rejected, warning = quality), `normalizeSkillNameForStandard`
  (export-side coercion; reserved words stay unfixable errors),
  `buildStandardSkillMd` (standard-conformant export that round-trips
  through `parseSkillFrontmatter`), `summarizeSkillCompat` (one bounded
  line, errors lead, silent when clean). LIVE WIRING: (1) recipe/skill
  create proposals now carry a warn-only portability note in the approval
  description (fail-safe — audit failure never blocks a filing); (2) the
  smoke runs a CONTINUOUS CONFORMANCE GATE over every in-repo skill (the
  `skills/` folders incl. their supporting-file relpaths + the generated
  CANONICAL_SKILLS bundle) — a portability regression now fails CI, not a
  future export. The gate immediately paid for itself: two shipped skills
  (app-task-automation, browser-form-submission) carried `<app>`/`<site>`
  placeholder tokens in their descriptions — XML-tag-shaped content the
  standard rejects — fixed losslessly to `[app]`/`[site]` in the source
  folders and the bundle regenerated (canonical-skills bundle-sync smoke
  re-verified). Smoke: skill-standard-compat (~45), registered in
  package.json + smoke:all. Tail: an export surface (`/skill export` → zip
  or `/v1/skills` upload) can now build on `buildStandardSkillMd`.

- **P51 — edge deploys + `/skill export` (X4 tail closed; X8 tail closed)** ✅ —
  DEPLOYED (2026-07-10, project rjkniqiqdtroeholxacg): (1) `swanbot-ai` —
  carries the P49 compaction passthrough live-but-dark (the X3 flip is now
  ONE client opt-in away: `context_management_mode: 'compact'` on the relay
  body; no further ops step). (2) `swanbot-v2-ai` — now decorates its TOOLS
  with the P47 `input_examples` at its single tool-mapping site (imports the
  same pure `toolInputExamples` module; the attach helper re-validates every
  example against the V2 catalog's OWN schemas and drops non-conforming ones,
  so client/edge schema drift cannot smuggle a 400). This is LIVE on the
  default v2 lane immediately — X4's remaining tail is closed. Deploy-gate
  note: `typecheck:functions` currently fails on PRE-EXISTING
  `computer-use-agent` errors ('steer' on AgentRequest + a tool_result text
  shape — in-flight work from before this session, untouched); both deploy
  targets were deno-checked clean individually before deploying. ALSO
  SHIPPED: `/skill export <name>` (skillChatCommands) — renders the
  standard-conformant SKILL.md via P50's `buildStandardSkillMd` with a
  residual portability line, the folder layout when supporting files exist,
  and where-it-works guidance (Claude Code dir / claude.ai zip /
  `/v1/skills`). Thin glue over the P50 pure functions (already
  smoke-pinned); help text updated.

- **P52 — X2 flip-gate live probe (`probe:native-deferred-tools`)** ✅ — the
  measurement harness for flipping `uc_native_deferred_tools`, mirroring the
  R8.0 Browserbase live-probe posture (env-only secrets, masked/redacted
  output, explicit spend gate `UC_PROBE_CONFIRM=1`, isolated failures, NOT
  in smoke:all). Three gated questions, 4 real requests total: **Q0 wire**
  (deployed relay accepts the native payload end-to-end without a 4xx),
  **Q1 selection** (an off-palette read-only target — auto-picked from the
  catalog, prefers `wp.list_posts` — reached via native discovery:
  `server_tool_use` → `tool_search_tool_result` → `tool_use`), **Q2 cache**
  (round-2 continuation: control replays with a P25-style tool APPEND —
  expected cache bust — vs the byte-stable treatment array; compares
  `cache_read_input_tokens`). Protocol contracts enforced in the harness: NO
  tool is ever executed (`(probe stub)` results), `srvtoolu_` ids are never
  answered, search-result blocks pass back verbatim. Prints GO/NO-GO
  (Q2-inconclusive degrades to "verify via agent_runs cache metadata").
  `UC_PROBE_DRY_RUN=1` builds + prints both payloads with zero
  network/spend — dry run verified: control palette 34 tools (~18 KB) vs
  native payload 178 entries (search + 33 pinned + 144 deferred, ~121 KB
  wire; deferred defs stay out of the context prefix server-side). Runbook:
  `UC_PROBE_EMAIL/PASSWORD` (or `UC_PROBE_ACCESS_TOKEN`) +
  `UC_PROBE_CIRCLE_ID` + `UC_PROBE_CONFIRM=1 npm run
  probe:native-deferred-tools` → on GO, set
  `localStorage['uc_native_deferred_tools']='1'` on one device and watch
  `/lanes` + agent_runs cache ratios.

- **P53 — lane health on the Office view (X7 dashboard tail), LIVE** ✅ —
  `OfficeLaneHealthStrip` (sibling of OfficeBridgeReadinessStrip, same
  contract and styling): WARN/DANGER-only, silent when healthy/stale —
  `warn` (amber) = lane-isolated degradation ("suspect that lane, not global
  quality"), `danger` (red) = multi-lane systemic. Self-polls the P48
  session registry every 20s with a churn guard (state only updates when the
  rendered text changes); registry read errors render nothing (observability
  never breaks Office). Pure presentation model
  `buildChatLaneHealthStripModel` lives in `chatLaneHealthRegistry`
  (headline = lane + streak + last reason, bounded; detail = the assessment
  summary + a pointer to `/lanes`) — smoke-pinned (empty/healthy/stale →
  null; isolated → warn; multi → danger; bounds). Two-line OfficeTab
  insertion next to the bridge strip. X7 remaining: cross-session
  `agent_runs` aggregation pairing with the P27 route canaries (needs a
  query/dashboard surface, not a session registry).

- **P54 — model-driven one-shot clarifier for computer tasks, LIVE** ✅ —
  the "ask for more context using the AI model" half of the app/browser
  reliability directive. New pure `src/lib/computerTaskClarifier.ts`: a
  strict-JSON system prompt for a CHEAP model (`claude-haiku-4-5` via the
  relay, 8s race timeout) with the EVPI discipline baked in — ask ONLY when
  an answer changes actions/target/scope/risk, max 3 batched questions, safe
  defaults become stated ASSUMPTIONS, approval/secret questions explicitly
  forbidden (the HITL floor and vault own those), launch-only tasks always
  ready. Parser is FAIL-OPEN in every failure class (junk/broken JSON/empty
  questions → proceed; downstream observe/approve gates still protect
  mutations). Once per (circle, task) via a bounded normalized-key registry;
  "proceed"/"just do it" phrasing opts out. LIVE WIRING in
  `executeComputerTaskWithAgent` (app/file/hybrid lane) before any heavy
  work: questions return as the turn's `response` (renders with ZERO ChatTab
  changes; the reply re-enters planning with the answers) + additive
  `clarification` field on ComputerTaskRuntimeResult. Opt-out
  `uc_model_clarifier`='0'. Follow-up recorded: browser-lane parity (that
  handoff lives in ChatTab, not this runtime). Smoke:
  computer-task-clarifier (~40).
- **P56 — stuck-loop solver consultation in the typed core, LIVE** ✅ — the
  "utilize the LLM to figure out a solution" half. Previously three
  identical failing calls → hard `loop_stopped_no_progress`; now the stuck
  point first injects ONE structured fresh-eyes consultation (pure
  `src/lib/toolLoopSolver.ts`): the failing call is NOT dispatched (its
  tool_use closes with an explanatory error result — transcript stays
  well-formed/resumable), and a `[stuck-solver]` user message forces ROOT
  CAUSE (quoting the REAL error, extracted escape-aware from the failure
  envelope past the recovery preamble) → TWO genuinely different approaches
  (tool/surface/target, re-observe counts; available tools listed, bounded
  40) → ACT or produce a clean blocker report. Gates/constraints explicitly
  unchanged — it changes the plan, never permissions. Once per run; a second
  stuck verdict proceeds to the hard stop with "still stuck after a solver
  consultation". New typed `solver_consultation` AgentEvent. Smoke:
  tool-loop-solver (~30 — pure shape/bounds/gate + E2E through runAgent with
  scripted providers: ignored-consultation → hard stop with only 2 real
  dispatches; recovery path → different tool runs, no stop; transcript
  well-formedness pin); agent-core + steering smokes re-run green.

- **P57 — browser-lane clarifier parity, LIVE** ✅ — closes the P54
  follow-up: the browser lane bypasses `executeComputerTaskWithAgent`
  (ChatTab's `run_computer_task` handler calls `describeComputerUsePlan`
  directly), so it never hit the P54 gate. The P54 orchestration is now
  extracted into a SHARED exported helper
  (`computerTaskRuntime.runComputerTaskClarifierCheck` — flag check → gate →
  mark-asked → haiku relay call with 8s race → fail-open parse), the
  app/file/hybrid call site consumes it (also gains: never re-clarify on a
  buildout-retry pass), and the browser handler runs the SAME check before
  planning — questions return as a `needs_input` ChatAutomationOutcome with
  the clarification payload in `data`. One implementation, both lanes; the
  once-per-(circle,task) registry naturally spans lanes so a task that
  re-routes never gets asked twice. All pure surfaces already smoke-pinned
  (computer-task-clarifier); computer-task-runtime +
  chat-transport-handlers re-run green.

- **P58 — consolidated activation sequence, LIVE (both lanes)** ✅ — the
  "activate what it needs" third of the task-reliability directive, and the
  last recorded follow-up. The prerequisites already existed but were
  scattered (preflight WARNS, complexity plan HINTS at the app choice,
  grants listed, reachability a tool away) — mid-loop failures were the
  discovery mechanism. New pure `src/lib/computerTaskActivation.ts` derives
  ONE ordered contract from the route facts — bridge → grants →
  app/session → target → observe — as imperative steps for the agent's
  EXISTING tools under the EXISTING gates (activation never bypasses
  approvals; it front-loads checks so failure happens at step 1 with a
  clear message, not round 7 with a confusing one). Per-kind shapes:
  desktop kinds start at the bridge check (fail = stop + "start the local
  bridge"); resolved apps get launch-or-focus + frontmost-verify (url-opened
  apps via open_url; availability='maybe' carries the fail-fast fallback
  line); file/hybrid verify the NAMED target is the active document (never
  edit whatever is frontmost); browser gets target-navigation with vault
  credentials + CAPTCHA/MFA stop; everything ends with observe-before-act.
  WIRED at the envelope chokepoint (`prepareComputerTaskExecution`): the
  formatted block is appended to `dispatchPrefix`, which BOTH lanes already
  consume (agent prompt + the browser planner's planningContext) — one
  change, both lanes; envelope exposes `activation` for cards/telemetry.
  Smoke: computer-task-activation (~30 incl. envelope integration);
  computer-pipeline-e2e (217) + computer-task-runtime re-run green. With
  P54/P56/P57 this completes the directive: clarify (model-driven, one
  shot) → activate (ordered, fail-fast) → execute → solve (fresh-eyes
  consultation) → recover.

- **P59 — solver parity for the legacy relay loop, LIVE** ✅ — the typed
  core got the P56 stuck-solver; the legacy `executeToolUseLoop` (which
  serves the DEFAULT-ON stream-escalation lane) only had the per-result
  reminder and burned rounds to the cap. Now: a bounded ring of real
  dispatches (name + stable input hash + ok; gate/floor-blocked calls
  excluded — conservative) feeds the same `detectRepeatedToolFailure`; on
  three identical failures the loop injects ONE `[stuck-solver]`
  consultation (same pure module — root cause quoting the captured failure
  text, two different approaches from the advertised tools, gates
  unchanged) and, if the verdict trips again after that, RETURNS an
  incomplete blocker result instead of re-sampling to the round cap.
  Semantics note vs the typed core: the legacy loop consults after the 3rd
  failure has dispatched (it records post-dispatch), the typed core stops
  before dispatching the 3rd — equivalent protection, one extra doomed call
  on the legacy lane. Pure pieces already smoke-pinned (tool-loop-solver /
  stuck-breaker); typecheck + swanbot-routing green. Every tool lane now
  has clarify → activate → execute → solve → recover.

- **P60 — fix + optimize sweep** ✅ — (1) FUNCTIONS TYPECHECK GATE GREEN
  (all 43 edge functions) for the first time in this arc: repaired the
  pre-existing `computer-use-agent` errors (typed the steering request —
  `steer?: {runId, note}` on AgentRequest — and widened the round's
  toolResults union to admit the deliberate trailing steering TEXT blocks)
  and `watch-scheduler`'s nine `never`-row errors (supabase-js 2.95 strict
  generics: forced the `any` schema generic at the client construction +
  both param annotations — type-level only, zero behavior change). (2) V2
  turn cost: the assembler no longer BUILDS the 14 regex-heavy
  computer/design blocks the v2 lane omits — `buildSectionUnlessOmitted`
  skips construction for keys in `omitPromptSections`; behavior-identical
  for every other lane (the registry-level omit stays as the safety net).
  (3) Catalog chokepoint: `attachToolInputExamples` memoizes validated
  examples per schema OBJECT (static module constants → stable identity),
  name-guarded so shared objects can't leak wrong examples and drifted
  schemas (different object) always re-validate — the drift-protection
  smoke still passes unchanged. All touched-surface smokes green
  (tool-input-examples, chat-prompt-assembly, typed-runtime-invariants,
  progressive-tool-disclosure).

## What P21 already shipped from this plan

- **Typed-loop vision + image economics** ✅ — the loop was worse than
  vision-blind: `desktop.screenshot` base64 was stringified INTO tool_result
  text (a context bomb the model reads as noise) while the model never saw
  pixels. Now: producer side channel (`openswanBridge` →
  `extractToolResultImageSideChannel`), real Anthropic image blocks in
  `agentExecutionCore.dispatchOne` with a deep-scrubbed text envelope
  (smoke-pinned: no base64 ever in stringified JSON), prune-to-newest-2
  before every provider turn (`MAX_LIVE_IMAGES`, replace-not-mutate so R12
  checkpoints keep originals), compression-safe markers + fixed token
  estimate. Verified relay: swanbot-ai passes `messages` verbatim to
  Anthropic, so image blocks flow with zero edge changes.
  Smoke: `smoke:agent-image-economics` (48).
- **SwanBot v2 default-ON (M4)** ✅ — `isSwanbotV2Enabled()` now defaults
  true (explicit `'false'` opts out); 2-consecutive-failure session circuit
  breaker skips v2 for the session (any success or `/v2 on` resets);
  v1 fallback preserved byte-for-byte. Op note: keep `swanbot-v2-ai`
  deployed; the breaker + fallback keep chat working when it isn't.
  Smoke: swanbot-routing (52).

## The internal map's top frictions (evidence-cited)

1. **Double routing**: the planner classifies intent, then the legacy
   conversationalRouter re-detects the same message downstream; two files
   must stay in sync and can disagree silently.
2. **~9 sequential awaited intercepts + ~30 slash routes** in ChatTab
   sendMessage (18.3k-line file) before the planner — 100-300ms of serial
   overhead on fall-through messages and a growth pattern where every new
   capability is a new inline branch.
3. **Three prompt builders** (stream path, batch path, conversational
   handlers) recall memory and assemble context divergently — same message
   can ground differently by path.
4. **Error paths differ per lane** (5+ distinct recovery surfaces).
5. **Session-only state** that should survive reload: pending
   clarifications, app-resolution preferences, recovery ledger.
6. Stream path lacks context compression before escalation; attachment
   context built up to 4×/message; approval logic present in three layers
   (defense-in-depth, but undocumented as a contract).

## Research-backed roadmap (ranked by user-task impact)

| # | Improvement | Evidence anchor | Effort | Risk |
|---|---|---|---|---|
| 1 | **Deferred tool loading default-ON** — pin 3-5 hot tools per lane + `tools.search` tail (T2 exists, ships dark). ~160 tools is 3-5× past Anthropic's documented 30-50 degradation threshold; their tool-search cut tokens ~85% AND raised accuracy (Opus 4: 49→74%) | Anthropic advanced-tool-use (verified); RAG-MCP collapse data | S-M | low |
| 2 | **Prompt-cache discipline + KV-hit-rate as first-class metric** — byte-stable tools+system prefix, append-only messages, no per-turn timestamps ahead of breakpoints; surface `cache_read_input_tokens` in usage telemetry. Cached reads are 0.1×; loops run ~100:1 input:output | Manus ("single most important metric", verified); Anthropic caching docs | S | low |
| 3 | **Classify-once router** — finish the unified-dispatcher cutover (remove the legacy re-detect), collapse intercepts into the registry pattern, keep rule-first fast paths, ONE BlackSwan lane classification with confidence fallback; router-lane telemetry + kill switch (GPT-5 outage + Anthropic postmortem: router failures read as global quality collapse) | Anthropic building-effective-agents; GPT-5 system card | M | med |
| 4 | **Server-side context lifecycle through the relay** — pass `context_management` (clear_tool_uses, large clear_at_least chunks) / compaction beta to Anthropic instead of client hand-pruning; re-inject BlackSwan grounding post-compaction (CLAUDE.md pattern) | +29-39% eval, −84% tokens (Anthropic, verified) | M | med |
| 5 | **Unified prompt builder + error boundary** — one context-assembly seam both stream and batch call; all lane handlers return `{status, message, recoveryOptions}` | Internal map frictions 3-4 | M-L | med |
| 6 | **Execute→verify pass on mutation lanes** — fresh-context verifier model grades the evidence-contract artifacts before "done" (the contract already collects exactly what a grader needs) | CriticGPT 63% (verified); evaluator-optimizer scoping | M | low-med |
| 7 | **Persist session-critical state** — pending clarifications, recovery ledger, app-resolution preferences → agent_run_events/thread state (survive reload; feed the flywheel) | Internal map friction 5 | S-M | low |
| 8 | **Tool-result contract rollout** — `response_format` concise/detailed everywhere (partially done), 25K caps, semantic IDs, corrective-action errors, `input_examples` on the gnarliest schemas (72→90% param accuracy) | Anthropic writing-tools (verified) | S | low |
| 9 | **Provider fallback kit in crossProviderRouter** — 30s-outage exclusion, per-error-class chains (rate-limit ≠ context ≠ content-policy), shared cooldowns, canary evals on the routing layer. NOTE: must reconcile with the house fail-visible invariant — health-based *pre-selection* is compatible; silent mid-request failover is not | LiteLLM/OpenRouter patterns; Anthropic postmortem | S-M | low |
| 10 | **Server-side continuation for long tasks** — iOS gives ~30s background; any task expected to outlive a foregrounded tab needs an edge worker resuming from transcript+diff state (Cursor hybrid pattern) | Platform-verified iOS ceiling; 3-tier resume-state map | L | high |

**Deliberately deferred** (evidence says wait): multi-agent teams beyond
read-heavy fan-out (~15× tokens; coding a named poor fit), vector-store
memory (files+summaries is the shipped 2026 pattern — userMemory/memoryBank
already match), full VM-image resume.

## Wave 2 roadmap — the integrations & proof arc (ranked)

The original 1-10 table above is essentially shipped (P25-P28). Wave 2 opened a
new arc: the chat can now *reach the team's connected third-party APIs and act*
(P30 messaging + AI composer + `/integrations`; P31 preset catalog; P32 live
preset hints; P33 first-class `integration.compose_action`). That arc exposed
its own ranked next items, kept honest against the house invariants (approval
floor never waivable, no secrets in prompts/logs, fail-visible, bounded rows).

| # | Improvement | Why (evidence/gap) | Effort | Risk |
|---|---|---|---|---|
| ~~W1~~ | **Integration action receipts** ✅ SHIPPED (P34 + P36) — extracts the created-resource proof (status + id/URL) into a "✅ Created X: <link>" summary leading the tool result (P34), and surfaces it in the AgentReceiptCard via `toolEvents` (P36). Fully closed | Priority #1 is accountability; the created resource was buried in the fenced response preview. Extends P29 receipts + P28 verifier | S-M | low |
| W2 | **Multi-step integration workflows** — one goal that spans calls ("create a Linear issue AND post it to Slack"): a bounded plan of compose→request→notify steps with a single approval economy and per-step receipts | Real tasks chain systems; today each is a separate manual turn. Reuse the existing plan/approval + W1 receipts, no new trust boundary | M | med |
| W3◐ | **Scheduled / recurring integration actions** — SAFETY CORE ✅ SHIPPED (P37): floor-refusing validation + rate ceiling + STOP-on-floor run prompt (`scheduledIntegrationAction.ts`). Autonomous edge EXECUTION of the agentic read→compose→post turn is the gated follow-up | Standing team-ops value; scheduler + tools exist, and the guardrail (the risky part) is now built + tested | M | med |
| ~~W4~~ | **Integration health & observability** ✅ SHIPPED (P35) — records per-integration last-call verdict/status (in-memory, per-session) and surfaces a fail-visible `⚠️ last call failed` hint in the `integrations.list` tool result. `/integrations` list + Office surfacing is the remaining tail | A connected-but-failing integration reads as "works" until a task dies mid-run (the same class as the provider-routing footgun in Known Risk Areas) | S-M | low |
| W5◐ | **Unified prompt builder + lane error boundary** — CORE SHIPPED (P38+P39): pure `chatPromptAssembly` seam (policy/order/clip/boundary, byte-identical, smoke-pinned) wired into `buildSystemPromptAsync`; pure `chatLaneOutcome` boundary (two-axis recovery classification, visible fallback) wired into the ChatTab stream lane (interrupted≠failed). Remaining tail: migrate the other ~29 ChatTab catches, v2 ladder dedupe (typed debt in the lane spec), single memory-recall for v2 | Internal-map frictions 3-4; premise corrected 2026-07-09 — the lanes shared ONE assembler already, the divergence was entering context + unpinnable ordering | M-L | med |
| — | **Awaiting runtime proof, not effort** — flip `outcomeVerifier`'s model-call flag + the `context_management` passthrough flag once measured on a live run; both are staged dark behind one-liners | P28 shipped the mechanism; only real-traffic validation gates the flip | S | low |

Wave 2 order rationale: W1 first (closes the loop the arc just built + is pure/
testable/low-risk), then W2/W3 (compound value on W1's receipts), W4 (cheap
reliability), W5 (the deeper refactor, sequenced last because it touches every
lane). Deferred within this arc: inbound webhooks/triggers (needs an inbound
edge surface + a new trust boundary — revisit after W1-W4).

## Wave 3 roadmap — research expansion (2026-07-09)

Fresh external sweep (primary sources fetched + dated; Anthropic docs/eng
posts, Manus, Claude Code source analyses, LangGraph/OpenAI/AutoGen/CrewAI,
postmortems). Ranked by expected impact against the current codebase; all
kept honest against the house invariants (approval floor, no secrets, fail
visible, bounded rows, byte-identical opt-outs).

| # | Improvement | Evidence anchor | Effort | Risk |
|---|---|---|---|---|
| X1◕ | **Finish W5 tail** — NEARLY DONE (P40-P45): v2 single memory-recall; v2 ladder dedupe (14 debt keys); `memory_user_notes` section on every lane (P43); v2 assembler on `cleanMessage` + moderate floor (P44); lane-terminal tags on stream/openswan_v2/send_message/computer_task (P39/P42/P45). Remaining: the long tail of small ChatTab catches (~25, mechanical — most are per-feature intercepts whose errors already surface locally; migrate opportunistically when touched) | P38/P39 seams + P40-P45 code-read findings | S-M | low |
| ~~X2~~ | **Tool Search Tool / `defer_loading` (API-native)** ✅ SHIPPED FLAG-DARK (P46) — pure `anthropicNativeToolSearch` module (wire shapes doc-verified) + dark wiring in `executeToolUseLoop`; edge relay confirmed passthrough-safe. Remaining: the live-run flip measurement (`uc_native_deferred_tools`='1' on one device → compare cache_read ratio + selection accuracy vs P25 palette) | anthropic.com/engineering/advanced-tool-use (verified); platform.claude.com tool-search-tool doc (fetched 2026-07-09) | M | low-med |
| ~~X3~~ | **Server-side compaction beta (`compact_20260112`)** ✅ SHIPPED FLAG-DARK (P49) — pure config/model-gate/beta-derivation additions + edge relay branch; client opt-in is `context_management_mode: 'compact'`. Remaining: edge deploy + live long-loop flip measurement; on flip, disable the client-side Haiku compressor on that path and consider BlackSwan grounding re-injection post-compaction | platform.claude.com compaction doc (fetched 2026-07-09); deprecates SDK compaction_control | M | med |
| ~~X4~~ | **Tool Use Examples on the gnarliest schemas** ✅ SHIPPED LIVE (P47) — curated `input_examples` on 12 tools via the catalog chokepoint, schema-drift-pinned by smoke, fail-safe runtime validation. Remaining tail: decorate the `swanbot-v2-ai` edge TOOLS on its next deploy | advanced-tool-use post (verified); define-tools doc (fetched 2026-07-09) | S | low |
| X5 | **Memory tool + context-editing combo** — Anthropic-measured +39% over baseline (editing alone +29%); maps onto userMemory/memoryBank as the persistence side of X3 — memory writes stay HITL-gated per house rules | platform.claude.com/docs/memory-tool | M | med |
| X6 | **Programmatic tool calling** — model orchestrates dependent tool calls in a sandboxed script; intermediate results never enter context (37% token cut on multi-call research tasks). Candidate for the computer-task pipelines with long dependent chains; approval floor must gate the SCRIPT, not just each call | advanced-tool-use post (verified) | L | high |
| X7◕ | **Per-lane quality signal (postmortem lesson)** — CORE SHIPPED LIVE (P48): session lane-health registry + isolated-vs-systemic degradation classifier + `/lanes` command + archive tags on all four failure terminals, successes recorded for real rates. Remaining tail: Office surfacing + cross-session `agent_runs` aggregation pairing with the P27 route canaries | Anthropic postmortem 2025-09-17; GPT-5 router outage 2025-08 | S-M | low |
| ~~X8~~ | **Agent Skills open standard alignment** ✅ SHIPPED LIVE (P50) — auditor + export builder + warn-only proposal notes + continuous CI conformance gate over all in-repo skills (which immediately caught and fixed two real portability violations). Tail: a `/skill export` surface on `buildStandardSkillMd` | platform.claude.com/docs/agent-skills (fetched 2026-07-10) | S | low |

Refinements the research imposed on W5 (recorded so the tail respects them):
unify the assembly MECHANISM, not the assembled output (lanes legitimately
render different sections); keep the seam THIN — an ordering/recall/
serialization contract, not a heavy abstraction (Manus rebuilt theirs 4×);
volatile state belongs in a second injection channel (system-reminder
pattern), not interpolated into the cached prefix; normalize the
caller-visible result WITHOUT stripping model-visible error feedback from
the loop (error-preservation improves agent adaptation).

## Standing telemetry note (flywheel)

agent_runs/agent_run_events are the training substrate. Log per turn:
router decision + lane, cache-hit rate, tool transcript, outcome verdict,
user accept/reject/steer events — the Cursor Tab precedent (400M/day
accept-reject signals → +28% accept rate) is the model for BlackSwan's
weekly fine-tune reward signal.
