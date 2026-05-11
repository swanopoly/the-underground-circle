import { listCircleIntegrationSecretKeys, listCircleIntegrations } from './circleIntegrations';

export interface SanitizedMarketplaceIntegration {
  id: string;
  provider: string;
  label: string;
  status: string;
  connected: boolean;
  capabilityFlags: string[];
  metadata: Record<string, string>;
  configuredSecretKeys: string[];
}

export interface MarketplaceIntegrationContext {
  circleId: string;
  integrations: SanitizedMarketplaceIntegration[];
  connectedCount: number;
  degradedCount: number;
  disabledCount: number;
}

interface LoadMarketplaceIntegrationContextOptions {
  includeSecretKeyNames?: boolean;
}

const SECRETISH_KEY_RE = /(secret|token|password|private|credential|api[_-]?key|access[_-]?key|refresh|client[_-]?secret)/i;
const SAFE_METADATA_KEYS = new Set([
  'workspaceName',
  'defaultModel',
  'defaultModelProvider',
  'defaultOrg',
  'defaultRegion',
  'defaultBrowser',
  'defaultProfile',
  'defaultDatabase',
  'defaultDatasetName',
  'defaultActorId',
  'defaultProjectKey',
  'defaultModel',
  'baseUrl',
  'teamKey',
  'projectRef',
  'clusterName',
  'workspace',
  'siteUrl',
]);

function clip(value: unknown, max = 90): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined | null): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (SECRETISH_KEY_RE.test(key)) continue;
    if (!SAFE_METADATA_KEYS.has(key) && key !== 'last_validation_error') continue;
    const text = clip(value);
    if (text) safe[key] = text;
  }
  return safe;
}

export async function loadMarketplaceIntegrationContext(
  circleId: string,
  opts: LoadMarketplaceIntegrationContextOptions = {},
): Promise<MarketplaceIntegrationContext> {
  const integrations = await listCircleIntegrations(circleId).catch(() => []);
  const activeIntegrations = integrations.filter((integration) => integration.is_active !== false);

  const sanitized = await Promise.all(activeIntegrations.map(async (integration) => {
    const configuredSecretKeys = opts.includeSecretKeyNames
      ? await listCircleIntegrationSecretKeys(integration.id).catch(() => [])
      : [];
    return {
      id: integration.id,
      provider: integration.provider,
      label: integration.display_name || integration.label || integration.provider,
      status: integration.status,
      connected: integration.status === 'connected',
      capabilityFlags: integration.capability_flags || [],
      metadata: sanitizeMetadata(integration.metadata),
      configuredSecretKeys,
    } satisfies SanitizedMarketplaceIntegration;
  }));

  return {
    circleId,
    integrations: sanitized,
    connectedCount: sanitized.filter((integration) => integration.connected).length,
    degradedCount: sanitized.filter((integration) => integration.status === 'degraded').length,
    disabledCount: sanitized.filter((integration) => integration.status === 'disabled').length,
  };
}

export function formatMarketplaceIntegrationContextForPrompt(
  context: MarketplaceIntegrationContext,
  maxChars = 1800,
): string | null {
  if (context.integrations.length === 0) return null;

  const lines = [
    '## Marketplace Integrations (sanitized)',
    `Connected: ${context.connectedCount}/${context.integrations.length}. Degraded: ${context.degradedCount}. Disabled: ${context.disabledCount}.`,
    'Security: secret values are never included here. Use approved integration tools, vault grants, or server-side functions; never ask the user to paste API keys into chat.',
  ];

  for (const integration of context.integrations.slice(0, 30)) {
    const caps = integration.capabilityFlags.slice(0, 5).join(', ') || 'capabilities not declared';
    const meta = Object.entries(integration.metadata)
      .map(([key, value]) => `${key}=${value}`)
      .slice(0, 4)
      .join(', ');
    const secrets = integration.configuredSecretKeys.length > 0
      ? `; secrets configured: ${integration.configuredSecretKeys.join(', ')} (values hidden)`
      : '';
    lines.push(`- ${integration.label} [${integration.provider}] ${integration.status}: ${caps}${meta ? `; metadata: ${meta}` : ''}${secrets}`);
  }

  let block = lines.join('\n');
  if (block.length > maxChars) {
    block = `${block.slice(0, maxChars - 18).trimEnd()}\n...[truncated]`;
  }
  return block;
}

export async function buildMarketplaceIntegrationPromptBlock(circleId: string): Promise<string | null> {
  const context = await loadMarketplaceIntegrationContext(circleId);
  return formatMarketplaceIntegrationContextForPrompt(context);
}

export function formatMarketplaceIntegrationListForChat(context: MarketplaceIntegrationContext): string {
  if (context.integrations.length === 0) return 'No marketplace integrations are connected yet.';
  const lines = [
    `Connected marketplace integrations: ${context.connectedCount}/${context.integrations.length}`,
    ...context.integrations.map((integration) => {
    const caps = integration.capabilityFlags.slice(0, 4).join(', ') || 'no capabilities listed';
    const secretState = integration.configuredSecretKeys.length > 0 ? ' - keys saved' : '';
    return `- ${integration.label} [${integration.provider}] ${integration.status} - ${caps}${secretState}`;
  }),
  ];
  return lines.join('\n');
}
