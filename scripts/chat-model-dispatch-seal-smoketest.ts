/**
 * Behavioral regression for Chat's generation-bound pre-dispatch model seal.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadChatModelCatalogWithinDeadline,
  prepareStableChatModelDispatch,
  resolveReadyChatModelForTurn,
  sameChatModelDispatchIdentity,
} from '../src/lib/chatModelFallbackCore';
import { resolvePlainChatModelRoute } from '../src/lib/crossProviderRouter';
import { prettyProviderName } from '../src/lib/modelRouteExplainCore';

async function main(): Promise<void> {
  await assert.rejects(
    loadChatModelCatalogWithinDeadline(() => new Promise<never>(() => {}), 5),
    /Connected model verification timed out/,
    'an unbounded account-catalog dependency cannot wedge Chat Send',
  );
  const stableSnapshot = Object.freeze({
    model: 'openai/gpt-5.6-terra',
    catalogGeneration: 7,
    marker: 'stable',
  });
  let stableBuilds = 0;
  const stable = await prepareStableChatModelDispatch({
    capture: () => stableSnapshot,
    prepare: async (model) => {
      stableBuilds += 1;
      return `prompt:${model}`;
    },
  });
  assert.equal(stableBuilds, 1, 'a stable catalog builds one prompt');
  assert.equal(stable?.snapshot, stableSnapshot, 'the exact captured snapshot is retained');
  assert.equal(stable?.prepared, 'prompt:openai/gpt-5.6-terra');

  let current = Object.freeze({ model: 'claude-sonnet-4-6', catalogGeneration: 10 });
  const rebuiltModels: string[] = [];
  const rebuilt = await prepareStableChatModelDispatch({
    capture: () => current,
    prepare: async (model) => {
      rebuiltModels.push(model);
      if (rebuiltModels.length === 1) {
        current = Object.freeze({ model: 'google_ai/gemini-3.6-flash', catalogGeneration: 11 });
      }
      return `prompt:${model}`;
    },
  });
  assert.deepEqual(
    rebuiltModels,
    ['claude-sonnet-4-6', 'google_ai/gemini-3.6-flash'],
    'a generation change discards the stale prompt and rebuilds with the new connected model',
  );
  assert.equal(rebuilt?.snapshot.model, 'google_ai/gemini-3.6-flash');
  assert.equal(rebuilt?.snapshot.catalogGeneration, 11);
  assert.equal(rebuilt?.prepared, 'prompt:google_ai/gemini-3.6-flash');

  let churnGeneration = 20;
  let churnBuilds = 0;
  const churned = await prepareStableChatModelDispatch({
    capture: () => ({ model: `model-${churnGeneration}`, catalogGeneration: churnGeneration }),
    prepare: async () => {
      churnBuilds += 1;
      churnGeneration += 1;
      return 'discarded';
    },
    maxAttempts: 2,
  });
  assert.equal(churned, null, 'continuous catalog churn fails closed');
  assert.equal(churnBuilds, 2, 'continuous churn obeys the exact retry bound');

  let blockedBuilds = 0;
  const blocked = await prepareStableChatModelDispatch({
    capture: () => null,
    prepare: async () => {
      blockedBuilds += 1;
      return 'unreachable';
    },
  });
  assert.equal(blocked, null, 'missing exact catalog authority fails closed');
  assert.equal(blockedBuilds, 0, 'missing authority starts no prompt/provider preparation');

  assert.equal(
    sameChatModelDispatchIdentity(
      { model: 'same', catalogGeneration: 1 },
      { model: 'same', catalogGeneration: 1 },
    ),
    true,
    'matching model and generation are the same dispatch identity',
  );
  assert.equal(
    sameChatModelDispatchIdentity(
      { model: 'same', catalogGeneration: 1 },
      { model: 'same', catalogGeneration: 2 },
    ),
    false,
    'a newer generation is never mistaken for the prepared dispatch',
  );
  assert.equal(
    sameChatModelDispatchIdentity(
      { model: 'model-a', catalogGeneration: 2 },
      { model: 'model-b', catalogGeneration: 2 },
    ),
    false,
    'a model change within one generation also invalidates prepared context',
  );
  assert.equal(
    prettyProviderName(resolvePlainChatModelRoute('claude-sonnet-4-6')?.provider),
    'Anthropic',
    'a native Claude selection retains Anthropic as its transport label',
  );
  assert.equal(
    prettyProviderName(resolvePlainChatModelRoute('openrouter/anthropic/claude-sonnet-4-6')?.provider),
    'OpenRouter',
    'the same Claude family through OpenRouter retains the gateway transport label',
  );

  const openAiOnlyGroups = [{
    provider: 'openai',
    connected: true,
    catalogStatus: 'account_verified' as const,
    models: [{ id: 'openai/gpt-5.6-terra', ready: true }],
  }];
  assert.equal(
    resolveReadyChatModelForTurn({
      requestedModelId: 'openrouter/auto',
      groups: openAiOnlyGroups.filter((group) => group.provider === 'openrouter'),
    }),
    null,
    'an account without OpenRouter cannot prepare an OpenRouter web-search call',
  );
  const verifiedOpenRouterSelection = resolveReadyChatModelForTurn({
    requestedModelId: 'openrouter/auto',
    groups: [{
      provider: 'openrouter',
      connected: true,
      catalogStatus: 'account_verified' as const,
      models: [{ id: 'openrouter/openai/gpt-5.6-terra', ready: true }],
    }],
  });
  assert.equal(
    verifiedOpenRouterSelection?.modelId,
    'openrouter/openai/gpt-5.6-terra',
    'verified OpenRouter catalogs replace an absent auto sentinel with one exact listed model',
  );
  const staleSavedSelection = resolveReadyChatModelForTurn({
    requestedModelId: 'openai/completely-unknown',
    groups: openAiOnlyGroups,
  });
  assert.equal(
    staleSavedSelection?.modelId,
    'openai/gpt-5.6-terra',
    'a stale saved id resolves to an exact ready model rather than probing the unknown id',
  );
  assert.equal(
    staleSavedSelection?.fallbackFromModelId,
    'openai/completely-unknown',
    'the stale saved id remains explicit fallback provenance',
  );

  const chat = readFileSync(resolve(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');
  const runtime = readFileSync(resolve(process.cwd(), 'src/lib/agentRuntime.ts'), 'utf8');
  const swanbot = readFileSync(resolve(process.cwd(), 'src/lib/swanbot.ts'), 'utf8');
  assert.match(chat, /modelDispatchSealed: true/, 'specialized Chat modes hand the exact dispatch seal into AgentRuntime');
  assert.match(
    runtime,
    /request\.modelDispatchSealed && model[\s\S]{0,100}\? model[\s\S]{0,120}: resolveModelForProfile/,
    'AgentRuntime cannot replace an exact Chat-sealed model through profile resolution',
  );
  const sealedFailure = swanbot.indexOf('if (sealedCustomModelAttemptFailed && enrichedContext.modelDispatchSealed)');
  const tierTwo = swanbot.indexOf('// Tier 2: Try AI Edge Function');
  assert.ok(sealedFailure >= 0 && tierTwo > sealedFailure, 'a failed sealed marketplace attempt terminates before Anthropic Tier 2');
  assert.match(
    chat,
    /else if \(result\.modelDispatchFailed\)[\s\S]{0,120}quarantineFailedTurnModel\(dispatchSeal\.model, 'transient'\)/,
    'only a typed sealed-model dispatch failure cools down the provider for the next turn',
  );
  assert.match(
    chat,
    /const agentRunOutcomeVerdict: ChatOutcomeVerdict = result\.terminalOutcome\.status === 'completed'[\s\S]{0,360}: 'unknown'/,
    'specialized Chat receipts project the authoritative task terminal instead of transport success',
  );
  assert.match(
    chat,
    /type TurnModelDispatchSeal = Readonly<\{[\s\S]{0,100}provider: string \| null;[\s\S]{0,900}provider: resolvePlainChatModelRoute\(model\)\?\.provider/,
    'the generation-bound dispatch seal captures the exact provider with the exact model',
  );
  assert.match(
    chat,
    /const fallbackLabel = formatModelRouteDisplayName\(seal\.model, seal\.provider\);[\s\S]{0,120}const requestedLabel = formatModelRouteDisplayName\(selection\.fallbackFromModelId\);/,
    'the fallback notice names both the requested API route and the sealed fallback API route',
  );
  assert.match(
    chat,
    /surface: 'main_chat_agent_run',[\s\S]{0,180}provider: dispatchSeal\.provider/,
    'specialized AgentRuntime result metadata persists the sealed provider',
  );
  assert.match(
    chat,
    /surface: 'main_chat_openswan_error',[\s\S]{0,180}provider: committedTurnProvider/,
    'a thrown specialized AgentRuntime error retains the committed provider provenance',
  );
  assert.match(
    chat,
    /committedTurnModelDispatch = newest;\s+committedTurnProvider = newest\.provider;/,
    'the error-path provider is copied only from the dispatch that was actually committed',
  );
  assert.match(
    chat,
    /surface: 'main_chat_stream',[\s\S]{0,120}provider: dispatchSeal\.provider,[\s\S]{0,160}effectiveModel: streamModel/,
    'plain stream metadata persists the exact dispatched model and API provider',
  );
  const openSwanContextSeal = chat.indexOf('context.modelDispatchSealed = true;');
  const sealedOpenSwanDispatch = chat.indexOf('const structured = await runOpenSwanSessionTurn({', openSwanContextSeal);
  assert.ok(
    openSwanContextSeal >= 0 && sealedOpenSwanDispatch > openSwanContextSeal,
    'the committed Chat-to-OpenSwan context forbids a failed provider from replaying through another API',
  );
  assert.match(
    chat,
    /modelProviderDispatchStarted && sendModel && batchErr instanceof SealedModelDispatchError[\s\S]{0,260}quarantineFailedTurnModel\(sendModel, 'transient'\)/,
    'a thrown sealed OpenSwan provider failure cools down that exact API for the next turn',
  );
  assert.match(
    chat,
    /needsProviderDisambiguation[\s\S]{0,1600}formatModelRouteDisplayName\(effectiveModel, provider\)/,
    'persisted same-family fallback chips disambiguate the served model with its provider',
  );
  assert.match(
    chat,
    /const provider = lastBot\.source\?\.provider \|\| lastBot\.routing\?\.provider_routed \|\| null;[\s\S]{0,1600}formatModelRouteDisplayName\(effectiveModel, provider\)[\s\S]{0,400}formatModelRouteDisplayName\(selectedModel\)/,
    'the persisted last-task model audit also distinguishes selected and served transports',
  );
  assert.match(
    chat,
    /const shouldSelectFallback = !requestedReadiness\.ready/,
    'an unknown or stale saved model id cannot bypass the exact ready Marketplace catalog',
  );
  assert.match(
    chat,
    /requestedModelId: 'openrouter\/auto',[\s\S]{0,3000}model: webSearchModel/,
    'Web Search resolves and passes one exact ready OpenRouter catalog model before provider I/O',
  );
  assert.ok(
    /createCatalogBoundRaceInvoker[\s\S]{0,1800}invokePlainChatModel/.test(chat)
      && chat.includes('invoke: createCatalogBoundRaceInvoker(turnModelCatalogGeneration)'),
    'Best-of candidates use the generation-bound exact one-model invoker instead of the default OpenRouter fallback',
  );
  assert.match(
    chat,
    /resolveReadyChatVisualBriefModel\(builderCatalog\.groups, selectedModel\)[\s\S]{0,6000}model: builderModel/,
    'the Anthropic-only page builder starts only with an exact connected Anthropic model',
  );
  assert.match(
    chat,
    /model: isDirectImageCommand \? undefined : \(resolvedTurnModel \|\| undefined\),\s+modelDispatchSealed: !isDirectImageCommand/,
    'text tool commands inherit and seal the exact catalog-resolved Chat model when Auto is selected',
  );

  assert.match(
    swanbot,
    /modelDispatchSealed && marketplaceToolTier\.tier === 'delegate_executor'[\s\S]{0,120}throw new SealedModelDispatchError/,
    'a sealed marketplace model cannot silently delegate to a different executor',
  );
  assert.match(
    swanbot,
    /modelDispatchSealed && loop\.routing\?\.routing_fallback[\s\S]{0,120}throw new SealedModelDispatchError/,
    'an HTTP-200 marketplace provider-unavailable receipt cannot masquerade as a sealed success',
  );
  assert.match(
    swanbot,
    /if \(sealedDirectAnthropicModel\)[\s\S]{0,100}throw new SealedModelDispatchError/,
    'a failed sealed direct-Anthropic attempt cannot become successful fallback prose',
  );

  console.log('chat model dispatch seal smoke: PASS (44 assertions)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
