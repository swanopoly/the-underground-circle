// Smoke test for laneTaxonomyCore — pure, tsx-loadable, deterministic.
// Run: npx tsx scripts/lane-taxonomy-core-smoketest.ts
import {
  describeLane,
  normalizeSurfaceLane,
  normalizeTransport,
  laneDescriptorKey,
  describeLaneTags,
  CANONICAL_LANE_DESCRIPTORS,
  UNIFIED_LANES,
  LANE_TRANSPORTS,
  LANE_LOOPS,
  type LaneDescriptor,
  type UnifiedLane,
  type LaneTransport,
  type LaneLoop,
} from '../src/lib/laneTaxonomyCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq<T>(a: T, b: T, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Assert a full LaneDescriptor shape in one call (3 assertions).
function assertDescriptor(
  d: LaneDescriptor,
  surface: UnifiedLane,
  transport: LaneTransport,
  loop: LaneLoop,
  label: string,
) {
  assertEq(d.surface, surface, label + ' .surface');
  assertEq(d.transport, transport, label + ' .transport');
  assertEq(d.loop, loop, label + ' .loop');
}

// Every result must be enum-only + shaped (used by the hostile group).
function assertWellFormed(d: any, label: string) {
  assert(!!d && typeof d === 'object', label + ' is object');
  assert((UNIFIED_LANES as readonly string[]).indexOf(d && d.surface) >= 0, label + ' surface in UNIFIED_LANES', String(d && d.surface));
  assert((LANE_TRANSPORTS as readonly string[]).indexOf(d && d.transport) >= 0, label + ' transport in LANE_TRANSPORTS', String(d && d.transport));
  assert((LANE_LOOPS as readonly string[]).indexOf(d && d.loop) >= 0, label + ' loop in LANE_LOOPS', String(d && d.loop));
}

function main() {
  // ── 1) canonical descriptor per UnifiedLane surface (surface-only) ──────────
  // openswan_v2 → v2/agent_core: OpenSwan sessions run agentExecutionCore.runAgent.
  assertDescriptor(describeLane({ surfaceLane: 'openswan_v2' }), 'openswan_v2', 'v2', 'agent_core', '1a openswan_v2');
  // batch → v2/edge_v2: batch attempts the swanbot-v2-ai server loop.
  assertDescriptor(describeLane({ surfaceLane: 'batch' }), 'batch', 'v2', 'edge_v2', '1b batch');
  // stream → stream/agent_core (agent_core-adjacent SSE lane).
  assertDescriptor(describeLane({ surfaceLane: 'stream' }), 'stream', 'stream', 'agent_core', '1c stream');
  // v1_relay → v1/legacy (swanbot-ai executeToolUseLoop).
  assertDescriptor(describeLane({ surfaceLane: 'v1_relay' }), 'v1_relay', 'v1', 'legacy', '1d v1_relay');
  // conversational_build → stream/agent_core (lean client build lane).
  assertDescriptor(describeLane({ surfaceLane: 'conversational_build' }), 'conversational_build', 'stream', 'agent_core', '1e conversational_build');
  // unknown → none/none.
  assertDescriptor(describeLane({ surfaceLane: 'unknown' }), 'unknown', 'none', 'none', '1f unknown');

  // ── 2) transport-only describeLane (transport → its default surface+loop) ───
  // transport 'v2' → surface openswan_v2 (the default v2 surface), agent_core.
  assertDescriptor(describeLane({ transport: 'v2' }), 'openswan_v2', 'v2', 'agent_core', '2a transport v2 → openswan_v2');
  // transport 'v1' → v1_relay/legacy.
  assertDescriptor(describeLane({ transport: 'v1' }), 'v1_relay', 'v1', 'legacy', '2b transport v1 → v1_relay');
  // transport 'stream' → stream/agent_core.
  assertDescriptor(describeLane({ transport: 'stream' }), 'stream', 'stream', 'agent_core', '2c transport stream → stream');
  // transport 'none' → unknown/none.
  assertDescriptor(describeLane({ transport: 'none' }), 'unknown', 'none', 'none', '2d transport none → unknown');

  // ── 3) both inputs present and AGREEING ─────────────────────────────────────
  assertDescriptor(describeLane({ surfaceLane: 'openswan_v2', transport: 'v2' }), 'openswan_v2', 'v2', 'agent_core', '3a openswan_v2 + v2 agree');
  assertDescriptor(describeLane({ surfaceLane: 'stream', transport: 'stream' }), 'stream', 'stream', 'agent_core', '3b stream + stream agree');
  assertDescriptor(describeLane({ surfaceLane: 'v1_relay', transport: 'v1' }), 'v1_relay', 'v1', 'legacy', '3c v1_relay + v1 agree');
  assertDescriptor(describeLane({ surfaceLane: 'batch', transport: 'v2' }), 'batch', 'v2', 'edge_v2', '3d batch + v2 agree');
  // Agreement invariant: for a canonical surface, passing its own canonical
  // transport reproduces the surface-only descriptor exactly.
  for (const surface of UNIFIED_LANES) {
    const only = describeLane({ surfaceLane: surface });
    const both = describeLane({ surfaceLane: surface, transport: only.transport });
    assertEq(both.surface, only.surface, '3e[' + surface + '] agree surface');
    assertEq(both.transport, only.transport, '3f[' + surface + '] agree transport');
    assertEq(both.loop, only.loop, '3g[' + surface + '] agree loop');
  }

  // ── 4) both inputs present and DISAGREEING (fallback / cross cases) ──────────
  // batch fell back to the v1 relay → loop legacy, NOT phantom edge_v2. This is
  // the exact case folding a swanbot v2→v1 fallback must get right.
  assertDescriptor(describeLane({ surfaceLane: 'batch', transport: 'v1' }), 'batch', 'v1', 'legacy', '4a batch + v1 fallback → legacy');
  // batch with transport 'none' (blocked / no-auth terminal) → loop none.
  assertDescriptor(describeLane({ surfaceLane: 'batch', transport: 'none' }), 'batch', 'none', 'none', '4b batch + none → none loop');
  // openswan_v2 forced onto v1 → legacy loop (explicit transport wins the axis).
  assertDescriptor(describeLane({ surfaceLane: 'openswan_v2', transport: 'v1' }), 'openswan_v2', 'v1', 'legacy', '4c openswan_v2 + v1 → legacy');
  // stream forced onto v2 (non-openswan v2) → edge_v2.
  assertDescriptor(describeLane({ surfaceLane: 'stream', transport: 'v2' }), 'stream', 'v2', 'edge_v2', '4d stream + v2 → edge_v2');
  // explicit 'unknown' surface stays unknown even with a live transport.
  assertDescriptor(describeLane({ surfaceLane: 'unknown', transport: 'v2' }), 'unknown', 'v2', 'edge_v2', '4e explicit unknown + v2');

  // ── 5) surface aliases fold (chatLaneOutcome / prompt-assembly names) ───────
  // conversational_intent (chatLaneOutcome) ≡ conversational_build.
  assertDescriptor(describeLane({ surfaceLane: 'conversational_intent' }), 'conversational_build', 'stream', 'agent_core', '5a conversational_intent alias');
  // automation_plan folds to the batch (structured-response) family.
  assertDescriptor(describeLane({ surfaceLane: 'automation_plan' }), 'batch', 'v2', 'edge_v2', '5b automation_plan → batch');
  // ChatLaneIds with no dedicated unified lane → unknown (no guess).
  assertDescriptor(describeLane({ surfaceLane: 'command' }), 'unknown', 'none', 'none', '5c command → unknown');
  assertDescriptor(describeLane({ surfaceLane: 'computer_task' }), 'unknown', 'none', 'none', '5d computer_task → unknown');
  assertDescriptor(describeLane({ surfaceLane: 'send_message' }), 'unknown', 'none', 'none', '5e send_message → unknown');

  // ── 6) normalizeSurfaceLane — total ─────────────────────────────────────────
  assertEq(normalizeSurfaceLane('stream'), 'stream', '6a canonical stream');
  assertEq(normalizeSurfaceLane('batch'), 'batch', '6b canonical batch');
  assertEq(normalizeSurfaceLane('openswan_v2'), 'openswan_v2', '6c canonical openswan_v2');
  assertEq(normalizeSurfaceLane('v1_relay'), 'v1_relay', '6d canonical v1_relay');
  assertEq(normalizeSurfaceLane('conversational_build'), 'conversational_build', '6e canonical conversational_build');
  assertEq(normalizeSurfaceLane('unknown'), 'unknown', '6f canonical unknown');
  assertEq(normalizeSurfaceLane('conversational_intent'), 'conversational_build', '6g alias conversational_intent');
  assertEq(normalizeSurfaceLane('automation_plan'), 'batch', '6h alias automation_plan');
  // A transport token passed as a surface is a category error → unknown.
  assertEq(normalizeSurfaceLane('v1'), 'unknown', '6i transport token as surface → unknown');
  assertEq(normalizeSurfaceLane('v2'), 'unknown', '6j transport token as surface → unknown');
  // Garbage / wrong-case / wrong-type → unknown.
  assertEq(normalizeSurfaceLane('Stream'), 'unknown', '6k wrong-case → unknown');
  assertEq(normalizeSurfaceLane('bogus'), 'unknown', '6l bogus → unknown');
  assertEq(normalizeSurfaceLane(''), 'unknown', '6m empty → unknown');
  assertEq(normalizeSurfaceLane(42 as unknown), 'unknown', '6n number → unknown');
  assertEq(normalizeSurfaceLane(null as unknown), 'unknown', '6o null → unknown');
  assertEq(normalizeSurfaceLane(undefined as unknown), 'unknown', '6p undefined → unknown');
  assertEq(normalizeSurfaceLane({} as unknown), 'unknown', '6q object → unknown');

  // ── 7) normalizeTransport — total (accepts every ChatLane value) ────────────
  assertEq(normalizeTransport('v1'), 'v1', '7a v1');
  assertEq(normalizeTransport('v2'), 'v2', '7b v2');
  assertEq(normalizeTransport('stream'), 'stream', '7c stream');
  assertEq(normalizeTransport('none'), 'none', '7d none');
  // A surface token passed as a transport → none.
  assertEq(normalizeTransport('batch'), 'none', '7e surface token as transport → none');
  assertEq(normalizeTransport('openswan_v2'), 'none', '7f surface token as transport → none');
  // Garbage / wrong-type → none.
  assertEq(normalizeTransport('V2'), 'none', '7g wrong-case → none');
  assertEq(normalizeTransport('edge_v2'), 'none', '7h loop token as transport → none');
  assertEq(normalizeTransport(''), 'none', '7i empty → none');
  assertEq(normalizeTransport(3 as unknown), 'none', '7j number → none');
  assertEq(normalizeTransport(null as unknown), 'none', '7k null → none');
  assertEq(normalizeTransport(undefined as unknown), 'none', '7l undefined → none');
  assertEq(normalizeTransport([] as unknown), 'none', '7m array → none');

  // ── 8) fold swanbotLaneTelemetryCore terminals (the wiring the plan asks) ────
  // A callSwanBotAI terminal is the BATCH surface; its `lane` is the transport.
  // v2 terminal → batch/v2/edge_v2 (the swanbot-v2-ai server loop served).
  assertDescriptor(describeLane({ surfaceLane: 'batch', transport: 'v2' }), 'batch', 'v2', 'edge_v2', '8a telemetry lane v2 → edge_v2');
  // v1 terminal (fell back) → batch/v1/legacy (the v1 relay loop served).
  assertDescriptor(describeLane({ surfaceLane: 'batch', transport: 'v1' }), 'batch', 'v1', 'legacy', '8b telemetry lane v1 → legacy');
  // none terminal (blocked / no auth) → batch/none/none (no loop ran).
  assertDescriptor(describeLane({ surfaceLane: 'batch', transport: 'none' }), 'batch', 'none', 'none', '8c telemetry lane none → none');
  // Folding a chatLaneOutcome envelope surface with no transport known also works.
  assertDescriptor(describeLane({ surfaceLane: 'openswan_v2' }), 'openswan_v2', 'v2', 'agent_core', '8d chatLaneOutcome surface only');

  // ── 9) CANONICAL_LANE_DESCRIPTORS + frozen catalogs ─────────────────────────
  assertEq(UNIFIED_LANES.length, 6, '9a UNIFIED_LANES length');
  assertEq(LANE_TRANSPORTS.length, 4, '9b LANE_TRANSPORTS length');
  assertEq(LANE_LOOPS.length, 4, '9c LANE_LOOPS length');
  assert(Object.isFrozen(UNIFIED_LANES), '9d UNIFIED_LANES frozen');
  assert(Object.isFrozen(LANE_TRANSPORTS), '9e LANE_TRANSPORTS frozen');
  assert(Object.isFrozen(LANE_LOOPS), '9f LANE_LOOPS frozen');
  assert(Object.isFrozen(CANONICAL_LANE_DESCRIPTORS), '9g CANONICAL_LANE_DESCRIPTORS frozen');
  // Every canonical descriptor matches describeLane(surface) and is well-formed.
  for (const surface of UNIFIED_LANES) {
    const canon = CANONICAL_LANE_DESCRIPTORS[surface];
    assertWellFormed(canon, '9h[' + surface + '] canonical');
    assertEq(canon.surface, surface, '9i[' + surface + '] canonical surface matches key');
    const fresh = describeLane({ surfaceLane: surface });
    assertEq(canon.transport, fresh.transport, '9j[' + surface + '] canonical transport stable');
    assertEq(canon.loop, fresh.loop, '9k[' + surface + '] canonical loop stable');
  }

  // ── 10) laneDescriptorKey + describeLaneTags (wiring helpers) ────────────────
  assertEq(laneDescriptorKey({ surface: 'openswan_v2', transport: 'v2', loop: 'agent_core' }), 'openswan_v2/v2/agent_core', '10a key openswan_v2');
  assertEq(laneDescriptorKey({ surface: 'v1_relay', transport: 'v1', loop: 'legacy' }), 'v1_relay/v1/legacy', '10b key v1_relay');
  // Total on a hostile/partial descriptor (coerces through describeLane).
  assertEq(laneDescriptorKey(null), 'unknown/none/none', '10c key null → neutral');
  assertEq(laneDescriptorKey({ surface: 'bogus', transport: 'bogus', loop: 'bogus' } as any), 'unknown/none/none', '10d key garbage → neutral');
  assertEq(laneDescriptorKey({ surface: 'batch' } as any), 'batch/v2/edge_v2', '10e key from partial surface');
  const tags = describeLaneTags({ surface: 'stream', transport: 'stream', loop: 'agent_core' });
  assertEq(tags.length, 3, '10f tags length');
  assertEq(tags[0], 'lane_surface:stream', '10g tag surface');
  assertEq(tags[1], 'lane_transport:stream', '10h tag transport');
  assertEq(tags[2], 'lane_loop:agent_core', '10i tag loop');
  const tagsNull = describeLaneTags(null);
  assertEq(tagsNull.length, 3, '10j tags null bounded');
  assertEq(tagsNull[0], 'lane_surface:unknown', '10k tags null neutral');

  // ── 11) full surface × transport sweep — every combo stays enum-only ────────
  const surfaceInputs: unknown[] = [
    'stream', 'batch', 'openswan_v2', 'v1_relay', 'conversational_build', 'unknown',
    'conversational_intent', 'automation_plan', 'command', 'computer_task', 'send_message',
    'garbage', '', undefined,
  ];
  const transportInputs: unknown[] = ['v1', 'v2', 'stream', 'none', 'garbage', '', undefined];
  let sweep = 0;
  for (const s of surfaceInputs) {
    for (const t of transportInputs) {
      const d = describeLane({ surfaceLane: s, transport: t });
      assertWellFormed(d, 'sweep#' + sweep);
      // Invariant: loop is fully determined by (transport, surface).
      if (d.transport === 'v1') assertEq(d.loop, 'legacy', 'sweep#' + sweep + ' v1⇒legacy');
      if (d.transport === 'none') assertEq(d.loop, 'none', 'sweep#' + sweep + ' none⇒none');
      if (d.transport === 'stream') assertEq(d.loop, 'agent_core', 'sweep#' + sweep + ' stream⇒agent_core');
      if (d.transport === 'v2') {
        assert(
          d.loop === (d.surface === 'openswan_v2' ? 'agent_core' : 'edge_v2'),
          'sweep#' + sweep + ' v2 loop by surface',
        );
      }
      // Invariant: describeLane is idempotent — re-describing its own output
      // reproduces it exactly (the descriptor is a fixed point).
      const round = describeLane({ surfaceLane: d.surface, transport: d.transport });
      assertEq(round.surface, d.surface, 'sweep#' + sweep + ' idem surface');
      assertEq(round.transport, d.transport, 'sweep#' + sweep + ' idem transport');
      assertEq(round.loop, d.loop, 'sweep#' + sweep + ' idem loop');
      sweep++;
    }
  }
  assertEq(sweep, surfaceInputs.length * transportInputs.length, '11a sweep count');

  // ── 12) hostile / degenerate inputs — MUST NOT THROW ────────────────────────
  const cyclic: any = { surfaceLane: 'openswan_v2', transport: 'v2' };
  cyclic.self = cyclic;
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    1,
    NaN,
    '',
    'openswan_v2',
    true,
    false,
    [],
    ['batch'],
    {},
    cyclic,
    () => 'v2',
    Symbol('x'),
    123n,
    { surfaceLane: {}, transport: [] },
    { surfaceLane: 'batch', transport: () => {} },
    { surfaceLane: Symbol('s'), transport: 123n },
    { surfaceLane: Object.create(null), transport: NaN },
    Object.create(null),
    new Map([['surfaceLane', 'batch']]),
  ];
  for (let i = 0; i < hostile.length; i++) {
    let out: LaneDescriptor | null = null;
    let threw = false;
    try {
      out = describeLane(hostile[i] as any);
    } catch (_e) {
      threw = true;
    }
    assert(!threw, '12.' + i + ' hostile describeLane did not throw');
    assertWellFormed(out, '12.' + i + ' hostile descriptor');
    // Helpers must also survive hostile descriptors.
    let helperThrew = false;
    try {
      laneDescriptorKey(out as any);
      describeLaneTags(out as any);
      normalizeSurfaceLane(hostile[i]);
      normalizeTransport(hostile[i]);
    } catch (_e) {
      helperThrew = true;
    }
    assert(!helperThrew, '12.' + i + ' hostile helpers did not throw');
  }
  // Specific neutral defaults for the most common degenerate calls.
  assertDescriptor(describeLane(null as any), 'unknown', 'none', 'none', '12null neutral');
  assertDescriptor(describeLane(undefined as any), 'unknown', 'none', 'none', '12undef neutral');
  assertDescriptor(describeLane([] as any), 'unknown', 'none', 'none', '12array neutral');
  assertDescriptor(describeLane('batch' as any), 'unknown', 'none', 'none', '12string neutral');
  assertDescriptor(describeLane({} as any), 'unknown', 'none', 'none', '12empty neutral');
}

main();
if (failures > 0) {
  console.error('\n' + failures + ' fail');
  process.exit(1);
}
console.log('\nAll laneTaxonomyCore smoke cases passed (' + passes + ' passed).');
