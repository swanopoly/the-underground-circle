/**
 * automation-cadence-format-smoketest - pins the OpenSwan Control Panel's
 * cron→cadence and relative-time formatters. Regression here means saved
 * automation rows show raw crons or wrong relative times.
 *
 * Run: npm run smoke:automation-cadence-format
 */

import { cronToHuman, relTime } from '../src/lib/automationCadenceFormat';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) {
    console.log('pass:', message);
  } else {
    failures += 1;
    console.error('FAIL:', `${message}${detail ? ` - ${detail}` : ''}`);
  }
}

// ── cronToHuman ──────────────────────────────────────────────────────────
assert(cronToHuman('0 9 * * 1') === 'Weekly · Mon 9am', 'weekly cron');
assert(cronToHuman('0 9 * * *') === 'Daily · 9am', 'daily cron');
assert(cronToHuman('0 * * * *') === 'Hourly', 'hourly cron');
assert(cronToHuman('') === 'Manual', 'empty cron is Manual');
assert(cronToHuman(null) === 'Manual', 'null cron is Manual');
assert(cronToHuman(undefined) === 'Manual', 'undefined cron is Manual');
assert(cronToHuman('15 3 * * 5') === '15 3 * * 5', 'unrecognized cron is verbatim');

// ── relTime ──────────────────────────────────────────────────────────────
assert(relTime(null) === '—', 'null relTime');
assert(relTime('') === '—', 'empty relTime');
assert(relTime('not-a-date') === '—', 'bad relTime');

const now = Date.now();
assert(relTime(new Date(now + 30 * 60000).toISOString()).startsWith('in '), 'future shows in');
assert(relTime(new Date(now - 30 * 60000).toISOString()).endsWith('ago'), 'past shows ago');
assert(relTime(new Date(now - 5 * 60000).toISOString()) === '5m ago', 'minutes ago');
assert(relTime(new Date(now + 2 * 3600000).toISOString()) === 'in 2h', 'hours future');
assert(relTime(new Date(now - 3 * 86400000).toISOString()) === '3d ago', 'days ago');

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nautomation-cadence-format smoke OK');
