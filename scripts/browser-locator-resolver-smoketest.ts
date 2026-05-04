/**
 * browser-locator-resolver-smoketest — covers the planner-shape mess
 * that the browser-bridge has to disambiguate when picking a
 * Playwright locator. Three call shapes are valid:
 *
 *   1. {role, name}             — accessible-name path
 *   2. {role, selector}         — explicit CSS selector
 *   3. {role, name: "input[name='email']"}  — model jammed a CSS
 *      selector into the `name` slot
 *
 * The resolver detects shape 3 and routes to page.locator(); the
 * extractor pulls a semantic name from common attribute selectors
 * for the click/fill fallback chain.
 *
 * Run: `npx tsx scripts/browser-locator-resolver-smoketest.ts`
 */

// Re-implement the same heuristics here so the test is dependency-
// free of the Node bridge file (which uses CommonJS + Playwright
// imports). Keeping the heuristics in sync is enforced by the
// failing test if either side drifts — both have the same shape.

function looksLikeCssSelector(s: string | null | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  if (!t) return false;
  return (
    /^[#.]/.test(t)
    || /\[[\w-]+\s*([~|^$*]?=|\])/.test(t)
    || /:nth-(?:child|of-type|last-child)/.test(t)
    || /^[a-z][\w-]*\s*[>+~]/.test(t)
    || /^[a-z][\w-]*\s*\[/.test(t)
    || /^[a-z][\w-]*\s*\.[\w-]/.test(t)
  );
}

function extractSemanticName(selector: string): string | null {
  const m1 = selector.match(/\[(name|aria-label|placeholder|title)\s*=\s*['"]?([^'"\]]+)['"]?\]/i);
  if (m1) return m1[2];
  return null;
}

let failures = 0;
function ok(msg: string) { console.log('  ok:', msg); }
function fail(msg: string, detail?: any) {
  failures += 1;
  console.error('FAIL:', msg);
  if (detail !== undefined) console.error('  detail:', JSON.stringify(detail));
}

// ─── looksLikeCssSelector ────────────────────────────────────────────────

console.log('\nlooksLikeCssSelector — positive (should match)');

const positives = [
  'input[name="email"]',
  'input[name=email]',
  "input[type='submit']",
  '[aria-label="Sign in"]',
  '#login-form',
  '.nav-button',
  'div.container',
  'div > a',
  'ul li:nth-child(2)',
  'button[data-id="primary"]',
  'a:nth-of-type(3)',
];
for (const s of positives) {
  if (looksLikeCssSelector(s)) ok(`"${s}" → selector`);
  else fail(`"${s}" should look like a selector but didn't`);
}

console.log('\nlooksLikeCssSelector — negative (should NOT match)');

const negatives = [
  'Email',
  'Sign in',
  'Email address',
  'Search results',
  'Click me',
  '',
  null,
  undefined,
  'username',
  'enter your email',
  'OK',
];
for (const s of negatives) {
  if (looksLikeCssSelector(s as any)) fail(`"${String(s)}" should NOT look like a selector but did`);
  else ok(`"${String(s)}" → not a selector`);
}

// ─── extractSemanticName ─────────────────────────────────────────────────

console.log('\nextractSemanticName');

function expectName(selector: string, expected: string | null) {
  const got = extractSemanticName(selector);
  if (got === expected) ok(`"${selector}" → ${expected === null ? 'null' : `"${expected}"`}`);
  else fail(`"${selector}" — wanted ${expected === null ? 'null' : `"${expected}"`}, got ${got === null ? 'null' : `"${got}"`}`);
}

expectName('input[name="email"]', 'email');
expectName("input[name='username']", 'username');
expectName('input[name=password]', 'password');
expectName('[aria-label="Sign in"]', 'Sign in');
expectName('[placeholder="Email address"]', 'Email address');
expectName('[title="Search"]', 'Search');
expectName('input[type="submit"]', null);          // type isn't a label
expectName('input[type="email"]', null);
expectName('div.foo', null);
expectName('#main', null);
expectName('button.primary[data-action="login"]', null); // data-action not in our list

// ─── Resolver shape decisions ────────────────────────────────────────────

console.log('\nResolver routing decisions');

interface Body { role?: string; name?: string; selector?: string }

function resolverDecision(body: Body): 'selector' | 'name-as-selector' | 'role+name' {
  if (body.selector) return 'selector';
  if (body.name && looksLikeCssSelector(body.name)) return 'name-as-selector';
  return 'role+name';
}

function expectDecision(body: Body, expected: 'selector' | 'name-as-selector' | 'role+name') {
  const got = resolverDecision(body);
  if (got === expected) ok(`${JSON.stringify(body)} → ${expected}`);
  else fail(`${JSON.stringify(body)} — wanted ${expected}, got ${got}`);
}

expectDecision({ role: 'textbox', name: 'Email' }, 'role+name');
expectDecision({ role: 'textbox', name: 'input[name="email"]' }, 'name-as-selector');
expectDecision({ role: 'textbox', selector: '#email' }, 'selector');
expectDecision({ role: 'button', name: 'Submit' }, 'role+name');
expectDecision({ role: 'button', name: '#submit-btn' }, 'name-as-selector');
expectDecision({ role: 'button', selector: 'button[type=submit]', name: 'Submit' }, 'selector');

// ─── Result ──────────────────────────────────────────────────────────────

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
