import type { ChatComputerHandoffMetadata } from './chatComputerHandoffContext';

export type ChatDesignTaskCardTone =
  | 'ready'
  | 'approval'
  | 'attention'
  | 'complete'
  | 'superseded'
  | 'historical';
export type ChatDesignTaskTimelineDisposition = 'current' | 'superseded' | 'historical';
export type ChatDesignTaskCardPhaseState = 'done' | 'current' | 'blocked' | 'pending';
export type ChatDesignTaskCardPhaseId =
  | 'resolve'
  | 'inspect'
  | 'edit'
  | 'verify'
  | 'handoff'
  | 'status'
  | 'prepare'
  | 'create';

export interface ChatDesignTaskCardPhase {
  id: ChatDesignTaskCardPhaseId;
  label: string;
  state: ChatDesignTaskCardPhaseState;
  detail: string;
}

export interface ChatDesignTaskCardModel {
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: ChatDesignTaskCardTone;
  operations: string[];
  proofSignals: string[];
  reviewChecklist: string[];
  nextAction: string;
  phases: ChatDesignTaskCardPhase[];
  packageSummary?: string;
  creativeAiSummary?: string;
  blockerSummary?: string;
  /** Timeline reconciliation result applied to this presentation model. */
  timelineDisposition?: ChatDesignTaskTimelineDisposition;
  /** False means retry/recovery/approval controls must not render for this row. */
  timelineActionsEnabled?: boolean;
  /**
   * Timeline-only presentation state. The original message and its evidence
   * stay in the transcript, but the card must no longer look like a live
   * approval/current step after a later verified run completed the same task.
   */
  isSuperseded?: boolean;
  /** A newer human turn exists, but no exact completion lineage was proven. */
  isHistorical?: boolean;
}

/**
 * Minimal chronological message shape used to reconcile persisted and live
 * design-task cards without coupling this pure module to ChatMessage/React.
 */
export interface ChatDesignTaskTimelineMessage {
  id: string;
  isBot: boolean;
  /**
   * Viewer-relative ownership flag used only as a fallback when an older row
   * lacks the stable author id.
   */
  isUser?: boolean;
  authorId?: string | null;
  content?: string | null;
  runId?: string | null;
  requestId?: string | null;
  /** Durable requester lineage written onto bot metadata. */
  requestAuthorId?: string | null;
  computerTaskStatus?: string | null;
  computerHandoff?: ChatComputerHandoffMetadata | null;
  source?: { surface?: string | null } | null;
}

const COMPLETE_STATUS_RE = /\b(complete|completed|done|success|succeeded|finished)\b/i;
const APPROVAL_STATUS_RE = /\b(approval|review|confirm|permission)\b/i;
const LEGACY_DESKTOP_PLAN_APPROVAL_OR_READY_RE = /\b(?:approval (?:needed|required|pending)|awaiting approval|after (?:one|an) approval|ready (?:for review|to run|for dispatch)|approve desktop run)\b/i;
const LEGACY_DESKTOP_PLAN_CONTROL_RE = /\b(?:approve desktop run|desktop-app path|app-native tools?)\b|\bdesktop\.[a-z][a-z0-9_.-]*/i;
const LEGACY_DESKTOP_PLAN_FAILURE_RE = /\b(?:(?:could not|couldn't|cannot|can't|unable to) (?:finish|complete|execute|run|access)|approval lookup failed|plan was not executed|action blocked before completion)\b|\bdeterministic desktop sequence (?:hit a blocker|[-\u2014]\s*blocked)\b/i;

const OPERATION_LABELS: Record<string, string> = {
  inspect_layers: 'Inspect layers',
  update_text_layers: 'Update text',
  replace_linked_asset: 'Relink assets',
  resize_layout: 'Resize layout',
  toggle_layer_visibility: 'Layer visibility',
  export_proof: 'Export proof',
  package_handoff: 'Package handoff',
  inspect_image_document: 'Inspect image',
  edit_adjustment_layers: 'Adjust layers',
  apply_selection_or_mask: 'Selection/mask',
  generative_fill_or_remove: 'Generative edit',
  generate_ai_asset: 'AI asset',
  generative_expand_asset: 'Generative expand',
  create_creative_variants: 'Creative variants',
  export_raster_proof: 'Export raster',
};

function cleanText(value: unknown): string {
  return String(value || '').trim();
}

function titleCaseTaskKind(value: string): string {
  return value
    .split(/[_\s-]+/)
    .map((part) => part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : '')
    .filter(Boolean)
    .join(' ');
}

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean))).slice(0, max);
}

function normalizedIdentityText(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\u00d7]/g, 'x')
    .replace(/\s*x\s*(?=\d)/g, 'x')
    .replace(/\s+/g, ' ');
}

function statusText(metadata: ChatComputerHandoffMetadata): string {
  return [
    metadata.preflightStatus,
    metadata.preflightSummary,
    metadata.groundingStatus,
    metadata.groundingSummary,
    metadata.approvalSummary,
  ].map(cleanText).filter(Boolean).join(' ');
}

function hasCompleteStatus(metadata: ChatComputerHandoffMetadata): boolean {
  return COMPLETE_STATUS_RE.test(statusText(metadata));
}

function hasApprovalStatus(metadata: ChatComputerHandoffMetadata): boolean {
  return Boolean(metadata.approvalSummary) || APPROVAL_STATUS_RE.test(statusText(metadata));
}

/**
 * Narrow fallback for pre-metadata persisted desktop-plan rows. This is only
 * enough to age an old row to Historical after a newer human turn; text can
 * never prove completion or exact supersession.
 */
function isLegacyActionableDesktopPlanMessage(
  message: ChatDesignTaskTimelineMessage,
): boolean {
  if (!message.isBot || message.computerHandoff) return false;
  const content = cleanText(message.content);
  if (!content) return false;
  const status = normalizedIdentityText(message.computerTaskStatus);
  if (/\b(?:blocked|failed|failure|error|cancelled|partial)\b|\b(?:outcome|needs)[_ ](?:unknown|input)\b/.test(status)) return false;
  if (LEGACY_DESKTOP_PLAN_FAILURE_RE.test(content)) return false;
  return LEGACY_DESKTOP_PLAN_APPROVAL_OR_READY_RE.test(content)
    && LEGACY_DESKTOP_PLAN_CONTROL_RE.test(content);
}

function shouldHideQuietDesignTaskCard(metadata: ChatComputerHandoffMetadata): boolean {
  const notice = metadata.requestNotice;
  if (!notice) return false;
  return notice.visibility === 'hidden'
    && notice.autonomy.canRunQuietly
    && !metadata.approvalSummary
    && !metadata.browserPlanId;
}

function phase(
  id: ChatDesignTaskCardPhaseId,
  label: string,
  state: ChatDesignTaskCardPhaseState,
  detail: string,
): ChatDesignTaskCardPhase {
  return { id, label, state, detail };
}

function packageSummary(metadata: ChatComputerHandoffMetadata): string | undefined {
  const pkg = metadata.desktopAttachmentPackage;
  if (!pkg) return undefined;
  const parts = [
    `${pkg.fileCount} file${pkg.fileCount === 1 ? '' : 's'}`,
    `${pkg.primaryFileCount} primary`,
    pkg.sha256Count ? `${pkg.sha256Count} hashed` : null,
  ].filter(Boolean);
  return parts.join(', ');
}

function creativeAiSummary(metadata: ChatComputerHandoffMetadata): string | undefined {
  const recipes = uniqueCompact((metadata.designCreativeAi?.recipes || []).map((recipe) => recipe.label), 2);
  if (recipes.length > 0) return recipes.join(' + ');
  return uniqueCompact(metadata.designCreativeAi?.userVisibleOptions || [], 1)[0];
}

function buildReviewChecklist(design: NonNullable<ChatComputerHandoffMetadata['designAppTask']>): string[] {
  const operations = new Set(design.operations);
  const checklist: string[] = [];
  if (design.appId === 'adobe_photoshop') {
    checklist.push('Layer inventory matches requested edits');
    if (operations.has('apply_selection_or_mask') || operations.has('generative_fill_or_remove')) {
      checklist.push('Selection/mask target is verified before localized edits');
    }
    if (operations.has('generate_ai_asset') || operations.has('generative_expand_asset') || operations.has('create_creative_variants')) {
      checklist.push('AI output has prompt approval, receipt, and proof evidence');
    }
    if (operations.has('replace_linked_asset')) {
      checklist.push('Placed asset or smart object is verified after insertion');
    }
    if (operations.has('export_raster_proof')) {
      checklist.push('Raster proof exists with expected format and dimensions');
    }
    checklist.push('No unexpected locked/hidden layer blockers remain');
  } else {
    checklist.push('Text inventory matches requested copy');
    if (operations.has('replace_linked_asset')) {
      checklist.push('Placed links/assets are relinked and verified');
    }
    if (operations.has('generate_ai_asset') || operations.has('generative_expand_asset') || operations.has('create_creative_variants')) {
      checklist.push('Creative AI output has target-frame, receipt, and proof evidence');
    }
    checklist.push('No unexpected missing fonts, links, or overset text remain');
    if (operations.has('export_proof')) {
      checklist.push('Proof PDF exists and reflects the current layout');
    }
    if (operations.has('package_handoff')) {
      checklist.push('Package folder includes links, fonts, report, and source file');
    }
  }
  return uniqueCompact(checklist, 4);
}

function isExactPhotoshopBlankDocument(
  metadata: ChatComputerHandoffMetadata,
  design: NonNullable<ChatComputerHandoffMetadata['designAppTask']>,
): boolean {
  const pipeline = metadata.designExecutionPipeline;
  return design.appId === 'adobe_photoshop'
    && pipeline?.mutationTools.length === 1
    && pipeline.mutationTools[0] === 'desktop.photoshop_create_document'
    && pipeline.requiredToolSequence.includes('desktop.photoshop_document_status')
    && !pipeline.requiredToolSequence.some((tool) => (
      tool === 'desktop.file_search'
      || tool === 'desktop.file_stat'
      || tool === 'desktop.open_path'
      || tool === 'desktop.photoshop_layer_inventory'
    ));
}

function buildExactPhotoshopBlankDocumentCard(
  metadata: ChatComputerHandoffMetadata,
  design: NonNullable<ChatComputerHandoffMetadata['designAppTask']>,
): ChatDesignTaskCardModel {
  const blockers = uniqueCompact(metadata.blockers, 2);
  const warnings = uniqueCompact(metadata.warnings, 2);
  const outcomeStatus = cleanText(metadata.outcomeStatus).toLowerCase();
  const complete = hasCompleteStatus(metadata) || /^(?:complete|completed|success|succeeded)$/.test(outcomeStatus);
  const blocked = metadata.blockerCount > 0 || /^(?:blocked|failed|partial|outcome_unknown)$/.test(outcomeStatus);
  const exactProgramDeclaresApproval = design.approvalGates.length > 0;
  const awaitingApproval = !blocked && (
    outcomeStatus === 'waiting_approval'
    || outcomeStatus === 'awaiting_approval'
    || (exactProgramDeclaresApproval && hasApprovalStatus(metadata))
  );
  const proofSignals = uniqueCompact(design.verificationSignals, 3);
  const pipelineNextAction = cleanText(metadata.designExecutionPipeline?.nextVisibleAction);

  const statusTone: ChatDesignTaskCardTone = blocked
    ? 'attention'
    : awaitingApproval
      ? 'approval'
      : complete
        ? 'complete'
        : 'ready';
  const statusLabel = blocked
    ? 'Needs attention'
    : awaitingApproval
      ? 'Approval needed'
      : complete
        ? 'Complete'
        : 'Ready';
  const nextAction = blockers[0]
    ? `Resolve: ${blockers[0]}`
    : awaitingApproval
      ? metadata.approvalSummary || uniqueCompact(design.approvalGates, 1)[0] || 'Approve the exact blank-document run.'
      : metadata.groundingSummary
        || metadata.preflightSummary
        || pipelineNextAction
        || 'Read Photoshop status, then continue through the exact program.';

  const exactPhaseState = (
    id: 'status' | 'prepare' | 'create' | 'verify',
  ): ChatDesignTaskCardPhaseState => {
    if (complete) return 'done';
    if (blocked) return id === 'status' ? 'blocked' : 'pending';
    if (awaitingApproval) return id === 'create' ? 'current' : 'pending';
    return id === 'status' ? 'current' : 'pending';
  };

  return {
    title: design.appName,
    subtitle: 'Blank Document',
    statusLabel,
    statusTone,
    operations: ['Create blank document'],
    proofSignals,
    // The exact program creates a from-scratch blank document. Layer, mask,
    // source-file, export, and handoff review belong to edit-file pipelines
    // and must not leak into this card.
    reviewChecklist: [],
    nextAction,
    blockerSummary: blockers[0] || warnings[0],
    phases: [
      phase('status', 'Status', exactPhaseState('status'), 'Read app-native Photoshop status.'),
      phase('prepare', 'Prepare', exactPhaseState('prepare'), 'Launch only when Photoshop is not running.'),
      phase('create', 'Create', exactPhaseState('create'), 'Create the requested blank document.'),
      phase('verify', 'Verify', exactPhaseState('verify'), proofSignals[0] || 'Verify the active document dimensions.'),
    ],
  };
}

export function buildChatDesignTaskCardModel(
  metadata?: ChatComputerHandoffMetadata | null,
): ChatDesignTaskCardModel | null {
  const design = metadata?.designAppTask || null;
  if (!metadata || !design) return null;
  if (shouldHideQuietDesignTaskCard(metadata)) return null;
  if (isExactPhotoshopBlankDocument(metadata, design)) {
    return buildExactPhotoshopBlankDocumentCard(metadata, design);
  }

  const complete = hasCompleteStatus(metadata);
  const blocked = metadata.blockerCount > 0;
  const approval = !blocked && hasApprovalStatus(metadata);
  const inspected = Boolean(metadata.preflightStatus || metadata.groundingStatus || metadata.preflightSummary || metadata.groundingSummary);
  const operations = uniqueCompact(design.operations.map((operation) => OPERATION_LABELS[operation] || titleCaseTaskKind(operation)), 7);
  const proofSignals = uniqueCompact(design.verificationSignals, 3);
  const reviewChecklist = metadata.designProofReview?.checklist.length
    ? uniqueCompact(metadata.designProofReview.checklist, 4)
    : buildReviewChecklist(design);
  const blockers = uniqueCompact(metadata.blockers, 2);
  const warnings = uniqueCompact(metadata.warnings, 2);
  const firstInventory = uniqueCompact(design.requiredInventory, 1)[0];
  const firstProof = proofSignals[0];
  const pipelineNextAction = cleanText(metadata.designExecutionPipeline?.nextVisibleAction);

  const statusTone: ChatDesignTaskCardTone = blocked
    ? 'attention'
    : approval
      ? 'approval'
      : complete
        ? 'complete'
        : 'ready';
  const statusLabel = blocked
    ? 'Needs attention'
    : approval
      ? 'Approval needed'
      : complete
        ? 'Complete'
        : inspected
          ? 'Ready'
          : 'Staged';

  const nextAction = blockers[0]
    ? `Resolve: ${blockers[0]}`
    : approval
      ? metadata.approvalSummary || uniqueCompact(design.approvalGates, 1)[0] || 'Review before changing the document.'
      : metadata.groundingSummary || metadata.preflightSummary || pipelineNextAction || firstInventory || 'Run document status before editing.';

  return {
    title: design.appName,
    subtitle: titleCaseTaskKind(design.taskKind || 'design task'),
    statusLabel,
    statusTone,
    operations,
    proofSignals,
    reviewChecklist,
    nextAction,
    packageSummary: packageSummary(metadata),
    creativeAiSummary: creativeAiSummary(metadata),
    blockerSummary: blockers[0] || warnings[0],
    phases: [
      phase(
        'resolve',
        'Resolve file',
        metadata.desktopAttachmentPackage || inspected || complete ? 'done' : 'current',
        packageSummary(metadata) || 'Find the source document.',
      ),
      phase(
        'inspect',
        'Inspect',
        blocked ? 'blocked' : complete || inspected || approval ? 'done' : 'current',
        firstInventory || 'Document inventory.',
      ),
      phase(
        'edit',
        'Edit',
        blocked ? 'blocked' : complete ? 'done' : approval ? 'current' : inspected ? 'current' : 'pending',
        operations.join(', ') || 'Requested changes.',
      ),
      phase(
        'verify',
        'Verify',
        complete ? 'done' : blocked ? 'blocked' : 'pending',
        firstProof || 'Proof output.',
      ),
      phase(
        'handoff',
        'Handoff',
        complete ? 'done' : approval ? 'current' : blocked ? 'blocked' : 'pending',
        uniqueCompact(design.approvalGates, 1)[0] || 'Save/export checkpoint.',
      ),
    ],
  };
}

function neutralizeActionablePhases(
  phases: ChatDesignTaskCardPhase[],
): ChatDesignTaskCardPhase[] {
  return phases.map((item) => ({
    ...item,
    state: item.state === 'current' || item.state === 'blocked' ? 'pending' : item.state,
  }));
}

/**
 * Applies timeline-only presentation without mutating the underlying message
 * or discarding its proof/review evidence. Historical and superseded rows are
 * explicitly non-actionable so Chat can hide retry, approval, and recovery UI.
 */
export function applyChatDesignTaskTimelineDisposition(
  model: ChatDesignTaskCardModel,
  disposition: ChatDesignTaskTimelineDisposition,
): ChatDesignTaskCardModel {
  if (disposition === 'current') {
    return {
      ...model,
      timelineDisposition: 'current',
      timelineActionsEnabled: true,
      isSuperseded: false,
      isHistorical: false,
    };
  }

  const superseded = disposition === 'superseded';
  return {
    ...model,
    statusLabel: superseded ? 'Superseded' : 'Historical',
    statusTone: superseded ? 'superseded' : 'historical',
    nextAction: superseded
      ? 'A later verified completion replaced this pending plan.'
      : 'This plan belongs to an earlier chat turn.',
    phases: neutralizeActionablePhases(model.phases),
    timelineDisposition: disposition,
    timelineActionsEnabled: false,
    isSuperseded: superseded,
    isHistorical: !superseded,
  };
}

/** Compatibility wrapper for existing Chat callers. */
export function supersedeChatDesignTaskCardModel(
  model: ChatDesignTaskCardModel,
): ChatDesignTaskCardModel {
  return applyChatDesignTaskTimelineDisposition(model, 'superseded');
}

type ExactDesignTaskLineage = {
  runIds: string[];
  requestIds: string[];
};

function immutableLineageId(value: unknown): string | null {
  const candidate = String(value || '').trim();
  return candidate || null;
}

function exactDesignTaskLineage(
  message: ChatDesignTaskTimelineMessage,
): ExactDesignTaskLineage {
  const runIds = Array.from(new Set([
    immutableLineageId(message.runId),
    immutableLineageId(message.computerHandoff?.runId),
  ].filter((value): value is string => Boolean(value))));
  const requestIds = Array.from(new Set([
    immutableLineageId(message.requestId),
  ].filter((value): value is string => Boolean(value))));
  return { runIds, requestIds };
}

function sharesExactDesignTaskLineage(
  current: ExactDesignTaskLineage,
  completed: ExactDesignTaskLineage,
): boolean {
  if (current.runIds.some((runId) => completed.runIds.includes(runId))) return true;
  return current.requestIds.some((requestId) => completed.requestIds.includes(requestId));
}

function hasVerifiedDesignTaskCompletion(
  message: ChatDesignTaskTimelineMessage,
  lineage: ExactDesignTaskLineage,
): boolean {
  if (!message.isBot || normalizedIdentityText(message.computerTaskStatus) !== 'completed') return false;
  if (message.computerHandoff) {
    if (normalizedIdentityText(message.computerHandoff.outcomeStatus) !== 'completed') return false;
    const fullCard = buildChatDesignTaskCardModel(message.computerHandoff);
    if (fullCard) return fullCard.statusTone === 'complete';
    // Deployments that still enforce the legacy 1,000-character message cap
    // persist a status/lineage-only handoff. Accept that narrow shape only
    // from Chat's canonical computer-task surface and only when immutable run
    // or explicit request lineage is present; truncated prose alone is never
    // completion proof.
    return normalizedIdentityText(message.source?.surface) === 'main_chat_computer_task'
      && (lineage.runIds.length > 0 || lineage.requestIds.length > 0);
  }
  // Successful exact computer turns intentionally hide their verbose handoff
  // on the compact completion row. The structured terminal status is still
  // runtime-owned, but accept the handoff-free shape only from Chat's canonical
  // computer-task surface; arbitrary bot prose or another surface is not proof.
  return normalizedIdentityText(message.source?.surface) === 'main_chat_computer_task';
}

/**
 * Classifies design-task rows without comparing prompt wording or inferred
 * task structure. `superseded` requires exact immutable lineage: a shared run
 * id or explicit provider/client request id. A shared chat-turn id is not task
 * lineage because one human turn may dispatch multiple app tasks. When exact lineage is unavailable,
 * a newer turn from the same stable human author only makes an old actionable card `historical`.
 * Input must be chronological (oldest first), matching Chat's `messages` array.
 */
export function classifyChatDesignTaskTimeline(
  messages: ChatDesignTaskTimelineMessage[],
): Map<string, ChatDesignTaskTimelineDisposition> {
  const stableHumanAuthors = new Set(
    messages
      .filter((message) => !message.isBot)
      .map((message) => immutableLineageId(message.authorId))
      .filter((authorId): authorId is string => Boolean(authorId)),
  );
  // Legacy rows have no requester stamped on the bot response. Nearest-human
  // inference is only safe in a transcript with one known author; in a shared
  // interleaved thread it must fail open (Current) instead of disabling the
  // wrong member's approval/action card.
  const canInferLegacyRequestOwner = stableHumanAuthors.size <= 1;
  const requestOwnerByIndex: Array<string | null> = [];
  let requestOwner: string | null = null;
  for (const message of messages) {
    if (!message.isBot) {
      const authorId = immutableLineageId(message.authorId);
      requestOwner = authorId || (message.isUser === true ? 'viewer:self' : null);
    }
    requestOwnerByIndex.push(message.isBot
      ? immutableLineageId(message.requestAuthorId)
        || (canInferLegacyRequestOwner ? requestOwner : null)
      : requestOwner);
  }

  const laterCompletions: ExactDesignTaskLineage[] = [];
  const dispositions = new Map<string, ChatDesignTaskTimelineDisposition>();
  const newerHumanOwners = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.isBot) {
      const owner = requestOwnerByIndex[index];
      if (owner) newerHumanOwners.add(owner);
      continue;
    }
    const requestOwnerForMessage = requestOwnerByIndex[index];
    const newerSameAuthorTurnExists = Boolean(
      requestOwnerForMessage && newerHumanOwners.has(requestOwnerForMessage),
    );
    const lineage = exactDesignTaskLineage(message);
    const verifiedCompletion = hasVerifiedDesignTaskCompletion(message, lineage);
    if (verifiedCompletion) {
      laterCompletions.push(lineage);
    }
    const card = buildChatDesignTaskCardModel(message.computerHandoff);
    if (!card) {
      if (isLegacyActionableDesktopPlanMessage(message)) {
        dispositions.set(message.id, newerSameAuthorTurnExists ? 'historical' : 'current');
      }
      continue;
    }

    const actionable = card.statusTone === 'ready' || card.statusTone === 'approval';
    let disposition: ChatDesignTaskTimelineDisposition = 'current';
    if (
      actionable
      && laterCompletions.some((completed) => sharesExactDesignTaskLineage(lineage, completed))
    ) {
      disposition = 'superseded';
    } else if (actionable && newerSameAuthorTurnExists) {
      disposition = 'historical';
    }
    dispositions.set(message.id, disposition);
  }
  return dispositions;
}

/** Compatibility projection for callers that only understand supersession. */
export function findSupersededChatDesignTaskMessageIds(
  messages: ChatDesignTaskTimelineMessage[],
): Set<string> {
  return new Set(
    Array.from(classifyChatDesignTaskTimeline(messages))
      .filter(([, disposition]) => disposition === 'superseded')
      .map(([messageId]) => messageId),
  );
}
