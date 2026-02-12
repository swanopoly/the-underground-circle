import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

let storage: any;

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
  storage = AsyncStorage;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
