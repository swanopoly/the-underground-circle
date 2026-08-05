-- ─── agent_run_events FK repair ─────────────────────────────────────────────
-- APPLIED LIVE 2026-07-31 (Management API). Recorded here so local and remote
-- schemas stay in sync.
--
-- Root cause of the "client loop dies → v1 fallback → toolless model" failure
-- chain: production predated 20260408_unified_agent_runs, and
-- agent_run_events.run_id still foreign-keyed the LEGACY circle_agent_runs
-- table (0 rows) instead of agent_runs. Every event insert violated the FK
-- (PostgREST 409), the typed client loop's persistence contract failed, and
-- every desktop-tool chat task silently degraded to the legacy edge lane with
-- no desktop tools. agent_run_events had ZERO rows ever — the constraint made
-- the table unwritable from day one, so re-pointing validates trivially.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'agent_run_events_run_id_fkey'
      and confrelid = 'public.circle_agent_runs'::regclass
  ) then
    alter table public.agent_run_events
      drop constraint agent_run_events_run_id_fkey;
    alter table public.agent_run_events
      add constraint agent_run_events_run_id_fkey
      foreign key (run_id) references public.agent_runs(id) on delete cascade;
  end if;
end $$;
