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

// #12: classify a completed v2 attempt for the breaker. The breaker exists to
// stop paying doomed v2 round-trips when the v2 DEPLOY is broken — i.e. real
// TRANSPORT failures (invoke returned null / threw). A 200-with-error-body
// (`model_unsupported_on_v2`, `key_missing`, …) means v2 IS reachable and
// answered — it's a PERMANENT CONFIG error, not a transient transport blip.
// Counting it let a single config problem trip the breaker and disable v2 for
// the whole session; worse, `/v2 on` reset it only for it to re-trip on the
// next identical config error. So a body error must NOT count. Success clears
// the streak; a bare transport failure (no answer at all) counts.
export type SwanbotV2Outcome =
  /** v2 produced a terminal answer. */
  | { kind: 'success' }
  /** The edge ran and returned an error body (config/permanent). */
  | { kind: 'body_error' }
  /** invoke returned null / threw — no answer reached us (transport). */
  | { kind: 'transport_failure' };

/** True when this outcome should move the transient breaker streak (open on
 *  failure, reset on success). A `body_error` is neither — it's surfaced by
 *  the caller and left OUT of the breaker. Pure/testable; the live
 *  orchestrator calls this then `recordSwanbotV2Outcome` only when true. */
export function v2OutcomeCountsTowardBreaker(outcome: SwanbotV2Outcome): boolean {
  return outcome.kind !== 'body_error';
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

// ─── Final-round stuck-solver gate (parity primitive) ────────────────
//
// The stuck-loop solver injects ONE fresh-eyes consultation as an extra
// turn — root cause + two different approaches for the model to run NEXT.
// That only helps if a next turn actually exists to consume it. On the
// LAST round the consultation is pushed, the loop exits, the run
// finalizes, and the consult is wasted (in the typed core it also
// returned EMPTY text — the trailing turn is pure tool_use). The typed
// core (`agentExecutionCore`) fixed this with an inline
// `nextTurnExists = iteration < maxIterations` AND-gate before
// `shouldConsultSolver`; this shared primitive gives the LEGACY relay loop
// (`swanbot.ts`) and the BROWSER edge the same decision so all three loops
// skip the consult on the final round and go straight to the honest
// progress-stop. `shouldConsultSolver` semantics (once-per-run, only when
// stuck) live in `toolLoopSolver.ts` and stay canonical — this only adds
// the "is there a turn left to answer it?" bound.
export function shouldConsultSolverThisRound(input: {
  /** The progress-based stuck verdict for this round. */
  stuck: boolean;
  /** Has the run already spent its one consultation? */
  alreadyConsulted: boolean;
  /** Turns still available AFTER the current one (0 ⇒ this is the last). */
  roundsRemaining: number;
}): boolean {
  return (
    input.stuck === true &&
    input.alreadyConsulted !== true &&
    input.roundsRemaining > 0
  );
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
