/**
 * computer-use-steering-smoketest — verifies the mid-run steering
 * primitives (Phase 4e of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md):
 * note normalization/bounds, the guidance-only model framing, the
 * approval-look guard, and the confirmations-row classifier. The marker +
 * bound are duplicated in supabase/functions/computer-use-agent/index.ts —
 * these assertions pin the client side of that lockstep.
 *
 * Run: npm run smoke:computer-use-steering
 */

import {
  formatSteeringNoteForModel,
  isSteeringConfirmationRow,
  MAX_STEERING_NOTE_CHARS,
  normalizeSteeringNote,
  STEERING_QUESTION_MARKER,
  steeringNoteLooksLikeApproval,
} from '../src/lib/computerUseSteering';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Lockstep constants ──────────────────────────────────────────────────────
{
  expect(STEERING_QUESTION_MARKER === '__steering__', 'marker pinned (edge duplicates it)');
  expect(MAX_STEERING_NOTE_CHARS === 500, 'note bound pinned (edge duplicates it)');
  pass('lockstep constants');
}

// ── Normalization ───────────────────────────────────────────────────────────
{
  const ok = normalizeSteeringNote('  skip the first  site,\n try the official store ');
  expect(ok.ok && ok.note === 'skip the first site, try the official store', 'whitespace collapsed + trimmed');
  const empty = normalizeSteeringNote('   ');
  expect(!empty.ok, 'blank note rejected');
  const oversize = normalizeSteeringNote('x'.repeat(2000));
  expect(oversize.ok && oversize.note.length <= MAX_STEERING_NOTE_CHARS, 'oversize note clamped to the bound');
  expect(oversize.ok && oversize.note.endsWith('…'), 'clamped note shows truncation');
  pass('normalization: trim / reject-empty / clamp');
}

// ── Guidance-only framing ───────────────────────────────────────────────────
{
  const framed = formatSteeringNoteForModel('use the monthly price');
  expect(framed.includes('NOT an approval'), 'framing states not-an-approval');
  expect(framed.includes('ask_user'), 'framing routes confirmations to ask_user');
  expect(framed.trim().endsWith('use the monthly price'), 'note text rides after the framing');
  pass('guidance-only model framing');
}

// ── Approval-look guard ─────────────────────────────────────────────────────
{
  expect(steeringNoteLooksLikeApproval('yes'), '"yes" looks like an approval');
  expect(steeringNoteLooksLikeApproval('  Approve!  '), '"Approve!" looks like an approval');
  expect(steeringNoteLooksLikeApproval('go ahead'), '"go ahead" looks like an approval');
  expect(!steeringNoteLooksLikeApproval('yes but use the cheaper flight'), 'guidance with substance is not a bare approval');
  expect(!steeringNoteLooksLikeApproval('skip the first result'), 'ordinary guidance is not an approval');
  pass('approval-look guard');
}

// ── Row classifier ──────────────────────────────────────────────────────────
{
  expect(isSteeringConfirmationRow({ question: '__steering__' }), 'marker row classifies as steering');
  expect(!isSteeringConfirmationRow({ question: 'Proceed with the $120 purchase?' }), 'real ask_user rows are not steering');
  expect(!isSteeringConfirmationRow(null), 'null row → not steering');
  pass('confirmations-row classifier');
}

if (failures > 0) {
  console.error(`\n${failures} computer-use steering smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-use steering smoke cases passed.');
