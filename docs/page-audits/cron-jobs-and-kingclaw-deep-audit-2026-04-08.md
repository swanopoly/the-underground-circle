# Cron Jobs And KingClaw Deep Audit

## Findings

### 1. The app currently has two different scheduler products, not one

There are two cron/automation systems in the codebase:

- app-native circle automations using `circle_automations`, `automation_runs`, `pg_cron`, and the `automation-executor` edge function
- KingClaw/OpenClaw cron jobs exposed through the Office dashboard

These are not equivalent systems and they do not share a runtime, run ledger, delivery model, or scheduling vocabulary.

Relevant files:
- `src/services/automationService.ts`
- `supabase/migrations/20260313_circle_automations.sql`
- `supabase/functions/automation-executor/index.ts`
- `src/lib/openclawService.ts`
- `src/screens/circles/tabs/office/AgentPanel.tsx`

Why this matters:
- users can believe “Cron Jobs” and “Automations” are the same thing when they are not
- app-native schedule behavior does not match KingClaw/OpenClaw semantics
- observability is split across `automation_runs` vs KingClaw gateway state

### 2. App-native scheduled automations are not OpenClaw-like

The app-native scheduler is much simpler than OpenClaw:

- it stores `cron_expression`, but runtime scheduling is really built around a few shorthand values like `hourly`, `daily`, `weekly`, and `monthly`
- it uses a database job to poll due rows by `next_run_at`
- it has no first-class support for:
  - one-shot `at`
  - fixed `every`
  - heartbeat-vs-cron distinction
  - wake mode
  - custom session IDs
  - delivery policies like `announce`, `webhook`, `none`
  - per-job tool restrictions
  - per-job model/thinking override parity
  - run-history parity with a scheduler-owned task ledger

Relevant files:
- `src/services/automationService.ts`
- `supabase/migrations/20260313_circle_automations.sql`

### 3. There was a misleading next-run bug in the app-native scheduler

`computeNextRun()` previously returned a fake “tomorrow” value for unknown schedule strings. If a real cron expression got passed in, the UI could show a wrong `next_run_at`.

Relevant file:
- `src/services/automationService.ts`

Change made:
- real cron-looking expressions now return `null` instead of a fabricated next-run timestamp

This is a correctness fix, not full cron support.

### 4. KingClaw cron support in the app was too lossy

The KingClaw/OpenClaw adapter mostly treated cron jobs as `id + name + enabled`, even though OpenClaw supports richer fields like schedule kind/expression, session style, timezone, run history, and delivery behavior.

Relevant files:
- `src/lib/openclawService.ts`
- `src/screens/circles/tabs/office/AgentPanel.tsx`
- `src/screens/circles/tabs/office/OfficeChat.tsx`

Changes made:
- normalized KingClaw cron payloads across common field aliases
- preserved additional metadata where present:
  - `status`
  - `timezone`
  - `runCount`
  - `nextRun`
  - `lastRun`
  - `sessionTarget`
- improved Office panel rendering so those fields show when available
- improved Office chat cron listing so schedule and next-run data are visible

### 5. Trigger vocabulary is inconsistent in the app-native automation layer

TypeScript allows `webhook` as a `TriggerType`, but the SQL schema for `circle_automations.trigger_type` only allows:

- `schedule`
- `event`
- `manual`

Relevant files:
- `src/services/automationService.ts`
- `supabase/migrations/20260313_circle_automations.sql`

Impact:
- the frontend type system advertises a mode that the persisted schema does not support cleanly

### 6. The app-native scheduler has weaker reliability semantics than OpenClaw

OpenClaw cron is scheduler-owned and documented as:

- persistent across restarts
- creating background task records for all executions
- aware of main vs isolated vs current vs custom sessions
- able to own final delivery
- able to maintain isolated-run cleanup and retry policy

The Underground Circle app-native scheduler currently:

- polls due rows in SQL
- fires the edge function asynchronously
- increments `run_count` and advances `next_run_at` optimistically
- relies on the edge function for most execution logic

Relevant files:
- `supabase/migrations/20260313_circle_automations.sql`
- `supabase/functions/automation-executor/index.ts`

Main gap:
- app-native scheduling is closer to a lightweight polling automation table than a true scheduler/runtime product

### 7. KingClaw UI coverage is still partial compared with OpenClaw

Current app support covers:

- list jobs
- create recurring cron jobs
- run now
- enable/disable
- delete

Missing versus OpenClaw docs:

- one-shot `at` jobs
- `every` interval jobs
- explicit `tz`
- `wake now` vs `next-heartbeat`
- main/current/custom session choices beyond a shallow field
- delivery mode configuration
- failure destination
- job edit beyond enable/disable
- run history (`cron runs`)
- cron status / troubleshooting views
- retry policy visibility
- scheduler config visibility

Relevant files:
- `src/lib/openclawService.ts`
- `src/screens/circles/tabs/office/AgentPanel.tsx`
- `src/screens/circles/tabs/office/OfficeChat.tsx`

## What OpenClaw Does Better

From the current OpenClaw docs, cron is not just “run something later.” It is a scheduler product with:

- precise schedule types: `at`, `every`, and full `cron`
- explicit session execution styles: `main`, `isolated`, `current`, `session:<id>`
- wake behavior for main-session jobs
- delivery modes owned by the runner
- task/run ledger expectations
- retry and maintenance policies
- dedicated troubleshooting commands and status surfaces

Sources:
- https://docs.openclaw.ai/automation/index
- https://docs.openclaw.ai/automation/cron-jobs

## Best Plan For Underground Circle

### A. Keep the two systems distinct unless you unify them properly

Do not keep pretending app-native automations and KingClaw cron are interchangeable.

Recommended product split:
- `KingClaw Cron`: external gateway scheduler for portable agent runtime jobs
- `Circle Automations`: app-native product automations tied to circle data and app workflows

If you want them to converge later, unify them deliberately around:
- one run ledger
- one schedule vocabulary
- one delivery model
- one troubleshooting surface

### B. Make KingClaw cron feel like OpenClaw

Highest-value next features:

1. Add `cron runs` history in the Agent Panel.
2. Add schedule type support:
   - `cron`
   - `every`
   - `at`
3. Add timezone and wake-mode controls.
4. Add delivery mode controls:
   - `announce`
   - `webhook`
   - `none`
5. Add session-style controls:
   - `main`
   - `isolated`
   - `current`
   - `session:<id>`
6. Add explicit edit support instead of only enable/disable.
7. Add a `Cron Status` panel with:
   - gateway running state
   - last scheduler tick
   - last failed run
   - retry state

### C. Make app-native automations honest about their scope

If the app-native scheduler remains separate:

1. Rename UI copy to `Circle Automations`, not generic cron language.
2. Treat current schedule values as app presets, not full cron parity.
3. Add a real cron parser only if you actually want full cron support there.
4. Align `TriggerType` with the SQL schema.
5. Stop mixing OpenClaw scheduling expectations into app-native automation messaging.

## Changes Made In This Pass

Code improvements landed:

- normalized KingClaw cron job payloads in `src/lib/openclawService.ts`
- surfaced more KingClaw cron metadata in `src/screens/circles/tabs/office/AgentPanel.tsx`
- improved cron listing output in `src/screens/circles/tabs/office/OfficeChat.tsx`
- fixed fake next-run computation for real cron strings in `src/services/automationService.ts`

## Open Questions

1. Is the long-term source of truth for scheduled agent work supposed to be KingClaw/OpenClaw or Supabase-native `circle_automations`?
2. Should app-native scheduled work create `agent_runs` records, `automation_runs` records, or both?
3. Do you want Circle users configuring scheduler semantics directly, or should KingClaw remain an advanced Office/runtime layer?
