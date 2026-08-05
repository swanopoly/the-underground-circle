/**
 * clarificationGate — the pure decision layer that decides WHEN a chat action
 * is worth pausing to ask a clarifying question.
 *
 * Research grounding (see the initiative brief): asking on *genuinely
 * ambiguous* tasks lifts success (SWE-bench underspecified +14.6 pts;
 * MultiWOZ +7.8 pts AND shorter dialogues), but *over-asking on
 * already-specified tasks* is a real, prompt-induced failure that hurts UX.
 * The dominant real-world failure is the opposite — UNDER-clarifying, i.e.
 * answering prematurely and completing the wrong task. So this gate must:
 *
 *   - fire (ask=true) when a DECISION-RELEVANT slot is empty — a missing
 *     value that would change the chosen action / route / approval, where a
 *     silent default would risk doing the wrong thing (create a task with no
 *     subject, publish with nothing to publish, generate an image of nothing,
 *     run a destructive/approval action against an unresolved target);
 *   - stay quiet (ask=false) when the message is fully specified (all
 *     decision-relevant params present) OR the only gap is stylistic /
 *     low-stakes / reversible, where a safe default is fine.
 *
 * It is deliberately CONSERVATIVE toward NOT asking on specified input, and
 * only asks when a decision-relevant slot is actually empty. It is a *pure*
 * decision layer (no model calls, no I/O) that the planner consults — the
 * planner still owns the ChatAutomationClarification shape + resume machinery.
 */

/** Intent types whose primary content slot is the ROUTING decision itself. */
export type ClarificationGateIntentType =
  | 'create_task'
  | 'office_agent_task'
  | 'wordpress_publish'
  | 'wordpress_schedule'
  | 'generate_image'
  | string;

export type ClarificationGateInput = {
  /** The raw user message (already trimmed by the planner is fine). */
  message: string;
  /** The conversational intent type the planner matched, if any. */
  intentType?: ClarificationGateIntentType;
  /**
   * The params the planner could not resolve for this intent (its
   * ChatAutomationClarification.missingParams). Empty/undefined means the
   * planner found real content for every required field.
   */
  missingParams?: string[];
};

export type ClarificationGateDecision = {
  /** True only when a decision-relevant slot is empty and asking is warranted. */
  ask: boolean;
  /**
   * Machine-stable reason code when ask=true (for telemetry + describe*), or
   * a not-asking reason code when ask=false. Null is never returned so callers
   * always have a rationale to log.
   */
  reason: ClarificationGateReason;
};

export type ClarificationGateReason =
  // ── ask=true reasons (a decision-relevant slot is empty) ──
  | 'missing_task_subject'
  | 'missing_agent_target'
  | 'missing_publish_subject'
  | 'missing_publish_date'
  | 'missing_image_subject'
  | 'missing_action_target'
  | 'missing_decision_relevant_param'
  // ── ask=false reasons (safe to proceed with a default) ──
  | 'fully_specified'
  | 'gap_is_stylistic_or_reversible'
  | 'no_actionable_intent';

// Words that carry no task/subject meaning on their own. Mirrors the planner's
// CLARIFY_STOP_WORDS so "meaningful content" means the same thing on both sides
// of the gate; kept here so the gate stays a standalone pure module.
const GATE_STOP_WORDS = new Set([
  'please', 'the', 'for', 'this', 'that', 'and', 'your', 'some', 'new', 'with',
  'about', 'into', 'onto', 'from', 'just', 'can', 'you', 'could', 'would',
  'a', 'an', 'to', 'it', 'me', 'my', 'i', 'we', 'us', 'them', 'their',
]);

function meaningfulTokenCount(text: string): number {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2 && !GATE_STOP_WORDS.has(word))
    .length;
}

/**
 * Some missing params are decision-relevant (their absence would change the
 * routed action / target / approval), others are stylistic or reversible and a
 * safe default suffices. This maps a planner missingParams token to whether it
 * blocks — and to the reason code we surface when it does.
 *
 * The list of BLOCKING params is what the planner actually emits today from
 * detectConversationalClarification. Anything not listed here is treated as a
 * non-blocking (stylistic / reversible) gap so the gate stays biased toward
 * proceeding rather than over-asking.
 */
const BLOCKING_PARAM_REASON: Record<string, ClarificationGateReason> = {
  'task description': 'missing_task_subject',
  'task_title': 'missing_task_subject',
  'title': 'missing_task_subject',
  'which agent': 'missing_agent_target',
  'agent': 'missing_agent_target',
  'publish date': 'missing_publish_date',
  'post title': 'missing_publish_subject',
  'post content': 'missing_publish_subject',
  'image subject': 'missing_image_subject',
  // The planner's ambiguous-but-actionable fallback names this when a mutation
  // verb is present but the target could not be pinned down.
  'task scope': 'missing_action_target',
};

// Params we explicitly treat as NON-blocking even if the planner names them:
// tone/format/style are reversible defaults, never worth a round-trip.
const STYLISTIC_PARAMS = new Set([
  'tone', 'style', 'format', 'length', 'color', 'colour', 'mood', 'voice',
  'theme', 'font', 'layout',
]);

function firstBlockingParamReason(missingParams: string[]): ClarificationGateReason | null {
  for (const raw of missingParams) {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) continue;
    if (STYLISTIC_PARAMS.has(key)) continue;
    const mapped = BLOCKING_PARAM_REASON[key];
    if (mapped) return mapped;
  }
  return null;
}

function allMissingParamsAreStylistic(missingParams: string[]): boolean {
  const present = missingParams.map((p) => String(p || '').trim().toLowerCase()).filter(Boolean);
  if (present.length === 0) return false;
  return present.every((key) => STYLISTIC_PARAMS.has(key) || !BLOCKING_PARAM_REASON[key]);
}

/**
 * The core gate. Returns ask=true ONLY when a decision-relevant slot is empty.
 *
 * Contract with the planner:
 *   - If the planner did NOT detect any missing params, the request is fully
 *     specified for its route → ask=false (never over-ask). This is the guard
 *     that keeps well-specified conversational actions from ever asking.
 *   - If the planner named missing params, we still only ask when at least one
 *     is decision-relevant (BLOCKING_PARAM_REASON) AND the message genuinely
 *     lacks the corresponding content. A gap that is purely stylistic /
 *     reversible resolves to ask=false with a safe-default reason.
 */
export function isDecisionRelevantAmbiguity(input: ClarificationGateInput): {
  ask: boolean;
  reason: string | null;
} {
  const decision = decideClarificationGate(input);
  return { ask: decision.ask, reason: decision.reason };
}

/** Typed variant used internally + by the planner when it wants the reason code. */
export function decideClarificationGate(input: ClarificationGateInput): ClarificationGateDecision {
  const message = String(input.message || '');
  const missingParams = (input.missingParams || []).filter(Boolean);

  // No matched actionable intent → the gate has nothing to gate on. (The
  // planner only consults us once it has matched a conversational action or a
  // mutation-shaped fallback, so this is a defensive default.)
  if (!input.intentType || input.intentType === 'none') {
    // A mutation-shaped fallback can arrive with intentType undefined but with
    // named missingParams (e.g. 'task scope'); honour those.
    const fallbackReason = firstBlockingParamReason(missingParams);
    if (fallbackReason) return { ask: true, reason: fallbackReason };
    return { ask: false, reason: 'no_actionable_intent' };
  }

  // Fully specified: planner resolved every required field → NEVER ask. This is
  // the primary over-ask guard.
  if (missingParams.length === 0) {
    return { ask: false, reason: 'fully_specified' };
  }

  // The only gaps are stylistic / reversible → proceed with a safe default.
  if (allMissingParamsAreStylistic(missingParams)) {
    return { ask: false, reason: 'gap_is_stylistic_or_reversible' };
  }

  // A decision-relevant slot is named. Confirm the message really lacks usable
  // content for it before asking — this makes the gate robust even if a future
  // caller passes a stale missingParams: if the message clearly carries a
  // subject we do NOT ask (avoids over-asking), except for slots that require a
  // specific typed value the message text alone can't supply (a future date).
  const blockingReason = firstBlockingParamReason(missingParams);
  if (!blockingReason) {
    // Named params, but none are known-blocking → treat as a low-stakes gap.
    return { ask: false, reason: 'gap_is_stylistic_or_reversible' };
  }

  if (blockingReason === 'missing_publish_date') {
    // A schedule date is a typed value; free-text subject content can't stand
    // in for it, so an empty date always warrants the ask.
    return { ask: true, reason: 'missing_publish_date' };
  }

  // Subject/target slots: only ask if the message genuinely lacks meaningful
  // content. The planner already stripped command words before deciding
  // missingParams, so in normal use this simply re-confirms; the extra check is
  // a belt-and-suspenders guard against over-asking on specified input.
  const hasMeaningfulContent = meaningfulTokenCount(message) >= 3;
  if (hasMeaningfulContent && blockingReason === 'missing_action_target') {
    // Ambiguous-but-actionable fallback: even with words present, an
    // unresolved target for a mutation is decision-relevant — ask.
    return { ask: true, reason: blockingReason };
  }

  return { ask: true, reason: blockingReason };
}

/**
 * A bounded one-line rationale for telemetry / logs. Never includes user
 * content — only the stable reason code's human-readable meaning.
 */
export function describeClarificationValue(reason: string | null | undefined): string {
  switch (reason) {
    case 'missing_task_subject':
      return 'Asked: the task had no subject, so a default would track the wrong work.';
    case 'missing_agent_target':
      return 'Asked: no agent was named, so the assignment target was undecidable.';
    case 'missing_publish_subject':
      return 'Asked: nothing to publish was given, so a default post would be empty.';
    case 'missing_publish_date':
      return 'Asked: a schedule needs a concrete future date a default cannot supply.';
    case 'missing_image_subject':
      return 'Asked: the image had no subject, so there was nothing to generate.';
    case 'missing_action_target':
      return 'Asked: a mutation was requested but its target could not be resolved.';
    case 'missing_decision_relevant_param':
      return 'Asked: a decision-relevant field was empty and no safe default exists.';
    case 'fully_specified':
      return 'Proceeded: every decision-relevant field was present; asking would over-ask.';
    case 'gap_is_stylistic_or_reversible':
      return 'Proceeded: the only gap was stylistic/reversible; used a safe default.';
    case 'no_actionable_intent':
      return 'Proceeded: no actionable intent to clarify.';
    default:
      return 'Proceeded: no decision-relevant ambiguity detected.';
  }
}
