// toolResultSummaryCore — the PURE deterministic tool-result summarizer for
// large tool outputs (P6 of docs/CODING_AGENT_UPGRADE_PLAN.md). A single
// `npm test` or build tool_result can be 300KB; stringifying `{ok:true,data}`
// into the model context floods the window and buries the signal. This core
// keeps the HEAD and TAIL of the output verbatim (snapped to line boundaries
// when a newline is nearby, so lines aren't split mid-way), drops the middle,
// and surfaces "signal lines" from the omitted region — lines that look like
// errors/warnings/failures/timeouts — deduped and capped. A marker line states
// exactly what was kept and omitted so the model never mistakes the summary
// for the full output.
//
// Deterministic: same input → same output, always. Every export is TOTAL —
// degenerate input (null/undefined/non-string/absurd opts) never throws, it
// returns a neutral passthrough result.
//
// PURITY: zero runtime imports, tsx-loadable (smoke: tool-result-summary-core).
// This module never touches the filesystem or network — agentExecutionCore's
// tool_result success path calls it on the stringified payload before the
// text re-enters the model context.

/** Outputs at or under this length pass through untouched. */
export const TOOL_RESULT_SUMMARY_THRESHOLD_CHARS = 20_000;
/** Verbatim characters kept from the start of an oversized output. */
export const SUMMARY_HEAD_CHARS = 8_000;
/** Verbatim characters kept from the end of an oversized output. */
export const SUMMARY_TAIL_CHARS = 4_000;
/** Max signal lines surfaced from the omitted middle. */
export const SUMMARY_SIGNAL_LINE_MAX = 40;
/** Max total characters across all surfaced signal lines. */
export const SUMMARY_SIGNAL_CHARS = 4_000;

/** How far a head/tail cut may move to land on a newline instead of mid-line. */
const NEWLINE_SNAP_WINDOW = 200;
/** Each individual signal line is capped at this many characters. */
const SIGNAL_LINE_CHAR_CAP = 300;

/** Lines in the omitted middle matching this are surfaced as "signal lines". */
const SIGNAL_LINE_REGEX =
  /\b(error|errors|err!|fail|fails|failed|failure|failing|exception|traceback|warn|warning|fatal|panic|assert|assertion|denied|timeout|timed out|refused|rejected|cannot|not found|undefined is not|null is not|expected .* received)\b/i;

export interface ToolResultSummary {
  /** The text to hand to the model (original when not summarized). */
  text: string;
  /** True when the middle was actually dropped. */
  summarized: boolean;
  /** Length of the original input string (0 for non-strings). */
  originalChars: number;
  /** Characters dropped from the middle (0 when not summarized). */
  omittedChars: number;
  /** Signal lines surfaced from the omitted middle (0 when not summarized). */
  signalLineCount: number;
}

/** Coerce an optional tunable to a positive integer, else the default. */
function toPositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function passthrough(text: string, originalChars: number): ToolResultSummary {
  return { text, summarized: false, originalChars, omittedChars: 0, signalLineCount: 0 };
}

/** True when `text` is a string strictly longer than the threshold. Total. */
export function shouldSummarizeToolResult(text: unknown, thresholdChars?: number): boolean {
  if (typeof text !== 'string') return false;
  const threshold = toPositiveInt(thresholdChars, TOOL_RESULT_SUMMARY_THRESHOLD_CHARS);
  return text.length > threshold;
}

/**
 * Summarize an oversized tool-result string: keep head + tail verbatim
 * (line-boundary-snapped), drop the middle, surface capped/deduped signal
 * lines from the omitted region, and insert an explicit marker with the real
 * kept/omitted numbers. Under-threshold or non-string input passes through
 * unchanged (non-string → empty text). Never throws.
 */
export function summarizeToolResultText(
  text: unknown,
  opts?: { thresholdChars?: number; headChars?: number; tailChars?: number },
): ToolResultSummary {
  if (typeof text !== 'string') return passthrough('', 0);
  const options = opts && typeof opts === 'object' ? opts : {};
  const threshold = toPositiveInt(options.thresholdChars, TOOL_RESULT_SUMMARY_THRESHOLD_CHARS);
  const headChars = toPositiveInt(options.headChars, SUMMARY_HEAD_CHARS);
  const tailChars = toPositiveInt(options.tailChars, SUMMARY_TAIL_CHARS);
  const originalChars = text.length;
  if (originalChars <= threshold) return passthrough(text, originalChars);

  // HEAD cut: back up to the previous newline when one is within the snap
  // window of the cut, so the head ends on a complete line.
  let headEnd = Math.min(headChars, originalChars);
  const prevNewline = text.lastIndexOf('\n', headEnd);
  if (prevNewline > 0 && headEnd - prevNewline <= NEWLINE_SNAP_WINDOW) headEnd = prevNewline;

  // Degenerate opts guard: if head + tail would cover the whole string there
  // is no middle to omit — pass through unchanged rather than fabricate.
  const rawTailStart = originalChars - tailChars;
  if (rawTailStart <= headEnd) return passthrough(text, originalChars);

  // TAIL cut: move forward to just after the next newline when one is within
  // the snap window, so the tail starts on a complete line.
  let tailStart = rawTailStart;
  const nextNewline = text.indexOf('\n', tailStart);
  if (nextNewline >= 0 && nextNewline - tailStart <= NEWLINE_SNAP_WINDOW && nextNewline + 1 < originalChars) {
    tailStart = nextNewline + 1;
  }

  const head = text.slice(0, headEnd);
  const tail = text.slice(tailStart);
  const middle = text.slice(headEnd, tailStart);
  const omittedChars = middle.length;

  // SIGNAL LINES from the omitted middle only: trimmed, per-line capped,
  // deduped exact-after-trim, capped by line count and total characters.
  const seen = new Set<string>();
  const signalLines: string[] = [];
  let signalCharsUsed = 0;
  for (const rawLine of middle.split(/\r?\n/)) {
    if (signalLines.length >= SUMMARY_SIGNAL_LINE_MAX) break;
    if (!SIGNAL_LINE_REGEX.test(rawLine)) continue;
    let line = rawLine.trim();
    if (line.length > SIGNAL_LINE_CHAR_CAP) line = line.slice(0, SIGNAL_LINE_CHAR_CAP);
    if (line === '' || seen.has(line)) continue;
    if (signalCharsUsed + line.length > SUMMARY_SIGNAL_CHARS) break;
    seen.add(line);
    signalLines.push(line);
    signalCharsUsed += line.length;
  }

  const marker =
    `[…tool result summarized: kept first ${head.length} + last ${tail.length} chars of ` +
    `${originalChars}; ${omittedChars} chars omitted; ${signalLines.length} signal lines follow]`;
  const signalBlock =
    signalLines.length > 0 ? `signal lines from omitted output:\n${signalLines.join('\n')}` : '';
  const composed = `${head}\n\n${marker}\n${signalBlock}\n\n${tail}`;

  return {
    text: composed,
    summarized: true,
    originalChars,
    omittedChars,
    signalLineCount: signalLines.length,
  };
}

/** Convenience: just the model-facing text. Total. */
export function summarizeToolResultForModel(
  text: unknown,
  opts?: { thresholdChars?: number; headChars?: number; tailChars?: number },
): string {
  return summarizeToolResultText(text, opts).text;
}
