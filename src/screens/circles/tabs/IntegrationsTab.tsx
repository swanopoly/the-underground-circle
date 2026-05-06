import React, { useEffect, useMemo, useState } from 'react';
import {
  Platform as RNPlatform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import WordPressConnector from '../../../components/integrations/WordPressConnector';
import WordPressPostForm from '../../../components/integrations/WordPressPostForm';
import LoadingWave from '../../../components/LoadingWave';
import {
  CIRCLE_INTEGRATION_CATALOG,
  CIRCLE_INTEGRATION_GROUPS,
  type CircleIntegrationCatalogItem,
  type CircleIntegrationGroupKey,
  type CircleIntegrationPlatformKey,
} from '../../../lib/circleIntegrationCatalog';
import {
  buildCircleCapabilityPreflight,
  connectGenericCircleIntegration,
  INTEGRATION_DEFINITIONS,
  listCircleIntegrationSecretKeys,
  listCircleIntegrations,
  type CircleIntegrationRecord,
  validateCircleIntegrationSetup,
} from '../../../lib/circleIntegrations';
import { getMarketplaceAppDetail } from '../../../lib/marketplaceAppDetails';
import { getCircleDiscordConfig } from '../../../lib/discord';
import { getSlackConfig } from '../../../lib/slack';
import { supabase } from '../../../lib/supabase';
import { loadCircleSiteCredentials, loadSiteCredentials, type SiteCredential } from '../../../lib/siteAutomation';
import { getTeamsConfig } from '../../../lib/teams';
import DiscordTab from './DiscordTab';
import GitHubTab from './GitHubTab';
import HeliusTab from './HeliusTab';
import SlackTab from './SlackTab';
import TeamsTab from './TeamsTab';

type PlatformKey = 'none' | CircleIntegrationPlatformKey;
type MarketplaceFilter = 'all' | 'installed' | 'ready' | 'native';
type GenericMarketplaceProvider = Exclude<
  CircleIntegrationPlatformKey,
  'github' | 'wordpress' | 'slack' | 'teams' | 'discord' | 'helius'
>;

interface PlatformStatus {
  connected: boolean;
  name?: string;
  hint?: string;
  integrationId?: string;
  secretKeys?: string[];
  metadata?: Record<string, unknown>;
  validation?: {
    ok: boolean;
    missingSecretKeys: string[];
    missingMetadataFields: string[];
    providerWarnings: string[];
  };
}

const GENERIC_MARKETPLACE_PROVIDERS: GenericMarketplaceProvider[] = [
  'browserbase',
  'stagehand',
  'playwright_mcp',
  'browserless',
  'browserstack',
  'firecrawl',
  'apify',
  'steel',
  'hyperbrowser',
  'airtop',
  'skyvern',
  'browser_use',
  'braintrust',
  'vercel',
  'netlify',
  'descope',
  'launchdarkly',
  'algolia',
  'pinecone',
  'aws',
  'cloudflare',
  'cloudinary',
  'resend',
  'hubspot',
  'google_analytics',
  'google_search_console',
  'google_ads',
  'meta_ads',
  'mailchimp',
  'convertkit',
  'figma',
  'notion',
  'datadog',
  'posthog',
  'sentry',
  'mux',
  'shopify',
  'stripe',
  'salesforce',
  'pipedrive',
  // ── Wave 1 expansion ──
  'docker',
  'kubernetes',
  'fly_io',
  'railway',
  'render',
  'digitalocean',
  'supabase',
  'neon',
  'mongodb_atlas',
  'upstash',
  'hugging_face',
  'replicate',
  'modal',
  'openrouter',
  'linear',
  'jira',
  'snyk',
  'clerk',
  'postmark',
  'cloudflare_r2',
  'qdrant',
  'ngrok',
  'trigger_dev',
];

function createEmptyStatuses(): Record<CircleIntegrationPlatformKey, PlatformStatus> {
  return CIRCLE_INTEGRATION_CATALOG.reduce((acc, item) => {
    if (item.platformKey) acc[item.platformKey] = { connected: false };
    return acc;
  }, {} as Record<CircleIntegrationPlatformKey, PlatformStatus>);
}

function hostnameFromUrl(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname;
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

function getPrimaryWordPressCredential(
  credentials: SiteCredential[],
  circleId: string,
): SiteCredential | null {
  if (credentials.length === 0) return null;
  const exact = credentials.find((cred: any) => cred.metadata?.circleId === circleId);
  return exact || credentials[0] || null;
}

function PlatformCard({
  item,
  status,
  isWide,
  onPress,
}: {
  item: CircleIntegrationCatalogItem;
  status?: PlatformStatus;
  isWide: boolean;
  onPress?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const clickable = !!onPress;
  const connected = !!status?.connected;
  const availabilityLabel = connected ? 'Active' : 'Ready';

  return (
    <Pressable
      disabled={!clickable}
      onPress={onPress}
      {...(RNPlatform.OS === 'web' && clickable ? {
        onHoverIn: () => setHovered(true),
        onHoverOut: () => setHovered(false),
      } : {})}
      style={[
        styles.platformCard,
        isWide && styles.platformCardWide,
        {
          borderColor: connected ? item.color + '40' : '#2a2a2a',
          opacity: 1,
        },
        hovered && clickable && styles.platformCardHovered,
        hovered && clickable && { borderColor: item.color + '60' },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconCircle, { backgroundColor: item.color + '18' }]}>
          <Text style={[styles.platformIconText, item.icon.length > 2 && styles.platformIconTextSmall]}>{item.icon}</Text>
        </View>
        <View style={styles.cardTopRight}>
          {item.recentlyAdded ? (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>New</Text>
            </View>
          ) : null}
          <View style={[
            styles.statusBadge,
            connected && { backgroundColor: '#22c55e15', borderColor: '#22c55e30' },
          ]}>
            <View style={[
            styles.statusDot,
            connected ? { backgroundColor: '#22c55e' } : { backgroundColor: item.color },
          ]} />
            <Text style={[
              styles.statusLabel,
              connected && { color: '#22c55e' },
              !connected && { color: item.color },
            ]}>
              {availabilityLabel}
            </Text>
          </View>
          <View style={styles.scopeBadge}>
            <Text style={styles.scopeBadgeText}>{item.scopeLabel}</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.platformName, { color: item.color }]}>{item.label}</Text>
      <Text style={styles.capabilityLabel}>{item.capabilityLabel}</Text>

      {status?.name ? <Text style={styles.connectedTo}>{status.name}</Text> : null}
      {status?.hint ? <Text style={styles.connectedHint}>{status.hint}</Text> : null}

      <Text style={styles.platformDesc}>{item.description}</Text>

      <View style={styles.relationshipRow}>
        {item.relationships.slice(0, 3).map(rel => (
          <View key={rel} style={styles.relationshipChip}>
            <Text style={styles.relationshipChipText}>{rel}</Text>
          </View>
        ))}
      </View>

      <View style={[
        styles.cardAction,
        { backgroundColor: item.color + '12', borderColor: item.color + '25' },
      ]}>
        <Text style={[styles.cardActionText, { color: item.color }]}>
          {connected ? 'Manage →' : clickable ? 'Connect →' : 'Built in'}
        </Text>
      </View>
    </Pressable>
  );
}

// Reusable accordion section for marketplace detail pages. Title bar
// uses the per-platform accent at low opacity when open; tap to toggle.
function MarketplaceAccordion({
  title,
  defaultOpen = false,
  accentColor,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  accentColor: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[styles.mpAccordionCard, open && { borderColor: accentColor + '55' }]}>
      <Pressable
        onPress={() => setOpen(v => !v)}
        style={({ hovered }: any) => [
          styles.mpAccordionHeader,
          open && { backgroundColor: accentColor + '0e' },
          hovered && !open && { backgroundColor: '#11141d' },
        ]}
      >
        <Text style={[styles.mpAccordionTitle, open && { color: accentColor }]}>{title}</Text>
        <View style={[
          styles.mpAccordionChevron,
          ...(RNPlatform.OS === 'web' ? [{ transition: 'transform 0.18s ease' } as any] : []),
          { transform: [{ rotate: open ? '90deg' : '0deg' }] },
        ]}>
          <Text style={[styles.mpAccordionChevronText, { color: open ? accentColor : '#94a3b8' }]}>›</Text>
        </View>
      </Pressable>
      {open ? <View style={styles.mpAccordionBody}>{children}</View> : null}
    </View>
  );
}

function MarketplaceAppOverview({
  item,
  onOpenRelated,
  accentColor,
}: {
  item: CircleIntegrationCatalogItem;
  onOpenRelated?: (itemId: string) => void;
  accentColor: string;
}) {
  const detail = getMarketplaceAppDetail(item.id);
  if (!detail) return null;

  const hasRelated = !!(detail.relatedItemIds && detail.relatedItemIds.length > 0 && onOpenRelated);

  return (
    <View style={styles.mpAccordionGroup}>
      <MarketplaceAccordion title="What this unlocks" accentColor={accentColor} defaultOpen>
        <Text style={styles.marketplaceOverviewText}>
          This app expands what the circle can own end-to-end across Souls, tasks, and operational workflows.
        </Text>
        {detail.unlocks.map(value => (
          <Text key={value} style={styles.marketplaceOverviewBullet}>- {value}</Text>
        ))}
      </MarketplaceAccordion>

      <MarketplaceAccordion title={`Used by Souls (${detail.usedBySouls.length})`} accentColor={accentColor}>
        <View style={styles.detailChipRow}>
          {detail.usedBySouls.map(value => (
            <View key={value} style={styles.detailChip}>
              <Text style={styles.detailChipText}>{value}</Text>
            </View>
          ))}
        </View>
      </MarketplaceAccordion>

      <MarketplaceAccordion title={`Example tasks (${detail.exampleTasks.length})`} accentColor={accentColor}>
        {detail.exampleTasks.map(value => (
          <Text key={value} style={styles.marketplaceOverviewBullet}>- {value}</Text>
        ))}
      </MarketplaceAccordion>

      {hasRelated ? (
        <MarketplaceAccordion title={`Related apps (${detail.relatedItemIds!.length})`} accentColor={accentColor}>
          <View style={styles.detailChipRow}>
            {detail.relatedItemIds!.map(itemId => {
              const related = CIRCLE_INTEGRATION_CATALOG.find(entry => entry.id === itemId);
              if (!related) return null;
              return (
                <Pressable
                  key={itemId}
                  onPress={() => onOpenRelated!(itemId)}
                  style={[styles.detailChip, styles.detailChipInteractive]}
                >
                  <Text style={[styles.detailChipText, { color: related.color }]}>{related.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </MarketplaceAccordion>
      ) : null}
    </View>
  );
}

function WordPressManager({
  circleId,
  credential,
  onRefresh,
}: {
  circleId: string;
  credential: SiteCredential | null;
  onRefresh: () => void;
}) {
  const accentColor = '#21759B';
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  return (
    <View style={styles.platformDetailShell}>
      <View style={styles.detailIntro}>
        <Text style={styles.detailTitle}>WordPress</Text>
        <Text style={styles.detailText}>
          This connector powers content publishing, site updates, editorial workflows, and marketing operations across the circle.
        </Text>
      </View>

      {credential ? (
        <>
          <View style={styles.detailSummaryCard}>
            <Text style={styles.detailSummaryLabel}>CONNECTED SITE</Text>
            <Text style={[styles.detailSummaryValue, { color: accentColor }]}>
              {hostnameFromUrl(credential.siteUrl) || credential.label || 'WordPress'}
            </Text>
            <Text style={styles.detailSummaryText}>
              {credential.username ? `User: ${credential.username}` : 'Credential ready'}
            </Text>
            <Text style={styles.detailSummaryText}>
              Available across chat publishing, Spirit operations, and agent execution paths for this circle.
            </Text>
          </View>

          <WordPressPostForm
            credential={credential}
            accentColor={accentColor}
            onPublished={(url) => {
              setPublishedUrl(url);
              onRefresh();
            }}
          />

          {publishedUrl ? (
            <View style={styles.detailSummaryCard}>
              <Text style={styles.detailSummaryLabel}>LAST PUBLISHED</Text>
              <Text selectable style={styles.detailSummaryText}>{publishedUrl}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <WordPressConnector circleId={circleId} onConnected={onRefresh} accentColor={accentColor} />
      )}
    </View>
  );
}

function GenericIntegrationManager({
  circleId,
  provider,
  status,
  onRefresh,
}: {
  circleId: string;
  provider: GenericMarketplaceProvider;
  status?: PlatformStatus;
  onRefresh: () => void;
}) {
  const definition = INTEGRATION_DEFINITIONS[provider];
  const accentColor =
    provider === 'aws' ? '#FF9900'
      : provider === 'cloudflare' ? '#F97316'
      : provider === 'hubspot' ? '#F97316'
      : provider === 'google_analytics' ? '#F59E0B'
      : provider === 'google_search_console' ? '#10B981'
      : definition?.provider === 'vercel' ? '#ffffff'
      : definition?.provider === 'descope' ? '#60a5fa'
      : definition?.provider === 'browserbase' ? '#14b8a6'
      : definition?.provider === 'stagehand' ? '#06b6d4'
      : definition?.provider === 'playwright_mcp' ? '#2dd4bf'
      : definition?.provider === 'browserless' ? '#f97316'
      : definition?.provider === 'browserstack' ? '#f59e0b'
      : definition?.provider === 'firecrawl' ? '#ef4444'
      : definition?.provider === 'apify' ? '#22c55e'
      : definition?.provider === 'steel' ? '#94a3b8'
      : definition?.provider === 'hyperbrowser' ? '#38bdf8'
      : definition?.provider === 'airtop' ? '#60a5fa'
      : definition?.provider === 'skyvern' ? '#a78bfa'
      : definition?.provider === 'browser_use' ? '#34d399'
      : definition?.provider === 'braintrust' ? '#8b5cf6'
      : definition?.provider === 'algolia' ? '#0ea5e9'
      : definition?.provider === 'pinecone' ? '#a855f7'
      : definition?.provider === 'resend' ? '#f43f5e'
      : definition?.provider === 'posthog' ? '#f97316'
      : definition?.provider === 'sentry' ? '#a78bfa'
      : '#635BFF';
  const [displayName, setDisplayName] = useState(status?.name || definition.label);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [preflight, setPreflight] = useState<{ ok: boolean; missingCapabilities: string[]; missingConnectors: string[] } | null>(null);

  useEffect(() => {
    setDisplayName(status?.name || definition.label);
  }, [definition.label, status?.name]);

  useEffect(() => {
    const nextMetadata = Object.entries(status?.metadata || {}).reduce<Record<string, string>>((acc, [key, value]) => {
      if (typeof value === 'string') acc[key] = value;
      return acc;
    }, {});
    setMetadata(nextMetadata);
  }, [status?.metadata]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await buildCircleCapabilityPreflight({
        circleId,
        requiredCapabilities: definition.capabilityFlags,
      });
      if (!cancelled) setPreflight(result);
    })();
    return () => { cancelled = true; };
  }, [circleId, definition.capabilityFlags]);

  const handleSave = async () => {
    setSaving(true);
    const integration = await connectGenericCircleIntegration({
      circleId,
      provider,
      displayName,
      metadata,
      secrets,
    });
    setSaving(false);
    if (integration) {
      setMessage(`${definition.label} connected for this circle.`);
      onRefresh();
    } else {
      setMessage(`Failed to save ${definition.label} integration.`);
    }
  };

  return (
    <ScrollView style={styles.platformDetailShell} contentContainerStyle={styles.genericDetailContent}>
      <View style={styles.detailIntro}>
        <Text style={styles.detailTitle}>{definition.label}</Text>
        <Text style={styles.detailText}>{definition.description}</Text>
      </View>

      <View style={styles.detailSummaryCard}>
        <Text style={styles.detailSummaryLabel}>CAPABILITIES</Text>
        {definition.capabilityFlags.map(flag => (
          <Text key={flag} style={styles.detailSummaryText}>- {flag}</Text>
        ))}
      </View>

      {definition.validationHints && definition.validationHints.length > 0 ? (
        <View style={styles.detailSummaryCard}>
          <Text style={styles.detailSummaryLabel}>SETUP NOTES</Text>
          {definition.validationHints.map(hint => (
            <Text key={hint} style={styles.detailSummaryText}>- {hint}</Text>
          ))}
        </View>
      ) : null}

      <View style={styles.detailSummaryCard}>
        <Text style={styles.detailSummaryLabel}>CONNECTION</Text>
        <Text style={[styles.detailSummaryValue, { color: accentColor }]}>{status?.connected ? 'Active' : 'Not connected'}</Text>
        {status?.hint ? <Text style={styles.detailSummaryText}>{status.hint}</Text> : null}
        {status?.secretKeys && status.secretKeys.length > 0 ? (
          <Text style={styles.detailSummaryText}>Saved secrets: {status.secretKeys.join(', ')}</Text>
        ) : null}
        {status?.validation && !status.validation.ok ? (
          <>
            {status.validation.missingSecretKeys.length > 0 ? (
              <Text style={styles.detailSummaryText}>
                Missing secrets: {status.validation.missingSecretKeys.join(', ')}
              </Text>
            ) : null}
            {status.validation.missingMetadataFields.length > 0 ? (
              <Text style={styles.detailSummaryText}>
                Missing fields: {status.validation.missingMetadataFields.join(', ')}
              </Text>
            ) : null}
            {status.validation.providerWarnings.length > 0 ? (
              <Text style={styles.detailSummaryText}>
                Provider warnings: {status.validation.providerWarnings.join(' | ')}
              </Text>
            ) : null}
          </>
        ) : null}
        {preflight && !preflight.ok ? (
          <Text style={styles.detailSummaryText}>
            Missing capabilities: {preflight.missingCapabilities.join(', ') || 'none'}
          </Text>
        ) : null}
      </View>

      <View style={styles.genericFormCard}>
        <Text style={styles.genericFieldLabel}>DISPLAY NAME</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={definition.label}
          placeholderTextColor="#5b6474"
          style={styles.genericInput}
        />
      </View>

      <View style={styles.genericFormCard}>
        {definition.metadataFields?.map(field => (
          <View key={field.key} style={styles.genericFieldBlock}>
            <Text style={styles.genericFieldLabel}>{field.label.toUpperCase()}</Text>
            <TextInput
              value={metadata[field.key] || ''}
              onChangeText={(value) => setMetadata(prev => ({ ...prev, [field.key]: value }))}
              placeholder={field.placeholder || ''}
              placeholderTextColor="#5b6474"
              style={styles.genericInput}
            />
          </View>
        ))}

        {definition.requiredSecretKeys.map(secretKey => (
          <View key={secretKey} style={styles.genericFieldBlock}>
            <Text style={styles.genericFieldLabel}>{secretKey.toUpperCase()}</Text>
            <TextInput
              value={secrets[secretKey] || ''}
              onChangeText={(value) => setSecrets(prev => ({ ...prev, [secretKey]: value }))}
              placeholder="Paste value"
              placeholderTextColor="#5b6474"
              secureTextEntry
              style={styles.genericInput}
            />
          </View>
        ))}

        {definition.optionalSecretKeys && definition.optionalSecretKeys.length > 0 ? (
          <>
            <Text style={styles.genericFieldLabel}>OPTIONAL SECRETS</Text>
            {definition.optionalSecretKeys.map(secretKey => (
              <View key={secretKey} style={styles.genericFieldBlock}>
                <TextInput
                  value={secrets[secretKey] || ''}
                  onChangeText={(value) => setSecrets(prev => ({ ...prev, [secretKey]: value }))}
                  placeholder={secretKey}
                  placeholderTextColor="#5b6474"
                  secureTextEntry
                  style={styles.genericInput}
                />
              </View>
            ))}
          </>
        ) : null}
      </View>

      <Pressable onPress={handleSave} style={[styles.genericSaveBtn, { borderColor: accentColor + '55', backgroundColor: accentColor + '18' }, saving && { opacity: 0.6 }]}>
        <Text style={[styles.genericSaveBtnText, { color: accentColor }]}>{saving ? 'Saving...' : `Save ${definition.label}`}</Text>
      </Pressable>

      {message ? <Text style={styles.genericStatus}>{message}</Text> : null}
    </ScrollView>
  );
}

export default function MarketplaceTab({
  circleId,
  initialFocusItemId,
  initialFocusGroup,
  focusTs,
}: {
  circleId: string;
  initialFocusItemId?: string | null;
  initialFocusGroup?: CircleIntegrationGroupKey | null;
  focusTs?: number;
}) {
  const { width } = useWindowDimensions();
  const cardsPerRow = width >= 1500 ? 5 : width >= 1240 ? 4 : width >= 980 ? 3 : width >= 640 ? 2 : 1;
  const cardBasis = cardsPerRow === 5 ? '19%' : cardsPerRow === 4 ? '23.5%' : cardsPerRow === 3 ? '31.5%' : cardsPerRow === 2 ? '48.5%' : '100%';
  const [activePlatform, setActivePlatform] = useState<PlatformKey>('none');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroupFilter, setActiveGroupFilter] = useState<CircleIntegrationGroupKey | 'all' | 'models'>('all');
  // Sort: 'popular' uses curated `popularityRank` (set on the catalog
  // entries — anthropic / openai first, replicate pinned to bottom).
  // 'alphabetical' is straightforward label sort. 'recent' surfaces
  // the `recentlyAdded` set first.
  const [sortMode, setSortMode] = useState<'popular' | 'alphabetical' | 'recent'>('popular');
  const [activeMarketplaceFilter, setActiveMarketplaceFilter] = useState<MarketplaceFilter>('all');
  const [wordpressCredential, setWordpressCredential] = useState<SiteCredential | null>(null);
  const [statuses, setStatuses] = useState<Record<CircleIntegrationPlatformKey, PlatformStatus>>(createEmptyStatuses());
  useEffect(() => {
    void loadStatuses();
  }, [circleId]);

  useEffect(() => {
    if (!focusTs) return;
    const focusedItem = initialFocusItemId
      ? CIRCLE_INTEGRATION_CATALOG.find(item => item.id === initialFocusItemId)
      : null;
    if (focusedItem?.platformKey) {
      setActivePlatform(focusedItem.platformKey);
      return;
    }
    setActivePlatform('none');
    setActiveMarketplaceFilter('all');
    setSearchQuery(focusedItem?.label || '');
    setActiveGroupFilter(
      focusedItem?.group
      || initialFocusGroup
      || 'all'
    );
  }, [focusTs, initialFocusGroup, initialFocusItemId]);

  const loadStatuses = async () => {
    setLoading(true);
    try {
      const [slackConfig, teamsConfig, discordConfig, ghConns, heliusKey, wpCreds, circleIntegrations] = await Promise.all([
        getSlackConfig(circleId).catch(() => null),
        getTeamsConfig(circleId).catch(() => null),
        getCircleDiscordConfig(circleId).catch(() => ({ guild_id: null, bot_token: null, webhook_url: null, connected_at: null })),
        supabase
          .from('circle_github_connections')
          .select('full_name')
          .eq('circle_id', circleId)
          .eq('is_active', true)
          .then(r => r.data, () => null),
        supabase.rpc('list_user_api_keys')
          .then(r => {
            const keys = r.data || [];
            return keys.find((k: any) => k.provider === 'helius' && k.is_active) || null;
          }, () => null),
        loadCircleSiteCredentials(circleId, 'wordpress')
          .then(rows => rows.length > 0 ? rows : loadSiteCredentials('wordpress'))
          .catch(() => loadSiteCredentials('wordpress')),
        listCircleIntegrations(circleId).catch(() => []),
      ]);

      const integrationByProvider = new Map<string, CircleIntegrationRecord>();
      for (const integration of circleIntegrations) integrationByProvider.set(integration.provider, integration);

      const genericStatusEntries = await Promise.all(
        GENERIC_MARKETPLACE_PROVIDERS.map(async (provider) => {
          const integration = integrationByProvider.get(provider);
          if (!integration) {
            return [
              provider,
              {
                connected: false,
                hint: `Connect ${INTEGRATION_DEFINITIONS[provider]?.label || provider} for circle-wide workflows.`,
              } satisfies PlatformStatus,
            ] as const;
          }

          const [secretKeys, validation] = await Promise.all([
            listCircleIntegrationSecretKeys(integration.id),
            validateCircleIntegrationSetup(integration),
          ]);

          const missing = [
            ...(validation?.missingSecretKeys || []),
            ...(validation?.missingMetadataFields || []),
            ...(validation?.providerWarnings || []),
          ];

          return [
            provider,
            {
              connected: true,
              name: integration.display_name || INTEGRATION_DEFINITIONS[provider]?.label || provider,
              hint: validation?.ok
                ? `${INTEGRATION_DEFINITIONS[provider]?.label || provider} is installed for this circle.`
                : `Setup incomplete: ${missing.join(', ')}`,
              integrationId: integration.id,
              secretKeys,
              metadata: (integration.metadata as Record<string, unknown>) || {},
              validation: validation || undefined,
            } satisfies PlatformStatus,
          ] as const;
        })
      );

      const primaryWordPress = getPrimaryWordPressCredential(wpCreds, circleId);
      setWordpressCredential(primaryWordPress);

      setStatuses({
        ...createEmptyStatuses(),
        github: {
          connected: !!(ghConns && ghConns.length > 0),
          name: ghConns && ghConns.length > 0 ? `${ghConns.length} repo${ghConns.length > 1 ? 's' : ''} connected` : undefined,
          hint: ghConns && ghConns.length > 0 ? 'Feeds rooms, Office activity, tasks, and coding agents.' : 'Connect repos once and reuse them across the circle.',
        },
        wordpress: {
          connected: !!primaryWordPress,
          name: primaryWordPress ? (hostnameFromUrl(primaryWordPress.siteUrl) || primaryWordPress.label || 'WordPress connected') : undefined,
          hint: primaryWordPress ? 'Available for publishing and content operations.' : 'Connect a site for posting, drafting, and migration work.',
        },
        slack: {
          connected: !!slackConfig,
          name: slackConfig?.team_name || undefined,
          hint: slackConfig ? 'Circle alerts and agent updates can route here.' : 'Useful for approvals, check-ins, and team notifications.',
        },
        teams: {
          connected: !!teamsConfig,
          name: teamsConfig?.team_name || undefined,
          hint: teamsConfig ? 'Enterprise notifications are active.' : 'Best for enterprise coordination and approvals.',
        },
        discord: {
          connected: !!discordConfig?.guild_id,
          name: discordConfig?.guild_id ? 'Server connected' : undefined,
          hint: discordConfig?.guild_id ? 'Community and server messaging are available.' : 'Best for community engagement and public collaboration.',
        },
        helius: {
          connected: !!heliusKey,
          name: heliusKey ? 'API key active' : undefined,
          hint: heliusKey ? 'Trading and onchain workflows are enabled.' : 'Needed for crypto-native treasury and trading workflows.',
        },
        ...Object.fromEntries(genericStatusEntries),
      });
    } catch (err) {
      console.error('Integration status load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const connectedCount = useMemo(
    () => Object.values(statuses).filter(status => status.connected).length,
    [statuses],
  );
  const availableCount = useMemo(
    () => CIRCLE_INTEGRATION_CATALOG.filter(item => item.availability === 'available').length,
    [],
  );
  const nativeCount = useMemo(
    () => CIRCLE_INTEGRATION_CATALOG.filter(item => item.availability === 'available' && !item.platformKey).length,
    [],
  );
  const externalCount = useMemo(
    () => CIRCLE_INTEGRATION_CATALOG.filter(item => item.platformKey).length,
    [],
  );
  const installedPlatformKeys = useMemo(
    () => new Set(
      Object.entries(statuses)
        .filter(([, status]) => status.connected)
        .map(([key]) => key as CircleIntegrationPlatformKey)
    ),
    [statuses],
  );
  // Provider keys that show up under the "Models" quick filter — every
  // LLM provider the chat picker can route through. Marketplaces (top
  // row) plus native BYOK providers (second row). Kept narrow on
  // purpose: the broader 'ai_agents_services' group also includes
  // browser/automation tools and observability shims that aren't models.
  const MODEL_PROVIDER_KEYS: ReadonlySet<string> = useMemo(
    () => new Set([
      // Marketplaces
      'openrouter', 'hugging_face', 'replicate', 'modal',
      // Native BYOK
      'anthropic', 'openai', 'google_ai', 'groq', 'mistral_ai',
      'cohere', 'perplexity', 'together_ai', 'fireworks_ai',
      'deepseek', 'z_ai', 'minimax', 'ollama',
    ]),
    [],
  );

  const filteredCatalogItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = CIRCLE_INTEGRATION_CATALOG.filter(item => {
      if (activeGroupFilter === 'models') {
        if (!item.platformKey || !MODEL_PROVIDER_KEYS.has(item.platformKey)) return false;
      } else if (activeGroupFilter !== 'all' && item.group !== activeGroupFilter) return false;

      if (activeMarketplaceFilter === 'installed') {
        if (!item.platformKey || !installedPlatformKeys.has(item.platformKey)) return false;
      } else if (activeMarketplaceFilter === 'ready') {
        if (item.availability !== 'available') return false;
      } else if (activeMarketplaceFilter === 'native') {
        if (!(item.availability === 'available' && !item.platformKey)) return false;
      }

      if (!q) return true;
      const haystack = [
        item.label,
        item.description,
        item.capabilityLabel,
        item.scopeLabel,
        ...item.relationships,
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    // Sort applied last so it operates on the visible subset.
    if (sortMode === 'alphabetical') {
      return [...filtered].sort((a, b) => a.label.localeCompare(b.label));
    }
    if (sortMode === 'recent') {
      // recentlyAdded first, then everything else in catalog order.
      return [...filtered].sort((a, b) => {
        const ar = a.recentlyAdded ? 0 : 1;
        const br = b.recentlyAdded ? 0 : 1;
        return ar - br;
      });
    }
    // popular: lower popularityRank first; missing ranks fall to bottom
    // and break ties alphabetically so the long tail still has stable
    // ordering instead of catalog-array drift.
    const POP_FALLBACK = 9_000;
    return [...filtered].sort((a, b) => {
      const ar = a.popularityRank ?? POP_FALLBACK;
      const br = b.popularityRank ?? POP_FALLBACK;
      if (ar !== br) return ar - br;
      return a.label.localeCompare(b.label);
    });
  }, [MODEL_PROVIDER_KEYS, activeGroupFilter, activeMarketplaceFilter, installedPlatformKeys, searchQuery, sortMode]);
  const visibleItemsCount = useMemo(() => {
    return filteredCatalogItems.length;
  }, [filteredCatalogItems]);
  const agentAppCount = useMemo(
    () => CIRCLE_INTEGRATION_CATALOG.filter(item => item.group === 'ai_agents_services').length,
    [],
  );

  const handleBack = () => {
    setActivePlatform('none');
    void loadStatuses();
  };

  if (activePlatform !== 'none') {
    const activeItem = CIRCLE_INTEGRATION_CATALOG.find(item => item.platformKey === activePlatform) || null;
    const activeStatus = statuses[activePlatform as CircleIntegrationPlatformKey];
    const heroAccent = activeItem?.color || '#6366f1';
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator>
        <View style={styles.inner}>
          <Pressable onPress={handleBack} style={styles.backRow}>
            <Text style={styles.backText}>← All Marketplace Apps</Text>
          </Pressable>

          {activeItem ? (
            <View style={[styles.mpHeroCard, { borderColor: heroAccent + '44' }]}>
              <View style={styles.mpHeroTop}>
                <View style={[styles.mpHeroIcon, { backgroundColor: heroAccent + '22', borderColor: heroAccent + '55' }]} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.mpHeroLabel, { color: heroAccent }]}>{activeItem.label}</Text>
                  <Text style={styles.mpHeroDesc} numberOfLines={3}>{activeItem.description}</Text>
                </View>
                <View style={[
                  styles.mpHeroStatus,
                  activeStatus?.connected
                    ? { backgroundColor: '#22c55e22', borderColor: '#22c55e88' }
                    : { backgroundColor: '#1f2937', borderColor: '#334155' },
                ]}>
                  <Text style={{
                    color: activeStatus?.connected ? '#22c55e' : '#94a3b8',
                    fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace',
                  }}>
                    {activeStatus?.connected ? '● ACTIVE' : '○ NOT CONNECTED'}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          <MarketplaceAccordion title="Setup & connect" accentColor={heroAccent} defaultOpen>
            <View style={styles.platformContent}>
              {activePlatform === 'github' && <GitHubTab circleId={circleId} />}
              {activePlatform === 'wordpress' && (
                <WordPressManager
                  circleId={circleId}
                  credential={wordpressCredential}
                  onRefresh={() => { void loadStatuses(); }}
                />
              )}
              {activePlatform === 'slack' && <SlackTab circleId={circleId} />}
              {activePlatform === 'teams' && <TeamsTab circleId={circleId} />}
              {activePlatform === 'discord' && <DiscordTab circleId={circleId} />}
              {activePlatform === 'helius' && <HeliusTab circleId={circleId} />}
              {GENERIC_MARKETPLACE_PROVIDERS.includes(activePlatform as GenericMarketplaceProvider) && (
                <GenericIntegrationManager
                  circleId={circleId}
                  provider={activePlatform as GenericMarketplaceProvider}
                  status={statuses[activePlatform as CircleIntegrationPlatformKey]}
                  onRefresh={() => { void loadStatuses(); }}
                />
              )}
            </View>
          </MarketplaceAccordion>

          {activeItem ? (
            <MarketplaceAppOverview
              item={activeItem}
              accentColor={heroAccent}
              onOpenRelated={(itemId) => {
                const related = CIRCLE_INTEGRATION_CATALOG.find(entry => entry.id === itemId);
                if (related?.platformKey) setActivePlatform(related.platformKey);
              }}
            />
          ) : null}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.inner}>
        <View style={styles.headerBlock}>
          <View style={styles.headerTop}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Marketplace</Text>
              <Text style={styles.headerDesc}>
                Circle-wide apps and native capabilities. Connect once, then use them across Office, tasks, rooms, chat, publishing, automations, and agent execution.
              </Text>
            </View>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeNum}>{connectedCount}</Text>
              <Text style={styles.headerBadgeSlash}>/{availableCount}</Text>
            </View>
          </View>
          <View style={styles.searchShell}>
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search marketplace apps, capabilities, workflows, or systems..."
              placeholderTextColor="#667085"
              style={styles.searchInput}
            />
            <Text style={styles.searchMeta}>
              {visibleItemsCount} marketplace item{visibleItemsCount === 1 ? '' : 's'} visible across the circle catalog.
            </Text>
          </View>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardLabel}>Installed</Text>
              <Text style={styles.summaryCardValue}>{connectedCount}</Text>
              <Text style={styles.summaryCardHint}>Live circle apps</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardLabel}>Native</Text>
              <Text style={styles.summaryCardValue}>{nativeCount}</Text>
              <Text style={styles.summaryCardHint}>Built into the app</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardLabel}>Agent Systems</Text>
              <Text style={styles.summaryCardValue}>{agentAppCount}</Text>
              <Text style={styles.summaryCardHint}>Runtime, evals, browser ops</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardLabel}>Connectable</Text>
              <Text style={styles.summaryCardValue}>{externalCount}</Text>
              <Text style={styles.summaryCardHint}>Managed provider apps</Text>
            </View>
          </View>

          {/* LLM providers (OpenRouter, Hugging Face, Replicate, Modal)
              live in the generic marketplace card grid below — there
              used to be a separate LlmProviderMarketplace panel here
              that wrote per-user keys to a different table; that
              created two places to enter the same credential. Removed
              so the chat picker has a single source of truth via
              circle_integration_secrets. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {([
              { key: 'all', label: 'All' },
              { key: 'installed', label: 'Installed' },
              { key: 'ready', label: 'Ready' },
              { key: 'native', label: 'Native' },
            ] as const).map(filter => {
              const active = activeMarketplaceFilter === filter.key;
              return (
                <Pressable
                  key={filter.key}
                  onPress={() => setActiveMarketplaceFilter(filter.key)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {/* Source filter row (All Sources / Native / External / Recent)
              removed — duplicates the Sort=Newest option and the
              Installed/Ready/Native chips above, and the count chips
              were noisy at this density. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Pressable
              onPress={() => setActiveGroupFilter('all')}
              style={[styles.filterChip, activeGroupFilter === 'all' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, activeGroupFilter === 'all' && styles.filterChipTextActive]}>All Categories</Text>
            </Pressable>
            {/* Models — narrow shortcut to the LLM marketplaces the chat
                picker actually routes through (OpenRouter / Hugging Face
                / Replicate / Modal). Sits up front so users wiring up
                model keys don't have to scan past every group. */}
            <Pressable
              onPress={() => setActiveGroupFilter('models')}
              style={[styles.filterChip, activeGroupFilter === 'models' && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, activeGroupFilter === 'models' && styles.filterChipTextActive]}>Models</Text>
            </Pressable>
            {CIRCLE_INTEGRATION_GROUPS.map(group => {
              const active = activeGroupFilter === group.key;
              return (
                <Pressable
                  key={group.key}
                  onPress={() => setActiveGroupFilter(group.key)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{group.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {/* Sort row — applies to whatever the filters above produced.
              Default is `popular` (curated rank) so anthropic / openai
              / openrouter sit up front and replicate falls to the
              bottom. */}
          <View style={[styles.filterRow, { paddingHorizontal: 0, paddingTop: 4, alignItems: 'center', gap: 8 }]}>
            <Text style={{ color: '#475569', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }}>SORT</Text>
            {([
              { key: 'popular', label: 'Popular' },
              { key: 'alphabetical', label: 'A–Z' },
              { key: 'recent', label: 'Newest' },
            ] as const).map((opt) => {
              const active = sortMode === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setSortMode(opt.key)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {!loading && (
          <View style={styles.statusBar}>
            <View style={styles.statusPips}>
              {Object.entries(statuses).map(([key, status]) => (
                <View
                  key={key}
                  style={[
                    styles.statusPip,
                    { backgroundColor: status.connected ? CIRCLE_INTEGRATION_CATALOG.find(item => item.platformKey === key)?.color || '#22c55e' : '#333' },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.statusText}>
              {connectedCount} installed now. {nativeCount} native app capabilities. {externalCount} managed provider apps are ready for circle-wide connection.
            </Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingContainer}>
            <LoadingWave />
          </View>
        ) : (
          visibleItemsCount === 0 ? (
            <View style={styles.emptyStateCard}>
              <Text style={styles.emptyStateTitle}>No marketplace apps match the current filters.</Text>
              <Text style={styles.emptyStateText}>
                Clear the search or switch category filters to see more of the circle marketplace catalog.
              </Text>
            </View>
          ) : (
            <View style={styles.groupStack}>
              {CIRCLE_INTEGRATION_GROUPS.map(group => {
                const items = filteredCatalogItems.filter(item => item.group === group.key);
                if (items.length === 0) return null;
                const connectedInGroup = items.filter(item => item.platformKey && statuses[item.platformKey]?.connected).length;
                const availableInGroup = items.filter(item => item.availability === 'available').length;
                const nativeInGroup = items.filter(item => item.availability === 'available' && !item.platformKey).length;

                return (
                  <View key={group.key} style={styles.groupCard}>
                    <View style={styles.groupHeader}>
                      <View style={styles.groupHeaderLeft}>
                        <Text style={styles.groupTitle}>{group.label}</Text>
                        <Text style={styles.groupDesc}>{group.description}</Text>
                      </View>
                      <View style={styles.groupHeaderRight}>
                        <Text style={styles.groupMeta}>{connectedInGroup}/{availableInGroup || 0}</Text>
                        {nativeInGroup > 0 ? <Text style={styles.groupMetaSub}>{nativeInGroup} native</Text> : null}
                      </View>
                    </View>

                    <View style={styles.platformGrid}>
                      {items.map(item => (
                        <View key={item.id} style={[styles.platformCell, { flexBasis: cardBasis }]}>
                          <PlatformCard
                            item={item}
                            status={item.platformKey ? statuses[item.platformKey] : undefined}
                            isWide={cardsPerRow > 1}
                            onPress={item.platformKey ? () => setActivePlatform(item.platformKey!) : undefined}
                          />
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })}
            </View>
          )
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 40 },
  inner: {
    width: '100%',
    maxWidth: 1940,
    alignSelf: 'center' as const,
    padding: 22,
  },
  headerBlock: {
    marginBottom: 16,
    gap: 14,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  headerLeft: { flex: 1 },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 6,
  },
  headerDesc: {
    color: '#93a0b4',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  headerBadgeNum: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  headerBadgeSlash: {
    color: '#555',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  searchShell: {
    marginTop: 2,
    gap: 8,
  },
  searchInput: {
    backgroundColor: '#0b1018',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#f8fafc',
    fontFamily: 'monospace',
    fontSize: 12,
    ...(RNPlatform.OS === 'web' ? { outlineWidth: 0 } as any : {}),
  },
  searchMeta: {
    color: '#7d8798',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryCard: {
    minWidth: 170,
    flexGrow: 1,
    backgroundColor: '#0d1018',
    borderWidth: 1,
    borderColor: '#1b2433',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
  },
  summaryCardLabel: {
    color: '#7d8798',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
  },
  summaryCardValue: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  summaryCardHint: {
    color: '#94a3b8',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  filterRow: {
    gap: 8,
    paddingBottom: 2,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#232734',
    backgroundColor: '#0d1018',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: '#1b2333',
    borderColor: '#3b82f6',
  },
  filterChipText: {
    color: '#93a0b4',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#dbeafe',
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#000000',
    gap: 10,
  },
  statusPips: {
    flexDirection: 'row',
    gap: 6,
    alignSelf: 'flex-start',
    paddingTop: 4,
  },
  statusPip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#7d8798',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '600',
    flex: 1,
  },
  loadingContainer: { paddingVertical: 60, alignItems: 'center' },
  emptyStateCard: {
    backgroundColor: '#0c1018',
    borderWidth: 1,
    borderColor: '#1d2432',
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 22,
    gap: 8,
  },
  emptyStateTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  emptyStateText: {
    color: '#93a0b4',
    fontSize: 12,
    lineHeight: 19,
    fontFamily: 'monospace',
  },
  groupStack: { gap: 14 },
  groupCard: {
    backgroundColor: '#0a0a0e',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#161821',
    padding: 14,
    gap: 12,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  groupHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  groupTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  groupDesc: {
    color: '#7d8798',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  groupHeaderRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  groupMeta: {
    color: '#94a3b8',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  groupMetaSub: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  platformGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  platformCell: {
    minWidth: 240,
    maxWidth: '100%',
  },
  platformCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    gap: 10,
    ...(RNPlatform.OS === 'web' ? { transition: 'all 0.2s ease' } as any : {}),
  },
  platformCardWide: {
    flexBasis: '48%' as any,
    flexGrow: 1,
  },
  platformCardHovered: {
    backgroundColor: '#15161b',
    ...(RNPlatform.OS === 'web' ? { transform: [{ translateY: -2 }], cursor: 'pointer' } : {}),
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardTopRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  platformIconText: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  platformIconTextSmall: {
    fontSize: 14,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  statusLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  scopeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#0b1020',
    borderWidth: 1,
    borderColor: '#1d2948',
  },
  scopeBadgeText: {
    color: '#93c5fd',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  newBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#132112',
    borderWidth: 1,
    borderColor: '#1f4b1c',
  },
  newBadgeText: {
    color: '#86efac',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  platformName: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  capabilityLabel: {
    color: '#dbe4f0',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  connectedTo: {
    color: '#d1d5db',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  connectedHint: {
    color: '#7d8798',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  platformDesc: {
    color: '#8792a4',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  relationshipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  relationshipChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#17181d',
    borderWidth: 1,
    borderColor: '#242630',
  },
  relationshipChipText: {
    color: '#94a3b8',
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  cardAction: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    marginTop: 2,
  },
  cardActionText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  backRow: {
    paddingBottom: 12,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backText: {
    color: '#6366f1',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  platformContent: { flex: 1 },
  // ── Marketplace detail page accordions ─────────────────────────────────
  mpHeroCard: {
    marginTop: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 14,
    backgroundColor: '#0a0e1a',
    padding: 14,
    gap: 10,
  },
  mpHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  mpHeroIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
  },
  mpHeroLabel: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  mpHeroDesc: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
  },
  mpHeroStatus: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  mpAccordionGroup: {
    gap: 10,
  },
  mpAccordionCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0a0e1a',
    borderRadius: 12,
    overflow: 'hidden',
    ...(RNPlatform.OS === 'web'
      ? { transition: 'border-color 0.18s ease' } as any
      : {}),
  },
  mpAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...(RNPlatform.OS === 'web'
      ? { cursor: 'pointer', transition: 'background-color 0.18s ease' } as any
      : {}),
  },
  mpAccordionTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  mpAccordionChevron: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mpAccordionChevronText: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 18,
  },
  mpAccordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 4,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#ffffff10',
  },
  marketplaceOverviewCard: {
    backgroundColor: '#0b1018',
    borderWidth: 1,
    borderColor: '#1b2433',
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
    gap: 10,
  },
  marketplaceOverviewTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  marketplaceOverviewText: {
    color: '#93a0b4',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  marketplaceOverviewSection: {
    gap: 6,
  },
  marketplaceOverviewLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    textTransform: 'uppercase',
  },
  marketplaceOverviewBullet: {
    color: '#9fb0c7',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  detailChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  detailChip: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#141925',
    borderWidth: 1,
    borderColor: '#20283b',
  },
  detailChipInteractive: {
    ...(RNPlatform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  detailChipText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  platformDetailShell: {
    gap: 14,
  },
  detailIntro: {
    backgroundColor: '#0a0a0e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#171923',
    padding: 14,
    gap: 6,
  },
  detailTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  detailText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  detailSummaryCard: {
    backgroundColor: '#0b0f18',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    gap: 5,
  },
  detailSummaryLabel: {
    color: '#7d8798',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  detailSummaryValue: {
    fontSize: 15,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  detailSummaryText: {
    color: '#cbd5e1',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  genericDetailContent: {
    gap: 14,
    paddingBottom: 32,
  },
  genericFormCard: {
    backgroundColor: '#0b0f18',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    padding: 14,
    gap: 12,
  },
  genericFieldBlock: {
    gap: 6,
  },
  genericFieldLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  genericInput: {
    backgroundColor: '#06080d',
    borderWidth: 1,
    borderColor: '#283244',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontFamily: 'monospace',
    fontSize: 12,
    ...(RNPlatform.OS === 'web' ? { outlineWidth: 0 } as any : {}),
  },
  genericHint: {
    color: '#7d8798',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'monospace',
  },
  genericSaveBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  genericSaveBtnText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.7,
  },
  genericStatus: {
    color: '#cbd5e1',
    fontSize: 12,
    fontFamily: 'monospace',
  },
});
