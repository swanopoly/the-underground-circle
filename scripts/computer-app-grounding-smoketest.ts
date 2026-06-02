/**
 * computer-app-grounding-smoketest - verifies browser/desktop action
 * plans are grounded in fresh observations before OpenSwan/SwanBot can
 * execute them.
 *
 * Run: npm run smoke:computer-app-grounding
 */

import {
  auditComputerAppGroundingActions,
  buildComputerAppGroundingRunbook,
  buildComputerAppGroundingPlan,
  buildComputerAppGroundingPromptBlock,
  buildComputerAppGroundingTrace,
  evaluateComputerAppActionReadiness,
  recommendComputerAppGroundingNextStep,
  type ComputerAppGroundedAction,
  type ComputerAppGroundingObservation,
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
  promptIncludes: ['Do not substitute Browserbase', 'none for read-only work'],
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

if (failures > 0) {
  console.error(`\n${failures} computer/app grounding smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer/app grounding smoke cases passed.');
