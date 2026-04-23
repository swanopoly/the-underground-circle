/**
 * swanbotRouting — Phase M1 of `docs/SWANBOT_V2_MIGRATION_PLAN.md`.
 *
 * Per-device feature flag that routes main chat from the v1 edge
 * function (`swanbot-ai`, hardcoded tool list) to the v2 edge function
 * (`swanbot-v2-ai`, typed tool loop matching `agentExecutionCore`).
 *
 * Default: v1 (false). User opts into v2 by running `/v2 on` in chat
 * or calling `enableSwanbotV2()` from a dev console. The flag lives in
 * localStorage so flips are instant and per-device — no DB write, no
 * deploy, no reload.
 *
 * M2 adds a kill switch via the edge fn's env var so ops can force a
 * rollback without users flipping individual flags. M4 flips the
 * default. See the migration plan for the phase boundaries.
 */

const FLAG_KEY = 'uc_swanbot_v2_enabled';

/** Reads the flag. `false` by default. */
export function isSwanbotV2Enabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Flip on. Returns the new value for call-site UI rendering. */
export function enableSwanbotV2(): boolean {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(FLAG_KEY, 'true');
  } catch {}
  return true;
}

/** Flip off — routes back to v1. */
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
  return {
    enabled,
    message: [
      `SwanBot v2 ${verb} **${enabled ? 'ENABLED' : 'disabled'}** on this device.`,
      '',
      enabled
        ? '→ Main chat routes to `swanbot-v2-ai` (typed tool loop + per-tool approvals). Run `/v2 off` to revert.'
        : '→ Main chat routes to `swanbot-ai` (legacy). Run `/v2 on` to try v2.',
      '',
      'See `docs/SWANBOT_V2_MIGRATION_PLAN.md` for what ships in each migration phase.',
    ].join('\n'),
  };
}
