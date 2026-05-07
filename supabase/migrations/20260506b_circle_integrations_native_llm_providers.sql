-- Wave 2 LLM provider expansion — adds the native BYOK chat providers
-- so users can wire their own Anthropic / OpenAI / Google / Groq / etc.
-- keys instead of either using the platform key or routing everything
-- through OpenRouter.

ALTER TABLE circle_integrations
  DROP CONSTRAINT IF EXISTS circle_integrations_provider_check;

ALTER TABLE circle_integrations
  ADD CONSTRAINT circle_integrations_provider_check
  CHECK (provider IN (
    -- Browser / automation
    'browserbase', 'stagehand', 'playwright_mcp', 'browserless', 'browserstack',
    'firecrawl', 'brave', 'apify', 'steel', 'hyperbrowser', 'airtop', 'skyvern', 'browser_use',
    -- Cloud / infrastructure / observability / auth
    'aws', 'cloudflare', 'cloudflare_r2', 'datadog', 'descope', 'launchdarkly', 'clerk',
    -- Knowledge / collaboration
    'wordpress', 'github', 'slack', 'teams', 'discord', 'figma', 'notion',
    -- Crypto / web3
    'helius',
    -- Analytics / advertising / monitoring
    'google_analytics', 'google_search_console', 'google_ads', 'meta_ads',
    'posthog', 'sentry', 'mux',
    -- Sales / commerce / messaging
    'hubspot', 'stripe', 'shopify', 'mailchimp', 'convertkit',
    'salesforce', 'pipedrive', 'resend', 'postmark',
    -- Hosting / deploy
    'vercel', 'netlify', 'fly_io', 'railway', 'render', 'digitalocean',
    -- Containers / orchestration / runtimes
    'docker', 'kubernetes', 'modal', 'ngrok',
    -- Databases / storage / vectors / search
    'supabase', 'neon', 'mongodb_atlas', 'upstash',
    'algolia', 'pinecone', 'cloudinary', 'qdrant', 'braintrust',
    -- LLM marketplaces (route across providers)
    'hugging_face', 'replicate', 'openrouter',
    -- LLM native providers (BYOK direct)
    'anthropic', 'openai', 'google_ai', 'groq', 'mistral_ai', 'cohere',
    'perplexity', 'together_ai', 'fireworks_ai', 'deepseek', 'z_ai',
    'minimax', 'ollama',
    -- Project tracking / dev tooling
    'linear', 'jira', 'snyk', 'trigger_dev'
  ));

NOTIFY pgrst, 'reload schema';
