/**
 * tool-loop-budget-smoketest
 *
 * Verifies the proactive step-budget reminder: silent while there's plenty of
 * budget, fires only in the final `warnAt` rounds, reports the right remaining
 * count, and never fires once the budget is exhausted (no next round to read
 * it). Pure helper → no heavy imports.
 *
 * Run: npm run smoke:tool-loop-budget
 */

import assert from 'node:assert/strict';

import { toolBudgetReminder } from '../src/lib/toolLoopBudget';

const MAX = 12;

// Plenty of budget left → no nudge (don't nag mid-exploration).
assert.equal(toolBudgetReminder(0, MAX), null, 'round 0 → silent');
assert.equal(toolBudgetReminder(5, MAX), null, 'mid-loop → silent');
assert.equal(toolBudgetReminder(9, MAX), null, '3 remaining (> default warnAt of 2) → silent');

// Final stretch → nudge, with the correct remaining count.
const two = toolBudgetReminder(10, MAX); // 2 remaining
assert(two && two.includes('about 2 tool steps left'), '2 remaining → nudge naming 2 steps');
assert(/Converge now/i.test(two!), 'nudge tells the model to converge');

const one = toolBudgetReminder(11, MAX); // 1 remaining
assert(one && one.includes('about 1 tool step left'), '1 remaining → singular "step"');

// Exhausted → no nudge (nothing will consume it).
assert.equal(toolBudgetReminder(12, MAX), null, '0 remaining → silent');
assert.equal(toolBudgetReminder(13, MAX), null, 'over budget → silent');

// Custom warnAt widens/narrows the window.
assert(toolBudgetReminder(9, MAX, { warnAt: 3 }) !== null, 'warnAt=3 → 3 remaining now nudges');
assert.equal(toolBudgetReminder(9, MAX, { warnAt: 1 }), null, 'warnAt=1 → 3 remaining stays silent');

// Small caps still behave (1-round loop: after the only round, 0 remain → silent).
assert.equal(toolBudgetReminder(1, 1), null, '1-round loop, round done → silent');

console.log('All tool loop budget smoke cases passed.');
