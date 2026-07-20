/**
 * verification-depth-policy-core-smoketest — the PURE verification-depth dial
 * (src/lib/verificationDepthPolicyCore.ts) that maps the changed-file set a run
 * actually touched (paths + a delete flag, never content) to a risk tier and the
 * auto-verifiable checks that MUST run before the run may claim "verified", then
 * applies that required set to the existing task plan. Load-bearing assertions:
 *
 *   classifyChangedFileRisk(changedFiles, opts?): { categories, codeFileCount,
 *     highHit, elevatedHit } — code-bearing filter FIRST (docs/.md/.txt/.rst,
 *     under docs/, image/binary contribute no category + no breadth); HIGH cats
 *     schema/auth/payments; ELEVATED cats edge/provider-routing/config; else
 *     app-code. Distinct paths only; opts.maxFiles caps the scan.
 *
 *   planVerificationDepth(input): VerificationDepthDecision — breadth <=2 low /
 *     3..7 elevated / >=8 high; codeFileCount 0 → low with requiredKinds []; HIGH
 *     on any high cat / breadth high / destructive+signal; ELEVATED on any
 *     elevated cat / breadth elevated / destructive; depth LOW→[typecheck],
 *     ELEVATED→[tests,typecheck], HIGH→[build,lint,tests,typecheck]. Applies to
 *     plannedChecks (upgrade required-falsy indices, report missing kinds) and
 *     derives advisory manualReviewKinds. Guarantees: requiredKinds ⊇ (upgraded ∪
 *     missing) kinds; upgradeIndices strictly-ascending/unique/in-range; every
 *     array sorted+deduped+bounded; reason <=240 and NEVER echoes a path.
 *
 *   And: every export is TOTAL — null / undefined / wrong-type / NaN / huge /
 *   cyclic / throwing-getter input yields a safe, well-formed result (never throws).
 *
 * Pure — loads under tsx (verificationDepthPolicyCore has zero imports).
 */

import {
  classifyChangedFileRisk,
  planVerificationDepth,
  MAX_CHANGED_FILES,
  MAX_REASON_LEN,
  type VerificationDepthDecision,
} from '../src/lib/verificationDepthPolicyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── domain vocab (typed Set<unknown> so membership checks accept unknown[]) ────
const AUTO_KINDS = new Set<unknown>(['build', 'lint', 'tests', 'typecheck']);
const RISK_CATS = new Set<unknown>([
  'schema',
  'auth',
  'payments',
  'edge',
  'provider-routing',
  'config',
  'app-code',
]);
const MANUAL_SET = new Set<unknown>(['security_review', 'integration_review']);

// ── structural helpers ──────────────────────────────────────────────────────
/** strict-ascending string check → enforces sorted AND unique. */
function isSortedUniqueStr(arr: unknown[]): boolean {
  for (let i = 1; i < arr.length; i += 1) {
    if (!((arr[i - 1] as string) < (arr[i] as string))) return false;
  }
  return true;
}
function isStrictAscNum(arr: number[]): boolean {
  for (let i = 1; i < arr.length; i += 1) if (!(arr[i - 1] < arr[i])) return false;
  return true;
}
function subset(a: unknown[], superSet: Set<unknown>): boolean {
  return a.every((x) => superSet.has(x));
}

/** Every invariant a VerificationDepthDecision must satisfy for any input. */
function decisionWellFormed(d: VerificationDepthDecision): boolean {
  if (!d || typeof d !== 'object') return false;
  if (!['low', 'elevated', 'high'].includes(d.riskTier)) return false;
  if (!Array.isArray(d.requiredKinds) || !subset(d.requiredKinds, AUTO_KINDS) || !isSortedUniqueStr(d.requiredKinds)) return false;
  if (!Array.isArray(d.upgradeIndices) || !isStrictAscNum(d.upgradeIndices) || !d.upgradeIndices.every((n) => Number.isInteger(n) && n >= 0)) return false;
  if (!Array.isArray(d.missingKinds) || !subset(d.missingKinds, AUTO_KINDS) || !isSortedUniqueStr(d.missingKinds)) return false;
  const reqSet = new Set(d.requiredKinds);
  if (!d.missingKinds.every((k) => reqSet.has(k))) return false; // missing ⊆ required
  if (!Array.isArray(d.manualReviewKinds) || !subset(d.manualReviewKinds, MANUAL_SET) || !isSortedUniqueStr(d.manualReviewKinds) || d.manualReviewKinds.length > 3) return false;
  if (!Array.isArray(d.categories) || !subset(d.categories, RISK_CATS) || !isSortedUniqueStr(d.categories) || d.categories.length > 7) return false;
  if (!(Number.isInteger(d.codeFileCount) && d.codeFileCount >= 0)) return false;
  if (typeof d.reason !== 'string' || d.reason.length > MAX_REASON_LEN) return false;
  if (d.reason.includes('/') || d.reason.includes('\\')) return false; // no path leaked
  return true;
}
function classifyWellFormed(c: ReturnType<typeof classifyChangedFileRisk>): boolean {
  if (!c || typeof c !== 'object') return false;
  if (!Array.isArray(c.categories) || !subset(c.categories, RISK_CATS) || !isSortedUniqueStr(c.categories)) return false;
  if (!(Number.isInteger(c.codeFileCount) && c.codeFileCount >= 0)) return false;
  return typeof c.highHit === 'boolean' && typeof c.elevatedHit === 'boolean';
}
function totalPlan(x: unknown): boolean {
  try {
    return decisionWellFormed(planVerificationDepth(x as never));
  } catch {
    return false;
  }
}
function totalClassify(x: unknown): boolean {
  try {
    return classifyWellFormed(classifyChangedFileRisk(x));
  } catch {
    return false;
  }
}
/** upgradeIndices in-range of planned + (upgraded-kinds ∪ missing) ⊆ required. */
function upgradedMissingWithinRequired(d: VerificationDepthDecision, planned: unknown[]): boolean {
  const reqSet = new Set<string>(d.requiredKinds);
  const referenced = new Set<string>(d.missingKinds);
  for (const i of d.upgradeIndices) {
    if (!(i >= 0 && i < planned.length)) return false;
    const entry = planned[i];
    if (entry && typeof entry === 'object') {
      const k = (entry as { kind?: unknown }).kind;
      if (typeof k === 'string') referenced.add(k.trim().toLowerCase());
    }
  }
  for (const k of referenced) if (!reqSet.has(k)) return false;
  return true;
}
/** app-code file path generator (matches no sensitive keyword). */
function appFiles(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(`src/ui/panel${i}.tsx`);
  return out;
}

function main(): void {
  // ─── (A) trivial → light touch ───────────────────────────────────────────────
  {
    const d = planVerificationDepth({ changedFiles: ['src/lib/copyStrings.ts'] });
    assert(decisionWellFormed(d), '(A) trivial decision well-formed');
    assertEq(d.riskTier, 'low', '(A) single app-code file is low risk');
    assertJson(d.requiredKinds, ['typecheck'], '(A) low depth = [typecheck]');
    assertEq(d.codeFileCount, 1, '(A) one code file counted');
    assertJson(d.categories, ['app-code'], '(A) app-code category');
    assertJson(d.missingKinds, ['typecheck'], '(A) with no plan, typecheck is missing');
    assertJson(d.upgradeIndices, [], '(A) nothing to upgrade with no plan');
    assertJson(d.manualReviewKinds, [], '(A) app-code needs no manual review');
    assert(d.reason.includes('low risk') && d.reason.includes('app-code'), '(A) reason names tier + category');
    assert(!d.reason.includes('copyStrings') && !d.reason.includes('copystrings'), '(A) reason never echoes the path');
  }
  {
    const d = planVerificationDepth({ changedFiles: ['README.md', 'docs/x.md'] });
    assert(decisionWellFormed(d), '(A) docs-only decision well-formed');
    assertEq(d.riskTier, 'low', '(A) docs-only is low');
    assertEq(d.codeFileCount, 0, '(A) docs contribute no breadth');
    assertJson(d.requiredKinds, [], '(A) zero code files → requiredKinds []');
    assertJson(d.categories, [], '(A) docs-only → no categories');
    assertJson(d.missingKinds, [], '(A) no required kinds → nothing missing');
    assertEq(d.reason, 'low risk — 0 code file(s); categories: none; require: none', '(A) empty-change reason');
  }
  assertEq(planVerificationDepth({ changedFiles: ['assets/logo.png', 'icons/x.svg'] }).codeFileCount, 0, '(A) image files are not code-bearing');
  assertEq(planVerificationDepth({ changedFiles: ['guide.rst', 'notes.txt'] }).codeFileCount, 0, '(A) .rst/.txt are not code-bearing');
  // code-bearing filter runs FIRST: an image ext beats sensitive keywords.
  assertEq(planVerificationDepth({ changedFiles: ['src/api/server.png'] }).codeFileCount, 0, '(A) image ext wins over edge keywords');
  // under docs/ excluded even with a code ext + sensitive keywords.
  assertEq(planVerificationDepth({ changedFiles: ['docs/api/provider-routing.ts'] }).codeFileCount, 0, '(A) under docs/ wins over keywords');
  {
    const d = planVerificationDepth({ changedFiles: ['src/lib/util.ts', 'README.md', 'notes.txt'] });
    assertEq(d.codeFileCount, 1, '(A) mixed set counts only the code file');
    assertEq(d.riskTier, 'low', '(A) one app-code file among docs is low');
  }

  // ─── (B) sensitive → high / manual review ────────────────────────────────────
  {
    const d = planVerificationDepth({ changedFiles: ['supabase/migrations/2026_x.sql'] });
    assert(decisionWellFormed(d), '(B) schema decision well-formed');
    assertEq(d.riskTier, 'high', '(B) a migration is high risk');
    assertJson(d.requiredKinds, ['build', 'lint', 'tests', 'typecheck'], '(B) high depth = full sorted suite');
    assert(d.categories.includes('schema'), '(B) schema category detected');
    assert(d.manualReviewKinds.includes('integration_review'), '(B) schema → integration_review advisory');
    assert(!d.reason.includes('.sql') && !d.reason.includes('migrations'), '(B) reason never echoes the migration path');
    const c = classifyChangedFileRisk(['supabase/migrations/2026_x.sql']);
    assert(c.highHit, '(B) classify: schema is a high hit');
    assert(!c.elevatedHit, '(B) classify: schema is not merely elevated');
    assertEq(c.codeFileCount, 1, '(B) classify: one code file');
  }
  {
    const d = planVerificationDepth({ changedFiles: ['src/lib/authSession.ts'] });
    assertEq(d.riskTier, 'high', '(B) auth code is high risk');
    assert(d.categories.includes('auth'), '(B) auth category detected');
    assert(d.manualReviewKinds.includes('security_review'), '(B) auth → security_review advisory');
    assert(!d.reason.includes('authSession') && !d.reason.includes('authsession'), '(B) reason never echoes auth path');
  }
  {
    const d = planVerificationDepth({ changedFiles: ['src/lib/billingPriority.ts'] });
    assertEq(d.riskTier, 'high', '(B) billing code is high risk');
    assert(d.categories.includes('payments'), '(B) payments category detected');
    assert(d.manualReviewKinds.includes('security_review'), '(B) payments → security_review advisory');
  }
  {
    const d = planVerificationDepth({ changedFiles: ['src/lib/authVault.ts', 'src/lib/walletPay.ts'] });
    assertEq(d.riskTier, 'high', '(B) auth+payments high');
    assertJson(d.categories, ['auth', 'payments'], '(B) categories sorted [auth,payments]');
    assertJson(d.manualReviewKinds, ['security_review'], '(B) dedup manual review to one security_review');
  }
  {
    const c = classifyChangedFileRisk(['supabase/functions/foo/index.ts']);
    assert(c.elevatedHit && !c.highHit, '(B) edge function is elevated, not high');
    const d = planVerificationDepth({ changedFiles: ['supabase/functions/foo/index.ts'] });
    assertEq(d.riskTier, 'elevated', '(B) single edge file → elevated');
    assertJson(d.requiredKinds, ['tests', 'typecheck'], '(B) elevated depth = [tests,typecheck]');
    assertJson(d.manualReviewKinds, [], '(B) edge alone → no manual review');
  }
  {
    // provider-routing needs breadth>=elevated to add integration_review.
    const single = planVerificationDepth({ changedFiles: ['src/lib/crossProviderRouter.ts'] });
    assertEq(single.riskTier, 'elevated', '(B) single provider file → elevated');
    assert(single.categories.includes('provider-routing'), '(B) provider-routing category');
    assertJson(single.manualReviewKinds, [], '(B) provider-routing below breadth → no manual review');
    const broad = planVerificationDepth({ changedFiles: ['src/lib/providerA.ts', 'src/lib/providerB.ts', 'src/lib/providerC.ts'] });
    assertEq(broad.riskTier, 'elevated', '(B) 3 provider files → elevated');
    assertJson(broad.manualReviewKinds, ['integration_review'], '(B) provider-routing + breadth → integration_review');
  }

  // ─── (C) breadth → escalate ──────────────────────────────────────────────────
  {
    const d = planVerificationDepth({ changedFiles: appFiles(8) });
    assertEq(d.riskTier, 'high', '(C) 8 app-code files → high by breadth');
    assertEq(d.codeFileCount, 8, '(C) 8 distinct files counted');
    assertJson(d.requiredKinds, ['build', 'lint', 'tests', 'typecheck'], '(C) breadth-high full suite');
    assertJson(d.categories, ['app-code'], '(C) breadth escalation keeps app-code only');
    assertJson(d.manualReviewKinds, [], '(C) app-code breadth → no manual review');
  }
  {
    const d = planVerificationDepth({ changedFiles: appFiles(4) });
    assertEq(d.riskTier, 'elevated', '(C) 4 app-code files → elevated');
    assertJson(d.requiredKinds, ['tests', 'typecheck'], '(C) 4-file elevated depth');
  }
  assertEq(planVerificationDepth({ changedFiles: appFiles(2) }).riskTier, 'low', '(C) 2 files → low (boundary)');
  assertEq(planVerificationDepth({ changedFiles: appFiles(3) }).riskTier, 'elevated', '(C) 3 files → elevated (boundary)');
  assertEq(planVerificationDepth({ changedFiles: appFiles(7) }).riskTier, 'elevated', '(C) 7 files → elevated (boundary)');
  assertEq(planVerificationDepth({ changedFiles: appFiles(1) }).riskTier, 'low', '(C) 1 file → low');
  // duplicate paths collapse: 5 copies of one path → 1 code file → low.
  assertEq(planVerificationDepth({ changedFiles: ['src/a.ts', 'src/a.ts', 'src/a.ts', 'src/a.ts', 'src/a.ts'] }).codeFileCount, 1, '(C) duplicate paths counted once');

  // ─── (D) plan application ────────────────────────────────────────────────────
  {
    const planned = [
      { kind: 'typecheck', required: true },
      { kind: 'tests', required: false },
    ];
    const d = planVerificationDepth({ changedFiles: ['supabase/migrations/x.sql'], plannedChecks: planned });
    assert(decisionWellFormed(d), '(D) high+plan decision well-formed');
    assertJson(d.upgradeIndices, [1], '(D) required-false tests upgraded (index 1)');
    assertJson(d.missingKinds, ['build', 'lint'], '(D) build+lint missing from plan');
    assert(upgradedMissingWithinRequired(d, planned), '(D) requiredKinds ⊇ (upgraded ∪ missing)');
  }
  {
    const planned = [
      { kind: 'typecheck', required: true },
      { kind: 'tests', required: true },
      { kind: 'lint', required: true },
      { kind: 'build', required: true },
    ];
    const d = planVerificationDepth({ changedFiles: ['supabase/migrations/x.sql'], plannedChecks: planned });
    assertJson(d.upgradeIndices, [], '(D) all-required plan → no upgrades');
    assertJson(d.missingKinds, [], '(D) all-required plan → nothing missing');
  }
  {
    // junk entries interleaved must be skipped structurally.
    const planned = [null, { kind: 'tests', required: false }, 42, { kind: 'typecheck' }, { no: 'kind' }];
    const d = planVerificationDepth({ changedFiles: ['supabase/migrations/x.sql'], plannedChecks: planned });
    assert(decisionWellFormed(d), '(D) junk-plan decision well-formed');
    assertJson(d.upgradeIndices, [1, 3], '(D) tests(1) + non-true typecheck(3) upgraded, junk skipped');
    assertJson(d.missingKinds, ['build', 'lint'], '(D) still missing build+lint');
    assert(isStrictAscNum(d.upgradeIndices), '(D) upgradeIndices strictly ascending');
    assert(d.upgradeIndices.every((i) => i < planned.length), '(D) upgradeIndices in range');
    assert(upgradedMissingWithinRequired(d, planned), '(D) junk-plan: kinds ⊆ required');
  }
  {
    // duplicate kind in plan: both required-false tests entries upgraded.
    const planned = [
      { kind: 'tests', required: false },
      { kind: 'tests', required: false },
    ];
    const d = planVerificationDepth({ changedFiles: appFiles(4), plannedChecks: planned });
    assertEq(d.riskTier, 'elevated', '(D) elevated change for duplicate-kind plan');
    assertJson(d.upgradeIndices, [0, 1], '(D) both duplicate tests entries upgraded');
    assertJson(d.missingKinds, ['typecheck'], '(D) typecheck still missing');
  }
  {
    const planned = [
      { kind: 'typecheck', required: true },
      { kind: 'tests', required: false },
    ];
    const d = planVerificationDepth({ changedFiles: appFiles(4), plannedChecks: planned });
    assertJson(d.upgradeIndices, [1], '(D) elevated: only tests upgraded');
    assertJson(d.missingKinds, [], '(D) elevated: nothing missing when both kinds planned');
  }

  // ─── (E) destructive ops ─────────────────────────────────────────────────────
  {
    const d = planVerificationDepth({ changedFiles: ['app.json'], destructiveOps: 2 });
    assert(d.riskTier === 'high' || d.riskTier === 'elevated', '(E) destructive on config → at least elevated');
    assertEq(d.riskTier, 'high', '(E) destructive + elevated config cat → high');
    assert(!d.reason.includes('app.json') && !d.reason.includes('.json'), '(E) reason never echoes the config path');
  }
  assertEq(planVerificationDepth({ changedFiles: ['src/lib/util.ts'], destructiveOps: true }).riskTier, 'elevated', '(E) destructiveOps:true alone → elevated');
  assertEq(planVerificationDepth({ changedFiles: [{ path: 'src/lib/util.ts', deleted: true }] }).riskTier, 'elevated', '(E) deleted code file → elevated');
  assertEq(planVerificationDepth({ changedFiles: ['src/lib/util.ts'], destructiveOps: 0 }).riskTier, 'low', '(E) destructiveOps:0 → no escalation');
  assertEq(planVerificationDepth({ changedFiles: ['src/lib/util.ts'], destructiveOps: 'reset' }).riskTier, 'low', '(E) non-number/bool destructiveOps ignored');
  {
    // a deleted DOC file is not code-bearing → no escalation, zero breadth.
    const d = planVerificationDepth({ changedFiles: [{ path: 'README.md', deleted: true }] });
    assertEq(d.riskTier, 'low', '(E) deleted doc does not escalate');
    assertEq(d.codeFileCount, 0, '(E) deleted doc adds no breadth');
    assertJson(d.requiredKinds, [], '(E) deleted doc → requiredKinds []');
  }
  assertEq(planVerificationDepth({ changedFiles: appFiles(2), destructiveOps: true }).riskTier, 'elevated', '(E) destructive + low breadth app-code → elevated not high');

  // ─── (F) HOSTILE INPUTS — never throw, always well-formed ─────────────────────
  try {
    const cycArr: unknown[] = [];
    cycArr.push(cycArr);
    const cycObj: Record<string, unknown> = { path: 'src/cyc.ts' };
    cycObj.self = cycObj;
    const throwingEntry = {
      get path(): string {
        throw new Error('boom-path');
      },
    };
    const throwingInput = {
      get changedFiles(): unknown {
        throw new Error('boom-changed');
      },
    };
    const hugePath = 'x'.repeat(20000) + '/y.ts';

    const hostilePlan: unknown[] = [
      null,
      undefined,
      42,
      -1,
      NaN,
      Infinity,
      'str',
      true,
      false,
      {},
      [],
      Symbol('s'),
      9n,
      () => 'x',
      { changedFiles: null },
      { changedFiles: 'not-an-array' },
      { changedFiles: 42 },
      { changedFiles: {} },
      { changedFiles: [null, 5, {}, true, undefined, NaN] },
      { changedFiles: [{}] },
      { changedFiles: [throwingEntry] },
      throwingInput,
      { changedFiles: cycArr },
      { changedFiles: [cycObj] },
      { changedFiles: [hugePath] },
      { changedFiles: [{ path: hugePath, deleted: true }] },
      { changedFiles: ['src/ /evil  .ts'] },
      { changedFiles: ['src/a.ts'], plannedChecks: 'garbage' },
      { changedFiles: ['src/a.ts'], plannedChecks: 42 },
      { changedFiles: ['src/a.ts'], plannedChecks: [null, 42, 'x', { kind: 5 }] },
      { changedFiles: ['src/a.ts'], destructiveOps: NaN },
      { changedFiles: ['src/a.ts'], destructiveOps: Infinity },
      { changedFiles: ['src/a.ts'], destructiveOps: -3 },
      { changedFiles: ['src/a.ts'], destructiveOps: {} },
    ];
    for (const h of hostilePlan) {
      assert(totalPlan(h), '(F) planVerificationDepth total on hostile input', JSON.stringify(String(h)).slice(0, 32));
    }
    for (const h of [null, undefined, 42, 'str', true, NaN, {}, [], Symbol('s'), 9n, cycArr, throwingInput]) {
      assert(totalClassify(h), '(F) classifyChangedFileRisk total on hostile input');
    }

    // bounded on a huge array — scanned to MAX_CHANGED_FILES, never throws.
    const huge = Array.from({ length: 10000 }, (_, i) => `src/mod/f${i}.tsx`);
    const dHuge = planVerificationDepth({ changedFiles: huge });
    assert(decisionWellFormed(dHuge), '(F) huge-array decision well-formed');
    assertEq(dHuge.codeFileCount, MAX_CHANGED_FILES, '(F) huge array capped at MAX_CHANGED_FILES');
    assertEq(dHuge.riskTier, 'high', '(F) huge array → high by breadth');

    // huge single path is sliced, still safe + well-formed.
    const dHugePath = planVerificationDepth({ changedFiles: [hugePath] });
    assert(decisionWellFormed(dHugePath), '(F) huge-path decision well-formed');
    assert(dHugePath.reason.length <= MAX_REASON_LEN, '(F) reason bounded on huge path');
    assert(!dHugePath.reason.includes('/'), '(F) huge-path reason has no path separator');

    // control-char path never leaks into reason.
    const dCtrl = planVerificationDepth({ changedFiles: ['src/ /evil .ts'] });
    assert(decisionWellFormed(dCtrl), '(F) control-char decision well-formed');
    assert(!dCtrl.reason.includes(' ') && !dCtrl.reason.includes(' '), '(F) control chars never in reason');

    // reason from every hostile plan input stays bounded + path-free.
    for (const h of hostilePlan) {
      const d = planVerificationDepth(h as never);
      assert(d.reason.length <= MAX_REASON_LEN && !d.reason.includes('/'), '(F) hostile reason bounded + path-free');
    }
    passes += 1; // reached the end of the hostile block without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (F) hostile inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (G) determinism ─────────────────────────────────────────────────────────
  {
    const input = {
      changedFiles: ['supabase/migrations/x.sql', 'src/lib/authSession.ts', ...appFiles(4)],
      plannedChecks: [{ kind: 'typecheck', required: false }, { kind: 'tests', required: false }],
      destructiveOps: 1,
    };
    const a = planVerificationDepth(input);
    const b = planVerificationDepth(input);
    assertJson(a, b, '(G) same rich input → identical decision');
    assertEq(a.riskTier, 'high', '(G) rich sensitive+broad input → high');
    const ca = classifyChangedFileRisk(input.changedFiles);
    const cb = classifyChangedFileRisk(input.changedFiles);
    assertJson(ca, cb, '(G) classify deterministic on same input');
  }
  {
    const hostile = { changedFiles: [null, { path: 'src/x.ts' }, 42], destructiveOps: NaN };
    assertJson(planVerificationDepth(hostile), planVerificationDepth(hostile), '(G) determinism holds on hostile input');
  }
  // opts.maxFiles caps the scan deterministically.
  assertEq(classifyChangedFileRisk(['a.sql', 'b.sql', 'c.sql']).codeFileCount, 3, '(G) classify counts all three sql files');
  assertEq(classifyChangedFileRisk(['a.sql', 'b.sql', 'c.sql'], { maxFiles: 1 }).codeFileCount, 1, '(G) maxFiles:1 caps the scan');
  assertEq(classifyChangedFileRisk(['a.sql', 'b.sql', 'c.sql'], { maxFiles: 0 }).codeFileCount, 3, '(G) maxFiles:0 → default cap');
  assertEq(classifyChangedFileRisk(['a.sql', 'b.sql', 'c.sql'], { maxFiles: 'x' as unknown as number }).codeFileCount, 3, '(G) bad maxFiles → default cap');

  // ─── (H) regression (QA) ─────────────────────────────────────────────────────
  {
    // Bug 1: non-array input must NOT hand back the shared EMPTY_SCAN.categories
    // singleton. Mutating a returned categories array must not contaminate any
    // later empty/non-array decision.
    const r = classifyChangedFileRisk(null);
    r.categories.push('schema', 'auth');
    const d = planVerificationDepth({ changedFiles: undefined });
    assertJson(d.categories, [], '(H) non-array categories not aliased to shared singleton');
    assertJson(d.manualReviewKinds, [], '(H) contaminated categories do not fabricate manual review');
    assertEq(d.reason, 'low risk — 0 code file(s); categories: none; require: none', '(H) reason unaffected by prior mutation');
    // A second classify call likewise returns a fresh, un-contaminated array.
    assertJson(classifyChangedFileRisk({}).categories, [], '(H) later non-array classify still empty');
  }
  {
    // Bug 2: the deleted flag must be OR-ed across duplicate entries of the same
    // code-bearing path — risk must not depend on entry order.
    const modifyFirst = planVerificationDepth({
      changedFiles: [{ path: 'src/a.ts', deleted: false }, { path: 'src/a.ts', deleted: true }],
    });
    const deleteFirst = planVerificationDepth({
      changedFiles: [{ path: 'src/a.ts', deleted: true }, { path: 'src/a.ts', deleted: false }],
    });
    assertEq(modifyFirst.riskTier, 'elevated', '(H) modify-first duplicate deleted path → elevated');
    assertEq(deleteFirst.riskTier, 'elevated', '(H) delete-first duplicate deleted path → elevated');
    assertJson(modifyFirst.requiredKinds, ['tests', 'typecheck'], '(H) duplicate deleted path → [tests,typecheck]');
    assertEq(modifyFirst.codeFileCount, 1, '(H) duplicate deleted path counted once');
    assertJson(modifyFirst, deleteFirst, '(H) deleted-flag fold is order-independent');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll verification-depth-policy-core smoke cases passed (${passes} passed).`);
}

main();
