/**
 * route-decision-telemetry-smoketest — covers src/lib/routeDecisionTelemetry.ts,
 * the per-decision telemetry half of the silent-mis-classification defense.
 *
 * The module is PURE and BOUNDED by contract; this suite proves each of those
 * invariants so a future edit that (a) loses a field, (b) shifts a confidence
 * threshold, (c) lets the ring grow unbounded or drop FIFO order, (d) leaks a
 * secret / un-clamps a string into the payload, or (e) throws on a degenerate
 * input fails loudly HERE rather than silently in production telemetry.
 *
 * Usage:
 *   npx tsx scripts/route-decision-telemetry-smoketest.ts
 * Exit 0 = all telemetry invariants hold.
 */

import {
  buildRouteDecisionRecord,
  buildRouteDecisionRecordFromRuntime,
  buildRouteDecisionTelemetryPayload,
  classifyRouteConfidence,
  recordSessionRouteDecision,
  getSessionRouteDecisions,
  resetSessionRouteDecisions,
  summarizeRouteDrift,
  type RouteDecisionRecord,
} from '../src/lib/routeDecisionTelemetry';
import type { ChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

let failures = 0;
let assertions = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  assertions += 1;
  if (cond) {
    console.log(`pass: ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${name}${detail ? `\n    ${detail}` : ''}`);
  }
}

function eq<T>(name: string, got: T, expected: T): void {
  ok(name, got === expected, `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

// ── Synthetic plan factory (no runtime planner needed — keep the smoke pure) ──
function synthPlan(overrides: Partial<{
  source: ChatAutomationPlan['source'];
  kind: ChatAutomationPlan['execution']['kind'];
  routeId: ChatAutomationPlan['execution']['routeId'];
  confidence: number;
  notes: string[];
}>): ChatAutomationPlan {
  return {
    source: overrides.source ?? 'plain_chat',
    intent: { kind: 'direct_chat', message: 'synthetic' },
    execution: {
      kind: overrides.kind ?? 'run_plain_chat',
      routeId: overrides.routeId ?? null,
      commandText: 'synthetic',
    },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: overrides.confidence ?? 0.4,
    notes: overrides.notes ?? ['synthetic note'],
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1. buildRouteDecisionRecord — derive a record from a ChatAutomationPlan
// ════════════════════════════════════════════════════════════════════════════

{
  const rec = buildRouteDecisionRecord(
    synthPlan({ source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', confidence: 0.82, notes: ['Detected browser workflow.'] }),
    'claude-sonnet-4-6',
  );
  eq('record: lane prefers explicit routeId', rec.lane, 'browser');
  eq('record: executionKind carried through', rec.executionKind, 'run_computer_task');
  eq('record: resolved model carried through', rec.model, 'claude-sonnet-4-6');
  eq('record: confidence carried from plan', rec.confidence, 0.82);
  eq('record: source carried from plan', rec.source, 'plain_chat');
  eq('record: note is the first plan note', rec.note, 'Detected browser workflow.');
}

{
  // No routeId → lane falls back to the plan source (never empty).
  const rec = buildRouteDecisionRecord(
    synthPlan({ source: 'conversational_intent', kind: 'run_command_handler', routeId: null, confidence: 0.85 }),
    null,
  );
  eq('record: lane falls back to source when routeId null', rec.lane, 'conversational_intent');
  eq('record: null model preserved as null', rec.model, null);
}

{
  // Degenerate: null plan must not throw and must yield a safe record.
  const rec = buildRouteDecisionRecord(null, undefined);
  eq('record: null plan → lane "unknown"', rec.lane, 'unknown');
  eq('record: null plan → executionKind "unknown"', rec.executionKind, 'unknown');
  eq('record: null plan → model null', rec.model, null);
  eq('record: null plan → confidence null', rec.confidence, null);
  eq('record: null plan → source "unknown"', rec.source, 'unknown');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. buildRouteDecisionRecordFromRuntime — the primitive-facts adapter
// ════════════════════════════════════════════════════════════════════════════

{
  const rec = buildRouteDecisionRecordFromRuntime({
    lane: 'main_chat:build',
    executionKind: 'run_openswan',
    model: 'claude-opus-4-8',
    confidence: null,
    source: 'openswan_session_runtime',
    note: 'allowed tools: 12',
  });
  eq('runtime-record: lane carried', rec.lane, 'main_chat:build');
  eq('runtime-record: executionKind carried', rec.executionKind, 'run_openswan');
  eq('runtime-record: model carried', rec.model, 'claude-opus-4-8');
  eq('runtime-record: null confidence stays null', rec.confidence, null);
  eq('runtime-record: source carried', rec.source, 'openswan_session_runtime');
}

{
  // Band words map to representative numbers so callers can pass 'high' etc.
  const high = buildRouteDecisionRecordFromRuntime({ confidence: 'high' });
  const low = buildRouteDecisionRecordFromRuntime({ confidence: 'low' });
  ok('runtime-record: "high" band → high classification', classifyRouteConfidence(high.confidence) === 'high');
  ok('runtime-record: "low" band → low classification', classifyRouteConfidence(low.confidence) === 'low');
  // Degenerate: empty facts never throw and produce safe defaults.
  const empty = buildRouteDecisionRecordFromRuntime(undefined);
  eq('runtime-record: undefined facts → lane "unknown"', empty.lane, 'unknown');
  eq('runtime-record: undefined facts → source "runtime"', empty.source, 'runtime');
}

// ════════════════════════════════════════════════════════════════════════════
// 3. classifyRouteConfidence — BOUNDARY-EXACT thresholds
//    >= 0.85 high, >= 0.6 medium, < 0.6 low, null/NaN unknown.
// ════════════════════════════════════════════════════════════════════════════

eq('confidence: 0.85 is high (floor inclusive)', classifyRouteConfidence(0.85), 'high');
eq('confidence: 0.8499 is medium (just below high floor)', classifyRouteConfidence(0.8499), 'medium');
eq('confidence: 1 is high', classifyRouteConfidence(1), 'high');
eq('confidence: 0.6 is medium (floor inclusive)', classifyRouteConfidence(0.6), 'medium');
eq('confidence: 0.5999 is low (just below medium floor)', classifyRouteConfidence(0.5999), 'low');
eq('confidence: 0 is low', classifyRouteConfidence(0), 'low');
eq('confidence: null is unknown', classifyRouteConfidence(null), 'unknown');
eq('confidence: undefined is unknown', classifyRouteConfidence(undefined), 'unknown');
eq('confidence: NaN is unknown', classifyRouteConfidence(NaN), 'unknown');
// Out-of-range values clamp, not crash: >1 → high, <0 → low.
eq('confidence: 1.5 clamps to high', classifyRouteConfidence(1.5), 'high');
eq('confidence: -0.2 clamps to low', classifyRouteConfidence(-0.2), 'low');

// ════════════════════════════════════════════════════════════════════════════
// 4. Session ring — FIFO cap of 50
// ════════════════════════════════════════════════════════════════════════════

resetSessionRouteDecisions();
eq('ring: starts empty after reset', getSessionRouteDecisions().length, 0);

recordSessionRouteDecision(buildRouteDecisionRecordFromRuntime({ lane: 'a', source: 's1' }));
recordSessionRouteDecision(buildRouteDecisionRecordFromRuntime({ lane: 'b', source: 's2' }));
eq('ring: two appends → length 2', getSessionRouteDecisions().length, 2);
eq('ring: preserves insertion order (oldest first)', getSessionRouteDecisions()[0].lane, 'a');
eq('ring: newest last', getSessionRouteDecisions()[1].lane, 'b');

// getSessionRouteDecisions returns a COPY — mutating it must not affect the ring.
{
  const snapshot = getSessionRouteDecisions();
  snapshot.push(buildRouteDecisionRecordFromRuntime({ lane: 'z' }));
  eq('ring: returned array is a copy (mutation does not leak)', getSessionRouteDecisions().length, 2);
}

// Overflow: push 60 total, expect exactly 50 kept, and the FIRST 10 evicted.
resetSessionRouteDecisions();
for (let i = 0; i < 60; i += 1) {
  recordSessionRouteDecision(buildRouteDecisionRecordFromRuntime({ lane: `lane-${i}`, source: 'overflow' }));
}
const ring = getSessionRouteDecisions();
eq('ring: capped at 50 after 60 appends', ring.length, 50);
eq('ring: FIFO — oldest kept is #10', ring[0].lane, 'lane-10');
eq('ring: FIFO — newest kept is #59', ring[ring.length - 1].lane, 'lane-59');

// Degenerate: recording null/garbage never throws and stores a safe record.
resetSessionRouteDecisions();
recordSessionRouteDecision(null as unknown as RouteDecisionRecord);
recordSessionRouteDecision({} as RouteDecisionRecord);
eq('ring: null/empty records coerced, not dropped', getSessionRouteDecisions().length, 2);
eq('ring: coerced record has safe lane', getSessionRouteDecisions()[0].lane, 'unknown');

// ════════════════════════════════════════════════════════════════════════════
// 5. summarizeRouteDrift — flag low-confidence spike + lane-flip pattern
// ════════════════════════════════════════════════════════════════════════════

{
  eq('drift: empty → no-decisions message', summarizeRouteDrift([]), 'route-drift: no decisions recorded');
}

{
  // All high-confidence, single lane each kind → stable.
  const stable: RouteDecisionRecord[] = [
    buildRouteDecisionRecordFromRuntime({ lane: 'browser', executionKind: 'run_computer_task', confidence: 0.9 }),
    buildRouteDecisionRecordFromRuntime({ lane: 'browser', executionKind: 'run_computer_task', confidence: 0.88 }),
    buildRouteDecisionRecordFromRuntime({ lane: 'memory', executionKind: 'run_command_handler', confidence: 0.85 }),
  ];
  ok('drift: stable set reports stable', summarizeRouteDrift(stable).includes('stable across 3'));
}

{
  // Low-confidence spike: 5 low routes trips the default threshold.
  const lowSpike: RouteDecisionRecord[] = Array.from({ length: 5 }, () =>
    buildRouteDecisionRecordFromRuntime({ lane: 'browser', executionKind: 'run_computer_task', confidence: 0.3 }),
  );
  const summary = summarizeRouteDrift(lowSpike);
  ok('drift: 5 low routes flag a LOW-CONFIDENCE SPIKE', summary.includes('LOW-CONFIDENCE SPIKE'), summary);
}

{
  // Below threshold: 4 low routes with a custom threshold of 5 → no spike flag.
  const belowSpike: RouteDecisionRecord[] = Array.from({ length: 4 }, () =>
    buildRouteDecisionRecordFromRuntime({ lane: 'browser', executionKind: 'run_computer_task', confidence: 0.3 }),
  );
  const summary = summarizeRouteDrift(belowSpike, { lowConfidenceThreshold: 5 });
  ok('drift: 4 low routes (threshold 5) do NOT flag a spike', !summary.includes('LOW-CONFIDENCE SPIKE'), summary);
}

{
  // Lane flip: the SAME execution kind lands in TWO different lanes.
  const flip: RouteDecisionRecord[] = [
    buildRouteDecisionRecordFromRuntime({ lane: 'browser', executionKind: 'run_computer_task', confidence: 0.9 }),
    buildRouteDecisionRecordFromRuntime({ lane: 'desktop', executionKind: 'run_computer_task', confidence: 0.9 }),
  ];
  const summary = summarizeRouteDrift(flip);
  ok('drift: same kind across two lanes flags a LANE FLIP', summary.includes('LANE FLIP'), summary);
}

{
  // Custom low threshold of 1 makes a single low route trip the spike.
  const single = [buildRouteDecisionRecordFromRuntime({ lane: 'a', executionKind: 'run_openswan', confidence: 0.2 })];
  ok('drift: threshold 1 trips on a single low route', summarizeRouteDrift(single, { lowConfidenceThreshold: 1 }).includes('LOW-CONFIDENCE SPIKE'));
}

{
  // Degenerate: null argument falls back to the (freshly reset) session ring.
  resetSessionRouteDecisions();
  ok('drift: null arg on empty ring → no-decisions', summarizeRouteDrift(null) === 'route-drift: no decisions recorded');
}

// ════════════════════════════════════════════════════════════════════════════
// 6. buildRouteDecisionTelemetryPayload — bounded JSON + no secrets
// ════════════════════════════════════════════════════════════════════════════

{
  const payload = buildRouteDecisionTelemetryPayload(
    buildRouteDecisionRecord(
      synthPlan({ kind: 'run_computer_task', routeId: 'browser', confidence: 0.82, notes: ['note one'] }),
      'claude-sonnet-4-6',
    ),
  );
  eq('payload: lane present', payload.lane, 'browser');
  eq('payload: execution_kind present (snake_case)', payload.execution_kind, 'run_computer_task');
  eq('payload: model present', payload.model, 'claude-sonnet-4-6');
  eq('payload: confidence present', payload.confidence, 0.82);
  eq('payload: confidence_band derived', payload.confidence_band, 'medium');
  eq('payload: source present', payload.source, 'plain_chat');
  eq('payload: note present', payload.note, 'note one');
}

{
  // Bounding: an absurdly long note MUST be clamped in the payload.
  const longNote = 'x'.repeat(5000);
  const payload = buildRouteDecisionTelemetryPayload(
    buildRouteDecisionRecord(synthPlan({ notes: [longNote], confidence: 0.5 }), 'm'),
  );
  ok('payload: long note clamped to <= 240 chars', String(payload.note).length <= 240, `len=${String(payload.note).length}`);
}

{
  // Bounding: an absurdly long model id MUST be clamped.
  const payload = buildRouteDecisionTelemetryPayload(
    buildRouteDecisionRecordFromRuntime({ model: 'model/' + 'y'.repeat(5000) }),
  );
  ok('payload: long model clamped to <= 120 chars', String(payload.model).length <= 120, `len=${String(payload.model).length}`);
}

{
  // NO SECRETS: only the whitelisted keys may appear. A record cannot smuggle
  // extra fields into the payload (the builder reads a fixed set).
  const sneaky = {
    lane: 'browser',
    executionKind: 'run_computer_task',
    model: 'm',
    confidence: 0.9,
    source: 'plain_chat',
    note: 'ok',
    apiKey: 'sk-SECRET-should-never-appear',
    authToken: 'bearer-SECRET',
  } as unknown as RouteDecisionRecord;
  const payload = buildRouteDecisionTelemetryPayload(sneaky);
  const keys = Object.keys(payload).sort();
  const allowed = ['confidence', 'confidence_band', 'execution_kind', 'lane', 'model', 'note', 'source'];
  ok('payload: only whitelisted keys emitted', keys.every((k) => allowed.includes(k)), `keys=${keys.join(',')}`);
  ok('payload: no secret key leaks through', !('apiKey' in payload) && !('authToken' in payload));
  const serialized = JSON.stringify(payload);
  ok('payload: serialized JSON contains no secret value', !serialized.includes('SECRET'), serialized);
}

{
  // Degenerate: null record → safe payload, never throws.
  const payload = buildRouteDecisionTelemetryPayload(null);
  eq('payload: null record → lane "unknown"', payload.lane, 'unknown');
  eq('payload: null record → confidence null', payload.confidence, null);
  eq('payload: null record → band "unknown"', payload.confidence_band, 'unknown');
}

// ════════════════════════════════════════════════════════════════════════════
// 7. Degenerate inputs across the whole API never throw
// ════════════════════════════════════════════════════════════════════════════

{
  let threw = false;
  try {
    buildRouteDecisionRecord({ execution: {} } as unknown as ChatAutomationPlan, undefined);
    buildRouteDecisionRecordFromRuntime({ confidence: NaN as unknown as number });
    buildRouteDecisionTelemetryPayload({ confidence: Infinity } as unknown as RouteDecisionRecord);
    classifyRouteConfidence('not-a-number' as unknown as number);
    summarizeRouteDrift([null as unknown as RouteDecisionRecord]);
    recordSessionRouteDecision(undefined as unknown as RouteDecisionRecord);
  } catch (e) {
    threw = true;
    console.error('    threw:', e);
  }
  ok('degenerate: no API call throws on garbage input', !threw);
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('');
console.log(`Route-decision telemetry: ${assertions} assertions.`);
if (failures > 0) {
  console.error(`\n${failures} telemetry smoke failure(s).`);
  process.exit(1);
}
console.log('\nAll route-decision telemetry invariants hold.');
