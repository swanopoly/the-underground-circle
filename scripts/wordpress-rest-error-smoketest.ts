/**
 * wordpress-rest-error-smoketest — offline guard for redactRestError, which
 * maps WP REST failures to short, safe messages and never echoes raw bodies
 * or credential fragments into chat / logs.
 *
 * Run: npm run smoke:wordpress-rest-error
 */

import { redactRestError } from '../src/lib/wordpressRestError';

let failures = 0;
function fail(m: string, detail?: string): void { failures += 1; console.error('FAIL:', m, detail ? `— ${detail}` : ''); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(name, detail);
}

// ── Known code mapping ────────────────────────────────────────────────────────
{
  const out = redactRestError('{"code":"rest_cannot_create","message":"Sorry, you are not allowed to create posts."}', 403);
  assert(out.includes('denied creating'), 'maps rest_cannot_create', out);
  assert(out.includes('HTTP 403'), 'keeps status', out);
}
{
  const out = redactRestError('{"code":"rest_post_invalid_id"}', 404);
  assert(out.includes('could not find'), 'maps rest_post_invalid_id', out);
}
{
  const out = redactRestError('{"code":"rest_not_logged_in"}', 401);
  assert(out.includes('unauthenticated'), 'maps rest_not_logged_in', out);
}

// ── codeHint takes precedence over body ─────────────────────────────────────────
{
  const out = redactRestError('garbage', 403, 'rest_forbidden');
  assert(out.includes('forbade'), 'codeHint used', out);
}

// ── Status fallback when no known code ──────────────────────────────────────────
{
  const out = redactRestError('some unknown text', 500);
  assert(out.includes('HTTP 500'), 'status fallback keeps status', out);
  assert(out.includes('server error'), 'status fallback message', out);
}

// ── Never echoes raw body when a mapping exists ──────────────────────────────────
{
  const raw = '<html><body>Fatal error: secret stack trace here</body></html>';
  const out = redactRestError(`{"code":"rest_forbidden"}${raw}`, 403);
  assert(!out.includes('secret stack trace'), 'mapped error does not leak raw body', out);
  assert(!out.includes('<html'), 'mapped error strips HTML', out);
}

// ── Credential fragments stripped on the unmapped path ──────────────────────────
{
  const body = 'Authorization: Basic dXNlcjphcHBwYXNzd29yZA== failed for app password aaaa bbbb cccc dddd eeee ffff';
  const out = redactRestError(body, 418); // 418 has no status mapping
  assert(!out.includes('dXNlcjphcHBwYXNzd29yZA=='), 'strips Basic auth token', out);
  assert(!/aaaa bbbb cccc dddd eeee ffff/.test(out), 'strips app-password-like sequence', out);
  assert(out.includes('[redacted]'), 'replaces with [redacted]', out);
}

// ── HTML stripped on the unmapped path ──────────────────────────────────────────
{
  const out = redactRestError('<script>alert(1)</script>oops', 418);
  assert(!out.includes('<script>'), 'strips script tag', out);
}

// ── Length cap ──────────────────────────────────────────────────────────────────
{
  const out = redactRestError('z'.repeat(1000), 418);
  assert(out.length < 250, 'output is capped', String(out.length));
}

// ── Empty body ────────────────────────────────────────────────────────────────
{
  const out = redactRestError('', 403);
  assert(out.includes('HTTP 403'), 'empty body still yields a message', out);
}

if (failures > 0) {
  console.error(`\n${failures} wordpress-rest-error smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wordpress-rest-error smoke cases passed.');
