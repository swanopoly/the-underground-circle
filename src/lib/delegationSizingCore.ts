/**
 * delegationSizingCore — pure "how many specialists is this task actually worth?"
 * brain for subagent fan-out.
 *
 * `planSubagentDelegation` (src/lib/subagentRegistry.ts) unconditionally fans
 * out 3–4 specialist LLM runs for ANY task in a build/debug/architect/review/
 * research/automation bucket — even a one-line "add a loading spinner". Each
 * spec is a separate model run (cost + latency). This module scores task
 * complexity (0–10) from the message + task plan and trims the proposed spec
 * list down to a size the task justifies:
 *
 *   very-low (≤2) → 1 specialist (coder-only)
 *   low      (≤4) → 2 specialists
 *   medium   (≤6) → 3 specialists
 *   high     (≥7) → 4 specialists
 *
 * Invariants (load-bearing):
 *   - ALWAYS retain at least the primary spec when the input is non-empty
 *     (never returns 0 specs for a non-empty list).
 *   - At very-low complexity, demote an unconditional "thinking" first spec
 *     (architect / planner) in favour of a build/worker spec (coder / debugger)
 *     so trivial builds run coder-only instead of paying for an architect.
 *   - Stable: kept/dropped preserve the input's insertion order within a tier.
 *   - kept ∪ dropped is an exact partition of the input (same object refs, no
 *     loss, no duplication).
 *   - TOTAL: every export tolerates null / undefined / wrong-type / huge /
 *     hostile input and returns a safe, bounded, neutral value — never throws.
 *
 * PURE: zero runtime imports (no react-native / supabase), no Date.now /
 * Math.random at module scope — loads under tsx/esbuild for smoke testing.
 * The concrete `SubagentTaskSpec` shape used at the call site keeps its role at
 * `spec.subagent.role`; `SizableSpec` is the loose structural view this module
 * reasons over, and role extraction checks BOTH `spec.role` and
 * `spec.subagent.role` so real specs and simplified specs both work.
 */

/** Loose structural view of a delegation spec this module reasons over. */
export interface SizableSpec {
  role: string;
  priority?: 'high' | 'medium' | 'low';
  kind?: string;
}

export type DelegationTier = 'very-low' | 'low' | 'medium' | 'high';

/**
 * Result of sizing a proposed spec list. `kept`/`dropped` preserve the ORIGINAL
 * input element references (generic over the concrete spec type) so the caller
 * can hand `kept` straight back as its real `SubagentTaskSpec[]`.
 */
export interface DelegationSizing<TSpec = SizableSpec> {
  kept: TSpec[];
  dropped: TSpec[];
  score: number;
  reason: string;
}

export interface SizeDelegationInput<TSpec = SizableSpec> {
  message?: unknown;
  taskPlan?: unknown;
  specs?: readonly TSpec[] | null;
}

/** Complexity score ceiling. */
export const MAX_DELEGATION_SCORE = 10;

/** Longest message prefix we scan (bounds regex cost on hostile huge input). */
const MESSAGE_SCAN_CAP = 20_000;

/** Roles that only think/plan — demotable at very-low complexity. */
const THINKING_ONLY_ROLES = new Set<string>(['architect', 'planner']);

/** Roles that produce the concrete deliverable — promoted to sole keeper. */
const BUILDER_ROLES = new Set<string>(['coder', 'debugger']);

/** Task kinds that are inherently multi-role (small complexity bump). */
const MULTI_ROLE_KINDS = new Set<string>(['build', 'architect', 'automation']);

// Multi-part / conjunction connectors (global — counted).
const CONNECTOR_RE =
  /\b(and|also|plus|then|next|while|after|additionally|furthermore|moreover|as well as|along with|followed by|simultaneously|in parallel)\b/gi;

// List / step markers at the start of a line (global — counted).
const LIST_MARKER_RE = /(^|\n)\s*(?:\d+[.)]|[-*•])\s+/g;

// Distinct imperative build verbs (global — deduped for breadth signal).
const VERB_RE =
  /\b(builds?|implements?|creates?|adds?|refactors?|migrates?|integrates?|designs?|architects?|fix(?:es)?|debugs?|tests?|testing|reviews?|deploys?|optimi[sz]es?|writes?|updates?|removes?|deletes?|configures?|wires?|connects?|generates?|rewrites?|extends?|audits?|automates?|orchestrates?)\b/gi;

// ── coercion helpers (total) ──────────────────────────────────────────────

function coerceString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= MAX_DELEGATION_SCORE) return MAX_DELEGATION_SCORE;
  return Math.round(value);
}

function countMatches(text: string, re: RegExp): number {
  if (!text) return 0;
  const matched = text.match(re);
  return matched ? matched.length : 0;
}

/** Pull a lowercased role from either `spec.role` or `spec.subagent.role`. */
export function extractSpecRole(spec: unknown): string {
  if (!spec || typeof spec !== 'object') return '';
  const rec = spec as Record<string, unknown>;
  if (typeof rec.role === 'string' && rec.role.trim()) return rec.role.trim().toLowerCase();
  const sub = rec.subagent;
  if (sub && typeof sub === 'object') {
    const nested = (sub as Record<string, unknown>).role;
    if (typeof nested === 'string' && nested.trim()) return nested.trim().toLowerCase();
  }
  return '';
}

function extractTaskKind(taskPlan: unknown): string {
  if (taskPlan && typeof taskPlan === 'object') {
    const kind = (taskPlan as Record<string, unknown>).kind;
    if (typeof kind === 'string') return kind.trim().toLowerCase();
  }
  return '';
}

function extractVerificationCount(taskPlan: unknown): number {
  if (taskPlan && typeof taskPlan === 'object') {
    const verification = (taskPlan as Record<string, unknown>).verification;
    if (Array.isArray(verification)) return verification.length;
  }
  return 0;
}

// ── scoring ────────────────────────────────────────────────────────────────

/**
 * Score task complexity 0–10 from message length, multi-part connectors, list/
 * step markers, imperative-verb breadth, and the task plan (kind + verification
 * breadth). Deterministic and total — junk inputs score 0.
 */
export function scoreDelegationComplexity(
  input?: { message?: unknown; taskPlan?: unknown } | null,
): number {
  const message = coerceString(input?.message).slice(0, MESSAGE_SCAN_CAP);
  const taskPlan = input?.taskPlan;

  let score = 0;

  // (1) length — longer asks tend to carry more independent work (0–3).
  const len = message.trim().length;
  if (len >= 420) score += 3;
  else if (len >= 200) score += 2;
  else if (len >= 80) score += 1;

  // (2) multi-part connectors (0–2).
  const connectors = countMatches(message, CONNECTOR_RE);
  if (connectors >= 3) score += 2;
  else if (connectors >= 1) score += 1;

  // (3) explicit list / numbered steps (0–2).
  const listMarkers = countMatches(message, LIST_MARKER_RE);
  if (listMarkers >= 3) score += 2;
  else if (listMarkers >= 1) score += 1;

  // (4) breadth of distinct imperative verbs (0–2).
  const verbTokens = message.match(VERB_RE) || [];
  const distinctVerbs = new Set(verbTokens.map((token) => token.toLowerCase().replace(/(?:es|s)$/, ''))).size;
  if (distinctVerbs >= 4) score += 2;
  else if (distinctVerbs >= 2) score += 1;

  // (5) inherently multi-role task kind (0–1).
  if (MULTI_ROLE_KINDS.has(extractTaskKind(taskPlan))) score += 1;

  // (6) verification breadth — more required checks ⇒ more surface (0–2).
  const verificationCount = extractVerificationCount(taskPlan);
  if (verificationCount >= 4) score += 2;
  else if (verificationCount >= 2) score += 1;

  return clampScore(score);
}

/** Map a 0–10 complexity score to a complexity tier. */
export function tierForScore(score: unknown): DelegationTier {
  const s = clampScore(typeof score === 'number' ? score : 0);
  if (s <= 2) return 'very-low';
  if (s <= 4) return 'low';
  if (s <= 6) return 'medium';
  return 'high';
}

/** Map a 0–10 complexity score to the max number of specialists (1–4). */
export function maxSpecialistsForScore(score: unknown): number {
  const s = clampScore(typeof score === 'number' ? score : 0);
  if (s <= 2) return 1;
  if (s <= 4) return 2;
  if (s <= 6) return 3;
  return 4;
}

// ── main sizing ──────────────────────────────────────────────────────────────

function summarizeRoles(specs: unknown[], limit = 4): string {
  const roles = specs.map(extractSpecRole).filter(Boolean);
  if (roles.length === 0) return 'unlabeled';
  const shown = roles.slice(0, limit);
  const extra = roles.length - shown.length;
  return shown.join(', ') + (extra > 0 ? ` +${extra}` : '');
}

/**
 * Trim a proposed specialist spec list down to the size the task justifies.
 *
 * Generic over the concrete spec element type: `kept`/`dropped` hold the SAME
 * object references from `input.specs`, so a caller can hand `kept` back as its
 * real `SubagentTaskSpec[]` (role read from `spec.subagent.role`).
 */
export function sizeDelegationSpecs<TSpec = SizableSpec>(
  input?: SizeDelegationInput<TSpec> | null,
): DelegationSizing<TSpec> {
  const specs = coerceArray<TSpec>(input?.specs);
  const score = scoreDelegationComplexity({ message: input?.message, taskPlan: input?.taskPlan });
  const tier = tierForScore(score);
  const maxKeep = maxSpecialistsForScore(score);

  if (specs.length === 0) {
    return {
      kept: [],
      dropped: [],
      score,
      reason: `${tier} complexity (score ${score}/${MAX_DELEGATION_SCORE}) → no specialists proposed`.slice(0, 200),
    };
  }

  // Decide which indices to keep, preserving insertion order.
  const keepIndices = new Set<number>();
  if (maxKeep <= 1) {
    // very-low: exactly one keeper. Prefer the concrete builder over an
    // unconditional thinking-only first spec (architect/planner) so trivial
    // builds run coder-only rather than paying for an architect.
    let keepIdx = 0;
    if (THINKING_ONLY_ROLES.has(extractSpecRole(specs[0]))) {
      const builderIdx = specs.findIndex((spec) => BUILDER_ROLES.has(extractSpecRole(spec)));
      if (builderIdx >= 0) keepIdx = builderIdx;
    }
    keepIndices.add(keepIdx);
  } else {
    // low/medium/high: keep the first `maxKeep` specs in insertion order.
    for (let i = 0; i < specs.length && keepIndices.size < maxKeep; i += 1) {
      keepIndices.add(i);
    }
  }

  const kept: TSpec[] = [];
  const dropped: TSpec[] = [];
  for (let i = 0; i < specs.length; i += 1) {
    if (keepIndices.has(i)) kept.push(specs[i]);
    else dropped.push(specs[i]);
  }

  // Defence-in-depth: never return zero for a non-empty input.
  if (kept.length === 0) {
    kept.push(specs[0]);
    if (dropped.length > 0 && dropped[0] === specs[0]) dropped.shift();
  }

  const reason = (
    `${tier} complexity (score ${score}/${MAX_DELEGATION_SCORE}) → keep ${kept.length} of ${specs.length} specialist(s)` +
    (dropped.length > 0 ? `; dropped ${summarizeRoles(dropped)}` : '')
  ).slice(0, 200);

  return { kept, dropped, score, reason };
}
