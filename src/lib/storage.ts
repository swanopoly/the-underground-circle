// Cross-platform storage wrapper
// Use this instead of importing AsyncStorage directly
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class WebStorage implements Storage {
  async getItem(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Silent fail
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silent fail
    }
  }
}

// Export the appropriate storage for the platform
export const storage: Storage = Platform.OS === 'web' ? new WebStorage() : AsyncStorage;

/**
 * Remove only keys owned by an authenticated session/capability namespace.
 * This deliberately requires explicit prefixes so logout cleanup cannot turn
 * into a broad "clear all device data" operation.
 */
export async function removeStorageKeysByPrefix(prefixes: readonly string[]): Promise<number> {
  const allowedPrefixes = Array.from(new Set(
    prefixes.map((prefix) => String(prefix || '')).filter(Boolean),
  ));
  if (allowedPrefixes.length === 0) return 0;

  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return 0;
    const matches: string[] = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key && allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
          matches.push(key);
        }
      }
      matches.forEach((key) => localStorage.removeItem(key));
      return matches.length;
    } catch {
      return 0;
    }
  }

  try {
    const keys = await AsyncStorage.getAllKeys();
    const matches = keys.filter((key) => allowedPrefixes.some((prefix) => key.startsWith(prefix)));
    if (matches.length > 0) await AsyncStorage.multiRemove(matches);
    return matches.length;
  } catch {
    return 0;
  }
}
