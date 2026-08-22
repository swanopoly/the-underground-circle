/**
 * computerSequenceProgramCore — compile a deterministic desktop ask into a
 * LITERAL tool program the agent loop executes in order, instead of asking
 * the model to improvise a plan against the full evidence-contract prose.
 *
 * Motivation (2026-07-31): "Open Photoshop and start a new project 600 x 600"
 * failed for days because the model had to reconstruct a 4-call sequence from
 * a multi-KB advisory context and kept stalling on observe-first guidance
 * that does not apply to from-scratch creation. The planner already PARSES
 * the ask deterministically — this core finishes the job by emitting the
 * exact calls. In Chat, every program declares its authorization policy. The
 * first supported family creates only a new unsaved blank document, so the
 * user's direct command authorizes that reversible local draft without a
 * redundant confirmation. The program still observes before mutation and
 * proves the active document after.
 *
 * Deliberately NARROW: only task families whose steps map 1:1 onto typed
 * bridge tools compile; anything else returns null and the normal planning
 * flow runs unchanged. Pure + tsx-loadable
 * (smoke: scripts/computer-sequence-program-core-smoketest.ts).
 */

import { unwrapDirectDesktopCommand } from './genericAppNavigator';

export interface ComputerSequenceProgramStep {
  tool: string;
  args: Record<string, unknown>;
  note: string;
}

export interface ComputerSequenceProgram {
  id: string;
  title: string;
  authorization: {
    mode: 'direct_user_request' | 'chat_plan_approval';
    reason: string;
  };
  steps: ComputerSequenceProgramStep[];
  promptBlock: string;
}

export interface ComputerSequenceProgramManifest {
  schemaVersion: 1;
  programId: string;
  authorizationMode: ComputerSequenceProgram['authorization']['mode'];
  steps: Array<{ tool: string; args: Record<string, unknown> }>;
}

export type PhotoshopNewDocumentObservedState = Readonly<{
  appRunning: boolean;
  appFrontmost: boolean;
}>;

export type ComputerSequenceProjectedMutation = Readonly<{
  /** Inert compiler output. This object is never dispatch authority. */
  projectionOnly: true;
  index: number;
  tool:
    | 'desktop.launch_app'
    | 'desktop.focus_app'
    | 'desktop.photoshop_create_document';
  args: Readonly<Record<string, unknown>>;
  mutatesState: true;
  requiresForegroundLease: true;
  source: 'compiler';
  authorizationCategory: 'direct_request' | 'plan_approval';
  /** Authority the future runtime gateway must obtain; not authority held by
   *  this projection. These tools remain unsupported until that gateway is
   *  actually wired through section 26. */
  requiredMutationAuthority: 'action_ledger';
  verifierPredicateRole:
    | 'photoshop_app_running'
    | 'photoshop_app_frontmost'
    | 'photoshop_active_document_dimensions';
}>;

export type ComputerSequenceProjectedProofRequirement =
  | 'fresh_receipt'
  | 'requested_app_is_photoshop'
  | 'resolved_photoshop_identity'
  | 'positive_pid_when_running'
  | 'capture_baseline_document_count'
  | 'capture_baseline_active_document_identity'
  | 'app_running'
  | 'same_pid_as_prior_app_receipt'
  | 'frontmost'
  | 'create_receipt_created_true'
  | 'create_receipt_document_name_present'
  | 'create_receipt_document_count_present'
  | 'document_count_increased_from_baseline'
  | 'active_document_name_matches_create_receipt'
  | 'dimensions_match_request';

export type ComputerSequenceProjectedPredicate = Readonly<{
  stage: 'observe_before' | 'verify_before_action' | 'verify_after_action';
  /** Null for the two request baselines; otherwise the exact projected
   *  mutation whose precondition or effect this predicate verifies. */
  actionIndex: number | null;
  role:
    | 'photoshop_app_identity_observed'
    | 'photoshop_document_baseline_observed'
    | 'photoshop_launch_identity_verified'
    | 'photoshop_focus_identity_verified'
    | 'photoshop_create_foreground_precondition_verified'
    | 'photoshop_created_document_receipt_verified';
  tool: 'desktop.observe_app' | 'desktop.photoshop_document_status';
  args: Readonly<Record<string, unknown>>;
  expected: Readonly<Record<string, boolean | number>>;
  requirements: ReadonlyArray<ComputerSequenceProjectedProofRequirement>;
}>;

/**
 * Pure feature-off projection for a future universal-root acceptance binding.
 * It describes bridge mutations and verification predicates; it never grants
 * dispatch authority, fabricates fingerprints, or executes a tool.
 */
export type PhotoshopNewDocumentMutationProjection = Readonly<{
  schemaVersion: 1;
  projectionOnly: true;
  programId: 'photoshop_new_document';
  requestedDimensions: Readonly<{ widthPx: number; heightPx: number }>;
  observedState: PhotoshopNewDocumentObservedState;
  predicates: ReadonlyArray<ComputerSequenceProjectedPredicate>;
  mutations: ReadonlyArray<ComputerSequenceProjectedMutation>;
}>;

export type PhotoshopNewDocumentProjectionBranch =
  | 'app_stopped'
  | 'app_background'
  | 'app_frontmost';

export type ComputerSequencePredicateRequirement = Readonly<{
  index: number;
  contractRequirementFingerprint: string;
  stage: ComputerSequenceProjectedPredicate['stage'];
  actionIndex: number | null;
  role: ComputerSequenceProjectedPredicate['role'];
  observerTool: ComputerSequenceProjectedPredicate['tool'];
  requirements: ReadonlyArray<ComputerSequenceProjectedProofRequirement>;
}>;

export type ComputerSequenceActionRequirement = Readonly<{
  actionIndex: number;
  tool: ComputerSequenceProjectedMutation['tool'];
  toolArgsFingerprint: string;
  authorizationRequirementFingerprint: string;
  authorizationReceiptStatus: 'required';
  proofReceiptStatus: 'required';
  mutatesState: true;
  requiresForegroundLease: true;
}>;

/**
 * A future gateway must satisfy this requirement with a trusted authorization
 * receipt, proof receipt, real root dispatch binding, and section-26 mutation
 * authority. This inert value deliberately shares no authority-bearing
 * fingerprint field names with a root dispatch binding.
 */
export type ComputerSequenceRequiredDispatchRequirement = Readonly<{
  projectionOnly: true;
  readyForDispatchBinding: false;
  bindingStatus: 'required';
  actionIndex: number;
  tool: ComputerSequenceProjectedMutation['tool'];
  source: 'compiler';
  callIdentityRequirementFingerprint: string;
  authorizationCategory: ComputerSequenceProjectedMutation['authorizationCategory'];
  authorizationReceiptStatus: 'required';
  proofReceiptStatus: 'required';
  requiredMutationAuthority: 'action_ledger';
  policyBindingRequirementFingerprint: string;
  verifierBindingRequirementFingerprint: string;
  replayBindingRequirementFingerprint: string;
  verifierPredicateRequirementFingerprints: ReadonlyArray<string>;
  proofReceiptRequirements: ReadonlyArray<ComputerSequenceProjectedProofRequirement>;
}>;

/**
 * Feature-off requirement shape for a future universal-root gateway.
 * `observedState` is only a compiler branch hint. It is not proof that
 * Photoshop is still in that state; fresh app/status receipts remain
 * mandatory and no value-bearing observation is returned here.
 */
export type PhotoshopNewDocumentRootProjectionDraft = Readonly<{
  schemaVersion: 1;
  projectionOnly: true;
  readyForRootBinding: false;
  programId: 'photoshop_new_document';
  requestIdentityFingerprint: string;
  programFingerprint: string;
  projectionBranch: PhotoshopNewDocumentProjectionBranch;
  authorizationPolicyRequirement: Readonly<{
    mode: ComputerSequenceProgram['authorization']['mode'];
    category: ComputerSequenceProjectedMutation['authorizationCategory'];
    trustedAuthorizationReceiptRequired: true;
    chatPlanApprovalRequired: boolean;
  }>;
  predicateRequirements: ReadonlyArray<ComputerSequencePredicateRequirement>;
  acceptanceRequirements: Readonly<{
    predicateRequirementFingerprints: ReadonlyArray<string>;
    actionRequirements: ReadonlyArray<ComputerSequenceActionRequirement>;
  }>;
  requiredDispatchRequirements: ReadonlyArray<ComputerSequenceRequiredDispatchRequirement>;
}>;

export type ComputerSequenceFingerprintBuilder = (
  value: unknown,
) => Promise<string>;

const COMPUTER_SEQUENCE_SHA256_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
export const COMPUTER_SEQUENCE_ACTION_IDEMPOTENCY_KEY_RE =
  /^exact\.[0-9a-f]{64}\.photoshop_create_document\.1$/;

/**
 * Build the one request-stable §26 key for the currently supported exact
 * mutation. Wrapper `agent_runs.id` is deliberately absent: the database's
 * unique (user, circle, idempotency_key) boundary must survive a crash that
 * creates a replacement wrapper run.
 */
export async function buildComputerSequenceActionIdempotencyKey(input: {
  program: ComputerSequenceProgram;
  programFingerprint: string;
  requestIdentityFingerprint: string;
  fingerprint: ComputerSequenceFingerprintBuilder;
}): Promise<string> {
  if (
    input.program.id !== 'photoshop_new_document'
    || !COMPUTER_SEQUENCE_SHA256_RE.test(input.programFingerprint)
    || !COMPUTER_SEQUENCE_SHA256_RE.test(input.requestIdentityFingerprint)
    || typeof input.fingerprint !== 'function'
  ) return '';
  const fingerprint = await input.fingerprint({
    schemaVersion: 1,
    namespace: 'exact_sequence_action',
    requestIdentityFingerprint: input.requestIdentityFingerprint,
    programFingerprint: input.programFingerprint,
    tool: 'desktop.photoshop_create_document',
    actionId: 'compiler.photoshop_new_document.create.1',
  });
  if (!COMPUTER_SEQUENCE_SHA256_RE.test(fingerprint)) return '';
  const digest = fingerprint.slice('args-v2:sha256:'.length);
  const key = `exact.${digest}.photoshop_create_document.1`;
  return COMPUTER_SEQUENCE_ACTION_IDEMPOTENCY_KEY_RE.test(key) ? key : '';
}

/** Exact executable fields covered by runtime dispatch fingerprints. */
export function buildComputerSequenceProgramManifest(
  program: ComputerSequenceProgram,
): ComputerSequenceProgramManifest {
  return {
    schemaVersion: 1,
    programId: program.id,
    authorizationMode: program.authorization.mode,
    steps: program.steps.map((step) => ({
      tool: step.tool,
      args: { ...step.args },
    })),
  };
}

/**
 * Stable mutation-contract fingerprint for one exact submitted request.
 * Approval rows and policy sources are intentionally excluded: they are
 * one-shot dispatch/audit evidence and can change while the request, program,
 * and approval intent remain the same during bounded recovery.
 *
 * The direct-request payload matches the original production shape exactly so
 * already-written bounded-draft ledger rows retain their identity.
 */
export async function buildComputerSequenceDurableContractFingerprint(input: {
  program: ComputerSequenceProgram;
  requestIdentityFingerprint: string;
  approvalIntentFingerprint?: string | null;
  fingerprint: ComputerSequenceFingerprintBuilder;
}): Promise<string> {
  if (
    !COMPUTER_SEQUENCE_SHA256_RE.test(input.requestIdentityFingerprint)
    || typeof input.fingerprint !== 'function'
  ) return '';
  if (
    input.program.authorization.mode === 'chat_plan_approval'
    && !COMPUTER_SEQUENCE_SHA256_RE.test(String(input.approvalIntentFingerprint || ''))
  ) return '';
  const authorization = input.program.authorization.mode === 'chat_plan_approval'
    ? {
        mode: input.program.authorization.mode,
        requestIdentityFingerprint: input.requestIdentityFingerprint,
        approvalIntentFingerprint: input.approvalIntentFingerprint,
      }
    : {
        mode: input.program.authorization.mode,
        requestIdentityFingerprint: input.requestIdentityFingerprint,
      };
  const result = await input.fingerprint({
    schemaVersion: 1,
    source: 'compiler_exact_sequence',
    program: buildComputerSequenceProgramManifest(input.program),
    authorization,
  });
  return COMPUTER_SEQUENCE_SHA256_RE.test(result) ? result : '';
}

const MAX_DIMENSION = 30000;
const DIRECT_REQUEST_MAX_DIMENSION = 4096;
const DIRECT_REQUEST_MAX_PIXELS = 4096 * 4096;

/** "600 x 600", "600x600", "600 by 600", "600×600" (+ optional px/pixels). */
const DIMENSIONS_RE = /(\d{1,5})\s*(?:x|×|by)\s*(\d{1,5})\s*(?:px|pixels?)?/i;

const PHOTOSHOP_RE = /\bphoto\s*shop\b|\bphotoshop\b/i;

/** Creation wording — must be a NEW artifact, not an edit of an existing one.
 *  "resize the image to 600x600" or "crop to 600 x 600" must NOT compile. */
const NEW_DOC_RE = /\b(?:new|blank|fresh)\b[\s\S]{0,40}?\b(?:project|document|doc|file|canvas|image|composition)\b|\b(?:start|create|make|open)\s+(?:up\s+)?a\s+(?:new\s+)?(?:photoshop\s+)?(?:project|document|doc|canvas)\b/i;

// Direct-request execution uses a whitelist, not an action denylist: after the
// dimensions are removed, every remaining word must belong to the narrow
// launch/new-document grammar. Unknown or additional instructions therefore
// fall back to the normal model-planned lane instead of being silently ignored.
const EXACT_NEW_DOCUMENT_WORDS = new Set([
  'please', 'open', 'launch', 'start', 'create', 'make', 'up', 'a', 'an',
  'new', 'blank', 'fresh', 'adobe', 'photoshop', 'project', 'document', 'doc',
  'file', 'canvas', 'image', 'composition', 'in', 'with', 'using', 'at', 'of',
  'size', 'sized', 'pixels', 'px', 'and', 'then',
]);

function hasOnlyExactNewDocumentLanguage(task: string): boolean {
  const dimensions = Array.from(task.matchAll(new RegExp(DIMENSIONS_RE.source, 'gi')));
  if (dimensions.length !== 1) return false;
  const withoutDimensions = task.replace(DIMENSIONS_RE, ' ').toLowerCase();
  // REJECT non-ASCII rather than stripping it. `[^a-z]+ → ' '` DELETED any
  // character outside a-z, so a smuggled instruction in Cyrillic/CJK/emoji
  // vanished and the remainder passed the whitelist — defeating this
  // function's own invariant that unknown or additional instructions must
  // fall back to the model-planned lane.
  if (/[^\x20-\x7e]/.test(withoutDimensions)) return false;
  const remaining = withoutDimensions
    .replace(/[^a-z]+/g, ' ')
    .trim();
  if (!remaining) return false;
  const words = remaining.split(/\s+/).filter(Boolean);
  if (!words.every((word) => EXACT_NEW_DOCUMENT_WORDS.has(word))) return false;
  const artifactNouns = words.filter((word) => (
    word === 'project'
    || word === 'document'
    || word === 'doc'
    || word === 'file'
    || word === 'canvas'
    || word === 'image'
    || word === 'composition'
  ));
  return artifactNouns.length === 1;
}

function clampDimension(raw: string): number | null {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) return null;
  return value;
}

function formatStep(index: number, step: ComputerSequenceProgramStep): string {
  return `${index + 1}. ${step.tool} ${JSON.stringify(step.args)} — ${step.note}`;
}

function buildPromptBlock(program: Omit<ComputerSequenceProgram, 'promptBlock'>): string {
  const authorizationLines = program.authorization.mode === 'direct_user_request'
    ? [
        'plan for this request. The user\'s direct command authorizes this bounded',
        'new unsaved document; run each',
      ]
    : [
        'plan for this request. After the enclosing Chat plan approval is accepted,',
        'run each',
      ];
  return [
    '## EXACT TOOL PROGRAM (execute this, in order — do not re-plan)',
    `Task family: ${program.title}. The steps below are the complete exact`,
    ...authorizationLines,
    'tool exactly as written, one per step,',
    'then report the verified result. Rules:',
    '- Do NOT call file_search, file_stat, screenshot, a11y, menu, or any',
    '  coordinate/keyboard tool for this task — there is no source file and no',
    '  dialog to drive; the scripted tools below are the whole job.',
    '- This is FROM-SCRATCH creation: "no active document" is the expected',
    '  starting state, not a blocker. Document-inventory guidance is satisfied',
    '  by the status calls in this program.',
    '- If a status step reports the app is not running or not yet scriptable,',
    '  wait ~10 seconds and repeat that status step (up to 4 tries — a cold',
    '  Photoshop launch takes a minute) before moving on.',
    '- If a step fails after its retries, stop and report that exact step and',
    '  the tool error text. Do not improvise an alternative route.',
    '',
    ...program.steps.map((step, index) => formatStep(index, step)),
  ].join('\n');
}

/**
 * Read compiler/runtime-owned plain data without evaluating accessor fields.
 * This is not an untrusted-JavaScript isolation boundary: callers must never
 * pass live Proxy objects, whose reflection traps are executable by design.
 */
function readExactOwnDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (
    descriptorKeys.length !== expectedKeys.length
    || descriptorKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return null;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function readExactOwnDataArray(value: unknown, expectedLength: number): unknown[] | null {
  if (!Array.isArray(value) || value.length !== expectedLength) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = [
    ...Array.from({ length: expectedLength }, (_, index) => String(index)),
    'length',
  ];
  const descriptorKeys = Reflect.ownKeys(descriptors);
  if (
    descriptorKeys.length !== expectedKeys.length
    || descriptorKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) return null;
  const result: unknown[] = [];
  for (let index = 0; index < expectedLength; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return null;
    }
    result.push(descriptor.value);
  }
  return result;
}

function buildPhotoshopNewDocumentProgram(
  widthPx: number,
  heightPx: number,
): ComputerSequenceProgram {
  const directRequest = widthPx <= DIRECT_REQUEST_MAX_DIMENSION
    && heightPx <= DIRECT_REQUEST_MAX_DIMENSION
    && widthPx * heightPx <= DIRECT_REQUEST_MAX_PIXELS;
  const steps: ComputerSequenceProgramStep[] = [
    {
      tool: 'desktop.photoshop_document_status',
      args: {},
      note: 'Observe: is Photoshop running, and what documents are open? (appRunning:false is fine — next step launches it.)',
    },
    {
      tool: 'desktop.launch_app',
      args: { appName: 'Photoshop' },
      note: 'Only if step 1 reported the app is not running; skip when already running.',
    },
    {
      tool: 'desktop.photoshop_document_status',
      args: {},
      note: 'Wait for scriptability after a launch — repeat per the cold-start rule until appRunning:true.',
    },
    {
      tool: 'desktop.photoshop_create_document',
      args: { widthPx, heightPx },
      note: 'Create the new document at the exact requested pixel size.',
    },
    {
      tool: 'desktop.photoshop_document_status',
      args: {},
      note: `Verify: the active document reports ${widthPx}x${heightPx}. Report its name and size as proof.`,
    },
  ];
  const base: Omit<ComputerSequenceProgram, 'promptBlock'> = {
    id: 'photoshop_new_document',
    title: `Photoshop new ${widthPx}x${heightPx} document`,
    authorization: {
      mode: directRequest ? 'direct_user_request' : 'chat_plan_approval',
      reason: directRequest
        ? 'The exact program creates only a bounded new unsaved blank document and does not edit, save, export, overwrite, delete, publish, or send anything.'
        : 'The requested blank document exceeds the bounded direct-request resource limit and needs explicit confirmation before allocation.',
    },
    steps,
  };
  return { ...base, promptBlock: buildPromptBlock(base) };
}

function canonicalPhotoshopProgramDimensions(
  value: unknown,
): Readonly<{ widthPx: number; heightPx: number }> | null {
  const program = readExactOwnDataRecord(
    value,
    ['id', 'title', 'authorization', 'steps', 'promptBlock'],
  );
  if (!program || program.id !== 'photoshop_new_document') return null;
  const steps = readExactOwnDataArray(program.steps, 5);
  if (!steps) return null;
  const createStep = readExactOwnDataRecord(steps[3], ['tool', 'args', 'note']);
  if (!createStep) return null;
  const createArgs = readExactOwnDataRecord(createStep.args, ['widthPx', 'heightPx']);
  if (
    !createArgs
    || createStep.tool !== 'desktop.photoshop_create_document'
  ) return null;
  const widthPx = createArgs.widthPx;
  const heightPx = createArgs.heightPx;
  if (
    typeof widthPx !== 'number'
    || typeof heightPx !== 'number'
    || !Number.isInteger(widthPx)
    || !Number.isInteger(heightPx)
    || widthPx < 1
    || heightPx < 1
    || widthPx > MAX_DIMENSION
    || heightPx > MAX_DIMENSION
  ) return null;

  const expected = buildPhotoshopNewDocumentProgram(widthPx, heightPx);
  const authorization = readExactOwnDataRecord(program.authorization, ['mode', 'reason']);
  if (
    program.title !== expected.title
    || program.promptBlock !== expected.promptBlock
    || !authorization
    || authorization.mode !== expected.authorization.mode
    || authorization.reason !== expected.authorization.reason
  ) return null;
  for (let index = 0; index < expected.steps.length; index += 1) {
    const actualStep = readExactOwnDataRecord(steps[index], ['tool', 'args', 'note']);
    const expectedStep = expected.steps[index];
    if (
      !actualStep
      || actualStep.tool !== expectedStep.tool
      || actualStep.note !== expectedStep.note
    ) return null;
    const expectedArgKeys = Object.keys(expectedStep.args);
    const actualArgs = readExactOwnDataRecord(actualStep.args, expectedArgKeys);
    if (
      !actualArgs
      || expectedArgKeys.some((key) => actualArgs[key] !== expectedStep.args[key])
    ) return null;
  }
  return { widthPx, heightPx };
}

function freezeProjectedMutation(input: {
  index: number;
  tool: ComputerSequenceProjectedMutation['tool'];
  args: Record<string, unknown>;
  authorizationCategory: ComputerSequenceProjectedMutation['authorizationCategory'];
  verifierPredicateRole: ComputerSequenceProjectedMutation['verifierPredicateRole'];
}): ComputerSequenceProjectedMutation {
  return Object.freeze({
    projectionOnly: true as const,
    index: input.index,
    tool: input.tool,
    args: Object.freeze({ ...input.args }),
    mutatesState: true as const,
    requiresForegroundLease: true as const,
    source: 'compiler' as const,
    authorizationCategory: input.authorizationCategory,
    requiredMutationAuthority: 'action_ledger' as const,
    verifierPredicateRole: input.verifierPredicateRole,
  });
}

function freezeProjectedPredicate(input: {
  stage: ComputerSequenceProjectedPredicate['stage'];
  actionIndex: number | null;
  role: ComputerSequenceProjectedPredicate['role'];
  tool: ComputerSequenceProjectedPredicate['tool'];
  args: Record<string, unknown>;
  expected: Record<string, boolean | number>;
  requirements: ComputerSequenceProjectedProofRequirement[];
}): ComputerSequenceProjectedPredicate {
  return Object.freeze({
    stage: input.stage,
    actionIndex: input.actionIndex,
    role: input.role,
    tool: input.tool,
    args: Object.freeze({ ...input.args }),
    expected: Object.freeze({ ...input.expected }),
    requirements: Object.freeze([...input.requirements]),
  });
}

/**
 * Project the exact mutations implied by the fresh Photoshop app observation.
 * Returns null on any program/observation drift. Status checks are represented
 * only as predicates and can never be mistaken for ledger mutations.
 * Inputs must be compiler/runtime-owned plain snapshots, never live Proxies.
 */
export function projectPhotoshopNewDocumentMutations(
  program: ComputerSequenceProgram,
  observedState: PhotoshopNewDocumentObservedState,
): PhotoshopNewDocumentMutationProjection | null {
  try {
    const dimensions = canonicalPhotoshopProgramDimensions(program);
    const observation = readExactOwnDataRecord(
      observedState,
      ['appRunning', 'appFrontmost'],
    );
    if (
      !dimensions
      || !observation
      || typeof observation.appRunning !== 'boolean'
      || typeof observation.appFrontmost !== 'boolean'
      || !observation.appRunning && observation.appFrontmost
    ) return null;

    const directRequest = dimensions.widthPx <= DIRECT_REQUEST_MAX_DIMENSION
      && dimensions.heightPx <= DIRECT_REQUEST_MAX_DIMENSION
      && dimensions.widthPx * dimensions.heightPx <= DIRECT_REQUEST_MAX_PIXELS;
    const authorizationCategory = directRequest
      ? 'direct_request' as const
      : 'plan_approval' as const;
    const mutationInputs: Array<Parameters<typeof freezeProjectedMutation>[0]> = [];
    if (!observation.appRunning) {
      mutationInputs.push({
        index: mutationInputs.length,
        tool: 'desktop.launch_app',
        args: { appName: 'Photoshop' },
        authorizationCategory,
        verifierPredicateRole: 'photoshop_app_running',
      });
    } else if (!observation.appFrontmost) {
      mutationInputs.push({
        index: mutationInputs.length,
        tool: 'desktop.focus_app',
        args: { appName: 'Photoshop' },
        authorizationCategory,
        verifierPredicateRole: 'photoshop_app_frontmost',
      });
    }
    mutationInputs.push({
      index: mutationInputs.length,
      tool: 'desktop.photoshop_create_document',
      args: { widthPx: dimensions.widthPx, heightPx: dimensions.heightPx },
      authorizationCategory,
      verifierPredicateRole: 'photoshop_active_document_dimensions',
    });

    const mutations = Object.freeze(mutationInputs.map(freezeProjectedMutation));
    const predicateInputs: Array<Parameters<typeof freezeProjectedPredicate>[0]> = [
      {
        stage: 'observe_before',
        actionIndex: null,
        role: 'photoshop_app_identity_observed',
        tool: 'desktop.observe_app',
        args: { appName: 'Photoshop' },
        expected: {
          appRunning: observation.appRunning,
          frontmost: observation.appFrontmost,
        },
        requirements: [
          'fresh_receipt',
          'requested_app_is_photoshop',
          'resolved_photoshop_identity',
          'positive_pid_when_running',
        ],
      },
      {
        stage: 'observe_before',
        actionIndex: null,
        role: 'photoshop_document_baseline_observed',
        tool: 'desktop.photoshop_document_status',
        args: { appName: 'Photoshop' },
        expected: { appRunning: observation.appRunning },
        requirements: [
          'fresh_receipt',
          'capture_baseline_document_count',
          'capture_baseline_active_document_identity',
        ],
      },
    ];
    for (const mutation of mutations) {
      if (mutation.tool === 'desktop.launch_app') {
        predicateInputs.push({
          stage: 'verify_after_action',
          actionIndex: mutation.index,
          role: 'photoshop_launch_identity_verified',
          tool: 'desktop.observe_app',
          args: { appName: 'Photoshop' },
          expected: { appRunning: true },
          requirements: [
            'fresh_receipt',
            'requested_app_is_photoshop',
            'resolved_photoshop_identity',
            'positive_pid_when_running',
            'app_running',
          ],
        });
        continue;
      }
      if (mutation.tool === 'desktop.focus_app') {
        predicateInputs.push({
          stage: 'verify_after_action',
          actionIndex: mutation.index,
          role: 'photoshop_focus_identity_verified',
          tool: 'desktop.observe_app',
          args: { appName: 'Photoshop' },
          expected: { appRunning: true, frontmost: true },
          requirements: [
            'fresh_receipt',
            'requested_app_is_photoshop',
            'resolved_photoshop_identity',
            'same_pid_as_prior_app_receipt',
            'app_running',
            'frontmost',
          ],
        });
        continue;
      }
      predicateInputs.push(
        {
          stage: 'verify_before_action',
          actionIndex: mutation.index,
          role: 'photoshop_create_foreground_precondition_verified',
          tool: 'desktop.observe_app',
          args: { appName: 'Photoshop' },
          expected: { appRunning: true, frontmost: true },
          requirements: [
            'fresh_receipt',
            'requested_app_is_photoshop',
            'resolved_photoshop_identity',
            'same_pid_as_prior_app_receipt',
            'app_running',
            'frontmost',
          ],
        },
        {
          stage: 'verify_after_action',
          actionIndex: mutation.index,
          role: 'photoshop_created_document_receipt_verified',
          tool: 'desktop.photoshop_document_status',
          args: { appName: 'Photoshop' },
          expected: {
            appRunning: true,
            widthPx: dimensions.widthPx,
            heightPx: dimensions.heightPx,
          },
          requirements: [
            'fresh_receipt',
            'create_receipt_created_true',
            'create_receipt_document_name_present',
            'create_receipt_document_count_present',
            'document_count_increased_from_baseline',
            'active_document_name_matches_create_receipt',
            'dimensions_match_request',
          ],
        },
      );
    }
    const predicates = Object.freeze(predicateInputs.map(freezeProjectedPredicate));
    const initialObservedState = Object.freeze({
      appRunning: observation.appRunning,
      appFrontmost: observation.appFrontmost,
    });
    return Object.freeze({
      schemaVersion: 1 as const,
      projectionOnly: true as const,
      programId: 'photoshop_new_document' as const,
      requestedDimensions: Object.freeze({ ...dimensions }),
      observedState: initialObservedState,
      predicates,
      mutations,
    });
  } catch {
    return null;
  }
}

function exactPlainDataEqual(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(expected)) {
    const actualItems = readExactOwnDataArray(actual, expected.length);
    if (!actualItems) return false;
    return expected.every((item, index) => exactPlainDataEqual(actualItems[index], item));
  }
  if (!expected || typeof expected !== 'object') return false;
  const expectedPrototype = Object.getPrototypeOf(expected);
  if (expectedPrototype !== Object.prototype && expectedPrototype !== null) return false;
  const keys = Object.keys(expected);
  const actualRecord = readExactOwnDataRecord(actual, keys);
  if (!actualRecord) return false;
  const expectedRecord = expected as Record<string, unknown>;
  return keys.every((key) => exactPlainDataEqual(actualRecord[key], expectedRecord[key]));
}

function photoshopProjectionBranch(
  observedState: PhotoshopNewDocumentObservedState,
): PhotoshopNewDocumentProjectionBranch {
  if (!observedState.appRunning) return 'app_stopped';
  return observedState.appFrontmost ? 'app_frontmost' : 'app_background';
}

function canonicalPhotoshopHandlerArgs(
  mutation: ComputerSequenceProjectedMutation,
  dimensions: Readonly<{ widthPx: number; heightPx: number }>,
): Readonly<Record<string, unknown>> | null {
  if (mutation.tool === 'desktop.launch_app' || mutation.tool === 'desktop.focus_app') {
    return Object.freeze({ appName: 'Photoshop' });
  }
  if (mutation.tool === 'desktop.photoshop_create_document') {
    return Object.freeze({
      appName: 'Photoshop',
      widthPx: dimensions.widthPx,
      heightPx: dimensions.heightPx,
    });
  }
  return null;
}

async function buildUniqueSequenceFingerprint(input: {
  fingerprint: ComputerSequenceFingerprintBuilder;
  contract: unknown;
  seen: Set<string>;
}): Promise<string | null> {
  const value = await input.fingerprint(input.contract);
  if (!COMPUTER_SEQUENCE_SHA256_RE.test(value) || input.seen.has(value)) return null;
  input.seen.add(value);
  return value;
}

/**
 * Convert the exact observed-state mutation projection into immutable,
 * value-free requirements for a future universal-root/section-26 gateway.
 * The returned shape is structurally unusable as either a root acceptance or
 * a bound dispatch. It does not bind, claim, dispatch, authorize, or prove an
 * action. All identity comes from the injected fingerprint builder; no digest
 * is synthesized locally.
 *
 * The observed booleans select one canonical branch only. They are never
 * accepted as execution proof: every branch retains fresh observe_app and
 * Photoshop status predicates, including same-PID/frontmost checks and the
 * create-receipt/document-count-delta requirements.
 */
export async function buildPhotoshopNewDocumentRootProjectionDraft(input: {
  program: ComputerSequenceProgram;
  projection: PhotoshopNewDocumentMutationProjection;
  requestIdentityFingerprint: string;
  programFingerprint: string;
  fingerprint: ComputerSequenceFingerprintBuilder;
}): Promise<PhotoshopNewDocumentRootProjectionDraft | null> {
  try {
    const envelope = readExactOwnDataRecord(input, [
      'program',
      'projection',
      'requestIdentityFingerprint',
      'programFingerprint',
      'fingerprint',
    ]);
    if (!envelope || typeof envelope.fingerprint !== 'function') return null;
    const requestIdentityFingerprint = envelope.requestIdentityFingerprint;
    const programFingerprint = envelope.programFingerprint;
    if (
      typeof requestIdentityFingerprint !== 'string'
      || typeof programFingerprint !== 'string'
      || !COMPUTER_SEQUENCE_SHA256_RE.test(requestIdentityFingerprint)
      || !COMPUTER_SEQUENCE_SHA256_RE.test(programFingerprint)
      || requestIdentityFingerprint === programFingerprint
    ) return null;

    const program = envelope.program as ComputerSequenceProgram;
    const dimensions = canonicalPhotoshopProgramDimensions(program);
    if (!dimensions) return null;
    const suppliedProjectionRecord = readExactOwnDataRecord(envelope.projection, [
      'schemaVersion',
      'projectionOnly',
      'programId',
      'requestedDimensions',
      'observedState',
      'predicates',
      'mutations',
    ]);
    if (!suppliedProjectionRecord) return null;
    const suppliedObservation = readExactOwnDataRecord(
      suppliedProjectionRecord.observedState,
      ['appRunning', 'appFrontmost'],
    );
    if (
      !suppliedObservation
      || typeof suppliedObservation.appRunning !== 'boolean'
      || typeof suppliedObservation.appFrontmost !== 'boolean'
    ) return null;
    const observedState: PhotoshopNewDocumentObservedState = Object.freeze({
      appRunning: suppliedObservation.appRunning,
      appFrontmost: suppliedObservation.appFrontmost,
    });
    const canonicalProjection = projectPhotoshopNewDocumentMutations(program, observedState);
    if (
      !canonicalProjection
      || !exactPlainDataEqual(envelope.projection, canonicalProjection)
    ) return null;

    const fingerprint = envelope.fingerprint as ComputerSequenceFingerprintBuilder;
    const recomputedProgramFingerprint = await fingerprint(
      buildComputerSequenceProgramManifest(program),
    );
    if (recomputedProgramFingerprint !== programFingerprint) return null;

    const projectionBranch = photoshopProjectionBranch(observedState);
    const seen = new Set<string>([requestIdentityFingerprint, programFingerprint]);
    const sharedIdentity = Object.freeze({
      requestIdentityFingerprint,
      programFingerprint,
      programId: 'photoshop_new_document' as const,
      projectionBranch,
      requestedDimensions: Object.freeze({ ...dimensions }),
    });

    const predicateRequirements: ComputerSequencePredicateRequirement[] = [];
    for (let index = 0; index < canonicalProjection.predicates.length; index += 1) {
      const contract = canonicalProjection.predicates[index];
      const predicateFingerprint = await buildUniqueSequenceFingerprint({
        fingerprint,
        seen,
        contract: {
          schemaVersion: 1,
          namespace: 'computer_sequence_projection_predicate',
          projectionOnly: true,
          ...sharedIdentity,
          predicateIndex: index,
          predicateContract: contract,
        },
      });
      if (!predicateFingerprint) return null;
      predicateRequirements.push(Object.freeze({
        index,
        contractRequirementFingerprint: predicateFingerprint,
        stage: contract.stage,
        actionIndex: contract.actionIndex,
        role: contract.role,
        observerTool: contract.tool,
        requirements: Object.freeze([...contract.requirements]),
      }));
    }

    const authorizationMode = program.authorization.mode;
    const authorizationCategory = authorizationMode === 'direct_user_request'
      ? 'direct_request' as const
      : 'plan_approval' as const;
    if (
      canonicalProjection.mutations.some(
        (mutation) => mutation.authorizationCategory !== authorizationCategory,
      )
    ) return null;
    const authorizationPolicyRequirement = Object.freeze({
      mode: authorizationMode,
      category: authorizationCategory,
      trustedAuthorizationReceiptRequired: true as const,
      chatPlanApprovalRequired: authorizationMode === 'chat_plan_approval',
    });

    const actionRequirements: ComputerSequenceActionRequirement[] = [];
    const dispatchRequirements: ComputerSequenceRequiredDispatchRequirement[] = [];
    for (const mutation of canonicalProjection.mutations) {
      const relevantPredicates = predicateRequirements.filter((requirement) => (
        requirement.actionIndex === null
        || requirement.actionIndex <= mutation.index
      ));
      const verifierPredicateRequirementFingerprints = Object.freeze(
        relevantPredicates.map((requirement) => requirement.contractRequirementFingerprint),
      );
      const proofReceiptRequirements = Object.freeze(Array.from(new Set(
        relevantPredicates.flatMap((requirement) => requirement.requirements),
      )));
      const normalizedHandlerArgs = canonicalPhotoshopHandlerArgs(mutation, dimensions);
      if (!normalizedHandlerArgs) return null;
      const toolArgsFingerprint = await fingerprint(normalizedHandlerArgs);
      if (
        !COMPUTER_SEQUENCE_SHA256_RE.test(toolArgsFingerprint)
        || seen.has(toolArgsFingerprint)
      ) return null;
      seen.add(toolArgsFingerprint);
      const actionIdentity = Object.freeze({
        ...sharedIdentity,
        actionIndex: mutation.index,
        tool: mutation.tool,
        toolArgsFingerprint,
        mutatesState: mutation.mutatesState,
        requiresForegroundLease: mutation.requiresForegroundLease,
      });
      const authorizationRequirementFingerprint = await buildUniqueSequenceFingerprint({
        fingerprint,
        seen,
        contract: {
          schemaVersion: 1,
          namespace: 'computer_sequence_projection_authorization',
          ...actionIdentity,
          authorizationPolicyRequirement,
          requiredMutationAuthority: mutation.requiredMutationAuthority,
        },
      });
      if (!authorizationRequirementFingerprint) return null;
      const callIdentityRequirementFingerprint = await buildUniqueSequenceFingerprint({
        fingerprint,
        seen,
        contract: {
          schemaVersion: 1,
          namespace: 'computer_sequence_projection_call_identity',
          ...actionIdentity,
          authorizationRequirementFingerprint,
        },
      });
      if (!callIdentityRequirementFingerprint) return null;
      const policyBindingRequirementFingerprint = await buildUniqueSequenceFingerprint({
        fingerprint,
        seen,
        contract: {
          schemaVersion: 1,
          namespace: 'computer_sequence_projection_policy_binding',
          ...actionIdentity,
          authorizationPolicyRequirement,
          authorizationRequirementFingerprint,
          requiredMutationAuthority: mutation.requiredMutationAuthority,
          foregroundLeaseRequiredBeforeDispatch: true,
        },
      });
      if (!policyBindingRequirementFingerprint) return null;
      const verifierBindingRequirementFingerprint = await buildUniqueSequenceFingerprint({
        fingerprint,
        seen,
        contract: {
          schemaVersion: 1,
          namespace: 'computer_sequence_projection_verifier_binding',
          ...actionIdentity,
          verifierPredicateRole: mutation.verifierPredicateRole,
          verifierPredicateRequirementFingerprints,
          proofReceiptRequirements,
        },
      });
      if (!verifierBindingRequirementFingerprint) return null;
      const replayBindingRequirementFingerprint = await buildUniqueSequenceFingerprint({
        fingerprint,
        seen,
        contract: {
          schemaVersion: 1,
          namespace: 'computer_sequence_projection_replay_binding',
          ...actionIdentity,
          callIdentityRequirementFingerprint,
          replayPolicy: 'never_redispatch_after_dispatched_or_outcome_unknown',
          outcomeUnknownRecovery: 'verification_only',
        },
      });
      if (!replayBindingRequirementFingerprint) return null;

      actionRequirements.push(Object.freeze({
        actionIndex: mutation.index,
        tool: mutation.tool,
        toolArgsFingerprint,
        authorizationRequirementFingerprint,
        authorizationReceiptStatus: 'required' as const,
        proofReceiptStatus: 'required' as const,
        mutatesState: true as const,
        requiresForegroundLease: true as const,
      }));
      dispatchRequirements.push(Object.freeze({
        projectionOnly: true as const,
        readyForDispatchBinding: false as const,
        bindingStatus: 'required' as const,
        actionIndex: mutation.index,
        tool: mutation.tool,
        source: 'compiler' as const,
        callIdentityRequirementFingerprint,
        authorizationCategory,
        authorizationReceiptStatus: 'required' as const,
        proofReceiptStatus: 'required' as const,
        requiredMutationAuthority: 'action_ledger' as const,
        policyBindingRequirementFingerprint,
        verifierBindingRequirementFingerprint,
        replayBindingRequirementFingerprint,
        verifierPredicateRequirementFingerprints,
        proofReceiptRequirements,
      }));
    }

    const frozenPredicateRequirements = Object.freeze([...predicateRequirements]);
    const frozenPredicateRequirementFingerprints = Object.freeze(
      frozenPredicateRequirements.map((requirement) => requirement.contractRequirementFingerprint),
    );
    const frozenActionRequirements = Object.freeze([...actionRequirements]);
    const acceptanceRequirements = Object.freeze({
      predicateRequirementFingerprints: frozenPredicateRequirementFingerprints,
      actionRequirements: frozenActionRequirements,
    });
    return Object.freeze({
      schemaVersion: 1 as const,
      projectionOnly: true as const,
      readyForRootBinding: false as const,
      programId: 'photoshop_new_document' as const,
      requestIdentityFingerprint,
      programFingerprint,
      projectionBranch,
      authorizationPolicyRequirement,
      predicateRequirements: frozenPredicateRequirements,
      acceptanceRequirements,
      requiredDispatchRequirements: Object.freeze([...dispatchRequirements]),
    });
  } catch {
    return null;
  }
}

/** Photoshop from-scratch document creation: "open photoshop and start a new
 *  project 600 x 600" and phrasing variants. */
function compilePhotoshopNewDocument(task: string): ComputerSequenceProgram | null {
  const command = unwrapDirectDesktopCommand(task);
  if (!command) return null;
  if (!PHOTOSHOP_RE.test(command)) return null;
  // Dimensions may appear between the creation verb and artifact noun
  // ("create a 600 x 600 document"). Remove that one bounded value before
  // matching the same new-document grammar; exact dimensions are parsed and
  // validated below.
  if (!NEW_DOC_RE.test(command.replace(DIMENSIONS_RE, ' '))) return null;
  if (!hasOnlyExactNewDocumentLanguage(command)) return null;
  const dims = command.match(DIMENSIONS_RE);
  if (!dims) return null;
  const widthPx = clampDimension(dims[1]);
  const heightPx = clampDimension(dims[2]);
  if (widthPx === null || heightPx === null) return null;

  return buildPhotoshopNewDocumentProgram(widthPx, heightPx);
}

/**
 * Compile a task message into a deterministic tool program, or null when the
 * ask is not one of the supported 1:1 families (normal planning then runs).
 * Total: never throws on any input.
 */
export function compileComputerSequenceProgram(
  task: string | null | undefined,
): ComputerSequenceProgram | null {
  try {
    const text = String(task || '').trim();
    if (!text || text.length > 4000) return null;
    return compilePhotoshopNewDocument(text);
  } catch {
    return null;
  }
}
