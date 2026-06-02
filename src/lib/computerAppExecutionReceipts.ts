import {
  buildComputerAppTaskStrategy,
  type ComputerAppTaskStrategy,
} from './computerAppTaskStrategy';
import type { UserTaskPipelineDecision } from './userTaskPipelines';

export type ComputerAppExecutionPhase =
  | 'observe'
  | 'act'
  | 'verify'
  | 'approval'
  | 'recover'
  | 'stop';

export type ComputerAppExecutionSurface =
  | 'browser'
  | 'desktop'
  | 'vault'
  | 'terminal'
  | 'file'
  | 'code'
  | 'approval'
  | 'system';

export type ComputerAppReceiptSeverity = 'info' | 'warning' | 'blocker';

export interface ComputerAppExecutionReceiptTemplate {
  id: string;
  phase: ComputerAppExecutionPhase;
  surface: ComputerAppExecutionSurface;
  instruction: string;
  required: boolean;
}

export interface ComputerAppExecutionReceiptPlan {
  strategy: ComputerAppTaskStrategy;
  templates: ComputerAppExecutionReceiptTemplate[];
  requiredFields: string[];
  persistenceTargets: string[];
  loopSafetyRules: string[];
}

export interface ComputerAppExecutionReceipt {
  id: string;
  phase: ComputerAppExecutionPhase;
  surface: ComputerAppExecutionSurface;
  tool?: string | null;
  action: string;
  beforeObservation?: string | null;
  result?: string | null;
  afterObservation?: string | null;
  verification?: string | null;
  status: 'pending' | 'success' | 'failed' | 'blocked' | 'skipped';
  approvalRequired?: boolean;
  stopReason?: string | null;
  timestamp?: string | null;
}

export interface ComputerAppReceiptAuditFinding {
  severity: ComputerAppReceiptSeverity;
  label: string;
  detail: string;
  fix: string;
}

export interface ComputerAppReceiptAudit {
  ok: boolean;
  findings: ComputerAppReceiptAuditFinding[];
  summary: string;
}

function inferSurface(instruction: string): ComputerAppExecutionSurface {
  const text = instruction.toLowerCase();
  if (text.includes('browser') || text.includes('dom') || text.includes('stagehand') || text.includes('url')) return 'browser';
  if (text.includes('desktop') || text.includes('window') || text.includes('screenshot') || text.includes('a11y') || text.includes('mouse') || text.includes('keyboard')) return 'desktop';
  if (text.includes('vault') || text.includes('credential') || text.includes('secret')) return 'vault';
  if (text.includes('terminal') || text.includes('cli') || text.includes('shell')) return 'terminal';
  if (text.includes('file') || text.includes('folder') || text.includes('document') || text.includes('ocr')) return 'file';
  if (text.includes('code') || text.includes('test') || text.includes('deploy') || text.includes('rollback')) return 'code';
  if (text.includes('approval') || text.includes('approve')) return 'approval';
  return 'system';
}

function buildTemplates(
  phase: ComputerAppExecutionPhase,
  instructions: string[],
  required: boolean,
): ComputerAppExecutionReceiptTemplate[] {
  return instructions.map((instruction, index) => ({
    id: `${phase}-${index + 1}`,
    phase,
    surface: inferSurface(instruction),
    instruction,
    required,
  }));
}

export function buildComputerAppExecutionReceiptPlan(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): ComputerAppExecutionReceiptPlan | null {
  const strategy = buildComputerAppTaskStrategy(message, pipelineDecision);
  if (!strategy) return null;

  const templates = [
    ...buildTemplates('observe', strategy.observeFirst, true),
    ...buildTemplates('act', strategy.actionOrder, true),
    ...buildTemplates('verify', strategy.verificationOrder, true),
    ...buildTemplates('approval', strategy.approvalCheckpoints, false),
    ...buildTemplates('recover', strategy.recoveryPolicy, false),
    ...buildTemplates('stop', strategy.stopConditions, true),
  ];

  return {
    strategy,
    templates,
    requiredFields: [
      'phase',
      'surface',
      'tool or action',
      'beforeObservation for actions',
      'result',
      'afterObservation for actions',
      'verification for completed actions',
      'status',
      'stopReason when blocked/failed/stopped',
    ],
    persistenceTargets: ['agent_run_step', 'chat_message', 'office_run_ledger', 'computer_trace_artifact'],
    loopSafetyRules: [
      `Blind action budget is ${strategy.maxBlindActions}. Do not click/type/drag without an observation when budget is 0.`,
      'After each action, capture an afterObservation before taking another action.',
      'If the same action fails twice, stop and switch to recovery instead of retrying.',
      'If focus/app/page state is ambiguous, observe again before acting.',
      'If approval or human verification is required, stop and wait for the user.',
    ],
  };
}

function isBlindAction(receipt: ComputerAppExecutionReceipt): boolean {
  if (receipt.phase !== 'act') return false;
  const action = `${receipt.tool || ''} ${receipt.action}`.toLowerCase();
  const mutates = /\b(click|type|fill|press|drag|scroll|submit|send|publish|pay|checkout|delete|archive|rollback|deploy|restart)\b/.test(action);
  return mutates && !String(receipt.beforeObservation || '').trim();
}

function actionKey(receipt: ComputerAppExecutionReceipt): string {
  return `${receipt.surface}:${receipt.tool || ''}:${receipt.action}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
}

export function auditComputerAppExecutionReceipts(
  receipts: ComputerAppExecutionReceipt[],
  strategy?: ComputerAppTaskStrategy | null,
): ComputerAppReceiptAudit {
  const findings: ComputerAppReceiptAuditFinding[] = [];
  const maxBlindActions = strategy?.maxBlindActions ?? 0;
  const blindActions = receipts.filter(isBlindAction);
  if (blindActions.length > maxBlindActions) {
    findings.push({
      severity: 'blocker',
      label: 'Blind action budget exceeded',
      detail: `${blindActions.length} action receipt(s) mutated UI without a beforeObservation; strategy allows ${maxBlindActions}.`,
      fix: 'Observe DOM/a11y/screenshot/window state before clicking, typing, dragging, submitting, or deploying.',
    });
  }

  for (const receipt of receipts) {
    if (receipt.phase === 'act' && receipt.status === 'success' && !String(receipt.afterObservation || '').trim()) {
      findings.push({
        severity: 'warning',
        label: 'Successful action missing afterObservation',
        detail: `${receipt.id} completed without recording the post-action state.`,
        fix: 'Capture DOM/a11y/screenshot/window/log state after every successful action.',
      });
    }
    if ((receipt.status === 'failed' || receipt.status === 'blocked') && !String(receipt.stopReason || '').trim()) {
      findings.push({
        severity: 'warning',
        label: 'Failure missing stop reason',
        detail: `${receipt.id} is ${receipt.status} but has no stopReason.`,
        fix: 'Record the blocker and exact next fix action before returning to chat.',
      });
    }
  }

  const consecutiveFailures = new Map<string, number>();
  for (const receipt of receipts) {
    const key = actionKey(receipt);
    const failed = receipt.phase === 'act' && receipt.status === 'failed';
    consecutiveFailures.set(key, failed ? (consecutiveFailures.get(key) || 0) + 1 : 0);
    if ((consecutiveFailures.get(key) || 0) >= 2) {
      findings.push({
        severity: 'blocker',
        label: 'Repeated action failure',
        detail: `${receipt.action} failed at least twice for the same surface/tool.`,
        fix: 'Stop retrying, re-observe state, and use the strategy recovery policy.',
      });
      break;
    }
  }

  const blockers = findings.filter((finding) => finding.severity === 'blocker');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  return {
    ok: blockers.length === 0,
    findings,
    summary: blockers.length > 0
      ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'} in execution receipts.`
      : warnings.length > 0
        ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} in execution receipts.`
        : 'Execution receipts look safe and complete.',
  };
}

export function buildComputerAppExecutionReceiptPromptBlock(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): string | null {
  const plan = buildComputerAppExecutionReceiptPlan(message, pipelineDecision);
  if (!plan) return null;
  const required = plan.templates.filter((template) => template.required).slice(0, 10);
  const optional = plan.templates.filter((template) => !template.required).slice(0, 8);
  const lines = [
    '## Computer/App Execution Receipts',
    `Receipt strategy: ${plan.strategy.label} (${plan.strategy.id})`,
    `Required receipt fields: ${plan.requiredFields.join(', ')}`,
    `Persistence targets: ${plan.persistenceTargets.join(', ')}`,
    `Approval checkpoints: ${plan.strategy.approvalCheckpoints.length ? plan.strategy.approvalCheckpoints.join(' | ') : 'none for read-only work'}`,
    `Recovery policy: ${plan.strategy.recoveryPolicy.join(' | ')}`,
    'Required receipts:',
    ...required.map((template) => `- ${template.id} [${template.surface}]: ${template.instruction}`),
  ];
  if (optional.length > 0) {
    lines.push('Conditional receipts:');
    for (const template of optional) lines.push(`- ${template.id} [${template.surface}]: ${template.instruction}`);
  }
  lines.push('Loop safety:');
  for (const rule of plan.loopSafetyRules) lines.push(`- ${rule}`);
  lines.push('Do not claim completion without at least one verification receipt or an explicit blocked stop receipt.');
  return lines.join('\n');
}
