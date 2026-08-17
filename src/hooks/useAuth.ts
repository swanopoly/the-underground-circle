import React, { createContext, useCallback, useContext, useMemo } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { normalizeAuthEmail } from '../lib/authUiPolicy';
import { secureSignOut } from '../lib/authLogout';
import { isExactRunMutationAuthorityCurrent } from '../lib/runHistoryFilterCore';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string, username: string) => ReturnType<typeof signUpWithPassword>;
  signIn: (email: string, password: string) => ReturnType<typeof signInWithPassword>;
  signOut: () => ReturnType<typeof signOutCurrentSession>;
}

async function signUpWithPassword(email: string, password: string, username: string) {
  const { data, error } = await supabase.auth.signUp({
    email: normalizeAuthEmail(email),
    password,
    options: {
      data: { username, display_name: username },
    },
  });
  return { data, error };
}

async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeAuthEmail(email),
    password,
  });
  return { data, error };
}

async function signOutCurrentSession(userId?: string | null) {
  const { error } = await secureSignOut({ scope: 'local', userId });
  return { error };
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * App.tsx is the sole auth-event/session owner. Descendants consume that
 * already validated state here instead of installing extra Supabase listeners
 * that can independently invalidate or delete the same persisted session.
 */
export function AuthSessionProvider({
  session,
  loading,
  children,
}: {
  session: Session | null;
  loading: boolean;
  children: React.ReactNode;
}) {
  const signOut = useCallback(
    () => signOutCurrentSession(session?.user.id),
    [session?.user.id],
  );
  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    signUp: signUpWithPassword,
    signIn: signInWithPassword,
    signOut,
  }), [loading, session, signOut]);

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside AuthSessionProvider.');
  }
  return value;
}

/**
 * Immutable user/circle bearer authority for exact client-side operations.
 *
 * The generation is intentionally local to the mounted consumer. A captured
 * authority is retired whenever its user, token, circle, or mounted lifecycle
 * changes, and `isAuthorityCurrent` is the live fence that async confirmation
 * and mutation paths must re-check immediately before dispatch.
 */
export type ExactCircleAuthAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type ExactCircleAuthAuthorityFence = (
  authority: ExactCircleAuthAuthority,
) => boolean;

export function useExactRunHistoryAuthority(circleId: string): Readonly<{
  exactAuthority: ExactCircleAuthAuthority | null;
  isExactAuthorityCurrent: ExactCircleAuthAuthorityFence;
}> {
  const { session, user, loading } = useAuth();
  const authorityRef = React.useRef<ExactCircleAuthAuthority | null>(null);
  const generationRef = React.useRef(0);
  const [committedAuthority, setCommittedAuthority] = React.useState<ExactCircleAuthAuthority | null>(null);
  const authReady = !loading
    && Boolean(circleId)
    && Boolean(user?.id)
    && user?.id === session?.user.id
    && Boolean(session?.access_token);
  // Updated during render so even an older callback captured by an in-flight
  // confirmation sees the newest auth/circle scope before passive cleanup.
  const liveScopeRef = React.useRef<Readonly<{
    authReady: boolean;
    userId: string | null;
    circleId: string;
    accessToken: string | null;
  }>>({ authReady: false, userId: null, circleId: '', accessToken: null });
  liveScopeRef.current = {
    authReady,
    userId: user?.id || null,
    circleId,
    accessToken: session?.access_token || null,
  };

  React.useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const authority = authReady && user?.id && session?.access_token
      ? Object.freeze({
          userId: user.id,
          circleId,
          accessToken: session.access_token,
          generation,
        })
      : null;
    authorityRef.current = authority;
    setCommittedAuthority(authority);
    return () => {
      generationRef.current += 1;
      if (authorityRef.current?.generation === generation) authorityRef.current = null;
      setCommittedAuthority((current) => current?.generation === generation ? null : current);
    };
  }, [authReady, circleId, session?.access_token, user?.id]);

  const isExactAuthorityCurrent = React.useCallback((authority: ExactCircleAuthAuthority): boolean => {
    const current = authorityRef.current;
    const liveScope = liveScopeRef.current;
    return Boolean(
      liveScope.authReady
      && current
      && authority.userId === liveScope.userId
      && authority.circleId === liveScope.circleId
      && authority.accessToken === liveScope.accessToken
      && isExactRunMutationAuthorityCurrent(authority, current)
    );
  }, []);

  const exactAuthority = committedAuthority
    && isExactAuthorityCurrent(committedAuthority)
      ? committedAuthority
      : null;

  return React.useMemo(() => ({ exactAuthority, isExactAuthorityCurrent }), [
    exactAuthority,
    isExactAuthorityCurrent,
  ]);
}

/**
 * Surface-neutral name for the shared exact Circle authority owner.
 * `useExactRunHistoryAuthority` remains as the compatibility export for the
 * existing Chat, Rooms, and Run History callers.
 */
export const useExactCircleAuthority = useExactRunHistoryAuthority;
