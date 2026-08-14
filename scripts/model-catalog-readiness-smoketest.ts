/**
 * Account-catalog readiness regression gate.
 *
 * Proves that verified inventories are exact, fallbacks stay explicitly
 * unverified, and every shared selector receives the same truth contract.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildModelCatalogReadinessProfile,
  projectProviderCatalogModels,
  resolveModelSelectionReadiness,
  type ProviderModelCatalogSnapshot,
} from '../src/lib/modelCatalogReadinessCore';

const root = process.cwd();
let passed = 0;
let failed = 0;

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function assert(condition: unknown, message: string, detail?: unknown): void {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
  if (detail !== undefined) console.error('  detail:', detail);
}

type TestModel = {
  id: string;
  provider: string;
  label: string;
  contextWindow: number;
  source?: 'curated' | 'provider';
};

const curated: TestModel[] = [
  { id: 'alpha', provider: 'openai', label: 'Alpha curated', contextWindow: 100 },
  { id: 'beta', provider: 'openai', label: 'Beta curated', contextWindow: 200 },
  { id: 'foreign', provider: 'anthropic', label: 'Wrong provider', contextWindow: 300 },
];
const verified: ProviderModelCatalogSnapshot<TestModel> = {
  provider: 'openai',
  status: 'verified',
  fetchedAt: '2026-08-12T00:00:00.000Z',
  models: [
    { id: 'beta', provider: 'openai', label: 'Beta live', contextWindow: 250, source: 'provider' },
    { id: 'gamma', provider: 'openai', label: 'Gamma live', contextWindow: 400, source: 'provider' },
    { id: 'gamma', provider: 'openai', label: 'Duplicate', contextWindow: 1, source: 'provider' },
    { id: 'wrong', provider: 'anthropic', label: 'Wrong', contextWindow: 1, source: 'provider' },
  ],
};

const exact = projectProviderCatalogModels('openai', curated, verified);
assert(exact.map((model) => model.id).join(',') === 'beta,gamma', 'verified inventory excludes curated IDs absent from the exact account list', exact);
assert(exact[0]?.label === 'Beta live' && exact[0]?.contextWindow === 250, 'live account metadata overrides matching curated metadata', exact[0]);
assert(exact.every((model) => model.source === 'provider'), 'verified projected rows retain provider provenance');

const verifiedEmpty = projectProviderCatalogModels('openai', curated, {
  provider: 'openai', status: 'verified', fetchedAt: null, models: [],
});
assert(verifiedEmpty.length === 0, 'a verified empty account is not replaced with curated models');

const fallback = projectProviderCatalogModels('openai', curated, {
  provider: 'openai', status: 'fallback', fetchedAt: null, failureCode: 'catalog_timeout', models: [],
});
assert(fallback.map((model) => model.id).join(',') === 'alpha,beta', 'catalog failure retains only the provider curated fallback', fallback);

const mismatched = projectProviderCatalogModels('openai', curated, {
  provider: 'anthropic', status: 'verified', fetchedAt: null, models: verified.models,
});
assert(mismatched.map((model) => model.id).join(',') === 'alpha,beta', 'mismatched snapshot authority cannot replace a provider catalog');

const notConnected = buildModelCatalogReadinessProfile({ connected: false, snapshotStatus: 'verified', selectableModelCount: 9 });
assert(notConnected.state === 'not_connected' && !notConnected.accountInventoryVerified, 'connection state wins over a stale verified snapshot');
const accountReady = buildModelCatalogReadinessProfile({ connected: true, snapshotStatus: 'verified', selectableModelCount: 2 });
assert(accountReady.state === 'account_verified' && accountReady.accountInventoryVerified, 'non-empty verified account is explicitly account-checked');
assert(accountReady.hint.includes('listed for this key'), 'verified copy describes listing evidence without claiming execution completion');
const accountEmpty = buildModelCatalogReadinessProfile({ connected: true, snapshotStatus: 'verified', selectableModelCount: 0 });
assert(accountEmpty.state === 'account_verified_empty' && accountEmpty.selectableModelCount === 0, 'verified empty inventory remains a first-class state');
const fallbackReady = buildModelCatalogReadinessProfile({ connected: true, snapshotStatus: 'fallback', selectableModelCount: 4 });
assert(fallbackReady.state === 'curated_fallback' && !fallbackReady.accountInventoryVerified, 'fallback models never claim account verification');
assert(fallbackReady.hint.includes('checked when a run starts'), 'fallback copy promises a run-time check, not availability');
const unsupported = buildModelCatalogReadinessProfile({ connected: true, snapshotStatus: 'unsupported', selectableModelCount: 4 });
assert(unsupported.state === 'catalog_unsupported' && !unsupported.accountInventoryVerified, 'missing list endpoint remains distinct from transport failure');

const verifiedGroups = [{
  provider: 'openai',
  connected: true,
  catalogStatus: 'account_verified' as const,
  models: [{ id: 'openai/beta', ready: true }],
}];
const exactSelection = resolveModelSelectionReadiness({
  route: { provider: 'openai', model: 'beta' },
  groups: verifiedGroups,
});
assert(exactSelection.ready && exactSelection.state === 'ready', 'bare and provider-prefixed exact IDs share one readiness identity', exactSelection);
const absentSelection = resolveModelSelectionReadiness({
  route: { provider: 'openai', model: 'alpha' },
  groups: verifiedGroups,
});
assert(!absentSelection.ready && absentSelection.state === 'not_listed', 'verified account rejects curated shelf IDs absent from its inventory', absentSelection);
const disconnectedSelection = resolveModelSelectionReadiness({
  route: { provider: 'openai', model: 'beta' },
  groups: verifiedGroups.map((group) => ({ ...group, connected: false, models: group.models.map((model) => ({ ...model, ready: false })) })),
});
assert(!disconnectedSelection.ready && disconnectedSelection.state === 'connection_required', 'disconnected provider cannot authorize a built-in shelf model');
const unmanagedSelection = resolveModelSelectionReadiness({ route: null, groups: [] });
assert(unmanagedSelection.ready && unmanagedSelection.state === 'route_unmanaged', 'separate image/tool capability routes are not disabled by hosted-chat readiness');
const blackSwanSelection = resolveModelSelectionReadiness({
  route: { provider: 'huggingface', model: 'huggingface_endpoint/cswan801/BlackSwan-v5' },
  groups: [{
    provider: 'blackswan', connected: true, catalogStatus: 'circle_integration',
    models: [{ id: 'huggingface_endpoint/cswan801/BlackSwan-v5', ready: true }],
  }],
});
assert(blackSwanSelection.ready, 'circle-owned BlackSwan endpoint remains an exact Hugging Face execution authority');

const providers = source('src/lib/llmProviders.ts');
const registry = source('src/lib/integrations/modelProviderRegistry.ts');
const chat = source('src/screens/circles/tabs/ChatTab.tsx');
const rooms = source('src/screens/circles/tabs/RoomsTab.tsx');
const roomChatService = source('src/lib/roomChatService.ts');
const spawn = source('src/screens/circles/tabs/chat/SpawnAgentsModal.tsx');
const office = source('src/components/OfficeTerminal.tsx');
const marketplace = source('src/components/marketplace/LlmProviderMarketplace.tsx');
const proxy = source('supabase/functions/llm-proxy/index.ts');
const roadmap = source('docs/AGENTS_ROADMAP.md');

assert(providers.includes('loadProviderModelCatalogSnapshot'), 'catalog IO exposes a typed snapshot instead of an ambiguous array');
assert(providers.includes("status: 'verified'"), 'a structurally valid provider response records verified status even when empty');
assert(providers.includes('PROVIDER_MODEL_CATALOG_FAILURE_TTL_MS'), 'catalog failures use a short retry cache instead of the verified TTL');
assert(providers.includes('llmProxySupportsModelCatalog'), 'catalog IO feature-negotiates the deployed proxy before list_models');
const catalogCapabilityGate = providers.indexOf('if (!(await llmProxySupportsModelCatalog');
const catalogProxyInvoke = providers.indexOf("action: 'list_models'");
assert(catalogCapabilityGate >= 0 && catalogCapabilityGate < catalogProxyInvoke, 'missing deployed catalog capability falls back before a non-2xx proxy request');
assert(proxy.includes('capabilities: ["chat", "list_models", "openai-embed"]'), 'llm-proxy GET health advertises its supported request shapes');
assert(providers.includes('const cacheKey = userId ? `${userId}:${provider}`'), 'snapshot cache remains scoped to exact user and provider');
assert(providers.includes("if (!userId) return createProviderModelCatalogFallback(provider, 'auth_unavailable')"), 'catalog discovery avoids unauthenticated Edge traffic while session hydration is incomplete');
assert(providers.includes("details.code || 'request_failed'"), 'safe proxy error codes survive into readiness without raw provider prose');
assert(providers.includes('const snapshot = await loadProviderModelCatalogSnapshot'), 'legacy array callers delegate to the canonical snapshot owner');
assert(providers.includes('subscribeUserApiKeyChanges(() => { void refresh(); })'), 'all useUserApiKeys consumers refresh after same-runtime credential changes');
assert(providers.includes('sequence !== refreshSequenceRef.current'), 'slower stale key reads cannot overwrite a newer credential refresh');

assert(registry.includes('projectProviderCatalogModels'), 'all shared selector groups use exact verified projection');
assert(registry.includes('loadProviderCatalogWithTimeout') && registry.includes('clearTimeout(timeoutId)'), 'bounded parallel catalog hydration clears completed timeout handles');
assert(registry.includes("catalogStatus: catalogReadiness.state"), 'selector groups carry readiness state instead of inferring it from connection');
assert(registry.includes('const availability = optionAvailability(profile)') && registry.includes('availability,'), 'selector options carry account-listed versus fallback provenance');
assert(registry.includes("catalogSnapshot.status === 'verified'"), 'verified account inventories gate curated/registered additions');
assert(registry.includes("&& !(hasUserKey && catalogSnapshot.status === 'verified')"), 'connected verified-empty providers remain visible instead of disappearing');

assert(chat.includes('group.catalogLabel'), 'Chat model groups render the shared catalog label');
assert(chat.includes("model.availability === 'account_listed'"), 'Chat distinguishes account-listed models from fallback rows');
assert(chat.includes("section?.catalogStatus === 'account_verified_empty'"), 'Chat explains a verified empty account catalog');
assert(chat.includes('const readiness = pickerModelReadiness(model.id)'), 'curated Chat shelves resolve every hosted model through account readiness');
assert(chat.includes('disabled={!modelReady}') && chat.includes("cursor: modelReady ? 'pointer' : 'not-allowed'"), 'unavailable expanded Chat models are non-interactive and visibly disabled');
assert(chat.includes('readyModelCount') && chat.includes('need access'), 'Chat section counts distinguish ready models from access-required previews');
assert(chat.includes('resolveModelSelectionReadiness({') && chat.includes('Nothing ran.'), 'Chat pre-send stops disconnected/Auto-unavailable models before provider I/O');
assert(chat.includes("effectiveSelectedModel === 'auto'\n        || modelReadiness.state === 'connection_required'"), 'new-selection readiness does not silently invalidate a connected persisted exact model absent from a changing list');
assert(chat.includes('.filter((g) => g.connected && g.models.some((model) => model.ready))'), 'Auto provider bias excludes connected accounts with zero ready models');
assert(chat.includes('autoResolvedReadiness') && chat.includes('access needed'), 'Auto preview exposes an unavailable exact resolution before send');
assert(chat.includes('pickerModelReadiness(recommendation.model).ready'), 'model recommendation chips never switch to an unavailable hosted model');
assert(chat.includes("const [popularModelsSource, setPopularModelsSource] = useState<'curated' | 'live'>('curated')"), 'Chat tracks whether popular rows are live or the current curated fallback');
assert(rooms.includes('group.catalogLabel'), 'Rooms renders the same shared catalog label');
assert(rooms.includes('g.models.filter((model) => model.ready).length'), 'Rooms availability count excludes disconnected preview models');
assert(rooms.includes('subscribeUserApiKeyChanges') && rooms.includes('[circleId, modelProviderRefreshToken]'), 'Rooms refreshes catalog readiness immediately after Marketplace credential changes');
assert(rooms.includes('const connectedModelProviders = useMemo') && rooms.includes('group.models.some((model) => model.ready)'), 'Rooms Auto derives provider preference only from groups with a ready exact model');
assert((rooms.match(/connectedProviders: connectedModelProviders/g) || []).length === 2, 'Rooms threads ready provider authority through both new-turn and continuation dispatch');
assert(roomChatService.includes('connectedProviders?: string[]') && /connectedProviders,\s*surface:\s*'room_chat'/.test(roomChatService), 'Room chat passes ready provider authority into the canonical OpenSwan resolver');
assert(spawn.includes('modelCatalogNotice'), 'agent spawn surfaces catalog fallback/empty readiness instead of silently flattening it');
assert(spawn.includes("group.catalogStatus === 'account_verified_empty'"), 'agent spawn recognizes verified empty provider accounts');
assert(spawn.includes("const baseChoices = webChannel\n          ? [{ key: 'auto', label: 'AUTO' }]\n          : buildDefaultModelChoices()"), 'web agent spawn does not flash always-ready Claude defaults without account evidence');
assert(spawn.includes('setAccountModelGroups(groups)') && spawn.includes('resolveModelSelectionReadiness({'), 'web agent spawn rechecks the resolved exact deploy model against the shared account catalog');
assert(spawn.includes('Nothing launched.'), 'unavailable deploy models stop before fan-out with explicit no-mutation copy');
assert(office.includes('loadModelGroups(circleId, { includeDisconnected: false })'), 'Office terminal consumes the shared exact account-catalog registry');
assert(office.includes('setAccountModelChoices([])') && office.includes('Checking account model catalogs'), 'Office does not flash curated BYO choices as verified while account discovery is pending');
assert(office.includes('modelCatalogNotice'), 'Office surfaces verified-empty and fallback readiness near its model controls');
const officeBaseModels = office.slice(
  office.indexOf('const BASE_MODELS'),
  office.indexOf('/** Build BYO model entries'),
);
assert(!officeBaseModels.includes("key: 'gpt-5.6-terra'") && !officeBaseModels.includes("key: 'gemini-3.6-flash'"), 'Office never offers bare account-provider ids whose labels can disagree with the executed fallback route');
assert(
  !officeBaseModels.includes("key: 'glm-5.1'")
    && !officeBaseModels.includes("key: 'MiniMax-M2.7'")
    && !officeBaseModels.includes("key: 'deepseek-v4-pro'"),
  'Office never offers current-looking open-model shortcuts that its server runtime does not map exactly',
);
assert(office.includes('provider embedded in the model id'), 'Office documents why account-backed choices must retain exact provider authority');
assert(marketplace.includes('loadProviderModelCatalogSnapshot'), 'Marketplace checks connected cards through the canonical account snapshot');
assert(marketplace.includes('projectProviderCatalogModels'), 'Marketplace count uses exact verified projection or explicit curated fallback');
assert(marketplace.includes('connect to check this account'), 'disconnected Marketplace cards call their rows curated instead of available');
assert(!marketplace.includes("model{modelCount === 1 ? '' : 's'} available"), 'Marketplace no longer labels every curated model as account-available');
assert(roadmap.includes('modelCatalogReadinessCore.ts'), 'roadmap ownership includes the readiness core');

if (failed > 0) {
  console.error(`\nmodel-catalog-readiness smoke: ${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`model-catalog-readiness smoke: ${passed} passed, 0 failed`);
