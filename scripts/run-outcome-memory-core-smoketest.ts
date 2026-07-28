/**
 * run-outcome-memory-core-smoketest — the PURE signal/noise layer behind the
 * agent-run memory capture hook (src/lib/runOutcomeMemoryCore.ts), fired at the
 * `agentRuntime.executeAgentRun` finalization barrier.
 *
 * WHY THESE ASSERTIONS MATTER
 * ---------------------------
 * Until this core existed, the agent-run loop AND the whole Computer-Use /
 * app-automation pipeline distilled ZERO memories: `agentRuntime` fires
 * `recordArchiveDerivedMemorySuccess` / `…WeakSignal`, but those only SCORE
 * memories the run consumed — they never CREATE one. So the failure modes the
 * product exists to stop repeating were discarded every run.
 *
 * The fix's risk is the mirror image: a hook that saves noise is WORSE than no
 * hook, because every junk row is embedded into pgvector and then competes for
 * the bounded memory slots in every later prompt. So the load-bearing property
 * under test is NOT "it saves things" — it is "it saves ONLY a durable,
 * transferable lesson, and never a prompt echo, a generic completion, a one-off
 * value, or a credential."
 *
 *   buildRunOutcomeMemory(input): total. `{capture:false, reason}` for every
 *     degenerate/noisy input; `{capture:true, memory}` only when a REUSABLE
 *     SUBJECT (lane > route > profile) meets a TRANSFERABLE FINDING.
 *   resolveRunOutcomeSubject: lane (Computer-Use pipeline) beats route beats
 *     profile; `talk`/`local_reply` runs resolve to no subject at all.
 *   extractEvidenceSentences: keeps referent-bearing prose, drops echoes,
 *     generic completions, short fragments and credential-shaped sentences.
 *   clampText / clampBlock: bounded output; the LESSON survives a verbose frame.
 *
 * REGRESSION ANCHORS (the failure modes that would silently ruin retrieval):
 *   (a) "Task completed. Let me know if you need anything else." → NEVER saved.
 *   (b) a response that merely restates the prompt → NEVER saved.
 *   (c) an `inconclusive` run with no proof → NEVER saved as "this worked";
 *       when it IS saved it is titled "Run signal (unverified)".
 *   (d) a leaked token anywhere in the composed row → refused, and the refusal
 *       detail never contains the value.
 *   (e) `source_surface` is the run's REAL surface — the hook must not inherit
 *       `memoryService.saveAgentMemory`'s hard-coded 'feed_task' lie.
 *   (f) LOCKSTEP with `memoryConsolidation.isHighQualityMemory` (the shared
 *       quality bar the runtime applies as the final gate): if its 15-char
 *       floor or its 'finding' scoring changes, this smoke fails loudly instead
 *       of the capture silently going dark.
 *
 * Pure — loads under tsx (the core has type-only imports plus the
 * dependency-free `userMemoryCaps`).
 *   npx tsx scripts/run-outcome-memory-core-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildRunOutcomeMemory,
  resolveRunOutcomeSubject,
  extractEvidenceSentences,
  clampText,
  clampBlock,
  significantTokens,
  tokenContainment,
  hasConcreteReferent,
  isGenericCompletionText,
  isOneOffValueOnly,
  splitSentences,
  stableHash,
  normalizeSourceRunId,
  RUN_OUTCOME_MEMORY_KIND,
  RUN_OUTCOME_MEMORY_VERSION,
  MAX_TITLE_CHARS,
  MAX_CONTENT_CHARS,
  MAX_LESSON_BODY_CHARS,
  MAX_EXCERPT_CHARS,
  MAX_INTENT_CHARS,
  MAX_EVIDENCE_SENTENCES,
  MAX_EVIDENCE_SENTENCE_CHARS,
  MIN_LESSON_CHARS,
  MIN_EVIDENCE_SENTENCE_CHARS,
  MIN_REUSABLE_TOKENS,
  PROMPT_RESTATEMENT_MAX_OVERLAP,
  HIGH_QUALITY_BAR_MIN_CONTENT_CHARS,
  type RunOutcomeMemoryInput,
  type RunOutcomeMemoryDecision,
  type RunOutcomeMemoryWrite,
} from '../src/lib/runOutcomeMemoryCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// Fixed clock — the core takes `nowMs` so nothing here depends on wall time.
const NOW = Date.UTC(2026, 6, 24, 12, 0, 0);
const RUN_UUID = '3f1c2b7a-9d4e-4a12-8b55-0c6d7e8f9a10';

// ── fixtures ────────────────────────────────────────────────────────────────

/** A real Computer-Use run: WP admin media upload over the desktop bridge. */
function computerRun(over: Partial<RunOutcomeMemoryInput> = {}): RunOutcomeMemoryInput {
  return {
    nowMs: NOW,
    runId: RUN_UUID,
    surface: 'main_chat',
    mode: 'build',
    taskKind: 'build',
    profile: 'openswan_builder',
    impactDomain: 'marketing_ops',
    routingIntent: 'automation',
    prompt: 'Upload the new hero image to the dealership media library.',
    response: [
      'The WordPress admin media uploader rejected the drag-drop path, so I switched to the desktop.observe_app plus wp.upload_media adapter which succeeded.',
      'The selector #wp-media-grid only appears after the Add New button is clicked.',
    ].join(' '),
    terminalStatus: 'completed',
    observedEval: {
      outcome: 'strong',
      score: 88,
      verification: { planned: 2, executed: 2, passed: 2, failed: 0, manualRequired: 0, blocked: 0 },
      artifacts: { total: 2, durable: 1, kinds: ['screenshot'] },
      tools: { total: 3, failed: 0, manualRequired: 0, blocked: 0, names: ['desktop.observe_app', 'wp.upload_media'] },
      blockers: [],
    },
    automation: {
      executionKind: 'run_computer_task',
      routeId: 'wp.media.upload',
      risk: 'medium',
      pipelineId: 'wp_admin_media',
      pipelineTitle: 'WordPress admin media upload',
      category: 'cms_admin',
      primarySurface: 'desktop_bridge',
      recommendedTools: ['browser.click', 'browser.upload'],
    },
    ...over,
  };
}

/** A plain conversational run — the class that must NEVER produce a memory. */
function chatRun(over: Partial<RunOutcomeMemoryInput> = {}): RunOutcomeMemoryInput {
  return {
    nowMs: NOW,
    runId: RUN_UUID,
    surface: 'main_chat',
    mode: 'talk',
    taskKind: null,
    profile: 'openswan_generalist',
    prompt: 'What is the status of the release?',
    response: 'Task completed. Let me know if you need anything else.',
    terminalStatus: 'inconclusive',
    automation: { executionKind: 'run_plain_chat' },
    ...over,
  };
}

function captured(decision: RunOutcomeMemoryDecision, label: string): RunOutcomeMemoryWrite | null {
  if (decision.capture) return decision.memory;
  failures += 1;
  console.error(`FAIL: ${label} :: expected capture, skipped with reason=${decision.reason} (${decision.detail})`);
  return null;
}

function skipReason(decision: RunOutcomeMemoryDecision): string {
  return decision.capture ? '<captured>' : decision.reason;
}

function main(): void {
  // ── 1. a genuine lesson IS captured ───────────────────────────────────────
  const genuine = buildRunOutcomeMemory(computerRun());
  const genuineMem = captured(genuine, '[capture] real Computer-Use lesson');
  if (genuineMem) {
    assertEq(genuineMem.memoryKind, 'finding', '[capture] memoryKind is finding');
    assertEq(genuineMem.lessonKind, 'success', '[capture] verified run is a success lesson');
    assertEq(genuineMem.subjectTier, 'lane', '[capture] app-automation lane wins the subject');
    assert(genuineMem.title.startsWith('Run pattern:'), '[capture] verified success framed as a pattern', genuineMem.title);
    assert(
      genuineMem.title.includes('WordPress admin media upload'),
      '[capture] title names the reusable subject',
      genuineMem.title,
    );
    // The whole point: the transferable facts survive into the row.
    assert(genuineMem.content.includes('#wp-media-grid'), '[capture] the learned selector is persisted');
    assert(genuineMem.content.includes('wp.upload_media'), '[capture] the working adapter is persisted');
    assert(genuineMem.content.includes('Tools in play:'), '[capture] USED tools are labelled as used');
    assert(!genuineMem.content.includes('Routed tools'), '[capture] routed tools suppressed when real tools are known');
    assert(genuineMem.content.includes('Verification: 2 passed'), '[capture] verification counts persisted');
    assert(genuineMem.findingStrength >= 4, '[capture] strong run scores high', String(genuineMem.findingStrength));
    assert(genuineMem.importance > 0.5 && genuineMem.importance < 0.9, '[capture] importance in the precedent band');
  }

  // A referent-free but structurally-proven success still captures (structured
  // facts are the durable backbone; prose is optional).
  const proseFree = buildRunOutcomeMemory(computerRun({
    response: 'I went ahead and handled the upload for you as we discussed earlier today.',
  }));
  assert(proseFree.capture, '[capture] structured proof alone is enough', skipReason(proseFree));
  if (proseFree.capture) {
    assertEq(proseFree.memory.metadata.evidenceSentences, 0, '[capture] narration contributed no evidence');
  }

  // ── 2. noise is NOT captured ──────────────────────────────────────────────
  const generic = buildRunOutcomeMemory(chatRun());
  assert(!generic.capture, '[noise] generic "task completed" chat run is not captured', skipReason(generic));

  // Same generic response, but on a real lane — still refused, because the
  // response carries no transferable fact.
  const genericOnLane = buildRunOutcomeMemory(computerRun({
    response: 'Task completed. Let me know if you need anything else.',
    terminalStatus: 'inconclusive',
    observedEval: null,
  }));
  assert(!genericOnLane.capture, '[noise] generic completion on a real lane is still refused', skipReason(genericOnLane));

  // Prompt restatement: the model parrots the ask back with no new fact.
  const restated = buildRunOutcomeMemory(computerRun({
    prompt: 'Upload the new hero image to the dealership media library using the WordPress admin.',
    response: 'I will upload the new hero image to the dealership media library using the WordPress admin.',
    terminalStatus: 'inconclusive',
    observedEval: null,
  }));
  assert(!restated.capture, '[noise] a prompt restatement is not a lesson', skipReason(restated));
  assertEq(skipReason(restated), 'prompt_restatement', '[noise] restatement gets the honest skip reason');

  // An unproven success must never be written down as "this worked".
  const unproven = buildRunOutcomeMemory(computerRun({
    terminalStatus: 'inconclusive',
    response: 'The upload should be in place now.',
    observedEval: {
      outcome: 'partial',
      verification: { planned: 0, executed: 0, passed: 0, failed: 0, manualRequired: 0, blocked: 0 },
      artifacts: { total: 0, durable: 0, kinds: [] },
      tools: { total: 0, failed: 0, manualRequired: 0, blocked: 0 },
      blockers: [],
    },
  }));
  assert(!unproven.capture, '[noise] inconclusive success without proof is refused', skipReason(unproven));

  // A cancelled run is a statement about the user, not about the world.
  const cancelled = buildRunOutcomeMemory(computerRun({ terminalStatus: 'cancelled' }));
  assertEq(skipReason(cancelled), 'cancelled_run', '[noise] cancelled runs are never captured');

  // No reusable subject → nothing to retrieve the lesson by.
  const noSubject = buildRunOutcomeMemory(chatRun({
    response: 'The /Users/me/project/src/lib/foo.ts module exports a helper that failed with a timeout error.',
    terminalStatus: 'failed',
    errorMessage: 'The request timed out after 30 seconds waiting on the provider.',
    automation: { executionKind: 'run_plain_chat' },
  }));
  assertEq(skipReason(noSubject), 'no_reusable_subject', '[noise] a plain chat run has no subject to file under');

  // A one-off identifier with no reusable frame teaches nothing.
  const oneOff = buildRunOutcomeMemory(computerRun({
    response: '',
    terminalStatus: 'failed',
    errorMessage: '8f14e45f-ceea-467a-9e1f-2b0c2a3d4e5f 993844221100',
    observedEval: null,
  }));
  assert(!oneOff.capture, '[noise] bare identifiers are refused', skipReason(oneOff));

  // Generic failure reasons carry no lesson either.
  const genericFailure = buildRunOutcomeMemory(computerRun({
    response: '',
    terminalStatus: 'failed',
    errorMessage: 'Unknown error',
    terminalReason: 'The agent transport failed before a successful response was returned.',
    observedEval: null,
  }));
  assert(!genericFailure.capture, '[noise] "Unknown error" is not a lesson', skipReason(genericFailure));

  // ── 3. failure lessons, and their framing ─────────────────────────────────
  const adapterGap = buildRunOutcomeMemory(computerRun({
    prompt: 'Export the layered PSD as web assets.',
    response: '',
    terminalStatus: 'failed',
    errorMessage: 'photoshopExtendScript adapter is missing exportLayersToWeb; the Claude bridge returned unsupported_command.',
    observedEval: null,
    automation: {
      executionKind: 'run_computer_task',
      routeId: 'design.psd.export',
      risk: 'high',
      pipelineId: 'photoshop_export',
      pipelineTitle: 'Photoshop export pipeline',
      primarySurface: 'claude_bridge',
    },
  }));
  const adapterMem = captured(adapterGap, '[failure] adapter-gap lesson');
  if (adapterMem) {
    assertEq(adapterMem.lessonKind, 'failure', '[failure] classified as a failure lesson');
    assert(adapterMem.title.startsWith('Run blocker:'), '[failure] framed as a blocker', adapterMem.title);
    assertEq(adapterMem.metadata.namespace, 'agent_private_blocker', '[failure] blocker namespace');
    assert(adapterMem.content.includes('exportLayersToWeb'), '[failure] the missing adapter call is persisted');
    assert(adapterMem.excerpt.includes('exportLayersToWeb'), '[failure] excerpt leads with the reason');
    // Failures outrank successes: not repeating them is the product.
    if (genuineMem) {
      assert(
        adapterMem.importance > genuineMem.importance,
        '[failure] a blocker outranks a success on the same tier',
        `${adapterMem.importance} vs ${genuineMem.importance}`,
      );
    }
  }

  // Failures clear a LOWER strength bar than successes, on purpose.
  const thinFailure = buildRunOutcomeMemory(computerRun({
    response: '',
    terminalStatus: 'failed',
    errorMessage: 'The desktop bridge refused desktop.exec_file: no exact read grant for the requested path.',
    observedEval: null,
  }));
  assert(thinFailure.capture, '[failure] one specific reason is enough for a failure', skipReason(thinFailure));
  const thinSuccess = buildRunOutcomeMemory(computerRun({
    response: 'All set.',
    terminalStatus: 'completed',
    observedEval: {
      outcome: 'partial',
      verification: { planned: 0, executed: 0, passed: 0, failed: 0, manualRequired: 0, blocked: 0 },
      artifacts: { total: 0, durable: 0, kinds: [] },
      tools: { total: 0, failed: 0, manualRequired: 0, blocked: 0 },
      blockers: [],
    },
  }));
  assert(!thinSuccess.capture, '[failure] the same thinness refuses a success', skipReason(thinSuccess));

  // Runtime-reported blockers are first-class failure signal.
  const blockerRun = buildRunOutcomeMemory(computerRun({
    response: '',
    terminalStatus: 'completed',
    observedEval: {
      outcome: 'blocked',
      verification: { planned: 1, executed: 0, passed: 0, failed: 0, manualRequired: 1, blocked: 0 },
      artifacts: { total: 0, durable: 0, kinds: [] },
      tools: { total: 1, failed: 0, manualRequired: 1, blocked: 0 },
      blockers: ['WordPress admin login wall: saved credential for wp-admin is expired'],
    },
  }));
  const blockerMem = captured(blockerRun, '[failure] runtime blocker lesson');
  if (blockerMem) {
    assertEq(blockerMem.lessonKind, 'failure', '[failure] a blocked observedEval is a failure lesson');
    assert(blockerMem.content.includes('login wall'), '[failure] the blocker text is persisted');
  }

  // ── 4. unverified framing (honesty about what we actually know) ───────────
  const unverified = buildRunOutcomeMemory(computerRun({
    terminalStatus: 'inconclusive',
    response: 'I invoked wp.upload_media and the media library at /wp-admin/upload.php now lists the asset.',
  }));
  const unverifiedMem = captured(unverified, '[honesty] proven-enough inconclusive run');
  if (unverifiedMem) {
    assert(
      unverifiedMem.title.startsWith('Run signal (unverified):'),
      '[honesty] inconclusive is never framed as a confirmed pattern',
      unverifiedMem.title,
    );
    assert(
      unverifiedMem.content.includes('NOT verified'),
      '[honesty] the body states the completion was not verified',
    );
    assertEq(unverifiedMem.metadata.verifiedCompletion, false, '[honesty] metadata records the unverified state');
  }

  // ── 5. provenance ─────────────────────────────────────────────────────────
  if (genuineMem) {
    assertEq(genuineMem.sourceRunId, RUN_UUID, '[provenance] source_run_id is the real run id');
    assertEq(genuineMem.sourceSurface, 'main_chat', '[provenance] source_surface is the REAL surface');
    assert(genuineMem.sourceSurface !== 'feed_task', '[provenance] does not inherit saveAgentMemory\'s hard-coded lie');
    assertEq(genuineMem.metadata.source, 'agent_run_outcome', '[provenance] metadata names the capture source');
    assertEq(genuineMem.metadata.version, RUN_OUTCOME_MEMORY_VERSION, '[provenance] versioned');
    assertEq(genuineMem.metadata.routeId, 'wp.media.upload', '[provenance] route id retained for matching');
    assertEq(genuineMem.metadata.pipelineId, 'wp_admin_media', '[provenance] pipeline id retained for matching');
    for (const [key, value] of Object.entries(genuineMem.metadata)) {
      const kind = value === null ? 'null' : typeof value;
      assert(
        ['string', 'number', 'boolean', 'null'].includes(kind),
        `[provenance] metadata.${key} is primitive-only`,
        kind,
      );
    }
  }
  // `memory_entries.source_run_id` is a uuid column — a non-uuid must fail to
  // null, never to junk that would throw inside a fire-and-forget path.
  const badRunId = buildRunOutcomeMemory(computerRun({ runId: 'run_abc123' }));
  if (badRunId.capture) assertEq(badRunId.memory.sourceRunId, null, '[provenance] non-uuid run id degrades to null');
  assertEq(normalizeSourceRunId(RUN_UUID.toUpperCase()), RUN_UUID, '[provenance] uuid normalized to lowercase');
  assertEq(normalizeSourceRunId('not-a-uuid'), null, '[provenance] junk run id rejected');
  assertEq(normalizeSourceRunId(null), null, '[provenance] null run id rejected');
  const surfaceEcho = buildRunOutcomeMemory(computerRun({ surface: 'office_terminal' }));
  if (surfaceEcho.capture) {
    assertEq(surfaceEcho.memory.sourceSurface, 'office_terminal', '[provenance] surface echoed, never invented');
  }

  // ── 6. credential refusal ─────────────────────────────────────────────────
  const leakedInError = buildRunOutcomeMemory(computerRun({
    response: '',
    terminalStatus: 'failed',
    errorMessage: 'Auth rejected for the deploy hook using token ghp_abcdefghijklmnopqrstuvwxyz0123456789.',
    observedEval: null,
  }));
  assertEq(skipReason(leakedInError), 'credential_shaped', '[credential] a token in the failure reason is refused');
  if (!leakedInError.capture) {
    assert(
      !leakedInError.detail.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'),
      '[credential] the refusal detail never contains the value',
      leakedInError.detail,
    );
    assert(leakedInError.detail.includes('rule='), '[credential] the refusal names the stable rule id');
  }

  // A credential inside model prose poisons only that sentence — the
  // structured lesson still survives.
  const leakedInProse = buildRunOutcomeMemory(computerRun({
    response: 'I authenticated with sk-abcdefghijklmnop0123456789 against the media endpoint and it worked.',
  }));
  if (leakedInProse.capture) {
    assert(
      !leakedInProse.memory.content.includes('sk-abcdefghijklmnop0123456789'),
      '[credential] the poisoned sentence is dropped, not persisted',
    );
    assertEq(leakedInProse.memory.metadata.evidenceSentences, 0, '[credential] no evidence sentence survived');
  } else {
    assertEq(skipReason(leakedInProse), 'credential_shaped', '[credential] otherwise refused outright');
  }

  const jwtLeak = buildRunOutcomeMemory(computerRun({
    response: '',
    terminalStatus: 'failed',
    errorMessage: 'Session refused: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    observedEval: null,
  }));
  assertEq(skipReason(jwtLeak), 'credential_shaped', '[credential] a JWT is refused');

  // ── 7. bounds / truncation ────────────────────────────────────────────────
  const huge = buildRunOutcomeMemory(computerRun({
    prompt: 'Upload the hero image. '.repeat(400),
    response: [
      `The ${'very '.repeat(60)}long adapter note explains that desktop.observe_app must run before wp.upload_media.`,
      `A second ${'padded '.repeat(60)}sentence names the selector #wp-media-grid and the path /wp-admin/upload.php.`,
      'A third referent-bearing sentence about the browserbase fallback session and its timeout error.',
    ].join(' '),
    automation: {
      executionKind: 'run_computer_task',
      routeId: 'r'.repeat(500),
      pipelineTitle: 'W'.repeat(400),
      primarySurface: 's'.repeat(300),
      recommendedTools: Array.from({ length: 40 }, (_, i) => `tool.name_${i}_${'x'.repeat(80)}`),
    },
  }));
  const hugeMem = captured(huge, '[bounds] oversized input still captures');
  if (hugeMem) {
    assert(hugeMem.title.length <= MAX_TITLE_CHARS, '[bounds] title clamped', String(hugeMem.title.length));
    assert(hugeMem.content.length <= MAX_CONTENT_CHARS, '[bounds] content clamped', String(hugeMem.content.length));
    assert(hugeMem.excerpt.length <= MAX_EXCERPT_CHARS, '[bounds] excerpt clamped', String(hugeMem.excerpt.length));
    // The raw prompt must never be persisted wholesale — a ~9,200-char prompt
    // has to survive only as a bounded pointer.
    assert(
      hugeMem.content.length < 'Upload the hero image. '.repeat(400).length / 5,
      '[bounds] the raw prompt is not persisted wholesale',
      String(hugeMem.content.length),
    );
    const attempted = hugeMem.content.split('\n').find((line) => line.startsWith('Attempted:')) || '';
    assert(attempted.length <= MAX_INTENT_CHARS + 12, '[bounds] intent line stays a pointer, not a copy', String(attempted.length));
    const evidenceLines = hugeMem.content.split('\n').filter((line) => line.startsWith('Evidence:'));
    assert(evidenceLines.length <= MAX_EVIDENCE_SENTENCES, '[bounds] evidence sentence cap honored');
    for (const line of evidenceLines) {
      assert(line.length <= MAX_EVIDENCE_SENTENCE_CHARS + 12, '[bounds] each evidence sentence clamped', String(line.length));
    }
    // The frame must never squeeze the finding out of the row.
    assert(
      hugeMem.content.split('\n').some((line) => line.startsWith('Outcome:') || line.startsWith('Failure:')),
      '[bounds] the outcome line survives a verbose frame',
    );
  }

  assertEq(clampText('abcdefghij', 5).length <= 5, true, '[bounds] clampText respects the limit');
  assertEq(clampText('', 100), '', '[bounds] clampText("") → ""');
  assertEq(clampText('a  b\n c', 100), 'a b c', '[bounds] clampText collapses whitespace');
  assert(clampText('x'.repeat(50_000), 40).length <= 40, '[bounds] clampText survives huge input');
  assertEq(clampBlock(['one', 'two'], 100), 'one\ntwo', '[bounds] clampBlock preserves newlines');
  assert(clampBlock(['a'.repeat(300), 'b'.repeat(300)], 100).length <= 100, '[bounds] clampBlock respects the limit');
  assertEq(clampBlock([], 100), '', '[bounds] clampBlock([]) → ""');
  assertEq(clampBlock(null as unknown as string[], 100), '', '[bounds] clampBlock(null) → ""');

  // ── 8. subject tiers ──────────────────────────────────────────────────────
  const laneSubject = resolveRunOutcomeSubject(computerRun());
  assertEq(laneSubject?.tier, 'lane', '[subject] lane beats route and profile');
  const routeSubject = resolveRunOutcomeSubject(computerRun({
    automation: { executionKind: 'run_browser_plan', routeId: 'browser.checkout.flow' },
  }));
  assertEq(routeSubject?.tier, 'route', '[subject] acting execution kind is a route subject');
  const profileSubject = resolveRunOutcomeSubject(computerRun({ automation: null }));
  assertEq(profileSubject?.tier, 'profile', '[subject] falls back to task kind + profile');
  assertEq(resolveRunOutcomeSubject(chatRun()), null, '[subject] a plain chat run has none');
  assertEq(
    resolveRunOutcomeSubject(computerRun({ automation: { executionKind: 'ask_clarification' }, taskKind: 'research' })),
    null,
    '[subject] non-acting kinds + broad task kinds resolve to no subject',
  );
  assertEq(resolveRunOutcomeSubject(null), null, '[subject] null input → null');
  assertEq(resolveRunOutcomeSubject(undefined), null, '[subject] undefined input → null');

  // The weak `profile` tier must cost an extra point, or it would swamp
  // retrieval with broadly-matching rows.
  const profileTierThin = buildRunOutcomeMemory(computerRun({
    automation: null,
    response: '',
    terminalStatus: 'failed',
    errorMessage: 'The desktop bridge refused desktop.exec_file: no exact read grant for the requested path.',
    observedEval: null,
  }));
  assert(!profileTierThin.capture, '[subject] the profile tier needs more than one signal', skipReason(profileTierThin));

  // ── 9. evidence extraction ────────────────────────────────────────────────
  const ev = extractEvidenceSentences(
    [
      'Sure, happy to help with that request today.',
      'The wp.upload_media tool needs desktop.observe_app to run first or it returns a stale epoch error.',
      'Upload the new hero image to the dealership media library.',
      'Ok.',
    ].join(' '),
    'Upload the new hero image to the dealership media library.',
  );
  assertEq(ev.kept.length, 1, '[evidence] exactly the referent-bearing sentence is kept');
  assert(ev.kept[0]?.includes('wp.upload_media'), '[evidence] the kept sentence is the useful one');
  assert(ev.rejections.some((r) => r.rejected === 'generic'), '[evidence] the greeting is rejected as generic');
  assert(ev.rejections.some((r) => r.rejected === 'echo'), '[evidence] the prompt echo is rejected');
  assertEq(extractEvidenceSentences('', '').kept.length, 0, '[evidence] empty response → nothing');
  assertEq(extractEvidenceSentences(null, null).kept.length, 0, '[evidence] null input → nothing');
  assert(
    extractEvidenceSentences('```\nconst secret = "x";\n```', '').kept.length === 0,
    '[evidence] fenced code blocks are stripped, not persisted',
  );

  // ── 10. predicate units ───────────────────────────────────────────────────
  assert(isGenericCompletionText('Task completed.'), '[predicate] "Task completed." is generic');
  assert(isGenericCompletionText('All set!'), '[predicate] "All set!" is generic');
  assert(isGenericCompletionText("Here's the summary you asked for"), '[predicate] "Here\'s the…" is generic');
  assert(isGenericCompletionText(''), '[predicate] empty is generic');
  assert(!isGenericCompletionText('The wp.upload_media adapter needs a fresh observation epoch.'), '[predicate] a real lesson is not generic');
  assert(hasConcreteReferent('call desktop.observe_app first'), '[predicate] tool ids are referents');
  assert(hasConcreteReferent('the file /Users/me/app/src/lib/x.ts changed'), '[predicate] paths are referents');
  assert(hasConcreteReferent('the selector #wp-media-grid'), '[predicate] selectors are referents');
  assert(hasConcreteReferent('Photoshop refused the script'), '[predicate] app names are referents');
  assert(hasConcreteReferent('the request timed out'), '[predicate] failure vocabulary is a referent');
  assert(!hasConcreteReferent('I finished thinking about your idea'), '[predicate] narration has no referent');
  assert(!hasConcreteReferent(''), '[predicate] empty has no referent');
  assert(isOneOffValueOnly('3f1c2b7a-9d4e-4a12-8b55-0c6d7e8f9a10'), '[predicate] a bare uuid is one-off only');
  assert(isOneOffValueOnly(''), '[predicate] empty is one-off only');
  assert(
    !isOneOffValueOnly('Failure: wp.upload_media rejected the payload because the observation epoch was stale.'),
    '[predicate] a framed lesson is not one-off only',
  );
  assertEq(tokenContainment('alpha beta gamma', 'alpha beta gamma delta'), 1, '[predicate] full containment → 1');
  assertEq(tokenContainment('alpha beta', 'zeta theta'), 0, '[predicate] disjoint → 0');
  assertEq(tokenContainment('', 'anything'), 0, '[predicate] empty subject → 0');
  assertEq(tokenContainment('anything', ''), 0, '[predicate] empty reference → 0');
  assertEq(significantTokens('the and for a').size, 0, '[predicate] stop words carry no signal');
  assertEq(splitSentences('One. Two.\nThree').length, 3, '[predicate] sentences split on punctuation and newlines');
  assertEq(splitSentences(null).length, 0, '[predicate] splitSentences(null) → []');

  // ── 11. determinism + fingerprint identity ────────────────────────────────
  const a = buildRunOutcomeMemory(computerRun());
  const b = buildRunOutcomeMemory(computerRun());
  assertEq(JSON.stringify(a), JSON.stringify(b), '[determinism] identical input → identical decision');
  // The fingerprint must ignore the clock and the run id, so a repeat of the
  // SAME lesson collides and the caller can skip the duplicate write.
  const later = buildRunOutcomeMemory(computerRun({ nowMs: NOW + 86_400_000, runId: '00000000-0000-4000-8000-000000000001' }));
  if (a.capture && later.capture) {
    assertEq(a.memory.fingerprint, later.memory.fingerprint, '[determinism] same lesson, later run → same fingerprint');
    assert(a.memory.content !== later.memory.content, '[determinism] but the observed date still differs');
  }
  const different = buildRunOutcomeMemory(computerRun({
    response: 'The illustrator.export_svg adapter requires an open document before it will accept an artboard index.',
  }));
  if (a.capture && different.capture) {
    assert(a.memory.fingerprint !== different.memory.fingerprint, '[determinism] a different lesson → different fingerprint');
  }
  assertEq(stableHash('abc'), stableHash('abc'), '[determinism] stableHash is stable');
  assert(stableHash('abc') !== stableHash('abd'), '[determinism] stableHash discriminates');
  assertEq(stableHash(null), stableHash(''), '[determinism] stableHash(null) === stableHash("")');

  // ── 12. degenerate input (total, never throws) ────────────────────────────
  try {
    assertEq(skipReason(buildRunOutcomeMemory(null)), 'degenerate_input', '[hostile] null → degenerate_input');
    assertEq(skipReason(buildRunOutcomeMemory(undefined)), 'degenerate_input', '[hostile] undefined → degenerate_input');
    assert(!buildRunOutcomeMemory({} as RunOutcomeMemoryInput).capture, '[hostile] {} → no capture');
    assert(
      !buildRunOutcomeMemory({ nowMs: NaN } as RunOutcomeMemoryInput).capture,
      '[hostile] NaN clock → no capture',
    );
    const hostile = buildRunOutcomeMemory({
      nowMs: Number.POSITIVE_INFINITY,
      runId: 123 as unknown as string,
      surface: {} as unknown as string,
      prompt: [] as unknown as string,
      response: { toString: () => 'x' } as unknown as string,
      terminalStatus: 42 as unknown as string,
      observedEval: 'nope' as unknown as never,
      artifacts: 'nope' as unknown as never,
      automation: 'nope' as unknown as never,
      toolNames: 7 as unknown as never,
    });
    assert(!hostile.capture, '[hostile] wrong-typed everything → no capture', skipReason(hostile));
    // Infinite clock must not smuggle an invalid date into the content.
    const infiniteClock = buildRunOutcomeMemory(computerRun({ nowMs: Number.POSITIVE_INFINITY }));
    if (infiniteClock.capture) {
      assert(!infiniteClock.memory.content.includes('Invalid'), '[hostile] non-finite clock emits no bogus date');
    }
    assert(
      !buildRunOutcomeMemory(computerRun({ response: 'x'.repeat(500_000), prompt: 'y'.repeat(500_000) })).capture
      || true,
      '[hostile] 500k-char prompt/response does not throw',
    );
    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: [HOSTILE] sweep threw: ${(e as Error)?.message}`);
  }

  // ── 13. LOCKSTEP with the shared quality bar ──────────────────────────────
  // `memoryConsolidation.isHighQualityMemory` is the ONE standard for what a
  // memory may be, and `agentRuntime.captureRunOutcomeMemory` applies the real
  // function as its final gate. It cannot be imported here (it pulls supabase →
  // react-native, which tsx cannot load), so its contract is asserted against
  // the source text. If it drifts, capture would silently go dark — this fails
  // loudly instead.
  const consolidationSource = readFileSync(
    path.resolve(__dirname, '../src/lib/memoryConsolidation.ts'),
    'utf8',
  );
  assert(
    consolidationSource.includes(`if (candidate.content.length < ${HIGH_QUALITY_BAR_MIN_CONTENT_CHARS}) return false;`),
    '[lockstep] the shared bar still rejects below HIGH_QUALITY_BAR_MIN_CONTENT_CHARS',
  );
  assert(
    consolidationSource.includes("['fact', 'finding'].includes(candidate.kind)) qualityScore += 1"),
    "[lockstep] the shared bar still scores 'finding' at +1",
  );
  assert(
    consolidationSource.includes('return qualityScore >= 1;'),
    '[lockstep] the shared bar still passes at qualityScore >= 1',
  );
  assert(
    MIN_LESSON_CHARS > HIGH_QUALITY_BAR_MIN_CONTENT_CHARS,
    '[lockstep] this core is strictly stricter than the shared length floor',
  );
  assertEq(RUN_OUTCOME_MEMORY_KIND, 'finding', "[lockstep] the emitted kind is the one the shared bar scores");
  // Therefore every captured memory clears the shared bar by construction.
  for (const [label, decision] of [
    ['genuine', genuine],
    ['adapter gap', adapterGap],
    ['blocker', blockerRun],
    ['unverified', unverified],
    ['huge', huge],
  ] as const) {
    if (!decision.capture) continue;
    assertEq(decision.memory.memoryKind, 'finding', `[lockstep] ${label} emits the scored kind`);
    assert(
      decision.memory.content.length >= HIGH_QUALITY_BAR_MIN_CONTENT_CHARS,
      `[lockstep] ${label} clears the shared length floor`,
      String(decision.memory.content.length),
    );
    assert(decision.memory.title.trim().length > 0, `[lockstep] ${label} has a non-empty title`);
  }

  // ── 14. threshold sanity (documented invariants) ──────────────────────────
  assert(MIN_LESSON_CHARS > MIN_EVIDENCE_SENTENCE_CHARS - 1, '[bounds] lesson floor is at least a sentence');
  assert(MAX_LESSON_BODY_CHARS < MAX_CONTENT_CHARS, '[bounds] lesson budget reserved inside the content budget');
  assert(MAX_EXCERPT_CHARS < MAX_CONTENT_CHARS, '[bounds] excerpt is a pointer, not a copy');
  assert(MAX_INTENT_CHARS < MAX_LESSON_BODY_CHARS, '[bounds] the prompt anchor cannot dominate the lesson');
  assert(
    PROMPT_RESTATEMENT_MAX_OVERLAP > 0.5 && PROMPT_RESTATEMENT_MAX_OVERLAP < 1,
    '[bounds] restatement threshold is a real fraction',
  );
  assert(MIN_REUSABLE_TOKENS >= 2, '[bounds] a lesson needs more than one reusable token');
  assert(MAX_EVIDENCE_SENTENCES >= 1 && MAX_EVIDENCE_SENTENCES <= 4, '[bounds] evidence cap stays small');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll run-outcome-memory-core smoke cases passed (${passes} passed).`);
}

main();
