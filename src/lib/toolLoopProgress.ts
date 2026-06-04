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
