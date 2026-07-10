/**
 * toolFailureFeedback — turn a RAW tool-error string into a CLASSIFIED,
 * ACTIONABLE recovery template the model sees at maximum recency.
 *
 * Why this exists (research-backed loop-reliability upgrade): a raw tool-error
 * message fed straight back to the model ("Error: element not found") makes it
 * apologize and retry the *identical failing call* in a loop — especially
 * smaller models. The fix is not "try again"; it's a short imperative hint that
 * names the concrete recovery move ("re-observe the screen", "ask for
 * approval", "narrow the target"). We prepend that hint to the (clamped) error
 * so the model still sees what failed, now led by what to do about it.
 *
 * Pure + dependency-light (no imports) → smoke testable and safe to reuse from
 * the edge loop, the client bridge, and Node tests.
 *
 * SECURITY: this only reshapes text the model already sees. It never widens
 * what's exposed, and it clamps the original error so a giant/secret-bearing
 * error body can't be re-amplified into the prompt. Callers must still not put
 * raw secrets in tool errors — this is defense in depth, not a sanitizer.
 */

/** Recovery categories, ordered most-specific → generic. The first pattern that
 *  matches wins, so more-specific shapes (approval, document mismatch) are
 *  tested before broad ones (not_found, transient). */
export type ToolFailureCategory =
  | 'bridge_offline'
  | 'approval_required'
  | 'document_mismatch'
  | 'ambiguous_target'
  | 'not_found'
  | 'transient'
  | 'generic';

export interface ToolFailureClassification {
  category: ToolFailureCategory;
  /** Short, imperative recovery instruction the model should follow next. */
  actionableHint: string;
}

/** Max chars of the original error we echo back. Keeps a runaway/secret-bearing
 *  error body from being re-amplified into the prompt at max recency. */
export const TOOL_FAILURE_ERROR_CLAMP = 600;

// ── Category detectors ───────────────────────────────────────────────────────
// Each entry: a matcher over the lowercased error (plus the tool name), and the
// hint to attach. Evaluated top-to-bottom; first match wins. Order matters:
// approval/document/ambiguous are checked before the broad not_found/transient
// so a "document not found, needs approval" style error lands on the sharper
// bucket.

const HINTS: Record<ToolFailureCategory, string> = {
  bridge_offline:
    "The desktop bridge isn't running; ask the user to run `npm run bridge`, then re-observe.",
  approval_required:
    "This needs the user's approval; request it, don't retry.",
  document_mismatch:
    "Re-read the app's document status; the active document changed.",
  ambiguous_target:
    'The target was ambiguous; narrow it (exact name/id) before retrying.',
  not_found:
    'Re-observe first: run the read/inspect tool to confirm the target exists before acting.',
  transient:
    'Transient error; a single retry is OK, then stop.',
  generic:
    'This call failed; re-observe the current state before trying anything, and change your approach rather than repeating the same call.',
};

type Detector = { category: ToolFailureCategory; test: (err: string, tool: string) => boolean };

const DETECTORS: Detector[] = [
  // Bridge / connection down — the desktop/local bridge process isn't up. Very
  // specific phrasing so it doesn't swallow generic "connection reset" transients.
  {
    category: 'bridge_offline',
    test: (err) =>
      /\bbridge\b/.test(err) &&
      /\b(offline|not running|not connected|unavailable|down|disconnected|no bridge|econnrefused|connection refused)\b/.test(err),
  },
  // Explicit connection-refused to the local bridge even if the word "bridge"
  // isn't adjacent (localhost:7778 style refusals).
  {
    category: 'bridge_offline',
    test: (err) => /\beconnrefused\b/.test(err) && /\b(bridge|localhost|127\.0\.0\.1|778\d|1879\d)\b/.test(err),
  },
  // Approval / permission / consent gate. Checked before not_found so a
  // "permission denied" never reads as a missing target.
  {
    category: 'approval_required',
    test: (err) =>
      /\b(approval|approve|confirm(ation)?|consent|authoriz|permission|not permitted|requires (explicit )?(user )?(confirmation|approval)|blocked by (policy|a user constraint)|forbidden|hitl|human[- ]in[- ]the[- ]loop)\b/.test(err) &&
      // avoid matching a bare 403/"unauthorized" transient-auth shape below
      !/\b(rate.?limit|timed? ?out|timeout)\b/.test(err),
  },
  // Active document / target document changed out from under the action.
  {
    category: 'document_mismatch',
    test: (err) =>
      /\b(document|active doc|frontmost doc|open file)\b/.test(err) &&
      /\b(mismatch|changed|different|no longer|closed|switched|not the active|stale|out of date|unexpected document)\b/.test(err),
  },
  // Ambiguous / multiple matches — the selector wasn't unique.
  {
    category: 'ambiguous_target',
    test: (err) =>
      /\b(ambiguous|multiple (matches|elements|results|candidates)|more than one|not unique|several (matches|elements)|too many matches|matched \d+)\b/.test(err),
  },
  // Not found — the target file/element/app/window/selector doesn't exist (yet).
  {
    category: 'not_found',
    test: (err) =>
      /\b(not found|no such|does ?n['’]?t exist|doesnt exist|no (element|match|matches|results?|window|app|file|node|target)|unknown (element|selector|target|window)|could ?n['’]?t (find|locate)|cannot (find|locate)|unable to (find|locate)|missing (element|file|target|window)|404|no matching)\b/.test(err),
  },
  // Transient — rate limits, 5xx, timeouts, resets. A single retry is OK.
  {
    category: 'transient',
    test: (err) =>
      /\b(rate.?limit(ed)?|429|too many requests|timed? ?out|timeout|5\d\d\b|internal server error|bad gateway|service unavailable|gateway timeout|temporar(y|ily)|econnreset|etimedout|socket hang ?up|network error|try again later)\b/.test(err),
  },
];

/**
 * Classify a raw tool error into a recovery category + short imperative hint.
 * Deterministic: first matching detector wins; unmatched → generic.
 */
export function classifyToolFailure(
  toolName: string,
  errorText: string,
): ToolFailureClassification {
  const tool = String(toolName || '').toLowerCase();
  const err = String(errorText || '').toLowerCase();
  for (const d of DETECTORS) {
    if (d.test(err, tool)) {
      return { category: d.category, actionableHint: HINTS[d.category] };
    }
  }
  return { category: 'generic', actionableHint: HINTS.generic };
}

/** Clamp the original error so a huge/secret-bearing body isn't re-amplified
 *  into the prompt at max recency. Collapses whitespace, then truncates with a
 *  clear marker so the model knows content was dropped (not that it ended). */
function clampError(errorText: string): string {
  const text = String(errorText ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= TOOL_FAILURE_ERROR_CLAMP) return text;
  return `${text.slice(0, TOOL_FAILURE_ERROR_CLAMP)}…[truncated ${text.length - TOOL_FAILURE_ERROR_CLAMP} chars]`;
}

/**
 * Build the model-facing recovery string for a failed tool call:
 *
 *   [recovery] <imperative hint>
 *   <original error, clamped>
 *
 * The hint leads (max recency for the "what to do next" instruction); the
 * clamped original error follows so the model still knows exactly what failed.
 * Never throws.
 */
export function buildToolFailureFeedback(toolName: string, errorText: string): string {
  const { actionableHint } = classifyToolFailure(toolName, errorText);
  const clamped = clampError(errorText);
  return clamped
    ? `[recovery] ${actionableHint}\n${clamped}`
    : `[recovery] ${actionableHint}`;
}
