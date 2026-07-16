// swanbotLaneTelemetryCore — the PURE classifier for a main-chat turn's TERMINAL
// lane outcome (v1/v2 consolidation, docs/SWANBOT_V2_MIGRATION_PLAN.md M5).
//
// Today `callSwanBotAI` (src/lib/swanbot.ts ~2296-2421) routes a turn through v2
// first and, on any v2 TRANSPORT failure (null text / thrown invoke), falls
// through to the legacy v1 edge — SILENTLY. There is no record of how often that
// fallback fires, whether v1 then serves, or how many turns v1 still carries on
// its own. M5 ("delete v1") cannot be scheduled without that data. This module
// owns the deterministic, side-effect-free half: given the observable signals at
// `callSwanBotAI`'s single (post-refactor) exit, it names WHICH lane terminated
// the turn and HOW, and whether the turn fell back v2 -> v1. A tiny runtime store
// (recordChatLaneTerminalNow, out of scope here) buckets the result over time.
//
// Every `callSwanBotAI` exit maps to exactly one LaneTerminal:
//   * v2 returned text            (swanbot.ts:2350) -> v2 / served_ok
//   * v2 returned a config body    (:2353)          -> v2 / body_error
//   * strict-local block            (:2363)          -> none / blocked
//   * no access token               (:2368)          -> none / no_auth
//   * v2 null/threw, then v1 text   (:2416 w/ fb)    -> v1 / fell_back_to_v1
//   * v1 returned data.error        (:2414)          -> v1 / body_error
//   * v1 invoke null / no body      (:2410)          -> v1 / transport_null
//   * v1 catch (threw)              (:2419)          -> v1 / threw
//   * clean v1 (v2 disabled) text   (:2416 no fb)    -> v1 / served_ok
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: swanbot-lane-telemetry-core).
// No Date.now/Math.random — the caller stamps time in the "…Now" recorder, not
// here. Every export is TOTAL: null / undefined / wrong-type / huge / hostile /
// cyclic input never throws; it collapses to a safe, bounded, enum-only result.
// Secret-safe: the classifier reads only booleans + a lane tag; it never touches
// tokens, prompts, or response bodies.

/** Which lane produced the turn's terminal result. `'none'` = neither lane
 *  served (pre-invoke block / missing auth / unattributed). */
export type ChatLane = 'v2' | 'v1' | 'none';

/** How the terminal lane ended.
 *  - `served_ok`        — a lane returned a real answer (no fallback).
 *  - `body_error`       — the edge ran and returned a coded error body.
 *  - `transport_null`   — the invoke returned no answer and no error body.
 *  - `threw`            — the lane's invoke threw (network/runtime).
 *  - `no_auth`          — no access token; v1 never invoked.
 *  - `blocked`          — strict-local-AI mode blocked the external provider.
 *  - `fell_back_to_v1`  — v2 was attempted, did not serve, and v1 then answered. */
export type LaneOutcome =
  | 'served_ok'
  | 'body_error'
  | 'transport_null'
  | 'threw'
  | 'no_auth'
  | 'blocked'
  | 'fell_back_to_v1';

/** The classified terminal state of one chat turn. `fellBack` is TRUE exactly
 *  when v2 was attempted, did not serve, and control reached the v1 tier that
 *  ran — orthogonal to `outcome` so telemetry can count "v2 tried v1" turns
 *  regardless of how v1 then ended (served / body_error / threw / transport). */
export interface LaneTerminal {
  lane: ChatLane;
  outcome: LaneOutcome;
  fellBack: boolean;
}

/** The observable signals a single-exit `callSwanBotAI` wrapper collects across
 *  its v2 / block / auth / v1 branches. All optional + `unknown` so a partial or
 *  hostile caller can never break the classifier. */
export interface LaneTerminalInput {
  /** The lane the caller believes terminated the turn (`'v2' | 'v1' | 'none'`). */
  lane?: unknown;
  /** A non-null response reached the caller (a lane served an answer). */
  hasResponse?: unknown;
  /** The terminal result carried a coded error body (edge ran, config/permanent). */
  bodyError?: unknown;
  /** The terminal lane's invoke threw (transport/runtime). */
  threw?: unknown;
  /** Auth state; pass literal `false` for the missing-access-token exit. */
  authed?: unknown;
  /** Strict-local-AI mode blocked the external provider before v1 invoked. */
  blocked?: unknown;
  /** v2 was attempted, did not serve, and the v1 tier then ran. */
  usedV1AfterV2?: unknown;
}

/** Every valid lane, frozen — for consumers initializing per-lane counters. */
export const CHAT_LANES: readonly ChatLane[] = Object.freeze(['v2', 'v1', 'none']);

/** Every valid outcome, frozen — for consumers initializing per-outcome counters. */
export const LANE_OUTCOMES: readonly LaneOutcome[] = Object.freeze([
  'served_ok',
  'body_error',
  'transport_null',
  'threw',
  'no_auth',
  'blocked',
  'fell_back_to_v1',
]);

/** Strict boolean: only the literal `true` counts. The real caller computes each
 *  flag as a boolean, so this keeps hostile non-booleans (1, 'yes', {}, …) as a
 *  safe `false` neutral instead of coercing them. */
function isTrue(value: unknown): boolean {
  return value === true;
}

/** Narrow an arbitrary value to a known lane, else `null`. */
function sanitizeLane(value: unknown): ChatLane | null {
  return value === 'v2' || value === 'v1' || value === 'none' ? value : null;
}

/**
 * Classify one chat turn's terminal lane outcome — the single classifier for
 * every `callSwanBotAI` exit. Total and deterministic: any input (including
 * `null`, non-objects, cyclic graphs, or wrong-typed fields) yields a valid
 * enum-only `LaneTerminal` and never throws.
 *
 * Precedence (first match wins), chosen to mirror the code path's own order —
 * pre-v1-invoke gates first, then v1/v2 terminal signals:
 *   1. `blocked`            -> none / blocked        (strict-local gate)
 *   2. `authed === false`   -> none / no_auth        (missing access token)
 *   3. `threw`              -> lane / threw
 *   4. `hasResponse`        -> lane / served_ok | fell_back_to_v1
 *   5. `bodyError`          -> lane / body_error
 *   6. otherwise            -> lane / transport_null
 *
 * `fellBack` is TRUE only when v2 was attempted AND the v1 tier ran (i.e. not on
 * the pre-invoke block / no-auth gates). When `fellBack` is true the terminal
 * lane is definitionally `'v1'`; a clean `served_ok` becomes `fell_back_to_v1`.
 */
export function classifyLaneTerminal(input: LaneTerminalInput): LaneTerminal {
  const src: LaneTerminalInput =
    input && typeof input === 'object' ? (input as LaneTerminalInput) : {};

  // (1)/(2) Pre-v1-invoke gates: no lane served, so no fallback-serve either.
  if (isTrue(src.blocked)) {
    return { lane: 'none', outcome: 'blocked', fellBack: false };
  }
  if (src.authed === false) {
    return { lane: 'none', outcome: 'no_auth', fellBack: false };
  }

  // A lane ran (clean v2, clean v1, or v1-after-fallback). `fellBack` means v2
  // was attempted then the v1 tier took over → v1 is the terminal lane.
  const fellBack = isTrue(src.usedV1AfterV2);

  let outcome: LaneOutcome;
  if (isTrue(src.threw)) {
    outcome = 'threw';
  } else if (isTrue(src.hasResponse)) {
    outcome = fellBack ? 'fell_back_to_v1' : 'served_ok';
  } else if (isTrue(src.bodyError)) {
    outcome = 'body_error';
  } else {
    outcome = 'transport_null';
  }

  // Fallback pins the lane to v1; otherwise trust an explicit tag, and leave
  // genuinely unattributed turns as 'none' rather than GUESSING a lane (a guess
  // would bias the very v1-vs-v2 counts M5 depends on).
  const lane: ChatLane = fellBack ? 'v1' : sanitizeLane(src.lane) ?? 'none';

  return { lane, outcome, fellBack };
}
