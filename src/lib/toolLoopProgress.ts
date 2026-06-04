/**
 * toolLoopProgress — when a multi-step tool loop hits its round cap before
 * finishing, summarize what actually happened so the user/agent sees concrete
 * progress instead of a bare "I reached my limit" message.
 *
 * This is the "no silent truncation" guard for app/automation tasks: a 6-step
 * task that gets cut at step 5 should report which steps succeeded, which
 * failed (and why), so a "continue" turn resumes with context rather than
 * re-deriving from scratch. Pure + side-effect free → smoke testable.
 */

export interface ToolLoopProgressEvent {
  tool: string;
  status?: string | null;
  result?: string | null;
}

function failed(status: string | null | undefined): boolean {
  return /\b(error|fail|failed|failure|blocked|denied|timeout)\b/i.test(String(status || ''));
}

/** Pull a short, human-readable reason from a (possibly JSON) tool result. */
function shortReason(result: string | null | undefined): string {
  const text = String(result || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const jsonErr = text.match(/"error"\s*:\s*"([^"]{1,140})"/i);
  if (jsonErr) return jsonErr[1];
  return text.slice(0, 100);
}

/**
 * Returns a compact markdown progress block, or '' when there are no events.
 * Lists each completed (✓) / failed (✗, with reason) step, bounded so a long
 * loop doesn't dump an unbounded list into the reply.
 */
export function summarizeToolLoopProgress(
  events: ToolLoopProgressEvent[] | null | undefined,
  opts: { maxItems?: number } = {},
): string {
  if (!Array.isArray(events) || events.length === 0) return '';
  const maxItems = Math.max(1, opts.maxItems ?? 12);
  const shown = events.slice(0, maxItems);
  const lines = shown.map((event) => {
    const isFail = failed(event.status);
    const reason = isFail ? shortReason(event.result) : '';
    return `- ${isFail ? '✗' : '✓'} ${event.tool || 'tool'}${reason ? ` — ${reason}` : ''}`;
  });
  const moreCount = events.length - shown.length;
  if (moreCount > 0) lines.push(`- …and ${moreCount} more step${moreCount === 1 ? '' : 's'}`);
  return ['Progress before the step limit:', ...lines].join('\n');
}

// Observation/read tools — their last successful result is the ground truth a
// resume should start from (so it doesn't re-derive blindly).
const OBSERVATION_TOOL_RE = /\b(read_a11y_tree|screenshot|dom_snapshot|window_state|list_running_apps|wait_for_app|screen_size|file_stat|file_search|verification_state|document_status|layer_inventory|text_inventory|link_inventory)\b/i;

export interface ToolLoopCheckpointStep {
  tool: string;
  ok: boolean;
  reason?: string;
}

/**
 * Machine-readable snapshot of a truncated tool loop so a continuation can
 * resume with context instead of re-deriving from scratch: which steps ran,
 * the last ground-truth observation, the last failure to retry, and a hint.
 */
export interface ToolLoopCheckpoint {
  schemaVersion: 1;
  stepCount: number;
  maxRounds?: number;
  completedSteps: ToolLoopCheckpointStep[];
  lastObservation?: { tool: string; summary: string } | null;
  lastFailure?: ToolLoopCheckpointStep | null;
  resumeHint: string;
}

export function buildToolLoopCheckpoint(
  events: ToolLoopProgressEvent[] | null | undefined,
  opts: { maxRounds?: number; maxSteps?: number } = {},
): ToolLoopCheckpoint {
  const list = Array.isArray(events) ? events : [];
  const maxSteps = Math.max(1, opts.maxSteps ?? 12);
  const completedSteps: ToolLoopCheckpointStep[] = list.slice(-maxSteps).map((event) => {
    const ok = !failed(event.status);
    const step: ToolLoopCheckpointStep = { tool: event.tool || 'tool', ok };
    if (!ok) step.reason = shortReason(event.result);
    return step;
  });

  let lastObservation: { tool: string; summary: string } | null = null;
  let lastFailure: ToolLoopCheckpointStep | null = null;
  for (let i = list.length - 1; i >= 0; i--) {
    const event = list[i];
    const isFail = failed(event.status);
    if (!lastObservation && !isFail && OBSERVATION_TOOL_RE.test(String(event.tool || ''))) {
      lastObservation = { tool: event.tool || 'observation', summary: shortReason(event.result) || '(captured)' };
    }
    if (!lastFailure && isFail) {
      lastFailure = { tool: event.tool || 'tool', ok: false, reason: shortReason(event.result) };
    }
    if (lastObservation && lastFailure) break;
  }

  const resumeHint = lastFailure
    ? `Resume by re-observing fresh state, then retry the failed step (${lastFailure.tool}) via the next surface on the ladder (semantic → menu → shortcut → one bounded coordinate) before continuing the rest.`
    : 'Resume by re-observing fresh state to confirm the last action took effect, then continue the remaining steps.';

  return {
    schemaVersion: 1,
    stepCount: list.length,
    ...(typeof opts.maxRounds === 'number' ? { maxRounds: opts.maxRounds } : {}),
    completedSteps,
    lastObservation,
    lastFailure,
    resumeHint,
  };
}
