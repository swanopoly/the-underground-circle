# Chat Automation Audit + Build Plan

_Audit date: 2026-04-21_

_Purpose: review the canonical agent roadmap, audit how automation currently works through chat, identify the highest-risk gaps, and define one unified build plan that all agents can follow._

## Executive summary

Chat automation is currently powerful but fragmented.

The app does not have one chat-automation system. It has at least seven:

1. conversational-intent routing
2. natural-language slash rewrites
3. explicit slash-command handlers
4. lightweight local command shortcuts
5. model-capability routing
6. conversational-build streaming
7. OpenSwan mode runtime

Each path can be correct in isolation, but together they create drift:

- different automation requests bypass different layers
- only some requests create structured run metadata
- only some requests use the richer OpenSwan memory / skills / eval contract
- circle automations are a separate product surface, not a first-class chat action system

The roadmap is directionally right. The implementation is not yet on that architecture.

## Current status

As of the latest pass:

- [chatAutomationPlanner.ts](/Users/cswanson/the-underground-circle/src/lib/chatAutomationPlanner.ts) is now the canonical classification layer for chat input.
- [runChatAutomationPlan.ts](/Users/cswanson/the-underground-circle/src/lib/runChatAutomationPlan.ts) is now the canonical dispatch contract for shared chat transports.
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx) now consumes that planner for normalized route/source decisions, command-audit shaping, planned dispatch for stable route families (`help`, `mission`, `summary`, `room`, `browser`, `github`, `wordpress`, `schedule`, `build_page`, `hf_tools`, `search`, `memory`, `governance`), active conversational build discovery continuation, and the main `open_modal` quick-action cases. Terminal `run_plain_chat` / `run_openswan` is classified and smoke-guarded, but the live streaming/batch model body remains the final Phase 1b cutover.
- Execution is still fragmented across legacy handlers, which means this plan has started but is not complete.

So Phase 1a is materially in progress:

- one shared plan object exists
- one shared dispatch contract exists
- chat is beginning to read from it
- several stable and high-value route families now execute through a planned dispatcher
- the plain conversational chat and explicit OpenSwan terminal paths now have shared transport/policy guardrails, with live ChatTab execution migration still pending
- conversational build follow-up streaming now also runs through the shared dispatcher/observer path
- the main `open_modal` quick-action flows now also run through the shared dispatcher path
- actual handler execution still needs to migrate fully behind that plan

## Findings

### High

1. `AGENTS_ROADMAP.md` says the canonical execution loop is `agentExecutionCore.runAgent(...)`, but main chat still bypasses it on most paths.

Refs:
- [docs/AGENTS_ROADMAP.md](/Users/cswanson/the-underground-circle/docs/AGENTS_ROADMAP.md:36)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4665)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4693)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4794)

What this means:
- explicit OpenSwan mode uses `executeAgentRun(...)`
- conversational build uses `chat-stream`
- plain chat uses `getAIResponse(...)`
- command paths call bespoke handlers directly

So the roadmap’s “everything should route through one loop” is not true for chat yet.

2. Chat automation is split across multiple routers that run in sequence, not one planner.

Refs:
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:3883)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:3919)
- [chatCommandRegistry.ts](/Users/cswanson/the-underground-circle/src/lib/chatCommandRegistry.ts:278)
- [conversationalRouter.ts](/Users/cswanson/the-underground-circle/src/lib/conversationalRouter.ts:114)

Current order:
- conversational intent first
- regex-based natural-language command rewrite second
- slash handlers third
- local shortcuts fourth
- capability routing fifth
- OpenSwan/simple chat last

This makes automation behavior hard to reason about, hard to log, and hard to test.

3. Circle automations are not first-class in chat.

Refs:
- [automationService.ts](/Users/cswanson/the-underground-circle/src/services/automationService.ts:177)
- [automationService.ts](/Users/cswanson/the-underground-circle/src/services/automationService.ts:293)
- [automationService.ts](/Users/cswanson/the-underground-circle/src/services/automationService.ts:336)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:3883)
- [chatCommandRegistry.ts](/Users/cswanson/the-underground-circle/src/lib/chatCommandRegistry.ts:1)

The app has a real automation subsystem:
- `circle_automations`
- `automation_runs`
- `automation-executor`

But chat has no dedicated route for:
- create automation
- test automation
- run automation
- pause automation
- inspect automation health

That is a major product gap if chat is supposed to “help with any task or command.”

4. High-value automation surfaces still bypass the shared run/eval contract.

Refs:
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4264)
- [buildChatStream.ts](/Users/cswanson/the-underground-circle/src/lib/buildChatStream.ts:1)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4313)
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4405)

Examples:
- build discovery/build stream
- browser planning shortcut
- WordPress command execution
- GitHub command execution

These do useful work, but they do not all pass through one structured planning / approval / eval path.

### Medium

5. The natural-language command rewrite layer is still narrow, regex-heavy, and non-composable.

Refs:
- [chatCommandRegistry.ts](/Users/cswanson/the-underground-circle/src/lib/chatCommandRegistry.ts:278)

It does decent browser/wiki/GitHub room rewrites, but:
- it has no automation domain model
- it cannot represent ambiguity
- it cannot explain confidence
- it cannot merge with OpenSwan planning

6. The conversational router still owns business actions outside the main OpenSwan runtime.

Refs:
- [conversationalRouter.ts](/Users/cswanson/the-underground-circle/src/lib/conversationalRouter.ts:219)

It directly performs:
- WordPress actions
- task creation
- office agent publishing + task assignment
- memory actions

That makes it a sidecar orchestration system instead of a thin intent layer.

7. Build UX is intentionally separate for speed, but it is still an architectural fork.

Refs:
- [CONVERSATIONAL_BUILD_PLAN.md](/Users/cswanson/the-underground-circle/docs/CONVERSATIONAL_BUILD_PLAN.md:1)
- [buildChatStream.ts](/Users/cswanson/the-underground-circle/src/lib/buildChatStream.ts:1)

This is defensible as a UX optimization, but it should be treated as a specialized transport under one automation planner, not a separate behavior stack.

8. Automation scheduling is still command-shaped, not agent-shaped.

Refs:
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:4072)

`/schedule` and `/cron` are useful, but they are effectively CLI handlers inside chat. They are not integrated with:
- circle automation templates
- automation health
- automation executor previews
- approvals for side effects

### Low

9. Dead or legacy intent branches still exist at the edges.

Refs:
- [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:315)
- [conversationalRouter.ts](/Users/cswanson/the-underground-circle/src/lib/conversationalRouter.ts:105)

`build_webpage` is mostly retired, but remnants still exist in type mapping.

10. The current architecture is difficult to benchmark as one system.

Why:
- OpenSwan benchmark/eval coverage is good
- automation executor has its own run data
- command handlers do not share one plan/result schema

So “chat automation quality” is not currently measurable end to end.

## Current system map

### What enters through chat today

- Natural-language business actions:
  - conversational router
- Natural-language shortcut rewrites:
  - `inferChatCommandExecution(...)`
- Slash command handlers:
  - mission
  - summary
  - room
  - build page
  - browser
  - HF tools
  - GitHub
  - WordPress
  - memory
  - search
  - schedule / cron
  - governance
- Local status shortcuts:
  - `tryHandleLocalSwanBotCommand(...)`
- Capability router:
  - images / webpage-ish / model-specific handling
- OpenSwan chat:
  - only when explicit mode is selected
- Conversational build:
  - custom fast stream path

### What does not cleanly enter through chat today

- create or manage circle automations
- inspect automation health and recent failures
- dry-run an automation from natural language
- convert a repeated chat workflow into an automation
- unify build/browser/automation under one action planner

## Desired target

One system:

1. `ChatAutomationIntent`
2. `ChatAutomationPlan`
3. `ChatAutomationExecution`
4. `ChatAutomationResult`

With one planner in front of all automation-capable actions.

That planner should decide:
- answer directly
- run a local shortcut
- open a modal/form
- call a typed tool
- launch a browser task
- create/test/run an automation
- enter build discovery
- route into OpenSwan runtime

And every non-trivial action should emit:
- one structured run
- one structured command/automation decision trail
- one approval state when required
- one quality/eval record

## Canonical principles for the rebuild

1. Chat must have one automation planner.
2. Chat must not have hidden sidecar orchestration systems.
3. Natural language and slash commands should converge to the same plan shape.
4. Fast paths are allowed, but only as execution transports under the same planner.
5. External side effects need explicit policy + approvals.
6. Circle automations must be reachable from chat as first-class actions.
7. Every serious automation action must be measurable.

## Build plan

### Phase 1 — Unified Chat Automation Planner

Goal:
- replace “many sequential routers” with one planner entry point

Status:
- initial shared planner contract now exists in `src/lib/chatAutomationPlanner.ts`
- lightweight regression coverage exists in `scripts/check-chat-automation-planner.mjs`
- `ChatTab.tsx` is not migrated to consume it yet

Build:
- add `src/lib/chatAutomationPlanner.ts`
- define:
  - `ChatAutomationIntent`
  - `ChatAutomationPlan`
  - `ChatAutomationExecutionKind`
  - `ChatAutomationRisk`
  - `ChatAutomationApproval`
- planner inputs:
  - raw message
  - slash vs natural-language source
  - quick action source
  - attachments
  - thread context
  - selected mode/model

Planner outputs should support:
- `local_reply`
- `open_modal`
- `run_command_handler`
- `run_openswan`
- `run_build_discovery`
- `run_browser_plan`
- `run_circle_automation`
- `create_circle_automation`
- `suggest_automation_conversion`

Success criteria:
- `ChatTab.sendMessage` becomes thinner
- routing order becomes explicit and testable
- slash/natural-language/quick-action all end in one plan object

### Phase 2 — Make Circle Automations First-Class in Chat

Goal:
- let chat create, inspect, test, run, pause, and refine automations

Build:
- add a new route family:
  - `/automation`
  - `/automation create`
  - `/automation run`
  - `/automation test`
  - `/automation pause`
  - `/automation resume`
  - `/automation status`
  - `/automation health`
- natural-language planner support:
  - “create an automation that…”
  - “run the weekly report automation”
  - “why is the slack digest automation failing?”
  - “turn this workflow into an automation”

Needed adapters:
- chat-facing wrappers over:
  - `createAutomation(...)`
  - `triggerAutomation(...)`
  - `testAutomation(...)`
  - `loadRuns(...)`
  - automation stats

Success criteria:
- AutomationsPanel is no longer the only serious surface for automations
- chat can manage automations end to end

### Phase 3 — Unify Execution Through One Contract

Goal:
- align chat with the roadmap’s canonical execution model

Build:
- define `runChatAutomationPlan(...)`
- migrate non-trivial execution kinds to a shared execution contract
- route OpenSwan-capable actions through:
  - `agentExecutionCore.runAgent(...)` where appropriate
  - or a clearly-adapted transport that still returns the same plan/result envelope

Important:
- build stream can stay streaming
- browser planning can stay specialized
- command handlers can stay specialized

But all must return a common result shape and emit common run metadata.

Success criteria:
- chat no longer has invisible architectural forks
- roadmap and implementation say the same thing

### Phase 4 — Approval + Risk Layer

Goal:
- make automation safe enough to scale

Build:
- planner assigns risk:
  - `safe`
  - `review`
  - `external_side_effect`
  - `destructive`
- add approval policies for:
  - creating/updating/deleting automations
  - running webhooks
  - external publishing
  - durable memory writes beyond append-safe paths
  - browser actions with external side effects

Success criteria:
- chat automation can be powerful without being reckless

### Phase 5 — Turn Repeated Chat Workflows Into Automations

Goal:
- make OpenSwan actually “improve over time” in chat

Build:
- detect repeated successful flows:
  - same intent
  - same tools
  - repeated schedule
  - similar outputs
- show “Save as automation” suggestions in chat
- generate first-draft automation configs from successful plans
- require review before saving

Success criteria:
- the system compounds user workflows instead of repeating them manually forever

### Phase CA-6 — Cline-inspired upgrades (Plan/Act + Auto-approve + Cost footer)

Goal:
- adopt the mechanisms from [CLINE_RESEARCH_AND_MAPPING_2026-04-22.md](./CLINE_RESEARCH_AND_MAPPING_2026-04-22.md) that slot cleanly into the existing planner/gate/executor stack

Build:
- **Plan vs Act mode — UNIFIED with OpenSwan mode picker.** No new toggle. OpenSwan already has `plan` + `execute` modes (`openswanModePolicy.ts`); we extend the gate so dispatcher-side `ctx.chatMode === 'plan'` (derived from the existing `chatMode` state via `chatMode === 'plan' ? 'plan' : 'act'`) refuses destructive execution kinds. Tab keybind toggles the existing picker between `plan` ↔ `execute`. Helpers `isPlanSafeForPlanMode(plan)` + `describePlanModeRefusal(plan)` live in `chatAutomationPlanner.ts`
- **Auto-approve by category** — new `src/lib/chatAutoApproveSettings.ts` with `{ memory_read, memory_write, skill_run, automation_create, browser_click }` each `'ask' | 'auto' | 'never'`; `chatApprovalGate.ts` consults the setting before inserting a proposal; "remember this" checkbox on `HitlApprovalBanner.tsx` writes the category to `circles.settings.autoApprove`
- **Cost/token footer** — persistent bar in ChatTab composer using existing `circleCostTelemetry.ts`; shows `in / out · $` for last turn + cumulative session
- **Composable prompt builder** — new `src/lib/agentPromptBuilder.ts` sits on top of `agentSystemPrompt.ts` with an ordered named-component registry (`agent_role → capabilities → tools → skills → mcp_servers → memory_bank → rules → environment_details → objective`). Frozen components concat into the cached block; volatile (env details) skip the cache. Three presets (`full` / `compact` / `minimal`) let smaller models drop `skills` + `mcp_servers`. Shipped 2026-04-22, smoke green
- **Memory bank (3 docs)** — `circle_memory` extended with `doc_kind` column (`brief` / `active_context` / `progress`), composite unique `(circle_id, doc_kind)`, CHECK constraint. New libs `src/lib/memoryBankKinds.ts` (pure types/parser) + `src/lib/memoryBankChatCommands.ts` (`/memory-bank` read/update/append/clear/help). `src/services/sharedMemory.ts` gained doc-aware CRUD + realtime hook. Shipped 2026-04-22, smoke green

Success criteria:
- users can flip into Plan mode and the planner refuses to dispatch destructive tools
- HITL banner offers "remember this" per category so repeat approvals stop for memory/skill writes
- cost is visible at-a-glance without opening a panel

### Phase CA-7 — Checkpoints & Reversible Tools

Goal:
- reversible side effects for the three destructive tool kinds users hit most, without becoming a filesystem

Build:
- **`chat_checkpoints` table** — `(id, circle_id, session_key, plan_id, tool_kind, before_json, after_json, diff_summary, created_at, restored_at)`, RLS: circle members can read/restore their own
- **`src/lib/chatCheckpoints.ts`** — `snapshot(toolKind, before)` before execution, `commit(snapshotId, after)` after; `restore(checkpointId)` with per-kind handler (`memory.write`, `skill.write`, `automation.create`)
- **Executor hook** — `runChatAutomationPlanObserver.ts` writes a checkpoint per destructive tool call
- **UI** — `src/components/chat/ToolCallCard.tsx` renders `Checkpoint #N · Compare · Restore` strip under the assistant message; `Compare` opens a `CheckpointDiffDrawer`; `Restore` inverts via handler
- **Refuse logic** — restore fails with a clear error when downstream dependents changed (hash compare against current row)

Success criteria:
- writing a memory + immediately restoring it leaves no trace
- creating an automation + restoring removes the row and unschedules pg_cron
- restore is refused (not silently-broken) when the target row was edited after the checkpoint

### Phase 6 — Observability and Quality

Goal:
- measure chat automation like one system

Build:
- add `chatAutomationDecision` to run metadata
- add planner confidence / source / risk / approval metadata
- add automation outcome normalization:
  - completed
  - blocked
  - approval_required
  - failed
  - skipped
- extend observed evals with automation-specific quality:
  - action correctness
  - side-effect safety
  - automation usefulness
  - conversion-to-automation quality

Success criteria:
- weak automation behavior becomes visible in dashboards

## Recommended implementation order

1. Build `chatAutomationPlanner.ts`
2. Migrate `ChatTab.sendMessage` routing into planner + executor
3. Add chat-facing automation routes and natural-language automation intents
4. Normalize result/run metadata across build/browser/command/automation paths
5. Add approvals/risk scoring
6. Add “save as automation” suggestions
7. Add automation-quality dashboards

## Specific code moves

### Pull into the new planner

- natural-language command rewrite from [chatCommandRegistry.ts](/Users/cswanson/the-underground-circle/src/lib/chatCommandRegistry.ts:278)
- conversational intent detection from [conversationalRouter.ts](/Users/cswanson/the-underground-circle/src/lib/conversationalRouter.ts:114)
- route selection logic currently embedded in [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:3883)

### Keep as execution adapters

- `executeMissionCommand`
- `executeRoomCommand`
- `executeWpCommand`
- `executeGitHubChatCommand`
- `executeHfCommand`
- `submitBrowserTask`
- `launchBuildStream`
- `createAutomation` / `triggerAutomation` / `testAutomation`

### Reduce inside `ChatTab.tsx`

`sendMessage` should stop owning:
- intent detection
- natural-language rewrites
- command routing
- automation branching
- direct side-effect policy

It should mostly:
- collect context
- ask planner for a plan
- execute plan
- render result

## Risks if we do nothing

- roadmap drift continues
- chat behavior stays hard to predict
- automation remains split across chat, office, automations panel, and edge functions
- quality/evals only cover part of the real product
- future agents keep adding “just one more branch” to `ChatTab.tsx`

## Definition of done

This effort is done when:

- chat has one automation planner
- circle automations are first-class in chat
- slash and natural-language automation requests converge
- build/browser/automation/OpenSwan all emit the same decision/run envelope
- approvals are enforced consistently
- automation quality is measurable across the whole chat surface
