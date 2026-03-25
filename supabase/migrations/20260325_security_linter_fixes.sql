-- ─────────────────────────────────────────────────────────────────────────
-- Fix Supabase security linter errors
--
-- 1. Recreate SECURITY DEFINER views with security_invoker = true
-- 2. Enable RLS on orphaned tables (not used in app code, but exist in DB)
-- ─────────────────────────────────────────────────────────────────────────

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Fix SECURITY DEFINER views → SECURITY INVOKER
--    These views filter data based on user preferences. They MUST run as
--    the querying user so that RLS policies on the underlying tables apply.
-- ══════════════════════════════════════════════════════════════════════════

-- training_safe_check_ins
CREATE OR REPLACE VIEW training_safe_check_ins
  WITH (security_invoker = true) AS
  SELECT c.* FROM check_ins c
  JOIN profiles p ON p.id = c.user_id
  WHERE p.training_opt_out = false
    AND NOT ('check_ins' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

-- training_safe_messages
CREATE OR REPLACE VIEW training_safe_messages
  WITH (security_invoker = true) AS
  SELECT m.* FROM messages m
  JOIN profiles p ON p.id = m.user_id
  WHERE p.training_opt_out = false
    AND NOT ('messages' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

-- training_safe_terminal
CREATE OR REPLACE VIEW training_safe_terminal
  WITH (security_invoker = true) AS
  SELECT t.* FROM office_terminal_messages t
  JOIN profiles p ON p.id = t.sender_id
  WHERE p.training_opt_out = false
    AND NOT ('terminal' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

-- safe_profiles (wallet visibility logic)
CREATE OR REPLACE VIEW safe_profiles
  WITH (security_invoker = true) AS
  SELECT
    id,
    username,
    display_name,
    avatar_url,
    bio,
    current_streak,
    longest_streak,
    created_at,
    CASE
      WHEN id = auth.uid() THEN wallet_address
      WHEN id IN (
        SELECT cm.user_id
        FROM circle_members cm
        WHERE cm.circle_id IN (
          SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
        )
      ) THEN wallet_address
      ELSE NULL
    END AS wallet_address,
    CASE
      WHEN id = auth.uid() THEN wallet_chain
      WHEN id IN (
        SELECT cm.user_id
        FROM circle_members cm
        WHERE cm.circle_id IN (
          SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
        )
      ) THEN wallet_chain
      ELSE NULL
    END AS wallet_chain
  FROM profiles;

-- Ensure grants are preserved
GRANT SELECT ON training_safe_check_ins TO authenticated;
GRANT SELECT ON training_safe_messages TO authenticated;
GRANT SELECT ON training_safe_terminal TO authenticated;
GRANT SELECT ON safe_profiles TO authenticated;


-- ══════════════════════════════════════════════════════════════════════════
-- 2. Enable RLS on orphaned tables
--    These tables exist in the DB but are NOT referenced in app code.
--    Enable RLS with no permissive policies = locked down by default.
--    If these are truly unused, they can be dropped in a future migration.
-- ══════════════════════════════════════════════════════════════════════════

-- circle_office_settings
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'circle_office_settings') THEN
    ALTER TABLE public.circle_office_settings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.circle_office_settings FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- circle_agent_connections
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'circle_agent_connections') THEN
    ALTER TABLE public.circle_agent_connections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.circle_agent_connections FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- circle_agent_runs (contains sensitive session_key column)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'circle_agent_runs') THEN
    ALTER TABLE public.circle_agent_runs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.circle_agent_runs FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

-- circle_agent_metrics
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'circle_agent_metrics') THEN
    ALTER TABLE public.circle_agent_metrics ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.circle_agent_metrics FORCE ROW LEVEL SECURITY;
  END IF;
END $$;
