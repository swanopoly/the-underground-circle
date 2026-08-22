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
  | 'provider_credential_rejected'
  | 'provider_billing_unavailable'
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

export interface ModelRouteIdentity {
  provider: string;
  /** Provider-native model id. Case is preserved and remains authoritative. */
  model: string;
}

function normalizeCatalogProvider(provider: string, modelId?: string): string {
  if (provider === 'blackswan' || provider === 'huggingface_endpoint') return 'huggingface_endpoint';
  if (provider === 'hugging_face') return 'huggingface';
  if (provider === 'z_ai') return 'zai';
  if (provider === 'huggingface' && String(modelId || '').trim().startsWith('huggingface_endpoint/')) {
    return 'huggingface_endpoint';
  }
  return provider;
}

function canonicalProviderModelId(provider: string, modelId: string): string {
  const normalizedProvider = normalizeCatalogProvider(provider);
  const raw = String(modelId || '').trim();
  const prefixes = normalizedProvider === 'huggingface_endpoint'
    ? ['huggingface_endpoint/']
    : normalizedProvider === 'huggingface'
    ? ['huggingface/', 'hugging_face/', 'hf:']
    : normalizedProvider === 'zai'
      ? ['zai/', 'z_ai/']
      : [`${normalizedProvider}/`];
  for (const prefix of prefixes) {
    if (raw.startsWith(prefix)) return raw.slice(prefix.length);
  }
  return raw;
}

/** Canonical execution identity shared by readiness and pre-dispatch fallback. */
export function resolveModelRouteIdentity(
  route: { provider: string; model: string } | null,
): ModelRouteIdentity | null {
  if (!route) return null;
  const provider = normalizeCatalogProvider(route.provider, route.model);
  return {
    provider,
    model: canonicalProviderModelId(provider, route.model),
  };
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

  const identity = resolveModelRouteIdentity(input.route);
  if (!identity) {
    return {
      state: 'route_unmanaged',
      ready: true,
      provider: null,
      catalogStatus: null,
      message: 'This model is owned by a separate capability route.',
    };
  }
  const provider = identity.provider;
  const providerGroups = input.groups.filter(
    (group) => normalizeCatalogProvider(group.provider) === provider,
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

  const requestedId = identity.model;
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
  failureCode?: ProviderModelCatalogFailureCode;
}): ModelCatalogReadinessProfile {
  const count = Number.isFinite(input.selectableModelCount)
    ? Math.max(0, Math.min(1000, Math.floor(input.selectableModelCount)))
    : 0;

  if (isProviderModelCatalogAuthorityFailure(input.failureCode)) {
    return {
      state: 'not_connected',
      connected: false,
      accountInventoryVerified: false,
      selectableModelCount: count,
      label: 'Access check required',
      hint: 'Sign in again or verify circle access before this account catalog can be used.',
    };
  }

  if (!input.connected || isStableProviderCredentialFailure(input.failureCode)) {
    return {
      state: 'not_connected',
      connected: false,
      accountInventoryVerified: false,
      selectableModelCount: count,
      label: input.connected ? 'Reconnect required' : 'Not connected',
      hint: input.connected
        ? 'The saved provider credential was rejected or could not be read. Reconnect it before running these models.'
        : 'Connect this provider to verify and run its models.',
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

/** Account/circle authority failures require auth or membership recovery, not
 * replacing an otherwise unrelated provider credential. */
export function isProviderModelCatalogAuthorityFailure(
  failureCode: ProviderModelCatalogFailureCode | null | undefined,
): boolean {
  return failureCode === 'auth_unavailable'
    || failureCode === 'unauthenticated'
    || failureCode === 'forbidden';
}

/** Stable provider credential failures cannot recover by dispatching the same key. */
export function isStableProviderCredentialFailure(
  failureCode: ProviderModelCatalogFailureCode | null | undefined,
): boolean {
  return failureCode === 'key_missing'
    || failureCode === 'credential_unreadable'
    || failureCode === 'provider_credential_rejected';
}
