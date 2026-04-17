import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';

export type OpenSwanExecutionStatus =
  | 'planned'
  | 'running'
  | 'passed'
  | 'failed'
  | 'manual_required'
  | 'blocked';

export type OpenSwanExecutionMode = 'automatic' | 'manual' | 'blocked' | 'informational';

export type OpenSwanExecutionContract = {
  status: OpenSwanExecutionStatus;
  mode: OpenSwanExecutionMode;
  summary: string;
  toolName?: string;
  checkId?: string;
  checkLabel?: string;
  command?: string;
  executed?: boolean;
  error?: string | null;
};

export function sortOpenSwanExecutionContracts(contracts: OpenSwanExecutionContract[]): OpenSwanExecutionContract[] {
  const rank: Record<OpenSwanExecutionStatus, number> = {
    running: 0,
    failed: 1,
    blocked: 2,
    manual_required: 3,
    passed: 4,
    planned: 5,
  };
  return [...contracts].sort((a, b) => {
    const aRank = rank[a.status] ?? 99;
    const bRank = rank[b.status] ?? 99;
    if (aRank !== bRank) return aRank - bRank;
    return String(a.checkLabel || a.toolName || a.summary).localeCompare(String(b.checkLabel || b.toolName || b.summary));
  });
}

export function buildOpenSwanExecutionStream(params: {
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
}): OpenSwanExecutionContract[] {
  const toolContracts: OpenSwanExecutionContract[] = (params.toolEvents || []).map((event) => ({
    status: event.status,
    mode: event.status === 'planned' ? 'informational' : event.status === 'blocked' ? 'blocked' : 'automatic',
    summary: event.summary,
    toolName: event.tool,
    command: event.command,
    executed: event.status === 'passed' || event.status === 'failed',
    error: event.status === 'failed' || event.status === 'blocked' ? event.summary : null,
  }));
  const verificationContracts = (params.verificationResults || []).map((result) => result.execution);
  return sortOpenSwanExecutionContracts([...toolContracts, ...verificationContracts]);
}

export function getOpenSwanExecutionStatusLabel(status: OpenSwanExecutionStatus): string {
  switch (status) {
    case 'passed':
      return 'PASS';
    case 'failed':
      return 'FAIL';
    case 'running':
      return 'RUN';
    case 'manual_required':
      return 'MANUAL';
    case 'blocked':
      return 'BLOCK';
    case 'planned':
    default:
      return 'PLAN';
  }
}

export function getOpenSwanExecutionStatusColor(status: OpenSwanExecutionStatus): string {
  switch (status) {
    case 'passed':
      return '#22c55e';
    case 'failed':
      return '#ef4444';
    case 'running':
      return '#f59e0b';
    case 'manual_required':
      return '#38bdf8';
    case 'blocked':
      return '#a78bfa';
    case 'planned':
    default:
      return '#94a3b8';
  }
}
