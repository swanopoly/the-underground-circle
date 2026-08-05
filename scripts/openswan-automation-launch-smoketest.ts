/**
 * openswan-automation-launch-smoketest
 *
 * Locks the chat sidebar -> OpenSwan Control Panel automation launch contract.
 * The panel infers the automation helper from this exact seed, so the sidebar
 * should always pass automation-framed text without double-prefixing drafts.
 *
 * Run: `npm run smoke:openswan-automation-launch`
 */

import {
  OPENSWAN_AUTOMATION_INTENT_SEED,
  buildOpenSwanAutomationInitialTask,
} from '../src/lib/openswanAutomationLaunch';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assertEqual(actual: string, expected: string, message: string) {
  if (actual !== expected) {
    fail(`${message}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`);
  } else {
    pass(message);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) fail(message);
  else pass(message);
}

function main() {
  assertEqual(
    buildOpenSwanAutomationInitialTask(''),
    OPENSWAN_AUTOMATION_INTENT_SEED,
    'empty composer still opens OpenSwan in automation framing',
  );

  assertEqual(
    buildOpenSwanAutomationInitialTask('log into WordPress every Friday and draft the weekly update'),
    `${OPENSWAN_AUTOMATION_INTENT_SEED}log into WordPress every Friday and draft the weekly update`,
    'draft task is preserved inside the automation seed',
  );

  assertEqual(
    buildOpenSwanAutomationInitialTask('  Turn this into a repeatable automation:   upload the new slides weekly  '),
    `${OPENSWAN_AUTOMATION_INTENT_SEED}upload the new slides weekly`,
    'already-framed draft is normalized without a duplicate seed',
  );

  assertEqual(
    buildOpenSwanAutomationInitialTask('TURN THIS INTO A REPEATABLE AUTOMATION: sync inventory reports daily'),
    `${OPENSWAN_AUTOMATION_INTENT_SEED}sync inventory reports daily`,
    'case-insensitive framing is normalized',
  );

  assert(
    buildOpenSwanAutomationInitialTask('schedule the Dealer Inspire slide refresh')
      .toLowerCase()
      .startsWith(OPENSWAN_AUTOMATION_INTENT_SEED.trim().toLowerCase()),
    'launcher output keeps the OpenSwan helper intent seed prefix',
  );

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }

  console.log('\nAll OpenSwan automation launch smoke cases passed.');
}

main();
