import { supabase } from './supabase';

export type CircleIntegrationProvider =
  | 'browserbase'
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
  | 'posthog';

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
      { key: 'workspaceName', label: 'Workspace Name', placeholder: 'Main Browserbase Workspace' },
    ],
    validationHints: ['Use a project-scoped API key.', 'Add a default region if browser latency matters for automations.'],
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
    .filter(item => item.is_active !== false && item.status !== 'disabled')
    .map(item => item.provider);
}

export async function getCircleIntegrationCapabilities(circleId: string): Promise<string[]> {
  const integrations = await listCircleIntegrations(circleId);
  return Array.from(new Set(
    integrations
      .filter(item => item.is_active !== false && item.status !== 'disabled')
      .flatMap(item => item.capability_flags || []),
  ));
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
      const workspaceName = read('workspaceName');
      if (!workspaceName) {
        warnings.push('Set a workspace name so browser automation can target the right project context.');
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

export async function connectGenericCircleIntegration(opts: {
  circleId: string;
  provider: CircleIntegrationProvider;
  displayName?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  secrets?: Record<string, string>;
}): Promise<CircleIntegrationRecord | null> {
  const definition = INTEGRATION_DEFINITIONS[opts.provider];
  const integration = await upsertCircleIntegration({
    circleId: opts.circleId,
    provider: opts.provider,
    displayName: opts.displayName || definition?.label,
    description: opts.description || definition?.description || null || undefined,
    metadata: opts.metadata,
    capabilityFlags: definition?.capabilityFlags || [],
    status: 'connected',
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
