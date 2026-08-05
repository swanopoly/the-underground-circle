import {
  buildDesignAppAutomationPlan,
  type DesignAppAutomationAppId,
  type DesignAppAutomationOperation,
  type DesignAppAutomationPlan,
} from './designAppAutomation';
import { buildDesignAppAdapterGapPlan } from './designAppAdapterGaps';
import {
  buildDesignAppCreativeAiRecipePlan,
  type DesignAppCreativeAiRecipeId,
} from './designAppCreativeAi';
import {
  buildDesignAppOperationRunbookPlan,
  type DesignAppOperationRunbook,
  type DesignAppOperationRunbookPhase,
} from './designAppOperationRunbooks';
import { compileComputerSequenceProgram } from './computerSequenceProgramCore';

export type DesignAppExecutionPipelinePhaseId =
  | 'resolve_source_package'
  | 'prepare_app'
  | 'observe_document_inventory'
  | 'prepare_creative_ai_brief'
  | 'request_design_approval'
  | 'execute_design_mutations'
  | 'export_or_package_outputs'
  | 'verify_design_output'
  | 'recover_or_build_adapter';

export type DesignAppExecutionPipelineVisibility = 'hidden' | 'approval' | 'proof' | 'problem';

export interface DesignAppExecutionPipelinePhase {
  id: DesignAppExecutionPipelinePhaseId;
  label: string;
  description: string;
  operations: DesignAppAutomationOperation[];
  tools: string[];
  requiredEvidence: string[];
  approvalRequired: boolean;
  userVisibleWhen: DesignAppExecutionPipelineVisibility;
  failClosedRules: string[];
  recoveryAction: string;
}

export interface DesignAppExecutionPipelinePlan {
  appId: DesignAppAutomationAppId;
  appName: string;
  taskKind: DesignAppAutomationPlan['taskKind'];
  operations: DesignAppAutomationOperation[];
  phases: DesignAppExecutionPipelinePhase[];
  requiredToolSequence: string[];
  approvalTools: string[];
  mutationTools: string[];
  proofTools: string[];
  buildoutTools: string[];
  adapterGapOperations: DesignAppAutomationOperation[];
  creativeAiRecipeIds: DesignAppCreativeAiRecipeId[];
  nextVisibleAction: string;
  quietUserSummary: string;
  failClosedRules: string[];
}

const INSPECTION_OPERATIONS = new Set<DesignAppAutomationOperation>([
  'inspect_layers',
  'inspect_image_document',
]);

const OUTPUT_OPERATIONS = new Set<DesignAppAutomationOperation>([
  'export_proof',
  'export_raster_proof',
  'package_handoff',
]);

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractToolNames(value: string | null | undefined): string[] {
  const matches = String(value || '').match(/\b(?:desktop|agent|approvals|research)\.[a-z0-9_]+\b/gi) || [];
  return unique(matches.map((item) => item.toLowerCase()));
}

function toolsForRunbookPhases(
  runbooks: DesignAppOperationRunbook[],
  phases: DesignAppOperationRunbookPhase[],
  operations?: Set<DesignAppAutomationOperation>,
): string[] {
  const allowed = new Set(phases);
  return unique(
    runbooks
      .filter((runbook) => !operations || operations.has(runbook.operation))
      .flatMap((runbook) => runbook.steps)
      .filter((step) => allowed.has(step.phase))
      .flatMap((step) => extractToolNames(step.tool)),
  );
}

function evidenceForRunbookPhases(
  runbooks: DesignAppOperationRunbook[],
  phases: DesignAppOperationRunbookPhase[],
  operations?: Set<DesignAppAutomationOperation>,
  max = 8,
): string[] {
  const allowed = new Set(phases);
  return unique(
    runbooks
      .filter((runbook) => !operations || operations.has(runbook.operation))
      .flatMap((runbook) => runbook.steps)
      .filter((step) => allowed.has(step.phase))
      .flatMap((step) => step.evidence),
  ).slice(0, max);
}

function failClosedForOperations(
  runbooks: DesignAppOperationRunbook[],
  operations?: Set<DesignAppAutomationOperation>,
  max = 8,
): string[] {
  return unique(
    runbooks
      .filter((runbook) => !operations || operations.has(runbook.operation))
      .flatMap((runbook) => runbook.failClosedConditions),
  ).slice(0, max);
}

function isMutationOperation(operation: DesignAppAutomationOperation): boolean {
  return !INSPECTION_OPERATIONS.has(operation) && !OUTPUT_OPERATIONS.has(operation);
}

function appStatusTool(appId: DesignAppAutomationAppId): string {
  return appId === 'adobe_photoshop'
    ? 'desktop.photoshop_document_status'
    : 'desktop.indesign_document_status';
}

function appInventoryTool(appId: DesignAppAutomationAppId): string {
  return appId === 'adobe_photoshop'
    ? 'desktop.photoshop_layer_inventory'
    : 'desktop.indesign_text_inventory';
}

function appProofTool(appId: DesignAppAutomationAppId): string {
  return appId === 'adobe_photoshop'
    ? 'desktop.photoshop_export_proof'
    : 'desktop.indesign_export_proof';
}

function sourceFileDescription(appId: DesignAppAutomationAppId): string {
  return appId === 'adobe_photoshop'
    ? 'Resolve the exact PSD/PSB/image file or staged package folder before touching Photoshop.'
    : 'Resolve the exact INDD/IDML/INDT file or staged package folder before touching InDesign.';
}

export function buildDesignAppExecutionPipelinePlan(task: string): DesignAppExecutionPipelinePlan | null {
  const plan = buildDesignAppAutomationPlan(task);
  if (!plan) return null;

  const exactProgram = compileComputerSequenceProgram(task);
  if (exactProgram?.id === 'photoshop_new_document' && plan.appId === 'adobe_photoshop') {
    const createStep = exactProgram.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
    const widthPx = Number(createStep?.args.widthPx);
    const heightPx = Number(createStep?.args.heightPx);
    const sizeLabel = Number.isFinite(widthPx) && Number.isFinite(heightPx)
      ? `${widthPx}x${heightPx}`
      : 'requested-size';
    const directRequestAuthorized = exactProgram.authorization.mode === 'direct_user_request';
    const phases: DesignAppExecutionPipelinePhase[] = [
      {
        id: 'observe_document_inventory',
        label: 'Read Photoshop status',
        description: 'Read app-native document status. No active document is expected for a from-scratch request.',
        operations: ['inspect_image_document'],
        tools: ['desktop.photoshop_document_status'],
        requiredEvidence: ['Photoshop running/scriptable state and current active-document state'],
        approvalRequired: false,
        userVisibleWhen: 'hidden',
        failClosedRules: ['stop only for an actual bridge/install/license/login/permission/modal blocker, not for no active document'],
        recoveryAction: 'If Photoshop is not running, continue to the single conditional launch step.',
      },
      {
        id: 'prepare_app',
        label: 'Ensure Photoshop is ready',
        description: 'Launch Photoshop only when the first status says it is not running, then poll status during the bounded cold start.',
        operations: [],
        tools: ['desktop.launch_app', 'desktop.photoshop_document_status'],
        requiredEvidence: ['desktop.photoshop_document_status reports appRunning:true before creation'],
        approvalRequired: false,
        userVisibleWhen: 'hidden',
        failClosedRules: ['do not launch a second time when Photoshop is already running', 'do not replace the status check with menu/a11y/coordinate probing'],
        recoveryAction: 'Retry document status up to the compiled cold-start bound, then report the exact readiness blocker.',
      },
      {
        id: 'execute_design_mutations',
        label: 'Create blank document',
        description: `Create the new ${sizeLabel} Photoshop document through the dedicated app-native bridge tool.`,
        operations: [],
        tools: ['desktop.photoshop_create_document'],
        requiredEvidence: [
          `tool arguments are exactly widthPx=${widthPx}, heightPx=${heightPx}`,
          directRequestAuthorized
            ? 'the current direct user request authorizes only this new unsaved blank document'
            : 'the enclosing Chat plan approval authorizes the oversized blank-document allocation',
        ],
        // This exact program creates only a new unsaved blank document, so the
        // direct request is sufficient authority. Do not manufacture a gate.
        approvalRequired: false,
        userVisibleWhen: 'hidden',
        failClosedRules: [
          directRequestAuthorized
            ? 'do not extend the direct-request authority to save, export, overwrite, delete, edit existing content, or perform an external action'
            : 'do not dispatch the oversized blank-document allocation before its enclosing Chat plan approval',
          'do not substitute a generic menu, accessibility, keyboard, screenshot, or coordinate action',
        ],
        recoveryAction: directRequestAuthorized
          ? 'Stop on bridge failure and preserve the exact create-document error.'
          : 'Stop on approval rejection or bridge failure and preserve the exact create-document error.',
      },
      {
        id: 'verify_design_output',
        label: 'Verify document dimensions',
        description: `Read final Photoshop status and require an active ${sizeLabel} document before completion.`,
        operations: ['inspect_image_document'],
        tools: ['desktop.photoshop_document_status'],
        requiredEvidence: [`active document dimensions equal ${sizeLabel}`, 'created document name from app-native status'],
        approvalRequired: false,
        userVisibleWhen: 'proof',
        failClosedRules: ['stop if no active document is reported after creation', `stop if final dimensions are not ${sizeLabel}`],
        recoveryAction: 'Report the final status mismatch; do not fabricate layer, file, screenshot, or export proof.',
      },
    ];
    return {
      appId: plan.appId,
      appName: plan.appName,
      taskKind: plan.taskKind,
      operations: plan.operations,
      phases,
      // Preserve repeats because this is an executable ordered program, not a
      // capability catalog. The two status reads bracket the conditional
      // launch and the final status read proves the new dimensions.
      requiredToolSequence: exactProgram.steps.map((step) => step.tool),
      // Approval, when a resource-heavy allocation needs it, is owned by the
      // enclosing Chat plan; no phase emits an approvals.request tool call.
      approvalTools: [],
      mutationTools: ['desktop.photoshop_create_document'],
      proofTools: ['desktop.photoshop_document_status'],
      buildoutTools: [],
      adapterGapOperations: [],
      creativeAiRecipeIds: [],
      nextVisibleAction: directRequestAuthorized
        ? `Run desktop.photoshop_create_document for ${sizeLabel} immediately after the fresh status check; no redundant approval is required for the unsaved blank document.`
        : `After the one Chat plan-level approval, run desktop.photoshop_create_document for ${sizeLabel}.`,
      quietUserSummary: `Adobe Photoshop exact blank-document sequence: status -> conditional launch -> status -> create ${sizeLabel} -> status`,
      failClosedRules: unique(phases.flatMap((phase) => phase.failClosedRules)).slice(0, 12),
    };
  }

  const runbookPlan = buildDesignAppOperationRunbookPlan(task);
  if (!runbookPlan) return null;

  const adapterGapPlan = buildDesignAppAdapterGapPlan(task);
  const creativeRecipePlan = buildDesignAppCreativeAiRecipePlan(task);
  const runbooks = runbookPlan.runbooks;
  const operations = plan.operations;
  const mutationOperations = new Set(operations.filter(isMutationOperation));
  const outputOperations = new Set(operations.filter((operation) => OUTPUT_OPERATIONS.has(operation)));
  const adapterGapOperations = unique((adapterGapPlan?.gaps || []).map((gap) => gap.operation));
  const adapterBuildoutTools = unique((adapterGapPlan?.gaps || []).flatMap((gap) => gap.missingBridgeTools));
  const creativeBuildoutTools = creativeRecipePlan?.buildoutTools || [];
  const buildoutTools = unique([...adapterBuildoutTools, ...creativeBuildoutTools, ...(adapterGapOperations.length ? ['agent.build_app_capability'] : [])]);

  const observeTools = unique([
    'desktop.file_stat',
    appStatusTool(plan.appId),
    appInventoryTool(plan.appId),
    ...toolsForRunbookPhases(runbooks, ['observe']),
  ]);
  const approvalTools = unique(['approvals.request', ...toolsForRunbookPhases(runbooks, ['approve'])]);
  const mutationTools = unique(toolsForRunbookPhases(runbooks, ['act'], mutationOperations));
  const outputTools = unique([
    ...toolsForRunbookPhases(runbooks, ['act'], outputOperations),
    ...(outputOperations.size ? ['desktop.file_stat'] : []),
  ]);
  const proofTools = unique([
    appStatusTool(plan.appId),
    appInventoryTool(plan.appId),
    appProofTool(plan.appId),
    'desktop.file_stat',
    'desktop.screenshot',
    ...toolsForRunbookPhases(runbooks, ['verify']),
  ]);

  const phases: DesignAppExecutionPipelinePhase[] = [
    {
      id: 'resolve_source_package',
      label: 'Resolve source/package',
      description: sourceFileDescription(plan.appId),
      operations: [],
      tools: ['desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app'],
      requiredEvidence: ['source file or package exists', 'target app is open/focused', 'file identity or package manifest is known'],
      approvalRequired: false,
      userVisibleWhen: 'problem',
      failClosedRules: ['stop if the source file/package cannot be resolved', 'stop if the active app/document does not match the staged source'],
      recoveryAction: 'Ask for the exact file or reopen the staged package before any mutation.',
    },
    {
      id: 'observe_document_inventory',
      label: 'Observe document inventory',
      description: 'Capture app-native document status and layer/text/link inventory before any mutation.',
      operations: operations.filter((operation) => INSPECTION_OPERATIONS.has(operation)),
      tools: observeTools,
      requiredEvidence: evidenceForRunbookPhases(runbooks, ['observe'], undefined, 10),
      approvalRequired: false,
      userVisibleWhen: 'hidden',
      failClosedRules: failClosedForOperations(runbooks, undefined, 6),
      recoveryAction: 'Refresh document status and inventory; do not click canvas or layer panels blind.',
    },
  ];

  if (creativeRecipePlan?.recipes.length) {
    phases.push({
      id: 'prepare_creative_ai_brief',
      label: 'Prepare creative-AI brief',
      description: 'Convert the request into approved prompt/data, target object, output, receipt, and proof requirements.',
      operations: operations.filter((operation) => (
        operation === 'generate_ai_asset'
        || operation === 'generative_fill_or_remove'
        || operation === 'generative_expand_asset'
        || operation === 'create_creative_variants'
      )),
      tools: unique(['approvals.request', 'research.search', ...creativeBuildoutTools]),
      requiredEvidence: unique(creativeRecipePlan.recipes.flatMap((recipe) => recipe.briefInputs)).slice(0, 10),
      approvalRequired: true,
      userVisibleWhen: 'approval',
      failClosedRules: creativeRecipePlan.recoveryHints.slice(0, 6),
      recoveryAction: 'Stop for missing prompt, target frame/layer/selection, output folder, or data-source mapping before generation.',
    });
  }

  if (mutationOperations.size || outputOperations.size) {
    phases.push({
      id: 'request_design_approval',
      label: 'Request design approval',
      description: 'Ask for one compact approval covering mutations, generated assets, relinks, exports, package output, and destructive risk.',
      operations: operations.filter((operation) => !INSPECTION_OPERATIONS.has(operation)),
      tools: approvalTools,
      requiredEvidence: unique(runbooks.flatMap((runbook) => runbook.approvalBefore)).slice(0, 10),
      approvalRequired: true,
      userVisibleWhen: 'approval',
      failClosedRules: ['stop if approval is missing for document mutation, AI generation, relink, save, export, or package'],
      recoveryAction: 'Show the user only the approval summary and exact blocker, not raw bridge details.',
    });
  }

  if (mutationOperations.size) {
    phases.push({
      id: 'execute_design_mutations',
      label: 'Execute design mutations',
      description: 'Run script/API-backed Photoshop/InDesign actions in the approved order and capture receipts.',
      operations: Array.from(mutationOperations),
      tools: mutationTools.length ? mutationTools : ['agent.build_app_capability'],
      requiredEvidence: evidenceForRunbookPhases(runbooks, ['act', 'recover'], mutationOperations, 10),
      approvalRequired: true,
      userVisibleWhen: 'hidden',
      failClosedRules: failClosedForOperations(runbooks, mutationOperations, 8),
      recoveryAction: 'If a deterministic bridge tool is missing, pause and route to connected-agent capability buildout.',
    });
  }

  if (outputOperations.size) {
    phases.push({
      id: 'export_or_package_outputs',
      label: 'Export or package outputs',
      description: 'Create proof/package outputs only after source state and mutation approval are known.',
      operations: Array.from(outputOperations),
      tools: outputTools.length ? outputTools : [appProofTool(plan.appId), 'desktop.file_stat'],
      requiredEvidence: evidenceForRunbookPhases(runbooks, ['act', 'verify'], outputOperations, 10),
      approvalRequired: true,
      userVisibleWhen: 'proof',
      failClosedRules: failClosedForOperations(runbooks, outputOperations, 8),
      recoveryAction: 'Stop on missing write grant, ambiguous output path, preflight blocker, or missing proof file.',
    });
  }

  phases.push({
    id: 'verify_design_output',
    label: 'Verify output',
    description: 'Refresh app-native state and produce compact proof evidence before claiming completion.',
    operations,
    tools: proofTools,
    requiredEvidence: [
      'refreshed document status',
      'refreshed layer/text/link inventory',
      'proof screenshot or exported proof',
      'file_stat for generated/exported/package artifacts',
      'redacted design object manifest when captures are available',
    ],
    approvalRequired: false,
    userVisibleWhen: 'proof',
    failClosedRules: ['stop if before/after document identity is missing', 'stop if requested proof/export artifact cannot be verified', 'stop if local paths would leak into chat output'],
    recoveryAction: 'Re-run status/inventory/proof capture before retrying or showing completion.',
  });

  if (adapterGapOperations.length || buildoutTools.length) {
    phases.push({
      id: 'recover_or_build_adapter',
      label: 'Recover or build adapter',
      description: 'Use connected-agent buildout for missing deterministic Photoshop/InDesign/Firefly bridge capabilities.',
      operations: adapterGapOperations,
      tools: unique(['agent.build_app_capability', ...buildoutTools]),
      requiredEvidence: unique([
        ...(adapterGapPlan?.gaps || []).flatMap((gap) => gap.requiredEvidence),
        ...(adapterGapPlan?.gaps || []).flatMap((gap) => gap.focusedSmokeCases),
      ]).slice(0, 10),
      approvalRequired: true,
      userVisibleWhen: 'problem',
      failClosedRules: unique((adapterGapPlan?.gaps || []).flatMap((gap) => gap.failClosedRules)).slice(0, 8),
      recoveryAction: 'Build the smallest missing adapter, run focused smoke coverage, then retry the original task once with fresh evidence.',
    });
  }

  const requiredToolSequence = unique(phases.flatMap((phase) => phase.tools));
  const firstApproval = unique(runbooks.flatMap((runbook) => runbook.approvalBefore))[0];
  const nextVisibleAction = firstApproval
    ? `Approve ${plan.appName} work before ${firstApproval}.`
    : `Observe ${plan.appName} with ${appStatusTool(plan.appId)} before editing.`;

  return {
    appId: plan.appId,
    appName: plan.appName,
    taskKind: plan.taskKind,
    operations,
    phases,
    requiredToolSequence,
    approvalTools,
    mutationTools,
    proofTools,
    buildoutTools,
    adapterGapOperations,
    creativeAiRecipeIds: creativeRecipePlan?.recipes.map((recipe) => recipe.id) || [],
    nextVisibleAction,
    quietUserSummary: `${plan.appName} pipeline: ${phases.map((phase) => phase.label).join(' -> ')}`,
    failClosedRules: unique(phases.flatMap((phase) => phase.failClosedRules)).slice(0, 12),
  };
}

export function buildDesignAppExecutionPipelinePromptBlock(task: string, opts: { maxPhases?: number } = {}): string | null {
  const plan = buildDesignAppExecutionPipelinePlan(task);
  if (!plan) return null;
  const phases = plan.phases.slice(0, opts.maxPhases ?? 8);
  return [
    '## Design App Execution Pipeline',
    `Target app: ${plan.appName} (${plan.appId})`,
    `Task kind: ${plan.taskKind}`,
    `Operations: ${plan.operations.join(' | ')}`,
    `Required tool sequence: ${plan.requiredToolSequence.join(' | ')}`,
    plan.creativeAiRecipeIds.length ? `Creative AI recipes: ${plan.creativeAiRecipeIds.join(' | ')}` : null,
    plan.adapterGapOperations.length ? `Adapter-gap operations: ${plan.adapterGapOperations.join(' | ')}` : null,
    `Next user-visible action: ${plan.nextVisibleAction}`,
    'Ordered phases:',
    ...phases.flatMap((phase, index) => [
      `${index + 1}. ${phase.label} (${phase.id})`,
      `   Description: ${phase.description}`,
      `   Operations: ${phase.operations.length ? phase.operations.join(' | ') : 'none'}`,
      `   Tools: ${phase.tools.join(' | ') || 'none'}`,
      `   Evidence: ${phase.requiredEvidence.join(' | ') || 'none'}`,
      `   Approval required: ${phase.approvalRequired ? 'yes' : 'no'}; user-visible when: ${phase.userVisibleWhen}`,
      `   Fail closed: ${phase.failClosedRules.join(' | ') || 'none'}`,
      `   Recovery: ${phase.recoveryAction}`,
    ]),
    'Do not skip phases. Keep normal chat quiet unless approval, proof, or an actionable blocker is needed.',
  ].filter(Boolean).join('\n');
}
