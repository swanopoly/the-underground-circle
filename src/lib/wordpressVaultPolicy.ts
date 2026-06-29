/**
 * wordpressVaultPolicy — pure, fail-closed evaluation of a vault credential's
 * accessPolicy for a WordPress REST mutation.
 *
 * Dependency-light on purpose (no imports): the caller (wordpressChatCommands)
 * extracts the policy/actions/origins off the SiteCredentialVaultEntry via the
 * existing vaultAgentAccess helpers and passes them in, so this module stays
 * smoke-testable and reuses the SAME taxonomy/origin contract without inventing
 * a new approval fingerprint.
 *
 * This is enforced IN ADDITION to the existing Wave-1 chat confirm gate; it is
 * only consulted when the credentials came from the vault (legacy fallbacks
 * stay policy-less and unchanged).
 */

export type WpMutationAction = 'publish' | 'delete' | 'schedule' | 'edit';

export interface WpMutationPolicyDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

/**
 * The set of `allowed_actions` taxonomy entries that satisfy a mutation — the
 * action is permitted if the row's allowed_actions contains ANY of them.
 *
 * `publish`/`schedule` accept the legacy `post` action as well as `publish`:
 * creating a published post and flipping a draft live are the same capability,
 * so existing rows provisioned with `[login, post, edit]` keep working.
 * `delete` is intentionally strict (most damaging op → explicit opt-in only).
 */
function acceptableActionsFor(action: WpMutationAction): string[] {
  switch (action) {
    case 'publish': return ['publish', 'post'];
    case 'schedule': return ['publish', 'post'];
    case 'delete': return ['delete'];
    case 'edit': return ['edit'];
  }
}

/** Local origin normalizer — mirrors vaultAgentAccess.normalizedOrigin. */
function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    const url = new URL(withProtocol);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export interface EvaluateWpMutationPolicyInput {
  accessPolicy: Record<string, unknown> | null | undefined;
  allowedActions: string[];
  allowedOrigins: string[];
  siteUrl: string | null | undefined;
  action: WpMutationAction;
}

/**
 * Fail-closed policy gate. Denies when:
 *  - the required action is not in the allowed_actions taxonomy;
 *  - the siteUrl is missing/unparseable;
 *  - the target origin is not HTTPS;
 *  - no allowed origin exactly matches the normalized target origin.
 *
 * requiresApproval defaults to true unless the policy explicitly sets
 * require_approval === false.
 */
export function evaluateWpMutationPolicy(
  input: EvaluateWpMutationPolicyInput,
): WpMutationPolicyDecision {
  const requiresApproval = !(input.accessPolicy && (input.accessPolicy as Record<string, unknown>).require_approval === false);

  const acceptable = acceptableActionsFor(input.action);
  const normalizedAllowed = input.allowedActions.map((a) => a.trim().toLowerCase());
  if (!acceptable.some((a) => normalizedAllowed.includes(a))) {
    return {
      allowed: false,
      requiresApproval,
      reason: `the vault credential does not allow "${input.action}" (needs one of: ${acceptable.join(', ')}; allowed: ${normalizedAllowed.join(', ') || 'none'})`,
    };
  }

  const targetOrigin = normalizeOrigin(input.siteUrl);
  if (!targetOrigin) {
    return { allowed: false, requiresApproval, reason: 'the target site URL is missing or could not be parsed' };
  }
  if (!targetOrigin.startsWith('https://')) {
    return { allowed: false, requiresApproval, reason: `the target origin is not HTTPS (${targetOrigin})` };
  }

  const allowedOriginSet = input.allowedOrigins
    .map((o) => normalizeOrigin(o))
    .filter((o): o is string => !!o);
  if (!allowedOriginSet.includes(targetOrigin)) {
    return {
      allowed: false,
      requiresApproval,
      reason: `the target origin ${targetOrigin} is not in the credential's allowed origins`,
    };
  }

  return { allowed: true, requiresApproval };
}
