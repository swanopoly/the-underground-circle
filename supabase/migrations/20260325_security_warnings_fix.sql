-- ─────────────────────────────────────────────────────────────────────────
-- Fix Supabase security linter WARNINGS
--
-- 1. Set search_path on ALL public functions (37 flagged)
-- 2. Drop over-permissive "service role" RLS policies (role="-", USING true)
-- 3. Replace over-permissive authenticated RLS policies with circle scoping
--
-- Manual steps (not fixable via migration):
--   • Move pg_net extension: ALTER EXTENSION pg_net SET SCHEMA extensions;
--     (do this in Supabase Dashboard → SQL Editor, may require updating
--      functions that call net.http_post to use extensions.net.http_post)
--   • Enable leaked password protection:
--     Dashboard → Auth → Settings → Security → Enable HaveIBeenPwned check
-- ─────────────────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════════════════
-- 1. Fix function_search_path_mutable for ALL public functions
--    Sets search_path = '' on every function that doesn't have one yet.
--    This prevents search_path hijacking attacks.
-- ══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig, '{}')) c
        WHERE c LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', r.sig);
  END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. Drop "service role" policies that use USING(true) / WITH CHECK(true)
--
--    These policies specify no role (role = "-"), which means they apply to
--    ALL roles — including anon. The service_role key bypasses RLS entirely,
--    so these policies are unnecessary for service role and accidentally
--    grant unrestricted access to anon/authenticated.
--
--    Each table already has proper circle-scoped policies for authenticated
--    users (SELECT/INSERT/UPDATE), so dropping these is safe.
-- ══════════════════════════════════════════════════════════════════════════

-- agent_activity: has "Members can read activity" (SELECT, circle-scoped)
DROP POLICY IF EXISTS "Service role can insert" ON agent_activity;

-- project_rooms: has Circle members read/create/update policies
DROP POLICY IF EXISTS "Service role full access rooms" ON project_rooms;

-- project_room_agents: has "Circle members read room agents" (SELECT)
DROP POLICY IF EXISTS "Service role manage room agents" ON project_room_agents;

-- project_room_activity: has "Circle members read room activity" (SELECT)
DROP POLICY IF EXISTS "Service role insert room activity" ON project_room_activity;

-- room_usage: has room_usage_select policy
DROP POLICY IF EXISTS "room_usage_insert" ON room_usage;

-- tasks: has Members can view/create/update tasks policies
DROP POLICY IF EXISTS "Update tasks" ON tasks;


-- ══════════════════════════════════════════════════════════════════════════
-- 3. Replace overly permissive authenticated policies (USING true)
--    with circle-membership scoping
--
--    These tables have circle_id — restrict access to circle members only.
-- ══════════════════════════════════════════════════════════════════════════

-- ── agent_approvals ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "agent_approvals_auth" ON agent_approvals;

CREATE POLICY "agent_approvals_select"
  ON agent_approvals FOR SELECT TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "agent_approvals_insert"
  ON agent_approvals FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "agent_approvals_update"
  ON agent_approvals FOR UPDATE TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

-- ── agent_controls ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "agent_controls_auth" ON agent_controls;

CREATE POLICY "agent_controls_select"
  ON agent_controls FOR SELECT TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "agent_controls_insert"
  ON agent_controls FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "agent_controls_update"
  ON agent_controls FOR UPDATE TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

-- ── circle_memory ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "circle_memory_auth" ON circle_memory;

CREATE POLICY "circle_memory_select"
  ON circle_memory FOR SELECT TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "circle_memory_insert"
  ON circle_memory FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "circle_memory_update"
  ON circle_memory FOR UPDATE TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

-- ── circle_memory_history ────────────────────────────────────────────────
DROP POLICY IF EXISTS "circle_memory_history_auth" ON circle_memory_history;

CREATE POLICY "circle_memory_history_select"
  ON circle_memory_history FOR SELECT TO authenticated
  USING (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "circle_memory_history_insert"
  ON circle_memory_history FOR INSERT TO authenticated
  WITH CHECK (circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  ));
