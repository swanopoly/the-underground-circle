/**
 * chatGapFill — recall-before-ask.
 *
 * When the planner decides a request is underspecified (an `ask_clarification`
 * plan), we should not blindly fire the question. First, gather what we already
 * know — the user's stored memory and the recent thread — so the clarifying
 * question is informed ("I see you're working on X — for this task, what's the
 * title?") and so we never ask for something the conversation already answered.
 *
 * This helper is deliberately conservative: it NEVER fabricates a value for a
 * missing field. It only surfaces context that is clearly present and decides
 * which params are still genuinely worth asking about.
 */

import type { ChatAutomationClarification } from './chatAutomationPlanner';

export type GapFillResult = {
  /** Params still genuinely missing — what to actually ask the user for. */
  stillMissing: string[];
  /** A short "context I already have" line to prepend to the question, or null. */
  contextNote: string | null;
  /** True when stored user memory contributed to the note. */
  usedMemory: boolean;
  /** True when the message points back at recent thread context. */
  usedRecentContext: boolean;
};

// Phrases that signal the user is referring to something said earlier
// ("the task we just made", "same as before") rather than giving a new value.
const BACK_REFERENCE_RE =
  /\b(that|those|the same|same as before|we just|just made|earlier|above|previous|last one|like before)\b/i;

export async function recallForClarification(opts: {
  circleId: string;
  userId: string;
  message: string;
  recentMessages?: string[];
  gap: Pick<ChatAutomationClarification, 'missingParams'>;
}): Promise<GapFillResult> {
  const recentText = (opts.recentMessages || []).filter(Boolean).join('\n').trim();

  let memoryNote: string | null = null;
  if (opts.userId && opts.circleId) {
    try {
      // Lazy-load so this module's top level stays free of the Supabase/RN
      // client — keeps the pure reconstruct helper importable from Node tooling.
      const { loadUserMemory } = await import('./userMemory');
      const mem = await loadUserMemory(opts.userId, opts.circleId);
      const combined = (mem.combined || '').trim();
      if (combined) {
        // Drop the [USER GLOBAL] / [USER IN THIS CIRCLE] section labels and
        // take the first meaningful line as a compact context hint.
        const firstMeaningful = combined
          .split('\n')
          .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
          .find(Boolean);
        if (firstMeaningful) memoryNote = firstMeaningful.slice(0, 160);
      }
    } catch {
      // Memory is best-effort — its absence just means we ask without a note.
    }
  }

  const usedRecentContext = BACK_REFERENCE_RE.test(opts.message) && recentText.length > 0;

  const noteBits: string[] = [];
  if (memoryNote) noteBits.push(`For context, I have on file: “${memoryNote}”.`);
  if (usedRecentContext) {
    noteBits.push(
      'If you mean something from our recent messages, just point me at it and I’ll use that.',
    );
  }

  return {
    // We never auto-fill the actual missing value, so the ask covers the same
    // params — but enriched with whatever context we surfaced above.
    stillMissing: opts.gap.missingParams,
    contextNote: noteBits.length ? noteBits.join(' ') : null,
    usedMemory: !!memoryNote,
    usedRecentContext,
  };
}

/**
 * Closes the clarification loop: given the intent we paused on and the user's
 * reply, reconstruct a well-specified message that can be routed normally to
 * actually complete the task. Returns null when there's nothing usable to build
 * (caller should then just treat the reply as a fresh message).
 *
 * The reconstructions are shaped so they will NOT re-trigger clarification —
 * each carries enough content to pass the planner's underspecification check.
 */
export function reconstructClarificationAnswer(
  pendingIntent: string | null | undefined,
  originalMessage: string,
  answer: string,
): string | null {
  const a = answer.trim();
  if (!a) return null;
  switch (pendingIntent) {
    case 'create_task':
      // Route via the deterministic /task slash command. Slash routing has top
      // priority, so a reply containing action words ("fix the login bug")
      // can't be hijacked by the computer-task router that runs before
      // conversational-intent detection — the user asked to TRACK a task, not
      // execute one.
      return a.startsWith('/') ? a : `/task new ${a}`;
    case 'generate_image':
      return /^(generate|create|make|draw|design)\b/i.test(a) ? a : `generate an image of ${a}`;
    case 'wordpress_publish':
      return `publish to wordpress: ${a}`;
    case 'wordpress_schedule':
      return `schedule a wordpress post: ${a}`;
    case 'office_agent_task':
      // The reply names the agent; keep the original task reference.
      return `${originalMessage} (assign agent named ${a})`;
    default:
      // Generic fallback (e.g. ambiguous task scope): fold the detail into the
      // original request so the planner has the full picture.
      return `${originalMessage} — ${a}`;
  }
}
