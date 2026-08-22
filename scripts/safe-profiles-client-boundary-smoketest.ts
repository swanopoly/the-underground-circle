import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let assertions = 0;

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const helper = read('src/lib/safeProfiles.ts');
const projection = helper.match(/export const SAFE_PROFILE_SELECT = \[([\s\S]*?)\]\.join/)?.[1] || '';
for (const field of [
  'id', 'username', 'display_name', 'avatar_url', 'bio',
  'current_streak', 'longest_streak', 'created_at', 'wallet_address', 'wallet_chain',
]) {
  assert(projection.includes(`'${field}'`), `safe profile projection must include ${field}`);
}
for (const privateField of [
  'office_preferences', 'training_privacy', 'org_id', 'wallet_address_eth',
  'wallet_address_sol', 'theme_color', 'xp', 'level', 'user_status',
]) {
  assert(!projection.includes(`'${privateField}'`), `safe profile projection must exclude ${privateField}`);
}

const membershipRead = helper.indexOf(".from('circle_members')");
const exactCircleFilter = helper.indexOf(".eq('circle_id', exactCircleId)", membershipRead);
const requestedIdFilter = helper.indexOf(".in('user_id', requestedIds)", exactCircleFilter);
const safeProfileRead = helper.indexOf(".from('safe_profiles')", requestedIdFilter);
const postIoConfirmation = helper.indexOf(".from('circle_members')", safeProfileRead + 1);
assert(membershipRead >= 0, 'safe hydration must read Circle membership');
assert(exactCircleFilter > membershipRead, 'safe hydration must bind one exact Circle');
assert(requestedIdFilter > exactCircleFilter, 'safe hydration must intersect requested ids with exact members');
assert(safeProfileRead > requestedIdFilter, 'safe_profiles must be read only after exact membership intersection');
assert(postIoConfirmation > safeProfileRead, 'exact Circle membership must be revalidated after profile I/O');
assert(helper.includes('slice(0, MAX_PROFILE_IDS)'), 'safe profile hydration must cap requested ids');
assert(helper.includes('exactMemberIds.has(id)'), 'safe profile rows must be intersected with exact members again');
assert(helper.includes('confirmedMemberIds.has(id)'), 'post-I/O membership confirmation must gate returned profiles');

const sourceFiles = fs.readdirSync(path.join(root, 'src'), { recursive: true })
  .map(value => String(value))
  .filter(value => /\.(ts|tsx)$/.test(value));
const executableEmbeds: string[] = [];
for (const relative of sourceFiles) {
  const source = read(path.join('src', relative));
  const lines = source.split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    if (/profiles(?:!|\s*\()/.test(line) && /select|sender:|receiver:|owner:|user:|friend:/.test(line)) {
      executableEmbeds.push(`src/${relative}:${index + 1}`);
    }
  });
}
assert(executableEmbeds.length === 0, `raw profiles embeds remain: ${executableEmbeds.join(', ')}`);

const peerFiles = [
  'src/components/MemberCardModal.tsx',
  'src/components/MentionsInbox.tsx',
  'src/components/OfficeAnalyticsPanel.tsx',
  'src/components/TraceViewer.tsx',
  'src/components/MissionHistoryPanel.tsx',
  'src/components/stories/CircleStoriesRail.web.tsx',
  'src/hooks/useKanbanData.ts',
  'src/lib/analytics.ts',
  'src/lib/circleChatThreads.ts',
  'src/lib/circleContextSnapshot.ts',
  'src/lib/goals.ts',
  'src/lib/governance.ts',
  'src/lib/momentumAlerts.ts',
  'src/lib/photonProof.ts',
  'src/screens/circles/tabs/ChallengesTab.tsx',
  'src/screens/circles/tabs/DigestTab.tsx',
  'src/screens/circles/tabs/MembersTab.tsx',
  'src/screens/circles/tabs/MissionsTab.tsx',
  'src/screens/circles/tabs/WarRoomTab.tsx',
  'src/screens/circles/tabs/chat/ChatThreadHeader.tsx',
  'src/screens/digest/DailyDigestScreen.tsx',
];
for (const file of peerFiles) {
  const source = read(file);
  assert(!source.includes(".from('profiles')") && !source.includes('.from("profiles")'), `${file} must not read raw peer profiles`);
  assert(source.includes('loadSafeCircleProfiles'), `${file} must hydrate through the Circle-bounded safe projection`);
}

for (const file of ['src/components/FloatingChat.tsx', 'src/lib/chatService.ts']) {
  const source = read(file);
  assert((source.match(/\.from\(['"]profiles['"]\)/g) || []).length === 1, `${file} may retain only its exact-self raw profile read`);
  assert(source.includes(".eq('id', user.id)"), `${file} raw profile read must bind the authenticated user`);
  assert(source.includes('loadSafeCircleProfiles'), `${file} peer names must use Circle-bounded hydration`);
}

const rooms = read('src/screens/circles/tabs/RoomsTab.tsx');
assert(rooms.includes(".select('user_id, role').eq('circle_id', circleId)"), 'Room permissions must filter exact Circle members');
assert(rooms.includes('loadSafeCircleProfiles({'), 'Room member pickers must use safe profile hydration');

const digest = read('src/screens/circles/tabs/DigestTab.tsx');
const dailyDigest = read('src/screens/digest/DailyDigestScreen.tsx');
assert(/from\('xp_events'\)[\s\S]{0,160}eq\('circle_id', circleId\)/.test(digest), 'Circle digest XP MVP must be Circle-scoped');
assert(/from\('xp_events'\)[\s\S]{0,160}eq\('circle_id', circleId\)/.test(dailyDigest), 'Daily digest XP MVP must be Circle-scoped');

const gamification = read('src/lib/gamification.ts');
assert(gamification.includes("if (!circleId) {\n      // There is no product authority for a public/global peer directory."), 'global leaderboard must fail closed without a Circle');
const integrations = read('src/lib/integrations.ts');
assert(/export async function searchUsers[\s\S]{0,400}return \[\];/.test(integrations), 'global user search must fail closed without Circle authority');
const crypto = read('src/lib/crypto.ts');
assert(crypto.includes('findSafeCircleProfileByUsername(circleId, username)'), 'username wallet lookup must require exact Circle hydration');

console.log(`safe profiles client boundary smoke passed (${assertions} assertions)`);
