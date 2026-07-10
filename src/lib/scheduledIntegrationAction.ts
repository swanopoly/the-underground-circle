/**
 * scheduledIntegrationAction — the SAFETY CORE for recurring integration
 * actions (CHAT_AGENT_ARCHITECTURE_IMPROVEMENT_PLAN Wave 2 · W3): "every morning
 * post yesterday's merged PRs to Slack".
 *
 * A recurring action is an UNATTENDED external side effect, so the design is
 * deliberately conservative and the hard part — the safety model — lives here,
 * pure and fully testable, ahead of any autonomous edge execution:
 *
 *   1. THE APPROVAL FLOOR IS NEVER WAIVABLE. Scheduling grants a STANDING
 *      approval for the recurring run, but ONLY for non-floor reads/posts/
 *      writes. A goal that reads as pay / delete / login / grant is REFUSED at
 *      schedule time (validateScheduledIntegrationAction), and the run prompt
 *      tells the agent to STOP and report if it ever hits the floor at run time.
 *      Belt AND braces — the same floor the interactive path enforces.
 *   2. BOUNDED. A rate ceiling (max runs/day) and a bounded goal keep an
 *      unattended loop from spending or spamming without limit.
 *
 * Pure module — no imports, no I/O, time-injectable — so it loads under tsx for
 * scripts/scheduled-integration-action-smoketest.ts and can be shared by the
 * schedule path (app) and, once wired, the runner (edge).
 *
 * NOTE (scope): this owns validate → describe → run-prompt. Autonomous edge
 * EXECUTION of the agentic read→compose→post turn is intentionally NOT enabled
 * yet (the scheduled-action-runner executes fixed-payload kinds; an agentic
 * integration turn is a separate, reviewed follow-up). Getting the safety model
 * right first is the point.
 */

export interface ScheduledIntegrationActionSpec {
  /** What to do each run, e.g. "post yesterday's merged PRs to Slack". */
  goal: string;
  /** Optional named target integration, e.g. "GitHub" / "Slack". */
  integrationHint?: string;
  /** Cron expression the scheduler runs on (e.g. "0 9 * * 1-5"). */
  recurrence: string;
  /** Human label, e.g. "Every weekday 9am". */
  recurrenceLabel?: string;
  /** Rate ceiling — the scheduler must not run this more than this many times/day. */
  maxRunsPerDay: number;
}

export type ValidateScheduledIntegrationActionResult =
  | { ok: true; spec: ScheduledIntegrationActionSpec }
  | { ok: false; error: string; reason: 'floor' | 'empty_goal' | 'goal_too_long' | 'no_recurrence' | 'rate' };

// ── Bounds ────────────────────────────────────────────────────────────────
export const MAX_SCHEDULED_GOAL_LENGTH = 600;
/** Absolute ceiling on unattended runs per day (defense against a runaway loop). */
export const MAX_RUNS_PER_DAY = 24;
export const DEFAULT_MAX_RUNS_PER_DAY = 4;

// ── The approval floor (never waivable, even when scheduled) ────────────────
/**
 * Floor-verb detector — mirrors the app's sticky approval floor
 * (pay / delete / login / grant; see computerGrantGate STICKY_FLOOR_CATEGORIES).
 * A scheduled recurring action must never be able to do any of these unattended,
 * so a goal that reads as one is refused at schedule time. High-recall on
 * purpose: when in doubt about a money/destructive/auth verb, refuse.
 */
const FLOOR_PATTERNS: ReadonlyArray<{ category: 'pay' | 'delete' | 'login' | 'grant'; re: RegExp }> = [
  { category: 'pay', re: /\b(pay|payment|purchase|buy|check\s?out|place (an? )?order|order (it|now|the)|subscribe|renew|charge|invoice|transfer (money|funds|\$)|send (money|funds|\$)|wire|refund|top\s?up|add funds|billing)\b/i },
  { category: 'delete', re: /\b(delete|remove|destroy|drop|wipe|erase|purge|revoke|deactivate|cancel (the )?(subscription|account|plan)|close (the )?account|uninstall)\b/i },
  { category: 'login', re: /\b(log\s?in|sign\s?in|authenticate|enter (my )?(password|credentials|2fa|otp|mfa)|reset (my )?password|verify (my )?(identity|account))\b/i },
  { category: 'grant', re: /\b(grant\b|authorize\b|give (access|permission)|change (permissions|roles|access)|share access|add (a |an )?(member|user)\b|(add|invite|assign|promote|make|set)\b[^.\n]{0,40}\b(admin|owner|maintainer|collaborator)s?\b)/i },
];

/** Returns the floor category a goal hits, or null. Exported for reuse/tests. */
export function detectScheduledFloorCategory(goal: string): 'pay' | 'delete' | 'login' | 'grant' | null {
  const g = String(goal || '');
  for (const { category, re } of FLOOR_PATTERNS) {
    if (re.test(g)) return category;
  }
  return null;
}

const FLOOR_REFUSAL: Record<'pay' | 'delete' | 'login' | 'grant', string> = {
  pay: 'a scheduled action can never pay, buy, or move money unattended',
  delete: 'a scheduled action can never delete, remove, or revoke unattended',
  login: 'a scheduled action can never log in or handle credentials unattended',
  grant: 'a scheduled action can never grant access or change permissions unattended',
};

// ── Validate ────────────────────────────────────────────────────────────────

/**
 * Validate + normalize a proposed recurring integration action. Refuses
 * floor-hitting goals, empty/over-long goals, missing recurrence, and
 * out-of-range rate. Never throws.
 */
export function validateScheduledIntegrationAction(input: {
  goal?: string;
  integrationHint?: string;
  recurrence?: string;
  recurrenceLabel?: string;
  maxRunsPerDay?: number;
}): ValidateScheduledIntegrationActionResult {
  const goal = String(input?.goal || '').replace(/\s+/g, ' ').trim();
  if (!goal) {
    return { ok: false, reason: 'empty_goal', error: 'What should the scheduled action do? Give it a goal.' };
  }
  if (goal.length > MAX_SCHEDULED_GOAL_LENGTH) {
    return { ok: false, reason: 'goal_too_long', error: `That goal is too long (max ${MAX_SCHEDULED_GOAL_LENGTH} chars). Keep the recurring task concise.` };
  }

  // THE FLOOR — checked before anything else that could imply autonomy.
  const floor = detectScheduledFloorCategory(goal);
  if (floor) {
    return {
      ok: false,
      reason: 'floor',
      error: `Can't schedule that: ${FLOOR_REFUSAL[floor]}. Those always need you in the loop — run it yourself, or reword the recurring task to a safe read/post.`,
    };
  }

  const recurrence = String(input?.recurrence || '').trim();
  if (!recurrence) {
    return { ok: false, reason: 'no_recurrence', error: 'A recurring action needs a schedule (e.g. "every weekday at 9am").' };
  }

  let maxRunsPerDay = Number.isFinite(input?.maxRunsPerDay) ? Math.floor(input!.maxRunsPerDay as number) : DEFAULT_MAX_RUNS_PER_DAY;
  if (maxRunsPerDay < 1) {
    return { ok: false, reason: 'rate', error: 'Runs per day must be at least 1.' };
  }
  if (maxRunsPerDay > MAX_RUNS_PER_DAY) {
    // Clamp rather than reject — but be explicit in the spec so the ceiling is visible.
    maxRunsPerDay = MAX_RUNS_PER_DAY;
  }

  const spec: ScheduledIntegrationActionSpec = {
    goal,
    recurrence,
    maxRunsPerDay,
  };
  const hint = String(input?.integrationHint || '').trim();
  if (hint) spec.integrationHint = hint.slice(0, 60);
  const label = String(input?.recurrenceLabel || '').trim();
  if (label) spec.recurrenceLabel = label.slice(0, 80);

  return { ok: true, spec };
}

// ── Describe (confirmation + standing-approval scope) ───────────────────────

/** Human confirmation line shown when a recurring integration action is set up. */
export function describeScheduledIntegrationAction(spec: ScheduledIntegrationActionSpec): string {
  const when = spec.recurrenceLabel || spec.recurrence;
  const via = spec.integrationHint ? ` via ${spec.integrationHint}` : '';
  return [
    `🔁 **${when}**: ${spec.goal}${via}`,
    `Standing approval covers only reading + posting (up to ${spec.maxRunsPerDay}×/day). It will STOP and ask you if it ever needs to pay, delete, log in, or grant access.`,
  ].join('\n');
}

// ── Run prompt (the guard the runner uses at execution time) ────────────────

/**
 * The agent prompt a runner uses each scheduled run. The STOP-on-floor guard is
 * baked in so that even though the goal was floor-screened at schedule time, an
 * emergent floor action at RUN time (e.g. the API path turns out destructive)
 * still halts instead of proceeding unattended.
 */
export function buildScheduledIntegrationRunPrompt(spec: ScheduledIntegrationActionSpec): string {
  const via = spec.integrationHint ? ` (target: ${spec.integrationHint})` : '';
  return [
    `Scheduled recurring task${via}: ${spec.goal}`,
    '',
    'This is an UNATTENDED run with standing approval for reads + posts only. Steps:',
    '1. Read the fresh data you need with custom_api.read (GET only).',
    '2. Compose the message/update from that data.',
    '3. Post/update via messaging.notify or integration.compose_action → custom_api.request.',
    '',
    'HARD STOP: if completing this would require paying, buying, deleting, removing, revoking, logging in, handling credentials, granting access, or changing permissions, DO NOT do it — stop and report that it needs a human. The standing approval never covers those.',
    'Keep it to one post/update per run. Report a one-line receipt of what you did.',
  ].join('\n');
}
