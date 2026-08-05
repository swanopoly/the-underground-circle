import {
  buildDesignAppAutomationPlan,
  type DesignAppAutomationAppId,
  type DesignAppAutomationOperation,
  type DesignAppAutomationPlan,
} from './designAppAutomation';

export interface DesignAppProofReviewPlan {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  operations: DesignAppAutomationOperation[];
  reviewTitle: string;
  userVisibleSummary: string;
  checklist: string[];
  requiredEvidence: string[];
  approvalBefore: string[];
  passCriteria: string[];
  failClosedConditions: string[];
  artifactKinds: string[];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function has(operations: DesignAppAutomationOperation[], operation: DesignAppAutomationOperation): boolean {
  return operations.includes(operation);
}

function buildInDesignProofReview(plan: DesignAppAutomationPlan): DesignAppProofReviewPlan {
  const wantsPackage = has(plan.operations, 'package_handoff');
  const wantsProof = has(plan.operations, 'export_proof');
  const creativeAi = has(plan.operations, 'generate_ai_asset') || has(plan.operations, 'generative_expand_asset') || has(plan.operations, 'create_creative_variants');
  return {
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    operations: plan.operations,
    reviewTitle: wantsPackage ? 'InDesign Package Review' : 'InDesign Proof Review',
    userVisibleSummary: wantsPackage
      ? 'Review the updated layout, package folder, links/fonts report, and proof before handoff.'
      : 'Review the updated layout, text/link state, and exported proof before final handoff.',
    checklist: unique([
      'Text inventory matches requested copy.',
      has(plan.operations, 'replace_linked_asset') ? 'Placed links/assets are relinked and verified.' : '',
      creativeAi ? 'Creative AI output has an approved prompt/data source, receipt, and target-frame proof.' : '',
      'No unexpected missing fonts, links, locked layers, or overset text remain.',
      wantsProof ? 'Proof PDF exists, opens, and reflects the current layout.' : '',
      wantsPackage ? 'Package folder includes source document, links, fonts/profiles when allowed, report, and proof reference.' : '',
    ]),
    requiredEvidence: unique([
      'post-change desktop.indesign_document_status',
      'post-change desktop.indesign_text_inventory',
      has(plan.operations, 'replace_linked_asset') ? 'link status after desktop.indesign_relink_asset' : '',
      creativeAi ? 'creative AI generation/data-merge receipt plus generated output file_stat' : '',
      wantsProof ? 'desktop.indesign_export_proof result plus desktop.file_stat for the PDF' : '',
      wantsPackage ? 'desktop.indesign_package_document result plus package folder summary' : '',
      'screenshot or opened proof showing visible layout state',
    ]),
    approvalBefore: unique([
      'editing text frames or layer/object state',
      has(plan.operations, 'replace_linked_asset') ? 'relinking or replacing placed assets' : '',
      creativeAi ? 'AI image generation, generative expand, data merge variants, cloud upload, or generated asset placement' : '',
      wantsProof ? 'exporting proof PDF' : '',
      wantsPackage ? 'packaging production handoff folder' : '',
      'saving over source document',
      'running new scripts/adapters',
    ]),
    passCriteria: unique([
      'requested copy/asset/layout changes appear in inventory and proof evidence',
      creativeAi ? 'generated assets or variants have receipts and proof/file evidence' : '',
      'document status has no unexpected missing fonts, missing links, or overset text',
      wantsProof ? 'proof PDF output exists with non-zero size' : '',
      wantsPackage ? 'package folder exists with expected source/assets/report contents' : '',
    ]),
    failClosedConditions: unique([
      'active document does not match the staged source file',
      creativeAi ? 'creative AI output, data-source mapping, or generated asset receipt is missing when required' : '',
      'missing fonts, missing links, or overset text cannot be resolved safely',
      'target text frame/link/layer is ambiguous',
      'approval is missing for save/export/package/relink/script work',
    ]),
    artifactKinds: unique([
      'document_status',
      'text_inventory',
      has(plan.operations, 'replace_linked_asset') ? 'link_receipt' : '',
      creativeAi ? 'creative_ai_receipt' : '',
      wantsProof ? 'proof_pdf' : '',
      wantsPackage ? 'package_folder_summary' : '',
      'screenshot',
    ]),
  };
}

function buildPhotoshopProofReview(plan: DesignAppAutomationPlan): DesignAppProofReviewPlan {
  const localizedEdit = has(plan.operations, 'apply_selection_or_mask') || has(plan.operations, 'generative_fill_or_remove');
  const wantsRasterProof = has(plan.operations, 'export_raster_proof');
  const creativeAi = has(plan.operations, 'generate_ai_asset') || has(plan.operations, 'generative_expand_asset') || has(plan.operations, 'create_creative_variants');
  return {
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    operations: plan.operations,
    reviewTitle: 'Photoshop Proof Review',
    userVisibleSummary: 'Review the updated layers, mask/selection state, placed assets, and raster proof before final export.',
    checklist: unique([
      'Layer inventory matches requested text, adjustment, asset, and visibility changes.',
      localizedEdit ? 'Selection/mask target is verified before localized or generative edits.' : '',
      creativeAi ? 'Creative AI output has an approved prompt/variant matrix, receipt, and proof.' : '',
      has(plan.operations, 'replace_linked_asset') ? 'Placed asset or smart object is verified after insertion.' : '',
      wantsRasterProof ? 'Raster proof exists with expected format, dimensions, and visual state.' : '',
      'No unexpected locked/hidden layer, missing asset, or color-mode blocker remains.',
    ]),
    requiredEvidence: unique([
      'post-change desktop.photoshop_document_status',
      'post-change desktop.photoshop_layer_inventory',
      localizedEdit ? 'selection or mask state before localized edit' : '',
      creativeAi ? 'creative AI generation receipt, generated output file_stat, and post-placement layer inventory' : '',
      has(plan.operations, 'replace_linked_asset') ? 'desktop.photoshop_place_asset receipt and layer inventory after placement' : '',
      wantsRasterProof ? 'desktop.photoshop_export_proof result plus desktop.file_stat for the raster proof' : '',
      'screenshot or opened proof showing visible image state',
    ]),
    approvalBefore: unique([
      has(plan.operations, 'update_text_layers') ? 'editing text layers' : '',
      has(plan.operations, 'replace_linked_asset') ? 'placing or replacing assets/smart objects' : '',
      localizedEdit ? 'generative fill, content-aware fill, destructive cleanup, or background replacement' : '',
      creativeAi ? 'AI image generation, generative expand, batch variants, cloud upload, or generated asset placement' : '',
      wantsRasterProof ? 'exporting final raster deliverable' : '',
      'saving over source document',
      'running new scripts/actions/adapters',
    ]),
    passCriteria: unique([
      'requested visual/text/asset changes appear in layer inventory and proof evidence',
      creativeAi ? 'generated asset/variant receipts exist and proof shows the approved output' : '',
      'document status has expected dimensions, color mode, and no unexpected missing linked assets',
      localizedEdit ? 'localized edit target was selected or masked before mutation' : '',
      wantsRasterProof ? 'raster proof output exists with non-zero size and expected format' : '',
    ]),
    failClosedConditions: unique([
      'active document does not match the staged source file',
      'selection/mask target is missing for localized edits',
      creativeAi ? 'creative AI prompt, variant matrix, output receipt, or proof evidence is missing when required' : '',
      'target text layer, smart object, or placed asset is ambiguous',
      'approval is missing for destructive, generative, save, export, or script/action work',
    ]),
    artifactKinds: unique([
      'document_status',
      'layer_inventory',
      localizedEdit ? 'selection_mask_receipt' : '',
      creativeAi ? 'creative_ai_receipt' : '',
      has(plan.operations, 'replace_linked_asset') ? 'placed_asset_receipt' : '',
      wantsRasterProof ? 'raster_proof' : '',
      'screenshot',
    ]),
  };
}

export function buildDesignAppProofReviewPlan(task: string): DesignAppProofReviewPlan | null {
  const plan = buildDesignAppAutomationPlan(task);
  if (!plan) return null;
  return plan.appId === 'adobe_photoshop'
    ? buildPhotoshopProofReview(plan)
    : buildInDesignProofReview(plan);
}

export function buildDesignAppProofReviewPromptBlock(task: string): string | null {
  const plan = buildDesignAppProofReviewPlan(task);
  if (!plan) return null;
  return [
    '## Design Proof Review',
    `Review: ${plan.reviewTitle}`,
    `Summary: ${plan.userVisibleSummary}`,
    `Checklist: ${plan.checklist.join(' | ')}`,
    `Required evidence: ${plan.requiredEvidence.join(' | ')}`,
    `Approval before: ${plan.approvalBefore.join(' | ')}`,
    `Pass criteria: ${plan.passCriteria.join(' | ')}`,
    `Fail closed if: ${plan.failClosedConditions.join(' | ')}`,
    `Artifacts: ${plan.artifactKinds.join(' | ')}`,
  ].join('\n');
}
