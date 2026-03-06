-- ─────────────────────────────────────────────────────────────────────────
-- Terminal enhancements: model selection + multi-agent targeting
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Model preference on messages (null = auto cascade)
ALTER TABLE office_terminal_messages
  ADD COLUMN IF NOT EXISTS model text;

-- 2. Multi-agent targeting (uuid array, null = @all)
ALTER TABLE office_terminal_messages
  ADD COLUMN IF NOT EXISTS target_agent_ids uuid[];

-- 3. Track which model actually responded
ALTER TABLE office_terminal_responses
  ADD COLUMN IF NOT EXISTS model text;
