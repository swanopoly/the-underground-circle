-- ─────────────────────────────────────────────────────────────────────────────
-- Automation Event Triggers — Tasks + Messages + New Cron Intervals
--
-- 1. Task completion event trigger (fires when task status → 'done')
-- 2. Message event trigger (fires on new message INSERT)
-- 3. Update run_due_automations() with every_6h + twice_daily intervals
-- 4. Add 'retry' to trigger_source CHECK constraint
-- ─────────────────────────────────────────────────────────────────────────────


-- ─── 1. Task Completion Event Trigger ───────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_automation_on_task_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_base_url text;
  v_service_key text;
  rec RECORD;
BEGIN
  -- Only fire when status changes TO 'done'
  IF NEW.status != 'done' OR (OLD IS NOT NULL AND OLD.status = 'done') THEN
    RETURN NEW;
  END IF;

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
      AND event_config->>'table' = 'tasks'
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
          'table', 'tasks',
          'task_id', NEW.id,
          'title', left(NEW.title, 200),
          'assigned_to', NEW.assigned_to,
          'completed_at', NEW.completed_at
        )
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_on_task_complete
  AFTER UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION notify_automation_on_task_complete();


-- ─── 2. Message Event Trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION notify_automation_on_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_base_url text;
  v_service_key text;
  rec RECORD;
BEGIN
  -- Skip bot messages to avoid loops
  IF NEW.is_bot = true THEN RETURN NEW; END IF;

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
      AND event_config->>'table' = 'messages'
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
          'table', 'messages',
          'user_id', NEW.user_id,
          'content', left(NEW.content, 300)
        )
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_automation_on_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_automation_on_message();


-- ─── 3. Update run_due_automations with new cron intervals ──────────────────

CREATE OR REPLACE FUNCTION run_due_automations()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  rec RECORD;
  v_base_url text;
  v_service_key text;
BEGIN
  v_base_url := coalesce(
    current_setting('app.settings.supabase_url', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1)
  );
  v_service_key := coalesce(
    current_setting('app.settings.service_role_key', true),
    (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
  );

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

    UPDATE circle_automations
    SET
      last_run_at = now(),
      next_run_at = CASE
        WHEN cron_expression = 'hourly'      THEN now() + interval '1 hour'
        WHEN cron_expression = 'every_6h'    THEN now() + interval '6 hours'
        WHEN cron_expression = 'twice_daily' THEN now() + interval '12 hours'
        WHEN cron_expression = 'daily'       THEN now() + interval '1 day'
        WHEN cron_expression = 'weekly'      THEN now() + interval '7 days'
        WHEN cron_expression = 'monthly'     THEN now() + interval '30 days'
        ELSE now() + interval '1 day'
      END,
      run_count = run_count + 1
    WHERE id = rec.id;
  END LOOP;
END;
$$;


-- ─── 4. Allow 'retry' as a trigger_source ───────────────────────────────────

ALTER TABLE automation_runs DROP CONSTRAINT IF EXISTS automation_runs_trigger_source_check;
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_trigger_source_check
  CHECK (trigger_source IN ('schedule', 'event', 'manual', 'retry'));


-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
