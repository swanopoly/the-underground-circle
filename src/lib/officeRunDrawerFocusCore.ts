/**
 * officeRunDrawerFocusCore — tiny pure seam between Office's blocked-run
 * attention items (ChatAttentionItem.refId carries the run id for
 * `open_run` actions) and RunHistoryDrawer's optional `initialRunId` prop.
 *
 * The drawer loads its own first page of runs; a deep-link is only honored
 * when the referenced run is actually present in that loaded page, so this
 * core resolves {refId, availableRunIds} → the run id the drawer should
 * focus, or null with a reason the caller can log/ignore.
 *
 * Purity: zero imports, total on any input, never throws.
 */

export type RunDrawerFocusReason = 'focused' | 'no_ref' | 'not_loaded';

export interface RunDrawerFocusInput {
  /** Attention item refId (may be null/undefined/non-string). */
  refId?: unknown;
  /** Ids of the runs currently loaded in the drawer's first page. */
  availableRunIds?: unknown;
}

export interface RunDrawerFocusResult {
  /** The run id to pass as initialRunId, or null to keep default selection. */
  focusRunId: string | null;
  reason: RunDrawerFocusReason;
}

/**
 * Resolve a run-drawer deep-link target.
 *
 * - refId missing/empty/non-string → {null, 'no_ref'} (default selection).
 * - refId present but not in availableRunIds (or the list is missing/not an
 *   array) → {null, 'not_loaded'} — the drawer keeps its default first-run
 *   selection rather than fighting over a run it can't show.
 * - refId present and loaded → {refId, 'focused'}.
 */
export function resolveRunDrawerFocus(input?: RunDrawerFocusInput): RunDrawerFocusResult {
  const rec: Record<string, unknown> =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const refId = typeof rec.refId === 'string' ? rec.refId.trim() : '';
  if (!refId) return { focusRunId: null, reason: 'no_ref' };

  const ids = Array.isArray(rec.availableRunIds) ? rec.availableRunIds : [];
  for (const id of ids) {
    if (typeof id === 'string' && id === refId) {
      return { focusRunId: refId, reason: 'focused' };
    }
  }
  return { focusRunId: null, reason: 'not_loaded' };
}
