import { useState, useEffect } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  bootstrapValidatedAuthSession,
  clearInvalidLocalAuthSession,
  validateAuthSessionCandidate,
} from '../lib/authBootstrap';
import { normalizeAuthEmail } from '../lib/authUiPolicy';
import { secureSignOut } from '../lib/authLogout';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let revision = 0;

    const bootstrap = async () => {
      const currentRevision = ++revision;
      try {
        const validatedSession = await bootstrapValidatedAuthSession();
        if (cancelled || currentRevision !== revision) return;
        setSession(validatedSession);
        setUser(validatedSession?.user ?? null);
        if (!validatedSession) void clearInvalidLocalAuthSession();
      } catch {
        if (!cancelled && currentRevision === revision) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (!cancelled && currentRevision === revision) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT') {
        revision += 1;
        setSession(null);
        setUser(null);
        setLoading(false);
        return;
      }
      if (!nextSession) {
        if (event === 'INITIAL_SESSION') {
          setSession(null);
          setUser(null);
          setLoading(false);
        }
        return;
      }

      const currentRevision = ++revision;
      setTimeout(() => {
        validateAuthSessionCandidate(nextSession).then((validatedSession) => {
          if (cancelled || currentRevision !== revision) return;
          setSession(validatedSession);
          setUser(validatedSession?.user ?? null);
          setLoading(false);
          if (!validatedSession) void clearInvalidLocalAuthSession();
        }).catch(() => {
          if (cancelled || currentRevision !== revision) return;
          setSession(null);
          setUser(null);
          setLoading(false);
        });
      }, 0);
    });

    return () => {
      cancelled = true;
      revision += 1;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, username: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: normalizeAuthEmail(email),
      password,
      options: {
        data: { username, display_name: username },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeAuthEmail(email),
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await secureSignOut({ scope: 'local', userId: user?.id });
    return { error };
  };

  return { session, user, loading, signUp, signIn, signOut };
}

