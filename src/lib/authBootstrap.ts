import type { Session } from '@supabase/supabase-js';
import { safeGetSession, safeGetUserForAccessToken } from './authSession';
import { secureSignOut } from './authLogout';
import {
  inspectAuthSessionCandidateCore,
  inspectBootstrapAuthSessionCore,
  validateAuthSessionCandidateCore,
  type AuthSessionValidationResult,
  type AuthSessionLookup,
  type AuthUserLookup,
} from './authBootstrapCore';

export type { AuthSessionValidationResult } from './authBootstrapCore';

// Cold-start verification is allowed a wider network/Web-Lock window than
// ordinary cosmetic identity reads. The Supabase edge can occasionally take
// longer than the general six-second helper bound after sleep, deploys, or a
// network transition. This does not trust the cached session: navigation still
// waits for the same server-side getUser verification.
export const AUTH_BOOTSTRAP_CALL_TIMEOUT_MS = 15_000;

const safeGetBootstrapSession: AuthSessionLookup = () =>
  safeGetSession(AUTH_BOOTSTRAP_CALL_TIMEOUT_MS);
const candidateUserLookup = (candidate: Session | null): AuthUserLookup => () =>
  safeGetUserForAccessToken(candidate?.access_token || '', AUTH_BOOTSTRAP_CALL_TIMEOUT_MS);

/**
 * Verify that a session stored by the client still belongs to the user that
 * Supabase Auth recognizes server-side. A local session alone is not an
 * authorization decision: it can be stale, revoked, or corrupted.
 */
export async function validateAuthSessionCandidate(
  candidate: Session | null,
  getUser?: AuthUserLookup,
): Promise<Session | null> {
  return validateAuthSessionCandidateCore(candidate, getUser || candidateUserLookup(candidate));
}

/**
 * Discriminated validation for navigation/session owners. `unavailable` is a
 * retryable connectivity/lock failure and must not be converted into logout.
 */
export async function inspectAuthSessionCandidate(
  candidate: Session | null,
  getUser?: AuthUserLookup,
): Promise<AuthSessionValidationResult> {
  return inspectAuthSessionCandidateCore(candidate, getUser || candidateUserLookup(candidate));
}

/** Load the cached session and validate it before authenticated UI mounts. */
export async function bootstrapValidatedAuthSession(
  getSession: AuthSessionLookup = safeGetBootstrapSession,
  getUser?: AuthUserLookup,
): Promise<Session | null> {
  const result = await inspectBootstrapAuthSession(getSession, getUser);
  return result.status === 'valid' ? result.session : null;
}

/** Cold-start equivalent of inspectAuthSessionCandidate. */
export async function inspectBootstrapAuthSession(
  getSession: AuthSessionLookup = safeGetBootstrapSession,
  getUser?: AuthUserLookup,
): Promise<AuthSessionValidationResult> {
  const sessionLookup = await getSession();
  return inspectBootstrapAuthSessionCore(
    async () => sessionLookup,
    getUser || candidateUserLookup(sessionLookup.value),
  );
}

/**
 * Best-effort local cleanup for a rejected cached session. This is bounded so
 * an unavailable auth service cannot hold the route guard indefinitely.
 */
export async function clearInvalidLocalAuthSession(timeoutMs = 2_000): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    secureSignOut({ scope: 'local' }).then(finish, finish);
  });
}
