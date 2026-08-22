/**
 * Smoke: openswanApprovalBatchCore — batch compatible pending approvals into
 * ONE card (fewer hoops) WITHOUT ever sweeping a canonical exact-floor action
 * under a single yes.
 *
 * Pins the UX contract the approval UI depends on:
 *   - non-floor low/medium items of the SAME risk → one shared card
 *   - floor + high/critical/unknown → each its own card (requiresSeparate)
 *   - deterministic, fail-closed, total on hostile input.
 *
 * Run: npx tsx scripts/openswan-approval-batch-core-smoketest.ts
 */

import {
  planApprovalBatch,
  normalizeApprovalBatchRisk,
  ALWAYS_SEPARATE_FLOOR_MARKERS,
  type ApprovalBatchGroup,
  type ApprovalBatchPlan,
} from '../src/lib/openswanApprovalBatchCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function jstr(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + jstr(a) + ' want ' + jstr(b));
}
function assertJson(a: any, b: any, m: string) {
  assert(jstr(a) === jstr(b), m, 'got ' + jstr(a) + ' want ' + jstr(b));
}
function noThrow(fn: () => any, m: string): any {
  try {
    const out = fn();
    passes++;
    return out;
  } catch (e) {
    failures++;
    console.error('FAIL (threw): ' + m + ' :: ' + String(e));
    return undefined;
  }
}

// Shared fixtures -------------------------------------------------------------
const readLow = (n: string = 'observe') => ({ tool: 'browser.dom_snapshot', risk: 'low', category: n });
const editMed = (n: string = 'reversible_non_secret') => ({ tool: 'desktop.set_element_value', risk: 'medium', category: n });
const floorDelete = { tool: 'desktop.delete_file', risk: 'medium', category: 'delete' };
const floorPay = { tool: 'browser.checkout', risk: 'high', category: 'pay' };
const floorLogin = { tool: 'browser.fill_credential_field', risk: 'low', category: 'login' };
const floorGrant = { tool: 'oauth.authorize', risk: 'medium', category: 'grant' };
const highExport = { tool: 'gdrive.share', risk: 'high', category: 'export' };
const critDeploy = { tool: 'ci.deploy', risk: 'critical', category: 'deploy' };
const unknownItem = { tool: 'mystery', risk: 'wat', category: 'misc' };

// Invariant sweep: structure the UI relies on must always hold. -------------
function checkInvariants(pending: any[], plan: ApprovalBatchPlan, label: string) {
  assert(!!plan && Array.isArray(plan.batches), label + ' plan shape');
  assert(typeof plan.canBatch === 'boolean', label + ' canBatch is boolean');
  const n = Math.min(pending.length, 500);
  const seen = new Set<number>();
  for (const b of plan.batches) {
    assert(Array.isArray(b.indices) && b.indices.length > 0, label + ' batch has ≥1 index');
    assert(typeof b.combinedRisk === 'string' && b.combinedRisk.length > 0, label + ' combinedRisk non-empty string');
    assert(typeof b.requiresSeparate === 'boolean', label + ' requiresSeparate boolean');
    let prev = -1;
    for (const idx of b.indices) {
      assert(Number.isInteger(idx) && idx >= 0 && idx < n, label + ' index in range: ' + idx);
      assert(!seen.has(idx), label + ' index unique: ' + idx);
      seen.add(idx);
      assert(idx > prev, label + ' indices ascending within batch');
      prev = idx;
    }
    if (b.requiresSeparate) assert(b.indices.length === 1, label + ' separate card is a singleton');
  }
  assertEq(seen.size, n, label + ' every processed index covered exactly once');
  for (let i = 1; i < plan.batches.length; i++) {
    assert(
      plan.batches[i - 1].indices[0] < plan.batches[i].indices[0],
      label + ' cards ordered by first index',
    );
  }
  const anyMulti = plan.batches.some((b) => b.indices.length >= 2);
  assertEq(plan.canBatch, anyMulti, label + ' canBatch reflects a real ≥2 bundle');
}

function only(item: any): ApprovalBatchGroup {
  return planApprovalBatch([item]).batches[0];
}

function main() {
  // ── Group 1: empty / non-array → neutral, never throws ────────────────────
  assertJson(planApprovalBatch([]), { batches: [], canBatch: false }, '1.1 empty array → neutral');
  assertJson(planApprovalBatch(null), { batches: [], canBatch: false }, '1.2 null → neutral');
  assertJson(planApprovalBatch(undefined), { batches: [], canBatch: false }, '1.3 undefined → neutral');
  assertJson(planApprovalBatch(42 as any), { batches: [], canBatch: false }, '1.4 number → neutral');
  assertJson(planApprovalBatch('nope' as any), { batches: [], canBatch: false }, '1.5 string → neutral');
  assertJson(planApprovalBatch({} as any), { batches: [], canBatch: false }, '1.6 object → neutral');
  assertJson(planApprovalBatch(true as any), { batches: [], canBatch: false }, '1.7 boolean → neutral');
  assertJson(planApprovalBatch(new Set([readLow()]) as any), { batches: [], canBatch: false }, '1.8 Set (not array) → neutral');

  // ── Group 2: 3 low-risk reads → ONE batch (the headline win) ──────────────
  {
    const p = planApprovalBatch([readLow(), readLow(), readLow()]);
    assertJson(
      p,
      { batches: [{ indices: [0, 1, 2], combinedRisk: 'low', requiresSeparate: false }], canBatch: true },
      '2.1 three low reads → single batch, canBatch true',
    );
    assertEq(p.batches.length, 1, '2.2 exactly one card');
    assertEq(p.batches[0].requiresSeparate, false, '2.3 shared card is not requiresSeparate');
    checkInvariants([readLow(), readLow(), readLow()], p, '2.inv');
  }

  // ── Group 3: a FLOOR action never batches — its own card ──────────────────
  {
    const single = planApprovalBatch([floorDelete]);
    assertJson(
      single,
      { batches: [{ indices: [0], combinedRisk: 'medium', requiresSeparate: true }], canBatch: false },
      '3.1 lone delete → its own separate card',
    );
    const four = planApprovalBatch([floorPay, floorDelete, floorLogin, floorGrant]);
    assertEq(four.batches.length, 4, '3.2 pay/delete/login/grant → four separate cards');
    assertEq(four.canBatch, false, '3.3 all floors → nothing batched');
    for (const b of four.batches) assertEq(b.requiresSeparate, true, '3.4 every floor card requiresSeparate');
    // low-risk login STILL separates despite being low risk
    assertEq(only(floorLogin).requiresSeparate, true, '3.5 low-risk login is still floor → separate');
    assertEq(only(floorLogin).combinedRisk, 'low', '3.6 login card keeps its low risk label');
    checkInvariants([floorPay, floorDelete, floorLogin, floorGrant], four, '3.inv');
  }

  // ── Group 4: mixed → floors separate + the rest batched ───────────────────
  {
    const pending = [readLow(), floorDelete, readLow(), floorPay];
    const p = planApprovalBatch(pending);
    assertJson(
      p,
      {
        batches: [
          { indices: [0, 2], combinedRisk: 'low', requiresSeparate: false },
          { indices: [1], combinedRisk: 'medium', requiresSeparate: true },
          { indices: [3], combinedRisk: 'high', requiresSeparate: true },
        ],
        canBatch: true,
      },
      '4.1 reads batched, delete + pay each separate',
    );
    assertEq(p.canBatch, true, '4.2 canBatch true (reads bundled)');
    checkInvariants(pending, p, '4.inv');
  }

  // ── Group 5: risk levels — same level bundles, others separate ────────────
  {
    const pending = [readLow(), editMed(), readLow(), editMed(), highExport, critDeploy, unknownItem];
    const p = planApprovalBatch(pending);
    assertJson(
      p,
      {
        batches: [
          { indices: [0, 2], combinedRisk: 'low', requiresSeparate: false },
          { indices: [1, 3], combinedRisk: 'medium', requiresSeparate: false },
          { indices: [4], combinedRisk: 'high', requiresSeparate: true },
          { indices: [5], combinedRisk: 'critical', requiresSeparate: true },
          { indices: [6], combinedRisk: 'unknown', requiresSeparate: true },
        ],
        canBatch: true,
      },
      '5.1 low-batch + medium-batch + high/critical/unknown separate',
    );
    checkInvariants(pending, p, '5.inv');

    // low and medium never co-mingle under one yes
    const twoLevels = planApprovalBatch([readLow(), editMed()]);
    assertJson(
      twoLevels,
      {
        batches: [
          { indices: [0], combinedRisk: 'low', requiresSeparate: false },
          { indices: [1], combinedRisk: 'medium', requiresSeparate: false },
        ],
        canBatch: false,
      },
      '5.2 one low + one medium → two singleton cards, canBatch false',
    );
    assertEq(twoLevels.canBatch, false, '5.3 nothing merged → canBatch false even though both batchable');

    // high never batches with other highs (fail-closed above medium)
    const twoHighs = planApprovalBatch([highExport, highExport]);
    assertEq(twoHighs.batches.length, 2, '5.4 two highs stay separate');
    assertEq(twoHighs.canBatch, false, '5.5 highs never bundle');
  }

  // ── Group 6: risk normalization across three real taxonomies ──────────────
  const lowWords = ['low', 'LOW', '  low  ', 'safe', 'read', 'none'];
  for (const w of lowWords) assertEq(normalizeApprovalBatchRisk(w), 'low', '6.low ' + jstr(w));
  const medWords = ['medium', 'med', 'review', 'reversible', 'MEDIUM'];
  for (const w of medWords) assertEq(normalizeApprovalBatchRisk(w), 'medium', '6.med ' + jstr(w));
  const highWords = ['high', 'external', 'external_side_effect'];
  for (const w of highWords) assertEq(normalizeApprovalBatchRisk(w), 'high', '6.high ' + jstr(w));
  const critWords = ['critical', 'crit', 'destructive', 'irreversible'];
  for (const w of critWords) assertEq(normalizeApprovalBatchRisk(w), 'critical', '6.crit ' + jstr(w));
  const unknownVals = ['', '   ', 'bogus', null, undefined, 123, {}, [], true, NaN];
  for (const w of unknownVals) assertEq(normalizeApprovalBatchRisk(w as any), 'unknown', '6.unknown ' + jstr(w));

  // ── Group 7: floor detection variants (over-ask is the safe direction) ────
  // exact category markers
  for (const cat of ALWAYS_SEPARATE_FLOOR_MARKERS) {
    assertEq(only({ tool: 't', risk: 'low', category: cat }).requiresSeparate, true, '7.exact ' + cat);
  }
  // substring category markers
  const subCats = ['payment', 'delete_all', 'grant_access', 'auto_login', 'pre-pay', 'soft-delete'];
  for (const cat of subCats) {
    assertEq(only({ tool: 't', risk: 'low', category: cat }).requiresSeparate, true, '7.subcat ' + cat);
  }
  // tool-name substring, benign category
  assertEq(only({ tool: 'desktop.delete_file', risk: 'low', category: 'file' }).requiresSeparate, true, '7.tool delete');
  assertEq(only({ tool: 'browser.pay_now', risk: 'low', category: 'commerce' }).requiresSeparate, true, '7.tool pay');
  // floor flag truthiness
  assertEq(only({ tool: 't', risk: 'low', category: 'read', floor: true }).requiresSeparate, true, '7.flag true');
  assertEq(only({ tool: 't', risk: 'low', category: 'read', floor: 'yes' }).requiresSeparate, true, '7.flag string');
  assertEq(only({ tool: 't', risk: 'low', category: 'read', floor: 1 }).requiresSeparate, true, '7.flag number');
  assertEq(only({ tool: 't', risk: 'low', category: 'read', floor: [1] }).requiresSeparate, true, '7.flag array');
  // NON-floor falsy flags stay batchable
  assertEq(only({ tool: 'browser.dom_snapshot', risk: 'low', category: 'observe', floor: false }).requiresSeparate, false, '7.flag false');
  assertEq(only({ tool: 'browser.dom_snapshot', risk: 'low', category: 'observe', floor: 0 }).requiresSeparate, false, '7.flag 0');
  assertEq(only({ tool: 'browser.dom_snapshot', risk: 'low', category: 'observe', floor: '' }).requiresSeparate, false, '7.flag empty str');
  assertEq(only({ tool: 'browser.dom_snapshot', risk: 'low', category: 'observe', floor: [] }).requiresSeparate, false, '7.flag empty arr');
  assertEq(only({ tool: 'browser.dom_snapshot', risk: 'low', category: 'observe', floor: NaN }).requiresSeparate, false, '7.flag NaN');
  // Unclassified and private-file signals stay exact; `display` is not a raw
  // substring false positive for payment, but it is still unknown.
  assertEq(only({ tool: 'ui.display', risk: 'low', category: 'display' }).requiresSeparate, true, '7.display unknown → exact');
  assertEq(only({ tool: 'read', risk: 'low', category: 'file_read' }).requiresSeparate, true, '7.file_read private → exact');

  // ── Group 8: determinism + first-index ordering ───────────────────────────
  {
    const pending = [readLow(), floorDelete, readLow(), editMed(), floorPay, editMed()];
    const a = planApprovalBatch(pending);
    const b = planApprovalBatch(pending);
    assertJson(a, b, '8.1 deterministic — identical plans for identical input');

    // a separate item at index 0 must sort before a later batch
    const p1 = planApprovalBatch([floorDelete, readLow(), readLow()]);
    assertJson(
      p1,
      {
        batches: [
          { indices: [0], combinedRisk: 'medium', requiresSeparate: true },
          { indices: [1, 2], combinedRisk: 'low', requiresSeparate: false },
        ],
        canBatch: true,
      },
      '8.2 leading floor sorts before trailing low batch',
    );
    // a batch whose first index precedes a later separate sorts first
    const p2 = planApprovalBatch([readLow(), floorDelete, readLow()]);
    assertJson(
      p2,
      {
        batches: [
          { indices: [0, 2], combinedRisk: 'low', requiresSeparate: false },
          { indices: [1], combinedRisk: 'medium', requiresSeparate: true },
        ],
        canBatch: true,
      },
      '8.3 low batch (min index 0) sorts before separate at index 1',
    );
    checkInvariants(pending, a, '8.inv');
  }

  // ── Group 9: bounds — huge input is capped, never blows up ────────────────
  {
    const big = new Array(600).fill(0).map(() => readLow());
    const p = planApprovalBatch(big);
    assertEq(p.batches.length, 1, '9.1 600 low items → still one batch');
    assertEq(p.batches[0].indices.length, 500, '9.2 processed capped at MAX_ITEMS (500)');
    assertEq(p.batches[0].indices[0], 0, '9.3 first index 0');
    assertEq(p.batches[0].indices[499], 499, '9.4 last processed index 499');
    assertEq(p.canBatch, true, '9.5 huge batch → canBatch true');
    checkInvariants(big, p, '9.inv');

    const bigFloors = new Array(700).fill(0).map(() => floorDelete);
    const pf = planApprovalBatch(bigFloors);
    assertEq(pf.batches.length, 500, '9.6 700 floors → 500 separate cards (capped)');
    assertEq(pf.canBatch, false, '9.7 all floors capped → canBatch false');
  }

  // ── Group 10: hostile inputs — TOTAL, never throws ────────────────────────
  const cyclic: any = { risk: 'low', category: 'read' };
  cyclic.self = cyclic;
  const throwAll: any = {
    get risk() { throw new Error('boom'); },
    get tool() { throw new Error('boom'); },
    get category() { throw new Error('boom'); },
    get floor() { throw new Error('boom'); },
  };
  const throwFloor: any = { risk: 'low', category: 'read', get floor() { throw new Error('boom'); } };
  const proxyThrow: any = new Proxy({}, { get() { throw new Error('boom'); } });
  const holey: any[] = [];
  holey[2] = readLow();
  holey.length = 3; // indices 0,1 are holes → undefined
  const hugeStr = { risk: 'low', category: 'x'.repeat(100000), tool: 'y'.repeat(100000) };
  const nested = { risk: 'low', category: 'read', extra: { a: [1, [2, [3, [4]]]] } };

  const hostile: any[] = [
    null,
    undefined,
    NaN,
    Infinity,
    -0,
    '',
    'string-not-array',
    Symbol('s'),
    () => 1,
    [null, undefined, 1, 'x', true, {}, [], NaN],
    [cyclic],
    [throwAll],
    [throwFloor],
    [proxyThrow],
    holey,
    [hugeStr],
    [nested],
    [readLow(), throwAll, floorPay, cyclic, unknownItem],
    new Array(1000).fill(0).map((_, i) => (i % 3 === 0 ? floorDelete : readLow())),
    [{ risk: 'low', category: 42 }, { risk: [], category: {} }, { tool: null, risk: null }],
    { length: 3, 0: readLow() }, // array-like but not an array
  ];
  let idx = 0;
  for (const input of hostile) {
    const p = noThrow(() => planApprovalBatch(input), '10.' + idx + ' no-throw ' + jstr(typeof input));
    if (p) {
      assert(Array.isArray(p.batches) && typeof p.canBatch === 'boolean', '10.' + idx + ' shape ' + jstr(typeof input));
      if (Array.isArray(input)) checkInvariants(input, p, '10.' + idx + '.inv');
    }
    idx++;
  }

  // specific fail-closed expectations on hostile shapes
  assertEq(only(cyclic).requiresSeparate, false, '10.a cyclic low read stays batchable (no serialization)');
  assertEq(only(cyclic).combinedRisk, 'low', '10.b cyclic risk read correctly');
  assertEq(only(throwAll).requiresSeparate, true, '10.c all-throwing item → own separate card');
  assertEq(only(throwAll).combinedRisk, 'unknown', '10.d all-throwing item → unknown risk');
  assertEq(only(throwFloor).requiresSeparate, true, '10.e throwing floor getter → fail closed to separate');
  assertEq(only(proxyThrow).requiresSeparate, true, '10.f throwing proxy → separate');
  assertEq(planApprovalBatch({ length: 3, 0: readLow() } as any).batches.length, 0, '10.g array-like (not array) → neutral');

  // ── Group 11: mixed realistic queue end-to-end ────────────────────────────
  {
    const queue = [
      readLow('observe'),         // 0 low
      readLow('inspection'),      // 1 low
      editMed('reversible'),      // 2 medium
      floorLogin,                 // 3 floor (login)
      readLow('search'),          // 4 low
      floorPay,                   // 5 floor (pay)
      critDeploy,                 // 6 critical
    ];
    const p = planApprovalBatch(queue);
    assertJson(
      p,
      {
        batches: [
          { indices: [0, 1, 4], combinedRisk: 'low', requiresSeparate: false },
          { indices: [2], combinedRisk: 'medium', requiresSeparate: false },
          { indices: [3], combinedRisk: 'low', requiresSeparate: true },
          { indices: [5], combinedRisk: 'high', requiresSeparate: true },
          { indices: [6], combinedRisk: 'critical', requiresSeparate: true },
        ],
        canBatch: true,
      },
      '11.1 realistic queue: 3 reads bundled, 1 lone medium, 3 floors/critical separate',
    );
    // one tap clears the 3 reads; each floor still needs explicit consent
    const sharedCards = p.batches.filter((b) => !b.requiresSeparate);
    const floorCards = p.batches.filter((b) => b.requiresSeparate);
    assertEq(sharedCards.length, 2, '11.2 two shareable cards (low bundle + lone medium)');
    assertEq(floorCards.length, 3, '11.3 three cards demand individual consent');
    checkInvariants(queue, p, '11.inv');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = passes + failures;
  if (failures > 0) {
    console.error(`\n❌ openswanApprovalBatchCore smoke: ${passes}/${total} passed, ${failures} FAILED`);
    process.exit(1);
  }
  console.log(`✅ openswanApprovalBatchCore smoke: all ${passes} assertions passed`);
}

main();
