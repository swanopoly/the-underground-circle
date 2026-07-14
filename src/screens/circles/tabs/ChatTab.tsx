import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
  Animated,
  Image,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../../lib/supabase';
import FlatIcon from '../../../components/FlatIcon';
import MemoryViewer from '../../../components/agent/MemoryViewer';
import ChatThreadSidebar, { getInitialSidebarCollapsed, persistSidebarCollapsed } from './chat/ChatThreadSidebar';
import ChatThreadHeader from './chat/ChatThreadHeader';
import { createPrivateThread, getCircleDefaultThread, getThread, renameThread, updateThreadDefaultModel } from '../../../lib/circleChatThreads';
import RunStatusBar from '../../../components/agent/RunStatusBar';
import PluginPicker from '../../../components/agent/PluginPicker';
import MemoryToast from '../../../components/agent/MemoryToast';
import {
  getSwanBotResponse as getAIResponse,
  SwanBotContext,
  type SwanBotStructuredArtifact,
  type SwanBotStructuredResponse,
  tryHandleLocalSwanBotCommand,
} from '../../../lib/swanbot';
import type { WalletInfo, CryptoChain } from '../../../lib/crypto';
import {
  getCircleDiscordConfig, getCachedChannels, getChannelMessages,
  buildDiscordContext, isTextChannel, CircleDiscordConfig,
} from '../../../lib/discord';
import {
  createQuickPoll, createYesNoProposal, getProposals, castVote, resolveProposal,
  pinMessage, unpinMessage, getPinnedMessages,
} from '../../../lib/governance';
import { awardXP, getXPForAction } from '../../../lib/gamification';
import { executeGitHubCommand as executeGitHubChatCommand } from '../../../lib/githubChatCommands';
import { executeRoomCommand } from '../../../lib/roomChatCommands';
import { executeHfCommand } from '../../../lib/huggingFaceChatCommands';
import { extractHtmlFromStream, subscribeBuildStream } from '../../../lib/buildStream';
import { type BuilderRevision, loadBuilderHistory, pushBuilderRevision, removeBuilderRevision } from '../../../lib/builderHistory';
import { type BrandPack, buildBrandPromptPrefix, isBrandPackActive, loadBrandPack } from '../../../lib/brandPack';
import BrandPackEditor from './chat/BrandPackEditor';
import { type BuilderImage, buildImagesPromptPrefix, loadBuilderImages } from '../../../lib/builderImages';
import BuilderImagesEditor from './chat/BuilderImagesEditor';
import BuilderGithubSaveModal from './chat/BuilderGithubSaveModal';
import BuilderNetlifyDeployModal from './chat/BuilderNetlifyDeployModal';
import ChatAttachmentStrip from './chat/ChatAttachmentStrip';
import MessageCitations from './chat/MessageCitations';
import QuickActionDock from './chat/QuickActionDock';
import AutomationProposalCard from './chat/AutomationProposalCard';
import { parseAutomationRequest, type AutomationProposal } from '../../../lib/automationChatBuilder';
import { loadChatAutomationDecisions } from '../../../lib/chatAutomationDecisions';
import { buildOpenSwanAutomationInitialTask } from '../../../lib/openswanAutomationLaunch';
import { buildRepeatedFlowAutomationProposals } from '../../../lib/chatAutomationSuggestions';
import {
  buildMultiAgentDispatchPrompt,
  formatMultiAgentHelp,
  formatMultiAgentRunSummary,
  formatMultiAgentStrategyLabel,
  parseMultiAgentOrchestrationRequest,
} from '../../../lib/multiAgentDispatch';
import {
  DEFAULT_CHAT_AGENT_TARGET_ID,
  buildChatAgentSetupMessage,
  buildChatAgentTargets,
  formatChatAgentProviderLabel,
  isOpenSwanChatAgentTarget,
  resolveChatAgentTarget,
  type ChatAgentTarget,
} from '../../../lib/chatAgentTargets';
import {
  dispatchCustomAgentBridgeTask,
  supportsGenericCustomAgentDispatch,
} from '../../../lib/customAgentBridgeDispatcher';
import SearchResultsCard, { type SearchResultRow } from './chat/SearchResultsCard';
import CommandsHelpCard from './chat/CommandsHelpCard';
import AssignPickerCard, { type AssignPickerAgent } from './chat/AssignPickerCard';
import BridgeDiagCard from './chat/BridgeDiagCard';
import PreflightBlockersCard, { type PreflightBlockerItem } from './chat/PreflightBlockersCard';
import QuickReplyChips from './chat/QuickReplyChips';
import ChatAutomationPlanCard from './chat/ChatAutomationPlanCard';
import { probeBridges, type BridgeProbeResult } from '../../../lib/bridgeHealthDiag';
import { getBridgeUrl } from '../../../lib/bridgeEnvironment';
import { ensureBridgeToken, bridgeAuthHeaders } from '../../../lib/bridgeAuth';
import RunTraceCard from './chat/RunTraceCard';
import RunCostDrawer from './chat/RunCostDrawer';
import SkillAdminPanel from './chat/SkillAdminPanel';
import SpawnAgentsModal from './chat/SpawnAgentsModal';
import { createStagedFile, getSignedUrl, revokeStagedPreviews, uploadAttachment, type StagedFile } from '../../../lib/chatAttachments';
import { soulKeyForProfile, resolveModelForProfile, explainAutoModelChoice, spiritIdForProfile } from '../../../lib/serviceProfileSouls';
import BestOfNResultCard from '../../../components/BestOfNResultCard';
import type { PersistedBestOfNRace } from '../../../lib/persistedChatMetadata';
import { canUseAnthropicChatStream } from '../../../lib/blackswanRouting';
import { analyzeMessageRouting } from '../../../lib/messageRouting';
import { dispatchBridgeTask, sendTerminalAgentSessionMessage, wakeAndAssignTask } from '../../../lib/bridgeTaskDispatcher';
import SpawnAgentPanel from '../../../components/SpawnAgentPanel';
import { storage } from '../../../lib/storage';
import ProposalCard from '../../../components/ProposalCard';
import StepAwayCard from '../../../components/StepAwayCard';
import { Proposal, PinnedMessage } from '../../../types';
import { executeAgentRun, detectHandoff, HandoffSuggestion } from '../../../lib/agentRuntime';
import HandoffCard from '../../../components/agent/HandoffCard';
import AgentModeSelector from '../../../components/agent/AgentModeSelector';
import AddModelPanel from '../../../components/models/AddModelPanel';
import type { ModelGroup } from '../../../lib/integrations/modelProviderRegistry';
import { pickAttachments, ChatAttachment, getMediaTypeIcon, prepareImageForAI, buildAttachmentPromptContext } from '../../../lib/chatMedia';
import { buildFigmaPromptFromReferences, resolveFigmaReferences, type FigmaReference } from '../../../lib/figmaBuilder';
import {
  loadUserProfile, updateProfileFromMessage, updateProfileFromDeletion,
  updateProfileFromReply, saveUserProfile, UserChatProfile,
} from '../../../lib/userChatProfile';
import { getAdaptiveChatDefaults, loadAdaptiveWorkspaceSettings, loadCircleWorkspaceProfile, recordChatActivity } from '../../../lib/workspaceAdaptation';
import {
  createSession as createComputerUseSession,
  createSessionFromBrowserPlan,
  planActions as planComputerUseActions,
  executePlan as executeComputerUsePlan,
  describeComputerUsePlan,
  toBrowserPlanCardData,
  type BrowserPlanCardData,
  type BrowserPlanEvent,
  type BrowserSessionRecord,
  type ComputerUseSession,
  type ComputerUsePermission,
  type BrowserAction,
  toBrowserSessionRecord,
} from '../../../lib/computerUse';
import ComputerUsePanel from '../../../components/computer-use/ComputerUsePanel';
import BrowserSessionDrawer from '../../../components/computer-use/BrowserSessionDrawer';
import AgentMonitorHost from '../../../components/agent-monitor/AgentMonitorHost';
import ComputerUsePermissionDialog from '../../../components/computer-use/ComputerUsePermissionDialog';
import ComputerUseButton from '../../../components/computer-use/ComputerUseButton';
import AnimatedPopup from '../../../components/chat-animations/AnimatedPopup';
import ThinkingDots from '../../../components/chat-animations/ThinkingDots';
import ThinkingLabel from '../../../components/chat-animations/ThinkingLabel';
import { pickThinkingVerb } from '../../../lib/thinkingVerbs';
import ComputerUseConsole from '../../../components/computer-use/ComputerUseConsole';
import ChatCostFooter from '../../../components/ChatCostFooter';
import DesktopBridgeStatusChip from '../../../components/DesktopBridgeStatusChip';
import WebSearchStatusChip from '../../../components/WebSearchStatusChip';
import RunApprovalBanner from '../../../components/RunApprovalBanner';
import HitlApprovalBanner from '../../../components/HitlApprovalBanner';
import ChatAttentionStrip from '../../../components/ChatAttentionStrip';
import ToolCallCheckpointStrip from '../../../components/ToolCallCheckpointStrip';
import ChatComputerFindingsCard from '../../../components/ChatComputerFindingsCard';
import ChatMemoryAttributionRow from '../../../components/ChatMemoryAttributionRow';
import ComputerTaskSteeringBar from '../../../components/ComputerTaskSteeringBar';
import { useComputerTaskScheduleRunner } from '../../../lib/computerTaskScheduleRunner';
import {
  isOpenSwanSteeringScopeActive,
  pushOpenSwanSteeringNote,
} from '../../../lib/openswanSteering';
import {
  BLACKSWAN_ENDPOINT_MODEL_ID,
  isLocalOllamaBlackSwan,
  looksLikeAppGroundedMessage,
  resolveComputerTaskPlannerModel,
} from '../../../lib/blackswanRouting';
import {
  buildChatAttentionState,
  resolveApprovalExpiresAt,
  type ChatAttentionAction,
  type ChatAttentionItem,
} from '../../../lib/chatAttentionQueue';
import {
  formatChatUserFacingOutcome,
  providerBlockerFromFailure,
  translateChatFailure,
} from '../../../lib/chatUserFacingOutcomes';
import {
  buildRoomHandoffSeedMessage,
  detectRoomHandoffSuggestion,
} from '../../../lib/chatRoomHandoff';
import RecordingBadge from '../../../components/RecordingBadge';
import { useComputerUseTask } from '../../../lib/useComputerUseTask';
import { resolveComputerUseConfirmation, sendComputerUseSteeringNote } from '../../../lib/computerUseConfirmations';
import { decideBrowserAutoStart } from '../../../lib/computerTaskAutoStart';
import { matchBookingFollowup, type BookingFollowupLastRun } from '../../../lib/computerTaskFollowup';
import { computerFindingsMetadata, type PersistedComputerFindings } from '../../../lib/persistedChatMetadata';
import { buildAgentMonitorTaskFromComputerUseState } from '../../../lib/agentMonitorState';
import {
  getMatchingChatSlashCommands,
  type ChatSlashCommand,
} from '../../../lib/chatSlashCommands';
import ChatArtifacts from '../../../components/chat/ChatArtifacts';
// V2 Builder adds copy/download/publish toolbar, device frames, and an
// iframe runtime error overlay. Lives in tabs/chat/ because the components/
// chat directory is root-owned. See docs/CHAT_LIVE_BUILDER_ROADMAP.md.
import ChatBuildStudio from './chat/ChatBuildStudioV2';
import ChatBotIdentityRow from '../../../components/chat/ChatBotIdentityRow';
import CodingWorkbenchPreview from '../../../components/chat/CodingWorkbenchPreview';
import ChatInlineRichText from '../../../components/chat/ChatInlineRichText';
import ChatMessageDetailsDisclosure from '../../../components/chat/ChatMessageDetailsDisclosure';
import AgentReceiptCard from '../../../components/AgentReceiptCard';
import { buildAgentReceipt, shouldRenderReceipt } from '../../../lib/agentReceipt';
import RunExecutionCard from '../../../components/chat/RunExecutionCard';
import RunHistoryDrawer from '../../../components/chat/RunHistoryDrawer';
import ChatSlashCommandPalette from '../../../components/chat/ChatSlashCommandPalette';
import { buildOpenSwanExecutionStream, type OpenSwanExecutionContract } from '../../../lib/openswanExecution';
import {
  clearChatAgentAvatar,
  formatPersistedChatBotMessage,
  getChatAgentAvatarSource,
  isPersistedChatBotMessage,
  loadChatAgentAvatar,
  loadChatAgentName,
  loadLastThreadBuildArtifact,
  MAIN_CHAT_AGENT_NAME,
  readPersistedChatBotMetadata,
  saveChatAgentAvatar,
  saveChatAgentName,
  saveLastThreadBuildArtifact,
  stripPersistedChatBotPrefix,
  type PersistedChatBotMetadata,
  type PersistedChatRecoveryReliabilitySummary,
} from '../../../lib/chatAgentIdentity';
import {
  deriveOutcomeVerdict,
  mapReactionToSignal,
  type ChatOutcomeVerdict,
  type ChatUserSignal,
} from '../../../lib/chatOutcomeSignals';
import {
  buildChatInfluenceReferences,
  persistMainChatBotMessageWithRetry,
  updateMainChatBotMessageWithRetry,
} from '../../../lib/chatAgentService';
import { buildChatAutomationPlan, type ChatAutomationPlan } from '../../../lib/chatAutomationPlanner';
import { UNIFIED_CONVERSATIONAL_INTENT_TYPES } from '../../../lib/chatConversationalCutoverParity';
import { buildChatAutomationPlanPreview, type ChatAutomationPlanPreview } from '../../../lib/chatAutomationPlanPreview';
import { createHitlApprovalGate } from '../../../lib/chatApprovalGate';
import { recallForClarification, reconstructClarificationAnswer } from '../../../lib/chatGapFill';
import { analyzeBuildBrief } from '../../../lib/buildBriefQuality';
import {
  buildChatComputerHandoffContext,
  formatChatComputerHandoffForMessage,
  type ChatComputerHandoffMetadata,
} from '../../../lib/chatComputerHandoffContext';
import {
  buildChatComputerOutcomePresentation,
  isQuietSuccessfulComputerTaskWarning,
} from '../../../lib/chatComputerOutcomeUx';
import { buildChatComputerRequestUserNotice } from '../../../lib/chatComputerRequestUx';
import { isCredentialedWebsiteAdminRoute } from '../../../lib/chatComputerRequestRouter';
import {
  deserializeChatFailureLedger,
  deserializeLastAppResolution,
  serializeChatFailureLedger,
  serializeLastAppResolution,
} from '../../../lib/chatSessionStatePersistence';
import type { ComputerTaskEvidenceContract } from '../../../lib/computerTaskEvidenceContract';
import { buildChatDesignTaskCardModel } from '../../../lib/chatDesignTaskCard';
import {
  buildAgentPlanDraft,
  formatAgentPlanForChat,
  shouldCreateAgentPlanForMessage,
  type AgentPlanDraft,
} from '../../../lib/agentPlanMode';
import { saveAgentPlanDraft } from '../../../lib/agentPlanPersistence';
import { executeTerminalAgentLaunchFromChat } from '../../../lib/terminalAgentSessionLauncher';
import { executeTerminalAgentControlFromChat } from '../../../lib/terminalAgentControl';
import {
  buildInDesignBannerClarification,
  buildPhotoshopGenerativeFillClarification,
  detectLocalComputerAwarenessIntent,
} from '../../../lib/localComputerAwarenessIntent';
import type { PredictiveChatCommand } from '../../../lib/predictiveChatCommands';
import { dispatchChatAutomationPlan, type ChatAutomationOutcome, type ChatClarificationResumeStore } from '../../../lib/runChatAutomationPlan';
import { createChatTransportHandlers, getOutcomeStateRequests, type ChatTransportStateRequests } from '../../../lib/chatTransportHandlers';
import { chooseChatTerminalTransport, looksLikeTerminalActionRequest as looksLikeActionRequest } from '../../../lib/chatTerminalTransportPolicy';
import { decideChatOrchestration } from '../../../lib/aiFirstChatPolicy';
import { attachPlanDecisionToRun } from '../../../lib/runChatAutomationPlanObserver';
import { deriveChatActivityFlags, shapePersistedChatMessage } from '../../../lib/chatMessageShape';
import {
  applyOpenSwanMemoryRecommendation,
  getLatestSpiritMemoryReferences,
  rememberFromChat,
  type OpenSwanMemoryRecommendation,
  type PromptMemoryReference,
} from '../../../lib/memoryService';
import { decayMemoryImportance, pinMemory, promoteMemory, recordMemoryFeedback, softDeleteMemory } from '../../../lib/memoryActions';
import {
  getLatestSpiritResearchReferences,
  type ResearchDocumentReference,
} from '../../../lib/researchControl';
import {
  getCurrentChatUserProfile,
  loadCircleChatMembers,
  loadThreadMessages,
  persistChatMessage,
  updateChatMessageContent,
} from '../../../lib/chatService';
import {
  FEATURED_QUICK_ACTIONS,
  FEATURED_TOOL_ACTIONS,
  PROMPT_CATEGORIES,
  QUICK_PROMPTS,
  resolveQuickActionExecution,
} from '../../../lib/chatActions';
import { detectAgenticCodingProfile } from '../../../lib/agenticCodingProfile';
import { getSpiritById } from '../../../lib/agentSpirits';
import { getAgentIdentityKey, loadAgentIdentities, type TerminalAgentOfficeConfig } from '../../../lib/agentIdentity';
import { loadConnections } from '../../../lib/connectionManager';
import { DEFAULT_AGENT, sessionsToAgents, type OfficeAgent } from '../../../lib/officeAgents';
import { loadCircleOfficeAgents, type CircleOfficeAgent } from '../../../lib/circleOffice';
import { listSessions, sendSessionMessage, spawnSubAgent, type OpenSwanConfig } from '../../../lib/openswanService';
import { type WikiArticleReference } from '../../../lib/wikiData';
import {
  loadThreadDelegationMode,
  loadThreadSessionProfile,
  resolveSessionCodingProfile,
  saveThreadDelegationMode,
  saveThreadSessionProfile,
  type SessionCodingProfile,
  type SessionDelegationMode,
} from '../../../lib/chatSessionProfile';
import { isCodingGenerationRequest } from '../../../lib/codingWorkbench';

import { runOpenSwanSessionTurn, type OpenSwanDelegatedAgentDescriptor } from '../../../lib/openswanSessionRuntime';
import type { OpenSwanTaskPlan } from '../../../lib/openswanTaskPlanner';
import type { OpenSwanToolEvent } from '../../../lib/openswanToolRuntime';
import { getSelectableChatModes } from '../../../lib/openswanModePolicy';
import {
  executeOpenSwanVerificationCheck,
  type OpenSwanVerificationResult,
  upsertOpenSwanVerificationResult,
} from '../../../lib/openswanVerificationRuntime';
import {
  getActiveLocalFileSessionGrant,
  inferLocalFileGrantRootsForTask,
  requestLocalFileSessionGrant,
  stageAttachmentForDesktop,
  stageAttachmentManifestForDesktop,
} from '../../../lib/desktopBridge';
import { addArtifact, appendRunBrowserPlanEvent, appendRunToolEvent, mergeRunMetadata } from '../../../lib/agentRunSystem';
import { getMainChatSessionActions } from '../../../lib/sessionPromptCatalog';
import { auditComputerCapabilities } from '../../../lib/computerCapabilityRegistry';
import {
  buildComputerTaskLocalFileAccessBlockedPresentation,
  buildComputerTaskSurfacePreparationBlockedPresentation,
  buildComputerTaskSurfacePreparationPlan,
  buildComputerTaskSurfacePreparationReceipt,
} from '../../../lib/computerTaskSurfacePreparation';
import {
  diagnoseComputerTaskCheckpointFailure,
  type ComputerTaskCheckpointRecoveryContext,
} from '../../../lib/computerTaskCheckpointRecovery';
import type { ComputerTaskAppRouteDecisionInput } from '../../../lib/computerTaskEvidenceRecovery';
import {
  buildChatFailureRecoveryExecutionPlan,
  formatActiveChatBlockerContextForPrompt,
  formatCompletedChatTaskContextForPrompt,
  formatChatFailureRecoveryOptionSelection,
  formatChatFailureRecoveryOptionSelectionForPrompt,
  parseChatFailureRecoveryOptionSelection,
  resolveChatFailureRecoveryOptionFollowup,
  stripChatFailureRecoveryOptionsText,
  type ChatFailureRecoveryOption,
} from '../../../lib/chatFailureRecovery';
import {
  buildChatRecoveryActionIntent,
  formatChatRecoveryActionDisplayText,
} from '../../../lib/chatRecoveryActionIntent';
import {
  autoConnectDesktopBridge,
  isDesktopBridgeRecoverySelection,
} from '../../../lib/desktopBridgeAutoConnect';
import type { ComputerTaskComplexityPlan } from '../../../lib/computerTaskComplexityPlan';
import { prepareComputerTaskExecution, type ComputerTaskExecutionEnvelope } from '../../../lib/computerTaskExecution';
import type { ComputerTaskGrantId } from '../../../lib/computerTaskGrants';
import { executeComputerTaskWithAgent, refreshComputerTaskCapabilityBuildoutFromCodexSession } from '../../../lib/computerTaskRuntime';
import { executeDirectImageConversionRequest } from '../../../lib/directImageConversionRuntime';
import { executeDirectLocalFileRequest, routeHasDirectLocalFileActionItems } from '../../../lib/directLocalFileRuntime';
import { listApiKeys } from '../../../lib/llmProviders';
import {
  buildImplicitBusinessModelProfiles,
  loadCircleBusinessModelProfiles,
  planBusinessModelForComputerTask,
} from '../../../lib/businessModelProfiles';
import { deriveGrantedScopesFromBrowserPermission, grantComputerTaskScopes, loadComputerTaskGrantIds } from '../../../lib/computerTaskGrantMemory';
import { acknowledgeComputerTaskNotificationsState, appendComputerTaskNotification, buildComputerTaskChecklistCard, buildComputerTaskStateSteps, clearComputerTaskState, compactComputerTaskCheckpointRecovery, compactComputerTaskComplexityPlan, computerTaskNotificationSnapshot, deriveComputerTaskNotification, listUnacknowledgedComputerTaskNotifications, loadComputerTaskState, markComputerTaskCheckpointRecoveryObserved, saveComputerTaskState, COMPUTER_TASK_NOTIFICATION_GLYPHS, type ComputerTaskCapabilityBuildout, type ComputerTaskCheckpointEvidenceObservation, type ComputerTaskStateCheckpointRecovery, type ComputerTaskStateComplexity, type ComputerTaskStateGrounding, type ComputerTaskStateRecord } from '../../../lib/computerTaskState';
import {
  buildAgentAppCapabilityBuildoutStateHints,
  formatAgentAppCapabilityBuildoutForUser,
} from '../../../lib/agentAppCapabilityBuildout';
import {
  buildDesktopAttachmentComputerTask,
  buildDesktopAttachmentPackageManifest,
  buildDesktopAttachmentStageGroupName,
  inferDesktopAppForAttachment,
  shouldRouteAttachedFilesToDesktop,
  type ChatDesktopAttachmentCandidate,
  type StagedDesktopAttachment,
} from '../../../lib/chatDesktopAttachmentRouting';
import {
  appendChatSessionArchiveEvent,
  clearChatSessionArchive,
  formatChatSessionArchiveBlock,
  loadChatSessionArchive,
  upsertChatSessionArchiveMessage,
} from '../../../lib/chatSessionArchive';
import {
  clearPendingBotMessages,
  loadPendingBotMessages,
  reconcilePendingBotMessages,
  removePendingBotMessage,
  savePendingBotMessage,
  type PendingBotMessageRecord,
} from '../../../lib/pendingBotMessages';
import { useAgentApprovals } from '../../../services/hitlService';

const OpenSwanConsole = React.lazy(() => import('../../../components/openswan/OpenSwanConsole'));
const ComputerUseLiveCard = React.lazy(() => import('../../../components/ComputerUseLiveCard'));

const IMMEDIATE_LOCAL_APP_FOLLOWUP_RE = /[,;]|\b(?:and|then|after|also|next)\b/i;

function shouldRunImmediateLocalAppLaunch(message: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  const intent = detectLocalComputerAwarenessIntent(text);
  if (!intent.route || !intent.appQuery) return false;
  if (intent.kind !== 'launch_app' && intent.kind !== 'focus_app') return false;
  return !IMMEDIATE_LOCAL_APP_FOLLOWUP_RE.test(text);
}

const REACTIONS_LIST = ['🔥', '💪', '👊', '💯', '⚡', '🎯'];
const BLACKSWAN_ID = 'blackswan';
const LOGIN_NEON = '#b8ff61';
const CHAT_SURFACE_MAX_WIDTH = 1680;
const SESSION_FALLBACK_TITLE = 'OpenSwan Session';
// Auto is the default — the runtime resolver in serviceProfileSouls
// picks Haiku for casual / status / clarifying turns, Sonnet for
// general code + design, and Opus for research / architecture / deep
// debugging. Pinning a static Sonnet default meant Auto was almost
// never engaged and users paid Sonnet rates for "hi" and "thanks".
const DEFAULT_CHAT_MODEL = 'auto';
function shortenAddress(address: string | null | undefined): string {
  const value = String(address || '');
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
type AssignableAgent = {
  id: string;
  name: string;
  status: string;
  provider: string;
  color?: string | null;
  owner_display_name?: string | null;
  current_task?: string | null;
  circle_id?: string | null;
  spirit?: string | null;
  model?: string | null;
  sessionKey?: string | null;
  gatewayUrl?: string | null;
  source?: 'db' | 'openswan-session' | 'bridge-session' | 'default';
  terminalConfig?: TerminalAgentOfficeConfig | null;
};

function applyTerminalProfileToTask(task: string, config?: TerminalAgentOfficeConfig | null): string {
  const instructions = config?.defaultPrompt?.trim();
  if (!instructions) return task;
  return [
    instructions,
    '',
    'Task from The Underground Circle chat:',
    task,
  ].join('\n');
}

function parseAgentExtendedConfig(raw: string | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function toAssignableDbAgent(agent: CircleOfficeAgent): AssignableAgent {
  const extended = parseAgentExtendedConfig(agent.currentGoal);
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status || 'idle',
    provider: agent.provider,
    color: agent.color,
    owner_display_name: agent.ownerDisplayName,
    current_task: agent.currentTask || null,
    circle_id: agent.circleId,
    spirit: agent.spirit || null,
    model: agent.model_name || extended?.modelPreference || null,
    sessionKey: agent.provider === 'openswan' ? agent.id : null,
    gatewayUrl: agent.gatewayUrl || null,
    source: 'db',
  };
}

function toAssignableSessionAgent(agent: OfficeAgent, circleId: string): AssignableAgent {
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    provider: agent.providerType,
    color: agent.color,
    owner_display_name: agent.connectionName,
    current_task: agent.activity || null,
    circle_id: circleId,
    spirit: agent.spirit || null,
    model: agent.model || null,
    sessionKey: agent.sessionKey || null,
    source: 'openswan-session',
  };
}
const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'build', 'can', 'create', 'do', 'for',
  'from', 'help', 'how', 'i', 'in', 'is', 'it', 'make', 'me', 'my', 'of', 'on',
  'please', 'show', 'the', 'this', 'to', 'we', 'with', 'you',
]);

function formatSessionTitleWord(word: string): string {
  if (!word) return '';
  if (word.length <= 4 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function deriveSessionTitleFromMessage(content: string): string {
  const normalized = content
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[@/#][\w-]+/g, ' ')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return SESSION_FALLBACK_TITLE;

  const words = normalized
    .split(' ')
    .map(word => word.replace(/^'+|'+$/g, '').trim())
    .filter(Boolean);

  const prioritized = words.filter(word => {
    const lower = word.toLowerCase();
    return word.length > 2 && !TITLE_STOP_WORDS.has(lower);
  });

  const chosen = (prioritized.length >= 2 ? prioritized : words)
    .slice(0, 3)
    .map(formatSessionTitleWord)
    .filter(Boolean);

  return chosen.length > 0 ? chosen.join(' ') : SESSION_FALLBACK_TITLE;
}

function appendCustomerSafeRecoveryMessage(message: string, recoveryMessage?: string | null): string {
  const base = message.trim().replace(/\s+$/g, '');
  const recovery = String(recoveryMessage || '').trim();
  return recovery ? `${base}\n\n${recovery}` : base;
}

function isSupportOnlyComputerTaskWarning(warning: string): boolean {
  return /\b(?:desktop\.[a-z_]+|\/desktop\/|stale_bridge|errorCode|MCP|endpoint|fetch failed|TypeError|ECONN|ETIMEDOUT|EADDR|unknown error|Desktop bridge .*failed)\b/i.test(String(warning || ''));
}

function sanitizeVisibleComputerTaskMessage(message: string, status: string): string {
  const text = String(message || '').trim();
  if (!text || status === 'completed') return text;
  if (!/\b(?:desktop\.[a-z_]+|\/desktop\/|Desktop bridge|local bridge|unknown bridge error|errorCode|MCP|endpoint|fetch failed|TypeError|ECONN|ETIMEDOUT|EADDR|EACCES|EPERM|ENOENT|File or folder does not exist|Transport .*threw|Transport threw)\b/i.test(text)) {
    return text;
  }
  return 'I could not finish that app or file action. Technical details were saved for recovery.';
}

function isAutoNamedSession(title: string | null | undefined): boolean {
  const normalized = (title || '').trim().toLowerCase();
  return normalized === '' || normalized === 'openswan session' || normalized === 'new chat';
}

function normalizeThreadModelPreference(model: string | null | undefined): string {
  const normalized = (model || '').trim().toLowerCase();
  if (!normalized || normalized === 'openswan') return DEFAULT_CHAT_MODEL;
  return model || DEFAULT_CHAT_MODEL;
}

function getFallbackSpiritIdForSessionProfile(profile: SessionCodingProfile): string {
  switch (profile) {
    case 'auto':
      return 'sr-engineer';
    case 'review':
      return 'code-reviewer';
    case 'debug':
      return 'qa-engineer';
    case 'architect':
      return 'architect';
    case 'senior':
    default:
      return 'sr-engineer';
  }
}

// Thinking-verb vocabulary lives in `src/lib/thinkingVerbs.ts` so the
// RunStatusBar + any other thinking surface can share it. The label
// below intentionally returns JUST the verb — no agent name, no model,
// no prefix — matching the "adjectives + colored dot, nothing else"
// design. Specific run-step text from the agent runtime still wins
// because it's load-bearing context.
function buildSessionThinkingLabel(currentRunStep: string, verbIndex: number): string {
  if (currentRunStep.trim()) return currentRunStep.trim();
  return pickThinkingVerb(verbIndex);
}

function formatMemoryRecencyLabel(ref: PromptMemoryReference): string {
  const timestamp = ref.lastAccessedAt || ref.updatedAt;
  if (!timestamp) return 'unknown freshness';
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours < 24) return 'fresh today';
  const ageDays = ageHours / 24;
  if (ageDays < 7) return `${Math.max(1, Math.round(ageDays))}d old`;
  if (ageDays < 30) return `${Math.max(1, Math.round(ageDays / 7))}w old`;
  return `${Math.max(1, Math.round(ageDays / 30))}mo old`;
}

function formatMemoryStrengthLabel(ref: PromptMemoryReference): string {
  const score = ref.importance ?? 0.5;
  if (score >= 0.9) return 'core';
  if (score >= 0.75) return 'strong';
  if (score >= 0.6) return 'active';
  return 'light';
}

function formatMemoryStateLabel(ref: PromptMemoryReference): string {
  if (ref.memoryState === 'distilled') return 'distilled guidance';
  if (ref.retrievalMode === 'startup' && ref.pinned) return 'pinned startup';
  if (ref.retrievalMode === 'startup') return 'startup guidance';
  if (ref.pinned) return 'pinned';
  if (ref.memoryState === 'supporting') return 'supporting';
  return 'retrieved';
}

function formatMemoryTrustLabel(ref: PromptMemoryReference): string {
  const helpfulness = ref.helpfulness;
  if (helpfulness == null) return 'unrated';
  if (helpfulness >= 0.8) return 'trusted';
  if (helpfulness >= 0.6) return 'proven';
  if (helpfulness <= 0.3) return 'weak';
  return 'mixed';
}

function formatArchiveBiasLabel(ref: PromptMemoryReference): string | null {
  if (ref.archiveBias === 'boosted') return 'archive boosted';
  if (ref.archiveBias === 'suppressed') return 'archive suppressed';
  if (ref.archiveBias === 'neutral' && ref.archivePassiveScore != null) return 'archive neutral';
  return null;
}

function formatMemorySourceLabel(ref: PromptMemoryReference): string | null {
  switch (ref.sourceSurface) {
    case 'claude_code_bridge': return 'Claude Code';
    case 'codex_bridge': return 'Codex';
    case 'cursor_bridge': return 'Cursor';
    case 'gemini_bridge': return 'Gemini';
    default: return null;
  }
}

function getMemoryFamily(ref: PromptMemoryReference): 'guidance' | 'pattern' {
  return ['instruction', 'preference', 'decision', 'policy'].includes(String(ref.memoryKind))
    ? 'guidance'
    : 'pattern';
}

function getMemoryFamilyLabel(ref: PromptMemoryReference): string {
  return getMemoryFamily(ref) === 'guidance' ? 'Guidance' : 'Pattern';
}

function formatMemoryKindLabel(memoryKind: string): string {
  switch (memoryKind) {
    case 'fact': return 'known fact';
    case 'instruction': return 'standing instruction';
    case 'preference': return 'user preference';
    case 'decision': return 'past decision';
    case 'finding': return 'investigation finding';
    case 'policy': return 'house policy';
    case 'context': return 'background context';
    default: return memoryKind;
  }
}

function formatMemoryScopeLabel(ref: PromptMemoryReference): string {
  switch (ref.scope) {
    case 'org': return 'org-wide';
    case 'circle': return 'circle-wide';
    case 'room': return 'this room';
    case 'user': return 'just you';
    case 'session': return 'this session';
    case 'agent': return 'this agent only';
    default: return String(ref.scope);
  }
}

function formatMemoryRecommendationTargetLabel(target: OpenSwanMemoryRecommendation['target']): string {
  switch (target) {
    case 'agent_private': return 'private to this agent';
    case 'circle_shared': return 'shared with the circle';
    case 'user_private': return 'private to you';
    case 'promote_existing': return 'promoting existing memory';
    default: return String(target).replace(/_/g, ' ');
  }
}

// Shared with the two computer-task launch call sites below (the
// clarifier's chatHistoryTail and executeComputerTaskWithAgent's
// chatHistory): same context-threading gap as the conversational reply
// path — a blocked/completed task's structured state only ever lived on
// the last bot message's UI render fields, so this lane "re-asks
// questions the user already answered." Mirrors the field mapping used
// at the conversational chatHistory construction site; a no-op (returns
// '') when the last message isn't a bot message or has nothing to report.
function buildTaskLaunchContextSuffix(messages: ChatMessage[]): string {
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  if (!lastMessage || !lastMessage.isBot) return '';
  const activeBlockerContext = formatActiveChatBlockerContextForPrompt({
    recoveryOptions: lastMessage.recoveryOptions,
    computerHandoffBlockers: lastMessage.computerHandoff?.blockers,
    computerHandoffWarnings: lastMessage.computerHandoff?.warnings,
    preflightSummary: lastMessage.computerHandoff?.preflightSummary,
    groundingSummary: lastMessage.computerHandoff?.groundingSummary,
    planPreview: lastMessage.chatAutomationPlanPreview
      ? {
        title: lastMessage.chatAutomationPlanPreview.title,
        routeLabel: lastMessage.chatAutomationPlanPreview.routeLabel,
        approvalRequired: lastMessage.chatAutomationPlanPreview.approvalRequired,
        evidenceGaps: lastMessage.chatAutomationPlanPreview.evidencePanel?.freshEvidenceRequired,
      }
      : null,
  });
  if (activeBlockerContext) return activeBlockerContext;
  return formatCompletedChatTaskContextForPrompt({
    outcomeSignal: lastMessage.outcomeSignal,
    computerFindings: lastMessage.computerFindings,
    artifacts: lastMessage.artifacts,
    browserPlans: lastMessage.browserPlans,
  });
}

function mapPersistedRowsToChatMessages(
  rows: any[],
  currentUserId: string | undefined,
  agentName: string,
  fallbackUserName?: string,
): ChatMessage[] {
  return rows.map((row: any) => {
    const base = shapePersistedChatMessage(row, {
      currentUserId,
      botDisplayName: agentName,
      fallbackUserName,
    });
    const metadata = base.isBot ? readPersistedChatBotMetadata(row.content) : null;
    return {
      ...base,
      reactions: row.reactions || {},
      replyTo: null,
      artifacts: metadata?.artifacts,
      wikiRefs: metadata?.wikiRefs,
      researchRefs: metadata?.researchRefs,
      memoriesUsed: metadata?.memoriesUsed,
      memoryRefs: metadata?.memoryRefs,
      memoryRecommendations: metadata?.memoryRecommendations,
      source: metadata?.source,
      usage: metadata?.usage || undefined,
      executionStream: metadata?.executionStream,
      agentPlan: metadata?.agentPlan,
      taskPlan: metadata?.taskPlan,
      toolEvents: metadata?.toolEvents,
      verificationResults: metadata?.verificationResults,
      browserPlans: metadata?.browserPlans,
      browserPlanEvents: metadata?.browserPlanEvents,
      browserSessions: metadata?.browserSessions,
      recoveryOptions: metadata?.recoveryOptions,
      recoveryReliability: metadata?.recoveryReliability || undefined,
      computerHandoff: metadata?.computerHandoff || undefined,
      chatAutomationPlanPreview: metadata?.chatAutomationPlanPreview || undefined,
      computerFindings: metadata?.computerFindings || undefined,
      bestOfN: (metadata as any)?.bestOfN || undefined,
      // WI-4/WI-11: rebuild the "Book option N" quick-reply chips on reload so
      // they survive persistence (the pending-record path carries live
      // quickReplies already). Label must match the live builder exactly.
      quickReplies: metadata?.computerFindings?.items?.length
        ? metadata.computerFindings.items.map((_, i) => `Book option ${i + 1}`)
        : undefined,
      routing: metadata?.routing || undefined,
      ...deriveChatActivityFlags(row.content),
    };
  });
}

function mapPendingBotRecordsToChatMessages(records: PendingBotMessageRecord[], agentName: string): ChatMessage[] {
  return records.map((record) => {
    const timestampMs = Date.parse(record.createdAt);
    const isBot = record.isBot !== false;
    return {
      id: record.localMessageId,
      content: record.content || '',
      isBot,
      isUser: !isBot,
      userName: record.userName || agentName,
      timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs) : new Date(),
      reactions: record.reactions || {},
      replyTo: record.replyTo || null,
      artifacts: record.artifacts as SwanBotStructuredArtifact[] | undefined,
      wikiRefs: record.wikiRefs as WikiArticleReference[] | undefined,
      researchRefs: record.researchRefs as ResearchDocumentReference[] | undefined,
      source: record.source as ChatMessageSource | undefined,
      usage: record.usage as SwanBotStructuredResponse['usage'] | undefined,
      memoriesUsed: record.memoriesUsed,
      memoryRefs: record.memoryRefs as PromptMemoryReference[] | undefined,
      memoryRecommendations: record.memoryRecommendations as OpenSwanMemoryRecommendation[] | undefined,
      executionStream: record.executionStream as OpenSwanExecutionContract[] | undefined,
      browserPlans: record.browserPlans as BrowserPlanCardData[] | undefined,
      browserPlanEvents: record.browserPlanEvents as BrowserPlanEvent[] | undefined,
      browserSessions: record.browserSessions as BrowserSessionRecord[] | undefined,
      recoveryOptions: record.recoveryOptions as ChatFailureRecoveryOption[] | undefined,
      recoveryReliability: record.recoveryReliability as PersistedChatRecoveryReliabilitySummary | undefined,
      computerHandoff: record.computerHandoff as ChatComputerHandoffMetadata | undefined,
      chatAutomationPlanPreview: record.chatAutomationPlanPreview as ChatAutomationPlanPreview | undefined,
      delegatedTo: record.delegatedTo,
      delegatedSubagents: record.delegatedSubagents,
      runId: record.runId,
      agentPlan: record.agentPlan as AgentPlanDraft | Record<string, unknown> | undefined,
      taskPlan: record.taskPlan as OpenSwanTaskPlan | undefined,
      toolEvents: record.toolEvents as OpenSwanToolEvent[] | undefined,
      verificationResults: record.verificationResults as OpenSwanVerificationResult[] | undefined,
      routing: record.routing as SwanBotStructuredResponse['routing'] | undefined,
      isPending: false,
      ...deriveChatActivityFlags(record.content),
    };
  });
}

function mergeRecoveredChatMessages(persisted: ChatMessage[], pending: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return [...persisted, ...pending]
    .filter((message) => {
      const key = message.dbId || message.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

async function mapLoadedThreadMessages(
  rows: any[],
  threadId: string | null | undefined,
  currentUserId: string | undefined,
  agentName: string,
  fallbackUserName?: string,
): Promise<ChatMessage[]> {
  const persistedMessages = mapPersistedRowsToChatMessages(rows, currentUserId, agentName, fallbackUserName);
  try {
    await reconcilePendingBotMessages(threadId, rows);
    const pendingRecords = await loadPendingBotMessages(threadId);
    return mergeRecoveredChatMessages(
      persistedMessages,
      mapPendingBotRecordsToChatMessages(pendingRecords, agentName),
    );
  } catch (error) {
    console.warn('[ChatTab] Pending OpenSwan message recovery failed:', error);
    return persistedMessages;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMessageSource = {
  actor?: string;
  surface?: string;
  selectedModel?: string | null;
  effectiveModel?: string | null;
  provider?: string | null;
  showRouteChips?: boolean;
};

type ChatFailureRecoveryLedgerEntry = {
  firstAt: number;
  lastAt: number;
  count: number;
  suppressedCount: number;
  lastSuccessfulHandoffAt: number | null;
};

type ChatFailureRecoveryDetails = {
  task: string;
  failureMessage: string;
  failureStack?: string | null;
  outcomeStatus?: string | null;
  executionKind?: string | null;
  runId?: string | null;
  planSummary?: string | null;
  groundingSummary?: string | null;
  preflightSummary?: string | null;
  source?: string | null;
  launchIfMissing?: boolean;
  touched?: string[];
  checkpointRecovery?: ComputerTaskCheckpointRecoveryContext | null;
  evidenceContract?: ComputerTaskEvidenceContract | null;
  appRouteDecision?: ComputerTaskAppRouteDecisionInput | null;
};

type ChatFailureRecoveryPayload = {
  message: string;
  recoveryOptions?: ChatFailureRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  archiveMetadata?: Record<string, unknown>;
};

const CHAT_FAILURE_RECOVERY_REPEAT_WINDOW_MS = 10 * 60 * 1000;
const CHAT_FAILURE_RECOVERY_LEDGER_RETENTION_MS = 60 * 60 * 1000;
const CHAT_FAILURE_RECOVERY_LEDGER_MAX = 64;

type ChatMessage = {
  id: string;
  content: string;
  isBot: boolean;
  isUser: boolean;
  userName?: string;
  timestamp: Date;
  reactions: Record<string, string[]>;
  replyTo?: { name: string; content: string } | null;
  dbId?: string;
  isCheckIn?: boolean;
  isAchievement?: boolean;
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  // Memory indicators
  memoriesSaved?: string[];   // titles of memories extracted from this exchange
  memoriesUsed?: string[];    // titles of memories that informed this response
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  source?: ChatMessageSource;
  usage?: SwanBotStructuredResponse['usage'];
  executionStream?: OpenSwanExecutionContract[];
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: ChatFailureRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerHandoff?: ChatComputerHandoffMetadata;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  computerPreflightBlockers?: { task: string; items: PreflightBlockerItem[] };
  /** Structured browser-run findings (bounded) persisted on the completion
   *  message so "book option N" follow-ups can resolve durably after reload. */
  computerFindings?: PersistedComputerFindings | null;
  /** Best-of-N race results (bounded) — interactive adopt/race-again card. */
  bestOfN?: PersistedBestOfNRace | null;
  /** Flywheel telemetry (Cursor-Tab precedent): machine-derived outcome
   *  verdict + the user's accept/reject/edit-resend/steer signal, persisted as
   *  tiny enums so it becomes BlackSwan training data. See chatOutcomeSignals. */
  outcomeSignal?: { verdict: ChatOutcomeVerdict; signal?: ChatUserSignal; lane?: string; model?: string } | null;
  quickReplies?: string[];    // tappable suggested replies (e.g. clarification answers)
  delegatedTo?: string;       // subagent that handled this message
  delegatedSubagents?: string[];
  runId?: string | null;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  routing?: SwanBotStructuredResponse['routing'];
  /** Automation proposal parsed from a natural-language request like
   *  "every Friday at 5pm post a weekly summary". When present, the
   *  message renders an AutomationProposalCard with a CREATE button. */
  automationProposal?: AutomationProposal;
  /** Search results from `/search <query>`. Renders as a clickable
   *  list with JUMP buttons per row. */
  searchResults?: { query: string; rows: SearchResultRow[] };
  /** When true, render the structured `/help` panel under this
   *  message — interactive, filterable, click-to-insert. */
  commandsHelp?: boolean;
  /** Live agents to render under a /assign picker. */
  assignPickerAgents?: AssignPickerAgent[];
  /** Bridge probe results to render under a /diag card. */
  bridgeDiagResults?: BridgeProbeResult[];
  /** When true and runId is set, render a live RunTraceCard under
   *  this message that subscribes to agent_run_steps in real time. */
  showRunTrace?: boolean;
  isPending?: boolean;
};

type ChatBotMessageExtra = {
  delegatedTo?: string;
  delegatedSubagents?: string[];
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: ChatFailureRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerHandoff?: ChatComputerHandoffMetadata;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  computerPreflightBlockers?: { task: string; items: PreflightBlockerItem[] };
  computerFindings?: PersistedComputerFindings | null;
  bestOfN?: PersistedBestOfNRace | null;
  quickReplies?: string[];
  localOnly?: boolean;
  runId?: string | null;
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  automationProposal?: AutomationProposal;
  searchResults?: { query: string; rows: SearchResultRow[] };
  commandsHelp?: boolean;
  assignPickerAgents?: AssignPickerAgent[];
  bridgeDiagResults?: BridgeProbeResult[];
  showRunTrace?: boolean;
  routing?: SwanBotStructuredResponse['routing'];
  source?: ChatMessageSource;
  usage?: SwanBotStructuredResponse['usage'] | null;
};

function isLastTaskModelQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(what|which)\s+model\s+(was\s+)?(used|ran|did\s+you\s+use)\s+(for|on)\s+(the\s+)?(last|previous|prior)\s+(task|request|message|response)\s*[?!]?$/.test(normalized)
    || /^what\s+model\s+was\s+used\s+last\s*[?!]?$/.test(normalized)
    || /^last\s+(task|request|response)\s+model\s*[?!]?$/.test(normalized);
}

function formatModelDisplayName(model: string | null | undefined): string {
  const raw = String(model || '').trim();
  if (!raw) return 'unknown';
  if (raw.toLowerCase() === 'auto') return 'Auto';
  return raw
    .replace(/^openrouter\//i, '')
    .replace(/^huggingface_endpoint\//i, '')
    .replace(/^huggingface\//i, '')
    .replace(/^google_ai\//i, '')
    .replace(/^openai\//i, '')
    .replace(/^anthropic\//i, '')
    .replace(/^groq\//i, '')
    .replace(/^mistral_ai\//i, '')
    .replace(/^deepseek\//i, '')
    .replace(/^zai\//i, '')
    .replace(/^z_ai\//i, '')
    .replace(/^minimax\//i, '');
}

type ChatMessageRouteChip = {
  label: string;
  value: string;
  tone: 'route' | 'model' | 'local' | 'provider';
};

function formatRouteSurfaceLabel(surface: string | null | undefined): string {
  const raw = String(surface || '').trim();
  if (!raw) return 'Main chat';
  const normalized = raw.toLowerCase();
  if (normalized.includes('desktop_bridge')) return 'Desktop bridge';
  if (normalized.includes('computer_task')) return 'Computer task';
  if (normalized.includes('file')) return 'File tools';
  if (normalized.includes('openswan')) return 'OpenSwan';
  if (normalized.includes('browser')) return 'Browser';
  if (normalized.includes('local')) return 'Local';
  if (normalized.includes('model_audit')) return 'Model audit';
  return raw
    .replace(/^main_chat_?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Main chat';
}

function isLocalExecutionSource(source?: ChatMessageSource, effectiveModel?: string | null): boolean {
  const surface = String(source?.surface || '').toLowerCase();
  const model = String(effectiveModel || '').toLowerCase();
  return surface.includes('desktop_bridge')
    || surface.includes('computer_task')
    || surface.includes('local')
    || model === 'local-desktop-bridge'
    || model === 'computer-file-adapter';
}

function buildMessageRouteChips(message: ChatMessage): ChatMessageRouteChip[] {
  if (!message.isBot || !message.source) return [];
  const source = message.source;
  if (source.showRouteChips !== true) return [];
  const effectiveModel = source.effectiveModel || message.usage?.model || null;
  const selectedModel = source.selectedModel || null;
  const provider = source.provider || message.routing?.provider_routed || null;
  const localExecution = isLocalExecutionSource(source, effectiveModel);
  if (localExecution) return [];
  // P22: prefer the handoff's true surface for the displayed Route so a
  // desktop/app task doesn't read "browser". Display-only — nothing about
  // routing/executor selection changes.
  const routeValue = formatHandoffSurfaceRouteLabel(message.computerHandoff)
    || formatRouteSurfaceLabel(source.surface);
  const chips: ChatMessageRouteChip[] = [
    { label: 'Route', value: routeValue, tone: localExecution ? 'local' : 'route' },
  ];

  if (selectedModel) {
    chips.push({
      label: selectedModel.toLowerCase() === 'auto' ? 'Picker' : 'Selected',
      value: formatModelDisplayName(selectedModel),
      tone: 'model',
    });
  }

  if (effectiveModel) {
    chips.push({
      label: localExecution ? 'Engine' : selectedModel?.toLowerCase() === 'auto' ? 'Resolved' : 'Model',
      value: localExecution && effectiveModel === 'local-desktop-bridge'
        ? 'Local desktop bridge'
        : localExecution && effectiveModel === 'computer-file-adapter'
          ? 'Computer file adapter'
          : formatModelDisplayName(effectiveModel),
      tone: localExecution ? 'local' : 'model',
    });
  } else if (localExecution) {
    chips.push({ label: 'Engine', value: 'Local execution', tone: 'local' });
  }

  if (provider && !String(effectiveModel || '').toLowerCase().startsWith(`${provider}/`)) {
    chips.push({ label: 'Provider', value: formatModelDisplayName(provider), tone: 'provider' });
  }

  return chips.slice(0, 4);
}

function describeLastTaskModel(messages: ChatMessage[]): string {
  const lastBot = [...messages].reverse().find((message) => (
    message.isBot
    && !message.isPending
    && !!message.content?.trim()
    && message.source?.surface !== 'main_chat_model_audit'
  ));
  if (!lastBot) return 'No previous assistant task is recorded in this chat yet.';

  const effectiveModel = lastBot.source?.effectiveModel || lastBot.usage?.model || null;
  const selectedModel = lastBot.source?.selectedModel || null;
  const surface = lastBot.source?.surface || 'main_chat';
  const noLlmSurface = effectiveModel === 'local-desktop-bridge'
    || effectiveModel === 'computer-file-adapter'
    || surface.includes('desktop_bridge')
    || surface.includes('computer_task');

  if (noLlmSurface && (!effectiveModel || effectiveModel === 'local-desktop-bridge' || effectiveModel === 'computer-file-adapter')) {
    return [
      'The last task did not use an LLM model.',
      `It ran locally through **${effectiveModel === 'computer-file-adapter' ? 'the file adapter' : 'the desktop bridge'}**.`,
      selectedModel ? `Picker selection at the time: **${formatModelDisplayName(selectedModel)}**.` : null,
    ].filter(Boolean).join(' ');
  }

  if (effectiveModel) {
    return [
      `The last assistant task used **${formatModelDisplayName(effectiveModel)}**.`,
      selectedModel ? `Picker selection: **${formatModelDisplayName(selectedModel)}**.` : null,
      `Surface: \`${surface}\`.`,
    ].filter(Boolean).join(' ');
  }

  return `I do not have model metadata for the last assistant message. Surface: \`${surface}\`.`;
}

function getRecoveryOptionAccent(option: ChatFailureRecoveryOption): string {
  if (option.actor === 'connected_agent') return '#22c55e';
  if (option.actor === 'openswan') return '#38bdf8';
  if (option.actor === 'user') return '#f59e0b';
  if (option.actor === 'llm') return '#a78bfa';
  return '#ef4444';
}

function formatRecoverySurfaceKind(kind?: string | null): string {
  switch (kind) {
    case 'desktop_app':
      return 'Desktop app';
    case 'local_file':
      return 'Local files';
    case 'browser':
      return 'Browser';
    case 'hybrid':
      return 'Multi-surface';
    case 'agent_buildout':
      return 'Capability buildout';
    default:
      return 'Task';
  }
}

function formatRecoveryFailureArea(area?: string | null): string {
  return String(area || 'recovery')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRecoveryEvidenceLabel(value: string): string {
  return value
    .replace(/^desktop\./, '')
    .replace(/^browser\./, '')
    .replace(/^agent\./, '')
    .replace(/[_:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// P22: display-only route/surface label for computer/desktop/app-task
// messages. The plan preview's `routeLabel` is hardcoded 'browser' for the
// forced computer-task path (and the preview smoke locks that value), so we
// derive a surface-accurate label from the handoff metadata for DISPLAY only —
// executor selection still keys off the unchanged routeId.
function formatHandoffSurfaceRouteLabel(
  handoff?: ChatComputerHandoffMetadata | null,
): string | null {
  switch (handoff?.surface) {
    case 'desktop':
      return 'Desktop app';
    case 'local_files':
      return 'Local files';
    case 'browser':
      return 'Browser';
    case 'computer':
      return 'Computer';
    default:
      return null;
  }
}

// P22: the one always-visible compact summary line for a computer/desktop/
// app-task message. Prefers the concise user-facing notice summary the route
// already produced, then the app-choice ("Using <app> · <surface>"), then the
// first sentence of the body. Bounded so the collapsed row stays one glance.
function buildComputerTaskSummaryLine(args: {
  handoff?: ChatComputerHandoffMetadata | null;
  appChoiceCard: { selectedAppName: string; surfaceLabel: string } | null;
  body: string;
}): string {
  const notice = args.handoff?.requestNotice;
  const noticeSummary = String(notice?.summary || '').replace(/\s+/g, ' ').trim();
  const appLine = args.appChoiceCard
    ? `Using ${args.appChoiceCard.selectedAppName} · ${args.appChoiceCard.surfaceLabel}`
    : '';
  const firstSentence = String(args.body || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s/)[0] || '';
  const base = noticeSummary || appLine || firstSentence || 'Computer task';
  return base.length > 140 ? `${base.slice(0, 139)}…` : base;
}

function getRecoveryReliabilityStatus(summary?: PersistedChatRecoveryReliabilitySummary | null): {
  label: string;
  color: string;
  detail: string;
} | null {
  if (!summary) return null;
  if (summary.userActionRequired) {
    return { label: 'User step', color: '#f59e0b', detail: 'Waiting for a permission, login, approval, bridge, or app blocker to be resolved.' };
  }
  if (summary.connectedAgentAllowed) {
    return { label: 'Agent repair', color: '#22c55e', detail: 'A connected agent can repair the missing adapter or runtime capability before retrying.' };
  }
  if (summary.retryAllowed) {
    if (summary.readinessStatus === 'ready') {
      return { label: 'Ready', color: '#22c55e', detail: 'Required evidence is fresh enough for one bounded retry.' };
    }
    return { label: 'Needs evidence', color: '#38bdf8', detail: 'Fresh evidence is required before retrying the failed step.' };
  }
  return { label: 'Stopped', color: '#ef4444', detail: 'The recovery path is blocked until the cause is reviewed.' };
}

function buildRecoveryReliabilityCard(summary?: PersistedChatRecoveryReliabilitySummary | null): {
  title: string;
  subtitle: string;
  statusLabel: string;
  color: string;
  detail: string;
  chips: string[];
} | null {
  const status = getRecoveryReliabilityStatus(summary);
  if (!summary || !status) return null;
  const surface = formatRecoverySurfaceKind(summary.surfaceKind);
  const area = formatRecoveryFailureArea(summary.failureArea);
  const needed = (summary.requiredFreshEvidence || [])[0]
    || (summary.nextEvidenceTools || [])[0]
    || (summary.requiredEvidenceTools || [])[0]
    || status.detail;
  const chips = [
    summary.readinessStatus ? `Evidence ${summary.readinessStatus}` : null,
    ...(summary.nextEvidenceTools || summary.requiredEvidenceTools || [])
      .slice(0, 2)
      .map(formatRecoveryEvidenceLabel),
    summary.verificationCommands?.length ? `${summary.verificationCommands.length} checks` : null,
  ].filter(Boolean) as string[];
  return {
    title: `${surface} recovery`,
    subtitle: summary.targetName
      ? `${summary.targetName} · ${area}`
      : area,
    statusLabel: status.label,
    color: status.color,
    detail: typeof needed === 'string' ? needed : status.detail,
    chips,
  };
}

function buildChatAppChoiceCard(handoff?: ChatComputerHandoffMetadata | null): {
  selectedAppName: string;
  surfaceLabel: string;
  availabilityLabel: string;
  reason: string;
  switchHint: string | null;
  alternatives: string[];
  openStep: string | null;
} | null {
  const notice = handoff?.requestNotice;
  const choice = notice?.appChoice;
  if (choice && choice.visibility === 'user') {
    const surfaceLabel = choice.selectedSurface === 'desktop' ? 'Desktop app' : 'Web app';
    const availabilityLabel = choice.availability === 'installed'
      ? 'Installed'
      : choice.availability === 'maybe'
        ? 'Bridge check'
        : choice.availability === 'web'
          ? 'Web ready'
          : surfaceLabel;
    return {
      selectedAppName: choice.selectedAppName,
      surfaceLabel,
      availabilityLabel,
      reason: choice.reason || 'best available app for this task',
      switchHint: choice.switchHint,
      alternatives: (choice.alternatives || []).slice(0, 3),
      openStep: choice.openStepLines?.[0] || null,
    };
  }
  const fallbackLine = notice?.appChoiceLine;
  if (!fallbackLine) return null;
  const selectedMatch = fallbackLine.match(/^Using\s+(.+?)(?:\s+\(|\.|$)/);
  return {
    selectedAppName: selectedMatch?.[1]?.trim() || 'Selected app',
    surfaceLabel: handoff?.surface === 'desktop' ? 'Desktop app' : handoff?.surface === 'browser' ? 'Web app' : 'App task',
    availabilityLabel: 'Selected',
    reason: fallbackLine.replace(/^Using\s+.+?\s+\((.+?)\).*$/i, '$1'),
    switchHint: /say\s+"use\s+(.+?)"/i.test(fallbackLine) ? fallbackLine.replace(/^.*?(say\s+"use\s+.+?").*$/i, '$1') : null,
    alternatives: [],
    openStep: null,
  };
}

function stripChatAppChoiceLine(content: string, appChoiceLine?: string | null): string {
  const target = String(appChoiceLine || '').trim();
  if (!target) return content;
  return String(content || '')
    .split('\n')
    .filter((line) => line.trim() !== target)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildRecoveryOptionComposerPrompt(option: ChatFailureRecoveryOption, message?: ChatMessage): string {
  return formatChatFailureRecoveryOptionSelection(option, message ? {
    messageId: message.dbId || message.id,
    runId: message.runId || null,
    sourceSurface: message.source?.surface || null,
    failureExcerpt: message.content,
  } : null);
}

function findLatestRecoveryOptionsMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.isBot && message.recoveryOptions && message.recoveryOptions.length > 0) {
      return message;
    }
  }
  return null;
}

// Receipt Retry affordance: the user prompt that immediately preceded a bot
// message, so "Retry" on its receipt re-sends the exact original request. Pure
// and bounded (returns the text or null; slash-commands are skipped so retry
// never re-fires a command).
function findPriorUserPromptForMessage(messages: ChatMessage[], botMessageId: string): string | null {
  const botIndex = messages.findIndex((message) => message.id === botMessageId);
  if (botIndex < 0) return null;
  for (let index = botIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.isUser) continue;
    const text = (message.content || '').trim();
    if (!text || text.startsWith('/')) return null;
    return text.slice(0, 4000);
  }
  return null;
}

function getRecoveryReliabilityFromArchive(
  metadata?: Record<string, unknown> | null,
): PersistedChatRecoveryReliabilitySummary | null {
  const summary = metadata?.recoveryReliability;
  return summary && typeof summary === 'object'
    ? summary as PersistedChatRecoveryReliabilitySummary
    : null;
}

function buildPendingBotMessageRecord(message: ChatMessage): PendingBotMessageRecord {
  return {
    localMessageId: message.id,
    content: message.content || '',
    createdAt: message.timestamp instanceof Date
      ? message.timestamp.toISOString()
      : new Date().toISOString(),
    isBot: message.isBot,
    isUser: message.isUser,
    userName: message.userName,
    replyTo: message.replyTo || null,
    reactions: message.reactions,
    source: message.source,
    usage: message.usage,
    runId: message.runId,
    delegatedTo: message.delegatedTo,
    delegatedSubagents: message.delegatedSubagents,
    artifacts: message.artifacts,
    wikiRefs: message.wikiRefs,
    researchRefs: message.researchRefs,
    memoriesUsed: message.memoriesUsed,
    memoryRefs: message.memoryRefs,
    memoryRecommendations: message.memoryRecommendations,
    executionStream: message.executionStream,
    agentPlan: message.agentPlan,
    browserPlans: message.browserPlans,
    browserPlanEvents: message.browserPlanEvents,
    browserSessions: message.browserSessions,
    recoveryOptions: message.recoveryOptions,
    recoveryReliability: message.recoveryReliability,
    computerHandoff: message.computerHandoff,
    chatAutomationPlanPreview: message.chatAutomationPlanPreview,
    taskPlan: message.taskPlan,
    toolEvents: message.toolEvents,
    verificationResults: message.verificationResults,
    routing: message.routing,
  };
}

function saveRecoverableChatMessage(threadId: string | null | undefined, message: ChatMessage): void {
  if (!threadId || message.dbId) return;
  void savePendingBotMessage(threadId, buildPendingBotMessageRecord(message)).catch((error) => {
    console.warn('[ChatTab] Could not cache pending chat message:', error);
  });
}

// ─── Animation Components ────────────────────────────────────────────────────

function FloatingEmoji({ emoji, onComplete }: { emoji: string; onComplete: () => void }) {
  const floatAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(floatAnim, {
        toValue: -80,
        duration: 2000,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    ]).start(onComplete);
  }, []);

  return (
    <Animated.View
      style={[
        styles.floatingEmoji,
        {
          transform: [{ translateY: floatAnim }],
          opacity: fadeAnim,
        },
      ]}
    >
      <Text style={styles.floatingEmojiText}>{emoji}</Text>
    </Animated.View>
  );
}

function ParticleEffect({ x, y, color, onComplete }: { x: number; y: number; color: string; onComplete: () => void }) {
  const particles = Array.from({ length: 8 }, (_, i) => useRef(new Animated.Value(0)).current);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const animations = particles.map((anim, i) => {
      const angle = (i / particles.length) * Math.PI * 2;
      const distance = 30;
      return Animated.timing(anim, {
        toValue: distance,
        duration: 1000,
        useNativeDriver: true,
      });
    });

    Animated.parallel([
      ...animations,
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    ]).start(onComplete);
  }, []);

  return (
    <View style={[styles.particleContainer, { top: y, left: x }]}>
      {particles.map((anim, i) => {
        const angle = (i / particles.length) * Math.PI * 2;
        return (
          <Animated.View
            key={i}
            style={[
              styles.particle,
              { backgroundColor: color },
              {
                transform: [
                  { translateX: Animated.multiply(anim, Math.cos(angle)) },
                  { translateY: Animated.multiply(anim, Math.sin(angle)) },
                ],
                opacity: fadeAnim,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// Loading animation — uses shared circle loader
import LoadingWave from '../../../components/LoadingWave';
function ChatLoadingWave() {
  return <LoadingWave />;
}

function TypingDots() {
  const [dotCount, setDotCount] = useState(1);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => setDotCount((c) => (c % 3) + 1), 400);
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => {
      clearInterval(interval);
      pulse.stop();
    };
  }, []);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <Text style={styles.typingDotsText}>{'⚪'.repeat(dotCount)}</Text>
    </Animated.View>
  );
}

// chatLoadStyles removed — now uses shared LoadingWave component

function formatTimeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function buildComputerTaskGroundingStateFromExecution(
  execution: ComputerTaskExecutionEnvelope,
): ComputerTaskStateGrounding | null {
  return execution.computerAppGroundingTrace
    ? {
        status: execution.computerAppGroundingTrace.status,
        strategyId: execution.computerAppGroundingTrace.strategyId,
        strategyLabel: execution.computerAppGroundingTrace.strategyLabel,
        primarySurface: execution.computerAppGroundingTrace.primarySurface,
        summary: execution.computerAppGroundingTrace.display.summary,
        nextAction: execution.computerAppGroundingTrace.display.nextAction,
        badges: execution.computerAppGroundingTrace.display.badges,
        blockers: execution.computerAppGroundingTrace.display.blockers,
      }
    : null;
}

function stagedFileDesktopCandidate(file: StagedFile): ChatDesktopAttachmentCandidate {
  return {
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
}

function mediaAttachmentDesktopCandidate(attachment: ChatAttachment): ChatDesktopAttachmentCandidate {
  return {
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.size,
  };
}

async function base64FromChatMediaAttachment(attachment: ChatAttachment): Promise<string | null> {
  if (attachment.base64) return attachment.base64;
  if (!attachment.uri || typeof fetch !== 'function') return null;
  try {
    const response = await fetch(attachment.uri);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (typeof FileReader === 'undefined') return null;
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = typeof reader.result === 'string' ? reader.result : '';
        const comma = value.indexOf(',');
        resolve(comma >= 0 ? value.slice(comma + 1) : value || null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function describeChatAutomationApproval(agentName: string, plan: ChatAutomationPlan): string {
  const route = plan.execution.routeId ? ` (${plan.execution.routeId})` : '';
  const command = String(plan.execution.commandText || '').replace(/\s+/g, ' ').trim();
  const commandLine = command ? `: "${command.slice(0, 140)}"` : '';
  const reason = plan.approval.required && plan.approval.reason ? ` ${plan.approval.reason}` : '';
  return `Approve ${agentName} to run ${plan.execution.kind}${route}${commandLine}.${reason}`.trim();
}

export default function ChatTab({ circleId, accentColor = '#6366f1' }: { circleId: string; accentColor?: string }) {
  const navigation = useNavigation<any>();
  const { width: viewportWidth } = useWindowDimensions();
  const desktopWriteGrantSeededRef = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // ── Threaded chat state ──────────────────────────────────────────────────
  // activeThreadId is the row in circle_chat_threads currently displayed.
  // null until we resolve the circle's default thread. Persisted in the URL
  // hash so refresh keeps you on the same thread.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(getInitialSidebarCollapsed);
  const [threadListRefreshToken, setThreadListRefreshToken] = useState(0);
  const [members, setMembers] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [botTyping, setBotTyping] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('You');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [showReactions, setShowReactions] = useState<string | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [showSendCrypto, setShowSendCrypto] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendingCrypto, setSendingCrypto] = useState(false);
  const [discordConfig, setDiscordConfig] = useState<CircleDiscordConfig | null>(null);
  const [discordChannels, setDiscordChannels] = useState<string[]>([]);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: string; emoji: string; x: number; y: number }[]>([]);
  const [particles, setParticles] = useState<{ id: string; x: number; y: number; color: string }[]>([]);
  const [messageDensity, setMessageDensity] = useState<'compact' | 'cozy'>('cozy');
  const [isFirstVisit, setIsFirstVisit] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [showPinned, setShowPinned] = useState(false);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [showCreatePoll, setShowCreatePoll] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_CHAT_MODEL);
  useEffect(() => {
    if (Platform.OS !== 'web' || desktopWriteGrantSeededRef.current) return;
    const isLocalHost = typeof window !== 'undefined'
      && ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
    if (!isLocalHost) return;

    desktopWriteGrantSeededRef.current = true;
    const roots = ['~/Desktop'];
    if (getActiveLocalFileSessionGrant(roots, 'write')) return;
    void requestLocalFileSessionGrant({
      roots,
      scope: 'write',
      reason: 'Local Chat dashboard Desktop file-write access',
    }).then((result) => {
      if (!result.ok) {
        desktopWriteGrantSeededRef.current = false;
        console.warn('[ChatTab] Desktop write grant unavailable:', result.error);
      }
    });
  }, []);
  // Pull the marketplace catalog at the parent level — both the
  // composer (for the picker UI + Auto preview) and the send flow
  // (for resolving 'auto' → concrete model id with provider bias) need
  // to know which integrations are connected.
  const [marketplaceModelGroups, setMarketplaceModelGroups] = useState<ModelGroup[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!circleId) {
      setMarketplaceModelGroups([]);
      return;
    }
    (async () => {
      try {
        const { loadModelGroups } = await import('../../../lib/integrations/modelProviderRegistry');
        const groups = await loadModelGroups(circleId, { includeDisconnected: true });
        if (!cancelled) setMarketplaceModelGroups(groups);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [circleId]);
  const connectedProviderSet: ReadonlySet<string> = useMemo(() => {
    return new Set(
      marketplaceModelGroups
        .filter((g) => g.connected)
        .map((g) => normalizeConnectedProviderKey(g.provider as string)),
    );
  }, [marketplaceModelGroups]);
  // Web Search toggle — when on, the user's next chat send routes
  // through OpenRouter with the `openrouter:web_search` server tool
  // attached so the model can fetch up-to-date facts. Persists per-
  // circle in `circles.settings.chatWebSearch.enabled`. Phase 0 of
  // the OpenRouter integration plan.
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      const { getChatWebSearchSettings } = await import('../../../lib/chatWebSearchSettings');
      const cfg = await getChatWebSearchSettings(circleId);
      if (active) setWebSearchEnabled(cfg.enabled);
    })();
    return () => { active = false; };
  }, [circleId]);
  const handleToggleWebSearch = useCallback(async () => {
    const next = !webSearchEnabled;
    setWebSearchEnabled(next);
    const { setChatWebSearchEnabled } = await import('../../../lib/chatWebSearchSettings');
    await setChatWebSearchEnabled(circleId, next).catch(() => {
      // Persist failed — revert UI so toggle state stays honest.
      setWebSearchEnabled(!next);
    });
  }, [circleId, webSearchEnabled]);
  const [sessionProfile, setSessionProfile] = useState<SessionCodingProfile>('auto');
  const [sessionDelegationMode, setSessionDelegationMode] = useState<SessionDelegationMode>('auto');
  // Resolve 'auto' to a concrete model id at send time so the call hits
  // exactly what the picker preview promised. Pure helper — recomputes
  // each call so a freshly-typed message gets routed by its own intent
  // (not the previous turn's). Returns the original pick when not auto.
  const resolveSendModel = useCallback((messageText: string): string | null => {
    if (selectedModel !== 'auto') {
      // P8 hard rule: the retired local-Ollama BlackSwan normalizes to the
      // one real BlackSwan — cswan801/BlackSwan-v5 on the dedicated endpoint.
      return isLocalOllamaBlackSwan(selectedModel) ? BLACKSWAN_ENDPOINT_MODEL_ID : selectedModel;
    }
    try {
      const draft = (messageText || '').trim();
      const route = draft.length > 0
        ? analyzeMessageRouting(draft, 'main_chat').route
        : null;
      const providerSetForTurn = looksLikeActionRequest(draft)
        ? new Set(Array.from(connectedProviderSet).filter((provider) => provider !== 'blackswan'))
        : connectedProviderSet;
      return resolveModelForProfile(
        (sessionProfile as any) || 'senior',
        null,
        route?.intent,
        providerSetForTurn,
        route?.complexity,
        // P8: app-domain questions can route to the app-trained BlackSwan.
        { appGroundedHint: looksLikeAppGroundedMessage(draft) },
        // P27: raw message → BlackSwan reliability guard escalates the hard
        // subset of the grounded lane (multi-step/technical/ambiguous) to frontier.
        draft,
      );
    } catch {
      return null;
    }
  }, [selectedModel, sessionProfile, connectedProviderSet]);
  const autoResolvedModel = useMemo(() => {
    if (selectedModel !== 'auto') return null;
    try {
      const draft = (input || '').trim();
      const route = draft.length > 0
        ? analyzeMessageRouting(draft, 'main_chat').route
        : null;
      const providerSetForTurn = looksLikeActionRequest(draft)
        ? new Set(Array.from(connectedProviderSet).filter((p) => p !== 'blackswan'))
        : connectedProviderSet;
      return resolveModelForProfile(
        (sessionProfile as any) || 'senior',
        null,
        route?.intent,
        providerSetForTurn,
        route?.complexity,
        // P8: app-domain questions can route to the app-trained BlackSwan.
        { appGroundedHint: looksLikeAppGroundedMessage(draft) },
        // P27: raw message → BlackSwan reliability guard escalates the hard
        // subset of the grounded lane (multi-step/technical/ambiguous) to frontier.
        draft,
      );
    } catch {
      return null;
    }
  }, [selectedModel, input, sessionProfile, connectedProviderSet]);
  // P11 transparency: WHY Auto picked that model — Cursor shows the id, we
  // show the reason ("app question → app-trained BlackSwan"). Anti-drift
  // matrix in smoke:blackswan-auto-routing guarantees this explainer can
  // never disagree with the real router.
  const autoModelReason = useMemo(() => {
    if (selectedModel !== 'auto') return null;
    try {
      const draft = (input || '').trim();
      const route = draft.length > 0
        ? analyzeMessageRouting(draft, 'main_chat').route
        : null;
      const providerSetForTurn = looksLikeActionRequest(draft)
        ? new Set(Array.from(connectedProviderSet).filter((p) => p !== 'blackswan'))
        : connectedProviderSet;
      return explainAutoModelChoice(
        spiritIdForProfile((sessionProfile as any) || 'senior'),
        null,
        route?.intent,
        route?.complexity,
        undefined,
        undefined,
        providerSetForTurn,
        { appGroundedHint: looksLikeAppGroundedMessage(draft) },
      ).reason;
    } catch {
      return null;
    }
  }, [selectedModel, input, sessionProfile, connectedProviderSet]);
  const [codingWorkbenchPrompt, setCodingWorkbenchPrompt] = useState<string | null>(null);
  const [codingWorkbenchTick, setCodingWorkbenchTick] = useState(0);
  // Live streaming state for /build-page — filled by subscribeBuildStream()
  // as tokens arrive from the build-stream edge fn. When the stream finishes
  // the aggregate goes into a real artifact via addBotMessage() and these
  // reset, letting the artifact view take over naturally.
  const [streamingBuildText, setStreamingBuildText] = useState<string>('');
  const [streamingBuildPhase, setStreamingBuildPhase] = useState<string | null>(null);
  const streamingBuildCleanupRef = useRef<null | (() => void)>(null);
  // Builder revision history — last 10 artifacts per thread, newest-first.
  // Loaded on thread switch; pushed whenever latestBuildArtifact changes.
  const [builderRevisions, setBuilderRevisions] = useState<BuilderRevision[]>([]);
  // When the user reverts, we override effectiveBuildArtifact with this
  // until a new build lands. null = show the natural latest.
  const [revertedArtifact, setRevertedArtifact] = useState<SwanBotStructuredArtifact | null>(null);
  // Brand pack — local-only per-circle style overrides auto-prepended to
  // build-stream prompts. Loads on circle switch.
  const [brandPack, setBrandPack] = useState<BrandPack | null>(null);
  const [brandPackEditorOpen, setBrandPackEditorOpen] = useState(false);
  // Per-thread builder image library — injected into /build-page prompts
  const [builderImages, setBuilderImages] = useState<BuilderImage[]>([]);
  const [imagesEditorOpen, setImagesEditorOpen] = useState(false);
  const [githubSaveOpen, setGithubSaveOpen] = useState(false);
  const [netlifyDeployOpen, setNetlifyDeployOpen] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [globalFileDragActive, setGlobalFileDragActive] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [spawnModalOpen, setSpawnModalOpen] = useState(false);
  const [buildStudioView, setBuildStudioView] = useState<'code' | 'preview'>('code');
  const [builderPaneWidth, setBuilderPaneWidth] = useState(48);
  const [buildStudioDismissed, setBuildStudioDismissed] = useState(false);
  const [builderModalOpen, setBuilderModalOpen] = useState(false);
  const [cachedBuildArtifact, setCachedBuildArtifact] = useState<SwanBotStructuredArtifact | null>(null);
  const [chatMode, setChatMode] = useState<string>('none');
  // Cline-style Plan-mode gate (Cline research item 1) is derived from
  // OpenSwan's existing `chatMode === 'plan'` — no separate toggle. When
  // the user selects OpenSwan's plan mode, the dispatcher refuses
  // destructive execution kinds (see chatAutomationPlanner helpers).
  const planActMode: 'plan' | 'act' = chatMode === 'plan' ? 'plan' : 'act';

  // Per-thread chat mode persistence. Users pick "plan" or "execute" for
  // a given thread and expect it to stick when they come back. Without
  // this, every thread reset to 'none' and lost the user's posture.
  // localStorage keeps it cheap — no migration, no RPC. Scope by thread
  // so different threads remember different modes.
  const chatModeStorageKey = activeThreadId ? `uc_chat_mode:${activeThreadId}` : null;
  useEffect(() => {
    if (!chatModeStorageKey || typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(chatModeStorageKey);
      if (saved && saved !== chatMode) setChatMode(saved);
    } catch { /* private mode / disabled — not critical */ }
    // Intentional: load once per thread change, not on every mode edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatModeStorageKey]);
  useEffect(() => {
    if (!chatModeStorageKey || typeof localStorage === 'undefined') return;
    try { localStorage.setItem(chatModeStorageKey, chatMode); } catch { /* quota */ }
  }, [chatModeStorageKey, chatMode]);
  const [selectedChatAgentId, setSelectedChatAgentId] = useState<string>(DEFAULT_CHAT_AGENT_TARGET_ID);
  const chatAgentStorageKey = activeThreadId ? `uc_chat_agent:${activeThreadId}` : null;
  useEffect(() => {
    if (!chatAgentStorageKey || typeof localStorage === 'undefined') return;
    try {
      const saved = localStorage.getItem(chatAgentStorageKey);
      if (saved && saved !== selectedChatAgentId) setSelectedChatAgentId(saved);
    } catch { /* private mode / disabled — not critical */ }
    // Intentional: load once per thread change, not on every selection edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatAgentStorageKey]);
  useEffect(() => {
    if (!chatAgentStorageKey || typeof localStorage === 'undefined') return;
    try { localStorage.setItem(chatAgentStorageKey, selectedChatAgentId); } catch { /* quota */ }
  }, [chatAgentStorageKey, selectedChatAgentId]);
  const [agentName, setAgentNameState] = useState<string>(MAIN_CHAT_AGENT_NAME);
  const [editingAgentName, setEditingAgentName] = useState(false);
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const [agentAvatarUri, setAgentAvatarUri] = useState<string | null>(null);
  const pendingHitlApprovals = useAgentApprovals(circleId);
  // "Needs you" attention strip state (plan §1b/§1c/§2b). Declared up here —
  // ahead of sendMessage and the persistence effects that reference the
  // setters — while the derived attention state is computed just before the
  // main return where all inputs exist.
  const [attentionProviderBlocker, setAttentionProviderBlocker] =
    useState<{ provider: string; reason: string } | null>(null);
  const [dismissedAttentionIds, setDismissedAttentionIds] = useState<Set<string>>(new Set());
  const [, setAttentionTick] = useState(0);
  // Latest memory-bank checkpoint → live Restore strip above the composer
  // (plan §2c; the id previously appeared only as prose).
  const [latestMemoryCheckpointId, setLatestMemoryCheckpointId] = useState<string | null>(null);
  // The Restore strip is per-conversation context — clear it on thread
  // switch so thread A's checkpoint never floats above thread B (P12).
  useEffect(() => { setLatestMemoryCheckpointId(null); }, [activeThreadId]);
  // Room handoff (plan §4c): dismissible per-thread suggestion when the
  // conversation turns into multi-file project work.
  const [dismissedRoomHandoffThreads, setDismissedRoomHandoffThreads] = useState<Set<string>>(new Set());
  const [roomHandoffBusy, setRoomHandoffBusy] = useState(false);
  // Recurring watches (plan §6a): while chat is open, due watches run
  // headless and post diff-only updates to their originating thread. The
  // runner is fail-soft (missing table / creds → silent skip) and never
  // grants approvals — watch tasks are floor-checked read-only at create.
  useComputerTaskScheduleRunner({ circleId, userId: currentUserId, enabled: !!circleId });
  const chatAutomationApprovalGate = useMemo(() => createHitlApprovalGate({
    sessionKey: activeThreadId ? `chat::${activeThreadId}` : `chat::${circleId}`,
    agentName,
    timeoutSeconds: 15 * 60,
    describe: (plan) => describeChatAutomationApproval(agentName, plan),
  }), [activeThreadId, agentName, circleId]);
  const automationSuggestionSeenRef = useRef<Set<string>>(new Set());
  const setAgentName = useCallback((name: string) => {
    const trimmed = name.trim() || MAIN_CHAT_AGENT_NAME;
    setAgentNameState(trimmed);
    void saveChatAgentName(circleId, trimmed);
  }, [circleId]);
  const agentAvatarSource = getChatAgentAvatarSource(agentAvatarUri);
  const [pendingHandoff, setPendingHandoff] = useState<HandoffSuggestion | null>(null);
  // Quick action modal states (lifted from old EnhancedQuickBar)
  const [showQuickCheckIn, setShowQuickCheckIn] = useState(false);
  const [showQuickNewTask, setShowQuickNewTask] = useState(false);
  const [showQuickStepAway, setShowQuickStepAway] = useState(false);
  // Agent assignment
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [showSpawnPanel, setShowSpawnPanel] = useState(false);
  const [liveAgents, setLiveAgents] = useState<AssignableAgent[]>([]);
  const refreshAssignableAgentsRef = useRef<(() => Promise<void>) | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AssignableAgent | null>(null);
  const chatAgentTargets = useMemo(
    () => buildChatAgentTargets(liveAgents),
    [liveAgents],
  );
  const selectedChatAgentTarget = useMemo(
    () => resolveChatAgentTarget(chatAgentTargets, selectedChatAgentId),
    [chatAgentTargets, selectedChatAgentId],
  );
  const [activeSpiritId, setActiveSpiritId] = useState<string | null>(null);
  const [soulLearningRefs, setSoulLearningRefs] = useState<ResearchDocumentReference[]>([]);
  const [soulMemoryRefs, setSoulMemoryRefs] = useState<PromptMemoryReference[]>([]);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [assigning, setAssigning] = useState(false);
  // Media attachments
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [builderFigmaRefs, setBuilderFigmaRefs] = useState<FigmaReference[]>([]);
  const [selectedBuilderFigmaRefId, setSelectedBuilderFigmaRefId] = useState<string | null>(null);
  const selectedBuilderFigmaPrompt = useMemo(
    () => buildFigmaPromptFromReferences(builderFigmaRefs, selectedBuilderFigmaRefId),
    [builderFigmaRefs, selectedBuilderFigmaRefId],
  );
  // Computer-use state (web-only)
  const [computerUseSession, setComputerUseSession] = useState<ComputerUseSession | null>(null);
  const [showComputerUsePermission, setShowComputerUsePermission] = useState(false);
  const [pendingComputerUseTask, setPendingComputerUseTask] = useState('');
  const [pendingComputerUseActions, setPendingComputerUseActions] = useState<BrowserAction[]>([]);
  const [pendingComputerUsePlan, setPendingComputerUsePlan] = useState<BrowserPlanCardData | null>(null);
  const [pendingComputerUseGrantSummary, setPendingComputerUseGrantSummary] = useState('');
  const [pendingComputerUseApprovalSummary, setPendingComputerUseApprovalSummary] = useState('');
  const [pendingComputerUseGrantIds, setPendingComputerUseGrantIds] = useState<ComputerTaskGrantId[]>([]);
  const [pendingComputerUseOrigin, setPendingComputerUseOrigin] = useState<{ messageId: string; runId?: string | null; planId: string } | null>(null);
  // T7 sticky allow scopes: the standing-grant scope id riding the pending
  // browser plan, recorded as "used" only when the plan actually launches.
  const [pendingComputerUseStickyScopeId, setPendingComputerUseStickyScopeId] = useState<string | null>(null);
  const [computerTaskState, setComputerTaskState] = useState<ComputerTaskStateRecord | null>(null);
  // Wave-2 task→app resolution: the last route's app choice, kept so a
  // follow-up "use Pixelmator instead" can record a category preference.
  const lastAppResolutionRef = useRef<import('../../../lib/chatComputerRequestRouter').ChatComputerAppResolution | null>(null);
  // The transient last-route pointer survives reload so a "use X instead" sent
  // as the FIRST message after a refresh still has the previous resolution to
  // diff against (the durable per-category preference persists separately). A
  // bounded, JSON-safe single-slot mirror — hydrated once per circle.
  const lastAppResolutionStorageKey = circleId ? `uc_last_app_resolution::${circleId}` : null;
  const persistLastAppResolution = useCallback(() => {
    if (!lastAppResolutionStorageKey || typeof localStorage === 'undefined') return;
    try {
      const serialized = serializeLastAppResolution(lastAppResolutionRef.current);
      if (serialized === null) localStorage.removeItem(lastAppResolutionStorageKey);
      else localStorage.setItem(lastAppResolutionStorageKey, serialized);
    } catch { /* quota — last-route pointer is best-effort */ }
  }, [lastAppResolutionStorageKey]);
  useEffect(() => {
    if (!lastAppResolutionStorageKey || typeof localStorage === 'undefined') return;
    try {
      const restored = deserializeLastAppResolution(localStorage.getItem(lastAppResolutionStorageKey));
      if (restored && !lastAppResolutionRef.current) lastAppResolutionRef.current = restored;
    } catch { /* corrupt state — start clean */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAppResolutionStorageKey]);
  const [pendingCapabilityBuildoutNotice, setPendingCapabilityBuildoutNotice] = useState<{
    key: string;
    task: string;
    buildout: ComputerTaskCapabilityBuildout;
  } | null>(null);
  // Real Computer Use agent (cost-capped Claude + Browserbase via edge function). The
  // permission dialog's Allow handler hands a task to this hook, which
  // streams reasoning/actions/screenshots into ComputerUseLiveCard below.
  const computerUseTask = useComputerUseTask(circleId);
  const agentMonitorTask = useMemo(
    () => buildAgentMonitorTaskFromComputerUseState(computerUseTask.state, { sourceLabel: 'SwanBot' }),
    [computerUseTask.state],
  );
  const computerUsePostedKeyRef = useRef<string | null>(null);
  // Idempotency key for the mirrored mid-run confirmation chat bubble so a
  // single pay/book confirmation posts exactly once (StrictMode-safe).
  const computerConfirmPostedKeyRef = useRef<string | null>(null);
  const capabilityAutoRetryKeyRef = useRef<string | null>(null);
  const capabilityBuildoutNoticeKeyRef = useRef<string | null>(null);
  const chatFailureRecoveryLedgerRef = useRef<Map<string, ChatFailureRecoveryLedgerEntry>>(new Map());
  // Duplicate-handoff suppression survives reload. Bounded localStorage mirror
  // of the ledger — hydrated once per circle, pruned to the same 60-minute
  // retention / 64-entry cap the runtime enforces, so a reload-to-retry can't
  // reset the suppression window and fire a redundant recovery handoff the
  // ledger already saw. Entries are tiny (five numeric fields).
  const failureLedgerStorageKey = circleId ? `uc_chat_failure_ledger::${circleId}` : null;
  const persistChatFailureLedger = useCallback(() => {
    if (!failureLedgerStorageKey || typeof localStorage === 'undefined') return;
    try {
      const serialized = serializeChatFailureLedger(
        chatFailureRecoveryLedgerRef.current.entries(),
        Date.now(),
        CHAT_FAILURE_RECOVERY_LEDGER_RETENTION_MS,
        CHAT_FAILURE_RECOVERY_LEDGER_MAX,
      );
      if (serialized === null) localStorage.removeItem(failureLedgerStorageKey);
      else localStorage.setItem(failureLedgerStorageKey, serialized);
    } catch { /* quota — suppression ledger is best-effort */ }
  }, [failureLedgerStorageKey]);
  useEffect(() => {
    if (!failureLedgerStorageKey || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(failureLedgerStorageKey);
      const bounded = deserializeChatFailureLedger(
        raw,
        Date.now(),
        CHAT_FAILURE_RECOVERY_LEDGER_RETENTION_MS,
        CHAT_FAILURE_RECOVERY_LEDGER_MAX,
      );
      for (const [fingerprint, entry] of bounded) {
        if (!chatFailureRecoveryLedgerRef.current.has(fingerprint)) {
          chatFailureRecoveryLedgerRef.current.set(fingerprint, entry);
        }
      }
    } catch { /* corrupt state — start clean */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failureLedgerStorageKey]);
  // Use Computer console — the pop-up that collects the task before
  // planning. Opens from the Quick Actions "Use Computer" chip and from
  // the __COMPUTER_USE__ slash action.
  const [showComputerUseConsole, setShowComputerUseConsole] = useState(false);
  // D6 needs-you strip dismissal: keyed by the record's updatedAt so a NEW
  // task update re-surfaces the strip, but a dismissed stale state stays
  // hidden across reloads (persisted per circle).
  const [needsYouStripDismissedKey, setNeedsYouStripDismissedKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await storage.getItem(`uc_needs_you_strip_dismissed::${circleId}`);
        if (!cancelled) setNeedsYouStripDismissedKey(stored || null);
      } catch { /* dashboard extra — never break chat */ }
    })();
    return () => { cancelled = true; };
  }, [circleId]);
  // OpenSwan console — launches an OpenSwan turn with a chosen mode.
  // Surface triggered by the Quick Actions "OS OpenSwan" chip.
  const [showOpenSwanConsole, setShowOpenSwanConsole] = useState(false);
  const [openSwanInitialTask, setOpenSwanInitialTask] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const openFromSiteReadiness = (event: Event) => {
      const detail = (event as CustomEvent<{ task?: string | null }>).detail;
      setOpenSwanInitialTask(String(detail?.task || input || '').trim());
      setShowOpenSwanConsole(true);
    };
    window.addEventListener('uc:open-openswan-control-panel', openFromSiteReadiness as EventListener);
    return () => {
      window.removeEventListener('uc:open-openswan-control-panel', openFromSiteReadiness as EventListener);
    };
  }, [input]);

  const persistComputerTaskState = useCallback(async (args: {
    task: string;
    taskKind: string;
    taskLabel: string;
    phase: 'planning' | 'awaiting_approval' | 'awaiting_capability_approval' | 'building_capability' | 'executing' | 'completed' | 'failed' | 'blocked';
    adapterId?: string | null;
    blockers?: string[];
    nextSteps?: string[];
    grantedAccess?: string[];
    accessPlan?: string | null;
    runId?: string | null;
    sessionId?: string | null;
    liveUrl?: string | null;
    grounding?: ComputerTaskStateGrounding | null;
    capabilityBuildout?: ComputerTaskCapabilityBuildout | null;
    complexity?: ComputerTaskStateComplexity | null;
    checkpointRecovery?: ComputerTaskStateCheckpointRecovery | null;
    checkpointRecoveryIsNew?: boolean;
    checkpointRecoveryObservations?: ComputerTaskCheckpointEvidenceObservation[];
    /** D6: result summary used as the completed/failed notification body. */
    resultSummary?: string | null;
  }) => {
    const checkpointRecovery = args.checkpointRecoveryIsNew
      ? markComputerTaskCheckpointRecoveryObserved(computerTaskState?.checkpointRecovery || null, args.checkpointRecovery || null, args.checkpointRecoveryObservations || [])
      : compactComputerTaskCheckpointRecovery(args.checkpointRecovery || null);
    const checkpointNextAction = checkpointRecovery?.retryPolicy?.nextAction || checkpointRecovery?.safeNextStep;
    const capabilityStepLabel = args.capabilityBuildout?.status === 'approval_required'
      ? 'Approve app capability buildout'
      : 'Build missing app capability';
    const phaseNextSteps = checkpointRecovery && (args.phase === 'blocked' || args.phase === 'failed') && checkpointNextAction
      ? [checkpointNextAction]
      : [];
    const nextState: ComputerTaskStateRecord = {
      id: `computer_task_${circleId}_${activeThreadId || 'main'}`,
      circleId,
      threadId: activeThreadId || null,
      task: args.task,
      taskKind: args.taskKind,
      taskLabel: args.taskLabel,
      adapterId: args.adapterId || null,
      phase: args.phase,
      currentStep:
        checkpointRecovery && (args.phase === 'blocked' || args.phase === 'failed') ? `Resolve ${checkpointRecovery.failedCheckpointLabel}`
          : args.phase === 'planning' ? 'Plan task'
          : args.phase === 'awaiting_approval' ? 'Approve access'
            : args.phase === 'awaiting_capability_approval' || args.phase === 'building_capability' ? capabilityStepLabel
            : args.phase === 'executing' ? 'Execute task'
              : args.phase === 'completed' ? 'Summarize result'
                : args.phase === 'blocked' ? 'Resolve blocker'
                  : 'Task failed',
      steps: buildComputerTaskStateSteps({
        taskKind: args.taskKind,
        phase: args.phase,
        capabilityBuildout: args.capabilityBuildout || null,
        complexity: args.complexity || null,
      }),
      blockers: (args.blockers || []).filter(Boolean).slice(0, 5),
      nextSteps: Array.from(new Set([...phaseNextSteps, ...(args.nextSteps || [])].filter(Boolean))).slice(0, 5),
      grantedAccess: (args.grantedAccess || []).filter(Boolean).slice(0, 8),
      accessPlan: args.accessPlan || null,
      runId: args.runId || null,
      sessionId: args.sessionId || null,
      liveUrl: args.liveUrl || null,
      grounding: args.grounding || null,
      capabilityBuildout: args.capabilityBuildout || null,
      complexity: args.complexity || null,
      checkpointRecovery,
      updatedAt: new Date().toISOString(),
    };
    // D6: derive a completion/blocked/needs-you notification on this
    // transition. The stored record is the previous snapshot (the in-memory
    // copy can miss hook-written questions/notifications), and its bounded
    // notification list carries over so banners survive phase rewrites.
    // Reading storage (not React state) also keeps this callback's deps
    // narrow — widening them would re-trigger the run-status effect loop.
    const previousForNotifications = await loadComputerTaskState(circleId, activeThreadId).catch(() => null);
    const notification = deriveComputerTaskNotification(
      nextState,
      computerTaskNotificationSnapshot(previousForNotifications),
      { resultSummary: args.resultSummary || null },
    );
    nextState.notifications = appendComputerTaskNotification(previousForNotifications?.notifications, notification);
    setComputerTaskState(nextState);
    await saveComputerTaskState(nextState);
  }, [activeThreadId, circleId, computerTaskState?.checkpointRecovery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await loadComputerTaskState(circleId, activeThreadId).catch(() => null);
      if (!cancelled) setComputerTaskState(existing);
    })();
    return () => { cancelled = true; };
  }, [activeThreadId, circleId]);

  // D6: acknowledge persisted task notifications (banner DISMISS, or the
  // console opening on a terminal banner) and refresh the mount-loaded copy.
  const acknowledgeTaskNotifications = useCallback(() => {
    void (async () => {
      const next = await acknowledgeComputerTaskNotificationsState(circleId, activeThreadId);
      if (next) setComputerTaskState(next);
    })();
  }, [activeThreadId, circleId]);

  useEffect(() => {
    // Completed/failed banners auto-acknowledge once the console is open —
    // the user has now seen the outcome. Needs-you/blocked/partial banners
    // stay until explicitly dismissed (they still require action).
    if (!showComputerUseConsole) return;
    const unacknowledged = listUnacknowledgedComputerTaskNotifications(computerTaskState);
    if (unacknowledged.length > 0 && (unacknowledged[0].kind === 'completed' || unacknowledged[0].kind === 'failed')) {
      acknowledgeTaskNotifications();
    }
  }, [acknowledgeTaskNotifications, computerTaskState, showComputerUseConsole]);

  useEffect(() => {
    // T7 sticky allow scopes: hydrate the in-memory grant registry on the
    // chat path so the synchronous request router sees standing grants on a
    // fresh app load (previously hydrated only when the Computer Use console
    // opened, which made chat fail closed and keep prompting).
    let cancelled = false;
    import('../../../lib/computerGrantGateStore')
      .then(({ loadStickyAllowScopes }) => (cancelled ? null : loadStickyAllowScopes()))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Wave-2 task→app resolution: hydrate the router's in-memory app-resolution
  // registry (same pattern as the T7 sticky-scope registry above) so the
  // synchronous route build can pick the best app for everyday tasks —
  // installed/running apps from the desktop bridge plus the circle's
  // preferred-app-per-category store. Silent failures leave the fail-honest
  // empty context (bridge treated as offline; known-good web apps win).
  const hydrateAppResolutionContext = useCallback(async () => {
    try {
      const [{ setAppResolutionContext }, bridge, shortcuts] = await Promise.all([
        import('../../../lib/chatComputerRequestRouter'),
        import('../../../lib/desktopBridge'),
        import('../../../lib/knownAppShortcuts'),
      ]);
      const bridgeOnline = await bridge.isDesktopBridgeAvailable().catch(() => false);
      const [installedApps, runningApps, preferredAppByCategory] = await Promise.all([
        bridgeOnline ? bridge.listInstalledAppNamesLower().catch(() => [] as string[]) : Promise.resolve([] as string[]),
        bridgeOnline
          ? bridge.listRunningApps().then((result) => (result.ok ? result.data : undefined)).catch(() => undefined)
          : Promise.resolve(undefined),
        shortcuts.loadPreferredAppsByCategory(circleId).catch(() => ({})),
      ]);
      setAppResolutionContext({
        bridgeOnline,
        // An empty probe result is ambiguous (it also means "probe failed")
        // — fail honest by leaving installedApps unknown instead of
        // claiming nothing is installed.
        ...(installedApps.length > 0 ? { installedApps } : {}),
        ...(runningApps && runningApps.length > 0 ? { runningApps } : {}),
        preferredAppByCategory,
      });
    } catch { /* fail-honest: unhydrated registry keeps bridgeOnline=false */ }
  }, [circleId]);

  useEffect(() => {
    void hydrateAppResolutionContext();
  }, [hydrateAppResolutionContext]);

  useEffect(() => {
    const capabilityBuildout = computerTaskState?.capabilityBuildout;
    if (!computerTaskState || capabilityBuildout?.status !== 'requested' || !capabilityBuildout.sessionId) return;

    let cancelled = false;
    const refresh = async () => {
      const refreshed = await refreshComputerTaskCapabilityBuildoutFromCodexSession(capabilityBuildout).catch(() => null);
      if (cancelled || !refreshed) return;
      const hints = buildAgentAppCapabilityBuildoutStateHints({
        status: refreshed.status,
        message: refreshed.message,
        retryPlan: refreshed.retryPlan,
        userActionNeeded: refreshed.userActionNeeded,
        missingEvidence: refreshed.missingEvidence,
      });
      await persistComputerTaskState({
        task: computerTaskState.task,
        taskKind: computerTaskState.taskKind,
        taskLabel: computerTaskState.taskLabel,
        phase: hints.phase || computerTaskState.phase,
        adapterId: computerTaskState.adapterId || null,
        blockers: Array.from(new Set([
          ...computerTaskState.blockers,
          ...hints.blockers,
        ])).slice(0, 8),
        nextSteps: hints.nextSteps.length > 0 ? hints.nextSteps : computerTaskState.nextSteps,
        grantedAccess: computerTaskState.grantedAccess,
        accessPlan: computerTaskState.accessPlan,
        runId: computerTaskState.runId || null,
        sessionId: computerTaskState.sessionId || null,
        liveUrl: computerTaskState.liveUrl || null,
        grounding: computerTaskState.grounding || null,
        capabilityBuildout: refreshed,
        complexity: computerTaskState.complexity || null,
        checkpointRecovery: computerTaskState.checkpointRecovery || null,
      });
      if (refreshed.status === 'blocked' || refreshed.status === 'failed' || refreshed.status === 'incomplete') {
        const noticeKey = [
          computerTaskState.id,
          refreshed.status,
          refreshed.sessionId || '',
          refreshed.userActionNeeded || refreshed.summary || refreshed.retryPlan || refreshed.message,
        ].join(':');
        if (capabilityBuildoutNoticeKeyRef.current !== noticeKey) {
          capabilityBuildoutNoticeKeyRef.current = noticeKey;
          setPendingCapabilityBuildoutNotice({
            key: noticeKey,
            task: computerTaskState.task,
            buildout: refreshed,
          });
        }
      }
    };

    void refresh();
    const interval = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    computerTaskState?.id,
    computerTaskState?.capabilityBuildout?.sessionId,
    computerTaskState?.capabilityBuildout?.status,
    persistComputerTaskState,
  ]);

  const syncSessionArchiveMessage = useCallback((message: ChatMessage | null | undefined) => {
    if (!message || !circleId) return;
    void upsertChatSessionArchiveMessage({
      circleId,
      threadId: activeThreadId || null,
      messageId: message.id,
      dbId: message.dbId || null,
      role: message.isBot ? 'assistant' : 'user',
      content: message.content,
      timestamp: message.timestamp?.getTime?.() || Date.now(),
      userName: message.userName || null,
      replyTo: message.replyTo?.content || null,
      runId: message.runId || null,
      isPending: message.isPending === true,
      memoriesUsed: message.memoriesUsed,
      memoryRefs: message.memoryRefs,
      memoryRecommendations: message.memoryRecommendations,
      executionStream: message.executionStream,
      toolEvents: message.toolEvents,
      verificationResults: message.verificationResults,
      browserPlans: message.browserPlans,
      browserPlanEvents: message.browserPlanEvents,
      browserSessions: message.browserSessions,
      recoveryOptions: message.recoveryOptions,
      recoveryReliability: message.recoveryReliability,
    }).catch((error) => {
      console.warn('[ChatTab] session archive sync failed:', error);
    });
  }, [activeThreadId, circleId]);

  const recordSessionArchiveError = useCallback((summary: string, detail?: string | null, touched?: string[]) => {
    if (!circleId) return;
    void appendChatSessionArchiveEvent({
      circleId,
      threadId: activeThreadId || null,
      kind: 'error',
      summary,
      detail: detail || null,
      touched,
    }).catch((error) => {
      console.warn('[ChatTab] session archive error event failed:', error);
    });
  }, [activeThreadId, circleId]);

  const recordSessionArchiveEvent = useCallback((opts: {
    kind: 'tool' | 'verification' | 'browser_plan' | 'browser_session' | 'memory' | 'computer_task';
    summary: string;
    detail?: string | null;
    touched?: string[];
    metadata?: Record<string, unknown>;
  }) => {
    if (!circleId) return;
    void appendChatSessionArchiveEvent({
      circleId,
      threadId: activeThreadId || null,
      kind: opts.kind,
      summary: opts.summary,
      detail: opts.detail || null,
      touched: opts.touched,
      metadata: opts.metadata,
    }).catch((error) => {
      console.warn('[ChatTab] session archive event failed:', error);
    });
  }, [activeThreadId, circleId]);

  const startMainChatFailureRecoveryPayload = useCallback(async (details: ChatFailureRecoveryDetails): Promise<ChatFailureRecoveryPayload> => {
    const task = details.task.trim() || 'Recover failed chat task';
    try {
      const {
        buildChatFailureRecoveryFingerprint,
        shouldSuppressDuplicateChatFailureHandoff,
        startChatFailureRecovery,
      } = await import('../../../lib/chatFailureRecovery');
      const route = analyzeMessageRouting(task, 'main_chat').route;
      const recoveryPlanSummary = [
        details.planSummary ? `Existing plan summary:\n${details.planSummary}` : '',
        `Chat mode: ${chatMode || 'none'}`,
        `Session profile: ${sessionProfile || 'auto'}`,
        `Selected model: ${selectedModel || 'auto'}`,
        `Resolved send model: ${resolveSendModel(task) || 'auto'}`,
        `Web search enabled: ${webSearchEnabled}`,
        route ? `Route intent: ${route.intent || 'unknown'}; complexity: ${route.complexity || 'unknown'}; profile: ${route.profile || 'unknown'}; confidence: ${route.confidence || 'unknown'}` : '',
        `Connected providers: ${Array.from(connectedProviderSet).slice(0, 16).join(', ') || 'none'}`,
      ].filter(Boolean).join('\n');
      const baseRecoveryInput = {
        task,
        failureMessage: details.failureMessage,
        failureStack: details.failureStack,
        outcomeStatus: details.outcomeStatus || 'failed',
        executionKind: details.executionKind || 'run_openswan',
        runId: details.runId,
        planSummary: recoveryPlanSummary,
        groundingSummary: details.groundingSummary,
        preflightSummary: details.preflightSummary,
        source: details.source || 'main_chat_failure',
        launchIfMissing: details.launchIfMissing ?? true,
        circleId,
        userId: currentUserId || 'anonymous',
        selectedModel,
        checkpointRecovery: details.checkpointRecovery || null,
        evidenceContract: details.evidenceContract || null,
        appRouteDecision: details.appRouteDecision || null,
      };
      const fingerprint = buildChatFailureRecoveryFingerprint(baseRecoveryInput);
      const now = Date.now();
      const ledger = chatFailureRecoveryLedgerRef.current;
      for (const [key, entry] of Array.from(ledger.entries())) {
        if (now - entry.lastAt > CHAT_FAILURE_RECOVERY_LEDGER_RETENTION_MS) {
          ledger.delete(key);
        }
      }
      const previous = ledger.get(fingerprint);
      const recentRepeat = Boolean(previous && now - previous.lastAt <= CHAT_FAILURE_RECOVERY_REPEAT_WINDOW_MS);
      const repeatCount = recentRepeat ? (previous?.count || 0) + 1 : 1;
      const suppressConnectedHandoff = shouldSuppressDuplicateChatFailureHandoff({
        recentRepeat,
        repeatCount,
        lastSuccessfulHandoffAt: previous?.lastSuccessfulHandoffAt || null,
        nowMs: now,
        repeatWindowMs: CHAT_FAILURE_RECOVERY_REPEAT_WINDOW_MS,
      });
      const firstAt = recentRepeat ? previous?.firstAt || now : now;
      const suppressionReason = suppressConnectedHandoff
        ? `matching failure seen ${repeatCount} times in ${Math.max(1, Math.round((now - firstAt) / 1000))}s after a successful recovery handoff; keeping the existing recovery path instead of launching another handoff`
        : null;
      const ledgerEntry: ChatFailureRecoveryLedgerEntry = {
        firstAt,
        lastAt: now,
        count: repeatCount,
        suppressedCount: (recentRepeat ? previous?.suppressedCount || 0 : 0) + (suppressConnectedHandoff ? 1 : 0),
        lastSuccessfulHandoffAt: previous?.lastSuccessfulHandoffAt || null,
      };
      ledger.set(fingerprint, ledgerEntry);
      if (ledger.size > CHAT_FAILURE_RECOVERY_LEDGER_MAX) {
        const oldestKey = Array.from(ledger.entries()).sort((a, b) => a[1].lastAt - b[1].lastAt)[0]?.[0];
        if (oldestKey) ledger.delete(oldestKey);
      }
      persistChatFailureLedger();

      const recovery = await startChatFailureRecovery({
        ...baseRecoveryInput,
        recoveryFingerprint: fingerprint,
        repeatCount,
        suppressConnectedHandoff,
        suppressionReason,
      });
      ledger.set(fingerprint, {
        ...ledgerEntry,
        lastSuccessfulHandoffAt: recovery.recovery.ok ? now : ledgerEntry.lastSuccessfulHandoffAt,
      });
      persistChatFailureLedger();
      recordSessionArchiveEvent({
        kind: 'tool',
        summary: recovery.archiveSummary,
        touched: Array.from(new Set([...(details.touched || []), ...recovery.archiveTouched])),
        metadata: recovery.archiveMetadata,
      });
      const recoveryReliability = getRecoveryReliabilityFromArchive(recovery.archiveMetadata);
      return {
        message: `\n\n${recovery.userMessage}`,
        recoveryOptions: recovery.recoveryOptions,
        recoveryReliability,
        archiveMetadata: recovery.archiveMetadata,
      };
    } catch (recoveryError: any) {
      recordSessionArchiveError(
        `Chat failure recovery handoff failed: ${recoveryError?.message || 'Unknown error'}`,
        typeof recoveryError?.stack === 'string' ? recoveryError.stack : null,
        ['surface:main_chat', 'surface:failure_recovery', ...(details.touched || [])],
      );
      return {
        message: '\n\nRecovery could not start automatically. Try again, or open the details for support.',
        recoveryOptions: [{
          id: 'stop_and_report',
          label: 'Stop and report the blocker',
          detail: 'Recovery could not start automatically. Technical details were saved for support.',
          actor: 'none',
          recommended: true,
          source: 'safety_stop',
        }],
      };
    }
  }, [
    chatMode,
    circleId,
    connectedProviderSet,
    currentUserId,
    recordSessionArchiveError,
    recordSessionArchiveEvent,
    resolveSendModel,
    selectedModel,
    sessionProfile,
    webSearchEnabled,
  ]);

  const loadSessionArchiveContext = useCallback(async () => {
    if (!circleId) return null;
    const archive = await loadChatSessionArchive(circleId, activeThreadId).catch(() => null);
    return formatChatSessionArchiveBlock(archive, {
      maxMessages: 10,
      maxEvents: 12,
      maxRecommendations: 3,
      maxTouched: 24,
      maxChars: 3200,
    });
  }, [activeThreadId, circleId]);

  const executeSharedComputerTask = useCallback(async (taskText: string, options?: {
    planPrefix?: string;
    readyCapabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  }) => {
    const trimmed = taskText.trim();
    if (!trimmed) return;
    // T7 sticky allow scopes: re-hydrate the standing-grant registry before
    // the synchronous route build below reads it, so a grant persisted on a
    // previous load can downgrade approval on the first task of this session.
    await import('../../../lib/computerGrantGateStore')
      .then(({ loadStickyAllowScopes }) => loadStickyAllowScopes())
      .catch(() => {});
    // Wave-2: refresh the app-resolution registry fire-and-forget (bridge
    // probes are cached). The awaits below give it time to land before the
    // route build; a stale registry only degrades the app pick, never blocks.
    void hydrateAppResolutionContext();
    const initialExecution = prepareComputerTaskExecution({ task: trimmed, audit: null, grantedIds: [] });
    const surfacePreparationPlan = buildComputerTaskSurfacePreparationPlan(initialExecution);
    const surfacePreparationResult = surfacePreparationPlan.shouldPrepareDesktopBridge && Platform.OS === 'web'
      ? await autoConnectDesktopBridge().catch((error: any) => ({
          ok: false,
          status: 'starter_failed' as const,
          content: error?.message || String(error || 'Desktop bridge preparation failed.'),
          detail: error?.message || String(error || 'Desktop bridge preparation failed.'),
          userActionRequired: true,
        }))
      : null;
    const surfacePreparationReceipt = buildComputerTaskSurfacePreparationReceipt(
      surfacePreparationPlan,
      surfacePreparationResult,
    );
    if (surfacePreparationReceipt.attempted) {
      recordSessionArchiveEvent({
        kind: 'tool',
        summary: surfacePreparationReceipt.summary,
        touched: surfacePreparationReceipt.touched,
        metadata: {
          surfacePreparation: surfacePreparationReceipt,
          plan: surfacePreparationPlan,
        },
      });
    }
    const audit = await auditComputerCapabilities(circleId).catch(() => null);
    let grantedIds = await loadComputerTaskGrantIds(circleId).catch(() => []);
    const previewExecution = prepareComputerTaskExecution({ task: trimmed, audit, grantedIds });
    const [businessProfiles, providerKeys] = await Promise.all([
      loadCircleBusinessModelProfiles(circleId).catch(() => []),
      listApiKeys().catch(() => []),
    ]);
    const businessModelPlan = planBusinessModelForComputerTask({
      task: trimmed,
      preview: previewExecution.preview,
      profiles: [...businessProfiles, ...buildImplicitBusinessModelProfiles(providerKeys)],
      providerKeys,
    });
    let execution = prepareComputerTaskExecution({ task: trimmed, audit, grantedIds, businessModelPlan });
    const markEarlyReadyCapabilityAutoRetryFailed = async (reason: string, nextSteps: string[]) => {
      if (!options?.readyCapabilityBuildout) return;
      const failedAt = new Date().toISOString();
      const earlyGroundingState = buildComputerTaskGroundingStateFromExecution(execution);
      await persistComputerTaskState({
        task: trimmed,
        taskKind: execution.preview.kind,
        taskLabel: execution.preview.label,
        phase: 'blocked',
        adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
        grantedAccess: execution.grants.granted,
        accessPlan: execution.grants.summary,
        blockers: [reason, ...(earlyGroundingState?.blockers || [])].slice(0, 6),
        nextSteps: nextSteps.slice(0, 4),
        grounding: earlyGroundingState,
        capabilityBuildout: {
          ...options.readyCapabilityBuildout,
          autoRetryStatus: 'failed',
          autoRetryCompletedAt: failedAt,
          updatedAt: failedAt,
        },
        complexity: compactComputerTaskComplexityPlan(execution.complexityPlan),
        checkpointRecovery: diagnoseComputerTaskCheckpointFailure({
          task: trimmed,
          failureMessage: reason,
          outcomeStatus: 'blocked',
          executionKind: 'run_computer_task',
          source: 'computer_task_capability_auto_retry',
          groundingSummary: earlyGroundingState?.summary || null,
          complexityPlan: execution.complexityPlan,
        }),
        checkpointRecoveryIsNew: true,
        checkpointRecoveryObservations: execution.computerAppGroundingTrace?.observations || [],
      });
    };
    const needsLocalFileRead = execution.entrypoint !== 'browser_runtime'
      && execution.grants.grants.some((grant) => grant.id === 'file_read');
    const needsLocalFileWrite = execution.entrypoint !== 'browser_runtime'
      && execution.grants.grants.some((grant) => grant.id === 'file_write');
    const needsLocalFileSessionGrant = needsLocalFileRead || needsLocalFileWrite;
    const canRequestLocalFileSessionGrant = !surfacePreparationReceipt.attempted || surfacePreparationReceipt.ok;
    if (needsLocalFileSessionGrant && canRequestLocalFileSessionGrant) {
      const roots = inferLocalFileGrantRootsForTask(trimmed);
      const requiredScope = needsLocalFileWrite ? 'write' : 'read';
      const existingGrant = getActiveLocalFileSessionGrant(roots, requiredScope);
      if (!existingGrant) {
        const rootLabel = roots.join(', ');
        const grantResult = await requestLocalFileSessionGrant({
          roots,
          scope: requiredScope,
          reason: trimmed,
        });
        if (!grantResult.ok) {
          const grantBlockedPresentation = buildComputerTaskLocalFileAccessBlockedPresentation({
            roots,
            scope: requiredScope,
            error: grantResult.error || null,
            errorCode: grantResult.errorCode || null,
          });
          const grantGroundingState = buildComputerTaskGroundingStateFromExecution(execution);
          await persistComputerTaskState({
            task: trimmed,
            taskKind: execution.preview.kind,
            taskLabel: execution.preview.label,
            phase: 'blocked',
            adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
            grantedAccess: execution.grants.granted,
            accessPlan: execution.grants.summary,
            blockers: [
              ...grantBlockedPresentation.blockers,
              ...(grantGroundingState?.blockers || []),
            ].slice(0, 6),
            nextSteps: grantBlockedPresentation.nextSteps,
            grounding: grantGroundingState,
            capabilityBuildout: options?.readyCapabilityBuildout
              ? {
                  ...options.readyCapabilityBuildout,
                  autoRetryStatus: 'failed',
                  autoRetryCompletedAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }
              : null,
            complexity: compactComputerTaskComplexityPlan(execution.complexityPlan),
          });
          recordSessionArchiveEvent({
            kind: 'computer_task',
            summary: `Computer task paused for local file ${requiredScope} access: ${trimmed}`,
            touched: Array.from(new Set([
              'surface:computer_use',
              'surface:local_file',
              `computer_task:${trimmed}`,
              ...roots,
            ])),
            metadata: {
              localFileSessionGrant: {
                scope: requiredScope,
                roots,
                error: grantResult.error || null,
                errorCode: grantResult.errorCode || null,
              },
              grounding: grantGroundingState,
              complexityPlan: execution.complexityPlan,
            },
          });
          addBotMessage(grantBlockedPresentation.message, undefined, {
            localOnly: true,
            source: {
              actor: 'OpenSwan',
              surface: 'main_chat_desktop_bridge',
              selectedModel,
              effectiveModel: 'local-desktop-bridge',
            },
          });
          return { handled: true as const, browser: false as const };
        }
        recordSessionArchiveEvent({
          kind: 'tool',
          summary: `Prepared scoped local file ${requiredScope} access for ${rootLabel}.`,
          touched: roots,
          metadata: {
            localFileSessionGrant: {
              scope: requiredScope,
              roots,
              expiresAt: grantResult.data?.expiresAt || null,
            },
          },
        });
      }
      grantedIds = Array.from(new Set([
        ...grantedIds,
        'file_read' as ComputerTaskGrantId,
        ...(needsLocalFileWrite ? ['file_write' as ComputerTaskGrantId] : []),
      ]));
      execution = prepareComputerTaskExecution({ task: trimmed, audit, grantedIds, businessModelPlan });
    }
    const businessModelPickerId = businessModelPlan.routeProvider && businessModelPlan.routeModel
      ? `${businessModelPlan.routeProvider}/${businessModelPlan.routeModel}`
      : null;
    const computerTaskModel = selectedModel !== 'auto'
      ? selectedModel
      : (businessModelPickerId || resolveSendModel(trimmed) || undefined);
    // Composer-pattern split (P9): on Auto, the app-trained BlackSwan plans
    // the browser/app task (it knows the app's sites, pipelines, and
    // vocabulary) while the runtime keeps computerTaskModel — and the
    // native screen loop keeps its Sonnet pin regardless. Explicit picks
    // plan with the picked model.
    const computerTaskPlannerModel =
      resolveComputerTaskPlannerModel(selectedModel, connectedProviderSet) || computerTaskModel;
    const groundingState = buildComputerTaskGroundingStateFromExecution(execution);
    const groundingNextSteps = groundingState?.nextAction
      ? [`Grounding next action: ${groundingState.nextAction}`]
      : [];
    const groundingBlockers = groundingState?.blockers || [];
    const surfacePreparationBlockers = surfacePreparationReceipt.ok
      ? []
      : surfacePreparationReceipt.warnings;
    const preflightBlockers = [
      ...surfacePreparationBlockers,
      ...execution.preflight.blockers.map((item) => `${item.label}: ${item.fix}`),
    ];
    const preflightWarnings = execution.preflight.warnings.map((item) => `${item.label}: ${item.fix}`);
    const preflightIssues = [...preflightBlockers, ...preflightWarnings];
    const defaultNextSteps = execution.entrypoint === 'browser_runtime'
      ? ['Review the access plan', 'Approve browser access if the task looks right']
      : ['Run the best available computer surface', 'Review the result and blockers'];
    const complexityNextSteps = execution.complexityPlan.level === 'simple'
      ? []
      : execution.complexityPlan.visibleNextSteps;
    const surfacePreparationBlockedPresentation = buildComputerTaskSurfacePreparationBlockedPresentation(surfacePreparationReceipt);
    if (surfacePreparationBlockedPresentation.shouldBlock) {
      const blocker = surfacePreparationBlockedPresentation.blockers[0] || surfacePreparationReceipt.summary;
      await markEarlyReadyCapabilityAutoRetryFailed(blocker, surfacePreparationBlockedPresentation.nextSteps);
      await persistComputerTaskState({
        task: trimmed,
        taskKind: execution.preview.kind,
        taskLabel: execution.preview.label,
        phase: 'blocked',
        adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
        grantedAccess: execution.grants.granted,
        accessPlan: execution.grants.summary,
        blockers: [
          ...surfacePreparationBlockedPresentation.blockers,
          ...execution.preflight.blockers.map((item) => `${item.label}: ${item.fix}`),
          ...groundingBlockers,
        ].slice(0, 6),
        nextSteps: surfacePreparationBlockedPresentation.nextSteps,
        grounding: groundingState,
        capabilityBuildout: options?.readyCapabilityBuildout
          ? {
              ...options.readyCapabilityBuildout,
              autoRetryStatus: 'failed',
              autoRetryCompletedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null,
        complexity: compactComputerTaskComplexityPlan(execution.complexityPlan),
      });
      recordSessionArchiveEvent({
        kind: 'computer_task',
        summary: `Computer task paused for desktop bridge preparation: ${trimmed}`,
        touched: Array.from(new Set([
          'surface:computer_use',
          'surface:desktop_bridge',
          `computer_task:${trimmed}`,
          execution.preview.kind,
          ...surfacePreparationReceipt.touched,
        ])),
        metadata: {
          entrypoint: execution.entrypoint,
          surfacePreparation: surfacePreparationReceipt,
          grounding: groundingState,
          complexityPlan: execution.complexityPlan,
        },
      });
      addBotMessage(surfacePreparationBlockedPresentation.message, undefined, {
        source: {
          actor: 'OpenSwan',
          surface: 'main_chat_desktop_bridge',
          selectedModel,
          effectiveModel: 'local-desktop-bridge',
        },
      });
      return { handled: true as const, browser: false as const };
    }
    await persistComputerTaskState({
      task: trimmed,
      taskKind: execution.preview.kind,
      taskLabel: execution.preview.label,
      phase: options?.readyCapabilityBuildout ? 'executing' : 'planning',
      adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
      grantedAccess: execution.grants.granted,
      accessPlan: execution.grants.summary,
      blockers: [
        ...(!execution.readiness.ready ? [execution.readiness.summary] : []),
        ...preflightIssues,
        ...groundingBlockers,
      ].slice(0, 6),
      nextSteps: execution.preflight.fixActions.length > 0
        ? execution.preflight.fixActions.slice(0, 4)
        : [...groundingNextSteps, ...complexityNextSteps, ...defaultNextSteps].slice(0, 5),
      grounding: groundingState,
      capabilityBuildout: options?.readyCapabilityBuildout || null,
      complexity: compactComputerTaskComplexityPlan(execution.complexityPlan),
    });
    recordSessionArchiveEvent({
      kind: 'computer_task',
      summary: `Computer task planned: ${trimmed}`,
      touched: [
        'surface:computer_use',
        `computer_task:${trimmed}`,
        execution.preview.kind,
      ],
      metadata: {
        entrypoint: execution.entrypoint,
        capabilityProfile: execution.capabilityProfile,
        recommendedMode: execution.recommendedMode,
        preflight: {
          status: execution.preflight.status,
          ready: execution.preflight.ready,
          strategy: execution.preflight.strategy
            ? {
                id: execution.preflight.strategy.id,
                label: execution.preflight.strategy.label,
              }
            : null,
          blockers: preflightBlockers,
          warnings: preflightWarnings,
          fixActions: execution.preflight.fixActions,
        },
        grounding: groundingState,
        complexityPlan: execution.complexityPlan,
        businessModel: businessModelPlan.selectedProfile
          ? {
              id: businessModelPlan.selectedProfile.id,
              provider: businessModelPlan.routeProvider,
              model: businessModelPlan.routeModel,
              surface: businessModelPlan.matchedSurface,
            }
          : null,
      },
    });

    const builtPlan = buildChatAutomationPlan({
      message: options?.planPrefix ? `${options.planPrefix}${trimmed}` : trimmed,
      selectedMode: chatMode,
    });
    const computerPlan: ChatAutomationPlan = builtPlan.execution.kind === 'run_computer_task'
      ? builtPlan
      : {
          source: 'plain_chat',
          intent: { kind: 'direct_chat', message: trimmed },
          execution: { kind: 'run_computer_task', routeId: 'browser', commandText: trimmed },
          risk: 'safe',
          approval: { required: false, reason: null },
          confidence: 0.9,
          notes: ['Forced into the shared computer-task runtime.'],
        };
    const computerRequestNotice = computerPlan.computerRequestRoute
      ? buildChatComputerRequestUserNotice(computerPlan.computerRequestRoute)
      : null;
    // Wave-2: remember this route's app choice so a follow-up "use <app>
    // instead" can record the user's preferred app for the category.
    if (computerPlan.computerRequestRoute) {
      lastAppResolutionRef.current = computerPlan.computerRequestRoute.appResolution ?? null;
      persistLastAppResolution();
    }
    const computerEvidenceContract = computerPlan.computerRequestRoute?.evidenceContract || null;
    const computerAppRouteDecision = computerPlan.computerRequestRoute?.appAutomationRouteDecision || execution.preflight.routeDecision || null;
    const computerStickyScopeApplied = computerPlan.computerRequestRoute?.stickyScopeApplied || null;

    const startTaskFailureRecovery = async (details: {
      failureMessage: string;
      failureStack?: string | null;
      outcomeStatus?: string | null;
      executionKind?: string | null;
      runId?: string | null;
      planSummary?: string | null;
      groundingSummary?: string | null;
      preflightSummary?: string | null;
      source?: string | null;
      complexityPlan?: ComputerTaskComplexityPlan | null;
      checkpointRecovery?: ComputerTaskCheckpointRecoveryContext | null;
      evidenceContract?: ComputerTaskEvidenceContract | null;
      appRouteDecision?: ComputerTaskAppRouteDecisionInput | null;
    }): Promise<ChatFailureRecoveryPayload> => {
      const checkpointRecovery = details.checkpointRecovery || diagnoseComputerTaskCheckpointFailure({
        task: trimmed,
        failureMessage: details.failureMessage,
        outcomeStatus: details.outcomeStatus,
        executionKind: details.executionKind || 'run_computer_task',
        source: details.source || 'chat_computer_task',
        planSummary: details.planSummary,
        groundingSummary: details.groundingSummary,
        preflightSummary: details.preflightSummary,
        complexityPlan: details.complexityPlan || execution.complexityPlan,
      });
      // W5/X1 (P45): every computer-task terminal (all three call sites
      // funnel here) is classified through the unified lane boundary and the
      // two-axis signal rides the recovery archive tags. Telemetry only —
      // the evidence-recovery flow stays authoritative.
      let laneTags: string[] = [];
      try {
        const { normalizeThrownError, buildChatLaneOutcomeTags, summarizeChatLaneOutcomeForTelemetry } =
          await import('../../../lib/chatLaneOutcome');
        const laneOutcome = normalizeThrownError('computer_task', details.failureMessage);
        laneTags = buildChatLaneOutcomeTags(laneOutcome);
        console.warn('[ChatTab] lane terminal:', JSON.stringify(summarizeChatLaneOutcomeForTelemetry(laneOutcome)));
        // X7 (P48): registry + degradation-scope tags.
        const { recordChatLaneOutcomeNow, buildChatLaneHealthTags } =
          await import('../../../lib/chatLaneHealthRegistry');
        recordChatLaneOutcomeNow(laneOutcome);
        laneTags = [...laneTags, ...buildChatLaneHealthTags('computer_task', Date.now())];
      } catch {}
      return startMainChatFailureRecoveryPayload({
        task: trimmed,
        failureMessage: details.failureMessage,
        failureStack: details.failureStack,
        outcomeStatus: details.outcomeStatus,
        executionKind: details.executionKind || 'run_computer_task',
        runId: details.runId,
        planSummary: details.planSummary,
        groundingSummary: details.groundingSummary,
        preflightSummary: details.preflightSummary,
        source: details.source || 'chat_computer_task',
        launchIfMissing: true,
        checkpointRecovery,
        evidenceContract: details.evidenceContract || computerEvidenceContract,
        appRouteDecision: details.appRouteDecision || computerAppRouteDecision,
        touched: [
          'surface:computer_use',
          `computer_task:${trimmed}`,
          checkpointRecovery ? `checkpoint:${checkpointRecovery.failedCheckpointId}` : '',
          (details.evidenceContract || computerEvidenceContract)?.targetName
            ? `evidence_contract:${(details.evidenceContract || computerEvidenceContract)?.targetName}`
            : '',
          ...laneTags,
        ].filter(Boolean),
      });
    };

    setBotTyping(true);
    setRunStatus('running');
    try {
      if (preflightBlockers.length > 0) {
        const blockerLines = preflightBlockers.map((blocker) => `- ${blocker}`).join('\n');
        const fixLines = execution.preflight.fixActions.map((fix) => `- ${fix}`).join('\n');
        const preflightHandoffContext = buildChatComputerHandoffContext({
          task: trimmed,
          entrypoint: execution.entrypoint,
          adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
          taskKind: execution.preview.kind,
          taskLabel: execution.preview.label,
          capabilityProfile: execution.capabilityProfile,
          recommendedMode: execution.recommendedMode,
          grantSummary: execution.grants.summary,
          approvalSummary: execution.grants.approvalSummary,
          preflightStatus: execution.preflight.status,
          preflightSummary: execution.preflight.summary,
          groundingStatus: groundingState?.status || null,
          groundingSummary: groundingState?.summary || null,
          requestNotice: computerRequestNotice,
          evidenceContract: computerEvidenceContract,
          appAutomationRouteDecision: computerAppRouteDecision,
          stickyScopeApplied: computerStickyScopeApplied,
          warnings: preflightWarnings,
          blockers: [...preflightBlockers, ...groundingBlockers],
        });
        const preflightHandoffBlock = formatChatComputerHandoffForMessage(preflightHandoffContext);
        const preflightFailureMessage = [
          execution.preflight.summary,
          blockerLines ? `Blockers:\n${blockerLines}` : '',
          fixLines ? `Fix actions:\n${fixLines}` : '',
        ].filter(Boolean).join('\n\n');
        const preflightCheckpointRecovery = diagnoseComputerTaskCheckpointFailure({
          task: trimmed,
          failureMessage: preflightFailureMessage,
          outcomeStatus: 'blocked',
          executionKind: 'run_computer_task',
          source: 'computer_preflight',
          groundingSummary: groundingState?.summary || null,
          preflightSummary: execution.preflight.summary,
          complexityPlan: execution.complexityPlan,
        });
        await persistComputerTaskState({
          task: trimmed,
          taskKind: execution.preview.kind,
          taskLabel: execution.preview.label,
          phase: 'blocked',
          adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
          grantedAccess: execution.grants.granted,
          accessPlan: execution.grants.summary,
          blockers: [...preflightBlockers, ...groundingBlockers].slice(0, 6),
          nextSteps: execution.preflight.fixActions.length > 0
            ? execution.preflight.fixActions.slice(0, 4)
            : [...groundingNextSteps, ...complexityNextSteps].slice(0, 5),
          grounding: groundingState,
          capabilityBuildout: options?.readyCapabilityBuildout
            ? {
                ...options.readyCapabilityBuildout,
                autoRetryStatus: 'failed',
                autoRetryCompletedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : null,
          complexity: compactComputerTaskComplexityPlan(execution.complexityPlan),
          checkpointRecovery: preflightCheckpointRecovery,
          checkpointRecoveryIsNew: true,
          checkpointRecoveryObservations: execution.computerAppGroundingTrace?.observations || [],
        });
        recordSessionArchiveEvent({
          kind: 'computer_task',
          summary: `Computer task blocked by preflight: ${trimmed}`,
          touched: Array.from(new Set([...preflightHandoffContext.touched, execution.preview.kind])),
          metadata: {
            handoff: preflightHandoffContext.metadata,
            entrypoint: execution.entrypoint,
            preflight: {
              status: execution.preflight.status,
              summary: execution.preflight.summary,
              strategy: execution.preflight.strategy
                ? {
                    id: execution.preflight.strategy.id,
                    label: execution.preflight.strategy.label,
                  }
                : null,
              blockers: preflightBlockers,
              warnings: preflightWarnings,
              fixActions: execution.preflight.fixActions,
            },
            grounding: groundingState,
            complexityPlan: execution.complexityPlan,
            checkpointRecovery: preflightCheckpointRecovery,
          },
        });
        const recovery = await startTaskFailureRecovery({
          failureMessage: preflightFailureMessage,
          outcomeStatus: 'blocked',
          executionKind: 'run_computer_task',
          preflightSummary: execution.preflight.summary,
          groundingSummary: groundingState?.summary || null,
          source: 'computer_preflight',
          checkpointRecovery: preflightCheckpointRecovery,
          appRouteDecision: computerAppRouteDecision,
        });
        const recoveryBlock = recovery.message;
        addBotMessage([
          `**Use Computer** blocked by preflight.`,
          execution.preflight.summary,
          preflightHandoffBlock,
          blockerLines ? `Blockers:\n${blockerLines}` : '',
          fixLines ? `Fix:\n${fixLines}` : '',
          recoveryBlock,
        ].filter(Boolean).join('\n\n'), undefined, {
          recoveryOptions: recovery.recoveryOptions,
          recoveryReliability: recovery.recoveryReliability,
          computerHandoff: preflightHandoffContext.metadata,
          computerPreflightBlockers: execution.preflight.blockers.length > 0
            ? { task: trimmed, items: execution.preflight.blockers }
            : undefined,
          source: {
            actor: 'OpenSwan',
            surface: 'main_chat_computer_task',
            selectedModel,
            effectiveModel: computerTaskModel || null,
          },
        });
        return { handled: true as const, browser: false as const };
      }

      const outcome = await dispatchChatAutomationPlan(computerPlan, {
        ctx: {
          circleId,
          userId: currentUserId || 'anonymous',
          threadId: activeThreadId || undefined,
          model: computerTaskModel || null,
          chatMode: planActMode,
          extras: {
            audit,
          },
        },
        handlers: {
          run_computer_task: async () => {
            if (execution.entrypoint === 'browser_runtime') {
              // P57: browser-lane parity for the P54 model-driven one-shot
              // clarifier (the app/file/hybrid lane gets it inside
              // executeComputerTaskWithAgent; this lane bypasses that
              // runtime). Fail-open by contract — null means proceed.
              try {
                const { runComputerTaskClarifierCheck } = await import('../../../lib/computerTaskRuntime');
                const clarification = await runComputerTaskClarifierCheck({
                  task: trimmed,
                  circleId,
                  userId: currentUserId || 'anonymous',
                  executionSummary: `browser · ${execution.preview.label}`,
                  // Parity with the app lane's call inside
                  // executeComputerTaskWithAgent: without the conversation
                  // tail / attachment / resolved-app context, this lane
                  // re-asks questions the user already answered in chat.
                  appResolutionName: computerPlan.computerRequestRoute?.appResolution?.best?.displayName || null,
                  hasAttachments: attachments.length > 0,
                  chatHistoryTail: [
                    messages.slice(-10).map((m) => `${m.isBot ? agentName : (m.userName || 'User')}: ${m.content}`).join('\n'),
                    buildTaskLaunchContextSuffix(messages),
                  ].filter(Boolean).join('\n').slice(-1500),
                  isLaunchOnly: false,
                });
                if (clarification) {
                  return {
                    executionKind: 'run_computer_task',
                    status: 'needs_input',
                    message: clarification.message,
                    data: {
                      adapterId: 'browser_adapter',
                      clarification: {
                        questions: clarification.questions,
                        assumptions: clarification.assumptions,
                      },
                    },
                  };
                }
              } catch { /* fail-open — proceed to planning */ }
              const plan = await describeComputerUsePlan({
                task: trimmed,
                circleId,
                agentName,
                userId: currentUserId || undefined,
                // P9: text-only planning may use the app-trained planner;
                // the screen loop keeps its Sonnet pin downstream.
                model: computerTaskPlannerModel,
                planningContext: execution.dispatchPrefix,
                computerAppPreflight: execution.preflight,
                computerAppGroundingTrace: execution.computerAppGroundingTrace,
              });
              const planCard = toBrowserPlanCardData(plan);
              return {
                executionKind: 'run_computer_task',
                status: 'completed',
                message: 'Browser-backed computer task planned and ready for approval.',
                data: {
                  adapterId: 'browser_adapter',
                  taskKind: execution.preview.kind,
                  taskLabel: execution.preview.label,
                  readinessSummary: execution.readiness.summary,
                  recommendedMode: execution.recommendedMode,
                  capabilityProfile: execution.capabilityProfile,
                  preflightSummary: execution.preflight.summary,
                  preflightStatus: execution.preflight.status,
                  preflightStrategy: execution.preflight.strategy
                    ? {
                        id: execution.preflight.strategy.id,
                        label: execution.preflight.strategy.label,
                      }
                    : null,
                  preflightBlockers,
                  preflightWarnings,
                  preflightFixActions: execution.preflight.fixActions,
                  appAutomationRouteDecision: computerAppRouteDecision,
                  groundingStatus: execution.computerAppGroundingTrace?.status || null,
                  groundingSummary: execution.computerAppGroundingTrace?.display.summary || null,
                  groundingNextAction: execution.computerAppGroundingTrace?.display.nextAction || null,
                  groundingTrace: execution.computerAppGroundingTrace || null,
                  complexityPlan: execution.complexityPlan,
                  grantSummary: execution.grants.summary,
                  approvalSummary: execution.grants.approvalSummary,
                  grantIds: execution.grants.outstanding.map((grant) => grant.id),
                  businessModel: businessModelPlan.selectedProfile
                    ? {
                        label: businessModelPlan.selectedProfile.label,
                        provider: businessModelPlan.routeProvider,
                        model: businessModelPlan.routeModel,
                        approvalRequired: businessModelPlan.approvalRequired,
                      }
                    : null,
                  browserPlan: planCard,
                  browserActions: plan.actions,
                },
              };
            }

            if (computerStickyScopeApplied?.scopeId) {
              // T7 sticky allow scopes: this branch actually executes (it is
              // not a preview), so record the standing-grant use
              // fire-and-forget for the Permissions panel use count.
              void import('../../../lib/computerGrantGateStore')
                .then(({ recordStickyAllowScopeUse }) => recordStickyAllowScopeUse([computerStickyScopeApplied.scopeId]))
                .catch(() => {});
            }
            const shouldRunDirectImageConversion = Boolean(
              computerPlan.computerRequestRoute?.actionItems?.some((item) => item.tool === 'desktop.convert_image'),
            );
            if (shouldRunDirectImageConversion) {
              const bridge = await import('../../../lib/desktopBridge');
              const directConversion = await executeDirectImageConversionRequest(trimmed, bridge);
              if (!directConversion.handled) {
                return {
                  executionKind: 'run_computer_task',
                  status: 'failed',
                  message: 'I could not resolve the source image name and target format for desktop.convert_image, so I did not mark this image export done.',
                  warnings: ['desktop.convert_image request parsing failed'],
                  runId: null,
                  data: {
                    adapterId: 'file_adapter',
                    taskKind: execution.preview.kind,
                    taskLabel: execution.preview.label,
                    readinessSummary: execution.readiness.summary,
                    recommendedMode: execution.recommendedMode,
                    capabilityProfile: execution.capabilityProfile,
                    preflightSummary: execution.preflight.summary,
                    preflightStatus: execution.preflight.status,
                    preflightStrategy: execution.preflight.strategy
                      ? {
                          id: execution.preflight.strategy.id,
                          label: execution.preflight.strategy.label,
                        }
                      : null,
                    preflightBlockers,
                    preflightWarnings,
                    preflightFixActions: execution.preflight.fixActions,
                    appAutomationRouteDecision: computerAppRouteDecision,
                    groundingStatus: execution.computerAppGroundingTrace?.status || null,
                    groundingSummary: execution.computerAppGroundingTrace?.display.summary || null,
                    groundingNextAction: execution.computerAppGroundingTrace?.display.nextAction || null,
                    groundingTrace: execution.computerAppGroundingTrace || null,
                    complexityPlan: execution.complexityPlan,
                    grantSummary: execution.grants.summary,
                    approvalSummary: execution.grants.approvalSummary,
                    grantIds: execution.grants.outstanding.map((grant) => grant.id),
                  },
                };
              }

              return {
                executionKind: 'run_computer_task',
                status: directConversion.status,
                message: directConversion.message,
                warnings: directConversion.warnings,
                runId: null,
                data: {
                  adapterId: 'file_adapter',
                  taskKind: execution.preview.kind,
                  taskLabel: execution.preview.label,
                  readinessSummary: execution.readiness.summary,
                  recommendedMode: execution.recommendedMode,
                  capabilityProfile: execution.capabilityProfile,
                  preflightSummary: execution.preflight.summary,
                  preflightStatus: execution.preflight.status,
                  preflightStrategy: execution.preflight.strategy
                    ? {
                        id: execution.preflight.strategy.id,
                        label: execution.preflight.strategy.label,
                      }
                    : null,
                  preflightBlockers,
                  preflightWarnings,
                  preflightFixActions: execution.preflight.fixActions,
                  appAutomationRouteDecision: computerAppRouteDecision,
                  groundingStatus: execution.computerAppGroundingTrace?.status || null,
                  groundingSummary: execution.computerAppGroundingTrace?.display.summary || null,
                  groundingNextAction: execution.computerAppGroundingTrace?.display.nextAction || null,
                  groundingTrace: execution.computerAppGroundingTrace || null,
                  complexityPlan: execution.complexityPlan,
                  grantSummary: execution.grants.summary,
                  approvalSummary: execution.grants.approvalSummary,
                  grantIds: execution.grants.outstanding.map((grant) => grant.id),
                  directImageConversion: directConversion.data || null,
                },
              };
            }
            if (routeHasDirectLocalFileActionItems(computerPlan.computerRequestRoute)) {
              const directFileAction = await executeDirectLocalFileRequest(trimmed);
              if (!directFileAction.handled) {
                return {
                  executionKind: 'run_computer_task',
                  status: 'failed',
                  message: 'I could not resolve the exact local-file action for the requested desktop file task, so I did not mark it done.',
                  warnings: ['direct local-file request parsing failed'],
                  runId: null,
                  data: {
                    adapterId: 'file_adapter',
                    taskKind: execution.preview.kind,
                    taskLabel: execution.preview.label,
                    readinessSummary: execution.readiness.summary,
                    recommendedMode: execution.recommendedMode,
                    capabilityProfile: execution.capabilityProfile,
                    preflightSummary: execution.preflight.summary,
                    preflightStatus: execution.preflight.status,
                    preflightStrategy: execution.preflight.strategy
                      ? {
                          id: execution.preflight.strategy.id,
                          label: execution.preflight.strategy.label,
                        }
                      : null,
                    preflightBlockers,
                    preflightWarnings,
                    preflightFixActions: execution.preflight.fixActions,
                    appAutomationRouteDecision: computerAppRouteDecision,
                    groundingStatus: execution.computerAppGroundingTrace?.status || null,
                    groundingSummary: execution.computerAppGroundingTrace?.display.summary || null,
                    groundingNextAction: execution.computerAppGroundingTrace?.display.nextAction || null,
                    groundingTrace: execution.computerAppGroundingTrace || null,
                    complexityPlan: execution.complexityPlan,
                    grantSummary: execution.grants.summary,
                    approvalSummary: execution.grants.approvalSummary,
                    grantIds: execution.grants.outstanding.map((grant) => grant.id),
                  },
                };
              }

              return {
                executionKind: 'run_computer_task',
                status: directFileAction.status,
                message: directFileAction.message,
                warnings: directFileAction.warnings,
                runId: null,
                data: {
                  adapterId: 'file_adapter',
                  taskKind: execution.preview.kind,
                  taskLabel: execution.preview.label,
                  readinessSummary: execution.readiness.summary,
                  recommendedMode: execution.recommendedMode,
                  capabilityProfile: execution.capabilityProfile,
                  preflightSummary: execution.preflight.summary,
                  preflightStatus: execution.preflight.status,
                  preflightStrategy: execution.preflight.strategy
                    ? {
                        id: execution.preflight.strategy.id,
                        label: execution.preflight.strategy.label,
                      }
                    : null,
                  preflightBlockers,
                  preflightWarnings,
                  preflightFixActions: execution.preflight.fixActions,
                  appAutomationRouteDecision: computerAppRouteDecision,
                  groundingStatus: execution.computerAppGroundingTrace?.status || null,
                  groundingSummary: execution.computerAppGroundingTrace?.display.summary || null,
                  groundingNextAction: execution.computerAppGroundingTrace?.display.nextAction || null,
                  groundingTrace: execution.computerAppGroundingTrace || null,
                  complexityPlan: execution.complexityPlan,
                  grantSummary: execution.grants.summary,
                  approvalSummary: execution.grants.approvalSummary,
                  grantIds: execution.grants.outstanding.map((grant) => grant.id),
                  directLocalFileAction: directFileAction.data || null,
                },
              };
            }
            const result = await executeComputerTaskWithAgent({
              task: trimmed,
              circleId,
              userId: currentUserId || 'anonymous',
              userName: currentUserName,
              model: computerTaskModel,
              audit,
              grantedIds,
              businessModelPlan,
              chatHistory: [
                messages.slice(-10).map((m) => `${m.isBot ? agentName : (m.userName || 'User')}: ${m.content}`).join('\n'),
                buildTaskLaunchContextSuffix(messages),
              ].filter(Boolean).join('\n'),
              sessionArchiveContext: await loadSessionArchiveContext() || undefined,
              replyTo: replyTo?.content,
              readyCapabilityBuildout: options?.readyCapabilityBuildout || null,
              disableCapabilityBuildout: Boolean(options?.readyCapabilityBuildout),
              // Wave-2 app choice: thread the route's resolution so the
              // dispatch block carries the App-choice contract (open the
              // chosen app first, verify frontmost, one named fallback).
              appResolution: computerPlan.computerRequestRoute?.appResolution ?? null,
            });
            // L0 escalation breadcrumbs: persist runtime surface escalations onto the durable record fire-and-forget (console/Office cards consume them).
            if (result.surfaceEscalations?.length) void import('../../../lib/computerTaskState').then((m) => m.recordComputerTaskSurfaceEscalations(circleId, activeThreadId, result.surfaceEscalations)).catch(() => {});
            // P62: a clarification is a QUESTION, not a completed task — the
            // runtime early-returned before executing anything. Surface it as
            // needs_input so the outcome pipeline's clarification seam below
            // renders the questions verbatim and parks the task for resume
            // (a 'completed' status here used to archive "Computer task
            // completed" for a task that never ran, and image tasks had the
            // questions replaced by fabricated proof-failure copy).
            if (result.clarification) {
              return {
                executionKind: 'run_computer_task',
                status: 'needs_input',
                message: result.response,
                data: {
                  adapterId: result.adapterId,
                  clarification: result.clarification,
                },
              };
            }
            const completedAutoRetryBuildout = options?.readyCapabilityBuildout
              ? {
                  ...(result.capabilityBuildout || options.readyCapabilityBuildout),
                  autoRetryStatus: 'completed' as const,
                  autoRetryCompletedAt: new Date().toISOString(),
                  autoRetryRunId: result.runId || options.readyCapabilityBuildout.autoRetryRunId || null,
                  updatedAt: new Date().toISOString(),
                }
              : null;

            return {
              executionKind: 'run_computer_task',
              status: 'completed',
              message: result.response,
              warnings: result.warnings,
              runId: result.runId || null,
              data: {
                adapterId: result.adapterId,
                taskKind: result.execution.preview.kind,
                taskLabel: result.execution.preview.label,
                readinessSummary: result.execution.readiness.summary,
                recommendedMode: result.execution.recommendedMode,
                capabilityProfile: result.execution.capabilityProfile,
                preflightSummary: result.execution.preflight.summary,
                preflightStatus: result.execution.preflight.status,
                preflightStrategy: result.execution.preflight.strategy
                  ? {
                      id: result.execution.preflight.strategy.id,
                      label: result.execution.preflight.strategy.label,
                    }
                  : null,
                preflightBlockers: result.execution.preflight.blockers.map((item) => `${item.label}: ${item.fix}`),
                preflightWarnings: result.execution.preflight.warnings.map((item) => `${item.label}: ${item.fix}`),
                preflightFixActions: result.execution.preflight.fixActions,
                appAutomationRouteDecision: result.execution.preflight.routeDecision || computerAppRouteDecision,
                groundingStatus: result.execution.computerAppGroundingTrace?.status || null,
                groundingSummary: result.execution.computerAppGroundingTrace?.display.summary || null,
                groundingNextAction: result.execution.computerAppGroundingTrace?.display.nextAction || null,
                groundingTrace: result.execution.computerAppGroundingTrace || null,
                complexityPlan: result.execution.complexityPlan,
                grantSummary: result.execution.grants.summary,
                approvalSummary: result.execution.grants.approvalSummary,
                grantIds: result.execution.grants.outstanding.map((grant) => grant.id),
                handoffSuggestion: result.handoffSuggestion || null,
                capabilityBuildout: completedAutoRetryBuildout || result.capabilityBuildout || null,
              },
            };
          },
        },
        onOutcome: attachPlanDecisionToRun,
      });

      const prefix = '';
      const grantSummary = typeof outcome.data?.grantSummary === 'string' ? outcome.data.grantSummary : '';
      const approvalSummary = typeof outcome.data?.approvalSummary === 'string' ? outcome.data.approvalSummary : '';
      const grantIds = Array.isArray(outcome.data?.grantIds)
        ? outcome.data.grantIds as Array<'browser_navigation' | 'browser_side_effect' | 'file_read' | 'file_write' | 'app_read' | 'app_action' | 'mcp_tool' | 'bridge_tool'>
        : [];
      const outcomePreflightBlockers = Array.isArray(outcome.data?.preflightBlockers)
        ? (outcome.data.preflightBlockers as unknown[]).map(String).filter(Boolean)
        : [];
      const outcomePreflightWarnings = Array.isArray(outcome.data?.preflightWarnings)
        ? (outcome.data.preflightWarnings as unknown[]).map(String).filter(Boolean)
        : [];
      const outcomePreflightFixActions = Array.isArray(outcome.data?.preflightFixActions)
        ? (outcome.data.preflightFixActions as unknown[]).map(String).filter(Boolean)
        : [];
      const rawOutcomeWarnings = Array.isArray(outcome.warnings)
        ? Array.from(new Set((outcome.warnings as unknown[]).map(String).filter(Boolean)))
        : [];
      const outcomeWarnings = rawOutcomeWarnings.filter((warning) => (
        !isQuietSuccessfulComputerTaskWarning(warning)
        && !isSupportOnlyComputerTaskWarning(warning)
      ));
      const visibleOutcomeMessage = sanitizeVisibleComputerTaskMessage(outcome.message, outcome.status);
      const browserPlan = outcome.data?.browserPlan as BrowserPlanCardData | undefined;
      const browserActions = outcome.data?.browserActions as BrowserAction[] | undefined;
      const handoff = outcome.data?.handoffSuggestion as HandoffSuggestion | undefined;
      const capabilityBuildout = outcome.data?.capabilityBuildout as ComputerTaskCapabilityBuildout | null | undefined;
      const capabilityBuildoutHints = buildAgentAppCapabilityBuildoutStateHints({
        status: capabilityBuildout?.status,
        message: capabilityBuildout?.message,
        retryPlan: capabilityBuildout?.retryPlan,
        userActionNeeded: capabilityBuildout?.userActionNeeded,
        missingEvidence: capabilityBuildout?.missingEvidence,
      });
      const adapterId = typeof outcome.data?.adapterId === 'string' ? outcome.data.adapterId : null;
      const computerTaskSource: ChatMessageSource = {
        actor: 'OpenSwan',
        surface: 'main_chat_computer_task',
        selectedModel,
        effectiveModel: adapterId === 'file_adapter'
          ? 'computer-file-adapter'
          : (computerTaskModel || null),
      };
      // ── P62: clarification seam ─────────────────────────────────────────
      // A needs_input outcome carrying clarifier questions is a CONVERSATION
      // turn, not a task outcome. Render the questions VERBATIM (the
      // sanitize/compaction pipeline below can replace them with credential-
      // failure or bridge copy), park the original task so the user's next
      // reply resumes it with the answers folded in (the existing
      // pendingClarificationRef seam — same resume path as ask_clarification),
      // clear any planning-phase task card, and skip every completion/failure
      // surface: no archive line, no failure recovery, no blocked/completed
      // state.
      const outcomeClarification = outcome.status === 'needs_input'
        && outcome.data && typeof outcome.data === 'object'
        ? (outcome.data as { clarification?: { questions?: unknown[]; assumptions?: unknown[] } }).clarification
        : null;
      if (outcomeClarification && typeof outcome.message === 'string' && outcome.message.trim()) {
        const clarifyKey = activeThreadId || 'main';
        pendingClarificationRef.current.set(clarifyKey, {
          originalMessage: trimmed,
          pendingIntent: null, // default fold-in: `${original} — ${answer}`
          missingParams: Array.isArray(outcomeClarification.questions)
            ? outcomeClarification.questions.map(String).slice(0, 3)
            : [],
          askedAt: Date.now(),
        });
        persistPendingClarifications();
        setAttentionTick((tick) => tick + 1);
        setComputerTaskState(null);
        await clearComputerTaskState(circleId, activeThreadId).catch(() => {});
        addBotMessage(outcome.message, undefined, {
          source: computerTaskSource,
          quickReplies: ['Proceed'],
        });
        return { handled: true as const, browser: false };
      }
      const outcomeGroundingTrace = outcome.data?.groundingTrace as any;
      const outcomeGroundingState: ComputerTaskStateGrounding | null = outcomeGroundingTrace?.display
        ? {
            status: String(outcomeGroundingTrace.status || ''),
            strategyId: outcomeGroundingTrace.strategyId ? String(outcomeGroundingTrace.strategyId) : null,
            strategyLabel: outcomeGroundingTrace.strategyLabel ? String(outcomeGroundingTrace.strategyLabel) : null,
            primarySurface: outcomeGroundingTrace.primarySurface ? String(outcomeGroundingTrace.primarySurface) : null,
            summary: outcomeGroundingTrace.display.summary ? String(outcomeGroundingTrace.display.summary) : null,
            nextAction: outcomeGroundingTrace.display.nextAction ? String(outcomeGroundingTrace.display.nextAction) : null,
            badges: Array.isArray(outcomeGroundingTrace.display.badges) ? outcomeGroundingTrace.display.badges.map(String).filter(Boolean) : [],
            blockers: Array.isArray(outcomeGroundingTrace.display.blockers) ? outcomeGroundingTrace.display.blockers.map(String).filter(Boolean) : [],
          }
        : groundingState;
      const outcomeGroundingNextSteps = outcomeGroundingState?.nextAction
        ? [`Grounding next action: ${outcomeGroundingState.nextAction}`]
        : [];
      const outcomeGroundingBlockers = outcomeGroundingState?.blockers || [];
      const outcomeComplexityPlan = (outcome.data?.complexityPlan as any) || execution.complexityPlan;
      const outcomeComplexityNextSteps = outcomeComplexityPlan?.level && outcomeComplexityPlan.level !== 'simple' && Array.isArray(outcomeComplexityPlan.visibleNextSteps)
        ? outcomeComplexityPlan.visibleNextSteps.map(String).filter(Boolean)
        : [];
      const handoffContext = buildChatComputerHandoffContext({
        task: trimmed,
        entrypoint: execution.entrypoint,
        adapterId,
        taskKind: String(outcome.data?.taskKind || execution.preview.kind),
        taskLabel: String(outcome.data?.taskLabel || execution.preview.label),
        capabilityProfile: typeof outcome.data?.capabilityProfile === 'string' ? outcome.data.capabilityProfile : execution.capabilityProfile,
        recommendedMode: typeof outcome.data?.recommendedMode === 'string' ? outcome.data.recommendedMode : execution.recommendedMode,
        grantSummary: grantSummary || execution.grants.summary,
        approvalSummary: approvalSummary || null,
        browserPlanId: browserPlan?.planId || null,
        browserActionCount: Array.isArray(browserActions) ? browserActions.length : null,
        runId: outcome.runId || null,
        preflightStatus: typeof outcome.data?.preflightStatus === 'string' ? outcome.data.preflightStatus : execution.preflight.status,
        preflightSummary: typeof outcome.data?.preflightSummary === 'string' ? outcome.data.preflightSummary : execution.preflight.summary,
        groundingStatus: outcomeGroundingState?.status || null,
        groundingSummary: outcomeGroundingState?.summary || null,
        requestNotice: computerRequestNotice,
        evidenceContract: computerEvidenceContract,
        appAutomationRouteDecision: (outcome.data?.appAutomationRouteDecision as any) || computerAppRouteDecision,
        stickyScopeApplied: computerStickyScopeApplied,
        warnings: outcomeWarnings,
        rawWarnings: rawOutcomeWarnings,
        blockers: [...outcomePreflightBlockers, ...outcomeGroundingBlockers, ...capabilityBuildoutHints.blockers],
      });
      const handoffBlock = formatChatComputerHandoffForMessage(handoffContext);
      let shouldShowPendingHandoff = Boolean(handoff);
      let shouldClearPendingHandoff = false;
      // WI-1: zero-tap auto-start. A plain-web browser route with no login/
      // delete/grant floor and no "ask me first" constraint launches without
      // the permission dialog. The pay/book floor (route.alwaysConfirmFloor may
      // carry 'pay') is a MID-RUN gate enforced by the edge loop, so it does
      // not block the start tap here. WordPress/website-admin credentialed
      // routes and desktop mutations still fail closed to the dialog.
      const autoStartRoute = computerPlan.computerRequestRoute;
      const browserAutoStart = (browserPlan && browserActions && autoStartRoute)
        ? decideBrowserAutoStart({
            routeKind: autoStartRoute.kind,
            entrypoint: execution.entrypoint,
            alwaysConfirmFloor: autoStartRoute.alwaysConfirmFloor ?? null,
            userConstraints: autoStartRoute.userConstraints ?? null,
            websitePlatformAdmin: isCredentialedWebsiteAdminRoute(autoStartRoute.appStrategy ?? null, trimmed),
          })
        : { autoStart: false as const, reason: 'no-browser-plan' };
      if (browserPlan && browserActions && browserAutoStart.autoStart) {
        // Auto-start: run the dialog's onAllow body inline (including the
        // grantComputerTaskScopes / recordStickyAllowScopeUse persistence that
        // otherwise only fires from the dialog) then launch immediately.
        // browserAutoStart.reason is secret-safe — log for audit only.
        console.log('[ChatTab] browser auto-start:', browserAutoStart.reason);
        const autoPermission: ComputerUsePermission = browserPlan.recommendedPermission || 'ask_for_new_sites';
        const autoGrantIdsToPersist = deriveGrantedScopesFromBrowserPermission(autoPermission, grantIds);
        const autoStickyScopeId = computerStickyScopeApplied?.scopeId || null;
        computerUsePostedKeyRef.current = null;
        await persistComputerTaskState({
          task: trimmed,
          taskKind: String(outcome.data?.taskKind || execution.preview.kind),
          taskLabel: String(outcome.data?.taskLabel || execution.preview.label),
          phase: 'executing',
          adapterId: String(outcome.data?.adapterId || 'browser_adapter'),
          grantedAccess: Array.from(new Set([...grantIds, ...autoGrantIdsToPersist])),
          accessPlan: grantSummary || execution.grants.summary,
          nextSteps: ['Run browser task', 'Summarize findings'],
          grounding: outcomeGroundingState,
          complexity: compactComputerTaskComplexityPlan(outcomeComplexityPlan),
        });
        await grantComputerTaskScopes(circleId, autoGrantIdsToPersist).catch(() => {});
        if (autoStickyScopeId) {
          void import('../../../lib/computerGrantGateStore')
            .then(({ recordStickyAllowScopeUse }) => recordStickyAllowScopeUse([autoStickyScopeId]))
            .catch(() => {});
        }
        // WI-1 default backend: with no Browserbase configured the plan runs on
        // the local playwright bridge. computerUseTask.run only drives the cloud
        // (Stagehand) agent, so mirror the manual onAllow path and dispatch the
        // bridge run here; it posts its own launch message.
        if (browserPlan.backend === 'playwright_bridge') {
          await runLocalBrowserPlan(browserPlan, autoPermission, null);
          return { handled: true as const, browser: true, autoStarted: true as const };
        }
        const autoStarted = await computerUseTask.run(trimmed, {
          model: resolveSendModel(trimmed) || undefined,
        });
        if (!autoStarted.started) {
          addBotMessage('**Computer Use** could not start. Check the connection and try again.', undefined, {
            source: computerTaskSource,
          });
        } else {
          // WI-1: the run has already launched, so surface it as launched (not
          // "APPROVAL REQUIRED"). Override on both the posted card and the
          // persisted metadata copy so a reload does not re-show the approval.
          const launchedBrowserPlan = { ...browserPlan, requiresApproval: false, status: 'launched' as const };
          addBotMessage(`Browser run started — live view\n\n${trimmed}`, undefined, {
            runId: outcome.runId || null,
            browserPlans: [launchedBrowserPlan],
            computerHandoff: handoffContext.metadata,
            source: computerTaskSource,
          });
        }
        return { handled: true as const, browser: !!browserPlan, autoStarted: true as const };
      }
      if (browserPlan && browserActions) {
        setPendingComputerUseTask(trimmed);
        setPendingComputerUsePlan(browserPlan);
        setPendingComputerUseActions(browserActions);
        setPendingComputerUseGrantSummary(grantSummary);
        setPendingComputerUseApprovalSummary(approvalSummary);
        setPendingComputerUseGrantIds(grantIds);
        setPendingComputerUseOrigin(null);
        setPendingComputerUseStickyScopeId(computerStickyScopeApplied?.scopeId || null);
        setShowComputerUsePermission(true);
        const showAccessBlock = Boolean(
          approvalSummary
          || outcome.status !== 'completed'
          || outcomeWarnings.length > 0
          || outcomePreflightBlockers.length > 0
          || outcomePreflightWarnings.length > 0
          || outcomeGroundingBlockers.length > 0,
        );
        const accessBlock = grantSummary && showAccessBlock
          ? `\n\n${grantSummary}${approvalSummary ? `\n${approvalSummary}` : ''}`
          : '';
        await persistComputerTaskState({
          task: trimmed,
          taskKind: String(outcome.data?.taskKind || execution.preview.kind),
          taskLabel: String(outcome.data?.taskLabel || execution.preview.label),
          phase: 'awaiting_approval',
          adapterId: String(outcome.data?.adapterId || 'browser_adapter'),
          grantedAccess: execution.grants.granted,
          accessPlan: grantSummary || execution.grants.summary,
          nextSteps: outcomePreflightFixActions.length > 0
            ? outcomePreflightFixActions
            : [...outcomeGroundingNextSteps, ...outcomeComplexityNextSteps, 'Approve the task to start browser execution'].slice(0, 5),
          blockers: [
            ...(approvalSummary ? [approvalSummary] : []),
            ...outcomePreflightBlockers,
            ...outcomePreflightWarnings,
            ...outcomeGroundingBlockers,
          ].slice(0, 6),
          grounding: outcomeGroundingState,
          complexity: compactComputerTaskComplexityPlan(outcomeComplexityPlan),
        });
        recordSessionArchiveEvent({
          kind: 'computer_task',
          summary: `Computer task awaiting approval: ${trimmed}`,
          touched: Array.from(new Set([...handoffContext.touched, 'surface:browser'])),
          metadata: {
            handoff: handoffContext.metadata,
            adapterId: String(outcome.data?.adapterId || 'browser_adapter'),
            grantSummary: grantSummary || execution.grants.summary,
            approvalSummary: approvalSummary || null,
            preflight: {
              status: outcome.data?.preflightStatus || execution.preflight.status,
              summary: outcome.data?.preflightSummary || execution.preflight.summary,
              strategy: outcome.data?.preflightStrategy || null,
              blockers: outcomePreflightBlockers,
              warnings: outcomePreflightWarnings,
              fixActions: outcomePreflightFixActions,
            },
            grounding: outcomeGroundingState,
            complexityPlan: outcomeComplexityPlan,
          },
        });
        addBotMessage(`${prefix}${visibleOutcomeMessage || outcome.message}${handoffBlock}${accessBlock}`, undefined, {
          runId: outcome.runId || null,
          browserPlans: [browserPlan],
          computerHandoff: handoffContext.metadata,
          chatAutomationPlanPreview: outcome.data?.chatAutomationPlanPreview as ChatAutomationPlanPreview | undefined,
          source: computerTaskSource,
        });
      } else {
        const showAccessBlock = Boolean(
          approvalSummary
          || outcome.status !== 'completed'
          || outcomeWarnings.length > 0
          || outcomePreflightBlockers.length > 0
          || outcomePreflightWarnings.length > 0
          || outcomeGroundingBlockers.length > 0,
        );
        const accessBlock = grantSummary && showAccessBlock
          ? `\n\n${grantSummary}${approvalSummary ? `\n${approvalSummary}` : ''}`
          : '';
        const outcomePresentation = buildChatComputerOutcomePresentation({
          task: trimmed,
          outcomeStatus: outcome.status,
          outcomeMessage: outcome.message,
          rawWarnings: rawOutcomeWarnings,
          visibleWarnings: outcomeWarnings,
          preflightBlockers: outcomePreflightBlockers,
          preflightWarnings: outcomePreflightWarnings,
          groundingBlockers: outcomeGroundingBlockers,
          capabilityBlockers: capabilityBuildoutHints.blockers,
          capabilityPhase: capabilityBuildoutHints.phase,
          suppressGenericRecovery: capabilityBuildoutHints.suppressGenericRecovery,
        });
        shouldShowPendingHandoff = Boolean(handoff && !outcomePresentation.hideComputerHandoff);
        shouldClearPendingHandoff = outcomePresentation.hideComputerHandoff;
        const warningBlock = outcomePresentation.warningBlock;
        const blockerList = outcomePresentation.blockerList;
        const shouldRecoverOutcome = outcomePresentation.shouldRecoverOutcome;
        const outcomeFailureMessage = [
          outcome.message,
          blockerList.length ? `Outcome blockers:\n${blockerList.map((blocker) => `- ${blocker}`).join('\n')}` : '',
          outcomeWarnings.length ? `Warnings:\n${outcomeWarnings.map((warning) => `- ${warning}`).join('\n')}` : '',
          outcomePreflightBlockers.length ? `Preflight blockers:\n${outcomePreflightBlockers.map((blocker) => `- ${blocker}`).join('\n')}` : '',
          outcomeGroundingBlockers.length ? `Grounding blockers:\n${outcomeGroundingBlockers.map((blocker) => `- ${blocker}`).join('\n')}` : '',
        ].filter(Boolean).join('\n\n');
        const outcomeCheckpointRecovery = shouldRecoverOutcome
          ? diagnoseComputerTaskCheckpointFailure({
              task: trimmed,
              failureMessage: outcomeFailureMessage,
              outcomeStatus: outcome.status === 'completed' ? 'completed_with_warnings' : outcome.status,
              executionKind: outcome.executionKind,
              source: 'computer_task_outcome',
              planSummary: computerPlan.notes.join('; '),
              groundingSummary: outcomeGroundingState?.summary || null,
              preflightSummary: typeof outcome.data?.preflightSummary === 'string' ? outcome.data.preflightSummary : execution.preflight.summary,
              complexityPlan: outcomeComplexityPlan,
            })
          : null;
        if (outcomePresentation.hideComputerTaskStatus) {
          setComputerTaskState(null);
          await clearComputerTaskState(circleId, activeThreadId).catch(() => {});
        } else {
          await persistComputerTaskState({
            task: trimmed,
            taskKind: String(outcome.data?.taskKind || execution.preview.kind),
            taskLabel: String(outcome.data?.taskLabel || execution.preview.label),
            phase: outcomePresentation.statePhase,
            adapterId,
            runId: outcome.runId || null,
            grantedAccess: execution.grants.granted,
            accessPlan: grantSummary || execution.grants.summary,
            blockers: blockerList,
            nextSteps: capabilityBuildoutHints.nextSteps.length > 0
              ? capabilityBuildoutHints.nextSteps
              : outcomePresentation.nextSteps.length > 0
                ? outcomePresentation.nextSteps
                : handoff && !outcomePresentation.hideComputerHandoff
                  ? [handoff.title]
                  : outcomePreflightFixActions.length > 0
                    ? outcomePreflightFixActions
                    : [...outcomeGroundingNextSteps, ...outcomeComplexityNextSteps].slice(0, 5),
            grounding: outcomeGroundingState,
            capabilityBuildout: capabilityBuildout || null,
            complexity: compactComputerTaskComplexityPlan(outcomeComplexityPlan),
            checkpointRecovery: outcomeCheckpointRecovery,
            checkpointRecoveryIsNew: true,
            checkpointRecoveryObservations: Array.isArray(outcomeGroundingTrace?.observations) ? outcomeGroundingTrace.observations : execution.computerAppGroundingTrace?.observations || [],
          });
        }
        const computerTaskArchiveSummary = capabilityBuildout
          ? capabilityBuildout.status === 'approval_required'
            ? `Computer task awaiting app capability buildout approval: ${trimmed}`
            : capabilityBuildout.status === 'requested'
              ? `Computer task building missing app capability: ${trimmed}`
              : capabilityBuildout.status === 'ready_to_retry'
                ? `Computer task ready to retry after app capability buildout: ${trimmed}`
                : capabilityBuildout.status === 'incomplete'
                  ? `Computer task has incomplete app capability buildout evidence: ${trimmed}`
                : capabilityBuildout.status === 'blocked'
                  ? `Computer task blocked by app capability buildout: ${trimmed}`
                  : `Computer task app capability buildout failed: ${trimmed}`
          : outcomePresentation.statePhase === 'blocked'
            ? `Computer task blocked: ${trimmed}`
            : `Computer task completed without browser runtime: ${trimmed}`;
        recordSessionArchiveEvent({
          kind: 'computer_task',
          summary: computerTaskArchiveSummary,
          touched: handoffContext.touched,
          metadata: {
            handoff: handoffContext.metadata,
            adapterId,
            warnings: outcomeWarnings,
            runId: outcome.runId || null,
            preflight: {
              status: outcome.data?.preflightStatus || execution.preflight.status,
              summary: outcome.data?.preflightSummary || execution.preflight.summary,
              strategy: outcome.data?.preflightStrategy || null,
              blockers: outcomePreflightBlockers,
              warnings: outcomePreflightWarnings,
              fixActions: outcomePreflightFixActions,
            },
            grounding: outcomeGroundingState,
            complexityPlan: outcomeComplexityPlan,
            capabilityBuildout: capabilityBuildout || null,
            checkpointRecovery: outcomeCheckpointRecovery,
          },
        });
        const recovery = shouldRecoverOutcome
          ? await startTaskFailureRecovery({
              failureMessage: outcomeFailureMessage,
              outcomeStatus: outcome.status === 'completed' ? 'completed_with_warnings' : outcome.status,
              executionKind: outcome.executionKind,
              runId: outcome.runId || null,
              planSummary: computerPlan.notes.join('; '),
              groundingSummary: outcomeGroundingState?.summary || null,
              preflightSummary: typeof outcome.data?.preflightSummary === 'string' ? outcome.data.preflightSummary : execution.preflight.summary,
              source: 'computer_task_outcome',
              complexityPlan: outcomeComplexityPlan,
              checkpointRecovery: outcomeCheckpointRecovery,
              appRouteDecision: (outcome.data?.appAutomationRouteDecision as any) || computerAppRouteDecision,
            })
          : null;
        const userVisibleOutcome = outcomePresentation.compactUserMessage
          ? outcomePresentation.compactUserMessage
          : `${prefix}${visibleOutcomeMessage || outcome.message}${handoffBlock}${accessBlock}${warningBlock}${recovery?.message || ''}`;
        addBotMessage(userVisibleOutcome, undefined, {
          runId: outcome.runId || null,
          recoveryOptions: outcomePresentation.hideRecoveryDetails ? undefined : recovery?.recoveryOptions,
          recoveryReliability: outcomePresentation.hideRecoveryDetails ? undefined : recovery?.recoveryReliability,
          computerHandoff: outcomePresentation.hideComputerHandoff ? undefined : handoffContext.metadata,
          chatAutomationPlanPreview: outcome.data?.chatAutomationPlanPreview as ChatAutomationPlanPreview | undefined,
          source: computerTaskSource,
        });
      }

      if (shouldShowPendingHandoff && handoff) {
        setPendingHandoff(handoff);
      } else if (shouldClearPendingHandoff) {
        setPendingHandoff(null);
      }
      return { handled: true as const, browser: !!browserPlan };
    } catch (error: any) {
      const exceptionHandoffContext = buildChatComputerHandoffContext({
        task: trimmed,
        entrypoint: execution.entrypoint,
        adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
        taskKind: execution.preview.kind,
        taskLabel: execution.preview.label,
        capabilityProfile: execution.capabilityProfile,
        recommendedMode: execution.recommendedMode,
        grantSummary: execution.grants.summary,
        approvalSummary: execution.grants.approvalSummary,
        preflightStatus: execution.preflight.status,
        preflightSummary: execution.preflight.summary,
        groundingStatus: groundingState?.status || null,
        groundingSummary: groundingState?.summary || null,
        requestNotice: computerRequestNotice,
        evidenceContract: computerEvidenceContract,
        appAutomationRouteDecision: computerAppRouteDecision,
        blockers: [error?.message || 'Unknown error'],
      });
      const exceptionCheckpointRecovery = diagnoseComputerTaskCheckpointFailure({
        task: trimmed,
        failureMessage: error?.message || 'Unknown error',
        outcomeStatus: 'failed',
        executionKind: 'run_computer_task',
        source: 'computer_task_exception',
        preflightSummary: execution.preflight.summary,
        groundingSummary: groundingState?.summary || null,
        complexityPlan: execution.complexityPlan,
      });
      await persistComputerTaskState({
        task: trimmed,
        taskKind: execution.preview.kind,
        taskLabel: execution.preview.label,
        phase: 'failed',
        adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
        grantedAccess: execution.grants.granted,
        accessPlan: execution.grants.summary,
        blockers: [error?.message || 'Unknown error'],
        grounding: groundingState,
        capabilityBuildout: options?.readyCapabilityBuildout
          ? {
              ...options.readyCapabilityBuildout,
              autoRetryStatus: 'failed',
              autoRetryCompletedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null,
        complexity: compactComputerTaskComplexityPlan(execution.complexityPlan),
        checkpointRecovery: exceptionCheckpointRecovery,
        checkpointRecoveryIsNew: true,
        checkpointRecoveryObservations: execution.computerAppGroundingTrace?.observations || [],
      });
      recordSessionArchiveError(
        `Use Computer failed: ${error?.message || 'Unknown error'}`,
        typeof error?.stack === 'string' ? error.stack : null,
        exceptionHandoffContext.touched,
      );
      const recovery = await startTaskFailureRecovery({
        failureMessage: error?.message || 'Unknown error',
        failureStack: typeof error?.stack === 'string' ? error.stack : null,
        outcomeStatus: 'failed',
        executionKind: 'run_computer_task',
        preflightSummary: execution.preflight.summary,
        groundingSummary: groundingState?.summary || null,
        source: 'computer_task_exception',
        checkpointRecovery: exceptionCheckpointRecovery,
        appRouteDecision: computerAppRouteDecision,
      });
      addBotMessage(appendCustomerSafeRecoveryMessage(
        '**Use Computer** could not complete that task. Technical details were saved for recovery.',
        recovery.message,
      ), undefined, {
        recoveryOptions: recovery.recoveryOptions,
        recoveryReliability: recovery.recoveryReliability,
        computerHandoff: exceptionHandoffContext.metadata,
        source: {
          actor: 'OpenSwan',
          surface: 'main_chat_computer_task',
          selectedModel,
          effectiveModel: computerTaskModel || null,
        },
      });
      return { handled: true as const, browser: false as const };
    } finally {
      setRunStatus('idle');
      setBotTyping(false);
    }
  }, [
    activeThreadId,
    agentName,
    chatMode,
    circleId,
    currentUserId,
    currentUserName,
    hydrateAppResolutionContext,
    loadSessionArchiveContext,
    messages,
    planActMode,
    recordSessionArchiveError,
    recordSessionArchiveEvent,
    replyTo,
    selectedModel,
    persistComputerTaskState,
    startMainChatFailureRecoveryPayload,
  ]);

  // Called by the console when the user submits a drafted task. Kicks off
  // plan generation; on completion we transfer to ComputerUsePermissionDialog
  // (below) which in turn hands the task to `useComputerUseTask`.
  const runComputerUseTaskFromConsole = useCallback(async (taskText: string) => {
    const trimmed = taskText.trim();
    if (!trimmed) return;
    setShowComputerUseConsole(false);
    const shared = await executeSharedComputerTask(trimmed, { planPrefix: 'Use computer: ' });
    if (shared?.handled) return;
  }, [agentName, circleId, executeSharedComputerTask]);
  const [selectedBrowserSession, setSelectedBrowserSession] = useState<BrowserSessionRecord | null>(null);
  const [showMemoryViewer, setShowMemoryViewer] = useState(false);
  const [showPluginPicker, setShowPluginPicker] = useState(false);
  const [activePlugins, setActivePlugins] = useState<string[]>([]);
  const [showRunHistory, setShowRunHistory] = useState(false);
  const [retryingLedgerCheck, setRetryingLedgerCheck] = useState<{ messageId: string; checkId: string } | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'delegated' | 'waiting_approval'>('idle');
  // Drives the rotating "is noodling / is pondering / is cooking …"
  // verbs in the typing indicator. Ticks only while the bot is
  // actually typing so the interval doesn't run forever in the
  // background. Resets to 0 on each new thinking session so the user
  // always sees the full rotation from the start.
  const [thinkingVerbIndex, setThinkingVerbIndex] = useState(0);
  useEffect(() => {
    if (!botTyping || runStatus !== 'idle') {
      setThinkingVerbIndex(0);
      return;
    }
    const t = setInterval(() => setThinkingVerbIndex((i) => i + 1), 1500);
    return () => clearInterval(t);
  }, [botTyping, runStatus]);
  const [activeSubagent, setActiveSubagent] = useState<{ name: string; icon: string; color: string } | null>(null);
  const [activeDelegatedSubagents, setActiveDelegatedSubagents] = useState<OpenSwanDelegatedAgentDescriptor[]>([]);
  const [currentRunStep, setCurrentRunStep] = useState<string>('');
  const [memoryToast, setMemoryToast] = useState<{ message: string; type: 'saved' | 'updated' | 'conflict' | 'forgotten' } | null>(null);
  // User behavior profile
  const profileRef = useRef<UserChatProfile | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const codingWorkbenchStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const builderDragContainerRef = useRef<HTMLDivElement | null>(null);
  const builderDraggingRef = useRef(false);
  const quickScrollRef = useRef<ScrollView>(null);
  const quickScrollX = useRef(0);
  const welcomeAnim = useRef(new Animated.Value(0)).current;
  const newMessageAnims = useRef<Map<string, Animated.Value>>(new Map()).current;
  const sendLockRef = useRef(false);
  // Open clarifying questions, keyed by thread. When the planner asks for a
  // missing detail we stash the original intent here; the user's next reply is
  // then reconstructed into a well-specified request and routed to completion.
  const pendingClarificationRef = useRef<Map<string, {
    originalMessage: string;
    pendingIntent: string | null;
    missingParams: string[];
    askedAt: number;
  }>>(new Map());
  // Plan §1c: parked clarifications survive reload. Bounded localStorage
  // mirror of the ref — hydrated once per circle, pruned to the same
  // 15-minute freshness window the resume path enforces, so "Waiting on
  // you: task title" reappears in the attention strip after a refresh
  // instead of the request dying silently.
  const clarificationStorageKey = circleId ? `uc_pending_clarifications::${circleId}` : null;
  const persistPendingClarifications = useCallback(() => {
    if (!clarificationStorageKey || typeof localStorage === 'undefined') return;
    try {
      const entries = [...pendingClarificationRef.current.entries()]
        .filter(([, value]) => Date.now() - value.askedAt < 15 * 60 * 1000)
        .slice(-5);
      if (entries.length === 0) localStorage.removeItem(clarificationStorageKey);
      else localStorage.setItem(clarificationStorageKey, JSON.stringify(Object.fromEntries(entries)));
    } catch { /* quota — clarification parking is best-effort */ }
  }, [clarificationStorageKey]);
  useEffect(() => {
    if (!clarificationStorageKey || typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(clarificationStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, {
        originalMessage: string;
        pendingIntent: string | null;
        missingParams: string[];
        askedAt: number;
      }>;
      let hydrated = false;
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value.askedAt !== 'number') continue;
        if (Date.now() - value.askedAt >= 15 * 60 * 1000) continue;
        if (!pendingClarificationRef.current.has(key)) {
          pendingClarificationRef.current.set(key, value);
          hydrated = true;
        }
      }
      if (hydrated) setAttentionTick((tick) => tick + 1);
    } catch { /* corrupt state — start clean */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clarificationStorageKey]);
  // Guards against re-asking while we're resolving a clarification answer.
  const resolvingClarificationRef = useRef(false);
  const scrollOffsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const layoutHeightRef = useRef(0);
  const pendingRestoreOffsetRef = useRef<number | null>(null);
  const hasAppliedInitialScrollRef = useRef(false);
  const wasNearBottomRef = useRef(true);
  const globalDragDepthRef = useRef(0);
  const latestBuildArtifact = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const artifacts = message.artifacts || [];
      const candidate = artifacts.find((artifact) => artifact.kind === 'webpage' || artifact.kind === 'code');
      if (candidate) return candidate;
    }
    return null;
  }, [messages]);
  // revertedArtifact wins over latest so "view an earlier build" sticks
  // until the user triggers a new one (which clears the revert via the effect
  // that watches latestBuildArtifact and resets revertedArtifact).
  const effectiveBuildArtifact = revertedArtifact || latestBuildArtifact || cachedBuildArtifact;
  const hasBuilderWork = !!codingWorkbenchPrompt || !!effectiveBuildArtifact;
  const canOpenBuilder = hasBuilderWork || builderRevisions.length > 0;
  const activeSpirit = useMemo(() => (activeSpiritId ? getSpiritById(activeSpiritId) : null), [activeSpiritId]);
  // Sidecar shows on any reasonably sized web viewport with an artifact.
  // Lowered from 1180 → 900 so tablet / narrow-desktop still get the pane.
  const showWorkbenchSidecar = Platform.OS === 'web' && viewportWidth >= 900 && !buildStudioDismissed && (!!codingWorkbenchPrompt || !!effectiveBuildArtifact);
  // When there's a saved artifact but the sidecar isn't visible (dismissed
  // OR the viewport is too narrow), surface a pill that brings it back.
  const showReopenBuilderPill = !!effectiveBuildArtifact && !showWorkbenchSidecar && Platform.OS === 'web';

  const resolveBuilderArtifact = useCallback((): SwanBotStructuredArtifact | null => {
    return effectiveBuildArtifact || builderRevisions[0]?.artifact || null;
  }, [builderRevisions, effectiveBuildArtifact]);

  const openBuilderStudio = useCallback(() => {
    const artifactToOpen = resolveBuilderArtifact();
    if (artifactToOpen) {
      setRevertedArtifact(artifactToOpen);
      setCachedBuildArtifact(artifactToOpen);
      if (activeThreadId) {
        void saveLastThreadBuildArtifact(activeThreadId, artifactToOpen);
      }
      setBuildStudioView(artifactToOpen.kind === 'webpage' ? 'preview' : 'code');
    } else {
      setBuildStudioView('code');
    }

    if (Platform.OS === 'web' && viewportWidth >= 900) {
      setBuildStudioDismissed(false);
      setBuilderModalOpen(false);
      return;
    }

    setBuilderModalOpen(true);
  }, [activeThreadId, codingWorkbenchPrompt, resolveBuilderArtifact, viewportWidth]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleMouseMove = (event: MouseEvent) => {
      if (!builderDraggingRef.current || !builderDragContainerRef.current) return;
      const rect = builderDragContainerRef.current.getBoundingClientRect();
      if (!rect.width) return;
      const nextPercent = ((rect.right - event.clientX) / rect.width) * 100;
      const clamped = Math.max(28, Math.min(72, nextPercent));
      setBuilderPaneWidth(clamped);
    };

    const handleMouseUp = () => {
      builderDraggingRef.current = false;
      try {
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      } catch {}
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const addDroppedFiles = useCallback((files: File[]) => {
    if (!circleId || !currentUserId || files.length === 0) return;
    setStagedFiles((prev) => {
      const remaining = Math.max(0, 10 - prev.length);
      if (remaining <= 0) return prev;
      const toAdd = files.slice(0, remaining).map(createStagedFile);

      for (const sf of toAdd) {
        void (async () => {
          setStagedFiles((current) => current.map((entry) => entry.id === sf.id ? { ...entry, uploading: true } : entry));
          try {
            const attachment = await uploadAttachment({
              file: sf.file,
              circleId,
              threadId: activeThreadId,
              userId: currentUserId,
            });
            setStagedFiles((current) => current.map((entry) => entry.id === sf.id ? { ...entry, uploading: false, attachment } : entry));
          } catch (error: any) {
            setStagedFiles((current) => current.map((entry) => entry.id === sf.id ? { ...entry, uploading: false, error: error?.message || 'Upload failed' } : entry));
          }
        })();
      }

      return [...prev, ...toAdd];
    });
  }, [activeThreadId, circleId, currentUserId]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const hasFilePayload = (event: DragEvent) => {
      const types = Array.from(event.dataTransfer?.types || []);
      return types.includes('Files');
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      globalDragDepthRef.current += 1;
      setGlobalFileDragActive(true);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      if (!globalFileDragActive) setGlobalFileDragActive(true);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      globalDragDepthRef.current = Math.max(0, globalDragDepthRef.current - 1);
      if (globalDragDepthRef.current === 0) {
        setGlobalFileDragActive(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!hasFilePayload(event)) return;
      event.preventDefault();
      globalDragDepthRef.current = 0;
      setGlobalFileDragActive(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0) addDroppedFiles(files);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [addDroppedFiles, globalFileDragActive]);

  // P20 — paste-an-image: Cmd+V a screenshot/copied image anywhere in the chat
  // and it rides the SAME staged-upload path as drag-drop (storage-backed, so
  // downstream lanes like WordPress media upload can reach the bytes). Text
  // pastes are untouched — we only intercept when actual image files are on
  // the clipboard.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const handlePaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            // Pasted screenshots often arrive unnamed — give them a stable name.
            files.push(file.name && file.name !== 'image.png'
              ? file
              : new File([file], `pasted-${Date.now().toString(36)}.${(item.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png'}`, { type: item.type }));
          }
        }
      }
      if (files.length === 0) return;
      event.preventDefault();
      addDroppedFiles(files);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [addDroppedFiles]);

  // ─── Init ────────────────────────────────────────────────────────────────

  useEffect(() => {
    init();
  }, [circleId]);

  // ── Reload messages when the user switches threads ───────────────────────
  // Runs only on subsequent thread changes — initial load is handled by init().
  // Skip when activeThreadId is null (still resolving) or matches the freshly
  // loaded set.
  const initialThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!circleId || !activeThreadId) return;
    if (initialThreadRef.current === null) {
      initialThreadRef.current = activeThreadId;
      return; // first set during init() — don't double-load
    }
    if (initialThreadRef.current === activeThreadId) return;
    initialThreadRef.current = activeThreadId;

    let cancelled = false;
    (async () => {
      try {
        const { rows } = await loadThreadMessages(circleId, activeThreadId);
        if (cancelled) return;
        const nextMessages = await mapLoadedThreadMessages(rows, activeThreadId, currentUserId || undefined, agentName);
        if (cancelled) return;
        setMessages(nextMessages);
      } catch (err) {
        console.warn('[ChatTab] Thread switch reload failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeThreadId, circleId, currentUserId, agentName]);

  const handleSelectThread = useCallback((id: string) => {
    setActiveThreadId(id);
  }, []);

  const handleNewThread = useCallback(async () => {
    if (!circleId) return;
    try {
      const t = await createPrivateThread(circleId, SESSION_FALLBACK_TITLE);
      setThreadListRefreshToken(prev => prev + 1);
      setActiveThreadId(t.id);
      setMessages([]);
    } catch (err) {
      console.error('[ChatTab] createPrivateThread failed:', err);
    }
  }, [circleId]);

  const handleSidebarNewAgent = useCallback(() => {
    setSpawnModalOpen(true);
  }, []);

  const handleSidebarAutomations = useCallback(() => {
    setOpenSwanInitialTask(buildOpenSwanAutomationInitialTask(input));
    setShowOpenSwanConsole(true);
  }, [input]);

  const handleSidebarMarketplace = useCallback(() => {
    const tab = 'INTEGRATIONS';
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab } }));
      return;
    }
    try {
      navigation.setParams?.({ tab, _tabTs: Date.now() });
    } catch {
      navigation.navigate?.('CircleDetail', { circleId, tab, _tabTs: Date.now() });
    }
  }, [circleId, navigation]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      persistSidebarCollapsed(next);
      return next;
    });
  }, []);

  const handleThreadMetaChanged = useCallback(() => {
    setThreadListRefreshToken(prev => prev + 1);
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setSelectedModel(DEFAULT_CHAT_MODEL);
      return;
    }
    let cancelled = false;
    getThread(activeThreadId)
      .then((thread) => {
        if (cancelled || !thread) return;
        setSelectedModel(normalizeThreadModelPreference(thread.default_model));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeThreadId, threadListRefreshToken]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identities = await loadAgentIdentities();
        const identityKey = getAgentIdentityKey({ id: BLACKSWAN_ID, name: agentName });
        const resolvedSpiritId = identities.get(identityKey)?.spiritId || getFallbackSpiritIdForSessionProfile(sessionProfile);
        if (!cancelled) {
          setActiveSpiritId(resolvedSpiritId);
        }
      } catch {
        if (!cancelled) {
          setActiveSpiritId(getFallbackSpiritIdForSessionProfile(sessionProfile));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [agentName, sessionProfile]);

  useEffect(() => {
    if (!activeSpiritId) {
      setSoulLearningRefs([]);
      return;
    }
    let cancelled = false;
    getLatestSpiritResearchReferences({
      spiritId: activeSpiritId,
      circleId,
      limit: 3,
    }).then((refs) => {
      if (!cancelled) setSoulLearningRefs(refs);
    }).catch(() => {
      if (!cancelled) setSoulLearningRefs([]);
    });
    return () => { cancelled = true; };
  }, [activeSpiritId, circleId]);

  useEffect(() => {
    if (!activeSpiritId || !currentUserId) {
      setSoulMemoryRefs([]);
      return;
    }
    let cancelled = false;
    getLatestSpiritMemoryReferences({
      spiritId: activeSpiritId,
      circleId,
      userId: currentUserId,
      limit: 4,
    }).then((refs) => {
      if (!cancelled) setSoulMemoryRefs(refs);
    }).catch(() => {
      if (!cancelled) setSoulMemoryRefs([]);
    });
    return () => { cancelled = true; };
  }, [activeSpiritId, circleId, currentUserId]);

  useEffect(() => {
    if (!activeThreadId) {
      setSessionProfile('auto');
      return;
    }
    let cancelled = false;
    loadThreadSessionProfile(activeThreadId)
      .then((profile) => {
        if (!cancelled) setSessionProfile(profile);
      })
      .catch(() => {
        if (!cancelled) setSessionProfile('auto');
      });
    return () => { cancelled = true; };
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) {
      setSessionDelegationMode('auto');
      return;
    }
    let cancelled = false;
    loadThreadDelegationMode(activeThreadId)
      .then((mode) => {
        if (!cancelled) setSessionDelegationMode(mode);
      })
      .catch(() => {
        if (!cancelled) setSessionDelegationMode('auto');
      });
    return () => { cancelled = true; };
  }, [activeThreadId]);

  const handleSessionModelChange = useCallback(async (nextModel: string) => {
    setSelectedModel(nextModel);
    if (!activeThreadId) return;
    try {
      const thread = await getThread(activeThreadId);
      const currentModel = normalizeThreadModelPreference(thread?.default_model);
      if (currentModel === nextModel) return;
      await updateThreadDefaultModel(activeThreadId, nextModel);
      handleThreadMetaChanged();
    } catch (err) {
      console.warn('[ChatTab] session model update failed:', err);
    }
  }, [activeThreadId, handleThreadMetaChanged]);

  const handleSessionProfileChange = useCallback(async (nextProfile: SessionCodingProfile) => {
    setSessionProfile(nextProfile);
    try {
      await saveThreadSessionProfile(activeThreadId, nextProfile);
    } catch {}
  }, [activeThreadId]);

  const handleDelegationModeChange = useCallback(async (nextMode: SessionDelegationMode) => {
    setSessionDelegationMode(nextMode);
    try {
      await saveThreadDelegationMode(activeThreadId, nextMode);
    } catch {}
  }, [activeThreadId]);

  const startCodingWorkbench = useCallback((prompt: string) => {
    if (!isCodingGenerationRequest(prompt, sessionProfile)) return;
    if (codingWorkbenchStopTimeoutRef.current) {
      clearTimeout(codingWorkbenchStopTimeoutRef.current);
      codingWorkbenchStopTimeoutRef.current = null;
    }
    setCodingWorkbenchPrompt(prompt);
    setCodingWorkbenchTick(0);
  }, [sessionProfile]);

  const stopCodingWorkbench = useCallback(() => {
    if (codingWorkbenchStopTimeoutRef.current) {
      clearTimeout(codingWorkbenchStopTimeoutRef.current);
      codingWorkbenchStopTimeoutRef.current = null;
    }
    setCodingWorkbenchPrompt(null);
    setCodingWorkbenchTick(0);
    setCurrentRunStep('');
  }, []);

  const stopCodingWorkbenchAfter = useCallback((delayMs = 0) => {
    if (codingWorkbenchStopTimeoutRef.current) {
      clearTimeout(codingWorkbenchStopTimeoutRef.current);
      codingWorkbenchStopTimeoutRef.current = null;
    }
    if (delayMs <= 0) {
      stopCodingWorkbench();
      return;
    }
    setCurrentRunStep('Refining the final build');
    codingWorkbenchStopTimeoutRef.current = setTimeout(() => {
      codingWorkbenchStopTimeoutRef.current = null;
      stopCodingWorkbench();
    }, delayMs);
  }, [stopCodingWorkbench]);

  useEffect(() => {
    if (!botTyping || !codingWorkbenchPrompt) return;
    const id = setInterval(() => {
      setCodingWorkbenchTick((tick) => tick + 1);
    }, 220);
    return () => clearInterval(id);
  }, [botTyping, codingWorkbenchPrompt]);

  useEffect(() => {
    if (latestBuildArtifact?.kind === 'webpage' && latestBuildArtifact.content) {
      setBuildStudioView('preview');
      return;
    }
    setBuildStudioView('code');
  }, [effectiveBuildArtifact?.kind, effectiveBuildArtifact?.content]);

  useEffect(() => {
    let cancelled = false;
    loadLastThreadBuildArtifact(activeThreadId)
      .then((artifact) => {
        if (!cancelled) setCachedBuildArtifact(artifact);
      })
      .catch(() => {
        if (!cancelled) setCachedBuildArtifact(null);
      });
    return () => { cancelled = true; };
  }, [activeThreadId]);

  useEffect(() => {
    if (!activeThreadId) return;
    if (!latestBuildArtifact) return;
    setCachedBuildArtifact(latestBuildArtifact);
    // A new build landed — clear any active revert so the strip's "current"
    // indicator moves to the newest entry.
    setRevertedArtifact(null);
    void saveLastThreadBuildArtifact(activeThreadId, latestBuildArtifact);
    // Push into the revision history. Dedupes by content so streaming the
    // same HTML twice doesn't spam the strip.
    void pushBuilderRevision(activeThreadId, latestBuildArtifact, codingWorkbenchPrompt)
      .then(next => setBuilderRevisions(next));
  }, [activeThreadId, latestBuildArtifact, codingWorkbenchPrompt]);

  useEffect(() => {
    let cancelled = false;
    loadBuilderHistory(activeThreadId)
      .then(rows => { if (!cancelled) setBuilderRevisions(rows); })
      .catch(() => { if (!cancelled) setBuilderRevisions([]); });
    return () => { cancelled = true; };
  }, [activeThreadId]);

  useEffect(() => {
    let cancelled = false;
    loadBrandPack(circleId)
      .then(pack => { if (!cancelled) setBrandPack(pack); })
      .catch(() => { if (!cancelled) setBrandPack(null); });
    return () => { cancelled = true; };
  }, [circleId]);

  useEffect(() => {
    let cancelled = false;
    loadBuilderImages(activeThreadId)
      .then(imgs => { if (!cancelled) setBuilderImages(imgs); })
      .catch(() => { if (!cancelled) setBuilderImages([]); });
    return () => { cancelled = true; };
  }, [activeThreadId]);

  const handleRevertRevision = useCallback((rev: BuilderRevision) => {
    setRevertedArtifact(rev.artifact);
    setCachedBuildArtifact(rev.artifact);
    setBuildStudioDismissed(false);
    setBuilderModalOpen(false);
    if (activeThreadId) {
      void saveLastThreadBuildArtifact(activeThreadId, rev.artifact);
    }
    // Reset the view preference — webpage artifacts go to preview by default
    if (rev.artifact.kind === 'webpage') setBuildStudioView('preview');
    else setBuildStudioView('code');
  }, [activeThreadId]);

  const handleDeleteRevision = useCallback(async (revisionId: string) => {
    if (!activeThreadId) return;
    const next = await removeBuilderRevision(activeThreadId, revisionId);
    setBuilderRevisions(next);
  }, [activeThreadId]);

  // Manual edit from the CODE tab: treat the user's edit like a fresh
  // revision of the current artifact. We push it into the history strip
  // and override the live view so PREVIEW + PUBLISH pick up the change.
  const handleArtifactEdit = useCallback(async (nextContent: string) => {
    const base = effectiveBuildArtifact;
    if (!base || !activeThreadId) return;
    const edited: SwanBotStructuredArtifact = {
      ...base,
      content: nextContent,
      title: base.title ? `${base.title} (edited)` : 'Edited build',
    };
    setRevertedArtifact(edited);
    setCachedBuildArtifact(edited);
    void saveLastThreadBuildArtifact(activeThreadId, edited);
    const next = await pushBuilderRevision(activeThreadId, edited, 'manual edit');
    setBuilderRevisions(next);
  }, [effectiveBuildArtifact, activeThreadId]);

  // Shared launcher for /build-page streaming. Used by the initial command
  // dispatch AND by the in-builder "quick tweak" + click-to-edit flows so
  // all three paths behave identically (same UI, same error handling).
  const launchBuildStream = useCallback(async (brief: string, systemExtra?: string, friendlyLabel?: string) => {
    const display = friendlyLabel || brief;
    startCodingWorkbench(`/build-page ${display}`);
    setBotTyping(true);
    setStreamingBuildText('');
    setStreamingBuildPhase('planning');
    if (streamingBuildCleanupRef.current) {
      try { streamingBuildCleanupRef.current(); } catch {}
    }
    const brandExtra = buildBrandPromptPrefix(brandPack);
    const imagesExtra = buildImagesPromptPrefix(builderImages);
    // Inject memory context so the builder knows circle patterns + user prefs
    let memoryExtra = '';
    try {
      if (circleId) {
        const { retrieveForTurn } = await import('../../../lib/memoryService');
        const { formatted } = await retrieveForTurn({
          queryText: brief, circleId, userId: currentUserId || '',
          surface: 'main_chat', budgetChars: 800, finalCount: 6,
        });
        if (formatted) memoryExtra = formatted;
      }
    } catch {}
    const combinedSystemExtra = [systemExtra, brandExtra, imagesExtra, memoryExtra].filter(Boolean).join('\n\n') || undefined;
    streamingBuildCleanupRef.current = subscribeBuildStream(
      { brief, model: selectedModel !== 'auto' ? selectedModel : 'auto', systemExtra: combinedSystemExtra },
      {
        onDelta: (_chunk, aggregated) => { setStreamingBuildText(aggregated); },
        onPhase: (name) => { setStreamingBuildPhase(name); },
        onDone: (fullText) => {
          const html = extractHtmlFromStream(fullText);
          const artifact: SwanBotStructuredArtifact = {
            kind: 'webpage' as any,
            title: `Page: ${display.slice(0, 60)}`,
            content: html,
          };
          addBotMessage(`Built a landing page for "${display.slice(0, 80)}".`, [artifact]);
          setStreamingBuildText('');
          setStreamingBuildPhase(null);
          setBotTyping(false);
          stopCodingWorkbench();
          streamingBuildCleanupRef.current = null;
        },
        onError: (msg) => {
          addBotMessage('I could not finish the page build stream. Try again in a moment.');
          setStreamingBuildText('');
          setStreamingBuildPhase(null);
          setBotTyping(false);
          stopCodingWorkbench();
          streamingBuildCleanupRef.current = null;
        },
      },
    );
  }, [brandPack, builderImages, selectedModel, startCodingWorkbench, stopCodingWorkbench]);

  const handleRegenerateTweak = useCallback((tweak: string) => {
    // Combine the original prompt with the tweak so the new build carries
    // the user's original intent forward. Pull the prompt from the coding
    // workbench state — that was seeded when /build-page first fired.
    const originalBrief = (codingWorkbenchPrompt || '').replace(/^\/build-page\s*/i, '').trim() || 'my landing page';
    const brief = `${originalBrief}. Additional tweak: ${tweak}`;
    // If the current artifact has content, carry it as context so the model
    // iterates instead of regenerating from scratch.
    const currentHtml = effectiveBuildArtifact?.content;
    const systemExtra = [
      selectedBuilderFigmaPrompt || null,
      currentHtml
        ? `The CURRENT page is below. Apply the tweak while keeping everything else as close as possible.\n\n<<<CURRENT_HTML>>>\n${currentHtml.slice(0, 8000)}\n<<<END_CURRENT_HTML>>>`
        : null,
    ].filter(Boolean).join('\n\n') || undefined;
    launchBuildStream(brief, systemExtra, `${originalBrief.slice(0, 40)} — ${tweak.slice(0, 40)}`);
  }, [codingWorkbenchPrompt, effectiveBuildArtifact, launchBuildStream, selectedBuilderFigmaPrompt]);

  const handlePointEdit = useCallback((args: { selector: string; outerHtml: string; tweak: string }) => {
    const originalBrief = (codingWorkbenchPrompt || '').replace(/^\/build-page\s*/i, '').trim() || 'my landing page';
    const currentHtml = effectiveBuildArtifact?.content;
    const systemExtra = [
      selectedBuilderFigmaPrompt || null,
      currentHtml
        ? `The CURRENT full page is:\n<<<CURRENT_HTML>>>\n${currentHtml.slice(0, 10000)}\n<<<END_CURRENT_HTML>>>`
        : null,
      `The USER POINTED at this exact element (CSS selector: ${args.selector}):\n<<<TARGET_ELEMENT>>>\n${args.outerHtml}\n<<<END_TARGET_ELEMENT>>>`,
      `Modify ONLY that element according to the user's instruction. Return the complete revised page HTML.`,
    ].filter(Boolean).join('\n\n');
    const brief = `${originalBrief}. Targeted edit to the selected element: ${args.tweak}`;
    launchBuildStream(brief, systemExtra, `edit ${args.selector.split('>').slice(-1)[0]?.trim() || 'element'} — ${args.tweak.slice(0, 40)}`);
  }, [codingWorkbenchPrompt, effectiveBuildArtifact, launchBuildStream, selectedBuilderFigmaPrompt]);

  useEffect(() => {
    if (codingWorkbenchPrompt) {
      setBuildStudioDismissed(false);
    }
  }, [codingWorkbenchPrompt]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!builderModalOpen) return;
    if (viewportWidth < 900) return;
    setBuilderModalOpen(false);
    setBuildStudioDismissed(false);
  }, [builderModalOpen, viewportWidth]);

  useEffect(() => {
    scrollOffsetRef.current = 0;
    contentHeightRef.current = 0;
    layoutHeightRef.current = 0;
    pendingRestoreOffsetRef.current = null;
    hasAppliedInitialScrollRef.current = false;
    wasNearBottomRef.current = true;
  }, [circleId, activeThreadId]);

  useEffect(() => {
    let cancelled = false;
    loadChatAgentName(circleId).then((savedName) => {
      if (!cancelled) setAgentNameState(savedName);
    }).catch(() => {});
    loadChatAgentAvatar(circleId).then((savedAvatar) => {
      if (!cancelled) setAgentAvatarUri(savedAvatar);
    }).catch(() => {
      if (!cancelled) setAgentAvatarUri(null);
    });
    return () => { cancelled = true; };
  }, [circleId]);

  // Load user behavior profile
  useEffect(() => {
    loadUserProfile().then(p => {
      p.totalSessions += 1;
      profileRef.current = p;
      saveUserProfile(p).catch(() => {});
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadCircleWorkspaceProfile(circleId),
      loadAdaptiveWorkspaceSettings(circleId),
    ]).then(([profile, settings]) => {
      if (cancelled) return;
      const adaptive = getAdaptiveChatDefaults(profile, settings);
      setMessageDensity(adaptive.messageDensity);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [circleId]);

  // Load assignable agents for chat dispatch. This includes:
  // published custom agents, the default OpenSwan agent, live OpenSwan
  // sessions, and bridge-detected terminal/editor agents.
  useEffect(() => {
    if (!circleId) return;
    let disposed = false;
    const loadAgents = async () => {
      try {
        if (disposed) return;
        const [officeResult, identities, connections] = await Promise.all([
          loadCircleOfficeAgents(circleId),
          loadAgentIdentities(),
          loadConnections(),
        ]);
        if (disposed) return;

        const assignable = new Map<string, AssignableAgent>();
        const pushAgent = (agent: AssignableAgent | null | undefined) => {
          if (!agent?.id) return;
          const key = agent.sessionKey ? `${agent.provider}::${agent.sessionKey}` : `db::${agent.id}`;
          const existing = assignable.get(key);
          if (!existing) {
            assignable.set(key, agent);
            return;
          }
          assignable.set(key, {
            ...existing,
            ...agent,
            model: agent.model || existing.model,
            spirit: agent.spirit || existing.spirit,
            color: agent.color || existing.color,
            owner_display_name: agent.owner_display_name || existing.owner_display_name,
            current_task: agent.current_task || existing.current_task,
            sessionKey: agent.sessionKey || existing.sessionKey,
            source: agent.source || existing.source,
            terminalConfig: agent.terminalConfig || existing.terminalConfig,
          });
        };

        pushAgent({
          id: DEFAULT_AGENT.id,
          name: DEFAULT_AGENT.name,
          status: DEFAULT_AGENT.status,
          provider: 'openswan',
          color: DEFAULT_AGENT.color,
          owner_display_name: 'OpenSwan',
          current_task: DEFAULT_AGENT.activity,
          circle_id: circleId,
          model: DEFAULT_AGENT.model,
          sessionKey: null,
          source: 'default',
        });

        for (const officeAgent of officeResult.agents || []) {
          pushAgent(toAssignableDbAgent(officeAgent));
        }

        const openswanConnections = connections.filter(conn => conn.provider === 'openswan' && !!conn.token);
        await Promise.all(openswanConnections.map(async (conn) => {
          const config: OpenSwanConfig = { endpoint: conn.endpoint, token: conn.token };
          const sessionsResult = await listSessions(config);
          if (!sessionsResult.ok || !sessionsResult.sessions?.length) return;
          const sessionAgents = sessionsToAgents(sessionsResult.sessions, conn.id, conn.name, conn.provider);
          for (const sessionAgent of sessionAgents) {
            const identityKey = getAgentIdentityKey(sessionAgent);
            const identity = identities.get(identityKey);
            pushAgent({
              ...toAssignableSessionAgent(sessionAgent, circleId),
              name: identity?.customName || sessionAgent.name,
              color: identity?.customColor || sessionAgent.color,
              spirit: identity?.spiritId || sessionAgent.spirit || null,
              model: identity?.boundModel || sessionAgent.model || null,
            });
          }
        }));

        try {
          const bridgeProviders = [
            { provider: 'claude-code', label: 'Claude Code', port: 7778, color: '#22d3ee' },
            { provider: 'codex', label: 'Codex', port: 7779, color: '#10a37f' },
            { provider: 'gemini', label: 'Gemini CLI', port: 7780, color: '#4285f4' },
            { provider: 'cursor', label: 'Cursor', port: 7781, color: '#8b5cf6' },
          ];
          const bridgeToken = await ensureBridgeToken();
          await Promise.all(bridgeProviders.map(async (bridge) => {
            const bridgeUrl = getBridgeUrl(bridge.port);
            if (!bridgeUrl) return;
            const res = await fetch(`${bridgeUrl}/sessions`, {
              signal: AbortSignal.timeout(3000),
              headers: bridgeAuthHeaders(bridgeToken),
            });
            if (!res.ok) return;
            const { sessions } = await res.json();
            const list = Array.isArray(sessions) ? sessions : [];
            for (let i = 0; i < list.length; i++) {
              const s = list[i];
              const identityKey = String(s.sessionId || '');
              const identity = identityKey ? identities.get(identityKey) : null;
              const terminalConfig = identity?.terminalConfig || null;
              const name = identity?.customName || s.displayName || s.slug || (list.length > 1 ? `${bridge.label} #${i + 1}` : bridge.label);
              pushAgent({
                id: `bridge::${bridge.provider}::${s.sessionId}`,
                name,
                status: s.status === 'active' ? 'building' : 'idle',
                provider: bridge.provider,
                color: identity?.customColor || bridge.color,
                owner_display_name: s.manageable || s.terminalTitle ? 'Managed terminal' : 'Observed bridge',
                current_task: s.task || s.lastUserMessage || s.cwd || s.projectDir || null,
                circle_id: circleId,
                spirit: identity?.spiritId || null,
                model: terminalConfig?.defaultModel || identity?.boundModel || s.model || null,
                sessionKey: s.sessionId || null,
                source: 'bridge-session',
                terminalConfig,
              });
            }
          }));
        } catch {}

        const ranked = Array.from(assignable.values()).sort((a, b) => {
          const aDefault = a.id === DEFAULT_AGENT.id ? 1 : 0;
          const bDefault = b.id === DEFAULT_AGENT.id ? 1 : 0;
          if (aDefault !== bDefault) return bDefault - aDefault;
          const statusRank = (status?: string | null) => {
            if (status === 'building' || status === 'active') return 0;
            if (status === 'idle') return 1;
            if (status === 'offline') return 3;
            return 2;
          };
          const rankDiff = statusRank(a.status) - statusRank(b.status);
          if (rankDiff !== 0) return rankDiff;
          return (a.name || '').localeCompare(b.name || '');
        });

        if (!disposed) setLiveAgents(ranked);
      } catch {
        if (!disposed) setLiveAgents([]);
      }
    };
    refreshAssignableAgentsRef.current = loadAgents;
    void loadAgents();
    const refreshTimer = setInterval(() => void loadAgents(), 15000);
    const ch = supabase.channel(`chat_agents_${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_office_agents' }, () => void loadAgents())
      .subscribe();
    return () => {
      disposed = true;
      clearInterval(refreshTimer);
      supabase.removeChannel(ch);
      if (refreshAssignableAgentsRef.current === loadAgents) refreshAssignableAgentsRef.current = null;
    };
  }, [circleId]);

  useEffect(() => {
    if (showAssignPanel || showSpawnPanel) {
      recordChatActivity(circleId, 'assignment').catch(() => {});
    }
  }, [circleId, showAssignPanel, showSpawnPanel]);

  const resolveOpenSwanConnection = useCallback(async (): Promise<OpenSwanConfig | null> => {
    try {
      const connections = await loadConnections();
      const match = connections.find(conn => conn.provider === 'openswan' && !!conn.token);
      return match ? { endpoint: match.endpoint, token: match.token } : null;
    } catch {
      return null;
    }
  }, []);

  const dispatchAssignedAgentTask = useCallback(async (agent: AssignableAgent, task: string): Promise<string> => {
    const normalizedProvider = (agent.provider || '').toLowerCase().replace(/\s+/g, '-');
    const terminalConfig = agent.terminalConfig || null;
    const preferredModel = (terminalConfig?.defaultModel || agent.model) && (terminalConfig?.defaultModel || agent.model) !== 'auto'
      ? (terminalConfig?.defaultModel || agent.model || undefined)
      : undefined;
    const profiledTask = ['claude-code', 'codex', 'gemini', 'gemini-cli', 'cursor'].includes(normalizedProvider)
      ? applyTerminalProfileToTask(task, terminalConfig)
      : task;

    if (normalizedProvider === 'openswan') {
      const config = await resolveOpenSwanConnection();
      if (config) {
        if (agent.sessionKey && agent.source === 'openswan-session') {
          const sessionResult = await sendSessionMessage(config, agent.sessionKey, task);
          if (sessionResult.ok) {
            return `**${agent.name}** [OpenSwan session ${agent.sessionKey}]:\n\n${sessionResult.reply || 'Message sent.'}`;
          }
        }

        const preface = [
          `You are acting as ${agent.name}.`,
          agent.spirit ? `Specialty / spirit: ${agent.spirit}.` : '',
          preferredModel ? `Prefer model: ${preferredModel}.` : '',
          `Complete this task:\n${task}`,
        ].filter(Boolean).join('\n');
        const spawnResult = await spawnSubAgent(config, preface, preferredModel);
        if (spawnResult.ok) {
          return `**${agent.name}** [spawned OpenSwan session${preferredModel ? ` · ${preferredModel}` : ''}]:\n\n${spawnResult.reply || 'Session started.'}`;
        }
      }
    }

    const bridgeProviders = ['claude-code', 'codex', 'gemini', 'gemini-cli', 'cursor'];
    if (bridgeProviders.includes(normalizedProvider)) {
      if (agent.sessionKey && agent.source === 'bridge-session') {
        const sendResult = await sendTerminalAgentSessionMessage(normalizedProvider, agent.sessionKey, profiledTask);
        if (sendResult.ok) {
          return `**${agent.name}** [managed terminal session ${agent.sessionKey.slice(0, 12)}]:\n\n${sendResult.response || 'Message sent.'}`;
        }
      }

      const dbId = agent.id?.startsWith('bridge::') ? undefined : agent.id;
      const result = await wakeAndAssignTask(
        normalizedProvider,
        agent.name,
        profiledTask,
        circleId,
        dbId,
        {
          model: preferredModel,
          workdir: terminalConfig?.defaultCwd || undefined,
          launchMode: terminalConfig?.launchMode,
          sessionName: agent.name,
        },
      );
      if (result.ok) {
        const providerLabel = formatChatAgentProviderLabel(normalizedProvider);
        return `**${agent.name}** [executed via ${providerLabel}${preferredModel ? ` · ${preferredModel}` : ''}]:\n\n${result.response || 'Done'}`;
      }
    }

    if (supportsGenericCustomAgentDispatch(normalizedProvider)) {
      const connections = await loadConnections();
      const customResult = await dispatchCustomAgentBridgeTask({
        id: agent.id,
        name: agent.name,
        provider: normalizedProvider,
        gatewayUrl: agent.gatewayUrl || undefined,
        circleId,
        model: preferredModel || agent.model || undefined,
        sessionKey: agent.sessionKey || undefined,
      }, profiledTask, connections);
      if (customResult.ok) {
        const providerLabel = formatChatAgentProviderLabel(normalizedProvider);
        return `**${agent.name}** [sent to ${providerLabel} bridge${customResult.path ? ` · ${customResult.path}` : ''}]:\n\n${customResult.response || 'Task accepted.'}`;
      }
      throw new Error(customResult.error || `${formatChatAgentProviderLabel(normalizedProvider)} bridge could not accept the task.`);
    }

    const aiResp = await getAIResponse(`[Task for ${agent.name}] ${task}`, {
      userId: currentUserId || '',
      circleId,
      userName: currentUserName,
      agentId: agent.sessionKey || agent.id,
      agentName: agent.name,
      model: preferredModel,
      spiritId: agent.spirit || undefined,
    });
    const viaLabel = preferredModel ? `${normalizedProvider || 'ai'} · ${preferredModel}` : (normalizedProvider || 'ai');
    return `**${agent.name}** [AI draft via ${viaLabel}]:\n\n${aiResp}`;
  }, [circleId, currentUserId, currentUserName, resolveOpenSwanConnection]);

  const spawnDedicatedOpenSwanSession = useCallback(async (agent: AssignableAgent, task: string): Promise<string> => {
    const config = await resolveOpenSwanConnection();
    if (!config) {
      throw new Error('No connected OpenSwan runtime found');
    }
    const preferredModel = agent.model && agent.model !== 'auto' ? agent.model : undefined;
    const launchTask = [
      `Start a fresh OpenSwan session for ${agent.name}.`,
      agent.spirit ? `Spirit / specialty: ${agent.spirit}.` : '',
      preferredModel ? `Prefer model: ${preferredModel}.` : '',
      task.trim() ? `Initial task:\n${task.trim()}` : 'Wait for follow-up instructions after spawning.',
    ].filter(Boolean).join('\n');
    const result = await spawnSubAgent(config, launchTask, preferredModel);
    if (!result.ok) {
      throw new Error(result.error || 'Failed to spawn OpenSwan session');
    }
    return `**${agent.name}** [dedicated OpenSwan session${preferredModel ? ` · ${preferredModel}` : ''}]:\n\n${result.reply || 'Session spawned and ready.'}`;
  }, [resolveOpenSwanConnection]);

  useEffect(() => {
    if (showPluginPicker) {
      recordChatActivity(circleId, 'plugin').catch(() => {});
    }
  }, [circleId, showPluginPicker]);

  const init = async () => {
    try {
    // Get current user
    const currentUser = await getCurrentChatUserProfile();
    const userId = currentUser?.id;
    if (userId) {
      setCurrentUserId(userId);
      setCurrentUserName(currentUser.displayName);
    }

    // Check if first visit (uses cross-platform storage helper)
    const visitKey = `circle_${circleId}_visited`;
    const hasVisited = await storage.getItem(visitKey);
    if (!hasVisited) {
      setIsFirstVisit(true);
      await storage.setItem(visitKey, 'true');
      // Welcome animation
      Animated.spring(welcomeAnim, {
        toValue: 1,
        useNativeDriver: true,
        tension: 50,
        friction: 8,
      }).start();
    }

    // Fetch members
    try {
      const m = await loadCircleChatMembers(circleId);
      m.push({ id: BLACKSWAN_ID, username: 'openswan', display_name: agentName });
      setMembers(m);
    } catch (e) { /* circle may not exist yet */ }

    // Resolve the circle's default thread first so the message query can
    // filter by thread_id. The migration backfills this row for every circle.
    let resolvedThreadId: string | null = activeThreadId;
    if (!resolvedThreadId) {
      try {
        const defaultThread = await getCircleDefaultThread(circleId);
        if (defaultThread) {
          resolvedThreadId = defaultThread.id;
          setActiveThreadId(defaultThread.id);
        }
      } catch (err) {
        console.warn('[ChatTab] Default thread lookup failed (migration may be pending):', err);
      }
    }

    // Load persisted messages — filter by thread_id when we have one so
    // multi-thread chats stay separated.
    try {
      const { rows, usedFallback } = await loadThreadMessages(circleId, resolvedThreadId);
      if (usedFallback) {
        console.warn('[ChatTab] Schema migration pending — loading without is_bot/reactions');
      }
      const nextMessages = await mapLoadedThreadMessages(rows, resolvedThreadId, userId, agentName);
      setMessages(nextMessages);
    } catch (e) { 
      console.error('[ChatTab] Unexpected error loading messages:', e);
    }

    setLoaded(true);

    // Non-critical enrichments — load after the chat shell is ready
    void (async () => {
      try {
        const { getConnectedWallet } = await import('../../../lib/crypto');
        const w = await getConnectedWallet();
        if (w) setWallet(w);
      } catch {}
    })();

    void (async () => {
      try {
        const dConfig = await getCircleDiscordConfig(circleId);
        setDiscordConfig(dConfig);
        if (dConfig.guild_id) {
          const chans = await getCachedChannels(circleId);
          setDiscordChannels(chans.filter(c => isTextChannel(c.type)).map(c => c.name));
        }
      } catch {}
    })();

    void (async () => {
      try {
        const props = await getProposals(circleId, 'active');
        setProposals(props);
        const pins = await getPinnedMessages(circleId);
        setPinnedMessages(pins);
      } catch {}
    })();

    } catch (e) {
      console.error('[ChatTab] init error:', e);
    } finally {
      setLoaded(true);
    }
  };

  // ─── Agent greeting on session start ──────────────────────────────────────
  // Personalized greeting when user first lands on chat each session.
  // Uses local greetings (instant) — no network dependency.
  const greetingSentRef = useRef(false);

  useEffect(() => {
    if (!loaded || !currentUserId || !circleId || greetingSentRef.current) return;

    // Check if we already greeted this session
    const greetKey = `uc_greeted_${circleId}`;
    if (Platform.OS === 'web') {
      try { if (sessionStorage.getItem(greetKey)) return; } catch {}
    }

    greetingSentRef.current = true;
    if (Platform.OS === 'web') {
      try { sessionStorage.setItem(greetKey, '1'); } catch {}
    }

    const hour = new Date().getHours();
    const name = currentUserName !== 'You' ? currentUserName : '';
    const firstName = name.split(' ')[0] || name;

    // Curated greetings — BlackSwan personality: confident, dry wit, accountability-focused
    const morningGreetings = [
      `Morning${firstName ? `, ${firstName}` : ''}. Coffee's not gonna ship your code. What's the plan?`,
      `${firstName || 'Hey'}. New day, clean slate. What are we building?`,
      `Rise and grind${firstName ? `, ${firstName}` : ''}. Your agents are warmed up and waiting.`,
      `Good morning. Yesterday's done. Let's make today count${firstName ? `, ${firstName}` : ''}.`,
    ];
    const afternoonGreetings = [
      `${firstName || 'Hey'}. Afternoon check — what's the status? Ship anything yet?`,
      `Back at it${firstName ? `, ${firstName}` : ''}. How's the build going?`,
      `Afternoon${firstName ? `, ${firstName}` : ''}. The day's half gone — let's make the second half count.`,
      `${firstName || 'Hey'}, still grinding? Good. What do you need?`,
    ];
    const eveningGreetings = [
      `Evening${firstName ? `, ${firstName}` : ''}. Late session? Respect. What are we finishing?`,
      `${firstName || 'Hey'}. Burning the midnight oil? Let's make it worth it.`,
      `Still here${firstName ? `, ${firstName}` : ''}? The best work happens when it's quiet. What's up?`,
      `Night mode${firstName ? `, ${firstName}` : ''}. No distractions. What needs to get done?`,
    ];

    const pool = hour < 12 ? morningGreetings : hour < 17 ? afternoonGreetings : eveningGreetings;
    const greeting = pool[Math.floor(Math.random() * pool.length)];

    // Small delay so it feels natural, not instant
    const timer = setTimeout(() => addBotMessage(greeting), 800);
    return () => clearTimeout(timer);
  }, [loaded, currentUserId, circleId]);

  // ─── Save session to memory — periodic checkpoint + page unload ─────────
  const lastCheckpointRef = useRef(0);
  useEffect(() => {
    if (!circleId || !currentUserId || Platform.OS !== 'web') return;

    const doCheckpoint = () => {
      import('../../../lib/swanbot').then(({ saveSessionToMemory }) => {
        saveSessionToMemory(circleId, currentUserId);
      }).catch(() => {});
    };

    // Save on page unload
    const handleUnload = () => { try { doCheckpoint(); } catch {} };
    window.addEventListener('beforeunload', handleUnload);

    // Also save on visibility change (tab switch, minimize) — more reliable than beforeunload
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        try { doCheckpoint(); } catch {}
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Periodic checkpoint every 5 minutes of active chatting
    const interval = setInterval(() => {
      if (messages.length > lastCheckpointRef.current + 4) {
        lastCheckpointRef.current = messages.length;
        doCheckpoint();
      }
    }, 300_000); // 5 min

    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(interval);
    };
  }, [circleId, currentUserId, messages.length]);

  // ─── Realtime subscription — see other members' messages live ──────────

  useEffect(() => {
    if (!circleId || !currentUserId || !activeThreadId) return;

    const channel = supabase
      .channel(`circle-chat-${circleId}-${activeThreadId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `circle_id=eq.${circleId}`,
      }, (payload: any) => {
        const newMsg = payload.new;
        if ((newMsg.thread_id || null) !== activeThreadId) return;
        // Skip messages we sent ourselves — BUT allow bot messages from FloatingChat
        const isBotFromPopout = isPersistedChatBotMessage(newMsg.content, newMsg.is_bot === true);
        if (newMsg.user_id === currentUserId && !isBotFromPopout) return;
        const botMetadata = isBotFromPopout ? readPersistedChatBotMetadata(newMsg.content) : null;
        if (botMetadata?.localMessageId) {
          void removePendingBotMessage(activeThreadId, botMetadata.localMessageId).catch(() => {});
        }

        const msg: ChatMessage = {
          ...shapePersistedChatMessage(newMsg, {
            currentUserId,
            botDisplayName: agentName,
            fallbackUserName: 'Circle Member',
          }),
          reactions: newMsg.reactions || {},
          replyTo: null,
          artifacts: botMetadata?.artifacts || undefined,
          wikiRefs: botMetadata?.wikiRefs || undefined,
          researchRefs: botMetadata?.researchRefs || undefined,
          memoryRefs: botMetadata?.memoryRefs || undefined,
          memoriesUsed: botMetadata?.memoriesUsed || undefined,
          memoryRecommendations: botMetadata?.memoryRecommendations || undefined,
          executionStream: botMetadata?.executionStream || undefined,
          browserPlans: botMetadata?.browserPlans || undefined,
          browserPlanEvents: botMetadata?.browserPlanEvents || undefined,
          browserSessions: botMetadata?.browserSessions || undefined,
          recoveryOptions: botMetadata?.recoveryOptions || undefined,
          recoveryReliability: botMetadata?.recoveryReliability || undefined,
          computerHandoff: botMetadata?.computerHandoff || undefined,
          source: botMetadata?.source,
          usage: botMetadata?.usage || undefined,
          routing: botMetadata?.routing || undefined,
          ...deriveChatActivityFlags(newMsg.content),
        };

        // Try to resolve the sender's name
        if (!newMsg.is_bot) {
          supabase.from('profiles')
            .select('display_name, username')
            .eq('id', newMsg.user_id)
            .single()
            .then(({ data }) => {
              if (data) {
                setMessages(prev => prev.map(m => 
                  m.id === msg.id ? { ...m, userName: data.display_name || data.username || 'Unknown' } : m
                ));
              }
            });
        }

        setMessages(prev => {
          if (prev.some(m => m.dbId === newMsg.id)) return prev;

          const incomingTs = new Date(newMsg.created_at || Date.now()).getTime();
          const optimisticMatchIndex = prev.findIndex(m => {
            if (m.dbId) return false;
            if (m.isBot !== msg.isBot || m.isUser !== msg.isUser) return false;
            if (m.content.trim() !== msg.content.trim()) return false;
            const delta = Math.abs(m.timestamp.getTime() - incomingTs);
            return delta < 15000;
          });

          if (optimisticMatchIndex >= 0) {
            const next = [...prev];
            next[optimisticMatchIndex] = {
              ...next[optimisticMatchIndex],
              dbId: newMsg.id,
              id: msg.id,
              timestamp: msg.timestamp,
              userName: msg.userName,
            };
            return next;
          }

          return [...prev, msg];
        });
        animateNewMessage(msg.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, currentUserId, activeThreadId, agentName]);

  // With inverted FlatList, scroll management is minimal — the latest
  // message is always at index 0 which is pinned to the visual bottom.
  // We only need scrollToBottomDirect for programmatic "jump to latest"
  // (e.g. after sending a message while scrolled up reading history).
  const scrollToBottomDirect = useCallback(() => {
    try { flatListRef.current?.scrollToOffset({ offset: 0, animated: true }); } catch {}
  }, []);

  // With inverted FlatList, new messages at the end of `messages` become
  // index 0 of `invertedMessages` and are pinned to the visual bottom
  // automatically. No scroll management needed for the normal case.
  // We only jump-to-latest when the user was scrolled up reading history
  // and a new message arrives they might want to see.
  const prevMsgCount = useRef(0);
  useEffect(() => {
    if (messages.length === 0) return;
    const isNewMsg = messages.length > prevMsgCount.current && prevMsgCount.current > 0;
    prevMsgCount.current = messages.length;
    if (isNewMsg && scrollOffsetRef.current < 200) {
      // User is near the bottom (offset < 200 in inverted = near latest)
      // — nudge to 0 to pin exactly at latest
      setTimeout(scrollToBottomDirect, 50);
    }
  }, [messages.length, scrollToBottomDirect]);

  // ─── Message Animations ──────────────────────────────────────────────────

  const animateNewMessage = (messageId: string) => {
    const anim = new Animated.Value(0);
    newMessageAnims.set(messageId, anim);
    
    Animated.sequence([
      Animated.timing(anim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const triggerParticleEffect = (x: number, y: number, isAchievement = false) => {
    const color = isAchievement ? '#f59e0b' : accentColor;
    const id = Math.random().toString();
    setParticles(prev => [...prev, { id, x, y, color }]);
  };

  const addFloatingReaction = (emoji: string, x: number, y: number) => {
    const id = Math.random().toString();
    setFloatingEmojis(prev => [...prev, { id, emoji, x, y }]);
  };

  // ─── Add Message (local-first) ───────────────────────────────────────────

  const addUserMessage = (content: string): ChatMessage => {
    const isCheckIn = content.toLowerCase().includes('check') || content.toLowerCase().includes('done');
    const isAchievement = content.toLowerCase().includes('achievement') || content.toLowerCase().includes('unlocked');
    const messageThreadId = activeThreadId;
    const replyToId = replyTo?.dbId || null;
    
    const msg: ChatMessage = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content,
      isBot: false,
      isUser: true,
      userName: currentUserName,
      timestamp: new Date(),
      reactions: {},
      replyTo: replyTo ? { name: replyTo.userName || '', content: replyTo.content.slice(0, 50) } : null,
      isCheckIn,
      isAchievement,
      source: { actor: 'user', surface: 'main_chat' },
    };

    setMessages(prev => [...prev, msg]);
    animateNewMessage(msg.id);

    // Trigger effects for special messages
    if (isCheckIn || isAchievement) {
      setTimeout(() => triggerParticleEffect(200, 300, isAchievement), 300);
    }

    // Persist to Supabase with retry
    if (messageThreadId) {
      saveRecoverableChatMessage(messageThreadId, msg);
    }
    if (currentUserId && messageThreadId) {
      const persistMessage = async (attempt = 0) => {
        try {
          const dbId = await persistChatMessage({
            circleId,
            userId: currentUserId,
            content,
            threadId: messageThreadId,
            replyToId,
            isBot: false,
            reactions: {},
          });
          if (dbId) {
            void removePendingBotMessage(messageThreadId, msg.id).catch(() => {});
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, dbId } : m));
          }
        } catch (e) {
          console.error('[ChatTab] Unexpected error persisting:', e);
          if (attempt < 3) {
            setTimeout(() => persistMessage(attempt + 1), 1000 * (attempt + 1));
          }
        }
      };
      persistMessage();
    }

    syncSessionArchiveMessage(msg);

    return msg;
  };

  const addBotMessage = (content: string, artifacts?: SwanBotStructuredArtifact[], extra?: ChatBotMessageExtra) => {
    const msgId = `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const messageThreadId = activeThreadId;
    const messageSource: ChatMessageSource = extra?.source || {
      actor: agentName,
      surface: extra?.localOnly ? 'main_chat_local' : 'main_chat',
      selectedModel: selectedModel || null,
    };
    const msg: ChatMessage = {
      id: msgId,
      content,
      isBot: true,
      isUser: false,
      userName: agentName,
      timestamp: new Date(),
      reactions: {},
      artifacts,
      wikiRefs: extra?.wikiRefs,
      researchRefs: extra?.researchRefs,
      source: messageSource,
      usage: extra?.usage || undefined,
      delegatedTo: extra?.delegatedTo,
      delegatedSubagents: extra?.delegatedSubagents,
      runId: extra?.runId,
      memoriesUsed: extra?.memoriesUsed,
      memoryRefs: extra?.memoryRefs,
      memoryRecommendations: extra?.memoryRecommendations,
      executionStream: extra?.executionStream,
      agentPlan: extra?.agentPlan,
      browserPlans: extra?.browserPlans,
      browserPlanEvents: extra?.browserPlanEvents,
      browserSessions: extra?.browserSessions,
      recoveryOptions: extra?.recoveryOptions,
      recoveryReliability: extra?.recoveryReliability,
      computerHandoff: extra?.computerHandoff,
      chatAutomationPlanPreview: extra?.chatAutomationPlanPreview,
      computerPreflightBlockers: extra?.computerPreflightBlockers,
      computerFindings: extra?.computerFindings,
      bestOfN: extra?.bestOfN,
      quickReplies: extra?.quickReplies,
      taskPlan: extra?.taskPlan,
      toolEvents: extra?.toolEvents,
      verificationResults: extra?.verificationResults,
      routing: extra?.routing,
      automationProposal: extra?.automationProposal,
      searchResults: extra?.searchResults,
      commandsHelp: extra?.commandsHelp,
      assignPickerAgents: extra?.assignPickerAgents,
      bridgeDiagResults: extra?.bridgeDiagResults,
      showRunTrace: extra?.showRunTrace,
      isPending: false,
    };

    setMessages(prev => [...prev, msg]);
    animateNewMessage(msg.id);

    // Background memory extraction — non-blocking, updates the message with saved indicators
    if (currentUserId && circleId) {
      (async () => {
        try {
          const { autoExtractAndSave } = await import('../../../lib/agentMemory');
          const history = messages.slice(-6).map(m => ({ role: m.isBot ? 'model' : 'user', text: m.content }));
          history.push({ role: 'model', text: content });
          const { saved } = await autoExtractAndSave(circleId, currentUserId, history);
          if (saved > 0) {
            // Update the message with memory saved indicator
            setMessages(prev => prev.map(m =>
              m.id === msgId ? { ...m, memoriesSaved: [`${saved} new`] } : m
            ));
            setMemoryToast({ message: `${saved} memor${saved === 1 ? 'y' : 'ies'} saved from this conversation`, type: 'saved' });
          }
        } catch {}
      })();
    }

    // Persist every visible bot message. `localOnly` now only describes
    // UI behavior; refresh recovery still keeps the transcript intact.
    if (messageThreadId) {
      saveRecoverableChatMessage(messageThreadId, msg);
    }
    // Flywheel: derive the outcome verdict from the data already in scope so
    // it can be stamped onto the row once persisted (Cursor-Tab precedent).
    // Deterministic + fail-safe: recovery affordances => partial, an approval/
    // blocker gate => blocked, clean artifact/text => completed.
    const finalizeVerdict = deriveOutcomeVerdict({
      hadError: false,
      hadRecoveryOptions: (extra?.recoveryOptions?.length || 0) > 0,
      approvalPending: extra?.chatAutomationPlanPreview?.approvalRequired === true
        || (extra?.computerPreflightBlockers?.items?.length || 0) > 0,
      producedArtifact: (artifacts?.length || 0) > 0
        || (extra?.browserPlans?.length || 0) > 0
        || (extra?.computerFindings?.items?.length || 0) > 0
        || (extra?.bestOfN?.candidates?.length || 0) > 0,
      producedText: (content || '').trim().length > 0,
    });
    if (currentUserId && messageThreadId) {
      persistMainChatBotMessageWithRetry({
        circleId,
        userId: currentUserId,
        agentName,
        content,
        threadId: messageThreadId,
        localMessageId: msgId,
        source: messageSource,
        usage: extra?.usage || null,
        artifacts,
        wikiRefs: extra?.wikiRefs,
        researchRefs: extra?.researchRefs,
        memoriesUsed: extra?.memoriesUsed,
        memoryRefs: extra?.memoryRefs,
        memoryRecommendations: extra?.memoryRecommendations,
        executionStream: extra?.executionStream,
        agentPlan: extra?.agentPlan,
        taskPlan: extra?.taskPlan,
        toolEvents: extra?.toolEvents,
        verificationResults: extra?.verificationResults,
        browserPlans: extra?.browserPlans,
        browserPlanEvents: extra?.browserPlanEvents,
        browserSessions: extra?.browserSessions,
        recoveryOptions: extra?.recoveryOptions,
        recoveryReliability: extra?.recoveryReliability,
        computerHandoff: extra?.computerHandoff,
        chatAutomationPlanPreview: extra?.chatAutomationPlanPreview,
        computerFindings: extra?.computerFindings,
        bestOfN: extra?.bestOfN,
        routing: extra?.routing,
        onError: (error) => {
          console.error('[ChatTab] Unexpected error persisting bot msg:', error);
        },
        onPersisted: (dbId) => {
          void removePendingBotMessage(messageThreadId, msgId).catch(() => {});
          setMessages(prev => prev.map((message) => (
            message.id === msgId ? { ...message, dbId } : message
          )));
          // Stamp the finalize verdict now that the row has a dbId. The stamp
          // is best-effort and swallows its own errors, so it never blocks UI.
          stampOutcomeSignalRef.current(msgId, { verdict: finalizeVerdict });
        },
      });
    }

    syncSessionArchiveMessage(msg);

    return msg;
  };

  useEffect(() => {
    if (!circleId || !currentUserId || !activeThreadId || messages.length < 4) return;
    if (messages.some((message) => message.isBot && message.automationProposal)) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const since = new Date(Date.now() - 14 * 24 * 3_600_000).toISOString();
        const rows = await loadChatAutomationDecisions(circleId, { since, limit: 120 });
        if (cancelled) return;

        const [suggestion] = buildRepeatedFlowAutomationProposals(rows, {
          minOccurrences: 3,
          maxSuggestions: 1,
        });
        if (!suggestion) return;

        const seenKey = `${circleId}:${activeThreadId}:${suggestion.fingerprint}`;
        if (automationSuggestionSeenRef.current.has(seenKey)) return;

        const storageKey = `uc_chat_automation_suggestion_seen:${seenKey}`;
        if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem(storageKey);
          if (stored) {
            automationSuggestionSeenRef.current.add(seenKey);
            return;
          }
          try { localStorage.setItem(storageKey, new Date().toISOString()); } catch {}
        }
        automationSuggestionSeenRef.current.add(seenKey);
        if (cancelled) return;

        addBotMessage(suggestion.message, undefined, {
          localOnly: true,
          automationProposal: suggestion.proposal,
          source: {
            actor: 'OpenSwan',
            surface: 'chat_automation_suggestion',
            selectedModel,
            effectiveModel: 'repeated-flow-detector-v1',
          },
        });
      })();
    }, 1800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `addBotMessage` is intentionally omitted: it is recreated every render,
    // while this effect is keyed to thread/message activity and deduped by the
    // suggestion fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, circleId, currentUserId, messages.length, selectedModel]);

  const addDesktopBridgeAutoConnectMessage = async (surface = 'desktop_bridge_recovery') => {
    const result = await autoConnectDesktopBridge();
    addBotMessage(result.content, undefined, {
      localOnly: true,
      recoveryOptions: result.recoveryPayload?.recoveryOptions,
      source: {
        actor: 'OpenSwan',
        surface,
        selectedModel,
        effectiveModel: 'local-desktop-bridge',
      },
    });
    return result;
  };

  const addRecoverableChatErrorMessage = async (details: {
    title: string;
    task: string;
    error: unknown;
    executionKind: string;
    source: string;
    touched?: string[];
    messageSource?: ChatMessageSource;
    launchIfMissing?: boolean;
  }): Promise<void> => {
    const failureMessage = details.error instanceof Error
      ? details.error.message
      : typeof details.error === 'string'
        ? details.error
        : (details.error as any)?.message || 'Unknown error';
    const failureStack = details.error instanceof Error
      ? details.error.stack || null
      : typeof (details.error as any)?.stack === 'string'
        ? (details.error as any).stack
        : null;
    const recovery = await startMainChatFailureRecoveryPayload({
      task: details.task,
      failureMessage,
      failureStack,
      outcomeStatus: 'failed',
      executionKind: details.executionKind,
      source: details.source,
      launchIfMissing: details.launchIfMissing ?? true,
      touched: details.touched,
    });
    addBotMessage(`${details.title}: ${failureMessage}${recovery.message}`, undefined, {
      localOnly: true,
      recoveryOptions: recovery.recoveryOptions,
      recoveryReliability: recovery.recoveryReliability,
      source: details.messageSource || {
        actor: 'OpenSwan',
        surface: `${details.source}_message`,
        selectedModel: selectedModel || null,
      },
    });
  };

  const addPendingBotMessage = (content: string, extra?: { taskPlan?: OpenSwanTaskPlan }) => {
    const msgId = `bot-pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const msg: ChatMessage = {
      id: msgId,
      content,
      isBot: true,
      isUser: false,
      userName: agentName,
      timestamp: new Date(),
      reactions: {},
      taskPlan: extra?.taskPlan,
      toolEvents: [],
      verificationResults: [],
      executionStream: [],
      source: {
        actor: agentName,
        surface: 'main_chat_pending',
        selectedModel: selectedModel || null,
      },
      isPending: true,
    };
    setMessages(prev => [...prev, msg]);
    animateNewMessage(msg.id);
    if (activeThreadId && content.trim()) {
      saveRecoverableChatMessage(activeThreadId, msg);
    }
    return msg;
  };

  useEffect(() => {
    const notice = pendingCapabilityBuildoutNotice;
    if (!notice) return;
    const visible = formatAgentAppCapabilityBuildoutForUser(notice.buildout);
    if (!visible.trim()) {
      setPendingCapabilityBuildoutNotice(null);
      return;
    }
    const task = String(notice.task || '').trim();
    const taskLine = task
      ? `\n\n- Task: ${task.length > 180 ? `${task.slice(0, 177)}...` : task}`
      : '';
    addBotMessage(`${visible}${taskLine}`, undefined, {
      source: {
        actor: 'OpenSwan',
        surface: 'main_chat_computer_task_capability_update',
        selectedModel,
        effectiveModel: selectedModel || null,
      },
    });
    setPendingCapabilityBuildoutNotice(null);
  // addBotMessage is intentionally omitted; the pending notice key/ref makes
  // this one-shot while avoiding duplicate notifications across rerenders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCapabilityBuildoutNotice?.key, selectedModel]);

  useEffect(() => {
    const taskState = computerTaskState;
    const capabilityBuildout = taskState?.capabilityBuildout;
    if (!taskState || capabilityBuildout?.status !== 'ready_to_retry') return;
    if (capabilityBuildout.autoRetryAttemptedAt || capabilityBuildout.autoRetryStatus) return;

    const retryKey = `${taskState.id}:${capabilityBuildout.sessionId || capabilityBuildout.updatedAt || capabilityBuildout.retryPlan || taskState.task}`;
    if (capabilityAutoRetryKeyRef.current === retryKey) return;
    capabilityAutoRetryKeyRef.current = retryKey;

    let cancelled = false;
    void (async () => {
      const attemptedAt = new Date().toISOString();
      const runningBuildout: ComputerTaskCapabilityBuildout = {
        ...capabilityBuildout,
        autoRetryStatus: 'running',
        autoRetryAttemptedAt: attemptedAt,
        updatedAt: attemptedAt,
      };
      await persistComputerTaskState({
        task: taskState.task,
        taskKind: taskState.taskKind,
        taskLabel: taskState.taskLabel,
        phase: 'executing',
        adapterId: taskState.adapterId || null,
        blockers: taskState.blockers,
        nextSteps: ['Retrying the task with the newly available app capability'],
        grantedAccess: taskState.grantedAccess,
        accessPlan: taskState.accessPlan,
        runId: taskState.runId || null,
        sessionId: taskState.sessionId || null,
        liveUrl: taskState.liveUrl || null,
        grounding: taskState.grounding || null,
        capabilityBuildout: runningBuildout,
        complexity: taskState.complexity || null,
        checkpointRecovery: taskState.checkpointRecovery || null,
      });
      if (cancelled) return;
      addBotMessage(formatAgentAppCapabilityBuildoutForUser(runningBuildout) || '**Use Computer**\n- App support is ready. Retrying now.', undefined, {
        source: {
          actor: 'OpenSwan',
          surface: 'main_chat_computer_task',
          selectedModel,
          effectiveModel: selectedModel || null,
        },
      });
      await executeSharedComputerTask(taskState.task, {
        planPrefix: 'Retry after app capability buildout: ',
        readyCapabilityBuildout: runningBuildout,
      });
    })();

    return () => {
      cancelled = true;
    };
  // addBotMessage intentionally not in deps; retryKey/ref and persisted
  // autoRetryAttemptedAt make this one-shot across rerenders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    computerTaskState?.id,
    computerTaskState?.capabilityBuildout?.status,
    computerTaskState?.capabilityBuildout?.updatedAt,
    executeSharedComputerTask,
    persistComputerTaskState,
    selectedModel,
  ]);

  const nukeCurrentThread = useCallback(async () => {
    if (!circleId || !activeThreadId) {
      addBotMessage('No active thread to clear.');
      return;
    }

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('circle_id', circleId)
      .eq('thread_id', activeThreadId);

    if (error) {
      addBotMessage('I could not clear this thread. Try again in a moment.');
      return;
    }

    await clearPendingBotMessages(activeThreadId).catch(() => {});
    setMessages([]);
    setCachedBuildArtifact(null);
    setBuilderRevisions([]);
    setBuilderImages([]);
    setPendingComputerUseTask('');
    setPendingComputerUseActions([]);
    setPendingComputerUsePlan(null);
    setPendingComputerUseGrantSummary('');
    setPendingComputerUseApprovalSummary('');
    setPendingComputerUseGrantIds([]);
    setPendingComputerUseOrigin(null);
    setComputerUseSession(null);
    setComputerTaskState(null);
    computerUseTask.reset();
    await clearComputerTaskState(circleId, activeThreadId).catch(() => {});
    await clearChatSessionArchive(circleId, activeThreadId).catch(() => {});
  }, [activeThreadId, circleId, computerUseTask]);

  // Mirror the single mid-run confirmation (the pay/book floor) as a PERSISTED
  // chat bubble with Yes/No quick replies, in addition to the live overlay, so
  // the user can confirm from the transcript and it survives reload. v1 reuses
  // the quickReplies chip surface; the answer routes back through sendMessage →
  // the booking follow-up / confirmation intercept. Idempotency-keyed by the
  // confirmation id so it posts exactly once even under StrictMode re-render.
  useEffect(() => {
    const pending = computerUseTask.state.pendingConfirmation;
    if (!pending || !pending.id) return;
    const key = `confirm::${pending.id}`;
    if (computerConfirmPostedKeyRef.current === key) return;
    computerConfirmPostedKeyRef.current = key;
    // Restate the LIVE question text (carries amount+merchant from the edge);
    // it is model-authored/untrusted, so it is shown as plain text only — no
    // secrets/card data are ever placed here (guest-card entry is isolated in
    // the live session view via human_takeover, never in chat context).
    const question = String(pending.question || 'Confirm this action to continue?').slice(0, 600);
    addBotMessage(question, undefined, {
      quickReplies: ['Yes', 'No'],
      source: {
        actor: 'OpenSwan',
        surface: 'main_chat_computer_confirmation',
        selectedModel,
        effectiveModel: selectedModel !== 'auto' ? selectedModel : null,
      },
    });
  }, [computerUseTask.state.pendingConfirmation, selectedModel]);

  // When the Computer Use agent completes (or errors out), post its result
  // to chat once. Deduped via a ref keyed on runId so React StrictMode
  // double-invocation doesn't double-post.
  useEffect(() => {
    const { status, result, errorMessage, runId, sessionId, task } = computerUseTask.state;
    if (status === 'idle' || status === 'starting' || status === 'running') {
      if ((status === 'starting' || status === 'running') && task) {
        void persistComputerTaskState({
          task,
          taskKind: 'browser_task',
          taskLabel: 'Browser task',
          phase: 'executing',
          adapterId: 'browser_adapter',
          runId: runId || null,
          sessionId: sessionId || null,
          liveUrl: computerUseTask.state.liveUrl || null,
          grantedAccess: pendingComputerUseGrantIds,
          accessPlan: pendingComputerUseGrantSummary || null,
          nextSteps: ['Wait for the browser run to finish', 'Review the summary and findings'],
          grounding: computerTaskState?.grounding || null,
          capabilityBuildout: computerTaskState?.capabilityBuildout || null,
          complexity: computerTaskState?.complexity || null,
          checkpointRecovery: computerTaskState?.checkpointRecovery || null,
        });
      }
      if (status === 'idle') computerUsePostedKeyRef.current = null;
      return;
    }
    if (status === 'done' && result) {
      const key = `done::${runId || sessionId || task}`;
      if (computerUsePostedKeyRef.current === key) return;
      computerUsePostedKeyRef.current = key;
      void persistComputerTaskState({
        task,
        taskKind: 'browser_task',
        taskLabel: 'Browser task',
        phase: 'completed',
        adapterId: 'browser_adapter',
        runId: runId || null,
        sessionId: sessionId || null,
        liveUrl: computerUseTask.state.liveUrl || null,
        grantedAccess: pendingComputerUseGrantIds,
        accessPlan: pendingComputerUseGrantSummary || null,
        nextSteps: [],
        grounding: computerTaskState?.grounding || null,
        capabilityBuildout: computerTaskState?.capabilityBuildout || null,
        complexity: computerTaskState?.complexity || null,
        checkpointRecovery: null,
        resultSummary: result.summary || null,
      });
      recordSessionArchiveEvent({
        kind: 'computer_task',
        summary: `Computer task completed: ${task}`,
        touched: [
          'surface:computer_use',
          'surface:browser',
          task ? `computer_task:${task}` : '',
          computerUseTask.state.liveUrl ? `url:${computerUseTask.state.liveUrl}` : '',
        ].filter(Boolean),
        metadata: {
          runId: runId || null,
          sessionId: sessionId || null,
          iterations: result.iterations,
          tokenTotal: (result.tokens?.input || 0) + (result.tokens?.output || 0),
        },
      });
      const tokenTotal = (result.tokens?.input || 0) + (result.tokens?.output || 0);
      const header = `**Computer Use** complete — ${result.iterations} step${result.iterations === 1 ? '' : 's'}, ${tokenTotal.toLocaleString()} tokens`;
      const findings = result.findings && result.findings.length
        ? '\n\n' + result.findings.map((f, i) => {
            const parts = [`${i + 1}. **${f.title || 'Item'}**`];
            if (f.price) parts.push(`— ${f.price}`);
            if (f.rating) parts.push(`(${f.rating})`);
            const line = parts.join(' ');
            const extra = [
              f.notes ? `   ${f.notes}` : '',
              f.url ? `   ${f.url}` : '',
            ].filter(Boolean).join('\n');
            return extra ? `${line}\n${extra}` : line;
          }).join('\n')
        : '';
      const extractedData = result.extractedData
        ? `\n\n**Extracted Data**\n\`\`\`json\n${JSON.stringify(result.extractedData, null, 2).slice(0, 4000)}\n\`\`\``
        : '';
      // WI-4: persist bounded structured findings + attach "Book option N"
      // quick replies so the follow-up seam (WI-5) can resolve durably after
      // reload. Findings carry only title/url/price/rating/notes text — no
      // secrets/card data — and the builder clamps + caps to 10 items.
      const computerFindings = computerFindingsMetadata(result.findings, {
        runId: runId || null,
        sessionId: sessionId || computerUseTask.state.sessionId || null,
      });
      const bookQuickReplies = computerFindings && computerFindings.items.length
        ? computerFindings.items.map((_, i) => `Book option ${i + 1}`)
        : undefined;
      // Repeat-run diff (plan §5c): when this same task ran before, lead
      // with what CHANGED instead of re-dumping the list — including an
      // explicit "no changes". Best-effort lookup; the message posts either
      // way. Owner for matching/diff/copy: src/lib/computerRunDiff.ts.
      void (async () => {
        let diffBlock = '';
        try {
          if (result.findings?.length) {
            const { normalizeComputerTaskForComparison, diffComputerRunFindings, formatComputerRunDiffSummary } =
              await import('../../../lib/computerRunDiff');
            const normalizedTask = normalizeComputerTaskForComparison(task);
            if (normalizedTask) {
              const { data: priorRuns } = await supabase
                .from('computer_use_runs')
                .select('id, task, findings, completed_at')
                .eq('circle_id', circleId)
                .eq('status', 'done')
                .not('findings', 'is', null)
                .neq('id', runId || '')
                .order('completed_at', { ascending: false })
                .limit(10);
              const prior = (priorRuns || []).find(
                (row) => normalizeComputerTaskForComparison(String(row.task || '')) === normalizedTask,
              );
              if (prior && Array.isArray(prior.findings) && prior.findings.length) {
                const diff = diffComputerRunFindings(prior.findings as any[], result.findings || []);
                const completedAt = Date.parse(String(prior.completed_at || ''));
                diffBlock = formatComputerRunDiffSummary(diff, {
                  previousAgeMs: Number.isFinite(completedAt) ? Math.max(0, Date.now() - completedAt) : null,
                });
              }
            }
          }
        } catch { /* diff is a bonus — never delay or drop the result */ }
        addBotMessage(
          `${header}\n\n${diffBlock ? `${diffBlock}\n\n` : ''}${result.summary}${findings}${extractedData}`,
          undefined,
          {
            runId,
            computerFindings: computerFindings || undefined,
            quickReplies: bookQuickReplies,
          },
        );
      })();
    } else if (status === 'error' && errorMessage) {
      const key = `err::${task}::${errorMessage.slice(0, 80)}`;
      if (computerUsePostedKeyRef.current === key) return;
      computerUsePostedKeyRef.current = key;
      const checkpointRecovery = diagnoseComputerTaskCheckpointFailure({
        task: task || 'Browser computer task',
        failureMessage: errorMessage,
        outcomeStatus: 'failed',
        executionKind: 'browser_computer_use',
        source: 'computer_use_agent_error',
        stateComplexity: computerTaskState?.complexity || null,
        groundingSummary: computerTaskState?.grounding?.summary || null,
        planSummary: pendingComputerUseGrantSummary || null,
      });
      void persistComputerTaskState({
        task,
        taskKind: 'browser_task',
        taskLabel: 'Browser task',
        phase: 'failed',
        adapterId: 'browser_adapter',
        runId: runId || null,
        sessionId: sessionId || null,
        liveUrl: computerUseTask.state.liveUrl || null,
        grantedAccess: pendingComputerUseGrantIds,
        accessPlan: pendingComputerUseGrantSummary || null,
        blockers: [errorMessage],
        grounding: computerTaskState?.grounding || null,
        capabilityBuildout: computerTaskState?.capabilityBuildout || null,
        complexity: computerTaskState?.complexity || null,
        checkpointRecovery,
        checkpointRecoveryIsNew: true,
      });
      recordSessionArchiveError(
        `Computer task failed: ${task}`,
        errorMessage,
        ['surface:computer_use', task ? `computer_task:${task}` : ''].filter(Boolean),
      );
      void (async () => {
        const recovery = await startMainChatFailureRecoveryPayload({
          task: task || 'Browser computer task',
          failureMessage: errorMessage,
          outcomeStatus: 'failed',
          executionKind: 'browser_computer_use',
          runId: runId || sessionId || null,
          source: 'computer_use_agent_error',
          launchIfMissing: true,
          checkpointRecovery,
          touched: [
            'surface:computer_use',
            task ? `computer_task:${task}` : '',
            checkpointRecovery ? `checkpoint:${checkpointRecovery.failedCheckpointId}` : '',
          ].filter(Boolean),
        });
        addBotMessage(appendCustomerSafeRecoveryMessage(
          '**Computer Use** could not complete that task. Technical details were saved for recovery.',
          recovery.message,
        ), undefined, {
          recoveryOptions: recovery.recoveryOptions,
          recoveryReliability: recovery.recoveryReliability,
        });
      })();
    }
  // addBotMessage intentionally not in deps — it's recreated every render,
  // and the ref-based dedupe above guarantees one post per terminal state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerUseTask.state.status, computerUseTask.state.result, computerUseTask.state.errorMessage, computerUseTask.state.runId, computerUseTask.state.sessionId, computerUseTask.state.task, computerUseTask.state.liveUrl, pendingComputerUseGrantIds, pendingComputerUseGrantSummary, persistComputerTaskState, recordSessionArchiveError, recordSessionArchiveEvent, startMainChatFailureRecoveryPayload]);

  const updateBotMessage = (
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'artifacts' | 'wikiRefs' | 'researchRefs' | 'runId' | 'taskPlan' | 'toolEvents' | 'verificationResults' | 'executionStream' | 'browserPlans' | 'browserPlanEvents' | 'browserSessions' | 'recoveryOptions' | 'recoveryReliability' | 'chatAutomationPlanPreview' | 'isPending' | 'memoriesUsed' | 'memoryRefs' | 'memoryRecommendations' | 'delegatedSubagents' | 'routing' | 'source' | 'usage'>>,
  ) => {
    let nextMessageToPersist: ChatMessage | null = null;
    setMessages(prev => prev.map((message) => {
      if (message.id !== messageId) return message;
      nextMessageToPersist = {
        ...message,
        ...patch,
        timestamp: patch.isPending === false ? new Date() : message.timestamp,
      };
      return nextMessageToPersist;
    }));
    const recoverableMessage = nextMessageToPersist as ChatMessage | null;
    if (activeThreadId && recoverableMessage?.isBot && !recoverableMessage.dbId && (recoverableMessage.content || '').trim()) {
      saveRecoverableChatMessage(activeThreadId, recoverableMessage);
    }
    syncSessionArchiveMessage(nextMessageToPersist);
  };

  const syncPersistedBotMessage = useCallback((message: ChatMessage | null | undefined) => {
    if (!message?.dbId || !message.isBot) return;
    updateMainChatBotMessageWithRetry({
      messageId: message.dbId,
      agentName,
      content: message.content,
      artifacts: message.artifacts,
      wikiRefs: message.wikiRefs,
      researchRefs: message.researchRefs,
      memoriesUsed: message.memoriesUsed,
      memoryRefs: message.memoryRefs,
      memoryRecommendations: message.memoryRecommendations,
      executionStream: message.executionStream,
      taskPlan: message.taskPlan,
      toolEvents: message.toolEvents,
      verificationResults: message.verificationResults,
      browserPlans: message.browserPlans,
      browserPlanEvents: message.browserPlanEvents,
      browserSessions: message.browserSessions,
      recoveryOptions: message.recoveryOptions,
      recoveryReliability: message.recoveryReliability,
      chatAutomationPlanPreview: message.chatAutomationPlanPreview,
      source: message.source,
      usage: message.usage,
      routing: message.routing,
      onError: (error) => {
        console.error('[ChatTab] Unexpected error updating bot msg:', error);
      },
    });
  }, [agentName]);

  const applyBrowserPlanPatch = useCallback((
    messageId: string,
    planId: string,
    patch: Partial<BrowserPlanCardData>,
    runId?: string | null,
  ) => {
    let nextPlansToPersist: BrowserPlanCardData[] | null = null;
    let nextMessageToPersist: ChatMessage | null = null;
    setMessages(prev => prev.map((message) => {
      if (message.id !== messageId || !message.browserPlans?.length) return message;
      const nextPlans = message.browserPlans.map((plan) => plan.planId === planId ? { ...plan, ...patch } : plan);
      nextMessageToPersist = { ...message, browserPlans: nextPlans };
      nextPlansToPersist = nextPlans;
      return nextMessageToPersist;
    }));
    if (runId && nextPlansToPersist) {
      void mergeRunMetadata(runId, { browserPlans: nextPlansToPersist });
    }
    syncSessionArchiveMessage(nextMessageToPersist);
    syncPersistedBotMessage(nextMessageToPersist);
  }, [syncPersistedBotMessage, syncSessionArchiveMessage]);

  const appendBrowserPlanEvent = useCallback((
    messageId: string,
    event: BrowserPlanEvent,
    runId?: string | null,
  ) => {
    let nextEventsToPersist: BrowserPlanEvent[] | null = null;
    let nextMessageToPersist: ChatMessage | null = null;
    setMessages(prev => prev.map((message) => {
      if (message.id !== messageId) return message;
      const nextEvents = [...(message.browserPlanEvents || []), event];
      nextMessageToPersist = { ...message, browserPlanEvents: nextEvents };
      nextEventsToPersist = nextEvents;
      return nextMessageToPersist;
    }));
    if (runId && nextEventsToPersist) {
      void mergeRunMetadata(runId, { browserPlanEvents: nextEventsToPersist });
      void appendRunBrowserPlanEvent({ runId, circleId, event });
    }
    recordSessionArchiveEvent({
      kind: 'browser_plan',
      summary: event.summary,
      touched: [
        'surface:browser',
        event.kind ? `browser_event:${event.kind}` : '',
        event.backend ? `browser_backend:${event.backend}` : '',
      ].filter(Boolean),
      metadata: {
        planId: event.planId,
        backendLabel: event.backendLabel || null,
        backendLiveUrl: event.backendLiveUrl || null,
      },
    });
    syncSessionArchiveMessage(nextMessageToPersist);
    syncPersistedBotMessage(nextMessageToPersist);
  }, [circleId, recordSessionArchiveEvent, syncPersistedBotMessage, syncSessionArchiveMessage]);

  const upsertBrowserSessionRecord = useCallback((
    messageId: string,
    record: BrowserSessionRecord,
    runId?: string | null,
  ) => {
    let nextSessionsToPersist: BrowserSessionRecord[] | null = null;
    let nextMessageToPersist: ChatMessage | null = null;
    setMessages(prev => prev.map((message) => {
      if (message.id !== messageId) return message;
      const existing = message.browserSessions || [];
      const nextSessions = existing.some((session) => session.id === record.id)
        ? existing.map((session) => (session.id === record.id ? { ...session, ...record } : session))
        : [...existing, record];
      nextSessionsToPersist = nextSessions;
      nextMessageToPersist = { ...message, browserSessions: nextSessions };
      return nextMessageToPersist;
    }));
    if (runId && nextSessionsToPersist) {
      void mergeRunMetadata(runId, { browserSessions: nextSessionsToPersist });
    }
    recordSessionArchiveEvent({
      kind: 'browser_session',
      summary: `${record.task} (${record.status}) via ${record.backendLabel}`,
      touched: [
        'surface:browser',
        record.backend ? `browser_backend:${record.backend}` : '',
        record.currentUrl ? `url:${record.currentUrl}` : '',
      ].filter(Boolean),
      metadata: {
        sessionId: record.id,
        status: record.status,
        backendLiveUrl: record.backendLiveUrl || null,
      },
    });
    syncSessionArchiveMessage(nextMessageToPersist);
    syncPersistedBotMessage(nextMessageToPersist);
  }, [recordSessionArchiveEvent, syncPersistedBotMessage, syncSessionArchiveMessage]);

  const upsertBrowserSessionArtifacts = useCallback((
    messageId: string,
    sessionRecord: BrowserSessionRecord,
    runId?: string | null,
  ) => {
    const replayArtifact: SwanBotStructuredArtifact | null = sessionRecord.backendLiveUrl ? {
      kind: 'webpage',
      title: `Browser Replay · ${sessionRecord.task}`,
      url: sessionRecord.backendLiveUrl,
      metadata: {
        source: 'browser_session',
        browserSessionId: sessionRecord.id,
        browserSessionKind: 'replay',
        backend: sessionRecord.backend,
        backendLabel: sessionRecord.backendLabel,
      },
    } : null;
    const latestScreenshot = [...sessionRecord.actions]
      .reverse()
      .find((action) => action.screenshotAfter || action.screenshotBefore);
    const screenshotBase64 = latestScreenshot?.screenshotAfter || latestScreenshot?.screenshotBefore || null;
    const screenshotArtifact: SwanBotStructuredArtifact | null = screenshotBase64 ? {
      kind: 'image',
      title: `Browser Proof · ${sessionRecord.task}`,
      url: `data:image/png;base64,${screenshotBase64}`,
      metadata: {
        source: 'browser_session',
        browserSessionId: sessionRecord.id,
        browserSessionKind: 'proof_screenshot',
        backend: sessionRecord.backend,
        backendLabel: sessionRecord.backendLabel,
      },
    } : null;
    const nextArtifacts = [replayArtifact, screenshotArtifact].filter(Boolean) as SwanBotStructuredArtifact[];
    if (nextArtifacts.length === 0) return;

    let nextMessageToPersist: ChatMessage | null = null;
    setMessages(prev => prev.map((message) => {
      if (message.id !== messageId) return message;
      const existingArtifacts = message.artifacts || [];
      const retainedArtifacts = existingArtifacts.filter((artifact) => {
        const artifactSessionId = String(artifact.metadata?.browserSessionId || '');
        return artifactSessionId !== sessionRecord.id;
      });
      nextMessageToPersist = { ...message, artifacts: [...retainedArtifacts, ...nextArtifacts] };
      return nextMessageToPersist;
    }));
    syncPersistedBotMessage(nextMessageToPersist);

    if (runId) {
      if (replayArtifact?.url) {
        void addArtifact({
          runId,
          circleId,
          artifactKind: 'link_bundle',
          title: replayArtifact.title,
          url: replayArtifact.url,
          metadata: replayArtifact.metadata || {},
        });
      }
      if (screenshotArtifact?.url) {
        void addArtifact({
          runId,
          circleId,
          artifactKind: 'screenshot',
          title: screenshotArtifact.title,
          url: screenshotArtifact.url,
          metadata: screenshotArtifact.metadata || {},
        });
      }
    }
  }, [circleId, syncPersistedBotMessage]);

  const handleLaunchBrowserPlan = useCallback((message: ChatMessage, plan: BrowserPlanCardData) => {
    setPendingComputerUseTask(plan.task);
    const approvalPlan = { ...plan, status: 'approval_requested' as const };
    setPendingComputerUsePlan(approvalPlan);
    setPendingComputerUseGrantSummary('');
    setPendingComputerUseApprovalSummary('');
    setPendingComputerUseGrantIds([]);
    setPendingComputerUseOrigin({ messageId: message.id, runId: message.runId, planId: plan.planId });
    setPendingComputerUseStickyScopeId(null);
    setPendingComputerUseActions(plan.actions.map((action) => ({
      id: action.id,
      type: action.type,
      target: action.target,
      value: action.value,
      description: action.description,
      requiresApproval: action.requiresApproval,
      status: 'pending' as const,
    })));
    setShowComputerUsePermission(true);
    applyBrowserPlanPatch(message.id, plan.planId, { status: 'approval_requested' }, message.runId);
    appendBrowserPlanEvent(message.id, {
      id: `${plan.planId}:approval_requested:${Date.now()}`,
      planId: plan.planId,
      kind: 'approval_requested',
      at: new Date().toISOString(),
      summary: 'User review requested before launching browser plan',
      backend: plan.backend,
      backendLabel: plan.backendLabel,
    }, message.runId);
    addBotMessage(`**Browser Plan Ready** Review permissions to launch: ${plan.task}`, undefined, {
      localOnly: true,
      browserPlans: [approvalPlan],
    });
  }, [appendBrowserPlanEvent, applyBrowserPlanPatch]);

  const handleOpenBrowserSession = useCallback((plan: BrowserPlanCardData) => {
    const event: BrowserPlanEvent = {
      id: `${plan.planId}:opened_live_session:${Date.now()}`,
      planId: plan.planId,
      kind: 'opened_live_session',
      at: new Date().toISOString(),
      summary: 'Opened the live browser session',
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
    };
    const ownerMessage = messages.find((message) => message.browserPlans?.some((entry) => entry.planId === plan.planId));
    if (ownerMessage) {
      appendBrowserPlanEvent(ownerMessage.id, event, ownerMessage.runId);
    }
    if (Platform.OS !== 'web' || !plan.backendLiveUrl) return;
    try {
      window.open(plan.backendLiveUrl, '_blank', 'noopener,noreferrer');
    } catch {}
  }, [appendBrowserPlanEvent, messages]);

  const finalizeBrowserPlanFromSession = useCallback((session: ComputerUseSession, result?: { success: boolean; backendSessionId?: string; backendLiveUrl?: string }) => {
    if (!session.sourceMessageId || !session.sourcePlanId) return;
    const status = result ? (result.success ? 'completed' : 'failed') : 'launched';
    const eventAt = new Date().toISOString();
    const timestampPatch = status === 'launched'
      ? { launchedAt: eventAt }
      : { completedAt: eventAt };
    applyBrowserPlanPatch(
      session.sourceMessageId,
      session.sourcePlanId,
      {
        status,
        backendSessionId: result?.backendSessionId || session.backendSessionId,
        backendLiveUrl: result?.backendLiveUrl || session.backendLiveUrl,
        ...timestampPatch,
      },
      session.sourceRunId,
    );
    appendBrowserPlanEvent(session.sourceMessageId, {
      id: `${session.sourcePlanId}:${status}:${Date.now()}`,
      planId: session.sourcePlanId,
      kind: status,
      at: eventAt,
      summary:
        status === 'launched'
          ? `Browser session launched via ${session.backendLabel}`
          : status === 'completed'
            ? 'Browser plan completed successfully'
            : 'Browser plan failed during execution',
      backend: session.backend,
      backendLabel: session.backendLabel,
      backendSessionId: result?.backendSessionId || session.backendSessionId,
      backendLiveUrl: result?.backendLiveUrl || session.backendLiveUrl,
    }, session.sourceRunId);
    upsertBrowserSessionRecord(
      session.sourceMessageId,
      toBrowserSessionRecord(session, result),
      session.sourceRunId,
    );
    upsertBrowserSessionArtifacts(
      session.sourceMessageId,
      toBrowserSessionRecord(session, result),
      session.sourceRunId,
    );
  }, [appendBrowserPlanEvent, applyBrowserPlanPatch, upsertBrowserSessionArtifacts, upsertBrowserSessionRecord]);

  const runLocalBrowserPlan = useCallback(async (
    plan: BrowserPlanCardData,
    permission: ComputerUsePermission,
    origin: { messageId: string; runId?: string | null; planId: string } | null,
  ) => {
    const session = await createSessionFromBrowserPlan(agentName, permission, plan, {
      circleId,
      sourceMessageId: origin?.messageId,
      sourceRunId: origin?.runId || null,
    });

    const autoRun = permission !== 'ask_every_time';
    const runnable: ComputerUseSession = autoRun
      ? {
          ...session,
          status: 'executing',
          actions: session.actions.map((action) => action.blockedReason
            ? action
            : { ...action, status: 'approved' as const }),
        }
      : session;

    setComputerUseSession(runnable);

    if (!autoRun) {
      addBotMessage('**Computer Use** staged locally. Approve each browser action in the Computer Use panel to run without launching the cloud agent.');
      return;
    }

    finalizeBrowserPlanFromSession(runnable);
    addBotMessage(`**Computer Use** running locally — ${plan.task}`);
    try {
      const result = await executeComputerUsePlan(runnable, (completedAction, idx) => {
        setComputerUseSession((current) => {
          if (!current) return current;
          const nextActions = [...current.actions];
          nextActions[idx] = completedAction;
          return { ...current, actions: nextActions };
        });
      });
      const completedSession: ComputerUseSession = {
        ...runnable,
        status: result.success ? 'completed' : 'failed',
        actions: result.actions,
        currentUrl: result.currentUrl || runnable.currentUrl,
        backendSessionId: result.backendSessionId || runnable.backendSessionId,
        backendLiveUrl: result.backendLiveUrl || runnable.backendLiveUrl,
      };
      setComputerUseSession(completedSession);
      finalizeBrowserPlanFromSession(completedSession, result);
      if (result.success) {
        addBotMessage(`**Computer Use** completed locally: ${result.message}`);
      } else {
        await addRecoverableChatErrorMessage({
          title: '**Computer Use** failed locally',
          task: plan.task,
          error: result.message,
          executionKind: 'local_browser_plan',
          source: 'local_browser_plan_failed',
          touched: ['surface:computer_use', 'surface:local_browser', `computer_task:${plan.task}`],
          messageSource: {
            actor: 'OpenSwan',
            surface: 'main_chat_local_browser_plan_error',
            selectedModel,
            effectiveModel: 'local-browser-plan',
          },
        });
      }
    } catch (error: any) {
      const failedSession: ComputerUseSession = { ...runnable, status: 'failed' };
      setComputerUseSession(failedSession);
      finalizeBrowserPlanFromSession(failedSession, { success: false });
      await addRecoverableChatErrorMessage({
        title: '**Computer Use** failed locally',
        task: plan.task,
        error,
        executionKind: 'local_browser_plan',
        source: 'local_browser_plan_exception',
        touched: ['surface:computer_use', 'surface:local_browser', `computer_task:${plan.task}`],
        messageSource: {
          actor: 'OpenSwan',
          surface: 'main_chat_local_browser_plan_error',
          selectedModel,
          effectiveModel: 'local-browser-plan',
        },
      });
    }
  }, [addBotMessage, addRecoverableChatErrorMessage, agentName, circleId, finalizeBrowserPlanFromSession, selectedModel]);

  const executeLocalComputerAwarenessRequest = async (message: string): Promise<boolean> => {
    const intent = detectLocalComputerAwarenessIntent(message);
    if (!intent.route || !intent.kind) return false;

    const toolMap: Partial<Record<typeof intent.kind, { tool: string; args: Record<string, unknown> }>> = {
      launch_app: { tool: 'desktop.launch_app', args: { appName: intent.appQuery } },
      focus_app: { tool: 'desktop.focus_app', args: { appName: intent.appQuery } },
      browser_tabs: { tool: 'desktop.list_browser_tabs', args: { browsers: intent.browsers } },
      running_apps: { tool: 'desktop.list_running_apps', args: {} },
      window_state: { tool: 'desktop.window_state', args: {} },
      clipboard: { tool: 'desktop.clipboard', args: {} },
    };
    const mapped = toolMap[intent.kind];
    if (!mapped) return false;

    setBotTyping(true);
    setRunStatus('running');
    setCurrentRunStep('Reading local desktop state...');
    try {
      const { executeOpenSwanRuntimeTool } = await import('../../../lib/openswanToolRuntime');
      const result = await executeOpenSwanRuntimeTool(
        mapped.tool as any,
        mapped.args as any,
        {
          circleId,
          userId: currentUserId || 'anonymous',
          threadId: activeThreadId || undefined,
          surface: 'main_chat',
          activePluginIds: activePlugins,
        },
      ) as any;
      const text = String(result?.resultsText || result?.resultText || result?.error || 'No local desktop result returned.');
      const status = result?.ok ? 'passed' : 'failed';
      const toolEvent: OpenSwanToolEvent = {
        tool: mapped.tool as any,
        status,
        summary: text,
        metadata: {
          source: 'local_desktop_awareness_short_circuit',
          intentKind: intent.kind,
        },
      };
      addBotMessage(text, undefined, {
        localOnly: true,
        source: {
          actor: 'OpenSwan',
          surface: 'main_chat_desktop_bridge',
          selectedModel,
          effectiveModel: 'local-desktop-bridge',
        },
        toolEvents: [toolEvent],
        executionStream: buildOpenSwanExecutionStream({ toolEvents: [toolEvent], verificationResults: [] }),
      });
      return true;
    } catch (err: any) {
      await addRecoverableChatErrorMessage({
        title: 'Local desktop bridge failed',
        task: message,
        error: err,
        executionKind: 'local_desktop_awareness',
        source: 'local_desktop_bridge_error',
        touched: ['surface:desktop_bridge', `desktop_intent:${intent.kind}`],
        messageSource: {
          actor: 'OpenSwan',
          surface: 'main_chat_desktop_bridge_error',
          selectedModel,
          effectiveModel: 'local-desktop-bridge',
        },
      });
      return true;
    } finally {
      setBotTyping(false);
      setRunStatus('idle');
      setCurrentRunStep('');
    }
  };

  // ─── Send Crypto ──────────────────────────────────────────────────────────

  const handleSendCrypto = async () => {
    if (!sendTo.trim() || !sendAmount.trim()) return;
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      addBotMessage("Invalid amount. Enter a number greater than 0.");
      return;
    }

    setSendingCrypto(true);
    const {
      connectWallet,
      getExplorerUrl,
      getMemberByUsername,
      sendETH,
      sendSOL,
    } = await import('../../../lib/crypto');

    // Check if wallet is connected
    let activeWallet = wallet;
    if (!activeWallet) {
      addBotMessage("No wallet connected. Connecting...");
      try {
        const wallets = { metamask: !!(window as any)?.ethereum, phantom: !!(window as any)?.solana?.isPhantom };
        if (wallets.metamask) {
          activeWallet = await connectWallet('metamask');
        } else if (wallets.phantom) {
          activeWallet = await connectWallet('phantom');
        } else {
          addBotMessage("No wallet extension found. Install **MetaMask** or **Phantom** to send crypto.");
          setSendingCrypto(false);
          return;
        }
        setWallet(activeWallet);
      } catch (e: any) {
        addBotMessage('I could not connect the wallet. Check the wallet popup and try again.');
        setSendingCrypto(false);
        return;
      }
    }

    // Resolve recipient
    let toAddress = sendTo.trim();
    let recipientName = toAddress;

    if (!toAddress.startsWith('0x') && !toAddress.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      const member = await getMemberByUsername(toAddress.replace('@', ''));
      if (member?.wallet_address) {
        toAddress = member.wallet_address;
        recipientName = member.display_name || toAddress;
      } else {
        addBotMessage(`Can't find wallet for **@${toAddress}**. They need to connect a wallet first, or paste their address directly.`);
        setSendingCrypto(false);
        return;
      }
    }

    const chain = activeWallet.chain;
    const symbol = chain === 'ethereum' ? 'ETH' : 'SOL';

    addUserMessage(`💸 Sending **${amount} ${symbol}** to **${recipientName}**...`);

    const result = chain === 'ethereum'
      ? await sendETH(toAddress, amount)
      : await sendSOL(toAddress, amount);

    if (result.success) {
      const explorerUrl = getExplorerUrl(result.txHash!, chain);
      addBotMessage(`✅ **Sent ${amount} ${symbol}** to ${shortenAddress(toAddress)}!\n\n🔗 [View on ${chain === 'ethereum' ? 'Etherscan' : 'Solscan'}](${explorerUrl})\n\nTx: \`${shortenAddress(result.txHash!)}\`\n\n💪 Money moves.`);
      
      // Trigger celebration effect
      setTimeout(() => triggerParticleEffect(300, 200), 500);
    } else {
      addBotMessage('I could not finish the transaction. Check your wallet and try again.');
    }

    setSendingCrypto(false);
    setShowSendCrypto(false);
    setSendTo('');
    setSendAmount('');
  };

  // ─── Send Message ────────────────────────────────────────────────────────

  const stageUploadedFilesForDesktopTask = useCallback(async (
    requestText: string,
    mediaAttachments: ChatAttachment[],
    stagedUploads: StagedFile[],
  ): Promise<StagedDesktopAttachment[]> => {
    const staged: StagedDesktopAttachment[] = [];
    const groupId = buildDesktopAttachmentStageGroupName(requestText);

    for (const upload of stagedUploads) {
      let sourceUrl: string | null = null;
      if (upload.attachment?.storagePath) {
        sourceUrl = await getSignedUrl(upload.attachment.storagePath);
      }
      if (!sourceUrl) {
        throw new Error(`"${upload.name}" is not ready to stage locally yet. Wait for upload to finish, then send again.`);
      }
      const result = await stageAttachmentForDesktop({
        filename: upload.name,
        mimeType: upload.mimeType,
        sourceUrl,
        groupId,
      });
      if (!result.ok || !result.data?.path) {
        throw new Error(`Could not stage "${upload.name}" for desktop apps: ${result.error || result.errorCode || 'unknown bridge error'}`);
      }
      const candidate = stagedFileDesktopCandidate(upload);
      staged.push({
        ...candidate,
        localPath: result.data.path,
        stageDirectory: result.data.directory || null,
        sha256: result.data.sha256 || null,
        sizeBytes: result.data.sizeBytes || candidate.sizeBytes,
        appName: inferDesktopAppForAttachment(candidate, requestText),
      });
    }

    for (const attachment of mediaAttachments) {
      const sourceUrl = attachment.uploadedUrl || null;
      const base64 = sourceUrl ? null : await base64FromChatMediaAttachment(attachment);
      if (!sourceUrl && !base64) {
        throw new Error(`Could not read "${attachment.name}" for desktop staging.`);
      }
      const result = await stageAttachmentForDesktop({
        filename: attachment.name,
        mimeType: attachment.mimeType,
        sourceUrl,
        base64,
        groupId,
      });
      if (!result.ok || !result.data?.path) {
        throw new Error(`Could not stage "${attachment.name}" for desktop apps: ${result.error || result.errorCode || 'unknown bridge error'}`);
      }
      const candidate = mediaAttachmentDesktopCandidate(attachment);
      staged.push({
        ...candidate,
        localPath: result.data.path,
        stageDirectory: result.data.directory || null,
        sha256: result.data.sha256 || null,
        sizeBytes: result.data.sizeBytes || candidate.sizeBytes,
        appName: inferDesktopAppForAttachment(candidate, requestText),
      });
    }

    if (staged.length > 0) {
      try {
        const manifest = buildDesktopAttachmentPackageManifest(requestText, staged);
        const manifestResult = await stageAttachmentManifestForDesktop({ groupId, manifest });
        if (manifestResult.ok && manifestResult.data?.path) {
          for (const attachment of staged) {
            attachment.manifestPath = manifestResult.data.path;
            attachment.stageDirectory = attachment.stageDirectory || manifestResult.data.directory;
          }
        }
      } catch {
        // The manifest is a recovery aid. The staged files and exact task prompt
        // are still sufficient to run if an older bridge lacks this endpoint.
      }
    }

    return staged;
  }, []);

  const sendMessage = async (
    overrideText?: string,
    options?: {
      displayText?: string;
      modeOverride?: string | null;
      modelOverride?: string | null;
    },
  ) => {
    if (sendLockRef.current) return;
    const requestedContent = (overrideText || input).trim();
    const hasPendingAttachments = attachments.length > 0 || stagedFiles.length > 0;
    const content = requestedContent || (hasPendingAttachments ? 'Open the attached file.' : '');
    if (!content) return;
    const effectiveChatMode = options?.modeOverride || chatMode;
    const effectivePlanActMode: 'plan' | 'act' = effectiveChatMode === 'plan' ? 'plan' : 'act';
    const effectiveSelectedModel = options?.modelOverride && options.modelOverride !== 'auto'
      ? options.modelOverride
      : selectedModel;

    // ── Resume a pending clarification ──────────────────────────────────────
    // If we recently asked the user for a missing detail, treat this reply as
    // the answer: reconstruct a well-specified request and route THAT, while
    // still displaying the user's actual words. Cancel words abort cleanly.
    if (!overrideText?.startsWith('__') && !content.startsWith('/') && !resolvingClarificationRef.current) {
      const clarifyKey = activeThreadId || 'main';
      const pendingClarify = pendingClarificationRef.current.get(clarifyKey);
      if (pendingClarify) {
        pendingClarificationRef.current.delete(clarifyKey);
        persistPendingClarifications();
        const fresh = Date.now() - pendingClarify.askedAt < 15 * 60 * 1000;
        const cancelled = /\b(nevermind|never\s*mind|cancel|forget it|forget that|skip it|no thanks|stop)\b/i.test(content);
        // A reply ending in "?" is almost certainly a new question, not the
        // answer to ours — don't fold it into the pending task; let it route
        // normally (safe failure: the user can just re-state the task).
        const looksLikeNewQuestion = /\?\s*$/.test(content);
        if (fresh && !cancelled && !looksLikeNewQuestion) {
          const synthetic = reconstructClarificationAnswer(
            pendingClarify.pendingIntent,
            pendingClarify.originalMessage,
            content,
          );
          if (synthetic && synthetic.trim() && synthetic.trim() !== content.trim()) {
            resolvingClarificationRef.current = true;
            try {
              await sendMessage(synthetic, { displayText: content });
            } finally {
              resolvingClarificationRef.current = false;
            }
            return;
          }
        }
        // stale / cancelled / nothing to build → fall through and treat the
        // reply as a normal message (the pending entry is already cleared).
      }
    }

    // ── Booking follow-up seam ("book option 2") ────────────────────────────
    // WI-5: after the clarification collision guard and before the automation
    // planner, see whether this reply is a pick against the last browser run's
    // findings. Runs ONLY when a prior computer run left durable findings (or a
    // live confirmation is open) — matchBookingFollowup fails closed to none
    // for unrelated chat, so a false positive can't hijack a normal message.
    if (
      !overrideText?.startsWith('__')
      && !content.startsWith('/')
      && !resolvingClarificationRef.current
    ) {
      // Reconstruct lastComputerRun from the most recent completion message
      // that carried persisted structured findings (survives reload) plus the
      // live task state (session id / open confirmation).
      const findingsMessage = [...messages].reverse().find(
        (m) => m.isBot && m.computerFindings && (m.computerFindings.items?.length || 0) > 0,
      );
      const livePending = computerUseTask.state.pendingConfirmation;
      const livePendingId = livePending?.id || null;
      const runAlive = computerUseTask.state.status === 'running'
        || computerUseTask.state.status === 'starting';
      // Decline the mirrored mid-run (pay/book) confirmation: a clear "No"
      // while a confirmation is live resolves it negatively. matchBookingFollowup
      // only maps affirmatives/selections, so handle the decline here so the
      // "No" chip on the confirmation bubble cleanly stops the run at the floor.
      if (runAlive && livePendingId
        && /^(n|no|nope|cancel|stop|don'?t|do not|abort|decline|not now)\b/i.test(content.trim())) {
        addUserMessage((options?.displayText || content).trim());
        setInput('');
        setReplyTo(null);
        try {
          await resolveComputerUseConfirmation(livePendingId, 'no');
        } catch {
          addBotMessage('I could not record that. Try again in a moment.', undefined, { localOnly: true });
        }
        return;
      }
      const lastComputerRun: BookingFollowupLastRun | null = findingsMessage?.computerFindings || livePendingId
        ? {
            runId: findingsMessage?.computerFindings?.runId
              ?? findingsMessage?.runId
              ?? null,
            sessionId: findingsMessage?.computerFindings?.sessionId
              ?? computerUseTask.state.sessionId
              ?? null,
            findings: findingsMessage?.computerFindings?.items || null,
            // Case A only fires while a confirmation is live; once terminal we
            // leave this null so Case B (synthesize + continue session) fires.
            pendingConfirmationId: runAlive ? livePendingId : null,
            completedAt: runAlive ? null : (findingsMessage ? Date.now() : null),
          }
        : null;
      if (lastComputerRun) {
        const followup = matchBookingFollowup(content, lastComputerRun);
        if (followup.kind === 'resolve_confirmation') {
          addUserMessage((options?.displayText || content).trim());
          setInput('');
          setReplyTo(null);
          try {
            await resolveComputerUseConfirmation(followup.confirmationId, followup.choice);
          } catch {
            addBotMessage('I could not record that booking choice. Try again in a moment.', undefined, { localOnly: true });
          }
          return;
        }
        if (followup.kind === 'continue_session') {
          addUserMessage((options?.displayText || content).trim());
          setInput('');
          setReplyTo(null);
          const started = await computerUseTask.run(followup.task, {
            sessionId: followup.sessionId ?? undefined,
            booking: true,
            model: resolveSendModel(followup.task) || undefined,
          });
          if (!started.started) {
            addBotMessage('I could not continue that booking run. The browser session may have expired — say "book" again to start fresh.', undefined, { localOnly: true });
          } else {
            addBotMessage('Continuing the booking run — live view', undefined, { localOnly: true });
          }
          return;
        }
        // kind === 'none' → fall through to normal routing untouched.
      }
    }

    const recoverySelectionForDisplay = options?.displayText
      ? null
      : parseChatFailureRecoveryOptionSelection(content);
    const displayContent = (options?.displayText || (recoverySelectionForDisplay
      ? formatChatRecoveryActionDisplayText(
          recoverySelectionForDisplay,
          buildChatRecoveryActionIntent(recoverySelectionForDisplay, {
            sourceSurface: recoverySelectionForDisplay.context?.sourceSurface || null,
            platform: Platform.OS,
          }),
        )
      : content)).trim();
    sendLockRef.current = true;
    setTimeout(() => { sendLockRef.current = false; }, 350);

    // Handle special actions
    if (content === '__SEND_CRYPTO__') {
      setShowSendCrypto(true);
      return;
    }
    if (content === '__TIP__') {
      setShowSendCrypto(true);
      setSendAmount('0.001');
      return;
    }
    if (content === '__SPAWN_AGENT__' || content === '__SPAWN_AGENTS__') {
      setSpawnModalOpen(true);
      return;
    }

    // Capture current attachments before clearing
    const currentAttachments = [...attachments];
    const currentStagedFiles = [...stagedFiles];
    const desktopAttachmentCandidates = [
      ...currentAttachments.map(mediaAttachmentDesktopCandidate),
      ...currentStagedFiles
        .filter((file) => !file.error)
        .map(stagedFileDesktopCandidate),
    ];
    const shouldRunDesktopAttachmentTask = shouldRouteAttachedFilesToDesktop(content, desktopAttachmentCandidates);
    if (shouldRunDesktopAttachmentTask) {
      const uploading = currentStagedFiles.find((file) => file.uploading || (!file.attachment && !file.error));
      if (uploading) {
        addBotMessage(`**${uploading.name}** is still uploading. Send again after the upload finishes so I can stage it for the desktop app.`, undefined, { localOnly: true });
        return;
      }
      const failed = currentStagedFiles.find((file) => file.error);
      if (failed) {
        addBotMessage(`**${failed.name}** did not upload cleanly. Remove it or upload it again before I open it in a desktop app.`, undefined, { localOnly: true });
        return;
      }
      setBotTyping(true);
      try {
        const stagedDesktopAttachments = await stageUploadedFilesForDesktopTask(content, currentAttachments, currentStagedFiles);
        const desktopTask = buildDesktopAttachmentComputerTask(content, stagedDesktopAttachments);
        addUserMessage(displayContent);
        setInput('');
        setAttachments([]);
        setStagedFiles([]);
        revokeStagedPreviews(currentStagedFiles);
        setReplyTo(null);
        setExpandedCategory(null);
        if (profileRef.current) {
          profileRef.current = updateProfileFromMessage(profileRef.current, displayContent, true);
          saveUserProfile(profileRef.current).catch(() => {});
        }
        recordChatActivity(circleId, 'message').catch(() => {});
        if (content.startsWith('/')) {
          recordChatActivity(circleId, 'slash').catch(() => {});
        }
        await executeSharedComputerTask(desktopTask, { planPrefix: 'Use uploaded desktop file: ' });
      } catch (error: any) {
        await addRecoverableChatErrorMessage({
          title: 'Uploaded file desktop task failed',
          task: `Open and edit uploaded chat file(s): ${content.slice(0, 240)}`,
          error,
          executionKind: 'uploaded_desktop_file_task',
          source: 'chat_uploaded_desktop_file_task',
          touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/chatDesktopAttachmentRouting.ts', 'src/lib/desktopBridge.ts', 'scripts/claude-bridge.js'],
        });
      } finally {
        setBotTyping(false);
      }
      return;
    }
    const resolvedFigmaRefs = (currentUserId && (currentAttachments.some((attachment) => attachment.isFigma) || /figma\.com\//i.test(content)))
      ? await resolveFigmaReferences({
          message: content,
          attachments: currentAttachments,
          circleId,
          userId: currentUserId,
        })
      : [];
    const nextSelectedFigmaRefId = resolvedFigmaRefs.some((ref) => ref.id === selectedBuilderFigmaRefId)
      ? selectedBuilderFigmaRefId
      : (resolvedFigmaRefs[0]?.id || null);
    const figmaPromptContext = buildFigmaPromptFromReferences(resolvedFigmaRefs, nextSelectedFigmaRefId);
    setBuilderFigmaRefs(resolvedFigmaRefs);
    setSelectedBuilderFigmaRefId(nextSelectedFigmaRefId);

    // Add user message immediately
    const userMessage = addUserMessage(displayContent);
    setInput('');
    setAttachments([]);
    setStagedFiles([]);
    revokeStagedPreviews(currentStagedFiles);
    setReplyTo(null);
    setExpandedCategory(null);

    // Track user message in behavior profile
    if (profileRef.current) {
      profileRef.current = updateProfileFromMessage(profileRef.current, displayContent, true);
      saveUserProfile(profileRef.current).catch(() => {});
    }
    recordChatActivity(circleId, 'message').catch(() => {});
    if (content.startsWith('/')) {
      recordChatActivity(circleId, 'slash').catch(() => {});
    }
    const lowerContent = content.toLowerCase().trim();
    const directRecoverySelection = parseChatFailureRecoveryOptionSelection(content);
    if (isDesktopBridgeRecoverySelection(directRecoverySelection)) {
      setBotTyping(true);
      try {
        await addDesktopBridgeAutoConnectMessage(directRecoverySelection?.context?.sourceSurface || 'desktop_bridge_recovery');
      } catch (error: any) {
        await addRecoverableChatErrorMessage({
          title: 'Desktop bridge recovery failed',
          task: 'Start or repair the local desktop bridge from chat',
          error,
          executionKind: 'desktop_bridge_recovery',
          source: 'desktop_bridge_direct_recovery_error',
          touched: ['src/lib/desktopBridgeAutoConnect.ts', 'src/lib/desktopBridge.ts', 'scripts/claude-bridge.js'],
        });
      } finally {
        setBotTyping(false);
      }
      return;
    }

    if (isLastTaskModelQuestion(content)) {
      addBotMessage(describeLastTaskModel(messages), undefined, {
        localOnly: true,
        source: {
          actor: 'OpenSwan',
          surface: 'main_chat_model_audit',
          selectedModel,
          effectiveModel: 'local-chat-state',
        },
      });
      return;
    }

    // ─── Terminal agent control ────────────────────────────────────────────
    // Handles "/agents", "/agent Codex #1 ...", and natural language like
    // "tell Codex #1 to check the auth flow" before broader automation
    // routing has a chance to spawn a new task.
    try {
      const terminalAgentControl = await executeTerminalAgentControlFromChat(content);
      if (terminalAgentControl) {
        addBotMessage(terminalAgentControl.message, undefined, { localOnly: true });
        return;
      }
    } catch (err: any) {
      await addRecoverableChatErrorMessage({
        title: 'Terminal agent control error',
        task: content,
        error: err,
        executionKind: 'terminal_agent_control',
        source: 'terminal_agent_control_error',
        touched: ['surface:terminal_agent', 'surface:main_chat'],
      });
      return;
    }

    // ─── Terminal agent launcher ───────────────────────────────────────────
    // Handles natural language like "start 10 separate Claude Code sessions"
    // before the generic computer-use planner treats it as a terminal task.
    try {
      const terminalAgentLaunch = await executeTerminalAgentLaunchFromChat(content, {
        circleId,
        userId: currentUserId || undefined,
      });
      if (terminalAgentLaunch) {
        addBotMessage(terminalAgentLaunch.message, undefined, { localOnly: true });
        setTimeout(() => {
          void refreshAssignableAgentsRef.current?.();
        }, 1500);
        return;
      }
    } catch (err: any) {
      await addRecoverableChatErrorMessage({
        title: 'Terminal agent launch error',
        task: content,
        error: err,
        executionKind: 'terminal_agent_launch',
        source: 'terminal_agent_launch_error',
        touched: ['surface:terminal_agent', 'surface:main_chat'],
      });
      return;
    }

    // ─── Automation builder intercept ──────────────────────────────────────
    // Detect "every X at Y do Z" / "when X happens do Y" — present an
    // AutomationProposalCard the user can confirm. Falls through to LLM
    // when the parser doesn't recognize the input as an automation
    // request, so normal chat is unaffected.
    if (!content.startsWith('/')) {
      const proposal = parseAutomationRequest(content);
      if (proposal) {
        addBotMessage(
          `I think you want to set up an automation. Confirm and I'll create it.`,
          undefined,
          { localOnly: true, automationProposal: proposal },
        );
        return;
      }
    }

    // ─── Multi-agent dispatch intercept ────────────────────────────────────
    // Supports /multi, /roundtable, leading @mentions, and natural
    // "ask all Codex agents to..." fan-outs across OpenSwan + bridge agents.
    const multiAgentPlan = parseMultiAgentOrchestrationRequest(content, liveAgents);
    if (multiAgentPlan) {
      if (multiAgentPlan.kind === 'help') {
        addBotMessage(formatMultiAgentHelp(liveAgents, multiAgentPlan.reason), undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'multi_agent_help',
            selectedModel: selectedModel || null,
          },
        });
        return;
      }

      const targets = multiAgentPlan.targetIds
        .map(id => liveAgents.find(agent => agent.id === id))
        .filter((agent): agent is AssignableAgent => !!agent);
      if (targets.length < 2) {
        addBotMessage(formatMultiAgentHelp(liveAgents, 'Need at least two available agents for a multi-agent run.'), undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'multi_agent_help',
            selectedModel: selectedModel || null,
          },
        });
        return;
      }

      const strategySurface = multiAgentPlan.strategy === 'roundtable'
        ? 'multi_agent_roundtable'
        : multiAgentPlan.strategy === 'sequential'
          ? 'multi_agent_chain'
          : multiAgentPlan.strategy === 'debate'
            ? 'multi_agent_debate'
            : 'multi_agent_dispatch';
      const strategyLabel = formatMultiAgentStrategyLabel(multiAgentPlan.strategy);
      const startVerb = multiAgentPlan.strategy === 'roundtable'
        ? 'Starting agent roundtable'
        : multiAgentPlan.strategy === 'sequential'
          ? 'Starting agent chain'
          : multiAgentPlan.strategy === 'debate'
            ? 'Starting agent debate'
            : 'Dispatching multi-agent run';
      const skipped = multiAgentPlan.truncatedCount > 0
        ? ` (${multiAgentPlan.truncatedCount} more skipped to stay within the safety cap)`
        : '';
      addBotMessage(
        `${startVerb} to ${targets.length} agents: ${targets.map(t => '@' + t.name).join(' ')}${skipped}`,
        undefined,
        {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: strategySurface,
            selectedModel: selectedModel || null,
          },
        },
      );
      setBotTyping(true);

      type MultiAgentChatResult = { agent: AssignableAgent; ok: boolean; reply: string };
      const addMultiAgentReply = (result: MultiAgentChatResult) => {
        addBotMessage(result.reply, undefined, {
          source: {
            actor: result.agent.name,
            surface: `${strategySurface}_reply`,
            selectedModel: result.agent.model || selectedModel || null,
            provider: result.agent.provider || null,
          },
        });
      };
      const addMultiAgentCompletion = (results: MultiAgentChatResult[]) => {
        addBotMessage(
          formatMultiAgentRunSummary(multiAgentPlan, results.map(result => ({
            agentName: result.agent.name,
            provider: result.agent.provider,
            ok: result.ok,
            replyPreview: result.reply,
          }))),
          undefined,
          {
            localOnly: true,
            source: {
              actor: 'OpenSwan',
              surface: `${strategySurface}_complete`,
              selectedModel: selectedModel || null,
            },
          },
        );
      };

      if (multiAgentPlan.strategy === 'sequential') {
        (async () => {
          const results: MultiAgentChatResult[] = [];
          let priorContext = '';
          for (let index = 0; index < targets.length; index += 1) {
            const agent = targets[index];
            try {
              const task = buildMultiAgentDispatchPrompt(multiAgentPlan, agent, index, priorContext);
              const reply = await dispatchAssignedAgentTask(agent, task);
              const result = { agent, ok: true, reply };
              results.push(result);
              addMultiAgentReply(result);
              priorContext = [
                priorContext,
                `Agent: ${agent.name}`,
                reply.slice(0, 3000),
              ].filter(Boolean).join('\n\n');
            } catch (err: any) {
              const result = { agent, ok: false, reply: `**${agent.name}** error: ${err?.message || 'unknown'}` };
              results.push(result);
              addMultiAgentReply(result);
              priorContext = [
                priorContext,
                `Agent: ${agent.name}`,
                `Blocked: ${err?.message || 'unknown error'}`,
              ].filter(Boolean).join('\n\n');
            }
          }
          setBotTyping(false);
          addMultiAgentCompletion(results);
        })().catch((err: any) => {
          setBotTyping(false);
          void addRecoverableChatErrorMessage({
            title: `Multi-agent ${strategyLabel} failed`,
            task: content,
            error: err,
            executionKind: 'multi_agent_dispatch',
            source: `${strategySurface}_error`,
            touched: ['surface:multi_agent', 'surface:main_chat'],
            messageSource: {
              actor: 'OpenSwan',
              surface: `${strategySurface}_error`,
              selectedModel: selectedModel || null,
            },
          });
        });
        return;
      }

      Promise.allSettled(
        targets.map(async (agent, index) => {
          try {
            const task = buildMultiAgentDispatchPrompt(multiAgentPlan, agent, index);
            const reply = await dispatchAssignedAgentTask(agent, task);
            return { agent, ok: true, reply };
          } catch (err: any) {
            return { agent, ok: false, reply: `**${agent.name}** error: ${err?.message || 'unknown'}` };
          }
        }),
      ).then((settled) => {
        setBotTyping(false);
        const results: MultiAgentChatResult[] = [];
        for (let index = 0; index < settled.length; index += 1) {
          const s = settled[index];
          if (s.status === 'fulfilled') {
            results.push(s.value);
            addMultiAgentReply(s.value);
          } else {
            const agent = targets[index];
            if (agent) {
              const result = { agent, ok: false, reply: `**${agent.name}** error: ${String(s.reason)}` };
              results.push(result);
              addMultiAgentReply(result);
            } else {
              void addRecoverableChatErrorMessage({
                title: `Multi-agent ${strategyLabel} error`,
                task: content,
                error: s.reason,
                executionKind: 'multi_agent_dispatch',
                source: `${strategySurface}_error`,
                touched: ['surface:multi_agent', 'surface:main_chat'],
                messageSource: {
                  actor: 'OpenSwan',
                  surface: `${strategySurface}_error`,
                  selectedModel: selectedModel || null,
                },
              });
            }
          }
        }
        addMultiAgentCompletion(results);
      }).catch((err: any) => {
        setBotTyping(false);
        void addRecoverableChatErrorMessage({
          title: `Multi-agent ${strategyLabel} failed`,
          task: content,
          error: err,
          executionKind: 'multi_agent_dispatch',
          source: `${strategySurface}_error`,
          touched: ['surface:multi_agent', 'surface:main_chat'],
          messageSource: {
            actor: 'OpenSwan',
            surface: `${strategySurface}_error`,
            selectedModel: selectedModel || null,
          },
        });
      });
      return;
    }

    // ─── Selected connected-agent route ─────────────────────────────────────
    // The OpenSwan composer button can pin a connected agent for the next chat
    // turns. Slash commands and explicit multi-agent requests still keep their
    // deterministic handlers; ordinary task text goes to the selected agent.
    if (!content.startsWith('/') && selectedChatAgentTarget && !isOpenSwanChatAgentTarget(selectedChatAgentTarget)) {
      if (!selectedChatAgentTarget.connected || !selectedChatAgentTarget.agent) {
        addBotMessage(buildChatAgentSetupMessage(selectedChatAgentTarget), undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'selected_chat_agent_setup',
            provider: selectedChatAgentTarget.provider,
            selectedModel: selectedModel || null,
          },
        });
        return;
      }

      const selectedDispatchAgent = selectedChatAgentTarget.agent as AssignableAgent;
      setBotTyping(true);
      try {
        const response = await dispatchAssignedAgentTask(selectedDispatchAgent, content);
        addBotMessage(response, undefined, {
          source: {
            actor: selectedDispatchAgent.name,
            surface: 'selected_chat_agent_dispatch',
            provider: selectedDispatchAgent.provider,
            selectedModel: selectedDispatchAgent.model || selectedModel || null,
          },
        });
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: `**${selectedDispatchAgent.name}** failed`,
          task: content,
          error: err,
          executionKind: 'selected_chat_agent_dispatch',
          source: 'selected_chat_agent_dispatch_error',
          touched: ['surface:main_chat', 'surface:selected_agent', 'src/lib/bridgeTaskDispatcher.ts', 'src/lib/customAgentBridgeDispatcher.ts', 'scripts/cursor-bridge.js'],
          messageSource: {
            actor: selectedDispatchAgent.name,
            surface: 'selected_chat_agent_dispatch_error',
            provider: selectedDispatchAgent.provider,
            selectedModel: selectedDispatchAgent.model || selectedModel || null,
          },
        });
      } finally {
        setBotTyping(false);
        setTimeout(() => {
          void refreshAssignableAgentsRef.current?.();
        }, 1500);
      }
      return;
    }

    // ─── Slash intercepts (pure lib calls, no planner) ──────────────────────
    // These run before the model / planner so users see instant feedback
    // for read/write ops that don't need a full agent turn.
    if (content.startsWith('/v2')) {
      try {
        const { parseSwanbotV2Command, applySwanbotV2Command } = await import('../../../lib/swanbotRouting');
        const parsed = parseSwanbotV2Command(content);
        if (parsed) {
          const { message } = applySwanbotV2Command(parsed.action);
          addBotMessage(message, undefined, { localOnly: true });
          return;
        }
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: 'SwanBot v2 router error',
          task: content,
          error: err,
          executionKind: 'swanbot_v2_router',
          source: 'swanbot_v2_router_error',
          touched: ['surface:main_chat', 'runtime:swanbot_v2'],
        });
        return;
      }
    }
    if (lowerContent.startsWith('/memory-bank') || lowerContent.startsWith('/mb')) {
      try {
        const { executeMemoryBankCommand } = await import('../../../lib/memoryBankChatCommands');
        const outcome = await executeMemoryBankCommand(content, {
          circleId,
          userId: currentUserId || 'anonymous',
        });
        if (outcome) {
          // Plan §2c: destructive memory-bank writes get a live Restore
          // strip (rendered above the composer) instead of a prose-only id.
          if (outcome.checkpointId) setLatestMemoryCheckpointId(outcome.checkpointId);
          addBotMessage(outcome.message, undefined, { localOnly: true });
          return;
        }
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: 'Memory Bank error',
          task: content,
          error: err,
          executionKind: 'memory_bank_command',
          source: 'memory_bank_command_error',
          touched: ['surface:main_chat', 'surface:memory_bank'],
        });
        return;
      }
    }
    // UC-4: /record + /replay — capture a workflow once, fire it later.
    // Runs before the planner so the recording observer isn't racing.
    if (content.startsWith('/record') || content.startsWith('/replay')) {
      try {
        const { isRecordingCommand, executeRecordingCommand } = await import('../../../lib/recordingChatCommands');
        if (isRecordingCommand(content)) {
          const { fireClientTool } = await import('../../../lib/swanbot');
          const outcome = await executeRecordingCommand(content, {
            circleId,
            userId: currentUserId || 'anonymous',
            fireTool: fireClientTool,
          });
          if (outcome) {
            addBotMessage(outcome.message, undefined, { localOnly: true });
            return;
          }
        }
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: 'Recording command failed',
          task: content,
          error: err,
          executionKind: 'recording_command',
          source: 'recording_command_error',
          touched: ['surface:main_chat', 'surface:recording'],
        });
        return;
      }
    }
    // /desktop diag — full bridge health checklist so users can tell
    // WHICH layer is broken when "open zoom" misbehaves. Runs a real
    // launch against a sample app name if they pass one.
    if (content.startsWith('/desktop')) {
      try {
        const rest = content.replace(/^\/desktop\s*/i, '').trim();
        const wantsDiag = /^diag(nose)?\b/i.test(rest) || rest === '' || rest === 'health';
        if (wantsDiag) {
          const sampleArg = rest.replace(/^diag(nose)?\s*/i, '').replace(/^health\s*/i, '').trim();
          const { runDesktopBridgeDiag, renderDesktopBridgeDiag } = await import('../../../lib/desktopBridgeDiag');
          const result = await runDesktopBridgeDiag(sampleArg || undefined);
          addBotMessage(renderDesktopBridgeDiag(result), undefined, { localOnly: true });
          return;
        }
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: 'Desktop diag failed',
          task: content,
          error: err,
          executionKind: 'desktop_diag',
          source: 'desktop_diag_error',
          touched: ['surface:main_chat', 'surface:desktop_bridge'],
        });
        return;
      }
    }

    if (content.startsWith('/automation') || content.startsWith('/automations')) {
      try {
        const { executeAutomationCommand } = await import('../../../lib/automationChatCommands');
        const outcome = await executeAutomationCommand(content, {
          circleId,
          userId: currentUserId || 'anonymous',
        });
        if (outcome) {
          addBotMessage(outcome.message, undefined, { localOnly: true });
          return;
        }
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: 'Automation command error',
          task: content,
          error: err,
          executionKind: 'automation_command',
          source: 'automation_command_error',
          touched: ['surface:main_chat', 'surface:automation'],
        });
        return;
      }
    }

    if (activeThreadId) {
      void (async () => {
        try {
          const thread = await getThread(activeThreadId);
          if (!thread || thread.visibility === 'circle' || !isAutoNamedSession(thread.title)) return;
          const nextTitle = deriveSessionTitleFromMessage(content);
          if (!nextTitle || nextTitle === thread.title) return;
          await renameThread(thread.id, nextTitle);
          handleThreadMetaChanged();
        } catch (err) {
          console.warn('[ChatTab] auto-title failed:', err);
        }
      })();
    }

    // ─── Agent Plan Mode ─────────────────────────────────────────────────────
    // Plan mode is first-class now: Chat classifies the request, SwanBot
    // stays in planner posture, OpenSwan contributes tools/verification,
    // and the result is persisted for Office/run-ledger handoff.
    if (shouldCreateAgentPlanForMessage(content, effectiveChatMode)) {
      const explicitPlanTask = content.replace(/^\/plan\s*/i, '').trim();
      const taskText = lowerContent.startsWith('/plan') ? explicitPlanTask : content;
      if (!taskText) {
        addBotMessage('Plan mode is on. Send `/plan <task>` or type the task you want me to plan before execution.', undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'agent_plan_mode_help',
            selectedModel: selectedModel || null,
            effectiveModel: 'agent-plan-mode-v1',
          },
        });
        return;
      }

      setBotTyping(true);
      try {
        const draft = buildAgentPlanDraft({
          task: taskText,
          selectedMode: 'plan',
          selectedModel: effectiveSelectedModel || null,
          threadId: activeThreadId || null,
          sourceMessageId: userMessage.id,
          circleId,
          createdBy: currentUserId || null,
        });
        const saved = currentUserId
          ? await saveAgentPlanDraft({
              circleId,
              userId: currentUserId,
              threadId: activeThreadId || null,
              sourceMessageId: userMessage.id,
              draft,
            })
          : {
              ok: false as const,
              plan: draft,
              error: 'Sign in to save agent plans to the database.',
              code: 'auth_missing',
            };
        const planForChat = saved.ok ? saved.plan : saved.plan;
        const warning = saved.ok
          ? saved.warnings.join(' ')
          : saved.error;
        const contentForChat = formatAgentPlanForChat(planForChat, {
          persisted: saved.ok,
          persistenceWarning: warning || null,
        });
        addBotMessage(contentForChat, undefined, {
          localOnly: !saved.ok,
          agentPlan: planForChat,
          source: {
            actor: 'OpenSwan',
            surface: 'agent_plan_mode',
            selectedModel: selectedModel || null,
            effectiveModel: 'agent-plan-mode-v1',
          },
        });
      } catch (err: any) {
        await addRecoverableChatErrorMessage({
          title: 'Agent Plan Mode failed',
          task: content,
          error: err,
          executionKind: 'agent_plan_mode',
          source: 'agent_plan_mode_error',
          touched: ['surface:main_chat', 'surface:agent_plan_mode'],
          messageSource: {
            actor: 'OpenSwan',
            surface: 'agent_plan_mode_error',
            selectedModel: selectedModel || null,
            effectiveModel: 'agent-plan-mode-v1',
          },
        });
      } finally {
        setBotTyping(false);
      }
      return;
    }

    // ─── Conversational intent routing (natural language → actions) ─────────
    // Catches "post this to WordPress", "create a task", "remember that...", etc.
    // Only fires for non-slash-command messages
    if (!lowerContent.startsWith('/')) {
      // Wave-2 preference learning: a conservative, verb-anchored "use
      // Pixelmator (instead)" follow-up against the previous route's app
      // resolution records the preferred app for that category. Fire-and-
      // forget; a missed parse just means no preference is learned.
      const previousAppResolution = lastAppResolutionRef.current;
      if (previousAppResolution && circleId) {
        void import('../../../lib/chatComputerRequestRouter')
          .then(async ({ parseAppOverrideChoice, getAppResolutionContext, setAppResolutionContext }) => {
            const override = parseAppOverrideChoice(content, previousAppResolution);
            if (!override) return;
            const { recordPreferredAppForCategory } = await import('../../../lib/knownAppShortcuts');
            await recordPreferredAppForCategory(circleId, override.category, override.appId);
            // Update the hydrated registry too so the very next route build
            // already resolves to the user's choice.
            const ctx = getAppResolutionContext();
            setAppResolutionContext({
              ...ctx,
              preferredAppByCategory: {
                ...(ctx.preferredAppByCategory || {}),
                [override.category]: override.appId,
              },
            });
          })
          .catch(() => {});
      }

      const photoshopGenerativeFillClarification = buildPhotoshopGenerativeFillClarification(content);
      if (photoshopGenerativeFillClarification.route) {
        addBotMessage([
          photoshopGenerativeFillClarification.question,
          '',
          'Examples:',
          ...photoshopGenerativeFillClarification.suggestions.map((suggestion) => `- ${suggestion}`),
        ].join('\n'), undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'main_chat_photoshop_clarification',
            selectedModel,
            effectiveModel: 'deterministic-photoshop-generative-fill',
          },
        });
        setBotTyping(false);
        return;
      }

      const indesignBannerClarification = buildInDesignBannerClarification(content);
      if (indesignBannerClarification.route) {
        addBotMessage([
          indesignBannerClarification.question,
          '',
          'Examples:',
          ...indesignBannerClarification.suggestions.map((suggestion) => `- ${suggestion}`),
        ].join('\n'), undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'main_chat_indesign_banner_clarification',
            selectedModel,
            effectiveModel: 'deterministic-indesign-banner-helper',
          },
        });
        setBotTyping(false);
        return;
      }

      const plan = buildChatAutomationPlan({
        message: content,
        attachments: currentAttachments.map((attachment) => ({
          uri: attachment.uri,
          type: attachment.type,
          id: attachment.id,
        })),
        selectedMode: effectiveChatMode,
      });
      if (plan.execution.kind === 'run_computer_task') {
        if (currentAttachments.length === 0 && shouldRunImmediateLocalAppLaunch(content)) {
          const handledLocalAppLaunch = await executeLocalComputerAwarenessRequest(content);
          if (handledLocalAppLaunch) {
            return;
          }
        }
        const shared = await executeSharedComputerTask(content);
        // WI-1: a zero-tap auto-started browser run owns the turn — return so
        // the parallel SwanBot text stream does not post a duplicate answer on
        // top of the live browser card. Non-auto-started browser plans (the
        // approval-dialog path) still fall through to today's behavior.
        if (shared?.handled && (!shared.browser || shared.autoStarted)) {
          return;
        }
      }
      if (plan.execution.kind === 'run_openswan') {
        const handledLocalDesktop = await executeLocalComputerAwarenessRequest(content);
        if (handledLocalDesktop) {
          return;
        }
      }
      // R7 — apply handler state requests AFTER dispatch (called from a
      // try/finally around each dispatch below). Handlers return the UI
      // state they want instead of mutating ChatTab state in their closures,
      // so a gate refusal, dispatcher skip, or mid-handler throw can never
      // leave the typing indicator stuck or the composer locked. Only
      // `workbench.stop` is honored here — a visible `start` must happen
      // mid-handler (post-dispatch it would appear after the work is done).
      const applyTransportStateRequests = (requests: ChatTransportStateRequests | null) => {
        if (!requests) return;
        if (requests.modalToOpen === 'memory_viewer') setShowMemoryViewer(true);
        if (requests.workbench?.action === 'stop') stopCodingWorkbench();
        if (typeof requests.typing === 'boolean') setBotTyping(requests.typing);
        if (typeof requests.composerLock === 'boolean') sendLockRef.current = requests.composerLock;
      };
      const postDispatcherStopOutcome = (
        outcome: ChatAutomationOutcome | undefined,
        surface: string,
      ) => {
        if (!outcome) return;
        if (outcome.status === 'skipped' && outcome.data?.planModeRefusal) {
          addBotMessage(outcome.message, undefined, {
            localOnly: true,
            runId: outcome.runId || null,
            chatAutomationPlanPreview: outcome.data?.chatAutomationPlanPreview as ChatAutomationPlanPreview | undefined,
            source: {
              actor: 'OpenSwan',
              surface,
              selectedModel,
              effectiveModel: 'chat-automation-plan-refusal',
            },
          });
          return;
        }
        if (outcome.status === 'skipped') return;
        // Approval transparency (Phase 1b): the gate says when an earlier
        // approval covered this run instead of silently reusing it.
        const approvalNotice = typeof outcome.data?.approvalNotice === 'string'
          ? outcome.data.approvalNotice
          : null;
        if (outcome.status === 'completed') {
          // A completed run means any provider blocker is fixed.
          setAttentionProviderBlocker(null);
          // Handlers post their own success text, so the reuse notice gets
          // its own compact line for completed runs (plan §1 follow-up).
          if (approvalNotice) {
            addBotMessage(approvalNotice, undefined, {
              localOnly: true,
              runId: outcome.runId || null,
              source: {
                actor: 'OpenSwan',
                surface,
                selectedModel,
                effectiveModel: 'chat-automation-approval-notice',
              },
            });
          }
          return;
        }
        if (outcome.status !== 'deferred' && outcome.status !== 'failed' && outcome.status !== 'blocked') return;
        // Phase 2b: lead with plain language + one next action when the
        // failure classifies; keep the raw message as a detail line so no
        // information is lost. Deferred messages are already human-written
        // by the gate, so they pass through untranslated.
        const translated = outcome.status !== 'deferred'
          ? translateChatFailure(outcome.message)
          : null;
        if (translated) {
          const blocker = providerBlockerFromFailure(outcome.message);
          if (blocker) setAttentionProviderBlocker(blocker);
        }
        const messageParts = translated
          ? [formatChatUserFacingOutcome(translated), `_Details: ${String(outcome.message).slice(0, 200)}_`]
          : [outcome.message];
        if (approvalNotice) messageParts.push(approvalNotice);
        addBotMessage(messageParts.join('\n\n'), undefined, {
          localOnly: true,
          runId: outcome.runId || null,
          chatAutomationPlanPreview: outcome.data?.chatAutomationPlanPreview as ChatAutomationPlanPreview | undefined,
          source: {
            actor: 'OpenSwan',
            surface,
            selectedModel,
            effectiveModel: `chat-automation-${outcome.status}`,
          },
        });
      };
      const shouldStopAfterDispatcherOutcome = (outcome: ChatAutomationOutcome | undefined) => (
        !!outcome && (outcome.status !== 'skipped' || Boolean(outcome.data?.planModeRefusal))
      );
      // R9 — thread-scoped clarification park/resume seam handed to handlers
      // through the dispatch ctx. `pendingClarificationRef` REMAINS the
      // backing store (the resume block at the top of sendMessage still reads
      // it directly — no behavior change); this just lets dispatcher handlers
      // park/resume without reaching into component refs, so the create_task
      // cutover can use the same seam.
      const clarifyResumeKey = activeThreadId || 'main';
      const clarificationResumeStore: ChatClarificationResumeStore = {
        pending: pendingClarificationRef.current.get(clarifyResumeKey) || null,
        setPending: (pending) => {
          pendingClarificationRef.current.set(clarifyResumeKey, pending);
          persistPendingClarifications();
        },
        clearPending: () => {
          pendingClarificationRef.current.delete(clarifyResumeKey);
          persistPendingClarifications();
        },
      };
      // Underspecified request — ask for the missing details instead of
      // guessing or fabricating a placeholder. Recall context first (memory +
      // recent thread) so the question is informed, then post it as a bot
      // message (mirrors the Photoshop/InDesign clarification UX above).
      //
      // C1 (Phase 1b) cutover #1: this intent now runs through the unified
      // executor (`createChatTransportHandlers` → `dispatchChatAutomationPlan`)
      // instead of an ad-hoc inline branch. `ask_clarification` is plan-safe and
      // approval-free, so behavior is identical — but it now shares the single
      // plan-mode / approval / observer pipeline with every other kind. The dep
      // below is the former inline body verbatim (R7/R9: the trailing typing
      // reset became a state request and the park moved to the ctx seam).
      if (plan.execution.kind === 'ask_clarification' && plan.execution.clarification && !resolvingClarificationRef.current) {
        const clarificationHandlers = createChatTransportHandlers({
          ask_clarification: async (dispatchedPlan, depCtx) => {
            const clarification = dispatchedPlan.execution.clarification!;
            const recentMessages = messages.slice(-6).map((m) => m.content).filter(Boolean);
            const fill = await recallForClarification({
              circleId,
              userId: currentUserId || '',
              message: content,
              recentMessages,
              gap: { missingParams: clarification.missingParams },
            });
            const lines = [clarification.question];
            if (fill.contextNote) lines.push('', fill.contextNote);
            // Examples render as tappable chips (QuickReplyChips) rather than inline
            // text — one tap sends the answer, which the pending-clarification resume
            // path reconstructs into the completed task.
            addBotMessage(lines.join('\n'), undefined, {
              localOnly: true,
              chatAutomationPlanPreview: buildChatAutomationPlanPreview(dispatchedPlan),
              quickReplies: clarification.examples,
              source: {
                actor: 'OpenSwan',
                surface: 'main_chat_clarification',
                selectedModel,
                effectiveModel: 'deterministic-clarification',
              },
            });
            // Remember what we asked so the user's next reply completes the task
            // instead of being routed from scratch (see the resume block above).
            // R9: park through the dispatcher-ctx seam (refs stay the store).
            depCtx.clarificationResume?.setPending({
              originalMessage: content,
              pendingIntent: clarification.pendingIntent || null,
              missingParams: clarification.missingParams,
              askedAt: Date.now(),
            });
            // R7: typing reset is a state request, applied post-dispatch.
            return { status: 'needs_input', stateRequests: { typing: false } };
          },
        });
        let outcome: ChatAutomationOutcome | undefined;
        try {
          outcome = await dispatchChatAutomationPlan(plan, {
            handlers: clarificationHandlers,
            ctx: {
              circleId,
              userId: currentUserId || '',
              threadId: activeThreadId || undefined,
              model: effectiveSelectedModel,
              chatMode: effectivePlanActMode,
              clarificationResume: clarificationResumeStore,
            },
            approvalGate: chatAutomationApprovalGate,
            onOutcome: attachPlanDecisionToRun,
          });
        } finally {
          // R7: applied after dispatch, even on a gate refusal or throw.
          // Default typing→false mirrors the legacy in-closure reset, so a
          // handler crash can't leave the indicator stuck.
          const requests = getOutcomeStateRequests(outcome);
          applyTransportStateRequests(requests ?? { typing: false });
        }
        postDispatcherStopOutcome(outcome, 'main_chat_clarification_dispatch');
        // Handled (asked the question, or refused by the plan-mode gate) →
        // stop here. Only an unexpected `skipped` (no handler) falls through to
        // the legacy path, preserving the old safety net.
        if (shouldStopAfterDispatcherOutcome(outcome)) return;
      }

      // C1 (Phase 1b) cutover #7: natural-language build requests now use the
      // unified dispatcher before the legacy chat path. The handler preserves
      // the existing `/build-page` behavior: thin briefs get the same
      // deterministic clarification, while good briefs launch the streaming
      // builder and leave its workbench/typing state running until the stream
      // completes.
      if (plan.execution.kind === 'run_build_discovery') {
        let buildStreamStarted = false;
        const buildDiscoveryHandlers = createChatTransportHandlers({
          run_build_discovery: async (dispatchedPlan) => {
            const brief = (dispatchedPlan.execution.commandText || content)
              .replace(/^\/build-page\s*/i, '')
              .trim();
            if (!brief) {
              addBotMessage('Usage: `/build-page <brief>` — describe the page you want.', undefined, {
                localOnly: true,
                chatAutomationPlanPreview: buildChatAutomationPlanPreview(dispatchedPlan),
                source: {
                  actor: 'OpenSwan',
                  surface: 'main_chat_build_discovery_dispatch',
                  selectedModel,
                  effectiveModel: 'deterministic-build-brief',
                },
              });
              return { status: 'needs_input', stateRequests: { typing: false } };
            }

            const briefQuality = analyzeBuildBrief(brief, 'build-page');
            if (briefQuality.needsClarification) {
              addBotMessage(briefQuality.hint, undefined, {
                localOnly: true,
                chatAutomationPlanPreview: buildChatAutomationPlanPreview(dispatchedPlan),
                source: {
                  actor: 'OpenSwan',
                  surface: 'main_chat_build_discovery_dispatch',
                  selectedModel,
                  effectiveModel: 'deterministic-build-brief',
                },
              });
              return { status: 'needs_input', stateRequests: { typing: false } };
            }

            await launchBuildStream(brief);
            buildStreamStarted = true;
            return {
              status: 'completed',
              data: { buildStreamStarted: true },
            };
          },
        });
        let buildOutcome: ChatAutomationOutcome | undefined;
        try {
          buildOutcome = await dispatchChatAutomationPlan(plan, {
            handlers: buildDiscoveryHandlers,
            ctx: {
              circleId,
              userId: currentUserId || '',
              threadId: activeThreadId || undefined,
              model: effectiveSelectedModel,
              chatMode: effectivePlanActMode,
              clarificationResume: clarificationResumeStore,
            },
            approvalGate: chatAutomationApprovalGate,
            onOutcome: attachPlanDecisionToRun,
          });
        } finally {
          const requests = getOutcomeStateRequests(buildOutcome);
          if (requests) {
            applyTransportStateRequests(requests);
          } else if (!buildStreamStarted) {
            applyTransportStateRequests({ typing: false, workbench: { action: 'stop', kind: 'coding' } });
          }
        }
        postDispatcherStopOutcome(buildOutcome, 'main_chat_build_discovery_dispatch');
        if (shouldStopAfterDispatcherOutcome(buildOutcome)) return;
      }

      // C1 (Phase 1b) cutovers #2/#3/#4/#5/#6/#8: the memory family
      // (remember / forget / show_memories), image generation, and read-only
      // WordPress listing / well-specified create-task / office-agent task
      // requests, plus approval-gated WordPress publish/schedule, now execute
      // through the unified executor using the planner's already-detected
      // intent — removing the double-classification where the legacy
      // `conversationalRouter` below re-ran its own detector. Remaining
      // conversational intents still fall through to the legacy router
      // unchanged. The dep body mirrors the legacy block, so behavior is
      // preserved (same executor, same workbench/render) while image requests
      // now share the `/imagine` HF command path.
      // R8: the dep calls `executeDetectedConversationalIntent` with
      // `plan.intent.intent` — `detectConversationalIntent` never runs on
      // this path (the chat-transport-handlers smoke asserts it).
      if (plan.intent.kind === 'conversational_action' && plan.execution.kind === 'run_command_handler') {
        const isUnifiedConversationalIntentType = (intentType: string) => intentType === 'remember'
          || intentType === 'forget'
          || intentType === 'show_memories'
          || intentType === 'generate_image'
          || intentType === 'wordpress_list'
          || intentType === 'wordpress_publish'
          || intentType === 'wordpress_schedule'
          || intentType === 'create_task'
          || intentType === 'office_agent_task';
        if (isUnifiedConversationalIntentType(plan.intent.intent.type)) {
          // R7 fail-safe: tracks the mid-handler workbench start so the finally
          // below can stop it even when a throw drops the state requests.
          let conversationalWorkbenchStarted = false;
          const conversationalCommandHandlers = createChatTransportHandlers({
            run_command_handler: async (dispatchedPlan) => {
              if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
              const intent = dispatchedPlan.intent.intent;
              if (!isUnifiedConversationalIntentType(intent.type)) {
                return { handled: false };
              }
              const { executeDetectedConversationalIntent } = await import('../../../lib/conversationalRouter');
              const shouldShowWorkbench = intent.type === 'generate_image'
                || isCodingGenerationRequest(content, sessionProfile)
                || currentAttachments.some((attachment) => attachment.isFigma)
                || !!figmaPromptContext;
              if (shouldShowWorkbench) {
                // R7: stays mid-handler — the workbench must be VISIBLE while
                // the executor runs; starting it post-dispatch would flash it
                // after the work already finished.
                startCodingWorkbench([content, buildAttachmentPromptContext(currentAttachments), figmaPromptContext].filter(Boolean).join('\n\n'));
                conversationalWorkbenchStarted = true;
              }
              // R7: stays mid-handler — the typing indicator must show DURING
              // the executor call; the post-dispatch state request below only
              // handles the reset.
              setBotTyping(true);
              const result = await executeDetectedConversationalIntent(intent, {
                circleId, userId: currentUserId || '', userName: currentUserName,
                model: effectiveSelectedModel !== 'auto' ? effectiveSelectedModel : undefined,
                fullMessage: content, attachments: currentAttachments as any,
              });
              const cleanupRequests: ChatTransportStateRequests = {
                typing: false,
                ...(shouldShowWorkbench ? { workbench: { action: 'stop' as const, kind: 'coding' } } : {}),
              };
              if (result?.handled) {
                if (result.message === '__SHOW_MEMORIES__') {
                  // R7: modal open is a state request, applied post-dispatch.
                  return { status: 'completed', stateRequests: { ...cleanupRequests, modalToOpen: 'memory_viewer' } };
                }
                addBotMessage(result.message, result.artifacts as SwanBotStructuredArtifact[] | undefined, {
                  chatAutomationPlanPreview: buildChatAutomationPlanPreview(dispatchedPlan),
                  source: intent.type === 'generate_image'
                    ? {
                        actor: 'OpenSwan',
                        surface: 'main_chat_hf_tools_dispatch',
                        selectedModel,
                        effectiveModel: 'hf-tools-dispatch',
                      }
                    : undefined,
                });
                return { status: 'completed', stateRequests: cleanupRequests };
              }
              return { handled: false, stateRequests: cleanupRequests };
            },
          });
          let conversationalOutcome: ChatAutomationOutcome | undefined;
          try {
            conversationalOutcome = await dispatchChatAutomationPlan(plan, {
              handlers: conversationalCommandHandlers,
              ctx: {
                circleId,
                userId: currentUserId || '',
                threadId: activeThreadId || undefined,
                model: effectiveSelectedModel,
                chatMode: effectivePlanActMode,
                clarificationResume: clarificationResumeStore,
              },
              approvalGate: chatAutomationApprovalGate,
              onOutcome: attachPlanDecisionToRun,
            });
          } finally {
            // R7: applied after dispatch in a finally — a gate refusal or
            // mid-handler throw drops the state requests, so fall back to the
            // fail-safe defaults (typing off; stop the workbench if the
            // handler started it) instead of leaving the UI stuck.
            const requests = getOutcomeStateRequests(conversationalOutcome);
            applyTransportStateRequests(requests ?? {
              typing: false,
              ...(conversationalWorkbenchStarted ? { workbench: { action: 'stop' as const, kind: 'coding' } } : {}),
            });
          }
          postDispatcherStopOutcome(conversationalOutcome, 'main_chat_conversational_command_dispatch');
          // Only fall through to the plan-derived guarded net below when this
          // handler declined (intent not cut over yet, or executor didn't
          // handle). That net reuses `plan.intent.intent` — it never
          // re-classifies the message.
          if (shouldStopAfterDispatcherOutcome(conversationalOutcome)) return;
        }
      }

      // C2 classify-once cutover: the plan-derived guarded net for a matched
      // conversational action that the unified dispatcher above did NOT own.
      // `buildChatAutomationPlan` already ran the planner's detector (this whole
      // block is inside the `!lowerContent.startsWith('/')` guard where `plan`
      // is in scope), so we REUSE `plan.intent.intent` here —
      // `detectConversationalIntent` is NOT called again on the plain-chat turn
      // (no double classification). The planner is a superset of the old legacy
      // detector, so this net is unreachable in practice today (every actionable
      // conversational intent is in the unified allowlist); it survives only as
      // a fail-safe for a future planner intent that isn't wired into the
      // unified path yet. `executeConversationalIntent` self-guards
      // external-mutation intents via legacyPathRequiresApprovalGate (returns
      // null → fall through to the normal approval-gated pipeline), so this net
      // can never reach a live publish/schedule.
      if (
        plan.intent.kind === 'conversational_action'
        && plan.intent.intent.type !== 'none'
        && !UNIFIED_CONVERSATIONAL_INTENT_TYPES.includes(plan.intent.intent.type)
      ) {
        try {
          const conversationalIntent = plan.intent.intent;
          const { executeConversationalIntent } = await import('../../../lib/conversationalRouter');
          const shouldShowWorkbench = conversationalIntent.type === 'generate_image' || isCodingGenerationRequest(content, sessionProfile) || currentAttachments.some((attachment) => attachment.isFigma) || !!figmaPromptContext;
          if (shouldShowWorkbench) {
            startCodingWorkbench([content, buildAttachmentPromptContext(currentAttachments), figmaPromptContext].filter(Boolean).join('\n\n'));
          }
          setBotTyping(true);
          const result = await executeConversationalIntent(conversationalIntent as any, {
            circleId, userId: currentUserId || '', userName: currentUserName,
            model: effectiveSelectedModel !== 'auto' ? effectiveSelectedModel : undefined,
            fullMessage: content, attachments: currentAttachments as any,
          });
          setBotTyping(false);
          if (shouldShowWorkbench) stopCodingWorkbench();
          if (result?.handled) {
            // The unified path owns __SHOW_MEMORIES__ (via modalToOpen:
            // 'memory_viewer') for show_memories, which is in the allowlist and
            // therefore never reaches this net — so this handles the signal
            // without any risk of double-opening the viewer.
            if (result.message === '__SHOW_MEMORIES__') {
              setShowMemoryViewer(true);
            } else {
              addBotMessage(result.message, result.artifacts as any);
            }
            return;
          }
        } catch {}
      }
    }

    // ─── Governance commands ───────────────────────────────────────

    // /poll "Question" "Option A" "Option B" ...
    if (lowerContent.startsWith('/poll ') || lowerContent.startsWith('poll ')) {
      const pollText = content.replace(/^\/?poll\s+/i, '');
      const parts = pollText.match(/"([^"]+)"/g);
      if (parts && parts.length >= 3) {
        const question = parts[0].replace(/"/g, '');
        const options = parts.slice(1).map(p => p.replace(/"/g, ''));
        handleCreatePoll(question, options);
      } else {
        // Try simple format: /poll Question? Option1, Option2, Option3
        const qMark = pollText.indexOf('?');
        if (qMark > 0) {
          const question = pollText.slice(0, qMark + 1).trim();
          const options = pollText.slice(qMark + 1).split(',').map(o => o.trim()).filter(Boolean);
          if (options.length >= 2) handleCreatePoll(question, options);
          else addBotMessage('📊 Usage: /poll Question? Option1, Option2, Option3');
        } else {
          addBotMessage('📊 Usage: /poll "Question" "Option A" "Option B"\n\nOr: /poll Question? Option1, Option2, Option3');
        }
      }
      return;
    }

    // /propose Title | Description
    if (lowerContent.startsWith('/propose ') || lowerContent.startsWith('propose ')) {
      const propText = content.replace(/^\/?propose\s+/i, '');
      const [title, ...descParts] = propText.split('|');
      handleCreateProposal(title.trim(), descParts.join('|').trim() || undefined);
      return;
    }

    // /vote — show active proposals
    if (lowerContent === '/vote' || lowerContent === '/votes' || lowerContent === '/proposals') {
      const props = await getProposals(circleId, 'active');
      setProposals(props);
      if (props.length === 0) {
        addBotMessage('🗳️ No active proposals. Create one with /propose or /poll!');
      } else {
        addBotMessage(`🗳️ **${props.length} active proposal${props.length > 1 ? 's' : ''}** — scroll up to vote!`);
      }
      return;
    }

    // /pin (reply to pin, or pin last message)
    if (lowerContent === '/pin') {
      const lastMsg = [...messages].reverse().find(m => m.dbId && !m.isBot);
      if (lastMsg?.dbId) {
        handlePinMessage(lastMsg.dbId);
      } else {
        addBotMessage('📌 No message to pin. Messages need to be saved first.');
      }
      return;
    }

    // /pins — show pinned messages
    if (lowerContent === '/pins' || lowerContent === '/pinned') {
      setShowPinned(!showPinned);
      return;
    }

    // /trace <runId> — render a live RunTraceCard for any agent run
    // by id. Useful for debugging — paste a run id from RECENT RUNS
    // and watch the steps unfold.
    if (lowerContent.startsWith('/trace ') || lowerContent === '/trace') {
      const arg = content.slice(6).trim();
      if (!arg) {
        addBotMessage('Usage: `/trace <runId>` — paste a run id from RECENT RUNS to see its step-by-step trace.', undefined, { localOnly: true });
        return;
      }
      addBotMessage(`Loading trace for ${arg.slice(0, 8)}…`, undefined, {
        localOnly: true,
        runId: arg,
        showRunTrace: true,
      });
      return;
    }

    // /diag — probe every local bridge and render a status card with
    // healthy/degraded/offline dots and copy-able restart commands.
    // Brings `npm run bridges:doctor` into chat.
    if (lowerContent === '/diag' || lowerContent === '/bridges') {
      addBotMessage('Probing bridges…', undefined, { localOnly: true });
      probeBridges({ urlForPort: (port) => getBridgeUrl(port) })
        .then((results) => {
          addBotMessage(`${results.filter(r => r.status === 'healthy').length}/${results.length} bridges healthy`, undefined, {
            localOnly: true,
            bridgeDiagResults: results,
          });
        })
        .catch((err) => {
          void addRecoverableChatErrorMessage({
            title: 'Bridge probe failed',
            task: 'Probe local desktop and browser bridges from chat',
            error: err,
            executionKind: 'desktop_bridge_diag',
            source: 'bridge_probe_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/desktopBridge.ts'],
          });
        });
      return;
    }

    // /assign — single-target dispatch. With no arg, render the
    // AssignPickerCard so the user can see all live agents and pick
    // one. With `@<name> <task>`, parse + dispatch via the same
    // helper the multi-agent intercept uses.
    if (lowerContent === '/assign' || lowerContent.startsWith('/assign ')) {
      const rest = content.slice(7).trim();
      if (!rest) {
        // Picker mode
        const pickerAgents: AssignPickerAgent[] = liveAgents.map(a => ({
          id: a.id,
          name: a.name,
          provider: a.provider,
          status: a.status,
          spirit: a.spirit,
          color: a.color,
        }));
        addBotMessage('Pick an agent to assign:', undefined, {
          localOnly: true,
          assignPickerAgents: pickerAgents,
        });
        return;
      }
      // Inline mode: /assign @<name> <task>
      const m = rest.match(/^@?([\w][\w-]*)\s+(.+)$/);
      if (!m) {
        addBotMessage('Usage: `/assign @<agent> <task description>`. Type `/assign` alone to see all agents.', undefined, { localOnly: true });
        return;
      }
      const [, alias, task] = m;
      const target = liveAgents.find(a => a.name.toLowerCase() === alias.toLowerCase());
      if (!target) {
        addBotMessage(`No agent named "@${alias}" in this circle. Type \`/assign\` alone to see all agents.`, undefined, { localOnly: true });
        return;
      }
      addBotMessage(`Assigning to **${target.name}**…`, undefined, { localOnly: true });
      setBotTyping(true);
      dispatchAssignedAgentTask(target, task)
        .then((reply) => addBotMessage(reply))
        .catch((err: any) => addRecoverableChatErrorMessage({
          title: `**${target.name}** assignment failed`,
          task: `Assign ${task} to ${target.name}`,
          error: err,
          executionKind: 'assigned_agent_task',
          source: 'assign_agent_command_error',
          touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/bridgeTaskDispatcher.ts'],
        }))
        .finally(() => setBotTyping(false));
      return;
    }

    // /search query — search both in-memory and DB messages, render
    // results as clickable rows that jump to the message in chat.
    if (lowerContent.startsWith('/search ')) {
      const query = content.slice(8).trim();
      if (!query) { addBotMessage('Usage: /search <keyword>', undefined, { localOnly: true }); return; }
      const q = query.toLowerCase();

      // First pass: scan in-memory messages so we can return ids that
      // map directly to the visible list. The id makes the JUMP button
      // work without a round-trip.
      const inMemoryMatches = messages
        .filter(m => m.content && m.content.toLowerCase().includes(q))
        .slice(-20)
        .reverse();

      const inMemoryIds = new Set(inMemoryMatches.map(m => m.dbId).filter(Boolean));
      const rows: SearchResultRow[] = inMemoryMatches.map(m => ({
        id: m.id,
        authorName: m.isBot ? (agentName || 'Bot') : (m.userName || 'Member'),
        isBot: !!m.isBot,
        snippet: m.content.length > 160 ? m.content.slice(0, 157) + '…' : m.content,
        timestamp: m.timestamp ? m.timestamp.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
      }));

      // Second pass: pull older matches from the DB. Skip any whose
      // dbId is already in the in-memory set.
      try {
        const { data: dbResults } = await supabase
          .from('messages')
          .select('id, content, created_at, user:profiles!user_id(display_name)')
          .eq('circle_id', circleId)
          .ilike('content', `%${query}%`)
          .order('created_at', { ascending: false })
          .limit(15);
        if (dbResults) {
          for (const r of dbResults as any[]) {
            if (inMemoryIds.has(r.id)) continue;
            // No id → archived → no JUMP button (id field stays
            // undefined so the card hides the button automatically).
            rows.push({
              authorName: r.user?.display_name || 'Member',
              isBot: false,
              snippet: r.content.length > 160 ? r.content.slice(0, 157) + '…' : r.content,
              timestamp: new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            });
          }
        }
      } catch (err) {
        console.warn('[/search] DB query failed:', err);
      }

      addBotMessage(`Search results for "${query}"`, undefined, {
        localOnly: true,
        searchResults: { query, rows: rows.slice(0, 25) },
      });
      return;
    }

    // ─── Memory commands — /remember, /forget, /reasoning-standard ─────────
    if (lowerContent === '/reasoning-standard' || lowerContent === '/deep-reasoning') {
      try {
        const { saveResponseStandardMemory } = await import('../../../lib/memoryService');
        const mem = await saveResponseStandardMemory(circleId, currentUserId || '');
        addBotMessage(mem ? 'Saved your deep reasoning standard to memory.' : 'Failed to save reasoning standard.');
        if (mem) setMemoryToast({ message: 'Saved reasoning standard', type: 'saved' });
      } catch (e: any) {
        await addRecoverableChatErrorMessage({
          title: 'Memory command failed',
          task: 'Save deep reasoning standard memory from chat',
          error: e,
          executionKind: 'memory_command',
          source: 'memory_reasoning_standard_error',
          touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/memoryService.ts'],
        });
      }
      return;
    }

    if (lowerContent.startsWith('/remember ')) {
      const what = content.slice(10).trim();
      if (!what) { addBotMessage('Usage: `/remember <something to remember>`'); return; }
      try {
        const { rememberFromChat } = await import('../../../lib/memoryService');
        const mem = await rememberFromChat(circleId, currentUserId || '', what);
        addBotMessage(mem ? `Remembered: "${what.slice(0, 80)}"` : 'Failed to save memory.');
        if (mem) setMemoryToast({ message: `Saved: "${what.slice(0, 50)}"`, type: 'saved' });
      } catch (e: any) {
        await addRecoverableChatErrorMessage({
          title: 'Memory command failed',
          task: `Remember from chat: ${what.slice(0, 160)}`,
          error: e,
          executionKind: 'memory_command',
          source: 'memory_remember_command_error',
          touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/memoryService.ts'],
        });
      }
      return;
    }

    if (lowerContent.startsWith('/forget ')) {
      const what = content.slice(8).trim();
      if (!what) { addBotMessage('Usage: `/forget <keyword to forget>`'); return; }
      try {
        const { forgetFromChat } = await import('../../../lib/memoryService');
        const { forgotten } = await forgetFromChat(circleId, currentUserId || '', what);
        addBotMessage(forgotten > 0 ? `Forgot ${forgotten} memor${forgotten === 1 ? 'y' : 'ies'} matching "${what}".` : `No memories found matching "${what}".`);
        if (forgotten > 0) setMemoryToast({ message: `Forgot ${forgotten} memor${forgotten === 1 ? 'y' : 'ies'}`, type: 'forgotten' });
      } catch (e: any) {
        await addRecoverableChatErrorMessage({
          title: 'Memory command failed',
          task: `Forget chat memory matching: ${what.slice(0, 160)}`,
          error: e,
          executionKind: 'memory_command',
          source: 'memory_forget_command_error',
          touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/memoryService.ts'],
        });
      }
      return;
    }

    if (lowerContent === '/memories' || lowerContent === '/memory') {
      setShowMemoryViewer(true);
      return;
    }

    // ─── Schedule / Cron commands ─────────────────────────────────────────────
    // /schedule <kind> <recurrence?> <payload...> — queue a one-off or recurring action
    // /cron list — show pending actions, /cron cancel <id> — cancel one
    if (lowerContent.startsWith('/schedule ') || lowerContent.startsWith('/cron')) {
      (async () => {
        setBotTyping(true);
        try {
          const { scheduleAction, parseRecurrence, listScheduledActions, cancelAction } = await import('../../../lib/scheduledActions');
          const args = content.slice(content.indexOf(' ') + 1).trim();

          // /cron list
          if (lowerContent === '/cron' || lowerContent === '/cron list') {
            const actions = await listScheduledActions({ circleId, statuses: ['pending', 'running'], limit: 15 });
            if (actions.length === 0) {
              addBotMessage('No pending or running scheduled actions.');
            } else {
              const lines = actions.map(a =>
                `- **${a.kind}** [${a.status}] scheduled ${new Date(a.scheduled_for).toLocaleString()}${a.recurrence_label ? ` (${a.recurrence_label})` : ''} — id: \`${a.id.slice(0, 8)}\``
              );
              addBotMessage(`**Scheduled Actions (${actions.length})**\n\n${lines.join('\n')}`);
            }
            setBotTyping(false);
            return;
          }

          // /cron cancel <id-prefix>
          if (lowerContent.startsWith('/cron cancel ')) {
            const prefix = args.replace(/^cancel\s+/i, '').trim();
            const all = await listScheduledActions({ circleId, statuses: ['pending'], limit: 50 });
            const match = all.find(a => a.id.startsWith(prefix));
            if (match) {
              await cancelAction(match.id);
              addBotMessage(`Canceled action \`${match.id.slice(0, 8)}\` (${match.kind}${match.recurrence_label ? ` — ${match.recurrence_label}` : ''}).`);
            } else {
              addBotMessage(`No pending action found matching \`${prefix}\`.`);
            }
            setBotTyping(false);
            return;
          }

          // /schedule <kind> [every <day>] <payload...>
          // e.g. /schedule reminder every monday Check deployment status
          // e.g. /schedule tweet Hello from Underground Circle!
          const kindMatch = args.match(/^(\w+)\s+/);
          if (!kindMatch) {
            addBotMessage('Usage: `/schedule <kind> [every <day>] <message>`\nKinds: wp_post, tweet, bluesky_post, linkedin_post, gmail_send, slack_post, webhook, reminder\n\nExamples:\n`/schedule reminder every monday Check deployment status`\n`/schedule tweet Launch day!`\n\nManage: `/cron list`, `/cron cancel <id>`');
            setBotTyping(false);
            return;
          }
          const kind = kindMatch[1].toLowerCase();
          const rest = args.slice(kindMatch[0].length);

          // Parse optional recurrence
          const recurrence = parseRecurrence(rest);
          const textAfterRecurrence = recurrence
            ? rest.replace(new RegExp(`(every\\s+\\w+|daily|weekly|monthly)`, 'i'), '').trim()
            : rest.trim();

          // Validate kind
          const VALID_KINDS = ['wp_post','tweet','bluesky_post','linkedin_post','gmail_send','gmail_draft','outlook_send','slack_post','webhook','reminder'];
          if (!VALID_KINDS.includes(kind)) {
            addBotMessage(`Unknown kind "${kind}". Valid: ${VALID_KINDS.join(', ')}`);
            setBotTyping(false); return;
          }
          if (!textAfterRecurrence && kind !== 'reminder') {
            addBotMessage(`Missing content. Usage: \`/schedule ${kind} Your message here\``);
            setBotTyping(false); return;
          }
          if (kind === 'webhook' && !textAfterRecurrence.startsWith('http')) {
            addBotMessage('Webhook URL must start with http:// or https://');
            setBotTyping(false); return;
          }
          // Build payload with platform-specific char limits
          let payload: Record<string, any> = {};
          if (kind === 'reminder') payload = { title: textAfterRecurrence || 'Scheduled reminder', note: '' };
          else if (kind === 'tweet') payload = { text: textAfterRecurrence.slice(0, 280) };
          else if (kind === 'bluesky_post') payload = { text: textAfterRecurrence.slice(0, 300) };
          else if (kind === 'linkedin_post') payload = { text: textAfterRecurrence.slice(0, 3000) };
          else if (kind === 'slack_post') payload = { channel: '#general', text: textAfterRecurrence };
          else if (kind === 'wp_post') payload = { title: textAfterRecurrence.slice(0, 80), content: textAfterRecurrence, status: 'draft' };
          else if (kind === 'webhook') payload = { url: textAfterRecurrence, method: 'POST' };
          else payload = { text: textAfterRecurrence };

          const action = await scheduleAction({
            kind: kind as any,
            circleId,
            payload,
            scheduledFor: recurrence
              ? (await import('../../../lib/scheduledActions')).nextCronOccurrence(recurrence.cron).toISOString()
              : undefined,
            recurrence: recurrence?.cron,
            recurrenceLabel: recurrence?.label,
          } as any);

          const msg = recurrence
            ? `Scheduled recurring **${kind}**: "${textAfterRecurrence.slice(0, 60)}"\nRecurrence: ${recurrence.label}\nNext run: ${new Date(action.scheduled_for).toLocaleString()}\nManage: \`/cron list\`, \`/cron cancel ${action.id.slice(0, 8)}\``
            : `Queued **${kind}**: "${textAfterRecurrence.slice(0, 80)}"\nRuns: now (or at ${new Date(action.scheduled_for).toLocaleString()})\nTrack in the Outbox.`;
          addBotMessage(msg);
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Schedule command failed',
            task: content,
            error: e,
            executionKind: 'scheduled_action_command',
            source: 'schedule_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/scheduledActions.ts'],
          });
        } finally { setBotTyping(false); }
      })();
      return;
    }

    // ─── Help command — open the interactive commands panel ─────────────────
    // Old behavior dumped 80+ commands as plain text. The card is
    // filterable + click-to-insert, so users can find a command they
    // half-remember and seed it into the composer with one tap.
    if (lowerContent === '/help' || lowerContent === '/commands') {
      addBotMessage('Available commands', undefined, { localOnly: true, commandsHelp: true });
      return;
    }

    // ─── Code review — /review <pr-url | #123 | latest> (plan §P13) ─────────
    // Also fires when the message is JUST a GitHub PR link — paste a PR,
    // get a review. Read-only: never writes to GitHub.
    {
      const isReviewCommand = lowerContent === '/review' || lowerContent.startsWith('/review ');
      const soloPrLink = !isReviewCommand
        && !lowerContent.startsWith('/')
        && /^https:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/i.test(content);
      if (isReviewCommand || soloPrLink) {
        (async () => {
          setBotTyping(true);
          try {
            const { executeReviewCommand } = await import('../../../lib/reviewChatCommand');
            const commandText = soloPrLink ? `/review ${content}` : content;
            const result = await executeReviewCommand(commandText, {
              circleId,
              userId: currentUserId || '',
            });
            addBotMessage(result?.message || 'Review did not produce output — try `/review latest`.', undefined, { localOnly: true });
          } catch (e: any) {
            await addRecoverableChatErrorMessage({
              title: 'Code review failed',
              task: content,
              error: e,
              executionKind: 'review_command',
              source: 'review_command_error',
              touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/reviewChatCommand.ts'],
            });
          } finally {
            setBotTyping(false);
          }
        })();
        return;
      }
    }

    // ─── PR-link affordance (plan §P14) ──────────────────────────────────────
    // A GitHub PR URL mid-sentence gets a one-tap review chip WITHOUT
    // hijacking the message — the sentence still flows to the normal lanes
    // below. The chip label IS the /review command, so tapping it routes
    // through the existing intercept above. Solo links never reach here
    // (the review lane returned already).
    if (!lowerContent.startsWith('/')) {
      void (async () => {
        try {
          const { detectGithubPrUrl } = await import('../../../lib/reviewChatCommand');
          const pr = detectGithubPrUrl(content);
          if (!pr) return;
          addBotMessage(
            `Spotted a PR link — want a code review of ${pr.owner}/${pr.repo}#${pr.number}? Tap below.`,
            undefined,
            {
              localOnly: true,
              quickReplies: [`/review https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`],
            },
          );
        } catch {
          // Advisory only — never block the message over the chip.
        }
      })();
    }

    // ─── Natural watch phrasing → /watch (P23) ───────────────────────────────
    // "watch https://…/pricing for changes every day" and "watch my downloads
    // folder for new pdfs" previously fell to plain chat / a one-off computer
    // task. Rewrite them into the real /watch pipeline (same resend pattern as
    // bare PR links → /review). Conservative: message must START with a watch
    // verb AND contain a URL or a folder-watch target.
    if (!lowerContent.startsWith('/') && /^(?:please\s+)?(?:watch|monitor|keep\s+an\s+eye\s+on)\s+/i.test(content)) {
      try {
        const { detectFolderWatchRequest } = await import('../../../lib/folderWatchModel');
        const hasUrl = /https?:\/\/[^\s]+|(?:^|\s)[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s]*)?(?=\s|$)/i.test(content);
        const folderTarget = detectFolderWatchRequest(content);
        if (hasUrl || folderTarget) {
          const rest = content.replace(/^(?:please\s+)?(?:watch|monitor|keep\s+an\s+eye\s+on)\s+/i, '').trim();
          addBotMessage(`🪄 Setting that up as a recurring watch (\`/watch\`).`, undefined, { localOnly: true });
          void sendMessage(`/watch ${rest}`);
          return;
        }
      } catch {
        // Advisory rewrite only — fall through to normal routing.
      }
    }

    // ─── What's on my screen — /screen [app] (P19) ──────────────────────────
    // One-tap observation of the frontmost (or named) app: state, windows,
    // what changed since the last look, and a suggested next step. Read-only.
    if (lowerContent === '/screen' || lowerContent.startsWith('/screen ')) {
      (async () => {
        setBotTyping(true);
        try {
          const { parseScreenCommand, buildScreenQuickReplies } = await import('../../../lib/screenChatCommand');
          const parsed = parseScreenCommand(content);
          if (!parsed) return;
          if (!parsed.ok) {
            addBotMessage(parsed.error, undefined, { localOnly: true });
            return;
          }
          const { runAppScreenObservation } = await import('../../../lib/appScreenObserver');
          const obs = await runAppScreenObservation({ appName: parsed.appName ?? undefined });
          if (!obs) {
            addBotMessage(
              "I can't see the screen right now — the desktop bridge is offline. Start it with `npm run bridge`, then try /screen again.",
              undefined,
              { localOnly: true },
            );
            return;
          }
          addBotMessage(obs.describeForChat, undefined, {
            localOnly: true,
            quickReplies: buildScreenQuickReplies(obs),
          });
        } catch (e: any) {
          addBotMessage(`Could not observe the screen: ${e?.message || 'unknown error'}.`, undefined, { localOnly: true });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── App integrations — /integrations [list|connect|act] (P30) ───────────
    // list/connect are pure replies; `act <goal>` hands the goal to the main
    // agent loop, which already has integrations.list + custom_api.read/request
    // (approval-gated) tools to figure the API call out with the model.
    if (lowerContent === '/integrations' || lowerContent.startsWith('/integrations ')
      || lowerContent === '/integration' || lowerContent.startsWith('/integration ')) {
      (async () => {
        setBotTyping(true);
        try {
          const { parseIntegrationsCommand, buildIntegrationsListReply, buildIntegrationsConnectGuide } =
            await import('../../../lib/integrationsChatCommand');
          const parsed = parseIntegrationsCommand(content);
          if (!parsed) return;
          if (!parsed.ok) {
            addBotMessage(parsed.error, undefined, { localOnly: true });
            return;
          }
          if (parsed.kind === 'list') {
            const { listCircleIntegrations } = await import('../../../lib/circleIntegrations');
            const records = circleId ? await listCircleIntegrations(circleId).catch(() => []) : [];
            addBotMessage(buildIntegrationsListReply(records as any), undefined, { localOnly: true });
            return;
          }
          if (parsed.kind === 'connect') {
            const { INTEGRATION_DEFINITIONS } = await import('../../../lib/circleIntegrations');
            const q = parsed.query.trim().toLowerCase();
            const def = Object.values(INTEGRATION_DEFINITIONS).find((d: any) =>
              d.provider === q || (d.label || '').toLowerCase().includes(q)) || null;
            addBotMessage(buildIntegrationsConnectGuide(parsed.query, def as any), undefined, { localOnly: true });
            return;
          }
          // kind === 'act' — let the agent loop figure out and run the call.
          const hint = parsed.integrationHint ? ` using the ${parsed.integrationHint} integration` : '';
          addBotMessage('🪄 Working out the integration call — I\'ll ask you to approve before anything is sent.', undefined, { localOnly: true });
          void sendMessage(`Use my connected integrations to: ${parsed.goal}${hint}. Steps: (1) check integrations.list to find the right Custom API and its known endpoints; (2) if unsure of the shape, custom_api.read a relevant GET; (3) call integration.compose_action with your proposed method/path/body to validate it into approval-ready args; (4) call custom_api.request with those exact args for my approval before executing.`);
        } catch (e: any) {
          addBotMessage(`Could not run that integration command: ${e?.message || 'unknown error'}.`, undefined, { localOnly: true });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── App automation status — /apps [name] (P17) ─────────────────────────
    // Overview of automatable apps, or a per-app detail card with a LIVE
    // reachability check (bridge → installed → running → focus → a11y).
    if (lowerContent === '/apps' || lowerContent.startsWith('/apps ')) {
      (async () => {
        setBotTyping(true);
        try {
          const { parseAppsCommand, buildAppsOverview, buildAppDetail, buildAppsQuickReplies } =
            await import('../../../lib/appsChatCommand');
          const parsed = parseAppsCommand(content);
          if (!parsed) return;
          if (!parsed.ok) {
            addBotMessage(parsed.error, undefined, { localOnly: true });
            return;
          }
          if (!parsed.appQuery) {
            const { buildAppsOverviewWithLive } = await import('../../../lib/appsChatCommand');
            const browserStatus = async (): Promise<string | null> => {
              try {
                const [{ isBrowserBridgeAvailable }, { getCircleIntegration }] = await Promise.all([
                  import('../../../lib/browserBridge'),
                  import('../../../lib/circleIntegrations'),
                ]);
                const [localOnline, browserbase] = await Promise.all([
                  isBrowserBridgeAvailable().catch(() => false),
                  circleId ? getCircleIntegration(circleId, 'browserbase').catch(() => null) : Promise.resolve(null),
                ]);
                const localLine = localOnline ? 'local browser bridge online' : 'local browser bridge offline';
                const cloudLine = browserbase ? 'Browserbase connected (cloud sessions ready)' : 'Browserbase not connected (Marketplace)';
                return `${localLine} · ${cloudLine}. Web apps (Figma, Canva, Onshape) route here.`;
              } catch {
                return null;
              }
            };
            addBotMessage(await buildAppsOverviewWithLive({ browserStatus }), undefined, {
              localOnly: true,
              quickReplies: buildAppsQuickReplies(true),
            });
            return;
          }
          const probeReachability = async (appName: string) => {
            try {
              const { runAppReachabilityProbe } = await import('../../../lib/appReachabilityProbe');
              const { report, text } = await runAppReachabilityProbe(appName);
              return {
                text,
                status: report.status,
                chatCanFix: report.chatCanFix,
                resolvedAppName: report.resolvedAppName,
              };
            } catch {
              return null;
            }
          };
          const detail = await buildAppDetail(parsed.appQuery, { probeReachability });
          addBotMessage(detail.message, undefined, {
            localOnly: true,
            quickReplies: buildAppsQuickReplies(false, detail.resolvedSlug, detail.fixChip),
          });
        } catch (e: any) {
          addBotMessage(`Could not load app status: ${e?.message || 'unknown error'}.`, undefined, { localOnly: true });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Create anything — /create <brief> (plan §P13) ──────────────────────
    // Classifies the brief and re-dispatches through the existing pipelines.
    if (
      lowerContent === '/create' || lowerContent.startsWith('/create ')
      || lowerContent === '/make' || lowerContent.startsWith('/make ')
    ) {
      (async () => {
        try {
          const { parseCreateCommand, buildCreateDirective, formatCreateRoutingNote } =
            await import('../../../lib/createChatCommand');
          const parsed = parseCreateCommand(content);
          if (!parsed) return;
          if (!parsed.ok) {
            addBotMessage(parsed.error, undefined, { localOnly: true });
            return;
          }
          const directive = buildCreateDirective(parsed.brief);
          if (directive.action.kind === 'reply') {
            addBotMessage(directive.action.message, undefined, { localOnly: true });
            return;
          }
          addBotMessage(formatCreateRoutingNote(directive), undefined, { localOnly: true });
          // Re-dispatch through the normal send path so the existing
          // planner/commands/approval gates all apply unchanged.
          void sendMessage(directive.action.message);
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Create routing failed',
            task: content,
            error: e,
            executionKind: 'create_command',
            source: 'create_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/createChatCommand.ts'],
          });
        }
      })();
      return;
    }

    // ─── Best-of-N race — /bestof model1,model2 <task> (plan §P10) ──────────
    // Cursor's verified pattern: race the same task across models, judge,
    // present the winner. Text-only generations — no tools, no side effects.
    if (
      lowerContent === '/bestof' || lowerContent.startsWith('/bestof ')
      || lowerContent === '/best-of-n' || lowerContent.startsWith('/best-of-n ')
    ) {
      (async () => {
        setBotTyping(true);
        try {
          const { parseBestOfNCommand, resolveRaceModels, runBestOfNRace, summarizeBestOfNRace, BEST_OF_N_MAX_CANDIDATES } =
            await import('../../../lib/bestOfNRace');
          const { bestOfNMetadata } = await import('../../../lib/persistedChatMetadata');
          const parsed = parseBestOfNCommand(content);
          if (!parsed || !parsed.ok) {
            addBotMessage(
              (parsed && !parsed.ok && parsed.error)
                || `Usage: \`/bestof model1,model2 <task>\` (2–${BEST_OF_N_MAX_CANDIDATES} models; aliases: auto, sonnet, haiku, opus, gpt, blackswan).`,
              undefined,
              { localOnly: true },
            );
            return;
          }
          const models = resolveRaceModels(parsed.models, connectedProviderSet);
          addBotMessage(
            `🏁 Racing ${models.length} models on "${parsed.task.slice(0, 80)}" — judging when all finish…`,
            undefined,
            { localOnly: true },
          );
          const result = await runBestOfNRace({
            models,
            task: parsed.task,
            circleId,
            userId: currentUserId || '',
          });
          // P11: interactive card (adopt / race again) rides bounded
          // metadata alongside the text report.
          addBotMessage(result.formattedReport, undefined, {
            localOnly: true,
            bestOfN: bestOfNMetadata(summarizeBestOfNRace(result)),
          });
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Best-of-N race failed',
            task: content,
            error: e,
            executionKind: 'bestof_command',
            source: 'bestof_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/bestOfNRace.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Auto best-of-N (coding-agent P5) — DEFAULT OFF ─────────────────────
    // When enabled (localStorage uc_auto_best_of_n), a COMPLEX text-only
    // build/debug/review turn with ≥2 providers connected auto-races the same
    // task across models and presents the judged winner — the manual /bestof
    // pattern, triggered automatically. Gated hard: never for tool-runtime
    // turns, never for /commands (messageStartsWithCommand short-circuits any
    // slash message straight through to the interceptors below).
    // Cheap synchronous short-circuit: skip all detection work unless the
    // opt-in flag is set (default OFF) and this isn't a /command. Keeps the
    // common path zero-cost.
    if (
      !content.trim().startsWith('/')
      && (() => { try { const v = (globalThis as any)?.localStorage?.getItem?.('uc_auto_best_of_n'); return v === '1' || v === 'true' || v === 'on'; } catch { return false; } })()
    ) {
      let autoRace: { race: boolean; models: string[] } | null = null;
      try {
        const [{ decideAutoBestOfN }, { detectSmartRoute }] = await Promise.all([
          import('../../../lib/codingModelSplitPolicy'),
          import('../../../lib/agenticCodingProfile'),
        ]);
        const route = detectSmartRoute(content, 'main_chat');
        const decision = decideAutoBestOfN({
          intent: route.intent,
          complexity: route.complexity,
          useRuntime: route.useRuntime,
          messageStartsWithCommand: content.trim().startsWith('/'),
          connectedProviders: connectedProviderSet,
        });
        if (decision.race && decision.models.length >= 2) autoRace = decision;
      } catch { /* auto best-of-N is best-effort — fall through to normal send */ }
      if (autoRace) {
        (async () => {
          setBotTyping(true);
          try {
            const { runBestOfNRace, summarizeBestOfNRace } = await import('../../../lib/bestOfNRace');
            const { bestOfNMetadata } = await import('../../../lib/persistedChatMetadata');
            addBotMessage(
              `🏁 Complex coding task — racing ${autoRace.models.length} models and judging the winner…`,
              undefined,
              { localOnly: true },
            );
            const result = await runBestOfNRace({
              models: autoRace.models,
              task: content,
              circleId,
              userId: currentUserId || '',
            });
            addBotMessage(result.formattedReport, undefined, {
              localOnly: true,
              bestOfN: bestOfNMetadata(summarizeBestOfNRace(result)),
            });
          } catch (e: any) {
            await addRecoverableChatErrorMessage({
              title: 'Auto best-of-N race failed',
              task: content,
              error: e,
              executionKind: 'bestof_command',
              source: 'auto_bestof_error',
              touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/codingModelSplitPolicy.ts', 'src/lib/bestOfNRace.ts'],
            });
          } finally {
            setBotTyping(false);
          }
        })();
        return;
      }
    }

    // ─── Watch commands — intercept /watch (recurring monitors, plan §6a) ────
    if (lowerContent.startsWith('/watch') && (lowerContent === '/watch' || lowerContent[6] === ' ')) {
      (async () => {
        setBotTyping(true);
        try {
          const { executeWatchCommand } = await import('../../../lib/watchChatCommands');
          const { detectAlwaysConfirmFloorCategories } = await import('../../../lib/chatComputerRequestRouter');
          const result = await executeWatchCommand(content, {
            circleId,
            userId: currentUserId || '',
            threadId: activeThreadId || null,
            // Watches are read-only monitoring — tasks carrying always-confirm
            // floor intent (pay/delete/login/grant) are rejected at create.
            floorCategoriesFor: (task) => detectAlwaysConfirmFloorCategories(task),
          });
          addBotMessage(result?.message || 'No response.', undefined, { localOnly: true });
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Watch command failed',
            task: content,
            error: e,
            executionKind: 'watch_command',
            source: 'watch_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/watchChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Mission commands — intercept /mission requests ──────────────────────
    if (lowerContent.startsWith('/mission') && (lowerContent === '/mission' || lowerContent[8] === ' ')) {
      (async () => {
        setBotTyping(true);
        try {
          const { executeMissionCommand } = await import('../../../lib/missionChatCommands');
          const result = await executeMissionCommand(content, {
            circleId,
            userId: currentUserId || '',
            // Receipt loop (plan §3c): chat-created missions stamp this
            // thread so task dispatches post receipts back here.
            threadId: activeThreadId || null,
          });
          addBotMessage(result.message || 'No response.', undefined, { localOnly: true });
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Mission command failed',
            task: content,
            error: e,
            executionKind: 'mission_command',
            source: 'mission_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/missionChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Summary command — full circle status report ──────────────────────────
    if (lowerContent === '/summary' || lowerContent === '/status') {
      (async () => {
        setBotTyping(true);
        try {
          const { executeSummaryCommand } = await import('../../../lib/missionChatCommands');
          const result = await executeSummaryCommand({
            circleId,
            userId: currentUserId || '',
          });
          addBotMessage(result.message || 'No data yet.', undefined, { localOnly: true });
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Summary command failed',
            task: content,
            error: e,
            executionKind: 'summary_command',
            source: 'summary_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/missionChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Room commands — intercept /room requests ───────────────────────────
    if (lowerContent.startsWith('/room ') || lowerContent === '/room') {
      (async () => {
        setBotTyping(true);
        try {
          const result = await executeRoomCommand(content, {
            circleId,
            userId: currentUserId || '',
            surface: 'main_chat',
          });
          addBotMessage(result.message || 'No response.');
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Room command failed',
            task: content,
            error: e,
            executionKind: 'room_command',
            source: 'room_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/roomChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── /build-page — streaming path via the build-stream edge fn ────────────
    // Fires before the generic HF-command dispatch so the same prefix doesn't
    // hit both paths. On error we surface the message inline; users can re-
    // prompt. If the stream server is down, the bot message tells them.
    if (lowerContent.startsWith('/build-page ') || lowerContent === '/build-page') {
      const brief = content.replace(/^\/build-page\s*/i, '').trim();
      if (!brief) {
        addBotMessage('Usage: `/build-page <brief>` — describe the page you want.');
        return;
      }
      // Gate thin briefs: ask for the missing detail instead of scaffolding a
      // page from almost nothing. `hint` already lists what's missing.
      const briefQuality = analyzeBuildBrief(brief, 'build-page');
      if (briefQuality.needsClarification) {
        addBotMessage(briefQuality.hint, undefined, {
          localOnly: true,
          source: {
            actor: 'OpenSwan',
            surface: 'main_chat_build_clarification',
            selectedModel,
            effectiveModel: 'deterministic-build-brief',
          },
        });
        setBotTyping(false);
        return;
      }
      launchBuildStream(brief);
      return;
    }

    // ─── HF tool commands — intercept /summarize, /translate, etc. ────────────
    const hfPrefixes = ['/summarize', '/translate', '/classify', '/zero-shot', '/qa', '/imagine', '/vision', '/openmodel', '/code', '/speak', '/hf'];
    if (hfPrefixes.some(p => lowerContent.startsWith(p))) {
      startCodingWorkbench(content);
      setBotTyping(true);
      try {
        const result = await executeHfCommand(content, {
          circleId,
          userId: currentUserId || '',
          userName: currentUserName,
          model: selectedModel !== 'auto' ? selectedModel : undefined,
        });
        if (result.success) {
          addBotMessage(result.message, result.artifacts as SwanBotStructuredArtifact[] | undefined);
        } else {
          addBotMessage(result.message || 'HF command not recognized.');
        }
      } catch (e: any) {
        await addRecoverableChatErrorMessage({
          title: 'HF command failed',
          task: content,
          error: e,
          executionKind: 'hf_command',
          source: 'hf_command_error',
          touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/hfCommands.ts'],
        });
      } finally { setBotTyping(false); stopCodingWorkbench(); }
      return;
    }

    // ─── GitHub commands — intercept /gh and GitHub-related requests ─────────
    if (lowerContent.startsWith('/gh ') || lowerContent === '/gh') {
      (async () => {
        setBotTyping(true);
        try {
          const result = await executeGitHubChatCommand(content, {
            circleId,
            userId: currentUserId || '',
          });
          addBotMessage(result.message || 'No response from GitHub.');
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'GitHub command failed',
            task: content,
            error: e,
            executionKind: 'github_command',
            source: 'github_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/githubChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── WordPress commands — intercept /wp requests ────────────────────────
    if (lowerContent.startsWith('/wp ') || lowerContent === '/wp') {
      (async () => {
        setBotTyping(true);
        try {
          const { executeWpCommand } = await import('../../../lib/wordpressChatCommands');
          const result = await executeWpCommand(content, {
            circleId,
            userId: currentUserId || '',
            userName: currentUserName,
          });
          addBotMessage(result.message);
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'WordPress command failed',
            task: content,
            error: e,
            executionKind: 'wordpress_command',
            source: 'wordpress_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/wordpressChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Vault commands — intercept /vault requests ─────────────────────────
    // Read-only surface over the Site Credential Vault. Supports list, find,
    // status, rotation, and help. Never reveals secret values — that path
    // stays in the Vault panel where access duration + audit logging apply.
    if (lowerContent.startsWith('/vault ') || lowerContent === '/vault') {
      (async () => {
        setBotTyping(true);
        try {
          const { executeVaultCommand } = await import('../../../lib/vaultChatCommands');
          const result = await executeVaultCommand(content, {
            circleId,
            userId: currentUserId || '',
          });
          addBotMessage(result.message || 'No response.', undefined, { localOnly: true });
        } catch (e: any) {
          await addRecoverableChatErrorMessage({
            title: 'Vault command failed',
            task: content,
            error: e,
            executionKind: 'vault_command',
            source: 'vault_command_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/vaultChatCommands.ts'],
          });
        } finally {
          setBotTyping(false);
        }
      })();
      return;
    }

    // ─── Lightweight local SwanBot commands — short-circuit before OpenSwan ─
    try {
      const localCommandResponse = await tryHandleLocalSwanBotCommand(content, {
        userId: currentUserId || 'anonymous',
        circleId,
        userName: currentUserName,
        model: selectedModel !== 'auto' ? selectedModel : undefined,
      });
      if (localCommandResponse) {
        addBotMessage(localCommandResponse);
        return;
      }
    } catch (localCmdErr) {
      console.warn('[ChatTab] local SwanBot command failed:', localCmdErr);
    }

    // ─── Web Search routing (Phase 0 + auto-detect) ────────────────────────
    // Two paths into web search: (1) the persistent toggle, and (2)
    // a per-turn auto-detect heuristic that examines the message
    // text. When the heuristic fires, we attach search for THIS turn
    // only — the persistent toggle stays at whatever the user set.
    // The bot reply gets a small "auto-enabled because: <reason>"
    // footer so the override isn't surprising.
    const { decideWebSearchForTurn } = await import('../../../lib/webSearchAutoDetect');
    const webDecision = decideWebSearchForTurn(content, webSearchEnabled);
    if (webDecision.attach) {
      setBotTyping(true);
      try {
        const { webSearchViaOpenRouter } = await import('../../../lib/llmProviders');
        const recent = messages.slice(-6).map(m => ({
          role: m.isBot ? ('assistant' as const) : ('user' as const),
          content: m.content,
        }));
        const result = await webSearchViaOpenRouter({
          query: content,
          circleId,
          conversation: recent,
          systemPrompt: 'You are a helpful assistant in a chat. Use the web_search tool when the question needs current information. Cite sources inline as markdown links when you do.',
        });
        setBotTyping(false);
        // Auto-detection footer — only surfaced when the heuristic
        // (not the manual toggle) triggered the route. Tells the
        // user why their question got web search even though they
        // didn't toggle it on.
        const autoFooter = webDecision.auto && webDecision.reason
          ? `\n\n_🌐 Auto-enabled web search — ${webDecision.reason}._`
          : '';
        addBotMessage((result.response || '(No response from OpenRouter web search.)') + autoFooter);
      } catch (err: any) {
        // Cross-provider fallback for the non-search path is wired in
        // `invokeAnyChat`; web search itself stays OR-only because no
        // other provider exposes a server-side search tool today.
        // When OR is missing or rate-limited, fall back to the
        // unified router WITHOUT the search tool — at least the user
        // gets an answer (possibly from HF or Anthropic direct), with
        // a note that web search wasn't applied.
        try {
          const { invokeAnyChat } = await import('../../../lib/universalInvoke');
          const { listApiKeys } = await import('../../../lib/llmProviders');
          const userKeys = await listApiKeys();
          const recent = messages.slice(-6).map(m => ({
            role: m.isBot ? ('assistant' as const) : ('user' as const),
            content: m.content,
          }));
          const fallback = await invokeAnyChat({
            modelId: resolveSendModel(content) || 'claude-haiku-4-5',
            messages: [
              { role: 'system', content: 'Web search is unavailable for this turn. Answer from training knowledge and clearly note when information may be out of date.' },
              ...recent,
              { role: 'user', content },
            ],
            circleId,
            userKeys,
            maxTokens: 1024,
          });
          setBotTyping(false);
          addBotMessage(
            `${fallback.response}\n\n_Web search unavailable (${err?.message || 'OpenRouter error'}); answered from ${fallback.servedBy.label}._`,
            undefined,
            { localOnly: true },
          );
        } catch (fallbackErr: any) {
          setBotTyping(false);
          const msg = err?.message || fallbackErr?.message || 'Web search failed';
          await addRecoverableChatErrorMessage({
            title: 'Web search failed',
            task: `Answer with web search: ${content.slice(0, 240)}`,
            error: new Error(`${msg}. Connect OpenRouter in Marketplace > AI Models & APIs for web search, or any other provider for plain chat.`),
            executionKind: 'web_search_command',
            source: 'web_search_failure',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/llmProviders.ts', 'src/lib/universalInvoke.ts'],
          });
        }
      }
      return;
    }

    // ─── Model capability routing — images, webpages, etc. ──────────────────
    try {
      const { routeByCapability } = await import('../../../lib/modelCapabilities');
      const attachmentPromptContext = buildAttachmentPromptContext(currentAttachments);
      const contentWithAttachments = [content, attachmentPromptContext, figmaPromptContext].filter(Boolean).join('\n\n');
      const shouldShowWorkbench = isCodingGenerationRequest(content, sessionProfile) || currentAttachments.some((attachment) => attachment.isFigma) || !!figmaPromptContext;
      if (shouldShowWorkbench) startCodingWorkbench(contentWithAttachments);
      setBotTyping(true);
      const capResult = await routeByCapability(contentWithAttachments, selectedModel);
      setBotTyping(false);
      if (shouldShowWorkbench) stopCodingWorkbench();
      if (capResult.handled) {
        const arts: SwanBotStructuredArtifact[] = (capResult.artifacts || []).map(a => ({
          kind: a.kind as any,
          title: a.title,
          content: a.html || a.content || null,
          url: a.url || null,
          metadata: a.metadata,
        }));
        addBotMessage(capResult.response, arts.length > 0 ? arts : undefined);
        return;
      }
      if (capResult.fallbackNotice) {
        // A capability backend (image gen) failed — say why before the normal
        // model answers in text, so the missing artifact isn't a silent mystery.
        addBotMessage(capResult.fallbackNotice);
      }
    } catch (capErr) {
      setBotTyping(false);
      console.warn('[Chat] Capability routing error:', capErr);
    }

    // Trigger Agent AI — always responds UNLESS the user is @mentioning another member
    const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isAtMentioningSomeoneElse = new RegExp(`^@(?!agent|blackswan|swanbot|swan|${escapedName}\\b)\\w`, 'i').test(content.trim());

    if (!isAtMentioningSomeoneElse) {
      let cleanContent = content.replace(new RegExp(`@(agent|blackswan|swanbot|swan|${escapedName})\\s*`, 'gi'), '').trim() || content;
      const latestRecoveryOptionsMessage = findLatestRecoveryOptionsMessage(messages);
      const recoveryFollowup = latestRecoveryOptionsMessage
        ? resolveChatFailureRecoveryOptionFollowup(cleanContent, latestRecoveryOptionsMessage.recoveryOptions)
        : null;
      if (recoveryFollowup) {
        cleanContent = buildRecoveryOptionComposerPrompt(recoveryFollowup.option, latestRecoveryOptionsMessage || undefined);
      }

      // Build chat context with OpenSwan envelope wrapping for temporal awareness
      const selectedRecoveryOption = parseChatFailureRecoveryOptionSelection(cleanContent);
      const selectedRecoveryExecutionPlan = selectedRecoveryOption
        ? buildChatFailureRecoveryExecutionPlan(selectedRecoveryOption)
        : null;
      const selectedRecoveryPolicy = selectedRecoveryExecutionPlan?.policy || null;
      const recoveryOptionPromptContext = selectedRecoveryOption
        ? formatChatFailureRecoveryOptionSelectionForPrompt(selectedRecoveryOption)
        : '';
      const recentMessages = messages.slice(-10);
      // P62: the most recent bot message gets a much larger history budget.
      // "Continue"-style follow-ups (including interrupted-stream partials,
      // whose UI hint literally says "Say 'continue'") need that answer's
      // tail — a uniform 300-char slice meant continue only ever saw the
      // first 300 chars of what it was asked to continue.
      let lastBotMessageIdx = -1;
      for (let mi = recentMessages.length - 1; mi >= 0; mi--) {
        if (recentMessages[mi].isBot) { lastBotMessageIdx = mi; break; }
      }
      const chatHistoryText = recentMessages.map((m, mi) => {
        const who = m.isBot ? agentName : (m.userName || 'User');
        const when = m.timestamp ? m.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const ago = m.timestamp ? formatTimeAgo(m.timestamp) : '';
        return `[${who} · ${when}${ago ? ` · ${ago}` : ''}] ${m.content.slice(0, mi === lastBotMessageIdx ? 2000 : 300)}`;
      }).join('\n');
      // Deeper root cause of the recovery-followup-context bug: when the very
      // last message is a bot message left in a blocked/needs-input state,
      // its recovery options / plan preview / evidence gaps only ever existed
      // as UI render fields on that message — never in `m.content` above — so
      // a natural-language follow-up about that card had no structured
      // context to answer from. Additive/no-op when the last bot message has
      // no active blocker.
      const lastMessage = recentMessages.length > 0 ? recentMessages[recentMessages.length - 1] : null;
      const activeBlockerContext = (lastMessage && lastMessage.isBot && lastBotMessageIdx === recentMessages.length - 1)
        ? formatActiveChatBlockerContextForPrompt({
          recoveryOptions: lastMessage.recoveryOptions,
          computerHandoffBlockers: lastMessage.computerHandoff?.blockers,
          computerHandoffWarnings: lastMessage.computerHandoff?.warnings,
          preflightSummary: lastMessage.computerHandoff?.preflightSummary,
          groundingSummary: lastMessage.computerHandoff?.groundingSummary,
          planPreview: lastMessage.chatAutomationPlanPreview
            ? {
              title: lastMessage.chatAutomationPlanPreview.title,
              routeLabel: lastMessage.chatAutomationPlanPreview.routeLabel,
              approvalRequired: lastMessage.chatAutomationPlanPreview.approvalRequired,
              evidenceGaps: lastMessage.chatAutomationPlanPreview.evidencePanel?.freshEvidenceRequired,
            }
            : null,
        })
        : '';
      // Sibling case: the last bot message did NOT end in a blocker but did
      // complete (or partially complete) a computer/browser/design task —
      // its findings/artifacts/browser-plan-outcomes/outcome verdict only
      // ever existed as UI render fields on that message too, so a natural
      // follow-up like "what did you find" had nothing structured to answer
      // from. Mutually exclusive with activeBlockerContext above (a blocked
      // task already gets its own context) and additive/no-op otherwise.
      const completedTaskContext = (!activeBlockerContext && lastMessage && lastMessage.isBot && lastBotMessageIdx === recentMessages.length - 1)
        ? formatCompletedChatTaskContextForPrompt({
          outcomeSignal: lastMessage.outcomeSignal,
          computerFindings: lastMessage.computerFindings,
          artifacts: lastMessage.artifacts,
          browserPlans: lastMessage.browserPlans,
        })
        : '';
      const chatHistory = [chatHistoryText, activeBlockerContext, completedTaskContext].filter(Boolean).join('\n');

      // If replying to a specific message, prepend that context
      const replyContext = replyTo
        ? `[Replying to ${replyTo.isBot ? agentName : replyTo.userName}: "${replyTo.content.slice(0, 200)}"]\n`
        : '';

      // Build attachment context for AI
      let attachmentContext = '';
      if (currentAttachments.length > 0) {
        attachmentContext = [
          buildAttachmentPromptContext(currentAttachments),
          figmaPromptContext,
          ...currentAttachments.map(a => prepareImageForAI(a)),
        ].filter(Boolean).join('\n');
      } else if (figmaPromptContext) {
        attachmentContext = figmaPromptContext;
      }

      // P20 — attached images + WordPress wording → deterministic upload
      // directive: exact wp.upload_media recipes with the real storage paths,
      // approval-gated as always, drafts by default. Advisory lane — any
      // failure here must never block the send.
      let wpImageDirective = '';
      try {
        const stagedImageUploads = currentStagedFiles.filter(
          (f) => (f.mimeType || '').startsWith('image/') && f.attachment?.storagePath,
        );
        const pickerImages = currentAttachments.filter((a) => a.type === 'image');
        const imageCount = stagedImageUploads.length + pickerImages.length;
        if (imageCount > 0) {
          const { detectWordPressImagePostIntent, buildWpImageUploadDirective, summarizeWpImagePlanForUser } =
            await import('../../../lib/wpImagePostFlow');
          const wpIntent = detectWordPressImagePostIntent({ text: content, imageAttachmentCount: imageCount });
          if (wpIntent) {
            // Picker images carry base64 but no storage path — stage them now
            // (web only) so wp.upload_media can reach the bytes.
            const pickerUploads: Array<{ name: string; mimeType: string; storagePath: string }> = [];
            if (Platform.OS === 'web' && currentUserId) {
              for (const att of pickerImages) {
                if (!att.base64) continue;
                try {
                  const bytes = Uint8Array.from(atob(att.base64), (c) => c.charCodeAt(0));
                  const file = new File([bytes], att.name || 'image.jpg', { type: att.mimeType || 'image/jpeg' });
                  const uploaded = await uploadAttachment({ file, circleId, threadId: activeThreadId, userId: currentUserId });
                  if (uploaded?.storagePath) {
                    pickerUploads.push({ name: file.name, mimeType: file.type, storagePath: uploaded.storagePath });
                  }
                } catch {
                  // Best-effort — unstaged picker images are simply left out.
                }
              }
            }
            const wpAttachments = [
              ...stagedImageUploads.map((f) => ({ name: f.name, mimeType: f.mimeType, storagePath: f.attachment!.storagePath })),
              ...pickerUploads,
            ];
            if (wpAttachments.length > 0) {
              wpImageDirective = buildWpImageUploadDirective({
                attachments: wpAttachments,
                siteUrl: wpIntent.siteUrl,
                wantsSlide: wpIntent.wantsSlide,
                wantsPost: wpIntent.wantsPost,
              });
              addBotMessage(
                summarizeWpImagePlanForUser({
                  count: wpAttachments.length,
                  siteUrl: wpIntent.siteUrl,
                  wantsSlide: wpIntent.wantsSlide,
                  wantsPost: wpIntent.wantsPost,
                }),
                undefined,
                { localOnly: true },
              );
            }
          }
        }
      } catch {
        // Advisory only.
      }

      const fullPrompt = [
        attachmentContext,
        wpImageDirective,
        replyContext,
        recoveryOptionPromptContext,
        cleanContent,
      ].filter(Boolean).join('\n');

      // Track reply in behavior profile
      if (replyTo && profileRef.current) {
        profileRef.current = updateProfileFromReply(profileRef.current);
        saveUserProfile(profileRef.current).catch(() => {});
      }

      const isFigmaBuildRequest = currentAttachments.some((attachment) => attachment.isFigma) || !!figmaPromptContext;
      const resolvedSessionProfile = resolveSessionCodingProfile(sessionProfile, cleanContent, 'main_chat');
      const workbenchPrompt = [
        cleanContent,
        isFigmaBuildRequest ? 'The attached Figma design is the source of truth. Build the resulting webpage as a single complete HTML document.' : '',
        attachmentContext,
      ].filter(Boolean).join('\n\n');
      startCodingWorkbench(workbenchPrompt);
      setBotTyping(true);
      try {
        const sessionArchiveContext = await loadSessionArchiveContext();
        const sendModel = effectiveSelectedModel !== 'auto'
          ? effectiveSelectedModel
          : resolveSendModel(cleanContent);
        const context: SwanBotContext = {
          userId: currentUserId || 'anonymous',
          circleId,
          userName: currentUserName,
          model: sendModel || undefined,
          sessionArchiveContext: sessionArchiveContext || undefined,
          connectedProviders: connectedProviderSet,
        };

        // Inject recent chat context so the AI can reference prior messages
        context.chatHistory = chatHistory;

        // Inject Discord context if needed
        const mentionsDiscord = /discord|#\w+|channel/i.test(cleanContent);
        if (mentionsDiscord && discordConfig?.bot_token && discordConfig?.guild_id) {
          try {
            const dCtx = await buildDiscordContext(circleId, discordConfig.bot_token, discordConfig.guild_id, {
              channelLimit: 3, messageLimit: 5,
            });
            (context as any).discordContext = dCtx;
          } catch {}
        } else if (discordChannels.length > 0) {
          (context as any).discordContext = `DISCORD CHANNELS: ${discordChannels.map(c => '#' + c).join(', ')}`;
        }

        // Use unified agent runtime only when user explicitly selects a specialized mode
        if (effectiveChatMode !== 'none' && effectiveChatMode !== 'talk') {
          const result = await executeAgentRun({
            surface: 'main_chat',
            circleId,
            userId: currentUserId || 'anonymous',
            userName: currentUserName,
            prompt: fullPrompt,
            model: sendModel || undefined,
            mode: effectiveChatMode as any,
            connectedProviders: connectedProviderSet,
            context: {
              chatHistory,
              sessionArchiveContext: sessionArchiveContext || undefined,
              replyTo: replyTo ? replyTo.content : undefined,
            },
          });
          addBotMessage(result.response);
          // Track bot response in behavior profile
          if (profileRef.current) {
            profileRef.current = updateProfileFromMessage(profileRef.current, result.response, false);
            saveUserProfile(profileRef.current).catch(() => {});
          }
          if (result.handoffSuggestion) {
            setPendingHandoff(result.handoffSuggestion);
          }
        } else {
          let pendingMessage: ChatMessage | null = null;
          try {
            const { buildPluginPrompt, getPluginConnectorRequirements } = await import('../../../lib/pluginRegistry');
            const { getMissingConnectorRequirements } = await import('../../../lib/circleIntegrations');
            const pluginPrompt = buildPluginPrompt(activePlugins);
            const requiredConnectors = getPluginConnectorRequirements(activePlugins);
            const missingConnectors = circleId
              ? await getMissingConnectorRequirements(circleId, requiredConnectors)
              : [];
            const integrationPreflight = missingConnectors.length > 0
              ? `## Integration Preflight\nMissing circle integrations: ${missingConnectors.join(', ')}\nDo not claim end-to-end ownership of workflows that depend on those systems without first flagging the missing integrations.`
              : '';
            const augmentedPrompt = [pluginPrompt, integrationPreflight, fullPrompt].filter(Boolean).join('\n\n');

            // Phase C2 — SSE streaming fast-path. Fires when the message is
            // simple enough (solo delegation, no Figma, no specialized agent
            // mode) so 90% of normal chat turns get token-by-token output.
            // Falls through to the batch runOpenSwanSessionTurn for complex
            // runs (parallel delegation, coding generation, agent dispatch).
            // Action-intent messages ("create a room", "pause the
            // automation", "update circle theme", etc.) need the tool
            // catalog, which ONLY the runOpenSwanSessionTurn batch path
            // exposes. Forcing them off the streaming fast-path lets
            // BlackSwan actually call rooms.create / circle.update_* /
            // missions.* instead of replying "I can't do that."
            const streamCandidateModel = sendModel || 'claude-haiku-4-5';
            const terminalPlan = buildChatAutomationPlan({
              message: content,
              attachments: currentAttachments.map((attachment) => ({
                uri: attachment.uri,
                type: attachment.type,
                id: attachment.id,
              })),
              selectedMode: effectiveChatMode,
            });
            const terminalTransport = chooseChatTerminalTransport({
              executionKind: terminalPlan.execution.kind,
              chatMode: effectiveChatMode,
              sessionDelegationMode,
              hasSelectedRecoveryOption: Boolean(selectedRecoveryOption),
              isFigmaBuildRequest,
              isCodingGenerationRequest: isCodingGenerationRequest(cleanContent, sessionProfile),
              looksLikeActionRequest: looksLikeActionRequest(cleanContent),
              canStreamAnthropic: canUseAnthropicChatStream(streamCandidateModel),
            });
            // AI-first telemetry (NO behavior change): annotate which orchestration
            // tier the product policy would pick for this turn — plain_model (stream
            // a model answer), escalate_tools (stream first, activate SwanBot/OpenSwan
            // tools on tool_use), or spawn_agents (deploy path). This is a pure,
            // side-effect-free decision used only for a debug log; the actual transport
            // and escalation are still driven entirely by `terminalTransport` above and
            // the `uc_stream_escalate_on_tool_use` flag, so this is a no-op on every
            // path regardless of flag state. (`spawn_agents` turns short-circuit far
            // earlier via the `__SPAWN_AGENTS__` modal and never reach this stream path.)
            try {
              const orchestration = decideChatOrchestration({
                message: cleanContent,
                mode: effectiveChatMode,
                modelId: streamCandidateModel,
                hasAttachments: currentAttachments.length > 0,
                // The explicit tool/agent quick-actions resolve to their own
                // routes/modals before this point, so from the stream path's vantage
                // these are caller-detected-false; the message heuristics still
                // classify implicit action/capability intent for telemetry.
                explicitToolRequest: false,
                explicitAgentRequest: false,
              });
              console.debug(
                '[ChatTab] AI-first orchestration tier:',
                orchestration.tier,
                '| transport:',
                terminalTransport.path,
                '| capabilities:',
                orchestration.suggestedCapabilities.join(',') || 'none',
                '|',
                orchestration.reason,
              );
            } catch (orchestrationErr) {
              // Telemetry only — never let the tier annotation affect a chat turn.
              console.warn('[ChatTab] orchestration tier annotation failed:', orchestrationErr);
            }
            // Phase 2 seam (DEFAULT OFF): `stream_then_escalate` streams the
            // turn plainly AND advertises the tiny pinned tool core + tools.search
            // so the model can signal mid-turn that it needs a capability; on that
            // signal this turn upgrades into the OpenSwan tool loop. The transport
            // only returns this path while the `uc_stream_escalate_on_tool_use`
            // flag is ON, so when the flag is OFF `escalateOnToolUse` is false and
            // every branch below is byte-for-byte the legacy `stream_plain_chat`.
            const escalateOnToolUse = terminalTransport.path === 'stream_then_escalate';
            const canStream = terminalTransport.path === 'stream_plain_chat' || escalateOnToolUse;

            if (canStream) {
              // W5 (P39): hoisted so the catch below can normalize the stream
              // terminal through the unified lane boundary (chatLaneOutcome).
              // The load-bearing distinction: interrupted ≠ failed — an
              // interrupted stream left PARTIAL text on screen and must never
              // be silently re-run as batch.
              let streamAccumulated = '';
              let streamPendingMsgId: string | null = null;
              // P62: the pending message object + source are captured here so
              // the catch below can PERSIST an interrupted partial (it used to
              // live only in local React state and vanished on reload).
              let streamPendingMsg: ReturnType<typeof addPendingBotMessage> | null = null;
              let streamSourceForRecovery: ChatMessageSource | null = null;
              let streamInterruptedResult: import('../../../lib/swanbotStream').StreamChatResult | undefined;
              try {
                const { buildStreamableSystemPrompt } = await import('../../../lib/swanbot');
                const { streamChatResponse } = await import('../../../lib/swanbotStream');
                const { resolveModelForSoul, spiritIdForProfile } = await import('../../../lib/serviceProfileSouls');
                const systemPrompt = await buildStreamableSystemPrompt({
                  circleId,
                  userId: currentUserId || 'anonymous',
                  currentMessage: cleanContent,
                  model: effectiveSelectedModel !== 'auto' ? effectiveSelectedModel : undefined,
                  userName: currentUserName,
                  chatHistory,
                  sessionArchiveContext: sessionArchiveContext || undefined,
                });
                // Auto resolution honours the connected marketplace
                // providers — when OpenRouter is wired, this picks an
                // OR-prefixed slug so the call routes through the team
                // OR key (handled by the relay path in swanbot-ai).
                // Falls back to platform Sonnet if the helper somehow
                // returns null so we never send an unresolved 'auto'.
                const streamModel = streamCandidateModel;
                // Phase 2 seam (DEFAULT OFF): only when the transport chose
                // `stream_then_escalate` do we advertise the pinned tool palette
                // on the stream. `getStreamEscalationPinnedToolNames` resolves the
                // same surface-pinned core + tools.search used by the batch
                // tools-first path (via listPinnedOpenSwanToolsForSurface), and
                // `getToolDefinitions` turns those names into Anthropic tool
                // definitions. When the flag is OFF this whole block is skipped and
                // `streamTools` stays undefined, so the stream request omits
                // `tools` and is byte-identical to today's text-only call.
                let streamTools: Array<{ name: string; description: string; input_schema: Record<string, unknown> }> | undefined;
                if (escalateOnToolUse) {
                  try {
                    const { getStreamEscalationPinnedToolNames } = await import('../../../lib/swanbot');
                    const { getToolDefinitions } = await import('../../../lib/openswanTools/index');
                    const pinnedToolNames = await getStreamEscalationPinnedToolNames('main_chat');
                    const defs = getToolDefinitions(pinnedToolNames, 'main_chat');
                    streamTools = defs.length > 0 ? defs : undefined;
                  } catch (toolResolveErr) {
                    console.warn('[ChatTab] stream escalation tool resolve failed:', toolResolveErr);
                    streamTools = undefined;
                  }
                }
                const pendingMsg = addPendingBotMessage('');
                streamPendingMsgId = pendingMsg.id;
                streamPendingMsg = pendingMsg;
                setRunStatus('running');
                let accumulated = '';
                let streamingUsage: SwanBotStructuredResponse['usage'] | undefined;
                // Captured only on the escalation path: the SSE parser exposes the
                // reassembled tool_use blocks + terminal stop_reason on the done
                // result (and via additive callbacks). Left untouched on the plain
                // path so flag-off behavior is unchanged.
                let streamToolUses: Array<{ id: string; name: string; input: unknown }> = [];
                let streamStopReason: string | null = null;
                const streamSource: ChatMessageSource = {
                  actor: agentName,
                  surface: 'main_chat_stream',
                  selectedModel,
                  effectiveModel: streamModel,
                };
                streamSourceForRecovery = streamSource;
                await new Promise<void>((resolve, reject) => {
                  const handle = streamChatResponse({
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: augmentedPrompt },
                    ],
                    model: streamModel,
                    circleId,
                    // Only set on the escalation path. The chat-stream contract
                    // treats an absent/empty `tools` as the unchanged text-only
                    // request, so the default flag-off path sends no tools.
                    ...(streamTools ? { tools: streamTools } : {}),
                    onDelta: (text) => {
                      accumulated += text;
                      streamAccumulated = accumulated;
                      updateBotMessage(pendingMsg.id, { content: accumulated, isPending: false });
                    },
                    onUsage: (usage) => {
                      streamingUsage = usage;
                    },
                    // The SSE parser delivers the reassembled tool_use blocks +
                    // terminal stop_reason on the done result (additive — text-only
                    // turns leave toolUses empty and report end_turn). Captured here
                    // and only consulted under the `escalateOnToolUse` gate below.
                    onDone: (result) => {
                      if (result) {
                        streamToolUses = result.toolUses;
                        streamStopReason = result.stopReason;
                      }
                      resolve();
                    },
                    // W5 (P39): the second argument carries the interrupted
                    // terminal result (partial toolUses/stopReason) — capture
                    // it so the catch can tell pre-handshake from mid-stream.
                    onError: (msg, result) => {
                      streamInterruptedResult = result;
                      reject(new Error(msg));
                    },
                  });
                  // Store cancel handle in case we need to abort
                  streamingBuildCleanupRef.current = handle.cancel;
                });
                streamingBuildCleanupRef.current = null;
                // Phase 2 seam (DEFAULT OFF): if this escalation-capable stream
                // produced a tool_use (or stopped with stop_reason==='tool_use'),
                // upgrade THIS turn into the OpenSwan tool loop, reusing every
                // existing reliability layer. `maybeEscalateStreamedTurnToToolLoop`
                // re-checks the flag and no-ops to `{escalated:false}` when OFF or
                // when there is no tool-use signal, so on the default path (and on
                // a plain streamed answer) we fall through to the existing render/
                // persist path below with the streamed text untouched. When it
                // escalates, the loop's response becomes the authoritative answer
                // and flows through that same path.
                if (escalateOnToolUse && (streamToolUses.length > 0 || streamStopReason === 'tool_use')) {
                  try {
                    const { maybeEscalateStreamedTurnToToolLoop } = await import('../../../lib/swanbot');
                    const escalation = await maybeEscalateStreamedTurnToToolLoop({
                      streamedTurn: { stopReason: streamStopReason, content: streamToolUses.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })) },
                      systemPrompt,
                      userMessage: augmentedPrompt,
                      model: streamModel,
                      circleId,
                      userId: currentUserId || 'anonymous',
                      threadId: activeThreadId || undefined,
                      activePluginIds: activePlugins,
                      surface: 'main_chat',
                      mode: 'talk',
                    });
                    if (escalation.escalated && typeof escalation.response === 'string' && escalation.response.length > 0) {
                      accumulated = escalation.response;
                    }
                  } catch (escalationErr) {
                    console.warn('[ChatTab] stream→tool escalation failed, keeping streamed text:', escalationErr);
                  }
                }
                updateBotMessage(pendingMsg.id, {
                  content: accumulated,
                  isPending: false,
                  source: streamSource,
                  usage: streamingUsage,
                });
                // Post-stream: run memory extraction in background
                if (accumulated.length > 20) {
                  void (async () => {
                    try {
                      const { autoExtractAndSave } = await import('../../../lib/agentMemory');
                      await autoExtractAndSave(circleId, currentUserId || '', [
                        { role: 'user', text: cleanContent },
                        { role: 'assistant', text: accumulated },
                      ]);
                    } catch {}
                  })();
                }
                if (activeThreadId) {
                  saveRecoverableChatMessage(activeThreadId, {
                    ...pendingMsg,
                    content: accumulated,
                    source: streamSource,
                    usage: streamingUsage,
                    isPending: false,
                    timestamp: new Date(),
                  });
                }
                if (currentUserId && activeThreadId) {
                  persistMainChatBotMessageWithRetry({
                    circleId,
                    userId: currentUserId,
                    agentName,
                    content: accumulated,
                    threadId: activeThreadId,
                    localMessageId: pendingMsg.id,
                    source: streamSource,
                    usage: streamingUsage || null,
                    onError: (error) => console.error('[ChatTab] persist streaming msg:', error),
                    onPersisted: (dbId) => {
                      void removePendingBotMessage(activeThreadId, pendingMsg.id).catch(() => {});
                      setMessages(prev => prev.map((message) => (
                        message.id === pendingMsg.id ? { ...message, dbId } : message
                      )));
                    },
                  });
                }
                // X7 (P48): record the clean stream terminal so lane failure
                // rates have a denominator (successes count too).
                try {
                  const { recordChatLaneTerminalNow } = await import('../../../lib/chatLaneHealthRegistry');
                  recordChatLaneTerminalNow({ lane: 'stream', status: 'completed' });
                } catch {}
                setRunStatus('idle');
                setBotTyping(false);
                stopCodingWorkbench();
                return;
              } catch (streamErr) {
                // W5 (P39): normalize the stream terminal through the unified
                // lane boundary before deciding what to do. The invariant it
                // enforces: a MID-STREAM interruption with partial text on
                // screen is `interrupted`, not `failed` — silently re-running
                // the whole turn as batch would render the answer twice and
                // could double side effects on the escalation path. Only
                // pre-handshake / no-output failures keep the legacy batch
                // fallback (retry-safe: nothing was delivered).
                try {
                  const { normalizeStreamResult, summarizeChatLaneOutcomeForTelemetry } =
                    await import('../../../lib/chatLaneOutcome');
                  const laneOutcome = normalizeStreamResult({
                    result: streamInterruptedResult ?? null,
                    errorMessage: streamErr instanceof Error ? streamErr.message : String(streamErr),
                    text: streamAccumulated,
                    model: streamCandidateModel,
                  });
                  console.warn(
                    '[ChatTab] stream lane terminal:',
                    JSON.stringify(summarizeChatLaneOutcomeForTelemetry(laneOutcome)),
                  );
                  // X7 (P48): feed the per-lane health registry (observability only).
                  try {
                    const { recordChatLaneOutcomeNow } = await import('../../../lib/chatLaneHealthRegistry');
                    recordChatLaneOutcomeNow(laneOutcome);
                  } catch {}
                  if (laneOutcome.status === 'interrupted' && streamAccumulated.length > 0) {
                    const interruptedContent = `${streamAccumulated}\n\n⚠️ _Stream interrupted — the answer above may be incomplete. Say "continue" to pick up from here._`;
                    const interruptedSource: ChatMessageSource = streamSourceForRecovery || {
                      actor: agentName,
                      surface: 'main_chat_stream',
                      selectedModel,
                      effectiveModel: streamCandidateModel,
                    };
                    if (streamPendingMsgId) {
                      updateBotMessage(streamPendingMsgId, {
                        content: interruptedContent,
                        isPending: false,
                        source: interruptedSource,
                      });
                    }
                    // P62 (W5 regression fix): the partial lived ONLY in local
                    // React state — reload/thread switch dropped the whole
                    // answer while the user's question persisted, and
                    // "continue" had nothing to continue from. Persist it
                    // exactly like the clean-stream path above.
                    if (activeThreadId && streamPendingMsg) {
                      saveRecoverableChatMessage(activeThreadId, {
                        ...streamPendingMsg,
                        content: interruptedContent,
                        source: interruptedSource,
                        isPending: false,
                        timestamp: new Date(),
                      });
                    }
                    if (currentUserId && activeThreadId && streamPendingMsgId) {
                      const interruptedMsgId = streamPendingMsgId;
                      persistMainChatBotMessageWithRetry({
                        circleId,
                        userId: currentUserId,
                        agentName,
                        content: interruptedContent,
                        threadId: activeThreadId,
                        localMessageId: interruptedMsgId,
                        source: interruptedSource,
                        usage: null,
                        onError: (error) => console.error('[ChatTab] persist interrupted stream msg:', error),
                        onPersisted: (dbId) => {
                          void removePendingBotMessage(activeThreadId, interruptedMsgId).catch(() => {});
                          setMessages(prev => prev.map((message) => (
                            message.id === interruptedMsgId ? { ...message, dbId } : message
                          )));
                        },
                      });
                    }
                    streamingBuildCleanupRef.current = null;
                    setRunStatus('idle');
                    setBotTyping(false);
                    stopCodingWorkbench();
                    return;
                  }
                } catch (boundaryErr) {
                  // The boundary is observability + a stop decision — its own
                  // failure must never take down the legacy fallback.
                  console.warn('[ChatTab] lane-outcome normalize failed:', boundaryErr);
                }
                // P62: pre-handshake failure / zero-text interruption → batch
                // fallback. Remove the stream's empty pending bubble first —
                // the batch path creates and resolves its OWN bubble, so the
                // stream's orphan used to sit as an empty isPending message
                // forever.
                if (streamPendingMsgId) {
                  const orphanId = streamPendingMsgId;
                  setMessages(prev => prev.filter((message) => message.id !== orphanId));
                  if (activeThreadId) void removePendingBotMessage(activeThreadId, orphanId).catch(() => {});
                }
                console.warn('[ChatTab] Streaming failed, falling back to batch:', streamErr);
                // Fall through to batch path below
              }
            }

            setRunStatus('running');
            setActiveSubagent(null);
            setActiveDelegatedSubagents([]);
            pendingMessage = addPendingBotMessage(
              (isCodingGenerationRequest(cleanContent, sessionProfile) || isFigmaBuildRequest)
                ? 'BUILDING...\nOpenSwan is writing the first draft and preparing files.'
                // Use a verb from the shared rotation so the pending
                // stub matches the typing indicator's tone.
                : `${pickThinkingVerb(Math.floor(Date.now() / 1500))}…`,
            );
            const pendingMessageId = pendingMessage.id;
            const structured = await runOpenSwanSessionTurn({
              message: augmentedPrompt,
            context,
            connectedProviders: connectedProviderSet,
            surface: 'main_chat',
            chatSessionId: activeThreadId,
            mode: 'talk',
            title: cleanContent.slice(0, 100) || 'OpenSwan Session',
            goal: cleanContent.slice(0, 500),
            sessionProfile: resolvedSessionProfile,
            delegationMode: sessionDelegationMode,
            activePluginIds: activePlugins,
            metadata: {
              selectedModel: effectiveSelectedModel,
              effectiveModel: sendModel || null,
              threadId: activeThreadId,
              attachmentCount: currentAttachments.length,
              delegationMode: sessionDelegationMode,
              activePluginIds: activePlugins,
              selectedRecoveryOption: selectedRecoveryOption ? {
                optionId: selectedRecoveryOption.optionId,
                actor: selectedRecoveryOption.actor,
                source: selectedRecoveryOption.source,
                action: selectedRecoveryPolicy?.action || null,
                safetyMode: selectedRecoveryPolicy?.safetyMode || null,
                requiresApproval: selectedRecoveryPolicy?.requiresApproval || false,
                requiresFreshEvidence: selectedRecoveryPolicy?.requiresFreshEvidence || false,
                userActionRequired: selectedRecoveryPolicy?.userActionRequired || false,
                allowConnectedAgent: selectedRecoveryPolicy?.allowConnectedAgent || false,
                allowRuntimePatch: selectedRecoveryPolicy?.allowRuntimePatch || false,
                allowBrowserDesktopRetry: selectedRecoveryPolicy?.allowBrowserDesktopRetry || false,
                maxAttempts: selectedRecoveryPolicy?.maxAttempts || 0,
                userSummary: selectedRecoveryExecutionPlan?.userSummary || null,
                nextSteps: selectedRecoveryExecutionPlan?.nextSteps || [],
                stopConditions: selectedRecoveryExecutionPlan?.stopConditions || [],
                resolvedFromFollowup: recoveryFollowup ? {
                  confidence: recoveryFollowup.confidence,
                  reason: recoveryFollowup.reason,
                  originalMessage: content.slice(0, 240),
                } : null,
                messageId: selectedRecoveryOption.context?.messageId || null,
                runId: selectedRecoveryOption.context?.runId || null,
                sourceSurface: selectedRecoveryOption.context?.sourceSurface || null,
              } : null,
            },
            onStageChange: (stage, label) => {
              setRunStatus(stage === 'delegating' ? 'delegated' : 'running');
              setCurrentRunStep(label);
            },
            onDelegationPlan: (subagents) => {
              setActiveDelegatedSubagents(subagents);
              if (subagents[0]) {
                setActiveSubagent({
                  name: subagents[0].name,
                  icon: subagents[0].icon,
                  color: subagents[0].color,
                });
              }
            },
          });
            // Map the runtime's tool actions (rooms.create, circle.update_*,
            // agent.update_appearance, etc) into the UI's toolEvent shape
            // so the execution strip on the assistant message actually
            // shows "rooms.create — Created room X" instead of looking
            // like nothing happened. Previously hardcoded to [], which is
            // why "ask it to add a room and the screen just refreshes"
            // felt like a silent no-op.
            // X7 (P48): record the clean batch terminal so lane failure rates
            // have a denominator (visible routing fallback carried through).
            try {
              const { recordChatLaneTerminalNow } = await import('../../../lib/chatLaneHealthRegistry');
              recordChatLaneTerminalNow({
                lane: 'openswan_v2',
                status: 'completed',
                fallback: !!structured.routing?.routing_fallback,
              });
            } catch {}
            const runtimeToolEvents: OpenSwanToolEvent[] = (structured.toolEvents || []).map((evt: any) => ({
              tool: evt.tool,
              status: evt.status === 'passed' || evt.status === 'completed'
                ? 'passed'
                : evt.status === 'manual_required' ? 'manual_required'
                : evt.status === 'blocked' ? 'blocked'
                : 'failed',
              summary: evt.summary || evt.result || evt.tool,
            }));
            // When Claude ran tools but didn't type a natural-language
            // reply, synthesize a friendly confirmation from the tool
            // results so the user always sees SOMETHING in the message.
            const successfulToolSummaries = runtimeToolEvents
              .filter((e) => e.status === 'passed')
              .map((e) => e.summary)
              .filter(Boolean);
            const botResponse = (structured.response && structured.response.trim())
              ? structured.response
              : (successfulToolSummaries.length > 0
                  ? `Done:\n- ${successfulToolSummaries.join('\n- ')}`
                  : '');
            const { wikiRefs, researchRefs } = await buildChatInfluenceReferences({
              prompt: cleanContent,
              response: botResponse,
              circleId,
            });
            const executionStream = buildOpenSwanExecutionStream({
              toolEvents: runtimeToolEvents,
              verificationResults: structured.verificationResults,
            });
            const structuredSource: ChatMessageSource = {
              actor: agentName,
              surface: 'main_chat_openswan',
              selectedModel,
              effectiveModel: structured.usage?.model || sendModel || null,
              provider: structured.routing?.provider_routed || null,
            };
            updateBotMessage(pendingMessage.id, {
              content: botResponse,
              artifacts: structured.artifacts,
              wikiRefs,
              researchRefs,
              memoriesUsed: structured.memoriesUsed,
              memoryRefs: structured.memoryReferences,
              memoryRecommendations: structured.memoryRecommendations,
              executionStream,
              browserPlans: structured.browserPlans,
              browserPlanEvents: structured.browserPlanEvents,
              runId: structured.runId,
              taskPlan: structured.taskPlan,
              toolEvents: runtimeToolEvents,
              verificationResults: structured.verificationResults,
              delegatedSubagents: structured.delegatedSubagents,
              routing: structured.routing,
              source: structuredSource,
              usage: structured.usage,
              isPending: false,
            });
            if (profileRef.current) {
              profileRef.current = updateProfileFromMessage(profileRef.current, botResponse, false);
              saveUserProfile(profileRef.current).catch(() => {});
            }
            if (activeThreadId) {
              saveRecoverableChatMessage(activeThreadId, {
                ...pendingMessage,
                content: botResponse,
                artifacts: structured.artifacts,
                wikiRefs,
                researchRefs,
                memoriesUsed: structured.memoriesUsed,
                memoryRefs: structured.memoryReferences,
                memoryRecommendations: structured.memoryRecommendations,
                executionStream,
                browserPlans: structured.browserPlans,
                browserPlanEvents: structured.browserPlanEvents,
                runId: structured.runId,
                taskPlan: structured.taskPlan,
                toolEvents: runtimeToolEvents,
                verificationResults: structured.verificationResults,
                delegatedSubagents: structured.delegatedSubagents,
                routing: structured.routing,
                source: structuredSource,
                usage: structured.usage,
                isPending: false,
                timestamp: new Date(),
              });
            }
            if (currentUserId && activeThreadId) {
              persistMainChatBotMessageWithRetry({
                circleId,
                userId: currentUserId,
                agentName,
                content: botResponse,
                threadId: activeThreadId,
                localMessageId: pendingMessageId,
                source: structuredSource,
                usage: structured.usage || null,
                artifacts: structured.artifacts,
                wikiRefs,
                researchRefs,
                memoriesUsed: structured.memoriesUsed,
                memoryRefs: structured.memoryReferences,
                memoryRecommendations: structured.memoryRecommendations,
                executionStream,
                browserPlans: structured.browserPlans,
                browserPlanEvents: structured.browserPlanEvents,
                routing: structured.routing,
                onError: (error) => {
                  console.error('[ChatTab] Unexpected error persisting bot msg:', error);
                },
                onPersisted: (dbId) => {
                  void removePendingBotMessage(activeThreadId, pendingMessageId).catch(() => {});
                  setMessages(prev => prev.map((message) => (
                    message.id === pendingMessageId ? { ...message, dbId } : message
                  )));
                },
              });
            }
            const handoff = detectHandoff(botResponse, 'main_chat');
            if (handoff) {
              setPendingHandoff(handoff);
            }
            setRunStatus('idle');
            setActiveSubagent(null);
            setActiveDelegatedSubagents([]);
            setCurrentRunStep('');
          } catch (batchErr) {
            const batchMessage = batchErr instanceof Error ? batchErr.message : String(batchErr || 'Unknown error');
            const batchStack = batchErr instanceof Error ? batchErr.stack || null : null;
            // W5/X1: classify this lane terminal through the unified boundary
            // so the archive carries the two-axis recovery signal per lane
            // (telemetry only — the recovery flow below stays authoritative).
            let batchLaneTags: string[] = [];
            try {
              const { normalizeThrownError, buildChatLaneOutcomeTags, summarizeChatLaneOutcomeForTelemetry } =
                await import('../../../lib/chatLaneOutcome');
              const laneOutcome = normalizeThrownError('openswan_v2', batchErr);
              batchLaneTags = buildChatLaneOutcomeTags(laneOutcome);
              console.warn('[ChatTab] lane terminal:', JSON.stringify(summarizeChatLaneOutcomeForTelemetry(laneOutcome)));
              // X7 (P48): registry + degradation-scope tags (lane-isolated vs multi-lane).
              const { recordChatLaneOutcomeNow, buildChatLaneHealthTags } =
                await import('../../../lib/chatLaneHealthRegistry');
              recordChatLaneOutcomeNow(laneOutcome);
              batchLaneTags = [...batchLaneTags, ...buildChatLaneHealthTags('openswan_v2', Date.now())];
            } catch {}
            recordSessionArchiveError(
              `OpenSwan session failed: ${batchMessage}`,
              batchStack,
              ['surface:main_chat', 'runtime:openswan', ...batchLaneTags],
            );
            const recovery = await startMainChatFailureRecoveryPayload({
              task: cleanContent,
              failureMessage: batchMessage,
              failureStack: batchStack,
              outcomeStatus: 'failed',
              executionKind: 'run_openswan',
              source: 'main_chat_openswan_batch',
              launchIfMissing: true,
              touched: ['surface:main_chat', 'runtime:openswan'],
            });
            const errorMessage = (isCodingGenerationRequest(cleanContent, sessionProfile) || isFigmaBuildRequest)
              ? "Build failed before OpenSwan could finish the draft."
              : "OpenSwan failed before it could finish this chat task.";
            const errorSource: ChatMessageSource = {
              actor: agentName,
              surface: 'main_chat_openswan_error',
              selectedModel,
              effectiveModel: sendModel || null,
            };
            if (pendingMessage) {
              updateBotMessage(pendingMessage.id, {
                content: appendCustomerSafeRecoveryMessage(`${errorMessage} Technical details were saved for recovery.`, recovery.message),
                isPending: false,
                recoveryOptions: recovery.recoveryOptions,
                recoveryReliability: recovery.recoveryReliability,
                source: errorSource,
              });
            } else {
              addBotMessage(appendCustomerSafeRecoveryMessage(`${errorMessage} Technical details were saved for recovery.`, recovery.message), undefined, {
                localOnly: true,
                recoveryOptions: recovery.recoveryOptions,
                recoveryReliability: recovery.recoveryReliability,
                source: errorSource,
              });
            }
            setRunStatus('idle');
            setActiveSubagent(null);
            setActiveDelegatedSubagents([]);
          }
        }
      } catch (err) {
        const chatErrorMessage = err instanceof Error ? err.message : String(err || 'Unknown error');
        const chatErrorStack = err instanceof Error ? err.stack || null : null;
        // W5/X1: the outermost sendMessage boundary — normalize + tag so an
        // unshaped failure is still legible as a lane terminal in the archive.
        let outerLaneTags: string[] = [];
        try {
          const { normalizeThrownError, buildChatLaneOutcomeTags, summarizeChatLaneOutcomeForTelemetry } =
            await import('../../../lib/chatLaneOutcome');
          const laneOutcome = normalizeThrownError('send_message', err);
          outerLaneTags = buildChatLaneOutcomeTags(laneOutcome);
          console.warn('[ChatTab] lane terminal:', JSON.stringify(summarizeChatLaneOutcomeForTelemetry(laneOutcome)));
          // X7 (P48): registry + degradation-scope tags.
          const { recordChatLaneOutcomeNow, buildChatLaneHealthTags } =
            await import('../../../lib/chatLaneHealthRegistry');
          recordChatLaneOutcomeNow(laneOutcome);
          outerLaneTags = [...outerLaneTags, ...buildChatLaneHealthTags('send_message', Date.now())];
        } catch {}
        recordSessionArchiveError(
          `Chat execution failed: ${chatErrorMessage}`,
          chatErrorStack,
          ['surface:main_chat', ...outerLaneTags],
        );
        const errorMessage = (isCodingGenerationRequest(cleanContent, sessionProfile) || isFigmaBuildRequest)
          ? "Build failed before OpenSwan could finish the draft. Try again."
          : "Something went wrong. Try again.";
        const recovery = await startMainChatFailureRecoveryPayload({
          task: cleanContent,
          failureMessage: chatErrorMessage,
          failureStack: chatErrorStack,
          outcomeStatus: 'failed',
          executionKind: 'main_chat_execution',
          source: 'main_chat_outer_catch',
          launchIfMissing: true,
          touched: ['surface:main_chat'],
        });
        setMessages((prev) => {
          const pendingIndex = [...prev].reverse().findIndex((entry) => entry.isBot && entry.isPending);
          if (pendingIndex === -1) {
            return [...prev, {
              id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              content: `${errorMessage}${recovery.message}`,
              isBot: true,
              isUser: false,
              userName: agentName,
              timestamp: new Date(),
              reactions: {},
              recoveryOptions: recovery.recoveryOptions,
              recoveryReliability: recovery.recoveryReliability,
              isPending: false,
            }];
          }
          const actualIndex = prev.length - 1 - pendingIndex;
          return prev.map((entry, index) => (
            index === actualIndex
              ? { ...entry, content: `${errorMessage}${recovery.message}`, recoveryOptions: recovery.recoveryOptions, recoveryReliability: recovery.recoveryReliability, isPending: false }
              : entry
          ));
        });
        setRunStatus('idle');
        setActiveSubagent(null);
        setActiveDelegatedSubagents([]);
        setCurrentRunStep('');
      }
      setBotTyping(false);
      stopCodingWorkbenchAfter((isCodingGenerationRequest(cleanContent, sessionProfile) || isFigmaBuildRequest) ? 2600 : 0);
    }
  };

  const handleQuickActionSelection = useCallback((text: string) => {
    const execution = resolveQuickActionExecution(text);
    const actionText = execution.text;
    const mode = execution.mode;

    if (actionText === '__SEND_CRYPTO__') { setShowSendCrypto(true); return; }
    if (actionText === '__TIP__') {
      setShowSendCrypto(true);
      setSendAmount('0.001');
      return;
    }
    if (actionText === '__CHECK_IN__') { setShowQuickCheckIn(true); return; }
    if (actionText === '__NEW_TASK__') { setShowQuickNewTask(true); return; }
    if (actionText === '__STEP_AWAY__') { setShowQuickStepAway(true); return; }
    if (actionText === '__ASSIGN_AGENT__') { setShowAssignPanel(true); setShowSpawnPanel(false); return; }
    if (actionText === '__SPAWN_AGENT__') { setSpawnModalOpen(true); return; }
    if (actionText === '__MY_WALLET__') {
      if (Platform.OS !== 'web') {
        addBotMessage('Wallet status is only available on web right now.');
        return;
      }
      void (async () => {
        try {
          const { getAllWalletStates, getConnectedWallet } = await import('../../../lib/crypto');
          const [connectedWallet, walletStates] = await Promise.all([
            getConnectedWallet(),
            getAllWalletStates(),
          ]);
          const activeWallet = connectedWallet || wallet;
          const lines = [
            walletStates.metamask.available
              ? `🦊 MetaMask: ${walletStates.metamask.address ? `connected ${shortenAddress(walletStates.metamask.address)}` : 'installed, not connected'}`
              : '🦊 MetaMask: not installed',
            walletStates.phantom.available
              ? `👻 Phantom: ${walletStates.phantom.address ? `connected ${shortenAddress(walletStates.phantom.address)}` : 'installed, not connected'}`
              : '👻 Phantom: not installed',
          ];
          const activeLine = activeWallet
            ? `\n\nActive wallet: **${activeWallet.chain === 'ethereum' ? 'Ethereum' : 'Solana'}** — \`${shortenAddress(activeWallet.address)}\``
            : '\n\nNo active wallet selected.';
          addBotMessage(`**Wallet status**\n\n${lines.join('\n')}${activeLine}`);
        } catch (error: any) {
          addBotMessage('I could not load wallet status right now. Try again in a moment.');
        }
      })();
      return;
    }
    if (actionText === '__COMPUTER_USE__') {
      if (Platform.OS !== 'web') return;
      // Opens the in-app console instead of window.prompt — nicer UX, and
      // gives room for template chips + saved tasks. The console submits
      // back via onSubmit → runComputerUseTaskFromConsole.
      setShowComputerUseConsole(true);
      return;
    }
    if (actionText === '__OPENSWAN__') {
      if (Platform.OS !== 'web') return;
      // Opens the OpenSwan console — user picks a mode + writes a task,
      // onSubmit routes through the planner with `run_openswan` + selected
      // mode so the dispatcher + response contract apply.
      setOpenSwanInitialTask(input.trim());
      setShowOpenSwanConsole(true);
      return;
    }
    if (actionText === '__PAIR_DESKTOP__') {
      if (Platform.OS !== 'web') return;
      (async () => {
        try {
          await addDesktopBridgeAutoConnectMessage('desktop_bridge_pairing');
        } catch (error: any) {
          await addRecoverableChatErrorMessage({
            title: 'Desktop bridge pairing failed',
            task: 'Pair the local desktop bridge from chat',
            error,
            executionKind: 'desktop_bridge_pairing',
            source: 'pair_desktop_bridge_error',
            touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/desktopBridge.ts', 'scripts/claude-bridge.js'],
          });
        }
      })();
      return;
    }
    if (actionText === '__NUKE__') {
      const msg = 'Delete the current chat thread? This cannot be undone.';
      if (Platform.OS === 'web') {
        if (window.confirm(msg)) void nukeCurrentThread();
      } else {
        import('react-native').then(({ Alert }) => Alert.alert('Nuke Chat', msg, [
          { text: 'Cancel' },
          { text: 'Delete Thread', style: 'destructive', onPress: () => { void nukeCurrentThread(); } },
        ]));
      }
      return;
    }

    if (mode === 'prefill') {
      setInput(actionText);
      inputRef.current?.focus();
      return;
    }

    sendMessage(actionText);
  }, [nukeCurrentThread, sendMessage, wallet]);

  // ─── Governance Handlers ─────────────────────────────────────────────────

  const handleCreatePoll = async (question: string, options: string[]) => {
    const result = await createQuickPoll(circleId, question, options);
    if (result.ok && result.proposal) {
      addBotMessage(`📊 **Poll created:** "${question}"\n\nOptions: ${options.map((o, i) => `\n${i + 1}. ${o}`).join('')}\n\nVote now! 🗳️`);
      const props = await getProposals(circleId, 'active');
      setProposals(props);
    } else {
      addBotMessage('I could not create that poll. Check the options and try again.');
    }
    setShowCreatePoll(false);
  };

  const handleCreateProposal = async (title: string, description?: string) => {
    const result = await createYesNoProposal(circleId, title, description);
    if (result.ok && result.proposal) {
      addBotMessage(`📜 **Proposal created:** "${title}"\n\n${description || ''}\n\nVote YES or NO! Every member gets one vote. ⚖️`);
      const props = await getProposals(circleId, 'active');
      setProposals(props);
    } else {
      addBotMessage('I could not create that proposal. Check the title and try again.');
    }
    setShowCreateProposal(false);
  };

  const handleVote = async (proposalId: string, vote: string) => {
    const result = await castVote(proposalId, vote);
    if (result.ok) {
      // Refresh proposals
      const props = await getProposals(circleId, 'active');
      setProposals(props);
    } else {
      addBotMessage('I could not record that vote. Try again in a moment.');
    }
  };

  const handleResolve = async (proposalId: string) => {
    const result = await resolveProposal(proposalId);
    if (result.ok) {
      addBotMessage(`⚡ **Vote finalized:** ${result.status === 'passed' ? '✅ PASSED' : '❌ FAILED'}`);
      const props = await getProposals(circleId, 'active');
      setProposals(props);
    }
  };

  const handlePinMessage = async (messageId: string) => {
    const msg = messages.find(m => m.dbId === messageId || m.id === messageId);
    const result = await pinMessage(circleId, messageId);
    if (result.ok) {
      addBotMessage(`📌 Message pinned!`);
      const pins = await getPinnedMessages(circleId);
      setPinnedMessages(pins);
    }
  };

  // ─── Flywheel outcome signal (Cursor-Tab precedent) ─────────────────────────
  // Stamp the machine-derived verdict and/or the user's accept/reject/edit-
  // resend/steer signal onto a bot message so it becomes BlackSwan training
  // data. Fully additive + non-blocking: it updates local state and best-effort
  // re-persists the compact enums into the row metadata. A persistence failure
  // must NEVER affect the chat UI, so everything below is wrapped/swallowed.
  const stampOutcomeSignalRef = useRef<(messageId: string, patch: { verdict?: ChatOutcomeVerdict; signal?: ChatUserSignal }) => void>(() => {});
  stampOutcomeSignalRef.current = (
    messageId: string,
    patch: { verdict?: ChatOutcomeVerdict; signal?: ChatUserSignal },
  ) => {
    if (!patch || (!patch.verdict && !patch.signal)) return;
    let target: ChatMessage | null = null;
    setMessages((prev) => prev.map((msg) => {
      if (msg.id !== messageId || !msg.isBot) return msg;
      const prior = msg.outcomeSignal || undefined;
      // Never downgrade a real verdict back to 'unknown' (a later reaction
      // carries no verdict); keep the strongest info we already have.
      const nextVerdict = patch.verdict && patch.verdict !== 'unknown'
        ? patch.verdict
        : prior?.verdict || patch.verdict || 'unknown';
      const merged: NonNullable<ChatMessage['outcomeSignal']> = {
        verdict: nextVerdict,
        signal: patch.signal || prior?.signal,
        lane: prior?.lane || msg.source?.surface || undefined,
        model: prior?.model
          || msg.source?.effectiveModel
          || msg.source?.selectedModel
          || undefined,
      };
      target = { ...msg, outcomeSignal: merged };
      return target;
    }));
    // Best-effort durable persistence: read-modify-write the row metadata with
    // the tiny outcome enums. Guarded so nothing here can surface to the user.
    try {
      const row = target as ChatMessage | null;
      if (!row?.dbId || !row.outcomeSignal) return;
      const existing = readPersistedChatBotMetadata(row.content) as PersistedChatBotMetadata | null;
      const visible = stripPersistedChatBotPrefix(row.content);
      const nextContent = formatPersistedChatBotMessage(agentName, visible, {
        ...(existing || {}),
        outcomeSignal: row.outcomeSignal,
      });
      if (nextContent === row.content) return;
      void updateChatMessageContent(row.dbId, nextContent).catch(() => {});
    } catch {
      // swallow — telemetry must never break chat
    }
  };

  // ─── Reactions ────────────────────────────────────────────────────────────

  const toggleReaction = (messageId: string, emoji: string) => {
    let addedReaction = false;
    setMessages(prev => prev.map(msg => {
      if (msg.id !== messageId) return msg;
      const reactions = { ...msg.reactions };
      const uid = currentUserId || 'me';
      const users = reactions[emoji] || [];
      if (users.includes(uid)) {
        reactions[emoji] = users.filter(u => u !== uid);
        if (reactions[emoji].length === 0) delete reactions[emoji];
      } else {
        reactions[emoji] = [...users, uid];
        addedReaction = true;
        // Trigger floating emoji
        addFloatingReaction(emoji, 200 + Math.random() * 100, 300 + Math.random() * 100);
      }
      return { ...msg, reactions };
    }));
    setShowReactions(null);
    // Flywheel: an ADDED 👍/👎 is an explicit accept/reject the user made —
    // record it as training signal. Removing a reaction is ambiguous, so we
    // leave any prior signal intact.
    if (addedReaction) {
      const signal = mapReactionToSignal(emoji);
      if (signal) stampOutcomeSignalRef.current(messageId, { signal });
    }
  };

  // ─── Delete Message ───────────────────────────────────────────────────

  const deleteMessage = async (messageId: string, dbId?: string) => {
    // Track deletion of bot messages for behavior learning
    const deletedMsg = messages.find(m => m.id === messageId);
    if (deletedMsg?.isBot && profileRef.current) {
      profileRef.current = updateProfileFromDeletion(profileRef.current);
      saveUserProfile(profileRef.current).catch(() => {});
    }
    // Remove from local state immediately
    setMessages(prev => prev.filter(m => m.id !== messageId));
    // Delete from Supabase if persisted
    if (dbId) {
      await supabase.from('messages').delete().eq('id', dbId);
    }
  };

  // ─── Input & Mentions ────────────────────────────────────────────────────

  const handleInputChange = (text: string) => {
    setInput(text);
    if (text.trimStart().startsWith('/')) {
      setShowMentions(false);
      return;
    }
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      const afterAt = text.slice(lastAt + 1);
      if (!afterAt.includes(' ') && afterAt.length < 20) {
        setShowMentions(true);
        setMentionQuery(afterAt.toLowerCase());
        return;
      }
    }
    setShowMentions(false);
  };

  const handleChangeAgentAvatar = useCallback(async () => {
    const picked = await pickAttachments();
    const first = picked[0];
    if (!first) return;

    const persistentUri = first.base64
      ? `data:${first.mimeType};base64,${first.base64}`
      : first.uri;

    setAgentAvatarUri(persistentUri);
    await saveChatAgentAvatar(circleId, persistentUri);
  }, [circleId]);

  const handleResetAgentAvatar = useCallback(async () => {
    setAgentAvatarUri(null);
    await clearChatAgentAvatar(circleId);
  }, [circleId]);

  const insertMention = (member: any) => {
    const lastAt = input.lastIndexOf('@');
    const before = input.slice(0, lastAt);
    setInput(`${before}@${member.username} `);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const filteredMembers = members.filter(
    (m) =>
      m.username?.toLowerCase().includes(mentionQuery) ||
      m.display_name?.toLowerCase().includes(mentionQuery)
  );

  const handleRetryVerificationCheck = useCallback(async (message: ChatMessage, checkId: string) => {
    if (!message.taskPlan) return;
    const check = message.taskPlan.verification.find((entry) => entry.id === checkId);
    if (!check) return;

    setRetryingLedgerCheck({ messageId: message.id, checkId });
    let nextToolEvents = [...(message.toolEvents || [])];

    try {
      const result = await executeOpenSwanVerificationCheck(check, {
        onToolEvent: (event) => {
          nextToolEvents = [...nextToolEvents, event];
          const nextExecutionStream = buildOpenSwanExecutionStream({
            toolEvents: nextToolEvents,
            verificationResults: message.verificationResults || [],
          });
          let nextMessageToPersist: ChatMessage | null = null;
          setMessages((prev) => prev.map((entry) => {
            if (entry.id !== message.id) return entry;
            nextMessageToPersist = { ...entry, toolEvents: nextToolEvents, executionStream: nextExecutionStream };
            return nextMessageToPersist;
          }));
          syncSessionArchiveMessage(nextMessageToPersist);
          if (message.runId && circleId) {
            void appendRunToolEvent({ runId: message.runId, circleId, event });
            void mergeRunMetadata(message.runId, { tool_events: nextToolEvents, execution_stream: nextExecutionStream });
          }
        },
      });

      const nextVerificationResults = upsertOpenSwanVerificationResult(
        message.verificationResults || [],
        result,
      );
      const nextExecutionStream = buildOpenSwanExecutionStream({
        toolEvents: nextToolEvents,
        verificationResults: nextVerificationResults,
      });

      let nextMessageToPersist: ChatMessage | null = null;
      setMessages((prev) => prev.map((entry) => {
        if (entry.id !== message.id) return entry;
        nextMessageToPersist = {
          ...entry,
          toolEvents: nextToolEvents,
          verificationResults: nextVerificationResults,
          executionStream: nextExecutionStream,
        };
        return nextMessageToPersist;
      }));
      syncSessionArchiveMessage(nextMessageToPersist);
      recordSessionArchiveEvent({
        kind: 'verification',
        summary: result.summary,
        touched: [
          `check:${result.check.label}`,
          result.command ? `command:${result.command}` : '',
        ].filter(Boolean),
        metadata: {
          checkId: result.check.id,
          status: result.status,
          ok: result.ok,
          executed: result.executed,
        },
      });

      if (message.runId) {
        void mergeRunMetadata(message.runId, {
          tool_events: nextToolEvents,
          verification_results: nextVerificationResults,
          execution_stream: nextExecutionStream,
        });
      }
    } finally {
      setRetryingLedgerCheck((current) => (
        current?.messageId === message.id && current.checkId === checkId ? null : current
      ));
    }
  }, [circleId, recordSessionArchiveEvent, syncSessionArchiveMessage]);

  const handlePromoteMemoryRef = useCallback(async (ref: PromptMemoryReference) => {
    const ok = await promoteMemory(ref.id);
    if (!ok) {
      setMemoryToast({ message: 'Could not promote memory', type: 'conflict' });
      return;
    }
    void recordMemoryFeedback({
      memoryId: ref.id,
      action: 'promoted',
      note: ref.matchReason || 'Promoted from memory influence card',
      userId: currentUserId || undefined,
      source: 'chat_memory_influence',
    });
    setMemoryToast({ message: `Promoted "${ref.title.slice(0, 42)}"`, type: 'updated' });
    if (activeSpiritId && currentUserId) {
      getLatestSpiritMemoryReferences({
        spiritId: activeSpiritId,
        circleId,
        userId: currentUserId,
        limit: 4,
      }).then(setSoulMemoryRefs).catch(() => {});
    }
  }, [activeSpiritId, circleId, currentUserId]);

  const handlePinMemoryRef = useCallback(async (ref: PromptMemoryReference) => {
    const ok = await pinMemory(ref.id);
    if (!ok) {
      setMemoryToast({ message: 'Could not pin memory', type: 'conflict' });
      return;
    }
    void recordMemoryFeedback({
      memoryId: ref.id,
      action: 'pinned',
      note: ref.matchReason || 'Pinned from memory influence card',
      userId: currentUserId || undefined,
      source: 'chat_memory_influence',
    });
    setMemoryToast({ message: `Pinned "${ref.title.slice(0, 42)}"`, type: 'updated' });
  }, [currentUserId]);

  const handleMemoryNotHelpful = useCallback(async (ref: PromptMemoryReference) => {
    const ok = await decayMemoryImportance(ref.id);
    if (!ok) {
      setMemoryToast({ message: 'Could not mark memory as not helpful', type: 'conflict' });
      return;
    }
    void recordMemoryFeedback({
      memoryId: ref.id,
      action: 'not_helpful',
      note: ref.matchReason || 'Marked not helpful from memory influence card',
      userId: currentUserId || undefined,
      source: 'chat_memory_influence',
    });
    setMemoryToast({ message: `Downranked "${ref.title.slice(0, 42)}"`, type: 'updated' });
  }, [currentUserId]);

  const handleForgetMemoryRef = useCallback(async (ref: PromptMemoryReference) => {
    if (!currentUserId) return;
    const ok = await softDeleteMemory(ref.id, currentUserId, 'chat_memory_forget');
    if (!ok) {
      setMemoryToast({ message: 'Could not forget memory', type: 'conflict' });
      return;
    }
    setMemoryToast({ message: `Forgot "${ref.title.slice(0, 42)}"`, type: 'forgotten' });
    if (activeSpiritId) {
      getLatestSpiritMemoryReferences({
        spiritId: activeSpiritId,
        circleId,
        userId: currentUserId,
        limit: 4,
      }).then(setSoulMemoryRefs).catch(() => {});
    }
  }, [activeSpiritId, circleId, currentUserId]);

  const handleRememberResponse = useCallback(async (message: ChatMessage) => {
    if (!currentUserId) return;
    const trimmed = (message.content || '').trim();
    if (!trimmed) return;
    const content = trimmed.length > 700 ? `${trimmed.slice(0, 697)}...` : trimmed;
    const saved = await rememberFromChat(circleId, currentUserId, content, 'context');
    if (!saved) {
      setMemoryToast({ message: 'Could not save response to memory', type: 'conflict' });
      return;
    }
    setMemoryToast({ message: `Remembered response: "${saved.title.slice(0, 42)}"`, type: 'saved' });
  }, [circleId, currentUserId]);

  const handleApplyMemoryRecommendation = useCallback(async (recommendation: OpenSwanMemoryRecommendation) => {
    if (!currentUserId) return;
    const ok = await applyOpenSwanMemoryRecommendation({
      circleId,
      userId: currentUserId,
      agentId: 'openswan:main_chat',
      agentName,
      recommendation,
    });
    if (!ok) {
      setMemoryToast({ message: 'Could not apply memory recommendation', type: 'conflict' });
      return;
    }
    setMemoryToast({
      message: recommendation.recommendationType === 'promote_existing'
        ? `Promoted "${recommendation.title.slice(0, 42)}"`
        : `Saved recommendation: "${recommendation.title.slice(0, 42)}"`,
      type: 'saved',
    });
    if (activeSpiritId) {
      getLatestSpiritMemoryReferences({
        spiritId: activeSpiritId,
        circleId,
        userId: currentUserId,
        limit: 4,
      }).then(setSoulMemoryRefs).catch(() => {});
    }
  }, [activeSpiritId, agentName, circleId, currentUserId]);

  // ─── Render Helpers ──────────────────────────────────────────────────────

  const renderContent = (item: ChatMessage) => {
    const routeChips = buildMessageRouteChips(item);
    const handoffMetadata = item.computerHandoff || null;
    const appChoiceCard = buildChatAppChoiceCard(handoffMetadata);
    const designTaskCard = buildChatDesignTaskCardModel(handoffMetadata);
    const recoveryReliabilityCard = buildRecoveryReliabilityCard(item.recoveryReliability);
    const visibleContent = item.recoveryOptions && item.recoveryOptions.length > 0
      ? stripChatFailureRecoveryOptionsText(item.content)
      : item.content;
    const bodyContent = appChoiceCard
      ? stripChatAppChoiceLine(visibleContent, handoffMetadata?.requestNotice?.appChoiceLine)
      : visibleContent;
    const hasPlanCard = !!item.chatAutomationPlanPreview;
    const hasRecoveryOptions = !!(item.recoveryOptions && item.recoveryOptions.length > 0);
    // P22: computer/desktop/app-task messages collapse their explanatory cards
    // behind ONE "Details" disclosure. Everything else renders byte-identical.
    const isComputerTaskMessage = !!handoffMetadata || !!recoveryReliabilityCard || hasPlanCard;
    const computerSummaryLine = isComputerTaskMessage
      ? buildComputerTaskSummaryLine({ handoff: handoffMetadata, appChoiceCard, body: bodyContent })
      : '';
    // Status cue comes only from data the metadata already carries.
    const failedSummaryPrefix = recoveryReliabilityCard || hasRecoveryOptions
      ? item.recoveryReliability?.userActionRequired
        ? 'Needs your input'
        : "Couldn't finish"
      : null;
    const disclosureStatusTone: 'neutral' | 'attention' | 'approval' | 'complete' = failedSummaryPrefix
      ? item.recoveryReliability?.userActionRequired ? 'approval' : 'attention'
      : 'neutral';
    // Display-only Route override so the Plan card shows a desktop-accurate
    // Route for desktop/app tasks (routeId semantics unchanged).
    const planRouteLabelOverride = formatHandoffSurfaceRouteLabel(handoffMetadata);

    // ── SIGNATURE Receipt (the #1 branding/capability gap) ──────────────────
    // At-a-glance "what did the agent do → who approved → proof → verified?"
    // assembled from data already on this bot message. Additive + non-blocking:
    // plain chat replies yield null (shouldRenderReceipt === false) and render
    // byte-identically. Retry re-sends the original user prompt when one is
    // trivially recoverable AND the turn didn't cleanly complete; undo has no
    // safe generic implementation, so it stays undefined (button hidden).
    const priorUserPrompt = item.isBot ? findPriorUserPromptForMessage(messages, item.id) : null;
    const verdictNeedsRetry = item.outcomeSignal?.verdict === 'failed'
      || item.outcomeSignal?.verdict === 'partial'
      || item.outcomeSignal?.verdict === 'blocked'
      || hasRecoveryOptions;
    const agentReceipt = item.isBot
      ? buildAgentReceipt({
          content: item.content,
          computerHandoff: handoffMetadata,
          artifacts: item.artifacts,
          computerFindings: item.computerFindings,
          browserPlans: item.browserPlans,
          toolEvents: item.toolEvents,
          recoveryOptions: item.recoveryOptions,
          outcomeSignal: item.outcomeSignal,
          canRetry: !!priorUserPrompt && verdictNeedsRetry,
        })
      : null;
    const receiptBlock = agentReceipt && shouldRenderReceipt(agentReceipt) ? (
      <AgentReceiptCard
        receipt={agentReceipt}
        onRetry={priorUserPrompt && agentReceipt.canRetry
          ? () => { void sendMessage(priorUserPrompt); }
          : undefined}
      />
    ) : null;

    // ── Relocatable explanatory blocks (verbatim JSX; only their PLACEMENT
    //    changes for computer-task messages — collapsed into the disclosure). ──
    const appChoiceBlock = appChoiceCard ? (
      <View style={styles.appChoiceSection}>
        <View style={styles.appChoiceCard}>
          <View style={styles.appChoiceHeader}>
            <View style={styles.appChoiceTitleWrap}>
              <Text style={styles.messageSourceLabel}>App Choice</Text>
              <Text style={styles.appChoiceTitle} numberOfLines={1}>
                Using {appChoiceCard.selectedAppName}
              </Text>
            </View>
            <View style={styles.appChoicePill}>
              <Text style={styles.appChoicePillText} numberOfLines={1}>
                {appChoiceCard.availabilityLabel}
              </Text>
            </View>
          </View>
          <Text style={styles.appChoiceMeta} numberOfLines={1}>
            {appChoiceCard.surfaceLabel}{appChoiceCard.openStep ? ` · ${appChoiceCard.openStep}` : ''}
          </Text>
          <Text style={styles.appChoiceReason} numberOfLines={2}>{appChoiceCard.reason}</Text>
          {appChoiceCard.alternatives.length > 0 ? (
            <View style={styles.appChoiceAlternativeRow}>
              {appChoiceCard.alternatives.map((alternative) => (
                <Pressable
                  key={alternative}
                  onPress={() => {
                    setInput(`use ${alternative} instead`);
                    inputRef.current?.focus();
                  }}
                  style={styles.appChoiceAlternative}
                  accessibilityLabel={`Use ${alternative} instead`}
                >
                  <Text style={styles.appChoiceAlternativeText} numberOfLines={1}>
                    Use {alternative}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : appChoiceCard.switchHint ? (
            <Text style={styles.appChoiceHint} numberOfLines={1}>{appChoiceCard.switchHint}</Text>
          ) : null}
        </View>
      </View>
    ) : null;

    const designTaskBlock = designTaskCard ? (
      <View style={[styles.messageSourceSection, styles.designTaskSection]}>
        <Text style={styles.messageSourceLabel}>Design Task</Text>
        <View
          style={[
            styles.designTaskCard,
            designTaskCard.statusTone === 'attention' && styles.designTaskCardAttention,
            designTaskCard.statusTone === 'approval' && styles.designTaskCardApproval,
            designTaskCard.statusTone === 'complete' && styles.designTaskCardComplete,
          ]}
        >
          <View style={styles.designTaskHeader}>
            <View style={styles.designTaskTitleWrap}>
              <Text style={styles.designTaskTitle} numberOfLines={1}>{designTaskCard.title}</Text>
              <Text style={styles.designTaskSubtitle} numberOfLines={1}>{designTaskCard.subtitle}</Text>
            </View>
            <View
              style={[
                styles.designTaskStatusPill,
                designTaskCard.statusTone === 'attention' && styles.designTaskStatusAttention,
                designTaskCard.statusTone === 'approval' && styles.designTaskStatusApproval,
                designTaskCard.statusTone === 'complete' && styles.designTaskStatusComplete,
              ]}
            >
              <Text style={styles.designTaskStatusText}>{designTaskCard.statusLabel}</Text>
            </View>
          </View>
          {designTaskCard.packageSummary ? (
            <Text style={styles.designTaskMeta} numberOfLines={1}>Package: {designTaskCard.packageSummary}</Text>
          ) : null}
          {designTaskCard.creativeAiSummary ? (
            <Text style={styles.designTaskMeta} numberOfLines={1}>AI: {designTaskCard.creativeAiSummary}</Text>
          ) : null}
          <View style={styles.designTaskOperationRow}>
            {designTaskCard.operations.slice(0, 4).map((operation) => (
              <View key={operation} style={styles.designTaskOperationPill}>
                <Text style={styles.designTaskOperationText} numberOfLines={1}>{operation}</Text>
              </View>
            ))}
          </View>
          <View style={styles.designTaskPhaseRow}>
            {designTaskCard.phases.map((phase) => (
              <View key={phase.id} style={styles.designTaskPhaseItem}>
                <View
                  style={[
                    styles.designTaskPhaseDot,
                    phase.state === 'done' && styles.designTaskPhaseDone,
                    phase.state === 'current' && styles.designTaskPhaseCurrent,
                    phase.state === 'blocked' && styles.designTaskPhaseBlocked,
                  ]}
                />
                <Text
                  style={[
                    styles.designTaskPhaseLabel,
                    phase.state === 'current' && styles.designTaskPhaseLabelCurrent,
                    phase.state === 'blocked' && styles.designTaskPhaseLabelBlocked,
                  ]}
                  numberOfLines={1}
                >
                  {phase.label}
                </Text>
              </View>
            ))}
          </View>
          <Text style={styles.designTaskNextAction} numberOfLines={2}>Next: {designTaskCard.nextAction}</Text>
          {designTaskCard.proofSignals.length > 0 ? (
            <Text style={styles.designTaskProof} numberOfLines={2}>
              Proof: {designTaskCard.proofSignals.slice(0, 2).join('; ')}
            </Text>
          ) : null}
          {designTaskCard.reviewChecklist.length > 0 ? (
            <Text style={styles.designTaskReview} numberOfLines={2}>
              Review: {designTaskCard.reviewChecklist.slice(0, 3).join('; ')}
            </Text>
          ) : null}
        </View>
      </View>
    ) : null;

    const bodyTextBlock = (
      <ChatInlineRichText
        content={bodyContent}
        accentColor={accentColor}
        textColor={messageDensity === 'compact' ? '#bbb' : '#ccc'}
      />
    );

    const recoveryReliabilityBlock = recoveryReliabilityCard ? (
      <View style={styles.recoveryReliabilitySection}>
        <Text style={styles.messageSourceLabel}>Recovery Status</Text>
        <View
          style={[
            styles.recoveryReliabilityCard,
            {
              borderColor: `${recoveryReliabilityCard.color}55`,
              backgroundColor: `${recoveryReliabilityCard.color}10`,
            },
          ]}
        >
          <View style={styles.recoveryReliabilityHeader}>
            <View style={styles.recoveryReliabilityTitleWrap}>
              <Text style={[styles.recoveryReliabilityTitle, { color: recoveryReliabilityCard.color }]} numberOfLines={1}>
                {recoveryReliabilityCard.title}
              </Text>
              <Text style={styles.recoveryReliabilitySubtitle} numberOfLines={1}>
                {recoveryReliabilityCard.subtitle}
              </Text>
            </View>
            <View style={[styles.recoveryReliabilityPill, { borderColor: `${recoveryReliabilityCard.color}66` }]}>
              <Text style={[styles.recoveryReliabilityPillText, { color: recoveryReliabilityCard.color }]}>
                {recoveryReliabilityCard.statusLabel}
              </Text>
            </View>
          </View>
          <Text style={styles.recoveryReliabilityDetail} numberOfLines={2}>
            {recoveryReliabilityCard.detail}
          </Text>
          {recoveryReliabilityCard.chips.length > 0 ? (
            <View style={styles.recoveryReliabilityChipRow}>
              {recoveryReliabilityCard.chips.map((chip) => (
                <View key={chip} style={styles.recoveryReliabilityChip}>
                  <Text style={styles.recoveryReliabilityChipText} numberOfLines={1}>{chip}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    ) : null;

    const planCardBlock = item.chatAutomationPlanPreview ? (
      <ChatAutomationPlanCard
        preview={item.chatAutomationPlanPreview}
        accentColor={accentColor}
        routeLabelOverride={planRouteLabelOverride}
      />
    ) : null;

    return (
      <View>
        {/* Pending "BUILDING NOW" chip removed — the rotating verb in
            the typing strip above the composer already tells the user
            the agent is working, and this green pill flashed on every
            single message before disappearing when the answer arrived.
            Redundant + jumpy; stripped per user request. */}
        {/* Subagent delegation badge */}
        {item.delegatedTo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <View style={{ backgroundColor: '#a855f715', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#a855f730', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ color: '#a855f7', fontSize: 8, fontWeight: '700', fontFamily: 'monospace' }}>{item.delegatedTo.toUpperCase()}</Text>
            </View>
          </View>
        )}
        {item.delegatedSubagents && item.delegatedSubagents.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {item.delegatedSubagents.map((name) => (
              <View key={name} style={{ backgroundColor: '#0ea5e915', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: '#0ea5e940' }}>
                <Text style={{ color: '#67e8f9', fontSize: 8, fontWeight: '800', fontFamily: 'monospace' }}>
                  {name.toUpperCase()}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {routeChips.length > 0 ? (
          <View style={styles.messageRouteStrip}>
            {routeChips.map((chip) => (
              <View
                key={`${chip.label}-${chip.value}`}
                style={[
                  styles.messageRouteChip,
                  chip.tone === 'local' && styles.messageRouteChipLocal,
                  chip.tone === 'model' && styles.messageRouteChipModel,
                  chip.tone === 'provider' && styles.messageRouteChipProvider,
                ]}
              >
                <Text style={styles.messageRouteChipLabel}>{chip.label}</Text>
                <Text
                  style={[
                    styles.messageRouteChipValue,
                    chip.tone === 'local' && styles.messageRouteChipValueLocal,
                    chip.tone === 'model' && styles.messageRouteChipValueModel,
                  ]}
                  numberOfLines={1}
                >
                  {chip.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {isComputerTaskMessage ? (
          <>
            {/* P22: always-visible compact summary line — one glance at what
                this computer/desktop/app task is doing. */}
            <Text
              style={[styles.computerTaskSummaryLine, { color: messageDensity === 'compact' ? '#bbb' : '#ccc' }]}
              numberOfLines={2}
            >
              {failedSummaryPrefix ? `${failedSummaryPrefix} — ${computerSummaryLine}` : computerSummaryLine}
            </Text>
            {/* P22: all explanatory cards collapse behind ONE Details toggle. */}
            <ChatMessageDetailsDisclosure
              summary="Details"
              statusLabel={failedSummaryPrefix || undefined}
              statusTone={disclosureStatusTone}
              accentColor={accentColor}
            >
              {appChoiceBlock}
              {designTaskBlock}
              {bodyTextBlock}
              {recoveryReliabilityBlock}
              {planCardBlock}
            </ChatMessageDetailsDisclosure>
          </>
        ) : (
          <>
            {appChoiceBlock}
            {designTaskBlock}
            {bodyTextBlock}
          </>
        )}
        {/* SIGNATURE Receipt: the at-a-glance accountability summary. Rendered
            once here (both branches) directly under the body/summary and above
            the detailed artifact/run cards, so it is visible, not buried. It
            does NOT duplicate the P22 Details disclosure (which shows the
            verbose per-card breakdown) — this is the one-glance verdict. */}
        {receiptBlock}
        <ChatArtifacts
          artifacts={item.artifacts}
          accentColor={accentColor}
          circleId={circleId}
          sessionProfile={sessionProfile}
          runId={item.runId}
          onRunLedgerUpdate={(update) => {
            setMessages((prev) => prev.map((message) => (
              message.id === item.id
                ? {
                    ...message,
                    toolEvents: update.toolEvents ?? message.toolEvents,
                    verificationResults: update.verificationResults ?? message.verificationResults,
                    executionStream: buildOpenSwanExecutionStream({
                      toolEvents: update.toolEvents ?? message.toolEvents,
                      verificationResults: update.verificationResults ?? message.verificationResults,
                    }),
                  }
                : message
            )));
          }}
        />
        {(item.wikiRefs && item.wikiRefs.length > 0) || (item.researchRefs && item.researchRefs.length > 0) ? (
          <View style={styles.messageSourcesWrap}>
            {item.wikiRefs && item.wikiRefs.length > 0 ? (
              <View style={styles.messageSourceSection}>
                <Text style={styles.messageSourceLabel}>Wiki</Text>
                {item.wikiRefs.slice(0, 3).map((ref) => (
                  <Pressable
                    key={ref.id}
                    onPress={() => navigation.navigate('WikiArticle', { articleId: ref.id })}
                    style={[styles.messageSourceCard, { borderColor: `${ref.color}40`, backgroundColor: `${ref.color}12` }]}
                  >
                    <Text style={[styles.messageSourceTitle, { color: ref.color }]}>{ref.title}</Text>
                    <Text style={styles.messageSourceMeta}>{ref.category.toUpperCase()}</Text>
                    <Text style={styles.messageSourceSubtitle} numberOfLines={2}>{ref.subtitle}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {item.researchRefs && item.researchRefs.length > 0 ? (
              <View style={styles.messageSourceSection}>
                <Text style={styles.messageSourceLabel}>Research Influence</Text>
                {item.researchRefs.slice(0, 3).map((ref) => (
                  <Pressable
                    key={ref.id}
                    onPress={() => navigation.navigate('ResearchDocumentDetail', { documentId: ref.id })}
                    style={[styles.messageSourceCard, { borderColor: `${ref.color}40`, backgroundColor: `${ref.color}12` }]}
                  >
                    <Text style={[styles.messageSourceTitle, { color: ref.color }]}>{ref.title}</Text>
                    <Text style={styles.messageSourceMeta}>
                      {(ref.profileKey || ref.sourceType || 'research').toUpperCase()} • {ref.reviewStatus.toUpperCase()}
                    </Text>
                    <Text style={styles.messageSourceSubtitle} numberOfLines={2}>{ref.subtitle}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        <RunExecutionCard
          taskPlan={item.taskPlan}
          toolEvents={item.toolEvents}
          verificationResults={item.verificationResults}
          executionStream={item.executionStream}
          browserPlans={item.browserPlans}
          browserPlanEvents={item.browserPlanEvents}
          browserSessions={item.browserSessions}
          delegatedSubagents={item.delegatedSubagents}
          accentColor={accentColor}
          onLaunchBrowserPlan={(plan) => handleLaunchBrowserPlan(item, plan)}
          onOpenBrowserSession={handleOpenBrowserSession}
          onOpenBrowserSessionHistory={setSelectedBrowserSession}
          onRetryCheck={(checkId) => handleRetryVerificationCheck(item, checkId)}
          retryingCheckId={retryingLedgerCheck?.messageId === item.id ? retryingLedgerCheck.checkId : null}
        />
        {/* P22: the "Recovery Status" card moved into the Details disclosure
            near the top of computer-task messages; the actionable Recovery
            Options below stay always-visible. */}
        {item.recoveryOptions && item.recoveryOptions.length > 0 ? (
          <View style={styles.recoveryOptionSection}>
            <Text style={styles.messageSourceLabel}>Recovery Options</Text>
            {item.recoveryOptions.slice(0, 5).map((option) => {
              const color = getRecoveryOptionAccent(option);
              const executionPlan = buildChatFailureRecoveryExecutionPlan(option);
              const actionIntent = buildChatRecoveryActionIntent(option, {
                sourceSurface: item.source?.surface || null,
                platform: Platform.OS,
              });
              return (
                <View
                  key={option.id}
                  style={[
                    styles.recoveryOptionCard,
                    { borderColor: `${color}55`, backgroundColor: `${color}10` },
                  ]}
                >
                  <View style={styles.recoveryOptionHeader}>
                    <View style={styles.recoveryOptionTitleWrap}>
                      <Text style={[styles.recoveryOptionTitle, { color }]} numberOfLines={2}>
                        {option.label}
                      </Text>
                      {option.recommended ? (
                        <Text style={styles.recoveryOptionMeta}>Recommended</Text>
                      ) : null}
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${actionIntent.label}: ${actionIntent.detail}`}
                      onPress={() => {
                        if (actionIntent.kind === 'connect_desktop_bridge') {
                          void (async () => {
                            setBotTyping(true);
                            try {
                              await addDesktopBridgeAutoConnectMessage(item.source?.surface || 'desktop_bridge_recovery_card');
                            } catch (error: any) {
                              await addRecoverableChatErrorMessage({
                                title: 'Desktop bridge recovery failed',
                                task: 'Start or repair the local desktop bridge from a recovery option card',
                                error,
                                executionKind: 'desktop_bridge_recovery_card',
                                source: 'desktop_bridge_recovery_card_error',
                                touched: ['src/lib/desktopBridgeAutoConnect.ts', 'src/lib/desktopBridge.ts', 'scripts/claude-bridge.js'],
                              });
                            } finally {
                              setBotTyping(false);
                            }
                          })();
                          return;
                        }
                        const prompt = buildRecoveryOptionComposerPrompt(option, item);
                        if (actionIntent.autoSendsPrompt) {
                          void sendMessage(prompt, {
                            displayText: formatChatRecoveryActionDisplayText(option, actionIntent),
                          });
                        } else {
                          setInput(prompt);
                          inputRef.current?.focus();
                        }
                      }}
                      style={({ pressed }) => [
                        styles.recoveryOptionButton,
                        { borderColor: `${color}66`, backgroundColor: pressed ? `${color}24` : '#0b1220' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={[styles.recoveryOptionButtonText, { color }]}>{actionIntent.label}</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.recoveryOptionDetail} numberOfLines={3}>{option.detail}</Text>
                  {executionPlan.policy.action === 'continue_recovery' ? (
                    <Text style={styles.recoveryOptionPlan} numberOfLines={2}>{executionPlan.userSummary}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        {(item.memoryRefs && item.memoryRefs.length > 0) || (item.memoriesUsed && item.memoriesUsed.length > 0) ? (
          <View style={styles.messageSourceSection}>
            <Text style={styles.messageSourceLabel}>Memory Influence</Text>
            {item.memoryRefs && item.memoryRefs.length > 0 ? (
              <>
                {(['guidance', 'pattern'] as const).map((family) => {
                  const refs = item.memoryRefs?.filter((ref) => getMemoryFamily(ref) === family).slice(0, 4) || [];
                  if (refs.length === 0) return null;
                  return (
                    <View key={family} style={styles.memoryGroupSection}>
                      <Text style={styles.memoryGroupLabel}>{family === 'guidance' ? 'Guidance Memory' : 'Execution Patterns'}</Text>
                      {refs.map((ref) => (
                        <View
                          key={ref.id}
                          style={[
                            styles.messageSourceCard,
                            styles.memoryInfluenceCard,
                            ref.soulKey ? styles.memoryInfluenceCardSoul : null,
                          ]}
                        >
                          <Text style={styles.memoryInfluenceTitle}>{ref.title}</Text>
                          <Text style={styles.messageSourceMeta}>
                            {getMemoryFamilyLabel(ref).toUpperCase()} • {formatMemoryStateLabel(ref).toUpperCase()} • {formatMemoryScopeLabel(ref).toUpperCase()} • {formatMemoryKindLabel(String(ref.memoryKind)).toUpperCase()} • {formatMemoryStrengthLabel(ref).toUpperCase()} • {formatMemoryTrustLabel(ref).toUpperCase()} • {formatMemoryRecencyLabel(ref).toUpperCase()}{formatMemorySourceLabel(ref) ? ` • ${formatMemorySourceLabel(ref)!.toUpperCase()}` : ''}{formatArchiveBiasLabel(ref) ? ` • ${formatArchiveBiasLabel(ref)!.toUpperCase()}` : ''}
                          </Text>
                          <Text style={styles.messageSourceSubtitle}>
                            {ref.matchReason ? `${ref.matchReason}. ` : ''}
                            {ref.retrievalMode === 'startup' ? 'Always-on startup memory.' : 'Retrieved dynamically for this response.'}
                            {ref.helpfulness != null ? ` Prior feedback: ${formatMemoryTrustLabel(ref)}.` : ''}
                            {formatArchiveBiasLabel(ref) ? ` Archive evidence: ${formatArchiveBiasLabel(ref)}${ref.archivePassiveScore != null ? ` (${Math.round(ref.archivePassiveScore * 100)}%).` : '.'}` : ''}
                            {ref.soulKey ? ` Bound to ${ref.soulKey.replace(/^soul:/, '').toUpperCase()}.` : ''}
                            {ref.taskFit ? ` ${ref.taskFit === 'core' ? 'Core' : ref.taskFit === 'supporting' ? 'Supporting' : 'Background'} for this task.` : ''}
                          </Text>
                          <View style={styles.memoryActionRow}>
                            <Pressable onPress={() => handlePromoteMemoryRef(ref)} style={styles.memoryActionButton}>
                              <Text style={styles.memoryActionButtonText}>PROMOTE</Text>
                            </Pressable>
                            <Pressable onPress={() => handlePinMemoryRef(ref)} style={styles.memoryActionButton}>
                              <Text style={styles.memoryActionButtonText}>PIN</Text>
                            </Pressable>
                            <Pressable onPress={() => handleForgetMemoryRef(ref)} style={[styles.memoryActionButton, styles.memoryForgetButton]}>
                              <Text style={[styles.memoryActionButtonText, styles.memoryForgetButtonText]}>FORGET</Text>
                            </Pressable>
                            <Pressable onPress={() => handleMemoryNotHelpful(ref)} style={styles.memoryActionButton}>
                              <Text style={styles.memoryActionButtonText}>NOT HELPFUL</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))}
                    </View>
                  );
                })}
                <View style={styles.memoryActionRow}>
                  <Pressable onPress={() => handleRememberResponse(item)} style={styles.memoryActionButton}>
                    <Text style={styles.memoryActionButtonText}>REMEMBER RESPONSE</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.memoryChipRow}>
                {item.memoriesUsed?.map((memory, index) => (
                  <View key={`${memory}-${index}`} style={styles.memoryInfluenceChip}>
                    <Text style={styles.memoryInfluenceChipText}>{memory}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
        {item.memoryRecommendations && item.memoryRecommendations.length > 0 ? (
          <View style={styles.messageSourceSection}>
            <Text style={styles.messageSourceLabel}>Memory Recommendations</Text>
            {item.memoryRecommendations.map((recommendation) => (
              <View key={recommendation.id} style={[styles.messageSourceCard, styles.memoryInfluenceCard]}>
                <Text style={styles.memoryInfluenceTitle}>{recommendation.title}</Text>
                <Text style={styles.messageSourceMeta}>
                  {recommendation.priority.toUpperCase()} • {formatMemoryKindLabel(recommendation.memoryKind).toUpperCase()} • {formatMemoryRecommendationTargetLabel(recommendation.target).toUpperCase()}
                </Text>
                <Text style={styles.messageSourceSubtitle}>
                  {recommendation.rationale}
                </Text>
                <View style={styles.memoryActionRow}>
                  <Pressable onPress={() => handleApplyMemoryRecommendation(recommendation)} style={styles.memoryActionButton}>
                    <Text style={styles.memoryActionButtonText}>
                      {recommendation.recommendationType === 'promote_existing' ? 'PROMOTE MEMORY' : 'SAVE RECOMMENDED MEMORY'}
                    </Text>
                  </Pressable>
                  {recommendation.memoryId ? (
                    <Pressable
                      onPress={() => {
                        void recordMemoryFeedback({
                          memoryId: recommendation.memoryId!,
                          action: 'dismissed',
                          note: recommendation.rationale,
                          userId: currentUserId || undefined,
                          source: 'openswan_recommendation',
                        });
                        setMemoryToast({ message: 'Dismissed memory recommendation', type: 'updated' });
                      }}
                      style={[styles.memoryActionButton, styles.memoryForgetButton]}
                    >
                      <Text style={[styles.memoryActionButtonText, styles.memoryForgetButtonText]}>DISMISS</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {/* Memory saved indicator — inline chip like ChatGPT */}
        {item.memoriesSaved && item.memoriesSaved.length > 0 && (
          <Pressable
            onPress={() => setShowMemoryViewer(true)}
            style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: '#22c55e08', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 2, borderWidth: 1, borderColor: '#22c55e20', alignSelf: 'flex-start' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: '#22c55e20', justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: '#22c55e', fontSize: 7, fontWeight: '800' }}>M</Text>
            </View>
            <Text style={{ color: '#22c55e', fontSize: 8, fontFamily: 'monospace' }}>
              {item.memoriesSaved.length === 1 ? `Memory saved: ${item.memoriesSaved[0]}` : `${item.memoriesSaved.length} memories saved`}
            </Text>
          </Pressable>
        )}
      </View>
    );
  };

  // Inverted data — newest at index 0 for the inverted FlatList. This
  // pins the latest message at the visual bottom with zero scroll mgmt.
  const invertedMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Briefly highlight a message after `/search` → JUMP. Cleared after
  // 2.5s so the ring fades back to normal.
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const jumpToMessage = useCallback((messageId: string) => {
    const index = invertedMessages.findIndex(m => m.id === messageId || m.dbId === messageId);
    if (index < 0) return;
    try {
      flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.3 });
    } catch {}
    setHighlightedMessageId(invertedMessages[index].id);
    setTimeout(() => {
      setHighlightedMessageId((curr) => (curr === invertedMessages[index].id ? null : curr));
    }, 2500);
  }, [invertedMessages]);

  /**
   * After a launch from the OpenSwan Control Panel, watch agent_runs
   * for a fresh row created by this user in this circle. As soon as
   * one shows up, post a bot message containing a live RunTraceCard so
   * the user sees step-by-step progress without typing /trace. Bounded
   * to a 12-second window so we don't sit on a subscription forever
   * if the run gets short-circuited (e.g. dispatch fails, talk mode).
   */
  const attachRunTraceWhenAvailable = useCallback((taskHint: string) => {
    if (!currentUserId || !circleId) return;
    const launchedAt = Date.now();
    const launchIso = new Date(launchedAt - 1000).toISOString();
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`run-launch-watch:${currentUserId}:${launchedAt}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'agent_runs',
        filter: `circle_id=eq.${circleId}`,
      }, (payload) => {
        if (resolved) return;
        const row = payload.new as any;
        if (!row || row.user_id !== currentUserId) return;
        const created = row.created_at ? new Date(row.created_at).getTime() : 0;
        // Reject pre-launch rows that the realtime stream may flush
        // before our subscription officially started.
        if (created < launchedAt - 2000) return;
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        try { channel.unsubscribe(); } catch {}
        const taskLabel = taskHint.length > 60 ? taskHint.slice(0, 57) + '…' : taskHint;
        addBotMessage(
          `Launched · watching ${row.id.slice(0, 8)} — ${taskLabel}`,
          undefined,
          { localOnly: true, runId: row.id, showRunTrace: true },
        );
      })
      .subscribe();
    // 12s bound — if no run row appears, give up silently. The user's
    // launch may have routed through a path that doesn't create an
    // agent_runs row (e.g. swanbot direct, browser-only).
    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { channel.unsubscribe(); } catch {}
    }, 12_000);
    void launchIso; // reserved for future fallback poll path
  }, [currentUserId, circleId, addBotMessage]);

  // In the inverted array, the chronologically PREVIOUS message is at
  // index+1 (older = higher index).
  const isConsecutive = (index: number) => {
    if (index >= invertedMessages.length - 1) return false;
    const curr = invertedMessages[index];
    const prev = invertedMessages[index + 1]; // chronologically earlier
    if (!prev || prev.isBot !== curr.isBot || prev.isUser !== curr.isUser) return false;
    return curr.timestamp.getTime() - prev.timestamp.getTime() < 300000;
  };

  // ─── Render Message ──────────────────────────────────────────────────────

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const consecutive = isConsecutive(index);
    const reactionEntries = Object.entries(item.reactions).filter(([, u]) => u.length > 0);
    const messageAnim = newMessageAnims.get(item.id) || new Animated.Value(1);
    const isHighlighted = highlightedMessageId === item.id;

    return (
      <Animated.View
        style={[
          {
            opacity: messageAnim,
            transform: [
              {
                translateY: messageAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          },
          isHighlighted && {
            backgroundColor: accentColor + '14',
            borderRadius: 8,
            paddingVertical: 4,
            ...(Platform.OS === 'web' ? { boxShadow: `0 0 0 2px ${accentColor}55` } as any : {}),
          },
        ]}
      >
        <MessageRow
          item={item}
          consecutive={consecutive}
          reactionEntries={reactionEntries}
          currentUserId={currentUserId || 'me'}
          showReactions={showReactions === item.id}
          onToggleReactions={() => setShowReactions(showReactions === item.id ? null : item.id)}
          onReply={() => { setReplyTo(item); inputRef.current?.focus(); }}
          onReaction={(emoji: string) => toggleReaction(item.id, emoji)}
          onDelete={(item.isUser || item.isBot) ? () => deleteMessage(item.id, item.dbId) : undefined}
          renderContent={renderContent}
          accentColor={accentColor}
          messageDensity={messageDensity}
          agentAvatarSource={agentAvatarSource}
          agentName={agentName}
        />
        {item.isBot && currentUserId && (
          <View style={{ paddingLeft: 44, gap: 2 }}>
            {item.automationProposal ? (
              <AutomationProposalCard
                proposal={item.automationProposal}
                circleId={circleId}
                userId={currentUserId}
                accentColor={accentColor}
              />
            ) : null}
            {/* P22: the Plan + Evidence-Contract card moved into renderContent's
                Details disclosure (a message with a plan preview is always a
                computer-task message), so it renders collapsed-by-default with
                the other explanatory cards instead of expanded below the bubble. */}
            {item.searchResults ? (
              <SearchResultsCard
                query={item.searchResults.query}
                results={item.searchResults.rows}
                onJump={jumpToMessage}
                accentColor={accentColor}
              />
            ) : null}
            {item.commandsHelp ? (
              <CommandsHelpCard
                accentColor={accentColor}
                onInsert={(text) => {
                  setInput((prev) => {
                    if (!prev || !prev.trim()) return text;
                    return prev.endsWith(' ') ? prev + text : prev + ' ' + text;
                  });
                  inputRef.current?.focus();
                }}
              />
            ) : null}
            {item.assignPickerAgents ? (
              <AssignPickerCard
                agents={item.assignPickerAgents}
                accentColor={accentColor}
                onPick={(agent) => {
                  setInput(`/assign @${agent.name} `);
                  inputRef.current?.focus();
                }}
              />
            ) : null}
            {item.bridgeDiagResults ? (
              <BridgeDiagCard
                results={item.bridgeDiagResults}
                accentColor={accentColor}
                onRefresh={async () => {
                  const fresh = await probeBridges({ urlForPort: (port) => getBridgeUrl(port) });
                  setMessages(prev => prev.map(m => m.id === item.id ? { ...m, bridgeDiagResults: fresh } : m));
                }}
              />
            ) : null}
            {item.computerPreflightBlockers && item.computerPreflightBlockers.items.length > 0 ? (
              <PreflightBlockersCard
                items={item.computerPreflightBlockers.items}
                accentColor={accentColor}
                onConnectBridge={() => { void addDesktopBridgeAutoConnectMessage(); }}
                onOpenComputerUse={() => setShowComputerUseConsole(true)}
                onRetry={() => {
                  const retryTask = item.computerPreflightBlockers?.task;
                  if (retryTask) void sendMessage(retryTask);
                }}
              />
            ) : null}
            {item.computerFindings && (item.computerFindings.items?.length || 0) > 0 ? (
              /* Plan §3a: numbered findings inline — tapping fires the same
                 WI-5 follow-up the user would type. The card supersedes the
                 bare "Book option N" quick-reply chips for these messages. */
              <ChatComputerFindingsCard
                findings={item.computerFindings}
                accentColor={accentColor}
                onPickOption={(optionNumber) => { void sendMessage(`Book option ${optionNumber}`); }}
              />
            ) : null}
            {item.bestOfN && (item.bestOfN.candidates?.length || 0) > 0 ? (
              /* P11: interactive best-of-N — every candidate one tap to
                 adopt; race again pre-fills the same command. */
              <BestOfNResultCard
                race={item.bestOfN}
                accentColor={accentColor}
                onAdopt={(candidateIndex) => {
                  const candidate = item.bestOfN?.candidates?.[candidateIndex];
                  if (candidate?.text) {
                    addBotMessage(
                      `✅ Adopted **${candidate.model}**'s answer:\n\n${candidate.text}`,
                      undefined,
                      { localOnly: true },
                    );
                  }
                }}
                onRaceAgain={() => {
                  const models = (item.bestOfN?.candidates || []).map((c) => c.model).join(',');
                  setInput(`/bestof ${models} ${item.bestOfN?.task || ''}`.trim());
                  inputRef.current?.focus();
                }}
              />
            ) : null}
            {item.quickReplies && item.quickReplies.length > 0
              && !(item.computerFindings && (item.computerFindings.items?.length || 0) > 0) ? (
              <QuickReplyChips
                replies={item.quickReplies}
                accentColor={accentColor}
                onPick={(reply) => { void sendMessage(reply); }}
              />
            ) : null}
            {item.isBot ? (
              /* Plan §3b: memory attribution + one-tap Remember (routes
                 through the existing /remember path). */
              <ChatMemoryAttributionRow
                memoriesUsed={item.memoriesUsed}
                memoryRefCount={item.memoryRefs?.length || 0}
                canRemember={(item.content || '').length >= 120}
                onOpenMemories={() => setShowMemoryViewer(true)}
                onRemember={() => { void sendMessage(`/remember ${item.content.slice(0, 280)}`); }}
                accentColor={accentColor}
              />
            ) : null}
            {item.showRunTrace && item.runId ? (
              <RunTraceCard
                runId={item.runId}
                accentColor={accentColor}
                onRunAgain={(run) => {
                  setInput(run.goal || run.title || '');
                  inputRef.current?.focus();
                }}
              />
            ) : null}
            <MessageCitations
              userId={currentUserId}
              messageTimestamp={item.timestamp.toISOString()}
              nextMessageTimestamp={index > 0 ? invertedMessages[index - 1]?.timestamp?.toISOString() : undefined}
              accentColor={accentColor}
            />
            <RunCostDrawer
              userId={currentUserId}
              messageTimestamp={item.timestamp.toISOString()}
              nextMessageTimestamp={index > 0 ? invertedMessages[index - 1]?.timestamp?.toISOString() : undefined}
            />
          </View>
        )}
      </Animated.View>
    );
  };

  // ─── Empty State ─────────────────────────────────────────────────────────

  const renderEmptyState = () => (
    <ScrollView contentContainerStyle={styles.emptyContainer}>
      <View style={[styles.heroSection, Platform.OS === 'web' && styles.heroSectionWeb]}>
        <Image
          source={{ uri: 'https://swanopoly.s3.us-east-1.amazonaws.com/SwanAI/swanai.png' }}
          style={styles.heroBotImage}
          resizeMode="contain"
        />
      </View>
    </ScrollView>
  );

  // ─── "Needs you" attention strip ─────────────────────────────────────────
  // Phase 1c of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md. Folds every
  // waiting-on-the-user state (pending/expiring/expired approvals, parked
  // clarifications, live computer-task questions, recovery choices,
  // provider blockers) into one strip via `chatAttentionQueue`, so blocked
  // work stops dying silently. State lives up near the other declarations;
  // this derived block sits before the early `!loaded` return to keep hook
  // order unconditional.
  const attentionRecoverySource = (() => {
    // Only the latest bot message: recovery is offered exactly while the
    // failure is still the freshest state of the conversation.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (!message.isBot) continue;
      return (message.recoveryOptions?.length ?? 0) > 0 ? message : null;
    }
    return null;
  })();
  const chatAttention = buildChatAttentionState({
    approvals: pendingHitlApprovals,
    pendingClarification: pendingClarificationRef.current.get(activeThreadId || 'main') || null,
    pendingTaskQuestion: computerUseTask.state.pendingConfirmation,
    recoveryOptions: attentionRecoverySource?.recoveryOptions ?? null,
    recoveryContextLabel: attentionRecoverySource?.recoveryReliability?.targetName
      ?? attentionRecoverySource?.recoveryReliability?.taskFamily
      ?? null,
    recoveryRefId: attentionRecoverySource?.id ?? null,
    providerBlockers: attentionProviderBlocker ? [attentionProviderBlocker] : null,
  }, { dismissedIds: dismissedAttentionIds });
  const chatAttentionItems = chatAttention.items.filter((item) =>
    // Live pending approvals already render with approve/reject buttons in
    // HitlApprovalBanner directly below the strip; keep them out of the row
    // list (the status line still counts them) and show only the states
    // that have no other surface. Dismissals are filtered inside the
    // builder so the status line stays truthful.
    item.kind !== 'approval_pending'
      && item.kind !== 'approval_expiring',
  );
  const chatAttentionActive = chatAttention.statusLine !== null;
  useEffect(() => {
    // Reclassify countdowns/expiry while something is waiting on the user.
    if (!chatAttentionActive) return;
    const timer = setInterval(() => setAttentionTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [chatAttentionActive]);
  const handleChatAttentionAction = (item: ChatAttentionItem, action: ChatAttentionAction) => {
    if (action.kind === 'dismiss') {
      if (item.kind === 'clarification_waiting') {
        pendingClarificationRef.current.delete(activeThreadId || 'main');
        persistPendingClarifications();
      }
      setDismissedAttentionIds((prev) => new Set(prev).add(item.id));
      return;
    }
    if (action.kind === 'refile_approval') {
      // Re-run the original request. The approval gate flips the stale row
      // to `expired` and files a fresh proposal with an explicit
      // "your earlier approval expired" message.
      const row = pendingHitlApprovals.find((approval) => approval.id === item.refId);
      const commandText = (row?.payload as Record<string, any> | undefined)?.plan?.commandText;
      setDismissedAttentionIds((prev) => new Set(prev).add(item.id));
      if (typeof commandText === 'string' && commandText.trim()) {
        void sendMessage(commandText);
      } else {
        addBotMessage(
          'That approval expired and I could not recover the original request — please resend it and I will file a fresh approval.',
          undefined,
          { localOnly: true },
        );
      }
      return;
    }
    if (action.kind === 'cancel_task' && item.kind === 'task_question_waiting') {
      computerUseTask.cancel();
      return;
    }
    if (action.kind === 'choose_recovery') {
      // Same as the user typing the recommended option — the recovery seam
      // handles the text like any other reply.
      const option = attentionRecoverySource?.recoveryOptions?.find((candidate) => candidate.id === item.refId)
        ?? attentionRecoverySource?.recoveryOptions?.[0];
      setDismissedAttentionIds((prev) => new Set(prev).add(item.id));
      if (option) void sendMessage(option.label);
      return;
    }
    if (action.kind === 'open_marketplace') {
      handleSidebarMarketplace();
      return;
    }
    // answer_clarification / answer_task_question: answering happens in the
    // composer / live task card — the strip only points the user there.
  };

  // ─── Room handoff suggestion (plan §4c) ──────────────────────────────────
  // Conservative detector: several distinct files + user build intent in the
  // trailing window. Dismissible per thread; accepting creates the room,
  // seeds it with context, and jumps there — this thread stays usable.
  const roomHandoffThreadKey = activeThreadId || 'main';
  const roomHandoffSuggestion = useMemo(() => {
    if (messages.length < 4) return null;
    if (dismissedRoomHandoffThreads.has(roomHandoffThreadKey)) return null;
    return detectRoomHandoffSuggestion(
      messages.map((message) => ({ content: message.content || '', isBot: !!message.isBot })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, roomHandoffThreadKey, dismissedRoomHandoffThreads]);
  const handleAcceptRoomHandoff = async () => {
    if (!roomHandoffSuggestion || roomHandoffBusy || !circleId) return;
    setRoomHandoffBusy(true);
    try {
      const { createRoom, sendAgentMessage } = await import('./rooms/roomRepository');
      const roomId = await createRoom(
        circleId,
        roomHandoffSuggestion.suggestedRoomName,
        'Continued from main chat',
      );
      if (!roomId) throw new Error('room creation failed');
      const latestUserAsk = [...messages].reverse().find((message) => !message.isBot)?.content || null;
      await sendAgentMessage(
        roomId,
        agentName,
        buildRoomHandoffSeedMessage({
          filesMentioned: roomHandoffSuggestion.filesMentioned,
          latestUserAsk,
        }),
        { source: 'chat_handoff', threadId: activeThreadId || null },
      );
      const { primeRoomWorkspaceLaunch } = await import('../../../lib/roomWorkspaceLauncher');
      primeRoomWorkspaceLaunch({ circleId, roomId });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        try { window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'ROOMS' } })); } catch {}
      }
      setDismissedRoomHandoffThreads((prev) => new Set(prev).add(roomHandoffThreadKey));
      addBotMessage(
        `Set up room **${roomHandoffSuggestion.suggestedRoomName}** with this conversation's context — continuing there. This thread stays available for follow-ups.`,
        undefined,
        { localOnly: true },
      );
    } catch {
      addBotMessage(
        'Could not create the room — try again, or create one from the Rooms tab and I will keep helping here.',
        undefined,
        { localOnly: true },
      );
    } finally {
      setRoomHandoffBusy(false);
    }
  };

  // ─── Main Return ─────────────────────────────────────────────────────────

  if (!loaded) {
    return (
      <View style={styles.loadingContainer}>
        <ChatLoadingWave />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#000' }}>
      {Platform.OS === 'web' && globalFileDragActive ? (
        <View pointerEvents="none" style={styles.globalDropOverlay}>
          <View style={styles.globalDropCard}>
            <Text style={styles.globalDropTitle}>DROP FILES TO UPLOAD</Text>
            <Text style={styles.globalDropSubtitle}>Images, docs, code, PDFs, archives, Figma exports, and more</Text>
          </View>
        </View>
      ) : null}
      {circleId && (
        <ChatThreadSidebar
          circleId={circleId}
          activeThreadId={activeThreadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          onNewAgent={handleSidebarNewAgent}
          onOpenAutomations={handleSidebarAutomations}
          onOpenMarketplace={handleSidebarMarketplace}
          onDeleteThread={async (threadId) => {
            try {
              const { deleteThread: dt } = await import('../../../lib/circleChatThreads');
              await dt(threadId);
              setThreadListRefreshToken(prev => prev + 1);
              if (activeThreadId === threadId) setActiveThreadId(null);
            } catch (err) {
              console.warn('[ChatTab] delete thread failed:', err);
            }
          }}
          refreshToken={threadListRefreshToken}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleSidebar}
        />
      )}
      <KeyboardAvoidingView style={[styles.container, { flex: 1 }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Floating elements */}
      {floatingEmojis.map((emoji) => (
        <FloatingEmoji
          key={emoji.id}
          emoji={emoji.emoji}
          onComplete={() => setFloatingEmojis(prev => prev.filter(e => e.id !== emoji.id))}
        />
      ))}
      
      {particles.map((particle) => (
        <ParticleEffect
          key={particle.id}
          x={particle.x}
          y={particle.y}
          color={particle.color}
          onComplete={() => setParticles(prev => prev.filter(p => p.id !== particle.id))}
        />
      ))}

      <BrandPackEditor
        circleId={circleId}
        visible={brandPackEditorOpen}
        onClose={() => setBrandPackEditorOpen(false)}
        onSaved={(pack) => setBrandPack(pack)}
      />

      <BuilderImagesEditor
        threadId={activeThreadId}
        visible={imagesEditorOpen}
        onClose={() => setImagesEditorOpen(false)}
        onChanged={(imgs) => setBuilderImages(imgs)}
      />

      <BuilderGithubSaveModal
        circleId={circleId}
        visible={githubSaveOpen}
        onClose={() => setGithubSaveOpen(false)}
        title={effectiveBuildArtifact?.title || 'UC Build'}
        html={effectiveBuildArtifact?.kind === 'webpage' ? (effectiveBuildArtifact?.content || null) : null}
      />

      <BuilderNetlifyDeployModal
        circleId={circleId}
        visible={netlifyDeployOpen}
        onClose={() => setNetlifyDeployOpen(false)}
        title={effectiveBuildArtifact?.title || 'UC Build'}
        html={effectiveBuildArtifact?.kind === 'webpage' ? (effectiveBuildArtifact?.content || null) : null}
      />

      <Modal
        visible={builderModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setBuilderModalOpen(false)}
      >
        <View style={styles.builderModalScrim}>
          <View style={styles.builderModalCard}>
            <View style={styles.builderModalHeader}>
              <Text style={styles.builderModalTitle}>Live Builder</Text>
              <Pressable onPress={() => setBuilderModalOpen(false)} style={styles.builderModalCloseButton}>
                <Text style={styles.builderModalCloseButtonText}>CLOSE</Text>
              </Pressable>
            </View>
            <ChatBuildStudio
              accentColor={accentColor}
              selectedModel={selectedModel}
              currentRunStep={currentRunStep}
              prompt={codingWorkbenchPrompt}
              tick={codingWorkbenchTick}
              artifact={effectiveBuildArtifact}
              view={buildStudioView}
              onViewChange={setBuildStudioView}
              circleId={circleId}
              streamingText={streamingBuildText}
              streamingPhase={streamingBuildPhase}
              revisions={builderRevisions}
              activeArtifactContent={effectiveBuildArtifact?.content || null}
              onRevertRevision={handleRevertRevision}
              onDeleteRevision={handleDeleteRevision}
              onOpenBrandPack={() => setBrandPackEditorOpen(true)}
              brandPackActive={isBrandPackActive(brandPack)}
              figmaReferences={builderFigmaRefs}
              selectedFigmaRefId={selectedBuilderFigmaRefId}
              onSelectFigmaRef={setSelectedBuilderFigmaRefId}
              onArtifactEdit={handleArtifactEdit}
              onRegenerateTweak={handleRegenerateTweak}
              onPointEdit={handlePointEdit}
              onPickTemplate={(brief, label) => launchBuildStream(brief, selectedBuilderFigmaPrompt || undefined, label)}
              onOpenImages={() => setImagesEditorOpen(true)}
              imagesCount={builderImages.length}
              onOpenGithubSave={() => setGithubSaveOpen(true)}
              onOpenNetlifyDeploy={() => setNetlifyDeployOpen(true)}
            />
          </View>
        </View>
      </Modal>

      <SpawnAgentsModal
        visible={spawnModalOpen}
        onClose={() => setSpawnModalOpen(false)}
        onSpawned={(result) => {
          if (result.ok) {
            const lines = result.results
              .filter(r => r.ok)
              .map(r => `- **${r.task.slice(0, 60)}**${r.pid ? ` (PID ${r.pid})` : ''}`);
            addBotMessage(`Spawned ${result.spawned} agent${result.spawned !== 1 ? 's' : ''}:\n\n${lines.join('\n')}\n\nAgents will appear in the Office once detected.`);
          } else {
            addBotMessage('I could not spawn those agents. Check the bridge connection and try again.');
          }
        }}
      />

      <ChatThreadHeader
        threadId={activeThreadId}
        circleId={circleId}
        currentUserId={currentUserId}
        refreshToken={threadListRefreshToken}
        onThreadUpdated={handleThreadMetaChanged}
        selectedModel={selectedModel}
        sessionProfile={sessionProfile}
        delegationMode={sessionDelegationMode}
        onSessionProfileChange={handleSessionProfileChange}
        onDelegationModeChange={handleDelegationModeChange}
        onOpenControlPanel={() => {
          setOpenSwanInitialTask(input.trim());
          setShowOpenSwanConsole(true);
        }}
        onOpenRunHistory={() => setShowRunHistory(true)}
        resolvedAutoModel={autoResolvedModel}
        autoModelReason={autoModelReason}
        onOpenThread={handleSelectThread}
      />
      {showReopenBuilderPill ? (
        <View style={styles.builderReopenBar}>
          <Pressable
            onPress={openBuilderStudio}
            style={[styles.builderReopenButton, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}
          >
            <Text style={[styles.builderReopenButtonText, { color: accentColor }]}>↻ OPEN LAST BUILD</Text>
            {effectiveBuildArtifact?.title ? (
              <Text style={{ color: '#7f8ea3', fontSize: 10, fontFamily: 'monospace' }} numberOfLines={1}>
                — {effectiveBuildArtifact.title.slice(0, 48)}
              </Text>
            ) : null}
          </Pressable>
        </View>
      ) : null}
      <RunHistoryDrawer
        visible={showRunHistory}
        circleId={circleId}
        currentUserId={currentUserId}
        chatSessionId={activeThreadId}
        title="OpenSwan Run History"
        onClose={() => setShowRunHistory(false)}
      />
      {messages.length === 0 ? renderEmptyState() : (
        <View
          ref={Platform.OS === 'web' ? (node => { builderDragContainerRef.current = node as HTMLDivElement | null; }) : undefined}
          style={[styles.chatSurfaceRow, showWorkbenchSidecar && styles.chatSurfaceRowSplit]}
        >
          <View style={[styles.chatMainPane, showWorkbenchSidecar && { width: `${100 - builderPaneWidth}%` as any }]}>
        <>
          {/* Agent identity bar removed — functionality preserved via OpenSwan service menu */}

          {/* Plugin Picker Panel */}
          {showPluginPicker && (
            <PluginPicker
              circleId={circleId}
              activePluginIds={activePlugins}
              onTogglePlugin={(id) => setActivePlugins(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id])}
              onQuickStart={(prompt) => { setInput(prompt); inputRef.current?.focus(); }}
              onClose={() => setShowPluginPicker(false)}
              accentColor={accentColor}
            />
          )}

          {/* Memory Viewer Panel */}
          {showMemoryViewer && (
            <MemoryViewer
              circleId={circleId}
              threadId={activeThreadId || null}
              userId={currentUserId || undefined}
              accentColor={accentColor}
              onClose={() => setShowMemoryViewer(false)}
            />
          )}

          {soulLearningRefs.length > 0 ? (
            <View style={styles.soulLearningRail}>
              <View style={styles.soulLearningHeader}>
                <Text style={styles.soulLearningLabel}>
                  {activeSpirit?.name || 'OpenSwan SOUL'} learning now
                </Text>
                <Pressable onPress={() => navigation.navigate('ResearchControlCenter')} style={styles.soulLearningLink}>
                  <Text style={styles.soulLearningLinkText}>OPEN RESEARCH</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.soulLearningScroll}>
                {soulLearningRefs.map((ref) => (
                  <Pressable
                    key={ref.id}
                    onPress={() => navigation.navigate('ResearchDocumentDetail', { documentId: ref.id })}
                    style={[styles.soulLearningCard, { borderColor: `${ref.color}45`, backgroundColor: `${ref.color}12` }]}
                  >
                    <Text style={[styles.soulLearningCardTitle, { color: ref.color }]} numberOfLines={1}>{ref.title}</Text>
                    <Text style={styles.soulLearningCardMeta}>
                      {(ref.profileKey || ref.sourceType || 'research').toUpperCase()} • {ref.reviewStatus.toUpperCase()}
                    </Text>
                    <Text style={styles.soulLearningCardSubtitle} numberOfLines={2}>{ref.subtitle}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {soulMemoryRefs.length > 0 ? (
            <View style={styles.soulLearningRail}>
              <View style={styles.soulLearningHeader}>
                <Text style={styles.soulLearningLabel}>
                  {activeSpirit?.name || 'OpenSwan SOUL'} memory active
                </Text>
                <Pressable
                  onPress={() => navigation.navigate('SoulMemory', {
                    spiritId: activeSpiritId,
                    circleId,
                    userId: currentUserId,
                  })}
                  style={styles.soulLearningLink}
                >
                  <Text style={styles.soulLearningLinkText}>OPEN MEMORY</Text>
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.soulLearningScroll}>
                {soulMemoryRefs.map((ref) => (
                  <Pressable
                    key={ref.id}
                    onPress={() => navigation.navigate('SoulMemory', {
                      spiritId: activeSpiritId,
                      circleId,
                      userId: currentUserId,
                    })}
                    style={[styles.soulLearningCard, styles.soulMemoryCard]}
                  >
                    <Text style={styles.soulMemoryCardTitle} numberOfLines={1}>{ref.title}</Text>
                    <Text style={styles.soulLearningCardMeta}>
                      {formatMemoryKindLabel(String(ref.memoryKind)).toUpperCase()} • {formatMemoryStrengthLabel(ref).toUpperCase()} • {formatMemoryRecencyLabel(ref).toUpperCase()}
                    </Text>
                    <Text style={styles.soulLearningCardSubtitle} numberOfLines={2}>
                      {ref.retrievalMode === 'startup' ? 'Pinned as startup guidance.' : 'Available on demand for matching tasks.'}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Pinned messages banner */}
          {pinnedMessages.length > 0 && (
            <Pressable
              onPress={() => setShowPinned(!showPinned)}
              style={[styles.pinnedBanner, { borderColor: accentColor + '30' },
                Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.pinnedBannerIcon}>📌</Text>
              <Text style={styles.pinnedBannerText}>
                {pinnedMessages.length} pinned message{pinnedMessages.length > 1 ? 's' : ''}
              </Text>
              <Text style={styles.pinnedBannerChevron}>{showPinned ? '▾' : '▸'}</Text>
            </Pressable>
          )}

          {showPinned && pinnedMessages.length > 0 && (
            <View style={styles.pinnedList}>
              {pinnedMessages.map(pin => (
                <Pressable
                  key={pin.id}
                  onPress={() => jumpToMessage(pin.message_id)}
                  style={({ pressed }: any) => [
                    styles.pinnedItem,
                    pressed && { backgroundColor: accentColor + '14' },
                    Platform.OS === 'web' && { cursor: 'pointer' } as any,
                  ]}
                  accessibilityLabel="Jump to pinned message"
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.pinnedItemText} numberOfLines={2}>{pin.message_content || '(message)'}</Text>
                    <Text style={styles.pinnedItemMeta}>pinned by {pin.pinned_by_name || 'member'} · tap to jump</Text>
                  </View>
                  <Pressable
                    onPress={async (e: any) => {
                      e?.stopPropagation?.();
                      try {
                        await unpinMessage(circleId, pin.message_id);
                        const fresh = await getPinnedMessages(circleId);
                        setPinnedMessages(fresh);
                      } catch (err) {
                        console.warn('[unpin] failed:', err);
                      }
                    }}
                    style={({ pressed }: any) => [
                      {
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        borderWidth: 1,
                        borderColor: '#334155',
                        marginLeft: 8,
                      },
                      pressed && { backgroundColor: '#ef444420', borderColor: '#ef4444' },
                    ]}
                    accessibilityLabel="Unpin this message"
                  >
                    <Text style={{ color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>UNPIN</Text>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}

          {/* Active proposals */}
          {proposals.length > 0 && (
            <View style={styles.proposalSection}>
              <Text style={styles.proposalSectionTitle}>🗳️ ACTIVE VOTES</Text>
              {proposals.slice(0, 3).map(p => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  currentUserId={currentUserId || ''}
                  accentColor={accentColor}
                  onVote={handleVote}
                  onResolve={handleResolve}
                />
              ))}
              {proposals.length > 3 && (
                <Text style={styles.moreProposals}>+{proposals.length - 3} more — type /proposals to see all</Text>
              )}
            </View>
          )}

          <FlatList
            ref={flatListRef}
            data={invertedMessages}
            inverted
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            style={styles.messageListScroll}
            contentContainerStyle={styles.messageList}
            onScroll={(e) => {
              scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
              contentHeightRef.current = e.nativeEvent.contentSize.height;
              layoutHeightRef.current = e.nativeEvent.layoutMeasurement.height;
            }}
            scrollEventThrottle={16}
          />

          {(() => {
            // D6: completion/blocked notification banner. The persisted
            // record carries unacknowledged notifications when the user
            // walked away mid-task — show the newest one with VIEW (opens
            // the console like the strip; terminal banners auto-acknowledge
            // there) and DISMISS (acknowledges + persists).
            const unacknowledged = listUnacknowledgedComputerTaskNotifications(computerTaskState);
            if (unacknowledged.length === 0) return null;
            const notice = unacknowledged[0];
            const tint = notice.kind === 'completed' ? '#34d399'
              : notice.kind === 'failed' ? '#ef4444'
                : notice.kind === 'blocked' ? '#f59e0b'
                  : notice.kind === 'partial_result' ? '#a78bfa'
                    : '#e8b339';
            return (
              <View
                style={{
                  marginHorizontal: 12,
                  marginBottom: 6,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: tint + '55',
                  backgroundColor: tint + '14',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Pressable onPress={() => setShowComputerUseConsole(true)} style={{ flex: 1 }}>
                  <Text style={{ color: tint, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    {COMPUTER_TASK_NOTIFICATION_GLYPHS[notice.kind] || '⚑'} {notice.title}{unacknowledged.length > 1 ? `  (+${unacknowledged.length - 1} more)` : ''}
                  </Text>
                  {notice.body ? (
                    <Text style={{ color: '#cfcfcf', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {notice.body}
                    </Text>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => setShowComputerUseConsole(true)}
                  style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: tint + '66' }}
                  accessibilityLabel="Open the computer task console"
                >
                  <Text style={{ color: tint, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>VIEW</Text>
                </Pressable>
                <Pressable
                  onPress={acknowledgeTaskNotifications}
                  style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#334155' }}
                  accessibilityLabel="Dismiss this task notification"
                >
                  <Text style={{ color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>DISMISS</Text>
                </Pressable>
              </View>
            );
          })()}

          {(() => {
            // D6: persisted needs-you strip. Derived from the durable task
            // record (survives reload), so a task paused on MFA/approval is
            // visible the moment the user returns — tap opens the console
            // where the question/approval can be answered.
            const checklist = buildComputerTaskChecklistCard(computerTaskState);
            if (!checklist || !checklist.active || checklist.needsYou.length === 0) return null;
            // Stale guard: a blocked/approval record from an old session must
            // not nag forever — only surface needs-you for recent activity,
            // and honor an explicit dismissal of this exact record state.
            const updatedMs = Date.parse(checklist.updatedAt || '');
            if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > 48 * 3_600_000) return null;
            if (needsYouStripDismissedKey && needsYouStripDismissedKey === checklist.updatedAt) return null;
            const first = checklist.needsYou[0];
            const prefix = first.kind === 'question' ? 'Needs your answer' : first.kind === 'approval' ? 'Needs your approval' : 'Blocked';
            const dismissStrip = () => {
              setNeedsYouStripDismissedKey(checklist.updatedAt);
              void Promise.resolve(storage.setItem(`uc_needs_you_strip_dismissed::${circleId}`, checklist.updatedAt)).catch(() => {});
            };
            return (
              <View
                style={{
                  marginHorizontal: 12,
                  marginBottom: 6,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: '#e8b33955',
                  backgroundColor: '#e8b33914',
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <Pressable
                  onPress={() => setShowComputerUseConsole(true)}
                  style={{ flex: 1, paddingVertical: 8, paddingLeft: 12, paddingRight: 4 }}
                >
                  <Text style={{ color: '#e8b339', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    ⚑ {checklist.title} — {prefix}
                  </Text>
                  <Text style={{ color: '#cfcfcf', fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                    {first.label}{checklist.needsYou.length > 1 ? `  (+${checklist.needsYou.length - 1} more)` : ''} — tap to open
                  </Text>
                </Pressable>
                <Pressable
                  onPress={dismissStrip}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss"
                  style={{ paddingHorizontal: 12, paddingVertical: 10 }}
                >
                  <Text style={{ color: '#9a9a9a', fontSize: 14, fontWeight: '700' }}>×</Text>
                </Pressable>
              </View>
            );
          })()}

          {/* Quick actions moved to composer dropdown */}
        </>
          </View>
          {showWorkbenchSidecar ? (
            <Pressable
              onPress={() => {}}
              onPressIn={Platform.OS === 'web' ? (() => {
                builderDraggingRef.current = true;
                try {
                  document.body.style.cursor = 'col-resize';
                  document.body.style.userSelect = 'none';
                } catch {}
              }) : undefined}
              style={styles.workbenchDivider}
            >
              <View style={styles.workbenchDividerGrip} />
            </Pressable>
          ) : null}
          {showWorkbenchSidecar ? (
            <View style={[styles.workbenchSidecar, { width: `${builderPaneWidth}%` as any }]}>
              <View style={styles.workbenchSidecarHeader}>
                <Text style={styles.workbenchSidecarLabel}>LIVE BUILDER</Text>
                <View style={styles.workbenchSidecarActions}>
                  <Pressable
                    onPress={() => setBuildStudioDismissed(true)}
                    style={[styles.workbenchSidecarButton, styles.workbenchCloseButton]}
                  >
                    <Text style={[styles.workbenchSidecarButtonText, styles.workbenchCloseButtonText]}>CLOSE</Text>
                  </Pressable>
                </View>
              </View>
              <ChatBuildStudio
                accentColor={accentColor}
                selectedModel={selectedModel}
                currentRunStep={currentRunStep}
                prompt={codingWorkbenchPrompt}
                tick={codingWorkbenchTick}
                artifact={effectiveBuildArtifact}
                view={buildStudioView}
                onViewChange={setBuildStudioView}
                circleId={circleId}
                streamingText={streamingBuildText}
                streamingPhase={streamingBuildPhase}
                revisions={builderRevisions}
                activeArtifactContent={effectiveBuildArtifact?.content || null}
                onRevertRevision={handleRevertRevision}
                onDeleteRevision={handleDeleteRevision}
                onOpenBrandPack={() => setBrandPackEditorOpen(true)}
                brandPackActive={isBrandPackActive(brandPack)}
                figmaReferences={builderFigmaRefs}
                selectedFigmaRefId={selectedBuilderFigmaRefId}
                onSelectFigmaRef={setSelectedBuilderFigmaRefId}
                onArtifactEdit={handleArtifactEdit}
                onRegenerateTweak={handleRegenerateTweak}
                onPointEdit={handlePointEdit}
                onPickTemplate={(brief, label) => launchBuildStream(brief, selectedBuilderFigmaPrompt || undefined, label)}
                onOpenImages={() => setImagesEditorOpen(true)}
                imagesCount={builderImages.length}
                onOpenGithubSave={() => setGithubSaveOpen(true)}
                onOpenNetlifyDeploy={() => setNetlifyDeployOpen(true)}
              />
            </View>
          ) : null}
        </View>
      )}

      {/* Enhanced crypto panel */}
      {showSendCrypto && (
        <EnhancedCryptoPanel
          wallet={wallet}
          sendTo={sendTo}
          sendAmount={sendAmount}
          sendingCrypto={sendingCrypto}
          members={members}
          currentUserId={currentUserId}
          accentColor={accentColor}
          onClose={() => { setShowSendCrypto(false); setSendTo(''); setSendAmount(''); }}
          onWalletConnect={setWallet}
          onSendToChange={setSendTo}
          onSendAmountChange={setSendAmount}
          onSend={handleSendCrypto}
          onDisconnect={async (chain: string) => {
            const { disconnectWallet } = await import('../../../lib/crypto');
            await disconnectWallet(chain as CryptoChain);
            setWallet(null);
            addBotMessage('Wallet disconnected.');
          }}
          onBotMessage={addBotMessage}
        />
      )}

      {/* Enhanced typing indicator — rotates a witty verb every ~1.5s
          so the user feels the agent is actually doing something
          instead of reading a static "is working" line. The dot pulses
          via the shared `uc-tab-dot-pulse` keyframe used on tab dots
          elsewhere (sibling of the Quick Actions button-dot pattern). */}
      {botTyping && runStatus === 'idle' && (
        <>
          {codingWorkbenchPrompt && !showWorkbenchSidecar && (
            <CodingWorkbenchPreview
              prompt={codingWorkbenchPrompt}
              tick={codingWorkbenchTick}
              accentColor={accentColor}
              selectedModel={selectedModel}
            />
          )}
          <View style={[styles.typingBar, { borderColor: accentColor + '20' }]}>
            <ThinkingDots scale={1} cycleDuration={5.5} glow />
            <ThinkingLabel
              text={buildSessionThinkingLabel(currentRunStep, thinkingVerbIndex)}
            />
          </View>
        </>
      )}

      {/* Enhanced mention popup */}
      {showMentions && filteredMembers.length > 0 && (
        <EnhancedMentionPopup
          members={filteredMembers}
          onSelect={insertMention}
          accentColor={accentColor}
          agentAvatarSource={agentAvatarSource}
        />
      )}

      {/* Enhanced reply bar */}
      {replyTo && (
        <EnhancedReplyBar
          replyTo={replyTo}
          accentColor={accentColor}
          onClose={() => setReplyTo(null)}
        />
      )}

      {/* ── Agent Assign/Spawn Panels — elegant centered consoles ── */}
      {showSpawnPanel && (
        <View
          pointerEvents="box-none"
          style={{
            ...(Platform.OS === 'web' ? ({ position: 'fixed' as any }) : StyleSheet.absoluteFillObject),
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 1200, alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <Pressable
            onPress={() => setShowSpawnPanel(false)}
            accessibilityRole="button"
            accessibilityLabel="Close Spawn Agent console"
            style={{
              ...(Platform.OS === 'web' ? ({ position: 'fixed' as any }) : StyleSheet.absoluteFillObject),
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: '#22c55e08',
              ...(Platform.OS === 'web' ? ({
                backdropFilter: 'blur(14px) saturate(1.15)',
                WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
              } as any) : {}),
            }}
          />
          <View
            style={{
              width: '100%' as any,
              maxWidth: 640,
              maxHeight: '92vh' as any,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: '#22c55e66',
              overflow: 'hidden',
              backgroundColor: '#0f172af2',
              ...(Platform.OS === 'web' ? ({
                boxShadow:
                  '0 24px 70px rgba(0,0,0,0.55), 0 0 40px rgba(34,197,94,0.18), 0 0 0 1px rgba(255,255,255,0.02) inset',
              } as any) : {}),
            }}
          >
            <SpawnAgentPanel
              circleId={circleId}
              onCreated={(_id: string, _name: string) => {
                setShowSpawnPanel(false);
              }}
              onCancel={() => setShowSpawnPanel(false)}
            />
          </View>
        </View>
      )}

      {showAssignPanel && (
        <View
          pointerEvents="box-none"
          style={{
            ...(Platform.OS === 'web' ? ({ position: 'fixed' as any }) : StyleSheet.absoluteFillObject),
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 1200, alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <Pressable
            onPress={() => { setShowAssignPanel(false); setSelectedAgent(null); setTaskPrompt(''); }}
            accessibilityRole="button"
            accessibilityLabel="Close Assign Agent console"
            style={{
              ...(Platform.OS === 'web' ? ({ position: 'fixed' as any }) : StyleSheet.absoluteFillObject),
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: '#f59e0b08',
              ...(Platform.OS === 'web' ? ({
                backdropFilter: 'blur(14px) saturate(1.15)',
                WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
              } as any) : {}),
            }}
          />
          <View style={{
            width: '100%' as any,
            maxWidth: 620,
            maxHeight: '92vh' as any,
            padding: 20,
            backgroundColor: '#0f172af2',
            borderWidth: 1,
            borderColor: '#f59e0b66',
            borderRadius: 14,
            gap: 14,
            ...(Platform.OS === 'web' ? ({
              boxShadow: '0 24px 70px rgba(0,0,0,0.55), 0 0 40px rgba(245,158,11,0.18), 0 0 0 1px rgba(255,255,255,0.02) inset',
            } as any) : {}),
          }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
            <View style={{
              width: 38, height: 38, borderRadius: 10, borderWidth: 1,
              borderColor: '#f59e0b66', backgroundColor: '#f59e0b18',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: '#f59e0b', fontSize: 14, fontWeight: '800', fontFamily: 'monospace' }}>{'>_'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '700', letterSpacing: 0.3 }}>Assign Agent</Text>
              <Text style={{ color: '#f59e0baa', fontSize: 12, marginTop: 2 }}>Dispatch a task to a connected agent</Text>
            </View>
            <Pressable
              onPress={() => { setShowAssignPanel(false); setSelectedAgent(null); setTaskPrompt(''); }}
              style={({ hovered, pressed }: any) => [
                { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
                Platform.OS === 'web' && { transitionProperty: 'all', transitionDuration: '150ms' },
                hovered && { borderColor: '#f59e0b66', backgroundColor: '#f59e0b10' },
                pressed && { transform: [{ scale: 0.95 }] },
              ]}
            >
              <Text style={{ color: '#94a3b8', fontSize: 18, fontWeight: '600', lineHeight: 20 }}>{'×'}</Text>
            </Pressable>
          </View>

          <View style={{ height: 1, backgroundColor: '#f59e0b22' }} />

          {/* Agent selector — only active/building/idle agents shown */}
          {(() => {
            const activeAgents = liveAgents.filter(a => a.status === 'active' || a.status === 'building' || a.status === 'idle');
            return (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: '#f59e0b60', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' }}>
                    LIVE AGENTS{activeAgents.length > 0 ? ` · ${activeAgents.length}` : ''}
                  </Text>
                  <Pressable
                    onPress={() => { setShowAssignPanel(false); setSpawnModalOpen(true); }}
                    style={({ hovered, pressed }: any) => [
                      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b30' },
                      Platform.OS === 'web' && { transition: 'all 0.15s ease' } as any,
                      hovered && { borderColor: '#f59e0b60', backgroundColor: '#f59e0b0a' },
                      pressed && { transform: [{ scale: 0.95 }] },
                    ]}
                  >
                    <Text style={{ color: '#f59e0b', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' }}>+ SPAWN NEW</Text>
                  </Pressable>
                </View>
                {activeAgents.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 16, gap: 8 }}>
                    <Text style={{ color: '#64748b', fontSize: 12, fontFamily: 'monospace', textAlign: 'center' }}>No live agents detected</Text>
                    <Pressable
                      onPress={() => { setShowAssignPanel(false); setSpawnModalOpen(true); }}
                      style={({ hovered, pressed }: any) => [
                        { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#f59e0b40', backgroundColor: '#f59e0b08' },
                        Platform.OS === 'web' && { transition: 'all 0.15s ease' } as any,
                        hovered && { borderColor: '#f59e0b', backgroundColor: '#f59e0b15', transform: [{ translateY: -1 }] },
                        pressed && { transform: [{ scale: 0.96 }] },
                      ]}
                    >
                      <Text style={{ color: '#f59e0b', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' }}>SPAWN AGENTS</Text>
                    </Pressable>
                    <Text style={{ color: '#475569', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' }}>
                      Launch Claude Code, Codex, or OpenSwan sessions
                    </Text>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {activeAgents.map((agent: any) => {
                      const isSelected = selectedAgent?.id === agent.id;
                      const dotColor = ({ active: '#22c55e', idle: '#f59e0b', building: '#6366f1', error: '#ef4444' } as any)[agent.status] || '#888';
                      const agentColor = agent.color || accentColor;
                      return (
                        <Pressable
                          key={agent.id}
                          onPress={() => setSelectedAgent(isSelected ? null : agent)}
                          style={({ hovered, pressed }: any) => [
                            {
                              flexDirection: 'row', alignItems: 'center', gap: 8,
                              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
                              borderWidth: 1, marginRight: 8,
                              borderColor: isSelected ? agentColor + '60' : '#1e293b',
                              backgroundColor: isSelected ? agentColor + '12' : '#0f172a',
                              ...(isSelected && Platform.OS === 'web' ? { boxShadow: `2px 2px 0px ${agentColor}18` } as any : {}),
                            },
                            Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                            hovered && !isSelected && { borderColor: agentColor + '50', backgroundColor: agentColor + '08', transform: [{ translateY: -1 }] },
                            pressed && { transform: [{ scale: 0.96 }] },
                          ]}
                        >
                          <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dotColor }} />
                          <View>
                            <Text style={{ color: isSelected ? agentColor : '#fff', fontSize: 12, fontWeight: '900', fontFamily: 'monospace' }}>{agent.name}</Text>
                            {agent.provider && (
                              <Text style={{ color: isSelected ? agentColor + 'aa' : '#555', fontSize: 9, fontWeight: '700', letterSpacing: 0.5, fontFamily: 'monospace' }}>
                                {agent.provider.toUpperCase()}{agent.model ? ` · ${String(agent.model).toUpperCase()}` : ''}{agent.sessionKey && agent.source === 'openswan-session' ? ' · SESSION' : ''}
                              </Text>
                            )}
                            {agent.spirit ? (
                              <Text style={{ color: isSelected ? agentColor + '88' : '#666', fontSize: 8, fontWeight: '700', letterSpacing: 0.4, fontFamily: 'monospace' }}>
                                {agent.spirit}
                              </Text>
                            ) : null}
                          </View>
                          {isSelected && <Text style={{ color: agentColor, fontSize: 11, fontWeight: '900', fontFamily: 'monospace' }}>{'//'}  </Text>}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </>
            );
          })()}

          {/* Task input */}
          <Text style={{ color: '#f59e0b60', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' }}>TASK</Text>
          <TextInput
            style={{
              backgroundColor: '#111827', color: '#e2e8f0', borderRadius: 10,
              borderWidth: 1, borderColor: '#1e293b', padding: 12,
              fontSize: 13, fontFamily: 'monospace', minHeight: 60, maxHeight: 120,
              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
            }}
            value={taskPrompt}
            onChangeText={setTaskPrompt}
            placeholder={`What should ${selectedAgent?.name || 'the agent'} do?`}
            placeholderTextColor="#444"
            multiline
          />

          {selectedAgent?.provider === 'openswan' && (
            <Pressable
              onPress={async () => {
                if (!selectedAgent || assigning) return;
                setAssigning(true);
                setBotTyping(true);
                const requestedTask = taskPrompt.trim();
                if (requestedTask) addUserMessage(`@${selectedAgent.name}: spawn dedicated OpenSwan session for "${requestedTask}"`);
                try {
                  if (selectedAgent.id && selectedAgent.id !== DEFAULT_AGENT.id) {
                    await supabase.from('circle_office_agents')
                      .update({
                        current_task: requestedTask ? requestedTask.slice(0, 120) : 'Launching dedicated OpenSwan session',
                        status: 'building',
                        updated_at: new Date().toISOString(),
                        last_active_at: new Date().toISOString(),
                      })
                      .eq('id', selectedAgent.id);
                  }
                  const response = await spawnDedicatedOpenSwanSession(selectedAgent, requestedTask);
                  addBotMessage(response);
                  if (selectedAgent.id && selectedAgent.id !== DEFAULT_AGENT.id) {
                    await supabase.from('circle_office_agents')
                      .update({ current_task: null, status: 'idle' })
                      .eq('id', selectedAgent.id);
                  }
                } catch (e: any) {
                  await addRecoverableChatErrorMessage({
                    title: `**${selectedAgent.name}** failed to spawn a dedicated OpenSwan session`,
                    task: requestedTask || `Spawn a dedicated OpenSwan session for ${selectedAgent.name}`,
                    error: e,
                    executionKind: 'openswan_dedicated_session',
                    source: 'dedicated_openswan_spawn_error',
                    touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/openswanSessionRuntime.ts'],
                  });
                } finally {
                  setBotTyping(false);
                  setAssigning(false);
                  setTaskPrompt('');
                  setSelectedAgent(null);
                  setShowAssignPanel(false);
                }
              }}
              style={({ hovered, pressed }: any) => [
                {
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: '#8b5cf6',
                  backgroundColor: '#8b5cf612',
                  alignItems: 'center',
                },
                Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                hovered && { backgroundColor: '#8b5cf620', borderColor: '#a78bfa' },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text style={{ color: '#c4b5fd', fontSize: 10, fontWeight: '900', letterSpacing: 1.1, fontFamily: 'monospace' }}>
                + SPAWN DEDICATED OPENSWAN SESSION
              </Text>
            </Pressable>
          )}

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={() => { setShowAssignPanel(false); setSelectedAgent(null); setTaskPrompt(''); }}
              style={({ hovered, pressed }: any) => [
                { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: '#1e293b' },
                Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                hovered && { borderColor: '#888', backgroundColor: '#111' },
                pressed && { backgroundColor: '#222' },
              ]}
            >
              <Text style={{ color: '#666', fontSize: 11, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' }}>CANCEL</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (!selectedAgent || !taskPrompt.trim()) return;
                const assignedTask = taskPrompt.trim();
                setAssigning(true);
                addUserMessage(`@${selectedAgent.name}: ${assignedTask}`);
                setBotTyping(true);
                try {
                  if (selectedAgent.id && !selectedAgent.id.startsWith('bridge::') && selectedAgent.id !== DEFAULT_AGENT.id) {
                    await supabase.from('circle_office_agents')
                      .update({
                        current_task: assignedTask.slice(0, 120),
                        status: 'building',
                        updated_at: new Date().toISOString(),
                        last_active_at: new Date().toISOString(),
                      })
                      .eq('id', selectedAgent.id);
                  }
                  const response = await dispatchAssignedAgentTask(selectedAgent, assignedTask);
                  addBotMessage(response);
                  if (selectedAgent.id && !selectedAgent.id.startsWith('bridge::') && selectedAgent.id !== DEFAULT_AGENT.id) {
                    await supabase.from('circle_office_agents')
                      .update({ current_task: null, status: 'idle' })
                      .eq('id', selectedAgent.id);
                  }
                } catch (e: any) {
                  await addRecoverableChatErrorMessage({
                    title: `**${selectedAgent.name}** failed`,
                    task: `Assign ${assignedTask} to ${selectedAgent.name}`,
                    error: e,
                    executionKind: 'assigned_agent_task',
                    source: 'assign_panel_agent_error',
                    touched: ['src/screens/circles/tabs/ChatTab.tsx', 'src/lib/bridgeTaskDispatcher.ts'],
                  });
                } finally {
                  setBotTyping(false); setAssigning(false);
                  setTaskPrompt(''); setSelectedAgent(null); setShowAssignPanel(false);
                }
              }}
              disabled={!selectedAgent || !taskPrompt.trim() || assigning}
              style={({ hovered, pressed }: any) => [
                {
                  flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1,
                  borderColor: selectedAgent ? (selectedAgent.color || '#fff') : '#333',
                  backgroundColor: selectedAgent ? (selectedAgent.color || '#fff') : '#111',
                  alignItems: 'center',
                  opacity: selectedAgent && taskPrompt.trim() && !assigning ? 1 : 0.3,
                  ...(selectedAgent && Platform.OS === 'web' ? { boxShadow: `4px 4px 0px ${(selectedAgent.color || '#fff')}40` } as any : {}),
                },
                Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                hovered && selectedAgent && {
                  backgroundColor: (selectedAgent.color || '#fff') + 'dd',
                  ...(Platform.OS === 'web' ? { boxShadow: `4px 4px 0px ${(selectedAgent.color || '#fff')}50, 0 0 25px ${(selectedAgent.color || '#fff')}30` } as any : {}),
                },
                pressed && { transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text style={{ color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' }}>
                {assigning ? 'DISPATCHING...' : selectedAgent ? `ASSIGN TO ${selectedAgent.name.toUpperCase()}` : 'SELECT AN AGENT'}
              </Text>
            </Pressable>
          </View>
          </View>
        </View>
      )}

      {/* Handoff suggestion card */}
      {pendingHandoff && (
        <HandoffCard
          suggestion={pendingHandoff}
          circleId={circleId}
          userId={currentUserId || ''}
          accentColor={accentColor}
          onExecute={(action) => {
            addBotMessage(`[Handoff] ${action.message}`);
            setPendingHandoff(null);
          }}
        />
      )}

      {/* ── Computer-Use Panel (web only) ── */}
      {Platform.OS === 'web' && computerUseSession && (
        <ComputerUsePanel
          session={computerUseSession}
          onApproveAction={(actionId) => {
            setComputerUseSession(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                actions: prev.actions.map(a =>
                  a.id === actionId ? { ...a, status: 'approved' as const } : a
                ),
              };
            });
          }}
          onRejectAction={(actionId) => {
            setComputerUseSession(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                actions: prev.actions.map(a =>
                  a.id === actionId ? { ...a, status: 'rejected' as const } : a
                ),
              };
            });
          }}
          onApproveAll={() => {
            setComputerUseSession(prev => {
              if (!prev) return prev;
              const updated = {
                ...prev,
                actions: prev.actions.map(a =>
                  a.status === 'pending' ? { ...a, status: 'approved' as const } : a
                ),
                status: 'executing' as const,
              };
              // Start execution
              executeComputerUsePlan(updated, (completedAction, idx) => {
                setComputerUseSession(s => {
                  if (!s) return s;
                  const newActions = [...s.actions];
                  newActions[idx] = completedAction;
                  return { ...s, actions: newActions };
                });
              }).then(result => {
                setComputerUseSession(s => s ? {
                  ...s,
                  status: result.success ? 'completed' : 'failed',
                  actions: result.actions,
                  currentUrl: result.currentUrl || s.currentUrl,
                  backendSessionId: result.backendSessionId || s.backendSessionId,
                  backendLiveUrl: result.backendLiveUrl || s.backendLiveUrl,
                } : s);
                finalizeBrowserPlanFromSession(updated, result);
                addBotMessage(result.success
                  ? `**Computer Use** completed: ${result.message}`
                  : '**Computer Use** could not complete that browser task. Technical details were saved for recovery.');
              }).catch(() => {
                setComputerUseSession(s => s ? { ...s, status: 'failed' } : s);
                finalizeBrowserPlanFromSession(updated, { success: false });
              });
              return updated;
            });
          }}
          onPause={() => {
            setComputerUseSession(prev => prev ? { ...prev, status: 'paused' } : prev);
          }}
          onResume={() => {
            setComputerUseSession(prev => {
              if (!prev) return prev;
              const resumed = { ...prev, status: 'executing' as const };
              executeComputerUsePlan(resumed, (completedAction, idx) => {
                setComputerUseSession(s => {
                  if (!s) return s;
                  const newActions = [...s.actions];
                  newActions[idx] = completedAction;
                  return { ...s, actions: newActions };
                });
              }).then(result => {
                setComputerUseSession(s => s ? {
                  ...s,
                  status: result.success ? 'completed' : 'failed',
                  actions: result.actions,
                  currentUrl: result.currentUrl || s.currentUrl,
                  backendSessionId: result.backendSessionId || s.backendSessionId,
                  backendLiveUrl: result.backendLiveUrl || s.backendLiveUrl,
                } : s);
                finalizeBrowserPlanFromSession(resumed, result);
                addBotMessage(result.success
                  ? `**Computer Use** completed: ${result.message}`
                  : '**Computer Use** could not complete that browser task. Technical details were saved for recovery.');
              }).catch(() => {
                setComputerUseSession(s => s ? { ...s, status: 'failed' } : s);
                finalizeBrowserPlanFromSession(resumed, { success: false });
              });
              return resumed;
            });
          }}
          onCancel={() => {
            setComputerUseSession(null);
          }}
          onOpenSession={() => handleOpenBrowserSession({
            planId: computerUseSession.sourcePlanId || computerUseSession.id,
            task: computerUseSession.task,
            backend: computerUseSession.backend,
            backendLabel: computerUseSession.backendLabel,
            backendDetails: computerUseSession.backendDetails,
            requiresApproval: computerUseSession.permission !== 'trusted',
            status: computerUseSession.status === 'completed'
              ? 'completed'
              : computerUseSession.status === 'failed'
                ? 'failed'
                : 'launched',
            launchedAt: computerUseSession.startedAt,
            backendSessionId: computerUseSession.backendSessionId,
            backendLiveUrl: computerUseSession.backendLiveUrl,
            actions: computerUseSession.actions.map((action) => ({
              id: action.id,
              type: action.type,
              target: action.target,
              value: action.value,
              description: action.description,
              requiresApproval: action.requiresApproval,
            })),
          })}
          accentColor={accentColor}
        />
      )}

      <BrowserSessionDrawer
        session={selectedBrowserSession}
        visible={!!selectedBrowserSession}
        onClose={() => setSelectedBrowserSession(null)}
        onOpenLiveSession={(session) => handleOpenBrowserSession({
          planId: session.planId || session.id,
          task: session.task,
          backend: session.backend,
          backendLabel: session.backendLabel,
          backendDetails: session.backendDetails,
          requiresApproval: false,
          status: session.status === 'completed' ? 'completed' : session.status === 'failed' ? 'failed' : 'launched',
          launchedAt: session.startedAt,
          completedAt: session.completedAt,
          backendSessionId: session.backendSessionId,
          backendLiveUrl: session.backendLiveUrl,
          actions: session.actions.map((action) => ({
            id: action.id,
            type: action.type,
            target: action.target,
            value: action.value,
            description: action.description,
            requiresApproval: action.requiresApproval,
          })),
        })}
      />

      {/* Computer-Use Permission Dialog (web only) */}
      {Platform.OS === 'web' && showComputerUsePermission && pendingComputerUseActions.length > 0 && (
        <ComputerUsePermissionDialog
          task={pendingComputerUseTask}
          agentName={agentName}
          actions={pendingComputerUseActions}
          intent={pendingComputerUsePlan?.intent}
          recommendedPermission={pendingComputerUsePlan?.recommendedPermission}
          grantSummary={pendingComputerUseGrantSummary || null}
          approvalSummary={pendingComputerUseApprovalSummary || null}
          onAllow={async (permission: ComputerUsePermission) => {
            setShowComputerUsePermission(false);
            const taskToRun = pendingComputerUseTask;
            const planToRun = pendingComputerUsePlan;
            const originToRun = pendingComputerUseOrigin;
            const stickyScopeIdToRecord = pendingComputerUseStickyScopeId;
            const grantIdsToPersist = deriveGrantedScopesFromBrowserPermission(permission, pendingComputerUseGrantIds);
            await persistComputerTaskState({
              task: taskToRun,
              taskKind: 'browser_task',
              taskLabel: 'Browser task',
              phase: 'executing',
              adapterId: 'browser_adapter',
              grantedAccess: Array.from(new Set([...pendingComputerUseGrantIds, ...grantIdsToPersist])),
              accessPlan: pendingComputerUseGrantSummary || null,
              nextSteps: ['Run browser task', 'Summarize findings'],
              grounding: computerTaskState?.grounding || null,
              capabilityBuildout: computerTaskState?.capabilityBuildout || null,
              complexity: computerTaskState?.complexity || null,
              checkpointRecovery: computerTaskState?.checkpointRecovery || null,
            });
            // Snapshot + clear pending state before handing off to the
            // agent runtime so re-clicks don't double-fire.
            setPendingComputerUseTask('');
            setPendingComputerUseActions([]);
            setPendingComputerUsePlan(null);
            setPendingComputerUseGrantSummary('');
            setPendingComputerUseApprovalSummary('');
            setPendingComputerUseGrantIds([]);
            setPendingComputerUseOrigin(null);
            setPendingComputerUseStickyScopeId(null);
            computerUsePostedKeyRef.current = null;
            await grantComputerTaskScopes(circleId, grantIdsToPersist).catch(() => {});
            if (stickyScopeIdToRecord) {
              // T7 sticky allow scopes: the approved browser plan is now
              // actually launching (not previewing) — record use silently.
              void import('../../../lib/computerGrantGateStore')
                .then(({ recordStickyAllowScopeUse }) => recordStickyAllowScopeUse([stickyScopeIdToRecord]))
                .catch(() => {});
            }
            if (planToRun?.backend === 'playwright_bridge') {
              await runLocalBrowserPlan(planToRun, permission, originToRun);
              return;
            }
            const started = await computerUseTask.run(taskToRun, {
              model: resolveSendModel(taskToRun) || undefined,
            });
            if (!started.started) {
              addBotMessage('**Computer Use** could not start. Check the connection and try again.');
              return;
            }
            addBotMessage(`**Computer Use** starting — ${taskToRun}`);
          }}
          onDeny={() => {
            setShowComputerUsePermission(false);
            setComputerTaskState(null);
            void clearComputerTaskState(circleId, activeThreadId).catch(() => {});
            setPendingComputerUseTask('');
            setPendingComputerUseActions([]);
            setPendingComputerUsePlan(null);
            setPendingComputerUseGrantSummary('');
            setPendingComputerUseApprovalSummary('');
            setPendingComputerUseGrantIds([]);
            setPendingComputerUseOrigin(null);
            setPendingComputerUseStickyScopeId(null);
          }}
        />
      )}

      {Platform.OS === 'web' && (
        <ComputerUseConsole
          visible={showComputerUseConsole}
          accentColor={accentColor}
          taskState={computerTaskState}
          onClose={() => setShowComputerUseConsole(false)}
          onSubmit={runComputerUseTaskFromConsole}
          userId={currentUserId}
        />
      )}

      {Platform.OS === 'web' && (
        <React.Suspense fallback={null}>
          <OpenSwanConsole
            visible={showOpenSwanConsole}
            accentColor={accentColor}
            currentMode={chatMode}
            currentModel={selectedModel === 'auto' ? null : selectedModel}
            initialTask={openSwanInitialTask}
            circleId={circleId}
            userId={currentUserId}
            surface="main_chat"
            onClose={() => {
              setShowOpenSwanConsole(false);
              setOpenSwanInitialTask('');
            }}
            onSubmit={({ task, displayTask, mode, model: modelOverride }) => {
              setShowOpenSwanConsole(false);
              setOpenSwanInitialTask('');
              // Sync the mode into the chat state so the rest of the turn
              // renders with the right accent + response contract. The
              // immediate send also gets `modeOverride` below so planner
              // routing does not race React state.
              setChatMode(mode);
              if (modelOverride && modelOverride !== selectedModel) {
                handleSessionModelChange(modelOverride);
              }
              // Fire the task through the normal send path so it goes
              // through the planner + dispatcher + HITL gate.
              setInput(displayTask || task);
              sendMessage(task, {
                displayText: displayTask,
                modeOverride: mode,
                modelOverride,
              });

              // Auto-attach a live trace card to chat. Modes that bypass
              // the run pipeline (talk / none) skip this since they
              // never create an agent_runs row.
              if (mode !== 'talk' && mode !== 'none' && currentUserId) {
                attachRunTraceWhenAvailable(task);
              }
            }}
          />
        </React.Suspense>
      )}

      {Platform.OS === 'web' && agentMonitorTask && (
        <AgentMonitorHost
          task={agentMonitorTask}
          accentColor={accentColor}
          metrics={[
            ...(agentMonitorTask.needsAttention ? [{ label: 'Needs', value: agentMonitorTask.attentionLabel || 'Review', tone: 'warning' as const }] : []),
            ...(agentMonitorTask.liveUrl ? [{ label: 'Live', value: 'Ready', tone: 'info' as const }] : []),
          ]}
          onStop={() => computerUseTask.cancel()}
        >
          <React.Suspense fallback={null}>
            <ComputerUseLiveCard
              task={computerUseTask.state.task}
              status={computerUseTask.state.status === 'idle' ? 'error' : computerUseTask.state.status}
              sessionId={computerUseTask.state.sessionId}
              liveUrl={computerUseTask.state.liveUrl}
              reasoning={computerUseTask.state.reasoning}
              actions={computerUseTask.state.actions}
              screenshots={computerUseTask.state.screenshots}
              result={computerUseTask.state.result}
              errorMessage={computerUseTask.state.errorMessage}
              accentColor={accentColor}
              usage={computerUseTask.state.usage}
              pendingConfirmation={computerUseTask.state.pendingConfirmation}
              onConfirmationPick={(id, choice) => {
                if (!id) return;
                resolveComputerUseConfirmation(id, choice).catch((err) => {
                  addBotMessage('I could not record that confirmation. Try again in a moment.');
                });
              }}
              onCancel={() => computerUseTask.cancel()}
            />
          </React.Suspense>
        </AgentMonitorHost>
      )}

      {/* Enhanced input with model selector + quick actions + mode selector */}
      {/* Memory Toast — non-blocking notification */}
      {memoryToast && (
        <MemoryToast
          message={memoryToast.message}
          type={memoryToast.type}
          onDismiss={() => setMemoryToast(null)}
          onPress={() => { setMemoryToast(null); setShowMemoryViewer(true); }}
        />
      )}

      {/* Run Status Bar — shows active delegation/processing */}
      <RunStatusBar
        status={runStatus}
        subagentName={activeSubagent?.name}
        subagentIcon={activeSubagent?.icon}
        subagentColor={activeSubagent?.color}
        delegatedSubagents={activeDelegatedSubagents}
        currentStep={currentRunStep}
        accentColor={accentColor}
      />

      {/* Phase C1 — Supabase Storage attachment strip (drag-drop + multi-file) */}
      {circleId && currentUserId && (
        <ChatAttachmentStrip
          circleId={circleId}
          threadId={activeThreadId}
          userId={currentUserId}
          staged={stagedFiles}
          onStagedChange={setStagedFiles}
          accentColor={accentColor}
          showAttachButton={false}
        />
      )}

      {/* Recording badge — visible only while `/record start <name>` is
          actively capturing. Polls localStorage every 2s so state
          reflects starts/stops from any tab. */}
      <RecordingBadge />

      {/* Live Restore strip for the latest memory-bank checkpoint (plan §2c).
          Success/refusal feedback renders in the strip; a restore also posts
          a confirmation message via onRestored. */}
      {latestMemoryCheckpointId && circleId ? (
        <View style={{ marginHorizontal: 12 }}>
          <ToolCallCheckpointStrip
            circleId={circleId}
            checkpointId={latestMemoryCheckpointId}
            accentColor={accentColor}
            onRestored={() => {
              addBotMessage(
                'Restored — the memory bank change was rolled back to the checkpoint.',
                undefined,
                { localOnly: true },
              );
              setLatestMemoryCheckpointId(null);
            }}
          />
        </View>
      ) : null}

      {/* Mid-run steering (plan §4e) — visible while a computer task runs
          and is NOT paused on a question (the confirmation card owns input
          then). Notes are guidance-only; the approval floor is untouched. */}
      {computerUseTask.state.status === 'running'
        && !computerUseTask.state.pendingConfirmation
        && computerUseTask.state.runId ? (
        <ComputerTaskSteeringBar
          taskLabel={(computerUseTask.state.task || 'computer task').slice(0, 80)}
          accentColor={accentColor}
          onSend={(note) => sendComputerUseSteeringNote(computerUseTask.state.runId!, note)}
          onStop={() => computerUseTask.cancel()}
        />
      ) : null}

      {/* Mid-run steering for OpenSwan typed-loop turns (plan §7b) — same
          bar, in-memory bus instead of the DB channel. Hidden while a
          computer task owns the bar above. Guidance-only; the typed loop's
          approval gates are untouched. No Stop (turns have no cancel handle
          surfaced yet). */}
      {botTyping
        && runStatus === 'running'
        && !!activeThreadId
        && computerUseTask.state.status !== 'running'
        && isOpenSwanSteeringScopeActive(activeThreadId) ? (
        <ComputerTaskSteeringBar
          taskLabel={(currentRunStep || 'OpenSwan run').slice(0, 80)}
          accentColor={accentColor}
          onSend={async (note) => pushOpenSwanSteeringNote(activeThreadId, note)}
        />
      ) : null}

      {/* Room handoff suggestion (plan §4c) — dismissible, never automatic. */}
      {roomHandoffSuggestion ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 8,
          borderWidth: 1, borderColor: accentColor + '33', borderRadius: 10, backgroundColor: '#0d150d',
        }}>
          <Text style={{ flex: 1, color: '#d9e4d3', fontSize: 12 }} numberOfLines={2}>
            {roomHandoffSuggestion.reason}
          </Text>
          <Pressable
            disabled={roomHandoffBusy}
            onPress={() => { void handleAcceptRoomHandoff(); }}
            style={{ borderWidth: 1, borderColor: accentColor + '55', backgroundColor: accentColor + '22', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, opacity: roomHandoffBusy ? 0.5 : 1 }}
          >
            <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>
              {roomHandoffBusy ? 'Setting up…' : `Continue in room “${roomHandoffSuggestion.suggestedRoomName}”`}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setDismissedRoomHandoffThreads((prev) => new Set(prev).add(roomHandoffThreadKey))}
            style={{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#131d13' }}
          >
            <Text style={{ color: '#9fb29b', fontSize: 11, fontWeight: '600' }}>Not now</Text>
          </Pressable>
        </View>
      ) : null}

      {/* "Needs you" attention strip — chatAttentionQueue folds expiring/
          expired approvals, parked clarifications, live computer-task
          questions, recovery choices, and provider blockers into one summary
          so blocked work stops dying silently. */}
      <ChatAttentionStrip
        state={chatAttention}
        items={chatAttentionItems}
        onAction={handleChatAttentionAction}
        accentColor={accentColor}
      />

      {/* HITL pending chat approvals — `dispatchChatAutomationPlan` writes
          these to agent_approvals through chatApprovalGate. Surface them in
          Chat as well as Office so approval-gated requests do not disappear
          after the Plan Card defers. Edit & Resend (plan §6c) rejects the
          stale proposal and prefills the composer so the edited command
          files a FRESH approval. */}
      <HitlApprovalBanner
        approvals={pendingHitlApprovals.filter((approval) => {
          // P12 fix: rows past their timeout (nothing sweeps DB status)
          // must not show live APPROVE buttons here while the attention
          // strip above declares them expired — the strip's "Ask again"
          // is the only affordance for those.
          const expiresAt = resolveApprovalExpiresAt(approval.requested_at, approval.timeout_seconds);
          return expiresAt === null || expiresAt > Date.now();
        })}
        circleId={circleId}
        onEditAndResend={(_approval, commandText) => {
          setInput(commandText);
          inputRef.current?.focus();
          // Flywheel: Edit & Resend is an implicit "that wasn't quite it" —
          // stamp edit_resend on the most recent persisted bot message (the
          // proposal being edited) if we can identify one. Fire-and-forget.
          const priorBot = [...messages].reverse().find((m) => m.isBot && !!m.dbId);
          if (priorBot) stampOutcomeSignalRef.current(priorBot.id, { signal: 'edit_resend' });
        }}
      />

      {/* HITL pending approvals — v2 M3d writes to agent_run_approvals
          from `approvals.request`; surface inline so users can
          approve/reject without leaving chat. */}
      {currentUserId ? (
        <RunApprovalBanner circleId={circleId} userId={currentUserId} accentColor={accentColor} />
      ) : null}

      <EnhancedInput
        circleId={circleId}
        input={input}
        onInputChange={handleInputChange}
        onSend={sendMessage}
        webSearchEnabled={webSearchEnabled}
        onToggleWebSearch={handleToggleWebSearch}
        onFocusBot={() => {
          if (!input.toLowerCase().includes(`@${agentName.toLowerCase()}`)) setInput(`@${agentName} ` + input);
          inputRef.current?.focus();
        }}
        inputRef={inputRef}
        accentColor={accentColor}
        selectedModel={selectedModel}
        onModelChange={handleSessionModelChange}
        marketplaceModelGroups={marketplaceModelGroups}
        attachments={attachments}
        hasStagedFiles={stagedFiles.length > 0}
        onPickImage={async () => {
          const results = await pickAttachments();
          if (results.length > 0) setAttachments(prev => [...prev, ...results]);
        }}
        onRemoveAttachment={(id: string) => setAttachments(prev => prev.filter(a => a.id !== id))}
        chatMode={chatMode}
        onModeChange={setChatMode}
        chatAgentTargets={chatAgentTargets}
        selectedChatAgentTarget={selectedChatAgentTarget}
        onSelectChatAgent={setSelectedChatAgentId}
        onOpenAgentSetup={() => setSpawnModalOpen(true)}
        sessionProfile={sessionProfile}
        agentName={agentName}
        agentAvatarSource={agentAvatarSource}
        onQuickAction={handleQuickActionSelection}
        activePlugins={activePlugins}
        onOpenPlugins={() => setShowPluginPicker(true)}
        onOpenMemory={() => setShowMemoryViewer(true)}
        hasBuilderWork={canOpenBuilder}
        showWorkbenchSidecar={showWorkbenchSidecar}
        onToggleBuilder={openBuilderStudio}
        onOpenControlPanel={(seedTask?: string) => {
          setOpenSwanInitialTask(String(seedTask || input || '').trim());
          setShowOpenSwanConsole(true);
        }}
        onResetMind={async () => {
          const { resetAgentMind } = await import('../../../lib/swanbot');
          const { cleared } = await resetAgentMind(circleId);
          setMessages([]);
          addBotMessage(`Mind reset. ${cleared > 0 ? `Cleared ${cleared} memories. ` : ''}Starting fresh.`);
        }}
        onLocalBotMessage={(md: string, extra?: ChatBotMessageExtra) => addBotMessage(md, undefined, extra)}
      />
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Enhanced Sub Components ─────────────────────────────────────────────────

function EnhancedPromptCard({ label, onPress, accentColor, delay }: {
  label: string;
  onPress: () => void;
  accentColor: string;
  delay: number;
}) {
  const [hovered, setHovered] = useState(false);
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay]);

  const cardStyle = Platform.OS === 'web' ? {
    backdropFilter: hovered ? 'blur(10px)' : 'none',
    boxShadow: hovered ? `0 8px 32px ${accentColor}20` : 'none',
    transform: hovered ? 'translateY(-2px) perspective(1000px) rotateX(2deg)' : 'none',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  } as any : {};

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateY: slideAnim }],
      }}
    >
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[
          styles.enhancedPromptCard,
          { borderColor: accentColor + '30', backgroundColor: accentColor + '10' },
          cardStyle,
        ]}
      >
        <Text style={[styles.enhancedPromptText, { color: accentColor }]}>{label}</Text>
        {Platform.OS === 'web' && hovered && (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: `linear-gradient(135deg, ${accentColor}20, transparent)`,
            borderRadius: 12,
            pointerEvents: 'none',
          }} />
        )}
      </Pressable>
    </Animated.View>
  );
}

function GlassmorphismCard({ category, expanded, onToggle, onPromptPress, accentColor }: {
  category: any;
  expanded: boolean;
  onToggle: () => void;
  onPromptPress: (text: string) => void;
  accentColor: string;
}) {
  const [hovered, setHovered] = useState(false);
  
  const cardStyle = Platform.OS === 'web' ? {
    backgroundColor: expanded ? `${category.color}15` : '#11111180',
    backdropFilter: 'blur(10px)',
    borderColor: expanded ? category.color + '40' : '#00000060',
    boxShadow: expanded ? `0 8px 32px ${category.color}20` : 'none',
    transition: 'all 0.3s ease',
  } as any : {
    backgroundColor: expanded ? category.color + '15' : '#111111cc',
  };

  return (
    <View
      style={[styles.glassmorphismCard, cardStyle]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <Pressable onPress={onToggle} style={styles.categoryHeader}>
        <Text style={[styles.categoryTitle, { color: expanded ? category.color : '#888' }]}>
          {category.title}
        </Text>
        <Text style={[styles.categoryChevron, { color: category.color }]}>
          {expanded ? '▾' : '▸'}
        </Text>
      </Pressable>
      
      {expanded && (
        <View style={styles.categoryPrompts}>
          {category.prompts.map((p: any, pIdx: number) => (
            <EnhancedPromptItem
              key={pIdx}
              prompt={p}
              onPress={onPromptPress}
              color={category.color}
              delay={pIdx * 50}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function EnhancedPromptItem({ prompt, onPress, color, delay }: {
  prompt: any;
  onPress: (text: string) => void;
  color: string;
  delay: number;
}) {
  const [pressed, setPressed] = useState(false);
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      delay,
      useNativeDriver: true,
    }).start();
  }, [delay]);

  return (
    <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>
      <Pressable
        onPress={() => {
          if (prompt.text.endsWith(' ')) {
            onPress(prompt.text);
          } else {
            onPress(prompt.text);
          }
        }}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        style={[
          styles.enhancedPromptItem,
          pressed && { backgroundColor: color + '20', transform: [{ scale: 0.98 }] },
        ]}
      >
        <View style={styles.promptInfo}>
          <Text style={[styles.promptLabel, { color: pressed ? color : '#fff' }]}>
            {prompt.label}
          </Text>
          <Text style={styles.promptDesc}>{prompt.desc}</Text>
        </View>
        <Text style={[styles.promptArrow, { color: color }]}>→</Text>
      </Pressable>
    </Animated.View>
  );
}

function TipCard({ tip, delay, accentColor }: { tip: string; delay: number; accentColor: string }) {
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay]);

  return (
    <Animated.View
      style={[
        styles.enhancedTipCard,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      <View style={[styles.tipAccent, { backgroundColor: accentColor }]} />
      <Text style={styles.tipText}>{tip}</Text>
    </Animated.View>
  );
}

function MessageRow({
  item, consecutive, reactionEntries, currentUserId,
  showReactions, onToggleReactions, onReply, onReaction, onDelete, renderContent, accentColor, messageDensity, agentAvatarSource, agentName,
}: any) {
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerEnter = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    setHovered(true);
  }, []);

  const handlePointerLeave = useCallback(() => {
    setHovered(false);
  }, []);

  const messageStyle = Platform.OS === 'web' ? {
    transition: 'all 0.2s ease',
  } as any : {};

  const spacing = messageDensity === 'compact' ? 6 : 12;

  return (
    <View
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      style={[
        styles.enhancedMessageRow,
        consecutive && { marginBottom: spacing / 2, marginTop: -spacing / 2 },
        { marginBottom: spacing },
        messageStyle,
      ]}
    >
      {item.replyTo && (
        <View style={styles.replyIndicator}>
          <View style={[styles.replyIndicatorAccent, { backgroundColor: accentColor }]} />
          <Text style={[styles.replyIndicatorName, { color: accentColor }]}>{item.replyTo.name}</Text>
          <Text style={styles.replyIndicatorText}> {item.replyTo.content}</Text>
        </View>
      )}

      {!consecutive && (
        <View style={styles.messageHeader}>
          <View style={[
            styles.enhancedMsgAvatar,
            item.isUser && styles.msgAvatarMe,
            item.isBot && { backgroundColor: accentColor + '30' },
          ]}>
            {item.isBot ? (
              <Image source={agentAvatarSource} style={styles.mainChatAgentMessageIcon} resizeMode="contain" />
            ) : (
              <Text style={styles.msgAvatarText}>
                {(item.userName || '?').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          {item.isBot ? (
            // Inline identity row — the message bubble already shows the bot
            // avatar in the circle to the left, so we DON'T render the avatar
            // image again here next to the name. (FloatingChat still uses
            // ChatBotIdentityRow with its inline image since it has no
            // separate avatar circle.)
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.msgName, { color: accentColor, fontWeight: '700' }]}>
                {item.userName || agentName}
              </Text>
              <View style={{ backgroundColor: accentColor + '30', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 }}>
                <Text style={{ color: accentColor, fontSize: 9, fontWeight: '900', letterSpacing: 1 }}>AI</Text>
              </View>
              <Text style={[styles.msgTime, { marginLeft: 'auto' }]}>
                {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.msgName}>
                {item.userName || 'Unknown'}
              </Text>
              <Text style={styles.msgTime}>
                {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </>
          )}
        </View>
      )}

      <View style={styles.msgContentWrap}>
        <View
          style={[
            styles.enhancedMsgBubble,
            item.isBot && {
              borderColor: hovered ? accentColor : accentColor + 'aa',
              backgroundColor: accentColor + '12',
              ...(Platform.OS === 'web'
                ? {
                    boxShadow: `0 0 ${hovered ? '22px' : '14px'} ${accentColor}${hovered ? '55' : '2e'}`,
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  } as any
                : {
                    shadowColor: accentColor,
                    shadowOpacity: hovered ? 0.6 : 0.4,
                    shadowRadius: hovered ? 16 : 11,
                    shadowOffset: { width: 0, height: 0 },
                  }),
            },
          ]}
        >
          {renderContent(item)}
        </View>
        
        {hovered && (
          <View
            style={[styles.enhancedHoverActions, { backgroundColor: accentColor + '20' }]}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          >
            {REACTIONS_LIST.slice(0, 4).map((emoji) => (
              <Pressable key={emoji} onPress={() => onReaction(emoji)} style={styles.hoverBtn} accessibilityRole="button">
                <Text style={styles.hoverBtnText}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable onPress={onToggleReactions} style={styles.hoverBtn} accessibilityRole="button">
              <Text style={styles.hoverBtnText}>＋</Text>
            </Pressable>
            <View style={[styles.hoverDivider, { backgroundColor: accentColor + '40' }]} />
            <Pressable onPress={onReply} style={styles.hoverBtn} accessibilityRole="button">
              <Text style={styles.hoverBtnText}>↩</Text>
            </Pressable>
            {onDelete && (
              <Pressable onPress={onDelete} style={styles.hoverBtn} accessibilityRole="button">
                <Text style={[styles.hoverBtnText, { color: '#ef4444' }]}>🗑</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {showReactions && (
        <EnhancedReactionPicker
          onReaction={onReaction}
          accentColor={accentColor}
        />
      )}

      {reactionEntries.length > 0 && (
        <View style={styles.reactionRow}>
          {reactionEntries.map(([emoji, users]: [string, string[]]) => (
            <Pressable key={emoji} onPress={() => onReaction(emoji)}
              style={[
                styles.enhancedReactionBadge,
                { borderColor: accentColor + '40' },
                users.includes(currentUserId) && { borderColor: accentColor, backgroundColor: accentColor + '20' },
              ]}>
              <Text style={styles.reactionEmoji}>{emoji}</Text>
              <Text style={[styles.reactionCount, { color: users.includes(currentUserId) ? accentColor : '#888' }]}>
                {users.length}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Special effects for check-ins and achievements */}
      {(item.isCheckIn || item.isAchievement) && (
        <View style={[styles.specialMessageGlow, Platform.OS === 'web' ? { boxShadow: `0 0 8px ${item.isAchievement ? '#f59e0b' : accentColor}4d` } as any : { shadowColor: item.isAchievement ? '#f59e0b' : accentColor }]} />
      )}
    </View>
  );
}

function EnhancedReactionPicker({ onReaction, accentColor }: { onReaction: (emoji: string) => void; accentColor: string }) {
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, []);

  const pickerStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(10px)',
    boxShadow: `0 8px 32px ${accentColor}30`,
  } as any : {};

  return (
    <Animated.View
      style={[
        styles.enhancedReactionPicker,
        { borderColor: accentColor + '40' },
        pickerStyle,
        {
          opacity: slideAnim,
          transform: [
            {
              scale: slideAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.8, 1],
              }),
            },
          ],
        },
      ]}
    >
      {REACTIONS_LIST.map((emoji) => (
        <Pressable
          key={emoji}
          onPress={() => onReaction(emoji)}
          style={[styles.reactionPickerItem, { backgroundColor: accentColor + '10' }]}
        >
          <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
        </Pressable>
      ))}
    </Animated.View>
  );
}

function EnhancedQuickBar({ onPromptPress, onSendCrypto, onNuke, accentColor, circleId, userId, userName }: {
  onPromptPress: (text: string) => void;
  onSendCrypto: () => void;
  onNuke: () => Promise<void>;
  accentColor: string;
  circleId?: string;
  userId?: string | null;
  userName?: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [showStepAway, setShowStepAway] = useState(false);
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [checkInText, setCheckInText] = useState('');
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPostToChat, setTaskPostToChat] = useState(true);
  const [taskLoading, setTaskLoading] = useState(false);
  const [showNukeConfirm, setShowNukeConfirm] = useState(false);
  const [nuking, setNuking] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollX = useRef(0);
  const contentWidth = useRef(0);
  const containerWidth = useRef(0);

  const handleCheckIn = async () => {
    const text = checkInText.trim();
    if (!text || text.length < 10) return;
    if (!userId || !circleId) return;
    setCheckInLoading(true);
    try {
      const { error } = await supabase.from('check_ins').insert({
        user_id: userId,
        circle_id: circleId,
        content: text.slice(0, 500),
        check_in_date: new Date().toISOString().split('T')[0],
      });
      if (error) {
        if (error.code === '23505') {
          onPromptPress('who checked in');
        }
        setCheckInLoading(false);
        return;
      }
      awardXP(userId, getXPForAction('check_in'), 'check_in', { circle_id: circleId }).catch(() => {});
      setCheckInText('');
      setShowCheckIn(false);
      // Announce in chat
      onPromptPress(`I just checked in: "${text}"`);
    } catch {
      // ignore
    }
    setCheckInLoading(false);
  };

  const handleCreateTask = async () => {
    const title = taskTitle.trim();
    if (!title || !userId || !circleId) return;
    setTaskLoading(true);
    try {
      const { error } = await supabase.from('tasks').insert({
        circle_id: circleId,
        created_by: userId,
        title,
        status: 'open',
        priority: 'normal',
      });
      if (error) {
        setTaskLoading(false);
        return;
      }
      awardXP(userId, getXPForAction('create_task'), 'create_task', { circle_id: circleId }).catch(() => {});
      setTaskTitle('');
      setShowCreateTask(false);
      if (taskPostToChat) {
        onPromptPress(`I just created a task: "${title}"`);
      }
    } catch {
      // ignore
    }
    setTaskLoading(false);
  };

  const updateArrows = () => {
    setCanScrollLeft(scrollX.current > 5);
    setCanScrollRight(scrollX.current < contentWidth.current - containerWidth.current - 5);
  };

  const scrollLeft = () => {
    const newX = Math.max(0, scrollX.current - 200);
    scrollRef.current?.scrollTo({ x: newX, animated: true });
  };

  const scrollRight = () => {
    const maxX = contentWidth.current - containerWidth.current;
    const newX = Math.min(maxX, scrollX.current + 200);
    scrollRef.current?.scrollTo({ x: newX, animated: true });
  };

  const barStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(10px)',
    borderColor: accentColor + '20',
  } as any : { borderColor: accentColor + '20' };

  return (
    <View style={[styles.enhancedQuickBar, barStyle]}>
      {canScrollLeft && (
        <Pressable onPress={scrollLeft} style={[styles.scrollArrow, styles.scrollArrowLeft]}>
          <Text style={styles.scrollArrowText}>{'‹'}</Text>
        </Pressable>
      )}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickBarScroll}
        onScroll={(e) => {
          scrollX.current = e.nativeEvent.contentOffset.x;
          updateArrows();
        }}
        onContentSizeChange={(w) => { contentWidth.current = w; updateArrows(); }}
        onLayout={(e) => { containerWidth.current = e.nativeEvent.layout.width; updateArrows(); }}
        scrollEventThrottle={16}
      >
        <EnhancedQuickChip label="✅ Check In" onPress={() => setShowCheckIn(true)} accentColor={accentColor} />
        <EnhancedQuickChip label="📋 New Task" onPress={() => setShowCreateTask(true)} accentColor={accentColor} />
        {QUICK_PROMPTS.map((p, i) => (
          <EnhancedQuickChip
            key={i}
            label={p.label}
            onPress={() => p.text === '__SEND_CRYPTO__' ? onSendCrypto() : onPromptPress(p.text)}
            accentColor={accentColor}
          />
        ))}
        <EnhancedQuickChip label="🧠 Trivia" onPress={() => onPromptPress('trivia')} accentColor={accentColor} />
        <EnhancedQuickChip label="🤔 WYR" onPress={() => onPromptPress('would you rather')} accentColor={accentColor} />
        <EnhancedQuickChip label="🔥 Hot Take" onPress={() => onPromptPress('hot take')} accentColor={accentColor} />
        <EnhancedQuickChip label="🖥️ Step Away" onPress={() => setShowStepAway(true)} accentColor={accentColor} />
        <EnhancedQuickChip label=">_ More" onPress={() => onPromptPress('help')} accentColor={accentColor} />
        <EnhancedQuickChip label="☢️ Nuke It" onPress={() => setShowNukeConfirm(true)} accentColor={'#ef4444'} />
      </ScrollView>
      {canScrollRight && (
        <Pressable onPress={scrollRight} style={[styles.scrollArrow, styles.scrollArrowRight]}>
          <Text style={styles.scrollArrowText}>{'›'}</Text>
        </Pressable>
      )}

      {/* Step Away Modal (rendered inline, triggered by chip) */}
      {showStepAway && userId && circleId && (
        <StepAwayCard
          circleId={circleId}
          userId={userId}
          userName={userName || ''}
          onPost={async (_type, content) => {
            onPromptPress(content);
            setShowStepAway(false);
          }}
          autoOpen
          onClose={() => setShowStepAway(false)}
        />
      )}

      {/* Inline Check-In Panel */}
      {showCheckIn && (
        <View style={[checkInStyles.panel, { borderColor: accentColor + '30' }]}>
          <View style={checkInStyles.header}>
            <Text style={checkInStyles.title}>✅ Quick Check-In</Text>
            <Pressable onPress={() => setShowCheckIn(false)}>
              <Text style={checkInStyles.close}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={[checkInStyles.input, { borderColor: accentColor + '30' }]}
            placeholder="What did you work on today?"
            placeholderTextColor="#555"
            value={checkInText}
            onChangeText={setCheckInText}
            multiline
            maxLength={500}
            autoFocus
          />
          <View style={checkInStyles.footer}>
            <Text style={checkInStyles.charCount}>{checkInText.trim().length < 10 ? `${10 - checkInText.trim().length} more chars` : '✓'}</Text>
            <Pressable
              onPress={handleCheckIn}
              disabled={checkInLoading || checkInText.trim().length < 10}
              style={[checkInStyles.submitBtn, { backgroundColor: checkInText.trim().length >= 10 ? accentColor : '#333' }]}
            >
              <Text style={checkInStyles.submitText}>{checkInLoading ? '...' : 'Check In'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Inline Create Task Panel */}
      {showCreateTask && (
        <View style={[checkInStyles.panel, { borderColor: accentColor + '30' }]}>
          <View style={checkInStyles.header}>
            <Text style={checkInStyles.title}>📋 New Task</Text>
            <Pressable onPress={() => setShowCreateTask(false)}>
              <Text style={checkInStyles.close}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={[checkInStyles.input, { borderColor: accentColor + '30', minHeight: 40 }]}
            placeholder="Task title..."
            placeholderTextColor="#555"
            value={taskTitle}
            onChangeText={setTaskTitle}
            maxLength={200}
            autoFocus
          />
          <View style={checkInStyles.footer}>
            <Pressable onPress={() => setTaskPostToChat(!taskPostToChat)} style={checkInStyles.checkbox}>
              <View style={[checkInStyles.checkboxBox, taskPostToChat && { backgroundColor: accentColor, borderColor: accentColor }]}>
                {taskPostToChat && <Text style={checkInStyles.checkboxCheck}>✓</Text>}
              </View>
              <Text style={checkInStyles.checkboxLabel}>Post to chat</Text>
            </Pressable>
            <Pressable
              onPress={handleCreateTask}
              disabled={taskLoading || !taskTitle.trim()}
              style={[checkInStyles.submitBtn, { backgroundColor: taskTitle.trim() ? accentColor : '#333' }]}
            >
              <Text style={checkInStyles.submitText}>{taskLoading ? '...' : 'Create'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Nuke Confirmation */}
      {showNukeConfirm && (
        <View style={[checkInStyles.panel, { borderColor: '#ffffff20' }]}>
          <View style={checkInStyles.header}>
            <Text style={checkInStyles.title}>☢️ Nuke All Messages?</Text>
            <Pressable onPress={() => setShowNukeConfirm(false)}>
              <Text style={checkInStyles.close}>✕</Text>
            </Pressable>
          </View>
          <Text style={{ color: '#999', fontSize: 12, marginBottom: 10 }}>This will permanently delete every message in this chat. This cannot be undone.</Text>
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <Pressable
              onPress={() => setShowNukeConfirm(false)}
              style={[checkInStyles.submitBtn, { backgroundColor: '#333' }]}
            >
              <Text style={checkInStyles.submitText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                setNuking(true);
                await onNuke();
                setNuking(false);
                setShowNukeConfirm(false);
              }}
              disabled={nuking}
              style={[checkInStyles.submitBtn, { backgroundColor: '#ef4444' }]}
            >
              <Text style={checkInStyles.submitText}>{nuking ? '...' : 'Nuke It ☢️'}</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function EnhancedQuickChip({ label, onPress, accentColor }: {
  label: string;
  onPress: () => void;
  accentColor: string;
}) {
  const [pressed, setPressed] = useState(false);
  
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.enhancedQuickChip,
        { borderColor: accentColor + '30', backgroundColor: accentColor + '10' },
        pressed && { backgroundColor: accentColor + '20', transform: [{ scale: 0.95 }] },
      ]}
    >
      <Text style={[styles.quickBarChipText, { color: pressed ? accentColor : '#888' }]}>{label}</Text>
    </Pressable>
  );
}

function EnhancedCryptoPanel({ wallet, sendTo, sendAmount, sendingCrypto, members, currentUserId, accentColor, onClose, onWalletConnect, onSendToChange, onSendAmountChange, onSend, onDisconnect, onBotMessage }: any) {
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, []);

  const panelStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(15px)',
    boxShadow: `0 -8px 32px ${accentColor}20`,
  } as any : {};

  return (
    <Animated.View
      style={[
        styles.enhancedCryptoPanel,
        { borderColor: accentColor + '40' },
        panelStyle,
        { transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.cryptoPanelHeader}>
        <Text style={[styles.cryptoPanelTitle, { color: accentColor }]}>💸 SEND CRYPTO</Text>
        <Pressable onPress={onClose} style={[styles.cryptoPanelClose, { borderColor: accentColor + '40' }]}>
          <Text style={styles.cryptoPanelCloseText}>✕</Text>
        </Pressable>
      </View>

      {/* Enhanced wallet selector */}
      <Text style={styles.cryptoLabel}>WALLET</Text>
      <View style={styles.walletSelector}>
        <EnhancedWalletOption
          icon="🦊"
          name="MetaMask"
          chain="Ethereum"
          active={wallet?.chain === 'ethereum'}
          address={wallet?.chain === 'ethereum' ? wallet.address : null}
          accentColor={accentColor}
          onPress={async () => {
            try {
              const { connectWallet } = await import('../../../lib/crypto');
              const w = await connectWallet('metamask');
              onWalletConnect(w);
            } catch (e: any) {
              onBotMessage(`MetaMask: ${e.message}`);
            }
          }}
        />
        <EnhancedWalletOption
          icon="👻"
          name="Phantom"
          chain="Solana"
          active={wallet?.chain === 'solana'}
          address={wallet?.chain === 'solana' ? wallet.address : null}
          accentColor={accentColor}
          onPress={async () => {
            try {
              const { connectWallet } = await import('../../../lib/crypto');
              const w = await connectWallet('phantom');
              onWalletConnect(w);
            } catch (e: any) {
              onBotMessage(`Phantom: ${e.message}`);
            }
          }}
        />
      </View>

      {wallet && (
        <Pressable
          onPress={async () => {
            await onDisconnect(wallet.chain);
          }}
          style={styles.walletDisconnectBtn}
        >
          <Text style={styles.walletDisconnectText}>
            ⏏ Disconnect {wallet.chain === 'ethereum' ? 'MetaMask' : 'Phantom'}
          </Text>
        </Pressable>
      )}

      <Text style={styles.cryptoLabel}>TO (username or wallet address)</Text>
      <TextInput
        style={[styles.enhancedCryptoInput, { borderColor: accentColor + '30' }]}
        placeholder="@username or 0x..."
        placeholderTextColor="#444"
        value={sendTo}
        onChangeText={onSendToChange}
      />

      {/* Member quick-pick */}
      {members.filter((m: any) => m.id !== BLACKSWAN_ID && m.id !== BLACKSWAN_ID && m.id !== currentUserId).length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.memberPickScroll}>
          <View style={styles.memberPickRow}>
            {members.filter((m: any) => m.id !== BLACKSWAN_ID && m.id !== BLACKSWAN_ID && m.id !== currentUserId).map((m: any) => (
              <Pressable
                key={m.id}
                onPress={() => onSendToChange(m.username)}
                style={[
                  styles.enhancedMemberPickChip,
                  { borderColor: accentColor + '30' },
                  sendTo === m.username && { borderColor: accentColor, backgroundColor: accentColor + '20' },
                ]}
              >
                <Text style={[styles.memberPickText, { color: sendTo === m.username ? accentColor : '#888' }]}>
                  @{m.username}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <Text style={styles.cryptoLabel}>AMOUNT ({wallet?.chain === 'solana' ? 'SOL' : 'ETH'})</Text>
      <View style={styles.cryptoAmountRow}>
        <TextInput
          style={[styles.enhancedCryptoInput, { flex: 1, borderColor: accentColor + '30' }]}
          placeholder="0.01"
          placeholderTextColor="#444"
          value={sendAmount}
          onChangeText={onSendAmountChange}
          keyboardType="numeric"
        />
        <View style={styles.cryptoQuickAmounts}>
          {['0.001', '0.01', '0.05', '0.1'].map((amt) => (
            <Pressable 
              key={amt} 
              onPress={() => onSendAmountChange(amt)} 
              style={[styles.cryptoQuickBtn, { borderColor: accentColor + '30' }]}
            >
              <Text style={[styles.cryptoQuickBtnText, { color: accentColor }]}>{amt}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Transaction preview with glow effect */}
      {sendTo.trim() && sendAmount.trim() && wallet && (
        <View style={[styles.enhancedTxPreview, { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}>
          <Text style={styles.txPreviewText}>
            {wallet.chain === 'ethereum' ? '🦊' : '👻'} Send{' '}
            <Text style={[styles.txPreviewBold, { color: accentColor }]}>
              {sendAmount} {wallet.chain === 'solana' ? 'SOL' : 'ETH'}
            </Text>
            {' '}to{' '}
            <Text style={[styles.txPreviewBold, { color: accentColor }]}>{sendTo}</Text>
          </Text>
        </View>
      )}

      <EnhancedSendButton
        onPress={onSend}
        disabled={!sendTo.trim() || !sendAmount.trim() || sendingCrypto || !wallet}
        sending={sendingCrypto}
        wallet={wallet}
        accentColor={accentColor}
      />
    </Animated.View>
  );
}

function EnhancedWalletOption({ icon, name, chain, active, address, accentColor, onPress }: any) {
  const [hovered, setHovered] = useState(false);
  
  const optionStyle = Platform.OS === 'web' ? {
    transform: hovered ? 'scale(1.02)' : 'scale(1)',
    transition: 'all 0.2s ease',
  } as any : {};

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.enhancedWalletOption,
        { borderColor: active ? accentColor : '#000000', backgroundColor: active ? accentColor + '15' : '#111' },
        optionStyle,
      ]}
    >
      <Text style={styles.walletOptionIcon}>{icon}</Text>
      <View style={styles.walletOptionInfo}>
        <Text style={[styles.walletOptionName, { color: active ? '#fff' : '#888' }]}>{name}</Text>
        <Text style={styles.walletOptionChain}>
          {address ? shortenAddress(address) : chain}
        </Text>
      </View>
      {active && (
        <View style={[styles.walletActiveDot, { backgroundColor: accentColor }]} />
      )}
    </Pressable>
  );
}

function EnhancedSendButton({ onPress, disabled, sending, wallet, accentColor }: any) {
  const [hovered, setHovered] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!disabled) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [disabled]);

  const buttonStyle = Platform.OS === 'web' ? {
    boxShadow: !disabled && hovered ? `0 8px 32px ${accentColor}40` : 'none',
    transition: 'all 0.3s ease',
  } as any : {};

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[
          styles.enhancedSendButton,
          { backgroundColor: disabled ? '#1a1a1a' : accentColor },
          buttonStyle,
          disabled && { opacity: 0.5 },
        ]}
      >
        <Text style={[styles.cryptoSendBtnText, { color: disabled ? '#666' : '#000' }]}>
          {sending ? 'SENDING...' : !wallet ? 'SELECT WALLET FIRST' : `SEND ${wallet.chain === 'solana' ? 'SOL' : 'ETH'}`}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function EnhancedMentionPopup({ members, onSelect, accentColor, agentAvatarSource }: any) {
  const slideAnim = useRef(new Animated.Value(-50)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, []);

  const popupStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(15px)',
    boxShadow: `0 8px 32px ${accentColor}30`,
  } as any : {};

  return (
    <Animated.View
      style={[
        styles.enhancedMentionPopup,
        { borderColor: accentColor + '40' },
        popupStyle,
        { transform: [{ translateY: slideAnim }] },
      ]}
    >
      {members.slice(0, 6).map((m: any) => (
        <Pressable key={m.id} onPress={() => onSelect(m)} style={styles.enhancedMentionItem}>
          <View style={[
            styles.mentionAvatar,
            m.id === BLACKSWAN_ID && { backgroundColor: '#6366f115' },
          ]}>
            {m.id === BLACKSWAN_ID ? (
              <Image source={agentAvatarSource} style={styles.mainChatAgentMentionIcon} resizeMode="contain" />
            ) : (
              <Text style={styles.mentionAvatarText}>
                {(m.display_name || '?').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mentionName}>{m.display_name || m.username}</Text>
            <Text style={styles.mentionHandle}>@{m.username}</Text>
          </View>
          {m.id === BLACKSWAN_ID && (
            <View style={[styles.mentionBotBadge, { backgroundColor: '#6366f120' }]}>
              <Text style={[styles.mentionBotBadgeText, { color: '#6366f1' }]}>AI</Text>
            </View>
          )}
        </Pressable>
      ))}
    </Animated.View>
  );
}

function EnhancedReplyBar({ replyTo, accentColor, onClose }: any) {
  const slideAnim = useRef(new Animated.Value(-50)).current;

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.enhancedReplyBar,
        { borderColor: accentColor + '40' },
        { transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={[styles.replyBarAccent, { backgroundColor: accentColor }]} />
      <View style={styles.replyBarContent}>
        <Text style={styles.replyBarLabel}>Replying to </Text>
        <Text style={[styles.replyBarName, { color: accentColor }]}>{replyTo.userName}</Text>
      </View>
      <Pressable onPress={onClose} style={[styles.replyBarClose, { backgroundColor: accentColor + '20' }]}>
        <Text style={styles.replyBarCloseText}>✕</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Chat mode picker data ───────────────────────────────────────────────────
// Single source of truth is `OPENSWAN_MODE_POLICIES` in openswanModePolicy.ts.
// The picker derives its entries so the mode list here can never drift from
// the policy table. Previously this was a hand-maintained array that missed
// the `build` mode entirely and had slightly different descriptions for
// every other mode.
const CHAT_MODE_CONFIG = getSelectableChatModes().map((policy) => ({
  key: policy.key,
  label: policy.key === 'none' ? 'Off' : policy.label,
  desc:  policy.description,
  icon:  policy.icon,
  color: policy.color,
}));

type ChatPickerModel = {
  id: string;
  label: string;
  desc: string;
  color: string;
  icon: string;
  group: string;
  tags?: string[];
  contextWindow?: number;
};

const POPULAR_OPENROUTER_MODELS: ChatPickerModel[] = [
  { id: 'openrouter/tencent/hy3-preview:free', label: 'Hy3 preview (free)', desc: '#1 OpenRouter weekly usage | tencent | 3.71T tokens | +168% weekly', color: '#f59e0b', icon: '1', group: 'popular', tags: ['text', 'free'] },
  { id: 'openrouter/moonshotai/kimi-k2.6', label: 'Kimi K2.6', desc: '#2 OpenRouter weekly usage | moonshotai | 1.79T tokens | -10% weekly', color: '#f59e0b', icon: '2', group: 'popular', tags: ['text', 'code'] },
  { id: 'openrouter/anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6', desc: '#3 OpenRouter weekly usage | anthropic | 1.36T tokens | -1% weekly', color: '#6366f1', icon: '3', group: 'popular', tags: ['code', 'text', 'web'] },
  { id: 'openrouter/google/gemini-3-flash-preview', label: 'Gemini 3 Flash Preview', desc: '#4 OpenRouter weekly usage | google | 992B tokens | -2% weekly', color: '#3b82f6', icon: '4', group: 'popular', tags: ['text', 'vision', 'web'] },
  { id: 'openrouter/anthropic/claude-opus-4.7', label: 'Claude Opus 4.7', desc: '#5 OpenRouter weekly usage | anthropic | 956B tokens | -16% weekly', color: '#a855f7', icon: '5', group: 'popular', tags: ['reason', 'code', 'text'] },
  { id: 'openrouter/deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', desc: '#6 OpenRouter weekly usage | deepseek | 870B tokens | +111% weekly', color: '#ef4444', icon: '6', group: 'popular', tags: ['speed', 'code'] },
  { id: 'openrouter/deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', desc: '#7 OpenRouter weekly usage | deepseek | 809B tokens | -29% weekly', color: '#ef4444', icon: '7', group: 'popular', tags: ['code', 'text'] },
  { id: 'openrouter/minimax/minimax-m2.7', label: 'MiniMax M2.7', desc: '#8 OpenRouter weekly usage | minimax | 745B tokens | -1% weekly', color: '#fb7185', icon: '8', group: 'popular', tags: ['text', 'long'] },
  { id: 'openrouter/deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', desc: '#10 OpenRouter weekly usage | deepseek | 652B tokens | +409% weekly', color: '#ef4444', icon: '10', group: 'popular', tags: ['reason', 'code'] },
  { id: 'openrouter/google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', desc: '#11 OpenRouter weekly usage | google | 645B tokens | +3% weekly', color: '#3b82f6', icon: '11', group: 'popular', tags: ['speed', 'vision'] },
  { id: 'openrouter/stepfun/step-3.5-flash', label: 'Step 3.5 Flash', desc: '#12 OpenRouter weekly usage | stepfun | 616B tokens | -27% weekly', color: '#22c55e', icon: '12', group: 'popular', tags: ['speed', 'text'] },
  { id: 'openrouter/google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', desc: '#13 OpenRouter weekly usage | google | 585B tokens | -4% weekly', color: '#3b82f6', icon: '13', group: 'popular', tags: ['speed', 'vision', 'web'] },
  { id: 'openrouter/nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super (free)', desc: '#14 OpenRouter weekly usage | nvidia | 528B tokens | -21% weekly', color: '#84cc16', icon: '14', group: 'popular', tags: ['text', 'free'] },
  { id: 'openrouter/inclusionai/ling-2.6-1t:free', label: 'Ling-2.6-1T (free)', desc: '#15 OpenRouter weekly usage | inclusionai | 470B tokens | -5% weekly', color: '#10b981', icon: '15', group: 'popular', tags: ['text', 'free'] },
  { id: 'openrouter/anthropic/claude-opus-4.6', label: 'Claude Opus 4.6', desc: '#16 OpenRouter weekly usage | anthropic | 429B tokens | -33% weekly', color: '#a855f7', icon: '16', group: 'popular', tags: ['reason', 'code', 'text'] },
  { id: 'openrouter/openai/gpt-oss-120b', label: 'gpt-oss-120b', desc: '#17 OpenRouter weekly usage | openai | 397B tokens | +10% weekly', color: '#10b981', icon: '17', group: 'popular', tags: ['open', 'text'] },
  { id: 'openrouter/z-ai/glm-5.1', label: 'GLM 5.1', desc: '#18 OpenRouter weekly usage | z-ai | 357B tokens | -7% weekly', color: '#22d3ee', icon: '18', group: 'popular', tags: ['reason', 'text'] },
  { id: 'openrouter/google/gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview', desc: '#19 OpenRouter weekly usage | google | 318B tokens | +11% weekly', color: '#3b82f6', icon: '19', group: 'popular', tags: ['speed', 'vision'] },
  { id: 'openrouter/google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', desc: '#20 OpenRouter weekly usage | google | 293B tokens | -17% weekly', color: '#3b82f6', icon: '20', group: 'popular', tags: ['reason', 'vision'] },
];

function colorForOpenRouterAuthor(author?: string): string {
  const colors: Record<string, string> = {
    anthropic: '#a855f7',
    deepseek: '#ef4444',
    google: '#3b82f6',
    inclusionai: '#10b981',
    minimax: '#fb7185',
    moonshotai: '#f59e0b',
    nvidia: '#84cc16',
    openai: '#10b981',
    stepfun: '#22c55e',
    tencent: '#f59e0b',
    'x-ai': '#22d3ee',
    'z-ai': '#22d3ee',
  };
  return colors[author || ''] || '#a78bfa';
}

function popularRankingToChatModel(model: {
  id: string;
  label: string;
  provider?: string;
  rank?: number;
  description?: string;
  contextWindow?: number;
}): ChatPickerModel {
  const rank = model.rank || 0;
  return {
    id: model.id,
    label: model.label,
    desc: model.description || (rank ? `#${rank} OpenRouter weekly usage` : 'OpenRouter popular model'),
    color: colorForOpenRouterAuthor(model.provider),
    icon: rank > 0 ? String(rank) : 'OR',
    group: 'popular',
    tags: model.id.endsWith(':free') ? ['text', 'free'] : ['text'],
    contextWindow: model.contextWindow,
  };
}

const OPENROUTER_RANKINGS_FAILURE_KEY = 'openswan:openrouter_rankings_failed_until';
const OPENROUTER_RANKINGS_FAILURE_COOLDOWN_MS = 60 * 60_000;

function shouldRefreshOpenRouterRankings(): boolean {
  try {
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    if (host === 'localhost' || host === '127.0.0.1') return false;
    const failedUntil = Number(localStorage.getItem(OPENROUTER_RANKINGS_FAILURE_KEY) || 0);
    return !Number.isFinite(failedUntil) || failedUntil <= Date.now();
  } catch {
    return false;
  }
}

function rememberOpenRouterRankingsFailure() {
  try {
    localStorage.setItem(OPENROUTER_RANKINGS_FAILURE_KEY, String(Date.now() + OPENROUTER_RANKINGS_FAILURE_COOLDOWN_MS));
  } catch {}
}

const CHAT_MODELS: ChatPickerModel[] = [
  // ── Auto ──
  // Routes by detected intent + complexity, then lets SwanBot/OpenSwan
  // activate tools, apps, and agents instead of bypassing the runtime.
  { id: 'auto', label: 'Auto', desc: 'Picks the best connected model, then activates OpenSwan/tools/agents for the task.', color: '#22c55e', icon: 'A', group: 'auto', tags: ['text', 'code', 'reason'] },
  // ── Coding & Engineering ──
  { id: 'gpt-5.5', label: 'GPT-5.5', desc: 'OpenAI frontier. Professional coding, reasoning, and agent work.', color: '#10b981', icon: '55', group: 'code', tags: ['code', 'text', 'web', 'reason'] },
  { id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', desc: 'Highest-compute GPT-5.5 for the hardest professional tasks.', color: '#059669', icon: '5P', group: 'code', tags: ['code', 'text', 'web', 'reason'] },
  { id: 'claude-fable-5', label: 'Fable 5', desc: 'Claude top tier for demanding long-horizon agent work.', color: '#7c3aed', icon: 'F', group: 'code', tags: ['code', 'text', 'web', 'reason'] },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', desc: 'Claude Opus tier for complex architecture and agentic coding.', color: '#a855f7', icon: 'O', group: 'code', tags: ['code', 'text', 'web', 'reason'] },
  { id: 'claude-opus-4-7', label: 'Opus 4.7', desc: 'Claude Opus fallback for complex architecture.', color: '#a855f7', icon: 'O7', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Fast coding. Great for iteration.', color: '#6366f1', icon: 'S', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', desc: 'OpenAI affordable flagship for code and professional work.', color: '#10b981', icon: '54', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', desc: 'Strong mini model for coding, computer use, and subagents.', color: '#10b981', icon: '5m', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'codex-mini', label: 'Codex Mini', desc: 'Built for code. Cheap + fast.', color: '#10a37f', icon: 'Cx', group: 'code', tags: ['code'] },
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', desc: 'MoE. Exceptional at code.', color: '#ef4444', icon: 'DS', group: 'code', tags: ['code', 'text'] },
  { id: 'qwen-3.5-coder', label: 'Qwen Coder', desc: 'Apache 2.0. Code specialist.', color: '#ec4899', icon: 'QC', group: 'code', tags: ['code'] },

  // ── Reasoning & Research ──
  { id: 'deepseek-r1', label: 'DeepSeek R1', desc: 'Chain-of-thought. Open source.', color: '#ef4444', icon: 'R1', group: 'reason', tags: ['reason', 'code'] },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', desc: 'Google stable frontier model for agentic and coding tasks.', color: '#3b82f6', icon: 'G5', group: 'reason', tags: ['reason', 'vision', 'web'] },
  { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', desc: 'Google preview. Advanced agentic and coding work.', color: '#3b82f6', icon: 'G3', group: 'reason', tags: ['reason', 'vision', 'web'] },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Google. Long context king.', color: '#3b82f6', icon: 'Gm', group: 'reason', tags: ['reason', 'vision', 'web'] },
  { id: 'sonar-deep-research', label: 'Sonar Deep Research', desc: 'Perplexity exhaustive web research with cited synthesis.', color: '#0ea5e9', icon: 'DR', group: 'reason', tags: ['reason', 'web', 'text'] },
  { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', desc: 'Perplexity search-grounded reasoning for structured answers.', color: '#0ea5e9', icon: 'SR', group: 'reason', tags: ['reason', 'web', 'text'] },

  // ── Speed & Cost ──
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Lightning fast. Cheapest Claude.', color: '#22d3ee', icon: 'H', group: 'speed', tags: ['text', 'code', 'web'] },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', desc: 'Google stable low-cost frontier-class speed.', color: '#3b82f6', icon: 'G1', group: 'speed', tags: ['text', 'code', 'vision', 'web'] },
  { id: 'gemini-2.5-flash', label: 'Gemini Flash', desc: 'Google. Fastest + free tier.', color: '#3b82f6', icon: 'Gf', group: 'speed', tags: ['text', 'code', 'vision', 'web'] },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini Flash-Lite', desc: 'Fastest budget model in the Gemini 2.5 family.', color: '#3b82f6', icon: 'Gl', group: 'speed', tags: ['text', 'code', 'vision', 'web'] },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', desc: 'OpenAI cheapest GPT-5.4 class model for high-volume simple work.', color: '#10b981', icon: '5n', group: 'speed', tags: ['text', 'code'] },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', desc: 'OpenAI cheapest. Edge tasks.', color: '#10b981', icon: 'Gn', group: 'speed', tags: ['text', 'code'] },
  { id: 'qwen-3.5-flash', label: 'Qwen Flash', desc: 'Fast. Free tier on Alibaba.', color: '#ec4899', icon: 'Qf', group: 'speed', tags: ['text', 'code'] },

  // ── Creative & Multimodal ──
  { id: 'gpt-4o', label: 'GPT-4o', desc: 'Multimodal. Images + audio + text.', color: '#10b981', icon: '4o', group: 'creative', tags: ['images', 'vision', 'text', 'web'] },
  { id: 'gemini-2.5-flash-preview', label: 'Gemini Flash Preview', desc: 'Image gen + understanding.', color: '#3b82f6', icon: 'Gp', group: 'creative', tags: ['images', 'vision', 'text', 'web'] },
  { id: 'flux-schnell', label: 'Flux Schnell', desc: 'Fast open image generation.', color: '#84cc16', icon: 'Fx', group: 'creative', tags: ['images'] },
  { id: 'flux-dev', label: 'Flux Dev', desc: 'Higher-quality image generation.', color: '#84cc16', icon: 'Fd', group: 'creative', tags: ['images'] },
  { id: 'stable-diffusion-xl', label: 'Stable Diffusion XL', desc: 'Classic open image model.', color: '#84cc16', icon: 'SD', group: 'creative', tags: ['images'] },

  // ── Open Source ──
  { id: 'llama-4-scout', label: 'Llama 4 Scout', desc: '10M context. 109B MoE.', color: '#f59e0b', icon: 'L4', group: 'open', tags: ['text', 'code'] },
  { id: 'llama-4-maverick', label: 'Llama 4 Maverick', desc: '400B MoE. Top open model.', color: '#f59e0b', icon: 'Lm', group: 'open', tags: ['text', 'code', 'reason'] },
  { id: 'qwen-3.5-plus', label: 'Qwen 3.5 Plus', desc: 'Apache 2.0. 1M context.', color: '#ec4899', icon: 'Q+', group: 'open', tags: ['text', 'code'] },
  { id: 'mistral-large-3', label: 'Mistral Large 3', desc: 'EU. 128K context.', color: '#ff6b35', icon: 'ML', group: 'open', tags: ['text', 'code'] },
  { id: 'deepseek-v3', label: 'DeepSeek V3', desc: '671B MoE. Open weights.', color: '#ef4444', icon: 'D3', group: 'open', tags: ['text', 'code'] },
  { id: 'glm-5', label: 'GLM-5', desc: 'z.ai flagship. Strong reasoning + thinking mode.', color: '#22d3ee', icon: 'G5', group: 'open', tags: ['text', 'code', 'reason'] },
  { id: 'MiniMax-M1', label: 'MiniMax M1', desc: 'MiniMax flagship. 1M context.', color: '#fb7185', icon: 'Mx', group: 'open', tags: ['text', 'code', 'reason'] },
];

const MODEL_GROUPS: { key: string; label: string; color: string }[] = [
  { key: 'popular', label: 'Most Popular Models', color: '#f59e0b' },
  { key: 'code', label: 'Coding & Engineering', color: '#8b5cf6' },
  { key: 'reason', label: 'Reasoning & Research', color: '#ef4444' },
  { key: 'speed', label: 'Speed & Cost', color: '#06b6d4' },
  { key: 'creative', label: 'Creative & Multimodal', color: '#10b981' },
  { key: 'open', label: 'Open Source', color: '#84cc16' },
];

const MODEL_SECTION_ACCENTS: Record<string, string> = {
  'action:auto': '#22c55e',
  'base:popular': '#f59e0b',
  'base:code': '#8b5cf6',
  'base:reason': '#ef4444',
  'base:speed': '#06b6d4',
  'base:creative': '#10b981',
  'base:open': '#84cc16',
  'provider:anthropic': '#d97706',
  'provider:openai': '#10a37f',
  'provider:openai_compatible': '#14b8a6',
  'provider:openrouter': '#a78bfa',
  'provider:blackswan': '#f8fafc',
  'provider:hugging_face': '#ffbd45',
  'provider:huggingface': '#ffbd45',
  'provider:replicate': '#38bdf8',
  'provider:groq': '#f97316',
  'provider:google_ai': '#4285f4',
  'provider:mistral_ai': '#fa520f',
  'provider:cohere': '#2dd4bf',
  'provider:perplexity': '#1fb8cd',
  'provider:together_ai': '#0f6fff',
  'provider:fireworks_ai': '#5b36bd',
  'provider:deepseek': '#1a6fe0',
  'provider:z_ai': '#0ea5e9',
  'provider:minimax': '#ec4899',
  'provider:ollama': '#5b21b6',
  'custom:hf-hub': '#fb923c',
  'action:add-hf-hub': '#f97316',
};

const MODEL_SECTION_FALLBACK_COLORS = [
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#10b981',
  '#84cc16',
  '#d97706',
  '#14b8a6',
  '#38bdf8',
  '#f97316',
  '#a78bfa',
  '#ec4899',
  '#0ea5e9',
];

function modelSectionAccent(sectionKey: string, fallback = '#22d3ee'): string {
  const explicit = MODEL_SECTION_ACCENTS[sectionKey];
  if (explicit) return explicit;
  let hash = 0;
  for (let i = 0; i < sectionKey.length; i += 1) {
    hash = (hash * 31 + sectionKey.charCodeAt(i)) >>> 0;
  }
  return MODEL_SECTION_FALLBACK_COLORS[hash % MODEL_SECTION_FALLBACK_COLORS.length] || fallback;
}

const MODEL_ROUTE_PREFIXES = new Set([
  'anthropic',
  'openai',
  'openai_compatible',
  'openrouter',
  'google',
  'google_ai',
  'groq',
  'mistral_ai',
  'cohere',
  'perplexity',
  'together_ai',
  'fireworks_ai',
  'deepseek',
  'z_ai',
  'zai',
  'minimax',
  'huggingface',
  'hugging_face',
  'huggingface_endpoint',
  'ollama',
  'replicate',
  'accounts',
  'models',
]);

const MODEL_AUTHOR_SEGMENTS = new Set([
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'moonshotai',
  'tencent',
  'minimax',
  'x-ai',
  'nvidia',
  'inclusionai',
  'stepfun',
  'z-ai',
  'qwen',
  'meta-llama',
  'mistralai',
  'fireworks',
  'cswan801',
]);

function modelDisplayToken(token: string): string {
  const lower = token.toLowerCase();
  const brandMap: Record<string, string> = {
    ai: 'AI',
    api: 'API',
    bm: 'BM',
    claude: 'Claude',
    codex: 'Codex',
    deepseek: 'DeepSeek',
    flash: 'Flash',
    gemini: 'Gemini',
    glm: 'GLM',
    gpt: 'GPT',
    grok: 'Grok',
    haiku: 'Haiku',
    kimi: 'Kimi',
    llama: 'Llama',
    minimax: 'MiniMax',
    mistral: 'Mistral',
    nemotron: 'Nemotron',
    opus: 'Opus',
    oss: 'OSS',
    qwen: 'Qwen',
    sonar: 'Sonar',
    sonnet: 'Sonnet',
    v: 'V',
  };
  if (brandMap[lower]) return brandMap[lower];
  if (/^gpt$/i.test(token)) return 'GPT';
  if (/^o\d+$/i.test(token)) return token.toUpperCase();
  if (/^\d+[a-z]+$/i.test(token)) return token.toUpperCase();
  if (/^[a-z]+[0-9.]+[a-z0-9.]*$/i.test(token)) {
    return token.charAt(0).toUpperCase() + token.slice(1);
  }
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function compactVersionTokens(tokens: string[]): string[] {
  const compacted: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    if (/^\d+$/.test(current) && /^\d+$/.test(tokens[i + 1] || '')) {
      compacted.push(`${current}.${tokens[i + 1]}`);
      i += 1;
    } else {
      compacted.push(current);
    }
  }
  return compacted;
}

function autoModelDisplayName(modelId?: string | null): string | null {
  if (!modelId) return null;
  const withoutQuery = modelId.split(/[?#]/, 1)[0];
  const parts = withoutQuery
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  let modelPart = parts[parts.length - 1] || withoutQuery;
  if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const part = parts[i];
      const normalized = part.toLowerCase();
      if (!MODEL_ROUTE_PREFIXES.has(normalized) && !MODEL_AUTHOR_SEGMENTS.has(normalized)) {
        modelPart = part;
        break;
      }
    }
  }
  const cleaned = modelPart
    .replace(/:[a-z0-9_-]+$/i, '')
    .replace(/\b(20\d{6}|20\d{4})\b/g, '')
    .replace(/[_:.]+/g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .trim();
  const rawTokens = cleaned
    .split(/[-\s]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => !MODEL_ROUTE_PREFIXES.has(token.toLowerCase()) && !MODEL_AUTHOR_SEGMENTS.has(token.toLowerCase()));
  const tokens = compactVersionTokens(rawTokens);
  const label = tokens.map(modelDisplayToken).join(' ').replace(/\s+/g, ' ').trim();
  return label || modelDisplayToken(cleaned || modelId);
}

function modelSectionHoverStyle(color: string, hovered: boolean) {
  if (!hovered) return null;
  return {
    borderColor: color + 'aa',
    backgroundColor: color + '18',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: `0 0 0 1px ${color}44, 0 12px 30px ${color}22, 0 16px 34px rgba(0,0,0,0.46)`,
          transform: 'translateY(-1px)',
        } as any
      : {}),
  };
}

function modelSectionTransitionStyle() {
  return Platform.OS === 'web'
    ? [{ cursor: 'pointer', transition: 'all 0.16s ease' } as any]
    : [];
}

// ── Quick Actions animated header ───────────────────────────────────────────
// Dots pulse on hover like loading indicators. Title letters cycle through
// the dot colors so the whole header comes alive on mouseover.

const QA_DOT_COLORS = ['#22d3ee', '#facc15', '#22c55e', '#ef4444', '#a855f7', '#f97316'];
const QA_TITLE = 'Quick Actions';
const toTitleCaseWords = (value: string) =>
  value
    .toLowerCase()
    .split(/[\s_]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

// Formations: circle → triangle → square → DNA helix → circle
const S = 26;
const C = S / 2; // center
const QA_CIRCLE_POINTS = [
  { x: 8, y: 6.8 },
  { x: 16.5, y: 6 },
  { x: 19.2, y: C },
  { x: 16.5, y: 16.8 },
  { x: 8.6, y: 16.3 },
  { x: 5.6, y: 8.2 },
];
// Five distinct formations. The keyframe builder below emits an
// explicit `100% { formation[0] }` frame that closes the loop with a
// dna2 → circle morph, so there is no need for a duplicate "return"
// formation — that used to produce a dead 16.7% hold at the end of
// every cycle (dots arrived at circle early, then sat still until the
// loop restarted, which read as a hitch before the loop).
const qaFormations: Array<{ name: string; pos: Array<{ x: number; y: number }> }> = [
  // Circle
  { name: 'circle', pos: QA_CIRCLE_POINTS },
  // Triangle — 3 vertices + 3 inset points
  { name: 'triangle', pos: [
    { x: C, y: 2.1 },
    { x: S - 2.8, y: S - 3.7 },
    { x: 2.8, y: S - 3.7 },
    { x: C + 3.1, y: 6.4 },
    { x: S - 5.9, y: S - 6.9 },
    { x: 5.9, y: S - 6.9 },
  ]},
  // Square — corners + vertical edge centers
  { name: 'square', pos: [
    { x: 2.6, y: 2.6 }, { x: S - 2.6, y: 2.6 },
    { x: S - 2.6, y: S - 2.6 }, { x: 2.6, y: S - 2.6 },
    { x: C, y: 2.1 }, { x: C, y: S - 2.1 },
  ]},
  // DNA helix — compact double-wave
  { name: 'dna1', pos: [
    { x: 2.5, y: 5.1 },
    { x: 5.3, y: 14.4 },
    { x: 7.8, y: 6.3 },
    { x: 10.1, y: 14.9 },
    { x: 12.6, y: 5.9 },
    { x: 15.1, y: 14.1 },
  ]},
  { name: 'dna2', pos: [
    { x: 2.5, y: 14.1 },
    { x: 5.3, y: 6.3 },
    { x: 7.8, y: 14.1 },
    { x: 10.1, y: 5.9 },
    { x: 12.6, y: 14.9 },
    { x: 15.1, y: 6.6 },
  ]},
];

function ensureQuickActionStyles() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('uc-qa-header-style') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'uc-qa-header-style';
    document.head.appendChild(el);
  }

  // Build a per-dot keyframe that morphs through all formations.
  // Each formation holds for ~14% of the cycle then transitions to the next.
  const totalFormations = qaFormations.length;
  const holdPct = 100 / totalFormations;
  let dotKeyframes = '';
  for (let d = 0; d < QA_DOT_COLORS.length; d++) {
    let kf = `@keyframes uc-qa-morph-${d} {\n`;
    for (let f = 0; f < totalFormations; f++) {
      const startPct = (f * holdPct).toFixed(1);
      const { x, y } = qaFormations[f].pos[d];
      kf += `  ${startPct}% { left: ${x.toFixed(1)}px; top: ${y.toFixed(1)}px; }\n`;
    }
    kf += `  100% { left: ${qaFormations[0].pos[d].x.toFixed(1)}px; top: ${qaFormations[0].pos[d].y.toFixed(1)}px; }\n`;
    kf += '}\n';
    dotKeyframes += kf;
  }

  el.textContent = `
${dotKeyframes}
@keyframes uc-qa-glow { 0%,100% { opacity:.68; transform:scale(1); } 50% { opacity:1; transform:scale(1.16); } }
@keyframes uc-qa-char-shimmer { 0%,100% { opacity:.82; } 50% { opacity:1; filter:brightness(1.18); } }
/* Shape pulse aligned to the 5-formation morph beats (20% each), so
 * every shape change lands on a formation change and the final
 * tall-oval → circle morph gets the full 80% → 100% window instead
 * of snapping in the last 7%. */
@keyframes uc-qa-shape {
  0% {
    width: 3px; height: 3px;
    border-radius: 999px;
    transform: rotate(0deg);
  }
  20% {
    width: 3px; height: 3px;
    border-radius: 999px;
    transform: rotate(0deg);
  }
  40% {
    width: 3px; height: 3px;
    border-radius: 1px;
    transform: rotate(45deg);
  }
  60% {
    width: 3px; height: 3px;
    border-radius: 1px;
    transform: rotate(0deg);
  }
  80% {
    width: 2px; height: 4.2px;
    border-radius: 999px;
    transform: rotate(24deg);
  }
  100% {
    width: 3px; height: 3px;
    border-radius: 999px;
    transform: rotate(0deg);
  }
}
.uc-qa-morph-dot { position:absolute; border-radius:50%; }
.uc-qa-char { animation: uc-qa-char-shimmer 2s ease-in-out infinite; display:inline-block; }
.uc-actions-sysfont [class*="r-fontFamily"] { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important; }
.uc-actions-sysfont { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important; }
.uc-actions-sysfont div, .uc-actions-sysfont span { font-family: inherit !important; }
.uc-actions-sysfont .uc-qa-char { font-family: inherit !important; }`;
}

function QuickActionsHeader({ expanded, isHovered, onPress, onHoverIn, onHoverOut }: {
  expanded: boolean; isHovered: boolean;
  onPress: () => void; onHoverIn: () => void; onHoverOut: () => void;
}) {
  React.useEffect(() => { if (Platform.OS === 'web') ensureQuickActionStyles(); }, []);

  const dotSize = 3;
  const cycleDuration = 5.5;
  const activeColor = 'rgb(245, 158, 11)';

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      style={[
        styles.actionsAccordionHeader,
        { paddingVertical: 9 },
        Platform.OS === 'web' && { transition: 'all 0.25s ease' } as any,
        isHovered && { backgroundColor: '#0f172a' } as any,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: S, height: S, position: 'relative' as any }}>
          {QA_DOT_COLORS.map((c, i) => (
            <View
              key={i}
              {...({ className: 'uc-qa-morph-dot', style: Platform.OS === 'web' ? {
                width: dotSize,
                height: dotSize,
                backgroundColor: c,
                left: qaFormations[0].pos[i].x,
                top: qaFormations[0].pos[i].y,
                marginLeft: -(dotSize / 2),
                marginTop: -(dotSize / 2),
                boxShadow: isHovered ? `0 0 4px ${c}66, 0 0 1px ${c}44` : 'none',
                transition: 'box-shadow 0.18s ease, opacity 0.18s ease',
                opacity: isHovered ? 1 : 0.92,
                animation: `uc-qa-morph-${i} ${cycleDuration}s ease-in-out infinite, uc-qa-glow 1.6s ease-in-out infinite, uc-qa-shape ${cycleDuration}s ease-in-out infinite`,
                animationDelay: `0s, ${i * 0.2}s, 0s`,
              } : {
                width: dotSize,
                height: dotSize,
                backgroundColor: c,
                left: qaFormations[0].pos[i].x,
                top: qaFormations[0].pos[i].y,
                marginLeft: -(dotSize / 2),
                marginTop: -(dotSize / 2),
              }} as any)}
            />
          ))}
        </View>

        <Text style={[styles.actionsAccordionTitle, { color: isHovered ? activeColor : '#e2e8f0' }]}>
          {QA_TITLE}
        </Text>
      </View>
      <Text style={[styles.actionsAccordionChevron, isHovered && { fontSize: 13 } as any]}>{expanded ? '▾' : '▸'}</Text>
    </Pressable>
  );
}

const CONTROL_PANEL_LAUNCHERS = [
  {
    label: 'Browser',
    desc: 'Websites, forms, admin pages',
    seed: 'Use the browser to ',
    color: '#22d3ee',
  },
  {
    label: 'Computer',
    desc: 'Desktop apps and windows',
    seed: 'Use my computer to ',
    color: '#a78bfa',
  },
  {
    label: 'Login',
    desc: 'Saved credentials and vault',
    seed: 'Use the saved login for this website and ',
    color: '#22c55e',
  },
  {
    label: 'Repeat',
    desc: 'Save as automation flow',
    seed: 'Turn this into a repeatable automation: ',
    color: '#f59e0b',
  },
];

function normalizeConnectedProviderKey(provider: string): string {
  if (provider === 'hugging_face') return 'huggingface';
  if (provider === 'z_ai') return 'zai';
  return provider;
}

function modelPickerProviderColor(provider?: string, connected = true): string {
  if (!connected) return '#475569';
  if (provider === 'anthropic') return '#d97706';     // Anthropic amber
  if (provider === 'openai') return '#10a37f';        // OpenAI teal
  if (provider === 'openrouter') return '#a78bfa';    // OpenRouter purple
  if (provider === 'blackswan') return '#22d3ee';     // BlackSwan cyan
  if (provider === 'openai_compatible') return '#14b8a6';
  if (provider === 'hugging_face' || provider === 'huggingface') return '#f59e0b';
  if (provider === 'replicate') return '#38bdf8';
  if (provider === 'groq') return '#f97316';
  if (provider === 'google_ai') return '#4285f4';
  if (provider === 'mistral_ai') return '#fa520f';
  if (provider === 'cohere') return '#39594d';
  if (provider === 'perplexity') return '#1fb8cd';
  if (provider === 'together_ai') return '#0f6fff';
  if (provider === 'fireworks_ai') return '#5b36bd';
  if (provider === 'deepseek') return '#1a6fe0';
  if (provider === 'z_ai') return '#0ea5e9';
  if (provider === 'minimax') return '#ec4899';
  if (provider === 'ollama') return '#5b21b6';
  return '#22d3ee';
}

function modelPickerProviderIcon(provider?: string): string {
  if (provider === 'anthropic') return 'A';
  if (provider === 'openai') return 'O';
  if (provider === 'openrouter') return 'OR';
  if (provider === 'blackswan') return '🦢';
  if (provider === 'openai_compatible') return 'BM';
  if (provider === 'hugging_face' || provider === 'huggingface') return 'HF';
  if (provider === 'replicate') return 'R';
  if (provider === 'groq') return 'GQ';
  if (provider === 'google_ai') return 'G';
  if (provider === 'mistral_ai') return 'MS';
  if (provider === 'cohere') return 'CH';
  if (provider === 'perplexity') return 'PX';
  if (provider === 'together_ai') return 'TG';
  if (provider === 'fireworks_ai') return 'FW';
  if (provider === 'deepseek') return 'DS';
  if (provider === 'z_ai') return 'Z';
  if (provider === 'minimax') return 'MX';
  if (provider === 'ollama') return 'OL';
  return 'AI';
}

function modelBrowserKeyForMarketplaceGroup(group: ModelGroup): string {
  const provider = String(group.provider || 'provider');
  const label = String(group.label || provider)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `marketplace:${provider}:${label || 'models'}`;
}

function formatContextWindow(contextWindow?: number): string | null {
  if (!contextWindow || contextWindow <= 0) return null;
  if (contextWindow >= 1_000_000) return `${(contextWindow / 1_000_000).toFixed(1)}M ctx`;
  if (contextWindow >= 1_000) return `${Math.round(contextWindow / 1_000)}K ctx`;
  return `${contextWindow} ctx`;
}

type ModelBrowserItem = {
  id: string;
  label: string;
  description?: string;
  contextWindow?: number;
  ready?: boolean;
  provider?: string;
  color?: string;
  icon?: string;
};

type ModelBrowserSection = {
  key: string;
  label: string;
  color: string;
  icon: string;
  connected?: boolean;
  hint?: string;
  models: ModelBrowserItem[];
  sourceLabel?: string;
};

function ModelSectionBrowserPanel({
  section,
  selectedModel,
  onSelect,
  onClose,
}: {
  section: ModelBrowserSection | null;
  selectedModel: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const models = section?.models || [];
  const connected = section?.connected !== false;
  const accent = section?.color || '#a78bfa';
  const icon = section?.icon || 'AI';
  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) => {
      return model.label.toLowerCase().includes(needle)
        || model.id.toLowerCase().includes(needle)
        || (model.description || '').toLowerCase().includes(needle);
    });
  }, [models, query]);

  return (
    <View style={styles.providerBrowserPanel} nativeID="section-model-browser">
      <View style={styles.providerBrowserHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.providerBrowserTitle, { color: accent }]}>{section?.label || 'Models'}</Text>
          <Text style={styles.providerBrowserSubtitle}>
            {models.length > 0
              ? connected
                ? `${models.length} models available${section?.sourceLabel ? ` from ${section.sourceLabel}` : ''}`
                : `${models.length} preview models. Connect this provider to run them.`
              : 'No models loaded for this section yet'}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          style={[styles.providerBrowserClose, ...(Platform.OS === 'web' ? [{ cursor: 'pointer' } as any] : [])]}
        >
          <Text style={styles.providerBrowserCloseText}>X</Text>
        </Pressable>
      </View>

      {!connected ? (
        <View style={styles.providerBrowserNotice}>
          <Text style={styles.providerBrowserNoticeText}>
            API key required to run these models.
          </Text>
        </View>
      ) : null}

      <View style={styles.providerBrowserSearchRow}>
        <Text style={[styles.providerBrowserSearchIcon, { color: accent }]}>{'>'}</Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${section?.label || 'models'}...`}
          placeholderTextColor="#475569"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.providerBrowserSearchInput}
        />
      </View>

      <ScrollView style={styles.providerBrowserList} nestedScrollEnabled showsVerticalScrollIndicator>
        {filteredModels.length === 0 ? (
          <Text style={styles.providerBrowserEmpty}>No models match that search.</Text>
        ) : null}
        {filteredModels.map((model: ModelBrowserItem) => {
          const isActive = model.id === selectedModel;
          const contextLabel = formatContextWindow(model.contextWindow);
          const ready = model.ready !== false;
          const rowAccent = model.color || accent;
          return (
            <Pressable
              key={model.id}
              onPress={() => {
                if (!ready) return;
                onSelect(model.id);
              }}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityLabel={`Select ${model.label}`}
              style={[
                styles.providerBrowserModelRow,
                isActive && { borderColor: rowAccent + '80', backgroundColor: rowAccent + '14' },
                !ready && { opacity: 0.42 },
                ...(Platform.OS === 'web' ? [{ cursor: ready ? 'pointer' : 'not-allowed', transition: 'all 0.15s ease' } as any] : []),
              ]}
            >
              <View style={[styles.providerBrowserModelIcon, { backgroundColor: rowAccent + '20' }]}>
                <Text style={[styles.providerBrowserModelIconText, { color: rowAccent }]}>{model.icon || icon}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.providerBrowserModelName, isActive && { color: rowAccent }]} numberOfLines={1}>
                  {model.label}
                </Text>
                <Text style={styles.providerBrowserModelMeta} numberOfLines={1}>
                  {[model.description, contextLabel, model.id.replace(/^[^/]+\//, '')].filter(Boolean).join(' | ')}
                </Text>
              </View>
              {isActive ? <View style={[styles.dropdownActiveDot, { backgroundColor: rowAccent }]} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function EnhancedInput({
  circleId: composerCircleId,
  input,
  onInputChange,
  onSend,
  onFocusBot,
  inputRef,
  accentColor,
  selectedModel,
  onModelChange,
  marketplaceModelGroups: marketplaceModelGroupsProp,
  onQuickAction,
  attachments,
  hasStagedFiles,
  onPickImage,
  onRemoveAttachment,
  chatMode,
  onModeChange,
  chatAgentTargets = [],
  selectedChatAgentTarget,
  onSelectChatAgent,
  onOpenAgentSetup,
  agentName,
  agentAvatarSource,
  sessionProfile,
  activePlugins,
  onOpenPlugins,
  onOpenMemory,
  hasBuilderWork,
  showWorkbenchSidecar,
  onToggleBuilder,
  onResetMind,
  onOpenControlPanel,
  onLocalBotMessage,
  openswanSessionCount,
  memoryCount,
  builderRevisionCount,
  runStatus,
  currentRunStep,
  webSearchEnabled,
  onToggleWebSearch,
}: any) {
  const [focused, setFocused] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showControlAdvanced, setShowControlAdvanced] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [activeModelBrowserKey, setActiveModelBrowserKey] = useState<string | null>(null);
  const [customModels, setCustomModels] = useState<any[]>([]);
  const [popularModels, setPopularModels] = useState<ChatPickerModel[]>(POPULAR_OPENROUTER_MODELS);
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const [hoveredAction, setHoveredAction] = useState<number | null>(null);
  const [expandedActionSections, setExpandedActionSections] = useState<Record<string, boolean>>({
    soul: false,
    quick: false,
    tools: false,
    missions: false,
    ai: false,
    wordpress: false,
    games: false,
    challenges: false,
    productivity: false,
    stats: false,
    crypto: false,
    connect: false,
    governance: false,
    motivation: false,
  });
  const [highlightedSlashIndex, setHighlightedSlashIndex] = useState(0);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popularRankingsLoadedRef = useRef(false);

  // Load custom models on mount
  React.useEffect(() => {
    import('../../../lib/customModels').then(({ loadCustomModels, customModelToChatModel }) => {
      loadCustomModels().then(models => {
        setCustomModels(models.map(customModelToChatModel));
      });
    }).catch(() => {});
  }, []);

  React.useEffect(() => {
    if (!showModelPicker || popularRankingsLoadedRef.current) return;
    popularRankingsLoadedRef.current = true;
    if (!shouldRefreshOpenRouterRankings()) return;
    let cancelled = false;

    supabase.functions.invoke('openrouter-rankings', { body: { limit: 20 } })
      .then(({ data, error }) => {
        if (error) throw error;
        const rankedModels = Array.isArray((data as any)?.models) ? (data as any).models : [];
        if (!cancelled && rankedModels.length > 0) {
          setPopularModels(rankedModels.map(popularRankingToChatModel));
        }
      })
      .catch((error) => {
        rememberOpenRouterRankingsFailure();
        console.debug?.('[ChatTab] OpenRouter popular ranking refresh failed; using seeded list.', error);
      });

    return () => {
      cancelled = true;
    };
  }, [showModelPicker]);

  // Marketplace catalog comes from the parent (ChatTab) so the picker
  // here and the send-time auto-resolution in the parent agree on
  // which providers are connected.
  const marketplaceModelGroups: ModelGroup[] = marketplaceModelGroupsProp || [];
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (input.trim()) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.1, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [input]);

  const slashCommands = useMemo(() => getMatchingChatSlashCommands(input), [input]);
  const slashToken = input.trimStart().split(/\s+/, 1)[0] || '';
  const showSlashCommands = focused && /^\/[^\s]*$/.test(slashToken) && slashCommands.length > 0;
  const canSend = Boolean(input.trim() || (attachments && attachments.length > 0) || hasStagedFiles);
  // Keep deterministic command parsing available, but do not surface the
  // predictive chip panel in the main chat composer.
  const predictiveCommands = useMemo<PredictiveChatCommand[]>(() => [], []);
  const showPredictiveCommands = false;
  const openControlPanelWith = useCallback((seed = '') => {
    const draft = String(input || '').trim();
    const task = seed
      ? `${seed}${draft}`.trim()
      : draft;
    onOpenControlPanel?.(task);
    setShowModePicker(false);
  }, [input, onOpenControlPanel]);

  useEffect(() => {
    setHighlightedSlashIndex(0);
  }, [slashToken, slashCommands.length]);

  useEffect(() => {
    if (!showModePicker) setShowControlAdvanced(false);
  }, [showModePicker]);

  const applySlashCommand = useCallback((command: ChatSlashCommand) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    onInputChange(command.insertText);
    setHighlightedSlashIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef, onInputChange]);

  const applyPredictiveCommand = useCallback((command: PredictiveChatCommand) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    onInputChange(command.text);
    setShowQuickActions(false);
    setShowModelPicker(false);
    setShowModePicker(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputRef, onInputChange]);

  const handleKeyPress = useCallback((e: any) => {
    if (Platform.OS === 'web' && showSlashCommands) {
      if (e.nativeEvent?.key === 'ArrowDown') {
        e.preventDefault?.();
        setHighlightedSlashIndex((prev: number) => (prev + 1) % slashCommands.length);
        return;
      }
      if (e.nativeEvent?.key === 'ArrowUp') {
        e.preventDefault?.();
        setHighlightedSlashIndex((prev: number) => (prev - 1 + slashCommands.length) % slashCommands.length);
        return;
      }
      if ((e.nativeEvent?.key === 'Enter' || e.nativeEvent?.key === 'Tab') && !e.nativeEvent?.shiftKey) {
        e.preventDefault?.();
        const selected = slashCommands[highlightedSlashIndex] || slashCommands[0];
        if (selected) applySlashCommand(selected);
        return;
      }
    }
    // Tab toggles OpenSwan mode between `plan` (read-only by the
    // dispatcher gate) and `execute` (act). Only fires when the slash
    // palette is closed and the input is empty so it doesn't steal Tab
    // from completion flows.
    if (
      Platform.OS === 'web' &&
      e.nativeEvent?.key === 'Tab' &&
      !e.nativeEvent?.shiftKey &&
      !showSlashCommands &&
      !input.trim() &&
      onModeChange
    ) {
      e.preventDefault?.();
      onModeChange(chatMode === 'plan' ? 'execute' : 'plan');
      return;
    }
    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      if (canSend) onSend();
    }
  }, [applySlashCommand, highlightedSlashIndex, input, onSend, showSlashCommands, slashCommands, chatMode, onModeChange, canSend]);

  const allModels = [...CHAT_MODELS, ...popularModels, ...customModels];
  const marketplaceModelOptions = useMemo(() => {
    return marketplaceModelGroups.flatMap((group) =>
      group.models.map((model) => ({
        ...model,
        groupLabel: group.label,
        groupConnected: group.connected,
      })),
    );
  }, [marketplaceModelGroups]);
  const selectedMarketplaceModel = marketplaceModelOptions.find((model) => model.id === selectedModel);
  const currentModel = allModels.find(m => m.id === selectedModel) || (selectedMarketplaceModel ? {
    id: selectedMarketplaceModel.id,
    label: selectedMarketplaceModel.label,
    desc: selectedMarketplaceModel.description || selectedMarketplaceModel.groupLabel,
    group: 'marketplace',
    icon: modelPickerProviderIcon(selectedMarketplaceModel.provider),
    color: modelPickerProviderColor(selectedMarketplaceModel.provider, selectedMarketplaceModel.groupConnected),
  } : CHAT_MODELS[0]);
  const browseableBaseModelSections: ModelBrowserSection[] = useMemo(() => {
    return MODEL_GROUPS.map((group) => {
      const sectionColor = modelSectionAccent(`base:${group.key}`, group.color);
      const groupModels = group.key === 'popular'
        ? popularModels
        : CHAT_MODELS.filter((model: ChatPickerModel) => model.group === group.key);
      return {
        key: `base:${group.key}`,
        label: group.label,
        color: sectionColor,
        icon: group.label.slice(0, 2).replace(/\s/g, '') || 'M',
        connected: true,
        sourceLabel: group.key === 'popular' ? 'live OpenRouter weekly rankings' : 'built-in model shortlist',
        models: groupModels
          .map((model: ChatPickerModel) => ({
            id: model.id,
            label: model.label,
            description: model.desc,
            ready: true,
            color: model.color,
            icon: model.icon,
            contextWindow: model.contextWindow,
          })),
      };
    });
  }, [popularModels]);
  const marketplaceModelBrowserSections: ModelBrowserSection[] = useMemo(() => {
    return marketplaceModelGroups
      .map((group) => {
        const provider = group.provider as string;
        const color = modelSectionAccent(
          `provider:${provider}`,
          modelPickerProviderColor(provider, group.connected),
        );
        return {
          key: modelBrowserKeyForMarketplaceGroup(group),
          label: group.label,
          color,
          icon: modelPickerProviderIcon(provider),
          connected: group.connected,
          sourceLabel: provider === 'openrouter' && group.connected ? 'the live OpenRouter catalog' : 'Marketplace Models',
          models: group.models.map((model) => ({
            id: model.id,
            label: model.label,
            description: model.description,
            contextWindow: model.contextWindow,
            ready: model.ready,
            provider: model.provider,
            color,
            icon: modelPickerProviderIcon(provider),
          })),
        };
      });
  }, [marketplaceModelGroups]);
  const customModelBrowserSections: ModelBrowserSection[] = useMemo(() => {
    if (customModels.length === 0) return [];
    return [{
      key: 'custom:hf-hub',
      label: 'Custom HF Hub Models',
      color: modelSectionAccent('custom:hf-hub', '#f59e0b'),
      icon: 'HF',
      connected: true,
      sourceLabel: 'your saved Hugging Face Hub models',
      models: customModels.map((model: ChatPickerModel) => ({
        id: model.id,
        label: model.label,
        description: model.desc,
        ready: true,
        color: model.color || '#f59e0b',
        icon: model.icon || 'HF',
        contextWindow: model.contextWindow,
      })),
    }];
  }, [customModels]);
  const modelBrowserSections = useMemo(() => {
    return [...browseableBaseModelSections, ...marketplaceModelBrowserSections, ...customModelBrowserSections];
  }, [browseableBaseModelSections, marketplaceModelBrowserSections, customModelBrowserSections]);
  const activeModelBrowserSection = activeModelBrowserKey
    ? modelBrowserSections.find((section) => section.key === activeModelBrowserKey) || null
    : null;
  const huggingFaceMarketplaceGroup = marketplaceModelGroups.find((group) => group.provider === 'hugging_face');
  const autoModelOption = CHAT_MODELS.find((model) => model.id === 'auto');
  const popularBuiltInModelGroup = MODEL_GROUPS.find((group) => group.key === 'popular');
  const secondaryBuiltInModelGroups = MODEL_GROUPS.filter((group) => group.key !== 'popular');
  const visibleMarketplaceModelGroups = useMemo(() => {
    return [...marketplaceModelGroups]
      .sort((a, b) => {
        if (a.connected !== b.connected) return a.connected ? -1 : 1;
        if (a.provider === 'anthropic') return -1;
        if (b.provider === 'anthropic') return 1;
        if (a.provider === 'hugging_face') return -1;
        if (b.provider === 'hugging_face') return 1;
        return a.label.localeCompare(b.label);
      });
  }, [marketplaceModelGroups]);
  const anthropicMarketplaceGroup = visibleMarketplaceModelGroups.find((group) => group.provider === 'anthropic');
  const blackSwanMarketplaceGroup = visibleMarketplaceModelGroups.find((group) => group.provider === 'blackswan');
  const huggingFaceMarketplaceGroups = visibleMarketplaceModelGroups.filter((group) => group.provider === 'hugging_face');
  const connectedMarketplaceModelGroups = visibleMarketplaceModelGroups.filter((group) => group.connected && group.provider !== 'anthropic' && group.provider !== 'blackswan' && group.provider !== 'hugging_face');
  const disconnectedMarketplaceModelGroups = visibleMarketplaceModelGroups.filter((group) => !group.connected && group.provider !== 'anthropic' && group.provider !== 'blackswan' && group.provider !== 'hugging_face');

  // Connected provider set — drives Auto's bias toward the team's BYOK
  // keys. When OpenRouter is connected, Auto routes through OR-prefixed
  // model ids so the spend lands on the team account; otherwise the
  // resolver stays on the platform Anthropic ladder.
  const connectedProviderSet: ReadonlySet<string> = useMemo(() => {
    return new Set(
      marketplaceModelGroups
        .filter((g) => g.connected)
        .map((g) => normalizeConnectedProviderKey(g.provider as string)),
    );
  }, [marketplaceModelGroups]);

  // Live Auto preview — when selectedModel is 'auto', resolve what the
  // runtime would actually pick for the current input, given the active
  // SOUL profile + connected marketplace providers. Updates as the user
  // types so they can see the routing shift between Haiku / Sonnet /
  // Opus / OR-routed picks before they hit send.
  const autoResolvedModel = useMemo(() => {
    if (selectedModel !== 'auto') return null;
    try {
      const draft = (input || '').trim();
      const route = draft.length > 0
        ? analyzeMessageRouting(draft, 'main_chat').route
        : null;
      const providerSetForTurn = looksLikeActionRequest(draft)
        ? new Set(Array.from(connectedProviderSet).filter((provider) => provider !== 'blackswan'))
        : connectedProviderSet;
      const resolved = resolveModelForProfile(
        (sessionProfile as any) || 'senior',
        null,
        route?.intent,
        providerSetForTurn,
        route?.complexity,
        // P12 fix: the picker preview must use the SAME hint as send-time
        // resolution, or the dropdown shows a different model than the one
        // that actually runs (BlackSwan app-question lane).
        { appGroundedHint: looksLikeAppGroundedMessage(draft) },
        draft,
      );
      return resolved;
    } catch {
      return null;
    }
  }, [selectedModel, input, sessionProfile, connectedProviderSet]);

  const autoResolvedShortLabel = useMemo(() => {
    if (!autoResolvedModel) return null;
    return autoModelDisplayName(autoResolvedModel);
  }, [autoResolvedModel]);
  const soulActions = getMainChatSessionActions(sessionProfile || 'senior');
  const controlStatusLabel = currentRunStep?.trim()
    || (runStatus === 'running' ? 'thinking'
      : runStatus === 'delegated' ? 'delegating'
      : runStatus === 'waiting_approval' ? 'awaiting approval'
      : 'ready');
  const accordionCategories = PROMPT_CATEGORIES.map((category) => ({
    key: category.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    category,
  }));

  const renderAutoModelAction = () => {
    const model = autoModelOption;
    if (!model) return null;
    const sectionColor = modelSectionAccent('action:auto', model.color);
    const isActive = selectedModel === 'auto';
    const isHovered = hoveredModel === model.id;
    const autoExtra = autoResolvedShortLabel
      ? `Routes to ${autoResolvedShortLabel}${input.trim() ? ' for this prompt' : ' by default'}`
      : model.desc;
    return (
      <Pressable
        key="auto-model-direct"
        onPress={() => {
          onModelChange('auto');
          setShowModelPicker(false);
        }}
        onHoverIn={() => setHoveredModel(model.id)}
        onHoverOut={() => setHoveredModel(null)}
        accessibilityRole="button"
        accessibilityLabel="Select Auto model routing"
        style={[
          styles.dropdownItem,
          { borderWidth: 1, borderColor: sectionColor + '45', backgroundColor: sectionColor + '10' },
          isActive && { backgroundColor: sectionColor + '18', borderColor: sectionColor + '80' },
          modelSectionHoverStyle(sectionColor, isHovered),
          ...modelSectionTransitionStyle(),
        ]}
      >
        <View style={[styles.dropdownItemIcon, { backgroundColor: sectionColor + '20' }]}>
          <Text style={[styles.dropdownItemIconText, { color: sectionColor }]}>{model.icon}</Text>
        </View>
        <View style={styles.dropdownItemText}>
          <Text style={[styles.dropdownItemLabel, { color: sectionColor }]}>
            {model.label}
            {autoResolvedShortLabel ? (
              <Text style={{ color: '#94a3b8', fontWeight: '500', fontSize: 11 }}>{`  ->  ${autoResolvedShortLabel}`}</Text>
            ) : null}
          </Text>
          <Text style={styles.dropdownItemDesc}>{autoExtra}</Text>
        </View>
        {isActive ? <View style={[styles.dropdownActiveDot, { backgroundColor: sectionColor }]} /> : null}
      </Pressable>
    );
  };

  const renderExpandedBuiltInModelGroup = (group: typeof MODEL_GROUPS[number]) => {
    const sectionColor = modelSectionAccent(`base:${group.key}`, group.color);
    const groupModels = group.key === 'popular'
      ? popularModels
      : CHAT_MODELS.filter((m: ChatPickerModel) => m.group === group.key);
    if (groupModels.length === 0) return null;
    return (
      <View key={group.key}>
        <Text style={[styles.dropdownCategoryTitle, { color: sectionColor }]}>{group.label}</Text>
        {groupModels.map((model: any) => {
          const isActive = model.id === selectedModel;
          const isHovered = hoveredModel === model.id;
          const isAuto = model.id === 'auto';
          const autoExtra = isAuto && autoResolvedShortLabel
            ? ` · resolves to ${autoResolvedShortLabel}${input.trim() ? ' for this prompt' : ' by default'}`
            : '';
          return (
            <Pressable
              key={model.id}
              onPress={() => { onModelChange(model.id); setShowModelPicker(false); }}
              onHoverIn={() => setHoveredModel(model.id)}
              onHoverOut={() => setHoveredModel(null)}
              accessibilityRole="button"
              style={[
                styles.dropdownItem,
                isActive && { backgroundColor: model.color + '18', borderColor: model.color + '40' },
                isHovered && !isActive && { backgroundColor: '#1a1a28' },
                isAuto && !isActive && { borderColor: model.color + '40' },
                ...(Platform.OS === 'web' ? [{ transition: 'all 0.15s ease', cursor: 'pointer' } as any] : []),
              ]}
            >
              <View style={[styles.dropdownItemIcon, { backgroundColor: model.color + '20' }]}>
                <Text style={[styles.dropdownItemIconText, { color: model.color }]}>{model.icon}</Text>
              </View>
              <View style={styles.dropdownItemText}>
                <Text style={[styles.dropdownItemLabel, isActive && { color: model.color }]}>
                  {model.label}
                  {isAuto && autoResolvedShortLabel ? (
                    <Text style={{ color: model.color, fontWeight: '600', fontSize: 11 }}>{`  →  ${autoResolvedShortLabel}`}</Text>
                  ) : null}
                </Text>
                <Text style={styles.dropdownItemDesc}>{model.desc}{autoExtra}</Text>
                {(model as any).tags && (
                  <View style={{ flexDirection: 'row', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                    {((model as any).tags as string[]).map((tag: string) => {
                      const tagColors: Record<string, string> = { images: '#84cc16', vision: '#22d3ee', code: '#a855f7', text: '#606075', web: '#f59e0b', reason: '#ec4899' };
                      return (
                        <View key={tag} style={{ backgroundColor: (tagColors[tag] || '#606075') + '15', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
                          <Text style={{ color: tagColors[tag] || '#606075', fontSize: 7, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{toTitleCaseWords(tag)}</Text>
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
              {isActive && <View style={[styles.dropdownActiveDot, { backgroundColor: model.color }]} />}
            </Pressable>
          );
        })}
      </View>
    );
  };

  const renderBrowseBuiltInModelGroup = (group: typeof MODEL_GROUPS[number]) => {
    const sectionColor = modelSectionAccent(`base:${group.key}`, group.color);
    const groupModels = group.key === 'popular'
      ? popularModels
      : CHAT_MODELS.filter((m: ChatPickerModel) => m.group === group.key);
    if (groupModels.length === 0) return null;
    const browserKey = `base:${group.key}`;
    const hoverKey = `section:${browserKey}`;
    const isHovered = hoveredModel === hoverKey;
    return (
      <View key={group.key}>
        <Text style={[styles.dropdownCategoryTitle, { color: sectionColor }]}>{group.label}</Text>
        <Pressable
          onPress={() => {
            setActiveModelBrowserKey(browserKey);
            setShowAddModel(false);
          }}
          onHoverIn={() => setHoveredModel(hoverKey)}
          onHoverOut={() => setHoveredModel(null)}
          accessibilityRole="button"
          style={[
            styles.dropdownItem,
            { borderWidth: 1, borderColor: sectionColor + '45', backgroundColor: sectionColor + '10' },
            modelSectionHoverStyle(sectionColor, isHovered),
            ...modelSectionTransitionStyle(),
          ]}
        >
          <View style={[styles.dropdownItemIcon, { backgroundColor: sectionColor + '20' }]}>
            <Text style={[styles.dropdownItemIconText, { color: sectionColor }]}>
              {group.label.slice(0, 2).replace(/\s/g, '')}
            </Text>
          </View>
          <View style={styles.dropdownItemText}>
            <Text style={[styles.dropdownItemLabel, { color: sectionColor }]}>{group.label}</Text>
            <Text style={styles.dropdownItemDesc}>
              {`${groupModels.length} model${groupModels.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <Text style={[styles.modelChevron, { color: sectionColor }]}>{'>'}</Text>
        </Pressable>
      </View>
    );
  };

  const renderMarketplaceModelGroup = (group: ModelGroup) => {
    const provider = group.provider as string;
    const isBlackSwanSection = provider === 'blackswan';
    const providerColor = modelSectionAccent(
      `provider:${provider}`,
      modelPickerProviderColor(provider, group.connected),
    );
    const labelColor = isBlackSwanSection ? '#f8fafc' : providerColor;
    const detailColor = isBlackSwanSection ? '#cbd5e1' : undefined;
    const providerIconText = modelPickerProviderIcon(provider);
    const browserKey = modelBrowserKeyForMarketplaceGroup(group);
    const groupKey = `mkt-${provider}-${browserKey}`;
    const modelCount = group.models?.length || 0;
    const isHovered = hoveredModel === groupKey;
    return (
      <View key={groupKey}>
        <Text style={[styles.dropdownCategoryTitle, { color: labelColor }]}>
          {group.label}
          {!group.connected ? (
            <Text style={{ color: '#475569', fontSize: 9, fontWeight: '500', fontStyle: 'italic' }}>{'  · not connected'}</Text>
          ) : null}
        </Text>
        <Pressable
          onPress={() => {
            setActiveModelBrowserKey(browserKey);
            setShowAddModel(false);
          }}
          onHoverIn={() => setHoveredModel(groupKey)}
          onHoverOut={() => setHoveredModel(null)}
          accessibilityRole="button"
          style={[
            styles.dropdownItem,
            isBlackSwanSection
              ? {
                  borderWidth: 1,
                  borderColor: isHovered ? '#ffffffaa' : '#334155',
                  backgroundColor: isHovered ? '#111827' : '#050505',
                }
              : { borderWidth: 1, borderColor: providerColor + '35', backgroundColor: providerColor + '10' },
            !isBlackSwanSection ? modelSectionHoverStyle(providerColor, isHovered) : null,
            isBlackSwanSection && Platform.OS === 'web'
              ? {
                  boxShadow: isHovered
                    ? '0 0 0 1px rgba(255,255,255,0.22), 0 14px 32px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.12)'
                    : 'inset 0 1px 0 rgba(255,255,255,0.06)',
                  transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
                } as any
              : null,
            ...modelSectionTransitionStyle(),
          ]}
        >
          <View style={[
            styles.dropdownItemIcon,
            isBlackSwanSection
              ? { backgroundColor: isHovered ? '#f8fafc' : '#111827', borderWidth: 1, borderColor: '#475569' }
              : { backgroundColor: providerColor + '20' },
          ]}>
            <Text style={[styles.dropdownItemIconText, { color: isBlackSwanSection ? (isHovered ? '#050505' : '#f8fafc') : providerColor }]}>{providerIconText}</Text>
          </View>
          <View style={styles.dropdownItemText}>
            <Text style={[styles.dropdownItemLabel, { color: labelColor }]}>{group.label}</Text>
            <Text style={[styles.dropdownItemDesc, detailColor ? { color: detailColor } : null]} numberOfLines={1}>
              {modelCount > 0
                ? `${modelCount} model${modelCount === 1 ? '' : 's'}${group.connected ? '' : ' · connect to run'}`
                : group.hint || 'No models loaded yet'}
            </Text>
          </View>
          <Text style={[styles.modelChevron, { color: labelColor }]}>{'>'}</Text>
        </Pressable>
      </View>
    );
  };

  const renderCustomModelGroup = () => {
    if (customModels.length === 0) return null;
    const section = customModelBrowserSections[0];
    if (!section) return null;
    const hoverKey = 'section:custom-hf-hub';
    const isHovered = hoveredModel === hoverKey;
    return (
      <View key="custom-hf-hub-models">
        <Text style={[styles.dropdownCategoryTitle, { color: section.color }]}>{section.label}</Text>
        <Pressable
          onPress={() => {
            setActiveModelBrowserKey(section.key);
            setShowAddModel(false);
          }}
          onHoverIn={() => setHoveredModel(hoverKey)}
          onHoverOut={() => setHoveredModel(null)}
          accessibilityRole="button"
          style={[
            styles.dropdownItem,
            { borderWidth: 1, borderColor: section.color + '35', backgroundColor: section.color + '10' },
            modelSectionHoverStyle(section.color, isHovered),
            ...modelSectionTransitionStyle(),
          ]}
        >
          <View style={[styles.dropdownItemIcon, { backgroundColor: section.color + '20' }]}>
            <Text style={[styles.dropdownItemIconText, { color: section.color }]}>{section.icon}</Text>
          </View>
          <View style={styles.dropdownItemText}>
            <Text style={[styles.dropdownItemLabel, { color: section.color }]}>{section.label}</Text>
            <Text style={styles.dropdownItemDesc}>
              {`${section.models.length} saved model${section.models.length === 1 ? '' : 's'}`}
            </Text>
          </View>
          <Text style={[styles.modelChevron, { color: section.color }]}>{'>'}</Text>
        </Pressable>
      </View>
    );
  };

  const renderAddHFHubModelAction = () => {
    const sectionColor = modelSectionAccent('action:add-hf-hub', accentColor);
    const hoverKey = 'section:add-hf-hub';
    const isHovered = hoveredModel === hoverKey;
    return (
      <Pressable
        key="add-hf-hub-model"
        onPress={() => {
          setShowAddModel(true);
          setActiveModelBrowserKey(null);
        }}
        onHoverIn={() => setHoveredModel(hoverKey)}
        onHoverOut={() => setHoveredModel(null)}
        accessibilityRole="button"
        style={[
          styles.dropdownItem,
          { borderWidth: 1, borderColor: sectionColor + '45', backgroundColor: sectionColor + '10' },
          modelSectionHoverStyle(sectionColor, isHovered),
          ...modelSectionTransitionStyle(),
        ]}
      >
        <View style={[styles.dropdownItemIcon, { backgroundColor: sectionColor + '20' }]}>
          <Text style={[styles.dropdownItemIconText, { color: sectionColor }]}>+</Text>
        </View>
        <View style={styles.dropdownItemText}>
          <Text style={[styles.dropdownItemLabel, { color: sectionColor }]}>Add HF Hub Model</Text>
          <Text style={styles.dropdownItemDesc}>Register a custom Hugging Face repo model</Text>
        </View>
      </Pressable>
    );
  };

  const inputStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(10px)',
    borderColor: focused ? accentColor + '60' : accentColor + '30',
    boxShadow: focused ? `0 0 20px ${accentColor}30` : 'none',
    transition: 'all 0.3s ease',
  } as any : {
    borderColor: focused ? accentColor + '60' : accentColor + '30',
  };

  return (
    <View style={[styles.enhancedInputBar, { borderColor: accentColor + '20' }]} nativeID="section-chat-composer">
      {/* Toolbar row: model selector + quick actions */}
      <View style={styles.composerToolbar}>
        {/* Model Selector Button */}
        <View style={{ position: 'relative' as const }}>
          <Pressable
            onPress={() => {
              const next = !showModelPicker;
              setShowModelPicker(next);
              setShowQuickActions(false);
              if (!next) {
                setShowAddModel(false);
                setActiveModelBrowserKey(null);
              }
            }}
            onHoverIn={() => setHoveredModel('_btn')}
            onHoverOut={() => setHoveredModel(null)}
            accessibilityRole="button"
            accessibilityLabel={`Model: ${currentModel.label}`}
            style={[
              styles.modelButton,
              { borderColor: currentModel.color + '50' },
              hoveredModel === '_btn' && { borderColor: currentModel.color, backgroundColor: currentModel.color + '15' },
              ...(Platform.OS === 'web' ? [{ transition: 'all 0.2s ease', cursor: 'pointer' } as any] : []),
            ]}
          >
            <View style={[styles.modelIconBox, { backgroundColor: currentModel.color + '20' }]}>
              <Text style={[styles.modelIconText, { color: currentModel.color }]}>{currentModel.icon}</Text>
            </View>
            <Text style={[styles.modelButtonLabel, { color: currentModel.color }]}>
              {currentModel.label}
              {selectedModel === 'auto' && autoResolvedShortLabel ? (
                <Text style={{ color: '#94a3b8', fontWeight: '500' }}>{` → ${autoResolvedShortLabel}`}</Text>
              ) : null}
            </Text>
            <Text style={styles.modelChevron}>{showModelPicker ? '▲' : '▼'}</Text>
          </Pressable>

          {/* Model Dropdown */}
          {showModelPicker && !showAddModel && !activeModelBrowserKey && (
            <AnimatedPopup style={[styles.dropdownPanel, { maxHeight: 480, width: 320, left: 0, right: 'auto' }, ...(Platform.OS === 'web' ? [{ boxShadow: '4px 4px 0px rgba(99,102,241,0.05), 0 12px 40px rgba(0,0,0,0.6)', overflowY: 'auto' } as any] : [])]}>
              {renderAutoModelAction()}
              {blackSwanMarketplaceGroup ? renderMarketplaceModelGroup(blackSwanMarketplaceGroup) : null}
              {popularBuiltInModelGroup ? renderBrowseBuiltInModelGroup(popularBuiltInModelGroup) : null}
              {anthropicMarketplaceGroup ? renderMarketplaceModelGroup(anthropicMarketplaceGroup) : null}
              <Text style={[styles.dropdownCategoryTitle, { color: modelSectionAccent('provider:hugging_face', '#ffbd45') }]}>Hugging Face</Text>
              {renderAddHFHubModelAction()}
              {huggingFaceMarketplaceGroups.map(renderMarketplaceModelGroup)}
              {renderCustomModelGroup()}
              {connectedMarketplaceModelGroups.map(renderMarketplaceModelGroup)}
              {secondaryBuiltInModelGroups.map(renderBrowseBuiltInModelGroup)}
              {disconnectedMarketplaceModelGroups.map(renderMarketplaceModelGroup)}
            </AnimatedPopup>
          )}

          {/* Model Section Browser */}
          {showModelPicker && activeModelBrowserKey && (
            <AnimatedPopup style={[styles.dropdownPanel, styles.providerBrowserDropdown, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' } as any] : [])]}>
              <ModelSectionBrowserPanel
                section={activeModelBrowserSection}
                selectedModel={selectedModel}
                onSelect={(modelId) => {
                  onModelChange(modelId);
                  setActiveModelBrowserKey(null);
                  setShowModelPicker(false);
                }}
                onClose={() => setActiveModelBrowserKey(null)}
              />
            </AnimatedPopup>
          )}

          {/* Add Model Panel */}
          {showModelPicker && showAddModel && (
            <AnimatedPopup style={[styles.dropdownPanel, styles.dropdownPanelWide, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' } as any] : [])]}>
              <AddModelPanel
                accentColor={accentColor}
                onModelAdded={(model) => {
                  import('../../../lib/customModels').then(({ customModelToChatModel }) => {
                    const chatModel = customModelToChatModel(model);
                    setCustomModels(prev => {
                      if (prev.some((item: any) => item.id === chatModel.id)) return prev;
                      return [...prev, chatModel];
                    });
                    onModelChange(chatModel.id);
                    setShowAddModel(false);
                    setShowModelPicker(false);
                  });
                }}
                onClose={() => setShowAddModel(false)}
                marketplaceConnected={!!huggingFaceMarketplaceGroup?.connected}
                marketplaceHint={huggingFaceMarketplaceGroup?.hint}
              />
            </AnimatedPopup>
          )}
        </View>

        {/* Web Search toggle moved to the small status-chip row next
            to the DESKTOP chip — keeps the composer toolbar focused on
            the model picker / quick actions and groups capability
            indicators where the cost footer already lives. */}

        {/* Quick Actions Button */}
        <View style={{ position: 'relative' as const }}>
          <Pressable
            onPress={() => {
              setShowQuickActions(!showQuickActions);
              setShowModelPicker(false);
              setShowAddModel(false);
              setActiveModelBrowserKey(null);
            }}
            onHoverIn={() => setHoveredAction(-1)}
            onHoverOut={() => setHoveredAction(null)}
            accessibilityRole="button"
            accessibilityLabel="Quick actions"
            style={[
              styles.quickActionsButton,
              hoveredAction === -1 && { borderColor: accentColor + '60', backgroundColor: accentColor + '10' },
              ...(Platform.OS === 'web' ? [{ transition: 'all 0.2s ease', cursor: 'pointer' } as any] : []),
            ]}
          >
            <Text style={[styles.quickActionsIcon, { color: accentColor }]}>{'+'}</Text>
            <Text style={styles.quickActionsLabel}>Actions</Text>
            <Text style={styles.modelChevron}>{showQuickActions ? '▲' : '▼'}</Text>
          </Pressable>

          {/* Quick Actions Dropdown */}
          {showQuickActions && (
            <AnimatedPopup
              {...(Platform.OS === 'web' ? { className: 'uc-actions-sysfont' } as any : {})}
              style={[styles.dropdownPanel, styles.dropdownPanelWide, ...(Platform.OS === 'web' ? [{ boxShadow: '4px 4px 0px rgba(99,102,241,0.05), 0 12px 40px rgba(0,0,0,0.6)' } as any] : [])]}
            >
              <ScrollView style={styles.actionsAccordionScroll} contentContainerStyle={styles.actionsAccordionContent}>
                <View style={styles.actionsAccordionSection}>
                  <QuickActionsHeader
                    expanded={expandedActionSections.quick}
                    isHovered={
                      hoveredAction === -199
                      || expandedActionSections.quick
                      || (hoveredAction !== null && hoveredAction >= 50 && hoveredAction < 200)
                    }
                    onPress={() => setExpandedActionSections(prev => ({ ...prev, quick: !prev.quick }))}
                    onHoverIn={() => setHoveredAction(-199)}
                    onHoverOut={() => setHoveredAction(null)}
                  />
                  {expandedActionSections.quick ? (
                    <View style={styles.actionsAccordionBody}>
                      {[...FEATURED_QUICK_ACTIONS, ...QUICK_PROMPTS.slice(7)].map((p, i) => (
                        <Pressable
                          key={`${p.label}-${i}`}
                          onPress={() => { onQuickAction(p.text); setShowQuickActions(false); }}
                          onHoverIn={() => setHoveredAction(50 + i)}
                          onHoverOut={() => setHoveredAction(null)}
                          style={[
                            styles.dropdownItem,
                            hoveredAction === 50 + i && { backgroundColor: '#1a1a28' },
                          ]}
                        >
                          <Text style={styles.dropdownActionLabel}>{p.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>

                <View style={styles.dropdownDivider} />

                <View style={styles.actionsAccordionSection}>
                  <Pressable
                    onPress={() => setExpandedActionSections(prev => ({ ...prev, tools: !prev.tools }))}
                    onHoverIn={() => setHoveredAction(-201)}
                    onHoverOut={() => setHoveredAction(null)}
                    style={[
                      styles.actionsAccordionHeader,
                      Platform.OS === 'web' && { transition: 'all 0.15s ease' } as any,
                      hoveredAction === -201 && { backgroundColor: '#f59e0b08' } as any,
                    ]}
                  >
                    <Text style={[styles.actionsAccordionTitle, { color: hoveredAction === -201 ? '#f59e0b' : '#e2e8f0' }]}>SwanClaw Tools</Text>
                    <Text style={styles.actionsAccordionChevron}>{expandedActionSections.tools ? '▾' : '▸'}</Text>
                  </Pressable>
                  {expandedActionSections.tools ? (
                    <View style={styles.actionsAccordionBody}>
                      {FEATURED_TOOL_ACTIONS.map((tool, toolIndex) => (
                        <Pressable
                          key={tool.text}
                          onPress={() => { onQuickAction(tool.text); setShowQuickActions(false); }}
                          onHoverIn={() => setHoveredAction(-100 - toolIndex)}
                          onHoverOut={() => setHoveredAction(null)}
                          style={[
                            styles.dropdownItem,
                            hoveredAction === -100 - toolIndex && { backgroundColor: '#151522' },
                          ]}
                        >
                          {tool.flatIcon ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                              <FlatIcon name={tool.flatIcon} size={14} />
                              <Text style={[styles.featuredQuickActionText, { color: tool.color }]}>{tool.label}</Text>
                            </View>
                          ) : (
                            <Text style={[styles.featuredQuickActionText, { color: tool.color }]}>{tool.label}</Text>
                          )}
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>

                <View style={styles.dropdownDivider} />

                {accordionCategories.map(({ key, category }, ci) => (
                  <View key={key} style={styles.actionsAccordionSection}>
                    <Pressable
                      onPress={() => setExpandedActionSections(prev => ({ ...prev, [key]: !prev[key] }))}
                      onHoverIn={() => setHoveredAction(-300 - ci)}
                      onHoverOut={() => setHoveredAction(null)}
                      style={[
                        styles.actionsAccordionHeader,
                        Platform.OS === 'web' && { transition: 'all 0.15s ease' } as any,
                        hoveredAction === -300 - ci && { backgroundColor: `${category.color}08` } as any,
                      ]}
                    >
                      <Text style={[styles.actionsAccordionTitle, { color: hoveredAction === -300 - ci ? category.color : '#e2e8f0' }]}>
                        {toTitleCaseWords(category.title)}
                      </Text>
                      <Text style={styles.actionsAccordionChevron}>{expandedActionSections[key] ? '▾' : '▸'}</Text>
                    </Pressable>
                    {expandedActionSections[key] ? (
                      <View style={styles.actionsAccordionBody}>
                        {category.prompts.map((p, pi) => (
                          <Pressable
                            key={pi}
                            onPress={() => { onQuickAction(p.text); setShowQuickActions(false); }}
                            onHoverIn={() => setHoveredAction(100 + ci * 20 + pi)}
                            onHoverOut={() => setHoveredAction(null)}
                            accessibilityRole="button"
                            accessibilityLabel={p.label}
                            style={[
                              styles.dropdownItem, { paddingLeft: 20 },
                              hoveredAction === 100 + ci * 20 + pi && { backgroundColor: category.color + '10' },
                              ...(Platform.OS === 'web' ? [{ transition: 'all 0.15s ease', cursor: 'pointer' } as any] : []),
                            ]}
                          >
                            <View style={styles.dropdownItemText}>
                              <Text style={styles.dropdownItemLabel}>{p.label}</Text>
                              <Text style={styles.dropdownItemDesc}>{p.desc}</Text>
                            </View>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    {ci < accordionCategories.length - 1 ? <View style={styles.dropdownDivider} /> : null}
                  </View>
                ))}
              </ScrollView>
            </AnimatedPopup>
          )}
        </View>

        {/* Mode Selector Dropdown */}
        <View style={{ position: 'relative' as const }}>
          <Pressable
            onPress={() => { setShowModePicker(!showModePicker); setShowModelPicker(false); setShowQuickActions(false); }}
            accessibilityRole="button"
            accessibilityLabel="Open agent and OpenSwan control center"
            style={({ hovered, pressed }: any) => [
              styles.modelButton,
              { borderColor: (selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '50' },
              hovered && {
                borderColor: (selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '80',
                backgroundColor: (selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '14',
                ...(Platform.OS === 'web' ? { boxShadow: `0 10px 28px ${(selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor)}22`, transform: 'translateY(-1px)' } as any : {}),
              },
              pressed && { transform: [{ scale: 0.985 }] },
              ...(Platform.OS === 'web' ? [{ transition: 'all 0.2s ease', cursor: 'pointer' } as any] : []),
            ]}
          >
            <View style={[styles.modelIconBox, { backgroundColor: (selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '20' }]}>
              <Text style={[styles.modelIconText, { color: selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor }]}>
                {selectedChatAgentTarget?.icon || 'OS'}
              </Text>
            </View>
            <Text
              style={[styles.modelButtonLabel, { color: selectedChatAgentTarget?.color || CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor }]}
              numberOfLines={1}
            >
              {selectedChatAgentTarget?.label || 'OpenSwan'}
            </Text>
            <Text style={styles.modelChevron}>{showModePicker ? '▲' : '▼'}</Text>
          </Pressable>

          {showModePicker && (
            <AnimatedPopup style={[styles.dropdownPanel, styles.dropdownPanelControlCenter, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' } as any] : [])]}>
              <Text style={styles.dropdownTitle}>OpenSwan Control Panel</Text>
              <View style={styles.controlCenterStatusBand}>
                <View style={styles.controlCenterStatusHeader}>
                  <View style={[styles.liveMiniDot, { backgroundColor: runStatus === 'idle' ? '#22c55e' : runStatus === 'waiting_approval' ? '#f59e0b' : '#6366f1' }]} />
                  <Text style={styles.controlCenterStatusLabel}>STATUS</Text>
                </View>
                <Text style={styles.controlCenterStatusValue} numberOfLines={2}>{controlStatusLabel}</Text>
              </View>
              <Pressable
                onPress={() => openControlPanelWith('')}
                accessibilityRole="button"
                accessibilityLabel="Open OpenSwan Control Panel"
                style={({ hovered, pressed }: any) => [
                  styles.controlPanelPrimaryAction,
                  { borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '70' },
                  hovered && {
                    borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor),
                    backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '18',
                  },
                  pressed && { transform: [{ scale: 0.99 }] },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.controlPanelPrimaryTitle}>
                    {input.trim() ? 'Open draft in Control Panel' : 'Open Control Panel'}
                  </Text>
                  <Text style={styles.controlPanelPrimaryDesc}>
                    Intent routing, access readiness, cost preview, tools, memory, and live runs.
                  </Text>
                </View>
                <Text style={styles.controlPanelPrimaryArrow}>›</Text>
              </Pressable>
              <View style={styles.controlRouteGrid}>
                {CONTROL_PANEL_LAUNCHERS.map((route) => (
                  <Pressable
                    key={route.label}
                    onPress={() => openControlPanelWith(route.seed)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open Control Panel for ${route.label}`}
                    style={({ hovered, pressed }: any) => [
                      styles.controlRouteCard,
                      { borderColor: `${route.color}42`, backgroundColor: `${route.color}0f` },
                      hovered && { borderColor: `${route.color}88`, backgroundColor: `${route.color}18` },
                      pressed && { transform: [{ scale: 0.985 }] },
                    ]}
                  >
                    <Text style={[styles.controlRouteLabel, { color: route.color }]}>{route.label}</Text>
                    <Text style={styles.controlRouteDesc} numberOfLines={2}>{route.desc}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.controlAgentSection}>
                <View style={styles.controlAgentSectionHeader}>
                  <Text style={styles.controlAgentSectionTitle}>Agents</Text>
                  <Text style={styles.controlAgentSectionMeta}>
                    {chatAgentTargets.filter((target: ChatAgentTarget<AssignableAgent>) => target.connected).length} connected
                  </Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.controlAgentRail}
                >
                  {chatAgentTargets.map((target: ChatAgentTarget<AssignableAgent>) => {
                    const isActive = selectedChatAgentTarget?.id === target.id;
                    const statusColor = target.status === 'active' || target.status === 'building'
                      ? '#22c55e'
                      : target.status === 'idle'
                        ? '#f59e0b'
                        : target.status === 'setup_required'
                          ? '#64748b'
                          : '#ef4444';
                    return (
                      <Pressable
                        key={target.id}
                        onPress={() => {
                          if (target.connected) {
                            onSelectChatAgent?.(target.id);
                            setShowModePicker(false);
                            return;
                          }
                          onLocalBotMessage?.(buildChatAgentSetupMessage(target), {
                            localOnly: true,
                            source: {
                              actor: 'OpenSwan',
                              surface: 'chat_agent_selector_setup',
                              provider: target.provider,
                              selectedModel,
                            },
                          });
                          setShowModePicker(false);
                          onOpenAgentSetup?.();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={target.connected ? `Use ${target.label} for chat tasks` : `Connect ${target.label}`}
                        style={({ hovered, pressed }: any) => [
                          styles.controlAgentCard,
                          {
                            borderColor: isActive ? `${target.color}88` : `${target.color}30`,
                            backgroundColor: isActive ? `${target.color}18` : '#0f172a',
                          },
                          hovered && { borderColor: `${target.color}99`, backgroundColor: `${target.color}14` },
                          pressed && { transform: [{ scale: 0.985 }] },
                          Platform.OS === 'web' && { cursor: 'pointer', transition: 'all 0.15s ease' } as any,
                        ]}
                      >
                        <View style={styles.controlAgentCardHeader}>
                          <View style={[styles.controlAgentIcon, { backgroundColor: `${target.color}22` }]}>
                            <Text style={[styles.controlAgentIconText, { color: target.color }]} numberOfLines={1}>
                              {target.icon}
                            </Text>
                          </View>
                          <View style={[styles.liveMiniDot, { backgroundColor: statusColor }]} />
                        </View>
                        <Text style={[styles.controlAgentName, isActive && { color: target.color }]} numberOfLines={1}>
                          {target.label}
                        </Text>
                        <Text style={styles.controlAgentDesc} numberOfLines={2}>
                          {target.connected
                            ? target.description
                            : 'Connect to use from chat'}
                        </Text>
                        <Text style={[styles.controlAgentStatus, { color: statusColor }]} numberOfLines={1}>
                          {target.connected ? target.status.replace('_', ' ') : 'setup'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={styles.controlAgentSelectedLabel} numberOfLines={1}>
                  Current: {selectedChatAgentTarget?.label || 'OpenSwan'}
                </Text>
              </View>
              <Pressable
                onPress={() => setShowControlAdvanced((v) => !v)}
                style={({ hovered, pressed }: any) => [
                  styles.controlAdvancedToggle,
                  hovered && { borderColor: '#334155', backgroundColor: '#111827' },
                  pressed && { transform: [{ scale: 0.99 }] },
                ]}
                accessibilityRole="button"
                accessibilityLabel={showControlAdvanced ? 'Hide OpenSwan advanced controls' : 'Show OpenSwan advanced controls'}
              >
                <Text style={styles.controlAdvancedToggleText}>
                  {showControlAdvanced ? 'Hide advanced controls' : 'Show advanced controls'}
                </Text>
                <Text style={styles.modelChevron}>{showControlAdvanced ? '▾' : '▸'}</Text>
              </Pressable>
              {showControlAdvanced ? (
                <>
              <View style={styles.controlCenterStatsRow}>
                <View style={styles.controlCenterStatPill}>
                  <Text style={styles.controlCenterStatValue}>{openswanSessionCount || 0}</Text>
                  <Text style={styles.controlCenterStatLabel}>sessions</Text>
                </View>
                <View style={styles.controlCenterStatPill}>
                  <Text style={styles.controlCenterStatValue}>{memoryCount || 0}</Text>
                  <Text style={styles.controlCenterStatLabel}>memory</Text>
                </View>
                <View style={styles.controlCenterStatPill}>
                  <Text style={styles.controlCenterStatValue}>{activePlugins?.length || 0}</Text>
                  <Text style={styles.controlCenterStatLabel}>plugins</Text>
                </View>
                <View style={styles.controlCenterStatPill}>
                  <Text style={styles.controlCenterStatValue}>{builderRevisionCount || 0}</Text>
                  <Text style={styles.controlCenterStatLabel}>builds</Text>
                </View>
              </View>
              {/* Quick action shortcuts — same RUN/ASSIGN/MISSION/REMEMBER/
                  MEMORIES/DIAG/SEARCH pills as the dock above the composer,
                  surfaced here so the OpenSwan menu is the one place users
                  go for command-palette ergonomics. Tapping a pill closes
                  this menu, seeds the composer with the slash command,
                  and refocuses the input. */}
              <View style={{ marginBottom: 8, marginHorizontal: -4 }}>
                <QuickActionDock
                  accentColor={accentColor}
                  onInsert={(text) => {
                    setShowModePicker(false);
                    const current = input || '';
                    const next = current.trim()
                      ? (current.endsWith(' ') ? current + text : current + ' ' + text)
                      : text;
                    onInputChange(next);
                    setTimeout(() => inputRef.current?.focus(), 0);
                  }}
                />
              </View>
              <View style={styles.controlCenterGrid}>
                <Pressable
                  onPress={() => { onOpenPlugins?.(); setShowModePicker(false); }}
                  style={({ hovered, pressed }: any) => [
                    styles.dropdownItem,
                    styles.controlCenterCard,
                    hovered && styles.controlCenterCardHover,
                    pressed && { transform: [{ scale: 0.985 }] },
                    Platform.OS === 'web' && { cursor: 'pointer', transition: 'all 0.15s ease' } as any,
                  ]}
                >
                  <View style={[styles.dropdownItemIcon, { backgroundColor: '#22c55e20' }]}>
                    <Text style={[styles.dropdownItemIconText, { color: '#22c55e' }]}>P</Text>
                  </View>
                  <View style={styles.dropdownItemText}>
                    <Text style={styles.dropdownItemLabel}>Plugins</Text>
                    <Text style={styles.dropdownItemDesc}>{activePlugins.length} active</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => { onOpenMemory?.(); setShowModePicker(false); }}
                  style={({ hovered, pressed }: any) => [
                    styles.dropdownItem,
                    styles.controlCenterCard,
                    hovered && styles.controlCenterCardHover,
                    pressed && { transform: [{ scale: 0.985 }] },
                    Platform.OS === 'web' && { cursor: 'pointer', transition: 'all 0.15s ease' } as any,
                  ]}
                >
                  <View style={[styles.dropdownItemIcon, { backgroundColor: '#6366f120' }]}>
                    <Text style={[styles.dropdownItemIconText, { color: '#6366f1' }]}>M</Text>
                  </View>
                  <View style={styles.dropdownItemText}>
                    <Text style={styles.dropdownItemLabel}>Memory</Text>
                    <Text style={styles.dropdownItemDesc}>Inspect, search, save</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => {
                    onToggleBuilder?.();
                    setShowModePicker(false);
                  }}
                  style={({ hovered, pressed }: any) => [
                    styles.dropdownItem,
                    styles.controlCenterCard,
                    hovered && styles.controlCenterCardHover,
                    pressed && { transform: [{ scale: 0.985 }] },
                    Platform.OS === 'web' && { cursor: 'pointer', transition: 'all 0.15s ease' } as any,
                  ]}
                >
                  <View style={[styles.dropdownItemIcon, { backgroundColor: '#f59e0b20' }]}>
                    <Text style={[styles.dropdownItemIconText, { color: '#f59e0b' }]}>B</Text>
                  </View>
                  <View style={styles.dropdownItemText}>
                    <Text style={styles.dropdownItemLabel}>Builder</Text>
                    <Text style={styles.dropdownItemDesc}>
                      {showWorkbenchSidecar ? 'Open live studio' : hasBuilderWork ? 'Open last build' : 'Open studio'}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={async () => {
                    await onResetMind?.();
                    setShowModePicker(false);
                  }}
                  style={({ hovered, pressed }: any) => [
                    styles.dropdownItem,
                    styles.controlCenterCard,
                    hovered && styles.controlCenterCardHover,
                    pressed && { transform: [{ scale: 0.985 }] },
                    Platform.OS === 'web' && { cursor: 'pointer', transition: 'all 0.15s ease' } as any,
                  ]}
                >
                  <View style={[styles.dropdownItemIcon, { backgroundColor: '#ef444420' }]}>
                    <Text style={[styles.dropdownItemIconText, { color: '#ef4444' }]}>R</Text>
                  </View>
                  <View style={styles.dropdownItemText}>
                    <Text style={styles.dropdownItemLabel}>Reset Mind</Text>
                    <Text style={styles.dropdownItemDesc}>Clear session state</Text>
                  </View>
                </Pressable>
              </View>
              <Text style={[styles.dropdownTitle, { fontSize: 11, marginBottom: 8 }]}>Interaction Mode</Text>
              {CHAT_MODE_CONFIG.map(m => {
                const isActive = (chatMode || 'talk') === m.key;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => { onModeChange?.(m.key); setShowModePicker(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${m.label} mode`}
                    style={({ hovered, pressed }: any) => [
                      styles.dropdownItem,
                      isActive && { backgroundColor: m.color + '18', borderColor: m.color + '40' },
                      hovered && !isActive && { backgroundColor: '#1a1a28', borderColor: m.color + '33' },
                      pressed && { transform: [{ scale: 0.985 }] },
                      ...(Platform.OS === 'web' ? [{ transition: 'all 0.15s ease', cursor: 'pointer' } as any] : []),
                    ]}
                    >
                      <View style={[styles.dropdownItemIcon, { backgroundColor: m.color + '20' }]}>
                        <Text style={[styles.dropdownItemIconText, { color: m.color }]}>{m.icon}</Text>
                      </View>
                    <View style={styles.controlCenterModeText}>
                      <Text style={[styles.controlCenterModeLabel, isActive && { color: m.color }]}>{m.label}</Text>
                      <Text style={styles.controlCenterModeDesc}>{m.desc}</Text>
                    </View>
                    {isActive && <View style={[styles.dropdownActiveDot, { backgroundColor: m.color }]} />}
                  </Pressable>
                );
              })}
                </>
              ) : null}
            </AnimatedPopup>
          )}
        </View>

        {/* Cost footer + capability chips — right-aligned. WEB and
            DESKTOP share the same chip shape so the row reads as a
            single density of capability indicators. */}
        <View style={{ flex: 1 }} />
        {onToggleWebSearch && (
          <WebSearchStatusChip
            enabled={!!webSearchEnabled}
            onToggle={onToggleWebSearch}
          />
        )}
        <DesktopBridgeStatusChip
          accentColor={accentColor}
          onMessage={(payload) => {
            if (typeof payload === 'string') {
              onLocalBotMessage?.(payload, {
                localOnly: true,
                source: {
                  actor: 'OpenSwan',
                  surface: 'desktop_bridge_status_chip',
                  selectedModel,
                  effectiveModel: 'local-desktop-bridge',
                },
              });
              return;
            }
            onLocalBotMessage?.(payload.content, {
              localOnly: true,
              recoveryOptions: payload.recoveryOptions,
              source: {
                actor: 'OpenSwan',
                surface: 'desktop_bridge_status_chip',
                selectedModel,
                effectiveModel: 'local-desktop-bridge',
              },
            });
          }}
        />
        <ChatCostFooter circleId={composerCircleId} accentColor={accentColor} />
      </View>

      {/* Attachment preview strip */}
      {attachments && attachments.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.attachmentStrip} contentContainerStyle={styles.attachmentStripContent}>
          {attachments.map((att: ChatAttachment) => (
            <View key={att.id} style={styles.attachmentThumb}>
              {att.type === 'image' ? (
                <Image source={{ uri: att.uri }} style={styles.attachmentImage} />
              ) : (
                <View style={styles.attachmentFileIcon}>
                  <Text style={styles.attachmentFileIconText}>{getMediaTypeIcon(att.type)}</Text>
                </View>
              )}
              <Pressable
                onPress={() => onRemoveAttachment?.(att.id)}
                style={styles.attachmentRemove}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
              >
                <Text style={styles.attachmentRemoveText}>x</Text>
              </Pressable>
              <Text style={styles.attachmentLabel} numberOfLines={1}>{att.name.slice(0, 12)}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {showPredictiveCommands && (
        <View style={styles.predictiveCommandPanel}>
          <View style={styles.predictiveCommandHeader}>
            <Text style={styles.predictiveCommandTitle}>Predictive commands</Text>
            <Text style={styles.predictiveCommandSubtitle}>
              {predictiveCommands.some((cmd) => cmd.source === 'next_step') ? 'Next likely Adobe step' : 'Deterministic desktop routes'}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.predictiveCommandRow}>
            {predictiveCommands.map((cmd) => (
              <Pressable
                key={cmd.id}
                onPress={() => applyPredictiveCommand(cmd)}
                accessibilityRole="button"
                accessibilityLabel={`Use predictive command ${cmd.label}`}
                style={({ hovered, pressed }: any) => [
                  styles.predictiveCommandChip,
                  { borderColor: cmd.color + '45', backgroundColor: cmd.color + '10' },
                  hovered && { borderColor: cmd.color + '90', backgroundColor: cmd.color + '18' },
                  pressed && { transform: [{ scale: 0.985 }] },
                  ...(Platform.OS === 'web' ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any] : []),
                ]}
              >
                <View style={[styles.predictiveCommandAppDot, { backgroundColor: cmd.color }]} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.predictiveCommandLabel, { color: cmd.color }]} numberOfLines={1}>{cmd.label}</Text>
                  <Text style={styles.predictiveCommandHint} numberOfLines={1}>{cmd.hint}</Text>
                </View>
                <Text style={styles.predictiveCommandSource}>{cmd.source === 'next_step' ? 'next' : cmd.app}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Input row */}
      <View style={[styles.enhancedInputWrapper, inputStyle]}>
        <Pressable onPress={onFocusBot} style={[styles.enhancedBotTrigger, { backgroundColor: accentColor + '30' }]}>
          <Image source={agentAvatarSource} style={styles.mainChatAgentComposerIcon} resizeMode="contain" />
        </Pressable>
        <Pressable
          onPress={onPickImage}
          style={[styles.enhancedBotTrigger, { backgroundColor: '#2a2a3e40' }]}
          accessibilityRole="button"
          accessibilityLabel="Attach files"
        >
          <Text style={{ fontSize: 16, color: '#a0a0b0' }}>+</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.enhancedInput}
          placeholder={`Ask ${agentName} anything...`}
          placeholderTextColor="#444"
          value={input}
          onChangeText={onInputChange}
          onSubmitEditing={() => {
            if (Platform.OS === 'web') return;
            if (showSlashCommands) {
              const selected = slashCommands[highlightedSlashIndex] || slashCommands[0];
              if (selected) {
                applySlashCommand(selected);
                return;
              }
            }
            onSend();
          }}
          onKeyPress={handleKeyPress}
          returnKeyType="send"
          multiline
          maxLength={1000}
          onFocus={() => {
            if (blurTimeoutRef.current) {
              clearTimeout(blurTimeoutRef.current);
              blurTimeoutRef.current = null;
            }
            setFocused(true);
            setShowModelPicker(false);
            setShowQuickActions(false);
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => {
              setFocused(false);
              blurTimeoutRef.current = null;
            }, 120);
          }}
        />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <EnhancedSendInputButton onPress={() => onSend()} disabled={!canSend} accentColor={accentColor} />
        </Animated.View>
      </View>

      {showSlashCommands && (
        <View style={styles.slashCommandPopup}>
          <ChatSlashCommandPalette
            accentColor={accentColor}
            commands={slashCommands}
            highlightedIndex={highlightedSlashIndex}
            onHighlightIndexChange={setHighlightedSlashIndex}
            onSelect={applySlashCommand}
          />
        </View>
      )}
    </View>
  );
}

function EnhancedSendInputButton({ onPress, disabled, accentColor }: any) {
  const [hovered, setHovered] = useState(false);
  
  const buttonStyle = Platform.OS === 'web' ? {
    transform: hovered && !disabled ? 'scale(1.1)' : 'scale(1)',
    transition: 'all 0.2s ease',
    boxShadow: !disabled && hovered ? `0 4px 16px ${accentColor}40` : 'none',
  } as any : {};

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.enhancedSendButton,
        { backgroundColor: disabled ? '#222' : accentColor },
        buttonStyle,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.sendText, { color: disabled ? '#666' : '#000' }]}>↑</Text>
    </Pressable>
  );
}

// ─── Who's Building Banner ────────────────────────────────────────────────────
// Ambient live indicator: shows who's in a step-away session right now

const TOOL_COLORS: Record<string, string> = {
  'claude-code': '#f97316', 'cowork': '#3b82f6', 'openswan': '#a855f7',
  'codex': '#22c55e', 'gemini': '#22d3ee', 'cursor': '#ec4899', 'other': '#6366f1',
};
const TOOL_ICONS: Record<string, string> = {
  'claude-code': '💻', 'cowork': '💼', 'openswan': '🐾',
  'codex': '🧠', 'gemini': '♊', 'cursor': '🎯', 'other': '🤖',
};

function WhosBuildingBanner({ circleId, accentColor }: { circleId: string; accentColor: string }) {
  const [sessions, setSessions] = useState<{ userName: string; tool: string; elapsed: string }[]>([]);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 12 * 3600 * 1000).toISOString();
    const { data } = await supabase
      .from('messages')
      .select('content, user_id, created_at, user:profiles(display_name, username)')
      .eq('circle_id', circleId)
      .eq('is_bot', false)
      .gte('created_at', since)
      .order('created_at', { ascending: true });

    if (!data) return;
    const stepAways = data.filter(m => m.content?.includes('STEPPING AWAY'));
    const baks = new Set(
      data.filter(m => m.content?.includes('BACK AT KEYBOARD')).map(m => m.user_id)
    );
    // Find open sessions: step-away with no subsequent BAK
    const open: { userName: string; tool: string; elapsed: string }[] = [];
    const seen = new Set<string>();
    for (const m of [...stepAways].reverse()) {
      if (seen.has(m.user_id)) continue;
      seen.add(m.user_id);
      // Check if BAK was after this step-away
      const bakAfter = data.find(b =>
        b.user_id === m.user_id &&
        b.content?.includes('BACK AT KEYBOARD') &&
        b.created_at > m.created_at
      );
      if (!bakAfter) {
        const toolLine = m.content?.split('\n')[0] || '';
        let tool = 'other';
        if (toolLine.includes('Claude Code')) tool = 'claude-code';
        else if (toolLine.includes('Cowork')) tool = 'cowork';
        else if (toolLine.includes('OpenSwan')) tool = 'openswan';
        else if (toolLine.includes('Codex')) tool = 'codex';
        else if (toolLine.includes('Gemini')) tool = 'gemini';
        else if (toolLine.includes('Cursor')) tool = 'cursor';

        const ms = Date.now() - new Date(m.created_at).getTime();
        const mins = Math.floor(ms / 60000);
        const elapsed = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;
        const userName = (m as any).user?.display_name || (m as any).user?.username || '?';
        open.push({ userName, tool, elapsed });
      }
    }
    setSessions(open);
  }, [circleId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  if (sessions.length === 0) return null;

  return (
    <View style={warRoomBannerStyles.banner}>
      <Text style={warRoomBannerStyles.label}>⚡ Building now</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {sessions.map((s, i) => {
          const color = TOOL_COLORS[s.tool] || '#555';
          const icon = TOOL_ICONS[s.tool] || '🤖';
          return (
            <View key={i} style={[warRoomBannerStyles.chip, { borderColor: color + '55', backgroundColor: color + '11' }]}>
              <View style={[warRoomBannerStyles.dot, { backgroundColor: color }]} />
              <Text style={warRoomBannerStyles.chipText}>{icon} {s.userName}</Text>
              <Text style={warRoomBannerStyles.chipTime}>{s.elapsed}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const warRoomBannerStyles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    maxWidth: CHAT_SURFACE_MAX_WIDTH, alignSelf: 'center', width: '100%',
  },
  label: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { color: '#aaa', fontSize: 12, fontWeight: '600' },
  chipTime: { color: '#555', fontSize: 11 },
});

const checkInStyles = StyleSheet.create({
  panel: { backgroundColor: '#111', borderWidth: 1, borderRadius: 12, margin: 8, padding: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 13, fontWeight: '700' },
  close: { color: '#666', fontSize: 16, padding: 4 },
  input: { backgroundColor: '#000000', borderWidth: 1, borderRadius: 12, color: '#fff', fontSize: 13, padding: 10, minHeight: 60, textAlignVertical: 'top' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  charCount: { color: '#555', fontSize: 11 },
  submitBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
  submitText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checkboxBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#444', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkboxCheck: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: -1 },
  checkboxLabel: { color: '#888', fontSize: 11 },
});

// ─── Enhanced Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Core layout
  container: { flex: 1, backgroundColor: '#000000' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingPulse: { alignItems: 'center' },
  loadingText: { fontSize: 28, letterSpacing: 6, fontWeight: '800' },

  // Accent line
  accentLine: {
    height: 2,
    width: '100%',
  },

  // Welcome overlay
  welcomeOverlay: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  } as any,
  welcomeText: { fontSize: 18, fontWeight: '900', letterSpacing: 2 },
  welcomeSubtext: { color: '#666', fontSize: 12, marginTop: 4 },

  // Floating elements
  floatingEmoji: {
    position: 'absolute',
    left: 200,
    top: 300,
    zIndex: 5,
  } as any,
  floatingEmojiText: { fontSize: 24 },

  particleContainer: {
    position: 'absolute',
    zIndex: 5,
  } as any,
  particle: {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
  } as any,

  // Empty state
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, maxWidth: CHAT_SURFACE_MAX_WIDTH, alignSelf: 'center', width: '100%' },
  heroSection: { alignItems: 'center', justifyContent: 'center', paddingTop: 40, paddingBottom: 40 },
  heroSectionWeb: {},
  heroBotAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...(Platform.OS === 'web' ? { className: 'bot-float-anim' } as any : {}),
  } as any,
  heroBotEmoji: { fontSize: 36 },
  heroBotImage: { width: 140, height: 140 },
  heroTitle: { fontSize: 24, fontWeight: '900', letterSpacing: 4, marginBottom: 8 },
  heroSubtitle: { color: '#666', fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 360 },

  activityPulse: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { className: 'bot-pulse-anim' } as any : {}),
  } as any,
  activityText: { color: '#888', fontSize: 12, fontWeight: '600' },

  sectionLabel: { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
  soulActionSection: { marginBottom: 24 },
  soulModeLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  soulActionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  soulActionCard: {
    minWidth: 180,
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  soulActionTitle: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  soulActionPrompt: { color: '#94a3b8', fontSize: 11, lineHeight: 16 },

  // Enhanced prompts
  quickPromptSection: { marginBottom: 24 },
  quickPromptRow: { flexDirection: 'row', alignItems: 'center' },
  quickArrow: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#333333',
    alignItems: 'center', justifyContent: 'center',
  },
  quickArrowText: { fontSize: 18, fontWeight: '700', marginTop: -1 },
  quickPromptScroll: { flexDirection: 'row', gap: 12, paddingHorizontal: 8 },
  enhancedPromptCard: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
    position: 'relative',
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', whiteSpace: 'nowrap' } as any : {}),
  } as any,
  enhancedPromptText: { fontSize: 13, fontWeight: '600' },

  // Density toggle
  densityToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  densityButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  densityButtonText: { fontSize: 11, fontWeight: '700' },

  // Glassmorphism cards
  categorySection: { marginBottom: 24 },
  glassmorphismCard: {
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  categoryTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5 },
  categoryChevron: { fontSize: 14 },
  categoryPrompts: { borderTopWidth: 1, borderTopColor: '#00000020' },

  enhancedPromptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#0d0d0d',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  promptInfo: { flex: 1 },
  promptLabel: { fontSize: 14, fontWeight: '700' },
  promptDesc: { color: '#555', fontSize: 12, marginTop: 2 },
  promptArrow: { fontSize: 16, marginLeft: 8 },

  // Enhanced tips
  tipsSection: { marginBottom: 40 },
  enhancedTipCard: {
    flexDirection: 'row',
    backgroundColor: '#111111aa',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#00000060',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  tipAccent: { width: 3, height: '100%', borderRadius: 2, marginRight: 12 },
  tipText: { color: '#888', fontSize: 13, lineHeight: 18, flex: 1 },

  // Pinned messages
  pinnedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
    backgroundColor: '#0d0d0d',
  },
  pinnedBannerIcon: { fontSize: 14 },
  pinnedBannerText: { flex: 1, fontSize: 13, color: '#888', fontWeight: '600' },
  pinnedBannerChevron: { fontSize: 12, color: '#666' },
  pinnedList: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: '#0d0d0d', gap: 6 },
  pinnedItem: {
    backgroundColor: '#222222', borderRadius: 12, padding: 10,
    borderLeftWidth: 3, borderLeftColor: '#f59e0b',
    flexDirection: 'row', alignItems: 'center',
  },
  pinnedItemText: { fontSize: 13, color: '#ccc', lineHeight: 18 },
  pinnedItemMeta: { fontSize: 11, color: '#666', marginTop: 4 },

  // Proposal section
  proposalSection: {
    paddingHorizontal: 16, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  proposalSectionTitle: {
    fontSize: 11, fontWeight: '800', color: '#888',
    fontFamily: 'monospace', letterSpacing: 1.5,
  },
  moreProposals: { fontSize: 12, color: '#666', fontFamily: 'monospace', textAlign: 'center', paddingVertical: 4 },
  builderReopenBar: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    backgroundColor: '#060910',
  },
  builderReopenButton: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#243246',
    backgroundColor: '#0a1018',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  builderReopenButtonText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  builderModalScrim: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    paddingHorizontal: 14,
    paddingVertical: 18,
  },
  builderModalCard: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#04070d',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  builderModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#172033',
    backgroundColor: '#08111d',
  },
  builderModalTitle: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  builderModalCloseButton: {
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0c0c',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  builderModalCloseButtonText: {
    color: '#fca5a5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  liveMiniDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },

  chatSurfaceRow: {
    flex: 1,
    minHeight: 0,
  },
  chatSurfaceRowSplit: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  workbenchDivider: {
    width: 10,
    backgroundColor: '#0b1119',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'col-resize' } as any : {}),
  },
  workbenchDividerGrip: {
    width: 4,
    height: 48,
    borderRadius: 999,
    backgroundColor: '#334155',
  },
  workbenchSidecar: {
    minWidth: 0,
    backgroundColor: '#04070d',
    padding: 16,
    gap: 12,
  },
  workbenchSidecarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  workbenchSidecarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  workbenchSidecarLabel: {
    color: '#7f8ea3',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.1,
    fontFamily: 'monospace',
  },
  workbenchSidecarButton: {
    borderWidth: 1,
    borderColor: '#243246',
    backgroundColor: '#0a1018',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  workbenchSidecarButtonText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  workbenchCloseButton: {
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0c0c',
  },
  workbenchCloseButtonText: {
    color: '#fca5a5',
  },
  chatMainPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  messageListScroll: {
    flex: 1,
    minHeight: 0,
  },

  // Enhanced messages
  messageList: { padding: 16, maxWidth: CHAT_SURFACE_MAX_WIDTH, alignSelf: 'center', width: '100%', flexGrow: 1, paddingTop: 16 },
  enhancedMessageRow: {
    borderRadius: 12,
    padding: 8,
    marginHorizontal: -8,
    position: 'relative',
    overflow: 'visible',
    zIndex: 1,
  } as any,
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  enhancedMsgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2a2a2a',
  },
  msgAvatarMe: { backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' },
  msgAvatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  msgName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  msgTime: { color: '#444', fontSize: 11, marginLeft: 'auto' as any },

  msgContentWrap: { marginLeft: 46, position: 'relative' as any, overflow: 'visible' as any, zIndex: 1 },
  enhancedMsgBubble: {
    padding: 13,
    borderRadius: 20,
    backgroundColor: '#11111180',
    borderWidth: 2,
    borderColor: '#2a2a2a',
    ...(Platform.OS === 'web'
      ? { backdropFilter: 'blur(8px)' } as any
      : { shadowColor: '#000000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }),
  },
  messageRouteStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  messageRouteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 230,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  messageRouteChipLocal: {
    borderColor: '#22c55e45',
    backgroundColor: '#052e1628',
  },
  messageRouteChipModel: {
    borderColor: '#38bdf845',
    backgroundColor: '#082f4928',
  },
  messageRouteChipProvider: {
    borderColor: '#a78bfa45',
    backgroundColor: '#312e8128',
  },
  messageRouteChipLabel: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase' as any,
    fontFamily: 'monospace',
  },
  messageRouteChipValue: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
    maxWidth: 150,
  },
  messageRouteChipValueLocal: {
    color: '#86efac',
  },
  messageRouteChipValueModel: {
    color: '#bae6fd',
  },
  messageSourcesWrap: {
    marginTop: 10,
    gap: 10,
  },
  messageSourceSection: {
    gap: 6,
  },
  messageSourceLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  computerTaskSummaryLine: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  messageSourceCard: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  messageSourceTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  messageSourceMeta: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  messageSourceSubtitle: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
  },
  appChoiceSection: {
    marginBottom: 8,
  },
  appChoiceCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#14b8a655',
    backgroundColor: '#042f2e',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 6,
  },
  appChoiceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  appChoiceTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  appChoiceTitle: {
    color: '#ccfbf1',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  appChoicePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#5eead466',
    backgroundColor: '#0f766e40',
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 110,
    flexShrink: 0,
  },
  appChoicePillText: {
    color: '#ccfbf1',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
  },
  appChoiceMeta: {
    color: '#99f6e4',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  appChoiceReason: {
    color: '#d1fae5',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
    letterSpacing: 0,
  },
  appChoiceAlternativeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  appChoiceAlternative: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2dd4bf55',
    backgroundColor: '#0f172a',
    paddingHorizontal: 7,
    paddingVertical: 4,
    maxWidth: 150,
  },
  appChoiceAlternativeText: {
    color: '#a7f3d0',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  appChoiceHint: {
    color: '#99f6e4',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  designTaskSection: {
    marginBottom: 8,
  },
  designTaskCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#0ea5e966',
    backgroundColor: '#07111d',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 8,
  },
  designTaskCardAttention: {
    borderColor: '#f9731666',
    backgroundColor: '#1c1008',
  },
  designTaskCardApproval: {
    borderColor: '#eab30866',
    backgroundColor: '#171307',
  },
  designTaskCardComplete: {
    borderColor: '#22c55e66',
    backgroundColor: '#06170d',
  },
  designTaskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  designTaskTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  designTaskTitle: {
    color: '#e0f2fe',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
  },
  designTaskSubtitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
  },
  designTaskStatusPill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#38bdf866',
    backgroundColor: '#082f49',
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  designTaskStatusAttention: {
    borderColor: '#fb923c66',
    backgroundColor: '#431407',
  },
  designTaskStatusApproval: {
    borderColor: '#facc1566',
    backgroundColor: '#422006',
  },
  designTaskStatusComplete: {
    borderColor: '#4ade8066',
    backgroundColor: '#052e16',
  },
  designTaskStatusText: {
    color: '#f8fafc',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
  },
  designTaskMeta: {
    color: '#bae6fd',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  designTaskOperationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  designTaskOperationPill: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: '#0f172a',
    paddingHorizontal: 7,
    paddingVertical: 4,
    maxWidth: 150,
  },
  designTaskOperationText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  designTaskPhaseRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  designTaskPhaseItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 110,
    minWidth: 0,
  },
  designTaskPhaseDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#475569',
    flexShrink: 0,
  },
  designTaskPhaseDone: {
    backgroundColor: '#22c55e',
  },
  designTaskPhaseCurrent: {
    backgroundColor: '#38bdf8',
  },
  designTaskPhaseBlocked: {
    backgroundColor: '#fb923c',
  },
  designTaskPhaseLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0,
    flexShrink: 1,
  },
  designTaskPhaseLabelCurrent: {
    color: '#bae6fd',
  },
  designTaskPhaseLabelBlocked: {
    color: '#fed7aa',
  },
  designTaskNextAction: {
    color: '#f8fafc',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
  },
  designTaskProof: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  designTaskReview: {
    color: '#cbd5e1',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
  },
  recoveryOptionSection: {
    marginTop: 10,
    gap: 6,
  },
  recoveryReliabilitySection: {
    marginTop: 10,
    gap: 6,
  },
  recoveryReliabilityCard: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  recoveryReliabilityHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  recoveryReliabilityTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  recoveryReliabilityTitle: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  recoveryReliabilitySubtitle: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  recoveryReliabilityPill: {
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: '#020617',
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexShrink: 0,
  },
  recoveryReliabilityPillText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
  },
  recoveryReliabilityDetail: {
    color: '#d1d5db',
    fontSize: 11,
    lineHeight: 15,
  },
  recoveryReliabilityChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  recoveryReliabilityChip: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: 160,
  },
  recoveryReliabilityChipText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0,
  },
  recoveryOptionCard: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  recoveryOptionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  recoveryOptionTitleWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  recoveryOptionTitle: {
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  recoveryOptionMeta: {
    color: '#94a3b8',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  recoveryOptionDetail: {
    color: '#d1d5db',
    fontSize: 11,
    lineHeight: 15,
  },
  recoveryOptionPlan: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  recoveryOptionButton: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 5,
    minWidth: 42,
    alignItems: 'center',
  },
  recoveryOptionButtonText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  memoryInfluenceCard: {
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  memoryInfluenceCardSoul: {
    borderColor: '#4f46e5',
    backgroundColor: '#312e8120',
  },
  memoryInfluenceTitle: {
    color: '#c7d2fe',
    fontSize: 11,
    fontWeight: '800',
  },
  memoryGroupSection: {
    gap: 6,
  },
  memoryGroupLabel: {
    color: '#7dd3fc',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase' as any,
  },
  memoryChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  memoryInfluenceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3730a3',
    backgroundColor: '#312e8120',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  memoryInfluenceChipText: {
    color: '#c7d2fe',
    fontSize: 10,
    fontWeight: '700',
  },
  memoryActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  memoryActionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1220',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  memoryActionButtonText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  memoryForgetButton: {
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0c0c',
  },
  memoryForgetButtonText: {
    color: '#fca5a5',
  },
  soulLearningRail: {
    marginHorizontal: 12,
    marginTop: 10,
    marginBottom: 6,
    gap: 8,
  },
  soulLearningHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  soulLearningLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase' as any,
  },
  soulLearningLink: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  soulLearningLinkText: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  soulLearningScroll: {
    gap: 8,
    paddingRight: 12,
  },
  soulLearningCard: {
    width: 220,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 3,
  },
  soulLearningCardTitle: {
    fontSize: 11,
    fontWeight: '800',
  },
  soulLearningCardMeta: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  soulLearningCardSubtitle: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 15,
  },
  soulMemoryCard: {
    borderColor: '#4338ca',
    backgroundColor: '#1e1b4b',
  },
  soulMemoryCardTitle: {
    color: '#c7d2fe',
    fontSize: 11,
    fontWeight: '800',
  },
  // Enhanced hover actions
  enhancedHoverActions: {
    position: 'absolute',
    top: -25,
    right: 0,
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 4,
    gap: 2,
    zIndex: 10,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' } as any : {}),
  },
  hoverBtn: {
    width: 32,
    height: 30,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.2s' } as any : {}),
  },
  hoverBtnText: { fontSize: 14 },
  hoverDivider: { width: 1, height: 22, alignSelf: 'center', marginHorizontal: 4 },

  // Enhanced reactions
  enhancedReactionPicker: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 46,
    marginTop: 8,
    borderRadius: 12,
    padding: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    backgroundColor: '#111111cc',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } as any : {}),
  },
  reactionPickerItem: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s' } as any : {}),
  },
  reactionPickerEmoji: { fontSize: 18 },

  reactionRow: { flexDirection: 'row', gap: 6, marginLeft: 46, marginTop: 8, flexWrap: 'wrap' },
  enhancedReactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#111111aa',
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s', backdropFilter: 'blur(6px)' } as any : {}),
  },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 12, fontWeight: '700' },

  // Special effects
  specialMessageGlow: {
    position: 'absolute',
    inset: -4,
    borderRadius: 16,
    pointerEvents: 'none',
    ...(Platform.OS !== 'web' ? { shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 } : {}),
  } as any,

  // Reply indicator
  replyIndicator: { flexDirection: 'row', alignItems: 'center', marginLeft: 46, marginBottom: 6, gap: 8 },
  replyIndicatorAccent: { width: 3, height: 16, borderRadius: 2 },
  replyIndicatorName: { fontSize: 12, fontWeight: '700' },
  replyIndicatorText: { color: '#555', fontSize: 12, flex: 1 },

  // Enhanced UI components
  enhancedQuickBar: {
    borderTopWidth: 1,
    maxWidth: CHAT_SURFACE_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
    backgroundColor: '#000000cc',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } as any : {}),
  },
  quickBarScroll: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  enhancedQuickChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    flexShrink: 0,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s' } as any : {}),
  },
  quickBarChipText: { fontSize: 11, fontWeight: '700' },

  // Scroll arrows for quick bar
  scrollArrow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 28,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  scrollArrowLeft: {
    left: 0,
    backgroundColor: '#000000f0',
    borderRightWidth: 1,
    borderRightColor: '#ffffff10',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },
  scrollArrowRight: {
    right: 0,
    backgroundColor: '#000000f0',
    borderLeftWidth: 1,
    borderLeftColor: '#ffffff10',
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  scrollArrowText: {
    color: '#888',
    fontSize: 22,
    fontWeight: '700',
  },

  // Enhanced crypto panel
  enhancedCryptoPanel: {
    backgroundColor: '#000000f0',
    borderTopWidth: 1,
    padding: 20,
    maxWidth: CHAT_SURFACE_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
  },
  cryptoPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cryptoPanelTitle: { fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  cryptoPanelClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cryptoPanelCloseText: { color: '#666', fontSize: 16, fontWeight: '700' },

  // Enhanced wallet options
  walletSelector: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  enhancedWalletOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  walletOptionIcon: { fontSize: 24 },
  walletOptionInfo: { flex: 1 },
  walletOptionName: { fontSize: 14, fontWeight: '700' },
  walletOptionChain: { color: '#444', fontSize: 11, marginTop: 2 },
  walletActiveDot: { width: 10, height: 10, borderRadius: 5 },
  walletDisconnectBtn: {
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 16,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  walletDisconnectText: { color: '#ef4444', fontSize: 12, fontWeight: '600' },

  // Enhanced form inputs
  cryptoLabel: { color: '#666', fontSize: 11, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  enhancedCryptoInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 14,
    backgroundColor: '#111111aa',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', backdropFilter: 'blur(8px)', transition: 'all 0.2s' } as any : {}),
  },

  // Enhanced member picker
  memberPickScroll: { marginBottom: 14, marginTop: -6 },
  memberPickRow: { flexDirection: 'row', gap: 8 },
  enhancedMemberPickChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#111111aa',
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s', backdropFilter: 'blur(6px)' } as any : {}),
  },
  memberPickText: { fontSize: 12, fontWeight: '600' },

  // Enhanced transaction preview
  cryptoAmountRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  cryptoQuickAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 6 },
  cryptoQuickBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#111111aa',
    borderWidth: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', backdropFilter: 'blur(6px)' } as any : {}),
  },
  cryptoQuickBtnText: { fontSize: 12, fontWeight: '700' },

  enhancedTxPreview: {
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    marginBottom: 16,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  txPreviewText: { color: '#aaa', fontSize: 14, textAlign: 'center' },
  txPreviewBold: { fontWeight: '700' },

  enhancedSendButton: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s' } as any : {}),
  },
  cryptoSendBtnText: { fontSize: 14, fontWeight: '800', letterSpacing: 2 },

  // Enhanced mention popup
  enhancedMentionPopup: {
    borderWidth: 1,
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 6,
    maxWidth: CHAT_SURFACE_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000000f5',
  },
  enhancedMentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#00000060',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.2s' } as any : {}),
  },
  mentionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mentionAvatarText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  mentionName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  mentionHandle: { color: '#555', fontSize: 12 },
  mentionBotBadge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  mentionBotBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  // Enhanced reply bar
  enhancedReplyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    backgroundColor: '#000000f0',
    maxWidth: CHAT_SURFACE_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
    gap: 12,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } as any : {}),
  },
  replyBarAccent: { width: 4, height: 28, borderRadius: 2 },
  replyBarContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  replyBarLabel: { color: '#666', fontSize: 12 },
  replyBarName: { fontSize: 12, fontWeight: '700' },
  replyBarClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  replyBarCloseText: { color: '#666', fontSize: 16, fontWeight: '700' },

  // Enhanced typing indicator
  typingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    maxWidth: CHAT_SURFACE_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
    borderTopWidth: 1,
    backgroundColor: '#000000f0',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  typingDot: { width: 10, height: 10, borderRadius: 5 },
  typingText: { color: '#666', fontSize: 12, fontStyle: 'italic' },
  typingDotsText: { fontSize: 16, color: '#666' },
  // Enhanced input
  enhancedInputBar: {
    borderTopWidth: 1,
    padding: 16,
    backgroundColor: '#000000f5',
    maxWidth: CHAT_SURFACE_MAX_WIDTH,
    alignSelf: 'center',
    width: '100%',
    gap: 10,
    position: 'relative',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } as any : {}),
  },
  composerToolbar: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#0a0a10',
  },
  modelIconBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modelIconText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  modelButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    maxWidth: 160,
    flexShrink: 1,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    letterSpacing: 0,
  },
  modelChevron: {
    fontSize: 8,
    color: '#606075',
    marginLeft: 2,
  },
  quickActionsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0a0f1c',
  },
  quickActionsIcon: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  quickActionsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    letterSpacing: 0,
  },
  dropdownPanel: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 6,
    width: 240,
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 6,
    zIndex: 100,
    maxHeight: 420,
    ...(Platform.OS === 'web' ? { overflowY: 'auto', boxShadow: '4px 4px 0px rgba(99,102,241,0.05), 0 12px 40px rgba(0,0,0,0.6)' } as any : {}),
  },
  dropdownPanelWide: {
    width: 300,
    maxHeight: 500,
  },
  providerBrowserDropdown: {
    width: 440,
    maxHeight: 560,
    paddingVertical: 0,
  },
  providerBrowserPanel: {
    padding: 12,
    gap: 10,
  },
  providerBrowserHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  providerBrowserTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  providerBrowserSubtitle: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  providerBrowserClose: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerBrowserCloseText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  providerBrowserNotice: {
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  providerBrowserNoticeText: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },
  providerBrowserSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#020617',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  providerBrowserSearchIcon: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  providerBrowserSearchInput: {
    flex: 1,
    color: '#e2e8f0',
    fontSize: 13,
    padding: 0,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  providerBrowserList: {
    maxHeight: 400,
  },
  providerBrowserEmpty: {
    color: '#64748b',
    fontSize: 12,
    paddingVertical: 18,
    textAlign: 'center',
  },
  providerBrowserModelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#111827',
    backgroundColor: '#020617',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 6,
  },
  providerBrowserModelIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerBrowserModelIconText: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  providerBrowserModelName: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '800',
  },
  providerBrowserModelMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  dropdownPanelControlCenter: {
    width: 380,
    maxHeight: 540,
  },
  dropdownTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#64748b',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  actionsAccordionScroll: {
    maxHeight: 460,
  },
  actionsAccordionContent: {
    paddingBottom: 6,
  },
  actionsAccordionSection: {
    paddingHorizontal: 6,
  },
  actionsAccordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 8,
  },
  actionsAccordionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0,
    textTransform: 'none',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  actionsAccordionChevron: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  actionsAccordionBody: {
    gap: 1,
    paddingBottom: 4,
  },
  featuredQuickActions: {
    paddingHorizontal: 6,
    paddingBottom: 2,
    gap: 1,
  },
  featuredQuickActionItem: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  featuredQuickActionText: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginHorizontal: 2,
  },
  controlCenterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 10,
  },
  controlCenterCard: {
    width: '46.5%',
    minHeight: 64,
    borderRadius: 10,
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
  },
  controlCenterCardHover: {
    borderColor: '#334155',
    backgroundColor: '#111827',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px rgba(99,102,241,0.08), 0 8px 20px rgba(0,0,0,0.4)', transform: 'translateY(-1px)' } as any : {}),
  },
  controlCenterStatusBand: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#232336',
    backgroundColor: '#111521',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  controlCenterStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  controlCenterStatusLabel: {
    color: '#7c8aa5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.9,
    fontFamily: 'monospace',
  },
  controlCenterStatusValue: {
    color: '#e5eefc',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  controlCenterStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  controlCenterStatPill: {
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#232336',
    backgroundColor: '#10131c',
    alignItems: 'center',
    gap: 2,
  },
  controlPanelPrimaryAction: {
    marginHorizontal: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: '#10131c',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  controlPanelPrimaryTitle: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  controlPanelPrimaryDesc: {
    color: '#7c8aa5',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  controlPanelPrimaryArrow: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '900',
  },
  controlRouteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  controlRouteCard: {
    width: '47.5%',
    minHeight: 58,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  controlRouteLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
  },
  controlRouteDesc: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 13,
    marginTop: 3,
  },
  controlAgentSection: {
    marginHorizontal: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#232336',
    backgroundColor: '#0b1220',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  controlAgentSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlAgentSectionTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
  },
  controlAgentSectionMeta: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  controlAgentRail: {
    gap: 8,
    paddingRight: 6,
  },
  controlAgentCard: {
    width: 128,
    minHeight: 118,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: 'space-between',
  },
  controlAgentCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  controlAgentIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlAgentIconText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  controlAgentName: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 8,
  },
  controlAgentDesc: {
    color: '#7c8aa5',
    fontSize: 10,
    lineHeight: 13,
    marginTop: 4,
  },
  controlAgentStatus: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
    marginTop: 6,
  },
  controlAgentSelectedLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  controlAdvancedToggle: {
    marginHorizontal: 10,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#232336',
    backgroundColor: '#0b1220',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  controlAdvancedToggleText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
  },
  controlCenterStatValue: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  controlCenterStatLabel: {
    color: '#7c8aa5',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  controlCenterModeText: {
    flex: 1,
    alignItems: 'flex-start',
  },
  controlCenterModeLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f0f0f5',
    textAlign: 'left',
  },
  controlCenterModeDesc: {
    fontSize: 11,
    color: '#606075',
    marginTop: 1,
    textAlign: 'left',
  },
  dropdownItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropdownItemIconText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  dropdownItemText: {
    flex: 1,
    alignItems: 'flex-start',
  },
  dropdownItemLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  dropdownItemDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  dropdownActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#1e293b',
    marginVertical: 4,
    marginHorizontal: 12,
  },
  dropdownCategoryTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
    textTransform: 'uppercase',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  dropdownActionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  globalDropOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 500,
    backgroundColor: 'rgba(2, 6, 23, 0.68)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  globalDropCard: {
    minWidth: 320,
    maxWidth: 520,
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#22d3ee',
    backgroundColor: 'rgba(8, 15, 28, 0.92)',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '0 16px 60px rgba(34, 211, 238, 0.18)', backdropFilter: 'blur(10px)' } as any : {}),
  },
  globalDropTitle: {
    color: '#22d3ee',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  globalDropSubtitle: {
    marginTop: 8,
    color: '#cbd5e1',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  enhancedInputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#111111aa',
    borderRadius: 16,
    borderWidth: 1,
    paddingLeft: 8,
    paddingRight: 8,
    paddingVertical: 8,
    gap: 8,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  slashCommandPopup: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 88,
    zIndex: 120,
  },
  predictiveCommandPanel: {
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#08111f',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    ...(Platform.OS === 'web' ? { boxShadow: '0 10px 28px rgba(0,0,0,0.28)' } as any : {}),
  },
  predictiveCommandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
    gap: 8,
  },
  predictiveCommandTitle: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  predictiveCommandSubtitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  predictiveCommandRow: {
    flexDirection: 'row',
    gap: 8,
    paddingRight: 2,
  },
  predictiveCommandChip: {
    width: 210,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  predictiveCommandAppDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  predictiveCommandLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  predictiveCommandHint: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
  },
  predictiveCommandSource: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  mainChatAgentIdentityPressable: {
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainChatIdentityChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#14141c',
  },
  mainChatIdentityChipText: {
    color: '#8c8ca3',
    fontSize: 8,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.6,
  },
  mainChatAgentIdentityIcon: {
    width: 18,
    height: 18,
  },
  mainChatAgentMessageIcon: {
    width: 18,
    height: 18,
  },
  mainChatAgentComposerIcon: {
    width: 18,
    height: 18,
  },
  mainChatAgentMentionIcon: {
    width: 16,
    height: 16,
  },
  enhancedBotTrigger: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  botTriggerText: { fontSize: 18 },
  enhancedInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendText: { fontSize: 20, fontWeight: '800' },

  // Attachment styles
  attachmentStrip: {
    maxHeight: 72,
  },
  attachmentStripContent: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  attachmentThumb: {
    width: 58,
    alignItems: 'center',
    position: 'relative',
  },
  attachmentImage: {
    width: 52,
    height: 52,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#111118',
  },
  attachmentFileIcon: {
    width: 52,
    height: 52,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#111118',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachmentFileIconText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#a0a0b0',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  attachmentRemove: {
    position: 'absolute',
    top: -4,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#ef4444',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  attachmentRemoveText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#fff',
    lineHeight: 12,
  },
  attachmentLabel: {
    fontSize: 9,
    color: '#606075',
    marginTop: 2,
    textAlign: 'center',
    maxWidth: 56,
  },
});

// Add keyframes + animation classes for web
if (Platform.OS === 'web') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes float {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-10px); }
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .bot-float-anim { animation: float 3s ease-in-out infinite; }
    .bot-pulse-anim { animation: pulse 2s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}
