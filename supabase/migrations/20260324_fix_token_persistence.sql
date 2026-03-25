-- ─── Granular token breakdown columns ────────────────────────────────────────
-- Extends circle_office_agents with per-type token tracking and cost persistence.
-- The existing token_usage_today/total columns track aggregate tokens.
-- These new columns provide input/output/cached breakdowns + estimated costs.

ALTER TABLE circle_office_agents
  ADD COLUMN IF NOT EXISTS input_tokens_today    bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens_today   bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_tokens_today   bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS input_tokens_total    bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens_total   bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cached_tokens_total   bigint      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_today  numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estimated_cost_total  numeric(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS model_name            text;

-- ─── Snapshot-based token sync RPC ──────────────────────────────────────────
-- Called every 30s from the frontend with cumulative session token counts.
-- Computes deltas from the previous snapshot to safely increment _total columns
-- while setting _today columns to the current snapshot values.

CREATE OR REPLACE FUNCTION sync_agent_token_snapshot(
  p_circle_id        uuid,
  p_owner_id         uuid,
  p_agent_name       text,
  p_input_tokens     bigint,
  p_output_tokens    bigint,
  p_cached_tokens    bigint  DEFAULT 0,
  p_message_count    int     DEFAULT 0,
  p_estimated_cost   numeric DEFAULT 0,
  p_model            text    DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_prev_input   bigint;
  v_prev_output  bigint;
  v_prev_cached  bigint;
  v_prev_msgs    int;
  v_prev_cost    numeric;
  v_delta_input  bigint;
  v_delta_output bigint;
  v_delta_cached bigint;
  v_delta_msgs   int;
  v_delta_cost   numeric;
BEGIN
  -- Read current _today values to compute deltas for _total
  SELECT input_tokens_today, output_tokens_today, cached_tokens_today,
         message_count_today, estimated_cost_today
  INTO   v_prev_input, v_prev_output, v_prev_cached, v_prev_msgs, v_prev_cost
  FROM   circle_office_agents
  WHERE  circle_id = p_circle_id
    AND  owner_id  = p_owner_id
    AND  lower(name) = lower(p_agent_name);

  IF NOT FOUND THEN RETURN; END IF;

  -- Compute deltas (new snapshot - previous snapshot)
  -- Floor at 0 to handle session resets gracefully
  v_delta_input  := GREATEST(p_input_tokens  - COALESCE(v_prev_input,  0), 0);
  v_delta_output := GREATEST(p_output_tokens - COALESCE(v_prev_output, 0), 0);
  v_delta_cached := GREATEST(p_cached_tokens - COALESCE(v_prev_cached, 0), 0);
  v_delta_msgs   := GREATEST(p_message_count - COALESCE(v_prev_msgs,   0), 0);
  v_delta_cost   := GREATEST(p_estimated_cost - COALESCE(v_prev_cost,  0), 0);

  UPDATE circle_office_agents SET
    -- Snapshot (SET) for _today columns
    token_usage_today    = p_input_tokens + p_output_tokens,
    input_tokens_today   = p_input_tokens,
    output_tokens_today  = p_output_tokens,
    cached_tokens_today  = p_cached_tokens,
    message_count_today  = p_message_count,
    estimated_cost_today = p_estimated_cost,
    -- Accumulate deltas into _total columns
    token_usage_total    = token_usage_total   + v_delta_input + v_delta_output,
    input_tokens_total   = input_tokens_total  + v_delta_input,
    output_tokens_total  = output_tokens_total + v_delta_output,
    cached_tokens_total  = cached_tokens_total + v_delta_cached,
    message_count_total  = message_count_total + v_delta_msgs,
    estimated_cost_total = estimated_cost_total + v_delta_cost,
    -- Meta
    model_name   = COALESCE(p_model, model_name),
    updated_at   = now()
  WHERE circle_id = p_circle_id
    AND owner_id  = p_owner_id
    AND lower(name) = lower(p_agent_name);
END; $$;

GRANT EXECUTE ON FUNCTION sync_agent_token_snapshot(uuid, uuid, text, bigint, bigint, bigint, int, numeric, text) TO authenticated;

-- ─── Update daily reset to include new columns ─────────────────────────────
CREATE OR REPLACE FUNCTION reset_daily_agent_stats() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE circle_office_agents
  SET token_usage_today    = 0,
      input_tokens_today   = 0,
      output_tokens_today  = 0,
      cached_tokens_today  = 0,
      message_count_today  = 0,
      estimated_cost_today = 0,
      updated_at           = now();
END; $$;
