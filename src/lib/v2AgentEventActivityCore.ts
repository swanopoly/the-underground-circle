/**
 * v2AgentEventActivityCore — pure `AgentEvent → UX-activity row` mapper.
 *
 * ADR-0002 Core C (`docs/adr/ADR-0002-loop-convergence.md:198`-`210`,
 * `docs/LOOP_CONVERGENCE_RUNBOOK.md` §2.8). When the `batch` chat lane repoints
 * from the `swanbot-v2-ai` edge `runLoop` onto the client-side
 * `agentExecutionCore.runAgent`, the loop stops being an opaque HTTP call and
 * starts emitting a live `AgentEvent` stream. This module keeps the user-facing
 * progress narration at PARITY with what the edge surfaced, so the flip is a
 * strict UX improvement (a narrated strip instead of a static spinner) rather
 * than a regression.
 *
 * The v2 edge surfaced activity on TWO channels:
 *   (a) DURABLE `agent_run_events` rows — `turn_start` / `turn_end` /
 *       `tool_call_start` / `tool_call_result` — written inside `runLoop`
 *       (`supabase/functions/swanbot-v2-ai/index.ts:2514`, `:2533`, `:2629`,
 *       `:2635`). After convergence this durability is preserved by streaming
 *       `runAgent`'s `onEvent` into the persistence handle (runbook §3) — NOT
 *       this core.
 *   (b) LIVE narration — `emitSwanBotActivity(toolActivityLabel(name, input))`
 *       on the client continuation path (`src/lib/swanbot.ts:1258`-`1260`):
 *       "Reading the screen…" / "Running tests…".
 *
 * THIS core owns channel (b): it turns the SAME `AgentEvent` stream into
 * bounded, secret-safe narration rows a chat surface can push straight into
 * `emitSwanBotActivity` / `setCurrentRunStep`, reusing the already-pure
 * `toolActivityLabel`. It also exposes `accumulateUsageFromEvents` — a usage
 * rollup over `turn_end` events that mirrors the edge's
 * `agentRunTokenUsageFields` (`index.ts:2402`-`2412`) so the telemetry-parity
 * terminal write (runbook §3) can populate `input_tokens` / `output_tokens` /
 * `cached_tokens` identically to the edge cohort.
 *
 * PURITY CONTRACT (load-bearing — the smoke runs under tsx/esbuild):
 *  - The ONLY imports are (1) a type-only import of `AgentEvent` from
 *    `agentExecutionCore` (elided by esbuild, so its react-native/supabase deps
 *    never load) and (2) value imports from `toolActivityLabelCore`, itself a
 *    zero-runtime-import pure module. No react-native, no supabase, no app I/O.
 *  - Every export is TOTAL: never throws on ANY input (null / undefined / wrong
 *    types / throwing getters / cyclic / megabyte payloads) — it returns a safe
 *    neutral (`null`, `[]`, or a zeroed usage object) instead.
 *  - Deterministic: no `Date.now()` / `Math.random()`; same input, same output.
 *  - Bounded: labels ≤ MAX_ACTIVITY_LABEL_CHARS, details ≤
 *    MAX_ACTIVITY_DETAIL_CHARS, stream output ≤ maxStreamRows, input scans ≤
 *    maxEventsScanned.
 *  - Secret-safe: a row NEVER carries raw tool input, `result.data`,
 *    `result.error`, model deltas, or final-response text. Labels come from the
 *    already-sanitising `toolActivityLabel` (command fragments are whitelisted);
 *    details are limited to catalog tool names and loop-internal reason strings,
 *    both control-stripped and length-capped.
 */

import type { AgentEvent } from './agentExecutionCore';
import {
  toolActivityLabel,
  FALLBACK_ACTIVITY_LABEL,
  MAX_ACTIVITY_LABEL_CHARS,
} from './toolActivityLabelCore';

/** Coarse category for a narration row, so a surface can style/route it. */
export type AgentActivityKind =
  /** A model turn is starting (the agent is "thinking"). */
  | 'thinking'
  /** A tool is running — the primary narration ("Reading the screen…"). */
  | 'tool'
  /** A tool round failed and the loop is recovering. */
  | 'tool_error'
  /** A loop-lifecycle status (compaction / steering / solver / stop / cap). */
  | 'status';

/** A bounded, secret-safe UX narration row. */
export type AgentActivityRow = {
  kind: AgentActivityKind;
  /** User-facing present-tense label, ≤ MAX_ACTIVITY_LABEL_CHARS, control-free. */
  label: string;
  /** Optional safe qualifier (catalog tool name / loop reason). Omitted when empty. */
  detail?: string;
};

/** Token rollup mirroring the edge's `agentRunTokenUsageFields` columns. */
export type AgentActivityUsage = {
  /** Uncached input tokens (Anthropic `input_tokens`). */
  inputTokens: number;
  /** Output tokens. */
  outputTokens: number;
  /** cache_read + cache_creation input tokens. */
  cachedTokens: number;
};

/** Detail cap — shorter than the label cap; a detail is a qualifier, not prose. */
export const MAX_ACTIVITY_DETAIL_CHARS = 60;

/** Hard bounds for the stream/usage builders. */
export const V2_AGENT_ACTIVITY_LIMITS = Object.freeze({
  maxLabelChars: MAX_ACTIVITY_LABEL_CHARS,
  maxDetailChars: MAX_ACTIVITY_DETAIL_CHARS,
  /** Max rows `buildActivityStreamFromEvents` returns. */
  maxStreamRows: 200,
  /** Max input events any builder scans (guards a hostile/giant array). */
  maxEventsScanned: 20_000,
});

/**
 * Canonical user-facing labels for the non-tool events. Frozen single source of
 * truth (the smoke asserts against these, not string literals). Tool events get
 * their label from `toolActivityLabel`, not this table.
 */
export const V2_AGENT_ACTIVITY_LABELS = Object.freeze({
  thinking: 'Thinking…',
  toolError: 'Recovering from an error…',
  contextCompressed: 'Tidying up the context…',
  solverConsultation: 'Rethinking the approach…',
  steeringApplied: 'Taking your note into account…',
  loopStopped: 'Stopped: no further progress.',
  maxIterations: 'Reached the step limit.',
});

/** Control characters (C0, DEL, C1) — built via fromCharCode so this source
 *  file stays plain ASCII. Deterministic module-init construction. */
const CONTROL_CHARS = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31)
      + String.fromCharCode(127) + '-' + String.fromCharCode(159) + ']',
  'g',
);

/** Strip control chars, collapse whitespace, cap length, never empty. Mirrors
 *  `toolActivityLabelCore.finalizeLabel` (not exported there) so every row —
 *  tool labels included — satisfies the same bound regardless of source. */
function clampLabel(raw: unknown): string {
  try {
    if (typeof raw !== 'string') return FALLBACK_ACTIVITY_LABEL;
    const cleaned = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return FALLBACK_ACTIVITY_LABEL;
    if (cleaned.length <= MAX_ACTIVITY_LABEL_CHARS) return cleaned;
    return `${cleaned.slice(0, MAX_ACTIVITY_LABEL_CHARS - 1)}…`;
  } catch {
    return FALLBACK_ACTIVITY_LABEL;
  }
}

/** Sanitise a detail qualifier: string-only, control-stripped, whitespace
 *  collapsed, length-capped. Returns undefined for anything unusable so the
 *  row simply omits `detail`. */
function safeDetail(raw: unknown): string | undefined {
  try {
    if (typeof raw !== 'string') return undefined;
    const cleaned = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return undefined;
    if (cleaned.length <= MAX_ACTIVITY_DETAIL_CHARS) return cleaned;
    return `${cleaned.slice(0, MAX_ACTIVITY_DETAIL_CHARS - 1)}…`;
  } catch {
    return undefined;
  }
}

/** Build a row with both fields sanitised. `detail` is omitted when unusable. */
function row(kind: AgentActivityKind, label: string, detailSource?: unknown): AgentActivityRow {
  const detail = safeDetail(detailSource);
  const clamped = clampLabel(label);
  return detail === undefined ? { kind, label: clamped } : { kind, label: clamped, detail };
}

/** Finite number or 0 (guards NaN / Infinity / non-number). */
function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

/** Floor + clamp ≥ 0 — byte-parity with the edge's `agentRunTokenUsageFields`. */
function clampCount(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Map ONE `AgentEvent` to a narration row, or `null` when the event carries no
 * user-facing progress (streamed text, checkpoints, turn-usage telemetry, the
 * final answer itself, or an unknown/garbage shape).
 *
 * TOTAL: never throws. Any non-event input → `null`.
 *
 * Mapping (parity with the edge's surfaced activity):
 *   - `turn_start`               → thinking row.
 *   - `tool_call_start`          → tool row, label = `toolActivityLabel`, detail = tool name.
 *   - `tool_call_result` (ok:false) → tool_error row (recovering); ok:true/unknown → null.
 *   - `context_compressed`       → status (compaction).
 *   - `solver_consultation`      → status (re-plan).
 *   - `steering_applied`         → status (user note taken).
 *   - `loop_stopped_no_progress` → status, detail = loop reason.
 *   - `max_iterations_exceeded`  → status (cap reached).
 *   - `model_delta` / `turn_end` / `iteration_complete` / `final_response` → null.
 */
export function agentEventToActivity(event: unknown): AgentActivityRow | null {
  try {
    if (!event || typeof event !== 'object') return null;
    const e = event as Record<string, unknown>;
    const kind = typeof e.kind === 'string' ? e.kind : '';
    switch (kind as AgentEvent['kind']) {
      case 'turn_start':
        return row('thinking', V2_AGENT_ACTIVITY_LABELS.thinking);
      case 'tool_call_start':
        // Label is derived by the already-secret-safe toolActivityLabel (it
        // whitelists any command fragment); detail is the catalog tool name.
        return row('tool', toolActivityLabel(e.toolName, e.input), e.toolName);
      case 'tool_call_result': {
        // Only a DEFINITE failure narrates ("recovering…"). A success is
        // superseded by the next step's label, and a malformed/absent result
        // can't be narrated — both → null (keeps the strip clean). The tool's
        // error text is NEVER surfaced (it can carry secrets/paths).
        const result = e.result;
        const ok = result && typeof result === 'object'
          ? (result as Record<string, unknown>).ok
          : undefined;
        return ok === false ? row('tool_error', V2_AGENT_ACTIVITY_LABELS.toolError, e.toolName) : null;
      }
      case 'context_compressed':
        return row('status', V2_AGENT_ACTIVITY_LABELS.contextCompressed);
      case 'solver_consultation':
        return row('status', V2_AGENT_ACTIVITY_LABELS.solverConsultation);
      case 'steering_applied':
        return row('status', V2_AGENT_ACTIVITY_LABELS.steeringApplied);
      case 'loop_stopped_no_progress':
        // `reason` is a loop-internal string (tool NAMES only, never input) from
        // the stuck/oscillation detectors — safe, still sanitised + bounded.
        return row('status', V2_AGENT_ACTIVITY_LABELS.loopStopped, e.reason);
      case 'max_iterations_exceeded':
        return row('status', V2_AGENT_ACTIVITY_LABELS.maxIterations);
      // Non-narration events — no row:
      case 'model_delta':        // streamed text; not a discrete row
      case 'turn_end':           // usage telemetry — see accumulateUsageFromEvents
      case 'iteration_complete': // resumable checkpoint
      case 'final_response':     // the answer itself; narration ends here
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Map an `AgentEvent[]` to an ordered narration stream. Nulls are dropped and
 * consecutive identical rows (same kind+label+detail) are collapsed, so a run
 * that re-enters "Thinking…" between rounds doesn't spam the strip.
 *
 * TOTAL + bounded: non-array → `[]`; scans at most `maxEventsScanned` events and
 * returns at most `maxStreamRows` rows (stops early once full). Never throws.
 */
export function buildActivityStreamFromEvents(events: unknown): AgentActivityRow[] {
  const out: AgentActivityRow[] = [];
  try {
    if (!Array.isArray(events)) return out;
    const scanLimit = Math.min(events.length, V2_AGENT_ACTIVITY_LIMITS.maxEventsScanned);
    for (let i = 0; i < scanLimit; i++) {
      const next = agentEventToActivity(events[i]);
      if (!next) continue;
      const prev = out[out.length - 1];
      if (prev && prev.kind === next.kind && prev.label === next.label && prev.detail === next.detail) {
        continue; // collapse consecutive duplicates
      }
      out.push(next);
      if (out.length >= V2_AGENT_ACTIVITY_LIMITS.maxStreamRows) break;
    }
  } catch {
    /* total — return whatever was collected */
  }
  return out;
}

/**
 * Accumulate token usage across the run's `turn_end` events, mirroring the
 * edge's `addUsage` + `agentRunTokenUsageFields` (`index.ts:2402`-`2412`). The
 * client `AgentEvent` carries Anthropic's raw usage shape
 * (`input_tokens` / `output_tokens` / `cache_read_input_tokens` /
 * `cache_creation_input_tokens`); this rolls it up into the three agent_runs
 * columns so the telemetry-parity terminal write (runbook §3) matches the edge
 * cohort. Secret-free (numbers only) and TOTAL — non-array / garbage → zeros.
 */
export function accumulateUsageFromEvents(events: unknown): AgentActivityUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  try {
    if (Array.isArray(events)) {
      const scanLimit = Math.min(events.length, V2_AGENT_ACTIVITY_LIMITS.maxEventsScanned);
      for (let i = 0; i < scanLimit; i++) {
        const ev = events[i];
        if (!ev || typeof ev !== 'object') continue;
        const rec = ev as Record<string, unknown>;
        if (rec.kind !== 'turn_end') continue;
        const usage = rec.usage;
        if (!usage || typeof usage !== 'object') continue;
        const u = usage as Record<string, unknown>;
        inputTokens += num(u.input_tokens);
        outputTokens += num(u.output_tokens);
        cachedTokens += num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
      }
    }
  } catch {
    /* total — fall through to whatever was summed */
  }
  return {
    inputTokens: clampCount(inputTokens),
    outputTokens: clampCount(outputTokens),
    cachedTokens: clampCount(cachedTokens),
  };
}
