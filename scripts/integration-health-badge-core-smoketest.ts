/**
 * integration-health-badge-core smoke.
 *
 * Pins the pure health-badge policy that surfaces the silent-bad-key trust
 * bug in Marketplace: tone/label mapping for status combos, secret-safety
 * (token-like text must never reach a label/detail), boundedness, totality,
 * the fold of integrationHealthRegistry's hint shape, and the save-path
 * helper `buildIntegrationSaveHealthState` that connectGenericCircleIntegration
 * uses so a SUCCESSFUL re-save explicitly clears a stale
 * `metadata.last_validation_error` (the upsert merges metadata — omission
 * would preserve the stale error forever).
 */

import {
  buildIntegrationHealthBadge,
  buildIntegrationSaveHealthState,
  sanitizeIntegrationHealthText,
  HEALTH_DETAIL_MAX_CHARS,
  HEALTH_LABEL_MAX_CHARS,
  HEALTH_STORED_ERROR_MAX_CHARS,
  type IntegrationHealthBadge,
} from '../src/lib/integrationHealthBadgeCore';
import {
  recordIntegrationOutcome,
  getIntegrationHealthHint,
  resetIntegrationHealth,
} from '../src/lib/integrationHealthRegistry';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

function wellFormed(b: IntegrationHealthBadge, label: string) {
  assert(b.tone === 'ok' || b.tone === 'warn' || b.tone === 'danger', `${label}: tone in set (got ${String(b.tone)})`);
  assert(typeof b.label === 'string' && b.label.length > 0 && b.label.length <= HEALTH_LABEL_MAX_CHARS, `${label}: label non-empty ≤ ${HEALTH_LABEL_MAX_CHARS}`);
  assert(b.detail === null || (typeof b.detail === 'string' && b.detail.length <= HEALTH_DETAIL_MAX_CHARS), `${label}: detail null or ≤ ${HEALTH_DETAIL_MAX_CHARS}`);
  assert(typeof b.showRetest === 'boolean', `${label}: showRetest boolean`);
}

function main() {
  // ─── Status-combo tone/label mapping ─────────────────────────────
  {
    const okBadge = buildIntegrationHealthBadge({ status: 'connected' });
    assert(okBadge.tone === 'ok', 'connected + no error → tone ok');
    assert(okBadge.label === 'Connected', 'connected + no error → label Connected');
    assert(okBadge.showRetest === false, 'connected + no error → no retest');
    wellFormed(okBadge, 'connected');

    const rejected = buildIntegrationHealthBadge({
      status: 'degraded',
      lastValidationError: 'OpenRouter rejected the key (401/403)',
    });
    assert(rejected.tone === 'danger', 'degraded + 401 → tone danger');
    assert(rejected.label === 'Key rejected (401)', 'degraded + 401 → label Key rejected (401)');
    assert(!!rejected.detail && rejected.detail.includes('Re-paste the key'), 'degraded + 401 → detail suggests re-paste/dashboard');
    assert(rejected.showRetest === true, 'degraded + 401 → retest offered');
    wellFormed(rejected, 'degraded+401');

    const forbidden = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: 'HTTP 403 Forbidden' });
    assert(forbidden.tone === 'danger' && forbidden.label === 'Key rejected (403)', 'degraded + 403 → danger Key rejected (403)');
    wellFormed(forbidden, 'degraded+403');

    const timedOut = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: 'Request timed out after 10000ms' });
    assert(timedOut.tone === 'warn', 'degraded + timeout → tone warn');
    assert(timedOut.label === 'Degraded', 'degraded + timeout → label Degraded');
    assert(timedOut.showRetest === true, 'degraded + timeout → retest offered');
    wellFormed(timedOut, 'degraded+timeout');

    const netFail = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: 'probe network error' });
    assert(netFail.tone === 'warn' && netFail.label === 'Degraded', 'degraded + network error → warn Degraded');
    wellFormed(netFail, 'degraded+network');

    const rateLimited = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: '429 Too Many Requests' });
    assert(rateLimited.tone === 'warn' && rateLimited.label === 'Rate limited (429)', 'degraded + 429 → warn Rate limited (429)');
    assert(rateLimited.showRetest === true, 'degraded + 429 → retest offered');
    wellFormed(rateLimited, 'degraded+429');

    const missing = buildIntegrationHealthBadge({});
    assert(missing.label === 'Not connected', 'missing status → Not connected');
    assert(missing.showRetest === false, 'missing status → no retest');
    wellFormed(missing, 'missing status');

    const disabled = buildIntegrationHealthBadge({ status: 'disabled' });
    assert(disabled.label === 'Not connected', 'disabled status → Not connected');
    const planned = buildIntegrationHealthBadge({ status: 'planned' });
    assert(planned.label === 'Not connected', 'planned status → Not connected');

    // A degraded custom_api row with a non-key message keeps the message.
    const setup = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: 'Missing metadata: base_url' });
    assert(setup.tone === 'warn' && setup.label === 'Degraded', 'degraded + missing-metadata → warn Degraded');
    assert(!!setup.detail && setup.detail.includes('Missing metadata'), 'degraded + missing-metadata → detail carries the message');
    wellFormed(setup, 'degraded+setup');

    // Degraded status with NO stored message still warns (never green).
    const bare = buildIntegrationHealthBadge({ status: 'degraded' });
    assert(bare.tone === 'warn' && bare.label === 'Degraded' && bare.showRetest === true, 'degraded + no message → warn Degraded + retest');

    // An error stored on a nominally connected row still degrades the badge.
    const errOnConnected = buildIntegrationHealthBadge({ status: 'connected', lastValidationError: 'Brave Search probe 500' });
    assert(errOnConnected.tone !== 'ok', 'connected + stored error → not green');
    wellFormed(errOnConnected, 'connected+error');
  }

  // ─── validationOk override semantics ─────────────────────────────
  {
    const freshPass = buildIntegrationHealthBadge({
      status: 'degraded',
      lastValidationError: 'OpenRouter rejected the key (401/403)',
      validationOk: true,
    });
    assert(freshPass.tone === 'ok' && freshPass.label === 'Connected', 'fresh probe success overrides stale degraded+401 → Connected');

    const freshFail = buildIntegrationHealthBadge({ status: 'connected', validationOk: false });
    assert(freshFail.tone === 'warn' && freshFail.label === 'Degraded' && freshFail.showRetest === true, 'validationOk=false on connected → warn Degraded + retest');
  }

  // ─── integrationHealthRegistry hint fold ─────────────────────────
  {
    resetIntegrationHealth();
    recordIntegrationOutcome('int-1', { verdict: 'server_error', status: 500 }, 1_000);
    recordIntegrationOutcome('int-1', { verdict: 'server_error', status: 500 }, 2_000);
    const hint = getIntegrationHealthHint('int-1', 3_000);
    assert(!!hint && hint.includes('HTTP 500'), 'registry hint shape composes (HTTP 500 streak)');

    const hinted = buildIntegrationHealthBadge({ status: 'connected', healthHint: hint });
    assert(hinted.tone === 'warn' && hinted.label === 'Degraded', 'connected + live-failure hint → warn Degraded (fail-visible)');
    assert(!!hinted.detail && hinted.detail.includes('HTTP 500'), 'hint text survives into detail');
    assert(hinted.showRetest === true, 'connected + hint → retest offered');
    wellFormed(hinted, 'connected+hint');

    // Fresh probe pass does NOT silence a live runtime-failure hint.
    const passButFailing = buildIntegrationHealthBadge({ status: 'connected', validationOk: true, healthHint: hint });
    assert(passButFailing.tone === 'warn', 'validationOk=true + live hint → still warn (hint is fail-visible)');

    // Healthy registry state → null hint → green stays green.
    resetIntegrationHealth();
    recordIntegrationOutcome('int-2', { verdict: 'success', status: 200 }, 1_000);
    const noHint = getIntegrationHealthHint('int-2', 2_000);
    assert(noHint === null, 'healthy registry → null hint');
    const clean = buildIntegrationHealthBadge({ status: 'connected', healthHint: noHint });
    assert(clean.tone === 'ok', 'connected + null hint → ok');
    resetIntegrationHealth();
  }

  // ─── Secret safety ───────────────────────────────────────────────
  {
    const leakInputs = [
      'Unauthorized 401 for key sk-abc123',
      'probe failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
      'HF says token hf_ZmFrZXRva2VuZm9ydGVzdA is invalid',
      'api_key=sk-proj-XyZ1234567890abcdef timed out',
      'AKIAIOSFODNN7EXAMPLE was rejected',
      'ghp_1234567890abcdefghij unauthorized',
      'long blob a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6 in error',
    ];
    const secretFragments = [
      'sk-abc123',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'hf_ZmFrZXRva2VuZm9ydGVzdA',
      'sk-proj-XyZ1234567890abcdef',
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_1234567890abcdefghij',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
    ];
    for (let i = 0; i < leakInputs.length; i++) {
      const badge = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: leakInputs[i] });
      const rendered = `${badge.label}|${badge.detail || ''}`;
      assert(!rendered.includes(secretFragments[i]), `secret #${i} ('${secretFragments[i].slice(0, 12)}…') absent from label/detail`);
      wellFormed(badge, `secret-input #${i}`);
    }
    // Also through the hint channel and the sanitize helper directly.
    const hintLeak = buildIntegrationHealthBadge({ status: 'connected', healthHint: 'last call failed with token sk-abc123' });
    assert(!(`${hintLeak.label}|${hintLeak.detail || ''}`).includes('sk-abc123'), 'secret absent when smuggled via healthHint');
    assert(!sanitizeIntegrationHealthText('Bearer sk-verysecretkey1234 broke').includes('sk-verysecretkey1234'), 'sanitize helper strips Bearer value');
    assert(sanitizeIntegrationHealthText('plain human sentence, no tokens.') === 'plain human sentence, no tokens.', 'sanitize keeps ordinary prose intact');
  }

  // ─── Boundedness ─────────────────────────────────────────────────
  {
    const long = buildIntegrationHealthBadge({ status: 'degraded', lastValidationError: 'x '.repeat(500) });
    assert((long.detail || '').length <= HEALTH_DETAIL_MAX_CHARS, `500-word error → detail ≤ ${HEALTH_DETAIL_MAX_CHARS}`);
    assert(long.label.length <= HEALTH_LABEL_MAX_CHARS, 'long error → label bounded');
    const longSan = sanitizeIntegrationHealthText('word '.repeat(200), 80);
    assert(longSan.length <= 80, 'sanitize honors explicit maxChars');
  }

  // ─── Totality ────────────────────────────────────────────────────
  {
    const weird: Array<[string, unknown]> = [
      ['null input', null],
      ['undefined input', undefined],
      ['number status', { status: 42 }],
      ['object error', { status: 'degraded', lastValidationError: { code: 401 } }],
      ['array hint', { status: 'connected', healthHint: ['a', 'b'] }],
      ['boolean everything', { status: true, lastValidationError: false, validationOk: 7 as unknown as boolean, healthHint: NaN }],
      ['nested garbage', { status: { toString: () => { throw new Error('boom'); } } }],
    ];
    for (const [label, input] of weird) {
      let threw = false;
      let badge: IntegrationHealthBadge | null = null;
      try {
        badge = buildIntegrationHealthBadge(input as never);
      } catch {
        threw = true;
      }
      assert(!threw, `total: ${label} does not throw`);
      if (badge) wellFormed(badge, `total: ${label}`);
    }
    assert(sanitizeIntegrationHealthText(Symbol('x') as never) === '', 'sanitize: symbol-ish input → empty, no throw');
    assert(sanitizeIntegrationHealthText({ a: 1 }) === '', 'sanitize: plain object → empty (no [object Object] noise)');
  }

  // ─── Save-path helper (the circleIntegrations success-path fix) ──
  {
    // SUCCESS: explicit healthy write — status reset + last_validation_error
    // set to null so upsertCircleIntegration's metadata MERGE clears the
    // stale error instead of preserving it.
    const healthy = buildIntegrationSaveHealthState({ status: 'connected', validationMessage: undefined });
    assert(healthy.status === 'connected', 'save success → status connected');
    assert(healthy.metadataPatch.last_validation_error === null, 'save success → last_validation_error explicitly null (clears stale via merge)');
    assert(Object.prototype.hasOwnProperty.call(healthy.metadataPatch, 'last_validation_error'), 'save success → key PRESENT in patch (omission would not clear a merge)');

    // Simulate the merge upsertCircleIntegration performs: stale error must vanish.
    const staleRow = { last_validation_error: 'OpenRouter rejected the key (401/403)', base_url: 'https://x' };
    const merged = { ...staleRow, ...healthy.metadataPatch };
    assert(merged.last_validation_error === null, 'merge simulation: stale 401 error cleared on re-save success');
    assert(merged.base_url === 'https://x', 'merge simulation: unrelated metadata untouched');

    // FAILURE: degraded + sanitized bounded message.
    const bad = buildIntegrationSaveHealthState({ status: 'degraded', validationMessage: 'OpenRouter rejected the key (401/403)' });
    assert(bad.status === 'degraded', 'save failure → status degraded');
    assert(bad.metadataPatch.last_validation_error === 'OpenRouter rejected the key (401/403)', 'save failure → message stored verbatim when clean');

    const leaky = buildIntegrationSaveHealthState({ status: 'degraded', validationMessage: 'rejected key sk-abc123 (401)' });
    assert(!(leaky.metadataPatch.last_validation_error || '').includes('sk-abc123'), 'save failure → stored error scrubbed of token');
    assert((leaky.metadataPatch.last_validation_error || '').includes('401'), 'save failure → classification signal (401) survives scrubbing');

    const longMsg = buildIntegrationSaveHealthState({ status: 'degraded', validationMessage: 'e '.repeat(400) });
    assert((longMsg.metadataPatch.last_validation_error || '').length <= HEALTH_STORED_ERROR_MAX_CHARS, `stored error ≤ ${HEALTH_STORED_ERROR_MAX_CHARS}`);

    // Message present but status nominally connected → still degraded (message wins).
    const msgWins = buildIntegrationSaveHealthState({ status: 'connected', validationMessage: 'probe network error' });
    assert(msgWins.status === 'degraded', 'validation message forces degraded even if caller passed connected');

    // Degraded with an empty message still records a non-empty reason.
    const bareDegraded = buildIntegrationSaveHealthState({ status: 'degraded', validationMessage: '' });
    assert(bareDegraded.status === 'degraded' && !!bareDegraded.metadataPatch.last_validation_error, 'degraded + empty message → generic non-empty reason');

    // Totality of the helper.
    let threw = false;
    try {
      buildIntegrationSaveHealthState(null);
      buildIntegrationSaveHealthState(undefined);
      buildIntegrationSaveHealthState({ validationMessage: { boom: true } as never });
    } catch { threw = true; }
    assert(!threw, 'save helper total: never throws');
    assert(buildIntegrationSaveHealthState(null).status === 'connected', 'save helper: null opts → healthy default');

    // ROUND TRIP: the stored failure state renders as the danger badge; the
    // cleared success state renders green — the full silent-bad-key loop.
    const storedBad = buildIntegrationSaveHealthState({ status: 'degraded', validationMessage: 'OpenRouter rejected the key (401/403)' });
    const badgeBad = buildIntegrationHealthBadge({ status: storedBad.status, lastValidationError: storedBad.metadataPatch.last_validation_error });
    assert(badgeBad.tone === 'danger' && badgeBad.label === 'Key rejected (401)', 'round trip: failed save → danger badge');
    const storedGood = buildIntegrationSaveHealthState({ status: 'connected' });
    const badgeGood = buildIntegrationHealthBadge({ status: storedGood.status, lastValidationError: storedGood.metadataPatch.last_validation_error });
    assert(badgeGood.tone === 'ok' && badgeGood.label === 'Connected', 'round trip: successful re-save → green badge');
  }

  console.log(`\nintegration-health-badge-core: ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    console.error('FAILURES:\n' + failures.map(f => `  - ${f}`).join('\n'));
    process.exit(1);
  }
}

main();
