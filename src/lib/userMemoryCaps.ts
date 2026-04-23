/**
 * userMemoryCaps — pure cap-check helpers, split out of `userMemory.ts`
 * so smoke tests can import them in Node without the Supabase client
 * pulling react-native into the graph.
 *
 * Phase CA-8b of `PHASE_CA-8_HERMES_DELTA_PLAN.md`. Per-user
 * `user_memory` is 1-to-1 with Hermes `USER.md` (cap 2,200 chars).
 * When the agent tries to `appendUserMemory` past the cap, we return a
 * structured error it can act on by self-consolidating.
 *
 * Kept independent of any DB / network dep — re-exported from
 * `userMemory.ts`, same API surface.
 */

export const USER_MEMORY_SOFT_CAP = 2_200;  // advisory — warn agent to consolidate
export const USER_MEMORY_HARD_CAP = 2_500;  // enforced — append rejects over this
export const USER_MEMORY_CAP_ERROR = 'memory_cap_exceeded';

export type UserMemoryCapCheck =
  | { ok: true; currentChars: number; capChars: number; nextChars: number; approachingSoftCap: boolean }
  | {
      ok: false;
      error: typeof USER_MEMORY_CAP_ERROR;
      suggestion: 'consolidate';
      currentChars: number;
      capChars: number;
      wouldBeChars: number;
    };

/** Pure — decides whether appending `addition` to `currentContent`
 *  would cross the hard cap. Separator is inserted between existing
 *  content and the new note (default `\n`) so the arithmetic matches
 *  what `appendUserMemory` actually writes. */
export function checkUserMemoryCap(
  currentContent: string,
  addition: string,
  opts?: { softCap?: number; hardCap?: number; separator?: string },
): UserMemoryCapCheck {
  const softCap = opts?.softCap ?? USER_MEMORY_SOFT_CAP;
  const hardCap = opts?.hardCap ?? USER_MEMORY_HARD_CAP;
  const separator = opts?.separator ?? '\n';
  const current = (currentContent || '').trim();
  const add = (addition || '').trim();
  const wouldBe = current
    ? (current + separator + add).length
    : add.length;

  if (wouldBe > hardCap) {
    return {
      ok: false,
      error: USER_MEMORY_CAP_ERROR,
      suggestion: 'consolidate',
      currentChars: current.length,
      capChars: hardCap,
      wouldBeChars: wouldBe,
    };
  }
  return {
    ok: true,
    currentChars: current.length,
    capChars: hardCap,
    nextChars: wouldBe,
    approachingSoftCap: wouldBe >= softCap,
  };
}

/** One-line summary suitable for the system prompt's memory block. */
export function describeUserMemoryUsage(currentContent: string): string {
  const current = (currentContent || '').length;
  const soft = USER_MEMORY_SOFT_CAP;
  const hard = USER_MEMORY_HARD_CAP;
  const warn =
    current >= hard ? ' (HARD CAP HIT — rewriting required)'
    : current >= soft ? ' (approaching soft cap — consider consolidating)'
    : '';
  return `USER MEMORY: ${current.toLocaleString()} / ${hard.toLocaleString()} chars used${warn}`;
}
