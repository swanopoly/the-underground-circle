import type { Session, User } from '@supabase/supabase-js';

export type AuthLookupResult<T> = { value: T | null; error: Error | null };
export type AuthSessionLookup = () => Promise<AuthLookupResult<Session>>;
export type AuthUserLookup = () => Promise<AuthLookupResult<User>>;

export type AuthSessionValidationResult =
  | { status: 'valid'; session: Session }
  | {
      status: 'signed_out';
      session: null;
      reason: 'missing_candidate' | 'missing_user' | 'user_mismatch' | 'auth_rejected';
    }
  | { status: 'unavailable'; session: null; error: Error };

function isDefinitiveAuthRejection(error: Error): boolean {
  const authError = error as Error & { status?: unknown; code?: unknown };
  const status = typeof authError.status === 'number' ? authError.status : null;
  const code = typeof authError.code === 'string' ? authError.code.toLowerCase() : '';
  if (authError.name === 'AuthSessionMissingError') return true;
  if (status === 401 || status === 403) return true;
  return /^(bad_jwt|invalid_jwt|session_not_found|session_expired|refresh_token_not_found|refresh_token_already_used|user_not_found|user_banned|not_authenticated)$/.test(code);
}

/**
 * Inspect a cached/event session without confusing an unavailable Auth service
 * with a rejected identity. Callers may retain an already verified in-memory
 * session while `unavailable`, but must never use an unavailable cold-start
 * candidate to mount authenticated UI.
 */
export async function inspectAuthSessionCandidateCore(
  candidate: Session | null,
  getUser: AuthUserLookup,
): Promise<AuthSessionValidationResult> {
  if (!candidate?.access_token || !candidate.user?.id) {
    return { status: 'signed_out', session: null, reason: 'missing_candidate' };
  }

  const { value: verifiedUser, error } = await getUser();
  if (error) {
    return isDefinitiveAuthRejection(error)
      ? { status: 'signed_out', session: null, reason: 'auth_rejected' }
      : { status: 'unavailable', session: null, error };
  }
  if (!verifiedUser) return { status: 'signed_out', session: null, reason: 'missing_user' };
  if (verifiedUser.id !== candidate.user.id) {
    return { status: 'signed_out', session: null, reason: 'user_mismatch' };
  }

  return {
    status: 'valid',
    session: { ...candidate, user: verifiedUser },
  };
}

export async function inspectBootstrapAuthSessionCore(
  getSession: AuthSessionLookup,
  getUser: AuthUserLookup,
): Promise<AuthSessionValidationResult> {
  const { value: candidate, error } = await getSession();
  if (error) {
    return isDefinitiveAuthRejection(error)
      ? { status: 'signed_out', session: null, reason: 'auth_rejected' }
      : { status: 'unavailable', session: null, error };
  }
  return inspectAuthSessionCandidateCore(candidate, getUser);
}

export async function validateAuthSessionCandidateCore(
  candidate: Session | null,
  getUser: AuthUserLookup,
): Promise<Session | null> {
  const result = await inspectAuthSessionCandidateCore(candidate, getUser);
  return result.status === 'valid' ? result.session : null;
}

export async function bootstrapValidatedAuthSessionCore(
  getSession: AuthSessionLookup,
  getUser: AuthUserLookup,
): Promise<Session | null> {
  const result = await inspectBootstrapAuthSessionCore(getSession, getUser);
  return result.status === 'valid' ? result.session : null;
}
