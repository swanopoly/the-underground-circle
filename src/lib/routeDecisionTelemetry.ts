/**
 * routeDecisionTelemetry — the #1 reliability upgrade from the routing
 * research: make SILENT ROUTE MIS-CLASSIFICATION observable.
 *
 * The dangerous failure mode is not a crash or a 500 — it is a router quietly
 * sending a task to the WRONG lane/model. To error monitoring that reads as
 * "the model got dumber": no exception fires, latency is normal, the response
 * is just subtly wrong for what the user asked. Both the GPT-5 launch outage
 * and Anthropic's Sep-2025 postmortem were this shape. The two defenses are
 * (1) a golden-canary CI smoke that fails when a known prompt drifts lanes
 * (see scripts/route-golden-canary-smoketest.ts), and (2) this module —
 * lightweight, per-decision telemetry so a lane flip or a spike of
 * low-confidence routes becomes VISIBLE in the run event stream and a future
 * dashboard, instead of invisible.
 *
 * Design rules (LOCKSTEP with the module's smoke,
 * scripts/route-decision-telemetry-smoketest.ts):
 *   - PURE. Zero runtime imports — `import type` only. This keeps the module
 *     tsx/esbuild-loadable in smokes (no react-native transitive pull-in) and
 *     safe to call from any surface (edge, web, native).
 *   - BOUNDED. Every string is clamped; the session ring is FIFO-capped. A
 *     telemetry payload can never balloon a message/event row.
 *   - NO SECRETS. Only the resolved model id, lane, execution kind, a numeric
 *     confidence, a short source label, and an optional clamped note ever
 *     leave this module. Raw prompts / credentials / tool args do NOT.
 *   - NEVER THROWS. Degenerate inputs (null, undefined, NaN, wrong shapes)
 *     degrade to safe defaults so a telemetry call can never break a run.
 */

import type { ChatAutomationPlan } from './chatAutomationPlanner';

/**
 * The compact, self-contained record of one routing decision. This is the
 * unit the ring stores and the payload builder serializes. Everything here is
 * a primitive so it survives JSON round-trips and carries no object identity.
 */
export type RouteDecisionRecord = {
  /** The lane the task was routed to (routeId, or a synthetic lane label). */
  lane: string;
  /** The planner's execution kind — e.g. run_plain_chat, run_computer_task. */
  executionKind: string;
  /** The resolved model string, or null when no model was resolved yet. */
  model: string | null;
  /** Planner confidence in [0,1], or null when the source has no confidence. */
  confidence: number | null;
  /** Where the decision came from — planner source, or a runtime seam label. */
  source: string;
  /** Optional short, secret-free annotation (e.g. the top planner note). */
  note?: string;
};

/** Coarse confidence band used by the drift summary + a future dashboard. */
export type RouteConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';

// ── Bounding constants ──────────────────────────────────────────────────────
// Kept small on purpose: this rides alongside far larger run/event payloads,
// so it must stay negligible. Clamp lengths are generous enough to be useful
// but never large enough to matter for row size.
const MAX_LANE_CHARS = 64;
const MAX_EXECUTION_KIND_CHARS = 64;
const MAX_MODEL_CHARS = 120;
const MAX_SOURCE_CHARS = 64;
const MAX_NOTE_CHARS = 240;
const SESSION_RING_CAP = 50;

/** Confidence band thresholds (documented so the smoke can assert the edges). */
const CONFIDENCE_HIGH_FLOOR = 0.85;
const CONFIDENCE_MEDIUM_FLOOR = 0.6;

function clampString(value: unknown, maxChars: number): string {
  // Collapse whitespace so a note never smuggles newlines into a log line.
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/**
 * Normalize any incoming confidence to a finite number in [0,1] or null.
 * Guards against NaN/Infinity/strings/out-of-range values so downstream
 * classification and JSON are always well-formed.
 */
function normalizeConfidence(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

/**
 * classifyRouteConfidence — bucket a numeric confidence into a coarse band.
 * Thresholds (boundary-inclusive on the floor):
 *   >= 0.85 → high, >= 0.6 → medium, < 0.6 → low, null/NaN → unknown.
 * A low band is the interesting signal: a run of low-confidence routes is how
 * silent mis-classification shows up before anyone notices "it got dumber".
 */
export function classifyRouteConfidence(confidence: number | null | undefined): RouteConfidenceBand {
  const normalized = normalizeConfidence(confidence);
  if (normalized === null) return 'unknown';
  if (normalized >= CONFIDENCE_HIGH_FLOOR) return 'high';
  if (normalized >= CONFIDENCE_MEDIUM_FLOOR) return 'medium';
  return 'low';
}

/**
 * buildRouteDecisionRecord — derive a bounded record from a ChatAutomationPlan
 * plus the resolved model string. This is the primary path: any caller that
 * has the planner's output can produce a telemetry record from it.
 *
 * Lane preference: the explicit execution.routeId when present (that is the
 * real lane), else the plan.source (plain_chat / conversational_intent / …)
 * as a synthetic lane so a lane is never empty. Confidence comes straight from
 * plan.confidence (normalized). The note is the plan's first note, clamped.
 */
export function buildRouteDecisionRecord(
  plan: ChatAutomationPlan | null | undefined,
  resolvedModel: string | null | undefined,
): RouteDecisionRecord {
  const execution = plan?.execution;
  const routeId = execution?.routeId ?? null;
  const source = plan?.source ?? 'unknown';
  const lane = clampString(routeId || source || 'unknown', MAX_LANE_CHARS) || 'unknown';
  const executionKind = clampString(execution?.kind || 'unknown', MAX_EXECUTION_KIND_CHARS) || 'unknown';
  const model = resolvedModel ? clampString(resolvedModel, MAX_MODEL_CHARS) || null : null;
  const confidence = normalizeConfidence(plan?.confidence);
  const firstNote = Array.isArray(plan?.notes) ? plan?.notes.find(Boolean) : undefined;
  const note = firstNote ? clampString(firstNote, MAX_NOTE_CHARS) : undefined;
  return {
    lane,
    executionKind,
    model,
    confidence,
    source: clampString(source, MAX_SOURCE_CHARS) || 'unknown',
    ...(note ? { note } : {}),
  };
}

/**
 * Primitive route facts known at a downstream runtime seam that does NOT carry
 * a full ChatAutomationPlan (e.g. the OpenSwan tool loop, which only has the
 * resolved model, the surface/mode lane, and — sometimes — a routing intent).
 * Used by buildRouteDecisionRecordFromRuntime so the wiring point can still
 * emit a faithful record without fabricating a plan.
 */
export type RuntimeRouteFacts = {
  lane?: string | null;
  executionKind?: string | null;
  model?: string | null;
  /** 'high' | 'medium' | 'low' bands map to representative numbers; a raw
   * number is taken as-is; null/absent stays unknown. */
  confidence?: number | 'high' | 'medium' | 'low' | null;
  source?: string | null;
  note?: string | null;
};

function coerceRuntimeConfidence(value: RuntimeRouteFacts['confidence']): number | null {
  if (value === 'high') return CONFIDENCE_HIGH_FLOOR;
  if (value === 'medium') return CONFIDENCE_MEDIUM_FLOOR;
  if (value === 'low') return 0.4;
  return normalizeConfidence(value ?? null);
}

/**
 * buildRouteDecisionRecordFromRuntime — the adapter for runtime seams without a
 * ChatAutomationPlan. It takes the primitive facts that ARE known there and
 * produces the same bounded RouteDecisionRecord shape. This is what the
 * openswanSessionRuntime tool-loop seam uses (resolved loop model + the
 * surface/mode lane), because no ChatAutomationPlan exists that far downstream.
 */
export function buildRouteDecisionRecordFromRuntime(facts: RuntimeRouteFacts | null | undefined): RouteDecisionRecord {
  const lane = clampString(facts?.lane || facts?.source || 'unknown', MAX_LANE_CHARS) || 'unknown';
  return {
    lane,
    executionKind: clampString(facts?.executionKind || 'unknown', MAX_EXECUTION_KIND_CHARS) || 'unknown',
    model: facts?.model ? clampString(facts.model, MAX_MODEL_CHARS) || null : null,
    confidence: coerceRuntimeConfidence(facts?.confidence),
    source: clampString(facts?.source || 'runtime', MAX_SOURCE_CHARS) || 'runtime',
    ...(facts?.note ? { note: clampString(facts.note, MAX_NOTE_CHARS) } : {}),
  };
}

/**
 * buildRouteDecisionTelemetryPayload — the bounded JSON body for an
 * agent_run_events insert (kind: 'route_decision'). Strings are already
 * clamped by the record builders; this re-clamps defensively (callers may
 * hand-build a record) and derives the confidence band so a reader/dashboard
 * doesn't have to. NO secrets — only the fields on RouteDecisionRecord.
 */
export function buildRouteDecisionTelemetryPayload(
  record: RouteDecisionRecord | null | undefined,
): Record<string, unknown> {
  const lane = clampString(record?.lane || 'unknown', MAX_LANE_CHARS) || 'unknown';
  const executionKind = clampString(record?.executionKind || 'unknown', MAX_EXECUTION_KIND_CHARS) || 'unknown';
  const model = record?.model ? clampString(record.model, MAX_MODEL_CHARS) || null : null;
  const confidence = normalizeConfidence(record?.confidence);
  const source = clampString(record?.source || 'unknown', MAX_SOURCE_CHARS) || 'unknown';
  const note = record?.note ? clampString(record.note, MAX_NOTE_CHARS) : undefined;
  return {
    lane,
    execution_kind: executionKind,
    model,
    confidence,
    confidence_band: classifyRouteConfidence(confidence),
    source,
    ...(note ? { note } : {}),
  };
}

// ── Bounded in-memory session ring ───────────────────────────────────────────
// A per-process FIFO of the most recent decisions. Deliberately module-scoped
// and tiny: it powers a future in-app drift indicator and lets a dev inspect
// "where did my last N prompts route?" without a DB round-trip. Capped so it
// can never grow unbounded across a long session.

const sessionRouteDecisions: RouteDecisionRecord[] = [];

/**
 * recordSessionRouteDecision — append a decision to the bounded ring, evicting
 * the oldest entries once the cap is exceeded (FIFO). Non-throwing: a bad
 * record is coerced through the payload-safe builders before storage so the
 * ring never holds a malformed entry.
 */
export function recordSessionRouteDecision(record: RouteDecisionRecord | null | undefined): void {
  // Re-normalize on the way in so getSessionRouteDecisions()/summarizeRouteDrift
  // always see well-formed, bounded records regardless of caller hygiene.
  const safe: RouteDecisionRecord = {
    lane: clampString(record?.lane || 'unknown', MAX_LANE_CHARS) || 'unknown',
    executionKind: clampString(record?.executionKind || 'unknown', MAX_EXECUTION_KIND_CHARS) || 'unknown',
    model: record?.model ? clampString(record.model, MAX_MODEL_CHARS) || null : null,
    confidence: normalizeConfidence(record?.confidence),
    source: clampString(record?.source || 'unknown', MAX_SOURCE_CHARS) || 'unknown',
    ...(record?.note ? { note: clampString(record.note, MAX_NOTE_CHARS) } : {}),
  };
  sessionRouteDecisions.push(safe);
  // Trim from the front so the ring keeps the MOST RECENT SESSION_RING_CAP.
  while (sessionRouteDecisions.length > SESSION_RING_CAP) {
    sessionRouteDecisions.shift();
  }
}

/** Return a shallow copy of the ring (oldest → newest). Never the live array. */
export function getSessionRouteDecisions(): RouteDecisionRecord[] {
  return sessionRouteDecisions.slice();
}

/** Clear the ring — primarily for test isolation between smoke sections. */
export function resetSessionRouteDecisions(): void {
  sessionRouteDecisions.length = 0;
}

/**
 * summarizeRouteDrift — a compact, secret-free one-liner flagging the two
 * signals that precede a silent-mis-classification incident:
 *   1. a spike of LOW-confidence routes (the router is guessing), and
 *   2. a LANE FLIP pattern — the same execution kind bouncing across
 *      different lanes within the window (unstable routing).
 * Returns a short human string for a dashboard/log; "stable" when neither
 * signal trips. Pure + bounded; safe on empty/degenerate input.
 *
 * @param records  the decisions to inspect (defaults to the session ring).
 * @param opts.lowConfidenceThreshold  how many low-confidence routes trip the
 *   spike flag (default 5).
 */
export function summarizeRouteDrift(
  records?: RouteDecisionRecord[] | null,
  opts?: { lowConfidenceThreshold?: number },
): string {
  const list = Array.isArray(records) ? records.filter(Boolean) : getSessionRouteDecisions();
  const total = list.length;
  if (total === 0) return 'route-drift: no decisions recorded';

  const lowThreshold = Math.max(1, Math.floor(opts?.lowConfidenceThreshold ?? 5));
  let lowCount = 0;
  let unknownCount = 0;
  // Track which lanes each execution kind has landed in, to detect flips.
  const lanesByExecutionKind = new Map<string, Set<string>>();

  for (const record of list) {
    const band = classifyRouteConfidence(record.confidence);
    if (band === 'low') lowCount += 1;
    else if (band === 'unknown') unknownCount += 1;
    const existing = lanesByExecutionKind.get(record.executionKind) ?? new Set<string>();
    existing.add(record.lane);
    lanesByExecutionKind.set(record.executionKind, existing);
  }

  const flippedKinds: string[] = [];
  for (const [executionKind, lanes] of lanesByExecutionKind) {
    if (lanes.size > 1) flippedKinds.push(`${executionKind}→{${Array.from(lanes).sort().join(',')}}`);
  }

  const flags: string[] = [];
  if (lowCount >= lowThreshold) {
    flags.push(`LOW-CONFIDENCE SPIKE (${lowCount}/${total} below medium)`);
  }
  if (flippedKinds.length > 0) {
    // Clamp the flip detail so the summary stays a one-liner even with many
    // kinds; the count is always exact, only the sample list is truncated.
    const sample = flippedKinds.slice(0, 3).join('; ');
    const suffix = flippedKinds.length > 3 ? ` +${flippedKinds.length - 3} more` : '';
    flags.push(`LANE FLIP x${flippedKinds.length} (${sample}${suffix})`);
  }

  if (flags.length === 0) {
    const unknownNote = unknownCount ? `, ${unknownCount} unknown-confidence` : '';
    return `route-drift: stable across ${total} decision(s)${unknownNote}`;
  }
  return `route-drift: ${flags.join(' | ')} over ${total} decision(s)`;
}
