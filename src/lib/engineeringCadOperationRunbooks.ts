import {
  APP_AUTOMATION_RESEARCH_REFS,
  buildAppAutomationControlSurfacePlan,
  type AppAutomationResearchRef,
} from './appAutomationControlSurfaces';

export type EngineeringCadOperationRunbookPhase =
  | 'observe'
  | 'approve'
  | 'act'
  | 'verify'
  | 'recover'
  | 'stop';

export type EngineeringCadOperationRisk = 'read_only' | 'review' | 'high';

export type EngineeringCadOperation =
  | 'inspect_measure'
  | 'draft_2d_geometry'
  | 'update_dimensions_layers'
  | 'model_or_bim_edit'
  | 'export_plot'
  | 'batch_convert_or_translate';

export interface EngineeringCadRunbookStep {
  phase: EngineeringCadOperationRunbookPhase;
  title: string;
  tool?: string;
  required: boolean;
  approvalRequired: boolean;
  detail: string;
  evidence: string[];
}

export interface EngineeringCadOperationRunbook {
  targetName: string;
  operation: EngineeringCadOperation;
  label: string;
  risk: EngineeringCadOperationRisk;
  controlSurface: string;
  requiredInputs: string[];
  approvalBefore: string[];
  steps: EngineeringCadRunbookStep[];
  successCriteria: string[];
  failClosedConditions: string[];
  fallbackBuildoutTrigger: string;
  userVisibleSummary: string;
  sourceRefs: AppAutomationResearchRef[];
}

export interface EngineeringCadOperationRunbookPlan {
  targetName: string;
  taskFamily: string;
  operations: EngineeringCadOperation[];
  runbooks: EngineeringCadOperationRunbook[];
  promptSummary: string;
  sourceRefs: AppAutomationResearchRef[];
}

function normalize(value: string): string {
  return String(value || '').toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function step(
  phase: EngineeringCadOperationRunbookPhase,
  title: string,
  detail: string,
  opts: {
    tool?: string;
    required?: boolean;
    approvalRequired?: boolean;
    evidence?: string[];
  } = {},
): EngineeringCadRunbookStep {
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

function isEngineeringCadTask(task: string): boolean {
  return buildAppAutomationControlSurfacePlan(task).targetId === 'engineering_cad_app';
}

function detectOperations(task: string): EngineeringCadOperation[] {
  const text = normalize(task);
  const operations: EngineeringCadOperation[] = [];
  if (/\b(inspect|measure|dimension check|verify|review|check|audit|units?|scale|tolerance|clearance|area|length|count)\b/i.test(text)) {
    operations.push('inspect_measure');
  }
  if (/\b(create|draw|draft|floor plan|site plan|shop drawing|technical drawing|2d|polyline|linework|wall|room|revision cloud|detail|title block)\b/i.test(text)) {
    operations.push('draft_2d_geometry');
  }
  if (/\b(layer|block|dimensions?|annotation|label|title block|sheet|view|paper space|model space|style|linetype|lineweight)\b/i.test(text)) {
    operations.push('update_dimensions_layers');
  }
  if (/\b(model|part|assembly|component|body|sketch|extrude|loft|feature|parameter|bim|family|revit|fusion|solidworks|inventor|rhino|cam|toolpath)\b/i.test(text)) {
    operations.push('model_or_bim_edit');
  }
  if (/\b(export|plot|publish|print|pdf|dwg|dxf|step|stp|iges|igs|stl|sat|save as|render|output)\b/i.test(text)) {
    operations.push('export_plot');
  }
  if (/\b(batch|bulk|folder of|many files|convert|translate|automation api|server|cloud|pipeline|rendition)\b/i.test(text)) {
    operations.push('batch_convert_or_translate');
  }
  return operations.length ? unique(operations).slice(0, 6) : ['inspect_measure'];
}

function operationLabel(operation: EngineeringCadOperation): string {
  const labels: Record<EngineeringCadOperation, string> = {
    inspect_measure: 'Inspect units, dimensions, layers, and model state',
    draft_2d_geometry: 'Draft or revise 2D CAD geometry',
    update_dimensions_layers: 'Update dimensions, layers, annotations, or title blocks',
    model_or_bim_edit: 'Edit model, assembly, component, or BIM element state',
    export_plot: 'Export, plot, publish, or save CAD deliverable',
    batch_convert_or_translate: 'Batch convert or translate design files',
  };
  return labels[operation];
}

function riskForOperation(operation: EngineeringCadOperation): EngineeringCadOperationRisk {
  if (operation === 'inspect_measure') return 'read_only';
  if (operation === 'export_plot' || operation === 'batch_convert_or_translate' || operation === 'model_or_bim_edit') return 'high';
  return 'review';
}

function sourceRefsForPlan(task: string): AppAutomationResearchRef[] {
  const plan = buildAppAutomationControlSurfacePlan(task);
  return unique([
    ...plan.sourceRefs,
    APP_AUTOMATION_RESEARCH_REFS.appleUiScripting,
    APP_AUTOMATION_RESEARCH_REFS.windowsUiAutomation,
  ]).slice(0, 8);
}

function commonObserveSteps(targetName: string): EngineeringCadRunbookStep[] {
  return [
    step('observe', 'Resolve source and output files', `Verify the staged CAD/model source, sidecar/xref folder, and intended output folder before opening ${targetName}.`, {
      tool: 'desktop.file_stat',
      evidence: ['source file exists', 'sidecar/xref folder known when present', 'output folder grant known when writing'],
    }),
    step('observe', 'Confirm active app and document', `Launch or focus ${targetName}, then confirm the active window, drawing/model name, and file path before any command input.`, {
      tool: 'desktop.window_state',
      evidence: ['active app identity', 'active document/window title', 'file path or staged source identity'],
    }),
    step('observe', 'Capture command/UI state', 'Read accessibility/menu state for command line, palettes, panels, dialogs, sheets, and export windows before typing or clicking.', {
      tool: 'desktop.read_a11y_tree',
      evidence: ['command prompt or dialog state', 'unique control/menu identity'],
    }),
    step('observe', 'Capture visual geometry state', 'Capture a screenshot to verify drawing/model contents, units indicators, selected objects, and visible command feedback.', {
      tool: 'desktop.screenshot',
      evidence: ['drawing/model visual proof', 'selection or command feedback when visible'],
    }),
  ];
}

function approvalStep(detail: string): EngineeringCadRunbookStep {
  return step('approve', 'Request approval before CAD mutation', detail, {
    tool: 'approvals.request',
    approvalRequired: true,
    evidence: ['approval id', 'approved operation and destination scope'],
  });
}

function buildRunbook(task: string, operation: EngineeringCadOperation): EngineeringCadOperationRunbook {
  const plan = buildAppAutomationControlSurfacePlan(task);
  const controlSurface = plan.candidates[0]?.label || 'Documented CAD vendor script/plugin/CLI/API surface';
  const targetName = plan.targetName;
  const sourceRefs = sourceRefsForPlan(task);
  const common = commonObserveSteps(targetName);
  const risk = riskForOperation(operation);

  if (operation === 'inspect_measure') {
    return {
      targetName,
      operation,
      label: operationLabel(operation),
      risk,
      controlSurface,
      requiredInputs: ['staged CAD/model file', 'active app/document identity', 'units/scale target', 'measurement or review question'],
      approvalBefore: [],
      steps: [
        ...common,
        step('act', 'Run read-only measure/list commands', 'Use app-native measure/list/layer/object commands or verified menu actions only; do not mutate geometry.', {
          tool: 'desktop.type_text',
          evidence: ['command result transcript or visible status', 'units and measurement values'],
        }),
        step('verify', 'Return measured state with uncertainty', 'Verify dimensions, units, layer/object counts, and any ambiguous visual geometry before summarizing.', {
          evidence: ['units/dimensions/layers summary', 'screenshot proof when visual review matters'],
        }),
      ],
      successCriteria: ['active document is verified', 'units and measured values are cited', 'ambiguous measurements are marked as needing human confirmation'],
      failClosedConditions: ['active file mismatch', 'units or scale unknown', 'measurement command unavailable', 'geometry hidden or ambiguous'],
      fallbackBuildoutTrigger: 'If read-only measure/list state cannot be collected, build a CAD inspection adapter before reporting dimensions.',
      userVisibleSummary: 'The CAD file is inspected with units, dimensions, and ambiguity called out.',
      sourceRefs,
    };
  }

  if (operation === 'draft_2d_geometry') {
    return {
      targetName,
      operation,
      label: operationLabel(operation),
      risk,
      controlSurface,
      requiredInputs: ['active drawing identity', 'units/scale/origin', 'geometry requirements', 'layer and annotation targets'],
      approvalBefore: ['creating or editing drawing geometry', 'running CAD script/command sequence', 'saving or exporting deliverables'],
      steps: [
        ...common,
        approvalStep('Geometry creation changes the drawing; request approval after showing the planned commands, units, layer, and output target.'),
        step('act', 'Execute one precise drafting step', 'Use app-native script/API/command input with explicit coordinates, lengths, angles, or named layer targets. Avoid freehand coordinates.', {
          tool: 'desktop.type_text',
          approvalRequired: true,
          evidence: ['command/script input', 'target layer and units', 'one-step command result'],
        }),
        step('verify', 'Verify drafted geometry', 'Re-check screenshot, command feedback, dimensions, layers, and object count before the next drafting step.', {
          evidence: ['post-step screenshot', 'dimension/layer/object evidence'],
        }),
      ],
      successCriteria: ['geometry matches requested units and dimensions', 'target layer/title state is correct', 'output remains unsaved until approved'],
      failClosedConditions: ['units/scale/origin unknown', 'command failed or produced unexpected geometry', 'target layer ambiguous', 'approval missing'],
      fallbackBuildoutTrigger: 'If no deterministic CAD command/script route exists, delegate a focused CAD drafting adapter buildout before drawing by UI coordinates.',
      userVisibleSummary: '2D CAD edits are sequenced as verified command steps with approval before mutation/output.',
      sourceRefs,
    };
  }

  if (operation === 'update_dimensions_layers') {
    return {
      targetName,
      operation,
      label: operationLabel(operation),
      risk,
      controlSurface,
      requiredInputs: ['target layer/block/dimension/title-block identity', 'active drawing/model identity', 'expected before/after value'],
      approvalBefore: ['changing dimensions, annotations, layers, blocks, title blocks, views, or sheets', 'running macros/scripts', 'saving/exporting outputs'],
      steps: [
        ...common,
        approvalStep('Layer, dimension, annotation, and title-block edits can affect client or permit deliverables.'),
        step('act', 'Update named CAD object state', 'Use app API/script/command or verified menu/dialog state to change only the named target.', {
          tool: 'desktop.type_text',
          approvalRequired: true,
          evidence: ['target object identity', 'before value', 'after command/result'],
        }),
        step('verify', 'Verify target changed and neighbors did not', 'Re-observe target layer/dimension/title-block state and capture proof for the changed region.', {
          evidence: ['changed target state', 'screenshot proof', 'no broad unexpected changes'],
        }),
      ],
      successCriteria: ['exact target was matched once', 'requested value/state changed', 'unrelated layers/objects are not changed'],
      failClosedConditions: ['target object ambiguous', 'locked/frozen layer blocks edit', 'dimension/title-block state cannot be verified', 'approval missing'],
      fallbackBuildoutTrigger: 'If target object enumeration is missing, build a read/update CAD object adapter before editing.',
      userVisibleSummary: 'Named CAD dimensions, layers, annotations, or title-block fields are updated only after target verification.',
      sourceRefs,
    };
  }

  if (operation === 'model_or_bim_edit') {
    return {
      targetName,
      operation,
      label: operationLabel(operation),
      risk,
      controlSurface,
      requiredInputs: ['active model/assembly/BIM document identity', 'component/body/element/family/configuration target', 'units/tolerance/worksharing or configuration state'],
      approvalBefore: ['model, assembly, feature, family, BIM element, CAM, or parameter mutation', 'sync/save/export/manufacturing deliverable', 'running add-ins/scripts'],
      steps: [
        ...common,
        approvalStep('Model and BIM edits can affect production, manufacturing, or permit deliverables.'),
        step('act', 'Run app-native model/BIM operation', 'Use the dedicated API/add-in/script route for the target app when available; otherwise build the adapter before retrying.', {
          tool: 'agent.build_app_capability',
          approvalRequired: true,
          evidence: ['chosen app-native API/add-in/script route', 'target element/body/configuration identity', 'adapter smoke when newly built'],
        }),
        step('verify', 'Verify model or BIM state', 'Re-check active document, target element/body/configuration, dimensions/parameters, visual proof, and output file status if written.', {
          evidence: ['target state after mutation', 'parameter/dimension evidence', 'proof screenshot or export file_stat'],
        }),
      ],
      successCriteria: ['target model/BIM entity identity is verified', 'requested parameter/geometry state is proven', 'worksharing/configuration constraints are respected'],
      failClosedConditions: ['target entity ambiguous', 'worksharing/model lock unclear', 'units/tolerance unknown', 'no app-native adapter for requested mutation'],
      fallbackBuildoutTrigger: 'If the app lacks a verified model/BIM adapter, build the smallest app-specific adapter with official docs and a smoke before retry.',
      userVisibleSummary: 'Model/BIM edits require app-native adapter evidence and explicit approval before mutation.',
      sourceRefs,
    };
  }

  if (operation === 'batch_convert_or_translate') {
    return {
      targetName,
      operation,
      label: operationLabel(operation),
      risk,
      controlSurface,
      requiredInputs: ['approved source batch/folder', 'approved output folder', 'conversion format', 'cloud/API credential state when needed'],
      approvalBefore: ['uploading design files', 'batch conversion', 'writing output files', 'using cloud automation credentials'],
      steps: [
        ...common.slice(0, 1),
        approvalStep('Batch or cloud conversion needs explicit source, output, upload, and credential approval.'),
        step('act', 'Run batch conversion route', 'Prefer APS/cloud/vendor CLI/API where approved; otherwise delegate a bounded conversion adapter buildout.', {
          tool: 'agent.build_app_capability',
          approvalRequired: true,
          evidence: ['source file list/count', 'conversion route', 'API/job or adapter smoke result'],
        }),
        step('verify', 'Verify converted outputs', 'Check output file count, basenames, sizes, and representative opened proof before completion.', {
          tool: 'desktop.file_stat',
          evidence: ['output file_stat list', 'job status or command result', 'representative proof'],
        }),
      ],
      successCriteria: ['source/output counts reconcile', 'converted files are written to approved destination', 'at least one representative output is verified'],
      failClosedConditions: ['upload not approved', 'API credentials missing', 'output folder not approved', 'source/output count mismatch'],
      fallbackBuildoutTrigger: 'If conversion route is missing, build a batch conversion adapter with source refs and smoke coverage before retry.',
      userVisibleSummary: 'Batch CAD conversion is treated as approved source/output processing with job and file-stat proof.',
      sourceRefs,
    };
  }

  return {
    targetName,
    operation,
    label: operationLabel(operation),
    risk,
    controlSurface,
    requiredInputs: ['active CAD app/document identity', 'approved output destination', 'requested export format/settings'],
    approvalBefore: ['plot/export/publish/save-as', 'overwriting deliverables', 'using cloud/API processing'],
    steps: [
      ...common,
      approvalStep('Export, plot, publish, and save-as operations write deliverables and need destination approval.'),
      step('act', 'Export or plot deliverable', 'Use app API/script/export command or verified export dialog with exact format, page/sheet/view, scale, and output path.', {
        tool: 'desktop.type_text',
        approvalRequired: true,
        evidence: ['export settings', 'output destination', 'command/dialog result'],
      }),
      step('verify', 'Verify output artifact', 'Check file_stat and open/preview the output when possible before reporting completion.', {
        tool: 'desktop.file_stat',
        evidence: ['output basename', 'file size/time', 'proof screenshot or opened output state'],
      }),
    ],
    successCriteria: ['export format/settings match request', 'output file exists in approved destination', 'proof artifact opens or is visually verified'],
    failClosedConditions: ['destination path unknown', 'export settings ambiguous', 'overwrite approval missing', 'output file_stat missing'],
    fallbackBuildoutTrigger: 'If export cannot be driven deterministically, build an export adapter or return the exact user action required.',
    userVisibleSummary: 'CAD export and plotting require approval, exact output settings, and file proof.',
    sourceRefs,
  };
}

export function buildEngineeringCadOperationRunbookPlan(task: string): EngineeringCadOperationRunbookPlan | null {
  if (!isEngineeringCadTask(task)) return null;
  const surfacePlan = buildAppAutomationControlSurfacePlan(task);
  const operations = detectOperations(task);
  const runbooks = operations.map((operation) => buildRunbook(task, operation));
  const sourceRefs = unique(runbooks.flatMap((runbook) => runbook.sourceRefs));
  return {
    targetName: surfacePlan.targetName,
    taskFamily: surfacePlan.taskFamily,
    operations,
    runbooks,
    promptSummary: `${surfacePlan.targetName} ${surfacePlan.taskFamily}: ${runbooks.map((runbook) => runbook.label).join(' -> ')}`,
    sourceRefs,
  };
}

export function buildEngineeringCadOperationRunbookPromptBlock(task: string, opts: { maxRunbooks?: number } = {}): string | null {
  const plan = buildEngineeringCadOperationRunbookPlan(task);
  if (!plan) return null;
  const runbooks = plan.runbooks.slice(0, opts.maxRunbooks ?? 6);
  const lines = [
    '## Engineering/CAD Operation Runbooks',
    `Summary: ${plan.promptSummary}`,
    `Operations: ${plan.operations.join(' | ')}`,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label} <${ref.url}>`).join(' | ')}`,
  ];
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
  }
  lines.push('Do not use coordinates for CAD mutation unless app-native/API/script/command, menu, and accessibility routes are unavailable, the step is reversible, and fresh screenshot plus screen size are cited.');
  return lines.join('\n');
}
