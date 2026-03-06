-- ─────────────────────────────────────────────────────────────────────────
-- Token breakdown: input/output/cached columns for real cost tracking
-- Matches Anthropic API response.usage fields
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Add granular token columns to office_terminal_responses
ALTER TABLE office_terminal_responses
  ADD COLUMN IF NOT EXISTS input_tokens          bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens         bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_creation_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cache_read_tokens     bigint NOT NULL DEFAULT 0;

-- 2. Update stream_response RPC to accept granular token data
CREATE OR REPLACE FUNCTION stream_response(
  p_response_id  uuid,
  p_text         text,
  p_status       text,
  p_tokens       bigint,
  p_latency_ms   int,
  p_model        text DEFAULT NULL,
  p_input_tokens bigint DEFAULT 0,
  p_output_tokens bigint DEFAULT 0,
  p_cache_creation_tokens bigint DEFAULT 0,
  p_cache_read_tokens bigint DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE office_terminal_responses
  SET response_text = p_text,
      status = p_status,
      token_count = p_tokens,
      latency_ms = p_latency_ms,
      model = COALESCE(p_model, model),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      cache_creation_tokens = p_cache_creation_tokens,
      cache_read_tokens = p_cache_read_tokens,
      updated_at = now()
  WHERE id = p_response_id;
END; $$;

-- Grant stays the same (signature changed, but Postgres replaces by name)
GRANT EXECUTE ON FUNCTION stream_response(uuid, text, text, bigint, int, text, bigint, bigint, bigint, bigint) TO authenticated;

-- 3. Index for per-model aggregation queries
CREATE INDEX IF NOT EXISTS idx_terminal_responses_model
  ON office_terminal_responses (model)
  WHERE model IS NOT NULL;

-- 4. Index for time-based analytics (cost trends)
CREATE INDEX IF NOT EXISTS idx_terminal_responses_created_at
  ON office_terminal_responses (created_at);
