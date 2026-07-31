import { supabase } from './supabase';
import { buildIntegrationSaveHealthState } from './integrationHealthBadgeCore';

export type CircleIntegrationProvider =
  | 'browserbase'
  | 'stagehand'
  | 'playwright_mcp'
  | 'browserless'
  | 'browserstack'
  | 'firecrawl'
  | 'brave'
  | 'apify'
  | 'steel'
  | 'hyperbrowser'
  | 'airtop'
  | 'skyvern'
  | 'browser_use'
  | 'custom_api'
  | 'aws'
  | 'braintrust'
  | 'cloudflare'
  | 'cloudinary'
  | 'datadog'
  | 'descope'
  | 'hubspot'
  | 'wordpress'
  | 'github'
  | 'slack'
  | 'teams'
  | 'discord'
  | 'helius'
  | 'google_analytics'
  | 'google_search_console'
  | 'google_ads'
  | 'meta_ads'
  | 'stripe'
  | 'shopify'
  | 'mailchimp'
  | 'convertkit'
  | 'salesforce'
  | 'pipedrive'
  | 'vercel'
  | 'netlify'
  | 'figma'
  | 'notion'
  | 'launchdarkly'
  | 'mux'
  | 'algolia'
  | 'pinecone'
  | 'resend'
  | 'sentry'
  | 'posthog'
  // ── Wave 1 expansion ──
  | 'docker'
  | 'kubernetes'
  | 'fly_io'
  | 'railway'
  | 'render'
  | 'digitalocean'
  | 'supabase'
  | 'neon'
  | 'mongodb_atlas'
  | 'upstash'
  | 'hugging_face'
  | 'replicate'
  | 'modal'
  | 'openrouter'
  | 'linear'
  | 'jira'
  | 'snyk'
  | 'clerk'
  | 'postmark'
  | 'cloudflare_r2'
  | 'qdrant'
  | 'ngrok'
  | 'trigger_dev'
  // ── Wave 2: native LLM providers (BYOK) ──
  | 'anthropic'
  | 'openai'
  | 'openai_compatible'
  | 'google_ai'
  | 'groq'
  | 'mistral_ai'
  | 'cohere'
  | 'perplexity'
  | 'together_ai'
  | 'fireworks_ai'
  | 'deepseek'
  | 'z_ai'
  | 'minimax'
  | 'ollama'
  // ── BlackSwan: our own fine-tuned model, hosted on HF Inference Endpoint ──
  | 'blackswan';

export interface CircleIntegrationRecord {
  id: string;
  circle_id: string;
  provider: CircleIntegrationProvider;
  label: string;
  status: 'connected' | 'degraded' | 'disabled' | 'planned';
  connection_scope: 'circle' | 'room' | 'user';
  display_name?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  capability_flags?: string[];
  installed_by?: string | null;
  is_active?: boolean;
  last_validated_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface IntegrationDefinition {
  provider: CircleIntegrationProvider;
  label: string;
  description: string;
  capabilityFlags: string[];
  requiredSecretKeys: string[];
  optionalSecretKeys?: string[];
  metadataFields?: Array<{
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
  }>;
  validationHints?: string[];
}

export const INTEGRATION_DEFINITIONS: Record<string, IntegrationDefinition> = {
  browserbase: {
    provider: 'browserbase',
    label: 'Browserbase',
    description: 'Remote browser sessions and automation infrastructure for agents that need durable web execution.',
    capabilityFlags: ['remote_browser_sessions', 'web_automation', 'browser_replay'],
    requiredSecretKeys: ['api_key', 'project_id'],
    optionalSecretKeys: ['session_region'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Main Browserbase Workspace', required: false },
    ],
    validationHints: ['Use a project-scoped API key.', 'Add a default region if browser latency matters for automations.'],
  },
  stagehand: {
    provider: 'stagehand',
    label: 'Stagehand',
    description: 'AI browser-agent framework for natural-language actions, self-healing Playwright flows, and reusable web task recipes.',
    capabilityFlags: ['ai_browser_actions', 'self_healing_browser_flows', 'browser_workflow_recipes'],
    requiredSecretKeys: [],
    optionalSecretKeys: ['llm_api_key'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Browser Agent Workflows' },
      { key: 'defaultModelProvider', label: 'Default Model Provider', placeholder: 'openai or anthropic' },
    ],
    validationHints: ['Pair with Browserbase for durable cloud sessions.', 'Use for dynamic websites where deterministic selectors break often.'],
  },
  playwright_mcp: {
    provider: 'playwright_mcp',
    label: 'Playwright MCP',
    description: 'MCP-backed browser automation with DOM snapshots, screenshots, browser actions, and deterministic QA/test generation.',
    capabilityFlags: ['deterministic_browser_control', 'browser_dom_snapshots', 'browser_screenshots', 'generate_browser_tests'],
    requiredSecretKeys: [],
    optionalSecretKeys: ['mcp_server_url', 'server_command'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Local Playwright MCP' },
      { key: 'defaultBrowser', label: 'Default Browser', placeholder: 'chromium' },
    ],
    validationHints: ['Use local MCP for precise QA and DOM inspection.', 'Prefer scoped test flows to avoid large browser snapshots on every agent turn.'],
  },
  browserless: {
    provider: 'browserless',
    label: 'Browserless',
    description: 'Headless browser API for screenshots, PDFs, scraping, scripted browser functions, and live browser debugging.',
    capabilityFlags: ['headless_browser_api', 'capture_screenshots', 'generate_pdfs', 'scrape_web_pages'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['endpoint_url'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Browserless Production' },
      { key: 'defaultRegion', label: 'Default Region', placeholder: 'sfo' },
    ],
    validationHints: ['Use for repeatable screenshots, PDFs, and lower-cost scrape jobs that do not need a full AI browser session.'],
  },
  browserstack: {
    provider: 'browserstack',
    label: 'BrowserStack',
    description: 'Real-browser and real-device testing for cross-browser QA, session recordings, screenshots, and release validation.',
    capabilityFlags: ['cross_browser_qa', 'real_device_testing', 'browser_session_recordings', 'visual_regression_checks'],
    requiredSecretKeys: ['username', 'access_key'],
    optionalSecretKeys: ['project_name'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'QA Device Cloud' },
      { key: 'defaultBrowserMatrix', label: 'Default Browser Matrix', placeholder: 'Chrome latest, Safari iOS, Edge latest' },
    ],
    validationHints: ['Use for release checks across real browsers and mobile devices.', 'Keep a default browser matrix so agents know what to validate.'],
  },
  firecrawl: {
    provider: 'firecrawl',
    label: 'Firecrawl',
    description: 'Web scrape, crawl, search, and extract APIs that turn pages into clean markdown or structured data for agents.',
    capabilityFlags: ['web_scrape_markdown', 'site_crawl', 'web_search', 'structured_web_extract'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['api_url'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Research Web Data' },
    ],
    validationHints: ['Use for research and RAG ingestion where clean markdown is cheaper than full browser control.'],
  },
  brave: {
    provider: 'brave',
    label: 'Brave Search',
    description: 'Independent web search API for current research, source discovery, and grounded chat answers.',
    capabilityFlags: ['web_search', 'current_research', 'source_discovery', 'chat_grounding'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'country', label: 'Default Country', placeholder: 'us' },
      { key: 'searchLang', label: 'Search Language', placeholder: 'en' },
    ],
    validationHints: ['Paste your Brave Search API subscription token. Chat uses it server-side through the search_web tool; the key is never sent to the browser prompt.'],
  },
  custom_api: {
    provider: 'custom_api',
    label: 'Custom API',
    description: 'Connect any REST or HTTP API so chat, SwanBot, and OpenSwan can plan against it, discover safe docs/metadata, and request approval before side-effect calls.',
    capabilityFlags: ['custom_api', 'api_connector', 'read_data', 'write_data', 'automation_action', 'agent_tool'],
    requiredSecretKeys: [],
    optionalSecretKeys: ['api_key', 'bearer_token', 'basic_username', 'basic_password', 'webhook_secret'],
    metadataFields: [
      { key: 'apiName', label: 'API Name', placeholder: 'Acme CRM', required: true },
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.example.com', required: true },
      { key: 'apiDocsUrl', label: 'API Docs URL', placeholder: 'https://docs.example.com', required: false },
      { key: 'defaultEndpoint', label: 'Default Endpoint', placeholder: '/v1/customers', required: false },
      { key: 'defaultMethod', label: 'Default Method', placeholder: 'GET', required: false },
      { key: 'allowedMethods', label: 'Allowed Methods', placeholder: 'GET, POST', required: false },
      { key: 'authScheme', label: 'Auth Scheme', placeholder: 'bearer, x-api-key, basic, or none', required: false },
      { key: 'apiKeyHeaderName', label: 'API Key Header Name', placeholder: 'x-api-key', required: false },
      { key: 'defaultAction', label: 'Primary Agent Task', placeholder: 'Create customer records', required: false },
      { key: 'toolNamespace', label: 'Tool Namespace', placeholder: 'acme_crm', required: false },
      { key: 'dataBoundary', label: 'Data Boundary', placeholder: 'Only customer support tickets', required: false },
      { key: 'rateLimitPolicy', label: 'Rate Limit / Safety Notes', placeholder: 'Max 20 calls per minute', required: false },
    ],
    validationHints: [
      'Start read-only: add base URL and docs first, then add credentials only when write actions are approved.',
      'Keep API keys in secret fields; prompt context only receives endpoint, docs, and capability metadata.',
      'Write, delete, publish, billing, and customer-impacting calls must route through approval before execution.',
    ],
  },
  // ── Team messaging (outbound via incoming webhooks) ──
  // These providers previously only "tracked the connection" and could not
  // post anything. The `incoming_webhook_url` secret lets an agent post a
  // completion summary / approval request / alert to the team's channel
  // through the guarded, approval-gated `messaging.notify` tool +
  // `messaging-notify` edge function (server-side secret injection, private-
  // host block, no secret leak — mirrors the custom_api.request pattern).
  slack: {
    provider: 'slack',
    label: 'Slack',
    description: 'Post agent completion summaries, approval requests, and alerts to a Slack channel via an incoming webhook. Approval-gated and server-side only — the webhook URL never reaches the model or the browser.',
    capabilityFlags: ['messaging', 'post_channel_message', 'team_notifications', 'agent_tool'],
    requiredSecretKeys: ['incoming_webhook_url'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Acme HQ', required: false },
      { key: 'defaultChannel', label: 'Default Channel', placeholder: '#team-updates', required: false },
    ],
    validationHints: [
      'Paste a Slack Incoming Webhook URL (Slack → Apps → Incoming Webhooks → Add to a channel). It looks like https://hooks.slack.com/services/T…/B…/….',
      'The webhook is stored as a secret and injected server-side; posting a message is approval-gated as an external side effect.',
    ],
  },
  discord: {
    provider: 'discord',
    label: 'Discord',
    description: 'Post agent completion summaries, approval requests, and alerts to a Discord channel via a channel webhook. Approval-gated and server-side only — the webhook URL never reaches the model or the browser.',
    capabilityFlags: ['messaging', 'post_channel_message', 'team_notifications', 'agent_tool'],
    requiredSecretKeys: ['incoming_webhook_url'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'serverName', label: 'Server Name', placeholder: 'Acme Guild', required: false },
      { key: 'defaultChannel', label: 'Default Channel', placeholder: '#alerts', required: false },
    ],
    validationHints: [
      'Paste a Discord Webhook URL (Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL). It looks like https://discord.com/api/webhooks/…/….',
      'The webhook is stored as a secret and injected server-side; posting a message is approval-gated as an external side effect.',
    ],
  },
  teams: {
    provider: 'teams',
    label: 'Microsoft Teams',
    description: 'Post agent completion summaries, approval requests, and alerts to a Microsoft Teams channel via an incoming webhook. Approval-gated and server-side only — the webhook URL never reaches the model or the browser.',
    capabilityFlags: ['messaging', 'post_channel_message', 'team_notifications', 'agent_tool'],
    requiredSecretKeys: ['incoming_webhook_url'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'teamName', label: 'Team Name', placeholder: 'Engineering', required: false },
      { key: 'defaultChannel', label: 'Default Channel', placeholder: 'Deploys', required: false },
    ],
    validationHints: [
      'Paste a Teams Incoming Webhook URL (channel → … → Connectors → Incoming Webhook → Configure). It looks like https://<tenant>.webhook.office.com/webhookb2/….',
      'The webhook is stored as a secret and injected server-side; posting a message is approval-gated as an external side effect.',
    ],
  },
  apify: {
    provider: 'apify',
    label: 'Apify',
    description: 'Cloud Actors for scraping, browser automation, datasets, scheduled crawls, and production web-data workflows.',
    capabilityFlags: ['run_web_actors', 'web_scraping_datasets', 'scheduled_crawls', 'browser_automation_jobs'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['default_actor_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Web Data Actors' },
      { key: 'defaultDatasetName', label: 'Default Dataset Name', placeholder: 'circle-web-research' },
    ],
    validationHints: ['Use for repeatable scraping workflows, scheduled data pulls, and structured datasets.'],
  },
  steel: {
    provider: 'steel',
    label: 'Steel',
    description: 'Open-source browser API for cloud browser fleets, autonomous web agents, scraping jobs, and browser session control.',
    capabilityFlags: ['cloud_browser_sessions', 'browser_agent_api', 'browser_fleet_control'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['base_url'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Open Browser Fleet' },
    ],
    validationHints: ['Use as an open browser-agent backend option when you want more control over browser infrastructure.'],
  },
  hyperbrowser: {
    provider: 'hyperbrowser',
    label: 'Hyperbrowser',
    description: 'Browser-as-a-service infrastructure for AI agents, cloud browser sessions, scraping, and Browser Use execution.',
    capabilityFlags: ['cloud_browser_sessions', 'browser_agent_api', 'browser_use_tasks', 'web_scraping_jobs'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['base_url'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Hyperbrowser Agent Cloud' },
      { key: 'defaultProfile', label: 'Default Profile', placeholder: 'production-browser-profile' },
    ],
    validationHints: ['Use for scalable cloud browser runs when local Playwright sessions are too brittle or resource-heavy.'],
  },
  airtop: {
    provider: 'airtop',
    label: 'Airtop',
    description: 'Cloud browser platform for AI agents that need managed sessions, natural-language browser control, and web automation APIs.',
    capabilityFlags: ['cloud_browser_sessions', 'natural_language_browser_control', 'managed_browser_profiles', 'browser_agent_api'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['profile_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Airtop Browser Agents' },
      { key: 'defaultProfile', label: 'Default Profile', placeholder: 'logged-in-workflow-profile' },
    ],
    validationHints: ['Use for AI-controlled browsing where a managed cloud browser and natural-language actions reduce custom script work.'],
  },
  skyvern: {
    provider: 'skyvern',
    label: 'Skyvern',
    description: 'LLM and computer-vision browser workflow automation for forms, dashboards, authenticated sites, and repeatable operations.',
    capabilityFlags: ['vision_guided_browser_workflows', 'authenticated_site_automation', 'workflow_run_api', 'browser_task_recording'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['base_url', 'organization_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Skyvern Web Ops' },
      { key: 'defaultWorkflowId', label: 'Default Workflow ID', placeholder: 'workflow_xxx' },
    ],
    validationHints: ['Use for structured browser workflows that need vision fallback and repeatable dashboard/form actions.'],
  },
  browser_use: {
    provider: 'browser_use',
    label: 'Browser Use',
    description: 'Open-source browser agent framework for navigating, interpreting, and manipulating web content with LLM-driven tasks.',
    capabilityFlags: ['open_source_browser_agent', 'llm_browser_navigation', 'web_task_execution', 'self_hosted_browser_runner'],
    requiredSecretKeys: [],
    optionalSecretKeys: ['api_key', 'runner_url'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Browser Use Runner' },
      { key: 'defaultModelProvider', label: 'Default Model Provider', placeholder: 'openai or local' },
    ],
    validationHints: ['Use as a self-hostable browser agent layer when you want more control over execution cost and model choice.'],
  },
  aws: {
    provider: 'aws',
    label: 'AWS',
    description: 'Cloud infrastructure, DNS, object storage, CDN, email, and deployment support.',
    capabilityFlags: ['deploy_site', 'manage_dns', 'store_assets', 'send_email', 'manage_infra'],
    requiredSecretKeys: ['access_key_id', 'secret_access_key'],
    optionalSecretKeys: ['region', 'route53_zone_id', 'cloudfront_distribution_id', 's3_bucket', 'ses_from_email'],
    metadataFields: [
      { key: 'accountName', label: 'Account Name', placeholder: 'Production AWS' },
      { key: 'defaultRegion', label: 'Default Region', placeholder: 'us-east-1' },
    ],
  },
  cloudflare: {
    provider: 'cloudflare',
    label: 'Cloudflare',
    description: 'DNS, CDN, caching, security rules, redirects, and migration cutovers.',
    capabilityFlags: ['manage_dns', 'purge_cache', 'manage_edge', 'manage_redirects'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['zone_id', 'account_id'],
    metadataFields: [
      { key: 'zoneName', label: 'Primary Zone', placeholder: 'example.com' },
    ],
  },
  hubspot: {
    provider: 'hubspot',
    label: 'HubSpot',
    description: 'CRM, contacts, deals, pipeline tracking, forms, and lifecycle automation.',
    capabilityFlags: ['read_crm', 'write_crm', 'manage_pipeline', 'sync_contacts', 'track_campaigns'],
    requiredSecretKeys: ['private_app_token'],
    optionalSecretKeys: ['portal_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Growth CRM' },
      { key: 'defaultPipeline', label: 'Default Pipeline', placeholder: 'Sales Pipeline' },
    ],
    validationHints: ['Use a HubSpot private app token with CRM scopes.', 'Set the default pipeline if agents will create or move deals.'],
  },
  google_analytics: {
    provider: 'google_analytics',
    label: 'Google Analytics',
    description: 'GA4 traffic, funnel, conversion, and audience reporting for growth and site analysis.',
    capabilityFlags: ['read_analytics', 'report_growth_metrics', 'analyze_funnels'],
    requiredSecretKeys: ['property_id', 'service_account_json'],
    optionalSecretKeys: ['measurement_id'],
    metadataFields: [
      { key: 'propertyName', label: 'Property Name', placeholder: 'Main Site GA4' },
    ],
    validationHints: ['Use a service account with GA4 property read access.', 'Property ID should be numeric, not the G- measurement id.'],
  },
  google_search_console: {
    provider: 'google_search_console',
    label: 'Google Search Console',
    description: 'Search visibility, indexing health, page performance, and SEO issue tracking.',
    capabilityFlags: ['read_search_console', 'track_indexing', 'monitor_seo_health'],
    requiredSecretKeys: ['site_url', 'service_account_json'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'propertyType', label: 'Property Type', placeholder: 'domain or url-prefix' },
    ],
    validationHints: ['Use the verified property URL or domain exactly as registered in Search Console.'],
  },
  stripe: {
    provider: 'stripe',
    label: 'Stripe',
    description: 'Payments, subscriptions, invoices, checkout, and revenue operations.',
    capabilityFlags: ['manage_payments', 'read_billing', 'manage_subscriptions', 'handle_revenue_ops'],
    requiredSecretKeys: ['secret_key'],
    optionalSecretKeys: ['webhook_secret', 'publishable_key'],
    metadataFields: [
      { key: 'accountName', label: 'Account Name', placeholder: 'Main Stripe Account' },
    ],
    validationHints: ['Use a Stripe secret key from the correct mode.', 'Add webhook secret if agents will reconcile events or billing state.'],
  },
  braintrust: {
    provider: 'braintrust',
    label: 'Braintrust',
    description: 'Evaluation, monitoring, regression testing, and quality scoring for agent systems.',
    capabilityFlags: ['run_agent_evals', 'monitor_agent_quality', 'track_prompt_regressions'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['project_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Agent Quality Workspace' },
    ],
    validationHints: ['Use a workspace API key with eval write access.', 'Set a default project if you want task runs to emit eval traces.'],
  },
  descope: {
    provider: 'descope',
    label: 'Descope',
    description: 'Authentication, SSO, MFA, and identity workflows for apps, users, and agent-safe access.',
    capabilityFlags: ['manage_auth', 'manage_identity', 'manage_sso', 'verify_access'],
    requiredSecretKeys: ['project_id', 'management_key'],
    optionalSecretKeys: ['flow_id'],
    metadataFields: [
      { key: 'environmentName', label: 'Environment Name', placeholder: 'Production Auth' },
    ],
    validationHints: ['Use a management key with admin privileges.', 'Add the primary sign-in flow id if you want agents to reference the correct auth flow.'],
  },
  launchdarkly: {
    provider: 'launchdarkly',
    label: 'LaunchDarkly',
    description: 'Feature flags, guarded rollouts, release controls, and experimentation.',
    capabilityFlags: ['manage_feature_flags', 'manage_rollouts', 'run_experiments'],
    requiredSecretKeys: ['access_token', 'project_key'],
    optionalSecretKeys: ['environment_key'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Main Product Delivery' },
    ],
    validationHints: ['Use an access token with flag and environment management scopes.'],
  },
  algolia: {
    provider: 'algolia',
    label: 'Algolia',
    description: 'User-facing search, indexing, query analytics, and content discovery.',
    capabilityFlags: ['index_search_content', 'query_search', 'manage_search_indices'],
    requiredSecretKeys: ['application_id', 'admin_api_key'],
    optionalSecretKeys: ['search_api_key'],
    metadataFields: [
      { key: 'primaryIndex', label: 'Primary Index', placeholder: 'docs_production' },
    ],
    validationHints: ['Use an admin key for indexing and an optional search-only key for client use.'],
  },
  pinecone: {
    provider: 'pinecone',
    label: 'Pinecone',
    description: 'Vector retrieval, semantic memory search, research indexing, and knowledge retrieval.',
    capabilityFlags: ['vector_retrieval', 'semantic_search', 'store_embeddings'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['index_name', 'host'],
    metadataFields: [
      { key: 'namespace', label: 'Default Namespace', placeholder: 'circle-knowledge' },
    ],
    validationHints: ['Set the index name or host for lower-friction retrieval wiring.', 'Use namespaces to separate app memory, research, and task artifacts.'],
  },
  resend: {
    provider: 'resend',
    label: 'Resend',
    description: 'Transactional email, approvals, notifications, and lifecycle delivery.',
    capabilityFlags: ['send_email', 'send_notifications', 'deliver_approvals'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['from_email', 'audience_id'],
    metadataFields: [
      { key: 'defaultAudience', label: 'Default Audience', placeholder: 'customers' },
    ],
    validationHints: ['Add a verified from_email for operational sends.', 'Use audiences only if the circle will run campaign workflows here.'],
  },
  cloudinary: {
    provider: 'cloudinary',
    label: 'Cloudinary',
    description: 'Media storage, transformation pipelines, and CDN-backed image or video assets.',
    capabilityFlags: ['store_media', 'transform_media', 'deliver_media'],
    requiredSecretKeys: ['cloud_name', 'api_key', 'api_secret'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Main Asset Cloud' },
    ],
    validationHints: ['Use a Cloudinary product environment with upload and asset admin access.'],
  },
  sentry: {
    provider: 'sentry',
    label: 'Sentry',
    description: 'Error tracking, performance monitoring, release visibility, and production issue triage.',
    capabilityFlags: ['read_errors', 'track_performance', 'monitor_releases'],
    requiredSecretKeys: ['auth_token', 'organization_slug', 'project_slug'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'environment', label: 'Environment', placeholder: 'production' },
    ],
    validationHints: ['Use an auth token with project and issue read access.'],
  },
  datadog: {
    provider: 'datadog',
    label: 'Datadog',
    description: 'Logs, traces, metrics, monitors, and infrastructure observability.',
    capabilityFlags: ['read_logs', 'read_metrics', 'manage_monitors', 'monitor_services'],
    requiredSecretKeys: ['api_key', 'application_key'],
    optionalSecretKeys: ['site'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Production Observability' },
    ],
    validationHints: ['Set the Datadog site if you are not using the default US endpoint.'],
  },
  posthog: {
    provider: 'posthog',
    label: 'PostHog',
    description: 'Product analytics, funnels, experiments, feature flags, and product growth insight.',
    capabilityFlags: ['read_product_analytics', 'manage_feature_flags', 'analyze_experiments'],
    requiredSecretKeys: ['project_api_key', 'personal_api_key'],
    optionalSecretKeys: ['host'],
    metadataFields: [
      { key: 'projectName', label: 'Project Name', placeholder: 'Main Product Analytics' },
    ],
    validationHints: ['Provide both project and personal API keys if agents need to configure flags as well as read data.'],
  },
  mux: {
    provider: 'mux',
    label: 'Mux',
    description: 'Video streaming, asset ingestion, playback delivery, and video analytics.',
    capabilityFlags: ['store_video', 'deliver_video', 'analyze_video_usage'],
    requiredSecretKeys: ['token_id', 'token_secret'],
    optionalSecretKeys: ['webhook_secret'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Main Video Platform' },
    ],
    validationHints: ['Use Mux access tokens with video and data access if agents need playback analytics.'],
  },
  vercel: {
    provider: 'vercel',
    label: 'Vercel',
    description: 'Deployments, previews, domains, environment variables, and frontend shipping workflows.',
    capabilityFlags: ['deploy_site', 'manage_domains', 'manage_env_vars', 'read_deployments'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['team_id', 'project_id'],
    metadataFields: [
      { key: 'projectName', label: 'Project Name', placeholder: 'marketing-site' },
    ],
    validationHints: ['Use a Vercel personal or team token with project access.'],
  },
  netlify: {
    provider: 'netlify',
    label: 'Netlify',
    description: 'Site deploys, preview builds, environment settings, and frontend delivery workflows.',
    capabilityFlags: ['deploy_site', 'manage_domains', 'read_deployments'],
    requiredSecretKeys: ['api_token', 'site_id'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'siteName', label: 'Site Name', placeholder: 'main-site' },
    ],
    validationHints: ['Use a Netlify token with site deploy access.'],
  },
  figma: {
    provider: 'figma',
    label: 'Figma',
    description: 'Design files, assets, handoff references, and creative system workflows.',
    capabilityFlags: ['read_design_files', 'read_design_assets', 'support_design_handoff'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['team_id', 'file_key'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Product Design' },
    ],
    validationHints: ['Use a personal or service token with file read access.'],
  },
  notion: {
    provider: 'notion',
    label: 'Notion',
    description: 'Docs, knowledge bases, SOPs, planning systems, and internal operating knowledge.',
    capabilityFlags: ['read_knowledge_docs', 'write_knowledge_docs', 'manage_briefs'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['database_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Operations Wiki' },
    ],
    validationHints: ['Share the relevant workspace or database with the integration token.'],
  },
  mailchimp: {
    provider: 'mailchimp',
    label: 'Mailchimp',
    description: 'Email campaigns, audiences, lifecycle messaging, and campaign reporting.',
    capabilityFlags: ['send_campaigns', 'manage_audiences', 'read_campaign_metrics'],
    requiredSecretKeys: ['api_key', 'server_prefix'],
    optionalSecretKeys: ['audience_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Main Marketing Audience' },
    ],
    validationHints: ['Use the datacenter prefix from your Mailchimp account, like us6.'],
  },
  convertkit: {
    provider: 'convertkit',
    label: 'ConvertKit',
    description: 'Broadcasts, forms, audience funnels, and creator-focused lifecycle messaging.',
    capabilityFlags: ['send_campaigns', 'manage_audiences', 'manage_forms'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['api_secret', 'form_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Creator Funnel' },
    ],
    validationHints: ['Add api_secret if agents need deeper subscriber automation controls.'],
  },
  google_ads: {
    provider: 'google_ads',
    label: 'Google Ads',
    description: 'Paid search campaign reporting, performance analysis, and optimization workflows.',
    capabilityFlags: ['read_ads_metrics', 'manage_ad_campaigns', 'optimize_acquisition'],
    requiredSecretKeys: ['developer_token', 'client_id', 'client_secret', 'refresh_token', 'customer_id'],
    optionalSecretKeys: ['login_customer_id'],
    metadataFields: [
      { key: 'accountName', label: 'Account Name', placeholder: 'Main Ads Account' },
    ],
    validationHints: ['Use OAuth credentials with Google Ads API access and the right customer account IDs.'],
  },
  meta_ads: {
    provider: 'meta_ads',
    label: 'Meta Ads',
    description: 'Paid social campaign reporting, ad set analysis, and audience operations.',
    capabilityFlags: ['read_ads_metrics', 'manage_ad_campaigns', 'optimize_acquisition'],
    requiredSecretKeys: ['access_token', 'ad_account_id'],
    optionalSecretKeys: ['app_id', 'app_secret'],
    metadataFields: [
      { key: 'accountName', label: 'Account Name', placeholder: 'Main Meta Ads Account' },
    ],
    validationHints: ['Use a long-lived access token tied to the correct ad account.'],
  },
  salesforce: {
    provider: 'salesforce',
    label: 'Salesforce',
    description: 'Enterprise CRM, opportunities, accounts, contacts, and pipeline operations.',
    capabilityFlags: ['read_crm', 'write_crm', 'manage_pipeline', 'sync_contacts'],
    requiredSecretKeys: ['client_id', 'client_secret', 'refresh_token', 'instance_url'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Enterprise CRM' },
    ],
    validationHints: ['Use a connected app with API scopes and a refresh token for the right org.'],
  },
  pipedrive: {
    provider: 'pipedrive',
    label: 'Pipedrive',
    description: 'SMB CRM, deals, contacts, sales pipeline tracking, and revenue workflows.',
    capabilityFlags: ['read_crm', 'write_crm', 'manage_pipeline'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Sales Team CRM' },
    ],
    validationHints: ['Use an API token with deal and person access.'],
  },
  shopify: {
    provider: 'shopify',
    label: 'Shopify',
    description: 'Storefront operations, products, orders, revenue, and ecommerce workflows.',
    capabilityFlags: ['read_storefront', 'manage_products', 'manage_orders', 'handle_revenue_ops'],
    requiredSecretKeys: ['shop_domain', 'admin_access_token'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'storeName', label: 'Store Name', placeholder: 'Main Storefront' },
    ],
    validationHints: ['Use an Admin API access token from a custom app.'],
  },
  // ── Wave 1 expansion (DevOps, AI infra, data, project mgmt, etc.) ──
  docker: {
    provider: 'docker',
    label: 'Docker',
    description: 'Container builds, registry pushes, image runs, and Docker Hub workflows for the team.',
    capabilityFlags: ['build_containers', 'push_registry', 'run_containers', 'image_inspection'],
    requiredSecretKeys: ['hub_token'],
    optionalSecretKeys: ['hub_username', 'registry_url'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Team Docker Hub' },
      { key: 'defaultNamespace', label: 'Default Namespace', placeholder: 'orgname' },
    ],
    validationHints: ['Use a Personal Access Token from Docker Hub with read/write scope.', 'Set defaultNamespace so agents push to the right org.'],
  },
  kubernetes: {
    provider: 'kubernetes',
    label: 'Kubernetes',
    description: 'Cluster control via kubeconfig — inspect pods, roll restarts, apply manifests with plan-then-apply guards.',
    capabilityFlags: ['inspect_cluster', 'roll_workloads', 'apply_manifests_guarded', 'fetch_logs'],
    requiredSecretKeys: ['kubeconfig'],
    optionalSecretKeys: ['service_account_token'],
    metadataFields: [
      { key: 'clusterName', label: 'Cluster Name', placeholder: 'production-eu-west' },
      { key: 'defaultNamespace', label: 'Default Namespace', placeholder: 'default' },
    ],
    validationHints: ['Paste a base64 kubeconfig OR use a service account token.', 'Default to plan-then-apply for safety; only auto-apply for non-prod namespaces.'],
  },
  fly_io: {
    provider: 'fly_io',
    label: 'Fly.io',
    description: 'Edge VMs, Fly Postgres, and branch previews. Deploy a branch, scale machines, stream logs.',
    capabilityFlags: ['deploy_branch_preview', 'manage_machines', 'manage_postgres', 'stream_logs'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['default_org', 'default_app'],
    metadataFields: [
      { key: 'orgSlug', label: 'Org Slug', placeholder: 'personal' },
    ],
    validationHints: ['Run `fly auth token` to get a token.', 'Pin a default org so agents do not deploy across orgs.'],
  },
  railway: {
    provider: 'railway',
    label: 'Railway',
    description: 'Git-push PaaS with managed databases — provision Postgres + Redis and wire env vars in one shot.',
    capabilityFlags: ['provision_services', 'manage_env_vars', 'deploy_branches', 'manage_databases'],
    requiredSecretKeys: ['project_token'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'projectName', label: 'Project Name', placeholder: 'side-project' },
      { key: 'environmentName', label: 'Environment Name', placeholder: 'production' },
    ],
    validationHints: ['Use a project token (not a personal token) so the agent stays scoped.'],
  },
  render: {
    provider: 'render',
    label: 'Render',
    description: 'Web services, cron jobs, and managed databases. Trigger deploys, tail logs, and manage cron from chat.',
    capabilityFlags: ['trigger_deploys', 'manage_services', 'tail_logs', 'manage_cron_jobs'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['default_owner_id'],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Render Workspace' },
    ],
    validationHints: ['API key with full scope; restrict to specific services in production.'],
  },
  digitalocean: {
    provider: 'digitalocean',
    label: 'DigitalOcean',
    description: 'Droplets, App Platform, Managed DBs, and Spaces object storage for cost-conscious side projects.',
    capabilityFlags: ['manage_droplets', 'manage_app_platform', 'manage_managed_dbs', 'manage_spaces_storage'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['spaces_access_key', 'spaces_secret_key'],
    metadataFields: [
      { key: 'defaultRegion', label: 'Default Region', placeholder: 'nyc3' },
      { key: 'spacesEndpoint', label: 'Spaces Endpoint', placeholder: 'nyc3.digitaloceanspaces.com' },
    ],
    validationHints: ['Personal Access Token with read+write scope.', 'Spaces keys are optional — only needed if storing artifacts there.'],
  },
  supabase: {
    provider: 'supabase',
    label: 'Supabase',
    description: 'Postgres + auth + storage + realtime. Run SQL, manage RLS, read storage, query realtime channels.',
    capabilityFlags: ['run_sql', 'manage_rls_policies', 'manage_storage_buckets', 'read_realtime_channels', 'manage_auth_users'],
    requiredSecretKeys: ['project_url', 'service_role_key'],
    optionalSecretKeys: ['anon_key'],
    metadataFields: [
      { key: 'projectRef', label: 'Project Ref', placeholder: 'abcdefghijk' },
    ],
    validationHints: ['Service role key bypasses RLS — only paste it if you trust agents to mutate this DB.', 'Use the anon key for read-only mirroring.'],
  },
  neon: {
    provider: 'neon',
    label: 'Neon',
    description: 'Serverless Postgres with branching. Branch the prod DB for a PR, run migrations, drop on merge.',
    capabilityFlags: ['branch_database', 'run_migrations', 'manage_branches', 'manage_compute_endpoints'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['project_id'],
    metadataFields: [
      { key: 'defaultBranch', label: 'Default Branch', placeholder: 'main' },
    ],
    validationHints: ['Pin the project_id so agents only branch the intended DB.', 'Auto-drop branches on PR close to keep cost flat.'],
  },
  mongodb_atlas: {
    provider: 'mongodb_atlas',
    label: 'MongoDB Atlas',
    description: 'Managed MongoDB. Query collections, check index health, and run aggregations on demand.',
    capabilityFlags: ['query_collections', 'manage_indexes', 'run_aggregations', 'manage_clusters'],
    requiredSecretKeys: ['public_api_key', 'private_api_key'],
    optionalSecretKeys: ['org_id', 'project_id'],
    metadataFields: [
      { key: 'clusterName', label: 'Cluster Name', placeholder: 'production-cluster' },
    ],
    validationHints: ['Use Atlas Admin API key pair from Programmatic API Keys.'],
  },
  upstash: {
    provider: 'upstash',
    label: 'Upstash',
    description: 'Serverless Redis, Kafka, and Vector. Read/write cache, inspect queue depth, run vector queries.',
    capabilityFlags: ['redis_cache_ops', 'kafka_topic_ops', 'vector_queries', 'pubsub_ops'],
    requiredSecretKeys: ['rest_url', 'rest_token'],
    optionalSecretKeys: ['kafka_url', 'kafka_token'],
    metadataFields: [
      { key: 'defaultDatabase', label: 'Default Database', placeholder: 'cache-prod' },
    ],
    validationHints: ['REST URL + token from the Upstash console — supports Redis, Kafka, and Vector with one credential format.'],
  },
  hugging_face: {
    provider: 'hugging_face',
    label: 'Hugging Face',
    description: 'Models, datasets, Spaces, Inference Endpoints. Pull a model card and deploy it as an endpoint.',
    capabilityFlags: ['model_search', 'dataset_access', 'inference_endpoint', 'spaces_management'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultOrg', label: 'Default Org', placeholder: 'your-org' },
      // Paste a dedicated Inference Endpoint URL (the
      // `https://*.endpoints.huggingface.cloud` one HF gives you when
      // you spin up a paid endpoint at ui.endpoints.huggingface.co).
      // When set, the chat picker surfaces a `BlackSwan v5 (Endpoint)`
      // option that routes through this URL — instant responses
      // instead of the public Inference API's ~30s cold start.
      { key: 'blackswan_endpoint_url', label: 'BlackSwan Endpoint URL (optional)', placeholder: 'https://abc123.us-east-1.aws.endpoints.huggingface.cloud' },
    ],
    validationHints: ['Use a User Access Token with read scope; bump to write only if deploying endpoints from chat.'],
  },
  replicate: {
    provider: 'replicate',
    label: 'Replicate',
    description: 'Hosted model inference, especially generative. Run image / video / audio models from prompts.',
    capabilityFlags: ['run_models', 'image_generation', 'video_generation', 'model_versioning'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'black-forest-labs/flux-schnell' },
    ],
    validationHints: ['API tokens scope per-account. Pin a default model so agents converge fast.'],
  },
  modal: {
    provider: 'modal',
    label: 'Modal',
    description: 'Serverless Python on GPU/CPU. Ship a function and call it from agent runs without managing infra.',
    capabilityFlags: ['serverless_python', 'gpu_jobs', 'scheduled_functions', 'web_endpoints'],
    requiredSecretKeys: ['token_id', 'token_secret'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'agent-jobs' },
    ],
    validationHints: ['Get token_id + token_secret from `modal token new`.'],
  },
  openrouter: {
    provider: 'openrouter',
    label: 'OpenRouter',
    description: '100+ LLMs through one API. A/B prompts across Claude, GPT, Gemini, and OSS models in one call.',
    capabilityFlags: ['unified_llm_router', 'multi_model_ab', 'fallback_routing', 'cost_routing'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'anthropic/claude-sonnet-4' },
    ],
    validationHints: ['Set a default_model so the agent has a safe fallback when route resolution is ambiguous.'],
  },
  linear: {
    provider: 'linear',
    label: 'Linear',
    description: 'Issue tracker for modern dev teams. Create issues from chat and update status when a PR merges.',
    capabilityFlags: ['create_issues', 'update_issues', 'query_cycles', 'manage_projects'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'teamKey', label: 'Default Team Key', placeholder: 'ENG' },
    ],
    validationHints: ['Personal API key from Linear Settings → API. Pin teamKey so issues land in the right team.'],
  },
  jira: {
    provider: 'jira',
    label: 'Jira',
    description: 'Sprint and issue management for larger teams. Pull sprint state and surface blockers in chat.',
    capabilityFlags: ['create_issues', 'update_issues', 'query_sprints', 'manage_boards'],
    requiredSecretKeys: ['api_token', 'email', 'site_url'],
    optionalSecretKeys: ['default_project_key'],
    metadataFields: [
      { key: 'defaultProjectKey', label: 'Default Project Key', placeholder: 'PROJ' },
    ],
    validationHints: ['Generate api_token from id.atlassian.com/manage-profile/security/api-tokens.', 'site_url like https://yourorg.atlassian.net.'],
  },
  snyk: {
    provider: 'snyk',
    label: 'Snyk',
    description: 'Vulnerability scanning for code, deps, containers, and IaC. Triage CVEs and open fix PRs.',
    capabilityFlags: ['scan_dependencies', 'scan_containers', 'scan_iac', 'open_fix_prs'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: ['org_id'],
    metadataFields: [
      { key: 'defaultOrgSlug', label: 'Default Org Slug', placeholder: 'your-team' },
    ],
    validationHints: ['Get api_token from Snyk Account Settings → General.'],
  },
  clerk: {
    provider: 'clerk',
    label: 'Clerk',
    description: 'Drop-in auth UI. Provision test users with specific roles for E2E tests; read session state.',
    capabilityFlags: ['provision_users', 'read_sessions', 'manage_organizations', 'audit_users'],
    requiredSecretKeys: ['secret_key'],
    optionalSecretKeys: ['publishable_key', 'frontend_api_url'],
    metadataFields: [
      { key: 'instanceName', label: 'Instance Name', placeholder: 'production' },
    ],
    validationHints: ['Use the Backend API Secret Key (sk_live_… or sk_test_…).'],
  },
  postmark: {
    provider: 'postmark',
    label: 'Postmark',
    description: 'Transactional email known for deliverability. Send tests and inspect bounce reasons from agent runs.',
    capabilityFlags: ['send_transactional_email', 'inspect_bounces', 'manage_templates', 'manage_servers'],
    requiredSecretKeys: ['server_token'],
    optionalSecretKeys: ['account_token'],
    metadataFields: [
      { key: 'fromAddress', label: 'Default From Address', placeholder: 'team@yourdomain.com' },
    ],
    validationHints: ['Server tokens are per-server; account tokens are for cross-server admin.'],
  },
  cloudflare_r2: {
    provider: 'cloudflare_r2',
    label: 'Cloudflare R2',
    description: 'S3-compatible object storage with no egress fees. Store agent artifacts cheaply, serve via Workers.',
    capabilityFlags: ['object_storage', 'presign_urls', 'list_objects', 'lifecycle_rules'],
    requiredSecretKeys: ['account_id', 'access_key_id', 'secret_access_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultBucket', label: 'Default Bucket', placeholder: 'circle-artifacts' },
      { key: 'publicEndpoint', label: 'Public Endpoint', placeholder: 'https://artifacts.example.com' },
    ],
    validationHints: ['Create R2 API tokens from Cloudflare dashboard → R2 → Manage API Tokens.'],
  },
  qdrant: {
    provider: 'qdrant',
    label: 'Qdrant',
    description: 'Rust-based vector DB with strong filter performance. Store agent memories with rich metadata filters.',
    capabilityFlags: ['vector_store', 'metadata_filters', 'collection_management', 'hybrid_search'],
    requiredSecretKeys: ['api_key', 'cluster_url'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultCollection', label: 'Default Collection', placeholder: 'circle-memory' },
    ],
    validationHints: ['Use Qdrant Cloud API key + cluster URL, or self-hosted URL with no key.'],
  },
  ngrok: {
    provider: 'ngrok',
    label: 'ngrok',
    description: 'Public tunnels for local dev and webhooks. Expose a local agent endpoint to receive a webhook.',
    capabilityFlags: ['public_tunnels', 'webhook_intake', 'tcp_tunnels', 'reserved_domains'],
    requiredSecretKeys: ['authtoken'],
    optionalSecretKeys: ['reserved_domain'],
    metadataFields: [
      { key: 'defaultRegion', label: 'Default Region', placeholder: 'us' },
    ],
    validationHints: ['Get authtoken from ngrok dashboard → Auth → Your Authtoken.'],
  },
  trigger_dev: {
    provider: 'trigger_dev',
    label: 'Trigger.dev',
    description: 'Background jobs purpose-built for AI workflows. Enqueue durable agent jobs that survive restarts.',
    capabilityFlags: ['durable_jobs', 'webhooks', 'scheduled_jobs', 'job_chains'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'projectRef', label: 'Project Ref', placeholder: 'proj_abcdef' },
    ],
    validationHints: ['Trigger.dev v3 API key — use the personal access token for full project scope.'],
  },
  // ── Wave 2: native LLM providers (BYOK) ──
  anthropic: {
    provider: 'anthropic',
    label: 'Anthropic',
    description: 'Claude Opus / Sonnet / Haiku direct from Anthropic. Use your own key to bill against your Anthropic account instead of the platform.',
    capabilityFlags: ['claude_chat', 'tool_use', 'extended_thinking', 'prompt_caching'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'claude-sonnet-4-6' },
    ],
    validationHints: ['Get the key from https://console.anthropic.com/settings/keys. Scope: full account.'],
  },
  openai: {
    provider: 'openai',
    label: 'OpenAI',
    description: 'GPT-5 / GPT-4o / o-series reasoning models direct from OpenAI. BYOK so requests bill against your OpenAI account.',
    capabilityFlags: ['gpt_chat', 'function_calling', 'vision', 'reasoning_models'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['organization_id'],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'gpt-5' },
    ],
    validationHints: ['Get the key from https://platform.openai.com/api-keys. Set organization_id if you belong to multiple orgs.'],
  },
  openai_compatible: {
    provider: 'openai_compatible',
    label: 'Business Models',
    description: 'Private or self-hosted OpenAI-compatible model endpoints for company-specific task, browser, and desktop agents.',
    capabilityFlags: ['openai_compatible_chat', 'private_model_endpoint', 'function_calling', 'agent_routing'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: ['endpoint_url'],
    metadataFields: [
      { key: 'endpoint_url', label: 'Endpoint URL', placeholder: 'https://models.company.com/v1 or /v1/chat/completions' },
      { key: 'defaultModel', label: 'Default Model', placeholder: 'company-agent' },
    ],
    validationHints: ['Use any endpoint that accepts OpenAI Chat Completions request/response shape. Store this per user so usage bills to the business account.'],
  },
  google_ai: {
    provider: 'google_ai',
    label: 'Google AI',
    description: 'Gemini 2.5 Pro / Flash via Google AI Studio. Long-context and multimodal directly from Google.',
    capabilityFlags: ['gemini_chat', 'multimodal', 'long_context', 'function_calling'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'gemini-2.5-pro' },
    ],
    validationHints: ['Generate an API key at https://aistudio.google.com/apikey. No project setup needed.'],
  },
  groq: {
    provider: 'groq',
    label: 'Groq',
    description: 'Ultra-fast Llama / Mixtral inference on LPU hardware. Sub-second latency for chat-heavy workloads.',
    capabilityFlags: ['llama_chat', 'mixtral_chat', 'fast_inference', 'function_calling'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'llama-3.3-70b-versatile' },
    ],
    validationHints: ['Create a key at https://console.groq.com/keys. Free tier covers light usage.'],
  },
  mistral_ai: {
    provider: 'mistral_ai',
    label: 'Mistral AI',
    description: 'Mistral Large / Codestral / Pixtral direct from Mistral. Strong Europe-hosted alternative for code + chat.',
    capabilityFlags: ['mistral_chat', 'codestral', 'pixtral_vision', 'function_calling'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'mistral-large-latest' },
    ],
    validationHints: ['Get a key at https://console.mistral.ai/api-keys. Pay-as-you-go billing.'],
  },
  cohere: {
    provider: 'cohere',
    label: 'Cohere',
    description: 'Command R+ chat + Embed v3 + Rerank. Strong for retrieval-augmented agents and enterprise use cases.',
    capabilityFlags: ['command_chat', 'embeddings', 'rerank', 'function_calling'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'command-r-plus' },
    ],
    validationHints: ['Generate a key at https://dashboard.cohere.com/api-keys. Production keys are separate from trial keys.'],
  },
  perplexity: {
    provider: 'perplexity',
    label: 'Perplexity',
    description: 'Sonar models with built-in web search. Citations come back inline so chat can ground answers in live sources.',
    capabilityFlags: ['sonar_chat', 'web_search', 'citations', 'real_time_data'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'sonar-pro' },
    ],
    validationHints: ['Get a key at https://www.perplexity.ai/settings/api. $5 free credit on signup.'],
  },
  together_ai: {
    provider: 'together_ai',
    label: 'Together AI',
    description: 'OSS frontier models (Llama, Qwen, DeepSeek) on managed inference. Cheap and fast for high-volume chat.',
    capabilityFlags: ['llama_chat', 'qwen_chat', 'deepseek_chat', 'oss_hosting'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
    ],
    validationHints: ['Generate a key at https://api.together.xyz/settings/api-keys.'],
  },
  fireworks_ai: {
    provider: 'fireworks_ai',
    label: 'Fireworks AI',
    description: 'Production OSS inference with FireFunction tool calling. Optimised for low-latency function-call agents.',
    capabilityFlags: ['firefunction', 'oss_hosting', 'tool_calling', 'fast_inference'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'accounts/fireworks/models/firefunction-v2' },
    ],
    validationHints: ['Create a key at https://fireworks.ai/account/api-keys.'],
  },
  deepseek: {
    provider: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek R1 reasoning + V3 chat. Strong reasoning at OSS prices, ideal for code review and planning.',
    capabilityFlags: ['deepseek_chat', 'deepseek_reasoner', 'function_calling', 'long_context'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'deepseek-chat' },
    ],
    validationHints: ['Get a key at https://platform.deepseek.com/api_keys.'],
  },
  z_ai: {
    provider: 'z_ai',
    label: 'Z.AI / GLM',
    description: 'GLM-4 / GLM-4.5 chat from Zhipu / Z.AI. Multilingual coverage and strong on reasoning benchmarks.',
    capabilityFlags: ['glm_chat', 'multilingual', 'function_calling', 'long_context'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'glm-4-plus' },
    ],
    validationHints: ['Generate a key at https://open.bigmodel.cn/usercenter/apikeys.'],
  },
  minimax: {
    provider: 'minimax',
    label: 'MiniMax',
    description: 'MiniMax-Text + Speech 2.5. Long-context chat with strong Chinese / multilingual coverage.',
    capabilityFlags: ['minimax_chat', 'speech', 'multilingual', 'long_context'],
    requiredSecretKeys: ['api_key'],
    optionalSecretKeys: [],
    metadataFields: [
      { key: 'defaultModel', label: 'Default Model', placeholder: 'MiniMax-Text-01' },
    ],
    validationHints: ['Get a key at https://www.minimaxi.com/platform/account/keys.'],
  },
  ollama: {
    provider: 'ollama',
    label: 'Ollama (Local)',
    description: 'Run open models locally — Llama, Qwen, DeepSeek. Point at the Ollama URL on your machine; no cloud API key required.',
    capabilityFlags: ['local_models', 'oss_hosting', 'no_cloud'],
    requiredSecretKeys: [],
    optionalSecretKeys: ['api_key'],
    metadataFields: [
      { key: 'baseUrl', label: 'Base URL', placeholder: 'http://localhost:11434' },
      { key: 'defaultModel', label: 'Default Model', placeholder: 'llama3.3' },
    ],
    validationHints: ['Run `ollama serve` on the same network. The chat will hit baseUrl + /v1/chat/completions (Ollama exposes an OpenAI-compatible endpoint).'],
  },
  blackswan: {
    provider: 'blackswan',
    label: 'BlackSwan',
    description: 'Our circle\'s custom-trained Qwen3.5-4B fine-tune, hosted on a dedicated Hugging Face Inference Endpoint. Refreshes weekly from app data. Connect once and every member of the circle can chat with it.',
    capabilityFlags: ['custom_model', 'fine_tuned', 'inference_endpoint', 'team_shared'],
    requiredSecretKeys: ['api_token'],
    optionalSecretKeys: [],
    metadataFields: [
      // The dedicated HF Inference Endpoint URL — the
      // `https://*.endpoints.huggingface.cloud` one HF gives you when
      // you spin up an Endpoint at ui.endpoints.huggingface.co.
      // Paste it once and every member of the circle can chat with
      // BlackSwan; they don't each need to set up their own HF integration.
      { key: 'endpoint_url', label: 'Inference Endpoint URL', placeholder: 'https://abc123.us-east-1.aws.endpoints.huggingface.cloud' },
      // Lets us swap the served model later without changing client
      // code — defaults to cswan801/BlackSwan-v5.
      { key: 'model_id', label: 'Model ID', placeholder: 'cswan801/BlackSwan-v5' },
    ],
    validationHints: [
      'Endpoint URL is the host HF assigns when you create the Endpoint — it\'s on the detail page in ui.endpoints.huggingface.co.',
      'API token is your HF user access token (Read scope is enough for inference; Write only if the same token also pushes weights from the trainer).',
    ],
  },
};

function encodeSecret(value: string): string {
  try {
    return btoa(unescape(encodeURIComponent(value)));
  } catch {
    return btoa(value);
  }
}

function decodeSecret(value: string): string {
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    try {
      return atob(value);
    } catch {
      return value;
    }
  }
}

export async function listCircleIntegrations(circleId: string): Promise<CircleIntegrationRecord[]> {
  const { data, error } = await supabase
    .from('circle_integrations')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[circleIntegrations] list error:', error);
    return [];
  }
  return (data || []) as CircleIntegrationRecord[];
}

export async function getCircleIntegration(
  circleId: string,
  provider: CircleIntegrationProvider,
): Promise<CircleIntegrationRecord | null> {
  const { data, error } = await supabase
    .from('circle_integrations')
    .select('*')
    .eq('circle_id', circleId)
    .eq('provider', provider)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[circleIntegrations] get error:', error);
    return null;
  }
  return (data || null) as CircleIntegrationRecord | null;
}

export async function upsertCircleIntegration(opts: {
  circleId: string;
  provider: CircleIntegrationProvider;
  label?: string;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  capabilityFlags?: string[];
  status?: CircleIntegrationRecord['status'];
}): Promise<CircleIntegrationRecord | null> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return null;

    const existing = await getCircleIntegration(opts.circleId, opts.provider);
    const mergedMetadata = {
      ...(existing?.metadata || {}),
      ...(opts.metadata || {}),
    };

    const { data, error } = await supabase
      .from('circle_integrations')
      .upsert({
        circle_id: opts.circleId,
        provider: opts.provider,
        label: opts.label || 'default',
        status: opts.status || 'connected',
        connection_scope: 'circle',
        display_name: opts.displayName || null,
        description: opts.description || null,
        metadata: mergedMetadata,
        capability_flags: opts.capabilityFlags || [],
        installed_by: existing?.installed_by || userId,
        is_active: true,
      }, { onConflict: 'circle_id,provider,label' })
      .select('*')
      .single();

    if (error) {
      console.error('[circleIntegrations] upsert error:', error);
      return null;
    }

    return data as CircleIntegrationRecord;
  } catch (err) {
    console.error('[circleIntegrations] upsert exception:', err);
    return null;
  }
}

export async function saveCircleIntegrationSecrets(opts: {
  integrationId: string;
  secrets: Record<string, string>;
}): Promise<boolean> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return false;

    const rows = Object.entries(opts.secrets)
      .filter(([, value]) => value.trim().length > 0)
      .map(([key, value]) => ({
        integration_id: opts.integrationId,
        key,
        value_encrypted: encodeSecret(value),
        created_by: userId,
      }));

    if (rows.length === 0) return true;

    const { error } = await supabase
      .from('circle_integration_secrets')
      .upsert(rows, { onConflict: 'integration_id,key' });

    if (error) {
      console.error('[circleIntegrations] save secrets error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[circleIntegrations] save secrets exception:', err);
    return false;
  }
}

export async function listCircleIntegrationSecretKeys(integrationId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('circle_integration_secrets')
    .select('key')
    .eq('integration_id', integrationId)
    .order('key');

  if (error) {
    console.error('[circleIntegrations] secret key list error:', error);
    return [];
  }

  return (data || []).map((row: { key: string }) => row.key);
}

export async function getCircleIntegrationSecretValues(integrationId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('circle_integration_secrets')
    .select('key, value_encrypted')
    .eq('integration_id', integrationId);

  if (error) {
    console.error('[circleIntegrations] secret value load error:', error);
    return {};
  }

  const out: Record<string, string> = {};
  for (const row of (data || []) as Array<{ key: string; value_encrypted: string }>) {
    out[row.key] = decodeSecret(row.value_encrypted);
  }
  return out;
}

export async function getInstalledIntegrationProviders(circleId: string): Promise<CircleIntegrationProvider[]> {
  const integrations = await listCircleIntegrations(circleId);
  return integrations
    .filter(isIntegrationUsableForCapability)
    .map(item => item.provider);
}

export async function getCircleIntegrationCapabilities(circleId: string): Promise<string[]> {
  const integrations = await listCircleIntegrations(circleId);
  return Array.from(new Set(
    integrations
      .filter(isIntegrationUsableForCapability)
      .flatMap(item => item.capability_flags || []),
  ));
}

function isIntegrationUsableForCapability(item: Pick<CircleIntegrationRecord, 'provider' | 'status' | 'is_active'>): boolean {
  if (item.is_active === false || item.status === 'disabled') return false;
  if (item.provider === 'custom_api') return item.status === 'connected';
  return true;
}

const CONNECTOR_PROVIDER_ALIASES: Record<string, CircleIntegrationProvider[]> = {
  wordpress: ['wordpress'],
  github: ['github'],
  slack: ['slack'],
  teams: ['teams'],
  discord: ['discord'],
  helius: ['helius'],
  aws: ['aws'],
  cloudflare: ['cloudflare'],
  hubspot: ['hubspot'],
  analytics: ['google_analytics'],
  'google-analytics': ['google_analytics'],
  search_console: ['google_search_console'],
  'google-search-console': ['google_search_console'],
  stripe: ['stripe'],
  vercel: ['vercel'],
  netlify: ['netlify'],
  browserbase: ['browserbase'],
  stagehand: ['stagehand'],
  playwright: ['playwright_mcp'],
  playwright_mcp: ['playwright_mcp'],
  'playwright-mcp': ['playwright_mcp'],
  browserless: ['browserless'],
  browserstack: ['browserstack'],
  firecrawl: ['firecrawl'],
  brave: ['brave'],
  'brave-search': ['brave'],
  search: ['brave'],
  web_search: ['brave'],
  'web-search': ['brave'],
  apify: ['apify'],
  steel: ['steel'],
  hyperbrowser: ['hyperbrowser'],
  airtop: ['airtop'],
  skyvern: ['skyvern'],
  browser_use: ['browser_use'],
  'browser-use': ['browser_use'],
  browseruse: ['browser_use'],
  braintrust: ['braintrust'],
  descope: ['descope'],
  launchdarkly: ['launchdarkly'],
  algolia: ['algolia'],
  pinecone: ['pinecone'],
  resend: ['resend'],
  cloudinary: ['cloudinary'],
  sentry: ['sentry'],
  datadog: ['datadog'],
  posthog: ['posthog'],
  mux: ['mux'],
  figma: ['figma'],
  notion: ['notion'],
  shopify: ['shopify'],
  mailchimp: ['mailchimp'],
  convertkit: ['convertkit'],
  salesforce: ['salesforce'],
  pipedrive: ['pipedrive'],
  'google-ads': ['google_ads'],
  'meta-ads': ['meta_ads'],
  google_ads: ['google_ads'],
  meta_ads: ['meta_ads'],
  api: ['custom_api'],
  custom_api: ['custom_api'],
  'custom-api': ['custom_api'],
  http_api: ['custom_api'],
  'http-api': ['custom_api'],
  rest_api: ['custom_api'],
  'rest-api': ['custom_api'],
  webhook: ['custom_api'],
  endpoint: ['custom_api'],
};

export async function getMissingConnectorRequirements(
  circleId: string,
  connectorRequirements: string[],
): Promise<string[]> {
  const installed = new Set(await getInstalledIntegrationProviders(circleId));
  return connectorRequirements.filter(req => {
    const mapped = CONNECTOR_PROVIDER_ALIASES[req] || [];
    if (mapped.length === 0) return !installed.has(req as CircleIntegrationProvider);
    return !mapped.some(provider => installed.has(provider));
  });
}

export async function buildCircleCapabilityPreflight(opts: {
  circleId: string;
  requiredCapabilities?: string[];
  requiredConnectors?: string[];
}): Promise<{
  ok: boolean;
  missingCapabilities: string[];
  missingConnectors: string[];
}> {
  const [capabilities, missingConnectors] = await Promise.all([
    getCircleIntegrationCapabilities(opts.circleId),
    getMissingConnectorRequirements(opts.circleId, opts.requiredConnectors || []),
  ]);
  const capabilitySet = new Set(capabilities);
  const missingCapabilities = (opts.requiredCapabilities || []).filter(cap => !capabilitySet.has(cap));
  return {
    ok: missingCapabilities.length === 0 && missingConnectors.length === 0,
    missingCapabilities,
    missingConnectors,
  };
}

export type CircleOwnershipReadiness = {
  level: 'full' | 'assisted' | 'blocked';
  headline: string;
  detail: string;
};

export function classifyCircleOwnershipReadiness(preflight: {
  ok: boolean;
  missingCapabilities: string[];
  missingConnectors: string[];
}): CircleOwnershipReadiness {
  if (preflight.ok) {
    return {
      level: 'full',
      headline: 'Ready for full ownership',
      detail: 'The circle has the required integrations and capabilities for end-to-end execution.',
    };
  }

  if (preflight.missingConnectors.length > 0) {
    return {
      level: 'blocked',
      headline: 'Blocked from full ownership',
      detail: `Missing connector installs: ${preflight.missingConnectors.join(', ')}.`,
    };
  }

  return {
    level: 'assisted',
    headline: 'Needs assisted ownership',
    detail: `Installed systems exist, but key capabilities are still missing: ${preflight.missingCapabilities.join(', ')}.`,
  };
}

export async function buildTaskOwnershipClaim(opts: {
  circleId: string;
  title: string;
  description?: string;
  profileKey?: string;
}): Promise<{
  requiredConnectors: string[];
  requiredCapabilities: string[];
  missingConnectors: string[];
  missingCapabilities: string[];
  ownership: CircleOwnershipReadiness;
}> {
  const requirements = inferTaskIntegrationRequirements({
    title: opts.title,
    description: opts.description,
    profileKey: opts.profileKey,
  });
  const preflight = await buildCircleCapabilityPreflight({
    circleId: opts.circleId,
    requiredCapabilities: requirements.requiredCapabilities,
    requiredConnectors: requirements.requiredConnectors,
  });
  return {
    requiredConnectors: requirements.requiredConnectors,
    requiredCapabilities: requirements.requiredCapabilities,
    missingConnectors: preflight.missingConnectors,
    missingCapabilities: preflight.missingCapabilities,
    ownership: classifyCircleOwnershipReadiness(preflight),
  };
}

export async function validateCircleIntegrationSetup(
  integration: CircleIntegrationRecord,
): Promise<{
  ok: boolean;
  missingSecretKeys: string[];
  missingMetadataFields: string[];
  providerWarnings: string[];
}> {
  const definition = INTEGRATION_DEFINITIONS[integration.provider];
  if (!definition) {
    return { ok: true, missingSecretKeys: [], missingMetadataFields: [], providerWarnings: [] };
  }

  const secretKeys = await listCircleIntegrationSecretKeys(integration.id);
  const secretSet = new Set(secretKeys);
  const metadata = integration.metadata || {};
  const missingSecretKeys = definition.requiredSecretKeys.filter(key => !secretSet.has(key));
  const missingMetadataFields = (definition.metadataFields || [])
    .filter(field => field.required !== false)
    .map(field => field.key)
    .filter(key => !String(metadata[key] || '').trim());
  const providerWarnings = getProviderSpecificIntegrationWarnings(integration);

  return {
    ok: missingSecretKeys.length === 0 && missingMetadataFields.length === 0 && providerWarnings.length === 0,
    missingSecretKeys,
    missingMetadataFields,
    providerWarnings,
  };
}

export function getProviderSpecificIntegrationWarnings(
  integration: Pick<CircleIntegrationRecord, 'provider' | 'metadata'>,
): string[] {
  const metadata = integration.metadata || {};
  const read = (key: string) => String(metadata[key] || '').trim();
  const warnings: string[] = [];

  switch (integration.provider) {
    case 'aws': {
      const region = read('defaultRegion');
      if (region && !/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
        warnings.push('Default region should look like us-east-1.');
      }
      break;
    }
    case 'cloudflare': {
      const zoneName = read('zoneName');
      if (zoneName && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(zoneName)) {
        warnings.push('Primary zone should be a valid hostname like example.com.');
      }
      break;
    }
    case 'hubspot': {
      const pipeline = read('defaultPipeline');
      if (!pipeline) {
        warnings.push('Set a default pipeline if agents will create or move deals.');
      }
      break;
    }
    case 'google_analytics': {
      const propertyName = read('propertyName');
      if (!propertyName) {
        warnings.push('Name the GA4 property so reporting surfaces can identify it clearly.');
      }
      break;
    }
    case 'google_search_console': {
      const propertyType = read('propertyType');
      if (propertyType && !/^(domain|url-prefix)$/i.test(propertyType)) {
        warnings.push('Property type should be domain or url-prefix.');
      }
      break;
    }
    case 'stripe': {
      const accountName = read('accountName');
      if (!accountName) {
        warnings.push('Name the Stripe account so billing workflows can target the right environment.');
      }
      break;
    }
    case 'browserbase': {
      // Browserbase only needs api_key + project_id for the live computer-use
      // path. workspaceName is a dashboard label, not a functional blocker.
      break;
    }
    case 'stagehand': {
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set a workspace name so browser-agent recipes stay tied to the right project context.');
      }
      break;
    }
    case 'playwright_mcp': {
      const workspaceName = read('workspaceName');
      const defaultBrowser = read('defaultBrowser');
      if (!workspaceName) {
        warnings.push('Set a workspace name so local MCP browser control is identifiable.');
      }
      if (defaultBrowser && !/^(chromium|chrome|firefox|webkit|msedge)$/i.test(defaultBrowser)) {
        warnings.push('Default browser should be chromium, chrome, firefox, webkit, or msedge.');
      }
      break;
    }
    case 'browserless':
    case 'browserstack':
    case 'firecrawl':
    case 'apify':
    case 'steel':
    case 'hyperbrowser':
    case 'airtop':
    case 'skyvern':
    case 'browser_use': {
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set a workspace name so browser and web-data actions target the correct account context.');
      }
      break;
    }
    case 'custom_api': {
      const baseUrl = read('baseUrl');
      const defaultMethod = read('defaultMethod');
      const allowedMethods = read('allowedMethods');
      if (baseUrl && !/^https:\/\/[^\s/$.?#].[^\s]*$/i.test(baseUrl)) {
        warnings.push('Base URL should be a full HTTPS URL like https://api.example.com.');
      }
      if (defaultMethod && !/^(GET|POST|PUT|PATCH|DELETE)$/i.test(defaultMethod)) {
        warnings.push('Default method should be GET, POST, PUT, PATCH, or DELETE.');
      }
      if (allowedMethods && !allowedMethods.split(',').every(method => /^(GET|POST|PUT|PATCH|DELETE)$/i.test(method.trim()))) {
        warnings.push('Allowed methods should be a comma-separated list of GET, POST, PUT, PATCH, or DELETE.');
      }
      const authScheme = read('authScheme');
      if (authScheme && !/^(bearer|x-api-key|basic|none)$/i.test(authScheme)) {
        warnings.push('Auth scheme should be bearer, x-api-key, basic, or none.');
      }
      const apiKeyHeaderName = read('apiKeyHeaderName');
      if (apiKeyHeaderName && !/^[A-Za-z0-9-]{1,64}$/.test(apiKeyHeaderName)) {
        warnings.push('API key header name should use only letters, numbers, and hyphens.');
      }
      break;
    }
    case 'launchdarkly': {
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set a workspace name so release controls and experiments stay tied to the right product context.');
      }
      break;
    }
    case 'braintrust': {
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set a workspace name so eval traces can be routed correctly.');
      }
      break;
    }
    case 'posthog': {
      const projectName = read('projectName');
      if (!projectName) {
        warnings.push('Set a project name so product analytics stays identifiable in reports.');
      }
      break;
    }
    case 'sentry': {
      const environment = read('environment');
      if (!environment) {
        warnings.push('Set the default environment so issue triage is scoped correctly.');
      }
      break;
    }
    case 'cloudinary':
    case 'datadog':
    case 'mux': {
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set the workspace or environment name so operational actions target the correct account context.');
      }
      break;
    }
    case 'vercel':
    case 'netlify': {
      const projectName = read('projectName') || read('siteName');
      if (!projectName) {
        warnings.push('Set the primary project or site name so deployment actions target the correct property.');
      }
      break;
    }
    case 'figma':
    case 'notion':
    case 'salesforce':
    case 'pipedrive':
    case 'mailchimp':
    case 'convertkit': {
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set the workspace or account name so the circle can identify the correct operational context.');
      }
      break;
    }
    case 'shopify': {
      const storeName = read('storeName');
      if (!storeName) {
        warnings.push('Set the store name so commerce actions target the correct storefront.');
      }
      break;
    }
    case 'google_ads':
    case 'meta_ads': {
      const accountName = read('accountName');
      if (!accountName) {
        warnings.push('Set the ad account name so campaign automation targets the correct account.');
      }
      break;
    }
    default:
      break;
  }

  return warnings;
}

export function inferTaskIntegrationRequirements(task: {
  title: string;
  description?: string;
  profileKey?: string;
}): { requiredConnectors: string[]; requiredCapabilities: string[] } {
  const text = `${task.title} ${task.description || ''} ${task.profileKey || ''}`.toLowerCase();
  const requiredConnectors = new Set<string>();
  const requiredCapabilities = new Set<string>();

  if (/wordpress|blog|publish|cms|landing page|site content|editorial|seo/i.test(text)) {
    requiredConnectors.add('wordpress');
    requiredCapabilities.add('publish_content');
  }
  if (/seo|search console|indexing|keyword|organic/i.test(text)) {
    requiredConnectors.add('search_console');
    requiredConnectors.add('google-analytics');
    requiredCapabilities.add('read_search_console');
    requiredCapabilities.add('read_analytics');
  }
  if (/campaign|funnel|conversion|analytics|ga4|growth/i.test(text)) {
    requiredConnectors.add('google-analytics');
    requiredCapabilities.add('read_analytics');
  }
  if (/crm|lead|deal|pipeline|hubspot|customer/i.test(text)) {
    requiredConnectors.add('hubspot');
    requiredCapabilities.add('read_crm');
  }
  if (/billing|payment|subscription|invoice|checkout|stripe/i.test(text)) {
    requiredConnectors.add('stripe');
    requiredCapabilities.add('manage_payments');
  }
  if (/dns|domain|cache|cdn|redirect|cloudflare/i.test(text)) {
    requiredConnectors.add('cloudflare');
    requiredCapabilities.add('manage_dns');
  }
  if (/deploy|hosting|s3|cloudfront|route 53|ses|aws|migration|cutover/i.test(text)) {
    requiredConnectors.add('aws');
    requiredCapabilities.add('manage_infra');
  }
  if (/web search|research|current info|current information|source discovery|brave/i.test(text)) {
    requiredConnectors.add('brave');
    requiredCapabilities.add('web_search');
    requiredCapabilities.add('current_research');
  }
  if (/custom api|api connector|rest api|http api|external api|third[- ]party api|connect .* api|webhook endpoint|api integration/i.test(text)) {
    requiredConnectors.add('custom_api');
    requiredCapabilities.add('custom_api');
    requiredCapabilities.add('api_connector');
    requiredCapabilities.add('agent_tool');
  }
  if (/browser automation|browser session|web automation|computer use|website task|login flow|form fill|click|navigate|qa flow|ui test/i.test(text)) {
    requiredConnectors.add('browserbase');
    requiredCapabilities.add('web_automation');
    requiredCapabilities.add('remote_browser_sessions');
  }
  if (/stagehand|self-healing browser|self healing browser|browser-agent recipe|browser agent recipe|natural language browser action/i.test(text)) {
    requiredConnectors.add('stagehand');
    requiredCapabilities.add('ai_browser_actions');
  }
  if (/playwright|mcp|dom snapshot|selector|browser test|ui regression|end-to-end|e2e/i.test(text)) {
    requiredConnectors.add('playwright_mcp');
    requiredCapabilities.add('deterministic_browser_control');
  }
  if (/screenshot|pdf|headless browser|puppeteer|browserless|page capture/i.test(text)) {
    requiredConnectors.add('browserless');
    requiredCapabilities.add('headless_browser_api');
  }
  if (/cross-browser|cross browser|real device|mobile browser|browserstack|safari ios|device qa/i.test(text)) {
    requiredConnectors.add('browserstack');
    requiredCapabilities.add('cross_browser_qa');
  }
  if (/scrape|crawl|web data|extract data|markdown|firecrawl|rag ingestion/i.test(text)) {
    requiredConnectors.add('firecrawl');
    requiredCapabilities.add('web_scrape_markdown');
  }
  if (/apify|actor|dataset|scheduled crawl|web scraper|scraping workflow/i.test(text)) {
    requiredConnectors.add('apify');
    requiredCapabilities.add('run_web_actors');
  }
  if (/steel|browser fleet|cloud browser fleet|open browser api/i.test(text)) {
    requiredConnectors.add('steel');
    requiredCapabilities.add('cloud_browser_sessions');
  }
  if (/hyperbrowser|browser-as-a-service|browser as a service|scalable browser|browser use task/i.test(text)) {
    requiredConnectors.add('hyperbrowser');
    requiredCapabilities.add('cloud_browser_sessions');
  }
  if (/airtop|natural language browser|ai browser api|managed browser profile/i.test(text)) {
    requiredConnectors.add('airtop');
    requiredCapabilities.add('natural_language_browser_control');
  }
  if (/skyvern|vision guided|vision-guided|workflow automation|authenticated site|dashboard automation/i.test(text)) {
    requiredConnectors.add('skyvern');
    requiredCapabilities.add('vision_guided_browser_workflows');
  }
  if (/browser use|browser-use|browseruse|self hosted browser|open-source browser agent|open source browser agent/i.test(text)) {
    requiredConnectors.add('browser_use');
    requiredCapabilities.add('open_source_browser_agent');
  }

  return {
    requiredConnectors: Array.from(requiredConnectors),
    requiredCapabilities: Array.from(requiredCapabilities),
  };
}

export function getSpiritIntegrationRequirements(spiritId?: string | null): {
  requiredConnectors: string[];
  requiredCapabilities: string[];
} {
  switch (spiritId) {
    case 'devops':
      return { requiredConnectors: ['aws', 'cloudflare', 'github'], requiredCapabilities: ['manage_infra', 'manage_dns', 'deploy_site'] };
    case 'marketer':
      return { requiredConnectors: ['wordpress', 'google-analytics', 'search_console', 'hubspot'], requiredCapabilities: ['publish_content', 'read_analytics', 'read_search_console', 'read_crm'] };
    case 'writer':
      return { requiredConnectors: ['wordpress'], requiredCapabilities: ['publish_content'] };
    case 'pm':
      return { requiredConnectors: ['hubspot', 'google-analytics', 'slack'], requiredCapabilities: ['read_crm', 'read_analytics'] };
    case 'designer':
      return { requiredConnectors: ['wordpress'], requiredCapabilities: ['publish_content'] };
    case 'data-engineer':
      return { requiredConnectors: ['google-analytics', 'hubspot', 'stripe'], requiredCapabilities: ['read_analytics', 'read_crm', 'read_billing'] };
    case 'coding-agent':
    case 'sr-engineer':
    case 'tech-lead':
    case 'architect':
      return { requiredConnectors: ['github'], requiredCapabilities: [] };
    default:
      return { requiredConnectors: [], requiredCapabilities: [] };
  }
}

/**
 * Probe the provider's auth endpoint to confirm the API key is live before
 * we mark the integration as connected. Returns `{ ok, message? }` so the
 * caller can surface "key invalid" inline. Probes only cover providers
 * that expose a cheap auth-introspection endpoint.
 */
export async function validateProviderApiKey(
  provider: CircleIntegrationProvider,
  apiKey: string,
): Promise<{ ok: boolean; message?: string }> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, message: 'Empty API key' };
  }
  try {
    if (provider === 'openrouter') {
      // GET /api/v1/auth/key returns the current key's metadata.
      const resp = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, message: 'OpenRouter rejected the key (401/403)' };
      }
      if (!resp.ok) return { ok: false, message: `OpenRouter probe ${resp.status}` };
      return { ok: true };
    }
    if (provider === 'hugging_face') {
      // GET /api/whoami-v2 (the v1 redirects but v2 is stable)
      const resp = await fetch('https://huggingface.co/api/whoami-v2', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, message: 'Hugging Face rejected the token' };
      }
      if (!resp.ok) return { ok: false, message: `Hugging Face probe ${resp.status}` };
      return { ok: true };
    }
    if (provider === 'brave') {
      const resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=hello&count=1', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': apiKey.trim(),
        },
      });
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, message: 'Brave Search rejected the API key' };
      }
      if (!resp.ok) return { ok: false, message: `Brave Search probe ${resp.status}` };
      return { ok: true };
    }
    if (provider === 'replicate') {
      // GET /v1/account returns the authed account.
      const resp = await fetch('https://api.replicate.com/v1/account', {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
      });
      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, message: 'Replicate rejected the token' };
      }
      if (!resp.ok) return { ok: false, message: `Replicate probe ${resp.status}` };
      return { ok: true };
    }
    // No probe wired for this provider — accept optimistically.
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'probe network error' };
  }
}

export async function connectGenericCircleIntegration(opts: {
  circleId: string;
  provider: CircleIntegrationProvider;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  secrets?: Record<string, string>;
}): Promise<CircleIntegrationRecord | null> {
  const definition = INTEGRATION_DEFINITIONS[opts.provider];

  // For LLM marketplace providers, probe the API key before storing it so
  // the team learns about invalid keys at save time rather than the first
  // time chat tries to use the model and silently falls back.
  let initialStatus: 'connected' | 'degraded' = 'connected';
  let validationMessage: string | undefined;
  const probableKey = opts.secrets?.api_key || opts.secrets?.api_token;
  if (probableKey && (opts.provider === 'openrouter' || opts.provider === 'hugging_face' || opts.provider === 'replicate' || opts.provider === 'brave')) {
    const probe = await validateProviderApiKey(opts.provider, probableKey);
    if (!probe.ok) {
      initialStatus = 'degraded';
      validationMessage = probe.message;
    }
  }
  if (opts.provider === 'custom_api' && definition) {
    const metadata = opts.metadata || {};
    const missingMetadataFields = (definition.metadataFields || [])
      .filter(field => field.required !== false)
      .map(field => field.key)
      .filter(key => !String(metadata[key] || '').trim());
    const providerWarnings = getProviderSpecificIntegrationWarnings({ provider: opts.provider, metadata });
    if (missingMetadataFields.length > 0 || providerWarnings.length > 0) {
      initialStatus = 'degraded';
      validationMessage = [
        missingMetadataFields.length ? `Missing metadata: ${missingMetadataFields.join(', ')}` : '',
        ...providerWarnings,
      ].filter(Boolean).join(' | ');
    }
  }

  // A successful (re-)save must explicitly write the healthy state:
  // `upsertCircleIntegration` MERGES metadata with the existing row, so simply
  // omitting `last_validation_error` would preserve a stale error forever
  // while status silently reset to 'connected'. The pure helper returns
  // `{ last_validation_error: null }` on success (clearing the stale error
  // through the merge) and a sanitized bounded error + 'degraded' on failure.
  const saveHealth = buildIntegrationSaveHealthState({
    status: initialStatus,
    validationMessage,
  });
  const integration = await upsertCircleIntegration({
    circleId: opts.circleId,
    provider: opts.provider,
    displayName: opts.displayName || definition?.label,
    description: opts.description || definition?.description || null || undefined,
    metadata: {
      ...(opts.metadata || {}),
      ...saveHealth.metadataPatch,
    },
    capabilityFlags: definition?.capabilityFlags || [],
    status: saveHealth.status,
  });

  if (!integration) return null;

  if (opts.secrets && Object.keys(opts.secrets).length > 0) {
    const ok = await saveCircleIntegrationSecrets({
      integrationId: integration.id,
      secrets: opts.secrets,
    });
    if (!ok) return null;
  }

  return integration;
}
