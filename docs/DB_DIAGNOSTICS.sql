-- ═════════════════════════════════════════════════════════════════════════════
-- UC — Read-only diagnostics for the circle_office_agents 502 and other
-- unknown state. Paste into Supabase SQL Editor. Nothing here mutates.
-- ═════════════════════════════════════════════════════════════════════════════

-- [1] circle_office_agents — column inventory
--     Confirms whether `provider`, `gateway_url`, `is_public`, `spirit`,
--     `spirit_emoji`, and the analytics columns from 20260226_office_terminal
--     are all present. If any upsert column is missing, the upsert would 400;
--     if all are present, the 502 is downstream (RLS, triggers, publication).
select column_name, data_type, is_nullable, column_default
from   information_schema.columns
where  table_schema = 'public' and table_name = 'circle_office_agents'
order  by ordinal_position;

-- [2] Unique constraints / indexes on circle_office_agents
--     PostgREST on_conflict=circle_id,owner_id,name requires a UNIQUE index
--     matching those columns exactly. If missing or ambiguous, upserts fail.
select i.relname as index_name,
       ix.indisunique as is_unique,
       pg_get_indexdef(i.oid) as definition
from   pg_index ix
join   pg_class i on i.oid = ix.indexrelid
join   pg_class t on t.oid = ix.indrelid
where  t.relname = 'circle_office_agents'
order  by ix.indisunique desc, i.relname;

-- [3] RLS policies on circle_office_agents
--     Expect 4 policies (rls_oa_{select,insert,update,delete}) after
--     20260318_rls_hardening.sql. If you ALSO see the pre-hardening policies
--     "circle members can view office agents" / "owners can manage their
--     office agents", that's the half-applied migration state — they should
--     be dropped (see remediation SQL at the bottom).
select polname as policy_name,
       polcmd as command,       -- r=SELECT, a=INSERT, w=UPDATE, d=DELETE, *=ALL
       pg_get_expr(polqual,  polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as with_check_expr
from   pg_policy
where  polrelid = 'public.circle_office_agents'::regclass
order  by polcmd, polname;

-- [4] Triggers on circle_office_agents
--     A broken trigger function is a common source of 502s. updated_at
--     trigger should be trivial; anything else warrants a look.
select tgname as trigger_name,
       pg_get_triggerdef(oid) as definition
from   pg_trigger
where  tgrelid = 'public.circle_office_agents'::regclass
  and  not tgisinternal;

-- [5] Realtime publication membership
--     If the table isn't in supabase_realtime but the base migration said to
--     add it, that's fine for upserts. If it's in the publication but the
--     replication slot is wedged, writes can 502 intermittently.
select pubname, schemaname, tablename
from   pg_publication_tables
where  tablename in ('circle_office_agents', 'slack_connections', 'teams_connections');

-- [6] pg_cron jobs touching the office
--     Duplicates from running the sweeper migration twice would cause
--     'job already exists' errors. If you see duplicates, keep one.
select jobid, schedule, jobname, command, active
from   cron.job
where  jobname like '%office%' or jobname like '%sweep%'
order  by jobname;

-- [7] Row count + last-active heatmap
--     Sanity-check: are upserts actually landing rows? If count is zero
--     but the app claims to have published, something blocked them silently.
select count(*) as total_rows,
       count(*) filter (where is_published = true) as published,
       count(*) filter (where status = 'offline')  as offline,
       count(*) filter (where status = 'idle')     as idle,
       count(*) filter (where status = 'building') as building,
       max(last_active_at) as most_recent_activity
from   circle_office_agents;

-- [8] Foreign key state — dangling owner_id?
--     An FK violation would normally return 409 not 502, but verifying the
--     links are clean rules it out.
select oa.id, oa.owner_id, oa.circle_id
from   circle_office_agents oa
left   join auth.users u on u.id = oa.owner_id
left   join circles     c on c.id = oa.circle_id
where  u.id is null or c.id is null
limit  20;


-- ─── Remediation SQL — ONLY RUN if [3] shows the pre-hardening policies ────
-- Uncomment and run these if you see the legacy policy names alongside the
-- new rls_oa_* policies. Safe to run in any case; DROP IF EXISTS is a no-op.
--
-- DROP POLICY IF EXISTS "circle members can view office agents" ON circle_office_agents;
-- DROP POLICY IF EXISTS "owners can manage their office agents"  ON circle_office_agents;
-- NOTIFY pgrst, 'reload schema';
