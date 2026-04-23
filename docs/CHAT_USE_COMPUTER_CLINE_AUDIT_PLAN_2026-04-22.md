# Chat + Use Computer Audit & Cline-Inspired Plan

Date: 2026-04-22
Status: Canonical audit + build plan for Chat automation and `Use Computer`
Audience: Swanbot / OpenSwan / Chat / Office / future bridge agents

## Goal

Turn chat into one reliable agent entrypoint and turn `Use Computer` into a true permissioned computer runtime that can:

- locate files the user has granted access to
- use connected apps and MCP tools
- use browser automation when a website is actually needed
- stage multi-surface tasks across files, apps, and browser work
- explain what access is missing instead of pretending it completed work

This plan also identifies what Swanbot should borrow from Cline so it becomes a more durable, transparent, approval-aware agent runtime.

---

## Executive Summary

The repo has made real progress on both fronts:

- chat now has a real planner: `src/lib/chatAutomationPlanner.ts`
- chat now has a real dispatcher: `src/lib/runChatAutomationPlan.ts`
- `Use Computer` now has a capability audit: `src/lib/computerCapabilityRegistry.ts`
- `Use Computer` now has an execution envelope: `src/lib/computerTaskExecution.ts`
- non-browser computer tasks now have a shared runtime: `src/lib/computerTaskRuntime.ts`

But the stack is still not fully coherent.

### Current truth

1. Chat is partially unified, not fully unified.
2. `Use Computer` is partially generalized, but execution is still browser-first.
3. Planning quality is ahead of execution quality.
4. Approval and rollback are still thinner than they need to be for a serious computer agent.
5. The system still lacks the durable task-state, workflow, and hook layers that make Cline feel operationally mature.

### Bottom line

The next major upgrade should not be another UI pass. It should be:

1. a first-class `run_computer_task` execution path in chat
2. real file/app/hybrid adapters behind `Use Computer`
3. per-surface approval and grant persistence
4. visible task-state / focus-chain tracking
5. rollback / checkpoint support for risky multi-step tasks

---

## Local Audit

### A. Chat is better, but not yet one execution system

Relevant files:
- `src/lib/chatAutomationPlanner.ts`
- `src/lib/runChatAutomationPlan.ts`
- `src/screens/circles/tabs/ChatTab.tsx`

What is good:
- chat has a shared planning object with risk and approval metadata
- the dispatcher contract exists and is sound
- stable command families are moving behind the dispatcher
- plain chat and explicit OpenSwan mode are now partially on the same plan

What is still weak:
- `Use Computer` is not yet a first-class execution kind in the planner/dispatcher
- `open_modal` is still doing too much UI orchestration work in `ChatTab`
- special quick actions still bypass the same execution and observability quality as normal agent runs
- some task classes are still decided by heuristics in `ChatTab` instead of by a dedicated execution contract

### B. `Use Computer` is structurally ahead of where it used to be, but still not truly multi-surface

Relevant files:
- `src/lib/computerCapabilityRegistry.ts`
- `src/lib/computerTaskPlanner.ts`
- `src/lib/computerTaskDispatch.ts`
- `src/lib/computerTaskExecution.ts`
- `src/lib/computerTaskRuntime.ts`
- `src/lib/computerUse.ts`
- `src/lib/computerUseAgent.ts`
- `src/lib/useComputerUseTask.ts`
- `src/components/computer-use/ComputerUseConsole.tsx`
- `src/components/computer-use/ComputerUsePanel.tsx`

What is good:
- the system now distinguishes browser, file, app, and hybrid tasks
- it audits capability sources across MCP, bridges, and integrations
- it can route browser tasks to the live browser/computer-use runtime
- it can route non-browser tasks to the unified agent runtime with explicit dispatch context
- the console UX is materially better than the old prompt-based launcher

What is still weak:
- `computerUse.ts` is still fundamentally browser-shaped in its data model
- non-browser execution is still guidance-heavy and adapter-light
- `file_task` does not yet have a true filesystem execution adapter
- `app_task` does not yet have a true MCP/integration/bridge execution adapter
- `hybrid_task` does not yet have a staged multi-step executor with visible transitions
- approvals are still mostly browser/step-centric, not computer-surface-centric
- there is no durable computer-task workflow object that survives retries and resumptions cleanly

### C. The current system still has real regression and consistency issues

Relevant file:
- `src/screens/circles/tabs/ChatTab.tsx`

Concrete issue found during audit:
- `__NUKE__` is currently deleting all messages in the circle again via `.eq('circle_id', circleId)` instead of being thread-scoped. This is a regression and should be treated as a Phase 0 fix.

Other consistency issues:
- user-facing wording has moved toward `Use Computer`, but some internal command and data contracts are still browser-centered
- the browser path has richer live execution semantics than file/app/hybrid paths
- chat-side automation quality and computer-task quality are still tracked separately instead of through one shared run contract

---

## What Cline Gets Right

Primary sources:
- Home: https://docs.cline.bot/home
- Overview: https://docs.cline.bot/introduction/overview
- Plan & Act: https://docs.cline.bot/features/plan-and-act
- Deep Planning: https://docs.cline.bot/features/slash-commands/deep-planning
- Focus Chain: https://docs.cline.bot/features/focus-chain
- Checkpoints: https://docs.cline.bot/core-workflows/checkpoints
- Memory Bank: https://docs.cline.bot/customization/memory-bank
- Auto Approve: https://docs.cline.bot/features/auto-approve
- Browser Automation: https://docs.cline.bot/exploring-clines-tools/remote-browser-support
- Hooks: https://docs.cline.bot/features/hooks/hook-reference
- Workflows: https://docs.cline.bot/features/slash-commands/workflows/index
- MCP Overview: https://docs.cline.bot/mcp/mcp-overview
- MCP Marketplace: https://docs.cline.bot/mcp/mcp-marketplace
- Product site: https://cline.bot/

### 1. Clear Plan vs Act boundary

Cline explicitly separates planning from doing. That matters because the agent is less likely to jump straight into action before it understands the task.

What Swanbot should borrow:
- a visible `Plan` vs `Act` state for computer tasks
- automatic default to planning for hybrid or risky tasks
- explicit user transition from scoped plan to execution

### 2. Deep planning before complex work

Cline’s `/deep-planning` pattern is valuable because it front-loads investigation and clarification before edits or commands.

What Swanbot should borrow:
- a deep-planning mode for complex chat requests
- deeper pre-execution investigation for `Use Computer` hybrid tasks
- a generated implementation/execution plan before any risky action

### 3. Focus Chain

Cline’s Focus Chain is effectively a visible persistent todo/checklist system for long-running tasks.

What Swanbot should borrow:
- a task checklist for long computer tasks
- visible step status in chat and Office
- resumable state across refresh, remount, and model switches

### 4. Checkpoints

Cline treats rollback as part of the normal workflow, not a separate disaster recovery story.

What Swanbot should borrow:
- pre-execution snapshots for multi-step computer tasks
- browser/app/file checkpoint markers before destructive steps
- restore options after a run goes wrong

### 5. Memory Bank

Cline’s Memory Bank is simple and effective because it turns context into durable project documents rather than trying to keep everything in transient prompt state.

What Swanbot should borrow:
- per-circle and per-thread task memory files/docs
- durable active-context summaries for long agent efforts
- explicit `current task / next steps / blockers / granted access` state

### 6. Auto-approve with clear scopes

Cline’s approval model is granular and legible. It makes it obvious what is being auto-approved and what is not.

What Swanbot should borrow:
- separate approval toggles for browser, files, apps, MCP, bridges
- safe vs approval-required operation classes
- max-step / max-action limits per run
- stronger permission summaries in the `Use Computer` launcher

### 7. Hooks

Cline’s hook system gives deterministic guardrails around non-deterministic agent behavior.

What Swanbot should borrow:
- pre-tool and post-tool hooks for computer tasks
- policy hooks for path scope, domain scope, credential use, and destructive commands
- task-start and task-complete hooks for logging, summarization, and metrics

### 8. Workflows

Cline’s workflows give repeatable explicit task scripts.

What Swanbot should borrow:
- reusable computer workflows like:
  - `find-and-summarize-files`
  - `browser-research-compare`
  - `check-app-and-report`
  - `multi-surface-support-investigation`
- slash or quick-action workflow launchers
- saved execution templates that are more than prompt snippets

### 9. MCP as a first-class capability layer

Cline treats MCP as a native extension surface, not as an exotic bolt-on.

What Swanbot should borrow:
- better first-class MCP surfacing inside `Use Computer`
- visible capability mapping from task shape -> MCP/integration/bridge candidates
- install/connect guidance when a required surface is missing

---

## Key Gaps To Fix

### Gap 1: No first-class `run_computer_task` execution kind

Today `Use Computer` is still partially a modal flow and partially a runtime flow.

Needed change:
- add a dedicated planner execution kind for `run_computer_task`
- make chat planner/dispatcher treat computer work as a top-level runtime, not a browser-adjacent special case

Status update:
- shipped: `run_computer_task` exists in `chatAutomationPlanner.ts`
- shipped: `Use Computer` console routes browser and non-browser tasks through the shared `run_computer_task` transport
- shipped: browser tasks now enter the same shared transport and then hand off to the browser runtime after planning/approval
- shipped: normal chat can classify and route computer-task requests into that execution kind
- shipped: initial grant planning now describes browser/file/app/MCP/bridge access requirements before execution
- shipped: browser approvals can now persist remembered browser grant scopes for later runs
- shipped: `Use Computer` now persists a durable task-state object covering planning / approval / execution / terminal state, which becomes the runtime foundation for Focus Chain style UI and resumability
- remaining gap: browser tasks still need deeper run-state parity with file/app/hybrid tasks once adapter-specific grants, checkpoints, and richer task-state are built

### Gap 2: File/app/hybrid adapters are not real yet

Today:
- browser is real
- file/app/hybrid are mostly structured guidance + agent prompting

Needed change:
- real `file_task` adapter
- real `app_task` adapter
- real `hybrid_task` orchestrator

### Gap 3: Approval model is still too browser-centric

Needed change:
- approvals by surface and scope:
  - file read
  - file write
  - folder/path scope
  - app action
  - browser navigation
  - browser side-effect action
  - bridge tool execution
  - MCP server tool execution

### Gap 4: No durable long-task state model

Needed change:
- persistent task graph / checklist / progress state
- resumable computer tasks after refresh or reconnect
- visible blocker and access-missing state

### Gap 5: No checkpoint/rollback layer for computer tasks

Needed change:
- checkpoint objects before risky transitions
- file snapshot support where applicable
- browser/app step restore markers
- restore UI in run history / task card

### Gap 6: Naming and runtime contracts are still mixed

Needed change:
- keep browser as one adapter, not the identity of the whole feature
- make `Use Computer` truly the umbrella runtime
- keep browser-specific types behind the browser adapter only

---

## Recommended Architecture

## 1. Canonical stack

```text
Chat input
  -> chatAutomationPlanner
  -> run_chat_automation dispatcher
  -> run_computer_task
  -> computerTaskExecution
  -> computerTaskRuntime
  -> adapter
       - browser_adapter
       - file_adapter
       - app_adapter
       - hybrid_adapter
  -> normalized run outcome
  -> observed evals + approvals + checkpoints + history
```

## 2. New canonical types

Add a shared computer-task contract:

- `ComputerTaskPlan`
- `ComputerTaskGrantSet`
- `ComputerTaskCheckpoint`
- `ComputerTaskStep`
- `ComputerTaskOutcome`

These should outlive individual UI components.

## 3. New planner execution kind

In `chatAutomationPlanner.ts` add:
- `run_computer_task`

This should own:
- direct `Use Computer` launch
- natural-language computer requests from chat
- future `/computer ...` command family

---

## Build Plan

## Phase 0 — Regression cleanup and consistency

1. Restore `__NUKE__` to thread-scoped delete only.
2. Audit all `Use Browser` remnants and keep browser-specific wording only where the browser adapter is truly the subject.
3. Normalize quick-action and modal result envelopes so `Use Computer`, `Assign Agent`, and `Spawn Agent` all emit the same structured outcome shape.
4. Add a single audit test for quick-action regressions covering:
   - `__COMPUTER_USE__`
   - `__NUKE__`
   - `__SPAWN_AGENT__`
   - `__ASSIGN_AGENT__`

## Phase 1 — Make `Use Computer` a first-class chat execution kind

1. Add `run_computer_task` to `ChatAutomationExecutionKind`.
2. Update `buildChatAutomationPlan(...)` to classify explicit and natural-language computer requests into that kind.
3. Register a dedicated transport in `runChatAutomationPlan.ts`.
4. Stop routing computer work through `open_modal` as the real execution identity.
5. Attach planner decisions for computer tasks to run metadata the same way other shared routes do.

## Phase 2 — Real execution adapters

### 2a. File adapter

Create a real file adapter that can:
- search allowed paths
- inspect folder structure
- read files
- summarize findings
- propose writes separately from reads

Adapter requirements:
- path-scope aware
- approval-aware
- MCP/bridge aware
- explicit missing-access reporting

### 2b. App adapter

Create a real app adapter that can:
- discover available app surfaces from integrations, MCP, and bridges
- choose the least-destructive capable surface
- state missing connectors clearly
- perform read-only app inspections separately from write actions

### 2c. Hybrid adapter

Create a staged orchestrator that can build and execute steps like:
1. inspect local files
2. consult app/integration
3. open browser only if needed
4. summarize or ask approval for the next step

This adapter must expose visible ordered steps, not a single opaque prompt.

## Phase 3 — Permission and grants system

Add a durable grant model for:
- path scopes
- app scopes
- domains
- MCP server scopes
- bridge scopes
- per-run vs sticky grants

Add auto-approve classes inspired by Cline:
- read-only file access
- write file access
- safe browser actions
- browser side-effect actions
- safe app reads
- app writes
- safe MCP tools
- external side-effect tools

## Phase 4 — Focus Chain for Chat + Use Computer

Add persistent task-state tracking:
- current plan
- step checklist
- current step
- blocked steps
- pending approvals
- missing access
- final summary

Surface it in:
- the chat task card
- Office
- run history

## Phase 5 — Checkpoints and restore

Add checkpoint support for computer tasks:
- before file write proposals
- before high-risk browser/app submissions
- before hybrid stage transitions

Support restore modes like:
- restore task state
- restore file state
- restore both

## Phase 6 — Memory Bank + workflows + hooks for Swanbot

### 6a. Memory Bank

Create a lightweight Swanbot memory-bank pattern for:
- `projectbrief`
- `activeContext`
- `taskContext`
- `grants/access state`
- `recent decisions`

### 6b. Workflows

Add reusable workflows for common computer-agent tasks.

### 6c. Hooks

Add hooks around:
- task start
- pre-tool use
- post-tool use
- pre-approval
- task completion
- pre-compact/context compression

## Phase 7 — Quality, evals, and operations

Add quality scoring for computer tasks:
- task classification quality
- access reporting quality
- plan completeness
- execution correctness
- over-claim rate
- unnecessary browser usage rate
- unnecessary escalation rate

Add dashboards for:
- most common missing capabilities
- failed adapters
- blocked approvals
- hybrid-task drop-off
- time-to-complete per adapter

---

## Recommended Immediate Work Order

Do these next, in this order:

1. Fix `__NUKE__` regression.
2. Add `run_computer_task` to planner + dispatcher.
3. Build `file_task` adapter first.
4. Build grant persistence and approval classes.
5. Build visible Focus Chain / checklist state.
6. Build `app_task` adapter.
7. Build hybrid staged executor.
8. Add checkpoints.
9. Add Swanbot workflows + hooks.

Reason:
- file access is the fastest way to make `Use Computer` materially more powerful than browser automation
- planner unification prevents more branching drift
- grants/checklists/checkpoints create the safety model needed before broader autonomy

---

## Swanbot Features To Borrow From Cline

High priority:
- Plan vs Act mode
- Deep planning
- Focus Chain
- Checkpoints
- granular auto-approve
- hooks
- workflows
- durable memory-bank style task context

Medium priority:
- explicit model split by task phase
- better MCP discovery/install UX
- more CLI/headless automation patterns for scheduled or background jobs

Low priority:
- anything purely editor-specific that does not translate to Circle / Office / chat

---

## Recommendation

Do not keep extending `Use Computer` primarily through more prompt engineering or modal polish.

The right next investment is runtime architecture:
- one computer-task execution kind
- one computer-task contract
- real adapters
- real grants
- real task-state
- real rollback

That is the path that turns Swanbot into the kind of durable, always-improvable agent runtime that Cline hints at, while still fitting the Circle / Office / OpenSwan architecture already in this repo.
