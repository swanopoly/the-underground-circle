/**
 * scheduled-integration-action-smoketest — the SAFETY CORE for recurring
 * integration actions (src/lib/scheduledIntegrationAction.ts, Wave 2 · W3).
 *
 * The load-bearing assertions are the FLOOR REFUSALS: a recurring unattended
 * action must never be schedulable to pay / delete / login / grant, and the run
 * prompt must carry the STOP-on-floor guard. Also covers rate/goal bounds and
 * that ordinary read/post tasks are allowed. Pure — tsx-safe.
 */

import {
  validateScheduledIntegrationAction,
  detectScheduledFloorCategory,
  describeScheduledIntegrationAction,
  buildScheduledIntegrationRunPrompt,
  MAX_SCHEDULED_GOAL_LENGTH,
  MAX_RUNS_PER_DAY,
  DEFAULT_MAX_RUNS_PER_DAY,
} from '../src/lib/scheduledIntegrationAction';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEqual(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) a normal read+post task is allowed ───────────────────────────────
  const ok = validateScheduledIntegrationAction({
    goal: "post yesterday's merged PRs to Slack",
    integrationHint: 'GitHub',
    recurrence: '0 9 * * 1-5',
    recurrenceLabel: 'Every weekday 9am',
  });
  assert(ok.ok, '(1) read+post task validates');
  if (ok.ok) {
    assertEqual(ok.spec.maxRunsPerDay, DEFAULT_MAX_RUNS_PER_DAY, '(1) default rate applied');
    assertEqual(ok.spec.integrationHint, 'GitHub', '(1) hint kept');
  }
  assert(validateScheduledIntegrationAction({ goal: 'summarize open Sentry issues and post the count to Slack', recurrence: '0 8 * * *' }).ok, '(1) summarize+post allowed');
  assert(validateScheduledIntegrationAction({ goal: 'list new Airtable rows and notify the team channel', recurrence: '0 * * * *' }).ok, '(1) list+notify allowed');

  // ─── (2) THE FLOOR — refuse pay / delete / login / grant ──────────────────
  const floorCases: Array<[string, 'pay' | 'delete' | 'login' | 'grant']> = [
    ['pay the outstanding Stripe invoice every month', 'pay'],
    ['buy more API credits when we run low', 'pay'],
    ['check out the cart and place the order nightly', 'pay'],
    ['transfer funds to payroll every Friday', 'pay'],
    ['delete stale Linear issues every week', 'delete'],
    ['remove inactive users from the workspace monthly', 'delete'],
    ['revoke expired API tokens each night', 'delete'],
    ['cancel the subscription at month end', 'delete'],
    ['log in to the admin portal and refresh the report', 'login'],
    ['reset my password on the service weekly', 'login'],
    ['grant the new hires admin access every Monday', 'grant'],
    ['add contractors as admins to the repo nightly', 'grant'],
    ['change permissions for the finance group weekly', 'grant'],
  ];
  for (const [goal, cat] of floorCases) {
    assertEqual(detectScheduledFloorCategory(goal), cat, `(2) detect floor "${goal.slice(0, 36)}…" → ${cat}`);
    const res = validateScheduledIntegrationAction({ goal, recurrence: '0 9 * * *' });
    assert(!res.ok, `(2) refuse scheduling: "${goal.slice(0, 36)}…"`);
    if (!res.ok) {
      assertEqual(res.reason, 'floor', `(2) reason is floor for "${goal.slice(0, 24)}…"`);
      assert(/need you in the loop|run it yourself/i.test(res.error), '(2) refusal explains why');
    }
  }
  // safe goals are NOT floor
  assertEqual(detectScheduledFloorCategory("post yesterday's merged PRs to Slack"), null, '(2) safe goal → no floor');
  assertEqual(detectScheduledFloorCategory('summarize and share the weekly metrics'), null, '(2) share is not grant');

  // ─── (3) goal + recurrence + rate bounds ──────────────────────────────────
  assertEqual(validateScheduledIntegrationAction({ goal: '', recurrence: '0 9 * * *' }).ok, false, '(3) empty goal refused');
  assertEqual((validateScheduledIntegrationAction({ goal: '   ', recurrence: '0 9 * * *' }) as any).reason, 'empty_goal', '(3) whitespace goal → empty_goal');
  const longGoal = 'post ' + 'x'.repeat(MAX_SCHEDULED_GOAL_LENGTH + 10);
  assertEqual((validateScheduledIntegrationAction({ goal: longGoal, recurrence: '0 9 * * *' }) as any).reason, 'goal_too_long', '(3) over-long goal → goal_too_long');
  assertEqual((validateScheduledIntegrationAction({ goal: 'post the metrics', recurrence: '' }) as any).reason, 'no_recurrence', '(3) missing recurrence → no_recurrence');
  assertEqual((validateScheduledIntegrationAction({ goal: 'post the metrics', recurrence: '0 9 * * *', maxRunsPerDay: 0 }) as any).reason, 'rate', '(3) rate < 1 refused');
  const clamped = validateScheduledIntegrationAction({ goal: 'post the metrics', recurrence: '* * * * *', maxRunsPerDay: 999 });
  assert(clamped.ok && clamped.spec.maxRunsPerDay === MAX_RUNS_PER_DAY, '(3) rate clamped to the ceiling', clamped.ok ? String(clamped.spec.maxRunsPerDay) : 'not-ok');

  // ─── (4) describe carries the STOP-on-floor scope ─────────────────────────
  if (ok.ok) {
    const desc = describeScheduledIntegrationAction(ok.spec);
    assert(/Every weekday 9am/.test(desc), '(4) describe shows the schedule');
    assert(/STOP|stop and ask|pay, delete, log in, or grant/i.test(desc), '(4) describe states the floor scope', desc);
    assert(new RegExp(`${DEFAULT_MAX_RUNS_PER_DAY}×/day`).test(desc), '(4) describe shows the rate ceiling');
  }

  // ─── (5) run prompt bakes in the HARD STOP guard ──────────────────────────
  if (ok.ok) {
    const prompt = buildScheduledIntegrationRunPrompt(ok.spec);
    assert(/HARD STOP/i.test(prompt), '(5) run prompt has a HARD STOP');
    assert(/paying|buying|deleting|removing|revoking|logging in|granting access/i.test(prompt), '(5) run prompt enumerates the floor verbs');
    assert(/custom_api\.read \(GET only\)/i.test(prompt), '(5) run prompt reads via GET only');
    assert(/messaging\.notify|custom_api\.request/i.test(prompt), '(5) run prompt names the post/write tools');
    assert(/unattended/i.test(prompt), '(5) run prompt states it is unattended');
  }

  // ─── (6) degenerate inputs never throw ────────────────────────────────────
  try {
    validateScheduledIntegrationAction({} as any);
    validateScheduledIntegrationAction(undefined as any);
    detectScheduledFloorCategory(undefined as any);
    describeScheduledIntegrationAction({ goal: 'x', recurrence: '0 9 * * *', maxRunsPerDay: 1 });
    buildScheduledIntegrationRunPrompt({ goal: 'x', recurrence: '0 9 * * *', maxRunsPerDay: 1 });
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (6) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll scheduled-integration-action smoke cases passed (${passes} passed).`);
}

main();
