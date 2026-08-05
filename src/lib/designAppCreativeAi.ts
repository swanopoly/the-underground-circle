import {
  APP_AUTOMATION_RESEARCH_REFS,
  type AppAutomationResearchRef,
} from './appAutomationControlSurfaces';

export type DesignAppCreativeAiAppId = 'adobe_indesign' | 'adobe_photoshop';

export type DesignAppCreativeAiCapabilityId =
  | 'photoshop.generative_fill_or_remove'
  | 'photoshop.generative_expand'
  | 'photoshop.text_to_image_asset'
  | 'photoshop.creative_variations'
  | 'indesign.text_to_image_frame'
  | 'indesign.generative_expand_asset'
  | 'indesign.data_merge_variants'
  | 'firefly.batch_asset_generation';

export interface DesignAppCreativeAiCapability {
  id: DesignAppCreativeAiCapabilityId;
  appId: DesignAppCreativeAiAppId;
  appName: string;
  label: string;
  creativeOutcome: string;
  controlSurface: string;
  requiredInputs: string[];
  requiredEvidence: string[];
  approvalBefore: string[];
  recommendedTools: string[];
  gapTool: string;
  buildoutTrigger: string;
  failClosedRules: string[];
  sourceRefs: AppAutomationResearchRef[];
}

export interface DesignAppCreativeAiPlan {
  appId: DesignAppCreativeAiAppId;
  appName: string;
  capabilities: DesignAppCreativeAiCapability[];
  creativeBriefSignals: string[];
  approvalGates: string[];
  verificationSignals: string[];
  recommendedTools: string[];
  buildoutTriggers: string[];
  failClosedRules: string[];
  sourceRefs: AppAutomationResearchRef[];
}

export type DesignAppCreativeAiRecipeId =
  | 'photoshop.localized_cleanup'
  | 'photoshop.canvas_expansion'
  | 'photoshop.background_asset_pack'
  | 'photoshop.creative_variant_contact_sheet'
  | 'indesign.hero_image_frame'
  | 'indesign.expand_placed_image'
  | 'indesign.data_merge_campaign_variants'
  | 'firefly.batch_asset_pack';

export interface DesignAppCreativeAiRecipe {
  id: DesignAppCreativeAiRecipeId;
  capabilityId: DesignAppCreativeAiCapabilityId;
  label: string;
  userVisibleSummary: string;
  briefInputs: string[];
  setupSteps: string[];
  executionSteps: string[];
  approvalSummary: string;
  verificationSummary: string;
  outputArtifacts: string[];
  buildoutTool: string;
  recoveryHint: string;
}

export interface DesignAppCreativeAiRecipePlan {
  appId: DesignAppCreativeAiAppId;
  appName: string;
  recipes: DesignAppCreativeAiRecipe[];
  userVisibleOptions: string[];
  approvalGates: string[];
  verificationSignals: string[];
  buildoutTools: string[];
  recoveryHints: string[];
}

export const FIREFLY_API_REF: AppAutomationResearchRef = {
  label: 'Adobe Firefly API',
  url: 'https://developer.adobe.com/firefly-services/docs/firefly-api/',
  takeaway: 'Firefly Services are the cloud lane for prompt-driven image generation and related creative AI operations.',
};

export const FIREFLY_API_REFERENCE_REF: AppAutomationResearchRef = {
  label: 'Adobe Firefly API reference',
  url: 'https://developer.adobe.com/firefly-services/docs/firefly-api/api/',
  takeaway: 'The API reference is the contract for image generation endpoints and should drive any Firefly bridge implementation.',
};

export const INDESIGN_APIS_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign APIs',
  url: 'https://developer.adobe.com/firefly-services/docs/indesign-apis/',
  takeaway: 'InDesign cloud APIs support scalable automation such as data merge, renditions, PDF conversion, and custom scripts.',
};

const CAPABILITIES: Record<DesignAppCreativeAiCapabilityId, DesignAppCreativeAiCapability> = {
  'photoshop.generative_fill_or_remove': {
    id: 'photoshop.generative_fill_or_remove',
    appId: 'adobe_photoshop',
    appName: 'Adobe Photoshop',
    label: 'Generative fill or remove',
    creativeOutcome: 'Remove, replace, or synthesize content inside a verified selection or mask.',
    controlSurface: 'Photoshop UXP/batchPlay action in executeAsModal, with Photoshop API or Firefly only when upload/output approval is explicit.',
    requiredInputs: ['active PSD/image identity', 'target layer', 'verified selection or mask', 'approved prompt or removal intent'],
    requiredEvidence: ['before document status', 'before layer inventory', 'selection/mask screenshot or bounds', 'after layer inventory', 'raster proof'],
    approvalBefore: ['localized generative edit', 'destructive cleanup', 'cloud upload', 'save/export/write'],
    recommendedTools: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.screenshot', 'desktop.photoshop_export_proof', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.photoshop_generative_fill_or_remove',
    buildoutTrigger: 'Build or use a Photoshop generative fill/remove adapter before retrying localized AI pixel edits.',
    failClosedRules: ['stop if selection or mask target is missing', 'stop if the target layer is ambiguous', 'stop if approval is missing for prompt, destructive edit, upload, save, or export'],
    sourceRefs: [
      APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
      APP_AUTOMATION_RESEARCH_REFS.photoshopExecuteAsModal,
      APP_AUTOMATION_RESEARCH_REFS.photoshopApi,
      FIREFLY_API_REFERENCE_REF,
    ],
  },
  'photoshop.generative_expand': {
    id: 'photoshop.generative_expand',
    appId: 'adobe_photoshop',
    appName: 'Adobe Photoshop',
    label: 'Generative expand',
    creativeOutcome: 'Extend the canvas/background while preserving the original subject and layer stack.',
    controlSurface: 'Photoshop action/batchPlay adapter or Firefly/Photoshop API expansion pipeline after source/output approval.',
    requiredInputs: ['active PSD/image identity', 'current canvas dimensions', 'target expansion edges or output size', 'approved prompt/style constraints'],
    requiredEvidence: ['before dimensions', 'target layer/canvas state', 'approved expansion brief', 'after dimensions', 'raster proof'],
    approvalBefore: ['canvas/image expansion', 'cloud upload', 'destructive crop/canvas mutation', 'save/export/write'],
    recommendedTools: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.screenshot', 'desktop.photoshop_export_proof', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.photoshop_generative_expand',
    buildoutTrigger: 'Build a Photoshop generative expand adapter with before/after canvas evidence before retrying.',
    failClosedRules: ['stop if output size or expansion edge is ambiguous', 'stop if approval is missing for prompt or upload', 'stop if proof does not show the expanded canvas'],
    sourceRefs: [
      APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
      APP_AUTOMATION_RESEARCH_REFS.photoshopExecuteAsModal,
      APP_AUTOMATION_RESEARCH_REFS.photoshopApi,
      FIREFLY_API_REF,
    ],
  },
  'photoshop.text_to_image_asset': {
    id: 'photoshop.text_to_image_asset',
    appId: 'adobe_photoshop',
    appName: 'Adobe Photoshop',
    label: 'Text-to-image asset',
    creativeOutcome: 'Generate a new background, product environment, texture, or hero asset, then place it into the PSD as a managed layer or smart object.',
    controlSurface: 'Firefly text-to-image API or approved Photoshop/Firefly UI macro, followed by Photoshop asset placement.',
    requiredInputs: ['creative brief', 'brand/style constraints', 'output size/aspect ratio', 'placement layer or smart-object target'],
    requiredEvidence: ['generated asset receipt or artifact id', 'file_stat for generated asset', 'Photoshop layer inventory after placement', 'visual proof'],
    approvalBefore: ['AI image generation prompt', 'placing generated asset into source PSD', 'cloud upload/output write', 'save/export/write'],
    recommendedTools: ['research.search', 'desktop.file_stat', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_place_asset', 'desktop.photoshop_export_proof', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.firefly_generate_image_asset',
    buildoutTrigger: 'Build a Firefly image-generation bridge plus Photoshop placement receipt before retrying generated-asset workflows.',
    failClosedRules: ['stop if prompt/style constraints are missing', 'stop if generated asset has no receipt or file evidence', 'stop if placement target is ambiguous'],
    sourceRefs: [
      FIREFLY_API_REF,
      FIREFLY_API_REFERENCE_REF,
      APP_AUTOMATION_RESEARCH_REFS.photoshopApi,
      APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
    ],
  },
  'photoshop.creative_variations': {
    id: 'photoshop.creative_variations',
    appId: 'adobe_photoshop',
    appName: 'Adobe Photoshop',
    label: 'Creative variations',
    creativeOutcome: 'Create multiple approved options for backgrounds, copy treatments, colorways, crops, or export sizes.',
    controlSurface: 'Firefly/Photoshop API batch generation plus local Photoshop proof assembly when document state matters.',
    requiredInputs: ['variant count', 'locked brand constraints', 'allowed prompt axes', 'output naming convention', 'proof/export destination'],
    requiredEvidence: ['variant prompt list', 'generation receipts', 'asset basenames/hashes', 'proof contact sheet or exports', 'selected winner rationale when requested'],
    approvalBefore: ['batch AI generation', 'large cloud processing', 'overwriting variants', 'exporting final deliverables'],
    recommendedTools: ['research.search', 'desktop.file_stat', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_export_proof', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.firefly_batch_generate_variants',
    buildoutTrigger: 'Build a Firefly/Photoshop variant-generation adapter that returns receipts, output paths, and proof artifacts.',
    failClosedRules: ['stop if variant count or brand constraints are missing', 'stop if generated outputs lack receipts/file evidence', 'stop before external publishing or overwrites without approval'],
    sourceRefs: [
      FIREFLY_API_REF,
      FIREFLY_API_REFERENCE_REF,
      APP_AUTOMATION_RESEARCH_REFS.photoshopApi,
    ],
  },
  'indesign.text_to_image_frame': {
    id: 'indesign.text_to_image_frame',
    appId: 'adobe_indesign',
    appName: 'Adobe InDesign',
    label: 'Text-to-image frame',
    creativeOutcome: 'Generate an image from a prompt and place it into a known InDesign frame or linked asset slot.',
    controlSurface: 'InDesign UXP/DOM placement workflow, InDesign contextual Firefly UI macro, or Firefly API asset generation followed by deterministic relink/place.',
    requiredInputs: ['active InDesign document identity', 'target frame/link/layer', 'creative prompt', 'brand/style constraints', 'output asset path'],
    requiredEvidence: ['before document status', 'before text/link inventory', 'generated asset receipt/file_stat', 'post-place link status', 'proof export or screenshot'],
    approvalBefore: ['AI prompt generation', 'placing/relinking generated asset', 'cloud upload/output write', 'save/export/package'],
    recommendedTools: ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.file_stat', 'desktop.indesign_relink_asset', 'desktop.indesign_export_proof', 'desktop.screenshot', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.indesign_generate_image_for_frame',
    buildoutTrigger: 'Build an InDesign text-to-image frame adapter that generates an asset, relinks or places it, and verifies proof output.',
    failClosedRules: ['stop if target frame/link is ambiguous', 'stop if generated asset lacks receipt/file evidence', 'stop if proof export does not show the new image'],
    sourceRefs: [
      APP_AUTOMATION_RESEARCH_REFS.indesignUxpScripts,
      INDESIGN_APIS_REF,
      FIREFLY_API_REF,
      FIREFLY_API_REFERENCE_REF,
    ],
  },
  'indesign.generative_expand_asset': {
    id: 'indesign.generative_expand_asset',
    appId: 'adobe_indesign',
    appName: 'Adobe InDesign',
    label: 'Generative expand placed asset',
    creativeOutcome: 'Extend a selected placed image so it fills a banner, spread, bleed, or alternate aspect ratio.',
    controlSurface: 'InDesign contextual Firefly UI macro or Firefly/Photoshop API expansion pipeline, then deterministic relink and proof export.',
    requiredInputs: ['active InDesign document identity', 'selected/target placed asset', 'target frame dimensions', 'approved expansion prompt/style constraints'],
    requiredEvidence: ['before link/frame status', 'generated/expanded asset receipt', 'after link status', 'proof export or screenshot', 'file_stat for output'],
    approvalBefore: ['generative image expansion', 'relinking generated asset', 'cloud upload/output write', 'save/export/package'],
    recommendedTools: ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.file_stat', 'desktop.indesign_relink_asset', 'desktop.indesign_export_proof', 'desktop.screenshot', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.indesign_generative_expand_asset',
    buildoutTrigger: 'Build an InDesign generative expand adapter that expands a known placed asset and relinks it with proof evidence.',
    failClosedRules: ['stop if selected/target placed asset is ambiguous', 'stop if frame size or expansion edge is ambiguous', 'stop if approval is missing for prompt or relink'],
    sourceRefs: [
      APP_AUTOMATION_RESEARCH_REFS.indesignUxpScripts,
      INDESIGN_APIS_REF,
      FIREFLY_API_REF,
    ],
  },
  'indesign.data_merge_variants': {
    id: 'indesign.data_merge_variants',
    appId: 'adobe_indesign',
    appName: 'Adobe InDesign',
    label: 'Data-merge creative variants',
    creativeOutcome: 'Create localized or personalized layout variations from CSV/template data with proof outputs.',
    controlSurface: 'InDesign cloud Data Merge API or local InDesign script workflow after template/CSV/output approval.',
    requiredInputs: ['source InDesign template', 'CSV/data source', 'field mapping', 'variant count', 'output naming/folder'],
    requiredEvidence: ['template file_stat', 'CSV file_stat or schema summary', 'data-merge job receipt', 'sample proof outputs', 'variant count report'],
    approvalBefore: ['uploading template/CSV', 'running batch data merge', 'writing output variants', 'packaging/exporting deliverables'],
    recommendedTools: ['desktop.file_stat', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_export_proof', 'research.search', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.indesign_data_merge_variants',
    buildoutTrigger: 'Build an InDesign data-merge variants adapter with template/CSV validation, job receipt, and sample proof verification.',
    failClosedRules: ['stop if CSV/schema mapping is ambiguous', 'stop if output count/naming is missing', 'stop if sample proofs or job receipt are missing'],
    sourceRefs: [
      INDESIGN_APIS_REF,
      APP_AUTOMATION_RESEARCH_REFS.indesignUxpScripts,
    ],
  },
  'firefly.batch_asset_generation': {
    id: 'firefly.batch_asset_generation',
    appId: 'adobe_photoshop',
    appName: 'Adobe Firefly',
    label: 'Batch AI asset generation',
    creativeOutcome: 'Generate a reusable batch of backgrounds, textures, scenes, or campaign assets for later Photoshop/InDesign placement.',
    controlSurface: 'Firefly API batch generation with explicit prompt list, output destination, and artifact receipts.',
    requiredInputs: ['prompt list or generation matrix', 'brand/style constraints', 'variant count', 'output folder', 'allowed downstream app'],
    requiredEvidence: ['generation receipts', 'output file_stats', 'prompt/asset mapping', 'preview/proof sheet'],
    approvalBefore: ['batch generation spend', 'cloud upload/output write', 'placing assets into a source design file', 'external publishing'],
    recommendedTools: ['research.search', 'desktop.file_stat', 'desktop.screenshot', 'approvals.request', 'agent.build_app_capability'],
    gapTool: 'desktop.firefly_batch_generate_assets',
    buildoutTrigger: 'Build a Firefly batch asset adapter that returns prompt-to-output receipts and proof artifacts.',
    failClosedRules: ['stop if prompt list or variant count is missing', 'stop if output file evidence is missing', 'stop before downstream document mutation without app-specific approval'],
    sourceRefs: [FIREFLY_API_REF, FIREFLY_API_REFERENCE_REF],
  },
};

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function uniqueRefs(refs: AppAutomationResearchRef[]): AppAutomationResearchRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.url)) return false;
    seen.add(ref.url);
    return true;
  });
}

function planningTextForTask(task: string): string {
  const value = String(task || '');
  const requestedChanges = value.match(/^User requested changes:\s*(.+)$/m);
  if (requestedChanges?.[1]) return requestedChanges[1];
  return value.split(/\nExecution rules:/i)[0] || value;
}

function explicitApp(text: string): DesignAppCreativeAiAppId {
  if (/\b(indesign|in\s*design|\.indd\b|\.idml\b|\.indt\b|layout|data merge|text frame|placed image|placed asset)\b/i.test(text)) {
    return 'adobe_indesign';
  }
  return 'adobe_photoshop';
}

function addCapability(ids: DesignAppCreativeAiCapabilityId[], id: DesignAppCreativeAiCapabilityId): void {
  if (!ids.includes(id)) ids.push(id);
}

function recipeForCapability(capability: DesignAppCreativeAiCapability): DesignAppCreativeAiRecipe {
  switch (capability.id) {
    case 'photoshop.generative_fill_or_remove':
      return {
        id: 'photoshop.localized_cleanup',
        capabilityId: capability.id,
        label: 'Localized cleanup or replacement',
        userVisibleSummary: 'Clean up or replace a selected Photoshop area with AI, then verify the layer stack and proof.',
        briefInputs: ['target layer', 'selection or mask bounds', 'remove/replace prompt', 'destructive-edit tolerance'],
        setupSteps: ['Open the exact PSD/image', 'Run document status and layer inventory', 'Capture selection or mask evidence'],
        executionSteps: ['Request approval for the prompt and target area', 'Run generative fill/remove adapter or build it', 'Export raster proof'],
        approvalSummary: 'Approve target area, AI prompt/removal intent, destructive risk, save/export destination, and cloud processing if used.',
        verificationSummary: 'Selection/mask evidence, before/after layer inventory, generated receipt or action result, screenshot/raster proof, and output file_stat.',
        outputArtifacts: ['selection/mask receipt', 'before/after layer inventory', 'raster proof'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If no selection or mask is available, stop and ask for the target area instead of filling blind.',
      };
    case 'photoshop.generative_expand':
      return {
        id: 'photoshop.canvas_expansion',
        capabilityId: capability.id,
        label: 'Canvas or background expansion',
        userVisibleSummary: 'Extend a Photoshop canvas/background for a new crop, size, or ad placement.',
        briefInputs: ['current dimensions', 'target size or expansion edges', 'style constraints', 'output proof path'],
        setupSteps: ['Open the exact PSD/image', 'Capture dimensions and color profile', 'Map target layer/canvas state'],
        executionSteps: ['Request approval for output size and prompt', 'Run generative expand adapter or build it', 'Export proof at the requested size'],
        approvalSummary: 'Approve expansion direction/size, AI prompt/style constraints, cloud processing if used, and output writes.',
        verificationSummary: 'Before/after dimensions, layer inventory, expansion receipt, visual proof, and file_stat.',
        outputArtifacts: ['expansion receipt', 'before/after document status', 'raster proof'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If output size or expansion edge is ambiguous, stop and ask for the target dimensions.',
      };
    case 'photoshop.text_to_image_asset':
      return {
        id: 'photoshop.background_asset_pack',
        capabilityId: capability.id,
        label: 'Generated background or hero asset',
        userVisibleSummary: 'Generate an AI background/scene/texture and place it into the PSD as a managed layer.',
        briefInputs: ['creative prompt', 'brand/style constraints', 'aspect ratio', 'placement layer or smart-object target'],
        setupSteps: ['Resolve the PSD and output folder', 'Run Photoshop status/layer inventory', 'Choose the placement target'],
        executionSteps: ['Generate the asset with Firefly or approved UI macro', 'Verify output file evidence', 'Place generated asset and export proof'],
        approvalSummary: 'Approve generation prompt, style constraints, placement target, cloud output, and source document mutation.',
        verificationSummary: 'Generation receipt, generated file_stat, placed layer inventory, screenshot/proof, and export file_stat.',
        outputArtifacts: ['generated image asset', 'placement receipt', 'raster proof'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If the prompt or placement target is missing, collect the brief before generating assets.',
      };
    case 'photoshop.creative_variations':
      return {
        id: 'photoshop.creative_variant_contact_sheet',
        capabilityId: capability.id,
        label: 'Creative variant contact sheet',
        userVisibleSummary: 'Generate multiple Photoshop/Firefly options and summarize them for review.',
        briefInputs: ['variant count', 'locked brand constraints', 'allowed prompt axes', 'output naming convention'],
        setupSteps: ['Resolve source PSD/assets and output folder', 'Confirm variant count and constraints', 'Create prompt matrix'],
        executionSteps: ['Request approval for batch generation', 'Generate variants or build adapter', 'Create proof/contact sheet or sample exports'],
        approvalSummary: 'Approve prompt matrix, batch spend/cloud processing, output folder, and any source PSD placement.',
        verificationSummary: 'Variant receipts, output file_stats, prompt-to-asset mapping, and proof/contact sheet.',
        outputArtifacts: ['variant assets', 'prompt/asset map', 'contact sheet or sample proofs'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If variant count or brand constraints are missing, stop before generation.',
      };
    case 'indesign.text_to_image_frame':
      return {
        id: 'indesign.hero_image_frame',
        capabilityId: capability.id,
        label: 'Text-to-image frame placement',
        userVisibleSummary: 'Generate an image and place/relink it into a specific InDesign frame.',
        briefInputs: ['target frame/link/layer', 'creative prompt', 'brand/style constraints', 'output asset path'],
        setupSteps: ['Open the exact InDesign document/package', 'Run document status and text/link inventory', 'Verify target frame/link'],
        executionSteps: ['Generate the image asset', 'Relink/place into the target frame', 'Export proof PDF or screenshot'],
        approvalSummary: 'Approve creative prompt, target frame/link, generated asset placement, cloud processing, and proof export.',
        verificationSummary: 'Generated asset receipt/file_stat, post-place link inventory, and proof PDF/screenshot.',
        outputArtifacts: ['generated image asset', 'link/relink receipt', 'proof PDF'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If the target frame/link is ambiguous, stop and ask for the exact frame or selected object.',
      };
    case 'indesign.generative_expand_asset':
      return {
        id: 'indesign.expand_placed_image',
        capabilityId: capability.id,
        label: 'Expand placed image for layout',
        userVisibleSummary: 'Extend a placed InDesign image so it fills a banner, bleed, or alternate layout.',
        briefInputs: ['selected/target placed asset', 'target frame dimensions', 'expansion prompt/style constraints', 'proof path'],
        setupSteps: ['Verify active document and placed asset', 'Capture link/frame status', 'Confirm target frame dimensions'],
        executionSteps: ['Run generative expand or build adapter', 'Relink expanded asset', 'Export proof'],
        approvalSummary: 'Approve expansion prompt, target frame dimensions, relink, cloud processing, and proof export.',
        verificationSummary: 'Before/after link status, expanded asset receipt, proof output, and file_stat.',
        outputArtifacts: ['expanded asset', 'relink receipt', 'proof PDF/screenshot'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If no selected or named placed asset is available, stop before expansion.',
      };
    case 'indesign.data_merge_variants':
      return {
        id: 'indesign.data_merge_campaign_variants',
        capabilityId: capability.id,
        label: 'Data-merge campaign variants',
        userVisibleSummary: 'Create personalized/localized InDesign variants from a template and CSV.',
        briefInputs: ['template document', 'CSV/data source', 'field mapping', 'variant count', 'output naming/folder'],
        setupSteps: ['Verify template and CSV file stats', 'Inspect text/link fields', 'Confirm mapping and sample record count'],
        executionSteps: ['Run data merge adapter or build it', 'Export sample proofs', 'Report variant count and blockers'],
        approvalSummary: 'Approve template/CSV upload, field mapping, variant count, batch output writes, and proof export.',
        verificationSummary: 'Data-merge job receipt, sample proof outputs, variant count report, and output file_stats.',
        outputArtifacts: ['merged InDesign/PDF outputs', 'variant count report', 'sample proofs'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If field mapping or output naming is unclear, stop before running the merge.',
      };
    case 'firefly.batch_asset_generation':
    default:
      return {
        id: 'firefly.batch_asset_pack',
        capabilityId: capability.id,
        label: 'Batch AI asset pack',
        userVisibleSummary: 'Generate a reusable set of Firefly assets for Photoshop or InDesign placement.',
        briefInputs: ['prompt list', 'brand/style constraints', 'variant count', 'output folder', 'downstream app target'],
        setupSteps: ['Confirm prompt list and variant matrix', 'Resolve output folder', 'Confirm downstream app/document target'],
        executionSteps: ['Run batch generation or build adapter', 'Verify output file_stats', 'Create preview/proof sheet'],
        approvalSummary: 'Approve batch prompt list, generation spend/cloud processing, output writes, and downstream placement.',
        verificationSummary: 'Generation receipts, output file_stats, prompt-to-asset map, and preview/proof sheet.',
        outputArtifacts: ['generated asset pack', 'prompt/asset map', 'preview sheet'],
        buildoutTool: capability.gapTool,
        recoveryHint: 'If prompt list or variant count is missing, stop before batch generation.',
      };
  }
}

export function detectDesignAppCreativeAiCapabilities(task: string): DesignAppCreativeAiCapability[] {
  const text = planningTextForTask(task);
  const ids: DesignAppCreativeAiCapabilityId[] = [];
  const app = explicitApp(text);
  const mentionsAi = /\b(ai|firefly|generative|generate|text[-\s]?to[-\s]?image|content-aware|inpaint|outpaint|remove background|replace background|creative variations?|variants?)\b/i.test(text);
  if (!mentionsAi) return [];

  if (app === 'adobe_indesign') {
    if (/\b(text[-\s]?to[-\s]?image|generate (?:an? )?(?:image|background|hero|scene|asset)|firefly|prompt)\b/i.test(text)) {
      addCapability(ids, 'indesign.text_to_image_frame');
    }
    if (/\b(generative expand|expand (?:the )?(?:image|photo|asset|background)|extend (?:the )?(?:image|photo|asset|background)|outpaint|bleed|fill (?:the )?(?:frame|banner|spread))\b/i.test(text)) {
      addCapability(ids, 'indesign.generative_expand_asset');
    }
    if (/\b(data merge|csv|spreadsheet|personalized|localized|localised|versions?|variants?|campaign variations?|variable data|batch)\b/i.test(text)) {
      addCapability(ids, 'indesign.data_merge_variants');
    }
    if (/\b(batch|generate (?:multiple|many|a set|several)|variant matrix|asset pack|background options?)\b/i.test(text)) {
      addCapability(ids, 'firefly.batch_asset_generation');
    }
  } else {
    if (/\b(generative fill|content-aware|remove|erase|clean up|replace background|inpaint|localized edit)\b/i.test(text)) {
      addCapability(ids, 'photoshop.generative_fill_or_remove');
    }
    if (/\b(generative expand|expand (?:the )?(?:canvas|image|photo|background)|extend (?:the )?(?:canvas|image|photo|background)|outpaint|wider|taller)\b/i.test(text)) {
      addCapability(ids, 'photoshop.generative_expand');
    }
    if (/\b(text[-\s]?to[-\s]?image|generate (?:an? )?(?:image|background|hero|scene|asset|texture)|firefly|prompt)\b/i.test(text)) {
      addCapability(ids, 'photoshop.text_to_image_asset');
    }
    if (/\b(variations?|options?|versions?|colorways?|style variations?|brand variations?|localized|personalized|batch)\b/i.test(text)) {
      addCapability(ids, 'photoshop.creative_variations');
    }
    if (/\b(batch|asset pack|background options?|generate (?:multiple|many|a set|several))\b/i.test(text)) {
      addCapability(ids, 'firefly.batch_asset_generation');
    }
  }

  return ids.map((id) => CAPABILITIES[id]);
}

export function buildDesignAppCreativeAiPlan(task: string): DesignAppCreativeAiPlan | null {
  const capabilities = detectDesignAppCreativeAiCapabilities(task);
  if (capabilities.length === 0) return null;
  const primary = capabilities.find((capability) => capability.appId !== 'adobe_photoshop' || explicitApp(task) === 'adobe_photoshop') || capabilities[0];
  const appId = explicitApp(task);
  const appName = appId === 'adobe_indesign' ? 'Adobe InDesign' : primary.appName === 'Adobe Firefly' ? 'Adobe Photoshop' : primary.appName;
  const sourceRefs = uniqueRefs(capabilities.flatMap((capability) => capability.sourceRefs));
  return {
    appId,
    appName,
    capabilities,
    creativeBriefSignals: unique([
      /brand|style|tone|color|palette|guidelines/i.test(task) ? 'brand/style constraints' : '',
      /prompt|generate|firefly|ai|text[-\s]?to[-\s]?image/i.test(task) ? 'AI prompt or generation brief' : '',
      /variant|version|batch|data merge|csv|personalized|localized/i.test(task) ? 'variant matrix or data source' : '',
      /frame|layer|selection|mask|placed|smart object|link/i.test(task) ? 'target frame/layer/selection evidence' : '',
      /export|proof|png|jpg|pdf|package/i.test(task) ? 'proof/export destination' : '',
    ]),
    approvalGates: unique(capabilities.flatMap((capability) => capability.approvalBefore)),
    verificationSignals: unique(capabilities.flatMap((capability) => capability.requiredEvidence)),
    recommendedTools: unique(capabilities.flatMap((capability) => capability.recommendedTools)),
    buildoutTriggers: unique(capabilities.map((capability) => capability.buildoutTrigger)),
    failClosedRules: unique(capabilities.flatMap((capability) => capability.failClosedRules)),
    sourceRefs,
  };
}

export function buildDesignAppCreativeAiRecipePlan(task: string): DesignAppCreativeAiRecipePlan | null {
  const plan = buildDesignAppCreativeAiPlan(task);
  if (!plan) return null;
  const recipes = Array.from(new Map(
    plan.capabilities.map((capability) => {
      const recipe = recipeForCapability(capability);
      return [recipe.id, recipe] as const;
    }),
  ).values());
  return {
    appId: plan.appId,
    appName: plan.appName,
    recipes,
    userVisibleOptions: unique(recipes.map((recipe) => recipe.userVisibleSummary)),
    approvalGates: unique(recipes.map((recipe) => recipe.approvalSummary)),
    verificationSignals: unique(recipes.map((recipe) => recipe.verificationSummary)),
    buildoutTools: unique(recipes.map((recipe) => recipe.buildoutTool)),
    recoveryHints: unique(recipes.map((recipe) => recipe.recoveryHint)),
  };
}

export function buildDesignAppCreativeAiRecipePromptBlock(task: string, opts: { maxRecipes?: number } = {}): string | null {
  const plan = buildDesignAppCreativeAiRecipePlan(task);
  if (!plan) return null;
  const recipes = plan.recipes.slice(0, opts.maxRecipes ?? 4);
  return [
    '## Design App Creative AI Recipes',
    `Target app: ${plan.appName} (${plan.appId})`,
    `User-visible options: ${plan.userVisibleOptions.slice(0, 4).join(' | ')}`,
    `Approval gates: ${plan.approvalGates.slice(0, 4).join(' | ')}`,
    `Verification: ${plan.verificationSignals.slice(0, 4).join(' | ')}`,
    ...recipes.flatMap((recipe) => [
      `### ${recipe.label}`,
      `Capability: ${recipe.capabilityId}`,
      `User summary: ${recipe.userVisibleSummary}`,
      `Brief inputs: ${recipe.briefInputs.join(' | ')}`,
      `Setup: ${recipe.setupSteps.join(' | ')}`,
      `Execute: ${recipe.executionSteps.join(' | ')}`,
      `Approval: ${recipe.approvalSummary}`,
      `Proof: ${recipe.verificationSummary}`,
      `Artifacts: ${recipe.outputArtifacts.join(' | ')}`,
      `Buildout tool: ${recipe.buildoutTool}`,
      `Recovery: ${recipe.recoveryHint}`,
    ]),
    'Keep normal chat quiet: show the user only approval, a short recipe choice when clarification is needed, proof, or a concrete blocker.',
  ].join('\n');
}

export function buildDesignAppCreativeAiPromptBlock(task: string): string | null {
  const plan = buildDesignAppCreativeAiPlan(task);
  if (!plan) return null;
  const recipePlan = buildDesignAppCreativeAiRecipePlan(task);
  return [
    '## Design App Creative AI Plan',
    `Target app: ${plan.appName} (${plan.appId})`,
    `Capabilities: ${plan.capabilities.map((capability) => `${capability.id} (${capability.label})`).join(' | ')}`,
    `Creative brief signals: ${plan.creativeBriefSignals.join(' | ')}`,
    `Approval gates: ${plan.approvalGates.join(' | ')}`,
    `Verification signals: ${plan.verificationSignals.join(' | ')}`,
    `Recommended tools: ${plan.recommendedTools.join(' | ')}`,
    `Buildout triggers: ${plan.buildoutTriggers.join(' | ')}`,
    `Fail closed: ${plan.failClosedRules.join(' | ')}`,
    recipePlan?.recipes.length ? `Recipes: ${recipePlan.recipes.map((recipe) => `${recipe.id} (${recipe.label})`).join(' | ')}` : null,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label} <${ref.url}>`).join(' | ')}`,
    'When the exact creative-AI adapter is missing, use agent.build_app_capability with the buildout trigger, then retry once with fresh document/app evidence.',
  ].filter(Boolean).join('\n');
}
