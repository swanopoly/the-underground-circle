-- RPC function to schedule automation retries via pg_net
-- Called by the automation-executor edge function when a run fails
-- Uses pg_net http_post to dispatch a new execution after a delay

CREATE OR REPLACE FUNCTION schedule_automation_retry(
  p_automation_id UUID,
  p_circle_id UUID,
  p_trigger_source TEXT DEFAULT 'retry',
  p_triggered_by UUID DEFAULT NULL,
  p_event_payload TEXT DEFAULT NULL,
  p_retry_count INT DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url TEXT;
  v_service_key TEXT;
  v_body JSONB;
BEGIN
  -- Build the request
  v_url := current_setting('app.settings.supabase_url', true) ||
           '/functions/v1/automation-executor';

  -- Fallback: try env var format
  IF v_url IS NULL OR v_url = '/functions/v1/automation-executor' THEN
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'supabase_url'
    LIMIT 1;
    IF v_url IS NOT NULL THEN
      v_url := v_url || '/functions/v1/automation-executor';
    END IF;
  END IF;

  -- Get service role key for auth
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'service_role_key'
  LIMIT 1;

  -- Build request body
  v_body := jsonb_build_object(
    'automationId', p_automation_id,
    'circleId', p_circle_id,
    'triggerSource', p_trigger_source,
    'retryCount', p_retry_count
  );

  IF p_triggered_by IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('triggeredBy', p_triggered_by);
  END IF;

  IF p_event_payload IS NOT NULL THEN
    v_body := v_body || jsonb_build_object('eventPayload', p_event_payload::jsonb);
  END IF;

  -- Fire via pg_net (async HTTP call from Postgres)
  -- This runs independently of the calling edge function's lifecycle
  IF v_url IS NOT NULL AND v_service_key IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url,
      body := v_body,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      )
    );
  END IF;
END;
$$;
