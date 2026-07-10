import {
  buildAppAutomationControlSurfacePlan,
  type AppAutomationResearchRef,
  APP_AUTOMATION_RESEARCH_REFS,
} from './appAutomationControlSurfaces';
import {
  buildDesignAppAutomationPlan,
  type DesignAppAutomationAppId,
  type DesignAppAutomationOperation,
  type DesignAppAutomationPlan,
} from './designAppAutomation';
import {
  buildDesignAppAdapterGapContract,
  buildDesignAppAdapterGapPlan,
  type DesignAppAdapterGapContract,
} from './designAppAdapterGaps';
import {
  FIREFLY_API_REF,
  FIREFLY_API_REFERENCE_REF,
  INDESIGN_APIS_REF,
} from './designAppCreativeAi';

export type DesignAppOperationRunbookPhase =
  | 'observe'
  | 'approve'
  | 'act'
  | 'verify'
  | 'recover'
  | 'stop';

export type DesignAppOperationRisk = 'read_only' | 'review' | 'high';

export interface DesignAppOperationRunbookStep {
  phase: DesignAppOperationRunbookPhase;
  title: string;
  tool?: string;
  required: boolean;
  approvalRequired: boolean;
  detail: string;
  evidence: string[];
}

export interface DesignAppOperationRunbook {
  appId: DesignAppAutomationAppId;
  appName: string;
  operation: DesignAppAutomationOperation;
  label: string;
  risk: DesignAppOperationRisk;
  controlSurface: string;
  requiredInputs: string[];
  approvalBefore: string[];
  steps: DesignAppOperationRunbookStep[];
  successCriteria: string[];
  failClosedConditions: string[];
  fallbackBuildoutTrigger: string;
  adapterGap?: DesignAppAdapterGapContract | null;
  userVisibleSummary: string;
  sourceRefs: AppAutomationResearchRef[];
}

export interface DesignAppOperationRunbookPlan {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  operations: DesignAppAutomationOperation[];
  runbooks: DesignAppOperationRunbook[];
  promptSummary: string;
  sourceRefs: AppAutomationResearchRef[];
}

const INDESIGN_TEXT_FRAME_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign TextFrame DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/t/TextFrame/',
  takeaway: 'Text frames expose contents, threading, and overset state, so copy edits need text inventory and post-edit overflow checks.',
};

const INDESIGN_LINK_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign Link DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/l/Link/',
  takeaway: 'Links expose relink and update methods, so placed-asset replacement should be a deterministic link operation after file checks.',
};

const INDESIGN_DOCUMENT_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign Document DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/d/Document/',
  takeaway: 'Documents expose exportFile and packageForPrint, so proofs and package handoffs should verify destination paths and output artifacts.',
};

const INDESIGN_LAYER_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign Layer DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/l/Layer/',
  takeaway: 'Layers expose visible, locked, printable, and name state for deterministic show/hide/lock/unlock operations.',
};

const PHOTOSHOP_LAYER_REF: AppAutomationResearchRef = {
  label: 'Adobe Photoshop Layer DOM',
  url: 'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/layer/',
  takeaway: 'Layers expose names, visibility, locks, layer kind, masks, text items, and linked layers for structured inventory before mutation.',
};

const PHOTOSHOP_BATCHPLAY_REF: AppAutomationResearchRef = {
  label: 'Adobe Photoshop batchPlay',
  url: 'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/',
  takeaway: 'batchPlay is the lower-level action descriptor surface for commands that the Photoshop DOM does not expose cleanly.',
};

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function step(
  phase: DesignAppOperationRunbookPhase,
  title: string,
  detail: string,
  opts: {
    tool?: string;
    required?: boolean;
    approvalRequired?: boolean;
    evidence?: string[];
  } = {},
): DesignAppOperationRunbookStep {
  return {
    phase,
    title,
    tool: opts.tool,
    required: opts.required ?? true,
    approvalRequired: opts.approvalRequired ?? false,
    detail,
    evidence: opts.evidence || [],
  };
}

function sourceRefs(...refs: Array<AppAutomationResearchRef | undefined>): AppAutomationResearchRef[] {
  return unique(refs.filter(Boolean) as AppAutomationResearchRef[]);
}

function baseSourceRefs(plan: DesignAppAutomationPlan): AppAutomationResearchRef[] {
  return plan.appId === 'adobe_photoshop'
    ? sourceRefs(
        APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
        APP_AUTOMATION_RESEARCH_REFS.photoshopExecuteAsModal,
        PHOTOSHOP_LAYER_REF,
      )
    : sourceRefs(
        APP_AUTOMATION_RESEARCH_REFS.indesignUxpScripts,
        INDESIGN_DOCUMENT_REF,
      );
}

function operationLabel(operation: DesignAppAutomationOperation): string {
  const labels: Record<DesignAppAutomationOperation, string> = {
    inspect_layers: 'Inspect layout layers and document state',
    update_text_layers: 'Update named text/copy layers',
    replace_linked_asset: 'Replace or relink placed assets',
    resize_layout: 'Resize layout or canvas',
    toggle_layer_visibility: 'Toggle layer visibility or locks',
    export_proof: 'Export InDesign proof',
    package_handoff: 'Package InDesign handoff',
    inspect_image_document: 'Inspect Photoshop document state',
    edit_adjustment_layers: 'Edit adjustment layers',
    apply_selection_or_mask: 'Apply or verify selection/mask',
    generative_fill_or_remove: 'Run generative/content-aware edit',
    generate_ai_asset: 'Generate AI creative asset',
    generative_expand_asset: 'Generative expand asset/canvas',
    create_creative_variants: 'Create creative variants',
    export_raster_proof: 'Export Photoshop raster proof',
    apply_layer_effects: 'Apply layer styles/effects',
    manage_layers: 'Create, duplicate, group, merge, or delete layers',
    apply_text_style: 'Apply or define paragraph/character styles',
    manage_pages: 'Add, delete, move, or apply master/parent pages',
    transform_layer: 'Transform layer (rotate, flip, scale, skew, warp)',
    convert_color_mode: 'Convert color mode, bit depth, or profile',
    manage_tables: 'Create, edit, populate, or format tables',
    resolve_fonts: 'Activate, sync, or substitute fonts',
    manage_artboards: 'Create, duplicate, resize, or delete artboards/documents',
    manage_hyperlinks: 'Add or update hyperlinks, cross-references, bookmarks',
    build_toc: 'Build table of contents, index, or running headers',
    manage_text_flow: 'Thread/unthread frames, autoflow, or fix overset',
    manage_smart_objects: 'Convert, edit, replace, or rasterize smart objects',
    manage_swatches: 'Add, edit, convert, or delete swatches/spot colors/inks',
  };
  return labels[operation];
}

function riskForOperation(operation: DesignAppAutomationOperation): DesignAppOperationRisk {
  if (operation === 'inspect_layers' || operation === 'inspect_image_document') return 'read_only';
  if (
    operation === 'generative_fill_or_remove'
    || operation === 'generate_ai_asset'
    || operation === 'generative_expand_asset'
    || operation === 'create_creative_variants'
  ) return 'high';
  if (operation === 'package_handoff' || operation === 'replace_linked_asset') return 'high';
  // Destructive/irreversible-ish ops — merge/flatten/delete layers, delete/move
  // pages, create/delete tables, raster transforms (resampling), and color-mode
  // or bit-depth conversion (gamut/precision loss) — treat as high so approval
  // is mandatory. Font activation/substitution stays at review (recoverable).
  if (
    operation === 'manage_layers'
    || operation === 'manage_pages'
    || operation === 'manage_tables'
    || operation === 'transform_layer'
    || operation === 'convert_color_mode'
    || operation === 'manage_artboards'
    || operation === 'manage_smart_objects'
  ) return 'high';
  return 'review';
}

function isCreativeAiOperation(operation: DesignAppAutomationOperation): boolean {
  return operation === 'generate_ai_asset'
    || operation === 'generative_expand_asset'
    || operation === 'create_creative_variants';
}

function indesignRunbook(plan: DesignAppAutomationPlan, operation: DesignAppAutomationOperation): DesignAppOperationRunbook {
  const controlSurface = buildAppAutomationControlSurfacePlan(operationLabel(operation), {
    targetId: 'adobe_indesign',
    targetName: 'Adobe InDesign',
  }).candidates[0]?.label || 'InDesign UXP script/plugin DOM';
  const source = baseSourceRefs(plan);
  const adapterGap = buildDesignAppAdapterGapContract(plan, operation);
  const sharedObserve = [
    step('observe', 'Resolve exact InDesign file/package', 'Verify the staged .indd/.idml/.indt or package folder before focusing InDesign.', {
      tool: 'desktop.file_stat',
      evidence: ['source path exists', 'source file size/hash when available'],
    }),
    step('observe', 'Confirm active document status', 'Confirm active document name/path, modified state, layers, missing links, missing fonts, locked/hidden layers, pages/spreads, and preflight blockers.', {
      tool: 'desktop.indesign_document_status',
      evidence: ['document identity', 'font/link/preflight state', 'saved/modified state'],
    }),
  ];

  if (operation === 'inspect_layers') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['staged document/package path', 'active InDesign document identity'],
      approvalBefore: [],
      steps: [
        ...sharedObserve,
        step('observe', 'Build text/layer inventory', 'Map text frames by label/name/layer, copy preview, locked/hidden state, and overset state.', {
          tool: 'desktop.indesign_text_inventory',
          evidence: ['text frame inventory', 'overset and lock visibility flags'],
        }),
        step('verify', 'Summarize safe edit targets', 'Return only verified layer/text/link targets and blockers; do not mutate.', {
          evidence: ['named editable targets', 'blocked locked/hidden/overset targets'],
        }),
      ],
      successCriteria: ['active document matches staged source', 'text/layer/link/font state is known before mutation'],
      failClosedConditions: ['active document mismatch', 'no active document', 'missing source file/package'],
      fallbackBuildoutTrigger: 'If document status or text inventory cannot run, build a read-only InDesign inventory adapter before any edit.',
      userVisibleSummary: 'Document and layer inventory is ready, or the exact InDesign blocker is known.',
      sourceRefs: sourceRefs(...source, INDESIGN_TEXT_FRAME_REF),
    };
  }

  if (operation === 'update_text_layers') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['target text frame label/name or exact find/change query', 'replacement copy', 'fresh text inventory'],
      approvalBefore: ['copy/text-frame mutation', 'temporary unlock/show if needed', 'save over source'],
      steps: [
        ...sharedObserve,
        step('observe', 'Map target text frames', 'Find the target frame by label/name/layer or exact copy match; stop if multiple targets are plausible.', {
          tool: 'desktop.indesign_text_inventory',
          evidence: ['target frame id/name/layer', 'current copy', 'overset state'],
        }),
        step('approve', 'Request copy-edit approval', 'Ask for approval with the exact old/new copy and target text frame(s).', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved target labels and replacement copy'],
        }),
        step('act', 'Apply copy update with script-backed tool', 'Use batch text-layer update for named frames or exact find/change for repeated literal replacements.', {
          tool: 'desktop.indesign_batch_update_text_layers or desktop.indesign_batch_find_change',
          approvalRequired: true,
          evidence: ['tool result changed counts'],
        }),
        step('verify', 'Re-run text inventory and status', 'Verify requested copy changed and no overset text, missing link/font, or unexpected locked/hidden blocker remains.', {
          tool: 'desktop.indesign_text_inventory + desktop.indesign_document_status',
          evidence: ['post-change copy', 'post-change overflows false or explicit blocker'],
        }),
      ],
      successCriteria: ['post-change inventory shows requested copy', 'affected text frames are not overset', 'document identity stayed matched'],
      failClosedConditions: ['target text frame ambiguous', 'overset text after mutation', 'locked/hidden frame requires unapproved change'],
      fallbackBuildoutTrigger: 'If text edits need a new DOM capability, build the smallest named-frame/find-change adapter before retrying.',
      userVisibleSummary: 'Copy edits are applied only after target inventory and approval, then checked for overset text.',
      sourceRefs: sourceRefs(...source, INDESIGN_TEXT_FRAME_REF),
    };
  }

  if (operation === 'toggle_layer_visibility') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['exact target layer name', 'requested show/hide/lock/unlock action', 'active InDesign document identity'],
      approvalBefore: ['changing layer visibility or lock state', 'saving/exporting after the layer-state mutation'],
      steps: [
        ...sharedObserve,
        step('observe', 'Map target layer before mutation', 'Inspect the document and text/layer inventory so the target layer name is exact and not ambiguous.', {
          tool: 'desktop.indesign_text_inventory + desktop.indesign_document_status',
          evidence: ['target layer name', 'current visibility/lock state', 'document identity'],
        }),
        step('approve', 'Request layer-state approval', 'Ask for approval with the exact layer name, current state, requested state, and target document.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved layer name', 'approved show/hide/lock/unlock action'],
        }),
        step('act', 'Apply layer state through the InDesign bridge', 'Use the script-backed layer-state tool; stop if no layer or multiple layers match.', {
          tool: 'desktop.indesign_set_layer_state',
          approvalRequired: true,
          evidence: ['matched layer count', 'before/after visible and locked state', 'tool receipt'],
        }),
        step('verify', 'Verify layer state and visible proof', 'Re-run document status and capture screenshot or proof evidence when visibility affects the layout.', {
          tool: 'desktop.indesign_document_status + desktop.screenshot',
          evidence: ['post-change layer status', 'visual proof when relevant'],
        }),
      ],
      successCriteria: ['exactly one layer matched', 'before/after layer state reflects the requested action', 'document identity stayed matched'],
      failClosedConditions: ['target layer ambiguous', 'target document mismatch', 'approval missing before layer mutation', 'post-change verification missing'],
      fallbackBuildoutTrigger: 'If the local bridge is stale or missing desktop.indesign_set_layer_state, restart or rebuild the layer-state endpoint before retrying.',
      userVisibleSummary: 'Layer visibility and locks are changed through a guarded InDesign script, then verified against the same document.',
      sourceRefs: sourceRefs(...source, INDESIGN_LAYER_REF),
    };
  }

  if (operation === 'replace_linked_asset') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['current link target or selected placed asset', 'replacement asset path', 'local file read grant'],
      approvalBefore: ['relinking/replacing placed assets', 'copying or updating linked graphics', 'save over source'],
      steps: [
        ...sharedObserve,
        step('observe', 'Verify replacement asset', 'Check the replacement file path and current link status before relinking.', {
          tool: 'desktop.file_stat + desktop.indesign_document_status',
          evidence: ['replacement asset exists', 'current link identity/status'],
        }),
        step('approve', 'Request relink approval', 'Ask for approval naming the current link and replacement asset path.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved link target', 'approved replacement path'],
        }),
        step('act', 'Relink placed asset', 'Use the script-backed link relink tool; stop if the target link is ambiguous.', {
          tool: 'desktop.indesign_relink_asset',
          approvalRequired: true,
          evidence: ['relink receipt', 'changed link id/name/path'],
        }),
        step('verify', 'Verify relink and visible proof state', 'Re-run document status and capture proof/screenshot if the asset is visible.', {
          tool: 'desktop.indesign_document_status + desktop.screenshot',
          evidence: ['post-change link status', 'visual proof when applicable'],
        }),
      ],
      successCriteria: ['replacement asset exists', 'post-change link status points to approved asset', 'no missing/modified links remain unexpectedly'],
      failClosedConditions: ['replacement file missing', 'link target ambiguous', 'local read grant missing'],
      fallbackBuildoutTrigger: 'If link selection/routing is unsupported, build a deterministic link-id relink adapter before retrying.',
      userVisibleSummary: 'Placed assets are relinked only after file verification, approval, and refreshed link-status proof.',
      sourceRefs: sourceRefs(...source, INDESIGN_LINK_REF),
    };
  }

  if (operation === 'export_proof') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['output proof path', 'local file write grant', 'pre-export document status'],
      approvalBefore: ['exporting proof PDF/image', 'overwriting an existing proof file'],
      steps: [
        ...sharedObserve,
        step('approve', 'Request proof export approval', 'Ask for approval with exact output path, format, overwrite state, and known preflight blockers.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved output path', 'approved export format'],
        }),
        step('act', 'Export proof with document API-backed bridge tool', 'Use InDesign proof export and capture the result.', {
          tool: 'desktop.indesign_export_proof',
          approvalRequired: true,
          evidence: ['export result', 'output path'],
        }),
        step('verify', 'Verify proof file and visible state', 'Check output file_stat and capture/open proof or screenshot evidence.', {
          tool: 'desktop.file_stat + desktop.screenshot',
          evidence: ['proof exists', 'non-zero size', 'visible proof state'],
        }),
      ],
      successCriteria: ['proof output exists with non-zero size', 'document status is known before export', 'visible proof reflects requested layout state'],
      failClosedConditions: ['write grant missing', 'output path ambiguous', 'preflight blockers not approved or resolved'],
      fallbackBuildoutTrigger: 'If export options/presets are unsupported, build the smallest proof-export adapter with preset/output smoke coverage.',
      userVisibleSummary: 'Proof export is approved, generated, and verified by file stats plus visual proof.',
      sourceRefs: sourceRefs(...source, INDESIGN_DOCUMENT_REF),
    };
  }

  if (operation === 'package_handoff') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['output package folder', 'local file write grant', 'pre-package link/font report'],
      approvalBefore: ['creating package folder', 'copying fonts/links/profiles', 'including hidden layers', 'overwriting package contents'],
      steps: [
        ...sharedObserve,
        step('approve', 'Request package approval', 'Ask for approval with package folder, copy-font/link/profile choices, report generation, and known preflight blockers.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved package folder', 'approved package options'],
        }),
        step('act', 'Package document for handoff', 'Use InDesign packageForPrint-backed bridge tool and request a package report.', {
          tool: 'desktop.indesign_package_document',
          approvalRequired: true,
          evidence: ['package tool result', 'report path when returned'],
        }),
        step('verify', 'Verify package folder contents', 'Confirm folder summary, source document, links, allowed fonts/profiles, report, and proof reference when available.', {
          tool: 'desktop.file_stat',
          evidence: ['package folder exists', 'folder summary', 'package report'],
        }),
      ],
      successCriteria: ['package folder exists', 'package report/folder summary is returned', 'missing fonts/links are resolved or reported as blockers'],
      failClosedConditions: ['write grant missing', 'missing fonts/links unresolved', 'package folder ambiguous or would overwrite without approval'],
      fallbackBuildoutTrigger: 'If package options/report parsing is missing, build a package receipt adapter before retrying production handoff.',
      userVisibleSummary: 'Production package handoff includes an approved output folder and machine-readable package report.',
      sourceRefs: sourceRefs(...source, INDESIGN_DOCUMENT_REF),
    };
  }

  if (isCreativeAiOperation(operation)) {
    const isVariant = operation === 'create_creative_variants';
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface: adapterGap?.controlSurface || 'InDesign UXP DOM plus Firefly/Adobe API creative AI workflow',
      requiredInputs: isVariant
        ? ['source InDesign template/package', 'CSV/data source and field mapping', 'variant count and output naming', 'fresh document status and text/link inventory']
        : ['fresh document status', 'fresh text/link inventory', 'target frame/link/layer', 'approved creative prompt and style constraints', 'output asset path'],
      approvalBefore: [
        isVariant ? 'data merge, template/CSV upload, and batch output writes' : 'AI generation, generative expand, generated asset placement, and relink',
        'cloud upload/output processing',
        'save/export/package/write',
        'running new script/API/adapter code',
      ],
      steps: [
        ...sharedObserve,
        step('observe', isVariant ? 'Validate variant data source' : 'Map creative AI target frame/link', isVariant
          ? 'Verify the template, CSV/data source, field mapping, variant count, and output folder before merge.'
          : 'Verify the target frame/link/layer, current asset state, prompt, style constraints, and output asset path before generation.', {
          tool: 'desktop.indesign_text_inventory + desktop.file_stat',
          evidence: isVariant
            ? ['template file', 'CSV/schema summary', 'field mapping', 'variant count']
            : ['target frame/link/layer', 'current asset basename/hash', 'approved prompt/style brief'],
        }),
        step('approve', 'Request creative AI approval', 'Ask for approval with prompt/data source, cloud processing scope, output destination, and document mutation summary.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved prompt or data-source summary', 'approved output destination', 'approved document target'],
        }),
        step('recover', 'Build or use creative AI adapter', 'Use an existing deterministic adapter if available; otherwise delegate the bounded creative AI capability buildout before retrying.', {
          tool: adapterGap ? `${adapterGap.missingBridgeTools[0]} or agent.build_app_capability` : 'agent.build_app_capability',
          approvalRequired: true,
          evidence: adapterGap
            ? ['adapter gap contract', 'source refs', 'focused smoke cases', 'ready-to-retry contract']
            : ['source refs', 'creative AI run receipt', 'focused smoke case'],
        }),
        step('verify', 'Verify placed/generated output and proof', 'Re-run InDesign status/inventory and capture proof/screenshot/file evidence after the creative AI operation.', {
          tool: 'desktop.indesign_document_status + desktop.indesign_text_inventory + desktop.indesign_export_proof',
          evidence: ['post-change link/text inventory', 'generated asset or variant receipt', 'proof output or screenshot'],
        }),
      ],
      successCriteria: isVariant
        ? ['variant count/output naming matches approval', 'sample proofs exist with non-zero file stats', 'template/data-source receipt is retained']
        : ['generated/expanded asset receipt exists', 'target frame/link/layer reflects the approved asset', 'proof evidence shows the expected creative output'],
      failClosedConditions: adapterGap?.failClosedRules || [
        'target frame/link/layer is ambiguous',
        'prompt/style constraints or data-source mapping are missing',
        'approval is missing for creative AI, cloud processing, relink, save, or export',
        'generated output lacks receipt or proof evidence',
      ],
      fallbackBuildoutTrigger: adapterGap?.buildoutTrigger || 'Build a deterministic InDesign creative AI adapter before retrying.',
      adapterGap,
      userVisibleSummary: 'Creative AI InDesign work requires target evidence, prompt/data approval, generated output receipts, and proof verification.',
      sourceRefs: sourceRefs(...source, INDESIGN_APIS_REF, FIREFLY_API_REF, FIREFLY_API_REFERENCE_REF, ...(adapterGap?.officialSourceRefs || [])),
    };
  }

  return {
    appId: plan.appId,
    appName: plan.appName,
    operation,
    label: operationLabel(operation),
    risk: riskForOperation(operation),
    controlSurface,
    requiredInputs: ['fresh document status', 'fresh text/layer inventory', 'exact requested operation'],
    approvalBefore: ['layout mutation', 'save/export/package', 'new script/adapter execution'],
    steps: [
      ...sharedObserve,
      step('recover', 'Delegate missing layout capability', adapterGap?.connectedAgentTask || 'No first-class bridge tool exists for this operation yet; build a bounded InDesign capability before retrying.', {
        tool: 'agent.build_app_capability',
        evidence: adapterGap
          ? ['adapter gap contract', 'chosen control surface', 'source refs', 'focused smoke cases', 'ready-to-retry contract']
          : ['chosen control surface', 'source refs', 'focused smoke case'],
      }),
    ],
    successCriteria: ['capability buildout returns ready_to_retry with focused verification'],
    failClosedConditions: adapterGap?.failClosedRules || ['operation requires blind coordinate edit', 'target object is ambiguous', 'approval is missing'],
    fallbackBuildoutTrigger: adapterGap?.buildoutTrigger || 'Build a reusable InDesign adapter/recipe instead of using blind desktop coordinates.',
    adapterGap,
    userVisibleSummary: 'The task needs a bounded InDesign capability buildout before safe execution.',
    sourceRefs: sourceRefs(...source, ...(adapterGap?.officialSourceRefs || [])),
  };
}

function photoshopRunbook(plan: DesignAppAutomationPlan, operation: DesignAppAutomationOperation): DesignAppOperationRunbook {
  const controlSurface = buildAppAutomationControlSurfacePlan(operationLabel(operation), {
    targetId: 'adobe_photoshop',
    targetName: 'Adobe Photoshop',
  }).candidates[0]?.label || 'Photoshop UXP DOM/app API in modal scope';
  const source = baseSourceRefs(plan);
  const adapterGap = buildDesignAppAdapterGapContract(plan, operation);
  const sharedObserve = [
    step('observe', 'Resolve exact Photoshop file/package', 'Verify the staged .psd/.psb/image file or package folder before focusing Photoshop.', {
      tool: 'desktop.file_stat',
      evidence: ['source path exists', 'source file size/hash when available'],
    }),
    step('observe', 'Confirm Photoshop document status', 'Confirm active document name/path, saved/modified state, dimensions, resolution, color mode/profile, selection state, and linked/embedded assets.', {
      tool: 'desktop.photoshop_document_status',
      evidence: ['document identity', 'dimensions/resolution/color mode', 'selection and linked asset state'],
    }),
  ];

  if (operation === 'inspect_image_document' || operation === 'inspect_layers') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['staged Photoshop source path', 'active Photoshop document identity'],
      approvalBefore: [],
      steps: [
        ...sharedObserve,
        step('observe', 'Build Photoshop layer inventory', 'Map layers by name/type/visibility/lock state, text layers, masks, smart objects, adjustment layers, and selection/mask readiness.', {
          tool: 'desktop.photoshop_layer_inventory',
          evidence: ['layer ids/names/types', 'lock/visibility/mask/smart-object flags'],
        }),
        step('verify', 'Summarize safe edit targets', 'Return verified layer/text/selection/asset targets and blockers; do not mutate.', {
          evidence: ['named editable targets', 'locked/hidden/missing blockers'],
        }),
      ],
      successCriteria: ['active document matches staged source', 'document and layer/mask/selection state is known before mutation'],
      failClosedConditions: ['active document mismatch', 'no active document', 'missing source file/package'],
      fallbackBuildoutTrigger: 'If document status or layer inventory cannot run, build a read-only Photoshop inventory adapter before any edit.',
      userVisibleSummary: 'Document and layer inventory is ready, or the exact Photoshop blocker is known.',
      sourceRefs: source,
    };
  }

  if (operation === 'update_text_layers') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['target text layer name/id', 'replacement copy', 'fresh layer inventory'],
      approvalBefore: ['editing text layers', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('observe', 'Map target text layer', 'Find the target text layer by name/id and stop if multiple plausible layers exist.', {
          tool: 'desktop.photoshop_layer_inventory',
          evidence: ['target layer id/name', 'current text', 'lock/visibility state'],
        }),
        step('approve', 'Request text-layer edit approval', 'Ask for approval with exact target layer and old/new text.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved target layer', 'approved replacement text'],
        }),
        step('act', 'Update text layer through Photoshop bridge', 'Use Photoshop text-layer update in modal/script-backed scope.', {
          tool: 'desktop.photoshop_update_text_layer',
          approvalRequired: true,
          evidence: ['tool result changed layer'],
        }),
        step('verify', 'Re-run layer inventory and proof state', 'Verify text layer changed and no unexpected lock/visibility/blocker remains.', {
          tool: 'desktop.photoshop_layer_inventory + desktop.screenshot',
          evidence: ['post-change text layer', 'visual proof when text is visible'],
        }),
      ],
      successCriteria: ['post-change layer inventory shows requested text', 'target layer identity stayed stable', 'visible proof reflects the new copy when applicable'],
      failClosedConditions: ['target text layer ambiguous', 'layer locked/hidden without approval', 'active document mismatch'],
      fallbackBuildoutTrigger: 'If the update requires a new text API/action descriptor, build a focused Photoshop text-layer adapter before retrying.',
      userVisibleSummary: 'Text layers are updated only after layer identity, approval, and post-change inventory proof.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_LAYER_REF),
    };
  }

  if (operation === 'toggle_layer_visibility') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['target layer/group name or path', 'requested show/hide/lock/unlock action', 'fresh Photoshop layer inventory'],
      approvalBefore: ['changing layer visibility or lock state', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('observe', 'Map target layer or group', 'Find the target layer/group by exact name or path and stop if multiple plausible layers exist.', {
          tool: 'desktop.photoshop_layer_inventory',
          evidence: ['target layer/group name or path', 'current visibility/lock state'],
        }),
        step('approve', 'Request layer-state approval', 'Ask for approval with exact layer/group and requested show/hide/lock/unlock action.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved target layer/group', 'approved layer-state action'],
        }),
        step('act', 'Set Photoshop layer state through bridge', 'Use the script-backed Photoshop layer-state bridge instead of clicking the Layers panel.', {
          tool: 'desktop.photoshop_set_layer_state',
          approvalRequired: true,
          evidence: ['one matched layer/group', 'before/after visibility or lock state'],
        }),
        step('verify', 'Re-run layer inventory and screenshot/proof', 'Verify the target layer/group state changed and capture visible proof when the layer affects the canvas.', {
          tool: 'desktop.photoshop_layer_inventory + desktop.screenshot',
          evidence: ['post-change layer state', 'visual proof when applicable'],
        }),
      ],
      successCriteria: ['exactly one Photoshop layer/group matched', 'post-change layer inventory shows requested visibility/lock state', 'visual proof is captured when visibility affects the canvas'],
      failClosedConditions: ['target layer ambiguous', 'target document mismatch', 'approval missing before layer mutation', 'post-change verification missing'],
      fallbackBuildoutTrigger: 'If the local bridge is stale or missing desktop.photoshop_set_layer_state, restart or rebuild the layer-state endpoint before retrying.',
      userVisibleSummary: 'Layer visibility/lock state changes are deterministic and fail closed on missing or ambiguous Photoshop targets.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_LAYER_REF),
    };
  }

  if (operation === 'replace_linked_asset') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['asset file path', 'target layer/smart object or placement intent', 'local file read grant'],
      approvalBefore: ['placing/replacing assets or smart objects', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('observe', 'Verify asset and target layer', 'Check asset file and current smart-object/layer target before placement.', {
          tool: 'desktop.file_stat + desktop.photoshop_layer_inventory',
          evidence: ['asset exists', 'target layer/smart-object identity'],
        }),
        step('approve', 'Request asset placement approval', 'Ask for approval naming the asset path and target/placement intent.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved asset path', 'approved placement target'],
        }),
        step('act', 'Place asset through Photoshop bridge', 'Use Photoshop asset placement/smart-object bridge tool.', {
          tool: 'desktop.photoshop_place_asset',
          approvalRequired: true,
          evidence: ['placed asset receipt'],
        }),
        step('verify', 'Verify placed asset layer', 'Re-run layer inventory and screenshot/proof after placement.', {
          tool: 'desktop.photoshop_layer_inventory + desktop.screenshot',
          evidence: ['post-placement layer inventory', 'visible proof when asset is visible'],
        }),
      ],
      successCriteria: ['asset file exists', 'post-change inventory shows placed/updated asset layer', 'visual proof reflects requested placement when applicable'],
      failClosedConditions: ['asset file missing', 'target layer/smart object ambiguous', 'local read grant missing'],
      fallbackBuildoutTrigger: 'If placement requires a new smart-object adapter, build it with layer inventory and proof-export smoke coverage.',
      userVisibleSummary: 'Assets are placed only after path verification, approval, and refreshed layer inventory.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_LAYER_REF),
    };
  }

  if (isCreativeAiOperation(operation)) {
    const isVariant = operation === 'create_creative_variants';
    const isExpand = operation === 'generative_expand_asset';
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface: adapterGap?.controlSurface || 'Firefly/Photoshop API plus Photoshop UXP placement/export verification',
      requiredInputs: [
        'fresh document status',
        'fresh layer inventory',
        isExpand ? 'target expansion edge/canvas size and style constraints' : isVariant ? 'variant count, prompt matrix, and output naming' : 'creative prompt, output size, and placement target',
        'approval for AI generation/cloud processing and document mutation',
      ],
      approvalBefore: [
        'AI image generation, generative expand, batch variants, or cloud processing',
        'placing generated assets or mutating the layer stack',
        'save/export/write',
        'running new API/script/action adapter code',
      ],
      steps: [
        ...sharedObserve,
        step('observe', 'Map creative AI target and brief', 'Verify layer/selection/canvas target, prompt or variant matrix, brand/style constraints, and output destination before generation.', {
          tool: 'desktop.photoshop_document_status + desktop.photoshop_layer_inventory + desktop.file_stat',
          evidence: ['target layer/selection/canvas', 'prompt or variant matrix', 'output size/path', 'brand/style constraints'],
        }),
        step('approve', 'Request creative AI approval', 'Ask for approval with prompt/variant matrix, cloud processing scope, generated-asset placement, and proof/export destination.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved prompt or variant matrix', 'approved output destination', 'approved placement/mutation target'],
        }),
        step('recover', 'Build or use creative AI adapter', 'Use an existing Firefly/Photoshop adapter if available; otherwise delegate the bounded capability buildout before retrying.', {
          tool: adapterGap ? `${adapterGap.missingBridgeTools[0]} or agent.build_app_capability` : 'agent.build_app_capability',
          approvalRequired: true,
          evidence: adapterGap
            ? ['adapter gap contract', 'source refs', 'focused smoke cases', 'ready-to-retry contract']
            : ['source refs', 'generation receipt', 'focused smoke case'],
        }),
        step('verify', 'Verify generated output and layer/proof evidence', 'Re-run document status and layer inventory, then capture screenshot/raster proof and file_stat evidence.', {
          tool: 'desktop.photoshop_document_status + desktop.photoshop_layer_inventory + desktop.photoshop_export_proof',
          evidence: ['generation receipt', 'post-change layer inventory', 'raster proof or screenshot', 'output file_stat'],
        }),
      ],
      successCriteria: [
        'generation/variant receipt and output file evidence exist',
        'post-change layer inventory reflects generated or expanded asset placement',
        'raster proof shows the approved creative direction and dimensions',
      ],
      failClosedConditions: adapterGap?.failClosedRules || [
        'prompt, variant matrix, target layer, or output destination is missing',
        'approval is missing for AI generation, cloud upload, layer mutation, save, or export',
        'generated output lacks receipt, file_stat, or proof evidence',
      ],
      fallbackBuildoutTrigger: adapterGap?.buildoutTrigger || 'Build a deterministic Firefly/Photoshop creative AI adapter before retrying.',
      adapterGap,
      userVisibleSummary: 'Creative AI Photoshop work requires prompt approval, generated output receipts, layer evidence, and raster proof verification.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_BATCHPLAY_REF, FIREFLY_API_REF, FIREFLY_API_REFERENCE_REF, ...(adapterGap?.officialSourceRefs || [])),
    };
  }

  if (operation === 'apply_selection_or_mask' || operation === 'generative_fill_or_remove') {
    const isGenerative = operation === 'generative_fill_or_remove';
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface: isGenerative ? 'Photoshop batchPlay/action descriptor inside executeAsModal' : controlSurface,
      requiredInputs: ['fresh document status', 'fresh layer inventory', 'selection or mask target evidence', isGenerative ? 'generative/content-aware prompt or removal intent' : 'mask/selection edit intent'],
      approvalBefore: ['localized pixel edit', 'generative fill/content-aware action', 'destructive cleanup/background replacement', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('observe', 'Verify selection or mask target', 'Confirm the selected/masked area and target layer before localized edits; ask clarification if no target exists.', {
          tool: 'desktop.photoshop_document_status + desktop.photoshop_layer_inventory + desktop.screenshot',
          evidence: ['selection/mask state', 'target layer id/name', 'visual target area'],
        }),
        step('approve', 'Request localized edit approval', 'Ask for approval with target area, layer, edit prompt/action, and destructive/generative risk.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved target area', 'approved edit prompt/action'],
        }),
        step('act', isGenerative ? 'Run generative/content-aware action' : 'Apply selection or mask edit', isGenerative
          ? 'Use an existing bridge/action adapter if available; otherwise delegate capability buildout before coordinates.'
          : 'Run the deterministic Select Subject / mask adapter (P15): select_only reports bounds, mask_layer applies a non-destructive reveal-selection mask. Never deletes pixels; never saves.', {
          tool: isGenerative
            ? (adapterGap
              ? `${adapterGap.missingBridgeTools[0]} or agent.build_app_capability`
              : 'agent.build_app_capability or approved Photoshop batchPlay adapter')
            : 'desktop.photoshop_apply_selection_or_mask',
          approvalRequired: true,
          evidence: isGenerative && adapterGap
            ? ['adapter gap contract', 'action result or buildout result', 'focused smoke cases']
            : ['selection bounds receipt', 'mask-applied verification when mode is mask_layer'],
        }),
        step('verify', 'Verify before/after layer and visual proof', 'Re-run document status and layer inventory, then capture screenshot/raster proof.', {
          tool: 'desktop.photoshop_document_status + desktop.photoshop_layer_inventory + desktop.photoshop_export_proof',
          evidence: ['post-edit layer inventory', 'visual/raster proof'],
        }),
      ],
      successCriteria: ['selection/mask target was known before mutation', 'post-change proof reflects requested localized edit', 'layer inventory documents changed target layer'],
      failClosedConditions: adapterGap?.failClosedRules || ['selection/mask target missing', 'target layer ambiguous', 'approval missing for destructive/generative action', 'no deterministic adapter exists'],
      fallbackBuildoutTrigger: adapterGap?.buildoutTrigger || 'Build a Photoshop selection/generative action adapter with executeAsModal, source refs, and before/after proof smoke coverage.',
      adapterGap,
      userVisibleSummary: 'Localized and generative edits require target-area proof, approval, and before/after evidence.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_BATCHPLAY_REF, ...(adapterGap?.officialSourceRefs || [])),
    };
  }

  if (operation === 'resize_layout') {
    // P15: deterministic geometry adapter — image resize, anchored canvas
    // resize, or crop-to-selection. Never saves; export stays separate.
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['exact target dimensions or crop intent', 'fresh document status with current dimensions'],
      approvalBefore: ['image/canvas geometry mutation', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('approve', 'Request geometry approval', 'Ask for approval with the exact op (image_resize / canvas_resize / crop_to_selection), current dimensions, and target dimensions or selection bounds.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved op and target dimensions'],
        }),
        step('act', 'Apply the geometry operation', 'Run the deterministic resize/canvas/crop adapter (P15). crop_to_selection fails closed without an active selection. Never saves.', {
          tool: 'desktop.photoshop_resize_canvas_or_image',
          approvalRequired: true,
          evidence: ['before/after dimensions receipt'],
        }),
        step('verify', 'Verify dimensions and proof', 'Re-run document status to confirm new dimensions, then capture raster proof.', {
          tool: 'desktop.photoshop_document_status + desktop.photoshop_export_proof',
          evidence: ['post-change dimensions', 'raster proof'],
        }),
      ],
      successCriteria: ['document dimensions match the approved target', 'proof reflects the requested geometry change'],
      failClosedConditions: ['target dimensions ambiguous', 'crop requested without an active selection', 'approval missing for geometry mutation'],
      fallbackBuildoutTrigger: 'If a geometry case is unsupported (e.g. artboards), build a bounded adapter extension instead of blind menu clicks.',
      adapterGap,
      userVisibleSummary: 'Resize/canvas/crop runs through the deterministic geometry adapter with before/after dimension receipts and raster proof.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_BATCHPLAY_REF, ...(adapterGap?.officialSourceRefs || [])),
    };
  }

  if (operation === 'edit_adjustment_layers') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['target adjustment layer or intended new adjustment', 'fresh document and layer inventory'],
      approvalBefore: ['creating/changing adjustment layers', 'destructive filter actions', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('observe', 'Map adjustment layer targets', 'Identify adjustment/filter layers, masks, and target layer stack before changes.', {
          tool: 'desktop.photoshop_layer_inventory',
          evidence: ['adjustment layer ids/names', 'mask/visibility/lock state'],
        }),
        step('approve', 'Request adjustment approval', 'Ask for approval with target layer and adjustment settings or desired visual outcome.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved adjustment target/settings'],
        }),
        step('act', 'Create the adjustment layer', 'Run the deterministic adjustment-layer adapter (P15): additive only — creates a new levels/curves/hue-saturation/brightness-contrast/black-white adjustment layer, never modifies existing ones, never saves.', {
          tool: 'desktop.photoshop_apply_adjustment_layer',
          approvalRequired: true,
          evidence: ['created adjustment layer name', 'layer count before/after receipt'],
        }),
        step('verify', 'Verify adjustment and visual proof', 'Re-run layer inventory to confirm the new adjustment layer, then capture raster proof.', {
          tool: 'desktop.photoshop_layer_inventory + desktop.photoshop_export_proof',
          evidence: ['post-change layer inventory', 'raster proof'],
        }),
      ],
      successCriteria: ['post-change layer inventory shows expected adjustment layer', 'visual proof reflects requested adjustment'],
      failClosedConditions: adapterGap?.failClosedRules || ['target adjustment layer ambiguous', 'operation would be destructive without approval', 'no deterministic adapter exists'],
      fallbackBuildoutTrigger: adapterGap?.buildoutTrigger || 'Build a Photoshop adjustment/action adapter rather than using blind sliders or coordinates.',
      adapterGap,
      userVisibleSummary: 'Adjustment-layer work needs a deterministic adapter or explicit buildout before safe execution.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_BATCHPLAY_REF, ...(adapterGap?.officialSourceRefs || [])),
    };
  }

  if (operation === 'manage_layers' || operation === 'transform_layer' || operation === 'convert_color_mode') {
    // P16: deterministic ExtendScript adapters. manage_layers covers
    // rename/duplicate/reorder/group ONLY — delete/merge/flatten do not
    // exist in the tool and still require explicit buildout + approval.
    const toolByOp: Record<string, string> = {
      manage_layers: 'desktop.photoshop_manage_layers',
      transform_layer: 'desktop.photoshop_transform_layer',
      convert_color_mode: 'desktop.photoshop_convert_color_mode',
    };
    const actDescription = operation === 'manage_layers'
      ? 'Run the layer management adapter (rename/duplicate/reorder/group; exact-name match, fails closed on ambiguity). Delete/merge/flatten are NOT available — they stay buildout-gated destructive actions.'
      : operation === 'transform_layer'
      ? 'Run the layer transform adapter (move/scale/rotate on a named layer, middle-center anchored; background/locked layers fail closed).'
      : 'Run the color mode adapter (RGB/CMYK/Grayscale document conversion; honest no-op when already in the target mode; color data loss is reversible until an approved save).';
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['fresh document status', 'fresh layer inventory', operation === 'convert_color_mode' ? 'target color mode' : 'exact target layer name'],
      approvalBefore: ['document/layer mutation', 'save/export/write'],
      steps: [
        ...sharedObserve,
        step('approve', 'Request mutation approval', 'Ask for approval naming the exact layer/mode target and the operation parameters.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved target and parameters'],
        }),
        step('act', 'Apply the deterministic operation', actDescription, {
          tool: toolByOp[operation],
          approvalRequired: true,
          evidence: ['operation receipt (before/after counts, bounds, or modes)'],
        }),
        step('verify', 'Verify layer state and proof', 'Re-run layer inventory (and document status for color mode), then capture raster proof.', {
          tool: 'desktop.photoshop_layer_inventory + desktop.photoshop_export_proof',
          evidence: ['post-change inventory', 'raster proof'],
        }),
      ],
      successCriteria: ['receipt confirms the requested change', 'post-change inventory matches the approved target', 'nothing was saved'],
      failClosedConditions: ['target layer ambiguous or missing', 'background/locked layer for transforms', 'delete/merge/flatten requested (not supported — buildout only)', 'approval missing'],
      fallbackBuildoutTrigger: 'Delete/merge/flatten or other destructive layer operations need a separately approved buildout — never blind menu clicks.',
      adapterGap,
      userVisibleSummary: 'Layer management, transforms, and color mode run through deterministic adapters with receipts; destructive layer ops stay gated.',
      sourceRefs: sourceRefs(...source, PHOTOSHOP_BATCHPLAY_REF, ...(adapterGap?.officialSourceRefs || [])),
    };
  }

  if (operation === 'export_raster_proof') {
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      risk: riskForOperation(operation),
      controlSurface,
      requiredInputs: ['output path', 'format/dimensions if requested', 'local file write grant', 'pre-export document status'],
      approvalBefore: ['exporting raster proof/final deliverable', 'overwriting existing output'],
      steps: [
        ...sharedObserve,
        step('approve', 'Request raster export approval', 'Ask for approval with exact output path, format, dimensions/quality, and overwrite state.', {
          tool: 'approvals.request',
          approvalRequired: true,
          evidence: ['approved output path', 'approved format/settings'],
        }),
        step('act', 'Export raster proof', 'Use Photoshop proof/export bridge tool.', {
          tool: 'desktop.photoshop_export_proof',
          approvalRequired: true,
          evidence: ['export result', 'output path'],
        }),
        step('verify', 'Verify output file and visible proof', 'Check file_stat and capture/open proof or screenshot evidence.', {
          tool: 'desktop.file_stat + desktop.screenshot',
          evidence: ['proof exists', 'non-zero size', 'expected format/dimensions when returned'],
        }),
      ],
      successCriteria: ['raster output exists with non-zero size', 'document status is known before export', 'proof reflects requested image state'],
      failClosedConditions: ['write grant missing', 'output path ambiguous', 'format/dimensions unknown when required'],
      fallbackBuildoutTrigger: 'If export settings are unsupported, build a proof/export adapter with file_stat smoke coverage.',
      userVisibleSummary: 'Raster proof export is approved, generated, and verified with file stats plus visible proof.',
      sourceRefs: source,
    };
  }

  return {
    appId: plan.appId,
    appName: plan.appName,
    operation,
    label: operationLabel(operation),
    risk: riskForOperation(operation),
    controlSurface,
    requiredInputs: ['fresh document status', 'fresh layer inventory', 'exact requested operation'],
    approvalBefore: ['image/document mutation', 'save/export/write', 'new action/script/adapter execution'],
    steps: [
      ...sharedObserve,
      step('recover', 'Delegate missing Photoshop capability', adapterGap?.connectedAgentTask || 'No first-class bridge tool exists for this operation yet; build a bounded Photoshop capability before retrying.', {
        tool: 'agent.build_app_capability',
        evidence: adapterGap
          ? ['adapter gap contract', 'chosen control surface', 'source refs', 'focused smoke cases', 'ready-to-retry contract']
          : ['chosen control surface', 'source refs', 'focused smoke case'],
      }),
    ],
    successCriteria: ['capability buildout returns ready_to_retry with focused verification'],
    failClosedConditions: adapterGap?.failClosedRules || ['operation requires blind coordinate edit', 'target layer/selection is ambiguous', 'approval is missing'],
    fallbackBuildoutTrigger: adapterGap?.buildoutTrigger || 'Build a reusable Photoshop adapter/recipe instead of using blind desktop coordinates.',
    adapterGap,
    userVisibleSummary: 'The task needs a bounded Photoshop capability buildout before safe execution.',
    sourceRefs: sourceRefs(...source, ...(adapterGap?.officialSourceRefs || [])),
  };
}

function buildOperationRunbook(plan: DesignAppAutomationPlan, operation: DesignAppAutomationOperation): DesignAppOperationRunbook {
  return plan.appId === 'adobe_photoshop'
    ? photoshopRunbook(plan, operation)
    : indesignRunbook(plan, operation);
}

export function buildDesignAppOperationRunbookPlan(task: string): DesignAppOperationRunbookPlan | null {
  const plan = buildDesignAppAutomationPlan(task);
  if (!plan) return null;
  const runbooks = plan.operations.map((operation) => buildOperationRunbook(plan, operation));
  const sourceRefsList = unique(runbooks.flatMap((runbook) => runbook.sourceRefs));
  return {
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    operations: plan.operations,
    runbooks,
    promptSummary: `${plan.appName} ${plan.taskKind}: ${runbooks.map((runbook) => runbook.label).join(' -> ')}`,
    sourceRefs: sourceRefsList,
  };
}

export function buildDesignAppOperationRunbookPromptBlock(task: string, opts: { maxRunbooks?: number } = {}): string | null {
  const plan = buildDesignAppOperationRunbookPlan(task);
  if (!plan) return null;
  const runbooks = plan.runbooks.slice(0, opts.maxRunbooks ?? 8);
  const adapterGapPlan = buildDesignAppAdapterGapPlan(task);
  const lines = [
    '## Design App Operation Runbooks',
    `Summary: ${plan.promptSummary}`,
    `Operations: ${plan.operations.join(' | ')}`,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label} <${ref.url}>`).join(' | ')}`,
  ];
  if (adapterGapPlan?.gaps.length) {
    lines.push(`Adapter gaps: ${adapterGapPlan.gaps.map((gap) => `${gap.operation} -> ${gap.missingBridgeTools.join('/')}`).join(' | ')}`);
  }
  for (const runbook of runbooks) {
    lines.push(`### ${runbook.label}`);
    lines.push(`Risk: ${runbook.risk}`);
    lines.push(`Control surface: ${runbook.controlSurface}`);
    lines.push(`Inputs: ${runbook.requiredInputs.join(' | ')}`);
    lines.push(`Approval before: ${runbook.approvalBefore.length ? runbook.approvalBefore.join(' | ') : 'none'}`);
    lines.push('Steps:');
    for (const item of runbook.steps) {
      lines.push(`- ${item.phase}${item.tool ? ` ${item.tool}` : ''}: ${item.title}. ${item.detail}`);
    }
    lines.push(`Verify: ${runbook.successCriteria.join(' | ')}`);
    lines.push(`Fail closed: ${runbook.failClosedConditions.join(' | ')}`);
    lines.push(`Capability fallback: ${runbook.fallbackBuildoutTrigger}`);
    if (runbook.adapterGap) {
      lines.push(`Adapter gap contract: ${runbook.adapterGap.adapterId}; required before retry: ${runbook.adapterGap.requiredBridgeToolsBeforeRetry.join(' | ')}; smoke: ${runbook.adapterGap.focusedSmokeCases.join(' | ')}`);
    }
  }
  lines.push('Do not skip from observation to mutation. Every act step needs its listed evidence, and every failed/blocked step must return a stop reason.');
  return lines.join('\n');
}
