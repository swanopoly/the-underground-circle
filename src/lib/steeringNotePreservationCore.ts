/**
 * steeringNotePreservationCore — per-thread parking lot for mid-run steering
 * notes that the live bus DROPPED (steering opt v7).
 *
 * The OpenSwan steering bus (`openswanSteering.ts`) only accepts a note while a
 * run owns the thread's scope: `pushOpenSwanSteeringNote` returns
 * "No live run to steer" when the scope is inactive — either no run is running
 * or the run just ended between the user typing and pressing send. The chat UI
 * still shows a "Sent — applies at next step" ack, so that guidance vanishes
 * silently. This module is where a dropped note goes instead: the caller parks
 * it here on a drop, and the next turn drains it and prepends it to the outgoing
 * message so the user's guidance is never lost.
 *
 * Storage model mirrors `agentTodoStore.ts`: a module-level Map keyed per thread,
 * in-memory only and deliberately ephemeral (a reload starts blank). It is
 * bounded on every axis — most-recent notes per thread, note length, key length,
 * and an LRU cap on tracked threads — so a hostile or forgetful caller can never
 * grow it without limit.
 *
 * PURITY: zero imports, no module-scope Date.now()/Math.random(); every export is
 * TOTAL (any null/undefined/wrong/huge/hostile/cyclic input yields a safe neutral
 * result and never throws). Secret-safe: notes are held in memory and never
 * logged here. Smoke-testable via tsx
 * (`npx tsx scripts/steering-note-preservation-core-smoketest.ts`).
 */

// ─── Bounds ────────────────────────────────────────────────────────────────

/**
 * Most-recent unapplied notes kept per thread. Mirrors
 * `MAX_OPENSWAN_STEERING_QUEUE` (5) in spirit: steering is a nudge stream, not a
 * backlog, so an over-eager sender keeps only the last few, oldest dropped.
 */
export const MAX_UNAPPLIED_STEERING_NOTES = 5;

/** Upper bound on a single preserved note; hostile/huge input is clamped. */
const MAX_UNAPPLIED_NOTE_CHARS = 2000;

/** Upper bound on a thread key so a hostile id can't bloat the Map key. */
const MAX_THREAD_KEY_CHARS = 200;

/** LRU cap on distinct tracked threads — stale threads are evicted oldest-first. */
const MAX_TRACKED_THREADS = 50;

// ─── State ─────────────────────────────────────────────────────────────────

/** threadKey → notes dropped by the live bus, awaiting the next turn. */
const store = new Map<string, string[]>();

// ─── Normalization (total, never throws) ─────────────────────────────────────

/** A valid thread key, or null when the id is empty/garbage (→ neutral no-op). */
function normalizeThreadKey(threadId: unknown): string | null {
  if (typeof threadId === 'string') {
    const trimmed = threadId.trim();
    if (!trimmed) return null;
    return trimmed.length > MAX_THREAD_KEY_CHARS ? trimmed.slice(0, MAX_THREAD_KEY_CHARS) : trimmed;
  }
  // Defensive: a numeric id is coerced to a namespaced key so number 5 and the
  // string "5" never collide. Everything else (object/array/symbol/bool/null…)
  // is not a thread and yields null → the call becomes a safe no-op.
  if (typeof threadId === 'number' && Number.isFinite(threadId)) return `n:${threadId}`;
  if (typeof threadId === 'bigint') return `n:${threadId.toString()}`;
  return null;
}

/** A cleaned note, or null when it's not usable text (→ skip, never store noise). */
function normalizeNote(note: unknown): string | null {
  // Only strings are meaningful steering text; anything else is dropped so the
  // next turn never gets "[object Object]"/cyclic/symbol noise prepended.
  if (typeof note !== 'string') return null;
  const trimmed = note.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (trimmed.length <= MAX_UNAPPLIED_NOTE_CHARS) return trimmed;
  return `${trimmed.slice(0, MAX_UNAPPLIED_NOTE_CHARS - 1).trimEnd()}…`;
}

// ─── API ───────────────────────────────────────────────────────────────────

/**
 * Park a note the live steering bus could not apply. No-op when the thread id
 * or note is unusable. Keeps the most-recent `MAX_UNAPPLIED_STEERING_NOTES`
 * (oldest dropped) and refreshes the thread's LRU position; distinct threads are
 * isolated and total threads are capped.
 */
export function preserveUnappliedNote(threadId: unknown, note: unknown): void {
  const key = normalizeThreadKey(threadId);
  if (key === null) return;
  const cleaned = normalizeNote(note);
  if (cleaned === null) return;

  const bucket = store.get(key) ?? [];
  bucket.push(cleaned);
  while (bucket.length > MAX_UNAPPLIED_STEERING_NOTES) bucket.shift();

  // Re-set to refresh LRU order, then evict the oldest threads past the cap.
  store.delete(key);
  store.set(key, bucket);
  while (store.size > MAX_TRACKED_THREADS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Drain a thread's parked notes for the next turn (chronological, oldest first)
 * and clear the bucket so they apply exactly once. `[]` when the id is unusable
 * or nothing is parked. The returned array is detached — mutating it is safe.
 */
export function takeUnappliedNotes(threadId: unknown): string[] {
  const key = normalizeThreadKey(threadId);
  if (key === null) return [];
  const bucket = store.get(key);
  if (!bucket || bucket.length === 0) {
    if (bucket) store.delete(key);
    return [];
  }
  store.delete(key);
  return bucket.slice();
}

/** True when a thread has parked notes awaiting the next turn. */
export function hasUnappliedNotes(threadId: unknown): boolean {
  const key = normalizeThreadKey(threadId);
  if (key === null) return false;
  const bucket = store.get(key);
  return !!bucket && bucket.length > 0;
}

/**
 * Clear parked notes. With no argument (or an explicit `undefined`) clears every
 * thread — a global reset for teardown/tests. With a thread id clears just that
 * thread; a garbage id is a safe no-op and never clears everything.
 */
export function clearUnappliedNotes(threadId?: unknown): void {
  if (threadId === undefined) {
    store.clear();
    return;
  }
  const key = normalizeThreadKey(threadId);
  if (key === null) return;
  store.delete(key);
}
