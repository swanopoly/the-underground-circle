/**
 * toolLoopStuckBreaker — detect when a tool loop is stuck repeating a call that
 * already failed, and emit a nudge that breaks the cycle.
 *
 * Failure mode this guards: the model emits `desktop.click_element("Export")`,
 * it fails ("element not found"), and next round it emits the *exact same call*
 * again — a deterministic failure that just burns rounds until the step cap.
 * When a call's (name + input) signature matches a prior failure, we append a
 * "you already tried this, do something different" reminder to its tool_result
 * so the model escalates the surface ladder, re-observes, asks, or stops —
 * instead of looping.
 *
 * Pure + side-effect free → smoke testable. Wired into executeToolUseLoop the
 * same way appActionVerificationGate is: by augmenting tool_result content.
 */

import { formatSurfaceLadderHint } from './appSurfaceLadder';

export interface ToolCallRecord {
  tool: string;
  input?: unknown;
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
  return text.slice(0, 120);
}

/**
 * Stable signature for a tool call: name + canonical JSON of the input (object
 * keys sorted so {a,b} and {b,a} collide). Used to tell "the same call" from "a
 * different call". Falls back to a string form if the input isn't serializable.
 */
export function toolCallSignature(tool: string, input: unknown): string {
  let inputKey: string;
  try {
    inputKey = JSON.stringify(input ?? null, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((acc, k) => { (acc as any)[k] = (v as any)[k]; return acc; }, {} as Record<string, unknown>)
        : v,
    );
  } catch {
    inputKey = String(input);
  }
  return `${tool}::${inputKey}`;
}

export interface StuckRepeatVerdict {
  /** True when this exact (name+input) call has already failed at least once. */
  isRepeat: boolean;
  /** How many prior failures of this exact call are in the history. */
  priorFailures: number;
  /** Reason from the most recent prior failure of this call, if any. */
  lastReason?: string;
}

/**
 * Did `current` (name+input) already fail earlier in `history`? Only exact
 * signature matches count — if the model changed the input (i.e. fixed its
 * approach), the signature differs and it is not flagged.
 */
export function detectStuckRepeat(
  history: ToolCallRecord[] | null | undefined,
  current: { tool: string; input?: unknown },
  opts: { lookback?: number } = {},
): StuckRepeatVerdict {
  const list = Array.isArray(history) ? history : [];
  const lookback = Math.max(1, opts.lookback ?? 24);
  const sig = toolCallSignature(current.tool, current.input);
  let priorFailures = 0;
  let lastReason: string | undefined;
  for (const event of list.slice(-lookback)) {
    if (!failed(event.status)) continue;
    if (toolCallSignature(event.tool, event.input) !== sig) continue;
    priorFailures += 1;
    const reason = shortReason(event.result);
    if (reason) lastReason = reason;
  }
  return { isRepeat: priorFailures > 0, priorFailures, lastReason };
}

/**
 * Reminder appended to a tool_result when the call just repeated a prior
 * failure. Names the failure, forbids re-running the identical call, and lists
 * the productive alternatives (re-observe, escalate the surface ladder, ask,
 * or stop and report) so the loop can't keep spinning on a doomed action.
 */
export function stuckBreakerReminder(tool: string, priorFailures: number, lastReason?: string): string {
  const attempts = priorFailures + 1; // prior failures + this one
  const reasonTail = lastReason ? ` (last error: ${lastReason})` : '';
  // Name the concrete next tools when this is a known UI-action tool; otherwise
  // fall back to the generic ladder description.
  const ladderHint = formatSurfaceLadderHint(tool);
  const escalationLine = ladderHint
    ? `2. Escalate to a different surface — ${ladderHint}.`
    : '2. Escalate the surface ladder: semantic → menu → keyboard shortcut → one bounded coordinate action.';
  return [
    '',
    `⚠️ Stuck-loop guard: \`${tool}\` with these exact inputs has now failed ${attempts} time${attempts === 1 ? '' : 's'}${reasonTail}.`,
    'Do NOT call it again unchanged — that will fail the same way. Instead pick one:',
    '1. Re-observe fresh state (read the a11y tree / screenshot / list) — the target may have moved, be named differently, or not exist yet.',
    escalationLine,
    '3. Change the inputs (different selector, label, path, or value) based on what you just observed.',
    '4. If it genuinely cannot be done this way, stop and report the blocker to the user — do not keep retrying.',
  ].join('\n');
}

/**
 * Convenience for the loop: given the prior tool history and the just-dispatched
 * call + its status/result, return the content to feed back — augmented with a
 * stuck-breaker reminder only when this call repeats a prior failure AND failed
 * again now. Otherwise returns `content` unchanged.
 */
export function appendStuckBreaker(
  content: string,
  history: ToolCallRecord[] | null | undefined,
  current: { tool: string; input?: unknown; status?: string | null },
): string {
  if (!failed(current.status)) return content;
  const verdict = detectStuckRepeat(history, current);
  if (!verdict.isRepeat) return content;
  return `${content}${stuckBreakerReminder(current.tool, verdict.priorFailures, verdict.lastReason)}`;
}

// ─── Progress-based loop exit (not iteration-cap based) ──────────────────────
//
// Raising the iteration cap just makes a runaway loop more expensive. The real
// exit is PROGRESS-based: if the model keeps emitting the SAME tool with the
// SAME input and it keeps FAILING, stop — don't retry. `detectStuckRepeat`
// above augments a *single* repeated call's feedback; the helpers below let the
// loop take a HARD terminal decision when it sees ~3 identical failing calls in
// a row across recent rounds.

/** Max chars of the stable JSON we hash over, so a pathological giant input can
 *  neither blow up memory nor let two huge-but-different inputs collide only
 *  because they share a long identical prefix. */
export const TOOL_INPUT_HASH_MAX_CHARS = 2048;

/**
 * Stable, bounded hash of a tool input for repeat detection. Object keys are
 * sorted (so `{a,b}` and `{b,a}` collide), the JSON is length-bounded, and the
 * result is a short fixed-length string. Deterministic and side-effect free.
 *
 * This is intentionally the SAME canonicalization `toolCallSignature` uses (so
 * the two agree on "the same input"), just without the tool-name prefix and
 * folded to a compact digest suitable for a bounded recent-call ring.
 */
export function hashToolInput(input: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(input ?? null, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((acc, k) => { (acc as any)[k] = (v as any)[k]; return acc; }, {} as Record<string, unknown>)
        : v,
    );
  } catch {
    json = String(input);
  }
  if (typeof json !== 'string') json = String(json);
  const bounded = json.length > TOOL_INPUT_HASH_MAX_CHARS ? json.slice(0, TOOL_INPUT_HASH_MAX_CHARS) : json;
  // FNV-1a 32-bit over the bounded canonical JSON → stable short digest. We
  // prefix the length so a truncated-prefix collision is astronomically
  // unlikely (differing lengths never collide on the length component).
  let h = 0x811c9dc5;
  for (let i = 0; i < bounded.length; i++) {
    h ^= bounded.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const digest = (h >>> 0).toString(16).padStart(8, '0');
  return `${bounded.length.toString(16)}:${digest}`;
}

/** One entry in the loop's bounded recent-call ring. */
export interface RecentToolCall {
  name: string;
  inputHash: string;
  ok: boolean;
}

export interface RepeatedFailureVerdict {
  stuck: boolean;
  reason: string;
}

/**
 * PROGRESS-based stop signal. Fires when the last `threshold` (default 3) calls
 * are ALL:
 *   • the SAME tool name, AND
 *   • the SAME input hash, AND
 *   • failed (`ok === false`).
 * i.e. the loop is re-sampling an identical action that keeps failing → stop or
 * replan, do NOT run it again.
 *
 * Deterministic and conservative — it must NOT fire on:
 *   • fewer than `threshold` calls,
 *   • repeated DIFFERENT calls (different name OR different input),
 *   • any SUCCESS in the window (a mix of ok/fail is not "stuck"),
 *   • the same failing signature interleaved with other calls (the LAST
 *     `threshold` must be contiguous and identical).
 * Only the most recent `threshold` calls are inspected, so an old failure
 * followed by real progress never trips it.
 */
export function detectRepeatedToolFailure(
  recentCalls: ReadonlyArray<RecentToolCall> | null | undefined,
  opts: { threshold?: number } = {},
): RepeatedFailureVerdict {
  const list = Array.isArray(recentCalls) ? recentCalls : [];
  const threshold = Math.max(2, Math.floor(opts.threshold ?? 3));
  if (list.length < threshold) return { stuck: false, reason: '' };
  const window = list.slice(-threshold);
  const [first, ...rest] = window;
  if (!first) return { stuck: false, reason: '' };
  // All in the window must be the same failing (name+hash) signature.
  if (first.ok) return { stuck: false, reason: '' };
  for (const call of rest) {
    if (call.ok) return { stuck: false, reason: '' };
    if (call.name !== first.name || call.inputHash !== first.inputHash) {
      return { stuck: false, reason: '' };
    }
  }
  return {
    stuck: true,
    reason: `repeated identical failing call — ${first.name} x${threshold}`,
  };
}
