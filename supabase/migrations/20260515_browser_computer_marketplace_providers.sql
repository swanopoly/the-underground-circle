ALTER TABLE circle_integrations
  DROP CONSTRAINT IF EXISTS circle_integrations_provider_check;

ALTER TABLE circle_integrations
  ADD CONSTRAINT circle_integrations_provider_check
  CHECK (provider IN (
    'github', 'wordpress', 'slack', 'teams', 'discord', 'helius',
    'aws', 'cloudflare', 'hubspot',
    'google_analytics', 'google_search_console', 'google_ads', 'meta_ads',
    'stripe', 'shopify', 'mailchimp', 'convertkit',
    'salesforce', 'pipedrive', 'vercel', 'netlify', 'figma', 'notion',
    'browserbase', 'stagehand', 'playwright_mcp', 'browserless', 'browserstack',
    'firecrawl', 'apify', 'steel', 'hyperbrowser', 'airtop', 'skyvern',
    'browser_use', 'braintrust', 'descope', 'launchdarkly',
    'algolia', 'pinecone', 'cloudinary',
    'resend', 'sentry', 'posthog', 'datadog', 'mux'
  ));

NOTIFY pgrst, 'reload schema';
