// openswanLaunchReadinessCore — the PURE launch-readiness gate for the OpenSwan
// Control Panel (src/components/openswan/OpenSwanConsole.tsx). The Control Panel's
// Launch button is enabled/disabled by a ~150-line inline `launchReadiness` useMemo
// that grades the preflight as 'blocked' | 'review' | 'ready'. That logic lived deep
// inside a 6000+ line component and therefore could not be smoke-tested. This module
// extracts the deterministic decision — the grade ladder, the canLaunch gate, and the
// blocker / warning / capability-chip lists that drive the readiness panel — into a
// total, side-effect-free view-model.
//
// GRADE LADDER (blocked > review > ready):
//   - A bracket placeholder still sitting in the Task/Mode draft, a failed capability
//     audit, an automation blocker, a projected-spend-over-cap, or any caller-supplied
//     extraBlocker (empty task, missing REQUIRED capability, capability audit still
//     loading) → BLOCKED (canLaunch false). Any single one is sufficient.
//   - A local bridge that is offline / degraded / unpaired, or any caller-supplied
//     extraWarning → a WARNING → REVIEW (still launchable, but flagged). A null or
//     'paired' bridge adds no spurious warning.
//   - Subagent access and vault tools surface as capability CHIPS; the run label and
//     cost label ride along as trailing status chips when present.
//
// TOTALITY: every input field is `unknown`. null / undefined / wrong-type / huge /
// hostile / cyclic inputs collapse to a safe neutral ('ready', no blockers) and never
// throw. All output lists are Set-deduped and bounded (blockers <= 5, warnings <= 5,
// chips <= 4). No module-scope Date.now()/Math.random(); no I/O; secret-safe.

export interface LaunchReadinessInput {
  /** A bracketed placeholder (e.g. `[repo]`) is still present in Task + Mode. */
  hasBracketPlaceholder?: unknown;
  /** The capability audit errored; a string is used as the failure detail. */
  capabilityAuditFailed?: unknown;
  /** Blocking automation-readiness findings (array of strings). */
  automationBlockers?: unknown;
  /** Projected 24h spend is over the budget cap; a string is used as the message. */
  budgetOverCap?: unknown;
  /** Normalized local-bridge state: 'paired' | 'offline' | 'degraded' | 'unpaired' | null. */
  bridgeState?: unknown;
  /** At least one subagent will be spawned. */
  hasSubagentAccess?: unknown;
  /** Vault tools are exposed for saved logins. */
  hasVaultTools?: unknown;
  /** Compact cost estimate label (display only). */
  costLabel?: unknown;
  /** Run identity label (intent title / mode label; display only). */
  runLabel?: unknown;
  /** Extra caller-supplied blockers the fields above do not model (empty task, missing
   *  REQUIRED capability, capability audit still loading). Bounded string-array; any
   *  present forces grade 'blocked' — the same weight as a native blocker. */
  extraBlockers?: unknown;
  /** Extra caller-supplied warnings the fields above do not model (automation-readiness
   *  check error, projected spend near the cap, bridge probing disabled, offline /
   *  degraded / unpaired local bridges). Bounded string-array; grade 'review' when
   *  present with no blocker. */
  extraWarnings?: unknown;
}

export type LaunchGrade = 'blocked' | 'review' | 'ready';

export interface LaunchReadiness {
  grade: LaunchGrade;
  canLaunch: boolean;
  blockers: string[];
  warnings: string[];
  chips: string[];
}

const MAX_BLOCKERS = 5;
const MAX_WARNINGS = 5;
const MAX_CHIPS = 4;
const MAX_AUTOMATION_BLOCKERS = 3;
const MAX_ARRAY_SCAN = 64;
const MAX_TEXT = 200;

const BRACKET_BLOCKER = 'Replace bracketed placeholders in Task + Mode before launch.';
const CAPABILITY_BLOCKER = 'Capability audit failed.';
const BUDGET_BLOCKER = 'Projected 24h spend is over the budget cap.';

// A defensive "is this flag set?" that never throws. Booleans pass through; a
// non-empty non-"false"/"0"/"no" string counts as set; a non-zero finite number
// counts as set; everything else (objects, functions, symbols, null) is treated as
// unset so hostile inputs fail toward the permissive 'ready' neutral.
function truthy(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase();
    return t.length > 0 && t !== 'false' && t !== '0' && t !== 'no';
  }
  return false;
}

// String-only, trimmed, bounded coercion for display/detail text. Non-strings return
// '' so we never leak "[object Object]" or stringified numbers into user copy.
function asDetail(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

// Map a normalized bridge state to its warning, if any. null / 'paired' / unknown →
// '' (no spurious warning). The scan is a fixed set of string comparisons.
function bridgeWarning(value: unknown): string {
  const state = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (state === 'offline') return 'Local bridge is offline.';
  if (state === 'degraded') return 'Local bridge is degraded.';
  if (state === 'unpaired') return 'Desktop bridge is not paired yet.';
  return '';
}

// Read up to `maxItems` trimmed, non-empty strings from an array input. The scan is
// bounded to MAX_ARRAY_SCAN elements so a hostile huge/cyclic array of non-strings cannot
// cause an unbounded loop, and array items are read positionally (no recursion). Shared by
// automationBlockers, extraBlockers, and extraWarnings.
function readStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const limit = Math.min(value.length, MAX_ARRAY_SCAN);
  for (let i = 0; i < limit; i += 1) {
    if (out.length >= maxItems) break;
    const text = asDetail(value[i]);
    if (text) out.push(text);
  }
  return out;
}

// Set-dedupe + drop empties + hard cap. Returns a fresh array.
function boundedUnique(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Grade the OpenSwan Control Panel preflight into blocked / review / ready and derive
 * the Launch-button gate. Total and side-effect-free: any hostile input yields a safe
 * neutral readiness object and never throws.
 */
export function resolveLaunchReadiness(input: LaunchReadinessInput): LaunchReadiness {
  const src: Record<string, unknown> =
    input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const blockers: string[] = [];
  const warnings: string[] = [];
  const chips: string[] = [];

  // --- Blockers: any one forces grade 'blocked' and canLaunch false. ---
  // Caller extras are pushed FIRST so an empty-task / missing-capability headline leads
  // the list (parity with the inline gate, whose first-pushed blocker drives the summary).
  for (const item of readStringArray(src.extraBlockers, MAX_BLOCKERS)) blockers.push(item);
  if (truthy(src.hasBracketPlaceholder)) blockers.push(BRACKET_BLOCKER);
  if (truthy(src.capabilityAuditFailed)) {
    const detail = asDetail(src.capabilityAuditFailed);
    blockers.push(detail ? `Capability audit failed: ${detail}` : CAPABILITY_BLOCKER);
  }
  for (const item of readStringArray(src.automationBlockers, MAX_AUTOMATION_BLOCKERS)) blockers.push(item);
  if (truthy(src.budgetOverCap)) {
    const detail = asDetail(src.budgetOverCap);
    blockers.push(detail || BUDGET_BLOCKER);
  }

  // --- Warnings: grade 'review' when present and there are no blockers. ---
  const bridge = bridgeWarning(src.bridgeState);
  if (bridge) warnings.push(bridge);
  for (const item of readStringArray(src.extraWarnings, MAX_WARNINGS)) warnings.push(item);

  // --- Capability chips: access badges first (so the cap keeps them), then labels. ---
  if (truthy(src.hasVaultTools)) chips.push('vault tools');
  if (truthy(src.hasSubagentAccess)) chips.push('subagents');
  const runLabel = asDetail(src.runLabel);
  if (runLabel) chips.push(runLabel);
  const costLabel = asDetail(src.costLabel);
  if (costLabel) chips.push(costLabel);

  const uniqueBlockers = boundedUnique(blockers, MAX_BLOCKERS);
  const uniqueWarnings = boundedUnique(warnings, MAX_WARNINGS);
  const uniqueChips = boundedUnique(chips, MAX_CHIPS);

  const grade: LaunchGrade =
    uniqueBlockers.length > 0 ? 'blocked' :
    uniqueWarnings.length > 0 ? 'review' :
    'ready';

  return {
    grade,
    canLaunch: grade !== 'blocked',
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    chips: uniqueChips,
  };
}
