# Feed Task Agent Execution Deep Audit

Date: 2026-04-04
Repo: `the-underground-circle`
Scope:

- Feed task execution
- agent task assignment and runs
- tool coverage for end-to-end work
- design-task support
- research-driven capability recommendations

## Executive summary

The Feed task system is much more advanced than a simple kanban board. It already has:

- multi-agent assignment
- completion policies
- structured task runs
- task comments with attachments
- model/thinking-mode selection
- some task analytics and costs

That is strong groundwork.

The main problem is not the absence of a task engine. The main problem is that task execution is still mostly prompt-driven and text-returning, instead of tool-driven and artifact-producing.

Current reality:

- agents can be assigned to a task
- a run record can be created
- the agent gets a strong prompt contract
- the result comes back as text
- that text is stored as a comment and sometimes code attachments

That is enough for analysis, summaries, planning, and lightweight coding help.

It is not enough for agents to reliably complete real product tasks end-to-end, especially when tasks require:

- design work
- browser validation
- room/file edits
- repo changes
- multi-step execution
- acceptance criteria checks
- artifact generation

The strongest direction is:

- keep the current task-run model
- expand it into a real task execution runtime with task-scoped tool bundles
- require explicit artifacts, verification, and acceptance checks
- give design-capable agents access to design tools, visual references, and export paths

## Current architecture

### Feed task data model is already strong

Primary types:

- `src/types/kanban.ts`

The task system already supports:

- `assigned_agent_ids`
- `completion_policy`
- `TaskAgentAssignment`
- `TaskRun`
- `TaskRunOutput`
- `artifact_refs`
- `mark_complete`
- `needs_review`

Relevant references:

- [kanban.ts](/Users/cswanson/the-underground-circle/src/types/kanban.ts)
- [kanban.ts#L13](/Users/cswanson/the-underground-circle/src/types/kanban.ts#L13)
- [kanban.ts#L46](/Users/cswanson/the-underground-circle/src/types/kanban.ts#L46)

### Database tracking exists for agent assignments and runs

Primary migration:

- `supabase/migrations/20260327_task_agent_tracking.sql`

It adds:

- `task_agent_assignments`
- `task_runs`
- task-run linkage to comments and automation rows

This is a real execution model, not just UI metadata.

Relevant references:

- [20260327_task_agent_tracking.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260327_task_agent_tracking.sql)

### Feed task execution is centralized in `useKanbanData`

Primary file:

- `src/hooks/useKanbanData.ts`

Important behavior:

- creates task runs
- assigns agents
- builds a structured prompt contract
- invokes agents
- parses structured JSON envelope
- updates task status
- records cost/tokens/duration
- inserts the result back into comments

Relevant references:

- [useKanbanData.ts#L856](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L856)
- [useKanbanData.ts#L925](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L925)
- [useKanbanData.ts#L963](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L963)
- [useKanbanData.ts#L998](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L998)

### Invocation routing exists, but it is generic

Primary file:

- `src/lib/agentInvocation.ts`

Current invocation routes across:

- BlackSwan
- Claude Code bridge
- Gemini CLI bridge
- BYO LLM/OpenClaw-style agents

Relevant reference:

- [agentInvocation.ts#L685](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts#L685)

### Bridge dispatch exists for some external task execution

Primary file:

- `src/lib/bridgeTaskDispatcher.ts`

This provides direct provider routing for:

- `claude-code`
- `codex`
- `gemini`
- `cursor`

Relevant reference:

- [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)

## What works today

### 1. Agents can be assigned to tasks as first-class actors

This is real and already better than many “AI task board” prototypes.

Strengths:

- one or more agents can be assigned
- assignments can be role-aware
- completion can require one or many assignees

### 2. Task runs are recorded structurally

The app already stores:

- run kind
- status
- input payload
- output payload
- summary
- artifacts
- cost
- tokens
- duration

That is the right direction.

### 3. The task prompt contract is better than average

The run prompt explicitly asks the agent to emit:

- summary
- completion state
- review need
- blockers
- next actions
- artifacts

Evidence:

- [useKanbanData.ts#L925](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L925)

This is the right pattern. It just needs stronger tooling underneath it.

### 4. Task comments can carry attachments

The app supports task attachments and comment attachments, including code and image files.

Relevant references:

- [useKanbanData.ts#L797](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L797)
- [20260319_task_images.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260319_task_images.sql)

### 5. Design-adjacent infrastructure already exists

The repo already contains:

- task image attachments
- a `designer` agent role
- Hugging Face tool support
- Figma provider/config references
- Office `/imagine`
- Figma board furniture and OAuth traces

This means the app already has useful pieces for design-capable agent work.

## Primary findings

### Finding 1. Feed task execution is still mostly “prompt in, text out”

Severity: high

`runAgentOnTask(...)` builds a structured prompt and calls `invokeDirect(...)`. The result is then parsed and inserted back as a comment plus optional extracted code attachments.

Evidence:

- [useKanbanData.ts#L856](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L856)
- [useKanbanData.ts#L963](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L963)
- [useKanbanData.ts#L1007](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts#L1007)

Impact:

- real work is often simulated rather than executed
- task completion quality depends too much on prompt discipline
- agents lack a reliable artifact pipeline

Recommendation:

- tasks need a task-scoped tool runtime, not just a better prompt

### Finding 2. Task execution is not task-surface aware

Severity: high

The Feed task system does not yet appear to route work through explicit task tool bundles like:

- code editing
- room file ops
- GitHub writes
- browser checks
- design fetch/export
- image generation
- schema/db ops

Instead, it primarily invokes the target agent through generic routing and asks for deliverables in text.

Impact:

- weak end-to-end execution
- no predictable capability profile by task type
- hard to know when an agent can actually finish a task

Recommendation:

- every task should declare the tool bundle it allows

### Finding 3. There is no strong acceptance-criteria execution layer

Severity: high

The task run contract supports `mark_complete` and `needs_review`, but there is no visible hard execution of:

- acceptance criteria
- test pass/fail
- browser validation
- visual checks
- artifact presence requirements

The agent can claim completion with weak enforcement.

Impact:

- false positives on task completion
- review burden shifts to humans

Recommendation:

- add structured `task_acceptance_checks`
- completion should require successful checks, not just a self-report

### Finding 4. Design tasks are underpowered despite existing design signals

Severity: high

The repo has:

- `designer` role in roster
- task image uploads
- Figma provider support in config/migrations
- Figma board UI in Office

But task execution does not appear to give designers a full design workbench.

Missing capabilities:

- fetch design specs from Figma
- inspect latest ready-for-dev frames
- export image assets
- compare design revisions
- produce visual deliverables into artifacts
- route generated assets back into task outputs cleanly

Impact:

- design tasks become brainstorming prompts instead of deliverable workflows

### Finding 5. Tool provenance is weak for task runs

Severity: medium-high

Task runs record `model_used`, cost, token count, and output payload, but there is no strong per-run record of:

- tools invoked
- files touched
- repos touched
- URLs fetched
- browser steps performed
- design assets generated

Impact:

- hard to audit quality
- hard to debug failures
- difficult human review

Recommendation:

- add `task_run_steps`
- add `task_run_artifacts`
- add `task_run_approvals`

### Finding 6. Multi-agent task support exists structurally, but orchestration is still shallow

Severity: medium-high

The system supports:

- multiple assigned agents
- completion policies
- planner/executor/reviewer roles

But there is not yet a clear multi-agent orchestration runtime where:

- planner decomposes work
- designer produces visual direction
- engineer implements
- reviewer validates
- QA/browser agent verifies

Impact:

- multi-agent tasks are modeled but not fully operationalized

### Finding 7. Design, browser, and visual QA are not first-class task tools

Severity: medium-high

Real product tasks often require:

- visual spec extraction
- layout implementation
- screenshot review
- browser interaction
- responsive checks
- contrast/accessibility checks

The task system does not yet expose these as first-class capabilities.

Recommendation:

- add tool classes for:
  - browser
  - visual diff
  - screenshot capture
  - design source ingestion
  - image generation/edit

### Finding 8. Bridge-based execution is provider-routed, but capability-routed execution is missing

Severity: medium

`bridgeTaskDispatcher.ts` routes by provider, not by task capability.

That is not enough.

A task should ask:

- do I need browser automation?
- do I need repo writes?
- do I need image generation?
- do I need design source access?
- do I need room artifact access?

Recommendation:

- route task execution by capability profile, then choose provider/agent

### Finding 9. Feed’s “Agent Tasks” view is mostly retrospective

Severity: medium

The current panel parses task descriptions for agent metadata.

Evidence:

- [FeedTab.tsx#L120](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx#L120)
- [FeedTab.tsx#L124](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx#L124)

Impact:

- valuable, but mostly post-hoc
- not a strong supervision interface

Recommendation:

- evolve the Feed task detail modal into a real task control center

### Finding 10. Design and creative work lacks a clean artifact path

Severity: medium

Task outputs can produce attachments, but design work needs richer artifact handling:

- image
- moodboard
- UI draft
- component spec
- copy deck
- Figma links
- export bundles

Recommendation:

- expand artifact taxonomy beyond code/file/image-lite

## Research synthesis

### Codex pattern: tasks should run in isolated task environments

Useful source:

- OpenAI Codex:
  - https://openai.com/index/introducing-codex/

Relevant takeaway:

- serious agent work benefits from isolated task environments, parallelism, and reviewable outputs

Implication here:

- Feed tasks should produce isolated runs with bounded context and reviewable artifacts
- avoid relying on a shared conversational blob as the only state

### OpenCode pattern: tools and permissions should be explicit

Useful sources:

- OpenCode permissions:
  - https://opencode.ai/docs/permissions
- OpenCode commands:
  - https://opencode.ai/docs/commands/
- OpenCode agents:
  - https://opencode.ai/docs/agents/

Relevant takeaway:

- agents should have explicit tool permissions
- repeated workflows should become commands
- specialized agents should have bounded tool access

Implication here:

- Feed task agents need explicit task tool bundles
- designers should not get the same tool bundle as shell-heavy coding agents
- risky write actions should move behind approvals

### Figma Dev Mode pattern: design-to-code work needs inspectable design sources

Useful sources:

- Figma Dev Mode guide:
  - https://help.figma.com/hc/en-us/articles/15023124644247-Guide-to-Dev-Mode
- Figma MCP / Dev Mode fundamentals:
  - https://help.figma.com/hc/en-us/articles/35498519152663-Figma-MCP-collection-Dev-Mode-fundamentals-old-UI

Relevant takeaway:

- strong design handoff uses inspectable design specs, statuses, annotations, component variants, and design-to-code linkage

Implication here:

- a task system that wants agents to handle design work needs more than “designer spirit”
- it needs design-source access, statuses, inspection, and artifact export

### Browser automation pattern: real UI tasks need actual browser tooling

Useful source:

- Playwright browser docs:
  - https://playwright.dev/docs/browsers

Relevant takeaway:

- browser-driven validation is a distinct capability, not an optional extra

Implication here:

- agents should not mark UI tasks complete without browser or screenshot validation when the task requires it

## Recommended target model

## Each task should declare a capability bundle

Add a task-level capability schema such as:

- `analysis`
- `code_edit`
- `repo_write`
- `room_write`
- `browser`
- `design_read`
- `design_generate`
- `image_generate`
- `api_call`
- `db_query`
- `external_send`

This should determine:

- which agents are eligible
- which tools are shown
- which approvals are needed
- which completion checks are required

## Add task profiles

Recommended starter profiles:

### 1. Coding task

Tools:

- repo read/write
- room files
- tests
- diff preview

Checks:

- tests passed
- files changed
- summary + next actions

### 2. UI implementation task

Tools:

- repo read/write
- design source read
- browser
- screenshots

Checks:

- screenshot set generated
- responsive pass
- contrast/accessibility notes

### 3. Design task

Tools:

- design source read
- image generation/edit
- copy generation
- export artifact pack

Checks:

- design brief artifact
- visual artifact(s)
- component/style notes
- handoff notes

### 4. Research task

Tools:

- web research
- source capture
- comparison template

Checks:

- cited findings
- recommendation section
- decision memo

### 5. Launch/ops task

Tools:

- repo
- terminal/bridge
- API checks
- logs

Checks:

- deployment status
- smoke checks
- rollback note

## Design-capable agent stack

If agents are expected to “do design and everything if needed,” they need more than one model toggle.

Recommended design stack:

### Design read tools

- Figma file/frame inspection
- Figma Dev Mode metadata ingestion
- design annotations/statuses
- asset export references

### Design generation tools

- image generation
- asset editing/variation
- copy and naming generation
- palette/type/mood proposals

### Design implementation tools

- repo/code write
- CSS/Tailwind/style system changes
- component file edits
- screenshot capture
- browser QA

### Design review tools

- screenshot compare
- visual checklist
- accessibility checklist
- responsive verification

## Proposed task execution architecture

### New entities

Recommended additions:

- `task_run_steps`
- `task_run_approvals`
- `task_run_context_sources`
- `task_acceptance_checks`
- `task_deliverables`

### `task_run_steps`

Purpose:

- record what the agent actually did

Examples:

- read file
- generated patch
- fetched Figma frame
- opened browser
- took screenshot
- generated image
- ran tests

### `task_acceptance_checks`

Purpose:

- make completion evidence-based

Examples:

- `tests_passed`
- `screenshots_generated`
- `figma_frame_referenced`
- `artifact_uploaded`
- `manual_review_required`

### `task_deliverables`

Purpose:

- normalize artifacts

Examples:

- code patch
- design image
- Figma link
- markdown brief
- test report
- screenshot bundle

## Recommended UI upgrades

### Task detail modal should become the task command center

Today it already has comments, task runs, and agent run controls.

It should gain:

- capability chips
- required checks
- deliverables panel
- approvals panel
- run provenance
- tool usage log

### Add “Run Type” presets

Examples:

- `Plan`
- `Implement`
- `Review`
- `Design`
- `Research`
- `Ship`

These should map to capability bundles and acceptance checks.

### Add “What the agent can use” strip

Before running a task, show:

- browser
- GitHub
- room files
- Figma
- image generation
- tests

This improves trust and predictability.

### Add deliverables-first rendering

Do not make the comment stream the main output.

Instead show:

1. deliverables
2. checks
3. summary
4. raw transcript/log

## What features should be added

### 1. Task-scoped tool bundles

Highest priority.

Without this, the agent is still just a strong prompt consumer.

### 2. Figma design-source integration

Needed for real design and UI work.

The repo already hints at Figma support, but task execution needs it explicitly.

### 3. Browser and screenshot validation

Needed for real frontend task completion.

### 4. Artifact packs

Each run should be able to output:

- code diff
- files
- images
- screenshots
- design references
- notes

### 5. Acceptance-check engine

Agents should not self-certify completion without evidence.

### 6. Planner -> executor -> reviewer workflows

The data model already points this way. The runtime should catch up.

### 7. Design-specific task preset

Needed now if you want agents to “do design and everything if needed.”

Suggested outputs:

- design brief
- moodboard/image drafts
- component specs
- implementation notes

### 8. Task-to-room escalation

If a task requires broad file work or exploratory design iteration, the Feed task should be able to escalate into a Room run with traceable linkage.

### 9. Tool provenance

Every run should show:

- model
- tools used
- files touched
- artifacts created
- checks passed

### 10. Human approval on risky task actions

Examples:

- repo writes
- room deletions
- external sends
- production-impacting actions

## Claude-ready implementation direction

### Phase 1

- add task capability bundles
- add task acceptance checks
- add task run steps

### Phase 2

- expand task detail modal into a real supervision surface
- render deliverables and checks before comments

### Phase 3

- add browser and screenshot tools for UI tasks
- add Figma design-source support for design/UI tasks
- add image-generation artifact outputs

### Phase 4

- add planner/executor/reviewer orchestration
- add approval flow for risky actions

### Phase 5

- add task-to-room escalation and richer artifact handoff

## Bottom line

The Feed task system already has a serious foundation:

- assignments
- runs
- costs
- artifacts
- structured output

But it is still one architectural step short of real agentic task execution.

To make agents actually do the work correctly, including design work when needed, the app needs:

- task-scoped tools
- design-source access
- browser validation
- artifact-first outputs
- acceptance checks
- approvals on risky actions

Once those land, Feed tasks can evolve from “AI-assisted comments on tasks” into a true end-to-end agent work system.
