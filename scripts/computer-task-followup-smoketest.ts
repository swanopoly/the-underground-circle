/**
 * computer-task-followup-smoketest (WI-5) — matrix for matchBookingFollowup:
 * ordinals, word-ordinals, superlatives, title match, Case A (open confirmation)
 * vs Case B (terminal + findings), and the negative cases (random chat -> none;
 * clarification-collision passthrough -> none).
 *
 * Run: npx tsx scripts/computer-task-followup-smoketest.ts
 */

import {
  matchBookingFollowup,
  synthesizeBookingTask,
  type BookingFollowupLastRun,
} from '../src/lib/computerTaskFollowup';

let failures = 0;

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` - ${detail}` : ''}`);
  }
}

const findings = [
  { title: 'Marriott Downtown Chicago', url: 'https://marriott.com/dt', price: '$289' },
  { title: 'Courtyard River North', url: 'https://marriott.com/rn', price: '$189' },
  { title: 'JW Marriott Loop', url: 'https://marriott.com/jw', price: '$399' },
];

const terminalRun: BookingFollowupLastRun = {
  runId: 'run_42',
  sessionId: 'sess_42',
  findings,
  completedAt: '2026-07-01T00:00:00Z',
};

const liveConfirmRun: BookingFollowupLastRun = {
  runId: 'run_43',
  sessionId: 'sess_43',
  findings,
  pendingConfirmationId: 'conf_9',
};

// ── Case B: terminal run, numeric ordinal ────────────────────────────────────
{
  const r = matchBookingFollowup('book option 2', terminalRun);
  assert(r.kind === 'continue_session', '"book option 2" -> continue_session', r.kind);
  if (r.kind === 'continue_session') {
    assert(r.optionIndex === 1, 'option 2 -> index 1', String(r.optionIndex));
    assert(r.sessionId === 'sess_42', 'reuses sessionId');
    assert(r.task.includes('Courtyard River North'), 'task names the option', r.task);
    assert(r.task.includes('continuing run run_42'), 'task carries run id', r.task);
    assert(r.task.includes('https://marriott.com/rn'), 'task carries url', r.task);
  }
}

// word ordinal
{
  const r = matchBookingFollowup('go with the second one', terminalRun);
  assert(r.kind === 'continue_session' && r.optionIndex === 1, '"the second one" -> index 1', r.kind);
}
// #N form
{
  const r = matchBookingFollowup('book #3', terminalRun);
  assert(r.kind === 'continue_session' && r.optionIndex === 2, '"#3" -> index 2', r.kind);
}
// Nth suffix
{
  const r = matchBookingFollowup('reserve the 1st', terminalRun);
  assert(r.kind === 'continue_session' && r.optionIndex === 0, '"the 1st" -> index 0', r.kind);
}
// superlative cheapest (by price parse -> Courtyard $189 = index 1)
{
  const r = matchBookingFollowup('book the cheapest one', terminalRun);
  assert(r.kind === 'continue_session' && r.optionIndex === 1, '"cheapest" -> index 1 ($189)', r.kind);
}
// superlative first / last
{
  const first = matchBookingFollowup('book the first option', terminalRun);
  assert(first.kind === 'continue_session' && first.optionIndex === 0, '"first" -> index 0', first.kind);
  const last = matchBookingFollowup('reserve the last one', terminalRun);
  assert(last.kind === 'continue_session' && last.optionIndex === 2, '"last" -> index 2', last.kind);
}
// title substring match
{
  const r = matchBookingFollowup('book the JW Marriott Loop please', terminalRun);
  assert(r.kind === 'continue_session' && r.optionIndex === 2, 'title match -> index 2', r.kind);
}

// ── Case A: live confirmation open ───────────────────────────────────────────
{
  const r = matchBookingFollowup('option 2', liveConfirmRun);
  assert(r.kind === 'resolve_confirmation', '"option 2" w/ open confirm -> resolve', r.kind);
  if (r.kind === 'resolve_confirmation') {
    assert(r.confirmationId === 'conf_9', 'carries confirmation id');
    assert(r.optionIndex === 1, 'resolved index 1');
    assert(r.choice.includes('Courtyard'), 'choice includes option title', r.choice);
  }
}
// bare "yes" is meaningful ONLY when a confirmation is open
{
  const r = matchBookingFollowup('yes', liveConfirmRun);
  assert(r.kind === 'resolve_confirmation' && r.choice === 'yes', '"yes" resolves open confirm', r.kind);
}
{
  const r = matchBookingFollowup('yes', terminalRun);
  assert(r.kind === 'none', '"yes" on terminal run (no confirm) -> none', r.kind);
}
// confirmation open but message is a question, not a selection -> none (passthrough)
{
  const r = matchBookingFollowup('what is the cancellation policy?', liveConfirmRun);
  assert(r.kind === 'none', 'non-selection question w/ open confirm -> none', r.kind);
}
// "the cheapest one" while confirmation open -> resolve (spec passthrough anchor)
{
  const r = matchBookingFollowup('the cheapest one', liveConfirmRun);
  assert(r.kind === 'resolve_confirmation' && r.optionIndex === 1, '"cheapest" w/ open confirm -> resolve idx 1', r.kind);
}

// ── Negative / collision guard ───────────────────────────────────────────────
{
  const r = matchBookingFollowup('what should I have for lunch today?', terminalRun);
  assert(r.kind === 'none', 'random chat -> none', r.kind);
}
{
  // "option 2" reply that belongs to a NON-booking clarification: the ChatTab
  // wiring runs pendingClarificationRef FIRST, but this asserts the matcher
  // itself does not fabricate a booking when there is no prior run at all.
  const r = matchBookingFollowup('option 2', null);
  assert(r.kind === 'none', '"option 2" with no prior run -> none', r.kind);
}
{
  // No findings and no pending confirmation -> nothing to continue.
  const r = matchBookingFollowup('book option 1', { runId: 'r', sessionId: 's', findings: [], completedAt: 1 });
  assert(r.kind === 'none', 'terminal run with empty findings -> none', r.kind);
}
{
  // Booking verb but no resolvable option (out of range) -> none, don't guess.
  const r = matchBookingFollowup('book option 9', terminalRun);
  assert(r.kind === 'none', 'out-of-range option on terminal run -> none', r.kind);
}
{
  // Bare booking verb, no option pointer -> let clarification handle it.
  const r = matchBookingFollowup('book it', terminalRun);
  assert(r.kind === 'none', 'bare "book it" on terminal run (no option) -> none', r.kind);
}
{
  const r = matchBookingFollowup('', terminalRun);
  assert(r.kind === 'none', 'empty message -> none', r.kind);
}
{
  // Out-of-range ordinal on a LIVE confirmation is still forwardable as a
  // positional choice (edge disambiguates), unlike terminal Case B.
  const r = matchBookingFollowup('option 5', liveConfirmRun);
  assert(r.kind === 'resolve_confirmation' && r.optionIndex === 4, 'out-of-range ordinal w/ open confirm forwards', r.kind);
}

// ── synthesizeBookingTask shape ──────────────────────────────────────────────
{
  const task = synthesizeBookingTask({ title: 'Test Hotel', url: 'https://x.com' }, 'run_z');
  assert(task === 'Book: Test Hotel — https://x.com (continuing run run_z)', 'task format matches spec', task);
  const noUrl = synthesizeBookingTask({ title: 'No URL Hotel' }, null);
  assert(noUrl === 'Book: No URL Hotel', 'task w/o url or run id', noUrl);
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll computer-task-followup assertions passed.');
