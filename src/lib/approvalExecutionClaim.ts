export const EXECUTABLE_AGENT_APPROVAL_STATUSES = [
  'approved',
  'auto_approved',
] as const;

export type ApprovalExecutionClaimResult =
  | { ok: true; claimed: true }
  | { ok: true; claimed: false }
  | { ok: false; error: string };

export type ApprovalExecutionClaimWrite = (input: {
  approvalId: string;
  expectedActionType: string;
  claimedAt: string;
  executableStatuses: typeof EXECUTABLE_AGENT_APPROVAL_STATUSES;
}) => Promise<{
  data: Array<{ id?: unknown }> | null;
  error: { message?: string } | null;
}>;

async function writeApprovalExecutionClaim(input: {
  approvalId: string;
  expectedActionType: string;
  claimedAt: string;
  executableStatuses: typeof EXECUTABLE_AGENT_APPROVAL_STATUSES;
}): ReturnType<ApprovalExecutionClaimWrite> {
  // Keep the module smoke-testable without loading the React Native Supabase
  // dependency. Production calls reach the shared singleton lazily; tests pass
  // an atomic in-memory writer through the explicit seam below.
  const { supabase } = await import('./supabase');
  const { data, error } = await supabase
    .from('agent_approvals')
    .update({ applied_at: input.claimedAt })
    .eq('id', input.approvalId)
    .eq('action_type', input.expectedActionType)
    .in('status', [...input.executableStatuses])
    .is('applied_at', null)
    .select('id');

  return { data, error };
}

/**
 * Consume one approved action immediately before its first side effect.
 *
 * Callers must finish validation and read-only preflight first. The guarded
 * UPDATE binds the same row, exact handler family, still-executable status, and
 * `applied_at IS NULL`; exactly one contender can therefore enter dispatch.
 * A winning claim remains terminal after dispatch begins because replaying an
 * ambiguous transport or database outcome could duplicate the mutation.
 */
export async function claimApprovalExecution(
  approvalId: string,
  expectedActionType: string,
  write: ApprovalExecutionClaimWrite = writeApprovalExecutionClaim,
): Promise<ApprovalExecutionClaimResult> {
  const normalizedId = String(approvalId || '').trim();
  const normalizedActionType = String(expectedActionType || '').trim();
  if (!normalizedId || !normalizedActionType) {
    return { ok: false, error: 'Could not claim an approval with missing execution identity.' };
  }

  let result: Awaited<ReturnType<ApprovalExecutionClaimWrite>>;
  try {
    result = await write({
      approvalId: normalizedId,
      expectedActionType: normalizedActionType,
      claimedAt: new Date().toISOString(),
      executableStatuses: EXECUTABLE_AGENT_APPROVAL_STATUSES,
    });
  } catch {
    return { ok: false, error: 'Could not claim the approval for execution.' };
  }

  if (result.error) {
    return { ok: false, error: 'Could not claim the approval for execution.' };
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    return { ok: true, claimed: false };
  }
  if (
    result.data.length !== 1
    || String(result.data[0]?.id || '').trim() !== normalizedId
  ) {
    return { ok: false, error: 'Approval execution claim returned an invalid row set.' };
  }
  return { ok: true, claimed: true };
}
