/**
 * failure-recovery-copy-core-smoketest — pins the pure raw-failure → friendly
 * recovery copy core (src/lib/failureRecoveryCopyCore.ts) that replaces raw
 * exception text ("Failed to fetch", "Desktop bridge offline.", "Edge Function
 * returned a non-2xx status code", a bare edge 500) with a plain-language
 * title + message + next action, plus an auto-retry decision. Load-bearing
 * assertions:
 *
 *   CLASSIFY: representative real raw strings / Error objects / status objects
 *   land on the right FailureClass — 'Failed to fetch' → network, 'Desktop
 *   bridge offline.' / localhost:7778 / ECONNREFUSED-to-bridge → bridge_offline,
 *   401/session → auth, 403/forbidden → permission, 429/rate limit/overloaded →
 *   rate_limit, timeout/AbortError → timeout, model_unsupported/key_missing →
 *   model_config, 404/not found → not_found, non-2xx/edge function/5xx →
 *   edge_5xx, junk → unknown. Status fields are authoritative over fuzzy text
 *   ("under 500 characters" never reads as a 5xx).
 *
 *   RECOVERY COPY: buildFailureRecovery emits the spec'd copy + flags —
 *   bridge_offline action names `npm run bridge`, auth action says Sign in,
 *   model_config message is "isn't available on this path" and retryable false,
 *   rate_limit message says "giving it a moment"; network/timeout/edge_5xx/
 *   rate_limit auto-retry while attempt < AUTO_RETRY_MAX_ATTEMPT (2) and stop
 *   after; message + action always < 200 chars.
 *
 *   REDACTION: redactSecretsInError masks Bearer/sk-/key=VALUE/password/JWT so
 *   'Bearer sk-abc123' never survives; and NO secret embedded in a raw error or
 *   in opts.context can leak through buildFailureRecovery's copy.
 *
 *   TOTALITY: every export survives null / undefined / {} / number / bigint /
 *   symbol / function / array / huge / circular / Proxy-with-throwing-getters
 *   input without throwing, with bounded valid output.
 *
 * Pure — loads under tsx (failureRecoveryCopyCore has zero imports).
 */

import {
  AUTO_RETRY_MAX_ATTEMPT,
  buildFailureRecovery,
  classifyFailure,
  redactSecretsInError,
} from '../src/lib/failureRecoveryCopyCore';
import type { FailureClass, FailureRecovery } from '../src/lib/failureRecoveryCopyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(27);

const ALL_CLASSES: FailureClass[] = [
  'network', 'bridge_offline', 'auth', 'rate_limit', 'timeout',
  'model_config', 'not_found', 'permission', 'edge_5xx', 'unknown',
];

/** A secret that must never appear in any output. */
const SECRET = 'sk-abc123DEADBEEFsecret';

function recoveryLeaks(r: FailureRecovery, secretFragment: string): boolean {
  const blob = `${r.title}\n${r.message}\n${r.action}`;
  return blob.includes(secretFragment);
}

function isBoundedCopy(r: FailureRecovery): boolean {
  return typeof r.title === 'string' && r.title.length > 0 && r.title.length <= 60
    && typeof r.message === 'string' && r.message.length > 0 && r.message.length < 200
    && typeof r.action === 'string' && r.action.length > 0 && r.action.length < 200
    && typeof r.autoRetry === 'boolean'
    && typeof r.retryable === 'boolean'
    && (ALL_CLASSES as string[]).includes(r.class);
}

function main(): void {
  // ─── (1) classifyFailure → network ────────────────────────────────────────
  assertEq(classifyFailure('Failed to fetch'), 'network', '(1) Failed to fetch');
  assertEq(classifyFailure(new TypeError('Failed to fetch')), 'network', '(1) TypeError Failed to fetch');
  assertEq(classifyFailure('NetworkError when attempting to fetch resource'), 'network', '(1) NetworkError');
  assertEq(classifyFailure({ code: 'ECONNRESET' }), 'network', '(1) ECONNRESET code');
  assertEq(classifyFailure('net::ERR_CONNECTION_REFUSED'), 'network', '(1) chromium net:: error');
  assertEq(classifyFailure('socket hang up'), 'network', '(1) socket hang up');
  assertEq(classifyFailure({ message: 'getaddrinfo ENOTFOUND api.example.com' }), 'network', '(1) ENOTFOUND');
  assertEq(classifyFailure('fetch failed'), 'network', '(1) undici fetch failed');

  // ─── (2) classifyFailure → bridge_offline ─────────────────────────────────
  assertEq(classifyFailure('Desktop bridge offline.'), 'bridge_offline', '(2) Desktop bridge offline.');
  assertEq(classifyFailure('BlackSwan bridge unavailable in this environment'), 'bridge_offline', '(2) bridge unavailable');
  assertEq(classifyFailure('Desktop bridge not connected'), 'bridge_offline', '(2) bridge not connected');
  assertEq(classifyFailure('Desktop bridge not paired. Pair first.'), 'bridge_offline', '(2) bridge not paired');
  assertEq(classifyFailure({ message: 'connect ECONNREFUSED 127.0.0.1:7778' }), 'bridge_offline', '(2) ECONNREFUSED bridge port');
  assertEq(classifyFailure('request to http://localhost:7778/health failed'), 'bridge_offline', '(2) localhost:7778');
  assertEq(classifyFailure('Browser bridge unavailable in this environment.'), 'bridge_offline', '(2) browser bridge');
  // A generic ECONNREFUSED with no bridge/local context is just a network error.
  assertEq(classifyFailure('ECONNREFUSED'), 'network', '(2) bare ECONNREFUSED → network, not bridge');

  // ─── (3) classifyFailure → auth ───────────────────────────────────────────
  assertEq(classifyFailure('401 Unauthorized'), 'auth', '(3) 401 Unauthorized');
  assertEq(classifyFailure('User not authenticated'), 'auth', '(3) not authenticated');
  assertEq(classifyFailure('Auth session missing!'), 'auth', '(3) auth session missing');
  assertEq(classifyFailure('Your session expired'), 'auth', '(3) session expired');
  assertEq(classifyFailure({ status: 401 }), 'auth', '(3) status 401 object');
  assertEq(classifyFailure('JWT expired'), 'auth', '(3) jwt expired');

  // ─── (4) classifyFailure → permission ─────────────────────────────────────
  assertEq(classifyFailure('403 Forbidden'), 'permission', '(4) 403 Forbidden');
  assertEq(classifyFailure('permission denied'), 'permission', '(4) permission denied');
  assertEq(classifyFailure({ status: 403 }), 'permission', '(4) status 403 object');
  assertEq(classifyFailure('You are not allowed to do that'), 'permission', '(4) not allowed');
  assertEq(classifyFailure('access denied'), 'permission', '(4) access denied');
  // 403 is authoritative even when the word "unauthorized" is present.
  assertEq(classifyFailure({ status: 403, message: 'unauthorized' }), 'permission', '(4) 403 wins over unauthorized word');

  // ─── (5) classifyFailure → rate_limit ─────────────────────────────────────
  assertEq(classifyFailure('429 Too Many Requests'), 'rate_limit', '(5) 429 Too Many Requests');
  assertEq(classifyFailure('rate limit exceeded'), 'rate_limit', '(5) rate limit exceeded');
  assertEq(classifyFailure({ status: 429 }), 'rate_limit', '(5) status 429 object');
  assertEq(classifyFailure('You are being rate-limited'), 'rate_limit', '(5) rate-limited');
  assertEq(classifyFailure('Overloaded'), 'rate_limit', '(5) Anthropic overloaded');
  assertEq(classifyFailure({ status: 529 }), 'rate_limit', '(5) status 529 → rate_limit not edge');

  // ─── (6) classifyFailure → timeout ────────────────────────────────────────
  assertEq(classifyFailure('Request timed out'), 'timeout', '(6) timed out');
  assertEq(classifyFailure('timeout of 30000ms exceeded'), 'timeout', '(6) axios timeout');
  const abortErr = new Error('The operation was aborted'); abortErr.name = 'AbortError';
  assertEq(classifyFailure(abortErr), 'timeout', '(6) AbortError instance');
  assertEq(classifyFailure({ name: 'AbortError' }), 'timeout', '(6) AbortError name object');
  assertEq(classifyFailure('ETIMEDOUT'), 'timeout', '(6) ETIMEDOUT');
  assertEq(classifyFailure('deadline exceeded'), 'timeout', '(6) deadline exceeded');

  // ─── (7) classifyFailure → model_config ───────────────────────────────────
  assertEq(classifyFailure('model_unsupported'), 'model_config', '(7) model_unsupported');
  assertEq(classifyFailure('key_missing'), 'model_config', '(7) key_missing');
  assertEq(classifyFailure('That model is not supported on this path'), 'model_config', '(7) model not supported');
  assertEq(classifyFailure({ code: 'model_unsupported' }), 'model_config', '(7) model_unsupported code');
  assertEq(classifyFailure('No API key configured for provider'), 'model_config', '(7) no api key');
  // "model not found" must read as model_config, not not_found.
  assertEq(classifyFailure('model not found'), 'model_config', '(7) model not found → model_config');

  // ─── (8) classifyFailure → not_found ──────────────────────────────────────
  assertEq(classifyFailure('404 Not Found'), 'not_found', '(8) 404 Not Found');
  assertEq(classifyFailure('resource not found'), 'not_found', '(8) resource not found');
  assertEq(classifyFailure({ status: 404 }), 'not_found', '(8) status 404 object');
  assertEq(classifyFailure("that record doesn't exist"), 'not_found', '(8) doesnt exist');
  assertEq(classifyFailure('no such file or directory'), 'not_found', '(8) no such');

  // ─── (9) classifyFailure → edge_5xx ───────────────────────────────────────
  assertEq(classifyFailure('Edge Function returned a non-2xx status code'), 'edge_5xx', '(9) non-2xx edge function');
  assertEq(classifyFailure({ status: 500 }), 'edge_5xx', '(9) status 500 object');
  assertEq(classifyFailure('Internal Server Error'), 'edge_5xx', '(9) internal server error');
  assertEq(classifyFailure('502 Bad Gateway'), 'edge_5xx', '(9) 502 bad gateway');
  assertEq(classifyFailure('status 503'), 'edge_5xx', '(9) status 503');
  assertEq(classifyFailure('service unavailable'), 'edge_5xx', '(9) service unavailable');
  // A non-2xx wrapper around a real 401 must respect the status, not read 5xx.
  assertEq(
    classifyFailure({ status: 401, message: 'Edge Function returned a non-2xx status code' }),
    'auth',
    '(9) non-2xx wrapper + status 401 → auth',
  );

  // ─── (10) classifyFailure → unknown + fail-closed number handling ─────────
  assertEq(classifyFailure('something weird happened'), 'unknown', '(10) unclassified prose');
  assertEq(classifyFailure(''), 'unknown', '(10) empty string');
  assertEq(classifyFailure({}), 'unknown', '(10) empty object');
  assertEq(classifyFailure('boom'), 'unknown', '(10) boom');
  assertEq(classifyFailure('this text has under 500 characters in it'), 'unknown', '(10) bare 500 not a status');
  assertEq(classifyFailure('processed 503 items successfully'), 'unknown', '(10) bare 503 not a status');
  assertEq(classifyFailure(42), 'unknown', '(10) lone number');

  // ─── (11) AUTO_RETRY_MAX_ATTEMPT constant ─────────────────────────────────
  assertEq(AUTO_RETRY_MAX_ATTEMPT, 2, '(11) AUTO_RETRY_MAX_ATTEMPT is 2');

  // ─── (12) buildFailureRecovery: class + flags + bounded copy for each class ─
  const repRaw: Record<FailureClass, unknown> = {
    network: 'Failed to fetch',
    bridge_offline: 'Desktop bridge offline.',
    auth: '401 Unauthorized',
    rate_limit: '429 Too Many Requests',
    timeout: 'Request timed out',
    model_config: 'model_unsupported',
    not_found: '404 Not Found',
    permission: '403 Forbidden',
    edge_5xx: 'Edge Function returned a non-2xx status code',
    unknown: 'boom',
  };
  const expectAutoRetry: Record<FailureClass, boolean> = {
    network: true, bridge_offline: false, auth: false, rate_limit: true, timeout: true,
    model_config: false, not_found: false, permission: false, edge_5xx: true, unknown: false,
  };
  const expectRetryable: Record<FailureClass, boolean> = {
    network: true, bridge_offline: true, auth: true, rate_limit: true, timeout: true,
    model_config: false, not_found: false, permission: true, edge_5xx: true, unknown: true,
  };
  for (const cls of ALL_CLASSES) {
    const r = buildFailureRecovery(repRaw[cls], { attempt: 0 });
    assertEq(r.class, cls, `(12) ${cls} class`);
    assertEq(r.autoRetry, expectAutoRetry[cls], `(12) ${cls} autoRetry`);
    assertEq(r.retryable, expectRetryable[cls], `(12) ${cls} retryable`);
    assert(isBoundedCopy(r), `(12) ${cls} bounded copy`, JSON.stringify(r));
  }

  // ─── (13) buildFailureRecovery: exact spec'd copy ─────────────────────────
  const bridge = buildFailureRecovery('Desktop bridge offline.');
  assertEq(bridge.title, 'Desktop bridge not connected', '(13) bridge title');
  assert(bridge.message.includes("local bridge"), '(13) bridge message mentions local bridge', bridge.message);
  assert(bridge.action.includes('npm run bridge'), '(13) bridge action names npm run bridge', bridge.action);
  assertEq(bridge.autoRetry, false, '(13) bridge never auto-retries');

  const auth = buildFailureRecovery('401 Unauthorized');
  assert(/sign in/i.test(auth.action), '(13) auth action says Sign in', auth.action);
  assertEq(auth.autoRetry, false, '(13) auth never auto-retries');
  assertEq(auth.retryable, true, '(13) auth retryable after sign-in');

  const model = buildFailureRecovery('model_unsupported');
  assert(model.message.includes("isn't available on this path"), '(13) model message copy', model.message);
  assertEq(model.retryable, false, '(13) model_config not retryable');
  assertEq(model.autoRetry, false, '(13) model_config not auto-retry');

  const rl = buildFailureRecovery('rate limit exceeded');
  assert(rl.message.includes('giving it a moment'), '(13) rate_limit message giving it a moment', rl.message);
  assertEq(rl.autoRetry, true, '(13) rate_limit auto-retries on first attempt');

  // ─── (14) auto-retry gating by attempt (transient classes) ────────────────
  assertEq(buildFailureRecovery('Failed to fetch', { attempt: 0 }).autoRetry, true, '(14) network attempt 0 → auto');
  assertEq(buildFailureRecovery('Failed to fetch', { attempt: 1 }).autoRetry, true, '(14) network attempt 1 → auto');
  assertEq(buildFailureRecovery('Failed to fetch', { attempt: 2 }).autoRetry, false, '(14) network attempt 2 → stop');
  assertEq(buildFailureRecovery('Failed to fetch', { attempt: 9 }).autoRetry, false, '(14) network attempt 9 → stop');
  assertEq(buildFailureRecovery('Request timed out', { attempt: 5 }).autoRetry, false, '(14) timeout exhausted → stop');
  assertEq(buildFailureRecovery('Internal Server Error', { attempt: 2 }).autoRetry, false, '(14) edge_5xx exhausted → stop');
  // Exhausted transient still stays retryable and swaps to manual action copy.
  const exhausted = buildFailureRecovery('Failed to fetch', { attempt: 2 });
  assertEq(exhausted.retryable, true, '(14) exhausted network still retryable');
  assert(/internet|retry|try again/i.test(exhausted.action), '(14) exhausted network gives manual action', exhausted.action);
  // Non-transient classes never auto-retry regardless of attempt.
  assertEq(buildFailureRecovery('401 Unauthorized', { attempt: 0 }).autoRetry, false, '(14) auth attempt 0 never auto');

  // ─── (15) redactSecretsInError masks secrets ──────────────────────────────
  assert(!redactSecretsInError('Bearer sk-abc123').includes('sk-abc123'), '(15) Bearer sk- masked');
  assert(redactSecretsInError('Bearer sk-abc123').includes('[redacted]'), '(15) redaction marker present');
  assert(!redactSecretsInError(`Authorization: Bearer ${SECRET}`).includes(SECRET), '(15) authorization bearer masked');
  assert(!redactSecretsInError('sk-ant-api03-XXXXXXXXXXXXXXXXXXXX').includes('XXXXXXXXXXXX'), '(15) sk-ant masked');
  assert(!redactSecretsInError('api_key=SUPERSECRETVALUE1234').includes('SUPERSECRETVALUE1234'), '(15) api_key=VALUE masked');
  assert(!redactSecretsInError('password: hunter2longpass').includes('hunter2longpass'), '(15) password: VALUE masked');
  assert(!redactSecretsInError('token=eyJhbGciOi.JzdWIiOiJ.SflKxwRJ').includes('SflKxwRJ'), '(15) JWT / token masked');
  const ghRaw = { message: 'auth failed', detail: 'ghp_0123456789ABCDEFGHIJ0123456789ABCD' };
  assert(!redactSecretsInError(ghRaw).includes('ghp_0123456789'), '(15) github token in object field masked');
  // A clean error passes through readable (bounded).
  const clean = redactSecretsInError('Desktop bridge offline.');
  assert(clean.includes('bridge') && clean.length < 200, '(15) clean error passes through readable', clean);

  // ─── (16) NO secret leaks through buildFailureRecovery copy ───────────────
  // via the raw error itself (raw is never echoed into the copy):
  const rawWithSecret = `Edge Function failed — leaked Bearer ${SECRET} in body`;
  const fromRaw = buildFailureRecovery(rawWithSecret, { attempt: 0 });
  assert(!recoveryLeaks(fromRaw, SECRET), '(16) secret in raw error never reaches copy');
  assert(!recoveryLeaks(fromRaw, 'abc123DEADBEEF'), '(16) secret fragment in raw never reaches copy');
  // via opts.context (the only free-text channel — must be redacted + whitelisted):
  const fromCtx = buildFailureRecovery('Failed to fetch', { context: `auth Bearer ${SECRET} flow` });
  assert(!recoveryLeaks(fromCtx, SECRET), '(16) secret in context never reaches copy');
  assert(!recoveryLeaks(fromCtx, 'abc123DEADBEEF'), '(16) secret fragment in context never reaches copy');
  assert(isBoundedCopy(fromCtx), '(16) context-bearing copy still bounded', JSON.stringify(fromCtx));
  // Fuzz barrage: every class + a distinct embedded secret, in raw and in context.
  let anyLeak = false;
  for (const cls of ALL_CLASSES) {
    const seed = String(repRaw[cls]);
    const withRaw = buildFailureRecovery(`${seed} :: ${SECRET}`, { attempt: 1 });
    const withCtx = buildFailureRecovery(seed, { context: `${cls} ${SECRET}` });
    if (recoveryLeaks(withRaw, 'abc123DEADBEEF') || recoveryLeaks(withCtx, 'abc123DEADBEEF')) anyLeak = true;
    if (!isBoundedCopy(withRaw) || !isBoundedCopy(withCtx)) anyLeak = true;
  }
  assert(!anyLeak, '(16) no secret leak / unbounded copy across the full class barrage');

  // ─── (17) hostile opts + context sanitation never break copy ──────────────
  const ctlCtx = buildFailureRecovery('boom', { context: `desk${NUL}top${BEL} task${ESC}[0m` });
  assert(isBoundedCopy(ctlCtx), '(17) control chars in context stay bounded', JSON.stringify(ctlCtx));
  assert(!/[\u0000-\u001F\u007F]/.test(ctlCtx.message), '(17) no control chars leak into message', JSON.stringify(ctlCtx.message));
  const hugeCtx = buildFailureRecovery('boom', { context: 'x'.repeat(5000) });
  assert(isBoundedCopy(hugeCtx), '(17) huge context stays bounded', `msg len ${hugeCtx.message.length}`);
  assertEq(buildFailureRecovery('boom', { attempt: -5 }).autoRetry, false, '(17) negative attempt safe');
  assertEq(buildFailureRecovery('Failed to fetch', { attempt: Number.NaN }).autoRetry, true, '(17) NaN attempt → 0 → auto');
  assertEq(buildFailureRecovery('Failed to fetch', { attempt: 1.9 }).autoRetry, true, '(17) fractional attempt truncates to 1');

  // ─── (18) degenerate / hostile inputs never throw at any export ───────────
  try {
    const circular: Record<string, unknown> = { message: 'loop' };
    circular.self = circular;
    const bigintV: unknown = typeof BigInt === 'function' ? BigInt(42) : 42;
    const junk: unknown[] = [
      null, undefined, {}, [], ['x', { message: 'nested' }], 0, -1, Number.NaN,
      Number.POSITIVE_INFINITY, true, false, 42.5, '', '   ', Symbol('s'), () => 'x',
      bigintV, new Map(), new Set(), circular, { status: 'not-a-number' },
      { message: {} }, { message: null }, new Date(0), /regex/,
      'a'.repeat(100000), `${NUL}${BEL}${ESC}`, { toString() { throw new Error('nope'); } },
    ];
    for (const j of junk) {
      const c = classifyFailure(j);
      const r = buildFailureRecovery(j);
      const r2 = buildFailureRecovery(j, { attempt: 3, context: 'ctx' });
      const red = redactSecretsInError(j);
      if (!(ALL_CLASSES as string[]).includes(c)) assert(false, '(18) classifyFailure returned a bad class', String(c));
      if (!isBoundedCopy(r) || !isBoundedCopy(r2)) assert(false, '(18) buildFailureRecovery produced unbounded/invalid copy', JSON.stringify(r));
      if (typeof red !== 'string' || red.length > 520) assert(false, '(18) redactSecretsInError produced a bad string', String(red).slice(0, 40));
    }

    // Proxy whose every property read throws — must be swallowed everywhere.
    const evil = new Proxy({}, { get() { throw new Error('boom'); }, has() { throw new Error('boom'); } });
    assertEq(classifyFailure(evil), 'unknown', '(18) throwing-getter proxy → unknown');
    assert(isBoundedCopy(buildFailureRecovery(evil)), '(18) throwing-getter proxy → bounded copy');
    assertEq(redactSecretsInError(evil), '', '(18) throwing-getter proxy → empty redaction');

    // Hostile opts object with throwing getters must not break buildFailureRecovery.
    const evilOpts = new Proxy({}, { get() { throw new Error('boom'); } }) as { context?: string; attempt?: number };
    const rEvilOpts = buildFailureRecovery('Failed to fetch', evilOpts);
    assert(isBoundedCopy(rEvilOpts), '(18) throwing-getter opts → bounded copy');
    assertEq(rEvilOpts.class, 'network', '(18) throwing-getter opts still classifies raw');

    assert(true, '(18) full degenerate barrage completed without throwing');
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (18) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll failure-recovery-copy-core smoke cases passed (${passes} passed).`);
}

main();
