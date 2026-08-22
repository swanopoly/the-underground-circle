/**
 * Source-level regression contract for every Circle dashboard first-load path.
 *
 * This intentionally avoids importing React Native or Supabase. It protects
 * the latency architecture that can otherwise regress through one eager
 * import, serial bootstrap await, or full-screen data gate.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');

const circleDetail = read('src/screens/circles/CircleDetailScreen.tsx');
const feed = read('src/screens/circles/tabs/FeedTab.tsx');
const kanban = read('src/hooks/useKanbanData.ts');
const backpack = read('src/screens/circles/tabs/BackpackTab.tsx');
const backpackData = read('src/hooks/useBackpackData.ts');
const backpackVisual = read('src/components/backpack2d/InteractiveBackpack2D.tsx');
const members = read('src/screens/circles/tabs/MembersTab.tsx');
const analyticsTab = read('src/screens/circles/tabs/AnalyticsTab.tsx');
const analyticsService = read('src/lib/analytics.ts');

assert.match(
  circleDetail,
  /const loadFeedTabModule = \(\) => import\('\.\/tabs\/FeedTab'\);[\s\S]*?const loadBackpackTabModule = \(\) => import\('\.\/tabs\/BackpackTab'\);/,
  'Feed and Backpack must retain reusable lazy module loaders',
);
assert.match(
  circleDetail,
  /const request = tabKey === 'FEED'[\s\S]*?loadFeedTabModule\(\)\.then\(module => module\.preloadFeedDashboardPanels\(\)\)/,
  'Feed intent and idle prefetch must warm its module and default visible panels',
);
assert.match(
  circleDetail,
  /DASHBOARD_MODULE_PREFETCHES = new Map<string, Promise<unknown>>\(\)/,
  'dashboard prefetch must deduplicate hover, focus, and idle requests',
);
assert.match(
  circleDetail,
  /DASHBOARD_IDLE_WARM_ORDER = Object\.freeze\(\[[\s\S]*?'FEED'[\s\S]*?'CHAT'[\s\S]*?'ROOMS'[\s\S]*?'OFFICE'[\s\S]*?'INTEGRATIONS'[\s\S]*?'VAULT'[\s\S]*?'MEMBERS'[\s\S]*?'ANALYTICS'[\s\S]*?'PROFILE'/,
  'idle warming must cover every visible general dashboard',
);
assert.match(
  circleDetail,
  /network\?\.saveData \|\| network\?\.effectiveType\?\.includes\('2g'\)/,
  'automatic dashboard warming must respect constrained and data-saver connections',
);
assert.match(
  circleDetail,
  /const nextTab = warmQueue\.shift\(\);[\s\S]*?prefetchDashboardModule\(nextTab,[\s\S]*?scheduleNextDashboard\(\);/,
  'dashboard chunks must warm sequentially instead of competing with the visible dashboard',
);
assert.match(
  circleDetail,
  /requestIdleCallback\(warmNextDashboard, \{ timeout: 3_500 \}\)/,
  'each queued dashboard chunk must wait for a browser idle turn',
);
assert.match(
  circleDetail,
  /onPressIn=\{onIntent\}[\s\S]*?onHoverIn=\{\(\) => \{ setHovered\(true\); onIntent\?\.\(\); \}\}[\s\S]*?onFocus=\{onIntent\}/,
  'touch, pointer, and keyboard intent must all warm the destination before navigation',
);
assert.match(
  circleDetail,
  /const isActive = activeTab === tabKey;[\s\S]*?useState\(isActive\)/,
  'a directly opened dashboard must request its lazy chunk in the first render',
);
for (const [tabKey, loaderName] of [
  ['CHAT', 'loadChatTabModule'],
  ['ROOMS', 'loadRoomsTabModule'],
  ['OFFICE', 'loadOfficeTabModule'],
  ['FEED', 'loadFeedTabModule'],
  ['BACKPACK', 'loadBackpackTabModule'],
  ['INTEGRATIONS', 'loadMarketplaceTabModule'],
  ['VAULT', 'loadVaultPanelModule'],
  ['MEMBERS', 'loadMembersTabModule'],
  ['ANALYTICS', 'loadAnalyticsTabModule'],
  ['WALLET', 'loadWalletTabModule'],
  ['PROFILE', 'loadProfileTabModule'],
] as const) {
  assert.match(
    circleDetail,
    new RegExp(`${tabKey}: ${loaderName}`),
    `${tabKey} must have a reusable intent-prefetch loader`,
  );
  assert.match(
    circleDetail,
    new RegExp(`React\\.lazy\\(${loaderName}\\)`),
    `${tabKey} must retain a split lazy entry chunk`,
  );
}
assert.match(
  circleDetail,
  /function prefetchDashboardModule\(tabKey: string, isOwner: boolean\)[\s\S]*?beginDashboardModulePrefetch\(tabKey, isOwner\)/,
  'all dashboard tab intents must share the safe module-prefetch path',
);
assert.match(
  circleDetail,
  /onTabIntent=\{\(tabKey\) => prefetchDashboardModule\(tabKey, isOwnerAccount === true\)\}/,
  'the tab bar must prefetch every allowed dashboard on pointer or keyboard intent',
);
assert.match(
  circleDetail,
  /const isOwnerAccount = authLoading[\s\S]*?: authUser\?\.email === OWNER_EMAIL/,
  'the owner gate must reuse AuthContext instead of starting another auth request',
);
assert.doesNotMatch(
  circleDetail,
  /safeGetUser\(|supabase\.auth\.getUser\(/,
  'the Circle shell must not add a second auth round trip for Backpack visibility',
);

assert.match(
  feed,
  /export function preloadFeedDashboardPanels\(\): Promise<void>[\s\S]*?Promise\.allSettled\(\[/,
  'Feed must expose a failure-isolated preload for its initially visible panels',
);
for (const component of [
  'CircleStoriesRail',
  'AgentTopBar',
  'OrchestraPanel',
  'GoalsPanel',
  'ActivityFeedPanel',
  'KanbanBoard',
] as const) {
  assert.match(feed, new RegExp(`const ${component} = React\\.lazy\\(`), `${component} must stay lazy`);
}
assert.match(
  feed,
  /function DeferredFeedPanel[\s\S]*?<React\.Suspense[\s\S]*?accessibilityRole="progressbar"/,
  'deferred Feed panels must have a local accessible loading boundary',
);

const heavyExecutionModules = [
  'agentInvocation',
  'agentRunSystem',
  'agentRuntimeSubject',
  'connectedAgentHandoffCore',
  'officeAgentSessionBinding',
  'openswanSessionRuntime',
  'taskExecutionRuntime',
  'taskCapabilityProfiles',
  'chatSessionProfile',
  'agentAutoConnectState',
  'gamification',
] as const;
for (const moduleName of heavyExecutionModules) {
  assert.doesNotMatch(
    kanban,
    new RegExp(`^import(?!\\s+type\\b)[^;]*from ['"]\\.\\.\\/lib\\/${moduleName}['"]`, 'm'),
    `${moduleName} must not enter the Feed bootstrap graph`,
  );
  assert.match(
    kanban,
    new RegExp(`import\\(['"]\\.\\.\\/lib\\/${moduleName}['"]\\)`),
    `${moduleName} must remain available on the user-triggered execution path`,
  );
}
assert.match(
  kanban,
  /const \{ session: authSession, user: authUser, loading: authLoading \} = useAuth\(\)/,
  'Feed data must reuse the already-resolved app auth state',
);
assert.doesNotMatch(
  kanban,
  /supabase\.auth\.(?:getUser|getSession|onAuthStateChange)/,
  'Feed bootstrap must not wait on a duplicate shared-client auth operation',
);
assert.match(
  kanban,
  /const exactReadClient = useMemo\([\s\S]*?getSupabaseClientForAccessToken\(authenticatedAccessToken\)[\s\S]*?const \{ data, error \} = await exactReadClient[\s\S]*?\.from\('tasks'\)/,
  'Feed bootstrap reads must use the captured bearer client instead of the shared auth client',
);
assert.match(
  kanban,
  /loadCircleOfficeAgents\(circleId, \{[\s\S]*?userId: requestedScope\.userId,[\s\S]*?accessToken: requestedScope\.accessToken/,
  'Feed roster hydration must carry the exact captured user and bearer scope',
);
const baseCommit = kanban.indexOf('setTasks(normalized.map(task => ({');
const loadingRelease = kanban.indexOf('setLoading(false);', baseCommit);
const enrichment = kanban.indexOf('const [tracked, imageHydrated] = await Promise.all([', baseCommit);
assert.ok(baseCommit >= 0, 'Feed must publish privacy-safe normalized base tasks');
assert.ok(
  loadingRelease > baseCommit && enrichment > loadingRelease,
  'Feed must release first-load UI before assignment, run, and image enrichment',
);
assert.match(
  kanban.slice(baseCommit, loadingRelease),
  /redactUnresolvedTaskImageValue\(task\.image_url\)/,
  'Feed base tasks must not expose unresolved private image references',
);
assert.match(
  kanban.slice(enrichment),
  /hydrateTaskTracking\(normalized\),[\s\S]*?hydrateTaskImageUrls\(normalized\),/,
  'Feed enrichment must hydrate tracking and private image URLs together',
);

assert.doesNotMatch(
  backpack,
  /if \(data\.loading\)\s*\{?\s*return <LoadingScreen/,
  'Backpack must not hide its entire overview behind the full data snapshot',
);
assert.match(
  backpack,
  /data\.loading \? \([\s\S]*?accessibilityRole="progressbar"[\s\S]*?Loading verified Backpack data/,
  'Backpack must show truthful in-place progress while its overview remains visible',
);
assert.match(
  backpack,
  /<InteractiveBackpack2D[\s\S]*?disabled=\{data\.loading\}/,
  'Backpack pockets must remain visible but unavailable until exact data is ready',
);
assert.match(
  backpackData,
  /const \{ session: authSession, user: authUser, loading: authLoading \} = useAuth\(\)/,
  'Backpack data must reuse the already-resolved app authority',
);
assert.doesNotMatch(
  backpackData,
  /supabase\.auth\.(?:getSession|getUser|onAuthStateChange)/,
  'Backpack bootstrap must not add a second shared-client auth wait or listener',
);
assert.match(
  backpackData,
  /const \[profileResult, tags, budgetResult, circleAgentsResult, allResponses, featuredResult\] = await Promise\.all\(\[[\s\S]*?loadSessionTags\([\s\S]*?loadOfficeUserPreferences\([\s\S]*?loadCircleOfficeAgents\([\s\S]*?loadTerminalResponseHistory\([\s\S]*?\.from\('featured_trades'\)/,
  'independent Backpack profile, settings, roster, history, and trade reads must start in one phase',
);
assert.match(
  backpackData,
  /const exactClient = getSupabaseClientForAccessToken\(accessToken\)[\s\S]*?\.from\('office_terminal_responses'\)/,
  'paged Backpack history must use the exact pinned-token client',
);
assert.match(
  backpackVisual,
  /disabled\?: boolean[\s\S]*?accessibilityState=\{\{ disabled, busy: disabled/,
  'the visual Backpack must expose its loading lock to assistive technology',
);
assert.match(
  backpackVisual,
  /disabled=\{disabled\}[\s\S]*?onPress=\{disabled \? undefined : onPress\}/,
  'a loading Backpack pocket must not dispatch a destination',
);

assert.match(
  members,
  /const \{ session, user, loading: authLoading \} = useAuth\(\)/,
  'Members must reuse the app-owned auth snapshot',
);
assert.doesNotMatch(
  members,
  /safeGetUser\(|supabase\.auth\.|import \{ supabase \}/,
  'Members first load must not wait on the mutable shared auth client',
);
assert.match(
  members,
  /getSupabaseClientForAccessToken\(accessToken\)[\s\S]*?const \{ data, error \} = await exactReadClient[\s\S]*?\.from\('circle_members'\)/,
  'Members must page through a client pinned to its captured bearer',
);

assert.match(
  analyticsService,
  /const MEMBER_ENGAGEMENT_CONCURRENCY = 6;/,
  'member engagement fan-out must stay bounded',
);
assert.match(
  analyticsService,
  /offset \+= MEMBER_ENGAGEMENT_CONCURRENCY[\s\S]*?Promise\.all\(batch\.map/,
  'Analytics must process member counts in concurrent batches instead of a serial N+1 loop',
);
assert.doesNotMatch(
  analyticsService,
  /for \(const member of members\) \{[\s\S]*?await Promise\.all/,
  'Analytics must not restore the one-member-at-a-time request waterfall',
);
assert.match(
  analyticsTab,
  /const ClaudeUsagePanel = React\.lazy\(\(\) => import\('\.\.\/\.\.\/\.\.\/components\/ClaudeUsagePanel'\)\)/,
  'below-fold Claude usage must remain outside the Analytics entry chunk',
);
assert.match(
  analyticsTab,
  /const memberRequest = getMemberEngagement\([\s\S]*?void Promise\.all\(\[[\s\S]*?getCircleAnalytics\([\s\S]*?getRealtimeStats\([\s\S]*?\]\)\.then/,
  'Analytics must start engagement concurrently while committing summary data independently',
);
assert.doesNotMatch(
  analyticsTab,
  /Promise\.all\(\[[\s\S]{0,500}?getCircleAnalytics\([\s\S]{0,500}?getRealtimeStats\([\s\S]{0,500}?getMemberEngagement\(/,
  'the Analytics first screen must not wait for the member engagement lane',
);
assert.match(
  analyticsTab,
  /generation !== requestGenerationRef\.current/,
  'staged Analytics responses must stay fenced across range and circle changes',
);

console.log('Dashboard load performance smoke passed');
