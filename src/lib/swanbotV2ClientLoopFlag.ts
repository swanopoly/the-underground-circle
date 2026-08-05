/**
 * swanbotV2ClientLoopFlag — rollout control for
 * `docs/LOOP_CONVERGENCE_RUNBOOK.md`
 * (which executes `docs/adr/ADR-0002-loop-convergence.md`, "CONSOLIDATE #1").
 *
 * The live, per-device canary flag for loop convergence. When ON, the `batch` chat lane's
 * `callSwanBotV2` (`src/lib/swanbot.ts:1019`) will run the client-side
 * `agentExecutionCore.runAgent` loop (via the landed
 * `swanbotV2BatchRuntime`) instead of the `swanbot-v2-ai` edge round-trip.
 * The edge stays deployed as the revert target throughout rollout (runbook §7).
 *
 * SHAPE mirrors `swanbotRouting.isSwanbotV2Enabled` (`src/lib/swanbotRouting.ts:27`):
 * a per-device localStorage flag — flips are instant, per-device, no DB write,
 * no deploy, no reload — read behind a `typeof localStorage` guard and a
 * fail-soft `try/catch`.
 *
 * ONE deliberate inversion vs. the v2 edge flag: this flag is DEFAULT OFF
 * (opt-IN). The edge flag is opt-OUT (`!== 'false'`, defaults ON,
 * `swanbotRouting.ts:30`); this one is enabled ONLY when the stored value is
 * exactly `'true'`. Absent keys, unparseable values, and runtimes without
 * localStorage all route to the EDGE path (today's behavior) — so Phase 2's
 * one-line `swanbot.ts` delegation is a pure no-op on merge (runbook §4).
 *
 * The coordinated Phase-2 `swanbot.ts` guard has landed. DEFAULT OFF remains
 * load-bearing: absence of the key must keep routing to the edge until the
 * production telemetry/readiness gate explicitly authorizes a later default
 * flip. `enableSwanbotV2ClientLoop()` is a device-local canary opt-in, not
 * evidence that the global default is ready to change.
 *
 * Zero imports ⇒ tsx-loadable, so the read-decision is smoke-testable off the
 * DOM (`scripts/swanbot-v2-client-loop-flag-smoketest.ts`).
 */

/** localStorage key. The stored contract with every device's flag — do not
 *  rename without a migration (a rename silently resets everyone to OFF).
 *  Exported so a future `/v2loop` command and the smoke can pin the exact key
 *  instead of duplicating the string. */
export const SWANBOT_V2_CLIENT_LOOP_FLAG_KEY = 'uc_swanbot_v2_client_loop';

/** The single canonical "enabled" stored value. `enable` writes exactly this
 *  and the read-normalizer checks for exactly this, so writer and reader can
 *  never drift. */
const ENABLED_VALUE = 'true';
/** The canonical "disabled" stored value written by `disable`/`toggle`. Kept
 *  distinct from "absent" so an explicit opt-out is legible in devtools and
 *  survives a later default flip (runbook §4 Phase 4). */
const DISABLED_VALUE = 'false';

/**
 * Pure read-normalizer: given a raw localStorage value, decide whether the
 * client loop is enabled. DEFAULT OFF — true ONLY for the exact canonical
 * `'true'` (byte-for-byte; no trim, no lowercase), mirroring the runbook's
 * `=== 'true'` gate and `swanbotRouting`'s exact `!== 'false'` comparison
 * (`swanbotRouting.ts:30`). Total for any input; zero imports ⇒ tsx-loadable.
 */
export function normalizeClientLoopFlagValue(
  raw: string | null | undefined,
): boolean {
  return raw === ENABLED_VALUE;
}

/**
 * Reads the flag. DEFAULT OFF (opt-in): true only when this device stored an
 * explicit `'true'`. Fail-soft — a runtime without localStorage, or any
 * storage access error, returns false (route to the edge, today's behavior).
 * Never throws.
 */
export function isSwanbotV2ClientLoopEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return normalizeClientLoopFlagValue(
      localStorage.getItem(SWANBOT_V2_CLIENT_LOOP_FLAG_KEY),
    );
  } catch {
    return false;
  }
}

/**
 * Flip ON — routes the batch lane through the client-side `runAgent` loop.
 * Fail-soft (a storage-write error is swallowed). Returns the new intended
 * value (true) for call-site UI, mirroring `enableSwanbotV2`
 * (`swanbotRouting.ts:39`).
 */
export function enableSwanbotV2ClientLoop(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SWANBOT_V2_CLIENT_LOOP_FLAG_KEY, ENABLED_VALUE);
    }
  } catch {}
  return true;
}

/**
 * Flip OFF — routes the batch lane back to the `swanbot-v2-ai` edge (today's
 * default). Fail-soft. Returns false. This is the per-device, no-deploy
 * rollback (runbook §7).
 */
export function disableSwanbotV2ClientLoop(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SWANBOT_V2_CLIENT_LOOP_FLAG_KEY, DISABLED_VALUE);
    }
  } catch {}
  return false;
}

/** Toggle; returns the new value. Reads current (fail-soft OFF) then flips —
 *  mirrors `toggleSwanbotV2` (`swanbotRouting.ts:56`). */
export function toggleSwanbotV2ClientLoop(): boolean {
  return isSwanbotV2ClientLoopEnabled()
    ? disableSwanbotV2ClientLoop()
    : enableSwanbotV2ClientLoop();
}
