-- ═════════════════════════════════════════════════════════════════════════════
-- Underground Circle — consolidated pending SQL
-- Generated 2026-04-21 as part of the optimization pass.
-- Comment labels last normalized 2026-05-09.
-- Paste the whole thing into the Supabase SQL Editor. Safe to re-run — every
-- statement is idempotent (IF NOT EXISTS / OR REPLACE / DROP+CREATE for RLS).
--
-- Contents:
--   §1  Custom themes (user_custom_themes) + RLS
--   §2  Agent appearance JSONB column on profiles
--   §3  Office layout JSONB column on profiles
--   §4  Offline agent sweeper (pg_cron)
--   §5  step_away_sessions table + RLS
--   §6  New indexes recommended by the audit
--   §7  Scheduled cleanup jobs for growth-prone tables
--   §8  PostgREST schema reload
--   §9  Hermes-inspired agent runtime telemetry
--   §10 Circle skill library + agent_approvals.applied_at
--   §11 Per-user memory
--   §12 Phase 1d: idx_claude_api_usage_circle_source_created for automation cap check
--   §13 Phase CA-7: chat_checkpoints
--   §14 Phase CA-5: circle_memory bank
--   §15 Phase CA-8c: circle_skill_files
--   §16 Google Workspace: user_google_credentials + RLS
--   §17 Chat-thread lineage columns
--   §18 Computer-use confirmation sweeper
-- ═════════════════════════════════════════════════════════════════════════════

-- ─── §1. Custom themes ──────────────────────────────────────────────────────
-- Source: 20260228_custom_themes.sql

CREATE TABLE IF NOT EXISTS user_custom_themes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id        uuid                REFERENCES circles(id) ON DELETE SET NULL,
  name             text        NOT NULL DEFAULT 'My Theme',
  environment_type text        NOT NULL DEFAULT 'office',
  colors           jsonb       NOT NULL DEFAULT '{}',
  is_shared        boolean              DEFAULT false,
  created_at       timestamptz          DEFAULT now(),
  updated_at       timestamptz          DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_custom_themes_user
  ON user_custom_themes(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_themes_circle
  ON user_custom_themes(circle_id) WHERE is_shared = true;

ALTER TABLE user_custom_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own themes"                   ON user_custom_themes;
DROP POLICY IF EXISTS "Users can read shared themes in their circles" ON user_custom_themes;
DROP POLICY IF EXISTS "Users can create own themes"                 ON user_custom_themes;
DROP POLICY IF EXISTS "Users can update own themes"                 ON user_custom_themes;
DROP POLICY IF EXISTS "Users can delete own themes"                 ON user_custom_themes;

CREATE POLICY "Users can read own themes"
  ON user_custom_themes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read shared themes in their circles"
  ON user_custom_themes FOR SELECT
  USING (
    is_shared = true
    AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create own themes"
  ON user_custom_themes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own themes"
  ON user_custom_themes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own themes"
  ON user_custom_themes FOR DELETE
  USING (auth.uid() = user_id);

-- ─── §2. Agent appearance column ────────────────────────────────────────────
-- Source: 20260301_agent_appearances.sql
-- Stores Record<agentName, AgentAppearance> keyed by agent name.
-- RLS on profiles already lets users update their own row.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS agent_appearance jsonb DEFAULT '{}';

-- ─── §3. Office layout column ───────────────────────────────────────────────
-- Source: 20260301_office_layout.sql
-- Stores { floors: OfficeFloor[], currentFloorId: string }.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS office_layout jsonb DEFAULT '{}';

-- ─── §4. Offline agent sweeper (pg_cron) ────────────────────────────────────
-- Merges 20260225_office_cron_sweeper.sql and 20260318_pending_items.sql.
-- Belt + suspenders for ephemeral Realtime presence: if last_active_at is
-- more than 3 minutes stale, mark the agent offline.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION sweep_offline_agents()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE circle_office_agents
     SET status = 'offline',
         updated_at = now()
   WHERE status IN ('idle', 'building')
     AND last_active_at IS NOT NULL
     AND last_active_at < now() - INTERVAL '3 minutes'
     AND is_published = true;
END;
$$;

GRANT EXECUTE ON FUNCTION sweep_offline_agents() TO postgres;

-- Re-schedule the cron job. `cron.schedule` errors if the name already
-- exists, so unschedule first when present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-offline-agents') THEN
    PERFORM cron.unschedule('sweep-offline-agents');
  END IF;
END $$;
SELECT cron.schedule(
  'sweep-offline-agents',
  '*/2 * * * *',
  'SELECT sweep_offline_agents()'
);

-- Sweeper index.
CREATE INDEX IF NOT EXISTS idx_circle_office_agents_last_active
  ON circle_office_agents (last_active_at)
  WHERE is_published = true;

-- ─── §5. step_away_sessions ─────────────────────────────────────────────────
-- Source: 20260318_pending_items.sql.
-- Depends on get_my_circle_ids() being present (defined by earlier
-- migrations; re-created here with IF NOT EXISTS semantics for a fresh DB).

-- Defensive: ensure get_my_circle_ids exists. If a richer version is
-- already defined, CREATE OR REPLACE overwrites with the same signature.
CREATE OR REPLACE FUNCTION get_my_circle_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT circle_id FROM circle_members WHERE user_id = auth.uid();
$$;

CREATE TABLE IF NOT EXISTS step_away_sessions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  circle_id   uuid        NOT NULL REFERENCES circles(id)              ON DELETE CASCADE,
  agent_id    uuid                 REFERENCES circle_office_agents(id) ON DELETE SET NULL,
  task        text        NOT NULL,
  context     text,
  status      text        NOT NULL DEFAULT 'active'
                                   CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  outcome     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE step_away_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_step_away"           ON step_away_sessions;
DROP POLICY IF EXISTS "circle_members_read_step_away" ON step_away_sessions;

CREATE POLICY "users_own_step_away"
  ON step_away_sessions
  FOR ALL
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "circle_members_read_step_away"
  ON step_away_sessions
  FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

CREATE INDEX IF NOT EXISTS idx_step_away_user
  ON step_away_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_step_away_circle
  ON step_away_sessions(circle_id, created_at DESC);

-- ─── §6. Audit-recommended indexes (P2-4) ───────────────────────────────────
-- Covers the hottest read paths the app makes today. All IF NOT EXISTS,
-- so safe to run whether or not the tables are loaded. Comment out any
-- line that references a table you haven't created yet; the rest will
-- still apply.

-- circle_office_agents: Feed + Office both query by circle_id
CREATE INDEX IF NOT EXISTS idx_circle_office_agents_circle_id
  ON circle_office_agents (circle_id);

-- agent_activity: "latest events in this circle" is the dominant query.
CREATE INDEX IF NOT EXISTS idx_agent_activity_circle_created
  ON agent_activity (circle_id, created_at DESC);

-- room_messages: infinite-scroll chat in RoomsTab.
CREATE INDEX IF NOT EXISTS idx_room_messages_room_created
  ON room_messages (room_id, created_at DESC);

-- circle_github_events: BlackSwan summary queries by circle.
-- NOTE: the column is `created_at`, NOT `received_at` — mis-spelling this
-- blew up a prior run of the script and took §7–§11 with it.
CREATE INDEX IF NOT EXISTS idx_circle_github_events_circle_created
  ON circle_github_events (circle_id, created_at DESC);

-- check_ins: MembersTab today-filter + leaderboards.
CREATE INDEX IF NOT EXISTS idx_check_ins_circle_created
  ON check_ins (circle_id, created_at DESC);

-- challenge_participants: pagination.
CREATE INDEX IF NOT EXISTS idx_challenge_participants_challenge
  ON challenge_participants (challenge_id);

-- ─── §7. Cleanup crons for growth-prone tables (P2-4) ───────────────────────
-- Keep agent_activity + office_terminal_messages bounded. 30 days of history
-- is plenty for debugging; anything older is rarely looked at.

CREATE OR REPLACE FUNCTION cleanup_old_agent_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM agent_activity
   WHERE created_at < now() - INTERVAL '30 days';
END;
$$;
GRANT EXECUTE ON FUNCTION cleanup_old_agent_activity() TO postgres;

CREATE OR REPLACE FUNCTION cleanup_old_office_terminal_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM office_terminal_messages
   WHERE created_at < now() - INTERVAL '30 days';
END;
$$;
GRANT EXECUTE ON FUNCTION cleanup_old_office_terminal_messages() TO postgres;

-- Schedule both — daily at 03:17 UTC.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-agent-activity') THEN
    PERFORM cron.unschedule('cleanup-agent-activity');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-office-terminal-messages') THEN
    PERFORM cron.unschedule('cleanup-office-terminal-messages');
  END IF;
END $$;
SELECT cron.schedule('cleanup-agent-activity',           '17 3 * * *', 'SELECT cleanup_old_agent_activity()');
SELECT cron.schedule('cleanup-office-terminal-messages', '22 3 * * *', 'SELECT cleanup_old_office_terminal_messages()');

-- ─── §8. PostgREST schema reload ────────────────────────────────────────────
-- After schema changes the API has to re-introspect or new columns show up
-- as "column not found" for a minute. Force it now.

NOTIFY pgrst, 'reload schema';

-- ─── §9. Hermes-inspired agent runtime (Phase 1, from HERMES_INTEGRATION_PLAN) ─
-- Enables the new AgentExecutionCore to persist per-run telemetry so future
-- phases (verification expansion, trajectory log → offline evaluator) have
-- data to work with. Safe to run alongside the current OpenSwan gateway —
-- the old `toolBrief` code path simply won't populate these columns.

DO $$
BEGIN
  IF to_regclass('agent_runs') IS NOT NULL THEN
    ALTER TABLE agent_runs
      ADD COLUMN IF NOT EXISTS tool_calls        jsonb  DEFAULT '[]'::jsonb,
      ADD COLUMN IF NOT EXISTS iteration_count   int    DEFAULT 0,
      ADD COLUMN IF NOT EXISTS final_stop_reason text;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS agent_run_events (
  id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id   uuid        NOT NULL,
  kind     text        NOT NULL,
  payload  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  at       timestamptz NOT NULL DEFAULT now()
);

-- FK added only if the referenced table exists. This keeps the script safe
-- to run on older DBs that pre-date the run system.
DO $$
BEGIN
  IF to_regclass('agent_runs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_run_events_run_id_fkey'
     )
  THEN
    ALTER TABLE agent_run_events
      ADD CONSTRAINT agent_run_events_run_id_fkey
      FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_created
  ON agent_run_events (run_id, at DESC);

-- ─── §10. Circle skill library (Phase 2, SKILL.md open standard) ────────────
-- Stores circle-scoped skills the agent can consult. Format mirrors
-- https://agentskills.io so users can import Claude Code / Cursor skills
-- directly. `usage_count` / `success_count` feed the future evaluator.

CREATE TABLE IF NOT EXISTS circle_skills (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id     uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_id     uuid                 REFERENCES auth.users(id) ON DELETE SET NULL,
  name          text        NOT NULL,
  description   text        NOT NULL,
  version       text        NOT NULL DEFAULT '1.0.0',
  content       text        NOT NULL,
  tags          text[]               DEFAULT '{}',
  usage_count   int                  DEFAULT 0,
  success_count int                  DEFAULT 0,
  created_at    timestamptz          DEFAULT now(),
  updated_at    timestamptz          DEFAULT now(),
  UNIQUE (circle_id, name)
);

CREATE INDEX IF NOT EXISTS idx_circle_skills_circle
  ON circle_skills(circle_id);

ALTER TABLE circle_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members_read_skills"  ON circle_skills;
DROP POLICY IF EXISTS "authors_write_skills" ON circle_skills;

CREATE POLICY "members_read_skills"
  ON circle_skills
  FOR SELECT
  USING (circle_id IN (SELECT get_my_circle_ids()));

CREATE POLICY "authors_write_skills"
  ON circle_skills
  FOR ALL
  USING      (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

-- ─── §10b. agent_approvals.applied_at (Phase 2b) ───────────────────────────
-- The SKILL.md write path (manageLibrarySkill tool → applyApprovedSkillAction)
-- files proposals into agent_approvals, then marks them applied so re-runs
-- of the worker short-circuit. Safe additive column.

ALTER TABLE agent_approvals
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_agent_approvals_pending_per_circle
  ON agent_approvals (circle_id, requested_at DESC)
  WHERE status = 'pending';

-- ─── §11. Per-user memory (Phase 4, Hermes USER.md equivalent) ──────────────
-- Small, user-only-writable document the agent injects alongside
-- circle_memory so it remembers individual preferences ("call me by first
-- name", "I work in Go", etc).

CREATE TABLE IF NOT EXISTS user_memory (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id  uuid                 REFERENCES circles(id)    ON DELETE CASCADE,
  content    text        NOT NULL,
  updated_at timestamptz          DEFAULT now(),
  UNIQUE (user_id, circle_id)
);

ALTER TABLE user_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_rw_own_memory" ON user_memory;

CREATE POLICY "user_rw_own_memory"
  ON user_memory
  FOR ALL
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ═════════════════════════════════════════════════════════════════════════════
-- §12. Phase 1d telemetry index for automation daily-cap check
-- ═════════════════════════════════════════════════════════════════════════════
-- The `automation-executor` cap check runs on every cron tick and queries:
--   SELECT estimated_cost FROM claude_api_usage
--    WHERE circle_id = $1 AND source = 'automation-executor'
--      AND created_at >= now() - interval '24 hours';
--
-- The existing `idx_claude_api_usage_circle_created` covers circle_id +
-- created_at but not source, so every check reads every Claude call for the
-- circle and filters by source in-memory. As usage grows (~1k rows/circle/day
-- at full adoption) this becomes the hottest query in the table. Composite
-- index aligns exactly with the query's filter tuple.

CREATE INDEX IF NOT EXISTS idx_claude_api_usage_circle_source_created
  ON claude_api_usage (circle_id, source, created_at DESC);

-- Refresh PostgREST again so the new tables + columns are immediately queryable.
NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- §13. Phase CA-7: chat_checkpoints (Cline-style undo for chat tools)
-- ═════════════════════════════════════════════════════════════════════════════
-- Full migration file: supabase/migrations/20260505_chat_checkpoints.sql
-- Snapshots before/after JSONB for destructive chat tool calls so the
-- chat UI can render "Checkpoint · Compare · Restore". Per-kind restore
-- handlers live in `src/lib/chatCheckpoints.ts`.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS chat_checkpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  session_key     text,
  plan_id         text,
  tool_kind       text NOT NULL,
  target_kind     text,
  target_id       text,
  before_json     jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_json      jsonb NOT NULL DEFAULT '{}'::jsonb,
  diff_summary    text,
  hash_before     text,
  hash_after      text,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  restored_at     timestamptz,
  restored_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  restore_error   text
);

CREATE INDEX IF NOT EXISTS idx_chat_checkpoints_circle_created
  ON chat_checkpoints (circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_checkpoints_plan
  ON chat_checkpoints (circle_id, plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_checkpoints_tool_kind
  ON chat_checkpoints (circle_id, tool_kind, created_at DESC);

ALTER TABLE chat_checkpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_checkpoints_read" ON chat_checkpoints;
CREATE POLICY "chat_checkpoints_read" ON chat_checkpoints FOR SELECT USING (
  EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = chat_checkpoints.circle_id AND cm.user_id = auth.uid())
);

DROP POLICY IF EXISTS "chat_checkpoints_insert" ON chat_checkpoints;
CREATE POLICY "chat_checkpoints_insert" ON chat_checkpoints FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = chat_checkpoints.circle_id AND cm.user_id = auth.uid())
);

DROP POLICY IF EXISTS "chat_checkpoints_restore_update" ON chat_checkpoints;
CREATE POLICY "chat_checkpoints_restore_update" ON chat_checkpoints FOR UPDATE
  USING (EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = chat_checkpoints.circle_id AND cm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM circle_members cm WHERE cm.circle_id = chat_checkpoints.circle_id AND cm.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION chat_checkpoints_enforce_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.session_key IS DISTINCT FROM OLD.session_key
    OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
    OR NEW.tool_kind IS DISTINCT FROM OLD.tool_kind
    OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
    OR NEW.target_id IS DISTINCT FROM OLD.target_id
    OR NEW.before_json IS DISTINCT FROM OLD.before_json
    OR NEW.after_json IS DISTINCT FROM OLD.after_json
    OR NEW.diff_summary IS DISTINCT FROM OLD.diff_summary
    OR NEW.hash_before IS DISTINCT FROM OLD.hash_before
    OR NEW.hash_after IS DISTINCT FROM OLD.hash_after
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'chat_checkpoints snapshot is immutable after commit';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chat_checkpoints_immutable_trg ON chat_checkpoints;
CREATE TRIGGER chat_checkpoints_immutable_trg
  BEFORE UPDATE ON chat_checkpoints
  FOR EACH ROW EXECUTE FUNCTION chat_checkpoints_enforce_immutable();

GRANT SELECT, INSERT, UPDATE ON chat_checkpoints TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- §14. Phase CA-5: circle_memory bank — three named docs per circle
-- ═════════════════════════════════════════════════════════════════════════════
-- Full migration file: supabase/migrations/20260506_circle_memory_bank.sql
-- Splits the old single-doc `circle_memory` (circle_id UNIQUE) into three
-- named docs: brief / active_context / progress. Back-compat: existing
-- rows become `doc_kind = 'brief'`. Backs src/lib/memoryBankChatCommands.ts
-- + src/services/sharedMemory.ts + src/lib/memoryBankKinds.ts.

-- 14.a: add doc_kind to both tables
ALTER TABLE circle_memory
  ADD COLUMN IF NOT EXISTS doc_kind text NOT NULL DEFAULT 'brief';
UPDATE circle_memory SET doc_kind = 'brief' WHERE doc_kind IS NULL;

ALTER TABLE circle_memory_history
  ADD COLUMN IF NOT EXISTS doc_kind text NOT NULL DEFAULT 'brief';
UPDATE circle_memory_history SET doc_kind = 'brief' WHERE doc_kind IS NULL;

-- 14.b: drop the old single-col unique, add composite (circle_id, doc_kind).
ALTER TABLE circle_memory DROP CONSTRAINT IF EXISTS circle_memory_circle_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'circle_memory_circle_doc_kind_key'
       AND conrelid = 'circle_memory'::regclass
  ) THEN
    ALTER TABLE circle_memory
      ADD CONSTRAINT circle_memory_circle_doc_kind_key UNIQUE (circle_id, doc_kind);
  END IF;
END $$;

-- 14.c: allowed-value check so typos don't invent ghost kinds.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'circle_memory_doc_kind_check'
       AND conrelid = 'circle_memory'::regclass
  ) THEN
    ALTER TABLE circle_memory
      ADD CONSTRAINT circle_memory_doc_kind_check
      CHECK (doc_kind IN ('brief', 'active_context', 'progress'));
  END IF;
END $$;

-- 14.d: history index covers the (circle_id, doc_kind, version DESC) read.
CREATE INDEX IF NOT EXISTS idx_circle_memory_history_circle_doc_version
  ON circle_memory_history (circle_id, doc_kind, version DESC);

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- Interim verify for sections 1-14:
--   SELECT jobname, schedule FROM cron.job ORDER BY jobname;
--   \d user_custom_themes
--   \d step_away_sessions
--   \d circle_skills
--   \d user_memory
--   \d chat_checkpoints
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'profiles' AND column_name IN ('agent_appearance', 'office_layout');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'agent_runs' AND column_name IN ('tool_calls', 'iteration_count', 'final_stop_reason');
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- §16. Google Workspace integration — per-user OAuth credentials
-- ═════════════════════════════════════════════════════════════════════════════
-- Holds the Gmail/Calendar/Drive/Sheets/Docs/Contacts OAuth state per user.
-- Distinct from Supabase Auth's own provider_token (that covers sign-in only).
-- This table stores the LONG-LIVED refresh token + the actual scope grant, so
-- we can call Google APIs on the user's behalf from edge functions long
-- after the Supabase session has rotated.
--
-- RLS is user-only — each user reads/writes their own row. Edge functions
-- use the service-role client to bypass RLS when proxying API calls.

CREATE TABLE IF NOT EXISTS user_google_credentials (
  user_id        uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          text        NOT NULL,
  -- Refresh token — long-lived. Should be treated as secret. We store it
  -- as text (not jsonb) because Google returns it opaque; we never parse.
  refresh_token  text        NOT NULL,
  -- Access token cached until `expires_at`; refreshed transparently by the
  -- edge function when expired.
  access_token   text,
  expires_at     timestamptz,
  -- Granted scopes — sliced off the OAuth response. Lets us refuse a tool
  -- call whose scope the user didn't consent to, without hitting Google.
  scopes         text[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_google_credentials_email
  ON user_google_credentials(email);

ALTER TABLE user_google_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_google_creds" ON user_google_credentials;

CREATE POLICY "users_own_google_creds"
  ON user_google_credentials
  FOR ALL
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Short-lived OAuth state for CSRF protection (mirrors github_oauth_states).
-- Rows older than 10 minutes are swept by pg_cron below if available.
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state       text        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  services    text[]      NOT NULL DEFAULT '{}',  -- which service set the user picked
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_google_oauth_states_expires
  ON google_oauth_states(expires_at);

-- State rows are written server-side only. No RLS select from the client.
ALTER TABLE google_oauth_states ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- §15. Phase CA-8c: circle_skill_files — Hermes Level-2 skill retrieval
-- ═════════════════════════════════════════════════════════════════════════════
-- Full migration file: supabase/migrations/20260507_circle_skill_files.sql
-- Backs `viewLibrarySkillFile(name, path)` + `listLibrarySkillFiles` for
-- 3-level skill retrieval. Primary SKILL.md body stays on
-- `circle_skills.content`; this table holds sub-files (references/,
-- templates/, scripts/, etc.). See `PHASE_CA-8_HERMES_DELTA_PLAN.md` §CA-8c.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS circle_skill_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id    uuid NOT NULL REFERENCES circle_skills(id) ON DELETE CASCADE,
  relpath     text NOT NULL,
  content     text NOT NULL DEFAULT '',
  is_primary  boolean NOT NULL DEFAULT false,
  mime_type   text,
  size_bytes  int NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, relpath)
);

CREATE INDEX IF NOT EXISTS idx_circle_skill_files_skill
  ON circle_skill_files (skill_id);
CREATE INDEX IF NOT EXISTS idx_circle_skill_files_primary
  ON circle_skill_files (skill_id) WHERE is_primary = true;

ALTER TABLE circle_skill_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "circle_skill_files_read" ON circle_skill_files;
CREATE POLICY "circle_skill_files_read" ON circle_skill_files FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM circle_skills cs
      JOIN circle_members cm ON cm.circle_id = cs.circle_id
     WHERE cs.id = circle_skill_files.skill_id
       AND cm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "circle_skill_files_insert" ON circle_skill_files;
CREATE POLICY "circle_skill_files_insert" ON circle_skill_files FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM circle_skills cs
      JOIN circle_members cm ON cm.circle_id = cs.circle_id
     WHERE cs.id = circle_skill_files.skill_id
       AND cm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "circle_skill_files_update" ON circle_skill_files;
CREATE POLICY "circle_skill_files_update" ON circle_skill_files FOR UPDATE
  USING (EXISTS (SELECT 1 FROM circle_skills cs JOIN circle_members cm ON cm.circle_id = cs.circle_id WHERE cs.id = circle_skill_files.skill_id AND cm.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM circle_skills cs JOIN circle_members cm ON cm.circle_id = cs.circle_id WHERE cs.id = circle_skill_files.skill_id AND cm.user_id = auth.uid()));

DROP POLICY IF EXISTS "circle_skill_files_delete" ON circle_skill_files;
CREATE POLICY "circle_skill_files_delete" ON circle_skill_files FOR DELETE USING (
  EXISTS (SELECT 1 FROM circle_skills cs JOIN circle_members cm ON cm.circle_id = cs.circle_id WHERE cs.id = circle_skill_files.skill_id AND cm.user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION circle_skill_files_bump_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS circle_skill_files_updated_at_trg ON circle_skill_files;
CREATE TRIGGER circle_skill_files_updated_at_trg
  BEFORE UPDATE ON circle_skill_files
  FOR EACH ROW EXECUTE FUNCTION circle_skill_files_bump_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON circle_skill_files TO authenticated;

NOTIFY pgrst, 'reload schema';
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- §17. CA-8j — Chat-thread lineage columns (added 2026-04-23)
-- ═════════════════════════════════════════════════════════════════════════════
-- When a chat thread gets compressed (memory-bank summariser) or forked
-- by a user, we want to trace the task across forks in the Run Ledger.
-- parent_thread_id is the immediate ancestor; lineage_root_id is the
-- denormalised oldest-ancestor id so "all threads in this lineage" is
-- a single indexed lookup.
--
-- Safe to re-run. Both columns default NULL; existing threads are
-- their own lineage root implicitly — application code treats a null
-- lineage_root_id as "this is the root".

alter table if exists circle_chat_threads
  add column if not exists parent_thread_id uuid
    references circle_chat_threads(id) on delete set null;

alter table if exists circle_chat_threads
  add column if not exists lineage_root_id uuid;

create index if not exists idx_cct_lineage_root
  on circle_chat_threads (lineage_root_id, last_message_at desc)
  where lineage_root_id is not null;

create index if not exists idx_cct_parent_thread
  on circle_chat_threads (parent_thread_id)
  where parent_thread_id is not null;

alter table if exists circle_chat_threads
  drop constraint if exists cct_parent_not_self;
alter table if exists circle_chat_threads
  add constraint cct_parent_not_self
  check (parent_thread_id is null or parent_thread_id <> id);

-- ═════════════════════════════════════════════════════════════════════════════
-- §18. CA-8e server completion — sweep stale computer_use_confirmations (2026-04-23)
-- ═════════════════════════════════════════════════════════════════════════════
-- In-run poller handles the live 120s timeout. If a run dies mid-poll,
-- this sweeper reaps the orphan rows every 5 min. Marks `__expired__`
-- (distinct from `__timeout__`) so telemetry can tell "user ignored"
-- from "run crashed".

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

select cron.schedule(
  'sweep-stale-computer-use-confirmations',
  '*/5 * * * *',
  $$select sweep_stale_computer_use_confirmations()$$
);

grant execute on function sweep_stale_computer_use_confirmations() to postgres;
grant execute on function sweep_stale_computer_use_confirmations() to service_role;

create index if not exists idx_computer_use_confirmations_unresolved_old
  on computer_use_confirmations (created_at)
  where resolved_at is null;

NOTIFY pgrst, 'reload schema';

-- Final verify:
--   SELECT jobname, schedule FROM cron.job ORDER BY jobname;
--   \d user_google_credentials
--   \d google_oauth_states
--   \d circle_skill_files
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'circle_chat_threads'
--      AND column_name IN ('parent_thread_id', 'lineage_root_id');
--   \d computer_use_confirmations
