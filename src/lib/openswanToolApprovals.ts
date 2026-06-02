export type OpenSwanRuntimeApprovalStatus =
  | 'pending'
  | 'approved'
  | 'auto_approved'
  | 'rejected'
  | 'expired'
  | string;

export type OpenSwanRuntimeApprovalRow = {
  id?: string | null;
  status?: OpenSwanRuntimeApprovalStatus | null;
  payload?: Record<string, unknown> | null;
};

export type OpenSwanRuntimeApprovalDecision =
  | { kind: 'pass'; approvalId: string; message: string }
  | { kind: 'defer'; approvalId: string; message: string }
  | { kind: 'block'; approvalId: string; message: string }
  | { kind: 'new' };

function stableValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return String(value);
}

export function stableApprovalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function buildOpenSwanToolApprovalKey(tool: string, args: Record<string, unknown> | null | undefined): string {
  return stableApprovalJson({
    version: 1,
    tool: String(tool || ''),
    args: args || {},
  });
}

function payloadMatchesToolCall(payload: Record<string, unknown> | null | undefined, tool: string, args: Record<string, unknown>): 'exact' | 'legacy_pending_only' | 'none' {
  if (!payload || typeof payload !== 'object') return 'legacy_pending_only';
  const key = buildOpenSwanToolApprovalKey(tool, args);
  const payloadKey = typeof payload.toolApprovalKey === 'string'
    ? payload.toolApprovalKey
    : typeof payload.approvalKey === 'string'
      ? payload.approvalKey
      : '';
  if (payloadKey) return payloadKey === key ? 'exact' : 'none';
  if (payload.tool === tool && payload.args && typeof payload.args === 'object') {
    return buildOpenSwanToolApprovalKey(tool, payload.args as Record<string, unknown>) === key ? 'exact' : 'none';
  }
  return 'legacy_pending_only';
}

export function resolveOpenSwanRuntimeApprovalDecision(input: {
  tool: string;
  args: Record<string, unknown>;
  rows: OpenSwanRuntimeApprovalRow[];
}): OpenSwanRuntimeApprovalDecision {
  for (const row of input.rows) {
    const status = String(row.status || '').toLowerCase();
    const match = payloadMatchesToolCall(row.payload, input.tool, input.args);
    if (match === 'none') continue;
    const approvalId = String(row.id || '');

    if (match === 'legacy_pending_only') {
      if (status === 'pending') {
        return {
          kind: 'defer',
          approvalId,
          message: `Approval already pending for ${input.tool}${approvalId ? ` (id: ${approvalId.slice(0, 8)})` : ''}.`,
        };
      }
      continue;
    }

    if (status === 'approved' || status === 'auto_approved') {
      return {
        kind: 'pass',
        approvalId,
        message: `Approval already granted for ${input.tool}${approvalId ? ` (id: ${approvalId.slice(0, 8)})` : ''}.`,
      };
    }
    if (status === 'pending') {
      return {
        kind: 'defer',
        approvalId,
        message: `Approval already pending for ${input.tool}${approvalId ? ` (id: ${approvalId.slice(0, 8)})` : ''}.`,
      };
    }
    if (status === 'rejected') {
      return {
        kind: 'block',
        approvalId,
        message: `Approval for ${input.tool}${approvalId ? ` (id: ${approvalId.slice(0, 8)})` : ''} was rejected. Change the request before trying again.`,
      };
    }
  }

  return { kind: 'new' };
}
