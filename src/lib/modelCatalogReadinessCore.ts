/**
 * Pure account-catalog readiness contract shared by Chat, Rooms, Office, and
 * agent-spawn model selectors.
 *
 * A connected credential and a successful provider inventory are different
 * facts. Keep them separate so a network failure cannot look like a verified
 * empty account, and a curated fallback cannot look account-authorized.
 */

export type ProviderModelCatalogStatus = 'verified' | 'fallback' | 'unsupported';

export type ProviderModelCatalogFailureCode =
  | 'auth_unavailable'
  | 'catalog_timeout'
  | 'invalid_response'
  | 'request_failed'
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'key_missing'
  | 'credential_unreadable'
  | 'unsupported_provider'
  | 'upstream_error'
  | 'internal';

export interface ProviderCatalogModelShape {
  id: string;
  provider: string;
  source?: 'curated' | 'provider';
}

export interface ProviderModelCatalogSnapshot<TModel extends ProviderCatalogModelShape = ProviderCatalogModelShape> {
  provider: string;
  status: ProviderModelCatalogStatus;
  models: readonly TModel[];
  fetchedAt: string | null;
  failureCode?: ProviderModelCatalogFailureCode;
}

export type ModelCatalogReadinessState =
  | 'not_connected'
  | 'account_verified'
  | 'account_verified_empty'
  | 'curated_fallback'
  | 'catalog_unsupported';

export interface ModelCatalogReadinessProfile {
  state: ModelCatalogReadinessState;
  connected: boolean;
  accountInventoryVerified: boolean;
  selectableModelCount: number;
  label: string;
  hint: string;
}

export interface ModelSelectionCatalogGroup {
  provider: string;
  connected: boolean;
  catalogStatus: ModelCatalogReadinessState | 'circle_integration';
  models: ReadonlyArray<{ id: string; ready: boolean }>;
}

export type ModelSelectionReadinessState =
  | 'ready'
  | 'connection_required'
  | 'not_listed'
  | 'route_unmanaged';

export interface ModelSelectionReadiness {
  state: ModelSelectionReadinessState;
  ready: boolean;
  provider: string | null;
  catalogStatus: ModelCatalogReadinessState | 'circle_integration' | null;
  message: string;
}

function normalizeCatalogProvider(provider: string): string {
  if (provider === 'hugging_face' || provider === 'huggingface_endpoint') return 'huggingface';
  if (provider === 'z_ai') return 'zai';
  return provider;
}

function canonicalProviderModelId(provider: string, modelId: string): string {
  const normalizedProvider = normalizeCatalogProvider(provider);
  const raw = String(modelId || '').trim();
  const prefixes = normalizedProvider === 'huggingface'
    ? ['huggingface_endpoint/', 'huggingface/', 'hugging_face/', 'hf:']
    : normalizedProvider === 'zai'
      ? ['zai/', 'z_ai/']
      : [`${normalizedProvider}/`];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return raw;
}

/**
 * Resolve whether a routed hosted-chat model is selectable from the exact
 * shared account catalog. A null route means this contract does not own the
 * model (for example deterministic image/tool adapters) and must not disable
 * that separate capability path.
 */
export function resolveModelSelectionReadiness(input: {
  route: { provider: string; model: string } | null;
  groups: readonly ModelSelectionCatalogGroup[];
}): ModelSelectionReadiness {
  if (!input.route) {
    return {
      state: 'route_unmanaged',
      ready: true,
      provider: null,
      catalogStatus: null,
      message: 'This model is owned by a separate capability route.',
    };
  }

  const provider = normalizeCatalogProvider(input.route.provider);
  const providerGroups = input.groups.filter(
    (group) => normalizeCatalogProvider(group.provider) === provider
      || (group.provider === 'blackswan' && provider === 'huggingface'),
  );
  const connectedGroups = providerGroups.filter((group) => group.connected);
  if (connectedGroups.length === 0) {
    return {
      state: 'connection_required',
      ready: false,
      provider,
      catalogStatus: providerGroups[0]?.catalogStatus || null,
      message: `Connect ${provider} before selecting this model.`,
    };
  }

  const requestedId = canonicalProviderModelId(provider, input.route.model);
  for (const group of connectedGroups) {
    const match = group.models.find((model) => (
      canonicalProviderModelId(provider, model.id) === requestedId
    ));
    if (match?.ready) {
      return {
        state: 'ready',
        ready: true,
        provider,
        catalogStatus: group.catalogStatus,
        message: group.catalogStatus === 'account_verified'
          ? 'This model is listed for the connected key.'
          : 'This model is in the connected curated fallback and will be checked when the run starts.',
      };
    }
  }

  const strongestGroup = connectedGroups.find((group) => group.catalogStatus === 'account_verified')
    || connectedGroups[0];
  return {
    state: 'not_listed',
    ready: false,
    provider,
    catalogStatus: strongestGroup?.catalogStatus || null,
    message: strongestGroup?.catalogStatus === 'account_verified'
      ? 'This model was not listed for the connected key.'
      : 'This model is not in the connected provider catalog.',
  };
}

/**
 * A verified inventory is authoritative for what the provider listed to this
 * exact stored key. Curated rows may enrich matching live IDs, but may not add
 * IDs absent from that verified response. Failed/unsupported inventory checks
 * intentionally retain the curated fallback so the site remains usable.
 */
export function projectProviderCatalogModels<TModel extends ProviderCatalogModelShape>(
  provider: string,
  curatedModels: readonly TModel[],
  snapshot: ProviderModelCatalogSnapshot<TModel>,
): TModel[] {
  const curatedById = new Map<string, TModel>();
  for (const model of curatedModels) {
    if (!model?.id || model.provider !== provider || curatedById.has(model.id)) continue;
    curatedById.set(model.id, model);
  }

  if (snapshot.status !== 'verified' || snapshot.provider !== provider) {
    return Array.from(curatedById.values());
  }

  const projected: TModel[] = [];
  const seen = new Set<string>();
  for (const liveModel of snapshot.models) {
    if (!liveModel?.id || liveModel.provider !== provider || seen.has(liveModel.id)) continue;
    seen.add(liveModel.id);
    const curated = curatedById.get(liveModel.id);
    projected.push({
      ...(curated || {} as TModel),
      ...liveModel,
      source: 'provider',
    });
  }
  return projected;
}

export function buildModelCatalogReadinessProfile(input: {
  connected: boolean;
  snapshotStatus: ProviderModelCatalogStatus;
  selectableModelCount: number;
}): ModelCatalogReadinessProfile {
  const count = Number.isFinite(input.selectableModelCount)
    ? Math.max(0, Math.min(1000, Math.floor(input.selectableModelCount)))
    : 0;

  if (!input.connected) {
    return {
      state: 'not_connected',
      connected: false,
      accountInventoryVerified: false,
      selectableModelCount: count,
      label: 'Not connected',
      hint: 'Connect this provider to verify and run its models.',
    };
  }

  if (input.snapshotStatus === 'verified') {
    if (count === 0) {
      return {
        state: 'account_verified_empty',
        connected: true,
        accountInventoryVerified: true,
        selectableModelCount: 0,
        label: 'Account checked · no chat models',
        hint: 'This key returned no supported chat models. Check its project, permissions, or provider account.',
      };
    }
    return {
      state: 'account_verified',
      connected: true,
      accountInventoryVerified: true,
      selectableModelCount: count,
      label: 'Account catalog checked',
      hint: `${count} supported chat model${count === 1 ? '' : 's'} listed for this key.`,
    };
  }

  if (input.snapshotStatus === 'unsupported') {
    return {
      state: 'catalog_unsupported',
      connected: true,
      accountInventoryVerified: false,
      selectableModelCount: count,
      label: 'Curated catalog',
      hint: 'This provider has no supported account-list endpoint. Exact access is checked when a run starts.',
    };
  }

  return {
    state: 'curated_fallback',
    connected: true,
    accountInventoryVerified: false,
    selectableModelCount: count,
    label: 'Curated fallback',
    hint: 'The account catalog could not be checked. Exact access is checked when a run starts.',
  };
}
