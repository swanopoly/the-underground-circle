// Smoke test for src/lib/openswanLaunchReadinessCore.ts
// Run: npx tsx scripts/openswan-launch-readiness-core-smoketest.ts
//
// Verifies the pure OpenSwan Control Panel launch-readiness gate: the grade ladder
// (blocked > review > ready), the canLaunch gate, blocker/warning/chip derivation,
// bridge-state warnings, set-dedupe + bounds, and total no-throw behavior on hostile,
// huge, and cyclic inputs.

import {
  resolveLaunchReadiness,
  type LaunchReadiness,
  type LaunchReadinessInput,
} from '../src/lib/openswanLaunchReadinessCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

const GRADES = new Set(['blocked', 'review', 'ready']);

// Invariant checker reused across the hostile battery.
function assertShape(r: LaunchReadiness, label: string) {
  assert(!!r && typeof r === 'object', label + ': returns object');
  assert(GRADES.has(r.grade), label + ': grade in set', String(r && r.grade));
  assertEq(r.canLaunch, r.grade !== 'blocked', label + ': canLaunch matches grade');
  assert(Array.isArray(r.blockers), label + ': blockers array');
  assert(Array.isArray(r.warnings), label + ': warnings array');
  assert(Array.isArray(r.chips), label + ': chips array');
  assert(r.blockers.length <= 5, label + ': blockers bounded', String(r.blockers.length));
  assert(r.warnings.length <= 3, label + ': warnings bounded', String(r.warnings.length));
  assert(r.chips.length <= 4, label + ': chips bounded', String(r.chips.length));
  assert(
    r.blockers.every((x) => typeof x === 'string' && x.length > 0),
    label + ': blockers all non-empty strings',
  );
  assert(
    r.warnings.every((x) => typeof x === 'string' && x.length > 0),
    label + ': warnings all non-empty strings',
  );
  assert(
    r.chips.every((x) => typeof x === 'string' && x.length > 0),
    label + ': chips all non-empty strings',
  );
  // Bounded-unique guarantee.
  assertEq(new Set(r.blockers).size, r.blockers.length, label + ': blockers deduped');
  assertEq(new Set(r.warnings).size, r.warnings.length, label + ': warnings deduped');
  assertEq(new Set(r.chips).size, r.chips.length, label + ': chips deduped');
}

function main() {
  // 1) Shape + neutral default (empty input → ready, launchable, nothing flagged).
  const empty = resolveLaunchReadiness({});
  assertShape(empty, 'empty');
  assertEq(empty.grade, 'ready', 'empty → ready');
  assertEq(empty.canLaunch, true, 'empty → canLaunch true');
  assertEq(empty.blockers.length, 0, 'empty → no blockers');
  assertEq(empty.warnings.length, 0, 'empty → no warnings');
  assertEq(empty.chips.length, 0, 'empty → no chips');

  // 2) Bracket placeholder → blocked + canLaunch false.
  const bracket = resolveLaunchReadiness({ hasBracketPlaceholder: true });
  assertShape(bracket, 'bracket');
  assertEq(bracket.grade, 'blocked', 'bracket → blocked');
  assertEq(bracket.canLaunch, false, 'bracket → canLaunch false');
  assertEq(bracket.blockers.length, 1, 'bracket → one blocker');
  assert(bracket.blockers[0].includes('bracketed placeholders'), 'bracket → placeholder copy');
  // A falsey flag does NOT block.
  assertEq(
    resolveLaunchReadiness({ hasBracketPlaceholder: false }).grade,
    'ready',
    'bracket false → ready',
  );

  // 3) All clear → ready + canLaunch true (with benign chips present).
  const clear = resolveLaunchReadiness({
    bridgeState: 'paired',
    hasSubagentAccess: true,
    hasVaultTools: true,
    runLabel: 'Browse and summarize',
    costLabel: '~$0.005 · 1.2K in',
  });
  assertShape(clear, 'clear');
  assertEq(clear.grade, 'ready', 'clear → ready');
  assertEq(clear.canLaunch, true, 'clear → canLaunch true');
  assertEq(clear.blockers.length, 0, 'clear → no blockers');
  assertEq(clear.warnings.length, 0, 'clear (paired) → no warnings');
  assertEq(clear.chips.length, 4, 'clear → four chips');

  // 4) Capability audit failure — boolean vs. string detail.
  const capBool = resolveLaunchReadiness({ capabilityAuditFailed: true });
  assertShape(capBool, 'capBool');
  assertEq(capBool.grade, 'blocked', 'capability bool → blocked');
  assertEq(capBool.canLaunch, false, 'capability bool → canLaunch false');
  assertEq(capBool.blockers[0], 'Capability audit failed.', 'capability bool → generic copy');
  const capStr = resolveLaunchReadiness({ capabilityAuditFailed: 'timeout probing bridge' });
  assertEq(capStr.grade, 'blocked', 'capability string → blocked');
  assertEq(
    capStr.blockers[0],
    'Capability audit failed: timeout probing bridge',
    'capability string → detail copy',
  );

  // 5) Automation blockers array → blocked, bounded to 3, non-strings dropped.
  const auto = resolveLaunchReadiness({
    automationBlockers: ['Connect the repo.', 'Grant desktop access.', 'Pair the bridge.', 'Fourth (dropped).'],
  });
  assertShape(auto, 'auto');
  assertEq(auto.grade, 'blocked', 'automation → blocked');
  assertEq(auto.blockers.length, 3, 'automation → capped at 3');
  assertEq(auto.blockers[0], 'Connect the repo.', 'automation → first blocker preserved');
  const autoMixed = resolveLaunchReadiness({ automationBlockers: ['Real blocker.', 5, null, {}, 'Second.'] });
  assertEq(autoMixed.blockers.length, 2, 'automation → non-strings dropped');
  assertEq(resolveLaunchReadiness({ automationBlockers: [] }).grade, 'ready', 'automation empty → ready');
  assertEq(resolveLaunchReadiness({ automationBlockers: 'nope' }).grade, 'ready', 'automation non-array → ready');

  // 6) Budget over cap — flag vs. string message; zero does not block.
  const budgetFlag = resolveLaunchReadiness({ budgetOverCap: true });
  assertEq(budgetFlag.grade, 'blocked', 'budget flag → blocked');
  assertEq(
    budgetFlag.blockers[0],
    'Projected 24h spend is over the budget cap.',
    'budget flag → generic copy',
  );
  const budgetMsg = resolveLaunchReadiness({
    budgetOverCap: 'Projected 24h spend $12.00 is over the $10.00 cap.',
  });
  assertEq(budgetMsg.blockers[0], 'Projected 24h spend $12.00 is over the $10.00 cap.', 'budget string → passthrough');
  assertEq(resolveLaunchReadiness({ budgetOverCap: 0 }).grade, 'ready', 'budget 0 → ready');
  assertEq(resolveLaunchReadiness({ budgetOverCap: 1 }).grade, 'blocked', 'budget 1 → blocked (numeric flag)');

  // 7) Bridge states: offline/degraded/unpaired → review+warning; paired/null/unknown → clean.
  const offline = resolveLaunchReadiness({ bridgeState: 'offline' });
  assertShape(offline, 'offline');
  assertEq(offline.grade, 'review', 'bridge offline → review');
  assertEq(offline.canLaunch, true, 'bridge offline → still launchable');
  assertEq(offline.warnings.length, 1, 'bridge offline → one warning');
  assert(offline.warnings[0].toLowerCase().includes('offline'), 'bridge offline → offline copy');
  assertEq(resolveLaunchReadiness({ bridgeState: 'degraded' }).grade, 'review', 'bridge degraded → review');
  assert(
    resolveLaunchReadiness({ bridgeState: 'degraded' }).warnings[0].toLowerCase().includes('degraded'),
    'bridge degraded → degraded copy',
  );
  const unpaired = resolveLaunchReadiness({ bridgeState: 'unpaired' });
  assertEq(unpaired.grade, 'review', 'bridge unpaired → review');
  assert(unpaired.warnings[0].toLowerCase().includes('paired'), 'bridge unpaired → paired copy');
  // null / paired / unknown-string → NO warning (no spurious bridge review).
  assertEq(resolveLaunchReadiness({ bridgeState: null }).grade, 'ready', 'bridge null → ready');
  assertEq(resolveLaunchReadiness({ bridgeState: null }).warnings.length, 0, 'bridge null → no warning');
  assertEq(resolveLaunchReadiness({ bridgeState: 'paired' }).warnings.length, 0, 'bridge paired → no warning');
  assertEq(resolveLaunchReadiness({ bridgeState: undefined }).warnings.length, 0, 'bridge undefined → no warning');
  assertEq(resolveLaunchReadiness({ bridgeState: 'weird' }).warnings.length, 0, 'bridge unknown → no warning');
  assertEq(resolveLaunchReadiness({ bridgeState: 42 }).warnings.length, 0, 'bridge number → no warning');
  // Case-insensitive normalization.
  assertEq(resolveLaunchReadiness({ bridgeState: 'OFFLINE' }).grade, 'review', 'bridge OFFLINE → review');

  // 8) Chips: vault + subagents + labels; ordering (access first), dedupe, cap.
  const chips = resolveLaunchReadiness({ hasVaultTools: true, hasSubagentAccess: true });
  assertEq(chips.chips.length, 2, 'chips → two access chips');
  assertEq(chips.chips[0], 'vault tools', 'chips → vault first');
  assertEq(chips.chips[1], 'subagents', 'chips → subagents second');
  assertEq(chips.grade, 'ready', 'chips only → ready');
  assertEq(resolveLaunchReadiness({ hasVaultTools: true }).chips.length, 1, 'chips → vault alone');
  assertEq(resolveLaunchReadiness({ hasSubagentAccess: true }).chips[0], 'subagents', 'chips → subagents alone');
  // Duplicate labels dedupe.
  const dupChips = resolveLaunchReadiness({ runLabel: 'same', costLabel: 'same' });
  assertEq(dupChips.chips.length, 1, 'chips → duplicate label deduped');
  assertEq(dupChips.chips[0], 'same', 'chips → deduped value preserved');
  // Access chips survive the cap ahead of labels.
  const fullChips = resolveLaunchReadiness({
    hasVaultTools: true,
    hasSubagentAccess: true,
    runLabel: 'run',
    costLabel: 'cost',
  });
  assertEq(fullChips.chips.length, 4, 'chips → four when all present');
  assertEq(fullChips.chips[3], 'cost', 'chips → cost last');
  // Empty/blank labels contribute no chip.
  assertEq(resolveLaunchReadiness({ runLabel: '   ', costLabel: '' }).chips.length, 0, 'chips → blank labels dropped');

  // 9) Grade ladder precedence: blocker > warning > (chips only) ready.
  const both = resolveLaunchReadiness({ hasBracketPlaceholder: true, bridgeState: 'offline' });
  assertEq(both.grade, 'blocked', 'ladder → blocker beats warning');
  assertEq(both.warnings.length, 1, 'ladder → warning still recorded under blocker');
  assertEq(both.canLaunch, false, 'ladder → blocked not launchable');
  assertEq(resolveLaunchReadiness({ bridgeState: 'offline' }).grade, 'review', 'ladder → warning only → review');
  assertEq(resolveLaunchReadiness({ hasVaultTools: true }).grade, 'ready', 'ladder → chips only → ready');

  // 10) Dedupe + hard limits on blockers (bracket + capability + budget + 3 automation = 6 → cap 5).
  const many = resolveLaunchReadiness({
    hasBracketPlaceholder: true,
    capabilityAuditFailed: 'x',
    budgetOverCap: 'y',
    automationBlockers: ['a1', 'a2', 'a3', 'a4'],
  });
  assertShape(many, 'many');
  assertEq(many.blockers.length, 5, 'blockers → capped at 5');
  assertEq(many.grade, 'blocked', 'many → blocked');
  // Identical automation blockers dedupe.
  const dupBlock = resolveLaunchReadiness({ automationBlockers: ['dup', 'dup', 'dup'] });
  assertEq(dupBlock.blockers.length, 1, 'blockers → identical entries deduped');

  // 11) Hostile / wrong-type / huge / cyclic inputs — never throw, always safe shape.
  const cyc: Record<string, unknown> = {};
  cyc.self = cyc;
  const cycArr: unknown[] = [];
  cycArr.push(cycArr);
  const hugeStr = new Array(100000).fill('blk');
  hugeStr[0] = 'b0';
  hugeStr[1] = 'b1';
  hugeStr[2] = 'b2';
  const hugeNum = new Array(100000).fill(7);
  const hostile: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['number', 42],
    ['string', 'hello'],
    ['boolean', true],
    ['array', [1, 2, 3]],
    ['function', () => 1],
    ['symbol-flag', { hasBracketPlaceholder: Symbol('x') }],
    ['nan-budget', { budgetOverCap: NaN }],
    ['object-flag', { hasVaultTools: {} }],
    ['cyclic-input', cyc],
    ['cyclic-automation', { automationBlockers: cycArr }],
    ['huge-string-array', { automationBlockers: hugeStr }],
    ['huge-number-array', { automationBlockers: hugeNum }],
    ['nested-arrays', { automationBlockers: [[1], [2]] }],
    ['everything', {
      hasBracketPlaceholder: 1,
      capabilityAuditFailed: 'boom',
      automationBlockers: ['z'],
      budgetOverCap: true,
      bridgeState: 'degraded',
      hasSubagentAccess: 'yes',
      hasVaultTools: 1,
      runLabel: 'run',
      costLabel: 'cost',
    }],
  ];
  for (const [label, value] of hostile) {
    let r: LaunchReadiness | null = null;
    let threw = false;
    try {
      r = resolveLaunchReadiness(value as LaunchReadinessInput);
    } catch (err) {
      threw = true;
      console.error('threw for ' + label + ': ' + String(err));
    }
    assert(!threw, 'hostile ' + label + ' → no throw');
    if (r) assertShape(r, 'hostile ' + label);
  }
  // The huge string array still respects the automation cap (proves bounded scan).
  assertEq(
    resolveLaunchReadiness({ automationBlockers: hugeStr } as LaunchReadinessInput).blockers.length,
    3,
    'huge array → automation cap holds',
  );
  // The huge number array yields no blockers (non-strings dropped) → ready.
  assertEq(
    resolveLaunchReadiness({ automationBlockers: hugeNum } as LaunchReadinessInput).grade,
    'ready',
    'huge number array → ready',
  );
  // The "everything" case grades blocked and is fully launchable-gated.
  const everything = resolveLaunchReadiness(hostile[hostile.length - 1][1] as LaunchReadinessInput);
  assertEq(everything.grade, 'blocked', 'everything → blocked');
  assertEq(everything.canLaunch, false, 'everything → canLaunch false');

  // 12) Purity: input is not mutated and outputs are fresh (not aliased to inputs).
  const inputArr = ['keep'];
  const beforeLen = inputArr.length;
  const input: LaunchReadinessInput = { automationBlockers: inputArr, hasVaultTools: true };
  const before = JSON.stringify(input);
  const out = resolveLaunchReadiness(input);
  assertEq(inputArr.length, beforeLen, 'purity → input array length unchanged');
  assertEq(JSON.stringify(input), before, 'purity → input object unchanged');
  assert(out.blockers !== inputArr, 'purity → blockers is a fresh array');
  assert(out.chips !== inputArr, 'purity → chips is a fresh array');
  // Determinism: same input, same output.
  assertEq(
    JSON.stringify(resolveLaunchReadiness(input)),
    JSON.stringify(resolveLaunchReadiness(input)),
    'purity → deterministic',
  );

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll openswanLaunchReadinessCore smoke cases passed (' + passes + ' passed).');
}
main();
