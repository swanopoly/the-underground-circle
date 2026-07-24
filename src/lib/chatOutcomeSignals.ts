/**
 * chatOutcomeSignals — the flywheel signal the research says is essential.
 *
 * Today the app persists source/routing/usage but no explicit statement of
 * (a) whether the agent COMPLETED the user's task (an outcome verdict) and
 * (b) how the USER reacted to the reply (accept / reject / edit-and-resend /
 * steer). Cursor Tab's precedent is that exactly these two signals — a
 * machine-derived verdict plus the human's accept/reject action — are what
 * drove a +28% accept-rate improvement once they became training signal.
 *
 * This module is the pure, dependency-light core for that signal. It only
 * produces small enums and bounded ids so the payload is safe to persist on
 * a chat row and later mined as BlackSwan training data with no free-text or
 * PII leakage. All wiring (finalize / reaction / edit-resend) lives in the
 * chat surface; this file must stay smoke-testable (no react-native imports).
 */

/**
 * How the user reacted to a finalized bot reply.
 * - accept       — thumbs up / explicit acceptance
 * - reject       — thumbs down / explicit rejection
 * - edit_resend  — user edited the prior request and re-sent it (implicit
 *                  "that wasn't quite it"), a strong negative-ish signal
 * - steer        — user redirected mid-task without rejecting outright
 * - retry        — user asked for the same thing again
 * - abandon      — user walked away / dropped the thread
 */
export type ChatUserSignal =
  | 'accept'
  | 'reject'
  | 'edit_resend'
  | 'steer'
  | 'retry'
  | 'abandon';

/**
 * Machine-derived judgement of whether the agent completed the user's task.
 * - completed — produced usable output (artifact or text) with no error and
 *               nothing left blocking
 * - partial   — produced something but recovery options / follow-ups remain
 * - blocked   — stopped for approval / user action before finishing
 * - failed    — errored (with or without recovery offered)
 * - unknown   — not enough signal to judge
 */
export type ChatOutcomeVerdict =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'unknown';

export const CHAT_USER_SIGNALS: readonly ChatUserSignal[] = [
  'accept',
  'reject',
  'edit_resend',
  'steer',
  'retry',
  'abandon',
] as const;

export const CHAT_OUTCOME_VERDICTS: readonly ChatOutcomeVerdict[] = [
  'completed',
  'partial',
  'blocked',
  'failed',
  'unknown',
] as const;

// Keep persisted ids tiny: they are model/lane identifiers, never prose. A
// hard clamp (no "[truncated]" suffix) keeps the byte cost of the signal
// predictable so it always fits inside the metadata cap, even in the
// 'minimal' persistence tier.
const OUTCOME_LANE_MAX = 48;
const OUTCOME_MODEL_MAX = 80;

export type ChatOutcomeSignalInput = {
  /** The bot reply errored / threw during execution. */
  hadError: boolean;
  /** Recovery options were offered alongside the reply (failure affordance). */
  hadRecoveryOptions: boolean;
  /** The reply stopped for an approval / user-action gate before finishing. */
  approvalPending: boolean;
  /** The reply produced a durable artifact (file, build, doc, plan card…). */
  producedArtifact: boolean;
  /** The reply produced usable natural-language text. */
  producedText: boolean;
};

/**
 * Deterministic verdict from the data already in scope when a bot message is
 * finalized. Ordering matters — the first matching rule wins:
 *
 *   1. error + recovery options  -> failed   (hard failure, recovery offered)
 *   2. error alone               -> failed   (hard failure, nothing to retry)
 *   3. approval pending          -> blocked  (stopped for a gate, not done)
 *   4. recovery options (no err) -> partial  (produced something, work remains)
 *   5. artifact or text (no err) -> completed
 *   6. otherwise                 -> unknown  (empty / silent reply)
 *
 * Pure and total: any boolean combination returns a defined verdict, and
 * non-boolean junk is coerced so callers can never make it throw.
 */
export function deriveOutcomeVerdict(input: ChatOutcomeSignalInput): ChatOutcomeVerdict {
  const hadError = input?.hadError === true;
  const hadRecoveryOptions = input?.hadRecoveryOptions === true;
  const approvalPending = input?.approvalPending === true;
  const producedArtifact = input?.producedArtifact === true;
  const producedText = input?.producedText === true;

  // A hard error dominates every other signal: the task did not complete.
  // (recovery options only tell us whether a retry was offered.)
  if (hadError) return 'failed';

  // Stopped at an approval / user-action gate before mutating or finishing.
  if (approvalPending) return 'blocked';

  // No error, but recovery affordances remain -> produced something usable
  // yet the task is not fully closed out.
  if (hadRecoveryOptions) return 'partial';

  // Clean output of either kind with nothing outstanding -> completed.
  if (producedArtifact || producedText) return 'completed';

  // Silent / empty reply with no other signal.
  return 'unknown';
}

/**
 * Map a browser-plan lifecycle status to the outcome verdict that should be
 * RE-STAMPED onto its source bot message once a live run reaches that status.
 *
 * The launch-time verdict (from `deriveOutcomeVerdict`) is frozen when the plan
 * card is first shown: a present browser plan reads as `producedArtifact` →
 * 'completed' (or 'blocked' when approval-gated) while the run has only just
 * started. When the run actually TERMINATES, the caller re-stamps with this so
 * the receipt badge and Retry affordance reconcile with reality instead of
 * showing a stale green "Verified" on a failed run.
 *
 *   'completed' -> 'completed'   (run finished cleanly)
 *   'failed'    -> 'failed'      (run errored; flips badge to red, unlocks Retry,
 *                                 and records honest telemetry)
 *   anything else ('launched' / non-terminal / junk) -> null: do NOT re-stamp,
 *                 so a still-running plan never overwrites its live verdict.
 *
 * Pure + total: any input returns a terminal verdict or null, never throws.
 */
export function browserPlanStatusOutcomeVerdict(
  status: unknown,
): Extract<ChatOutcomeVerdict, 'completed' | 'failed'> | null {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return null;
}

// Emoji reaction -> user signal. Only the two unambiguous thumbs map to a
// signal; every other emoji (celebration, hearts, etc.) is decorative and
// returns null so we never mislabel training data. Kept as a table so new
// mappings are one line and the smoke can enumerate them.
const REACTION_SIGNAL_TABLE: Readonly<Record<string, ChatUserSignal>> = {
  '👍': 'accept',
  '👎': 'reject',
};

/**
 * Map a reaction emoji to a user signal, or null when the emoji carries no
 * accept/reject meaning. Total: any string (or junk) returns a signal or null,
 * never throws.
 */
export function mapReactionToSignal(emoji: unknown): ChatUserSignal | null {
  if (typeof emoji !== 'string' || !emoji) return null;
  return REACTION_SIGNAL_TABLE[emoji] ?? null;
}

function isOutcomeVerdict(value: unknown): value is ChatOutcomeVerdict {
  return typeof value === 'string' && (CHAT_OUTCOME_VERDICTS as readonly string[]).includes(value);
}

function isUserSignal(value: unknown): value is ChatUserSignal {
  return typeof value === 'string' && (CHAT_USER_SIGNALS as readonly string[]).includes(value);
}

// Hard clamp — no ellipsis/suffix — so byte cost is bounded and predictable.
function clampId(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars);
}

/**
 * The bounded shape persisted on a bot-message row and mined for training.
 * Every field is an enum or a short id — never free text, never PII.
 */
export type ChatOutcomeSignalPayload = {
  verdict: ChatOutcomeVerdict;
  signal?: ChatUserSignal;
  lane?: string;
  model?: string;
};

export type BuildOutcomeSignalPayloadInput = {
  verdict?: unknown;
  signal?: unknown;
  lane?: unknown;
  model?: unknown;
};

/**
 * Validate + clamp raw values into the bounded persistence shape. Unknown
 * verdicts collapse to 'unknown'; unknown signals are dropped; lane/model are
 * clamped short ids. Total: junk input returns a valid payload, never throws.
 */
export function buildOutcomeSignalPayload(
  input: BuildOutcomeSignalPayloadInput,
): ChatOutcomeSignalPayload {
  const payload: ChatOutcomeSignalPayload = {
    verdict: isOutcomeVerdict(input?.verdict) ? input.verdict : 'unknown',
  };
  if (isUserSignal(input?.signal)) payload.signal = input.signal;
  const lane = clampId(input?.lane, OUTCOME_LANE_MAX);
  if (lane) payload.lane = lane;
  const model = clampId(input?.model, OUTCOME_MODEL_MAX);
  if (model) payload.model = model;
  return payload;
}

/**
 * Re-validate a payload read back off an (untrusted) persisted row. Returns
 * null when there is no usable signal, mirroring the readPersisted* pattern so
 * callers can attach it conditionally. Idempotent with buildOutcomeSignalPayload.
 */
export function readOutcomeSignalPayload(value: unknown): ChatOutcomeSignalPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  // A row with only junk (no valid verdict AND no valid signal/ids) is not
  // worth surfacing — 'unknown' with nothing else is noise.
  const hasVerdict = isOutcomeVerdict(raw.verdict);
  const hasSignal = isUserSignal(raw.signal);
  const lane = clampId(raw.lane, OUTCOME_LANE_MAX);
  const model = clampId(raw.model, OUTCOME_MODEL_MAX);
  if (!hasVerdict && !hasSignal && !lane && !model) return null;
  return buildOutcomeSignalPayload(raw);
}

export type FlywheelOutcomeRecord = {
  verdict?: unknown;
  signal?: unknown;
};

export type FlywheelOutcomeSummary = {
  total: number;
  /** Rows carrying an explicit user accept/reject (the accept-rate denominator). */
  reacted: number;
  accepts: number;
  rejects: number;
  /** accepts / (accepts + rejects), 0 when no reactions yet. Rounded to 0.01. */
  acceptRate: number;
  verdictMix: Record<ChatOutcomeVerdict, number>;
  /** One compact, PII-free line for a future flywheel dashboard. */
  line: string;
};

/**
 * Fold a batch of persisted outcome records into a compact accept-rate /
 * verdict-mix summary for a future dashboard. Pure + bounded: ignores junk
 * rows, never throws, and emits only counts + enums (no free text).
 *
 * Accept rate mirrors Cursor Tab's headline metric: of the replies the user
 * explicitly judged, what fraction did they accept.
 */
export function summarizeOutcomeForFlywheel(
  records: ReadonlyArray<FlywheelOutcomeRecord> | null | undefined,
): FlywheelOutcomeSummary {
  const verdictMix: Record<ChatOutcomeVerdict, number> = {
    completed: 0,
    partial: 0,
    blocked: 0,
    failed: 0,
    unknown: 0,
  };
  let total = 0;
  let accepts = 0;
  let rejects = 0;
  let reacted = 0;

  if (Array.isArray(records)) {
    for (const record of records) {
      if (!record || typeof record !== 'object') continue;
      total += 1;
      const verdict: ChatOutcomeVerdict = isOutcomeVerdict(record.verdict) ? record.verdict : 'unknown';
      verdictMix[verdict] += 1;
      const signal = isUserSignal(record.signal) ? record.signal : null;
      if (signal === 'accept') {
        accepts += 1;
        reacted += 1;
      } else if (signal === 'reject') {
        rejects += 1;
        reacted += 1;
      } else if (signal) {
        // edit_resend / steer / retry / abandon still count as a reaction the
        // user made, just not a clean accept/reject for the accept-rate ratio.
        reacted += 1;
      }
    }
  }

  const denom = accepts + rejects;
  const acceptRate = denom > 0 ? Math.round((accepts / denom) * 100) / 100 : 0;
  const line =
    `${total} replies · ${reacted} reacted · accept-rate ${Math.round(acceptRate * 100)}% ` +
    `(${accepts}↑/${rejects}↓) · ` +
    `${verdictMix.completed} completed / ${verdictMix.partial} partial / ` +
    `${verdictMix.blocked} blocked / ${verdictMix.failed} failed / ${verdictMix.unknown} unknown`;

  return { total, reacted, accepts, rejects, acceptRate, verdictMix, line };
}
