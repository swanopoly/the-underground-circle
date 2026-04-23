import { storage } from './storage';

export type ComputerTaskPhase =
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'blocked';

export type ComputerTaskStepStatus = 'pending' | 'active' | 'completed' | 'blocked';

export interface ComputerTaskStateStep {
  id: string;
  label: string;
  status: ComputerTaskStepStatus;
}

export interface ComputerTaskStateRecord {
  id: string;
  circleId: string;
  threadId: string | null;
  task: string;
  taskKind: string;
  taskLabel: string;
  adapterId?: string | null;
  phase: ComputerTaskPhase;
  currentStep: string | null;
  steps: ComputerTaskStateStep[];
  blockers: string[];
  nextSteps: string[];
  grantedAccess: string[];
  accessPlan: string | null;
  runId?: string | null;
  sessionId?: string | null;
  liveUrl?: string | null;
  updatedAt: string;
}

const STORAGE_PREFIX = 'computer_task_state_v1';

function storageKey(circleId: string, threadId?: string | null): string {
  return `${STORAGE_PREFIX}_${circleId}_${threadId || 'main'}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRecord(raw: string | null): ComputerTaskStateRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      id: String(parsed.id || ''),
      circleId: String(parsed.circleId || ''),
      threadId: parsed.threadId ? String(parsed.threadId) : null,
      task: String(parsed.task || ''),
      taskKind: String(parsed.taskKind || 'unknown'),
      taskLabel: String(parsed.taskLabel || 'Computer task'),
      adapterId: parsed.adapterId ? String(parsed.adapterId) : null,
      phase: (parsed.phase || 'planning') as ComputerTaskPhase,
      currentStep: parsed.currentStep ? String(parsed.currentStep) : null,
      steps: Array.isArray(parsed.steps)
        ? parsed.steps.map((step: any) => ({
            id: String(step?.id || ''),
            label: String(step?.label || ''),
            status: (step?.status || 'pending') as ComputerTaskStepStatus,
          })).filter((step: ComputerTaskStateStep) => step.id && step.label)
        : [],
      blockers: Array.isArray(parsed.blockers) ? parsed.blockers.map(String).filter(Boolean) : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String).filter(Boolean) : [],
      grantedAccess: Array.isArray(parsed.grantedAccess) ? parsed.grantedAccess.map(String).filter(Boolean) : [],
      accessPlan: parsed.accessPlan ? String(parsed.accessPlan) : null,
      runId: parsed.runId ? String(parsed.runId) : null,
      sessionId: parsed.sessionId ? String(parsed.sessionId) : null,
      liveUrl: parsed.liveUrl ? String(parsed.liveUrl) : null,
      updatedAt: String(parsed.updatedAt || nowIso()),
    };
  } catch {
    return null;
  }
}

export async function loadComputerTaskState(circleId: string, threadId?: string | null): Promise<ComputerTaskStateRecord | null> {
  return normalizeRecord(await storage.getItem(storageKey(circleId, threadId)));
}

export async function saveComputerTaskState(record: ComputerTaskStateRecord): Promise<void> {
  await storage.setItem(storageKey(record.circleId, record.threadId), JSON.stringify({
    ...record,
    updatedAt: record.updatedAt || nowIso(),
  }));
}

export async function clearComputerTaskState(circleId: string, threadId?: string | null): Promise<void> {
  await storage.removeItem(storageKey(circleId, threadId));
}

export function buildComputerTaskStateSteps(args: {
  taskKind: string;
  phase: ComputerTaskPhase;
}): ComputerTaskStateStep[] {
  const plan = { id: 'plan', label: 'Plan task', status: 'completed' as ComputerTaskStepStatus };
  if (args.phase === 'planning') {
    plan.status = 'active';
  }

  const needsApproval = args.taskKind === 'browser_task';
  const approval = needsApproval
    ? {
        id: 'approval',
        label: 'Approve access',
        status: args.phase === 'awaiting_approval'
          ? 'active' as ComputerTaskStepStatus
          : args.phase === 'executing' || args.phase === 'completed'
            ? 'completed' as ComputerTaskStepStatus
            : 'pending' as ComputerTaskStepStatus,
      }
    : null;

  const execute: ComputerTaskStateStep = {
    id: 'execute',
    label: args.taskKind === 'hybrid_task' ? 'Run staged computer workflow' : 'Execute task',
    status: args.phase === 'executing'
      ? 'active'
      : args.phase === 'completed'
        ? 'completed'
        : args.phase === 'failed' || args.phase === 'blocked'
          ? 'blocked'
          : 'pending',
  };

  const summarize: ComputerTaskStateStep = {
    id: 'summarize',
    label: 'Summarize result',
    status: args.phase === 'completed'
      ? 'completed'
      : args.phase === 'failed' || args.phase === 'blocked'
        ? 'blocked'
        : 'pending',
  };

  return [plan, ...(approval ? [approval] : []), execute, summarize];
}
