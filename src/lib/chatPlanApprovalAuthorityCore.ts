/**
 * Dependency-free runtime object capability for one approved Chat plan.
 *
 * The WeakSet brand cannot survive serialization, so copied approval metadata
 * never becomes execution authority. Keeping this owner dependency-free also
 * lets both the Expo app and Supabase Edge functions import the same brand.
 */

export type ChatPlanApprovalAuthorityCore<
  ExecutionKind extends string = string,
  PolicyCategory extends string = string,
> = Readonly<{
  schemaVersion: 2;
  kind: 'chat_plan_approval';
  authorizationSource: 'claimed_approval_row' | 'policy_auto_waiver';
  approvalId: string | null;
  approvalIntentFingerprint: string;
  requestIdentityFingerprint: string;
  programId: string;
  programFingerprint: string;
  circleId: string;
  userId: string;
  threadId: string | null;
  executionKind: ExecutionKind;
  routeId: string | null;
  policyCategory: PolicyCategory | null;
}>;

export type ChatPlanApprovalAuthorityExpectedCore<ExecutionKind extends string = string> = Readonly<{
  circleId: string;
  userId: string;
  threadId?: string | null;
  executionKind: ExecutionKind;
  approvalIntentFingerprint: string;
  requestIdentityFingerprint: string;
  programId: string;
  programFingerprint: string;
}>;

const issuedChatPlanApprovalAuthorities = new WeakSet<object>();

export function issueChatPlanApprovalAuthorityObject<
  ExecutionKind extends string,
  PolicyCategory extends string,
>(
  authority: ChatPlanApprovalAuthorityCore<ExecutionKind, PolicyCategory>,
): ChatPlanApprovalAuthorityCore<ExecutionKind, PolicyCategory> {
  const issued = Object.freeze({ ...authority });
  issuedChatPlanApprovalAuthorities.add(issued);
  return issued;
}

export function isIssuedChatPlanApprovalAuthorityObject<
  ExecutionKind extends string,
  PolicyCategory extends string = string,
>(
  value: unknown,
  expected: ChatPlanApprovalAuthorityExpectedCore<ExecutionKind>,
): value is ChatPlanApprovalAuthorityCore<ExecutionKind, PolicyCategory> {
  if (!value || typeof value !== 'object' || !issuedChatPlanApprovalAuthorities.has(value as object)) {
    return false;
  }
  const authority = value as ChatPlanApprovalAuthorityCore<ExecutionKind, PolicyCategory>;
  return authority.schemaVersion === 2
    && authority.kind === 'chat_plan_approval'
    && authority.circleId === expected.circleId
    && authority.userId === expected.userId
    && authority.threadId === (expected.threadId || null)
    && authority.executionKind === expected.executionKind
    && authority.approvalIntentFingerprint === expected.approvalIntentFingerprint
    && authority.requestIdentityFingerprint === expected.requestIdentityFingerprint
    && authority.programId === expected.programId
    && authority.programFingerprint === expected.programFingerprint
    && (
      (authority.authorizationSource === 'claimed_approval_row'
        && typeof authority.approvalId === 'string'
        && authority.approvalId.length > 0
        && authority.policyCategory === null)
      || (authority.authorizationSource === 'policy_auto_waiver'
        && authority.approvalId === null
        && typeof authority.policyCategory === 'string'
        && authority.policyCategory.length > 0)
    );
}
