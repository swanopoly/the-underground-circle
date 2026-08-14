import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { createNativeSecureAuthStorage, type AuthKeyValueStorage } from './authStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let storage: AuthKeyValueStorage;

if (Platform.OS === 'web') {
  storage = {
    getItem: (key: string) => {
      try { return Promise.resolve(localStorage.getItem(key)); }
      catch { return Promise.resolve(null); }
    },
    setItem: (key: string, value: string) => {
      try { localStorage.setItem(key, value); }
      catch {}
      return Promise.resolve();
    },
    removeItem: (key: string) => {
      try { localStorage.removeItem(key); }
      catch {}
      return Promise.resolve();
    },
  };
} else {
  storage = createNativeSecureAuthStorage();
}

// Deduplicate across HMR reloads — prevents "concurrent storage key" warning
const _global = globalThis as any;
if (!_global.__supabaseClient) {
  _global.__supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      // MUST be true on web with PKCE: OAuth/SSO return to the app with
      // ?code=..., and this flag is what makes GoTrue exchange it for a
      // session. It was false since the initial scaffold, which made
      // "Continue with Google" / SSO silently bounce back to the login
      // screen — nothing in the app calls exchangeCodeForSession manually.
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
      // Do not override Auth's lock. On browsers, Supabase uses the Web Locks
      // API to serialize refresh-token rotation across tabs. A no-op lock lets
      // two tabs spend the same single-use refresh token and can make the
      // losing refresh emit SIGNED_OUT for the whole browser session.
    },
  });
}

export const supabase: SupabaseClient = _global.__supabaseClient;

let exactAccessTokenClientCache: { accessToken: string; client: SupabaseClient } | null = null;

/**
 * Return a REST/functions client pinned to one already-validated bearer.
 *
 * PostgREST's `.setHeader('Authorization', ...)` still asks the parent
 * Supabase client for its current session before merging request headers. On
 * web that reacquires the Auth Web Lock and can abort during startup/tab
 * lifecycle changes. The `accessToken` client option bypasses that mutable
 * lookup entirely while retaining the normal project URL + anon apikey.
 */
export function getSupabaseClientForAccessToken(accessToken: string): SupabaseClient {
  const normalized = String(accessToken || '').trim();
  if (!normalized || normalized.length > 16_384) {
    throw new Error('A valid bounded Supabase access token is required.');
  }
  if (exactAccessTokenClientCache?.accessToken === normalized) {
    return exactAccessTokenClientCache.client;
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    accessToken: async () => normalized,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  exactAccessTokenClientCache = { accessToken: normalized, client };
  return client;
}
