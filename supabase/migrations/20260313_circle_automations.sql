-- ─────────────────────────────────────────────────────────────────────────────
-- Circle Automations — Cursor-style always-on background agents
--
-- Scheduled, event-driven, and manual automations for circles.
-- Uses pg_cron + pg_net to trigger the automation-executor edge function.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── circle_automations ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS circle_automations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  created_by      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Identity
  name            text        NOT NULL,
  description     text,
  icon            text        NOT NULL DEFAULT '⚡',

  -- Trigger configuration
  trigger_type    text        NOT NULL DEFAULT 'schedule'
                    CHECK (trigger_type IN ('schedule', 'event', 'manual')),

  -- Schedule config (shorthand: 'daily', 'weekly', 'monthly', 'hourly')
  cron_expression text,

  -- Event config: { "table": "check_ins", "event": "INSERT" }
  event_config    jsonb       DEFAULT '{}',

  -- Execution config
  agent           text        NOT NULL DEFAULT 'BlackSwan',
  prompt          text        NOT NULL,
  model           text        DEFAULT 'claude-haiku',

  -- Context gathering flags
  include_context jsonb       NOT NULL DEFAULT '{"members": true, "check_ins": true, "tasks": true, "streaks": true, "analytics": false}',

  -- Output config
  output_target   text        NOT NULL DEFAULT 'activity'
                    CHECK (output_target IN ('activity', 'chat', 'webhook', 'silent')),
  webhook_url     text,

  -- State
  enabled         boolean     NOT NULL DEFAULT true,
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  run_count       integer     NOT NULL DEFAULT 0,
  last_error      text,

  -- Template tracking
  template_id     text,

  -- Timestamps
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_automations_circle ON circle_automations(circle_id);
CREATE INDEX idx_automations_enabled ON circle_automations(enabled, trigger_type)
  WHERE enabled = true;
CREATE INDEX idx_automations_next_run ON circle_automations(next_run_at)
  WHERE enabled = true AND trigger_type = 'schedule';

-- RLS
ALTER TABLE circle_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_members_read_automations"
  ON circle_automations FOR SELECT
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "creator_manages_automations"
  ON circle_automations FOR ALL
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "admin_manages_automations"
  ON circle_automations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM circle_members
      WHERE circle_members.circle_id = circle_automations.circle_id
        AND circle_members.user_id = auth.uid()
        AND circle_members.role = 'creator'
    )
  );

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_circle_automations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER circle_automations_updated_at
  BEFORE UPDATE ON circle_automations
  FOR EACH ROW EXECUTE FUNCTION update_circle_automations_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE circle_automations;


-- ─── automation_runs (execution history) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS automation_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id   uuid        NOT NULL REFERENCES circle_automations(id) ON DELETE CASCADE,
  circle_id       uuid        NOT NULL REFERENCES circles(id) ON DELETE CASCADE,

  -- Execution details
  status          text        NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  trigger_source  text        NOT NULL DEFAULT 'schedule'
                    CHECK (trigger_source IN ('schedule', 'event', 'manual')),
  triggered_by    uuid        REFERENCES auth.users(id),

  -- Input/Output
  input_context   jsonb       DEFAULT '{}',
  prompt_used     text,
  output_text     text,
  output_target   text,

  -- Performance
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer,
  token_count     integer     DEFAULT 0,
  model_used      text,

  -- Error tracking
  error_message   text,

  -- Cost
  estimated_cost  numeric(10,6) DEFAULT 0
);

CREATE INDEX idx_runs_automation ON automation_runs(automation_id, started_at DESC);
CREATE INDEX idx_runs_circle ON automation_runs(circle_id, started_at DESC);

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "circle_members_read_runs"
  ON automation_runs FOR SELECT
  USING (
    circle_id IN (
      SELECT circle_id FROM circle_members WHERE user_id = auth.uid()
    )
  );

-- Service role can insert/update runs (edge function uses service role)
CREATE POLICY "service_role_manage_runs"
  ON automation_runs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');


-- ─── pg_cron scheduler ───────────────────────────────────────────────────────
-- Runs every minute, fires pg_net HTTP POST to automation-executor edge fn
-- for any scheduled automations whose next_run_at has passed.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION run_due_automations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec RECORD;
  v_base_url text;
  v_service_key text;
BEGIN
  -- Get Supabase config from vault or settings
  v_base_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1)
  );
  v_service_key := coalesce(
    current_setting('app.settings.service_role_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
  );

  -- Safety: skip if config not available
  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE NOTICE 'run_due_automations: missing SUPABASE_URL or SERVICE_ROLE_KEY, skipping';
    RETURN;
  END IF;

  FOR rec IN
    SELECT id, circle_id, cron_expression
    FROM circle_automations
    WHERE enabled = true
      AND trigger_type = 'schedule'
      AND next_run_at IS NOT NULL
      AND next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT 10
  LOOP
    -- Fire edge function async via pg_net
    PERFORM net.http_post(
      url := v_base_url || '/functions/v1/automation-executor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'automationId', rec.id,
        'circleId', rec.circle_id,
        'triggerSource', 'schedule'
      )
    );

    -- Advance next_run_at
    UPDATE circle_automations
    SET
      last_run_at = now(),
      next_run_at = CASE
        WHEN cron_expression = 'hourly'  THEN now() + interval '1 hour'
        WHEN cron_expression = 'daily'   THEN now() + interval '1 day'
        WHEN cron_expression = 'weekly'  THEN now() + interval '7 days'
        WHEN cron_expression = 'monthly' THEN now() + interval '30 days'
        ELSE now() + interval '1 day'
      END,
      run_count = run_count + 1
    WHERE id = rec.id;
  END LOOP;
END;
$$;

SELECT cron.schedule(
  'run-due-automations',
  '* * * * *',
  'SELECT run_due_automations()'
);

GRANT EXECUTE ON FUNCTION run_due_automations() TO postgres;


-- ─── Event triggers ──────────────────────────────────────────────────────────
-- Lightweight DB triggers on high-value tables that fire automations via pg_net

CREATE OR REPLACE FUNCTION notify_automation_on_checkin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_base_url text;
  v_service_key text;
  rec RECORD;
BEGIN
  v_base_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1)
  );
  v_service_key := coalesce(
    current_setting('app.settings.service_role_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
  );

  IF v_base_url IS NULL OR v_service_key IS NULL THEN RETURN NEW; END IF;

  FOR rec IN
    SELECT id, circle_id
    FROM circle_automations
    WHERE enabled = true
      AND trigger_type = 'event'
      AND circle_id = NEW.circle_id
      AND event_config->>'table' = 'check_ins'
      AND event_config->>'event' = 'INSERT'
  LOOP
    PERFORM net.http_post(
      url := v_base_url || '/functions/v1/automation-executor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'automationId', rec.id,
        'circleId', rec.circle_id,
        'triggerSource', 'event',
        'eventPayload', jsonb_build_object(
          'table', 'check_ins',
          'user_id', NEW.user_id,
          'content', left(NEW.content, 200)
        )
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_on_checkin
  AFTER INSERT ON check_ins
  FOR EACH ROW EXECUTE FUNCTION notify_automation_on_checkin();


-- Event trigger for new circle members
CREATE OR REPLACE FUNCTION notify_automation_on_member_join()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_base_url text;
  v_service_key text;
  rec RECORD;
BEGIN
  v_base_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1)
  );
  v_service_key := coalesce(
    current_setting('app.settings.service_role_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
  );

  IF v_base_url IS NULL OR v_service_key IS NULL THEN RETURN NEW; END IF;

  FOR rec IN
    SELECT id, circle_id
    FROM circle_automations
    WHERE enabled = true
      AND trigger_type = 'event'
      AND circle_id = NEW.circle_id
      AND event_config->>'table' = 'circle_members'
      AND event_config->>'event' = 'INSERT'
  LOOP
    PERFORM net.http_post(
      url := v_base_url || '/functions/v1/automation-executor',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object(
        'automationId', rec.id,
        'circleId', rec.circle_id,
        'triggerSource', 'event',
        'eventPayload', jsonb_build_object(
          'table', 'circle_members',
          'user_id', NEW.user_id
        )
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_on_member_join
  AFTER INSERT ON circle_members
  FOR EACH ROW EXECUTE FUNCTION notify_automation_on_member_join();
