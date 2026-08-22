/**
 * Pure policy for recovering a web client whose lazy-module graph no longer
 * matches the currently published Netlify artifact.
 *
 * Keep this module browser-API free so its error classification and reload
 * throttling can be executed in a Node smoke test. The ErrorBoundary owns the
 * actual sessionStorage, online-event, and location.reload side effects.
 */

export const WEB_MODULE_GRAPH_REVISION = '2026-08-20-module-skew-recovery-v1';
export const WEB_MODULE_RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;

export type WebModuleRecoveryAction =
  | 'none'
  | 'reload_once'
  | 'wait_for_online'
  | 'show_manual_reload';

export type WebModuleRecoveryPlan = {
  action: WebModuleRecoveryAction;
  storageKey: string | null;
};

type PlanWebModuleRecoveryInput = {
  error: unknown;
  online: boolean;
  nowMs: number;
  previousAttemptAtMs?: number | null;
  cooldownMs?: number;
};

function errorNameAndMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const candidate = error as { name?: unknown; message?: unknown };
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const message = typeof candidate.message === 'string' ? candidate.message : '';
    return `${name}: ${message}`;
  }
  return '';
}

/**
 * Detect only failures that identify JavaScript/module loading. Generic
 * `Failed to fetch` errors are deliberately excluded because they also cover
 * Supabase, provider, and offline data requests that must not reload the app.
 */
export function isWebModuleLoadFailure(error: unknown): boolean {
  const text = errorNameAndMessage(error).toLowerCase();
  if (!text) return false;

  return (
    text.includes('asyncrequireerror')
    || /loading module\s+https?:\/\/\S+\s+failed/.test(text)
    || text.includes('failed to fetch dynamically imported module')
    || text.includes('importing a module script failed')
    || text.includes('chunkloaderror')
    || /loading (?:css )?chunk\s+\S+\s+failed/.test(text)
    || text.includes('expected a javascript-or-wasm module script')
    || (/module script/.test(text) && /mime type.*text\/html/.test(text))
  );
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function moduleFailureIdentity(error: unknown): string {
  const text = errorNameAndMessage(error).slice(0, 1000);
  const moduleUrl = text.match(/https?:\/\/[^\s)]+?\.js(?:\?[^\s)]*)?/i)?.[0];
  return moduleUrl || text;
}

export function buildWebModuleRecoveryStorageKey(error: unknown): string | null {
  if (!isWebModuleLoadFailure(error)) return null;
  return `uc:web-module-recovery:${WEB_MODULE_GRAPH_REVISION}:${stableHash(moduleFailureIdentity(error))}`;
}

export function planWebModuleRecovery(input: PlanWebModuleRecoveryInput): WebModuleRecoveryPlan {
  const storageKey = buildWebModuleRecoveryStorageKey(input.error);
  if (!storageKey) return { action: 'none', storageKey: null };

  if (!input.online) return { action: 'wait_for_online', storageKey };

  const nowMs = Number.isFinite(input.nowMs) ? Math.max(0, input.nowMs) : 0;
  const previousAttemptAtMs = Number.isFinite(input.previousAttemptAtMs)
    ? Math.max(0, Number(input.previousAttemptAtMs))
    : null;
  const cooldownMs = Number.isFinite(input.cooldownMs)
    ? Math.max(1, Number(input.cooldownMs))
    : WEB_MODULE_RECOVERY_COOLDOWN_MS;

  if (
    previousAttemptAtMs !== null
    && nowMs >= previousAttemptAtMs
    && nowMs - previousAttemptAtMs < cooldownMs
  ) {
    return { action: 'show_manual_reload', storageKey };
  }

  return { action: 'reload_once', storageKey };
}
