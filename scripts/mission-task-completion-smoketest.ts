/**
 * mission-task-completion-smoketest — pins the honest "is this mission task
 * done?" gate (src/lib/missionTaskCompletion). Accountability is the product:
 * a dispatched task may ONLY read as `done` on positive evidence of completion.
 *
 * Covers: fail-closed on failed tools / failed verification / blocker phrases /
 * partial (step-cap) runs / empty replies; a clean successful run reads done;
 * degenerate input never throws.
 *
 * Run: npm run smoke:mission-task-completion
 */

import assert from 'node:assert/strict';

import {
  assessMissionTaskCompletion,
  shouldMarkMissionTaskComplete,
} from '../src/lib/missionTaskCompletion';

// ── A clean, evidenced run reads done ────────────────────────────────────────
{
  const a = assessMissionTaskCompletion({
    response: 'Shipped the landing page and verified the hero renders in staging.',
    toolEvents: [{ status: 'completed' }, { status: 'completed' }],
    verificationResults: [{ ok: true, status: 'completed' }],
    artifacts: [{ kind: 'file' }],
  });
  assert.equal(a.completed, true, 'clean evidenced run → done');
  assert.equal(a.reason, undefined, 'no reason when completed');
}

// ── Fail-closed: any failed/blocked/manual tool → not done ───────────────────
for (const status of ['failed', 'blocked', 'manual_required', 'error', 'timeout', 'denied']) {
  const a = assessMissionTaskCompletion({
    response: 'All good, finished the task.',
    toolEvents: [{ status: 'completed' }, { status }],
  });
  assert.equal(a.completed, false, `tool status "${status}" blocks completion`);
  assert.equal(a.reason, 'failed_tool', `tool status "${status}" → failed_tool`);
}

// ── Fail-closed: verification not-ok / non-clean status → not done ───────────
{
  const notOk = assessMissionTaskCompletion({
    response: 'Done.',
    verificationResults: [{ ok: false, status: 'failed' }],
  });
  assert.equal(notOk.completed, false, 'ok:false verification blocks completion');
  assert.equal(notOk.reason, 'failed_verification');

  const manual = assessMissionTaskCompletion({
    response: 'Done.',
    verificationResults: [{ ok: true, status: 'manual_required' }],
  });
  assert.equal(manual.completed, false, 'manual_required verification blocks completion');
  assert.equal(manual.reason, 'failed_verification');
}

// ── Fail-closed: blocker phrases in the reply → not done ─────────────────────
for (const phrase of [
  'I need more information to proceed.',
  'This is blocked on the API key.',
  "I can't complete this without repo access.",
  'I was unable to complete the deploy.',
  "I wasn't able to finish the task.",
  'Please provide the target environment.',
  'I could not complete the migration.',
]) {
  const a = assessMissionTaskCompletion({ response: phrase, toolEvents: [{ status: 'completed' }] });
  assert.equal(a.completed, false, `blocker phrase blocks completion: "${phrase}"`);
  assert.equal(a.reason, 'blocker_phrase', `"${phrase}" → blocker_phrase`);
}

// ── Fail-closed: PARTIAL / step-cap runs → not done ──────────────────────────
// The session runtime drops the typed `incomplete` flag before the dispatcher;
// the "partial / resumable / step cap / continue" wording in the reply is the
// last defense against a truncated run reading as complete.
for (const phrase of [
  'Hit the per-turn step cap after 12 steps; partial and resumable.',
  'The tool loop hit its step cap before finishing; the response may be partial.',
  'I ran out of steps before finishing — this can be resumed.',
  'Reached the iteration limit. I will continue in a follow-up.',
  'This is a partial result; to be continued.',
]) {
  const a = assessMissionTaskCompletion({ response: phrase, toolEvents: [{ status: 'completed' }] });
  assert.equal(a.completed, false, `partial-run wording blocks completion: "${phrase}"`);
  assert.equal(a.reason, 'incomplete_partial', `"${phrase}" → incomplete_partial`);
}

// ── The partial-run guard must NOT over-block genuine completions that merely
//    contain the words "partial" / "continue" in an unrelated sense ───────────
for (const response of [
  'Refactored the partial derivatives module and all tests pass.',
  'Applied the changes; click Continue in the wizard to move on.',
  'The partial refund flow now works end to end and is deployed.',
  'Users can continue browsing while the sync runs in the background. Done.',
]) {
  const a = assessMissionTaskCompletion({ response, toolEvents: [{ status: 'completed' }] });
  assert.equal(a.completed, true, `benign "partial"/"continue" wording still reads done: "${response}"`);
}

// ── PROOF-BEFORE-DONE: an empty / blank reply is never "done" ────────────────
for (const response of ['', '   ', '\n\t ']) {
  const a = assessMissionTaskCompletion({ response, toolEvents: [{ status: 'completed' }] });
  assert.equal(a.completed, false, `empty reply "${JSON.stringify(response)}" is never done`);
  assert.equal(a.reason, 'empty_response', 'empty reply → empty_response');
}
// Even with a successful tool + passing verification, an empty summary withholds
// completion — the run must actually SAY what it did.
{
  const a = assessMissionTaskCompletion({
    response: '',
    toolEvents: [{ status: 'completed' }],
    verificationResults: [{ ok: true, status: 'completed' }],
    artifacts: [{ kind: 'file' }],
  });
  assert.equal(a.completed, false, 'empty reply blocks completion even with clean tools/verification');
  assert.equal(a.reason, 'empty_response');
}

// ── Precedence: a failed tool wins over an otherwise-fine reply ──────────────
{
  const a = assessMissionTaskCompletion({
    response: 'Everything finished cleanly.',
    toolEvents: [{ status: 'failed' }],
    verificationResults: [{ ok: true }],
  });
  assert.equal(a.reason, 'failed_tool', 'failed tool takes precedence over a positive reply');
}

// ── A normal completion with no tools at all still requires a real reply ─────
// (A pure planning/answer task: no tools, no verification, but a substantive
//  reply → done. This preserves today's behavior for genuine text deliverables.)
{
  const a = assessMissionTaskCompletion({
    response: 'Here is the researched summary with three sources and a recommendation.',
  });
  assert.equal(a.completed, true, 'substantive text-only deliverable reads done');
}

// ── Degenerate input never throws + boolean wrapper ──────────────────────────
assert.equal(assessMissionTaskCompletion(null as any).completed, false, 'null input → not done, no throw');
assert.equal(assessMissionTaskCompletion(undefined as any).completed, false, 'undefined input → not done, no throw');
assert.equal(
  assessMissionTaskCompletion({ response: 'ok', toolEvents: null as any, verificationResults: null as any }).completed,
  true,
  'null arrays tolerated (treated as empty)',
);
assert.equal(
  shouldMarkMissionTaskComplete({ response: 'shipped and verified', toolEvents: [{ status: 'completed' }] }),
  true,
  'boolean wrapper returns the verdict',
);
assert.equal(
  shouldMarkMissionTaskComplete({ response: '' }),
  false,
  'boolean wrapper fails closed on empty reply',
);

console.log('All mission-task-completion smoke cases passed.');
