// chatComposerDraftCore — the PURE draft-preservation brain for the SwanBot chat
// composer.
//
// Finding it fixes: today the composer is a single `const [input, setInput] =
// useState('')` in ChatTab.tsx. When you switch threads the box does NOT change
// (setActiveThreadId only swaps the transcript), so text you typed for thread A
// is still sitting there when you land on thread B — and the moment you type or
// send, A's half-written message is gone. And there is no per-thread memory: come
// back to A later and whatever you had is lost. Navigating away/refresh loses it
// too. The zero-hoop fix is a per-thread draft store: as you type it's stashed
// under the active thread's key, and on every thread switch the OUTGOING draft is
// saved under the thread you're leaving while any saved draft for the thread
// you're entering is RESTORED into the box.
//
// This module is the pure decision + keying half of that store. It does NOT touch
// storage (that's the caller's AsyncStorage/localStorage — see WIRING at the
// bottom); it answers three total questions:
//   • draftKey(...)            → the stable, secret-free per-thread storage key.
//   • shouldPreserveDraft(txt) → is this worth stashing? (non-blank, not huge)
//   • reconcileDraft({...})    → on a thread switch / send, what happens to the
//                                composer box: save / restore / clear / keep.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which CANNOT load
// react-native/supabase): ZERO runtime imports. No Date.now()/Math.random(); no
// top-level side effects. Every export is TOTAL — never throws on any input
// (null/undefined/number/object/huge/hostile/cyclic) and returns a safe neutral
// result. Output is BOUNDED: keys are capped per segment, draft values are capped
// at MAX_DRAFT_LENGTH. SECRET-SAFE: the key is derived only from the opaque ids,
// never from the draft TEXT (which may contain whatever the user typed).

// ── Types ────────────────────────────────────────────────────────────────────

/** The three opaque ids a draft is scoped by. All optional/unknown → tolerated. */
export interface DraftKeyInput {
  /** Circle the chat lives in (ChatTab prop `circleId: string`). */
  circleId?: unknown;
  /** Active thread row id (`activeThreadId: string | null`). */
  threadId?: unknown;
  /** The local user (`currentUserId: string | null`) — scopes shared devices. */
  userId?: unknown;
}

export type DraftAction =
  | 'save' // thread switched, outgoing draft worth keeping, box emptied for the new thread
  | 'restore' // thread switched, the incoming thread had a saved draft → put it in the box
  | 'clear' // box becomes empty and nothing is carried (post-send, or nothing on either side)
  | 'keep'; // no thread switch — leave the composer exactly as the user left it

export interface DraftDecision {
  /** What the composer should do. See DraftAction. */
  action: DraftAction;
  /**
   * The resulting composer text for this decision, ALWAYS bounded:
   *   • restore → the saved incoming draft (what to show).
   *   • save / clear → '' (the box empties).
   *   • keep → a bounded echo of `current`; wiring IGNORES it on 'keep'.
   */
  value: string;
}

export interface ReconcileDraftInput {
  /** Whatever is in the composer right now (belongs to prevThreadId). */
  current?: unknown;
  /** The thread being switched TO. */
  incomingThreadId?: unknown;
  /** The thread being switched FROM. */
  prevThreadId?: unknown;
  /** The previously-saved draft the caller loaded for incomingThreadId. */
  stored?: unknown;
}

// ── Tunables (exported so wiring + smoke share the exact bounds) ─────────────

/** Namespace for the storage key. Matches the repo's `uc_*` key convention. */
export const KEY_PREFIX = 'uc_chat_draft';

/** Max chars kept per key segment — junk armor against a hostile/huge id. */
export const MAX_KEY_SEGMENT = 128;

/**
 * The largest draft we persist / echo. ~4000 words — no human chat message is
 * near this. A composer holding more than this is a pathological paste, not a
 * draft, so it is NOT stashed (shouldPreserveDraft → false) and any echoed value
 * is truncated to this. Aligned with chatSendGuardCore's MAX_REASONABLE_MESSAGE.
 */
export const MAX_DRAFT_LENGTH = 20000;

/** Placeholder for an empty/missing/hostile key segment (never blank). */
const EMPTY_SEGMENT = '_';

// ── Small total helpers ──────────────────────────────────────────────────────

/**
 * Coerce one key part to a safe, stable, bounded token. Only string/number/
 * boolean are stringified; everything else (object/function/symbol/bigint/NaN/
 * ±Infinity) collapses to the placeholder so we never call a hostile toString or
 * leak object shape. The charset is restricted to key-safe chars, which also
 * strips our '::' separator so a segment can never inject extra separators.
 */
function safeSegment(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : EMPTY_SEGMENT;
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else return EMPTY_SEGMENT;

  s = s.trim();
  if (!s) return EMPTY_SEGMENT;
  // Collapse any non key-safe char (including ':', whitespace, control) to '_'.
  s = s.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (s.length > MAX_KEY_SEGMENT) s = s.slice(0, MAX_KEY_SEGMENT);
  return s || EMPTY_SEGMENT;
}

/** True when the value is not a string, or is empty / whitespace-only. */
function isBlank(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  // Avoid allocating a trimmed copy of a megabyte string: scan a bounded window.
  const window = v.length > MAX_DRAFT_LENGTH ? v.slice(0, MAX_DRAFT_LENGTH) : v;
  return window.trim().length === 0 && v.trim().length === 0;
}

/** Coerce to a bounded string (never longer than MAX_DRAFT_LENGTH). */
function boundedText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.length > MAX_DRAFT_LENGTH ? v.slice(0, MAX_DRAFT_LENGTH) : v;
}

/** Canonical thread id for comparison: trimmed string, finite number, else ''. */
function normThreadId(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function decision(action: DraftAction, value: string): DraftDecision {
  // Fresh object each call — a caller mutating one decision cannot poison the next.
  return { action, value };
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Stable, secret-free storage key for one thread's draft. Deterministic: the
 * same ids always produce the same key; different threads produce different
 * keys. Derived ONLY from the opaque circle/thread/user ids — never from the
 * draft text — so no user-typed secret can leak into a key. Total: any hostile
 * input yields a well-formed `uc_chat_draft::<circle>::<thread>::<user>` string.
 */
export function draftKey(input: DraftKeyInput | null | undefined): string {
  try {
    const src = input && typeof input === 'object' ? (input as DraftKeyInput) : {};
    const circle = safeSegment(src.circleId);
    const thread = safeSegment(src.threadId);
    const user = safeSegment(src.userId);
    return `${KEY_PREFIX}::${circle}::${thread}::${user}`;
  } catch {
    return `${KEY_PREFIX}::${EMPTY_SEGMENT}::${EMPTY_SEGMENT}::${EMPTY_SEGMENT}`;
  }
}

/**
 * Is this draft worth stashing? True only for a real string that is non-empty,
 * not whitespace-only, and not pathologically huge (≤ MAX_DRAFT_LENGTH). An
 * empty box (the post-send state, since the send path calls setInput('')) → false,
 * so a sent message is never resurrected. Non-strings / junk → false. Total.
 */
export function shouldPreserveDraft(text: unknown): boolean {
  try {
    if (typeof text !== 'string') return false;
    if (text.length === 0 || text.length > MAX_DRAFT_LENGTH) return false;
    return text.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * The composer decision for a thread switch (or a send/clear). Deterministic,
 * bounded, total. `value` is ALWAYS the resulting composer text.
 *
 *   • NOT a switch (incoming thread === prev thread):
 *       - box non-empty  → 'keep'  (leave the user's typing alone; value echoes it)
 *       - box empty      → 'clear' (nothing there — e.g. right after a send)
 *   • A real switch (incoming thread !== prev thread):
 *       - incoming thread has a preservable saved draft → 'restore' (value = it)
 *       - else, outgoing box has a preservable draft     → 'save'  (value = '';
 *              the caller stashes the outgoing draft under prevThread, box empties)
 *       - else                                           → 'clear' (value = '')
 *
 * Any doubt / hostile input / internal error → a safe 'clear' with ''.
 */
export function reconcileDraft(input: ReconcileDraftInput | null | undefined): DraftDecision {
  try {
    const src = input && typeof input === 'object' ? (input as ReconcileDraftInput) : {};
    const current = src.current;
    const stored = src.stored;
    const switched = normThreadId(src.prevThreadId) !== normThreadId(src.incomingThreadId);

    if (!switched) {
      // Same thread (re-render, or a send that already emptied the box). Never
      // disturb text the user is actively typing here — even an over-cap paste.
      return isBlank(current) ? decision('clear', '') : decision('keep', boundedText(current));
    }

    // Real thread switch. Restoring the destination's saved draft wins.
    if (shouldPreserveDraft(stored)) return decision('restore', boundedText(stored));
    // Nothing to restore; if the outgoing box is worth keeping, signal 'save' so
    // the caller stashes it under prevThread. The box empties for the new thread.
    if (shouldPreserveDraft(current)) return decision('save', '');
    // Nothing on either side.
    return decision('clear', '');
  } catch {
    return decision('clear', '');
  }
}

// ── WIRING (report-only; no code here reaches into ChatTab) ──────────────────
//
// In src/screens/circles/tabs/ChatTab.tsx:
//
//   // (a) onChangeText — stash the live draft under the active thread.
//   const handleInputChange = (text: string) => {
//     setInput(text);
//     const key = draftKey({ circleId, threadId: activeThreadId, userId: currentUserId });
//     if (shouldPreserveDraft(text)) storage.setItem(key, text.slice(0, MAX_DRAFT_LENGTH));
//     else storage.removeItem(key);
//     ...existing mention/slash logic...
//   };
//
//   // (b) thread-switch effect (prevThreadId → activeThreadId). On switch:
//   const outKey = draftKey({ circleId, threadId: prevThreadId, userId: currentUserId });
//   const cur = input;                       // outgoing text
//   if (shouldPreserveDraft(cur)) storage.setItem(outKey, cur.slice(0, MAX_DRAFT_LENGTH));
//   else storage.removeItem(outKey);
//   const inKey  = draftKey({ circleId, threadId: activeThreadId, userId: currentUserId });
//   const stored = await storage.getItem(inKey);
//   const d = reconcileDraft({ current: cur, incomingThreadId: activeThreadId,
//                             prevThreadId, stored });
//   if (d.action !== 'keep') setInput(d.value); // restore fills the box; save/clear empty it
//   if (d.action === 'restore') storage.removeItem(inKey); // draft consumed
//
// Result: typed-but-unsent text survives thread switches and navigation, and each
// thread remembers its own in-progress draft — with zero extra taps.
