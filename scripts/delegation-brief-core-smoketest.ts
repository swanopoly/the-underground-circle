/**
 * delegation-brief-core-smoketest — the PURE outbound sub-agent brief builder
 * (src/lib/delegationBriefCore.ts). This is the OUTBOUND half of OpenSwan
 * delegation (parent → child), complementary to delegationGate's inbound
 * redaction (child → parent). Load-bearing behavior asserted here:
 *
 *   - extractBriefRole: spec.role / spec.subagent.role, lowercased + sanitized,
 *     '' for junk.
 *   - subtask clipped to MAX_SUBTASK_CHARS, falls back to parentMessage; headline
 *     ≤ MAX_HEADLINE_CHARS and is the first non-empty line.
 *   - selectRelevantContext: a coder subtask pulls the on-topic candidate lines
 *     and DROPS a zero-overlap line (minimal relevant slice, NOT a full dump);
 *     ≤ MAX_CONTEXT_LINES, each ≤ MAX_CONTEXT_LINE_CHARS, deduped, no-query
 *     fallback to first-N, object candidates read .text/.title/.content.
 *   - deriveSuccessCriteria: required checks first, labels rendered + deduped,
 *     ≤ MAX_CRITERIA; empty/malformed verification → [].
 *   - deriveBoundaries: sibling roles fenced with their focus, this-role excluded,
 *     deduped by role, generic scope fence always last, ≤ MAX_BOUNDARIES.
 *   - buildReturnContract: the ~<budget> summary-only line, a role-flavored line
 *     that differs for coder vs reviewer vs default, ≤ MAX_RETURN_LINES.
 *   - assembleDelegationBrief: a build fan-out yields all five sections; a huge
 *     parentMessage flips meta.truncated and text stays ≤ MAX_BRIEF_CHARS.
 *   - DETERMINISM: identical input twice → identical JSON.
 *   - HOSTILE: null/undefined/number/{}/[]/NaN/bigint/huge/control-chars/cyclic/
 *     throwing-proxy/__proto__/constructor keys never throw and yield safe,
 *     bounded, code-point-clean output (no split surrogates, no pollution).
 *
 * Pure — loads under tsx (delegationBriefCore has zero imports).
 * Run: npx tsx scripts/delegation-brief-core-smoketest.ts
 */

import {
  extractBriefRole,
  selectRelevantContext,
  deriveSuccessCriteria,
  deriveBoundaries,
  buildReturnContract,
  assembleDelegationBrief,
  MAX_SUBTASK_CHARS,
  MAX_HEADLINE_CHARS,
  MAX_CONTEXT_LINES,
  MAX_CONTEXT_LINE_CHARS,
  MAX_CRITERIA,
  MAX_BOUNDARIES,
  MAX_RETURN_LINES,
  MAX_BRIEF_CHARS,
  DEFAULT_RETURN_BUDGET_CHARS,
  type DelegationBrief,
} from '../src/lib/delegationBriefCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertLE(a: number, b: number, m: string): void {
  assert(typeof a === 'number' && a <= b, m, 'got ' + a + ' want <= ' + b);
}
function assertIncludes(hay: unknown, needle: string, m: string): void {
  assert(typeof hay === 'string' && hay.includes(needle), m, JSON.stringify(hay) + ' missing "' + needle + '"');
}
function assertNoThrow(fn: () => void, m: string): void {
  let threw = false;
  let err = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    err = String(e);
  }
  assert(!threw, m, err);
}

// ── code-point + control-char helpers ────────────────────────────────────────
const cpLen = (s: string): number => Array.from(s).length;

/** No control / DEL / C1 / line-separator chars at all (single-line strings). */
function noControlChars(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return false;
  }
  return true;
}
/** As above but permits '\n' (0x0a) — for the multi-line subtask / brief text. */
function noBadControlChars(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c === 0x0a) continue;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return false;
  }
  return true;
}
/** True if the string ends up with a split/lone surrogate anywhere. */
function hasLoneSurrogate(s: string): boolean {
  for (const ch of Array.from(s)) {
    if (ch.length === 1) {
      const c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
  }
  return false;
}

/** Structural + bounds check for a DelegationBrief (used across groups). */
function wellFormedBrief(b: DelegationBrief): boolean {
  return (
    !!b &&
    typeof b === 'object' &&
    typeof b.role === 'string' &&
    typeof b.headline === 'string' &&
    cpLen(b.headline) <= MAX_HEADLINE_CHARS &&
    noControlChars(b.headline) &&
    typeof b.subtask === 'string' &&
    cpLen(b.subtask) <= MAX_SUBTASK_CHARS &&
    noBadControlChars(b.subtask) &&
    Array.isArray(b.contextSlice) &&
    b.contextSlice.length <= MAX_CONTEXT_LINES &&
    b.contextSlice.every((l) => typeof l === 'string' && cpLen(l) <= MAX_CONTEXT_LINE_CHARS && noControlChars(l)) &&
    Array.isArray(b.successCriteria) &&
    b.successCriteria.length <= MAX_CRITERIA &&
    b.successCriteria.every((l) => typeof l === 'string' && noControlChars(l)) &&
    Array.isArray(b.boundaries) &&
    b.boundaries.length <= MAX_BOUNDARIES &&
    b.boundaries.every((l) => typeof l === 'string' && noControlChars(l)) &&
    Array.isArray(b.returnContract) &&
    b.returnContract.length <= MAX_RETURN_LINES &&
    b.returnContract.every((l) => typeof l === 'string' && noControlChars(l)) &&
    typeof b.text === 'string' &&
    cpLen(b.text) <= MAX_BRIEF_CHARS &&
    noBadControlChars(b.text) &&
    !hasLoneSurrogate(b.text) &&
    !!b.meta &&
    typeof b.meta.contextLineCount === 'number' &&
    typeof b.meta.criteriaCount === 'number' &&
    typeof b.meta.boundaryCount === 'number' &&
    typeof b.meta.truncated === 'boolean' &&
    typeof b.meta.chars === 'number' &&
    b.meta.chars === cpLen(b.text)
  );
}

// ── shared fixtures ──────────────────────────────────────────────────────────
const nested = (role: string, task?: string, displayName?: string) => ({
  subagent: displayName ? { role, displayName } : { role },
  task,
  reason: 'because ' + role,
});
const buildPlan = (n: number, allRequired = true) => ({
  kind: 'build',
  verification: Array.from({ length: n }, (_, i) => ({
    id: 'check' + i,
    label: 'Verification requirement number ' + i + ' that must pass before handoff',
    kind: 'tests',
    required: allRequired ? true : i % 2 === 0,
    reason: 'reason ' + i,
  })),
});

function main(): void {
  // ─── (1) extractBriefRole ──────────────────────────────────────────────────
  assertEq(extractBriefRole({ role: 'coder' }), 'coder', '(1) role from spec.role');
  assertEq(extractBriefRole({ subagent: { role: 'architect' } }), 'architect', '(1) role from spec.subagent.role');
  assertEq(extractBriefRole({ role: 'CoDeR' }), 'coder', '(1) role lowercased');
  assertEq(extractBriefRole({ role: '  Reviewer  ' }), 'reviewer', '(1) role trimmed');
  assertEq(extractBriefRole({ role: '' }), '', '(1) empty role → ""');
  assertEq(extractBriefRole({ role: '   ' }), '', '(1) whitespace role → ""');
  assertEq(extractBriefRole({}), '', '(1) no role → ""');
  assertEq(extractBriefRole(null), '', '(1) null → ""');
  assertEq(extractBriefRole('coder'), '', '(1) string spec (not object) → ""');
  assertEq(extractBriefRole({ role: 42 }), '', '(1) numeric role → ""');
  assertEq(extractBriefRole({ subagent: { role: 5 } }), '', '(1) numeric nested role → ""');
  assert(typeof extractBriefRole(undefined) === 'string', '(1) always returns a string');

  // ─── (2) subtask + headline ────────────────────────────────────────────────
  const b2 = assembleDelegationBrief({
    parentMessage: 'ignored when spec.task present',
    spec: { subagent: { role: 'coder' }, task: 'First line is the headline\nsecond line detail\nthird line' },
  });
  assertIncludes(b2.subtask, 'First line is the headline', '(2) subtask uses spec.task');
  assertEq(b2.headline, 'First line is the headline', '(2) headline is the first non-empty line');
  assertLE(cpLen(b2.headline), MAX_HEADLINE_CHARS, '(2) headline bounded');

  const b2b = assembleDelegationBrief({ parentMessage: 'fallback parent message here', spec: { role: 'coder' } });
  assertIncludes(b2b.subtask, 'fallback parent message here', '(2) subtask falls back to parentMessage when spec.task empty');

  const longMsg = 'x'.repeat(100_000);
  const b2c = assembleDelegationBrief({ parentMessage: longMsg, spec: { role: 'coder' } });
  assertLE(cpLen(b2c.subtask), MAX_SUBTASK_CHARS, '(2) huge subtask clipped to MAX_SUBTASK_CHARS');
  assertLE(cpLen(b2c.headline), MAX_HEADLINE_CHARS, '(2) headline still bounded on huge input');

  // headline first-non-empty-line skips leading blank lines
  const b2d = assembleDelegationBrief({ spec: { role: 'coder', task: '\n\n   \nActual headline\nmore' } });
  assertEq(b2d.headline, 'Actual headline', '(2) headline skips leading blank lines');

  // astral subtask clip: no split surrogate, code-point bounded
  const astralSub = assembleDelegationBrief({ spec: { role: 'coder', task: '😀'.repeat(5000) } });
  assertLE(cpLen(astralSub.subtask), MAX_SUBTASK_CHARS, '(2) astral subtask code-point bounded');
  assert(!hasLoneSurrogate(astralSub.subtask), '(2) astral subtask has no split surrogate');

  // ─── (3) selectRelevantContext ─────────────────────────────────────────────
  const cand = [
    'Stripe webhook signature verification lives in verifyStripeSignature',
    'the weather is nice today and the sun is out', // zero overlap
    'The billing webhook endpoint validates the Stripe signature header',
    'a completely unrelated cooking recipe for pasta', // zero overlap
  ];
  const slice = selectRelevantContext('fix the Stripe webhook signature check', 'coder', cand);
  assert(slice.length >= 1, '(3) relevant lines are kept');
  assertLE(slice.length, MAX_CONTEXT_LINES, '(3) slice ≤ MAX_CONTEXT_LINES');
  assert(slice.some((l) => l.includes('verifyStripeSignature') || l.includes('signature header')), '(3) on-topic webhook/stripe line kept');
  assert(!slice.some((l) => l.includes('weather')), '(3) zero-overlap "weather" line DROPPED (minimal slice, not full dump)');
  assert(!slice.some((l) => l.includes('cooking')), '(3) zero-overlap "cooking" line DROPPED');
  slice.forEach((l, i) => assertLE(cpLen(l), MAX_CONTEXT_LINE_CHARS, '(3) context line ' + i + ' ≤ line cap'));

  // dedupe of duplicate candidates
  const dupSlice = selectRelevantContext('stripe webhook', 'coder', [
    'Stripe webhook handler',
    'Stripe webhook handler',
    'stripe  WEBHOOK   handler', // normalizes to same
  ]);
  assertEq(dupSlice.length, 1, '(3) duplicate candidate lines deduped to one');

  // no-query-token subtask → first-N chronological fallback
  const noQuery = selectRelevantContext('', '', ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five', 'zeta six', 'eta seven']);
  assertEq(noQuery.length, MAX_CONTEXT_LINES, '(3) no-query fallback returns first-N');
  assertEq(noQuery[0], 'alpha one', '(3) no-query fallback is chronological (first candidate first)');
  assertEq(noQuery[5], 'zeta six', '(3) no-query fallback keeps chronological order');

  // object candidates read .text / .title / .content
  const objSlice = selectRelevantContext('stripe payment', 'coder', [
    { text: 'stripe payment intent via text field' },
    { title: 'stripe payment title field' },
    { content: 'stripe payment content field' },
    { nothing: 'no recognized key so stripe payment ignored' },
  ]);
  assert(objSlice.some((l) => l.includes('text field')), '(3) object candidate .text read');
  assert(objSlice.some((l) => l.includes('title field')), '(3) object candidate .title read');
  assert(objSlice.some((l) => l.includes('content field')), '(3) object candidate .content read');
  assert(!objSlice.some((l) => l.includes('no recognized key')), '(3) unrecognized-key object yields no text');

  // astral candidate line: kept via tokens, clipped code-point-safe
  const astralSlice = selectRelevantContext('stripe webhook', 'coder', ['stripe webhook ' + '😀'.repeat(1000)]);
  assertEq(astralSlice.length, 1, '(3) astral candidate with matching tokens kept');
  assertLE(cpLen(astralSlice[0]), MAX_CONTEXT_LINE_CHARS, '(3) astral line clipped to code-point cap');
  assert(!hasLoneSurrogate(astralSlice[0]), '(3) astral line has no split surrogate');

  // scores rank: line matching more query tokens ranks first
  const ranked = selectRelevantContext('stripe webhook signature invoice', 'coder', [
    'invoice only mention',
    'stripe webhook signature invoice all four',
  ]);
  assertEq(ranked[0], 'stripe webhook signature invoice all four', '(3) higher-overlap line ranks first');

  // ─── (4) deriveSuccessCriteria ─────────────────────────────────────────────
  const crit = deriveSuccessCriteria({
    kind: 'build',
    verification: [
      { id: 'lint', label: 'Optional lint pass', required: false },
      { id: 'typecheck', label: 'Typecheck changed code', required: true },
      { id: 'tests', label: 'Run the test suite', required: true },
    ],
  });
  assertEq(crit[0], 'Typecheck changed code', '(4) required criteria come first');
  assertEq(crit[1], 'Run the test suite', '(4) required criteria stable within group');
  assertEq(crit[2], 'Optional lint pass', '(4) optional criteria come after required');
  assertLE(crit.length, MAX_CRITERIA, '(4) criteria ≤ MAX_CRITERIA');

  assertEq(deriveSuccessCriteria({ kind: 'build', verification: [] }).length, 0, '(4) empty verification → []');
  assertEq(deriveSuccessCriteria({ kind: 'build' }).length, 0, '(4) missing verification → []');
  assertEq(deriveSuccessCriteria(null).length, 0, '(4) null taskPlan → []');
  assertEq(deriveSuccessCriteria({ verification: 'nope' as unknown }).length, 0, '(4) non-array verification → []');

  // dedupe by normalized label
  const dupCrit = deriveSuccessCriteria({
    verification: [
      { label: 'Run tests', required: true },
      { label: 'run   TESTS', required: true },
      { label: 'Another check', required: true },
    ],
  });
  assertEq(dupCrit.length, 2, '(4) duplicate labels deduped');

  // cap at MAX_CRITERIA even with more checks
  const manyCrit = deriveSuccessCriteria(buildPlan(20));
  assertEq(manyCrit.length, MAX_CRITERIA, '(4) many checks capped at MAX_CRITERIA');
  manyCrit.forEach((l, i) => assert(noControlChars(l), '(4) criterion ' + i + ' control-clean'));

  // string verification entries coerce to labels
  const strCrit = deriveSuccessCriteria({ verification: ['plain string check', 'second one'] });
  assertEq(strCrit.length, 2, '(4) string verification entries become labels');

  // ─── (5) deriveBoundaries ──────────────────────────────────────────────────
  const bnd = deriveBoundaries('coder', [
    nested('architect', 'design the module boundaries'),
    nested('tester', 'write integration tests'),
    nested('coder', 'this same role must be excluded'),
    nested('architect', 'duplicate architect role'),
  ]);
  assert(bnd.some((l) => l.includes('architect') && l.includes('module boundaries')), '(5) sibling fenced with its focus');
  assert(bnd.some((l) => l.includes('tester') && l.includes('integration tests')), '(5) second sibling fenced');
  assert(!bnd.some((l) => l.includes('same role must be excluded')), '(5) this-role sibling excluded');
  assertEq(bnd.filter((l) => l.startsWith('architect owns')).length, 1, '(5) sibling roles deduped');
  assertEq(bnd[bnd.length - 1], "Stay within this subtask; don't expand scope beyond what's stated above.", '(5) generic scope fence is always last');
  assertLE(bnd.length, MAX_BOUNDARIES, '(5) boundaries ≤ MAX_BOUNDARIES');
  bnd.forEach((l, i) => assert(noControlChars(l), '(5) boundary ' + i + ' control-clean'));

  // displayName preferred over role
  const bndDisplay = deriveBoundaries('coder', [nested('security', 'harden the login', 'Security Auditor')]);
  assert(bndDisplay.some((l) => l.startsWith('Security Auditor owns')), '(5) displayName used when present');

  // no siblings → only the generic fence
  const bndNone = deriveBoundaries('coder', []);
  assertEq(bndNone.length, 1, '(5) no siblings → just the fence');
  assertEq(bndNone[0], "Stay within this subtask; don't expand scope beyond what's stated above.", '(5) lone entry is the fence');

  // many siblings: capped, fence still last (siblings truncated first)
  const manySib = deriveBoundaries('coder', Array.from({ length: 20 }, (_, i) => nested('role' + i, 'task ' + i)));
  assertEq(manySib.length, MAX_BOUNDARIES, '(5) many siblings capped to MAX_BOUNDARIES');
  assertEq(manySib[manySib.length - 1], "Stay within this subtask; don't expand scope beyond what's stated above.", '(5) fence survives truncation (reserved slot)');

  // empty-role siblings skipped
  const bndEmpty = deriveBoundaries('coder', [{ task: 'no role here' }, nested('tester', 'real work')]);
  assert(bndEmpty.some((l) => l.startsWith('tester owns')), '(5) real sibling kept');
  assert(!bndEmpty.some((l) => l.includes('no role here')), '(5) role-less sibling skipped');

  // cap=1 → only the fence (no room for siblings)
  const bndCap1 = deriveBoundaries('coder', [nested('tester', 'work')], 1);
  assertEq(bndCap1.length, 1, '(5) cap 1 → only the fence');

  // sibling with no task/reason still fences gracefully
  const bndNoFocus = deriveBoundaries('coder', [{ subagent: { role: 'planner' } }]);
  assert(bndNoFocus.some((l) => l.startsWith('planner owns')), '(5) focus-less sibling still fenced');

  // ─── (6) buildReturnContract ───────────────────────────────────────────────
  const rcCoder = buildReturnContract('coder');
  const rcReviewer = buildReturnContract('reviewer');
  const rcDefault = buildReturnContract('totally-unknown-role');
  assertLE(rcCoder.length, MAX_RETURN_LINES, '(6) return contract ≤ MAX_RETURN_LINES');
  assertIncludes(rcCoder[0], '~' + DEFAULT_RETURN_BUDGET_CHARS, '(6) summary line names the default ~1200 budget');
  assertIncludes(rcCoder[0], 'forwarded to the parent', '(6) summary line explains only a prefix is forwarded');
  assert(rcCoder[2] !== rcReviewer[2], '(6) role-flavored line differs coder vs reviewer');
  assert(rcCoder[2] !== rcDefault[2], '(6) role-flavored line differs coder vs default');
  assert(rcReviewer[2] !== rcDefault[2], '(6) role-flavored line differs reviewer vs default');
  assertIncludes(rcCoder[2], 'files', '(6) coder hint mentions files');
  assertIncludes(rcReviewer[2], 'severity', '(6) reviewer hint mentions severity');
  rcCoder.forEach((l, i) => assert(noControlChars(l) && l.length > 0, '(6) return line ' + i + ' clean + non-empty'));

  // custom budget reflected
  const rcBudget = buildReturnContract('coder', 800);
  assertIncludes(rcBudget[0], '~800', '(6) custom budget reflected in the summary line');
  // junk budget → default
  assertIncludes(buildReturnContract('coder', NaN as unknown as number)[0], '~' + DEFAULT_RETURN_BUDGET_CHARS, '(6) NaN budget → default');

  // __proto__ / constructor as role fall to the default hint (guarded lookup)
  assertEq(buildReturnContract('__proto__')[2], rcDefault[2], '(6) __proto__ role → default hint (no prototype hit)');
  assertEq(buildReturnContract('constructor')[2], rcDefault[2], '(6) constructor role → default hint (guarded)');

  // ─── (7) assembleDelegationBrief — full fan-out + truncation ────────────────
  const fanout = assembleDelegationBrief({
    parentMessage: 'Build the billing subscription page',
    spec: nested('coder', 'Implement the billing subscription UI component and wire it to the API'),
    taskPlan: buildPlan(3),
    siblingSpecs: [nested('architect', 'design boundaries'), nested('tester', 'write tests'), nested('reviewer', 'review the diff')],
    contextCandidates: ['The billing subscription component uses the API client', 'unrelated marketing copy about kittens'],
    returnBudgetChars: 1200,
  });
  assert(wellFormedBrief(fanout), '(7) fan-out brief is well-formed', JSON.stringify(fanout.meta));
  assertEq(fanout.role, 'coder', '(7) brief role is coder');
  assertIncludes(fanout.text, '## SUBTASK (coder)', '(7) text has SUBTASK section with role');
  assertIncludes(fanout.text, '## RELEVANT CONTEXT', '(7) text has RELEVANT CONTEXT section');
  assertIncludes(fanout.text, '## SUCCESS CRITERIA', '(7) text has SUCCESS CRITERIA section');
  assertIncludes(fanout.text, '## BOUNDARIES — DO NOT TOUCH', '(7) text has BOUNDARIES section');
  assertIncludes(fanout.text, '## RETURN', '(7) text has RETURN section');
  assert(fanout.boundaries.some((l) => l.includes('architect')), '(7) boundaries name architect sibling');
  assert(fanout.boundaries.some((l) => l.includes('tester')), '(7) boundaries name tester sibling');
  assert(fanout.boundaries.some((l) => l.includes('reviewer')), '(7) boundaries name reviewer sibling');
  assert(fanout.successCriteria.length >= 1 && fanout.successCriteria.length <= MAX_CRITERIA, '(7) criteria from verification present + bounded');
  assert(fanout.contextSlice.some((l) => l.includes('API client')), '(7) relevant context kept');
  assert(!fanout.contextSlice.some((l) => l.includes('kittens')), '(7) irrelevant context dropped');
  assertEq(fanout.meta.truncated, false, '(7) modest brief is not truncated');
  assertLE(cpLen(fanout.text), MAX_BRIEF_CHARS, '(7) brief text ≤ MAX_BRIEF_CHARS');

  // huge everything → truncation flips true, text stays exactly at the cap.
  // Every section is deliberately maxed: subtask 1200 + context 6×240 +
  // criteria 6×~200 + boundaries + return comfortably exceeds MAX_BRIEF_CHARS.
  const bigCand = Array.from({ length: 40 }, (_, i) =>
    'Stripe billing webhook subscription invoice module reference ' + i + ' ' + 'detailword '.repeat(30),
  );
  const longPlan = {
    kind: 'build',
    verification: Array.from({ length: 8 }, (_, i) => ({
      id: 'c' + i,
      label: 'Ensure verification requirement ' + i + ' passes completely before any handoff back to the parent agent ' + 'x'.repeat(200),
      kind: 'tests',
      required: true,
    })),
  };
  const huge = assembleDelegationBrief({
    parentMessage: ('Refactor the Stripe billing webhook subscription invoice module carefully and thoroughly. ').repeat(3000),
    spec: nested('coder', ''),
    taskPlan: longPlan,
    siblingSpecs: [nested('architect', 'a'), nested('tester', 'b'), nested('reviewer', 'c'), nested('planner', 'd'), nested('researcher', 'e')],
    contextCandidates: bigCand,
    returnBudgetChars: 1200,
  });
  assert(wellFormedBrief(huge), '(7) huge brief still well-formed', JSON.stringify(huge.meta));
  assertEq(huge.meta.truncated, true, '(7) huge brief flips meta.truncated=true');
  assertEq(cpLen(huge.text), MAX_BRIEF_CHARS, '(7) truncated text is exactly MAX_BRIEF_CHARS code points');
  assertLE(cpLen(huge.text), MAX_BRIEF_CHARS, '(7) truncated text never exceeds cap');
  assertEq(huge.meta.chars, cpLen(huge.text), '(7) meta.chars matches code-point length');
  assert(!hasLoneSurrogate(huge.text), '(7) truncated text has no split surrogate');

  // single-spec caller passes siblingSpecs:[] → boundaries just the fence
  const solo = assembleDelegationBrief({ spec: nested('coder', 'do the thing'), siblingSpecs: [], taskPlan: buildPlan(1) });
  assertEq(solo.boundaries.length, 1, '(7) single-spec caller → boundaries just the fence');
  assert(wellFormedBrief(solo), '(7) solo brief well-formed');

  // ─── (8) determinism ───────────────────────────────────────────────────────
  const detInput = {
    parentMessage: 'Build the dashboard',
    spec: nested('coder', 'Implement the dashboard widgets and charts'),
    taskPlan: buildPlan(4),
    siblingSpecs: [nested('architect', 'design'), nested('tester', 'test'), nested('reviewer', 'review')],
    contextCandidates: ['dashboard widget layout', 'chart rendering pipeline', 'unrelated text'],
    returnBudgetChars: 1200,
  };
  assertEq(JSON.stringify(assembleDelegationBrief(detInput)), JSON.stringify(assembleDelegationBrief(detInput)), '(8) assembleDelegationBrief deterministic');
  assertEq(
    JSON.stringify(selectRelevantContext('stripe webhook', 'coder', ['stripe webhook a', 'stripe b', 'c only'])),
    JSON.stringify(selectRelevantContext('stripe webhook', 'coder', ['stripe webhook a', 'stripe b', 'c only'])),
    '(8) selectRelevantContext deterministic',
  );
  assertEq(JSON.stringify(deriveBoundaries('coder', [nested('architect', 'x'), nested('tester', 'y')])), JSON.stringify(deriveBoundaries('coder', [nested('architect', 'x'), nested('tester', 'y')])), '(8) deriveBoundaries deterministic');
  assertEq(JSON.stringify(deriveSuccessCriteria(buildPlan(5))), JSON.stringify(deriveSuccessCriteria(buildPlan(5))), '(8) deriveSuccessCriteria deterministic');
  assertEq(JSON.stringify(buildReturnContract('coder')), JSON.stringify(buildReturnContract('coder')), '(8) buildReturnContract deterministic');

  // ─── (9) HOSTILE — never throws, always safe + bounded ─────────────────────
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const DEL = String.fromCharCode(0x7f);
  const ctrlStr = 'a' + NUL + BEL + LS + PS + DEL + 'b';
  const hugeStr = 'z'.repeat(200_000);

  // cyclic input
  const cyclic: Record<string, unknown> = { parentMessage: 'cyclic root', spec: { role: 'coder' } };
  cyclic.self = cyclic;
  (cyclic.spec as Record<string, unknown>).back = cyclic;

  // throwing proxy (all traps hostile)
  const throwingProxy = new Proxy(
    {},
    {
      get() {
        throw new Error('boom-get');
      },
      has() {
        throw new Error('boom-has');
      },
      ownKeys() {
        throw new Error('boom-keys');
      },
      getOwnPropertyDescriptor() {
        throw new Error('boom-desc');
      },
    },
  );

  // candidate object with a throwing getter on .text
  const throwingCandidate: Record<string, unknown> = {};
  Object.defineProperty(throwingCandidate, 'text', {
    get() {
      throw new Error('boom-text');
    },
    enumerable: true,
  });

  // control chars + __proto__ / constructor as role AND as candidate keys
  const protoRoleSpec = { role: '__proto__', task: 'ctor' + ctrlStr };
  const ctorRoleSpec = { role: 'constructor', task: 'x' };
  const protoKeyCandidate = JSON.parse('{"__proto__":{"polluted":true},"text":"safe text here"}');
  const ctorKeyCandidate = { constructor: 'evil', text: 'still safe text' };

  // Each entry: [fixed label, input] — the label (never String(value)) is used in messages.
  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['string', 'just a string'],
    ['empty-object', {}],
    ['array', []],
    ['boolean', true],
    ['bigint', 10n],
    ['symbol-field', { parentMessage: Symbol('s'), spec: { role: 'coder' } }],
    ['cyclic', cyclic],
    ['throwing-proxy-input', throwingProxy],
    ['throwing-proxy-spec', { parentMessage: 'p', spec: throwingProxy, siblingSpecs: [throwingProxy] }],
    ['throwing-candidate', { spec: { role: 'coder', task: 'stripe webhook' }, contextCandidates: [throwingCandidate] }],
    ['control-chars', { parentMessage: ctrlStr, spec: { role: 'coder' + ctrlStr, task: ctrlStr } }],
    ['huge-strings', { parentMessage: hugeStr, spec: { role: 'coder', task: hugeStr }, contextCandidates: [hugeStr, hugeStr] }],
    ['proto-role', { spec: protoRoleSpec }],
    ['ctor-role', { spec: ctorRoleSpec }],
    ['proto-key-candidate', { spec: { role: 'coder', task: 'safe' }, contextCandidates: [protoKeyCandidate] }],
    ['ctor-key-candidate', { spec: { role: 'coder', task: 'still' }, contextCandidates: [ctorKeyCandidate] }],
    ['nested-null-siblings', { spec: { role: 'coder', task: 'x' }, siblingSpecs: [null, undefined, 5, { subagent: null }, { subagent: { role: 5 } }, nested('tester', 't')] }],
    ['wrong-type-fields', { parentMessage: {}, spec: [], taskPlan: 'nope', siblingSpecs: 'not-array', contextCandidates: 12345, returnBudgetChars: 'big' }],
    ['plan-junk-verification', { spec: { role: 'coder', task: 'x' }, taskPlan: { verification: [null, undefined, 5, {}, { label: 42 }, { required: 'yes', label: 'ok' }] } }],
    ['5000-candidates', { spec: { role: 'coder', task: 'stripe webhook' }, contextCandidates: Array.from({ length: 5000 }, (_, i) => 'stripe webhook line ' + i) }],
    ['5000-siblings', { spec: { role: 'coder', task: 'x' }, siblingSpecs: Array.from({ length: 5000 }, (_, i) => nested('role' + i, 'task ' + i)) }],
    ['array-message', { parentMessage: ['a', 'b'], spec: { role: 'coder' } }],
  ];

  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const brief = assembleDelegationBrief(input as never);
      assert(wellFormedBrief(brief), '(9) ' + label + ' → well-formed brief', JSON.stringify(brief && brief.meta));
    }, '(9) assembleDelegationBrief never throws :: ' + label);
  }

  // direct helper hostility (each export independently total). Read fields off
  // the input with a guarded getter so the TEST harness itself can't throw on a
  // hostile-proxy input before the core function is even called.
  const safeGet = (o: unknown, key: string): unknown => {
    try {
      return o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined;
    } catch {
      return undefined;
    }
  };
  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const r1 = extractBriefRole(safeGet(input, 'spec') ?? input);
      assert(typeof r1 === 'string', '(9) extractBriefRole → string :: ' + label);
      const r2 = selectRelevantContext('stripe webhook', 'coder', safeGet(input, 'contextCandidates') as never, MAX_CONTEXT_LINES);
      assert(Array.isArray(r2) && r2.length <= MAX_CONTEXT_LINES && r2.every((l) => typeof l === 'string' && cpLen(l) <= MAX_CONTEXT_LINE_CHARS && noControlChars(l)), '(9) selectRelevantContext → bounded clean array :: ' + label);
      const r3 = deriveSuccessCriteria(safeGet(input, 'taskPlan'));
      assert(Array.isArray(r3) && r3.length <= MAX_CRITERIA && r3.every((l) => typeof l === 'string' && noControlChars(l)), '(9) deriveSuccessCriteria → bounded clean array :: ' + label);
      const r4 = deriveBoundaries('coder', safeGet(input, 'siblingSpecs') as never);
      assert(Array.isArray(r4) && r4.length <= MAX_BOUNDARIES && r4.every((l) => typeof l === 'string' && noControlChars(l)), '(9) deriveBoundaries → bounded clean array :: ' + label);
      const r5 = buildReturnContract('coder');
      assert(Array.isArray(r5) && r5.length <= MAX_RETURN_LINES, '(9) buildReturnContract → bounded array :: ' + label);
    }, '(9) helpers never throw :: ' + label);
  }

  // control chars are actually stripped from rendered output
  const ctrlBrief = assembleDelegationBrief({ spec: { role: 'coder', task: 'clean' + ctrlStr + 'task' }, contextCandidates: ['ctx' + ctrlStr + 'clean stripe webhook'] });
  assert(noBadControlChars(ctrlBrief.text), '(9) rendered text has no forbidden control chars');
  assert(noBadControlChars(ctrlBrief.subtask), '(9) subtask has no forbidden control chars');
  assert(!ctrlBrief.subtask.includes(NUL) && !ctrlBrief.subtask.includes(LS) && !ctrlBrief.subtask.includes(PS), '(9) NUL/LS/PS stripped from subtask');

  // no prototype pollution occurred from __proto__ / constructor keys+roles
  assert(({} as Record<string, unknown>).polluted === undefined, '(9) no Object.prototype pollution (polluted)');
  assert((Object.prototype as Record<string, unknown>).polluted === undefined, '(9) Object.prototype untouched');
  const freshBrief = assembleDelegationBrief({ spec: { role: '__proto__', task: 'x' }, contextCandidates: [protoKeyCandidate] });
  assert(wellFormedBrief(freshBrief), '(9) __proto__ role + proto-key candidate → well-formed');

  // ─── (10) REGRESSION: surrogate pair split at clipText's UTF-16 pre-slice ────
  // clipText pre-slices raw by UTF-16 code UNITS before sanitizing. An odd-length
  // run of single-unit chars (spaces) before an astral emoji lands that slice
  // mid-surrogate-pair; the surviving lone HIGH surrogate must NOT leak into
  // subtask/headline/text (regression: brief.subtask was === '\uD83D'). Astral
  // input is built from its code point — never a raw astral char in source.
  const regEmoji = String.fromCodePoint(0x1f600); // U+1F600, i.e. surrogate pair D83D DE00 (2 UTF-16 units)
  const regBrief = assembleDelegationBrief({ spec: { role: 'coder', task: ' '.repeat(4863) + regEmoji } });
  assert(
    !hasLoneSurrogate(regBrief.subtask) && !hasLoneSurrogate(regBrief.headline) && !hasLoneSurrogate(regBrief.text),
    '(10) pre-slice surrogate split leaks no lone surrogate into subtask/headline/text',
  );
  assert(wellFormedBrief(regBrief), '(10) split-boundary brief still well-formed');
  // selectRelevantContext shares clipText — the 240-cap boundary must not leak either.
  const regSlice = selectRelevantContext('', '', [' '.repeat(1023) + regEmoji]);
  assert(!regSlice.some((l) => hasLoneSurrogate(l)), '(10) context-slice pre-slice boundary has no lone surrogate');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll delegation-brief-core smoke cases passed (' + passes + ' passed).');
}

main();
