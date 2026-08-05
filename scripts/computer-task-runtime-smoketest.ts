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
// 2.5 substitution visibility: the runtime's loop-model resolution is the
// REAL exported helper (computerTaskRuntime delegates to it), tsx-loadable
// via chatComputerHandoffContext — no mirror needed for this one.
import {
  COMPUTER_USE_PINNED_LOOP_MODEL,
  formatComputerTaskModelResolutionNotice,
  resolveComputerTaskLoopModel,
} from '../src/lib/chatComputerHandoffContext';
import { getModelCapabilityFlags } from '../src/lib/modelCapabilities';
// appAutomationControlSurfaces is Node-safe (no RN/supabase) so the pure
// observe-before-act helpers can be exercised directly here.
import {
  appendSurfaceEscalation,
  buildAppleNotesCreateNoteRecipe,
  buildAppleNotesCreateNoteSequence,
  buildObserveBeforeActPromptBlock,
  deriveAuditObservedEvidence,
  deriveSurfaceCapabilityStatusFromAudit,
  extractSurfaceFailureSignal,
  planSurfaceEscalation,
  MAX_SURFACE_DESCENTS_PER_RUN,
  MAX_SURFACE_ESCALATION_BREADCRUMBS,
  type AppAutomationControlSurfaceCandidate,
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

  // Notes native recipe: the adapter must not let "create a note" fall into
  // local-file-write-text. It should observe Notes first, use the named New
  // Note control, insert the requested body, and collect proof.
  const notesTask = 'open the notes app and create a note thats says hell ya fuckin right bitch';
  const notesRecipe = buildAppleNotesCreateNoteRecipe(notesTask);
  assert(notesRecipe?.id === 'desktop.notes_create_note', 'notes recipe: exact task selects reusable Notes recipe');
  assert(notesRecipe?.noteBody === 'hell ya fuckin right bitch', 'notes recipe: extracts requested note body');
  assert(
    notesRecipe?.sourceRefs.some((ref) => ref.includes('support.apple.com/guide/notes/create-and-edit-notes')),
    'notes recipe: carries official Notes source ref',
  );
  assert(
    notesRecipe?.sourceRefs.some((ref) => ref.includes('AutomatetheUserInterface.html')),
    'notes recipe: carries Apple UI scripting source ref',
  );
  assert(
    notesRecipe?.approvalBefore.some((item) => /mutating app state/i.test(item)),
    'notes recipe: records approval before side effect',
  );
  // The sequence is the one-shot AppleScript-backed `notes_create` bridge tool
  // (see buildAppleNotesCreateNoteSequence): deterministic single mutation, no
  // fragile UI dance, so 'observe-before-act' is intentionally not a smoke case.
  assert(
    ['research-before-guess', 'approval-before-side-effect', 'verified-proof']
      .every((smokeCase) => notesRecipe?.smokeCases.includes(smokeCase)),
    'notes recipe: declares required smoke cases',
  );
  const notesSequence = notesRecipe ? buildAppleNotesCreateNoteSequence(notesRecipe) : [];
  const notesKinds = notesSequence.map((step) => step.kind);
  assert(notesSequence.length > 1, 'notes sequence: recipe expands to deterministic desktop steps');
  assert(!notesKinds.includes('file_write_text'), 'notes sequence: never emits local-file-write-text');
  assert(
    notesKinds[0] === 'notes_create'
      && notesSequence[0].appQuery === 'Notes'
      && notesSequence[0].text === 'hell ya fuckin right bitch',
    'notes sequence: one-shot AppleScript notes_create carries the note body',
  );
  assert(
    !notesKinds.includes('semantic_click') && !notesKinds.includes('paste_text'),
    'notes sequence: no fragile New Note click / editor paste dance',
  );
  assert(notesKinds[notesKinds.length - 1] === 'screen_state', 'notes sequence: ends with proof screenshot');

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

  // ─── E1: mid-execution surface escalation policy ───────────────────
  const surf = (
    id: string,
    rank: number,
    approvalBefore: string[] = [],
  ): AppAutomationControlSurfaceCandidate => ({
    id: id as AppAutomationControlSurfaceCandidate['id'],
    label: id,
    rank,
    fit: 'secondary',
    bestFor: [],
    requirements: [],
    avoidWhen: [],
    approvalBefore,
    verification: [],
    sourceRefs: [],
  });
  const ladder = [
    surf('vendor_script_or_plugin_api', 90, ['running new scripts/plugins/macros']),
    surf('os_accessibility', 55, ['click/type/key actions that mutate state']),
    surf('semantic_desktop', 42, ['mutating app state']),
    surf('connected_agent_buildout', 30, ['patching runtime/bridge code']),
    surf('screenshot_coordinate_fallback', 10, ['any mutation or final action']),
  ];

  // Descend order: failure on the top rung goes to the NEXT-ranked rung,
  // always with freshObservationRequired and the new rung's uncovered approvals.
  const d1 = planSurfaceEscalation({
    currentSurfaceId: 'vendor_script_or_plugin_api',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'UXP command failed' },
    attemptedSurfaceIds: ['vendor_script_or_plugin_api'],
  });
  assert(d1.action === 'descend', 'e1: adapter error on top rung → descend');
  if (d1.action === 'descend') {
    assert(d1.next.id === 'os_accessibility', 'e1: descends to next-ranked rung');
    assert(d1.freshObservationRequired === true, 'e1: descend always requires a fresh observation');
    assert(
      d1.extraApprovalsRequired.includes('click/type/key actions that mutate state'),
      'e1: extraApprovalsRequired carries the new rung approvals not covered by the old rung',
    );
    assert(/escalated from vendor_script_or_plugin_api to os_accessibility/i.test(d1.reason), 'e1: descend reason is human-readable');
  }

  // Skip-attempted: already-tried rungs are never re-chosen.
  const d2 = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'element action failed' },
    attemptedSurfaceIds: ['vendor_script_or_plugin_api', 'os_accessibility'],
  });
  assert(d2.action === 'descend' && d2.next.id === 'semantic_desktop', 'e1: skips attempted rungs, picks next unattempted');

  // 'partial' capability = degraded rung: ranked after every ready/unknown rung.
  const d3 = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'element action failed' },
    attemptedSurfaceIds: ['os_accessibility'],
    capabilityStatusById: { semantic_desktop: 'partial' },
  });
  assert(d3.action === 'descend' && d3.next.id === 'screenshot_coordinate_fallback', 'e1: partial rung demoted below ready rungs');
  const d3b = planSurfaceEscalation({
    currentSurfaceId: 'semantic_desktop',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'menu path failed' },
    attemptedSurfaceIds: ['semantic_desktop'],
    capabilityStatusById: { screenshot_coordinate_fallback: 'partial' },
  });
  assert(
    d3b.action === 'descend' && d3b.next.id === 'screenshot_coordinate_fallback' && /degraded/i.test(d3b.reason),
    'e1: a partial rung is still usable when nothing ready remains, and the reason says degraded',
  );

  // 'missing' capability excludes the rung entirely.
  const d4 = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'element action failed' },
    attemptedSurfaceIds: ['os_accessibility'],
    capabilityStatusById: { semantic_desktop: 'missing', screenshot_coordinate_fallback: 'missing' },
  });
  assert(d4.action === 'stop' && /no usable lower control surface/i.test(d4.reason), 'e1: known-missing rungs are excluded → stop');

  // ≤2 descents per run, then stop WITH the attempted-surface history.
  const exhausted = planSurfaceEscalation({
    currentSurfaceId: 'semantic_desktop',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'still failing' },
    attemptedSurfaceIds: ['vendor_script_or_plugin_api', 'os_accessibility', 'semantic_desktop'],
  });
  assert(exhausted.action === 'stop', `e1: stops after ${MAX_SURFACE_DESCENTS_PER_RUN} descents`);
  assert(
    exhausted.action === 'stop'
      && exhausted.reason.includes('vendor_script_or_plugin_api')
      && exhausted.reason.includes('os_accessibility')
      && exhausted.reason.includes('semantic_desktop'),
    'e1: budget-exhausted stop reason carries the attempted-surface history',
  );

  // Non-escalating failures NEVER descend — approval/user/verification
  // boundaries stop and wait instead of being silently widened around.
  for (const code of ['approval_rejected', 'approval_required', 'verification_gate', 'user_constraint_block', 'permission_denied', 'not_paired']) {
    const blocked = planSurfaceEscalation({
      currentSurfaceId: 'vendor_script_or_plugin_api',
      candidates: ladder,
      failure: { code, message: `${code} fired` },
      attemptedSurfaceIds: ['vendor_script_or_plugin_api'],
    });
    assert(blocked.action === 'stop' && /non-escalating/i.test(blocked.reason), `e1: ${code} never descends`);
  }
  const blockedArea = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { area: 'approval_boundary', message: 'approval boundary hit' },
    attemptedSurfaceIds: ['os_accessibility'],
  });
  assert(blockedArea.action === 'stop', 'e1: approval_boundary failure area never descends');

  // a11y coverage failures descend PAST tree-dependent rungs toward pixels.
  const a11y = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { code: 'a11y_tree_empty', message: 'a11y tree came back empty' },
    attemptedSurfaceIds: ['os_accessibility'],
  });
  assert(
    a11y.action === 'descend' && a11y.next.id === 'screenshot_coordinate_fallback',
    'e1: a11y_tree_empty skips other tree-dependent rungs → screenshot/coordinate rung',
  );

  // Stale a11y path: one fresh-observation retry on the SAME rung first,
  // then it behaves like a coverage miss.
  const stale0 = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { code: 'a11y_path_stale', message: 'path stale' },
    attemptedSurfaceIds: ['os_accessibility'],
    sameSurfaceRetryCount: 0,
  });
  assert(stale0.action === 'retry_same' && stale0.reason.length > 0, 'e1: first a11y_path_stale → retry_same with reason');
  const stale1 = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: ladder,
    failure: { code: 'a11y_path_stale', message: 'path stale again' },
    attemptedSurfaceIds: ['os_accessibility'],
    sameSurfaceRetryCount: 1,
  });
  assert(
    stale1.action === 'descend' && stale1.next.id === 'screenshot_coordinate_fallback',
    'e1: second a11y_path_stale behaves like a coverage miss → pixel rung',
  );

  // connected_agent_buildout is not an in-run rung — never chosen as `next`.
  const pastBuildout = planSurfaceEscalation({
    currentSurfaceId: 'semantic_desktop',
    candidates: ladder,
    failure: { code: 'adapter_error', message: 'menu path failed' },
    attemptedSurfaceIds: ['semantic_desktop'],
  });
  assert(
    pastBuildout.action === 'descend' && pastBuildout.next.id === 'screenshot_coordinate_fallback',
    'e1: connected_agent_buildout is skipped as an in-run rung',
  );

  // Breadcrumbs: bounded (≤3, oldest dropped) and compact.
  let crumbs: ReturnType<typeof appendSurfaceEscalation> = [];
  for (let i = 0; i < 5; i += 1) {
    crumbs = appendSurfaceEscalation(crumbs, {
      fromSurface: `from-${i}`,
      toSurface: `to-${i}`,
      reason: 'r'.repeat(500),
      atIso: new Date().toISOString(),
      appName: 'Adobe Photoshop',
      failureCode: 'a11y_tree_empty',
    });
  }
  assert(crumbs.length === MAX_SURFACE_ESCALATION_BREADCRUMBS, 'e1: breadcrumbs bounded to 3');
  assert(crumbs[0].fromSurface === 'from-2' && crumbs[2].fromSurface === 'from-4', 'e1: oldest breadcrumb dropped first');
  assert(crumbs[0].reason.length <= 300, 'e1: breadcrumb reason kept compact');
  assert(crumbs[0].appName === 'Adobe Photoshop' && crumbs[0].failureCode === 'a11y_tree_empty', 'e1: a11y breadcrumb carries app name + failure code (AX-coverage telemetry)');

  // Failure-signal extraction: structured errorCode wins; message scan backs it up.
  assert(
    extractSurfaceFailureSignal({ message: 'boom', data: { errorCode: 'a11y_tree_empty' } }).code === 'a11y_tree_empty',
    'e1: extract uses data.errorCode first',
  );
  assert(
    extractSurfaceFailureSignal({ message: 'desktop_a11y_tree failed with a11y_tree_empty' }).code === 'a11y_tree_empty',
    'e1: extract finds known codes in the message',
  );
  assert(
    extractSurfaceFailureSignal({ message: 'dialog', data: { kind: 'desktop_ai_modal_decision_needed' } }).code === 'user_decision_needed',
    'e1: blocking-modal kind maps to a non-escalating code',
  );

  // Audit → per-surface capability status ('partial' preserved, not 'ready').
  const partialStatus = deriveSurfaceCapabilityStatusFromAudit(auditWith([
    { id: 'desktop_control', status: 'partial' },
    { id: 'browser_automation', status: 'ready' },
  ]) as any);
  assert(partialStatus.os_accessibility === 'partial', 'e1: partial desktop_control → os_accessibility partial (not ready)');
  assert(partialStatus.browser_dom_cdp === 'ready', 'e1: ready browser_automation → browser rung ready');
  assert(!('vendor_script_or_plugin_api' in partialStatus), 'e1: surfaces without audit signal stay unknown');

  // ─── 2.5: model substitution visibility at the runtime entry ───────
  // executeComputerTaskWithAgent computes `modelResolution` from the user's
  // selected model with these exact helpers: text-only planner/validator
  // steps keep args.model (executeAgentRun is always called with it
  // unchanged); only the native screenshot/action loop pins Sonnet, and
  // only THAT substitution surfaces a notice.
  const runtimeKept = resolveComputerTaskLoopModel('claude-sonnet-4-6');
  assert(
    getModelCapabilityFlags('claude-sonnet-4-6').computerUse && !runtimeKept.substituted,
    '2.5: computerUse:true model → no substitution, no notice',
  );
  assert(
    formatComputerTaskModelResolutionNotice(runtimeKept) === '',
    '2.5: kept model formats to an empty notice',
  );
  const runtimeSwapped = resolveComputerTaskLoopModel('openrouter/deepseek/deepseek-chat');
  assert(
    !getModelCapabilityFlags('openrouter/deepseek/deepseek-chat').computerUse
      && runtimeSwapped.substituted
      && runtimeSwapped.reason === 'computer_use_requires_sonnet',
    '2.5: computerUse:false model → visible substitution with typed reason',
  );
  assert(
    runtimeSwapped.resolvedModel === COMPUTER_USE_PINNED_LOOP_MODEL,
    '2.5: substitution resolves to the pinned Sonnet loop model',
  );
  assert(
    formatComputerTaskModelResolutionNotice(runtimeSwapped)
      === 'Screen loop needs computer-use, so it runs on claude-sonnet-4-6; your pick (deepseek-chat) still plans and verifies.',
    '2.5: notice is the one compact user-facing line',
  );
  assert(
    !resolveComputerTaskLoopModel(undefined).substituted
      && resolveComputerTaskLoopModel(undefined).resolvedModel === COMPUTER_USE_PINNED_LOOP_MODEL,
    '2.5: no selected model → plain default pin, never a notice',
  );
  assert(
    resolveComputerTaskLoopModel('some-brand-new-model').substituted,
    '2.5: unknown model ids fail closed → pinned loop model + visible substitution',
  );

  if (failures > 0) {
    console.error(`\n${failures} computer-task-runtime smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll computer-task-runtime smoke cases passed.');
}

main();
