/**
 * budget-alerts-smoketest
 *
 * Pins the money-gate math in `src/lib/budgetMath.ts` (the pure core of the
 * Budget Alerts system): hard-limit enforcement fails closed, alert thresholds
 * fire at the right boundaries and BEFORE a cap is blown, spend can't silently
 * exceed a cap, and degenerate inputs never throw.
 *
 * Pure helper (no react-native / storage import) → tsx can load it.
 *
 * Run: npm run smoke:budget-alerts
 */

import assert from 'node:assert/strict';

import {
  calculateBudgetAlerts,
  checkHardLimit,
  generateBudgetRecommendations,
  getAlertColor,
  getAlertBackgroundColor,
  type BudgetConfig,
} from '../src/lib/budgetMath';

// ─── checkHardLimit: the actual spend gate ───────────────────────────────────

// Disabled or alert-only never blocks.
assert.equal(checkHardLimit({ enabled: false, daily: 10, hardLimit: true }, 999, 0, 0), null,
  'disabled config never blocks even when wildly over');
assert.equal(checkHardLimit({ enabled: true, daily: 10, hardLimit: false }, 999, 0, 0), null,
  'hardLimit:false is alert-only — never blocks');

// Inclusive threshold: block fires AT the cap, not one cent past it.
assert.equal(checkHardLimit({ enabled: true, daily: 10, hardLimit: true }, 9.99, 0, 0), null,
  'just under the daily cap → allowed');
{
  const blocked = checkHardLimit({ enabled: true, daily: 10, hardLimit: true }, 10, 0, 0);
  assert(blocked && blocked.includes('Daily'), 'exactly at the daily cap → blocked (inclusive >=)');
}
{
  const blocked = checkHardLimit({ enabled: true, daily: 10, hardLimit: true }, 10.01, 0, 0);
  assert(blocked && /\$10\.01 \/ \$10\.00/.test(blocked), 'over the cap → blocked, message shows spend/cap');
}

// Zero / unset caps are ignored (0 is not a "block everything" cap).
assert.equal(checkHardLimit({ enabled: true, daily: 0, hardLimit: true }, 500, 0, 0), null,
  'daily:0 is treated as "no cap", not "block at 0"');
assert.equal(checkHardLimit({ enabled: true, hardLimit: true }, 500, 500, 500), null,
  'no caps set → nothing to block');

// Each period is enforced independently; daily is checked first.
{
  const wk = checkHardLimit({ enabled: true, weekly: 50, hardLimit: true }, 5, 50, 5);
  assert(wk && wk.includes('Weekly'), 'weekly cap enforced on its own');
  const mo = checkHardLimit({ enabled: true, monthly: 200, hardLimit: true }, 5, 5, 200);
  assert(mo && mo.includes('Monthly'), 'monthly cap enforced on its own');
  const both = checkHardLimit({ enabled: true, daily: 10, monthly: 200, hardLimit: true }, 10, 0, 200);
  assert(both && both.includes('Daily'), 'daily is reported first when multiple caps are blown');
}

// ─── calculateBudgetAlerts: warn BEFORE the block, at the right thresholds ────

const cfg: BudgetConfig = { enabled: true, daily: 100, hardLimit: true };

// Below 50% → silent (don't nag).
assert.deepEqual(calculateBudgetAlerts(cfg, 49, 0, 0), [], 'under 50% → no alert');

// Boundary checks — thresholds are inclusive (>=).
assert.equal(calculateBudgetAlerts(cfg, 50, 0, 0)[0].level, 'info', '50% → info');
assert.equal(calculateBudgetAlerts(cfg, 74.99, 0, 0)[0].level, 'info', 'just under 75% → still info');
assert.equal(calculateBudgetAlerts(cfg, 75, 0, 0)[0].level, 'warning', '75% → warning');
assert.equal(calculateBudgetAlerts(cfg, 90, 0, 0)[0].level, 'danger', '90% → danger (this is the pre-cap warning)');
assert.equal(calculateBudgetAlerts(cfg, 99.99, 0, 0)[0].level, 'danger', 'just under cap → danger, not critical');
assert.equal(calculateBudgetAlerts(cfg, 100, 0, 0)[0].level, 'critical', '100% → critical');

// Critical-alert timing lines up with the block: both trigger at spend >= cap.
// So the user gets a `danger` alert strictly BEFORE the hard block, and the
// `critical` alert exactly when the block engages.
{
  const preBlock = calculateBudgetAlerts(cfg, 95, 0, 0)[0];
  assert.equal(preBlock.level, 'danger', 'danger alert fires before the cap is reached');
  assert.equal(checkHardLimit(cfg, 95, 0, 0), null, '...and spend is still allowed at that point');
}

// remaining never goes negative; overage math is correct in the message.
{
  const a = calculateBudgetAlerts(cfg, 130, 0, 0)[0];
  assert.equal(a.remaining, 0, 'remaining is floored at 0 when over budget');
  assert(a.message.includes('$30.00 over limit'), 'overage = spent - budget = 30.00');
}

// percentage is the raw ratio (can exceed 100) — used for meters.
assert.equal(calculateBudgetAlerts(cfg, 250, 0, 0)[0].percentage, 250, 'percentage is uncapped raw ratio');

// Multi-period: highest-severity first.
{
  const multi = calculateBudgetAlerts(
    { enabled: true, daily: 100, weekly: 500, monthly: 2000 },
    60,   // daily 60% → info
    480,  // weekly 96% → danger
    2100, // monthly 105% → critical
  );
  assert.equal(multi.length, 3, 'all three periods alerted');
  assert.equal(multi[0].level, 'critical', 'sorted most-severe first');
  assert.equal(multi[1].level, 'danger', 'then danger');
  assert.equal(multi[2].level, 'info', 'then info');
}

// Disabled → no alerts regardless of spend.
assert.deepEqual(calculateBudgetAlerts({ enabled: false, daily: 1 }, 999, 999, 999), [],
  'disabled config yields no alerts');

// Zero-budget periods are skipped (no divide-by-zero → no NaN%).
assert.deepEqual(calculateBudgetAlerts({ enabled: true, daily: 0 }, 50, 0, 0), [],
  'daily:0 is skipped, not treated as 0-budget (no Infinity%)');

// ─── Degenerate inputs never throw ────────────────────────────────────────────

assert.doesNotThrow(() => calculateBudgetAlerts({ enabled: true, daily: 100 }, 0, 0, 0), 'zero spend ok');
assert.doesNotThrow(() => checkHardLimit({ enabled: true, daily: 100, hardLimit: true }, 0, 0, 0), 'zero spend ok');
assert.doesNotThrow(() => generateBudgetRecommendations(0, 0, 0), 'zero spend recs ok');
assert.deepEqual(generateBudgetRecommendations(0, 0, 0), [], 'no spend → no recommendations');

// ─── Recommendations: projection + suggested budget math ──────────────────────

{
  // spendToday=20 → projectedMonthly = 20*30 = 600 (>500) → volatility + suggest
  const recs = generateBudgetRecommendations(20, 20, 0);
  assert(recs.some(r => r.includes('$600')), 'projects 20/day → $600/mo');
  // projectedMonthly 600 is NOT < 1000? it is < 1000 → suggested budget present
  // suggested = ceil(600*1.2 / 50)*50 = ceil(720/50)*50 = ceil(14.4)*50 = 15*50 = 750
  assert(recs.some(r => r.includes('$750')), 'suggested monthly budget rounds up to $750');
}
{
  // High projection (>=1000) → no "suggested budget" (only the overspend warning)
  // spendToday=40 → projected 1200; 1200 !< 1000 so suggestion suppressed.
  const recs = generateBudgetRecommendations(40, 0, 0);
  assert(recs.some(r => r.includes('$1200')), 'projects 40/day → $1200/mo warning');
  assert(!recs.some(r => r.includes('Suggested monthly budget')), 'no suggestion when projection >= $1000');
}

// ─── Styling helpers are total (never undefined) ──────────────────────────────

for (const lvl of ['critical', 'danger', 'warning', 'info', 'none'] as const) {
  assert(getAlertColor(lvl).startsWith('#'), `getAlertColor(${lvl}) returns a hex color`);
  assert(getAlertBackgroundColor(lvl).startsWith('#'), `getAlertBackgroundColor(${lvl}) returns a hex color`);
}

console.log('All budget alerts smoke cases passed.');
