import { storage } from './storage';
import { supabase } from './supabase';

export type WorkspaceTabKey = 'CHAT' | 'OFFICE' | 'FEED' | 'ROOMS' | 'INTEGRATIONS' | 'ANALYTICS' | 'MEMBERS' | 'CHALLENGES' | 'BACKPACK' | 'PROFILE';
export type FeedMobileMode = 'missions' | 'goals' | 'activity' | 'agents' | 'board' | 'ai-tools' | 'plan';
export type FeedLowerMode = 'activity' | 'agents' | 'ai-tools';
export type OfficeFocusMode = 'workspace' | 'runtime' | 'intelligence';

export interface CircleWorkspaceProfile {
  circleId: string;
  updatedAt: string;
  tabVisits: Partial<Record<WorkspaceTabKey, number>>;
  chat: {
    messagesSent: number;
    slashCommandsUsed: number;
    assignmentActions: number;
    pluginActions: number;
  };
  feed: {
    searchExpands: number;
    mobileTabVisits: Partial<Record<FeedMobileMode, number>>;
    desktopLowerTabVisits: Partial<Record<FeedLowerMode, number>>;
    marketplaceJumps: number;
  };
  office: {
    selectedAgents: number;
    workspaceActions: number;
    runtimeActions: number;
    intelligenceActions: number;
    terminalCommandOpens: number;
    terminalAutomationOpens: number;
  };
}

export interface AdaptiveWorkspaceSettings {
  enabled: boolean;
  pinLandingTab?: WorkspaceTabKey | null;
  pinFeedMobileTab?: FeedMobileMode | null;
  pinFeedLowerTab?: FeedLowerMode | null;
  pinChatDensity?: 'compact' | 'cozy' | null;
  pinOfficeTerminalTab?: 'commands' | 'automations' | null;
}

const PROFILE_PREFIX = '@workspace_adaptation_v1:';
const SETTINGS_PREFIX = '@workspace_adaptation_settings_v1:';

function defaultProfile(circleId: string): CircleWorkspaceProfile {
  return {
    circleId,
    updatedAt: new Date().toISOString(),
    tabVisits: {},
    chat: {
      messagesSent: 0,
      slashCommandsUsed: 0,
      assignmentActions: 0,
      pluginActions: 0,
    },
    feed: {
      searchExpands: 0,
      mobileTabVisits: {},
      desktopLowerTabVisits: {},
      marketplaceJumps: 0,
    },
    office: {
      selectedAgents: 0,
      workspaceActions: 0,
      runtimeActions: 0,
      intelligenceActions: 0,
      terminalCommandOpens: 0,
      terminalAutomationOpens: 0,
    },
  };
}

function profileKey(circleId: string) {
  return `${PROFILE_PREFIX}${circleId}`;
}

function settingsKey(circleId: string) {
  return `${SETTINGS_PREFIX}${circleId}`;
}

function bump<T extends string>(map: Partial<Record<T, number>>, key: T, amount = 1): Partial<Record<T, number>> {
  return { ...map, [key]: (map[key] || 0) + amount };
}

export async function loadCircleWorkspaceProfile(circleId: string): Promise<CircleWorkspaceProfile> {
  try {
    const raw = await storage.getItem(profileKey(circleId));
    if (!raw) return defaultProfile(circleId);
    return { ...defaultProfile(circleId), ...JSON.parse(raw) };
  } catch {
    return defaultProfile(circleId);
  }
}

export async function loadAdaptiveWorkspaceSettings(circleId: string): Promise<AdaptiveWorkspaceSettings> {
  try {
    const raw = await storage.getItem(settingsKey(circleId));
    const local = raw ? JSON.parse(raw) : {};
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return { enabled: true, ...local };
    const { data } = await supabase
      .from('profiles')
      .select('office_preferences')
      .eq('id', userId)
      .single();
    const remote = (data?.office_preferences as any)?.adaptiveWorkspace?.[circleId] || {};
    return {
      enabled: true,
      ...remote,
      ...local,
    };
  } catch {
    return { enabled: true };
  }
}

export async function saveAdaptiveWorkspaceSettings(circleId: string, settings: AdaptiveWorkspaceSettings): Promise<void> {
  try {
    await storage.setItem(settingsKey(circleId), JSON.stringify(settings));
  } catch {}
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const { data } = await supabase
      .from('profiles')
      .select('office_preferences')
      .eq('id', userId)
      .single();
    const current = (data?.office_preferences || {}) as Record<string, any>;
    const adaptiveWorkspace = {
      ...(current.adaptiveWorkspace || {}),
      [circleId]: settings,
    };
    await supabase
      .from('profiles')
      .update({
        office_preferences: {
          ...current,
          adaptiveWorkspace,
        },
      })
      .eq('id', userId);
  } catch {}
}

export async function saveCircleWorkspaceProfile(profile: CircleWorkspaceProfile): Promise<void> {
  try {
    await storage.setItem(profileKey(profile.circleId), JSON.stringify({
      ...profile,
      updatedAt: new Date().toISOString(),
    }));
  } catch {}
}

export async function updateCircleWorkspaceProfile(
  circleId: string,
  updater: (profile: CircleWorkspaceProfile) => CircleWorkspaceProfile,
): Promise<CircleWorkspaceProfile> {
  const current = await loadCircleWorkspaceProfile(circleId);
  const next = updater(current);
  await saveCircleWorkspaceProfile(next);
  return next;
}

export async function recordWorkspaceTabVisit(circleId: string, tab: WorkspaceTabKey): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    tabVisits: bump(profile.tabVisits, tab),
  }));
}

export async function recordChatActivity(
  circleId: string,
  kind: 'message' | 'slash' | 'assignment' | 'plugin',
): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    chat: {
      ...profile.chat,
      messagesSent: profile.chat.messagesSent + (kind === 'message' ? 1 : 0),
      slashCommandsUsed: profile.chat.slashCommandsUsed + (kind === 'slash' ? 1 : 0),
      assignmentActions: profile.chat.assignmentActions + (kind === 'assignment' ? 1 : 0),
      pluginActions: profile.chat.pluginActions + (kind === 'plugin' ? 1 : 0),
    },
  }));
}

export async function recordFeedActivity(
  circleId: string,
  kind: 'search_expand' | 'marketplace_jump' | 'mobile_tab' | 'desktop_lower_tab',
  value?: FeedMobileMode | FeedLowerMode,
): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    feed: {
      ...profile.feed,
      searchExpands: profile.feed.searchExpands + (kind === 'search_expand' ? 1 : 0),
      marketplaceJumps: profile.feed.marketplaceJumps + (kind === 'marketplace_jump' ? 1 : 0),
      mobileTabVisits: kind === 'mobile_tab' && value
        ? bump(profile.feed.mobileTabVisits, value as FeedMobileMode)
        : profile.feed.mobileTabVisits,
      desktopLowerTabVisits: kind === 'desktop_lower_tab' && value
        ? bump(profile.feed.desktopLowerTabVisits, value as FeedLowerMode)
        : profile.feed.desktopLowerTabVisits,
    },
  }));
}

export async function recordOfficeActivity(
  circleId: string,
  kind: 'select_agent' | 'workspace' | 'runtime' | 'intelligence' | 'terminal_commands' | 'terminal_automations',
): Promise<void> {
  await updateCircleWorkspaceProfile(circleId, profile => ({
    ...profile,
    office: {
      ...profile.office,
      selectedAgents: profile.office.selectedAgents + (kind === 'select_agent' ? 1 : 0),
      workspaceActions: profile.office.workspaceActions + (kind === 'workspace' ? 1 : 0),
      runtimeActions: profile.office.runtimeActions + (kind === 'runtime' ? 1 : 0),
      intelligenceActions: profile.office.intelligenceActions + (kind === 'intelligence' ? 1 : 0),
      terminalCommandOpens: profile.office.terminalCommandOpens + (kind === 'terminal_commands' ? 1 : 0),
      terminalAutomationOpens: profile.office.terminalAutomationOpens + (kind === 'terminal_automations' ? 1 : 0),
    },
  }));
}

function topKey<T extends string>(counts: Partial<Record<T, number>>, fallback: T): T {
  const ranked = Object.entries(counts).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0));
  return (ranked[0]?.[0] as T) || fallback;
}

export function getRecommendedLandingTab(profile: CircleWorkspaceProfile): WorkspaceTabKey {
  const weighted: Partial<Record<WorkspaceTabKey, number>> = { ...profile.tabVisits };
  weighted.CHAT = (weighted.CHAT || 0) + profile.chat.messagesSent * 0.6 + profile.chat.slashCommandsUsed * 0.3;
  weighted.FEED = (weighted.FEED || 0) + profile.feed.marketplaceJumps * 0.3 + profile.feed.searchExpands * 0.2;
  weighted.OFFICE = (weighted.OFFICE || 0) + profile.office.selectedAgents * 0.5 + profile.office.runtimeActions * 0.4;
  return topKey(weighted, 'OFFICE');
}

export function getAdaptiveFeedDefaults(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings) {
  if (settings?.enabled === false) {
    return {
      mobileTab: settings.pinFeedMobileTab || 'missions',
      desktopLowerTab: settings.pinFeedLowerTab || 'activity',
      searchExpanded: false,
    };
  }
  return {
    mobileTab: settings?.pinFeedMobileTab || topKey(profile.feed.mobileTabVisits, 'missions'),
    desktopLowerTab: settings?.pinFeedLowerTab || topKey(profile.feed.desktopLowerTabVisits, 'activity'),
    searchExpanded: profile.feed.searchExpands >= 4,
  };
}

export function getAdaptiveOfficeDefaults(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings) {
  const focus: OfficeFocusMode =
    profile.office.runtimeActions >= profile.office.workspaceActions &&
    profile.office.runtimeActions >= profile.office.intelligenceActions
      ? 'runtime'
      : profile.office.intelligenceActions > profile.office.workspaceActions
        ? 'intelligence'
        : 'workspace';

  return {
    focus,
    terminalInitialTab: settings?.pinOfficeTerminalTab || (profile.office.terminalAutomationOpens > profile.office.terminalCommandOpens ? 'automations' as const : 'commands' as const),
  };
}

export function getAdaptiveChatDefaults(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings) {
  return {
    messageDensity: settings?.pinChatDensity || (profile.chat.messagesSent > 40 || profile.chat.slashCommandsUsed > 10 ? 'compact' as const : 'cozy' as const),
  };
}

export function getAdaptiveLandingTab(profile: CircleWorkspaceProfile, settings?: AdaptiveWorkspaceSettings): WorkspaceTabKey {
  if (settings?.enabled === false) return settings?.pinLandingTab || 'OFFICE';
  return settings?.pinLandingTab || getRecommendedLandingTab(profile);
}

export function buildAdaptiveWorkspaceSummary(profile: CircleWorkspaceProfile): string[] {
  const topTab = getRecommendedLandingTab(profile);
  const feedDefaults = getAdaptiveFeedDefaults(profile);
  const officeDefaults = getAdaptiveOfficeDefaults(profile);
  const chatDefaults = getAdaptiveChatDefaults(profile);
  return [
    `Most-used landing tab: ${topTab}`,
    `Chat style trend: ${chatDefaults.messageDensity}`,
    `Feed default focus: ${feedDefaults.mobileTab} / ${feedDefaults.desktopLowerTab}`,
    `Office runtime default: ${officeDefaults.terminalInitialTab}`,
    `Chat messages sent: ${profile.chat.messagesSent}`,
    `Office runtime actions: ${profile.office.runtimeActions}`,
    `Feed marketplace jumps: ${profile.feed.marketplaceJumps}`,
  ];
}
