import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Image,
  useWindowDimensions, Platform, Linking, Modal, TextInput,
} from 'react-native';
import OfficeFloorView from './office/OfficeFloor';
import PixelAgent from './office/PixelAgent';
import AgentPanel from './office/AgentPanel';
import { resolveAgentPanelRuntimeConnectionId } from './office/AgentPanelTabs';
import { OfficeIntelligenceSection, OfficeRuntimeSection, OfficeWorkspaceSection } from './office/OfficeSections';
import { OFFICE_DESK_POSITIONS, OFFICE_FLOOR_GRID_SIZE, OFFICE_FLOOR_HEIGHT, OFFICE_FLOOR_WIDTH } from './office/officeFloorLayout';
import CustomizePanel, { TelegramConfig } from './office/CustomizePanel';
import McpPanel from './office/McpPanel';
import type { OfficeCommand } from './office/OfficeChat';
import {
  OfficeAgent,
  DEFAULT_AGENT,
  HUGGINGSWAN_AGENT,
  sessionsToAgents,
  getOfficeStatusColor,
  getOfficeStatusLabel,
  getOfficeStatusSortRank,
  isConnectedOfficeStatus,
  applyDurableOfficeAgentCost,
  findDurableOfficeAgentCost,
} from '../../../lib/officeAgents';
import {
  OFFICE_THEMES, AgentAppearance, FurnitureItem, FurnitureType, FURNITURE_CATALOG,
  OfficeFloor, DEFAULT_FLOORS, createDefaultFloor, OfficeTheme, UC_AGENT_APPEARANCE,
  generateRandomAppearance, OWNER_EMAIL, isInteractiveFurniture, getOfficeAddonDefinition,
} from '../../../lib/officeConfig';
import {
  commitOfficeEditorSnapshot,
  buildOfficeOAuthWidgetReset,
  createOfficeEditorHistory,
  getOfficeEditorHistoryAvailability,
  mergeOfficeAddonCatalogPreferences,
  mergeOfficeEditorFurnitureState,
  isOfficeServiceAsyncScopeCurrent,
  OFFICE_ADDON_PREFERENCES_STORAGE_KEY,
  parseOfficeAddonCatalogPreferences,
  planOfficeRoomKit,
  recordOfficeAddonRecentType,
  redoOfficeEditorHistory,
  serializeOfficeAddonCatalogPreferences,
  setOfficeAddonFavorite,
  undoOfficeEditorHistory,
  type OfficeAddonCatalogPreferences,
  type OfficeEditorHistory,
  type OfficeRoomKitId,
  type OfficeServiceAsyncScope,
} from '../../../lib/officeAddonExperienceCore';
import {
  constrainOfficeFurnitureGeometry,
  sanitizeOfficeText,
  validateOfficeLayout,
} from '../../../lib/officeValidation';
import {
  createOfficeLayoutLocalWriteQueue,
  officeLayoutLocalCacheKey,
  readOfficeLayoutLocalCacheEnvelope,
} from '../../../lib/officeLayoutLocalCache';
import {
  drainLatestOfficeLayoutSaveQueue,
  queueLatestOfficeLayoutSave,
  runOfficeLayoutRequestWithDeadline,
} from '../../../lib/officeLayoutSaveQueueCore';
import { createOfficePreferenceWriteQueue } from '../../../lib/officePreferenceWriteQueueCore';
import {
  acknowledgeOfficeAttention,
  deleteOfficeFloorPreset,
  listOfficeAttentionAcknowledgements,
  listOfficeFloorPresets,
  loadOfficeCircleSessionMemoryMode,
  loadOfficeLayoutState,
  loadOfficeUserPreferences,
  patchOfficeUserPreferences,
  saveOfficeFloorPreset,
  saveOfficeCircleSessionMemoryMode,
  saveOfficeLayoutState,
  verifyOfficeCircleMembership,
  type OfficeDashboardExactAuthority,
  type OfficeLayoutDocument,
  type OfficeLayoutSaveResult,
} from '../../../lib/officeDashboardPersistence';
import {
  deleteVerifiedLocalSecret,
  readVerifiedLocalSecret,
  writeVerifiedLocalSecret,
} from '../../../lib/localSecrets';
import { useAuth } from '../../../hooks/useAuth';
import {
  applyOfficeFloorPreset,
  reconcileAutomaticOfficeFloorAssignments,
  type OfficeFloorPresetRecord,
} from '../../../lib/officeFloorPresetCore';
import { getBridgeUrl, getBridgeEnvironment } from '../../../lib/bridgeEnvironment';
import { fetchBridgeAuthenticated } from '../../../lib/bridgeAuth';
import ConnectAllBridgesPanel, { isConnectPanelDismissed } from '../../../components/office/ConnectAllBridgesPanel';
import OfficeBridgeReadinessStrip from '../../../components/office/OfficeBridgeReadinessStrip';
import OfficeLaneHealthStrip from '../../../components/office/OfficeLaneHealthStrip';
import OfficeBridgeDiagPanel from '../../../components/office/OfficeBridgeDiagPanel';
import { SEED_EVENT_NAME, buildComposerSeedDetail } from '../../../lib/chatComposerSeedCore';
import { normalizeChatAgentFocusDraft } from '../../../lib/chatAgentTargets';
import { encodeEntityHandle } from '../../../lib/entityHandleCore';
import type { OfficeBridgeReadinessSnapshot as OfficeBridgeReadinessSnapshotModel } from '../../../lib/officeBridgeReadiness';
import { useCustomThemesExact, customThemeToOfficeTheme, CUSTOM_THEME_PREFIX, CustomThemeRecord } from '../../../services/customThemes';
import {
  enrichAgentsWithCache,
  enrichSessionsWithCache,
  takeSnapshot,
  loadSessionTags as loadCachedTags,
} from '../../../lib/sessionCache';
import {
  applyIdentityToAgent,
  agentIdentityExactStorageKey,
  getAgentIdentityByAgent,
  getAgentIdentityKey,
  loadAgentIdentitiesExact,
  recordAgentActivityExact,
  refreshAgentIdentitiesFromServerExact,
  renameAgentExact,
  restoreAllAgentsExact,
  updateAgentIdentityExact,
  type AgentIdentity,
  type AgentIdentityExactAuthority,
  type AgentIdentityExactSaveResult,
} from '../../../lib/agentIdentity';
import {
  verifyBot, getChat, TelegramPoller, TelegramMessage,
} from '../../../lib/telegramService';
import {
  OpenSwanConfig, OpenSwanPoller, OpenSwanSession, OpenSwanUpdate,
  getOpenSwanEndpointNotice, testConnection, listAgents, listCronJobs, supportsOpenSwanToolRpcEndpoint, CronJob,
} from '../../../lib/openswanService';
import {
  openOAuthPopup, checkOAuthStatus, disconnectOAuth, fetchCalendarEvents, fetchEmails,
  OfficeOAuthProvider, type OAuthConnectionStatus,
} from '../../../lib/oauthConnect';
import {
  AgentConnection, ProviderType, PROVIDER_META,
  autoDiscoverLocalAgents, probeEndpointHealth,
  loadOfficeConnectionsExact, saveOfficeConnectionsExact,
  type OfficeConnectionExactAuthority,
} from '../../../lib/connectionManager';
import { supportsOpenSwanRpc, testAgentBridgeConnection } from '../../../lib/agentBridgeSupport';
import { storage } from '../../../lib/storage';
import { loadTrendingContent } from '../../../lib/trendingContent';
import AgentQuickConnect from "../../../components/AgentQuickConnect";
import SuggestedTaskChips from "../../../components/SuggestedTaskChips";
import { getEmptyStateSuggestions, type EmptyStateSuggestionAction } from '../../../lib/emptyStateSuggestions';
import {
  SessionTag,
  addSessionTag,
  loadSessionTags,
  removeSessionTag,
  type OfficeSessionStorageScope,
} from '../../../lib/sessionTags';
import { BudgetConfig, calculateBudgetAlerts } from '../../../lib/budgetAlerts';
import BudgetAlertBanner from '../../../components/BudgetAlertBanner';
import {
  OfficeBuildingNowCard,
  OfficeTokensCard,
  OfficeAgentLiveOpsLines,
  OfficeAgentAccountabilityLine,
  OfficeBuildingBadge,
  officeBoardHasContent,
  officeTrackerHasContent,
} from '../../../components/office/OfficeOpsBoardCards';
// officeOpsBoard is a pure model module (zero runtime imports) — safe to
// import statically for render-time helpers; data fetching stays lazy (D6).
import {
  applySyntheticAgentStatusUpgrade,
  buildAgentLiveOps,
  buildOfficeAgentXp,
  buildOfficeDeskAccountabilityPlaque,
  deriveSyntheticAgentStatusFromRuns,
  formatAccountabilityCounts,
  HUGGINGSWAN_RUN_NAME_KEYS,
  OPENSWAN_RUN_NAME_KEYS,
} from '../../../lib/officeOpsBoard';
import type {
  OfficeAgentAccountability as OfficeAgentAccountabilityModel,
  OfficeBuildingBoard,
  OfficeRunNode,
  OfficeTokenTrackerCard as OfficeTokenTrackerCardModel,
} from '../../../lib/officeOpsBoard';
// Pure run↔agent attribution seam (extracted from this file; smoke-tested via
// `npm run smoke:office-run-lookup`).
import {
  buildOfficeAgentRunLookupKeys,
  buildOpsRunNodeLookupKeys,
  getOpsAccountabilityForAgent,
  getOpsRunNodesForAgent,
  pickFreshestRunFreshness,
  runFreshnessUpdatedAtMs,
} from '../../../lib/officeRunLookup';
import type { AgentRun } from '../../../lib/agentRunSystem';
import type { AgentPlanPersisted } from '../../../lib/agentPlanMode';
import {
  classifyRunFreshness,
  freshnessRank,
  type RunFreshness,
  type RunFreshnessResult,
} from '../../../lib/runFreshnessCore';
import type { ClaudeUsageSummary, ClaudeUsageByModel } from '../../../lib/claudeUsage';
import AgentActivityFeed from '../../../components/AgentActivityFeed';
import HitlApprovalBanner from '../../../components/HitlApprovalBanner';
import RunApprovalBanner from '../../../components/RunApprovalBanner';
import ChatAttentionStrip from '../../../components/ChatAttentionStrip';
import StandingGrantsPanel from '../../../components/StandingGrantsPanel';
import ComputerTaskSchedulesPanel from '../../../components/ComputerTaskSchedulesPanel';
import OfficeAgentPlanQueue, { officeAgentPlanQueueHasContent } from '../../../components/office/OfficeAgentPlanQueue';
import RunHistoryDrawer from '../../../components/chat/RunHistoryDrawer';
import {
  buildChatAttentionState,
  type ChatAttentionAction,
  type ChatAttentionItem,
} from '../../../lib/chatAttentionQueue';
import { isApprovalRowLive } from '../../../lib/approvalCardModelCore';
import { isRuntimeOwnedAgentApprovalActionType } from '../../../lib/agentApprovalsWorker';
import { showAlert, showConfirm } from '../../../lib/alert';
import type { ComputerTaskChecklistCard } from '../../../lib/computerTaskState';
import { useAgentApprovals, type AgentApprovalsExactAuthority } from '../../../services/hitlService';
import {
  CircleOfficeAgent,
  loadCircleOfficeAgents,
  publishAgentToCircle,
  subscribeToCircleOffice,
  PROVIDER_DISPLAY,
  createBlackSwanAgent,
  BLACKSWAN_AGENT_ID,
  hideAgentInOffice,
} from '../../../lib/circleOffice';
import {
  CHESS_INITIAL_BOARD, getChessLegalMoves, applyChessMove, isCheckmate, isStalemate, isInCheck,
  checkConnectFourWin, isConnectFourFull, connectFourAI,
} from '../../../lib/circleGames';
import {
  startHeartbeat,
  getLastSeen,
} from '../../../lib/agentHeartbeat';
import {
  joinPresenceChannel,
  extractLiveAgents,
  AgentLiveState,
  ConnectionStatus,
} from '../../../lib/agentPresence';
import {
  subscribeToTerminalCommandsExact,
  buildTerminalNativeCommandTargets,
  isTerminalCommandDispatchReceiptCurrent,
  updateAgentAnalytics,
  sendTerminalCommandExact,
  syncAgentTokenSnapshot,
  type SendCommandParams,
  type TerminalCommandDispatchReceipt,
  type TerminalExactAuthority,
  type TerminalNativeCommandTarget,
} from '../../../lib/officeTerminal';
import {
  invokeAndStream,
  invokeAllAgents,
  invokeSelectedAgents,
  type OfficeInvocationExactExecution,
} from '../../../lib/agentInvocation';
import {
  buildOfficeSessionSnapshot,
  readOfficeAgentSessionBindingsBatch,
  resolveOfficeAgentSessionBinding,
  type OfficeAgentSessionBindingRecord,
} from '../../../lib/officeAgentSessionBinding';
import {
  buildOpenSwanConnectionFingerprint,
  matchesOpenSwanConnectionFingerprint,
  type OpenSwanConnectionFingerprint,
} from '../../../lib/officeAgentSessionBindingCore';
import { buildAgentRuntimeSubject, isUuidLike, type AgentRuntimeSubjectMetadata } from '../../../lib/agentRuntimeSubject';
import { getActiveRuns } from '../../../lib/agentRunSystem';
import {
  buildOfficeRoster,
  isOfficeAgentOwnedByCurrentUser,
  resolveUniqueOfficeAgentById,
} from '../../../lib/officeRoster';
import { useUserApiKeysExact } from '../../../lib/llmProviders';
import { useOfficeSurfaceState } from './office/useOfficeSurfaceState';
import {
  getAdaptiveOfficeDefaults,
  loadAdaptiveWorkspaceSettingsExact,
  loadCircleWorkspaceProfileExact,
  recordOfficeActivityExact,
} from '../../../lib/workspaceAdaptation';
import {
  IdleBehaviorConfig,
  type IdleSchedulerAuthority,
  getDefaultIdleConfig,
  loadIdleConfigExact,
  normalizeIdleConfig,
  startIdleScheduler,
} from '../../../lib/idleBehaviors';
import { supabase } from '../../../lib/supabase';
import { subscribeWithReconnect } from '../../../lib/subscribeWithReconnect';
// Stylesheets live in their own module — see office/officeTabStyles.ts.
import {
  styles,
  pmStyles,
  coStyles,
  nftStyles,
  imgPickerStyles,
  stickyStyles,
  svcStyles,
  officeFilterChipStyles,
} from './office/officeTabStyles';
import CircleOfficePanel, { OfficeConnectBridgesSection } from './office/CircleOfficePanel';
import { fetchNFTs } from '../../../lib/crypto';

function isVirtualBlackSwanTarget(input: {
  targetAgentId?: string | null;
  targetAgentIds?: string[] | null;
  targetAgentName?: string | null;
}): boolean {
  if (input.targetAgentId === BLACKSWAN_AGENT_ID) return true;
  if (input.targetAgentIds?.includes(BLACKSWAN_AGENT_ID)) return true;
  if (input.targetAgentId || (input.targetAgentIds?.length || 0) > 0) return false;
  const targetName = String(input.targetAgentName || '').trim().toLowerCase();
  return targetName === 'blackswan'
    || targetName === '@blackswan'
    || targetName === 'swan'
    || targetName === '@swan';
}

type ServiceOAuthScope = Omit<OfficeServiceAsyncScope, 'serviceType' | 'provider'> & {
  serviceType: 'calendar_widget' | 'email_hub';
  provider: OfficeOAuthProvider;
  userId: string;
  accessToken: string;
  authorityGeneration: number;
};

type ServiceOAuthStatus = OAuthConnectionStatus | {
  state: 'checking';
  connected: false;
  email: '';
};

import { NFT } from '../../../types';
import AgentSetupWizard from '../../../components/AgentSetupWizard';
import ConnectAgentModal from '../../../components/ConnectAgentModal';
// AgentControlCard is now embedded inside AgentPanel (not used directly here)
import BadgeCelebration from '../../../components/BadgeCelebration';
import RewardsPanel from '../../../components/RewardsPanel';
import { useAllAgentPointsTracker, useUserRewards } from '../../../services/rewardService';
import { Badge, getNextBadge } from '../../../lib/badges';
import {
  RippleEffect, ConfettiEffect, RocketEffect, DiceEffect,
  PulseEffect, ShakeEffect, FireworksEffect,
} from './office/FloorEffects';
import RetroEmulator from '../../../components/RetroEmulator';
import ScrabbleGame from '../../../components/ScrabbleGame';
import PhoneMessenger from '../../../components/PhoneMessenger';
import PokerGame from '../../../components/poker/PokerGame';
import HuggingFaceExplorer from './office/HuggingFaceExplorer';
import HfToolRunner from './office/HfToolRunner';
import Marquee from '../../../components/web-effects/Marquee.web';
import XPEventFeed from '../../../components/rpg/XPEventFeed';
import StreakFlame from '../../../components/rpg/StreakFlame';
import GitHubWallFeed from '../../../components/office/GitHubWallFeed';
import SoundMixer from '../../../components/office/SoundMixer';
import SiteCredentialVaultPanel from '../../../components/vault/SiteCredentialVaultPanel';

const officePrivateStorageKey = (
  kind: 'agent_names' | 'appearances' | 'whiteboard_notes' | 'telegram_metadata',
  userId: string,
  circleId: string,
) => `@office_private_v2:${kind}:${userId}:${circleId}`;
const legacyOfficeTelegramStorageKey = (userId: string, circleId: string) => (
  `@office_private_v2:telegram:${userId}:${circleId}`
);
const LEGACY_OWNERLESS_TELEGRAM_STORAGE_KEY = '@office_telegram_config';
const OFFICE_TELEGRAM_SECRET_NAMESPACE = 'office_telegram_bot_token_v1';
const officeTelegramSecretId = (userId: string, circleId: string) => `${userId}:${circleId}`;
const officeAddonPreferencesStorageKey = (userId: string, circleId: string) => (
  `${OFFICE_ADDON_PREFERENCES_STORAGE_KEY}:${userId}:${circleId}`
);
const publishCtaDismissedKey = (userId: string, circleId: string) => (
  `@office_publish_cta_dismissed_v2:${userId}:${circleId}`
);

export interface AgentStats {
  agentCount: number;
  sessionCount: number;
  costToday: number;
  costWeek: number;
  tokens: number;
  tokensTotal: number;
  messagesTotal: number;
  messagesToday: number;
  inputTokens: number;
  outputTokens: number;
}

interface Props {
  circleId: string;
  accentColor: string;
  focusRunId?: string | null;
  focusRunRequestId?: number;
  onOpenAgentInChat?: (focus: string, draft?: string) => void;
  onAgentStats?: (stats: AgentStats) => void;
  onReady?: () => void;
}

type WhiteboardModule = typeof import('./office/Whiteboard');
type ServerRackModule = typeof import('./office/ServerRack');
type OfficeTerminalModule = typeof import('../../../components/OfficeTerminal');

function runWhenIdle(task: () => void, timeoutMs = 250): () => void {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function') {
    const id = (window as any).requestIdleCallback(task, { timeout: timeoutMs });
    return () => {
      try { (window as any).cancelIdleCallback?.(id); } catch {}
    };
  }
  const timeoutId = setTimeout(task, Math.min(timeoutMs, 32));
  return () => clearTimeout(timeoutId);
}

function isDocumentVisible(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

// Shared run-liveness (runFreshnessCore): one bucket/label every surface paints
// from a single agent_runs row, so Office's roster shows the SAME freshness as
// Feed instead of a static agent status that can't reveal a wedged run.
const FRESHNESS_DOT_COLORS: Record<RunFreshness, string> = {
  live: '#22c55e',
  recent: '#38bdf8',
  idle: '#f59e0b',
  stale: '#ef4444',
  done: '#606075',
  unknown: '#606075',
};

type OfficeExactAuthority = AgentIdentityExactAuthority & {
  circleId: string;
  generation: number;
};

function resolveAgentIdentityRefreshSnapshot(
  localIdentities: Map<string, AgentIdentity>,
  serverResult: Readonly<{
    serverVerified: boolean;
    identities: Map<string, AgentIdentity>;
  }>,
): Map<string, AgentIdentity> {
  // A successful exact server read is count-complete, so absence is durable
  // truth (including an empty snapshot). Local state is fallback-only when
  // that read fails and must never resurrect a server-deleted identity.
  return new Map(serverResult.serverVerified ? serverResult.identities : localIdentities);
}

function idleConfigAuthorityKey(authority: Readonly<{
  userId: string;
  circleId: string;
  authorityGeneration: number;
}>): string {
  return [
    encodeURIComponent(authority.userId),
    encodeURIComponent(authority.circleId),
    String(authority.authorityGeneration),
  ].join(':');
}

function mergeRemoteIdleConfigWithExactRunHistory(
  remoteValue: unknown,
  exactLocalConfig: IdleBehaviorConfig,
): IdleBehaviorConfig {
  const remoteConfig = normalizeIdleConfig(remoteValue);
  const localConfig = normalizeIdleConfig(exactLocalConfig);
  const behaviors = { ...remoteConfig.behaviors };
  for (const [behaviorId, remoteState] of Object.entries(remoteConfig.behaviors)) {
    const localState = localConfig.behaviors[behaviorId];
    if (!localState?.lastRanAt) continue;
    const remoteRanAt = remoteState.lastRanAt ? Date.parse(remoteState.lastRanAt) : Number.NaN;
    const localRanAt = Date.parse(localState.lastRanAt);
    if (
      !Number.isFinite(localRanAt)
      || localRanAt > Date.now() + 5 * 60_000
      || (Number.isFinite(remoteRanAt) && remoteRanAt >= localRanAt)
    ) continue;
    // Remote preferences own user choices. The exact local receipt may only
    // advance run history so a slower remote write cannot make work due again.
    behaviors[behaviorId] = { ...remoteState, lastRanAt: localState.lastRanAt };
  }
  return { ...remoteConfig, behaviors };
}

function toOfficeDashboardAuthority(authority: OfficeExactAuthority): OfficeDashboardExactAuthority {
  return {
    userId: authority.userId,
    circleId: authority.circleId,
    accessToken: authority.accessToken,
    authorityGeneration: authority.generation,
  };
}

export default function OfficeTab({
  circleId,
  accentColor,
  focusRunId = null,
  focusRunRequestId = 0,
  onOpenAgentInChat,
  onAgentStats,
  onReady,
}: Props) {
  const { session: authSession, user: authUser, loading: authLoading } = useAuth();
  const authIdentityMatches = Boolean(
    authUser?.id
    && authSession?.user.id
    && authUser.id === authSession.user.id,
  );
  const authReady = !authLoading && authIdentityMatches && Boolean(authSession?.access_token);
  const authAuthorityRef = useRef<OfficeExactAuthority | null>(null);
  const authAuthorityGenerationRef = useRef(0);
  const [authAuthorityRetry, setAuthAuthorityRetry] = useState(0);
  const [committedAuthAuthority, setCommittedAuthAuthority] = useState<OfficeExactAuthority | null>(null);
  const committedAuthScopeKey = authReady && authUser?.id && authSession?.access_token
    ? `${authUser.id}:${circleId}:${authSession.access_token}`
    : null;
  useEffect(() => {
    const generation = authAuthorityGenerationRef.current + 1;
    authAuthorityGenerationRef.current = generation;
    const nextAuthority: OfficeExactAuthority | null = authReady && authUser?.id && authSession?.access_token
      ? {
          userId: authUser.id,
          circleId,
          accessToken: authSession.access_token,
          generation,
        }
      : null;
    authAuthorityRef.current = nextAuthority;
    setCommittedAuthAuthority(nextAuthority);
    return () => {
      authAuthorityGenerationRef.current += 1;
      if (authAuthorityRef.current?.generation === generation) {
        authAuthorityRef.current = null;
      }
      setCommittedAuthAuthority((current) => (
        current?.generation === generation ? null : current
      ));
    };
  }, [authReady, authUser?.id, authSession?.access_token, authAuthorityRetry, circleId, committedAuthScopeKey]);
  const officeUserPreferencesAvailableRef = useRef(true);
  const officePreferenceWriteQueueRef = useRef<ReturnType<typeof createOfficePreferenceWriteQueue> | null>(null);
  if (!officePreferenceWriteQueueRef.current) {
    officePreferenceWriteQueueRef.current = createOfficePreferenceWriteQueue({
      getCurrentScope: () => authAuthorityRef.current,
      save: async (item, signal) => {
        const currentScope = authAuthorityRef.current;
        if (
          currentScope?.userId !== item.userId
          || currentScope?.circleId !== item.circleId
          || currentScope?.accessToken !== item.accessToken
          || currentScope?.generation !== item.authorityGeneration
        ) return { ok: false, retryable: false };
        const result = await patchOfficeUserPreferences(
          item.circleId,
          item.partial,
          { userId: item.userId, accessToken: item.accessToken },
          signal,
        );
        if (result.unavailable) officeUserPreferencesAvailableRef.current = false;
        return { ok: result.ok, retryable: result.retryable };
      },
    });
  }
  useEffect(() => () => {
    authAuthorityRef.current = null;
    officePreferenceWriteQueueRef.current?.dispose();
  }, []);
  const captureOfficeAuthority = useCallback((): OfficeExactAuthority | null => {
    const authority = authAuthorityRef.current;
    if (
      !authReady
      || !authority
      || authority.userId !== authUser?.id
      || authority.circleId !== circleId
      || authority.accessToken !== authSession?.access_token
    ) return null;
    return { ...authority };
  }, [authReady, authSession?.access_token, authUser?.id, circleId]);
  const isOfficeAuthorityCurrent = useCallback((authority: OfficeExactAuthority | null | undefined): boolean => {
    const current = authAuthorityRef.current;
    return Boolean(
      authReady
      && authority
      && current
      && authority.userId === authUser?.id
      && authority.circleId === circleId
      && authority.accessToken === authSession?.access_token
      && current.userId === authority.userId
      && current.circleId === authority.circleId
      && current.accessToken === authority.accessToken
      && current.generation === authority.generation
    );
  }, [authReady, authSession?.access_token, authUser?.id, circleId]);
  const officeInvocationLifecycleRef = useRef<{
    authority: OfficeExactAuthority;
    controller: AbortController;
  } | null>(null);
  useEffect(() => {
    officeInvocationLifecycleRef.current?.controller.abort();
    officeInvocationLifecycleRef.current = null;
    const authority = committedAuthAuthority;
    if (!authority || !isOfficeAuthorityCurrent(authority)) return undefined;
    const controller = new AbortController();
    officeInvocationLifecycleRef.current = { authority, controller };
    return () => {
      controller.abort();
      if (officeInvocationLifecycleRef.current?.controller === controller) {
        officeInvocationLifecycleRef.current = null;
      }
    };
  }, [committedAuthAuthority, isOfficeAuthorityCurrent]);
  const captureOfficeInvocationExecution = useCallback((
    authority: OfficeExactAuthority,
  ): OfficeInvocationExactExecution | null => {
    const lifecycle = officeInvocationLifecycleRef.current;
    if (
      !lifecycle
      || lifecycle.controller.signal.aborted
      || lifecycle.authority.userId !== authority.userId
      || lifecycle.authority.circleId !== authority.circleId
      || lifecycle.authority.accessToken !== authority.accessToken
      || lifecycle.authority.generation !== authority.generation
      || !isOfficeAuthorityCurrent(authority)
    ) return null;
    return {
      authority: { ...authority },
      isCurrent: isOfficeAuthorityCurrent,
      signal: lifecycle.controller.signal,
    };
  }, [isOfficeAuthorityCurrent]);
  const privateStorageKeys = useMemo(() => ({
    agentNames: officePrivateStorageKey('agent_names', authUser?.id || '', circleId),
    appearances: officePrivateStorageKey('appearances', authUser?.id || '', circleId),
    whiteboardNotes: officePrivateStorageKey('whiteboard_notes', authUser?.id || '', circleId),
    telegramMetadata: officePrivateStorageKey('telegram_metadata', authUser?.id || '', circleId),
  }), [authUser?.id, circleId]);
  const surfaceState = useOfficeSurfaceState();
  const [selectedAgent, setSelectedAgent] = useState<OfficeAgent | null>(null);
  // Filter chips that sit above the agents list. Persisted in localStorage so
  // a user who always works in "mine" doesn't have to re-toggle every visit.
  // The durable profile preference is the only persistence owner; the retired
  // global browser key could leak another account's selection on shared devices.
  type AgentFilterMode = 'all' | 'mine' | 'active' | 'bonded';
  const [agentFilterMode, setAgentFilterMode] = useState<AgentFilterMode>('all');
  const persistAgentFilter = useCallback((mode: AgentFilterMode) => {
    setAgentFilterMode(mode);
  }, []);
  const [celebrationBadge, setCelebrationBadge] = useState<Badge | null>(null);
  const [dancingAgentId, setDancingAgentId] = useState<string | null>(null);
  const userId = authUser?.id;
  const userEmail = authUser?.email ?? undefined;
  const [sessionMemoryMode, setSessionMemoryMode] = useState<'private' | 'shared'>('private');
  const [savingSessionMemoryMode, setSavingSessionMemoryMode] = useState(false);
  const approvalsAuthority = useMemo(() => {
    const authority = committedAuthAuthority;
    return authority
      ? {
          userId: authority.userId,
          circleId: authority.circleId,
          accessToken: authority.accessToken,
          authorityGeneration: authority.generation,
      }
      : null;
  }, [committedAuthAuthority]);
  const isApprovalAuthorityCurrent = useCallback((authority: AgentApprovalsExactAuthority): boolean => {
    const current = authAuthorityRef.current;
    return Boolean(
      current
      && current.userId === authority.userId
      && current.circleId === authority.circleId
      && current.accessToken === authority.accessToken
      && current.generation === authority.authorityGeneration
    );
  }, []);
  const pendingApprovals = useAgentApprovals(circleId, approvalsAuthority);
  // showControlCard removed — controls now embedded in AgentPanel

  // Circle-wide "Needs you" strip (plan §4a/§5b) — same chatAttentionQueue
  // owner as chat: summary line with counts + soonest-expiry countdown, rows
  // for expired approvals the live banner below cannot show, and runs stuck
  // in waiting_approval/paused with how long they have been blocked. Pending
  // approvals keep their approve/reject buttons in HitlApprovalBanner; the
  // status line still counts them so the summary stays truthful.
  const [dismissedOfficeAttentionIds, setDismissedOfficeAttentionIds] = useState<Set<string>>(new Set());
  const [, setOfficeAttentionTick] = useState(0);
  const [officeBlockedRuns, setOfficeBlockedRuns] = useState<AgentRun[]>([]);
  // open_run deep-link (plan §6b): blocked-run attention items open the same
  // run drawer chat uses instead of pointing at the board with an alert.
  const [showOfficeRunDetail, setShowOfficeRunDetail] = useState(false);
  const [officeRunDetailRefId, setOfficeRunDetailRefId] = useState<string | null>(null);
  const [officeRunDetailRequestId, setOfficeRunDetailRequestId] = useState(0);
  const openOfficeRunDetail = useCallback((runId: string | null | undefined) => {
    const nextRunId = String(runId || '').trim();
    if (!nextRunId) return;
    setOfficeRunDetailRefId(nextRunId);
    setOfficeRunDetailRequestId((current) => current + 1);
    setShowOfficeRunDetail(true);
  }, []);
  useEffect(() => {
    setShowOfficeRunDetail(false);
    setOfficeRunDetailRefId(null);
  }, [circleId]);
  useEffect(() => {
    let cancelled = false;
    setDismissedOfficeAttentionIds(new Set());
    const requestedAuthority = captureOfficeAuthority();
    if (!circleId || !userId || !requestedAuthority) return () => { cancelled = true; };
    const requestIsCurrent = () => !cancelled && isOfficeAuthorityCurrent(requestedAuthority);
    void listOfficeAttentionAcknowledgements(
      circleId,
      toOfficeDashboardAuthority(requestedAuthority),
      requestIsCurrent,
    ).then((ids) => {
      if (requestIsCurrent()) setDismissedOfficeAttentionIds(new Set(ids));
    });
    return () => { cancelled = true; };
  }, [captureOfficeAuthority, circleId, committedAuthScopeKey, isOfficeAuthorityCurrent, userId]);
  useEffect(() => {
    if (!focusRunId || focusRunRequestId <= 0) return;
    openOfficeRunDetail(focusRunId);
  }, [focusRunId, focusRunRequestId, openOfficeRunDetail]);
  useEffect(() => {
    if (!circleId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const runs = await getActiveRuns(circleId);
        if (!cancelled) {
          setOfficeBlockedRuns(runs.filter(
            (run) => {
              if (run.status !== 'waiting_approval' && run.status !== 'paused') return false;
              return classifyRunFreshness({
                status: run.status,
                updatedAtMs: runFreshnessUpdatedAtMs(run),
                nowMs: Date.now(),
              }).freshness !== 'stale';
            },
          ));
        }
      } catch { /* queue is a summary — a failed poll just shows stale data */ }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [circleId]);
  const officeAttention = buildChatAttentionState({
    approvals: pendingApprovals,
    blockedRuns: officeBlockedRuns,
  }, { dismissedIds: dismissedOfficeAttentionIds });
  const officeAttentionItems = officeAttention.items.filter((item) =>
    item.kind !== 'approval_pending'
      && item.kind !== 'approval_expiring',
  );
  const officeAttentionActive = officeAttention.statusLine !== null;
  useEffect(() => {
    if (!officeAttentionActive) return;
    const timer = setInterval(() => setOfficeAttentionTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [officeAttentionActive]);
  const handleOfficeAttentionAction = (item: ChatAttentionItem, action: ChatAttentionAction) => {
    if (action.kind === 'dismiss') {
      const requestedAuthority = captureOfficeAuthority();
      if (!requestedAuthority) return;
      const requestIsCurrent = () => isOfficeAuthorityCurrent(requestedAuthority);
      setDismissedOfficeAttentionIds((prev) => new Set(prev).add(item.id));
      void acknowledgeOfficeAttention(
        circleId,
        item.id,
        item.kind === 'run_blocked' ? item.refId : null,
        toOfficeDashboardAuthority(requestedAuthority),
        requestIsCurrent,
      )
        .then((result) => {
          if (requestIsCurrent() && !result.ok) {
            showAlert('Dismissal saved for this visit only', result.error || 'The Office server could not save this acknowledgement.');
          }
        });
      return;
    }
    if (action.kind === 'refile_approval') {
      // Office has no composer — re-asking happens where the request lives.
      showAlert(
        'Approval expired',
        'Resend the original request from the Chat tab and a fresh approval will be filed automatically.',
      );
      return;
    }
    if (action.kind === 'open_run') {
      // Attention items carry the exact run id — deep-link the drawer to it
      // instead of landing on the newest run.
      openOfficeRunDetail(item.refId);
    }
  };

  // D6: active computer-task card from the persisted record (main thread) —
  // Office is the away-from-chat surface, so a task paused on a question or
  // approval must be visible here too. Light poll; storage read is cheap.
  const [computerTaskCard, setComputerTaskCard] = useState<ComputerTaskChecklistCard | null>(null);
  useEffect(() => {
    const requestedAuthority = committedAuthAuthority;
    let cancelled = false;
    setComputerTaskCard(null);
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return undefined;
    const requestIsCurrent = () => (
      !cancelled && isOfficeAuthorityCurrent(requestedAuthority)
    );
    const load = async () => {
      try {
        const { loadComputerTaskStateExact, buildComputerTaskChecklistCard } = await import('../../../lib/computerTaskState');
        const result = await loadComputerTaskStateExact(
          requestedAuthority,
          null,
          requestIsCurrent,
        );
        if (!requestIsCurrent()) return;
        setComputerTaskCard(buildComputerTaskChecklistCard(result.ok ? result.record : null));
      } catch { /* dashboard extra — never break Office */ }
    };
    void load();
    const timer = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [committedAuthAuthority, isOfficeAuthorityCurrent]);

  // Saved Chat plans that are ready for Office/SwanBot/OpenSwan handoff. The
  // queue is informational here; execution stays in Chat until the typed Office
  // execution contract lands.
  const [officeAgentPlans, setOfficeAgentPlans] = useState<AgentPlanPersisted[]>([]);
  useEffect(() => {
    const requestedAuthority = committedAuthAuthority;
    let cancelled = false;
    setOfficeAgentPlans([]);
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return undefined;
    const requestIsCurrent = () => (
      !cancelled && isOfficeAuthorityCurrent(requestedAuthority)
    );
    const load = async () => {
      try {
        const { listAgentPlansExact } = await import('../../../lib/agentPlanPersistence');
        const result = await listAgentPlansExact(
          { circleId, limit: 20 },
          requestedAuthority,
          requestIsCurrent,
        );
        if (!requestIsCurrent()) return;
        setOfficeAgentPlans(result.ok ? result.plans : []);
      } catch { /* dashboard extra - never break Office */ }
    };
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    const handle = subscribeWithReconnect({
      channelName: `office-agent-plans:${requestedAuthority.userId}:${circleId}:${requestedAuthority.generation}`,
      setup: (channel) => channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'agent_plans',
        filter: `circle_id=eq.${circleId}`,
      }, () => { void load(); }),
      onCatchUp: () => { void load(); },
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      handle.unsubscribe();
    };
  }, [circleId, committedAuthAuthority, isOfficeAuthorityCurrent]);
  const visibleAgentPlans = useMemo(
    () => officeAgentPlans.filter((plan) => plan.status !== 'completed' && plan.status !== 'archived'),
    [officeAgentPlans],
  );
  const handleOpenAgentPlanChat = useCallback((plan: AgentPlanPersisted) => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    try {
      window.dispatchEvent(new CustomEvent('uc:switch-tab', {
        detail: {
          tab: 'CHAT',
          source: 'office_agent_plan_queue',
          agentPlanId: plan.id,
          agentPlanStatus: plan.status,
        },
      }));
    } catch { /* web-only dashboard convenience */ }
  }, []);

  // ── Office ops board (Building Now + Token Tracker) ──────────────────────
  // D6 pattern: lazy-import loader, bounded pure models, silent failures.
  // Runs poll every 15s plus a realtime subscription for instant updates;
  // Durable Claude usage (rolling 24h + 7d and 7d by-model) refreshes at most
  // every 60s. Local session totals are intentionally not billing periods.
  const [opsBoard, setOpsBoard] = useState<OfficeBuildingBoard | null>(null);
  const [opsTokenTracker, setOpsTokenTracker] = useState<OfficeTokenTrackerCardModel | null>(null);
  const [opsDurableSpendPeriods, setOpsDurableSpendPeriods] = useState<{
    today: number;
    week: number;
    month: number;
  } | null>(null);
  // O1 (P38): per-agent 24h accountability (last outcome + counts + cost),
  // keyed by the same lowercased agent-name seam as opsRunNodesByAgent.
  const [opsAccountability, setOpsAccountability] = useState<Map<string, OfficeAgentAccountabilityModel> | null>(null);
  // Shared run freshness (runFreshnessCore) keyed by run.id, rebuilt on every
  // 15s reload + realtime tick so the roster paints one liveness truth (the
  // same bucket/label Feed shows) instead of a static agent status.
  const [opsRunFreshness, setOpsRunFreshness] = useState<Map<string, RunFreshnessResult>>(() => new Map());
  // O5 (P39): main-view bridge readiness (warn/danger strip). Shares the
  // probe→snapshot owner with the Whiteboard (officeBridgeReadinessProbe).
  const [bridgeReadinessStrip, setBridgeReadinessStrip] = useState<OfficeBridgeReadinessSnapshotModel | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const { runOfficeBridgeReadinessProbe } = await import('../../../lib/officeBridgeReadinessProbe');
        const snapshot = await runOfficeBridgeReadinessProbe();
        if (!cancelled) setBridgeReadinessStrip(snapshot);
      } catch { /* dashboard extra — never break Office */ }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  // Durable running cost still feeds the Office whiteboard/reporting surfaces.
  // Its saved per-circle baseline is retained for compatibility, but the
  // header trip meter and reset controls are intentionally not rendered.
  const [runningCost, setRunningCost] = useState<{ total: number; sinceIso: string | null } | null>(null);
  const runningCostBaselineRef = useRef<string | null>(null);
  const runningCostBaselineMapRef = useRef<Record<string, string>>({});
  const runningCostSeqRef = useRef(0);
  // Seq-guarded so a slow response can never land on a newer circle/baseline.
  // Strict read: on failure keep the last known value; the 60s usage tick
  // retries, so a transient error never paints a convincing $0.
  const refreshRunningCost = useCallback(async () => {
    const seq = runningCostSeqRef.current;
    try {
      const { getClaudeUsageCostSinceStrict } = await import('../../../lib/claudeUsage');
      const total = await getClaudeUsageCostSinceStrict(circleId, runningCostBaselineRef.current);
      if (seq !== runningCostSeqRef.current) return;
      setRunningCost({ total, sinceIso: runningCostBaselineRef.current });
    } catch { /* dashboard extra — never break Office */ }
  }, [circleId]);
  const opsLiveRunsRef = useRef<AgentRun[]>([]);
  const opsUsageCacheRef = useRef<{
    todaySummary?: ClaudeUsageSummary;
    weekSummary?: ClaudeUsageSummary;
    monthSummary?: ClaudeUsageSummary;
    byModel?: ClaudeUsageByModel[];
    fetchedAtMs: number;
  }>({ fetchedAtMs: 0 });

  useEffect(() => {
    let cancelled = false;
    let unsubscribeRuns: (() => void) | null = null;
    let usageRetryTimer: ReturnType<typeof setTimeout> | null = null;
    // Reset per-circle so a circle switch can't show stale spend/runs.
    opsLiveRunsRef.current = [];
    opsUsageCacheRef.current = { fetchedAtMs: 0 };
    runningCostSeqRef.current += 1;
    setRunningCost(null);
    runningCostBaselineRef.current = runningCostBaselineMapRef.current[circleId] || null;
    setOpsTokenTracker(null);
    setOpsDurableSpendPeriods(null);
    setOpsRunFreshness(new Map());

    const rebuildTracker = async () => {
      try {
        const { buildOfficeTokenTracker } = await import('../../../lib/officeOpsBoard');
        if (cancelled) return;
        setOpsTokenTracker(buildOfficeTokenTracker({
          summary: opsUsageCacheRef.current.weekSummary,
          byModel: opsUsageCacheRef.current.byModel,
          liveRuns: opsLiveRunsRef.current,
          periodCosts: {
            today: opsUsageCacheRef.current.todaySummary?.total_cost,
            week: opsUsageCacheRef.current.weekSummary?.total_cost,
          },
          nowMs: Date.now(),
        }));
      } catch { /* dashboard extra — never break Office */ }
    };

    const reloadRuns = async () => {
      try {
        const [{ listCircleLiveRuns }, { buildOfficeBuildingBoard, buildOfficeAgentAccountabilityIndex }] = await Promise.all([
          import('../../../lib/agentRunSystem'),
          import('../../../lib/officeOpsBoard'),
        ]);
        // 24h finished window (O1 accountability). The building board
        // self-filters recentlyFinished to its 10-minute window, so widening
        // the fetch only feeds the per-agent accountability index.
        const runs = await listCircleLiveRuns(circleId, { recentFinishedMs: 24 * 60 * 60 * 1000, limit: 200 });
        if (cancelled) return;
        opsLiveRunsRef.current = runs;
        setOpsBoard(buildOfficeBuildingBoard(runs, { nowMs: Date.now() }));
        setOpsAccountability(buildOfficeAgentAccountabilityIndex(runs, { nowMs: Date.now() }));
        // One shared freshness read for every live/blocked run row (row 4-5):
        // classify from the single agent_runs row so the roster paints the same
        // bucket/label Feed does. Display-only — the board/poll are untouched.
        const freshnessNowMs = Date.now();
        const runFreshnessById = new Map<string, RunFreshnessResult>();
        for (const run of runs) {
          runFreshnessById.set(run.id, classifyRunFreshness({
            status: run.status,
            updatedAtMs: runFreshnessUpdatedAtMs(run),
            nowMs: freshnessNowMs,
          }));
        }
        setOpsRunFreshness(runFreshnessById);
        void rebuildTracker(); // live-burn line tracks the fresh runs
      } catch { /* dashboard extra — never break Office */ }
    };

    const reloadUsage = async () => {
      // Cache: refresh Claude usage at most every 60s even if callers race.
      if (Date.now() - opsUsageCacheRef.current.fetchedAtMs < 60_000) return;
      opsUsageCacheRef.current.fetchedAtMs = Date.now(); // claim slot before await
      try {
        const { getClaudeUsageSummaryStrict, getClaudeUsageByModelStrict } = await import('../../../lib/claudeUsage');
        const [todaySummary, weekSummary, monthSummary, byModel] = await Promise.all([
          getClaudeUsageSummaryStrict(circleId, 1),
          getClaudeUsageSummaryStrict(circleId, 7),
          getClaudeUsageSummaryStrict(circleId, 30),
          getClaudeUsageByModelStrict(circleId, 7),
        ]);
        if (cancelled) return;
        opsUsageCacheRef.current = { todaySummary, weekSummary, monthSummary, byModel, fetchedAtMs: Date.now() };
        void refreshRunningCost();
        setOpsDurableSpendPeriods({
          today: Math.max(0, todaySummary.total_cost),
          week: Math.max(0, weekSummary.total_cost),
          month: Math.max(0, monthSummary.total_cost),
        });
        void rebuildTracker();
      } catch {
        // Retain the last known server snapshot. A transient auth/network race
        // during login must not replace real spend with a convincing $0.
        opsUsageCacheRef.current = { ...opsUsageCacheRef.current, fetchedAtMs: 0 };
        if (!cancelled && !usageRetryTimer) {
          usageRetryTimer = setTimeout(() => {
            usageRetryTimer = null;
            void reloadUsage();
          }, 5_000);
        }
      }
    };

    void reloadRuns();
    void reloadUsage();
    const runsTimer = setInterval(() => { void reloadRuns(); }, 15_000);
    const usageTimer = setInterval(() => { void reloadUsage(); }, 60_000);

    // Realtime: refetch on agent_runs INSERT/UPDATE (debounced in the lib).
    (async () => {
      try {
        const { subscribeToCircleRuns } = await import('../../../lib/agentRunSystem');
        if (cancelled) return;
        const unsub = subscribeToCircleRuns(circleId, () => { void reloadRuns(); });
        if (cancelled) { unsub(); return; } // raced with cleanup
        unsubscribeRuns = unsub;
      } catch { /* dashboard extra — never break Office */ }
    })();

    return () => {
      cancelled = true;
      clearInterval(runsTimer);
      clearInterval(usageTimer);
      if (usageRetryTimer) clearTimeout(usageRetryTimer);
      try { unsubscribeRuns?.(); } catch {}
      unsubscribeRuns = null;
    };
  }, [circleId]);

  // Map building run nodes to roster agents by both display name and canonical
  // subject identity. Display-name matching remains the fallback; subject keys
  // let Office attach runs written as `agentSubjectKey` / DB id / session alias.
  const opsRunNodesByAgent = useMemo(() => {
    const map = new Map<string, OfficeRunNode[]>();
    const visit = (node: OfficeRunNode) => {
      for (const key of buildOpsRunNodeLookupKeys(node)) {
        const list = map.get(key);
        if (list) list.push(node); else map.set(key, [node]);
      }
      node.children.forEach(visit);
    };
    (opsBoard?.building ?? []).forEach(visit);
    return map;
  }, [opsBoard]);

  // Read-only local diagnostics through the Claude bridge allowlist.
  const handleRunCommand = React.useCallback(async (cmd: string) => {
    if (!selectedAgent) return { ok: false, stdout: '', stderr: 'No agent selected' };

    // Determine bridge URL based on provider type
    const bridgePorts: Record<string, number> = {
      'claude-code': 7778, 'codex': 7779, 'gemini': 7780, 'cursor': 7781,
    };
    const providerType = selectedAgent.providerType || '';
    const port = bridgePorts[providerType];
    if (!port) return { ok: false, stdout: '', stderr: 'No bridge for this provider' };
    if (providerType !== 'claude-code') {
      return { ok: false, stdout: '', stderr: 'Read-only diagnostics are currently available through the Claude bridge only.' };
    }
    const bridgeUrl = getBridgeUrl(port);
    if (!bridgeUrl) {
      return {
        ok: false,
        stdout: '',
        stderr: 'Agent bridges are only reachable from the local dev machine. Run `npm run dev` or set EXPO_PUBLIC_BRIDGE_HOST to a public bridge URL.',
      };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetchBridgeAuthenticated(`${bridgeUrl}/diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      return { ok: data.ok, stdout: data.stdout || '', stderr: data.stderr || '' };
    } catch (e: any) {
      return { ok: false, stdout: '', stderr: e.message || 'Bridge not reachable' };
    }
  }, [selectedAgent]);

  // Disconnect handler — stops poller and marks agent offline
  const handleDisconnectAgent = React.useCallback(() => {
    if (!selectedAgent) return;
    setSelectedAgent(null);
  }, [selectedAgent]);

  // Load custom themes from Supabase
  const { themes: customThemeRecords, refresh: refreshCustomThemes } = useCustomThemesExact(
    committedAuthAuthority,
    isOfficeAuthorityCurrent,
  );
  const customThemeLookup = React.useMemo(() => {
    const map: Record<string, OfficeTheme> = {};
    for (const rec of customThemeRecords) {
      const resolved = customThemeToOfficeTheme(rec);
      map[resolved.id] = resolved;
    }
    return map;
  }, [customThemeRecords]);

  const resolveTheme = useCallback((themeId: string): OfficeTheme => {
    return OFFICE_THEMES[themeId] || customThemeLookup[themeId] || OFFICE_THEMES.underground;
  }, [customThemeLookup]);

  // Pre-load trending content for thought bubbles (HN + X trends, 12h cache)
  useEffect(() => {
    loadTrendingContent().catch(() => {});
  }, []);

  const [appearances, setAppearances] = useState<Record<string, AgentAppearance>>({});
  const appearancesLoadedRef = useRef(false);
  const prefsLoadedRef = useRef(false);
  // Flipped true once budget/idle have been loaded from local + server,
  // so the save useEffect doesn't fire on the initial load.
  const budgetLoadedRef = useRef(false);
  const idleLoadedRef = useRef(false);
  const [idleConfigReadyAuthorityKey, setIdleConfigReadyAuthorityKey] = useState<string | null>(null);
  const remoteBudgetAppliedRef = useRef(false);
  const remoteIdleAppliedRef = useRef(false);
  const [activeCatalogCat, setActiveCatalogCat] = useState<string>('connected');
  const catalogScrollRef = useRef<ScrollView>(null);
  const [whiteboardNotes, setWhiteboardNotes] = useState<string[]>([]);
  const [chatMinimized, setChatMinimized] = useState(false);
  const [statusHistory, setStatusHistory] = useState<Array<OfficeAgent[]>>([]);
  const [enrichedAgents, setEnrichedAgents] = useState<OfficeAgent[]>([]);
  const [agentIdentities, setAgentIdentities] = useState<Map<string, AgentIdentity>>(new Map());
  const agentIdentityRefreshGenerationRef = useRef(0);
  const enrichedAgentsRef = useRef<OfficeAgent[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const viewMode = 'office'; // Simplified — analytics dashboards moved to Backpack tab
  const [sessionTags, setSessionTags] = useState<Map<string, SessionTag[]>>(new Map());
  const sessionTagsRef = useRef<Map<string, SessionTag[]>>(new Map());
  const [budgetConfig, setBudgetConfig] = useState<BudgetConfig>({ enabled: false });
  const [idleConfig, setIdleConfig] = useState<IdleBehaviorConfig>(getDefaultIdleConfig());
  const idleConfigRef = useRef<IdleBehaviorConfig>(getDefaultIdleConfig());

  // Keep refs in sync with state for use in intervals/callbacks
  useEffect(() => { enrichedAgentsRef.current = enrichedAgents; }, [enrichedAgents]);
  useEffect(() => { sessionTagsRef.current = sessionTags; }, [sessionTags]);
  const { keys: providerKeys, refresh: refreshProviderKeys } = useUserApiKeysExact(
    committedAuthAuthority,
    isOfficeAuthorityCurrent,
  );
  const [budgetAlertsDismissed, setBudgetAlertsDismissed] = useState(false);
  const [actionResult, setActionResult] = useState<string>('');
  const [showActionResult, setShowActionResult] = useState(false);
  const [enrichedSessions, setEnrichedSessions] = useState<OpenSwanSession[]>([]);
  const enrichedSessionSignatureRef = useRef('');
  const {
    showCustomize, setShowCustomize,
    showMcpHub, setShowMcpHub,
    showRewards, setShowRewards,
    showSetupWizard, setShowSetupWizard,
    showConnectAgent, setShowConnectAgent,
    showGitHubFeed, setShowGitHubFeed,
    showSoundMixer, setShowSoundMixer,
    showVault, setShowVault,
    showPublishModal, setShowPublishModal,
    editMode, setEditMode,
    placingType, setPlacingType,
    selectedFurnitureId, setSelectedFurnitureId,
    terminalSize, setTerminalSize,
    terminalInitialTab, setTerminalInitialTab,
    terminalInput, setTerminalInput,
    terminalTargetId, setTerminalTargetId,
    terminalTargetName, setTerminalTargetName,
    terminalModel, setTerminalModel,
    terminalTargetIds, setTerminalTargetIds,
    nftPickerVisible, setNftPickerVisible,
    stickyEditorVisible, setStickyEditorVisible,
    emulatorVisible, setEmulatorVisible,
    scrabbleVisible, setScrabbleVisible,
    pokerVisible, setPokerVisible,
    phoneVisible, setPhoneVisible,
    hfExplorerVisible, setHfExplorerVisible,
    hfRunnerVisible, setHfRunnerVisible,
    serviceModalVisible, setServiceModalVisible,
  } = surfaceState;

  // ─── Multi-floor state ──────────────────────────────
  const [floors, setFloors] = useState<OfficeFloor[]>(DEFAULT_FLOORS);
  const floorsRef = useRef<OfficeFloor[]>(DEFAULT_FLOORS);
  // Editor history stays local and bounded. Persistence continues through the
  // canonical floor layout path; the history only restores valid snapshots.
  const officeEditorHistoriesRef = useRef<Partial<Record<string, OfficeEditorHistory>>>({});
  const officeEditorItemStateRef = useRef<Partial<Record<string, Record<string, FurnitureItem>>>>({});
  useEffect(() => {
    floorsRef.current = floors;
    const liveFloorIds = new Set(floors.map((floor) => floor.id));
    for (const floorId of Object.keys(officeEditorItemStateRef.current)) {
      if (!liveFloorIds.has(floorId)) delete officeEditorItemStateRef.current[floorId];
    }
    for (const floorId of Object.keys(officeEditorHistoriesRef.current)) {
      if (!liveFloorIds.has(floorId)) delete officeEditorHistoriesRef.current[floorId];
    }
    for (const floor of floors) {
      const retained = { ...(officeEditorItemStateRef.current[floor.id] || {}) };
      for (const item of floor.furniture) retained[item.id] = item;

      // Keep only live items and bounded history tombstones. This preserves
      // configuration across Undo -> Redo without becoming an unbounded cache.
      const liveItemIds = floor.furniture.map((item) => item.id);
      const liveItemIdSet = new Set(liveItemIds);
      const historicalIds = new Set<string>();
      const history = officeEditorHistoriesRef.current[floor.id];
      if (history) {
        for (const entry of [...history.past, history.present, ...history.future]) {
          for (const item of entry.floor.furniture) {
            if (!liveItemIdSet.has(item.id)) historicalIds.add(item.id);
          }
        }
      }
      const retainedIds = [
        ...liveItemIds,
        ...Array.from(historicalIds).slice(-Math.max(0, 200 - liveItemIds.length)),
      ];
      officeEditorItemStateRef.current[floor.id] = Object.fromEntries(
        retainedIds.flatMap((id) => retained[id] ? [[id, retained[id]]] : []),
      );
    }
  }, [floors]);
  const [officeEditorHistoryRevision, setOfficeEditorHistoryRevision] = useState(0);
  const currentUserId = authReady ? authUser?.id || '' : '';
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const floorLayoutScope = currentUserId ? `${currentUserId}:${circleId}` : null;
  const officeSessionStorageScope = useMemo<OfficeSessionStorageScope | null>(() => (
    currentUserId ? { userId: currentUserId, circleId } : null
  ), [circleId, currentUserId]);
  const [officeAddonPreferences, setOfficeAddonPreferences] = useState<OfficeAddonCatalogPreferences>(() =>
    parseOfficeAddonCatalogPreferences(null));
  const [officeAddonPreferencesLoadedScope, setOfficeAddonPreferencesLoadedScope] = useState<string | null>(null);
  const officeAddonPreferencesMutatedForScopeRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const scope = currentUserId ? `${currentUserId}:${circleId}` : null;
    officeAddonPreferencesMutatedForScopeRef.current = null;
    setOfficeAddonPreferencesLoadedScope(null);
    setOfficeAddonPreferences(parseOfficeAddonCatalogPreferences(null));
    if (!scope) return () => { cancelled = true; };
    storage.getItem(officeAddonPreferencesStorageKey(currentUserId, circleId)).then((raw) => {
      if (cancelled) return;
      const persisted = parseOfficeAddonCatalogPreferences(raw);
      setOfficeAddonPreferences((current) => (
        officeAddonPreferencesMutatedForScopeRef.current === scope
          ? mergeOfficeAddonCatalogPreferences(persisted, current)
          : persisted
      ));
      setOfficeAddonPreferencesLoadedScope(scope);
    }).catch(() => {
      if (cancelled) return;
      setOfficeAddonPreferencesLoadedScope(scope);
    });
    return () => { cancelled = true; };
  }, [circleId, currentUserId]);
  useEffect(() => {
    const scope = currentUserId ? `${currentUserId}:${circleId}` : null;
    if (!scope || officeAddonPreferencesLoadedScope !== scope) return;
    storage.setItem(
      officeAddonPreferencesStorageKey(currentUserId, circleId),
      serializeOfficeAddonCatalogPreferences(officeAddonPreferences),
    ).catch(() => {});
  }, [circleId, currentUserId, officeAddonPreferences, officeAddonPreferencesLoadedScope]);
  const [activeScrabbleItemId, setActiveScrabbleItemId] = useState<string | null>(null);
  const [activePokerItemId, setActivePokerItemId] = useState<string | null>(null);
  const [activePhoneItemId, setActivePhoneItemId] = useState<string | null>(null);
  const [currentFloorId, setCurrentFloorId] = useState<string>('floor_1');
  const currentFloorIdRef = useRef(currentFloorId);
  currentFloorIdRef.current = currentFloorId;
  const officeFloorIdSequenceRef = useRef(0);
  const [floorLayoutSaveState, setFloorLayoutSaveState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [floorLayoutSaveDetail, setFloorLayoutSaveDetail] = useState('Loading server layout…');
  const layoutVersionRef = useRef(0);
  const pendingLayoutSaveRef = useRef<{
    scope: string;
    circleId: string;
    layout: OfficeLayoutDocument;
    version: number;
    localBackupVerified: boolean;
    mutationEpoch: number;
    authScope: { userId: string; accessToken: string };
  } | null>(null);
  const layoutSaveInFlightRef = useRef(false);
  const activeLayoutSaveRef = useRef<typeof pendingLayoutSaveRef.current>(null);
  const layoutSaveDrainRequestedRef = useRef(false);
  const layoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutSaveScopeRef = useRef<string | null>(floorLayoutScope);
  // Render-time invalidation makes stale async continuations fail closed as
  // soon as authentication or circle identity changes. The retiring pending
  // snapshot carries its own authority and is handed off explicitly below.
  layoutSaveScopeRef.current = floorLayoutScope;
  const floorLayoutMutationEpochRef = useRef(0);
  const markFloorLayoutMutation = useCallback((detail: string) => {
    floorLayoutMutationEpochRef.current += 1;
    setFloorLayoutSaveState('saving');
    setFloorLayoutSaveDetail(detail);
  }, []);
  const layoutLocalWriteQueueRef = useRef<ReturnType<typeof createOfficeLayoutLocalWriteQueue> | null>(null);
  if (!layoutLocalWriteQueueRef.current) {
    layoutLocalWriteQueueRef.current = createOfficeLayoutLocalWriteQueue(storage);
  }
  const enqueueVerifiedLocalLayoutSave = useCallback((input: {
    userId: string;
    circleId: string;
    floors: OfficeFloor[];
    currentFloorId: string;
    updatedAt: number;
  }): Promise<boolean> => {
    return runOfficeLayoutRequestWithDeadline(
      () => layoutLocalWriteQueueRef.current!.enqueue(input),
    ).catch(() => false);
  }, []);
  const [floorPresets, setFloorPresets] = useState<OfficeFloorPresetRecord[]>([]);
  const [floorPresetsLoading, setFloorPresetsLoading] = useState(false);
  const [floorPresetSaving, setFloorPresetSaving] = useState(false);
  const [floorPresetStatus, setFloorPresetStatus] = useState<string | null>(null);
  const floorPresetLoadRequestRef = useRef(0);
  const floorPresetRequestRef = useRef(0);
  const floorLayoutGenerationRef = useRef(0);

  // ─── Image / NFT picker state ───────────────────────────────────────────
  const [nftPickerTargetId, setNftPickerTargetId] = useState<string | null>(null);
  const [userNfts, setUserNfts] = useState<NFT[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [imagePickerTab, setImagePickerTab] = useState<'upload' | 'nft'>('upload');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Sticky note editor state ───────────────────────────────────────────
  const [stickyEditorTargetId, setStickyEditorTargetId] = useState<string | null>(null);
  const [stickyTab, setStickyTab] = useState<'write' | 'draw' | 'gif'>('write');
  const [stickyText, setStickyText] = useState('');
  const [stickyColor, setStickyColor] = useState('#fef08a');
  const [stickyGifUrl, setStickyGifUrl] = useState('');
  const [stickyGifSearch, setStickyGifSearch] = useState('');
  const stickyCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stickyDrawingRef = useRef(false);

  // ─── Retro emulator state ────────────────────────────────────────────
  const [emulatorSystem, setEmulatorSystem] = useState<string>('gba');

  // ─── Scrabble state ────────────────────────────────────────────────

  // ─── Phone messenger state ─────────────────────────────────────────

  // ─── Hugging Face state ───────────────────────────────────────────

  // ─── Service connector state ────────────────────────────────────────────
  const [serviceModalTargetId, setServiceModalTargetId] = useState<string | null>(null);
  const [serviceModalType, setServiceModalType] = useState<string>('');
  const [serviceUrl, setServiceUrl] = useState('');
  const [serviceUrlError, setServiceUrlError] = useState('');
  const [serviceTvApp, setServiceTvApp] = useState('youtube');
  const [serviceTvWidth, setServiceTvWidth] = useState('120');
  const [serviceTvHeight, setServiceTvHeight] = useState('80');
  const [serviceDiscordChannel, setServiceDiscordChannel] = useState('');
  const [serviceTwitchChannel, setServiceTwitchChannel] = useState('');
  const [serviceCallProvider, setServiceCallProvider] = useState('zoom');
  const [serviceCalendarProvider, setServiceCalendarProvider] = useState('google');
  const [serviceEmailProvider, setServiceEmailProvider] = useState('outlook');
  const [oauthConnecting, setOauthConnecting] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<ServiceOAuthStatus | null>(null);
  const [oauthError, setOauthError] = useState('');
  const serviceOAuthGenerationRef = useRef(0);
  const oauthMutationTokenRef = useRef<number | null>(null);
  const serviceOAuthDisconnectControllerRef = useRef<{
    generation: number;
    controller: AbortController;
  } | null>(null);
  const serviceWidgetRefreshEpochRef = useRef(0);
  const serviceWidgetRefreshGenerationsRef = useRef(new Map<string, number>());
  const serviceModalVisibleRef = useRef(serviceModalVisible);
  const serviceModalTargetIdRef = useRef(serviceModalTargetId);
  const serviceModalTypeRef = useRef(serviceModalType);
  const serviceCalendarProviderRef = useRef(serviceCalendarProvider);
  const serviceEmailProviderRef = useRef(serviceEmailProvider);
  serviceModalVisibleRef.current = serviceModalVisible;
  serviceModalTargetIdRef.current = serviceModalTargetId;
  serviceModalTypeRef.current = serviceModalType;
  serviceCalendarProviderRef.current = serviceCalendarProvider;
  serviceEmailProviderRef.current = serviceEmailProvider;

  const invalidateServiceWidgetRefreshes = useCallback(() => {
    // Advance a monotonic epoch before clearing per-widget counters. Clearing
    // alone creates an ABA race: an old generation 1 and a new generation 1
    // could otherwise both pass after provider connect/disconnect/switch.
    serviceWidgetRefreshEpochRef.current += 1;
    serviceWidgetRefreshGenerationsRef.current.clear();
  }, []);

  // ─── Interactive furniture state ──────────────────────────────────────────
  const [interactInputId, setInteractInputId] = useState<string | null>(null);
  const [interactInputText, setInteractInputText] = useState('');
  const [interactAgentTarget, setInteractAgentTarget] = useState<string | null>(null);
  const [interactSending, setInteractSending] = useState(false);
  const [interactSendError, setInteractSendError] = useState('');
  const [floorEffects, setFloorEffects] = useState<Array<{ id: string; type: string; x: number; y: number; createdAt: number }>>([]);

  useEffect(() => {
    if (!interactInputId || Platform.OS !== 'web') return;
    const frame = requestAnimationFrame(() => {
      document.querySelector('[data-testid="office-command-review-input"]')?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [interactInputId]);

  // ─── Setup wizard ─────────────────────────────────────────────────────────

  // ─── Cloud agent connect modal ─────────────────────────────────────────────

  // ─── Office enhancement panels ────────────────────────────────────────────
  const [whiteboardModule, setWhiteboardModule] = useState<WhiteboardModule | null>(null);
  const [serverRackModule, setServerRackModule] = useState<ServerRackModule | null>(null);
  const [officeTerminalModule, setOfficeTerminalModule] = useState<OfficeTerminalModule | null>(null);

  // ─── Multi-connection state ──────────────────────────────
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const connectionsRef = useRef<AgentConnection[]>([]);
  // State provenance is separate from current auth: during a same-circle
  // account/token swap, React may briefly retain the prior connection array.
  const connectionsAuthorityRef = useRef<OfficeConnectionExactAuthority | null>(null);
  const pollersRef = useRef<Map<string, OpenSwanPoller>>(new Map());
  const pollerGenerationsRef = useRef<Map<string, number>>(new Map());
  const sessionsRef = useRef<Map<string, OpenSwanSession[]>>(new Map());
  const sessionFingerprintsRef = useRef<Map<string, OpenSwanConnectionFingerprint>>(new Map());
  const officeSessionSnapshotRef = useRef(buildOfficeSessionSnapshot([], new Map(), new Map()));
  const [sessionsTick, setSessionsTick] = useState(0); // force re-render on session updates
  connectionsRef.current = connections;
  officeSessionSnapshotRef.current = buildOfficeSessionSnapshot(
    connections,
    sessionsRef.current,
    sessionFingerprintsRef.current,
  );

  // ─── Current user ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const requestedAuthority = committedAuthAuthority;
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) {
      setCurrentUserName('');
      return () => { cancelled = true; };
    }
    Promise.resolve(supabase.from('profiles')
      .select('display_name, username')
      .eq('id', requestedAuthority.userId)
      .setHeader('Authorization', `Bearer ${requestedAuthority.accessToken}`)
      .single())
      .then(({ data: profile }) => {
        if (!cancelled && isOfficeAuthorityCurrent(requestedAuthority)) {
          setCurrentUserName(profile?.display_name || profile?.username || 'Agent');
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [committedAuthAuthority, isOfficeAuthorityCurrent]);

  useEffect(() => {
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority) {
      setSessionMemoryMode('private');
      return;
    }
    const requestIsCurrent = () => isOfficeAuthorityCurrent(requestedAuthority);
    void loadOfficeCircleSessionMemoryMode(
      circleId,
      toOfficeDashboardAuthority(requestedAuthority),
      requestIsCurrent,
    ).then((result) => {
      if (requestIsCurrent()) setSessionMemoryMode(result.mode);
    }).catch(() => {});
  }, [captureOfficeAuthority, circleId, committedAuthScopeKey, isOfficeAuthorityCurrent]);

  const toggleSessionMemoryMode = useCallback(async () => {
    if (savingSessionMemoryMode) return;
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority) return;
    const requestIsCurrent = () => isOfficeAuthorityCurrent(requestedAuthority);
    const nextMode: 'private' | 'shared' = sessionMemoryMode === 'shared' ? 'private' : 'shared';
    setSavingSessionMemoryMode(true);
    try {
      const result = await saveOfficeCircleSessionMemoryMode(
        circleId,
        nextMode,
        toOfficeDashboardAuthority(requestedAuthority),
        requestIsCurrent,
      );
      if (!result.ok) throw new Error(result.error);
      if (requestIsCurrent()) setSessionMemoryMode(nextMode);
    } catch (err) {
      if (requestIsCurrent()) console.error('[OfficeTab] Failed to update session memory mode:', err);
    } finally {
      if (requestIsCurrent()) setSavingSessionMemoryMode(false);
    }
  }, [captureOfficeAuthority, circleId, isOfficeAuthorityCurrent, savingSessionMemoryMode, sessionMemoryMode]);

  // ─── Circle Office (shared agents from all members) ──────────────────────
  const [circleOfficeAgents, setCircleOfficeAgents] = useState<CircleOfficeAgent[]>([]);
  const [officeAgentSessionBindings, setOfficeAgentSessionBindings] = useState<Map<string, OfficeAgentSessionBindingRecord>>(new Map());
  const [publishCtaDismissed, setPublishCtaDismissed] = useState(false);
  const [publishingToCircle, setPublishingToCircle] = useState(false);
  const readyFired = useRef(false);
  const circleOfficeLoadInFlightRef = useRef<{
    scope: string;
    promise: Promise<void>;
  } | null>(null);
  const pendingCircleOfficeRefreshRef = useRef<Set<string>>(new Set());
  const scheduledCircleOfficeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markOfficeReady = useCallback(() => {
    if (!readyFired.current && onReadyRef.current) {
      readyFired.current = true;
      onReadyRef.current();
    }
  }, []);

  const loadCircleOffice = useCallback(async () => {
    const requestedAuthority = authAuthorityRef.current;
    if (
      !requestedAuthority
      || requestedAuthority.circleId !== circleId
      || floorLayoutScope !== `${requestedAuthority.userId}:${requestedAuthority.circleId}`
    ) return;
    const requestedScope = `${floorLayoutScope}:${requestedAuthority.generation}`;
    if (circleOfficeLoadInFlightRef.current?.scope === requestedScope) {
      pendingCircleOfficeRefreshRef.current.add(requestedScope);
      return circleOfficeLoadInFlightRef.current.promise;
    }
    const requestIsCurrent = () => (
      authAuthorityRef.current?.userId === requestedAuthority.userId
      && authAuthorityRef.current?.circleId === requestedAuthority.circleId
      && authAuthorityRef.current?.accessToken === requestedAuthority.accessToken
      && authAuthorityRef.current?.generation === requestedAuthority.generation
      && layoutSaveScopeRef.current === floorLayoutScope
    );
    const run = (async () => {
      try {
        const { agents } = await loadCircleOfficeAgents(circleId, {
          userId: requestedAuthority.userId,
          accessToken: requestedAuthority.accessToken,
        });
        if (!requestIsCurrent()) return;
        setCircleOfficeAgents(agents);
      } catch (error) {
        if (requestIsCurrent()) console.warn('[OfficeTab] loadCircleOffice failed:', error);
      }
    })();
    const inFlight = { scope: requestedScope, promise: run };
    circleOfficeLoadInFlightRef.current = inFlight;
    await run;
    if (circleOfficeLoadInFlightRef.current === inFlight) {
      circleOfficeLoadInFlightRef.current = null;
    }
    if (pendingCircleOfficeRefreshRef.current.delete(requestedScope) && requestIsCurrent()) {
      void loadCircleOffice();
    }
  }, [circleId, committedAuthScopeKey, floorLayoutScope]);

  const scheduleCircleOfficeRefresh = useCallback((delayMs = 0) => {
    if (scheduledCircleOfficeRefreshRef.current) {
      clearTimeout(scheduledCircleOfficeRefreshRef.current);
      scheduledCircleOfficeRefreshRef.current = null;
    }
    scheduledCircleOfficeRefreshRef.current = setTimeout(() => {
      scheduledCircleOfficeRefreshRef.current = null;
      void loadCircleOffice();
    }, delayMs);
  }, [loadCircleOffice]);

  // Keep a ref to the latest onReady so loadCircleOffice doesn't need it in
  // its useCallback deps. When onReady identity changes on the parent, we
  // don't want to recreate loadCircleOffice — that was causing the
  // subscribe/unsubscribe thrash that tanked circle-load performance (the
  // WebSocket connection failures flooding the console were a symptom).
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    setCircleOfficeAgents([]);
    setLiveUserIds(new Set());
    setCircleConnectionStatus('offline');
    pendingCircleOfficeRefreshRef.current.clear();
    if (!authReady || !floorLayoutScope) return undefined;
    void loadCircleOffice();
    const unsub = subscribeToCircleOffice(circleId, loadCircleOffice);
    return () => {
      if (scheduledCircleOfficeRefreshRef.current) {
        clearTimeout(scheduledCircleOfficeRefreshRef.current);
        scheduledCircleOfficeRefreshRef.current = null;
      }
      unsub();
    };
  }, [authReady, circleId, floorLayoutScope, loadCircleOffice]);

  useEffect(() => {
    let cancelled = false;
    if (!currentUserId) {
      setPublishCtaDismissed(false);
      return () => { cancelled = true; };
    }
    const requestedScope = floorLayoutScope;
    storage.getItem(publishCtaDismissedKey(currentUserId, circleId)).then((raw) => {
      if (cancelled) return;
      if (layoutSaveScopeRef.current !== requestedScope) return;
      setPublishCtaDismissed(raw === '1');
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [circleId, currentUserId, floorLayoutScope]);

  useEffect(() => {
    if (currentUserId && circleOfficeAgents.some((agent) => agent.ownerId === currentUserId) && publishCtaDismissed) {
      setPublishCtaDismissed(false);
      storage.removeItem(publishCtaDismissedKey(currentUserId, circleId)).catch(() => {});
    }
  }, [circleId, circleOfficeAgents, currentUserId, publishCtaDismissed]);

  const dismissPublishCta = useCallback(() => {
    setPublishCtaDismissed(true);
    if (currentUserId) {
      storage.setItem(publishCtaDismissedKey(currentUserId, circleId), '1').catch(() => {});
    }
  }, [circleId, currentUserId]);

  // Live presence state — userId → isOnline flag from Supabase Realtime
  const [liveUserIds, setLiveUserIds] = useState<Set<string>>(new Set());
  const [circleConnectionStatus, setCircleConnectionStatus] = useState<ConnectionStatus>('offline');

  // Start heartbeat + join Realtime Presence when we have connected agents
  useEffect(() => {
    let cancelled = false;
    let heartbeatCleanup: (() => Promise<void>) | null = null;
    let presenceCleanup: (() => Promise<void>) | null = null;
    const connectedConns = connections.filter(c => c.status === 'connected');
    const requestedAuthority = authAuthorityRef.current;
    const requestedScope = floorLayoutScope;
    const requestIsCurrent = () => (
      !cancelled
      && requestedAuthority
      && authAuthorityRef.current?.userId === requestedAuthority.userId
      && authAuthorityRef.current?.circleId === requestedAuthority.circleId
      && authAuthorityRef.current?.accessToken === requestedAuthority.accessToken
      && authAuthorityRef.current?.generation === requestedAuthority.generation
      && layoutSaveScopeRef.current === requestedScope
    );

    if (connectedConns.length > 0 && requestedAuthority && requestedScope) {
      const authority = {
        userId: requestedAuthority.userId,
        accessToken: requestedAuthority.accessToken,
        displayName: currentUserName || undefined,
      };
      // DB heartbeat layer. Its returned cleanup is bound to this exact
      // lifecycle generation, so account-A teardown cannot idle account B.
      void startHeartbeat(circleId, connectedConns, authority).then((cleanup) => {
        if (!requestIsCurrent()) {
          void cleanup();
          return;
        }
        heartbeatCleanup = cleanup;
        scheduleCircleOfficeRefresh();
      });

      // Build live agent states from connections
      const myAgents: AgentLiveState[] = connectedConns.map(conn => ({
        agentId: conn.id,
        name: conn.name,
        provider: conn.provider,
        toolIcon: PROVIDER_DISPLAY[conn.provider]?.icon || '🤖',
        color: conn.color || PROVIDER_DISPLAY[conn.provider]?.color || '#e8e8e8',
        status: 'idle' as const,
      }));

      // Realtime Presence layer
      setCircleConnectionStatus('connecting');
      void joinPresenceChannel(circleId, myAgents, {
        onSync: (state) => {
          if (!requestIsCurrent()) return;
          const live = extractLiveAgents(state);
          setLiveUserIds(new Set(live.keys()));
        },
        onJoin: (joinedUserId) => {
          if (!requestIsCurrent()) return;
          setLiveUserIds(prev => new Set([...prev, joinedUserId]));
          scheduleCircleOfficeRefresh(150);
        },
        onLeave: (leftUserId) => {
          if (!requestIsCurrent()) return;
          setLiveUserIds(prev => {
            const next = new Set(prev);
            next.delete(leftUserId);
            return next;
          });
          scheduleCircleOfficeRefresh(3000);
        },
        onConnectionStatus: (status) => {
          if (requestIsCurrent()) setCircleConnectionStatus(status);
        },
      }, authority).then((cleanup) => {
        if (!requestIsCurrent()) {
          void cleanup();
          return;
        }
        presenceCleanup = cleanup;
      });
    }

    return () => {
      cancelled = true;
      void heartbeatCleanup?.();
      void presenceCleanup?.();
    };
  }, [
    circleId,
    committedAuthScopeKey,
    connections.filter(c => c.status === 'connected').map(c => c.id).join(','),
    currentUserName,
    floorLayoutScope,
    scheduleCircleOfficeRefresh,
    userEmail,
    userId,
  ]);

  // Presentation presence may promote a floor avatar to idle, but it never
  // grants terminal execution authority. Build the canonical terminal target
  // set once and reuse it for the picker, direct dispatch, and Realtime
  // dispatch so @all cannot widen beyond what the user was allowed to select.
  const mergedCircleAgents = useMemo(() => circleOfficeAgents.map(agent => ({
    ...agent,
    status: (liveUserIds.has(agent.ownerId) && agent.status === 'offline')
      ? 'idle' as const
      : agent.status,
  })), [circleOfficeAgents, liveUserIds]);
  const commandTargetAgents = useMemo<TerminalNativeCommandTarget[]>(() => {
    const openSwanReadyAgentIds = new Set<string>();
    for (const durableAgent of mergedCircleAgents) {
      if (durableAgent.ownerId !== currentUserId || durableAgent.provider !== 'openswan') continue;
      const binding = officeAgentSessionBindings.get(durableAgent.id) || null;
      const resolution = resolveOfficeAgentSessionBinding({
        officeAgentId: durableAgent.id,
        binding,
        connections: officeSessionSnapshotRef.current.connections,
        sessionsByConnection: officeSessionSnapshotRef.current.sessionsByConnection,
        sessionFingerprintsByConnection: officeSessionSnapshotRef.current.sessionFingerprintsByConnection,
      });
      if (resolution.ok) openSwanReadyAgentIds.add(durableAgent.id);
    }
    return buildTerminalNativeCommandTargets({
      currentUserId,
      connections,
      officeAgents: mergedCircleAgents,
      openSwanReadyAgentIds,
      virtualDisplayName: DEFAULT_AGENT.name,
    });
  }, [connections, currentUserId, mergedCircleAgents, officeAgentSessionBindings, sessionsTick]);
  const terminalDispatchAgents = useMemo<CircleOfficeAgent[]>(() => (
    commandTargetAgents.flatMap((target) => {
      if (target.id === BLACKSWAN_AGENT_ID || !target.connectionId) return [];
      const durable = mergedCircleAgents.find(agent => agent.id === target.id);
      const connection = connections.find(candidate => (
        candidate.id === target.connectionId
        && candidate.enabled
        && candidate.status === 'connected'
      ));
      if (!durable || !connection) return [];
      return [{
        ...durable,
        gatewayUrl: connection.endpoint,
        // Exact live connection/binding evidence is the execution liveness
        // authority. Normalize stale presentation status once so single,
        // multi-select, and @all invoke the same visible executable set.
        status: durable.status === 'active' || durable.status === 'building'
          ? durable.status
          : 'idle' as const,
      }];
    })
  ), [commandTargetAgents, connections, mergedCircleAgents]);
  const terminalDispatchAgentsRef = useRef<CircleOfficeAgent[]>(terminalDispatchAgents);
  terminalDispatchAgentsRef.current = terminalDispatchAgents;
  const ownedTerminalListenerIds = useMemo(() => (
    circleOfficeAgents
      .filter(agent => agent.ownerId === currentUserId && isUuidLike(agent.id))
      .map(agent => agent.id)
      .sort()
  ), [circleOfficeAgents, currentUserId]);
  const ownedTerminalListenerSignature = ownedTerminalListenerIds.join('|');

  // ─── Direct invocation handler (called by OfficeTerminal after send) ─────
  const handleCommandSent = useCallback((params: {
    messageId: string;
    command: string;
    targetAgentId: string | null;
    targetAgentIds: string[] | null;
    targetAgentName: string;
    targetAgentSubject?: AgentRuntimeSubjectMetadata | null;
    targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
    model: string | null;
    senderId: string;
    authority: TerminalExactAuthority;
    targetFingerprint: string;
    receipt: TerminalCommandDispatchReceipt;
  }) => {
    if (
      params.messageId !== params.receipt.messageId
      || params.senderId !== params.authority.userId
      || params.authority.circleId !== circleId
      || !isTerminalCommandDispatchReceiptCurrent({
        receipt: params.receipt,
        expectedAuthority: params.authority,
        expectedTargetFingerprint: params.targetFingerprint,
        isCurrent: isOfficeAuthorityCurrent,
      })
    ) return;
    const exactExecution = captureOfficeInvocationExecution(params.authority);
    if (!exactExecution) return;
    const blackSwanAgent = createBlackSwanAgent(circleId);
    // Persistence and the advisory wake-up are awaited in OfficeTerminal.
    // Re-read exact authority now so a disconnect/session switch during that
    // await cannot dispatch through a stale captured gateway.
    const dispatchableAgents = terminalDispatchAgentsRef.current;
    const officeSessionSnapshot = officeSessionSnapshotRef.current;

    const baseReq = {
      messageId: params.messageId,
      circleId,
      command: params.command,
      senderId: params.senderId,
      targetAgentName: params.targetAgentName,
      agentSubjectMetadata: params.targetAgentSubject || undefined,
      targetAgentSubjects: params.targetAgentSubjects || null,
      model: params.model,
    };

    const blackSwanTargeted = isVirtualBlackSwanTarget(params);

    if (params.targetAgentIds && params.targetAgentIds.length > 0) {
      if (params.targetAgentIds.includes(BLACKSWAN_AGENT_ID) || blackSwanTargeted) {
        invokeAndStream(
          { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
          blackSwanAgent,
          undefined,
          undefined,
          officeSessionSnapshot,
          exactExecution,
        ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
      }
      const myTargetedAgents = dispatchableAgents.filter(a => params.targetAgentIds!.includes(a.id));
      if (myTargetedAgents.length > 0) {
        invokeSelectedAgents(
          baseReq, myTargetedAgents,
          params.targetAgentIds.filter(id => id !== BLACKSWAN_AGENT_ID),
          undefined,
          undefined,
          officeSessionSnapshot,
          exactExecution,
        ).catch(err => console.error('[OfficeTab] Multi-select invocation failed:', err));
      }
    } else if (params.targetAgentId) {
      if (blackSwanTargeted) {
        invokeAndStream(
          { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
          blackSwanAgent,
          undefined,
          undefined,
          officeSessionSnapshot,
          exactExecution,
        ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
      } else {
        const agent = dispatchableAgents.find(a => a.id === params.targetAgentId);
        if (agent) {
          invokeAndStream(
            { ...baseReq, targetAgentId: agent.id, targetAgentName: `@${agent.name}` },
            agent,
            undefined,
            undefined,
            officeSessionSnapshot,
            exactExecution,
          ).catch(err => console.error('[OfficeTab] Invocation failed:', err));
        }
      }
    } else {
      // @all
      invokeAndStream(
        { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
        blackSwanAgent,
        undefined,
        undefined,
        officeSessionSnapshot,
        exactExecution,
      ).catch(err => console.error('[OfficeTab] BlackSwan @all invocation failed:', err));
      if (dispatchableAgents.length > 0) {
        invokeAllAgents(
          baseReq,
          dispatchableAgents,
          undefined,
          undefined,
          officeSessionSnapshot,
          exactExecution,
        )
          .catch(err => console.error('[OfficeTab] Multi-agent invocation failed:', err));
      }
    }
  }, [captureOfficeInvocationExecution, circleId, isOfficeAuthorityCurrent]);

  // ─── Terminal command subscription ────────────────────────────────────────
  // Keep one listener across heartbeat/session polls. Its durable listener-id
  // superset changes only when owned Office rows change; the callback reads
  // the latest exact executable authority from a ref. Re-subscribing on every
  // ephemeral poll would create a wake-up loss window because broadcasts have
  // no backlog.

  useEffect(() => {
    const requestedAuthority = captureOfficeAuthority();
    if (!currentUserId || !circleId || !requestedAuthority) return;
    const exactExecution = captureOfficeInvocationExecution(requestedAuthority);
    if (!exactExecution) return;

    const blackSwanAgent = createBlackSwanAgent(circleId);

    // Listening to all owned durable ids is safe: the callback still dispatches
    // only the current exact live/bound subset from terminalDispatchAgentsRef.
    const listenIds = [...ownedTerminalListenerIds, BLACKSWAN_AGENT_ID];

    // Need at least BlackSwan to listen (always active)
    if (listenIds.length === 0) return;

    const unsub = subscribeToTerminalCommandsExact(
      requestedAuthority,
      listenIds,
      isOfficeAuthorityCurrent,
      async ({ command: cmd, receipt }) => {
      if (!isTerminalCommandDispatchReceiptCurrent({
        receipt,
        expectedAuthority: requestedAuthority,
        expectedTargetFingerprint: receipt.target.fingerprint,
        isCurrent: isOfficeAuthorityCurrent,
      })) return;
      // Skip commands we sent ourselves — already handled via direct invocation (onCommandSent)
      if (cmd.senderId === currentUserId) return;
      const baseReq = {
        messageId: cmd.messageId,
        circleId,
        command: cmd.commandText,
        senderId: cmd.senderId,
        targetAgentName: cmd.targetAgentName,
        agentSubjectMetadata: cmd.targetAgentSubject || undefined,
        targetAgentSubjects: cmd.targetAgentSubjects || null,
        model: cmd.model,
      };

      const dispatchableAgents = terminalDispatchAgentsRef.current;
      const officeSessionSnapshot = officeSessionSnapshotRef.current;

      // Helper: check if BlackSwan is targeted
      const blackSwanTargeted = isVirtualBlackSwanTarget(cmd);

      if (cmd.targetAgentIds && cmd.targetAgentIds.length > 0) {
        // Multi-select — invoke selected agents in parallel
        // Invoke BlackSwan if included
        if (blackSwanTargeted) {
          invokeAndStream(
            { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
            blackSwanAgent,
            undefined,
            undefined,
            officeSessionSnapshot,
            exactExecution,
          ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
        }
        // Invoke user's agents that are in the multi-select
        const myTargetedAgents = dispatchableAgents.filter(a => cmd.targetAgentIds!.includes(a.id));
        if (myTargetedAgents.length > 0) {
          invokeSelectedAgents(
            baseReq,
            myTargetedAgents,
            cmd.targetAgentIds.filter(id => id !== BLACKSWAN_AGENT_ID),
            undefined,
            undefined,
            officeSessionSnapshot,
            exactExecution,
          ).catch(err => console.error('[OfficeTab] Multi-select invocation failed:', err));
        }
      } else if (cmd.targetAgentId || blackSwanTargeted) {
        // Single durable UUID target, or the virtual BlackSwan target encoded
        // by name because it cannot be persisted in a UUID column.
        if (blackSwanTargeted) {
          invokeAndStream(
            { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
            blackSwanAgent,
            undefined,
            undefined,
            officeSessionSnapshot,
            exactExecution,
          ).catch(err => console.error('[OfficeTab] BlackSwan invocation failed:', err));
        } else {
          const agent = dispatchableAgents.find(a => a.id === cmd.targetAgentId);
          if (!agent) return;

          invokeAndStream(
            { ...baseReq, targetAgentId: agent.id, targetAgentName: `@${agent.name}` },
            agent,
            undefined,
            undefined,
            officeSessionSnapshot,
            exactExecution,
          ).catch(err => console.error('[OfficeTab] Invocation failed:', err));
        }
      } else {
        // @all — invoke BlackSwan + all user's agents in parallel
        invokeAndStream(
          { ...baseReq, targetAgentId: BLACKSWAN_AGENT_ID, targetAgentName: '@BlackSwan' },
          blackSwanAgent,
          undefined,
          undefined,
          officeSessionSnapshot,
          exactExecution,
        ).catch(err => console.error('[OfficeTab] BlackSwan @all invocation failed:', err));

        if (dispatchableAgents.length > 0) {
          invokeAllAgents(
            { ...baseReq, targetAgentName: '@all' },
            dispatchableAgents,
            undefined,
            undefined,
            officeSessionSnapshot,
            exactExecution,
          ).catch(err => console.error('[OfficeTab] Multi-agent invocation failed:', err));
        }
      }
      },
    );

    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps — exact sorted durable-id signature
  }, [circleId, committedAuthAuthority?.generation, committedAuthScopeKey, currentUserId, ownedTerminalListenerSignature]);

  useEffect(() => {
    let cancelled = false;
    const ownUuidAgentIds = mergedCircleAgents
      .filter(agent => agent.ownerId === currentUserId && isUuidLike(agent.id))
      .map(agent => agent.id)
      .sort();
    if (ownUuidAgentIds.length === 0) {
      setOfficeAgentSessionBindings(new Map());
      return () => { cancelled = true; };
    }
    void readOfficeAgentSessionBindingsBatch(ownUuidAgentIds).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setOfficeAgentSessionBindings(new Map(result.bindings));
        return;
      }
      if (result.reason === 'transient_transport') {
        const stillOwned = new Set(ownUuidAgentIds);
        setOfficeAgentSessionBindings((current) => new Map(
          Array.from(current).filter(([agentId]) => stillOwned.has(agentId)),
        ));
        return;
      }
      // Missing schema, denied access, or malformed rows cannot remain
      // presentation authority. The exact invocation path independently reads
      // one fresh binding again before any provider I/O.
      setOfficeAgentSessionBindings(new Map());
    }).catch(() => {
      if (cancelled) return;
      const stillOwned = new Set(ownUuidAgentIds);
      setOfficeAgentSessionBindings((current) => new Map(
        Array.from(current).filter(([agentId]) => stillOwned.has(agentId)),
      ));
    });
    return () => { cancelled = true; };
  }, [currentUserId, mergedCircleAgents.map(agent => `${agent.id}:${agent.ownerId}:${agent.updatedAt}`).join('|'), sessionsTick]);

  // Publish the user's first connection as their circle office agent
  // ─── Manual agent publish modal ──────────────────────────────────────────
  const [publishName, setPublishName] = useState('');
  const [publishProvider, setPublishProvider] = useState('openswan');

  const handleActionResult = useCallback((message: string) => {
    setActionResult(message);
    setShowActionResult(true);
    // Auto-hide after 5 seconds
    setTimeout(() => {
      setShowActionResult(false);
    }, 5000);
  }, []);

  const openPublishAgentModal = useCallback((conn?: AgentConnection) => {
    if (conn) {
      setPublishName(conn.name || '');
      setPublishProvider(conn.provider || 'openswan');
    } else {
      setPublishName(prev => prev || 'My Agent');
      setPublishProvider(prev => prev || 'openswan');
    }
    setShowPublishModal(true);
  }, [setShowPublishModal]);

  const handlePublishToCircle = useCallback(async (
    overrideName?: string,
    overrideProvider?: string
  ) => {
    if (publishingToCircle) return;
    const requestedAuthority = authAuthorityRef.current;
    if (!requestedAuthority || requestedAuthority.circleId !== circleId) {
      handleActionResult('Sign in again before publishing an agent.');
      return;
    }
    const requestIsCurrent = () => (
      authAuthorityRef.current?.userId === requestedAuthority.userId
      && authAuthorityRef.current?.circleId === requestedAuthority.circleId
      && authAuthorityRef.current?.accessToken === requestedAuthority.accessToken
      && authAuthorityRef.current?.generation === requestedAuthority.generation
    );

    // Prefer passed values → connected conn → modal values → defaults
    const conn = connections.find(c => c.enabled);
    const display = PROVIDER_DISPLAY[overrideProvider || publishProvider || conn?.provider || 'openswan']
      || PROVIDER_DISPLAY['generic-agent'];

    const agentName    = overrideName     || conn?.name     || publishName || 'My Agent';
    const agentProvider= overrideProvider || conn?.provider || publishProvider || 'openswan';
    const agentColor   = conn?.color      || display.color;

    setPublishingToCircle(true);
    try {
      const result = await publishAgentToCircle({
        circleId,
        provider: agentProvider,
        name: agentName,
        color: agentColor,
        toolIcon: display.icon,
      }, {
        userId: requestedAuthority.userId,
        accessToken: requestedAuthority.accessToken,
      });
      if (!requestIsCurrent()) return;
      if (result.error) {
        const message = result.error === 'agent_hidden'
          ? 'This agent is hidden from the Circle Office right now. Reconnect or rename it before publishing again.'
          : `Could not add your agent to the Circle Office: ${result.error}`;
        handleActionResult(message);
        return;
      }
      scheduleCircleOfficeRefresh(150);
      handleActionResult(`${agentName} is now visible in the Circle Office.`);
      setShowPublishModal(false);
    } finally {
      if (requestIsCurrent()) setPublishingToCircle(false);
    }
  }, [circleId, connections, handleActionResult, publishingToCircle, publishName, publishProvider, scheduleCircleOfficeRefresh]);

  // Auto-publish when a connection becomes connected for the first time
  const autoPublishedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    autoPublishedRef.current.clear();
  }, [committedAuthAuthority?.generation]);
  useEffect(() => {
    const requestedAuthority = authAuthorityRef.current;
    if (!requestedAuthority || requestedAuthority.circleId !== circleId) return;
    const requestIsCurrent = () => (
      authAuthorityRef.current?.userId === requestedAuthority.userId
      && authAuthorityRef.current?.circleId === requestedAuthority.circleId
      && authAuthorityRef.current?.accessToken === requestedAuthority.accessToken
      && authAuthorityRef.current?.generation === requestedAuthority.generation
    );
    const connectedConns = connections.filter(c => c.status === 'connected');
    for (const conn of connectedConns) {
      if (!autoPublishedRef.current.has(conn.id)) {
        autoPublishedRef.current.add(conn.id);
        const display = PROVIDER_DISPLAY[conn.provider] || PROVIDER_DISPLAY['generic-agent'];
        publishAgentToCircle({
          circleId,
          provider: conn.provider,
          name: conn.name,
          color: conn.color || display.color,
          toolIcon: display.icon,
        }, {
          userId: requestedAuthority.userId,
          accessToken: requestedAuthority.accessToken,
        }).then(() => {
          if (requestIsCurrent()) scheduleCircleOfficeRefresh(150);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps — identity signature, not count
  }, [circleId, committedAuthScopeKey, connections.filter(c => c.status === 'connected').map(c => c.id).join(','), scheduleCircleOfficeRefresh]);

  // ─── Telegram state ──────────────────────────────
  const [telegramConfig, setTelegramConfig] = useState<TelegramConfig>({ botToken: '', chatId: '' });
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramBotName, setTelegramBotName] = useState<string | null>(null);
  const [telegramChatTitle, setTelegramChatTitle] = useState<string | null>(null);
  const [telegramError, setTelegramError] = useState<string | null>(null);
  const [telegramMessages, setTelegramMessages] = useState<TelegramMessage[]>([]);
  const tgPollerRef = useRef<TelegramPoller | null>(null);
  const shouldSkipOpenSwanConnectionAttempt = useCallback((conn: AgentConnection) => {
    if (conn.provider !== 'openswan') return false;
    const notice = getOpenSwanEndpointNotice(conn.endpoint, conn.token);
    return !!notice && /authentication failed|wrong or missing token/i.test(notice);
  }, []);

  // ─── Connection helpers ──────────────────────────────

  const connectOne = useCallback(async (
    conn: AgentConnection,
    capturedAuthority?: OfficeConnectionExactAuthority,
  ) => {
    const requestedAuthority = capturedAuthority ?? captureOfficeAuthority();
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return;
    const generation = (pollerGenerationsRef.current.get(conn.id) || 0) + 1;
    pollerGenerationsRef.current.set(conn.id, generation);
    const priorPoller = pollersRef.current.get(conn.id);
    if (priorPoller) priorPoller.stop();
    pollersRef.current.delete(conn.id);
    sessionsRef.current.delete(conn.id);
    sessionFingerprintsRef.current.delete(conn.id);
    if (shouldSkipOpenSwanConnectionAttempt(conn)) {
      setConnections(prev => {
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'error' as const,
          error: 'Authentication failed — wrong or missing token',
        } : c);
        return updated;
      });
      return;
    }
    // Status is private to this exact Office authority. The app-level
    // auto-connect singleton is intentionally not an Office data source.
    setConnections(prev => {
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
      const updated = prev.map(c => c.id === conn.id ? { ...c, status: 'connecting' as const, error: undefined } : c);
      return updated;
    });

    const result = await testAgentBridgeConnection({
      provider: conn.provider,
      endpoint: conn.endpoint,
      token: conn.token,
    });
    if (
      pollerGenerationsRef.current.get(conn.id) !== generation
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return;

    if (!result.ok) {
      setConnections(prev => {
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id ? { ...c, status: 'error' as const, error: result.error || 'Connection failed' } : c);
        return updated;
      });
      return;
    }

    if (!supportsOpenSwanRpc(conn.provider)) {
      setConnections(prev => {
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'connected' as const,
          error: undefined,
          sessionCount: undefined,
          agentIds: [],
          lastConnected: new Date().toISOString(),
        } : c);
        return updated;
      });
      return;
    }

    const config: OpenSwanConfig = { endpoint: conn.endpoint, token: conn.token };
    const connectionFingerprint = buildOpenSwanConnectionFingerprint(conn);
    if (!connectionFingerprint) {
      setConnections(prev => {
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'error' as const,
          error: 'Invalid OpenSwan connection identity',
        } : c);
        return updated;
      });
      return;
    }

    // Store initial sessions from the successful rich-bridge test result
    sessionsRef.current.set(conn.id, result.sessions || []);
    sessionFingerprintsRef.current.set(conn.id, connectionFingerprint);

    // Fetch agent ids
    let agentIds: string[] = [];
    const agentsResult = await listAgents(config);
    if (
      pollerGenerationsRef.current.get(conn.id) !== generation
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return;
    if (agentsResult.ok && agentsResult.agents) agentIds = agentsResult.agents;

    // Update only while the captured account/circle/token generation owns it.
    setConnections(prev => {
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id ? {
          ...c,
          status: 'connected' as const,
          error: undefined,
          sessionCount: (result.sessions || []).length,
          agentIds,
          lastConnected: new Date().toISOString(),
        } : c);
      return updated;
    });

    // Start poller
    let poller: OpenSwanPoller;
    poller = new OpenSwanPoller(config, (update: OpenSwanUpdate) => {
      const currentConnection = connectionsRef.current.find((candidate) => candidate.id === conn.id);
      if (
        pollerGenerationsRef.current.get(conn.id) !== generation
        || pollersRef.current.get(conn.id) !== poller
        || !isOfficeAuthorityCurrent(requestedAuthority)
        || !currentConnection
        || currentConnection.status !== 'connected'
        || !matchesOpenSwanConnectionFingerprint(connectionFingerprint, currentConnection)
      ) return;
      sessionsRef.current.set(conn.id, update.sessions);
      sessionFingerprintsRef.current.set(conn.id, connectionFingerprint);
      setConnections(prev => {
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id && c.status === 'connected' ? {
          ...c, sessionCount: update.sessions.length,
        } : c);
        return updated;
      });
      setSessionsTick(t => t + 1);
    }, (error: string) => {
      if (
        pollerGenerationsRef.current.get(conn.id) !== generation
        || pollersRef.current.get(conn.id) !== poller
        || !isOfficeAuthorityCurrent(requestedAuthority)
      ) return;
      // Poller detected persistent failure — mark as error for retry
      pollersRef.current.delete(conn.id);
      pollerGenerationsRef.current.set(conn.id, generation + 1);
      sessionsRef.current.delete(conn.id);
      sessionFingerprintsRef.current.delete(conn.id);
      setConnections(prev => {
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
        const updated = prev.map(c => c.id === conn.id ? {
          ...c, status: 'error' as const, error,
        } : c);
        return updated;
      });
    });
    poller.start(10000);
    pollersRef.current.set(conn.id, poller);

    setSessionsTick(t => t + 1);
  }, [captureOfficeAuthority, isOfficeAuthorityCurrent, shouldSkipOpenSwanConnectionAttempt]);

  const disconnectOne = useCallback((
    connId: string,
    capturedAuthority?: OfficeConnectionExactAuthority,
  ) => {
    const requestedAuthority = capturedAuthority ?? captureOfficeAuthority();
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return;
    pollerGenerationsRef.current.set(connId, (pollerGenerationsRef.current.get(connId) || 0) + 1);
    const poller = pollersRef.current.get(connId);
    if (poller) { poller.stop(); pollersRef.current.delete(connId); }
    sessionsRef.current.delete(connId);
    sessionFingerprintsRef.current.delete(connId);
    setConnections(prev => {
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return prev;
      const updated = prev.map(c => c.id === connId ? {
        ...c, status: 'disconnected' as const, error: undefined, sessionCount: undefined, agentIds: undefined,
      } : c);
      return updated;
    });
    setSessionsTick(t => t + 1);
  }, [captureOfficeAuthority, isOfficeAuthorityCurrent]);

  const persistOfficeConnections = useCallback(async (
    values: AgentConnection[],
    capturedAuthority?: OfficeConnectionExactAuthority,
  ) => {
    const requestedAuthority = capturedAuthority ?? captureOfficeAuthority();
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return null;
    const result = await saveOfficeConnectionsExact(
      values,
      requestedAuthority,
      isOfficeAuthorityCurrent,
    );
    if (!result.ok || !isOfficeAuthorityCurrent(requestedAuthority)) return result;
    connectionsAuthorityRef.current = requestedAuthority;
    setConnections(result.connections);
    return result;
  }, [captureOfficeAuthority, isOfficeAuthorityCurrent]);

  const handleAddConnection = useCallback(async (conn: AgentConnection) => {
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority) return;
    const current = connectionsRef.current;
    const exists = current.some(c => c.id === conn.id);
    const updated = exists
      ? current.map(c => c.id === conn.id ? conn : c)
      : [...current, conn];
    const result = await persistOfficeConnections(updated, requestedAuthority);
    if (!result?.ok || !isOfficeAuthorityCurrent(requestedAuthority)) return;
    const savedConnection = result.connections.find(candidate => candidate.id === conn.id) ?? conn;
    void connectOne(savedConnection, requestedAuthority);
  }, [captureOfficeAuthority, connectOne, isOfficeAuthorityCurrent, persistOfficeConnections]);

  const handleRemoveConnection = useCallback(async (id: string) => {
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority) return;
    const updated = connectionsRef.current.filter(c => c.id !== id);
    const result = await persistOfficeConnections(updated, requestedAuthority);
    if (!result?.ok || !isOfficeAuthorityCurrent(requestedAuthority)) return;
    disconnectOne(id, requestedAuthority);
  }, [captureOfficeAuthority, disconnectOne, isOfficeAuthorityCurrent, persistOfficeConnections]);

  const handleConnectConnection = useCallback((id: string) => {
    const conn = connections.find(c => c.id === id);
    if (conn) connectOne(conn);
  }, [connections, connectOne]);

  const handleDisconnectConnection = useCallback((id: string) => {
    disconnectOne(id);
  }, [disconnectOne]);

  const handleReconnectAll = useCallback(() => {
    // Reconnect all enabled connections that aren't already connected
    const toReconnect = connections.filter(c => c.enabled && c.status !== 'connected' && c.status !== 'connecting');

    if (toReconnect.length > 0) {
      toReconnect.forEach(conn => connectOne(conn));
    }
  }, [connections, connectOne]);

  const getConnectionConfig = useCallback((id: string): OpenSwanConfig | null => {
    const conn = connections.find(c => c.id === id && c.status === 'connected');
    if (!conn) return null;
    return { endpoint: conn.endpoint, token: conn.token };
  }, [connections]);

  // Push one immutable auth-scoped partial through the per-user queue. A
  // retired account never dispatches, and a timed-out unknown write keeps only
  // that account's lane reserved so another account remains usable.
  const pushOfficePreferences = useCallback((
    partial: Record<string, unknown>,
    capturedAuthority?: Readonly<{
      userId: string;
      circleId: string;
      accessToken: string;
      generation: number;
    }>,
  ) => {
    const requestedAuthority = capturedAuthority ?? authAuthorityRef.current;
    const currentAuthority = authAuthorityRef.current;
    if (
      !officeUserPreferencesAvailableRef.current
      || !requestedAuthority
      || currentAuthority?.userId !== requestedAuthority.userId
      || currentAuthority?.circleId !== requestedAuthority.circleId
      || currentAuthority?.accessToken !== requestedAuthority.accessToken
      || currentAuthority?.generation !== requestedAuthority.generation
    ) return;
    void officePreferenceWriteQueueRef.current?.enqueue({
      userId: requestedAuthority.userId,
      circleId: requestedAuthority.circleId,
      accessToken: requestedAuthority.accessToken,
      authorityGeneration: requestedAuthority.generation,
      partial,
    });
  }, []);

  // ─── Telegram handlers ──────────────────────────────

  const handleTelegramConnect = useCallback(async () => {
    const requestedAuthority = authAuthorityRef.current;
    const botToken = telegramConfig.botToken.trim();
    const chatId = telegramConfig.chatId.trim();
    if (!requestedAuthority) {
      setTelegramError('Sign in again before connecting Telegram.');
      return;
    }
    const requestIsCurrent = () => (
      authAuthorityRef.current?.userId === requestedAuthority.userId
      && authAuthorityRef.current?.circleId === requestedAuthority.circleId
      && authAuthorityRef.current?.accessToken === requestedAuthority.accessToken
      && authAuthorityRef.current?.generation === requestedAuthority.generation
    );
    if (!botToken) { setTelegramError('Bot token is required'); return; }
    setTelegramConnecting(true);
    setTelegramError(null);

    const botResult = await verifyBot(botToken);
    if (!requestIsCurrent()) return;
    if (!botResult.ok) {
      setTelegramError(botResult.error || 'Invalid bot token');
      setTelegramConnecting(false);
      return;
    }
    setTelegramBotName(botResult.bot?.username || null);

    if (chatId) {
      const chatResult = await getChat(botToken, chatId);
      if (!requestIsCurrent()) return;
      if (chatResult.ok) setTelegramChatTitle(chatResult.title || null);
      else setTelegramChatTitle(null);
    }

    if (tgPollerRef.current) tgPollerRef.current.stop();
    const poller = new TelegramPoller(botToken, (msgs) => {
      if (requestIsCurrent()) {
        setTelegramMessages(prev => [...msgs, ...prev].slice(0, 50));
      }
    });
    poller.start(5000);
    tgPollerRef.current = poller;

    setTelegramConnected(true);
    setTelegramConnecting(false);

    const secretStored = await writeVerifiedLocalSecret(
      OFFICE_TELEGRAM_SECRET_NAMESPACE,
      officeTelegramSecretId(requestedAuthority.userId, requestedAuthority.circleId),
      botToken,
    );
    if (!secretStored || !requestIsCurrent()) {
      poller.stop();
      tgPollerRef.current = null;
      if (requestIsCurrent()) {
        setTelegramConnected(false);
        setTelegramError('Secure device storage is unavailable. Telegram was not saved.');
      }
      return;
    }
    const telegramMetadata = {
      chatId,
      botName: botResult.bot?.username || '',
    };
    try {
      await storage.setItem(
        officePrivateStorageKey(
          'telegram_metadata',
          requestedAuthority.userId,
          requestedAuthority.circleId,
        ),
        JSON.stringify(telegramMetadata),
      );
    } catch {
      // The encrypted token is the authority boundary. Non-secret metadata is
      // best-effort locally and can still be recovered from the private RPC.
    }
    if (requestIsCurrent()) {
      pushOfficePreferences({ telegramMetadata }, requestedAuthority);
    }
  }, [pushOfficePreferences, telegramConfig]);

  const handleTelegramDisconnect = useCallback(() => {
    if (tgPollerRef.current) { tgPollerRef.current.stop(); tgPollerRef.current = null; }
    setTelegramConnected(false);
    setTelegramBotName(null);
    setTelegramChatTitle(null);
    setTelegramMessages([]);
    setTelegramError(null);
    // Remove the exact encrypted device credential and non-secret metadata.
    const authority = authAuthorityRef.current;
    if (authority) {
      void deleteVerifiedLocalSecret(
        OFFICE_TELEGRAM_SECRET_NAMESPACE,
        officeTelegramSecretId(authority.userId, authority.circleId),
      );
      void storage.removeItem(
        officePrivateStorageKey('telegram_metadata', authority.userId, authority.circleId),
      );
    }
    if (authority) pushOfficePreferences({ telegramMetadata: null }, authority);
  }, [pushOfficePreferences]);

  // ─── Load exact-scope connections on mount + auto-discover ────────
  // App-level bridge discovery may still support other surfaces, but Office
  // connection records and protected credentials are owned by this captured
  // user/circle lifecycle and never hydrate from the owner-global singleton.

  const floorsInitializedRef = useRef(false);
  const [floorLayoutHydratedCircleId, setFloorLayoutHydratedCircleId] = useState<string | null>(null);
  const [officeAccessError, setOfficeAccessError] = useState<string | null>(null);
  const [officeAccessRetry, setOfficeAccessRetry] = useState(0);
  // `null === null` is not hydration. Until the authenticated user/circle
  // scope exists, render the loading boundary and reject editor mutations;
  // otherwise a fast click can enter edit mode before initialization and then
  // get reset when the real user scope arrives.
  const floorLayoutHydrated = Boolean(floorLayoutScope)
    && floorLayoutHydratedCircleId === floorLayoutScope;
  const authoritativeLayoutReadRef = useRef(false);
  const skipNextLayoutPersistenceRef = useRef(false);
  const initRef = useRef<string | null>(null);

  // Idle work owns a dedicated exact-authority lifecycle. It must not restart
  // when bridge presence, the asynchronously hydrated display name, or other
  // heartbeat-only inputs churn. More importantly, it cannot observe transient
  // defaults: the exact local receipt and remote preference read must reconcile
  // after membership proof before this generation becomes runnable.
  useEffect(() => {
    let cancelled = false;
    const requestedAuthority = committedAuthAuthority;
    if (!requestedAuthority || !floorLayoutHydrated) return undefined;
    const schedulerAuthority: IdleSchedulerAuthority = {
      circleId: requestedAuthority.circleId,
      userId: requestedAuthority.userId,
      accessToken: requestedAuthority.accessToken,
      authorityGeneration: requestedAuthority.generation,
    };
    const requestedReadyKey = idleConfigAuthorityKey(schedulerAuthority);
    if (
      idleConfigReadyAuthorityKey !== requestedReadyKey
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return undefined;

    const requestIsCurrent = () => Boolean(
      !cancelled
      && idleConfigReadyAuthorityKey === requestedReadyKey
      && isOfficeAuthorityCurrent(requestedAuthority)
    );
    const cleanup = startIdleScheduler(
      schedulerAuthority,
      userEmail === OWNER_EMAIL,
      () => idleConfigRef.current,
      (updated) => {
        if (!requestIsCurrent()) return;
        const normalized = normalizeIdleConfig(updated);
        idleConfigRef.current = normalized;
        setIdleConfig(normalized);
      },
      (authority) => Boolean(
        requestIsCurrent()
        && authority.circleId === schedulerAuthority.circleId
        && authority.userId === schedulerAuthority.userId
        && authority.accessToken === schedulerAuthority.accessToken
        && authority.authorityGeneration === schedulerAuthority.authorityGeneration
      ),
    );

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [
    committedAuthAuthority,
    floorLayoutHydrated,
    idleConfigReadyAuthorityKey,
    isOfficeAuthorityCurrent,
    userEmail,
  ]);

  const mutateFloorsDurably = useCallback((
    update: (current: OfficeFloor[]) => OfficeFloor[],
    detail = 'Saving every floor item and tool…',
  ): boolean => {
    const scope = floorLayoutScope;
    if (!scope || !floorLayoutHydrated || layoutSaveScopeRef.current !== scope) return false;
    const current = floorsRef.current;
    const updated = update(current);
    if (!Array.isArray(updated) || updated === current) return false;
    floorsRef.current = updated;
    markFloorLayoutMutation(detail);
    setFloors(updated);
    return true;
  }, [floorLayoutHydrated, floorLayoutScope, markFloorLayoutMutation]);
  const patchFurnitureStateDurably = useCallback((
    floorId: string,
    itemId: string | null,
    update: (item: FurnitureItem) => FurnitureItem,
  ): boolean => {
    if (!itemId) return false;
    return mutateFloorsDurably((current) => {
      const floorIndex = current.findIndex((floor) => floor.id === floorId);
      if (floorIndex < 0) return current;
      const itemIndex = current[floorIndex].furniture.findIndex((item) => item.id === itemId);
      if (itemIndex < 0) return current;
      const nextItem = update(current[floorIndex].furniture[itemIndex]);
      if (!nextItem || nextItem.id !== itemId) return current;
      const nextFurniture = [...current[floorIndex].furniture];
      nextFurniture[itemIndex] = nextItem;
      const updated = [...current];
      updated[floorIndex] = { ...current[floorIndex], furniture: nextFurniture };
      return updated;
    });
  }, [mutateFloorsDurably]);
  useEffect(() => {
    const requestedAuthority = committedAuthAuthority;
    const initializationKey = committedAuthScopeKey && requestedAuthority
      ? `${committedAuthScopeKey}:generation:${requestedAuthority.generation}:retry:${officeAccessRetry}`
      : null;
    if (
      !authReady
      || !currentUserId
      || !authSession?.access_token
      || !floorLayoutScope
      || !initializationKey
      || !requestedAuthority
      || requestedAuthority.userId !== currentUserId
      || requestedAuthority.circleId !== circleId
      || requestedAuthority.accessToken !== authSession.access_token
      || requestedAuthority.generation !== authAuthorityRef.current?.generation
      || initRef.current === initializationKey
    ) return;
    let cancelled = false;
    const requestedAuthScope = {
      userId: currentUserId,
      accessToken: authSession.access_token,
    };
    const requestedAuthorityGeneration = requestedAuthority.generation;
    const idleSchedulerAuthority: IdleSchedulerAuthority = {
      circleId,
      userId: currentUserId,
      accessToken: authSession.access_token,
      authorityGeneration: requestedAuthorityGeneration,
    };
    const requestedScope = floorLayoutScope;
    const requestIsCurrent = () => (
      !cancelled
      && layoutSaveScopeRef.current === requestedScope
      && requestedAuthScope.userId === authAuthorityRef.current?.userId
      && circleId === authAuthorityRef.current?.circleId
      && requestedAuthScope.accessToken === authAuthorityRef.current?.accessToken
      && requestedAuthorityGeneration === authAuthorityRef.current?.generation
    );
    initRef.current = initializationKey;
    floorLayoutGenerationRef.current += 1;
    floorPresetLoadRequestRef.current += 1;
    floorPresetRequestRef.current += 1;
    setFloorPresetSaving(false);
    appearancesLoadedRef.current = false;
    prefsLoadedRef.current = false;
    // Account/circle-private state must never remain painted while the next
    // exact scope hydrates. Ownerless legacy local keys are intentionally not
    // imported because their provenance cannot be proven.
    setAgentNames({});
    setTelegramConfig({ botToken: '', chatId: '' });
    setTelegramConnected(false);
    setTelegramConnecting(false);
    setTelegramBotName(null);
    setTelegramChatTitle(null);
    setTelegramError(null);
    setTelegramMessages([]);
    if (tgPollerRef.current) {
      tgPollerRef.current.stop();
      tgPollerRef.current = null;
    }
    setAppearances({});
    pollersRef.current.forEach((poller, connectionId) => {
      pollerGenerationsRef.current.set(
        connectionId,
        (pollerGenerationsRef.current.get(connectionId) || 0) + 1,
      );
      poller.stop();
    });
    pollersRef.current.clear();
    sessionsRef.current.clear();
    sessionFingerprintsRef.current.clear();
    connectionsAuthorityRef.current = null;
    connectionsRef.current = [];
    setConnections([]);
    setSessionsTick(tick => tick + 1);
    setWhiteboardNotes([]);
    setCircleOfficeAgents([]);
    setOfficeAgentSessionBindings(new Map());
    setLiveUserIds(new Set());
    setCircleConnectionStatus('offline');
    setAgentIdentities(new Map());
    setSessionTags(new Map());
    sessionTagsRef.current = new Map();
    setEnrichedAgents([]);
    enrichedAgentsRef.current = [];
    setEnrichedSessions([]);
    setCronJobs([]);
    setAgentFilterMode('all');
    setSelectedAgent(null);
    setUserNfts([]);
    setNftsLoading(false);
    setBudgetConfig({ enabled: false });
    const defaultIdleConfig = getDefaultIdleConfig();
    setIdleConfig(defaultIdleConfig);
    idleConfigRef.current = defaultIdleConfig;
    setIdleConfigReadyAuthorityKey(null);
    floorsInitializedRef.current = false;
    authoritativeLayoutReadRef.current = false;
    skipNextLayoutPersistenceRef.current = false;
    pendingLayoutSaveRef.current = null;
    // Never dispatch a retired identity's snapshot after an account/circle
    // change. Its verified scoped local envelope remains available for a later
    // matching login to seed safely.
    layoutSaveDrainRequestedRef.current = false;
    if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = null;
    setFloorLayoutHydratedCircleId(null);
    setOfficeAccessError(null);
    officeEditorHistoriesRef.current = {};
    officeEditorItemStateRef.current = {};
    setOfficeEditorHistoryRevision((revision) => revision + 1);
    const detachedDefaults = DEFAULT_FLOORS.map((floor) => ({
      ...floor,
      agentIds: [...floor.agentIds],
      furniture: floor.furniture.map((item) => ({ ...item })),
    }));
    floorsRef.current = detachedDefaults;
    setFloors(detachedDefaults);
    setCurrentFloorId(detachedDefaults[0].id);
    setEditMode(false);
    setPlacingType(null);
    setSelectedFurnitureId(null);
    setNftPickerVisible(false);
    setNftPickerTargetId(null);
    setStickyEditorVisible(false);
    setStickyEditorTargetId(null);
    setServiceModalVisible(false);
    setServiceModalTargetId(null);
    setScrabbleVisible(false);
    setPokerVisible(false);
    setPhoneVisible(false);
    setShowCustomize(false);
    setShowMcpHub(false);
    setShowRewards(false);
    setShowSetupWizard(false);
    setShowConnectAgent(false);
    setShowGitHubFeed(false);
    setShowSoundMixer(false);
    setShowVault(false);
    setShowPublishModal(false);
    setTerminalSize('closed');
    setTerminalInput('');
    setTerminalTargetId('blackswan-default');
    setTerminalTargetName('@BlackSwan');
    setTerminalTargetIds(['blackswan-default']);
    setTerminalModel('blackswan');
    setActiveScrabbleItemId(null);
    setActivePokerItemId(null);
    setActivePhoneItemId(null);
    layoutVersionRef.current = 0;
    setFloorLayoutSaveState('loading');
    setFloorLayoutSaveDetail('Loading server layout…');
    budgetLoadedRef.current = false;
    idleLoadedRef.current = false;
    remoteBudgetAppliedRef.current = false;
    remoteIdleAppliedRef.current = false;

    // Reset Supabase column flags each mount — transient errors shouldn't
    // permanently disable sync for the rest of the session
    officeUserPreferencesAvailableRef.current = true;

    let membershipProven = false;
    (async () => {
      // Previous builds wrote the Telegram token into plaintext browser
      // storage. Never read or migrate those envelopes: delete them and keep
      // only the verified encrypted device credential introduced below.
      void runOfficeLayoutRequestWithDeadline(() => Promise.all([
        storage.removeItem(legacyOfficeTelegramStorageKey(currentUserId, circleId)),
        storage.removeItem(LEGACY_OWNERLESS_TELEGRAM_STORAGE_KEY),
      ])).catch(() => {});

      // ── Start localStorage reads immediately (don't wait for connections) ──
      const storagePromise = Promise.all([
        runOfficeLayoutRequestWithDeadline(() => storage.getItem(privateStorageKeys.agentNames)).catch(() => null),
        runOfficeLayoutRequestWithDeadline(() => readVerifiedLocalSecret(
          OFFICE_TELEGRAM_SECRET_NAMESPACE,
          officeTelegramSecretId(currentUserId, circleId),
        )).catch(() => ({ status: 'unavailable' as const })),
        runOfficeLayoutRequestWithDeadline(() => storage.getItem(officeLayoutLocalCacheKey(currentUserId, circleId))).catch(() => null),
        runOfficeLayoutRequestWithDeadline(() => storage.getItem(privateStorageKeys.appearances)).catch(() => null),
        runOfficeLayoutRequestWithDeadline(() => storage.getItem(privateStorageKeys.whiteboardNotes)).catch(() => null),
        runOfficeLayoutRequestWithDeadline(() => storage.getItem(privateStorageKeys.telegramMetadata)).catch(() => null),
        runOfficeLayoutRequestWithDeadline(() => loadIdleConfigExact(idleSchedulerAuthority))
          .catch(() => getDefaultIdleConfig()),
      ]);

      // A scoped cache can make an authorized Office fast, but it cannot prove
      // authorization. Keep the whole private surface closed until this exact
      // bearer, user, circle, and lifecycle generation has a membership row.
      const membership = await verifyOfficeCircleMembership(
        circleId,
        {
          userId: requestedAuthScope.userId,
          circleId,
          accessToken: requestedAuthScope.accessToken,
          authorityGeneration: requestedAuthorityGeneration || 0,
        },
        requestIsCurrent,
      );
      if (!requestIsCurrent()) return;
      if (!membership.ok) {
        setOfficeAccessError(membership.error);
        setFloorLayoutSaveState('error');
        setFloorLayoutSaveDetail(membership.error);
        return;
      }
      membershipProven = true;
      setOfficeAccessError(null);

      // ── Load only this captured account/circle connection lane ──
      // Connection discovery is enrichment, never a layout-hydration
      // dependency. The owner-global auto-connect singleton is deliberately
      // excluded because its records cannot prove Office account custody.
      const connectionAuthority: OfficeConnectionExactAuthority = {
        userId: requestedAuthScope.userId,
        circleId,
        accessToken: requestedAuthScope.accessToken,
        generation: requestedAuthorityGeneration || 0,
      };
      void (async () => {
        const loaded = await runOfficeLayoutRequestWithDeadline(() => (
          loadOfficeConnectionsExact(connectionAuthority, isOfficeAuthorityCurrent)
        ));
        if (!requestIsCurrent()) return;
        let scopedConnections = loaded.ok ? loaded.connections : [];
        const { discovered } = await runOfficeLayoutRequestWithDeadline(() => (
          autoDiscoverLocalAgents(scopedConnections)
        ));
        if (!requestIsCurrent()) return;
        if (discovered) {
          const existingOpenSwan = scopedConnections.find(connection => connection.provider === 'openswan');
          if (existingOpenSwan?.token) discovered.token = existingOpenSwan.token;
          const saved = await saveOfficeConnectionsExact(
            [...scopedConnections, discovered],
            connectionAuthority,
            isOfficeAuthorityCurrent,
          );
          if (!requestIsCurrent()) return;
          if (saved.ok && saved.localSaved) scopedConnections = saved.connections;
        }
        if (!requestIsCurrent()) return;
        connectionsAuthorityRef.current = connectionAuthority;
        setConnections(scopedConnections);
        for (const connection of scopedConnections) {
          if (connection.enabled && !shouldSkipOpenSwanConnectionAttempt(connection)) {
            void connectOne(connection, connectionAuthority);
          }
        }
      })().catch((error) => {
        if (__DEV__ && requestIsCurrent()) {
          console.warn('[OfficeTab] Exact connection enrichment failed:', error);
        }
      });

      // ── Await localStorage reads (started earlier, runs in parallel with connections) ──
      const [
        namesRaw,
        telegramSecretResult,
        layoutCacheRaw,
        appearancesRaw,
        notesRaw,
        telegramMetadataRaw,
        exactLocalIdleConfig,
      ] = await storagePromise;
      if (!requestIsCurrent()) return;

      // Apply exact-scope local state immediately. Telegram authority is
      // accepted only from verified encrypted device storage.
      const localAgentNames = namesRaw ? (() => { try { return JSON.parse(namesRaw) as Record<string, string>; } catch { return {}; } })() : {};
      const localTelegramBotToken = telegramSecretResult.status === 'found'
        ? telegramSecretResult.value
        : '';
      const localWhiteboardNotes = notesRaw ? (() => { try { return JSON.parse(notesRaw) as string[]; } catch { return []; } })() : [];
      const localTelegramMetadata = telegramMetadataRaw ? (() => {
        try {
          const parsed = JSON.parse(telegramMetadataRaw) as { chatId?: unknown; botName?: unknown };
          return {
            chatId: typeof parsed.chatId === 'string' ? parsed.chatId.slice(0, 200) : '',
            botName: typeof parsed.botName === 'string' ? parsed.botName.slice(0, 200) : '',
          };
        } catch {
          return { chatId: '', botName: '' };
        }
      })() : { chatId: '', botName: '' };
      if (Object.keys(localAgentNames).length > 0) setAgentNames(localAgentNames);
      if (localTelegramBotToken || localTelegramMetadata.chatId) {
        setTelegramConfig({
          botToken: localTelegramBotToken,
          chatId: localTelegramMetadata.chatId,
        });
      }
      if (localTelegramMetadata.botName) setTelegramBotName(localTelegramMetadata.botName);
      if (localWhiteboardNotes.length > 0) setWhiteboardNotes(localWhiteboardNotes);

      // Parse local floors
      const localLayout = readOfficeLayoutLocalCacheEnvelope(layoutCacheRaw, currentUserId, circleId);
      let localFloors: OfficeFloor[] = localLayout?.floors || [];
      let localCurrentFloorId = localLayout?.currentFloorId || '';
      const localUpdatedAt = localLayout?.updatedAt || 0;

      // Parse local appearances
      const localAppearances = appearancesRaw ? (() => { try { return JSON.parse(appearancesRaw); } catch { return {}; } })() : {};

      // Apply the exact-scope cache only after current membership was proven.
      // Remote preferences/layout can continue in parallel behind that proof.
      setAppearances(localAppearances);
      if (localFloors.length > 0) {
        officeEditorHistoriesRef.current = {};
        setOfficeEditorHistoryRevision((revision) => revision + 1);
        floorsRef.current = localFloors;
        setFloors(localFloors);
      }
      if (localCurrentFloorId) setCurrentFloorId(localCurrentFloorId);

      // ── One app-owned auth identity + parallel scoped server reads ──
      let bestFloors = localFloors;
      let bestFloorId = localCurrentFloorId;
      let remoteLayoutUpdatedAt = 0;
      let remotePrefsRecord: Record<string, unknown> | null = null;
      let remoteIdleConfigValue: unknown = null;
      let hasRemoteIdleConfig = false;
      let idlePreferencesResolved = false;
      try {
        if (requestIsCurrent()) {
          // Layout authority and private preference enrichment are independent:
          // an optional preference timeout never discards a valid layout read.
          const layoutP = loadOfficeLayoutState(circleId, requestedAuthScope);
          const prefsP = officeUserPreferencesAvailableRef.current
            ? loadOfficeUserPreferences(circleId, requestedAuthScope)
            : Promise.resolve({ ok: false, preferences: null, revision: 0, unavailable: true });

          const [layoutRes, prefsResult] = await Promise.all([
            layoutP,
            prefsP.then(
              (value) => ({ status: 'fulfilled' as const, value }),
              (reason) => ({ status: 'rejected' as const, reason }),
            ),
          ]);
          if (!requestIsCurrent()) return;
          authoritativeLayoutReadRef.current = layoutRes.ok;
          // Private preference enrichment is optional. A timeout must not discard a
          // successful authoritative layout read or force the editor into
          // local-only mode.
          const prefsRes = prefsResult.status === 'fulfilled'
            ? prefsResult.value
            : { ok: false, preferences: null, revision: 0, error: String(prefsResult.reason || '') };
          idlePreferencesResolved = prefsRes.ok === true;

          // Merge floors
          if (!layoutRes.ok) {
            setFloorLayoutSaveState('error');
            setFloorLayoutSaveDetail(layoutRes.error || 'Server layout unavailable. Local backup is still active.');
          } else if (layoutRes.layout) {
            const remote = layoutRes.layout;
            layoutVersionRef.current = Math.max(layoutVersionRef.current, layoutRes.version, remote.updatedAt || 0);
            setFloorLayoutSaveState('saved');
            setFloorLayoutSaveDetail('Saved to this circle');
            if (remote.floors.length > 0) {
              const remoteUpdatedAt = remote.updatedAt || layoutRes.version || 0;
              remoteLayoutUpdatedAt = remoteUpdatedAt;
              // The server row is authoritative for an equal version too. Item
              // count is not a conflict resolver: a valid deletion may have
              // fewer items than a divergent local snapshot.
              const useRemote = remoteUpdatedAt >= localUpdatedAt;
              if (useRemote) {
                bestFloors = remote.floors;
                bestFloorId = remote.currentFloorId || localCurrentFloorId;
              }
            }
          }

          // Merge owner-and-circle private preferences. The peer-readable
          // profiles.office_preferences blob is intentionally never read.
          if (!prefsRes.ok) {
            if (prefsRes.unavailable) officeUserPreferencesAvailableRef.current = false;
          } else if (prefsRes.preferences) {
            remotePrefsRecord = prefsRes.preferences;
            const remote = prefsRes.preferences as {
              agentNames?: Record<string, string>;
              telegramMetadata?: { chatId?: string; botName?: string };
              whiteboardNotes?: string[];
              budgetConfig?: BudgetConfig;
              idleConfig?: IdleBehaviorConfig;
              agentFilterMode?: AgentFilterMode;
              appearances?: Record<string, AgentAppearance>;
            };
            if (remote.appearances && typeof remote.appearances === 'object') {
              setAppearances({ ...localAppearances, ...remote.appearances });
            }
            // Remote agent names override local (more durable)
            if (remote.agentNames && Object.keys(remote.agentNames).length > 0) {
              const localNames = namesRaw ? (() => { try { return JSON.parse(namesRaw); } catch { return {}; } })() : {};
              setAgentNames({ ...localNames, ...remote.agentNames });
            }
            // Only non-secret Telegram metadata is durable server state. The
            // bot token remains the exact encrypted device value loaded above.
            if (remote.telegramMetadata?.chatId || remote.telegramMetadata?.botName) {
              setTelegramConfig({
                botToken: localTelegramBotToken,
                chatId: remote.telegramMetadata.chatId || '',
              });
              setTelegramBotName(remote.telegramMetadata.botName || null);
            }
            // Remote whiteboard notes override local if non-empty
            if (remote.whiteboardNotes && remote.whiteboardNotes.length > 0) {
              setWhiteboardNotes(remote.whiteboardNotes);
            }
            // Remote budget config — overrides local. Set the loaded ref
            // BEFORE setBudgetConfig so the save useEffect doesn't fire
            // and re-write what we just loaded.
            if (remote.budgetConfig && typeof remote.budgetConfig === 'object') {
              remoteBudgetAppliedRef.current = true;
              budgetLoadedRef.current = true;
              setBudgetConfig(remote.budgetConfig);
            }
            // Remote settings remain primary. Reconciliation with the exact
            // local run receipt happens once below, after every source settles.
            if (remote.idleConfig && typeof remote.idleConfig === 'object') {
              remoteIdleConfigValue = remote.idleConfig;
              hasRemoteIdleConfig = true;
            }
            // Agent filter mode (which subset of agents the user
            // wants to see — mine / all / active / bonded).
            if (remote.agentFilterMode &&
                ['all', 'mine', 'active', 'bonded'].includes(remote.agentFilterMode)) {
              setAgentFilterMode(remote.agentFilterMode);
            }
          }

          // ── Seed-up: if the columns became available this session but
          //    the server has no copy yet, push the local snapshot up so
          //    the user doesn't have to touch anything to back up. Covers
          //    the case where the user customized for weeks while the
          //    migration was missing — first reload after applying it
          //    now syncs without any further user action.
          const serverNeedsCircleLayout = layoutRes.ok
            && (layoutRes.source === 'none' || localUpdatedAt > remoteLayoutUpdatedAt)
            && bestFloors.length > 0;
          if (serverNeedsCircleLayout) {
            const seedVersion = Math.max(Date.now(), layoutVersionRef.current + 1, localUpdatedAt + 1);
            layoutVersionRef.current = seedVersion;
            const seedLayout = { floors: bestFloors, currentFloorId: bestFloorId, updatedAt: seedVersion };
            const validation = validateOfficeLayout(seedLayout);
            if (validation.valid && validation.sanitizedLayout) {
              const localBackupVerified = await enqueueVerifiedLocalLayoutSave({
                userId: currentUserId,
                circleId,
                floors: validation.sanitizedLayout.floors as OfficeFloor[],
                currentFloorId: validation.sanitizedLayout.currentFloorId,
                updatedAt: seedVersion,
              });
              if (!requestIsCurrent()) return;
              const result = await saveOfficeLayoutState(
                circleId,
                validation.sanitizedLayout,
                seedVersion,
                requestedAuthScope,
              );
              if (!requestIsCurrent()) return;
              if (result.ok) {
                setFloorLayoutSaveState('saved');
                setFloorLayoutSaveDetail('Saved to this circle');
              } else {
                if (result.conflict) authoritativeLayoutReadRef.current = false;
                queueLatestOfficeLayoutSave({
                  pending: pendingLayoutSaveRef,
                  active: activeLayoutSaveRef,
                }, {
                  scope: floorLayoutScope,
                  circleId,
                  layout: validation.sanitizedLayout as OfficeLayoutDocument,
                  version: seedVersion,
                  localBackupVerified,
                  mutationEpoch: floorLayoutMutationEpochRef.current,
                  authScope: requestedAuthScope,
                });
                setFloorLayoutSaveState('error');
                setFloorLayoutSaveDetail(result.error || 'Server backup failed.');
              }
            }
          }
          // Ownerless identity storage has no proof of which account created
          // it, so it is never uploaded automatically during auth hydration.
        }
      } catch {
        authoritativeLayoutReadRef.current = false;
        setFloorLayoutSaveState('error');
        setFloorLayoutSaveDetail('Server layout could not be checked. Local editing is available, but server sync is paused until retry.');
      }

      if (!requestIsCurrent()) return;

      if (idlePreferencesResolved) {
        const normalizedLocalIdleConfig = normalizeIdleConfig(exactLocalIdleConfig);
        const hydratedIdleConfig = hasRemoteIdleConfig
          ? mergeRemoteIdleConfigWithExactRunHistory(
              remoteIdleConfigValue,
              normalizedLocalIdleConfig,
            )
          : normalizedLocalIdleConfig;
        // A remote read owns toggles/cooldowns/opt-in. Skip the hydration echo;
        // later user changes and scheduler receipts still persist normally.
        remoteIdleAppliedRef.current = hasRemoteIdleConfig;
        idleLoadedRef.current = true;
        idleConfigRef.current = hydratedIdleConfig;
        setIdleConfig(hydratedIdleConfig);
        setIdleConfigReadyAuthorityKey(idleConfigAuthorityKey(idleSchedulerAuthority));
      }

      appearancesLoadedRef.current = true;
      prefsLoadedRef.current = true;
      if (officeUserPreferencesAvailableRef.current) {
        const seedPrefs: Record<string, unknown> = {};
        if (!remotePrefsRecord?.agentNames && Object.keys(localAgentNames).length > 0) {
          seedPrefs.agentNames = localAgentNames;
        }
        if (!remotePrefsRecord?.appearances && Object.keys(localAppearances).length > 0) {
          seedPrefs.appearances = localAppearances;
        }
        if (!remotePrefsRecord?.whiteboardNotes && localWhiteboardNotes.length > 0) {
          seedPrefs.whiteboardNotes = localWhiteboardNotes;
        }
        if (
          !remotePrefsRecord?.telegramMetadata
          && (localTelegramMetadata.chatId || localTelegramMetadata.botName)
        ) {
          seedPrefs.telegramMetadata = localTelegramMetadata;
        }
        if (!remotePrefsRecord?.agentFilterMode && agentFilterMode !== 'all') {
          seedPrefs.agentFilterMode = agentFilterMode;
        }
        if (Object.keys(seedPrefs).length > 0) pushOfficePreferences(seedPrefs);
      }

      // Apply floors
      if (bestFloors.length > 0) {
        officeEditorHistoriesRef.current = {};
        setOfficeEditorHistoryRevision((revision) => revision + 1);
        floorsRef.current = bestFloors;
        setFloors(bestFloors);
      }
      if (bestFloorId) setCurrentFloorId(bestFloorId);
      if (bestFloors.length > 0 && bestFloorId) {
        const localVersion = Math.max(1, layoutVersionRef.current, localUpdatedAt, remoteLayoutUpdatedAt);
        void enqueueVerifiedLocalLayoutSave({
          userId: currentUserId,
          circleId,
          floors: bestFloors,
          currentFloorId: bestFloorId,
          updatedAt: localVersion,
        });
      }
      // Make the persistence gate reactive. A ref-only transition could leave
      // edits made during hydration permanently unsaved because no effect was
      // guaranteed to run after the async merge finished.
      floorsInitializedRef.current = true;
      // Reconciliation itself is not a user mutation. A successful no-row
      // load is seeded explicitly above; otherwise the first post-hydration
      // render must not churn versions or overwrite failed server authority.
      skipNextLayoutPersistenceRef.current = true;
      setFloorLayoutHydratedCircleId(requestedScope);
      markOfficeReady();

      // ── Finish non-persistent enrichment after first paint / idle time ──
      const cancelDeferredEnrichment = runWhenIdle(() => {
        const storageScope = { userId: currentUserId, circleId };
        Promise.all([
          loadSessionTags(storageScope),
          loadCachedTags(storageScope),
        ]).then(([primaryTags, cachedTags]) => {
          if (!requestIsCurrent()) return;
          const merged = new Map(cachedTags);
          primaryTags.forEach((tags, key) => { merged.set(key, tags); });
          setSessionTags(merged);
        }).catch(() => {});

        // The budget legacy browser key is ownerless and cannot prove which
        // account created it, so it is never imported. Idle readiness is not a
        // deferred ref flip: it was committed reactively above only after the
        // exact local and remote preference sources resolved.
        budgetLoadedRef.current = true;
      }, 350);

      (initRef as any)._cancelDeferredEnrichment = cancelDeferredEnrichment;
    })().catch(() => {
      if (!requestIsCurrent()) return;
      if (!membershipProven) {
        const message = 'The circle access check could not be completed. Check your connection and retry.';
        setOfficeAccessError(message);
        setFloorLayoutSaveState('error');
        setFloorLayoutSaveDetail(message);
        return;
      }
      authoritativeLayoutReadRef.current = false;
      floorsInitializedRef.current = true;
      skipNextLayoutPersistenceRef.current = true;
      setFloorLayoutSaveState('error');
      setFloorLayoutSaveDetail('Office layout initialization timed out. Local editing is available; retry server sync when the connection recovers.');
      setFloorLayoutHydratedCircleId(requestedScope);
      markOfficeReady();
    });

    return () => {
      cancelled = true;
      (initRef as any)._cancelDeferredEnrichment?.();
      pollersRef.current.forEach((poller, connectionId) => {
        pollerGenerationsRef.current.set(
          connectionId,
          (pollerGenerationsRef.current.get(connectionId) || 0) + 1,
        );
        poller.stop();
      });
      pollersRef.current.clear();
      sessionsRef.current.clear();
      sessionFingerprintsRef.current.clear();
    };
    // This boot path owns long-lived subscriptions/pollers. Re-running it for
    // callback identity churn tears down the Office runtime, so restart only
    // for an exact authority generation, circle, or explicit access retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, circleId, committedAuthAuthority, committedAuthScopeKey, currentUserId, enqueueVerifiedLocalLayoutSave, floorLayoutScope, officeAccessRetry, privateStorageKeys]);

  // Membership is a lease, not a one-time boot fact. Realtime changes are
  // invalidation signals and a bounded poll covers missed DELETE events or a
  // suspended tab. Loss of proof retires the exact generation before private
  // state is cleared, so delayed callbacks can no longer apply or mutate.
  useEffect(() => {
    const requestedAuthority = committedAuthAuthority;
    if (
      !requestedAuthority
      || !floorLayoutHydrated
      || officeAccessError
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return undefined;

    let cancelled = false;
    let checking = false;
    const requestIsCurrent = () => (
      !cancelled && isOfficeAuthorityCurrent(requestedAuthority)
    );
    const retirePrivateOffice = (message: string) => {
      if (!requestIsCurrent()) return;
      authAuthorityGenerationRef.current += 1;
      if (authAuthorityRef.current?.generation === requestedAuthority.generation) {
        authAuthorityRef.current = null;
      }
      setCommittedAuthAuthority((current) => (
        current?.generation === requestedAuthority.generation ? null : current
      ));
      initRef.current = null;
      setFloorLayoutHydratedCircleId(null);
      setIdleConfigReadyAuthorityKey(null);
      idleLoadedRef.current = false;
      setOfficeAccessError(message);
      setComputerTaskCard(null);
      setOfficeAgentPlans([]);
      setStatusHistory([]);
      pollersRef.current.forEach((poller, connectionId) => {
        pollerGenerationsRef.current.set(
          connectionId,
          (pollerGenerationsRef.current.get(connectionId) || 0) + 1,
        );
        poller.stop();
      });
      pollersRef.current.clear();
      sessionsRef.current.clear();
      sessionFingerprintsRef.current.clear();
      connectionsAuthorityRef.current = null;
      connectionsRef.current = [];
      setConnections([]);
      setCircleOfficeAgents([]);
      setLiveUserIds(new Set());
      setCircleConnectionStatus('offline');
    };
    const revalidateMembership = async () => {
      if (checking || !requestIsCurrent()) return;
      checking = true;
      try {
        const result = await verifyOfficeCircleMembership(
          requestedAuthority.circleId,
          toOfficeDashboardAuthority(requestedAuthority),
          requestIsCurrent,
        );
        if (requestIsCurrent() && !result.ok) retirePrivateOffice(result.error);
      } finally {
        checking = false;
      }
    };

    const timer = setInterval(() => { void revalidateMembership(); }, 45_000);
    const membershipSubscription = subscribeWithReconnect({
      channelName: `office-membership-lease:${requestedAuthority.userId}:${requestedAuthority.circleId}:${requestedAuthority.generation}`,
      setup: (channel) => channel.on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'circle_members',
        filter: `circle_id=eq.${requestedAuthority.circleId}`,
      }, () => { void revalidateMembership(); }),
      onCatchUp: () => { void revalidateMembership(); },
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      membershipSubscription.unsubscribe();
    };
  }, [committedAuthAuthority, floorLayoutHydrated, isOfficeAuthorityCurrent, officeAccessError]);

  // Adaptive Office preferences and counters are private user+circle data.
  // Start only after membership-backed Office hydration, and fence every
  // async read/write to the captured bearer and lifecycle generation.
  useEffect(() => {
    let cancelled = false;
    const requestedAuthority = captureOfficeAuthority();
    if (
      !floorLayoutHydrated
      || officeAccessError
      || !requestedAuthority
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return () => { cancelled = true; };
    const requestIsCurrent = (candidate: OfficeExactAuthority) => (
      !cancelled && isOfficeAuthorityCurrent(candidate)
    );
    void Promise.all([
      loadCircleWorkspaceProfileExact(requestedAuthority, requestIsCurrent),
      loadAdaptiveWorkspaceSettingsExact(requestedAuthority, requestIsCurrent),
    ]).then(([profileResult, settingsResult]) => {
      if (
        !requestIsCurrent(requestedAuthority)
        || !profileResult.ok
        || !profileResult.profile
        || !settingsResult.ok
        || !settingsResult.settings
      ) return;
      const adaptive = getAdaptiveOfficeDefaults(profileResult.profile, settingsResult.settings);
      setTerminalInitialTab(adaptive.terminalInitialTab);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [
    captureOfficeAuthority,
    floorLayoutHydrated,
    isOfficeAuthorityCurrent,
    officeAccessError,
    setTerminalInitialTab,
  ]);

  const recordAdaptiveOfficeActivity = useCallback((
    kind: Parameters<typeof recordOfficeActivityExact>[1],
  ) => {
    if (!floorLayoutHydrated || officeAccessError) return;
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return;
    void recordOfficeActivityExact(
      requestedAuthority,
      kind,
      isOfficeAuthorityCurrent,
    ).catch(() => {});
  }, [captureOfficeAuthority, floorLayoutHydrated, isOfficeAuthorityCurrent, officeAccessError]);

  useEffect(() => {
    if (!selectedAgent) return;
    recordAdaptiveOfficeActivity('select_agent');
    recordAdaptiveOfficeActivity('runtime');
  }, [recordAdaptiveOfficeActivity, selectedAgent]);

  useEffect(() => {
    if (editMode || placingType || selectedFurnitureId) {
      recordAdaptiveOfficeActivity('workspace');
    }
  }, [editMode, placingType, recordAdaptiveOfficeActivity, selectedFurnitureId]);

  useEffect(() => {
    if (showGitHubFeed || showSoundMixer || showVault) {
      recordAdaptiveOfficeActivity('intelligence');
    }
  }, [recordAdaptiveOfficeActivity, showGitHubFeed, showSoundMixer, showVault]);

  useEffect(() => {
    if (terminalSize === 'closed') return;
    recordAdaptiveOfficeActivity('runtime');
    recordAdaptiveOfficeActivity(
      terminalInitialTab === 'automations' ? 'terminal_automations' : 'terminal_commands',
    );
  }, [recordAdaptiveOfficeActivity, terminalInitialTab, terminalSize]);

  // Cleanup pollers on unmount
  useEffect(() => {
    return () => {
      pollersRef.current.forEach(p => p.stop());
      pollersRef.current.clear();
      if (tgPollerRef.current) tgPollerRef.current.stop();
    };
  }, [circleId]);

  // ─── Floor management (must be defined before useEffects that use it) ──────

  const flushPendingLayoutSave = useCallback(async () => {
    await drainLatestOfficeLayoutSaveQueue({
      pending: pendingLayoutSaveRef,
      active: activeLayoutSaveRef,
      inFlight: layoutSaveInFlightRef,
      drainRequested: layoutSaveDrainRequestedRef,
    }, {
      getActiveScope: () => layoutSaveScopeRef.current,
      save: async (pending): Promise<OfficeLayoutSaveResult> => {
        try {
          return await saveOfficeLayoutState(
            pending.circleId,
            pending.layout,
            pending.version,
            pending.authScope,
          );
        } catch {
          return {
            ok: false,
            version: pending.version,
            source: 'none',
            error: 'The Office server could not be reached.',
          };
        }
      },
      onSettled: ({ item: pending, result }) => {
        if (result.ok) {
          layoutVersionRef.current = Math.max(layoutVersionRef.current, result.version);
          // Never render SAVED for an older receipt while a newer verified
          // local edit is queued or still completing its local-cache write.
          if (
            !pendingLayoutSaveRef.current
            && layoutVersionRef.current === result.version
            && floorLayoutMutationEpochRef.current === pending.mutationEpoch
          ) {
            setFloorLayoutSaveState('saved');
            setFloorLayoutSaveDetail('Saved to this circle');
          }
          return;
        }
        if (result.conflict) {
          // Pause remote dispatch until Retry performs a fresh authoritative
          // read, but preserve any newer pending snapshot exactly as queued.
          authoritativeLayoutReadRef.current = false;
          if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
          layoutSaveTimerRef.current = null;
        }
        setFloorLayoutSaveState('error');
        const failure = result.error || 'Server backup failed.';
        setFloorLayoutSaveDetail(pending.localBackupVerified
          ? `${failure} Your verified local backup remains available.`
          : `${failure} The local backup could not be verified either.`);
      },
    });
  }, []);

  const handleRetryFloorLayoutSave = useCallback(async () => {
    const retryScope = floorLayoutScope;
    const retryAuthScope = authAuthorityRef.current;
    if (
      !retryScope
      || !retryAuthScope
      || retryAuthScope.userId !== currentUserId
      || layoutSaveScopeRef.current !== retryScope
    ) return;
    const retryStartVersion = layoutVersionRef.current;
    const retryStartFingerprint = JSON.stringify({
      floors: floorsRef.current,
      currentFloorId: currentFloorIdRef.current,
    });
    const retrySnapshotIsCurrent = () => (
      layoutSaveScopeRef.current === retryScope
      && layoutVersionRef.current === retryStartVersion
      && JSON.stringify({
        floors: floorsRef.current,
        currentFloorId: currentFloorIdRef.current,
      }) === retryStartFingerprint
    );
    const fresh = await loadOfficeLayoutState(circleId, retryAuthScope);
    if (!retrySnapshotIsCurrent()) {
      authoritativeLayoutReadRef.current = false;
      setFloorLayoutSaveState('error');
      setFloorLayoutSaveDetail('The Office changed while checking the server. Your edit was kept; retry once more to compare the latest snapshot.');
      return;
    }
    if (!fresh.ok) {
      authoritativeLayoutReadRef.current = false;
      setFloorLayoutSaveState('error');
      setFloorLayoutSaveDetail(fresh.error || 'Server layout could not be checked. Retry when the connection is available.');
      return;
    }
    const freshLayoutDiffers = Boolean(fresh.layout) && JSON.stringify({
      floors: fresh.layout!.floors,
      currentFloorId: fresh.layout!.currentFloorId,
    }) !== retryStartFingerprint;
    if (
      fresh.layout
      && (
        fresh.version > retryStartVersion
        || (fresh.version === retryStartVersion && freshLayoutDiffers)
      )
    ) {
      await enqueueVerifiedLocalLayoutSave({
        userId: currentUserId,
        circleId,
        floors: fresh.layout.floors,
        currentFloorId: fresh.layout.currentFloorId,
        updatedAt: fresh.version,
      });
      if (!retrySnapshotIsCurrent()) {
        authoritativeLayoutReadRef.current = false;
        setFloorLayoutSaveState('error');
        setFloorLayoutSaveDetail('The Office changed while restoring the server snapshot. Your edit was kept; retry to compare again.');
        return;
      }
      authoritativeLayoutReadRef.current = true;
      pendingLayoutSaveRef.current = null;
      layoutVersionRef.current = fresh.version;
      skipNextLayoutPersistenceRef.current = true;
      floorsRef.current = fresh.layout.floors;
      setFloors(fresh.layout.floors);
      setCurrentFloorId(fresh.layout.currentFloorId);
      setFloorLayoutSaveState('error');
      setFloorLayoutSaveDetail('A newer Office layout was loaded. Review it before making another edit.');
      return;
    }
    authoritativeLayoutReadRef.current = true;
    const waiting = pendingLayoutSaveRef.current;
    if (waiting && waiting.scope === retryScope) {
      // A successful fresh read proves the current session authority. Replace
      // only the captured credential on the exact pending snapshot so an
      // expired token cannot be replayed forever by Retry.
      queueLatestOfficeLayoutSave({
        pending: pendingLayoutSaveRef,
        active: activeLayoutSaveRef,
      }, { ...waiting, authScope: retryAuthScope });
    } else if (!waiting) {
      const version = Math.max(Date.now(), layoutVersionRef.current + 1);
      const retryMutationEpoch = floorLayoutMutationEpochRef.current;
      const validation = validateOfficeLayout({
        floors: floorsRef.current,
        currentFloorId: currentFloorIdRef.current,
        updatedAt: version,
      });
      if (!validation.valid || !validation.sanitizedLayout) {
        setFloorLayoutSaveState('error');
        setFloorLayoutSaveDetail(validation.errors[0] || 'Layout validation failed.');
        return;
      }
      layoutVersionRef.current = version;
      const localBackupVerified = await enqueueVerifiedLocalLayoutSave({
        userId: currentUserId,
        circleId,
        floors: validation.sanitizedLayout.floors as OfficeFloor[],
        currentFloorId: validation.sanitizedLayout.currentFloorId,
        updatedAt: version,
      });
      if (
        !retrySnapshotIsCurrent()
        || layoutSaveScopeRef.current !== retryScope
        || layoutVersionRef.current !== version
        || floorLayoutMutationEpochRef.current !== retryMutationEpoch
      ) return;
      queueLatestOfficeLayoutSave({
        pending: pendingLayoutSaveRef,
        active: activeLayoutSaveRef,
      }, {
        scope: retryScope,
        circleId,
        layout: validation.sanitizedLayout as OfficeLayoutDocument,
        version,
        localBackupVerified,
        mutationEpoch: retryMutationEpoch,
        authScope: retryAuthScope,
      });
    }
    setFloorLayoutSaveState('saving');
    setFloorLayoutSaveDetail('Retrying the latest floor, item, and tool snapshot…');
    void flushPendingLayoutSave();
  }, [circleId, currentUserId, enqueueVerifiedLocalLayoutSave, floorLayoutScope, flushPendingLayoutSave]);

  // Auto-persist every floor item/tool edit locally immediately, then coalesce
  // and serialize server writes. Monotonic versions plus the §37 RPC prevent an
  // older drag/update response from overwriting a newer floor snapshot.
  useEffect(() => {
    if (!floorLayoutHydrated || !floorsInitializedRef.current) return; // skip unmerged defaults
    if (skipNextLayoutPersistenceRef.current) {
      skipNextLayoutPersistenceRef.current = false;
      return;
    }
    const version = Math.max(Date.now(), layoutVersionRef.current + 1);
    layoutVersionRef.current = version;
    const mutationEpoch = floorLayoutMutationEpochRef.current;
    const persistenceAuthScope = authAuthorityRef.current;
    const layoutData = { floors, currentFloorId, updatedAt: version };
    const validation = validateOfficeLayout(layoutData);
    if (!validation.valid || !validation.sanitizedLayout) {
      console.warn('[OfficeTab] Layout validation failed, skipping save:', validation.errors);
      setFloorLayoutSaveState('error');
      setFloorLayoutSaveDetail(validation.errors[0] || 'Layout validation failed.');
      return;
    }
    let cancelled = false;
    void (async () => {
      const localBackupVerified = await enqueueVerifiedLocalLayoutSave({
        userId: currentUserId,
        circleId,
        floors: validation.sanitizedLayout.floors as OfficeFloor[],
        currentFloorId: validation.sanitizedLayout.currentFloorId,
        updatedAt: version,
      });
      if (
        cancelled
        || !persistenceAuthScope
        || persistenceAuthScope.userId !== currentUserId
        || layoutSaveScopeRef.current !== floorLayoutScope
        || layoutVersionRef.current !== version
      ) return;
      if (!authoritativeLayoutReadRef.current) {
        setFloorLayoutSaveState('error');
        setFloorLayoutSaveDetail(localBackupVerified
          ? 'Saved locally. Server sync is paused until a fresh layout check succeeds.'
          : 'Server sync is paused and the local backup could not be verified. Free device storage, then retry.');
        return;
      }
      queueLatestOfficeLayoutSave({
        pending: pendingLayoutSaveRef,
        active: activeLayoutSaveRef,
      }, {
        scope: floorLayoutScope!,
        circleId,
        layout: validation.sanitizedLayout as OfficeLayoutDocument,
        version,
        localBackupVerified,
        mutationEpoch,
        authScope: persistenceAuthScope,
      });
      if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = setTimeout(() => {
        layoutSaveTimerRef.current = null;
        void flushPendingLayoutSave();
      }, 350);
    })();
    return () => { cancelled = true; };
  }, [circleId, currentFloorId, currentUserId, enqueueVerifiedLocalLayoutSave, floorLayoutHydrated, floorLayoutScope, floors, flushPendingLayoutSave]);

  useEffect(() => () => {
    if (layoutSaveTimerRef.current) clearTimeout(layoutSaveTimerRef.current);
    layoutSaveTimerRef.current = null;
    pendingLayoutSaveRef.current = null;
  }, [circleId]);

  const { width: winW } = useWindowDimensions();
  const isDesktop = winW > 900;

  // Get current floor data with safety checks (must be before agent filtering)
  const matchedFloor = floors.find(f => f.id === currentFloorId);
  const currentFloor = matchedFloor || floors[0] || DEFAULT_FLOORS[0];
  const selectedFurniture = currentFloor.furniture.find((item) => item.id === selectedFurnitureId) || null;
  const currentThemeId = currentFloor?.themeId || 'underground';
  const currentTheme = useMemo(() => resolveTheme(currentThemeId), [resolveTheme, currentThemeId]);

  const refreshFloorPresets = useCallback(async () => {
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    const requestedAuthority = captureOfficeAuthority();
    if (!circleId || !currentUserId || !requestedScope || !requestedAuthority || layoutSaveScopeRef.current !== requestedScope) return;
    const requestId = ++floorPresetLoadRequestRef.current;
    const requestIsCurrent = () => (
      floorPresetLoadRequestRef.current === requestId
      && floorLayoutGenerationRef.current === requestedGeneration
      && layoutSaveScopeRef.current === requestedScope
      && isOfficeAuthorityCurrent(requestedAuthority)
    );
    setFloorPresetsLoading(true);
    try {
      const result = await listOfficeFloorPresets(
        circleId,
        toOfficeDashboardAuthority(requestedAuthority),
        requestIsCurrent,
      );
      if (!requestIsCurrent()) return;
      if (result.ok) {
        setFloorPresets(result.presets);
        setFloorPresetStatus(result.presets.length === 0 ? 'No saved floor presets yet.' : null);
      } else {
        setFloorPresets([]);
        setFloorPresetStatus(result.error || 'Floor presets are unavailable.');
      }
    } catch {
      if (!requestIsCurrent()) return;
      setFloorPresets([]);
      setFloorPresetStatus('The Office server could not load floor presets.');
    } finally {
      if (requestIsCurrent()) setFloorPresetsLoading(false);
    }
  }, [captureOfficeAuthority, circleId, currentUserId, floorLayoutScope, isOfficeAuthorityCurrent]);

  useEffect(() => {
    setFloorPresets([]);
    setFloorPresetStatus(null);
    void refreshFloorPresets();
  }, [refreshFloorPresets]);

  // Fix stale currentFloorId that doesn't match any floor
  useEffect(() => {
    if (!matchedFloor && floors.length > 0) {
      const correctId = floors[0].id;
      setCurrentFloorId(correctId);
    }
  }, [matchedFloor, floors]);

  // Derive agents from ALL connected sessions
  const connectedConns = connections.filter(c => c.status === 'connected');
  const anyConnected = connectedConns.length > 0;

  const rawAgents: OfficeAgent[] = [];
  const seenSessionIds = new Set<string>();
  let indexOffset = 0;
  for (const conn of connectedConns) {
    const sessions = sessionsRef.current.get(conn.id) || [];
    const connAgents = sessionsToAgents(sessions, conn.id, conn.name, conn.provider);
    for (const a of connAgents) {
      const sessionIdentity = `${a.connectionId}::${a.sessionKey}`;
      if (!seenSessionIds.has(sessionIdentity)) {
        seenSessionIds.add(sessionIdentity);
        rawAgents.push(a);
      }
    }
    indexOffset += connAgents.length;
  }
  // Merge auto-detected sessions by exact connection + session identity. Session
  // keys are provider-local and may legitimately repeat on different bridges.
  // when the same bridge is connected both manually and via auto-detect
  const autoKeys = ['claude-code-auto', 'codex-auto', 'gemini-cli-auto', 'cursor-auto'] as const;
  for (const key of autoKeys) {
    const autoAgents = sessionsRef.current.get(key) as unknown as OfficeAgent[] | undefined;
    if (autoAgents && autoAgents.length > 0) {
      for (const a of autoAgents) {
        const sessionIdentity = `${a.connectionId}::${a.sessionKey}`;
        if (!seenSessionIds.has(sessionIdentity)) {
          seenSessionIds.add(sessionIdentity);
          rawAgents.push(a);
        }
      }
    }
  }

  // Merge DB-backed agents that have no corresponding live session
  // Only show if active within the last 2 hours — stale agents are hidden
  // Skip if a live agent already exists for this provider (prevents ghost duplicates)
  const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
  const now = Date.now();
  const liveAgentNames = new Set(rawAgents.map(a => a.name));
  const liveProviders = new Set(rawAgents.map(a => a.providerType));
  const myDbAgents = mergedCircleAgents.filter(a => {
    if (a.ownerId !== currentUserId) return false;
    if (liveAgentNames.has(a.name)) return false;
    // Skip if there's already a live agent for this provider type
    if (a.provider && liveProviders.has(a.provider as any)) return false;
    // Filter out stale agents — if no lastActiveAt or too old, hide them
    if (!a.lastActiveAt) return false;
    const age = now - new Date(a.lastActiveAt).getTime();
    return age < STALE_THRESHOLD_MS;
  });
  for (const dbAgent of myDbAgents) {
    rawAgents.push({
      id: `db::${dbAgent.id}`,
      name: dbAgent.name,
      role: dbAgent.provider || 'Agent',
      status: dbAgent.status,
      color: dbAgent.color,
      deskIndex: rawAgents.length,
      activity: dbAgent.currentTask || 'Idling',
      messagesProcessed: dbAgent.message_count_total || 0,
      uptimeHours: 0,
      uptime: '',
      lastActive: dbAgent.lastActiveAt || '',
      recentActions: [],
      recentMessages: [],
      costToday: dbAgent.estimated_cost_today || 0,
      costTotal: dbAgent.estimated_cost_total || 0,
      costWeek: 0,
      tokensUsed: dbAgent.token_usage_total || 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      newTokens: 0,
      turns: dbAgent.message_count_total || 0,
      sessionKey: dbAgent.id,
      model: 'unknown',
      connectionId: 'db-agent',
      connectionName: dbAgent.name,
      providerType: (dbAgent.provider || 'generic-agent') as ProviderType,
      spirit: dbAgent.spirit ?? undefined,
    });
  }

  // Enrich live agents from one durable Circle Office row. Exact name/id wins;
  // provider fallback is allowed only when both the live provider and DB row
  // are singular. This keeps cost attribution deterministic across reloads and
  // prevents multiple same-provider sessions from inheriting one aggregate.
  const ownDbCostRows = mergedCircleAgents.filter(a => a.ownerId === currentUserId);
  const liveProviderAgentCounts = new Map<ProviderType, number>();
  for (const agent of rawAgents) {
    if (agent.connectionId === 'db-agent') continue;
    liveProviderAgentCounts.set(
      agent.providerType,
      (liveProviderAgentCounts.get(agent.providerType) || 0) + 1,
    );
  }
  for (const agent of rawAgents) {
    const dbMatch = findDurableOfficeAgentCost(agent, ownDbCostRows, {
      liveProviderAgentCount: liveProviderAgentCounts.get(agent.providerType) || 0,
    });
    if (dbMatch) {
      if (!agent.spirit && dbMatch.spirit) agent.spirit = dbMatch.spirit;
    }
    Object.assign(agent, applyDurableOfficeAgentCost(agent, dbMatch));
  }

  // Apply custom names
  const allAgents = useMemo(() =>
    rawAgents.map(a => agentNames[a.id] ? { ...a, name: agentNames[a.id] } : a),
    [rawAgents, agentNames]
  );

  // Use enriched agents if available (has cached costs/tokens), fallback to fresh agents
  const userAgents = useMemo(() => {
    if (enrichedAgents.length === 0) {
      return allAgents.map(agent => applyIdentityToAgent(agent, getAgentIdentityByAgent(agentIdentities, agent)));
    }
    const enrichedById = new Map(enrichedAgents.map(agent => [agent.id, agent]));
    return allAgents.map(agent => {
      const enriched = enrichedById.get(agent.id);
      const identity = getAgentIdentityByAgent(agentIdentities, agent);
      if (!enriched) return applyIdentityToAgent(agent, identity);
      const hydrated = applyIdentityToAgent({ ...enriched, ...agent }, identity);
      return {
        ...hydrated,
        recentActions: enriched.recentActions,
        recentMessages: enriched.recentMessages,
        cachedTokens: enriched.cachedTokens,
        newTokens: enriched.newTokens,
      };
    });
  }, [agentIdentities, allAgents, enrichedAgents]);

  useEffect(() => {
    enrichedAgentsRef.current = userAgents;
  }, [userAgents]);

  useEffect(() => {
    if (!isDesktop) return;
    const warmModules = () => {
      if (!whiteboardModule) import('./office/Whiteboard').then(setWhiteboardModule).catch(() => {});
      if (!serverRackModule) import('./office/ServerRack').then(setServerRackModule).catch(() => {});
    };
    const idleHost = globalThis as any;
    if (typeof idleHost.requestIdleCallback === 'function') {
      const id = idleHost.requestIdleCallback(() => warmModules(), { timeout: 700 });
      return () => {
        if (typeof idleHost.cancelIdleCallback === 'function') idleHost.cancelIdleCallback(id);
      };
    }
    const timeoutId = setTimeout(warmModules, 180);
    return () => clearTimeout(timeoutId);
  }, [isDesktop, whiteboardModule, serverRackModule]);

  useEffect(() => {
    if (terminalSize === 'closed' || officeTerminalModule) return;
    import('../../../components/OfficeTerminal').then(setOfficeTerminalModule).catch(() => {});
  }, [terminalSize, officeTerminalModule]);

  const refreshAgentIdentities = useCallback(async () => {
    const refreshGeneration = agentIdentityRefreshGenerationRef.current + 1;
    agentIdentityRefreshGenerationRef.current = refreshGeneration;
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority) return false;
    const refreshIsCurrent = () => (
      refreshGeneration === agentIdentityRefreshGenerationRef.current
      && isOfficeAuthorityCurrent(requestedAuthority)
    );
    try {
      const localIdentities = await loadAgentIdentitiesExact(requestedAuthority);
      if (!refreshIsCurrent()) return false;
      const serverResult = await refreshAgentIdentitiesFromServerExact(
        requestedAuthority,
        isOfficeAuthorityCurrent,
      );
      if (!refreshIsCurrent()) return false;

      const identities = resolveAgentIdentityRefreshSnapshot(localIdentities, serverResult);
      if (!refreshIsCurrent()) return false;
      setAgentIdentities(identities);
      return serverResult.serverVerified;
    } catch {
      return false;
    }
  }, [captureOfficeAuthority, isOfficeAuthorityCurrent]);

  useEffect(() => {
    const requestedAuthority = committedAuthAuthority;
    if (
      Platform.OS !== 'web'
      || typeof window === 'undefined'
      || !requestedAuthority
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return;
    const exactStorageKey = agentIdentityExactStorageKey(requestedAuthority);
    if (!exactStorageKey) return;
    let retired = false;
    let loadGeneration = 0;
    const onExactIdentityStorage = (event: StorageEvent) => {
      if (event.key !== exactStorageKey || event.newValue === null) return;
      const generation = loadGeneration + 1;
      loadGeneration = generation;
      void loadAgentIdentitiesExact(requestedAuthority, isOfficeAuthorityCurrent).then((identities) => {
        if (
          retired
          || generation !== loadGeneration
          || !isOfficeAuthorityCurrent(requestedAuthority)
        ) return;
        // Exact writers publish only a count-complete server snapshot under
        // the cross-realm lock. Adopting that cache here is read-only and does
        // not write storage again, so tabs converge without an event loop.
        setAgentIdentities(identities);
      });
    };
    window.addEventListener('storage', onExactIdentityStorage);
    return () => {
      retired = true;
      loadGeneration += 1;
      window.removeEventListener('storage', onExactIdentityStorage);
    };
  }, [committedAuthAuthority, isOfficeAuthorityCurrent]);

  const userAgentsStatusKey = useMemo(() => JSON.stringify(userAgents.map(agent => [
    agent.id,
    agent.status,
    agent.lastActive || '',
    agent.messagesProcessed || 0,
    agent.turns || 0,
  ])), [userAgents]);
  const userAgentsMetricsKey = useMemo(() => JSON.stringify(userAgents.map(agent => [
    agent.id,
    agent.status,
    agent.lastActive || '',
    agent.messagesProcessed || 0,
    agent.turns || 0,
    agent.costToday || 0,
    agent.costWeek || 0,
    agent.tokensUsed || 0,
    agent.inputTokens || 0,
    agent.outputTokens || 0,
  ])), [userAgents]);
  const displayAgents = useMemo(() => {
    const roster = buildOfficeRoster({
      agents: userAgents,
      currentUserId,
      circleAgents: mergedCircleAgents,
      connections,
      identities: agentIdentities,
      selectedAgentId: selectedAgent?.id || null,
    });
    // O8: synthetic pinned agents (OpenSwan; HuggingSwan if ever re-pinned)
    // have no session/bridge feeding their status, so mid-task they'd keep a
    // static default. Live agent_runs rows are authoritative evidence of work
    // (the Building-Now board renders the same nodes), so UPGRADE-only:
    // idle → building/active, building → active, activity → "Working: <run>".
    // No evidence and offline/error rows pass through untouched — see
    // officeOpsBoard.deriveSyntheticAgentStatusFromRuns (mirror image of the
    // O2 demote-only reconcile). Matching uses the same name/subject-key map
    // as roster live ops below.
    if (opsRunNodesByAgent.size === 0) return roster;
    const nowMs = Date.now();
    return roster.map((agent) => {
      if (!agent.isSynthetic) return agent;
      const nameKeys =
        agent.id === DEFAULT_AGENT.id ? OPENSWAN_RUN_NAME_KEYS
        : agent.id === HUGGINGSWAN_AGENT.id ? HUGGINGSWAN_RUN_NAME_KEYS
        : null;
      if (!nameKeys) return agent;
      const nodes = nameKeys.flatMap((key) => opsRunNodesByAgent.get(key) ?? []);
      const upgrade = applySyntheticAgentStatusUpgrade(
        agent.status,
        deriveSyntheticAgentStatusFromRuns(nameKeys, nodes, nowMs),
      );
      if (!upgrade.changed) return agent;
      return { ...agent, status: upgrade.status, activity: upgrade.activity ?? agent.activity };
    });
  }, [userAgents, currentUserId, mergedCircleAgents, connections, agentIdentities, selectedAgent?.id, opsRunNodesByAgent]);
  // Sprite memoization may intentionally retain a prior visual object. Panel
  // selection always resolves the id against this synchronously current roster
  // so a connection/session refresh cannot reopen stale execution authority.
  const displayAgentsRef = useRef<readonly OfficeAgent[]>(displayAgents);
  displayAgentsRef.current = displayAgents;
  useEffect(() => {
    setSelectedAgent(previous => {
      if (!previous) return null;
      const current = resolveUniqueOfficeAgentById(displayAgents, previous.id);
      // The popup is a live projection of the canonical roster, never a
      // snapshot captured at click time. If the subject retires, close it.
      return current;
    });
  }, [displayAgents]);
  const selectedAgentRuntimeConnectionId = useMemo(
    () => resolveAgentPanelRuntimeConnectionId(selectedAgent, connections),
    [connections, selectedAgent],
  );
  const terminalCommandAgents = useMemo<CircleOfficeAgent[]>(() => (
    [
      {
        ...createBlackSwanAgent(circleId),
        name: commandTargetAgents.find(target => target.id === BLACKSWAN_AGENT_ID)?.name || DEFAULT_AGENT.name,
      },
      ...terminalDispatchAgents,
    ]
  ), [circleId, commandTargetAgents, terminalDispatchAgents]);

  const officeAgentOwnershipContext = useMemo(() => {
    const authority = committedAuthAuthority;
    const ownsCurrentScope = Boolean(
      authority
      && authority.userId === currentUserId
      && authority.circleId === circleId
      && isOfficeAuthorityCurrent(authority),
    );
    const connectionAuthority = connectionsAuthorityRef.current;
    const ownsCurrentConnectionScope = Boolean(
      ownsCurrentScope
      && authority
      && connectionAuthority
      && connectionAuthority.userId === authority.userId
      && connectionAuthority.circleId === authority.circleId
      && connectionAuthority.accessToken === authority.accessToken
      && connectionAuthority.generation === authority.generation,
    );
    const ownedDurableAgentIds = new Set<string>();
    const ownedConnectionIds = new Set<string>();
    const ownedProviderMainIds = new Set<string>();
    if (ownsCurrentScope) {
      for (const durableAgent of mergedCircleAgents) {
        if (durableAgent.ownerId !== currentUserId) continue;
        ownedDurableAgentIds.add(durableAgent.id);
        ownedDurableAgentIds.add(`db::${durableAgent.id}`);
        const provider = String(durableAgent.provider || '').trim();
        if (provider) ownedProviderMainIds.add(`provider-main::${provider}`);
      }
    }
    if (ownsCurrentConnectionScope) {
      // The array and its provenance receipt must both match this exact
      // generation. Its id is the structural custody link for live sessions.
      for (const connection of connections) {
        ownedConnectionIds.add(connection.id);
        const provider = String(connection.provider || '').trim();
        if (provider) ownedProviderMainIds.add(`provider-main::${provider}`);
      }
    }
    return {
      currentUserId: ownsCurrentScope ? currentUserId : null,
      defaultAgentId: DEFAULT_AGENT.id,
      ownedDurableAgentIds,
      ownedConnectionIds,
      ownedProviderMainIds,
    };
  }, [
    circleId,
    committedAuthAuthority,
    connections,
    currentUserId,
    isOfficeAuthorityCurrent,
    mergedCircleAgents,
  ]);
  const isDisplayAgentMine = useCallback(
    (agent: OfficeAgent) => isOfficeAgentOwnedByCurrentUser(agent, officeAgentOwnershipContext),
    [officeAgentOwnershipContext],
  );

  // Precompute filter counts so every chip can show its hit count inline.
  // `mine` is bridge-pushed agents owned by the current user plus the default
  // OpenSwan (which conceptually belongs to every user who looks at it).
  // `bonded` is circle_office_agents rows — anything persisted vs synthetic.
  const agentFilterCounts = useMemo(() => {
    const isBonded = (a: OfficeAgent) => !a.isSynthetic || a.id === DEFAULT_AGENT.id;
    const isActive = (a: OfficeAgent) => a.status === 'active' || a.status === 'building';
    return {
      all: displayAgents.length,
      mine: displayAgents.filter(isDisplayAgentMine).length,
      active: displayAgents.filter(isActive).length,
      bonded: displayAgents.filter(isBonded).length,
    };
  }, [displayAgents, isDisplayAgentMine]);

  const filteredDisplayAgents = useMemo(() => {
    if (agentFilterMode === 'all') return displayAgents;
    if (agentFilterMode === 'mine') {
      return displayAgents.filter(isDisplayAgentMine);
    }
    if (agentFilterMode === 'active') {
      return displayAgents.filter(a => a.status === 'active' || a.status === 'building');
    }
    if (agentFilterMode === 'bonded') {
      return displayAgents.filter(a => !a.isSynthetic || a.id === DEFAULT_AGENT.id);
    }
    return displayAgents;
  }, [displayAgents, agentFilterMode, isDisplayAgentMine]);
  const WhiteboardView = whiteboardModule?.default;
  const ServerRackView = serverRackModule?.default;
  const OfficeTerminalView = officeTerminalModule?.default;

  // Resolve appearance — lookup by id, name, then legacy provider names
  const PROVIDER_LEGACY_NAMES_LOOKUP: Record<string, string[]> = {
    'claude-code': ['Claude Code', 'CC', 'C3PO'],
    'cursor': ['Cursor'],
    'codex': ['Codex'],
    'gemini': ['Gemini', 'Gemini CLI'],
  };
  const getAppearance = useCallback((agent: OfficeAgent) => {
    const identityKey = getAgentIdentityKey(agent);
    const identityAppearance = agentIdentities.get(identityKey)?.appearance;
    if (agent.id === DEFAULT_AGENT.id) {
      return appearances[agent.id] || appearances[identityKey] || identityAppearance || appearances[agent.name] || UC_AGENT_APPEARANCE;
    }
    let result = appearances[agent.id] || appearances[identityKey] || identityAppearance || appearances[agent.name];
    if (!result && agent.providerType) {
      const legacyNames = PROVIDER_LEGACY_NAMES_LOOKUP[agent.providerType] || [];
      for (const ln of legacyNames) {
        if (appearances[ln]) { result = appearances[ln]; break; }
      }
    }
    return result;
  }, [agentIdentities, appearances]);
  const selectedAgentPanelAppearances = useMemo(() => {
    if (!selectedAgent) return appearances;
    // The popup's explicit reload is server-truth recovery, so the freshly
    // hydrated exact identity must outrank the older preference appearance.
    const resolvedAppearance = getAgentIdentityByAgent(agentIdentities, selectedAgent)?.appearance
      || getAppearance(selectedAgent);
    if (!resolvedAppearance) return appearances;
    const identityKey = getAgentIdentityKey(selectedAgent);
    return {
      ...appearances,
      [selectedAgent.id]: resolvedAppearance,
      [identityKey]: resolvedAppearance,
    };
  }, [agentIdentities, appearances, getAppearance, selectedAgent]);

  // Auto-assign random outfits to new agents + backfill pets/auras for existing agents
  useEffect(() => {
    if (!appearancesLoadedRef.current) return;
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const petPool: AgentAppearance['pet'][] = ['cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones'];
    const auraPool: AgentAppearance['aura'][] = ['fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'];
    // Legacy provider-name fallbacks for appearance lookup
    const PROVIDER_LEGACY_NAMES: Record<string, string[]> = {
      'claude-code': ['Claude Code', 'CC', 'C3PO'],
      'cursor': ['Cursor'],
      'codex': ['Codex'],
      'gemini': ['Gemini', 'Gemini CLI'],
    };
    const updates: Record<string, AgentAppearance> = {};
    for (const agent of userAgents) {
      // Check by id first, then name, then legacy provider names
      const identityKey = getAgentIdentityKey(agent);
      let existing = appearances[agent.id] || appearances[identityKey] || appearances[agent.name];
      if (!existing && agent.providerType) {
        const legacyNames = PROVIDER_LEGACY_NAMES[agent.providerType] || [];
        for (const ln of legacyNames) {
          if (appearances[ln]) { existing = appearances[ln]; break; }
        }
      }
      if (!existing) {
        const generated = generateRandomAppearance();
        updates[agent.id] = generated;
        updates[identityKey] = generated;
      } else {
        // Migrate legacy name/session-key keyed appearance to id-keyed and identity-keyed
        if (!appearances[agent.id] && (appearances[agent.name] || appearances[identityKey])) {
          updates[agent.id] = existing;
        }
        if (!appearances[identityKey]) {
          updates[identityKey] = existing;
        }
        // Backfill: give existing agents a pet/aura if they don't have one
        let changed = false;
        const patched = { ...existing };
        if (!existing.pet || existing.pet === 'none') {
          patched.pet = pick(petPool);
          changed = true;
        }
        if (!existing.aura || existing.aura === 'none') {
          patched.aura = pick(auraPool);
          changed = true;
        }
        if (changed) {
          updates[agent.id] = patched;
          updates[identityKey] = patched;
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      setAppearances(prev => ({ ...prev, ...updates }));
    }
  }, [userAgents.map(a => a.id).join(',')]); // re-run only when agent list changes

  // ─── Reward tracking — award points as agent turns accumulate ──────────
  const { points: userPoints } = useUserRewards(userId);
  const userXp = userPoints?.lifetime_points ?? 0;
  const nextBadge = getNextBadge(userXp);
  const xpNext = nextBadge?.pointsRequired ?? 100;

  // Track ALL agents' turns — every bot earns XP for the user
  useAllAgentPointsTracker(
    userId,
    userAgents,
    (newBadges) => {
      if (newBadges.length > 0) {
        setCelebrationBadge(newBadges[0]);
        setDancingAgentId('all');
        setTimeout(() => setDancingAgentId(null), 5000);
      }
    },
  );

  // Filter agents for current floor using explicit per-floor assignments.
  const agents = useMemo(() => {
    const floorIds = currentFloor?.agentIds;
    if (currentFloor?.agentAssignmentMode !== 'manual' && (!floorIds || floorIds.length === 0)) {
      return displayAgents.slice(0, OFFICE_DESK_POSITIONS.length);
    }
    if (!floorIds || floorIds.length === 0) return [];
    const onFloor = new Set(floorIds);
    // displayAgents is already sorted by the new rules: working-first, then
    // BlackSwan, then Claude Code, then others. Preserve that order for the
    // floor subset — no re-sort needed.
    return displayAgents.filter(a => onFloor.has(a.id)).slice(0, OFFICE_DESK_POSITIONS.length);
  }, [displayAgents, currentFloor?.agentIds, floors]);

  // Auto-distribute only automatically managed floors. Applying a preset makes
  // that floor's captured roster manual, so a later bridge refresh cannot
  // silently replace the user-owned assignment snapshot.
  useEffect(() => {
    if (!floorLayoutHydrated || floorsRef.current.length === 0) return;
    mutateFloorsDurably((current) => reconcileAutomaticOfficeFloorAssignments(
      current,
      displayAgents.map((agent) => agent.id),
      OFFICE_DESK_POSITIONS.length,
    ));
  }, [displayAgents, floorLayoutHydrated, floors, mutateFloorsDurably]);

  // Update status history when agent state materially changes
  useEffect(() => {
    const requestedAuthority = committedAuthAuthority;
    if (
      !requestedAuthority
      || !isOfficeAuthorityCurrent(requestedAuthority)
      || !floorLayoutHydrated
    ) {
      setStatusHistory([]);
      return;
    }
    if (userAgents.length === 0) {
      setStatusHistory([]);
      return;
    }
    setStatusHistory(prev => {
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return [];
      const last = prev[prev.length - 1];
      if (last && JSON.stringify(last.map(agent => [
        agent.id,
        agent.status,
        agent.lastActive || '',
        agent.messagesProcessed || 0,
        agent.turns || 0,
      ])) === userAgentsStatusKey) {
        return prev;
      }
      return [...prev, userAgents].slice(-10);
    });
  }, [committedAuthAuthority, floorLayoutHydrated, isOfficeAuthorityCurrent, userAgentsStatusKey]);

  // Enrich agents with cached data + restore identity
  useEffect(() => {
    let cancelled = false;
    const requestedScope = floorLayoutScope;
    const storageScope = officeSessionStorageScope;
    const requestedAuthority = captureOfficeAuthority();
    const requestIsCurrent = () => (
      !cancelled
      && requestedScope
      && layoutSaveScopeRef.current === requestedScope
      && isOfficeAuthorityCurrent(requestedAuthority)
    );
    const cancelDeferred = runWhenIdle(() => {
      const doEnrich = async () => {
        if (!requestedScope || !storageScope || !requestedAuthority || !requestIsCurrent()) return;
        if (allAgents.length === 0) {
          if (requestIsCurrent()) setEnrichedAgents([]);
          return;
        }

        try {
          const cacheEnriched = await enrichAgentsWithCache(allAgents, storageScope);
          if (!requestIsCurrent()) return;
          const fullyEnriched = await restoreAllAgentsExact(cacheEnriched, requestedAuthority);
          if (!requestIsCurrent()) return;
          const identities = await loadAgentIdentitiesExact(requestedAuthority);
          if (!requestIsCurrent()) return;
          setAgentIdentities(identities);
          setEnrichedAgents(fullyEnriched);

          void (async () => {
            for (const agent of fullyEnriched) {
              if (!requestIsCurrent()) return;
              await recordAgentActivityExact(agent, requestedAuthority, isOfficeAuthorityCurrent);
            }
          })().catch(() => {});
          void takeSnapshot(fullyEnriched, sessionTags, storageScope).catch(() => {});
        } catch (error) {
          console.error('Failed to enrich agents:', error);
          if (requestIsCurrent()) setEnrichedAgents(allAgents);
        }
      };
      void doEnrich();
    }, 250);
    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [
    agentNames,
    captureOfficeAuthority,
    committedAuthScopeKey,
    floorLayoutScope,
    isOfficeAuthorityCurrent,
    officeSessionStorageScope,
    sessionTags,
    sessionsTick,
  ]);

  useEffect(() => {
    void refreshAgentIdentities();
  }, [refreshAgentIdentities]);

  // Enrich sessions for Cost Dashboard
  useEffect(() => {
    const requestedScope = floorLayoutScope;
    const storageScope = officeSessionStorageScope;
    if (!requestedScope || !storageScope) {
      setEnrichedSessions([]);
      return undefined;
    }
    const allSessions: OpenSwanSession[] = [];
    const sortedConnections = [...connectedConns].sort((a, b) => a.id.localeCompare(b.id));

    for (const conn of sortedConnections) {
      const sessions = sessionsRef.current.get(conn.id) || [];
      allSessions.push(...sessions);
    }

    const normalizedSessions = [...allSessions].sort((a, b) => {
      const sessionCmp = (a.sessionKey || '').localeCompare(b.sessionKey || '');
      if (sessionCmp !== 0) return sessionCmp;
      const modelCmp = (a.model || '').localeCompare(b.model || '');
      if (modelCmp !== 0) return modelCmp;
      return (a.lastActivity || '').localeCompare(b.lastActivity || '');
    });

    const signature = JSON.stringify(normalizedSessions.map(session => [
      session.sessionKey,
      session.lastActivity || '',
      session.messageCount || 0,
      session.totalCost || 0,
      session.totalInputTokens || 0,
      session.totalOutputTokens || 0,
      session.cachedTokens || 0,
      session.newTokens || 0,
      session.model || '',
    ]));

    if (signature === enrichedSessionSignatureRef.current) return;
    enrichedSessionSignatureRef.current = signature;

    if (normalizedSessions.length === 0) {
      setEnrichedSessions([]);
      return;
    }

    let cancelled = false;
    const cancelDeferred = runWhenIdle(() => {
      enrichSessionsWithCache(normalizedSessions, storageScope).then(enriched => {
        if (!cancelled && layoutSaveScopeRef.current === requestedScope) setEnrichedSessions(enriched);
      }).catch(err => {
        console.error('Failed to enrich sessions:', err);
        if (!cancelled && layoutSaveScopeRef.current === requestedScope) {
          setEnrichedSessions(normalizedSessions); // Fallback to raw sessions
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      cancelDeferred();
    };
  }, [floorLayoutScope, officeSessionStorageScope, sessionsTick]);

  // Combined 30-second sync: snapshot + DB token sync (single interval instead of two)
  useEffect(() => {
    const requestedScope = floorLayoutScope;
    const storageScope = officeSessionStorageScope;
    if (userAgents.length === 0 || !circleId || !requestedScope || !storageScope) return;

    const syncAll = async () => {
      if (!isDocumentVisible()) return;
      try {
        // 1. Save local snapshot
        if (layoutSaveScopeRef.current !== requestedScope) return;
        await takeSnapshot(
          enrichedAgentsRef.current,
          sessionTagsRef.current,
          storageScope,
        ).catch(() => {});
        if (layoutSaveScopeRef.current !== requestedScope) return;
        // 2. Sync tokens to DB
        const agents = enrichedAgentsRef.current;
        for (const agent of agents) {
          if (agent.tokensUsed <= 0 && agent.messagesProcessed <= 0) continue;
          if (agent.connectionId === 'db-agent') continue;
          await syncAgentTokenSnapshot(
            circleId, agent.name, agent.inputTokens, agent.outputTokens,
            agent.cachedTokens, agent.turns || agent.messagesProcessed,
            agent.sessionCostToday ?? agent.costToday, agent.model, agent.sessionKey || agent.id,
          );
        }
      } catch {}
    };
    syncAll();
    const interval = setInterval(syncAll, 30000);
    let removeVisibilityListener: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void syncAll();
      };
      document.addEventListener('visibilitychange', onVisible);
      removeVisibilityListener = () => document.removeEventListener('visibilitychange', onVisible);
    }
    return () => {
      clearInterval(interval);
      removeVisibilityListener?.();
    };
  }, [circleId, floorLayoutScope, officeSessionStorageScope, userAgents.length > 0]);

  // Push agent stats to parent using the merged live + cached view
  useEffect(() => {
    if (onAgentStats && userAgents.length > 0) {
      onAgentStats({
        agentCount: userAgents.length,
        sessionCount: userAgents.filter(a => a.status === 'active' || a.status === 'building').length,
        costToday: userAgents.reduce((s, a) => s + a.costToday, 0),
        costWeek: userAgents.reduce((s, a) => s + a.costWeek, 0),
        tokens: userAgents.reduce((s, a) => s + a.tokensUsed, 0),
        tokensTotal: userAgents.reduce((s, a) => s + a.tokensUsed, 0),
        messagesTotal: userAgents.reduce((s, a) => s + a.messagesProcessed, 0),
        messagesToday: userAgents.reduce((s, a) => s + a.turns, 0),
        inputTokens: userAgents.reduce((s, a) => s + a.inputTokens, 0),
        outputTokens: userAgents.reduce((s, a) => s + a.outputTokens, 0),
      });
    }
  }, [userAgentsMetricsKey, onAgentStats]);

  // Save appearances for this exact user/circle. Server persistence uses the
  // private Office preference row rather than the peer-readable profile row.
  useEffect(() => {
    if (!appearancesLoadedRef.current) return; // skip until init is done
    storage.setItem(privateStorageKeys.appearances, JSON.stringify(appearances)).catch(() => {});
    pushOfficePreferences({ appearances });
  }, [appearances, privateStorageKeys.appearances, pushOfficePreferences]);

  // Save whiteboard notes when changed — localStorage + Supabase
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    storage.setItem(privateStorageKeys.whiteboardNotes, JSON.stringify(whiteboardNotes)).catch(() => {});
    pushOfficePreferences({ whiteboardNotes });
  }, [privateStorageKeys.whiteboardNotes, pushOfficePreferences, whiteboardNotes]);

  // Save budget config to the owner-and-circle Office preference row.
  useEffect(() => {
    if (!budgetLoadedRef.current) return;
    pushOfficePreferences({ budgetConfig });
  }, [budgetConfig, pushOfficePreferences]);

  // Save idle config to the owner-and-circle Office preference row.
  useEffect(() => {
    const requestedAuthority = authAuthorityRef.current;
    if (
      !idleLoadedRef.current
      || !requestedAuthority
      || idleConfigReadyAuthorityKey !== idleConfigAuthorityKey({
        userId: requestedAuthority.userId,
        circleId: requestedAuthority.circleId,
        authorityGeneration: requestedAuthority.generation,
      })
    ) return;
    if (remoteIdleAppliedRef.current) {
      remoteIdleAppliedRef.current = false;
      return;
    }
    pushOfficePreferences({ idleConfig }, requestedAuthority);
  }, [idleConfig, idleConfigReadyAuthorityKey, pushOfficePreferences]);

  // Save agent filter mode (mine / all / active / bonded) to
  // the private Office preference row so the user's preferred view persists
  // across devices.
  useEffect(() => {
    if (!prefsLoadedRef.current) return;
    pushOfficePreferences({ agentFilterMode });
  }, [agentFilterMode, pushOfficePreferences]);

  // Fetch cron jobs from all connected OpenSwan instances
  const connectedCount = connections.filter(c => c.status === 'connected').length;
  useEffect(() => {
    if (!isDesktop || !whiteboardModule) return;
    if (connectedCount === 0) return;
    const fetchCron = async () => {
      const openswanConns = connections.filter(c => c.status === 'connected' && c.provider === 'openswan');
      if (openswanConns.length === 0) return; // skip if no OpenSwan connections
      const allJobs: CronJob[] = [];
      for (const conn of openswanConns) {
        const config: OpenSwanConfig = { endpoint: conn.endpoint, token: conn.token };
        try {
          if (!supportsOpenSwanToolRpcEndpoint(config.endpoint)) continue;
          const result = await listCronJobs(config);
          if (result.ok) allJobs.push(...result.jobs);
        } catch {} // endpoint may not support cron
      }
      setCronJobs(allJobs);
    };
    fetchCron();
    const interval = setInterval(fetchCron, 300_000); // 5 min — cron data changes rarely
    return () => clearInterval(interval);
  }, [connectedCount, isDesktop, whiteboardModule]);

  // Scale
  const availableW = winW - 24;
  const rawScale = availableW / OFFICE_FLOOR_WIDTH;
  const officeScale = Math.max(0.55, rawScale);
  const scaledH = OFFICE_FLOOR_HEIGHT * officeScale;
  const needsHScroll = rawScale < 0.55;

  const handleAgentPress = useCallback((agentId: string) => {
    if (editMode) return;
    const agent = resolveUniqueOfficeAgentById(displayAgentsRef.current, agentId);
    if (!agent) {
      setSelectedAgent(null);
      return;
    }
    setSelectedAgent(prev => prev?.id === agent.id ? null : agent);
  }, [editMode]);

  const handleOpenAgentInChat = useCallback((agentId: string, draft?: string) => {
    const focus = encodeEntityHandle({ surface: 'chat', kind: 'agent', id: agentId });
    if (!focus) return;
    // Office stays mounted after switching tabs. Retire its modal before the
    // validated handoff so a hidden aria-modal/focus trap cannot reappear when
    // the user returns from Chat.
    setSelectedAgent(null);
    onOpenAgentInChat?.(focus, normalizeChatAgentFocusDraft(draft) || undefined);
  }, [onOpenAgentInChat]);

  const handleOpenAutomate = useCallback(() => {
    setTerminalInitialTab('automations');
    setTerminalSize('half');
  }, []);

  const handleRemovePublishedAgent = useCallback(async (agent: OfficeAgent) => {
    const requestedAuthority = captureOfficeAuthority();
    const publishedAgentId = agent?.connectionId === 'db-agent' && isUuidLike(agent.sessionKey)
      ? agent.sessionKey
      : null;
    if (!agent?.name || !publishedAgentId || !requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return false;
    if (agent.id === 'default::blackswan' || agent.id === 'blackswan-default' || agent.providerType === 'blackswan-local') return false;
    try {
      // The panel opens published agents with their exact UUID in sessionKey.
      // Never widen a destructive action to a same-name row or multiple rows.
      const { data: removedRows, error } = await supabase
        .from('circle_office_agents')
        .delete()
        .setHeader('Authorization', `Bearer ${requestedAuthority.accessToken}`)
        .eq('id', publishedAgentId)
        .eq('circle_id', requestedAuthority.circleId)
        .eq('owner_id', requestedAuthority.userId)
        .select('id');
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return false;
      if (error) {
        console.error('[OfficeTab] Failed to remove published agent:', error);
        return false;
      }
      const exactReceipt = removedRows?.length === 1 && removedRows[0]?.id === publishedAgentId;
      if (!exactReceipt) {
        console.error('[OfficeTab] Published agent removal returned no exact receipt.');
        return false;
      }
      setCircleOfficeAgents(prev => prev.filter(row => row.id !== publishedAgentId));
      // Suppress future bridge-poller republishes only after the exact durable
      // mutation returned the exact UUID receipt.
      hideAgentInOffice(requestedAuthority.userId, requestedAuthority.circleId, agent.name);
      return isOfficeAuthorityCurrent(requestedAuthority);
    } catch (err) {
      if (isOfficeAuthorityCurrent(requestedAuthority)) {
        console.error('[OfficeTab] Remove agent error:', err);
      }
      return false;
    }
  }, [captureOfficeAuthority, isOfficeAuthorityCurrent]);

  // ─── Reversible floor editor helpers ────────────────────────────────────

  const commitCurrentFloorEdit = useCallback((
    label: string,
    update: (floor: OfficeFloor) => OfficeFloor,
  ): OfficeFloor | null => {
    if (!floorLayoutScope || !floorLayoutHydrated || layoutSaveScopeRef.current !== floorLayoutScope) {
      setFloorPresetStatus('Finishing the Office layout load. Try this edit again in a moment.');
      return null;
    }
    const current = floorsRef.current.find((floor) => floor.id === currentFloorId);
    if (!current) return null;
    const next = update(current);
    if (!next || next.id !== current.id) return null;

    let history: OfficeEditorHistory | null | undefined = officeEditorHistoriesRef.current[current.id];
    const layoutFingerprint = (floor: OfficeFloor) => JSON.stringify(floor.furniture.map((item) => ({
      id: item.id,
      type: item.type,
      x: item.x,
      y: item.y,
      itemWidth: item.itemWidth,
      itemHeight: item.itemHeight,
      rotation: item.rotation,
    })));
    const historyMatchesCurrent = history
      && layoutFingerprint(history.present.floor) === layoutFingerprint(current);
    if (!historyMatchesCurrent) {
      history = createOfficeEditorHistory(current, { label: 'Current floor' });
    }
    if (!history) return null;
    const committed = commitOfficeEditorSnapshot(history, next, label);
    if (!committed || committed === history) return null;

    officeEditorHistoriesRef.current[current.id] = committed;
    const nextFloors = floorsRef.current.map((floor) => floor.id === current.id ? committed.present.floor : floor);
    floorsRef.current = nextFloors;
    markFloorLayoutMutation('Saving every floor item and tool…');
    setFloors(nextFloors);
    setOfficeEditorHistoryRevision((revision) => revision + 1);
    return committed.present.floor;
  }, [currentFloorId, floorLayoutHydrated, floorLayoutScope, markFloorLayoutMutation]);

  const officeEditorHistoryAvailability = useMemo(() => {
    const history = officeEditorHistoriesRef.current[currentFloorId];
    return history
      ? getOfficeEditorHistoryAvailability(history)
      : { canUndo: false, canRedo: false, undoLabel: null, redoLabel: null };
    // The revision intentionally invalidates this ref-backed calculation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFloorId, officeEditorHistoryRevision]);

  const restoreOfficeEditorHistory = useCallback((direction: 'undo' | 'redo') => {
    if (!floorLayoutScope || !floorLayoutHydrated || layoutSaveScopeRef.current !== floorLayoutScope) return;
    const history = officeEditorHistoriesRef.current[currentFloorId];
    const current = floorsRef.current.find((floor) => floor.id === currentFloorId);
    if (!history || !current) return;
    const nextHistory = direction === 'undo'
      ? undoOfficeEditorHistory(history)
      : redoOfficeEditorHistory(history);
    if (nextHistory === history) return;
    officeEditorHistoriesRef.current[currentFloorId] = nextHistory;
    // Floor identity and live agent assignments can change outside this
    // editor. Undo only the furniture payload it actually owns.
    const cachedItems = Object.values(officeEditorItemStateRef.current[currentFloorId] || {});
    const restoredFurniture = mergeOfficeEditorFurnitureState(
      nextHistory.present.floor.furniture,
      [...cachedItems, ...current.furniture],
    );
    const restored = { ...current, furniture: restoredFurniture };
    const nextFloors = floorsRef.current.map((floor) => floor.id === currentFloorId ? restored : floor);
    floorsRef.current = nextFloors;
    markFloorLayoutMutation('Saving every floor item and tool…');
    setFloors(nextFloors);
    setSelectedFurnitureId(null);
    setPlacingType(null);
    setOfficeEditorHistoryRevision((revision) => revision + 1);
  }, [currentFloorId, floorLayoutHydrated, floorLayoutScope, markFloorLayoutMutation, setPlacingType, setSelectedFurnitureId]);

  const rememberOfficeAddonType = useCallback((type: FurnitureType) => {
    if (currentUserId) officeAddonPreferencesMutatedForScopeRef.current = `${currentUserId}:${circleId}`;
    setOfficeAddonPreferences((current) => recordOfficeAddonRecentType(current, type));
  }, [circleId, currentUserId]);

  const toggleOfficeAddonFavorite = useCallback((type: FurnitureType) => {
    if (currentUserId) officeAddonPreferencesMutatedForScopeRef.current = `${currentUserId}:${circleId}`;
    setOfficeAddonPreferences((current) => setOfficeAddonFavorite(current, type));
  }, [circleId, currentUserId]);

  const placeOfficeAddon = useCallback((type: FurnitureType, requestedX?: number, requestedY?: number) => {
    const definition = getOfficeAddonDefinition(type);
    const current = floorsRef.current.find((floor) => floor.id === currentFloorId);
    if (!current || !definition) return;
    const index = current.furniture.length;
    const fallbackX = 32 + (index % 7) * 112;
    const fallbackY = 208 + (Math.floor(index / 7) % 6) * 112;
    const x = Math.max(0, Math.min(OFFICE_FLOOR_WIDTH - definition.width, Math.round((requestedX ?? fallbackX) / OFFICE_FLOOR_GRID_SIZE) * OFFICE_FLOOR_GRID_SIZE));
    const y = Math.max(0, Math.min(OFFICE_FLOOR_HEIGHT - definition.height, Math.round((requestedY ?? fallbackY) / OFFICE_FLOOR_GRID_SIZE) * OFFICE_FLOOR_GRID_SIZE));
    const usedIds = new Set(current.furniture.map((item) => item.id));
    const seed = `f_${Date.now()}_${type}`;
    let id = seed;
    let suffix = 1;
    while (usedIds.has(id)) id = `${seed}_${suffix++}`;
    const newFurniture: FurnitureItem = {
      id,
      type,
      x,
      y,
      itemWidth: definition.width,
      itemHeight: definition.height,
      dataState: definition.defaultDataState,
    };
    const committed = commitCurrentFloorEdit(`Add ${definition.name}`, (floor) => ({
      ...floor,
      furniture: [...floor.furniture, newFurniture],
    }));
    if (!committed) return;
    rememberOfficeAddonType(type);
    setSelectedFurnitureId(id);
    setPlacingType(null);
  }, [commitCurrentFloorEdit, currentFloorId, rememberOfficeAddonType, setPlacingType, setSelectedFurnitureId]);

  const handleCatalogItemPress = useCallback((type: FurnitureType) => {
    if (!isDesktop) {
      placeOfficeAddon(type);
      return;
    }
    setSelectedFurnitureId(null);
    setPlacingType((current) => current === type ? null : type);
    rememberOfficeAddonType(type);
  }, [isDesktop, placeOfficeAddon, rememberOfficeAddonType, setPlacingType, setSelectedFurnitureId]);

  const handleFloorPress = (x: number, y: number) => {
    if (!editMode) return;
    // If something is selected and user taps floor, deselect
    if (selectedFurnitureId) { setSelectedFurnitureId(null); return; }
    if (!placingType) return;
    if (!FURNITURE_CATALOG.some((entry) => entry.type === placingType)) return;
    placeOfficeAddon(placingType as FurnitureType, x, y);
  };

  const closeServiceModal = useCallback(() => {
    serviceOAuthDisconnectControllerRef.current?.controller.abort();
    serviceOAuthDisconnectControllerRef.current = null;
    oauthMutationTokenRef.current = null;
    serviceOAuthGenerationRef.current += 1;
    serviceModalVisibleRef.current = false;
    serviceModalTargetIdRef.current = null;
    serviceModalTypeRef.current = '';
    setServiceModalVisible(false);
    setServiceModalTargetId(null);
    setServiceModalType('');
    setServiceUrlError('');
    setOauthStatus(null);
    setOauthError('');
    setOauthConnecting(false);
  }, [setServiceModalVisible]);

  const beginServiceOAuthScope = useCallback((input: {
    targetId: string;
    serviceType: 'calendar_widget' | 'email_hub';
    provider: OfficeOAuthProvider;
  }): ServiceOAuthScope => {
    const authority = authAuthorityRef.current;
    return {
      generation: ++serviceOAuthGenerationRef.current,
      circleId,
      floorId: currentFloorIdRef.current,
      targetId: input.targetId,
      serviceType: input.serviceType,
      provider: input.provider,
      userId: authority?.userId || '',
      accessToken: authority?.accessToken || '',
      authorityGeneration: authority?.generation || 0,
    };
  }, [circleId]);

  const isServiceOAuthScopeCurrent = useCallback((scope: ServiceOAuthScope): boolean => {
    const provider = scope.serviceType === 'calendar_widget'
      ? (serviceCalendarProviderRef.current === 'google' ? 'google' : 'microsoft')
      : (serviceEmailProviderRef.current === 'gmail' ? 'google' : 'microsoft');
    const authority = authAuthorityRef.current;
    return Boolean(
      authority
      && authority.userId === scope.userId
      && authority.circleId === scope.circleId
      && authority.accessToken === scope.accessToken
      && authority.generation === scope.authorityGeneration
    ) && isOfficeServiceAsyncScopeCurrent(scope, {
      generation: serviceOAuthGenerationRef.current,
      circleId,
      floorId: currentFloorIdRef.current,
      targetId: serviceModalTargetIdRef.current || '',
      serviceType: serviceModalTypeRef.current,
      provider,
      modalVisible: serviceModalVisibleRef.current,
    });
  }, [circleId]);

  const refreshServiceOAuthStatus = useCallback(async (input: {
    targetId: string;
    serviceType: 'calendar_widget' | 'email_hub';
    provider: OfficeOAuthProvider;
  }) => {
    const scope = beginServiceOAuthScope(input);
    setOauthStatus({ state: 'checking', connected: false, email: '' });
    setOauthError('');
    const status = await checkOAuthStatus(
      scope.provider,
      scope.serviceType === 'calendar_widget' ? 'calendar' : 'email',
      scope.accessToken,
    ).catch((): OAuthConnectionStatus => ({
      state: 'unavailable',
      connected: false,
      email: '',
    }));
    if (!isServiceOAuthScopeCurrent(scope)) return;
    setOauthStatus(status);
    if (status.state === 'unavailable') {
      setOauthError('Could not verify this provider account. Existing Office setup was not changed.');
    } else if (status.state === 'reconnect_required') {
      setOauthError('This provider connection expired or needs additional permission. Sign in again for this Calendar or Email access.');
    }
  }, [beginServiceOAuthScope, isServiceOAuthScopeCurrent]);

  useEffect(() => () => {
    serviceOAuthDisconnectControllerRef.current?.controller.abort();
    serviceOAuthDisconnectControllerRef.current = null;
    serviceOAuthGenerationRef.current += 1;
  }, []);

  useEffect(() => () => {
    serviceOAuthDisconnectControllerRef.current?.controller.abort();
    serviceOAuthDisconnectControllerRef.current = null;
  }, [committedAuthAuthority?.generation]);

  useEffect(() => {
    invalidateServiceWidgetRefreshes();
    if (serviceModalVisibleRef.current) closeServiceModal();
  }, [circleId, currentFloorId, closeServiceModal, invalidateServiceWidgetRefreshes]);

  const openFurnitureConfiguration = useCallback((id: string): boolean => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return false;
    if (item.type === 'nft_frame') {
      setNftPickerTargetId(id);
      setSelectedFurnitureId(id);
      setImagePickerTab('upload');
      setNftPickerVisible(true);
      return true;
    }
    const connectedTypes = ['smart_tv', 'spotify_jukebox', 'discord_hub', 'twitch_stream', 'video_call', 'calendar_widget', 'figma_board', 'email_hub'];
    if (connectedTypes.includes(item.type)) {
      serviceOAuthGenerationRef.current += 1;
      serviceModalTargetIdRef.current = id;
      serviceModalTypeRef.current = item.type;
      serviceCalendarProviderRef.current = item.calendarProvider || 'google';
      serviceEmailProviderRef.current = item.emailProvider || 'outlook';
      serviceModalVisibleRef.current = true;
      setServiceModalTargetId(id);
      setSelectedFurnitureId(id);
      setServiceModalType(item.type);
      setServiceUrl(item.tvContentUrl || item.spotifyUrl || item.discordUrl || item.videoCallLink || item.figmaBoardUrl || '');
      setServiceUrlError('');
      setServiceTvApp(item.tvApp || 'youtube');
      setServiceTvWidth(String(item.tvWidth || 120));
      setServiceTvHeight(String(item.tvHeight || 80));
      setServiceDiscordChannel(item.discordChannel || '');
      setServiceTwitchChannel(item.twitchChannel || '');
      setServiceCallProvider(item.videoCallProvider || 'zoom');
      setServiceCalendarProvider(item.calendarProvider || 'google');
      setServiceEmailProvider(item.emailProvider === 'gmail' ? 'gmail' : 'outlook');
      setOauthStatus(null);
      setOauthError('');
      setOauthConnecting(oauthMutationTokenRef.current !== null);
      setServiceModalVisible(true);
      // Check OAuth status for calendar/email items
      if (item.type === 'calendar_widget') {
        const prov = (item.calendarProvider === 'outlook' ? 'microsoft' : 'google') as OfficeOAuthProvider;
        void refreshServiceOAuthStatus({ targetId: id, serviceType: item.type, provider: prov });
      } else if (item.type === 'email_hub') {
        const prov = (item.emailProvider === 'gmail' ? 'google' : 'microsoft') as OfficeOAuthProvider;
        void refreshServiceOAuthStatus({ targetId: id, serviceType: item.type, provider: prov });
      }
      return true;
    }
    if (item.type === 'stickynote') {
      setStickyEditorTargetId(id);
      setSelectedFurnitureId(id);
      setStickyText(item.noteText || '');
      setStickyColor(item.noteColor || '#fef08a');
      setStickyGifUrl(item.noteGifUrl || '');
      setStickyGifSearch('');
      setStickyTab('write');
      setStickyEditorVisible(true);
      return true;
    }
    if (item.type === 'message_board') {
      setActivePhoneItemId(id);
      setPhoneVisible(true);
      return true;
    }
    if (item.type === 'scrabble_board') {
      setActiveScrabbleItemId(id);
      setScrabbleVisible(true);
      return true;
    }
    if (item.type === 'poker_table') {
      setActivePokerItemId(id);
      setPokerVisible(true);
      return true;
    }
    if (item.type === 'retro_console') {
      setEmulatorSystem(item.emulatorSystem || 'gba');
      setEmulatorVisible(true);
      return true;
    }
    if (item.type === 'hf_explorer') {
      setHfExplorerVisible(true);
      return true;
    }
    if (item.type === 'hf_runner') {
      setHfRunnerVisible(true);
      return true;
    }
    return false;
  }, [currentFloorId, refreshServiceOAuthStatus, setHfExplorerVisible, setHfRunnerVisible, setNftPickerVisible, setPhoneVisible, setPokerVisible, setScrabbleVisible, setSelectedFurnitureId, setServiceModalVisible, setStickyEditorVisible]);

  const handleFurniturePress = (id: string) => {
    if (!editMode) return;
    if (openFurnitureConfiguration(id)) return;
    // Selection is deliberately non-destructive. Older builds deleted a
    // selected item on the second tap, which made ordinary keyboard/pointer
    // exploration an irreversible action once the autosave ran.
    setSelectedFurnitureId(id);
  };

  const handleFurnitureDelete = useCallback(async (id: string) => {
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    const targetFloorId = currentFloorIdRef.current;
    if (!requestedScope || layoutSaveScopeRef.current !== requestedScope) return;
    const floor = floorsRef.current.find((entry) => entry.id === targetFloorId);
    const item = floor?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const catalogItem = FURNITURE_CATALOG.find((entry) => entry.type === item.type);
    const confirmed = await showConfirm({
      title: `Remove ${catalogItem?.name || 'office item'}?`,
      message: 'This removes the item from the current floor. You can use Undo immediately after removing it.',
      confirmLabel: 'Remove item',
      destructive: true,
    });
    if (
      !confirmed
      || layoutSaveScopeRef.current !== requestedScope
      || floorLayoutGenerationRef.current !== requestedGeneration
      || currentFloorIdRef.current !== targetFloorId
    ) return;
    const removed = commitCurrentFloorEdit(`Remove ${catalogItem?.name || 'office item'}`, (entry) => ({
      ...entry,
      furniture: entry.furniture.filter((candidate) => candidate.id !== id),
    }));
    if (!removed) return;
    if (serviceModalTargetIdRef.current === id) closeServiceModal();
    setSelectedFurnitureId(null);
  }, [closeServiceModal, commitCurrentFloorEdit, floorLayoutScope, setSelectedFurnitureId]);

  const loadUserNfts = async () => {
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority || !isOfficeAuthorityCurrent(requestedAuthority)) return;
    setNftsLoading(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('wallet_address_eth, wallet_address_sol')
        .eq('id', requestedAuthority.userId)
        .setHeader('Authorization', `Bearer ${requestedAuthority.accessToken}`)
        .single();
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return;
      if (!profile) {
        setNftsLoading(false);
        return;
      }
      const allNfts: NFT[] = [];
      if (profile.wallet_address_sol) {
        const solNfts = await fetchNFTs(profile.wallet_address_sol, 'solana');
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return;
        allNfts.push(...solNfts);
      }
      if (profile.wallet_address_eth) {
        const ethNfts = await fetchNFTs(profile.wallet_address_eth, 'ethereum');
        if (!isOfficeAuthorityCurrent(requestedAuthority)) return;
        allNfts.push(...ethNfts);
      }
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return;
      setUserNfts(allNfts);
      setNftsLoading(false);
    } catch (err) {
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return;
      console.error('Failed to load NFTs:', err);
      setNftsLoading(false);
    }
  };

  const handleNftSelect = (nft: NFT | null) => {
    if (!nftPickerTargetId) return;
    patchFurnitureStateDurably(currentFloorId, nftPickerTargetId, (item) => ({
      ...item,
      nftMint: nft?.mint,
      nftImageUrl: nft?.image,
      nftName: nft?.name,
      nftChain: nft?.chain as any,
      imageSource: nft ? 'nft' as const : undefined,
    }));
    setNftPickerVisible(false);
    setNftPickerTargetId(null);
  };

  // ── Image upload handlers ─────────────────────────────────────────────────

  const resizeImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new (window as any).Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 200;
          let w = img.width, h = img.height;
          if (w > h) { if (w > MAX) { h = h * (MAX / w); w = MAX; } }
          else { if (h > MAX) { w = w * (MAX / h); h = MAX; } }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = reject;
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileInputChange = async (event: any) => {
    const input = event.target;
    const file = event.target?.files?.[0];
    if (!file) return;
    if (!file.type?.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    const targetFloorId = currentFloorIdRef.current;
    const targetItemId = nftPickerTargetId;
    if (!requestedScope || !targetItemId || layoutSaveScopeRef.current !== requestedScope) return;
    try {
      const base64 = await resizeImageToBase64(file);
      if (
        layoutSaveScopeRef.current !== requestedScope
        || floorLayoutGenerationRef.current !== requestedGeneration
        || currentFloorIdRef.current !== targetFloorId
        || nftPickerTargetId !== targetItemId
      ) return;
      const patched = patchFurnitureStateDurably(targetFloorId, targetItemId, (item) => ({
        ...item,
        nftMint: undefined,
        nftImageUrl: base64,
        nftName: file.name?.replace(/\.[^/.]+$/, '') || 'Uploaded Image',
        nftChain: undefined,
        imageSource: 'upload' as const,
      }));
      if (!patched) return;
      setNftPickerVisible(false);
      setNftPickerTargetId(null);
    } catch (err) {
      console.error('Failed to process image:', err);
    } finally {
      input.value = '';
    }
  };

  // ── Sticky note save ─────────────────────────────────────────────────────

  const handleStickyNoteSave = () => {
    if (!stickyEditorTargetId) return;
    // Grab drawing from canvas if on draw tab
    let drawingData: string | undefined;
    if (stickyTab === 'draw' && stickyCanvasRef.current) {
      const canvas = stickyCanvasRef.current;
      // Check if canvas has any content (not all white)
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hasContent = imgData.data.some((v, i) => i % 4 === 3 && v > 0); // check alpha
        if (hasContent) drawingData = canvas.toDataURL('image/png');
      }
    }
    patchFurnitureStateDurably(currentFloorId, stickyEditorTargetId, (item) => ({
      ...item,
      noteText: stickyText || undefined,
      noteColor: stickyColor,
      noteDrawing: drawingData || (stickyTab !== 'draw' ? item.noteDrawing : undefined),
      noteGifUrl: stickyGifUrl || undefined,
    }));
    setStickyEditorVisible(false);
    setStickyEditorTargetId(null);
  };

  const handleServiceSave = () => {
    if (!serviceModalTargetId) return;
    if (
      (serviceModalType === 'calendar_widget' || serviceModalType === 'email_hub')
      && (!oauthStatus
        || oauthStatus.state === 'checking'
        || oauthStatus.state === 'unavailable'
        || oauthStatus.state === 'reconnect_required')
    ) {
      setOauthError(oauthStatus?.state === 'reconnect_required'
        ? 'Sign in again before saving this provider. Existing Office setup was not changed.'
        : 'Wait for a verified provider status before saving. Existing Office setup was not changed.');
      return;
    }
    const candidateServiceUrl = serviceUrl.trim();
    let safeServiceUrl: string | undefined;
    if (candidateServiceUrl) {
      try {
        const parsed = new URL(candidateServiceUrl);
        if (parsed.protocol !== 'https:') {
          setServiceUrlError('Use a complete HTTPS link. Your previous setup has not been changed.');
          return;
        }
        safeServiceUrl = parsed.toString();
      } catch {
        setServiceUrlError('Enter a valid HTTPS link. Your previous setup has not been changed.');
        return;
      }
    }
    setServiceUrlError('');
    const updates: Record<string, any> = {};
    switch (serviceModalType) {
      case 'smart_tv':
        updates.tvApp = serviceTvApp;
        updates.tvContentUrl = safeServiceUrl;
        updates.tvWidth = Math.max(40, Math.min(OFFICE_FLOOR_WIDTH, parseInt(serviceTvWidth, 10) || 120));
        updates.tvHeight = Math.max(40, Math.min(OFFICE_FLOOR_HEIGHT, parseInt(serviceTvHeight, 10) || 80));
        updates.tvPoweredOn = true;
        updates.dataState = safeServiceUrl ? 'local' : 'setup';
        updates.dataUpdatedAt = undefined;
        break;
      case 'spotify_jukebox':
        updates.spotifyUrl = safeServiceUrl;
        updates.spotifyConnected = false;
        updates.spotifyTrackName = undefined;
        updates.spotifyArtist = undefined;
        updates.spotifyPlaying = false;
        updates.spotifyProgress = undefined;
        updates.dataState = safeServiceUrl ? 'local' : 'setup';
        updates.dataUpdatedAt = undefined;
        break;
      case 'discord_hub':
        updates.discordUrl = safeServiceUrl;
        updates.discordConnected = false;
        updates.discordChannel = serviceDiscordChannel || 'general';
        updates.discordStatus = 'offline';
        updates.discordMemberCount = 0;
        updates.dataState = safeServiceUrl ? 'local' : 'setup';
        updates.dataUpdatedAt = undefined;
        break;
      case 'twitch_stream':
        updates.twitchChannel = serviceTwitchChannel.trim() || undefined;
        updates.twitchLive = false;
        updates.twitchViewers = 0;
        updates.dataState = serviceTwitchChannel.trim() ? 'local' : 'setup';
        updates.dataUpdatedAt = undefined;
        break;
      case 'video_call':
        updates.videoCallProvider = serviceCallProvider;
        updates.videoCallLink = safeServiceUrl;
        updates.videoCallActive = false;
        updates.videoCallParticipants = 0;
        updates.dataState = safeServiceUrl ? 'local' : 'setup';
        updates.dataUpdatedAt = undefined;
        break;
      case 'calendar_widget':
        {
          const current = floorsRef.current
            .find(floor => floor.id === currentFloorId)
            ?.furniture.find(item => item.id === serviceModalTargetId);
          const providerChanged = current?.calendarProvider !== serviceCalendarProvider;
          if (providerChanged || oauthStatus?.state === 'disconnected') {
            Object.assign(updates, buildOfficeOAuthWidgetReset({
              serviceType: 'calendar_widget',
              providerValue: serviceCalendarProvider,
              connected: oauthStatus?.state === 'connected',
            }));
          } else {
            updates.calendarProvider = serviceCalendarProvider;
          }
        }
        break;
      case 'figma_board':
        updates.figmaBoardUrl = safeServiceUrl;
        updates.figmaBoardConnected = false;
        updates.figmaBoardPreview = safeServiceUrl ? 'Design link ready' : undefined;
        updates.dataState = safeServiceUrl ? 'local' : 'setup';
        updates.dataUpdatedAt = undefined;
        break;
      case 'email_hub':
        {
          const current = floorsRef.current
            .find(floor => floor.id === currentFloorId)
            ?.furniture.find(item => item.id === serviceModalTargetId);
          const providerChanged = current?.emailProvider !== serviceEmailProvider;
          if (providerChanged || oauthStatus?.state === 'disconnected') {
            Object.assign(updates, buildOfficeOAuthWidgetReset({
              serviceType: 'email_hub',
              providerValue: serviceEmailProvider,
              connected: oauthStatus?.state === 'connected',
            }));
          } else {
            updates.emailProvider = serviceEmailProvider;
          }
        }
        break;
    }
    patchFurnitureStateDurably(currentFloorId, serviceModalTargetId, (item) => ({ ...item, ...updates }));
    closeServiceModal();
  };

  const handleServiceUrlChange = (value: string) => {
    setServiceUrl(value);
    if (serviceUrlError) setServiceUrlError('');
  };

  const handleServiceOpen = (url: string) => {
    if (!url) return;
    // Validate URL protocol to prevent javascript:/data:/file: injection
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:') return;
    } catch {
      return; // Invalid URL
    }
    if (Platform.OS === 'web') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      void Linking.openURL(url).catch(() => {});
    }
  };

  const invalidateOAuthProviderFurniture = useCallback((provider: OfficeOAuthProvider): boolean => (
    mutateFloorsDurably((current) => {
      let changed = false;
      const updated = current.map((floor) => {
        let floorChanged = false;
        const furniture = floor.furniture.map((item) => {
          const itemProvider: OfficeOAuthProvider | null = item.type === 'calendar_widget'
            ? (item.calendarProvider === 'outlook' ? 'microsoft' : 'google')
            : item.type === 'email_hub'
              ? (item.emailProvider === 'gmail' ? 'google' : 'microsoft')
              : null;
          if (itemProvider !== provider) return item;
          floorChanged = true;
          changed = true;
          return item.type === 'calendar_widget'
            ? {
                ...item,
                calendarEvent: 'Connect a calendar',
                calendarTime: '',
                calendarEvents: 0,
                dataState: 'setup' as const,
                dataUpdatedAt: undefined,
              }
            : {
                ...item,
                emailConnected: false,
                emailUnread: 0,
                emailSender: undefined,
                emailSubject: undefined,
                emailTime: undefined,
                dataState: 'setup' as const,
                dataUpdatedAt: undefined,
              };
        });
        return floorChanged ? { ...floor, furniture } : floor;
      });
      return changed ? updated : current;
    }, 'Saving provider-wide Office connection status…')
  ), [mutateFloorsDurably]);

  const handleServiceOAuthProviderSelect = useCallback((input: {
    serviceType: 'calendar_widget' | 'email_hub';
    value: string;
    provider: OfficeOAuthProvider;
  }) => {
    if (oauthMutationTokenRef.current !== null) return;
    const targetId = serviceModalTargetIdRef.current;
    if (!targetId || serviceModalTypeRef.current !== input.serviceType) return;
    invalidateServiceWidgetRefreshes();
    serviceOAuthGenerationRef.current += 1;
    if (input.serviceType === 'calendar_widget') {
      serviceCalendarProviderRef.current = input.value;
      setServiceCalendarProvider(input.value);
    } else {
      serviceEmailProviderRef.current = input.value;
      setServiceEmailProvider(input.value);
    }
    setOauthStatus(null);
    setOauthError('');
    void refreshServiceOAuthStatus({
      targetId,
      serviceType: input.serviceType,
      provider: input.provider,
    });
  }, [invalidateServiceWidgetRefreshes, refreshServiceOAuthStatus]);

  const handleServiceOAuthDisconnect = useCallback(async (serviceType: 'calendar_widget' | 'email_hub') => {
    if (oauthMutationTokenRef.current !== null) return;
    const targetId = serviceModalTargetIdRef.current;
    if (!targetId || serviceModalTypeRef.current !== serviceType) return;
    const provider: OfficeOAuthProvider = serviceType === 'calendar_widget'
      ? (serviceCalendarProviderRef.current === 'google' ? 'google' : 'microsoft')
      : (serviceEmailProviderRef.current === 'gmail' ? 'google' : 'microsoft');
    const requestedLayoutScope = layoutSaveScopeRef.current;
    invalidateServiceWidgetRefreshes();
    const scope = beginServiceOAuthScope({ targetId, serviceType, provider });
    serviceOAuthDisconnectControllerRef.current?.controller.abort();
    const controller = new AbortController();
    serviceOAuthDisconnectControllerRef.current = {
      generation: scope.generation,
      controller,
    };
    oauthMutationTokenRef.current = scope.generation;
    setOauthConnecting(true);
    setOauthError('');
    try {
      const disconnected = await disconnectOAuth(
        provider,
        scope.accessToken,
        () => isServiceOAuthScopeCurrent(scope),
        controller.signal,
      );
      if (!disconnected) {
        if (isServiceOAuthScopeCurrent(scope)) {
          setOauthError('Could not disconnect this provider account. Its saved credential may still be active.');
        }
        return;
      }
      // Credentials are provider-wide today, so every Calendar/Email widget
      // backed by this provider must stop claiming a live connection.
      if (
        isServiceOAuthScopeCurrent(scope)
        && requestedLayoutScope
        && layoutSaveScopeRef.current === requestedLayoutScope
      ) {
        invalidateOAuthProviderFurniture(provider);
      }
      if (isServiceOAuthScopeCurrent(scope)) {
        setOauthStatus({ state: 'disconnected', connected: false, email: '' });
        setOauthError('');
      }
    } finally {
      if (serviceOAuthDisconnectControllerRef.current?.controller === controller) {
        serviceOAuthDisconnectControllerRef.current = null;
      }
      if (
        oauthMutationTokenRef.current === scope.generation
        && !controller.signal.aborted
        && isServiceOAuthScopeCurrent(scope)
      ) {
        oauthMutationTokenRef.current = null;
        setOauthConnecting(false);
      } else if (oauthMutationTokenRef.current === scope.generation) {
        oauthMutationTokenRef.current = null;
      }
    }
  }, [beginServiceOAuthScope, invalidateOAuthProviderFurniture, invalidateServiceWidgetRefreshes, isServiceOAuthScopeCurrent]);

  const handleServiceOAuthConnect = useCallback(async (serviceType: 'calendar_widget' | 'email_hub') => {
    if (oauthMutationTokenRef.current !== null) return;
    const targetId = serviceModalTargetIdRef.current;
    if (!targetId || serviceModalTypeRef.current !== serviceType) return;
    const providerValue = serviceType === 'calendar_widget'
      ? serviceCalendarProviderRef.current
      : serviceEmailProviderRef.current;
    const provider: OfficeOAuthProvider = serviceType === 'calendar_widget'
      ? (providerValue === 'google' ? 'google' : 'microsoft')
      : (providerValue === 'gmail' ? 'google' : 'microsoft');
    invalidateServiceWidgetRefreshes();
    const scope = beginServiceOAuthScope({ targetId, serviceType, provider });
    oauthMutationTokenRef.current = scope.generation;
    setOauthConnecting(true);
    setOauthError('');
    try {
      // Start the popup synchronously inside the click event. The shared helper
      // refreshes the app session after opening its blank window, preserving
      // browser user-gesture authority even when auth storage is slow.
      const result = await openOAuthPopup(
        provider,
        serviceType === 'calendar_widget' ? 'calendar' : 'email',
        scope.accessToken,
        () => isServiceOAuthScopeCurrent(scope),
      );
      if (!isServiceOAuthScopeCurrent(scope)) return;
      if (!result.success) {
        if (result.error !== 'Window closed') setOauthError(result.error || 'Connection failed');
        return;
      }
      setOauthStatus({ state: 'connected', connected: true, email: result.email });

      if (serviceType === 'calendar_widget') {
        const calendarData = await fetchCalendarEvents(provider, scope.accessToken);
        if (!isServiceOAuthScopeCurrent(scope)) return;
        patchFurnitureStateDurably(scope.floorId, scope.targetId, item => ({
          ...item,
          calendarProvider: providerValue,
          calendarEvent: calendarData?.nextEvent?.title || 'No upcoming events',
          calendarTime: calendarData?.nextEvent?.timeFormatted || '',
          calendarEvents: calendarData?.count || 0,
          dataState: calendarData ? 'live' : 'error',
          dataUpdatedAt: calendarData ? Date.now() : undefined,
        }));
        if (!calendarData) setOauthError('Connected, but calendar events could not be refreshed yet.');
      } else {
        const emailData = await fetchEmails(provider, scope.accessToken);
        if (!isServiceOAuthScopeCurrent(scope)) return;
        const latest = emailData?.emails[0];
        patchFurnitureStateDurably(scope.floorId, scope.targetId, item => ({
          ...item,
          emailProvider: providerValue,
          emailConnected: !!emailData,
          emailUnread: emailData?.unread || 0,
          emailSender: latest?.sender || '',
          emailSubject: latest?.subject || (emailData ? 'Inbox clear' : undefined),
          emailTime: latest?.timeFormatted || '',
          dataState: emailData ? 'live' : 'error',
          dataUpdatedAt: emailData ? Date.now() : undefined,
        }));
        if (!emailData) setOauthError('Connected, but email could not be refreshed yet.');
      }
    } catch (error) {
      if (isServiceOAuthScopeCurrent(scope)) {
        setOauthError(error instanceof Error ? error.message : 'Connection failed');
      }
    } finally {
      if (oauthMutationTokenRef.current === scope.generation) {
        oauthMutationTokenRef.current = null;
        setOauthConnecting(false);
      }
    }
  }, [beginServiceOAuthScope, invalidateServiceWidgetRefreshes, isServiceOAuthScopeCurrent, patchFurnitureStateDurably]);

  const initStickyCanvas = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || stickyCanvasRef.current === canvas) return;
    stickyCanvasRef.current = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Load existing drawing if any
    const currentFloor = floors.find(f => f.id === currentFloorId);
    const item = currentFloor?.furniture.find(f => f.id === stickyEditorTargetId);
    if (item?.noteDrawing) {
      const img = new (window as any).Image();
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      img.src = item.noteDrawing;
    }
    // Set up drawing
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    let drawing = false;
    let lastX = 0, lastY = 0;
    canvas.onpointerdown = (e) => {
      drawing = true;
      const rect = canvas.getBoundingClientRect();
      lastX = (e.clientX - rect.left) * (canvas.width / rect.width);
      lastY = (e.clientY - rect.top) * (canvas.height / rect.height);
    };
    canvas.onpointermove = (e) => {
      if (!drawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      lastX = x;
      lastY = y;
    };
    canvas.onpointerup = () => { drawing = false; };
    canvas.onpointerleave = () => { drawing = false; };
  };

  const handleFurnitureMove = (id: string, x: number, y: number) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const definition = getOfficeAddonDefinition(item.type);
    const geometry = constrainOfficeFurnitureGeometry({
      x,
      y,
      itemWidth: item.itemWidth || definition.width,
      itemHeight: item.itemHeight || definition.height,
      rotation: item.rotation,
    });
    if (item.x === geometry.x && item.y === geometry.y) return;
    commitCurrentFloorEdit(`Move ${getOfficeAddonDefinition(item.type).name}`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id
        ? { ...entry, x: geometry.x, y: geometry.y }
        : entry),
    }));
  };

  const handleFurnitureResize = (id: string, w: number, h: number) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const geometry = constrainOfficeFurnitureGeometry({
      x: item.x,
      y: item.y,
      itemWidth: w,
      itemHeight: h,
      rotation: item.rotation,
    });
    if (item.x === geometry.x && item.y === geometry.y
      && item.itemWidth === geometry.itemWidth && item.itemHeight === geometry.itemHeight) return;
    commitCurrentFloorEdit(`Resize ${getOfficeAddonDefinition(item.type).name}`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id ? {
        ...entry,
        x: geometry.x,
        y: geometry.y,
        itemWidth: geometry.itemWidth,
        itemHeight: geometry.itemHeight,
      } : entry),
    }));
  };

  const handleFurnitureTransform = useCallback((
    id: string,
    fields: { x: number; y: number; itemWidth: number; itemHeight: number },
  ) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const geometry = constrainOfficeFurnitureGeometry({
      ...fields,
      rotation: item.rotation,
    });
    commitCurrentFloorEdit(`Resize ${getOfficeAddonDefinition(item.type).name}`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id ? {
        ...entry,
        x: geometry.x,
        y: geometry.y,
        itemWidth: geometry.itemWidth,
        itemHeight: geometry.itemHeight,
      } : entry),
    }));
  }, [commitCurrentFloorEdit, currentFloorId]);

  const handleFurnitureItemUpdate = (id: string, fields: Partial<FurnitureItem>) => {
    patchFurnitureStateDurably(currentFloorId, id, (item) => ({ ...item, ...fields }));
  };

  const handleFurnitureDuplicate = useCallback((id: string) => {
    const floor = floorsRef.current.find((entry) => entry.id === currentFloorId);
    const item = floor?.furniture.find((entry) => entry.id === id);
    if (!floor || !item) return;
    const definition = getOfficeAddonDefinition(item.type);
    const usedIds = new Set(floor.furniture.map((entry) => entry.id));
    const seed = `${item.id}_copy`;
    let copyId = seed;
    let suffix = 2;
    while (usedIds.has(copyId)) copyId = `${seed}_${suffix++}`;
    const geometry = constrainOfficeFurnitureGeometry({
      x: item.x + 16,
      y: item.y + 16,
      itemWidth: item.itemWidth || definition.width,
      itemHeight: item.itemHeight || definition.height,
      rotation: item.rotation,
    });
    const duplicate: FurnitureItem = {
      ...item,
      id: copyId,
      x: geometry.x,
      y: geometry.y,
      itemWidth: geometry.itemWidth,
      itemHeight: geometry.itemHeight,
      rotation: geometry.rotation,
    };
    if (!commitCurrentFloorEdit(`Duplicate ${definition.name}`, (entry) => ({
      ...entry,
      furniture: [...entry.furniture, duplicate],
    }))) return;
    rememberOfficeAddonType(item.type);
    setSelectedFurnitureId(copyId);
  }, [commitCurrentFloorEdit, currentFloorId, rememberOfficeAddonType, setSelectedFurnitureId]);

  const handleFurnitureRotate = useCallback((id: string) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const nextRotation = ((item.rotation || 0) + 90) % 360;
    const definition = getOfficeAddonDefinition(item.type);
    const geometry = constrainOfficeFurnitureGeometry({
      x: item.x,
      y: item.y,
      itemWidth: item.itemWidth || definition.width,
      itemHeight: item.itemHeight || definition.height,
      rotation: nextRotation,
    });
    commitCurrentFloorEdit(`Rotate ${getOfficeAddonDefinition(item.type).name}`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id ? {
        ...entry,
        x: geometry.x,
        y: geometry.y,
        itemWidth: geometry.itemWidth,
        itemHeight: geometry.itemHeight,
        rotation: geometry.rotation,
      } : entry),
    }));
  }, [commitCurrentFloorEdit, currentFloorId]);

  const handleFurnitureResetSize = useCallback((id: string) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const definition = getOfficeAddonDefinition(item.type);
    const geometry = constrainOfficeFurnitureGeometry({
      x: item.x,
      y: item.y,
      itemWidth: definition.width,
      itemHeight: definition.height,
      rotation: item.rotation,
    });
    commitCurrentFloorEdit(`Reset ${definition.name} size`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id
        ? {
            ...entry,
            x: geometry.x,
            y: geometry.y,
            itemWidth: geometry.itemWidth,
            itemHeight: geometry.itemHeight,
          }
        : entry),
    }));
  }, [commitCurrentFloorEdit, currentFloorId]);

  const handleFurnitureLayer = useCallback((id: string, direction: 'front' | 'back') => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    commitCurrentFloorEdit(`${direction === 'front' ? 'Bring forward' : 'Send backward'} ${getOfficeAddonDefinition(item.type).name}`, (floor) => {
      const without = floor.furniture.filter((entry) => entry.id !== id);
      return { ...floor, furniture: direction === 'front' ? [...without, item] : [item, ...without] };
    });
  }, [commitCurrentFloorEdit, currentFloorId]);

  const handleFurnitureNudge = useCallback((id: string, dx: number, dy: number) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const definition = getOfficeAddonDefinition(item.type);
    const geometry = constrainOfficeFurnitureGeometry({
      x: item.x + dx,
      y: item.y + dy,
      itemWidth: item.itemWidth || definition.width,
      itemHeight: item.itemHeight || definition.height,
      rotation: item.rotation,
    });
    if (geometry.x === item.x && geometry.y === item.y) return;
    commitCurrentFloorEdit(`Move ${definition.name}`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id
        ? { ...entry, x: geometry.x, y: geometry.y }
        : entry),
    }));
  }, [commitCurrentFloorEdit, currentFloorId]);

  const handleFurnitureResizeBy = useCallback((id: string, dw: number, dh: number) => {
    const item = floorsRef.current.find((floor) => floor.id === currentFloorId)?.furniture.find((entry) => entry.id === id);
    if (!item) return;
    const definition = getOfficeAddonDefinition(item.type);
    const currentWidth = item.itemWidth || definition.width;
    const currentHeight = item.itemHeight || definition.height;
    const geometry = constrainOfficeFurnitureGeometry({
      x: item.x,
      y: item.y,
      itemWidth: currentWidth + dw,
      itemHeight: currentHeight + dh,
      rotation: item.rotation,
    });
    if (geometry.x === item.x && geometry.y === item.y
      && geometry.itemWidth === currentWidth && geometry.itemHeight === currentHeight) return;
    commitCurrentFloorEdit(`Resize ${definition.name}`, (floor) => ({
      ...floor,
      furniture: floor.furniture.map((entry) => entry.id === id ? {
        ...entry,
        x: geometry.x,
        y: geometry.y,
        itemWidth: geometry.itemWidth,
        itemHeight: geometry.itemHeight,
      } : entry),
    }));
  }, [commitCurrentFloorEdit, currentFloorId]);

  const handleApplyOfficeRoomKit = useCallback((kitId: OfficeRoomKitId) => {
    const floor = floorsRef.current.find((entry) => entry.id === currentFloorId);
    if (!floor) return;
    const plan = planOfficeRoomKit({
      floor,
      kit: kitId,
      catalog: FURNITURE_CATALOG,
      idSeed: `${Date.now()}`,
      origin: { x: 32 + (floor.furniture.length % 3) * 96, y: 208 + (floor.furniture.length % 4) * 88 },
      bounds: { width: OFFICE_FLOOR_WIDTH, height: OFFICE_FLOOR_HEIGHT, padding: OFFICE_FLOOR_GRID_SIZE, gridSize: OFFICE_FLOOR_GRID_SIZE },
    });
    if (!plan.ok) {
      const failureMessage = {
        capacity: 'This floor has reached its item limit. Remove items before adding a room kit.',
        invalid_template: 'This room kit is unavailable because its template is invalid.',
        invalid_floor: 'The current floor data needs repair before a room kit can be added.',
        invalid_bounds: 'The current floor bounds cannot contain this room kit.',
        invalid_seed: 'The room kit could not create safe item identifiers. Try again.',
        no_free_region: 'No open region can fit this room kit. Move or remove items and try again.',
        scan_limit: 'Open regions may remain, but the bounded placement scan was exhausted. Move items closer together and retry.',
      }[plan.reason];
      setFloorPresetStatus(failureMessage);
      return;
    }
    const application = plan.application;
    if (!commitCurrentFloorEdit(`Add ${application.kit.name} kit`, () => application.floor)) return;
    if (currentUserId) officeAddonPreferencesMutatedForScopeRef.current = `${currentUserId}:${circleId}`;
    setOfficeAddonPreferences((current) => application.kit.items.reduce(
      (next, entry) => recordOfficeAddonRecentType(next, entry.type),
      current,
    ));
    setSelectedFurnitureId(application.addedItemIds[application.addedItemIds.length - 1] || null);
    setFloorPresetStatus(`${application.kit.name} added with ${application.addedItemIds.length} items. Undo is available.`);
  }, [circleId, commitCurrentFloorEdit, currentFloorId, currentUserId, setSelectedFurnitureId]);

  // ─── Interactive furniture handler ────────────────────────────────────────
  const handleFurnitureInteract = useCallback((id: string, type: FurnitureType) => {
    if (!floorLayoutHydrated || interactSending) return;
    const currentFloor = floorsRef.current.find(f => f.id === currentFloorId);
    const item = currentFloor?.furniture.find(f => f.id === id);
    if (!item) return;

    const updateFurnitureField = (fields: Partial<FurnitureItem>) => {
      patchFurnitureStateDurably(currentFloorId, id, (entry) => ({ ...entry, ...fields }));
    };

    const addFloorEffect = (effectType: string) => {
      const eff = { id: `eff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, type: effectType, x: item.x, y: item.y, createdAt: Date.now() };
      setFloorEffects(prev => [...prev, eff]);
    };

    switch (type) {
      case 'enter_key':
      case 'command_console':
        if (interactInputId === id) {
          setInteractInputId(null);
          setInteractInputText('');
          setInteractAgentTarget(null);
          setInteractSendError('');
        } else {
          setInteractInputId(id);
          setInteractInputText('');
          setInteractAgentTarget(type === 'command_console' ? (commandTargetAgents[0]?.id || null) : null);
          setInteractSendError('');
        }
        break;

      case 'button_panel': {
        const presets = item.buttonPresets?.length ? item.buttonPresets : ['Status update', 'Ship it', 'Stand up'];
        const current = (item.jukeboxTrack || 0) % presets.length;
        const cmd = presets[current];
        // A preset click stages a reviewable, single-agent command. It must
        // never silently broadcast a task or mutate its preset before Send.
        setInteractInputId(id);
        setInteractInputText(cmd);
        setInteractAgentTarget(commandTargetAgents[0]?.id || null);
        setInteractSendError('');
        break;
      }

      case 'alarm_bell':
        addFloorEffect('shake');
        break;

      case 'launch_pad':
        // Launches are side-effecting agent work, so make the destination and
        // exact command visible before dispatch. The rocket appears only once
        // durable command persistence succeeds.
        setInteractInputId(id);
        setInteractInputText('Ship it! 🚀');
        setInteractAgentTarget(commandTargetAgents[0]?.id || null);
        setInteractSendError('');
        break;

      case 'jukebox': {
        const tracks = ['Lo-fi Beats', 'Synthwave', 'Jazz Hop', 'Deep Focus', 'Ambient'];
        const next = ((item.jukeboxTrack || 0) + 1) % tracks.length;
        updateFurnitureField({ jukeboxTrack: next, label: tracks[next] });
        addFloorEffect('pulse');
        break;
      }

      case 'dice_roller': {
        const roll = Math.floor(Math.random() * 6) + 1;
        updateFurnitureField({ lastDiceRoll: roll });
        addFloorEffect('dice');
        break;
      }

      case 'gong':
        addFloorEffect('ripple');
        break;

      case 'confetti_cannon':
        addFloorEffect('confetti');
        break;

      case 'timer_display': {
        if (item.timerEnd && item.timerEnd > Date.now()) {
          updateFurnitureField({ timerEnd: undefined });
        } else {
          updateFurnitureField({ timerEnd: Date.now() + 25 * 60 * 1000 });
        }
        break;
      }

      case 'slot_machine': {
        const symbols = ['🍒', '🔔', '💎', '7️⃣', '⭐', '🍀'];
        const r1 = Math.floor(Math.random() * symbols.length);
        const r2 = Math.floor(Math.random() * symbols.length);
        const r3 = Math.floor(Math.random() * symbols.length);
        updateFurnitureField({ slotResult: [r1, r2, r3] });
        if (r1 === r2 && r2 === r3) {
          addFloorEffect('fireworks');
        }
        break;
      }

      case 'crystal_ball': {
        const fortunes = [
          'A merge conflict approaches...', 'The CI pipeline smiles upon you',
          'Beware of scope creep', 'A refactor brings clarity', 'Ship it and iterate',
          'The bug hides in the callback', 'Your PR will be approved swiftly',
          'An unexpected dependency update looms', 'Trust the types',
          'The linter knows the way', 'A deadline approaches faster than expected',
          'Your tests will save you today', 'Rubber duck debugging reveals all',
          'The docs were wrong all along', 'A senior dev reviews your code favorably',
          'Beware the off-by-one error', 'A production incident teaches wisdom',
          'The feature flag was on all along', 'Stack overflow has the answer',
          'Your branch name tells a story',
        ];
        updateFurnitureField({ fortuneText: fortunes[Math.floor(Math.random() * fortunes.length)] });
        addFloorEffect('pulse');
        break;
      }

      case 'mood_ring':
        addFloorEffect('pulse');
        break;

      case 'boom_box':
        updateFurnitureField({ boomboxPlaying: !item.boomboxPlaying });
        break;

      case 'lava_lamp': {
        const colors = ['#ef4444', '#22c55e', '#6366f1', '#f59e0b', '#a855f7', '#ffffff'];
        const currentIdx = colors.indexOf(item.lavaColor || '#ef4444');
        const nextColor = colors[(currentIdx + 1) % colors.length];
        updateFurnitureField({ lavaColor: nextColor });
        break;
      }

      case 'whack_a_mole':
        // Handled internally by the WhackAMoleItem component
        break;

      case 'fireplace': {
        const next = ((item.fireplaceIntensity ?? 1) + 1) % 3;
        updateFurnitureField({ fireplaceIntensity: next });
        addFloorEffect('pulse');
        break;
      }

      case 'aquarium': {
        // Feed the fish! They swim to the top excitedly
        updateFurnitureField({ aquariumFed: Date.now() });
        addFloorEffect('pulse');
        break;
      }

      case 'vinyl_player':
        updateFurnitureField({ vinylPlaying: !item.vinylPlaying });
        break;

      case 'rain_window':
        // Ambient — no interaction needed
        break;

      case 'galaxy_orb':
        addFloorEffect('pulse');
        break;

      case 'terrarium': {
        // Feed the creatures! They react excitedly
        updateFurnitureField({
          terrariumFed: Date.now(),
          terrariumCreature: ((item.terrariumCreature ?? 0) + 1) % 4,
        });
        addFloorEffect('pulse');
        break;
      }

      case 'zen_garden': {
        const next = ((item.zenPattern ?? 0) + 1) % 3;
        updateFurnitureField({ zenPattern: next });
        break;
      }

      case 'focus_candle':
        updateFurnitureField({ focusBurning: !item.focusBurning });
        break;

      case 'quote_board': {
        const nextQ = ((item.quoteIndex || 0) + 1) % 10;
        updateFurnitureField({ quoteIndex: nextQ });
        break;
      }

      case 'progress_bar': {
        const nextVal = ((item.progressValue || 0) + 10) % 110;
        updateFurnitureField({ progressValue: nextVal });
        if (nextVal === 100) addFloorEffect('confetti');
        break;
      }

      case 'hologram': {
        const next = ((item.hologramShape ?? 0) + 1) % 3;
        updateFurnitureField({ hologramShape: next });
        addFloorEffect('pulse');
        break;
      }

      case 'pixel_display': {
        const next = ((item.pixelScene ?? 0) + 1) % 4;
        updateFurnitureField({ pixelScene: next });
        break;
      }

      case 'spotify_jukebox': {
        if (item.spotifyUrl) handleServiceOpen(item.spotifyUrl);
        else openFurnitureConfiguration(id);
        updateFurnitureField({ dataState: item.spotifyUrl ? 'local' : 'setup', spotifyConnected: false, spotifyPlaying: false });
        break;
      }

      case 'discord_hub': {
        if (item.discordUrl) handleServiceOpen(item.discordUrl);
        else openFurnitureConfiguration(id);
        updateFurnitureField({ dataState: item.discordUrl ? 'local' : 'setup', discordConnected: false, discordStatus: 'offline', discordMemberCount: 0 });
        break;
      }

      case 'video_call': {
        if (item.videoCallLink) handleServiceOpen(item.videoCallLink);
        else openFurnitureConfiguration(id);
        updateFurnitureField({ dataState: item.videoCallLink ? 'local' : 'setup', videoCallActive: false, videoCallParticipants: 0 });
        break;
      }

      case 'message_board': {
        setActivePhoneItemId(id);
        setPhoneVisible(true);
        break;
      }

      case 'smart_tv': {
        if (!item.tvPoweredOn) {
          updateFurnitureField({ tvPoweredOn: true, tvApp: item.tvApp || 'youtube' });
        } else {
          // For non-embeddable apps with a URL, open in new tab on tap
          const nonEmbeddable = ['netflix', 'hulu', 'disney'];
          if (nonEmbeddable.includes(item.tvApp || '') && item.tvContentUrl) {
            handleServiceOpen(item.tvContentUrl);
          } else {
            const apps = ['youtube', 'netflix', 'hulu', 'disney', 'twitch'];
            const curIdx = apps.indexOf(item.tvApp || 'youtube');
            updateFurnitureField({ tvApp: apps[(curIdx + 1) % apps.length] });
            addFloorEffect('pulse');
          }
        }
        break;
      }

      case 'weather_station': {
        const conditions = ['sunny', 'cloudy', 'rainy', 'snowy'];
        const curIdx = conditions.indexOf(item.weatherCondition || 'sunny');
        const cities = ['New York', 'Tokyo', 'London', 'Paris', 'Sydney', 'Dubai', 'LA'];
        const temps: Record<string, number[]> = {
          sunny: [78, 85, 92], cloudy: [62, 68, 55], rainy: [48, 52, 58], snowy: [28, 32, 18],
        };
        const nextCond = conditions[(curIdx + 1) % conditions.length];
        const tempArr = temps[nextCond];
        updateFurnitureField({
          weatherCondition: nextCond,
          weatherTemp: tempArr[Math.floor(Math.random() * tempArr.length)],
          weatherCity: cities[Math.floor(Math.random() * cities.length)],
          dataState: 'demo',
          dataUpdatedAt: Date.now(),
        });
        break;
      }

      case 'twitch_stream': {
        if (item.twitchChannel) handleServiceOpen(`https://twitch.tv/${encodeURIComponent(item.twitchChannel)}`);
        else openFurnitureConfiguration(id);
        updateFurnitureField({ dataState: item.twitchChannel ? 'local' : 'setup', twitchLive: false, twitchViewers: 0 });
        break;
      }

      case 'pomodoro_room': {
        if (item.pomodoroBreak) {
          updateFurnitureField({ pomodoroBreak: false, pomodoroMinutes: 25 });
        } else {
          updateFurnitureField({
            pomodoroBreak: true,
            pomodoroMinutes: 5,
            pomodoroSessions: (item.pomodoroSessions || 0) + 1,
          });
          addFloorEffect('confetti');
        }
        break;
      }

      case 'retro_console': {
        setEmulatorSystem(item.emulatorSystem || 'gba');
        setEmulatorVisible(true);
        break;
      }

      case 'scrabble_board': {
        setActiveScrabbleItemId(id);
        setScrabbleVisible(true);
        break;
      }

      // ─── Game Items ──────────────────────────────────────────────────

      case 'poker_table': {
        setActivePokerItemId(id);
        setPokerVisible(true);
        break;
      }

      case 'coin_flip': {
        const result = Math.random() > 0.5 ? 'heads' : 'tails';
        const bsActive = item.coinFlipBlackswan || item.gameBlackswanActive;
        // BlackSwan always picks opposite of the likely outcome (contrarian)
        const bsPick = result === 'heads' ? 'tails' : 'heads';
        const playerWins = true; // Player always picks the result for demo
        const prevResult = item.coinFlipResult;
        const streak = prevResult === result ? (item.coinFlipStreak || 0) + 1 : 1;
        updateFurnitureField({
          coinFlipResult: result,
          coinFlipStreak: streak,
          coinFlipWins: (item.coinFlipWins || 0) + (playerWins ? 1 : 0),
          coinFlipLosses: (item.coinFlipLosses || 0) + (playerWins ? 0 : 1),
          coinFlipBlackswan: !bsActive, // Toggle BlackSwan each flip
        });
        if (streak >= 3) addFloorEffect('fireworks');
        else addFloorEffect('pulse');
        break;
      }

      case 'roulette_wheel': {
        if (item.rouletteSpinning) break;
        updateFurnitureField({
          rouletteSpinning: true,
          rouletteBetType: item.rouletteBetType || 'red',
        });
        setTimeout(() => {
          const number = Math.floor(Math.random() * 37);
          const redNums = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
          const isRed = redNums.includes(number);
          const betType = item.rouletteBetType || 'red';
          const won = (betType === 'red' && isRed) || (betType === 'black' && !isRed && number !== 0)
            || (betType === 'odd' && number % 2 === 1) || (betType === 'even' && number % 2 === 0 && number !== 0);
          updateFurnitureField({ rouletteSpinning: false, rouletteNumber: number });
          if (won) addFloorEffect('fireworks');
          const betTypes = ['red', 'black', 'odd', 'even'];
          const nextBet = betTypes[(betTypes.indexOf(betType) + 1) % betTypes.length];
          setTimeout(() => updateFurnitureField({ rouletteBetType: nextBet }), 500);
        }, 2500);
        break;
      }

      case 'chess_board': {
        const board = item.chessBoard || CHESS_INITIAL_BOARD;
        const turn = (item.chessTurn || 'white') as 'white' | 'black';

        // If game is over, tap resets
        if (item.chessGameOver) {
          updateFurnitureField({
            chessBoard: CHESS_INITIAL_BOARD,
            chessTurn: 'white',
            chessGameOver: false,
            chessSelected: undefined,
            chessCursor: undefined,
            chessLastFrom: undefined,
            chessLastTo: undefined,
            chessMoveCount: 0,
          });
          break;
        }

        const legalMoves = getChessLegalMoves(board, turn);

        // No legal moves = checkmate or stalemate
        if (legalMoves.length === 0) {
          updateFurnitureField({ chessGameOver: true });
          break;
        }

        const cursor = item.chessCursor ?? -1;
        const nextCursor = cursor + 1;

        if (nextCursor >= legalMoves.length) {
          // Wrap — execute the last highlighted move
          const [from, to] = legalMoves[Math.max(0, cursor)];
          const newBoard = applyChessMove(board, from, to);
          const nextTurn = turn === 'white' ? 'black' : 'white';
          const gameOver = isCheckmate(newBoard, nextTurn) || isStalemate(newBoard, nextTurn);

          updateFurnitureField({
            chessBoard: newBoard,
            chessTurn: nextTurn,
            chessGameOver: gameOver,
            chessSelected: undefined,
            chessCursor: undefined,
            chessLastFrom: from,
            chessLastTo: to,
            chessMoveCount: (item.chessMoveCount || 0) + 1,
          });

          // Auto-play black after a short delay (AI opponent)
          if (!gameOver && nextTurn === 'black') {
            setTimeout(() => {
              const aiMoves = getChessLegalMoves(newBoard, 'black');
              if (aiMoves.length === 0) {
                updateFurnitureField({ chessGameOver: true });
                return;
              }
              // Simple AI: pick a random legal move (prefer captures)
              const captures = aiMoves.filter(([, t]) => newBoard[t] !== '.');
              const picked = captures.length > 0
                ? captures[Math.floor(Math.random() * captures.length)]
                : aiMoves[Math.floor(Math.random() * aiMoves.length)];
              const aiBoard = applyChessMove(newBoard, picked[0], picked[1]);
              const aiGameOver = isCheckmate(aiBoard, 'white') || isStalemate(aiBoard, 'white');
              updateFurnitureField({
                chessBoard: aiBoard,
                chessTurn: 'white',
                chessGameOver: aiGameOver,
                chessSelected: undefined,
                chessCursor: undefined,
                chessLastFrom: picked[0],
                chessLastTo: picked[1],
                chessMoveCount: (item.chessMoveCount || 0) + 2,
              });
            }, 600);
          }
          if (gameOver) addFloorEffect('fireworks');
        } else {
          // Show next legal move
          const [from, to] = legalMoves[nextCursor];
          updateFurnitureField({
            chessSelected: from,
            chessCursor: nextCursor,
            chessLastFrom: undefined,
            chessLastTo: to,
          });
        }
        break;
      }

      case 'connect_four': {
        if (item.connectFourWinner) {
          updateFurnitureField({ connectFourBoard: '', connectFourTurn: 1, connectFourWinner: 0, connectFourCol: undefined, connectFourBlackswan: !item.connectFourBlackswan });
          break;
        }
        const c4board = item.connectFourBoard || '000000000000000000000000000000000000000000';
        const c4turn = item.connectFourTurn || 1;
        const c4availCols = [0, 1, 2, 3, 4, 5, 6].filter(c => c4board[c] === '0');
        if (c4availCols.length === 0) {
          updateFurnitureField({ connectFourWinner: 3 }); // draw
          break;
        }

        const c4curCol = item.connectFourCol;
        if (c4curCol === undefined || c4curCol === null) {
          // First tap: highlight first available column
          updateFurnitureField({ connectFourCol: c4availCols[0] });
          break;
        }

        // Find next available column after current
        const c4colIdx = c4availCols.indexOf(c4curCol);
        const c4nextColIdx = c4colIdx + 1;

        if (c4nextColIdx >= c4availCols.length) {
          // Wrap — drop in current column
          const dropCol = c4curCol;
          let c4targetRow = -1;
          for (let r = 5; r >= 0; r--) {
            if (c4board[r * 7 + dropCol] === '0') { c4targetRow = r; break; }
          }
          if (c4targetRow < 0) break;

          const c4idx = c4targetRow * 7 + dropCol;
          const c4newBoard = c4board.substring(0, c4idx) + String(c4turn) + c4board.substring(c4idx + 1);

          // Check for win
          if (checkConnectFourWin(c4newBoard, c4targetRow, dropCol, c4turn)) {
            updateFurnitureField({ connectFourBoard: c4newBoard, connectFourWinner: c4turn, connectFourCol: undefined });
            addFloorEffect('fireworks');
            break;
          }
          // Check for draw
          if (isConnectFourFull(c4newBoard)) {
            updateFurnitureField({ connectFourBoard: c4newBoard, connectFourWinner: 3, connectFourCol: undefined });
            break;
          }

          const c4nextTurn = c4turn === 1 ? 2 : 1;
          updateFurnitureField({ connectFourBoard: c4newBoard, connectFourTurn: c4nextTurn, connectFourCol: undefined });

          // BlackSwan AI plays after delay
          if (item.connectFourBlackswan && c4nextTurn === 2) {
            setTimeout(() => {
              const aiCol = connectFourAI(c4newBoard, 2);
              if (aiCol < 0) return;
              let aiRow = -1;
              for (let rr = 5; rr >= 0; rr--) {
                if (c4newBoard[rr * 7 + aiCol] === '0') { aiRow = rr; break; }
              }
              if (aiRow < 0) return;
              const aiIdx = aiRow * 7 + aiCol;
              const aiBoard = c4newBoard.substring(0, aiIdx) + '2' + c4newBoard.substring(aiIdx + 1);
              if (checkConnectFourWin(aiBoard, aiRow, aiCol, 2)) {
                updateFurnitureField({ connectFourBoard: aiBoard, connectFourWinner: 2, connectFourCol: undefined });
                addFloorEffect('fireworks');
                return;
              }
              if (isConnectFourFull(aiBoard)) {
                updateFurnitureField({ connectFourBoard: aiBoard, connectFourWinner: 3, connectFourCol: undefined });
                return;
              }
              updateFurnitureField({ connectFourBoard: aiBoard, connectFourTurn: 1, connectFourCol: undefined });
            }, 600);
          }
        } else {
          // Cycle to next available column
          updateFurnitureField({ connectFourCol: c4availCols[c4nextColIdx] });
        }
        break;
      }

      case 'trivia_screen': {
        const questions = [
          { q: 'What does SOL stand for?', cat: 'crypto' },
          { q: 'Who created Bitcoin?', cat: 'crypto' },
          { q: 'What is a DAO?', cat: 'crypto' },
          { q: 'What consensus does Solana use?', cat: 'crypto' },
          { q: 'What is a DEX?', cat: 'crypto' },
          { q: 'What language is React Native in?', cat: 'tech' },
          { q: 'What does API stand for?', cat: 'tech' },
          { q: 'What is TypeScript?', cat: 'tech' },
          { q: 'What is WebSocket used for?', cat: 'tech' },
          { q: 'What does RPC stand for?', cat: 'tech' },
          { q: 'How many planets in our solar system?', cat: 'general' },
          { q: 'What year was the iPhone released?', cat: 'general' },
          { q: 'What is the speed of light?', cat: 'general' },
        ];
        const qIdx = Math.floor(Math.random() * questions.length);
        const picked = questions[qIdx];
        if (item.triviaAnswer !== undefined && item.triviaAnswer >= 0) {
          const correct = item.triviaAnswer === 0;
          updateFurnitureField({
            triviaScore: (item.triviaScore || 0) + (correct ? 1 : 0),
            triviaQuestion: picked.q,
            triviaCategory: picked.cat,
            triviaAnswer: -1,
          });
          if (correct) addFloorEffect('pulse');
        } else {
          const ans = Math.floor(Math.random() * 4);
          updateFurnitureField({ triviaAnswer: ans });
        }
        break;
      }

      case 'crypto_ticker': {
        // Cycle through crypto display — rotate which coins are shown
        const allCoins = ['SOL', 'ETH', 'BTC', 'USDC', 'MATIC'];
        const curCoinsArr = (item.cryptoTickerCoins || 'SOL,ETH,BTC').split(',');
        // Shift the display window by 1
        const startIdx = allCoins.indexOf(curCoinsArr[0] || 'SOL');
        const newStart = (startIdx + 1) % allCoins.length;
        const newCoins = [0, 1, 2].map(i => allCoins[(newStart + i) % allCoins.length]);
        // Generate mock prices
        const mockPrices: Record<string, number> = { SOL: 145.23, ETH: 3842.10, BTC: 68420.50, USDC: 1.00, MATIC: 0.89 };
        const mockChanges: Record<string, number> = { SOL: 4.2, ETH: -1.3, BTC: 2.8, USDC: 0.01, MATIC: -3.1 };
        updateFurnitureField({
          cryptoTickerCoins: newCoins.join(','),
          cryptoTickerPrices: newCoins.map(c => mockPrices[c] || 0).join(','),
          cryptoTickerChanges: newCoins.map(c => mockChanges[c] || 0).join(','),
          dataState: 'demo',
          dataUpdatedAt: Date.now(),
        });
        addFloorEffect('pulse');
        break;
      }

      case 'github_feed': {
        // Cycle through demo repos
        const repos = ['swanopoly/the-underground-circle', 'vercel/next.js', 'facebook/react', 'denoland/deno'];
        const curRepo = item.githubRepo || repos[0];
        const curIdx = repos.indexOf(curRepo);
        const nextRepo = repos[(curIdx + 1) % repos.length];
        const activities = ['Push to main', 'PR merged: fix auth', 'Issue opened: bug report', 'Release v2.1.0', 'CI passed'];
        updateFurnitureField({
          githubRepo: nextRepo,
          githubActivity: activities[Math.floor(Math.random() * activities.length)],
          githubCommits: Math.floor(Math.random() * 20) + 1,
          githubPRs: Math.floor(Math.random() * 5),
          dataState: 'demo',
          dataUpdatedAt: Date.now(),
        });
        break;
      }

      case 'calendar_widget': {
        if (item.dataState !== 'live' && item.dataState !== 'stale') {
          openFurnitureConfiguration(id);
          break;
        }
        const calProv = item.calendarProvider === 'outlook' ? 'microsoft' : 'google' as OfficeOAuthProvider;
        const widgetAuthority = captureOfficeAuthority();
        if (!widgetAuthority) break;
        const refreshKey = `${circleId}:${currentFloorId}:${id}:calendar_widget:${calProv}`;
        const refreshEpoch = serviceWidgetRefreshEpochRef.current;
        const refreshGeneration = (serviceWidgetRefreshGenerationsRef.current.get(refreshKey) || 0) + 1;
        serviceWidgetRefreshGenerationsRef.current.set(refreshKey, refreshGeneration);
        const refreshIsCurrent = () => {
          const current = floorsRef.current.find(floor => floor.id === currentFloorId)?.furniture.find(entry => entry.id === id);
          return serviceWidgetRefreshEpochRef.current === refreshEpoch
            && isOfficeAuthorityCurrent(widgetAuthority)
            && serviceWidgetRefreshGenerationsRef.current.get(refreshKey) === refreshGeneration
            && current?.type === 'calendar_widget'
            && (current.calendarProvider === 'outlook' ? 'microsoft' : 'google') === calProv;
        };
        fetchCalendarEvents(calProv, widgetAuthority.accessToken).then(calData => {
          if (!refreshIsCurrent()) return;
          if (calData) {
            updateFurnitureField({
              calendarEvent: calData.nextEvent?.title || 'No upcoming events',
              calendarTime: calData.nextEvent?.timeFormatted || '',
              calendarEvents: calData.count,
              dataState: 'live',
              dataUpdatedAt: Date.now(),
            });
          } else {
            updateFurnitureField({
              dataState: 'error', dataUpdatedAt: undefined,
            });
          }
        }).catch(() => {
          if (!refreshIsCurrent()) return;
          updateFurnitureField({
            dataState: 'error', dataUpdatedAt: undefined,
          });
        });
        break;
      }

      case 'email_hub': {
        if (item.dataState !== 'live' && item.dataState !== 'stale') {
          openFurnitureConfiguration(id);
          break;
        }
        if (item.emailProvider && item.emailProvider !== 'gmail' && item.emailProvider !== 'outlook') {
          openFurnitureConfiguration(id);
          break;
        }
        const emailProv = item.emailProvider === 'gmail' ? 'google' : 'microsoft' as OfficeOAuthProvider;
        const widgetAuthority = captureOfficeAuthority();
        if (!widgetAuthority) break;
        const refreshKey = `${circleId}:${currentFloorId}:${id}:email_hub:${emailProv}`;
        const refreshEpoch = serviceWidgetRefreshEpochRef.current;
        const refreshGeneration = (serviceWidgetRefreshGenerationsRef.current.get(refreshKey) || 0) + 1;
        serviceWidgetRefreshGenerationsRef.current.set(refreshKey, refreshGeneration);
        const refreshIsCurrent = () => {
          const current = floorsRef.current.find(floor => floor.id === currentFloorId)?.furniture.find(entry => entry.id === id);
          const currentProvider = current?.emailProvider === 'gmail'
            ? 'google'
            : 'microsoft';
          return serviceWidgetRefreshEpochRef.current === refreshEpoch
            && isOfficeAuthorityCurrent(widgetAuthority)
            && serviceWidgetRefreshGenerationsRef.current.get(refreshKey) === refreshGeneration
            && current?.type === 'email_hub'
            && currentProvider === emailProv;
        };
        fetchEmails(emailProv, widgetAuthority.accessToken).then(emailData => {
          if (!refreshIsCurrent()) return;
          if (emailData) {
            const latest = emailData.emails[0];
            updateFurnitureField({
              emailSender: latest?.sender || '',
              emailSubject: latest?.subject || 'Inbox clear',
              emailTime: latest?.timeFormatted || '',
              emailUnread: emailData.unread,
              emailConnected: true,
              dataState: 'live',
              dataUpdatedAt: Date.now(),
            });
          } else {
            updateFurnitureField({
              dataState: 'error', dataUpdatedAt: undefined,
            });
          }
        }).catch(() => {
          if (!refreshIsCurrent()) return;
          updateFurnitureField({ dataState: 'error', dataUpdatedAt: undefined });
        });
        break;
      }

      case 'world_clock': {
        // Cycle timezone sets
        const zoneSets = [
          { zones: 'America/New_York,Europe/London,Asia/Tokyo', labels: 'NYC,LDN,TKY' },
          { zones: 'America/Los_Angeles,Europe/Berlin,Asia/Shanghai', labels: 'LA,BER,SHG' },
          { zones: 'America/Chicago,Asia/Dubai,Australia/Sydney', labels: 'CHI,DXB,SYD' },
        ];
        const curLabels = item.worldClockLabels || 'NYC,LDN,TKY';
        const curIdx = zoneSets.findIndex(s => s.labels === curLabels);
        const next = zoneSets[(curIdx + 1) % zoneSets.length];
        updateFurnitureField({
          worldClockZones: next.zones,
          worldClockLabels: next.labels,
        });
        addFloorEffect('pulse');
        break;
      }

      case 'music_visualizer': {
        // Toggle active + cycle style (0=bars, 1=wave, 2=circle)
        const curStyle = item.musicVisualizerStyle ?? 0;
        if (item.musicVisualizerActive) {
          updateFurnitureField({ musicVisualizerStyle: (curStyle + 1) % 3 });
        } else {
          updateFurnitureField({ musicVisualizerActive: true });
        }
        addFloorEffect('pulse');
        break;
      }

      case 'figma_board': {
        if (item.figmaBoardUrl) handleServiceOpen(item.figmaBoardUrl);
        else openFurnitureConfiguration(id);
        updateFurnitureField({ figmaBoardConnected: false, dataState: item.figmaBoardUrl ? 'local' : 'setup' });
        break;
      }

      case 'hf_explorer':
        setHfExplorerVisible(true);
        break;

      case 'hf_runner':
        setHfRunnerVisible(true);
        break;

      default:
        break;
    }
  }, [captureOfficeAuthority, circleId, commandTargetAgents, currentFloorId, floorLayoutHydrated, interactInputId, interactSending, isOfficeAuthorityCurrent, openFurnitureConfiguration, patchFurnitureStateDurably]);

  // ─── Poker player action handler (legacy — game now runs in fullscreen modal) ──
  const handlePokerAction = useCallback((_id: string, _action: string, _amount?: number) => {
    // Poker actions now handled by PokerGame component
  }, []);

  const handleInteractSubmit = useCallback(async () => {
    const commandText = interactInputText.trim();
    const requestedAuthority = captureOfficeAuthority();
    if (
      interactSending
      || !interactInputId
      || !commandText
      || !requestedAuthority
      || !currentUserName
    ) return;

    const currentFloor = floorsRef.current.find(f => f.id === currentFloorIdRef.current);
    const item = currentFloor?.furniture.find(f => f.id === interactInputId);
    if (!item) {
      setInteractSendError('This Office item is no longer available. Close the review and try again.');
      return;
    }

    const params: SendCommandParams = {
      circleId: requestedAuthority.circleId,
      senderId: requestedAuthority.userId,
      senderName: currentUserName,
      commandText,
      targetAgentName: '@all',
    };

    const requiresExactAgent = item.type === 'command_console'
      || item.type === 'button_panel'
      || item.type === 'launch_pad';
    const target = requiresExactAgent
      ? commandTargetAgents.find(agent => agent.id === interactAgentTarget)
      : null;
    if (requiresExactAgent && !target) {
      setInteractSendError('Choose an available exact agent before sending.');
      return;
    }
    if (target) {
      params.targetAgentId = target.id;
      params.targetAgentName = target.terminalTargetName;
      params.targetAgentIds = [target.id];
    }

    setInteractSending(true);
    setInteractSendError('');
    try {
      const result = await sendTerminalCommandExact(
        params,
        requestedAuthority,
        isOfficeAuthorityCurrent,
      );
      if (!isOfficeAuthorityCurrent(requestedAuthority)) return;
      if (!result.messageId || !result.receipt) {
        setInteractSendError(result.error || 'The command could not be saved. Your review is still here.');
        return;
      }
      if (!isTerminalCommandDispatchReceiptCurrent({
        receipt: result.receipt,
        expectedAuthority: requestedAuthority,
        expectedTargetFingerprint: result.receipt.target.fingerprint,
        isCurrent: isOfficeAuthorityCurrent,
      })) return;

      // Reuse the full terminal's immediate invocation seam. The durable row
      // remains authoritative; the broadcast is only a wake-up for peers.
      handleCommandSent({
        messageId: result.messageId,
        command: commandText,
        targetAgentId: params.targetAgentId ?? null,
        targetAgentIds: params.targetAgentIds ?? null,
        targetAgentName: params.targetAgentName || '@all',
        model: null,
        senderId: requestedAuthority.userId,
        authority: result.receipt.authority,
        targetFingerprint: result.receipt.target.fingerprint,
        receipt: result.receipt,
      });

      if (item.type === 'button_panel') {
        const presets = item.buttonPresets?.length ? item.buttonPresets : ['Status update', 'Ship it', 'Stand up'];
        const current = (item.jukeboxTrack || 0) % presets.length;
        patchFurnitureStateDurably(currentFloorIdRef.current, item.id, entry => ({
          ...entry,
          jukeboxTrack: current + 1,
        }));
      } else if (item.type === 'launch_pad') {
        const createdAt = Date.now();
        setFloorEffects(prev => [...prev, {
          id: `eff_${createdAt}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'rocket',
          x: item.x,
          y: item.y,
          createdAt,
        }]);
      }

      handleActionResult(result.error
        ? `Command saved for ${params.targetAgentName || '@all'}; the real-time wake-up was not confirmed.`
        : `Command queued for ${params.targetAgentName || '@all'}.`);
      setInteractInputId(null);
      setInteractInputText('');
      setInteractAgentTarget(null);
      setInteractSendError('');
    } catch (error) {
      setInteractSendError(error instanceof Error
        ? error.message
        : 'The command could not be saved. Your review is still here.');
    } finally {
      setInteractSending(false);
    }
  }, [
    captureOfficeAuthority,
    circleId,
    commandTargetAgents,
    currentUserName,
    handleActionResult,
    handleCommandSent,
    interactAgentTarget,
    interactInputId,
    interactInputText,
    interactSending,
    isOfficeAuthorityCurrent,
    patchFurnitureStateDurably,
  ]);

  const handleCommand = (cmd: OfficeCommand) => {
    if (cmd.type === 'theme') handleChangeFloorTheme(currentFloor.id, cmd.value);
    if (cmd.type === 'info') {
      const agent = agents.find(a => a.name === cmd.query);
      if (agent) setSelectedAgent(agent);
    }
  };

  const handleRenameAgent = useCallback(async (
    agent: OfficeAgent,
    newName: string,
  ): Promise<AgentIdentityExactSaveResult> => {
    const normalizedName = newName.trim();
    if (!normalizedName) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_payload' };
    }
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedAuthority) {
      return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_authority' };
    }

    const identityKey = getAgentIdentityKey(agent);
    const identitySave = await renameAgentExact(
      identityKey,
      normalizedName,
      requestedAuthority,
      isOfficeAuthorityCurrent,
    );
    if (!isOfficeAuthorityCurrent(requestedAuthority)) return identitySave;
    if (
      !identitySave.ok
      || !identitySave.localSaved
      || identitySave.serverSaved !== true
    ) return identitySave;

    const updated = {
      ...agentNames,
      [agent.id]: normalizedName,
      [identityKey]: normalizedName,
    };
    setAgentNames(updated);
    storage.setItem(privateStorageKeys.agentNames, JSON.stringify(updated)).catch(() => {});
    pushOfficePreferences({ agentNames: updated }, requestedAuthority);

    if (selectedAgent?.id === agent.id) {
      setSelectedAgent(prev => prev ? { ...prev, name: normalizedName, sessionKey: identityKey } : null);
    }

    setEnrichedAgents(prev => prev.map(existing => (
      existing.id === agent.id || existing.sessionKey === identityKey
        ? { ...existing, name: normalizedName, sessionKey: identityKey }
        : existing
    )));

    const identities = await loadAgentIdentitiesExact(requestedAuthority);
    if (isOfficeAuthorityCurrent(requestedAuthority)) setAgentIdentities(identities);
    return identitySave;
  }, [
    agentNames,
    captureOfficeAuthority,
    isOfficeAuthorityCurrent,
    privateStorageKeys.agentNames,
    pushOfficePreferences,
    selectedAgent,
  ]);

  // ─── Floor action handlers ──────────────────────────────

  const handleAddFloor = useCallback(() => {
    if (!floorLayoutHydrated) {
      setFloorPresetStatus('Finishing the Office layout load. Try adding a floor again in a moment.');
      return;
    }
    if (floorsRef.current.length >= 10) {
      setFloorPresetStatus('Office supports up to 10 floors. Remove one before adding another.');
      return;
    }
    const currentFloors = floorsRef.current;
    const usedIds = new Set(currentFloors.map((floor) => floor.id));
    let newFloorId = '';
    do {
      officeFloorIdSequenceRef.current += 1;
      newFloorId = `floor_${Date.now()}_${officeFloorIdSequenceRef.current}`;
    } while (usedIds.has(newFloorId));
    const nextNum = currentFloors.length + 1;
    const newFloor = createDefaultFloor(
      newFloorId,
      `${nextNum}F - New Floor`,
      'underground',
      currentFloors.length,
    );
    const nextFloors = [...currentFloors, newFloor];
    // Update the authority ref synchronously so rapid activations observe the
    // reservation and cannot exceed the ten-floor limit or reuse an id.
    floorsRef.current = nextFloors;
    markFloorLayoutMutation('Saving every floor item and tool…');
    setFloors(nextFloors);
    setCurrentFloorId(newFloorId);
    setEditMode(true);
    setPlacingType(null);
    setSelectedFurnitureId(null);
    setFloorPresetStatus('New floor opened. Choose a room kit or add individual items.');
  }, [circleId, floorLayoutHydrated, markFloorLayoutMutation, setPlacingType, setSelectedFurnitureId]);

  const handleDeleteFloor = useCallback(async (floorId: string) => {
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    if (!requestedScope || !floorLayoutHydrated || layoutSaveScopeRef.current !== requestedScope) return;
    const target = floorsRef.current.find((floor) => floor.id === floorId);
    if (!target || floorsRef.current.length <= 1) return;
    const confirmed = await showConfirm({
      title: `Remove ${target.name}?`,
      message: `This removes ${target.furniture.length} item${target.furniture.length === 1 ? '' : 's'} and unassigns ${target.agentIds.length} agent${target.agentIds.length === 1 ? '' : 's'} from this floor.`,
      confirmLabel: 'Remove floor',
      destructive: true,
    });
    if (
      !confirmed
      || layoutSaveScopeRef.current !== requestedScope
      || floorLayoutGenerationRef.current !== requestedGeneration
    ) return;
    const currentFloors = floorsRef.current;
    if (currentFloors.length <= 1 || !currentFloors.some((floor) => floor.id === floorId)) return;
    const updated = currentFloors
      .filter((floor) => floor.id !== floorId)
      .map((floor, index) => ({ ...floor, order: index }));
    floorsRef.current = updated;
    markFloorLayoutMutation('Saving every floor item and tool…');
    setFloors(updated);
    if (currentFloorIdRef.current === floorId) {
      setCurrentFloorId(updated[0].id);
    }
    setFloorPresetStatus(`Removed ${target.name}.`);
  }, [floorLayoutHydrated, floorLayoutScope, markFloorLayoutMutation]);

  const handleClearFloorFurniture = useCallback(async () => {
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    const targetFloorId = currentFloorIdRef.current;
    if (!requestedScope || layoutSaveScopeRef.current !== requestedScope) return;
    const floor = floorsRef.current.find((entry) => entry.id === targetFloorId);
    if (!floor || floor.furniture.length === 0) return;
    const confirmed = await showConfirm({
      title: `Clear every item from ${floor.name}?`,
      message: `This removes all ${floor.furniture.length} placed items and tools from the current floor.`,
      confirmLabel: 'Clear floor',
      destructive: true,
    });
    if (
      !confirmed
      || layoutSaveScopeRef.current !== requestedScope
      || floorLayoutGenerationRef.current !== requestedGeneration
      || currentFloorIdRef.current !== targetFloorId
    ) return;
    const cleared = commitCurrentFloorEdit(`Clear ${floor.name}`, (entry) => ({
      ...entry,
      furniture: [],
    }));
    if (!cleared) return;
    setSelectedFurnitureId(null);
    setPlacingType(null);
  }, [commitCurrentFloorEdit, floorLayoutScope, setPlacingType, setSelectedFurnitureId]);

  const handleRenameFloor = useCallback((floorId: string, newName: string): boolean => {
    if (!floorLayoutHydrated) return false;
    const safeName = sanitizeOfficeText(newName, 80);
    if (!safeName) {
      setFloorPresetStatus('Floor name cannot be empty.');
      return false;
    }
    const updated = floorsRef.current.map((floor) => floor.id === floorId ? { ...floor, name: safeName } : floor);
    floorsRef.current = updated;
    markFloorLayoutMutation('Saving every floor item and tool…');
    setFloors(updated);
    setFloorPresetStatus(`Renamed floor to “${safeName}”.`);
    return true;
  }, [floorLayoutHydrated, markFloorLayoutMutation]);

  const handleChangeFloorTheme = useCallback((floorId: string, themeId: string) => {
    if (!floorLayoutHydrated) return;
    const updated = floorsRef.current.map((floor) => floor.id === floorId ? { ...floor, themeId } : floor);
    floorsRef.current = updated;
    markFloorLayoutMutation('Saving every floor item and tool…');
    setFloors(updated);
  }, [floorLayoutHydrated, markFloorLayoutMutation]);

  const handleSwitchFloor = useCallback((floorId: string) => {
    if (!floorLayoutHydrated || !floorsRef.current.some((floor) => floor.id === floorId)) return;
    if (floorId === currentFloorId) return;
    markFloorLayoutMutation('Saving the active floor…');
    setCurrentFloorId(floorId);
    // Supabase sync handled by floors persistence useEffect
  }, [currentFloorId, floorLayoutHydrated, markFloorLayoutMutation]);

  const handleSaveCurrentFloorPreset = useCallback(async (name: string): Promise<boolean> => {
    if (floorPresetSaving) return false;
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedScope || !requestedAuthority || layoutSaveScopeRef.current !== requestedScope) return false;
    const targetFloor = floorsRef.current.find((floor) => floor.id === currentFloorIdRef.current);
    if (!targetFloor) return false;
    const requestId = ++floorPresetRequestRef.current;
    const requestIsCurrent = () => (
      floorPresetRequestRef.current === requestId
      && floorLayoutGenerationRef.current === requestedGeneration
      && layoutSaveScopeRef.current === requestedScope
      && isOfficeAuthorityCurrent(requestedAuthority)
    );
    setFloorPresetSaving(true);
    setFloorPresetStatus('Saving complete floor preset…');
    try {
      const result = await saveOfficeFloorPreset(
        { circleId, name, floor: targetFloor },
        toOfficeDashboardAuthority(requestedAuthority),
        requestIsCurrent,
      );
      if (!requestIsCurrent()) return false;
      if (!result.ok || !result.preset) {
        setFloorPresetStatus(result.error || 'Could not save this floor preset.');
        return false;
      }
      setFloorPresets((current) => [
        result.preset!,
        ...current.filter((preset) => preset.id !== result.preset!.id),
      ]);
      setFloorPresetStatus(`Saved “${result.preset.name}” with ${result.preset.snapshot.floor.furniture.length} items/tools.`);
      return true;
    } catch {
      if (!requestIsCurrent()) return false;
      setFloorPresetStatus('The Office server could not save this floor preset.');
      return false;
    } finally {
      if (requestIsCurrent()) setFloorPresetSaving(false);
    }
  }, [captureOfficeAuthority, circleId, floorLayoutScope, floorPresetSaving, isOfficeAuthorityCurrent]);

  const handleApplyFloorPreset = useCallback(async (presetId: string) => {
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    if (!requestedScope || layoutSaveScopeRef.current !== requestedScope) return;
    const preset = floorPresets.find((entry) => entry.id === presetId);
    if (!preset || preset.circleId !== circleId) return;
    const targetFloorId = currentFloorIdRef.current;
    const targetFloor = floorsRef.current.find((floor) => floor.id === targetFloorId);
    if (!targetFloor) return;
    const confirmed = await showConfirm({
      title: `Apply “${preset.name}”?`,
      message: `This replaces the theme, assigned agents, and all ${preset.snapshot.floor.furniture.length} items/tools on “${targetFloor.name}”. The floor name stays the same.`,
      confirmLabel: 'Apply preset',
    });
    if (
      !confirmed
      || layoutSaveScopeRef.current !== requestedScope
      || floorLayoutGenerationRef.current !== requestedGeneration
    ) return;
    const liveTargetFloor = floorsRef.current.find((floor) => floor.id === targetFloorId);
    if (!liveTargetFloor) return;
    const seed = `${Date.now()}_${preset.id.slice(0, 8)}`;
    const nextFloor = applyOfficeFloorPreset(preset.snapshot, liveTargetFloor, seed);
    if (!nextFloor) {
      setFloorPresetStatus('This preset is malformed and was not applied.');
      return;
    }
    if (!mutateFloorsDurably((current) => current.map((floor) => floor.id === targetFloorId ? nextFloor : floor))) return;
    setFloorPresetStatus(`Applied “${preset.name}” to ${liveTargetFloor.name}. Saving to the server…`);
  }, [floorLayoutScope, floorPresets, mutateFloorsDurably]);

  const handleDeleteFloorPreset = useCallback(async (presetId: string) => {
    const requestedScope = floorLayoutScope;
    const requestedGeneration = floorLayoutGenerationRef.current;
    const requestedAuthority = captureOfficeAuthority();
    if (!requestedScope || !requestedAuthority || layoutSaveScopeRef.current !== requestedScope) return;
    const preset = floorPresets.find((entry) => entry.id === presetId);
    if (!preset || preset.circleId !== circleId) return;
    const confirmed = await showConfirm({
      title: `Delete “${preset.name}”?`,
      message: 'This removes the saved preset. Floors that already used it are unchanged.',
      confirmLabel: 'Delete preset',
      destructive: true,
    });
    if (
      !confirmed
      || layoutSaveScopeRef.current !== requestedScope
      || floorLayoutGenerationRef.current !== requestedGeneration
      || !isOfficeAuthorityCurrent(requestedAuthority)
    ) return;
    const requestIsCurrent = () => (
      layoutSaveScopeRef.current === requestedScope
      && floorLayoutGenerationRef.current === requestedGeneration
      && isOfficeAuthorityCurrent(requestedAuthority)
    );
    const result = await deleteOfficeFloorPreset(
      preset.id,
      circleId,
      toOfficeDashboardAuthority(requestedAuthority),
      requestIsCurrent,
    );
    if (
      layoutSaveScopeRef.current !== requestedScope
      || floorLayoutGenerationRef.current !== requestedGeneration
    ) return;
    if (!result.ok) {
      setFloorPresetStatus(result.error || 'Could not delete this preset.');
      return;
    }
    setFloorPresets((current) => current.filter((entry) => entry.id !== preset.id));
    setFloorPresetStatus(`Deleted “${preset.name}”.`);
  }, [captureOfficeAuthority, circleId, floorLayoutScope, floorPresets, isOfficeAuthorityCurrent]);

  // ─── Session tagging handlers ──────────────────────────────

  const handleAddSessionTag = useCallback(async (sessionKey: string, tag: SessionTag) => {
    const requestedScope = floorLayoutScope;
    if (!requestedScope || !officeSessionStorageScope) return;
    const updated = await addSessionTag(
      sessionKey,
      tag,
      sessionTags,
      officeSessionStorageScope,
    );
    if (layoutSaveScopeRef.current === requestedScope) setSessionTags(updated);
  }, [floorLayoutScope, officeSessionStorageScope, sessionTags]);

  const handleRemoveSessionTag = useCallback(async (sessionKey: string, tagKey: string) => {
    const requestedScope = floorLayoutScope;
    if (!requestedScope || !officeSessionStorageScope) return;
    const updated = await removeSessionTag(
      sessionKey,
      tagKey,
      sessionTags,
      officeSessionStorageScope,
    );
    if (layoutSaveScopeRef.current === requestedScope) setSessionTags(updated);
  }, [floorLayoutScope, officeSessionStorageScope, sessionTags]);

  // ─── Action panel handlers ──────────────────────────────

  // ─── Budget handlers ──────────────────────────────

  const handleBudgetConfigChange = useCallback(async (config: BudgetConfig) => {
    setBudgetConfig(config);
    setBudgetAlertsDismissed(false); // Re-show alerts when config changes
  }, []);

  // ─── Idle behavior handlers ──────────────────────────────

  const handleIdleConfigChange = useCallback(async (config: IdleBehaviorConfig) => {
    const normalized = normalizeIdleConfig(config);
    setIdleConfig(normalized);
    idleConfigRef.current = normalized;
  }, []);

  // Rolling spend is server-backed. Session `totalCost` is cumulative and its
  // last-activity timestamp is not a billing ledger; assigning that whole
  // amount to a period made these values change whenever login rebuilt the
  // local session list. The Office daily aggregate covers connected-agent
  // snapshots, while claude_api_usage covers hosted work; MAX avoids counting
  // the same work twice and provides a stable tracked lower bound.
  const durableOfficeCostToday = ownDbCostRows.reduce((sum, row) => {
    const value = Number(row.estimated_cost_today || 0);
    return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
  const trackedToday = Math.max(durableOfficeCostToday, opsDurableSpendPeriods?.today || 0);
  const trackedWeek = Math.max(trackedToday, opsDurableSpendPeriods?.week || 0);
  const trackedMonth = Math.max(trackedWeek, opsDurableSpendPeriods?.month || 0);
  const periodCosts = {
    today: trackedToday,
    week: trackedWeek,
    month: trackedMonth,
  };
  const budgetAlerts = calculateBudgetAlerts(
    budgetConfig,
    periodCosts.today,
    periodCosts.week,
    periodCosts.month
  );

  if (authReady && floorLayoutScope && officeAccessError) {
    return (
      <View
        style={[
          styles.container,
          { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
        ]}
        testID="office-private-scope-blocked"
        accessibilityLabel="Office access could not be verified"
      >
        <Text style={{ color: '#f1f3f8', fontSize: 15, fontWeight: '700', textAlign: 'center' }}>
          Office access could not be verified
        </Text>
        <Text style={{ color: '#b8bac7', fontSize: 13, textAlign: 'center', maxWidth: 420 }}>
          {officeAccessError}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry Office access check"
          onPress={() => {
            initRef.current = null;
            setOfficeAccessError(null);
            setAuthAuthorityRetry((value) => value + 1);
            setOfficeAccessRetry((value) => value + 1);
          }}
          style={{
            borderRadius: 8,
            borderWidth: 1,
            borderColor: accentColor,
            paddingHorizontal: 16,
            paddingVertical: 9,
          }}
        >
          <Text style={{ color: accentColor, fontSize: 13, fontWeight: '700' }}>Retry access check</Text>
        </Pressable>
      </View>
    );
  }

  // Privacy boundary: none of the prior account/circle's roster, terminal,
  // furniture, notes, integrations, panels, or modal state may render while a
  // new exact scope is hydrating. Comparing the render-time scope with the
  // committed hydration receipt makes an account switch fail closed before
  // the reset effect has a chance to run.
  if (!authReady || !floorLayoutScope || !floorLayoutHydrated) {
    return (
      <View
        style={[
          styles.container,
          { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
        ]}
        testID="office-private-scope-loading"
        accessibilityLabel="Loading your private Office workspace"
      >
        <ActivityIndicator color={accentColor} size="small" />
        <Text style={{ color: '#b8bac7', fontSize: 13, textAlign: 'center' }}>
          Loading your private Office workspace…
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Circle-wide "Needs you" summary (plan §4a) */}
      <ChatAttentionStrip
        state={officeAttention}
        items={officeAttentionItems}
        onAction={handleOfficeAttentionAction}
        accentColor={accentColor}
      />

      {/* HITL Approval Banner — expired rows are excluded (the strip above
          declares them expired; live APPROVE on a dead window is a trap). */}
      <HitlApprovalBanner
        approvals={pendingApprovals.filter((approval) =>
          // Shared liveness predicate (approvalCardModelCore); no-timeout rows
          // age out at the 30-min staleness cap too — narrows-only.
          isRuntimeOwnedAgentApprovalActionType(approval.action_type)
          && isApprovalRowLive(approval.requested_at, approval.timeout_seconds, Date.now()),
        )}
        circleId={circleId}
        exactAuthority={approvalsAuthority}
        isExactAuthorityCurrent={isApprovalAuthorityCurrent}
      />

      {/* Tool-loop run approvals — visible + resolvable from the dashboard.
          Gated on currentUserId (mirrors ChatTab): an empty userId would make
          approve/reject a silent no-op (uuid column rejects ''). */}
      {currentUserId ? (
        <RunApprovalBanner
          circleId={circleId}
          userId={currentUserId}
          exactAuthority={approvalsAuthority}
          isExactAuthorityCurrent={isApprovalAuthorityCurrent}
        />
      ) : null}

      {/* Standing "always allow" grants — review + revoke (plan §4d) */}
      <StandingGrantsPanel accentColor={accentColor} userId={currentUserId} />

      {/* Recurring watches — list / pause / delete (plan §6a) */}
      <ComputerTaskSchedulesPanel circleId={circleId} accentColor={accentColor} />

      {/* Run detail drawer for open_run attention items (plan §6b) */}
      <RunHistoryDrawer
        key={`office-run-detail-${officeRunDetailRequestId}`}
        visible={showOfficeRunDetail}
        circleId={circleId}
        currentUserId={currentUserId}
        title="Circle Runs"
        initialRunId={officeRunDetailRefId}
        exactAuthority={committedAuthAuthority}
        isExactAuthorityCurrent={isOfficeAuthorityCurrent}
        onClose={() => setShowOfficeRunDetail(false)}
      />

      {/* D6: active computer task — phase, needs-you, stage progress */}
      {computerTaskCard?.active ? (
        <View
          style={{
            marginHorizontal: 12,
            marginTop: 6,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: computerTaskCard.needsYou.length > 0 ? '#e8b33955' : '#33415555',
            backgroundColor: computerTaskCard.needsYou.length > 0 ? '#e8b33912' : '#1e293b33',
          }}
        >
          <Text style={{ color: '#e2e8f0', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
            🖥 {computerTaskCard.title} — {computerTaskCard.phaseLabel}
          </Text>
          {computerTaskCard.needsYou.slice(0, 2).map((item, index) => (
            <Text key={`${item.kind}_${index}`} style={{ color: '#e8b339', fontSize: 11, marginTop: 2 }} numberOfLines={2}>
              ⚑ {item.kind === 'question' ? 'Needs your answer' : item.kind === 'approval' ? 'Needs your approval' : 'Blocked'}: {item.label}
            </Text>
          ))}
          {computerTaskCard.stages.length > 0 ? (
            <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }} numberOfLines={1}>
              {computerTaskCard.stages.map((stage) => (
                stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '✕' : '○'
              )).join(' ')} {computerTaskCard.stages.length} stages
            </Text>
          ) : null}
          {/* E1: escalation breadcrumbs — dim, latest switch only */}
          {computerTaskCard.surfaceChanges.length > 0 ? (
            <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }} numberOfLines={1}>
              {computerTaskCard.surfaceChanges[computerTaskCard.surfaceChanges.length - 1]}
            </Text>
          ) : null}
          {computerTaskCard.needsYou.length > 0 ? (
            <Text style={{ color: '#64748b', fontSize: 10, marginTop: 2 }} numberOfLines={1}>
              Open Chat → Use Computer to answer or approve.
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Budget Alerts */}
      {!budgetAlertsDismissed && budgetAlerts.length > 0 && (
        <BudgetAlertBanner
          alerts={budgetAlerts}
          onDismiss={() => setBudgetAlertsDismissed(true)}
          onConfigure={() => setShowCustomize(true)}
        />
      )}

      {/* O5 (P39): fail-visible bridge readiness on the main view — warns when
          the core proxy or all execution bridges are down; silent when healthy
          (the connect panel's "✓ Connected" chip owns the happy state). */}
      {!editMode ? (
        <>
          <OfficeBridgeReadinessStrip snapshot={bridgeReadinessStrip} />
          {/* X7 tail (P53): per-lane chat quality — warn/danger-only, silent when
              healthy; self-polls the session lane-health registry (P48). */}
          <OfficeLaneHealthStrip />
          {/* Passive bridge/pairing status — always-on collapsed strip, expandable
              to per-bridge rows; self-polls, no OfficeTab state. */}
          <OfficeBridgeDiagPanel />
          <OfficeConnectBridgesSection circleId={circleId} />
        </>
      ) : null}

      {/* Marquee ticker removed — too noisy for the Office view */}

      <OfficeWorkspaceSection
        floorLayoutHydrated={floorLayoutHydrated}
        viewMode={viewMode}
        floors={floors}
        displayAgents={displayAgents}
        currentFloorId={currentFloorId}
        editMode={editMode}
        currentFloor={currentFloor}
        placingType={placingType}
        selectedFurnitureId={selectedFurnitureId}
        resolveTheme={resolveTheme}
        connections={connections}
        accentColor={accentColor}
        savingSessionMemoryMode={savingSessionMemoryMode}
        sessionMemoryMode={sessionMemoryMode}
        showMcpHub={showMcpHub}
        showGitHubFeed={showGitHubFeed}
        showSoundMixer={showSoundMixer}
        showVault={showVault}
        layoutSaveState={floorLayoutSaveState}
        layoutSaveDetail={floorLayoutSaveDetail}
        floorPresets={floorPresets}
        floorPresetsLoading={floorPresetsLoading}
        floorPresetSaving={floorPresetSaving}
        floorPresetStatus={floorPresetStatus}
        onRetryLayoutSave={handleRetryFloorLayoutSave}
        onSwitchFloor={handleSwitchFloor}
        onRenameFloor={handleRenameFloor}
        onDeleteFloor={handleDeleteFloor}
        onAddFloor={handleAddFloor}
        onToggleEditMode={() => {
          if (!floorLayoutHydrated) return;
          setEditMode(!editMode);
          setPlacingType(null);
          setSelectedFurnitureId(null);
        }}
        onReconnectAll={handleReconnectAll}
        onShowRewards={() => setShowRewards(true)}
        onShowConnectAgent={() => setShowConnectAgent(true)}
        onShowCustomize={() => setShowCustomize(true)}
        onToggleSessionMemoryMode={toggleSessionMemoryMode}
        onToggleMcpHub={() => setShowMcpHub(v => !v)}
        onToggleGitHubFeed={() => setShowGitHubFeed(!showGitHubFeed)}
        onToggleSoundMixer={() => setShowSoundMixer(!showSoundMixer)}
        onToggleVault={() => setShowVault(v => !v)}
        onCancelPlacing={() => setPlacingType(null)}
        onClearFloorFurniture={handleClearFloorFurniture}
        onSaveFloorPreset={handleSaveCurrentFloorPreset}
        onApplyFloorPreset={handleApplyFloorPreset}
        onDeleteFloorPreset={handleDeleteFloorPreset}
        setPlacingType={setPlacingType}
        setActiveCatalogCat={setActiveCatalogCat}
        catalogScrollRef={catalogScrollRef}
        activeCatalogCat={activeCatalogCat}
        isDesktop={isDesktop}
        selectedFurniture={selectedFurniture}
        favoriteOfficeAddonTypes={officeAddonPreferences.favoriteTypes}
        recentOfficeAddonTypes={officeAddonPreferences.recentTypes}
        catalogPreferencesReady={officeAddonPreferencesLoadedScope === floorLayoutScope}
        historyAvailability={officeEditorHistoryAvailability}
        onUndo={() => restoreOfficeEditorHistory('undo')}
        onRedo={() => restoreOfficeEditorHistory('redo')}
        onCatalogItemPress={handleCatalogItemPress}
        onToggleCatalogFavorite={toggleOfficeAddonFavorite}
        onApplyRoomKit={handleApplyOfficeRoomKit}
        onConfigureSelected={() => selectedFurnitureId && openFurnitureConfiguration(selectedFurnitureId)}
        onDuplicateSelected={() => selectedFurnitureId && handleFurnitureDuplicate(selectedFurnitureId)}
        onRotateSelected={() => selectedFurnitureId && handleFurnitureRotate(selectedFurnitureId)}
        onResetSelectedSize={() => selectedFurnitureId && handleFurnitureResetSize(selectedFurnitureId)}
        onNudgeSelected={(dx: number, dy: number) => selectedFurnitureId && handleFurnitureNudge(selectedFurnitureId, dx, dy)}
        onResizeSelected={(dw: number, dh: number) => selectedFurnitureId && handleFurnitureResizeBy(selectedFurnitureId, dw, dh)}
        onMoveSelectedLayer={(direction: 'front' | 'back') => selectedFurnitureId && handleFurnitureLayer(selectedFurnitureId, direction)}
        onDeleteSelected={() => selectedFurnitureId ? handleFurnitureDelete(selectedFurnitureId) : Promise.resolve()}
        onSelectFurniture={(id: string) => setSelectedFurnitureId(id)}
        styles={styles}
        FURNITURE_CATALOG={FURNITURE_CATALOG}
      />

      <OfficeIntelligenceSection
        viewMode={viewMode}
        showGitHubFeed={showGitHubFeed}
        showSoundMixer={showSoundMixer}
        showVault={showVault}
        circleId={circleId}
        accentColor={accentColor}
        styles={styles}
        GitHubWallFeed={GitHubWallFeed}
        SoundMixer={SoundMixer}
        SiteCredentialVaultPanel={SiteCredentialVaultPanel}
      />


      {/* Main Content — Office Floor View */}
      <View style={[styles.mainContent, !isDesktop && editMode && { minHeight: 360 }]}>
        {/* Mobile: Card-based agent list */}
        {!isDesktop && !editMode ? (
          <ScrollView style={styles.mobileAgentScroll} showsVerticalScrollIndicator={true} contentContainerStyle={styles.mobileAgentList}>
            {/* Ops board: live builds + token spend (after the computer-task
                card above, before the agent roster). Hidden when empty. */}
            <OfficeBuildingNowCard board={opsBoard} />
            <OfficeTokensCard tracker={opsTokenTracker} />
            <OfficeAgentPlanQueue
              plans={visibleAgentPlans}
              accentColor={accentColor}
              maxItems={3}
              onOpenChat={handleOpenAgentPlanChat}
            />

            {/* Circle members' agents — shared office */}
            {mergedCircleAgents.length > 0 && (
              <CircleOfficePanel
                agents={mergedCircleAgents}
                onRefresh={loadCircleOffice}
                accentColor={accentColor}
                connectionStatus={circleConnectionStatus}
              />
            )}

            {/* Publish to Circle CTA — always show if user hasn't published yet */}
            {!mergedCircleAgents.some(a => a.isOwn) && !publishCtaDismissed && (
              <View style={{ position: 'relative' }}>
                <Pressable
                  onPress={() => {
                    const conn = connections.find(c => c.enabled);
                    openPublishAgentModal(conn);
                  }}
                  disabled={publishingToCircle}
                  style={[coStyles.publishBtn, { borderColor: accentColor + '44', opacity: publishingToCircle ? 0.6 : 1 }]}
                >
                  <Text style={coStyles.publishBtnIcon}>🏢</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[coStyles.publishBtnTitle, { color: accentColor }]}>
                      {publishingToCircle ? 'Publishing...' : 'Add your agent to the Circle Office'}
                    </Text>
                    <Text style={coStyles.publishBtnSub}>
                      {connections.some(c => c.enabled)
                        ? 'Let your circle see your agent and what it\'s building'
                        : 'Register your agent manually — no gateway required'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={dismissPublishCta}
                  hitSlop={10}
                  style={({ pressed }: any) => [
                    {
                      position: 'absolute',
                      top: 10,
                      right: 10,
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                    },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                >
                  <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '700' }}>×</Text>
                </Pressable>
              </View>
            )}
            {/* ── Agent filter chips ───────────────────────────────────── */}
            <View style={officeFilterChipStyles.row}>
              {(['all', 'mine', 'active', 'bonded'] as const).map(mode => {
                const isActive = agentFilterMode === mode;
                const count = agentFilterCounts[mode];
                return (
                  <Pressable
                    key={mode}
                    onPress={() => persistAgentFilter(mode)}
                    style={[
                      officeFilterChipStyles.chip,
                      isActive && officeFilterChipStyles.chipActive,
                      Platform.OS === 'web' && { cursor: 'pointer' } as any,
                    ]}
                  >
                    <Text style={[officeFilterChipStyles.label, isActive && officeFilterChipStyles.labelActive]}>
                      {mode === 'all' ? 'ALL' : mode === 'mine' ? 'MINE' : mode === 'active' ? 'ACTIVE' : 'BONDED'}
                    </Text>
                    <Text style={[officeFilterChipStyles.count, isActive && officeFilterChipStyles.countActive]}>
                      {count}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {userAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                {(() => {
                  const connectingConns = connections.filter(c => c.status === 'connecting');
                  const errorConns = connections.filter(c => c.status === 'error');
                  const savedConns = connections.filter(c => c.enabled);

                  if (connectingConns.length > 0) {
                    return (
                      <>
                        <ActivityIndicator color="#e8e8e8" size="large" style={{ marginBottom: 16 }} />
                        <Text style={styles.mobileEmptyTitle}>Connecting...</Text>
                        <Text style={styles.mobileEmptyText}>
                          Reaching {connectingConns[0].name}
                        </Text>
                      </>
                    );
                  }
                  if (errorConns.length > 0 && savedConns.length > 0) {
                    return (
                      <>
                        <Text style={styles.mobileEmptyIcon}>⚠️</Text>
                        <Text style={styles.mobileEmptyTitle}>Connection failed</Text>
                        {errorConns.map(c => (
                          <View key={c.id} style={{ marginBottom: 8, padding: 10, backgroundColor: '#161616', borderRadius: 8, borderWidth: 1, borderColor: '#ffffff15', width: '100%' }}>
                            <Text style={{ color: '#9e9e9e', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' }}>{c.name}</Text>
                            <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 2 }}>{c.error || 'Could not reach endpoint'}</Text>
                            <Text style={{ color: '#555', fontSize: 9, fontFamily: 'monospace', marginTop: 2 }}>{c.endpoint}</Text>
                          </View>
                        ))}
                        <Text style={{ color: '#555', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', marginBottom: 8 }}>
                          Make sure OpenSwan is running and the CORS proxy is active
                        </Text>
                        <Pressable
                          onPress={() => savedConns.forEach(c => connectOne(c))}
                          style={[{ backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff20', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10, marginBottom: 12 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                        >
                          <Text style={{ color: '#e8e8e8', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>↻ RETRY CONNECTION</Text>
                        </Pressable>
                      </>
                    );
                  }
                  return (
                    <>
                      <AgentQuickConnect circleId={circleId} onOpenWizard={() => setShowSetupWizard(true)} compact />
                      {/* Empty-state next-action chips. "Deploy an agent"
                          (office:deploy-agent handler token) opens the setup
                          wizard in-surface; /apps and /screen are chat
                          commands, so those pick navigate to Chat via the
                          existing uc:switch-tab event (visual guidance — no
                          cross-surface composer-seed plumbing exists). */}
                      <View style={{ marginTop: 20, width: '100%' }}>
                        <SuggestedTaskChips
                          suggestions={getEmptyStateSuggestions('office')}
                          onPick={(action: EmptyStateSuggestionAction) => {
                            if (action.kind === 'seed_command' && action.value === 'office:deploy-agent') {
                              setShowSetupWizard(true);
                              return;
                            }
                            // /apps + /screen live in Chat — seed the composer, then land the user there.
                            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                              const seed = action.kind === 'seed_command' ? buildComposerSeedDetail(action.value) : null;
                              try {
                                if (seed) window.dispatchEvent(new CustomEvent(SEED_EVENT_NAME, { detail: seed }));
                                window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'CHAT' } }));
                              } catch {}
                            }
                          }}
                          accentColor={accentColor}
                          nativeID="section-office-empty-suggestions"
                        />
                      </View>
                    </>
                  );
                })()}
              </View>
            ) : filteredDisplayAgents.length === 0 ? (
              <View style={styles.mobileEmpty}>
                <Text style={styles.mobileEmptyIcon}>🔍</Text>
                <Text style={styles.mobileEmptyTitle}>No {agentFilterMode === 'all' ? '' : agentFilterMode} agents</Text>
                <Text style={styles.mobileEmptyText}>
                  {agentFilterMode === 'mine' ? 'You haven\'t bonded any agents yet.'
                    : agentFilterMode === 'active' ? 'No one is working right now.'
                    : agentFilterMode === 'bonded' ? 'No persisted agents in this circle.'
                    : 'No agents to show.'}
                </Text>
                <Pressable
                  onPress={() => persistAgentFilter('all')}
                  style={{ marginTop: 12, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ffffff40', backgroundColor: '#ffffff08' }}
                >
                  <Text style={{ color: '#e8e8e8', fontSize: 11, fontWeight: '800', letterSpacing: 0.6, fontFamily: 'monospace' }}>SHOW ALL</Text>
                </Pressable>
              </View>
            ) : (
              filteredDisplayAgents.map((agent) => {
                const statusColor = getOfficeStatusColor(agent.status);
                const statusLabel = getOfficeStatusLabel(agent.status);
                const opsNodes = getOpsRunNodesForAgent(agent, opsRunNodesByAgent);
                const ordinaryOpsNodes = opsNodes.filter((node) => !node.awaitingExternalResult);
                // Shared run freshness for this agent's live/blocked run(s) —
                // freshnessRank picks the most-alive one so the roster paints
                // the same bucket/label Feed shows (reveals a wedged run a
                // static agent status can't). Acceptance-only ledgers are
                // excluded: their fresh timestamp proves receipt persistence,
                // not live provider execution.
                const runFreshness = pickFreshestRunFreshness(
                  ordinaryOpsNodes,
                  opsRunFreshness,
                );
                const awaitingConnectedAgentUpdate = opsNodes.some((node) => node.awaitingExternalResult);
                // When both kinds exist, show both and let the runtime-owned
                // freshness lead. An older accepted ledger must never hide a
                // genuinely live (or stalled) run for the same agent.
                const runStateLabel = runFreshness
                  ? awaitingConnectedAgentUpdate
                    ? `${runFreshness.label} · accepted update pending`
                    : runFreshness.label
                  : awaitingConnectedAgentUpdate
                    ? 'Accepted · awaiting update'
                    : null;
                const runStateColor = runFreshness
                  ? FRESHNESS_DOT_COLORS[runFreshness.freshness]
                  : awaitingConnectedAgentUpdate
                    ? '#38bdf8'
                    : '#64748b';
                const isSelected = selectedAgent?.id === agent.id;
                return (
                  <Pressable
                    key={agent.id}
                    onPress={() => handleAgentPress(agent.id)}
                    style={[styles.mobileAgentCard, isSelected && { borderColor: agent.color + '60', backgroundColor: agent.color + '08' },
                      Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${agent.name} agent panel`}
                    accessibilityHint={`${statusLabel}, ${agent.role}. Shows current work, controls, activity, memory, runs, and agent settings.`}
                    accessibilityState={{ selected: isSelected }}
                    {...(Platform.OS === 'web' ? ({ tabIndex: 0 } as any) : {})}
                  >
                    <View style={styles.mobileCardRow}>
                      <View style={[styles.mobileCardAvatar, { backgroundColor: agent.color + '20', borderColor: agent.color + '50' }]}>
                        <Text style={[styles.mobileCardAvatarText, { color: agent.color }]}>{agent.name.charAt(0)}</Text>
                      </View>
                      <View style={styles.mobileCardInfo}>
                        <View style={styles.mobileCardNameRow}>
                          <Text style={styles.mobileCardName}>{agent.name}</Text>
                          {agent.isProviderMain ? (
                            <Text style={[styles.mobileCardMainBadge, { color: agent.color || accentColor }]}>MAIN</Text>
                          ) : null}
                          <View style={[styles.mobileCardStatus, { backgroundColor: statusColor }]} />
                          <Text style={[styles.mobileCardStatusText, { color: statusColor }]}>{statusLabel}</Text>
                          {runStateLabel ? (
                            <>
                              <View style={[styles.mobileCardStatus, { backgroundColor: runStateColor }]} />
                              <Text
                                style={[styles.mobileCardStatusText, { color: runStateColor }]}
                                numberOfLines={1}
                              >
                                {runStateLabel}
                              </Text>
                            </>
                          ) : null}
                        </View>
                        <Text style={styles.mobileCardRole}>{agent.role} · {PROVIDER_META[agent.providerType]?.icon || '⚡'} {agent.connectionName}</Text>
                        <Text style={styles.mobileCardModel}>{agent.model}</Text>
                      </View>
                      <View style={styles.mobileCardRight}>
                        <Text style={styles.mobileCardCost}>${agent.costToday.toFixed(2)}</Text>
                        <Text style={styles.mobileCardCostLabel}>today</Text>
                      </View>
                    </View>
                    <Text style={styles.mobileCardActivity} numberOfLines={1}>{agent.activity}</Text>
                    {/* Live ops: "Now: tool" + recent tools / uptime / subagents.
                        Runs attach by display name plus canonical subject ids. */}
                    <OfficeAgentLiveOpsLines
                      ops={buildAgentLiveOps(
                        agent,
                        opsNodes,
                        Date.now(),
                      )}
                      accentColor={agent.color || accentColor}
                    />
                    {/* O1/O2 (P38): last finished outcome + 24h counts/cost,
                        plus the fail-visible bridge status note when set. */}
                    <OfficeAgentAccountabilityLine
                      entry={getOpsAccountabilityForAgent(agent, opsAccountability)}
                      statusNote={agent.statusNote}
                    />
                  </Pressable>
                );
              })
            )}

            {/* Agent Activity Feed */}
            <View style={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 8 }}>
              <Text style={{ color: '#6f6f6f', fontSize: 11, fontFamily: 'monospace', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>
                ⚡ Agent Activity
              </Text>
              <AgentActivityFeed circleId={circleId} maxHeight={320} />
            </View>

          </ScrollView>
        ) : (
          /* Desktop: Isometric office view */
          <>
            <ScrollView style={styles.officeScroll} showsVerticalScrollIndicator={true}>
              <ScrollView horizontal={needsHScroll} scrollEnabled={needsHScroll} showsHorizontalScrollIndicator={needsHScroll}>
                <View style={[styles.officeScaleOuter, { height: scaledH, width: needsHScroll ? OFFICE_FLOOR_WIDTH * officeScale : '100%' as any }]}>
                  <View style={[styles.officeWrapper, { width: OFFICE_FLOOR_WIDTH, height: OFFICE_FLOOR_HEIGHT, transform: [{ scale: officeScale }] }]}>
                    <OfficeFloorView
                      theme={currentTheme}
                      furniture={currentFloor.furniture}
                      editMode={editMode}
                      onFloorPress={editMode ? handleFloorPress : undefined}
                      onFurniturePress={editMode ? handleFurniturePress : undefined}
                      onFurnitureDelete={editMode ? handleFurnitureDelete : undefined}
                      onFurnitureMove={editMode ? handleFurnitureMove : undefined}
                      onFurnitureResize={editMode ? handleFurnitureResize : undefined}
                      onFurnitureTransform={editMode ? handleFurnitureTransform : undefined}
                      onFurnitureInteract={floorLayoutHydrated ? handleFurnitureInteract : undefined}
                      onFurnitureItemUpdate={floorLayoutHydrated ? handleFurnitureItemUpdate : undefined}
                      onPokerAction={floorLayoutHydrated ? handlePokerAction : undefined}
                      agents={agents}
                      selectedFurnitureId={editMode ? selectedFurnitureId : null}
                      agentLayer={agents.map((agent, i) => {
                        const pos = OFFICE_DESK_POSITIONS[i];
                        if (!pos) return null;
                        const opsNodes = getOpsRunNodesForAgent(agent, opsRunNodesByAgent);
                        const opsBuilding =
                          opsNodes.some((n) => !n.isSubagent) ||
                          buildAgentLiveOps(agent, opsNodes, Date.now()).subagents.active > 0;
                        const deskPlaque = buildOfficeDeskAccountabilityPlaque(
                          getOpsAccountabilityForAgent(agent, opsAccountability),
                          agent.statusNote,
                        );
                        const deskXp = buildOfficeAgentXp(
                          agent.turns || agent.messagesProcessed || 0,
                          agent.tokensUsed || 0,
                        );
                        return (
                          <View
                            key={agent.id}
                            pointerEvents={editMode ? 'none' : 'auto'}
                            accessibilityElementsHidden={editMode}
                            importantForAccessibility={editMode ? 'no-hide-descendants' : 'auto'}
                            style={[styles.agentPosition, { left: pos.x - 2, top: pos.y - 50 }]}
                          >
                            {opsBuilding ? <OfficeBuildingBadge /> : null}
                            <PixelAgent
                              agent={agent}
                              appearance={getAppearance(agent)}
                              environmentType={currentTheme.environmentType}
                              onPress={handleAgentPress}
                              selected={selectedAgent?.id === agent.id}
                              showThoughts={!editMode}
                              totalAgents={agents.length}
                              dancing={dancingAgentId === 'all' || dancingAgentId === agent.id}
                              xp={deskXp.total}
                              xpNext={deskXp.nextTotal}
                              xpLevel={deskXp.level}
                              xpIntoLevel={deskXp.intoLevel}
                              xpLevelSpan={deskXp.levelSpan}
                              xpMaxed={deskXp.maxed}
                              turns={agent.turns || agent.messagesProcessed || 0}
                              tokens={agent.tokensUsed || 0}
                              onAutomate={handleOpenAutomate}
                              plaque={deskPlaque}
                            />
                          </View>
                        );
                      })}
                    />
                    {WhiteboardView ? (
                      <WhiteboardView
                        editable={editMode}
                        notes={whiteboardNotes}
                        onNotesChange={setWhiteboardNotes}
                        agents={displayAgents}
                        statusHistory={statusHistory}
                        cronJobs={cronJobs}
                        circleId={circleId}
                        connectedCount={connections.filter(c => c.status === 'connected').length}
                        totalConnections={connections.length}
                        connections={connections}
                        pendingApprovals={pendingApprovals}
                        budgetAlerts={budgetAlerts}
                        periodCosts={periodCosts}
                        runningCost={runningCost}
                      />
                    ) : (
                      <View style={styles.desktopWidgetPlaceholder}>
                        <Text style={styles.desktopWidgetPlaceholderTitle}>Loading whiteboard…</Text>
                      </View>
                    )}
                    {ServerRackView ? (
                      <ServerRackView agents={displayAgents} />
                    ) : (
                      <View style={[styles.desktopWidgetPlaceholder, styles.desktopWidgetPlaceholderRack]}>
                        <Text style={styles.desktopWidgetPlaceholderTitle}>Loading rack…</Text>
                      </View>
                    )}
                    {userAgents.length === 0 && !anyConnected && connections.filter(c => c.status === 'connecting').length === 0 && (
                      <View style={styles.emptyOverlay}>
                        {connections.filter(c => c.status === 'error').length > 0 ? (
                          <>
                            <Text style={{ fontSize: 28, marginBottom: 8 }}>⚠️</Text>
                            <Text style={styles.emptyTitle}>Connection failed</Text>
                            <Text style={styles.emptyText}>
                              {connections.find(c => c.status === 'error')?.error || 'Could not reach agent endpoint'}
                            </Text>
                            <Pressable
                              onPress={() => connections.filter(c => c.enabled).forEach(c => connectOne(c))}
                              style={{ marginTop: 12, backgroundColor: '#ffffff10', borderWidth: 1, borderColor: '#ffffff20', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 20, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                            >
                              <Text style={{ color: '#e8e8e8', fontWeight: '700', fontSize: 12, fontFamily: 'monospace' }}>↻ RETRY</Text>
                            </Pressable>
                          </>
                        ) : (
                          <AgentQuickConnect circleId={circleId} onOpenWizard={() => setShowSetupWizard(true)} />
                        )}
                      </View>
                    )}
                    {/* Interactive furniture input overlay */}
                    {interactInputId && (() => {
                      const curFloor = floors.find(f => f.id === currentFloorId);
                      const fi = curFloor?.furniture.find(f => f.id === interactInputId);
                      if (!fi) return null;
                      const isTargetedCommand = fi.type === 'command_console'
                        || fi.type === 'button_panel'
                        || fi.type === 'launch_pad';
                      return (
                        <View style={{ position: 'absolute', left: fi.x - 10, top: fi.y + (FURNITURE_CATALOG.find(c => c.type === fi.type)?.height || 50) + 4, zIndex: 50, flexDirection: 'column', gap: 3 }} pointerEvents="box-none">
                          {isTargetedCommand && (
                            <View style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>
                              {commandTargetAgents.slice(0, 6).map(a => (
                                <Pressable
                                  key={a.id}
                                  onPress={() => setInteractAgentTarget(a.id)}
                                  disabled={interactSending}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Send reviewed command to ${a.name}`}
                                  accessibilityState={{ selected: interactAgentTarget === a.id, disabled: interactSending }}
                                  {...(Platform.OS === 'web' ? ({ 'aria-pressed': interactAgentTarget === a.id } as any) : {})}
                                  style={{
                                    minHeight: 28, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
                                    backgroundColor: interactAgentTarget === a.id ? (currentTheme.accentGlow + '40') : '#161616',
                                    borderWidth: 1, borderColor: interactAgentTarget === a.id ? currentTheme.accentGlow : '#252525',
                                    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
                                    opacity: interactSending ? 0.55 : 1,
                                  }}
                                >
                                  <Text style={{ color: interactAgentTarget === a.id ? currentTheme.accentGlow : '#9e9e9e', fontSize: 6, fontFamily: 'monospace' }}>@{a.name}</Text>
                                </Pressable>
                              ))}
                            </View>
                          )}
                          {isTargetedCommand && commandTargetAgents.length === 0 ? (
                            <Text
                              style={{ color: '#fca5a5', fontSize: 7, fontFamily: 'monospace' }}
                              accessibilityRole="alert"
                            >
                              CONNECT AN AGENT BEFORE SENDING
                            </Text>
                          ) : null}
                          {interactSendError ? (
                            <Text
                              style={{ color: '#fca5a5', fontSize: 7, fontFamily: 'monospace', maxWidth: 210 }}
                              accessibilityRole="alert"
                            >
                              {interactSendError}
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: 'row', gap: 2, alignItems: 'center' }}>
                            <TextInput
                              testID="office-command-review-input"
                              value={interactInputText}
                              onChangeText={setInteractInputText}
                              onSubmitEditing={handleInteractSubmit}
                              editable={!interactSending}
                              placeholder={isTargetedCommand ? 'Review command…' : 'Task for all agents…'}
                              placeholderTextColor="#6f6f6f"
                              autoFocus
                              accessibilityLabel={isTargetedCommand ? 'Review exact agent command' : 'Task for all agents'}
                              style={{
                                width: 136, height: 28, fontSize: 8, fontFamily: 'monospace',
                                color: '#e8e8e8', backgroundColor: '#000000', borderWidth: 1,
                                borderColor: currentTheme.accentGlow + '60', borderRadius: 4,
                                paddingHorizontal: 4, paddingVertical: 2,
                              }}
                            />
                            <Pressable
                              onPress={handleInteractSubmit}
                              disabled={interactSending || (isTargetedCommand && !interactAgentTarget)}
                              accessibilityRole="button"
                              accessibilityLabel={isTargetedCommand ? 'Send reviewed command to selected agent' : 'Send task to all agents'}
                              accessibilityState={{ disabled: interactSending || (isTargetedCommand && !interactAgentTarget), busy: interactSending }}
                              style={{
                                minWidth: 32, minHeight: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 3, backgroundColor: currentTheme.accentGlow,
                                borderRadius: 3, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
                                opacity: interactSending || (isTargetedCommand && !interactAgentTarget) ? 0.45 : 1,
                              }}
                            >
                              <Text style={{ color: '#000', fontSize: 7, fontWeight: '900', fontFamily: 'monospace' }}>{interactSending ? '…' : 'GO'}</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => { setInteractInputId(null); setInteractInputText(''); setInteractAgentTarget(null); setInteractSendError(''); }}
                              disabled={interactSending}
                              accessibilityRole="button"
                              accessibilityLabel="Close command review"
                              accessibilityState={{ disabled: interactSending }}
                              style={{ minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, paddingVertical: 3, opacity: interactSending ? 0.45 : 1, ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) }}
                            >
                              <Text style={{ color: '#9e9e9e', fontSize: 7, fontWeight: '900', fontFamily: 'monospace' }}>✕</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })()}

                    {/* Floor effects overlay */}
                    {floorEffects.map(eff => {
                      const removeEffect = () => setFloorEffects(prev => prev.filter(e => e.id !== eff.id));
                      // React 19 enforces "key must be passed directly,
                      // not via spread" — so the key stays on the JSX
                      // element and the rest of the props ride the spread.
                      const props = { x: eff.x, y: eff.y, onComplete: removeEffect };
                      switch (eff.type) {
                        case 'ripple': return <RippleEffect key={eff.id} {...props} />;
                        case 'confetti': return <ConfettiEffect key={eff.id} {...props} />;
                        case 'rocket': return <RocketEffect key={eff.id} {...props} />;
                        case 'dice': return <DiceEffect key={eff.id} {...props} />;
                        case 'pulse': return <PulseEffect key={eff.id} {...props} />;
                        case 'shake': return <ShakeEffect key={eff.id} {...props} />;
                        case 'fireworks': return <FireworksEffect key={eff.id} {...props} />;
                        default: return null;
                      }
                    })}
                  </View>
                </View>
              </ScrollView>

              {/* Ops board row — live builds + token spend beneath the floor,
                  next to the whiteboard/server-rack column. Hidden when empty. */}
              {(officeBoardHasContent(opsBoard) || officeTrackerHasContent(opsTokenTracker) || officeAgentPlanQueueHasContent(visibleAgentPlans)) ? (
                <View style={styles.opsBoardRow}>
                  <OfficeBuildingNowCard board={opsBoard} style={{ flex: 1.4, minWidth: 260 }} />
                  <OfficeTokensCard tracker={opsTokenTracker} style={{ flex: 1, minWidth: 220 }} />
                  <OfficeAgentPlanQueue
                    plans={visibleAgentPlans}
                    accentColor={accentColor}
                    maxItems={3}
                    onOpenChat={handleOpenAgentPlanChat}
                    style={{ flex: 1.2, minWidth: 260 }}
                  />
                </View>
              ) : null}
            </ScrollView>

            {/* Circle Office Panel — all members' bots */}
            {!editMode && (
              <>
                {/* Desktop publish CTA — always show if not yet published */}
                {!mergedCircleAgents.some(a => a.isOwn) && !publishCtaDismissed && (
                  <View style={{ position: 'relative' }}>
                    <Pressable
                      onPress={() => {
                        const conn = connections.find(c => c.enabled);
                        openPublishAgentModal(conn);
                      }}
                      disabled={publishingToCircle}
                      style={[coStyles.publishBtn, { borderColor: accentColor + '44', opacity: publishingToCircle ? 0.6 : 1, marginHorizontal: 8, marginTop: 4 }]}
                    >
                      <Text style={coStyles.publishBtnIcon}>🏢</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[coStyles.publishBtnTitle, { color: accentColor }]}>
                          {publishingToCircle ? 'Publishing...' : 'Add your agent to the Circle Office'}
                        </Text>
                        <Text style={coStyles.publishBtnSub}>
                          {connections.some(c => c.enabled)
                            ? 'Let your circle see your agent and what it\'s building'
                            : 'Register your agent — no gateway required'}
                        </Text>
                      </View>
                    </Pressable>
                    <Pressable
                      onPress={dismissPublishCta}
                      hitSlop={10}
                      style={({ pressed }: any) => [
                        {
                          position: 'absolute',
                          top: 14,
                          right: 18,
                          width: 24,
                          height: 24,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: pressed ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                        },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={{ color: '#cbd5e1', fontSize: 14, fontWeight: '700' }}>×</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            {/* Desktop quick bar */}
            {!editMode && (
              <View style={styles.quickBar}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickBarInner}>
                  {displayAgents.map((agent) => (
                    <Pressable
                      key={agent.id}
                      onPress={() => handleAgentPress(agent.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${agent.name} agent panel`}
                      accessibilityHint="Shows current work, controls, activity, memory, runs, and agent settings."
                      accessibilityState={{ selected: selectedAgent?.id === agent.id }}
                      style={[styles.quickChip,
                        selectedAgent?.id === agent.id && { backgroundColor: agent.color + '20', borderColor: agent.color + '60' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <View style={[styles.quickProviderDot, { backgroundColor: PROVIDER_META[agent.providerType]?.color || '#6f6f6f' }]} />
                      {agent.isProviderMain ? <Text style={[styles.quickMainMark, { color: agent.color || accentColor }]}>★</Text> : null}
                      <View style={[styles.quickDot, {
                        backgroundColor: getOfficeStatusColor(agent.status),
                      }]} />
                      <Text style={[styles.quickName, selectedAgent?.id === agent.id && { color: agent.color }]}>{agent.name}</Text>
                      <Text style={styles.quickCost}>${agent.costToday.toFixed(2)} today</Text>
                      {/* O1 (P38): 24h finished-run counts, tone by last outcome. */}
                      {(() => {
                        const acct = opsAccountability?.get(agent.name.trim().toLowerCase());
                        const counts = formatAccountabilityCounts(acct);
                        if (!counts) return null;
                        return (
                          <Text style={[styles.quickCost, { color: acct?.tone === 'danger' ? '#ef4444' : '#22c55e' }]}>
                            {counts}
                          </Text>
                        );
                      })()}
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
          </>
        )}

        {/* Keep the runtime mounted while editing so terminal history,
            subscriptions, and an in-flight response survive the mode switch.
            Its presentation is hidden to leave the full floor unobstructed. */}
          <OfficeRuntimeSection
            presentationHidden={editMode}
            terminalSize={terminalSize}
            setTerminalSize={setTerminalSize}
            setTerminalInitialTab={setTerminalInitialTab}
            styles={styles}
            accentColor={accentColor}
            OfficeTerminalView={OfficeTerminalView}
            terminalInitialTab={terminalInitialTab}
            terminalInput={terminalInput}
            setTerminalInput={setTerminalInput}
            terminalTargetId={terminalTargetId}
            terminalTargetName={terminalTargetName}
            setTerminalTargetId={setTerminalTargetId}
            setTerminalTargetName={setTerminalTargetName}
            terminalModel={terminalModel}
            setTerminalModel={setTerminalModel}
            terminalTargetIds={terminalTargetIds}
            setTerminalTargetIds={setTerminalTargetIds}
            circleId={circleId}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            terminalAuthority={committedAuthAuthority}
            isTerminalAuthorityCurrent={isOfficeAuthorityCurrent}
            mergedCircleAgents={terminalCommandAgents}
            handleCommandSent={handleCommandSent}
            providerKeys={providerKeys}
          />
      </View>

      {/* Agent detail panel (includes bridge status + power controls + remote shell) */}
      {!editMode && (
        <AgentPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          isDesktop={isDesktop}
          onRenameAgent={handleRenameAgent}
          onAgentIdentityChange={refreshAgentIdentities}
          onRemoveAgent={handleRemovePublishedAgent}
          sessionTags={sessionTags}
          sessionStorageScope={officeSessionStorageScope || undefined}
          identityAuthority={captureOfficeAuthority()}
          runtimeConnectionId={selectedAgentRuntimeConnectionId}
          onAddSessionTag={handleAddSessionTag}
          onRemoveSessionTag={handleRemoveSessionTag}
          circleId={circleId}
          appearances={selectedAgentPanelAppearances}
          onAppearanceChange={async (id, a): Promise<AgentIdentityExactSaveResult> => {
            const requestedAuthority = captureOfficeAuthority();
            if (!requestedAuthority) {
              return { ok: false, localSaved: false, serverSaved: false, error: 'invalid_authority' };
            }
            const identityKey = getAgentIdentityKey(selectedAgent) || id;
            const receipt = await updateAgentIdentityExact(
              identityKey,
              { appearance: a, isCustomized: true },
              requestedAuthority,
              isOfficeAuthorityCurrent,
            );
            if (!isOfficeAuthorityCurrent(requestedAuthority)) {
              return receipt;
            }
            if (!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true) {
              return receipt;
            }
            setAppearances(prev => ({ ...prev, [id]: a, [identityKey]: a }));
            await refreshAgentIdentities();
            return receipt;
          }}
          environmentType={currentTheme.environmentType}
          onRunCommand={handleRunCommand}
          onOpenAgentInChat={onOpenAgentInChat ? handleOpenAgentInChat : undefined}
        />
      )}

      {/* Action Result Toast */}
      {showActionResult && (
        <View style={styles.actionResultToast}>
          <Pressable
            onPress={() => setShowActionResult(false)}
            style={[styles.toastClose, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={styles.toastCloseText}>✕</Text>
          </Pressable>
          <Text style={styles.actionResultText}>{actionResult}</Text>
        </View>
      )}

      {/* ─── Manual Agent Publish Modal ───────────────────────────────── */}
      <Modal
        visible={showPublishModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPublishModal(false)}
      >
        <Pressable
          style={pmStyles.overlay}
          onPress={() => setShowPublishModal(false)}
        >
          <Pressable style={pmStyles.modal} onPress={() => {}}>
            <Text style={pmStyles.title}>Add Your Agent</Text>
            <Text style={pmStyles.subtitle}>Register your agent in the Circle Office. It will show as offline until your gateway connects.</Text>

            <Text style={pmStyles.label}>Agent Name</Text>
            <TextInput
              style={pmStyles.input}
              value={publishName}
              onChangeText={setPublishName}
              placeholder="e.g. BlackSwan, Claude Code, Codex..."
              placeholderTextColor="#555"
              autoFocus
              autoCapitalize="words"
            />

            <Text style={pmStyles.label}>Agent Type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pmStyles.providerRow}>
              {/* O7 (P39): icon/label come from PROVIDER_META (single source —
                  this array drifted: 🦞 vs 🐾 etc.). Curated agent-type ORDER
                  stays local; 'generic-agent' keeps the friendlier "Other". */}
              {([
                'openswan', 'claude-code', 'codex', 'cursor', 'gemini', 'opencode',
                'aider', 'cline', 'windsurf', 'continue', 'amp', 'generic-agent',
              ] as const).map((key) => ({
                key,
                icon: PROVIDER_META[key]?.icon || '⚡',
                label: key === 'generic-agent' ? 'Other' : (PROVIDER_META[key]?.label || key),
              })).map(p => (
                <Pressable
                  key={p.key}
                  style={[pmStyles.providerChip, publishProvider === p.key && pmStyles.providerChipActive]}
                  onPress={() => setPublishProvider(p.key)}
                >
                  <Text style={pmStyles.providerIcon}>{p.icon}</Text>
                  <Text style={[pmStyles.providerLabel, publishProvider === p.key && pmStyles.providerLabelActive]}>
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            <Pressable
              style={[pmStyles.submitBtn, (!publishName.trim() || publishingToCircle) && pmStyles.submitBtnDisabled]}
              onPress={() => handlePublishToCircle(publishName.trim(), publishProvider)}
              disabled={!publishName.trim() || publishingToCircle}
            >
              <Text style={pmStyles.submitText}>
                {publishingToCircle ? 'Publishing...' : '🏢 Add to Circle Office'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Rewards Panel Modal (lazy) */}
      {showRewards && (
        <Modal visible={showRewards} animationType="fade" presentationStyle="pageSheet">
            <RewardsPanel onClose={() => setShowRewards(false)} />
        </Modal>
      )}

      {/* Badge celebration overlay (lazy) */}
      {celebrationBadge && (
          <BadgeCelebration
            badge={celebrationBadge}
            onDismiss={() => setCelebrationBadge(null)}
          />
      )}

      {/* Agent setup wizard (lazy) */}
      {showSetupWizard && (
          <AgentSetupWizard
            visible={showSetupWizard}
            onClose={() => setShowSetupWizard(false)}
            onComplete={(conn) => {
              handleAddConnection(conn);
              setShowSetupWizard(false);
            }}
          />
      )}

      {/* Cloud agent connect modal */}
      {showConnectAgent && (
        <ConnectAgentModal
          circleId={circleId}
          onClose={() => setShowConnectAgent(false)}
        />
      )}

      {/* Customization panel */}
      <CustomizePanel
        visible={showCustomize}
        onClose={() => setShowCustomize(false)}
        currentTheme={currentFloor.themeId}
        onThemeChange={(theme) => handleChangeFloorTheme(currentFloor.id, theme)}
        agents={displayAgents}
        appearances={appearances}
        onAppearanceChange={(id, a) => setAppearances(prev => ({ ...prev, [id]: a }))}
        connections={connections}
        onAddConnection={handleAddConnection}
        onRemoveConnection={handleRemoveConnection}
        onConnectConnection={handleConnectConnection}
        onDisconnectConnection={handleDisconnectConnection}
        telegramConfig={telegramConfig}
        onTelegramConfigChange={setTelegramConfig}
        telegramConnected={telegramConnected}
        telegramBotName={telegramBotName}
        telegramChatTitle={telegramChatTitle}
        onTelegramConnect={handleTelegramConnect}
        onTelegramDisconnect={handleTelegramDisconnect}
        telegramError={telegramError}
        telegramConnecting={telegramConnecting}
        providerKeys={providerKeys}
        onProviderKeysRefresh={refreshProviderKeys}
        budgetConfig={budgetConfig}
        onBudgetConfigChange={handleBudgetConfigChange}
        idleConfig={idleConfig}
        onIdleConfigChange={handleIdleConfigChange}
        customThemes={customThemeRecords}
        onCustomThemesRefresh={refreshCustomThemes}
        circleId={circleId}
        userEmail={userEmail}
        exactAuthority={committedAuthAuthority}
        isExactAuthorityCurrent={isOfficeAuthorityCurrent}
      />

      {/* MCP Hub Panel */}
      {showMcpHub && (
        <Modal visible={showMcpHub} animationType="fade" transparent onRequestClose={() => setShowMcpHub(false)}>
          <Pressable style={nftStyles.overlay} onPress={() => setShowMcpHub(false)}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <McpPanel circleId={circleId} onClose={() => setShowMcpHub(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Image / NFT Picker Modal */}
      <Modal visible={nftPickerVisible} animationType="fade" transparent onRequestClose={() => { setNftPickerVisible(false); setNftPickerTargetId(null); }}>
        <Pressable style={nftStyles.overlay} onPress={() => { setNftPickerVisible(false); setNftPickerTargetId(null); }}>
          <Pressable style={nftStyles.card} onPress={(e) => e.stopPropagation()}>
            <View style={nftStyles.header}>
              <Text style={nftStyles.headerText}>SET IMAGE</Text>
              <Pressable onPress={() => { setNftPickerVisible(false); setNftPickerTargetId(null); }} style={nftStyles.closeBtn}>
                <Text style={nftStyles.closeText}>✕</Text>
              </Pressable>
            </View>

            {/* Tab Switcher */}
            <View style={imgPickerStyles.tabRow}>
              <Pressable
                onPress={() => setImagePickerTab('upload')}
                style={[imgPickerStyles.tab, imagePickerTab === 'upload' && imgPickerStyles.tabActive, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
              >
                <Text style={[imgPickerStyles.tabText, imagePickerTab === 'upload' && imgPickerStyles.tabTextActive]}>
                  📁  UPLOAD IMAGE
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setImagePickerTab('nft'); loadUserNfts(); }}
                style={[imgPickerStyles.tab, imagePickerTab === 'nft' && imgPickerStyles.tabActive, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
              >
                <Text style={[imgPickerStyles.tabText, imagePickerTab === 'nft' && imgPickerStyles.tabTextActive]}>
                  💎  CONNECT NFT
                </Text>
              </Pressable>
            </View>

            {/* Upload Tab */}
            {imagePickerTab === 'upload' && (
              <View style={imgPickerStyles.uploadArea}>
                <Text style={{ fontSize: 40 }}>📤</Text>
                <Text style={imgPickerStyles.uploadTitle}>Upload an image</Text>
                <Text style={imgPickerStyles.uploadHint}>JPG, PNG, GIF, or WebP — max 5 MB</Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS === 'web') {
                      (fileInputRef.current as any)?.click();
                    }
                  }}
                  style={[imgPickerStyles.uploadBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                >
                  <Text style={imgPickerStyles.uploadBtnText}>CHOOSE FILE</Text>
                </Pressable>
              </View>
            )}

            {/* NFT Tab */}
            {imagePickerTab === 'nft' && (
              <>
                {nftsLoading ? (
                  <View style={nftStyles.emptyState}>
                    <ActivityIndicator color="#e8e8e8" size="large" />
                    <Text style={nftStyles.emptyText}>Loading NFTs...</Text>
                  </View>
                ) : userNfts.length === 0 ? (
                  <View style={nftStyles.emptyState}>
                    <Text style={nftStyles.emptyIcon}>🖼</Text>
                    <Text style={nftStyles.emptyText}>No NFTs found</Text>
                    <Text style={nftStyles.emptyHint}>Connect a wallet with NFTs in your profile.</Text>
                  </View>
                ) : (
                  <ScrollView style={nftStyles.grid} contentContainerStyle={nftStyles.gridContent}>
                    {userNfts.map(nft => (
                      <Pressable key={nft.mint} onPress={() => handleNftSelect(nft)} style={nftStyles.nftCard}>
                        {nft.image ? (
                          <Image source={{ uri: nft.image }} style={nftStyles.nftImage} resizeMode="cover" />
                        ) : (
                          <View style={[nftStyles.nftImage, { backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }]}>
                            <Text style={{ fontSize: 24 }}>🖼</Text>
                          </View>
                        )}
                        <Text style={nftStyles.nftName} numberOfLines={1}>{nft.name}</Text>
                        {nft.collection && <Text style={nftStyles.nftCollection} numberOfLines={1}>{nft.collection}</Text>}
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {/* Remove image/NFT from frame */}
            {nftPickerTargetId && (() => {
              const currentFloor = floors.find(f => f.id === currentFloorId);
              const item = currentFloor?.furniture.find(f => f.id === nftPickerTargetId);
              if (item?.nftImageUrl) return (
                <Pressable onPress={() => handleNftSelect(null)} style={nftStyles.clearBtn}>
                  <Text style={nftStyles.clearText}>
                    {item.imageSource === 'upload' ? 'REMOVE IMAGE FROM FRAME' : 'REMOVE NFT FROM FRAME'}
                  </Text>
                </Pressable>
              );
              return null;
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Sticky Note Editor Modal ────────────────────────────────────── */}
      <Modal visible={stickyEditorVisible} animationType="fade" transparent onRequestClose={() => { setStickyEditorVisible(false); setStickyEditorTargetId(null); }}>
        <Pressable style={nftStyles.overlay} onPress={() => { setStickyEditorVisible(false); setStickyEditorTargetId(null); }}>
          <Pressable style={[nftStyles.card, { maxWidth: 420, maxHeight: 520 }]} onPress={(e) => e.stopPropagation()}>
            <View style={nftStyles.header}>
              <Text style={nftStyles.headerText}>STICKY NOTE</Text>
              <Pressable onPress={() => { setStickyEditorVisible(false); setStickyEditorTargetId(null); }} style={nftStyles.closeBtn}>
                <Text style={nftStyles.closeText}>✕</Text>
              </Pressable>
            </View>

            {/* Color picker row */}
            <View style={stickyStyles.colorRow}>
              {['#fef08a', '#fca5a5', '#86efac', '#93c5fd', '#c4b5fd', '#fdba74', '#f9a8d4', '#ffffff'].map(c => (
                <Pressable
                  key={c}
                  onPress={() => setStickyColor(c)}
                  style={[stickyStyles.colorDot, { backgroundColor: c }, stickyColor === c && stickyStyles.colorDotActive,
                    Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                />
              ))}
            </View>

            {/* Tab Switcher */}
            <View style={imgPickerStyles.tabRow}>
              {(['write', 'draw', 'gif'] as const).map(t => (
                <Pressable
                  key={t}
                  onPress={() => setStickyTab(t)}
                  style={[imgPickerStyles.tab, stickyTab === t && imgPickerStyles.tabActive, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                >
                  <Text style={[imgPickerStyles.tabText, stickyTab === t && imgPickerStyles.tabTextActive]}>
                    {t === 'write' ? '✏️  WRITE' : t === 'draw' ? '🎨  DRAW' : '🎞  GIF'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Write tab */}
            {stickyTab === 'write' && (
              <View style={stickyStyles.writeArea}>
                <TextInput
                  value={stickyText}
                  onChangeText={setStickyText}
                  placeholder="Type your note..."
                  placeholderTextColor="#666"
                  multiline
                  style={[stickyStyles.textInput, { backgroundColor: stickyColor }]}
                  maxLength={500}
                />
              </View>
            )}

            {/* Draw tab */}
            {stickyTab === 'draw' && Platform.OS === 'web' && (
              <View style={stickyStyles.drawArea}>
                <View style={[stickyStyles.canvasWrap, { backgroundColor: stickyColor }]}>
                  <canvas
                    ref={(el: any) => initStickyCanvas(el)}
                    width={300}
                    height={200}
                    style={{ width: '100%', height: '100%', touchAction: 'none', cursor: 'crosshair', borderRadius: 4 } as any}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    if (stickyCanvasRef.current) {
                      const ctx = stickyCanvasRef.current.getContext('2d');
                      if (ctx) ctx.clearRect(0, 0, stickyCanvasRef.current.width, stickyCanvasRef.current.height);
                    }
                  }}
                  style={[stickyStyles.clearDrawBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}
                >
                  <Text style={stickyStyles.clearDrawText}>CLEAR DRAWING</Text>
                </Pressable>
              </View>
            )}

            {/* GIF tab */}
            {stickyTab === 'gif' && (
              <View style={stickyStyles.gifArea}>
                <TextInput
                  value={stickyGifUrl}
                  onChangeText={setStickyGifUrl}
                  placeholder="Paste a GIF URL..."
                  placeholderTextColor="#666"
                  style={stickyStyles.gifInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {stickyGifUrl ? (
                  <View style={[stickyStyles.gifPreview, { backgroundColor: stickyColor }]}>
                    <Image source={{ uri: stickyGifUrl }} style={stickyStyles.gifImage} resizeMode="contain" />
                  </View>
                ) : (
                  <View style={stickyStyles.gifHint}>
                    <Text style={{ fontSize: 32 }}>🎞</Text>
                    <Text style={stickyStyles.gifHintText}>Paste a GIF URL from Giphy, Tenor, etc.</Text>
                  </View>
                )}
              </View>
            )}

            {/* Save button */}
            <Pressable onPress={handleStickyNoteSave} style={[stickyStyles.saveBtn, Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}]}>
              <Text style={stickyStyles.saveBtnText}>SAVE NOTE</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ─── Retro Emulator Modal (lazy) ──────────────────────────────── */}
      {emulatorVisible && (
          <RetroEmulator
            visible={emulatorVisible}
            onClose={() => setEmulatorVisible(false)}
            initialSystem={emulatorSystem}
          />
      )}

      {/* ─── Scrabble Game Modal (lazy) ──────────────────────────────── */}
      {scrabbleVisible && (
          <ScrabbleGame
            visible={scrabbleVisible}
            onClose={() => { setScrabbleVisible(false); setActiveScrabbleItemId(null); }}
            onStateChange={(state) => {
              patchFurnitureStateDurably(currentFloorId, activeScrabbleItemId, (item) => ({
                ...item,
                scrabbleActive: !state.gameOver,
                scrabbleScore1: state.score1,
                scrabbleScore2: state.score2,
                scrabbleTurn: state.turn,
                scrabbleWinner: state.gameOver ? state.winner : undefined,
              }));
            }}
          />
      )}

      {/* ─── Poker Game Modal (lazy) ──────────────────────────────────── */}
      {pokerVisible && (
          <PokerGame
            visible={pokerVisible}
            onClose={() => { setPokerVisible(false); setActivePokerItemId(null); }}
            agents={displayAgents}
            circleId={circleId}
            currentUserId={currentUserId || ''}
            currentUserName={currentUserName || ''}
            onStateChange={(summary) => {
              patchFurnitureStateDurably(currentFloorId, activePokerItemId, (item) => ({
                ...item,
                pokerChips: summary.playerChips,
                pokerPhase: summary.phase,
                pokerHandsWon: summary.handsWon,
                pokerHandsPlayed: summary.handsPlayed,
              }));
            }}
          />
      )}

      {/* ─── Phone Messenger Modal (lazy) ──────────────────────────────── */}
      {phoneVisible && (
          <PhoneMessenger
            key={committedAuthScopeKey}
            visible={phoneVisible}
            onClose={() => { setPhoneVisible(false); setActivePhoneItemId(null); }}
            exactAuthority={committedAuthAuthority}
            isExactAuthorityCurrent={isOfficeAuthorityCurrent}
            onUnreadCount={({ unreadCount, platform, providerLabel, userId: statusUserId, circleId: statusCircleId, generation }) => {
              const requestedAuthority = committedAuthAuthority;
              if (
                !requestedAuthority
                || statusUserId !== requestedAuthority.userId
                || statusCircleId !== requestedAuthority.circleId
                || generation !== requestedAuthority.generation
                || !isOfficeAuthorityCurrent(requestedAuthority)
              ) return;
              patchFurnitureStateDurably(currentFloorId, activePhoneItemId, (item) => ({
                ...item,
                messageCount: unreadCount,
                messageSource: platform,
                messagePreview: `${providerLabel} connected`,
                dataState: 'live',
                dataUpdatedAt: Date.now(),
              }));
            }}
          />
      )}

      {/* ─── Hugging Face Explorer Modal (lazy) ────────────────────────── */}
      {hfExplorerVisible && (
        <Modal visible={hfExplorerVisible} animationType="fade" transparent={false}>
            <HuggingFaceExplorer
              circleId={circleId}
              onClose={() => setHfExplorerVisible(false)}
              onAdded={() => {
                setHfExplorerVisible(false);
                setHfRunnerVisible(true);
              }}
            />
        </Modal>
      )}

      {/* ─── Hugging Face Runner Modal (lazy) ─────────────────────────── */}
      {hfRunnerVisible && (
        <Modal visible={hfRunnerVisible} animationType="fade" transparent={false}>
            <HfToolRunner
              circleId={circleId}
              onClose={() => setHfRunnerVisible(false)}
            />
        </Modal>
      )}

      {/* ─── Service Connector Modal ──────────────────────────────────────── */}
      <Modal visible={serviceModalVisible} animationType="fade" transparent onRequestClose={closeServiceModal}>
        <Pressable style={nftStyles.overlay} onPress={closeServiceModal}>
          <Pressable
            style={[nftStyles.card, { maxHeight: 600 }]}
            onPress={(e) => e.stopPropagation()}
            accessibilityViewIsModal
            accessibilityLabel="Office service setup"
          >
            <View style={nftStyles.header}>
              <Text style={nftStyles.headerText} accessibilityRole="header">
                {serviceModalType === 'smart_tv' ? '📺 SET UP TV' :
                 serviceModalType === 'spotify_jukebox' ? '🎧 SET UP SPOTIFY' :
                 serviceModalType === 'discord_hub' ? '💬 SET UP DISCORD' :
                 serviceModalType === 'twitch_stream' ? '🟣 SET UP TWITCH' :
                 serviceModalType === 'video_call' ? '📹 SET UP CALL' :
                 serviceModalType === 'calendar_widget' ? '📅 CONNECT CALENDAR' :
                 serviceModalType === 'email_hub' ? '📧 CONNECT EMAIL' :
                 serviceModalType === 'figma_board' ? '🎨 SET UP FIGMA' : '🔗 SET UP SERVICE'}
              </Text>
              <Pressable
                onPress={closeServiceModal}
                style={[nftStyles.closeBtn, { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }]}
                accessibilityRole="button"
                accessibilityLabel="Close service setup"
              >
                <Text style={nftStyles.closeText}>✕</Text>
              </Pressable>
            </View>

            {serviceUrlError ? (
              <Text
                style={{ color: '#fca5a5', fontSize: 11, paddingHorizontal: 16, paddingTop: 12 }}
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
              >
                {serviceUrlError}
              </Text>
            ) : null}

            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ gap: 16, paddingBottom: 20 }}>
              {/* ── Smart TV ── */}
              {serviceModalType === 'smart_tv' && (
                <>
                  <Text style={svcStyles.sectionLabel}>SELECT APP</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'youtube', name: 'YouTube', icon: '▶', color: '#FF0000', url: 'https://tv.youtube.com' },
                      { id: 'netflix', name: 'Netflix', icon: 'N', color: '#E50914', url: 'https://www.netflix.com' },
                      { id: 'hulu', name: 'Hulu', icon: 'H', color: '#1CE783', url: 'https://www.hulu.com' },
                      { id: 'disney', name: 'Disney+', icon: 'D+', color: '#0063e5', url: 'https://www.disneyplus.com' },
                      { id: 'twitch', name: 'Twitch', icon: '◉', color: '#9146FF', url: 'https://www.twitch.tv' },
                    ] as const).map(app => (
                      <Pressable
                        key={app.id}
                        onPress={() => { setServiceTvApp(app.id); handleServiceUrlChange(app.url); }}
                        style={[svcStyles.appCard, serviceTvApp === app.id && { borderColor: app.color, backgroundColor: app.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={[svcStyles.appIcon, { color: app.color }]}>{app.icon}</Text>
                        <Text style={[svcStyles.appName, serviceTvApp === app.id && { color: app.color }]}>{app.name}</Text>
                        {serviceTvApp === app.id && <Text style={[svcStyles.appCheck, { color: app.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  <Text style={svcStyles.sectionLabel}>CONTENT URL (optional)</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={handleServiceUrlChange}
                    placeholder="https://youtube.com/watch?v=..."
                    placeholderTextColor="#444"
                    accessibilityLabel="TV content URL"
                    style={svcStyles.input}
                  />

                  <Text style={svcStyles.sectionLabel}>TV SIZE</Text>
                  <View style={svcStyles.sizeRow}>
                    <View style={svcStyles.sizeField}>
                      <Text style={svcStyles.sizeLabel}>Width</Text>
                      <TextInput value={serviceTvWidth} onChangeText={setServiceTvWidth} keyboardType="number-pad" accessibilityLabel="TV width" style={svcStyles.sizeInput} />
                    </View>
                    <Text style={svcStyles.sizeX}>×</Text>
                    <View style={svcStyles.sizeField}>
                      <Text style={svcStyles.sizeLabel}>Height</Text>
                      <TextInput value={serviceTvHeight} onChangeText={setServiceTvHeight} keyboardType="number-pad" accessibilityLabel="TV height" style={svcStyles.sizeInput} />
                    </View>
                  </View>

                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : null}
                    style={[svcStyles.openBtn, !serviceUrl && { opacity: 0.4 }, Platform.OS === 'web' && { cursor: serviceUrl ? 'pointer' : 'default' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>OPEN {serviceTvApp.toUpperCase()} IN NEW TAB ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Spotify ── */}
              {serviceModalType === 'spotify_jukebox' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>🎧</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#1DB954' }]}>Spotify</Text>
                    <Text style={svcStyles.heroDesc}>Save a Spotify link for quick access. Playback is not controlled by OpenSwan.</Text>
                  </View>

                  <Pressable
                    onPress={() => handleServiceOpen('https://open.spotify.com')}
                    style={[svcStyles.connectBtn, { backgroundColor: '#1DB954' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.connectBtnText}>OPEN SPOTIFY ↗</Text>
                  </Pressable>

                  <Text style={svcStyles.sectionLabel}>SPOTIFY URL (playlist, track, or album)</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={handleServiceUrlChange}
                    placeholder="https://open.spotify.com/playlist/..."
                    placeholderTextColor="#444"
                    accessibilityLabel="Spotify URL"
                    style={svcStyles.input}
                  />
                </>
              )}

              {/* ── Discord ── */}
              {serviceModalType === 'discord_hub' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>💬</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#5865F2' }]}>Discord</Text>
                    <Text style={svcStyles.heroDesc}>Save a Discord link for quick access. Member presence is not read by OpenSwan.</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>CHANNEL NAME</Text>
                  <TextInput
                    value={serviceDiscordChannel}
                    onChangeText={setServiceDiscordChannel}
                    placeholder="general"
                    placeholderTextColor="#444"
                    accessibilityLabel="Discord channel name"
                    style={svcStyles.input}
                  />

                  <Text style={svcStyles.sectionLabel}>DISCORD INVITE OR WEBHOOK URL</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={handleServiceUrlChange}
                    placeholder="https://discord.gg/..."
                    placeholderTextColor="#444"
                    accessibilityLabel="Discord URL"
                    style={svcStyles.input}
                  />

                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : handleServiceOpen('https://discord.com/app')}
                    style={[svcStyles.connectBtn, { backgroundColor: '#5865F2' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.connectBtnText}>{serviceUrl ? 'OPEN DISCORD LINK ↗' : 'OPEN DISCORD ↗'}</Text>
                  </Pressable>
                </>
              )}

              {/* ── Twitch ── */}
              {serviceModalType === 'twitch_stream' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>🟣</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#9146FF' }]}>Twitch</Text>
                    <Text style={svcStyles.heroDesc}>Watch or display a Twitch stream in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>TWITCH CHANNEL NAME</Text>
                  <TextInput
                    value={serviceTwitchChannel}
                    onChangeText={setServiceTwitchChannel}
                    placeholder="ninja"
                    placeholderTextColor="#444"
                    accessibilityLabel="Twitch channel name"
                    style={svcStyles.input}
                  />

                  <Pressable
                    onPress={() => handleServiceOpen(`https://twitch.tv/${serviceTwitchChannel || ''}`)}
                    style={[svcStyles.connectBtn, { backgroundColor: '#9146FF' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.connectBtnText}>OPEN TWITCH ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Video Call ── */}
              {serviceModalType === 'video_call' && (
                <>
                  <Text style={svcStyles.sectionLabel}>SELECT PROVIDER</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'zoom', name: 'Zoom', icon: '🔵', color: '#2D8CFF' },
                      { id: 'meet', name: 'Google Meet', icon: '🟢', color: '#00897B' },
                      { id: 'teams', name: 'MS Teams', icon: '🟣', color: '#6264A7' },
                    ] as const).map(prov => (
                      <Pressable
                        key={prov.id}
                        onPress={() => setServiceCallProvider(prov.id)}
                        style={[svcStyles.appCard, serviceCallProvider === prov.id && { borderColor: prov.color, backgroundColor: prov.color + '15' },
                          Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={svcStyles.appIcon}>{prov.icon}</Text>
                        <Text style={[svcStyles.appName, serviceCallProvider === prov.id && { color: prov.color }]}>{prov.name}</Text>
                        {serviceCallProvider === prov.id && <Text style={[svcStyles.appCheck, { color: prov.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  <Text style={svcStyles.sectionLabel}>MEETING LINK</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={handleServiceUrlChange}
                    placeholder={serviceCallProvider === 'zoom' ? 'https://zoom.us/j/...' : serviceCallProvider === 'meet' ? 'https://meet.google.com/...' : 'https://teams.microsoft.com/...'}
                    placeholderTextColor="#444"
                    accessibilityLabel="Meeting URL"
                    style={svcStyles.input}
                  />

                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : null}
                    style={[svcStyles.openBtn, !serviceUrl && { opacity: 0.4 }, Platform.OS === 'web' && { cursor: serviceUrl ? 'pointer' : 'default' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>JOIN CALL ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Figma link ── */}
              {serviceModalType === 'figma_board' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>🎨</Text>
                    <Text style={[svcStyles.heroTitle, { color: '#a259ff' }]}>Figma</Text>
                    <Text style={svcStyles.heroDesc}>Save a Figma file or prototype link. The Office opens it without claiming a live design sync.</Text>
                  </View>
                  <Text style={svcStyles.sectionLabel}>FIGMA FILE OR PROTOTYPE URL</Text>
                  <TextInput
                    value={serviceUrl}
                    onChangeText={handleServiceUrlChange}
                    placeholder="https://www.figma.com/design/..."
                    placeholderTextColor="#444"
                    style={svcStyles.input}
                    autoCapitalize="none"
                    accessibilityLabel="Figma file or prototype URL"
                  />
                  <Pressable
                    onPress={() => serviceUrl ? handleServiceOpen(serviceUrl) : null}
                    style={[svcStyles.openBtn, !serviceUrl && { opacity: 0.4 }, Platform.OS === 'web' && { cursor: serviceUrl ? 'pointer' : 'default' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>OPEN FIGMA LINK ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Google Calendar ── */}
              {serviceModalType === 'calendar_widget' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>📅</Text>
                    <Text style={[svcStyles.heroTitle, { color: serviceCalendarProvider === 'google' ? '#4285F4' : '#0078D4' }]}>
                      {serviceCalendarProvider === 'google' ? 'Google Calendar' : 'Outlook Calendar'}
                    </Text>
                    <Text style={svcStyles.heroDesc}>Connect your real calendar to see upcoming events in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>SELECT PROVIDER</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'google', name: 'Google', icon: '📅', color: '#4285F4', oauth: 'google' as OfficeOAuthProvider },
                      { id: 'outlook', name: 'Outlook', icon: '📆', color: '#0078D4', oauth: 'microsoft' as OfficeOAuthProvider },
                    ] as const).map(cal => (
                      <Pressable
                        key={cal.id}
                        onPress={() => handleServiceOAuthProviderSelect({ serviceType: 'calendar_widget', value: cal.id, provider: cal.oauth })}
                        disabled={oauthConnecting}
                        accessibilityState={{ selected: serviceCalendarProvider === cal.id, disabled: oauthConnecting }}
                        style={[svcStyles.appCard, serviceCalendarProvider === cal.id && { borderColor: cal.color, backgroundColor: cal.color + '15' },
                          Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any,
                          oauthConnecting && { opacity: 0.55 }]}
                      >
                        <Text style={svcStyles.appIcon}>{cal.icon}</Text>
                        <Text style={[svcStyles.appName, serviceCalendarProvider === cal.id && { color: cal.color }]}>{cal.name}</Text>
                        {serviceCalendarProvider === cal.id && <Text style={[svcStyles.appCheck, { color: cal.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  {oauthStatus?.connected && (
                    <View style={{ backgroundColor: '#22c55e10', borderWidth: 1, borderColor: '#22c55e25', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />
                        <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>CONNECTED</Text>
                      </View>
                      {oauthStatus.email ? <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>{oauthStatus.email}</Text> : null}
                      <Pressable
                        onPress={() => void handleServiceOAuthDisconnect('calendar_widget')}
                        disabled={oauthConnecting}
                        accessibilityState={{ disabled: oauthConnecting, busy: oauthConnecting }}
                        style={[{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#ef444415', borderRadius: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#ef444430', opacity: oauthConnecting ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any]}
                      >
                        <Text style={{ color: '#ef4444', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' }}>DISCONNECT</Text>
                      </Pressable>
                    </View>
                  )}

                  {oauthError ? (
                    <View style={{ backgroundColor: '#ef444410', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <Text style={{ color: '#ef4444', fontSize: 10, fontFamily: 'monospace' }}>{oauthError}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    onPress={() => void handleServiceOAuthConnect('calendar_widget')}
                    disabled={oauthConnecting}
                    accessibilityState={{ disabled: oauthConnecting, busy: oauthConnecting }}
                    style={[svcStyles.connectBtn, {
                      backgroundColor: oauthConnecting ? '#333' : (serviceCalendarProvider === 'google' ? '#4285F4' : '#0078D4'),
                      flexDirection: 'row', justifyContent: 'center', gap: 8,
                    }, Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any]}
                  >
                    {oauthConnecting && <ActivityIndicator size="small" color="#fff" />}
                    <Text style={svcStyles.connectBtnText}>
                      {oauthConnecting ? 'CONNECTING...' : oauthStatus?.connected ? 'RECONNECT' : `SIGN IN WITH ${serviceCalendarProvider === 'google' ? 'GOOGLE' : 'MICROSOFT'}`}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleServiceOpen(serviceCalendarProvider === 'google' ? 'https://calendar.google.com' : 'https://outlook.live.com/calendar')}
                    style={[svcStyles.openBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>OPEN {serviceCalendarProvider === 'google' ? 'GOOGLE' : 'OUTLOOK'} CALENDAR ↗</Text>
                  </Pressable>
                </>
              )}

              {/* ── Email Hub ── */}
              {serviceModalType === 'email_hub' && (
                <>
                  <View style={svcStyles.serviceHero}>
                    <Text style={{ fontSize: 40 }}>📧</Text>
                    <Text style={[svcStyles.heroTitle, { color: serviceEmailProvider === 'outlook' ? '#0078D4' : '#EA4335' }]}>
                      {serviceEmailProvider === 'outlook' ? 'Outlook' : 'Gmail'}
                    </Text>
                    <Text style={svcStyles.heroDesc}>Connect your real inbox to see emails and unread count in your office</Text>
                  </View>

                  <Text style={svcStyles.sectionLabel}>SELECT EMAIL PROVIDER</Text>
                  <View style={svcStyles.appGrid}>
                    {([
                      { id: 'outlook', name: 'Outlook', icon: '📧', color: '#0078D4', oauth: 'microsoft' as OfficeOAuthProvider, desc: 'Outlook, Hotmail, Live, Work' },
                      { id: 'gmail', name: 'Gmail', icon: '✉️', color: '#EA4335', oauth: 'google' as OfficeOAuthProvider, desc: 'Gmail, Google Workspace' },
                    ] as const).map(em => (
                      <Pressable
                        key={em.id}
                        onPress={() => handleServiceOAuthProviderSelect({ serviceType: 'email_hub', value: em.id, provider: em.oauth })}
                        disabled={oauthConnecting}
                        accessibilityState={{ selected: serviceEmailProvider === em.id, disabled: oauthConnecting }}
                        style={[svcStyles.appCard, serviceEmailProvider === em.id && { borderColor: em.color, backgroundColor: em.color + '15' },
                          Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any, { minWidth: 85 },
                          oauthConnecting && { opacity: 0.55 }]}
                      >
                        <Text style={svcStyles.appIcon}>{em.icon}</Text>
                        <Text style={[svcStyles.appName, serviceEmailProvider === em.id && { color: em.color }]}>{em.name}</Text>
                        <Text style={{ color: '#555', fontSize: 7, fontFamily: 'monospace', marginTop: 2, textAlign: 'center' }}>{em.desc}</Text>
                        {serviceEmailProvider === em.id && <Text style={[svcStyles.appCheck, { color: em.color }]}>✓</Text>}
                      </Pressable>
                    ))}
                  </View>

                  {oauthStatus?.connected && (
                    <View style={{ backgroundColor: '#22c55e10', borderWidth: 1, borderColor: '#22c55e25', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e' }} />
                        <Text style={{ color: '#22c55e', fontSize: 11, fontWeight: '800', fontFamily: 'monospace' }}>CONNECTED</Text>
                      </View>
                      {oauthStatus.email ? <Text style={{ color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 4 }}>{oauthStatus.email}</Text> : null}
                      <Pressable
                        onPress={() => void handleServiceOAuthDisconnect('email_hub')}
                        disabled={oauthConnecting}
                        accessibilityState={{ disabled: oauthConnecting, busy: oauthConnecting }}
                        style={[{ marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#ef444415', borderRadius: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#ef444430', opacity: oauthConnecting ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any]}
                      >
                        <Text style={{ color: '#ef4444', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' }}>DISCONNECT</Text>
                      </Pressable>
                    </View>
                  )}

                  {oauthError ? (
                    <View style={{ backgroundColor: '#ef444410', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <Text style={{ color: '#ef4444', fontSize: 10, fontFamily: 'monospace' }}>{oauthError}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    onPress={() => void handleServiceOAuthConnect('email_hub')}
                    disabled={oauthConnecting}
                    accessibilityState={{ disabled: oauthConnecting, busy: oauthConnecting }}
                    style={[svcStyles.connectBtn, {
                      backgroundColor: oauthConnecting ? '#333' : (serviceEmailProvider === 'outlook' ? '#0078D4' : '#EA4335'),
                      flexDirection: 'row', justifyContent: 'center', gap: 8,
                    }, Platform.OS === 'web' && { cursor: oauthConnecting ? 'wait' : 'pointer' } as any]}
                  >
                    {oauthConnecting && <ActivityIndicator size="small" color="#fff" />}
                    <Text style={svcStyles.connectBtnText}>
                      {oauthConnecting ? 'CONNECTING...' :
                        oauthStatus?.connected ? 'RECONNECT' :
                        `SIGN IN WITH ${serviceEmailProvider === 'gmail' ? 'GOOGLE' : 'MICROSOFT'}`}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleServiceOpen(
                      serviceEmailProvider === 'gmail' ? 'https://mail.google.com' : 'https://outlook.live.com'
                    )}
                    style={[svcStyles.openBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <Text style={svcStyles.openBtnText}>
                      OPEN {serviceEmailProvider === 'gmail' ? 'GMAIL' : 'OUTLOOK'} ↗
                    </Text>
                  </Pressable>
                </>
              )}
            </ScrollView>

            {/* Save button */}
            <Pressable
              onPress={handleServiceSave}
              disabled={oauthConnecting || oauthStatus?.state === 'checking'}
              style={[svcStyles.saveBtn, { minHeight: 44, justifyContent: 'center', opacity: oauthConnecting || oauthStatus?.state === 'checking' ? 0.55 : 1 }, Platform.OS === 'web' && { cursor: oauthConnecting || oauthStatus?.state === 'checking' ? 'wait' : 'pointer' } as any]}
              accessibilityRole="button"
              accessibilityLabel="Save service setup"
              accessibilityState={{ disabled: oauthConnecting || oauthStatus?.state === 'checking', busy: oauthConnecting || oauthStatus?.state === 'checking' }}
            >
              <Text style={svcStyles.saveBtnText}>SAVE SETUP</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Hidden file input for web image upload */}
      {Platform.OS === 'web' && (
        <View style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
          <input
            ref={fileInputRef as any}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileInputChange}
          />
        </View>
      )}
    </View>
  );
}
