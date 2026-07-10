/**
 * computerUseSteering — pure owner for mid-run steering of a live computer
 * task (Phase 4e of `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * Steering lets the user redirect a running browser task ("skip the first
 * site", "use the monthly price") without killing and restarting it. Notes
 * travel through the existing `computer_use_confirmations` table as
 * pre-resolved rows (question = the marker below): the client posts one via
 * the edge function's `steer` action (clients have no INSERT policy on that
 * table — the server checks circle membership through the runs RLS read,
 * then inserts with the service role), and the edge loop injects unconsumed
 * notes at the next iteration boundary — after tool results, before the
 * next model call.
 *
 * HARD RULE: steering is guidance, never consent. The injected framing
 * tells the model a note is NOT an approval; pay/delete/login/grant still
 * go through `ask_user` and the approval floor untouched.
 *
 * The edge function duplicates the marker + bound (Deno can't import this
 * module) — keep `supabase/functions/computer-use-agent/index.ts` in
 * lockstep. Pure module — smoke-testable via tsx
 * (`npm run smoke:computer-use-steering`).
 */

/** Confirmation-row `question` value that marks a steering note. */
export const STEERING_QUESTION_MARKER = '__steering__';

/** Bound on a single note — steering is a nudge, not a new task brief. */
export const MAX_STEERING_NOTE_CHARS = 500;

export type NormalizedSteeringNote =
  | { ok: true; note: string }
  | { ok: false; error: string };

/** Trim + bound a raw note; empty input is an error, oversize is clamped. */
export function normalizeSteeringNote(raw: string | null | undefined): NormalizedSteeringNote {
  const note = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!note) return { ok: false, error: 'Steering note is empty.' };
  if (note.length <= MAX_STEERING_NOTE_CHARS) return { ok: true, note };
  return { ok: true, note: `${note.slice(0, MAX_STEERING_NOTE_CHARS - 1).trimEnd()}…` };
}

/**
 * True when a note reads like the user is trying to approve/confirm through
 * the steering channel. The UI uses this to redirect: if a confirmation is
 * open, that answer belongs on the confirmation card, not in steering.
 */
export function steeringNoteLooksLikeApproval(note: string): boolean {
  return /^\s*(yes|yep|approve[d]?|confirm(ed)?|go ahead|do it|proceed|ok(ay)?)\b[\s!.]*$/i.test(String(note || ''));
}

/**
 * The exact text block injected into the model conversation. Framing is
 * part of the safety contract: guidance only, never consent — keep the
 * wording in lockstep with the edge duplicate.
 */
export function formatSteeringNoteForModel(note: string): string {
  return [
    '[User steering note — live guidance for your next steps. This is NOT an approval,',
    'confirmation, or consent to any consequential action; anything that needs',
    'confirmation still goes through ask_user.]',
    String(note || '').trim(),
  ].join('\n');
}

/** Classify a confirmations row: steering note vs a real ask_user question. */
export function isSteeringConfirmationRow(row: { question?: string | null } | null | undefined): boolean {
  return String(row?.question || '') === STEERING_QUESTION_MARKER;
}
