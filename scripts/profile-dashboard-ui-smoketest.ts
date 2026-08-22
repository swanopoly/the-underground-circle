/**
 * Source-level regression contract for the minimalist Circle Profile surface.
 *
 * The dashboard imports React Native and live Supabase modules, so this smoke
 * verifies stable structure, callback wiring, shared tokens, and exact Profile
 * tab authority without pretending to be a rendered browser test.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROFILE_DASHBOARD_TOKENS as PD } from '../src/components/profile/profileDashboardTheme';

const read = (path: string): string => readFileSync(path, 'utf8');

const profile = read('src/screens/profile/ProfileScreen.tsx');
const profileTab = read('src/screens/circles/tabs/ProfileTab.tsx');
const completedWork = read('src/components/CompletedWorkPanel.tsx');
const computerHistory = read('src/components/ComputerUseHistoryPanel.tsx');
const mentions = read('src/components/MentionsInbox.tsx');
const adaptiveWorkspace = read('src/components/profile/AdaptiveWorkspaceCard.tsx');
const chat = read('src/screens/circles/tabs/ChatTab.tsx');
const chatHeader = read('src/screens/circles/tabs/chat/ChatThreadHeader.tsx');

assert.equal(PD.canvas, '#0A0A0A', 'Profile uses the Chat canvas');
assert.equal(PD.header, '#050810', 'Profile uses the Chat header surface');
assert.equal(PD.border, '#1a1a28', 'Profile uses the Chat muted divider');
assert(chat.includes("backgroundColor: '#0A0A0A'"), 'Chat still owns the shared canvas reference');
assert(chatHeader.includes("backgroundColor: '#050810'"), 'Chat still owns the shared header reference');
assert(chatHeader.includes("borderBottomColor: '#1a1a28'"), 'Chat still owns the shared border reference');

for (const [label, source, ownsPanel] of [
  ['Profile screen', profile, true],
  ['Profile tab', profileTab, false],
  ['Completed work', completedWork, true],
  ['Computer history', computerHistory, true],
  ['Mentions', mentions, true],
  ['Adaptive workspace', adaptiveWorkspace, true],
] as const) {
  assert(source.includes('PROFILE_DASHBOARD_TOKENS'), `${label} consumes the shared Profile dashboard tokens`);
  assert(source.includes('PD.panel') || source.includes('PD.canvas'), `${label} uses a shared dashboard surface`);
  if (ownsPanel) assert(source.includes('PD.border'), `${label} uses a shared dashboard border`);
}

for (const testID of [
  'profile-dashboard',
  'profile-dashboard-header',
  'profile-summary',
  'profile-activity',
  'profile-achievements',
  'profile-connections',
  'profile-community',
  'profile-details',
]) {
  assert(profile.includes(`testID="${testID}"`), `Profile exposes stable ${testID} structure`);
}

assert(!profile.includes('uc-profile-hero-aura'), 'Profile has no animated aura presentation');
assert(!profile.includes('ensureHeroAuraStyle'), 'Profile no longer injects one-off dashboard CSS');
assert(!profile.includes("import Card from '../../components/Card'"), 'Profile does not mix the legacy hover-lift card language into the dashboard');
assert(!profile.includes("import Button from '../../components/Button'"), 'Profile does not mix the legacy pixel button language into the dashboard');
assert(!profile.includes('contentContainerStyle={styles.scrollContent}'), 'Profile does not create a second full-page vertical scroller');
assert(profileTab.includes('<ScrollView') && profileTab.includes('showsVerticalScrollIndicator={false}'), 'ProfileTab owns one calm dashboard scroll surface');
assert(profileTab.includes('<View style={styles.supplementalPanels}>'), 'supplemental panels share the same max-width alignment rail');

for (const route of ['EditProfile', 'Integrations', 'Agents', 'Friends']) {
  assert(profile.includes(`navigation.navigate('${route}')`), `Profile preserves the ${route} action`);
}
assert(profile.includes("secureSignOut({ scope: 'local', userId: profile?.id })"), 'Profile sign-out remains device-local');
assert(profile.includes("supabase.from('profiles').update({ bio: trimmed }).eq('id', profile.id)"), 'Profile keeps bio persistence');
assert(profile.includes("supabase.from('profiles').update({ theme_color: color }).eq('id', profile.id)"), 'Profile keeps theme persistence');
assert(profile.includes("setBioError('Bio could not be saved. Try again.')"), 'bio failure stays visible and retryable');
assert(profile.includes("setThemeError('Theme color could not be saved. Try again.')"), 'theme failure stays visible and retryable');
assert(profile.includes('source={{ uri: profile.avatar_url }}'), 'configured profile photos render instead of falling back to initials');
assert(profile.includes('accessibilityState={{ selected: themeColor === color, disabled: themeSaving }}'), 'theme choices expose selected and disabled state');
assert(profile.includes('accessibilityViewIsModal'), 'achievement details retain modal accessibility isolation');

assert(profileTab.includes('ComputerUseHistoryExactAuthority'), 'Profile keeps exact private browser-history authority');
assert(profileTab.includes('isExactAuthorityCurrent={isAuthorityCurrent}'), 'Profile keeps the authority-generation fence on browser history');
assert(profileTab.includes("new CustomEvent('uc:run-computer-use'"), 'browser history re-run still hands work to Chat');
assert(profileTab.includes("new CustomEvent('uc:switch-tab', { detail: { tab: 'CHAT' } })"), 'browser history re-run still opens Chat');
assert(completedWork.includes(".eq('status', 'done')"), 'Completed Work keeps its done-task query');
assert(computerHistory.includes('onRerun(row.task)'), 'Computer history keeps re-run actions');
assert(mentions.includes('mark_my_mentions_seen'), 'Mentions still marks opened rows seen');
assert(adaptiveWorkspace.includes('saveAdaptiveWorkspaceSettings(circleId, next)'), 'Adaptive Workspace keeps persistence');
assert(adaptiveWorkspace.includes('accessibilityRole="switch"'), 'Adaptive Workspace exposes its toggle as an accessible switch');
assert(adaptiveWorkspace.includes('accessibilityState={{ selected: active }}'), 'Adaptive Workspace exposes the selected pinned default');

console.log('profile-dashboard-ui smoketest: all assertions passed');
