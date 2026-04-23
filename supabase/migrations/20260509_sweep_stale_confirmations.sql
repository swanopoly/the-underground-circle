-- CA-8e server-side completion: sweeper for stale computer_use_confirmations.
--
-- The in-run poller in `supabase/functions/computer-use-agent/index.ts`
-- auto-resolves its own confirmation on the 120s deadline — but if the
-- run process dies mid-poll (edge fn timeout, server restart, client
-- disconnect before the deadline) the row can stay `resolved_at IS NULL`
-- forever. Those zombies clog the HITL queue and break the UI's
-- pending-approvals count.
--
-- Fix: pg_cron job every 5 min that marks any confirmation older than
-- 15 min with `choice: '__expired__'`. 15 min >> the 120s in-run
-- timeout so this NEVER races with a live poller; only catches orphans.
--
-- Why `__expired__` and not `__timeout__`:
--   - `__timeout__` = the in-run poller gave up after the user's
--     configured timeout (usually 120s). Semantic: "user was
--     presented with the card but didn't pick in time."
--   - `__expired__` = the sweeper reaped an orphan. Semantic: "nobody
--     was watching; likely the run died." Distinguishing the two lets
--     the telemetry dashboard count dead runs separately.

create extension if not exists pg_cron;

create or replace function sweep_stale_computer_use_confirmations()
returns void language plpgsql security definer as $$
begin
  update computer_use_confirmations
  set
    choice = '__expired__',
    resolved_at = now()
  where
    resolved_at is null
    and created_at < now() - interval '15 minutes';
end;
$$;

-- 5-minute schedule. Idempotent — re-running `select cron.schedule(...)`
-- with the same name + cmd replaces the previous entry rather than
-- stacking it.
select cron.schedule(
  'sweep-stale-computer-use-confirmations',
  '*/5 * * * *',
  $$select sweep_stale_computer_use_confirmations()$$
);

-- Grant service role execute so the edge fn can invoke it on-demand
-- too (when polling times out without the cron having caught it yet).
grant execute on function sweep_stale_computer_use_confirmations() to postgres;
grant execute on function sweep_stale_computer_use_confirmations() to service_role;

-- Index for the sweeper's WHERE clause. Partial + cheap — only
-- unresolved rows touch the index.
create index if not exists idx_computer_use_confirmations_unresolved_old
  on computer_use_confirmations (created_at)
  where resolved_at is null;
