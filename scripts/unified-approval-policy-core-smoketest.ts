/**
 * Smoke: unifiedApprovalPolicyCore — the ONE folded HITL approval policy.
 *
 * Pins the precedence contract every lane depends on (CONSOLIDATE #2 of
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md):
 *   forbidden → blocked  >  floor → require (never auto)  >  tool-auto/safe →
 *   auto  >  user-auto category → auto  >  default → require (fail-closed).
 *
 * Run: npx tsx scripts/unified-approval-policy-core-smoketest.ts
 */

import {
  resolveApprovalDecision,
  ALWAYS_ASK_FLOOR_MARKERS,
  type ApprovalPolicyInput,
} from '../src/lib/unifiedApprovalPolicyCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Handy shorthand — call the policy and read the kind.
function kind(input: ApprovalPolicyInput): string {
  return resolveApprovalDecision(input).kind;
}

function main() {
  // ── Group 1: user-forbidden → blocked (highest precedence) ────────────────
  assertEq(kind({ userConstraintsBlock: true }), 'blocked', '1.1 blanket forbidden true → blocked');
  assertEq(
    kind({ userConstraintsBlock: ['delete'], category: 'delete' }),
    'blocked',
    '1.2 forbidden list containing category → blocked',
  );
  assertEq(
    kind({ userConstraintsBlock: new Set(['memory_write']), category: 'memory_write' }),
    'blocked',
    '1.3 forbidden Set containing category → blocked',
  );
  assertEq(
    kind({ userConstraintsBlock: 'external_publish', category: 'external_publish' }),
    'blocked',
    '1.4 forbidden string equal to category → blocked',
  );
  assertEq(
    kind({ userConstraintsBlock: ['send'], category: 'browser_click' }),
    'require_approval',
    '1.5 forbidden list NOT containing category → not blocked',
  );
  assertEq(
    kind({ userConstraintsBlock: [], category: 'memory_read' }),
    'require_approval',
    '1.6 empty forbidden list → not blocked',
  );
  assertEq(
    kind({ userConstraintsBlock: '', category: 'memory_read' }),
    'require_approval',
    '1.7 empty forbidden string → not blocked',
  );
  {
    const d = resolveApprovalDecision({ userConstraintsBlock: true, category: 'skill_run' });
    assertEq(d.kind, 'blocked', '1.8 blocked decision kind');
    assertEq(d.category, 'skill_run', '1.9 blocked echoes normalized category');
    assert(typeof d.reason === 'string' && d.reason.length > 0, '1.10 blocked reason non-empty');
  }

  // ── Group 2: always-confirm floor → require, NEVER auto ───────────────────
  assertEq(kind({ isFloorAction: true }), 'require_approval', '2.1 floor true → require');
  assertEq(
    kind({ isFloorAction: 'pay' }),
    'require_approval',
    '2.2 floor marker string → require',
  );
  assertEq(
    kind({ isFloorAction: ['delete'] }),
    'require_approval',
    '2.3 floor list → require',
  );
  // The load-bearing guarantee: floor beats an auto-approved category.
  assertEq(
    kind({ isFloorAction: true, category: 'memory_read', userAutoApprove: ['memory_read'] }),
    'require_approval',
    '2.4 floor beats user-auto category',
  );
  // …and beats tool 'auto' + non-mutating.
  assertEq(
    kind({
      isFloorAction: true,
      toolApprovalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
    }),
    'require_approval',
    '2.5 floor beats tool-auto safe path',
  );
  // …and beats BOTH auto signals at once.
  assertEq(
    kind({
      isFloorAction: 'grant',
      toolApprovalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
      category: 'browser_click',
      userAutoApprove: ['browser_click'],
    }),
    'require_approval',
    '2.6 floor beats every auto path combined',
  );
  // Defense-in-depth: a floor-marker category floors even without isFloorAction.
  for (const m of ALWAYS_ASK_FLOOR_MARKERS) {
    assertEq(
      kind({ category: m, userAutoApprove: [m], toolApprovalMode: 'auto' }),
      'require_approval',
      '2.7 floor-marker category ' + m + ' forces require',
    );
  }
  // Falsy floor signals do NOT floor.
  assertEq(kind({ isFloorAction: false }), 'require_approval', '2.8 floor false → falls through (default require)');
  assertEq(
    kind({ isFloorAction: false, toolApprovalMode: 'auto', mutatesState: false, externalSideEffect: false }),
    'auto_approve',
    '2.9 floor false does not block a safe auto path',
  );
  assertEq(kind({ isFloorAction: [] }), 'require_approval', '2.10 empty floor list → not floor');
  assertEq(kind({ isFloorAction: 0 }), 'require_approval', '2.11 floor 0 → not floor');
  {
    const d = resolveApprovalDecision({ isFloorAction: true });
    assert(/floor/i.test(d.reason), '2.12 floor reason mentions floor', d.reason);
  }

  // ── Group 3: tool policy 'auto' + provably safe → auto_approve ────────────
  assertEq(
    kind({ toolApprovalMode: 'auto', mutatesState: false, externalSideEffect: false }),
    'auto_approve',
    '3.1 auto + non-mutating + non-external → auto',
  );
  assertEq(kind({ toolApprovalMode: 'auto' }), 'auto_approve', '3.2 auto + absent flags → auto');
  assertEq(kind({ toolApprovalMode: 'AUTO' }), 'auto_approve', '3.3 mode case-insensitive');
  assertEq(kind({ toolApprovalMode: '  auto ' }), 'auto_approve', '3.4 mode trims whitespace');
  // Tightening: an 'auto' tool that mutates does NOT auto via the tool path.
  assertEq(
    kind({ toolApprovalMode: 'auto', mutatesState: true }),
    'require_approval',
    '3.5 auto + mutatesState → require (tightened)',
  );
  assertEq(
    kind({ toolApprovalMode: 'auto', externalSideEffect: true }),
    'require_approval',
    '3.6 auto + externalSideEffect → require (tightened)',
  );
  // 'ask' mode never auto via the tool path.
  assertEq(
    kind({ toolApprovalMode: 'ask', mutatesState: false, externalSideEffect: false }),
    'require_approval',
    '3.7 ask mode → require even when safe',
  );
  {
    const d = resolveApprovalDecision({ toolApprovalMode: 'auto' });
    assert(typeof d.reason === 'string' && d.reason.length > 0, '3.8 tool-auto reason non-empty');
    assertEq(d.category, undefined, '3.9 no category → category omitted');
  }
  // But an 'auto' MUTATING tool the user opted into by category still autos.
  assertEq(
    kind({ toolApprovalMode: 'auto', mutatesState: true, category: 'memory_write', userAutoApprove: ['memory_write'] }),
    'auto_approve',
    '3.10 mutating auto tool rescued by user-auto category',
  );

  // ── Group 4: user-auto category → auto_approve ────────────────────────────
  assertEq(
    kind({ category: 'memory_read', userAutoApprove: ['memory_read'] }),
    'auto_approve',
    '4.1 category in auto list → auto',
  );
  assertEq(
    kind({ category: 'memory_read', userAutoApprove: new Set(['memory_read']) }),
    'auto_approve',
    '4.2 category in auto Set → auto',
  );
  assertEq(
    kind({ category: 'skill_run', userAutoApprove: 'skill_run' }),
    'auto_approve',
    '4.3 category equal to auto string → auto',
  );
  assertEq(
    kind({ category: 'MEMORY_READ', userAutoApprove: ['memory_read'] }),
    'auto_approve',
    '4.4 category match is case-insensitive',
  );
  assertEq(
    kind({ category: 'memory_write', userAutoApprove: ['memory_read'] }),
    'require_approval',
    '4.5 category NOT in auto list → require',
  );
  // Blanket `true` is NOT honored for auto (strict / never over-approve).
  assertEq(
    kind({ category: 'memory_read', userAutoApprove: true }),
    'require_approval',
    '4.6 blanket true userAutoApprove NOT honored',
  );
  // No category → cannot be an auto-approved category.
  assertEq(
    kind({ userAutoApprove: ['memory_read'] }),
    'require_approval',
    '4.7 auto list but no category → require',
  );
  {
    const d = resolveApprovalDecision({ category: 'browser_click', userAutoApprove: ['browser_click'] });
    assertEq(d.category, 'browser_click', '4.8 auto decision echoes category');
  }

  // ── Group 5: default + fail-closed on unknown ─────────────────────────────
  assertEq(kind({}), 'require_approval', '5.1 empty input → require');
  assertEq(kind({ toolApprovalMode: 'weird' }), 'require_approval', '5.2 unknown mode → require');
  assertEq(kind({ toolApprovalMode: 'ask' }), 'require_approval', '5.3 ask → require');
  assertEq(kind({ category: 'memory_write' }), 'require_approval', '5.4 bare category → require');
  assertEq(
    kind({ toolApprovalMode: undefined, mutatesState: undefined, category: undefined }),
    'require_approval',
    '5.5 all undefined → require',
  );
  assertEq(
    kind({ toolApprovalMode: 1 as unknown, mutatesState: 'yes' as unknown }),
    'require_approval',
    '5.6 numeric mode / string flag → require',
  );
  // 'false' string flag reads as truthy (fail-closed: treat as mutating).
  assertEq(
    kind({ toolApprovalMode: 'auto', mutatesState: 'false' as unknown }),
    'require_approval',
    "5.7 string 'false' mutates flag is conservatively truthy → require",
  );
  {
    const d = resolveApprovalDecision({});
    assert(/fail-closed/i.test(d.reason), '5.8 default reason marks fail-closed', d.reason);
  }

  // ── Group 6: precedence ordering (forbidden > floor > autos > default) ─────
  assertEq(
    kind({ userConstraintsBlock: true, isFloorAction: true }),
    'blocked',
    '6.1 forbidden beats floor',
  );
  assertEq(
    kind({
      userConstraintsBlock: true,
      toolApprovalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
    }),
    'blocked',
    '6.2 forbidden beats tool-auto',
  );
  assertEq(
    kind({ userConstraintsBlock: ['memory_read'], category: 'memory_read', userAutoApprove: ['memory_read'] }),
    'blocked',
    '6.3 forbidden beats user-auto category',
  );
  assertEq(
    kind({ isFloorAction: true, toolApprovalMode: 'auto', mutatesState: false, externalSideEffect: false }),
    'require_approval',
    '6.4 floor beats tool-auto',
  );
  // Determinism: same input twice → identical decision object shape.
  {
    const a = resolveApprovalDecision({ category: 'skill_run', userAutoApprove: ['skill_run'] });
    const b = resolveApprovalDecision({ category: 'skill_run', userAutoApprove: ['skill_run'] });
    assertEq(a.kind, b.kind, '6.5 deterministic kind');
    assertEq(a.category, b.category, '6.6 deterministic category');
    assertEq(a.reason, b.reason, '6.7 deterministic reason');
  }

  // ── Group 7: hostile / totality — every export must be no-throw ────────────
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    NaN,
    '',
    'x'.repeat(100000),
    [],
    {},
    { category: {} },
    { category: 123 },
    { category: Symbol('s') },
    { userConstraintsBlock: Symbol('f') },
    { userAutoApprove: 42 },
    { userAutoApprove: { memory_read: true } },
    { isFloorAction: {} },
    { isFloorAction: NaN },
    { isFloorAction: -0 },
    { toolApprovalMode: {} },
    true,
    false,
    123,
    'string-not-object',
    () => 'nope',
    [1, 2, 3],
    new Map([['a', 1]]),
  ];
  for (let i = 0; i < hostile.length; i++) {
    let threw = false;
    let out: ApprovalDecision | null = null;
    try {
      out = resolveApprovalDecision(hostile[i] as ApprovalPolicyInput);
    } catch {
      threw = true;
    }
    assert(!threw, '7.h no-throw on hostile input #' + i);
    assert(
      !!out && (out.kind === 'auto_approve' || out.kind === 'require_approval' || out.kind === 'blocked'),
      '7.k valid kind on hostile input #' + i,
    );
    assert(!!out && typeof out.reason === 'string', '7.r string reason on hostile input #' + i);
  }
  // Cyclic object must not throw.
  {
    const cyc: any = { category: 'memory_read' };
    cyc.self = cyc;
    cyc.userAutoApprove = ['memory_read'];
    let threw = false;
    try {
      resolveApprovalDecision(cyc);
    } catch {
      threw = true;
    }
    assert(!threw, '7.c1 no-throw on cyclic input');
  }
  // Throwing getters must be caught and fail closed.
  {
    const evil: any = {};
    Object.defineProperty(evil, 'mutatesState', {
      get() {
        throw new Error('boom');
      },
      enumerable: true,
    });
    let threw = false;
    let out: ApprovalDecision | null = null;
    try {
      out = resolveApprovalDecision(evil);
    } catch {
      threw = true;
    }
    assert(!threw, '7.c2 no-throw on throwing getter');
    assertEq(out ? out.kind : 'threw', 'require_approval', '7.c3 throwing getter fails closed');
  }
  // Huge forbidden list is bounded, still resolves.
  {
    const big = new Array(50000).fill('memory_read');
    assertEq(
      kind({ userConstraintsBlock: big, category: 'memory_read' }),
      'blocked',
      '7.b1 huge forbidden list still matches (bounded)',
    );
  }

  // ── Group 8: ALWAYS_ASK_FLOOR_MARKERS constant contract ───────────────────
  assert(Array.isArray(ALWAYS_ASK_FLOOR_MARKERS), '8.1 markers is an array');
  assertEq(ALWAYS_ASK_FLOOR_MARKERS.length, 4, '8.2 exactly four floor markers');
  assert(ALWAYS_ASK_FLOOR_MARKERS.includes('pay'), '8.3 includes pay');
  assert(ALWAYS_ASK_FLOOR_MARKERS.includes('delete'), '8.4 includes delete');
  assert(ALWAYS_ASK_FLOOR_MARKERS.includes('login'), '8.5 includes login');
  assert(ALWAYS_ASK_FLOOR_MARKERS.includes('grant'), '8.6 includes grant');
  // Mirrors computerGrantGate.STICKY_FLOOR_CATEGORIES order.
  assertEq(ALWAYS_ASK_FLOOR_MARKERS.join(','), 'pay,delete,login,grant', '8.7 canonical order preserved');

  // ── Group 9: floor markers substring-match category + tool (defense-in-depth) ──
  assertEq(kind({ category: 'delete_file' }), 'require_approval', '9.1 variant category delete_file floors via substring');
  assertEq(kind({ category: 'paywall_purchase' }), 'require_approval', '9.2 paywall category floors (contains pay)');
  assertEq(kind({ tool: 'desktop.delete' }), 'require_approval', '9.3 floor-ish tool floors even without isFloorAction');
  assertEq(kind({ tool: 'browser.login_field', category: 'credential' }), 'require_approval', '9.4 login tool floors via substring');
  assertEq(kind({ tool: 'files.delete_all', toolApprovalMode: 'auto' }), 'require_approval', '9.5 floor tool beats tool-auto mode');
  assertEq(kind({ category: 'memory_read', tool: 'memory.read', toolApprovalMode: 'auto' }), 'auto_approve', '9.6 non-floor auto tool unaffected (no false floor)');
  assertEq(kind({ tool: 42 as unknown }), 'require_approval', '9.7 hostile non-string tool → no throw, safe default');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll unified-approval-policy-core smoke cases passed (' + passes + ' passed).');
}
main();
