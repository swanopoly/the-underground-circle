-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 2: Agent presence sweeper using pg_cron
--
-- Problem: Dirty disconnects (WiFi drops, laptop slams shut, browser crash)
-- don't always trigger a clean WebSocket 'leave' event. Agents can get stuck
-- in 'idle' status even after the owner has been gone for hours.
--
-- Solution: A server-side cron job runs every 2 minutes and marks any agent
-- offline if its last_active_at is older than 3 minutes.
--
-- This is Belt + Suspenders on top of the client-side heartbeat:
--   Client heartbeat (30s)   → keeps last_active_at fresh
--   Supabase Presence (25s)  → ephemeral live indicator
--   This sweeper (2 min)     → catches any that slipped through
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pg_cron extension (free on Supabase)
create extension if not exists pg_cron;

-- The sweeper function
create or replace function sweep_offline_agents()
returns void
language plpgsql
security definer
as $$
begin
  update circle_office_agents
  set
    status = 'offline',
    updated_at = now()
  where
    status in ('idle', 'building')           -- only touch active agents
    and last_active_at is not null           -- has connected at least once
    and last_active_at < now() - interval '3 minutes'  -- no ping in 3 min
    and is_published = true;
end;
$$;

-- Schedule: run every 2 minutes
-- Runs slightly ahead of the 3-min threshold to catch stragglers
select cron.schedule(
  'sweep-offline-agents',   -- job name (unique)
  '*/2 * * * *',            -- every 2 minutes
  'select sweep_offline_agents()'
);

-- Also add an index on last_active_at for fast sweeper queries
create index if not exists idx_circle_office_agents_last_active
  on circle_office_agents (last_active_at)
  where is_published = true;

-- Grant execute to the cron job user
grant execute on function sweep_offline_agents() to postgres;
