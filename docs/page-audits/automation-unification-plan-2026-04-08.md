# Automation Unification Plan

## Goal

Fix the split-brain automation story so `Circle Automations` and `OpenSwan Jobs` feel like one coherent product without forcing them into one runtime prematurely.

The correct target is:

- one user-facing automation system
- two execution backends
- one shared dashboard
- one shared run/history model
- one shared vocabulary

## Core Product Decision

Do not merge the runtimes first.

Merge the product model first.

That means:

### User-facing concept

Everything the user creates is an `Automation`.

Each automation has:
- a trigger
- an execution backend
- a destination
- a run history
- a health state

### Backend choices

Execution backend can be:
- `circle_native`
- `openswan`

The user should not have to understand the entire implementation difference before creating the automation.

## Target Product Model

### One automation object

Add a shared top-level automation descriptor that can represent either backend:

- `id`
- `circle_id`
- `source_backend`
- `display_name`
- `description`
- `trigger_kind`
- `trigger_summary`
- `execution_mode`
- `output_target`
- `enabled`
- `health_status`
- `last_run_at`
- `next_run_at`
- `run_count`
- `last_error`
- `linked_native_automation_id`
- `linked_openswan_job_id`

Important:
- this is a product-facing registry
- it is not required to replace `circle_automations` or OpenSwan storage immediately

### One run model

Add a unified run adapter/view that normalizes:

- native `automation_runs`
- OpenSwan cron run history

Every rendered run in the app should expose:
- `automation_ref_id`
- `source_backend`
- `status`
- `started_at`
- `completed_at`
- `duration_ms`
- `estimated_cost`
- `output_summary`
- `error_message`
- `linked_task_id`
- `linked_agent_run_id`

## User Experience Plan

### 1. Replace “Automations” vs “Cron Jobs” with one automation home

Create a single dashboard section:
- `Automation Center`

Inside it:
- `All`
- `Needs Attention`
- `Scheduled`
- `Event-driven`
- `Manual`
- `OpenSwan`
- `Circle Native`

Do not make the first split be by backend.
Make the first split be by user intent and job state.

### 2. Move backend disclosure down one level

On each automation card:
- show source badge
  - `Circle Native`
  - `OpenSwan`

But do not force backend choice as the first interaction unless needed.

### 3. Introduce a better creation flow

Step 1: What should this automation do?
- summarize
- monitor
- alert
- report
- route
- run an agent task

Step 2: What triggers it?
- schedule
- event
- manual
- webhook

Step 3: Where should it run?
- `Recommended backend`
- allow advanced override

Backend recommendation rules:
- choose `circle_native` for app-context workflows
- choose `openswan` for portable runtime/session-heavy jobs

### 4. Add a “Needs Attention” surface

This should combine both systems and show:
- failed recently
- stale next run
- disabled with prior activity
- repeated retries
- no successful run yet

This becomes the operator’s default view.

## Backend Responsibility Split

### Circle Native should own

- circle/member/check-in/task analytics automations
- app event automations
- feed/task-linked automations
- goal-linked automations
- notifications tightly tied to app data

### OpenSwan should own

- portable scheduled agent work
- session-aware recurring jobs
- jobs needing isolated runtime behavior
- jobs with richer session modes or runtime delivery behavior
- externalized gateway scheduling and long-lived runtime ownership

## Data Migration Strategy

### Phase 1: Add registry, do not migrate execution yet

Create:
- `automation_registry`

When a native automation is created:
- create native row
- create registry row pointing to it

When a OpenSwan job is discovered or created from the app:
- create/update registry row pointing to the OpenSwan job id

### Phase 2: Add unified run adapter

Create either:
- `automation_runs_unified` database view for native + synced OpenSwan records

or:
- app-layer adapter function that maps both into one UI shape

The UI should stop caring which backend produced the run.

### Phase 3: Add OpenSwan sync

Persist lightweight synced metadata for OpenSwan jobs:
- schedule
- status
- next run
- last run
- session target
- timezone

This lets the app:
- render jobs faster
- compare them with native automations
- support search/filter across both

## UI Implementation Plan

### PR1

- rename the current dashboard section to `Automation Center`
- add source badges to cards
- add segmented filters:
  - all
  - needs attention
  - scheduled
  - event-driven
  - native
  - openswan
- add backend explanation copy in create/edit flows

### PR2

- add `automation_registry`
- add mapping layer for unified cards
- add unified list rendering
- keep existing native panel and OpenSwan panel as subviews behind the unified layer

### PR3

- add unified run history
- show native + OpenSwan runs in one timeline
- attach run outputs and failures to one shared card model

### PR4

- make create flow backend-aware with recommendations
- create OpenSwan jobs from the same creation wizard
- add richer OpenSwan editing:
  - `at`
  - `every`
  - `cron`
  - `tz`
  - session target
  - delivery mode

### PR5

- add scheduler health center
- add approvals / retry visibility / failure routing
- add linked task/artifact visibility from both systems

## Required Vocabulary Cleanup

Standardize these terms everywhere:

- `Automation`: user-facing umbrella concept
- `Circle Native`: app-native execution backend
- `OpenSwan`: gateway execution backend
- `Run`: any execution instance
- `Trigger`: why it fired
- `Destination`: where output goes

Avoid:
- using `Cron Jobs` as the primary product label
- mixing `automation`, `cron`, `job`, and `task` without distinction

## Risks

### Risk 1: Fake unification

If you only rename labels without adding shared registry/run modeling, the confusion remains.

### Risk 2: Over-merging too early

If you try to force both systems into one runtime immediately, you will create regressions.

### Risk 3: Backend-first UX

If users have to choose `OpenSwan vs Circle Native` first, the product will still feel fragmented.

## Best Sequence

The best order is:

1. unify product language
2. unify dashboard and list surfaces
3. unify run/history representation
4. improve create/edit flows
5. deepen backend capabilities

That is the fastest path to one coherent automation story without destabilizing the existing runtime pieces.
