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
      // Disable navigator.locks on web — prevents AbortError from GoTrueClient
      lock: Platform.OS === 'web'
        ? async (_name: string, _acquireTimeout: number, fn: () => Promise<any>) => await fn()
        : undefined,
    },
  });
}

export const supabase: SupabaseClient = _global.__supabaseClient;
