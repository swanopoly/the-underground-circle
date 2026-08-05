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
--   §19 Vault: circle_site_credentials schema alignment
--   §20 Computer-use action trace (guided replay)
--   §21 Messages content length cap
--   §22 Training-safe agent tool-trace views
--   §23 agent_run_events RLS policy
--   §24 codebase_files + match_codebase_files
--   §25 agent_runs.agent_id durable linkage
--   §26 Durable agent action calls
--   §27 Scheduled-action mutation guard
--   §28 Database authority guards
--   §29 SwanBot continuation privacy sweeper
--   §30 Memory security convergence, RLS fixes, and hot-path indexes
--   §31 Thread-scoped Chat authority and atomic reactions
--   §32 OpenSwan production readiness contract
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
      ADD COLUMN IF NOT EXISTS final_stop_reason text,
      ADD COLUMN IF NOT EXISTS input_tokens      bigint DEFAULT 0,
      ADD COLUMN IF NOT EXISTS output_tokens     bigint DEFAULT 0,
      ADD COLUMN IF NOT EXISTS cached_tokens     bigint DEFAULT 0;
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
--    WHERE table_name = 'agent_runs'
--      AND column_name IN ('tool_calls', 'iteration_count', 'final_stop_reason', 'input_tokens', 'output_tokens', 'cached_tokens');
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

-- ─── §19. Vault: circle_site_credentials schema alignment ───────────────────
-- Source: 20260504_vault_schema_alignment.sql
-- Fixes the gap between circle_site_credentials and what
-- siteCredentialVault.ts (panel + edge fn) reads/writes. Additive only —
-- doesn't touch the encrypted blob, doesn't change RLS, doesn't redefine the
-- list_*/store_*/get_*/delete_* RPCs (those live in the deployed DB and could
-- have non-trivial encryption logic that we don't want to clobber).

-- Drop the hardcoded platform CHECK so users can save credentials for any
-- platform — the original ~22-platform list was a best-guess at install time
-- and a constant friction source.
ALTER TABLE circle_site_credentials
  DROP CONSTRAINT IF EXISTS circle_site_credentials_platform_check;

-- Columns the lib expects but the original migration never created.
-- All optional so existing rows stay valid.
ALTER TABLE circle_site_credentials
  ADD COLUMN IF NOT EXISTS secret_kind text NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS login_url text,
  ADD COLUMN IF NOT EXISTS access_policy jsonb NOT NULL DEFAULT '{"require_approval": true}'::jsonb,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS rotation_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Soft enum on secret_kind — same shape the panel exposes. Validates new
-- writes; doesn't fail on legacy rows that defaulted to 'password'.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'circle_site_credentials_secret_kind_check'
  ) THEN
    ALTER TABLE circle_site_credentials
      ADD CONSTRAINT circle_site_credentials_secret_kind_check
      CHECK (secret_kind IN (
        'password', 'application_password', 'api_token',
        'oauth_token', 'session_cookie'
      ));
  END IF;
END$$;

-- Indexes for findSiteCredentialForUrl() — host comparison stays client-side,
-- but indexing site_url and login_url speeds up the initial fetch.
CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_site_url
  ON circle_site_credentials(circle_id, site_url) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_login_url
  ON circle_site_credentials(circle_id, login_url) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_circle_site_credentials_rotation_due
  ON circle_site_credentials(circle_id, rotation_due_at)
  WHERE is_active AND rotation_due_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ─── §20. Computer-use action trace (guided replay) ─────────────────────────
-- Source: 20260610_computer_use_action_trace.sql
-- Successful runs persist their tool-action sequence so repeats of the
-- same task (recipes, schedules) follow the proven sequence instead of
-- re-exploring. Inputs are redacted at write time in the edge function —
-- this column never stores secrets. Additive only.

ALTER TABLE computer_use_runs
  ADD COLUMN IF NOT EXISTS action_trace jsonb;

NOTIFY pgrst, 'reload schema';

-- ─── §21. Raise messages.content length cap (2026-06-12) ─────────────────────
-- Source: 20260612_messages_content_cap.sql
-- The original schema capped circle-chat content at 1000 chars, so agent /
-- recovery messages (Use-Computer preflight blocks, recovery cards, structured
-- findings) were rejected with a `messages_content_check` violation (HTTP 400)
-- and failed to persist. Raise to a generous bound. Idempotent.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check CHECK (char_length(content) <= 100000);

NOTIFY pgrst, 'reload schema';

-- ─── §22. Training-safe agent tool-trace views (2026-07-10) ──────────────────
-- Source: 20260710_training_safe_agent_runs.sql
-- P63 BlackSwan tool-trace flywheel — APPLIED 2026-07-10 (Management API;
-- verified: both views readable via PostgREST as service_role, 34
-- completed runs visible).
-- Lets export_training_data.py / export_tool_traces.py read agent_runs +
-- agent_run_events through the standard training_opt_out gate (profiles
-- flag + field-level array; events gated via the parent-run view, same
-- pattern as training_safe_mission_tasks). agent_run_events' timestamp
-- column is `at` (NOT created_at — production-verified 2026-07-02); the
-- view aliases it to created_at so exporters order uniformly. Until this
-- is applied, both exporters skip/fall back gracefully (404 path).

CREATE OR REPLACE VIEW training_safe_agent_runs
  WITH (security_invoker = true) AS
  SELECT
    r.id,
    r.circle_id,
    r.surface,
    r.title,
    r.goal,
    r.mode,
    r.model,
    r.provider,
    r.status,
    r.created_at,
    r.completed_at
  FROM agent_runs r
  JOIN profiles p ON p.id = r.user_id
  WHERE r.status = 'completed'
    AND p.training_opt_out = false
    AND NOT ('agent_runs' = ANY(COALESCE(p.training_opt_out_fields, '{}')));

CREATE OR REPLACE VIEW training_safe_agent_run_events
  WITH (security_invoker = true) AS
  SELECT
    e.run_id,
    e.kind,
    e.payload,
    e.at AS created_at
  FROM agent_run_events e
  JOIN training_safe_agent_runs r ON r.id = e.run_id
  WHERE e.kind IN (
    'tool_call_start',
    'tool_call_result',
    'final_response',
    'solver_consultation',
    'turn_end'
  );

GRANT SELECT ON training_safe_agent_runs       TO authenticated, service_role;
GRANT SELECT ON training_safe_agent_run_events TO authenticated, service_role;

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
--   \d circle_site_credentials
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'computer_use_runs' AND column_name = 'action_trace';
--   SELECT table_name FROM information_schema.views
--    WHERE table_name IN ('training_safe_agent_runs', 'training_safe_agent_run_events');

-- ─── §23. agent_run_events RLS policy — the empty-flywheel root cause ────────
-- Source: 20260710b_agent_run_events_rls_policy.sql
-- APPLIED 2026-07-10 (Management API; verified in pg_policies).
-- agent_run_events had RLS ENABLED with ZERO policies → every client-side
-- event insert (P11 trace wiring, agentRunPersistence, subagent ledgers)
-- was silently rejected since the table was created; agent_runs grew to 40
-- rows while events stayed at 0. Policy mirrors agent_runs_circle_member
-- through the parent run. Client trace persistence works from apply time —
-- flywheel data accumulates from real usage FORWARD.

DROP POLICY IF EXISTS agent_run_events_circle_member ON agent_run_events;
CREATE POLICY agent_run_events_circle_member ON agent_run_events
  FOR ALL
  USING (
    run_id IN (
      SELECT r.id FROM agent_runs r
      WHERE r.circle_id IN (
        SELECT circle_members.circle_id
        FROM circle_members
        WHERE circle_members.user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    run_id IN (
      SELECT r.id FROM agent_runs r
      WHERE r.circle_id IN (
        SELECT circle_members.circle_id
        FROM circle_members
        WHERE circle_members.user_id = auth.uid()
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_agent_run_events_run_id
  ON agent_run_events (run_id);

-- ─── §24. codebase_files + match_codebase_files — P4 codebase index ──────────
-- Source: 20260713_codebase_files.sql
-- Per-user index of a local repo crawled via the desktop bridge (coding-agent
-- upgrade P4): one row per file with symbols, summary, and a 1536d embedding
-- (text-embedding-3-small via llm-proxy 'openai-embed'). NO file content is
-- stored — raw code stays on the user's machine. RLS is strictly owner-scoped
-- (a local-disk index is never circle-shared); match_codebase_files is
-- SECURITY INVOKER so that RLS applies inside the RPC.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS codebase_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid,
  repo_root text NOT NULL,
  path text NOT NULL,
  language text,
  symbols text[] NOT NULL DEFAULT '{}',
  summary text,
  size_bytes bigint,
  embedding vector(1536),
  embedding_model text,
  embedded_at timestamptz,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo_root, path)
);

CREATE INDEX IF NOT EXISTS idx_codebase_files_user_root
  ON codebase_files (user_id, repo_root);

CREATE INDEX IF NOT EXISTS idx_codebase_files_embedding
  ON codebase_files USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

ALTER TABLE codebase_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS codebase_files_owner ON codebase_files;
CREATE POLICY codebase_files_owner ON codebase_files
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION match_codebase_files(
  p_query_embedding vector(1536),
  p_repo_root text DEFAULT NULL,
  p_match_threshold float DEFAULT 0.0,
  p_match_count int DEFAULT 20
)
RETURNS TABLE (
  path text,
  language text,
  symbols text[],
  summary text,
  repo_root text,
  similarity float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.path,
    f.language,
    f.symbols,
    f.summary,
    f.repo_root,
    (1 - (f.embedding <=> p_query_embedding))::float AS similarity
  FROM codebase_files f
  WHERE f.embedding IS NOT NULL
    AND (p_repo_root IS NULL OR f.repo_root = p_repo_root)
    AND (1 - (f.embedding <=> p_query_embedding)) >= p_match_threshold
  ORDER BY f.embedding <=> p_query_embedding
  LIMIT LEAST(GREATEST(p_match_count, 1), 100);
END;
$$;

GRANT EXECUTE ON FUNCTION match_codebase_files TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   \d codebase_files
--   SELECT proname FROM pg_proc WHERE proname = 'match_codebase_files';

-- ═════════════════════════════════════════════════════════════════════════════
-- §25. agent_runs.agent_id — durable run→agent linkage (Office plan O6, 2026-07-24)
-- ═════════════════════════════════════════════════════════════════════════════
-- Mirrors supabase/migrations/20260724_agent_runs_agent_id.sql.
--
-- Replaces NAME-BASED run→agent attribution (officeRunLookup matching
-- delegated_to / "Name: " title prefixes / surface labels) with a durable
-- column. A miss silently attributes an agent's failures to nobody; a false hit
-- attributes them to the wrong agent — neither is acceptable for an
-- accountability product.
--
-- TEXT, not a uuid FK: the Office roster mixes published circle_office_agents
-- rows (uuid) with session-derived local-bridge agents that have no DB row at
-- all. Text carries the canonical runtime subject key for every agent kind.
-- `AgentRun.agent_id?: string` and deriveRunSubjectIdentity already assume
-- exactly these semantics.
--
-- Additive and idempotent: nullable, no default, no backfill, no constraint.
-- Existing rows stay valid and keep resolving via the unchanged name-matching
-- fallback. `createRun` tolerates the column being absent (omits it and retries
-- on a missing-column error), so this may be applied before or after a deploy.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS agent_id text;

COMMENT ON COLUMN agent_runs.agent_id IS
  'Canonical agent runtime subject key (agentRuntimeSubject.subjectKey) — or the '
  'circle_office_agents uuid for published agents. Durable replacement for '
  'name-based run→agent attribution. NULL on rows written before Office plan O6.';

CREATE INDEX IF NOT EXISTS idx_agent_runs_circle_agent
  ON agent_runs(circle_id, agent_id, created_at DESC)
  WHERE agent_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Verify:
--   \d agent_runs
--   SELECT count(*) FILTER (WHERE agent_id IS NOT NULL) AS attributed,
--          count(*) AS total
--   FROM agent_runs WHERE created_at > now() - interval '1 day';

-- ═════════════════════════════════════════════════════════════════════════════
-- §26. Durable agent action calls — cross-process exact-call idempotency
-- ═════════════════════════════════════════════════════════════════════════════
-- Source: 20260726_agent_action_calls.sql
-- Atomic claim -> dispatched -> terminal state machine for computerAppGrounding
-- mutations. Keep this section byte-aligned with the source migration below.
-- Durable cross-process mutation claim/start/finish ledger.
--
-- This closes the process-local idempotency gap in computerAppGrounding
-- without weakening its observe -> authorize -> dispatch -> verify contract.
-- Direct writes are denied: authenticated callers must use the three
-- SECURITY DEFINER RPCs, which bind the authenticated user to the exact
-- circle/run/tool/tool-use/action/argument/contract/idempotency identity.

CREATE TABLE IF NOT EXISTS public.agent_action_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL,
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  tool_use_id text NOT NULL,
  action_id text NOT NULL,
  tool_args_fingerprint text NOT NULL,
  contract_fingerprint text NOT NULL,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'claimed' CHECK (state IN (
    'claimed',
    'dispatched',
    'verified',
    'failed',
    'outcome_unknown'
  )),
  claim_token uuid NOT NULL DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version BETWEEN 1 AND 1000000),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count BETWEEN 1 AND 10000),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT agent_action_calls_tool_name_shape CHECK (
    char_length(tool_name) BETWEEN 1 AND 120
    AND tool_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_tool_use_id_shape CHECK (
    char_length(tool_use_id) BETWEEN 1 AND 180
    AND tool_use_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_action_id_shape CHECK (
    char_length(action_id) BETWEEN 1 AND 180
    AND action_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_idempotency_key_shape CHECK (
    char_length(idempotency_key) BETWEEN 8 AND 180
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  CONSTRAINT agent_action_calls_tool_args_fingerprint_shape CHECK (
    tool_args_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT agent_action_calls_contract_fingerprint_shape CHECK (
    contract_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
  ),
  CONSTRAINT agent_action_calls_metadata_shape CHECK (
    jsonb_typeof(metadata) = 'object'
    AND octet_length(metadata::text) <= 4096
  ),
  CONSTRAINT agent_action_calls_expiry_order CHECK (expires_at > claimed_at),
  CONSTRAINT agent_action_calls_state_timeline CHECK (
    (state = 'claimed' AND dispatched_at IS NULL AND finished_at IS NULL)
    OR (state = 'dispatched' AND dispatched_at IS NOT NULL AND finished_at IS NULL)
    OR (
      state IN ('verified', 'outcome_unknown')
      AND dispatched_at IS NOT NULL
      AND finished_at IS NOT NULL
    )
    OR (
      state = 'failed'
      AND dispatched_at IS NULL
      AND finished_at IS NOT NULL
    )
  ),
  CONSTRAINT agent_action_calls_finish_order CHECK (
    dispatched_at IS NULL OR dispatched_at >= claimed_at
  ),
  CONSTRAINT agent_action_calls_terminal_order CHECK (
    finished_at IS NULL OR finished_at >= COALESCE(dispatched_at, claimed_at)
  )
);

-- One durable idempotency key cannot move to another action, and one provider
-- call/action id cannot evade the first claim by minting another key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_calls_idempotency
  ON public.agent_action_calls(user_id, circle_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_calls_tool_use
  ON public.agent_action_calls(run_id, tool_use_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_action_calls_action
  ON public.agent_action_calls(run_id, action_id);
CREATE INDEX IF NOT EXISTS idx_agent_action_calls_run_created
  ON public.agent_action_calls(run_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_action_calls_open_expiry
  ON public.agent_action_calls(state, expires_at)
  WHERE state IN ('claimed', 'dispatched', 'outcome_unknown');

ALTER TABLE public.agent_action_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_action_calls_owner_read ON public.agent_action_calls;
CREATE POLICY agent_action_calls_owner_read
  ON public.agent_action_calls
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.agent_action_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_action_calls TO authenticated;

-- Primitive-only, per-key metadata sanitizer used at both write RPCs.
-- Each key has one exact type plus an enum or bounded token format. URIs,
-- queries, free-form content, secrets, emails, and POSIX/Windows paths are
-- dropped before the database boundary and recorded with redacted=true.
CREATE OR REPLACE FUNCTION public._sanitize_agent_action_call_metadata(
  p_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_output jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_text text;
  v_redacted boolean := false;
BEGIN
  IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_key, v_value IN
    SELECT entry.key, entry.value
    FROM jsonb_each(p_metadata) AS entry
    ORDER BY entry.key
  LOOP
    IF NOT (
      v_key = ANY(ARRAY[
        'surface',
        'risk',
        'approvalId',
        'observationEpochId',
        'verificationKind',
        'errorCode',
        'recoveryCode',
        'evidenceCount',
        'blockerCount',
        'completionVerified',
        'outcomeUnknown',
        'source',
        'actor',
        'redacted'
      ]::text[])
    ) THEN
      v_redacted := true;
      CONTINUE;
    END IF;

    IF v_key = 'redacted' THEN
      IF v_value = 'true'::jsonb THEN v_redacted := true; END IF;
      CONTINUE;
    END IF;

    IF v_key IN (
      'completionVerified',
      'outcomeUnknown'
    ) THEN
      IF jsonb_typeof(v_value) = 'boolean' THEN
        v_output := v_output || jsonb_build_object(v_key, v_value);
      ELSE
        v_redacted := true;
      END IF;
      CONTINUE;
    END IF;

    IF v_key IN (
      'evidenceCount',
      'blockerCount'
    ) THEN
      IF (
        jsonb_typeof(v_value) = 'number'
        AND (v_value #>> '{}') ~ '^[0-9]+$'
        AND (v_value #>> '{}')::numeric BETWEEN 0 AND 10000
      ) THEN
        v_output := v_output || jsonb_build_object(v_key, v_value);
      ELSE
        v_redacted := true;
      END IF;
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_value) <> 'string' THEN
      v_redacted := true;
      CONTINUE;
    END IF;

    v_text := v_value #>> '{}';
    IF (
      v_text = ''
      OR char_length(v_text) > 240
      OR v_text <> btrim(v_text)
      OR v_text ~ '[[:cntrl:][:space:]]'
      OR v_text ~* (
        'bearer[[:space:]]+[a-z0-9._~+/-]+'
        '|(api|access|refresh|session)[ _-]?token[[:space:]]*[:=]'
        '|(api[ _-]?key|password|passcode|secret|credential)[[:space:]]*[:=]'
        '|(sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{8,}'
        '|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
        '|^[a-z][a-z0-9+.-]*:'
        '|(^|[?&])[a-z0-9_.~-]{1,64}=[^&[:space:]]*'
        '|^/'
        '|^[a-z]:[\\/]'
        '|^\\\\'
        '|(^|[\\/])users[\\/][^\\/[:space:]]+'
        '|%userprofile%'
        '|~[\\/]'
        '|[<>{}\[\]"''`]'
      )
    ) THEN
      v_redacted := true;
      CONTINUE;
    END IF;

    IF v_key = 'surface' THEN
      IF v_text = ANY(ARRAY[
        'browser',
        'desktop',
        'vault',
        'terminal',
        'file',
        'code',
        'research',
        'approval',
        'system'
      ]::text[]) THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'risk' THEN
      IF v_text = ANY(ARRAY['low', 'medium', 'high', 'critical']::text[]) THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'approvalId' THEN
      IF v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        v_output := v_output || jsonb_build_object(v_key, lower(v_text));
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'observationEpochId' THEN
      IF char_length(v_text) BETWEEN 1 AND 180
        AND v_text ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'verificationKind' THEN
      IF v_text = ANY(ARRAY[
        'app_state',
        'accessibility',
        'browser_dom',
        'artifact',
        'visual'
      ]::text[]) THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key IN ('errorCode', 'recoveryCode') THEN
      IF char_length(v_text) BETWEEN 1 AND 80
        AND v_text ~ '^[a-z][a-z0-9_.:-]*$'
      THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'source' THEN
      IF v_text = 'openswan_tool_runtime' THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSIF v_key = 'actor' THEN
      IF v_text = 'user_authorized_agent' THEN
        v_output := v_output || jsonb_build_object(v_key, v_text);
      ELSE
        v_redacted := true;
      END IF;
    ELSE
      v_redacted := true;
    END IF;
  END LOOP;

  IF v_redacted THEN
    v_output := v_output || '{"redacted":true}'::jsonb;
  END IF;
  IF octet_length(v_output::text) > 4096 THEN
    RETURN '{"redacted":true}'::jsonb;
  END IF;
  RETURN v_output;
END;
$$;

CREATE OR REPLACE FUNCTION public._agent_action_call_identity_input_valid(
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT
    char_length(COALESCE(p_tool_name, '')) BETWEEN 1 AND 120
    AND p_tool_name ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND char_length(COALESCE(p_tool_use_id, '')) BETWEEN 1 AND 180
    AND p_tool_use_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND char_length(COALESCE(p_action_id, '')) BETWEEN 1 AND 180
    AND p_action_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND char_length(COALESCE(p_idempotency_key, '')) BETWEEN 8 AND 180
    AND p_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND p_tool_args_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND p_contract_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'
$$;

CREATE OR REPLACE FUNCTION public._agent_action_call_payload(
  p_call public.agent_action_calls,
  p_disposition text,
  p_include_claim_token boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', p_disposition,
    'id', p_call.id,
    'state', p_call.state,
    'userId', p_call.user_id,
    'circleId', p_call.circle_id,
    'runId', p_call.run_id,
    'tool', p_call.tool_name,
    'toolUseId', p_call.tool_use_id,
    'actionId', p_call.action_id,
    'toolArgsFingerprint', p_call.tool_args_fingerprint,
    'contractFingerprint', p_call.contract_fingerprint,
    'idempotencyKey', p_call.idempotency_key,
    'claimedAt', p_call.claimed_at,
    'expiresAt', p_call.expires_at,
    'dispatchedAt', p_call.dispatched_at,
    'finishedAt', p_call.finished_at,
    'stateVersion', p_call.state_version,
    'attemptCount', p_call.attempt_count,
    'metadata', p_call.metadata
  ) || CASE
    WHEN p_include_claim_token
      THEN jsonb_build_object('claimToken', p_call.claim_token)
    ELSE '{}'::jsonb
  END
$$;

CREATE OR REPLACE FUNCTION public._agent_action_call_error(
  p_code text,
  p_message text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', false,
    'code', left(regexp_replace(COALESCE(p_code, 'invalid_input'), '[[:cntrl:]]+', ' ', 'g'), 80),
    'message', left(regexp_replace(COALESCE(p_message, 'Durable action call refused.'), '[[:cntrl:]]+', ' ', 'g'), 240)
  )
$$;

REVOKE ALL ON FUNCTION public._sanitize_agent_action_call_metadata(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agent_action_call_identity_input_valid(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agent_action_call_payload(public.agent_action_calls, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._agent_action_call_error(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_agent_action_call(
  p_user_id uuid,
  p_circle_id uuid,
  p_run_id uuid,
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_ttl_seconds integer := LEAST(GREATEST(COALESCE(p_ttl_seconds, 120), 15), 900);
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
  v_inserted boolean := false;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN public._agent_action_call_error(
      'not_authenticated',
      'The durable action claim is not bound to the authenticated user.'
    );
  END IF;
  IF NOT public._agent_action_call_identity_input_valid(
    p_tool_name,
    p_tool_use_id,
    p_action_id,
    p_tool_args_fingerprint,
    p_contract_fingerprint,
    p_idempotency_key
  ) THEN
    RETURN public._agent_action_call_error(
      'invalid_input',
      'The durable action claim has an invalid exact-call identity or SHA-256 binding.'
    );
  END IF;
  PERFORM 1
  FROM public.agent_runs AS run
  WHERE run.id = p_run_id
    AND run.user_id = p_user_id
    AND run.circle_id = p_circle_id;
  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'run_identity_mismatch',
      'The durable action claim does not match the authenticated parent run.'
    );
  END IF;

  BEGIN
    INSERT INTO public.agent_action_calls (
      user_id,
      circle_id,
      run_id,
      tool_name,
      tool_use_id,
      action_id,
      tool_args_fingerprint,
      contract_fingerprint,
      idempotency_key,
      metadata,
      claimed_at,
      expires_at,
      updated_at
    )
    VALUES (
      p_user_id,
      p_circle_id,
      p_run_id,
      p_tool_name,
      p_tool_use_id,
      p_action_id,
      p_tool_args_fingerprint,
      p_contract_fingerprint,
      p_idempotency_key,
      v_metadata,
      v_now,
      v_now + make_interval(secs => v_ttl_seconds),
      v_now
    )
    ON CONFLICT (user_id, circle_id, idempotency_key) DO NOTHING
    RETURNING * INTO v_call;
    v_inserted := FOUND;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent call may have won the tool_use_id/action_id constraint.
    -- Resolve and compare that committed row below; never retry the insert.
    v_inserted := false;
  END;

  IF v_inserted THEN
    RETURN public._agent_action_call_payload(v_call, 'claimed', true);
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE (
      action_call.user_id = p_user_id
      AND action_call.circle_id = p_circle_id
      AND action_call.idempotency_key = p_idempotency_key
    )
    OR (
      action_call.run_id = p_run_id
      AND action_call.tool_use_id = p_tool_use_id
    )
    OR (
      action_call.run_id = p_run_id
      AND action_call.action_id = p_action_id
    )
  ORDER BY
    CASE
      WHEN action_call.user_id = p_user_id
        AND action_call.circle_id = p_circle_id
        AND action_call.idempotency_key = p_idempotency_key
      THEN 0
      ELSE 1
    END,
    action_call.claimed_at
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'identity_conflict',
      'A concurrent durable action identity conflict was detected; no dispatch is authorized.'
    );
  END IF;
  IF (
    v_call.user_id <> p_user_id
    OR v_call.circle_id <> p_circle_id
    OR v_call.run_id <> p_run_id
    OR v_call.tool_name <> p_tool_name
    OR v_call.tool_use_id <> p_tool_use_id
    OR v_call.action_id <> p_action_id
    OR v_call.tool_args_fingerprint <> p_tool_args_fingerprint
    OR v_call.contract_fingerprint <> p_contract_fingerprint
    OR v_call.idempotency_key <> p_idempotency_key
  ) THEN
    RETURN public._agent_action_call_error(
      'identity_conflict',
      'This tool call, action, or idempotency key is already bound to another durable identity.'
    );
  END IF;

  IF v_call.state = 'claimed' AND v_call.expires_at <= v_now THEN
    UPDATE public.agent_action_calls
    SET
      claim_token = gen_random_uuid(),
      metadata = v_call.metadata || v_metadata,
      state_version = state_version + 1,
      attempt_count = attempt_count + 1,
      claimed_at = v_now,
      expires_at = v_now + make_interval(secs => v_ttl_seconds),
      updated_at = v_now
    WHERE id = v_call.id
    RETURNING * INTO v_call;
    RETURN public._agent_action_call_payload(v_call, 'claimed', true);
  END IF;

  IF v_call.state = 'claimed' THEN
    RETURN public._agent_action_call_payload(v_call, 'already_claimed', true);
  END IF;
  RETURN public._agent_action_call_payload(v_call, 'duplicate', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_agent_action_call(
  p_user_id uuid,
  p_circle_id uuid,
  p_run_id uuid,
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN public._agent_action_call_error(
      'not_authenticated',
      'The durable action start is not bound to the authenticated user.'
    );
  END IF;
  IF p_claim_token IS NULL OR NOT public._agent_action_call_identity_input_valid(
    p_tool_name,
    p_tool_use_id,
    p_action_id,
    p_tool_args_fingerprint,
    p_contract_fingerprint,
    p_idempotency_key
  ) THEN
    RETURN public._agent_action_call_error(
      'invalid_input',
      'The durable action start has an invalid claim token or exact-call identity.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.user_id = p_user_id
    AND action_call.circle_id = p_circle_id
    AND action_call.run_id = p_run_id
    AND action_call.tool_name = p_tool_name
    AND action_call.tool_use_id = p_tool_use_id
    AND action_call.action_id = p_action_id
    AND action_call.tool_args_fingerprint = p_tool_args_fingerprint
    AND action_call.contract_fingerprint = p_contract_fingerprint
    AND action_call.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.agent_action_calls AS conflict
      WHERE (
          conflict.user_id = p_user_id
          AND conflict.circle_id = p_circle_id
          AND conflict.idempotency_key = p_idempotency_key
        )
        OR (conflict.run_id = p_run_id AND conflict.tool_use_id = p_tool_use_id)
        OR (conflict.run_id = p_run_id AND conflict.action_id = p_action_id)
    ) THEN
      RETURN public._agent_action_call_error(
        'identity_conflict',
        'The durable action start does not match the originally claimed identity.'
      );
    END IF;
    RETURN public._agent_action_call_error(
      'claim_not_found',
      'No durable claim exists for this exact action call.'
    );
  END IF;
  IF v_call.claim_token <> p_claim_token THEN
    RETURN public._agent_action_call_error(
      'claim_token_mismatch',
      'The durable action claim token does not match.'
    );
  END IF;
  IF v_call.state <> 'claimed' THEN
    RETURN public._agent_action_call_payload(v_call, 'duplicate', false);
  END IF;
  IF v_call.expires_at <= v_now THEN
    RETURN public._agent_action_call_error(
      'claim_expired',
      'The durable action claim expired before handler entry; claim the same exact call again.'
    );
  END IF;

  UPDATE public.agent_action_calls
  SET
    state = 'dispatched',
    state_version = state_version + 1,
    dispatched_at = v_now,
    expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
    updated_at = v_now
  WHERE id = v_call.id
    AND state = 'claimed'
    AND claim_token = p_claim_token
  RETURNING * INTO v_call;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'state_conflict',
      'Another worker changed the durable action state before handler entry.'
    );
  END IF;
  RETURN public._agent_action_call_payload(v_call, 'started', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_agent_action_call(
  p_user_id uuid,
  p_circle_id uuid,
  p_run_id uuid,
  p_tool_name text,
  p_tool_use_id text,
  p_action_id text,
  p_tool_args_fingerprint text,
  p_contract_fingerprint text,
  p_idempotency_key text,
  p_claim_token uuid,
  p_final_state text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN public._agent_action_call_error(
      'not_authenticated',
      'The durable action finish is not bound to the authenticated user.'
    );
  END IF;
  IF (
    p_claim_token IS NULL
    OR p_final_state NOT IN ('verified', 'failed', 'outcome_unknown')
    OR NOT public._agent_action_call_identity_input_valid(
      p_tool_name,
      p_tool_use_id,
      p_action_id,
      p_tool_args_fingerprint,
      p_contract_fingerprint,
      p_idempotency_key
    )
  ) THEN
    RETURN public._agent_action_call_error(
      'invalid_input',
      'The durable action finish has an invalid state, claim token, or exact-call identity.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.user_id = p_user_id
    AND action_call.circle_id = p_circle_id
    AND action_call.run_id = p_run_id
    AND action_call.tool_name = p_tool_name
    AND action_call.tool_use_id = p_tool_use_id
    AND action_call.action_id = p_action_id
    AND action_call.tool_args_fingerprint = p_tool_args_fingerprint
    AND action_call.contract_fingerprint = p_contract_fingerprint
    AND action_call.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'claim_not_found',
      'No durable claim exists for this exact action call.'
    );
  END IF;
  IF v_call.claim_token <> p_claim_token THEN
    RETURN public._agent_action_call_error(
      'claim_token_mismatch',
      'The durable action claim token does not match.'
    );
  END IF;
  IF v_call.state IN ('verified', 'failed', 'outcome_unknown') THEN
    IF v_call.state = p_final_state THEN
      RETURN public._agent_action_call_payload(v_call, 'already_finished', false);
    END IF;
    RETURN public._agent_action_call_error(
      'state_conflict',
      'The durable action already has a different terminal outcome.'
    );
  END IF;
  IF v_call.state = 'claimed' AND p_final_state <> 'failed' THEN
    RETURN public._agent_action_call_error(
      'invalid_transition',
      'Only a known pre-dispatch failure may finish an action that never started.'
    );
  END IF;
  -- Concurrent claimers can temporarily hold the same lease token. Once one
  -- worker wins start, a pre-handler loser must not overwrite its in-flight
  -- dispatched row with failed.
  IF v_call.state = 'dispatched' AND p_final_state = 'failed' THEN
    RETURN public._agent_action_call_error(
      'invalid_transition',
      'A dispatched action cannot become failed; record outcome_unknown unless fresh proof verifies it.'
    );
  END IF;
  IF v_call.state NOT IN ('claimed', 'dispatched') THEN
    RETURN public._agent_action_call_error(
      'invalid_transition',
      'The durable action is not in a finishable state.'
    );
  END IF;

  UPDATE public.agent_action_calls
  SET
    state = p_final_state,
    metadata = metadata || v_metadata,
    state_version = state_version + 1,
    finished_at = v_now,
    expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
    updated_at = v_now
  WHERE id = v_call.id
    AND claim_token = p_claim_token
    AND state = v_call.state
  RETURNING * INTO v_call;

  IF NOT FOUND THEN
    RETURN public._agent_action_call_error(
      'state_conflict',
      'Another worker changed the durable action outcome before finish.'
    );
  END IF;
  RETURN public._agent_action_call_payload(v_call, 'finished', false);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, jsonb, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.claim_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, jsonb, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_agent_action_call(
  uuid, uuid, uuid, text, text, text, text, text, text, uuid, text, jsonb
) TO authenticated;

COMMENT ON TABLE public.agent_action_calls IS
  'Durable exact-call mutation claims. claimed is a handler-entry lease; failed is known pre-dispatch only; dispatched is irreversible handler entry; outcome_unknown must be verified before any retry.';
COMMENT ON COLUMN public.agent_action_calls.metadata IS
  'Primitive-only allowlisted redacted metadata. Raw args, selectors, URLs, paths, content, screenshots, credentials, and provider payloads are forbidden.';

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- §27. Scheduled-action mutation guard (2026-07-26)
-- ═════════════════════════════════════════════════════════════════════════════
-- Source: 20260726_scheduled_action_mutation_guard.sql

-- Scheduled-action mutation guard
--
-- A provider timeout after a request leaves the database unable to distinguish
-- "safe to retry" from "the mutation landed but its response was lost".  These
-- additive columns persist the claim and irreversible dispatch boundary so the
-- runner can fail closed without replaying an ambiguous mutation.

ALTER TABLE public.scheduled_actions
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_unknown_at timestamptz;

ALTER TABLE public.scheduled_actions
  ALTER COLUMN requires_approval SET DEFAULT true,
  ALTER COLUMN max_retries SET DEFAULT 0;

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint AS con
  JOIN pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_namespace AS ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'public'
    AND rel.relname = 'scheduled_actions'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  ORDER BY con.oid
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.scheduled_actions DROP CONSTRAINT %I',
      constraint_name
    );
  END IF;

  ALTER TABLE public.scheduled_actions
    ADD CONSTRAINT scheduled_actions_status_check
    CHECK (status IN (
      'pending',
      'running',
      'succeeded',
      'failed',
      'canceled',
      'outcome_unknown'
    ));
END
$$;

CREATE INDEX IF NOT EXISTS idx_scheduled_actions_dispatched_unresolved
  ON public.scheduled_actions (dispatched_at)
  WHERE status IN ('running', 'outcome_unknown')
    AND dispatched_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_action_approval_session
  ON public.agent_approvals (session_key)
  WHERE session_key LIKE 'scheduled-action:v2:%';

CREATE OR REPLACE FUNCTION public.guard_scheduled_action_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'scheduled_action approvals are runner-created';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scheduled_action approvals are immutable audit rows';
  END IF;
  IF auth.uid() IS NULL OR OLD.payload->>'userId' <> auth.uid()::text THEN
    RAISE EXCEPTION 'scheduled_action approval resolver mismatch';
  END IF;
  IF (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.session_key IS DISTINCT FROM OLD.session_key
    OR NEW.agent_name IS DISTINCT FROM OLD.agent_name
    OR NEW.action_type IS DISTINCT FROM OLD.action_type
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
    OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
  ) THEN
    RAISE EXCEPTION 'scheduled_action approval binding is immutable';
  END IF;
  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    NEW.resolved_by := auth.uid();
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid scheduled_action approval transition';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_approval_insert
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_scheduled_action_approval_insert
BEFORE INSERT ON public.agent_approvals
FOR EACH ROW
WHEN (NEW.action_type LIKE 'scheduled_action.%')
EXECUTE FUNCTION public.guard_scheduled_action_approval();

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_approval_update
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_scheduled_action_approval_update
BEFORE UPDATE ON public.agent_approvals
FOR EACH ROW
WHEN (
  OLD.action_type LIKE 'scheduled_action.%'
  OR NEW.action_type LIKE 'scheduled_action.%'
)
EXECUTE FUNCTION public.guard_scheduled_action_approval();

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_approval_delete
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_scheduled_action_approval_delete
BEFORE DELETE ON public.agent_approvals
FOR EACH ROW
WHEN (OLD.action_type LIKE 'scheduled_action.%')
EXECUTE FUNCTION public.guard_scheduled_action_approval();

CREATE OR REPLACE FUNCTION public.guard_scheduled_action_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL OR OLD.user_id <> auth.uid() THEN
    RAISE EXCEPTION 'scheduled_action owner mismatch';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.dispatched_at IS NOT NULL
      OR OLD.status IN ('running', 'succeeded', 'outcome_unknown')
    THEN
      RAISE EXCEPTION 'dispatched scheduled_action audit rows are sealed';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.dispatched_at IS NOT NULL THEN
    RAISE EXCEPTION 'dispatched scheduled_action rows are sealed';
  END IF;

  IF OLD.status = 'failed' AND NEW.status = 'pending' THEN
    IF (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR NEW.recurrence IS DISTINCT FROM OLD.recurrence
      OR NEW.recurrence_label IS DISTINCT FROM OLD.recurrence_label
      OR NEW.parent_action_id IS DISTINCT FROM OLD.parent_action_id
      OR NEW.approval_id IS NOT NULL
      OR NEW.claim_token IS NOT NULL
      OR NEW.claimed_at IS NOT NULL
      OR NEW.dispatched_at IS NOT NULL
      OR NEW.outcome_unknown_at IS NOT NULL
      OR NEW.started_at IS NOT NULL
      OR NEW.completed_at IS NOT NULL
      OR NEW.result IS NOT NULL
      OR NEW.error IS NOT NULL
      OR NEW.retry_count <> 0
      OR NEW.max_retries <> 0
      OR NEW.requires_approval IS NOT TRUE
    ) THEN
      RAISE EXCEPTION 'unsafe scheduled_action retry transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'canceled' THEN
    IF (
      NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
      OR NEW.kind IS DISTINCT FROM OLD.kind
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR NEW.claim_token IS NOT NULL
      OR NEW.claimed_at IS NOT NULL
      OR NEW.dispatched_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'unsafe scheduled_action cancellation transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    IF (
      NEW.approval_id IS DISTINCT FROM OLD.approval_id
      OR NEW.claim_token IS NOT NULL
      OR NEW.claimed_at IS NOT NULL
      OR NEW.dispatched_at IS NOT NULL
      OR NEW.outcome_unknown_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'scheduled_action execution state is runner-owned';
    END IF;
    NEW.requires_approval := true;
    NEW.max_retries := 0;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid scheduled_action state transition';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_scheduled_action_state
  ON public.scheduled_actions;
CREATE TRIGGER trg_guard_scheduled_action_state
BEFORE UPDATE OR DELETE ON public.scheduled_actions
FOR EACH ROW
EXECUTE FUNCTION public.guard_scheduled_action_state();

COMMENT ON COLUMN public.scheduled_actions.claim_token IS
  'Opaque lease won by one runner while status moves pending to running.';
COMMENT ON COLUMN public.scheduled_actions.dispatched_at IS
  'Irreversible boundary stamped immediately before the one scheduled mutation attempt. A non-null value forbids replay.';
COMMENT ON COLUMN public.scheduled_actions.outcome_unknown_at IS
  'Terminal ambiguity marker used when a dispatched mutation cannot be verified.';

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- §28. Database authority guards (2026-07-26)
-- ═════════════════════════════════════════════════════════════════════════════
-- Source: 20260726_database_authority_guards.sql

-- Database authority guards
--
-- 1. Office terminal execution is claimed from one canonical durable message.
--    The authenticated claimant must be a current circle member and either own
--    the targeted Office agent or claim the circle-scoped synthetic BlackSwan.
-- 2. Office response streaming and completion are claimant-bound state
--    transitions, not unrestricted SECURITY DEFINER writes.
-- 3. Schema-v2 Chat and OpenSwan/SwanBot approvals are immutable exact-intent
--    audit rows with narrow resolve, expire, and one-shot consume transitions.

-- ─── Office response identity ────────────────────────────────────────────────

ALTER TABLE public.office_terminal_responses
  ADD COLUMN IF NOT EXISTS agent_subject_key text,
  ADD COLUMN IF NOT EXISTS claimant_user_id uuid REFERENCES auth.users(id);

UPDATE public.office_terminal_responses
SET agent_subject_key = 'office-agent:' || agent_id::text
WHERE agent_subject_key IS NULL
  AND agent_id IS NOT NULL;

UPDATE public.office_terminal_responses
SET agent_subject_key = 'legacy-response:' || id::text
WHERE agent_subject_key IS NULL;

ALTER TABLE public.office_terminal_responses
  ALTER COLUMN agent_subject_key SET NOT NULL,
  ALTER COLUMN agent_id DROP NOT NULL;

ALTER TABLE public.office_terminal_responses
  DROP CONSTRAINT IF EXISTS office_terminal_responses_message_agent_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_response_message_subject
  ON public.office_terminal_responses (message_id, agent_subject_key);

CREATE INDEX IF NOT EXISTS idx_terminal_response_claimant
  ON public.office_terminal_responses (claimant_user_id, status)
  WHERE claimant_user_id IS NOT NULL;

-- ─── Office invocation claim ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.invoke_agent(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.invoke_agent(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.invoke_agent(uuid, uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.invoke_agent(
  p_message_id uuid,
  p_circle_id uuid,
  p_expected_command_text text,
  p_agent_id uuid
)
RETURNS TABLE (
  response_id uuid,
  claim_disposition text,
  canonical_message_id uuid,
  canonical_circle_id uuid,
  canonical_sender_id uuid,
  canonical_command_text text,
  canonical_target_agent_id uuid,
  canonical_target_agent_ids uuid[],
  canonical_target_agent_name text,
  canonical_model text,
  canonical_agent_id uuid,
  canonical_agent_subject_key text,
  canonical_agent_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.office_terminal_messages%ROWTYPE;
  v_agent public.circle_office_agents%ROWTYPE;
  v_response_id uuid;
  v_subject_key text;
  v_agent_name text;
  v_target_name text;
  v_is_targeted boolean := false;
  v_disposition text := 'claimed';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'office_invocation_auth_required';
  END IF;
  IF p_message_id IS NULL
    OR p_circle_id IS NULL
    OR p_expected_command_text IS NULL
    OR length(p_expected_command_text) < 1
    OR length(p_expected_command_text) > 100000
  THEN
    RAISE EXCEPTION 'office_invocation_invalid_identity';
  END IF;

  SELECT message_row.*
  INTO v_message
  FROM public.office_terminal_messages AS message_row
  WHERE message_row.id = p_message_id
    AND message_row.circle_id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_invocation_message_not_found';
  END IF;
  IF v_message.command_text IS DISTINCT FROM p_expected_command_text THEN
    RAISE EXCEPTION 'office_invocation_command_mismatch';
  END IF;
  IF v_message.status NOT IN ('pending', 'invoked') THEN
    RAISE EXCEPTION 'office_invocation_message_not_executable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'office_invocation_circle_membership_required';
  END IF;

  v_target_name := lower(btrim(COALESCE(v_message.target_agent_name, '')));
  IF p_agent_id IS NULL THEN
    IF v_message.sender_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'office_invocation_sender_claim_required';
    END IF;
    v_subject_key := 'blackswan';
    v_agent_name := 'BlackSwan';
    v_is_targeted := (
      v_message.target_agent_id IS NULL
      AND (
        v_target_name IN ('all', '@all', 'blackswan', '@blackswan', 'swan', '@swan')
        OR position('blackswan' IN v_target_name) > 0
        OR position('@swan' IN v_target_name) > 0
      )
    );
  ELSE
    SELECT agent_row.*
    INTO v_agent
    FROM public.circle_office_agents AS agent_row
    WHERE agent_row.id = p_agent_id
      AND agent_row.circle_id = p_circle_id
      AND agent_row.owner_id = v_uid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'office_invocation_agent_ownership_required';
    END IF;

    v_subject_key := 'office-agent:' || p_agent_id::text;
    v_agent_name := left(COALESCE(NULLIF(btrim(v_agent.name), ''), 'Office agent'), 120);
    v_is_targeted := (
      v_message.target_agent_id = p_agent_id
      OR p_agent_id = ANY(COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[]))
      OR (
        v_message.target_agent_id IS NULL
        AND cardinality(COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])) = 0
        AND v_target_name IN ('all', '@all')
        AND v_agent.is_published = true
        AND v_agent.status <> 'offline'
      )
    );
  END IF;

  IF NOT v_is_targeted THEN
    RAISE EXCEPTION 'office_invocation_agent_out_of_scope';
  END IF;

  INSERT INTO public.office_terminal_responses (
    message_id,
    agent_id,
    agent_subject_key,
    agent_name,
    circle_id,
    claimant_user_id,
    status
  )
  VALUES (
    v_message.id,
    p_agent_id,
    v_subject_key,
    v_agent_name,
    v_message.circle_id,
    v_uid,
    'pending'
  )
  ON CONFLICT (message_id, agent_subject_key) DO NOTHING
  RETURNING id INTO v_response_id;

  IF v_response_id IS NULL THEN
    SELECT response_row.id
    INTO v_response_id
    FROM public.office_terminal_responses AS response_row
    WHERE response_row.message_id = v_message.id
      AND response_row.agent_subject_key = v_subject_key;
    v_disposition := 'duplicate';
  ELSE
    UPDATE public.office_terminal_messages AS message_row
    SET status = 'invoked',
        invoked_at = COALESCE(message_row.invoked_at, clock_timestamp()),
        updated_at = clock_timestamp()
    WHERE message_row.id = v_message.id
      AND message_row.status = 'pending';
  END IF;

  RETURN QUERY
  SELECT
    v_response_id,
    v_disposition,
    v_message.id,
    v_message.circle_id,
    v_message.sender_id,
    v_message.command_text,
    v_message.target_agent_id,
    v_message.target_agent_ids,
    v_message.target_agent_name,
    v_message.model,
    p_agent_id,
    v_subject_key,
    v_agent_name;
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_agent(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invoke_agent(uuid, uuid, text, uuid)
  TO authenticated;

-- ─── Claimant-bound response state ───────────────────────────────────────────

DROP FUNCTION IF EXISTS public.stream_response(uuid, text, text, bigint, integer);
DROP FUNCTION IF EXISTS public.stream_response(
  uuid, text, text, bigint, integer, text, bigint, bigint, bigint, bigint
);

CREATE OR REPLACE FUNCTION public.stream_response(
  p_response_id uuid,
  p_text text,
  p_status text,
  p_tokens bigint,
  p_latency_ms integer,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_creation_tokens bigint,
  p_cache_read_tokens bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_response public.office_terminal_responses%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'office_response_auth_required';
  END IF;
  IF p_response_id IS NULL
    OR p_status IS NULL
    OR p_status NOT IN ('streaming', 'done', 'error')
    OR p_text IS NULL
    OR length(p_text) > 1000000
    OR p_tokens IS NULL OR p_tokens < 0 OR p_tokens > 1000000000
    OR p_latency_ms IS NOT NULL
      AND (p_latency_ms < 0 OR p_latency_ms > 86400000)
    OR p_model IS NOT NULL AND length(p_model) > 200
    OR p_input_tokens IS NULL OR p_input_tokens < 0 OR p_input_tokens > 1000000000
    OR p_output_tokens IS NULL OR p_output_tokens < 0 OR p_output_tokens > 1000000000
    OR p_cache_creation_tokens IS NULL
      OR p_cache_creation_tokens < 0
      OR p_cache_creation_tokens > 1000000000
    OR p_cache_read_tokens IS NULL
      OR p_cache_read_tokens < 0
      OR p_cache_read_tokens > 1000000000
  THEN
    RAISE EXCEPTION 'office_response_invalid_values';
  END IF;

  SELECT response_row.*
  INTO v_response
  FROM public.office_terminal_responses AS response_row
  WHERE response_row.id = p_response_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_response.claimant_user_id IS DISTINCT FROM v_uid
    OR v_response.status NOT IN ('pending', 'streaming')
  THEN
    RAISE EXCEPTION 'office_response_claim_not_live';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = v_response.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'office_response_circle_membership_required';
  END IF;

  UPDATE public.office_terminal_responses AS response_row
  SET response_text = p_text,
      status = p_status,
      token_count = p_tokens,
      latency_ms = p_latency_ms,
      model = COALESCE(p_model, response_row.model),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      cache_creation_tokens = p_cache_creation_tokens,
      cache_read_tokens = p_cache_read_tokens,
      updated_at = clock_timestamp()
  WHERE response_row.id = p_response_id
    AND response_row.claimant_user_id = v_uid
    AND response_row.status = v_response.status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_response_state_conflict';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.stream_response(
  uuid, text, text, bigint, integer, text, bigint, bigint, bigint, bigint
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stream_response(
  uuid, text, text, bigint, integer, text, bigint, bigint, bigint, bigint
) TO authenticated;

DROP FUNCTION IF EXISTS public.mark_message_done(uuid);

CREATE OR REPLACE FUNCTION public.mark_message_done(p_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_message public.office_terminal_messages%ROWTYPE;
  v_target_name text;
BEGIN
  IF v_uid IS NULL OR p_message_id IS NULL THEN
    RAISE EXCEPTION 'office_completion_auth_required';
  END IF;

  SELECT message_row.*
  INTO v_message
  FROM public.office_terminal_messages AS message_row
  WHERE message_row.id = p_message_id
    AND message_row.status = 'invoked'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = v_message.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'office_completion_circle_membership_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.office_terminal_responses AS response_row
    WHERE response_row.message_id = p_message_id
      AND response_row.claimant_user_id = v_uid
      AND response_row.status IN ('done', 'error')
  ) THEN
    RAISE EXCEPTION 'office_completion_claim_required';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.office_terminal_responses AS response_row
    WHERE response_row.message_id = p_message_id
      AND response_row.status IN ('pending', 'streaming')
  ) THEN
    RETURN false;
  END IF;

  -- Do not let a fast responder close a multi-target message before the other
  -- durable targets have claimed it. Explicit UUID targets must each reach a
  -- terminal response. For @all, use the published non-offline Office roster
  -- dispatched by the client, plus the synthetic BlackSwan subject.
  IF v_message.target_agent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = p_message_id
        AND response_row.agent_subject_key =
          'office-agent:' || v_message.target_agent_id::text
        AND response_row.status IN ('done', 'error')
    )
  THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(
      COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])
    ) AS expected_target(agent_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = p_message_id
        AND response_row.agent_subject_key =
          'office-agent:' || expected_target.agent_id::text
        AND response_row.status IN ('done', 'error')
    )
  ) THEN
    RETURN false;
  END IF;

  v_target_name := lower(btrim(COALESCE(v_message.target_agent_name, '')));
  IF v_message.target_agent_id IS NULL
    AND cardinality(
      COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])
    ) = 0
    AND v_target_name IN ('all', '@all')
    AND EXISTS (
      SELECT 1
      FROM public.circle_office_agents AS expected_agent
      WHERE expected_agent.circle_id = v_message.circle_id
        AND expected_agent.is_published = true
        AND expected_agent.status <> 'offline'
        AND NOT EXISTS (
          SELECT 1
          FROM public.office_terminal_responses AS response_row
          WHERE response_row.message_id = p_message_id
            AND response_row.agent_subject_key =
              'office-agent:' || expected_agent.id::text
            AND response_row.status IN ('done', 'error')
        )
    )
  THEN
    RETURN false;
  END IF;

  IF (
    v_target_name IN ('all', '@all', 'blackswan', '@blackswan', 'swan', '@swan')
    OR (
      cardinality(
        COALESCE(v_message.target_agent_ids, ARRAY[]::uuid[])
      ) > 0
      AND (
        position('blackswan' IN v_target_name) > 0
        OR position('@swan' IN v_target_name) > 0
      )
    )
  )
    AND NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = p_message_id
        AND response_row.agent_subject_key = 'blackswan'
        AND response_row.status IN ('done', 'error')
    )
  THEN
    RETURN false;
  END IF;

  UPDATE public.office_terminal_messages AS message_row
  SET status = 'done',
      updated_at = clock_timestamp()
  WHERE message_row.id = p_message_id
    AND message_row.status = 'invoked';

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_message_done(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_message_done(uuid) TO authenticated;

-- Durable Office execution state is RPC-owned. Keep SELECT and the existing
-- sender DELETE path, but prevent direct REST writes from preempting claims or
-- bypassing claimant/status compare-and-set transitions.
REVOKE INSERT, UPDATE ON TABLE public.office_terminal_responses
  FROM authenticated, anon;
REVOKE UPDATE ON TABLE public.office_terminal_messages
  FROM authenticated, anon;

-- ─── Schema-v2 payload validators ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_valid_chat_v2_approval_payload(
  p_payload jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'approvalIntentFingerprint'
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND p_payload->>'userId'
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND p_payload->>'redacted' = 'true'
    AND length(COALESCE(p_payload->>'source', '')) BETWEEN 1 AND 80
    AND length(COALESCE(p_payload->>'intentKind', '')) BETWEEN 1 AND 80
    AND length(COALESCE(p_payload->>'executionKind', '')) BETWEEN 1 AND 120
    AND length(COALESCE(p_payload->>'risk', '')) BETWEEN 1 AND 40
    AND (
      NOT (p_payload ? 'roomId')
      OR p_payload->'roomId' = 'null'::jsonb
      OR p_payload->>'roomId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND (
      NOT (p_payload ? 'threadId')
      OR p_payload->'threadId' = 'null'::jsonb
      OR p_payload->>'threadId'
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_payload) AS payload_keys(payload_key)
      WHERE payload_key <> ALL (ARRAY[
        'approvalSchemaVersion',
        'approvalIntentFingerprint',
        'source',
        'intentKind',
        'executionKind',
        'risk',
        'userId',
        'roomId',
        'threadId',
        'redacted'
      ])
    )
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_valid_tool_v2_approval_payload(
  p_payload jsonb,
  p_allow_dispatch boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'toolName'
      ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    AND p_payload->>'toolApprovalDigest'
      ~ '^approval-v2:sha256:[0-9a-f]{64}$'
    AND p_payload->>'toolApprovalKey' = p_payload->>'toolApprovalDigest'
    AND p_payload->>'toolApprovalKeyVersion' = '2'
    AND p_payload->>'policyFamily'
      ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    AND p_payload->>'approvalMode' IN ('ask', 'auto')
    AND jsonb_typeof(p_payload->'mutatesState') = 'boolean'
    AND jsonb_typeof(p_payload->'externalSideEffect') = 'boolean'
    AND (
      NOT (p_payload ? 'autoApproveCategory')
      OR p_payload->>'autoApproveCategory'
        ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    )
    AND (
      NOT (p_payload ? 'floorCategory')
      OR p_payload->>'floorCategory'
        ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
    )
    AND (
      (
        NOT p_allow_dispatch
        AND NOT (p_payload ? 'dispatchReceiptSchemaVersion')
        AND NOT (p_payload ? 'dispatchBindingDigest')
        AND NOT (p_payload ? 'dispatchConsumedAt')
      )
      OR (
        p_allow_dispatch
        AND p_payload->>'dispatchReceiptSchemaVersion' = '2'
        AND p_payload->>'dispatchBindingDigest'
          ~ '^authority-v2:sha256:[0-9a-f]{64}$'
        AND p_payload->>'dispatchConsumedAt'
          ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_payload) AS payload_keys(payload_key)
      WHERE payload_key <> ALL (ARRAY[
        'approvalSchemaVersion',
        'toolName',
        'toolApprovalDigest',
        'toolApprovalKey',
        'toolApprovalKeyVersion',
        'policyFamily',
        'approvalMode',
        'mutatesState',
        'externalSideEffect',
        'autoApproveCategory',
        'floorCategory',
        'dispatchReceiptSchemaVersion',
        'dispatchBindingDigest',
        'dispatchConsumedAt'
      ])
    )
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_valid_chat_v2_approval_payload(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_valid_tool_v2_approval_payload(jsonb, boolean)
  FROM PUBLIC, anon, authenticated;

-- ─── Chat schema-v2 approval state machine ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_chat_v2_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old_v2 boolean := false;
  v_new_v2 boolean := false;
  v_expires_at timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_v2 := OLD.action_type LIKE 'chat.%'
      AND OLD.payload->>'approvalSchemaVersion' = '2';
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_v2 := NEW.action_type LIKE 'chat.%'
      AND NEW.payload->>'approvalSchemaVersion' = '2';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'chat_v2_approval_delete_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'chat_v2_approval_auth_required';
  END IF;
  IF TG_OP = 'UPDATE' AND (NOT v_old_v2 OR NOT v_new_v2) THEN
    RAISE EXCEPTION 'chat_v2_approval_schema_conversion_forbidden';
  END IF;
  IF NOT public.is_valid_chat_v2_approval_payload(NEW.payload) THEN
    RAISE EXCEPTION 'chat_v2_approval_payload_invalid';
  END IF;
  IF TG_OP = 'INSERT'
    AND NEW.payload->>'userId' <> v_uid::text
  THEN
    RAISE EXCEPTION 'chat_v2_approval_requester_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = NEW.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'chat_v2_approval_membership_required';
  END IF;
  IF NEW.timeout_seconds IS NULL
    OR NEW.timeout_seconds < 1
    OR NEW.timeout_seconds > 86400
    OR length(NEW.action_type) > 200
    OR length(NEW.session_key) > 240
    OR length(NEW.agent_name) > 160
    OR length(NEW.description) > 500
  THEN
    RAISE EXCEPTION 'chat_v2_approval_values_invalid';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'pending'
      OR NEW.resolved_by IS NOT NULL
      OR NEW.resolved_at IS NOT NULL
      OR NEW.applied_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'chat_v2_approval_insert_must_be_pending';
    END IF;
    NEW.requested_at := clock_timestamp();
    NEW.created_at := COALESCE(NEW.created_at, NEW.requested_at);
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.session_key IS DISTINCT FROM OLD.session_key
    OR NEW.agent_name IS DISTINCT FROM OLD.agent_name
    OR NEW.action_type IS DISTINCT FROM OLD.action_type
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'chat_v2_approval_binding_immutable';
  END IF;

  v_expires_at := OLD.requested_at
    + make_interval(secs => OLD.timeout_seconds);

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF clock_timestamp() >= v_expires_at
      OR OLD.applied_at IS NOT NULL
      OR NEW.applied_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'chat_v2_approval_not_live';
    END IF;
    NEW.resolved_by := v_uid;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('pending', 'approved', 'auto_approved')
    AND NEW.status = 'expired'
  THEN
    IF OLD.payload->>'userId' <> v_uid::text
      OR OLD.applied_at IS NOT NULL
      OR NEW.applied_at IS NOT NULL
      OR clock_timestamp() < v_expires_at
    THEN
      RAISE EXCEPTION 'chat_v2_approval_expiration_forbidden';
    END IF;
    NEW.resolved_by := OLD.resolved_by;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'auto_approved')
    AND NEW.status = OLD.status
    AND OLD.applied_at IS NULL
    AND NEW.applied_at IS NOT NULL
  THEN
    IF OLD.payload->>'userId' <> v_uid::text
      OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
      OR clock_timestamp() >= v_expires_at
    THEN
      RAISE EXCEPTION 'chat_v2_approval_consumption_forbidden';
    END IF;
    NEW.applied_at := clock_timestamp();
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'chat_v2_approval_transition_forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_chat_v2_approval_insert
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_chat_v2_approval_insert
BEFORE INSERT ON public.agent_approvals
FOR EACH ROW
WHEN (
  NEW.action_type LIKE 'chat.%'
  AND NEW.payload->>'approvalSchemaVersion' = '2'
)
EXECUTE FUNCTION public.guard_chat_v2_approval();

DROP TRIGGER IF EXISTS trg_guard_chat_v2_approval_update
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_chat_v2_approval_update
BEFORE UPDATE ON public.agent_approvals
FOR EACH ROW
WHEN (
  (
    OLD.action_type LIKE 'chat.%'
    AND OLD.payload->>'approvalSchemaVersion' = '2'
  )
  OR (
    NEW.action_type LIKE 'chat.%'
    AND NEW.payload->>'approvalSchemaVersion' = '2'
  )
)
EXECUTE FUNCTION public.guard_chat_v2_approval();

DROP TRIGGER IF EXISTS trg_guard_chat_v2_approval_delete
  ON public.agent_approvals;
CREATE TRIGGER trg_guard_chat_v2_approval_delete
BEFORE DELETE ON public.agent_approvals
FOR EACH ROW
WHEN (
  OLD.action_type LIKE 'chat.%'
  AND OLD.payload->>'approvalSchemaVersion' = '2'
)
EXECUTE FUNCTION public.guard_chat_v2_approval();

REVOKE ALL ON FUNCTION public.guard_chat_v2_approval()
  FROM PUBLIC, anon, authenticated;

-- ─── OpenSwan/SwanBot schema-v2 approval state machine ───────────────────────

CREATE OR REPLACE FUNCTION public.guard_tool_v2_run_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old_candidate boolean := false;
  v_new_candidate boolean := false;
  v_expires_at timestamptz;
  v_consumed_at timestamptz;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old_candidate := OLD.payload->>'approvalSchemaVersion' = '2'
      AND (
        OLD.payload ? 'toolName'
        OR OLD.payload ? 'toolApprovalDigest'
      );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_candidate := NEW.payload->>'approvalSchemaVersion' = '2'
      AND (
        NEW.payload ? 'toolName'
        OR NEW.payload ? 'toolApprovalDigest'
      );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tool_v2_approval_delete_forbidden';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'tool_v2_approval_auth_required';
  END IF;
  IF TG_OP = 'UPDATE'
    AND (NOT v_old_candidate OR NOT v_new_candidate)
  THEN
    RAISE EXCEPTION 'tool_v2_approval_schema_conversion_forbidden';
  END IF;
  IF TG_OP = 'INSERT'
    AND NEW.requested_by IS DISTINCT FROM v_uid::text
  THEN
    RAISE EXCEPTION 'tool_v2_approval_requester_mismatch';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = NEW.circle_id
      AND membership.user_id = v_uid
  ) THEN
    RAISE EXCEPTION 'tool_v2_approval_membership_required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.agent_runs AS run_row
    WHERE run_row.id = NEW.run_id
      AND run_row.circle_id = NEW.circle_id
      AND (
        TG_OP <> 'INSERT'
        OR run_row.user_id = v_uid
      )
  ) THEN
    RAISE EXCEPTION 'tool_v2_approval_run_scope_invalid';
  END IF;
  IF NEW.timeout_seconds IS NULL
    OR NEW.timeout_seconds < 1
    OR NEW.timeout_seconds > 86400
    OR length(NEW.title) > 240
    OR length(COALESCE(NEW.description, '')) > 500
    OR COALESCE(NEW.metadata, '{}'::jsonb) <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'tool_v2_approval_values_invalid';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT public.is_valid_tool_v2_approval_payload(NEW.payload, false) THEN
      RAISE EXCEPTION 'tool_v2_approval_payload_invalid';
    END IF;
    IF NEW.status = 'pending' THEN
      IF NEW.payload->>'approvalMode' <> 'ask'
        OR NEW.resolved_by IS NOT NULL
        OR NEW.resolved_at IS NOT NULL
      THEN
        RAISE EXCEPTION 'tool_v2_pending_approval_invalid';
      END IF;
    ELSIF NEW.status = 'auto_approved' THEN
      IF NEW.payload->>'approvalMode' <> 'auto'
        OR NOT (NEW.payload ? 'autoApproveCategory')
        OR NEW.payload ? 'floorCategory'
      THEN
        RAISE EXCEPTION 'tool_v2_auto_approval_invalid';
      END IF;
      NEW.resolved_by := v_uid;
      NEW.resolved_at := clock_timestamp();
    ELSE
      RAISE EXCEPTION 'tool_v2_approval_insert_status_invalid';
    END IF;
    NEW.requested_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.run_id IS DISTINCT FROM OLD.run_id
    OR NEW.step_id IS DISTINCT FROM OLD.step_id
    OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
    OR NEW.approval_kind IS DISTINCT FROM OLD.approval_kind
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.description IS DISTINCT FROM OLD.description
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
    OR NEW.timeout_seconds IS DISTINCT FROM OLD.timeout_seconds
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.metadata IS DISTINCT FROM OLD.metadata
  THEN
    RAISE EXCEPTION 'tool_v2_approval_binding_immutable';
  END IF;

  v_expires_at := OLD.requested_at
    + make_interval(secs => OLD.timeout_seconds);

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR clock_timestamp() >= v_expires_at
    THEN
      RAISE EXCEPTION 'tool_v2_approval_not_live';
    END IF;
    NEW.resolved_by := v_uid;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('pending', 'approved', 'auto_approved')
    AND NEW.status = 'expired'
  THEN
    IF NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
      OR OLD.requested_by <> v_uid::text
      OR NEW.payload IS DISTINCT FROM OLD.payload
      OR clock_timestamp() < v_expires_at
    THEN
      RAISE EXCEPTION 'tool_v2_approval_expiration_forbidden';
    END IF;
    NEW.resolved_by := OLD.resolved_by;
    NEW.resolved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status IN ('approved', 'auto_approved')
    AND NEW.status = OLD.status
    AND NOT (OLD.payload ? 'dispatchBindingDigest')
    AND NEW.payload ? 'dispatchBindingDigest'
  THEN
    IF OLD.requested_by <> v_uid::text
      OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by
      OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at
      OR clock_timestamp() >= v_expires_at
      OR NOT public.is_valid_tool_v2_approval_payload(OLD.payload, false)
      OR NOT public.is_valid_tool_v2_approval_payload(NEW.payload, true)
      OR (
        NEW.payload - ARRAY[
          'dispatchReceiptSchemaVersion',
          'dispatchBindingDigest',
          'dispatchConsumedAt'
        ]::text[]
      ) IS DISTINCT FROM OLD.payload
    THEN
      RAISE EXCEPTION 'tool_v2_approval_consumption_forbidden';
    END IF;

    BEGIN
      v_consumed_at := (NEW.payload->>'dispatchConsumedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'tool_v2_approval_consumed_at_invalid';
    END;
    IF v_consumed_at < OLD.requested_at
      OR v_consumed_at >= v_expires_at
      OR v_consumed_at < clock_timestamp() - interval '5 minutes'
      OR v_consumed_at > clock_timestamp() + interval '30 seconds'
    THEN
      RAISE EXCEPTION 'tool_v2_approval_consumed_at_not_live';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'tool_v2_approval_transition_forbidden';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_insert
  ON public.agent_run_approvals;
CREATE TRIGGER trg_guard_tool_v2_run_approval_insert
BEFORE INSERT ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  NEW.payload->>'approvalSchemaVersion' = '2'
  AND (
    NEW.payload ? 'toolName'
    OR NEW.payload ? 'toolApprovalDigest'
  )
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_update
  ON public.agent_run_approvals;
CREATE TRIGGER trg_guard_tool_v2_run_approval_update
BEFORE UPDATE ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  (
    OLD.payload->>'approvalSchemaVersion' = '2'
    AND (
      OLD.payload ? 'toolName'
      OR OLD.payload ? 'toolApprovalDigest'
    )
  )
  OR (
    NEW.payload->>'approvalSchemaVersion' = '2'
    AND (
      NEW.payload ? 'toolName'
      OR NEW.payload ? 'toolApprovalDigest'
    )
  )
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_delete
  ON public.agent_run_approvals;
CREATE TRIGGER trg_guard_tool_v2_run_approval_delete
BEFORE DELETE ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  OLD.payload->>'approvalSchemaVersion' = '2'
  AND (
    OLD.payload ? 'toolName'
    OR OLD.payload ? 'toolApprovalDigest'
  )
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

REVOKE ALL ON FUNCTION public.guard_tool_v2_run_approval()
  FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.office_terminal_responses.agent_subject_key IS
  'Canonical Office response subject. UUID-backed agents use office-agent:<uuid>; synthetic BlackSwan uses blackswan.';
COMMENT ON COLUMN public.office_terminal_responses.claimant_user_id IS
  'Authenticated user who atomically won this response claim and alone may stream or finish it.';

NOTIFY pgrst, 'reload schema';
-- ═════════════════════════════════════════════════════════════════════════════
-- §29. SwanBot continuation privacy sweeper (2026-07-26)
-- ═════════════════════════════════════════════════════════════════════════════
-- Source: 20260726_swanbot_continuation_privacy.sql

-- SwanBot v2 continuation privacy sweeper
--
-- Continuation checkpoints can contain user text, local paths, tool arguments,
-- and tool results. Current SwanBot v2 stores only a bounded public envelope
-- plus an AES-256-GCM sealed snapshot in agent_runs.metadata.continuation.
-- This migration fails closed around that field:
--
--   1. Active legacy/plaintext, malformed/unsealed, state-incoherent, or
--      expired continuations are atomically closed and can never replay.
--   2. The continuation field is removed in the same compare-and-set update.
--   3. Durable outcome metadata is value-free and uses only stable enums.
--   4. Every swept terminal row repairs its existing run-summary columns to
--      array/integer-safe shapes without copying values into outcome metadata.
--   5. Existing terminal legacy/plaintext checkpoints are scrubbed once when
--      this migration is applied.
--   6. pg_cron repeats the active-row sweep every three minutes when present.

-- Parse only the canonical ISO string emitted by Date#toISOString. Returning
-- NULL (never throwing) lets the validator and sweeper fail closed on hostile
-- or partially migrated JSON.
CREATE OR REPLACE FUNCTION public.parse_swanbot_continuation_timestamp(
  p_value text
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_timestamp timestamptz;
BEGIN
  IF p_value IS NULL
    OR p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN
    RETURN NULL;
  END IF;

  v_timestamp := p_value::timestamptz;
  IF to_char(
    v_timestamp AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) IS DISTINCT FROM p_value
  THEN
    RETURN NULL;
  END IF;
  RETURN v_timestamp;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- Validate only the public, value-free checkpoint envelope. Postgres does not
-- decrypt the snapshot, but it can reject plaintext/extra fields, malformed
-- identity/state/expiry metadata, and a structurally invalid crypto envelope.
CREATE OR REPLACE FUNCTION public.is_valid_swanbot_continuation_envelope(
  p_envelope jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_resume_state text;
  v_pending_count integer;
  v_paused_at timestamptz;
  v_expires_at timestamptz;
  v_snapshot jsonb;
  v_iv bytea;
  v_ciphertext bytea;
BEGIN
  IF p_envelope IS NULL OR jsonb_typeof(p_envelope) <> 'object' THEN
    RETURN false;
  END IF;

  IF NOT (
    p_envelope ?& ARRAY[
      'storageSchemaVersion',
      'encrypted',
      'continuationIdentity',
      'continuationVersion',
      'continuationNonce',
      'resumeState',
      'iter',
      'pendingTools',
      'pendingToolCount',
      'continuationCount',
      'pausedAt',
      'expiresAt',
      'snapshot'
    ]
  ) THEN
    RETURN false;
  END IF;

  -- No plaintext transcript/tool/result fields, nor unknown future fields, may
  -- hitch a ride beside the sealed snapshot.
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_envelope) AS envelope_key(key)
    WHERE NOT (
      envelope_key.key = ANY(ARRAY[
        'storageSchemaVersion',
        'encrypted',
        'continuationIdentity',
        'continuationVersion',
        'continuationNonce',
        'resumeState',
        'dispatchClaimId',
        'dispatchClaimedAt',
        'resumeClaimId',
        'resumeClaimedAt',
        'resumeLeaseExpiresAt',
        'iter',
        'pendingTools',
        'pendingToolCount',
        'continuationCount',
        'pausedAt',
        'expiresAt',
        'snapshot'
      ]::text[])
    )
  ) THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_envelope->'storageSchemaVersion') <> 'number'
    OR p_envelope->>'storageSchemaVersion' <> '1'
    OR p_envelope->'encrypted' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(p_envelope->'continuationVersion') <> 'number'
    OR p_envelope->>'continuationVersion' <> '2'
    OR jsonb_typeof(p_envelope->'continuationIdentity') <> 'string'
    OR jsonb_typeof(p_envelope->'continuationNonce') <> 'string'
    OR (p_envelope->>'continuationIdentity')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR (p_envelope->>'continuationNonce')
      !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  THEN
    RETURN false;
  END IF;

  v_resume_state := p_envelope->>'resumeState';
  IF jsonb_typeof(p_envelope->'resumeState') <> 'string'
    OR v_resume_state NOT IN ('pending', 'dispatch_claimed', 'results_claimed')
  THEN
    RETURN false;
  END IF;

  -- Claim fields are state-exact. A pending snapshot cannot smuggle a prior
  -- claim; a claimed snapshot cannot omit the authority that owns it.
  IF v_resume_state = 'pending' THEN
    IF p_envelope ?| ARRAY[
      'dispatchClaimId',
      'dispatchClaimedAt',
      'resumeClaimId',
      'resumeClaimedAt',
      'resumeLeaseExpiresAt'
    ] THEN
      RETURN false;
    END IF;
  ELSE
    IF NOT (p_envelope ?& ARRAY['dispatchClaimId', 'dispatchClaimedAt'])
      OR jsonb_typeof(p_envelope->'dispatchClaimId') <> 'string'
      OR (p_envelope->>'dispatchClaimId')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'dispatchClaimedAt'
      ) IS NULL
    THEN
      RETURN false;
    END IF;
  END IF;

  IF v_resume_state = 'dispatch_claimed' THEN
    IF p_envelope ?| ARRAY[
      'resumeClaimId',
      'resumeClaimedAt',
      'resumeLeaseExpiresAt'
    ] THEN
      RETURN false;
    END IF;
  ELSIF v_resume_state = 'results_claimed' THEN
    IF NOT (
      p_envelope ?& ARRAY[
        'resumeClaimId',
        'resumeClaimedAt',
        'resumeLeaseExpiresAt'
      ]
    )
      OR jsonb_typeof(p_envelope->'resumeClaimId') <> 'string'
      OR (p_envelope->>'resumeClaimId')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeClaimedAt'
      ) IS NULL
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeLeaseExpiresAt'
      ) IS NULL
      OR public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeLeaseExpiresAt'
      ) <= public.parse_swanbot_continuation_timestamp(
        p_envelope->>'resumeClaimedAt'
      )
    THEN
      RETURN false;
    END IF;
  END IF;

  IF jsonb_typeof(p_envelope->'iter') <> 'number'
    OR (p_envelope->>'iter') !~ '^[1-9][0-9]*$'
    OR (p_envelope->>'iter')::numeric > 1000000
    OR jsonb_typeof(p_envelope->'continuationCount') <> 'number'
    OR (p_envelope->>'continuationCount') !~ '^(0|[1-9][0-9]*)$'
    OR (p_envelope->>'continuationCount')::numeric > 1000000
    OR jsonb_typeof(p_envelope->'pendingToolCount') <> 'number'
    OR (p_envelope->>'pendingToolCount') !~ '^(0|[1-9][0-9]*)$'
    OR jsonb_typeof(p_envelope->'pendingTools') <> 'array'
  THEN
    RETURN false;
  END IF;

  v_pending_count := (p_envelope->>'pendingToolCount')::integer;
  IF v_pending_count < 1
    OR v_pending_count > 40
    OR jsonb_array_length(p_envelope->'pendingTools') <> v_pending_count
  THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_envelope->'pendingTools')
      AS pending_tool(value)
    WHERE jsonb_typeof(pending_tool.value) <> 'object'
      OR NOT (pending_tool.value ?& ARRAY['id', 'name'])
      OR (
        SELECT count(*)
        FROM jsonb_object_keys(pending_tool.value)
      ) <> 2
      OR jsonb_typeof(pending_tool.value->'id') <> 'string'
      OR length(pending_tool.value->>'id') NOT BETWEEN 1 AND 200
      OR jsonb_typeof(pending_tool.value->'name') <> 'string'
      OR length(pending_tool.value->>'name') NOT BETWEEN 1 AND 180
      OR (pending_tool.value->>'name')
        !~ '^[A-Za-z][A-Za-z0-9_-]{0,79}(\.[A-Za-z0-9][A-Za-z0-9._:-]{0,99})?$'
  ) THEN
    RETURN false;
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT pending_tool.value->>'id')
    FROM jsonb_array_elements(p_envelope->'pendingTools')
      AS pending_tool(value)
  ) THEN
    RETURN false;
  END IF;

  v_paused_at := public.parse_swanbot_continuation_timestamp(
    p_envelope->>'pausedAt'
  );
  v_expires_at := public.parse_swanbot_continuation_timestamp(
    p_envelope->>'expiresAt'
  );
  IF v_paused_at IS NULL
    OR v_expires_at IS NULL
    OR v_expires_at IS DISTINCT FROM v_paused_at + interval '10 minutes'
  THEN
    RETURN false;
  END IF;

  v_snapshot := p_envelope->'snapshot';
  IF jsonb_typeof(v_snapshot) <> 'object'
    OR NOT (
      v_snapshot ?& ARRAY[
        'schemaVersion',
        'algorithm',
        'kdf',
        'keyVersion',
        'ivB64',
        'ciphertextB64'
      ]
    )
    OR (
      SELECT count(*)
      FROM jsonb_object_keys(v_snapshot)
    ) <> 6
    OR jsonb_typeof(v_snapshot->'schemaVersion') <> 'number'
    OR v_snapshot->>'schemaVersion' <> '1'
    OR v_snapshot->>'algorithm' <> 'AES-256-GCM'
    OR v_snapshot->>'kdf' <> 'SHA-256'
    OR jsonb_typeof(v_snapshot->'keyVersion') <> 'string'
    OR (v_snapshot->>'keyVersion') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    OR jsonb_typeof(v_snapshot->'ivB64') <> 'string'
    OR jsonb_typeof(v_snapshot->'ciphertextB64') <> 'string'
    OR length(v_snapshot->>'ivB64') <> 16
    OR (v_snapshot->>'ivB64') !~ '^[A-Za-z0-9+/]{16}$'
    OR length(v_snapshot->>'ciphertextB64') < 24
    OR length(v_snapshot->>'ciphertextB64') > 5592428
    OR length(v_snapshot->>'ciphertextB64') % 4 <> 0
    OR (v_snapshot->>'ciphertextB64') !~ '^[A-Za-z0-9+/]+={0,2}$'
  THEN
    RETURN false;
  END IF;

  v_iv := decode(v_snapshot->>'ivB64', 'base64');
  v_ciphertext := decode(v_snapshot->>'ciphertextB64', 'base64');
  IF octet_length(v_iv) <> 12
    OR translate(encode(v_iv, 'base64'), E'\n\r\t ', '')
      <> v_snapshot->>'ivB64'
    OR octet_length(v_ciphertext) < 16
    OR octet_length(v_ciphertext) > 4194320
    OR translate(encode(v_ciphertext, 'base64'), E'\n\r\t ', '')
      <> v_snapshot->>'ciphertextB64'
  THEN
    RETURN false;
  END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.sweep_unsafe_swanbot_continuations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_swept_at timestamptz := clock_timestamp();
  v_swept_count integer := 0;
BEGIN
  WITH candidates AS MATERIALIZED (
    SELECT
      run_row.id,
      run_row.final_stop_reason,
      run_row.metadata->'continuation' AS continuation,
      CASE
        WHEN NOT (run_row.metadata ? 'continuation')
          THEN 'continuation_checkpoint_missing'
        WHEN jsonb_typeof(run_row.metadata->'continuation') <> 'object'
          OR run_row.metadata->'continuation'->'encrypted'
            IS DISTINCT FROM 'true'::jsonb
          THEN 'continuation_checkpoint_legacy_or_unsealed'
        WHEN NOT public.is_valid_swanbot_continuation_envelope(
          run_row.metadata->'continuation'
        )
          THEN 'continuation_checkpoint_malformed'
        WHEN public.parse_swanbot_continuation_timestamp(
          run_row.metadata->'continuation'->>'expiresAt'
        ) <= v_swept_at
          THEN 'continuation_checkpoint_expired'
        ELSE 'continuation_checkpoint_state_mismatch'
      END AS close_reason
    FROM public.agent_runs AS run_row
    WHERE run_row.status = 'running'
      AND run_row.metadata->>'version' = 'swanbot-v2-ai'
      AND run_row.final_stop_reason IN (
        'client_pending',
        'client_dispatching',
        'client_resuming'
      )
      AND (
        NOT (run_row.metadata ? 'continuation')
        OR NOT public.is_valid_swanbot_continuation_envelope(
          run_row.metadata->'continuation'
        )
        OR public.parse_swanbot_continuation_timestamp(
          run_row.metadata->'continuation'->>'expiresAt'
        ) <= v_swept_at
        OR run_row.final_stop_reason IS DISTINCT FROM CASE
          WHEN run_row.metadata->'continuation'->>'resumeState' = 'pending'
            THEN 'client_pending'
          WHEN run_row.metadata->'continuation'->>'resumeState' = 'dispatch_claimed'
            THEN 'client_dispatching'
          WHEN run_row.metadata->'continuation'->>'resumeState' = 'results_claimed'
            THEN 'client_resuming'
          ELSE NULL
        END
      )
  ),
  closed AS (
    UPDATE public.agent_runs AS run_row
    SET status = 'failed',
        final_stop_reason = 'error',
        tool_calls = CASE
          WHEN jsonb_typeof(run_row.tool_calls) = 'array'
            THEN run_row.tool_calls
          ELSE '[]'::jsonb
        END,
        iteration_count = GREATEST(
          COALESCE(run_row.iteration_count, 1),
          1
        ),
        input_tokens = GREATEST(
          COALESCE(run_row.input_tokens, 0::bigint),
          0::bigint
        ),
        output_tokens = GREATEST(
          COALESCE(run_row.output_tokens, 0::bigint),
          0::bigint
        ),
        cached_tokens = GREATEST(
          COALESCE(run_row.cached_tokens, 0::bigint),
          0::bigint
        ),
        completed_at = v_swept_at,
        updated_at = v_swept_at,
        metadata = (
          CASE
            WHEN jsonb_typeof(run_row.metadata) = 'object'
              THEN run_row.metadata
            ELSE '{}'::jsonb
          END
          - ARRAY['continuation', 'continuationResumeOutcome']::text[]
        ) || jsonb_build_object(
          'version', 'swanbot-v2-ai',
          'continuationResumeOutcome', jsonb_build_object(
            'schemaVersion', 1,
            'status', CASE
              WHEN candidate.final_stop_reason = 'client_pending'
                THEN 'failed_before_dispatch'
              ELSE 'outcome_unknown'
            END,
            'reason', candidate.close_reason,
            'replayAllowed', false
          )
        )
    FROM candidates AS candidate
    WHERE run_row.id = candidate.id
      AND run_row.status = 'running'
      AND run_row.final_stop_reason = candidate.final_stop_reason
      AND run_row.metadata->>'version' = 'swanbot-v2-ai'
      AND run_row.metadata->'continuation'
        IS NOT DISTINCT FROM candidate.continuation
    RETURNING run_row.id
  )
  SELECT count(*)::integer
  INTO v_swept_count
  FROM closed;

  RETURN v_swept_count;
END;
$$;

REVOKE ALL ON FUNCTION public.parse_swanbot_continuation_timestamp(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_valid_swanbot_continuation_envelope(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sweep_unsafe_swanbot_continuations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_unsafe_swanbot_continuations()
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_agent_runs_active_swanbot_continuation
  ON public.agent_runs (updated_at)
  WHERE status = 'running'
    AND final_stop_reason IN (
      'client_pending',
      'client_dispatching',
      'client_resuming'
    )
    AND metadata->>'version' = 'swanbot-v2-ai';

-- One-time active cleanup. This uses the same atomic status/metadata CAS as the
-- scheduled job, so a concurrent continuation claim cannot be overwritten.
SELECT public.sweep_unsafe_swanbot_continuations();

-- One-time privacy scrub for every checkpoint on a terminal/non-active row.
-- Terminal work can never resume, so even a valid ciphertext is unnecessary
-- retained data. Historical run status is kept; only the checkpoint is removed.
UPDATE public.agent_runs AS run_row
SET metadata = (
      run_row.metadata
      - ARRAY['continuation', 'continuationResumeOutcome']::text[]
    ) || jsonb_build_object(
      'continuationResumeOutcome', jsonb_build_object(
        'schemaVersion', 1,
        'status', 'checkpoint_scrubbed',
        'reason', CASE
          WHEN jsonb_typeof(run_row.metadata->'continuation') <> 'object'
            OR run_row.metadata->'continuation'->'encrypted'
              IS DISTINCT FROM 'true'::jsonb
            THEN 'continuation_checkpoint_legacy_or_unsealed'
          WHEN public.is_valid_swanbot_continuation_envelope(
            run_row.metadata->'continuation'
          )
            THEN 'continuation_checkpoint_terminal_scrub'
          ELSE 'continuation_checkpoint_malformed'
        END,
        'replayAllowed', false
      )
    ),
    updated_at = clock_timestamp()
WHERE run_row.metadata->>'version' = 'swanbot-v2-ai'
  AND run_row.metadata ? 'continuation'
  AND NOT (
    run_row.status = 'running'
    AND run_row.final_stop_reason IN (
      'client_pending',
      'client_dispatching',
      'client_resuming'
    )
  );

-- Authenticated clients may read their normal RLS-visible run telemetry, but
-- they are never execution authority for a sealed SwanBot v2 checkpoint.
-- Without this trigger, the historical FOR ALL member policy on agent_runs
-- lets a member copy ciphertext to another row or rewrite the continuation
-- state outside the service-role edge function's compare-and-set protocol.
CREATE OR REPLACE FUNCTION public.is_protected_swanbot_v2_continuation_run(
  p_status text,
  p_final_stop_reason text,
  p_metadata jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    p_metadata ? 'continuation'
    OR (
      p_metadata->>'version' = 'swanbot-v2-ai'
      AND p_status = 'running'
      AND p_final_stop_reason IN (
        'client_pending',
        'client_dispatching',
        'client_resuming'
      )
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.guard_swanbot_v2_continuation_run()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old_protected boolean := false;
  v_new_protected boolean := false;
  v_cancelled_at timestamptz;
  v_trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin');
BEGIN
  IF v_trusted_writer THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Keep the predicate helper private without making ordinary authenticated
  -- writes depend on EXECUTE permission for a nested function. The guard is a
  -- security-invoker trigger, so calling the revoked helper here would turn
  -- every agent_runs write into a permission error, including unrelated rows.
  IF TG_OP <> 'INSERT' THEN
    v_old_protected := COALESCE(
      OLD.metadata ? 'continuation'
      OR (
        OLD.metadata->>'version' = 'swanbot-v2-ai'
        AND OLD.status = 'running'
        AND OLD.final_stop_reason IN (
          'client_pending',
          'client_dispatching',
          'client_resuming'
        )
      ),
      false
    );
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new_protected := COALESCE(
      NEW.metadata ? 'continuation'
      OR (
        NEW.metadata->>'version' = 'swanbot-v2-ai'
        AND NEW.status = 'running'
        AND NEW.final_stop_reason IN (
          'client_pending',
          'client_dispatching',
          'client_resuming'
        )
      ),
      false
    );
  END IF;

  IF TG_OP = 'INSERT' AND v_new_protected THEN
    RAISE EXCEPTION 'swanbot_v2_continuation_clone_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' AND v_old_protected THEN
    RAISE EXCEPTION 'swanbot_v2_continuation_delete_forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Preserve the existing two-write STOP UI without granting execution-state
  -- authority. Only the exact owning user may perform running -> cancelled,
  -- and the first write may change only status plus its two terminal timestamps.
  -- In particular, the sealed continuation, claim ids, owner, circle, and every
  -- other metadata/row field must remain byte-identical.
  IF TG_OP = 'UPDATE'
    AND v_old_protected
    AND v_new_protected
    AND OLD.status = 'running'
    AND NEW.status = 'cancelled'
    AND auth.uid() IS NOT NULL
    AND auth.uid() = OLD.user_id
    AND NEW.completed_at IS NOT NULL
    AND NEW.updated_at IS NOT NULL
    AND NEW.completed_at IS DISTINCT FROM OLD.completed_at
    AND NEW.updated_at IS DISTINCT FROM OLD.updated_at
    AND (
      to_jsonb(NEW)
      - ARRAY['status', 'completed_at', 'updated_at']::text[]
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY['status', 'completed_at', 'updated_at']::text[]
    )
  THEN
    RETURN NEW;
  END IF;

  -- The UI follows STOP with one provenance-only metadata merge. Permit it only
  -- once, only for the same owner, and only while every non-provenance field
  -- (including metadata.continuation) remains exact. This is deliberately not a
  -- general metadata escape hatch on protected rows.
  IF TG_OP = 'UPDATE'
    AND v_old_protected
    AND v_new_protected
    AND OLD.status = 'cancelled'
    AND NEW.status = 'cancelled'
    AND auth.uid() IS NOT NULL
    AND auth.uid() = OLD.user_id
    AND NEW.updated_at IS NOT NULL
    AND NEW.updated_at IS DISTINCT FROM OLD.updated_at
    AND (OLD.metadata ? 'cancelled_by') IS NOT TRUE
    AND (OLD.metadata ? 'cancelled_at') IS NOT TRUE
    AND (OLD.metadata ? 'cancelled_from') IS NOT TRUE
    AND jsonb_typeof(NEW.metadata->'cancelled_by') = 'string'
    AND NEW.metadata->>'cancelled_by' = 'user'
    AND jsonb_typeof(NEW.metadata->'cancelled_at') = 'string'
    AND length(NEW.metadata->>'cancelled_at') = 24
    AND NEW.metadata->>'cancelled_at'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    AND (
      NOT (NEW.metadata ? 'cancelled_from')
      OR (
        jsonb_typeof(NEW.metadata->'cancelled_from') = 'string'
        AND NEW.metadata->>'cancelled_from' = 'recent_runs_panel'
      )
    )
    AND (
      to_jsonb(NEW)
      - ARRAY['metadata', 'updated_at']::text[]
    ) IS NOT DISTINCT FROM (
      to_jsonb(OLD)
      - ARRAY['metadata', 'updated_at']::text[]
    )
    AND (
      NEW.metadata
      - ARRAY['cancelled_by', 'cancelled_at', 'cancelled_from']::text[]
    ) IS NOT DISTINCT FROM (
      OLD.metadata
      - ARRAY['cancelled_by', 'cancelled_at', 'cancelled_from']::text[]
    )
  THEN
    BEGIN
      v_cancelled_at := (NEW.metadata->>'cancelled_at')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'swanbot_v2_continuation_cancel_provenance_forbidden'
        USING ERRCODE = '42501';
    END;
    IF to_char(
      v_cancelled_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ) IS DISTINCT FROM NEW.metadata->>'cancelled_at'
    THEN
      RAISE EXCEPTION 'swanbot_v2_continuation_cancel_provenance_forbidden'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND (v_old_protected OR v_new_protected)
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'swanbot_v2_continuation_rewrite_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_swanbot_v2_continuation_run
  ON public.agent_runs;
CREATE TRIGGER trg_guard_swanbot_v2_continuation_run
BEFORE INSERT OR UPDATE OR DELETE ON public.agent_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_swanbot_v2_continuation_run();

REVOKE ALL ON FUNCTION public.is_protected_swanbot_v2_continuation_run(
  text,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_swanbot_v2_continuation_run()
  FROM PUBLIC, anon, authenticated;

-- pg_cron is optional in local/self-hosted environments. Unschedule first so
-- rerunning the migration never stacks duplicate jobs.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable; run sweep_unsafe_swanbot_continuations() manually';
  ELSE
    BEGIN
      EXECUTE
        'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
        USING 'sweep-unsafe-swanbot-continuations';
      EXECUTE
        'SELECT cron.schedule($1, $2, $3)'
        USING
          'sweep-unsafe-swanbot-continuations',
          '*/3 * * * *',
          'SELECT public.sweep_unsafe_swanbot_continuations()';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron unavailable; run sweep_unsafe_swanbot_continuations() manually';
    END;
  END IF;
END;
$cron$;

COMMENT ON FUNCTION public.sweep_unsafe_swanbot_continuations() IS
  'Service-only privacy/no-replay sweeper for unsafe or expired SwanBot v2 continuation checkpoints.';
COMMENT ON FUNCTION public.guard_swanbot_v2_continuation_run() IS
  'Prevents authenticated clients from cloning, deleting, or rewriting protected SwanBot v2 continuation execution state.';

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
-- §30. Memory security convergence, RLS fixes, and hot-path indexes (2026-07-28)
-- ═════════════════════════════════════════════════════════════════════════════
-- Source: 20260728_memory_security_and_indexes.sql (mirrored byte-for-byte)

-- Memory system: security convergence, RLS correctness, and hot-path indexes.
--
-- The memory subsystem accreted across ~14 migrations between 20260408 and
-- 20260518. Several of them rewrite the SAME policy names with DIFFERENT
-- predicates, and none of them are in the docs/AGENTS_ROADMAP.md §5 applied
-- checklist. That means nobody can tell which revision production is running,
-- and at least one interim revision is actively unsafe.
--
-- This migration is a CONVERGENCE migration. It does not assume any particular
-- prior state: it drops every historical policy name it knows about and then
-- writes one authoritative set, so re-applying it lands on the same result
-- regardless of which revision is currently live and regardless of the order
-- other memory migrations ran in.
--
-- Covered (numbers match the review findings):
--   1. memory_entries authoritative policy set (4 competing revisions)
--   2. circle_memory / circle_memory_history — USING(true) convergence + DELETE
--   3. memory_evaluations RLS ignores memory visibility
--   4. memory_access_log INSERTs silently rejected (USING with no WITH CHECK)
--   5. dead tsvector FTS index replaced with trigram indexes the callers can use
--   6. hot-path sort indexes + memory_access_log retention
--   7. SET search_path on SECURITY DEFINER maintenance functions
--   8. soft-delete data-retention hazard — DOCUMENTED ONLY, see the bottom
--
-- Everything here is idempotent: IF NOT EXISTS, DROP POLICY IF EXISTS then
-- CREATE, CREATE OR REPLACE, and existence-guarded ALTER. Safe to run
-- repeatedly and safe to run before or after any other pending migration.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0. RUN THIS FIRST — human verification query (does not run automatically)
-- ═══════════════════════════════════════════════════════════════════════════════
-- Before applying, capture what production actually has. We cannot infer it:
-- four migrations write the same policy names on memory_entries, and the §5
-- checklist has never tracked any of them.
--
-- Paste this into the Supabase SQL Editor, save the output, THEN apply this
-- migration. The saved output is your rollback reference and the only record of
-- which revision was live.
--
--   SELECT
--     tablename,
--     policyname,
--     cmd,
--     roles,
--     qual        AS using_expression,
--     with_check  AS with_check_expression
--   FROM pg_policies
--   WHERE schemaname = 'public'
--     AND tablename IN (
--       'memory_entries',
--       'memory_sources',
--       'memory_evaluations',
--       'memory_access_log',
--       'memory_soul_links',
--       'soul_wisdom',
--       'circle_memory',
--       'circle_memory_history'
--     )
--   ORDER BY tablename, policyname, cmd;
--
-- The single most important thing to look for on `memory_entries`:
--
--   policyname = 'memory_select_private'
--
--   * SAFE (owner-only, from 20260413_agent_memory_private_owner_only.sql):
--       (visibility = 'private') AND (user_id = auth.uid())
--
--   * UNSAFE (interim revision 20260413_agent_memory_private_rls.sql:50-65):
--       ... OR (scope = 'agent' AND circle_id IN (SELECT circle_id FROM
--       circle_members WHERE user_id = auth.uid()))
--     ^ this lets ANY circle member SELECT visibility='private' agent
--       memories. If production shows this, private agent memory has been
--       readable circle-wide for the entire window since it was applied, and
--       that window needs an incident note — applying this migration closes the
--       hole but does not undo any reads that already happened.
--
-- Two other things worth reading off the same output:
--   * circle_memory / circle_memory_history with `qual = true` means the
--     original USING(true) policy from 20260226_hitl.sql is STILL LIVE and every
--     authenticated user in the product can read and write every circle's
--     memory doc. Section 2 below closes that.
--   * memory_entries `visibility` CHECK constraint differs between the two
--     historical base tables (20260408_unified_agent_runs.sql allows
--     room_shared/org_shared; 20260411_memory_entries_standalone.sql allows
--     'public' instead). Confirm with:
--       SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--       WHERE conrelid = 'public.memory_entries'::regclass AND contype = 'c';


-- ═══════════════════════════════════════════════════════════════════════════════
-- 0b. Prerequisite memory_entries columns — no-op when present
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: the policies and indexes below reference three columns that the base
-- table did not ship with — `visibility`
-- (20260408_memory_v2_retrieval_privacy.sql), `agent_id`
-- (20260411_agent_memory_scope.sql) and `importance`
-- (20260408_memory_privacy_fix.sql). None of those migrations is in the §5
-- checklist, so we cannot assume they ran. CREATE POLICY / CREATE INDEX fail
-- hard on a missing column, which would abort this whole file.
--
-- Defaults match the source migrations exactly. This is additive only and a
-- no-op wherever the columns already exist — it does not reconcile a divergent
-- CHECK constraint (see the note at the end of section 0).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memory_entries'
      AND column_name = 'visibility'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN visibility text NOT NULL DEFAULT 'circle_shared'
      CHECK (visibility IN ('private','room_shared','circle_shared','org_shared'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memory_entries'
      AND column_name = 'agent_id'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN agent_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'memory_entries'
      AND column_name = 'importance'
  ) THEN
    ALTER TABLE memory_entries ADD COLUMN importance numeric(3,2) DEFAULT 0.5;
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. memory_entries — one authoritative policy set
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: four migrations rewrite these policy names with different predicates:
--   20260408_memory_privacy_fix.sql            → "memory_entries_access" (FOR ALL, scope-based)
--   20260408_memory_v2_retrieval_privacy.sql   → memory_select_* (visibility-based, owner-only private)
--   20260413_agent_memory_private_rls.sql      → memory_select_private LEAKS private agent memory circle-wide
--   20260413_agent_memory_private_owner_only.sql → owner-only (the intended end state)
-- plus two competing base tables that ship "memory_via_circle" / "memory_read".
--
-- Because Postgres ORs permissive policies together, a single surviving legacy
-- policy re-opens everything the later ones closed. So: drop every name any
-- revision ever created, then write the owner-only set. Predicates below are the
-- 20260413_..._owner_only.sql set, unchanged — this migration does not invent new
-- access rules, it just makes that revision the guaranteed terminal state.

DROP POLICY IF EXISTS "memory_via_circle"     ON memory_entries;  -- 20260408_unified_agent_runs.sql
DROP POLICY IF EXISTS "memory_entries_access" ON memory_entries;  -- 20260408_memory_privacy_fix.sql
DROP POLICY IF EXISTS "memory_read"           ON memory_entries;  -- 20260411_memory_entries_standalone.sql
DROP POLICY IF EXISTS "memory_insert"         ON memory_entries;
DROP POLICY IF EXISTS "memory_update"         ON memory_entries;
DROP POLICY IF EXISTS "memory_delete"         ON memory_entries;
DROP POLICY IF EXISTS memory_select_shared    ON memory_entries;
DROP POLICY IF EXISTS memory_select_private   ON memory_entries;
DROP POLICY IF EXISTS memory_insert           ON memory_entries;
DROP POLICY IF EXISTS memory_update           ON memory_entries;
DROP POLICY IF EXISTS memory_delete           ON memory_entries;

ALTER TABLE memory_entries ENABLE ROW LEVEL SECURITY;

-- Shared memory: any member of the owning circle.
CREATE POLICY memory_select_shared ON memory_entries
FOR SELECT TO authenticated
USING (
  visibility IN ('room_shared','circle_shared','org_shared')
  AND circle_id IN (
    SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
  )
);

-- Private memory: the owner and nobody else. This includes scope='agent'
-- private memory — an agent's private working notes belong to the human who
-- ran the agent, not to the circle. Agent-private memory stays cross-session
-- for the same authenticated owner.
CREATE POLICY memory_select_private ON memory_entries
FOR SELECT TO authenticated
USING (
  visibility = 'private'
  AND user_id = auth.uid()
);

-- Writes: private rows must be stamped with the writer's own user_id (agent
-- rows additionally need agent_id + circle membership); shared rows require
-- membership in the target circle.
CREATE POLICY memory_insert ON memory_entries
FOR INSERT TO authenticated
WITH CHECK (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY memory_update ON memory_entries
FOR UPDATE TO authenticated
USING (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
)
WITH CHECK (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
);

CREATE POLICY memory_delete ON memory_entries
FOR DELETE TO authenticated
USING (
  (
    visibility = 'private'
    AND scope IN ('user', 'session')
    AND user_id = auth.uid()
  )
  OR (
    visibility = 'private'
    AND scope = 'agent'
    AND agent_id IS NOT NULL
    AND user_id = auth.uid()
  )
  OR (
    visibility IN ('room_shared','circle_shared','org_shared')
    AND circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  )
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. circle_memory / circle_memory_history — close USING(true), add DELETE
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: both tables shipped with
--     CREATE POLICY circle_memory_auth ... FOR ALL TO authenticated
--       USING (true) WITH CHECK (true)
-- in 20260226_hitl.sql:59 and again in 20260313_missing_tables.sql:278. That is
-- unrestricted cross-tenant read AND write of every circle's memory doc by any
-- signed-in user in the product. Two later migrations fix it
-- (20260325_security_warnings_fix.sql:124-157 and 20260411_memory_cleanup.sql:8-27)
-- but NEITHER is in the §5 checklist, so we cannot assume either ran.
--
-- The two fixes also disagree on names — 20260411 drops
-- circle_memory_select/insert/update (20260325's names) and replaces them with
-- cm_doc_*, but only drops circle_memory_history_auth on the history table
-- without replacing its INSERT policy. So if 20260411 ran and 20260325 did not,
-- circle_memory_history has a SELECT policy and NO INSERT policy, and every
-- client history write silently fails — that write path is live in
-- src/lib/chatCheckpoints.ts:331 and src/services/sharedMemory.ts:175, and
-- circle_memory_history is the ONLY undo for a memory-doc edit
-- (see src/lib/circleMemoryWriteCore.ts:13).
--
-- Convergence: drop every historical name on both tables, then write one
-- per-command set gated on circle membership.

DROP POLICY IF EXISTS "circle_memory_auth"    ON circle_memory;  -- 20260226_hitl.sql — USING(true)
DROP POLICY IF EXISTS "circle_memory_select"  ON circle_memory;  -- 20260325_security_warnings_fix.sql
DROP POLICY IF EXISTS "circle_memory_insert"  ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_update"  ON circle_memory;
DROP POLICY IF EXISTS "circle_memory_delete"  ON circle_memory;
DROP POLICY IF EXISTS "cm_doc_select"         ON circle_memory;  -- 20260411_memory_cleanup.sql
DROP POLICY IF EXISTS "cm_doc_insert"         ON circle_memory;
DROP POLICY IF EXISTS "cm_doc_update"         ON circle_memory;
DROP POLICY IF EXISTS "cm_doc_delete"         ON circle_memory;

ALTER TABLE circle_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_doc_select ON circle_memory
FOR SELECT TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

CREATE POLICY cm_doc_insert ON circle_memory
FOR INSERT TO authenticated
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- WITH CHECK is stated explicitly rather than inherited from USING so a member
-- cannot re-point a row at a circle they do not belong to.
CREATE POLICY cm_doc_update ON circle_memory
FOR UPDATE TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- DELETE was missing entirely, so "delete this memory doc" was impossible
-- through the API and a circle could never actually drop a doc_kind row it no
-- longer wants. Granting it to circle members adds no real authority: a member
-- who can UPDATE can already blank `content` to ''. Circle deletion itself is
-- unaffected either way — the circles(id) FK cascade runs as the system and
-- bypasses RLS.
CREATE POLICY cm_doc_delete ON circle_memory
FOR DELETE TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS "circle_memory_history_auth"   ON circle_memory_history;  -- USING(true)
DROP POLICY IF EXISTS "circle_memory_history_select" ON circle_memory_history;
DROP POLICY IF EXISTS "circle_memory_history_insert" ON circle_memory_history;
DROP POLICY IF EXISTS "cm_history_select"            ON circle_memory_history;
DROP POLICY IF EXISTS "cm_history_insert"            ON circle_memory_history;

ALTER TABLE circle_memory_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY cm_history_select ON circle_memory_history
FOR SELECT TO authenticated
USING (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- Restores the INSERT capability the client undo path depends on, regardless of
-- which of the two prior fixes ran.
CREATE POLICY cm_history_insert ON circle_memory_history
FOR INSERT TO authenticated
WITH CHECK (circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()));

-- DELIBERATELY NO UPDATE/DELETE POLICY ON circle_memory_history.
-- The review flagged the missing DELETE policy on both tables, but these two
-- tables are not symmetric. circle_memory_history is the edit audit trail and
-- the only undo record; letting a member erase it is strictly MORE authority
-- than they have today and is exactly the capability an accountability product
-- must withhold. Append-only is the correct posture. Bulk history trimming, if
-- it is ever wanted, belongs in a service-role retention job like the one in
-- section 6 — not in a client-reachable policy.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 2b. Prerequisite tables — no-op when present
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: sections 3-6 rewrite policies on memory_sources, memory_evaluations and
-- memory_access_log. `DROP POLICY IF EXISTS ... ON t` and `ALTER TABLE t` both
-- still require `t` to exist, so this file would abort on a database that never
-- ran 20260408_memory_v2_retrieval_privacy.sql — which is exactly the state we
-- cannot rule out, since that migration is not in the §5 checklist either.
--
-- These three definitions are copied verbatim from that migration (:80-:158).
-- IF NOT EXISTS makes them a no-op wherever the tables already exist — this
-- does NOT reconcile column drift, it only guarantees the rest of the file can
-- run in any order. memory_entries, circle_memory and circle_memory_history are
-- assumed present; every live app path already depends on them.

CREATE TABLE IF NOT EXISTS memory_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('message','run','step','artifact','approval','manual')),
  source_id uuid,
  excerpt text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_sources_memory ON memory_sources(memory_id);

CREATE TABLE IF NOT EXISTS memory_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  evaluation_kind text NOT NULL CHECK (evaluation_kind IN ('quality','contradiction','sensitivity','durability','manual_review')),
  evaluator text NOT NULL DEFAULT 'auto',
  passed boolean,
  score numeric(3,2),
  feedback text,
  created_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_memory_evaluations_memory ON memory_evaluations(memory_id);

CREATE TABLE IF NOT EXISTS memory_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id uuid NOT NULL REFERENCES memory_entries(id) ON DELETE CASCADE,
  run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  surface text,
  reason text NOT NULL CHECK (reason IN ('startup','retrieval','session_resume','manual_pin','search')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_memory ON memory_access_log(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_access_log_run ON memory_access_log(run_id) WHERE run_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. memory_evaluations — respect the parent memory's visibility
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: 20260408_memory_v2_retrieval_privacy.sql:117-120 gates memory_evaluations
-- on circle membership ALONE:
--     USING (memory_id IN (SELECT id FROM memory_entries
--            WHERE circle_id IN (SELECT circle_id FROM circle_members ...)))
-- It never checks `visibility`. Evaluation rows carry `feedback` text plus
-- quality/contradiction/sensitivity verdicts that an automated evaluator wrote
-- ABOUT the memory, so any circle member can enumerate and read auto-generated
-- commentary on every PRIVATE memory in the circle — including which private
-- memories exist and how many there are.
--
-- The sibling policy memory_sources_access (:91-96) already has the right
-- predicate. This copies it verbatim so the two stay in lockstep. It also
-- restores the private-owner branch that the circle-only predicate dropped, so
-- an owner keeps access to evaluations of their own private memories.

DROP POLICY IF EXISTS memory_evaluations_access ON memory_evaluations;

ALTER TABLE memory_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_evaluations_access ON memory_evaluations
FOR ALL TO authenticated
USING (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
)
WITH CHECK (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
);

-- Same omission exists on memory_sources: the policy is FOR ALL with USING and
-- no WITH CHECK, so INSERT reuses USING. There the predicate happens to be
-- correct for writes too, but stating it explicitly removes the dependency on
-- that coincidence and on the FOR ALL fallback rule.
DROP POLICY IF EXISTS memory_sources_access ON memory_sources;

ALTER TABLE memory_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_sources_access ON memory_sources
FOR ALL TO authenticated
USING (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
)
WITH CHECK (
  memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
);


-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. memory_access_log — stop silently rejecting provenance INSERTs
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: 20260408_memory_v2_retrieval_privacy.sql:164-169 declares
--     CREATE POLICY memory_access_log_access ON memory_access_log FOR ALL
--       USING (user_id = auth.uid() OR run_id IN (...))
-- with NO WITH CHECK. For FOR ALL policies Postgres reuses USING as the INSERT
-- check, so every inserted row must satisfy the READ predicate.
--
-- Three of the four writers cannot satisfy it:
--   * src/lib/memoryService.ts:3297  logMemoryAccess() sends `user_id: userId || null`
--     and no run_id at all
--   * src/lib/memoryService.ts:1080  sends `user_id: opts.userId || null`
--   * src/lib/agentRunSystem.ts:1650  sends `user_id: userId` (undefined → absent)
-- When userId is undefined both sides evaluate NULL/false and the row is
-- rejected. Every writer swallows the error (`.then(() => {})`, `catch {}`), so
-- the failure is silent and provenance simply vanishes. The user-visible
-- symptom is src/lib/memoryActions.ts:265 loadCitationsForMessage() returning
-- nothing — "which memories were used for this message" goes blank with no
-- error anywhere.
--
-- Fix: split read from write and give INSERT its own WITH CHECK. The writer may
-- stamp its own user_id or leave it NULL (a background/system retrieval with no
-- authenticated subject is a legitimate provenance row), but the referenced
-- memory must be one the caller can actually see — that is what stops the log
-- from becoming a private-memory-existence oracle.

DROP POLICY IF EXISTS memory_access_log_access ON memory_access_log;
DROP POLICY IF EXISTS memory_access_log_select ON memory_access_log;
DROP POLICY IF EXISTS memory_access_log_insert ON memory_access_log;

ALTER TABLE memory_access_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY memory_access_log_select ON memory_access_log
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR run_id IN (
    SELECT id FROM agent_runs
    WHERE circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid())
  )
);

CREATE POLICY memory_access_log_insert ON memory_access_log
FOR INSERT TO authenticated
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND memory_id IN (
    SELECT id FROM memory_entries
    WHERE (visibility = 'private' AND user_id = auth.uid())
       OR (visibility IN ('room_shared','circle_shared','org_shared')
           AND circle_id IN (SELECT circle_id FROM circle_members WHERE user_id = auth.uid()))
  )
);

-- DELIBERATELY NO UPDATE/DELETE POLICY. This is an audit trail; nothing in the
-- app updates or deletes rows (only the three inserts above and the read at
-- src/lib/memoryActions.ts:273), and append-only is the point. Retention is
-- handled service-side in section 6.


-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. Keyword search — replace the dead FTS index with trigram indexes
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: 20260408_memory_v2_retrieval_privacy.sql:172-173 builds
--     CREATE INDEX idx_memory_entries_fts ON memory_entries
--       USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')))
-- but NOTHING calls .textSearch() anywhere in src/ or supabase/functions/ — the
-- whole codebase reaches memory keywords through PostgREST `.or()` filters:
--     title.ilike.%term%,content.ilike.%term%
-- (src/lib/memoryService.ts:900, :2684, src/lib/agentMemory.ts:649,
--  src/lib/memoryActions.ts:199).
-- A tsvector GIN index cannot serve an ILIKE '%...%' predicate, so that index
-- has only ever cost write amplification on every memory insert/update and
-- returned zero reads. Meanwhile the ILIKE path is a sequential scan over the
-- circle's memories, and it runs on EVERY turn where the embedding proxy is
-- unavailable (semanticSearchMemories returns [] and memoryService falls back).
--
-- pg_trgm is already enabled repo-wide (20260430_global_search.sql:7) and the
-- same gin_trgm_ops pattern is already used for missions/tasks/goals/messages.
-- This applies it to memory_entries.
--
-- Index shape: separate GIN indexes on title and content so the planner can
-- BitmapOr them for the two-sided `.or()` filter. Partial on is_active = true —
-- all four ILIKE callers pass .eq('is_active', true), and restricting to live
-- rows keeps the index off the soft-deleted backlog. A future caller that omits
-- `is_active = true` will NOT be able to use these.
--
-- Caveat worth knowing: trigram indexes only help for search terms of 3+
-- characters. memoryService.extractSearchTerms already drops shorter tokens.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_memory_entries_title_trgm
  ON memory_entries USING gin (title gin_trgm_ops)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_memory_entries_content_trgm
  ON memory_entries USING gin (content gin_trgm_ops)
  WHERE is_active = true;

-- Drop the dead tsvector index. Provably unused (no .textSearch(), no other
-- to_tsvector reference against memory_entries anywhere in the repo) and purely
-- a write tax. Fully reversible — to restore it:
--   CREATE INDEX IF NOT EXISTS idx_memory_entries_fts ON memory_entries
--     USING gin(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content,'')));
-- If you later want real ranked FTS, prefer a stored generated tsvector column
-- plus .textSearch() over resurrecting this expression index.
DROP INDEX IF EXISTS idx_memory_entries_fts;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 6. Hot-path sort indexes + memory_access_log growth control
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY (memory_entries): the prompt-build reads filter on (circle_id, is_active)
-- and then need an ordered prefix. The only index covering that filter is
--     idx_memory_circle (circle_id, scope, is_active) WHERE is_active = true
-- which puts `scope` BETWEEN the two filter columns and carries neither sort
-- key, so every read still sorts the whole matching set. Two shapes are needed:
--
--   a) importance DESC, updated_at DESC — the ranked read
--      (src/lib/memoryEmbeddings.ts:174 backfill; the same ordering is applied
--       client-side after fetch in src/lib/agentRunSystem.ts:1579, which is
--       exactly the sort that should be pushed into the index)
--   b) scope-filtered created_at DESC — the shared-scope prompt loader
--      (src/lib/agentRunSystem.ts:1401, LIMIT 30 per prompt build)
--
-- NOTE: plain CREATE INDEX takes a SHARE lock that blocks writes to
-- memory_entries for the duration. On a large table run these two statements
-- separately with CONCURRENTLY instead (CONCURRENTLY cannot run inside a
-- transaction block, so it will fail if pasted with the rest of this file).

CREATE INDEX IF NOT EXISTS idx_memory_entries_circle_rank
  ON memory_entries (circle_id, importance DESC, updated_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_memory_entries_circle_scope_recent
  ON memory_entries (circle_id, scope, created_at DESC)
  WHERE is_active = true;

-- WHY (memory_access_log): this table takes 12-15 INSERTs per turn
-- (memoryService.logMemoryAccess slices to 12, agentRunSystem slices to 15) and
-- has no retention policy at all, so it is the fastest-growing table in the
-- memory system and the only one that grows purely with usage.
--
-- Existing indexes cover memory_id and run_id, but the actual read path is
-- src/lib/memoryActions.ts:265 loadCitationsForMessage():
--     .eq('user_id', …).eq('reason','retrieval')
--     .gte('created_at', …).lte('created_at', …).order('created_at' DESC)
-- which nothing supports. And the retention sweep below needs created_at.

CREATE INDEX IF NOT EXISTS idx_memory_access_log_user_created
  ON memory_access_log (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_access_log_created
  ON memory_access_log (created_at);

-- Bounded retention sweep. Deletes only audit-log rows past the retention
-- window — never memory content, never a memory_entries row. Batched so one
-- tick can never take a long lock on a hot table. The 30-day floor and the
-- p_max_rows range check exist so a mistyped call cannot turn this into a
-- table wipe. Service-only: REVOKEd from every client role below, so the sole
-- callers are the cron job and an operator holding the service role.
CREATE OR REPLACE FUNCTION public.prune_memory_access_log(
  p_retain_days int DEFAULT 180,
  p_max_rows int DEFAULT 50000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_retain_days IS NULL OR p_retain_days < 30 THEN
    RAISE EXCEPTION 'prune_memory_access_log_retain_days_below_floor';
  END IF;
  IF p_max_rows IS NULL OR p_max_rows < 1 OR p_max_rows > 500000 THEN
    RAISE EXCEPTION 'prune_memory_access_log_max_rows_out_of_range';
  END IF;

  WITH doomed AS (
    SELECT id
    FROM public.memory_access_log
    WHERE created_at < now() - make_interval(days => p_retain_days)
    ORDER BY created_at
    LIMIT p_max_rows
  )
  DELETE FROM public.memory_access_log l
  USING doomed d
  WHERE l.id = d.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_memory_access_log(int, int)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.prune_memory_access_log(int, int) IS
  'Service-only bounded retention sweep for memory_access_log. Deletes audit rows older than p_retain_days (floor 30) in batches of p_max_rows. Never touches memory content.';

-- pg_cron is optional in local/self-hosted environments. Unschedule first so
-- rerunning this migration never stacks duplicate jobs. Daily at 04:07 UTC —
-- ahead of the 04:42 tick_memory_maintenance job so the two do not overlap.
-- To opt out entirely:
--   SELECT cron.unschedule('prune-memory-access-log');
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'pg_cron unavailable; run prune_memory_access_log() manually';
  ELSE
    BEGIN
      EXECUTE
        'SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = $1'
        USING 'prune-memory-access-log';
      EXECUTE
        'SELECT cron.schedule($1, $2, $3)'
        USING
          'prune-memory-access-log',
          '7 4 * * *',
          'SELECT public.prune_memory_access_log()';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'pg_cron unavailable; run prune_memory_access_log() manually';
    END;
  END IF;
END;
$cron$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 7. SET search_path on the SECURITY DEFINER memory maintenance functions
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: these four run as the definer (superuser-equivalent in Supabase) with an
-- attacker-influenceable search_path:
--     cleanup_stale_session_memories()      20260411_memory_cleanup.sql:34
--     decay_session_memories()              20260419_memory_maintenance.sql:28
--     collapse_near_dup_by_embedding(...)   20260419_memory_maintenance.sql:84
--     tick_memory_maintenance()             20260419_memory_maintenance.sql
-- Every table and operator reference inside them resolves through whatever
-- search_path the caller had, which is the classic SECURITY DEFINER hijack.
-- 20260518_fix_pgcrypto_search_path.sql already established the fix pattern for
-- this repo; this applies it to the memory maintenance surface.
--
-- Two of these ARE client-callable: src/lib/memoryConsolidation.ts:178 and :198
-- call decay_session_memories and collapse_near_dup_by_embedding via
-- supabase.rpc(), and 20260419 GRANTs EXECUTE on all three to `authenticated`.
-- So the hijack path is reachable by any signed-in user today.
--
-- We use ALTER FUNCTION rather than CREATE OR REPLACE on purpose: it changes
-- only the search_path setting and cannot drift the function bodies away from
-- whatever revision production actually has. Guarded by to_regprocedure so a
-- database missing any of them is a no-op rather than an error.
--
-- `extensions` is included because collapse_near_dup_by_embedding uses the
-- pgvector `<=>` operator and the `vector` type, which Supabase installs into
-- the extensions schema. Pinning search_path to `public` alone would BREAK that
-- function.
--
-- NOT CHANGED HERE, but flagged: 20260419 GRANTs EXECUTE on all three to
-- `authenticated`, so any signed-in user can invoke global, cross-circle memory
-- deactivation. tick_memory_maintenance() in particular has no caller in src/
-- or supabase/functions/ and should probably be service-role only. Left alone
-- because revoking is a behavior change beyond this migration's scope and two
-- of the three have live client callers.

DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.cleanup_stale_session_memories()',
    'public.decay_session_memories()',
    'public.collapse_near_dup_by_embedding(uuid, double precision, integer)',
    'public.tick_memory_maintenance()'
  ]
  LOOP
    IF to_regprocedure(fn) IS NOT NULL THEN
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path = public, extensions, pg_catalog',
        fn
      );
    ELSE
      RAISE NOTICE 'search_path fix skipped — % not present', fn;
    END IF;
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════════
-- 8. Soft-delete data retention — PROPOSAL ONLY, NOTHING EXECUTED
-- ═══════════════════════════════════════════════════════════════════════════════
-- Deliberately not implemented. Deleting user data is a product decision, not a
-- migration's call. Written down here so the decision is made once, explicitly,
-- by a human — instead of being rediscovered by the next reviewer.
--
-- THE HAZARD
-- Every user-facing "delete"/"forget" path is a soft delete —
-- `is_active: false` (src/lib/memoryActions.ts:150 forgetMemory,
-- :211 rageForget, src/lib/memoryService.ts:2695). The ON DELETE CASCADE FKs on
-- memory_sources, memory_evaluations, memory_access_log and memory_soul_links
-- therefore NEVER fire. After a user says "forget that", the full `content`,
-- `title`, the 1536-dim `embedding` derived from them, `memory_sources.excerpt`
-- and the entire access history all remain in the table indefinitely. The row is
-- invisible in the UI and still present in the database. That is a truthfulness
-- gap and, for anyone with a deletion obligation, a compliance gap.
--
-- WHY NOT EVEN THE "SAFE HALF" (clearing `embedding` on deactivate)
-- Considered and rejected:
--   * It does not close the gap. The embedding is a lossy derivative; `content`,
--     `title` and `memory_sources.excerpt` — the actual sensitive text — all
--     survive. It buys the appearance of deletion without the substance, which
--     is worse than doing nothing openly.
--   * It silently breaks a working feature. src/lib/memoryActions.ts:237
--     undoRageForget() flips is_active back to true; with the embedding gone the
--     restored memory is invisible to semantic search until an unrelated manual
--     job (memoryEmbeddings.backfillMemoryEmbeddings) happens to run. Undo would
--     appear to succeed and quietly return degraded memory.
--   * collapse_near_dup_by_embedding() deactivates rows automatically. A
--     deactivate-time trigger would make routine maintenance destructive.
--   * It makes a SOFT delete partially HARD, which is the worst of both: not
--     recoverable, not actually deleted.
--
-- PROPOSED REAL FIX (needs a human decision, then its own migration)
--   1. Add `deactivated_at timestamptz` set on the is_active true→false edge, so
--      "how long has this been soft-deleted" is answerable at all. Today it is
--      not — `updated_at` is bumped by unrelated writes.
--   2. Add a service-only, REVOKEd `purge_deactivated_memories(p_older_than
--      interval)` that hard-DELETEs rows deactivated longer than the grace
--      window, letting the existing CASCADEs finally do their job. Grace window
--      must be >= the undo window the UI advertises.
--   3. Give the user-facing "forget" a true hard-delete option distinct from
--      soft delete, and say which one it is in the UI.
--
-- THE INVERSE HAZARD (also unresolved, and it points the other way)
--   memory_entries.user_id is `REFERENCES auth.users(id) ON DELETE CASCADE`
--   (20260408_unified_agent_runs.sql:198 and 20260411_memory_entries_standalone.sql:14).
--   Deleting one user therefore destroys every `circle_shared` memory THEY
--   authored — team knowledge the circle still owns and depends on vanishes when
--   a member leaves. The obvious patch (ON DELETE SET NULL) is not safe as a
--   drop-in either: `visibility='private'` rows are gated on `user_id =
--   auth.uid()`, so a NULLed owner turns them into permanently unreadable
--   orphans that no policy can reach and no purge job targets. A correct fix has
--   to split the two cases — hard-delete the departing user's private rows,
--   re-attribute shared rows to the circle — and that is a product decision
--   about what a departing member's contributions become.


NOTIFY pgrst, 'reload schema';

-- Verify:
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE schemaname='public'
--      AND tablename IN ('memory_entries','memory_sources','memory_evaluations',
--                        'memory_access_log','circle_memory','circle_memory_history')
--    ORDER BY tablename, policyname;
--   SELECT indexname FROM pg_indexes
--    WHERE schemaname='public' AND tablename IN ('memory_entries','memory_access_log')
--    ORDER BY indexname;
--   SELECT p.proname, p.proconfig FROM pg_proc p
--    JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('cleanup_stale_session_memories','decay_session_memories',
--                        'collapse_near_dup_by_embedding','tick_memory_maintenance',
--                        'prune_memory_access_log');
--   SELECT jobname, schedule FROM cron.job WHERE jobname = 'prune-memory-access-log';


-- ═══════════════════════════════════════════════════════════════════════════════
-- §31. Thread-scoped Chat authority and atomic reactions (2026-08-05)
-- Source: 20260805_messages_thread_rls_and_reactions.sql
-- Keep the migration body below byte-aligned with the source migration.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Canonical thread-scoped authority for public.messages.
--
-- Why this is a convergence migration:
--   * the February/March message migrations created both title-cased and
--     lowercase policy names, and permissive PostgreSQL policies are ORed;
--   * every historical SELECT policy stopped at circle membership and leaked
--     private/shared thread messages to other members of the same circle;
--   * the historical UPDATE policy let any circle member rewrite every column
--     on every message, even though it was described as a reactions policy;
--   * thread_id and reply_to were never enforced as same-circle/same-thread
--     lineage at the database boundary.
--
-- Compatibility boundary (intentional and explicit): current authenticated
-- Chat clients create bot rows with user_id = auth.uid() and finalize the bot's
-- persisted metadata by updating that creator-owned row's content. This
-- migration preserves that path. It prevents every *other* member from changing
-- the bot row, but it cannot prove that a creator-authored is_bot=true payload
-- came from a trusted model runtime. Strict bot provenance requires a later
-- trusted server/RPC write lane; blocking creator-owned bot writes here would
-- break current Chat persistence and refresh recovery.

-- A NOT VALID CHECK is enforced for every NEW row immediately while allowing
-- legacy NULL rows to exist long enough for the deterministic repair below.
-- This closes the live-write race between backfill and SET NOT NULL without
-- relying on LOCK TABLE (which is not runnable under psql autocommit).
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_thread_id_convergence_nn;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_thread_id_convergence_nn
  CHECK (thread_id IS NOT NULL) NOT VALID;

-- Existing circle-wide history was already backfilled by
-- 20260414_circle_chat_threads.sql. Repeat only the deterministic legacy repair
-- so partially migrated environments converge before thread_id becomes NOT NULL.
UPDATE public.messages AS message
SET thread_id = thread.id
FROM public.circle_chat_threads AS thread
WHERE message.thread_id IS NULL
  AND thread.circle_id = message.circle_id
  AND thread.visibility = 'circle';

-- Do not guess when lineage is still ambiguous or corrupted. Raising stops the
-- migration before any policy is replaced; under psql autocommit the temporary
-- new-row guard remains fail-closed until the data is repaired and this reruns.
DO $lineage_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    WHERE message.thread_id IS NULL
  ) THEN
    RAISE EXCEPTION 'messages_thread_rls: legacy messages remain without a canonical circle thread'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    JOIN public.circle_chat_threads AS thread ON thread.id = message.thread_id
    WHERE thread.circle_id IS DISTINCT FROM message.circle_id
  ) THEN
    RAISE EXCEPTION 'messages_thread_rls: message/thread circle lineage mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.messages AS message
    JOIN public.messages AS parent ON parent.id = message.reply_to
    WHERE parent.circle_id IS DISTINCT FROM message.circle_id
       OR parent.thread_id IS DISTINCT FROM message.thread_id
  ) THEN
    RAISE EXCEPTION 'messages_thread_rls: reply target is outside the message thread'
      USING ERRCODE = '23514';
  END IF;
END
$lineage_guard$;

ALTER TABLE public.messages
  VALIDATE CONSTRAINT messages_thread_id_convergence_nn;
ALTER TABLE public.messages
  ALTER COLUMN thread_id SET NOT NULL;
ALTER TABLE public.messages
  DROP CONSTRAINT messages_thread_id_convergence_nn;

-- One non-recursive, SECURITY DEFINER visibility predicate for message RLS.
-- A private/shared thread member who has since left the circle is denied: both
-- current circle membership and current thread visibility are required.
CREATE OR REPLACE FUNCTION public.message_thread_visible_to_current_user(
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND p_thread_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      JOIN public.circle_chat_threads AS thread
        ON thread.id = p_thread_id
       AND thread.circle_id = p_circle_id
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
        AND (
          thread.visibility = 'circle'
          OR thread.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.circle_chat_thread_members AS thread_member
            WHERE thread_member.thread_id = thread.id
              AND thread_member.user_id = auth.uid()
          )
        )
    );
$function$;

-- Keep reply validation out of the messages RLS expression itself. Querying
-- public.messages recursively from its own policy can recurse indefinitely.
CREATE OR REPLACE FUNCTION public.message_reply_matches_thread(
  p_reply_to uuid,
  p_circle_id uuid,
  p_thread_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT p_reply_to IS NULL OR EXISTS (
    SELECT 1
    FROM public.messages AS parent
    WHERE parent.id = p_reply_to
      AND parent.circle_id = p_circle_id
      AND parent.thread_id = p_thread_id
  );
$function$;

REVOKE ALL ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_thread_visible_to_current_user(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.message_reply_matches_thread(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_reply_matches_thread(uuid, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.message_reply_matches_thread(uuid, uuid, uuid) TO authenticated;

-- Keep the original helper names safe for any callers outside this migration.
-- Both now require current circle membership and use a fixed search path.
CREATE OR REPLACE FUNCTION public.user_is_circle_member(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = p_circle_id
      AND membership.user_id = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_can_see_chat_thread(p_thread_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = p_thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  );
$function$;

REVOKE ALL ON FUNCTION public.user_is_circle_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_is_circle_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_is_circle_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.user_can_see_chat_thread(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_can_see_chat_thread(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_can_see_chat_thread(uuid) TO authenticated;

-- Invitation checks must be non-recursive: circle_chat_thread_members RLS
-- cannot safely query itself, and circle_members has had recursive policies in
-- older deployments. Bind the invitee, exact thread, and inviting owner here.
CREATE OR REPLACE FUNCTION public.chat_thread_invitee_is_circle_member(
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    JOIN public.circle_members AS membership
      ON membership.circle_id = thread.circle_id
     AND membership.user_id = p_user_id
    WHERE thread.id = p_thread_id
      AND thread.created_by = auth.uid()
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  );
$function$;

REVOKE ALL ON FUNCTION public.chat_thread_invitee_is_circle_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.chat_thread_invitee_is_circle_member(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.chat_thread_invitee_is_circle_member(uuid, uuid) TO authenticated;

-- Every writer, including service role, must keep member roles inside the
-- owning circle. Only created_by may hold role='owner'; invited users are
-- role='member'. Cascading thread deletion remains available because this is an
-- INSERT/UPDATE guard, not a DELETE guard.
CREATE OR REPLACE FUNCTION public.validate_chat_thread_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_circle_id uuid;
  v_created_by uuid;
BEGIN
  SELECT thread.circle_id, thread.created_by
  INTO v_circle_id, v_created_by
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = NEW.thread_id;

  IF NOT FOUND OR NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = v_circle_id
      AND membership.user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'chat_thread_invitee_not_circle_member'
      USING ERRCODE = '42501';
  END IF;

  IF (NEW.role = 'owner' AND NEW.user_id IS DISTINCT FROM v_created_by)
     OR (NEW.role = 'member' AND NEW.user_id = v_created_by) THEN
    RAISE EXCEPTION 'chat_thread_member_role_invalid'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.validate_chat_thread_member() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_chat_thread_member() FROM anon;
REVOKE ALL ON FUNCTION public.validate_chat_thread_member() FROM authenticated;

DROP TRIGGER IF EXISTS trg_validate_chat_thread_member ON public.circle_chat_thread_members;
CREATE TRIGGER trg_validate_chat_thread_member
BEFORE INSERT OR UPDATE ON public.circle_chat_thread_members
FOR EACH ROW
EXECUTE FUNCTION public.validate_chat_thread_member();

-- Direct authenticated updates may rename/archive/configure a private/shared
-- thread, but cannot move it to another circle, transfer created_by, change the
-- default thread's identity, or directly promote visibility. A visibility
-- transition is accepted only as a nested, derived result of the membership
-- trigger and only when the active member count proves the target state.
CREATE OR REPLACE FUNCTION public.guard_authenticated_chat_thread_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_other_member_count integer;
  v_expected_visibility text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Direct authenticated writes may change only the creator-facing settings.
  -- Nested trusted triggers additionally own visibility and thread activity.
  -- This allowlist also freezes lineage and any future columns by default.
  IF pg_trigger_depth() <= 1 AND (
    (to_jsonb(NEW) - 'title' - 'default_model' - 'archived' - 'updated_at')
    IS DISTINCT FROM
    (to_jsonb(OLD) - 'title' - 'default_model' - 'archived' - 'updated_at')
  ) THEN
    RAISE EXCEPTION 'chat_thread_immutable_identity'
      USING ERRCODE = '42501';
  END IF;

  IF pg_trigger_depth() > 1 AND (
    (to_jsonb(NEW)
      - 'title'
      - 'default_model'
      - 'archived'
      - 'updated_at'
      - 'visibility'
      - 'last_message_at'
      - 'last_message_preview')
    IS DISTINCT FROM
    (to_jsonb(OLD)
      - 'title'
      - 'default_model'
      - 'archived'
      - 'updated_at'
      - 'visibility'
      - 'last_message_at'
      - 'last_message_preview')
  ) THEN
    RAISE EXCEPTION 'chat_thread_immutable_identity'
      USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.title IS DISTINCT FROM OLD.title
    OR NEW.default_model IS DISTINCT FROM OLD.default_model
    OR NEW.archived IS DISTINCT FROM OLD.archived
  ) AND OLD.created_by IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'chat_thread_settings_creator_only'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.visibility = 'circle' AND NEW.archived IS TRUE THEN
    RAISE EXCEPTION 'chat_thread_default_cannot_archive'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    IF OLD.visibility = 'circle'
       OR NEW.visibility = 'circle'
       OR pg_trigger_depth() <= 1 THEN
      RAISE EXCEPTION 'chat_thread_direct_visibility_change_denied'
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*)
    INTO v_other_member_count
    FROM public.circle_chat_thread_members AS thread_member
    JOIN public.circle_members AS circle_member
      ON circle_member.user_id = thread_member.user_id
     AND circle_member.circle_id = NEW.circle_id
    WHERE thread_member.thread_id = NEW.id
      AND thread_member.user_id <> NEW.created_by;

    v_expected_visibility := CASE
      WHEN v_other_member_count > 0 THEN 'shared'
      ELSE 'private'
    END;

    IF NEW.visibility IS DISTINCT FROM v_expected_visibility THEN
      RAISE EXCEPTION 'chat_thread_visibility_not_membership_derived'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_authenticated_chat_thread_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_authenticated_chat_thread_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_authenticated_chat_thread_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_guard_authenticated_chat_thread_mutation ON public.circle_chat_threads;
CREATE TRIGGER trg_guard_authenticated_chat_thread_mutation
BEFORE UPDATE ON public.circle_chat_threads
FOR EACH ROW
EXECUTE FUNCTION public.guard_authenticated_chat_thread_mutation();

-- Rebuild the membership-derived visibility trigger as SECURITY DEFINER. This
-- lets an invited member leave and demote the thread even though that member is
-- not created_by. The mutation guard above admits only this nested, proven
-- private/shared transition; direct visibility updates remain denied.
CREATE OR REPLACE FUNCTION public.cct_visibility_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_other_count integer;
  v_thread_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_thread_id := NEW.thread_id;
  ELSE
    v_thread_id := OLD.thread_id;
  END IF;

  SELECT count(*)
  INTO v_other_count
  FROM public.circle_chat_thread_members AS thread_member
  JOIN public.circle_chat_threads AS thread ON thread.id = thread_member.thread_id
  JOIN public.circle_members AS circle_member
    ON circle_member.circle_id = thread.circle_id
   AND circle_member.user_id = thread_member.user_id
  WHERE thread_member.thread_id = v_thread_id
    AND thread_member.user_id <> thread.created_by;

  IF v_other_count > 0 THEN
    UPDATE public.circle_chat_threads
    SET visibility = 'shared', updated_at = now()
    WHERE id = v_thread_id
      AND visibility = 'private';
  ELSE
    UPDATE public.circle_chat_threads
    SET visibility = 'private', updated_at = now()
    WHERE id = v_thread_id
      AND visibility = 'shared';
  END IF;

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.cct_visibility_sync() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cct_visibility_sync() FROM anon;
REVOKE ALL ON FUNCTION public.cct_visibility_sync() FROM authenticated;

-- The original message-touch trigger is retained, but its SECURITY INVOKER
-- function could not update a creator-owned thread when another invited/circle
-- member posted. Replacing the function (the existing trigger keeps its OID)
-- makes recency updates exact, RLS-independent, and non-user-callable.
CREATE OR REPLACE FUNCTION public.circle_chat_threads_touch_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.circle_chat_threads
  SET last_message_at = NEW.created_at,
      last_message_preview = left(COALESCE(NEW.content, ''), 140),
      updated_at = now()
  WHERE id = NEW.thread_id
    AND circle_id = NEW.circle_id
    AND (last_message_at IS NULL OR NEW.created_at >= last_message_at);

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM anon;
REVOKE ALL ON FUNCTION public.circle_chat_threads_touch_on_message() FROM authenticated;

DROP TRIGGER IF EXISTS trg_cct_touch ON public.messages;
CREATE TRIGGER trg_cct_touch
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.circle_chat_threads_touch_on_message();

ALTER TABLE public.circle_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_chat_thread_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cct_read ON public.circle_chat_threads;
DROP POLICY IF EXISTS cct_insert ON public.circle_chat_threads;
DROP POLICY IF EXISTS cct_update ON public.circle_chat_threads;
DROP POLICY IF EXISTS cct_delete ON public.circle_chat_threads;

DO $drop_thread_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circle_chat_threads'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.circle_chat_threads', v_policy.policyname);
  END LOOP;
END
$drop_thread_policies$;

CREATE POLICY cct_read
ON public.circle_chat_threads
FOR SELECT
TO authenticated
USING (
  public.message_thread_visible_to_current_user(circle_id, id)
);

CREATE POLICY cct_insert
ON public.circle_chat_threads
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND visibility = 'private'
  AND public.user_is_circle_member(circle_id)
  AND parent_thread_id IS NULL
  AND lineage_root_id IS NULL
  AND archived IS FALSE
  AND last_message_preview IS NULL
  AND created_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
  AND updated_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
  AND last_message_at BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
);

CREATE POLICY cct_update
ON public.circle_chat_threads
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, id)
)
WITH CHECK (
  created_by = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, id)
);

CREATE POLICY cct_delete
ON public.circle_chat_threads
FOR DELETE
TO authenticated
USING (
  created_by = auth.uid()
  AND visibility <> 'circle'
  AND public.message_thread_visible_to_current_user(circle_id, id)
);

DROP POLICY IF EXISTS cct_members_read ON public.circle_chat_thread_members;
DROP POLICY IF EXISTS cct_members_insert ON public.circle_chat_thread_members;
DROP POLICY IF EXISTS cct_members_update ON public.circle_chat_thread_members;
DROP POLICY IF EXISTS cct_members_delete ON public.circle_chat_thread_members;

DO $drop_thread_member_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'circle_chat_thread_members'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.circle_chat_thread_members', v_policy.policyname);
  END LOOP;
END
$drop_thread_member_policies$;

CREATE POLICY cct_members_read
ON public.circle_chat_thread_members
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
  )
);

CREATE POLICY cct_members_insert
ON public.circle_chat_thread_members
FOR INSERT
TO authenticated
WITH CHECK (
  role = 'member'
  AND added_by = auth.uid()
  AND user_id <> auth.uid()
  AND public.chat_thread_invitee_is_circle_member(thread_id, user_id)
);

CREATE POLICY cct_members_delete
ON public.circle_chat_thread_members
FOR DELETE
TO authenticated
USING (
  role = 'member'
  AND EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = thread_id
      AND public.message_thread_visible_to_current_user(thread.circle_id, thread.id)
      AND (thread.created_by = auth.uid() OR user_id = auth.uid())
  )
);

-- Fill the legacy no-thread caller path with the one unambiguous circle thread,
-- then enforce exact circle/thread/reply lineage for every writer, including
-- service-role writers that bypass RLS. Missing or ambiguous defaults fail closed.
CREATE OR REPLACE FUNCTION public.assign_and_validate_message_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.thread_id IS NULL THEN
    SELECT thread.id
    INTO NEW.thread_id
    FROM public.circle_chat_threads AS thread
    WHERE thread.circle_id = NEW.circle_id
      AND thread.visibility = 'circle';

    IF NEW.thread_id IS NULL THEN
      RAISE EXCEPTION 'messages_thread_required'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = NEW.thread_id
      AND thread.circle_id = NEW.circle_id
  ) THEN
    RAISE EXCEPTION 'messages_thread_circle_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reply_to IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS parent
    WHERE parent.id = NEW.reply_to
      AND parent.circle_id = NEW.circle_id
      AND parent.thread_id = NEW.thread_id
  ) THEN
    RAISE EXCEPTION 'messages_reply_thread_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.assign_and_validate_message_thread() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_and_validate_message_thread() FROM anon;
REVOKE ALL ON FUNCTION public.assign_and_validate_message_thread() FROM authenticated;

DROP TRIGGER IF EXISTS trg_messages_assign_and_validate_thread ON public.messages;
CREATE TRIGGER trg_messages_assign_and_validate_thread
BEFORE INSERT OR UPDATE OF circle_id, thread_id, reply_to
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.assign_and_validate_message_thread();

-- True only when a reactions JSON object changes the authenticated user's own
-- membership. Every other user id, every unchanged key, and every non-reaction
-- column remains outside this helper. It also rejects malformed/new empty keys.
CREATE OR REPLACE FUNCTION public.message_reactions_are_self_only_change(
  p_old_reactions jsonb,
  p_new_reactions jsonb,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_old jsonb := COALESCE(p_old_reactions, '{}'::jsonb);
  v_new jsonb := COALESCE(p_new_reactions, '{}'::jsonb);
  v_key text;
  v_old_values jsonb;
  v_new_values jsonb;
  v_old_other text[];
  v_new_other text[];
  v_new_count integer;
  v_new_distinct_count integer;
  v_changed_key_count integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR jsonb_typeof(v_old) <> 'object'
     OR jsonb_typeof(v_new) <> 'object' THEN
    RETURN false;
  END IF;

  SELECT count(*)
  INTO v_new_count
  FROM jsonb_object_keys(v_new);

  IF v_new_count > 128 OR octet_length(v_new::text) > 65536 THEN
    RETURN false;
  END IF;

  FOR v_key IN
    SELECT key_name
    FROM (
      SELECT jsonb_object_keys(v_old) AS key_name
      UNION
      SELECT jsonb_object_keys(v_new) AS key_name
    ) AS keys
  LOOP
    -- An unchanged legacy key is not rewritten and cannot widen authority.
    IF (v_old ? v_key) AND (v_new ? v_key)
       AND (v_old -> v_key) = (v_new -> v_key) THEN
      CONTINUE;
    END IF;

    v_changed_key_count := v_changed_key_count + 1;
    IF v_changed_key_count > 1 THEN
      RETURN false;
    END IF;

    IF btrim(v_key) = ''
       OR char_length(v_key) > 32
       OR octet_length(v_key) > 128
       OR v_key IN ('__proto__', 'prototype', 'constructor')
       OR EXISTS (
         SELECT 1
         FROM generate_series(1, char_length(v_key)) AS position(index)
         WHERE ascii(substr(v_key, position.index, 1)) < 32
            OR ascii(substr(v_key, position.index, 1)) = 127
       ) THEN
      RETURN false;
    END IF;

    v_old_values := COALESCE(v_old -> v_key, '[]'::jsonb);
    v_new_values := COALESCE(v_new -> v_key, '[]'::jsonb);

    IF jsonb_typeof(v_old_values) <> 'array'
       OR jsonb_typeof(v_new_values) <> 'array' THEN
      RETURN false;
    END IF;

    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_old_values) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_new_values) AS item(value)
      WHERE jsonb_typeof(item.value) <> 'string'
    ) THEN
      RETURN false;
    END IF;

    SELECT count(*), count(DISTINCT item.value)
    INTO v_new_count, v_new_distinct_count
    FROM jsonb_array_elements_text(v_new_values) AS item(value);

    IF v_new_count <> v_new_distinct_count
       OR (v_new ? v_key AND v_new_count = 0) THEN
      RETURN false;
    END IF;

    SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
    INTO v_old_other
    FROM (
      SELECT DISTINCT item.value
      FROM jsonb_array_elements_text(v_old_values) AS item(value)
      WHERE item.value <> p_user_id::text
    ) AS other_users;

    SELECT COALESCE(array_agg(value ORDER BY value), ARRAY[]::text[])
    INTO v_new_other
    FROM (
      SELECT DISTINCT item.value
      FROM jsonb_array_elements_text(v_new_values) AS item(value)
      WHERE item.value <> p_user_id::text
    ) AS other_users;

    IF v_old_other IS DISTINCT FROM v_new_other THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.message_reactions_are_self_only_change(jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.message_reactions_are_self_only_change(jsonb, jsonb, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.message_reactions_are_self_only_change(jsonb, jsonb, uuid) FROM authenticated;

-- RLS decides whether the row is visible; this trigger decides which columns
-- an authenticated user may actually change. Service-role/Postgres maintenance
-- has auth.uid() = NULL and stays compatible. For authenticated clients:
--   * authenticated INSERT timestamps are server-owned;
--   * every UPDATE column except content/reactions is immutable;
--   * content is creator-only (including creator-owned bot finalization);
--   * reactions may only add/remove the caller's own id.
CREATE OR REPLACE FUNCTION public.guard_authenticated_message_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := statement_timestamp();
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - 'content' - 'reactions')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'content' - 'reactions') THEN
    RAISE EXCEPTION 'messages_immutable_identity'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.content IS DISTINCT FROM OLD.content
     AND OLD.user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'messages_content_creator_only'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.reactions IS DISTINCT FROM OLD.reactions
     AND NOT public.message_reactions_are_self_only_change(
       OLD.reactions,
       NEW.reactions,
       v_user_id
     ) THEN
    RAISE EXCEPTION 'messages_reaction_self_only'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.guard_authenticated_message_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_authenticated_message_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.guard_authenticated_message_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_messages_guard_authenticated_mutation ON public.messages;
CREATE TRIGGER trg_messages_guard_authenticated_mutation
BEFORE INSERT OR UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_authenticated_message_mutation();

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Explicitly remove every historical title-cased and lowercase policy name.
-- Quoted identifiers are case-sensitive, so both variants can coexist.
DROP POLICY IF EXISTS "Circle members can read messages" ON public.messages;
DROP POLICY IF EXISTS "Circle members can insert messages" ON public.messages;
DROP POLICY IF EXISTS "Users can update message reactions" ON public.messages;
DROP POLICY IF EXISTS "circle members can read messages" ON public.messages;
DROP POLICY IF EXISTS "users can insert own messages" ON public.messages;
DROP POLICY IF EXISTS "users can update reactions" ON public.messages;
DROP POLICY IF EXISTS "users can delete own messages" ON public.messages;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.messages;
DROP POLICY IF EXISTS "Enable insert for authenticated" ON public.messages;

-- Also converge unknown environment-specific policy drift. Leaving one
-- permissive policy behind would OR it with the canonical predicates below.
DO $drop_message_policies$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.messages', v_policy.policyname);
  END LOOP;
END
$drop_message_policies$;

CREATE POLICY messages_select_thread_visible
ON public.messages
FOR SELECT
TO authenticated
USING (
  public.message_thread_visible_to_current_user(circle_id, thread_id)
);

CREATE POLICY messages_insert_thread_visible
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, thread_id)
  AND public.message_reply_matches_thread(reply_to, circle_id, thread_id)
  AND jsonb_typeof(COALESCE(reactions, '{}'::jsonb)) = 'object'
  AND COALESCE(reactions, '{}'::jsonb) = '{}'::jsonb
);

CREATE POLICY messages_update_thread_visible
ON public.messages
FOR UPDATE
TO authenticated
USING (
  public.message_thread_visible_to_current_user(circle_id, thread_id)
)
WITH CHECK (
  public.message_thread_visible_to_current_user(circle_id, thread_id)
  AND public.message_reply_matches_thread(reply_to, circle_id, thread_id)
);

CREATE POLICY messages_delete_creator_thread_visible
ON public.messages
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.message_thread_visible_to_current_user(circle_id, thread_id)
);

-- Atomic self-reaction mutation. It locks the exact visible row and can only
-- add/remove auth.uid(); callers never submit or replace the full reactions
-- object, so concurrent reactions cannot overwrite one another.
CREATE OR REPLACE FUNCTION public.set_message_reaction(
  p_message_id uuid,
  p_emoji text,
  p_add boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_emoji text := btrim(COALESCE(p_emoji, ''));
  v_reactions jsonb;
  v_users jsonb;
  v_reaction_key_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'messages_reaction_auth_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_add IS NULL
     OR v_emoji = ''
     OR char_length(v_emoji) > 32
     OR octet_length(v_emoji) > 128
     OR v_emoji IN ('__proto__', 'prototype', 'constructor')
     OR EXISTS (
       SELECT 1
       FROM generate_series(1, char_length(v_emoji)) AS position(index)
       WHERE ascii(substr(v_emoji, position.index, 1)) < 32
          OR ascii(substr(v_emoji, position.index, 1)) = 127
     ) THEN
    RAISE EXCEPTION 'messages_reaction_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(message.reactions, '{}'::jsonb)
  INTO v_reactions
  FROM public.messages AS message
  WHERE message.id = p_message_id
    AND public.message_thread_visible_to_current_user(
      message.circle_id,
      message.thread_id
    )
  FOR UPDATE;

  IF NOT FOUND OR jsonb_typeof(v_reactions) <> 'object' THEN
    RAISE EXCEPTION 'messages_reaction_target_unavailable'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)
  INTO v_reaction_key_count
  FROM jsonb_object_keys(v_reactions);

  IF v_reaction_key_count > 128
     OR octet_length(v_reactions::text) > 65536 THEN
    RAISE EXCEPTION 'messages_reaction_state_invalid'
      USING ERRCODE = '22023';
  END IF;

  v_users := COALESCE(v_reactions -> v_emoji, '[]'::jsonb);
  IF jsonb_typeof(v_users) <> 'array'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_users) AS item(value)
       WHERE jsonb_typeof(item.value) <> 'string'
     ) THEN
    RAISE EXCEPTION 'messages_reaction_state_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_add THEN
    IF NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(v_users) AS item(value)
      WHERE item.value = v_user_id::text
    ) THEN
      IF NOT (v_reactions ? v_emoji)
         AND v_reaction_key_count >= 128 THEN
        RAISE EXCEPTION 'messages_reaction_key_limit'
          USING ERRCODE = '22023';
      END IF;
      v_users := v_users || to_jsonb(v_user_id::text);
    END IF;
    v_reactions := jsonb_set(v_reactions, ARRAY[v_emoji], v_users, true);
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(item.value) ORDER BY item.ordinality), '[]'::jsonb)
    INTO v_users
    FROM jsonb_array_elements_text(v_users) WITH ORDINALITY AS item(value, ordinality)
    WHERE item.value <> v_user_id::text;

    IF jsonb_array_length(v_users) = 0 THEN
      v_reactions := v_reactions - v_emoji;
    ELSE
      v_reactions := jsonb_set(v_reactions, ARRAY[v_emoji], v_users, true);
    END IF;
  END IF;

  IF octet_length(v_reactions::text) > 65536 THEN
    RAISE EXCEPTION 'messages_reaction_size_limit'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.messages AS message
  SET reactions = v_reactions
  WHERE message.id = p_message_id;

  RETURN v_reactions;
END
$function$;

REVOKE ALL ON FUNCTION public.set_message_reaction(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_message_reaction(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_message_reaction(uuid, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.set_message_reaction(uuid, text, boolean) IS
  'Atomically add/remove only auth.uid() on one visible thread-scoped message reaction.';

-- Thread INSERT/UPDATE/DELETE drives the sidebar subscription. `messages` was
-- published in 20260221, but circle_chat_threads never was. Guard both the
-- publication and membership so local/self-hosted installs without the
-- Supabase publication remain runnable and re-applying cannot duplicate it.
DO $realtime_publication$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'circle_chat_threads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.circle_chat_threads;
  END IF;
END
$realtime_publication$;

NOTIFY pgrst, 'reload schema';


-- ═══════════════════════════════════════════════════════════════════════════════
-- §32. OpenSwan production readiness contract (2026-08-05)
-- Source: 20260805_openswan_production_readiness_contract.sql
-- Keep the migration body below byte-aligned with the source migration.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Service-role-only, read-only production contract for OpenSwan release checks.
-- The report gets booleans only: no rows, user identifiers, message contents,
-- tokens, or secret values cross the database boundary.

BEGIN;

CREATE OR REPLACE FUNCTION public.openswan_production_readiness_contract()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  WITH checks(id, ok) AS (
    VALUES
      (
        'database.circle_chat_threads',
        to_regclass('public.circle_chat_threads') IS NOT NULL
      ),
      (
        'database.messages_thread_contract',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.messages')
            AND attribute.attname = 'thread_id'
            AND attribute.atttypid = 'uuid'::regtype
            AND attribute.attnotnull
            AND NOT attribute.attisdropped
        )
      ),
      (
        'database.messages_authority',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          WHERE relation.oid = to_regclass('public.messages')
            AND relation.relrowsecurity
        )
        AND (
          SELECT count(*) = 4
            AND count(*) FILTER (
              WHERE policy.policyname IN (
                'messages_select_thread_visible',
                'messages_insert_thread_visible',
                'messages_update_thread_visible',
                'messages_delete_creator_thread_visible'
              )
            ) = 4
          FROM pg_catalog.pg_policies AS policy
          WHERE policy.schemaname = 'public'
            AND policy.tablename = 'messages'
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS trigger
          WHERE trigger.tgrelid = to_regclass('public.messages')
            AND trigger.tgname = 'trg_messages_guard_authenticated_mutation'
            AND trigger.tgenabled <> 'D'
            AND NOT trigger.tgisinternal
        )
      ),
      (
        'database.message_reaction_rpc',
        to_regprocedure('public.set_message_reaction(uuid,text,boolean)') IS NOT NULL
        AND has_function_privilege(
          'authenticated',
          'public.set_message_reaction(uuid,text,boolean)',
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'anon',
          'public.set_message_reaction(uuid,text,boolean)',
          'EXECUTE'
        )
      ),
      (
        'database.thread_realtime',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_publication_tables AS publication
          WHERE publication.pubname = 'supabase_realtime'
            AND publication.schemaname = 'public'
            AND publication.tablename = 'circle_chat_threads'
        )
      ),
      (
        'database.approval_contract',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_approvals')
            AND attribute.attname = 'applied_at'
            AND attribute.atttypid = 'timestamp with time zone'::regtype
            AND NOT attribute.attisdropped
        )
      ),
      (
        'database.agent_run_contract',
        EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'tool_calls'
            AND attribute.atttypid = 'jsonb'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'iteration_count'
            AND attribute.atttypid = 'integer'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'final_stop_reason'
            AND attribute.atttypid = 'text'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'input_tokens'
            AND attribute.atttypid = 'bigint'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'output_tokens'
            AND attribute.atttypid = 'bigint'::regtype
            AND NOT attribute.attisdropped
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS attribute
          WHERE attribute.attrelid = to_regclass('public.agent_runs')
            AND attribute.attname = 'cached_tokens'
            AND attribute.atttypid = 'bigint'::regtype
            AND NOT attribute.attisdropped
        )
      )
  )
  SELECT jsonb_build_object(
    'contractVersion', 1,
    'checks', COALESCE(
      jsonb_agg(
        jsonb_build_object('id', checks.id, 'ok', checks.ok)
        ORDER BY checks.id
      ),
      '[]'::jsonb
    )
  )
  FROM checks;
$function$;

REVOKE ALL ON FUNCTION public.openswan_production_readiness_contract() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.openswan_production_readiness_contract() FROM anon;
REVOKE ALL ON FUNCTION public.openswan_production_readiness_contract() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.openswan_production_readiness_contract() TO service_role;

COMMENT ON FUNCTION public.openswan_production_readiness_contract() IS
  'Return value-free OpenSwan production dependency booleans to service-role release checks.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════
