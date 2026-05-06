import { Platform } from 'react-native';

const STRICT_LOCAL_AI_MODE_STORAGE_KEY = 'uc_strict_local_ai_mode';
const DEFAULT_STRICT_LOCAL_AI_MODE = false;
const STRICT_LOCAL_AI_MODE_EVENT = 'uc:strict-local-ai-mode-changed';

const EXTERNAL_AI_PROVIDERS = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'groq',
  'replicate',
  'huggingface',
  'github-models',
  'gemini',
  'google',
  'zai',
  'minimax',
  'glm',
  'moonshot',
  'cohere',
  'mistral',
]);

function readStoredStrictLocalAiMode(): boolean | null {
  if (Platform.OS !== 'web') return null;
  try {
    const raw = localStorage.getItem(STRICT_LOCAL_AI_MODE_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {}
  return null;
}

let strictLocalAiModeState = readStoredStrictLocalAiMode() ?? DEFAULT_STRICT_LOCAL_AI_MODE;

export function isStrictLocalAiModeEnabled(): boolean {
  return strictLocalAiModeState;
}

export function setStrictLocalAiModeEnabled(enabled: boolean): void {
  strictLocalAiModeState = enabled;
  if (Platform.OS !== 'web') return;
  try {
    localStorage.setItem(STRICT_LOCAL_AI_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(STRICT_LOCAL_AI_MODE_EVENT, { detail: { enabled } }));
  } catch {}
}

export function subscribeStrictLocalAiMode(listener: (enabled: boolean) => void): () => void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return () => {};
  }

  const handleCustom = (event: Event) => {
    const enabled = Boolean((event as CustomEvent<{ enabled?: boolean }>).detail?.enabled);
    strictLocalAiModeState = enabled;
    listener(enabled);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STRICT_LOCAL_AI_MODE_STORAGE_KEY) return;
    const enabled = event.newValue === 'true';
    strictLocalAiModeState = enabled;
    listener(enabled);
  };

  window.addEventListener(STRICT_LOCAL_AI_MODE_EVENT, handleCustom as EventListener);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(STRICT_LOCAL_AI_MODE_EVENT, handleCustom as EventListener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function isExternalAiProvider(provider: string | null | undefined): boolean {
  if (!provider) return false;
  return EXTERNAL_AI_PROVIDERS.has(provider.toLowerCase());
}

export function shouldBlockExternalAiProvider(provider: string | null | undefined): boolean {
  return isStrictLocalAiModeEnabled() && isExternalAiProvider(provider);
}

export function getStrictLocalAiModeMessage(provider?: string | null): string {
  const suffix = provider ? ` (${provider})` : '';
  return `Strict local AI mode is enabled. External AI provider calls${suffix} are blocked. Use local runtimes like BlackSwan/Ollama or a local OpenSwan gateway.`;
}
