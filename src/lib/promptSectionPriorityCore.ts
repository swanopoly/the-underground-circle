/**
 * promptSectionPriorityCore — priority-aware fit for the chat system-prompt
 * dynamic tail.
 *
 * THE PROBLEM (grounded in src/lib/chatPromptAssembly.ts):
 * `assembleChatPromptExtras` emits every rendered section in the FIXED
 * `CHAT_PROMPT_SECTION_ORDER`, joins with '\n\n', then hard-clips the combined
 * string at the tier's `maxExtrasChars` (from `resolveChatPromptContextPolicy`).
 * The clip always eats the TAIL — so `last_session` (dead last in the order,
 * and often the single most useful continuity block) is the FIRST thing to die
 * when the budget is tight, while a decorative `circle_snapshot`/`wiki_context`
 * earlier in the order survives untouched. That is exactly backwards.
 *
 * THE FIX (this module):
 * A pure, priority-aware planner that decides — BEFORE the blind tail-clip
 * runs — WHICH sections to keep, drop, or truncate so the highest-value context
 * survives a tight budget. It greedily keeps sections in descending priority;
 * a high-priority section that will not fit whole is TRUNCATED (kept partial)
 * rather than dropped, and the low-priority tail is dropped FIRST. The returned
 * plan (keep / drop / truncate + keptTokens) lets the caller drop/shrink
 * sections up front, then emit the survivors in the canonical order.
 *
 * Pure by construction: `import type` only, tsx-loadable, bounded, total —
 * every export returns a safe neutral plan on null/undefined/wrong/huge/hostile/
 * cyclic input and NEVER throws. No Date.now()/Math.random() at module scope.
 */

import type { ChatPromptSectionKey } from './chatPromptAssembly';

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Priority given to an unknown / un-ranked section key (mid-scale, keep-worthy). */
export const SECTION_PRIORITY_NEUTRAL = 50;

/**
 * A section that does not fit whole is TRUNCATED (kept partial) instead of
 * dropped only when its priority is at or above this threshold; below it the
 * section is dropped. Decorative sections (`circle_snapshot`, `wiki_context`,
 * `missions`, `soul_wisdom`) sit below this line by default, so they drop
 * cleanly rather than leaving a low-value fragment in the prompt.
 */
export const DEFAULT_TRUNCATE_MIN_PRIORITY = 50;

/**
 * Remaining budget (tokens) below which truncating is pointless — a fragment
 * this small carries no signal, so the over-budget section is dropped and the
 * space is left for a smaller whole section instead.
 */
export const DEFAULT_MIN_TRUNCATE_TOKENS = 24;

// Bounds keep every path total on hostile/huge input.
const MAX_TOKENS = 1_000_000_000;
const MAX_PRIORITY_MAGNITUDE = 1_000_000;
const MAX_SECTIONS = 5_000;
const MAX_KEY_LEN = 256;

// ─── Default ranking (keyed by the REAL section keys) ────────────────────────

/**
 * Default value ranking for every dynamic section, higher = keep. Grounded to
 * `ChatPromptSectionKey` from chatPromptAssembly.ts, so this map must cover
 * exactly the real registry (the type errors if a key is missing or invented;
 * the smoke pins it against `CHAT_PROMPT_SECTION_ORDER`). Structurally this is
 * the requested `Record<string, number>`; the tighter key type just enforces
 * completeness at author time.
 *
 * Tiers:
 *   ~90-100  foundation / identity / app-grounding (must never drop)
 *   ~80-90   this turn's request + user-supplied material (attachments, @mentions)
 *   ~70-80   user memory & session continuity (incl. `last_session` — the block
 *            the legacy tail-clip killed first; elevated here so it survives)
 *   ~50-67   task execution support (computer/design/cad runbooks, skills, repo)
 *   ~30-49   decorative / broad context (dropped first, never truncated)
 */
export const DEFAULT_SECTION_PRIORITY: Record<ChatPromptSectionKey, number> = {
  // Foundation / identity / app-grounding.
  runtime_bundle: 100,
  blackswan_grounding: 96,
  agent_identity: 92,

  // This turn's request routing + user-supplied material.
  task_pipeline: 90,
  computer_request_route: 88,
  attachment_context: 87,
  codebase_mentions: 86,
  computer_strategy: 84,
  computer_grounding: 83,
  turn_retrieval: 82,

  // User memory & session continuity.
  memory_user_notes: 80,
  last_session: 78,
  memory_user_profile: 76,
  user_chat_profile: 74,
  connected_resources: 73,
  proactive_surfacing: 72,
  memory_working: 71,
  memory_runtime: 70,

  // Task execution support.
  skills: 66,
  project_conventions: 64,
  project_discovery: 62,
  design_execution_pipeline: 60,
  design_automation: 58,
  computer_receipt: 57,
  design_creative_ai: 56,
  design_operation_runbook: 55,
  cad_operation_runbook: 55,
  collab_manifest: 54,
  design_proof_review: 53,
  collab_note: 52,
  design_creative_ai_recipe: 52,
  design_object_manifest: 51,

  // Decorative / broad context (dropped first, never truncated).
  soul_wisdom: 44,
  missions: 42,
  wiki_context: 40,
  circle_snapshot: 34,
};

/**
 * Canonical emit order — a runtime mirror of `CHAT_PROMPT_SECTION_ORDER` in
 * chatPromptAssembly.ts (kept in LOCKSTEP; the smoke fails if they drift). We
 * re-declare rather than import so this module stays free of runtime imports
 * (tsx-loadable). Output arrays are ordered by this list so a plan slots back
 * into the assembler without re-sorting.
 */
export const SECTION_EMIT_ORDER: ReadonlyArray<ChatPromptSectionKey> = [
  'runtime_bundle',
  'task_pipeline',
  'computer_request_route',
  'computer_strategy',
  'computer_grounding',
  'design_automation',
  'design_execution_pipeline',
  'design_creative_ai',
  'design_creative_ai_recipe',
  'design_object_manifest',
  'design_operation_runbook',
  'design_proof_review',
  'cad_operation_runbook',
  'computer_receipt',
  'collab_manifest',
  'collab_note',
  'blackswan_grounding',
  'connected_resources',
  'user_chat_profile',
  'memory_user_notes',
  'memory_user_profile',
  'memory_runtime',
  'memory_working',
  'soul_wisdom',
  'turn_retrieval',
  'wiki_context',
  'attachment_context',
  'codebase_mentions',
  'project_discovery',
  'project_conventions',
  'skills',
  'agent_identity',
  'missions',
  'circle_snapshot',
  'proactive_surfacing',
  'last_session',
];

const EMIT_ORDER_INDEX: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (let i = 0; i < SECTION_EMIT_ORDER.length; i += 1) m.set(SECTION_EMIT_ORDER[i], i);
  return m;
})();

/** Default value for a section key; neutral for unknown / non-string keys. */
export function resolveSectionPriority(key: unknown): number {
  if (typeof key !== 'string') return SECTION_PRIORITY_NEUTRAL;
  const v = (DEFAULT_SECTION_PRIORITY as Record<string, number>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : SECTION_PRIORITY_NEUTRAL;
}

// ─── Public contract ─────────────────────────────────────────────────────────

export interface SectionInput {
  key: string;
  /** Estimated size of the rendered section. */
  tokens: number;
  /** Higher = keep. Use `resolveSectionPriority`/`DEFAULT_SECTION_PRIORITY` for defaults. */
  priority: number;
}

export interface PlanSectionFitResult {
  /** Sections kept whole, in canonical emit order. */
  keep: string[];
  /** Sections dropped entirely, in canonical emit order. */
  drop: string[];
  /** Sections kept but shrunk to `toTokens`, in canonical emit order. */
  truncate: Array<{ key: string; toTokens: number }>;
  /** Total tokens the plan keeps (whole + truncated) — always ≤ sanitized budget. */
  keptTokens: number;
}

export interface PlanSectionFitOptions {
  /** Min priority for an over-budget section to truncate (else drop). Default 50. */
  truncateMinPriority?: number;
  /** Min remaining tokens worth truncating into. Default 24. */
  minTruncateTokens?: number;
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface CleanSection {
  key: string;
  tokens: number;
  priority: number;
  order: number; // emit-order index (known) or SECTION_EMIT_ORDER.length + seq (unknown)
  seq: number; // insertion index among cleaned sections
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' ? NaN : Number(t);
  }
  return NaN;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Finite, non-negative, integer token count. NaN/-Inf/≤0 → 0; +Inf/over-cap → cap. */
function sanitizeTokenCount(value: unknown): number {
  const n = coerceNumber(value);
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return MAX_TOKENS;
  if (n <= 0) return 0;
  return Math.floor(Math.min(n, MAX_TOKENS));
}

function sanitizePriority(value: unknown, key: string): number {
  const n = coerceNumber(value);
  if (Number.isNaN(n)) return resolveSectionPriority(key); // fall back to the key's default
  if (n === Infinity) return MAX_PRIORITY_MAGNITUDE;
  if (n === -Infinity) return -MAX_PRIORITY_MAGNITUDE;
  return clamp(n, -MAX_PRIORITY_MAGNITUDE, MAX_PRIORITY_MAGNITUDE);
}

function sanitizeThreshold(value: unknown, fallback: number): number {
  const n = coerceNumber(value);
  if (Number.isNaN(n)) return fallback;
  if (n === Infinity) return MAX_PRIORITY_MAGNITUDE;
  if (n === -Infinity) return -MAX_PRIORITY_MAGNITUDE;
  return clamp(n, -MAX_PRIORITY_MAGNITUDE, MAX_PRIORITY_MAGNITUDE);
}

function sanitizeMinTrunc(value: unknown, fallback: number): number {
  const n = coerceNumber(value);
  if (Number.isNaN(n)) return fallback;
  if (n === Infinity) return MAX_TOKENS;
  if (n < 0) return 0;
  return Math.floor(Math.min(n, MAX_TOKENS));
}

/** Read {key,tokens,priority} from an untrusted value; null when unusable. */
function readSection(raw: unknown): { key: string; tokensRaw: unknown; priorityRaw: unknown } | null {
  if (raw === null || typeof raw !== 'object') return null;
  try {
    const rec = raw as Record<string, unknown>;
    const rawKey = rec.key; // may invoke a hostile getter → guarded by try/catch
    if (typeof rawKey !== 'string') return null;
    const trimmed = rawKey.trim();
    if (trimmed === '') return null;
    const key = trimmed.length > MAX_KEY_LEN ? trimmed.slice(0, MAX_KEY_LEN) : trimmed;
    return { key, tokensRaw: rec.tokens, priorityRaw: rec.priority };
  } catch {
    return null;
  }
}

const EMPTY_PLAN: PlanSectionFitResult = { keep: [], drop: [], truncate: [], keptTokens: 0 };

// ─── planSectionFit ──────────────────────────────────────────────────────────

/**
 * Greedily keep the highest-priority sections within `budgetTokens`. A
 * high-priority section that does not fit whole is TRUNCATED (kept partial) to
 * fill the remaining budget rather than dropped; low-priority sections are
 * dropped first. Output arrays are in canonical `SECTION_EMIT_ORDER`, so the
 * plan drops straight back into `assembleChatPromptExtras`. Deterministic,
 * bounded, total: any hostile input yields a safe partition (empty when
 * nothing is usable), never a throw. `keptTokens` is always ≤ the sanitized
 * budget.
 */
export function planSectionFit(
  sections: unknown,
  budgetTokens: unknown,
  opts?: PlanSectionFitOptions,
): PlanSectionFitResult {
  try {
    const budget = sanitizeTokenCount(budgetTokens);
    const truncateMinPriority = sanitizeThreshold(opts?.truncateMinPriority, DEFAULT_TRUNCATE_MIN_PRIORITY);
    const minTruncateTokens = sanitizeMinTrunc(opts?.minTruncateTokens, DEFAULT_MIN_TRUNCATE_TOKENS);

    const arr = Array.isArray(sections) ? sections : [];
    const limit = Math.min(arr.length, MAX_SECTIONS);
    const clean: CleanSection[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < limit; i += 1) {
      const parsed = readSection(arr[i]);
      if (!parsed) continue;
      if (seen.has(parsed.key)) continue; // first occurrence wins → each key lands in one bucket
      seen.add(parsed.key);
      const seq = clean.length;
      const known = EMIT_ORDER_INDEX.get(parsed.key);
      clean.push({
        key: parsed.key,
        tokens: sanitizeTokenCount(parsed.tokensRaw),
        priority: sanitizePriority(parsed.priorityRaw, parsed.key),
        order: known === undefined ? SECTION_EMIT_ORDER.length + seq : known,
        seq,
      });
    }

    if (clean.length === 0) return { keep: [], drop: [], truncate: [], keptTokens: 0 };

    // Greedy decision in descending priority. Ties break by canonical order then
    // insertion order → a total, deterministic ordering independent of sort stability.
    const byPriority = clean.slice().sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.order !== b.order) return a.order - b.order;
      return a.seq - b.seq;
    });

    type Decision = { kind: 'keep' } | { kind: 'drop' } | { kind: 'truncate'; toTokens: number };
    const decision = new Map<string, Decision>();
    let used = 0;
    for (const s of byPriority) {
      // Empty/costless sections are never dropped for budget reasons.
      if (s.tokens <= 0) {
        decision.set(s.key, { kind: 'keep' });
        continue;
      }
      const remaining = budget - used;
      if (remaining <= 0) {
        decision.set(s.key, { kind: 'drop' });
        continue;
      }
      if (s.tokens <= remaining) {
        decision.set(s.key, { kind: 'keep' });
        used += s.tokens;
        continue;
      }
      // Does not fit whole: truncate a high-priority section into the remaining
      // budget; otherwise drop it (and let a smaller lower section fill the gap).
      if (s.priority >= truncateMinPriority && remaining >= minTruncateTokens) {
        decision.set(s.key, { kind: 'truncate', toTokens: remaining });
        used += remaining; // budget now exhausted → everything after drops
      } else {
        decision.set(s.key, { kind: 'drop' });
      }
    }

    // Emit the plan in canonical order.
    const ordered = clean.slice().sort((a, b) => (a.order !== b.order ? a.order - b.order : a.seq - b.seq));
    const keep: string[] = [];
    const drop: string[] = [];
    const truncate: Array<{ key: string; toTokens: number }> = [];
    let keptTokens = 0;
    for (const s of ordered) {
      const d = decision.get(s.key);
      if (!d || d.kind === 'drop') {
        drop.push(s.key);
      } else if (d.kind === 'keep') {
        keep.push(s.key);
        keptTokens += s.tokens;
      } else {
        truncate.push({ key: s.key, toTokens: d.toTokens });
        keptTokens += d.toTokens;
      }
    }
    if (keptTokens > budget) keptTokens = budget; // invariant guard (defensive)

    return { keep, drop, truncate, keptTokens };
  } catch {
    return { keep: [], drop: [], truncate: [], keptTokens: 0 };
  }
}

/** Frozen empty plan (exported for callers that need a no-op reference). */
export const EMPTY_SECTION_FIT_PLAN: Readonly<PlanSectionFitResult> = EMPTY_PLAN;
