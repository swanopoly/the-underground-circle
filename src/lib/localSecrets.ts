import { Platform } from 'react-native';

const SECRET_PREFIX = '@local_secret:';

function storageKey(namespace: string, id: string): string {
  return `${SECRET_PREFIX}${namespace}:${id}`;
}

async function getSecureStore() {
  if (Platform.OS === 'web') return null;
  try {
    return await import('expo-secure-store');
  } catch {
    return null;
  }
}

export async function readLocalSecret(namespace: string, id: string): Promise<string> {
  const key = storageKey(namespace, id);
  try {
    if (Platform.OS === 'web') {
      return localStorage.getItem(key) || '';
    }
  } catch {}

  const secureStore = await getSecureStore();
  if (!secureStore) return '';
  try {
    return (await secureStore.getItemAsync(key)) || '';
  } catch {
    return '';
  }
}

export async function writeLocalSecret(namespace: string, id: string, value: string): Promise<void> {
  const key = storageKey(namespace, id);
  try {
    if (Platform.OS === 'web') {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
      return;
    }
  } catch {}

  const secureStore = await getSecureStore();
  if (!secureStore) return;
  try {
    if (value) await secureStore.setItemAsync(key, value);
    else await secureStore.deleteItemAsync(key);
  } catch {}
}

export async function deleteLocalSecret(namespace: string, id: string): Promise<void> {
  await writeLocalSecret(namespace, id, '');
}
