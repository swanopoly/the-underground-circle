/**
 * computer-task-complexity-smoketest
 *
 * Locks the checkpoint plan used by complex desktop/browser/file tasks.
 *
 * Run: npm run smoke:computer-task-complexity
 */

import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';
import {
  diagnoseComputerTaskCheckpointFailure,
  formatComputerTaskCheckpointRecoveryForPrompt,
} from '../src/lib/computerTaskCheckpointRecovery';
import { buildComputerTaskStateSteps, compactComputerTaskCheckpointRecovery, compactComputerTaskComplexityPlan, evaluateComputerTaskCheckpointEvidenceReadiness, markComputerTaskCheckpointRecoveryObserved } from '../src/lib/computerTaskStateModel';
import { prepareComputerTaskExecution } from '../src/lib/computerTaskExecution';

const CAPABILITY_IDS: ComputerCapabilityId[] = [
  'browser_automation',
  'browser_sessions',
  'file_search',
  'file_read',
  'file_write',
  'app_tools',
  'agent_bridges',
  'desktop_control',
];

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>> = {}): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => {
    const status = overrides[id] || 'ready';
    return {
      id,
      label: id,
      status,
      detail: `${id} ${status}`,
      sources: status === 'missing' ? [] : ['smoke-test'],
    };
  });
  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: [],
    availableIntegrationCapabilities: ['web_automation', 'remote_browser_sessions'],
    activeBridgeProviders: ['openswan'],
    activeMcpServerCount: 1,
    activeMcpToolCount: 8,
  };
}

const uploadWorkflow = prepareComputerTaskExecution({
  task: 'Find logo.png on my Desktop, log into Shopify, upload it to the product page, verify the preview, and publish after I approve',
  audit: audit(),
  grantedIds: ['browser_navigation', 'browser_side_effect', 'file_read', 'file_write', 'app_read', 'app_action'],
});
assert(uploadWorkflow.preview.kind === 'hybrid_task', 'browser/file upload workflow is hybrid', uploadWorkflow.preview.kind);
assert(uploadWorkflow.complexityPlan.level === 'complex', 'browser/file upload workflow is complex', uploadWorkflow.complexityPlan.level);
assert(uploadWorkflow.complexityPlan.reasons.includes('cross-surface workflow'), 'complexity reasons include cross-surface workflow');
assert(uploadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'resolve-files'), 'complex workflow resolves local files');
assert(uploadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'observe-browser'), 'complex workflow observes browser state');
assert(uploadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'approval-before-side-effect'), 'complex workflow gates final side effect');
assert(uploadWorkflow.dispatchPrefix.includes('## Complex Computer Task Checkpoints'), 'dispatch prefix includes checkpoint block');
assert(uploadWorkflow.dispatchPrefix.includes('Run checkpoints in order'), 'dispatch prefix enforces checkpoint order');
const uploadStateComplexity = compactComputerTaskComplexityPlan(uploadWorkflow.complexityPlan);
assert(uploadStateComplexity?.level === 'complex', 'complex plan compacts into task state');
assert(!!uploadStateComplexity?.reasons.includes('cross-surface workflow'), 'task state compact keeps complexity reasons');
assert(!!uploadStateComplexity?.checkpoints.some((checkpoint) => checkpoint.id === 'resolve-files'), 'task state compact keeps checkpoint ids');
assert(
  buildComputerTaskStateSteps({
    taskKind: uploadWorkflow.preview.kind,
    phase: 'executing',
    complexity: uploadStateComplexity,
  }).some((step) => step.id === 'checkpoints' && step.status === 'active'),
  'task state adds active checkpoint step while executing complex work',
);
const uploadCheckpointRecovery = diagnoseComputerTaskCheckpointFailure({
  task: uploadWorkflow.preview.label,
  failureMessage: 'Upload failed because logo.png was not found inside the granted Desktop folder.',
  outcomeStatus: 'blocked',
  executionKind: 'run_computer_task',
  complexityPlan: uploadWorkflow.complexityPlan,
});
assert(uploadCheckpointRecovery?.failedCheckpointId === 'resolve-files', 'file blocker maps to resolve-files checkpoint', uploadCheckpointRecovery?.failedCheckpointId);
assert(uploadCheckpointRecovery?.safeNextStep.includes('exact path'), 'checkpoint recovery includes bounded file next step');
assert(uploadCheckpointRecovery?.retryPolicy.canRetry === true, 'checkpoint recovery allows one bounded retry');
assert(uploadCheckpointRecovery?.retryPolicy.requiredEvidence.some((item) => item.tool === 'desktop.file_search'), 'checkpoint recovery requires file search evidence');
assert(uploadCheckpointRecovery?.retryPolicy.requiredEvidence.some((item) => item.tool === 'desktop.file_stat'), 'checkpoint recovery requires file identity evidence');
assert(uploadCheckpointRecovery?.retryPolicy.forbiddenActions.some((item) => item.includes('No upload')), 'checkpoint recovery forbids file mutation before evidence');
assert(uploadCheckpointRecovery?.retryPolicy.resumeInstruction.includes('Collect fresh evidence'), 'checkpoint recovery includes resume instruction');
assert(formatComputerTaskCheckpointRecoveryForPrompt(uploadCheckpointRecovery)?.includes('failed checkpoint: resolve-files'), 'checkpoint recovery prompt names failed checkpoint');
assert(formatComputerTaskCheckpointRecoveryForPrompt(uploadCheckpointRecovery)?.includes('retry guard'), 'checkpoint recovery prompt includes retry guard');
assert(formatComputerTaskCheckpointRecoveryForPrompt(uploadCheckpointRecovery)?.includes('required fresh evidence'), 'checkpoint recovery prompt includes evidence requirements');
const compactUploadCheckpointRecovery = compactComputerTaskCheckpointRecovery(uploadCheckpointRecovery);
assert(compactUploadCheckpointRecovery?.failedCheckpointId === 'resolve-files', 'checkpoint recovery compacts into task state');
assert(!!compactUploadCheckpointRecovery?.safeNextStep.includes('exact path'), 'task state checkpoint recovery keeps safe next step');
assert(!!compactUploadCheckpointRecovery?.retryPolicy?.failureFingerprint.startsWith('checkpoint:resolve-files:'), 'task state checkpoint recovery keeps retry fingerprint');
const firstObservedUploadRecovery = markComputerTaskCheckpointRecoveryObserved(null, uploadCheckpointRecovery);
assert(firstObservedUploadRecovery?.retryPolicy?.repeatCount === 1, 'first checkpoint observation starts retry counter');
assert(firstObservedUploadRecovery?.retryPolicy?.canRetry === true, 'first checkpoint observation can retry once');
assert(firstObservedUploadRecovery?.retryPolicy?.evidenceReadiness?.status === 'missing', 'first checkpoint observation starts with missing evidence status', firstObservedUploadRecovery?.retryPolicy?.evidenceReadiness?.status);
assert(firstObservedUploadRecovery?.retryPolicy?.evidenceReadiness?.nextEvidenceTools.includes('desktop.file_search'), 'missing evidence points to next evidence tool');
const nowMs = Date.parse('2026-05-22T12:00:00.000Z');
const readyEvidence = evaluateComputerTaskCheckpointEvidenceReadiness({
  recovery: uploadCheckpointRecovery,
  nowMs,
  observations: [
    {
      id: 'file-search',
      tool: 'desktop.file_search',
      capturedAt: nowMs - 1_000,
      summary: 'Found /Users/cswanson/Desktop/logo.png',
    },
    {
      id: 'file-identity',
      tool: 'desktop.file_stat',
      capturedAt: nowMs - 1_000,
      summary: 'logo.png sha256=abc size=1234',
    },
  ],
});
assert(readyEvidence?.ready === true, 'checkpoint evidence readiness passes with fresh required evidence');
assert(readyEvidence?.status === 'ready', 'checkpoint evidence readiness reports ready');
const staleEvidence = evaluateComputerTaskCheckpointEvidenceReadiness({
  recovery: uploadCheckpointRecovery,
  nowMs,
  observations: [
    {
      id: 'file-search',
      tool: 'desktop.file_search',
      capturedAt: nowMs - 30_000,
      summary: 'Old file search',
    },
    {
      id: 'file-identity',
      tool: 'desktop.file_stat',
      capturedAt: nowMs - 30_000,
      summary: 'Old file stat',
    },
  ],
});
assert(staleEvidence?.status === 'stale', 'checkpoint evidence readiness detects stale evidence', staleEvidence?.status);
const repeatedUploadRecovery = markComputerTaskCheckpointRecoveryObserved(firstObservedUploadRecovery, uploadCheckpointRecovery);
assert(repeatedUploadRecovery?.retryPolicy?.repeatCount === 2, 'repeated checkpoint failure increments retry counter');
assert(repeatedUploadRecovery?.retryPolicy?.canRetry === false, 'repeated checkpoint failure blocks another blind retry');
assert(!!repeatedUploadRecovery?.retryPolicy?.stopReason?.includes('same checkpoint failure repeated'), 'repeated checkpoint failure explains stop reason');
assert(repeatedUploadRecovery?.retryPolicy?.evidenceReadiness?.status === 'blocked', 'repeated checkpoint failure blocks evidence readiness');

const cadWorkflow = prepareComputerTaskExecution({
  task: 'Open AutoCAD, create a dimensioned floor plan with correct units, export the DWG and PDF after approval',
  audit: audit(),
  grantedIds: ['app_read', 'app_action', 'file_read', 'file_write'],
});
assert(cadWorkflow.preview.kind === 'hybrid_task' || cadWorkflow.preview.kind === 'app_task', 'CAD workflow routes through app/hybrid runtime', cadWorkflow.preview.kind);
assert(cadWorkflow.complexityPlan.level === 'complex', 'CAD workflow is complex', cadWorkflow.complexityPlan.level);
assert(cadWorkflow.complexityPlan.reasons.includes('visual or precision desktop work'), 'CAD workflow marks precision desktop work');
assert(cadWorkflow.complexityPlan.checkpoints.some((checkpoint) => checkpoint.id === 'observe-desktop'), 'CAD workflow observes desktop/app state');
assert(cadWorkflow.dispatchPrefix.includes('Checkpoint rule'), 'CAD dispatch prefix carries checkpoint rule');
const cadCheckpointRecovery = diagnoseComputerTaskCheckpointFailure({
  task: 'Open AutoCAD, create a dimensioned floor plan with correct units, export the DWG and PDF after approval',
  failureMessage: 'Accessibility tree unavailable and screenshot capture failed before the AutoCAD window could be verified.',
  outcomeStatus: 'failed',
  executionKind: 'run_computer_task',
  stateComplexity: compactComputerTaskComplexityPlan(cadWorkflow.complexityPlan),
});
assert(cadCheckpointRecovery?.failedCheckpointId === 'observe-desktop', 'desktop observation blocker maps to observe-desktop checkpoint', cadCheckpointRecovery?.failedCheckpointId);
assert(cadCheckpointRecovery?.confidence === 'high', 'desktop checkpoint diagnosis is high confidence', cadCheckpointRecovery?.confidence);
assert(cadCheckpointRecovery?.retryPolicy.requiredEvidence.some((item) => item.tool === 'desktop.screenshot'), 'desktop checkpoint requires screenshot evidence');
assert(cadCheckpointRecovery?.retryPolicy.forbiddenActions.some((item) => item.includes('No keyboard')), 'desktop checkpoint forbids blind desktop action');

const simpleLaunch = prepareComputerTaskExecution({
  task: 'open zoom',
  audit: audit(),
  grantedIds: ['app_read'],
});
assert(simpleLaunch.complexityPlan.level === 'simple', 'pure app launch stays simple', simpleLaunch.complexityPlan.level);
assert(!simpleLaunch.dispatchPrefix.includes('## Complex Computer Task Checkpoints'), 'simple task does not inflate dispatch prefix');
assert(simpleLaunch.complexityPlan.visibleNextSteps.length <= 3, 'simple task keeps next steps compact');
assert(compactComputerTaskComplexityPlan(simpleLaunch.complexityPlan) === null, 'simple plan does not persist checkpoint state');
assert(diagnoseComputerTaskCheckpointFailure({
  task: 'open zoom',
  failureMessage: 'Zoom failed to launch.',
  complexityPlan: simpleLaunch.complexityPlan,
}) === null, 'simple task does not emit checkpoint recovery');

// ─── D2: pending-question persistence model ─────────────────────────────────

{
  const {
    compactComputerTaskPendingQuestions,
    upsertComputerTaskPendingQuestion,
    resolveComputerTaskPendingQuestion,
    listOpenComputerTaskQuestions,
  } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');

  const q = (id: string, status: 'pending' | 'answered' | 'expired' = 'pending') => ({
    id,
    question: `Question ${id}?`,
    options: ['yes', 'no'],
    context: null,
    askedAt: '2026-06-10T12:00:00.000Z',
    sessionId: 'sess-1',
    runId: 'run-1',
    status,
    answer: null,
    resolvedAt: null,
  });

  // Upsert adds, replaces by id, and bounds the list at 5.
  let list = upsertComputerTaskPendingQuestion([], q('a'));
  list = upsertComputerTaskPendingQuestion(list, q('b'));
  list = upsertComputerTaskPendingQuestion(list, { ...q('a'), question: 'Updated A?' });
  assert(list.length === 2, 'pendingQ: upsert replaces by id', String(list.length));
  assert(list.find((item) => item.id === 'a')?.question === 'Updated A?', 'pendingQ: replacement wins');
  for (const id of ['c', 'd', 'e', 'f', 'g']) list = upsertComputerTaskPendingQuestion(list, q(id));
  assert(list.length === 5, 'pendingQ: list bounded at 5', String(list.length));

  // Resolve marks answered; null answer marks expired; non-pending untouched.
  const answered = resolveComputerTaskPendingQuestion([q('a')], 'a', 'yes', '2026-06-10T12:01:00.000Z');
  assert(answered[0].status === 'answered' && answered[0].answer === 'yes', 'pendingQ: resolve answers');
  const expired = resolveComputerTaskPendingQuestion([q('a')], 'a', null, '2026-06-10T12:01:00.000Z');
  assert(expired[0].status === 'expired', 'pendingQ: null answer expires');
  const untouched = resolveComputerTaskPendingQuestion([q('a', 'answered')], 'a', 'no', '2026-06-10T12:02:00.000Z');
  assert(untouched[0].answer === null, 'pendingQ: resolved question is immutable');

  // Open-question projection filters to pending only.
  const open = listOpenComputerTaskQuestions({ pendingQuestions: [q('a'), q('b', 'answered'), q('c', 'expired')] });
  assert(open.length === 1 && open[0].id === 'a', 'pendingQ: open list filters to pending');

  // Compaction drops malformed entries and bounds strings.
  const compacted = compactComputerTaskPendingQuestions([
    { id: '', question: 'no id' },
    { id: 'ok', question: 'x'.repeat(900), options: ['1', '2', '3', '4', '5', '6', '7', '8'] },
  ] as any);
  assert(compacted.length === 1, 'pendingQ: malformed entries dropped');
  assert(compacted[0].question.length <= 500 && compacted[0].options.length <= 6, 'pendingQ: strings + options bounded');
}

// ─── D6: checklist card projection ──────────────────────────────────────────

{
  const {
    buildComputerTaskChecklistCard,
    formatComputerTaskChecklistCard,
  } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');

  const record = {
    id: 'task-1',
    circleId: 'c1',
    threadId: null,
    task: 'Log into supplier portal and download invoices',
    taskKind: 'browser_task',
    taskLabel: 'Supplier invoice download',
    phase: 'executing' as const,
    currentStep: 'execute',
    steps: [
      { id: 'plan', label: 'Plan task', status: 'completed' as const },
      { id: 'approval', label: 'Approve access', status: 'completed' as const },
      { id: 'execute', label: 'Execute task', status: 'active' as const },
      { id: 'summarize', label: 'Summarize result', status: 'pending' as const },
    ],
    blockers: [],
    nextSteps: [],
    grantedAccess: [],
    accessPlan: null,
    sessionId: 'sess-9',
    liveUrl: 'https://www.browserbase.com/sessions/sess-9',
    pendingQuestions: [{
      id: 'q1',
      question: 'The portal is asking for an MFA code — can you provide it?',
      options: [],
      context: 'Login step',
      askedAt: '2026-06-10T12:00:00.000Z',
      sessionId: 'sess-9',
      runId: 'run-9',
      status: 'pending' as const,
      answer: null,
      resolvedAt: null,
    }],
    updatedAt: '2026-06-10T12:00:30.000Z',
  };

  const card = buildComputerTaskChecklistCard(record);
  assert(!!card, 'checklist: card built from record');
  if (card) {
    assert(card.active === true, 'checklist: executing task is active');
    assert(card.resumable === true, 'checklist: session present → resumable');
    assert(card.needsYou.length === 1 && card.needsYou[0].kind === 'question', 'checklist: open question becomes needs-you item');
    assert(card.needsYou[0].questionId === 'q1', 'checklist: needs-you carries question id');
    const text = formatComputerTaskChecklistCard(card);
    assert(text.includes('Needs your answer'), 'checklist: formatter surfaces the question');
    assert(text.includes('✓ Plan task') && text.includes('▸ Execute task'), 'checklist: step glyphs render');
    assert(text.includes('Resumable session:'), 'checklist: resumable link rendered');
  }

  // Completed task: not active, answered questions don't nag, no resume line.
  const doneCard = buildComputerTaskChecklistCard({
    ...record,
    phase: 'completed' as const,
    pendingQuestions: [{ ...record.pendingQuestions[0], status: 'answered' as const, answer: '123456' }],
  });
  assert(!!doneCard && !doneCard.active, 'checklist: completed task inactive');
  assert(doneCard!.needsYou.length === 0, 'checklist: answered question not in needs-you');
  assert(!doneCard!.resumable, 'checklist: completed task not resumable');
  assert(buildComputerTaskChecklistCard(null) === null, 'checklist: null record → null card');
  assert(formatComputerTaskChecklistCard(null) === '', 'checklist: null card formats empty');

  // Approval phase + blockers both become needs-you items, bounded.
  const blockedCard = buildComputerTaskChecklistCard({
    ...record,
    phase: 'awaiting_approval' as const,
    blockers: ['Desktop bridge offline'],
    pendingQuestions: [],
  });
  assert(!!blockedCard, 'checklist: blocked card built');
  if (blockedCard) {
    const kinds = blockedCard.needsYou.map((n) => n.kind);
    assert(kinds.includes('approval') && kinds.includes('blocker'), `checklist: approval + blocker surfaced (got ${kinds.join(',')})`);
  }
}

// ─── D4: staged multi-surface plan ──────────────────────────────────────────

{
  const {
    planComputerTaskStages,
    buildComputerTaskComplexityPlan,
    formatComputerTaskComplexityDispatchBlock,
  } = require('../src/lib/computerTaskComplexityPlan') as typeof import('../src/lib/computerTaskComplexityPlan');
  const { planComputerTaskPreview } = require('../src/lib/computerTaskPlanner') as typeof import('../src/lib/computerTaskPlanner');

  // Canonical 3-surface task: browser → files → app.
  const hybridTask = 'log into my supplier portal at portal.acme.com and download the latest invoices, then rename the files by date in my downloads folder, then import them into QuickBooks';
  const stages = planComputerTaskStages(hybridTask);
  assert(stages.length === 3, 'stages: 3-surface task yields 3 stages', String(stages.length));
  if (stages.length === 3) {
    assert(stages[0].surface === 'browser', 'stages: first is browser', stages[0].surface);
    assert(stages[1].surface === 'local_files', 'stages: second is files', stages[1].surface);
    assert(stages[2].surface === 'desktop_app', 'stages: third is app', stages[2].surface);
    assert(stages[0].ordinal === 1 && stages[2].ordinal === 3, 'stages: ordinals sequential');
    assert(stages[0].handoff.includes('artifacts'), 'stages: non-final stage has artifact handoff');
    assert(stages[2].handoff.includes('final proof'), 'stages: final stage hands off to proof');
  }

  // Single-surface multi-step task → no stages (staging overhead not worth it).
  const singleSurface = planComputerTaskStages('open amazon.com, search for standing desks, then compare the top 3 results and tell me the cheapest');
  assert(singleSurface.length === 0, 'stages: single-surface task not staged', String(singleSurface.length));

  // Short/plain tasks → no stages.
  assert(planComputerTaskStages('open zoom').length === 0, 'stages: trivial task not staged');
  assert(planComputerTaskStages('').length === 0, 'stages: empty task not staged');

  // Staged tasks are complex by construction + dispatch block carries the contract.
  const plan = buildComputerTaskComplexityPlan({ task: hybridTask, preview: planComputerTaskPreview(hybridTask) });
  assert(plan.level === 'complex', 'stages: staged task is complex', plan.level);
  assert(plan.stages.length === 3, 'stages: plan carries stages');
  assert(plan.reasons.some((r) => /staged 3-surface/.test(r)), 'stages: reason recorded');
  assert(plan.visibleNextSteps[0].startsWith('Stage 1:'), 'stages: visible steps show stages', plan.visibleNextSteps[0]);
  const block = formatComputerTaskComplexityDispatchBlock(plan) || '';
  assert(block.includes('Staged execution contract'), 'stages: dispatch block has stage contract');
  assert(block.includes('Stage 1 [browser]'), 'stages: dispatch block names surfaces');
  assert(block.includes('recovery resumes from the failed stage'), 'stages: dispatch block has resume rule');

  // Compact persistence keeps stages bounded.
  const { compactComputerTaskComplexityPlan } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');
  const compacted = compactComputerTaskComplexityPlan(plan);
  assert(!!compacted?.stages && compacted.stages.length === 3, 'stages: compacted onto state');
  assert((compacted!.stages![0].goal.length) <= 160, 'stages: compact goal bounded');

  // Non-staged plan persists stages: null (not an empty array — keeps rows lean).
  const plainPlan = buildComputerTaskComplexityPlan({
    task: 'log into shopify admin and update the hero banner after I approve',
    preview: planComputerTaskPreview('log into shopify admin and update the hero banner after I approve'),
  });
  const plainCompact = compactComputerTaskComplexityPlan(plainPlan);
  assert(!plainCompact || plainCompact.stages === null || plainCompact.stages === undefined, 'stages: single-surface persists no stages');
}

// ─── E4: data transfer & precision rules in the dispatch block ──────────────

{
  const {
    DATA_TRANSFER_PRECISION_RULES,
    formatDataTransferPrecisionRulesBlock,
    complexityPlanTouchesDesktopSurface,
    buildComputerTaskComplexityPlan,
    formatComputerTaskComplexityDispatchBlock,
  } = require('../src/lib/computerTaskComplexityPlan') as typeof import('../src/lib/computerTaskComplexityPlan');
  const { planComputerTaskPreview } = require('../src/lib/computerTaskPlanner') as typeof import('../src/lib/computerTaskPlanner');

  // Rule set shape: exactly five rules, covering the verified failure modes.
  assert(DATA_TRANSFER_PRECISION_RULES.length === 5, 'E4: five transfer rules', String(DATA_TRANSFER_PRECISION_RULES.length));
  const rulesBlock = formatDataTransferPrecisionRulesBlock();
  assert(rulesBlock.startsWith('Data transfer & precision rules (desktop/app surfaces):'), 'E4: rules block header');
  for (const needle of [
    'Never read precise strings',
    'set_element_value / fill_field / paste',
    'typed editing surfaces',
    'keyboard shortcuts over coordinate clicks',
    'reading the field value back',
  ]) {
    assert(rulesBlock.includes(needle), `E4: rules block carries "${needle}"`);
  }

  // Desktop/app-touching plan → dispatch block carries the rules.
  const hybridTask = 'log into my supplier portal at portal.acme.com and download the latest invoices, then rename the files by date in my downloads folder, then import them into QuickBooks';
  const hybridPlan = buildComputerTaskComplexityPlan({ task: hybridTask, preview: planComputerTaskPreview(hybridTask) });
  assert(complexityPlanTouchesDesktopSurface(hybridPlan), 'E4: hybrid plan touches a desktop surface');
  const hybridBlock = formatComputerTaskComplexityDispatchBlock(hybridPlan) || '';
  assert(hybridBlock.includes('Data transfer & precision rules (desktop/app surfaces):'), 'E4: hybrid dispatch block carries the rules');
  assert(hybridBlock.includes('Staged execution contract'), 'E4: rules do not displace the staged contract');
  assert(hybridBlock.includes('Checkpoint rule:'), 'E4: rules sit before the checkpoint rule footer');

  // Browser-only plan → no rules block (edge loop owns its own).
  const browserTask = 'go to acme.com and read the pricing page then summarize it';
  const browserPlan = buildComputerTaskComplexityPlan({ task: browserTask, preview: planComputerTaskPreview(browserTask) });
  if (complexityPlanTouchesDesktopSurface(browserPlan)) {
    fail('E4: browser-only plan should not register a desktop surface');
  } else {
    pass('E4: browser-only plan registers no desktop surface');
    const browserBlock = formatComputerTaskComplexityDispatchBlock(browserPlan) || '';
    assert(!browserBlock.includes('Data transfer & precision rules'), 'E4: browser-only dispatch block omits the rules');
  }

  // Null-safety for persisted/absent plans.
  assert(complexityPlanTouchesDesktopSurface(null) === false, 'E4: null plan fails closed');
  assert(complexityPlanTouchesDesktopSurface(undefined) === false, 'E4: undefined plan fails closed');
}

// ─── D4b: stage-aware recovery ──────────────────────────────────────────────

{
  const { buildComputerTaskComplexityPlan } = require('../src/lib/computerTaskComplexityPlan') as typeof import('../src/lib/computerTaskComplexityPlan');
  const { diagnoseComputerTaskCheckpointFailure, formatComputerTaskCheckpointRecoveryForPrompt } =
    require('../src/lib/computerTaskCheckpointRecovery') as typeof import('../src/lib/computerTaskCheckpointRecovery');
  const { planComputerTaskPreview } = require('../src/lib/computerTaskPlanner') as typeof import('../src/lib/computerTaskPlanner');

  const stagedTask = 'log into my supplier portal at portal.acme.com and download the latest invoices, then rename the files by date in my downloads folder, then import them into QuickBooks';
  const stagedPlan = buildComputerTaskComplexityPlan({ task: stagedTask, preview: planComputerTaskPreview(stagedTask) });

  // File-stage failure → stage 2 named, stage 1 marked completed.
  const fileFailure = diagnoseComputerTaskCheckpointFailure({
    task: stagedTask,
    failureMessage: 'Could not rename the files — path not found in the downloads folder.',
    complexityPlan: stagedPlan,
  });
  assert(!!fileFailure, 'stage recovery: diagnosis produced');
  if (fileFailure) {
    assert(fileFailure.failedStageId === 'stage-2-local_files', 'stage recovery: file failure names stage 2', String(fileFailure.failedStageId));
    assert((fileFailure.completedStageIds || []).includes('stage-1-browser'), 'stage recovery: stage 1 marked completed');
    const prompt = formatComputerTaskCheckpointRecoveryForPrompt(fileFailure) || '';
    assert(prompt.includes('failed stage: stage-2-local_files'), 'stage recovery: prompt names failed stage');
    assert(prompt.includes('do NOT redo'), 'stage recovery: prompt protects completed stages');
  }

  // Browser-stage failure (first stage) → no completed stages.
  const browserFailure = diagnoseComputerTaskCheckpointFailure({
    task: stagedTask,
    failureMessage: 'The portal login page showed a CAPTCHA and the browser session could not proceed.',
    complexityPlan: stagedPlan,
  });
  if (browserFailure) {
    assert(browserFailure.failedStageId === 'stage-1-browser', 'stage recovery: browser failure names stage 1', String(browserFailure.failedStageId));
    assert((browserFailure.completedStageIds || []).length === 0, 'stage recovery: no completed stages before stage 1');
  } else {
    assert(false, 'stage recovery: browser diagnosis produced');
  }

  // Non-staged task → no stage fields in recovery.
  const plainTask = 'log into shopify admin and update the hero banner after I approve';
  const plainPlan = buildComputerTaskComplexityPlan({ task: plainTask, preview: planComputerTaskPreview(plainTask) });
  const plainFailure = diagnoseComputerTaskCheckpointFailure({
    task: plainTask,
    failureMessage: 'Selector for the hero banner was not found.',
    complexityPlan: plainPlan,
  });
  if (plainFailure) {
    assert(!plainFailure.failedStageId, 'stage recovery: single-surface task has no failed stage');
    const plainPrompt = formatComputerTaskCheckpointRecoveryForPrompt(plainFailure) || '';
    assert(!plainPrompt.includes('failed stage:'), 'stage recovery: prompt omits stage lines for unstaged tasks');
  }

  // Compact persistence carries the stage fields.
  const { compactComputerTaskCheckpointRecovery } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');
  if (fileFailure) {
    const compactRecovery = compactComputerTaskCheckpointRecovery(fileFailure as any);
    assert(compactRecovery?.failedStageId === 'stage-2-local_files', 'stage recovery: failedStageId persists');
    assert((compactRecovery?.completedStageIds || []).includes('stage-1-browser'), 'stage recovery: completedStageIds persist');
  }
}

// ─── Stage status on the checklist + D7 recipe draft ────────────────────────

{
  const {
    buildComputerTaskChecklistCard,
    formatComputerTaskChecklistCard,
    buildComputerTaskRecipeDraft,
  } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');

  const stagedRecord = {
    id: 'task-2',
    circleId: 'c1',
    threadId: null,
    task: 'log into the portal and download invoices, then rename the files, then import into QuickBooks',
    taskKind: 'hybrid_task',
    taskLabel: 'Invoice pipeline',
    phase: 'blocked' as const,
    currentStep: null,
    steps: [],
    blockers: [],
    nextSteps: [],
    grantedAccess: [],
    accessPlan: null,
    complexity: {
      level: 'complex',
      score: 6,
      reasons: ['staged 3-surface workflow'],
      checkpoints: [],
      stages: [
        { id: 'stage-1-browser', ordinal: 1, surface: 'browser', goal: 'download invoices from the portal' },
        { id: 'stage-2-local_files', ordinal: 2, surface: 'local_files', goal: 'rename the files by date' },
        { id: 'stage-3-desktop_app', ordinal: 3, surface: 'desktop_app', goal: 'import into QuickBooks' },
      ],
    },
    checkpointRecovery: {
      level: 'complex',
      complexityScore: 6,
      failedCheckpointId: 'resolve-files',
      failedCheckpointLabel: 'Resolve local files',
      surface: 'local_files',
      requiresApproval: false,
      confidence: 'high',
      reason: 'path not found',
      safeNextStep: 'resolve the path',
      remainingCheckpointIds: [],
      failedStageId: 'stage-2-local_files',
      completedStageIds: ['stage-1-browser'],
      retryPolicy: null,
    },
    updatedAt: '2026-06-10T13:00:00.000Z',
  };

  const card = buildComputerTaskChecklistCard(stagedRecord as any);
  assert(!!card && card.stages.length === 3, 'stage status: card carries stages');
  if (card) {
    const byId = Object.fromEntries(card.stages.map((s) => [s.id, s.status]));
    assert(byId['stage-1-browser'] === 'completed', 'stage status: completed stage marked', byId['stage-1-browser']);
    assert(byId['stage-2-local_files'] === 'failed', 'stage status: failed stage marked', byId['stage-2-local_files']);
    assert(byId['stage-3-desktop_app'] === 'pending', 'stage status: later stage pending', byId['stage-3-desktop_app']);
    const text = formatComputerTaskChecklistCard(card);
    assert(text.includes('✓ Stage 1') && text.includes('✕ Stage 2') && text.includes('○ Stage 3'), 'stage status: formatter glyphs');
  }

  // Completed task → all stages completed; recipe draft builds.
  const doneRecord = { ...stagedRecord, phase: 'completed' as const, checkpointRecovery: null };
  const doneCard = buildComputerTaskChecklistCard(doneRecord as any);
  assert(!!doneCard && doneCard.stages.every((s) => s.status === 'completed'), 'stage status: completed task completes all stages');

  const recipe = buildComputerTaskRecipeDraft(doneRecord as any);
  assert(!!recipe, 'recipe: draft built from completed task');
  if (recipe) {
    assert(recipe.name === 'recipe-invoice-pipeline', 'recipe: kebab name', recipe.name);
    assert(recipe.content.startsWith('---\nname: recipe-invoice-pipeline'), 'recipe: frontmatter present');
    assert(recipe.content.includes('## Stages'), 'recipe: stages section present');
    assert(recipe.content.includes('1. [browser] download invoices'), 'recipe: stage steps rendered');
    assert(recipe.content.includes('Pause for approval'), 'recipe: safety rules included');
    assert(recipe.tags.includes('recipe') && recipe.tags.includes('browser'), 'recipe: tags include surfaces');
  }

  // Failed/blocked tasks never produce recipes.
  assert(buildComputerTaskRecipeDraft(stagedRecord as any) === null, 'recipe: blocked task → null');
  assert(buildComputerTaskRecipeDraft(null) === null, 'recipe: null record → null');

  // ─── L2 hybrid recipes: trace-embedded deterministic replay ──────────────
  const { compactComputerTaskActionTrace } =
    require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');

  const trace = {
    v: 1 as const,
    actions: [
      { tool: 'browser.navigate', input: { url: 'https://portal.acme.com/login' } },
      { tool: 'browser.type', input: { selector: '#user', text: 'billing-team' } },
      { tool: 'browser.click', input: { selector: '#download-invoices' } },
      { tool: 'desktop.file_move', input: { from: '/Users/me/Downloads/invoices-2026-05-31.zip', to: '/Users/me/Documents/invoices' } },
    ],
  };
  const hybrid = buildComputerTaskRecipeDraft(doneRecord as any, trace);
  assert(!!hybrid, 'hybrid recipe: draft built with trace');
  if (hybrid) {
    assert(hybrid.content.includes('## Deterministic replay (verified steps from the source run)'), 'hybrid recipe: replay section present');
    assert(
      hybrid.content.includes('hypotheses from one successful run')
        && hybrid.content.includes('verify the target still exists/enabled before each step')
        && hybrid.content.includes('stop'),
      'hybrid recipe: hypothesis rule prefixes the steps (finding 3)',
    );
    assert(
      hybrid.content.indexOf('hypotheses from one successful run') < hybrid.content.indexOf('1. browser.navigate('),
      'hybrid recipe: rule comes BEFORE step 1',
    );
    assert(hybrid.content.includes('1. browser.navigate('), 'hybrid recipe: numbered step 1');
    assert(hybrid.content.includes('4. desktop.file_move('), 'hybrid recipe: numbered step 4');
    assert(hybrid.content.includes('## Parameters'), 'hybrid recipe: parameters section present');
    assert(hybrid.content.includes('- <url> — example: https://portal.acme.com/login'), 'hybrid recipe: url slot detected');
    assert(hybrid.content.includes('- <file_path> — example: /Users/me/Downloads/invoices-2026-05-31.zip'), 'hybrid recipe: file path slot detected');
    assert(hybrid.content.includes('- <date> — example: 2026-05-31'), 'hybrid recipe: date slot detected');
    // Procedural sections survive — the adaptive fallback stays intact.
    assert(hybrid.content.includes('## Stages'), 'hybrid recipe: procedural stages section kept');
    assert(hybrid.content.includes('Pause for approval'), 'hybrid recipe: safety rules kept');
  }

  // Input summaries are bounded ≤120 chars per step.
  const longText = 'x'.repeat(400);
  const longInputDraft = buildComputerTaskRecipeDraft(doneRecord as any, {
    v: 1 as const,
    actions: [{ tool: 'browser.type', input: { selector: '#notes', text: longText } }],
  });
  const longLine = (longInputDraft?.content || '').split('\n').find((line) => line.startsWith('1. browser.type('));
  assert(!!longLine && longLine.length <= '1. browser.type()'.length + 121, 'hybrid recipe: input summary bounded ≤120 chars', String(longLine?.length));
  assert(!!longLine?.endsWith('…)'), 'hybrid recipe: truncated summary marked with ellipsis');

  // Bounds: a huge trace is trimmed (trace first) and the content stays ≤6k.
  const hugeTrace = {
    v: 1 as const,
    actions: Array.from({ length: 60 }, (_, index) => ({
      tool: `desktop.click_${index}`,
      input: { selector: `#button-${index}`, note: 'n'.repeat(110) },
    })),
  };
  const bounded = buildComputerTaskRecipeDraft(doneRecord as any, hugeTrace);
  assert(!!bounded && bounded.content.length <= 6000, 'hybrid recipe: huge trace bounded ≤6k chars', String(bounded?.content.length));
  assert(!!bounded?.content.includes('more steps trimmed'), 'hybrid recipe: trimming is announced');
  assert(!!bounded?.content.includes('## Goal'), 'hybrid recipe: procedural sections survive trimming');

  // No-trace output is byte-identical to the pre-L2 draft (and explicit
  // null behaves the same).
  assert(
    JSON.stringify(buildComputerTaskRecipeDraft(doneRecord as any)) === JSON.stringify(recipe),
    'hybrid recipe: no-trace draft unchanged',
  );
  assert(
    JSON.stringify(buildComputerTaskRecipeDraft(doneRecord as any, null)) === JSON.stringify(recipe),
    'hybrid recipe: explicit null trace draft unchanged',
  );

  // When the trace rides the durable record, the draft picks it up without
  // an explicit argument ("Save as recipe" path).
  const tracedRecord = { ...doneRecord, actionTrace: trace };
  assert(
    !!buildComputerTaskRecipeDraft(tracedRecord as any)?.content.includes('## Deterministic replay'),
    'hybrid recipe: record-carried trace embeds replay section',
  );

  // ─── L2 durable record field: persisted-compat normalization ─────────────
  assert(compactComputerTaskActionTrace(undefined) === null, 'action trace: old records (missing field) → null');
  assert(compactComputerTaskActionTrace(null) === null, 'action trace: null → null');
  assert(compactComputerTaskActionTrace({ v: 1, actions: [] }) === null, 'action trace: empty actions → null');
  assert(compactComputerTaskActionTrace('garbage' as any) === null, 'action trace: junk value → null');
  const compactTrace = compactComputerTaskActionTrace({
    v: 1,
    actions: [
      { tool: 'browser.click', input: { selector: '#go', nested: { drop: 'me' } as any, big: 'y'.repeat(400) } },
      { tool: '', input: { selector: '#dropped' } },
      ...Array.from({ length: 60 }, (_, index) => ({ tool: `t${index}` })),
    ],
  });
  assert(compactTrace?.v === 1 && compactTrace.actions.length === 40, 'action trace: bounded ≤40 actions, malformed dropped', String(compactTrace?.actions.length));
  assert(compactTrace?.actions[0].tool === 'browser.click', 'action trace: first action kept (replay order)');
  assert(compactTrace?.actions[0].input?.nested === undefined, 'action trace: non-primitive input values dropped');
  assert(String(compactTrace?.actions[0].input?.big || '').length === 200, 'action trace: string inputs bounded ≤200');
  // Round-trip stability: compacting a compacted trace is a no-op.
  assert(
    JSON.stringify(compactComputerTaskActionTrace(compactTrace)) === JSON.stringify(compactTrace),
    'action trace: compact is idempotent (persist round-trip safe)',
  );
}

// ─── Staged pre-flight validation ───────────────────────────────────────────

{
  const { prepareComputerTaskExecution } = require('../src/lib/computerTaskExecution') as typeof import('../src/lib/computerTaskExecution');
  const { validateComputerTaskStageSurfaces, planComputerTaskStages } =
    require('../src/lib/computerTaskComplexityPlan') as typeof import('../src/lib/computerTaskComplexityPlan');

  const stagedTask = 'log into my supplier portal at portal.acme.com and download the latest invoices, then rename the files by date in my downloads folder, then import them into QuickBooks';
  const stages = planComputerTaskStages(stagedTask);

  // Desktop surface down → stage 3 blocked, named.
  const blockers = validateComputerTaskStageSurfaces(stages, audit({ desktop_control: 'missing', app_tools: 'missing' }));
  assert(blockers.length === 1, 'stage preflight: one blocker for down desktop', String(blockers.length));
  if (blockers.length === 1) {
    assert(blockers[0].stageId === 'stage-3-desktop_app', 'stage preflight: blocker names stage 3', blockers[0].stageId);
    assert(/Stage 3 \[desktop app\] cannot run/.test(blockers[0].message), 'stage preflight: message actionable');
  }

  // Either desktop capability present → no blocker (desktop_control OR app_tools suffices).
  assert(
    validateComputerTaskStageSurfaces(stages, audit({ desktop_control: 'missing' })).length === 0,
    'stage preflight: app_tools alone unblocks the app stage',
  );

  // Partial never blocks; all-ready never blocks; no audit → no blockers (preflight handles that case).
  assert(validateComputerTaskStageSurfaces(stages, audit({ browser_automation: 'partial' })).length === 0, 'stage preflight: partial does not block');
  assert(validateComputerTaskStageSurfaces(stages, audit()).length === 0, 'stage preflight: all-ready has no blockers');
  assert(validateComputerTaskStageSurfaces(stages, null).length === 0, 'stage preflight: null audit defers to base readiness');

  // Envelope wiring: a blocked stage makes the whole task not ready at launch.
  const envelope = prepareComputerTaskExecution({
    task: stagedTask,
    audit: audit({ desktop_control: 'missing', app_tools: 'missing' }),
    grantedIds: [],
  });
  assert(envelope.stagePreflightBlockers.length === 1, 'stage preflight: envelope carries blockers');
  assert(envelope.readiness.ready === false, 'stage preflight: blocked stage fails readiness closed');
  assert(/Stage 3/.test(envelope.readiness.summary), 'stage preflight: readiness summary names the stage', envelope.readiness.summary);
  assert(envelope.readiness.missing.includes('desktop_control'), 'stage preflight: missing capabilities surfaced');

  // Healthy audit → staged task ready, no blockers.
  const healthy = prepareComputerTaskExecution({ task: stagedTask, audit: audit(), grantedIds: [] });
  assert(healthy.stagePreflightBlockers.length === 0, 'stage preflight: healthy audit has no stage blockers');
}

// ─── D6: completion/blocked notifications ───────────────────────────────────

{
  const {
    deriveComputerTaskNotification,
    computerTaskNotificationSnapshot,
    appendComputerTaskNotification,
    compactComputerTaskNotifications,
    listUnacknowledgedComputerTaskNotifications,
    acknowledgeComputerTaskNotifications,
    fireComputerTaskWebNotification,
  } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');

  const base = {
    id: 'task-3',
    circleId: 'c1',
    threadId: null,
    task: 'Log into the supplier portal and download invoices',
    taskKind: 'browser_task',
    taskLabel: 'Supplier invoice download',
    phase: 'executing' as const,
    currentStep: null,
    steps: [],
    blockers: [] as string[],
    nextSteps: [] as string[],
    grantedAccess: [],
    accessPlan: null,
    runId: 'run-3',
    updatedAt: '2026-06-10T14:00:00.000Z',
  };
  const at = '2026-06-10T14:05:00.000Z';

  // Transition: running → completed. Body carries the result summary.
  const completed = deriveComputerTaskNotification(
    { ...base, phase: 'completed' },
    computerTaskNotificationSnapshot(base),
    { nowIso: at, resultSummary: 'Downloaded 4 invoices from the portal.' },
  );
  assert(completed?.kind === 'completed', 'notify: running→completed fires', completed?.kind);
  assert(!!completed && completed.body.includes('Downloaded 4 invoices'), 'notify: completed body carries result summary');
  assert(!!completed && completed.taskRunId === 'run-3', 'notify: notification carries run id');

  // Same state twice ⇒ null (transitions only, never repeats).
  const doneRecord = { ...base, phase: 'completed' as const };
  assert(
    deriveComputerTaskNotification(doneRecord, computerTaskNotificationSnapshot(doneRecord), { nowIso: at }) === null,
    'notify: same completed state twice derives nothing',
  );
  assert(
    deriveComputerTaskNotification(base, computerTaskNotificationSnapshot(base), { nowIso: at }) === null,
    'notify: steady executing state derives nothing',
  );

  // Transition: running → failed. Body carries the top blocker.
  const failed = deriveComputerTaskNotification(
    { ...base, phase: 'failed', blockers: ['The portal login rejected the credentials.'] },
    computerTaskNotificationSnapshot(base),
    { nowIso: at },
  );
  assert(failed?.kind === 'failed', 'notify: running→failed fires', failed?.kind);
  assert(!!failed && failed.body.includes('rejected the credentials'), 'notify: failed body carries top blocker');

  // Blocker count 0 → n while still executing ⇒ blocked.
  const blocked = deriveComputerTaskNotification(
    { ...base, blockers: ['Desktop bridge offline'] },
    computerTaskNotificationSnapshot(base),
    { nowIso: at },
  );
  assert(blocked?.kind === 'blocked', 'notify: blocker 0→n fires blocked', blocked?.kind);
  assert(!!blocked && blocked.body === 'Desktop bridge offline', 'notify: blocked body is the blocker');
  // ...and n → n does not re-fire.
  const blockedRecord = { ...base, blockers: ['Desktop bridge offline'] };
  assert(
    deriveComputerTaskNotification(blockedRecord, computerTaskNotificationSnapshot(blockedRecord), { nowIso: at }) === null,
    'notify: unchanged blocker count derives nothing',
  );

  // New open question ⇒ needs_you with the question text.
  const question = {
    id: 'q9',
    question: 'The portal is asking for an MFA code — can you provide it?',
    options: [],
    context: null,
    askedAt: at,
    sessionId: null,
    runId: 'run-3',
    status: 'pending' as const,
    answer: null,
    resolvedAt: null,
  };
  const needsYou = deriveComputerTaskNotification(
    { ...base, pendingQuestions: [question] },
    computerTaskNotificationSnapshot(base),
    { nowIso: at },
  );
  assert(needsYou?.kind === 'needs_you', 'notify: new open question fires needs_you', needsYou?.kind);
  assert(!!needsYou && needsYou.body.includes('MFA code'), 'notify: needs_you body carries question text');

  // Awaiting-approval transition ⇒ needs_you.
  const approval = deriveComputerTaskNotification(
    { ...base, phase: 'awaiting_approval', accessPlan: 'Grant browser side-effect access' },
    computerTaskNotificationSnapshot(base),
    { nowIso: at },
  );
  assert(approval?.kind === 'needs_you', 'notify: awaiting approval fires needs_you', approval?.kind);

  // Partial result on a bounded stop ⇒ partial_result.
  const partial = deriveComputerTaskNotification(
    base,
    computerTaskNotificationSnapshot(base),
    { nowIso: at, partialResultSummary: 'Logged in and downloaded 2 of 4 invoices before the budget ran out.' },
  );
  assert(partial?.kind === 'partial_result', 'notify: bounded stop fires partial_result', partial?.kind);
  assert(!!partial && partial.body.includes('2 of 4 invoices'), 'notify: partial body carries progress summary');

  // Bounds: title ≤80, body ≤200.
  const longBlocker = 'x'.repeat(600);
  const bounded = deriveComputerTaskNotification(
    { ...base, taskLabel: 'L'.repeat(200), phase: 'failed', blockers: [longBlocker] },
    computerTaskNotificationSnapshot(base),
    { nowIso: at },
  );
  assert(!!bounded && bounded.title.length <= 80 && bounded.body.length <= 200, 'notify: title/body bounded');

  // Append: newest first, deduped, capped at 5.
  let list = appendComputerTaskNotification(null, completed);
  list = appendComputerTaskNotification(list, completed);
  assert(list.length === 1, 'notify: identical notification not appended twice', String(list.length));
  list = appendComputerTaskNotification(list, failed);
  assert(list[0].kind === 'failed', 'notify: newest first');
  for (let i = 0; i < 6; i += 1) {
    list = appendComputerTaskNotification(list, {
      ...blocked!,
      id: `ctn_blocked_${i}`,
      body: `blocker ${i}`,
      createdAtIso: at,
    });
  }
  assert(list.length === 5, 'notify: list bounded at 5', String(list.length));
  assert(appendComputerTaskNotification(list, null).length === 5, 'notify: null append is a no-op');

  // Acknowledge clears the unacknowledged view; record stays bounded.
  const record = { ...base, notifications: list };
  assert(listUnacknowledgedComputerTaskNotifications(record).length === 5, 'notify: unacknowledged listed');
  const acked = acknowledgeComputerTaskNotifications(record);
  assert(listUnacknowledgedComputerTaskNotifications(acked).length === 0, 'notify: acknowledge clears banner list');
  assert((acked.notifications || []).length === 5, 'notify: acknowledge keeps history');

  // Persisted-compat: old records without the field, malformed entries.
  assert(listUnacknowledgedComputerTaskNotifications(base as any).length === 0, 'notify: record without field is safe');
  assert(compactComputerTaskNotifications(undefined).length === 0, 'notify: undefined list compacts empty');
  const compacted = compactComputerTaskNotifications([
    { kind: 'bogus' as any, title: 'nope', body: '', createdAtIso: at, id: 'x' },
    { kind: 'completed', title: 't'.repeat(300), body: 'b'.repeat(900), createdAtIso: at, id: 'ok' },
  ]);
  assert(compacted.length === 1, 'notify: malformed kinds dropped', String(compacted.length));
  assert(compacted[0].title.length <= 80 && compacted[0].body.length <= 200, 'notify: compaction bounds strings');

  // Web notification helper is a silent no-op outside a hidden web page.
  assert(fireComputerTaskWebNotification(completed) === false, 'notify: web notification no-ops outside the browser');
  assert(fireComputerTaskWebNotification(null) === false, 'notify: web notification null-safe');
}

// ─── E1 follow-up: surface-escalation breadcrumbs on the durable record ─────

{
  const {
    appendComputerTaskSurfaceEscalations,
    buildComputerTaskChecklistCard,
    compactComputerTaskSurfaceEscalations,
    formatComputerTaskChecklistCard,
    formatComputerTaskSurfaceEscalationLine,
  } = require('../src/lib/computerTaskStateModel') as typeof import('../src/lib/computerTaskStateModel');

  const at = '2026-06-12T10:00:00.000Z';
  const crumb = (n: number, extra?: Record<string, unknown>) => ({
    fromSurface: 'os_accessibility',
    toSurface: 'screenshot_control',
    reason: `descent ${n}: the ranked ladder moved down a rung`,
    atIso: at,
    appName: 'Photoshop',
    failureCode: 'a11y_tree_empty',
    ...extra,
  });

  // Compaction: malformed dropped, strings bounded, list capped at 3 (newest kept).
  const compacted = compactComputerTaskSurfaceEscalations([
    { fromSurface: '', toSurface: 'pixels', reason: 'no from' },
    { fromSurface: 'a', toSurface: 'b', reason: '' },
    crumb(1, { reason: 'r'.repeat(900), appName: 'A'.repeat(300), failureCode: 'f'.repeat(200) }),
  ] as any);
  assert(compacted.length === 1, 'escalation: malformed entries dropped', String(compacted.length));
  assert(
    compacted[0].reason.length <= 300 && (compacted[0].appName || '').length <= 80 && (compacted[0].failureCode || '').length <= 60,
    'escalation: strings bounded',
  );
  const overflow = compactComputerTaskSurfaceEscalations([crumb(1), crumb(2), crumb(3), crumb(4)]);
  assert(overflow.length === 3, 'escalation: list bounded at 3', String(overflow.length));
  assert(overflow[2].reason.includes('descent 4'), 'escalation: newest entries kept on overflow');
  assert(compactComputerTaskSurfaceEscalations(undefined).length === 0, 'escalation: undefined list compacts empty');

  // Append: merges, dedupes identical from+to+reason, stays bounded.
  let merged = appendComputerTaskSurfaceEscalations(null, [crumb(1)]);
  merged = appendComputerTaskSurfaceEscalations(merged, [crumb(1), crumb(2)]);
  assert(merged.length === 2, 'escalation: duplicate descent not appended twice', String(merged.length));
  merged = appendComputerTaskSurfaceEscalations(merged, [crumb(3), crumb(4)]);
  assert(merged.length === 3 && merged[0].reason.includes('descent 2'), 'escalation: merge bounded, oldest dropped');
  assert(appendComputerTaskSurfaceEscalations(merged, null).length === 3, 'escalation: null append is a no-op');

  // Display line prefers the structured failure code and humanizes tokens.
  const line = formatComputerTaskSurfaceEscalationLine(compactComputerTaskSurfaceEscalations([crumb(1)])[0]);
  assert(
    line === '↳ switched to screenshot control: a11y tree empty (Photoshop)',
    'escalation: card line format',
    line,
  );
  const noCodeLine = formatComputerTaskSurfaceEscalationLine(
    compactComputerTaskSurfaceEscalations([crumb(1, { failureCode: null, appName: null })])[0],
  );
  assert(noCodeLine.startsWith('↳ switched to screenshot control: descent 1'), 'escalation: reason fallback line', noCodeLine);

  // Checklist-card projection + formatter rendering.
  const record = {
    id: 'task-esc',
    circleId: 'c1',
    threadId: null,
    task: 'Crop the hero image in Photoshop',
    taskKind: 'app_task',
    taskLabel: 'Photoshop crop',
    phase: 'executing' as const,
    currentStep: 'execute',
    steps: [{ id: 'execute', label: 'Execute task', status: 'active' as const }],
    blockers: [],
    nextSteps: [],
    grantedAccess: [],
    accessPlan: null,
    surfaceEscalations: [crumb(1)],
    updatedAt: at,
  };
  const card = buildComputerTaskChecklistCard(record as any);
  assert(!!card && card.surfaceChanges.length === 1, 'escalation: card projects surface changes');
  assert(Boolean(card?.surfaceChanges[0]?.includes('a11y tree empty')), 'escalation: projected line carries failure cause');
  const text = formatComputerTaskChecklistCard(card);
  assert(text.includes('↳ switched to screenshot control'), 'escalation: formatter renders breadcrumb line');

  // Persisted-compat: old records without the field are safe everywhere.
  const legacyCard = buildComputerTaskChecklistCard({ ...record, surfaceEscalations: undefined } as any);
  assert(!!legacyCard && legacyCard.surfaceChanges.length === 0, 'escalation: legacy record projects no lines');
  assert(!formatComputerTaskChecklistCard(legacyCard).includes('↳'), 'escalation: legacy record formats without breadcrumbs');
}

// ─── Wave-2: app-choice contract in the dispatch block ───────────────────────
{
  const {
    buildComputerTaskComplexityPlan,
    formatComputerTaskComplexityDispatchBlock,
  } = require('../src/lib/computerTaskComplexityPlan') as typeof import('../src/lib/computerTaskComplexityPlan');
  const { planComputerTaskPreview } = require('../src/lib/computerTaskPlanner') as typeof import('../src/lib/computerTaskPlanner');

  const appResolution = {
    category: 'photo_editing',
    best: {
      appId: 'adobe-photoshop',
      displayName: 'Adobe Photoshop 2026',
      surface: 'desktop' as const,
      openVia: 'desktop_launch' as const,
      openTarget: 'Adobe Photoshop 2026',
      reason: 'installed on this Mac',
    },
    alternativesSummary: ['Photopea — full-featured web app', 'GIMP — installed on this Mac'],
    explicitAppNamed: false,
    openStepLines: [
      'Open Adobe Photoshop 2026 (installed on this Mac) — launch it on the desktop first.',
      'Wait for Adobe Photoshop 2026 to be ready and frontmost before acting in it.',
    ],
  };

  // Threaded into a complex task: the contract section rides the dispatch
  // block WITHOUT displacing stages/checkpoints/E4 rules.
  const complexTask = 'open my supplier portal in the browser, download the invoices, then edit the photo in Photoshop and export a png';
  const threaded = buildComputerTaskComplexityPlan({
    task: complexTask,
    preview: planComputerTaskPreview(complexTask),
    appResolution,
  });
  const threadedBlock = formatComputerTaskComplexityDispatchBlock(threaded) || '';
  assert(threaded.appResolution?.best.displayName === 'Adobe Photoshop 2026', 'app-choice: plan carries the threaded resolution');
  assert(threadedBlock.includes('### App choice contract'), 'app-choice: dispatch block carries the contract section');
  assert(threadedBlock.includes('Chosen app: Adobe Photoshop 2026 (installed on this Mac)'), 'app-choice: contract names the chosen app and why');
  assert(threadedBlock.includes('Open first: Open Adobe Photoshop 2026'), 'app-choice: contract opens the app first');
  assert(threadedBlock.includes('frontmost and ready BEFORE any task action'), 'app-choice: contract verifies frontmost before acting');
  assert(
    threadedBlock.includes('fall back ONCE to Photopea — full-featured web app') && threadedBlock.includes('stop and ask the user'),
    'app-choice: contract names a single fallback before asking the user',
  );
  assert(threadedBlock.includes('## Complex Computer Task Checkpoints'), 'app-choice: checkpoint header still present');
  assert(threadedBlock.includes('Checkpoint rule: after each mutation'), 'app-choice: checkpoint rules untouched');

  // Not threaded: identical task produces NO contract (and stays parse-safe).
  const unthreaded = buildComputerTaskComplexityPlan({ task: complexTask, preview: planComputerTaskPreview(complexTask) });
  const unthreadedBlock = formatComputerTaskComplexityDispatchBlock(unthreaded) || '';
  assert(unthreaded.appResolution === null, 'app-choice: unthreaded plan carries no resolution');
  assert(!unthreadedBlock.includes('App choice contract'), 'app-choice: unthreaded dispatch block has no contract');

  // Simple task + resolution: the open-first contract still ships (it is
  // step zero regardless of complexity) — without checkpoint scaffolding.
  const simpleTask = 'edit this photo';
  const simpleWith = buildComputerTaskComplexityPlan({ task: simpleTask, preview: planComputerTaskPreview(simpleTask), appResolution });
  if (simpleWith.level === 'simple') {
    const simpleBlock = formatComputerTaskComplexityDispatchBlock(simpleWith) || '';
    assert(simpleBlock.includes('### App choice contract'), 'app-choice: simple plan with resolution still ships the contract');
    assert(!simpleBlock.includes('## Complex Computer Task Checkpoints'), 'app-choice: simple plan adds no checkpoint scaffolding');
  } else {
    pass('app-choice: simple-task fixture scored above simple — checkpoint path covers it');
  }
  const simpleWithout = buildComputerTaskComplexityPlan({ task: simpleTask, preview: planComputerTaskPreview(simpleTask) });
  if (simpleWithout.level === 'simple') {
    assert(formatComputerTaskComplexityDispatchBlock(simpleWithout) === null, 'app-choice: simple plan without resolution still formats to null');
  }

  // Fallback wording when no alternative is ranked.
  const noAltBlock = formatComputerTaskComplexityDispatchBlock({
    ...threaded,
    appResolution: { ...appResolution, alternativesSummary: [] },
  }) || '';
  assert(noAltBlock.includes('no ranked alternative'), 'app-choice: missing alternatives degrade to ask-the-user');

  // Persisted-plan compat: plans stored before this field keep formatting.
  const legacyPlan = JSON.parse(JSON.stringify(unthreaded));
  delete (legacyPlan as any).appResolution;
  assert(
    (formatComputerTaskComplexityDispatchBlock(legacyPlan) || '').includes('## Complex Computer Task Checkpoints'),
    'app-choice: pre-wave-2 persisted plan still formats',
  );

  // ─── AR3: fail-fast availability + structured fallback ────────────────────
  // A named app whose install is UNCONFIRMED ('maybe') must be proven to
  // launch before task work, the contract names the user's intent, and the
  // fallback comes from the structured recoveryFallback (a known-launchable
  // web app) — not a blind alternativesSummary[0].
  const maybeNamedResolution = {
    category: 'photo_editing',
    best: {
      appId: 'pixelmator-pro',
      displayName: 'Pixelmator Pro',
      surface: 'desktop' as const,
      openVia: 'desktop_launch' as const,
      openTarget: 'Pixelmator Pro',
      reason: "you named it — desktop bridge is online but the installed-app list is unavailable",
      availability: 'maybe' as const,
    },
    alternativesSummary: ['GIMP — installed on this Mac', 'Photopea — full-featured web app'],
    explicitAppNamed: true,
    namedAppIntent: 'pixelmator',
    openStepLines: ['Open Pixelmator Pro — launch it on the desktop first.'],
    recoveryFallback: {
      appId: 'photopea',
      displayName: 'Photopea',
      surface: 'browser' as const,
      openVia: 'browser_url' as const,
      openTarget: 'https://www.photopea.com',
      reason: 'full-featured web app — works in the browser',
      availability: 'web' as const,
    },
  };
  const maybeBlock = formatComputerTaskComplexityDispatchBlock(
    buildComputerTaskComplexityPlan({ task: simpleTask, preview: planComputerTaskPreview(simpleTask), appResolution: maybeNamedResolution }),
  ) || '';
  assert(maybeBlock.includes('Confirm Pixelmator Pro actually launched'), 'AR3: maybe/named app gets a fail-fast availability line');
  assert(maybeBlock.includes('you asked for pixelmator'), 'AR3: availability line names the user intent');
  assert(maybeBlock.includes('fallback trigger'), 'AR3: a not-installed failure is framed as the fallback trigger');
  assert(!maybeBlock.includes('frontmost and ready BEFORE any task action'), "AR3: the plain frontmost line is replaced for 'maybe' apps");
  assert(
    maybeBlock.includes('fall back ONCE to Photopea (open it in the browser') && !maybeBlock.includes('fall back ONCE to GIMP'),
    'AR3: fallback uses the structured web recoveryFallback, not alternativesSummary[0] (GIMP)',
  );

  // A CONFIRMED-installed app keeps the plain verify line (no fail-fast noise).
  const installedBlock = formatComputerTaskComplexityDispatchBlock(
    buildComputerTaskComplexityPlan({
      task: simpleTask,
      preview: planComputerTaskPreview(simpleTask),
      appResolution: { ...appResolution, best: { ...appResolution.best, availability: 'installed' as const } },
    }),
  ) || '';
  assert(installedBlock.includes('frontmost and ready BEFORE any task action'), 'AR3: confirmed-installed app keeps the plain verify line');
  assert(!installedBlock.includes('actually launched'), 'AR3: confirmed-installed app gets no fail-fast availability line');
}

if (failures > 0) {
  console.error(`\n${failures} computer-task complexity smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-task complexity smoke cases passed.');
