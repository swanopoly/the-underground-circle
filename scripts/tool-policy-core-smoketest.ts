// Smoke test for src/lib/toolPolicyCore.ts — the pure per-tool approval
// governance core. Run: npx tsx scripts/tool-policy-core-smoketest.ts
//
// Covers: floor overriding an explicit 'auto' policy; blocked staying blocked
// even under a floor; rate-limit tripping to 'ask' at the cap and resetting
// after the window prunes; scope specificity (exact beats wildcard); unknown
// tool failing closed to 'ask'; recordToolUse immutability + pruning + sorting;
// requireReview forcing 'ask'; and input-guarding (never throws).

import {
  FLOOR_ACTION_CATEGORIES,
  isFloorAction,
  resolveToolPolicy,
  checkToolPolicy,
  recordToolUse,
  type ToolPolicy,
  type ToolUsageWindow,
} from '../src/lib/toolPolicyCore';

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  assert(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

const NOW = 1_000_000_000_000; // fixed deterministic clock
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// FLOOR_ACTION_CATEGORIES + isFloorAction
// ---------------------------------------------------------------------------
eq(FLOOR_ACTION_CATEGORIES.length, 4, 'floor has 4 categories');
assert(FLOOR_ACTION_CATEGORIES.includes('pay' as never), 'floor includes pay');
assert(FLOOR_ACTION_CATEGORIES.includes('delete' as never), 'floor includes delete');
assert(FLOOR_ACTION_CATEGORIES.includes('login' as never), 'floor includes login');
assert(FLOOR_ACTION_CATEGORIES.includes('grant' as never), 'floor includes grant');

eq(isFloorAction(['pay']), true, 'isFloorAction: pay is floor');
eq(isFloorAction(['read', 'delete']), true, 'isFloorAction: delete among tags is floor');
eq(isFloorAction(['PAY']), true, 'isFloorAction: case-insensitive');
eq(isFloorAction(['  grant  ']), true, 'isFloorAction: trims whitespace');
eq(isFloorAction(['read', 'write']), false, 'isFloorAction: non-floor tags');
eq(isFloorAction([]), false, 'isFloorAction: empty array is not floor');
eq(isFloorAction(undefined), false, 'isFloorAction: undefined is not floor');
eq(isFloorAction('pay' as never), false, 'isFloorAction: non-array is not floor (guarded)');
eq(isFloorAction([123 as never, 'pay']), true, 'isFloorAction: skips non-strings, finds floor');

// ---------------------------------------------------------------------------
// resolveToolPolicy — specificity
// ---------------------------------------------------------------------------
const policies: ToolPolicy[] = [
  { toolId: 'browser.open', scope: '*', mode: 'ask' },
  { toolId: 'browser.open', scope: 'example.com', mode: 'auto' },
  { toolId: 'local.run_shell', scope: '', mode: 'ask' },
  { toolId: 'pay.charge', scope: '*', mode: 'auto' }, // deliberately auto to test floor
];

const exactHit = resolveToolPolicy('browser.open', 'example.com', policies);
eq(exactHit?.mode, 'auto', 'resolve: exact scope beats wildcard');
eq(exactHit?.scope, 'example.com', 'resolve: returns the exact-scope policy');

const wildcardHit = resolveToolPolicy('browser.open', 'other.com', policies);
eq(wildcardHit?.mode, 'ask', 'resolve: falls back to * wildcard');
eq(wildcardHit?.scope, '*', 'resolve: wildcard policy returned when no exact');

const emptyWildcardHit = resolveToolPolicy('local.run_shell', 'anything', policies);
eq(emptyWildcardHit?.mode, 'ask', "resolve: '' scope acts as wildcard");

eq(resolveToolPolicy('nope.tool', 'x', policies), null, 'resolve: no match -> null');
eq(resolveToolPolicy('', 'x', policies), null, 'resolve: empty toolId -> null');
eq(resolveToolPolicy('browser.open', 'x', undefined as never), null, 'resolve: non-array policies -> null');

// first-in-array wins among equal specificity (two exact matches)
const dupExact: ToolPolicy[] = [
  { toolId: 't', scope: 's', mode: 'auto' },
  { toolId: 't', scope: 's', mode: 'ask' },
];
eq(resolveToolPolicy('t', 's', dupExact)?.mode, 'auto', 'resolve: first exact wins among equals');

// malformed entries are skipped
const messy: ToolPolicy[] = [
  null as never,
  { toolId: 't', scope: 's', mode: 'nonsense' as never },
  { toolId: 't', scope: 's', mode: 'ask' },
];
eq(resolveToolPolicy('t', 's', messy)?.mode, 'ask', 'resolve: skips null + invalid mode');

// requesting a wildcard scope directly matches the wildcard policy exactly
eq(resolveToolPolicy('browser.open', '*', policies)?.scope, '*', 'resolve: requesting * matches * policy');

// ---------------------------------------------------------------------------
// checkToolPolicy — FLOOR overrides
// ---------------------------------------------------------------------------
const floorOverAuto = checkToolPolicy({
  toolId: 'pay.charge',
  scope: 'stripe',
  actionTags: ['pay'],
  policies,
  now: NOW,
});
eq(floorOverAuto.decision, 'ask', 'floor: overrides an explicit auto policy -> ask');
eq(floorOverAuto.floorEnforced, true, 'floor: floorEnforced true');
assert(floorOverAuto.reason.includes('pay'), 'floor: reason mentions the floor category');
assert(floorOverAuto.reason.toLowerCase().includes('floor'), 'floor: reason mentions the floor');

// a plain auto tool WITHOUT a floor tag stays auto (control)
const plainAuto = checkToolPolicy({
  toolId: 'browser.open',
  scope: 'example.com',
  actionTags: ['read'],
  policies,
  now: NOW,
});
eq(plainAuto.decision, 'auto', 'control: non-floor auto policy stays auto');
eq(plainAuto.floorEnforced, false, 'control: floorEnforced false without floor tag');

// ---------------------------------------------------------------------------
// checkToolPolicy — BLOCKED wins even under floor
// ---------------------------------------------------------------------------
const blockedPolicies: ToolPolicy[] = [{ toolId: 'danger.delete', scope: '*', mode: 'blocked' }];
const blockedUnderFloor = checkToolPolicy({
  toolId: 'danger.delete',
  scope: 'db',
  actionTags: ['delete'],
  policies: blockedPolicies,
  now: NOW,
});
eq(blockedUnderFloor.decision, 'blocked', 'blocked: stays blocked even under floor');
eq(blockedUnderFloor.floorEnforced, true, 'blocked: still reports floorEnforced for the floor tag');
assert(blockedUnderFloor.reason.toLowerCase().includes('block'), 'blocked: reason mentions blocked');

const blockedNoFloor = checkToolPolicy({
  toolId: 'danger.delete',
  scope: 'db',
  actionTags: ['read'],
  policies: blockedPolicies,
  now: NOW,
});
eq(blockedNoFloor.decision, 'blocked', 'blocked: blocked without floor tag');
eq(blockedNoFloor.floorEnforced, false, 'blocked: floorEnforced false without floor tag');

// ---------------------------------------------------------------------------
// checkToolPolicy — requireReview forces ask
// ---------------------------------------------------------------------------
const reviewPolicies: ToolPolicy[] = [{ toolId: 'deploy.ship', scope: 'prod', mode: 'auto', requireReview: true }];
const reviewForced = checkToolPolicy({
  toolId: 'deploy.ship',
  scope: 'prod',
  actionTags: ['deploy'],
  policies: reviewPolicies,
  now: NOW,
});
eq(reviewForced.decision, 'ask', 'requireReview: forces ask over auto');
eq(reviewForced.floorEnforced, false, 'requireReview: not a floor');
assert(reviewForced.reason.toLowerCase().includes('review'), 'requireReview: reason mentions review');

// ---------------------------------------------------------------------------
// checkToolPolicy — unknown tool fails closed
// ---------------------------------------------------------------------------
const unknown = checkToolPolicy({ toolId: 'mystery.tool', scope: 'x', policies, now: NOW });
eq(unknown.decision, 'ask', 'unknown: fails closed to ask');
eq(unknown.rateRemaining, null, 'unknown: no cap -> rateRemaining null');
eq(unknown.floorEnforced, false, 'unknown: not a floor');

// input guarding — never throws even on garbage
const garbage = checkToolPolicy({} as never);
eq(garbage.decision, 'ask', 'guard: empty args -> ask (never throws)');
eq(garbage.floorEnforced, false, 'guard: empty args floorEnforced false');

// ---------------------------------------------------------------------------
// checkToolPolicy — RATE LIMITING
// ---------------------------------------------------------------------------
const ratePolicies: ToolPolicy[] = [{ toolId: 'api.call', scope: 'svc', mode: 'auto', maxPerDay: 3 }];

// zero uses -> auto, remaining = cap
const rate0 = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: {}, now: NOW });
eq(rate0.decision, 'auto', 'rate: under cap -> auto');
eq(rate0.rateRemaining, 3, 'rate: remaining = cap when unused');

// two uses within window -> auto, remaining = 1
const twoUses: ToolUsageWindow = { 'api.call::svc': [NOW - 1000, NOW - 2000] };
const rate2 = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: twoUses, now: NOW });
eq(rate2.decision, 'auto', 'rate: 2 of 3 -> still auto');
eq(rate2.rateRemaining, 1, 'rate: remaining reflects count in window');

// at the cap -> ask, remaining 0, reason 'rate limit'
const threeUses: ToolUsageWindow = { 'api.call::svc': [NOW - 1000, NOW - 2000, NOW - 3000] };
const rateAtCap = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: threeUses, now: NOW });
eq(rateAtCap.decision, 'ask', 'rate: at cap -> ask');
eq(rateAtCap.rateRemaining, 0, 'rate: at cap -> remaining 0');
eq(rateAtCap.reason, 'rate limit', "rate: reason is 'rate limit'");

// over the cap -> still ask, remaining stays 0 (clamped)
const fourUses: ToolUsageWindow = { 'api.call::svc': [NOW - 1000, NOW - 2000, NOW - 3000, NOW - 4000] };
const rateOver = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: fourUses, now: NOW });
eq(rateOver.decision, 'ask', 'rate: over cap -> ask');
eq(rateOver.rateRemaining, 0, 'rate: over cap -> remaining clamped to 0');

// stale uses OUTSIDE the window do not count -> resets to auto
const staleUses: ToolUsageWindow = { 'api.call::svc': [NOW - DAY - 1000, NOW - DAY - 2000, NOW - DAY - 3000] };
const rateStale = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: staleUses, now: NOW });
eq(rateStale.decision, 'auto', 'rate: stale uses pruned from window -> auto again');
eq(rateStale.rateRemaining, 3, 'rate: stale uses do not decrement remaining');

// custom windowMs is honored — a tighter window prunes recent-but-old entries
const customWin = checkToolPolicy({
  toolId: 'api.call',
  scope: 'svc',
  policies: ratePolicies,
  usage: { 'api.call::svc': [NOW - 5000, NOW - 6000, NOW - 7000] },
  now: NOW,
  windowMs: 4000, // only entries within last 4s count -> none -> auto
});
eq(customWin.decision, 'auto', 'rate: custom windowMs prunes entries outside it');

// rate cap keyed per (toolId,scope) — usage under a DIFFERENT scope doesn't count
const otherScopeUsage: ToolUsageWindow = { 'api.call::other': [NOW - 1000, NOW - 2000, NOW - 3000] };
const rateScoped = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: otherScopeUsage, now: NOW });
eq(rateScoped.decision, 'auto', 'rate: usage under a different scope key does not count');

// floor beats rate: even under cap, a floor tag forces ask (and floorEnforced)
const floorBeatsRate = checkToolPolicy({
  toolId: 'api.call',
  scope: 'svc',
  actionTags: ['login'],
  policies: ratePolicies,
  usage: {},
  now: NOW,
});
eq(floorBeatsRate.decision, 'ask', 'order: floor forces ask even when under rate cap');
eq(floorBeatsRate.floorEnforced, true, 'order: floorEnforced true under-cap floor');

// ---------------------------------------------------------------------------
// recordToolUse — immutability, append, prune, sort
// ---------------------------------------------------------------------------
const startUsage: ToolUsageWindow = { 'api.call::svc': [NOW - 1000] };
const afterRecord = recordToolUse(startUsage, 'api.call', 'svc', NOW);
assert(afterRecord !== startUsage, 'record: returns a new object (not same ref)');
assert(afterRecord['api.call::svc'] !== startUsage['api.call::svc'], 'record: new array (not same ref)');
eq(startUsage['api.call::svc'].length, 1, 'record: input array not mutated');
eq(afterRecord['api.call::svc'].length, 2, 'record: appended new timestamp');
eq(afterRecord['api.call::svc'][afterRecord['api.call::svc'].length - 1], NOW, 'record: new timestamp is present');

// sorted ascending even when existing entries are unsorted (defensive ordering)
const outOfOrder = recordToolUse({ 'k::s': [NOW - 1000, NOW - 5000, NOW - 3000] }, 'k', 's', NOW);
const arr = outOfOrder['k::s'];
eq(arr.length, 4, 'record: all in-window entries retained + new one');
assert(arr[0] <= arr[1] && arr[1] <= arr[2] && arr[2] <= arr[3], 'record: timestamps sorted ascending');

// a future timestamp (> now) in existing entries is pruned (never counts)
const futurePruned = recordToolUse({ 'k::s': [NOW + 5000, NOW - 100] }, 'k', 's', NOW);
eq(futurePruned['k::s'].length, 2, 'record: future entry pruned, in-window + new kept');
assert(!futurePruned['k::s'].includes(NOW + 5000), 'record: future timestamp pruned');

// prunes entries older than the window
const withStale = recordToolUse({ 'api.call::svc': [NOW - DAY - 1, NOW - 100] }, 'api.call', 'svc', NOW);
eq(withStale['api.call::svc'].length, 2, 'record: prunes stale, keeps in-window + new');
assert(!withStale['api.call::svc'].includes(NOW - DAY - 1), 'record: stale entry pruned');

// creates the key if absent, preserves other keys
const fresh = recordToolUse({ 'other::x': [NOW - 10] }, 'new.tool', 'z', NOW);
eq(fresh['new.tool::z'].length, 1, 'record: creates missing key');
eq(fresh['other::x'].length, 1, 'record: preserves unrelated keys');
assert(fresh['other::x'] !== undefined, 'record: unrelated key still present');

// custom windowMs honored on prune
const tightPrune = recordToolUse({ 'k::s': [NOW - 5000] }, 'k', 's', NOW, 4000);
eq(tightPrune['k::s'].length, 1, 'record: custom windowMs prunes out-of-window, keeps only new');
eq(tightPrune['k::s'][0], NOW, 'record: only the new timestamp remains');

// guarded: garbage inputs never throw
const guarded = recordToolUse(undefined as never, undefined as never, undefined as never, NaN as never);
assert(typeof guarded === 'object' && guarded !== null, 'record: garbage inputs -> safe object (never throws)');

// round-trip: recording up to the cap then checking trips the rate limit
let win: ToolUsageWindow = {};
win = recordToolUse(win, 'api.call', 'svc', NOW - 3000);
win = recordToolUse(win, 'api.call', 'svc', NOW - 2000);
win = recordToolUse(win, 'api.call', 'svc', NOW - 1000);
const afterThree = checkToolPolicy({ toolId: 'api.call', scope: 'svc', policies: ratePolicies, usage: win, now: NOW });
eq(afterThree.decision, 'ask', 'round-trip: recording to cap then check -> ask');
eq(afterThree.rateRemaining, 0, 'round-trip: remaining 0 at cap');

// ---------------------------------------------------------------------------
console.log(`tool-policy-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
