/**
 * blackswan-failover-smoketest — pure tests for the FAIL-VISIBLE BlackSwan
 * endpoint failover planner (`planBlackSwanEndpointFailover` in
 * `src/lib/blackswanRouting.ts`).
 *
 * The BlackSwan HF endpoint scales to zero when idle: the first request after
 * idle wakes it but fails while it warms (~1-2 min), and swanbot-ai fails
 * CLOSED (`marketplace_provider_unavailable` / `routing_fallback`) instead of
 * silently spending Anthropic. The planner turns that outcome into ONE visible
 * failover onto the advertised chain (`getModelFailoverChain`) with a friendly
 * user notice — never silent, never twice, never echoing raw provider errors
 * (which can embed tokens).
 *
 * The failover CHAIN is a parameter (serviceProfileSouls imports
 * blackswanRouting's constants, so the planner can't import it back without a
 * cycle); the integration case below feeds the REAL chain to pin the wiring.
 *
 * Run: npm run smoke:blackswan-failover
 */

import {
  BLACKSWAN_ENDPOINT_MODEL_ID,
  BLACKSWAN_MODEL_ID,
  BLACKSWAN_PUBLIC_MODEL_ID,
  planBlackSwanEndpointFailover,
} from '../src/lib/blackswanRouting';
import { getModelFailoverChain } from '../src/lib/serviceProfileSouls';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

const CHAIN = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];

// ─── (a) endpoint model + marketplace_provider_unavailable → failover ───────
{
  const plan = planBlackSwanEndpointFailover(
    {
      model: BLACKSWAN_ENDPOINT_MODEL_ID,
      errorCode: 'marketplace_provider_unavailable',
      errorMessage:
        'Selected marketplace model could not be routed through hugging_face: endpoint returned 503 while starting. I did not fall back to Anthropic.',
    },
    CHAIN,
  );
  assert(plan.failover === true, '(a) endpoint + marketplace_provider_unavailable → failover');
  if (plan.failover) {
    assert(plan.fallbackModel === CHAIN[0], '(a) fallback is the FIRST chain entry', plan.fallbackModel);
    assert(/waking|idle/i.test(plan.userNotice), '(a) notice mentions waking/idle', plan.userNotice);
    assert(/blackswan/i.test(plan.userNotice), '(a) notice names BlackSwan');
    assert(
      plan.routingNote.failover_from === BLACKSWAN_ENDPOINT_MODEL_ID
        && plan.routingNote.fallback_model === CHAIN[0]
        && plan.routingNote.reason.length > 0,
      '(a) routingNote populated (failover_from / fallback_model / reason)',
      JSON.stringify(plan.routingNote),
    );
    assert(plan.userNotice.length <= 300, '(a) notice is bounded (one friendly line)');
  }
}

// ─── (b) config problem → Marketplace/connect notice, not "waking" ──────────
{
  const plan = planBlackSwanEndpointFailover(
    {
      model: BLACKSWAN_ENDPOINT_MODEL_ID,
      errorCode: 'marketplace_provider_unavailable',
      errorMessage:
        'Selected marketplace model could not be routed through blackswan: Endpoint URL not set on the BlackSwan integration. Connect or update that provider in Marketplace, then retry.',
    },
    CHAIN,
  );
  assert(plan.failover === true, '(b) config-problem message still fails over');
  if (plan.failover) {
    assert(/marketplace/i.test(plan.userNotice), '(b) notice mentions Marketplace', plan.userNotice);
    assert(/connect/i.test(plan.userNotice), '(b) notice says to connect/fix it');
    assert(!/waking/i.test(plan.userNotice), "(b) config notice does NOT say 'waking'");
    assert(plan.routingNote.reason === 'blackswan_endpoint_not_configured', '(b) reason slug is the config flavor', plan.routingNote.reason);
  }
}

// (b2) relay shape: routing_fallback.provider === 'blackswan', no code.
{
  const plan = planBlackSwanEndpointFailover(
    {
      model: BLACKSWAN_ENDPOINT_MODEL_ID,
      routingFallbackProvider: 'blackswan',
      errorMessage: 'Endpoint URL not set on the BlackSwan integration',
    },
    CHAIN,
  );
  assert(
    plan.failover === true && plan.routingNote.reason === 'blackswan_endpoint_not_configured',
    "(b2) relay routing_fallback provider 'blackswan' (no code) → config failover",
  );
}

// (a2) the other two BlackSwan ids also qualify (public + bare repo id).
{
  const publicPlan = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_PUBLIC_MODEL_ID, errorCode: 'marketplace_provider_unavailable' },
    CHAIN,
  );
  const barePlan = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_MODEL_ID, errorCode: 'marketplace_provider_unavailable' },
    CHAIN,
  );
  assert(publicPlan.failover === true, '(a2) public id qualifies');
  assert(barePlan.failover === true, '(a2) bare repo id qualifies');
}

// ─── (c) non-BlackSwan model + same error → no failover ─────────────────────
{
  const plan = planBlackSwanEndpointFailover(
    {
      model: 'openrouter/auto',
      errorCode: 'marketplace_provider_unavailable',
      errorMessage: 'Selected marketplace model could not be routed through openrouter: integration_not_connected',
    },
    ['claude-haiku-4-5-20251001'],
  );
  assert(plan.failover === false, '(c) non-BlackSwan model never fails over here');
}

// ─── (d) alreadyFailedOver → no failover (never chain twice) ────────────────
{
  const plan = planBlackSwanEndpointFailover(
    {
      model: BLACKSWAN_ENDPOINT_MODEL_ID,
      errorCode: 'marketplace_provider_unavailable',
      alreadyFailedOver: true,
    },
    CHAIN,
  );
  assert(plan.failover === false, '(d) alreadyFailedOver blocks a second hop');
}

// ─── (e) BlackSwan + unrelated error → no failover ──────────────────────────
{
  const plan = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_ENDPOINT_MODEL_ID, errorMessage: 'rate limit exceeded' },
    CHAIN,
  );
  assert(plan.failover === false, "(e) unrelated 'rate limit exceeded' fails closed (no failover)");
}

// (e2) no evidence at all → no failover.
{
  const plan = planBlackSwanEndpointFailover({ model: BLACKSWAN_ENDPOINT_MODEL_ID }, CHAIN);
  assert(plan.failover === false, '(e2) BlackSwan model with no error evidence fails closed');
}

// ─── (f) empty chain → fail closed ──────────────────────────────────────────
{
  const empty = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_ENDPOINT_MODEL_ID, errorCode: 'marketplace_provider_unavailable' },
    [],
  );
  const blank = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_ENDPOINT_MODEL_ID, errorCode: 'marketplace_provider_unavailable' },
    ['', '  '],
  );
  assert(empty.failover === false, '(f) empty chain → no failover');
  assert(blank.failover === false, '(f) whitespace-only chain entries → no failover');
}

// ─── (g) secrets in errorMessage are never echoed ───────────────────────────
{
  const plan = planBlackSwanEndpointFailover(
    {
      model: BLACKSWAN_ENDPOINT_MODEL_ID,
      errorCode: 'marketplace_provider_unavailable',
      errorMessage:
        'could not be routed through blackswan: unavailable — auth sk-ant-FAKE12345 hf_FAKETOKEN678 bearer eyJhbGciOiJIUzI1NiJ9.fake',
    },
    CHAIN,
  );
  assert(plan.failover === true, '(g) token-bearing unavailability message still plans failover');
  if (plan.failover) {
    const surfaced = `${plan.userNotice} ${JSON.stringify(plan.routingNote)}`;
    assert(!surfaced.includes('sk-'), '(g) notice/routingNote never echo sk- tokens', surfaced);
    assert(!surfaced.includes('hf_'), '(g) notice/routingNote never echo hf_ tokens');
    assert(!surfaced.includes('eyJ'), '(g) notice/routingNote never echo eyJ (JWT) tokens');
  }
}

// ─── Integration: the REAL advertised chain wires through ───────────────────
{
  const realChain = getModelFailoverChain(BLACKSWAN_ENDPOINT_MODEL_ID);
  assert(realChain.length > 0, 'integration: getModelFailoverChain has entries for the endpoint id');
  const plan = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_ENDPOINT_MODEL_ID, errorCode: 'marketplace_provider_unavailable' },
    realChain,
  );
  assert(
    plan.failover === true && plan.fallbackModel === realChain[0],
    'integration: real chain → failover onto its first entry',
    plan.failover ? plan.fallbackModel : 'no failover',
  );
  const publicChain = getModelFailoverChain(BLACKSWAN_PUBLIC_MODEL_ID);
  const publicPlan = planBlackSwanEndpointFailover(
    { model: BLACKSWAN_PUBLIC_MODEL_ID, errorCode: 'marketplace_provider_unavailable' },
    publicChain,
  );
  assert(
    publicPlan.failover === true && publicPlan.fallbackModel === publicChain[0],
    'integration: public id real chain → failover onto its first entry',
  );
}

if (failures > 0) {
  console.error(`\n${failures} blackswan-failover smoke failure(s)`);
  process.exit(1);
}
console.log('\nAll blackswan-failover smoke cases passed.');
