# Automation And Cron Master Audit

## Direct Answer

Yes: the `Cron Jobs` tab in the Pixel Agent Panel currently needs a OpenSwan connection.

Reason:
- that tab reads scheduler state from the OpenSwan/OpenSwan gateway through `src/lib/openswanService.ts`
- it does not read from the app-native `circle_automations` tables

So today:
- `Cron Jobs` tab = OpenSwan-backed scheduler UI
- `Automations` = app-native Supabase-backed automation system

They are related, but they are not the same system.

## Findings

### 1. The product currently has split-brain automation

There are two independent automation stacks:

1. `OpenSwan` gateway cron
   - external runtime
   - external session model
   - external scheduler
   - external run/task ownership

2. `Circle Automations`
   - Supabase tables
   - `pg_cron` polling
   - `automation-executor` edge function
   - `automation_runs` history

This is the single biggest architecture issue.

Relevant files:
- `src/lib/openswanService.ts`
- `src/services/automationService.ts`
- `supabase/migrations/20260313_circle_automations.sql`
- `supabase/functions/automation-executor/index.ts`

### 2. OpenSwan cron is richer than the app-native scheduler

OpenSwan/OpenSwan cron supports:
- `at`
- `every`
- full cron expressions
- `main`, `isolated`, `current`, and `session:<id>` execution styles
- wake behavior
- delivery behavior
- scheduler-owned run history
- retry policy and maintenance behavior

The app-native scheduler mostly supports:
- preset schedule labels
- event triggers
- manual triggers
- a polling due-run mechanism

That means the app-native system is not yet “better than OpenSwan.” It is simpler and narrower.

Sources:
- https://docs.openswan.ai/automation/index
- https://docs.openswan.ai/automation/cron-jobs

### 3. The app-native scheduler had real lifecycle gaps

Before this pass:
- editing a scheduled automation could leave `next_run_at` stale
- re-enabling a scheduled automation could leave it without a fresh next run
- some real cron-looking strings could produce fake next-run timestamps in the UI

Relevant file:
- `src/services/automationService.ts`

Changes made:
- `updateAutomation()` now recomputes `next_run_at` when `cronExpression` changes
- `toggleAutomation()` now clears `next_run_at` when disabled and recomputes it when re-enabled
- `computeNextRun()` now returns `null` instead of fabricating timestamps for real cron expressions the app cannot actually calculate

### 4. OpenSwan cron support was under-rendering gateway data

The app was throwing away useful cron metadata that the gateway may already provide.

Relevant files:
- `src/lib/openswanService.ts`
- `src/screens/circles/tabs/office/AgentPanel.tsx`
- `src/screens/circles/tabs/office/OfficeChat.tsx`

Changes made:
- normalized cron job payloads
- preserved:
  - `status`
  - `timezone`
  - `runCount`
  - `sessionTarget`
  - `lastRun`
  - `nextRun`
- rendered more of that data in the Pixel Agent panel and Office chat

### 5. The UI naming is still misleading

Right now a user can reasonably assume:
- `Cron Jobs` in Pixel Agent Panel
- `Automations` elsewhere in the app

are two faces of the same thing.

They are not.

Best product wording:
- `OpenSwan Jobs` or `Gateway Jobs` for external scheduler jobs
- `Circle Automations` for app-native automations

### 6. App-native trigger modeling is still not fully clean

The frontend trigger types include `webhook`, but persisted SQL trigger types are centered around:
- `schedule`
- `event`
- `manual`

The current UI partially maps webhook-style choices into event-style persistence, which works, but it is not a clean mental model.

## What Would Make It Better Than OpenSwan

To beat OpenSwan, Underground Circle should not try to clone one scheduler. It should combine:

### A. Better product structure

- one clear user-facing automation map
- one glossary for:
  - schedules
  - events
  - wakeups
  - session modes
  - delivery

### B. Better observability

For every job, show:
- source system
- next run
- last run
- current state
- retries
- failure reason
- output destination
- linked session/run/task

### C. Better orchestration

OpenSwan is strong on runtime scheduling.
Underground Circle can be better by adding:
- circle-aware app context
- task linkage
- artifact linkage
- approval linkage
- Feed/Rooms/Office visibility
- memory-aware recurring work

### D. Better cross-surface execution

Best target model:
- `OpenSwan` owns portable runtime scheduling
- `Circle Automations` own app-native business/workflow automations
- both write into one shared run ledger and one shared automation dashboard

That would be better than OpenSwan because OpenSwan is primarily runtime-first, while Underground Circle can be runtime + collaboration + task + artifact + social context together.

## Recommended Implementation Plan

### PR1

- rename labels to make the split explicit
- add `source` badges wherever jobs/automations are shown
- add shared automation overview card:
  - `OpenSwan Jobs`
  - `Circle Automations`
  - recent runs from both

### PR2

- add OpenSwan run history support in the panel
- add schedule-type support for:
  - `at`
  - `every`
  - `cron`
- add timezone and delivery fields in the create/edit UI

### PR3

- introduce shared `automation_runs_unified` view or adapter layer
- unify Feed / Office / Rooms visibility of scheduled work
- attach automation outputs to artifacts/tasks where applicable

### PR4

- add approvals, failure destinations, retry visibility, and maintenance status
- add scheduler health dashboard:
  - gateway health
  - Supabase cron health
  - last successful tick
  - last failed run

## Changes Made In This Pass

Code:
- `src/services/automationService.ts`
- `src/lib/openswanService.ts`
- `src/screens/circles/tabs/office/AgentPanel.tsx`
- `src/screens/circles/tabs/office/OfficeChat.tsx`

Docs:
- `docs/page-audits/cron-jobs-and-openswan-deep-audit-2026-04-08.md`
- this file

## Bottom Line

The current implementation is useful, but it is not yet the best it can be.

Right now:
- OpenSwan cron is more capable
- app-native automations are more circle-aware
- the app is strongest where those two ideas meet

The path to being better than OpenSwan is not replacing OpenSwan.
It is making scheduler work first-class across the whole product, with better context, better run visibility, and one clear orchestration story.
