/**
 * missionTaskCompletion — the honest "is this mission task actually done?" gate.
 *
 * Accountability is the product (CLAUDE.md #1). When a mission task is dispatched
 * to an agent (missionAgentDispatch), the ONLY thing that should flip its status
 * to `done` — and stamp a "✅ completed" proof-of-work row into the Feed — is
 * positive evidence that the work finished. This module owns that decision.
 *
 * Historically the gate defaulted to "done" and only stepped back on an explicit
 * failure signal (failed tool / failed verification / a blocker phrase in the
 * reply). That let three "proof-less done" cases through:
 *   1. An EMPTY / blank agent reply — the run produced nothing, so it proved
 *      nothing, yet read as complete.
 *   2. A PARTIAL run that hit the tool-step cap — the session runtime records
 *      "partial and resumable" but drops the machine-readable `incomplete` flag
 *      before the dispatcher sees it, so the only surviving signal is the
 *      "partial / resumable / step cap / continue" language in the reply text.
 *   3. A reply that itself says it did NOT finish ("I wasn't able to…",
 *      "couldn't complete…") without hitting the older blocker-phrase list.
 *
 * `assessMissionTaskCompletion` fails closed on all three: no positive signal ⇒
 * NOT done (the task stays in_progress and the proof row reads "updated", not
 * "completed"). This never fabricates completion; it only ever withholds it.
 *
 * Pure + dependency-light (`import type` only) so it stays smoke-testable via tsx
 * (`npm run smoke:mission-task-completion`) — the dispatcher that calls it pulls
 * in Supabase/React and can't be loaded in a plain Node smoke.
 */

/** Minimal shape of a tool event the gate reads (status only). Structurally
 *  compatible with OpenSwanToolEvent / SwanBot tool actions. */
export interface MissionCompletionToolEvent {
  status?: string | null;
}

/** Minimal shape of a verification result the gate reads. Structurally
 *  compatible with OpenSwanVerificationResult. */
export interface MissionCompletionVerification {
  ok?: boolean;
  status?: string | null;
}

/** Minimal shape of a structured artifact (presence counts as evidence). */
export interface MissionCompletionArtifact {
  kind?: string;
}

export interface MissionCompletionInput {
  response: string;
  artifacts?: MissionCompletionArtifact[] | null;
  verificationResults?: MissionCompletionVerification[] | null;
  toolEvents?: MissionCompletionToolEvent[] | null;
}

export interface MissionCompletionAssessment {
  /** Final verdict — only true when the run showed no failure/partial/blocker
   *  signal AND actually produced a non-empty result. */
  completed: boolean;
  /** Machine-readable reason a task was NOT marked done (for the proof row /
   *  telemetry). Undefined when completed. */
  reason?:
    | 'failed_tool'
    | 'failed_verification'
    | 'blocker_phrase'
    | 'incomplete_partial'
    | 'empty_response';
}

// A tool/verification status string that denotes it did NOT cleanly succeed.
// Kept in lockstep with toolLoopProgress.isFailedStatus intent but local so this
// module stays dependency-free.
const FAILED_STATUS_RE = /\b(error|fail|failed|failure|blocked|denied|timeout|manual_required)\b/i;

// The reply explicitly says the agent could not finish / needs something. Union
// of the original blocker list plus "cannot/could not/unable/wasn't able" forms.
const BLOCKER_PHRASE_RE =
  /\b(need more information|need more info|need access|need approval|waiting on|blocked|cannot complete|can'?t complete|could not complete|couldn'?t complete|unable to complete|was ?n'?t able to|were ?n'?t able to|missing context|please provide)\b/i;

// The run hit the per-turn step cap (partial, resumable). The session runtime
// drops the typed `incomplete` flag before the dispatcher, but the distinctive
// step-cap language it writes ("partial and resumable", "hit the per-turn step
// cap", "step limit") survives in the reply text — this is the last defense
// against a truncated run reading as complete. Deliberately anchored to the
// truncation SENSE (step/iteration cap/limit, "resumable", explicit continue-
// later) rather than the bare word "partial"/"continue", which appear in plenty
// of genuine completion summaries and must not over-block.
const PARTIAL_RUN_RE =
  /\b(resumable|(?:step|tool[- ]step|iteration|per-turn) (?:cap|limit)|hit the (?:per-turn |step )?(?:step |iteration )?(?:cap|limit)|ran out of (?:steps|iterations)|reached the (?:step|iteration) (?:cap|limit)|to be continued|continue(?:d)? in a (?:follow-?up|later run))\b/i;

function statusFailed(status: string | null | undefined): boolean {
  return FAILED_STATUS_RE.test(String(status || ''));
}

/**
 * Decide whether a dispatched mission task should be marked `done`. Fails closed:
 * any failure/partial/blocker signal, or an empty result, withholds completion.
 * Never throws on degenerate input.
 */
export function assessMissionTaskCompletion(
  input: MissionCompletionInput | null | undefined,
): MissionCompletionAssessment {
  const toolEvents = Array.isArray(input?.toolEvents) ? input!.toolEvents : [];
  const verificationResults = Array.isArray(input?.verificationResults)
    ? input!.verificationResults
    : [];
  const response = String(input?.response || '');

  // 1. Any tool that failed / was blocked / needs manual action ⇒ not done.
  if (toolEvents.some((event) => statusFailed(event?.status))) {
    return { completed: false, reason: 'failed_tool' };
  }

  // 2. Any verification that didn't pass ⇒ not done.
  if (
    verificationResults.some(
      (result) => result?.ok === false || statusFailed(result?.status),
    )
  ) {
    return { completed: false, reason: 'failed_verification' };
  }

  // 3. The reply says it couldn't finish / needs something ⇒ not done.
  if (BLOCKER_PHRASE_RE.test(response)) {
    return { completed: false, reason: 'blocker_phrase' };
  }

  // 4. The run was truncated at the step cap (partial / resumable) ⇒ not done.
  if (PARTIAL_RUN_RE.test(response)) {
    return { completed: false, reason: 'incomplete_partial' };
  }

  // 5. PROOF-BEFORE-DONE: a run that produced no result proved nothing. Require
  //    a non-empty reply before ever reading as complete.
  if (!response.trim()) {
    return { completed: false, reason: 'empty_response' };
  }

  return { completed: true };
}

/** Back-compat boolean wrapper for callers that only need the verdict. */
export function shouldMarkMissionTaskComplete(
  input: MissionCompletionInput,
): boolean {
  return assessMissionTaskCompletion(input).completed;
}
