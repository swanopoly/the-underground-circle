/**
 * clarifyTimeout — CA-8e. Gives the `ask_user` / HITL confirmation
 * flow a deterministic deadline. Without this the agent can hang
 * forever if the user wanders off mid-prompt.
 *
 * Contract:
 *   - Default timeout: 120_000ms (2 min) — same default Hermes ships.
 *   - On timeout: the row is auto-resolved with `{ choice:
 *     '__timeout__', resolved_at: now }`. The edge function's poller
 *     sees the row is resolved and resumes the agent, which reads
 *     `__timeout__` and falls back to its default behavior (documented
 *     in the agent prompt).
 *   - `planClarifyTimeout(...)` is a pure helper returning the remaining
 *     ms + expiry state. Client UI uses it to render a countdown,
 *     edge fn uses it to decide when to auto-resolve. Keeping it pure
 *     means both sides use the same clock arithmetic and smoke tests
 *     can pin behavior without a live Supabase.
 */

export const DEFAULT_CLARIFY_TIMEOUT_MS = 120_000;
export const MIN_CLARIFY_TIMEOUT_MS = 15_000;   // 15s — less than this isn't a useful confirmation
export const MAX_CLARIFY_TIMEOUT_MS = 3_600_000; // 1 hour — past this, just ask again later

export interface ClarifyTimeoutPlan {
  /** Absolute epoch-ms when the row should auto-resolve to `__timeout__`. */
  expiresAtMs: number;
  /** ms remaining until expiry. Never negative — `0` means expired. */
  msUntilExpiry: number;
  /** True when the current clock is at or past expiry. */
  expired: boolean;
  /** True when we're in the last 15s — callers may want to highlight the
   *  countdown urgently. */
  urgent: boolean;
  /** 0..1. Fraction of the timeout that has elapsed. Clamped to [0,1]. */
  elapsedFraction: number;
}

export interface PlanClarifyTimeoutInput {
  /** When the confirmation row was created. ISO string or epoch ms. */
  createdAt: string | number | Date;
  /** Desired timeout in ms. Defaults to 120_000. Clamped to [15_000, 3_600_000]. */
  timeoutMs?: number;
  /** Injectable clock for tests. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * Compute the timeout state for a pending confirmation row.
 * Kept pure — no Supabase, no timers. Callers build countdown UI /
 * schedule auto-resolves on top of this.
 */
export function planClarifyTimeout(input: PlanClarifyTimeoutInput): ClarifyTimeoutPlan {
  const now = typeof input.now === 'number' ? input.now : Date.now();
  const createdMs = toMs(input.createdAt);
  const timeoutMs = clampTimeout(input.timeoutMs);

  const expiresAtMs = createdMs + timeoutMs;
  const msUntilExpiry = Math.max(0, expiresAtMs - now);
  const expired = msUntilExpiry === 0;
  const urgent = !expired && msUntilExpiry <= 15_000;
  const elapsed = Math.min(Math.max(now - createdMs, 0), timeoutMs);
  const elapsedFraction = timeoutMs > 0 ? elapsed / timeoutMs : 1;

  return { expiresAtMs, msUntilExpiry, expired, urgent, elapsedFraction };
}

/**
 * Render a human-readable countdown like "1m 23s" / "18s" / "auto-continuing…".
 * Shared between the HITL banner and any chat-inline prompt so the UX stays
 * consistent regardless of where the agent stopped to ask.
 */
export function formatCountdown(msRemaining: number): string {
  const clamped = Math.max(0, Math.floor(msRemaining / 1000));
  if (clamped <= 0) return 'auto-continuing…';
  if (clamped < 60) return `${clamped}s`;
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Explicitly mark a confirmation row as timed-out. Uses the same
 * UPDATE path as resolveComputerUseConfirmation so the edge-fn poller
 * picks it up identically. Safe to call defensively — the `.is('resolved_at', null)`
 * clause guarantees we never overwrite a real human response that just
 * landed a millisecond before the timer.
 *
 * Returns `{ ok: true, alreadyResolved: true }` when the row was
 * already resolved by the user, so callers can distinguish timeouts
 * that actually fired from cancellations.
 */
export async function autoResolveOnTimeout(
  id: string,
  options: { supabase: any; defaultChoice?: string } = { supabase: null },
): Promise<{ ok: boolean; alreadyResolved?: boolean; error?: string }> {
  if (!id) return { ok: false, error: 'id required' };
  if (!options.supabase) return { ok: false, error: 'supabase client required' };
  const choice = options.defaultChoice || '__timeout__';
  try {
    const { data, error } = await options.supabase
      .from('computer_use_confirmations')
      .update({
        choice,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
      .is('resolved_at', null)
      .select('id');
    if (error) return { ok: false, error: error.message };
    // Empty rows array = someone else resolved between our check and
    // our write. Treat as success-but-cancelled.
    const alreadyResolved = !Array.isArray(data) || data.length === 0;
    return { ok: true, alreadyResolved };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'auto-resolve threw' };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function clampTimeout(ms: number | undefined): number {
  const base = typeof ms === 'number' && Number.isFinite(ms) ? ms : DEFAULT_CLARIFY_TIMEOUT_MS;
  return Math.max(MIN_CLARIFY_TIMEOUT_MS, Math.min(MAX_CLARIFY_TIMEOUT_MS, base));
}

function toMs(input: string | number | Date): number {
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
