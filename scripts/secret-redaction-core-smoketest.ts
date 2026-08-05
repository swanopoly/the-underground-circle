// Smoke for src/lib/secretRedactionCore.ts — pure, tsx-loadable, no react-native.
// Run: npx tsx scripts/secret-redaction-core-smoketest.ts
// All "secrets" below are OBVIOUSLY FAKE placeholders (AWS's public example key,
// zero-filled tokens, FAKE-marked values). Never put a real secret here.
import {
  SECRET_PATTERNS,
  containsSecret,
  redactSecrets,
} from '../src/lib/secretRedactionCore';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${msg}`);
  }
}

const MASK = '[REDACTED]';

// --- Fake fixtures (never real) -------------------------------------------------
const FAKE = {
  aws_access_key: 'AKIAIOSFODNN7EXAMPLE', // AWS's own public example key
  aws_secret: 'aws_secret_access_key = wJalrXUtnFEMIabcdEXAMPLEKEYabcdEXAMPLEKEY', // 40 chars, labeled
  github_pat_classic: 'ghp_000000000000000000000000000000000000', // ghp_ + 36 chars
  github_pat_fine: 'github_pat_00000000000000000000000000000000000000000000000000',
  openai_key: 'sk-0000000000000000000000',
  anthropic_key: 'sk-ant-FAKEFAKEFAKEFAKEFAKE00',
  slack_token: 'xoxb-0000000000-0000000000-FAKEFAKEFAKE',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.FAKEsignature0000',
  bearer: 'Bearer FAKEtoken0000000000000000',
  pem: '-----BEGIN RSA PRIVATE KEY-----\nFAKEFAKEFAKEbody\n-----END RSA PRIVATE KEY-----',
  basic_auth_url: 'https://alice:FAKEpassword123@example.com/path',
  generic_api_key: 'api_key="FAKEabcdefghij0123456789"',
};

// === 1. Each pattern masks its positive fixture ================================
function eachPatternMasks(): void {
  for (const [name, sample] of Object.entries(FAKE)) {
    const r = redactSecrets(sample);
    assert(r.redactionCount >= 1, `positive[${name}] should have >=1 redaction (got ${r.redactionCount})`);
    assert(r.text.includes(MASK), `positive[${name}] output should contain mask`);
    assert(containsSecret(sample) === true, `containsSecret(${name}) should be true`);
  }
}

// === 2. kind attribution per pattern ===========================================
function kindAttribution(): void {
  const cases: Array<[string, string]> = [
    [FAKE.aws_access_key, 'aws_access_key'],
    [FAKE.aws_secret, 'aws_secret'],
    [FAKE.github_pat_classic, 'github_pat'],
    [FAKE.github_pat_fine, 'github_pat'],
    [FAKE.openai_key, 'openai_key'],
    [FAKE.anthropic_key, 'anthropic_key'],
    [FAKE.slack_token, 'slack_token'],
    [FAKE.jwt, 'jwt'],
    [FAKE.bearer, 'bearer'],
    [FAKE.pem, 'pem_block'],
    [FAKE.basic_auth_url, 'basic_auth_url'],
    [FAKE.generic_api_key, 'generic_api_key'],
  ];
  for (const [sample, kind] of cases) {
    const r = redactSecrets(sample);
    assert(r.kinds.includes(kind), `sample should be attributed kind=${kind} (got ${JSON.stringify(r.kinds)})`);
  }
}

// === 3. sk-ant matched as anthropic_key, NOT openai_key ========================
function antNotOpenai(): void {
  const r = redactSecrets(FAKE.anthropic_key);
  assert(r.kinds.includes('anthropic_key'), 'sk-ant should be anthropic_key');
  assert(!r.kinds.includes('openai_key'), 'sk-ant should NOT be tagged openai_key');
  assert(r.kinds.length === 1, `sk-ant should yield exactly one kind (got ${JSON.stringify(r.kinds)})`);
  assert(r.redactionCount === 1, `sk-ant should count once (got ${r.redactionCount})`);
}

// === 4. Negatives — normal text is untouched ===================================
function negativesUntouched(): void {
  const negs = [
    'The quick brown fox jumps over the lazy dog.',
    'deadbeef', // short hex
    'keyboard', // the word contains "key" but is not a secret
    'https://example.com/path?tab=home', // normal URL, no creds
    'My favorite api is well documented.', // "api" without key value
    'cafe1234', // short hex-ish
    'Please send me the key to the office door.',
    '', // handled separately too, but harmless here
    'version 1.2.3 released today',
    'sk-short', // below the 20-char floor → not a key
    'AKIAshort', // AKIA but not 16 trailing chars
    'Bearer x', // too short to be a bearer token
  ];
  for (const s of negs) {
    const r = redactSecrets(s);
    assert(r.redactionCount === 0, `negative should not redact: ${JSON.stringify(s)} (count=${r.redactionCount}, kinds=${JSON.stringify(r.kinds)})`);
    assert(r.kinds.length === 0, `negative should have no kinds: ${JSON.stringify(s)}`);
    // For non-empty inputs the text must be returned unchanged.
    if (s.length > 0) {
      assert(r.text === s, `negative text must be unchanged: ${JSON.stringify(s)}`);
    }
    assert(containsSecret(s) === false, `containsSecret should be false: ${JSON.stringify(s)}`);
  }
}

// === 5. Multiple different secrets → correct count + deduped kinds =============
function multiSecret(): void {
  const blob = [
    `aws=${FAKE.aws_access_key}`,
    `gh=${FAKE.github_pat_classic}`,
    `oai=${FAKE.openai_key}`,
    `ant=${FAKE.anthropic_key}`,
  ].join(' and ');
  const r = redactSecrets(blob);
  assert(r.redactionCount === 4, `multi should count 4 (got ${r.redactionCount})`);
  const expectKinds = ['aws_access_key', 'github_pat', 'openai_key', 'anthropic_key'];
  for (const k of expectKinds) {
    assert(r.kinds.includes(k), `multi should include kind ${k} (got ${JSON.stringify(r.kinds)})`);
  }
  assert(r.kinds.length === expectKinds.length, `multi kinds should be deduped to ${expectKinds.length} (got ${JSON.stringify(r.kinds)})`);
  assert(!r.text.includes(FAKE.aws_access_key), 'multi output must not contain the aws key');
  assert(!r.text.includes(FAKE.openai_key), 'multi output must not contain the openai key');
}

// === 6. Same kind twice → counted twice, kind deduped ==========================
function sameKindTwice(): void {
  const blob = `first ${FAKE.openai_key} second sk-1111111111111111111111`;
  const r = redactSecrets(blob);
  assert(r.redactionCount === 2, `two openai keys should count 2 (got ${r.redactionCount})`);
  assert(r.kinds.length === 1 && r.kinds[0] === 'openai_key', `kind should dedupe to single openai_key (got ${JSON.stringify(r.kinds)})`);
}

// === 7. basic_auth_url masks password but keeps scheme/user/host ================
function basicAuthPreservesHost(): void {
  const r = redactSecrets(FAKE.basic_auth_url);
  assert(r.text.includes('example.com'), 'basic_auth should keep host example.com');
  assert(r.text.includes('https://alice:'), 'basic_auth should keep scheme + user');
  assert(r.text.includes('/path'), 'basic_auth should keep path');
  assert(!r.text.includes('FAKEpassword123'), 'basic_auth must remove the password');
  assert(r.text === `https://alice:${MASK}@example.com/path`, `basic_auth exact shape mismatch: ${r.text}`);
}

// === 8. Custom mask honored =====================================================
function customMask(): void {
  const r = redactSecrets(FAKE.openai_key, { mask: '***' });
  assert(r.text === '***', `custom mask should replace entire key with *** (got ${r.text})`);
  assert(!r.text.includes(MASK), 'custom mask output should not contain default mask');
  const r2 = redactSecrets(FAKE.basic_auth_url, { mask: 'X' });
  assert(r2.text === 'https://alice:X@example.com/path', `custom mask in basic_auth mismatch: ${r2.text}`);
}

// === 9. Bad / empty inputs → safe empty result ==================================
function badInputs(): void {
  const bads: unknown[] = [undefined, null, '', 123, {}, [], NaN, true];
  for (const b of bads) {
    const r = redactSecrets(b as unknown as string);
    assert(r.text === '', `bad input ${String(b)} → text ''`);
    assert(r.redactionCount === 0, `bad input ${String(b)} → count 0`);
    assert(Array.isArray(r.kinds) && r.kinds.length === 0, `bad input ${String(b)} → kinds []`);
    assert(containsSecret(b as unknown as string) === false, `containsSecret bad input ${String(b)} → false`);
  }
}

// === 9b. GitHub/Slack token-family coverage (security sweep regression) =========
function tokenFamilyCoverage(): void {
  for (const t of [
    'gho_000000000000000000000000000000000000',
    'ghu_000000000000000000000000000000000000',
    'ghs_000000000000000000000000000000000000',
    'ghr_000000000000000000000000000000000000',
  ]) {
    const r = redactSecrets('token ' + t + ' end');
    assert(r.redactionCount === 1 && r.kinds.includes('github_pat'), `github token family masked: ${t.slice(0, 4)}`);
    assert(!r.text.includes(t), `github token value removed: ${t.slice(0, 4)}`);
  }
  for (const t of [
    'xoxc-0000000000-0000000000-FAKEFAKEFAKE',
    'xoxd-0000000000-0000000000-FAKEFAKEFAKE',
    'xoxe-0000000000-0000000000-FAKEFAKEFAKE',
  ]) {
    const r = redactSecrets('token ' + t + ' end');
    assert(r.redactionCount === 1 && r.kinds.includes('slack_token'), `slack token family masked: ${t.slice(0, 5)}`);
    assert(!r.text.includes(t), `slack token value removed: ${t.slice(0, 5)}`);
  }
}

// === 10. SECRET_PATTERNS export shape ===========================================
function patternsExportShape(): void {
  assert(Array.isArray(SECRET_PATTERNS) && SECRET_PATTERNS.length >= 11, `SECRET_PATTERNS should be a non-trivial array (len=${SECRET_PATTERNS.length})`);
  const kinds = SECRET_PATTERNS.map((p) => p.kind);
  assert(new Set(kinds).size === kinds.length, 'SECRET_PATTERNS kinds should be unique');
  for (const p of SECRET_PATTERNS) {
    assert(typeof p.kind === 'string' && p.kind.length > 0, 'each pattern has a kind');
    assert(p.re instanceof RegExp, `pattern ${p.kind} has a RegExp`);
  }
  // anthropic must precede openai in ordering.
  const antIdx = kinds.indexOf('anthropic_key');
  const oaiIdx = kinds.indexOf('openai_key');
  assert(antIdx >= 0 && oaiIdx >= 0 && antIdx < oaiIdx, 'anthropic_key must be ordered before openai_key');
}

// === 11. Determinism — same input twice yields identical result =================
function determinism(): void {
  const blob = `${FAKE.jwt} ${FAKE.slack_token} ${FAKE.bearer}`;
  const a = redactSecrets(blob);
  const b = redactSecrets(blob);
  assert(a.text === b.text && a.redactionCount === b.redactionCount, 'redact should be deterministic across calls');
  assert(JSON.stringify(a.kinds) === JSON.stringify(b.kinds), 'kinds order should be stable across calls');
}

// === 12. Secret embedded in prose is masked but prose survives ==================
function secretInProse(): void {
  const s = `Hey team, the deploy token is ${FAKE.github_pat_classic} — please rotate it after use, thanks!`;
  const r = redactSecrets(s);
  assert(r.redactionCount === 1, `prose+secret should count 1 (got ${r.redactionCount})`);
  assert(r.text.startsWith('Hey team, the deploy token is '), 'prose prefix should survive');
  assert(r.text.includes('please rotate it after use'), 'prose suffix should survive');
  assert(!r.text.includes(FAKE.github_pat_classic), 'the pat must be gone');
}

console.log('secret-redaction-core smoke: running...');
eachPatternMasks();
kindAttribution();
antNotOpenai();
negativesUntouched();
multiSecret();
sameKindTwice();
basicAuthPreservesHost();
customMask();
badInputs();
patternsExportShape();
determinism();
secretInProse();
tokenFamilyCoverage();

console.log(`secret-redaction-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
