/**
 * verification-coverage-core-smoketest — the pure verification-coverage core
 * (src/lib/verificationCoverageCore.ts) behind the verification-opt v7 fix in
 * src/lib/openswanObservedEvals.ts. Load-bearing assertions:
 *
 *   AUTO-VERIFIABLE SET: typecheck/tests/lint/build/preview are machine-checkable
 *   and belong in the coverage denominator; the *_review kinds (manual_review,
 *   security_review, performance_review, integration_review) do NOT.
 *
 *   COVERAGE SCORING: coverageRatio = executed / auto-verifiable-planned. Manual
 *   checks are excluded from the denominator, so a run that ran every machine
 *   check scores 1.0 no matter how many manual checks were also planned. The
 *   ratio clamps to 0..1 (executed > planned → 1). fullyVerified is true only
 *   when >=1 auto check was planned and all of them ran.
 *
 *   ZERO GUARD: 0 auto-verifiable planned → coverageRatio 0, a LITERAL 0 (never
 *   NaN — a NaN would slip past a downstream `<= 0` guard).
 *
 *   And: every export is total — null/undefined/wrong/huge/hostile/cyclic input
 *   never throws.
 *
 * Pure — loads under tsx (verificationCoverageCore has zero imports).
 */

import {
  AUTO_VERIFIABLE_CHECK_KINDS,
  isAutoVerifiable,
  computeVerificationCoverage,
  type VerificationCoverageResult,
} from '../src/lib/verificationCoverageCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(actual === expected, msg, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

/** Shape guard: every computeVerificationCoverage result must satisfy this. */
function isValidResult(r: VerificationCoverageResult): boolean {
  return (
    !!r
    && typeof r === 'object'
    && typeof r.coverageRatio === 'number'
    && Number.isFinite(r.coverageRatio)
    && r.coverageRatio >= 0
    && r.coverageRatio <= 1
    && typeof r.autoVerifiablePlanned === 'number'
    && Number.isFinite(r.autoVerifiablePlanned)
    && r.autoVerifiablePlanned >= 0
    && Number.isInteger(r.autoVerifiablePlanned)
    && typeof r.fullyVerified === 'boolean'
  );
}

const check = (kind: string) => ({ label: `${kind} check`, kind, required: true });

function main(): void {
  // 1. AUTO_VERIFIABLE_CHECK_KINDS membership.
  assert(AUTO_VERIFIABLE_CHECK_KINDS instanceof Set, 'exported kinds is a Set');
  assert(AUTO_VERIFIABLE_CHECK_KINDS.has('typecheck'), 'typecheck is auto-verifiable');
  assert(AUTO_VERIFIABLE_CHECK_KINDS.has('tests'), 'tests is auto-verifiable');
  assert(AUTO_VERIFIABLE_CHECK_KINDS.has('lint'), 'lint is auto-verifiable');
  assert(AUTO_VERIFIABLE_CHECK_KINDS.has('build'), 'build is auto-verifiable');
  assert(AUTO_VERIFIABLE_CHECK_KINDS.has('preview'), 'preview is auto-verifiable');
  assertEq(AUTO_VERIFIABLE_CHECK_KINDS.size, 5, 'exactly 5 auto-verifiable kinds');
  assert(!AUTO_VERIFIABLE_CHECK_KINDS.has('manual_review'), 'manual_review excluded');
  assert(!AUTO_VERIFIABLE_CHECK_KINDS.has('security_review'), 'security_review excluded');
  assert(!AUTO_VERIFIABLE_CHECK_KINDS.has('performance_review'), 'performance_review excluded');
  assert(!AUTO_VERIFIABLE_CHECK_KINDS.has('integration_review'), 'integration_review excluded');

  // 2. isAutoVerifiable — the five machine kinds are true.
  assert(isAutoVerifiable('typecheck'), 'isAutoVerifiable(typecheck)');
  assert(isAutoVerifiable('tests'), 'isAutoVerifiable(tests)');
  assert(isAutoVerifiable('lint'), 'isAutoVerifiable(lint)');
  assert(isAutoVerifiable('build'), 'isAutoVerifiable(build)');
  assert(isAutoVerifiable('preview'), 'isAutoVerifiable(preview)');

  // 2b. isAutoVerifiable — manual kinds false.
  assert(!isAutoVerifiable('manual_review'), 'manual_review not auto');
  assert(!isAutoVerifiable('security_review'), 'security_review not auto');
  assert(!isAutoVerifiable('performance_review'), 'performance_review not auto');
  assert(!isAutoVerifiable('integration_review'), 'integration_review not auto');
  assert(!isAutoVerifiable('unknown_kind'), 'unknown kind not auto');
  assert(!isAutoVerifiable(''), 'empty string not auto');

  // 2c. isAutoVerifiable — case / whitespace normalization.
  assert(isAutoVerifiable('  TypeCheck  '), 'trims + lowercases TypeCheck');
  assert(isAutoVerifiable('TESTS'), 'uppercase TESTS normalized');
  assert(isAutoVerifiable('\tlint\n'), 'tab/newline padded lint normalized');
  assert(!isAutoVerifiable('type check'), 'space inside not normalized to typecheck');

  // 2d. isAutoVerifiable — hostile non-strings never true, never throw.
  assert(!isAutoVerifiable(null), 'null not auto');
  assert(!isAutoVerifiable(undefined), 'undefined not auto');
  assert(!isAutoVerifiable(42), 'number not auto');
  assert(!isAutoVerifiable({}), 'object not auto');
  assert(!isAutoVerifiable([]), 'array not auto');
  assert(!isAutoVerifiable(Symbol('typecheck')), 'symbol not auto');
  assert(!isAutoVerifiable(true), 'boolean not auto');

  // 3. Happy path — 2/2 auto executed → 1.0, fullyVerified.
  const r1 = computeVerificationCoverage({
    plannedChecks: [check('typecheck'), check('tests')],
    executedCount: 2,
  });
  assert(isValidResult(r1), 'r1 valid shape');
  assertEq(r1.coverageRatio, 1, '2/2 auto → coverageRatio 1.0');
  assertEq(r1.autoVerifiablePlanned, 2, '2 auto planned');
  assertEq(r1.fullyVerified, true, '2/2 fullyVerified');

  // 3b. Partial — 1/2 auto executed → 0.5, not fully verified.
  const r2 = computeVerificationCoverage({
    plannedChecks: [check('typecheck'), check('tests')],
    executedCount: 1,
  });
  assert(isValidResult(r2), 'r2 valid shape');
  assertEq(r2.coverageRatio, 0.5, '1/2 auto → 0.5');
  assertEq(r2.autoVerifiablePlanned, 2, 'still 2 auto planned');
  assertEq(r2.fullyVerified, false, '1/2 not fullyVerified');

  // 3c. Rounding to 2dp — 2/3 auto → 0.67.
  const r3 = computeVerificationCoverage({
    plannedChecks: [check('typecheck'), check('tests'), check('lint')],
    executedCount: 2,
  });
  assertEq(r3.coverageRatio, 0.67, '2/3 auto → 0.67 (2dp)');
  assertEq(r3.autoVerifiablePlanned, 3, '3 auto planned');
  assertEq(r3.fullyVerified, false, '2/3 not fullyVerified');

  // 4. Manual checks excluded from denominator — the core of the v7 fix.
  //    1 auto + 3 manual planned, the 1 auto executed → 1.0 fullyVerified.
  const r4 = computeVerificationCoverage({
    plannedChecks: [
      check('typecheck'),
      check('manual_review'),
      check('security_review'),
      check('integration_review'),
    ],
    executedCount: 1,
  });
  assertEq(r4.autoVerifiablePlanned, 1, 'manual checks not counted in denominator');
  assertEq(r4.coverageRatio, 1, '1/1 auto → 1.0 despite 3 manual planned');
  assertEq(r4.fullyVerified, true, 'all auto checks ran → fullyVerified');

  // 4b. Contrast with the OLD buggy behavior: executed/ALL-planned would be 1/4
  //     = 0.25. The new score must NOT be 0.25.
  assert(r4.coverageRatio !== 0.25, 'does not use all-planned denominator (would be 0.25)');

  // 4c. Mixed — 2 auto + 2 manual, both auto executed → 1.0.
  const r4c = computeVerificationCoverage({
    plannedChecks: [check('lint'), check('performance_review'), check('preview'), check('manual_review')],
    executedCount: 2,
  });
  assertEq(r4c.autoVerifiablePlanned, 2, '2 of 4 planned are auto');
  assertEq(r4c.coverageRatio, 1, '2/2 auto → 1.0');
  assertEq(r4c.fullyVerified, true, 'mixed plan fullyVerified when auto all ran');

  // 5. Explicit zero guard — 0 auto planned → literal 0, never NaN.
  const r5a = computeVerificationCoverage({ plannedChecks: [check('manual_review')], executedCount: 1 });
  assertEq(r5a.autoVerifiablePlanned, 0, 'all-manual plan → 0 auto');
  assertEq(r5a.coverageRatio, 0, 'all-manual plan → coverageRatio 0');
  assert(!Number.isNaN(r5a.coverageRatio), 'coverageRatio is not NaN (all-manual)');
  assertEq(r5a.fullyVerified, false, 'all-manual plan → not fullyVerified');

  const r5b = computeVerificationCoverage({ plannedChecks: [], executedCount: 5 });
  assertEq(r5b.autoVerifiablePlanned, 0, 'empty plan → 0 auto');
  assertEq(r5b.coverageRatio, 0, 'empty plan → 0');
  assert(!Number.isNaN(r5b.coverageRatio), 'empty plan ratio not NaN');

  // 5c. The critical 0/0 case — 0 auto planned AND 0 executed → 0 (not NaN).
  const r5c = computeVerificationCoverage({ plannedChecks: [], executedCount: 0 });
  assertEq(r5c.coverageRatio, 0, '0 executed / 0 planned → 0 not NaN');
  assert(!Number.isNaN(r5c.coverageRatio), '0/0 guard returns literal 0');
  assert(r5c.coverageRatio <= 0, 'literal 0 passes a downstream <= 0 guard');

  // 5d. NaN would have slipped a <= 0 guard — prove our value does not.
  assert(!(r5c.coverageRatio > 0), '0/0 result is falsy under > 0 checks');

  // 6. Clamp — executed > planned clamps to 1.
  const r6 = computeVerificationCoverage({ plannedChecks: [check('typecheck')], executedCount: 5 });
  assertEq(r6.autoVerifiablePlanned, 1, '1 auto planned');
  assertEq(r6.coverageRatio, 1, 'executed 5 > planned 1 clamps to 1.0');
  assertEq(r6.fullyVerified, true, 'over-execution still fullyVerified');

  // 6b. Negative / zero executed → 0 ratio, not fully verified.
  const r6b = computeVerificationCoverage({ plannedChecks: [check('tests'), check('lint')], executedCount: 0 });
  assertEq(r6b.coverageRatio, 0, '0 executed → 0 ratio');
  assertEq(r6b.fullyVerified, false, '0 executed → not fullyVerified');
  const r6c = computeVerificationCoverage({ plannedChecks: [check('tests')], executedCount: -10 });
  assertEq(r6c.coverageRatio, 0, 'negative executed coerced to 0');
  assertEq(r6c.fullyVerified, false, 'negative executed → not fullyVerified');

  // 6d. Fractional executed floors before scoring — 1.9 → 1 of 2 auto → 0.5.
  const r6d = computeVerificationCoverage({ plannedChecks: [check('typecheck'), check('tests')], executedCount: 1.9 });
  assertEq(r6d.coverageRatio, 0.5, 'fractional executed floors to 1 → 0.5');
  assertEq(r6d.fullyVerified, false, 'floored 1 of 2 not fullyVerified');

  // 7. autoVerifiablePlanned counting — string entries and unknown kinds.
  const r7 = computeVerificationCoverage({
    plannedChecks: ['typecheck', 'preview', 'manual_review', 'nonsense', check('lint')],
    executedCount: 3,
  });
  assertEq(r7.autoVerifiablePlanned, 3, 'string kinds + object kind counted; manual+nonsense excluded');
  assertEq(r7.coverageRatio, 1, '3/3 auto executed → 1.0');
  assertEq(r7.fullyVerified, true, 'all 3 auto ran');

  // 7b. Entries missing a kind, or with non-string kind, are ignored.
  const r7b = computeVerificationCoverage({
    plannedChecks: [{ label: 'no kind' }, { kind: 99 }, { kind: null }, check('build')],
    executedCount: 1,
  });
  assertEq(r7b.autoVerifiablePlanned, 1, 'only the build check counts');
  assertEq(r7b.coverageRatio, 1, '1/1 auto → 1.0');

  // 8. Hostile / degenerate input — never throws, always valid shape.
  const hostile: Array<VerificationCoverageInput | null | undefined | unknown> = [
    null,
    undefined,
    {},
    { plannedChecks: null, executedCount: null },
    { plannedChecks: undefined, executedCount: undefined },
    { plannedChecks: 'not-an-array', executedCount: 'not-a-number' },
    { plannedChecks: 12345, executedCount: NaN },
    { plannedChecks: {}, executedCount: Infinity },
    { plannedChecks: [check('typecheck')], executedCount: -Infinity },
    { plannedChecks: [null, undefined, 0, false, '', NaN], executedCount: 2 },
    { plannedChecks: [Symbol('x'), () => 'typecheck'], executedCount: 1 },
    42 as unknown,
    'string' as unknown,
    [] as unknown,
    [check('tests')] as unknown, // array passed as the whole input (no .plannedChecks)
  ];
  for (let i = 0; i < hostile.length; i += 1) {
    let res: VerificationCoverageResult | undefined;
    let threw = false;
    try {
      res = computeVerificationCoverage(hostile[i] as VerificationCoverageInput);
    } catch {
      threw = true;
    }
    assert(!threw, `hostile[${i}] does not throw`);
    assert(!!res && isValidResult(res), `hostile[${i}] returns valid neutral-safe result`);
  }

  // 8b. Cyclic input object and cyclic array element — no infinite traversal.
  const cyclicObj: Record<string, unknown> = { executedCount: 1 };
  cyclicObj.self = cyclicObj;
  cyclicObj.plannedChecks = [cyclicObj, check('typecheck')];
  let cyclicThrew = false;
  let rc: VerificationCoverageResult | undefined;
  try {
    rc = computeVerificationCoverage(cyclicObj as VerificationCoverageInput);
  } catch {
    cyclicThrew = true;
  }
  assert(!cyclicThrew, 'cyclic input does not throw');
  assert(!!rc && isValidResult(rc), 'cyclic input returns valid result');
  assertEq(rc!.autoVerifiablePlanned, 1, 'cyclic element ignored; the one real typecheck counts');

  // 8c. Throwing getters on both `.kind` of an item and top-level props.
  const evilItem = { get kind() { throw new Error('boom-kind'); } };
  const rEvilItem = computeVerificationCoverage({ plannedChecks: [evilItem, check('lint')], executedCount: 1 });
  assert(isValidResult(rEvilItem), 'throwing item getter → valid result');
  assertEq(rEvilItem.autoVerifiablePlanned, 1, 'throwing-kind item skipped; lint counts');

  const evilInput: Record<string, unknown> = {};
  Object.defineProperty(evilInput, 'plannedChecks', { get() { throw new Error('boom-planned'); }, enumerable: true });
  let evilInputThrew = false;
  let rEvilInput: VerificationCoverageResult | undefined;
  try {
    rEvilInput = computeVerificationCoverage(evilInput as VerificationCoverageInput);
  } catch {
    evilInputThrew = true;
  }
  assert(!evilInputThrew, 'throwing top-level getter does not throw');
  assert(!!rEvilInput && isValidResult(rEvilInput), 'throwing top-level getter → neutral result');
  assertEq(rEvilInput!.coverageRatio, 0, 'throwing top-level getter → coverageRatio 0');

  // 8d. Huge array is bounded — no hang, valid clamped result.
  const huge = new Array(200_001).fill(check('typecheck'));
  let hugeThrew = false;
  let rHuge: VerificationCoverageResult | undefined;
  try {
    rHuge = computeVerificationCoverage({ plannedChecks: huge, executedCount: 1_000_000 });
  } catch {
    hugeThrew = true;
  }
  assert(!hugeThrew, 'huge planned array does not throw');
  assert(!!rHuge && isValidResult(rHuge), 'huge planned array returns valid result');
  assert(rHuge!.autoVerifiablePlanned > 0, 'huge array counts at least some auto checks');

  // 8e. Huge executed count stays bounded and clamps.
  const rHugeExec = computeVerificationCoverage({ plannedChecks: [check('tests')], executedCount: 1e300 });
  assertEq(rHugeExec.coverageRatio, 1, 'huge executed clamps ratio to 1');
  assertEq(rHugeExec.fullyVerified, true, 'huge executed → fullyVerified');

  // 9. Determinism — same input yields identical result twice.
  const inputD = { plannedChecks: [check('typecheck'), check('manual_review'), check('preview')], executedCount: 2 };
  const d1 = computeVerificationCoverage(inputD);
  const d2 = computeVerificationCoverage(inputD);
  assertEq(d1.coverageRatio, d2.coverageRatio, 'deterministic coverageRatio');
  assertEq(d1.autoVerifiablePlanned, d2.autoVerifiablePlanned, 'deterministic autoVerifiablePlanned');
  assertEq(d1.fullyVerified, d2.fullyVerified, 'deterministic fullyVerified');
  assertEq(d1.autoVerifiablePlanned, 2, 'input D: 2 auto (typecheck, preview)');
  assertEq(d1.coverageRatio, 1, 'input D: 2/2 auto → 1.0');

  if (failures > 0) {
    console.error(`\n${failures} fail`);
    process.exit(1);
  }
  console.log(`\nAll verification-coverage-core smoke cases passed (${passes} passed).`);
}

main();
