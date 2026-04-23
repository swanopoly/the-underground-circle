-- automation-executor now requires an explicit opt-in for premium models
-- (Sonnet / Opus). Without this flag set to true, any automation whose
-- `model` column references a premium tier is silently downgraded to Haiku
-- so a typo or stale config can't burn the spend budget.

ALTER TABLE circle_automations
  ADD COLUMN IF NOT EXISTS allow_premium_model boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN circle_automations.allow_premium_model IS
  'When true, the automation may use claude-sonnet or claude-opus. When false (default), any premium model request is downgraded to claude-haiku in the automation-executor.';

-- Reload PostgREST schema cache so the column is queryable immediately.
NOTIFY pgrst, 'reload schema';
