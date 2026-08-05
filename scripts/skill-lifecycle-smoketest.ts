/**
 * skill-lifecycle-smoketest — L2 skill lifecycle (Learning Loop research,
 * findings 1-3): first-use outcome stats (record/merge/bounds), the
 * health/deprecation evaluator matrix, and the failing-only injection
 * marker. Pure module (`src/lib/skillLifecycle.ts`) — no react-native or
 * supabase imports, so tsx can load it directly.
 *
 * Run: npm run smoke:skill-lifecycle
 */

import {
  appendSkillRunOutcomeToStats,
  compactSkillRunStats,
  evaluateSkillHealth,
  skillHealthMarker,
  SKILL_STATS_MAX_OUTCOMES,
  SKILL_STATS_MAX_SKILLS,
  type SkillRunOutcome,
  type SkillRunStats,
} from '../src/lib/skillLifecycle';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

const NOW = Date.parse('2026-06-12T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const outcome = (ok: boolean, days: number, taskKind?: string): SkillRunOutcome => ({ ok, atIso: daysAgo(days), taskKind });

// ─── Stats: record / merge / bounds ─────────────────────────────────────────

{
  let stats: SkillRunStats[] = [];
  stats = appendSkillRunOutcomeToStats(stats, 'recipe-invoice-pipeline', outcome(true, 3, 'hybrid_task'));
  stats = appendSkillRunOutcomeToStats(stats, 'recipe-invoice-pipeline', outcome(false, 1));
  assert(stats.length === 1, 'stats: same skill merges into one entry');
  assert(stats[0].outcomes.length === 2, 'stats: outcomes accumulate');
  assert(stats[0].outcomes[0].ok === false && stats[0].outcomes[1].ok === true, 'stats: newest outcome first');
  assert(stats[0].lastUsedAtIso === daysAgo(1), 'stats: lastUsedAtIso tracks newest outcome');
  assert(stats[0].outcomes[1].taskKind === 'hybrid_task', 'stats: taskKind preserved');

  // Outcome bound: ≤10 per skill, newest kept.
  for (let i = 0; i < 15; i += 1) {
    stats = appendSkillRunOutcomeToStats(stats, 'recipe-invoice-pipeline', outcome(true, 0));
  }
  assert(stats[0].outcomes.length === SKILL_STATS_MAX_OUTCOMES, 'stats: outcomes bounded ≤10', String(stats[0].outcomes.length));

  // Skill bound: ≤50 per circle, least-recently-used dropped.
  let many: SkillRunStats[] = [];
  for (let i = 0; i < 55; i += 1) {
    // Older skills used longer ago (skill-0 used 55 days ago … skill-54 yesterday).
    many = appendSkillRunOutcomeToStats(many, `skill-${i}`, outcome(true, 55 - i));
  }
  assert(many.length === SKILL_STATS_MAX_SKILLS, 'stats: skill list bounded ≤50', String(many.length));
  assert(!many.some((entry) => entry.skillName === 'skill-0'), 'stats: least-recently-used skill dropped');
  assert(many.some((entry) => entry.skillName === 'skill-54'), 'stats: most-recently-used skill kept');

  // Garbage in → bounded normalized out.
  assert(compactSkillRunStats('junk').length === 0, 'stats: junk storage payload → []');
  assert(compactSkillRunStats(null).length === 0, 'stats: null → []');
  const normalized = compactSkillRunStats([
    { skillName: 'ok-skill', outcomes: [{ ok: true, atIso: daysAgo(2) }, { ok: 'nope', atIso: daysAgo(1) }, { ok: false, atIso: 'not-a-date' }] },
    { skillName: '', outcomes: [] },
    { nope: true },
  ]);
  assert(normalized.length === 1, 'stats: malformed entries dropped');
  assert(normalized[0].outcomes.length === 1, 'stats: malformed outcomes dropped');
  assert(normalized[0].lastUsedAtIso === daysAgo(2), 'stats: lastUsedAtIso backfilled from newest outcome');
  assert(appendSkillRunOutcomeToStats([], 'x', { ok: true, atIso: 'garbage' } as any).length === 0, 'stats: unparseable outcome timestamp rejected');
}

// ─── Health matrix ──────────────────────────────────────────────────────────

{
  const health = (outcomes: SkillRunOutcome[], lastUsedAtIso: string | null = outcomes[0]?.atIso || null) =>
    evaluateSkillHealth({ outcomes, lastUsedAtIso }, NOW);

  assert(evaluateSkillHealth(null, NOW).status === 'healthy', 'health: no stats → healthy');
  assert(health([]).status === 'healthy', 'health: zero uses → healthy (never used ≠ stale)');
  assert(health([outcome(true, 1)]).status === 'healthy', 'health: one success → healthy');
  assert(health([outcome(false, 1)]).status === 'healthy', 'health: ONE failure → still healthy (not yet a streak)');
  assert(health([outcome(false, 1), outcome(false, 2)]).status === 'failing', 'health: 2 consecutive failures → failing');
  assert(health([outcome(false, 1), outcome(false, 2), outcome(true, 3)]).status === 'failing', 'health: failure streak after old success → failing');
  assert(health([outcome(true, 1), outcome(false, 2), outcome(false, 3)]).status === 'healthy', 'health: newest success breaks the streak (3 uses, no rate rule yet)');
  // Rate rule: <50% over ≥4 uses (streak-free orderings).
  assert(
    health([outcome(true, 1), outcome(false, 2), outcome(true, 3), outcome(false, 4), outcome(false, 5), outcome(false, 6)]).status === 'failing',
    'health: 2/6 successes (<50% over ≥4 uses) → failing',
  );
  assert(
    health([outcome(true, 1), outcome(false, 2), outcome(true, 3), outcome(false, 4)]).status === 'healthy',
    'health: exactly 50% over 4 uses → not failing',
  );
  assert(
    health([outcome(true, 1), outcome(false, 2), outcome(false, 3)]).status === 'healthy',
    'health: 33% over only 3 uses → rate rule not active yet',
  );
  // Staleness: unused 90 days.
  assert(health([outcome(true, 91)]).status === 'stale', 'health: unused 91 days → stale');
  assert(health([outcome(true, 89)]).status === 'healthy', 'health: used 89 days ago → healthy');
  const staleReason = health([outcome(true, 120)]);
  assert(staleReason.reason.includes('120 days'), 'health: stale reason carries the day count', staleReason.reason);
  // Failing dominates stale.
  assert(health([outcome(false, 95), outcome(false, 96)]).status === 'failing', 'health: failing wins over stale');
  // Reasons are populated.
  assert(health([outcome(false, 1), outcome(false, 2)]).reason.includes('failed in a row'), 'health: failing reason names the streak');
}

// ─── Injection marker: failing only ─────────────────────────────────────────

{
  assert(skillHealthMarker({ status: 'failing', reason: 'x' }) === '⚠ failing — review', 'marker: failing → ⚠ failing — review');
  assert(skillHealthMarker({ status: 'healthy', reason: 'x' }) === '', 'marker: healthy → no marker');
  assert(skillHealthMarker({ status: 'stale', reason: 'x' }) === '', 'marker: stale → NO marker (failing-only, table stays quiet)');
  assert(skillHealthMarker(null) === '', 'marker: missing health → no marker');

  // Mirror of renderLibraryMetadataTable's append rule (skillLibrary.ts
  // drags in supabase, so the line shape is pinned here): the marker is
  // appended after the description for failing skills only.
  const renderLine = (name: string, description: string, marker: string) =>
    `- ${name} (v1.0.0): ${description}${marker ? ` ${marker}` : ''}`;
  const failingLine = renderLine('recipe-x', 'does x', skillHealthMarker({ status: 'failing', reason: 'r' }));
  const healthyLine = renderLine('recipe-y', 'does y', skillHealthMarker({ status: 'healthy', reason: 'r' }));
  assert(failingLine.endsWith('does x ⚠ failing — review'), 'marker: failing skill line carries the marker', failingLine);
  assert(healthyLine.endsWith('does y'), 'marker: healthy skill line unchanged', healthyLine);
}

if (failures > 0) {
  console.error(`\n${failures} skill-lifecycle smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll skill-lifecycle smoke cases passed.');
