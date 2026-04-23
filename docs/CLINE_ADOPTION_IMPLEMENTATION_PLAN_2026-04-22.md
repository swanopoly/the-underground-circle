# Cline Adoption Implementation Plan

Date: 2026-04-22  
Status: Canonical implementation plan  
Audience: Claude Code, Codex, Gemini, Cursor, OpenSwan, future bridge agents

## Purpose

This is the implementation-facing companion to:

- [CLINE_RESEARCH_AND_MAPPING_2026-04-22.md](./CLINE_RESEARCH_AND_MAPPING_2026-04-22.md)
- [CHAT_USE_COMPUTER_CLINE_AUDIT_PLAN_2026-04-22.md](./CHAT_USE_COMPUTER_CLINE_AUDIT_PLAN_2026-04-22.md)
- [AGENTS_ROADMAP.md](./AGENTS_ROADMAP.md)

Use this doc when building Cline-inspired runtime features in the app.  
If there is a conflict between local code and older notes, this doc plus the shipped code wins.

## North star

Adopt the parts of Cline that improve agent reliability and operator control:

1. visible Plan vs Act boundaries
2. durable task-state / focus-chain tracking
3. reversible checkpoints for risky actions
4. remembered approvals and clear access scopes
5. structured task memory
6. hooks and workflows
7. stronger first-class MCP surfacing

Do **not** copy Cline's XML tool format, IDE assumptions, or local stdio-spawn model.

## Canonical build order

### Phase 1 — Task state and Focus Chain foundation

Goal:
- every long-running chat or computer task should have a durable state object

Build:
- canonical runtime state store for `Use Computer`
- phases: `planning`, `awaiting_approval`, `executing`, `completed`, `failed`, `blocked`
- durable fields:
  - current task
  - current step
  - steps
  - blockers
  - next steps
  - granted access
  - access plan
- later readers:
  - chat cards
  - Office
  - run history
  - future focus-chain UI

Status:
- shipped initial foundation:
  - `src/lib/computerTaskState.ts`
  - shared `Use Computer` transitions now persist planning / approval / execution / terminal state

### Phase 2 — Plan vs Act enforcement

Goal:
- make planning and doing different runtime states, not just labels

Build:
- visible Plan vs Act pill in chat
- dispatcher gate in `runChatAutomationPlan.ts`
- computer tasks default to:
  - `plan` for hybrid or risky work
  - `act` for direct safe execution
- explicit transition from scoped plan to execution

Status:
- partial groundwork exists in chat mode policy and dispatcher
- not yet a full Cline-style execution gate

### Phase 3 — Durable grants and approval classes

Goal:
- approvals should be legible, remembered, and surface-specific

Build:
- browser navigation vs browser side effects
- file read vs file write
- app read vs app action
- MCP tool execution
- bridge execution
- remembered approvals by circle/thread/scope
- explicit requested vs granted scopes in runtime state

Status:
- shipped:
  - grant planning in `src/lib/computerTaskGrants.ts`
  - remembered browser grants in `src/lib/computerTaskGrantMemory.ts`
- remaining:
  - file/app/MCP/bridge remembered scopes
  - durable scope shapes beyond simple ids

### Phase 4 — Real staged hybrid executor

Goal:
- hybrid tasks should be decomposed and executed in visible ordered steps

Build:
- `hybrid_task` executor
- ordered surfaces:
  - files
  - apps
  - browser
- per-step approval transitions
- per-step task-state updates
- clear stop/resume semantics

Status:
- not yet shipped

### Phase 5 — Checkpoints and restore

Goal:
- risky work must be reversible

Build:
- checkpoint object before destructive file/app/browser actions
- compare and restore flow
- task-level restore state
- checkpoint ids attached to task-state and run metadata

Status:
- not yet shipped

### Phase 6 — Memory bank

Goal:
- make long-running agent context durable and structured

Build:
- structured memory docs:
  - `brief`
  - `active_context`
  - `progress`
- later:
  - `system_patterns`
  - `tech_context`
  - `product_context`
- explicit commands to refresh specific docs

Status:
- not yet shipped in Cline-style form

### Phase 7 — Hooks

Goal:
- add deterministic policy and logging around runtime actions

Build:
- pre-tool hooks
- post-tool hooks
- pre-approval hooks
- task-start / task-complete hooks
- path/domain/credential policy hooks

Status:
- not yet shipped

### Phase 8 — Workflows

Goal:
- reusable explicit multi-step task scripts

Build:
- markdown-backed workflows
- launchable from chat / quick actions
- initial workflow families:
  - file audit
  - browser research compare
  - app status check
  - support investigation

Status:
- not yet shipped

### Phase 9 — MCP productization

Goal:
- treat MCP as a first-class runtime surface

Build:
- better task-shape to MCP mapping
- install/connect guidance
- prompt component for MCP surface summary
- later marketplace-style UX

Status:
- partial capability/runtime groundwork exists
- product layer not finished

## Current implementation rules

1. All new Cline-inspired runtime work should land on shared contracts, not `ChatTab`-local one-offs.
2. `Use Computer` must keep routing through:
   - `computerCapabilityRegistry`
   - `computerTaskExecution`
   - `computerTaskRuntime`
3. New approval or task-state work should extend the above stack, not bypass it.
4. Update this doc and [AGENTS_ROADMAP.md](./AGENTS_ROADMAP.md) whenever a phase materially ships.
5. If a future agent wants to build hooks, checkpoints, or workflows, start from this phase order unless there is a clear blocker.

## Immediate next steps

1. Extend remembered grants beyond browser to file/app/MCP/bridge scopes.
2. Build the staged `hybrid_task` executor on top of `computerTaskState`.
3. Surface the persisted task-state in chat and Office.
4. Add Plan vs Act enforcement for computer tasks before hybrid execution becomes more autonomous.
