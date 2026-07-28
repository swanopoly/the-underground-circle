/**
 * user-memory-caps-smoketest — tests the pure `checkUserMemoryCap`
 * helper from `src/lib/userMemory.ts`. The Supabase-dependent writers
 * (`appendUserMemory`, `replaceUserMemory`) aren't smoke-testable
 * offline, but they delegate the cap decision to this pure helper.
 *
 * Run: npm run smoke:user-memory-caps
 */

import {
  USER_MEMORY_SOFT_CAP,
  USER_MEMORY_HARD_CAP,
  USER_MEMORY_CAP_ERROR,
  USER_MEMORY_CREDENTIAL_ERROR,
  checkUserMemoryCap,
  describeUserMemoryUsage,
  looksLikeCredentialMemoryContent,
  detectCredentialMemoryContent,
  describeCredentialMemoryBlock,
} from '../src/lib/userMemoryCaps';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Constants sanity ──────────────────────────────────────────────────
assert(USER_MEMORY_SOFT_CAP === 2200, 'constant: SOFT_CAP = 2200');
assert(USER_MEMORY_HARD_CAP === 2500, 'constant: HARD_CAP = 2500');
assert(USER_MEMORY_CAP_ERROR === 'memory_cap_exceeded', 'constant: CAP_ERROR string matches Hermes convention');
assert(USER_MEMORY_HARD_CAP > USER_MEMORY_SOFT_CAP, 'constant: hard > soft');

// ─── Case 1: empty + small add → ok, not approaching cap ───────────────
{
  const note = 'I prefer concise answers';
  const r = checkUserMemoryCap('', note);
  assert(r.ok, 'case1: empty base + short add → ok');
  if (r.ok) {
    assert(r.currentChars === 0, `case1: currentChars=0 (got ${r.currentChars})`);
    assert(r.nextChars === note.length, `case1: nextChars=${note.length} (got ${r.nextChars})`);
    assert(r.approachingSoftCap === false, 'case1: not approaching soft cap');
  }
}

// ─── Case 2: approaching soft cap ──────────────────────────────────────
{
  const base = 'x'.repeat(2100);
  const add = 'y'.repeat(150); // would be 2251 > soft 2200 < hard 2500
  const r = checkUserMemoryCap(base, add);
  assert(r.ok, 'case2: over soft but under hard → still ok');
  if (r.ok) {
    assert(r.approachingSoftCap, 'case2: approachingSoftCap=true');
  }
}

// ─── Case 3: append would exceed hard cap → cap error ──────────────────
{
  const base = 'x'.repeat(2400);
  const add = 'y'.repeat(200); // would be 2601 > hard 2500
  const r = checkUserMemoryCap(base, add);
  assert(!r.ok, 'case3: over hard cap → !ok');
  if (!r.ok) {
    assert(r.error === USER_MEMORY_CAP_ERROR, 'case3: error = memory_cap_exceeded');
    assert(r.suggestion === 'consolidate', 'case3: suggestion = consolidate');
    assert(r.currentChars === 2400, `case3: currentChars=2400 (got ${r.currentChars})`);
    assert(r.capChars === USER_MEMORY_HARD_CAP, 'case3: capChars = HARD_CAP');
    assert((r.wouldBeChars ?? 0) > 2500, `case3: wouldBeChars>2500 (got ${r.wouldBeChars})`);
  }
}

// ─── Case 4: custom caps honoured ──────────────────────────────────────
{
  const r = checkUserMemoryCap('x'.repeat(90), 'y'.repeat(20), { softCap: 50, hardCap: 100 });
  // 90 + separator + 20 = 111 > 100
  assert(!r.ok, 'case4: custom hard cap honoured');
  if (!r.ok) {
    assert(r.capChars === 100, 'case4: custom cap reflected in error');
  }
}

// ─── Case 5: whitespace trimmed ────────────────────────────────────────
{
  const r = checkUserMemoryCap('   ', '   hello   ');
  assert(r.ok, 'case5: whitespace-only base treated as empty');
  if (r.ok) {
    assert(r.nextChars === 'hello'.length, `case5: trimmed length (got ${r.nextChars})`);
  }
}

// ─── Case 6: describeUserMemoryUsage formatting ────────────────────────
{
  const clean = describeUserMemoryUsage('x'.repeat(500));
  assert(clean.includes('500 / 2,500'), 'case6: clean under-cap formatting');
  assert(!clean.includes('approaching'), 'case6: no warning when under soft');

  const soft = describeUserMemoryUsage('x'.repeat(2250));
  assert(soft.includes('approaching soft cap'), 'case6: approaching soft cap warning');

  const hard = describeUserMemoryUsage('x'.repeat(2500));
  assert(hard.includes('HARD CAP HIT'), 'case6: hard cap warning');
}

// ─── Case 7: credential guard (secret hygiene) ─────────────────────────
// appendUserMemory / replaceUserMemory refuse credential-shaped content via
// this pure guard so secrets never land in memory. Mirrors the /remember
// path's guard in conversationalRouter.ts (LOCKSTEP).
{
  assert(USER_MEMORY_CREDENTIAL_ERROR === 'memory_credential_blocked', 'case7: credential error constant');

  // Positives — credential noun + assigned value. Includes the two forms this
  // (superset) guard hardens vs. the router's: underscore nouns + spaced `=`.
  const secrets = [
    'my wifi password is hunter2!',
    'api key: sk-ant-abc123def456',
    'the access key is AKIAIOSFODNN7EXAMPLE',
    'recovery phrase: table horse battery staple',
    'my pin code is 4821',
    'the api-key is abcdef123456',
    'secret: correct-horse-battery',
    'API_KEY = sk-proj-xxxxxxxxxxxx',       // underscore noun (router missed this)
    'github token = ghp_abcdef1234567890',  // spaced `=` (router missed this)
    'ACCESS_KEY=AKIAIOSFODNN7EXAMPLE',      // underscore noun, glued `=`
  ];
  for (const s of secrets) {
    assert(looksLikeCredentialMemoryContent(s), `case7: BLOCKS ${JSON.stringify(s.slice(0, 40))}`);
  }

  // Negatives — no credential noun at all.
  const safe = [
    'I prefer concise answers',
    'remember that I work in Go and ship minimal code',
    'call me by my first name',
    'my deploy runs at 5pm',
    '',
  ];
  for (const s of safe) {
    assert(!looksLikeCredentialMemoryContent(s), `case7: ALLOWS ${JSON.stringify(s.slice(0, 40))}`);
  }

  // Degenerate input never throws.
  assert(looksLikeCredentialMemoryContent(null as any) === false, 'case7: null → false, no throw');
  assert(looksLikeCredentialMemoryContent(undefined as any) === false, 'case7: undefined → false');

  // ReDoS guard: adversarial long input returns fast (no catastrophic backtracking).
  const evil = 'password ' + 'a '.repeat(50_000);
  const t0 = Date.now();
  looksLikeCredentialMemoryContent(evil);
  const dt = Date.now() - t0;
  assert(dt < 200, `case7: 100k-token input evaluated in <200ms (was ${dt}ms)`);
}

// ─── Case 8: literal provider key shapes (app-wide gate, rule 1) ───────────
// These are secrets no matter what prose surrounds them — no credential noun
// required. Each asserts the expected rule id so a regex edit that silently
// re-routes a shape to a weaker rule is caught.
{
  const literals: Array<[string, string]> = [
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----', 'pem_private_key'],
    ['-----BEGIN OPENSSH PRIVATE KEY-----', 'pem_private_key'],
    ['-----BEGIN PRIVATE KEY-----', 'pem_private_key'],
    ['use eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'jwt'],
    ['curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"', 'bearer_token'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws_access_key_id'],
    ['ASIAY34FZKBOKMSXQTMQ', 'aws_access_key_id'],
    ['sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890', 'openai_style_key'],
    ['sk-proj-AbCdEf1234567890XyZ', 'openai_style_key'],
    ['sk_live_51HxYzAbCdEfGhIjKl', 'stripe_key'],
    ['ghp_16CharsMinimum0123456789abcdef', 'github_token'],
    ['gho_16CharsMinimum0123456789abcdef', 'github_token'],
    ['ghs_16CharsMinimum0123456789abcdef', 'github_token'],
    ['ghu_16CharsMinimum0123456789abcdef', 'github_token'],
    ['ghr_16CharsMinimum0123456789abcdef', 'github_token'],
    ['glpat-AbCdEfGhIjKlMnOpQrSt', 'gitlab_token'],
    ['xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOp', 'slack_token'],
    ['xoxa-2-abcdefghij1234567890', 'slack_token'],
    ['xoxp-123456789012-abcdefghij', 'slack_token'],
    ['xoxr-123456789012-abcdefghij', 'slack_token'],
    ['xoxs-123456789012-abcdefghij', 'slack_token'],
    ['AIzaSyD-1234567890abcdefghijklmnopqrstuv', 'google_api_key'],
    ['hf_AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'huggingface_token'],
    ['npm_AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'npm_token'],
  ];
  for (const [text, rule] of literals) {
    const found = detectCredentialMemoryContent(text);
    assert(found?.rule === rule, `case8: ${rule} caught for ${JSON.stringify(text.slice(0, 28))}`, `got ${found?.rule ?? 'null'}`);
  }

  // Embedded in prose — the shape still wins.
  const embedded = detectCredentialMemoryContent(
    'Chris said to use ghp_16CharsMinimum0123456789abcdef when pushing releases.',
  );
  assert(embedded?.rule === 'github_token', 'case8: literal shape caught inside a prose sentence');
}

// ─── Case 9: secret-named assignment (rule 2 — env-var shapes) ─────────────
// `\b` fails after `_`, so `GITHUB_TOKEN=…` was invisible to the old noun
// regex. Rule 2 drops the leading boundary specifically to catch these.
{
  const assigns = [
    'GITHUB_TOKEN=zzzzzzzzzzzzzzzz',
    'STRIPE_SECRET_KEY = whatever-value-here',
    'DB_PASSWORD: hunter2!',
    'MY_ACCESS_KEY=someopaquevalue',
    'export SUPABASE_SERVICE_ROLE_KEY=opaquevaluehere',
    'client_secret=GOCSPX-abcdefgh',
    'api_key="abcdef123456"',
    "apikey: 'abcdef123456'",
    'AUTH_TOKEN=abcd1234efgh',
    'PRIVATE_KEY=abcd1234efgh',
    'passphrase=correct-horse',
    'CREDENTIAL_BLOB=abcd1234efgh',
  ];
  for (const s of assigns) {
    const found = detectCredentialMemoryContent(s);
    assert(found !== null, `case9: BLOCKS ${JSON.stringify(s.slice(0, 40))}`, 'not detected');
  }
}

// ─── Case 10: prose must still save (false-positive control) ───────────────
// The gate is app-wide now, so an over-block is a real product bug: it silently
// drops legitimate team knowledge. These are the phrases people actually write.
{
  const prose = [
    'rotate the API key monthly',                              // the canonical case
    'we rotate every API key monthly and log the rotation',
    'the API key is stored in the vault',
    'the deploy token is managed by the vault, never in chat',
    'we discussed the password reset flow',                    // was an over-block before
    'the password reset emails go out from Postmark',
    'API keys are never pasted into chat — use the vault',
    'the token was rotated after the incident',
    'the secret is stored in 1Password under Infra',
    'her password manager is Bitwarden',
    'the API key rotation policy: quarterly',
    'access key permissions are managed in IAM',
    'the private key is kept offline',
    'PIN entry is disabled on the kiosk',
    'Chris prefers concise answers and minimal code',
    'we deploy to Netlify at 5pm on Fridays',
    'the recovery code flow is documented in docs/AUTH.md',
    'seed phrase handling is out of scope for this project',
    'commit a3f5c9e2b7d1084f6a2c9e3b5d7f1084a3f5c9e2 fixed the backoff bug',
    'see docs/COMPUTER_AGENT_EXPANSION_PLAN_2026-04-22.md for the plan',
    'the run id is 550e8400-e29b-41d4-a716-446655440000',
    'owner is src/lib/computerTaskEvidenceRecovery.ts and its recovery pipeline',
    'the shared helper lives at supabase/functions/_shared/swanbot-continuation.ts',
    'Consolidated_Agent_Runtime_Helper_SQL_2026 is the migration name',
  ];
  for (const s of prose) {
    const found = detectCredentialMemoryContent(s);
    assert(found === null, `case10: ALLOWS ${JSON.stringify(s.slice(0, 46))}`, `blocked by ${found?.rule}`);
  }

  // Multi-line: a credential noun in line 1 must NOT get glued to an unrelated
  // `KEY=value` five lines down (the gap is bounded and newline-blocked).
  const multiline = [
    'Team rotates the API key quarterly.',
    'Build config:',
    'NODE_ENV=production',
  ].join('\n');
  assert(detectCredentialMemoryContent(multiline) === null, 'case10: noun + far-away unrelated assignment still saves');

  // ...but a real secret later in the SAME note is still caught.
  const multilineSecret = 'Team notes for the release.\nDeploy with GITHUB_TOKEN=ghp_16CharsMinimum0123456789abcdef';
  assert(detectCredentialMemoryContent(multilineSecret) !== null, 'case10: real secret later in a multi-line note IS blocked');
}

// ─── Case 11: high-entropy backstop (rule 5) ───────────────────────────────
// Catches unknown/rotating key formats with no recognisable prefix. Gated on
// mixed character classes + no 7-char same-case run so identifiers/paths pass.
{
  // Deterministic pseudo-random base64 (no Math.random — determinism matters).
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const makeKey = (seed: number, len: number) => {
    let state = seed >>> 0;
    let out = '';
    for (let i = 0; i < len; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out += alphabet[(state >>> 16) % 64];
    }
    return out;
  };
  let caught = 0;
  const trials = 24;
  for (let i = 0; i < trials; i += 1) {
    if (detectCredentialMemoryContent(makeKey(i * 7919 + 13, 44))?.rule === 'high_entropy_secret') caught += 1;
  }
  assert(caught >= Math.ceil(trials * 0.8), `case11: ≥80% of unprefixed 44-char base64 keys caught (${caught}/${trials})`);

  // Explicit non-secret high-entropy-looking strings stay allowed (also covered
  // in case10, pinned here against threshold drift).
  const notSecrets = [
    'a3f5c9e2b7d1084f6a2c9e3b5d7f1084a3f5c9e2',                 // 40-char git SHA (no upper)
    'A3F5C9E2B7D1084F6A2C9E3B5D7F1084A3F5C9E2',                 // upper hex (no lower)
    '550e8400-e29b-41d4-a716-446655440000',                     // UUID
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',             // zero entropy
    'docs/COMPUTER_AGENT_EXPANSION_PLAN_2026-04-22',            // path w/ upper+lower+digit
  ];
  for (const s of notSecrets) {
    assert(detectCredentialMemoryContent(s) === null, `case11: not a secret ${JSON.stringify(s.slice(0, 34))}`, `blocked by ${detectCredentialMemoryContent(s)?.rule}`);
  }

  // Just under the length floor → not flagged by the entropy rule.
  assert(
    detectCredentialMemoryContent(makeKey(4242, 31))?.rule !== 'high_entropy_secret',
    'case11: 31-char run is below the 32-char entropy floor',
  );
}

// ─── Case 12: refusal message is observable and leaks nothing ──────────────
{
  const secret = 'ghp_16CharsMinimum0123456789abcdef';
  const found = detectCredentialMemoryContent(secret);
  const msg = describeCredentialMemoryBlock(found);
  assert(msg.includes(USER_MEMORY_CREDENTIAL_ERROR), 'case12: message carries the machine-readable error code');
  assert(msg.includes('GitHub token'), 'case12: message names the rule label (actionable)');
  assert(!msg.includes(secret), 'case12: message NEVER echoes the matched secret');
  assert(/vault/i.test(msg), 'case12: message points at the vault (tells the caller what to do)');
  assert(describeCredentialMemoryBlock(null).includes(USER_MEMORY_CREDENTIAL_ERROR), 'case12: null finding still yields a safe message');
}

// ─── Case 13: bounds / degenerate / determinism ────────────────────────────
{
  for (const degenerate of [null, undefined, '', '   ', 0, false, {}, []]) {
    assert(detectCredentialMemoryContent(degenerate as any) === null || typeof detectCredentialMemoryContent(degenerate as any)?.rule === 'string',
      `case13: degenerate input ${JSON.stringify(degenerate)} never throws`);
  }
  assert(detectCredentialMemoryContent('' as any) === null, 'case13: empty string → null');
  assert(looksLikeCredentialMemoryContent(null as any) === false, 'case13: boolean wrapper agrees on null');

  // Determinism — repeated calls on the same input give the same rule (guards
  // against a shared /g regex carrying lastIndex between calls).
  const sample = 'GITHUB_TOKEN=ghp_16CharsMinimum0123456789abcdef and the pin is 4821';
  const first = detectCredentialMemoryContent(sample);
  for (let i = 0; i < 5; i += 1) {
    const again = detectCredentialMemoryContent(sample);
    assert(again?.rule === first?.rule, `case13: deterministic across calls (run ${i + 1})`);
  }
  // ...and interleaved with a safe input (lastIndex bleed would flip this).
  detectCredentialMemoryContent('rotate the API key monthly');
  assert(detectCredentialMemoryContent(sample)?.rule === first?.rule, 'case13: no regex state bleed across inputs');

  // Large / adversarial input stays fast on every rule.
  const heavy = [
    'password ' + 'a '.repeat(50_000),
    'x'.repeat(200_000),
    ('token=' + 'b'.repeat(200)).repeat(500),
    'A1b'.repeat(60_000),
  ];
  for (const input of heavy) {
    const t0 = Date.now();
    detectCredentialMemoryContent(input);
    const dt = Date.now() - t0;
    assert(dt < 500, `case13: ${input.length}-char adversarial input in <500ms (was ${dt}ms)`);
  }
}

// ─── Case 14: the gate is actually WIRED at every memory_entries writer ────
// Pure-function correctness is worthless if a chokepoint drops the call. These
// assertions fail loudly if someone removes the wiring.
{
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const root = path.resolve(__dirname, '..');
  const wired: Array<[string, string]> = [
    ['src/lib/agentRunSystem.ts', 'saveMemory (client memory_entries chokepoint)'],
    ['supabase/functions/swanbot-ai/index.ts', 'saveSwanbotMemoryEntry (auto-memory + store_memory)'],
    ['supabase/functions/swanbot-v2-ai/index.ts', 'save_memory tool'],
    ['src/lib/userMemory.ts', 'append/replaceUserMemory'],
  ];
  for (const [rel, label] of wired) {
    let source = '';
    try { source = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { /* reported below */ }
    assert(
      /detectCredentialMemoryContent|looksLikeCredentialMemoryContent/.test(source),
      `case14: credential gate is wired in ${rel} — ${label}`,
    );
  }
}

if (failures > 0) {
  console.error(`\n${failures} user-memory-caps smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll user-memory-caps smoke cases passed.');
