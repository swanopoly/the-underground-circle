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
  type ModelSelectionCatalogGroup,
  type ProviderModelCatalogSnapshot,
} from '../src/lib/modelCatalogReadinessCore';
import {
  classifyProviderFreeChatTurn,
  collectActiveChatProviderQuarantines,
  hasIndependentChatActionContinuation,
  hasProviderFreeChatCompoundIntent,
  isProviderFreeStructuredSingleIntent,
  resolveReadyChatModelForTurn,
  resolveReadyChatVisualBriefModel,
} from '../src/lib/chatModelFallbackCore';
import { segmentChatIntents } from '../src/lib/chatMultiIntentCore';

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
const rejectedCredential = buildModelCatalogReadinessProfile({
  connected: true,
  snapshotStatus: 'fallback',
  selectableModelCount: 4,
  failureCode: 'provider_credential_rejected',
});
assert(
  !rejectedCredential.connected && rejectedCredential.state === 'not_connected',
  'a provider-rejected saved key cannot make curated rows look ready',
  rejectedCredential,
);
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

const connectedFallbackGroups: ModelSelectionCatalogGroup[] = [
  {
    provider: 'anthropic', connected: false, catalogStatus: 'not_connected',
    models: [{ id: 'claude-sonnet-4-6', ready: false }],
  },
  {
    provider: 'openai', connected: true, catalogStatus: 'account_verified',
    models: [
      { id: 'openai/gpt-5.6-sol', ready: true },
      { id: 'openai/gpt-5.6-terra', ready: true },
    ],
  },
];
const preferredFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: connectedFallbackGroups,
  preferredModelIds: ['openai/gpt-5.6-terra'],
});
assert(
  preferredFallback?.modelId === 'openai/gpt-5.6-terra'
    && preferredFallback.fallbackFromModelId === 'claude-sonnet-4-6'
    && preferredFallback.source === 'preferred_ready',
  'an unavailable selected API falls back to the task-preferred exact ready model',
  preferredFallback,
);
const catalogFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: connectedFallbackGroups,
  preferredModelIds: ['google_ai/gemini-3.6-flash'],
});
assert(
  catalogFallback?.modelId === 'openai/gpt-5.6-terra' && catalogFallback.source === 'baseline_ready',
  'an unavailable preferred fallback continues through the explicit safe baseline policy',
  catalogFallback,
);
const requestedReady = resolveReadyChatModelForTurn({
  requestedModelId: 'openai/gpt-5.6-sol',
  groups: connectedFallbackGroups,
  preferredModelIds: ['openai/gpt-5.6-terra'],
});
assert(
  requestedReady?.modelId === 'openai/gpt-5.6-sol' && requestedReady.fallbackFromModelId === null,
  'a ready explicit model remains pinned instead of being silently replaced',
  requestedReady,
);
const bareRequestedReady = resolveReadyChatModelForTurn({
  requestedModelId: 'gpt-5.6-terra',
  groups: connectedFallbackGroups,
});
assert(
  bareRequestedReady?.modelId === 'openai/gpt-5.6-terra'
    && bareRequestedReady.source === 'requested'
    && bareRequestedReady.fallbackFromModelId === null,
  'a ready bare picker alias dispatches the exact provider-prefixed catalog row without becoming a fallback',
  bareRequestedReady,
);
const imageOnlyTextFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'flux-schnell',
  groups: connectedFallbackGroups,
});
assert(
  imageOnlyTextFallback?.modelId === 'openai/gpt-5.6-terra'
    && imageOnlyTextFallback.fallbackFromModelId === 'flux-schnell',
  'an image-only picker resolves an exact connected text API without touching an unavailable image route first',
  imageOnlyTextFallback,
);
const staleSavedModelFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'retired-provider/model-v0',
  groups: connectedFallbackGroups,
});
assert(
  staleSavedModelFallback?.modelId === 'openai/gpt-5.6-terra'
    && staleSavedModelFallback.fallbackFromModelId === 'retired-provider/model-v0',
  'an unmanaged stale saved model cannot bypass the exact connected-model selector',
  staleSavedModelFallback,
);

const providerFreePositive = [
  '/help', '/commands', '__SEND_CRYPTO__', '__TIP__', '__SPAWN_AGENT__', '__SPAWN_AGENTS__',
  'help', 'what can you do?', '/lanes', 'my tasks', 'stats', 'research provider APIs', 'wiki BYOK',
  '/integrations', '/integrations list', '/integrations connect openai', '/context', '/memory-bank',
  '/integration connect openai', 'what model are you using?', 'who checked in?',
  '/automation', '/automation run', '/replay', '/record start', '/pins', '/trace run-1', '/vault',
  '/search', '/poll', '/propose', '/schedule',
  '/diag', '/bridges', '/desktop', '/desktop health', '/desktop diagnose Photoshop',
  '/screen', '/screen Photoshop', '/apps', '/apps open Notes', '/assign',
];
for (const command of providerFreePositive) {
  assert(
    classifyProviderFreeChatTurn({ content: command }) !== null,
    `provider-free command remains usable without a model API: ${command}`,
  );
}
const providerFreeNegative = [
  '/integrations act deploy this', '/integrations do deploy this', '/integrations run deploy this',
  '/automation run nightly', '/replay saved-flow',
  '/desktop open Notes', '/assign Codex to fix this',
  '/desktop health Photoshop',
  'status?', '/screen\tNotes',
  '/build-page create a dashboard', '/contextual', '/mbx', '/watcher', '__TIP__x',
  '/vote extra', '/summary extra', '/memory extra',
];
for (const command of providerFreeNegative) {
  assert(
    classifyProviderFreeChatTurn({ content: command }) === null,
    `provider/tool command remains catalog-owned: ${command}`,
  );
}
assert(
  classifyProviderFreeChatTurn({ content: 'draft this', isPlanDraftTurn: true }) === 'local_plan',
  'deterministic Plan mode remains available without a provider API',
);
assert(
  classifyProviderFreeChatTurn({ content: 'which model handled the last task?', isLocalAuditTurn: true }) === 'local_data_command',
  'local model-audit replies remain available without a provider API',
);
assert(
  classifyProviderFreeChatTurn({ content: 'what model are you using?', isLocalSwanBotCommandTurn: true }) === 'local_data_command',
  'the canonical local model-status question remains available without a provider API',
);
for (const localCommand of ['create task Fix login', 'can you use Photoshop?']) {
  assert(
    classifyProviderFreeChatTurn({ content: localCommand, isLocalSwanBotCommandTurn: true }) === 'local_data_command',
    `canonical local command remains provider-free without widening its text grammar: ${localCommand}`,
  );
}
for (const compoundCommand of [
  'wiki BYOK and open Notes',
  'poll Team? Yes, No and open Notes',
  'propose Ship | today and send Slack',
  'poll Team? Yes, No; then open Notes',
  'propose Ship | today; then send Slack',
  '/research provider APIs and send an email',
  '/search customer notes and open Notes',
  '/schedule reminder Check deploy and send Slack',
  '/remember launch code 123 and open Notes',
  '/search notes & open Notes',
  'poll Team? Yes, No; then delete the project',
  'poll Team? Yes, No and delete the project',
  'poll Team? Yes, No; then edit the document',
  'propose Ship | today; then build a dashboard',
  'propose Ship | today and build a dashboard',
  '/poll Team? Yes, No; then create a task',
  '/propose Ship | today; then update the roadmap',
  '/schedule reminder Check deploy and edit the file',
  'propose Ship | today; then delete the old proposal',
  'poll Team? Yes, No; then delete all tasks',
  'poll Team? Yes, No; then delete old files',
  '/remember code; then delete all memories',
  '/vault status; then remove every credential',
  'wiki BYOK and click the button',
  'wiki BYOK and submit the form',
  'wiki BYOK and approve the proposal',
  'wiki BYOK and pay the invoice',
  'wiki BYOK and log into Gmail',
  'wiki BYOK and grant access',
  'wiki BYOK and merge the pull request',
  'wiki BYOK and clear all memories',
  'wiki BYOK and erase every credential',
  'wiki BYOK and rotate the credential',
  'wiki BYOK and disconnect OpenAI',
  'wiki BYOK plus open Notes',
  'wiki BYOK afterwards open Notes',
  'wiki BYOK followed by open Notes',
  'wiki BYOK. Open Notes.',
  '/research provider APIs. Send an email.',
  '/search notes! Delete the file.',
  '/remember alpha\nOpen Notes',
  '/vault status\n2. Delete the credential',
  'poll Team? Yes, No. Open Notes.',
  'propose Ship | today. Deploy the website.',
  'wiki BYOK and open the Notes app',
  '/search notes then open my Notes app',
]) {
  assert(
    hasProviderFreeChatCompoundIntent(compoundCommand),
    `a command-headed compound remains under intact catalog/OpenSwan ownership: ${compoundCommand}`,
  );
}
for (const compoundTurn of [
  'create task Fix login and send an email to Alex',
  'wiki BYOK and open Notes',
  'can you open Photoshop and edit this image?',
  'poll Team? Yes, No; then open Notes',
  'propose Ship | today; then send Slack',
  '/search customer notes and open Notes',
  '/schedule reminder Check deploy and send Slack',
  '/remember launch code 123 and open Notes',
]) {
  assert(
    segmentChatIntents(compoundTurn).isMultiIntent
      || hasProviderFreeChatCompoundIntent(compoundTurn),
    `every formerly swallowed provider-free compound is preserved intact: ${compoundTurn}`,
  );
}
for (const singleCommand of [
  'wiki BYOK',
  'poll Team? Yes, No',
  'propose Ship | today',
  '/research provider APIs',
  'poll Should we build and launch? Yes, No',
  'propose Design and build a dashboard | today',
  'wiki plan and execute patterns',
  'wiki plan and launch strategies',
  'propose Release | Design and launch next week',
  '/search open and launch patterns',
  '/schedule reminder Review and launch checklist',
  'poll Choose? Design, Build and launch today',
  'poll Team? Build dashboard, Fix project',
  'poll Which first? Delete file, Update roadmap',
  'poll Choose? Open Notes, Build dashboard',
  'propose New UI | Research users and build dashboard',
  'propose New UI | We will research users and build dashboard',
  'propose New UI | Today research users and build dashboard',
  'propose New UI | Goal is to research users and build dashboard',
]) {
  assert(
    !hasProviderFreeChatCompoundIntent(singleCommand)
      && (
        !segmentChatIntents(singleCommand).isMultiIntent
        || isProviderFreeStructuredSingleIntent(singleCommand)
      ),
    `a true single local command remains provider-free: ${singleCommand}`,
  );
}
assert(
  isProviderFreeStructuredSingleIntent('poll Choose? Design, Build and launch today')
    && !isProviderFreeStructuredSingleIntent('poll Team? Yes, No and delete the project'),
  'structured poll grammar suppresses generic verb noise but never masks an external action tail',
);
for (const localCompound of [
  'create task Fix login along with open Notes',
  'create task Fix login; separately open Notes',
  'can you use Photoshop and separately delete the file?',
  'Every morning remind the circle to check in. Then, right now, open Notes.',
  'Every morning remind the circle to check in. Afterward, delete the old task now.',
]) {
  assert(
    hasIndependentChatActionContinuation(localCompound),
    `caller-recognized local command/proposal keeps an explicit continuation intact: ${localCompound}`,
  );
}
assert(
  !hasIndependentChatActionContinuation('can you use Photoshop and edit images?'),
  'a coordinated capability question remains one provider-free local question',
);
assert(
  hasProviderFreeChatCompoundIntent(`wiki ${'topic '.repeat(700)}`),
  'an oversized provider-free command fails closed because its unscanned tail may contain another ask',
);
const activeQuarantines = collectActiveChatProviderQuarantines(new Map([
  ['credential-provider', Number.POSITIVE_INFINITY],
  ['cooling-provider', 1_100],
  ['recovered-provider', 900],
]), 1_000);
assert(
  activeQuarantines.has('credential-provider')
    && activeQuarantines.has('cooling-provider')
    && !activeQuarantines.has('recovered-provider'),
  'confirmed credential exclusions persist while transient provider cooldowns expire',
);
assert(
  classifyProviderFreeChatTurn({ content: 'every morning at 9 remind the circle to check in', isAutomationProposalTurn: true }) === 'local_data_command',
  'review-only automation proposals remain available without a provider API',
);

const visualReady = resolveReadyChatVisualBriefModel([
  ...connectedFallbackGroups,
  {
    provider: 'anthropic', connected: true, catalogStatus: 'account_verified',
    models: [{ id: 'claude-haiku-4-5', ready: true }],
  },
], 'openai/gpt-5.6-terra');
assert(visualReady === 'claude-haiku-4-5', 'visual briefs select only an exact connected image-block transport', visualReady);
const datedVisualReady = resolveReadyChatVisualBriefModel([
  {
    provider: 'anthropic', connected: true, catalogStatus: 'account_verified',
    models: [{ id: 'claude-haiku-4-5-20251001', ready: true }],
  },
], 'openai/gpt-5.6-terra');
assert(
  datedVisualReady === 'claude-haiku-4-5-20251001',
  'visual briefs preserve an exact ready dated Anthropic registry model id',
  datedVisualReady,
);
assert(
  resolveReadyChatVisualBriefModel(connectedFallbackGroups, 'openai/gpt-5.6-terra') === null,
  'a connected text-only provider cannot authorize the hidden visual-analysis request',
);
const datedHaikuFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'openai/gpt-5.6-terra',
  groups: [{
    provider: 'anthropic', connected: true, catalogStatus: 'account_verified',
    models: [{ id: 'claude-haiku-4-5-20251001', ready: true }],
  }],
});
assert(
  datedHaikuFallback?.modelId === 'claude-haiku-4-5-20251001'
    && datedHaikuFallback.source === 'baseline_ready',
  'a dated ready Anthropic registry row remains eligible as a general Chat fallback',
  datedHaikuFallback,
);
const openRouterSameFamily = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'openrouter', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'openrouter/anthropic/claude-sonnet-4-6', ready: true }],
    },
  ],
  preferredModelIds: ['openrouter/anthropic/claude-sonnet-4-6'],
});
assert(
  openRouterSameFamily?.modelId === 'openrouter/anthropic/claude-sonnet-4-6'
    && openRouterSameFamily.source === 'equivalent_ready',
  'a connected alternate API may preserve the requested model family',
  openRouterSameFamily,
);
const shortSonnetToDatedExact = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [{
    provider: 'anthropic', connected: true, catalogStatus: 'account_verified',
    models: [{ id: 'claude-sonnet-4-6-20260301', ready: true }],
  }],
});
assert(
  shortSonnetToDatedExact?.modelId === 'claude-sonnet-4-6-20260301'
    && shortSonnetToDatedExact.source === 'equivalent_ready',
  'a stable picker Sonnet id resolves to the exact connected dated Anthropic row',
  shortSonnetToDatedExact,
);
const shortHaikuToOpenRouter = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-haiku-4-5',
  groups: [{
    provider: 'openrouter', connected: true, catalogStatus: 'account_verified',
    models: [{ id: 'openrouter/anthropic/claude-haiku-4-5', ready: true }],
  }],
});
assert(
  shortHaikuToOpenRouter?.modelId === 'openrouter/anthropic/claude-haiku-4-5'
    && shortHaikuToOpenRouter.source === 'equivalent_ready',
  'a stable picker Haiku id can use the exact connected alternate API route',
  shortHaikuToOpenRouter,
);
const noConnectedFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [connectedFallbackGroups[0]],
});
assert(noConnectedFallback === null, 'no connected ready model keeps the turn blocked');
const excludedBlackSwanFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'blackswan', connected: true, catalogStatus: 'circle_integration',
      models: [{ id: 'huggingface_endpoint/cswan801/BlackSwan-v5', ready: true }],
    },
  ],
});
assert(excludedBlackSwanFallback === null, 'circle BlackSwan runtime credentials never authorize ordinary plain-Chat fallback');
const unmanagedCatalogRow = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'ollama', connected: true, catalogStatus: 'curated_fallback',
      models: [{ id: 'ollama/qwen3', ready: true }],
    },
  ],
});
assert(unmanagedCatalogRow === null, 'local-only catalog rows cannot become hosted Chat fallbacks');
const shuffledFallbackA = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: connectedFallbackGroups,
});
const shuffledFallbackB = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    { ...connectedFallbackGroups[1], models: [...connectedFallbackGroups[1].models].reverse() },
    connectedFallbackGroups[0],
  ],
});
assert(
  JSON.stringify(shuffledFallbackA) === JSON.stringify(shuffledFallbackB)
    && shuffledFallbackA?.modelId === 'openai/gpt-5.6-terra',
  'provider and model response order cannot change the deterministic fallback decision',
  { shuffledFallbackA, shuffledFallbackB },
);
const premiumOnlyFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'anthropic', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'claude-opus-5', ready: true }],
    },
  ],
});
assert(premiumOnlyFallback === null, 'manual-only premium rows are never selected as automatic fallbacks');
const verifiedSolOnlyFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'openai', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'openai/gpt-5.6-sol', ready: true }],
    },
  ],
});
assert(
  verifiedSolOnlyFallback?.modelId === 'openai/gpt-5.6-sol'
    && verifiedSolOnlyFallback.source === 'catalog_ready',
  'an exact account-verified chat model remains a last-resort connected fallback even when it is outside the low-cost baseline ladder',
  verifiedSolOnlyFallback,
);
const verifiedBeatsCurated = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'openrouter', connected: true, catalogStatus: 'curated_fallback',
      models: [{ id: 'openrouter/anthropic/claude-sonnet-4-6', ready: true }],
    },
    connectedFallbackGroups[1],
  ],
});
assert(
  verifiedBeatsCurated?.modelId === 'openai/gpt-5.6-terra'
    && verifiedBeatsCurated.source === 'baseline_ready',
  'verified account evidence outranks a curated equivalent fallback',
  verifiedBeatsCurated,
);
const exactCaseFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'hugging_face', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'huggingface/Qwen/Qwen3-32B', ready: true }],
    },
  ],
});
assert(
  exactCaseFallback?.modelId === 'huggingface/Qwen/Qwen3-32B',
  'fallback dispatch preserves the exact case-sensitive registry model id',
  exactCaseFallback,
);
assert(
  resolveReadyChatModelForTurn({ requestedModelId: 'auto', groups: connectedFallbackGroups }) === null,
  'fallback never returns an unresolved Auto sentinel as a concrete executor',
);
assert(
  resolveReadyChatModelForTurn({ requestedModelId: 'ollama/qwen3', groups: connectedFallbackGroups })?.modelId
    === 'openai/gpt-5.6-terra',
  'an unavailable local model can fall back to an exact connected hosted Chat route',
);
const duplicateAliasFamilyFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'openrouter/deepseek/deepseek-r1',
  groups: [
    {
      provider: 'openrouter', connected: false, catalogStatus: 'not_connected',
      models: [{ id: 'openrouter/deepseek/deepseek-r1', ready: false }],
    },
    {
      provider: 'deepseek', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'deepseek/deepseek-reasoner', ready: true }],
    },
  ],
});
assert(
  duplicateAliasFamilyFallback?.modelId === 'deepseek/deepseek-reasoner'
    && duplicateAliasFamilyFallback.source === 'equivalent_ready',
  'all matching logical alias families contribute exact equivalent routes',
  duplicateAliasFamilyFallback,
);
const publicBlackSwanCannotAuthorizeEndpoint = resolveReadyChatModelForTurn({
  requestedModelId: 'huggingface_endpoint/cswan801/BlackSwan-v5',
  groups: [{
    provider: 'hugging_face', connected: true, catalogStatus: 'account_verified',
    models: [{ id: 'huggingface/cswan801/BlackSwan-v5', ready: true }],
  }],
});
assert(
  publicBlackSwanCannotAuthorizeEndpoint?.modelId === 'huggingface/cswan801/BlackSwan-v5'
    && publicBlackSwanCannotAuthorizeEndpoint.fallbackFromModelId === 'huggingface_endpoint/cswan801/BlackSwan-v5',
  'an endpoint-only saved pick may fall away to an exact connected plain-Chat API without dispatching the endpoint id through the wrong transport',
  publicBlackSwanCannotAuthorizeEndpoint,
);
const endpointToOpenAiFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'huggingface_endpoint/cswan801/BlackSwan-v5',
  groups: [connectedFallbackGroups[1]],
});
assert(
  endpointToOpenAiFallback?.modelId === 'openai/gpt-5.6-terra',
  'an unavailable endpoint request can fall back to a separate exact connected hosted API',
  endpointToOpenAiFallback,
);
const userHfPublicBlackSwanFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'hugging_face', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'huggingface/cswan801/BlackSwan-v5', ready: true }],
    },
  ],
});
assert(
  userHfPublicBlackSwanFallback?.modelId === 'huggingface/cswan801/BlackSwan-v5',
  'an exact user-owned public Hugging Face key may authorize the public BlackSwan model',
  userHfPublicBlackSwanFallback,
);
const githubOnlyFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'github-models', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'github-models/openai/gpt-4.1-mini', ready: true }],
    },
  ],
});
assert(
  githubOnlyFallback?.modelId === 'github-models/openai/gpt-4.1-mini'
    && githubOnlyFallback.selectedCatalogStatus === 'account_verified',
  'a GitHub Models-only connected account receives the reviewed free fallback',
  githubOnlyFallback,
);
const excludedEndpointFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'claude-sonnet-4-6',
  groups: [
    connectedFallbackGroups[0],
    {
      provider: 'blackswan', connected: true, catalogStatus: 'circle_integration',
      models: [{ id: 'huggingface_endpoint/cswan801/BlackSwan-v5', ready: true }],
    },
  ],
  excludedModelIds: ['huggingface_endpoint/cswan801/BlackSwan-v5'],
});
assert(excludedEndpointFallback === null, 'an exact turn exclusion cannot be bypassed through another catalog group');
const toolCapableMultiActionFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'perplexity/sonar',
  groups: [
    {
      provider: 'perplexity', connected: true, catalogStatus: 'account_verified',
      models: [{ id: 'perplexity/sonar', ready: true }],
    },
    connectedFallbackGroups[1],
  ],
  requireToolUse: true,
});
assert(
  toolCapableMultiActionFallback?.modelId === 'openai/gpt-5.6-terra'
    && toolCapableMultiActionFallback.fallbackFromModelId === 'perplexity/sonar',
  'a multi-action turn replaces a ready text-only model with an exact connected tool-capable executor',
  toolCapableMultiActionFallback,
);
const quarantinedUnsupportedProviderFallback = resolveReadyChatModelForTurn({
  requestedModelId: 'perplexity/sonar',
  groups: [
    {
      provider: 'perplexity', connected: true, catalogStatus: 'catalog_unsupported',
      models: [{ id: 'perplexity/sonar', ready: true }],
    },
    connectedFallbackGroups[1],
  ],
  excludedGroupProviders: ['perplexity'],
});
assert(
  quarantinedUnsupportedProviderFallback?.modelId === 'openai/gpt-5.6-terra'
    && quarantinedUnsupportedProviderFallback.fallbackFromModelId === 'perplexity/sonar',
  'a failed provider without a catalog probe is excluded as both requested route and fallback so another exact connected API answers',
  quarantinedUnsupportedProviderFallback,
);

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
assert(
  providers.includes('providerModelCatalogCacheEpoch')
    && providers.includes('providerModelCatalogRequestGeneration')
    && providers.includes('mayPublishCache()'),
  'retired or superseded catalog requests cannot repopulate the exact readiness cache late',
);
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
assert(
  registry.includes('failureCode: catalogSnapshot.failureCode')
    && registry.includes('ready: connected && profile.connected')
    && registry.includes('connected: catalogReadiness.connected'),
  'stable catalog credential failures retire both provider-group and exact-model readiness',
);
assert(
  proxy.includes('"provider_credential_rejected"')
    && proxy.includes('error.status === 401 || error.status === 403'),
  'provider 401/403 catalog failures keep a bounded stable credential-rejected code',
);

assert(chat.includes('group.catalogLabel'), 'Chat model groups render the shared catalog label');
assert(chat.includes("model.availability === 'account_listed'"), 'Chat distinguishes account-listed models from fallback rows');
assert(chat.includes("section?.catalogStatus === 'account_verified_empty'"), 'Chat explains a verified empty account catalog');
assert(chat.includes('const readiness = pickerModelReadiness(model.id)'), 'curated Chat shelves resolve every hosted model through account readiness');
assert(chat.includes('disabled={!modelReady}') && chat.includes("cursor: modelReady ? 'pointer' : 'not-allowed'"), 'unavailable expanded Chat models are non-interactive and visibly disabled');
assert(chat.includes('readyModelCount') && chat.includes('need access'), 'Chat section counts distinguish ready models from access-required previews');
assert(
  chat.includes('resolveReadyChatModelForTurn({')
    && chat.includes('resolvedTurnModel = selection.modelId')
    && chat.includes('No approved connected Chat model could safely run this turn, so nothing ran.'),
  'Chat substitutes a deterministic approved connected model and truthfully blocks when none can safely run the turn',
);
assert(
  chat.includes('const preflightHasProviderFreeCommandCompound = hasProviderFreeChatCompoundIntent(content)')
    && chat.includes('const preflightPreservesIntactMultiIntentTurn = preflightHasAuthoritativeMultiActionContract')
    && chat.includes('|| preflightHasProviderFreeCommandCompound')
    && chat.includes('const providerFreeTurn = preflightPreservesIntactMultiIntentTurn ? null : classifyProviderFreeChatTurn({')
    && chat.includes("if (!providerFreeTurn && plan.execution.kind === 'run_computer_task')")
    && chat.includes('const canonicalLocalSwanBotCommandTurn =')
    && chat.includes('(canonicalLocalSwanBotCommandTurn || preflightAutomationProposal)')
    && chat.includes('&& hasIndependentChatActionContinuation(content)')
    && chat.includes('if (!preflightPreservesIntactMultiIntentTurn && preflightAutomationProposal)')
    && chat.includes('if (canonicalLocalSwanBotCommandTurn) {')
    && chat.includes('No model API was called.')
    && chat.includes('&& !providerFreeTurn'),
  'only exact single-action provider-free commands bypass readiness, and their local handler terminates on success, null, or failure',
);
assert(
  chat.includes("!preservesIntactMultiIntentTurn\n      && (lowerContent === '/search'")
    && chat.includes("!preservesIntactMultiIntentTurn\n      && (lowerContent === '/schedule'")
    && chat.includes("!preservesIntactMultiIntentTurn\n      && (lowerContent === '/screen'")
    && chat.includes("!preservesIntactMultiIntentTurn\n      && (lowerContent === '/apps'"),
  'late local command interceptors cannot peel one command off an intact compound turn',
);
assert(
  chat.includes('const capResult = await routeByCapability(\n          contentWithAttachments,\n          resolvedTurnModel || effectiveSelectedModel,')
    && !chat.includes('turnCapabilityTextFallbackUnavailable'),
  'an image-only or stale saved choice cannot perform provider I/O before its connected text fallback',
);
assert(
  chat.includes("|| selection?.source === 'equivalent_ready'")
    && chat.includes('requestedCatalogAbsenceVerified')
    && chat.includes("resolvedTurnModel = selection?.source === 'requested'")
    && chat.includes('? selection.modelId\n          : catalogRequestedTurnModel;'),
  'reviewed aliases resolve exactly, ready bare picks dispatch the provider row, and verified absent choices use a connected fallback',
);
assert(
  chat.includes('const turnModelDecision: { selection: ReadyChatModelTurnSelection | null }')
    && chat.includes('Your saved model choice was not changed.')
    && chat.includes('model: dispatchSeal.model'),
  'fallback remains turn-local, is disclosed, and feeds the effective model into prompt construction',
);
assert(
  chat.includes("status: 'loading' | 'ready' | 'error'")
    && chat.includes('snapshot.generation === modelCatalogGenerationRef.current')
    && chat.includes('const captureTurnModelDispatch = ():')
    && chat.includes('const commitTurnModelDispatch = (')
    && chat.includes('preparedPlainChatDispatch = await preparePlainChatDispatch()')
    && chat.includes('const dispatchSeal = commitTurnModelDispatch(preparedPlainChatDispatch!.seal)')
    && chat.includes('const openSwanDispatchSeal = commitTurnModelDispatch();'),
  'Chat seals the exact catalog generation at every first provider boundary',
);
assert(
  chat.includes('CHAT_MODEL_CATALOG_SEND_FRESHNESS_MS')
    && chat.includes('forceCatalogRefresh: true')
    && chat.includes('forceNextModelCatalogRefreshRef.current = true')
    && chat.includes('modelCatalogRefreshSendLockRef.current = true')
    && chat.includes('failedModelProviderQuarantineRef.current.set')
    && chat.includes('collectActiveChatProviderQuarantines')
    && chat.includes("excludedGroupProviders: ['blackswan', ...quarantinedProviders]")
    && chat.includes('loadChatModelCatalogWithinDeadline'),
  'Chat bounds and serializes stale readiness refresh, then quarantines failed providers until a key change',
);
assert(
  chat.includes('failedModelProviderQuarantineScopeRef')
    && chat.includes('failedModelProviderQuarantineScopeRef.current.userId !== currentUserId')
    && chat.includes('failedModelProviderQuarantineScopeRef.current.circleId !== circleId')
    && chat.includes('failedModelProviderQuarantineRef.current.clear()'),
  'provider quarantines are retired synchronously when exact account or circle authority changes',
);
assert(
  chat.includes('const requestedIsReadyLocalOllama = !catalogRequestedRoute')
    && chat.includes('|| !catalogRequestedRoute')
    && chat.includes('Every other unmanaged/stale saved id'),
  'verified local Ollama stays local while unknown saved ids use connected hosted fallback',
);
assert(
  chat.includes('showRouteChips: Boolean(dispatchSeal.fallbackSelection?.fallbackFromModelId)')
    && chat.includes('message.routing?.provider_model || message.usage?.model || source.effectiveModel'),
  'successful fallback responses show requested-versus-actual model provenance',
);
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
