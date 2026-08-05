/**
 * integration-health-registry-smoketest — fail-visible per-session integration
 * health (src/lib/integrationHealthRegistry.ts). Records custom_api /
 * messaging outcomes and surfaces a WARN-only "last call failed" hint that a
 * later integrations.list flags next to a connected-but-failing integration.
 *
 * Deterministic: every time-aware call takes an injected nowMs. Pure — tsx-safe.
 */

import {
  recordIntegrationOutcome,
  getIntegrationHealth,
  describeIntegrationHealth,
  getIntegrationHealthHint,
  resetIntegrationHealth,
  HEALTH_STALENESS_MS,
  MAX_EVENTS_PER_INTEGRATION,
  MAX_INTEGRATIONS,
} from '../src/lib/integrationHealthRegistry';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEqual(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const T0 = 1_000_000; // fixed base clock

function main(): void {
  // ─── (1) empty state ──────────────────────────────────────────────────────
  resetIntegrationHealth();
  assertEqual(getIntegrationHealth('int_x'), null, '(1) no record → null health');
  assertEqual(getIntegrationHealthHint('int_x', T0), null, '(1) no record → null hint');

  // ─── (2) a success is silent (no noise) ───────────────────────────────────
  resetIntegrationHealth();
  recordIntegrationOutcome('int_gh', { verdict: 'success', status: 201 }, T0);
  const okHealth = getIntegrationHealth('int_gh');
  assert(okHealth && !okHealth.failing, '(2) success → not failing');
  assertEqual(getIntegrationHealthHint('int_gh', T0 + 1000), null, '(2) success → no hint');

  // ─── (3) a failure warns ──────────────────────────────────────────────────
  resetIntegrationHealth();
  recordIntegrationOutcome('int_gh', { verdict: 'client_error', status: 404 }, T0);
  const badHealth = getIntegrationHealth('int_gh');
  assert(badHealth?.failing === true, '(3) client_error → failing');
  const hint3 = getIntegrationHealthHint('int_gh', T0 + 1000);
  assert(!!hint3 && /⚠️ last call failed \(HTTP 404\)/.test(hint3), '(3) hint names the status', hint3 || 'null');

  // ─── (4) consecutive failures counted ─────────────────────────────────────
  resetIntegrationHealth();
  recordIntegrationOutcome('int_a', { verdict: 'server_error', status: 500 }, T0);
  recordIntegrationOutcome('int_a', { verdict: 'server_error', status: 503 }, T0 + 10);
  recordIntegrationOutcome('int_a', { verdict: 'client_error', status: 429 }, T0 + 20);
  const streak = getIntegrationHealth('int_a');
  assertEqual(streak?.consecutiveFailures, 3, '(4) three trailing failures counted');
  const hint4 = getIntegrationHealthHint('int_a', T0 + 30);
  assert(!!hint4 && /3 in a row/.test(hint4), '(4) hint shows the streak', hint4 || 'null');

  // ─── (5) a later success clears the streak ─────────────────────────────────
  recordIntegrationOutcome('int_a', { verdict: 'success', status: 200 }, T0 + 40);
  const cleared = getIntegrationHealth('int_a');
  assert(cleared && !cleared.failing, '(5) success after failures → not failing');
  assertEqual(cleared?.consecutiveFailures, 0, '(5) streak reset to 0');
  assertEqual(getIntegrationHealthHint('int_a', T0 + 50), null, '(5) no hint after recovery');

  // ─── (6) staleness — an old failure is not surfaced as "current" ──────────
  resetIntegrationHealth();
  recordIntegrationOutcome('int_stale', { verdict: 'server_error', status: 500 }, T0);
  assert(!!getIntegrationHealthHint('int_stale', T0 + 1000), '(6) fresh failure warns');
  assertEqual(getIntegrationHealthHint('int_stale', T0 + HEALTH_STALENESS_MS + 1), null, '(6) stale failure is not surfaced');

  // ─── (7) unknown verdict is neutral ────────────────────────────────────────
  resetIntegrationHealth();
  recordIntegrationOutcome('int_u', { verdict: 'client_error', status: 400 }, T0);
  recordIntegrationOutcome('int_u', { verdict: 'unknown', status: null }, T0 + 10);
  const neutral = getIntegrationHealth('int_u');
  assert(neutral && !neutral.failing, '(7) trailing unknown → not failing (neutral)');
  assertEqual(getIntegrationHealthHint('int_u', T0 + 20), null, '(7) neutral latest → no hint');

  // ─── (8) blocked verdict warns, status-less hint ──────────────────────────
  resetIntegrationHealth();
  recordIntegrationOutcome('int_b', { verdict: 'blocked', status: null }, T0);
  const blockedHint = getIntegrationHealthHint('int_b', T0 + 5);
  assert(!!blockedHint && /⚠️ last call failed/.test(blockedHint) && !/HTTP/.test(blockedHint), '(8) blocked → hint without HTTP', blockedHint || 'null');

  // ─── (9) ring + registry bounds ────────────────────────────────────────────
  resetIntegrationHealth();
  for (let i = 0; i < MAX_EVENTS_PER_INTEGRATION + 6; i += 1) {
    recordIntegrationOutcome('int_ring', { verdict: 'success', status: 200 }, T0 + i);
  }
  // last is success → not failing; ring stayed bounded (no throw, correct verdict)
  assert(getIntegrationHealth('int_ring')?.failing === false, '(9) ring bounded, latest wins');
  resetIntegrationHealth();
  for (let i = 0; i < MAX_INTEGRATIONS + 20; i += 1) {
    recordIntegrationOutcome(`int_${i}`, { verdict: 'success', status: 200 }, T0 + i);
  }
  // newest survive; a very old key should have been evicted
  assert(getIntegrationHealth('int_0') === null, '(9) oldest integration evicted at cap');
  assert(getIntegrationHealth(`int_${MAX_INTEGRATIONS + 19}`) !== null, '(9) newest integration retained');

  // ─── (10) describeIntegrationHealth direct + degenerate ────────────────────
  assertEqual(describeIntegrationHealth(null, T0), null, '(10) null health → null');
  try {
    recordIntegrationOutcome('', { verdict: 'success' } as any, T0);
    recordIntegrationOutcome('int_z', null as any, T0);
    getIntegrationHealthHint('', T0);
    getIntegrationHealth(undefined as any);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll integration-health-registry smoke cases passed (${passes} passed).`);
}

main();
