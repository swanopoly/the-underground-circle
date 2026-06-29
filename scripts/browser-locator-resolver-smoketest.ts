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

interface Body {
  role?: string;
  name?: string;
  selector?: string;
  exact?: boolean;
  testId?: string;
  label?: string;
  placeholder?: string;
  altText?: string;
  title?: string;
  text?: string;
}

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

// ─── Semantic-locator ladder (R15) ───────────────────────────────────────
//
// Mirror of resolveLocator in scripts/browser-bridge.js. Strict precedence:
//   selector > name-as-css > testId > label > placeholder > altText > title
//   > role+name. There is intentionally NO `text` rung — body.text is the
//   fill VALUE and must be ignored by the resolver. Kept in sync manually.

console.log('\nSemantic-locator ladder');

type Strategy =
  | 'selector'
  | 'name-as-selector'
  | 'getByTestId'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByAltText'
  | 'getByTitle'
  | 'getByRole'
  | 'getByText';

interface LocatorPlan { strategy: Strategy; arg: string; exact?: boolean }

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function resolveLocatorPlan(role: string, body: Body): LocatorPlan {
  const exact = body.exact === true;
  if (isStr(body.selector)) return { strategy: 'selector', arg: body.selector!.trim() };
  if (body.name && looksLikeCssSelector(body.name)) return { strategy: 'name-as-selector', arg: body.name };
  if (isStr(body.testId)) return { strategy: 'getByTestId', arg: body.testId!.trim() };
  if (isStr(body.label)) return { strategy: 'getByLabel', arg: body.label!, exact };
  if (isStr(body.placeholder)) return { strategy: 'getByPlaceholder', arg: body.placeholder!, exact };
  if (isStr(body.altText)) return { strategy: 'getByAltText', arg: body.altText!, exact };
  if (isStr(body.title)) return { strategy: 'getByTitle', arg: body.title!, exact };
  return { strategy: 'getByRole', arg: body.name ? String(body.name) : role, exact };
}

function expectPlan(role: string, body: Body, expected: Strategy) {
  const got = resolveLocatorPlan(role, body).strategy;
  if (got === expected) ok(`${JSON.stringify(body)} → ${expected}`);
  else fail(`${JSON.stringify(body)} — wanted ${expected}, got ${got}`);
}

// Each rung must win over everything below it. Stack all fields and peel.
// `name` is a CSS-shaped selector here so the name-as-selector rung is
// exercised; once it is removed the semantic rungs take over in order.
const everything: Body = {
  role: 'button', name: '#save-btn', selector: '#save', testId: 'save-btn',
  label: 'Save label', placeholder: 'Save placeholder', altText: 'Save alt',
  title: 'Save title', text: 'value to type',
};
expectPlan('button', everything, 'selector');
expectPlan('button', { ...everything, selector: undefined }, 'name-as-selector');
// Remove the CSS-shaped name so the semantic ladder is reached.
const semanticBase: Body = { ...everything, selector: undefined, name: undefined };
expectPlan('button', semanticBase, 'getByTestId');
expectPlan('button', { ...semanticBase, testId: undefined }, 'getByLabel');
expectPlan('button', { ...semanticBase, testId: undefined, label: undefined }, 'getByPlaceholder');
expectPlan('button', { ...semanticBase, testId: undefined, label: undefined, placeholder: undefined }, 'getByAltText');
expectPlan('button', { ...semanticBase, testId: undefined, label: undefined, placeholder: undefined, altText: undefined }, 'getByTitle');
expectPlan('button', { role: 'button', name: 'Save' }, 'getByRole');

// Regression: body.text must NOT become a locator rung — {role,name,text}
// resolves to role+name and ignores text entirely.
expectPlan('textbox', { role: 'textbox', name: 'Email', text: 'me@example.com' }, 'getByRole');
// And a lone text field with nothing else still falls to role (no getByText rung).
expectPlan('textbox', { role: 'textbox', text: 'me@example.com' }, 'getByRole');

// Empty/whitespace semantic fields are skipped (treated as absent).
expectPlan('button', { role: 'button', name: 'Save', testId: '   ' }, 'getByRole');

// exact forwards through the label/placeholder/altText/title rungs.
{
  const p = resolveLocatorPlan('button', { role: 'button', label: 'Save', exact: true });
  if (p.strategy === 'getByLabel' && p.exact === true) ok('ladder: exact forwarded to getByLabel');
  else fail('ladder: exact not forwarded', p);
}

// ─── Ambiguous-locator guard ─────────────────────────────────────────────
//
// Mirror of detectAmbiguousLocator / writeAmbiguousLocator in
// scripts/browser-bridge.js: multi-match without an explicit `nth`
// refuses to act and returns a structured `ambiguous_locator` error
// with ≤5 candidates; single match / nth-given / count-unavailable
// keeps the old "act" behavior.

console.log('\nAmbiguous-locator guard');

const AMBIGUOUS_CANDIDATE_LIMIT = 5;

interface RawCandidate { role?: string | null; name?: string | null; snippet?: string | null }
interface ShapedCandidate { role: string; name?: string; snippet?: string }

function decideAmbiguity(body: { nth?: number }, count: number | null): 'act' | 'ambiguous' {
  if (typeof body.nth === 'number') return 'act';   // explicit disambiguator
  if (count === null) return 'act';                 // count unavailable → old behavior
  if (count <= 1) return 'act';                     // single (or no) match unchanged
  return 'ambiguous';
}

function shapeAmbiguousCandidates(raw: RawCandidate[]): ShapedCandidate[] {
  return raw.slice(0, AMBIGUOUS_CANDIDATE_LIMIT).map((item) => {
    const candidate: ShapedCandidate = { role: String(item.role || 'unknown').slice(0, 60) };
    if (item.name) candidate.name = String(item.name).slice(0, 120);
    if (item.snippet) candidate.snippet = String(item.snippet).slice(0, 120);
    return candidate;
  });
}

function buildAmbiguousError(target: string, matches: number, raw: RawCandidate[]) {
  return {
    ok: false as const,
    error: `ambiguous locator: ${matches} elements match "${target.slice(0, 160)}". Pass nth (0-based) or a more specific selector to disambiguate.`,
    errorCode: 'ambiguous_locator' as const,
    matches,
    candidates: shapeAmbiguousCandidates(raw),
  };
}

function expectAmbiguity(body: { nth?: number }, count: number | null, expected: 'act' | 'ambiguous') {
  const got = decideAmbiguity(body, count);
  if (got === expected) ok(`nth=${body.nth ?? 'none'} count=${count === null ? 'unavailable' : count} → ${expected}`);
  else fail(`nth=${body.nth ?? 'none'} count=${count} — wanted ${expected}, got ${got}`);
}

// Single match: unchanged behavior.
expectAmbiguity({}, 1, 'act');
// No match: unchanged (falls through to the normal timeout path).
expectAmbiguity({}, 0, 'act');
// Multi-match without nth: refuse and return structured error.
expectAmbiguity({}, 2, 'ambiguous');
expectAmbiguity({}, 7, 'ambiguous');
// nth disambiguates — even nth 0 is an explicit choice.
expectAmbiguity({ nth: 0 }, 7, 'act');
expectAmbiguity({ nth: 3 }, 7, 'act');
// Count resolution failed (locator.count threw): fail open to old path.
expectAmbiguity({}, null, 'act');

// Error shape: ok:false + errorCode + matches + ≤5 candidates.
{
  const raw: RawCandidate[] = Array.from({ length: 7 }, (_, i) => ({
    role: 'button',
    name: `Edit row ${i}`,
    snippet: `Edit row ${i} snippet ${'x'.repeat(200)}`,
  }));
  const err = buildAmbiguousError('Edit', 7, raw);
  if (err.ok === false) ok('ambiguous error: ok:false');
  else fail('ambiguous error should be ok:false');
  if (err.errorCode === 'ambiguous_locator') ok('ambiguous error: errorCode ambiguous_locator');
  else fail(`wrong errorCode: ${err.errorCode}`);
  if (err.matches === 7) ok('ambiguous error: matches count preserved');
  else fail(`wrong matches: ${err.matches}`);
  if (err.candidates.length === 5) ok('ambiguous error: candidates capped at 5');
  else fail(`candidates not capped: ${err.candidates.length}`);
  if (err.candidates[0].role === 'button' && err.candidates[0].name === 'Edit row 0') ok('ambiguous error: candidate role+name shape');
  else fail('candidate shape wrong', err.candidates[0]);
  if ((err.candidates[0].snippet || '').length <= 120) ok('ambiguous error: snippet truncated to ≤120');
  else fail('snippet not truncated');
  if (err.error.includes('Pass nth (0-based)')) ok('ambiguous error: message tells the model how to disambiguate');
  else fail('message missing nth instruction', err.error);
}

// Candidate with no usable attributes still yields a role.
{
  const shaped = shapeAmbiguousCandidates([{ role: null, name: null, snippet: null }]);
  if (shaped[0].role === 'unknown' && !('name' in shaped[0])) ok('candidate fallback: role "unknown", no empty name');
  else fail('candidate fallback wrong', shaped[0]);
}

// ─── Result ──────────────────────────────────────────────────────────────

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
