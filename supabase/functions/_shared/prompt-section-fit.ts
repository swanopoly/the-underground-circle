/**
 * prompt-section-fit — Deno-side mirror of `planSectionFit` from
 * `src/lib/promptSectionPriorityCore.ts`.
 *
 * WHY THIS FILE EXISTS
 * `src/lib/v2MemoryInjectionCore.ts` takes its section planner as an INJECTED
 * dependency so it can stay import-free (the house rule for every core the edge
 * imports: Deno resolves the whole graph, and `promptSectionPriorityCore`
 * reaches `chatPromptAssembly` through a type import that will not resolve).
 * The client injects the real `promptSectionPriorityCore.planSectionFit`; the
 * edge injects this.
 *
 * LOCKSTEP: `scripts/v2-memory-injection-core-smoketest.ts` runs BOTH this
 * function and the real one over the same battery of cases and asserts the
 * plans are identical. If the algorithm or its constants change on either side
 * without the other, that smoke fails. Do not edit one without the other.
 *
 * The ONLY intentional deviation from the source: `ChatPromptSectionKey` is
 * widened to `string`, because the key union lives in `chatPromptAssembly` and
 * dragging it here would reintroduce the exact unresolvable import this file
 * exists to avoid. Key VALIDITY is not this function's job — the v2 core
 * allowlists keys before it ever calls a planner.
 */

export const SECTION_PRIORITY_NEUTRAL = 50;
export const DEFAULT_TRUNCATE_MIN_PRIORITY = 50;
export const DEFAULT_MIN_TRUNCATE_TOKENS = 24;

/** Canonical emit order. Mirrors SECTION_EMIT_ORDER for the keys v2 can emit;
 *  unknown keys sort after these, in insertion order (same as the source). */
const SECTION_EMIT_ORDER: readonly string[] = [
  'turn_retrieval',
  'memory_user_notes',
  'memory_user_profile',
  'memory_working',
  'memory_runtime',
  'soul_wisdom',
];

const MAX_SECTIONS = 200;
const EMIT_ORDER_INDEX = new Map<string, number>(SECTION_EMIT_ORDER.map((k, i) => [k, i]));

export interface PlanSectionFitResult {
  keep: string[];
  drop: string[];
  truncate: Array<{ key: string; toTokens: number }>;
  keptTokens: number;
}

export interface PlanSectionFitOptions {
  truncateMinPriority?: unknown;
  minTruncateTokens?: unknown;
}

type CleanSection = { key: string; tokens: number; priority: number; order: number; seq: number };

const EMPTY_PLAN: PlanSectionFitResult = { keep: [], drop: [], truncate: [], keptTokens: 0 };

function sanitizeTokenCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function sanitizeThreshold(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function sanitizeMinTrunc(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function sanitizePriority(value: unknown, _key: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return SECTION_PRIORITY_NEUTRAL;
  return n;
}

function readSection(raw: unknown): { key: string; tokensRaw: unknown; priorityRaw: unknown } | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const key = typeof rec.key === 'string' ? rec.key.trim() : '';
  if (!key) return null;
  return { key, tokensRaw: rec.tokens, priorityRaw: rec.priority };
}

/** Byte-for-byte behavioural mirror of promptSectionPriorityCore.planSectionFit. */
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
      if (seen.has(parsed.key)) continue;
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

    const byPriority = clean.slice().sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.order !== b.order) return a.order - b.order;
      return a.seq - b.seq;
    });

    type Decision = { kind: 'keep' } | { kind: 'drop' } | { kind: 'truncate'; toTokens: number };
    const decision = new Map<string, Decision>();
    let used = 0;
    for (const s of byPriority) {
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
      if (s.priority >= truncateMinPriority && remaining >= minTruncateTokens) {
        decision.set(s.key, { kind: 'truncate', toTokens: remaining });
        used += remaining;
      } else {
        decision.set(s.key, { kind: 'drop' });
      }
    }

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
    if (keptTokens > budget) keptTokens = budget;

    return { keep, drop, truncate, keptTokens };
  } catch {
    return { ...EMPTY_PLAN, keep: [], drop: [], truncate: [] };
  }
}
