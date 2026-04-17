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
    'browserbase', 'braintrust', 'descope', 'algolia', 'pinecone',
    'resend', 'sentry', 'posthog'
  ));

NOTIFY pgrst, 'reload schema';
