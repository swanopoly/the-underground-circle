/**
 * model-capabilities-smoketest — verifies the direct-tool hijack fixes in
 * src/lib/modelCapabilities.ts.
 *
 * The invariants under test:
 *   1. Non-imperative text that merely mentions "photo"/"logo"/"imagine"
 *      no longer hijacks the turn into image generation — it stays 'text'.
 *   2. Explicit imperative image asks and slash-command-style prefixes
 *      still detect as image intent; image-only descriptive prompts generate
 *      while questions remain eligible for Chat's text fallback.
 *   3. The legacy capability router never performs image network/blob I/O;
 *      Chat's persisted-message-bound generated-image client owns that lane.
 *   4. Plain text / placeholder intents return handled:false without any
 *      network calls.
 *
 * Phase 2 additions (capability flags foundation):
 *   5. normalizeModelId strips provider/vendor prefixes and treats the
 *      hugging_face/z_ai alias spellings identically.
 *   6. getModelCapabilityFlags: prefixed ids resolve, unknown ids fail
 *      closed (toolUse:false, computerUse:false, vision:false), image-gen
 *      models are imageOnly + toolUse:false, and computerUse:true only for
 *      Sonnet-capable Claude models.
 *
 * Run: npx tsx scripts/model-capabilities-smoketest.ts
 */

import assert from 'node:assert/strict';

let passCount = 0;
function pass(label: string) {
  passCount += 1;
  console.log(`PASS ${passCount}: ${label}`);
}

async function main() {
  // Ensure the module sees no platform Gemini key (module reads env at load).
  delete process.env.EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS;
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  const {
    detectIntent,
    routeByCapability,
    getModelCapabilities,
    normalizeModelId,
    getModelCapabilityFlags,
    shouldRouteSelectedImageModelPrompt,
    UNKNOWN_MODEL_CAPABILITY_FLAGS,
  } = await import('../src/lib/modelCapabilities');

  // ── 1. Non-imperative mentions no longer hijack into image_gen ───────────
  {
    const hijackBait = [
      'the photo licensing terms in this contract are confusing',
      'our logo appears blurry on the marketing site, what CSS fixes that?',
      'imagine-style prompts are stored in the artwork table', // mid-word / mid-sentence
      'can you review the banner ad copy for typos',
      'I attached a picture, what file format is best for the poster print?',
    ];
    for (const msg of hijackBait) {
      assert.notEqual(
        detectIntent(msg, 'claude-sonnet-4-6'),
        'image_gen',
        `non-imperative text must not route to image_gen: "${msg}"`,
      );
    }
    pass('non-imperative image-noun mentions stay off the image path');
  }

  // ── 2. Adjective bait ("create the best ...") no longer fires image ──────
  {
    assert.notEqual(
      detectIntent('create the best sorting algorithm in typescript', 'gpt-5.5'),
      'image_gen',
      'imperative verb + adjective without an image noun is not image intent',
    );
    pass('verb+adjective bait without an image noun is not image intent');
  }

  // ── 3. Real image asks still detect ──────────────────────────────────────
  {
    assert.equal(detectIntent('generate an image of a swan at dusk', 'gpt-4o'), 'image_gen');
    assert.equal(detectIntent('/imagine a castle in the clouds', 'auto'), 'image_gen');
    assert.equal(detectIntent('imagine a castle in the clouds', 'auto'), 'image_gen');
    assert.equal(detectIntent('draw me a logo for a coffee shop', 'gemini-2.5-flash'), 'image_gen');
    pass('imperative and slash-command image asks still detect as image_gen');
  }

  // ── 4. Image-only picker: descriptions generate, questions use text ──────
  {
    assert.deepEqual(getModelCapabilities('flux-schnell'), ['image_gen']);
    assert.equal(detectIntent('a red fox in fresh snow', 'flux-schnell'), 'image_gen');
    assert.equal(shouldRouteSelectedImageModelPrompt('a red fox in fresh snow', 'flux-schnell'), true);
    assert.equal(shouldRouteSelectedImageModelPrompt('what makes a good image prompt?', 'flux-schnell'), false);
    assert.equal(detectIntent('what makes a good image prompt?', 'flux-schnell'), 'text');
    assert.equal(shouldRouteSelectedImageModelPrompt('a red fox', 'gpt-5.5'), false);
    pass('image-only picker routes descriptions to images and questions to text fallback');
  }

  // ── 5. Legacy image capability lane is network/blob free ────────────────
  {
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return {
        ok: false,
        status: 500,
        headers: { get: () => '' },
        json: async () => ({}),
        blob: async () => new Blob(),
      } as unknown as Response;
    }) as typeof fetch;
    try {
      const result = await routeByCapability('generate an image of a swan', 'flux-schnell');
      assert.equal(result.handled, false, 'legacy image lane declines so canonical Chat routing owns it');
      assert.equal(result.artifacts, undefined, 'legacy lane creates no transient artifacts');
      assert.equal(fetchCalls, 0, 'legacy image lane performs no browser network request');
      assert.equal(result.fallbackNotice, undefined, 'canonical routing owns user-facing generator errors');
      pass('legacy image lane declines with zero browser network/blob I/O');
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ── 6. Plain text and placeholder intents: handled:false, zero network ───
  {
    const realFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error('unexpected network call');
    }) as typeof fetch;
    try {
      const textResult = await routeByCapability('what is the weather like today?', 'gpt-5.5');
      assert.equal(textResult.handled, false, 'plain text is not handled');

      const videoResult = await routeByCapability('generate a video of a cat', 'gpt-5.5');
      assert.equal(videoResult.handled, false, 'video placeholder is not handled');

      const audioResult = await routeByCapability('narrate this audio intro', 'gpt-5.5');
      assert.equal(audioResult.handled, false, 'audio placeholder is not handled');

      assert.equal(fetchCalls, 0, 'no network calls for unhandled intents');
      pass('unhandled intents return handled:false with zero network calls');
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  // ── 7. normalizeModelId strips provider/vendor prefixes ──────────────────
  {
    assert.equal(normalizeModelId('openrouter/anthropic/claude-sonnet-4-6'), 'claude-sonnet-4-6');
    assert.equal(normalizeModelId('anthropic/claude-sonnet-4-6'), 'claude-sonnet-4-6');
    assert.equal(normalizeModelId('google_ai/gemini-2.5-pro'), 'gemini-2.5-pro');
    assert.equal(normalizeModelId('deepseek/deepseek-v3.2'), 'deepseek-v3.2');
    assert.equal(normalizeModelId('groq/llama-4-scout'), 'llama-4-scout');
    assert.equal(normalizeModelId('openrouter/meta-llama/llama-3.3-70b-instruct'), 'llama-3.3-70b-instruct');
    // Unknown heads (HF orgs) are preserved so models never collapse.
    assert.equal(
      normalizeModelId('huggingface_endpoint/cswan801/BlackSwan-v5'),
      'cswan801/blackswan-v5',
    );
    assert.equal(normalizeModelId('  claude-sonnet-4-6  '), 'claude-sonnet-4-6');
    assert.equal(normalizeModelId(''), '');
    pass('normalizeModelId strips routing prefixes and preserves unknown org heads');
  }

  // ── 8. hugging_face / z_ai alias spellings normalize identically ─────────
  {
    assert.equal(
      normalizeModelId('hugging_face/meta-llama/Llama-3.3-70B-Instruct'),
      normalizeModelId('huggingface/meta-llama/Llama-3.3-70B-Instruct'),
    );
    assert.equal(
      normalizeModelId('z_ai/glm-4.7'),
      normalizeModelId('zai/glm-4.7'),
    );
    assert.equal(normalizeModelId('z_ai/glm-4.7'), 'glm-4.7');
    pass('hugging_face->huggingface and z_ai->zai alias heads agree');
  }

  // ── 9. Unknown model id -> conservative fail-closed flags ────────────────
  {
    const unknown = getModelCapabilityFlags('totally-unknown-model-xyz');
    assert.deepEqual(unknown, {
      toolUse: false,
      computerUse: false,
      vision: false,
      streaming: true,
      imageOnly: false,
      maxOutputTokens: null,
      codingTier: 'none',
    });
    assert.deepEqual(getModelCapabilityFlags(''), unknown);
    // P8: BlackSwan is now a REGISTERED row (deliberate fail-closed tools +
    // non-streaming), no longer the accidental unknown default.
    assert.deepEqual(
      getModelCapabilityFlags('cswan801/BlackSwan-v5'),
      { ...unknown, streaming: false },
      'BlackSwan registered: fail-closed on tools, buffered (non-streaming)',
    );
    assert.deepEqual(
      getModelCapabilityFlags('huggingface_endpoint/cswan801/BlackSwan-v5'),
      { ...unknown, streaming: false },
      'endpoint-prefixed BlackSwan normalizes to the same registered row',
    );
    assert.deepEqual({ ...UNKNOWN_MODEL_CAPABILITY_FLAGS }, unknown);
    pass('unknown ids fail closed (toolUse/computerUse/vision all false)');
  }

  // ── 10. Image-generation models: imageOnly + no tool loop ────────────────
  {
    for (const id of ['gpt-image-2', 'flux-schnell', 'flux-dev', 'stable-diffusion-xl']) {
      const f = getModelCapabilityFlags(id);
      assert.equal(f.imageOnly, true, `${id} is imageOnly`);
      assert.equal(f.toolUse, false, `${id} has no tool use`);
      assert.equal(f.computerUse, false, `${id} has no computer use`);
    }
    // Family fallback catches provider-prefixed / vendor-native spellings.
    const prefixed = getModelCapabilityFlags('huggingface/black-forest-labs/FLUX.1-schnell');
    assert.equal(prefixed.imageOnly, true);
    assert.equal(prefixed.toolUse, false);
    assert.deepEqual(getModelCapabilities('gpt-image-2'), ['image_gen']);
    assert.equal(getModelCapabilities('gpt-4o').includes('image_gen'), false, 'plain GPT chat does not claim direct image output');
    assert.equal(getModelCapabilities('gemini-2.5-flash-preview').includes('image_gen'), false, 'plain Gemini chat does not claim direct image output');
    pass('exact image generators are imageOnly; plain text models invoke the separate tool');
  }

  // ── 11. computerUse only for Sonnet-capable Claude; tool chat models ─────
  {
    const sonnet = getModelCapabilityFlags('claude-sonnet-4-6');
    assert.equal(sonnet.computerUse, true, 'sonnet drives the native computer-use loop');
    assert.equal(sonnet.toolUse, true);
    assert.equal(sonnet.vision, true);
    assert.equal(sonnet.imageOnly, false);

    // Same answer through a provider-prefixed id.
    const prefixedSonnet = getModelCapabilityFlags('openrouter/anthropic/claude-sonnet-4-6');
    assert.deepEqual(prefixedSonnet, sonnet);

    // Non-sonnet Claude tiers tool but do not computer-use.
    for (const id of ['claude-fable-5', 'claude-opus-4-8', 'claude-haiku-4-5']) {
      const f = getModelCapabilityFlags(id);
      assert.equal(f.toolUse, true, `${id} tools`);
      assert.equal(f.computerUse, false, `${id} must not enter the computer-use loop`);
    }

    // Frontier non-Anthropic chat models tool but never computer-use.
    for (const id of ['gpt-5.5', 'google_ai/gemini-2.5-pro', 'deepseek/deepseek-v3.2', 'mistral-large-3', 'groq/llama-4-scout']) {
      const f = getModelCapabilityFlags(id);
      assert.equal(f.toolUse, true, `${id} tools`);
      assert.equal(f.computerUse, false, `${id} never computer-uses`);
      assert.equal(f.imageOnly, false);
    }
    pass('computerUse:true only for Sonnet-capable Claude; frontier chat models tool');
  }

  // ── 12. Prefixed ids resolve through the legacy capability registry ──────
  {
    assert.deepEqual(getModelCapabilities('openrouter/flux-schnell'), ['image_gen']);
    assert.ok(
      getModelCapabilities('anthropic/claude-sonnet-4-6').includes('code'),
      'prefixed claude id resolves to its registry entry',
    );
    // Returned flags are fresh objects — mutating one must not poison the registry.
    const a = getModelCapabilityFlags('claude-sonnet-4-6');
    a.computerUse = false;
    assert.equal(getModelCapabilityFlags('claude-sonnet-4-6').computerUse, true);
    pass('prefixed registry lookups work and flag objects are mutation-safe');
  }

  // ── 13. Coding tier (P5): strong/basic/none routing signal ───────────────
  {
    const { getModelCodingTier } = await import('../src/lib/modelCapabilities');
    // Frontier coders are 'strong' — planner-eligible.
    for (const id of ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-fable-5', 'gpt-5.5', 'gemini-2.5-pro', 'deepseek-v3.2', 'qwen-3.5-coder', 'codex-mini']) {
      assert.equal(getModelCodingTier(id), 'strong', `${id} is a strong coder`);
    }
    // Fast executors / general chat models are 'basic'.
    for (const id of ['claude-haiku-4-5', 'gpt-5.4-mini', 'gemini-2.5-flash', 'mistral-large-3', 'qwen-3.5-flash']) {
      assert.equal(getModelCodingTier(id), 'basic', `${id} is a basic coder`);
    }
    // deepseek-r1: strong PLANNER but toolUse stays false — never an executor.
    const r1 = getModelCapabilityFlags('deepseek-r1');
    assert.equal(r1.codingTier, 'strong');
    assert.equal(r1.toolUse, false, 'r1 plans but must not drive a tool loop');
    // Image-only, sonar, BlackSwan, and unknown ids are 'none' (fail closed).
    for (const id of ['flux-schnell', 'sonar-pro', 'cswan801/BlackSwan-v5', 'totally-unknown-model-xyz']) {
      assert.equal(getModelCodingTier(id), 'none', `${id} never routes coding`);
    }
    // Family fallbacks: dated haiku snapshots basic; prefixed sonnet strong.
    assert.equal(getModelCodingTier('claude-haiku-4-5-20251001'), 'basic');
    assert.equal(getModelCodingTier('openrouter/anthropic/claude-sonnet-4-6'), 'strong');
    pass('codingTier: strong for frontier coders, basic for fast executors, none fail-closed');
  }

  console.log(`All model-capabilities smoke cases passed (${passCount} PASS).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
