/**
 * swanbotV2ModeContractCore — the client-side, LOCKSTEP mirror of the
 * swanbot-v2-ai edge's `MODE_CONTRACT` (supabase/functions/swanbot-v2-ai/index.ts
 * :111-128). Loop convergence (ADR-0002) Phase-2 flip prep.
 *
 * WHY A DEDICATED MIRROR (not `openswanModePolicy.ts`):
 * The edge appended `MODE_CONTRACT[mode]` to the frozen system block server-side
 * inside `runLoop`. When the client-side `swanbotV2BatchRuntime` replaces that
 * edge round-trip, the flip must append the SAME per-mode contract line so the
 * converged turn's prompt carries the same mode framing. `openswanModePolicy.ts`
 * has CLOSE-but-not-byte-identical wording (e.g. "concise, grounded, and calm."
 * vs the edge's "concise, grounded, calm. No fluff, no forced enthusiasm."), so
 * using it would silently change the mode contract at flip time. This module is
 * a verbatim copy of the edge strings with a smoke that pins them, so the two
 * can never drift without breaking the smoke (update BOTH in lockstep).
 *
 * PURITY: zero imports, tsx-loadable, every export total (never throws), bounded.
 */

/** The 8 chat modes the edge MODE_CONTRACT covers (parity with openswanModePolicy). */
export type SwanbotV2Mode =
  | 'talk' | 'build' | 'plan' | 'execute' | 'review' | 'research' | 'support' | 'design';

/**
 * VERBATIM mirror of the edge `MODE_CONTRACT` (index.ts:111-128). LOCKSTEP: if
 * the edge strings change, update these AND the smoke's pinned copies together.
 */
export const V2_MODE_CONTRACT: Readonly<Record<SwanbotV2Mode, string>> = Object.freeze({
  talk:
    'Respond like a strong senior teammate: concise, grounded, calm. No fluff, no forced enthusiasm.',
  build:
    'Act like a professional implementation lead. Be specific, execution-first, technically accountable. Prefer exact files, commands, interfaces. State assumptions.',
  plan:
    "Frame the work, identify risks, order subtasks. Don't pretend to be certain when the problem is still underspecified.",
  execute:
    'Do the task directly. Minimal preamble. Report outcome, not intention.',
  review:
    "Find real problems, ranked by severity. Cite files/lines. Don't pad with generic advice.",
  research:
    'Survey before synthesis. Cite sources. Distinguish evidence from opinion.',
  support:
    'Diagnose before prescribing. Ask the smallest question that unblocks the user.',
  design:
    'Start from constraints and audience. Give one recommendation with one tradeoff.',
});

/**
 * The mode contract line for a mode, matching the edge's lookup. `none`/`talk`/
 * unknown/hostile input → the `talk` contract (the edge's default framing for
 * casual/mode-less turns). Never throws.
 */
export function v2ModeContractFor(mode: unknown): string {
  const key = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  if (key && Object.prototype.hasOwnProperty.call(V2_MODE_CONTRACT, key)) {
    return V2_MODE_CONTRACT[key as SwanbotV2Mode];
  }
  return V2_MODE_CONTRACT.talk;
}

/**
 * Append the mode contract to a frozen system prompt exactly as the edge did
 * server-side (runbook §2.2): a blank-line-separated `[MODE RESPONSE CONTRACT]`
 * block. Empty/hostile base → just the contract; never throws.
 */
export function appendV2ModeContract(systemPrompt: unknown, mode: unknown): string {
  const base = typeof systemPrompt === 'string' ? systemPrompt : '';
  const contract = v2ModeContractFor(mode);
  return base
    ? `${base}\n\n[MODE RESPONSE CONTRACT]\n${contract}`
    : `[MODE RESPONSE CONTRACT]\n${contract}`;
}
