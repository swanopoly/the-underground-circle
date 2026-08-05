/**
 * openswanSteering — in-memory mid-run steering bus for the OpenSwan typed
 * tool loop (Phase 7b of `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * Computer-use steering rides a DB channel (`computer_use_confirmations`)
 * because that loop runs in an edge function. The OpenSwan typed tool loop
 * runs in-process, so its steering bus is just a module-level Map: the chat
 * surface registers a scope when a turn's tool loop starts, pushes user
 * notes while it runs, and the loop drains them at the next iteration
 * boundary — after tool results, before the next model call.
 *
 * Bounds and model framing are REUSED from `./computerUseSteering`
 * (`normalizeSteeringNote`, `formatSteeringNoteForModel`) so both steering
 * surfaces stay in lockstep — do not duplicate them here.
 *
 * SAFETY: steering notes are guidance only, never consent. The reused
 * framing explicitly tells the model a note is NOT an approval; the typed
 * loop's approval gates (approval floor, HITL confirmations) are untouched
 * by this bus. Scopes are keyed per top-level turn, so subagent/delegated
 * inner loops never see another scope's notes.
 *
 * Dependency-light module — smoke-testable via tsx
 * (`npx tsx scripts/openswan-steering-bus-smoketest.ts`).
 */

import { formatSteeringNoteForModel, normalizeSteeringNote } from './computerUseSteering';

// ─── Bus state ───────────────────────────────────────────────────────────────

/** Bound on queued-but-undrained notes per scope — steering is a nudge stream, not a backlog. */
export const MAX_OPENSWAN_STEERING_QUEUE = 5;

/** scopeKey (one per top-level turn) → normalized notes awaiting the next loop boundary. */
const steeringBus = new Map<string, string[]>();

// ─── Scope lifecycle ─────────────────────────────────────────────────────────

/**
 * Activate a scope with an empty queue. Idempotent; re-registering an active
 * scope clears any stale notes so a new run never inherits old guidance.
 */
export function registerOpenSwanSteeringScope(scopeKey: string): void {
  steeringBus.set(scopeKey, []);
}

/** Deactivate a scope and drop any undrained notes. */
export function unregisterOpenSwanSteeringScope(scopeKey: string): void {
  steeringBus.delete(scopeKey);
}

/** True while a live run owns the scope (register…unregister window). */
export function isOpenSwanSteeringScopeActive(scopeKey: string): boolean {
  return steeringBus.has(scopeKey);
}

// ─── Notes ───────────────────────────────────────────────────────────────────

/**
 * Queue a user note for a live run. Fails when the scope is inactive (no run
 * to steer), the note normalizes to empty, or the queue is at the bound.
 */
export function pushOpenSwanSteeringNote(
  scopeKey: string,
  rawNote: string,
): { ok: true } | { ok: false; error: string } {
  const queue = steeringBus.get(scopeKey);
  if (!queue) return { ok: false, error: 'No live run to steer — send it as a regular message instead.' };
  const normalized = normalizeSteeringNote(rawNote);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  if (queue.length >= MAX_OPENSWAN_STEERING_QUEUE) {
    return { ok: false, error: 'Too many queued notes — let it apply the current ones first.' };
  }
  queue.push(normalized.note);
  return { ok: true };
}

/**
 * Take all queued notes for injection at the loop boundary, already wrapped
 * in the guidance-only model framing (`formatSteeringNoteForModel`). Clears
 * the queue; the scope stays active. `[]` when inactive or empty.
 */
export function drainOpenSwanSteeringNotes(scopeKey: string): string[] {
  const queue = steeringBus.get(scopeKey);
  if (!queue || queue.length === 0) return [];
  const formatted = queue.map((note) => formatSteeringNoteForModel(note));
  queue.length = 0;
  return formatted;
}

/** Queued-note count for UI hinting/tests; 0 when the scope is inactive. */
export function peekOpenSwanSteeringQueueSize(scopeKey: string): number {
  return steeringBus.get(scopeKey)?.length ?? 0;
}
