import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMissionStreakRowExact } from '../src/lib/missionStreakExactCore';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const streakSource = fs.readFileSync(path.join(root, 'src/lib/missionStreaks.ts'), 'utf8');
const panelSource = fs.readFileSync(
  path.join(root, 'src/screens/circles/tabs/office/AgentEvolutionPanel.tsx'),
  'utf8',
);

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

const authority = { userId: 'user-a', circleId: 'circle-a' };
const validRow = {
  user_id: authority.userId,
  circle_id: authority.circleId,
  current_streak: 3,
  longest_streak: 8,
  last_completion_date: '2026-08-17',
  total_tasks_completed: 24,
};

const valid = normalizeMissionStreakRowExact(validRow, authority);
check(valid?.currentStreak === 3 && valid.longestStreak === 8, 'a complete exact row becomes a streak');
check(normalizeMissionStreakRowExact(null, authority) === null, 'a verified missing row stays distinct from zero and malformed data');
check(normalizeMissionStreakRowExact({ ...validRow, user_id: 'user-b' }, authority) === undefined, 'a foreign owner row fails closed');
check(normalizeMissionStreakRowExact({ ...validRow, circle_id: 'circle-b' }, authority) === undefined, 'a foreign circle row fails closed');
check(normalizeMissionStreakRowExact({ ...validRow, current_streak: '3' }, authority) === undefined, 'numeric strings are not coerced into verified streak values');
check(normalizeMissionStreakRowExact({ ...validRow, current_streak: 9 }, authority) === undefined, 'current streak cannot exceed the durable longest streak');
check(normalizeMissionStreakRowExact({ ...validRow, current_streak: 3, total_tasks_completed: 2 }, authority) === undefined, 'current streak cannot exceed completed-task evidence');
check(normalizeMissionStreakRowExact({ ...validRow, last_completion_date: null }, authority) === undefined, 'a positive streak requires a completion date');
check(normalizeMissionStreakRowExact({ ...validRow, total_tasks_completed: -1 }, authority) === undefined, 'negative counters fail closed');
check(normalizeMissionStreakRowExact({ ...validRow, last_completion_date: 'not-a-date' }, authority) === undefined, 'malformed completion dates fail closed');
check(normalizeMissionStreakRowExact({ ...validRow, last_completion_date: '2026-02-31' }, authority) === undefined, 'normalized impossible calendar dates fail closed');

check(
  streakSource.includes("safeGetUserForAccessToken(authority.accessToken)")
    && !streakSource.includes('supabase.auth.getUser('),
  'exact streak read verifies the captured bearer through the bounded auth wrapper',
);
check(streakSource.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), 'exact streak query binds the captured bearer');
check(streakSource.includes(".eq('user_id', authority.userId)\n      .eq('circle_id', authority.circleId)"), 'exact streak query binds owner and circle');
check((streakSource.match(/isExactStreakAuthorityCurrent\(authority, fence\)/g) || []).length >= 4, 'authority fence surrounds every awaited read phase');
check(panelSource.includes('Promise.all([\n      getAgentProgression'), 'Evolution verifies progression and streak as one load state');
check(panelSource.includes('loadMissionStreakExact(capturedAuthority, isIdentityAuthorityCurrent)'), 'Evolution consumes the exact durable streak reader');
check(!panelSource.includes('loadStreak(userId, circleId)'), 'Evolution no longer presents an unverified local streak as zero');
check(panelSource.includes('Owner mission streak'), 'Evolution labels the user-level streak without implying agent-specific progress');
check(panelSource.includes('accessibilityLabel="Loading verified agent progression and streak"'), 'Evolution loading state is announced accessibly');

console.log(`\nPASS: ${assertions} Office agent Evolution exact-streak assertions`);
