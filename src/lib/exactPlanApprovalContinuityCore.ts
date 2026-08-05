/**
 * One-shot ordering gate for exact Chat plan approvals.
 *
 * Realtime resolution can arrive before the filing call returns and registers
 * the in-memory resume owner. This dependency-free gate retains that early
 * decision, hands it to registration exactly once, and rejects duplicate or
 * conflicting callbacks. It carries no task text or approval payload.
 */

export type ExactPlanApprovalResolution = 'approved' | 'rejected';

export type ExactPlanApprovalRegisterResult =
  | { kind: 'pending' }
  | { kind: 'resolved'; status: ExactPlanApprovalResolution }
  | { kind: 'duplicate' };

export type ExactPlanApprovalResolveResult =
  | { kind: 'queued_before_registration' }
  | { kind: 'ready'; status: ExactPlanApprovalResolution }
  | { kind: 'duplicate' };

export interface ExactPlanApprovalContinuityGate {
  register(approvalId: string): ExactPlanApprovalRegisterResult;
  resolve(approvalId: string, status: ExactPlanApprovalResolution): ExactPlanApprovalResolveResult;
  forget(approvalId: string): void;
  clear(): void;
}

function safeApprovalId(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

export function createExactPlanApprovalContinuityGate(): ExactPlanApprovalContinuityGate {
  const registered = new Set<string>();
  const earlyResolutions = new Map<string, ExactPlanApprovalResolution>();
  const claimed = new Set<string>();

  return {
    register(rawApprovalId) {
      const approvalId = safeApprovalId(rawApprovalId);
      if (!approvalId || claimed.has(approvalId)) return { kind: 'duplicate' };
      registered.add(approvalId);
      const early = earlyResolutions.get(approvalId);
      if (!early) return { kind: 'pending' };
      earlyResolutions.delete(approvalId);
      claimed.add(approvalId);
      return { kind: 'resolved', status: early };
    },

    resolve(rawApprovalId, status) {
      const approvalId = safeApprovalId(rawApprovalId);
      if (!approvalId || claimed.has(approvalId) || earlyResolutions.has(approvalId)) {
        return { kind: 'duplicate' };
      }
      if (!registered.has(approvalId)) {
        earlyResolutions.set(approvalId, status);
        return { kind: 'queued_before_registration' };
      }
      claimed.add(approvalId);
      return { kind: 'ready', status };
    },

    forget(rawApprovalId) {
      const approvalId = safeApprovalId(rawApprovalId);
      if (!approvalId) return;
      registered.delete(approvalId);
      earlyResolutions.delete(approvalId);
      claimed.delete(approvalId);
    },

    clear() {
      registered.clear();
      earlyResolutions.clear();
      claimed.clear();
    },
  };
}
