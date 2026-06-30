/**
 * Smoke test for hostedBlackSwanInvocation — the Phase-4 invocation route for
 * the app-trained BlackSwan model.
 *
 * Pure: imports only `hostedBlackSwanInvocation` (whose sole value dep is the
 * pure `blackswanRouting`), so tsx/esbuild can load it without react-native.
 *
 * Run: npx tsx scripts/hosted-blackswan-invocation-smoketest.ts
 */

import {
  HF_BLACKSWAN_ENDPOINT_ENV_VAR,
  BLACKSWAN_TOOL_EXECUTOR_MODEL,
  HOSTED_BLACKSWAN_ENDPOINT_MODEL_ID,
  HOSTED_BLACKSWAN_PUBLIC_MODEL_ID,
  resolveBlackSwanInvocation,
  isDedicatedEndpointRoute,
  isBlackSwanChannel,
  type BlackSwanChannel,
} from '../src/lib/hostedBlackSwanInvocation';

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

// A "real claude id" looks like claude-<family>-<...>. The canonical executor
// is claude-haiku-4-5 (BLACKSWAN_TOOL_EXECUTOR_MODEL_ID in blackswanRouting).
const CLAUDE_ID_RE = /^claude-[a-z]+-\d/i;

// ── Constants / wiring sanity ─────────────────────────────────────────────────
console.log('constants');
assert('endpoint env var is HF_BLACKSWAN_ENDPOINT', HF_BLACKSWAN_ENDPOINT_ENV_VAR === 'HF_BLACKSWAN_ENDPOINT');
assert('tool executor is a real claude id', CLAUDE_ID_RE.test(BLACKSWAN_TOOL_EXECUTOR_MODEL));
assert('tool executor is claude-haiku-4-5', BLACKSWAN_TOOL_EXECUTOR_MODEL === 'claude-haiku-4-5');
assert('exported endpoint model id is the hf_endpoint id', HOSTED_BLACKSWAN_ENDPOINT_MODEL_ID === 'huggingface_endpoint/cswan801/BlackSwan-v5');
assert('exported public model id is the hf public id', HOSTED_BLACKSWAN_PUBLIC_MODEL_ID === 'huggingface/cswan801/BlackSwan-v5');

// ── hf_endpoint: the production app-trained route ─────────────────────────────
console.log('hf_endpoint channel');
{
  const r = resolveBlackSwanInvocation(HOSTED_BLACKSWAN_ENDPOINT_MODEL_ID);
  assert('endpoint id → hf_endpoint', r.channel === 'hf_endpoint');
  assert('hf_endpoint carries the endpoint env var', r.endpointEnvVar === 'HF_BLACKSWAN_ENDPOINT');
  assert('hf_endpoint requires grounding', r.requiresGrounding === true);
  assert('hf_endpoint tool executor is a real claude id', CLAUDE_ID_RE.test(r.toolExecutorModel));
  assert('hf_endpoint reason mentions the env var', r.reason.includes('HF_BLACKSWAN_ENDPOINT'));
  assert('hf_endpoint modelId is trimmed input', r.modelId === HOSTED_BLACKSWAN_ENDPOINT_MODEL_ID);
  assert('isDedicatedEndpointRoute true for hf_endpoint', isDedicatedEndpointRoute(r) === true);

  // Any other huggingface_endpoint/...blackswan... id also resolves to endpoint.
  const variant = resolveBlackSwanInvocation('huggingface_endpoint/cswan801/blackswan-v6');
  assert('endpoint variant id → hf_endpoint', variant.channel === 'hf_endpoint');
  assert('endpoint variant carries env var', variant.endpointEnvVar === 'HF_BLACKSWAN_ENDPOINT');

  // Case-insensitive on the canonical id.
  const upper = resolveBlackSwanInvocation('HUGGINGFACE_ENDPOINT/cswan801/BlackSwan-v5');
  assert('endpoint id is case-insensitive', upper.channel === 'hf_endpoint');

  // Leading/trailing whitespace is trimmed before classification.
  const padded = resolveBlackSwanInvocation('  huggingface_endpoint/cswan801/BlackSwan-v5  ');
  assert('endpoint id trims whitespace → hf_endpoint', padded.channel === 'hf_endpoint');
  assert('padded modelId is trimmed', padded.modelId === HOSTED_BLACKSWAN_ENDPOINT_MODEL_ID);
}

// ── hf_public: the shared HF router route ─────────────────────────────────────
console.log('hf_public channel');
{
  const r = resolveBlackSwanInvocation(HOSTED_BLACKSWAN_PUBLIC_MODEL_ID);
  assert('public id → hf_public', r.channel === 'hf_public');
  assert('hf_public has NO endpoint env var', r.endpointEnvVar === null);
  assert('hf_public requires grounding', r.requiresGrounding === true);
  assert('hf_public tool executor is a real claude id', CLAUDE_ID_RE.test(r.toolExecutorModel));
  assert('isDedicatedEndpointRoute false for hf_public', isDedicatedEndpointRoute(r) === false);

  // Bare repo id (no provider prefix) is hosted-public, not the dedicated endpoint.
  const bare = resolveBlackSwanInvocation('cswan801/BlackSwan-v5');
  assert('bare repo id → hf_public', bare.channel === 'hf_public');
  assert('bare repo id has no endpoint env var', bare.endpointEnvVar === null);

  // Any other huggingface/...blackswan... id resolves to public.
  const variant = resolveBlackSwanInvocation('huggingface/cswan801/blackswan-mini');
  assert('public variant id → hf_public', variant.channel === 'hf_public');
}

// ── local_ollama: on-device bridge weight ─────────────────────────────────────
console.log('local_ollama channel');
{
  for (const id of ['blackswan', 'ollama/blackswan']) {
    const r = resolveBlackSwanInvocation(id);
    assert(`${id} → local_ollama`, r.channel === 'local_ollama');
    assert(`${id} has NO endpoint env var`, r.endpointEnvVar === null);
    assert(`${id} requires grounding`, r.requiresGrounding === true);
    assert(`${id} tool executor is a real claude id`, CLAUDE_ID_RE.test(r.toolExecutorModel));
    assert(`isDedicatedEndpointRoute false for ${id}`, isDedicatedEndpointRoute(r) === false);
  }
}

// ── unsupported: everything non-BlackSwan fails closed ────────────────────────
console.log('unsupported channel');
{
  const nonBlackSwan = [
    'claude-sonnet-4-6',
    'claude-opus-4-8',
    'gpt-5.5',
    'openrouter/auto',
    'google_ai/gemini-2.5-pro',
    'huggingface/Qwen/Qwen3-32B', // HF but not BlackSwan
    'huggingface_endpoint/someone/other-model', // dedicated endpoint but not BlackSwan
    'ollama/llama3', // local ollama but not blackswan
    'auto',
    '',
    '   ',
  ];
  for (const id of nonBlackSwan) {
    const r = resolveBlackSwanInvocation(id);
    assert(`${JSON.stringify(id)} → unsupported`, r.channel === 'unsupported');
    assert(`${JSON.stringify(id)} has no endpoint env var`, r.endpointEnvVar === null);
    assert(`${JSON.stringify(id)} does NOT require grounding`, r.requiresGrounding === false);
    // Even unsupported still reports a real executor (callers may still need one).
    assert(`${JSON.stringify(id)} still names a real claude executor`, CLAUDE_ID_RE.test(r.toolExecutorModel));
    assert(`isBlackSwanChannel false for ${JSON.stringify(id)}`, isBlackSwanChannel(r.channel) === false);
  }
}

// ── invariant: ONLY hf_endpoint ever carries an endpoint env var ──────────────
console.log('endpoint-env-var invariant');
{
  const cases: Array<{ id: string; channel: BlackSwanChannel }> = [
    { id: 'huggingface_endpoint/cswan801/BlackSwan-v5', channel: 'hf_endpoint' },
    { id: 'huggingface/cswan801/BlackSwan-v5', channel: 'hf_public' },
    { id: 'blackswan', channel: 'local_ollama' },
    { id: 'claude-sonnet-4-6', channel: 'unsupported' },
  ];
  for (const c of cases) {
    const r = resolveBlackSwanInvocation(c.id);
    assert(`${c.id} resolves to expected channel ${c.channel}`, r.channel === c.channel);
    const hasEnvVar = r.endpointEnvVar !== null;
    assert(
      `${c.id}: endpoint env var present iff hf_endpoint`,
      hasEnvVar === (c.channel === 'hf_endpoint'),
    );
    // grounding present iff it's a real BlackSwan channel
    assert(
      `${c.id}: requiresGrounding iff real BlackSwan channel`,
      r.requiresGrounding === isBlackSwanChannel(c.channel),
    );
  }
}

// ── isBlackSwanChannel helper ─────────────────────────────────────────────────
console.log('isBlackSwanChannel helper');
{
  assert('hf_endpoint is a BlackSwan channel', isBlackSwanChannel('hf_endpoint') === true);
  assert('hf_public is a BlackSwan channel', isBlackSwanChannel('hf_public') === true);
  assert('local_ollama is a BlackSwan channel', isBlackSwanChannel('local_ollama') === true);
  assert('unsupported is NOT a BlackSwan channel', isBlackSwanChannel('unsupported') === false);
}

console.log('');
if (failures === 0) {
  console.log('hosted-blackswan-invocation smoke: ALL PASS');
  process.exit(0);
} else {
  console.error(`hosted-blackswan-invocation smoke: ${failures} FAILURE(S)`);
  process.exit(1);
}
