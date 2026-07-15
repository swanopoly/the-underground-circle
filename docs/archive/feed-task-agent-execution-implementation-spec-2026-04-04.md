# Feed Task Agent Execution Implementation Spec

Date: 2026-04-04
Repo: `the-underground-circle`
Depends on: `feed-task-agent-execution-deep-audit-2026-04-04.md`
Audience: Claude or another implementation agent
Goal: make Feed tasks executable by agents with the right tools, the right boundaries, and reviewable outputs

## Product goal

Turn Feed tasks from:

- prompt the agent
- wait for a textual answer
- hope the task is actually complete

into:

- choose the right task capability bundle
- run the task with explicit tools and permissions
- produce artifacts and verification evidence
- gate completion on real checks

This should work for:

- coding tasks
- design tasks
- research tasks
- content tasks
- browser/UI validation tasks
- room-aware operational tasks

## Core product constraints

### Keep what already works

Do not throw away the current Feed task foundations.

Preserve and extend:

- `tasks`
- `task_agent_assignments`
- `task_runs`
- current comments and attachments flow
- current agent assignment model
- current task detail modal as the main supervision surface

### Do not collapse all surfaces together

Feed, Rooms, Office, and main Chat should share runtime primitives, but not share identical trust boundaries.

Feed task execution should be:

- task-scoped
- approval-aware
- artifact-first
- capability-bounded

It should not become:

- unrestricted global chat execution
- automatic room mutation with no review
- a provider-only routing layer

### PR1 should build the runtime backbone

PR1 should not attempt:

- full background job orchestration for every provider
- full branchable task graphs
- every creative tool integration at once
- autonomous multi-agent swarms
- direct repo push/merge automation by default

PR1 should establish:

- task capability bundles
- task tool permissions
- task run steps
- task artifacts
- task acceptance checks
- task approvals
- a stronger task-control UI

## Current state summary

The current code already supports meaningful task execution primitives:

- task assignments and completion policy in [kanban.ts](/Users/cswanson/the-underground-circle/src/types/kanban.ts)
- task run creation and structured response parsing in [useKanbanData.ts](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts)
- provider invocation routing in [agentInvocation.ts](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts)
- bridge execution in [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)
- a task supervision UI in [TaskDetailModal.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/kanban/TaskDetailModal.tsx)

The current failure mode is not “no AI support.”

The failure mode is:

- execution is too text-centric
- tool access is implicit instead of explicit
- completion is too self-reported
- design work has no proper workbench
- reviewers cannot easily inspect what the agent actually did

## Target execution model

Every Feed task should run through five layers.

### 1. Task intent layer

The task declares:

- task type
- allowed capabilities
- completion policy
- acceptance requirements
- review requirements

Example task types:

- `code_change`
- `design_work`
- `ui_qa`
- `research`
- `content`
- `ops`
- `room_update`
- `mixed`

### 2. Capability bundle layer

The task receives a bounded tool bundle rather than a generic “smart model.”

Example bundles:

- `research_basic`
- `content_editorial`
- `ui_design`
- `frontend_build`
- `browser_qa`
- `room_curator`
- `task_triage`

### 3. Run plan layer

Each task run should have an explicit plan object:

- objective
- selected capabilities
- required artifacts
- required checks
- escalation rules
- approval requirements

### 4. Execution step layer

Every meaningful action should be recorded as a step:

- prompt/planning step
- tool call step
- artifact generation step
- check result step
- approval wait step
- finalization step

### 5. Completion gate layer

A run should not mark the task complete unless:

- required artifacts exist
- required checks passed
- required approvals were resolved
- completion policy is satisfied

## Capability bundles

Capability bundles should be the main abstraction, not providers.

Providers are implementation detail.

### `research_basic`

Use for:

- synthesis
- competitive review
- task planning
- requirements drafting

Allowed capabilities:

- retrieval/search
- URL fetch
- task attachment read
- comment read/write

Not allowed:

- room file writes
- code patch writes
- image generation
- browser interaction beyond read-only screenshots

### `content_editorial`

Use for:

- copywriting
- post drafts
- launch text
- task summaries

Allowed capabilities:

- retrieval/search
- attachment read
- markdown/doc generation
- image reference read
- comment/artifact write

Optional:

- image generation if explicitly enabled on the task

### `ui_design`

Use for:

- screen concepts
- component visual direction
- moodboards
- design annotations
- creative iteration

Allowed capabilities:

- task image read
- image generation/edit
- Figma inspect/export
- style token read
- comment/artifact write

Required outputs:

- at least one design artifact
- a design rationale
- implementation notes if the task is handoff-oriented

Not allowed by default:

- repo writes
- room file writes

### `frontend_build`

Use for:

- implementation tasks
- UI fixes
- component creation
- refactors

Allowed capabilities:

- code read
- patch proposal/write
- test run
- static analysis
- artifact write

Optional:

- browser validation
- design inspect

### `browser_qa`

Use for:

- validation
- regression review
- screenshot capture
- responsive checks
- accessibility smoke testing

Allowed capabilities:

- browser launch
- navigation
- screenshot capture
- console/network capture
- artifact write

Should not write app code by default.

### `room_curator`

Use for:

- room-aware content and file organization
- document curation
- room-specific output handoff

Allowed capabilities:

- read room files
- propose room file patches
- create room artifacts
- comment/artifact write

Room mutation should default to:

- preview first
- explicit approval required for apply

### `mixed`

Use only when the task genuinely requires multiple bundles.

Example:

- inspect design
- update code
- run browser checks

This should be explicit in the task run plan so reviewers can see why it was permitted.

## What should be connected and what should not

### Should be connected

#### Feed tasks and shared agent runtime

Feed should reuse shared primitives for:

- invocation
- steps
- approvals
- artifacts
- status updates

#### Feed tasks and task attachments

Task image attachments and file attachments should be directly usable as run context.

#### Feed tasks and design sources

Design tasks should be able to:

- inspect Figma-linked sources
- read task-attached mockups
- export task-specific visual artifacts

#### Feed tasks and Rooms

Feed tasks should be able to target a room as an output destination when the task explicitly calls for it.

The correct pattern is:

- generate or modify artifacts in the task run
- preview the room-facing change
- require approval before apply

### Should not be connected by default

#### Feed tasks should not get unrestricted room writes

Task execution should not automatically mutate room files just because a room exists.

#### Feed tasks should not get broad global shell power

If shell-like execution ever exists, it should be limited to a narrow backend worker context and not exposed as a default app capability.

#### Feed tasks should not share the same defaults as Office terminal

Office is an operations console.

Feed is a task execution and supervision surface.

They should share primitives, not product behavior.

#### Design tasks should not inherit coding-heavy bundles

Design work should not require code tools to be present just because the underlying model can use them.

## Data model additions

Add one new migration rather than rewriting prior migrations.

Suggested filename:

- `supabase/migrations/20260404_feed_task_execution_runtime.sql`

### `task_capability_profiles`

Purpose:

- declares reusable capability bundles

Suggested schema:

```sql
create table if not exists task_capability_profiles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  capabilities jsonb not null default '[]',
  defaults jsonb not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
```

### `task_run_steps`

Purpose:

- durable execution ledger for each run

Suggested schema:

```sql
create table if not exists task_run_steps (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references task_runs(id) on delete cascade,
  step_index int not null,
  step_kind text not null check (
    step_kind in (
      'plan',
      'tool_call',
      'artifact',
      'check',
      'approval_wait',
      'message',
      'finalize',
      'error'
    )
  ),
  status text not null default 'completed' check (
    status in ('pending', 'running', 'completed', 'failed', 'skipped')
  ),
  title text not null,
  summary text,
  payload jsonb not null default '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_run_steps_run
  on task_run_steps(task_run_id, step_index);
```

### `task_run_artifacts`

Purpose:

- normalize artifact outputs rather than burying them in one output blob

Suggested schema:

```sql
create table if not exists task_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references task_runs(id) on delete cascade,
  artifact_kind text not null check (
    artifact_kind in (
      'code_patch',
      'file',
      'image',
      'screenshot',
      'design_spec',
      'doc',
      'copy',
      'link',
      'report',
      'test_result'
    )
  ),
  label text not null,
  storage_path text,
  external_url text,
  mime_type text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_task_run_artifacts_run
  on task_run_artifacts(task_run_id, created_at desc);
```

### `task_acceptance_checks`

Purpose:

- formalize what must pass before a task can complete

Suggested schema:

```sql
create table if not exists task_acceptance_checks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  check_key text not null,
  check_kind text not null check (
    check_kind in (
      'artifact_present',
      'human_review',
      'test_pass',
      'browser_check',
      'design_handoff',
      'copy_review',
      'room_patch_review'
    )
  ),
  required boolean not null default true,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(task_id, check_key)
);
```

### `task_run_check_results`

Purpose:

- records pass/fail evidence for each run

Suggested schema:

```sql
create table if not exists task_run_check_results (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references task_runs(id) on delete cascade,
  task_acceptance_check_id uuid not null references task_acceptance_checks(id) on delete cascade,
  status text not null check (
    status in ('pending', 'passed', 'failed', 'skipped')
  ),
  summary text,
  evidence jsonb not null default '{}',
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(task_run_id, task_acceptance_check_id)
);
```

### `task_run_approvals`

Purpose:

- gates risky actions

Suggested schema:

```sql
create table if not exists task_run_approvals (
  id uuid primary key default gen_random_uuid(),
  task_run_id uuid not null references task_runs(id) on delete cascade,
  approval_kind text not null check (
    approval_kind in (
      'room_patch_apply',
      'repo_write',
      'external_publish',
      'destructive_edit',
      'high_cost_generation'
    )
  ),
  status text not null default 'pending' check (
    status in ('pending', 'approved', 'rejected', 'expired')
  ),
  title text not null,
  summary text,
  payload jsonb not null default '{}',
  requested_by uuid references profiles(id) on delete set null,
  resolved_by uuid references profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);
```

### Minimal `tasks` table additions

Add only the columns needed to bind the runtime cleanly:

```sql
alter table tasks
  add column if not exists task_type text,
  add column if not exists capability_profile_key text,
  add column if not exists execution_config jsonb not null default '{}',
  add column if not exists output_target jsonb not null default '{}';
```

## Runtime rules

### Rule 1. Every task run selects a capability profile

No task should execute as a generic “whatever the model can do” run.

If a task has no explicit profile:

- infer a default
- surface it in the UI
- allow the human to change it before execution

### Rule 2. Every run must emit step records

At minimum:

- plan
- execution
- finalize

For richer runs:

- one step per major tool call or sub-phase

### Rule 3. Every run must emit artifacts through a typed artifact channel

Do not hide deliverables only inside prose comments.

If a run produces something valuable, it should be attached as a typed artifact.

### Rule 4. Completion is check-driven

`mark_complete` in model output should become advisory.

Actual completion should depend on:

- required checks passed
- approval requirements cleared
- completion policy satisfied

### Rule 5. Risky writes need approval

Approval should be required for:

- applying room file patches
- publishing externally
- destructive or large edits
- expensive generation bursts

### Rule 6. Design tasks require at least one visual artifact

A design task should not be considered complete if it only returns a paragraph of ideas.

### Rule 7. UI tasks should prefer browser-backed validation

If the task is UI-facing and the app can run browser checks, at least one screenshot or browser evidence artifact should be attached.

## Design-capable agent stack

To make agents do design work correctly, the app needs an explicit design workbench.

### Required design inputs

- task images
- linked Figma files or frames
- existing app screenshots
- design constraints
- brand tokens
- target platform

### Required design tools

- image generation/edit
- Figma inspect/export
- screenshot capture
- annotation/spec generation
- asset packaging

### Required design outputs

- concept image or revised mock
- implementation guidance
- state/interaction notes
- asset references
- review notes

### Design task examples

#### “Make this screen feel more modern”

Should produce:

- visual draft artifact
- rationale
- token or style suggestions
- optional implementation backlog

#### “Make the feed card match the new neon look”

Should produce:

- revised component mock
- spacing/type/color notes
- implementation-ready reference images

not just:

- a descriptive paragraph

## UI changes

The main supervision surface should remain the task detail modal and related Feed task controls.

### Task setup controls

Add:

- task type selector
- capability profile selector
- output target selector
- required checks editor
- risk/approval indicator

### Run inspector

Add or expand:

- run plan summary
- step timeline
- artifact strip
- approval cards
- check results
- final recommendation state

### Artifact presentation

Artifacts should render by type:

- screenshots as image cards
- design specs as document cards
- links as preview rows
- code patches as diff/download cards
- test results as status rows

### Completion UX

The task should show:

- `ready for review`
- `blocked`
- `awaiting approval`
- `checks failed`
- `completed`

rather than only:

- `done`
- `not done`

## Recommended file ownership

### Data/runtime

- `src/hooks/useKanbanData.ts`
- `src/types/kanban.ts`
- `src/lib/agentInvocation.ts`
- `src/lib/bridgeTaskDispatcher.ts`
- new `src/lib/taskExecutionRuntime.ts`
- new `src/lib/taskCapabilityProfiles.ts`

### UI

- `src/screens/circles/tabs/FeedTab.tsx`
- `src/screens/circles/tabs/kanban/TaskDetailModal.tsx`
- new `src/screens/circles/tabs/kanban/TaskRunTimeline.tsx`
- new `src/screens/circles/tabs/kanban/TaskArtifactsPanel.tsx`
- new `src/screens/circles/tabs/kanban/TaskChecksPanel.tsx`
- new `src/screens/circles/tabs/kanban/TaskApprovalsPanel.tsx`

### Schema

- new `supabase/migrations/20260404_feed_task_execution_runtime.sql`

## PR1 scope

PR1 should be narrow and high-leverage.

### Deliver in PR1

- capability profiles with seeded defaults
- task type + profile binding on tasks
- `task_run_steps`
- `task_run_artifacts`
- `task_acceptance_checks`
- `task_run_check_results`
- `task_run_approvals`
- task detail modal updates for steps, artifacts, and checks
- one design-capable profile
- one browser-check profile
- one room-patch approval flow

### Do not deliver in PR1

- full Figma bidirectional sync
- autonomous background multi-agent swarms
- all provider bridges
- global reusable workflow marketplace
- complex branchable task graphs
- external publishing automations

## PR1 behavior examples

### Example 1. Research task

Task:

- “Audit competitor onboarding flows”

Profile:

- `research_basic`

Required artifacts:

- report
- links

Required checks:

- artifact present

No approvals required.

### Example 2. Design task

Task:

- “Refresh the Feed header to match neon login energy”

Profile:

- `ui_design`

Required artifacts:

- at least one mock
- design rationale

Required checks:

- design handoff artifact present
- human review

### Example 3. UI implementation task

Task:

- “Implement the new header and confirm mobile layout”

Profile:

- `mixed`

Capabilities:

- design inspect
- frontend build
- browser qa

Required checks:

- test pass if available
- browser check
- screenshot artifact present

### Example 4. Room update task

Task:

- “Apply approved onboarding checklist into the Ops room”

Profile:

- `room_curator`

Required behavior:

- create proposed patch artifact
- request approval
- only apply after approval

## Acceptance criteria

PR1 is successful when:

1. A Feed task can declare a task type and capability profile.
2. Running an agent on a task creates visible step records.
3. A run can emit typed artifacts that render in the task UI.
4. A task can define required acceptance checks.
5. A run cannot auto-complete the task if required checks are still failing or pending.
6. Room patch application is approval-gated.
7. A design task can produce a visible design artifact path instead of only prose output.
8. A reviewer can open one task and understand what the agent did, what it produced, and why it believes the task is complete.

## Recommended implementation order

1. Add schema for profiles, steps, artifacts, checks, and approvals.
2. Add runtime helpers for profile selection, step writes, artifact writes, and completion gating.
3. Update `useKanbanData.ts` to route execution through the runtime helper instead of only prompt parsing.
4. Expand the task detail UI to render steps, artifacts, checks, and approvals.
5. Add seeded capability profiles and task setup controls.
6. Add the first room-patch approval flow.
7. Add browser-backed validation and the first design-capable artifact flow.

## Bottom line

The Feed task system does not need a rewrite from scratch.

It needs a stronger runtime contract.

The right move is to keep the current task/run foundation and add:

- bounded capability profiles
- visible execution steps
- typed artifacts
- real acceptance checks
- approval gates
- a proper design workbench for design-oriented tasks

That is the shortest path from “agent comments on tasks” to “agents can actually complete tasks correctly.”
