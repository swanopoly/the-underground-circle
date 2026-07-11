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

  // Documented over-block (acceptable — fail safe): a benign "password reset"
  // phrase still trips the bare `password + <word>` branch. We prefer a false
  // refusal to a persisted secret. Pinned so the behavior is intentional.
  assert(
    looksLikeCredentialMemoryContent('we discussed the password reset flow') === true,
    'case7 (over-block, intentional): benign "password reset" phrase is refused (fail safe)',
  );

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

if (failures > 0) {
  console.error(`\n${failures} user-memory-caps smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll user-memory-caps smoke cases passed.');
