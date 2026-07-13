/**
 * connectedResourcesRuntime — the IMPURE loader behind the per-turn
 * "## Connected Resources" prompt block. The pure formatter lives in
 * `connectedResourcesDigest.ts` (secret-safe; smoke connected-resources-digest).
 *
 * This closes the cross-dashboard-awareness gap: before, an agent asked to
 * "sign into acme.com" or "pull last month's numbers from the sheet" had NO
 * proactive view of what the circle already has connected — marketplace
 * integrations, vault logins, Google Workspace, provider keys all lived on
 * their own dashboards and never reached the prompt (the rich
 * `marketplaceIntegrationContext.ts` formatter was even dead code). The agent
 * only discovered a connection by calling a tool and failing.
 *
 * Now one block tells the agent, up front: which integrations are connected,
 * which SITE LOGINS exist in the vault (redacted — platform/label/site/
 * username/allowed-actions/login-grant only, never a secret) and how to use
 * one (vault.resolve_for_task → browser.fill_credential_field / fill_saved_login),
 * whether Google Workspace is connected and which g* tools that unlocks, and
 * which provider keys are configured.
 *
 * Everything is fetched through the SAME libs the tools/UI use (so RLS and
 * sanitization are identical), fails soft (any source erroring just omits its
 * sub-section), and is TTL-cached per circle+user so it costs one cheap set of
 * reads per turn at most.
 */

import {
  buildConnectedResourcesBlock,
  type ConnectedResourcesInput,
  type VaultCredentialSummary,
  type ConnectedIntegrationSummary,
  type GoogleWorkspaceSummary,
  type ProviderKeySummary,
} from './connectedResourcesDigest';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { block: string; at: number }>();

/** Test/dev hook. */
export function clearConnectedResourcesCache(): void {
  cache.clear();
}

/** Map stored Google scope strings → the coarse service labels the digest uses. */
function servicesFromScopes(scopes: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const s of scopes || []) {
    if (s.includes('gmail') || s.includes('mail.google')) out.add('gmail');
    else if (s.includes('calendar')) out.add('calendar');
    else if (s.includes('spreadsheets')) out.add('sheets');
    else if (s.includes('documents')) out.add('docs');
    else if (s.includes('drive')) out.add('drive');
    else if (s.includes('contacts')) out.add('contacts');
  }
  return Array.from(out);
}

async function loadVaultSummaries(circleId: string): Promise<VaultCredentialSummary[]> {
  try {
    const v = await import('./vaultAgentAccess');
    const result = await v.findVaultAutomationEntries(circleId, {});
    if (result.error || !result.entries) return [];
    return result.entries.slice(0, 40).map((entry) => {
      const actions = v.getVaultEntryAllowedActions(entry);
      const hasLoginGrant = v.getVaultAccessGrants(entry)
        .some((g) => !v.isVaultAccessGrantExpired(g) && g.actions.includes('login'));
      return {
        platform: entry.platform,
        label: entry.label,
        siteUrl: entry.siteUrl,
        username: entry.username,
        allowedActions: actions,
        loginAllowed: actions.includes('login'),
        hasLoginGrant,
      } satisfies VaultCredentialSummary;
    });
  } catch {
    return [];
  }
}

async function loadIntegrationSummaries(circleId: string): Promise<ConnectedIntegrationSummary[]> {
  try {
    const { loadMarketplaceIntegrationContext } = await import('./marketplaceIntegrationContext');
    const ctx = await loadMarketplaceIntegrationContext(circleId, { includeSecretKeyNames: true });
    return ctx.integrations.map((i) => ({
      provider: i.provider,
      label: i.label,
      status: i.status,
      connected: i.connected,
      capabilities: i.capabilityFlags,
      configuredSecretKeys: i.configuredSecretKeys,
    }));
  } catch {
    return [];
  }
}

async function loadGoogleWorkspace(): Promise<GoogleWorkspaceSummary | null> {
  try {
    const { getGoogleAuthStatus } = await import('./googleCreds');
    const status = await getGoogleAuthStatus();
    if (!status?.connected) return { connected: false };
    return {
      connected: true,
      email: status.email || null,
      services: servicesFromScopes(status.scopes),
    };
  } catch {
    return null;
  }
}

/**
 * Build the per-turn Connected Resources block for a circle/user, or null when
 * nothing is connected (so the caller skips an empty section). `connectedProviders`
 * is passed in from the chat context (already resolved for model routing) so we
 * don't re-query it. TTL-cached per circle+user.
 */
export async function buildConnectedResourcesContextBlock(args: {
  circleId?: string | null;
  connectedProviders?: Iterable<string> | null;
}): Promise<string | null> {
  const circleId = args.circleId || '';
  const providerKeys: ProviderKeySummary[] = Array.from(args.connectedProviders || [])
    .filter((p): p is string => typeof p === 'string' && p.length > 0)
    .map((provider) => ({ provider }));

  const cacheKey = `${circleId}::${providerKeys.map((p) => p.provider).sort().join(',')}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.block || null;

  const [vaultCredentials, integrations, googleWorkspace] = await Promise.all([
    circleId ? loadVaultSummaries(circleId) : Promise.resolve([]),
    circleId ? loadIntegrationSummaries(circleId) : Promise.resolve([]),
    loadGoogleWorkspace(),
  ]);

  const input: ConnectedResourcesInput = {
    integrations,
    vaultCredentials,
    googleWorkspace,
    providerKeys,
    vaultDashboardHint: vaultCredentials.length
      ? 'Manage these logins in the Vault dashboard (Circle → Vault) or with /vault; run vault.grant (approval-gated) to let automation use a login.'
      : 'No site logins are saved yet — the user can add them in the Vault dashboard (Circle → Vault) so agents can sign in on their behalf.',
  };

  const block = buildConnectedResourcesBlock(input);
  cache.set(cacheKey, { block: block || '', at: Date.now() });
  return block || null;
}
