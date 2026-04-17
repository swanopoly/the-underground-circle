export interface MarketplaceAppDetail {
  usedBySouls: string[];
  unlocks: string[];
  exampleTasks: string[];
  relatedItemIds?: string[];
}

export const MARKETPLACE_APP_DETAILS: Record<string, MarketplaceAppDetail> = {
  'openswan-runtime': {
    usedBySouls: ['AI Researcher', 'Engineer', 'DevOps', 'QA'],
    unlocks: ['coding runtime control', 'subagent orchestration', 'session-driven execution'],
    exampleTasks: ['debug a failing build', 'run a migration plan', 'delegate browser automation to an agent'],
    relatedItemIds: ['browserbase', 'braintrust', 'github'],
  },
  browserbase: {
    usedBySouls: ['QA', 'Support', 'Growth', 'DevOps'],
    unlocks: ['durable browser sessions', 'web workflow automation', 'UI regression flows'],
    exampleTasks: ['log into a dashboard and verify a funnel', 'run a browser QA checklist', 'capture remote web state for an agent'],
    relatedItemIds: ['openswan-runtime', 'posthog', 'sentry'],
  },
  braintrust: {
    usedBySouls: ['AI Researcher', 'Engineer', 'QA'],
    unlocks: ['eval tracking', 'prompt regressions', 'agent quality scoring'],
    exampleTasks: ['compare two prompt strategies', 'monitor agent quality drift', 'evaluate research workflows'],
    relatedItemIds: ['openswan-runtime', 'posthog'],
  },
  github: {
    usedBySouls: ['Engineer', 'DevOps', 'QA', 'PM'],
    unlocks: ['repo access', 'PR workflows', 'issue tracking'],
    exampleTasks: ['open a PR', 'review code changes', 'triage a failing issue'],
    relatedItemIds: ['vercel', 'netlify', 'sentry'],
  },
  vercel: {
    usedBySouls: ['Engineer', 'DevOps', 'Designer', 'Growth'],
    unlocks: ['preview deploys', 'frontend releases', 'domain-linked shipping'],
    exampleTasks: ['ship a landing page update', 'inspect a preview deployment', 'roll out a frontend fix'],
    relatedItemIds: ['github', 'cloudflare', 'launchdarkly'],
  },
  netlify: {
    usedBySouls: ['Engineer', 'DevOps', 'Growth'],
    unlocks: ['static site deploys', 'preview builds', 'site delivery'],
    exampleTasks: ['publish a static microsite', 'deploy a marketing page', 'manage site previews'],
    relatedItemIds: ['github', 'cloudflare'],
  },
  wordpress: {
    usedBySouls: ['Writer', 'Marketer', 'SEO', 'PM'],
    unlocks: ['CMS publishing', 'page updates', 'editorial workflows'],
    exampleTasks: ['publish a blog post', 'update a service page', 'schedule a content draft'],
    relatedItemIds: ['google-analytics', 'search-console', 'resend-email'],
  },
  'google-analytics': {
    usedBySouls: ['Marketer', 'Growth', 'PM', 'Analyst'],
    unlocks: ['traffic reporting', 'funnel visibility', 'conversion analysis'],
    exampleTasks: ['audit a landing page funnel', 'report weekly acquisition performance', 'analyze campaign conversions'],
    relatedItemIds: ['search-console', 'posthog', 'google-ads'],
  },
  'search-console': {
    usedBySouls: ['SEO', 'Writer', 'Marketer'],
    unlocks: ['search visibility', 'indexing insight', 'technical SEO health'],
    exampleTasks: ['inspect indexing issues', 'analyze top search queries', 'review page performance in search'],
    relatedItemIds: ['google-analytics', 'wordpress', 'algolia'],
  },
  algolia: {
    usedBySouls: ['Engineer', 'Writer', 'PM'],
    unlocks: ['site search', 'query analytics', 'discovery workflows'],
    exampleTasks: ['improve docs search', 'index a content collection', 'analyze zero-result queries'],
    relatedItemIds: ['knowledge', 'wordpress', 'pinecone'],
  },
  pinecone: {
    usedBySouls: ['AI Researcher', 'Engineer', 'Knowledge'],
    unlocks: ['semantic retrieval', 'memory search', 'RAG indexing'],
    exampleTasks: ['index a research corpus', 'store embeddings', 'power semantic recall for Souls'],
    relatedItemIds: ['knowledge', 'braintrust', 'openswan-runtime'],
  },
  cloudflare: {
    usedBySouls: ['DevOps', 'Engineer', 'Security'],
    unlocks: ['DNS control', 'edge rules', 'cache and redirect management'],
    exampleTasks: ['cut over a domain migration', 'update DNS records', 'purge cache after a release'],
    relatedItemIds: ['vercel', 'netlify', 'hosting'],
  },
  hosting: {
    usedBySouls: ['DevOps', 'Engineer'],
    unlocks: ['infra access', 'storage', 'email and CDN operations'],
    exampleTasks: ['configure SES', 'manage an S3 bucket', 'handle Route 53 cutover'],
    relatedItemIds: ['cloudflare', 'sentry', 'datadog'],
  },
  launchdarkly: {
    usedBySouls: ['PM', 'Engineer', 'Growth'],
    unlocks: ['feature flags', 'guarded rollouts', 'experiments'],
    exampleTasks: ['roll out a feature gradually', 'gate a risky release', 'run a launch experiment'],
    relatedItemIds: ['posthog', 'vercel'],
  },
  posthog: {
    usedBySouls: ['Growth', 'PM', 'Analyst'],
    unlocks: ['product analytics', 'funnels', 'experiments'],
    exampleTasks: ['analyze product funnels', 'measure experiment impact', 'review feature adoption'],
    relatedItemIds: ['launchdarkly', 'google-analytics', 'sentry'],
  },
  sentry: {
    usedBySouls: ['Engineer', 'DevOps', 'QA'],
    unlocks: ['error triage', 'performance visibility', 'release issue tracking'],
    exampleTasks: ['triage a production error', 'inspect performance regressions', 'verify a release fix'],
    relatedItemIds: ['datadog', 'github', 'hosting'],
  },
  datadog: {
    usedBySouls: ['DevOps', 'Engineer', 'Security'],
    unlocks: ['logs', 'metrics', 'monitoring and alerts'],
    exampleTasks: ['investigate service latency', 'review infrastructure logs', 'configure monitors'],
    relatedItemIds: ['sentry', 'hosting', 'cloudflare'],
  },
  'resend-email': {
    usedBySouls: ['Marketer', 'PM', 'Support'],
    unlocks: ['transactional email', 'notifications', 'approval flows'],
    exampleTasks: ['send approval emails', 'dispatch notifications', 'wire transactional messaging'],
    relatedItemIds: ['crm', 'mailchimp', 'convertkit'],
  },
  crm: {
    usedBySouls: ['Sales', 'Marketer', 'PM'],
    unlocks: ['contact and deal management', 'pipeline workflows', 'revenue operations'],
    exampleTasks: ['update a deal stage', 'sync contacts', 'track a campaign lead lifecycle'],
    relatedItemIds: ['mailchimp', 'convertkit', 'payments'],
  },
  salesforce: {
    usedBySouls: ['Sales', 'RevOps', 'PM'],
    unlocks: ['enterprise CRM ownership', 'account and opportunity workflows', 'revenue reporting'],
    exampleTasks: ['update enterprise opportunities', 'sync account notes', 'review sales pipeline movement'],
    relatedItemIds: ['mailchimp', 'payments'],
  },
  pipedrive: {
    usedBySouls: ['Sales', 'RevOps'],
    unlocks: ['lean CRM ownership', 'deal pipeline control', 'contact workflows'],
    exampleTasks: ['move a deal through stages', 'update contact records', 'review outbound pipeline health'],
    relatedItemIds: ['mailchimp', 'payments'],
  },
  mailchimp: {
    usedBySouls: ['Marketer', 'Growth', 'Writer'],
    unlocks: ['audience campaigns', 'email automation', 'campaign reporting'],
    exampleTasks: ['send a newsletter campaign', 'segment an audience', 'review open and click performance'],
    relatedItemIds: ['crm', 'convertkit', 'google-analytics'],
  },
  convertkit: {
    usedBySouls: ['Writer', 'Growth', 'Creator'],
    unlocks: ['creator email funnels', 'broadcasts', 'audience automation'],
    exampleTasks: ['send a creator broadcast', 'build a lead funnel', 'manage subscriber automation'],
    relatedItemIds: ['mailchimp', 'crm'],
  },
  payments: {
    usedBySouls: ['Finance', 'PM', 'Sales'],
    unlocks: ['subscriptions', 'billing workflows', 'revenue operations'],
    exampleTasks: ['review subscription state', 'handle invoice operations', 'analyze payment issues'],
    relatedItemIds: ['crm', 'shopify'],
  },
  shopify: {
    usedBySouls: ['Marketer', 'Ops', 'Sales'],
    unlocks: ['storefront operations', 'product management', 'order workflows'],
    exampleTasks: ['update a product catalog', 'review order issues', 'manage ecommerce flows'],
    relatedItemIds: ['payments', 'mailchimp'],
  },
  figma: {
    usedBySouls: ['Designer', 'PM', 'Engineer'],
    unlocks: ['design references', 'asset review', 'handoff workflows'],
    exampleTasks: ['inspect a design file', 'review UI handoff', 'trace asset usage'],
    relatedItemIds: ['knowledge', 'cloudinary'],
  },
  knowledge: {
    usedBySouls: ['PM', 'Writer', 'Researcher'],
    unlocks: ['docs', 'briefs', 'SOPs', 'knowledge operations'],
    exampleTasks: ['update an SOP', 'maintain planning docs', 'organize research notes'],
    relatedItemIds: ['algolia', 'pinecone', 'figma'],
  },
  cloudinary: {
    usedBySouls: ['Designer', 'Marketer', 'Writer'],
    unlocks: ['media transformations', 'asset delivery', 'image-heavy pipelines'],
    exampleTasks: ['optimize marketing images', 'deliver transformed assets', 'manage CMS media flows'],
    relatedItemIds: ['figma', 'wordpress', 'mux'],
  },
  mux: {
    usedBySouls: ['Marketer', 'Creator', 'Designer'],
    unlocks: ['video ingestion', 'streaming', 'playback analytics'],
    exampleTasks: ['publish a video asset', 'inspect playback performance', 'support video-heavy content'],
    relatedItemIds: ['cloudinary', 'wordpress'],
  },
};

export function getMarketplaceAppDetail(itemId: string): MarketplaceAppDetail | null {
  return MARKETPLACE_APP_DETAILS[itemId] || null;
}
