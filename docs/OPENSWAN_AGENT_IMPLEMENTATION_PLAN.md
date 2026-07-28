# OpenSwan Agent Implementation Plan

> **Canonical plan:** [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md) is the tie-breaker. This doc is the 8-section architectural breakdown (Session / Tool / Verification / Subagent / Workspace / Memory / Control Plane / Evaluation) Codex drafted before the unification; when anything here contradicts the roadmap, the roadmap wins and this doc needs updating.

_Section-by-section execution plan as of 2026-04-21._

## Goal

Make OpenSwan behave more like a serious coding and task agent: strong at planning, code generation, review, debugging, verification, artifact creation, and workspace handoff across both main chat and Rooms.

This plan is shaped by the strongest public patterns visible in:

- OpenAI Codex docs: sandboxed task execution, background parallel work, code-aware environments
- Anthropic Claude Code docs: terminal-first action, verification loops, specialized subagents, tool permissions
- SwanClaw runtime research: gateway-first runtime, session-first controls, artifact-first outputs, persistent sessions

## Current State

Strengths already in repo:

- Shared OpenSwan session turn runtime now exists
- Main chat and room chat both support artifact-first outputs
- Rooms can turn artifacts into real files and sandboxable workspaces
- Session soul modes exist (`senior`, `review`, `debug`, `architect`)
- Run tracking primitives already exist in `agentRunSystem`
- Explicit memory stores and progressive context discovery are now wired into Swanbot/OpenSwan
- Runtime skill resolution exists and persists active skills into run metadata
- Local skill playbooks exist with execution patterns, anti-patterns, and tool guidance
- Observed evals now score both mode quality and skill-execution quality

Gaps that block “Codex / Claude Code / SwanClaw quality”:

- Shell / external execution is still bounded and not yet a full controlled adapter layer
- Child-run visibility exists only partially; delegated specialists are not yet easy to inspect end-to-end
- Task/workspace isolation is partial, not systematic
- Session memory is stronger, but still not coding-task aware enough across repo/workspace state
- Control-plane actions are still weak: limited resume / retry / stop semantics
- Production quality steering needs a dedicated dashboard over real `agent_runs`
- Subagents still do not inherit the full memory/skill/runtime contract as explicitly as main OpenSwan
- Toolset-by-surface policy is only partial

## Unified Execution Order

Every agent surface should converge on this order:

1. Intent / mode / profile resolution
2. Memory stores + progressive context discovery
3. Skill resolution + skill playbooks
4. Task planning + tool planning + verification planning
5. Execution / delegation / browser / artifacts
6. Observed evals + mode/skill quality scoring
7. Shared run summaries + aggregate dashboards

That is the plan main chat, Rooms, Office, and delegated specialist runs should all follow.

## Overall Architecture

### 1. Session Runtime

Single source of truth for OpenSwan turns.

Responsibilities:

- turn lifecycle
- stage updates
- run creation and step logging
- artifact recording
- cancellation / pause / resume hooks
- task profile and verification planning
- tool plan creation

Primary files:

- `src/lib/openswanSessionRuntime.ts`
- `src/lib/agentRunSystem.ts`

### 2. Tool Runtime

Typed application-level tool registry used by OpenSwan and future subagents.

Responsibilities:

- register tools with capability metadata
- validate inputs
- enforce per-surface permissions
- execute tools
- log tool calls/results into run steps
- expose tool recommendations from task profiles

Primary files:

- `src/lib/openswanToolRuntime.ts`
- `src/lib/openswanTaskPlanner.ts`

### 3. Verification Runtime

Closed-loop quality system for coding and task work.

Responsibilities:

- infer expected proof for each task type
- produce verification checklists
- run or request build/test/lint/review actions
- mark runs as verified / partially verified / blocked

Primary files:

- `src/lib/openswanTaskPlanner.ts`
- later `src/lib/openswanVerificationRuntime.ts`

### 4. Subagent Runtime

Specialized OpenSwan workers with narrow responsibilities and tool scopes.

Initial roles:

- `builder`
- `reviewer`
- `debugger`
- `architect`
- `tester`
- `researcher`

Responsibilities:

- role detection
- explicit delegation rules
- isolated prompts and tool permissions
- child-run tracking

Primary files:

- `src/lib/subagentRegistry.ts`
- later `src/lib/openswanSubagentRuntime.ts`

### 5. Workspace Runtime

Turns artifacts into active workspaces and keeps the agent grounded in files.

Responsibilities:

- create room workspaces
- open/apply generated files
- map artifacts to file sets
- bind execution results back into room previews

Primary files:

- `src/lib/chatWorkspace.ts`
- `src/lib/roomWorkspaceLauncher.ts`

### 6. Memory Runtime

Store coding-session memory instead of generic chat memory only.

Memory categories:

- active repo/workspace context
- current task and acceptance criteria
- failing tests / recent errors
- verified decisions
- preferred commands and tools
- prior successful fixes

Primary files:

- `src/lib/memoryService.ts`
- later `src/lib/openswanSessionMemory.ts`

### 7. Control Plane UI

Visible execution state across main chat and Rooms.

Responsibilities:

- live run stages
- tool actions/results
- verification state
- artifacts rail
- run history
- resume/retry/abort

Primary surfaces:

- `src/screens/circles/tabs/ChatTab.tsx`
- `src/screens/circles/tabs/RoomsTab.tsx`

### 8. Evaluation Layer

Measure whether OpenSwan is actually improving.

Metrics:

- successful code task completion rate
- successful fix-after-failure rate
- tests/build/lint pass rate after generated changes
- review precision and false-positive rate
- artifact conversion rate into rooms/files
- average time to first correct result

Primary future files:

- `src/lib/openswanEvals.ts`
- `src/lib/openswanBenchmarks.ts`

## Section-by-Section Execution Plan

## Section A: Session Runtime

### Objective

Make all OpenSwan execution flow through one runtime.

### Tasks

1. Keep `openswanSessionRuntime` authoritative for main chat and room chat.
2. Add task profiling and verification planning to each turn.
3. Add tool planning and later tool execution.
4. Add explicit cancellation and retry hooks.
5. Expose run metadata cleanly to UI surfaces.

### Done in this slice

- shared session runtime exists
- task profiling, verification planning, and entity-aware tool planning are wired into the runtime
- mode policy is centralized and persisted into run metadata
- observed evals are persisted and surfaced in shared run summaries
- explicit memory stores and progressive context discovery are live
- runtime skill resolution and skill playbooks are live

### Next implementation

- make delegated specialists inherit the same runtime contract more explicitly
- expand control-plane actions over runs

## Section B: Tool Runtime

### Objective

Give OpenSwan typed, auditable tools rather than generic text-only reasoning.

### Tool categories

- code inspection
- file generation/application
- room workspace actions
- build/test/lint verification
- git and diff actions
- browser/research actions
- issue/task/project actions

### Tasks

1. Create typed tool registry and execution context.
2. Add permission model by surface.
3. Add run-step logging for every tool call/result.
4. Start with safe internal app tools before shell/network tools.
5. Later bridge shell/build/test tools through a controlled adapter.

### Status

- typed OpenSwan tool/runtime planning exists
- tool events are persisted into run metadata and shared run surfaces
- browser and internal app tool paths are integrated
- local `local.run_shell` / `git.run` compatibility tools are constrained as of
  2026-07-24 to fixed read-only git diagnostics plus `node --check/--version`
  over `exec_file`; builds, tests, package scripts, shells, and mutations
  delegate to paired connected coding agents — see
  `docs/CODING_AGENT_UPGRADE_PLAN.md` P2/P3
- formal toolset-by-surface policy remains future work

## Section C: Verification Runtime

### Objective

Make coding output prove itself.

### Tasks

1. Infer verification needs by task profile.
2. Generate a checklist for each run.
3. Store verification plan in run metadata.
4. Later execute verification automatically where possible.
5. Surface verified / unverified / blocked state in UI.

### Status

- verification plans are inferred and stored
- verification execution runtime exists and feeds observed run quality
- verification coverage is surfaced in shared run summaries and quality aggregate views

### Verification examples

- build feature: typecheck + test + preview
- review request: findings + severity + missing tests
- debug request: root cause + reproduction + fix + regression checks
- architecture request: dependency boundaries + migration risks + integration points

## Section D: Subagents

### Objective

Break complex work into specialists.

### Tasks

1. Replace pattern-only delegation with typed subagent capabilities.
2. Add per-role tool permissions.
3. Track child runs and delegation evidence.
4. Add UI visibility for delegated work.

### Status

- typed subagent capability profiles exist and back `subagentRegistry.ts`
- delegated child runs are created with lineage in `agent_runs`
- parent summaries surface delegated specialist names
- detailed child-run inspection remains the next control-plane slice

## Section E: Workspace Runtime

### Objective

Make OpenSwan output land directly in files and sandboxes.

### Tasks

1. Expand artifact-to-room mapping.
2. Track generated files as part of run artifacts.
3. Open the most relevant file and preview automatically.
4. Bind verification previews back into Rooms.

## Section F: Memory Runtime

### Objective

Store durable coding context, not just chat text.

### Tasks

1. Add structured coding memory summary per session.
2. Persist current task, active files, recent failures, accepted decisions.
3. Retrieve only the memory relevant to the current task profile.

### Status

- explicit OpenSwan memory stores now exist
- memory is separated into user profile, runtime memory, and working memory
- deeper repo/workspace state memory remains future work

## Section G: Control Plane UI

### Objective

Expose execution, not just transcript.

### Tasks

1. Add run timeline rail.
2. Add tool activity feed.
3. Add verification status badges.
4. Add artifact ledger with open/apply actions.
5. Add stop/retry/resume controls.

### Status

- shared run metadata summaries now surface routing, browser context, delegated specialists, mode context, and observed quality
- run history and office surfaces have quality aggregates
- active skills are now visible in shared run summaries
- stop / retry / resume controls remain mostly unbuilt

## Section H: Evaluation Layer

### Objective

Make OpenSwan objectively better over time.

### Tasks

1. Define benchmark task sets.
2. Capture outcomes from real user flows.
3. Score correctness, verification, latency, artifact usefulness.
4. Use evals to guide prompt/tool/runtime work.

### Done in this slice

- `src/lib/openswanBenchmarks.ts` now defines representative OpenSwan benchmark cases across build, plan, debug, research, design, support, and browser-heavy requests
- `src/lib/openswanEvals.ts` now evaluates routing, mode policy, profile resolution, task kind, verification, and tool planning against those benchmark cases
- `scripts/check-openswan-evals.mjs` now runs the benchmark suite as a lightweight regression harness
- `src/lib/openswanObservedEvals.ts` now normalizes observed run quality from persisted OpenSwan run metadata, verification results, tool outcomes, and artifacts
- runtime completion paths now persist `observedEval` into `agent_runs.metadata` so future dashboards and audits can aggregate real OpenSwan outcomes without re-deriving them from raw fields
- observed evals now include skill-execution signals and weak-skill clustering

## Recommended Next Build Order

1. Make subagents inherit the same memory/skill/runtime contract
2. Add drilldowns from weak skills / weak modes into affected runs
3. Controlled shell/build/test adapter for stronger verification
4. Workspace/runtime isolation improvements + checkpoint/rollback safety
5. Run control actions: retry, resume, abort
6. Deeper coding-session memory for repo/workspace context
7. Formal toolset-by-surface policy

## Current Implementation Slice

This execution pass focuses on:

1. cleaning the plan so it matches shipped runtime + skills work
2. keeping all agent surfaces on the same execution order

That is the right next step because runtime capability has moved faster than the docs, and drift between plan docs makes it easier for different agent surfaces to evolve in inconsistent ways.
