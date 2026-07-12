/**
 * error-sanitizer-smoketest — verifies the A8 `sanitizeErrorForModel` boundary
 * (src/lib/errorSanitizer.ts) that guards raw tool/edge error strings before
 * they reach the model or client.
 *
 * Invariants under test:
 *   1. FAIL-VISIBLE — output is always non-empty and names the actionable
 *      error CLASS (not-found / permission / timeout / rate-limit / conflict /
 *      bad-request / network / unavailable). It NEVER fabricates success.
 *   2. Secrets are stripped — bearer/token/api_key/password/sk-/authorization/
 *      cookie/JWT/vendor-prefix substrings become `[redacted]`.
 *   3. DB/PostgREST/infra leakage is removed — relation/column/constraint
 *      names, connection strings, internal hosts/IPs, and filesystem paths are
 *      replaced with neutral placeholders, WHILE the class survives.
 *   4. Bounded — output never exceeds 300 chars.
 *   5. Degenerate inputs (null, undefined, circular, throwing getters, huge
 *      blobs, non-string message) NEVER throw and still classify.
 *   6. Classifier maps representative Supabase/HTTP errors to the right class.
 *
 * Also exercises the sibling redactor `redactBbUrl` from imessageService when
 * that module loads under tsx (it imports storage/localSecrets which MAY pull
 * react-native; if so the check is skipped, not failed — the redactor is
 * covered structurally either way).
 *
 * errorSanitizer is pure/zero-import, so it loads directly with no hooks.
 *
 * Run: npx tsx scripts/error-sanitizer-smoketest.ts
 */

import assert from 'node:assert/strict';
import {
  sanitizeErrorForModel,
  classifyError,
  type SanitizedErrorClass,
} from '../src/lib/errorSanitizer';

const MAX_LEN = 300;
const SECRETISH =
  /\b(?:sk-ant-|sk-[A-Za-z0-9]{16}|xox[baprs]-|gh[pousr]_|github_pat_|AKIA|AIza|hf_|eyJ[A-Za-z0-9._-]{10,}\.)/;

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log('pass:', name);
  } catch (e: any) {
    failures += 1;
    console.error('FAIL:', name, '—', e?.message || e);
  }
}

/** Assert a sanitized string is bounded and carries no obvious secret/schema. */
function assertClean(out: string, ctx: string) {
  assert.ok(typeof out === 'string' && out.length > 0, `${ctx}: non-empty`);
  assert.ok(out.length <= MAX_LEN, `${ctx}: bounded (${out.length} ≤ ${MAX_LEN})`);
  assert.ok(!SECRETISH.test(out), `${ctx}: no vendor-key/JWT substring left — got: ${out}`);
}

// ── 1. FAIL-VISIBLE: class is always present ───────────────────────────────
check('fail-visible: every output names a class in parens', () => {
  const cases: unknown[] = [
    'relation "x" does not exist',
    new Error('connect ETIMEDOUT'),
    { message: 'permission denied for table foo' },
    'totally novel opaque failure',
    '',
    null,
  ];
  for (const c of cases) {
    const out = sanitizeErrorForModel(c);
    assert.match(out, /\((?:not-found|permission|timeout|rate-limit|conflict|bad-request|unavailable|network|unknown)\)/, `class tag present for ${JSON.stringify(c)} — got: ${out}`);
    assert.ok(out.length > 0, 'non-empty (fail-visible, never a fake success)');
  }
});

// ── 2. Secret stripping ────────────────────────────────────────────────────
check('secrets: bearer / api_key / sk- / cookie / JWT are redacted', () => {
  const samples: { raw: string; label: string }[] = [
    { raw: 'Auth failed: Authorization: Bearer sk-ant-api03-AbCdEf012345678901234567890', label: 'bearer+anthropic' },
    { raw: 'invalid api_key=sk-9f8e7d6c5b4a39281706abcd', label: 'openai-style key' },
    { raw: 'bad request: password=hunter2secretvalue was rejected', label: 'password kv' },
    { raw: 'error with token: xoxb-123456789012-abcdefghijkl', label: 'slack token' },
    { raw: 'header dump Cookie: session=abc123def456ghi789 rejected', label: 'cookie' },
    { raw: 'JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456 invalid', label: 'jwt' },
    { raw: 'x-api-key: AKIAIOSFODNN7EXAMPLE denied', label: 'aws key' },
    { raw: 'gh token ghp_16CharsMinimum0000000000000000 bad', label: 'github token' },
  ];
  for (const { raw, label } of samples) {
    const out = sanitizeErrorForModel(raw);
    assertClean(out, `secret[${label}]`);
    // The literal secret material must not survive.
    assert.ok(!out.includes('hunter2secretvalue'), `${label}: password value gone`);
    assert.ok(!/sk-ant-api03-AbCdEf/.test(out), `${label}: anthropic key gone`);
    assert.ok(!out.includes('AKIAIOSFODNN7EXAMPLE'), `${label}: aws key gone`);
    assert.ok(out.includes('[redacted]'), `${label}: redaction marker present`);
  }
});

// ── 3. DB/PostgREST/infra leakage removed, class preserved ─────────────────
check('infra: schema/relation/column names stripped but class kept', () => {
  const out = sanitizeErrorForModel('relation "circle_github_events" does not exist', { context: 'GitHub activity query' });
  assertClean(out, 'relation');
  assert.ok(!out.includes('circle_github_events'), 'table name removed');
  assert.match(out, /\(not-found\)/, 'not-found class preserved despite schema strip');
});

check('infra: connection string (with creds) fully neutralized', () => {
  const out = sanitizeErrorForModel('could not connect to server: postgres://admin:sup3rSecret@db.internal:5432/prod');
  assertClean(out, 'connstring');
  assert.ok(!out.includes('sup3rSecret'), 'embedded password gone');
  assert.ok(!out.includes('db.internal'), 'internal host gone');
  assert.ok(!/5432/.test(out) || out.includes('[endpoint]'), 'endpoint neutralized');
});

check('infra: bare internal host + IP + column masked', () => {
  const out = sanitizeErrorForModel('column users.password_hash of relation "users" error at 10.0.3.14:5432 host pooler.supabase.com');
  assertClean(out, 'host+ip+column');
  assert.ok(!/10\.0\.3\.14/.test(out), 'IPv4 masked');
  assert.ok(!/pooler\.supabase\.com/.test(out), 'infra host masked');
  assert.ok(!out.includes('"users"'), 'quoted relation name masked');
});

check('infra: filesystem paths stripped', () => {
  const out = sanitizeErrorForModel('ENOENT: no such file /Users/deploy/app/secret/config.json');
  assertClean(out, 'fs-path');
  assert.ok(!out.includes('/Users/deploy/app/secret'), 'unix path removed');
});

// ── 4. Bounded output on huge blobs ────────────────────────────────────────
check('bounded: 50k-char message clamps to ≤300 with ellipsis', () => {
  const huge = 'x'.repeat(50_000) + ' invalid request';
  const out = sanitizeErrorForModel(huge);
  assert.ok(out.length <= MAX_LEN, `clamped (${out.length})`);
});

// ── 5. Degenerate inputs never throw ───────────────────────────────────────
check('degenerate: null/undefined/number/circular/throwing-getter never throw', () => {
  const circular: any = { a: 1 };
  circular.self = circular;
  const throwingGetter: any = {};
  Object.defineProperty(throwingGetter, 'message', {
    enumerable: true,
    get() { throw new Error('boom from getter'); },
  });
  const symbolPrimitive: any = {
    [Symbol.toPrimitive]() { throw new Error('no primitive'); },
  };
  const inputs: unknown[] = [
    null, undefined, 0, false, NaN, 123n,
    circular, throwingGetter, symbolPrimitive,
    [], {}, Symbol('x') as any,
    new Error(),                 // empty message
  ];
  for (const i of inputs) {
    let out = '';
    assert.doesNotThrow(() => { out = sanitizeErrorForModel(i); }, `no throw for ${String(typeof i)}`);
    assert.ok(typeof out === 'string' && out.length > 0, 'still fail-visible for degenerate input');
    assert.ok(out.length <= MAX_LEN, 'still bounded');
  }
});

// ── 6. Classifier mapping ──────────────────────────────────────────────────
check('classifier: representative errors → expected class', () => {
  const cases: [string, SanitizedErrorClass][] = [
    ['JSON object requested, multiple (or no) rows returned (PGRST116)', 'not-found'],
    ['new row violates row-level security policy for table "tasks"', 'permission'],
    ['permission denied for table circle_members', 'permission'],
    ['duplicate key value violates unique constraint "tasks_pkey"', 'conflict'],
    ['request timed out after 30000ms', 'timeout'],
    ['429 Too Many Requests', 'rate-limit'],
    ['fetch failed: ECONNREFUSED', 'network'],
    ['503 Service Unavailable', 'unavailable'],
    ['null value in column "title" violates not-null constraint', 'bad-request'],
    ['HTTP 404 not found', 'not-found'],
  ];
  for (const [raw, want] of cases) {
    const got = classifyError(raw);
    assert.equal(got, want, `classify(${JSON.stringify(raw)}) => ${got}, want ${want}`);
  }
});

// ── 7. context label is scrubbed + bounded ─────────────────────────────────
check('context: caller label is scrubbed and does not leak secrets', () => {
  const out = sanitizeErrorForModel('failed', { context: 'op with token=sk-ant-api03-XXXXXXXXXXXXXXXXXXXX' });
  assertClean(out, 'context-scrub');
  assert.ok(!/sk-ant-api03-X/.test(out), 'secret in context label stripped');
});

// ── 8. sibling redactor redactBbUrl (best-effort; skip if RN-tainted) ──────
async function checkBbRedactor() {
  let redactBbUrl: ((v: unknown) => string) | undefined;
  try {
    ({ redactBbUrl } = await import('../src/lib/imessageService'));
  } catch (e: any) {
    console.log('skip: redactBbUrl (imessageService not tsx-loadable here) —', e?.message || e);
    return;
  }
  check('redactBbUrl: strips password/guid/token query params', () => {
    const r1 = redactBbUrl!('https://server.ngrok.io/api/v1/ping?password=hunter2SUPERSECRET');
    assert.ok(!r1.includes('hunter2SUPERSECRET'), 'password value removed from full URL');
    assert.ok(r1.includes('password=REDACTED'), 'param retained but redacted');

    const r2 = redactBbUrl!('/api/v1/chat?guid=abc123secret&limit=30');
    assert.ok(!r2.includes('abc123secret'), 'guid removed from relative URL');
    assert.ok(r2.includes('limit=30'), 'non-secret param preserved');

    const r3 = redactBbUrl!('BlueBubbles request failed: fetch to https://h/x?token=zzzTOP failed');
    assert.ok(!r3.includes('zzzTOP'), 'token removed from error-embedded URL');

    // Degenerate inputs never throw.
    assert.doesNotThrow(() => redactBbUrl!(null));
    assert.doesNotThrow(() => redactBbUrl!(undefined));
    assert.doesNotThrow(() => redactBbUrl!(12345));
    assert.equal(redactBbUrl!(''), '', 'empty passthrough');
  });
}

async function main() {
  await checkBbRedactor();
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll error-sanitizer checks passed.');
}

void main();
