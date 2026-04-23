/**
 * errorReporter — single place to collect unhandled runtime errors so we can
 * see what's actually crashing in production.
 *
 * Why bother: most of our auth-related AbortErrors and Realtime teardown
 * errors never surface because they're fired from background tasks that don't
 * have a React error boundary upstream. We've been spot-fixing them one
 * caller at a time; this captures the rest so they at least end up somewhere
 * triageable.
 *
 * What it does:
 *   1. Registers `unhandledrejection` + `error` listeners on web.
 *   2. Keeps an in-memory ring buffer of the last 25 errors with timestamps,
 *      reason, and stack (if any).
 *   3. Mirrors the latest error onto `window.__uc_last_global_error` so
 *      support can paste it straight from DevTools without reloading.
 *   4. Is a no-op on native RN runtimes (there's no DOM `window` and RN has
 *      its own error machinery — we'll integrate that separately if needed).
 *
 * Intentionally does NOT ship to Sentry / Supabase today. Getting the
 * `app_errors` table schema right is its own task; the console is fine
 * until then.
 */

import { Platform } from 'react-native';

export type CapturedError = {
  kind: 'unhandled-rejection' | 'window-error' | 'manual';
  message: string;
  stack?: string;
  source?: string;
  at: string; // ISO timestamp
  tag?: string;
};

const BUFFER_SIZE = 25;
const buffer: CapturedError[] = [];
let initialised = false;

function push(entry: CapturedError) {
  buffer.push(entry);
  if (buffer.length > BUFFER_SIZE) buffer.shift();
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { (window as any).__uc_last_global_error = entry; } catch {}
  }
}

function toStringSafe(value: unknown): string {
  if (value == null) return 'undefined';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

function stackOf(value: unknown): string | undefined {
  if (value instanceof Error && value.stack) return value.stack;
  return undefined;
}

/**
 * Install global handlers. Idempotent — safe to call from multiple entry
 * points (e.g. `App.tsx` and a web-only bootstrap shim).
 */
export function installErrorReporter() {
  if (initialised) return;
  initialised = true;

  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    // Supabase's GoTrueClient can fire AbortError on the web's no-op lock
    // (see CLAUDE.md "Web Platform Stability"). That particular error is a
    // symptom we already mitigate via safeGetUser; log it at a low level so
    // the buffer stays useful for the rest.
    const reason = event.reason;
    const message = toStringSafe(reason);
    const isBenignAbort = /AbortError/i.test(message);

    push({
      kind: 'unhandled-rejection',
      message,
      stack: stackOf(reason),
      at: new Date().toISOString(),
      tag: isBenignAbort ? 'auth-abort' : undefined,
    });

    if (!isBenignAbort) {
      console.warn('[errorReporter] unhandled rejection:', reason);
    }
    // Never preventDefault — we want the browser's built-in logging too.
  });

  window.addEventListener('error', (event: ErrorEvent) => {
    const message = event.message || toStringSafe(event.error);
    push({
      kind: 'window-error',
      message,
      stack: stackOf(event.error),
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      at: new Date().toISOString(),
    });
    console.warn('[errorReporter] window error:', event.error || event.message);
  });
}

export function reportError(err: unknown, tag?: string) {
  push({
    kind: 'manual',
    message: toStringSafe(err),
    stack: stackOf(err),
    at: new Date().toISOString(),
    tag,
  });
}

export function getErrorBuffer(): CapturedError[] {
  return [...buffer];
}

export function clearErrorBuffer() {
  buffer.length = 0;
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { delete (window as any).__uc_last_global_error; } catch {}
  }
}
