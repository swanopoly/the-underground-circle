/**
 * skillLifecycle — pure L2 skill-lifecycle logic: per-skill run-outcome
 * stats (first-use write-back) and the health/deprecation evaluator.
 *
 * Research grounding (docs/LEARNING_LOOP_RESEARCH_2026-06-12.md):
 *   - Finding 2: eval-before-promote is the lifecycle pattern — repeated
 *     failure is a DEPRECATION SIGNAL surfaced for human review, never an
 *     auto-delete/deactivate (HITL principle).
 *   - Finding 1: outcome stats feed the future evaluator that decides
 *     which induced recipes earn their place in the library.
 *
 * Storage decision (L2 item 2): `circle_skills` has NO jsonb column
 * (RUN_THIS_SQL §10 — usage_count/success_count are plain ints) and the
 * only sanctioned write path is the HITL approval queue
 * (`skillLibraryWrite` — the runtime files proposals, never mutates the
 * table directly). Plain counters also cannot express what health needs
 * (consecutive-failure streaks + last-used staleness). So outcome stats
 * live in bounded DEVICE storage (see the async wrappers in
 * `skillLibrary.ts`) and merge into skill metadata at read time.
 *
 * Dependency-light on purpose (no imports at all) so tsx smoke tests can
 * load it — see scripts/skill-lifecycle-smoketest.ts.
 */

export interface SkillRunOutcome {
  ok: boolean;
  atIso: string;
  taskKind?: string | null;
}

export interface SkillRunStats {
  skillName: string;
  /** Newest first, bounded ≤10. */
  outcomes: SkillRunOutcome[];
  lastUsedAtIso: string | null;
}

export type SkillHealthStatus = 'healthy' | 'failing' | 'stale';

export interface SkillHealth {
  status: SkillHealthStatus;
  reason: string;
}

/** Bounds: ≤50 skills per circle × last 10 outcomes per skill. */
export const SKILL_STATS_MAX_SKILLS = 50;
export const SKILL_STATS_MAX_OUTCOMES = 10;
export const SKILL_STALE_AFTER_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

function compactOutcome(raw: Partial<SkillRunOutcome> | null | undefined): SkillRunOutcome | null {
  if (!raw || typeof raw !== 'object' || typeof raw.ok !== 'boolean') return null;
  const atIso = String(raw.atIso || '').slice(0, 40);
  if (!atIso || !Number.isFinite(Date.parse(atIso))) return null;
  return {
    ok: raw.ok,
    atIso,
    taskKind: raw.taskKind ? String(raw.taskKind).slice(0, 40) : null,
  };
}

/**
 * Normalize a stored stats list (parsed JSON of unknown shape): drop
 * malformed entries, bound outcomes per skill (newest first) and the
 * skill count (most recently used kept). Pure; never throws.
 */
export function compactSkillRunStats(raw: unknown): SkillRunStats[] {
  if (!Array.isArray(raw)) return [];
  const stats: SkillRunStats[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const skillName = String((item as any).skillName || '').trim().slice(0, 120);
    if (!skillName || stats.some((entry) => entry.skillName === skillName)) continue;
    const outcomes = (Array.isArray((item as any).outcomes) ? (item as any).outcomes : [])
      .map(compactOutcome)
      .filter((outcome: SkillRunOutcome | null): outcome is SkillRunOutcome => outcome !== null)
      .slice(0, SKILL_STATS_MAX_OUTCOMES);
    const lastUsedRaw = String((item as any).lastUsedAtIso || '');
    const lastUsedAtIso = Number.isFinite(Date.parse(lastUsedRaw))
      ? lastUsedRaw.slice(0, 40)
      : outcomes[0]?.atIso || null;
    stats.push({ skillName, outcomes, lastUsedAtIso });
  }
  return boundSkillCount(stats);
}

function lastUsedMs(entry: SkillRunStats): number {
  const parsed = entry.lastUsedAtIso ? Date.parse(entry.lastUsedAtIso) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Keep at most 50 skills — least-recently-used dropped first. */
function boundSkillCount(stats: SkillRunStats[]): SkillRunStats[] {
  if (stats.length <= SKILL_STATS_MAX_SKILLS) return stats;
  return [...stats]
    .sort((a, b) => lastUsedMs(b) - lastUsedMs(a))
    .slice(0, SKILL_STATS_MAX_SKILLS);
}

/**
 * Merge one run outcome into the stats list (first-use write-back).
 * Outcomes stay newest-first ≤10; the skill list stays ≤50 (LRU dropped).
 * Pure — the storage-backed wrapper lives in `skillLibrary.ts`.
 */
export function appendSkillRunOutcomeToStats(
  stats: SkillRunStats[] | null | undefined,
  skillName: string,
  outcome: SkillRunOutcome,
): SkillRunStats[] {
  const name = String(skillName || '').trim().slice(0, 120);
  const compact = compactOutcome(outcome);
  const base = compactSkillRunStats(stats || []);
  if (!name || !compact) return base;
  const existing = base.find((entry) => entry.skillName === name);
  const updated: SkillRunStats = {
    skillName: name,
    outcomes: [compact, ...(existing?.outcomes || [])].slice(0, SKILL_STATS_MAX_OUTCOMES),
    lastUsedAtIso: compact.atIso,
  };
  return boundSkillCount([updated, ...base.filter((entry) => entry.skillName !== name)]);
}

/**
 * Health/deprecation evaluator (finding 2 — eval, flag, never auto-retire):
 *   - failing: the 2 most recent uses both failed (consecutive-failure
 *     streak ≥2), OR success rate <50% over ≥4 recorded uses.
 *   - stale:   not failing, but unused for 90+ days.
 *   - healthy: everything else, including skills with no recorded uses yet.
 * Failing dominates stale. Pure; smoke-testable.
 */
export function evaluateSkillHealth(
  stats: Pick<SkillRunStats, 'outcomes' | 'lastUsedAtIso'> | null | undefined,
  nowMs: number = Date.now(),
): SkillHealth {
  const outcomes = (stats?.outcomes || []).map(compactOutcome).filter((o): o is SkillRunOutcome => o !== null);

  let streak = 0;
  for (const outcome of outcomes) {
    if (outcome.ok) break;
    streak += 1;
  }
  if (streak >= 2) {
    return { status: 'failing', reason: `last ${streak} uses failed in a row` };
  }
  if (outcomes.length >= 4) {
    const successes = outcomes.filter((outcome) => outcome.ok).length;
    if (successes / outcomes.length < 0.5) {
      return { status: 'failing', reason: `only ${successes}/${outcomes.length} recent uses succeeded` };
    }
  }

  const lastUsedRaw = stats?.lastUsedAtIso || outcomes[0]?.atIso || null;
  const lastUsed = lastUsedRaw ? Date.parse(lastUsedRaw) : NaN;
  if (Number.isFinite(lastUsed) && nowMs - lastUsed > SKILL_STALE_AFTER_DAYS * DAY_MS) {
    const days = Math.floor((nowMs - lastUsed) / DAY_MS);
    return { status: 'stale', reason: `unused for ${days} days` };
  }

  return {
    status: 'healthy',
    reason: outcomes.length === 0 ? 'no recorded uses yet' : 'recent uses look fine',
  };
}

/**
 * Compact marker for the skill metadata table — appended ONLY for failing
 * skills (stale/healthy stay unmarked to keep the table quiet). The marker
 * asks for human review; nothing is ever auto-deactivated.
 */
export function skillHealthMarker(health: SkillHealth | null | undefined): string {
  return health?.status === 'failing' ? '⚠ failing — review' : '';
}
