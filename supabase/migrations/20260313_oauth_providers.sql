-- Add Google, Microsoft, and Yahoo OAuth providers to user_api_keys
-- These support real Calendar + Email integration in the Office

-- Expand the provider CHECK constraint to allow new OAuth providers
ALTER TABLE user_api_keys DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;
ALTER TABLE user_api_keys ADD CONSTRAINT user_api_keys_provider_check
  CHECK (provider IN (
    'openai', 'anthropic', 'openrouter', 'groq',
    'ollama', 'replicate', 'figma', 'stability',
    'google', 'microsoft', 'yahoo'
  ));

COMMENT ON TABLE user_api_keys IS 'Encrypted storage for user API keys and OAuth tokens (LLM, Figma, Google, Microsoft, Yahoo)';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
