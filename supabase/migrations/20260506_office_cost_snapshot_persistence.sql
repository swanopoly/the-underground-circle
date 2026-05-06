-- Preserve Office cost/tokens across bridge restarts.
-- Live CLI bridges report cumulative counters for the current local session.
-- If a bridge restarts, those counters can drop to zero. Track the previous
-- snapshot per session key so daily and all-time DB aggregates only move up.

CREATE TABLE IF NOT EXISTS circle_office_agent_usage_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_name text NOT NULL,
  snapshot_key text NOT NULL,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  message_count int NOT NULL DEFAULT 0,
  estimated_cost numeric(12,6) NOT NULL DEFAULT 0,
  model_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (circle_id, owner_id, agent_name, snapshot_key)
);

CREATE INDEX IF NOT EXISTS idx_office_usage_snapshots_agent
  ON circle_office_agent_usage_snapshots (circle_id, owner_id, lower(agent_name), last_seen_at DESC);

ALTER TABLE circle_office_agent_usage_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS office_usage_snapshots_owner_select ON circle_office_agent_usage_snapshots;
CREATE POLICY office_usage_snapshots_owner_select
  ON circle_office_agent_usage_snapshots FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS office_usage_snapshots_owner_manage ON circle_office_agent_usage_snapshots;
CREATE POLICY office_usage_snapshots_owner_manage
  ON circle_office_agent_usage_snapshots FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP FUNCTION IF EXISTS sync_agent_token_snapshot(uuid, uuid, text, bigint, bigint, bigint, int, numeric, text);

CREATE OR REPLACE FUNCTION sync_agent_token_snapshot(
  p_circle_id        uuid,
  p_owner_id         uuid,
  p_agent_name       text,
  p_input_tokens     bigint,
  p_output_tokens    bigint,
  p_cached_tokens    bigint  DEFAULT 0,
  p_message_count    int     DEFAULT 0,
  p_estimated_cost   numeric DEFAULT 0,
  p_model            text    DEFAULT NULL,
  p_snapshot_key     text    DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot_key text := COALESCE(NULLIF(trim(p_snapshot_key), ''), lower(p_agent_name));
  v_prev_input bigint;
  v_prev_output bigint;
  v_prev_cached bigint;
  v_prev_msgs int;
  v_prev_cost numeric;
  v_current_today_tokens bigint;
  v_current_total_tokens bigint;
  v_delta_input bigint := 0;
  v_delta_output bigint := 0;
  v_delta_cached bigint := 0;
  v_delta_msgs int := 0;
  v_delta_cost numeric := 0;
BEGIN
  SELECT token_usage_today, token_usage_total
  INTO v_current_today_tokens, v_current_total_tokens
  FROM circle_office_agents
  WHERE circle_id = p_circle_id
    AND owner_id = p_owner_id
    AND lower(name) = lower(p_agent_name);

  IF NOT FOUND THEN RETURN; END IF;

  SELECT input_tokens, output_tokens, cached_tokens, message_count, estimated_cost
  INTO v_prev_input, v_prev_output, v_prev_cached, v_prev_msgs, v_prev_cost
  FROM circle_office_agent_usage_snapshots
  WHERE circle_id = p_circle_id
    AND owner_id = p_owner_id
    AND lower(agent_name) = lower(p_agent_name)
    AND snapshot_key = v_snapshot_key
  FOR UPDATE;

  IF FOUND THEN
    -- If a local bridge reset causes counters to go down, treat the new
    -- positive value as fresh work instead of subtracting or resetting totals.
    v_delta_input := CASE
      WHEN p_input_tokens >= COALESCE(v_prev_input, 0) THEN p_input_tokens - COALESCE(v_prev_input, 0)
      ELSE GREATEST(p_input_tokens, 0)
    END;
    v_delta_output := CASE
      WHEN p_output_tokens >= COALESCE(v_prev_output, 0) THEN p_output_tokens - COALESCE(v_prev_output, 0)
      ELSE GREATEST(p_output_tokens, 0)
    END;
    v_delta_cached := CASE
      WHEN p_cached_tokens >= COALESCE(v_prev_cached, 0) THEN p_cached_tokens - COALESCE(v_prev_cached, 0)
      ELSE GREATEST(p_cached_tokens, 0)
    END;
    v_delta_msgs := CASE
      WHEN p_message_count >= COALESCE(v_prev_msgs, 0) THEN p_message_count - COALESCE(v_prev_msgs, 0)
      ELSE GREATEST(p_message_count, 0)
    END;
    v_delta_cost := CASE
      WHEN p_estimated_cost >= COALESCE(v_prev_cost, 0) THEN p_estimated_cost - COALESCE(v_prev_cost, 0)
      ELSE GREATEST(p_estimated_cost, 0)
    END;

    UPDATE circle_office_agent_usage_snapshots
    SET input_tokens = GREATEST(p_input_tokens, 0),
        output_tokens = GREATEST(p_output_tokens, 0),
        cached_tokens = GREATEST(p_cached_tokens, 0),
        message_count = GREATEST(p_message_count, 0),
        estimated_cost = GREATEST(p_estimated_cost, 0),
        model_name = COALESCE(p_model, model_name),
        last_seen_at = now()
    WHERE circle_id = p_circle_id
      AND owner_id = p_owner_id
      AND lower(agent_name) = lower(p_agent_name)
      AND snapshot_key = v_snapshot_key;
  ELSE
    -- On first deploy this avoids double-counting sessions already synced by
    -- the old function. Brand-new rows with zero aggregates count the snapshot.
    IF COALESCE(v_current_today_tokens, 0) = 0 AND COALESCE(v_current_total_tokens, 0) = 0 THEN
      v_delta_input := GREATEST(p_input_tokens, 0);
      v_delta_output := GREATEST(p_output_tokens, 0);
      v_delta_cached := GREATEST(p_cached_tokens, 0);
      v_delta_msgs := GREATEST(p_message_count, 0);
      v_delta_cost := GREATEST(p_estimated_cost, 0);
    END IF;

    INSERT INTO circle_office_agent_usage_snapshots (
      circle_id, owner_id, agent_name, snapshot_key,
      input_tokens, output_tokens, cached_tokens, message_count, estimated_cost, model_name
    ) VALUES (
      p_circle_id, p_owner_id, p_agent_name, v_snapshot_key,
      GREATEST(p_input_tokens, 0), GREATEST(p_output_tokens, 0), GREATEST(p_cached_tokens, 0),
      GREATEST(p_message_count, 0), GREATEST(p_estimated_cost, 0), p_model
    )
    ON CONFLICT (circle_id, owner_id, agent_name, snapshot_key) DO UPDATE
    SET input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cached_tokens = EXCLUDED.cached_tokens,
        message_count = EXCLUDED.message_count,
        estimated_cost = EXCLUDED.estimated_cost,
        model_name = COALESCE(EXCLUDED.model_name, circle_office_agent_usage_snapshots.model_name),
        last_seen_at = now();
  END IF;

  IF v_delta_input = 0
    AND v_delta_output = 0
    AND v_delta_cached = 0
    AND v_delta_msgs = 0
    AND v_delta_cost = 0 THEN
    UPDATE circle_office_agents
    SET model_name = COALESCE(p_model, model_name),
        updated_at = now()
    WHERE circle_id = p_circle_id
      AND owner_id = p_owner_id
      AND lower(name) = lower(p_agent_name);
    RETURN;
  END IF;

  UPDATE circle_office_agents
  SET token_usage_today = token_usage_today + v_delta_input + v_delta_output,
      input_tokens_today = input_tokens_today + v_delta_input,
      output_tokens_today = output_tokens_today + v_delta_output,
      cached_tokens_today = cached_tokens_today + v_delta_cached,
      message_count_today = message_count_today + v_delta_msgs,
      estimated_cost_today = estimated_cost_today + v_delta_cost,
      token_usage_total = token_usage_total + v_delta_input + v_delta_output,
      input_tokens_total = input_tokens_total + v_delta_input,
      output_tokens_total = output_tokens_total + v_delta_output,
      cached_tokens_total = cached_tokens_total + v_delta_cached,
      message_count_total = message_count_total + v_delta_msgs,
      estimated_cost_total = estimated_cost_total + v_delta_cost,
      model_name = COALESCE(p_model, model_name),
      updated_at = now()
  WHERE circle_id = p_circle_id
    AND owner_id = p_owner_id
    AND lower(name) = lower(p_agent_name);
END; $$;

GRANT EXECUTE ON FUNCTION sync_agent_token_snapshot(uuid, uuid, text, bigint, bigint, bigint, int, numeric, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
