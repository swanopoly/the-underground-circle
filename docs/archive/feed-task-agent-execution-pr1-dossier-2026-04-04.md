# Feed Task Agent Execution PR1 Dossier

Date: 2026-04-04
Repo: `the-underground-circle`
Audience: Claude or another implementation agent
Depends on:

- `feed-task-agent-execution-deep-audit-2026-04-04.md`
- `feed-task-agent-execution-implementation-spec-2026-04-04.md`

## Why this file exists

The prior two docs explain:

- what is wrong with the current Feed task execution model
- what the target runtime should become

This file answers the narrower implementation question:

- what should the first real pull request contain
- what SQL should be added first
- which files should change
- what acceptance criteria should block merge

The purpose of PR1 is not to ship the final autonomous task operating system.

The purpose of PR1 is to make Feed task execution inspectable, bounded, and harder to fake.

## PR1 product goal

At the end of PR1, a Feed task run should:

1. select a visible capability profile
2. record execution steps
3. emit typed artifacts
4. evaluate required checks
5. request approvals for risky actions
6. avoid auto-completing tasks on self-report alone

## Non-goals for PR1

Do not attempt these in the first implementation pass:

- full multi-agent orchestration runtime
- full Figma synchronization
- full browser automation farm
- git push or deploy automation
- generalized provider marketplace
- background swarm scheduling
- room auto-apply without review

## Current state anchors

These are the files PR1 should extend rather than replace:

- task types in [kanban.ts](/Users/cswanson/the-underground-circle/src/types/kanban.ts)
- task execution in [useKanbanData.ts](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts)
- model/provider invocation in [agentInvocation.ts](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts)
- bridge dispatch in [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)
- task supervision UI in [TaskDetailModal.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/kanban/TaskDetailModal.tsx)

The biggest current limitation in [useKanbanData.ts](/Users/cswanson/the-underground-circle/src/hooks/useKanbanData.ts) is that `runAgentOnTask(...)` creates a run record and parses a structured envelope, but still treats completion as primarily model-declared output rather than evidence-backed execution.

## Exact PR1 deliverables

### 1. New migration

Add one new migration:

- `supabase/migrations/20260404_feed_task_execution_runtime.sql`

This migration should:

- add task capability profiles
- add task run steps
- add task run artifacts
- add task acceptance checks
- add task run check results
- add task run approvals
- add minimal new task columns for task type and runtime config

### 2. New runtime library

Add:

- `src/lib/taskExecutionRuntime.ts`

This file should own:

- capability profile resolution
- step creation helpers
- artifact creation helpers
- check evaluation helpers
- approval creation helpers
- completion gating logic

Do not keep expanding `useKanbanData.ts` with all runtime details.

### 3. New profile registry

Add:

- `src/lib/taskCapabilityProfiles.ts`

This file should own:

- seeded profile definitions
- UI labels and descriptions
- profile-to-capability mapping
- guardrails around risky capabilities

### 4. Type expansion

Update:

- `src/types/kanban.ts`

This file should gain:

- `TaskType`
- `TaskCapabilityProfileKey`
- `TaskRunStep`
- `TaskRunArtifactRecord`
- `TaskAcceptanceCheck`
- `TaskRunCheckResult`
- `TaskRunApproval`

### 5. Feed execution path refactor

Update:

- `src/hooks/useKanbanData.ts`

This file should:

- infer or read a task capability profile
- create initial step records
- write typed artifacts instead of only `artifact_refs`
- gate completion using check results
- create approval rows for risky actions
- keep task comment creation, but stop using comments as the only durable output channel

### 6. Task UI upgrades

Update:

- `src/screens/circles/tabs/kanban/TaskDetailModal.tsx`

Add:

- `src/screens/circles/tabs/kanban/TaskRunTimeline.tsx`
- `src/screens/circles/tabs/kanban/TaskArtifactsPanel.tsx`
- `src/screens/circles/tabs/kanban/TaskChecksPanel.tsx`
- `src/screens/circles/tabs/kanban/TaskApprovalsPanel.tsx`

The modal should become the main review surface for:

- run plan
- steps
- artifacts
- checks
- approvals

### 7. Minimal Feed configuration UI

Update:

- `src/screens/circles/tabs/FeedTab.tsx`

PR1 should expose lightweight controls for:

- task type
- capability profile
- required checks summary
- output target summary

Full advanced task configuration can wait until later.

## Exact migration draft

The SQL below is a starting point. Claude should adjust foreign keys or profile ownership details to match local schema realities, but the shape should stay close to this.

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

alter table tasks
  add column if not exists task_type text,
  add column if not exists capability_profile_key text,
  add column if not exists execution_config jsonb not null default '{}',
  add column if not exists output_target jsonb not null default '{}';

insert into task_capability_profiles (key, label, description, capabilities, defaults)
values
  (
    'research_basic',
    'Research Basic',
    'Search, synthesize, and produce report artifacts without write-heavy powers.',
    '["search","fetch","task_attachment_read","comment_write","artifact_write"]'::jsonb,
    '{"requires_human_review":false}'::jsonb
  ),
  (
    'ui_design',
    'UI Design',
    'Generate design outputs and handoff artifacts without direct code writes.',
    '["task_image_read","image_generate","image_edit","figma_inspect","artifact_write","comment_write"]'::jsonb,
    '{"requires_visual_artifact":true,"requires_human_review":true}'::jsonb
  ),
  (
    'frontend_build',
    'Frontend Build',
    'Read code, propose patches, and produce implementation artifacts.',
    '["code_read","code_patch","static_analysis","test_run","artifact_write","comment_write"]'::jsonb,
    '{"requires_human_review":true}'::jsonb
  ),
  (
    'browser_qa',
    'Browser QA',
    'Validate UI in a browser and attach screenshots and check evidence.',
    '["browser_open","browser_navigate","browser_capture","artifact_write","comment_write"]'::jsonb,
    '{"requires_browser_evidence":true}'::jsonb
  ),
  (
    'room_curator',
    'Room Curator',
    'Prepare room-aware outputs and proposed file changes with approval before apply.',
    '["room_file_read","room_patch_propose","artifact_write","comment_write"]'::jsonb,
    '{"requires_room_approval":true}'::jsonb
  )
on conflict (key) do nothing;
```

## RLS expectations

Follow the same ownership model already used for task-adjacent tables.

At minimum:

- circle members who can access the task can read related run rows
- only authorized task actors can insert run rows
- only authorized reviewers or assignees can resolve approvals

If full RLS rollout is too much for PR1:

- add the schema first
- explicitly note the temporary policy gap
- schedule the policy hardening immediately after

## Exact file-by-file patch plan

### `src/types/kanban.ts`

Add:

- `TaskType`
- `TaskCapabilityProfileKey`
- `TaskRunStepKind`
- `TaskRunStepStatus`
- `TaskArtifactKind`
- `TaskAcceptanceCheckKind`
- `TaskApprovalKind`

Extend:

- `KanbanTask`
- `TaskRun`

Suggested additions:

```ts
export type TaskType =
  | 'code_change'
  | 'design_work'
  | 'ui_qa'
  | 'research'
  | 'content'
  | 'ops'
  | 'room_update'
  | 'mixed';

export type TaskCapabilityProfileKey =
  | 'research_basic'
  | 'content_editorial'
  | 'ui_design'
  | 'frontend_build'
  | 'browser_qa'
  | 'room_curator'
  | 'mixed';
```

Extend `KanbanTask` with:

- `task_type?: TaskType | null`
- `capability_profile_key?: TaskCapabilityProfileKey | null`
- `execution_config?: Record<string, any> | null`
- `output_target?: Record<string, any> | null`
- `acceptance_checks?: TaskAcceptanceCheck[]`

Extend `TaskRun` with:

- `steps?: TaskRunStep[]`
- `artifacts_v2?: TaskRunArtifactRecord[]`
- `check_results?: TaskRunCheckResult[]`
- `approvals?: TaskRunApproval[]`

### `src/lib/taskCapabilityProfiles.ts`

Create a typed registry like:

```ts
export interface TaskCapabilityProfile {
  key: TaskCapabilityProfileKey;
  label: string;
  description: string;
  capabilities: string[];
  defaults: {
    requires_human_review?: boolean;
    requires_visual_artifact?: boolean;
    requires_browser_evidence?: boolean;
    requires_room_approval?: boolean;
  };
}
```

Export:

- `TASK_CAPABILITY_PROFILES`
- `getTaskCapabilityProfile(key)`
- `inferTaskCapabilityProfile(task)`
- `profileRequiresApproval(profile, task)`

### `src/lib/taskExecutionRuntime.ts`

Create helpers:

- `createInitialTaskRunSteps(...)`
- `appendTaskRunStep(...)`
- `createTaskRunArtifact(...)`
- `createTaskRunApproval(...)`
- `ensureTaskAcceptanceChecks(...)`
- `evaluateTaskRunChecks(...)`
- `canTaskRunMarkComplete(...)`
- `deriveTaskRunSummary(...)`

This file should contain the main gating rule:

- `mark_complete` from model output is advisory
- final task status only advances if checks and approvals permit it

### `src/hooks/useKanbanData.ts`

Refactor `runAgentOnTask(...)` in-place rather than splitting the whole hook in PR1.

Concrete changes:

1. Resolve task profile before building the prompt.
2. Write an initial `plan` step immediately after creating the run.
3. Include allowed capability summary in the prompt contract.
4. After invocation, create step records for:
   - plan
   - execution
   - artifact extraction
   - check evaluation
   - finalize
5. Convert extracted attachments into `task_run_artifacts`.
6. Create default acceptance checks if the task has none and the profile demands them.
7. If a room patch or risky action is proposed, create an approval row and block auto-complete.
8. Only mark the task complete when `canTaskRunMarkComplete(...)` returns true.

PR1 should keep:

- comment insertion
- XP award on actual completion
- current assignment status updates

But those should happen after the new completion gate decides the result.

### `src/screens/circles/tabs/kanban/TaskDetailModal.tsx`

Add four new panels:

- run timeline
- artifacts
- checks
- approvals

Minimum UI outcome:

- reviewer can see whether the run actually produced something
- reviewer can see whether checks passed
- reviewer can see whether anything is waiting on approval

### `src/screens/circles/tabs/kanban/TaskRunTimeline.tsx`

Render:

- step kind
- title
- status
- summary
- timestamps

### `src/screens/circles/tabs/kanban/TaskArtifactsPanel.tsx`

Render by type:

- screenshot/image preview cards
- link rows
- doc/report tiles
- code/file attachments

### `src/screens/circles/tabs/kanban/TaskChecksPanel.tsx`

Render:

- check name
- required/optional
- pass/fail/pending state
- evidence summary

### `src/screens/circles/tabs/kanban/TaskApprovalsPanel.tsx`

Render:

- approval title
- approval kind
- pending/approved/rejected state
- approval summary

PR1 can show read-only cards if resolution actions are not ready on day one.

### `src/screens/circles/tabs/FeedTab.tsx`

Add lightweight labels or pills for:

- task type
- capability profile
- pending approvals
- failed checks

Do not overbuild the board UI in PR1.

The detail modal should carry most of the complexity.

## Prompt contract changes for PR1

The Feed task prompt should stop pretending the model can do everything.

Add to the prompt:

- task type
- capability profile
- allowed capabilities
- required artifacts
- required checks
- note that risky writes require approval

Recommended contract addition:

```text
=== TASK RUNTIME ===
Task type: ui_design
Capability profile: ui_design
Allowed capabilities: task_image_read, image_generate, image_edit, figma_inspect, artifact_write, comment_write
Required artifacts: at least one visual artifact, rationale
Required checks: design_handoff, human_review
Approval rule: if you propose room writes, external publish, or high-cost generation, mark it as approval-required
```

The model should still return structured JSON, but PR1 should no longer trust the JSON envelope as the sole source of truth.

## Seeded default profile mapping

PR1 should infer a profile when none is explicitly set.

Suggested heuristics:

- description contains `mock`, `redesign`, `visual`, `landing page`, `figma`: `ui_design`
- description contains `bug`, `component`, `refactor`, `implement`, `screen`: `frontend_build`
- description contains `test`, `verify`, `responsive`, `regression`, `qa`: `browser_qa`
- description contains `research`, `analyze`, `audit`, `compare`: `research_basic`
- description contains `room`, `knowledge base`, `doc`, `organize`: `room_curator`
- fallback: `research_basic`

Keep these heuristics in one place in `taskCapabilityProfiles.ts`.

## First PR acceptance criteria

PR1 is mergeable when all of the following are true:

1. A task run records at least `plan`, `execution`, and `finalize` steps.
2. Typed artifacts are written for extracted code files, links, docs, or images.
3. A design-profile task cannot auto-complete without at least one design artifact.
4. A browser-QA task cannot auto-complete without a browser evidence artifact or an explicit failed check.
5. A room-curator task can create a proposed change but cannot apply it without an approval row.
6. `TaskDetailModal` shows steps, artifacts, checks, and approvals for a run.
7. `runAgentOnTask(...)` no longer treats `mark_complete=true` as sufficient by itself.
8. Existing basic task comments still work and nothing regresses for non-agent task viewing.

## Recommended implementation order

1. Add migration and type updates.
2. Add profile registry and runtime helper library.
3. Refactor `useKanbanData.ts` execution flow onto the new runtime helpers.
4. Add new task detail UI panels.
5. Add lightweight Feed board indicators.
6. Seed default profiles and acceptance checks.
7. Verify one design task, one research task, and one room-curator task end-to-end.

## Verification checklist for Claude

Before calling PR1 done, Claude should manually verify:

- a plain research task still runs and produces a comment
- a design task produces a typed artifact record
- a room-targeted task generates an approval item instead of auto-applying
- a task with failed or missing checks remains in review/in-progress rather than going straight to done
- the task detail modal remains readable on both desktop and mobile widths

## Bottom line

The shortest successful PR1 is not a giant agent rewrite.

It is a runtime hardening pass on Feed tasks:

- explicit profiles
- visible steps
- real artifacts
- check-based completion
- approval-gated risky actions

That is enough to make Feed tasks meaningfully more trustworthy and much easier to extend in later PRs.
