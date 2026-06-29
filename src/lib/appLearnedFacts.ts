// ─── L4/L3: Learned app facts feeding the escalation ladder ─────────────────
//
// Canonical owner for per-app observed facts harvested from desktop/app run
// outcomes (docs/LEARNING_LOOP_RESEARCH_2026-06-12.md, items L3 + L4):
//
//   - L4: which control surface succeeded last, per-surface ok/fail tallies,
//     and a11y coverage failure counters (verified finding 6: ~62% of desktop
//     failures are control detection). These feed E1's `capabilityStatusById`
//     ladder as CONSERVATIVE hints — audit-derived statuses always win on
//     conflict, learned hints only fill gaps or demote, never promote.
//   - L3: pure per-app failure aggregation → an auto-DRAFT buildout PROPOSAL
//     decision (verified finding 7: no production system auto-BUILDS;
//     detect → draft → human approval is the evidence-backed design).
//     `shouldProposeCapabilityBuildout` only RETURNS a decision — it never
//     executes anything; the runtime wires the decision into the existing
//     `requestConnectedAppCapabilityBuildout` + HITL approval path.
//
// Node-loadable on purpose: only `import type` from app modules at the top,
// and the device `storage` wrapper (which drags react-native) is dynamically
// imported inside the persistence functions. Smoke:
// scripts/app-learned-facts-smoketest.ts imports this module directly.

import type {
  ComputerTaskSurfaceEscalation,
  SurfaceCapabilityStatus,
} from './appAutomationControlSurfaces';
import { CONNECTED_AGENT_BUILDOUT_LANE_ID } from './computerCapabilityExpansion';

// ─── Model ───────────────────────────────────────────────────────────────────

export interface AppLearnedFactsSurfaceOutcome {
  ok: number;
  fail: number;
  lastAtIso: string;
}

export interface AppLearnedFactsEscalation {
  from: string;
  to: string;
  failureCode?: string | null;
  atIso: string;
}

export interface AppLearnedFactsUnmetProposal {
  reason: string;
  atIso: string;
}

/**
 * L1 evidence-gating buckets (research open question 3 / verified finding 5:
 * UFO2 measured retrieved self-experience HELPING plan-error recovery while
 * REGRESSING overall success for a strong model — so per-app MEASUREMENT must
 * gate example injection, not assumption). Runs whose prompt carried the
 * prior-trace EXAMPLE block fold into `exampleAssisted`; runs through the same
 * agent seam without the block fold into `unassisted`. Counters capped at 99.
 */
export interface AppLearnedFactsExampleAssistedOutcome {
  ok: number;
  fail: number;
  lastAtIso: string;
}

export interface AppLearnedFactsUnassistedOutcome {
  ok: number;
  fail: number;
}

export interface AppLearnedFacts {
  v: 1;
  /** Normalized lowercase app name (see normalizeAppKey). */
  appKey: string;
  lastSuccessSurfaceId?: string | null;
  /** Bounded ≤ APP_LEARNED_FACTS_MAX_SURFACES (oldest lastAtIso evicted). */
  surfaceOutcomes: Record<string, AppLearnedFactsSurfaceOutcome>;
  /** E1 a11y_tree_empty / a11y_coverage_miss breadcrumb tally (control-detection signal). */
  a11yEmptyCount: number;
  /** E1 a11y_path_stale breadcrumb tally. */
  a11yStaleCount: number;
  lastEscalation?: AppLearnedFactsEscalation | null;
  /** Stamped when an L3 buildout proposal was actually filed (7-day cooldown anchor). */
  lastBuildoutProposedAtIso?: string | null;
  /**
   * L3 proposal that could not be filed (no run anchor for the HITL approval,
   * or no connected agent). Reason preserved so the buildout UI can surface it
   * later (UI consumption is a follow-up).
   */
  unmetBuildoutProposal?: AppLearnedFactsUnmetProposal | null;
  /** Outcomes of runs whose prompt carried the L1 example block (optional — older persisted records lack it). */
  exampleAssisted?: AppLearnedFactsExampleAssistedOutcome;
  /** Outcomes of runs through the same seam WITHOUT the example block (the per-app baseline). */
  unassisted?: AppLearnedFactsUnassistedOutcome;
  updatedAtIso: string;
}

export const APP_LEARNED_FACTS_MAX_SURFACES = 8;
export const APP_LEARNED_FACTS_MAX_APPS = 30;
/** Per-surface ok/fail tallies are capped — facts are hints, not analytics. */
export const APP_LEARNED_FACTS_COUNT_CAP = 99;
/** ≥3 fails with 0 oks on a surface → conservative 'partial' demotion hint. */
export const APP_LEARNED_FACTS_DEMOTE_FAIL_THRESHOLD = 3;
/** ≥3 fails with no success on the best recorded rung → propose buildout. */
export const APP_LEARNED_FACTS_PROPOSE_FAIL_THRESHOLD = 3;
/** a11yEmptyCount ≥3 → propose buildout (control-detection failure signal). */
export const APP_LEARNED_FACTS_PROPOSE_A11Y_EMPTY_THRESHOLD = 3;
export const APP_LEARNED_FACTS_PROPOSE_COOLDOWN_DAYS = 7;
/**
 * L1 example-injection gate thresholds (research open question 3). Defaults
 * are conservative IN FAVOR of injection — the verified default is that
 * examples help plan-error recovery — and suppression requires measured
 * per-app evidence of regression:
 * - <4 example-assisted samples → always inject (not enough evidence);
 * - with ≥4 assisted AND ≥4 unassisted samples → suppress only when the
 *   assisted success rate is BOTH <60% AND ≥20 points below the unassisted
 *   baseline (a low absolute rate alone may just be a hard app; a gap alone
 *   may ride a high baseline where examples still help recovery);
 * - without an unassisted baseline (<4 unassisted samples) → suppress only
 *   when the assisted rate is <40% (clearly failing on its own evidence).
 */
export const APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_ASSISTED_SAMPLES = 4;
export const APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_UNASSISTED_SAMPLES = 4;
export const APP_LEARNED_FACTS_EXAMPLE_GATE_SUPPRESS_RATE = 0.6;
export const APP_LEARNED_FACTS_EXAMPLE_GATE_BASELINE_GAP = 0.2;
export const APP_LEARNED_FACTS_EXAMPLE_GATE_NO_BASELINE_SUPPRESS_RATE = 0.4;

const MAX_APP_KEY_CHARS = 60;
const MAX_SURFACE_ID_CHARS = 80;
const MAX_REASON_CHARS = 300;

/**
 * Ladder order used to decide which recorded surface is the "best available
 * rung" for the L3 propose threshold. Mirrors the rank ordering produced by
 * appAutomationControlSurfaces candidate plans (app-native rungs first, pixel
 * fallback last). Unknown surface ids rank after every known one.
 */
export const APP_LEARNED_FACTS_SURFACE_RANK_ORDER: string[] = [
  'adobe_indesign_uxp_dom',
  'adobe_photoshop_uxp_dom',
  'adobe_photoshop_batchplay',
  'autocad_lisp_dotnet_api',
  'autodesk_ai_mcp_assistant',
  'fusion_api_scripts_addins',
  'solidworks_com_api',
  'matlab_mcp_agentic_toolkit',
  'rhino_common_api',
  'revit_api_addin',
  'inventor_api_ilogic',
  'vendor_script_or_plugin_api',
  'adobe_indesign_cloud_api',
  'adobe_photoshop_cloud_api',
  'autodesk_aps_automation_api',
  'browser_dom_cdp',
  'macos_apple_events',
  'os_accessibility',
  'semantic_desktop',
  'screenshot_coordinate_fallback',
];

const A11Y_EMPTY_FAILURE_CODES = new Set(['a11y_tree_empty', 'a11y_coverage_miss']);
const A11Y_STALE_FAILURE_CODES = new Set(['a11y_path_stale']);

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Normalized lowercase app key ('' when there is no usable app name). */
export function normalizeAppKey(appName: string | null | undefined): string {
  return String(appName || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_APP_KEY_CHARS);
}

function capCount(value: number): number {
  return Math.max(0, Math.min(APP_LEARNED_FACTS_COUNT_CAP, Math.round(value)));
}

function cleanSurfaceId(surfaceId: string | null | undefined): string {
  return String(surfaceId || '').trim().slice(0, MAX_SURFACE_ID_CHARS);
}

export function createEmptyAppLearnedFacts(appKey: string, atIso?: string): AppLearnedFacts {
  return {
    v: 1,
    appKey: normalizeAppKey(appKey),
    lastSuccessSurfaceId: null,
    surfaceOutcomes: {},
    a11yEmptyCount: 0,
    a11yStaleCount: 0,
    lastEscalation: null,
    lastBuildoutProposedAtIso: null,
    unmetBuildoutProposal: null,
    updatedAtIso: atIso || new Date().toISOString(),
  };
}

/**
 * Final control surface a run ended on: the last escalation breadcrumb's
 * destination rung, or the fallback (the deterministic adapter and the agent
 * desktop.* loop both drive the OS accessibility surface by default).
 */
export function inferRunSurfaceIdFromEscalations(
  escalations: ComputerTaskSurfaceEscalation[] | null | undefined,
  fallbackSurfaceId = 'os_accessibility',
): string {
  const list = Array.isArray(escalations) ? escalations : [];
  const last = list[list.length - 1];
  return cleanSurfaceId(last?.toSurface) || cleanSurfaceId(fallbackSurfaceId) || 'os_accessibility';
}

function boundSurfaceOutcomes(
  outcomes: Record<string, AppLearnedFactsSurfaceOutcome>,
  protectedId: string,
): Record<string, AppLearnedFactsSurfaceOutcome> {
  const entries = Object.entries(outcomes);
  if (entries.length <= APP_LEARNED_FACTS_MAX_SURFACES) return outcomes;
  // Evict oldest lastAtIso first, never the surface just touched.
  const evictable = entries
    .filter(([id]) => id !== protectedId)
    .sort((a, b) => String(a[1].lastAtIso).localeCompare(String(b[1].lastAtIso)));
  const toEvict = new Set(
    evictable.slice(0, entries.length - APP_LEARNED_FACTS_MAX_SURFACES).map(([id]) => id),
  );
  const out: Record<string, AppLearnedFactsSurfaceOutcome> = {};
  for (const [id, entry] of entries) {
    if (!toEvict.has(id)) out[id] = entry;
  }
  return out;
}

export interface AppRunOutcomeInput {
  /** Final control surface the run ended on (see inferRunSurfaceIdFromEscalations). */
  surfaceId: string;
  ok: boolean;
  /** E1 breadcrumbs from the run; each fromSurface counts as a failure on that rung. */
  escalations?: ComputerTaskSurfaceEscalation[] | null;
  /**
   * L1 evidence gate: `true` when the run's prompt carried the prior-trace
   * example block, `false` when the same agent seam ran WITHOUT it (the
   * baseline). Leave undefined for paths where the example seam was never
   * consulted (deterministic adapter runs, capability-buildout retry prompts)
   * so those outcomes don't pollute either bucket.
   */
  exampleInjected?: boolean;
  atIso?: string;
}

/**
 * Fold one run outcome (plus its E1 escalation breadcrumbs) into the facts.
 * Pure — returns a new object; everything bounded/capped:
 * - each breadcrumb's fromSurface gets a fail tally (that rung failed mid-run);
 * - a11y_tree_empty/a11y_coverage_miss breadcrumbs bump a11yEmptyCount,
 *   a11y_path_stale bumps a11yStaleCount;
 * - the final surface gets the ok/fail outcome; success records
 *   lastSuccessSurfaceId, RESETS the a11y counters, and clears any unmet
 *   buildout proposal (success resets the L3 evidence);
 * - surfaceOutcomes bounded to ≤8 (oldest lastAtIso evicted, never the rung
 *   just touched), counters capped at 99;
 * - when the caller measured the L1 example seam (exampleInjected true/false),
 *   the outcome also folds into the exampleAssisted/unassisted gate buckets
 *   (undefined leaves both untouched; existing folding unchanged).
 */
export function recordAppRunOutcome(
  facts: AppLearnedFacts | null | undefined,
  outcome: AppRunOutcomeInput,
): AppLearnedFacts {
  const atIso = outcome.atIso || new Date().toISOString();
  const base = facts && facts.v === 1
    ? facts
    : createEmptyAppLearnedFacts(facts?.appKey || '', atIso);
  const surfaceOutcomes: Record<string, AppLearnedFactsSurfaceOutcome> = {};
  for (const [id, entry] of Object.entries(base.surfaceOutcomes || {})) {
    const cleanId = cleanSurfaceId(id);
    if (!cleanId) continue;
    surfaceOutcomes[cleanId] = {
      ok: capCount(entry?.ok || 0),
      fail: capCount(entry?.fail || 0),
      lastAtIso: String(entry?.lastAtIso || atIso),
    };
  }
  const bump = (surfaceId: string, ok: boolean) => {
    const id = cleanSurfaceId(surfaceId);
    if (!id) return;
    const existing = surfaceOutcomes[id] || { ok: 0, fail: 0, lastAtIso: atIso };
    surfaceOutcomes[id] = {
      ok: capCount(existing.ok + (ok ? 1 : 0)),
      fail: capCount(existing.fail + (ok ? 0 : 1)),
      lastAtIso: atIso,
    };
  };

  let a11yEmptyCount = capCount(base.a11yEmptyCount || 0);
  let a11yStaleCount = capCount(base.a11yStaleCount || 0);
  let lastEscalation: AppLearnedFactsEscalation | null = base.lastEscalation || null;

  const escalations = Array.isArray(outcome.escalations) ? outcome.escalations : [];
  for (const crumb of escalations) {
    const from = cleanSurfaceId(crumb?.fromSurface);
    if (from) bump(from, false);
    const code = String(crumb?.failureCode || '').toLowerCase();
    if (A11Y_EMPTY_FAILURE_CODES.has(code)) a11yEmptyCount = capCount(a11yEmptyCount + 1);
    if (A11Y_STALE_FAILURE_CODES.has(code)) a11yStaleCount = capCount(a11yStaleCount + 1);
    lastEscalation = {
      from,
      to: cleanSurfaceId(crumb?.toSurface),
      failureCode: code ? code.slice(0, 60) : null,
      atIso: String(crumb?.atIso || atIso),
    };
  }

  const finalSurfaceId = cleanSurfaceId(outcome.surfaceId) || 'os_accessibility';
  bump(finalSurfaceId, outcome.ok);

  // L1 evidence buckets: fold the outcome into example-assisted vs unassisted
  // tallies when the caller measured the example seam (undefined leaves both
  // buckets untouched — and persisted records without the fields stay valid).
  let exampleAssisted: AppLearnedFactsExampleAssistedOutcome | undefined = base.exampleAssisted
    ? {
        ok: capCount(base.exampleAssisted.ok || 0),
        fail: capCount(base.exampleAssisted.fail || 0),
        lastAtIso: String(base.exampleAssisted.lastAtIso || atIso),
      }
    : undefined;
  let unassisted: AppLearnedFactsUnassistedOutcome | undefined = base.unassisted
    ? {
        ok: capCount(base.unassisted.ok || 0),
        fail: capCount(base.unassisted.fail || 0),
      }
    : undefined;
  if (outcome.exampleInjected === true) {
    exampleAssisted = {
      ok: capCount((exampleAssisted?.ok || 0) + (outcome.ok ? 1 : 0)),
      fail: capCount((exampleAssisted?.fail || 0) + (outcome.ok ? 0 : 1)),
      lastAtIso: atIso,
    };
  } else if (outcome.exampleInjected === false) {
    unassisted = {
      ok: capCount((unassisted?.ok || 0) + (outcome.ok ? 1 : 0)),
      fail: capCount((unassisted?.fail || 0) + (outcome.ok ? 0 : 1)),
    };
  }

  if (outcome.ok) {
    // Success resets the control-detection evidence — escalation breadcrumbs
    // on an ultimately-successful run mean the ladder recovered, not that the
    // app needs a buildout proposal.
    a11yEmptyCount = 0;
    a11yStaleCount = 0;
  }

  return {
    ...base,
    appKey: normalizeAppKey(base.appKey),
    surfaceOutcomes: boundSurfaceOutcomes(surfaceOutcomes, finalSurfaceId),
    lastSuccessSurfaceId: outcome.ok ? finalSurfaceId : base.lastSuccessSurfaceId || null,
    a11yEmptyCount,
    a11yStaleCount,
    lastEscalation,
    unmetBuildoutProposal: outcome.ok ? null : base.unmetBuildoutProposal || null,
    ...(exampleAssisted ? { exampleAssisted } : {}),
    ...(unassisted ? { unassisted } : {}),
    updatedAtIso: atIso,
  };
}

/**
 * Conservative capability hints for E1's ladder:
 * - a surface with ≥3 fails and 0 oks in its recorded window → 'partial'
 *   (demoted after every ready/unknown rung — NEVER 'missing'; the audit owns
 *   exclusion);
 * - the lastSuccessSurfaceId → 'ready' (a fill-gap hint only — the merge never
 *   lets it override an audit status).
 */
export function deriveCapabilityHintsFromFacts(
  facts: AppLearnedFacts | null | undefined,
): Partial<Record<string, 'ready' | 'partial'>> {
  if (!facts || facts.v !== 1) return {};
  const hints: Partial<Record<string, 'ready' | 'partial'>> = {};
  for (const [id, entry] of Object.entries(facts.surfaceOutcomes || {})) {
    if (!id) continue;
    if ((entry?.fail || 0) >= APP_LEARNED_FACTS_DEMOTE_FAIL_THRESHOLD && (entry?.ok || 0) === 0) {
      hints[id] = 'partial';
    }
  }
  const lastSuccess = cleanSurfaceId(facts.lastSuccessSurfaceId);
  if (lastSuccess && hints[lastSuccess] !== 'partial') {
    hints[lastSuccess] = 'ready';
  }
  return hints;
}

/**
 * Merge learned hints into audit-derived per-surface capability status.
 * Audit WINS on conflict:
 * - no audit entry → the hint fills the gap;
 * - audit 'ready' + learned 'partial' → demoted to 'partial' (conservative);
 * - learned 'ready' can never promote an audit 'partial' or 'missing'.
 */
export function mergeCapabilityStatusWithLearnedHints(
  auditStatusById: Record<string, SurfaceCapabilityStatus>,
  hints: Partial<Record<string, 'ready' | 'partial'>>,
): Record<string, SurfaceCapabilityStatus> {
  const out: Record<string, SurfaceCapabilityStatus> = { ...(auditStatusById || {}) };
  for (const [id, hint] of Object.entries(hints || {})) {
    if (!id || !hint) continue;
    const audit = out[id];
    if (!audit) {
      out[id] = hint;
      continue;
    }
    if (audit === 'ready' && hint === 'partial') {
      out[id] = 'partial';
    }
    // 'partial'/'missing' audit statuses are never promoted by learned hints.
  }
  return out;
}

// ─── L1: evidence-gated example injection (pure decision) ────────────────────

export interface DesktopExampleInjectionDecision {
  inject: boolean;
  reason: string;
}

const EXAMPLE_GATE_RATE_EPSILON = 1e-9;

function formatRatePercent(ok: number, total: number): string {
  return total > 0 ? `${Math.round((ok / total) * 100)}%` : 'n/a';
}

/**
 * Pure L1 gate: should the prior-trace EXAMPLE block be injected for this app?
 * Answers research open question 3 (strong-model regression): UFO2 measured
 * retrieved self-experience helping plan-error recovery while REGRESSING
 * overall success — so the per-app MEASURED assisted-vs-unassisted record
 * gates injection, never assumption.
 *
 * Conservative defaults (see APP_LEARNED_FACTS_EXAMPLE_GATE_* constants):
 * - no facts, or <4 example-assisted samples → INJECT (the verified default is
 *   that examples help recovery; suppression needs evidence);
 * - ≥4 assisted samples AND ≥4 unassisted samples → SUPPRESS only when the
 *   assisted success rate is BOTH <60% AND at least 20 points below the
 *   unassisted baseline;
 * - ≥4 assisted samples but no unassisted baseline → SUPPRESS only below 40%.
 * Reasons always cite the measured numbers.
 */
export function shouldInjectDesktopExample(
  facts: AppLearnedFacts | null | undefined,
): DesktopExampleInjectionDecision {
  if (!facts || facts.v !== 1) {
    return {
      inject: true,
      reason: 'no learned facts for this app yet — injecting by default (examples are verified to help plan-error recovery)',
    };
  }
  const appLabel = facts.appKey || 'this app';
  const assistedOk = capCount(facts.exampleAssisted?.ok || 0);
  const assistedFail = capCount(facts.exampleAssisted?.fail || 0);
  const assistedTotal = assistedOk + assistedFail;
  if (assistedTotal < APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_ASSISTED_SAMPLES) {
    return {
      inject: true,
      reason: `${appLabel}: only ${assistedTotal} example-assisted sample(s) (<${APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_ASSISTED_SAMPLES}) — injecting by default (not enough evidence either way)`,
    };
  }
  const assistedRate = assistedOk / assistedTotal;
  const unassistedOk = capCount(facts.unassisted?.ok || 0);
  const unassistedFail = capCount(facts.unassisted?.fail || 0);
  const unassistedTotal = unassistedOk + unassistedFail;

  if (unassistedTotal >= APP_LEARNED_FACTS_EXAMPLE_GATE_MIN_UNASSISTED_SAMPLES) {
    const baselineRate = unassistedOk / unassistedTotal;
    const belowSuppressRate = assistedRate < APP_LEARNED_FACTS_EXAMPLE_GATE_SUPPRESS_RATE - EXAMPLE_GATE_RATE_EPSILON;
    const belowBaselineByGap =
      baselineRate - assistedRate >= APP_LEARNED_FACTS_EXAMPLE_GATE_BASELINE_GAP - EXAMPLE_GATE_RATE_EPSILON;
    if (belowSuppressRate && belowBaselineByGap) {
      return {
        inject: false,
        reason: `${appLabel}: example-assisted ${assistedOk}/${assistedTotal} (${formatRatePercent(assistedOk, assistedTotal)}) vs unassisted ${unassistedOk}/${unassistedTotal} (${formatRatePercent(unassistedOk, unassistedTotal)}) — suppressing example injection`,
      };
    }
    return {
      inject: true,
      reason: `${appLabel}: example-assisted ${assistedOk}/${assistedTotal} vs unassisted ${unassistedOk}/${unassistedTotal} — no measured regression, keeping example injection`,
    };
  }

  if (assistedRate < APP_LEARNED_FACTS_EXAMPLE_GATE_NO_BASELINE_SUPPRESS_RATE - EXAMPLE_GATE_RATE_EPSILON) {
    return {
      inject: false,
      reason: `${appLabel}: example-assisted ${assistedOk}/${assistedTotal} (${formatRatePercent(assistedOk, assistedTotal)}, <40%) with no unassisted baseline — suppressing example injection`,
    };
  }
  return {
    inject: true,
    reason: `${appLabel}: example-assisted ${assistedOk}/${assistedTotal} with no unassisted baseline — keeping example injection`,
  };
}

// ─── L3: auto-buildout PROPOSE decision (pure — never executes) ─────────────

export interface CapabilityBuildoutProposalDecision {
  propose: boolean;
  reason: string;
  laneId?: string;
}

export interface ShouldProposeCapabilityBuildoutOptions {
  nowIso?: string;
  failureThreshold?: number;
  a11yEmptyThreshold?: number;
  cooldownDays?: number;
  surfaceRankOrder?: string[];
}

function bestRecordedSurfaceId(
  facts: AppLearnedFacts,
  rankOrder: string[],
): string | null {
  const recorded = Object.keys(facts.surfaceOutcomes || {});
  if (recorded.length === 0) return null;
  const rankOf = (id: string): number => {
    const index = rankOrder.indexOf(id);
    return index >= 0 ? index : rankOrder.length + recorded.indexOf(id);
  };
  return recorded.slice().sort((a, b) => rankOf(a) - rankOf(b))[0] || null;
}

/**
 * Pure L3 trigger: should the runtime auto-DRAFT a capability-buildout
 * proposal for this app? Returns a DECISION only — it never files, dispatches,
 * or executes anything (verified finding 7: buildout stays human-approved;
 * the wiring routes a `propose: true` decision through the EXISTING
 * requestConnectedAppCapabilityBuildout + HITL approval path).
 *
 * Proposes when:
 * - the BEST available recorded rung has ≥3 failures and 0 successes, OR
 * - a11yEmptyCount ≥3 (per-app control-detection failure signal — verified
 *   finding 6: the dominant desktop failure class);
 * and no proposal was filed within the 7-day cooldown.
 */
export function shouldProposeCapabilityBuildout(
  facts: AppLearnedFacts | null | undefined,
  opts: ShouldProposeCapabilityBuildoutOptions = {},
): CapabilityBuildoutProposalDecision {
  if (!facts || facts.v !== 1) {
    return { propose: false, reason: 'no learned facts recorded for this app yet' };
  }
  const failureThreshold = Math.max(1, opts.failureThreshold || APP_LEARNED_FACTS_PROPOSE_FAIL_THRESHOLD);
  const a11yEmptyThreshold = Math.max(1, opts.a11yEmptyThreshold || APP_LEARNED_FACTS_PROPOSE_A11Y_EMPTY_THRESHOLD);
  const cooldownDays = Math.max(0, opts.cooldownDays ?? APP_LEARNED_FACTS_PROPOSE_COOLDOWN_DAYS);
  const nowMs = Date.parse(opts.nowIso || '') || Date.now();
  const appLabel = facts.appKey || 'this app';

  const lastProposedMs = Date.parse(facts.lastBuildoutProposedAtIso || '') || 0;
  if (lastProposedMs > 0 && nowMs - lastProposedMs < cooldownDays * 24 * 60 * 60 * 1000) {
    return {
      propose: false,
      reason: `${appLabel}: buildout already proposed at ${facts.lastBuildoutProposedAtIso} (within the ${cooldownDays}-day cooldown)`,
    };
  }

  const rankOrder = opts.surfaceRankOrder || APP_LEARNED_FACTS_SURFACE_RANK_ORDER;
  const bestSurfaceId = bestRecordedSurfaceId(facts, rankOrder);
  const bestOutcome = bestSurfaceId ? facts.surfaceOutcomes[bestSurfaceId] : null;
  const a11yEmptyCount = capCount(facts.a11yEmptyCount || 0);

  const evidence: string[] = [];
  if (
    bestSurfaceId
    && bestOutcome
    && bestOutcome.fail >= failureThreshold
    && bestOutcome.ok === 0
  ) {
    evidence.push(`${bestOutcome.fail} failures on ${bestSurfaceId} with no success`);
  }
  if (a11yEmptyCount >= a11yEmptyThreshold) {
    evidence.push(`a11y tree empty ${a11yEmptyCount}× (control-detection failure)`);
  }

  if (evidence.length === 0) {
    return {
      propose: false,
      reason: `${appLabel}: not enough failure evidence (best rung ${bestSurfaceId || 'none'}: ${bestOutcome ? `${bestOutcome.fail} fail / ${bestOutcome.ok} ok` : 'no outcomes'}; a11y empty ${a11yEmptyCount}×)`,
    };
  }

  return {
    propose: true,
    reason: `${appLabel}: ${evidence.join(', ')}`.slice(0, MAX_REASON_CHARS),
    laneId: CONNECTED_AGENT_BUILDOUT_LANE_ID,
  };
}

/** Stamp a filed proposal (starts the cooldown; clears any unmet record). Pure. */
export function markBuildoutProposalFiled(facts: AppLearnedFacts, atIso?: string): AppLearnedFacts {
  const at = atIso || new Date().toISOString();
  return {
    ...facts,
    lastBuildoutProposedAtIso: at,
    unmetBuildoutProposal: null,
    updatedAtIso: at,
  };
}

/**
 * Record a proposal that could not be filed (no connected agent, or no run
 * anchor for the HITL approval). Reason preserved for later buildout UI
 * surfacing. Does NOT start the cooldown — the proposal never reached a human.
 */
export function markBuildoutProposalUnmet(
  facts: AppLearnedFacts,
  reason: string,
  atIso?: string,
): AppLearnedFacts {
  const at = atIso || new Date().toISOString();
  return {
    ...facts,
    unmetBuildoutProposal: {
      reason: String(reason || 'capability buildout proposal could not be filed').slice(0, MAX_REASON_CHARS),
      atIso: at,
    },
    updatedAtIso: at,
  };
}

// ─── Store shape (pure helpers, smoke-testable) ──────────────────────────────

export interface AppLearnedFactsStore {
  v: 1;
  apps: Record<string, AppLearnedFacts>;
}

export function parseAppLearnedFactsStore(raw: string | null | undefined): AppLearnedFactsStore {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.v === 1 && parsed.apps && typeof parsed.apps === 'object') {
      return { v: 1, apps: parsed.apps as Record<string, AppLearnedFacts> };
    }
  } catch { /* corrupted store → start fresh (silent fail) */ }
  return { v: 1, apps: {} };
}

/** Upsert one app's facts, keeping the store LRU-bounded (≤30 apps by updatedAtIso). */
export function upsertAppLearnedFactsInStore(
  store: AppLearnedFactsStore,
  facts: AppLearnedFacts,
): AppLearnedFactsStore {
  const appKey = normalizeAppKey(facts.appKey);
  if (!appKey) return store;
  const apps: Record<string, AppLearnedFacts> = { ...(store?.apps || {}) };
  apps[appKey] = { ...facts, appKey };
  const keys = Object.keys(apps);
  if (keys.length > APP_LEARNED_FACTS_MAX_APPS) {
    const evictable = keys
      .filter((key) => key !== appKey)
      .sort((a, b) => String(apps[a]?.updatedAtIso || '').localeCompare(String(apps[b]?.updatedAtIso || '')));
    for (const key of evictable.slice(0, keys.length - APP_LEARNED_FACTS_MAX_APPS)) {
      delete apps[key];
    }
  }
  return { v: 1, apps };
}

// ─── Device-storage persistence (silent-fail, fire-and-forget callers) ───────

function storeKeyForCircle(circleId: string): string {
  return `uc_app_learned_facts::${String(circleId || 'unknown').slice(0, 80)}`;
}

async function loadStore(circleId: string): Promise<AppLearnedFactsStore> {
  try {
    const { storage } = await import('./storage');
    const raw = await storage.getItem(storeKeyForCircle(circleId));
    return parseAppLearnedFactsStore(raw);
  } catch {
    return { v: 1, apps: {} };
  }
}

async function saveStore(circleId: string, store: AppLearnedFactsStore): Promise<void> {
  try {
    const { storage } = await import('./storage');
    await storage.setItem(storeKeyForCircle(circleId), JSON.stringify(store));
  } catch { /* learned facts are telemetry — never block or fail the task */ }
}

/** Load one app's learned facts for a circle. Silent-fail → null. */
export async function loadAppLearnedFacts(
  circleId: string,
  appKey: string,
): Promise<AppLearnedFacts | null> {
  const key = normalizeAppKey(appKey);
  if (!key) return null;
  try {
    const store = await loadStore(circleId);
    const facts = store.apps[key];
    return facts && facts.v === 1 ? facts : null;
  } catch {
    return null;
  }
}

/**
 * Fold one run outcome into the persisted facts (read-modify-write, LRU
 * bounded). Returns the updated facts so the caller can run the L3 propose
 * check; silent-fail → null. Safe to call fire-and-forget.
 */
export async function recordAppLearnedFactsOutcome(
  circleId: string,
  appKey: string,
  outcome: AppRunOutcomeInput,
): Promise<AppLearnedFacts | null> {
  const key = normalizeAppKey(appKey);
  if (!key) return null;
  try {
    const store = await loadStore(circleId);
    const updated = recordAppRunOutcome(
      store.apps[key] || createEmptyAppLearnedFacts(key, outcome.atIso),
      outcome,
    );
    const next = upsertAppLearnedFactsInStore(store, { ...updated, appKey: key });
    await saveStore(circleId, next);
    return next.apps[key] || updated;
  } catch {
    return null;
  }
}

/**
 * Stamp the L3 proposal state on the persisted facts: `filed: true` starts the
 * 7-day cooldown; `filed: false` records the unmet proposal (reason preserved)
 * without starting the cooldown. Fire-and-forget; silent-fail.
 */
export async function recordAppLearnedFactsBuildoutProposal(
  circleId: string,
  appKey: string,
  proposal: { filed: boolean; reason: string; atIso?: string },
): Promise<void> {
  const key = normalizeAppKey(appKey);
  if (!key) return;
  try {
    const store = await loadStore(circleId);
    const current = store.apps[key] || createEmptyAppLearnedFacts(key, proposal.atIso);
    const updated = proposal.filed
      ? markBuildoutProposalFiled(current, proposal.atIso)
      : markBuildoutProposalUnmet(current, proposal.reason, proposal.atIso);
    await saveStore(circleId, upsertAppLearnedFactsInStore(store, { ...updated, appKey: key }));
  } catch { /* silent fail */ }
}
