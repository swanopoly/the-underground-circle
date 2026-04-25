# Computer Agent Expansion Plan

Date: 2026-04-22

## Status snapshot (2026-04-23)

Phase 1 (capability audit): **SHIPPED** · Phase 2 (file adapter): **PARTIAL** — durable grants shipped 2026-04-23 (`supabase/migrations/20260424_computer_task_grants.sql` + DB-first `src/lib/computerTaskGrantMemory.ts`), adapter execution still partial (MCP path shipped, richer file-browser UX pending) · Phase 3 (app adapter): **PARTIAL** — MCP/bridge inventory shipped, no per-app permission model · Phase 4 (planner): **SHIPPED 2026-04-25** — `run_computer_task` planner kind shipped, file/app/hybrid classification live, `hybrid_task` staged executor shipped (computerHybridRuntime.executeHybridTask + HybridFocusChain UI) · Phase 5 (permission/trust UX): **PARTIAL** — durable grant schema shipped 2026-04-23, but no centralized access-model panel yet.

Rollup: 2 shipped · 3 partial · 0 pending.

Related docs:
- [AGENTS_ROADMAP.md](./AGENTS_ROADMAP.md)
- [COMPUTER_USE_PLAN.md](./COMPUTER_USE_PLAN.md)
- [HERMES_AGENT_OPENSWAN_RESEARCH_2026-04-21.md](./HERMES_AGENT_OPENSWAN_RESEARCH_2026-04-21.md)

## Goal

OpenSwan should be able to help with:

- locating files and content the user has granted access to
- working through browser tasks with approvals and visible progress
- using connected apps and external systems through MCP or circle integrations
- routing a request to the right execution surface instead of treating everything like chat

The right product shape is not "browser agent plus some other stuff later." It is a **computer task runtime** with permissioned capability families:

- files
- apps
- browser
- bridges
- integrations

## Audit

### What exists now

1. Browser/computer execution foundation is real.
   - `supabase/functions/computer-use-agent/index.ts`
   - `src/lib/computerUseAgent.ts`
   - `src/lib/useComputerUseTask.ts`
   - Browserbase-backed computer tasks with SSE, approvals, screenshots, and result synthesis

2. There is already a bridge model for external agents.
   - `src/lib/connectionManager.ts`
   - `src/lib/agentBridgeSupport.ts`
   - Generic remote bridges can be health-checked and OpenSwan bridges can expose richer RPC

3. MCP support exists.
   - `src/lib/mcpClient.ts`
   - circles can register MCP servers and fetch tools from them

4. Circle integrations already expose typed capability flags.
   - `src/lib/circleIntegrations.ts`
   - integrations can already answer "what can this circle do?" for SaaS systems

5. Chat memory search exists, but local file search does not.
   - `src/lib/agentTools/sessionSearch.ts`
   - this is transcript search, not filesystem search

### What is missing

1. No first-class computer capability registry.
   The app has browser execution, MCP tools, integrations, and local bridges, but no canonical layer that describes the available file/app/browser capabilities for a circle.

2. No local filesystem contract.
   The agent cannot yet say, in a structured way, "I can search these folders, read these file types, and write only to these approved locations."

3. No app-access contract.
   MCP servers, local bridges, and integrations are all treated differently, so "what apps can I use?" is not one answerable question.

4. Computer intent is still browser-biased.
   The UI now says `Use Computer`, but the runtime and templates are still mostly shaped around web tasks.

5. No unified approval model across files/apps/browser.
   Browser has stronger approval gates than files or app connectors. The long-term model needs one permission story.

## Product direction

OpenSwan should move to a **computer access profile** per circle/session:

- `browser`
  - browse sites
  - extract information
  - fill forms
  - pause for approvals before risky actions
- `files`
  - locate files by name/content
  - read approved files
  - optionally write only to approved roots
- `apps`
  - use MCP-exposed local/remote app tools
  - use connected SaaS integrations
  - use local agent bridges for richer runtime actions

That profile should be inspectable before execution, attached to runs, and visible in chat/office.

## Phase plan

### Phase 1 — Canonical computer capability audit

Ship a shared capability layer that answers:

- what browser capabilities exist?
- what file capabilities exist?
- what app capabilities exist?
- where do they come from?
- what is still missing?

Files:
- `src/lib/computerCapabilityRegistry.ts`

Outcome:
- one source of truth for current browser/files/apps/bridges/integrations capability status
- reusable by chat, office, setup wizards, and agent planning

Status:
- shipped: `src/lib/computerCapabilityRegistry.ts`
- shipped: `src/lib/computerTaskExecution.ts`
- shipped: initial grant planning in `src/lib/computerTaskGrants.ts`
- shipped: local remembered browser grant storage in `src/lib/computerTaskGrantMemory.ts`
- shipped: durable computer task-state in `src/lib/computerTaskState.ts`
- shipped: `src/lib/computerTaskRuntime.ts`
- shipped: initial chat integration
  - `Use Computer` console routes browser and non-browser tasks through the shared `run_computer_task` transport
  - browser tasks still hand off to the live browser runtime after shared planning/approval
  - normal chat can now classify and route computer-task requests into `run_computer_task`
  - chat and the browser approval dialog now surface the inferred access plan and approval summary
  - browser approvals can now persist remembered browser grant scopes for future tasks
  - `Use Computer` now persists planning / approval / execution / terminal task-state for later Focus Chain style UI
  - the `Use Computer` console now surfaces the current persisted task-state directly

### Phase 2 — Local filesystem access model

Add a real local filesystem contract:

- approved roots
- read/search/write scopes
- file-type allowlists
- per-run audit trail of accessed roots

Preferred path:
- MCP filesystem servers first
- local bridge adapters second

Outcome:
- agent can locate content anywhere it has explicit access
- the product can explain where that access comes from

Status:
- shipped: initial `file_task` adapter in `src/lib/computerFileAdapter.ts`
- current behavior:
  - discovers filesystem MCP tools for the circle
  - attempts a real MCP-backed file search / read / list operation
  - falls back to the shared agent runtime only when no suitable filesystem tool can be executed
- remaining gap:
  - normalized path grants — **SHIPPED 2026-04-23** (`supabase/migrations/20260424_computer_task_grants.sql`)
  - durable file-scope approval model — **SHIPPED 2026-04-23** (DB-first `src/lib/computerTaskGrantMemory.ts` with storage cache fallback)
  - result rendering is still generic MCP payload summarization, not a richer file browser UX

### Phase 3 — App connector model

Unify app access behind one capability shape:

- MCP tools
- circle integrations
- local bridges

Each app/system should declare:

- capability family
- read/write/risky action posture
- approval requirements
- source of authority

Outcome:
- "Use Computer" stops meaning only "use the browser"
- app tasks can route to the best available execution surface

Status:
- shipped: initial `app_task` adapter in `src/lib/computerAppAdapter.ts`
- current behavior:
  - discovers MCP app/desktop tools, integrations, capabilities, and enabled bridges
  - attempts a real MCP-backed app tool call when there is a plausible execution match
  - otherwise returns a concrete connected-surface inventory instead of bluffing execution
- remaining gap:
  - no normalized app-action permission model yet
  - no provider-specific app action adapters yet
  - inventory rendering is still text-first rather than a richer structured app-action UI

### Phase 4 — Computer task planner

> STATUS (2026-04-23): **PARTIAL** — `run_computer_task` execution kind shipped in `chatAutomationPlanner.ts`. `browser_task`, `file_task`, `app_task` classifications live. `hybrid_computer_task` staged executor **PENDING** (no orchestrator with visible step transitions yet).

Extend chat planning so requests can resolve to:

- `browser_task`
  → **SHIPPED 2026-04-22** (`computerUseAgent.ts` + live card)
- `file_search_task`
  → **SHIPPED 2026-04-22** (`computerFileAdapter.ts`)
- `file_read_task`
  → **SHIPPED 2026-04-22** (same adapter)
- `app_task`
  → **SHIPPED 2026-04-22** (`computerAppAdapter.ts`)
- `hybrid_computer_task`
  → **SHIPPED 2026-04-25** (computerHybridRuntime.executeHybridTask + HybridFocusChain UI; planner edge fn at hybrid-task-planner)

Outcome:
- user asks naturally
- planner chooses the correct surface
- approvals and run summaries stay consistent

### Phase 5 — Permission and trust UX

> STATUS (2026-04-23): **PARTIAL** — durable grants now persist in DB (`computer_task_grants` migration + DB-first `computerTaskGrantMemory.ts`), and task-state surfaces an "access plan" inline; all four sub-surfaces exist but no centralized "what can the agent touch right now?" UI.

Build a visible access model:

- folders granted
  → **PARTIAL** (`computer_task_grants` migration **SHIPPED 2026-04-23**; no granted-folder UI yet)
- apps connected
  → **PARTIAL** (Integrations/Bridges panels exist but no unified app-access view under Use Computer)
- MCP servers active
  → **PARTIAL** (`computerCapabilityRegistry.ts` audits MCP tools; no dedicated permission UI)
- browser permissions and approval posture
  → **PARTIAL** (`ComputerUsePermissionDialog.tsx` handles per-task; no sticky per-circle view)

Outcome:
- users can understand exactly what the agent can and cannot touch

## Near-term build order

1. Complete the `run_computer_task` migration so browser and non-browser computer work both ride one dispatcher contract
   → **SHIPPED 2026-04-22**
2. Add filesystem-specific capability support
   → **PARTIAL** (`computerFileAdapter.ts` MCP-backed path shipped; durable scopes now persisted, richer file-browser UX still pending)
3. Add durable approval / grant scopes for files, apps, MCP, and bridges
   → **SHIPPED 2026-04-23** (`supabase/migrations/20260424_computer_task_grants.sql` + audit table + RLS; `computerTaskGrantMemory.ts` rewritten DB-first with storage cache fallback)
4. Expand `Use Computer` from web-only templates into browser/files/apps task families
   → **SHIPPED 2026-04-22** (console supports all three families)

## Non-goals for this phase

- not pretending the agent can already control arbitrary native desktop apps
- not broadening permissions silently
- not auto-routing file tasks into browser automation just because the browser stack already exists

## Success criteria

1. The app can answer "what can this agent access on this circle right now?" with one structured object.
2. File, app, and browser access are described under one runtime contract.
3. Chat planning can distinguish browser work from file/app work.
4. Every future computer capability expansion has one canonical place to plug into.
