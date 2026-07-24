// Smoke test for src/lib/sessionCapabilityBudgetCore.ts — the pure "Agents Rule
// of Two" / lethal-trifecta guard. Run: npx tsx scripts/session-capability-budget-core-smoketest.ts
import {
  LETHAL_TRIFECTA_NOTE,
  SessionCapabilityState,
  ProposedAction,
  emptyCapabilityState,
  applyAction,
  countHeld,
  evaluateRuleOfTwo,
  describeCapabilityState,
} from '../src/lib/sessionCapabilityBudgetCore';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${name}`);
  }
}

const A: ProposedAction = { addsUntrustedInput: true, label: 'read a web page' };
const B: ProposedAction = { addsSensitiveAccess: true, label: 'load a credential' };
const C: ProposedAction = { addsStateChangeOrExfil: true, label: 'send an email' };
const NONE: ProposedAction = { label: 'no-op' };

// ── The rule note is present and mentions the two source concepts ─────────────
check('note is a non-empty string', typeof LETHAL_TRIFECTA_NOTE === 'string' && LETHAL_TRIFECTA_NOTE.length > 0);
check('note mentions Rule of Two', /rule of two/i.test(LETHAL_TRIFECTA_NOTE));
check('note mentions the trifecta', /trifecta/i.test(LETHAL_TRIFECTA_NOTE));

// ── Empty state ───────────────────────────────────────────────────────────────
const empty = emptyCapabilityState();
check('empty: untrustedInput false', empty.untrustedInput === false);
check('empty: sensitiveAccess false', empty.sensitiveAccess === false);
check('empty: stateChangeOrExfil false', empty.stateChangeOrExfil === false);
check('empty: countHeld === 0', countHeld(empty) === 0);
check('empty: emptyCapabilityState returns a fresh object', emptyCapabilityState() !== empty);

// ── applyAction is pure (does not mutate its input) ───────────────────────────
const before = emptyCapabilityState();
const afterA = applyAction(before, A);
check('applyAction does not mutate input', before.untrustedInput === false);
check('applyAction returns a new object', afterA !== before);
check('applyAction A sets untrustedInput', afterA.untrustedInput === true);
check('applyAction A leaves others false', afterA.sensitiveAccess === false && afterA.stateChangeOrExfil === false);

// ── Single capability held → within Rule of Two, no approval ──────────────────
const one = applyAction(emptyCapabilityState(), A);
const evalOne = evaluateRuleOfTwo(emptyCapabilityState(), A);
check('one: countHeld === 1', countHeld(one) === 1);
check('one: not trifecta', evalOne.trifecta === false);
check('one: no approval required', evalOne.requiresHumanApproval === false);
check('one: heldCount === 1', evalOne.heldCount === 1);
check('one: reason cites Rule of Two', /rule of two/i.test(evalOne.reason));

// ── Two capabilities held → still within Rule of Two, no approval ─────────────
const two = applyAction(applyAction(emptyCapabilityState(), A), B);
check('two: countHeld === 2', countHeld(two) === 2);
const evalTwoStay = evaluateRuleOfTwo(two, NONE);
check('two: not trifecta', evalTwoStay.trifecta === false);
check('two: no approval required', evalTwoStay.requiresHumanApproval === false);
check('two: heldCount === 2', evalTwoStay.heldCount === 2);

// Adding a capability the 2-of-3 state ALREADY holds stays allowed (no new cap).
const evalTwoRedundant = evaluateRuleOfTwo(two, A); // A already held
check('two + redundant A: still 2 held', evalTwoRedundant.heldCount === 2);
check('two + redundant A: still allowed', evalTwoRedundant.requiresHumanApproval === false);

// ── Adding the THIRD capability → lethal trifecta, approval required ──────────
const evalThird = evaluateRuleOfTwo(two, C); // two holds A+B, add C
check('third: trifecta true', evalThird.trifecta === true);
check('third: requiresHumanApproval true', evalThird.requiresHumanApproval === true);
check('third: heldCount === 3', evalThird.heldCount === 3);
check('third: projected holds all three',
  evalThird.projected.untrustedInput && evalThird.projected.sensitiveAccess && evalThird.projected.stateChangeOrExfil);
// reason must name all three capabilities.
check('third: reason names A', /untrusted input/i.test(evalThird.reason));
check('third: reason names B', /sensitive/i.test(evalThird.reason));
check('third: reason names C', /state-change|exfiltrat/i.test(evalThird.reason));
check('third: reason flags trifecta', /trifecta/i.test(evalThird.reason));

// A single action that adds all three at once from empty is also a trifecta.
const evalAllAtOnce = evaluateRuleOfTwo(emptyCapabilityState(), {
  addsUntrustedInput: true,
  addsSensitiveAccess: true,
  addsStateChangeOrExfil: true,
});
check('all-at-once: trifecta true', evalAllAtOnce.trifecta === true);
check('all-at-once: approval required', evalAllAtOnce.requiresHumanApproval === true);

// ── OR-merge is monotonic: re-applying an already-held capability is a no-op ──
const held = applyAction(emptyCapabilityState(), C);
const reHeld = applyAction(held, C);
check('monotonic: re-apply same capability keeps stateChangeOrExfil', reHeld.stateChangeOrExfil === true);
check('monotonic: re-apply does not raise count', countHeld(reHeld) === countHeld(held));
// Capabilities never drop: an action with no adds cannot clear a held one.
const stillHeld = applyAction(held, NONE);
check('monotonic: empty action keeps held capability', stillHeld.stateChangeOrExfil === true);
check('monotonic: empty action keeps count', countHeld(stillHeld) === 1);

// ── countHeld correctness across ALL 8 combinations ───────────────────────────
const bits: Array<[boolean, boolean, boolean]> = [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [false, false, true],
  [true, true, false],
  [true, false, true],
  [false, true, true],
  [true, true, true],
];
for (const [u, s, x] of bits) {
  const st: SessionCapabilityState = { untrustedInput: u, sensitiveAccess: s, stateChangeOrExfil: x };
  const expected = (u ? 1 : 0) + (s ? 1 : 0) + (x ? 1 : 0);
  check(`countHeld(${u},${s},${x}) === ${expected}`, countHeld(st) === expected);
  // Only the all-three combination is a trifecta / needs approval.
  const ev = evaluateRuleOfTwo(st, NONE);
  check(`combo(${u},${s},${x}) trifecta iff all three`, ev.trifecta === (expected === 3));
  check(`combo(${u},${s},${x}) approval iff all three`, ev.requiresHumanApproval === (expected === 3));
}

// ── describeCapabilityState ───────────────────────────────────────────────────
check('describe empty says 0 of 3', /0 of 3/.test(describeCapabilityState(emptyCapabilityState())));
check('describe two says 2 of 3', /2 of 3/.test(describeCapabilityState(two)));
const allThree: SessionCapabilityState = { untrustedInput: true, sensitiveAccess: true, stateChangeOrExfil: true };
check('describe trifecta flags approval', /LETHAL TRIFECTA/i.test(describeCapabilityState(allThree)));
check('describe trifecta says 3 of 3', /3 of 3/.test(describeCapabilityState(allThree)));

// ── Guards: undefined / null / garbage inputs never throw, degrade to empty ───
// @ts-expect-error — intentionally passing undefined to exercise the guard.
check('guard: countHeld(undefined) === 0', countHeld(undefined) === 0);
// @ts-expect-error — intentionally passing null.
check('guard: countHeld(null) === 0', countHeld(null) === 0);
// @ts-expect-error — intentionally passing undefined state + action.
const guardEval = evaluateRuleOfTwo(undefined, undefined);
check('guard: evaluate(undefined,undefined) heldCount 0', guardEval.heldCount === 0);
check('guard: evaluate(undefined,undefined) no approval', guardEval.requiresHumanApproval === false);
check('guard: evaluate(undefined,undefined) has reason', typeof guardEval.reason === 'string' && guardEval.reason.length > 0);
// @ts-expect-error — garbage state object with wrong field types.
const guardApply = applyAction({ untrustedInput: 'yes', sensitiveAccess: 1, foo: 9 }, { addsStateChangeOrExfil: 'true' });
check('guard: garbage state coerces truthy-but-non-bool to false', guardApply.untrustedInput === false && guardApply.sensitiveAccess === false);
check('guard: garbage action non-bool add coerces to false', guardApply.stateChangeOrExfil === false);
// @ts-expect-error — null state to describe.
check('guard: describe(null) does not throw', typeof describeCapabilityState(null) === 'string');
// @ts-expect-error — applyAction with both args undefined.
check('guard: applyAction(undefined,undefined) === empty', countHeld(applyAction(undefined, undefined)) === 0);

console.log(`session-capability-budget-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
