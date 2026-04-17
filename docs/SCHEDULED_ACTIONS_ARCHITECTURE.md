# Scheduled Actions — Architecture

> Unified queue for every "do this now or later" the app runs.
> Last updated: 2026-04-15

## What it is

A single table (`scheduled_actions`) + single edge function
(`scheduled-action-runner`) + one pg_cron tick that together give every
connector in the app the same execution lane. Instead of each connector
building its own scheduling/retry/approval logic, they all put a row in
`scheduled_actions` and the runner handles the rest.

## Why it exists

Before this, only WordPress had scheduling — using WP's native
`status: 'future'` — and nothing else had a cron. Bluesky, Gmail, X,
LinkedIn, Slack, webhooks, reminders, etc. all needed their own schedulers
eventually. The primitive collapses that sprawl.

## Schema

```sql
create table scheduled_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  circle_id uuid references circles(id) on delete set null,
  kind text not null check (kind in (
    'wp_post','bluesky_post','tweet','linkedin_post',
    'gmail_send','gmail_draft','outlook_send','slack_post',
    'webhook','reminder'
  )),
  status text not null default 'pending' check (status in (
    'pending','running','succeeded','failed','canceled'
  )),
  payload jsonb not null default '{}'::jsonb,
  scheduled_for timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  error text,
  retry_count int not null default 0,
  max_retries int not null default 3,
  requires_approval boolean not null default false,
  approval_id uuid references agent_approvals(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

Migration files:

- `supabase/migrations/20260414_scheduled_actions.sql`
- `supabase/migrations/20260414_scheduled_actions_cron.sql`

RLS: owner-only for insert / update / delete; read also allows circle
members via the `user_is_circle_member()` helper from the chat-threads
migration.

## Runner

`supabase/functions/scheduled-action-runner/index.ts`

- Claims due rows atomically (`pending → running` guard prevents race between two cron ticks)
- Per-kind dispatcher. Real executors today: `webhook`, `bluesky_post`, `reminder`, `gmail_send`. Skeletons for: `wp_post`, `tweet`, `linkedin_post`, `gmail_draft`, `outlook_send`, `slack_post`.
- Per-action 20s timeout
- Exponential backoff: 15s × 2ⁿ, capped at 30 min
- HITL gate: `requires_approval=true` creates an `agent_approvals` row and parks the action until approved/rejected
- Summary JSON returned per invocation: `{claimed, succeeded, failed, skipped}`

## Cron

pg_cron + pg_net. Service-role key lives in Supabase Vault as
`scheduled_actions_service_key`. Every minute:

```
select tick_scheduled_actions();
```

which POSTs to the edge function with the service-role key in the
`Authorization` header.

## Client library

`src/lib/scheduledActions.ts`

```ts
scheduleAction({ kind, payload, circleId?, scheduledFor?, requiresApproval?, maxRetries? })
listScheduledActions({ circleId?, statuses?, limit? })
cancelAction(id)
retryAction(id, scheduledFor?)
deleteAction(id)
usePendingActions(circleId?)        // realtime-subscribed React hook
describeAction(action) / kindLabel(kind)
```

Per-kind payload interfaces exported: `BlueskyPostPayload`, `TweetPayload`,
`LinkedInPostPayload`, `GmailSendPayload`, `GmailDraftPayload`,
`SlackPostPayload`, `WebhookPayload`, `ReminderPayload`.

## UI component

`src/components/PendingActionsOutbox.tsx` — drop-in **Outbox** showing
Failed → Running → Queued with cancel/retry buttons and relative times.

Embed wherever visibility matters (Office header, Chat sidebar, a
dedicated Outbox tab). Default `maxHeight={320}` with scroll.

## Adding a new connector

1. Add the kind to the DB `CHECK` constraint (new migration)
2. Add the kind to the `ScheduledActionKind` union in `src/lib/scheduledActions.ts` + payload interface
3. Add an executor function in `scheduled-action-runner/index.ts` and register it in `EXECUTORS`
4. Deploy the edge function: `npx supabase functions deploy scheduled-action-runner`
5. (Optional) Add a chat slash command that calls `scheduleAction()` with the new kind

## HITL approvals

Any action with `requires_approval: true` at insert time is held until its
`agent_approvals` row flips to `approved` or `rejected`. This piggybacks
on the existing HITL infrastructure used by the Office kill switch — same
table, same realtime subscription.

## Integration with other primitives

- **Chat Live Builder** → "Publish" / "Schedule" buttons call `scheduleAction({ kind: 'wp_post', … })`
- **Skills** (roadmap) → `wp-publisher`, `social-scheduler`, `email-automator` become thin Skills that wrap `scheduleAction()`
- **Agent Approvals** → natural backpressure for destructive actions
- **Computer Use toggle** → shell commands can be queued as a new kind
- **Missions** → a mission completion can trigger a celebratory tweet / WP post via this queue

## Not-yet-wired kinds

`wp_post`, `tweet`, `linkedin_post`, `gmail_draft`, `outlook_send`,
`slack_post` have executor skeletons that return
`${kind} executor not implemented yet — coming soon`. Adding a real
executor is one function + one deploy.
