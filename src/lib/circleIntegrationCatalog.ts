export type CircleIntegrationGroupKey =
  | 'ai_agents_services'
  | 'code_delivery'
  | 'auth_identity'
  | 'publishing_web'
  | 'comms_community'
  | 'marketing_growth'
  | 'data_search'
  | 'ops_infra'
  | 'observability_security'
  | 'crm_revenue'
  | 'design_knowledge'
  | 'workflow_automation';

export type CircleIntegrationPlatformKey =
  | 'browserbase'
  | 'braintrust'
  | 'vercel'
  | 'netlify'
  | 'descope'
  | 'github'
  | 'wordpress'
  | 'slack'
  | 'teams'
  | 'discord'
  | 'helius'
  | 'algolia'
  | 'pinecone'
  | 'aws'
  | 'cloudflare'
  | 'resend'
  | 'hubspot'
  | 'google_analytics'
  | 'google_search_console'
  | 'google_ads'
  | 'meta_ads'
  | 'posthog'
  | 'sentry'
  | 'shopify'
  | 'mailchimp'
  | 'convertkit'
  | 'salesforce'
  | 'pipedrive'
  | 'figma'
  | 'notion'
  | 'launchdarkly'
  | 'datadog'
  | 'cloudinary'
  | 'mux'
  | 'stripe';

export interface CircleIntegrationGroup {
  key: CircleIntegrationGroupKey;
  label: string;
  description: string;
}

export interface CircleIntegrationCatalogItem {
  id: string;
  label: string;
  icon: string;
  color: string;
  group: CircleIntegrationGroupKey;
  description: string;
  relationships: string[];
  capabilityLabel: string;
  scopeLabel: string;
  availability: 'available' | 'planned';
  platformKey?: CircleIntegrationPlatformKey;
  recentlyAdded?: boolean;
}

export const CIRCLE_INTEGRATION_GROUPS: CircleIntegrationGroup[] = [
  {
    key: 'ai_agents_services',
    label: 'AI Agents And Services',
    description: 'Coding agents, web automation, evals, agent infrastructure, and model-facing services.',
  },
  {
    key: 'code_delivery',
    label: 'Code And Delivery',
    description: 'Source control, coding agents, deployment signals, and engineering execution.',
  },
  {
    key: 'auth_identity',
    label: 'Authentication And Identity',
    description: 'Auth, SSO, permissions, user identity, and access management.',
  },
  {
    key: 'publishing_web',
    label: 'Publishing And Web',
    description: 'CMS, websites, landing pages, and content operations.',
  },
  {
    key: 'comms_community',
    label: 'Comms And Community',
    description: 'Internal coordination, alerts, team messaging, and public communities.',
  },
  {
    key: 'marketing_growth',
    label: 'Marketing And Growth',
    description: 'Analytics, campaigns, search, audience growth, and channel performance.',
  },
  {
    key: 'data_search',
    label: 'Data And Search',
    description: 'Databases, vector stores, internal knowledge search, and retrieval systems.',
  },
  {
    key: 'ops_infra',
    label: 'Operations And Infrastructure',
    description: 'Hosting, DNS, environments, access, observability, and execution safety.',
  },
  {
    key: 'observability_security',
    label: 'Observability And Security',
    description: 'Monitoring, logging, tracing, alerts, security reviews, and guardrails.',
  },
  {
    key: 'crm_revenue',
    label: 'CRM And Revenue',
    description: 'Leads, customers, billing, storefronts, and commercial operations.',
  },
  {
    key: 'design_knowledge',
    label: 'Design And Knowledge',
    description: 'Creative assets, documentation, briefs, SOPs, and knowledge systems.',
  },
  {
    key: 'workflow_automation',
    label: 'Workflow And Automation',
    description: 'Email, task routing, approvals, queues, automations, and operational glue.',
  },
];

export const CIRCLE_INTEGRATION_CATALOG: CircleIntegrationCatalogItem[] = [
  {
    id: 'openswan-runtime',
    label: 'OpenSwan Runtime',
    icon: 'OS',
    color: '#22c55e',
    group: 'ai_agents_services',
    description: 'Coding-agent runtime, session control, delegation, web automation, and execution cockpit for Pixel Agents.',
    relationships: ['Office', 'Coding agents', 'Tasks'],
    capabilityLabel: 'Native coding-agent runtime',
    scopeLabel: 'Built into the app',
    availability: 'available',
  },
  {
    id: 'browserbase',
    label: 'Browserbase',
    icon: 'BB',
    color: '#14b8a6',
    group: 'ai_agents_services',
    description: 'Cloud browser automation for agents that need durable, remote web sessions and browser task execution.',
    relationships: ['Web automation', 'Support agents', 'QA'],
    capabilityLabel: 'Agent browser infrastructure',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'browserbase',
  },
  {
    id: 'braintrust',
    label: 'Braintrust',
    icon: 'BT',
    color: '#8b5cf6',
    group: 'ai_agents_services',
    description: 'AI evals, monitoring, prompt regression checks, and experimentation for agent quality.',
    relationships: ['Research', 'Evals', 'Observability'],
    capabilityLabel: 'Agent quality platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'braintrust',
    recentlyAdded: true,
  },
  {
    id: 'github',
    label: 'GitHub',
    icon: '{>}',
    color: '#238636',
    group: 'code_delivery',
    description: 'Repos, pull requests, issues, CI, reviews, and shipping workflows.',
    relationships: ['Deploys', 'Tasks', 'Coding agents'],
    capabilityLabel: 'Engineering system of record',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'github',
  },
  {
    id: 'vercel',
    label: 'Vercel',
    icon: '▲',
    color: '#ffffff',
    group: 'code_delivery',
    description: 'Deployments, previews, domains, environment variables, project linking, and production shipping workflows.',
    relationships: ['GitHub', 'OpenSwan', 'Cloudflare'],
    capabilityLabel: 'Frontend deploy platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'vercel',
  },
  {
    id: 'netlify',
    label: 'Netlify',
    icon: 'NL',
    color: '#00C7B7',
    group: 'code_delivery',
    description: 'Deployments, previews, domains, forms, and site delivery workflows for static and frontend properties.',
    relationships: ['GitHub', 'Cloudflare', 'OpenSwan'],
    capabilityLabel: 'Frontend delivery platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'netlify',
  },
  {
    id: 'descope',
    label: 'Descope',
    icon: 'DS',
    color: '#60a5fa',
    group: 'auth_identity',
    description: 'Authentication, MFA, SSO, identity flows, and secure app access patterns.',
    relationships: ['Security', 'Users', 'Approvals'],
    capabilityLabel: 'Identity and auth platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'descope',
  },
  {
    id: 'launchdarkly',
    label: 'LaunchDarkly',
    icon: 'LD',
    color: '#7c3aed',
    group: 'workflow_automation',
    description: 'Feature flags, rollouts, guarded releases, experiments, and progressive delivery workflows.',
    relationships: ['PostHog', 'Vercel', 'Product'],
    capabilityLabel: 'Feature flags and experimentation',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'launchdarkly',
    recentlyAdded: true,
  },
  {
    id: 'wordpress',
    label: 'WordPress',
    icon: 'WP',
    color: '#21759B',
    group: 'publishing_web',
    description: 'Blog publishing, page updates, CMS workflows, editorial drafts, and content operations.',
    relationships: ['SEO', 'Content', 'Marketing ops'],
    capabilityLabel: 'Publishing system',
    scopeLabel: 'Circle-wide preferred',
    availability: 'available',
    platformKey: 'wordpress',
  },
  {
    id: 'slack',
    label: 'Slack',
    icon: '💬',
    color: '#4A154B',
    group: 'comms_community',
    description: 'Channel notifications, team check-ins, launch alerts, and operating comms.',
    relationships: ['Standups', 'Alerts', 'Approvals'],
    capabilityLabel: 'Internal team messaging',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'slack',
  },
  {
    id: 'teams',
    label: 'Microsoft Teams',
    icon: '💼',
    color: '#5B5FC7',
    group: 'comms_community',
    description: 'Enterprise team communication, channel notices, and company coordination.',
    relationships: ['Enterprise comms', 'Approvals', 'Notifications'],
    capabilityLabel: 'Enterprise team messaging',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'teams',
  },
  {
    id: 'discord',
    label: 'Discord',
    icon: '🎮',
    color: '#5865F2',
    group: 'comms_community',
    description: 'Community messaging, channel browsing, server sync, and public engagement.',
    relationships: ['Community', 'Support', 'Announcements'],
    capabilityLabel: 'Community messaging',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'discord',
  },
  {
    id: 'helius',
    label: 'Helius',
    icon: '◎',
    color: '#9945FF',
    group: 'crm_revenue',
    description: 'Solana wallet data, token activity, swaps, and crypto-native finance operations.',
    relationships: ['Treasury', 'Trading', 'Onchain analytics'],
    capabilityLabel: 'Crypto finance ops',
    scopeLabel: 'User-linked',
    availability: 'available',
    platformKey: 'helius',
  },
  {
    id: 'google-analytics',
    label: 'Google Analytics',
    icon: 'GA',
    color: '#F59E0B',
    group: 'marketing_growth',
    description: 'Traffic, funnel performance, conversion reporting, and site behavior analysis.',
    relationships: ['Search Console', 'WordPress', 'Campaigns'],
    capabilityLabel: 'Marketing measurement',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'google_analytics',
  },
  {
    id: 'search-console',
    label: 'Google Search Console',
    icon: 'GSC',
    color: '#10B981',
    group: 'marketing_growth',
    description: 'Search visibility, indexing health, keyword opportunity, and technical SEO insight.',
    relationships: ['Analytics', 'WordPress', 'SEO'],
    capabilityLabel: 'SEO system',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'google_search_console',
  },
  {
    id: 'algolia',
    label: 'Algolia',
    icon: 'ALG',
    color: '#0ea5e9',
    group: 'data_search',
    description: 'User-facing search, indexing, query analytics, and discovery for docs, content, and products.',
    relationships: ['Docs', 'WordPress', 'Knowledge'],
    capabilityLabel: 'User-facing search',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'algolia',
  },
  {
    id: 'cloudinary',
    label: 'Cloudinary',
    icon: 'CLD',
    color: '#2563eb',
    group: 'data_search',
    description: 'Media storage, transformations, asset delivery, and image-heavy content pipelines.',
    relationships: ['WordPress', 'Figma', 'Marketing'],
    capabilityLabel: 'Media pipeline',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'cloudinary',
    recentlyAdded: true,
  },
  {
    id: 'pinecone',
    label: 'Pinecone',
    icon: 'PIN',
    color: '#a855f7',
    group: 'data_search',
    description: 'Vector retrieval for memory, research corpus, semantic search, and agent knowledge systems.',
    relationships: ['Research corpus', 'Soul memory', 'Agents'],
    capabilityLabel: 'Semantic retrieval layer',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'pinecone',
  },
  {
    id: 'supabase-data',
    label: 'Supabase Data',
    icon: 'SB',
    color: '#3ecf8e',
    group: 'data_search',
    description: 'Database, storage, auth, realtime, and backend workflows for app-native operational data.',
    relationships: ['Storage', 'Realtime', 'App backend'],
    capabilityLabel: 'App data platform',
    scopeLabel: 'Built into the app',
    availability: 'available',
  },
  {
    id: 'google-ads',
    label: 'Google Ads',
    icon: 'GAD',
    color: '#2563eb',
    group: 'marketing_growth',
    description: 'Campaign reporting, paid search operations, audience testing, and ad performance workflows.',
    relationships: ['Analytics', 'CRM', 'Landing pages'],
    capabilityLabel: 'Paid acquisition',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'google_ads',
  },
  {
    id: 'meta-ads',
    label: 'Meta Ads',
    icon: 'MAD',
    color: '#2563eb',
    group: 'marketing_growth',
    description: 'Paid social campaigns, audience testing, creative analysis, and acquisition ops.',
    relationships: ['Analytics', 'CRM', 'Landing pages'],
    capabilityLabel: 'Paid social acquisition',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'meta_ads',
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    icon: 'CF',
    color: '#F97316',
    group: 'ops_infra',
    description: 'DNS, CDN, caching, security controls, redirects, and migration cutovers.',
    relationships: ['Hosting', 'WordPress', 'Migrations'],
    capabilityLabel: 'Edge and DNS control',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'cloudflare',
  },
  {
    id: 'datadog',
    label: 'Datadog',
    icon: 'DD',
    color: '#7c3aed',
    group: 'observability_security',
    description: 'Logs, traces, metrics, service health, alerts, and infrastructure visibility.',
    relationships: ['AWS', 'Sentry', 'OpenSwan'],
    capabilityLabel: 'Monitoring and observability',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'datadog',
    recentlyAdded: true,
  },
  {
    id: 'hosting',
    label: 'AWS',
    icon: 'AWS',
    color: '#FF9900',
    group: 'ops_infra',
    description: 'Infrastructure, Route 53, S3, CloudFront, SES, and broader platform operations.',
    relationships: ['GitHub', 'Cloudflare', 'Migrations'],
    capabilityLabel: 'Infrastructure and deploy control',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'aws',
  },
  {
    id: 'resend-email',
    label: 'Resend / Email Delivery',
    icon: '✉',
    color: '#f43f5e',
    group: 'workflow_automation',
    description: 'Transactional email, campaign delivery, notifications, and approval flows.',
    relationships: ['CRM', 'Marketing', 'Support'],
    capabilityLabel: 'Email delivery layer',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'resend',
  },
  {
    id: 'workflow-automation',
    label: 'Workflow Automation',
    icon: 'WF',
    color: '#22c55e',
    group: 'workflow_automation',
    description: 'Queues, approval chains, agent handoffs, task orchestration, and operational automations.',
    relationships: ['Tasks', 'Comms', 'Marketplace apps'],
    capabilityLabel: 'Automation backbone',
    scopeLabel: 'Built into the app',
    availability: 'available',
  },
  {
    id: 'crm',
    label: 'HubSpot',
    icon: 'HS',
    color: '#F97316',
    group: 'crm_revenue',
    description: 'CRM, contacts, deals, lifecycle automation, forms, and revenue operations.',
    relationships: ['Email', 'Ads', 'Content'],
    capabilityLabel: 'Revenue system of record',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'hubspot',
  },
  {
    id: 'salesforce',
    label: 'Salesforce',
    icon: 'SF',
    color: '#00A1E0',
    group: 'crm_revenue',
    description: 'Enterprise CRM, opportunities, accounts, contacts, and large-team revenue workflows.',
    relationships: ['Revenue', 'Email', 'Support'],
    capabilityLabel: 'Enterprise CRM platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'salesforce',
  },
  {
    id: 'pipedrive',
    label: 'Pipedrive',
    icon: 'PD',
    color: '#0f8b4c',
    group: 'crm_revenue',
    description: 'SMB sales pipeline management, deal tracking, contacts, and lean revenue operations.',
    relationships: ['Revenue', 'Email', 'Analytics'],
    capabilityLabel: 'SMB CRM platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'pipedrive',
  },
  {
    id: 'shopify',
    label: 'Shopify',
    icon: 'SH',
    color: '#95BF47',
    group: 'crm_revenue',
    description: 'Storefront operations, products, orders, ecommerce workflows, and commercial fulfillment.',
    relationships: ['Stripe', 'Analytics', 'Email'],
    capabilityLabel: 'Commerce platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'shopify',
  },
  {
    id: 'mailchimp',
    label: 'Mailchimp',
    icon: 'MC',
    color: '#f59e0b',
    group: 'crm_revenue',
    description: 'Campaign automation, audience segmentation, and lifecycle email messaging.',
    relationships: ['CRM', 'Analytics', 'WordPress'],
    capabilityLabel: 'Lifecycle messaging',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'mailchimp',
  },
  {
    id: 'convertkit',
    label: 'ConvertKit',
    icon: 'CK',
    color: '#a855f7',
    group: 'crm_revenue',
    description: 'Creator email automation, broadcasts, audience funnels, and lifecycle messaging.',
    relationships: ['CRM', 'Analytics', 'Content'],
    capabilityLabel: 'Audience messaging',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'convertkit',
  },
  {
    id: 'payments',
    label: 'Stripe',
    icon: '$',
    color: '#635BFF',
    group: 'crm_revenue',
    description: 'Payments, subscriptions, invoices, checkout, and revenue operations.',
    relationships: ['CRM', 'WordPress', 'Analytics'],
    capabilityLabel: 'Commercial operations',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'stripe',
  },
  {
    id: 'figma',
    label: 'Figma',
    icon: '◧',
    color: '#EC4899',
    group: 'design_knowledge',
    description: 'Design reviews, asset references, system updates, and creative handoffs.',
    relationships: ['Brand', 'Landing pages', 'Product design'],
    capabilityLabel: 'Design system',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'figma',
  },
  {
    id: 'mux',
    label: 'Mux',
    icon: 'MUX',
    color: '#ec4899',
    group: 'design_knowledge',
    description: 'Video ingestion, streaming, asset playback, and video-heavy product or media workflows.',
    relationships: ['Cloudinary', 'Content', 'Marketing'],
    capabilityLabel: 'Video platform',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'mux',
    recentlyAdded: true,
  },
  {
    id: 'posthog',
    label: 'PostHog',
    icon: 'PH',
    color: '#f97316',
    group: 'observability_security',
    description: 'Product analytics, feature flags, experiments, funnels, and usage visibility.',
    relationships: ['Analytics', 'Experiments', 'Product'],
    capabilityLabel: 'Product analytics and flags',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'posthog',
  },
  {
    id: 'sentry',
    label: 'Sentry',
    icon: 'SE',
    color: '#a78bfa',
    group: 'observability_security',
    description: 'Errors, performance traces, crash monitoring, and production issue visibility.',
    relationships: ['Observability', 'QA', 'Runtime'],
    capabilityLabel: 'Error and performance monitoring',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'sentry',
  },
  {
    id: 'knowledge',
    label: 'Docs And Knowledge',
    icon: 'DOC',
    color: '#94A3B8',
    group: 'design_knowledge',
    description: 'Notion, docs, SOPs, briefs, and internal knowledge operations.',
    relationships: ['Research', 'Planning', 'Ops'],
    capabilityLabel: 'Knowledge system',
    scopeLabel: 'Circle-wide',
    availability: 'available',
    platformKey: 'notion',
  },
];

export function getCatalogItemsForGroup(group: CircleIntegrationGroupKey): CircleIntegrationCatalogItem[] {
  return CIRCLE_INTEGRATION_CATALOG.filter(item => item.group === group);
}
