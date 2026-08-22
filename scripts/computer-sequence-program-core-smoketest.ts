/**
 * computer-sequence-program-core-smoketest — pins the deterministic tool
 * program compiler: the exact user phrasings that must compile, the edit/
 * ambiguous phrasings that must NOT, and the program contents (tool names,
 * exact args, forbidden-tool rules) the agent loop depends on.
 *
 * Run: npm run smoke:computer-sequence-program-core
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { buildComputerAppToolArgsFingerprintAsync } from '../src/lib/computerAppGrounding';
import {
  buildComputerSequenceActionIdempotencyKey,
  buildPhotoshopNewDocumentRootProjectionDraft,
  buildComputerSequenceProgramManifest,
  compileComputerSequenceProgram,
  projectPhotoshopNewDocumentMutations,
} from '../src/lib/computerSequenceProgramCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed += 1; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}

const testFingerprint = async (value: unknown): Promise<string> => (
  `args-v2:sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
);

function cloneProgram<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ── Observed-state mutation projection (feature-off, pure) ────────────────
{
  const program = compileComputerSequenceProgram('Open Photoshop and start a new project 600 x 600');
  assert(Boolean(program), 'projection fixture compiles');
  if (program) {
    const stopped = projectPhotoshopNewDocumentMutations(program, {
      appRunning: false,
      appFrontmost: false,
    });
    const background = projectPhotoshopNewDocumentMutations(program, {
      appRunning: true,
      appFrontmost: false,
    });
    const foreground = projectPhotoshopNewDocumentMutations(program, {
      appRunning: true,
      appFrontmost: true,
    });
    assert(
      stopped?.mutations.map((mutation) => mutation.tool).join(' → ')
        === 'desktop.launch_app → desktop.photoshop_create_document',
      'stopped app projects launch then create',
    );
    assert(
      background?.mutations.map((mutation) => mutation.tool).join(' → ')
        === 'desktop.focus_app → desktop.photoshop_create_document',
      'running background app projects focus then create',
    );
    assert(
      foreground?.mutations.map((mutation) => mutation.tool).join(' → ')
        === 'desktop.photoshop_create_document',
      'running frontmost app projects create only',
    );
    for (const [label, projection] of [
      ['stopped', stopped],
      ['background', background],
      ['foreground', foreground],
    ] as const) {
      const tools = projection?.mutations.map((mutation) => mutation.tool) || [];
      assert(
        !(tools.includes('desktop.launch_app') && tools.includes('desktop.focus_app')),
        `${label} branch never projects launch and focus together`,
      );
      assert(
        projection?.mutations.every((mutation, index) => (
          mutation.index === index
          && mutation.projectionOnly === true
          && mutation.mutatesState === true
          && mutation.requiresForegroundLease === true
          && mutation.source === 'compiler'
          && mutation.authorizationCategory === 'direct_request'
          && mutation.requiredMutationAuthority === 'action_ledger'
          && mutation.verifierPredicateRole.startsWith('photoshop_')
        )) === true,
        `${label} branch carries the root-binding metadata without fingerprints`,
      );
      assert(
        projection?.mutations.every((mutation) => !Object.keys(mutation).some((key) => /fingerprint|digest|authorityFingerprint/i.test(key))) === true,
        `${label} branch does not fabricate a digest or authority fingerprint`,
      );
      assert(
        projection?.projectionOnly === true
          && projection.mutations.every((mutation) => mutation.tool !== 'desktop.photoshop_document_status')
          && projection.predicates.some((predicate) => predicate.tool === 'desktop.observe_app')
          && projection.predicates.some((predicate) => predicate.tool === 'desktop.photoshop_document_status'),
        `${label} branch keeps app and document observations as inert predicates`,
      );
      assert(
        projection?.mutations.every((mutation) => !Object.prototype.hasOwnProperty.call(mutation, 'mutationAuthority')) === true,
        `${label} branch declares required authority without pretending it already holds authority`,
      );
    }
    assert(
      JSON.stringify(stopped?.mutations[0]?.args) === JSON.stringify({ appName: 'Photoshop' })
        && JSON.stringify(stopped?.mutations[1]?.args) === JSON.stringify({ widthPx: 600, heightPx: 600 }),
      'stopped projection carries exact launch and create args',
    );
    assert(
      stopped?.mutations[0]?.verifierPredicateRole === 'photoshop_app_running'
        && stopped.mutations[1]?.requiresForegroundLease === true
        && stopped.mutations.every((mutation) => mutation.tool !== 'desktop.focus_app')
        && stopped.predicates.some((predicate) => (
          predicate.role === 'photoshop_launch_identity_verified'
          && predicate.actionIndex === 0
          && predicate.tool === 'desktop.observe_app'
          && predicate.requirements.includes('positive_pid_when_running')
        )),
      'stopped projection proves launch readiness then lease-gates create without inventing focus',
    );
    assert(
      JSON.stringify(background?.mutations[0]?.args) === JSON.stringify({ appName: 'Photoshop' })
        && JSON.stringify(background?.mutations[1]?.args) === JSON.stringify({ widthPx: 600, heightPx: 600 }),
      'background projection carries exact focus and create args',
    );
    assert(
      background?.predicates.some((predicate) => (
        predicate.role === 'photoshop_focus_identity_verified'
        && predicate.actionIndex === 0
        && predicate.tool === 'desktop.observe_app'
        && predicate.requirements.includes('same_pid_as_prior_app_receipt')
        && predicate.requirements.includes('frontmost')
      )) === true,
      'background projection verifies focus against the same fresh Photoshop PID',
    );
    assert(
      foreground?.predicates.some((predicate) => (
        predicate.role === 'photoshop_app_identity_observed'
        && predicate.tool === 'desktop.observe_app'
        && predicate.expected.frontmost === true
      )) === true,
      'foreground branch truth is assigned to desktop.observe_app rather than Photoshop status',
    );
    const foregroundCreateProof = foreground?.predicates.find(
      (predicate) => predicate.role === 'photoshop_created_document_receipt_verified',
    );
    assert(
      foregroundCreateProof?.tool === 'desktop.photoshop_document_status'
        && foregroundCreateProof.expected.widthPx === 600
        && foregroundCreateProof.expected.heightPx === 600
        && foregroundCreateProof.requirements.includes('create_receipt_created_true')
        && foregroundCreateProof.requirements.includes('document_count_increased_from_baseline')
        && foregroundCreateProof.requirements.includes('active_document_name_matches_create_receipt'),
      'create proof binds receipt identity, document-count delta, active name, and exact dimensions',
    );
    assert(
      foreground?.predicates.some((predicate) => (
        predicate.role === 'photoshop_document_baseline_observed'
        && predicate.requirements.includes('capture_baseline_document_count')
        && predicate.requirements.includes('capture_baseline_active_document_identity')
      )) === true,
      'create proof has a fresh document-count and active-identity baseline',
    );
    assert(
      foreground?.predicates.some((predicate) => (
        predicate.role === 'photoshop_create_foreground_precondition_verified'
        && predicate.stage === 'verify_before_action'
        && predicate.tool === 'desktop.observe_app'
        && predicate.requirements.includes('same_pid_as_prior_app_receipt')
        && predicate.requirements.includes('frontmost')
      )) === true,
      'create requires a fresh same-PID foreground observation before mutation',
    );

    assert(
      projectPhotoshopNewDocumentMutations(program, {
        appRunning: false,
        appFrontmost: true,
      }) === null,
      'stopped plus frontmost observation is rejected',
    );
    assert(
      projectPhotoshopNewDocumentMutations(program, {
        appRunning: true,
        appFrontmost: false,
        unexpected: true,
      } as any) === null,
      'extra observation fields are rejected',
    );
    assert(
      projectPhotoshopNewDocumentMutations(program, {
        appRunning: 1,
        appFrontmost: false,
      } as any) === null,
      'non-boolean observation fields are rejected',
    );
    let programAccessorReads = 0;
    const accessorProgram = cloneProgram(program);
    Object.defineProperty(accessorProgram, 'title', {
      enumerable: true,
      configurable: true,
      get() {
        programAccessorReads += 1;
        return program.title;
      },
    });
    assert(
      projectPhotoshopNewDocumentMutations(accessorProgram, {
        appRunning: true,
        appFrontmost: true,
      }) === null && programAccessorReads === 0,
      'accessor-backed program fields are rejected without invoking the getter',
    );
    let observationAccessorReads = 0;
    const accessorObservation = Object.defineProperties({}, {
      appRunning: {
        enumerable: true,
        get() {
          observationAccessorReads += 1;
          return true;
        },
      },
      appFrontmost: { enumerable: true, value: true },
    });
    assert(
      projectPhotoshopNewDocumentMutations(program, accessorObservation as any) === null
        && observationAccessorReads === 0,
      'accessor-backed observations are rejected without invoking the getter',
    );

    const extraStep = cloneProgram(program);
    extraStep.steps.push(cloneProgram(extraStep.steps[0]));
    assert(
      projectPhotoshopNewDocumentMutations(extraStep, { appRunning: true, appFrontmost: true }) === null,
      'extra program step is rejected',
    );
    const reordered = cloneProgram(program);
    [reordered.steps[0], reordered.steps[1]] = [reordered.steps[1], reordered.steps[0]];
    assert(
      projectPhotoshopNewDocumentMutations(reordered, { appRunning: true, appFrontmost: true }) === null,
      'reordered program steps are rejected',
    );
    const driftedArgs = cloneProgram(program);
    driftedArgs.steps[3].args.widthPx = 601;
    assert(
      projectPhotoshopNewDocumentMutations(driftedArgs, { appRunning: true, appFrontmost: true }) === null,
      'create dimensions drifting from the canonical program are rejected',
    );
    const extraArgs = cloneProgram(program);
    extraArgs.steps[3].args.colorMode = 'RGB';
    assert(
      projectPhotoshopNewDocumentMutations(extraArgs, { appRunning: true, appFrontmost: true }) === null,
      'extra create args are rejected',
    );
    const driftedNote = cloneProgram(program);
    driftedNote.steps[1].note = 'launch somehow';
    assert(
      projectPhotoshopNewDocumentMutations(driftedNote, { appRunning: true, appFrontmost: true }) === null,
      'drifted static program metadata is rejected',
    );
    const extraProgramField = cloneProgram(program) as typeof program & { unexpected?: boolean };
    extraProgramField.unexpected = true;
    assert(
      projectPhotoshopNewDocumentMutations(extraProgramField, { appRunning: true, appFrontmost: true }) === null,
      'extra program fields are rejected',
    );

    assert(
      Boolean(foreground)
        && Object.isFrozen(foreground)
        && Object.isFrozen(foreground.mutations)
        && Object.isFrozen(foreground.mutations[0])
        && Object.isFrozen(foreground.mutations[0].args)
        && Object.isFrozen(foreground.predicates)
        && foreground.predicates.every((predicate) => (
          Object.isFrozen(predicate)
          && Object.isFrozen(predicate.args)
          && Object.isFrozen(predicate.expected)
          && Object.isFrozen(predicate.requirements)
        )),
      'projection is deeply frozen at every mutable collection boundary',
    );
    if (foreground) {
      program.steps[3].args.widthPx = 777;
      assert(
        foreground.requestedDimensions.widthPx === 600
          && foreground.mutations[0].args.widthPx === 600
          && foregroundCreateProof?.expected.widthPx === 600,
        'projection does not alias the caller-owned program',
      );
      try {
        (foreground.mutations[0].args as { widthPx?: number }).widthPx = 999;
      } catch { /* strict runtimes throw; non-strict runtimes ignore the write */ }
      assert(
        foreground.mutations[0].args.widthPx === 600,
        'frozen projected args cannot be changed by the caller',
      );
    }
  }

  const approved = compileComputerSequenceProgram('open photoshop and create a new document 30000 x 30000');
  const approvedProjection = approved
    ? projectPhotoshopNewDocumentMutations(approved, { appRunning: true, appFrontmost: true })
    : null;
  assert(
    approvedProjection?.mutations[0]?.authorizationCategory === 'plan_approval',
    'resource-heavy canonical program projects plan-approval authorization',
  );
  assert(
    approvedProjection?.requestedDimensions.widthPx === 30000
      && approvedProjection.requestedDimensions.heightPx === 30000,
    'projection accepts the exact maximum canonical dimensions',
  );
  if (approved) {
    const oversized = cloneProgram(approved);
    oversized.steps[3].args.widthPx = 30001;
    assert(
      projectPhotoshopNewDocumentMutations(oversized, { appRunning: true, appFrontmost: true }) === null,
      'projection independently rejects dimensions above the bridge bound',
    );
  }
}

// ── Dispatch manifest binding ──────────────────────────────────────────────
{
  const sixHundred = compileComputerSequenceProgram('open photoshop and create a new document 600 x 600');
  const sixOhOne = compileComputerSequenceProgram('open photoshop and create a new document 601 x 600');
  assert(Boolean(sixHundred && sixOhOne), 'manifest fixtures compile');
  if (sixHundred && sixOhOne) {
    const manifest600 = buildComputerSequenceProgramManifest(sixHundred);
    const manifest601 = buildComputerSequenceProgramManifest(sixOhOne);
    assert(
      JSON.stringify(manifest600) !== JSON.stringify(manifest601),
      'different requested dimensions produce different executable manifests',
    );
    assert(
      (manifest600.steps[3]?.args as { widthPx?: number; heightPx?: number }).widthPx === 600
        && (manifest600.steps[3]?.args as { widthPx?: number; heightPx?: number }).heightPx === 600,
      'manifest binds the exact create arguments',
    );
    assert(!JSON.stringify(manifest600).includes('note'), 'manifest excludes mutable display notes');
  }
}

// ── Request-stable cross-root no-replay key ────────────────────────────────
const idempotencyChecks = (async () => {
  const program600 = compileComputerSequenceProgram('open photoshop and create a new document 600 x 600');
  const program601 = compileComputerSequenceProgram('open photoshop and create a new document 601 x 600');
  assert(Boolean(program600 && program601), 'idempotency fixtures compile');
  if (program600 && program601) {
    const program600Fingerprint = await testFingerprint(buildComputerSequenceProgramManifest(program600));
    const program601Fingerprint = await testFingerprint(buildComputerSequenceProgramManifest(program601));
    const requestA = `args-v2:sha256:${'a'.repeat(64)}`;
    const requestB = `args-v2:sha256:${'b'.repeat(64)}`;
    const first = await buildComputerSequenceActionIdempotencyKey({
      program: program600,
      programFingerprint: program600Fingerprint,
      requestIdentityFingerprint: requestA,
      fingerprint: testFingerprint,
    });
    const crashResume = await buildComputerSequenceActionIdempotencyKey({
      program: program600,
      programFingerprint: program600Fingerprint,
      requestIdentityFingerprint: requestA,
      fingerprint: testFingerprint,
    });
    const newRequest = await buildComputerSequenceActionIdempotencyKey({
      program: program600,
      programFingerprint: program600Fingerprint,
      requestIdentityFingerprint: requestB,
      fingerprint: testFingerprint,
    });
    const changedProgram = await buildComputerSequenceActionIdempotencyKey({
      program: program601,
      programFingerprint: program601Fingerprint,
      requestIdentityFingerprint: requestA,
      fingerprint: testFingerprint,
    });
    assert(
      /^exact\.[0-9a-f]{64}\.photoshop_create_document\.1$/.test(first),
      'stable action key is bounded for the §26 database identity',
    );
    assert(first === crashResume, 'crash/resume derives the same key without a wrapper run id');
    assert(first !== newRequest, 'a new explicit Chat message receives a different action key');
    assert(first !== changedProgram, 'different exact program arguments receive a different action key');
  }
})();

// ── Universal-root projection draft (feature off; no execution) ───────────
const rootProjectionDraftChecks = (async () => {
  const direct = compileComputerSequenceProgram(
    'open photoshop and create a new document 600 x 600',
  );
  const changedDimensions = compileComputerSequenceProgram(
    'open photoshop and create a new document 601 x 600',
  );
  const approvalRequired = compileComputerSequenceProgram(
    'open photoshop and create a new document 4097 x 4096',
  );
  assert(
    Boolean(direct && changedDimensions && approvalRequired),
    'root projection fixtures compile canonically',
  );
  if (!direct || !changedDimensions || !approvalRequired) return;

  const rootFingerprint = buildComputerAppToolArgsFingerprintAsync;
  const directProgramFingerprint = await rootFingerprint(
    buildComputerSequenceProgramManifest(direct),
  );
  const changedProgramFingerprint = await rootFingerprint(
    buildComputerSequenceProgramManifest(changedDimensions),
  );
  const approvalProgramFingerprint = await rootFingerprint(
    buildComputerSequenceProgramManifest(approvalRequired),
  );
  const requestA = `args-v2:sha256:${'1'.repeat(64)}`;
  const requestB = `args-v2:sha256:${'2'.repeat(64)}`;
  const states = {
    stopped: { appRunning: false, appFrontmost: false },
    background: { appRunning: true, appFrontmost: false },
    frontmost: { appRunning: true, appFrontmost: true },
  } as const;

  const directProjections = Object.fromEntries(
    Object.entries(states).map(([branch, state]) => [
      branch,
      projectPhotoshopNewDocumentMutations(direct, state),
    ]),
  ) as Record<keyof typeof states, ReturnType<typeof projectPhotoshopNewDocumentMutations>>;
  const drafts = await Promise.all(
    (Object.keys(states) as Array<keyof typeof states>).map(async (branch) => {
      const projection = directProjections[branch];
      return projection
        ? buildPhotoshopNewDocumentRootProjectionDraft({
            program: direct,
            projection,
            requestIdentityFingerprint: requestA,
            programFingerprint: directProgramFingerprint,
            fingerprint: rootFingerprint,
          })
        : null;
    }),
  );
  const [stoppedDraft, backgroundDraft, frontmostDraft] = drafts;
  const expectedAppToolArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync({
    appName: 'Photoshop',
  });
  const expectedCreateToolArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync({
    appName: 'Photoshop',
    widthPx: 600,
    heightPx: 600,
  });
  assert(
    stoppedDraft?.projectionBranch === 'app_stopped'
      && backgroundDraft?.projectionBranch === 'app_background'
      && frontmostDraft?.projectionBranch === 'app_frontmost',
    'observed booleans select three explicit projection branches',
  );
  assert(
    Boolean(expectedAppToolArgsFingerprint && expectedCreateToolArgsFingerprint)
      && stoppedDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
        === expectedAppToolArgsFingerprint
      && stoppedDraft.acceptanceRequirements.actionRequirements[1]?.toolArgsFingerprint
        === expectedCreateToolArgsFingerprint
      && backgroundDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
        === expectedAppToolArgsFingerprint
      && backgroundDraft.acceptanceRequirements.actionRequirements[1]?.toolArgsFingerprint
        === expectedCreateToolArgsFingerprint
      && frontmostDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
        === expectedCreateToolArgsFingerprint,
    'tool args hashes equal the real gateway SHA of canonical normalized handler args alone',
  );
  assert(
    stoppedDraft?.acceptanceRequirements.actionRequirements.map((action) => action.tool).join(' → ')
      === 'desktop.launch_app → desktop.photoshop_create_document'
      && backgroundDraft?.acceptanceRequirements.actionRequirements.map((action) => action.tool).join(' → ')
        === 'desktop.focus_app → desktop.photoshop_create_document'
      && frontmostDraft?.acceptanceRequirements.actionRequirements.map((action) => action.tool).join(' → ')
        === 'desktop.photoshop_create_document',
    'root requirements preserve the exact stopped, background, and frontmost mutation order',
  );
  for (const [label, draft, projection] of [
    ['stopped', stoppedDraft, directProjections.stopped],
    ['background', backgroundDraft, directProjections.background],
    ['frontmost', frontmostDraft, directProjections.frontmost],
  ] as const) {
    assert(
      Boolean(draft)
        && draft?.projectionOnly === true
        && draft.readyForRootBinding === false
        && draft.requiredDispatchRequirements.length
          === draft.acceptanceRequirements.actionRequirements.length
        && draft.requiredDispatchRequirements.every((requirement, index) => (
          requirement.projectionOnly === true
          && requirement.readyForDispatchBinding === false
          && requirement.bindingStatus === 'required'
          && requirement.actionIndex === index
          && requirement.source === 'compiler'
          && requirement.requiredMutationAuthority === 'action_ledger'
          && requirement.authorizationCategory === 'direct_request'
          && requirement.authorizationReceiptStatus === 'required'
          && requirement.proofReceiptStatus === 'required'
        )),
      `${label} emits only unsatisfied compiler dispatch requirements`,
    );
    assert(
      draft?.acceptanceRequirements.actionRequirements.every((action) => (
        Object.keys(action).join(',')
          === 'actionIndex,tool,toolArgsFingerprint,authorizationRequirementFingerprint,authorizationReceiptStatus,proofReceiptStatus,mutatesState,requiresForegroundLease'
      )) === true,
      `${label} action requirements cannot be passed as strict root action drafts`,
    );
    assert(
      Boolean(draft && projection)
        && draft?.predicateRequirements.length === projection?.predicates.length
        && draft.predicateRequirements.every((requirement, index) => (
          requirement.index === index
          && requirement.stage === projection?.predicates[index]?.stage
          && requirement.actionIndex === projection?.predicates[index]?.actionIndex
          && requirement.role === projection?.predicates[index]?.role
          && requirement.observerTool === projection?.predicates[index]?.tool
          && JSON.stringify(requirement.requirements)
            === JSON.stringify(projection?.predicates[index]?.requirements)
          && requirement.contractRequirementFingerprint
            === draft.acceptanceRequirements.predicateRequirementFingerprints[index]
        )),
      `${label} hashes every exact predicate but returns only value-free requirement metadata`,
    );
    const serialized = JSON.stringify(draft);
    assert(
      !serialized.includes('"actions"')
        && !serialized.includes('"predicateFingerprints"')
        && !serialized.includes('"authorizationFingerprint"')
        && !serialized.includes('"callIdentityFingerprint"')
        && !serialized.includes('"policyBindingFingerprint"')
        && !serialized.includes('"verifierBindingFingerprint"')
        && !serialized.includes('"replayBindingFingerprint"')
        && !serialized.includes('"mutationAuthority"')
        && !serialized.includes('"exactToolArgs"')
        && !serialized.includes('"dispatchBinding"'),
      `${label} requirement artifact cannot masquerade as root acceptance or dispatch binding`,
    );
    assert(
      !serialized.includes('"appName"')
        && !serialized.includes('"widthPx"')
        && !serialized.includes('"heightPx"')
        && !serialized.includes('Untitled-')
        && !serialized.includes('"documentName":')
        && !serialized.includes('"activeDocumentName":')
        && !serialized.includes('"pid":')
        && !serialized.includes('"documentCount":')
        && !serialized.includes('"approvalReceipt"')
        && !serialized.includes('"proofFingerprint"'),
      `${label} requirement artifact carries no raw call, observation, proof, or receipt values`,
    );
  }

  assert(
    stoppedDraft?.predicateRequirements.some((requirement) => (
      requirement.role === 'photoshop_launch_identity_verified'
      && requirement.requirements.includes('positive_pid_when_running')
    )) === true
      && backgroundDraft?.predicateRequirements.some((requirement) => (
        requirement.role === 'photoshop_focus_identity_verified'
        && requirement.requirements.includes('same_pid_as_prior_app_receipt')
        && requirement.requirements.includes('frontmost')
      )) === true,
    'launch and focus requirements still demand fresh identity, PID, and frontmost receipts',
  );
  assert(
    frontmostDraft?.predicateRequirements.some((requirement) => (
      requirement.role === 'photoshop_create_foreground_precondition_verified'
      && requirement.requirements.includes('same_pid_as_prior_app_receipt')
      && requirement.requirements.includes('frontmost')
    )) === true
      && frontmostDraft.predicateRequirements.some((requirement) => (
        requirement.role === 'photoshop_created_document_receipt_verified'
        && requirement.requirements.includes('create_receipt_created_true')
        && requirement.requirements.includes('document_count_increased_from_baseline')
        && requirement.requirements.includes('active_document_name_matches_create_receipt')
      )),
    'create requirement retains same-PID foreground and receipt/count-delta proof obligations',
  );
  assert(
    frontmostDraft?.authorizationPolicyRequirement.mode === 'direct_user_request'
      && frontmostDraft.authorizationPolicyRequirement.trustedAuthorizationReceiptRequired === true
      && frontmostDraft.authorizationPolicyRequirement.chatPlanApprovalRequired === false,
    'direct request remains a policy requirement pending trusted gateway attestation',
  );

  if (frontmostDraft && directProjections.frontmost) {
    const repeat = await buildPhotoshopNewDocumentRootProjectionDraft({
      program: direct,
      projection: directProjections.frontmost,
      requestIdentityFingerprint: requestA,
      programFingerprint: directProgramFingerprint,
      fingerprint: rootFingerprint,
    });
    assert(
      JSON.stringify(repeat) === JSON.stringify(frontmostDraft),
      'identical canonical inputs produce a deterministic root draft',
    );
    const allDerivedFingerprints = [
      ...frontmostDraft.predicateRequirements.map(
        (requirement) => requirement.contractRequirementFingerprint,
      ),
      ...frontmostDraft.acceptanceRequirements.actionRequirements.flatMap((action) => [
        action.toolArgsFingerprint,
        action.authorizationRequirementFingerprint,
      ]),
      ...frontmostDraft.requiredDispatchRequirements.flatMap((requirement) => [
        requirement.callIdentityRequirementFingerprint,
        requirement.policyBindingRequirementFingerprint,
        requirement.verifierBindingRequirementFingerprint,
        requirement.replayBindingRequirementFingerprint,
      ]),
    ];
    assert(
      new Set(allDerivedFingerprints).size === allDerivedFingerprints.length,
      'predicate and action fingerprints are globally collision-free',
    );
    assert(
      frontmostDraft.requiredDispatchRequirements[0]?.verifierPredicateRequirementFingerprints.length
        === frontmostDraft.predicateRequirements.length
        && frontmostDraft.requiredDispatchRequirements[0]?.proofReceiptRequirements.includes('fresh_receipt')
        && frontmostDraft.requiredDispatchRequirements[0]?.proofReceiptRequirements.includes('dimensions_match_request'),
      'per-action verifier requirement covers its exact fresh proof receipt obligations',
    );
    assert(
      Object.isFrozen(frontmostDraft)
        && Object.isFrozen(frontmostDraft.authorizationPolicyRequirement)
        && Object.isFrozen(frontmostDraft.predicateRequirements)
        && frontmostDraft.predicateRequirements.every((requirement) => (
          Object.isFrozen(requirement)
          && Object.isFrozen(requirement.requirements)
        ))
        && Object.isFrozen(frontmostDraft.acceptanceRequirements)
        && Object.isFrozen(frontmostDraft.acceptanceRequirements.actionRequirements)
        && frontmostDraft.acceptanceRequirements.actionRequirements.every(
          (requirement) => Object.isFrozen(requirement),
        )
        && Object.isFrozen(frontmostDraft.requiredDispatchRequirements)
        && frontmostDraft.requiredDispatchRequirements.every((requirement) => (
          Object.isFrozen(requirement)
          && Object.isFrozen(requirement.verifierPredicateRequirementFingerprints)
          && Object.isFrozen(requirement.proofReceiptRequirements)
        )),
      'root projection requirement artifact is deeply frozen',
    );

    const callerProgram = cloneProgram(direct);
    const callerProjection = projectPhotoshopNewDocumentMutations(
      callerProgram,
      states.frontmost,
    );
    const callerOwnedProjection = callerProjection
      ? cloneProgram(callerProjection)
      : null;
    const aliasSafeDraft = callerOwnedProjection
      ? await buildPhotoshopNewDocumentRootProjectionDraft({
          program: callerProgram,
          projection: callerOwnedProjection,
          requestIdentityFingerprint: requestA,
          programFingerprint: directProgramFingerprint,
          fingerprint: rootFingerprint,
        })
      : null;
    if (callerOwnedProjection) {
      callerProgram.steps[3].args.widthPx = 777;
      callerOwnedProjection.predicates[0].expected.frontmost = false;
    }
    assert(
      aliasSafeDraft?.projectionBranch === 'app_frontmost'
        && aliasSafeDraft.predicateRequirements[0]?.role === 'photoshop_app_identity_observed'
        && !JSON.stringify(aliasSafeDraft).includes('"frontmost":false'),
      'root requirement artifact does not alias caller-owned program or projection data',
    );
  }

  const changedProjection = projectPhotoshopNewDocumentMutations(
    changedDimensions,
    states.frontmost,
  );
  const changedDraft = changedProjection
    ? await buildPhotoshopNewDocumentRootProjectionDraft({
        program: changedDimensions,
        projection: changedProjection,
        requestIdentityFingerprint: requestA,
        programFingerprint: changedProgramFingerprint,
        fingerprint: rootFingerprint,
      })
    : null;
  const changedRequestDraft = directProjections.frontmost
    ? await buildPhotoshopNewDocumentRootProjectionDraft({
        program: direct,
        projection: directProjections.frontmost,
        requestIdentityFingerprint: requestB,
        programFingerprint: directProgramFingerprint,
        fingerprint: rootFingerprint,
      })
    : null;
  const approvalProjection = projectPhotoshopNewDocumentMutations(
    approvalRequired,
    states.frontmost,
  );
  const approvalDraft = approvalProjection
    ? await buildPhotoshopNewDocumentRootProjectionDraft({
        program: approvalRequired,
        projection: approvalProjection,
        requestIdentityFingerprint: requestA,
        programFingerprint: approvalProgramFingerprint,
        fingerprint: rootFingerprint,
      })
    : null;
  const approvalStoppedProjection = projectPhotoshopNewDocumentMutations(
    approvalRequired,
    states.stopped,
  );
  const approvalStoppedDraft = approvalStoppedProjection
    ? await buildPhotoshopNewDocumentRootProjectionDraft({
        program: approvalRequired,
        projection: approvalStoppedProjection,
        requestIdentityFingerprint: requestA,
        programFingerprint: approvalProgramFingerprint,
        fingerprint: rootFingerprint,
      })
    : null;
  assert(
    frontmostDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
      === changedRequestDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
      && stoppedDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
        === approvalStoppedDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint,
    'request and authorization-policy changes keep canonical handler-args hashes stable',
  );
  assert(
    frontmostDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint
      !== changedDraft?.acceptanceRequirements.actionRequirements[0]?.toolArgsFingerprint,
    'dimension changes alter the canonical create-handler args hash',
  );
  assert(
    frontmostDraft?.requiredDispatchRequirements[0]?.callIdentityRequirementFingerprint
      !== changedDraft?.requiredDispatchRequirements[0]?.callIdentityRequirementFingerprint,
    'dimension changes alter the exact action identity',
  );
  assert(
    frontmostDraft?.requiredDispatchRequirements[0]?.callIdentityRequirementFingerprint
      !== changedRequestDraft?.requiredDispatchRequirements[0]?.callIdentityRequirementFingerprint,
    'request identity changes alter the exact action identity',
  );
  assert(
    approvalDraft?.authorizationPolicyRequirement.mode === 'chat_plan_approval'
      && approvalDraft.authorizationPolicyRequirement.category === 'plan_approval'
      && approvalDraft.authorizationPolicyRequirement.trustedAuthorizationReceiptRequired === true
      && approvalDraft.authorizationPolicyRequirement.chatPlanApprovalRequired === true
      && approvalDraft.requiredDispatchRequirements[0]?.policyBindingRequirementFingerprint
        !== frontmostDraft?.requiredDispatchRequirements[0]?.policyBindingRequirementFingerprint,
    'resource policy changes bind required plan approval and trusted receipt obligations',
  );

  if (directProjections.frontmost) {
    const common = {
      program: direct,
      projection: directProjections.frontmost,
      requestIdentityFingerprint: requestA,
      programFingerprint: directProgramFingerprint,
    };
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        requestIdentityFingerprint: '',
        fingerprint: rootFingerprint,
      }) === null
        && await buildPhotoshopNewDocumentRootProjectionDraft({
          ...common,
          requestIdentityFingerprint: `args-v2:sha256:${'A'.repeat(64)}`,
          fingerprint: rootFingerprint,
        }) === null
        && await buildPhotoshopNewDocumentRootProjectionDraft({
          ...common,
          requestIdentityFingerprint: directProgramFingerprint,
          fingerprint: rootFingerprint,
        }) === null,
      'empty, malformed, and colliding supplied identities fail closed',
    );
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        programFingerprint: `args-v2:sha256:${'3'.repeat(64)}`,
        fingerprint: rootFingerprint,
      }) === null,
      'program fingerprint drift fails closed after canonical recomputation',
    );

    const driftedProjection = cloneProgram(directProjections.frontmost);
    driftedProjection.predicates[0].expected.frontmost = false;
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        projection: driftedProjection,
        fingerprint: rootFingerprint,
      }) === null,
      'observed-branch predicate drift fails closed',
    );
    const missingReceipt = cloneProgram(directProjections.frontmost);
    missingReceipt.predicates.find(
      (predicate) => predicate.role === 'photoshop_created_document_receipt_verified',
    )?.requirements.pop();
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        projection: missingReceipt,
        fingerprint: rootFingerprint,
      }) === null,
      'removing one create receipt requirement fails closed',
    );
    const malformedProgram = cloneProgram(direct);
    malformedProgram.steps[3].args.widthPx = 999;
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        program: malformedProgram,
        fingerprint: rootFingerprint,
      }) === null,
      'malformed canonical program fails closed',
    );

    let collisionCalls = 0;
    const collisionFingerprint = async (): Promise<string> => {
      collisionCalls += 1;
      return collisionCalls === 1
        ? directProgramFingerprint
        : `args-v2:sha256:${'4'.repeat(64)}`;
    };
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        fingerprint: collisionFingerprint,
      }) === null && collisionCalls >= 3,
      'injected fingerprint collisions fail closed',
    );
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        fingerprint: async () => '',
      }) === null,
      'empty injected fingerprint fails closed',
    );
    assert(
      await buildPhotoshopNewDocumentRootProjectionDraft({
        ...common,
        fingerprint: async () => { throw new Error('fingerprint unavailable'); },
      }) === null,
      'fingerprint throw or rejection fails closed',
    );
  }

  const source = readFileSync('src/lib/computerSequenceProgramCore.ts', 'utf8');
  const importedModules = Array.from(source.matchAll(/from\s+['"]([^'"]+)['"]/g))
    .map((match) => match[1]);
  assert(
    JSON.stringify(importedModules) === JSON.stringify(['./genericAppNavigator']),
    'projection core imports zero desktop, database, universal-root, or runtime modules',
  );
  assert(
    !/createHash|node:crypto|subtle\.digest/.test(source),
    'projection core never fabricates a local digest',
  );
})();

// ── The exact ask that motivated this core ──────────────────────────────────
{
  const program = compileComputerSequenceProgram('Open Photoshop and start a new project 600 x 600');
  assert(!!program, 'the motivating ask compiles');
  assert(program?.id === 'photoshop_new_document', 'family id pinned');
  assert(program?.authorization.mode === 'direct_user_request', 'bounded unsaved draft is authorized by the current direct request');
  const tools = (program?.steps || []).map((step) => step.tool);
  assert(tools.join(' → ') === [
    'desktop.photoshop_document_status',
    'desktop.launch_app',
    'desktop.photoshop_document_status',
    'desktop.photoshop_create_document',
    'desktop.photoshop_document_status',
  ].join(' → '), `observe → launch → wait → create → verify (got ${tools.join(' → ')})`);
  const create = program?.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  assert(create?.args.widthPx === 600 && create?.args.heightPx === 600, 'create carries the exact 600x600');
  const launch = program?.steps.find((step) => step.tool === 'desktop.launch_app');
  assert(launch?.args.appName === 'Photoshop', 'launch targets Photoshop');
}

// ── Phrasing variants ───────────────────────────────────────────────────────
{
  for (const [task, w, h] of [
    ['Open Photoshop and start a new project with 600 x 600 pixels', 600, 600],
    ['open photoshop and create a new document 1080x1080', 1080, 1080],
    ['make a new 1920 by 1080 canvas in Photoshop', 1920, 1080],
    ['photoshop: new blank document 300×250', 300, 250],
    ['Start a new Photoshop project 512 x 512 px', 512, 512],
    ['Can you open Photoshop and start a new project 600 x 600?', 600, 600],
    ['Could you open Photoshop and start a new project 640 x 480?', 640, 480],
    ['Would you open Photoshop and start a new project 800 x 600?', 800, 600],
    ['I need you to open Photoshop and start a new project 1024 x 768', 1024, 768],
    ['Can you open Photoshop and create a 600 x 600 document?', 600, 600],
    ['I need you to open Photoshop and create a 600 by 600 document', 600, 600],
    ['Would you mind opening Photoshop and creating a 600 x 600 document for me?', 600, 600],
    ['Would you mind opening Photoshop and starting a new project 600 x 600 when you can?', 600, 600],
    ['Hey, can you just open Photoshop and create a 600 x 600 document right now, please!', 600, 600],
  ] as const) {
    const program = compileComputerSequenceProgram(task);
    const create = program?.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
    assert(create?.args.widthPx === w && create?.args.heightPx === h, `variant compiles ${w}x${h}: "${task}"`);
  }
}

// ── Must NOT compile ────────────────────────────────────────────────────────
{
  for (const task of [
    'resize the image to 600 x 600 in photoshop',            // edit, not create
    'crop the photo to 600x600 in Photoshop',                // edit
    'export the document as 600 x 600 from photoshop',       // edit/export
    'open photoshop',                                        // no dimensions
    'start a new project 600 x 600',                         // no app named
    'open illustrator and start a new project 600 x 600',    // wrong app
    'convert this to a 600x600 png in photoshop',            // convert
    'open photoshop and create a new document 600x600 then save it',
    'open photoshop and create a new document 600x600 then export it',
    'open photoshop and create a new document 600x600 and overwrite test.psd',
    'open photoshop and create a new document 600x600 then delete a layer',
    'open photoshop and create a new document 600x600 then log in',
    'open photoshop and create a new document 600x600 then purchase credits',
    'open photoshop and create a new document 600x600 then add text',
    'open photoshop and create a new document 600x600 then place an asset',
    'open photoshop and create a new document 600x600 then rotate it',
    'open photoshop and create a new document 600x600 then frobnicate it',
    'open photoshop and create a new document 600x600 tomorrow',
    'open photoshop and create a new document 600x600 for my client',
    'open photoshop and create a new document 600x600 without asking',
    '',                                                      // empty
  ]) {
    assert(compileComputerSequenceProgram(task) === null, `does not compile: "${task || '(empty)'}"`);
  }
}

// ── Dimension bounds ────────────────────────────────────────────────────────
{
  assert(compileComputerSequenceProgram('open photoshop and create a new document 0 x 600') === null, 'zero width rejected');
  assert(compileComputerSequenceProgram('open photoshop and create a new document 99999 x 600') === null, 'oversize rejected (dimension regex caps at 5 digits, clamp at 30000)');
  const max = compileComputerSequenceProgram('open photoshop and create a new document 30000 x 30000');
  const createMax = max?.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
  assert(createMax?.args.widthPx === 30000, 'max dimension 30000 accepted');
  assert(max?.authorization.mode === 'chat_plan_approval', 'resource-heavy exact allocation retains a Chat plan approval');
  assert(
    compileComputerSequenceProgram('open photoshop and create a new document 4096 x 4096')?.authorization.mode === 'direct_user_request',
    '4096x4096 remains inside the direct-request resource bound',
  );
  assert(
    compileComputerSequenceProgram('open photoshop and create a new document 4097 x 4096')?.authorization.mode === 'chat_plan_approval',
    'one dimension beyond 4096 requires Chat plan approval',
  );
  assert(compileComputerSequenceProgram('open photoshop and create a new document 30001 x 600') === null, '30001 rejected');
}

// ── Prompt block contract ───────────────────────────────────────────────────
{
  const program = compileComputerSequenceProgram('Open Photoshop and start a new project 600 x 600');
  const block = program?.promptBlock || '';
  assert(block.startsWith('## EXACT TOOL PROGRAM'), 'prompt block leads with the program heading');
  assert(block.includes('desktop.photoshop_create_document {"widthPx":600,"heightPx":600}'), 'prompt block spells the exact create call');
  assert(/do not re-plan/i.test(block), 'prompt block forbids re-planning');
  assert(/no active document/i.test(block) && /expected[\s\S]{0,6}starting[\s\S]{0,6}state/i.test(block), 'prompt block neutralizes the no-document blocker');
  assert(/file_search|file_stat/.test(block) && /Do NOT call/.test(block), 'prompt block forbids the noise tools');
  assert(/wait ~10 seconds/i.test(block), 'prompt block carries the cold-start retry rule');
  assert(/direct command authorizes/i.test(block), 'prompt block records direct-request authority');
  assert(block.length < 2600, `prompt block stays compact (${block.length} chars)`);
}

// ── Totality ────────────────────────────────────────────────────────────────
{
  for (const hostile of [null, undefined, 123 as any, { toString() { throw new Error('boom'); } } as any, 'x'.repeat(5000)]) {
    let ok = true;
    try { compileComputerSequenceProgram(hostile); } catch { ok = false; }
    assert(ok, `total on hostile input (${typeof hostile === 'string' ? 'long string' : String(hostile && typeof hostile)})`);
  }
}

void Promise.all([idempotencyChecks, rootProjectionDraftChecks]).then(() => {
  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) {
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('All computer-sequence-program-core smoke cases passed — the ask compiles to the exact calls.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
