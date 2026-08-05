/**
 * computer-app-grounding-smoketest - verifies browser/desktop action
 * plans are grounded in fresh observations before OpenSwan/SwanBot can
 * execute them.
 *
 * Run: npm run smoke:computer-app-grounding
 */

import {
  auditComputerAppGroundingActions,
  authorizeComputerAppMutation,
  buildComputerAppGroundingRunbook,
  buildComputerAppGroundingPlan,
  buildComputerAppGroundingPromptBlock,
  buildComputerAppGroundingTrace,
  buildComputerAppMutationApprovalKey,
  buildComputerAppToolArgsFingerprintAsync,
  buildComputerAppVerificationReceipt,
  createComputerAppObservationEpoch,
  dispatchAuthorizedComputerAppMutation,
  evaluateComputerAppActionReadiness,
  genericNativeUiMutationFamilyForTool,
  prepareGenericNativeUiMutationGuard,
  recommendComputerAppGroundingNextStep,
  recheckGenericNativeUiMutationGuardAtHandlerEntry,
  resolveComputerAppMutationPolicy,
  type GenericNativeUiFrontmostObservation,
  type GenericNativeUiMutationObservationDeps,
  type GenericNativeUiObservationBridgeResult,
  type ComputerAppGroundedAction,
  type ComputerAppGroundingObservation,
  type ComputerAppMutationContract,
  type ComputerAppObservationTarget,
} from '../src/lib/computerAppGrounding';
import { buildOpenSwanTaskPlan } from '../src/lib/openswanTaskPlanner';

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function assertGrounding(input: string, expected: {
  strategy: string;
  primarySurface: string;
  requiredTools: string[];
  promptIncludes: string[];
}) {
  const plan = buildComputerAppGroundingPlan(input);
  const prompt = buildComputerAppGroundingPromptBlock(input) || '';
  assert(plan?.strategy.id === expected.strategy, `${input} grounding strategy is ${expected.strategy}`, plan?.strategy.id);
  assert(plan?.primarySurface === expected.primarySurface, `${input} primary surface is ${expected.primarySurface}`, plan?.primarySurface);
  for (const tool of expected.requiredTools) {
    assert(
      !!plan?.observationRules.some((item) => item.tool === tool),
      `${input} grounding includes ${tool}`,
      plan?.observationRules.map((item) => item.tool).join(', '),
    );
  }
  for (const text of expected.promptIncludes) {
    assert(prompt.includes(text), `${input} prompt includes ${text}`);
  }
  assert(prompt.includes('Action readiness contract'), `${input} prompt includes action readiness contract`);
  assert(prompt.includes('recommendComputerAppGroundingNextStep'), `${input} prompt includes next-step recommender`);
}

assertGrounding('Tell me all the tabs I have open in Chrome right now', {
  strategy: 'desktop_readonly',
  primarySurface: 'desktop',
  requiredTools: ['desktop.list_browser_tabs', 'desktop.window_state'],
  promptIncludes: ['Do not substitute Browserbase', 'none required by this plan'],
});

assertGrounding('Login to WordPress with my saved vault credentials and draft a post', {
  strategy: 'credentialed_browser',
  primarySurface: 'browser',
  requiredTools: ['vault.runbook', 'browser.verification_state', 'browser.dom_snapshot'],
  promptIncludes: ['Never expose raw secrets', 'origin matches grant'],
});

assertGrounding('Open Figma and crop this image after I approve desktop control', {
  strategy: 'desktop_canvas_vision',
  primarySurface: 'desktop',
  requiredTools: ['desktop.screenshot', 'desktop.screen_size'],
  promptIncludes: ['No blind coordinate action', 'before/after screenshot comparison'],
});

assertGrounding('Open Photoshop and crop this PSD after I approve desktop control', {
  strategy: 'creative_layout_control',
  primarySurface: 'desktop',
  requiredTools: ['desktop.file_stat', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'approvals.request'],
  promptIncludes: ['No localized generative/content-aware edit without a verified selection or mask', 'refreshed Photoshop layer inventory shows requested layer/text/asset changes'],
});

const blankDocumentGrounding = buildComputerAppGroundingPlan('Open Photoshop and start a new project 600 x 600');
const blankDocumentGroundingPrompt = buildComputerAppGroundingPromptBlock('Open Photoshop and start a new project 600 x 600') || '';
assert(blankDocumentGrounding?.strategy.id === 'creative_layout_control', 'blank Photoshop document keeps creative layout strategy');
assert(
  JSON.stringify(blankDocumentGrounding?.observationRules.map((rule) => rule.tool))
    === JSON.stringify(['desktop.photoshop_document_status']),
  'blank Photoshop document requires only app-native status observation',
  blankDocumentGrounding?.observationRules.map((rule) => rule.tool).join(', '),
);
assert(
  JSON.stringify(blankDocumentGrounding?.fallbackChain) === JSON.stringify([
    'desktop.photoshop_document_status',
    'desktop.launch_app',
    'desktop.photoshop_document_status',
    'desktop.photoshop_create_document',
    'desktop.photoshop_document_status',
  ]),
  'blank Photoshop document preserves the exact ordered program',
  blankDocumentGrounding?.fallbackChain.join(' -> '),
);
assert(
  blankDocumentGrounding?.approvalGates.length === 0,
  'bounded unsaved Photoshop program needs no redundant approval',
);
for (const forbidden of ['desktop.file_search', 'desktop.file_stat', 'desktop.photoshop_layer_inventory', 'desktop.screenshot', 'desktop.read_a11y_tree', 'desktop.menu_click']) {
  assert(!blankDocumentGroundingPrompt.includes(forbidden), `blank Photoshop grounding omits ${forbidden}`);
}
assert(!/destructive pixel edits|flattening|rasterizing|source package/i.test(blankDocumentGroundingPrompt), 'blank Photoshop grounding omits generic destructive/source requirements');
assert(blankDocumentGroundingPrompt.includes('600x600'), 'blank Photoshop grounding carries exact final dimensions');
assert(
  !/canonical tool approval|request approval before final side-effect action/i.test(blankDocumentGroundingPrompt),
  'blank Photoshop grounding does not manufacture a second per-tool approval',
);

assertGrounding('Open this InDesign file and make changes for a marketing banner with different layers', {
  strategy: 'creative_layout_control',
  primarySurface: 'desktop',
  requiredTools: ['desktop.file_stat', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'approvals.request'],
  promptIncludes: ['No editing a mismatched or unknown active document', 'refreshed text inventory shows requested copy/layer changes'],
});

assertGrounding('Open AutoCAD and create a 2D floor plan with two rooms and dimensions', {
  strategy: 'engineering_cad_control',
  primarySurface: 'desktop',
  requiredTools: ['desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot', 'approvals.request'],
  promptIncludes: ['No unverified geometry', 'units/scale/dimension checkpoint'],
});

assertGrounding('Use Ableton Live to create a four-bar drum loop and export it after approval', {
  strategy: 'universal_app_control',
  primarySurface: 'desktop',
  requiredTools: ['desktop.window_state', 'desktop.read_a11y_tree', 'research.search', 'office.list_agents', 'approvals.request'],
  promptIncludes: ['agent.build_app_capability', 'official vendor/OS automation docs', 'Do not let unknown-app work fall back to plain chat'],
});

const bookingPlan = buildComputerAppGroundingPlan('Book a flight to New York next Friday under $500');
const unapprovedCheckout: ComputerAppGroundedAction[] = [
  {
    id: 'act-checkout',
    surface: 'browser',
    tool: 'browser.click_role',
    description: 'click final checkout and book button',
    mutates: true,
    sourceObservationIds: ['browser-dom', 'approval-state'],
    observationAgeMs: 1000,
    approvalState: 'pending',
  },
];
const unapprovedAudit = auditComputerAppGroundingActions(bookingPlan, unapprovedCheckout);
assert(unapprovedAudit.ok === false, 'unapproved checkout is blocked', unapprovedAudit.summary);
assert(unapprovedAudit.findings.some((finding) => finding.label === 'Approval-sensitive action not approved'), 'approval blocker is explicit');

const canvasPlan = buildComputerAppGroundingPlan('Open Figma and crop this image');
const blindCoordinate: ComputerAppGroundedAction[] = [
  {
    id: 'act-canvas-click',
    surface: 'desktop',
    tool: 'desktop.click_at',
    description: 'click crop handle at 520,400',
    mutates: true,
    sourceObservationIds: ['desktop-a11y'],
    observationAgeMs: 1000,
    approvalState: 'approved',
  },
];
const blindCoordinateAudit = auditComputerAppGroundingActions(canvasPlan, blindCoordinate);
assert(blindCoordinateAudit.ok === false, 'coordinate action without screenshot/screen_size is blocked', blindCoordinateAudit.summary);
assert(blindCoordinateAudit.findings.some((finding) => finding.label === 'Ungrounded coordinate action'), 'coordinate blocker is explicit');

const groundedCanvas: ComputerAppGroundedAction[] = [
  {
    id: 'act-canvas-click',
    surface: 'desktop',
    tool: 'desktop.click_at',
    description: 'click crop handle at 520,400',
    mutates: true,
    sourceObservationIds: ['desktop-screenshot', 'desktop-screen-size'],
    observationAgeMs: 1000,
    approvalState: 'approved',
  },
];
const groundedCanvasAudit = auditComputerAppGroundingActions(canvasPlan, groundedCanvas);
assert(groundedCanvasAudit.ok === true, 'coordinate action with screenshot/screen_size passes', groundedCanvasAudit.summary);

const cadPlan = buildComputerAppGroundingPlan('Open AutoCAD and export the drawing as DXF after approval');
const unapprovedCadExportAudit = auditComputerAppGroundingActions(cadPlan, [
  {
    id: 'act-cad-export',
    surface: 'desktop',
    tool: 'desktop.press_keys',
    description: 'export the current drawing as DXF and overwrite the output file',
    mutates: true,
    sourceObservationIds: ['cad-window-state', 'cad-a11y', 'cad-screenshot', 'approval-state'],
    observationAgeMs: 1000,
    approvalState: 'pending',
  },
]);
assert(unapprovedCadExportAudit.ok === false, 'unapproved CAD export is blocked', unapprovedCadExportAudit.summary);
assert(unapprovedCadExportAudit.findings.some((finding) => finding.label === 'Approval-sensitive action not approved'), 'CAD approval blocker is explicit');

const universalAppPlan = buildComputerAppGroundingPlan('Use Ableton Live to create a four-bar drum loop and export it after approval');
const ungroundedAppBuildoutAudit = auditComputerAppGroundingActions(universalAppPlan, [
  {
    id: 'act-build-ableton-capability',
    surface: 'terminal',
    tool: 'agent.build_app_capability',
    description: 'ask connected agent to build the missing Ableton app adapter and smoke coverage',
    mutates: true,
    sourceObservationIds: ['approval-state'],
    observationAgeMs: 1000,
    approvalState: 'approved',
  },
]);
assert(ungroundedAppBuildoutAudit.ok === false, 'universal app buildout requires agent roster grounding', ungroundedAppBuildoutAudit.summary);
assert(ungroundedAppBuildoutAudit.findings.some((finding) => finding.detail.includes('agent-roster')), 'universal app buildout blocker names agent roster');

const now = Date.now();
const canvasObservations: ComputerAppGroundingObservation[] = [
  {
    id: 'obs-screenshot-1',
    ruleId: 'desktop-screenshot',
    surface: 'desktop',
    tool: 'desktop.screenshot',
    capturedAt: now - 500,
    summary: 'Photoshop crop handle visible',
    confidence: 0.92,
  },
  {
    id: 'obs-screen-size-1',
    ruleId: 'desktop-screen-size',
    surface: 'desktop',
    tool: 'desktop.screen_size',
    capturedAt: now - 500,
    summary: 'Screen size is 1512x982',
    confidence: 1,
  },
];
const canvasReadiness = evaluateComputerAppActionReadiness({
  plan: canvasPlan,
  action: {
    ...groundedCanvas[0],
    sourceObservationIds: ['obs-screenshot-1', 'obs-screen-size-1'],
  },
  observations: canvasObservations,
  now,
});
assert(canvasReadiness.ready === true, 'readiness accepts fresh recorded screenshot/screen-size observations', canvasReadiness.summary);
assert(canvasReadiness.satisfiedRuleIds.includes('desktop-screenshot'), 'readiness records satisfied screenshot rule');

const initialTabsStep = recommendComputerAppGroundingNextStep({
  plan: buildComputerAppGroundingPlan('Tell me all the tabs I have open in Chrome right now'),
  observations: [],
  now,
});
assert(initialTabsStep.kind === 'observe' && initialTabsStep.tool === 'desktop.list_browser_tabs', 'next step starts read-only local tabs with observation', `${initialTabsStep.kind}/${initialTabsStep.tool}`);

const initialCadStep = recommendComputerAppGroundingNextStep({
  plan: buildComputerAppGroundingPlan('Open AutoCAD and create a 2D floor plan with two rooms and dimensions'),
  observations: [],
  now,
});
assert(initialCadStep.kind === 'observe' && initialCadStep.tool === 'desktop.window_state', 'next step starts CAD work with window-state observation', `${initialCadStep.kind}/${initialCadStep.tool}`);

const initialUniversalAppStep = recommendComputerAppGroundingNextStep({
  plan: universalAppPlan,
  observations: [],
  now,
});
assert(initialUniversalAppStep.kind === 'observe' && initialUniversalAppStep.tool === 'desktop.window_state', 'next step starts unknown app control with window-state observation', `${initialUniversalAppStep.kind}/${initialUniversalAppStep.tool}`);

const missingCanvasStep = recommendComputerAppGroundingNextStep({
  plan: canvasPlan,
  candidateAction: {
    id: 'act-canvas-click',
    surface: 'desktop',
    tool: 'desktop.click_at',
    description: 'click crop handle at 520,400',
    mutates: true,
    approvalState: 'approved',
  },
  observations: [],
  now,
});
assert(missingCanvasStep.kind === 'observe' && missingCanvasStep.tool === 'desktop.screenshot', 'next step refreshes screenshot before ungrounded canvas action', `${missingCanvasStep.kind}/${missingCanvasStep.tool}`);

const readyCanvasStep = recommendComputerAppGroundingNextStep({
  plan: canvasPlan,
  candidateAction: {
    ...groundedCanvas[0],
    sourceObservationIds: ['obs-screenshot-1', 'obs-screen-size-1'],
  },
  observations: canvasObservations,
  now,
});
assert(readyCanvasStep.kind === 'act', 'next step allows grounded canvas action', readyCanvasStep.kind);

const readyCanvasTrace = buildComputerAppGroundingTrace({
  plan: canvasPlan,
  observations: canvasObservations,
  candidateAction: {
    ...groundedCanvas[0],
    sourceObservationIds: ['obs-screenshot-1', 'obs-screen-size-1'],
  },
  now,
});
assert(readyCanvasTrace.status === 'ready_to_act', 'trace marks grounded canvas action ready to act', readyCanvasTrace.status);
assert(readyCanvasTrace.display.badges.some((badge) => badge.includes('required fresh')), 'trace display includes freshness badge');
assert(readyCanvasTrace.persistenceTargets.includes('office_run_ledger'), 'trace declares office ledger persistence target');

const tabsPlan = buildComputerAppGroundingPlan('Tell me all the tabs I have open in Chrome right now');
const readonlyMutationAudit = auditComputerAppGroundingActions(tabsPlan, [
  {
    id: 'act-focus-chrome',
    surface: 'desktop',
    tool: 'desktop.focus_app',
    description: 'focus Chrome while answering a read-only tab request',
    mutates: true,
    sourceObservationIds: ['desktop-tabs'],
    observationAgeMs: 1000,
    approvalState: 'not_required',
  },
]);
assert(readonlyMutationAudit.ok === false, 'read-only tab awareness blocks desktop mutation', readonlyMutationAudit.summary);
assert(readonlyMutationAudit.findings.some((finding) => finding.label === 'Read-only strategy attempted mutation'), 'read-only mutation blocker is explicit');

const staleActionAudit = auditComputerAppGroundingActions(bookingPlan, [
  {
    id: 'act-stale-fill',
    surface: 'browser',
    tool: 'browser.fill_field',
    description: 'fill traveler name',
    mutates: true,
    sourceObservationIds: ['browser-dom'],
    observationAgeMs: 45_000,
    approvalState: 'not_required',
  },
]);
assert(staleActionAudit.ok === false, 'stale browser observation is blocked', staleActionAudit.summary);
assert(staleActionAudit.findings.some((finding) => finding.label === 'Stale observation'), 'stale observation blocker is explicit');

const staleReadiness = evaluateComputerAppActionReadiness({
  plan: bookingPlan,
  action: {
    id: 'act-stale-submit',
    surface: 'browser',
    tool: 'browser.click_role',
    description: 'submit final booking form',
    mutates: true,
    sourceObservationIds: ['browser-verification', 'browser-dom', 'approval-state'],
    approvalState: 'approved',
  },
  observations: [
    {
      id: 'obs-dom-old',
      ruleId: 'browser-dom',
      surface: 'browser',
      tool: 'browser.dom_snapshot',
      capturedAt: now - 60_000,
      summary: 'Booking form visible a minute ago',
    },
    {
      id: 'obs-verification-fresh',
      ruleId: 'browser-verification',
      surface: 'browser',
      tool: 'browser.verification_state',
      capturedAt: now - 1000,
      summary: 'No verification gate',
    },
    {
      id: 'obs-approval-fresh',
      ruleId: 'approval-state',
      surface: 'approval',
      tool: 'approvals.request',
      capturedAt: now - 1000,
      summary: 'User approved final booking action',
    },
  ],
  now,
});
assert(staleReadiness.ready === false, 'readiness blocks stale recorded DOM observation', staleReadiness.summary);
assert(staleReadiness.nextObservationTools.includes('browser.dom_snapshot'), 'readiness recommends next observation tool');

for (const [label, capturedAt] of [
  ['invalid', 'not-a-timestamp'],
  ['future', now + 5_000],
] as const) {
  const invalidTimeReadiness = evaluateComputerAppActionReadiness({
    plan: bookingPlan,
    action: {
      id: `act-${label}-timestamp`,
      surface: 'browser',
      tool: 'browser.click_role',
      description: 'submit final booking form',
      mutates: true,
      sourceObservationIds: ['browser-verification', 'browser-dom', 'approval-state'],
      approvalState: 'approved',
    },
    observations: [
      {
        id: `obs-dom-${label}`,
        ruleId: 'browser-dom',
        surface: 'browser',
        tool: 'browser.dom_snapshot',
        capturedAt,
        summary: 'Untrusted timestamp test',
      },
      {
        id: `obs-verification-${label}`,
        ruleId: 'browser-verification',
        surface: 'browser',
        tool: 'browser.verification_state',
        capturedAt: now - 500,
        summary: 'No verification gate',
      },
      {
        id: `obs-approval-${label}`,
        ruleId: 'approval-state',
        surface: 'approval',
        tool: 'approvals.request',
        capturedAt: now - 500,
        summary: 'Exact action approved',
      },
    ],
    now,
  });
  assert(
    invalidTimeReadiness.ready === false,
    `${label} observation timestamp fails closed`,
    invalidTimeReadiness.summary,
  );
  assert(
    invalidTimeReadiness.findings.some((finding) => finding.label === 'Invalid observation timestamp'),
    `${label} timestamp blocker is explicit`,
  );
}

const approvalStep = recommendComputerAppGroundingNextStep({
  plan: bookingPlan,
  candidateAction: unapprovedCheckout[0],
  observations: [
    {
      id: 'obs-browser-verification',
      ruleId: 'browser-verification',
      surface: 'browser',
      tool: 'browser.verification_state',
      capturedAt: now - 1000,
      summary: 'No verification gate',
    },
    {
      id: 'obs-browser-dom',
      ruleId: 'browser-dom',
      surface: 'browser',
      tool: 'browser.dom_snapshot',
      capturedAt: now - 1000,
      summary: 'Checkout button visible',
    },
  ],
  now,
});
assert(approvalStep.kind === 'request_approval', 'next step requests approval before final checkout', approvalStep.kind);

const approvalTrace = buildComputerAppGroundingTrace({
  plan: bookingPlan,
  observations: [
    {
      id: 'obs-browser-verification',
      ruleId: 'browser-verification',
      surface: 'browser',
      tool: 'browser.verification_state',
      capturedAt: now - 1000,
      summary: 'No verification gate',
    },
    {
      id: 'obs-browser-dom',
      ruleId: 'browser-dom',
      surface: 'browser',
      tool: 'browser.dom_snapshot',
      capturedAt: now - 1000,
      summary: 'Checkout button visible',
    },
  ],
  candidateAction: unapprovedCheckout[0],
  now,
});
assert(approvalTrace.status === 'needs_approval', 'trace marks checkout as needing approval', approvalTrace.status);
assert(approvalTrace.display.nextAction === 'request_approval: approvals.request', 'trace display exposes approval next action', approvalTrace.display.nextAction);

const repeatedFailureStep = recommendComputerAppGroundingNextStep({
  plan: canvasPlan,
  candidateAction: groundedCanvas[0],
  actionHistory: [
    { ...groundedCanvas[0], status: 'failed', failureReason: 'timeout' },
    { ...groundedCanvas[0], status: 'failed', failureReason: 'timeout' },
  ],
  observations: canvasObservations,
  now,
});
assert(repeatedFailureStep.kind === 'recover', 'next step recovers after repeated failures', repeatedFailureStep.kind);

const verifyStep = recommendComputerAppGroundingNextStep({
  plan: canvasPlan,
  candidateAction: { ...groundedCanvas[0], sourceObservationIds: ['obs-screenshot-1', 'obs-screen-size-1'] },
  actionHistory: [{ ...groundedCanvas[0], id: 'act-canvas-click', status: 'success' }],
  observations: canvasObservations,
  now,
});
assert(verifyStep.kind === 'verify', 'next step verifies successful action before continuing', verifyStep.kind);

const runbook = buildComputerAppGroundingRunbook('Login to WordPress with my saved vault credentials and draft a post');
assert(runbook?.steps.some((step) => step.phase === 'observe' && step.tool === 'vault.runbook'), 'runbook starts with vault observation for credentialed browser');
assert(runbook?.steps.some((step) => step.phase === 'act'), 'runbook includes grounded act phase');
assert(runbook?.maxActionAttemptsBeforeRecovery === 2, 'runbook caps action attempts before recovery');

const openswanPlan = buildOpenSwanTaskPlan('Summarize unread emails and prioritize Slack alerts', 'support');
assert(openswanPlan.computerAppGrounding?.strategy.id === 'productivity_app_control', 'OpenSwan task plan includes grounding strategy', openswanPlan.computerAppGrounding?.strategy.id);
assert(
  openswanPlan.computerAppGrounding?.observationRules.some((item) => item.tool === 'desktop.read_a11y_tree'),
  'OpenSwan grounding includes desktop a11y observation',
);
assert(
  openswanPlan.computerAppGroundingRunbook?.steps.some((step) => step.phase === 'verify'),
  'OpenSwan task plan includes grounding runbook verification step',
);
assert(
  openswanPlan.computerAppGroundingNextStep?.kind === 'observe' && openswanPlan.computerAppGroundingNextStep.tool === 'desktop.window_state',
  'OpenSwan task plan exposes initial grounding next step',
  `${openswanPlan.computerAppGroundingNextStep?.kind}/${openswanPlan.computerAppGroundingNextStep?.tool}`,
);
assert(
  openswanPlan.computerAppGroundingTrace?.status === 'needs_observation',
  'OpenSwan task plan exposes initial grounding trace status',
  openswanPlan.computerAppGroundingTrace?.status,
);

async function runGenericNativeUiMutationObservationGuardSmoke() {
  const baseMs = Date.parse('2026-07-27T15:00:00.000Z');
  const privateAppName = 'Private Notes Workspace';
  const privateWindowTitle = '/Users/example/private/client-secrets.txt — hunter2';
  const privateA11yText = 'Customer SSN 123-45-6789';
  const pid = 7319;
  const normalizedArgs = {
    textSha256: `args-v2:sha256:${'1'.repeat(64)}`,
    submit: false,
  };
  const toolArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync(
    normalizedArgs,
  );
  const digest = async (value: unknown) =>
    buildComputerAppToolArgsFingerprintAsync(value);

  const familyCases = [
    ['desktop.type_text', 'type'],
    ['desktop.paste_text', 'paste'],
    ['desktop.press_keys', 'press'],
    ['desktop.menu_click', 'menu'],
    ['desktop.click_at', 'coordinate'],
    ['desktop.mouse_move', 'mouse'],
    ['desktop.mouse_click', 'mouse'],
    ['desktop.mouse_down', 'mouse'],
    ['desktop.mouse_up', 'mouse'],
    ['desktop.mouse_drag', 'mouse'],
    ['desktop.mouse_scroll', 'mouse'],
  ] as const;
  for (const [tool, family] of familyCases) {
    assert(
      genericNativeUiMutationFamilyForTool(tool) === family,
      `${tool} is covered by the generic native ${family} guard family`,
    );
  }
  assert(
    genericNativeUiMutationFamilyForTool('desktop.click_element') === null,
    'the existing sealed semantic-press lane is not duplicated by the generic guard',
  );
  assert(
    genericNativeUiMutationFamilyForTool('desktop.set_element_value') === null,
    'the sealed semantic-value lane is not duplicated by the generic acknowledgement guard',
  );

  const makeObservation = (
    overrides: Partial<GenericNativeUiFrontmostObservation> = {},
  ): GenericNativeUiFrontmostObservation => ({
    requestedAppName: privateAppName,
    resolvedAppName: privateAppName,
    app: privateAppName,
    pid,
    processIdentityVersion: 1,
    appRunning: true,
    frontmost: true,
    frontmostApp: privateAppName,
    windowCount: 1,
    windowTitles: [privateWindowTitle],
    tree: {
      role: 'AXTextArea',
      value: privateA11yText,
    },
    ...overrides,
  });

  const makeSequenceDeps = (
    values: Array<GenericNativeUiObservationBridgeResult | Error>,
    readNow: () => string | number,
    digestValue: GenericNativeUiMutationObservationDeps['digest'] = digest,
  ) => {
    let observationCalls = 0;
    const deps: GenericNativeUiMutationObservationDeps = {
      observeFrontmostApp: async () => {
        const value = values[observationCalls];
        observationCalls += 1;
        if (value instanceof Error) throw value;
        return value || { ok: false, errorCode: 'stale_bridge' };
      },
      digest: digestValue,
      now: readNow,
    };
    return {
      deps,
      observationCalls: () => observationCalls,
    };
  };

  let nowMs = baseMs;
  const happySequence = makeSequenceDeps(
    [
      { ok: true, data: makeObservation() },
      { ok: true, data: makeObservation() },
    ],
    () => nowMs,
  );
  const prepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: happySequence.deps,
    freshnessMs: 5_000,
  });
  assert(prepared.ok, 'generic native guard accepts one exact fresh frontmost observation');

  const maxUnicodeAppName = '界'.repeat(160);
  const maxUnicodeSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        requestedAppName: maxUnicodeAppName,
        resolvedAppName: maxUnicodeAppName,
        app: maxUnicodeAppName,
        frontmostApp: maxUnicodeAppName,
      }),
    }],
    () => baseMs,
  );
  const maxUnicodePrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: maxUnicodeAppName,
    toolArgsFingerprint,
    deps: maxUnicodeSequence.deps,
  });
  assert(
    maxUnicodePrepared.ok,
    'generic native guard accepts the shared 160-Unicode-code-point app-name boundary',
  );
  const overlongAppName = '界'.repeat(161);
  const overlongSequence = makeSequenceDeps([], () => baseMs);
  const overlongPrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: overlongAppName,
    toolArgsFingerprint,
    deps: overlongSequence.deps,
  });
  assert(
    !overlongPrepared.ok
      && overlongPrepared.errorCode === 'invalid_target_identity'
      && overlongSequence.observationCalls() === 0,
    'generic native guard rejects 161-code-point app names before observation',
  );
  assert(
    happySequence.observationCalls() === 1,
    'pre-approval guard performs exactly one observation call',
    String(happySequence.observationCalls()),
  );
  if (prepared.ok) {
    const preparedSerialized = JSON.stringify(prepared);
    assert(
      !preparedSerialized.includes(privateAppName)
        && !preparedSerialized.includes(privateWindowTitle)
        && !preparedSerialized.includes(privateA11yText)
        && !preparedSerialized.includes('/Users/example/private'),
      'pre-approval guard returns no raw app, window, path, or accessibility text',
      preparedSerialized,
    );
    assert(
      /^args-v2:sha256:[a-f0-9]{64}$/.test(prepared.guard.processIdentitySha256)
        && /^args-v2:sha256:[a-f0-9]{64}$/.test(prepared.guard.surfaceIdentitySha256)
        && /^args-v2:sha256:[a-f0-9]{64}$/.test(prepared.guard.approvalBindingSha256),
      'pre-approval guard exposes only cryptographic target and approval bindings',
    );
    assert(
      prepared.guard.windowSignal === 'visible_window',
      'a positive bounded window count produces the visible-window signal',
    );

    nowMs = baseMs + 500;
    const entry = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: prepared.guard,
      approvalBindingSha256: prepared.guard.approvalBindingSha256,
      deps: happySequence.deps,
    });
    assert(entry.ok, 'handler-entry recheck accepts the same exact app and PID');
    assert(
      happySequence.observationCalls() === 2,
      'handler-entry recheck performs exactly one additional fresh observation',
      String(happySequence.observationCalls()),
    );
    if (entry.ok) {
      const entrySerialized = JSON.stringify(entry);
      assert(
        !entrySerialized.includes(privateAppName)
          && !entrySerialized.includes(privateWindowTitle)
          && !entrySerialized.includes(privateA11yText),
        'handler-entry binding and epoch contain no raw app/window/a11y text',
        entrySerialized,
      );
      assert(
        entry.binding.sameProcess
          && entry.epoch.target.pid === pid
          && entry.epoch.target.appName === entry.binding.processIdentitySha256
          && entry.epoch.target.windowId === entry.binding.surfaceIdentitySha256,
        'handler-entry epoch carries positive PID plus opaque process/window identities',
        JSON.stringify(entry.epoch.target),
      );
      assert(
        entry.epoch.evidenceIds.includes(prepared.guard.approvalBindingSha256)
          && entry.epoch.evidenceIds.includes(entry.binding.entryObservationBindingSha256),
        'fresh handler-entry epoch binds the exact approval and entry observation digests',
      );
    }

    const callsBeforeReplay = happySequence.observationCalls();
    const replay = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: prepared.guard,
      approvalBindingSha256: prepared.guard.approvalBindingSha256,
      deps: happySequence.deps,
    });
    assert(
      !replay.ok
        && replay.errorCode === 'guard_consumed'
        && happySequence.observationCalls() === callsBeforeReplay,
      'one guard cannot mint two handler-entry epochs or perform a replay observation',
    );

    const clonedGuardSequence = makeSequenceDeps(
      [{ ok: true, data: makeObservation() }],
      () => nowMs,
    );
    const clonedGuard = { ...prepared.guard };
    const clonedRecheck = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: clonedGuard,
      approvalBindingSha256: clonedGuard.approvalBindingSha256,
      deps: clonedGuardSequence.deps,
    });
    assert(
      !clonedRecheck.ok
        && clonedRecheck.errorCode === 'guard_untrusted'
        && clonedGuardSequence.observationCalls() === 0,
      'a model-authored clone cannot cross the handler-entry trust boundary',
    );
  }

  let pendingApprovalNow = baseMs;
  const pendingApprovalSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation() }],
    () => pendingApprovalNow,
  );
  const pendingApprovalGuard = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: pendingApprovalSequence.deps,
    freshnessMs: 5_000,
  });
  let retryApprovalNow = baseMs + 20_000;
  const retryApprovalSequence = makeSequenceDeps(
    [
      { ok: true, data: makeObservation() },
      { ok: true, data: makeObservation() },
    ],
    () => retryApprovalNow,
  );
  const retryApprovalGuard = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: retryApprovalSequence.deps,
    freshnessMs: 5_000,
  });
  assert(
    pendingApprovalGuard.ok
      && retryApprovalGuard.ok
      && pendingApprovalGuard.guard.observationBindingSha256
        !== retryApprovalGuard.guard.observationBindingSha256
      && pendingApprovalGuard.guard.approvalBindingSha256
        === retryApprovalGuard.guard.approvalBindingSha256,
    'manual-approval retry keeps the approval binding stable across fresh timestamps while issuing a new one-shot observation binding',
  );
  if (pendingApprovalGuard.ok && retryApprovalGuard.ok) {
    retryApprovalNow += 250;
    const retriedEntry = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: retryApprovalGuard.guard,
      approvalBindingSha256: pendingApprovalGuard.guard.approvalBindingSha256,
      deps: retryApprovalSequence.deps,
    });
    assert(
      retriedEntry.ok && retryApprovalSequence.observationCalls() === 2,
      'a second fresh guard consumes the manually approved stable binding at its own handler entry',
    );
    pendingApprovalNow = baseMs + 20_000;
    const expiredOriginal = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: pendingApprovalGuard.guard,
      approvalBindingSha256: pendingApprovalGuard.guard.approvalBindingSha256,
      deps: pendingApprovalSequence.deps,
    });
    assert(
      !expiredOriginal.ok
        && expiredOriginal.errorCode === 'observation_stale'
        && pendingApprovalSequence.observationCalls() === 1,
      'the original pending-call guard cannot be replayed after its private freshness window',
    );
  }

  const changedPidSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation({ pid: pid + 1 }) }],
    () => baseMs + 30_000,
  );
  const changedPidGuard = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: changedPidSequence.deps,
  });
  const changedWindowSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation({ windowTitles: ['Different window'] }) }],
    () => baseMs + 30_000,
  );
  const changedWindowGuard = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: changedWindowSequence.deps,
  });
  const changedArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync({
    ...normalizedArgs,
    submit: true,
  });
  const changedArgsSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation() }],
    () => baseMs + 30_000,
  );
  const changedArgsGuard = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint: changedArgsFingerprint,
    deps: changedArgsSequence.deps,
  });
  assert(
    pendingApprovalGuard.ok
      && changedPidGuard.ok
      && changedWindowGuard.ok
      && changedArgsGuard.ok
      && changedPidGuard.guard.approvalBindingSha256
        !== pendingApprovalGuard.guard.approvalBindingSha256
      && changedWindowGuard.guard.approvalBindingSha256
        !== pendingApprovalGuard.guard.approvalBindingSha256
      && changedArgsGuard.guard.approvalBindingSha256
        !== pendingApprovalGuard.guard.approvalBindingSha256,
    'PID, window, or exact argument drift each produces a different approval binding',
  );

  let wrongBindingNow = baseMs;
  const wrongBindingSequence = makeSequenceDeps(
    [
      { ok: true, data: makeObservation() },
      { ok: true, data: makeObservation() },
    ],
    () => wrongBindingNow,
  );
  const wrongBindingPrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.press_keys',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: wrongBindingSequence.deps,
  });
  if (wrongBindingPrepared.ok) {
    wrongBindingNow += 100;
    const wrongBinding = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: wrongBindingPrepared.guard,
      approvalBindingSha256: `args-v2:sha256:${'f'.repeat(64)}`,
      deps: wrongBindingSequence.deps,
    });
    assert(
      !wrongBinding.ok
        && wrongBinding.errorCode === 'approval_binding_mismatch'
        && wrongBindingSequence.observationCalls() === 1,
      'mismatched approval binding fails before a handler-entry observation',
    );
  } else {
    assert(false, 'wrong-binding fixture prepares a valid guard', wrongBindingPrepared.errorCode);
  }

  let pidDriftNow = baseMs;
  const pidDriftSequence = makeSequenceDeps(
    [
      { ok: true, data: makeObservation() },
      { ok: true, data: makeObservation({ pid: pid + 1 }) },
    ],
    () => pidDriftNow,
  );
  const pidDriftPrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.paste_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: pidDriftSequence.deps,
  });
  if (pidDriftPrepared.ok) {
    pidDriftNow += 250;
    const pidDrift = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: pidDriftPrepared.guard,
      approvalBindingSha256: pidDriftPrepared.guard.approvalBindingSha256,
      deps: pidDriftSequence.deps,
    });
    assert(
      !pidDrift.ok
        && pidDrift.errorCode === 'target_identity_drift'
        && pidDriftSequence.observationCalls() === 2,
      'PID restart or substitution fails closed at handler entry',
    );
  } else {
    assert(false, 'PID-drift fixture prepares a valid guard', pidDriftPrepared.errorCode);
  }

  let windowDriftNow = baseMs;
  const windowDriftSequence = makeSequenceDeps(
    [
      { ok: true, data: makeObservation() },
      {
        ok: true,
        data: makeObservation({
          windowTitles: ['A different private window'],
        }),
      },
    ],
    () => windowDriftNow,
  );
  const windowDriftPrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.menu_click',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: windowDriftSequence.deps,
  });
  if (windowDriftPrepared.ok) {
    windowDriftNow += 250;
    const windowDrift = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: windowDriftPrepared.guard,
      approvalBindingSha256: windowDriftPrepared.guard.approvalBindingSha256,
      deps: windowDriftSequence.deps,
    });
    assert(
      !windowDrift.ok && windowDrift.errorCode === 'target_identity_drift',
      'window identity drift between approval and handler entry fails closed',
    );
  } else {
    assert(false, 'window-drift fixture prepares a valid guard', windowDriftPrepared.errorCode);
  }

  const menuFallbackSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        windowCount: 0,
        windowTitles: [],
        fallbackSignal: {
          kind: 'frontmost_menu_bar',
          available: true,
        },
      }),
    }],
    () => baseMs,
  );
  const menuFallback = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.menu_click',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: menuFallbackSequence.deps,
  });
  assert(
    menuFallback.ok && menuFallback.guard.windowSignal === 'frontmost_menu_bar',
    'explicit bounded menu-bar fallback can ground a windowless menu action',
  );

  const invalidFreshnessSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation() }],
    () => baseMs,
  );
  const invalidFreshness = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.press_keys',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: invalidFreshnessSequence.deps,
    freshnessMs: Number.NaN,
  });
  assert(
    invalidFreshness.ok
      && Date.parse(invalidFreshness.guard.expiresAt)
        - Date.parse(invalidFreshness.guard.observedAt) === 15_000,
    'non-finite freshness input uses the bounded default instead of failing open',
  );

  const incompatibleFallbackSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        windowCount: 0,
        windowTitles: [],
        fallbackSignal: {
          kind: 'verified_screen_bounds',
          width: 1512,
          height: 982,
        },
      }),
    }],
    () => baseMs,
  );
  const incompatibleFallback = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: incompatibleFallbackSequence.deps,
  });
  assert(
    !incompatibleFallback.ok && incompatibleFallback.errorCode === 'target_not_visible',
    'screen-bounds fallback cannot authorize typing into a windowless app',
  );
  const windowlessCoordinateSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        windowCount: 0,
        windowTitles: [],
        fallbackSignal: {
          kind: 'verified_screen_bounds',
          width: 1512,
          height: 982,
        },
      }),
    }],
    () => baseMs,
  );
  const windowlessCoordinateFallback = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.mouse_click',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: windowlessCoordinateSequence.deps,
  });
  assert(
    !windowlessCoordinateFallback.ok
      && windowlessCoordinateFallback.errorCode === 'target_not_visible',
    'screen bounds alone cannot authorize coordinates without a visible target-app window',
  );

  const missingWindowSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        windowCount: 0,
        windowTitles: [],
        fallbackSignal: null,
      }),
    }],
    () => baseMs,
  );
  const missingWindow = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.mouse_click',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: missingWindowSequence.deps,
  });
  assert(
    !missingWindow.ok && missingWindow.errorCode === 'target_not_visible',
    'no visible window and no explicit compatible fallback fails closed',
  );

  const revokedTitles = Proxy.revocable([], {});
  revokedTitles.revoke();
  const hostileWindowSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        windowTitles: revokedTitles.proxy,
      }),
    }],
    () => baseMs,
  );
  const hostileWindow = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.mouse_click',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: hostileWindowSequence.deps,
  });
  assert(
    !hostileWindow.ok && hostileWindow.errorCode === 'observation_invalid',
    'hostile window-title containers fail closed without crashing the guard',
  );

  const staleSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        observedAt: baseMs - 30_000,
      }),
    }],
    () => baseMs,
  );
  const stale = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: staleSequence.deps,
    freshnessMs: 5_000,
  });
  assert(
    !stale.ok && stale.errorCode === 'observation_stale',
    'stale bridge observation timestamps fail closed before approval',
  );

  const offlineSecret = '/Users/example/private/offline-token.txt';
  const offlineSequence = makeSequenceDeps(
    [{
      ok: false,
      errorCode: 'offline',
      error: offlineSecret,
    }],
    () => baseMs,
  );
  const offline = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.click_at',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: offlineSequence.deps,
  });
  assert(
    !offline.ok
      && offline.errorCode === 'bridge_offline'
      && !JSON.stringify(offline).includes(offlineSecret),
    'offline bridge failures return a fixed code without raw error/path leakage',
  );

  const thrownSecret = new Error(`bridge error ${privateWindowTitle}`);
  const thrownSequence = makeSequenceDeps(
    [thrownSecret],
    () => baseMs,
  );
  const thrown = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.mouse_drag',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: thrownSequence.deps,
  });
  assert(
    !thrown.ok
      && thrown.errorCode === 'observation_unavailable'
      && !JSON.stringify(thrown).includes(privateWindowTitle),
    'thrown bridge errors fail closed without surfacing raw exception text',
  );

  for (const [label, overrides] of [
    ['non-positive PID', { pid: 0 }],
    ['not running', { appRunning: false }],
    ['not frontmost', { frontmost: false }],
  ] as const) {
    const invalidSequence = makeSequenceDeps(
      [{ ok: true, data: makeObservation(overrides) }],
      () => baseMs,
    );
    const invalid = await prepareGenericNativeUiMutationGuard({
      tool: 'desktop.press_keys',
      expectedResolvedAppName: privateAppName,
      toolArgsFingerprint,
      deps: invalidSequence.deps,
    });
    assert(
      !invalid.ok && invalid.errorCode === 'observation_invalid',
      `${label} fails the native UI observation guard`,
    );
  }

  const appDriftName = `${privateAppName} Lookalike`;
  const appDriftSequence = makeSequenceDeps(
    [{
      ok: true,
      data: makeObservation({
        requestedAppName: privateAppName,
        resolvedAppName: appDriftName,
        app: appDriftName,
        frontmostApp: appDriftName,
      }),
    }],
    () => baseMs,
  );
  const appDrift = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: appDriftSequence.deps,
  });
  assert(
    !appDrift.ok
      && appDrift.errorCode === 'target_identity_drift'
      && !JSON.stringify(appDrift).includes(appDriftName),
    'resolved-app lookalikes fail closed without leaking the observed identity',
  );

  const invalidDigestSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation() }],
    () => baseMs,
    async () => `raw-${privateWindowTitle}`,
  );
  const invalidDigest = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.mouse_scroll',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: invalidDigestSequence.deps,
  });
  assert(
    !invalidDigest.ok
      && invalidDigest.errorCode === 'binding_unavailable'
      && !JSON.stringify(invalidDigest).includes(privateWindowTitle),
    'non-SHA digest dependencies fail closed without returning raw binding input',
  );

  let slowDigestNow = baseMs;
  const slowDigestSequence = makeSequenceDeps(
    [{ ok: true, data: makeObservation() }],
    () => slowDigestNow,
    async (value) => {
      slowDigestNow += 2_000;
      return digest(value);
    },
  );
  const slowDigest = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.type_text',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: slowDigestSequence.deps,
    freshnessMs: 5_000,
  });
  assert(
    !slowDigest.ok && slowDigest.errorCode === 'observation_stale',
    'a binding dependency that outlives the observation freshness window fails closed',
  );

  let expiredNow = baseMs;
  const expiredSequence = makeSequenceDeps(
    [
      { ok: true, data: makeObservation() },
      { ok: true, data: makeObservation() },
    ],
    () => expiredNow,
  );
  const expiredPrepared = await prepareGenericNativeUiMutationGuard({
    tool: 'desktop.mouse_move',
    expectedResolvedAppName: privateAppName,
    toolArgsFingerprint,
    deps: expiredSequence.deps,
    freshnessMs: 1_000,
  });
  if (expiredPrepared.ok) {
    expiredNow += 2_000;
    const expired = await recheckGenericNativeUiMutationGuardAtHandlerEntry({
      guard: expiredPrepared.guard,
      approvalBindingSha256: expiredPrepared.guard.approvalBindingSha256,
      deps: expiredSequence.deps,
    });
    assert(
      !expired.ok
        && expired.errorCode === 'observation_stale'
        && expiredSequence.observationCalls() === 1,
      'expired pre-approval guard fails closed before any handler-entry observation',
    );
  } else {
    assert(false, 'expiry fixture prepares a valid guard', expiredPrepared.errorCode);
  }
}

async function runNativeSemanticTargetContractSmoke() {
  const baseMs = Date.parse('2026-07-26T16:00:00.000Z');
  const normalizedArgs = {
    targetKind: 'native_accessibility',
    value: 'completed',
  };
  const toolArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync(normalizedArgs);
  assert(
    /^args-v2:sha256:[a-f0-9]{64}$/.test(toolArgsFingerprint),
    'native semantic action binds the exact normalized arguments with SHA-256',
    toolArgsFingerprint,
  );

  const firstTargetFingerprint = `uc_ax_target_${'a'.repeat(64)}`;
  const secondTargetFingerprint = `uc_ax_target_${'b'.repeat(64)}`;
  const semanticTarget: ComputerAppObservationTarget = {
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4321,
    accessibilityGeneration: 101,
    accessibilityTargetFingerprint: firstTargetFingerprint,
  };
  const makeAction = (
    actionId: string,
    observationEpochId: string,
    expectedTarget: ComputerAppObservationTarget,
  ): ComputerAppMutationContract => ({
    schemaVersion: 1,
    actionId,
    tool: 'desktop.set_element_value',
    surface: 'desktop',
    observationEpochId,
    expectedTarget,
    toolArgsFingerprint,
    risk: 'medium',
    approvalRequired: true,
    idempotencyKey: `grounding-smoke:${actionId}`,
    verification: {
      kind: 'accessibility',
      predicate: 'The exact native control reflects the requested state.',
      evidenceTools: ['desktop.read_a11y_tree'],
    },
    outcomeUnknownPolicy: 'verify_before_retry',
  });
  const approve = (action: ComputerAppMutationContract, decidedAt: number) =>
    resolveComputerAppMutationPolicy({
      action,
      decidedAt,
      approvalGate: async (request) => ({
        decision: 'approved',
        approvalId: `approval:${action.actionId}`,
        approvalKey: request.approvalKey,
      }),
    });

  const semanticEpoch = createComputerAppObservationEpoch({
    id: 'grounding-native-semantic-before',
    surface: 'desktop',
    capturedAt: baseMs,
    target: semanticTarget,
    evidenceIds: ['native-semantic-before'],
  });
  const semanticAction = makeAction(
    'grounding-native-semantic-action',
    semanticEpoch.id,
    semanticTarget,
  );
  const semanticPolicy = await approve(semanticAction, baseMs + 100);
  const semanticAuthorization = authorizeComputerAppMutation({
    action: semanticAction,
    policy: semanticPolicy,
    epoch: semanticEpoch,
    now: baseMs + 200,
  });
  assert(
    semanticEpoch.target.accessibilityTargetFingerprint === firstTargetFingerprint,
    'observation epochs compact and retain the privacy-safe native target fingerprint',
    String(semanticEpoch.target.accessibilityTargetFingerprint),
  );
  assert(
    semanticAuthorization.allowed,
    'desktop semantic action accepts app + PID + accessibility generation without a window ID',
    semanticAuthorization.summary,
  );

  const changedFingerprintAction: ComputerAppMutationContract = {
    ...semanticAction,
    expectedTarget: {
      ...semanticAction.expectedTarget,
      accessibilityTargetFingerprint: secondTargetFingerprint,
    },
  };
  assert(
    buildComputerAppMutationApprovalKey(changedFingerprintAction)
      !== buildComputerAppMutationApprovalKey(semanticAction),
    'native target fingerprint is bound into the exact mutation approval key',
  );
  const changedGenerationAction: ComputerAppMutationContract = {
    ...semanticAction,
    expectedTarget: {
      ...semanticAction.expectedTarget,
      accessibilityGeneration: 102,
    },
  };
  assert(
    buildComputerAppMutationApprovalKey(changedGenerationAction)
      === buildComputerAppMutationApprovalKey(semanticAction),
    'volatile accessibility generation stays outside the durable approval key',
  );

  const mismatchEpoch = createComputerAppObservationEpoch({
    id: 'grounding-native-fingerprint-mismatch',
    surface: 'desktop',
    capturedAt: baseMs,
    target: {
      ...semanticTarget,
      accessibilityTargetFingerprint: secondTargetFingerprint,
    },
    evidenceIds: ['native-semantic-mismatch'],
  });
  const mismatchAction = makeAction(
    'grounding-native-fingerprint-mismatch-action',
    mismatchEpoch.id,
    semanticTarget,
  );
  const mismatchAuthorization = authorizeComputerAppMutation({
    action: mismatchAction,
    policy: await approve(mismatchAction, baseMs + 100),
    epoch: mismatchEpoch,
    now: baseMs + 200,
  });
  assert(
    !mismatchAuthorization.allowed
      && mismatchAuthorization.blockers.some((blocker) =>
        blocker.code === 'target_mismatch'
        && blocker.detail.includes('accessibilityTargetFingerprint')),
    'changed native target fingerprint fails closed with a typed target mismatch',
    JSON.stringify(mismatchAuthorization.blockers),
  );

  const incompleteTarget: ComputerAppObservationTarget = {
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4321,
    accessibilityTargetFingerprint: firstTargetFingerprint,
  };
  const incompleteEpoch = createComputerAppObservationEpoch({
    id: 'grounding-native-incomplete-identity',
    surface: 'desktop',
    capturedAt: baseMs,
    target: incompleteTarget,
    evidenceIds: ['native-incomplete-before'],
  });
  const incompleteAction = makeAction(
    'grounding-native-incomplete-identity-action',
    incompleteEpoch.id,
    incompleteTarget,
  );
  const incompleteAuthorization = authorizeComputerAppMutation({
    action: incompleteAction,
    policy: await approve(incompleteAction, baseMs + 100),
    epoch: incompleteEpoch,
    now: baseMs + 200,
  });
  assert(
    !incompleteAuthorization.allowed
      && incompleteAuthorization.blockers.some((blocker) =>
        blocker.code === 'target_identity_missing'),
    'desktop action without either window ID or accessibility generation fails closed',
    JSON.stringify(incompleteAuthorization.blockers),
  );

  const windowTarget: ComputerAppObservationTarget = {
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4321,
    windowId: 17,
  };
  const windowEpoch = createComputerAppObservationEpoch({
    id: 'grounding-window-identity-before',
    surface: 'desktop',
    capturedAt: baseMs,
    target: windowTarget,
    evidenceIds: ['window-identity-before'],
  });
  const windowAction = makeAction(
    'grounding-window-identity-action',
    windowEpoch.id,
    windowTarget,
  );
  const windowAuthorization = authorizeComputerAppMutation({
    action: windowAction,
    policy: await approve(windowAction, baseMs + 100),
    epoch: windowEpoch,
    now: baseMs + 200,
  });
  assert(
    windowAuthorization.allowed,
    'existing app + PID + window identity authorization remains supported',
    windowAuthorization.summary,
  );

  if (!semanticAuthorization.allowed) return;
  const dispatch = await dispatchAuthorizedComputerAppMutation({
    action: semanticAction,
    authorization: semanticAuthorization,
    normalizedArgs,
    now: baseMs + 300,
    handler: async () => true,
  });
  assert(dispatch.ok, 'authorized native semantic action reaches the sealed handler');

  const afterEpoch = createComputerAppObservationEpoch({
    id: 'grounding-native-semantic-after',
    surface: 'desktop',
    capturedAt: baseMs + 400,
    target: {
      ...semanticTarget,
      accessibilityGeneration: 102,
      accessibilityTargetFingerprint: null,
    },
    evidenceIds: ['native-semantic-after'],
  });
  const verification = buildComputerAppVerificationReceipt({
    action: semanticAction,
    authorization: semanticAuthorization,
    dispatchReceipt: dispatch.dispatchReceipt,
    beforeEpoch: semanticEpoch,
    afterEpoch,
    predicateSatisfied: true,
    evidenceIds: ['native-semantic-proof'],
    checkedAt: baseMs + 500,
  });
  assert(
    verification.canComplete,
    'after-state verification permits the acted-on native target to disappear and tree generation to change',
    JSON.stringify(verification.blockers),
  );
}

runGenericNativeUiMutationObservationGuardSmoke()
  .then(() => runNativeSemanticTargetContractSmoke())
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} computer/app grounding smoke failure(s)`);
      process.exit(1);
    }
    console.log('\nAll computer/app grounding smoke cases passed.');
  })
  .catch((error) => {
    console.error('FAIL: native UI mutation grounding smoke crashed', error);
    process.exit(1);
  });
