/**
 * automation-builder-smoketest — verifies parseAutomationRequest
 * extracts schedule + action correctly across the patterns the chat
 * automation builder accepts. Pure-function tests, no DB.
 *
 * Run: `npx tsx scripts/automation-builder-smoketest.ts`
 */
import {
  parseAutomationRequest,
  parseComputerTaskSchedule,
  looksLikeAutomationRequest,
} from '../src/lib/automationChatParser';

let failures = 0;

function ok(msg: string) { console.log('  ok:', msg); }
function fail(msg: string, detail: any) {
  failures += 1;
  console.error('FAIL:', msg);
  if (detail) console.error('  detail:', JSON.stringify(detail));
}

// ─── looksLikeAutomationRequest ──────────────────────────────────────────

console.log('\nlooksLikeAutomationRequest');

function expectLooks(input: string, expected: boolean, msg: string) {
  if (looksLikeAutomationRequest(input) === expected) ok(msg);
  else fail(msg, { input, expected });
}

expectLooks('every Friday at 5pm post a weekly summary', true, 'classic schedule + action');
expectLooks('daily run the test suite', true, 'cadence shorthand');
expectLooks('when someone pushes to github post a summary', true, 'event trigger');
expectLooks('hello world', false, 'plain text rejected');
expectLooks('what should we do today?', false, 'question rejected');
expectLooks('every', false, 'too short rejected');
expectLooks('every Friday I work', false, 'no action verb rejected');

// ─── parseAutomationRequest — schedule patterns ───────────────────────────

console.log('\nparseAutomationRequest — schedule patterns');

function expectProposal(
  input: string,
  match: Partial<{ triggerType: string; cron: string; agent: string; nameSubstring: string }>,
  msg: string,
) {
  const p = parseAutomationRequest(input);
  if (!p) { fail(msg + ' (parser returned null)', input); return; }
  for (const [k, v] of Object.entries(match)) {
    if (k === 'cron' && p.cronExpression !== v) {
      fail(msg + ` — cron mismatch (got "${p.cronExpression}", want "${v}")`, p);
      return;
    }
    if (k === 'triggerType' && p.triggerType !== v) {
      fail(msg + ` — triggerType mismatch (got ${p.triggerType}, want ${v})`, p);
      return;
    }
    if (k === 'agent' && p.agent !== v) {
      fail(msg + ` — agent mismatch`, p);
      return;
    }
    if (k === 'nameSubstring' && !p.name.includes(v as string)) {
      fail(msg + ` — name doesn't include "${v}" (got "${p.name}")`, p);
      return;
    }
  }
  ok(msg);
}

expectProposal(
  'every Friday at 5pm post a weekly summary',
  { triggerType: 'schedule', cron: '0 17 * * 5', nameSubstring: 'Post' },
  '"every Friday at 5pm post a weekly summary"',
);

expectProposal(
  'every monday at 9am send daily standup',
  { triggerType: 'schedule', cron: '0 9 * * 1' },
  '"every monday at 9am send daily standup"',
);

expectProposal(
  'every day at 9am post the morning digest',
  { triggerType: 'schedule', cron: '0 9 * * *' },
  '"every day at 9am post the morning digest"',
);

expectProposal(
  'daily summarize what shipped',
  { triggerType: 'schedule', cron: '0 9 * * *' },
  '"daily summarize what shipped" → daily 9am',
);

expectProposal(
  'weekly post a retro',
  { triggerType: 'schedule', cron: '0 9 * * 1' },
  '"weekly post a retro" → Monday 9am',
);

expectProposal(
  'every 5 minutes post the build status',
  { triggerType: 'schedule', cron: '*/5 * * * *' },
  '"every 5 minutes post the build status"',
);

expectProposal(
  'every 2 hours run a security scan',
  { triggerType: 'schedule', cron: '0 */2 * * *' },
  '"every 2 hours run a security scan"',
);

expectProposal(
  'every morning post the standup',
  { triggerType: 'schedule', cron: '0 9 * * *' },
  '"every morning post the standup" → 9am daily',
);

// ─── parseAutomationRequest — event patterns ─────────────────────────────

console.log('\nparseAutomationRequest — event patterns');

expectProposal(
  'when someone pushes to github post a summary',
  { triggerType: 'event' },
  'GitHub push event → table circle_github_events',
);

expectProposal(
  'when a task is completed send a celebration',
  { triggerType: 'event' },
  'task completion event → table tasks',
);

expectProposal(
  'when someone checks in post an emoji',
  { triggerType: 'event' },
  'check-in event → table check_ins',
);

// ─── Negative cases ──────────────────────────────────────────────────────

console.log('\nparseAutomationRequest — should NOT match');

const negatives = [
  'hello',
  'thanks',
  'can you help me set up an automation?',
  'please summarize today',
  'I love every Friday',
];

for (const neg of negatives) {
  const p = parseAutomationRequest(neg);
  if (p === null) ok(`"${neg.slice(0, 30)}..." → null`);
  else fail(`"${neg}" should NOT parse but did`, p);
}

// ─── parseComputerTaskSchedule (D7b) ─────────────────────────────────────

console.log('\nparseComputerTaskSchedule');

{
  const task = 'log into portal.acme.com, download the latest invoices, and rename them by date';

  // Day + time phrase → weekly cron, verbatim task prompt, chat output.
  const friday = parseComputerTaskSchedule({ task, schedulePhrase: 'friday at 9am', taskLabel: 'Invoice download' });
  if (!friday) fail('schedule: friday phrase should parse', null);
  else {
    if (friday.triggerType !== 'schedule' || !friday.cronExpression) fail('schedule: friday → cron schedule', friday);
    else if (!/\* \* 5$/.test(friday.cronExpression)) fail('schedule: friday → dow 5', friday.cronExpression);
    else ok(`friday at 9am → ${friday.cronExpression}`);
    if (!friday.prompt.includes(task)) fail('schedule: prompt carries task verbatim', friday.prompt);
    else ok('prompt carries the exact task text');
    if (friday.name !== 'Run: Invoice download') fail('schedule: name from label', friday.name);
    else ok('name derived from task label');
    if (friday.outputTarget !== 'chat') fail('schedule: reports into chat', friday.outputTarget);
    else ok('output target is chat');
  }

  // "every friday..." with redundant "every" from the user → still parses.
  const everyPrefixed = parseComputerTaskSchedule({ task, schedulePhrase: 'every friday at 9am' });
  if (!everyPrefixed) fail('schedule: redundant "every" prefix tolerated', null);
  else ok('redundant "every" prefix tolerated');

  // Plain cadence word → m2 grammar.
  const weekly = parseComputerTaskSchedule({ task, schedulePhrase: 'weekly' });
  if (!weekly || weekly.cronExpression !== '0 9 * * 1') fail('schedule: weekly → monday 9am cron', weekly?.cronExpression);
  else ok('weekly → 0 9 * * 1');

  // Garbage cadence → null (UI shows guidance instead of filing junk).
  if (parseComputerTaskSchedule({ task, schedulePhrase: 'whenever vibes are good' }) !== null) {
    fail('schedule: unparseable cadence → null', null);
  } else ok('unparseable cadence → null');

  // Empty task → null.
  if (parseComputerTaskSchedule({ task: '', schedulePhrase: 'weekly' }) !== null) {
    fail('schedule: empty task → null', null);
  } else ok('empty task → null');
}

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
