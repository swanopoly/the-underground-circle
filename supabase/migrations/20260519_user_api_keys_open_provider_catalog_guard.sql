-- Keep BYOK provider storage open-ended.
--
-- Older migrations used a CHECK constraint on user_api_keys.provider. That
-- breaks whenever the app adds a new marketplace/model provider such as
-- huggingface, zai, minimax, browserbase, wordpress, or future providers.
-- Provider support is validated in application code instead.

ALTER TABLE user_api_keys
  DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;

COMMENT ON COLUMN user_api_keys.provider IS
  'Application-managed provider key such as openai, anthropic, openrouter, huggingface, zai, minimax, browserbase, wordpress, helius, etc. Supported providers are validated by the app, not a database CHECK constraint.';

NOTIFY pgrst, 'reload schema';
