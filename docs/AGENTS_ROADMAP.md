# UC Agents Roadmap — Canonical Plan

**Audience:** Every agent contributing to this repo (Claude Code, Codex, Cursor, Gemini, future bridges). This is the single doc you consult before starting work on the agent runtime. Keep it in sync.

**Last synced:** 2026-04-21

**Why this doc exists:** Two agents (Claude Code + Codex) have been independently converging on the same Hermes-style architecture for OpenSwan. Each shipped complementary pieces without full awareness of the other. This doc reconciles both into one plan so we stop building parallel stacks.

Related docs (all still valid, read them after this one):
- [`OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`](./OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md) — Codex's section-by-section plan (8 architectural sections). Still the authoritative breakdown per concern.
- [`HERMES_INTEGRATION_PLAN.md`](./HERMES_INTEGRATION_PLAN.md) — research summary of Hermes Agent patterns + the phased adoption we lifted from them.
- [`CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`](./CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md) — full audit of chat automation, routing fragmentation, and the unification plan for command/build/browser/automation flows.
- [`COMPUTER_AGENT_EXPANSION_PLAN_2026-04-22.md`](./COMPUTER_AGENT_EXPANSION_PLAN_2026-04-22.md) — audit + phased plan for turning the current browser-first stack into a true permissioned computer runtime spanning files, apps, MCP tools, bridges, and browser work.
- [`CHAT_USE_COMPUTER_CLINE_AUDIT_PLAN_2026-04-22.md`](./CHAT_USE_COMPUTER_CLINE_AUDIT_PLAN_2026-04-22.md) — deep audit of current Chat + `Use Computer` pathways, concrete local findings, and the Cline-inspired runtime plan for plan/act, focus-chain, checkpoints, hooks, workflows, and true file/app/hybrid computer adapters.
- [`CLINE_ADOPTION_IMPLEMENTATION_PLAN_2026-04-22.md`](./CLINE_ADOPTION_IMPLEMENTATION_PLAN_2026-04-22.md) — canonical implementation order for Cline-inspired runtime work across chat, OpenSwan, and `Use Computer`. Use this to keep all agents on one build sequence.
- [`HERMES_DELTA_PLAN_2026-04-22.md`](./HERMES_DELTA_PLAN_2026-04-22.md) — research delta vs Hermes Agent (NousResearch). What's shipped, what's partial, what's missing, with the top-10 item ranking.
- [`DESKTOP_APP_CAPABILITY_PATHS.md`](./DESKTOP_APP_CAPABILITY_PATHS.md) — four options for "launch X app on my computer" (URL-scheme shortcuts / Claude Code bridge / dedicated Tauri binary / Anthropic computer-use desktop mode). Option A shipped 2026-04-22.
- [`UNIVERSAL_CONTROL_RESEARCH_2026-04-23.md`](./UNIVERSAL_CONTROL_RESEARCH_2026-04-23.md) — deep research on what it takes for an agent to make changes in any native app and on any website. State-of-art comparison (Anthropic / OpenAI Operator / Mariner / Skyvern / browser-use), benchmark landscape (OSWorld-Verified, WebArena, WebVoyager), and a UC-1..UC-5 phased rollout. TL;DR: next ship is `/desktop/a11y_tree` (~75% token reduction on desktop tasks, semantic selectors, HITL UX win) — everything else compounds from there.
- [`DESKTOP_AUTOMATION_PHASE_1_PLAN.md`](./DESKTOP_AUTOMATION_PHASE_1_PLAN.md) — canonical rollout for "launch X app AND do something inside it." Phases 1a (bridge plumbing), 1b (agent tools + HITL + known apps + status chip), **and 1c (screenshot + wait_for_app + hardened auto-chain) all shipped**. Phase 1d (click + a11y tree) later.
- [`SWANBOT_V2_MIGRATION_PLAN.md`](./SWANBOT_V2_MIGRATION_PLAN.md) — canonical plan for retiring the v1 edge function (hardcoded BLACKSWAN_TOOLS) in favour of v2 (typed tool loop, openswanToolRuntime catalog). **M1 + M2 shipped 2026-04-23**: feature flag + `/v2 on|off` slash, `callSwanBotV2` with auto v1 fallback, round-trip client-delegated tool protocol (edge emits `{ pending: true, clientToolCalls, continuationRunId }` → client executes against bridge → posts back `{ continuationRunId, toolResults }` → loop resumes), 11 `desktop.*` tools registered as `clientOnly: true` on v2, 6-continuation cap on client. Smoke coverage: 40+ assertions. M3 (full OpenSwan tool parity on v2) next.
- [`PHASE_CA-8_HERMES_DELTA_PLAN.md`](./PHASE_CA-8_HERMES_DELTA_PLAN.md) — **canonical rollout** of the top 10. Every agent picks sub-phases (CA-8a..CA-8j) from here.
- [`OPTIMIZATION_PLAN.md`](./OPTIMIZATION_PLAN.md) — non-agent optimization work (bundle, pagination, error boundaries, SQL).
- [`RUN_THIS_SQL.sql`](./RUN_THIS_SQL.sql) — every pending DB change, idempotent.

---

## 1. North star

OpenSwan should behave like an agent that **improves over time** and **can help with any task**:

- Typed tool-use loop on any chat-completion model (Claude default, Qwen/Ollama for local).
- Rich tool registry (file ops, verification, browser, memory, skill management, subagent delegation).
- Procedural memory as skills ([agentskills.io](https://agentskills.io) SKILL.md format so users can bring Claude Code / Cursor / Codex skills straight in).
- Declarative memory scoped per circle + per user.
- Post-hoc quality scoring + regression benchmarks today; offline self-evolution (DSPy/GEPA style) once we have ≥50 skills + ≥1K runs.
- HITL gates on every write to memory or skill library.

---

## 2. Canonical file ownership

This table is the tie-breaker. When two files overlap, the one listed under "Canonical" wins; the other is an adapter, reference, or deprecated.

| Concern | Canonical | Role | Status |
|---|---|---|---|
| **Execution loop** (model turns, tool dispatch, event stream) | `src/lib/agentExecutionCore.ts` | Provider-agnostic typed loop. Everything should route through `runAgent(...)`. | Shipped 2026-04-21 |
| **Provider adapter (Claude)** | `src/lib/agentProviders/anthropic.ts` | Implements `AgentProvider.turn()` against Anthropic Messages API with prompt caching. | Shipped 2026-04-21 |
| **Run persistence** | `src/lib/agentRunPersistence.ts` | Hooks `AgentEvent` → `agent_runs` + `agent_run_events`. Fire-and-forget; never blocks the loop. | Shipped 2026-04-21 |
| **Tool catalog + dispatch** | `src/lib/openswanToolRuntime.ts` | The 1929-line typed tool registry (`executeOpenSwanTool`, `listOpenSwanAnthropicToolsForSurface`, `formatOpenSwanRuntimeToolResult`). 30+ tools with policy + surface permissions. | Shipped (Codex) |
| **Tool catalog compat shim** | `src/lib/openswanTools/index.ts` | `dispatchTool()` / `dispatchToolDetailed()` for the existing chat / verification consumers. Keeps them working while the loop migrates. | Shipped (Codex) |
| **Session orchestration** | `src/lib/openswanSessionRuntime.ts` | Turn lifecycle, stage updates, artifact recording, cancellation hooks. Wraps the loop + persistence. Migration target (see §4). | Shipped (Codex), migration planned |
| **Verification runtime** | `src/lib/openswanVerificationRuntime.ts` | Closed-loop quality checks (executed / planned / blocked / manual_required / not_applicable). Ahead of Hermes — keep as-is. | Shipped (Codex) |
| **Mode policy / routing** | `src/lib/openswanModePolicy.ts` | 8 modes (talk / build / plan / execute / review / research / support / design) with response contracts. Integrated into prompt building. | Shipped (Codex) |
| **Memory stores (multi-scope)** | `src/lib/openswanMemoryStores.ts` | Loads user / circle / room / session / agent scopes, builds prompt bundle. | Shipped (Codex) |
| **Context discovery** | `src/lib/openswanContextDiscovery.ts` | Scans messages for file paths, pulls relevant .md files into context. | Shipped (Codex) |
| **Skill playbooks (local, curated)** | `src/lib/openswanSkillPlaybooks.ts` | 8 hardcoded playbooks (bug_hunt, critique_pr, refactor, research_topic, summarize_thread, test_writer, code_explain). Pre-Hermes skill library UX. Keep for now — complements SKILL.md, doesn't replace it. | Shipped (Codex) |
| **Skill resolution (ranking)** | `src/lib/openswanSkillResolution.ts` | Ranks playbooks + DB `skills` rows by query / task / mode. | Shipped (Codex) |
| **Persona skills (DB columns)** | `src/lib/skillRegistry.ts` + `skills` / `circle_soul_skills` tables | Codex's DB-column persona skills wired to SOULs — `loadPreparedSkillsForSoul`, `buildSkillsPromptBlock`. | Shipped (Codex) |
| **SKILL.md library (markdown)** | `src/lib/skillLibrary.ts` + `circle_skills` table | Phase 2a: read-only (`listLibrarySkills`, `viewLibrarySkill`, `parseSkillFrontmatter`). Adopts agentskills.io format for Claude Code / Cursor import compat. Phase 2b adds HITL-gated writes. | Shipped 2026-04-21 (read-only) |
| **Task planner** | `src/lib/openswanTaskPlanner.ts` | Infers task profiles, tool planning, verification needs. | Shipped (Codex) |
| **Subagent runtime** | `src/lib/subagentRegistry.ts` → `AgentExecutionCore` | Currently calls `runOpenSwanRuntimeToolLoop`; Phase 3 migrates to `agentExecutionCore.runAgent` so parent/child share one contract. | Shipped (Codex), migration planned |
| **Regression benchmarks** | `src/lib/openswanBenchmarks.ts` + `src/lib/openswanEvals.ts` | 7 golden cases, runs them through routing/mode/tool/verification pipeline. NOT Phase 5 self-improvement — this is a test suite. | Shipped (Codex) |
| **Post-hoc quality scoring** | `src/lib/openswanObservedEvals.ts` | Scores actual runs (strong/partial/blocked/failed); surfaces in run dashboard. | Shipped (Codex) |
| **Extra agent tools (surface-scoped)** | `src/lib/agentTools/` | Thin add-on tools not yet in `openswanToolRuntime` (`getMemberStatus`, `searchCircleMemory`, `getGithubActivity`). Phase 1b migration target: move these INTO `openswanToolRuntime`'s catalog so there's one source of truth. | Shipped 2026-04-21, migration planned |
| **Global error reporter** | `src/lib/errorReporter.ts` | `unhandledrejection` + `error` listeners; ring buffer + `window.__uc_last_global_error`. | Shipped 2026-04-21 |
| **Safe auth wrapper** | `src/lib/authSession.ts` (`safeGetUser`, `safeGetSession`) | Replaces unguarded `supabase.auth.getUser()` across screens. | Shipped 2026-04-21 |
| **Bridge environment gate** | `src/lib/bridgeEnvironment.ts` | Gates localhost bridge detection off production web. | Shipped 2026-04-21 |
| **Encrypted web secrets** | `src/lib/webCrypto.ts` + `src/lib/localSecrets.ts` | AES-GCM via IndexedDB-held key; legacy plaintext auto-upgraded. | Shipped 2026-04-21 |
| **Confirm dialog** | `src/lib/alert.ts` `showConfirm()` | Promise-based destructive-action gate. | Shipped 2026-04-21 |
| **SKILL.md prompt injection** | `src/lib/skillPromptInjection.ts` | `buildSkillsContextMessage(circleId)` → user-role metadata table. Keeps frozen system prompt cache-hot. | Shipped 2026-04-21 |
| **SKILL.md write path (HITL)** | `src/lib/agentTools/manageLibrarySkill.ts` + `src/lib/skillLibraryWrite.ts` | Agent files `skill.create/patch/delete` proposals into `agent_approvals`; approved proposals applied idempotently by `applyApprovedSkillAction`. | Shipped 2026-04-21 |
| **Per-user memory layer** | `src/lib/userMemory.ts` + `user_memory` table | `loadUserMemory`, `appendUserMemory`, `replaceUserMemory`, `deleteUserMemory`. RLS is user-only. | Shipped 2026-04-21 |
| **VS Code Dark+ theme tokens** | `src/lib/vsCodeTheme.ts` | Central palette + sizes matching VS Code's Dark+ theme. Used by the "developer console" surfaces (memory inbox, agent run ledger, tool catalogs, terminals). Exports `bg`, `border`, `text`, `accent` (blue/purple/green/cyan/yellow/teal/orange/red — the VS Code syntax palette), `radius`, `font`, `shadow`, `vscBtn` variants, and a `kindAccent()` helper. Distinct from UC's default rounded-dark style — 2px sharp corners + blue `#007acc` accent are intentional signature traits. | Shipped 2026-04-22 |
| **OpenSwan memory console** | `src/components/agent/MemoryViewer.tsx` | VS Code Dark+ re-skin: editor bg `#1e1e1e`, sidebar bg `#252526`, tab strip `#2d2d30`, thin 1px `#3c3c3c` borders. Tab strip uses blue underline on active (not inverted fill — matches VS Code editor tabs). Inbox cards get a left-edge cyan accent strip (mirrors VS Code's "modified file" gutter). Added a bottom VS Code-style status bar with memory counts, active tab, search filter, and "OpenSwan memory · UTF-8 · mono" meta. Also now includes a live **Memory Context Plan** panel that exposes the canonical injection order and current layer readiness: user notes → user profile → runtime memory → working memory → thread archive, with session-memory mode surfaced inline so every agent debugs the same context stack. | Shipped 2026-04-23 |
| **Google Workspace OAuth + integration** | `supabase/functions/google-oauth/index.ts` + `src/lib/googleCreds.ts` + `user_google_credentials` table | Phase A of the Hermes-style Google Workspace skill port. OAuth flow with narrowed scope selection (email/calendar/drive/sheets/docs/contacts), CSRF state via `google_oauth_states`, long-lived refresh token stored per user. Edge function routes: `authorize`, `callback`, `status`, `revoke`. Client lib exposes `useGoogleAuthStatus()`, `startGoogleWorkspaceOAuth()`, `revokeGoogleWorkspace()`, `signInWithGoogle()`. "Sign in with Google" button added to LoginScreen + SignUpScreen (asks for full Workspace scopes on first sign-in so identity + tools land together). Circle Settings gains a "GOOGLE WORKSPACE" section with service-scope checkboxes + connect/disconnect flow. Phases B–F (API proxy, tool registry, SKILL.md row, HITL gates) pending. | Shipped 2026-04-22 (Phase A) |
| **User memory agent tool** | `src/lib/agentTools/manageUserMemory.ts` | `append` writes immediately; `replace`/`delete` file HITL approval with a diff. | Shipped 2026-04-21 |
| **Chat session search tool** | `src/lib/agentTools/sessionSearch.ts` | Agent tool that searches `messages.content` via ILIKE with optional `threadId` scope. Returns excerpts wrapped in `<untrusted_quoted>` per rule 5. Hard-capped at 20 matches. Contract compatible with a future FTS (`tsvector @@`) upgrade. Sibling to `searchCircleMemory`. | Shipped 2026-04-21 |
| **Opt-in trace logger** | `src/lib/devLog.ts` | `devLog.trace / info / warn / error`. `trace` is silent unless `localStorage.UC_DEBUG === 'trace'`; lifecycle events use `info`; warnings/errors always fire. Used by agentRunSystem, agentAutoConnect, agentSessionMemory to gate per-event chatter (saveMemory OK, tab visible, per-provider save counts) without losing signal. | Shipped 2026-04-21 |
| **AgentExecutionCore smoke test** | `scripts/agent-core-smoketest.ts` + `npm run smoke:agent-core` | 6 runnable cases covering text / tool round-trip / throws / interactive sequential / max-iterations / unknown tool. | Shipped 2026-04-21 |
| **Computer-use agent (edge fn)** | `supabase/functions/computer-use-agent/index.ts` | Autonomous browser via Anthropic `computer_20250124` + Browserbase; SSE streaming; per-circle USD budget cap from `circles.settings.computer_use_max_cost_usd`; cache-aware cost math; stop-and-confirm via `ask_user` tool. | Shipped 2026-04-21 |
| **Computer capability audit** | `src/lib/computerCapabilityRegistry.ts` | Canonical browser/files/apps/bridges/integrations capability audit for a circle. First step toward a true permissioned computer runtime instead of separate browser/MCP/bridge silos. | Shipped 2026-04-22 |
| **Computer task execution envelope** | `src/lib/computerTaskExecution.ts` | Canonical task-shape -> readiness -> entrypoint envelope for `Use Computer`. Browser tasks route to the live computer-use runtime; file/app/hybrid tasks route through the unified agent runtime with explicit dispatch context. Initial grant planning is now included for browser navigation, browser side effects, file read/write, app read/action, MCP tools, and bridge access. Remembered grant ids can now flow back into the execution envelope so repeated tasks reuse prior browser grants. | Shipped 2026-04-22 |
| **Computer task runtime** | `src/lib/computerTaskRuntime.ts` | Shared non-browser `Use Computer` runtime. Owns adapter identity, mode/profile selection, dispatch prefix, and agent-runtime execution for file/app/hybrid tasks so `ChatTab` stays thin and future adapters plug into one place. | Shipped 2026-04-22 |
| **Computer file adapter** | `src/lib/computerFileAdapter.ts` | First real `file_task` adapter. Discovers filesystem MCP tools, attempts a concrete file search/read/list execution, and only falls back to the generic agent runtime when no usable filesystem tool surface is available. | Shipped 2026-04-22 |
| **Computer app adapter** | `src/lib/computerAppAdapter.ts` | First real `app_task` adapter. Discovers MCP app/desktop tools, integrations, and enabled bridges; attempts a concrete MCP-backed app action when there is a plausible match, otherwise returns a structured app-surface inventory instead of pretending the task executed. | Shipped 2026-04-22 |
| **Computer task state** | `src/lib/computerTaskState.ts` + `src/screens/circles/tabs/ChatTab.tsx` + `src/components/computer-use/ComputerUseConsole.tsx` | First durable task-state foundation for Cline-style Focus Chain work. `Use Computer` now persists planning / awaiting approval / executing / completed / failed state with steps, blockers, next steps, access plan, and granted access, and the launcher console now surfaces that state so later chat/Office surfaces can extend one canonical runtime object. | Shipped 2026-04-22 |
| **Chat session archive** | `src/lib/chatSessionArchive.ts` + `src/screens/circles/tabs/ChatTab.tsx` + `src/lib/swanbot.ts` + `src/lib/agentRuntime.ts` + `src/components/agent/MemoryViewer.tsx` + `src/lib/memoryService.ts` + `src/screens/circles/tabs/chat/ChatTranscript.tsx` | Canonical per-thread SwanBot archive for durable transcript + tool/error/memory/browser context. Chat now upserts message snapshots and failure events into a local session archive, clears it on thread nuke, injects a bounded archive block back into SwanBot / OpenSwan runs, exposes archive search/suggestions in Memory Viewer, tracks handled recommendation state so promoted or dismissed archive patterns stop resurfacing as noise, stamps archive-derived memories with lineage + initial acceptance feedback, adjusts archive-derived memory trust automatically in both directions with passive `confirmed_helpful` / `weak_signal` feedback, throttles repeated passive feedback per memory/action/source so similar runs in a short window do not over-train the same archive pattern, weights passive scores by evidence depth using run quality, verification coverage, response quality, and blocker intensity, applies a small retrieval-time archive bias based on recent passive evidence so strong archive patterns are slightly easier to reuse and weak ones are slightly suppressed before generation, surfaces that archive bias directly in chat/transcript memory cards for debuggable retrieval, and now exposes an archive-learning view in Memory Viewer showing boosted memories, suppressed memories, and recent passive feedback events. | Shipped 2026-04-22 |
| **Chat computer-task routing** | `src/lib/chatAutomationPlanner.ts` + `src/lib/runChatAutomationPlan.ts` + `src/screens/circles/tabs/ChatTab.tsx` | First-class `run_computer_task` planning/dispatch path. Browser, file, app, and hybrid computer tasks now enter through the same shared chat transport; browser tasks still execute on the browser runtime after shared planning/approval, while non-browser tasks route through the shared computer-task runtime instead of falling back to generic chat. Chat now surfaces the inferred access plan and approval summary for these tasks, and browser approvals can persist remembered grant scopes for later runs. | Shipped 2026-04-22 |
| **Edge-side Anthropic adapter** | `supabase/functions/_claude/anthropic.ts` | Deno-side provider adapter (mirrors `src/lib/agentProviders/anthropic.ts`): `callClaude()`, `computeCostUsd()`, `addUsage()`, `logClaudeUsage()`. Central pricing table + cache accounting; every new edge function MUST import from here per Rule #3. In `_claude/` instead of `_shared/` because the latter is owned by root. | Shipped 2026-04-21 |
| **Per-circle budget cap settings** | `src/screens/circles/CircleSettingsScreen.tsx` (COMPUTER USE BUDGET + AUTOMATION DAILY CAP sections) | Numeric USD caps + preset chips bound to `circles.settings.computer_use_max_cost_usd` (per-run, default $2) and `circles.settings.automation_max_cost_usd` (rolling 24h, default $1). All four persistence paths (saveAll / CU blur / Automation blur / memory toggle) always carry both caps to prevent stale-state clobbering. | Shipped 2026-04-21 |
| **Client-side Computer Use surface** | `src/lib/computerUseAgent.ts` + `src/lib/useComputerUseTask.ts` + `src/lib/useComputerUseQueue.ts` + `src/components/ComputerUseLiveCard.tsx` | SSE reader, single-task hook, multi-task queue hook (up to 3 concurrent), live card with cache-hit % indicator. `queue` hook shipped but not yet wired into a surface. | Shipped 2026-04-21 (queue unwired) |
| **Chat automation planner** | `src/lib/chatAutomationPlanner.ts` | Single entry point classifying chat input → `ChatAutomationPlan` with `execution.kind` / `risk` / `approval`. Phase 1 of `CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`. `ChatTab.sendMessage` now uses it for normalized route/source decisions, planned dispatch for stable route families (`help`, `mission`, `summary`, `room`, `browser`, `github`, `wordpress`, `schedule`, `build_page`, `hf_tools`, `search`, `memory`, `governance`), explicit `run_openswan` mode routing, the shared plain-chat transport, active conversational build discovery continuation, and the main `open_modal` quick-action cases. Full execution migration remains in Phase 1b. | Shipped (Codex), partial ChatTab adoption |
| **Chat automation dispatcher** | `src/lib/runChatAutomationPlan.ts` | Shared transport dispatcher + normalized outcome contract. `ChatTab.sendMessage` now uses `dispatchChatAutomationPlan(...)` for stable route families, explicit `run_openswan`, the plain conversational chat path, conversational build discovery continuation, and the main `open_modal` quick-action cases before falling back to remaining legacy branches. Planned runs attach `chatAutomationDecision` metadata via `attachPlanDecisionToRun`. | Shipped (Codex), partial ChatTab adoption |
| **Chat planner smoke test** | `scripts/chat-planner-smoketest.ts` + `npm run smoke:chat-planner` | 14 runnable cases covering slash, quick action, conversational intents, NL rewrite, build heuristic, plain-chat fallback. Locks in the classification matrix before ChatTab migrates onto the planner. | Shipped 2026-04-21 |
| **SKILL.md importer** | `src/lib/skillLibraryImport.ts` | `importLibrarySkillFromUrl` / `importLibrarySkillFromText`. HTTPS-only, 256 KB cap, normalises GitHub blob + gist URLs, validates agentskills.io spec, files `agent_approvals` row (never writes directly). Handles duplicate-name with optional `allowPatch` flow. | Shipped 2026-04-21 |
| **Skill slash commands** | `src/lib/skillChatCommands.ts` | `/skill`, `/skill list [tag:…]`, `/skill view <name>`, `/skill import <url>`, `/skill import --replace <url>`. `executeSkillCommand()` returns `{ message, success } \| null`; null falls through to other handlers so chatCommandRegistry can dispatch cleanly. | Shipped 2026-04-21 |
| **sessionSearch tool** | `src/lib/agentTools/sessionSearch.ts` | ILIKE against `messages.content` with optional thread/date scope; untrusted-quoted excerpts; contract survives the later FTS + Haiku-summarization upgrade. | Shipped (Codex) |
| **Claude Code skills bridge** | `src/lib/claudeSkillsBridge.ts` + `scripts/claude-bridge.js` `GET /skills` / `GET /skills/:name` | Enumerate + fetch SKILL.md files from `~/.claude/skills/` through the local dev bridge. `importSelectedClaudeCodeSkills` bulk-stages them via the HITL `agent_approvals` queue. Wired to `/skill import --from-claude-code`. | Shipped 2026-04-21 |
| **Circle memory compaction** | `src/lib/circleMemoryCompaction.ts` | `checkCircleMemorySize`, `proposeMemoryCompaction` (HITL via `memory.compact` approval), `applyApprovedMemoryCompaction`. Plug a Haiku-backed summarizer in via the `summarizer` option; default is a safe head+tail fallback. 24h cooldown + pending-proposal dedupe. | Shipped 2026-04-21 |
| **Approval-apply worker** | `src/lib/agentApprovalsWorker.ts` | `applyApprovedAction(approvalId)` dispatches by `action_type` prefix to the right apply function (skill.* / memory.compact / user_memory.*). `applyAllPendingApprovals(circleId)` sweeps approved-but-unapplied rows. Closes the HITL loop — approvals without this sat inert. | Shipped 2026-04-21 |
| **Plan executor contract** | `src/lib/runChatAutomationPlan.ts` | `dispatchChatAutomationPlan(plan, { handlers, ctx, approvalGate, onOutcome })` — Phase CA-3 normalisation. Transports implement `ChatTransportHandler` → `ChatAutomationOutcome`. Unknown kinds yield `status: 'skipped'` so ChatTab can migrate one kind at a time without breaking legacy routes. `attachPlanDecisionToRun` observer writes `chatAutomationDecision` into `agent_runs.metadata`. | Shipped 2026-04-21 |
| **SKILL.md frontmatter parser (pure)** | `src/lib/skillFrontmatter.ts` | Pure string parser extracted out of `skillLibrary.ts` so smoke tests + edge functions can import without pulling Supabase / React Native. `skillLibrary.ts` re-exports. | Shipped 2026-04-21 |
| **Hermes-helpers smoke test** | `scripts/hermes-helpers-smoketest.ts` + `npm run smoke:hermes-helpers` | 21 cases covering `parseSkillFrontmatter`, `normalizeSkillUrl`, `summarisePlanForTelemetry`. `smoke:all` now runs agent-core + chat-planner + hermes-helpers = 41 green cases total. | Shipped 2026-04-21 |
| **`/automation` slash commands** | `src/lib/automationChatCommands.ts` | Phase CA-2 family: `list`, `status`, `run <name\|id>`, `test <name\|id>`, `pause <name\|id>`, `resume <name\|id>`, `runs <name\|id>`. Fuzzy name matching, ambiguity messaging, stats rolled up from `loadDashboardStats` + `loadAutomations`. `executeAutomationCommand()` returns `{message, success} \| null`; null falls through. | Shipped 2026-04-22 |
| **Chat automation decisions dashboard** | `src/lib/chatAutomationDecisions.ts` | Phase CA-6 read layer: `loadChatAutomationDecisions(circleId)` + `loadChatAutomationBreakdown(circleId, { windowHours })`. Feeds the Run Ledger UI with source / executionKind / outcome rollups + median duration. Uses the `chatAutomationDecision` metadata that `attachPlanDecisionToRun` stamps per dispatch. | Shipped 2026-04-22 |
| **HITL approval gate (chat)** | `src/lib/chatApprovalGate.ts` | Phase CA-4 — `createHitlApprovalGate({ sessionKey, agentName, timeoutSeconds, describe })` returns an `ApprovalGate` for `dispatchChatAutomationPlan`. Builds a stable `idempotencyKey` from the plan + looks up pending / approved / rejected / expired matches before filing a fresh `agent_approvals` row. Fails closed on lookup error. | Shipped 2026-04-22 |
| **Repeated-flow detection** | `src/lib/repeatedFlowDetection.ts` | Phase CA-5a — `detectRepeatedFlows(rows, opts)` is a pure function over `ChatAutomationDecisionRow[]`. Groups by `(executionKind, routeId, commandFingerprint)`, requires ≥3 occurrences + ≥60% success, classifies cadence (under_hour/hourly/daily/multi_day/irregular), scores for ranking. Output is UI-ready for "save as automation" chips. | Shipped 2026-04-22 |
| **Plan observer (telemetry)** | `src/lib/runChatAutomationPlanObserver.ts` | `attachPlanDecisionToRun` split into its own module so the pure dispatcher stays RN-free for smoke tests. Stamps `chatAutomationDecision` onto `agent_runs.metadata` on every dispatch that created a run. | Shipped 2026-04-22 |
| **Hermes-runtime smoke test** | `scripts/hermes-runtime-smoketest.ts` + `npm run smoke:hermes-runtime` | 29 cases: dispatch completed / skipped / failed / deferred / approved + observer firing; detector frequency / cadence / success-ratio / maxSuggestions / exclusions. `smoke:all` is now 6+14+21+29 = **70 green cases**. | Shipped 2026-04-22 |

### Duplicate / deprecated files (keep but do not extend)

| File | Why still here | Replacement |
|---|---|---|
| `src/lib/openswanRuntimeToolLoop.ts` (144 L) | Still imported by `subagentRegistry.ts` and `openswanSessionRuntime.ts`. Wraps the black-box `executeToolUseLoop` in `swanbot.ts`. | Migrate its two callers to `AgentExecutionCore` + `executeOpenSwanTool`, then delete. Phase 1c. |
| `swanbot-ai/index.ts`'s in-process tool loop (2904 L) | Live edge function; users rely on it. | Phase 1c rewrite — thin wrapper around `AgentExecutionCore`. Deploy as `swanbot-v2-ai` first to allow rollback. |

---

## 3. Phase status

### Phase 0 — Production safety (shipped)

- Top-level `ErrorBoundary` + per-tab `ErrorBoundary` (CircleDetailScreen LazyTab).
- `safeGetUser` / `safeGetSession` migrated across Wallet, Challenges, Members, Digest, Profile, EditProfile, CheckIn, CreateCircle, CircleSettings, and CustomizePanel (×5 sites). Remaining unguarded sites are all inside `OfficeTab.tsx` / `RoomsTab.tsx` which will be migrated during the P1 splits in `OPTIMIZATION_PLAN.md`.
- Office localhost gating + `BridgeUnavailableBanner` (no more silent blank Office on prod).
- Global unhandled-rejection logger (`errorReporter.ts`).
- Confirm dialogs on delete circle / leave circle / disconnect wallet / delete theme / delete mission task.

#### 2026-04-21 optimization pass (Chat / SwanBot / OpenSwan)

Reliability and performance fixes identified by per-subsystem audit. All shipped
this session; `tsc --noEmit --skipLibCheck` clean.

- **OpenSwan auth-latch → time-expiring cache** (`src/lib/openswanService.ts`).
  `authFailedEndpointCache` converted from permanent `Set` to a
  `Map<string, expiryMs>` with a 30 s cooldown via new `isAuthFailed()` helper.
  One stale token at page load no longer disables Office for the rest of the
  session; the next success transparently clears the cache entry.
- **OpenSwan proxy — WebSocket auth injection**
  (`openswan-proxy.js`). The WS upgrade now overwrites `Authorization` with
  the locally-loaded gateway token, matching the HTTP path. Fixes silent WS
  403s from stale client tokens.
- **SwanBot prompt cache — timestamp removed from frozen prefix**
  (`supabase/functions/swanbot-ai/index.ts:451`). Soul-wisdom section no
  longer inlines `wisdom.generated_at`, so the Anthropic prompt cache
  actually survives across days instead of invalidating nightly.
- **SwanBot silent failures logged** (`swanbot-ai/index.ts:1897, 2865, 2875`).
  `logClaudeUsage`, `storeKnowledgeEntry`, and `extractAndStoreMemories`
  `.catch(()=>{})` replaced with `.catch(err => console.warn(...))`. Memory
  data-loss and usage-metering drift are now visible in the edge-function
  logs.
- **SwanBot volatile prompt 4000-char cap**
  (`swanbot-ai/index.ts:596`). Tail-truncation with warn log when the
  volatile block exceeds 4 kB — priority-ordered sections mean low-value
  wiki content is dropped first, not critical circle info.
- **Chat realtime N+1 → O(1)** (`ChatTab.tsx:2558`). Realtime INSERT handler
  now resolves sender display name from a `membersRef` cache populated at
  mount. Fallback `.from('profiles').select(...)` preserved for users who
  joined mid-session.
- **Chat per-row `ErrorBoundary`** (`ChatTab.tsx:5622` + style
  `messageRowFallback`). One malformed message can no longer crash the
  whole tab; compact red inline chip replaces it with "Couldn't render this
  message."
- **Chat `MessageRow` `React.memo` + custom comparator**
  (`ChatTab.tsx:7378–7617`). Typing or receiving a message no longer
  cascades renders across every row. Comparator ignores callback identity
  (inline closures), compares value props.
- **Chat `FlatList` virtualization** (`ChatTab.tsx:6070`).
  `initialNumToRender=15`, `maxToRenderPerBatch=10`, `windowSize=10`,
  `updateCellsBatchingPeriod=50`, `removeClippedSubviews` (native only).
  `getItemLayout` deliberately skipped — variable row heights make a
  guessed estimate cause scroll jumps.
- **Chat lazy-init — first paint on 20 messages**
  (`ChatTab.tsx:2342`). Initial `loadThreadMessages` page size dropped from
  50 → 20; 150 ms after paint the existing `handleLoadOlder` quietly
  fetches the next batch. Time-to-first-paint cut by ~500 ms on longer
  threads.
- **`src/lib/devLog.ts`** added — tiny opt-in trace logger. Three
  highest-frequency `console.log` sites
  (`agentRunSystem.ts:613`, `agentAutoConnect.ts:571`,
  `agentSessionMemory.ts:254, 312`) converted to `devLog.trace(...)` so
  DevTools isn't spammed by per-event chatter. Enable with
  `localStorage.UC_DEBUG = 'trace'` + reload.
- **Edge-function config**: `[functions.llm-proxy]` with
  `verify_jwt = false` added to `supabase/config.toml` and redeployed —
  fixes the 401 that silently disabled `memoryEmbeddings`.
- **Deploys this session**: `llm-proxy` (verify_jwt fix), `swanbot-ai`
  (all five SwanBot changes above).
- **Chat realtime fallback polling** (`ChatTab.tsx:2528`
  + `src/lib/chatService.ts loadNewerThreadMessages`). Supabase channel
  `.subscribe(status => ...)` observes status events; any non-`SUBSCRIBED`
  status (CHANNEL_ERROR / TIMED_OUT / CLOSED) starts a 15 s poll loop with
  an immediate first fetch. The incoming-row handler was extracted into
  `mergeIncomingRow` so realtime and polling paths share identical dedup /
  optimistic-match / name-resolution logic. Poll stops on recovery.
  Eliminates the silent "users miss messages when realtime drops" failure
  mode.
- **Stale plan docs archived** — `docs/archive/` now holds
  `LAUNCH_AUDIT_2026-02-24.md`, `OFFICE_DASHBOARD_DEEP_AUDIT_2026-04-03.md`,
  `OPENSWAN_ARCHITECTURE_AUDIT_2026-04-15.md`, and two pre-2026-03-06
  `supabase-migration*.sql` files. `docs/archive/README.md` documents
  supersession. Agents picking up work won't re-read superseded context.

### Phase 1 — Typed tool loop (in progress)

Parts shipped:
- [x] `agentExecutionCore.ts` — the loop
- [x] `agentProviders/anthropic.ts` — Claude adapter
- [x] `agentRunPersistence.ts` — event telemetry
- [x] 3 add-on tools (`getMemberStatus`, `searchCircleMemory`, `getGithubActivity`)
- [x] DB: `agent_run_events`, `agent_runs.tool_calls` / `iteration_count` / `final_stop_reason`

Parts shipped (Phase 1c — proof-of-stack, 2026-04-21):
- [x] `src/lib/agentTools/openswanBridge.ts` — `getOpenSwanToolsForSurface(surface, ctx)` shapes Codex's 30+ tool catalog as `AgentToolDefinition[]`. Unification adapter.
- [x] `src/lib/agentSystemPrompt.ts` — composes frozen + volatile blocks with Codex's mode contract; ready for `createAnthropicProvider({ system })`.
- [x] `src/lib/skillPromptInjection.ts` + `src/lib/agentTools/viewLibrarySkill.ts` — wire SKILL.md library into agent prompts (Phase 2a.5).
- [x] `supabase/functions/swanbot-v2-ai/index.ts` — self-contained Deno edge function mirroring the core loop shape. Side-by-side with `swanbot-ai`; exposes 5 read-only tools (`getMemberStatus`, `searchCircleMemory`, `getGithubActivity`, `listLibrarySkills`, `viewLibrarySkill`) + prompt caching + persistence to `agent_runs`/`agent_run_events`.
- [x] **v2 tool migration COMPLETE (2026-04-23)** — M1 → M2 → M3a–e all shipped ([`SWANBOT_V2_MIGRATION_PLAN.md`](./SWANBOT_V2_MIGRATION_PLAN.md)). Flag + `/v2 on/off` slash command + client-delegated desktop tool protocol (11 desktop tools) + M3a read-only (7) + M3b writers with cross-circle scope guards (8) + M3c workspace/verification client-delegated (6) + M3d approvals server-side + credentials.get client-delegated (4) + M3e WordPress publishing client-delegated (4). v2 total: **23 server-side + 22 client-delegated = 45 tools**. M4-M5 ahead: flip default after telemetry, delete v1.

Parts **pending** (Phase 1c, post-v2-proof):
- [ ] Deploy `swanbot-v2-ai` (`npx supabase functions deploy swanbot-v2-ai`) and route a percentage of client traffic to it.
- [ ] Measure: turn latency, tool-use success, token spend vs. `swanbot-ai`. If v2 wins, flip default; if not, fix and re-measure.
- [ ] Migrate `openswanSessionRuntime.ts` from `runOpenSwanRuntimeToolLoop` → `agentExecutionCore.runAgent({ provider, tools: getOpenSwanToolsForSurface(surface, ctx) })`.
- [ ] Migrate `subagentRegistry.ts` the same way (blocked on v2 proof).
- [ ] Migrate the 3 add-on tools into `openswanToolRuntime.ts`'s registry so there's one catalog.
- [ ] Once v2 proves itself, retire `swanbot-ai` (or rewrite as a thin wrapper that delegates to the shared core).

### Phase 1d — Edge-function Anthropic consolidation (near-complete)

Audit on 2026-04-21 found 7 edge functions that call Anthropic directly without using the central pricing/cache/telemetry helpers. Worst drift: `chat-stream` was computing cost as `(input * 0.8 + output * 4.0) / 1M` (not a valid rate for any Claude model) and always writing `cache_creation_tokens: 0, cache_read_tokens: 0`.

Migration rule: every edge function that calls Anthropic routes through `supabase/functions/_claude/anthropic.ts` for pricing, cache accounting, and `claude_api_usage` logging.

Shipped 2026-04-21:
- [x] `_claude/anthropic.ts` created with `callClaude()` / `computeCostUsd()` / `addUsage()` / `logClaudeUsage()`
- [x] `computer-use-agent/index.ts` migrated (dogfood — proved the API works)
- [x] `chat-stream/index.ts` migrated (fixed the worst pricing drift, cache tokens now populated)
- [x] `src/lib/modelPricing.ts` — Opus 4.6 corrected from $20/$100 (4x stale) to $6.25/$31.25; Opus 4.7 entry added; Sonnet 4.6 corrected to $3.75/$18.75
- [x] `automation-executor` — switched pricing to `computeCostUsd()`; kept local retry loop (cron jobs need it); added `circles.settings.automation_max_cost_usd` daily-spend cap enforced against 24h rolling `claude_api_usage` sum; matching UI control added to `CircleSettingsScreen` (default $1.00/day).
- [x] `llm-proxy` — Anthropic branch now uses `computeCostUsd()` with cache breakdown; no `logClaudeUsage` (BYO-key — would double-count user's own spend). Local `estimateCost()` kept for non-Anthropic providers.
- [x] `boss-agent` — opus mapping corrected to 4.7 (was 4.6); legacy `callClaude(system, user, model)` signature preserved for call-site stability but now routes through shared helper + logs to `claude_api_usage` under sources `boss-agent.generate_tasks` / `boss-agent.model_council`.
- [x] `room-task-executor` — wrapper rewrite keeps all 10 legacy call sites intact; now logs to `claude_api_usage` with source `room-task-executor`. Sonnet spend finally visible. Known gap: `circleId` field stays null until `room_id → circle_id` lookup is threaded (not load-bearing — dashboard groups by `source`).
- [x] `build-stream` — captures `cache_creation_input_tokens` + `cache_read_input_tokens` from the `message_start` streaming event (previously discarded); logs to `claude_api_usage` at stream end.
- [x] `heartbeat-agent` — 3-iteration tool loop now accumulates `UsageBreakdown` via `addUsage()` and fires a single `logClaudeUsage()` per cycle with full cross-iteration cost.

Visibility layer (same pass):
- [x] `src/lib/circleCostTelemetry.ts` — `useCircleCostTelemetry(circleId)` hook reads 24h Computer Use + Automation spend from `claude_api_usage` plus the most recent CU run's cost from `computer_use_runs`. Exposes `formatBudgetUsd`, `capUsageTone` (slate/amber/red at 0/75/95%), `relativeSince` helpers. Three parallel queries, all index-only via `idx_claude_api_usage_circle_source_created`.
- [x] Live budget meters in `CircleSettingsScreen` — under COMPUTER USE BUDGET shows "LAST RUN · $X of $Y · [time ago]" + 24h total; under AUTOMATION DAILY CAP shows "24H USED · $X of $Y · Z%" with a color-coded fill bar that transitions through slate→amber→red as usage approaches the cap. Closes the loop on Rule #12 — users can now see where they are relative to the cap, not just discover it when the cap trips.

Live-card UX pass (same session, "make every click mean something"):
- [x] **Step progress bar** — 3px fill under the header tracking `actions.length / maxIterations` (default 20). Accent while running, green when done, red on error. Only renders once the agent starts acting so the starting state doesn't show a stale 0%.
- [x] **Screenshot timeline strip** — horizontal scrolling row of ~48px thumbnails below the main screenshot. Tap any frame to pin it as the main view; pinned state shows a floating "FRAME n/N" badge with a one-tap "JUMP TO LIVE ↓" shortcut. Auto-scrolls to the latest frame while unpinned so live frames slide in. Renders only when there are 2+ frames.
- [x] **Cost pill polish** — `formatPillCost` adapts decimals by magnitude ($<0.01 → 4 dec, <$1 → 3 dec, else 2 dec); `formatTokenShort` compacts tokens to K/M; cache-hit indicator compressed from "80% cached" to "80%↻" to save horizontal space in the pill.
- [x] **Button affordances** — OPEN LIVE / STOP / COPY MD / SAVE TEMPLATE / OPEN SETTINGS now all lead with a text-glyph icon (↗ ■ ⧉ ⌾ ⚙) so they read as actions at a glance. Web hover states via `nativeID`-targeted CSS injection (id-prefixed selectors reliable across RN Web's hash-generated class names). Background shifts `#020617 → #0f172a`, border lightens `#1e293b → #334155`.
- [x] **Card state transitions clear pinned frame** — starting a new task or completing one un-pins automatically so the user doesn't get stuck on a stale frame from the previous run.
- [x] **Per-frame action-verb badges** — `formatActionVerb()` produces a 2-letter tagged color badge (CL click / TY type / SC scroll / KE key / NV navigate / AS ask_user / SH bash / WT wait) overlaid on the top-right of each timeline thumbnail. Pairs chronological index (bottom-left) with semantic action (top-right) so users can identify frames by what happened, not just order.
- [x] **Full-row header tap target** — the entire card header row (status label + task text + cost pill area) is now one `Pressable` that toggles expansion. Chevron becomes purely decorative. Hit target jumps from a 20px chevron to the full row, respecting native mobile tap conventions. `#cu-card-header:hover` gets a subtle opacity shift so users sense the whole row is clickable.
- [x] **Visible "STEP n/N" count** — small monospace label right-aligned above the progress bar reading "STEP 7/20" in the step-bar color. Gives the abstract fill concrete meaning.

Browser Task modal UX (entry-point polish, same arc):
- [x] **RECENT runs chip strip** — `loadRecentComputerUseRuns()` + `useRecentComputerUseRuns(circleId, 5, refreshKey)` in `src/lib/computerUseHistory.ts`. Modal renders a chip strip between SAVED templates and the input showing the last 5 completed/errored runs: `[✕] research espresso machines…   $0.04 · 2h`. Error runs get a red "✕" prefix + muted red border so users don't re-run failed attempts blindly. Done runs hover cyan. Tap fills the task input. `browserModalRefreshKey` bumps on modal open so a just-completed run appears immediately.
- [x] **Budget context line** — pre-launch budget status above the PLAN button: `BUDGET  24h: $0.42 · last: $0.04  [⚙ SETTINGS →]`. Reads via `useCircleCostTelemetry(circleId)`. SETTINGS chip closes the modal and navigates to `CircleSettings` for cap adjustment. Users see where they are on the budget BEFORE launching, not just after the cap trips.

Cross-agent visibility (all agents on the same plan, same view):
- [x] **AI SPEND LAST 24H section** in `CircleSettingsScreen` — unified dashboard above the per-tool budget caps showing every Claude-powered agent's contribution: Computer Use, Automations, BlackSwan, Boss, Room Tasks, Page Builder, Heartbeat, LLM Proxy. Rendered as (a) a headline `$X · N CALLS · Y%↻ CACHED`, (b) a stacked proportion bar colored per source, (c) per-source rows with dot · label · call count · cost · share %. One scan over `claude_api_usage` aggregated in-memory by source.
- [x] `useClaudeSpendBreakdown(circleId, hours)` — new hook in `circleCostTelemetry.ts`. Returns `{totalCost, totalRequests, totalCacheReadTokens, cacheHitPct, rows[]}` sorted cost-desc. Uses the `(circle_id, source, created_at)` composite index for index-only scans.
- [x] `sourceLabel()` + `sourceAccent()` helpers — one place to map `claude_api_usage.source` slugs to human labels + per-agent accent colors (cyan=CU, amber=Automation, purple=BlackSwan, sky=chat-stream, green=Room, pink=Builder, gold=Heartbeat, violet=Boss). Keeps visual identity consistent across the app.

Umbrella 24h budget cap (Rule #12, Tier 3 — one cap covers every agent):
- [x] `checkCircleClaudeBudget(supabase, circleId, defaultCap=10)` in `supabase/functions/_claude/anthropic.ts`. Reads `circles.settings.claude_total_max_cost_usd`, sums the circle's 24h `claude_api_usage.estimated_cost`, returns `{allowed, spent24h, cap, reason}`. Fail-open on DB errors so telemetry drift can't brick every agent in the app.
- [x] **CLAUDE TOTAL 24H CAP section** in `CircleSettingsScreen` — third budget section with live meter showing `24H TOTAL · $X of $Y · Z%`, presets [$5 / $10 / $25 / $50 / $100], default $10/day. Closes the "Rule #12 tier-3 umbrella" loop: per-tool caps (tier 1) protect individual runs, per-source caps (tier 2) protect specific agents, umbrella (tier 3) protects the whole circle.
- [x] **swanbot-ai** — surgical ≤15 LOC addition at the Deno.serve entry: preflight `checkCircleClaudeBudget`, 429 + user-facing message if over. Does not touch the 2904-line tool loop (Phase 1c rewrite target). This closes the biggest pre-existing risk: BlackSwan chat was completely uncapped.
- [x] **computer-use-agent** — belt-and-suspenders: umbrella check runs BEFORE the Browserbase session is opened, so a low umbrella trumps the per-run CU cap and saves session-start costs too.
- [x] **automation-executor** — umbrella check runs before the automation's own 24h spend cap, so a lower umbrella shadows the per-source cap. Throws a distinct `automation_umbrella_cap_exceeded` for log visibility.
- [x] **room-task-executor** — cap check at the handler entry after the room→circle lookup. Posts the budget-reached message to the room system channel so users see WHY a task failed, not just a 429.
- [x] **heartbeat-agent** — per-circle cap check inside the heartbeat cycle so one over-budget circle sits out the cron tick while others keep running.
- [x] **chat-stream** — 429 return before upstream Anthropic call when `circleId` passed and over cap. Skipped when caller didn't pass `circleId` (e.g. prompt playground previews).
- [x] **CircleSettingsScreen stale-state fix** — all six settings write paths (saveAll / sessionMemory toggle / CU blur+preset / Auto blur+preset) now carry ALL THREE cap values explicitly, so rapid chip clicks across any two sections can't clobber the third via stale `circle?.settings`.
- Deferred: `build-stream` (no circleId in request body — would need request-shape change), `llm-proxy` (BYO-key, user pays their own Anthropic bill).

UX polish (same pass):
- [x] `ComputerUseLiveCard` — budget-cap errors get a red "BUDGET CAP" header (instead of generic "ERROR") plus an inline `OPEN SETTINGS` shortcut wired via a new `onOpenSettings` prop. ChatTab passes `() => navigation.navigate('CircleSettings', { circleId })`.
- [x] `ComputerUseLiveCard` — user-initiated cancellations now render as muted slate "STOPPED" instead of alarming red "ERROR".
- [x] Edge-function error messages rewritten to be actionable: wall-clock timeout → "The task is too long for one run — try splitting it"; token-budget → "Too much to read this run — narrow the task"; agent-stall → "Try re-running; if it repeats, rephrase more concretely".
- [x] `CircleSettingsScreen` — all four settings write paths (saveAll / CU blur+preset / Automation blur+preset / memory toggle) explicitly carry both budget-cap values so rapid chip-clicks across sections can't clobber via stale `circle?.settings`.
- [x] `RUN_THIS_SQL.sql` §12 — composite index `idx_claude_api_usage_circle_source_created (circle_id, source, created_at DESC)` for the hot automation-executor cap-check query. Existing index covered circle_id+created_at but filtered source in-memory; new index aligns exactly with the filter tuple.

Build health:
- `npx tsc --noEmit --skipLibCheck` — clean
- `npm run build` (expo export web) — 1640 modules bundled successfully; only pre-existing warnings about `@noble/hashes/crypto.js` sub-path exports (non-blocking, Metro falls back to file-based resolution)
- All 8 migrated edge functions correctly import from `_claude/anthropic.ts`; shared helper exports used match declared symbols.

Pending (deferred to Phase 1c):
- [ ] `swanbot-ai` — pricing missing 25% buffer; zero-cache inserts for fallback paths. Leave as-is: the Phase 1c rewrite (`swanbot-v2-ai` as thin wrapper around `agentExecutionCore`) will replace 2904 lines of this, so migrating now would be throwaway work.

Skip (low-value): `distil-soul-wisdom`, `featured-trades-generator` — one-shot / Haiku / low volume.

### Per-circle budget caps (Rule #12 rollout)

| Feature | Setting key | Default | Enforcement |
|---|---|---|---|
| Computer Use | `circles.settings.computer_use_max_cost_usd` | $2.00 per run | Cumulative cost check before every Claude turn; aborts run with SSE error when exceeded |
| Automations | `circles.settings.automation_max_cost_usd` | $1.00 per rolling 24h | Sum of `claude_api_usage` where source='automation-executor' within last 24h; skips run with logStep message when exceeded |

Both configurable from `CircleSettingsScreen` (COMPUTER USE BUDGET + AUTOMATION DAILY CAP sections, with preset chips). Matches Rule #12 — "Budget caps are a per-circle setting, not a code constant."

### Phase 2 — SKILL.md skill library

Goal: procedural memory that compounds and interops with Claude Code / Cursor / Codex.

- [x] `src/lib/skillLibrary.ts` — read-only API: `listLibrarySkills`, `viewLibrarySkill`, `renderLibraryMetadataTable`, `parseSkillFrontmatter`. Distinct from `skillRegistry.ts` (Codex's persona skills, DB-column schema) — the two coexist until Phase 2c merges them.
- [x] `circle_skills` table (already applied via `RUN_THIS_SQL.sql` §10).
- [x] `src/lib/skillPromptInjection.ts` — `buildSkillsContextMessage(circleId)` returns the user-role skill metadata table. Phase 2a.5 — cache-safe injection.
- [x] `src/lib/agentTools/viewLibrarySkill.ts` — progressive-disclosure tool the agent calls to read a full SKILL.md body.
- [x] `src/lib/agentTools/manageLibrarySkill.ts` — HITL-gated write path. Files `skill.create` / `skill.patch` / `skill.delete` proposals into `agent_approvals`; never writes to `circle_skills` directly.
- [x] `src/lib/skillLibraryWrite.ts` — `applyApprovedSkillAction(approvalId)` reads an approved proposal and performs the DB mutation. Idempotent, guards against double-apply. Call site is the approval-resolution UI (or a Phase 2b worker).
- [x] `swanbot-v2-ai` edge function exposes `listLibrarySkills` + `viewLibrarySkill` AND auto-injects the SKILL.md metadata table as a user-role context message at the start of every turn (Hermes progressive-disclosure pattern). Preserves the system-prompt cache. Shipped 2026-04-21.
- [x] Importer for `~/.claude/skills/` via the bridge — `scripts/claude-bridge.js` gained `GET /skills` (enumerate) + `GET /skills/:name` (fetch body). `src/lib/claudeSkillsBridge.ts` exposes `listClaudeCodeSkills` / `importSelectedClaudeCodeSkills`. Wired into `/skill import --from-claude-code [name …]` slash command. Shipped 2026-04-21.
- [x] `/skill import <url>` slash command — `src/lib/skillLibraryImport.ts` (URL + text import, GitHub blob / gist URL normalisation, 256 KB cap, agentskills.io spec validation) + `src/lib/skillChatCommands.ts` (`/skill list|view|import` family with `--replace` flag). Every import files an `agent_approvals` row — no direct writes. Shipped 2026-04-21.
- [x] Phase 2c — `openswanSkills.resolveOpenSwanSkills` now fetches `listLibrarySkills` alongside persona skills and appends a ranked `## SKILL.md Library` section to the prompt block. Scoring: tag / description / name overlap + light success-rate boost. Works even without a soulKey. Shipped 2026-04-21.
- [x] Phase 2c (BlackSwan path) — `skillRegistry.buildSkillsPromptBlock` now pulls `listLibrarySkills` in parallel with `loadPreparedSkillsForSoul` and renders a `### LIBRARY` subsection in the unified "## Available skills" block. Library entries show name / version / tags / description as metadata; bodies stay behind the `viewLibrarySkill` tool for progressive disclosure. Works even without a soulKey (library is circle-wide). Returns '' only when BOTH persona and library are empty. Shipped 2026-04-21. Closes the BlackSwan / swanbot-ai caller of the function (OpenSwan runtime path was closed by the entry above).

### Phase 3 — Typed subagent core + verification expansion

- [ ] `subagentRegistry.ts` → `AgentExecutionCore` with isolated conversation + final-summary-only result contract (Hermes `delegate_task` shape).
- [ ] Subagent spawns respect `agent_controls.spend_limits` via `hitlService.ts`.
- [ ] Verification status enum expanded to `executed | planned | blocked | manual_required | not_applicable` and surfaced in run ledger UI.

### Phase 4 — Memory upgrades + HITL on writes

- [x] `user_memory` table applied (RUN_THIS_SQL.sql §11).
- [x] `src/lib/userMemory.ts` — `loadUserMemory`, `appendUserMemory`, `replaceUserMemory`, `deleteUserMemory`. Merges global + circle-specific rows into a single combined string for prompt injection.
- [x] `src/lib/agentTools/manageUserMemory.ts` — agent tool. `append` writes immediately (user owns their notes); `replace` + `delete` file HITL proposals with a diff for review.
- [x] `agent_approvals.applied_at` column (RUN_THIS_SQL.sql §10b) + partial index for per-circle pending-queue lookups.
- [x] `sessionSearch` tool (2026-04-21) — `src/lib/agentTools/sessionSearch.ts`. ILIKE on `messages.content` with optional `threadId` scope; excerpts wrapped in `<untrusted_quoted>` per rule 5. FTS (`tsvector @@`) and Haiku summarization deferred — contract will survive the swap since results come through the same `{ ok, data }` envelope. Registered in `agentTools/index.ts`. Hard-capped at 20 matches so the model can't blow context with a wide query.
- [x] Memory compaction flow when `circle_memory` exceeds ~4K chars — `src/lib/circleMemoryCompaction.ts` (`checkCircleMemorySize`, `proposeMemoryCompaction`, `applyApprovedMemoryCompaction`). HITL-gated via `agent_approvals` (`action_type='memory.compact'`). Default head+tail summarizer is a safe fallback; real path plugs in a Haiku-backed `summarizer` fn. 24h cooldown + pending-proposal dedupe so we don't spam the approval queue. Shipped 2026-04-21.
- [x] Wire `loadUserMemory` into `openswanMemoryStores.ts` (2026-04-21) — added as a fourth parallel load; new `userNotes` field on `OpenSwanMemoryStores`; placed first in the combined block as it's highest-signal (user's own notes beat inferred profile). 5200-char cap preserved.

### Phase 5 — Offline evaluator (gated)

Preconditions: Phases 1-4 shipped + ≥50 skills + ≥1K persisted runs + an eval harness distinct from the regression benchmarks.

- [ ] DSPy + GEPA-equivalent pipeline (or call out to NousResearch's `hermes-agent-self-evolution`).
- [ ] Propose candidate skill / prompt / tool-description patches; run against evals; merge winners.
- [ ] Tight feedback loop with `openswanObservedEvals.ts` so real-run signals feed back.

### Phase CA — Chat Automation Unification

Tracked fully in [`CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`](./CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md). Summary of status as it relates to the roadmap:

- [x] Phase 1a — `chatAutomationPlanner.ts` types + classifier (`buildChatAutomationPlan`). Shipped (Codex).
- [x] Phase 1a smoke test — `scripts/chat-planner-smoketest.ts`, 14 cases green. Shipped 2026-04-21.
- [ ] Phase 1b — migrate `ChatTab.sendMessage` onto `buildChatAutomationPlan` + a single executor. Replace the six sequential routers.
- [x] Phase 2 (read/manage half) — `/automation` slash commands (`list`, `status`, `run`, `test`, `pause`, `resume`, `runs`) via `src/lib/automationChatCommands.ts`. Create flow (`/automation create …` NL variant) deferred — best handled by the planner's `create_circle_automation` execution kind + a multi-turn dialog. Shipped 2026-04-22.
- [x] Phase 3 — `src/lib/runChatAutomationPlan.ts` executor contract + `ChatAutomationOutcome` envelope so every transport reports the same shape. Shipped 2026-04-21.
- [x] Phase 4 — approval-gate helper shipped: `src/lib/chatApprovalGate.ts` `createHitlApprovalGate(...)` builds an `ApprovalGate` that dedupes by idempotency key and branches on pending/approved/rejected/expired. Remaining: wire into ChatTab as the default gate for `dispatchChatAutomationPlan` calls with `plan.approval.required`. Shipped 2026-04-22.
- [x] Phase 5a — detector shipped: `src/lib/repeatedFlowDetection.ts` `detectRepeatedFlows(rows, opts)`. Remaining Phase 5b: the "save as automation" chip UI that renders suggestions + pre-fills the create flow. Shipped 2026-04-22.
- [x] Phase 6 — `chatAutomationDecision` is written to `agent_runs.metadata` by `attachPlanDecisionToRun`; read layer `src/lib/chatAutomationDecisions.ts` provides `loadChatAutomationDecisions` + `loadChatAutomationBreakdown` for the Run Ledger dashboard. Shipped 2026-04-22.
- [ ] **Phase CA-6 — Cline-inspired upgrades** (see [`CLINE_RESEARCH_AND_MAPPING_2026-04-22.md`](./CLINE_RESEARCH_AND_MAPPING_2026-04-22.md) items 1–3):
  - Plan vs Act — unified with the existing OpenSwan mode picker (`chatMode === 'plan'` drives the read-only gate). `isPlanSafeForPlanMode()` + `describePlanModeRefusal()` in `chatAutomationPlanner.ts`; dispatcher refuses destructive `execution.kind` when `ctx.chatMode === 'plan'`. Tab keybind toggles the picker between `plan` ↔ `execute`. No new state or pill — builds on what's there.
  - Per-category auto-approve (`src/lib/chatAutoApproveSettings.ts`) read by `chatApprovalGate.ts`; "remember this" checkbox on `HitlApprovalBanner.tsx`.
  - Cost/token footer in ChatTab composer from `circleCostTelemetry`.
- [x] **Phase CA-7 — Checkpoints & reversible tools** (see CLINE research item 7): `chat_checkpoints` table + immutability trigger + RLS shipped (`supabase/migrations/20260505_chat_checkpoints.sql`, mirrored into `docs/RUN_THIS_SQL.sql` §13). Snapshot/restore wrappers in `src/lib/chatCheckpoints.ts` with five registered tool kinds: `memory.write`, `skill.write`, `automation.{create,update,delete}`. Drift detection via SHA-256 of canonical JSON — restore refuses when target row changed since commit. UI: `src/components/ToolCallCheckpointStrip.tsx`. Smoke: `scripts/chat-checkpoints-smoketest.ts` — 4 cases green. Shipped 2026-04-22. **Pending:** callsite adoption — chat-triggered write transports need to call `withCheckpoint(...)`. Rides Phase 1b.
- [x] **Phase CA-4b — Composable prompt builder** (see CLINE research item 4): New layer `src/lib/agentPromptBuilder.ts` sits on top of `agentSystemPrompt.ts`. Defines `PromptComponent = { key, cache: 'frozen'|'volatile', heading, render(ctx) }` with `DEFAULT_COMPONENT_ORDER`: `agent_role → capabilities → tools → skills → mcp_servers → memory_bank → rules → environment_details → objective`. Frozen components concat into the `cache_control: ephemeral` block; volatile components (only `environment_details` by default) go in the non-cached second block. `PROMPT_VARIANTS` ships three presets (`full` / `compact` / `minimal`) so smaller models can drop `skills` + `mcp_servers`. Smoke: `scripts/agent-prompt-builder-smoketest.ts` — 20 cases green, including cache-control boundary and variant filtering. Shipped 2026-04-22. **Pending:** migrate `swanbot-ai` + `openswanSessionRuntime` to the builder so both surfaces share one ordered component sequence (prevents prompt-cache drift across runtimes).
- [x] **Phase CA-5 — Memory bank (three docs)** (see CLINE research item 5): `circle_memory` + `circle_memory_history` extended with `doc_kind` column; unique is now `(circle_id, doc_kind)`; CHECK constraint restricts to `brief` / `active_context` / `progress`. Shipped `src/lib/memoryBankKinds.ts` (pure types + parser), `src/services/sharedMemory.ts` (doc-aware CRUD + realtime hook), `src/lib/memoryBankChatCommands.ts` (`/memory-bank` family — read/update/append/clear/help). Registry entries added in `chatCommandRegistry.ts`. Smoke: `scripts/memory-bank-smoketest.ts` — 24 cases green. Migration `supabase/migrations/20260506_circle_memory_bank.sql`, mirrored into `RUN_THIS_SQL.sql` §14. Shipped 2026-04-22. **Pending:** ChatTab dispatch hook calling `executeMemoryBankCommand()` — rides Phase 1b.

- [x] **Phase CA-5b — Slash command dispatch hook in ChatTab** (closes CA-5 / CA-2 pending items): `ChatTab.sendMessage` now intercepts `/memory-bank`, `/mb`, `/automation`, `/automations` before planner/model routing. Each dispatches to the pure lib (`executeMemoryBankCommand` / `executeAutomationCommand`) and renders the result as a `localOnly: true` bot message (no persistence, no model call). Shipped 2026-04-22.
- [x] **Phase CA-7b — Checkpoints wired to memory-bank writes** (closes CA-7 pending callsite): `memory_bank.write` registered as a new `CheckpointToolKind`. `writeMemoryBankWithCheckpoint()` in `memoryBankChatCommands.ts` wraps update/append/clear paths — users see a `checkpoint \`abc12345\`` id in the response and can restore via `ToolCallCheckpointStrip`. Restore handler reads/writes `circle_memory(circle_id, doc_kind)` directly to avoid pulling react-native through `sharedMemory.ts`. 5th case added to checkpoint smoke — green. Shipped 2026-04-22.
- [x] **Phase CA-OS — OpenSwan console pop-up on chat dashboard**: New `src/components/openswan/OpenSwanConsole.tsx` — centered blurred-backdrop modal matching the Computer Use / Assign / Spawn pattern. Reuses `OPENSWAN_MODE_POLICIES` (8 modes with per-mode color + response contract). Quick Action `__OPENSWAN__` opens it; onSubmit syncs `chatMode` + fires `sendMessage(task)` so the task flows through the existing planner + dispatcher + HITL gate. Shipped 2026-04-22.

- [ ] **Phase CA-8 — Hermes Delta (top 10 items)**. Canonical rollout: [`PHASE_CA-8_HERMES_DELTA_PLAN.md`](./PHASE_CA-8_HERMES_DELTA_PLAN.md). Sub-phases CA-8a..CA-8j. Summary:
  - [x] CA-8a · agent-side context compression — `src/lib/agentContextCompression.ts` shipped 2026-04-22. Pure lib with injected summariser, tail-preserving cut, tool-pair protection, safe bail on summariser throw. 20 smoke assertions green. Integration into `agentExecutionCore.runAgent` is a separate trivial merge.
  - [x] CA-8b · memory bounded-char caps (user_memory only) — pure `src/lib/userMemoryCaps.ts` + `appendUserMemory`/`replaceUserMemory` return structured `memory_cap_exceeded` error with `suggestion:'consolidate'`. Shared `circle_memory` HITL regime unchanged. 23 smoke assertions green. Shipped 2026-04-22.
  - [x] CA-8c · skill sub-file support — new `circle_skill_files` table (migration `20260507_circle_skill_files.sql`, mirrored in `RUN_THIS_SQL.sql` §15) + read helpers `listLibrarySkillFiles` / `viewLibrarySkillFile` in `skillLibrary.ts` + pure relpath validator in `skillRelPath.ts` (29 smoke assertions green). Primary SKILL.md stays on `circle_skills.content` for back-compat. Importer + write-side in CA-8i. Shipped 2026-04-22.
  - [ ] CA-8d · subagent summary-only gate (finishes pending 1c-1)
  - [ ] CA-8e · `clarify` / `ask_user` timeout (120s default)
  - [ ] CA-8f · provider fallback chain (Anthropic → OpenRouter on 529)
  - [ ] CA-8g · trace export + evals scaffolding (prep for Phase 5 gate)
  - [ ] CA-8h · context file priority + per-turn discovery append
  - [ ] CA-8i · `skill_manage` sub-file actions (rides CA-8c)
  - [ ] CA-8j · session lineage columns (`room_messages.parent_thread_id`, `.lineage_root_id`)

Rule: do not extend the six legacy routers. New routing behavior goes into `buildChatAutomationPlan`; the executor is the only consumer of the plan.

---

## 4. Migration plan for the execution loop (Phase 1c)

Currently two loops coexist:

| Path | Entry | Loop | Tools |
|---|---|---|---|
| Edge function | `supabase/functions/swanbot-ai/index.ts` | in-process `while` with Anthropic Messages API | `executeToolCall(...)` (hardcoded switch) |
| In-app gateway | `openswanSessionRuntime.ts` → `runOpenSwanRuntimeToolLoop` | `executeToolUseLoop` in `swanbot.ts` | `executeOpenSwanRuntimeTool` via the compat shim |

Target after Phase 1c:

| Path | Entry | Loop | Tools |
|---|---|---|---|
| Edge function (v2) | `supabase/functions/swanbot-v2-ai/index.ts` | `agentExecutionCore.runAgent` | `listOpenSwanAnthropicToolsForSurface` + `executeOpenSwanTool` adapter |
| In-app gateway | `openswanSessionRuntime.ts` | `agentExecutionCore.runAgent` | same adapter |

Adapter shape (new file, ~60 L, Phase 1c):

```ts
// src/lib/agentTools/openswanBridge.ts
import { listOpenSwanAnthropicToolsForSurface, executeOpenSwanRuntimeTool, formatOpenSwanRuntimeToolResult, type OpenSwanToolSurface, type OpenSwanRuntimeToolContext } from '../openswanToolRuntime';
import type { AgentToolDefinition } from '../agentExecutionCore';

export function getToolsForSurface(
  surface: OpenSwanToolSurface,
  ctx: OpenSwanRuntimeToolContext,
): AgentToolDefinition[] {
  const catalog = listOpenSwanAnthropicToolsForSurface(surface);
  return catalog.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Record<string, unknown>,
    handler: async (input) => {
      try {
        const result = await executeOpenSwanRuntimeTool(tool.name as any, input as any, ctx);
        return { ok: true, data: { text: formatOpenSwanRuntimeToolResult(tool.name as any, result as any), raw: result } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  }));
}
```

After this adapter is in place, the 3 add-on tools in `src/lib/agentTools/` either (a) move into `openswanToolRuntime`'s catalog so the bridge picks them up automatically, or (b) stay as user-scoped tools registered alongside. Prefer (a) for consistency.

---

## 5. SQL checklist (run in Supabase SQL Editor)

All of `docs/RUN_THIS_SQL.sql` is idempotent. Current state of each section:

| § | Description | Status |
|---|---|---|
| 1  | `user_custom_themes` + RLS | Applied |
| 2  | `profiles.agent_appearance` JSONB | Applied |
| 3  | `profiles.office_layout` JSONB | Applied |
| 4  | `sweep_offline_agents` pg_cron | Applied |
| 5  | `step_away_sessions` + RLS | Applied |
| 6  | 6 hot-path indexes (fixed `circle_github_events.created_at`) | Applied |
| 7  | Daily cleanup crons | **Pending re-run** (was blocked by §6 error) |
| 8  | `NOTIFY pgrst` | Applied each run |
| 9  | `agent_run_events` + `agent_runs.tool_calls` / `iteration_count` / `final_stop_reason` | `agent_run_events` applied; columns need patch (§9 referenced the wrong table name — fixed in source, run patch SQL in chat) |
| 10 | `circle_skills` + RLS | Applied |
| 11 | `user_memory` + RLS | **Pending re-run** |

When in doubt, rerun the whole file — every statement is guarded.

---

## 6. Rules for contributing agents

1. **Before adding a new `openswan*.ts` or `agent*.ts` file, check §2.** If a file already owns the concern, extend it.
2. **Tool catalog goes in `openswanToolRuntime.ts`.** Don't create separate per-tool files unless you also plan the migration in this doc.
3. **Loop goes through `agentExecutionCore.runAgent`.** Don't reinvent a `while` with Anthropic fetch calls. Use `createAnthropicProvider`.
4. **Memory writes + skill writes MUST go through HITL.** Never write to `circle_memory`, `user_memory`, or `circle_skills` from a tool handler without an approval step.
5. **Retrieved content is untrusted.** Wrap `session_search` / `searchCircleMemory` results in `<untrusted_quoted>…</untrusted_quoted>` before giving them back to the model.
6. **Don't delete the deprecated files in §2 yet** — they have live callers. Remove only after the migrations in Phase 1c and Phase 3 land.
7. **Update this doc when you ship a phase item.** Move it from "Planned" to "Shipped" with a date.
8. **New SQL goes into `RUN_THIS_SQL.sql`, not a new migration file** — we're bypassing Supabase's broken migration runner (per `CLAUDE.md`).
9. **Use `safeGetUser` / `safeGetSession`, not `supabase.auth.getUser()` directly.** See `src/lib/authSession.ts`.
10. **Skills follow the [agentskills.io](https://agentskills.io) SKILL.md format** — YAML frontmatter + `## When to use / ## Procedure / ## Pitfalls / ## Verification` sections. No custom fields.
11. **Edge functions call Anthropic through `supabase/functions/_claude/anthropic.ts`.** Use `callClaude()` for non-streaming requests, `computeCostUsd()` + `logClaudeUsage()` for streaming ones (import-only — streaming loop stays in the function). Never hand-roll `fetch("https://api.anthropic.com/v1/messages", ...)` — that drops you out of central pricing, cache accounting, and telemetry. If you need a feature the helper doesn't expose, extend the helper rather than bypass it.
12. **Budget caps are a per-circle setting, not a code constant.** Long-running or cron-triggered agents (Computer Use, automation-executor) MUST read a USD cap from `circles.settings.<feature>_max_cost_usd` with a safe default. Enforce in the loop using `computeCostUsd()` so it matches billing.

---

## 7. Open questions for Chris

(Same as §9 of `HERMES_INTEGRATION_PLAN.md`; repeating for discoverability.)

1. **Default Phase 1c model.** Claude Sonnet 4.6 for the edge function + Opus 4.7 for the in-app gateway? Or stick with Haiku 4.5 in the edge function for cost?
2. **Ship `swanbot-v2-ai` side-by-side first, or in-place rewrite?** Side-by-side is safer; in-place is faster.
3. **External naming.** Keep "OpenSwan" branding? Or rename to "Swan Agent" / "SwanCore" at the v2 boundary?
4. **Skill marketplace visibility.** Circle-private by default (current schema), or add a public `is_public` flag for a UC-wide marketplace later?

---

## 8. How to keep this doc true

- Every time a phase item changes status, update §3 with the date.
- Every time a file moves between "Canonical" and "Deprecated", update §2.
- Every time SQL is applied, update §5.
- When Phase 1c lands, collapse §4 into a historical note.
- When Phase 5 preconditions are met, promote Phase 5 from "Gated" to "Planned".

If you find this doc lying, fix it in the same PR as the code change.
