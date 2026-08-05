/**
 * Smoke: wordpressScheduleDate.toWordPressDateGmt
 *
 * Guards the R3 fix — scheduled posts must carry a UTC `date_gmt` (no tz
 * suffix, no milliseconds) so the publish hour does not shift with the runtime
 * timezone. tsx/esbuild can load this because the module is dependency-light.
 */
import { toWordPressDateGmt } from '../src/lib/wordpressScheduleDate';

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`pass: ${msg}`); } else { console.error(`FAIL: ${msg}`); failed++; }
}

// UTC components are preserved exactly, regardless of the runtime timezone.
const utc = new Date(Date.UTC(2026, 6, 1, 17, 30, 45)); // 2026-07-01T17:30:45Z
assert(toWordPressDateGmt(utc) === '2026-07-01T17:30:45', 'formats UTC wall-clock from a UTC instant');

// No trailing 'Z' and no milliseconds (WP reads date_gmt as GMT; a tz suffix is undesirable).
const out = toWordPressDateGmt(new Date(Date.UTC(2026, 0, 5, 9, 0, 0)));
assert(!out.endsWith('Z'), 'no trailing Z');
assert(!out.includes('.'), 'no milliseconds');
assert(out === '2026-01-05T09:00:00', 'pads single-digit fields');
assert(out.length === 19, 'length is exactly YYYY-MM-DDTHH:mm:ss');

// A wall-clock parsed in the runtime TZ converts to the correct UTC instant
// (this is the core bug: the old code put this UTC value in `date`, not date_gmt).
const local = new Date('2026-07-01T09:00:00'); // runtime-local 9am
assert(toWordPressDateGmt(local) === local.toISOString().slice(0, 19), 'matches the UTC instant of a runtime-local time');

// Invalid input fails loud rather than scheduling at the epoch.
let threw = false;
try { toWordPressDateGmt(new Date('not-a-date')); } catch { threw = true; }
assert(threw, 'invalid Date throws');
threw = false;
try { toWordPressDateGmt(undefined as unknown as Date); } catch { threw = true; }
assert(threw, 'missing Date throws');

if (failed > 0) { console.error(`\nwordpress-schedule-date smoke FAILED (${failed})`); process.exit(1); }
console.log('\nwordpress-schedule-date smoke OK');
