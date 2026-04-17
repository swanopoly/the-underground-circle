# OpenSwan Agent Implementation Plan

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

Gaps that block “Codex / Claude Code / SwanClaw quality”:

- No authoritative typed tool runtime for OpenSwan turns
- Weak closed-loop verification for coding tasks
- No real subagent runtime with tool scopes and consistent delegation
- Task/workspace isolation is partial, not systematic
- Session memory is not yet coding-task aware enough
- The UI shows work, but the runtime does not yet expose enough structured execution state
- No eval harness measuring actual coding-task success

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

### Next implementation

- wire task planner and verification plan into runtime
- attach tool recommendations to run metadata

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

## Section C: Verification Runtime

### Objective

Make coding output prove itself.

### Tasks

1. Infer verification needs by task profile.
2. Generate a checklist for each run.
3. Store verification plan in run metadata.
4. Later execute verification automatically where possible.
5. Surface verified / unverified / blocked state in UI.

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

## Section G: Control Plane UI

### Objective

Expose execution, not just transcript.

### Tasks

1. Add run timeline rail.
2. Add tool activity feed.
3. Add verification status badges.
4. Add artifact ledger with open/apply actions.
5. Add stop/retry/resume controls.

## Section H: Evaluation Layer

### Objective

Make OpenSwan objectively better over time.

### Tasks

1. Define benchmark task sets.
2. Capture outcomes from real user flows.
3. Score correctness, verification, latency, artifact usefulness.
4. Use evals to guide prompt/tool/runtime work.

## Recommended Build Order

1. Session runtime hardening
2. Task planner + verification planner
3. Tool runtime foundation
4. UI run ledger and tool feed
5. Workspace automation improvements
6. Subagent runtime
7. Evaluation system

## Current Implementation Slice

This execution pass starts:

1. task profiling
2. verification planning
3. tool recommendation planning
4. runtime wiring into `openswanSessionRuntime`

That is the right first step because it strengthens the agent core without forcing premature shell/network execution decisions.
