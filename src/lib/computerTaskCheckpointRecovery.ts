import type { ComputerTaskCheckpoint, ComputerTaskComplexityPlan } from './computerTaskComplexityPlan';
import type { ComputerTaskStateComplexity } from './computerTaskStateModel';

export type ComputerTaskCheckpointRecoveryConfidence = 'high' | 'medium' | 'low';

export interface ComputerTaskCheckpointEvidenceRequirement {
  id: string;
  tool: string;
  summary: string;
  freshnessMs: number;
  required: boolean;
}

export interface ComputerTaskCheckpointRetryPolicy {
  failureFingerprint: string;
  repeatCount: number;
  retryLimit: number;
  canRetry: boolean;
  nextAction: string;
  stopReason: string | null;
  requiredEvidence: ComputerTaskCheckpointEvidenceRequirement[];
  forbiddenActions: string[];
  resumeInstruction: string;
}

export interface ComputerTaskCheckpointRecoveryContext {
  level: string;
  complexityScore: number;
  failedCheckpointId: string;
  failedCheckpointLabel: string;
  surface: string;
  requiresApproval: boolean;
  confidence: ComputerTaskCheckpointRecoveryConfidence;
  reason: string;
  safeNextStep: string;
  remainingCheckpointIds: string[];
  retryPolicy: ComputerTaskCheckpointRetryPolicy;
}

export interface ComputerTaskCheckpointFailureInput {
  task?: string | null;
  failureMessage?: string | null;
  outcomeStatus?: string | null;
  executionKind?: string | null;
  source?: string | null;
  planSummary?: string | null;
  groundingSummary?: string | null;
  preflightSummary?: string | null;
  complexityPlan?: ComputerTaskComplexityPlan | null;
  stateComplexity?: ComputerTaskStateComplexity | null;
}

interface CheckpointCandidate {
  id: string;
  label: string;
  surface: string;
  requiresApproval: boolean;
}

interface CheckpointRule {
  patterns: RegExp[];
  reason: string;
  safeNextStep: string;
}

const RULES: Record<string, CheckpointRule> = {
  'scope-readiness': {
    patterns: [/\b(preflight|readiness|grant|permission|capability|not ready|missing access|missing tool|missing bridge)\b/i],
    reason: 'The task failed before the runtime had enough access, capability, or readiness to continue.',
    safeNextStep: 'Stop and resolve the missing grant, capability, or readiness blocker before retrying the task.',
  },
  'resolve-files': {
    patterns: [/\b(file|folder|path|upload|download|export|save|asset|manifest|hash|not found|ambiguous|outside grant|overwrite)\b/i],
    reason: 'The failure is tied to local file identity, path resolution, upload/download, save, or export handling.',
    safeNextStep: 'Resolve the exact path and file identity inside the granted roots, then retry only the file-scoped step.',
  },
  'observe-browser': {
    patterns: [/\b(browser|dom|selector|element|aria|url|origin|tab|page|login|captcha|mfa|human verification|navigation)\b/i],
    reason: 'The browser state or target element was not safely observed before action.',
    safeNextStep: 'Re-observe the URL, DOM/role state, login state, and target element before any click, fill, upload, or submit.',
  },
  'observe-desktop': {
    patterns: [/\b((desktop(?!\s+folder))|window|app|application|focus|a11y|accessibility|screenshot|screen recording|photoshop|indesign|autocad|illustrator|revit|solidworks|finder)\b/i],
    reason: 'The desktop/app state, focus, accessibility tree, or screenshot evidence was not reliable enough.',
    safeNextStep: 'Refresh app/window focus, accessibility, and screenshot state before any keyboard, mouse, menu, or document action.',
  },
  'execute-in-small-steps': {
    patterns: [/\b(action failed|click failed|type failed|mutation|same action|failed twice|retry|loop|stale|uncertain target|changed unexpectedly)\b/i],
    reason: 'A mutation or action step failed and should not be repeated blindly.',
    safeNextStep: 'Retry one reversible action only after fresh observation, and stop if the same action fails again.',
  },
  'approval-before-side-effect': {
    patterns: [/\b(approval|approve|publish|submit|send|delete|remove|overwrite|pay|buy|order|book|deploy|final side effect|not approved)\b/i],
    reason: 'The task reached a side-effect boundary that needs explicit approval or safer staging.',
    safeNextStep: 'Pause and request approval for the exact final side effect, target, data, and expected result.',
  },
  'final-proof': {
    patterns: [/\b(verify|proof|receipt|evidence|summary|screenshot|exported|saved|not confirmed|could not confirm|final state)\b/i],
    reason: 'The runtime could not prove the final state or produce the requested evidence.',
    safeNextStep: 'Capture proof through the same browser, desktop, app, or file surface, or return the exact blocker.',
  },
  'bounded-recovery': {
    patterns: [/\b(recovery|recover|handoff|connected agent|buildout|fallback|same failure|fingerprint)\b/i],
    reason: 'The failure is already in recovery and needs a bounded next step instead of another open-ended retry.',
    safeNextStep: 'Name the failed checkpoint, preserve the blocker, and run only the smallest recovery step with explicit stop conditions.',
  },
};

function clean(value: unknown, max = 2_000): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function unique(values: string[], max = 10): string[] {
  return Array.from(new Set(values.map((value) => clean(value, 120)).filter(Boolean))).slice(0, max);
}

function hashText(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function normalizeFingerprintText(value: string): string {
  return clean(value, 1_200)
    .toLowerCase()
    .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
    .replace(/\b\d{2,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidatesFromInput(input: ComputerTaskCheckpointFailureInput): CheckpointCandidate[] {
  if (input.complexityPlan?.checkpoints?.length) {
    return input.complexityPlan.checkpoints.map((checkpoint: ComputerTaskCheckpoint) => ({
      id: checkpoint.id,
      label: checkpoint.label,
      surface: checkpoint.surface,
      requiresApproval: checkpoint.requiresApproval,
    }));
  }
  if (input.stateComplexity?.checkpoints?.length) {
    return input.stateComplexity.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      label: checkpoint.label,
      surface: String(checkpoint.surface || 'verification'),
      requiresApproval: checkpoint.requiresApproval,
    }));
  }
  return [];
}

function textFromInput(input: ComputerTaskCheckpointFailureInput): string {
  return [
    input.task,
    input.failureMessage,
    input.outcomeStatus,
    input.executionKind,
    input.source,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
  ].map((value) => clean(value, 1_500).toLowerCase()).join('\n');
}

function criticalTextFromInput(input: ComputerTaskCheckpointFailureInput): string {
  return [
    input.failureMessage,
    input.outcomeStatus,
    input.executionKind,
    input.source,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
  ].map((value) => clean(value, 1_500).toLowerCase()).join('\n');
}

function scoreCandidate(candidate: CheckpointCandidate, text: string, criticalText: string): { score: number; reason: string; safeNextStep: string } {
  let score = 0;
  const labelWords = candidate.label.toLowerCase().split(/\W+/).filter((word) => word.length > 3);
  if (criticalText.includes(candidate.id.toLowerCase())) score += 6;
  else if (text.includes(candidate.id.toLowerCase())) score += 2;
  if (labelWords.some((word) => criticalText.includes(word))) score += 3;
  else if (labelWords.some((word) => text.includes(word))) score += 1;
  if (candidate.surface && criticalText.includes(candidate.surface.toLowerCase())) score += 2;
  if (candidate.requiresApproval && /\b(approval|approve|side effect|publish|submit|send|delete|overwrite)\b/i.test(criticalText)) score += 3;

  const rule = RULES[candidate.id];
  if (rule) {
    for (const pattern of rule.patterns) {
      if (pattern.test(criticalText)) score += 6;
      else if (pattern.test(text)) score += 1;
    }
    return { score, reason: rule.reason, safeNextStep: rule.safeNextStep };
  }
  return {
    score,
    reason: 'The failure maps to this checkpoint from the task plan.',
    safeNextStep: 'Re-observe the owning surface, retry only the failed checkpoint, and stop on repeat failure.',
  };
}

function confidenceForScore(score: number): ComputerTaskCheckpointRecoveryConfidence {
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function retryLimitForCheckpoint(candidate: CheckpointCandidate): number {
  if (candidate.id === 'approval-before-side-effect') return 0;
  return 1;
}

function evidenceForCheckpoint(candidate: CheckpointCandidate): ComputerTaskCheckpointEvidenceRequirement[] {
  const required = (id: string, tool: string, summary: string, freshnessMs = 15_000): ComputerTaskCheckpointEvidenceRequirement => ({
    id,
    tool,
    summary,
    freshnessMs,
    required: true,
  });
  const optional = (id: string, tool: string, summary: string, freshnessMs = 30_000): ComputerTaskCheckpointEvidenceRequirement => ({
    id,
    tool,
    summary,
    freshnessMs,
    required: false,
  });

  switch (candidate.id) {
    case 'scope-readiness':
      return [
        required('access-plan', 'computer.access_plan', 'Confirm the required browser, app, file, bridge, vault, and approval scopes.'),
        required('preflight', 'computer.preflight', 'Re-run readiness/preflight and name any missing grant, capability, bridge, or permission.'),
      ];
    case 'resolve-files':
      return [
        required('file-search', 'desktop.file_search', 'Find the exact source/output path inside the granted roots.'),
        required('file-identity', 'desktop.file_stat', 'Confirm filename, size, hash or package manifest identity before upload, edit, save, or export.'),
        optional('grant-scope', 'computer.access_plan', 'Confirm the path remains inside the approved grant scope.'),
      ];
    case 'observe-browser':
      return [
        required('browser-verification', 'browser.verification_state', 'Check current URL/origin, login state, MFA, CAPTCHA, and suspicious instructions.'),
        required('browser-dom', 'browser.dom_snapshot', 'Ground the next click, fill, upload, or submit in DOM/ARIA role state.'),
        optional('browser-screenshot', 'browser.screenshot', 'Capture screenshot proof when DOM state is incomplete or visual layout matters.'),
      ];
    case 'observe-desktop':
      return [
        required('desktop-window', 'desktop.window_state', 'Confirm the focused app, active window, and target document.'),
        required('desktop-a11y', 'desktop.read_a11y_tree', 'Ground keyboard, menu, control, and text-field actions in accessibility state.'),
        required('desktop-screenshot', 'desktop.screenshot', 'Capture visual proof before mouse, coordinate, canvas, CAD, or document actions.', 5_000),
      ];
    case 'execute-in-small-steps':
      return [
        required('fresh-owner-state', candidate.surface === 'browser' ? 'browser.dom_snapshot' : 'desktop.read_a11y_tree', 'Re-observe the owning surface immediately before retrying the failed reversible action.'),
        required('post-action-proof', candidate.surface === 'browser' ? 'browser.screenshot' : 'desktop.screenshot', 'Verify the result after the one allowed retry before taking another mutating action.'),
      ];
    case 'approval-before-side-effect':
      return [
        required('approval-request', 'approvals.request', 'Ask for approval naming the exact final side effect, target, data, and expected result.', 120_000),
        required('pre-commit-observation', candidate.surface === 'browser' ? 'browser.dom_snapshot' : 'desktop.screenshot', 'Re-observe the target immediately before the approved final action.'),
      ];
    case 'final-proof':
      return [
        required('proof-capture', candidate.surface === 'browser' ? 'browser.screenshot' : candidate.surface === 'local_files' ? 'desktop.file_stat' : 'desktop.screenshot', 'Capture proof through the same surface used for the task.'),
        optional('result-summary', 'computer.result_summary', 'Return the user-visible path, URL, receipt, screenshot, extracted data, or exact blocker.'),
      ];
    case 'bounded-recovery':
      return [
        required('failure-fingerprint', 'computer.failure_fingerprint', 'Preserve the failed checkpoint and same-failure fingerprint before retrying.'),
        required('fresh-route-observation', 'computer.grounding_trace', 'Re-check the owning surface or route and stop if it still cannot be observed.'),
      ];
    default:
      return [
        required('fresh-observation', 'computer.grounding_trace', 'Re-observe the owning surface before retrying the failed checkpoint.'),
      ];
  }
}

function forbiddenActionsForCheckpoint(candidate: CheckpointCandidate): string[] {
  switch (candidate.id) {
    case 'scope-readiness':
      return ['No mutation, browser submit, file write, or desktop control before access and readiness are explicit.'];
    case 'resolve-files':
      return ['No upload, save, export, overwrite, move, or delete until the exact path and grant scope are confirmed.'];
    case 'observe-browser':
      return ['No click, fill, upload, submit, or credential use until URL/origin, DOM/ARIA, and verification state are fresh.'];
    case 'observe-desktop':
      return ['No keyboard, mouse, menu, coordinate, canvas, CAD, or document action until window, a11y, and screenshot evidence are fresh.'];
    case 'execute-in-small-steps':
      return ['Do not repeat the same action more than once; stop if post-action proof is missing or the same failure repeats.'];
    case 'approval-before-side-effect':
      return ['No purchase, booking, send, publish, delete, overwrite, deploy, save, or external side effect without approved approval state.'];
    case 'final-proof':
      return ['Do not mark the task complete without proof from the same surface used to execute it.'];
    default:
      return ['Do not retry open-endedly; run only the smallest checkpoint-specific recovery step.'];
  }
}

function resumeInstructionForCheckpoint(candidate: CheckpointCandidate, safeNextStep: string, canRetry: boolean): string {
  if (!canRetry) {
    return `Stop before retry. ${safeNextStep}`;
  }
  const evidence = evidenceForCheckpoint(candidate).filter((item) => item.required).map((item) => item.tool).join(', ');
  return `Collect fresh evidence (${evidence}), then retry only checkpoint "${candidate.id}" once. Stop on the same failure fingerprint.`;
}

function buildRetryPolicy(input: ComputerTaskCheckpointFailureInput, candidate: CheckpointCandidate, safeNextStep: string): ComputerTaskCheckpointRetryPolicy {
  const retryLimit = retryLimitForCheckpoint(candidate);
  const failureFingerprint = [
    'checkpoint',
    candidate.id,
    hashText(normalizeFingerprintText([
      input.task,
      input.failureMessage,
      input.outcomeStatus,
      input.executionKind,
      input.source,
    ].map((value) => clean(value, 800)).join('|'))),
  ].join(':');
  const requiresApproval = candidate.id === 'approval-before-side-effect';
  const canRetry = !requiresApproval && retryLimit > 0;
  const stopReason = requiresApproval
    ? 'Approval is required before retrying this checkpoint or any final side effect.'
    : null;
  const requiredEvidence = evidenceForCheckpoint(candidate);
  const forbiddenActions = forbiddenActionsForCheckpoint(candidate);
  return {
    failureFingerprint,
    repeatCount: 1,
    retryLimit,
    canRetry,
    nextAction: stopReason || safeNextStep,
    stopReason,
    requiredEvidence,
    forbiddenActions,
    resumeInstruction: resumeInstructionForCheckpoint(candidate, safeNextStep, canRetry),
  };
}

export function diagnoseComputerTaskCheckpointFailure(input: ComputerTaskCheckpointFailureInput): ComputerTaskCheckpointRecoveryContext | null {
  const level = clean(input.complexityPlan?.level || input.stateComplexity?.level || 'simple', 40);
  if (!level || level === 'simple') return null;

  const candidates = candidatesFromInput(input);
  if (candidates.length === 0) return null;

  const text = textFromInput(input);
  const criticalText = criticalTextFromInput(input);
  const scored = candidates.map((candidate) => ({
    candidate,
    ...scoreCandidate(candidate, text, criticalText),
  })).sort((a, b) => b.score - a.score);
  let best = scored[0];

  if (!best || best.score <= 0) {
    const fallback = candidates.find((candidate) => candidate.id === 'scope-readiness') || candidates[0];
    best = {
      candidate: fallback,
      score: 1,
      reason: 'The exact failed checkpoint is unclear, so recovery should restart from the first safe checkpoint.',
      safeNextStep: 'Return to scope/readiness, re-check access and observations, and retry only after the blocker is explicit.',
    };
  }

  const failedIndex = candidates.findIndex((candidate) => candidate.id === best.candidate.id);
  const remainingCheckpointIds = failedIndex >= 0
    ? candidates.slice(failedIndex + 1).map((candidate) => candidate.id)
    : [];

  return {
    level,
    complexityScore: Number(input.complexityPlan?.score ?? input.stateComplexity?.score ?? 0),
    failedCheckpointId: best.candidate.id,
    failedCheckpointLabel: best.candidate.label,
    surface: best.candidate.surface,
    requiresApproval: best.candidate.requiresApproval,
    confidence: confidenceForScore(best.score),
    reason: best.reason,
    safeNextStep: best.safeNextStep,
    remainingCheckpointIds: unique(remainingCheckpointIds, 8),
    retryPolicy: buildRetryPolicy(input, best.candidate, best.safeNextStep),
  };
}

export function formatComputerTaskCheckpointRecoveryForPrompt(context?: ComputerTaskCheckpointRecoveryContext | null): string | null {
  if (!context) return null;
  return [
    'Computer task checkpoint recovery:',
    `- complexity: ${context.level} (score ${context.complexityScore})`,
    `- failed checkpoint: ${context.failedCheckpointId} (${context.failedCheckpointLabel})`,
    `- surface: ${context.surface}`,
    `- confidence: ${context.confidence}`,
    `- reason: ${context.reason}`,
    `- safe next step: ${context.safeNextStep}`,
    context.retryPolicy ? `- retry guard: ${context.retryPolicy.canRetry ? 'allowed once with fresh evidence' : 'blocked'} (${context.retryPolicy.repeatCount}/${context.retryPolicy.retryLimit})` : '',
    context.retryPolicy?.nextAction ? `- retry action: ${context.retryPolicy.nextAction}` : '',
    context.retryPolicy?.resumeInstruction ? `- resume instruction: ${context.retryPolicy.resumeInstruction}` : '',
    context.retryPolicy?.requiredEvidence?.length ? `- required fresh evidence: ${context.retryPolicy.requiredEvidence.filter((item) => item.required).map((item) => `${item.id}:${item.tool}`).join(', ')}` : '',
    context.retryPolicy?.forbiddenActions?.length ? `- forbidden before evidence: ${context.retryPolicy.forbiddenActions.join(' | ')}` : '',
    context.retryPolicy?.stopReason ? `- stop reason: ${context.retryPolicy.stopReason}` : '',
    context.requiresApproval ? '- approval: checkpoint carries side-effect risk; final committing actions still require explicit approval' : '',
    context.remainingCheckpointIds.length ? `- remaining checkpoints: ${context.remainingCheckpointIds.join(', ')}` : '',
  ].filter(Boolean).join('\n');
}
