import type { ChatComputerHandoffMetadata } from './chatComputerHandoffContext';

export type ChatDesignTaskCardTone = 'ready' | 'approval' | 'attention' | 'complete';
export type ChatDesignTaskCardPhaseState = 'done' | 'current' | 'blocked' | 'pending';
export type ChatDesignTaskCardPhaseId = 'resolve' | 'inspect' | 'edit' | 'verify' | 'handoff';

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
}

const COMPLETE_STATUS_RE = /\b(complete|completed|done|success|succeeded|finished)\b/i;
const APPROVAL_STATUS_RE = /\b(approval|review|confirm|permission)\b/i;

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

export function buildChatDesignTaskCardModel(
  metadata?: ChatComputerHandoffMetadata | null,
): ChatDesignTaskCardModel | null {
  const design = metadata?.designAppTask || null;
  if (!metadata || !design) return null;
  if (shouldHideQuietDesignTaskCard(metadata)) return null;

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
