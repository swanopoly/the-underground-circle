-- BYOK provider catalog should be application-managed, not blocked by a
-- database CHECK that goes stale every time we add a model or website provider.
ALTER TABLE user_api_keys
  DROP CONSTRAINT IF EXISTS user_api_keys_provider_check;

COMMENT ON COLUMN user_api_keys.provider IS
  'Provider key such as openai, anthropic, huggingface, github-models, zai, minimax, wordpress, browserbase, etc. The app validates supported providers.';

NOTIFY pgrst, 'reload schema';
