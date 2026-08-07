import type { Session, User } from '@supabase/supabase-js';

export type AuthLookupResult<T> = { value: T | null; error: Error | null };
export type AuthSessionLookup = () => Promise<AuthLookupResult<Session>>;
export type AuthUserLookup = () => Promise<AuthLookupResult<User>>;

export async function validateAuthSessionCandidateCore(
  candidate: Session | null,
  getUser: AuthUserLookup,
): Promise<Session | null> {
  if (!candidate?.access_token || !candidate.user?.id) return null;

  const { value: verifiedUser, error } = await getUser();
  if (error || !verifiedUser || verifiedUser.id !== candidate.user.id) return null;

  return { ...candidate, user: verifiedUser };
}

export async function bootstrapValidatedAuthSessionCore(
  getSession: AuthSessionLookup,
  getUser: AuthUserLookup,
): Promise<Session | null> {
  const { value: candidate, error } = await getSession();
  if (error || !candidate) return null;
  return validateAuthSessionCandidateCore(candidate, getUser);
}
