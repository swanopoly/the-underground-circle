/**
 * proactiveSurfacingSignals — the PURE adapter layer between the app's
 * existing trouble sources and `proactiveSurfacingCore` (the anti-nag
 * speak/silent decision brain). It owns three conversions:
 *
 *   1. `deriveSnapshotSurfacingSignals` — turns a `circleContextSnapshot`
 *      into candidate signals: recentRuns in status failed/error become
 *      `failed_run`; missions in a troubled status become `stalled_mission`.
 *      The `overdue_task` / `expiring_credential` kinds stay DORMANT here:
 *      the snapshot carries no due/expiry timestamps, and faking them from
 *      status strings would manufacture false urgency.
 *   2. `attentionItemsToSurfacingSignals` — folds live chatAttentionQueue
 *      items (pending/expiring approvals, human-blocked runs) in as
 *      `blocked_approval` signals so the prompt heads-up and the "Needs you"
 *      strip agree about what is waiting on the user.
 *   3. `renderProactiveSurfacingBody` — renders a core decision into the
 *      prompt-section body: the note + one `title — reason` line per surfaced
 *      signal INSIDE the canonical `<untrusted_quoted>` fence (titles are
 *      member-authored), and the trusted behavior instruction OUTSIDE the
 *      fence — the same data-inside/guidance-outside shape as the Active
 *      Missions block in swanbot.ts. Null when the decision is silent.
 *
 * Purity: type-only imports from every app module; the single runtime import
 * is the dependency-free `untrustedContent` helper (same pattern as
 * chatAttentionQueue's runtime import of approvalPreviewCore), so this module
 * loads under tsx (`scripts/proactive-surfacing-signals-smoketest.ts`).
 * Deterministic: `nowMs` is always an input. Total: null / malformed input
 * degrades to `[]` / null, never a throw. All output flows through
 * `selectProactiveSurfacings`, which sanitizes/bounds every string.
 */

import type { CircleContextSnapshot } from './circleContextSnapshot';
import type { ChatAttentionItem } from './chatAttentionQueue';
import type { ProactiveSurfacingDecision, SurfacingSignal } from './proactiveSurfacingCore';
import { wrapUntrusted } from './untrustedContent';

// ─── Bounds ──────────────────────────────────────────────────────────────────

/** Hard cap on attention items scanned (the core re-caps at MAX_SIGNALS). */
export const MAX_ATTENTION_ITEMS = 50;

/** Mission statuses treated as "in trouble" (status-gated; no timestamps). */
export const STALLED_MISSION_STATUSES: ReadonlySet<string> = new Set([
  'blocked',
  'stalled',
  'at_risk',
  'overdue',
]);

/** Run statuses treated as failed-and-unresolved. */
export const FAILED_RUN_STATUSES: ReadonlySet<string> = new Set(['failed', 'error']);

/** Attention kinds that fold in as `blocked_approval` signals. */
export const BLOCKED_APPROVAL_ATTENTION_KINDS: ReadonlySet<string> = new Set([
  'approval_pending',
  'approval_expiring',
  'run_blocked',
]);

// ─── Snapshot → signals ──────────────────────────────────────────────────────

function normStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function finiteMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Derive candidate surfacing signals from a circle context snapshot.
 * `nowMs` bounds `sinceMs` (a clock-skewed future timestamp counts as "just
 * now" instead of silently dropping time pressure). Total: any malformed
 * snapshot yields `[]`.
 */
export function deriveSnapshotSurfacingSignals(
  snapshot: CircleContextSnapshot | null | undefined,
  nowMs: number,
): SurfacingSignal[] {
  const out: SurfacingSignal[] = [];
  try {
    const sections = snapshot?.sections;
    if (!sections || typeof sections !== 'object') return out;
    const now = Number.isFinite(nowMs) ? nowMs : 0;

    const runs = Array.isArray(sections.recentRuns) ? sections.recentRuns : [];
    for (const run of runs) {
      if (!run || typeof run !== 'object') continue;
      if (!FAILED_RUN_STATUSES.has(normStatus(run.status))) continue;
      const parsedAt = Date.parse(String(run.atIso || ''));
      out.push({
        kind: 'failed_run',
        title: String(run.title || ''),
        entityId: run.id ? String(run.id) : null,
        surface: 'office',
        sinceMs: Number.isFinite(parsedAt) ? Math.min(parsedAt, now) : null,
      });
    }

    const missions = Array.isArray(sections.missions) ? sections.missions : [];
    for (const mission of missions) {
      if (!mission || typeof mission !== 'object') continue;
      if (!STALLED_MISSION_STATUSES.has(normStatus(mission.status))) continue;
      // Status-gated only: snapshot missions carry no timestamps, so no
      // sinceMs/expiresAtMs is fabricated — the kind's base severity decides.
      out.push({
        kind: 'stalled_mission',
        title: String(mission.title || ''),
        entityId: mission.id ? String(mission.id) : null,
        surface: 'feed',
      });
    }
  } catch {
    /* total: malformed snapshot → whatever was gathered so far */
  }
  return out;
}

// ─── Attention items → signals ───────────────────────────────────────────────

/**
 * Fold live chatAttentionQueue items into `blocked_approval` candidate
 * signals. Only `approval_pending` / `approval_expiring` / `run_blocked`
 * qualify — expired approvals, parked clarifications, task questions, and
 * recovery choices already have their own visible surfaces and would be
 * double-nagging. Total: malformed items are skipped.
 */
export function attentionItemsToSurfacingSignals(
  items: ReadonlyArray<ChatAttentionItem> | null | undefined,
  nowMs: number,
): SurfacingSignal[] {
  const out: SurfacingSignal[] = [];
  try {
    if (!Array.isArray(items)) return out;
    const now = Number.isFinite(nowMs) ? nowMs : 0;
    for (const item of items.slice(0, MAX_ATTENTION_ITEMS)) {
      if (!item || typeof item !== 'object') continue;
      if (!BLOCKED_APPROVAL_ATTENTION_KINDS.has(String(item.kind || ''))) continue;
      const waitingMs = finiteMs(item.waitingMs);
      out.push({
        key: item.id ? String(item.id) : null,
        kind: 'blocked_approval',
        title: String(item.title || ''),
        entityId: item.refId ? String(item.refId) : null,
        surface: 'chat',
        expiresAtMs: finiteMs(item.expiresAt),
        sinceMs: waitingMs !== null ? now - Math.max(0, waitingMs) : null,
      });
    }
  } catch {
    /* total */
  }
  return out;
}

// ─── Decision → prompt-section body ──────────────────────────────────────────

/**
 * The one trusted behavior line, kept OUTSIDE the untrusted fence so the
 * model treats it as an instruction (fenced content is data-only by
 * contract).
 */
export const PROACTIVE_SURFACING_INSTRUCTION =
  'Open your reply with one short sentence flagging the item(s) above before handling the user\'s message. '
  + 'Skip the flag if the user just addressed it or told you to drop it — never re-raise a heads-up the user has acknowledged.';

/**
 * Render a core decision into the `proactive_surfacing` section body:
 * fenced note + `title — reason` lines (member-authored titles are untrusted
 * data), then the trusted instruction line outside the fence. Returns null
 * when the decision is silent (`note` null / nothing surfaced) so callers
 * can skip the section entirely.
 */
export function renderProactiveSurfacingBody(
  decision: ProactiveSurfacingDecision | null | undefined,
): string | null {
  try {
    if (!decision || typeof decision !== 'object') return null;
    if (!decision.note || typeof decision.note !== 'string') return null;
    const surfaced = Array.isArray(decision.surface) ? decision.surface : [];
    if (surfaced.length === 0) return null;
    const dataLines: string[] = [decision.note];
    for (const s of surfaced) {
      if (!s || typeof s !== 'object') continue;
      dataLines.push(`- ${String(s.title || '(untitled)')} — ${String(s.reason || 'needs attention')}`);
    }
    const fenced = wrapUntrusted(dataLines.join('\n'));
    if (!fenced) return null;
    return `${fenced}\n${PROACTIVE_SURFACING_INSTRUCTION}`;
  } catch {
    return null;
  }
}
