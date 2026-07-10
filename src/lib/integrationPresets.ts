/**
 * integrationPresets — a curated, NON-SECRET catalog of popular third-party
 * APIs so `/integrations connect <name>` gives accurate setup steps and the AI
 * action composer (integrationActionComposer) has real metadata + example
 * endpoints to reason over ("figure out the call").
 *
 * A preset carries ONLY public API facts: base URL, auth STYLE (never a key),
 * common write endpoints, docs URL, and which secret key the user must paste in
 * Marketplace. No secrets, ever.
 *
 * Presets are constrained to what the guarded custom-api-proxy can actually do
 * today (supabase/functions/custom-api-proxy/index.ts `applyAuth`):
 *   - authScheme ∈ { bearer, x-api-key, basic }  (NO query-param auth, NO
 *     "Token token=" style, NO mandatory extra static headers like
 *     Notion-Version — the proxy forwards none of those)
 *   - secret keys the proxy reads: bearer_token / api_key / basic_username +
 *     basic_password  (plus `apiKeyHeaderName` metadata for x-api-key)
 * APIs that need something outside that envelope are deliberately excluded so
 * the connect guidance is never wrong — anything else still works via a manual
 * Custom API connector with the user's own base URL.
 *
 * A preset maps 1:1 onto the custom_api `metadata` shape that BOTH the proxy
 * and readIntegrationActionMetadata() read, so a preset-backed connection makes
 * the composer accurate for free.
 *
 * Pure module — no imports at all (data + string builders) — so it loads under
 * tsx for scripts/integration-presets-smoketest.ts and can be imported from
 * ChatTab, integrationsChatCommand, and integrationActionComposer.
 */

export type PresetAuthScheme = 'bearer' | 'x-api-key' | 'basic';
export type PresetMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface IntegrationPresetAction {
  /** Short human label, e.g. "Create issue". */
  label: string;
  method: PresetMethod;
  /** Relative path under baseUrl, e.g. "/repos/{owner}/{repo}/issues". */
  path: string;
  /** Optional one-line gotcha, e.g. body-wrapping requirement. */
  note?: string;
}

export interface IntegrationPreset {
  /** Canonical lookup key, lowercase kebab/snake, e.g. "github". */
  slug: string;
  /** Display label, e.g. "GitHub". */
  label: string;
  /** Loose grouping for the browse list. */
  category: string;
  /** Base URL; may contain a {placeholder} the user must replace. */
  baseUrl: string;
  /** Named placeholder inside baseUrl the user must replace (e.g. "{site}"). */
  baseUrlPlaceholder?: string;
  /** Public API docs URL. */
  apiDocsUrl: string;
  /** Which auth style the guarded proxy should use. */
  authScheme: PresetAuthScheme;
  /**
   * Exact secret keys the user pastes in Marketplace (what the proxy reads):
   *   bearer      → ['bearer_token']
   *   x-api-key   → ['api_key']
   *   basic       → ['basic_username', 'basic_password']
   */
  requiredSecretKeys: string[];
  /** Custom header name when authScheme === 'x-api-key' (proxy default x-api-key). */
  apiKeyHeaderName?: string;
  /** Write-like methods the composer may propose (subset the API supports). */
  allowedMethods: PresetMethod[];
  /** Read-first preset: writes are risky/awkward, so default to GET only. */
  readOnly?: boolean;
  /** Extra match terms for resolveIntegrationPreset. */
  aliases?: string[];
  /** Example endpoints — fed to the composer as concrete patterns. */
  commonActions: IntegrationPresetAction[];
  /** Honest caveats surfaced in the connect guide. */
  notes?: string[];
}

// ── The catalog ──────────────────────────────────────────────────────────────
// Base URLs and auth styles verified against each provider's public REST docs.
// Only providers that work within the proxy's bearer/x-api-key/basic + JSON
// envelope are listed.

export const INTEGRATION_PRESETS: Record<string, IntegrationPreset> = {
  github: {
    slug: 'github',
    label: 'GitHub',
    category: 'Dev',
    baseUrl: 'https://api.github.com',
    apiDocsUrl: 'https://docs.github.com/rest',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST', 'PATCH', 'PUT', 'DELETE'],
    aliases: ['gh', 'github issues', 'github api'],
    commonActions: [
      { label: 'Create issue', method: 'POST', path: '/repos/{owner}/{repo}/issues' },
      { label: 'Comment on issue', method: 'POST', path: '/repos/{owner}/{repo}/issues/{number}/comments' },
      { label: 'Open pull request', method: 'POST', path: '/repos/{owner}/{repo}/pulls' },
      { label: 'Close issue', method: 'PATCH', path: '/repos/{owner}/{repo}/issues/{number}', note: 'body {"state":"closed"}' },
    ],
    notes: [
      'Paste a fine-grained or classic personal access token with the needed repo scopes as bearer_token.',
      'For everyday repo file / branch / PR work, the built-in /gh commands are simpler than composing REST calls — use this Custom API path for other GitHub endpoints.',
    ],
  },

  linear: {
    slug: 'linear',
    label: 'Linear',
    category: 'Dev / Project',
    baseUrl: 'https://api.linear.app/graphql',
    apiDocsUrl: 'https://developers.linear.app/docs',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST'],
    aliases: ['linear app'],
    commonActions: [
      { label: 'Any operation (GraphQL)', method: 'POST', path: '/', note: 'body {"query":"mutation{...}","variables":{...}}' },
    ],
    notes: [
      'GraphQL API — one POST endpoint; the body is {"query":"…","variables":{…}}.',
      'Paste an OAuth access token as bearer_token. A raw personal API key is not sent as "Bearer …", so it will not work through the guarded proxy.',
    ],
  },

  sentry: {
    slug: 'sentry',
    label: 'Sentry',
    category: 'Observability',
    baseUrl: 'https://sentry.io/api/0',
    apiDocsUrl: 'https://docs.sentry.io/api/',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST', 'PUT', 'DELETE'],
    aliases: ['sentry.io'],
    commonActions: [
      { label: 'Update issue (resolve/assign)', method: 'PUT', path: '/issues/{issue_id}/', note: 'body {"status":"resolved"}' },
      { label: 'Create project', method: 'POST', path: '/teams/{org}/{team}/projects/' },
    ],
    notes: ['Create an auth token in Sentry → Settings → Auth Tokens and paste it as bearer_token.'],
  },

  airtable: {
    slug: 'airtable',
    label: 'Airtable',
    category: 'Data',
    baseUrl: 'https://api.airtable.com/v0',
    apiDocsUrl: 'https://airtable.com/developers/web/api/introduction',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST', 'PATCH', 'PUT', 'DELETE'],
    aliases: ['air table'],
    commonActions: [
      { label: 'Create record', method: 'POST', path: '/{baseId}/{tableName}', note: 'body {"fields":{…}}' },
      { label: 'Update record', method: 'PATCH', path: '/{baseId}/{tableName}/{recordId}', note: 'body {"fields":{…}}' },
    ],
    notes: ['Paste a personal access token scoped to the base as bearer_token. {baseId} looks like app…; find it in the API docs for your base.'],
  },

  asana: {
    slug: 'asana',
    label: 'Asana',
    category: 'Project',
    baseUrl: 'https://app.asana.com/api/1.0',
    apiDocsUrl: 'https://developers.asana.com/reference/rest-api-reference',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST', 'PUT', 'DELETE'],
    commonActions: [
      { label: 'Create task', method: 'POST', path: '/tasks', note: 'Asana wraps payloads: body {"data":{…}}' },
      { label: 'Add comment', method: 'POST', path: '/tasks/{task_gid}/stories', note: 'body {"data":{"text":"…"}}' },
    ],
    notes: ['Paste a personal access token as bearer_token. Every request/response payload is wrapped in a top-level "data" object.'],
  },

  hubspot: {
    slug: 'hubspot',
    label: 'HubSpot',
    category: 'CRM',
    baseUrl: 'https://api.hubapi.com',
    apiDocsUrl: 'https://developers.hubspot.com/docs/api/overview',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST', 'PATCH', 'PUT', 'DELETE'],
    aliases: ['hub spot'],
    commonActions: [
      { label: 'Create contact', method: 'POST', path: '/crm/v3/objects/contacts', note: 'body {"properties":{…}}' },
      { label: 'Create deal', method: 'POST', path: '/crm/v3/objects/deals', note: 'body {"properties":{…}}' },
    ],
    notes: ['Create a private app in HubSpot and paste its access token as bearer_token.'],
  },

  jira: {
    slug: 'jira',
    label: 'Jira Cloud',
    category: 'Project',
    baseUrl: 'https://{site}.atlassian.net/rest/api/3',
    baseUrlPlaceholder: '{site}',
    apiDocsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/',
    authScheme: 'basic',
    requiredSecretKeys: ['basic_username', 'basic_password'],
    allowedMethods: ['POST', 'PUT', 'DELETE'],
    aliases: ['atlassian', 'jira cloud'],
    commonActions: [
      { label: 'Create issue', method: 'POST', path: '/issue', note: 'body {"fields":{"project":{"key":"…"},"summary":"…","issuetype":{"name":"Task"}}}' },
      { label: 'Add comment', method: 'POST', path: '/issue/{issueIdOrKey}/comment' },
    ],
    notes: [
      'Replace {site} in the base URL with your Atlassian site name.',
      'basic_username = your Atlassian account email; basic_password = an API token from id.atlassian.com/manage-profile/security/api-tokens.',
    ],
  },

  zendesk: {
    slug: 'zendesk',
    label: 'Zendesk',
    category: 'Support',
    baseUrl: 'https://{subdomain}.zendesk.com/api/v2',
    baseUrlPlaceholder: '{subdomain}',
    apiDocsUrl: 'https://developer.zendesk.com/api-reference/',
    authScheme: 'basic',
    requiredSecretKeys: ['basic_username', 'basic_password'],
    allowedMethods: ['POST', 'PUT', 'DELETE'],
    aliases: ['zen desk'],
    commonActions: [
      { label: 'Create ticket', method: 'POST', path: '/tickets.json', note: 'body {"ticket":{"subject":"…","comment":{"body":"…"}}}' },
      { label: 'Update ticket', method: 'PUT', path: '/tickets/{id}.json' },
    ],
    notes: [
      'Replace {subdomain} with your Zendesk subdomain.',
      'For API-token auth, basic_username = "you@company.com/token" and basic_password = the API token.',
    ],
  },

  slack_web: {
    slug: 'slack_web',
    label: 'Slack Web API',
    category: 'Messaging',
    baseUrl: 'https://slack.com/api',
    apiDocsUrl: 'https://api.slack.com/web',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: ['POST'],
    aliases: ['slack api', 'slack web', 'slack token'],
    commonActions: [
      { label: 'Post message', method: 'POST', path: '/chat.postMessage', note: 'body {"channel":"C…","text":"…"}' },
      { label: 'Add reaction', method: 'POST', path: '/reactions.add' },
    ],
    notes: [
      'This is the TOKEN-based Web API (bot token xoxb-…), NOT the incoming webhook used by the built-in messaging.notify.',
      'Use this when you need threads, uploads, reactions, or channel lookups; use the webhook (Marketplace → Slack) for simple channel posts.',
    ],
  },

  stripe: {
    slug: 'stripe',
    label: 'Stripe',
    category: 'Payments',
    baseUrl: 'https://api.stripe.com/v1',
    apiDocsUrl: 'https://stripe.com/docs/api',
    authScheme: 'bearer',
    requiredSecretKeys: ['bearer_token'],
    allowedMethods: [],
    readOnly: true,
    commonActions: [
      { label: 'List charges', method: 'GET', path: '/charges' },
      { label: 'Get customer', method: 'GET', path: '/customers/{id}' },
      { label: 'List invoices', method: 'GET', path: '/invoices' },
    ],
    notes: [
      'READ-FIRST preset — GET only. Stripe writes move real money and use form-encoding (not JSON), so keep write/charge operations manual.',
      'The pay/charge approval floor always applies to money-moving actions.',
      'Paste a secret key (sk_…) as bearer_token — a restricted read-only key is safest.',
    ],
  },
};

// ── Lookup + mapping ───────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return String(s || '').trim().toLowerCase();
}

export function listIntegrationPresets(): IntegrationPreset[] {
  return Object.values(INTEGRATION_PRESETS);
}

/**
 * Resolve a free-text query ("github", "Jira Cloud", "gh") to a preset.
 * Exact slug → alias/label exact → label/alias substring → slug substring.
 * Returns null when nothing is confidently matched.
 */
export function resolveIntegrationPreset(query: string): IntegrationPreset | null {
  const q = norm(query).replace(/\s+/g, ' ');
  if (!q) return null;

  const all = listIntegrationPresets();

  // 1) exact slug (with and without separators normalized)
  const qKey = q.replace(/[\s-]+/g, '_');
  for (const p of all) {
    if (p.slug === qKey || p.slug === q) return p;
  }

  // 2) exact label or alias
  for (const p of all) {
    if (norm(p.label) === q) return p;
    if ((p.aliases || []).some((a) => norm(a) === q)) return p;
  }

  // 3) substring against label/alias (the query contains, or is contained by)
  for (const p of all) {
    const hay = [p.label, ...(p.aliases || [])].map(norm);
    if (hay.some((h) => h && (h.includes(q) || q.includes(h)))) return p;
  }

  // 4) slug substring (guard against tiny queries producing false hits)
  if (q.length >= 3) {
    for (const p of all) {
      if (p.slug.includes(qKey) || qKey.includes(p.slug)) return p;
    }
  }

  return null;
}

/** Origin (scheme+host) of a base URL, ignoring {placeholders}; null when unparseable. */
function baseUrlOrigin(baseUrl: string | undefined): string | null {
  const raw = String(baseUrl || '').trim();
  if (!raw) return null;
  const m = raw.match(/^https?:\/\/([^/]+)/i);
  if (!m) return null;
  // Drop a leading {placeholder}. host so "https://{site}.atlassian.net" → "atlassian.net".
  const host = m[1].replace(/^\{[^}]+\}\./, '').toLowerCase();
  return host || null;
}

/**
 * Best-effort: find the preset that matches an ALREADY-connected custom_api
 * integration, by base-URL host first (most reliable) then by apiName/label.
 * Used to enrich the composer prompt with that API's known endpoints.
 */
export function matchPresetForApi(input: { baseUrl?: string; apiName?: string }): IntegrationPreset | null {
  const host = baseUrlOrigin(input?.baseUrl);
  if (host) {
    for (const p of listIntegrationPresets()) {
      const presetHost = baseUrlOrigin(p.baseUrl);
      if (presetHost && (presetHost === host || host.endsWith(`.${presetHost}`) || presetHost.endsWith(`.${host}`))) {
        return p;
      }
    }
  }
  const name = norm(input?.apiName);
  if (name) return resolveIntegrationPreset(name);
  return null;
}

/**
 * Map a preset onto the custom_api `metadata` object the proxy +
 * integrationActionComposer read. NON-SECRET values only — the actual key/token
 * is pasted separately in Marketplace under requiredSecretKeys.
 */
export function presetToCustomApiMetadata(preset: IntegrationPreset): Record<string, string> {
  const methods = preset.readOnly ? ['GET'] : preset.allowedMethods;
  const meta: Record<string, string> = {
    apiName: preset.label,
    baseUrl: preset.baseUrl,
    apiDocsUrl: preset.apiDocsUrl,
    authScheme: preset.authScheme,
    allowedMethods: methods.join(', '),
    defaultMethod: preset.readOnly ? 'GET' : (preset.allowedMethods[0] || 'GET'),
  };
  const firstAction = preset.commonActions[0];
  if (firstAction) meta.defaultEndpoint = firstAction.path;
  if (preset.authScheme === 'x-api-key' && preset.apiKeyHeaderName) {
    meta.apiKeyHeaderName = preset.apiKeyHeaderName;
  }
  return meta;
}

// ── Connect guide + catalog description ──────────────────────────────────────

function clip(s: string, max: number): string {
  const t = String(s || '').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function bound(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const MAX_PRESET_CONNECT_GUIDE_LENGTH = 1600;

/** Human description of which secret to paste, per auth scheme. */
function secretGuidance(preset: IntegrationPreset): string {
  switch (preset.authScheme) {
    case 'basic':
      return 'Paste `basic_username` and `basic_password` (see notes for what each holds).';
    case 'x-api-key':
      return `Paste your key as \`api_key\`${preset.apiKeyHeaderName ? ` (sent as the \`${preset.apiKeyHeaderName}\` header)` : ''}.`;
    case 'bearer':
    default:
      return 'Paste your token as `bearer_token`.';
  }
}

/**
 * Rich, bounded connect steps for a preset. This is the preferred connect reply
 * when `/integrations connect <name>` matches a known API — it gives the exact
 * base URL, auth scheme, secret key(s), and example endpoints so the user (and
 * later the composer) get it right the first time.
 */
export function buildPresetConnectGuide(preset: IntegrationPreset): string {
  const methods = preset.readOnly ? 'GET (read-only)' : preset.allowedMethods.join(', ') || 'GET';
  const lines: string[] = [
    `**Connect ${preset.label}** · ${preset.category}`,
    '',
    'In the app: **Marketplace → Integrations → Custom API**, then enter:',
    `• **Base URL**: \`${preset.baseUrl}\`${preset.baseUrlPlaceholder ? ` — replace \`${preset.baseUrlPlaceholder}\` with yours` : ''}`,
    `• **Auth**: \`${preset.authScheme}\` — ${secretGuidance(preset)}`,
    `• **Allowed methods**: ${methods}`,
    '',
    'The secret goes in the Marketplace secret field — **never in chat**. It is injected server-side and never returned.',
  ];

  const actions = preset.commonActions.slice(0, 4);
  if (actions.length > 0) {
    lines.push('', '**Example endpoints**');
    for (const a of actions) {
      lines.push(`• ${clip(a.label, 40)} — \`${a.method} ${clip(a.path, 80)}\`${a.note ? ` · ${clip(a.note, 90)}` : ''}`);
    }
  }

  if (preset.notes && preset.notes.length > 0) {
    lines.push('', '**Notes**');
    for (const n of preset.notes.slice(0, 4)) lines.push(`• ${clip(n, 200)}`);
  }

  lines.push(
    '',
    `Docs: ${preset.apiDocsUrl}`,
    'Then run `/integrations act <what you want>` and I compose the call for your approval.',
  );

  return bound(lines.join('\n'), MAX_PRESET_CONNECT_GUIDE_LENGTH);
}

/**
 * A bounded, chat-safe "known endpoints" hint for a connected custom_api
 * integration, matched to a preset by base-URL host / apiName. Returns null
 * when nothing matches. Injected into the LIVE integrations.list tool result so
 * the agent loop composes a real path on the `/integrations act` flow — this is
 * where the catalog's endpoint knowledge reaches the model that actually runs.
 */
export function buildPresetEndpointHint(input: { baseUrl?: string; apiName?: string }): string | null {
  const preset = matchPresetForApi(input);
  if (!preset || preset.commonActions.length === 0) return null;
  const actions = preset.commonActions.slice(0, 3).map((a) => `${a.method} ${a.path}`).join('; ');
  return `known ${preset.label} endpoints: ${clip(actions, 180)}`;
}

/** One-line-per-preset browse list, grouped by category, for a no-match connect. */
export function describeIntegrationPresetCatalog(): string {
  const byCategory = new Map<string, string[]>();
  for (const p of listIntegrationPresets()) {
    const arr = byCategory.get(p.category) || [];
    arr.push(p.label);
    byCategory.set(p.category, arr);
  }
  const lines: string[] = ['**Known integration presets** (accurate one-step setup):'];
  for (const [cat, labels] of byCategory) {
    lines.push(`• ${cat}: ${labels.join(', ')}`);
  }
  lines.push('', 'Get steps for one: `/integrations connect <name>`. Any other REST API works via Custom API with your own base URL.');
  return lines.join('\n');
}
