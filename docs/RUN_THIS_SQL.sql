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
--   §33 Chat v2 approval auto-approve category repair
--   §34 Universal computer-task roots
--   §35 Office terminal nonterminal-handoff sweeper
--   §36 Owner-private Office agent to OpenSwan session bindings
--   §37 Office dashboard state and complete per-floor presets
--   §38 Agent-run immutable parent authority and artifact RLS
--   §39 Exact message-attachment linkage
--   §40 Message-attachment visibility and private Storage integrity
--   §41 Device-private OpenSwan run-approval privacy and authority
--   §42 Office Google/Microsoft OAuth credential control plane
--   §43 Personal Figma OAuth credential and callback control plane
--   §44 Transactional OpenSwan Chat approval-resume authority
--   §45 Owner-private, circle-scoped Office user preferences
--   §46 Circle-global idle-behavior claims
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
    AND (
      NOT (p_payload ? 'autoApproveCategory')
      OR p_payload->'autoApproveCategory' = 'null'::jsonb
      OR (
        jsonb_typeof(p_payload->'autoApproveCategory') = 'string'
        AND p_payload->>'autoApproveCategory' IN (
          'memory_read',
          'memory_write',
          'skill_run',
          'skill_write',
          'automation_create',
          'automation_run',
          'browser_click',
          'external_publish',
          'desktop_action'
        )
      )
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
        'autoApproveCategory',
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- §33. Chat v2 approval auto-approve category repair (2026-08-06)
-- Source: 20260806_chat_v2_approval_auto_approve_category.sql
-- Keep the migration body below byte-aligned with the source migration.
-- ════════════════════════════════════════════════════════════════════════════════

-- Repair the protected Chat approval validator for databases where the
-- 20260726 authority migration was already applied. Chat always emits the
-- bounded autoApproveCategory key (JSON null when no category applies), so the
-- database allowlist must accept that shape without accepting arbitrary labels.

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
    AND (
      NOT (p_payload ? 'autoApproveCategory')
      OR p_payload->'autoApproveCategory' = 'null'::jsonb
      OR (
        jsonb_typeof(p_payload->'autoApproveCategory') = 'string'
        AND p_payload->>'autoApproveCategory' IN (
          'memory_read',
          'memory_write',
          'skill_run',
          'skill_write',
          'automation_create',
          'automation_run',
          'browser_click',
          'external_publish',
          'desktop_action'
        )
      )
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
        'autoApproveCategory',
        'redacted'
      ])
    )
  ), false);
$$;

REVOKE ALL ON FUNCTION public.is_valid_chat_v2_approval_payload(jsonb)
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ═════════════════════════════════════════════════════════════════════════════

-- §34. Universal computer-task roots (2026-08-06)
-- Source: 20260806_universal_computer_task_roots.sql
-- Keep the migration body below byte-aligned with its source file.

-- Universal Computer Task Roots (V1)
--
-- One authenticated, request-bound root is admitted before planning,
-- approval, bridge preparation, or provider execution. The row is
-- coordination state only: it never authorizes a mutation. Every actual
-- side effect still needs its exact tool policy plus agent_action_calls (or a
-- provider idempotency contract), and every task completion still needs an
-- independently validated acceptance receipt.

BEGIN;

DO $dependency$
BEGIN
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'undefined_function',
      MESSAGE = 'Universal computer-task roots require pgcrypto digest(bytea,text) in the extensions schema.';
  END IF;
END;
$dependency$;

CREATE TABLE IF NOT EXISTS public.computer_task_roots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE
    REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL
    REFERENCES public.circles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid
    REFERENCES public.circle_chat_threads(id) ON DELETE RESTRICT,
  schema_version integer NOT NULL DEFAULT 1
    CHECK (schema_version = 1),
  root_fingerprint text NOT NULL
    CHECK (root_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'),
  request_identity_fingerprint text NOT NULL
    CHECK (request_identity_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'),
  task_fingerprint text NOT NULL
    CHECK (task_fingerprint ~ '^args-v2:sha256:[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'admitted'
    CHECK (state IN (
      'admitted',
      'running',
      'waiting_approval',
      'waiting_input',
      'paused',
      'verification_only',
      'completed',
      'failed',
      'cancelled'
    )),
  replay_policy text NOT NULL DEFAULT 'normal'
    CHECK (replay_policy IN ('normal', 'verification_only', 'terminal')),
  revision integer NOT NULL DEFAULT 0
    CHECK (revision BETWEEN 0 AND 2147483647),
  root_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  UNIQUE (user_id, circle_id, request_identity_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_computer_task_roots_circle_updated
  ON public.computer_task_roots(circle_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_computer_task_roots_active
  ON public.computer_task_roots(user_id, circle_id, updated_at DESC)
  WHERE state NOT IN ('completed', 'failed', 'cancelled');

ALTER TABLE public.computer_task_roots ENABLE ROW LEVEL SECURITY;

-- The request fingerprint includes the exact Chat thread. Letting PostgreSQL
-- null that binding would leave an apparently readable root whose immutable
-- snapshot no longer matches its row. Preserve the audit scope instead.
ALTER TABLE public.computer_task_roots
  DROP CONSTRAINT IF EXISTS computer_task_roots_thread_id_fkey;
ALTER TABLE public.computer_task_roots
  ADD CONSTRAINT computer_task_roots_thread_id_fkey
  FOREIGN KEY (thread_id)
  REFERENCES public.circle_chat_threads(id)
  ON DELETE RESTRICT;

DROP POLICY IF EXISTS computer_task_roots_select_exact_actor
  ON public.computer_task_roots;

CREATE POLICY computer_task_roots_select_exact_actor
  ON public.computer_task_roots
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = computer_task_roots.circle_id
        AND member.user_id = auth.uid()
    )
    AND (
      thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = computer_task_roots.thread_id
          AND thread.circle_id = computer_task_roots.circle_id
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
      )
    )
  );

REVOKE ALL ON TABLE public.computer_task_roots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.computer_task_roots TO authenticated;

-- agent_runs historically allows every circle member to update/delete every
-- wrapper row. A computer-task wrapper is coordination state owned by the
-- exact authenticated actor and must only be changed by the SECURITY DEFINER
-- root RPCs. Restrictive policies compose with the legacy permissive policy.
CREATE OR REPLACE FUNCTION public.is_computer_task_root_run_v1(
  p_run_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.computer_task_roots AS root
    WHERE root.run_id = p_run_id
  );
$function$;

REVOKE ALL ON FUNCTION public.is_computer_task_root_run_v1(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_computer_task_root_run_v1(uuid)
  TO authenticated;

DROP POLICY IF EXISTS agent_runs_computer_task_root_update_guard
  ON public.agent_runs;
CREATE POLICY agent_runs_computer_task_root_update_guard
  ON public.agent_runs
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (NOT public.is_computer_task_root_run_v1(id))
  WITH CHECK (NOT public.is_computer_task_root_run_v1(id));

DROP POLICY IF EXISTS agent_runs_computer_task_root_delete_guard
  ON public.agent_runs;
CREATE POLICY agent_runs_computer_task_root_delete_guard
  ON public.agent_runs
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (NOT public.is_computer_task_root_run_v1(id));

CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_timestamp_v1(
  p_value text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_value IS NULL OR p_value !~
    '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  THEN
    RETURN false;
  END IF;

  PERFORM p_value::timestamptz;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_timestamp_v1(text)
  FROM PUBLIC, anon, authenticated;

-- Match the key-sorted JSON serialization used by
-- buildComputerAppToolArgsFingerprintAsync. Root identity payloads contain
-- only bounded ASCII keys/values, booleans, integers, arrays, and JSON null.
CREATE OR REPLACE FUNCTION public.computer_task_root_canonical_json_v1(
  p_value jsonb
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_type text := jsonb_typeof(p_value);
  v_result text;
BEGIN
  IF v_type = 'object' THEN
    SELECT '{' || COALESCE(string_agg(
      to_jsonb(entry.key)::text || ':' ||
        public.computer_task_root_canonical_json_v1(entry.value),
      ',' ORDER BY entry.key COLLATE "C"
    ), '') || '}'
    INTO v_result
    FROM jsonb_each(p_value) AS entry(key, value);
    RETURN v_result;
  END IF;

  IF v_type = 'array' THEN
    SELECT '[' || COALESCE(string_agg(
      public.computer_task_root_canonical_json_v1(entry.value),
      ',' ORDER BY entry.ordinal
    ), '') || ']'
    INTO v_result
    FROM jsonb_array_elements(p_value)
      WITH ORDINALITY AS entry(value, ordinal);
    RETURN v_result;
  END IF;

  RETURN p_value::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.computer_task_root_fingerprint_v1(
  p_value jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
  SELECT 'args-v2:sha256:' || encode(
    extensions.digest(
      convert_to(
        public.computer_task_root_canonical_json_v1(p_value),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

REVOKE ALL ON FUNCTION public.computer_task_root_canonical_json_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.computer_task_root_fingerprint_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_nested_v1(
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_created_at text := p_snapshot->>'createdAt';
  v_updated_at text := p_snapshot->>'updatedAt';
  v_entry jsonb;
  v_index integer;
  v_length integer;
  v_attempt_ids text[] := ARRAY[]::text[];
  v_active_attempt_count integer := 0;
  v_checkpoint_ids text[] := ARRAY[]::text[];
  v_last_checkpoint_at text := NULL;
  v_acceptance jsonb := p_snapshot->'acceptance';
  v_acceptance_attempt_id text := NULL;
  v_acceptance_bound_at text := NULL;
  v_predicate_ids text[] := ARRAY[]::text[];
  v_action_ids text[] := ARRAY[]::text[];
  v_action_state text;
  v_action_id text;
  v_action_frontier_seen boolean := false;
  v_action_manifest jsonb;
  v_action_manifests jsonb := '[]'::jsonb;
  v_dispatch_binding jsonb;
  v_lease jsonb := p_snapshot->'foregroundLease';
  v_latch jsonb := p_snapshot->'interruptLatch';
BEGIN
  IF jsonb_typeof(p_snapshot) <> 'object'
    OR NOT public.is_valid_computer_task_root_timestamp_v1(v_created_at)
    OR NOT public.is_valid_computer_task_root_timestamp_v1(v_updated_at)
    OR jsonb_typeof(p_snapshot->'attempts') <> 'array'
    OR jsonb_typeof(p_snapshot->'checkpoints') <> 'array'
  THEN
    RETURN false;
  END IF;

  v_length := jsonb_array_length(p_snapshot->'attempts');
  IF v_length > 64 THEN
    RETURN false;
  END IF;
  IF v_length > 0 THEN
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := p_snapshot->'attempts'->v_index;
      IF jsonb_typeof(v_entry) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 7
        OR (v_entry - ARRAY[
          'attemptId', 'index', 'kind', 'parentAttemptId', 'state',
          'startedAt', 'finishedAt'
        ]) <> '{}'::jsonb
        OR COALESCE(v_entry->>'attemptId', '')
          !~ '^computer_attempt_[0-9a-f]{64}$'
        OR v_entry->>'attemptId' <> 'computer_attempt_' || substring(
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_attempt',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'index', v_index,
            'kind', v_entry->>'kind',
            'parentAttemptId', v_entry->'parentAttemptId'
          )) FROM 16
        )
        OR v_entry->>'attemptId' = ANY(v_attempt_ids)
        OR jsonb_typeof(v_entry->'index') <> 'number'
        OR COALESCE(v_entry->>'index', '') !~ '^[0-9]{1,10}$'
        OR COALESCE(v_entry->>'kind', '') NOT IN (
          'deterministic', 'provider', 'compiler', 'connected_agent',
          'capability_buildout', 'recovery'
        )
        OR COALESCE(v_entry->>'state', '') NOT IN (
          'active', 'completed', 'failed', 'cancelled'
        )
        OR NOT public.is_valid_computer_task_root_timestamp_v1(
          v_entry->>'startedAt'
        )
        OR v_entry->>'startedAt' < v_created_at
        OR v_entry->>'startedAt' > v_updated_at
      THEN
        RETURN false;
      END IF;
      IF (v_entry->>'index')::bigint <> v_index THEN
        RETURN false;
      END IF;
      IF v_entry->'parentAttemptId' <> 'null'::jsonb
        AND (
          COALESCE(v_entry->>'parentAttemptId', '')
            !~ '^computer_attempt_[0-9a-f]{64}$'
          OR NOT (v_entry->>'parentAttemptId' = ANY(v_attempt_ids))
        )
      THEN
        RETURN false;
      END IF;
      IF v_entry->>'state' = 'active' THEN
        IF v_entry->'finishedAt' <> 'null'::jsonb THEN
          RETURN false;
        END IF;
        v_active_attempt_count := v_active_attempt_count + 1;
        IF v_active_attempt_count > 1 THEN
          RETURN false;
        END IF;
      ELSE
        IF NOT public.is_valid_computer_task_root_timestamp_v1(
            v_entry->>'finishedAt'
          )
          OR v_entry->>'finishedAt' < v_entry->>'startedAt'
          OR v_entry->>'finishedAt' > v_updated_at
        THEN
          RETURN false;
        END IF;
      END IF;
      v_attempt_ids := array_append(v_attempt_ids, v_entry->>'attemptId');
    END LOOP;
  END IF;

  v_length := jsonb_array_length(p_snapshot->'checkpoints');
  IF v_length > 256 THEN
    RETURN false;
  END IF;
  IF v_length > 0 THEN
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := p_snapshot->'checkpoints'->v_index;
      IF jsonb_typeof(v_entry) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 7
        OR (v_entry - ARRAY[
          'checkpointId', 'sequence', 'attemptId', 'kind', 'rootState',
          'recordedAt', 'evidenceFingerprint'
        ]) <> '{}'::jsonb
        OR COALESCE(v_entry->>'checkpointId', '')
          !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
        OR v_entry->>'checkpointId' = ANY(v_checkpoint_ids)
        OR jsonb_typeof(v_entry->'sequence') <> 'number'
        OR COALESCE(v_entry->>'sequence', '') !~ '^[0-9]{1,10}$'
        OR COALESCE(v_entry->>'kind', '') NOT IN (
          'plan', 'observation', 'approval', 'action', 'verification',
          'recovery', 'terminal'
        )
        OR COALESCE(v_entry->>'rootState', '') NOT IN (
          'admitted', 'running', 'waiting_approval', 'waiting_input',
          'paused', 'verification_only', 'completed', 'failed', 'cancelled'
        )
        OR NOT public.is_valid_computer_task_root_timestamp_v1(
          v_entry->>'recordedAt'
        )
        OR v_entry->>'recordedAt' < v_created_at
        OR v_entry->>'recordedAt' > v_updated_at
        OR (
          v_last_checkpoint_at IS NOT NULL
          AND v_entry->>'recordedAt' < v_last_checkpoint_at
        )
      THEN
        RETURN false;
      END IF;
      IF (v_entry->>'sequence')::bigint <> v_index + 1 THEN
        RETURN false;
      END IF;
      IF v_entry->'attemptId' <> 'null'::jsonb
        AND (
          COALESCE(v_entry->>'attemptId', '')
            !~ '^computer_attempt_[0-9a-f]{64}$'
          OR NOT (v_entry->>'attemptId' = ANY(v_attempt_ids))
        )
      THEN
        RETURN false;
      END IF;
      IF v_entry->'evidenceFingerprint' <> 'null'::jsonb
        AND COALESCE(v_entry->>'evidenceFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
      THEN
        RETURN false;
      END IF;
      v_checkpoint_ids := array_append(
        v_checkpoint_ids,
        v_entry->>'checkpointId'
      );
      v_last_checkpoint_at := v_entry->>'recordedAt';
    END LOOP;
  END IF;

  IF v_acceptance <> 'null'::jsonb THEN
    IF jsonb_typeof(v_acceptance) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_acceptance)) <> 6
      OR (v_acceptance - ARRAY[
        'schemaVersion', 'acceptanceFingerprint', 'attemptId', 'boundAt',
        'predicateFingerprints', 'actions'
      ]) <> '{}'::jsonb
      OR jsonb_typeof(v_acceptance->'schemaVersion') <> 'number'
      OR v_acceptance->>'schemaVersion' <> '1'
      OR COALESCE(v_acceptance->>'acceptanceFingerprint', '')
        !~ '^args-v2:sha256:[0-9a-f]{64}$'
      OR COALESCE(v_acceptance->>'attemptId', '')
        !~ '^computer_attempt_[0-9a-f]{64}$'
      OR NOT (v_acceptance->>'attemptId' = ANY(v_attempt_ids))
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_acceptance->>'boundAt'
      )
      OR v_acceptance->>'boundAt' < v_created_at
      OR v_acceptance->>'boundAt' > v_updated_at
      OR jsonb_typeof(v_acceptance->'predicateFingerprints') <> 'array'
      OR jsonb_array_length(v_acceptance->'predicateFingerprints') NOT BETWEEN 1 AND 64
      OR jsonb_typeof(v_acceptance->'actions') <> 'array'
      OR jsonb_array_length(v_acceptance->'actions') NOT BETWEEN 1 AND 128
    THEN
      RETURN false;
    END IF;
    v_acceptance_attempt_id := v_acceptance->>'attemptId';
    v_acceptance_bound_at := v_acceptance->>'boundAt';

    v_length := jsonb_array_length(v_acceptance->'predicateFingerprints');
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := v_acceptance->'predicateFingerprints'->v_index;
      IF jsonb_typeof(v_entry) <> 'string'
        OR trim(BOTH '"' FROM v_entry::text)
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR trim(BOTH '"' FROM v_entry::text) = ANY(v_predicate_ids)
      THEN
        RETURN false;
      END IF;
      v_predicate_ids := array_append(
        v_predicate_ids,
        trim(BOTH '"' FROM v_entry::text)
      );
    END LOOP;

    v_length := jsonb_array_length(v_acceptance->'actions');
    FOR v_index IN 0..v_length - 1 LOOP
      v_entry := v_acceptance->'actions'->v_index;
      v_action_manifest := jsonb_build_object(
        'actionId', v_entry->>'actionId',
        'index', v_index,
        'attemptId', v_acceptance_attempt_id,
        'tool', v_entry->>'tool',
        'toolArgsFingerprint', v_entry->>'toolArgsFingerprint',
        'authorizationFingerprint', v_entry->>'authorizationFingerprint',
        'idempotencyKey', v_entry->>'idempotencyKey',
        'mutatesState', v_entry->'mutatesState',
        'requiresForegroundLease', v_entry->'requiresForegroundLease'
      );
      IF jsonb_typeof(v_entry) <> 'object'
        OR (SELECT count(*) FROM jsonb_object_keys(v_entry)) <> 14
        OR (v_entry - ARRAY[
          'actionId', 'index', 'attemptId', 'tool', 'toolArgsFingerprint',
          'authorizationFingerprint', 'idempotencyKey', 'mutatesState',
          'requiresForegroundLease', 'acceptanceBindingFingerprint', 'state',
          'proofFingerprint', 'dispatchBinding', 'updatedAt'
        ]) <> '{}'::jsonb
        OR COALESCE(v_entry->>'actionId', '')
          !~ '^computer_action_[0-9a-f]{64}$'
        OR v_entry->>'actionId' <> 'computer_action_' || substring(
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_child_action',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'attemptId', v_acceptance_attempt_id,
            'index', v_index,
            'tool', v_entry->>'tool',
            'toolArgsFingerprint', v_entry->>'toolArgsFingerprint',
            'authorizationFingerprint',
              v_entry->>'authorizationFingerprint'
          )) FROM 16
        )
        OR v_entry->>'actionId' = ANY(v_action_ids)
        OR jsonb_typeof(v_entry->'index') <> 'number'
        OR COALESCE(v_entry->>'index', '') !~ '^[0-9]{1,10}$'
        OR v_entry->>'attemptId' <> v_acceptance_attempt_id
        OR COALESCE(v_entry->>'tool', '')
          !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'
        OR COALESCE(v_entry->>'toolArgsFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR COALESCE(v_entry->>'authorizationFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR COALESCE(v_entry->>'idempotencyKey', '')
          !~ '^computer-task\.[0-9a-f]{64}$'
        OR v_entry->>'idempotencyKey' <> 'computer-task.' || substring(
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_action_idempotency',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'actionId', v_entry->>'actionId'
          )) FROM 16
        )
        OR jsonb_typeof(v_entry->'mutatesState') <> 'boolean'
        OR jsonb_typeof(v_entry->'requiresForegroundLease') <> 'boolean'
        OR COALESCE(v_entry->>'acceptanceBindingFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        OR v_entry->>'acceptanceBindingFingerprint' <>
          public.computer_task_root_fingerprint_v1(jsonb_build_object(
            'schemaVersion', 1,
            'namespace', 'computer_task_action_acceptance_binding',
            'rootFingerprint', p_snapshot->>'rootFingerprint',
            'acceptanceFingerprint',
              v_acceptance->>'acceptanceFingerprint',
            'action', v_action_manifest
          ))
        OR COALESCE(v_entry->>'state', '') NOT IN (
          'planned', 'claimed', 'dispatched', 'verified', 'failed',
          'outcome_unknown'
        )
        OR NOT public.is_valid_computer_task_root_timestamp_v1(
          v_entry->>'updatedAt'
        )
        OR v_entry->>'updatedAt' < v_acceptance_bound_at
        OR v_entry->>'updatedAt' > v_updated_at
      THEN
        RETURN false;
      END IF;
      v_action_manifests := v_action_manifests ||
        jsonb_build_array(v_action_manifest);
      v_dispatch_binding := v_entry->'dispatchBinding';
      IF v_dispatch_binding <> 'null'::jsonb THEN
        IF jsonb_typeof(v_dispatch_binding) <> 'object'
          OR (
            SELECT count(*)
            FROM jsonb_object_keys(v_dispatch_binding)
          ) <> 9
          OR (v_dispatch_binding - ARRAY[
            'schemaVersion', 'source', 'callIdentityFingerprint',
            'authorizationCategory', 'mutationAuthority',
            'policyBindingFingerprint', 'verifierBindingFingerprint',
            'replayBindingFingerprint', 'boundAt'
          ]) <> '{}'::jsonb
          OR jsonb_typeof(v_dispatch_binding->'schemaVersion') <> 'number'
          OR v_dispatch_binding->>'schemaVersion' <> '1'
          OR COALESCE(v_dispatch_binding->>'source', '') NOT IN (
            'compiler', 'provider', 'deterministic', 'connected_agent',
            'capability_buildout', 'recovery'
          )
          OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_snapshot->'attempts') AS owner(value)
            WHERE owner.value->>'attemptId' = v_acceptance_attempt_id
              AND owner.value->>'kind' = v_dispatch_binding->>'source'
          )
          OR COALESCE(
            v_dispatch_binding->>'callIdentityFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR COALESCE(v_dispatch_binding->>'authorizationCategory', '')
            NOT IN (
              'read_only', 'direct_request', 'plan_approval',
              'per_action_approval', 'provider_native', 'proposal_only',
              'unsupported'
            )
          OR COALESCE(v_dispatch_binding->>'mutationAuthority', '')
            NOT IN (
              'read_only', 'action_ledger', 'provider_idempotency',
              'proposal_only', 'unsupported'
            )
          OR COALESCE(
            v_dispatch_binding->>'policyBindingFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR COALESCE(
            v_dispatch_binding->>'verifierBindingFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR COALESCE(
            v_dispatch_binding->>'replayBindingFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
          OR NOT public.is_valid_computer_task_root_timestamp_v1(
            v_dispatch_binding->>'boundAt'
          )
          OR v_dispatch_binding->>'boundAt' < v_acceptance_bound_at
          OR v_dispatch_binding->>'boundAt' > v_entry->>'updatedAt'
          OR (
            (v_entry->>'mutatesState')::boolean
            AND (
              v_dispatch_binding->>'authorizationCategory' = 'read_only'
              OR v_dispatch_binding->>'mutationAuthority' = 'read_only'
            )
          )
          OR (
            NOT (v_entry->>'mutatesState')::boolean
            AND (
              v_dispatch_binding->>'authorizationCategory' <> 'read_only'
              OR v_dispatch_binding->>'mutationAuthority' <> 'read_only'
            )
          )
        THEN
          RETURN false;
        END IF;
      END IF;
      IF (v_entry->>'index')::bigint <> v_index
        OR (
          (v_entry->>'requiresForegroundLease')::boolean
          AND NOT (v_entry->>'mutatesState')::boolean
        )
      THEN
        RETURN false;
      END IF;
      v_action_state := v_entry->>'state';
      IF v_action_state <> 'planned'
        AND (
          v_dispatch_binding = 'null'::jsonb
          OR v_dispatch_binding->>'authorizationCategory' IN (
            'proposal_only', 'unsupported'
          )
          OR v_dispatch_binding->>'mutationAuthority' IN (
            'proposal_only', 'unsupported'
          )
          OR (
            (v_entry->>'mutatesState')::boolean
            AND v_dispatch_binding->>'mutationAuthority' NOT IN (
              'action_ledger', 'provider_idempotency'
            )
          )
          OR (
            NOT (v_entry->>'mutatesState')::boolean
            AND (
              v_dispatch_binding->>'authorizationCategory' <> 'read_only'
              OR v_dispatch_binding->>'mutationAuthority' <> 'read_only'
            )
          )
        )
      THEN
        RETURN false;
      END IF;
      IF NOT v_action_frontier_seen THEN
        IF v_action_state <> 'verified' THEN
          v_action_frontier_seen := true;
        END IF;
      ELSIF v_action_state <> 'planned' THEN
        RETURN false;
      END IF;
      IF v_action_state = 'verified' THEN
        IF COALESCE(v_entry->>'proofFingerprint', '')
          !~ '^args-v2:sha256:[0-9a-f]{64}$'
        THEN
          RETURN false;
        END IF;
      ELSIF v_action_state = 'outcome_unknown' THEN
        IF v_entry->'proofFingerprint' <> 'null'::jsonb
          AND COALESCE(v_entry->>'proofFingerprint', '')
            !~ '^args-v2:sha256:[0-9a-f]{64}$'
        THEN
          RETURN false;
        END IF;
      ELSIF v_entry->'proofFingerprint' <> 'null'::jsonb THEN
        RETURN false;
      END IF;
      v_action_ids := array_append(v_action_ids, v_entry->>'actionId');
    END LOOP;
    IF v_acceptance->>'acceptanceFingerprint' <>
      public.computer_task_root_fingerprint_v1(jsonb_build_object(
        'schemaVersion', 1,
        'namespace', 'computer_task_acceptance',
        'rootFingerprint', p_snapshot->>'rootFingerprint',
        'attemptId', v_acceptance_attempt_id,
        'predicateFingerprints', v_acceptance->'predicateFingerprints',
        'actions', v_action_manifests
      ))
    THEN
      RETURN false;
    END IF;
  END IF;

  IF v_lease <> 'null'::jsonb THEN
    IF jsonb_typeof(v_lease) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_lease)) <> 7
      OR (v_lease - ARRAY[
        'leaseId', 'actionId', 'targetFingerprint', 'acquiredAt',
        'expiresAt', 'status', 'releasedAt'
      ]) <> '{}'::jsonb
      OR COALESCE(v_lease->>'leaseId', '')
        !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
      OR COALESCE(v_lease->>'actionId', '')
        !~ '^computer_action_[0-9a-f]{64}$'
      OR NOT (v_lease->>'actionId' = ANY(v_action_ids))
      OR COALESCE(v_lease->>'targetFingerprint', '')
        !~ '^args-v2:sha256:[0-9a-f]{64}$'
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_lease->>'acquiredAt'
      )
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_lease->>'expiresAt'
      )
      OR v_lease->>'acquiredAt' < v_created_at
      OR v_lease->>'acquiredAt' > v_updated_at
      OR (v_lease->>'expiresAt')::timestamptz
        <= (v_lease->>'acquiredAt')::timestamptz
      OR (v_lease->>'expiresAt')::timestamptz
        - (v_lease->>'acquiredAt')::timestamptz > interval '15 minutes'
      OR COALESCE(v_lease->>'status', '') NOT IN (
        'active', 'released', 'revoked'
      )
    THEN
      RETURN false;
    END IF;
    IF v_lease->>'status' = 'active' THEN
      IF v_lease->'releasedAt' <> 'null'::jsonb
        OR (v_lease->>'expiresAt')::timestamptz
          <= v_updated_at::timestamptz
        OR v_latch <> 'null'::jsonb
        OR p_snapshot->>'replayPolicy' = 'terminal'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_acceptance->'actions') AS action(value)
          WHERE action.value->>'actionId' = v_lease->>'actionId'
            AND (action.value->>'mutatesState')::boolean
            AND (action.value->>'requiresForegroundLease')::boolean
            AND action.value->>'state' IN (
              'planned', 'claimed', 'dispatched'
            )
            AND (
              action.value->>'state' = 'dispatched'
              AND p_snapshot->>'state' = 'verification_only'
              OR action.value->>'state' IN ('planned', 'claimed')
              AND p_snapshot->>'state' = 'running'
            )
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(p_snapshot->'attempts') AS owner(value)
              WHERE owner.value->>'attemptId' = action.value->>'attemptId'
                AND owner.value->>'state' = 'active'
            )
        )
      THEN
        RETURN false;
      END IF;
      IF p_snapshot->>'replayPolicy' = 'verification_only' THEN
        SELECT action.value->>'state'
        INTO v_action_state
        FROM jsonb_array_elements(v_acceptance->'actions') AS action(value)
        WHERE action.value->>'actionId' = v_lease->>'actionId';
        IF v_action_state <> 'dispatched' THEN
          RETURN false;
        END IF;
      END IF;
    ELSE
      IF NOT public.is_valid_computer_task_root_timestamp_v1(
          v_lease->>'releasedAt'
        )
        OR v_lease->>'releasedAt' < v_lease->>'acquiredAt'
        OR v_lease->>'releasedAt' > v_updated_at
      THEN
        RETURN false;
      END IF;
    END IF;
  END IF;

  IF v_latch <> 'null'::jsonb THEN
    IF jsonb_typeof(v_latch) <> 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(v_latch)) <> 3
      OR (v_latch - ARRAY['kind', 'latchedAt', 'revision']) <> '{}'::jsonb
      OR COALESCE(v_latch->>'kind', '') NOT IN (
        'stop_requested', 'human_foreground_override'
      )
      OR NOT public.is_valid_computer_task_root_timestamp_v1(
        v_latch->>'latchedAt'
      )
      OR v_latch->>'latchedAt' < v_created_at
      OR v_latch->>'latchedAt' > v_updated_at
      OR jsonb_typeof(v_latch->'revision') <> 'number'
      OR COALESCE(v_latch->>'revision', '') !~ '^[0-9]{1,10}$'
    THEN
      RETURN false;
    END IF;
    IF (v_latch->>'revision')::bigint NOT BETWEEN 1
      AND (p_snapshot->>'revision')::bigint
      OR v_active_attempt_count <> 0
    THEN
      RETURN false;
    END IF;
    IF v_latch->>'kind' = 'stop_requested'
      AND (
        p_snapshot->>'state' <> 'cancelled'
        OR p_snapshot->>'replayPolicy' <> 'terminal'
      )
    THEN
      RETURN false;
    END IF;
    IF v_latch->>'kind' = 'human_foreground_override'
      AND (
        p_snapshot->>'state' <> 'verification_only'
        OR p_snapshot->>'replayPolicy' <> 'verification_only'
        OR p_snapshot->'terminalAt' <> 'null'::jsonb
      )
    THEN
      RETURN false;
    END IF;
  END IF;

  IF p_snapshot->>'state' IN ('completed', 'failed', 'cancelled')
    AND v_active_attempt_count <> 0
  THEN
    RETURN false;
  END IF;
  IF v_acceptance <> 'null'::jsonb
    AND p_snapshot->>'state' NOT IN ('completed', 'failed', 'cancelled')
    AND p_snapshot#>>'{interruptLatch,kind}'
      IS DISTINCT FROM 'human_foreground_override'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_snapshot->'attempts') AS owner(value)
      WHERE owner.value->>'attemptId' = v_acceptance_attempt_id
        AND owner.value->>'state' = 'active'
    )
  THEN
    RETURN false;
  END IF;
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_nested_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_computer_task_root_snapshot_v1(
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE((
    jsonb_typeof(p_snapshot) = 'object'
    AND octet_length(p_snapshot::text) BETWEEN 64 AND 256000
    AND jsonb_typeof(p_snapshot->'schemaVersion') = 'number'
    AND p_snapshot->>'schemaVersion' = '1'
    AND COALESCE(p_snapshot->>'rootId', '')
      ~ '^computer_task_[0-9a-f]{64}$'
    AND COALESCE(p_snapshot->>'rootFingerprint', '')
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND COALESCE(p_snapshot->>'requestIdentityFingerprint', '')
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND COALESCE(p_snapshot->>'taskFingerprint', '')
      ~ '^args-v2:sha256:[0-9a-f]{64}$'
    AND jsonb_typeof(p_snapshot->'request') = 'object'
    AND jsonb_typeof(p_snapshot#>'{request,schemaVersion}') = 'number'
    AND p_snapshot#>>'{request,schemaVersion}' = '1'
    AND COALESCE(p_snapshot#>>'{request,requestIdentity}', '')
      ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
    AND COALESCE(p_snapshot#>>'{request,userId}', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND COALESCE(p_snapshot#>>'{request,circleId}', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (
      p_snapshot#>'{request,threadId}' = 'null'::jsonb
      OR COALESCE(p_snapshot#>>'{request,threadId}', '')
        ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND p_snapshot#>>'{request,source}' IN (
      'chat', 'office', 'automation', 'api', 'connected_agent', 'system'
    )
    AND public.is_valid_computer_task_root_timestamp_v1(
      p_snapshot#>>'{request,admittedAt}'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_snapshot->'request') AS request_keys(request_key)
      WHERE request_key <> ALL (ARRAY[
        'schemaVersion',
        'requestIdentity',
        'userId',
        'circleId',
        'threadId',
        'source',
        'admittedAt'
      ])
    )
    AND jsonb_typeof(p_snapshot->'revision') = 'number'
    AND COALESCE(p_snapshot->>'revision', '') ~ '^[0-9]{1,10}$'
    AND (p_snapshot->>'revision')::bigint BETWEEN 0 AND 2147483647
    AND p_snapshot->>'state' IN (
      'admitted',
      'running',
      'waiting_approval',
      'waiting_input',
      'paused',
      'verification_only',
      'completed',
      'failed',
      'cancelled'
    )
    AND p_snapshot->>'replayPolicy' IN ('normal', 'verification_only', 'terminal')
    AND (
      p_snapshot->'interruptLatch' = 'null'::jsonb
      OR jsonb_typeof(p_snapshot->'interruptLatch') = 'object'
    )
    AND jsonb_typeof(p_snapshot->'attempts') = 'array'
    AND jsonb_array_length(p_snapshot->'attempts') <= 64
    AND jsonb_typeof(p_snapshot->'checkpoints') = 'array'
    AND jsonb_array_length(p_snapshot->'checkpoints') <= 256
    AND public.is_valid_computer_task_root_nested_v1(p_snapshot)
    AND (
      p_snapshot->'foregroundLease' = 'null'::jsonb
      OR jsonb_typeof(p_snapshot->'foregroundLease') = 'object'
    )
    AND (
      p_snapshot->'acceptance' = 'null'::jsonb
      OR jsonb_typeof(p_snapshot->'acceptance') = 'object'
    )
    AND (
      p_snapshot->'completionProofFingerprint' = 'null'::jsonb
      OR COALESCE(p_snapshot->>'completionProofFingerprint', '')
        ~ '^args-v2:sha256:[0-9a-f]{64}$'
    )
    AND public.is_valid_computer_task_root_timestamp_v1(
      p_snapshot->>'createdAt'
    )
    AND public.is_valid_computer_task_root_timestamp_v1(
      p_snapshot->>'updatedAt'
    )
    AND p_snapshot->>'createdAt' = p_snapshot#>>'{request,admittedAt}'
    AND p_snapshot->>'requestIdentityFingerprint' =
      public.computer_task_root_fingerprint_v1(jsonb_build_object(
        'schemaVersion', 1,
        'namespace', 'computer_task_request_identity',
        'requestIdentity', p_snapshot#>>'{request,requestIdentity}',
        'userId', p_snapshot#>>'{request,userId}',
        'circleId', p_snapshot#>>'{request,circleId}',
        'threadId', p_snapshot#>'{request,threadId}',
        'source', p_snapshot#>>'{request,source}'
      ))
    AND p_snapshot->>'rootFingerprint' =
      public.computer_task_root_fingerprint_v1(jsonb_build_object(
        'schemaVersion', 1,
        'namespace', 'computer_task_root',
        'requestIdentityFingerprint',
          p_snapshot->>'requestIdentityFingerprint',
        'taskFingerprint', p_snapshot->>'taskFingerprint',
        'source', p_snapshot#>>'{request,source}'
      ))
    AND p_snapshot->>'rootId' =
      'computer_task_' || substring(p_snapshot->>'rootFingerprint' FROM 16)
    AND p_snapshot->>'updatedAt' >= p_snapshot->>'createdAt'
    AND (
      p_snapshot->'terminalAt' = 'null'::jsonb
      OR public.is_valid_computer_task_root_timestamp_v1(
        p_snapshot->>'terminalAt'
      )
    )
    AND (
      p_snapshot->>'state' IN ('completed', 'failed', 'cancelled')
    ) = (p_snapshot->'terminalAt' <> 'null'::jsonb)
    AND (
      p_snapshot->>'state' = 'completed'
      OR p_snapshot->'completionProofFingerprint' = 'null'::jsonb
    )
    AND (
      p_snapshot->>'state' <> 'completed'
      OR (
        p_snapshot->>'replayPolicy' = 'terminal'
        AND p_snapshot->'completionProofFingerprint' <> 'null'::jsonb
        AND jsonb_typeof(p_snapshot->'acceptance') = 'object'
        AND jsonb_typeof(p_snapshot#>'{acceptance,actions}') = 'array'
        AND jsonb_array_length(p_snapshot#>'{acceptance,actions}') BETWEEN 1 AND 128
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_snapshot#>'{acceptance,actions}') AS action(value)
          WHERE action.value->>'state' <> 'verified'
        )
      )
    )
    AND (
      p_snapshot->>'state' NOT IN ('failed', 'cancelled')
      OR p_snapshot->>'replayPolicy' = 'terminal'
    )
    AND (
      p_snapshot->>'state' <> 'verification_only'
      OR (
        p_snapshot->>'replayPolicy' = 'verification_only'
        AND (
          p_snapshot#>>'{interruptLatch,kind}' = 'human_foreground_override'
          OR (
            jsonb_typeof(p_snapshot->'acceptance') = 'object'
            AND jsonb_typeof(p_snapshot#>'{acceptance,actions}') = 'array'
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(p_snapshot#>'{acceptance,actions}') AS action(value)
              WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
            )
          )
        )
      )
    )
    AND (
      p_snapshot->>'state' IN ('completed', 'failed', 'cancelled')
      OR NOT (
        jsonb_typeof(p_snapshot#>'{acceptance,actions}') = 'array'
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_snapshot#>'{acceptance,actions}') AS action(value)
          WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
        )
      )
      OR (
        p_snapshot->>'state' = 'verification_only'
        AND p_snapshot->>'replayPolicy' = 'verification_only'
      )
    )
    AND (
      p_snapshot->>'state' <> 'cancelled'
      OR p_snapshot#>>'{interruptLatch,kind}' = 'stop_requested'
    )
    AND (
      p_snapshot->>'state' IN ('completed', 'failed', 'cancelled', 'verification_only')
      OR (
        p_snapshot->>'replayPolicy' = 'normal'
        AND p_snapshot->'interruptLatch' = 'null'::jsonb
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_object_keys(p_snapshot) AS snapshot_keys(snapshot_key)
      WHERE snapshot_key <> ALL (ARRAY[
        'schemaVersion',
        'rootId',
        'rootFingerprint',
        'requestIdentityFingerprint',
        'taskFingerprint',
        'request',
        'revision',
        'state',
        'replayPolicy',
        'interruptLatch',
        'attempts',
        'checkpoints',
        'foregroundLease',
        'acceptance',
        'completionProofFingerprint',
        'createdAt',
        'updatedAt',
        'terminalAt'
      ])
    )
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.is_valid_computer_task_root_snapshot_v1(jsonb)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admit_computer_task_root_v1(
  p_circle_id uuid,
  p_thread_id uuid,
  p_request_identity_fingerprint text,
  p_task_fingerprint text,
  p_root_fingerprint text,
  p_root_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_existing public.computer_task_roots%ROWTYPE;
  v_created public.computer_task_roots%ROWTYPE;
  v_run_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_authenticated',
      'message', 'Authenticated computer-task admission is required.'
    );
  END IF;

  IF (
    p_circle_id IS NULL
    OR COALESCE(p_request_identity_fingerprint, '')
      !~ '^args-v2:sha256:[0-9a-f]{64}$'
    OR COALESCE(p_task_fingerprint, '')
      !~ '^args-v2:sha256:[0-9a-f]{64}$'
    OR COALESCE(p_root_fingerprint, '')
      !~ '^args-v2:sha256:[0-9a-f]{64}$'
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task root admission did not match its exact request snapshot.'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.circle_members AS member
    WHERE member.circle_id = p_circle_id
      AND member.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'scope_denied',
      'message', 'Computer-task root admission is outside the authenticated circle.'
    );
  END IF;

  IF p_thread_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.circle_chat_threads AS thread
    WHERE thread.id = p_thread_id
      AND thread.circle_id = p_circle_id
      AND (
        thread.visibility = 'circle'
        OR thread.created_by = v_actor
        OR EXISTS (
          SELECT 1
          FROM public.circle_chat_thread_members AS thread_member
          WHERE thread_member.thread_id = thread.id
            AND thread_member.user_id = v_actor
        )
      )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'scope_denied',
      'message', 'Computer-task root admission is outside the authenticated chat thread.'
    );
  END IF;

  -- Serialize competing clients before either can create the wrapper run.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_actor::text || ':' || p_circle_id::text || ':' || p_request_identity_fingerprint,
    0
  ));

  SELECT *
  INTO v_existing
  FROM public.computer_task_roots AS root
  WHERE root.user_id = v_actor
    AND root.circle_id = p_circle_id
    AND root.request_identity_fingerprint = p_request_identity_fingerprint
  ORDER BY root.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF (
      v_existing.thread_id IS NOT DISTINCT FROM p_thread_id
      AND v_existing.root_fingerprint = p_root_fingerprint
      AND v_existing.task_fingerprint = p_task_fingerprint
    ) THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'ok', true,
        'disposition', 'duplicate',
        'rootRowId', v_existing.id,
        'runId', v_existing.run_id,
        'revision', v_existing.revision,
        'state', v_existing.state,
        'rootSnapshot', v_existing.root_snapshot
      );
    END IF;
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'identity_conflict',
      'message', 'The admitted request identity is already bound to a different root or task.'
    );
  END IF;

  -- Only a genuinely new admission pays the bounded snapshot-validation and
  -- identity-derivation cost. Exact duplicates return the already-authorized
  -- canonical row, so refresh does not depend on the client's old timestamp.
  IF (
    NOT public.is_valid_computer_task_root_snapshot_v1(p_root_snapshot)
    OR p_root_snapshot->>'rootFingerprint' <> p_root_fingerprint
    OR p_root_snapshot->>'requestIdentityFingerprint' <> p_request_identity_fingerprint
    OR p_root_snapshot->>'taskFingerprint' <> p_task_fingerprint
    OR p_root_snapshot->>'revision' <> '0'
    OR p_root_snapshot->>'state' <> 'admitted'
    OR p_root_snapshot->>'replayPolicy' <> 'normal'
    OR p_root_snapshot->>'rootId'
      <> 'computer_task_' || substring(p_root_fingerprint FROM 16)
    OR p_root_snapshot->'interruptLatch' <> 'null'::jsonb
    OR p_root_snapshot->'attempts' <> '[]'::jsonb
    OR p_root_snapshot->'checkpoints' <> '[]'::jsonb
    OR p_root_snapshot->'foregroundLease' <> 'null'::jsonb
    OR p_root_snapshot->'acceptance' <> 'null'::jsonb
    OR p_root_snapshot->'completionProofFingerprint' <> 'null'::jsonb
    OR p_root_snapshot->'terminalAt' <> 'null'::jsonb
    OR p_root_snapshot->>'createdAt' <> p_root_snapshot->>'updatedAt'
    OR (p_root_snapshot->>'createdAt')::timestamptz
      NOT BETWEEN now() - interval '5 minutes' AND now() + interval '1 minute'
    OR p_root_snapshot#>>'{request,userId}' <> v_actor::text
    OR p_root_snapshot#>>'{request,circleId}' <> p_circle_id::text
    OR (
      p_thread_id IS NULL
      AND p_root_snapshot#>'{request,threadId}' <> 'null'::jsonb
    )
    OR (
      p_thread_id IS NOT NULL
      AND p_root_snapshot#>>'{request,threadId}' <> p_thread_id::text
    )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task root admission did not match its exact request snapshot.'
    );
  END IF;

  INSERT INTO public.agent_runs (
    circle_id,
    user_id,
    surface,
    title,
    goal,
    mode,
    provider,
    status,
    metadata
  ) VALUES (
    p_circle_id,
    v_actor,
    'main_chat',
    'Computer task',
    NULL,
    'act',
    'openswan',
    'planning',
    jsonb_build_object(
      'schemaVersion', 3,
      'executionKind', 'run_computer_task',
      'universalComputerTaskRoot', true,
      'computerTaskRootId', p_root_snapshot->>'rootId',
      'computerTaskRootFingerprint', p_root_fingerprint,
      'requestIdentityFingerprint', p_request_identity_fingerprint,
      'taskFingerprint', p_task_fingerprint,
      'circleChatThreadId', p_thread_id,
      'computerTaskRootState', 'admitted',
      'computerTaskRootRevision', 0,
      'taskCompletionVerified', false,
      'rootCoordinationOnly', true,
      'redacted', true
    )
  )
  RETURNING id INTO v_run_id;

  INSERT INTO public.computer_task_roots (
    run_id,
    circle_id,
    user_id,
    thread_id,
    schema_version,
    root_fingerprint,
    request_identity_fingerprint,
    task_fingerprint,
    state,
    replay_policy,
    revision,
    root_snapshot,
    created_at,
    updated_at,
    terminal_at
  ) VALUES (
    v_run_id,
    p_circle_id,
    v_actor,
    p_thread_id,
    1,
    p_root_fingerprint,
    p_request_identity_fingerprint,
    p_task_fingerprint,
    'admitted',
    'normal',
    0,
    p_root_snapshot,
    (p_root_snapshot->>'createdAt')::timestamptz,
    (p_root_snapshot->>'updatedAt')::timestamptz,
    NULL
  )
  RETURNING * INTO v_created;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', 'created',
    'rootRowId', v_created.id,
    'runId', v_created.run_id,
    'revision', v_created.revision,
    'state', v_created.state,
    'rootSnapshot', v_created.root_snapshot
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_computer_task_root_v1(
  p_root_row_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_authenticated',
      'message', 'Authenticated computer-task root access is required.'
    );
  END IF;

  IF p_root_row_id IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'A computer-task root identifier is required.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_found',
      'message', 'The authenticated computer-task root was not found.'
    );
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', 'read',
    'rootRowId', v_root.id,
    'runId', v_root.run_id,
    'revision', v_root.revision,
    'state', v_root.state,
    'rootSnapshot', v_root.root_snapshot
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.transition_computer_task_root_v1(
  uuid, integer, jsonb
);

CREATE OR REPLACE FUNCTION public.transition_computer_task_root_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_transition_type text,
  p_root_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_next_revision integer;
  v_next_state text;
  v_next_replay_policy text;
  v_next_terminal_at timestamptz;
  v_run_status text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_authenticated',
      'message', 'Authenticated computer-task transition is required.'
    );
  END IF;
  IF (
    p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR p_transition_type IS NULL
    OR p_transition_type NOT IN (
      'begin_attempt',
      'finish_attempt',
      'bind_acceptance',
      'bind_action_dispatch',
      'record_action_state',
      'append_checkpoint',
      'bind_foreground_lease',
      'release_foreground_lease',
      'set_waiting',
      'stop_requested',
      'human_foreground_override',
      'complete',
      'fail'
    )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task transition snapshot was invalid.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'not_found',
      'message', 'The authenticated computer-task root was not found.'
    );
  END IF;

  IF v_root.revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'state_conflict',
      'message', 'The computer-task root revision changed before this transition.',
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;

  IF NOT public.is_valid_computer_task_root_snapshot_v1(p_root_snapshot) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_input',
      'message', 'Computer-task transition snapshot was invalid.'
    );
  END IF;

  v_next_revision := (p_root_snapshot->>'revision')::integer;
  v_next_state := p_root_snapshot->>'state';
  v_next_replay_policy := p_root_snapshot->>'replayPolicy';

  IF (
    v_next_revision <> v_root.revision + 1
    OR p_root_snapshot->>'rootFingerprint' <> v_root.root_fingerprint
    OR p_root_snapshot->>'requestIdentityFingerprint' <> v_root.request_identity_fingerprint
    OR p_root_snapshot->>'taskFingerprint' <> v_root.task_fingerprint
    OR p_root_snapshot->>'rootId' <> v_root.root_snapshot->>'rootId'
    OR p_root_snapshot->'request' IS DISTINCT FROM v_root.root_snapshot->'request'
    OR p_root_snapshot->>'createdAt' <> v_root.root_snapshot->>'createdAt'
    OR p_root_snapshot->>'updatedAt' < v_root.root_snapshot->>'updatedAt'
    OR (p_root_snapshot->>'updatedAt')::timestamptz > now() + interval '1 minute'
    OR p_root_snapshot#>>'{request,userId}' <> v_root.user_id::text
    OR p_root_snapshot#>>'{request,circleId}' <> v_root.circle_id::text
    OR (
      v_root.thread_id IS NULL
      AND p_root_snapshot#>'{request,threadId}' <> 'null'::jsonb
    )
    OR (
      v_root.thread_id IS NOT NULL
      AND p_root_snapshot#>>'{request,threadId}' <> v_root.thread_id::text
    )
    OR v_root.state IN ('completed', 'failed', 'cancelled')
    OR (
      v_root.state = 'verification_only'
      AND v_next_state NOT IN (
        'running', 'verification_only', 'completed', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.state = 'admitted'
      AND v_next_state NOT IN (
        'admitted', 'running', 'waiting_approval', 'waiting_input', 'paused',
        'verification_only', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.state = 'running'
      AND v_next_state NOT IN (
        'running', 'waiting_approval', 'waiting_input', 'paused',
        'verification_only', 'completed', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.state IN ('waiting_approval', 'waiting_input', 'paused')
      AND v_next_state NOT IN (
        v_root.state, 'running', 'waiting_approval', 'waiting_input', 'paused',
        'verification_only', 'completed', 'failed', 'cancelled'
      )
    )
    OR (
      v_root.replay_policy = 'terminal'
      AND v_next_replay_policy <> 'terminal'
    )
    OR (
      v_root.replay_policy = 'verification_only'
      AND v_next_replay_policy = 'normal'
      AND p_transition_type <> 'record_action_state'
    )
    OR (
      v_root.replay_policy = 'verification_only'
      AND p_transition_type NOT IN (
        'append_checkpoint', 'record_action_state',
        'release_foreground_lease', 'stop_requested',
        'human_foreground_override'
      )
    )
    OR (
      v_root.root_snapshot->'interruptLatch' <> 'null'::jsonb
      AND p_root_snapshot->'interruptLatch' IS DISTINCT FROM v_root.root_snapshot->'interruptLatch'
      AND p_transition_type <> 'stop_requested'
    )
    OR (
      v_root.root_snapshot->'acceptance' <> 'null'::jsonb
      AND p_root_snapshot->'acceptance' IS DISTINCT FROM v_root.root_snapshot->'acceptance'
      AND p_transition_type NOT IN (
        'bind_action_dispatch', 'record_action_state'
      )
    )
    OR CASE p_transition_type
      WHEN 'append_checkpoint' THEN
        (p_root_snapshot - ARRAY['revision', 'updatedAt', 'checkpoints'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'updatedAt', 'checkpoints'])
      WHEN 'begin_attempt' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
      WHEN 'finish_attempt' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'attempts'])
      WHEN 'bind_acceptance' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'acceptance'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt', 'acceptance'])
      WHEN 'bind_action_dispatch' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'acceptance'
        ])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'acceptance'
        ])
      WHEN 'record_action_state' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'updatedAt',
          'acceptance', 'foregroundLease'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'updatedAt',
          'acceptance', 'foregroundLease'
        ])
      WHEN 'bind_foreground_lease' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'foregroundLease'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'updatedAt', 'foregroundLease'
        ])
      WHEN 'release_foreground_lease' THEN
        (p_root_snapshot - ARRAY['revision', 'updatedAt', 'foregroundLease'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'updatedAt', 'foregroundLease'])
      WHEN 'set_waiting' THEN
        (p_root_snapshot - ARRAY['revision', 'state', 'updatedAt'])
          IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY['revision', 'state', 'updatedAt'])
      WHEN 'stop_requested' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt', 'terminalAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt', 'terminalAt'
        ])
      WHEN 'human_foreground_override' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'interruptLatch', 'attempts',
          'foregroundLease', 'updatedAt'
        ])
      WHEN 'complete' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts',
          'completionProofFingerprint', 'updatedAt', 'terminalAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts',
          'completionProofFingerprint', 'updatedAt', 'terminalAt'
        ])
      WHEN 'fail' THEN
        (p_root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts', 'updatedAt', 'terminalAt'
        ]) IS DISTINCT FROM
        (v_root.root_snapshot - ARRAY[
          'revision', 'state', 'replayPolicy', 'attempts', 'updatedAt', 'terminalAt'
        ])
      ELSE true
    END
    OR (
      p_transition_type = 'append_checkpoint'
      AND (
        v_next_state <> v_root.state
        OR p_root_snapshot->'attempts' IS DISTINCT FROM v_root.root_snapshot->'attempts'
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM v_root.root_snapshot->'foregroundLease'
        OR p_root_snapshot->'acceptance' IS DISTINCT FROM v_root.root_snapshot->'acceptance'
        OR jsonb_array_length(p_root_snapshot->'checkpoints')
          <> jsonb_array_length(v_root.root_snapshot->'checkpoints') + 1
        OR ((p_root_snapshot->'checkpoints')
          - (jsonb_array_length(p_root_snapshot->'checkpoints') - 1))
          IS DISTINCT FROM v_root.root_snapshot->'checkpoints'
        OR jsonb_typeof(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
        ) <> 'object'
        OR (
          SELECT count(*)
          FROM jsonb_object_keys(
            p_root_snapshot->'checkpoints'
              ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
          ) AS checkpoint_key(key)
        ) <> 7
        OR (
          (p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1))
          - ARRAY[
            'checkpointId', 'sequence', 'attemptId', 'kind', 'rootState',
            'recordedAt', 'evidenceFingerprint'
          ]
        ) <> '{}'::jsonb
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'checkpointId',
          ''
        ) !~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'checkpoints') AS prior(value)
          WHERE prior.value->>'checkpointId' =
            p_root_snapshot->'checkpoints'
              ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
              ->>'checkpointId'
        )
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'sequence',
          ''
        ) !~ '^[0-9]{1,10}$'
        OR (
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'sequence'
        )::bigint <> jsonb_array_length(p_root_snapshot->'checkpoints')
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'kind',
          ''
        ) NOT IN (
          'plan', 'observation', 'approval', 'action', 'verification',
          'recovery', 'terminal'
        )
        OR COALESCE(
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'rootState',
          ''
        ) <> v_root.state
        OR p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->>'recordedAt' <> p_root_snapshot->>'updatedAt'
        OR (
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->'attemptId' <> 'null'::jsonb
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS attempt(value)
            WHERE attempt.value->>'attemptId' =
              p_root_snapshot->'checkpoints'
                ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
                ->>'attemptId'
          )
        )
        OR (
          p_root_snapshot->'checkpoints'
            ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
            ->'evidenceFingerprint' <> 'null'::jsonb
          AND COALESCE(
            p_root_snapshot->'checkpoints'
              ->(jsonb_array_length(p_root_snapshot->'checkpoints') - 1)
              ->>'evidenceFingerprint',
            ''
          ) !~ '^args-v2:sha256:[0-9a-f]{64}$'
        )
      )
    )
    OR (
      p_transition_type = 'begin_attempt'
      AND (
        v_next_state <> 'running'
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts') + 1
        OR ((p_root_snapshot->'attempts')
          - (jsonb_array_length(p_root_snapshot->'attempts') - 1))
          IS DISTINCT FROM v_root.root_snapshot->'attempts'
        OR jsonb_typeof(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
        ) <> 'object'
        OR (
          SELECT count(*)
          FROM jsonb_object_keys(
            p_root_snapshot->'attempts'
              ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
          ) AS attempt_key(key)
        ) <> 7
        OR (
          (p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1))
          - ARRAY[
            'attemptId', 'index', 'kind', 'parentAttemptId', 'state',
            'startedAt', 'finishedAt'
          ]
        ) <> '{}'::jsonb
        OR COALESCE(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'attemptId',
          ''
        ) !~ '^computer_attempt_[0-9a-f]{64}$'
        OR COALESCE(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'index',
          ''
        ) !~ '^[0-9]{1,10}$'
        OR (
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'index'
        )::bigint <> jsonb_array_length(p_root_snapshot->'attempts') - 1
        OR COALESCE(
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'kind',
          ''
        ) NOT IN (
          'deterministic', 'provider', 'compiler', 'connected_agent',
          'capability_buildout', 'recovery'
        )
        OR p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'state' <> 'active'
        OR p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->>'startedAt' <> p_root_snapshot->>'updatedAt'
        OR p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->'finishedAt' <> 'null'::jsonb
        OR (
          p_root_snapshot->'attempts'
            ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
            ->'parentAttemptId' <> 'null'::jsonb
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS parent(value)
            WHERE parent.value->>'attemptId' =
              p_root_snapshot->'attempts'
                ->(jsonb_array_length(p_root_snapshot->'attempts') - 1)
                ->>'parentAttemptId'
          )
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS attempt(value)
          WHERE attempt.value->>'state' = 'active'
        )
      )
    )
    OR (
      p_transition_type = 'finish_attempt'
      AND (
        v_next_state <> 'paused'
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR (
          SELECT count(*)
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND (
              prior.value->>'state' <> 'active'
              OR prior.value->>'attemptId' =
                v_root.root_snapshot#>>'{acceptance,attemptId}'
              OR prior.value->'finishedAt' <> 'null'::jsonb
              OR next.value->>'state' NOT IN (
                'completed', 'failed', 'cancelled'
              )
              OR next.value->>'finishedAt' <> p_root_snapshot->>'updatedAt'
              OR (next.value - ARRAY['state', 'finishedAt'])
                IS DISTINCT FROM
                (prior.value - ARRAY['state', 'finishedAt'])
            )
        )
      )
    )
    OR (
      p_transition_type = 'bind_acceptance'
      AND (
        v_next_state <> 'running'
        OR v_root.root_snapshot->'acceptance' <> 'null'::jsonb
        OR jsonb_typeof(p_root_snapshot->'acceptance') <> 'object'
        OR p_root_snapshot#>>'{acceptance,boundAt}'
          <> p_root_snapshot->>'updatedAt'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            AS attempt(value)
          WHERE attempt.value->>'attemptId' =
              p_root_snapshot#>>'{acceptance,attemptId}'
            AND attempt.value->>'state' = 'active'
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            AS action(value)
          WHERE action.value->>'state' <> 'planned'
            OR action.value->'proofFingerprint' <> 'null'::jsonb
            OR action.value->'dispatchBinding' <> 'null'::jsonb
            OR action.value->>'updatedAt' <>
              p_root_snapshot#>>'{acceptance,boundAt}'
        )
      )
    )
    OR (
      p_transition_type = 'bind_action_dispatch'
      AND (
        v_next_state <> 'running'
        OR v_root.replay_policy <> 'normal'
        OR jsonb_typeof(v_root.root_snapshot->'acceptance')
          IS DISTINCT FROM 'object'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            AS attempt(value)
          WHERE attempt.value->>'attemptId' =
              v_root.root_snapshot#>>'{acceptance,attemptId}'
            AND attempt.value->>'state' = 'active'
        )
        OR jsonb_array_length(p_root_snapshot#>'{acceptance,actions}')
          <> jsonb_array_length(v_root.root_snapshot#>'{acceptance,actions}')
        OR ((p_root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
          IS DISTINCT FROM
          ((v_root.root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
        OR (
          SELECT count(*)
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND (
              prior.value->>'state' <> 'planned'
              OR next.value->>'state' <> 'planned'
              OR prior.value->'dispatchBinding' <> 'null'::jsonb
              OR jsonb_typeof(next.value->'dispatchBinding') <> 'object'
              OR (next.value - ARRAY['dispatchBinding', 'updatedAt'])
                IS DISTINCT FROM
                (prior.value - ARRAY['dispatchBinding', 'updatedAt'])
              OR next.value->>'updatedAt' <> p_root_snapshot->>'updatedAt'
              OR next.value#>>'{dispatchBinding,boundAt}' <>
                p_root_snapshot->>'updatedAt'
            )
        )
      )
    )
    OR (
      p_transition_type = 'record_action_state'
      AND (
        v_next_state NOT IN ('running', 'verification_only')
        OR jsonb_typeof(v_root.root_snapshot#>'{acceptance,actions}')
          IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_root_snapshot#>'{acceptance,actions}')
          <> jsonb_array_length(v_root.root_snapshot#>'{acceptance,actions}')
        OR ((p_root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
          IS DISTINCT FROM
          ((v_root.root_snapshot->'acceptance') - (ARRAY['actions']::text[]))
        OR (
          SELECT count(*)
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
        ) <> 1
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND (
              (next.value - ARRAY['state', 'proofFingerprint', 'updatedAt'])
                IS DISTINCT FROM
                (prior.value - ARRAY['state', 'proofFingerprint', 'updatedAt'])
              OR NOT (
                prior.value->>'state' = 'planned'
                  AND next.value->>'state' = 'claimed'
                OR prior.value->>'state' = 'claimed'
                  AND next.value->>'state' IN ('dispatched', 'failed')
                OR prior.value->>'state' = 'dispatched'
                  AND next.value->>'state' IN ('verified', 'outcome_unknown')
                OR prior.value->>'state' = 'outcome_unknown'
                  AND next.value->>'state' = 'verified'
              )
              OR (
                prior.value->>'state' = 'planned'
                AND next.value->>'state' = 'claimed'
                AND (
                  jsonb_typeof(next.value->'dispatchBinding')
                    IS DISTINCT FROM 'object'
                  OR next.value#>>'{dispatchBinding,authorizationCategory}'
                    IN ('proposal_only', 'unsupported')
                  OR (
                    (next.value->>'mutatesState')::boolean
                    AND next.value#>>'{dispatchBinding,mutationAuthority}'
                      NOT IN ('action_ledger', 'provider_idempotency')
                  )
                  OR (
                    NOT (next.value->>'mutatesState')::boolean
                    AND next.value#>>'{dispatchBinding,mutationAuthority}'
                      <> 'read_only'
                  )
                )
              )
              OR (
                next.value->>'state' IN ('claimed', 'dispatched')
                AND NOT EXISTS (
                  SELECT 1
                  FROM jsonb_array_elements(
                    v_root.root_snapshot->'attempts'
                  ) AS owner(value)
                  WHERE owner.value->>'attemptId' = next.value->>'attemptId'
                    AND owner.value->>'state' = 'active'
                )
              )
              OR next.value->>'updatedAt' <> p_root_snapshot->>'updatedAt'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND next.value->>'state' = 'claimed'
            AND (
              EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  v_root.root_snapshot#>'{acceptance,actions}'
                ) AS other(value)
                WHERE (
                  (other.value->>'index')::integer
                    < (next.value->>'index')::integer
                  AND other.value->>'state' <> 'verified'
                )
                OR (
                  other.value->>'actionId' <> next.value->>'actionId'
                  AND other.value->>'state' IN ('claimed', 'dispatched')
                )
              )
            )
        )
        OR (
          v_root.replay_policy = 'verification_only'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              v_root.root_snapshot#>'{acceptance,actions}'
            ) WITH ORDINALITY AS prior(value, ordinal)
            JOIN jsonb_array_elements(
              p_root_snapshot#>'{acceptance,actions}'
            ) WITH ORDINALITY AS next(value, ordinal)
              USING (ordinal)
            WHERE prior.value IS DISTINCT FROM next.value
              AND NOT (
                prior.value->>'state' = 'dispatched'
                AND next.value->>'state' IN ('verified', 'outcome_unknown')
                OR prior.value->>'state' = 'outcome_unknown'
                AND next.value->>'state' = 'verified'
              )
          )
        )
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE prior.value IS DISTINCT FROM next.value
            AND next.value->>'state' = 'dispatched'
            AND (next.value->>'requiresForegroundLease')::boolean
            AND (
              p_root_snapshot#>>'{foregroundLease,status}'
                IS DISTINCT FROM 'active'
              OR p_root_snapshot#>>'{foregroundLease,actionId}'
                IS DISTINCT FROM
                next.value->>'actionId'
              OR p_root_snapshot#>>'{foregroundLease,expiresAt}' IS NULL
              OR (p_root_snapshot#>>'{foregroundLease,expiresAt}')::timestamptz
                <= (p_root_snapshot->>'updatedAt')::timestamptz
            )
        )
        OR (
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
              AS action(value)
            WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
          )
          AND (
            v_next_state <> 'verification_only'
            OR v_next_replay_policy <> 'verification_only'
          )
        )
        OR (
          NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_root_snapshot#>'{acceptance,actions}')
              AS action(value)
            WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
          )
          AND v_root.root_snapshot#>>'{interruptLatch,kind}'
            IS DISTINCT FROM 'human_foreground_override'
          AND (
            v_next_state <> 'running'
            OR v_next_replay_policy <> 'normal'
          )
        )
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM (
          CASE
            WHEN v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(
                  v_root.root_snapshot#>'{acceptance,actions}'
                ) WITH ORDINALITY AS prior(value, ordinal)
                JOIN jsonb_array_elements(
                  p_root_snapshot#>'{acceptance,actions}'
                ) WITH ORDINALITY AS next(value, ordinal)
                  USING (ordinal)
                WHERE prior.value IS DISTINCT FROM next.value
                  AND next.value->>'actionId' =
                    v_root.root_snapshot#>>'{foregroundLease,actionId}'
                  AND next.value->>'state' IN (
                    'verified', 'failed', 'outcome_unknown'
                  )
              )
            THEN jsonb_set(
              jsonb_set(
                COALESCE(
                  NULLIF(
                    v_root.root_snapshot->'foregroundLease',
                    'null'::jsonb
                  ),
                  '{}'::jsonb
                ),
                '{status}',
                '"released"'::jsonb
              ),
              '{releasedAt}',
              to_jsonb(p_root_snapshot->>'updatedAt')
            )
            ELSE v_root.root_snapshot->'foregroundLease'
          END
        )
      )
    )
    OR (
      p_transition_type = 'bind_foreground_lease'
      AND (
        v_next_state <> 'running'
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR p_root_snapshot#>>'{foregroundLease,status}' <> 'active'
        OR p_root_snapshot#>'{foregroundLease,releasedAt}' <> 'null'::jsonb
        OR p_root_snapshot#>>'{foregroundLease,acquiredAt}'
          <> p_root_snapshot->>'updatedAt'
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot#>'{acceptance,actions}')
            AS action(value)
          WHERE action.value->>'actionId' =
              p_root_snapshot#>>'{foregroundLease,actionId}'
            AND (action.value->>'requiresForegroundLease')::boolean
            AND action.value->>'state' IN ('planned', 'claimed')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                v_root.root_snapshot->'attempts'
              ) AS owner(value)
              WHERE owner.value->>'attemptId' = action.value->>'attemptId'
                AND owner.value->>'state' = 'active'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                v_root.root_snapshot#>'{acceptance,actions}'
              ) AS other(value)
              WHERE (
                (other.value->>'index')::integer <
                  (action.value->>'index')::integer
                AND other.value->>'state' <> 'verified'
              )
              OR (
                other.value->>'actionId' <> action.value->>'actionId'
                AND other.value->>'state' IN ('claimed', 'dispatched')
              )
            )
        )
      )
    )
    OR (
      p_transition_type = 'release_foreground_lease'
      AND (
        v_next_state <> v_root.state
        OR v_root.root_snapshot#>>'{foregroundLease,status}'
          IS DISTINCT FROM 'active'
        OR p_root_snapshot#>>'{foregroundLease,status}'
          IS DISTINCT FROM 'released'
        OR p_root_snapshot#>>'{foregroundLease,releasedAt}'
          <> p_root_snapshot->>'updatedAt'
        OR ((p_root_snapshot->'foregroundLease') - ARRAY['status', 'releasedAt'])
          IS DISTINCT FROM
          ((v_root.root_snapshot->'foregroundLease') - ARRAY['status', 'releasedAt'])
      )
    )
    OR (
      p_transition_type = 'set_waiting'
      AND (
        v_next_state NOT IN ('waiting_approval', 'waiting_input', 'paused')
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR (
          v_next_state = 'paused'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements(v_root.root_snapshot->'attempts') AS attempt(value)
            WHERE attempt.value->>'state' = 'active'
          )
        )
      )
    )
    OR (
      p_transition_type = 'stop_requested'
      AND (
        v_next_state <> 'cancelled'
        OR v_next_replay_policy <> 'terminal'
        OR p_root_snapshot->>'terminalAt' <> p_root_snapshot->>'updatedAt'
        OR p_root_snapshot->'completionProofFingerprint' <> 'null'::jsonb
        OR p_root_snapshot#>>'{interruptLatch,kind}' <> 'stop_requested'
        OR p_root_snapshot#>>'{interruptLatch,latchedAt}'
          <> p_root_snapshot->>'updatedAt'
        OR (p_root_snapshot#>>'{interruptLatch,revision}')::integer
          <> v_next_revision
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(
              v_root.root_snapshot#>'{acceptance,actions}',
              '[]'::jsonb
            )
          ) AS action(value)
          WHERE action.value->>'state' IN (
            'claimed', 'dispatched', 'outcome_unknown'
          )
        )
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"cancelled"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM (
          CASE
            WHEN v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
            THEN jsonb_set(
              jsonb_set(
                COALESCE(
                  NULLIF(
                    v_root.root_snapshot->'foregroundLease',
                    'null'::jsonb
                  ),
                  '{}'::jsonb
                ),
                '{status}',
                '"revoked"'::jsonb
              ),
              '{releasedAt}',
              to_jsonb(p_root_snapshot->>'updatedAt')
            )
            ELSE v_root.root_snapshot->'foregroundLease'
          END
        )
      )
    )
    OR (
      p_transition_type = 'human_foreground_override'
      AND (
        v_next_state <> 'verification_only'
        OR v_next_replay_policy <> 'verification_only'
        OR v_root.root_snapshot->'interruptLatch' <> 'null'::jsonb
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(
              v_root.root_snapshot#>'{acceptance,actions}',
              '[]'::jsonb
            )
          ) AS action(value)
          WHERE action.value->>'state' = 'claimed'
        )
        OR p_root_snapshot#>>'{interruptLatch,kind}' <>
          'human_foreground_override'
        OR p_root_snapshot#>>'{interruptLatch,latchedAt}'
          <> p_root_snapshot->>'updatedAt'
        OR (p_root_snapshot#>>'{interruptLatch,revision}')::integer
          <> v_next_revision
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"cancelled"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
        OR p_root_snapshot->'foregroundLease' IS DISTINCT FROM (
          CASE
            WHEN v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
            THEN jsonb_set(
              jsonb_set(
                COALESCE(
                  NULLIF(
                    v_root.root_snapshot->'foregroundLease',
                    'null'::jsonb
                  ),
                  '{}'::jsonb
                ),
                '{status}',
                '"revoked"'::jsonb
              ),
              '{releasedAt}',
              to_jsonb(p_root_snapshot->>'updatedAt')
            )
            ELSE v_root.root_snapshot->'foregroundLease'
          END
        )
      )
    )
    OR (
      p_transition_type = 'complete'
      AND (
        v_next_state <> 'completed'
        OR v_next_replay_policy <> 'terminal'
        OR p_root_snapshot->>'terminalAt' <> p_root_snapshot->>'updatedAt'
        OR p_root_snapshot->'completionProofFingerprint' = 'null'::jsonb
        OR v_root.root_snapshot->'acceptance' = 'null'::jsonb
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            v_root.root_snapshot#>'{acceptance,actions}'
          ) AS action(value)
          WHERE action.value->>'state' <> 'verified'
        )
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"completed"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
      )
    )
    OR (
      p_transition_type = 'fail'
      AND (
        v_next_state <> 'failed'
        OR v_next_replay_policy <> 'terminal'
        OR p_root_snapshot->>'terminalAt' <> p_root_snapshot->>'updatedAt'
        OR v_root.root_snapshot#>>'{foregroundLease,status}' = 'active'
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
          ) AS action(value)
          WHERE action.value->>'state' IN ('dispatched', 'outcome_unknown')
        )
        OR jsonb_array_length(p_root_snapshot->'attempts')
          <> jsonb_array_length(v_root.root_snapshot->'attempts')
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements(v_root.root_snapshot->'attempts')
            WITH ORDINALITY AS prior(value, ordinal)
          JOIN jsonb_array_elements(p_root_snapshot->'attempts')
            WITH ORDINALITY AS next(value, ordinal)
            USING (ordinal)
          WHERE next.value IS DISTINCT FROM (
            CASE
              WHEN prior.value->>'state' = 'active'
              THEN jsonb_set(
                jsonb_set(prior.value, '{state}', '"cancelled"'::jsonb),
                '{finishedAt}',
                to_jsonb(p_root_snapshot->>'updatedAt')
              )
              ELSE prior.value
            END
          )
        )
      )
    )
    OR (
      p_transition_type NOT IN ('append_checkpoint', 'stop_requested', 'human_foreground_override')
      AND p_root_snapshot->'checkpoints' IS DISTINCT FROM v_root.root_snapshot->'checkpoints'
    )
  ) THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'ok', false,
      'code', 'invalid_transition',
      'message', 'The computer-task root transition violated immutable identity, CAS, replay, interrupt, acceptance, or terminal-state rules.'
    );
  END IF;

  IF v_next_state IN ('completed', 'failed', 'cancelled') THEN
    IF p_root_snapshot->'terminalAt' = 'null'::jsonb THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'ok', false,
        'code', 'invalid_transition',
        'message', 'A terminal computer-task transition requires a terminal timestamp.'
      );
    END IF;
    v_next_terminal_at := (p_root_snapshot->>'terminalAt')::timestamptz;
  ELSE
    IF p_root_snapshot->'terminalAt' <> 'null'::jsonb THEN
      RETURN jsonb_build_object(
        'schemaVersion', 1,
        'ok', false,
        'code', 'invalid_transition',
        'message', 'A non-terminal computer-task transition cannot carry a terminal timestamp.'
      );
    END IF;
    v_next_terminal_at := NULL;
  END IF;

  UPDATE public.computer_task_roots
  SET state = v_next_state,
      replay_policy = v_next_replay_policy,
      revision = v_next_revision,
      root_snapshot = p_root_snapshot,
      updated_at = (p_root_snapshot->>'updatedAt')::timestamptz,
      terminal_at = v_next_terminal_at
  WHERE id = v_root.id;

  v_run_status := CASE v_next_state
    WHEN 'admitted' THEN 'planning'
    WHEN 'running' THEN 'running'
    WHEN 'waiting_approval' THEN 'waiting_approval'
    WHEN 'waiting_input' THEN 'paused'
    WHEN 'paused' THEN 'paused'
    WHEN 'verification_only' THEN 'paused'
    -- Root completion is coordination state, not task proof. A separate
    -- request-acceptance publisher must promote the wrapper run to completed.
    WHEN 'completed' THEN 'paused'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    ELSE 'failed'
  END;

  UPDATE public.agent_runs
  SET status = v_run_status,
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'computerTaskRootState', v_next_state,
        'computerTaskRootRevision', v_next_revision,
        'taskCompletionVerified', false,
        'rootCoordinationOnly', true
      ),
      updated_at = now(),
      completed_at = CASE
        WHEN v_run_status IN ('failed', 'cancelled')
          THEN COALESCE(v_next_terminal_at, now())
        ELSE NULL
      END
  WHERE id = v_root.run_id
    AND user_id = v_root.user_id
    AND circle_id = v_root.circle_id;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', 'transitioned',
    'rootRowId', v_root.id,
    'runId', v_root.run_id,
    'revision', v_next_revision,
    'state', v_next_state,
    'rootSnapshot', p_root_snapshot
  );
END;
$function$;

-- Root-bound action calls are deliberately separate from the generic section
-- 26 RPCs.  The generic ledger remains the authority for existing callers,
-- while these wrappers close the root/action split-brain window for the
-- feature-off universal-task canary.  Every wrapper locks the canonical root
-- first, derives the complete action-call identity from that locked row, then
-- locks or creates the matching action row.  The wrapper-run projection is
-- updated last by transition_computer_task_root_v1.

CREATE OR REPLACE FUNCTION public._computer_task_root_action_error_v1(
  p_code text,
  p_message text
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', false,
    'code', left(
      regexp_replace(
        COALESCE(p_code, 'invalid_input'),
        '[[:cntrl:]]+',
        ' ',
        'g'
      ),
      80
    ),
    'message', left(
      regexp_replace(
        COALESCE(
          p_message,
          'The root-bound durable action transition was refused.'
        ),
        '[[:cntrl:]]+',
        ' ',
        'g'
      ),
      240
    )
  )
$function$;

CREATE OR REPLACE FUNCTION public._computer_task_root_action_identity_matches_v1(
  p_root public.computer_task_roots,
  p_action jsonb,
  p_call public.agent_action_calls
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE(
    p_call.schema_version = 1
    AND p_call.user_id = p_root.user_id
    AND p_call.circle_id = p_root.circle_id
    AND p_call.run_id = p_root.run_id
    AND p_call.tool_name = p_action->>'tool'
    -- The deterministic root action is the call identity.  A provider-backed
    -- gateway may introduce a separately attested provider-call identity in a
    -- later schema; callers cannot supply one to this V1 canary.
    AND p_call.tool_use_id = p_action->>'actionId'
    AND p_call.action_id = p_action->>'actionId'
    AND p_call.tool_args_fingerprint = p_action->>'toolArgsFingerprint'
    -- The per-action acceptance binding covers the canonical root,
    -- acceptance manifest, ordered action identity, and idempotency key.
    AND p_call.contract_fingerprint =
      p_action->>'acceptanceBindingFingerprint'
    AND p_call.idempotency_key = p_action->>'idempotencyKey',
    false
  )
$function$;

CREATE OR REPLACE FUNCTION public._computer_task_root_action_payload_v1(
  p_root_result jsonb,
  p_call public.agent_action_calls,
  p_disposition text,
  p_include_claim_token boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT jsonb_build_object(
    'schemaVersion', 1,
    'ok', true,
    'disposition', p_disposition,
    'rootRowId', p_root_result->'rootRowId',
    'runId', p_root_result->'runId',
    'revision', p_root_result->'revision',
    'state', p_root_result->'state',
    'rootSnapshot', p_root_result->'rootSnapshot',
    'actionCall', public._agent_action_call_payload(
      p_call,
      CASE
        WHEN p_disposition IN (
          'settled', 'completed', 'failed', 'reconciled'
        ) THEN 'finished'
        ELSE p_disposition
      END,
      p_include_claim_token
    )
  )
$function$;

REVOKE ALL ON FUNCTION public._computer_task_root_action_error_v1(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._computer_task_root_action_identity_matches_v1(
  public.computer_task_roots, jsonb, public.agent_action_calls
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._computer_task_root_action_payload_v1(
  jsonb, public.agent_action_calls, text, boolean
) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_computer_task_root_action_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_action_id text,
  p_root_snapshot jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ttl_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_action jsonb;
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz;
  v_ttl_seconds integer := LEAST(
    GREATEST(COALESCE(p_ttl_seconds, 120), 15),
    900
  );
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
  v_root_result jsonb;
  v_failure jsonb := NULL;
  v_disposition text := 'claimed';
BEGIN
  IF v_actor IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_authenticated',
      'Authenticated root-bound action claim is required.'
    );
  END IF;
  IF p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR COALESCE(p_action_id, '') !~ '^computer_action_[0-9a-f]{64}$'
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_input',
      'The root-bound action claim identity or revision was invalid.'
    );
  END IF;

  -- Global lock order: computer_task_roots -> agent_action_calls ->
  -- agent_runs (the latter is updated by the nested root transition).
  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_found',
      'The authenticated computer-task root was not found.'
    );
  END IF;
  IF v_root.revision <> p_expected_revision THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The computer-task root revision changed before the action claim.'
    ) || jsonb_build_object(
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;
  IF v_root.state IN ('completed', 'failed', 'cancelled') THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A terminal computer-task root cannot claim or recover an action lease.'
    );
  END IF;

  SELECT entry.value
  INTO v_action
  FROM jsonb_array_elements(
    COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;

  IF NOT FOUND
    OR jsonb_typeof(v_action) <> 'object'
    OR v_action->>'actionId' <> p_action_id
    OR (v_action->>'mutatesState')::boolean IS DISTINCT FROM true
    OR v_action#>>'{dispatchBinding,mutationAuthority}'
      IS DISTINCT FROM 'action_ledger'
    OR v_action#>>'{dispatchBinding,authorizationCategory}' IN (
      'read_only', 'proposal_only', 'unsupported'
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'Only an exact bound mutating root action may enter the action ledger.'
    );
  END IF;

  -- Resolve every unique identity under the already-held root lock.  Honest
  -- V1 roots derive all three keys from the root fingerprint, so a row found
  -- by a different key is necessarily an identity conflict.
  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE (
      action_call.run_id = v_root.run_id
      AND action_call.action_id = p_action_id
    )
    OR (
      action_call.user_id = v_root.user_id
      AND action_call.circle_id = v_root.circle_id
      AND action_call.idempotency_key = v_action->>'idempotencyKey'
    )
    OR (
      action_call.run_id = v_root.run_id
      AND action_call.tool_use_id = p_action_id
    )
  ORDER BY
    CASE
      WHEN action_call.run_id = v_root.run_id
        AND action_call.action_id = p_action_id
      THEN 0
      ELSE 1
    END,
    action_call.claimed_at
  LIMIT 1
  FOR UPDATE;

  -- Lock waits must never consume a lease while time stands still.  All
  -- claim and renewal timestamps are derived only after the root/action lock
  -- boundary has been acquired.
  v_now := clock_timestamp();

  IF FOUND THEN
    IF NOT public._computer_task_root_action_identity_matches_v1(
      v_root,
      v_action,
      v_call
    ) THEN
      RETURN public._computer_task_root_action_error_v1(
        'identity_conflict',
        'The root action identity is already bound to a different durable call.'
      );
    END IF;
    IF v_action->>'state' IS DISTINCT FROM v_call.state THEN
      RETURN public._computer_task_root_action_error_v1(
        'state_conflict',
        'The root action and durable action ledger disagree; no claim was issued.'
      );
    END IF;
    IF v_call.state = 'claimed' THEN
      IF p_root_snapshot IS DISTINCT FROM v_root.root_snapshot
        OR v_root.state <> 'running'
        OR v_root.replay_policy <> 'normal'
        OR v_root.root_snapshot->'interruptLatch' <> 'null'::jsonb
        OR NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            v_root.root_snapshot->'attempts'
          ) AS owner(value)
          WHERE owner.value->>'attemptId' = v_action->>'attemptId'
            AND owner.value->>'state' = 'active'
        )
      THEN
        RETURN public._computer_task_root_action_error_v1(
          'invalid_transition',
          'The claimed action lease cannot be recovered from a non-executable root.'
        );
      END IF;
      IF v_call.expires_at <= v_now THEN
        UPDATE public.agent_action_calls
        SET claim_token = gen_random_uuid(),
            metadata = metadata || v_metadata,
            state_version = state_version + 1,
            attempt_count = attempt_count + 1,
            claimed_at = v_now,
            expires_at = v_now + make_interval(secs => v_ttl_seconds),
            updated_at = v_now
        WHERE id = v_call.id
          AND state = 'claimed'
          AND state_version = v_call.state_version
        RETURNING * INTO v_call;
        IF NOT FOUND THEN
          RETURN public._computer_task_root_action_error_v1(
            'state_conflict',
            'Another worker changed the expired action claim.'
          );
        END IF;
        v_disposition := 'claimed';
      ELSE
        v_disposition := 'already_claimed';
      END IF;
      v_root_result := jsonb_build_object(
        'rootRowId', v_root.id,
        'runId', v_root.run_id,
        'revision', v_root.revision,
        'state', v_root.state,
        'rootSnapshot', v_root.root_snapshot
      );
      RETURN public._computer_task_root_action_payload_v1(
        v_root_result,
        v_call,
        v_disposition,
        true
      );
    END IF;

    v_root_result := jsonb_build_object(
      'rootRowId', v_root.id,
      'runId', v_root.run_id,
      'revision', v_root.revision,
      'state', v_root.state,
      'rootSnapshot', v_root.root_snapshot
    );
    RETURN public._computer_task_root_action_payload_v1(
      v_root_result,
      v_call,
      'duplicate',
      false
    );
  END IF;

  IF v_action->>'state' <> 'planned' OR p_root_snapshot IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'A missing ledger row can be created only for the exact planned root action.'
    );
  END IF;

  -- An exception block is a PostgreSQL subtransaction.  Any returned JSON
  -- error from the existing root transition is promoted to an exception so
  -- the action insert cannot survive without its matching root transition.
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
    ) VALUES (
      v_root.user_id,
      v_root.circle_id,
      v_root.run_id,
      v_action->>'tool',
      p_action_id,
      p_action_id,
      v_action->>'toolArgsFingerprint',
      v_action->>'acceptanceBindingFingerprint',
      v_action->>'idempotencyKey',
      v_metadata,
      v_now,
      v_now + make_interval(secs => v_ttl_seconds),
      v_now
    )
    RETURNING * INTO v_call;

    v_root_result := public.transition_computer_task_root_v1(
      v_root.id,
      p_expected_revision,
      'record_action_state',
      p_root_snapshot
    );
    IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      v_failure := v_root_result;
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_claim_rollback';
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      v_failure := public._computer_task_root_action_error_v1(
        'identity_conflict',
        'A competing root-bound action identity already owns this durable call.'
      );
    WHEN SQLSTATE 'P0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_failure := public._computer_task_root_action_error_v1(
        'rpc_error',
        'Root-bound action storage failed closed before claim completion.'
      );
  END;

  IF v_failure IS NOT NULL THEN
    RETURN v_failure;
  END IF;
  RETURN public._computer_task_root_action_payload_v1(
    v_root_result,
    v_call,
    'claimed',
    true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.start_computer_task_root_action_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_action_id text,
  p_claim_token uuid,
  p_root_snapshot jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_action jsonb;
  v_call public.agent_action_calls%ROWTYPE;
  v_now timestamptz;
  v_root_result jsonb;
  v_failure jsonb := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_authenticated',
      'Authenticated root-bound action start is required.'
    );
  END IF;
  IF p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR COALESCE(p_action_id, '') !~ '^computer_action_[0-9a-f]{64}$'
    OR p_claim_token IS NULL
    OR p_root_snapshot IS NULL
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_input',
      'The root-bound action start identity, token, revision, or snapshot was invalid.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_found',
      'The authenticated computer-task root was not found.'
    );
  END IF;
  IF v_root.revision <> p_expected_revision THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The computer-task root revision changed before handler entry.'
    ) || jsonb_build_object(
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;
  IF v_root.state IN ('completed', 'failed', 'cancelled') THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A terminal computer-task root cannot authorize handler entry.'
    );
  END IF;

  SELECT entry.value
  INTO v_action
  FROM jsonb_array_elements(
    COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'The root action was not found at handler entry.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.run_id = v_root.run_id
    AND action_call.action_id = p_action_id
  FOR UPDATE;

  -- Refresh after both row locks.  A queued start cannot inherit the time at
  -- function entry and thereby outlive its durable claim or foreground lease.
  v_now := clock_timestamp();

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'No durable call exists for this exact root action.'
    );
  END IF;
  IF NOT public._computer_task_root_action_identity_matches_v1(
    v_root,
    v_action,
    v_call
  ) THEN
    RETURN public._computer_task_root_action_error_v1(
      'identity_conflict',
      'The durable call no longer matches its locked root action.'
    );
  END IF;
  IF v_action->>'state' IS DISTINCT FROM v_call.state THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The root action and durable action ledger disagree at handler entry.'
    );
  END IF;
  IF v_call.state <> 'claimed' THEN
    v_root_result := jsonb_build_object(
      'rootRowId', v_root.id,
      'runId', v_root.run_id,
      'revision', v_root.revision,
      'state', v_root.state,
      'rootSnapshot', v_root.root_snapshot
    );
    RETURN public._computer_task_root_action_payload_v1(
      v_root_result,
      v_call,
      'duplicate',
      false
    );
  END IF;
  IF v_call.claim_token <> p_claim_token THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_token_mismatch',
      'The durable root-action claim token does not match.'
    );
  END IF;
  IF v_call.expires_at <= v_now THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_expired',
      'The durable root-action claim expired before handler entry.'
    );
  END IF;
  IF COALESCE((v_action->>'requiresForegroundLease')::boolean, false)
    AND (
      v_root.root_snapshot#>>'{foregroundLease,status}'
        IS DISTINCT FROM 'active'
      OR v_root.root_snapshot#>>'{foregroundLease,actionId}'
        IS DISTINCT FROM p_action_id
      OR v_root.root_snapshot#>>'{foregroundLease,expiresAt}' IS NULL
      OR (v_root.root_snapshot#>>'{foregroundLease,expiresAt}')::timestamptz
        <= v_now
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'The required foreground lease expired or changed while handler entry was queued.'
    );
  END IF;

  BEGIN
    UPDATE public.agent_action_calls
    SET state = 'dispatched',
        state_version = state_version + 1,
        dispatched_at = v_now,
        expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
        updated_at = v_now
    WHERE id = v_call.id
      AND state = 'claimed'
      AND state_version = v_call.state_version
      AND claim_token = p_claim_token
    RETURNING * INTO v_call;
    IF NOT FOUND THEN
      v_failure := public._computer_task_root_action_error_v1(
        'state_conflict',
        'Another worker changed the durable action before handler entry.'
      );
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_start_rollback';
    END IF;

    v_root_result := public.transition_computer_task_root_v1(
      v_root.id,
      p_expected_revision,
      'record_action_state',
      p_root_snapshot
    );
    IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      v_failure := v_root_result;
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_start_rollback';
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_failure := public._computer_task_root_action_error_v1(
        'rpc_error',
        'Root-bound action storage failed closed before handler entry.'
      );
  END;

  IF v_failure IS NOT NULL THEN
    RETURN v_failure;
  END IF;
  RETURN public._computer_task_root_action_payload_v1(
    v_root_result,
    v_call,
    'started',
    false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.settle_computer_task_root_action_v1(
  p_root_row_id uuid,
  p_expected_revision integer,
  p_action_id text,
  p_claim_token uuid,
  p_final_state text,
  p_proof_fingerprint text,
  p_root_snapshot jsonb,
  p_terminal_transition text DEFAULT NULL,
  p_terminal_root_snapshot jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_root public.computer_task_roots%ROWTYPE;
  v_action jsonb;
  v_next_action jsonb;
  v_call public.agent_action_calls%ROWTYPE;
  v_prior_state text;
  v_now timestamptz;
  v_metadata jsonb := public._sanitize_agent_action_call_metadata(p_metadata);
  v_root_result jsonb;
  v_failure jsonb := NULL;
BEGIN
  IF v_actor IS NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_authenticated',
      'Authenticated root-bound action settlement is required.'
    );
  END IF;
  IF p_root_row_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 0
    OR COALESCE(p_action_id, '') !~ '^computer_action_[0-9a-f]{64}$'
    OR p_final_state NOT IN ('verified', 'failed', 'outcome_unknown')
    OR p_root_snapshot IS NULL
    OR (
      p_proof_fingerprint IS NOT NULL
      AND p_proof_fingerprint !~ '^args-v2:sha256:[0-9a-f]{64}$'
    )
    OR (
      p_terminal_transition IS NULL
      AND p_terminal_root_snapshot IS NOT NULL
    )
    OR (
      p_terminal_transition IS NOT NULL
      AND p_terminal_root_snapshot IS NULL
    )
    OR p_terminal_transition IS NOT NULL
      AND p_terminal_transition NOT IN ('complete', 'fail')
    OR p_final_state = 'outcome_unknown'
      AND p_terminal_transition IS NOT NULL
    OR p_final_state = 'verified'
      AND p_terminal_transition IS NOT NULL
      AND p_terminal_transition <> 'complete'
    OR p_final_state = 'failed'
      AND p_terminal_transition IS NOT NULL
      AND p_terminal_transition <> 'fail'
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_input',
      'The root-bound settlement state, proof, or terminal snapshot was invalid.'
    );
  END IF;

  SELECT *
  INTO v_root
  FROM public.computer_task_roots AS root
  WHERE root.id = p_root_row_id
    AND root.user_id = v_actor
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS member
      WHERE member.circle_id = root.circle_id
        AND member.user_id = v_actor
    )
    AND (
      root.thread_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.circle_chat_threads AS thread
        WHERE thread.id = root.thread_id
          AND thread.circle_id = root.circle_id
          AND (
            thread.visibility = 'circle'
            OR thread.created_by = v_actor
            OR EXISTS (
              SELECT 1
              FROM public.circle_chat_thread_members AS thread_member
              WHERE thread_member.thread_id = thread.id
                AND thread_member.user_id = v_actor
            )
          )
      )
    )
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'not_found',
      'The authenticated computer-task root was not found.'
    );
  END IF;
  IF v_root.revision <> p_expected_revision THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The computer-task root revision changed before action settlement.'
    ) || jsonb_build_object(
      'currentRevision', v_root.revision,
      'rootSnapshot', v_root.root_snapshot
    );
  END IF;
  IF v_root.state IN ('completed', 'failed', 'cancelled') THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A terminal computer-task root cannot mutate its action settlement.'
    );
  END IF;

  SELECT entry.value
  INTO v_action
  FROM jsonb_array_elements(
    COALESCE(v_root.root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'The root action was not found during settlement.'
    );
  END IF;

  SELECT action_call.*
  INTO v_call
  FROM public.agent_action_calls AS action_call
  WHERE action_call.run_id = v_root.run_id
    AND action_call.action_id = p_action_id
  FOR UPDATE;

  -- Settlement chronology is database-owned after lock acquisition, never
  -- the stale timestamp from a request that waited behind another worker.
  v_now := clock_timestamp();

  IF NOT FOUND THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_not_found',
      'No durable call exists for this exact root action.'
    );
  END IF;
  IF NOT public._computer_task_root_action_identity_matches_v1(
    v_root,
    v_action,
    v_call
  ) THEN
    RETURN public._computer_task_root_action_error_v1(
      'identity_conflict',
      'The durable call no longer matches its locked root action.'
    );
  END IF;
  IF v_action->>'state' IS DISTINCT FROM v_call.state THEN
    RETURN public._computer_task_root_action_error_v1(
      'state_conflict',
      'The root action and durable action ledger disagree during settlement.'
    );
  END IF;

  -- Reconciliation intentionally carries no claim token.  Every other
  -- settlement must present the exact token, including idempotent terminal
  -- reads, so a mismatched lease is never disguised as a state transition.
  IF v_call.state = 'outcome_unknown' AND p_final_state = 'verified' THEN
    IF p_claim_token IS NOT NULL THEN
      RETURN public._computer_task_root_action_error_v1(
        'claim_token_mismatch',
        'Outcome-unknown reconciliation must not replay a mutation claim token.'
      );
    END IF;
  ELSIF p_claim_token IS NULL OR v_call.claim_token <> p_claim_token THEN
    RETURN public._computer_task_root_action_error_v1(
      'claim_token_mismatch',
      'The durable root-action settlement claim token does not match.'
    );
  END IF;

  IF v_call.state IN ('verified', 'failed', 'outcome_unknown')
    AND v_call.state = p_final_state
  THEN
    v_root_result := jsonb_build_object(
      'rootRowId', v_root.id,
      'runId', v_root.run_id,
      'revision', v_root.revision,
      'state', v_root.state,
      'rootSnapshot', v_root.root_snapshot
    );
    RETURN public._computer_task_root_action_payload_v1(
      v_root_result,
      v_call,
      'already_finished',
      false
    );
  END IF;

  v_prior_state := v_call.state;
  IF NOT (
      v_prior_state = 'claimed'
        AND p_final_state = 'failed'
        AND p_claim_token IS NOT NULL
        AND v_call.claim_token = p_claim_token
      OR v_prior_state = 'dispatched'
        AND p_final_state IN ('verified', 'outcome_unknown')
        AND p_claim_token IS NOT NULL
        AND v_call.claim_token = p_claim_token
      OR v_prior_state = 'outcome_unknown'
        AND p_final_state = 'verified'
        AND p_claim_token IS NULL
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'The root-bound action cannot enter the requested terminal state.'
    );
  END IF;

  IF p_final_state = 'verified' AND (
      p_proof_fingerprint IS NULL
      OR COALESCE((v_metadata->>'evidenceCount')::integer, 0) < 1
      OR COALESCE((v_metadata->>'blockerCount')::integer, 0) <> 0
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'proof_required',
      'Verified settlement requires a proof fingerprint and positive blocker-free evidence.'
    );
  END IF;
  IF p_final_state = 'failed' AND p_proof_fingerprint IS NOT NULL THEN
    RETURN public._computer_task_root_action_error_v1(
      'invalid_transition',
      'A known pre-dispatch failure cannot carry post-dispatch proof.'
    );
  END IF;

  SELECT entry.value
  INTO v_next_action
  FROM jsonb_array_elements(
    COALESCE(p_root_snapshot#>'{acceptance,actions}', '[]'::jsonb)
  ) AS entry(value)
  WHERE entry.value->>'actionId' = p_action_id
  LIMIT 1;
  IF NOT FOUND
    OR v_next_action->>'state' IS DISTINCT FROM p_final_state
    OR (
      p_proof_fingerprint IS NULL
      AND v_next_action->'proofFingerprint' <> 'null'::jsonb
    )
    OR (
      p_proof_fingerprint IS NOT NULL
      AND v_next_action->>'proofFingerprint'
        IS DISTINCT FROM p_proof_fingerprint
    )
  THEN
    RETURN public._computer_task_root_action_error_v1(
      'proof_mismatch',
      'The settlement proof did not match the exact next root action snapshot.'
    );
  END IF;

  v_metadata := v_metadata || jsonb_build_object(
    'completionVerified', p_final_state = 'verified',
    'outcomeUnknown', p_final_state = 'outcome_unknown'
  );

  BEGIN
    IF v_prior_state = 'outcome_unknown' THEN
      -- This is the only section-26 terminal reconciliation path.  It is
      -- intentionally unavailable through generic finish_agent_action_call
      -- and requires the exact locked root, exact ledger version, and a fresh
      -- proof fingerprint reflected in the next root snapshot.  The feature
      -- remains off until the trusted gateway attests that proof leaf.
      UPDATE public.agent_action_calls
      SET state = 'verified',
          metadata = metadata || v_metadata,
          state_version = state_version + 1,
          expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
          updated_at = v_now
      WHERE id = v_call.id
        AND state = 'outcome_unknown'
        AND state_version = v_call.state_version
      RETURNING * INTO v_call;
    ELSE
      UPDATE public.agent_action_calls
      SET state = p_final_state,
          metadata = metadata || v_metadata,
          state_version = state_version + 1,
          finished_at = v_now,
          expires_at = GREATEST(expires_at, v_now + interval '24 hours'),
          updated_at = v_now
      WHERE id = v_call.id
        AND state = v_prior_state
        AND state_version = v_call.state_version
        AND claim_token = p_claim_token
      RETURNING * INTO v_call;
    END IF;
    IF NOT FOUND THEN
      v_failure := public._computer_task_root_action_error_v1(
        'state_conflict',
        'Another worker changed the durable action before settlement.'
      );
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_settle_rollback';
    END IF;

    v_root_result := public.transition_computer_task_root_v1(
      v_root.id,
      p_expected_revision,
      'record_action_state',
      p_root_snapshot
    );
    IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
      v_failure := v_root_result;
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'root_bound_action_settle_rollback';
    END IF;

    IF p_terminal_transition IS NOT NULL THEN
      v_root_result := public.transition_computer_task_root_v1(
        v_root.id,
        p_expected_revision + 1,
        p_terminal_transition,
        p_terminal_root_snapshot
      );
      IF COALESCE((v_root_result->>'ok')::boolean, false) IS DISTINCT FROM true THEN
        v_failure := v_root_result;
        RAISE EXCEPTION USING
          ERRCODE = 'P0001',
          MESSAGE = 'root_bound_action_terminal_rollback';
      END IF;
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      NULL;
    WHEN OTHERS THEN
      v_failure := public._computer_task_root_action_error_v1(
        'rpc_error',
        'Root-bound action storage failed closed during settlement.'
      );
  END;

  IF v_failure IS NOT NULL THEN
    RETURN v_failure;
  END IF;
  RETURN public._computer_task_root_action_payload_v1(
    v_root_result,
    v_call,
    CASE
      WHEN v_prior_state = 'outcome_unknown' THEN 'reconciled'
      WHEN p_terminal_transition = 'complete' THEN 'completed'
      WHEN p_terminal_transition = 'fail' THEN 'failed'
      ELSE 'settled'
    END,
    false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admit_computer_task_root_v1(
  uuid, uuid, text, text, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.read_computer_task_root_v1(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_computer_task_root_v1(
  uuid, integer, text, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_computer_task_root_action_v1(
  uuid, integer, text, jsonb, jsonb, integer
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_computer_task_root_action_v1(
  uuid, integer, text, uuid, jsonb
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.settle_computer_task_root_action_v1(
  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admit_computer_task_root_v1(
  uuid, uuid, text, text, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_computer_task_root_v1(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_computer_task_root_v1(
  uuid, integer, text, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_computer_task_root_action_v1(
  uuid, integer, text, jsonb, jsonb, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_computer_task_root_action_v1(
  uuid, integer, text, uuid, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_computer_task_root_action_v1(
  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb
) TO authenticated;

COMMENT ON TABLE public.computer_task_roots IS
  'Authenticated request-bound coordination roots. Rows and snapshots are inert until revalidated by the runtime; mutation authority remains in exact tool policy and agent_action_calls.';

COMMENT ON FUNCTION public.admit_computer_task_root_v1(
  uuid, uuid, text, text, text, jsonb
) IS
  'Atomically create or recover one exact computer-task root and wrapper agent run for the authenticated Chat request.';

COMMENT ON FUNCTION public.read_computer_task_root_v1(uuid) IS
  'Rehydrate one authenticated root pointer after refresh; returned JSON remains inert until strict client hydration.';

COMMENT ON FUNCTION public.transition_computer_task_root_v1(
  uuid, integer, text, jsonb
) IS
  'Apply one exact revision-CAS computer-task transition while preserving immutable request, replay, interrupt, acceptance, and terminal boundaries.';

COMMENT ON FUNCTION public.claim_computer_task_root_action_v1(
  uuid, integer, text, jsonb, jsonb, integer
) IS
  'Root-row-first atomic planned-to-claimed transition or claimed-lease recovery. Derives one exact section-26 call from the locked root action and reuses the canonical root run.';

COMMENT ON FUNCTION public.start_computer_task_root_action_v1(
  uuid, integer, text, uuid, jsonb
) IS
  'Root-row-first atomic claimed-to-dispatched transition. Only a started disposition authorizes one handler entry.';

COMMENT ON FUNCTION public.settle_computer_task_root_action_v1(
  uuid, integer, text, uuid, text, text, jsonb, text, jsonb, jsonb
) IS
  'Root-row-first atomic action settlement, including narrow proof-bound outcome_unknown-to-verified reconciliation and optional same-transaction root completion or failure.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════════
-- §35. Office terminal nonterminal-handoff sweeper (2026-08-07)
-- Source: supabase/migrations/20260807160000_office_terminal_handoff_sweeper.sql
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.sweep_stale_terminal_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.office_terminal_messages AS message_row
  SET status = 'error',
      updated_at = clock_timestamp()
  WHERE message_row.status IN ('pending', 'invoked')
    AND message_row.created_at < clock_timestamp() - interval '2 minutes'
    AND NOT EXISTS (
      SELECT 1
      FROM public.office_terminal_responses AS response_row
      WHERE response_row.message_id = message_row.id
        AND response_row.status = 'streaming'
    );

  UPDATE public.office_terminal_responses AS response_row
  SET status = 'error',
      error_message = 'Agent did not respond within 2 minutes',
      updated_at = clock_timestamp()
  WHERE response_row.status = 'pending'
    AND response_row.created_at < clock_timestamp() - interval '2 minutes';
END;
$function$;

REVOKE ALL ON FUNCTION public.sweep_stale_terminal_messages()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_terminal_messages()
  TO postgres, service_role;

COMMENT ON FUNCTION public.sweep_stale_terminal_messages() IS
  'Expires unclaimed Office terminal work while preserving parent messages that have a deliberately nonterminal streaming handoff response.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════════
-- §36. Owner-private Office agent → OpenSwan session bindings (2026-08-07)
-- Source: supabase/migrations/20260807170000_office_agent_session_bindings.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- Owner-private linkage from one published Office agent to one exact OpenSwan
-- connection/session configuration. This migration intentionally performs no
-- backfill: pre-existing Office agents remain unbound until their owner makes
-- an explicit selection through the manager RPC.

BEGIN;

CREATE TABLE IF NOT EXISTS public.office_agent_session_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_agent_id uuid NOT NULL
    REFERENCES public.circle_office_agents(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_bot_id uuid NOT NULL
    REFERENCES public.agents_bots(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT office_agent_session_bindings_office_agent_key
    UNIQUE (office_agent_id),
  CONSTRAINT office_agent_session_bindings_bot_session_key
    UNIQUE (agent_bot_id, session_key),
  CONSTRAINT office_agent_session_bindings_session_key_length
    CHECK (pg_catalog.char_length(session_key) BETWEEN 1 AND 160),
  CONSTRAINT office_agent_session_bindings_session_key_grammar
    CHECK (session_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$')
);

COMMENT ON TABLE public.office_agent_session_bindings IS
  'Owner-private, explicit binding from one published Office agent to one exact OpenSwan connection/session configuration. No implicit or name-based fallback.';
COMMENT ON COLUMN public.office_agent_session_bindings.agent_bot_id IS
  'Exact public.agents_bots row for the owner-managed OpenSwan connection configuration.';
COMMENT ON COLUMN public.office_agent_session_bindings.session_key IS
  'Exact 1-160 character OpenSwan session key; never inferred from Office names, URLs, history, or response prose.';

ALTER TABLE public.office_agent_session_bindings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_agent_session_bindings_owner_select
  ON public.office_agent_session_bindings;
CREATE POLICY office_agent_session_bindings_owner_select
  ON public.office_agent_session_bindings
  FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- Browser clients may read only their RLS-filtered bindings. Every mutation is
-- forced through the authenticated owner-checking manager RPCs below.
REVOKE ALL ON TABLE public.office_agent_session_bindings
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.office_agent_session_bindings
  TO authenticated;

CREATE OR REPLACE FUNCTION public.set_office_agent_session_binding(
  p_office_agent_id uuid,
  p_agent_bot_id uuid,
  p_session_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_office_provider text;
  v_office_is_published boolean;
  v_bot_provider text;
  v_binding_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_auth_required';
  END IF;

  IF p_office_agent_id IS NULL
    OR p_agent_bot_id IS NULL
    OR p_session_key IS NULL
    OR pg_catalog.char_length(p_session_key) NOT BETWEEN 1 AND 160
    OR p_session_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_identity';
  END IF;

  SELECT office_agent.provider, office_agent.is_published
  INTO v_office_provider, v_office_is_published
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_agent_ownership_required';
  END IF;
  IF v_office_is_published IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_published_agent_required';
  END IF;
  IF v_office_provider IS DISTINCT FROM 'openswan' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_office_provider_required';
  END IF;

  SELECT agent_bot.metadata ->> 'provider'
  INTO v_bot_provider
  FROM public.agents_bots AS agent_bot
  WHERE agent_bot.id = p_agent_bot_id
    AND agent_bot.owner_id = v_uid
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_bot_ownership_required';
  END IF;
  IF v_bot_provider IS DISTINCT FROM 'openswan' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_bot_provider_required';
  END IF;

  INSERT INTO public.office_agent_session_bindings AS binding (
    office_agent_id,
    owner_id,
    agent_bot_id,
    session_key
  )
  VALUES (
    p_office_agent_id,
    v_uid,
    p_agent_bot_id,
    p_session_key
  )
  ON CONFLICT (office_agent_id) DO UPDATE
  SET owner_id = EXCLUDED.owner_id,
      agent_bot_id = EXCLUDED.agent_bot_id,
      session_key = EXCLUDED.session_key,
      updated_at = pg_catalog.clock_timestamp()
  WHERE binding.owner_id = v_uid
  RETURNING binding.id INTO v_binding_id;

  IF v_binding_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_ownership_conflict';
  END IF;

  RETURN v_binding_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_office_agent_session_binding(
  p_office_agent_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_auth_required';
  END IF;
  IF p_office_agent_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'office_agent_session_binding_invalid_identity';
  END IF;

  PERFORM 1
  FROM public.circle_office_agents AS office_agent
  WHERE office_agent.id = p_office_agent_id
    AND office_agent.owner_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'office_agent_session_binding_agent_ownership_required';
  END IF;
  DELETE FROM public.office_agent_session_bindings AS binding
  WHERE binding.office_agent_id = p_office_agent_id
    AND binding.owner_id = v_uid;

  RETURN FOUND;
END;
$function$;

-- Version 2 composes the current canonical claim exactly once, then adds a
-- snapshot of an exact owner-valid OpenSwan binding. A missing binding does not
-- roll back or erase the claim: the caller receives a durable response_id and
-- can persist the fixed pre-dispatch error against that response.
CREATE OR REPLACE FUNCTION public.invoke_agent_v2(
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
  canonical_agent_name text,
  binding_contract_version integer,
  binding_id uuid,
  binding_agent_bot_id uuid,
  binding_session_key text,
  binding_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH canonical_claim AS MATERIALIZED (
    SELECT claim.*
    FROM public.invoke_agent(
      p_message_id,
      p_circle_id,
      p_expected_command_text,
      p_agent_id
    ) AS claim
  ),
  valid_binding AS MATERIALIZED (
    SELECT
      binding.id,
      binding.office_agent_id,
      binding.agent_bot_id,
      binding.session_key
    FROM public.office_agent_session_bindings AS binding
    JOIN public.circle_office_agents AS office_agent
      ON office_agent.id = binding.office_agent_id
     AND office_agent.owner_id = v_uid
     AND office_agent.provider = 'openswan'
     AND office_agent.is_published = true
    JOIN public.agents_bots AS agent_bot
      ON agent_bot.id = binding.agent_bot_id
     AND agent_bot.owner_id = v_uid
     AND agent_bot.metadata ->> 'provider' = 'openswan'
    WHERE binding.owner_id = v_uid
  )
  SELECT
    claim.response_id,
    claim.claim_disposition,
    claim.canonical_message_id,
    claim.canonical_circle_id,
    claim.canonical_sender_id,
    claim.canonical_command_text,
    claim.canonical_target_agent_id,
    claim.canonical_target_agent_ids,
    claim.canonical_target_agent_name,
    claim.canonical_model,
    claim.canonical_agent_id,
    claim.canonical_agent_subject_key,
    claim.canonical_agent_name,
    1::integer,
    binding.id,
    binding.agent_bot_id,
    binding.session_key,
    CASE WHEN binding.id IS NULL THEN 'missing'::text ELSE 'bound'::text END
  FROM canonical_claim AS claim
  LEFT JOIN valid_binding AS binding
    ON binding.office_agent_id = claim.canonical_agent_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_office_agent_session_binding(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invoke_agent_v2(uuid, uuid, text, uuid)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_office_agent_session_binding(uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.invoke_agent_v2(uuid, uuid, text, uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.set_office_agent_session_binding(uuid, uuid, text) IS
  'Owner-only upsert of one exact published Office-agent to OpenSwan connection/session binding.';
COMMENT ON FUNCTION public.clear_office_agent_session_binding(uuid) IS
  'Owner-only removal of one exact Office-agent OpenSwan session binding.';
COMMENT ON FUNCTION public.invoke_agent_v2(uuid, uuid, text, uuid) IS
  'Canonical Office invocation claim plus versioned owner-valid OpenSwan binding snapshot; missing bindings still retain the canonical response claim.';

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §37 — truthful Office dashboard state and complete per-floor presets.
--
-- 1. Replaces the global profiles.office_layout write target with one
--    user+circle row and an RPC-only monotonic exact-receipt version gate
--    (legacy blob remains readable; unsafe/far-future versions are rejected).
-- 2. Persists Office attention dismissals across remounts/devices, binds an
--    optional run to the same circle, and stamps acknowledgement expiry server-side.
-- 3. Saves private complete-floor presets (theme, agents, furniture/tools/state).

BEGIN;

CREATE OR REPLACE FUNCTION public.validate_office_layout_document(p_layout jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
DECLARE
  floor_row jsonb;
BEGIN
  IF p_layout IS NULL OR jsonb_typeof(p_layout) <> 'object' THEN
    RETURN false;
  END IF;
  IF octet_length(p_layout::text) > 512000 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_layout -> 'floors') <> 'array'
     OR jsonb_array_length(p_layout -> 'floors') < 1
     OR jsonb_array_length(p_layout -> 'floors') > 10 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_layout -> 'currentFloorId') <> 'string'
     OR length(p_layout ->> 'currentFloorId') > 200 THEN
    RETURN false;
  END IF;

  FOR floor_row IN SELECT value FROM jsonb_array_elements(p_layout -> 'floors')
  LOOP
    IF jsonb_typeof(floor_row) <> 'object' THEN RETURN false; END IF;
    IF jsonb_typeof(floor_row -> 'furniture') <> 'array'
       OR jsonb_array_length(floor_row -> 'furniture') > 100 THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(floor_row -> 'agentIds') <> 'array'
       OR jsonb_array_length(floor_row -> 'agentIds') > 30 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_office_layout_document(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_office_layout_document(jsonb) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.office_layouts (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  layout jsonb NOT NULL,
  layout_version bigint NOT NULL CHECK (layout_version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, circle_id),
  CONSTRAINT office_layouts_document_valid CHECK (public.validate_office_layout_document(layout)),
  CONSTRAINT office_layouts_version_matches_document CHECK (
    (layout ->> 'updatedAt') ~ '^[0-9]{1,18}$'
    AND (layout ->> 'updatedAt')::bigint = layout_version
  )
);

-- Older revisions allowed a client clock arbitrarily far in the future. Repair
-- those rows before raw mutation authority is removed, preserving the payload
-- while bringing its exact version field back to the migration's server clock.
LOCK TABLE public.office_layouts IN SHARE ROW EXCLUSIVE MODE;
WITH repair_clock AS (
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS repair_version
)
UPDATE public.office_layouts AS ol
SET layout = jsonb_set(ol.layout, '{updatedAt}', to_jsonb(repair_clock.repair_version), true),
    layout_version = repair_clock.repair_version,
    updated_at = clock_timestamp()
FROM repair_clock
WHERE ol.layout_version > 9007199254740991
   OR ol.layout_version > repair_clock.repair_version + 300000;
ALTER TABLE public.office_layouts
  DROP CONSTRAINT IF EXISTS office_layouts_version_javascript_safe;
ALTER TABLE public.office_layouts
  ADD CONSTRAINT office_layouts_version_javascript_safe
  CHECK (layout_version <= 9007199254740991);

ALTER TABLE public.office_layouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_layouts_select_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_insert_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_update_own ON public.office_layouts;
DROP POLICY IF EXISTS office_layouts_delete_own ON public.office_layouts;
CREATE POLICY office_layouts_select_own ON public.office_layouts FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = office_layouts.circle_id AND cm.user_id = auth.uid())
);
REVOKE ALL ON TABLE public.office_layouts FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.office_layouts FROM authenticated;
GRANT SELECT ON TABLE public.office_layouts TO authenticated;

CREATE OR REPLACE FUNCTION public.save_office_layout_v2(
  p_circle_id uuid,
  p_layout jsonb,
  p_layout_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  stored_version bigint;
  stored_layout jsonb;
  server_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501'; END IF;
  IF p_circle_id IS NULL
     OR p_layout_version IS NULL
     OR p_layout_version <= 0
     OR p_layout_version > 9007199254740991
     OR p_layout_version > server_now_ms + 300000 THEN
    RAISE EXCEPTION 'invalid_office_layout_version' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = p_circle_id AND cm.user_id = actor_id
  ) THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.validate_office_layout_document(p_layout)
     OR (p_layout ->> 'updatedAt') !~ '^[0-9]{1,18}$'
     OR (p_layout ->> 'updatedAt')::bigint <> p_layout_version THEN
    RAISE EXCEPTION 'invalid_office_layout_document' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.office_layouts (user_id, circle_id, layout, layout_version)
  VALUES (actor_id, p_circle_id, p_layout, p_layout_version)
  ON CONFLICT (user_id, circle_id) DO UPDATE
    SET layout = EXCLUDED.layout,
        layout_version = EXCLUDED.layout_version,
        updated_at = clock_timestamp()
    WHERE public.office_layouts.layout_version < EXCLUDED.layout_version;

  SELECT layout_version, layout INTO stored_version, stored_layout
  FROM public.office_layouts
  WHERE user_id = actor_id AND circle_id = p_circle_id;

  IF stored_version IS NULL THEN
    RAISE EXCEPTION 'office_layout_not_saved' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'layoutVersion', stored_version,
    -- A same-version retry is successful only when it is idempotent. Without
    -- the payload check, two tabs could submit different layouts at the same
    -- millisecond and the losing tab would receive a false accepted receipt.
    'accepted', stored_version = p_layout_version AND stored_layout = p_layout
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_office_layout_v2(uuid, jsonb, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_office_layout_v2(uuid, jsonb, bigint) TO authenticated;

CREATE TABLE IF NOT EXISTS public.office_attention_acknowledgements (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  attention_id text NOT NULL CHECK (length(attention_id) BETWEEN 1 AND 240),
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days'),
  PRIMARY KEY (user_id, circle_id, attention_id),
  CONSTRAINT office_attention_expiry_after_ack CHECK (expires_at > acknowledged_at)
);
-- Lock parent before child so no concurrent run move or acknowledgement write
-- can race cleanup and composite-FK validation. Keep this order in follow-ups.
LOCK TABLE public.agent_runs IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.office_attention_acknowledgements IN SHARE ROW EXCLUSIVE MODE;
-- Remove impossible legacy dismissals before replacing the run-only FK with a
-- durable run+circle relationship. Acknowledgements are ephemeral UI state;
-- retaining a cross-circle row would be less safe than surfacing the item again.
DELETE FROM public.office_attention_acknowledgements AS acknowledgement
WHERE acknowledgement.run_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.agent_runs AS run
    WHERE run.id = acknowledgement.run_id
      AND run.circle_id = acknowledgement.circle_id
  );
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_id_circle_id_unique
  ON public.agent_runs (id, circle_id);
ALTER TABLE public.office_attention_acknowledgements
  DROP CONSTRAINT IF EXISTS office_attention_acknowledgements_run_id_fkey;
ALTER TABLE public.office_attention_acknowledgements
  DROP CONSTRAINT IF EXISTS office_attention_acknowledgements_run_circle_fkey;
ALTER TABLE public.office_attention_acknowledgements
  ADD CONSTRAINT office_attention_acknowledgements_run_circle_fkey
  FOREIGN KEY (run_id, circle_id)
  REFERENCES public.agent_runs (id, circle_id)
  ON UPDATE RESTRICT
  ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS office_attention_ack_expiry_idx
  ON public.office_attention_acknowledgements (user_id, circle_id, expires_at);
ALTER TABLE public.office_attention_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_attention_ack_select_own ON public.office_attention_acknowledgements;
DROP POLICY IF EXISTS office_attention_ack_insert_own ON public.office_attention_acknowledgements;
DROP POLICY IF EXISTS office_attention_ack_update_own ON public.office_attention_acknowledgements;
DROP POLICY IF EXISTS office_attention_ack_delete_own ON public.office_attention_acknowledgements;
CREATE POLICY office_attention_ack_select_own ON public.office_attention_acknowledgements FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY office_attention_ack_insert_own ON public.office_attention_acknowledgements FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = office_attention_acknowledgements.circle_id AND cm.user_id = auth.uid())
);
CREATE POLICY office_attention_ack_update_own ON public.office_attention_acknowledgements FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = office_attention_acknowledgements.circle_id
      AND cm.user_id = auth.uid()
  )
);
CREATE POLICY office_attention_ack_delete_own ON public.office_attention_acknowledgements FOR DELETE TO authenticated
USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.office_attention_acknowledgements FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.office_attention_acknowledgements TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_office_attention_ack_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  run_circle_id uuid;
BEGIN
  IF NEW.run_id IS NOT NULL THEN
    SELECT ar.circle_id INTO run_circle_id
    FROM public.agent_runs ar
    WHERE ar.id = NEW.run_id;
    IF run_circle_id IS NULL OR run_circle_id <> NEW.circle_id THEN
      RAISE EXCEPTION 'attention_run_scope_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  NEW.acknowledged_at := clock_timestamp();
  NEW.expires_at := NEW.acknowledged_at + interval '30 days';
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_office_attention_ack_scope() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS office_attention_ack_scope_guard ON public.office_attention_acknowledgements;
CREATE TRIGGER office_attention_ack_scope_guard
BEFORE INSERT OR UPDATE ON public.office_attention_acknowledgements
FOR EACH ROW EXECUTE FUNCTION public.enforce_office_attention_ack_scope();

CREATE OR REPLACE FUNCTION public.list_active_office_attention_acknowledgements(p_circle_id uuid)
RETURNS TABLE(attention_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT acknowledgement.attention_id
  FROM public.office_attention_acknowledgements AS acknowledgement
  WHERE auth.uid() IS NOT NULL
    AND acknowledgement.user_id = auth.uid()
    AND acknowledgement.circle_id = p_circle_id
    AND acknowledgement.expires_at > statement_timestamp()
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = p_circle_id
        AND membership.user_id = auth.uid()
    )
  ORDER BY acknowledgement.attention_id
  LIMIT 500;
$function$;
REVOKE ALL ON FUNCTION public.list_active_office_attention_acknowledgements(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_active_office_attention_acknowledgements(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_office_floor_preset_snapshot(p_snapshot jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT p_snapshot IS NOT NULL
    AND jsonb_typeof(p_snapshot) = 'object'
    AND p_snapshot ->> 'schemaVersion' = '1'
    AND jsonb_typeof(p_snapshot -> 'floor') = 'object'
    AND octet_length(p_snapshot::text) <= 256000
    AND jsonb_typeof(p_snapshot -> 'floor' -> 'furniture') = 'array'
    AND jsonb_array_length(p_snapshot -> 'floor' -> 'furniture') <= 100
    AND jsonb_typeof(p_snapshot -> 'floor' -> 'agentIds') = 'array'
    AND jsonb_array_length(p_snapshot -> 'floor' -> 'agentIds') <= 30;
$function$;
REVOKE ALL ON FUNCTION public.validate_office_floor_preset_snapshot(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_office_floor_preset_snapshot(jsonb) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.office_floor_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description text CHECK (description IS NULL OR length(description) <= 240),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT office_floor_presets_owner_circle_name UNIQUE (user_id, circle_id, name),
  CONSTRAINT office_floor_presets_snapshot_valid CHECK (public.validate_office_floor_preset_snapshot(snapshot))
);

CREATE OR REPLACE FUNCTION public.touch_office_dashboard_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.touch_office_dashboard_updated_at() FROM PUBLIC;
DROP TRIGGER IF EXISTS office_floor_presets_touch_updated_at ON public.office_floor_presets;
CREATE TRIGGER office_floor_presets_touch_updated_at
BEFORE UPDATE ON public.office_floor_presets
FOR EACH ROW EXECUTE FUNCTION public.touch_office_dashboard_updated_at();

ALTER TABLE public.office_floor_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_floor_presets_select_own ON public.office_floor_presets;
DROP POLICY IF EXISTS office_floor_presets_insert_own ON public.office_floor_presets;
DROP POLICY IF EXISTS office_floor_presets_update_own ON public.office_floor_presets;
DROP POLICY IF EXISTS office_floor_presets_delete_own ON public.office_floor_presets;
CREATE POLICY office_floor_presets_select_own ON public.office_floor_presets FOR SELECT TO authenticated
USING (user_id = auth.uid());
CREATE POLICY office_floor_presets_insert_own ON public.office_floor_presets FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (SELECT 1 FROM public.circle_members cm WHERE cm.circle_id = office_floor_presets.circle_id AND cm.user_id = auth.uid())
);
CREATE POLICY office_floor_presets_update_own ON public.office_floor_presets FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.circle_members cm
    WHERE cm.circle_id = office_floor_presets.circle_id
      AND cm.user_id = auth.uid()
  )
);
CREATE POLICY office_floor_presets_delete_own ON public.office_floor_presets FOR DELETE TO authenticated
USING (user_id = auth.uid());
REVOKE ALL ON TABLE public.office_floor_presets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.office_floor_presets TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §37 readiness (catalog presence only; this does not prove authenticated
-- cross-device behavior or a live Office interaction).
SELECT
  to_regclass('public.office_layouts') IS NOT NULL AS office_layouts_ready,
  to_regprocedure('public.save_office_layout_v2(uuid,jsonb,bigint)') IS NOT NULL AS office_layout_save_ready,
  to_regclass('public.office_attention_acknowledgements') IS NOT NULL AS office_attention_ack_ready,
  to_regclass('public.office_floor_presets') IS NOT NULL AS office_floor_presets_ready;

-- =============================================================================
-- §38. Agent-run artifact integrity (2026-08-12)
-- Source: supabase/migrations/20260812_agent_run_artifact_integrity.sql
-- =============================================================================
-- Agent-run artifact integrity: immutable parent authority and artifacts.
--
-- The 20260408 base policy granted every current circle member FOR ALL access
-- to every artifact in that circle. That made canonical Chat artifact content
-- mutable/deletable by unrelated members. Converge to exactly two authenticated
-- policies: circle-member SELECT and exact run-owner INSERT. The parent run's
-- owner/circle/id becomes immutable to authenticated clients first, and new
-- runs must belong to the authenticated creator. Authenticated artifact
-- UPDATE/DELETE has neither a policy nor a table grant; service_role retains
-- its normal RLS bypass for trusted maintenance/recovery.

BEGIN;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- `agent_runs.user_id` is the artifact INSERT authority below. The historical
-- circle-member FOR ALL policy makes that column forgeable unless the parent
-- identity is independently locked first. Restrictive policies compose with
-- that legacy permissive policy: authenticated clients may create only their
-- own rows, mutate only their own rows, and directly delete only their own
-- rows. Service-role/Postgres maintenance keeps its normal RLS bypass.
DROP POLICY IF EXISTS agent_runs_owner_insert_guard_v1 ON public.agent_runs;
CREATE POLICY agent_runs_owner_insert_guard_v1
ON public.agent_runs
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
);

DROP POLICY IF EXISTS agent_runs_owner_update_guard_v1 ON public.agent_runs;
CREATE POLICY agent_runs_owner_update_guard_v1
ON public.agent_runs
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
);

-- This also closes the indirect artifact-delete path where a member deletes
-- another member's run and relies on ON DELETE CASCADE. PostgreSQL executes a
-- legitimate parent-circle FK cascade outside child RLS, so Circle deletion is
-- not stranded by this direct-delete guard.
DROP POLICY IF EXISTS agent_runs_owner_delete_guard_v1 ON public.agent_runs;
CREATE POLICY agent_runs_owner_delete_guard_v1
ON public.agent_runs
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
);

CREATE OR REPLACE FUNCTION public.guard_authenticated_agent_run_identity_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF trusted_writer THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF actor_id IS NULL OR NEW.user_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'agent_run_owner_required'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF actor_id IS NULL OR OLD.user_id IS DISTINCT FROM actor_id THEN
      RAISE EXCEPTION 'agent_run_owner_required'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'agent_run_identity_immutable'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'agent_run_identity_guard_invalid_operation'
    USING ERRCODE = '42501';
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_authenticated_agent_run_identity_v1
ON public.agent_runs;
CREATE TRIGGER trg_guard_authenticated_agent_run_identity_v1
BEFORE INSERT OR UPDATE ON public.agent_runs
FOR EACH ROW EXECUTE FUNCTION public.guard_authenticated_agent_run_identity_v1();

REVOKE ALL ON FUNCTION public.guard_authenticated_agent_run_identity_v1()
FROM PUBLIC, anon, authenticated;

ALTER TABLE public.agent_run_artifacts ENABLE ROW LEVEL SECURITY;

-- Remove known and unknown policy drift. PostgreSQL ORs permissive policies,
-- so leaving one historical FOR ALL policy would reopen mutation authority.
DO $block$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_artifacts'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.agent_run_artifacts',
      policy_row.policyname
    );
  END LOOP;
END;
$block$;

CREATE POLICY agent_run_artifacts_select_circle_member
ON public.agent_run_artifacts
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND public.user_is_circle_member(circle_id)
);

CREATE POLICY agent_run_artifacts_insert_run_owner
ON public.agent_run_artifacts
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND public.user_is_circle_member(circle_id)
  AND EXISTS (
    SELECT 1
    FROM public.agent_runs AS owning_run
    WHERE owning_run.id = agent_run_artifacts.run_id
      AND owning_run.circle_id = agent_run_artifacts.circle_id
      AND owning_run.user_id = auth.uid()
  )
  AND (
    step_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.agent_run_steps AS owning_step
      WHERE owning_step.id = agent_run_artifacts.step_id
        AND owning_step.run_id = agent_run_artifacts.run_id
        AND owning_step.circle_id = agent_run_artifacts.circle_id
    )
  )
);

REVOKE ALL ON TABLE public.agent_run_artifacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.agent_run_artifacts TO authenticated;
GRANT ALL ON TABLE public.agent_run_artifacts TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Catalog readiness only. This does not prove two-user behavioral RLS or that
-- the migration has been applied to a target project.
SELECT
  to_regclass('public.agent_run_artifacts') IS NOT NULL AS agent_run_artifacts_ready,
  to_regprocedure('public.guard_authenticated_agent_run_identity_v1()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.agent_runs'::regclass
        AND trigger_row.tgname = 'trg_guard_authenticated_agent_run_identity_v1'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    ) AS agent_run_identity_guard_ready,
  (
    SELECT count(*) = 3
      AND bool_and(permissive = 'RESTRICTIVE')
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_runs'
      AND policyname IN (
        'agent_runs_owner_insert_guard_v1',
        'agent_runs_owner_update_guard_v1',
        'agent_runs_owner_delete_guard_v1'
      )
  ) AS agent_run_owner_policies_ready,
  (
    SELECT count(*) = 2
      AND bool_and(cmd IN ('SELECT', 'INSERT'))
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_artifacts'
  ) AS artifact_policies_converged,
  has_table_privilege('authenticated', 'public.agent_run_artifacts', 'SELECT')
    AND has_table_privilege('authenticated', 'public.agent_run_artifacts', 'INSERT')
    AND NOT has_table_privilege('authenticated', 'public.agent_run_artifacts', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'public.agent_run_artifacts', 'DELETE')
    AS authenticated_artifact_grants_ready;


-- =============================================================================
-- §39. Message-attachment link integrity (2026-08-13)
-- Source: supabase/migrations/20260813160000_message_attachment_link_integrity.sql
-- =============================================================================
-- Canonical message-attachment linkage integrity.
--
-- The original message_attachments UPDATE policy checked only the attachment
-- owner. That allowed an authenticated owner to rewrite attachment identity or
-- attach a staged row to any guessed message UUID. Keep the existing direct
-- Chat UPDATE API, but make it a database-enforced compare-and-set:
--
--   * only the owner, while still a circle member, may update;
--   * authenticated INSERT always creates an unlinked staged row;
--   * durable attachment identity/content fields are immutable;
--   * message_id may move only from NULL to one exact, owner-authored,
--     non-bot message in the same circle and thread (or remain unchanged for a
--     safe retry);
--   * ocr_text remains mutable for the owner-side OCR path;
--   * trusted service-role/Postgres maintenance remains available.

BEGIN;

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- Deterministically quarantine legacy links that cannot prove the exact
-- attachment/message scope. There is no safe message target to infer for such
-- a row, so returning it to the staged (NULL) state is the only non-forging
-- repair. Valid same-owner, same-circle, same-thread user-message links remain.
UPDATE public.message_attachments AS attachment
SET message_id = NULL
WHERE attachment.message_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.messages AS target_message
    WHERE target_message.id = attachment.message_id
      AND target_message.circle_id = attachment.circle_id
      AND target_message.thread_id IS NOT DISTINCT FROM attachment.thread_id
      AND target_message.user_id = attachment.user_id
      AND COALESCE(target_message.is_bot, false) = false
  );

-- This predicate intentionally runs with caller privileges. Its messages query
-- therefore preserves canonical message/thread RLS instead of becoming a
-- SECURITY DEFINER existence oracle. The explicit owner equality also keeps a
-- caller from probing another user's message identity through this function.
CREATE OR REPLACE FUNCTION public.message_attachment_link_target_is_valid_v1(
  p_message_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_message_id IS NULL
    OR (
      auth.uid() IS NOT NULL
      AND p_user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.messages AS target_message
        WHERE target_message.id = p_message_id
          AND target_message.circle_id = p_circle_id
          AND target_message.thread_id IS NOT DISTINCT FROM p_thread_id
          AND target_message.user_id = p_user_id
          AND COALESCE(target_message.is_bot, false) = false
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_link_target_is_valid_v1(uuid, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_link_target_is_valid_v1(uuid, uuid, uuid, uuid)
TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_authenticated_message_attachment_update_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'supabase_admin', 'service_role');
BEGIN
  IF trusted_writer THEN
    RETURN NEW;
  END IF;

  IF actor_id IS NULL OR OLD.user_id IS DISTINCT FROM actor_id THEN
    RAISE EXCEPTION 'message_attachment_owner_required'
      USING ERRCODE = '42501';
  END IF;

  -- message_id and ocr_text are the only authenticated-client mutable fields.
  -- Comparing the remaining row as jsonb also fails closed if a future column
  -- is added without an explicit decision here.
  IF (to_jsonb(NEW) - ARRAY['message_id', 'ocr_text'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['message_id', 'ocr_text']) THEN
    RAISE EXCEPTION 'message_attachment_identity_immutable'
      USING ERRCODE = '42501';
  END IF;

  -- A linked attachment is immutable. Repeating the same message_id is an
  -- idempotent retry; changing it or returning it to NULL is rejected.
  IF OLD.message_id IS NOT NULL
     AND NEW.message_id IS DISTINCT FROM OLD.message_id THEN
    RAISE EXCEPTION 'message_attachment_relink_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.message_attachment_link_target_is_valid_v1(
    NEW.message_id,
    NEW.circle_id,
    NEW.thread_id,
    NEW.user_id
  ) THEN
    RAISE EXCEPTION 'message_attachment_target_mismatch'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_authenticated_message_attachment_update_v1
ON public.message_attachments;
CREATE TRIGGER trg_guard_authenticated_message_attachment_update_v1
BEFORE UPDATE ON public.message_attachments
FOR EACH ROW EXECUTE FUNCTION public.guard_authenticated_message_attachment_update_v1();

REVOKE ALL ON FUNCTION public.guard_authenticated_message_attachment_update_v1()
FROM PUBLIC, anon, authenticated;

-- Permissive policies are ORed, so every historical INSERT, UPDATE, or FOR ALL
-- policy must be removed before installing the canonical staged-insert and
-- owner/scope-update policies. SELECT and DELETE policies are intentionally
-- left unchanged in this focused migration.
DO $policy_convergence$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.message_attachments',
      policy_row.policyname
    );
  END LOOP;
END;
$policy_convergence$;

CREATE POLICY message_attachments_insert_owner_staged_v1
ON public.message_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
);

CREATE POLICY message_attachments_update_owner_exact_link_v1
ON public.message_attachments
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
);

-- Keep the current PostgREST `.update({ message_id })` and owner OCR paths
-- compatible. RLS plus the BEFORE trigger narrow this table-level grant to the
-- two explicitly mutable fields above.
REVOKE ALL ON TABLE public.message_attachments FROM PUBLIC, anon;
GRANT INSERT, UPDATE ON TABLE public.message_attachments TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §39 readiness (catalog and stored-row integrity only; this does not prove a
-- live authenticated Chat upload/link round trip).
SELECT
  to_regclass('public.message_attachments') IS NOT NULL
    AS message_attachments_ready,
  to_regprocedure('public.message_attachment_link_target_is_valid_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
    AS attachment_link_validator_ready,
  to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.message_attachments'::regclass
        AND trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    ) AS attachment_update_guard_ready,
  (
    SELECT count(*) = 1
      AND bool_and(policyname = 'message_attachments_insert_owner_staged_v1')
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND cmd = 'INSERT'
  ) AS attachment_insert_policy_converged,
  (
    SELECT count(*) = 1
      AND bool_and(policyname = 'message_attachments_update_owner_exact_link_v1')
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND cmd IN ('UPDATE', 'ALL')
  ) AS attachment_update_policy_converged,
  NOT EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    WHERE attachment.message_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.messages AS target_message
        WHERE target_message.id = attachment.message_id
          AND target_message.circle_id = attachment.circle_id
          AND target_message.thread_id IS NOT DISTINCT FROM attachment.thread_id
          AND target_message.user_id = attachment.user_id
          AND COALESCE(target_message.is_bot, false) = false
      )
  ) AS stored_attachment_links_valid,
  has_table_privilege('authenticated', 'public.message_attachments', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'INSERT')
    AS authenticated_attachment_write_grants_ready;


-- =============================================================================
-- §40. Message-attachment visibility and Storage integrity (2026-08-13)
-- Source: supabase/migrations/20260813170000_message_attachment_visibility_integrity.sql
-- =============================================================================
-- Canonical message-attachment visibility and Storage integrity.
--
-- A message attachment contains more than a filename: its row may carry the
-- private Storage path, extracted text, and OCR. Circle membership alone is
-- therefore not sufficient read authority. Converge the full table policy set
-- so staged rows are owner-only and linked rows follow the exact message-thread
-- visibility contract. Apply the same rule to the private Storage object.

BEGIN;

-- §40 deliberately extends §39 rather than replacing its immutable-link
-- trigger. Abort intact if an operator tries to install visibility before the
-- canonical compare-and-set boundary is present.
DO $attachment_visibility_dependency_preflight$
BEGIN
  IF to_regprocedure('public.message_attachment_link_target_is_valid_v1(uuid,uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'public.message_attachments'::regclass
         AND trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'
         AND trigger_row.tgenabled <> 'D'
         AND NOT trigger_row.tgisinternal
     )
     OR to_regprocedure('public.message_thread_visible_to_current_user(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: apply SQL section 39 and canonical message-thread RLS first'
      USING ERRCODE = '23514';
  END IF;
END
$attachment_visibility_dependency_preflight$;

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.message_attachment_storage_path_matches_row_v1(
  p_name text,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    p_name IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4
    AND split_part(p_name, '/', 1) = p_circle_id::text
    AND split_part(p_name, '/', 2) = COALESCE(p_thread_id::text, '_direct')
    AND split_part(p_name, '/', 3) = p_user_id::text
    AND split_part(p_name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$';
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_storage_path_matches_row_v1(text, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_path_matches_row_v1(text, uuid, uuid, uuid)
TO authenticated;

-- Never delete or silently rewrite a user's attachment while installing an
-- authority boundary. Legacy drift must be inspected by an operator. Abort the
-- transaction intact if a row cannot satisfy the canonical path identity.
DO $attachment_path_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    WHERE NOT public.message_attachment_storage_path_matches_row_v1(
      attachment.storage_path,
      attachment.circle_id,
      attachment.thread_id,
      attachment.user_id
    )
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: invalid legacy storage path; inspect before applying'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    GROUP BY attachment.storage_path
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: duplicate legacy storage path; inspect before applying'
      USING ERRCODE = '23505';
  END IF;
END
$attachment_path_preflight$;

ALTER TABLE public.message_attachments
  DROP CONSTRAINT IF EXISTS message_attachments_storage_path_matches_scope_v1;
ALTER TABLE public.message_attachments
  ADD CONSTRAINT message_attachments_storage_path_matches_scope_v1
  CHECK (
    public.message_attachment_storage_path_matches_row_v1(
      storage_path,
      circle_id,
      thread_id,
      user_id
    )
  );

DROP INDEX IF EXISTS public.message_attachments_storage_path_unique_v1;
CREATE UNIQUE INDEX message_attachments_storage_path_unique_v1
ON public.message_attachments(storage_path);

-- Converge the named private bucket without deleting or replacing it. A
-- mismatched id/name is ambiguous operator state and aborts intact.
DO $private_bucket_identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE (bucket.id = 'chat-attachments' AND bucket.name <> 'chat-attachments')
       OR (bucket.name = 'chat-attachments' AND bucket.id <> 'chat-attachments')
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: chat-attachments bucket identity mismatch; inspect before applying'
      USING ERRCODE = '23514';
  END IF;
END
$private_bucket_identity_preflight$;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', false, 52428800)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = false,
  file_size_limit = 52428800;

UPDATE storage.buckets
SET
  public = false,
  file_size_limit = 52428800
WHERE id = 'chat-attachments'
  AND name = 'chat-attachments';

-- Metadata is admitted only after the exact private Storage object exists and
-- its immutable owner matches the row/path owner. The authenticated-only
-- owner equality prevents this SECURITY DEFINER predicate from becoming a
-- cross-user object-existence oracle.
CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_matches_row_v1(
  p_name text,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_user_id = auth.uid()
    AND public.message_attachment_storage_path_matches_row_v1(
      p_name,
      p_circle_id,
      p_thread_id,
      p_user_id
    )
    AND EXISTS (
      SELECT 1
      FROM storage.objects AS object_row
      WHERE object_row.bucket_id = 'chat-attachments'
        AND object_row.name = p_name
        AND object_row.owner_id::text = p_user_id::text
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_storage_object_matches_row_v1(text, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_object_matches_row_v1(text, uuid, uuid, uuid)
TO authenticated;

-- A missing or differently owned legacy object is not repaired by guessing.
-- Keep every row/object intact and stop the transaction for operator review.
DO $attachment_object_binding_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.message_attachments AS attachment
    WHERE NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object_row
      WHERE object_row.bucket_id = 'chat-attachments'
        AND object_row.name = attachment.storage_path
        AND object_row.owner_id::text = attachment.user_id::text
    )
  ) THEN
    RAISE EXCEPTION 'message_attachment_visibility_integrity: missing or owner-mismatched legacy storage object; inspect before applying'
      USING ERRCODE = '23514';
  END IF;
END
$attachment_object_binding_preflight$;

CREATE OR REPLACE FUNCTION public.message_attachment_row_visible_v1(
  p_message_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND (
      (
        p_message_id IS NULL
        AND p_user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.circle_members AS membership
          WHERE membership.circle_id = p_circle_id
            AND membership.user_id = auth.uid()
        )
      )
      OR (
        p_message_id IS NOT NULL
        AND p_thread_id IS NOT NULL
        AND public.message_thread_visible_to_current_user(p_circle_id, p_thread_id)
        AND EXISTS (
          SELECT 1
          FROM public.messages AS target_message
          WHERE target_message.id = p_message_id
            AND target_message.circle_id = p_circle_id
            AND target_message.thread_id = p_thread_id
            AND target_message.user_id = p_user_id
            AND COALESCE(target_message.is_bot, false) = false
        )
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_row_visible_v1(uuid, uuid, uuid, uuid)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_row_visible_v1(uuid, uuid, uuid, uuid)
TO authenticated;

-- Permissive policies are ORed. Remove every historical table policy before
-- installing the one canonical policy for each operation.
DO $attachment_policy_convergence$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
  LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY %I ON public.message_attachments',
      policy_row.policyname
    );
  END LOOP;
END
$attachment_policy_convergence$;

CREATE POLICY message_attachments_select_exact_visibility_v1
ON public.message_attachments
FOR SELECT
TO authenticated
USING (
  public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_insert_owner_staged_v1
ON public.message_attachments
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_update_owner_exact_link_v1
ON public.message_attachments
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_delete_owner_visible_v1
ON public.message_attachments
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

-- Restrictive companions are defense in depth against a future or
-- environment-specific permissive TO PUBLIC/FOR ALL policy. PostgreSQL ANDs
-- every applicable restrictive policy with the permissive result.
CREATE POLICY message_attachments_select_exact_visibility_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_insert_owner_staged_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND message_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_update_owner_exact_link_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = message_attachments.circle_id
      AND membership.user_id = auth.uid()
  )
  AND (
    thread_id IS NULL
    OR public.message_thread_visible_to_current_user(circle_id, thread_id)
  )
  AND public.message_attachment_link_target_is_valid_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_object_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

CREATE POLICY message_attachments_delete_owner_visible_guard_v1
ON public.message_attachments
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND user_id = auth.uid()
  AND public.message_attachment_row_visible_v1(
    message_id,
    circle_id,
    thread_id,
    user_id
  )
  AND public.message_attachment_storage_path_matches_row_v1(
    storage_path,
    circle_id,
    thread_id,
    user_id
  )
);

-- Explicit anon denials ensure a hostile permissive TO PUBLIC policy cannot
-- expose attachment metadata or content-bearing OCR/extraction columns.
CREATE POLICY message_attachments_anon_select_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR SELECT
TO anon
USING (false);

CREATE POLICY message_attachments_anon_insert_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (false);

CREATE POLICY message_attachments_anon_update_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR UPDATE
TO anon
USING (false)
WITH CHECK (false);

CREATE POLICY message_attachments_anon_delete_deny_v1
ON public.message_attachments
AS RESTRICTIVE
FOR DELETE
TO anon
USING (false);

REVOKE ALL ON TABLE public.message_attachments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.message_attachments TO authenticated;
GRANT ALL ON TABLE public.message_attachments TO service_role;

-- Storage INSERT happens before the metadata row exists, so authority comes
-- from the exact path shape emitted by chatAttachments.ts:
--   <circle_uuid>/<thread_uuid|_direct>/<user_uuid>/<uuid>-<safe_name>
CREATE OR REPLACE FUNCTION public.message_attachment_storage_insert_authorized_v1(
  p_name text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_name IS NOT NULL
    AND array_length(pg_catalog.string_to_array(p_name, '/'), 1) = 4
    AND split_part(p_name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND (
      split_part(p_name, '/', 2) = '_direct'
      OR split_part(p_name, '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    AND split_part(p_name, '/', 3) = auth.uid()::text
    AND split_part(p_name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    AND EXISTS (
      SELECT 1
      FROM public.circle_members AS membership
      WHERE membership.circle_id = split_part(p_name, '/', 1)::uuid
        AND membership.user_id = auth.uid()
    )
    AND (
      split_part(p_name, '/', 2) = '_direct'
      OR public.message_thread_visible_to_current_user(
        split_part(p_name, '/', 1)::uuid,
        split_part(p_name, '/', 2)::uuid
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_visible_v1(
  p_name text,
  p_owner_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_owner_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.message_attachments AS attachment
      WHERE attachment.storage_path = p_name
        AND attachment.user_id::text = p_owner_id
        AND public.message_attachment_storage_path_matches_row_v1(
          attachment.storage_path,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
        AND public.message_attachment_row_visible_v1(
          attachment.message_id,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
    );
$function$;

CREATE OR REPLACE FUNCTION public.message_attachment_storage_object_owned_v1(
  p_name text,
  p_owner_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND p_owner_id = auth.uid()::text
    AND EXISTS (
      SELECT 1
      FROM public.message_attachments AS attachment
      WHERE attachment.storage_path = p_name
        AND attachment.user_id = auth.uid()
        AND attachment.user_id::text = p_owner_id
        AND public.message_attachment_storage_path_matches_row_v1(
          attachment.storage_path,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
        AND public.message_attachment_row_visible_v1(
          attachment.message_id,
          attachment.circle_id,
          attachment.thread_id,
          attachment.user_id
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.message_attachment_storage_insert_authorized_v1(text)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_attachment_storage_object_visible_v1(text, text)
FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.message_attachment_storage_object_owned_v1(text, text)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_insert_authorized_v1(text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_object_visible_v1(text, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.message_attachment_storage_object_owned_v1(text, text)
TO authenticated;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_attachments_select_visible_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_select_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_insert_owned_scope_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_insert_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_update_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_delete_owner_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_delete_guard_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_select_deny_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_insert_deny_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_update_deny_v1 ON storage.objects;
DROP POLICY IF EXISTS chat_attachments_anon_delete_deny_v1 ON storage.objects;

-- Remove the pre-release one-argument helper overloads only after their known
-- policies are gone. An unknown dependency fails the transaction rather than
-- cascading into another feature.
DROP FUNCTION IF EXISTS public.message_attachment_storage_object_visible_v1(text);
DROP FUNCTION IF EXISTS public.message_attachment_storage_object_owned_v1(text);

-- Canonical permissive policies keep this bucket functional. Restrictive
-- companion policies ensure an environment-specific broad Storage policy
-- cannot OR around the exact Chat attachment authority.
CREATE POLICY chat_attachments_select_visible_v1
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND public.message_attachment_storage_object_visible_v1(name, owner_id::text)
);

CREATE POLICY chat_attachments_select_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  bucket_id <> 'chat-attachments'
  OR public.message_attachment_storage_object_visible_v1(name, owner_id::text)
);

CREATE POLICY chat_attachments_insert_owned_scope_v1
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-attachments'
  AND owner_id::text = auth.uid()::text
  AND public.message_attachment_storage_insert_authorized_v1(name)
);

CREATE POLICY chat_attachments_insert_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id <> 'chat-attachments'
  OR (
    owner_id::text = auth.uid()::text
    AND public.message_attachment_storage_insert_authorized_v1(name)
  )
);

CREATE POLICY chat_attachments_update_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (bucket_id <> 'chat-attachments')
WITH CHECK (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_delete_owner_v1
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'chat-attachments'
  AND owner_id::text = auth.uid()::text
  AND public.message_attachment_storage_object_owned_v1(name, owner_id::text)
);

CREATE POLICY chat_attachments_delete_guard_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  bucket_id <> 'chat-attachments'
  OR (
    owner_id::text = auth.uid()::text
    AND public.message_attachment_storage_object_owned_v1(name, owner_id::text)
  )
);

-- A hostile or legacy permissive policy declared TO PUBLIC also applies to
-- anon. Operation-specific restrictive anon policies make the private bucket
-- unreachable even in that environment; other buckets remain unaffected.
CREATE POLICY chat_attachments_anon_select_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR SELECT
TO anon
USING (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_anon_insert_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR INSERT
TO anon
WITH CHECK (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_anon_update_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO anon
USING (bucket_id <> 'chat-attachments')
WITH CHECK (bucket_id <> 'chat-attachments');

CREATE POLICY chat_attachments_anon_delete_deny_v1
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO anon
USING (bucket_id <> 'chat-attachments');

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §40 readiness (catalog and policy convergence only; follow with an
-- authenticated two-user private/shared/circle-thread and Storage test).
SELECT
  EXISTS (
    SELECT 1
    FROM storage.buckets AS bucket
    WHERE bucket.id = 'chat-attachments'
      AND bucket.name = 'chat-attachments'
      AND bucket.public = false
      AND bucket.file_size_limit = 52428800
  ) AS attachment_bucket_private_ready,
  to_regprocedure('public.message_attachment_link_target_is_valid_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.guard_authenticated_message_attachment_update_v1()') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = 'public.message_attachments'::regclass
        AND trigger_row.tgname = 'trg_guard_authenticated_message_attachment_update_v1'
        AND trigger_row.tgenabled <> 'D'
        AND NOT trigger_row.tgisinternal
    ) AS attachment_link_integrity_compatible,
  to_regprocedure('public.message_attachment_storage_path_matches_row_v1(text,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_object_matches_row_v1(text,uuid,uuid,uuid)') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.message_attachments'::regclass
        AND constraint_row.conname = 'message_attachments_storage_path_matches_scope_v1'
        AND constraint_row.convalidated
    )
    AND to_regclass('public.message_attachments_storage_path_unique_v1') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.message_attachments AS attachment
      WHERE NOT public.message_attachment_storage_path_matches_row_v1(
        attachment.storage_path,
        attachment.circle_id,
        attachment.thread_id,
        attachment.user_id
      )
        OR NOT EXISTS (
          SELECT 1
          FROM storage.objects AS object_row
          WHERE object_row.bucket_id = 'chat-attachments'
            AND object_row.name = attachment.storage_path
            AND object_row.owner_id::text = attachment.user_id::text
        )
    ) AS attachment_storage_path_identity_ready,
  to_regprocedure('public.message_attachment_row_visible_v1(uuid,uuid,uuid,uuid)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_insert_authorized_v1(text)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_object_visible_v1(text,text)') IS NOT NULL
    AND to_regprocedure('public.message_attachment_storage_object_owned_v1(text,text)') IS NOT NULL
    AS attachment_visibility_helpers_ready,
  (
    SELECT count(*) = 12
      AND count(*) FILTER (WHERE permissive = 'PERMISSIVE') = 4
      AND count(*) FILTER (WHERE permissive = 'RESTRICTIVE') = 8
      AND count(*) FILTER (WHERE roles = ARRAY['authenticated']::name[]) = 8
      AND count(*) FILTER (WHERE roles = ARRAY['anon']::name[]) = 4
      AND count(*) FILTER (WHERE cmd = 'SELECT' AND qual IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'INSERT' AND with_check IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'UPDATE' AND qual IS NOT NULL AND with_check IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'DELETE' AND qual IS NOT NULL) = 3
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'message_attachments'
      AND policyname IN (
        'message_attachments_select_exact_visibility_v1',
        'message_attachments_insert_owner_staged_v1',
        'message_attachments_update_owner_exact_link_v1',
        'message_attachments_delete_owner_visible_v1',
        'message_attachments_select_exact_visibility_guard_v1',
        'message_attachments_insert_owner_staged_guard_v1',
        'message_attachments_update_owner_exact_link_guard_v1',
        'message_attachments_delete_owner_visible_guard_v1',
        'message_attachments_anon_select_deny_v1',
        'message_attachments_anon_insert_deny_v1',
        'message_attachments_anon_update_deny_v1',
        'message_attachments_anon_delete_deny_v1'
      )
  ) AS attachment_table_policies_converged,
  (
    SELECT count(*) = 11
      AND count(*) FILTER (WHERE permissive = 'PERMISSIVE') = 3
      AND count(*) FILTER (WHERE permissive = 'RESTRICTIVE') = 8
      AND count(*) FILTER (WHERE roles = ARRAY['authenticated']::name[]) = 7
      AND count(*) FILTER (WHERE roles = ARRAY['anon']::name[]) = 4
      AND count(*) FILTER (WHERE cmd = 'SELECT' AND qual IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'INSERT' AND with_check IS NOT NULL) = 3
      AND count(*) FILTER (WHERE cmd = 'UPDATE' AND qual IS NOT NULL AND with_check IS NOT NULL) = 2
      AND count(*) FILTER (WHERE cmd = 'DELETE' AND qual IS NOT NULL) = 3
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'chat_attachments_select_visible_v1',
        'chat_attachments_select_guard_v1',
        'chat_attachments_insert_owned_scope_v1',
        'chat_attachments_insert_guard_v1',
        'chat_attachments_update_guard_v1',
        'chat_attachments_delete_owner_v1',
        'chat_attachments_delete_guard_v1',
        'chat_attachments_anon_select_deny_v1',
        'chat_attachments_anon_insert_deny_v1',
        'chat_attachments_anon_update_deny_v1',
        'chat_attachments_anon_delete_deny_v1'
      )
  ) AS attachment_storage_policies_converged,
  has_table_privilege('authenticated', 'public.message_attachments', 'SELECT')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'INSERT')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.message_attachments', 'DELETE')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'INSERT')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'UPDATE')
    AND NOT has_table_privilege('anon', 'public.message_attachments', 'DELETE')
    AND has_table_privilege('service_role', 'public.message_attachments', 'SELECT')
    AND has_table_privilege('service_role', 'public.message_attachments', 'INSERT')
    AND has_table_privilege('service_role', 'public.message_attachments', 'UPDATE')
    AND has_table_privilege('service_role', 'public.message_attachments', 'DELETE')
    AS attachment_table_grants_ready;

-- =============================================================================
-- §41. Device-private run-approval privacy and authority (2026-08-13)
-- Source: supabase/migrations/20260813180000_device_private_run_approval_authority.sql
-- =============================================================================

-- Device-private OpenSwan approval privacy and resolver authority.
--
-- SQL section 28 validates schema-v2 approval state transitions, but the
-- historical circle-wide agent_run_approvals policy lets any current circle
-- member read the payload and attempt those transitions. The
-- desktop.open_attachment approval is device-private authority: only the user
-- who requested the canonical row may read, resolve, or consume it. Restrictive
-- SELECT and UPDATE policies compose with every permissive policy, including
-- future FOR ALL drift, without replacing the existing approval state machine.
-- PostgreSQL and service_role maintenance retain their normal RLS bypass.

BEGIN;

-- §41 deliberately extends the §28 schema-v2 state machine. Abort intact if
-- the canonical transition function is absent instead of installing a privacy
-- boundary around otherwise unguarded approval mutations.
DO $device_private_approval_dependency_preflight$
BEGIN
  IF to_regprocedure('public.guard_tool_v2_run_approval()') IS NULL THEN
    RAISE EXCEPTION 'device_private_run_approval_authority: apply SQL section 28 first'
      USING ERRCODE = '23514';
  END IF;
END
$device_private_approval_dependency_preflight$;

ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_approvals_device_private_select_guard_v1
ON public.agent_run_approvals;

CREATE POLICY agent_run_approvals_device_private_select_guard_v1
ON public.agent_run_approvals
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT COALESCE(
    payload->>'approvalSchemaVersion' = '2'
      AND payload->>'toolName' = 'desktop.open_attachment',
    false
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
);

DROP POLICY IF EXISTS agent_run_approvals_device_private_update_guard_v1
ON public.agent_run_approvals;

CREATE POLICY agent_run_approvals_device_private_update_guard_v1
ON public.agent_run_approvals
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  NOT COALESCE(
    payload->>'approvalSchemaVersion' = '2'
      AND payload->>'toolName' = 'desktop.open_attachment',
    false
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
)
WITH CHECK (
  NOT COALESCE(
    payload->>'approvalSchemaVersion' = '2'
      AND payload->>'toolName' = 'desktop.open_attachment',
    false
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
);

-- §28's SECURITY DEFINER transition function requires auth.uid(), including
-- when invoked by maintenance roles. Recreate only its UPDATE trigger so the
-- state machine remains mandatory for authenticated callers while actual
-- trusted database roles retain maintenance authority. Request/JWT fields
-- cannot manufacture current_user membership in these roles.
DROP TRIGGER IF EXISTS trg_guard_tool_v2_run_approval_update
ON public.agent_run_approvals;

CREATE TRIGGER trg_guard_tool_v2_run_approval_update
BEFORE UPDATE ON public.agent_run_approvals
FOR EACH ROW
WHEN (
  current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
  AND (
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
)
EXECUTE FUNCTION public.guard_tool_v2_run_approval();

COMMIT;

NOTIFY pgrst, 'reload schema';

-- §41 readiness (catalog convergence only; follow with an authenticated
-- two-member privacy/approve/reject/consume test plus trusted-writer
-- maintenance).
SELECT
  (
    SELECT count(*) = 1
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd = 'SELECT')
      AND bool_and(roles = ARRAY['authenticated']::name[])
      AND bool_and(qual IS NOT NULL)
      AND bool_and(with_check IS NULL)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_approvals'
      AND policyname = 'agent_run_approvals_device_private_select_guard_v1'
  ) AS device_private_approval_select_guard_ready,
  (
    SELECT count(*) = 1
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd = 'UPDATE')
      AND bool_and(roles = ARRAY['authenticated']::name[])
      AND bool_and(qual IS NOT NULL)
      AND bool_and(with_check IS NOT NULL)
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_approvals'
      AND policyname = 'agent_run_approvals_device_private_update_guard_v1'
  ) AS device_private_approval_update_guard_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_run_approvals'::regclass
      AND trigger_row.tgname = 'trg_guard_tool_v2_run_approval_update'
      AND trigger_row.tgfoid = 'public.guard_tool_v2_run_approval()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) AS device_private_approval_state_machine_ready;

-- BEGIN SECTION 42: Office OAuth credential control plane
-- OAuth provider credential control plane for the Office Calendar and Email
-- integrations.
--
-- A provider network request cannot participate in a PostgreSQL transaction.
-- This migration therefore uses durable intent epochs, credential revisions,
-- and bounded refresh claims so a stale callback/refresh cannot overwrite a
-- disconnect, a newer authorization, or another worker's rotating token.
-- Google/Microsoft OAuth secrets leave the generic user_api_keys surface and
-- both access and refresh tokens are encrypted at rest.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.oauth_provider_credentials (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected',
  revision bigint NOT NULL DEFAULT 0,
  intent_epoch bigint NOT NULL DEFAULT 0,
  authorization_operation_id uuid,
  authorization_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  access_token_enc bytea,
  refresh_token_enc bytea,
  expires_at timestamptz,
  account_email text NOT NULL DEFAULT '',
  provider_subject text,
  granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  refresh_claim_id uuid,
  refresh_claim_expires_at timestamptz,
  last_operation_id uuid,
  last_operation_kind text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, provider),
  CONSTRAINT oauth_provider_credentials_provider_check
    CHECK (provider IN ('google', 'microsoft')),
  CONSTRAINT oauth_provider_credentials_status_check
    CHECK (status IN ('connected', 'disconnected')),
  CONSTRAINT oauth_provider_credentials_revision_check
    CHECK (revision >= 0 AND intent_epoch >= 0),
  CONSTRAINT oauth_provider_credentials_scope_check
    CHECK (
      authorization_scopes <@ ARRAY['calendar', 'email']::text[]
      AND granted_scopes <@ ARRAY['calendar', 'email']::text[]
    ),
  CONSTRAINT oauth_provider_credentials_secret_shape_check
    CHECK (
      (status = 'connected'
        AND access_token_enc IS NOT NULL
        AND refresh_token_enc IS NOT NULL
        AND expires_at IS NOT NULL
        AND cardinality(granted_scopes) > 0)
      OR
      (status = 'disconnected'
        AND access_token_enc IS NULL
        AND refresh_token_enc IS NULL
        AND expires_at IS NULL
        AND cardinality(granted_scopes) = 0)
    ),
  CONSTRAINT oauth_provider_credentials_refresh_claim_check
    CHECK (
      (refresh_claim_id IS NULL AND refresh_claim_expires_at IS NULL)
      OR
      (status = 'connected'
        AND refresh_claim_id IS NOT NULL
        AND refresh_claim_expires_at IS NOT NULL)
    )
);

ALTER TABLE public.oauth_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oauth_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_provider_credentials TO service_role;

COMMENT ON TABLE public.oauth_provider_credentials IS
  'Service-only encrypted Google/Microsoft OAuth credentials with revision, intent, and refresh-lease fencing.';

ALTER TABLE public.email_calendar_oauth_states
  ADD COLUMN IF NOT EXISTS credential_revision bigint,
  ADD COLUMN IF NOT EXISTS intent_epoch bigint,
  ADD COLUMN IF NOT EXISTS operation_id uuid;

CREATE OR REPLACE FUNCTION public.normalize_office_oauth_scopes_v1(p_scopes text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['calendar', 'email']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      regexp_split_to_array(lower(coalesce(p_scopes, '')), E'\\s*,\\s*')
    )
    ORDER BY allowed.ordinal
  );
$function$;

REVOKE ALL ON FUNCTION public.normalize_office_oauth_scopes_v1(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_office_oauth_scopes_v1(text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_office_oauth_authorization_v1(
  p_user_id uuid,
  p_provider text,
  p_requested_scopes text,
  p_operation_id uuid
)
RETURNS TABLE(
  intent_epoch bigint,
  credential_revision bigint,
  required_scopes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_requested text[] := public.normalize_office_oauth_scopes_v1(p_requested_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_required text[];
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft')
     OR p_operation_id IS NULL OR cardinality(v_requested) = 0 THEN
    RAISE EXCEPTION 'invalid_oauth_authorization_reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, v_provider)
  ON CONFLICT (user_id, provider) DO NOTHING;

  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF v_row.authorization_operation_id = p_operation_id THEN
    RETURN QUERY SELECT
      v_row.intent_epoch,
      v_row.revision,
      array_to_string(v_row.authorization_scopes, ',');
    RETURN;
  END IF;

  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['calendar', 'email']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      v_requested
      || v_row.authorization_scopes
      || CASE WHEN v_row.status = 'connected'
        THEN v_row.granted_scopes
        ELSE ARRAY[]::text[]
      END
    )
    ORDER BY allowed.ordinal
  ) INTO v_required;

  UPDATE public.oauth_provider_credentials AS credential
  SET intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = p_operation_id,
      authorization_scopes = v_required,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING credential.intent_epoch, credential.revision
    INTO intent_epoch, credential_revision;

  required_scopes := array_to_string(v_required, ',');
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_office_oauth_authorization_v1(
  p_user_id uuid,
  p_provider text,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_account_email text,
  p_provider_subject text,
  p_granted_scopes text,
  p_required_scopes text
)
RETURNS TABLE(applied boolean, credential_revision bigint, granted_scopes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_granted text[] := public.normalize_office_oauth_scopes_v1(p_granted_scopes);
  v_required text[] := public.normalize_office_oauth_scopes_v1(p_required_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_refresh_token text;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft')
     OR p_operation_id IS NULL OR p_expected_intent_epoch IS NULL
     OR p_expected_revision IS NULL
     OR nullif(trim(coalesce(p_access_token, '')), '') IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR nullif(trim(coalesce(p_provider_subject, '')), '') IS NULL
     OR cardinality(v_required) = 0 THEN
    RAISE EXCEPTION 'invalid_oauth_authorization_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'authorization'
     AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.authorization_operation_id IS DISTINCT FROM p_operation_id
     OR v_row.authorization_scopes IS DISTINCT FROM v_required THEN
    RAISE EXCEPTION 'oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_required <@ v_granted) THEN
    RAISE EXCEPTION 'oauth_scope_union_not_granted' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  v_refresh_token := nullif(trim(coalesce(p_refresh_token, '')), '');
  IF v_refresh_token IS NULL
     AND v_row.status = 'connected'
     AND v_row.provider_subject = trim(p_provider_subject)
     AND v_row.refresh_token_enc IS NOT NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;
  IF v_refresh_token IS NULL THEN
    RAISE EXCEPTION 'oauth_refresh_token_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'connected',
      revision = credential.revision + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = extensions.pgp_sym_encrypt(trim(p_access_token), v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      account_email = left(trim(coalesce(p_account_email, '')), 320),
      provider_subject = left(trim(p_provider_subject), 512),
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'authorization',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
    INTO applied, credential_revision, granted_scopes;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_office_oauth_refresh_v1(
  p_user_id uuid,
  p_provider text,
  p_claim_id uuid,
  p_lease_seconds integer DEFAULT 45
)
RETURNS TABLE(
  outcome text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  account_email text,
  provider_subject text,
  granted_scopes text,
  credential_revision bigint,
  intent_epoch bigint,
  refresh_claim_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_passphrase text;
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 45), 120));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft') OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_refresh_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF NOT FOUND OR v_row.status <> 'connected' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::text, NULL::timestamptz,
      ''::text, NULL::text, ''::text, NULL::bigint, NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  v_passphrase := public.app_encryption_key();
  IF v_row.access_token_enc IS NOT NULL
     AND v_row.expires_at > clock_timestamp() + interval '5 minutes' THEN
    RETURN QUERY SELECT
      'fresh'::text,
      extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
      NULL::text,
      v_row.expires_at,
      v_row.account_email,
      v_row.provider_subject,
      array_to_string(v_row.granted_scopes, ','),
      v_row.revision,
      v_row.intent_epoch,
      NULL::uuid;
    RETURN;
  END IF;

  IF v_row.refresh_claim_id IS NOT NULL
     AND v_row.refresh_claim_id <> p_claim_id
     AND v_row.refresh_claim_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT 'busy'::text, NULL::text, NULL::text, v_row.expires_at,
      v_row.account_email, v_row.provider_subject, array_to_string(v_row.granted_scopes, ','),
      v_row.revision, v_row.intent_epoch, v_row.refresh_claim_id;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = p_claim_id,
      refresh_claim_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider;

  RETURN QUERY SELECT
    'claimed'::text,
    extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
    extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text,
    v_row.expires_at,
    v_row.account_email,
    v_row.provider_subject,
    array_to_string(v_row.granted_scopes, ','),
    v_row.revision,
    v_row.intent_epoch,
    p_claim_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_office_oauth_refresh_v1(
  p_user_id uuid,
  p_provider text,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_claim_id uuid,
  p_operation_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_provider_subject text,
  p_granted_scopes text
)
RETURNS TABLE(applied boolean, credential_revision bigint, granted_scopes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_granted text[] := public.normalize_office_oauth_scopes_v1(p_granted_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_refresh_token text;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft')
     OR p_claim_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_revision IS NULL
     OR nullif(trim(coalesce(p_access_token, '')), '') IS NULL
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'invalid_oauth_refresh_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'refresh' AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.status <> 'connected'
     OR v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.refresh_claim_id IS DISTINCT FROM p_claim_id
     OR v_row.refresh_claim_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_row.granted_scopes <@ v_granted) THEN
    RAISE EXCEPTION 'oauth_scope_narrowed' USING ERRCODE = '22023';
  END IF;
  IF v_row.provider_subject IS NOT NULL
     AND v_row.provider_subject IS DISTINCT FROM nullif(trim(coalesce(p_provider_subject, '')), '') THEN
    RAISE EXCEPTION 'oauth_account_mismatch' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  v_refresh_token := nullif(trim(coalesce(p_refresh_token, '')), '');
  IF v_refresh_token IS NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET revision = credential.revision + 1,
      access_token_enc = extensions.pgp_sym_encrypt(trim(p_access_token), v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      provider_subject = coalesce(credential.provider_subject, nullif(trim(coalesce(p_provider_subject, '')), '')),
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'refresh',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
    INTO applied, credential_revision, granted_scopes;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_office_oauth_refresh_v1(
  p_user_id uuid,
  p_provider text,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_claim_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_released boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id
    AND credential.provider = v_provider
    AND credential.status = 'connected'
    AND credential.intent_epoch = p_expected_intent_epoch
    AND credential.revision = p_expected_revision
    AND credential.refresh_claim_id = p_claim_id;
  v_released := FOUND;
  RETURN v_released;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_office_oauth_provider_v1(
  p_user_id uuid,
  p_provider text,
  p_operation_id uuid
)
RETURNS TABLE(disconnected boolean, credential_revision bigint, intent_epoch bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR v_provider NOT IN ('google', 'microsoft') OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_disconnect' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || v_provider || ':oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, v_provider)
  ON CONFLICT (user_id, provider) DO NOTHING;
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  FOR UPDATE;

  IF v_row.last_operation_kind = 'disconnect' AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'disconnected',
      revision = credential.revision + 1,
      intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = NULL,
      refresh_token_enc = NULL,
      expires_at = NULL,
      account_email = '',
      provider_subject = NULL,
      granted_scopes = ARRAY[]::text[],
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'disconnect',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = v_provider
  RETURNING true, credential.revision, credential.intent_epoch
    INTO disconnected, credential_revision, intent_epoch;

  DELETE FROM public.user_api_keys AS legacy
  WHERE legacy.user_id = p_user_id
    AND lower(legacy.provider) = v_provider
    AND lower(coalesce(legacy.label, 'default')) = 'oauth';
  RETURN NEXT;
END;
$function$;

-- Preserve valid legacy Google/Microsoft OAuth rows, then remove their
-- plaintext refresh-token metadata from the generic credential table. Legacy
-- rows have no stable provider subject, so a later callback may not reuse their
-- refresh token unless the provider issues a fresh one.
DO $legacy_migration$
DECLARE
  v_row record;
  v_meta jsonb;
  v_access_token text;
  v_refresh_token text;
  v_expires_at timestamptz;
  v_scopes text[];
  v_passphrase text := public.app_encryption_key();
BEGIN
  FOR v_row IN
    SELECT key_row.*
    FROM public.user_api_keys AS key_row
    WHERE lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    FOR UPDATE
  LOOP
    BEGIN
      v_meta := coalesce(v_row.endpoint::jsonb, '{}'::jsonb);
    EXCEPTION WHEN others THEN
      v_meta := '{}'::jsonb;
    END;
    BEGIN
      v_access_token := extensions.pgp_sym_decrypt(v_row.api_key_enc, v_passphrase)::text;
    EXCEPTION WHEN others THEN
      v_access_token := NULL;
    END;
    v_refresh_token := nullif(trim(coalesce(v_meta->>'refresh_token', '')), '');
    BEGIN
      v_expires_at := (v_meta->>'expires_at')::timestamptz;
    EXCEPTION WHEN others THEN
      v_expires_at := NULL;
    END;
    v_scopes := public.normalize_office_oauth_scopes_v1(v_meta->>'scopes');

    IF nullif(trim(coalesce(v_access_token, '')), '') IS NOT NULL
       AND v_refresh_token IS NOT NULL
       AND v_expires_at IS NOT NULL
       AND cardinality(v_scopes) > 0 THEN
      INSERT INTO public.oauth_provider_credentials(
        user_id, provider, status, access_token_enc, refresh_token_enc,
        expires_at, account_email, granted_scopes
      ) VALUES (
        v_row.user_id,
        lower(v_row.provider),
        'connected',
        extensions.pgp_sym_encrypt(trim(v_access_token), v_passphrase),
        extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
        v_expires_at,
        left(trim(coalesce(v_meta->>'email', '')), 320),
        v_scopes
      ) ON CONFLICT (user_id, provider) DO NOTHING;
    ELSE
      INSERT INTO public.oauth_provider_credentials(user_id, provider)
      VALUES (v_row.user_id, lower(v_row.provider))
      ON CONFLICT (user_id, provider) DO NOTHING;
    END IF;
  END LOOP;

  DELETE FROM public.user_api_keys AS key_row
  WHERE lower(key_row.provider) IN ('google', 'microsoft')
    AND lower(coalesce(key_row.label, 'default')) = 'oauth';
END;
$legacy_migration$;

-- Canonical RLS keeps ordinary BYOK rows owner-managed while reserving the
-- Google/Microsoft OAuth namespace for the service-only control plane.
DO $policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_api_keys'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_api_keys', policy_row.policyname);
  END LOOP;
END;
$policies$;

CREATE POLICY user_api_keys_select_own_non_oauth
  ON public.user_api_keys FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_insert_own_non_oauth
  ON public.user_api_keys FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_update_own_non_oauth
  ON public.user_api_keys FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_delete_own_non_oauth
  ON public.user_api_keys FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );

CREATE OR REPLACE FUNCTION public.store_user_api_key(
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_id uuid;
  v_user_id uuid := auth.uid();
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_label text := coalesce(nullif(trim(p_label), ''), 'default');
  v_passphrase text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF v_provider IN ('google', 'microsoft') AND lower(v_label) = 'oauth' THEN
    RAISE EXCEPTION 'reserved_oauth_credential' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
  VALUES (v_user_id, v_provider, extensions.pgp_sym_encrypt(p_api_key, v_passphrase), v_label, nullif(trim(p_endpoint), ''))
  ON CONFLICT (user_id, provider, label) DO UPDATE
  SET api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
      endpoint = coalesce(nullif(trim(p_endpoint), ''), public.user_api_keys.endpoint),
      is_active = true,
      updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.store_user_api_key_for_user(
  p_user_id uuid,
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_id uuid;
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_label text := coalesce(nullif(trim(p_label), ''), 'default');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF v_provider IN ('google', 'microsoft') AND lower(v_label) = 'oauth' THEN
    RAISE EXCEPTION 'reserved_oauth_credential' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
  VALUES (p_user_id, v_provider, extensions.pgp_sym_encrypt(p_api_key, v_passphrase), v_label, nullif(trim(p_endpoint), ''))
  ON CONFLICT (user_id, provider, label) DO UPDATE
  SET api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
      endpoint = coalesce(nullif(trim(p_endpoint), ''), public.user_api_keys.endpoint),
      is_active = true,
      updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  RETURN QUERY
  SELECT extensions.pgp_sym_decrypt(key_row.api_key_enc, v_passphrase)::text,
         key_row.endpoint
  FROM public.user_api_keys AS key_row
  WHERE key_row.user_id = p_user_id
    AND key_row.provider = lower(trim(p_provider))
    AND (p_label IS NULL OR key_row.label = p_label)
    AND key_row.is_active = true
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.updated_at DESC
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_user_api_key(p_key_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.user_api_keys AS key_row
  WHERE key_row.id = p_key_id
    AND key_row.user_id = auth.uid()
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_user_api_keys()
RETURNS TABLE(
  id uuid,
  provider text,
  label text,
  endpoint text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT key_row.id, key_row.provider, key_row.label, key_row.endpoint,
         key_row.is_active, key_row.created_at, key_row.updated_at
  FROM public.user_api_keys AS key_row
  WHERE key_row.user_id = auth.uid()
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.provider, key_row.label;
END;
$function$;

DROP FUNCTION IF EXISTS public.store_oauth_credential_for_user(
  uuid, text, text, text, timestamptz, text, text, text
);

REVOKE ALL ON FUNCTION public.store_user_api_key(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.store_user_api_key_for_user(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_api_key(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_user_api_key(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_user_api_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_user_api_key(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_user_api_key_for_user(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_api_key(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_api_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_api_keys() TO authenticated;

REVOKE ALL ON FUNCTION public.reserve_office_oauth_authorization_v1(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_office_oauth_authorization_v1(uuid, text, bigint, bigint, uuid, text, text, timestamptz, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_office_oauth_refresh_v1(uuid, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disconnect_office_oauth_provider_v1(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_office_oauth_authorization_v1(uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_office_oauth_authorization_v1(uuid, text, bigint, bigint, uuid, text, text, timestamptz, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_office_oauth_refresh_v1(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_office_oauth_refresh_v1(uuid, text, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_office_oauth_provider_v1(uuid, text, uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
-- END SECTION 42: Office OAuth credential control plane

-- =============================================================================
-- SECTION 43: Figma OAuth credential and callback control plane
-- Source: supabase/migrations/20260813200000_figma_oauth_credential_control.sql
-- Apply only after section 42; deploy the matching figma-oauth function after
-- this transaction succeeds.
-- =============================================================================
-- Figma OAuth credential and callback control plane.
--
-- OAuth provider calls cannot share a PostgreSQL transaction with local state.
-- Durable intent epochs, credential revisions, and bounded refresh leases fence
-- stale callbacks, concurrent token rotation, and disconnect races. The Figma
-- callback state is consumed atomically before the provider token exchange.
-- Access tokens, refresh tokens, and PKCE verifiers are encrypted at rest and
-- are available only to service-role RPCs.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Extend the canonical provider table without creating another secret store.
ALTER TABLE public.oauth_provider_credentials
  DROP CONSTRAINT IF EXISTS oauth_provider_credentials_provider_check,
  DROP CONSTRAINT IF EXISTS oauth_provider_credentials_scope_check;

ALTER TABLE public.oauth_provider_credentials
  ADD CONSTRAINT oauth_provider_credentials_provider_check
    CHECK (provider IN ('google', 'microsoft', 'figma')),
  ADD CONSTRAINT oauth_provider_credentials_scope_check
    CHECK (
      (
        provider IN ('google', 'microsoft')
        AND authorization_scopes <@ ARRAY['calendar', 'email']::text[]
        AND granted_scopes <@ ARRAY['calendar', 'email']::text[]
      )
      OR
      (
        provider = 'figma'
        AND authorization_scopes <@ ARRAY['file_content:read']::text[]
        AND granted_scopes <@ ARRAY['file_content:read']::text[]
      )
    );

ALTER TABLE public.oauth_provider_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oauth_provider_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_provider_credentials TO service_role;

COMMENT ON TABLE public.oauth_provider_credentials IS
  'Service-only encrypted OAuth credentials with revision, intent, and refresh-lease fencing.';

-- Upgrade the legacy nonce table in place. Rows from the old shape cannot be
-- proved to carry PKCE or a credential fence, so only those rows are retired.
ALTER TABLE public.figma_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier_enc bytea,
  ADD COLUMN IF NOT EXISTS client_nonce text,
  ADD COLUMN IF NOT EXISTS operation_id uuid,
  ADD COLUMN IF NOT EXISTS intent_epoch bigint,
  ADD COLUMN IF NOT EXISTS credential_revision bigint,
  ADD COLUMN IF NOT EXISTS requested_scopes text[],
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

DELETE FROM public.figma_oauth_states
WHERE code_verifier_enc IS NULL
   OR client_nonce IS NULL
   OR client_nonce !~ '^[a-f0-9]{48}$'
   OR operation_id IS NULL
   OR intent_epoch IS NULL
   OR credential_revision IS NULL
   OR requested_scopes IS NULL;

UPDATE public.figma_oauth_states
SET claim_expires_at = claimed_at + interval '1 minute'
WHERE claimed_at IS NOT NULL AND claim_expires_at IS NULL;
UPDATE public.figma_oauth_states
SET claim_expires_at = NULL
WHERE claimed_at IS NULL AND claim_expires_at IS NOT NULL;

ALTER TABLE public.figma_oauth_states
  ALTER COLUMN code_verifier_enc SET NOT NULL,
  ALTER COLUMN client_nonce SET NOT NULL,
  ALTER COLUMN operation_id SET NOT NULL,
  ALTER COLUMN intent_epoch SET NOT NULL,
  ALTER COLUMN credential_revision SET NOT NULL,
  ALTER COLUMN requested_scopes SET NOT NULL;

ALTER TABLE public.figma_oauth_states
  DROP CONSTRAINT IF EXISTS figma_oauth_states_fence_check,
  DROP CONSTRAINT IF EXISTS figma_oauth_states_client_nonce_check,
  DROP CONSTRAINT IF EXISTS figma_oauth_states_scope_check,
  DROP CONSTRAINT IF EXISTS figma_oauth_states_claim_lease_check;

ALTER TABLE public.figma_oauth_states
  ADD CONSTRAINT figma_oauth_states_fence_check
    CHECK (intent_epoch >= 0 AND credential_revision >= 0),
  ADD CONSTRAINT figma_oauth_states_client_nonce_check
    CHECK (client_nonce ~ '^[a-f0-9]{48}$'),
  ADD CONSTRAINT figma_oauth_states_scope_check
    CHECK (
      cardinality(requested_scopes) > 0
      AND requested_scopes <@ ARRAY['file_content:read']::text[]
    ),
  ADD CONSTRAINT figma_oauth_states_claim_lease_check
    CHECK (
      (claimed_at IS NULL AND claim_expires_at IS NULL)
      OR
      (claimed_at IS NOT NULL
        AND claim_expires_at > claimed_at
        AND claim_expires_at <= claimed_at + interval '2 minutes')
    );

ALTER TABLE public.figma_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.figma_oauth_states FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.figma_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.figma_oauth_states TO service_role;

COMMENT ON TABLE public.figma_oauth_states IS
  'Service-only, encrypted-PKCE, single-use Figma OAuth callback states.';

CREATE OR REPLACE FUNCTION public.normalize_figma_oauth_scopes_v1(p_scopes text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['file_content:read']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      regexp_split_to_array(lower(trim(coalesce(p_scopes, ''))), E'[\\s,]+')
    )
    ORDER BY allowed.ordinal
  );
$function$;

CREATE OR REPLACE FUNCTION public.cleanup_figma_oauth_states_v1(
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_deleted integer := 0;
  v_limit integer := greatest(1, least(coalesce(p_limit, 500), 5000));
  v_candidate record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  FOR v_candidate IN
    SELECT
      state_row.id,
      state_row.user_id,
      state_row.operation_id,
      state_row.intent_epoch,
      state_row.credential_revision
    FROM public.figma_oauth_states AS state_row
    WHERE (state_row.claimed_at IS NULL AND state_row.expires_at <= clock_timestamp())
       OR (state_row.claimed_at IS NOT NULL AND state_row.claim_expires_at <= clock_timestamp())
    ORDER BY coalesce(state_row.claim_expires_at, state_row.expires_at), state_row.id
    LIMIT v_limit
  LOOP
    -- Match reserve/claim/disconnect lock order: advisory user lock, credential
    -- row, then state row. The unlocked candidate is only a hint and grants no
    -- deletion or credential authority.
    PERFORM pg_advisory_xact_lock(hashtextextended(v_candidate.user_id::text || ':figma:oauth', 0));
    PERFORM 1
    FROM public.oauth_provider_credentials AS credential
    WHERE credential.user_id = v_candidate.user_id AND credential.provider = 'figma'
    FOR UPDATE;

    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.id = v_candidate.id
      AND state_row.user_id = v_candidate.user_id
      AND state_row.operation_id = v_candidate.operation_id
      AND state_row.intent_epoch = v_candidate.intent_epoch
      AND state_row.credential_revision = v_candidate.credential_revision
      AND (
        (state_row.claimed_at IS NULL AND state_row.expires_at <= clock_timestamp())
        OR (state_row.claimed_at IS NOT NULL AND state_row.claim_expires_at <= clock_timestamp())
      );
    IF NOT FOUND THEN CONTINUE; END IF;
    v_deleted := v_deleted + 1;

    -- Retire only the exact abandoned pending authorization. Keep any existing
    -- connected credential and its revision intact so ordinary refresh can
    -- resume; a newer/superseding authorization cannot match these fences.
    UPDATE public.oauth_provider_credentials AS credential
    SET authorization_operation_id = NULL,
        authorization_scopes = ARRAY[]::text[],
        updated_at = clock_timestamp()
    WHERE credential.user_id = v_candidate.user_id
      AND credential.provider = 'figma'
      AND credential.authorization_operation_id = v_candidate.operation_id
      AND credential.intent_epoch = v_candidate.intent_epoch
      AND credential.revision = v_candidate.credential_revision;
  END LOOP;
  RETURN v_deleted;
END;
$function$;

-- Remove the unpublished pre-full-state signatures if this transaction is
-- reapplied over an earlier reviewed draft. Leaving either overload callable
-- would allow a service caller to reserve or consume only the server half.
DROP FUNCTION IF EXISTS public.reserve_figma_oauth_authorization_v1(
  uuid, text, text, text, uuid, timestamptz
);
DROP FUNCTION IF EXISTS public.reserve_figma_oauth_authorization_v1(
  uuid, text, text, text, text, uuid, timestamptz
);
DROP FUNCTION IF EXISTS public.claim_figma_oauth_state_v1(text);
DROP FUNCTION IF EXISTS public.claim_figma_oauth_state_v1(text, text);

CREATE OR REPLACE FUNCTION public.reserve_figma_oauth_authorization_v1(
  p_user_id uuid,
  p_state text,
  p_client_nonce text,
  p_code_verifier text,
  p_requested_scopes text,
  p_operation_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE(
  state_id uuid,
  intent_epoch bigint,
  credential_revision bigint,
  required_scopes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_state text := trim(coalesce(p_state, ''));
  v_client_nonce text := coalesce(p_client_nonce, '');
  v_verifier text := trim(coalesce(p_code_verifier, ''));
  v_requested text[] := public.normalize_figma_oauth_scopes_v1(p_requested_scopes);
  v_required text[];
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_state_row public.figma_oauth_states%ROWTYPE;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL
     OR v_state !~ '^[a-f0-9]{48}$'
     OR v_client_nonce !~ '^[a-f0-9]{48}$'
     OR v_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
     OR cardinality(v_requested) = 0
     OR p_expires_at IS NULL
     OR p_expires_at <= clock_timestamp()
     OR p_expires_at > clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'invalid_figma_oauth_authorization_reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, 'figma')
  ON CONFLICT (user_id, provider) DO NOTHING;

  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;

  IF v_row.authorization_operation_id = p_operation_id THEN
    SELECT * INTO v_state_row
    FROM public.figma_oauth_states AS state_row
    WHERE state_row.user_id = p_user_id
      AND state_row.state = v_state
      AND state_row.client_nonce = v_client_nonce
      AND state_row.operation_id = p_operation_id;
    IF FOUND THEN
      RETURN QUERY SELECT
        v_state_row.id,
        v_state_row.intent_epoch,
        v_state_row.credential_revision,
        array_to_string(v_state_row.requested_scopes, ',');
      RETURN;
    END IF;
    RAISE EXCEPTION 'figma_oauth_authorization_operation_reused' USING ERRCODE = '22023';
  END IF;

  SELECT ARRAY(
    SELECT allowed.scope
    FROM unnest(ARRAY['file_content:read']::text[]) WITH ORDINALITY AS allowed(scope, ordinal)
    WHERE allowed.scope = ANY (
      v_requested
      || v_row.authorization_scopes
      || CASE WHEN v_row.status = 'connected'
        THEN v_row.granted_scopes
        ELSE ARRAY[]::text[]
      END
    )
    ORDER BY allowed.ordinal
  ) INTO v_required;

  UPDATE public.oauth_provider_credentials AS credential
  SET intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = p_operation_id,
      authorization_scopes = v_required,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING credential.intent_epoch, credential.revision
  INTO intent_epoch, credential_revision;

  -- A user has one live Figma authorization intent. Superseded callback states
  -- are removed in the same transaction as the intent-epoch advance.
  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id;

  v_passphrase := public.app_encryption_key();
  INSERT INTO public.figma_oauth_states(
    state, client_nonce, user_id, expires_at, code_verifier_enc, operation_id,
    intent_epoch, credential_revision, requested_scopes
  ) VALUES (
    v_state, v_client_nonce, p_user_id, p_expires_at,
    extensions.pgp_sym_encrypt(v_verifier, v_passphrase),
    p_operation_id, intent_epoch, credential_revision, v_required
  )
  RETURNING id INTO state_id;

  required_scopes := array_to_string(v_required, ',');
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_figma_oauth_state_v1(
  p_state text,
  p_client_nonce text
)
RETURNS TABLE(
  user_id uuid,
  client_nonce text,
  code_verifier text,
  intent_epoch bigint,
  credential_revision bigint,
  operation_id uuid,
  required_scopes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_state text := trim(coalesce(p_state, ''));
  v_client_nonce text := coalesce(p_client_nonce, '');
  v_user_id uuid;
  v_state_row public.figma_oauth_states%ROWTYPE;
  v_credential public.oauth_provider_credentials%ROWTYPE;
  v_credential_found boolean := false;
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF v_state !~ '^[a-f0-9]{48}$'
     OR v_client_nonce !~ '^[a-f0-9]{48}$' THEN
    RETURN;
  END IF;

  -- Read only the lock key first, then follow the canonical lock order used by
  -- reserve/disconnect: advisory lock -> credential row -> state row. The
  -- state is re-read under lock, so this unlocked hint grants no authority.
  SELECT state_row.user_id INTO v_user_id
  FROM public.figma_oauth_states AS state_row
  WHERE state_row.state = v_state
    AND state_row.client_nonce = v_client_nonce;
  IF NOT FOUND THEN RETURN; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_credential
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = v_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  v_credential_found := FOUND;
  SELECT * INTO v_state_row
  FROM public.figma_oauth_states AS state_row
  WHERE state_row.state = v_state
    AND state_row.client_nonce = v_client_nonce
    AND state_row.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_state_row.claimed_at IS NOT NULL THEN RETURN; END IF;
  IF v_state_row.expires_at <= clock_timestamp() THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.id = v_state_row.id;
    RETURN;
  END IF;
  IF NOT v_credential_found
     OR v_credential.intent_epoch <> v_state_row.intent_epoch
     OR v_credential.revision <> v_state_row.credential_revision
     OR v_credential.authorization_operation_id IS DISTINCT FROM v_state_row.operation_id
     OR v_credential.authorization_scopes IS DISTINCT FROM v_state_row.requested_scopes THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.id = v_state_row.id;
    RETURN;
  END IF;

  -- Claim before returning the PKCE verifier: one callback can cross the
  -- provider boundary at most once, including under concurrent requests. Keep
  -- the claimed row until commit or expiry so refresh/status can distinguish a
  -- legitimate in-flight exchange from an abandoned authorization.
  UPDATE public.figma_oauth_states AS state_row
  SET claimed_at = clock_timestamp(),
      claim_expires_at = clock_timestamp() + interval '1 minute'
  WHERE state_row.id = v_state_row.id
    AND state_row.claimed_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  v_passphrase := public.app_encryption_key();
  RETURN QUERY SELECT
    v_state_row.user_id,
    v_state_row.client_nonce,
    extensions.pgp_sym_decrypt(v_state_row.code_verifier_enc, v_passphrase)::text,
    v_state_row.intent_epoch,
    v_state_row.credential_revision,
    v_state_row.operation_id,
    array_to_string(v_state_row.requested_scopes, ',');
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_figma_oauth_authorization_v1(
  p_user_id uuid,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_operation_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_provider_subject text,
  p_granted_scopes text
)
RETURNS TABLE(applied boolean, credential_revision bigint, granted_scopes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_granted text[] := public.normalize_figma_oauth_scopes_v1(p_granted_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_access_token text := nullif(trim(coalesce(p_access_token, '')), '');
  v_refresh_token text := nullif(trim(coalesce(p_refresh_token, '')), '');
  v_subject text := nullif(trim(coalesce(p_provider_subject, '')), '');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_revision IS NULL
     OR v_access_token IS NULL OR length(v_access_token) > 16384
     OR (v_refresh_token IS NOT NULL AND length(v_refresh_token) > 16384)
     OR v_subject IS NULL OR length(v_subject) > 512
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR cardinality(v_granted) = 0 THEN
    RAISE EXCEPTION 'invalid_figma_oauth_authorization_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'figma_oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'authorization'
     AND v_row.last_operation_id = p_operation_id THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.user_id = p_user_id
      AND state_row.operation_id = p_operation_id
      AND state_row.intent_epoch = p_expected_intent_epoch
      AND state_row.credential_revision = p_expected_revision
      AND state_row.claimed_at IS NOT NULL;
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.authorization_operation_id IS DISTINCT FROM p_operation_id THEN
    RAISE EXCEPTION 'figma_oauth_authorization_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_row.authorization_scopes <@ v_granted) THEN
    RAISE EXCEPTION 'figma_oauth_scope_union_not_granted' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  IF v_refresh_token IS NULL
     AND v_row.status = 'connected'
     AND v_row.provider_subject = v_subject
     AND v_row.refresh_token_enc IS NOT NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;
  IF v_refresh_token IS NULL THEN
    RAISE EXCEPTION 'figma_oauth_refresh_token_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'connected',
      revision = credential.revision + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = extensions.pgp_sym_encrypt(v_access_token, v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      account_email = '',
      provider_subject = v_subject,
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'authorization',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
  INTO applied, credential_revision, granted_scopes;
  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id
    AND state_row.operation_id = p_operation_id
    AND state_row.intent_epoch = p_expected_intent_epoch
    AND state_row.credential_revision = p_expected_revision
    AND state_row.claimed_at IS NOT NULL;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_figma_oauth_refresh_v1(
  p_user_id uuid,
  p_claim_id uuid,
  p_lease_seconds integer DEFAULT 45
)
RETURNS TABLE(
  outcome text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  provider_subject text,
  granted_scopes text,
  credential_revision bigint,
  intent_epoch bigint,
  refresh_claim_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_passphrase text;
  v_lease_seconds integer := greatest(15, least(coalesce(p_lease_seconds, 45), 120));
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'invalid_figma_oauth_refresh_claim' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'connected' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::text, NULL::timestamptz,
      NULL::text, ''::text, NULL::bigint, NULL::bigint, NULL::uuid;
    RETURN;
  END IF;

  -- Self-heal an abandoned authorization while already holding the canonical
  -- per-user lock. Refresh/status/file callers must not depend on a future
  -- authorize request or scheduled cleanup to retire a missing/expired state.
  IF v_row.authorization_operation_id IS NOT NULL
     AND (
       NOT EXISTS (
         SELECT 1
         FROM public.figma_oauth_states AS state_row
         WHERE state_row.user_id = p_user_id
           AND state_row.operation_id = v_row.authorization_operation_id
           AND state_row.intent_epoch = v_row.intent_epoch
           AND state_row.credential_revision = v_row.revision
       )
       OR EXISTS (
         SELECT 1
         FROM public.figma_oauth_states AS state_row
         WHERE state_row.user_id = p_user_id
           AND state_row.operation_id = v_row.authorization_operation_id
           AND state_row.intent_epoch = v_row.intent_epoch
           AND state_row.credential_revision = v_row.revision
           AND (
             (state_row.claimed_at IS NULL AND state_row.expires_at <= clock_timestamp())
             OR (state_row.claimed_at IS NOT NULL AND state_row.claim_expires_at <= clock_timestamp())
           )
       )
     ) THEN
    DELETE FROM public.figma_oauth_states AS state_row
    WHERE state_row.user_id = p_user_id
      AND state_row.operation_id = v_row.authorization_operation_id
      AND state_row.intent_epoch = v_row.intent_epoch
      AND state_row.credential_revision = v_row.revision;
    UPDATE public.oauth_provider_credentials AS credential
    SET authorization_operation_id = NULL,
        authorization_scopes = ARRAY[]::text[],
        updated_at = clock_timestamp()
    WHERE credential.user_id = p_user_id AND credential.provider = 'figma';
    v_row.authorization_operation_id := NULL;
    v_row.authorization_scopes := ARRAY[]::text[];
  END IF;

  v_passphrase := public.app_encryption_key();
  -- Never rotate the credential revision beneath an already-open
  -- authorization callback. A still-valid old access token may be observed,
  -- but an expired token reports bounded contention until that authorization
  -- commits, is superseded, or expires and is cleaned up.
  IF v_row.authorization_operation_id IS NOT NULL THEN
    IF v_row.expires_at > clock_timestamp()
       AND v_row.access_token_enc IS NOT NULL THEN
      RETURN QUERY SELECT
        'fresh'::text,
        extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
        NULL::text,
        v_row.expires_at,
        v_row.provider_subject,
        array_to_string(v_row.granted_scopes, ','),
        v_row.revision,
        v_row.intent_epoch,
        NULL::uuid;
    ELSE
      RETURN QUERY SELECT
        'busy'::text, NULL::text, NULL::text, v_row.expires_at,
        v_row.provider_subject, array_to_string(v_row.granted_scopes, ','),
        v_row.revision, v_row.intent_epoch, NULL::uuid;
    END IF;
    RETURN;
  END IF;

  IF v_row.expires_at > clock_timestamp() + interval '5 minutes' THEN
    RETURN QUERY SELECT
      'fresh'::text,
      extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
      NULL::text,
      v_row.expires_at,
      v_row.provider_subject,
      array_to_string(v_row.granted_scopes, ','),
      v_row.revision,
      v_row.intent_epoch,
      NULL::uuid;
    RETURN;
  END IF;

  IF v_row.refresh_claim_id IS NOT NULL
     AND v_row.refresh_claim_id <> p_claim_id
     AND v_row.refresh_claim_expires_at > clock_timestamp() THEN
    RETURN QUERY SELECT
      'busy'::text, NULL::text, NULL::text, v_row.expires_at,
      v_row.provider_subject, array_to_string(v_row.granted_scopes, ','),
      v_row.revision, v_row.intent_epoch, v_row.refresh_claim_id;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = p_claim_id,
      refresh_claim_expires_at = clock_timestamp() + make_interval(secs => v_lease_seconds),
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma';

  RETURN QUERY SELECT
    'claimed'::text,
    extensions.pgp_sym_decrypt(v_row.access_token_enc, v_passphrase)::text,
    extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text,
    v_row.expires_at,
    v_row.provider_subject,
    array_to_string(v_row.granted_scopes, ','),
    v_row.revision,
    v_row.intent_epoch,
    p_claim_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.commit_figma_oauth_refresh_v1(
  p_user_id uuid,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_claim_id uuid,
  p_operation_id uuid,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_provider_subject text,
  p_granted_scopes text
)
RETURNS TABLE(applied boolean, credential_revision bigint, granted_scopes text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_granted text[] := public.normalize_figma_oauth_scopes_v1(p_granted_scopes);
  v_row public.oauth_provider_credentials%ROWTYPE;
  v_access_token text := nullif(trim(coalesce(p_access_token, '')), '');
  v_refresh_token text := nullif(trim(coalesce(p_refresh_token, '')), '');
  v_subject text := nullif(trim(coalesce(p_provider_subject, '')), '');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_claim_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_revision IS NULL
     OR v_access_token IS NULL OR length(v_access_token) > 16384
     OR (v_refresh_token IS NOT NULL AND length(v_refresh_token) > 16384)
     OR p_expires_at IS NULL OR p_expires_at <= clock_timestamp()
     OR cardinality(v_granted) = 0 THEN
    RAISE EXCEPTION 'invalid_figma_oauth_refresh_commit' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'figma_oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF v_row.last_operation_kind = 'refresh' AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, array_to_string(v_row.granted_scopes, ',');
    RETURN;
  END IF;
  IF v_row.status <> 'connected'
     OR v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision
     OR v_row.refresh_claim_id IS DISTINCT FROM p_claim_id
     OR v_row.refresh_claim_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'figma_oauth_refresh_stale' USING ERRCODE = '40001';
  END IF;
  IF NOT (v_row.granted_scopes <@ v_granted) THEN
    RAISE EXCEPTION 'figma_oauth_scope_narrowed' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NOT NULL
     AND v_row.provider_subject IS NOT NULL
     AND v_row.provider_subject IS DISTINCT FROM v_subject THEN
    RAISE EXCEPTION 'figma_oauth_account_mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_subject IS NULL AND v_row.provider_subject IS NULL THEN
    RAISE EXCEPTION 'figma_oauth_provider_subject_required' USING ERRCODE = '22023';
  END IF;

  v_passphrase := public.app_encryption_key();
  IF v_refresh_token IS NULL THEN
    v_refresh_token := extensions.pgp_sym_decrypt(v_row.refresh_token_enc, v_passphrase)::text;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET revision = credential.revision + 1,
      access_token_enc = extensions.pgp_sym_encrypt(v_access_token, v_passphrase),
      refresh_token_enc = extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
      expires_at = p_expires_at,
      provider_subject = coalesce(credential.provider_subject, v_subject),
      granted_scopes = v_granted,
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'refresh',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, array_to_string(credential.granted_scopes, ',')
  INTO applied, credential_revision, granted_scopes;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_figma_oauth_refresh_v1(
  p_user_id uuid,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_claim_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_released boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.oauth_provider_credentials AS credential
  SET refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id
    AND credential.provider = 'figma'
    AND credential.status = 'connected'
    AND credential.intent_epoch = p_expected_intent_epoch
    AND credential.revision = p_expected_revision
    AND credential.refresh_claim_id = p_claim_id;
  v_released := FOUND;
  RETURN v_released;
END;
$function$;

-- A provider can reject a token after it passed the local freshness check.
-- Invalidate only the exact credential revision that produced that provider
-- response. A newer authorization or refresh advances the fence and survives.
CREATE OR REPLACE FUNCTION public.invalidate_figma_oauth_credential_v1(
  p_user_id uuid,
  p_expected_intent_epoch bigint,
  p_expected_revision bigint,
  p_operation_id uuid
)
RETURNS TABLE(applied boolean, credential_revision bigint, intent_epoch bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL
     OR p_expected_intent_epoch IS NULL OR p_expected_intent_epoch < 0
     OR p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'invalid_figma_oauth_credential_invalidation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  IF v_row.last_operation_kind = 'provider_auth_rejection'
     AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  IF v_row.status <> 'connected'
     OR v_row.intent_epoch <> p_expected_intent_epoch
     OR v_row.revision <> p_expected_revision THEN
    RETURN QUERY SELECT false, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  -- A reconnect can be in progress while an earlier file request is still at
  -- Figma. Remove the exact rejected secrets, but preserve the pending
  -- authorization operation and its intent/revision fence so that the
  -- already-open callback can still commit. Superseding authorization and
  -- disconnect operations remain authoritative through the advisory lock.
  IF v_row.authorization_operation_id IS NOT NULL THEN
    UPDATE public.oauth_provider_credentials AS credential
    SET status = 'disconnected',
        access_token_enc = NULL,
        refresh_token_enc = NULL,
        expires_at = NULL,
        account_email = '',
        provider_subject = NULL,
        granted_scopes = ARRAY[]::text[],
        refresh_claim_id = NULL,
        refresh_claim_expires_at = NULL,
        last_operation_id = p_operation_id,
        last_operation_kind = 'provider_auth_rejection',
        updated_at = clock_timestamp()
    WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
    RETURNING true, credential.revision, credential.intent_epoch
    INTO applied, credential_revision, intent_epoch;
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'disconnected',
      revision = credential.revision + 1,
      intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = NULL,
      refresh_token_enc = NULL,
      expires_at = NULL,
      account_email = '',
      provider_subject = NULL,
      granted_scopes = ARRAY[]::text[],
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'provider_auth_rejection',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, credential.intent_epoch
  INTO applied, credential_revision, intent_epoch;

  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disconnect_figma_oauth_provider_v1(
  p_user_id uuid,
  p_operation_id uuid
)
RETURNS TABLE(disconnected boolean, credential_revision bigint, intent_epoch bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_figma_oauth_disconnect' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':figma:oauth', 0));
  INSERT INTO public.oauth_provider_credentials(user_id, provider)
  VALUES (p_user_id, 'figma')
  ON CONFLICT (user_id, provider) DO NOTHING;
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  FOR UPDATE;

  IF v_row.last_operation_kind = 'disconnect' AND v_row.last_operation_id = p_operation_id THEN
    RETURN QUERY SELECT true, v_row.revision, v_row.intent_epoch;
    RETURN;
  END IF;

  UPDATE public.oauth_provider_credentials AS credential
  SET status = 'disconnected',
      revision = credential.revision + 1,
      intent_epoch = credential.intent_epoch + 1,
      authorization_operation_id = NULL,
      authorization_scopes = ARRAY[]::text[],
      access_token_enc = NULL,
      refresh_token_enc = NULL,
      expires_at = NULL,
      account_email = '',
      provider_subject = NULL,
      granted_scopes = ARRAY[]::text[],
      refresh_claim_id = NULL,
      refresh_claim_expires_at = NULL,
      last_operation_id = p_operation_id,
      last_operation_kind = 'disconnect',
      updated_at = clock_timestamp()
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma'
  RETURNING true, credential.revision, credential.intent_epoch
  INTO disconnected, credential_revision, intent_epoch;

  DELETE FROM public.figma_oauth_states AS state_row
  WHERE state_row.user_id = p_user_id;
  DELETE FROM public.user_api_keys AS legacy
  WHERE legacy.user_id = p_user_id
    AND lower(legacy.provider) = 'figma'
    AND lower(coalesce(legacy.label, 'default')) = 'oauth';
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_figma_oauth_status_v1(p_user_id uuid)
RETURNS TABLE(
  status text,
  expires_at timestamptz,
  provider_subject text,
  granted_scopes text,
  credential_revision bigint,
  intent_epoch bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_row public.oauth_provider_credentials%ROWTYPE;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_figma_oauth_status' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row
  FROM public.oauth_provider_credentials AS credential
  WHERE credential.user_id = p_user_id AND credential.provider = 'figma';
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'disconnected'::text, NULL::timestamptz, NULL::text,
      ''::text, 0::bigint, 0::bigint;
    RETURN;
  END IF;
  RETURN QUERY SELECT
    v_row.status,
    v_row.expires_at,
    v_row.provider_subject,
    array_to_string(v_row.granted_scopes, ','),
    v_row.revision,
    v_row.intent_epoch;
END;
$function$;

-- Migrate only legacy rows whose full credential shape can be proved valid.
-- Invalid/incomplete legacy OAuth rows are removed rather than exposed through
-- the generic key surface or guessed into a connected state.
DO $legacy_figma_oauth_migration$
DECLARE
  v_row record;
  v_meta jsonb;
  v_access_token text;
  v_refresh_token text;
  v_expires_at timestamptz;
  v_subject text;
  v_scopes text[];
  v_passphrase text := public.app_encryption_key();
BEGIN
  FOR v_row IN
    SELECT key_row.*
    FROM public.user_api_keys AS key_row
    WHERE lower(key_row.provider) = 'figma'
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    FOR UPDATE
  LOOP
    v_meta := NULL;
    v_access_token := NULL;
    v_refresh_token := NULL;
    v_expires_at := NULL;
    v_subject := NULL;
    v_scopes := ARRAY[]::text[];
    BEGIN
      v_meta := v_row.endpoint::jsonb;
      v_access_token := extensions.pgp_sym_decrypt(v_row.api_key_enc, v_passphrase)::text;
      v_refresh_token := nullif(trim(coalesce(v_meta->>'refresh_token', '')), '');
      v_expires_at := (v_meta->>'expires_at')::timestamptz;
      v_subject := nullif(trim(coalesce(v_meta->>'provider_subject', v_meta->>'user_id_string', '')), '');
      v_scopes := public.normalize_figma_oauth_scopes_v1(v_meta->>'scopes');
    EXCEPTION WHEN OTHERS THEN
      v_access_token := NULL;
    END;

    IF nullif(trim(coalesce(v_access_token, '')), '') IS NOT NULL
       AND v_refresh_token IS NOT NULL
       AND v_expires_at > clock_timestamp()
       AND v_subject IS NOT NULL
       AND cardinality(v_scopes) > 0 THEN
      INSERT INTO public.oauth_provider_credentials(
        user_id, provider, status, revision, intent_epoch,
        access_token_enc, refresh_token_enc, expires_at, provider_subject,
        granted_scopes, last_operation_id, last_operation_kind
      ) VALUES (
        v_row.user_id, 'figma', 'connected', 1, 0,
        extensions.pgp_sym_encrypt(trim(v_access_token), v_passphrase),
        extensions.pgp_sym_encrypt(v_refresh_token, v_passphrase),
        v_expires_at, left(v_subject, 512), v_scopes,
        extensions.gen_random_uuid(), 'legacy_migration'
      )
      ON CONFLICT (user_id, provider) DO NOTHING;
    END IF;
  END LOOP;

  DELETE FROM public.user_api_keys AS key_row
  WHERE lower(key_row.provider) = 'figma'
    AND lower(coalesce(key_row.label, 'default')) = 'oauth';
END;
$legacy_figma_oauth_migration$;

-- Re-establish the generic BYOK boundary. Figma PAT/default rows remain
-- owner-managed, while the figma/oauth label joins Google/Microsoft OAuth as a
-- service-only reserved namespace.
DO $figma_user_api_key_policies$
DECLARE
  policy_row record;
BEGIN
  FOR policy_row IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_api_keys'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_api_keys', policy_row.policyname);
  END LOOP;
END;
$figma_user_api_key_policies$;

CREATE POLICY user_api_keys_select_own_non_oauth
  ON public.user_api_keys FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_insert_own_non_oauth
  ON public.user_api_keys FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_update_own_non_oauth
  ON public.user_api_keys FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );
CREATE POLICY user_api_keys_delete_own_non_oauth
  ON public.user_api_keys FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    AND NOT (
      lower(provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(label, 'default')) = 'oauth'
    )
  );

CREATE OR REPLACE FUNCTION public.store_user_api_key(
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_id uuid;
  v_user_id uuid := auth.uid();
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_label text := coalesce(nullif(trim(p_label), ''), 'default');
  v_passphrase text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF v_provider IN ('google', 'microsoft', 'figma') AND lower(v_label) = 'oauth' THEN
    RAISE EXCEPTION 'reserved_oauth_credential' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
  VALUES (v_user_id, v_provider, extensions.pgp_sym_encrypt(p_api_key, v_passphrase), v_label, nullif(trim(p_endpoint), ''))
  ON CONFLICT (user_id, provider, label) DO UPDATE
  SET api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
      endpoint = coalesce(nullif(trim(p_endpoint), ''), public.user_api_keys.endpoint),
      is_active = true,
      updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.store_user_api_key_for_user(
  p_user_id uuid,
  p_provider text,
  p_api_key text,
  p_label text DEFAULT 'default',
  p_endpoint text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_id uuid;
  v_provider text := lower(trim(coalesce(p_provider, '')));
  v_label text := coalesce(nullif(trim(p_label), ''), 'default');
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service_role_only' USING ERRCODE = '42501';
  END IF;
  IF v_provider IN ('google', 'microsoft', 'figma') AND lower(v_label) = 'oauth' THEN
    RAISE EXCEPTION 'reserved_oauth_credential' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  INSERT INTO public.user_api_keys(user_id, provider, api_key_enc, label, endpoint)
  VALUES (p_user_id, v_provider, extensions.pgp_sym_encrypt(p_api_key, v_passphrase), v_label, nullif(trim(p_endpoint), ''))
  ON CONFLICT (user_id, provider, label) DO UPDATE
  SET api_key_enc = extensions.pgp_sym_encrypt(p_api_key, v_passphrase),
      endpoint = coalesce(nullif(trim(p_endpoint), ''), public.user_api_keys.endpoint),
      is_active = true,
      updated_at = clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_api_key(
  p_user_id uuid,
  p_provider text,
  p_label text DEFAULT 'default'
)
RETURNS TABLE(api_key text, endpoint text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $function$
DECLARE
  v_passphrase text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND (auth.uid() IS NULL OR auth.uid() <> p_user_id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  v_passphrase := public.app_encryption_key();
  RETURN QUERY
  SELECT extensions.pgp_sym_decrypt(key_row.api_key_enc, v_passphrase)::text,
         key_row.endpoint
  FROM public.user_api_keys AS key_row
  WHERE key_row.user_id = p_user_id
    AND key_row.provider = lower(trim(p_provider))
    AND (p_label IS NULL OR key_row.label = p_label)
    AND key_row.is_active = true
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.updated_at DESC
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_user_api_key(p_key_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.user_api_keys AS key_row
  WHERE key_row.id = p_key_id
    AND key_row.user_id = auth.uid()
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_user_api_keys()
RETURNS TABLE(
  id uuid,
  provider text,
  label text,
  endpoint text,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT key_row.id, key_row.provider, key_row.label, key_row.endpoint,
         key_row.is_active, key_row.created_at, key_row.updated_at
  FROM public.user_api_keys AS key_row
  WHERE key_row.user_id = auth.uid()
    AND NOT (
      lower(key_row.provider) IN ('google', 'microsoft', 'figma')
      AND lower(coalesce(key_row.label, 'default')) = 'oauth'
    )
  ORDER BY key_row.provider, key_row.label;
END;
$function$;

REVOKE ALL ON FUNCTION public.normalize_figma_oauth_scopes_v1(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_figma_oauth_states_v1(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_figma_oauth_authorization_v1(uuid, text, text, text, text, uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_figma_oauth_state_v1(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_figma_oauth_authorization_v1(uuid, bigint, bigint, uuid, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_figma_oauth_refresh_v1(uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commit_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_figma_oauth_credential_v1(uuid, bigint, bigint, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disconnect_figma_oauth_provider_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_figma_oauth_status_v1(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.normalize_figma_oauth_scopes_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_figma_oauth_states_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_figma_oauth_authorization_v1(uuid, text, text, text, text, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_figma_oauth_state_v1(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_figma_oauth_authorization_v1(uuid, bigint, bigint, uuid, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_figma_oauth_refresh_v1(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid, uuid, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_figma_oauth_refresh_v1(uuid, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.invalidate_figma_oauth_credential_v1(uuid, bigint, bigint, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_figma_oauth_provider_v1(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_figma_oauth_status_v1(uuid) TO service_role;

-- Keep the generic BYOK functions usable, while their bodies reserve every
-- provider-specific OAuth namespace.
REVOKE ALL ON FUNCTION public.store_user_api_key(text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.store_user_api_key_for_user(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_user_api_key(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_user_api_key(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_user_api_keys() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_user_api_key(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_user_api_key_for_user(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_user_api_key(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_user_api_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_user_api_keys() TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
-- END SECTION 43: Figma OAuth credential and callback control plane

-- BEGIN SECTION 44: OpenSwan Chat approval-resume authority
-- Source: supabase/migrations/20260813210000_openswan_chat_approval_resume_authority.sql
-- Race-free OpenSwan Chat approval-resume authority.
--
-- A Circle Chat thread is not an agent `chat_sessions` row. Keep the exact
-- Circle Chat thread and originating human message on `agent_runs` as their
-- own immutable lineage. The pair is optional for compatibility with the
-- OpenSwan Console and legacy writers, but when present it is complete,
-- owner/circle/thread exact, and available only to main_chat OpenSwan runs.
--
-- Cross-run approval consumption then happens through one authenticated RPC.
-- It locks current membership, both run rows, the thread, the source message,
-- and the approval before it checks terminal truth and stamps the existing
-- schema-v2 one-shot dispatch receipt. Same-run and category-auto consumption
-- keep using the existing section-28 state machine; this migration neither
-- replaces that trigger nor widens its table policies.

BEGIN;

DO $openswan_chat_resume_dependency_preflight$
BEGIN
  IF to_regclass('public.agent_runs') IS NULL
     OR to_regclass('public.agent_run_approvals') IS NULL
     OR to_regclass('public.circle_chat_threads') IS NULL
     OR to_regclass('public.circle_chat_thread_members') IS NULL
     OR to_regclass('public.circle_members') IS NULL
     OR to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: apply the agent-run and thread-scoped Chat migrations first'
      USING ERRCODE = '23514';
  END IF;

  IF to_regprocedure('public.is_valid_tool_v2_approval_payload(jsonb,boolean)') IS NULL
     OR to_regprocedure('public.guard_tool_v2_run_approval()') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: apply SQL section 28 first'
      USING ERRCODE = '23514';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_run_approvals'::regclass
      AND trigger_row.tgname IN (
        'trg_guard_tool_v2_run_approval_insert',
        'trg_guard_tool_v2_run_approval_update',
        'trg_guard_tool_v2_run_approval_delete'
      )
      AND trigger_row.tgfoid = 'public.guard_tool_v2_run_approval()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) <> 3 THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: canonical section-28 approval triggers are unavailable'
      USING ERRCODE = '23514';
  END IF;

  IF to_regprocedure('public.guard_authenticated_message_mutation()') IS NULL
     OR to_regprocedure('public.guard_authenticated_chat_thread_mutation()') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: apply SQL section 31 first'
      USING ERRCODE = '23514';
  END IF;

  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: pgcrypto digest(bytea,text) is required in the extensions schema'
      USING ERRCODE = '42883';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.messages'::regclass
      AND attribute.attname = 'thread_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND attribute.attnotnull
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.messages'::regclass
      AND attribute.attname = 'user_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.messages'::regclass
      AND attribute.attname = 'is_bot'
      AND attribute.atttypid = 'boolean'::regtype
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: canonical thread-scoped message columns are unavailable'
      USING ERRCODE = '23514';
  END IF;
END
$openswan_chat_resume_dependency_preflight$;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS source_message_id uuid;

DO $openswan_chat_resume_column_types$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.agent_runs'::regclass
      AND attribute.attname = 'thread_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND NOT attribute.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.agent_runs'::regclass
      AND attribute.attname = 'source_message_id'
      AND attribute.atttypid = 'uuid'::regtype
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_authority: agent-run lineage columns must be uuid'
      USING ERRCODE = '42804';
  END IF;
END
$openswan_chat_resume_column_types$;

-- The lineage pair is optional by contract: OpenSwan Console and legacy
-- main_chat rows have no Circle Chat message source.
ALTER TABLE public.agent_runs
  ALTER COLUMN thread_id DROP NOT NULL,
  ALTER COLUMN source_message_id DROP NOT NULL;

ALTER TABLE public.agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_pair_v1,
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_scope_v1,
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_thread_fkey_v1,
  DROP CONSTRAINT IF EXISTS agent_runs_chat_thread_lineage_message_fkey_v1;

ALTER TABLE public.agent_runs
  ADD CONSTRAINT agent_runs_chat_thread_lineage_pair_v1
    CHECK ((thread_id IS NULL) = (source_message_id IS NULL)),
  ADD CONSTRAINT agent_runs_chat_thread_lineage_scope_v1
    CHECK (
      thread_id IS NULL
      OR ((surface = 'main_chat' AND provider = 'openswan') IS TRUE)
    ),
  ADD CONSTRAINT agent_runs_chat_thread_lineage_thread_fkey_v1
    FOREIGN KEY (thread_id)
    REFERENCES public.circle_chat_threads(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT agent_runs_chat_thread_lineage_message_fkey_v1
    FOREIGN KEY (source_message_id)
    REFERENCES public.messages(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_agent_runs_chat_source_lineage_v1
  ON public.agent_runs (circle_id, thread_id, source_message_id, created_at DESC)
  WHERE thread_id IS NOT NULL AND source_message_id IS NOT NULL;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

-- Historical agent_runs policy variants are circle-wide and permissive. A
-- peer may still read shared run telemetry, but cannot rewrite or delete a
-- protected Chat run owned by somebody else. Restrictive policies compose
-- with the current policy set without changing legacy/Console rows.
DROP POLICY IF EXISTS agent_runs_chat_lineage_update_owner_v1
ON public.agent_runs;
CREATE POLICY agent_runs_chat_lineage_update_owner_v1
ON public.agent_runs
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  thread_id IS NULL
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
)
WITH CHECK (
  thread_id IS NULL
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);

DROP POLICY IF EXISTS agent_runs_chat_lineage_delete_owner_v1
ON public.agent_runs;
CREATE POLICY agent_runs_chat_lineage_delete_owner_v1
ON public.agent_runs
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (
  thread_id IS NULL
  OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
);

COMMENT ON COLUMN public.agent_runs.thread_id IS
  'Exact circle_chat_threads id for a protected main_chat OpenSwan run. This is not legacy chat_session_id.';
COMMENT ON COLUMN public.agent_runs.source_message_id IS
  'Exact non-bot human message that originated a protected main_chat OpenSwan run; immutable with thread_id once set.';

CREATE OR REPLACE FUNCTION public.guard_agent_run_chat_lineage_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_trusted_writer boolean :=
    COALESCE(auth.role(), '') = 'service_role'
    OR current_setting('role', true) IN ('postgres', 'supabase_admin', 'service_role')
    OR (
      COALESCE(current_setting('role', true), 'none') = 'none'
      AND session_user IN ('postgres', 'supabase_admin', 'service_role')
    );
  v_thread public.circle_chat_threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
BEGIN
  IF (NEW.thread_id IS NULL) <> (NEW.source_message_id IS NULL) THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_pair_required'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    (
      OLD.thread_id IS NOT NULL
      AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.surface IS DISTINCT FROM OLD.surface
        OR NEW.provider IS DISTINCT FROM OLD.provider
        OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
        OR NEW.source_message_id IS DISTINCT FROM OLD.source_message_id
      )
    )
    OR (
      OLD.thread_id IS NULL
      AND NEW.thread_id IS NOT NULL
      AND (
        NEW.id IS DISTINCT FROM OLD.id
        OR NEW.circle_id IS DISTINCT FROM OLD.circle_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.surface IS DISTINCT FROM OLD.surface
        OR NEW.provider IS DISTINCT FROM OLD.provider
      )
    )
  ) THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_immutable'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.thread_id IS NOT NULL
     AND NOT v_trusted_writer
     AND (v_uid IS NULL OR OLD.user_id IS DISTINCT FROM v_uid) THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_owner_required'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.thread_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Authenticated application writers must establish lineage with the INSERT.
  -- A trusted maintenance writer may backfill an exact legacy pair, after
  -- which the same immutable rule above applies to every writer.
  IF TG_OP = 'UPDATE'
     AND OLD.thread_id IS NULL
     AND NOT v_trusted_writer THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_must_be_set_on_insert'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.surface IS DISTINCT FROM 'main_chat'
     OR NEW.provider IS DISTINCT FROM 'openswan' THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_scope_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF NOT v_trusted_writer THEN
    IF v_uid IS NULL OR NEW.user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'agent_run_chat_lineage_owner_required'
        USING ERRCODE = '42501';
    END IF;
    PERFORM 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = NEW.circle_id
      AND membership.user_id = v_uid
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent_run_chat_lineage_membership_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT thread.*
  INTO v_thread
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = NEW.thread_id
  FOR SHARE;
  IF NOT FOUND OR v_thread.circle_id IS DISTINCT FROM NEW.circle_id THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_thread_invalid'
      USING ERRCODE = '23514';
  END IF;

  IF v_thread.visibility IS DISTINCT FROM 'circle'
     AND v_thread.created_by IS DISTINCT FROM NEW.user_id THEN
    PERFORM 1
    FROM public.circle_chat_thread_members AS thread_member
    WHERE thread_member.thread_id = NEW.thread_id
      AND thread_member.user_id = NEW.user_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agent_run_chat_lineage_thread_access_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.messages AS message
  WHERE message.id = NEW.source_message_id
  FOR SHARE;
  IF NOT FOUND
     OR v_message.circle_id IS DISTINCT FROM NEW.circle_id
     OR v_message.thread_id IS DISTINCT FROM NEW.thread_id
     OR v_message.user_id IS DISTINCT FROM NEW.user_id
     OR v_message.is_bot IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'agent_run_chat_lineage_source_message_invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_guard_agent_run_chat_lineage_v1
ON public.agent_runs;
CREATE TRIGGER trg_guard_agent_run_chat_lineage_v1
BEFORE INSERT OR UPDATE ON public.agent_runs
FOR EACH ROW
EXECUTE FUNCTION public.guard_agent_run_chat_lineage_v1();

REVOKE ALL ON FUNCTION public.guard_agent_run_chat_lineage_v1()
FROM PUBLIC, anon, authenticated;

-- The historical approval policy is circle-wide. Circle peers may keep the
-- product's existing read visibility, but an explicit Chat approval is
-- mutation authority owned by its requester. Protect both the unconsumed and
-- consumed schema-v2 shapes so a peer cannot resolve first or mutate later.
-- Auto approvals and non-Chat/legacy runs deliberately keep their established
-- behavior. SECURITY DEFINER makes the source-run classification independent
-- of permissive agent_runs RLS drift, while current membership prevents this
-- boolean helper from becoming a cross-circle run-id oracle.
CREATE OR REPLACE FUNCTION public.is_protected_openswan_chat_ask_approval_v1(
  p_run_id uuid,
  p_circle_id uuid,
  p_payload jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE((
    auth.uid() IS NOT NULL
    AND p_run_id IS NOT NULL
    AND p_circle_id IS NOT NULL
    AND jsonb_typeof(p_payload) = 'object'
    AND p_payload->>'approvalSchemaVersion' = '2'
    AND p_payload->>'approvalMode' = 'ask'
    AND (
      public.is_valid_tool_v2_approval_payload(p_payload, false)
      OR public.is_valid_tool_v2_approval_payload(p_payload, true)
    )
    AND EXISTS (
      SELECT 1
      FROM public.agent_runs AS source_run
      JOIN public.circle_members AS membership
        ON membership.circle_id = source_run.circle_id
       AND membership.user_id = auth.uid()
      WHERE source_run.id = p_run_id
        AND source_run.circle_id = p_circle_id
        AND source_run.surface = 'main_chat'
        AND source_run.provider = 'openswan'
        AND source_run.thread_id IS NOT NULL
        AND source_run.source_message_id IS NOT NULL
    )
  ), false);
$function$;

REVOKE ALL ON FUNCTION public.is_protected_openswan_chat_ask_approval_v1(
  uuid, uuid, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_protected_openswan_chat_ask_approval_v1(
  uuid, uuid, jsonb
) TO authenticated;

ALTER TABLE public.agent_run_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_run_approvals_chat_ask_requester_update_v1
ON public.agent_run_approvals;
CREATE POLICY agent_run_approvals_chat_ask_requester_update_v1
ON public.agent_run_approvals
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (
  NOT public.is_protected_openswan_chat_ask_approval_v1(
    run_id,
    circle_id,
    payload
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
)
WITH CHECK (
  NOT public.is_protected_openswan_chat_ask_approval_v1(
    run_id,
    circle_id,
    payload
  )
  OR (
    auth.uid() IS NOT NULL
    AND requested_by = auth.uid()::text
  )
);

-- Read-only custody preflight. This exposes no approval payload and grants no
-- dispatch authority: it only tells the authenticated owner whether the exact
-- consume predicates are true in this statement snapshot. Callers must treat
-- false, an RPC/schema-cache miss, and every error as a hard no-claim result.
-- A subsequent race is harmless because the consuming RPC repeats the checks
-- under row locks before it writes the one-shot dispatch receipt.
DROP FUNCTION IF EXISTS public.can_consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
);

CREATE FUNCTION public.can_consume_openswan_chat_approval_resume_v1(
  p_approval_id uuid,
  p_source_run_id uuid,
  p_current_run_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_source_message_id uuid,
  p_tool_name text,
  p_tool_approval_digest text,
  p_tool_use_id text,
  p_iteration integer,
  p_dispatch_binding_digest text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_source_run public.agent_runs%ROWTYPE;
  v_current_run public.agent_runs%ROWTYPE;
  v_thread public.circle_chat_threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_approval public.agent_run_approvals%ROWTYPE;
  v_terminal jsonb;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_authority_json text;
  v_expected_binding_digest text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_auth_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_approval_id IS NULL
     OR p_source_run_id IS NULL
     OR p_current_run_id IS NULL
     OR p_source_run_id = p_current_run_id
     OR p_circle_id IS NULL
     OR p_thread_id IS NULL
     OR p_source_message_id IS NULL
     OR p_tool_name IS NULL
     OR p_tool_name !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_approval_digest IS NULL
     OR p_tool_approval_digest !~ '^approval-v2:sha256:[0-9a-f]{64}$'
     OR p_tool_use_id IS NULL
     OR p_tool_use_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_use_id IS DISTINCT FROM 'approval-resume:' || p_approval_id::text
     OR p_iteration IS NULL
     OR p_iteration < 1
     OR p_iteration > 8
     OR p_dispatch_binding_digest IS NULL
     OR p_dispatch_binding_digest !~ '^authority-v2:sha256:[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_uid;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT run_row.*
  INTO v_source_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_source_run_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT run_row.*
  INTO v_current_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_current_run_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_terminal := v_source_run.metadata->'terminal';
  IF v_source_run.user_id IS DISTINCT FROM v_uid
     OR v_source_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_source_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_source_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_source_run.provider IS DISTINCT FROM 'openswan'
     OR v_source_run.surface IS DISTINCT FROM 'main_chat'
     OR v_source_run.status IS DISTINCT FROM 'failed'
     OR jsonb_typeof(v_terminal) IS DISTINCT FROM 'object'
     OR v_terminal->>'state' IS DISTINCT FROM 'partial'
     OR v_terminal->>'reason' IS DISTINCT FROM 'action_coverage_incomplete'
     OR v_terminal->'completionVerified' IS DISTINCT FROM 'false'::jsonb THEN
    RETURN false;
  END IF;

  IF v_current_run.user_id IS DISTINCT FROM v_uid
     OR v_current_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_current_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_current_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_current_run.provider IS DISTINCT FROM 'openswan'
     OR v_current_run.surface IS DISTINCT FROM 'main_chat'
     OR v_current_run.status NOT IN ('queued', 'planning', 'running')
     OR COALESCE(v_current_run.metadata ? 'terminal', false) THEN
    RETURN false;
  END IF;

  SELECT thread.*
  INTO v_thread
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = p_thread_id;
  IF NOT FOUND
     OR v_thread.circle_id IS DISTINCT FROM p_circle_id
     OR COALESCE(v_thread.archived, false) THEN
    RETURN false;
  END IF;

  IF v_thread.visibility IS DISTINCT FROM 'circle'
     AND v_thread.created_by IS DISTINCT FROM v_uid THEN
    PERFORM 1
    FROM public.circle_chat_thread_members AS thread_member
    WHERE thread_member.thread_id = p_thread_id
      AND thread_member.user_id = v_uid;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.messages AS message
  WHERE message.id = p_source_message_id;
  IF NOT FOUND
     OR v_message.circle_id IS DISTINCT FROM p_circle_id
     OR v_message.thread_id IS DISTINCT FROM p_thread_id
     OR v_message.user_id IS DISTINCT FROM v_uid
     OR v_message.is_bot IS DISTINCT FROM false THEN
    RETURN false;
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.agent_run_approvals AS approval_row
  WHERE approval_row.id = p_approval_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_now := statement_timestamp();
  IF v_approval.timeout_seconds IS NULL
     OR v_approval.timeout_seconds < 1
     OR v_approval.timeout_seconds > 86400
     OR v_approval.requested_at IS NULL
     OR v_approval.resolved_at IS NULL THEN
    RETURN false;
  END IF;
  v_expires_at := v_approval.requested_at
    + make_interval(secs => v_approval.timeout_seconds);

  IF v_approval.run_id IS DISTINCT FROM p_source_run_id
     OR v_approval.circle_id IS DISTINCT FROM p_circle_id
     OR v_approval.requested_by IS DISTINCT FROM v_uid::text
     OR v_approval.resolved_by IS DISTINCT FROM v_uid
     OR v_approval.status IS DISTINCT FROM 'approved'
     OR v_approval.metadata IS DISTINCT FROM '{}'::jsonb
     OR v_approval.requested_at > v_approval.resolved_at
     OR v_approval.resolved_at > v_now
     OR v_approval.resolved_at >= v_expires_at
     OR v_now >= v_expires_at
     OR NOT public.is_valid_tool_v2_approval_payload(v_approval.payload, false)
     OR v_approval.payload->>'approvalMode' IS DISTINCT FROM 'ask'
     OR v_approval.payload->>'toolName' IS DISTINCT FROM p_tool_name
     OR v_approval.payload->>'toolName' = 'desktop.open_attachment'
     OR v_approval.payload->>'toolApprovalDigest' IS DISTINCT FROM p_tool_approval_digest
     OR v_approval.payload ? 'dispatchReceiptSchemaVersion'
     OR v_approval.payload ? 'dispatchBindingDigest'
     OR v_approval.payload ? 'dispatchConsumedAt' THEN
    RETURN false;
  END IF;

  v_authority_json :=
      '{"approvalDigest":' || to_json(p_tool_approval_digest)::text
    || ',"approvalId":' || to_json(p_approval_id::text)::text
    || ',"approvalRunId":' || to_json(p_source_run_id::text)::text
    || ',"circleId":' || to_json(p_circle_id::text)::text
    || ',"iteration":' || p_iteration::text
    || ',"runId":' || to_json(p_current_run_id::text)::text
    || ',"schemaVersion":2'
    || ',"source":"cross_run"'
    || ',"status":"approved"'
    || ',"toolName":' || to_json(p_tool_name)::text
    || ',"toolUseId":' || to_json(p_tool_use_id)::text
    || ',"userId":' || to_json(v_uid::text)::text
    || '}';
  v_expected_binding_digest := 'authority-v2:sha256:' || encode(
    extensions.digest(convert_to(v_authority_json, 'UTF8'), 'sha256'),
    'hex'
  );

  RETURN p_dispatch_binding_digest = v_expected_binding_digest;
END
$function$;

REVOKE ALL ON FUNCTION public.can_consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) TO authenticated;

DROP FUNCTION IF EXISTS public.consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
);

CREATE FUNCTION public.consume_openswan_chat_approval_resume_v1(
  p_approval_id uuid,
  p_source_run_id uuid,
  p_current_run_id uuid,
  p_circle_id uuid,
  p_thread_id uuid,
  p_source_message_id uuid,
  p_tool_name text,
  p_tool_approval_digest text,
  p_tool_use_id text,
  p_iteration integer,
  p_dispatch_binding_digest text
)
RETURNS TABLE (
  approval_id uuid,
  approval_run_id uuid,
  dispatch_run_id uuid,
  circle_id uuid,
  thread_id uuid,
  source_message_id uuid,
  tool_name text,
  tool_approval_digest text,
  receipt_source text,
  approval_status text,
  dispatch_binding_digest text,
  dispatch_consumed_at text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_locked_run_count integer := 0;
  v_source_run public.agent_runs%ROWTYPE;
  v_current_run public.agent_runs%ROWTYPE;
  v_thread public.circle_chat_threads%ROWTYPE;
  v_message public.messages%ROWTYPE;
  v_approval public.agent_run_approvals%ROWTYPE;
  v_terminal jsonb;
  v_now timestamptz;
  v_expires_at timestamptz;
  v_consumed_at_text text;
  v_authority_json text;
  v_expected_binding_digest text;
  v_consumed_payload jsonb;
  v_written_payload jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_auth_required'
      USING ERRCODE = '42501';
  END IF;
  IF p_approval_id IS NULL
     OR p_source_run_id IS NULL
     OR p_current_run_id IS NULL
     OR p_source_run_id = p_current_run_id
     OR p_circle_id IS NULL
     OR p_thread_id IS NULL
     OR p_source_message_id IS NULL
     OR p_tool_name IS NULL
     OR p_tool_name !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_approval_digest IS NULL
     OR p_tool_approval_digest !~ '^approval-v2:sha256:[0-9a-f]{64}$'
     OR p_tool_use_id IS NULL
     OR p_tool_use_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$'
     OR p_tool_use_id IS DISTINCT FROM 'approval-resume:' || p_approval_id::text
     OR p_iteration IS NULL
     OR p_iteration < 1
     OR p_iteration > 8
     OR p_dispatch_binding_digest IS NULL
     OR p_dispatch_binding_digest !~ '^authority-v2:sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_identity_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Keep membership live for the whole transaction. A concurrent revocation
  -- must finish before or after this consume, never between its checks.
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_uid
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_membership_required'
      USING ERRCODE = '42501';
  END IF;

  -- Deterministic id order prevents two inverse source/current requests from
  -- deadlocking. Both rows stay locked through approval consumption.
  PERFORM run_row.id
  FROM public.agent_runs AS run_row
  WHERE run_row.id IN (p_source_run_id, p_current_run_id)
  ORDER BY run_row.id
  FOR UPDATE;
  GET DIAGNOSTICS v_locked_run_count = ROW_COUNT;
  IF v_locked_run_count <> 2 THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_run_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT run_row.*
  INTO STRICT v_source_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_source_run_id;

  SELECT run_row.*
  INTO STRICT v_current_run
  FROM public.agent_runs AS run_row
  WHERE run_row.id = p_current_run_id;

  v_terminal := v_source_run.metadata->'terminal';
  IF v_source_run.user_id IS DISTINCT FROM v_uid
     OR v_source_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_source_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_source_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_source_run.provider IS DISTINCT FROM 'openswan'
     OR v_source_run.surface IS DISTINCT FROM 'main_chat'
     OR v_source_run.status IS DISTINCT FROM 'failed'
     OR jsonb_typeof(v_terminal) IS DISTINCT FROM 'object'
     OR v_terminal->>'state' IS DISTINCT FROM 'partial'
     OR v_terminal->>'reason' IS DISTINCT FROM 'action_coverage_incomplete'
     OR v_terminal->'completionVerified' IS DISTINCT FROM 'false'::jsonb THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_source_run_not_eligible'
      USING ERRCODE = '55000';
  END IF;

  IF v_current_run.user_id IS DISTINCT FROM v_uid
     OR v_current_run.circle_id IS DISTINCT FROM p_circle_id
     OR v_current_run.thread_id IS DISTINCT FROM p_thread_id
     OR v_current_run.source_message_id IS DISTINCT FROM p_source_message_id
     OR v_current_run.provider IS DISTINCT FROM 'openswan'
     OR v_current_run.surface IS DISTINCT FROM 'main_chat'
     OR v_current_run.status NOT IN ('queued', 'planning', 'running')
     OR COALESCE(v_current_run.metadata ? 'terminal', false) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_current_run_not_eligible'
      USING ERRCODE = '55000';
  END IF;

  SELECT thread.*
  INTO v_thread
  FROM public.circle_chat_threads AS thread
  WHERE thread.id = p_thread_id
  FOR SHARE;
  IF NOT FOUND
     OR v_thread.circle_id IS DISTINCT FROM p_circle_id
     OR COALESCE(v_thread.archived, false) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_thread_not_live'
      USING ERRCODE = '42501';
  END IF;

  IF v_thread.visibility IS DISTINCT FROM 'circle'
     AND v_thread.created_by IS DISTINCT FROM v_uid THEN
    PERFORM 1
    FROM public.circle_chat_thread_members AS thread_member
    WHERE thread_member.thread_id = p_thread_id
      AND thread_member.user_id = v_uid
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'openswan_chat_approval_resume_thread_access_required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT message.*
  INTO v_message
  FROM public.messages AS message
  WHERE message.id = p_source_message_id
  FOR SHARE;
  IF NOT FOUND
     OR v_message.circle_id IS DISTINCT FROM p_circle_id
     OR v_message.thread_id IS DISTINCT FROM p_thread_id
     OR v_message.user_id IS DISTINCT FROM v_uid
     OR v_message.is_bot IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_source_message_invalid'
      USING ERRCODE = '42501';
  END IF;

  SELECT approval_row.*
  INTO v_approval
  FROM public.agent_run_approvals AS approval_row
  WHERE approval_row.id = p_approval_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_now := clock_timestamp();
  IF v_approval.timeout_seconds IS NULL
     OR v_approval.timeout_seconds < 1
     OR v_approval.timeout_seconds > 86400
     OR v_approval.requested_at IS NULL
     OR v_approval.resolved_at IS NULL THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_live'
      USING ERRCODE = '55000';
  END IF;
  v_expires_at := v_approval.requested_at
    + make_interval(secs => v_approval.timeout_seconds);

  IF v_approval.run_id IS DISTINCT FROM p_source_run_id
     OR v_approval.circle_id IS DISTINCT FROM p_circle_id
     OR v_approval.requested_by IS DISTINCT FROM v_uid::text
     OR v_approval.resolved_by IS DISTINCT FROM v_uid
     OR v_approval.status IS DISTINCT FROM 'approved'
     OR v_approval.metadata IS DISTINCT FROM '{}'::jsonb
     OR v_approval.requested_at > v_approval.resolved_at
     OR v_approval.resolved_at > v_now
     OR v_approval.resolved_at >= v_expires_at
     OR v_now >= v_expires_at
     OR NOT public.is_valid_tool_v2_approval_payload(v_approval.payload, false)
     OR v_approval.payload->>'approvalMode' IS DISTINCT FROM 'ask'
     OR v_approval.payload->>'toolName' IS DISTINCT FROM p_tool_name
     OR v_approval.payload->>'toolName' = 'desktop.open_attachment'
     OR v_approval.payload->>'toolApprovalDigest' IS DISTINCT FROM p_tool_approval_digest
     OR v_approval.payload ? 'dispatchReceiptSchemaVersion'
     OR v_approval.payload ? 'dispatchBindingDigest'
     OR v_approval.payload ? 'dispatchConsumedAt' THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_live'
      USING ERRCODE = '55000';
  END IF;

  -- Match `stableApprovalJson` exactly. Its flat authority object is sorted by
  -- key and JSON.stringify emits no whitespace. The database recomputes this
  -- digest instead of trusting an arbitrary client-provided receipt binding.
  v_authority_json :=
      '{"approvalDigest":' || to_json(p_tool_approval_digest)::text
    || ',"approvalId":' || to_json(p_approval_id::text)::text
    || ',"approvalRunId":' || to_json(p_source_run_id::text)::text
    || ',"circleId":' || to_json(p_circle_id::text)::text
    || ',"iteration":' || p_iteration::text
    || ',"runId":' || to_json(p_current_run_id::text)::text
    || ',"schemaVersion":2'
    || ',"source":"cross_run"'
    || ',"status":"approved"'
    || ',"toolName":' || to_json(p_tool_name)::text
    || ',"toolUseId":' || to_json(p_tool_use_id)::text
    || ',"userId":' || to_json(v_uid::text)::text
    || '}';
  v_expected_binding_digest := 'authority-v2:sha256:' || encode(
    extensions.digest(convert_to(v_authority_json, 'UTF8'), 'sha256'),
    'hex'
  );
  IF p_dispatch_binding_digest IS DISTINCT FROM v_expected_binding_digest THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_dispatch_binding_invalid'
      USING ERRCODE = '22023';
  END IF;

  -- Re-sample database time immediately before the write. The approval may
  -- have been barely live when its locked row was first read.
  v_now := clock_timestamp();
  IF v_now >= v_expires_at THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_approval_not_live'
      USING ERRCODE = '55000';
  END IF;

  v_consumed_at_text := to_char(
    v_now AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );
  v_consumed_payload := v_approval.payload || jsonb_build_object(
    'dispatchReceiptSchemaVersion', 2,
    'dispatchBindingDigest', v_expected_binding_digest,
    'dispatchConsumedAt', v_consumed_at_text
  );
  IF NOT public.is_valid_tool_v2_approval_payload(v_consumed_payload, true) THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_consumed_payload_invalid'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_run_approvals AS approval_row
  SET payload = v_consumed_payload
  WHERE approval_row.id = p_approval_id
    AND approval_row.run_id = p_source_run_id
    AND approval_row.circle_id = p_circle_id
    AND approval_row.requested_by = v_uid::text
    AND approval_row.resolved_by = v_uid
    AND approval_row.status = 'approved'
    AND approval_row.payload IS NOT DISTINCT FROM v_approval.payload
    AND clock_timestamp() < v_expires_at
  RETURNING approval_row.payload INTO v_written_payload;
  IF NOT FOUND
     OR v_written_payload->>'dispatchBindingDigest'
       IS DISTINCT FROM v_expected_binding_digest THEN
    RAISE EXCEPTION 'openswan_chat_approval_resume_consume_conflict'
      USING ERRCODE = '40001';
  END IF;

  RETURN QUERY SELECT
    p_approval_id,
    p_source_run_id,
    p_current_run_id,
    p_circle_id,
    p_thread_id,
    p_source_message_id,
    p_tool_name,
    p_tool_approval_digest,
    'cross_run'::text,
    'approved'::text,
    v_expected_binding_digest,
    v_consumed_at_text;
END
$function$;

REVOKE ALL ON FUNCTION public.consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_openswan_chat_approval_resume_v1(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, integer, text
) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Catalog readiness only. Follow with authenticated cross-user/thread/replay
-- and locked status-race behavior before relying on this authority boundary.
SELECT
  (
    SELECT count(*) = 2
      AND bool_and(attribute.atttypid = 'uuid'::regtype)
      AND bool_and(NOT attribute.attnotnull)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.agent_runs'::regclass
      AND attribute.attname IN ('thread_id', 'source_message_id')
      AND NOT attribute.attisdropped
  ) AS openswan_chat_run_lineage_columns_ready,
  (
    SELECT count(*) = 4
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.agent_runs'::regclass
      AND constraint_row.conname IN (
        'agent_runs_chat_thread_lineage_pair_v1',
        'agent_runs_chat_thread_lineage_scope_v1',
        'agent_runs_chat_thread_lineage_thread_fkey_v1',
        'agent_runs_chat_thread_lineage_message_fkey_v1'
      )
      AND constraint_row.convalidated
  ) AS openswan_chat_run_lineage_constraints_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.agent_runs'::regclass
      AND constraint_row.conname = 'agent_runs_chat_thread_lineage_thread_fkey_v1'
      AND constraint_row.confrelid = 'public.circle_chat_threads'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND constraint_row.convalidated
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.agent_runs'::regclass
      AND constraint_row.conname = 'agent_runs_chat_thread_lineage_message_fkey_v1'
      AND constraint_row.confrelid = 'public.messages'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
      AND constraint_row.convalidated
  ) AS openswan_chat_run_lineage_exact_fks_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.agent_runs'::regclass
      AND trigger_row.tgname = 'trg_guard_agent_run_chat_lineage_v1'
      AND trigger_row.tgfoid = 'public.guard_agent_run_chat_lineage_v1()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) AS openswan_chat_run_lineage_trigger_ready,
  (
    SELECT count(*) = 2
      AND bool_and(permissive = 'RESTRICTIVE')
      AND bool_and(cmd IN ('UPDATE', 'DELETE'))
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_runs'
      AND policyname IN (
        'agent_runs_chat_lineage_update_owner_v1',
        'agent_runs_chat_lineage_delete_owner_v1'
      )
  ) AS openswan_chat_run_lineage_owner_policies_ready,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_run_approvals'
      AND policyname = 'agent_run_approvals_chat_ask_requester_update_v1'
      AND permissive = 'RESTRICTIVE'
      AND cmd = 'UPDATE'
  )
  AND to_regprocedure(
    'public.is_protected_openswan_chat_ask_approval_v1(uuid,uuid,jsonb)'
  ) IS NOT NULL AS openswan_chat_approval_requester_policy_ready,
  to_regprocedure(
    'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)'
  ) IS NOT NULL
  AND has_function_privilege(
    'authenticated',
    'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.can_consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  ) AS openswan_chat_approval_resume_preflight_rpc_ready,
  to_regprocedure(
    'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)'
  ) IS NOT NULL
  AND has_function_privilege(
    'authenticated',
    'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.consume_openswan_chat_approval_resume_v1(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,integer,text)',
    'EXECUTE'
  ) AS openswan_chat_approval_resume_rpc_ready;
-- END SECTION 44: OpenSwan Chat approval-resume authority
-- BEGIN SECTION 45: Owner-private Office user preferences
-- Source: supabase/migrations/20260813220000_office_user_preferences.sql
-- Owner-private, circle-scoped Office preferences with atomic patch authority.
--
-- `profiles.office_preferences` is a flat profile blob and profile rows are
-- readable by fellow circle members. It therefore cannot own private Office
-- state or credentials. This migration introduces an exact owner+circle row,
-- limits it to reviewed non-secret fields, and makes one server-side patch RPC
-- the only authenticated mutation surface.

BEGIN;

CREATE OR REPLACE FUNCTION public.office_preferences_contains_secret_key_v1(
  p_value jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  object_entry record;
  array_entry jsonb;
  normalized_key text;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      FOR object_entry IN SELECT key, value FROM jsonb_each(p_value)
      LOOP
        normalized_key := regexp_replace(lower(object_entry.key), '[^a-z0-9]', '', 'g');
        IF lower(object_entry.key) IN ('__proto__', 'prototype', 'constructor')
           OR normalized_key ~ '(password|passwd|secret|token|apikey|accesskey|privatekey|credential|authorization|bearer|cookie|sessionkey|webhook)' THEN
          RETURN true;
        END IF;
        IF public.office_preferences_contains_secret_key_v1(object_entry.value) THEN
          RETURN true;
        END IF;
      END LOOP;
    WHEN 'array' THEN
      FOR array_entry IN SELECT value FROM jsonb_array_elements(p_value)
      LOOP
        IF public.office_preferences_contains_secret_key_v1(array_entry) THEN
          RETURN true;
        END IF;
      END LOOP;
    ELSE
      NULL;
  END CASE;
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.office_preferences_contains_secret_key_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_office_user_preferences_v1(
  p_preferences jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  preference_entry record;
  nested_entry record;
  behavior_entry record;
  state_key text;
  numeric_value numeric;
  entry_count integer;
  text_value text;
BEGIN
  IF jsonb_typeof(p_preferences) <> 'object'
     OR octet_length(p_preferences::text) > 131072
     OR public.office_preferences_contains_secret_key_v1(p_preferences) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_preferences) AS preference_key
    WHERE preference_key NOT IN (
      'agentNames',
      'appearances',
      'whiteboardNotes',
      'budgetConfig',
      'idleConfig',
      'agentFilterMode',
      'telegramMetadata'
    )
  ) THEN
    RETURN false;
  END IF;

  FOR preference_entry IN SELECT key, value FROM jsonb_each(p_preferences)
  LOOP
    CASE preference_entry.key
      WHEN 'agentNames' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count > 128 THEN RETURN false; END IF;
        FOR nested_entry IN SELECT key, value FROM jsonb_each(preference_entry.value)
        LOOP
          IF length(nested_entry.key) NOT BETWEEN 1 AND 240
             OR octet_length(nested_entry.key) > 960
             OR jsonb_typeof(nested_entry.value) <> 'string' THEN
            RETURN false;
          END IF;
          text_value := nested_entry.value #>> '{}';
          IF length(btrim(text_value)) NOT BETWEEN 1 AND 80
             OR octet_length(text_value) > 320 THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'appearances' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count > 128 THEN RETURN false; END IF;
        FOR nested_entry IN SELECT key, value FROM jsonb_each(preference_entry.value)
        LOOP
          IF length(nested_entry.key) NOT BETWEEN 1 AND 240
             OR octet_length(nested_entry.key) > 960
             OR jsonb_typeof(nested_entry.value) <> 'object' THEN
            RETURN false;
          END IF;
          SELECT count(*) INTO entry_count FROM jsonb_object_keys(nested_entry.value);
          IF entry_count <> 15
             OR EXISTS (
               SELECT 1 FROM jsonb_object_keys(nested_entry.value) AS appearance_key
               WHERE appearance_key NOT IN (
                 'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor',
                 'shoeColor', 'accessory', 'hat', 'expression', 'backItem',
                 'eyeColor', 'facialHair', 'pet', 'aura', 'handItem'
               )
             ) THEN
            RETURN false;
          END IF;
          FOREACH state_key IN ARRAY ARRAY[
            'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor',
            'shoeColor', 'accessory', 'hat', 'expression', 'backItem',
            'eyeColor', 'facialHair', 'pet', 'aura', 'handItem'
          ]
          LOOP
            IF jsonb_typeof(nested_entry.value -> state_key) <> 'string' THEN
              RETURN false;
            END IF;
          END LOOP;
          FOREACH state_key IN ARRAY ARRAY[
            'skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoeColor', 'eyeColor'
          ]
          LOOP
            IF (nested_entry.value ->> state_key) !~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$' THEN
              RETURN false;
            END IF;
          END LOOP;
          IF (nested_entry.value ->> 'hairStyle') NOT IN (
               'flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly',
               'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails'
             )
             OR (nested_entry.value ->> 'accessory') NOT IN (
               'none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie',
               'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing',
               'visor_shades', 'gas_mask'
             )
             OR (nested_entry.value ->> 'hat') NOT IN (
               'none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns',
               'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet',
               'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'
             )
             OR (nested_entry.value ->> 'expression') NOT IN (
               'neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry',
               'surprised', 'smirk', 'crying'
             )
             OR (nested_entry.value ->> 'backItem') NOT IN (
               'none', 'cape', 'backpack', 'wings', 'jetpack', 'shield',
               'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket',
               'scroll', 'boombox'
             )
             OR (nested_entry.value ->> 'facialHair') NOT IN (
               'none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu',
               'sideburns', 'soul_patch'
             )
             OR (nested_entry.value ->> 'pet') NOT IN (
               'none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab',
               'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones', 'swan'
             )
             OR (nested_entry.value ->> 'aura') NOT IN (
               'none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow',
               'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'
             )
             OR (nested_entry.value ->> 'handItem') NOT IN (
               'none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand',
               'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'
             ) THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'whiteboardNotes' THEN
        IF jsonb_typeof(preference_entry.value) <> 'array'
           OR jsonb_array_length(preference_entry.value) > 8 THEN
          RETURN false;
        END IF;
        FOR nested_entry IN SELECT value FROM jsonb_array_elements(preference_entry.value)
        LOOP
          IF jsonb_typeof(nested_entry.value) <> 'string' THEN RETURN false; END IF;
          text_value := nested_entry.value #>> '{}';
          IF length(btrim(text_value)) NOT BETWEEN 1 AND 80
             OR octet_length(text_value) > 320 THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'budgetConfig' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object'
           OR jsonb_typeof(preference_entry.value -> 'enabled') <> 'boolean' THEN
          RETURN false;
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS budget_key
          WHERE budget_key NOT IN ('enabled', 'daily', 'weekly', 'monthly', 'hardLimit')
        ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'hardLimit'
           AND jsonb_typeof(preference_entry.value -> 'hardLimit') <> 'boolean' THEN
          RETURN false;
        END IF;
        FOREACH state_key IN ARRAY ARRAY['daily', 'weekly', 'monthly']
        LOOP
          IF preference_entry.value ? state_key THEN
            IF jsonb_typeof(preference_entry.value -> state_key) <> 'number' THEN
              RETURN false;
            END IF;
            numeric_value := (preference_entry.value ->> state_key)::numeric;
            IF numeric_value <= 0 OR numeric_value > 1000000 THEN RETURN false; END IF;
          END IF;
        END LOOP;

      WHEN 'idleConfig' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object'
           OR jsonb_typeof(preference_entry.value -> 'masterEnabled') <> 'boolean'
           OR jsonb_typeof(preference_entry.value -> 'behaviors') <> 'object' THEN
          RETURN false;
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS idle_key
          WHERE idle_key NOT IN ('masterEnabled', 'behaviors', 'sharedChatOptIn')
        ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'sharedChatOptIn'
           AND jsonb_typeof(preference_entry.value -> 'sharedChatOptIn') <> 'boolean' THEN
          RETURN false;
        END IF;
        SELECT count(*) INTO entry_count
        FROM jsonb_object_keys(preference_entry.value -> 'behaviors');
        IF entry_count > 64 THEN RETURN false; END IF;
        FOR behavior_entry IN
          SELECT key, value FROM jsonb_each(preference_entry.value -> 'behaviors')
        LOOP
          IF length(behavior_entry.key) NOT BETWEEN 1 AND 80
             OR octet_length(behavior_entry.key) > 320
             OR jsonb_typeof(behavior_entry.value) <> 'object'
             OR jsonb_typeof(behavior_entry.value -> 'enabled') <> 'boolean'
             OR jsonb_typeof(behavior_entry.value -> 'cooldownMinutes') <> 'number'
             OR NOT (behavior_entry.value ? 'lastRanAt') THEN
            RETURN false;
          END IF;
          IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(behavior_entry.value) AS behavior_key
            WHERE behavior_key NOT IN ('enabled', 'cooldownMinutes', 'lastRanAt')
          ) THEN
            RETURN false;
          END IF;
          numeric_value := (behavior_entry.value ->> 'cooldownMinutes')::numeric;
          IF numeric_value <> trunc(numeric_value)
             OR numeric_value < 1
             OR numeric_value > 10080 THEN
            RETURN false;
          END IF;
          IF jsonb_typeof(behavior_entry.value -> 'lastRanAt') = 'string' THEN
            text_value := behavior_entry.value ->> 'lastRanAt';
            IF length(text_value) > 40
               OR text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
              RETURN false;
            END IF;
          ELSIF jsonb_typeof(behavior_entry.value -> 'lastRanAt') <> 'null' THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'agentFilterMode' THEN
        IF jsonb_typeof(preference_entry.value) <> 'string'
           OR (preference_entry.value #>> '{}') NOT IN ('all', 'mine', 'active', 'bonded') THEN
          RETURN false;
        END IF;

      WHEN 'telegramMetadata' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count NOT BETWEEN 1 AND 2
           OR EXISTS (
             SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS telegram_key
             WHERE telegram_key NOT IN ('chatId', 'botName')
           ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'chatId' THEN
          IF jsonb_typeof(preference_entry.value -> 'chatId') <> 'string'
             OR (preference_entry.value ->> 'chatId') !~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,64})$' THEN
            RETURN false;
          END IF;
        END IF;
        IF preference_entry.value ? 'botName' THEN
          IF jsonb_typeof(preference_entry.value -> 'botName') <> 'string'
             OR (preference_entry.value ->> 'botName') !~ '^[A-Za-z0-9_]{1,64}$' THEN
            RETURN false;
          END IF;
        END IF;

      ELSE
        RETURN false;
    END CASE;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_office_user_preferences_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.office_user_preferences (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, circle_id)
);

ALTER TABLE public.office_user_preferences
  DROP CONSTRAINT IF EXISTS office_user_preferences_document_valid;
ALTER TABLE public.office_user_preferences
  ADD CONSTRAINT office_user_preferences_document_valid
  CHECK (public.validate_office_user_preferences_v1(preferences));

ALTER TABLE public.office_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.office_user_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS office_user_preferences_select_own ON public.office_user_preferences;
CREATE POLICY office_user_preferences_select_own
ON public.office_user_preferences
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.circle_members AS membership
    WHERE membership.circle_id = office_user_preferences.circle_id
      AND membership.user_id = auth.uid()
  )
);

REVOKE ALL ON TABLE public.office_user_preferences FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.office_user_preferences TO authenticated;

CREATE OR REPLACE FUNCTION public.read_my_office_preferences_v1(
  p_circle_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  stored_preferences jsonb;
  stored_revision bigint;
  stored_updated_at timestamptz;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;

  SELECT preferences, revision, updated_at
  INTO stored_preferences, stored_revision, stored_updated_at
  FROM public.office_user_preferences
  WHERE user_id = actor_id
    AND circle_id = p_circle_id;

  RETURN jsonb_build_object(
    'preferences', coalesce(stored_preferences, '{}'::jsonb),
    'revision', coalesce(stored_revision, 0),
    'updatedAt', to_jsonb(stored_updated_at)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.patch_my_office_preferences_v1(
  p_circle_id uuid,
  p_patch jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_id uuid := auth.uid();
  patch_entry record;
  next_preferences jsonb;
  accepted_revision bigint;
  accepted_updated_at timestamptz;
  patch_key_count integer;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'office_circle_membership_required' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL
     OR jsonb_typeof(p_patch) <> 'object'
     OR octet_length(p_patch::text) > 131072 THEN
    RAISE EXCEPTION 'invalid_office_preferences_patch' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO patch_key_count FROM jsonb_object_keys(p_patch);
  IF patch_key_count NOT BETWEEN 1 AND 7
     OR EXISTS (
       SELECT 1
       FROM jsonb_object_keys(p_patch) AS patch_key
       WHERE patch_key NOT IN (
         'agentNames',
         'appearances',
         'whiteboardNotes',
         'budgetConfig',
         'idleConfig',
         'agentFilterMode',
         'telegramMetadata'
       )
     )
     OR public.office_preferences_contains_secret_key_v1(p_patch) THEN
    RAISE EXCEPTION 'invalid_office_preferences_patch' USING ERRCODE = '22023';
  END IF;

  -- Establish and lock the exact owner+circle row. A concurrent first writer
  -- waits on the same unique key, then reads the winner before applying its own
  -- disjoint top-level patch; no client read/merge race is possible.
  INSERT INTO public.office_user_preferences(user_id, circle_id)
  VALUES (actor_id, p_circle_id)
  ON CONFLICT (user_id, circle_id) DO NOTHING;

  SELECT preferences
  INTO next_preferences
  FROM public.office_user_preferences
  WHERE user_id = actor_id
    AND circle_id = p_circle_id
  FOR UPDATE;

  IF next_preferences IS NULL THEN
    RAISE EXCEPTION 'office_preferences_row_unavailable' USING ERRCODE = '55000';
  END IF;

  FOR patch_entry IN SELECT key, value FROM jsonb_each(p_patch)
  LOOP
    next_preferences := next_preferences - patch_entry.key;
    IF patch_entry.value <> 'null'::jsonb THEN
      next_preferences := next_preferences || jsonb_build_object(patch_entry.key, patch_entry.value);
    END IF;
  END LOOP;

  IF NOT public.validate_office_user_preferences_v1(next_preferences)
     OR octet_length(next_preferences::text) > 131072 THEN
    RAISE EXCEPTION 'invalid_office_preferences_document' USING ERRCODE = '22023';
  END IF;

  UPDATE public.office_user_preferences
  SET preferences = next_preferences,
      revision = revision + 1,
      updated_at = clock_timestamp()
  WHERE user_id = actor_id
    AND circle_id = p_circle_id
  RETURNING revision, updated_at INTO accepted_revision, accepted_updated_at;

  -- Value-free receipt: it proves the server-accepted revision and timestamp
  -- without reflecting any preference or credential-adjacent caller input.
  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'accepted', true,
    'revision', accepted_revision,
    'updatedAt', accepted_updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.read_my_office_preferences_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_my_office_preferences_v1(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_my_office_preferences_v1(uuid, jsonb)
  TO authenticated;

-- Remove the known legacy Telegram credential object from the circle-readable
-- profile blob. The UPDATE transforms rows in place and never selects, returns,
-- logs, or copies the values. Reapplication is a no-op once the key is absent.
DO $legacy_telegram_scrub$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'office_preferences'
         AND NOT attisdropped
     ) THEN
    UPDATE public.profiles
    SET office_preferences = office_preferences
      - 'telegramConfig'
      - 'agentNames'
      - 'whiteboardNotes'
      - 'budgetConfig'
      - 'idleConfig'
      - 'agentFilterMode'
      - 'appearances'
    WHERE jsonb_typeof(office_preferences) = 'object'
      AND office_preferences ?| ARRAY[
        'telegramConfig',
        'agentNames',
        'whiteboardNotes',
        'budgetConfig',
        'idleConfig',
        'agentFilterMode',
        'appearances'
      ];
  END IF;
END;
$legacy_telegram_scrub$;

-- `profiles.agent_appearance` was a second circle-readable legacy store for
-- the same private appearance map. Erase it in place without projecting its
-- contents. The canonical owner-private copy now lives in
-- `office_user_preferences.preferences.appearances`.
DO $legacy_agent_appearance_scrub$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'agent_appearance'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     ) THEN
    UPDATE public.profiles
    SET agent_appearance = '{}'::jsonb
    WHERE agent_appearance IS DISTINCT FROM '{}'::jsonb;
  END IF;
END;
$legacy_agent_appearance_scrub$;

CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_profile_keys_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.office_preferences IS NOT NULL
     AND jsonb_typeof(NEW.office_preferences) = 'object' THEN
    NEW.office_preferences := NEW.office_preferences
      - 'telegramConfig'
      - 'agentNames'
      - 'whiteboardNotes'
      - 'budgetConfig'
      - 'idleConfig'
      - 'agentFilterMode'
      - 'appearances';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.strip_legacy_private_office_profile_keys_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DO $legacy_profile_trigger$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'office_preferences'
         AND NOT attisdropped
     ) THEN
    DROP TRIGGER IF EXISTS strip_legacy_private_office_profile_keys_v1
      ON public.profiles;
    CREATE TRIGGER strip_legacy_private_office_profile_keys_v1
    BEFORE INSERT OR UPDATE OF office_preferences ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.strip_legacy_private_office_profile_keys_v1();
  END IF;
END;
$legacy_profile_trigger$;

-- Keep the legacy appearance column empty even while older clients still
-- include it in profile inserts or updates. Only this deprecated field is
-- normalized; every unrelated NEW profile field passes through unchanged.
CREATE OR REPLACE FUNCTION public.strip_legacy_private_office_agent_appearance_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  NEW.agent_appearance := '{}'::jsonb;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.strip_legacy_private_office_agent_appearance_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DO $legacy_agent_appearance_trigger$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass
         AND attname = 'agent_appearance'
         AND atttypid = 'pg_catalog.jsonb'::pg_catalog.regtype
         AND NOT attisdropped
     ) THEN
    DROP TRIGGER IF EXISTS strip_legacy_private_office_agent_appearance_v1
      ON public.profiles;
    CREATE TRIGGER strip_legacy_private_office_agent_appearance_v1
    BEFORE INSERT OR UPDATE OF agent_appearance ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.strip_legacy_private_office_agent_appearance_v1();
  END IF;
END;
$legacy_agent_appearance_trigger$;

COMMIT;

NOTIFY pgrst, 'reload schema';
-- END SECTION 45: Owner-private Office user preferences
-- BEGIN SECTION 46: Circle-global idle-behavior claims
-- Source: supabase/migrations/20260817120000_circle_idle_behavior_claims.sql
-- Circle-global idle-behavior reservations.
--
-- Browser schedulers must claim through this RPC before producing any behavior
-- side effect. The conditional UPSERT is the single serialization point across
-- tabs, devices, and circle members; callers never receive direct table DML.

BEGIN;

-- Forward-compatible preference validator repair for databases that already
-- applied the original §45 before sharedChatOptIn was introduced. This exact
-- definition replaces the existing function in place, so its table constraint
-- and patch RPC observe the new optional boolean without rebuilding either.
CREATE OR REPLACE FUNCTION public.validate_office_user_preferences_v1(
  p_preferences jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog, public
AS $function$
DECLARE
  preference_entry record;
  nested_entry record;
  behavior_entry record;
  state_key text;
  numeric_value numeric;
  entry_count integer;
  text_value text;
BEGIN
  IF jsonb_typeof(p_preferences) <> 'object'
     OR octet_length(p_preferences::text) > 131072
     OR public.office_preferences_contains_secret_key_v1(p_preferences) THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_preferences) AS preference_key
    WHERE preference_key NOT IN (
      'agentNames',
      'appearances',
      'whiteboardNotes',
      'budgetConfig',
      'idleConfig',
      'agentFilterMode',
      'telegramMetadata'
    )
  ) THEN
    RETURN false;
  END IF;

  FOR preference_entry IN SELECT key, value FROM jsonb_each(p_preferences)
  LOOP
    CASE preference_entry.key
      WHEN 'agentNames' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count > 128 THEN RETURN false; END IF;
        FOR nested_entry IN SELECT key, value FROM jsonb_each(preference_entry.value)
        LOOP
          IF length(nested_entry.key) NOT BETWEEN 1 AND 240
             OR octet_length(nested_entry.key) > 960
             OR jsonb_typeof(nested_entry.value) <> 'string' THEN
            RETURN false;
          END IF;
          text_value := nested_entry.value #>> '{}';
          IF length(btrim(text_value)) NOT BETWEEN 1 AND 80
             OR octet_length(text_value) > 320 THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'appearances' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count > 128 THEN RETURN false; END IF;
        FOR nested_entry IN SELECT key, value FROM jsonb_each(preference_entry.value)
        LOOP
          IF length(nested_entry.key) NOT BETWEEN 1 AND 240
             OR octet_length(nested_entry.key) > 960
             OR jsonb_typeof(nested_entry.value) <> 'object' THEN
            RETURN false;
          END IF;
          SELECT count(*) INTO entry_count FROM jsonb_object_keys(nested_entry.value);
          IF entry_count <> 15
             OR EXISTS (
               SELECT 1 FROM jsonb_object_keys(nested_entry.value) AS appearance_key
               WHERE appearance_key NOT IN (
                 'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor',
                 'shoeColor', 'accessory', 'hat', 'expression', 'backItem',
                 'eyeColor', 'facialHair', 'pet', 'aura', 'handItem'
               )
             ) THEN
            RETURN false;
          END IF;
          FOREACH state_key IN ARRAY ARRAY[
            'skinTone', 'hairStyle', 'hairColor', 'shirtColor', 'pantsColor',
            'shoeColor', 'accessory', 'hat', 'expression', 'backItem',
            'eyeColor', 'facialHair', 'pet', 'aura', 'handItem'
          ]
          LOOP
            IF jsonb_typeof(nested_entry.value -> state_key) <> 'string' THEN
              RETURN false;
            END IF;
          END LOOP;
          FOREACH state_key IN ARRAY ARRAY[
            'skinTone', 'hairColor', 'shirtColor', 'pantsColor', 'shoeColor', 'eyeColor'
          ]
          LOOP
            IF (nested_entry.value ->> state_key) !~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$' THEN
              RETURN false;
            END IF;
          END LOOP;
          IF (nested_entry.value ->> 'hairStyle') NOT IN (
               'flat', 'spiky', 'mohawk', 'long', 'bald', 'cap', 'curly',
               'ponytail', 'buzzcut', 'afro', 'undercut', 'pigtails'
             )
             OR (nested_entry.value ->> 'accessory') NOT IN (
               'none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie',
               'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing',
               'visor_shades', 'gas_mask'
             )
             OR (nested_entry.value ->> 'hat') NOT IN (
               'none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns',
               'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet',
               'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'
             )
             OR (nested_entry.value ->> 'expression') NOT IN (
               'neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry',
               'surprised', 'smirk', 'crying'
             )
             OR (nested_entry.value ->> 'backItem') NOT IN (
               'none', 'cape', 'backpack', 'wings', 'jetpack', 'shield',
               'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket',
               'scroll', 'boombox'
             )
             OR (nested_entry.value ->> 'facialHair') NOT IN (
               'none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu',
               'sideburns', 'soul_patch'
             )
             OR (nested_entry.value ->> 'pet') NOT IN (
               'none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab',
               'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones', 'swan'
             )
             OR (nested_entry.value ->> 'aura') NOT IN (
               'none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow',
               'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'
             )
             OR (nested_entry.value ->> 'handItem') NOT IN (
               'none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand',
               'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'
             ) THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'whiteboardNotes' THEN
        IF jsonb_typeof(preference_entry.value) <> 'array'
           OR jsonb_array_length(preference_entry.value) > 8 THEN
          RETURN false;
        END IF;
        FOR nested_entry IN SELECT value FROM jsonb_array_elements(preference_entry.value)
        LOOP
          IF jsonb_typeof(nested_entry.value) <> 'string' THEN RETURN false; END IF;
          text_value := nested_entry.value #>> '{}';
          IF length(btrim(text_value)) NOT BETWEEN 1 AND 80
             OR octet_length(text_value) > 320 THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'budgetConfig' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object'
           OR jsonb_typeof(preference_entry.value -> 'enabled') <> 'boolean' THEN
          RETURN false;
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS budget_key
          WHERE budget_key NOT IN ('enabled', 'daily', 'weekly', 'monthly', 'hardLimit')
        ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'hardLimit'
           AND jsonb_typeof(preference_entry.value -> 'hardLimit') <> 'boolean' THEN
          RETURN false;
        END IF;
        FOREACH state_key IN ARRAY ARRAY['daily', 'weekly', 'monthly']
        LOOP
          IF preference_entry.value ? state_key THEN
            IF jsonb_typeof(preference_entry.value -> state_key) <> 'number' THEN
              RETURN false;
            END IF;
            numeric_value := (preference_entry.value ->> state_key)::numeric;
            IF numeric_value <= 0 OR numeric_value > 1000000 THEN RETURN false; END IF;
          END IF;
        END LOOP;

      WHEN 'idleConfig' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object'
           OR jsonb_typeof(preference_entry.value -> 'masterEnabled') <> 'boolean'
           OR jsonb_typeof(preference_entry.value -> 'behaviors') <> 'object' THEN
          RETURN false;
        END IF;
        IF EXISTS (
          SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS idle_key
          WHERE idle_key NOT IN ('masterEnabled', 'behaviors', 'sharedChatOptIn')
        ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'sharedChatOptIn'
           AND jsonb_typeof(preference_entry.value -> 'sharedChatOptIn') <> 'boolean' THEN
          RETURN false;
        END IF;
        SELECT count(*) INTO entry_count
        FROM jsonb_object_keys(preference_entry.value -> 'behaviors');
        IF entry_count > 64 THEN RETURN false; END IF;
        FOR behavior_entry IN
          SELECT key, value FROM jsonb_each(preference_entry.value -> 'behaviors')
        LOOP
          IF length(behavior_entry.key) NOT BETWEEN 1 AND 80
             OR octet_length(behavior_entry.key) > 320
             OR jsonb_typeof(behavior_entry.value) <> 'object'
             OR jsonb_typeof(behavior_entry.value -> 'enabled') <> 'boolean'
             OR jsonb_typeof(behavior_entry.value -> 'cooldownMinutes') <> 'number'
             OR NOT (behavior_entry.value ? 'lastRanAt') THEN
            RETURN false;
          END IF;
          IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(behavior_entry.value) AS behavior_key
            WHERE behavior_key NOT IN ('enabled', 'cooldownMinutes', 'lastRanAt')
          ) THEN
            RETURN false;
          END IF;
          numeric_value := (behavior_entry.value ->> 'cooldownMinutes')::numeric;
          IF numeric_value <> trunc(numeric_value)
             OR numeric_value < 1
             OR numeric_value > 10080 THEN
            RETURN false;
          END IF;
          IF jsonb_typeof(behavior_entry.value -> 'lastRanAt') = 'string' THEN
            text_value := behavior_entry.value ->> 'lastRanAt';
            IF length(text_value) > 40
               OR text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN
              RETURN false;
            END IF;
          ELSIF jsonb_typeof(behavior_entry.value -> 'lastRanAt') <> 'null' THEN
            RETURN false;
          END IF;
        END LOOP;

      WHEN 'agentFilterMode' THEN
        IF jsonb_typeof(preference_entry.value) <> 'string'
           OR (preference_entry.value #>> '{}') NOT IN ('all', 'mine', 'active', 'bonded') THEN
          RETURN false;
        END IF;

      WHEN 'telegramMetadata' THEN
        IF jsonb_typeof(preference_entry.value) <> 'object' THEN RETURN false; END IF;
        SELECT count(*) INTO entry_count FROM jsonb_object_keys(preference_entry.value);
        IF entry_count NOT BETWEEN 1 AND 2
           OR EXISTS (
             SELECT 1 FROM jsonb_object_keys(preference_entry.value) AS telegram_key
             WHERE telegram_key NOT IN ('chatId', 'botName')
           ) THEN
          RETURN false;
        END IF;
        IF preference_entry.value ? 'chatId' THEN
          IF jsonb_typeof(preference_entry.value -> 'chatId') <> 'string'
             OR (preference_entry.value ->> 'chatId') !~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,64})$' THEN
            RETURN false;
          END IF;
        END IF;
        IF preference_entry.value ? 'botName' THEN
          IF jsonb_typeof(preference_entry.value -> 'botName') <> 'string'
             OR (preference_entry.value ->> 'botName') !~ '^[A-Za-z0-9_]{1,64}$' THEN
            RETURN false;
          END IF;
        END IF;

      ELSE
        RETURN false;
    END CASE;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$function$;

REVOKE ALL ON FUNCTION public.validate_office_user_preferences_v1(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.circle_idle_behavior_claims (
  circle_id uuid NOT NULL REFERENCES public.circles(id) ON DELETE CASCADE,
  behavior_id text NOT NULL,
  claimed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claimed_at timestamptz NOT NULL,
  next_eligible_at timestamptz NOT NULL,
  PRIMARY KEY (circle_id, behavior_id)
);

ALTER TABLE public.circle_idle_behavior_claims
  DROP CONSTRAINT IF EXISTS circle_idle_behavior_claims_behavior_id_valid;
ALTER TABLE public.circle_idle_behavior_claims
  ADD CONSTRAINT circle_idle_behavior_claims_behavior_id_valid
  CHECK (
    behavior_id IN (
      'streak_guardian',
      'stale_task_detector',
      'circle_pulse_monitor',
      'knowledge_curator',
      'memory_digest',
      'morning_briefing',
      'weekly_retro',
      'goal_pace_tracker',
      'codebase_scanner',
      'dependency_health',
      'cost_efficiency_report'
    )
  );

ALTER TABLE public.circle_idle_behavior_claims
  DROP CONSTRAINT IF EXISTS circle_idle_behavior_claims_window_valid;
ALTER TABLE public.circle_idle_behavior_claims
  ADD CONSTRAINT circle_idle_behavior_claims_window_valid
  CHECK (
    next_eligible_at > claimed_at
    AND next_eligible_at <= claimed_at + interval '7 days'
  );

ALTER TABLE public.circle_idle_behavior_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_idle_behavior_claims FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.circle_idle_behavior_claims
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_idle_behavior_run_v1(
  p_circle_id uuid,
  p_behavior_id text,
  p_cooldown_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_actor_id uuid := auth.uid();
  v_server_now timestamptz;
  v_effective_cooldown_minutes integer;
  v_claimed_at timestamptz;
  v_next_eligible_at timestamptz;
  v_affected_rows integer := 0;
  v_claimed boolean := false;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_circle_id IS NULL THEN
    RAISE EXCEPTION 'circle_id_required' USING ERRCODE = '22023';
  END IF;
  IF p_behavior_id IS NULL OR p_behavior_id NOT IN (
    'streak_guardian',
    'stale_task_detector',
    'circle_pulse_monitor',
    'knowledge_curator',
    'memory_digest',
    'morning_briefing',
    'weekly_retro',
    'goal_pace_tracker',
    'codebase_scanner',
    'dependency_health',
    'cost_efficiency_report'
  ) THEN
    RAISE EXCEPTION 'idle_behavior_not_allowed' USING ERRCODE = '22023';
  END IF;
  IF p_cooldown_minutes IS NULL OR p_cooldown_minutes NOT BETWEEN 1 AND 10080 THEN
    RAISE EXCEPTION 'idle_behavior_cooldown_out_of_bounds' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.circle_members AS membership
  WHERE membership.circle_id = p_circle_id
    AND membership.user_id = v_actor_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'circle_membership_required' USING ERRCODE = '42501';
  END IF;

  v_effective_cooldown_minutes := CASE
    WHEN p_behavior_id IN (
      'streak_guardian',
      'circle_pulse_monitor',
      'morning_briefing',
      'weekly_retro',
      'goal_pace_tracker'
    )
      THEN greatest(p_cooldown_minutes, 1440)
    ELSE p_cooldown_minutes
  END;
  v_server_now := clock_timestamp();

  INSERT INTO public.circle_idle_behavior_claims AS current_claim (
    circle_id,
    behavior_id,
    claimed_by,
    claimed_at,
    next_eligible_at
  )
  VALUES (
    p_circle_id,
    p_behavior_id,
    v_actor_id,
    v_server_now,
    v_server_now + make_interval(mins => v_effective_cooldown_minutes)
  )
  ON CONFLICT (circle_id, behavior_id) DO UPDATE
  SET claimed_by = EXCLUDED.claimed_by,
      claimed_at = EXCLUDED.claimed_at,
      next_eligible_at = EXCLUDED.next_eligible_at
  WHERE current_claim.next_eligible_at <= EXCLUDED.claimed_at
  RETURNING current_claim.claimed_at, current_claim.next_eligible_at
    INTO v_claimed_at, v_next_eligible_at;

  GET DIAGNOSTICS v_affected_rows = ROW_COUNT;
  v_claimed := v_affected_rows = 1;

  IF NOT v_claimed THEN
    SELECT claim.claimed_at, claim.next_eligible_at
      INTO v_claimed_at, v_next_eligible_at
    FROM public.circle_idle_behavior_claims AS claim
    WHERE claim.circle_id = p_circle_id
      AND claim.behavior_id = p_behavior_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'idle_behavior_claim_state_unavailable' USING ERRCODE = '40001';
    END IF;
    v_effective_cooldown_minutes := greatest(
      1,
      least(
        10080,
        ceil(extract(epoch FROM (v_next_eligible_at - v_claimed_at)) / 60)::integer
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'schemaVersion', 1,
    'claimed', v_claimed,
    'behaviorId', p_behavior_id,
    'effectiveCooldownMinutes', v_effective_cooldown_minutes,
    'claimedAt', to_jsonb(v_claimed_at),
    'nextEligibleAt', to_jsonb(v_next_eligible_at)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer)
  TO authenticated;

COMMENT ON TABLE public.circle_idle_behavior_claims IS
  'Circle-global cooldown reservations claimed atomically before idle behavior side effects.';
COMMENT ON FUNCTION public.claim_idle_behavior_run_v1(uuid, text, integer) IS
  'Atomically reserves one allowlisted idle behavior for an authenticated circle member.';

COMMIT;

NOTIFY pgrst, 'reload schema';
-- END SECTION 46: Circle-global idle-behavior claims
