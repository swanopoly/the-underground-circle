/**
 * deterministicReobserve — after a UI action fails in the tool loop, the loop
 * deterministically captures fresh ground truth (a read-only observation) and
 * embeds it in the failed action's result, so the model's retry is grounded in
 * current state instead of stale assumptions — without spending a model round
 * to request the observation itself.
 *
 * Why observe rather than auto-execute the next *action* surface: escalating
 * e.g. desktop.click_element → desktop.menu_click needs a menu path,
 * desktop.click_at needs coordinates, desktop.press_keys needs the shortcut —
 * inputs the loop can't synthesize; only the model can, from the observation.
 * Auto-invoking an action with guessed input would be more failure-prone, not
 * less. So the deterministic layer guarantees the observation; the model still
 * chooses the next action surface (guided by the named-ladder stuck-breaker).
 *
 * Works per surface: a failed desktop action re-reads the a11y tree, a failed
 * browser action re-reads the DOM snapshot (see observationToolForFailedAction).
 * Read-only, so it needs no approval and is gated to non-review mode by the
 * caller. Pure + side-effect free → smoke testable.
 */

import { observationToolForFailedAction } from './appSurfaceLadder';

function isFailureStatus(status: string | null | undefined): boolean {
  return /\b(error|fail|failed|failure|blocked|denied|timeout)\b/i.test(String(status || ''));
}

export interface ReobservePlan {
  /** The read-only tool to run to refresh ground truth before the model retries. */
  observationTool: string;
}

/**
 * When a UI action fails, the read that refreshes ground truth for the retry —
 * or null when the tool isn't a UI action (no ladder) or didn't actually fail.
 * Only desktop UI-action tools have a ladder, so only they trigger re-observe.
 */
export function planDeterministicReobserve(
  toolName: string,
  status: string | null | undefined,
): ReobservePlan | null {
  if (!isFailureStatus(status)) return null;
  // Per-surface: a11y tree for desktop, DOM snapshot for browser; null for
  // non-UI-action tools (they have no ladder, so nothing to re-observe).
  const observationTool = observationToolForFailedAction(toolName);
  if (!observationTool) return null;
  return { observationTool };
}

/**
 * Bounded, model-facing note carrying the freshly-observed state, appended to
 * the failed action's tool_result. Returns '' when the observation itself
 * failed or was empty (so the caller appends nothing and falls back to the
 * stuck-breaker's "re-observe" nudge).
 */
export function summarizeObservationForRetry(
  resultText: string | null | undefined,
  status: string | null | undefined,
  opts: { maxChars?: number } = {},
): string {
  if (isFailureStatus(status)) return '';
  const raw = String(resultText || '').trim();
  if (!raw) return '';
  const maxChars = Math.max(200, opts.maxChars ?? 1400);
  let body = raw;
  try {
    const parsed = JSON.parse(raw);
    const data = (parsed && typeof parsed === 'object' && 'data' in parsed) ? (parsed as any).data : parsed;
    if (data && typeof data.text === 'string' && data.text.trim()) {
      body = data.text.trim();
    } else if (data && typeof data === 'object') {
      body = JSON.stringify(data);
    }
  } catch { /* not JSON — use the raw text */ }
  if (!body.trim()) return '';
  const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}\n…(truncated)` : body;
  return `\n\n[auto-observed current state — use this for your retry instead of re-deriving]\n${clipped}`;
}
