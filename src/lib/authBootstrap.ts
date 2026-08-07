import type { Session } from '@supabase/supabase-js';
import { safeGetSession, safeGetUser } from './authSession';
import { secureSignOut } from './authLogout';
import {
  bootstrapValidatedAuthSessionCore,
  validateAuthSessionCandidateCore,
  type AuthSessionLookup,
  type AuthUserLookup,
} from './authBootstrapCore';

/**
 * Verify that a session stored by the client still belongs to the user that
 * Supabase Auth recognizes server-side. A local session alone is not an
 * authorization decision: it can be stale, revoked, or corrupted.
 */
export async function validateAuthSessionCandidate(
  candidate: Session | null,
  getUser: AuthUserLookup = safeGetUser,
): Promise<Session | null> {
  return validateAuthSessionCandidateCore(candidate, getUser);
}

/** Load the cached session and validate it before authenticated UI mounts. */
export async function bootstrapValidatedAuthSession(
  getSession: AuthSessionLookup = safeGetSession,
  getUser: AuthUserLookup = safeGetUser,
): Promise<Session | null> {
  return bootstrapValidatedAuthSessionCore(getSession, getUser);
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
