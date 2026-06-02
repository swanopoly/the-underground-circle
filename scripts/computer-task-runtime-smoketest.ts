/**
 * computer-task-runtime-smoketest — pins the hasFollowUpIntent
 * detector that decides whether a "open <app>" utterance short-
 * circuits after launch (pure launch) or continues to the full agent
 * run (multi-intent, e.g. "open notes and create a note"). Regression
 * on this = the "launched Notes but then said can't do it" bug.
 *
 * Run: npm run smoke:computer-task-runtime
 */

import { shouldRunLocalComputerAwarenessIntentSequence } from '../src/lib/localComputerAwarenessIntent';
// appAutomationControlSurfaces is Node-safe (no RN/supabase) so the pure
// observe-before-act helpers can be exercised directly here.
import {
  buildObserveBeforeActPromptBlock,
  deriveAuditObservedEvidence,
} from '../src/lib/appAutomationControlSurfaces';

const auditWith = (findings: Array<{ id: string; status: string }>): any => ({
  findings: findings.map((f) => ({ ...f, label: f.id, detail: '', sources: [] })),
  missing: [],
  availableIntegrationProviders: [],
  availableIntegrationCapabilities: [],
  activeBridgeProviders: [],
  activeMcpServerCount: 0,
  activeMcpToolCount: 0,
});

// Can't import directly from src/lib/computerTaskRuntime — it drags in
// react-native via agentRuntime → executeAgentRun. Mirror the detector
// here. Keep in lockstep with the real one.
function hasFollowUpIntent(task: string): boolean {
  const lower = String(task || '').trim().toLowerCase();
  if (!lower) return false;
  if (/\b(then|and then|after|next|also|,)\b/i.test(lower)) return true;
  if (/\band\s+(?!(?:i|i'?m|the|a|an)\b)\w/i.test(lower)) return true;
  if (/\b(create|write|type|make|draft|send|post|compose|record|start a|new|save|crop|edit|resize|export|draw|paint|generate|render|retouch)\b/i.test(lower)) return true;
  if (/\b(with|about|for)\s+\w+/i.test(lower) && lower.length > 25) return true;
  return false;
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Pure launches — should NOT trigger follow-up ────────────────
  const pureLaunches = [
    'open zoom',
    'launch slack',
    'start spotify',
    'switch to finder',
    'open Notes',
    'open the calculator',
    'open chrome',
    'fire up discord',
    'open zoom app',
    'open zoom app on my computer',
    'please open safari',
  ];
  for (const u of pureLaunches) {
    assert(!hasFollowUpIntent(u), `pure: "${u}" → no follow-up`);
  }

  // ─── Multi-intent — MUST trigger follow-up ───────────────────────
  const multiIntent = [
    ['open notes and create a note', 'and + create'],
    ['open notes and create your own note', 'and + create + own'],
    ['open zoom and start a meeting', 'and + start-a'],
    ['open safari then go to github', 'then conjunction'],
    ['launch terminal, then run claude', 'comma conjunction'],
    ['open mail and compose a new message', 'and + compose'],
    ['open reminders and add milk', 'and + add (bare)'],
    ['open notes then write about my day', 'then + write'],
    ['open notes and type hello', 'and + type'],
    ['open calendar and create a new event for tomorrow', 'and + create + for'],
    ['open terminal, then type claude and press enter', 'multi-clause'],
    ['open messages and send a text to mom', 'and + send'],
    ['open spotify then play jazz', 'then + play'],
    ['open finder, then find my resume', 'then'],
    ['open safari and navigate to google', 'and + navigate'],
    ['open photoshop to crop the image', 'to + crop'],
    ['open photoshop to save the image as test-it.jpg', 'to + save'],
    ['open figma to export the selected frame', 'to + export'],
    ['open canva to generate a banner', 'to + generate'],
  ];
  for (const [u, hint] of multiIntent) {
    assert(hasFollowUpIntent(u), `multi: "${u}" → follow-up (${hint})`);
  }

  // ─── Tricky cases ─────────────────────────────────────────────────
  // False-positive guard: "open the X" shouldn't be flagged just because
  // it contains "the" (we restricted the \band\w rule to NOT match
  // stopwords like "the"/"a"/"an"/"i").
  assert(!hasFollowUpIntent('open the terminal'), 'tricky: "open the terminal" → no follow-up');
  assert(!hasFollowUpIntent('open a browser'), 'tricky: "open a browser" → no follow-up');
  assert(!hasFollowUpIntent('open an image in preview'), 'tricky: "open an image" → treated as single-intent (ambiguous)');
  // Long "with" clause should count as follow-up ("compose an email WITH subject...")
  assert(hasFollowUpIntent('open mail with subject hello world greetings'), 'tricky: "with" + long clause → follow-up');
  // Short "with" shouldn't trigger alone
  assert(!hasFollowUpIntent('open notes with me'), 'tricky: short "with" → no follow-up');
  // Empty / whitespace
  assert(!hasFollowUpIntent(''), 'edge: empty → no follow-up');
  assert(!hasFollowUpIntent('   '), 'edge: whitespace → no follow-up');

  // ─── Verb-only catch — "take a note", "send an email" ─────────────
  // These don't have "open" at all but still imply multi-step work
  // inside an app. The detector currently returns true for anything
  // with create/write/type/make/draft/send/post/compose/record/new.
  assert(hasFollowUpIntent('take a new note'), 'verb: "take a new note"');
  assert(hasFollowUpIntent('send an email to chris'), 'verb: "send email"');
  assert(hasFollowUpIntent('compose a message to the team'), 'verb: "compose message"');

  const capabilityRetryTask = 'open Photoshop and press Cmd+S';
  assert(
    shouldRunLocalComputerAwarenessIntentSequence(capabilityRetryTask),
    'deterministic sequence: app workflow normally runs locally',
  );
  assert(
    !shouldRunLocalComputerAwarenessIntentSequence(capabilityRetryTask, { hasReadyCapabilityBuildout: true }),
    'deterministic sequence: ready capability buildout uses retry prompt instead',
  );

  // ─── Observe-before-act helpers (Phase 2) ─────────────────────────
  assert(deriveAuditObservedEvidence(null).length === 0, 'observe: null audit → no evidence');
  const readyEvidence = deriveAuditObservedEvidence(auditWith([
    { id: 'desktop_control', status: 'ready' },
    { id: 'file_write', status: 'ready' },
  ]));
  assert(readyEvidence.some((e) => /desktop bridge/i.test(e)), 'observe: ready bridge → bridge evidence');
  assert(readyEvidence.some((e) => /file grants/i.test(e)), 'observe: ready file_write → file-grant evidence');
  assert(
    deriveAuditObservedEvidence(auditWith([{ id: 'desktop_control', status: 'missing' }])).length === 0,
    'observe: nothing ready → no evidence',
  );

  const observeTask = 'open Photoshop and crop the image';
  assert(buildObserveBeforeActPromptBlock(observeTask, []) === '', 'observe: no observations → empty block (fail open)');
  const observedBlock = buildObserveBeforeActPromptBlock(
    observeTask,
    ['Frontmost app: Adobe Photoshop', 'Active window: Untitled-1'],
    { auditEvidence: readyEvidence },
  );
  assert(observedBlock.includes('## Live surface state'), 'observe: block has live-state header');
  assert(observedBlock.includes('Frontmost app: Adobe Photoshop'), 'observe: block echoes the observation');
  assert(/Observed route status:/.test(observedBlock), 'observe: block carries a re-decided status line');
  assert(/do not act blind/i.test(observedBlock), 'observe: block instructs not to act blind');

  if (failures > 0) {
    console.error(`\n${failures} computer-task-runtime smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll computer-task-runtime smoke cases passed.');
}

main();
