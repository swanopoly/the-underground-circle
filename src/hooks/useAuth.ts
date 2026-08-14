import React, { createContext, useCallback, useContext, useMemo } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { normalizeAuthEmail } from '../lib/authUiPolicy';
import { secureSignOut } from '../lib/authLogout';

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
