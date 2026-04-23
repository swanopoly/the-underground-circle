/**
 * devLog — tiny opt-in trace logger
 *
 * Lifecycle and error events (bridge came online, auth failed, migration
 * warnings) belong on `info` / `warn` / `error` — they fire rarely and help
 * future-you debug without a REPL. High-frequency per-event chatter
 * (saveMemory OK, tab visible, per-row status updates) belongs on `trace`
 * — silent by default, opt-in via `localStorage.UC_DEBUG = 'trace'`.
 *
 * Keep this file dependency-free so it can safely import from anywhere.
 */

type TraceLevel = 'off' | 'trace';

function readLevel(): TraceLevel {
  try {
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem('UC_DEBUG');
      if (v === 'trace') return 'trace';
    }
  } catch {}
  return 'off';
}

// Cache the level per page load — reading localStorage on every call adds up
// for per-event logs. Users toggling at runtime can hard-reload.
const level: TraceLevel = readLevel();

export const devLog = {
  trace: (...args: unknown[]) => {
    if (level === 'trace') console.log(...args);
  },
  info:  (...args: unknown[]) => console.log(...args),
  warn:  (...args: unknown[]) => console.warn(...args),
  error: (...args: unknown[]) => console.error(...args),
};
