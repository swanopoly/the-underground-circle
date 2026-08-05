/**
 * toolLoopResume — auto-consume the tool-loop resume checkpoint on a
 * continuation turn.
 *
 * When a turn hits the per-turn step cap, executeToolUseLoop returns a
 * ToolLoopCheckpoint and the session runtime persists it to the transcript as a
 * "Tool-step limit reached" event (`data.checkpoint`). Previously a follow-up
 * turn had to re-derive the state from the transcript narrative. This module
 * lets the next turn pull that checkpoint forward automatically and inject a
 * compact resume block into the system prompt, so the model picks up from the
 * last confirmed observation + the failed step instead of starting over.
 *
 * Pure + side-effect free → smoke testable. The caller (openswanSessionRuntime)
 * scans `transcript.events` and appends the block to the system prompt.
 */

import type { ToolLoopCheckpoint } from './toolLoopProgress';

/** Minimal structural shape of a transcript event this scan needs. */
export interface ResumeScanEvent {
  kind?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Returns the checkpoint to resume from when the *most recent* turn ended at the
 * step cap, or null otherwise. Turns are delimited by the once-per-turn
 * `assistant_response` event: scanning back from the end, a checkpoint found
 * before the second `assistant_response` (the previous turn's end) belongs to
 * the last turn — so it's still pending. A later clean turn (no checkpoint of
 * its own) yields null, so a completed task is never re-resumed.
 */
export function findPendingResumeCheckpoint(
  events: ResumeScanEvent[] | null | undefined,
): ToolLoopCheckpoint | null {
  if (!Array.isArray(events)) return null;
  let seenAssistantResponses = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.kind === 'assistant_response') {
      seenAssistantResponses += 1;
      if (seenAssistantResponses >= 2) break; // reached the previous turn's end
      continue;
    }
    const checkpoint = event?.data?.checkpoint;
    if (checkpoint && typeof checkpoint === 'object') {
      return checkpoint as ToolLoopCheckpoint;
    }
  }
  return null;
}

/**
 * A compact system-prompt block telling the model the previous turn was cut off
 * at the step cap and how to resume. Deliberately defers to the user's actual
 * new message — if they've moved on, the model should follow that instead of
 * forcing resumption. Returns '' for a null/empty checkpoint.
 */
export function buildResumeContextBlock(checkpoint: ToolLoopCheckpoint | null | undefined): string {
  if (!checkpoint || typeof checkpoint !== 'object') return '';
  const lines: string[] = [
    'CONTINUATION — the previous turn hit its tool-step limit before finishing. If the',
    "user's new message continues that task, resume from where it stopped instead of",
    "starting over (and don't redo steps that already succeeded). If they've moved on,",
    'follow their new request instead.',
    '',
    `- Steps already completed: ${typeof checkpoint.stepCount === 'number' ? checkpoint.stepCount : 0}`,
  ];
  if (checkpoint.lastObservation?.tool) {
    const summary = checkpoint.lastObservation.summary ? ` — ${checkpoint.lastObservation.summary}` : '';
    lines.push(`- Last confirmed observation: \`${checkpoint.lastObservation.tool}\`${summary}`);
  }
  if (checkpoint.lastFailure?.tool) {
    const reason = checkpoint.lastFailure.reason ? ` — ${checkpoint.lastFailure.reason}` : '';
    lines.push(`- Last failed step to retry: \`${checkpoint.lastFailure.tool}\`${reason}`);
  }
  if (checkpoint.resumeHint) {
    lines.push(`- Resume plan: ${checkpoint.resumeHint}`);
  }
  lines.push('');
  lines.push('Start by re-observing fresh state to confirm what is already done, then continue the remaining work.');
  return lines.join('\n');
}
