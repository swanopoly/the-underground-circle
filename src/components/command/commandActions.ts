import { Action } from 'kbar';

export function buildAppActions(navigate: (screen: string, params?: any) => void, circleId?: string): Action[] {
  const actions: Action[] = [];

  // Helper: navigate to a circle tab
  const goTab = (tab: string) => () => {
    if (circleId) {
      navigate('CircleDetail', { circleId, tab, _tabTs: Date.now() });
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  CIRCLE DASHBOARD — tabs inside CircleDetail (only when in a circle)
  // ═══════════════════════════════════════════════════════════════════════════
  if (circleId) {
    actions.push(
      { id: 'circle-chat',         name: 'Chat',         shortcut: ['g', 'h'], section: 'Circle Dashboard', perform: goTab('CHAT'),         keywords: 'chat messages conversation ai agent talk' },
      { id: 'circle-office',       name: 'Office',       shortcut: ['g', 'o'], section: 'Circle Dashboard', perform: goTab('OFFICE'),       keywords: 'office pixel agents desk floor customize theme' },
      { id: 'circle-rooms',        name: 'Rooms',        shortcut: ['g', 'r'], section: 'Circle Dashboard', perform: goTab('ROOMS'),        keywords: 'rooms workspace projects files github repo code' },
      { id: 'circle-backpack',     name: 'Backpack',     shortcut: ['g', 'b'], section: 'Circle Dashboard', perform: goTab('BACKPACK'),     keywords: 'backpack tools bench models llm cost performance' },
      { id: 'circle-feed',         name: 'Feed',         shortcut: ['g', 'f'], section: 'Circle Dashboard', perform: goTab('FEED'),         keywords: 'feed kanban tasks board todo work items' },
      { id: 'circle-wallet',       name: 'Wallet',       shortcut: ['g', 'w'], section: 'Circle Dashboard', perform: goTab('WALLET'),       keywords: 'wallet crypto ethereum solana tokens send receive' },
      { id: 'circle-integrations', name: 'Marketplace', shortcut: ['g', 'i'], section: 'Circle Dashboard', perform: goTab('INTEGRATIONS'), keywords: 'marketplace integrations github slack wordpress connect api webhook apps' },
      { id: 'circle-challenges',   name: 'Challenges',                         section: 'Circle Dashboard', perform: goTab('CHALLENGES'),   keywords: 'challenges goals compete leaderboard xp badges' },
      { id: 'circle-members',      name: 'Members',      shortcut: ['g', 'm'], section: 'Circle Dashboard', perform: goTab('MEMBERS'),      keywords: 'members team people circle invite online' },
      { id: 'circle-analytics',    name: 'Analytics',    shortcut: ['g', 'a'], section: 'Circle Dashboard', perform: goTab('ANALYTICS'),    keywords: 'analytics stats metrics usage tokens cost charts' },
      { id: 'circle-profile',      name: 'Profile',                            section: 'Circle Dashboard', perform: goTab('PROFILE'),      keywords: 'profile settings account badge rank xp level' },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CIRCLES — top-level circle management
  // ═══════════════════════════════════════════════════════════════════════════
  actions.push(
    { id: 'circles-list',   name: 'My Circles',      shortcut: ['g', 'c'], section: 'Circles',  perform: () => navigate('CirclesList'),  keywords: 'circles home dashboard list all' },
    { id: 'circles-create', name: 'Create Circle',                         section: 'Circles',  perform: () => navigate('CreateCircle'), keywords: 'create new circle team group start' },
    { id: 'circles-join',   name: 'Join Circle',                           section: 'Circles',  perform: () => navigate('JoinCircle'),   keywords: 'join circle invite code link team' },
  );
  if (circleId) {
    actions.push(
      { id: 'circles-settings', name: 'Circle Settings',                   section: 'Circles',  perform: () => navigate('CircleSettings', { circleId }), keywords: 'circle settings config name image type' },
      { id: 'circles-invites',  name: 'Manage Invites',                    section: 'Circles',  perform: () => navigate('InviteManage', { circleId }),   keywords: 'invites manage links share team' },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LEARN — Schools & AI Wiki
  // ═══════════════════════════════════════════════════════════════════════════
  actions.push(
    { id: 'learn-schools',  name: 'Schools',          section: 'Learn', perform: () => navigate('Schools'),  keywords: 'schools learn education courses lessons modules tracks' },
    { id: 'learn-wiki',     name: 'AI Wiki',          section: 'Learn', perform: () => navigate('Wiki'),     keywords: 'wiki articles knowledge ai agents reference glossary' },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  SOCIAL — Friends, Profile, Agents
  // ═══════════════════════════════════════════════════════════════════════════
  actions.push(
    { id: 'social-profile',  name: 'Profile',    shortcut: ['g', 'p'], section: 'Social', perform: () => navigate('Profile'), keywords: 'profile edit settings avatar username display name' },
    { id: 'social-friends',  name: 'Friends',                               section: 'Social', perform: () => navigate('Friends'),     keywords: 'friends dm messages social chat direct' },
    { id: 'social-agents',   name: 'Agents',                                section: 'Social', perform: () => navigate('Agents'),      keywords: 'agents manage bots ai pixel office configure' },
    { id: 'social-standalone-integrations', name: 'Marketplace Hub',        section: 'Social', perform: () => navigate('Integrations'), keywords: 'marketplace integrations hub connections api keys global apps' },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  ORGANIZATIONS — org management screens
  // ═══════════════════════════════════════════════════════════════════════════
  actions.push(
    { id: 'org-list',       name: 'Organizations',        section: 'Organizations', perform: () => navigate('OrgList'),    keywords: 'organizations teams enterprise company list' },
    { id: 'org-create',     name: 'Create Organization',  section: 'Organizations', perform: () => navigate('CreateOrg'),  keywords: 'create new organization team enterprise' },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  //  QUICK ACTIONS — shortcuts for common tasks (require circleId)
  // ═══════════════════════════════════════════════════════════════════════════
  if (circleId) {
    actions.push(
      { id: 'act-new-session',   name: 'New Chat Session',        section: 'Quick Actions', keywords: 'chat session new conversation start',      perform: goTab('CHAT') },
      { id: 'act-create-room',   name: 'Create New Room',         section: 'Quick Actions', keywords: 'room new create workspace project',        perform: goTab('ROOMS') },
      { id: 'act-create-task',   name: 'Create New Task',         section: 'Quick Actions', keywords: 'task new todo kanban item work',            perform: goTab('FEED') },
      { id: 'act-check-in',      name: 'Check In',                section: 'Quick Actions', keywords: 'check in daily streak standup update',      perform: goTab('CHAT') },
      { id: 'act-spawn-agent',   name: 'Spawn Agent',             section: 'Quick Actions', keywords: 'spawn create agent bot ai start launch',    perform: goTab('OFFICE') },
      { id: 'act-assign-agent',  name: 'Assign Agent to Task',    section: 'Quick Actions', keywords: 'assign agent task delegate work',           perform: goTab('OFFICE') },
      { id: 'act-view-analytics', name: 'View Analytics',         section: 'Quick Actions', keywords: 'analytics dashboard stats metrics overview', perform: goTab('ANALYTICS') },
      { id: 'act-manage-members', name: 'Manage Members',         section: 'Quick Actions', keywords: 'members invite remove role permissions',    perform: goTab('MEMBERS') },
      { id: 'act-connect-github', name: 'Connect GitHub',         section: 'Quick Actions', keywords: 'github connect repo webhook oauth',         perform: goTab('INTEGRATIONS') },
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SEARCH — jump to search/browse screens
  // ═══════════════════════════════════════════════════════════════════════════
  actions.push(
    { id: 'search-wiki',    name: 'Search AI Wiki...',    section: 'Search', keywords: 'wiki search article ai agent reference',         perform: () => navigate('Wiki') },
    { id: 'search-schools', name: 'Search Schools...',    section: 'Search', keywords: 'schools search lessons learn education courses',  perform: () => navigate('Schools') },
    { id: 'search-circles', name: 'Browse Circles...',    section: 'Search', keywords: 'circles browse find discover teams',              perform: () => navigate('CirclesList') },
    { id: 'search-friends', name: 'Find Friends...',      section: 'Search', keywords: 'friends search find people users',                perform: () => navigate('Friends') },
  );

  return actions;
}
