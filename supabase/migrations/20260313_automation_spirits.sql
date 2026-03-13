-- Add spirit support to circle_automations
-- Each automation can optionally use an agent spirit to specialize its AI behavior.
-- spirit: ID of the spirit from agentSpirits.ts (e.g. 'coach', 'pm', 'security')
-- spirit_prompt: The full system prompt prefix for the spirit (cached server-side)

ALTER TABLE circle_automations
  ADD COLUMN IF NOT EXISTS spirit text,
  ADD COLUMN IF NOT EXISTS spirit_prompt text;

COMMENT ON COLUMN circle_automations.spirit IS 'Agent spirit ID (from agentSpirits.ts) for specialized AI behavior';
COMMENT ON COLUMN circle_automations.spirit_prompt IS 'Cached spirit system prompt prefix for edge function injection';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
