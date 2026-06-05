/**
 * toolLoopBudget — proactive step-budget awareness for the tool loop.
 *
 * The model drives the loop one round at a time and doesn't otherwise know how
 * many tool steps remain before the cap. Without that, it can keep exploring
 * and get truncated mid-task. This emits a short "converge now" reminder in the
 * final stretch so the model prioritizes finishing the core task (and producing
 * a final answer) over optional/exploratory steps.
 *
 * Complements toolLoopProgress (which summarizes *after* the cap is hit) and the
 * fail-safe finalization: this tries to get a real completion *before* the cap.
 * Pure + side-effect free → smoke testable.
 */

/**
 * A convergence reminder for the loop's final rounds, or null when there's
 * still plenty of budget. `roundsUsed` is the number of tool rounds already
 * completed (so remaining = maxRounds - roundsUsed). Only fires when 1..warnAt
 * rounds remain — at 0 remaining there's no next round to consume it.
 */
export function toolBudgetReminder(
  roundsUsed: number,
  maxRounds: number,
  opts: { warnAt?: number } = {},
): string | null {
  const warnAt = Math.max(1, opts.warnAt ?? 2);
  const remaining = maxRounds - roundsUsed;
  if (remaining <= 0 || remaining > warnAt) return null;
  const stepWord = remaining === 1 ? 'step' : 'steps';
  return [
    '',
    `⏳ Step budget: about ${remaining} tool ${stepWord} left this turn.`,
    'Converge now — finish the core of the task and give your final answer. Skip optional or exploratory steps.',
    "If you can't fully finish, do the most important remaining action, then state what's done and what's left so the user can say \"continue\".",
  ].join('\n');
}
