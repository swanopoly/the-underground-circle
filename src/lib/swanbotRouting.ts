/**
 * swanbotRouting — Phases M1 + M4 of `docs/SWANBOT_V2_MIGRATION_PLAN.md`.
 *
 * Per-device feature flag that routes main chat between the v1 edge
 * function (`swanbot-ai`, hardcoded tool list) and the v2 edge function
 * (`swanbot-v2-ai`, typed tool loop matching `agentExecutionCore`).
 *
 * Default: v2 (true). M4 flipped the flag to opt-OUT semantics on
 * 2026-07-07: `isSwanbotV2Enabled()` returns true unless the device
 * stored an explicit `'false'` via `/v2 off` / `disableSwanbotV2()`.
 * Absent keys, unparseable values, and runtimes without localStorage
 * (native now defaults ON too) all route to v2 — safe because
 * `swanbot.ts` still falls back to v1 on any v2 transport failure, and
 * the session circuit breaker below stops re-trying v2 after repeated
 * failures. The flag lives in localStorage so flips are instant and
 * per-device — no DB write, no deploy, no reload.
 *
 * M2 added a kill switch via the edge fn's env var so ops can force a
 * rollback without users flipping individual flags. M5 deletes v1. See
 * the migration plan for the phase boundaries.
 */

const FLAG_KEY = 'uc_swanbot_v2_enabled';

/** Reads the flag. `true` by default (M4 opt-out semantics) — only an
 *  explicit stored `'false'` routes a device to the legacy v1 loop. */
export function isSwanbotV2Enabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(FLAG_KEY) !== 'false';
  } catch {
    return true;
  }
}

/** Flip on (back to the v2 default). Also closes the session circuit
 *  breaker so `/v2 on` retries v2 immediately after a pause. Returns
 *  the new value for call-site UI rendering. */
export function enableSwanbotV2(): boolean {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FLAG_KEY, 'true');
  } catch {}
  resetSwanbotV2Circuit();
  return true;
}

/** Flip off — routes back to legacy v1 (explicit opt-out). */
export function disableSwanbotV2(): boolean {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FLAG_KEY, 'false');
  } catch {}
  return false;
}

/** Toggle; returns the new value. */
export function toggleSwanbotV2(): boolean {
  return isSwanbotV2Enabled() ? disableSwanbotV2() : enableSwanbotV2();
}

// ─── Session circuit breaker ─────────────────────────────────────────
//
// With v2 as the default, a stale/broken `swanbot-v2-ai` deploy would
// make EVERY message pay a doomed v2 round trip (plus transient
// retries) before the v1 fallback answers. The breaker counts
// CONSECUTIVE v2 transport failures — the router's null/throw signal,
// NOT model-content issues (those come back as strings) — and after
// `CIRCUIT_THRESHOLD` of them the router skips v2 for the rest of the
// session. In-memory + module-level only: a reload closes it, any v2
// success closes it, and `enableSwanbotV2()` (`/v2 on`) closes it so
// users can retry immediately.

const CIRCUIT_THRESHOLD = 2;
let consecutiveV2TransportFailures = 0;

/** Record the outcome of a v2 attempt. `ok=false` means transport
 *  failure (invoke returned null or threw); any success resets the
 *  consecutive-failure streak. */
export function recordSwanbotV2Outcome(ok: boolean): void {
  consecutiveV2TransportFailures = ok ? 0 : consecutiveV2TransportFailures + 1;
}

/** True once the session has seen `CIRCUIT_THRESHOLD` consecutive v2
 *  transport failures — the router should skip v2 until reset. */
export function isSwanbotV2CircuitOpen(): boolean {
  return consecutiveV2TransportFailures >= CIRCUIT_THRESHOLD;
}

/** Close the breaker (clears the failure streak). Called by
 *  `enableSwanbotV2()`; exported for tests and dev consoles. */
export function resetSwanbotV2Circuit(): void {
  consecutiveV2TransportFailures = 0;
}

/** One-line breaker status for the `/v2` command copy. Null while the
 *  circuit is closed (nothing to report). */
export function describeSwanbotV2Circuit(): string | null {
  if (!isSwanbotV2CircuitOpen()) return null;
  return 'v2 paused this session after repeated failures — `/v2 on` to retry.';
}

/** Pure parser for the `/v2` slash command. Returns the new intent, or
 *  null when the input isn't a `/v2` command. Exposed so the chat
 *  handler and smoke tests share the same grammar. */
export function parseSwanbotV2Command(
  raw: string,
): { action: 'enable' | 'disable' | 'toggle' | 'status' } | null {
  const trimmed = String(raw || '').trim().toLowerCase();
  const match = trimmed.match(/^\/v2\b\s*(.*)$/);
  if (!match) return null;
  const arg = (match[1] || '').trim();
  if (!arg || arg === 'status') return { action: 'status' };
  if (arg === 'on' || arg === 'enable' || arg === 'true') return { action: 'enable' };
  if (arg === 'off' || arg === 'disable' || arg === 'false') return { action: 'disable' };
  if (arg === 'toggle') return { action: 'toggle' };
  // Unknown arg — treat as status query.
  return { action: 'status' };
}

/** Apply a `/v2` command and return a one-line user-facing message. */
export function applySwanbotV2Command(
  action: 'enable' | 'disable' | 'toggle' | 'status',
): { message: string; enabled: boolean } {
  let enabled: boolean;
  switch (action) {
    case 'enable':  enabled = enableSwanbotV2();  break;
    case 'disable': enabled = disableSwanbotV2(); break;
    case 'toggle':  enabled = toggleSwanbotV2();  break;
    case 'status':
    default:        enabled = isSwanbotV2Enabled();
  }
  const verb = action === 'status' ? 'is' : 'is now';
  const circuitNote = enabled ? describeSwanbotV2Circuit() : null;
  return {
    enabled,
    message: [
      `SwanBot v2 ${verb} **${enabled ? 'ENABLED' : 'disabled'}** on this device.`,
      '',
      enabled
        ? '→ Main chat uses the v2 typed loop (default) — `swanbot-v2-ai` with per-tool approvals. Run `/v2 off` to use the legacy loop.'
        : '→ Main chat routes to `swanbot-ai` (legacy loop). Run `/v2 on` to return to the v2 default.',
      ...(circuitNote ? ['', `⚠ ${circuitNote}`] : []),
      '',
      'See `docs/SWANBOT_V2_MIGRATION_PLAN.md` for what ships in each migration phase.',
    ].join('\n'),
  };
}
