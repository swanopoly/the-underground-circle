import {
  CIRCLE_INTEGRATION_CATALOG,
  type CircleIntegrationCatalogItem,
  type CircleIntegrationPlatformKey,
} from './circleIntegrationCatalog';
import { inferTaskIntegrationRequirements, type CircleIntegrationProvider } from './circleIntegrations';

export type MarketplaceRecommendationReason =
  | 'required_connector'
  | 'required_capability'
  | 'workflow_match'
  | 'native_runtime';

export interface MarketplaceRecommendation {
  item: CircleIntegrationCatalogItem;
  reason: MarketplaceRecommendationReason;
  rationale: string;
  installed: boolean;
}

const CONNECTOR_TO_CATALOG_ID: Record<string, string> = {
  github: 'github',
  wordpress: 'wordpress',
  hubspot: 'crm',
  salesforce: 'salesforce',
  pipedrive: 'pipedrive',
  stripe: 'payments',
  shopify: 'shopify',
  aws: 'hosting',
  cloudflare: 'cloudflare',
  vercel: 'vercel',
  netlify: 'netlify',
  browserbase: 'browserbase',
  stagehand: 'stagehand',
  playwright: 'playwright-mcp',
  playwright_mcp: 'playwright-mcp',
  'playwright-mcp': 'playwright-mcp',
  browserless: 'browserless',
  browserstack: 'browserstack',
  firecrawl: 'firecrawl',
  apify: 'apify',
  steel: 'steel',
  hyperbrowser: 'hyperbrowser',
  airtop: 'airtop',
  skyvern: 'skyvern',
  browser_use: 'browser-use',
  'browser-use': 'browser-use',
  browseruse: 'browser-use',
  braintrust: 'braintrust',
  descope: 'descope',
  launchdarkly: 'launchdarkly',
  algolia: 'algolia',
  pinecone: 'pinecone',
  resend: 'resend-email',
  mailchimp: 'mailchimp',
  convertkit: 'convertkit',
  figma: 'figma',
  notion: 'knowledge',
  posthog: 'posthog',
  sentry: 'sentry',
  datadog: 'datadog',
  cloudinary: 'cloudinary',
  mux: 'mux',
  analytics: 'google-analytics',
  'google-analytics': 'google-analytics',
  search_console: 'search-console',
  'google-search-console': 'search-console',
  api: 'custom-api',
  custom_api: 'custom-api',
  'custom-api': 'custom-api',
  rest_api: 'custom-api',
  'rest-api': 'custom-api',
  webhook: 'custom-api',
};

const CONNECTOR_TO_PLATFORM_KEY: Partial<Record<string, CircleIntegrationPlatformKey>> = {
  github: 'github',
  wordpress: 'wordpress',
  hubspot: 'hubspot',
  stripe: 'stripe',
  aws: 'aws',
  cloudflare: 'cloudflare',
  analytics: 'google_analytics',
  'google-analytics': 'google_analytics',
  search_console: 'google_search_console',
  'google-search-console': 'google_search_console',
  browserbase: 'browserbase',
  stagehand: 'stagehand',
  playwright: 'playwright_mcp',
  playwright_mcp: 'playwright_mcp',
  'playwright-mcp': 'playwright_mcp',
  browserless: 'browserless',
  browserstack: 'browserstack',
  firecrawl: 'firecrawl',
  apify: 'apify',
  steel: 'steel',
  hyperbrowser: 'hyperbrowser',
  airtop: 'airtop',
  skyvern: 'skyvern',
  browser_use: 'browser_use',
  'browser-use': 'browser_use',
  browseruse: 'browser_use',
  api: 'custom_api',
  custom_api: 'custom_api',
  'custom-api': 'custom_api',
  rest_api: 'custom_api',
  'rest-api': 'custom_api',
  webhook: 'custom_api',
};

function getCatalogItem(id: string): CircleIntegrationCatalogItem | undefined {
  return CIRCLE_INTEGRATION_CATALOG.find(item => item.id === id);
}

function isInstalled(
  item: CircleIntegrationCatalogItem,
  installedProviders: Set<string>,
): boolean {
  if (!item.platformKey) return item.availability === 'available';
  return installedProviders.has(item.platformKey);
}

function addRecommendation(
  bucket: Map<string, MarketplaceRecommendation>,
  itemId: string,
  reason: MarketplaceRecommendationReason,
  rationale: string,
  installedProviders: Set<string>,
) {
  const item = getCatalogItem(itemId);
  if (!item) return;
  const existing = bucket.get(item.id);
  const next: MarketplaceRecommendation = {
    item,
    reason,
    rationale,
    installed: isInstalled(item, installedProviders),
  };
  if (!existing) {
    bucket.set(item.id, next);
    return;
  }
  const reasonRank: Record<MarketplaceRecommendationReason, number> = {
    required_connector: 4,
    required_capability: 3,
    workflow_match: 2,
    native_runtime: 1,
  };
  if (reasonRank[next.reason] > reasonRank[existing.reason]) {
    bucket.set(item.id, next);
  }
}

export function recommendMarketplaceItemsForWork(opts: {
  title: string;
  description?: string;
  profileKey?: string;
  tags?: string[];
  extraText?: string[];
  installedProviders?: Iterable<string>;
}): MarketplaceRecommendation[] {
  const installedProviders = new Set(Array.from(opts.installedProviders || []).map(value => String(value)));
  const text = [
    opts.title,
    opts.description || '',
    opts.profileKey || '',
    ...(opts.tags || []),
    ...(opts.extraText || []),
  ].join(' ').toLowerCase();

  const requirements = inferTaskIntegrationRequirements({
    title: opts.title,
    description: [opts.description || '', ...(opts.extraText || [])].join(' '),
    profileKey: opts.profileKey,
  });

  const bucket = new Map<string, MarketplaceRecommendation>();

  for (const connector of requirements.requiredConnectors) {
    const itemId = CONNECTOR_TO_CATALOG_ID[connector];
    if (!itemId) continue;
    addRecommendation(
      bucket,
      itemId,
      'required_connector',
      `Needed for ${connector.replace(/[_-]/g, ' ')} work in this plan.`,
      installedProviders,
    );
  }

  if (requirements.requiredCapabilities.length > 0) {
    for (const item of CIRCLE_INTEGRATION_CATALOG) {
      const itemText = [item.capabilityLabel, item.description, ...item.relationships].join(' ').toLowerCase();
      if (requirements.requiredCapabilities.some(cap => itemText.includes(cap.replace(/_/g, ' ')))) {
        addRecommendation(
          bucket,
          item.id,
          'required_capability',
          `Supports required capability coverage for ${requirements.requiredCapabilities.join(', ')}.`,
          installedProviders,
        );
      }
    }
  }

  if (/(agent|coding agent|automation|delegate|browser session|browser automation|qa flow|ui test)/i.test(text)) {
    addRecommendation(bucket, 'openswan-runtime', 'native_runtime', 'Useful for agent execution, delegation, and runtime control.', installedProviders);
    addRecommendation(bucket, 'browserbase', 'workflow_match', 'Useful for browser-driven tasks, QA, and remote web sessions.', installedProviders);
    addRecommendation(bucket, 'stagehand', 'workflow_match', 'Useful for natural-language browser actions and self-healing web workflows.', installedProviders);
    addRecommendation(bucket, 'playwright-mcp', 'workflow_match', 'Useful for deterministic browser control, DOM snapshots, screenshots, and test generation.', installedProviders);
  }
  if (/(cloud browser|browser fleet|browser-as-a-service|browser as a service|scale browser|parallel browser|managed browser session)/i.test(text)) {
    addRecommendation(bucket, 'hyperbrowser', 'workflow_match', 'Useful for scalable cloud browser sessions and Browser Use execution.', installedProviders);
    addRecommendation(bucket, 'steel', 'workflow_match', 'Useful for open browser-fleet infrastructure and controllable browser sessions.', installedProviders);
    addRecommendation(bucket, 'airtop', 'workflow_match', 'Useful for managed cloud browsers and AI-controlled web sessions.', installedProviders);
  }
  if (/(login|authenticated|credential|form fill|dashboard|portal|back office|website task|web ops|workflow automation)/i.test(text)) {
    addRecommendation(bucket, 'skyvern', 'workflow_match', 'Useful for authenticated dashboard and form workflows with vision-guided browser automation.', installedProviders);
    addRecommendation(bucket, 'airtop', 'workflow_match', 'Useful for managed browser profiles and natural-language task execution.', installedProviders);
    addRecommendation(bucket, 'browser-use', 'workflow_match', 'Useful for self-hosted browser-agent workflows when cost and control matter.', installedProviders);
  }
  if (/(screenshot|pdf|page capture|headless browser|puppeteer|html render|browserless)/i.test(text)) {
    addRecommendation(bucket, 'browserless', 'workflow_match', 'Useful for lower-cost screenshots, PDFs, scraping, and scripted headless-browser jobs.', installedProviders);
  }
  if (/(cross-browser|cross browser|real device|mobile browser|safari ios|browser matrix|release qa|visual regression)/i.test(text)) {
    addRecommendation(bucket, 'browserstack', 'workflow_match', 'Useful for release checks across real browsers, mobile devices, and session recordings.', installedProviders);
  }
  if (/(scrape|crawl|web data|extract data|markdown|rag ingestion|research corpus|competitive research|lead scrape)/i.test(text)) {
    addRecommendation(bucket, 'firecrawl', 'workflow_match', 'Useful for clean markdown, crawl, search, and structured extraction before agents spend browser tokens.', installedProviders);
    addRecommendation(bucket, 'apify', 'workflow_match', 'Useful for repeatable Actors, scheduled crawls, structured datasets, and production web-data jobs.', installedProviders);
  }
  if (/(eval|evaluation|prompt regression|quality|benchmark|research ops)/i.test(text)) {
    addRecommendation(bucket, 'braintrust', 'workflow_match', 'Useful for evals, prompt monitoring, and agent quality checks.', installedProviders);
  }
  if (/(vercel|frontend deploy|preview deploy|production deploy)/i.test(text)) {
    addRecommendation(bucket, 'vercel', 'workflow_match', 'Useful for frontend deployments, previews, and domain-linked releases.', installedProviders);
  }
  if (/(auth|identity|sso|mfa|access control|login flow)/i.test(text)) {
    addRecommendation(bucket, 'descope', 'workflow_match', 'Useful for auth, identity, and secure access workflows.', installedProviders);
  }
  if (/(search|discovery|docs search|site search)/i.test(text)) {
    addRecommendation(bucket, 'algolia', 'workflow_match', 'Useful for search and content discovery workflows.', installedProviders);
  }
  if (/(vector|embedding|semantic|memory recall|knowledge retrieval|rag)/i.test(text)) {
    addRecommendation(bucket, 'pinecone', 'workflow_match', 'Useful for semantic retrieval and long-term knowledge indexing.', installedProviders);
  }
  if (/(analytics|product metrics|experiment|feature flag|funnel)/i.test(text)) {
    addRecommendation(bucket, 'posthog', 'workflow_match', 'Useful for product analytics, funnels, and experimentation.', installedProviders);
    addRecommendation(bucket, 'launchdarkly', 'workflow_match', 'Useful for feature flags, guarded rollouts, and release experiments.', installedProviders);
  }
  if (/(error tracking|incident|exception|performance regression|production issue)/i.test(text)) {
    addRecommendation(bucket, 'sentry', 'workflow_match', 'Useful for production monitoring, release visibility, and incident triage.', installedProviders);
    addRecommendation(bucket, 'datadog', 'workflow_match', 'Useful for logs, monitors, metrics, and deeper operational visibility.', installedProviders);
  }
  if (/(email|approval|notification|lifecycle|transactional message)/i.test(text)) {
    addRecommendation(bucket, 'resend-email', 'workflow_match', 'Useful for transactional email, approvals, and notifications.', installedProviders);
    addRecommendation(bucket, 'mailchimp', 'workflow_match', 'Useful for lifecycle campaigns and audience messaging.', installedProviders);
    addRecommendation(bucket, 'convertkit', 'workflow_match', 'Useful for creator-style funnels and lifecycle messaging.', installedProviders);
  }
  if (/(knowledge base|docs|wiki|spec|sop|brief)/i.test(text)) {
    addRecommendation(bucket, 'knowledge', 'workflow_match', 'Useful for docs, SOPs, and operational knowledge systems.', installedProviders);
  }
  if (/(crm|deal|pipeline|lead|revenue ops|sales workflow)/i.test(text)) {
    addRecommendation(bucket, 'crm', 'workflow_match', 'Useful for CRM, contacts, deals, and revenue operations.', installedProviders);
    addRecommendation(bucket, 'salesforce', 'workflow_match', 'Useful for enterprise CRM and account workflows.', installedProviders);
    addRecommendation(bucket, 'pipedrive', 'workflow_match', 'Useful for lean sales pipeline workflows.', installedProviders);
  }
  if (/(ecommerce|storefront|product catalog|order management|shopify)/i.test(text)) {
    addRecommendation(bucket, 'shopify', 'workflow_match', 'Useful for storefront, products, and order workflows.', installedProviders);
    addRecommendation(bucket, 'payments', 'workflow_match', 'Useful for billing and payment operations.', installedProviders);
  }
  if (/(image|asset pipeline|media library|cdn image|creative asset)/i.test(text)) {
    addRecommendation(bucket, 'cloudinary', 'workflow_match', 'Useful for media transformation and asset delivery.', installedProviders);
    addRecommendation(bucket, 'figma', 'workflow_match', 'Useful for asset and design references.', installedProviders);
  }
  if (/(video|streaming|playback|media stream)/i.test(text)) {
    addRecommendation(bucket, 'mux', 'workflow_match', 'Useful for video ingestion, streaming, and playback analytics.', installedProviders);
  }

  return Array.from(bucket.values()).sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? 1 : -1;
    if (a.item.availability !== b.item.availability) return a.item.availability === 'available' ? -1 : 1;
    return a.item.label.localeCompare(b.item.label);
  });
}

export function getInstalledProviderSet(
  providers: Array<CircleIntegrationProvider | string>,
): Set<string> {
  return new Set(providers.map(provider => String(provider)));
}

export function getPrimaryMarketplaceGap(recommendations: MarketplaceRecommendation[]): string | null {
  const missing = recommendations.find(item => !item.installed && item.item.availability === 'available');
  if (missing) return `Install ${missing.item.label} to unlock stronger ownership.`;
  return null;
}
