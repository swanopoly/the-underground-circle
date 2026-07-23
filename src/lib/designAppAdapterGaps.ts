import {
  APP_AUTOMATION_RESEARCH_REFS,
  type AppAutomationResearchRef,
} from './appAutomationControlSurfaces';
import {
  buildDesignAppAutomationPlan,
  type DesignAppAutomationAppId,
  type DesignAppAutomationOperation,
  type DesignAppAutomationPlan,
} from './designAppAutomation';
import {
  FIREFLY_API_REF,
  FIREFLY_API_REFERENCE_REF,
  INDESIGN_APIS_REF,
} from './designAppCreativeAi';

export interface DesignAppAdapterGapContract {
  appId: DesignAppAutomationAppId;
  appName: string;
  operation: DesignAppAutomationOperation;
  label: string;
  adapterId: string;
  controlSurface: string;
  missingBridgeTools: string[];
  existingPrerequisiteTools: string[];
  requiredBridgeToolsBeforeRetry: string[];
  officialSourceRefs: AppAutomationResearchRef[];
  approvalBefore: string[];
  requiredEvidence: string[];
  focusedSmokeCases: string[];
  failClosedRules: string[];
  buildoutTrigger: string;
  connectedAgentTask: string;
  retryPrompt: string;
}

export interface DesignAppAdapterGapPlan {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  operations: DesignAppAutomationOperation[];
  gaps: DesignAppAdapterGapContract[];
  promptSummary: string;
  sourceRefs: AppAutomationResearchRef[];
}

const INDESIGN_DOM_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign DOM API',
  url: 'https://developer.adobe.com/indesign/dom/api/',
  takeaway: 'InDesign layout objects should be addressed through the DOM before menu or coordinate control.',
};

const INDESIGN_LAYER_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign Layer DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/l/Layer/',
  takeaway: 'Layers expose name, visibility, lock state, labels, movement, duplication, and removal for script-backed layer state changes.',
};

const INDESIGN_DOCUMENT_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign Document DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/d/Document/',
  takeaway: 'Documents expose page, export, and package operations, so layout mutations need document identity plus output verification.',
};

const INDESIGN_TEXT_FRAME_REF: AppAutomationResearchRef = {
  label: 'Adobe InDesign TextFrame DOM',
  url: 'https://developer.adobe.com/indesign/dom/api/t/TextFrame/',
  takeaway: 'Text frames expose contents and overset state, so resize adapters must check text overflow before accepting completion.',
};

const PHOTOSHOP_LAYER_REF: AppAutomationResearchRef = {
  label: 'Adobe Photoshop Layer DOM',
  url: 'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/classes/layer/',
  takeaway: 'Layers expose document structure for inventory, target selection, visibility, locks, masks, and adjustment-layer verification.',
};

const PHOTOSHOP_BATCHPLAY_REF: AppAutomationResearchRef = {
  label: 'Adobe Photoshop batchPlay',
  url: 'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/',
  takeaway: 'batchPlay is the low-level action descriptor surface for Photoshop commands not expressed cleanly by the DOM.',
};

const EXISTING_TOOLS: Record<DesignAppAutomationAppId, string[]> = {
  adobe_indesign: [
    'desktop.indesign_document_status',
    'desktop.indesign_text_inventory',
    'desktop.indesign_set_layer_state',
    'desktop.indesign_batch_find_change',
    'desktop.indesign_batch_update_text_layers',
    'desktop.indesign_update_text_layer',
    'desktop.indesign_relink_asset',
    'desktop.indesign_package_document',
    'desktop.indesign_export_proof',
  ],
  adobe_photoshop: [
    'desktop.photoshop_document_status',
    'desktop.photoshop_layer_inventory',
    'desktop.photoshop_set_layer_state',
    'desktop.photoshop_update_text_layer',
    'desktop.photoshop_place_asset',
    'desktop.photoshop_export_proof',
    // P15: ExtendScript adapters shipped — these ops are no longer gaps.
    'desktop.photoshop_apply_adjustment_layer',
    'desktop.photoshop_apply_selection_or_mask',
    'desktop.photoshop_resize_canvas_or_image',
    // P16: layer management, transforms, and color mode shipped too.
    'desktop.photoshop_manage_layers',
    'desktop.photoshop_transform_layer',
    'desktop.photoshop_convert_color_mode',
  ],
  adobe_illustrator: [
    // Deterministic Illustrator ExtendScript adapters (shipped) — these vector
    // ops are no longer gaps.
    'desktop.illustrator_document_status',
    'desktop.illustrator_export_proof',
    'desktop.illustrator_vectorize',
    'desktop.illustrator_set_appearance',
    'desktop.illustrator_align',
    'desktop.illustrator_arrange',
    'desktop.illustrator_group',
    'desktop.illustrator_add_artboard',
    'desktop.illustrator_add_text',
    'desktop.illustrator_add_shape',
  ],
};

const GAP_OPERATIONS = new Set<DesignAppAutomationOperation>([
  'resize_layout',
  'toggle_layer_visibility',
  'edit_adjustment_layers',
  'apply_selection_or_mask',
  'generative_fill_or_remove',
  'generate_ai_asset',
  'generative_expand_asset',
  'create_creative_variants',
  'apply_layer_effects',
  'manage_layers',
  'apply_text_style',
  'manage_pages',
  'transform_layer',
  'convert_color_mode',
  'manage_tables',
  'resolve_fonts',
  'manage_artboards',
  'manage_hyperlinks',
  'build_toc',
  'manage_text_flow',
  'manage_smart_objects',
  'manage_swatches',
]);

function uniqueRefs(refs: AppAutomationResearchRef[]): AppAutomationResearchRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.url)) return false;
    seen.add(ref.url);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
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
    vectorize: 'Vectorize/image-trace a raster asset',
    set_appearance: 'Set vector appearance (fill/stroke/swatch/recolor)',
    align: 'Align or distribute vector objects',
    arrange: 'Arrange vector object z-order',
    group: 'Group or ungroup vector objects',
    add_artboard: 'Add or resize an artboard',
    add_text: 'Add a vector text object',
    add_shape: 'Add a vector shape (rectangle/ellipse/line)',
  };
  return labels[operation];
}

function refsForGap(appId: DesignAppAutomationAppId, operation: DesignAppAutomationOperation): AppAutomationResearchRef[] {
  if (appId === 'adobe_indesign') {
    const refs = [
      APP_AUTOMATION_RESEARCH_REFS.indesignUxpScripts,
      INDESIGN_DOM_REF,
      INDESIGN_DOCUMENT_REF,
    ];
    if (operation === 'toggle_layer_visibility' || operation === 'manage_pages') refs.push(INDESIGN_LAYER_REF);
    if (operation === 'resize_layout') refs.push(INDESIGN_TEXT_FRAME_REF, INDESIGN_LAYER_REF);
    if (
      operation === 'apply_text_style'
      || operation === 'manage_tables'
      || operation === 'resolve_fonts'
      || operation === 'manage_hyperlinks'
      || operation === 'build_toc'
      || operation === 'manage_text_flow'
    ) refs.push(INDESIGN_TEXT_FRAME_REF);
    if (operation === 'generate_ai_asset' || operation === 'generative_expand_asset') refs.push(INDESIGN_APIS_REF, FIREFLY_API_REF, FIREFLY_API_REFERENCE_REF);
    if (operation === 'create_creative_variants') refs.push(INDESIGN_APIS_REF);
    return uniqueRefs(refs);
  }

  const refs = [
    APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
    APP_AUTOMATION_RESEARCH_REFS.photoshopExecuteAsModal,
    PHOTOSHOP_LAYER_REF,
  ];
  if (
    operation === 'edit_adjustment_layers'
    || operation === 'apply_selection_or_mask'
    || operation === 'generative_fill_or_remove'
    || operation === 'generate_ai_asset'
    || operation === 'generative_expand_asset'
    || operation === 'create_creative_variants'
    || operation === 'apply_layer_effects'
    || operation === 'manage_layers'
    || operation === 'transform_layer'
    || operation === 'convert_color_mode'
    || operation === 'manage_artboards'
    || operation === 'manage_smart_objects'
  ) {
    refs.push(PHOTOSHOP_BATCHPLAY_REF);
  }
  if (operation === 'generate_ai_asset' || operation === 'generative_expand_asset' || operation === 'create_creative_variants') {
    refs.push(APP_AUTOMATION_RESEARCH_REFS.photoshopApi, FIREFLY_API_REF, FIREFLY_API_REFERENCE_REF);
  }
  return uniqueRefs(refs);
}

function inDesignGap(plan: DesignAppAutomationPlan, operation: DesignAppAutomationOperation): DesignAppAdapterGapContract | null {
  // Deterministic InDesign structural ops (paragraph/character styles, page
  // management, tables, font activation/substitution) — script-backed via the
  // InDesign DOM, same shape as resize. Each carries an operation-specific spec
  // so the contract names the real target/mutation instead of a one-size
  // ternary that grows unreadable as more ops land here.
  const deterministicSpecByOperation: Partial<Record<DesignAppAutomationOperation, {
    tool: string;
    beforeAfterEvidence: string;
    targetEvidence: string;
    approvalMutation: string;
    ambiguityStop: string;
    refusalSmoke: string;
  }>> = {
    apply_text_style: {
      tool: 'desktop.indesign_apply_text_style',
      beforeAfterEvidence: 'before/after text inventory with the target story/frame/paragraph range and the applied style name',
      targetEvidence: 'target paragraph/character/object style name and whether it is applied or (re)defined',
      approvalMutation: 'applying or redefining paragraph/character/object styles',
      ambiguityStop: 'stop if the target text range or style name is ambiguous or undefined',
      refusalSmoke: 'refuses ambiguous style targets and undefined style names without approval',
    },
    manage_pages: {
      tool: 'desktop.indesign_manage_pages',
      beforeAfterEvidence: 'before/after document status with page/spread count, order, and master/parent assignments',
      targetEvidence: 'target page/spread id plus the requested add/delete/move/duplicate or master-apply action',
      approvalMutation: 'adding/deleting/moving pages or changing master/parent assignments',
      ambiguityStop: 'stop if the target page/spread or master is ambiguous',
      refusalSmoke: 'refuses ambiguous page targets and master/parent changes without approval',
    },
    manage_tables: {
      tool: 'desktop.indesign_manage_tables',
      beforeAfterEvidence: 'before/after document status and table inventory with target table/cell range, row/column counts, and containing frame',
      targetEvidence: 'target table/frame plus the requested create/insert/delete/merge/split/populate action and the data source when populating',
      approvalMutation: 'creating, deleting, merging/splitting, formatting, or populating tables and cells',
      ambiguityStop: 'stop if the target table, cell range, or data source is ambiguous',
      refusalSmoke: 'refuses ambiguous table/cell targets and unmapped data sources without approval',
    },
    resolve_fonts: {
      tool: 'desktop.indesign_resolve_fonts',
      beforeAfterEvidence: 'before/after document font report listing missing/substituted fonts and the affected text ranges',
      targetEvidence: 'target font family/style and whether it is being activated, synced, or substituted (with the replacement font when substituting)',
      approvalMutation: 'activating/syncing fonts or substituting/replacing fonts across the document',
      ambiguityStop: 'stop if the target font, replacement font, or activation source is ambiguous',
      refusalSmoke: 'refuses ambiguous font targets and unapproved substitutions',
    },
    manage_hyperlinks: {
      tool: 'desktop.indesign_manage_hyperlinks',
      beforeAfterEvidence: 'before/after hyperlink/cross-reference inventory with source text range and destination (URL, page, anchor, or file)',
      targetEvidence: 'target source range plus the requested add/update/delete action and the resolved destination',
      approvalMutation: 'adding, updating, or deleting hyperlinks, cross-references, or bookmarks',
      ambiguityStop: 'stop if the source range or hyperlink destination is ambiguous or unresolved',
      refusalSmoke: 'refuses ambiguous source ranges and unresolved destinations without approval',
    },
    build_toc: {
      tool: 'desktop.indesign_build_toc',
      beforeAfterEvidence: 'before/after document status with the TOC/index style, source paragraph styles, and target frame/page',
      targetEvidence: 'TOC/index style name, the source styles it gathers, and the target frame/story for the generated list',
      approvalMutation: 'generating or regenerating a table of contents, index, or running-header variable',
      ambiguityStop: 'stop if the TOC/index style or source paragraph styles are ambiguous or undefined',
      refusalSmoke: 'refuses ambiguous TOC/index styles and undefined source styles without approval',
    },
    manage_text_flow: {
      tool: 'desktop.indesign_manage_text_flow',
      beforeAfterEvidence: 'before/after text inventory with the story/thread chain, frame order, and overset state per frame',
      targetEvidence: 'target story/frame thread plus the requested thread/unthread/autoflow/overset-fix action',
      approvalMutation: 'threading/unthreading frames, autoflowing text, or adding frames/pages to clear overset',
      ambiguityStop: 'stop if the target story, frame thread, or flow order is ambiguous',
      refusalSmoke: 'refuses ambiguous story/frame threads and unresolved overset without approval',
    },
    manage_swatches: {
      tool: 'desktop.indesign_manage_swatches',
      beforeAfterEvidence: 'before/after swatch/ink inventory with swatch names, color values/space, spot vs process, and affected objects',
      targetEvidence: 'target swatch/ink name plus the requested add/edit/delete/convert action and the destination color value/space',
      approvalMutation: 'adding, editing, deleting, or converting swatches, spot colors, or ink settings',
      ambiguityStop: 'stop if the target swatch, color value, or spot/process intent is ambiguous',
      refusalSmoke: 'refuses ambiguous swatch targets and undefined color values without approval',
    },
  };
  const spec = deterministicSpecByOperation[operation];
  if (spec) {
    const sourceRefs = refsForGap(plan.appId, operation);
    const requiredBridgeToolsBeforeRetry = uniqueStrings([
      'desktop.indesign_document_status',
      'desktop.indesign_text_inventory',
      spec.tool,
      'desktop.indesign_export_proof',
    ]);
    const requiredEvidence = [
      spec.beforeAfterEvidence,
      spec.targetEvidence,
      'before/after text inventory proving no unexpected overset or reflow',
      'proof export or screenshot after the change',
    ];
    const focusedSmokeCases = [
      `routes InDesign ${operation.replace(/_/g, ' ')} prompt to the ${operation} adapter gap`,
      'requires document status and text inventory before mutation',
      spec.refusalSmoke,
      'verifies no unexpected overset and proof/file evidence before ready_to_retry',
    ];
    const buildoutTrigger = `Build an InDesign ${operation.replace(/_/g, ' ')} adapter before retrying this operation.`;
    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      adapterId: `indesign.${operation}.uxp_dom`,
      controlSurface: 'InDesign UXP script backed by the InDesign DOM',
      missingBridgeTools: [spec.tool],
      existingPrerequisiteTools: EXISTING_TOOLS.adobe_indesign.slice(),
      requiredBridgeToolsBeforeRetry,
      officialSourceRefs: sourceRefs,
      approvalBefore: [
        'running new InDesign script/adapter code',
        spec.approvalMutation,
        'saving, exporting, or packaging the document',
      ],
      requiredEvidence,
      focusedSmokeCases,
      failClosedRules: [
        'stop if the active InDesign document does not match the staged file/package',
        spec.ambiguityStop,
        'stop if the action requires locked/master/hidden objects and approval is missing',
        'stop if post-change inventory reports overset text, missing links/fonts, or absent proof evidence',
        'do not fall back to blind coordinates for layout mutation',
      ],
      buildoutTrigger,
      connectedAgentTask: [
        buildoutTrigger,
        `Add or propose ${spec.tool} using InDesign UXP scripts and DOM APIs.`,
        'Extend existing desktop bridge/OpenSwan routing instead of creating a parallel runtime.',
        `Use source refs: ${sourceRefs.map((ref) => `${ref.label} ${ref.url}`).join(' | ')}`,
        `Return ready_to_retry only after these smoke cases pass: ${focusedSmokeCases.join(' | ')}`,
      ].join(' '),
      retryPrompt: [
        `Retry the ${plan.appName} task after ${spec.tool} is available.`,
        'Re-open or re-focus the staged document, collect fresh document status and text inventory, request approval, perform the mutation, then verify with refreshed inventory and proof evidence.',
      ].join(' '),
    };
  }

  if (operation !== 'resize_layout') {
    const missingToolByOperation: Partial<Record<DesignAppAutomationOperation, string>> = {
      generate_ai_asset: 'desktop.indesign_generate_image_for_frame',
      generative_expand_asset: 'desktop.indesign_generative_expand_asset',
      create_creative_variants: 'desktop.indesign_data_merge_variants',
    };
    const missingTool = missingToolByOperation[operation];
    if (!missingTool) return null;
    const sourceRefs = refsForGap(plan.appId, operation);
    const isVariant = operation === 'create_creative_variants';
    const requiredBridgeToolsBeforeRetry = uniqueStrings([
      'desktop.indesign_document_status',
      'desktop.indesign_text_inventory',
      missingTool,
      'desktop.indesign_export_proof',
    ]);
    const requiredEvidence = [
      'before/after active document status with target frame/link/layer evidence',
      isVariant
        ? 'template, CSV/data-source schema, variant count, and output naming summary'
        : 'approved creative prompt, target frame/link, generated asset receipt, and output file_stat',
      'post-change link/text inventory proving the generated or variant asset was placed in the intended target',
      'proof export or screenshot after creative AI operation',
    ];
    const focusedSmokeCases = [
      `routes InDesign ${operation} prompt to ${operation} adapter gap`,
      'requires document status and text/link inventory before generation or merge',
      isVariant ? 'refuses ambiguous CSV field mapping or missing variant count' : 'refuses ambiguous target frame/link/layer and missing generation receipt',
      'verifies proof/file evidence before ready_to_retry',
    ];
    const buildoutTrigger = `Build an InDesign ${operation.replace(/_/g, ' ')} adapter before retrying this creative AI operation.`;

    return {
      appId: plan.appId,
      appName: plan.appName,
      operation,
      label: operationLabel(operation),
      adapterId: `indesign.${operation}.creative_ai`,
      controlSurface: isVariant
        ? 'InDesign Data Merge API or UXP DOM script workflow'
        : 'InDesign UXP DOM plus Firefly/Adobe API generated asset workflow',
      missingBridgeTools: [missingTool],
      existingPrerequisiteTools: EXISTING_TOOLS.adobe_indesign.slice(),
      requiredBridgeToolsBeforeRetry,
      officialSourceRefs: sourceRefs,
      approvalBefore: [
        'running new InDesign script/adapter code',
        isVariant ? 'uploading template/CSV and writing batch variants' : 'AI image generation, generative expand, cloud upload, generated asset placement, or relink',
        'saving, exporting, or packaging the document',
      ],
      requiredEvidence,
      focusedSmokeCases,
      failClosedRules: [
        'stop if the active InDesign document does not match the staged file/package',
        isVariant ? 'stop if CSV/data source mapping, variant count, or output naming is ambiguous' : 'stop if target frame/link/layer or generated asset receipt is missing',
        'stop if approval is missing for AI generation, data merge, cloud upload, relink, save, export, or new-adapter actions',
        'do not fall back to blind coordinates for creative AI document mutation',
      ],
      buildoutTrigger,
      connectedAgentTask: [
        buildoutTrigger,
        `Add or propose ${missingTool} using InDesign UXP scripts, Adobe InDesign APIs, and Firefly Services where needed.`,
        'Extend existing desktop bridge/OpenSwan routing instead of creating a parallel runtime.',
        `Use source refs: ${sourceRefs.map((ref) => `${ref.label} ${ref.url}`).join(' | ')}`,
        `Return ready_to_retry only after these smoke cases pass: ${focusedSmokeCases.join(' | ')}`,
      ].join(' '),
      retryPrompt: [
        `Retry the ${plan.appName} task after ${missingTool} is available.`,
        'Re-open or re-focus the staged document, collect fresh status/inventory, request approval, run the creative AI adapter, then verify with refreshed inventory and proof evidence.',
      ].join(' '),
    };
  }
  const missingTool = 'desktop.indesign_resize_layout';
  const verificationTool = 'desktop.indesign_export_proof';
  const sourceRefs = refsForGap(plan.appId, operation);
  const requiredBridgeToolsBeforeRetry = uniqueStrings([
    'desktop.indesign_document_status',
    'desktop.indesign_text_inventory',
    missingTool,
    verificationTool,
  ]);
  const requiredEvidence = [
    'before/after active document status with page/spread dimensions',
    'target page, spread, layer, or text-frame id/name/label',
    'before/after text inventory proving no unexpected overset text',
    'proof export or screenshot after resize',
  ];
  const focusedSmokeCases = [
    'routes InDesign resize/banner-size prompt to resize_layout adapter gap',
    'requires document status and text inventory before resize mutation',
    'refuses ambiguous page/text-frame targets and locked/master objects without approval',
    'verifies no overset text and proof/file evidence before ready_to_retry',
  ];
  const buildoutTrigger = 'Build an InDesign resize/layout adapter before retrying this operation.';

  return {
    appId: plan.appId,
    appName: plan.appName,
    operation,
    label: operationLabel(operation),
    adapterId: 'indesign.resize_layout.uxp_dom',
    controlSurface: 'InDesign UXP script backed by the InDesign DOM',
    missingBridgeTools: [missingTool],
    existingPrerequisiteTools: EXISTING_TOOLS.adobe_indesign.slice(),
    requiredBridgeToolsBeforeRetry,
    officialSourceRefs: sourceRefs,
    approvalBefore: [
      'running new InDesign script/adapter code',
      'changing page/object/text-frame geometry',
      'saving, exporting, or packaging the document',
    ],
    requiredEvidence,
    focusedSmokeCases,
    failClosedRules: [
      'stop if the active InDesign document does not match the staged file/package',
      'stop if the target page, spread, layer, or text frame is ambiguous',
      'stop if the action requires locked/master/hidden objects and approval is missing',
      'stop if post-change inventory reports overset text, missing links/fonts, or absent proof evidence',
      'do not fall back to blind coordinates for layout mutation',
    ],
    buildoutTrigger,
    connectedAgentTask: [
      buildoutTrigger,
      `Add or propose ${missingTool} using InDesign UXP scripts and DOM APIs.`,
      'Extend existing desktop bridge/OpenSwan routing instead of creating a parallel runtime.',
      `Use source refs: ${sourceRefs.map((ref) => `${ref.label} ${ref.url}`).join(' | ')}`,
      `Return ready_to_retry only after these smoke cases pass: ${focusedSmokeCases.join(' | ')}`,
    ].join(' '),
    retryPrompt: [
      `Retry the ${plan.appName} task after ${missingTool} is available.`,
      'Re-open or re-focus the staged document, collect fresh document status and text inventory, request approval, perform the mutation, then verify with refreshed inventory and proof evidence.',
    ].join(' '),
  };
}

function photoshopGap(plan: DesignAppAutomationPlan, operation: DesignAppAutomationOperation): DesignAppAdapterGapContract | null {
  const missingToolByOperation: Partial<Record<DesignAppAutomationOperation, string>> = {
    // P15: resize_layout, edit_adjustment_layers, and apply_selection_or_mask
    // are IMPLEMENTED (ExtendScript adapters in scripts/claude-bridge.js via
    // src/lib/photoshopExtendScriptAdapters.ts) — they are deliberately absent
    // here so no buildout gap is filed for them. InDesign's resize_layout gap
    // lives in inDesignGap and is unaffected.
    generative_fill_or_remove: 'desktop.photoshop_generative_fill_or_remove',
    generate_ai_asset: 'desktop.firefly_generate_image_asset',
    generative_expand_asset: 'desktop.photoshop_generative_expand',
    create_creative_variants: 'desktop.firefly_batch_generate_variants',
    apply_layer_effects: 'desktop.photoshop_apply_layer_effects',
    // P16: manage_layers, transform_layer, and convert_color_mode are
    // IMPLEMENTED ExtendScript adapters — deliberately absent so no
    // buildout gap is filed for them.
    manage_artboards: 'desktop.photoshop_manage_artboards',
    manage_smart_objects: 'desktop.photoshop_manage_smart_objects',
  };
  const missingTool = missingToolByOperation[operation];
  if (!missingTool) return null;

  const sourceRefs = refsForGap(plan.appId, operation);
  const isLocalized = operation === 'apply_selection_or_mask' || operation === 'generative_fill_or_remove';
  const isAdjustment = operation === 'edit_adjustment_layers';
  const isCreativeAiAsset = operation === 'generate_ai_asset' || operation === 'generative_expand_asset' || operation === 'create_creative_variants';
  const requiredBridgeToolsBeforeRetry = uniqueStrings([
    'desktop.photoshop_document_status',
    'desktop.photoshop_layer_inventory',
    missingTool,
    'desktop.photoshop_export_proof',
  ]);
  const requiredEvidence = [
    'before/after active document status with dimensions, selection state, color mode/profile, and saved/modified state',
    'before/after layer inventory with target layer id/name/type, lock, visibility, mask, smart-object, and adjustment-layer state',
    isLocalized ? 'selection/mask target evidence plus screenshot before localized pixel mutation' : '',
    isAdjustment ? 'adjustment descriptor/settings or new adjustment-layer receipt' : '',
    isCreativeAiAsset ? 'approved prompt/variant matrix, generation receipt, output file_stat, and placed/generated layer evidence' : '',
    'raster proof or screenshot after mutation, plus output file_stat when exporting',
  ].filter(Boolean);
  const focusedSmokeCases = [
    `routes Photoshop ${operation} prompt to ${operation} adapter gap`,
    'requires document status and layer inventory before mutation',
    isLocalized ? 'refuses generative/content-aware edits when selection or mask target evidence is missing' : '',
    isAdjustment ? 'refuses destructive/filter edits unless an adjustment-layer or duplicate-layer plan is approved' : '',
    isCreativeAiAsset ? 'refuses generated asset or variant workflows without prompt, receipt, and proof evidence' : '',
    'requires executeAsModal/batchPlay or DOM-backed action receipt before ready_to_retry',
    'verifies refreshed layer inventory and raster proof before ready_to_retry',
  ].filter(Boolean);
  const controlSurface = isCreativeAiAsset
    ? 'Firefly/Photoshop API plus Photoshop UXP placement/export verification'
    : operation === 'resize_layout' || operation === 'toggle_layer_visibility'
    ? 'Photoshop UXP DOM/app API inside executeAsModal'
    : 'Photoshop batchPlay/action descriptor inside executeAsModal';
  const buildoutTrigger = `Build a Photoshop ${operation.replace(/_/g, ' ')} adapter before retrying this operation.`;

  return {
    appId: plan.appId,
    appName: plan.appName,
    operation,
    label: operationLabel(operation),
    adapterId: `photoshop.${operation}.uxp_modal`,
    controlSurface,
    missingBridgeTools: [missingTool],
    existingPrerequisiteTools: EXISTING_TOOLS.adobe_photoshop.slice(),
    requiredBridgeToolsBeforeRetry,
    officialSourceRefs: sourceRefs,
    approvalBefore: [
      'running new Photoshop script/action/adapter code',
      isCreativeAiAsset ? 'AI generation, generative expand, batch variants, generated asset placement, or cloud processing' : isLocalized ? 'localized pixel edit or generative/content-aware action' : 'document/layer mutation',
      'destructive edits, flattening, rasterizing, deleting, saving, or exporting',
    ],
    requiredEvidence,
    focusedSmokeCases,
    failClosedRules: [
      'stop if the active Photoshop document does not match the staged file/package',
      isLocalized ? 'stop if selection/mask target missing before localized pixel mutation' : '',
      isCreativeAiAsset ? 'stop if prompt, variant matrix, generated asset receipt, or output file evidence is missing' : '',
      'stop if the target layer, adjustment, selection, or mask is ambiguous',
      'stop if executeAsModal/action receipt is missing for document mutation',
      'stop if approval is missing for destructive, generative, save, export, or new-adapter actions',
      'do not use blind sliders, menus, or coordinates when a deterministic adapter is missing',
    ].filter(Boolean),
    buildoutTrigger,
    connectedAgentTask: [
      buildoutTrigger,
      `Add or propose ${missingTool} using ${isCreativeAiAsset ? 'Firefly/Photoshop APIs plus Photoshop UXP placement/export verification' : `Photoshop UXP scripting${controlSurface.includes('batchPlay') ? ', batchPlay,' : ''} and executeAsModal`}.`,
      'Extend existing desktop bridge/OpenSwan routing instead of creating a parallel runtime.',
      `Use source refs: ${sourceRefs.map((ref) => `${ref.label} ${ref.url}`).join(' | ')}`,
      `Return ready_to_retry only after these smoke cases pass: ${focusedSmokeCases.join(' | ')}`,
    ].join(' '),
    retryPrompt: [
      `Retry the ${plan.appName} task after ${missingTool} is available.`,
      'Re-open or re-focus the staged document, collect fresh document status and layer inventory, request approval, perform the mutation in modal scope, then verify with refreshed inventory and raster proof evidence.',
    ].join(' '),
  };
}

export function buildDesignAppAdapterGapContract(
  plan: DesignAppAutomationPlan,
  operation: DesignAppAutomationOperation,
): DesignAppAdapterGapContract | null {
  if (!GAP_OPERATIONS.has(operation)) return null;
  return plan.appId === 'adobe_indesign'
    ? inDesignGap(plan, operation)
    : photoshopGap(plan, operation);
}

export function buildDesignAppAdapterGapPlan(task: string): DesignAppAdapterGapPlan | null {
  const plan = buildDesignAppAutomationPlan(task);
  if (!plan) return null;
  const gaps = plan.operations
    .map((operation) => buildDesignAppAdapterGapContract(plan, operation))
    .filter((gap): gap is DesignAppAdapterGapContract => Boolean(gap));
  if (gaps.length === 0) return null;
  const sourceRefs = uniqueRefs(gaps.flatMap((gap) => gap.officialSourceRefs));
  return {
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    operations: plan.operations,
    gaps,
    promptSummary: `${plan.appName} adapter gaps: ${gaps.map((gap) => `${gap.operation} -> ${gap.missingBridgeTools.join('/')}`).join(' | ')}`,
    sourceRefs,
  };
}

function formatGap(gap: DesignAppAdapterGapContract): string[] {
  return [
    `### ${gap.label}`,
    `Adapter id: ${gap.adapterId}`,
    `Operation: ${gap.operation}`,
    `Control surface: ${gap.controlSurface}`,
    `Missing tools: ${gap.missingBridgeTools.join(' | ')}`,
    `Required before retry: ${gap.requiredBridgeToolsBeforeRetry.join(' | ')}`,
    `Approval before: ${gap.approvalBefore.join(' | ')}`,
    `Required evidence: ${gap.requiredEvidence.join(' | ')}`,
    `Smoke cases: ${gap.focusedSmokeCases.join(' | ')}`,
    `Fail closed: ${gap.failClosedRules.join(' | ')}`,
    `Connected-agent task: ${gap.connectedAgentTask}`,
    `Retry prompt: ${gap.retryPrompt}`,
  ];
}

export function buildDesignAppAdapterGapPromptBlock(task: string, opts: { maxGaps?: number } = {}): string | null {
  const plan = buildDesignAppAdapterGapPlan(task);
  if (!plan) return null;
  const gaps = plan.gaps.slice(0, opts.maxGaps ?? 6);
  return [
    '## Design App Adapter Gap Contracts',
    `Summary: ${plan.promptSummary}`,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label} <${ref.url}>`).join(' | ')}`,
    ...gaps.flatMap(formatGap),
    'If a listed adapter is missing, call agent.build_app_capability with the connected-agent task instead of attempting blind desktop control.',
  ].join('\n');
}
