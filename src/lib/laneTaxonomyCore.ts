// laneTaxonomyCore — the ONE reconciled chat-lane taxonomy (IMPROVE #2 of
// docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md).
//
// The stack grew TWO incoherent "lane" vocabularies, so "lane health" could not
// mean one thing:
//
//   * TRANSPORT-centric — `swanbotLaneTelemetryCore.ChatLane` = 'v1' | 'v2' |
//     'none'. Which EDGE terminated a `callSwanBotAI` turn (swanbot-ai v1 relay
//     vs swanbot-v2-ai vs neither). Built this session; still UNWIRED.
//   * SURFACE-centric — `chatLaneOutcome.ChatLaneId` = 'stream' | 'batch' |
//     'openswan_v2' | 'automation_plan' | 'command' | 'conversational_intent' |
//     'computer_task' | 'send_message'. Which USER-FACING lane produced the
//     turn. WIRED to `chatLaneHealthRegistry`. `chatPromptAssembly.ChatPromptLane`
//     ('stream' | 'batch' | 'openswan_v2' | 'conversational_build') is a third,
//     prompt-shaping cut of the same surface idea.
//
// This module folds all three onto ONE 3-axis descriptor — surface × transport ×
// loop — so a turn's lane is fully identified and the health registry can record
// the WHOLE descriptor instead of one axis. The two source vocabularies become
// two AXES of the same thing, not two competing labels.
//
// Axis grounding (read from the live runtime, not guessed):
//   * SURFACE (`UnifiedLane`) — the four `chatPromptAssembly.ChatPromptLane`
//     lanes, plus `v1_relay` (the surface name for a turn the v1 relay served)
//     and `unknown` (unattributed / no dedicated lane).
//   * TRANSPORT — `swanbotLaneTelemetryCore.ChatLane` ('v1' | 'v2' | 'none')
//     PLUS 'stream' (the chat-stream SSE edge, which that transport taxonomy
//     never modeled). So every `ChatLane` value is a valid transport token.
//   * LOOP — the three tool-execution loops the plan's debt table names, plus
//     'none':
//       - 'legacy'     = swanbot-ai's `executeToolUseLoop` server loop (v1).
//       - 'edge_v2'    = the swanbot-v2-ai server loop (`callSwanBotV2`,
//                        swanbot.ts:1143) — the batch lane's v2 attempt.
//       - 'agent_core' = the client-side typed loop `agentExecutionCore.runAgent`.
//                        OpenSwan sessions run THIS (openswanSessionRuntime.ts:869,
//                        "O1 cutover: the typed agentExecutionCore loop is the
//                        default"), and the stream lane renders its event stream —
//                        which is why openswan_v2 and stream both map to it.
//       - 'none'       = no loop ran (unattributed / blocked / no auth).
//
// The one genuine ambiguity is transport 'v2': it fronts BOTH the swanbot-v2-ai
// server loop (edge_v2, used by the `batch` surface) AND `runAgent` (agent_core,
// used by the `openswan_v2` surface). So the loop is resolved from the
// (transport, surface) PAIR: v2 → agent_core ONLY for the openswan_v2 surface,
// else edge_v2. Every other transport pins its loop unambiguously (v1→legacy,
// stream→agent_core, none→none). This is what makes folding a v1↔v2 fallback
// correct: a `batch` turn that fell back to the v1 relay is
// {surface:'batch', transport:'v1', loop:'legacy'}, not a phantom edge_v2 run.
//
// Non-canonical `ChatLaneId`s fold as documented in SURFACE_ALIASES:
// conversational_intent→conversational_build (same feature: conversationalRouter
// / conversationalBuild.ts), automation_plan→batch (the structured/batch response
// family). `command` / `computer_task` / `send_message` have no dedicated
// UnifiedLane yet and fold to 'unknown' (the registry still keys their raw id
// separately) — extend UNIFIED_LANES before promoting them.
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: lane-taxonomy-core). No
// Date.now / Math.random. Every export is TOTAL: null / undefined / wrong-type /
// huge / hostile / cyclic input never throws; it collapses to a bounded,
// enum-only, secret-safe result. The classifier reads only two string tags; it
// never touches tokens, prompts, or response bodies.

/** The reconciled SURFACE axis — one user-facing lane per value. Supersedes
 *  `chatLaneOutcome.ChatLaneId` (surface) and folds `chatPromptAssembly.
 *  ChatPromptLane`. `unknown` = unattributed or no dedicated lane. */
export type UnifiedLane =
  | 'stream'
  | 'batch'
  | 'openswan_v2'
  | 'v1_relay'
  | 'conversational_build'
  | 'unknown';

/** The TRANSPORT axis — `swanbotLaneTelemetryCore.ChatLane` ('v1'|'v2'|'none')
 *  plus 'stream' (the SSE edge that taxonomy never modeled). */
export type LaneTransport = 'v1' | 'v2' | 'stream' | 'none';

/** The LOOP axis — the three tool-execution loops the plan names, plus 'none'. */
export type LaneLoop = 'agent_core' | 'edge_v2' | 'legacy' | 'none';

/** The fully-identified lane of one chat turn: surface × transport × loop. */
export interface LaneDescriptor {
  surface: UnifiedLane;
  transport: LaneTransport;
  loop: LaneLoop;
}

/** Either or both axes a caller can observe about a turn. Both optional +
 *  `unknown` so a partial or hostile caller can never break the mapper. */
export interface LaneDescriptorInput {
  /** A surface-lane id (UnifiedLane, ChatLaneId, or ChatPromptLane). */
  surfaceLane?: unknown;
  /** A transport id (LaneTransport or `swanbotLaneTelemetryCore.ChatLane`). */
  transport?: unknown;
}

// ─── Frozen catalogs (for consumers initializing per-axis counters) ──────────

export const UNIFIED_LANES: readonly UnifiedLane[] = Object.freeze([
  'stream',
  'batch',
  'openswan_v2',
  'v1_relay',
  'conversational_build',
  'unknown',
]);

export const LANE_TRANSPORTS: readonly LaneTransport[] = Object.freeze([
  'v1',
  'v2',
  'stream',
  'none',
]);

export const LANE_LOOPS: readonly LaneLoop[] = Object.freeze([
  'agent_core',
  'edge_v2',
  'legacy',
  'none',
]);

// ─── Canonical per-axis tables (the single source of the mapping) ────────────

/** Each surface's canonical transport when no explicit transport is observed.
 *  `batch` and `openswan_v2` are both v2 surfaces; `batch` ATTEMPTS the
 *  swanbot-v2-ai edge first (falls back to the v1 relay → surface `v1_relay`). */
const CANONICAL_TRANSPORT_BY_SURFACE: Readonly<Record<UnifiedLane, LaneTransport>> =
  Object.freeze({
    stream: 'stream',
    batch: 'v2',
    openswan_v2: 'v2',
    v1_relay: 'v1',
    conversational_build: 'stream',
    unknown: 'none',
  });

/** The DEFAULT surface for a bare transport token (transport→surface half of the
 *  bidirectional map). v2's default is `openswan_v2` (per the plan's taxonomy),
 *  even though `batch` is also a v2 surface. */
const DEFAULT_SURFACE_BY_TRANSPORT: Readonly<Record<LaneTransport, UnifiedLane>> =
  Object.freeze({
    v1: 'v1_relay',
    v2: 'openswan_v2',
    stream: 'stream',
    none: 'unknown',
  });

/** Recognized non-canonical surface tokens → their UnifiedLane home. */
const SURFACE_ALIASES: Readonly<Record<string, UnifiedLane>> = Object.freeze({
  // chatLaneOutcome.ChatLaneId names that fold to a canonical lane:
  conversational_intent: 'conversational_build',
  automation_plan: 'batch',
  // command / computer_task / send_message intentionally absent → 'unknown'.
});

const CANONICAL_SURFACE_SET: ReadonlySet<string> = new Set(UNIFIED_LANES as string[]);
const TRANSPORT_TOKEN_SET: ReadonlySet<string> = new Set(LANE_TRANSPORTS as string[]);

// ─── Coercion (strict token recognition; null = unrecognized/absent) ─────────

/** Recognize a surface token exactly (canonical name or documented alias), else
 *  `null`. A transport token passed as a surface (e.g. 'v1') is a category
 *  error → `null` (→ 'unknown'), NOT silently reinterpreted. */
function coerceSurfaceToken(raw: unknown): UnifiedLane | null {
  if (typeof raw !== 'string') return null;
  if (CANONICAL_SURFACE_SET.has(raw)) return raw as UnifiedLane;
  const alias = SURFACE_ALIASES[raw];
  return alias || null;
}

/** Recognize a transport token exactly (incl. 'none'), else `null`. */
function coerceTransportToken(raw: unknown): LaneTransport | null {
  return typeof raw === 'string' && TRANSPORT_TOKEN_SET.has(raw)
    ? (raw as LaneTransport)
    : null;
}

/**
 * Resolve the loop from the (transport, surface) pair. Every transport pins its
 * loop unambiguously EXCEPT 'v2', which fronts both the swanbot-v2-ai server
 * loop (edge_v2) and `runAgent` (agent_core, the openswan_v2 surface only).
 */
function resolveLoop(transport: LaneTransport, surface: UnifiedLane): LaneLoop {
  switch (transport) {
    case 'v1':
      return 'legacy';
    case 'stream':
      return 'agent_core';
    case 'v2':
      return surface === 'openswan_v2' ? 'agent_core' : 'edge_v2';
    case 'none':
    default:
      return 'none';
  }
}

// ─── Total normalizers (public) ──────────────────────────────────────────────

/** Total: any surface-lane id → a UnifiedLane. Unrecognized / wrong-type /
 *  hostile → 'unknown' (never guesses a lane). */
export function normalizeSurfaceLane(raw: unknown): UnifiedLane {
  return coerceSurfaceToken(raw) ?? 'unknown';
}

/** Total: any transport id → a LaneTransport. Unrecognized / wrong-type /
 *  hostile → 'none'. Accepts every `swanbotLaneTelemetryCore.ChatLane` value. */
export function normalizeTransport(raw: unknown): LaneTransport {
  return coerceTransportToken(raw) ?? 'none';
}

/**
 * Fold a surface-lane id AND/OR a transport id onto the unified 3-axis
 * descriptor. Total and deterministic: any input (null, non-object, cyclic,
 * wrong-typed fields) yields a valid enum-only `LaneDescriptor` and never throws.
 *
 * Resolution (each axis independently total):
 *   surface   = explicit surface, else the transport's default surface, else 'unknown'.
 *   transport = explicit transport, else the surface's canonical transport.
 *   loop      = resolveLoop(transport, surface) — the (transport × surface) pair.
 *
 * Because the surface can be DERIVED from the transport and vice-versa, this is
 * the bidirectional map: pass a surface to learn its transport+loop, pass a
 * transport to learn its surface+loop, or pass both to reconcile them (a v1↔v2
 * fallback is captured correctly — batch+v1 → legacy loop, not phantom edge_v2).
 */
export function describeLane(input: LaneDescriptorInput): LaneDescriptor {
  const src: LaneDescriptorInput =
    input && typeof input === 'object' ? (input as LaneDescriptorInput) : {};

  const surfaceToken = coerceSurfaceToken(src.surfaceLane);
  const transportToken = coerceTransportToken(src.transport);

  const surface: UnifiedLane =
    surfaceToken ??
    (transportToken ? DEFAULT_SURFACE_BY_TRANSPORT[transportToken] : 'unknown');
  const transport: LaneTransport =
    transportToken ?? CANONICAL_TRANSPORT_BY_SURFACE[surface];
  const loop: LaneLoop = resolveLoop(transport, surface);

  return { surface, transport, loop };
}

/** Every canonical lane's full descriptor, frozen — the surface→(transport,loop)
 *  half of the bidirectional map, precomputed for consumers. */
export const CANONICAL_LANE_DESCRIPTORS: Readonly<Record<UnifiedLane, LaneDescriptor>> =
  Object.freeze(
    (UNIFIED_LANES as UnifiedLane[]).reduce((acc, surface) => {
      acc[surface] = describeLane({ surfaceLane: surface });
      return acc;
    }, {} as Record<UnifiedLane, LaneDescriptor>),
  );

// ─── Wiring helpers (stable, bounded, secret-safe) ───────────────────────────

/** Stable compact registry key / dedupe id for a descriptor. Total: coerces a
 *  partial/hostile descriptor through describeLane first, so any input keys. */
export function laneDescriptorKey(descriptor: LaneDescriptor | null | undefined): string {
  const d =
    descriptor && typeof descriptor === 'object'
      ? describeLane({ surfaceLane: descriptor.surface, transport: descriptor.transport })
      : describeLane({});
  return `${d.surface}/${d.transport}/${d.loop}`;
}

/** Archive-safe `key:value` tags for a descriptor (mirrors the tag style in
 *  chatLaneOutcome / chatLaneHealthRegistry). Bounded to 3 tags. */
export function describeLaneTags(descriptor: LaneDescriptor | null | undefined): string[] {
  const d =
    descriptor && typeof descriptor === 'object'
      ? describeLane({ surfaceLane: descriptor.surface, transport: descriptor.transport })
      : describeLane({});
  return [`lane_surface:${d.surface}`, `lane_transport:${d.transport}`, `lane_loop:${d.loop}`];
}
