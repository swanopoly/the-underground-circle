import { useState, useEffect } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const { data: { session: cachedSession } } = await supabase.auth.getSession();
        if (!cachedSession) {
          if (!cancelled) {
            setSession(null);
            setUser(null);
          }
          return;
        }

        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError || !authData.user) {
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          if (!cancelled) {
            setSession(null);
            setUser(null);
          }
          return;
        }

        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (!cancelled) {
          setSession(freshSession ?? cachedSession);
          setUser(authData.user);
        }
      } catch {
        if (!cancelled) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, username: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username, display_name: username },
      },
    });
    return { data, error };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { data, error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    return { error };
  };

  return { session, user, loading, signUp, signIn, signOut };
}

