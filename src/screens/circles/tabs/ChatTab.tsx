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
  tryHandleLocalSwanBotCommand,
} from '../../../lib/swanbot';
import {
  getConnectedWallet, connectWallet, sendETH, sendSOL, disconnectWallet,
  shortenAddress, getExplorerUrl, WalletInfo, getMemberByUsername,
  getAllWalletStates, CryptoChain,
} from '../../../lib/crypto';
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
import { parseMultiAgentRequest, makeAliasResolver, BLACKSWAN_ALIASES } from '../../../lib/multiAgentDispatch';
import SearchResultsCard, { type SearchResultRow } from './chat/SearchResultsCard';
import CommandsHelpCard from './chat/CommandsHelpCard';
import AssignPickerCard, { type AssignPickerAgent } from './chat/AssignPickerCard';
import RunCostDrawer from './chat/RunCostDrawer';
import SkillAdminPanel from './chat/SkillAdminPanel';
import SpawnAgentsModal from './chat/SpawnAgentsModal';
import { createStagedFile, revokeStagedPreviews, uploadAttachment, type StagedFile } from '../../../lib/chatAttachments';
import { soulKeyForProfile } from '../../../lib/serviceProfileSouls';
import { dispatchBridgeTask, wakeAndAssignTask } from '../../../lib/bridgeTaskDispatcher';
import SpawnAgentPanel from '../../../components/SpawnAgentPanel';
import { storage } from '../../../lib/storage';
import ProposalCard from '../../../components/ProposalCard';
import StepAwayCard from '../../../components/StepAwayCard';
import { Proposal, PinnedMessage } from '../../../types';
import { executeAgentRun, detectHandoff, HandoffSuggestion } from '../../../lib/agentRuntime';
import HandoffCard from '../../../components/agent/HandoffCard';
import AgentModeSelector from '../../../components/agent/AgentModeSelector';
import AddModelPanel from '../../../components/models/AddModelPanel';
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
import ComputerUsePermissionDialog from '../../../components/computer-use/ComputerUsePermissionDialog';
import ComputerUseButton from '../../../components/computer-use/ComputerUseButton';
import ComputerUseLiveCard from '../../../components/ComputerUseLiveCard';
import AnimatedPopup from '../../../components/chat-animations/AnimatedPopup';
import ThinkingDots from '../../../components/chat-animations/ThinkingDots';
import ThinkingLabel from '../../../components/chat-animations/ThinkingLabel';
import { pickThinkingVerb } from '../../../lib/thinkingVerbs';
import ComputerUseConsole from '../../../components/computer-use/ComputerUseConsole';
import ChatCostFooter from '../../../components/ChatCostFooter';
import DesktopBridgeStatusChip from '../../../components/DesktopBridgeStatusChip';
import RunApprovalBanner from '../../../components/RunApprovalBanner';
import RecordingBadge from '../../../components/RecordingBadge';
import OpenSwanConsole from '../../../components/openswan/OpenSwanConsole';
import { useComputerUseTask } from '../../../lib/useComputerUseTask';
import { resolveComputerUseConfirmation } from '../../../lib/computerUseConfirmations';
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
import RunExecutionCard from '../../../components/chat/RunExecutionCard';
import RunHistoryDrawer from '../../../components/chat/RunHistoryDrawer';
import ChatSlashCommandPalette from '../../../components/chat/ChatSlashCommandPalette';
import { buildOpenSwanExecutionStream, type OpenSwanExecutionContract } from '../../../lib/openswanExecution';
import {
  clearChatAgentAvatar,
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
} from '../../../lib/chatAgentIdentity';
import {
  buildChatInfluenceReferences,
  persistMainChatBotMessageWithRetry,
  updateMainChatBotMessageWithRetry,
} from '../../../lib/chatAgentService';
import { buildChatAutomationPlan, type ChatAutomationPlan } from '../../../lib/chatAutomationPlanner';
import { dispatchChatAutomationPlan } from '../../../lib/runChatAutomationPlan';
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
import { getAgentIdentityKey, loadAgentIdentities } from '../../../lib/agentIdentity';
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

/**
 * Loose detector for messages that probably need tool use.
 *
 * When the user says things like "create a room", "pause the automation",
 * "update the circle theme", the chat flow needs to fall through to the
 * `runOpenSwanSessionTurn` path (which enables the tool catalog). The
 * streaming fast-path has NO tools — so without this detector, BlackSwan
 * replies "I can't create rooms" even though it has the tool.
 *
 * Matches action-verb + app-noun pairs. False positives are cheap
 * (they just forgo streaming for one turn). False negatives are bad
 * (tools don't get called) so the regex is deliberately permissive.
 */
const ACTION_INTENT_RE = /\b(create|make|add|new|start|rename|archive|unarchive|update|change|edit|set|toggle|pause|resume|raise|lower|bump|assign|unassign|remove|delete|pin|unpin|forget|log|mark|complete|switch|connect|disconnect|list|show|post|send)\b[^\n]{0,60}?\b(room|rooms|circle|agent|agent'?s?|mission|missions|task|tasks|memory|memories|automation|automations|automations?|check[\s-]?in|check[\s-]?ins|budget|cap|caps|theme|setting|settings|name|description|icon|vibe|spirit|appearance|public|private|accent|schedule|integration|integrations)\b/i;

function looksLikeActionRequest(message: string): boolean {
  return ACTION_INTENT_RE.test(message);
}
import { runOpenSwanSessionTurn, type OpenSwanDelegatedAgentDescriptor } from '../../../lib/openswanSessionRuntime';
import type { OpenSwanTaskPlan } from '../../../lib/openswanTaskPlanner';
import type { OpenSwanToolEvent } from '../../../lib/openswanToolRuntime';
import { getSelectableChatModes } from '../../../lib/openswanModePolicy';
import {
  executeOpenSwanVerificationCheck,
  type OpenSwanVerificationResult,
  upsertOpenSwanVerificationResult,
} from '../../../lib/openswanVerificationRuntime';
import { addArtifact, appendRunBrowserPlanEvent, appendRunToolEvent, mergeRunMetadata } from '../../../lib/agentRunSystem';
import { getMainChatSessionActions } from '../../../lib/sessionPromptCatalog';
import { auditComputerCapabilities } from '../../../lib/computerCapabilityRegistry';
import { prepareComputerTaskExecution } from '../../../lib/computerTaskExecution';
import { executeComputerTaskWithAgent } from '../../../lib/computerTaskRuntime';
import { deriveGrantedScopesFromBrowserPermission, grantComputerTaskScopes, loadComputerTaskGrantIds } from '../../../lib/computerTaskGrantMemory';
import { buildComputerTaskStateSteps, clearComputerTaskState, loadComputerTaskState, saveComputerTaskState, type ComputerTaskStateRecord } from '../../../lib/computerTaskState';
import {
  appendChatSessionArchiveEvent,
  clearChatSessionArchive,
  formatChatSessionArchiveBlock,
  loadChatSessionArchive,
  upsertChatSessionArchiveMessage,
} from '../../../lib/chatSessionArchive';
import { clearPendingBotMessages } from '../../../lib/pendingBotMessages';

const REACTIONS_LIST = ['🔥', '💪', '👊', '💯', '⚡', '🎯'];
const BLACKSWAN_ID = 'blackswan';
const LOGIN_NEON = '#b8ff61';
const CHAT_SURFACE_MAX_WIDTH = 1680;
const SESSION_FALLBACK_TITLE = 'OpenSwan Session';
const DEFAULT_CHAT_MODEL = 'claude-sonnet-4-6';
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
  source?: 'db' | 'openswan-session' | 'bridge-session' | 'default';
};

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
      executionStream: metadata?.executionStream,
      browserPlans: metadata?.browserPlans,
      browserPlanEvents: metadata?.browserPlanEvents,
      browserSessions: metadata?.browserSessions,
      ...deriveChatActivityFlags(row.content),
    };
  });
}

// ─── Types ───────────────────────────────────────────────────────────────────

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
  executionStream?: OpenSwanExecutionContract[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  delegatedTo?: string;       // subagent that handled this message
  delegatedSubagents?: string[];
  runId?: string | null;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
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
  isPending?: boolean;
};

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

export default function ChatTab({ circleId, accentColor = '#6366f1' }: { circleId: string; accentColor?: string }) {
  const navigation = useNavigation<any>();
  const { width: viewportWidth } = useWindowDimensions();
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
  const [sessionProfile, setSessionProfile] = useState<SessionCodingProfile>('auto');
  const [sessionDelegationMode, setSessionDelegationMode] = useState<SessionDelegationMode>('auto');
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
  const [agentName, setAgentNameState] = useState<string>(MAIN_CHAT_AGENT_NAME);
  const [editingAgentName, setEditingAgentName] = useState(false);
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const [agentAvatarUri, setAgentAvatarUri] = useState<string | null>(null);
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
  const [selectedAgent, setSelectedAgent] = useState<AssignableAgent | null>(null);
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
  const [pendingComputerUseGrantIds, setPendingComputerUseGrantIds] = useState<Array<'browser_navigation' | 'browser_side_effect' | 'file_read' | 'file_write' | 'app_read' | 'app_action' | 'mcp_tool' | 'bridge_tool'>>([]);
  const [pendingComputerUseOrigin, setPendingComputerUseOrigin] = useState<{ messageId: string; runId?: string | null; planId: string } | null>(null);
  const [computerTaskState, setComputerTaskState] = useState<ComputerTaskStateRecord | null>(null);
  // Real Computer Use agent (Opus 4.7 + Browserbase via edge function). The
  // permission dialog's Allow handler hands a task to this hook, which
  // streams reasoning/actions/screenshots into ComputerUseLiveCard below.
  const computerUseTask = useComputerUseTask(circleId);
  const computerUsePostedKeyRef = useRef<string | null>(null);
  // Use Computer console — the pop-up that collects the task before
  // planning. Opens from the Quick Actions "Use Computer" chip and from
  // the __COMPUTER_USE__ slash action.
  const [showComputerUseConsole, setShowComputerUseConsole] = useState(false);
  // OpenSwan console — launches an OpenSwan turn with a chosen mode.
  // Surface triggered by the Quick Actions "OS OpenSwan" chip.
  const [showOpenSwanConsole, setShowOpenSwanConsole] = useState(false);

  const persistComputerTaskState = useCallback(async (args: {
    task: string;
    taskKind: string;
    taskLabel: string;
    phase: 'planning' | 'awaiting_approval' | 'executing' | 'completed' | 'failed' | 'blocked';
    adapterId?: string | null;
    blockers?: string[];
    nextSteps?: string[];
    grantedAccess?: string[];
    accessPlan?: string | null;
    runId?: string | null;
    sessionId?: string | null;
    liveUrl?: string | null;
  }) => {
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
        args.phase === 'planning' ? 'Plan task'
          : args.phase === 'awaiting_approval' ? 'Approve access'
            : args.phase === 'executing' ? 'Execute task'
              : args.phase === 'completed' ? 'Summarize result'
                : args.phase === 'blocked' ? 'Resolve blocker'
                  : 'Task failed',
      steps: buildComputerTaskStateSteps({
        taskKind: args.taskKind,
        phase: args.phase,
      }),
      blockers: (args.blockers || []).filter(Boolean).slice(0, 5),
      nextSteps: (args.nextSteps || []).filter(Boolean).slice(0, 5),
      grantedAccess: (args.grantedAccess || []).filter(Boolean).slice(0, 8),
      accessPlan: args.accessPlan || null,
      runId: args.runId || null,
      sessionId: args.sessionId || null,
      liveUrl: args.liveUrl || null,
      updatedAt: new Date().toISOString(),
    };
    setComputerTaskState(nextState);
    await saveComputerTaskState(nextState);
  }, [activeThreadId, circleId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await loadComputerTaskState(circleId, activeThreadId).catch(() => null);
      if (!cancelled) setComputerTaskState(existing);
    })();
    return () => { cancelled = true; };
  }, [activeThreadId, circleId]);

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

  const loadSessionArchiveContext = useCallback(async () => {
    if (!circleId) return null;
    const archive = await loadChatSessionArchive(circleId, activeThreadId).catch(() => null);
    return formatChatSessionArchiveBlock(archive, {
      maxMessages: 10,
      maxEvents: 12,
      maxTouched: 24,
      maxChars: 3200,
    });
  }, [activeThreadId, circleId]);

  const executeSharedComputerTask = useCallback(async (taskText: string, options?: { planPrefix?: string }) => {
    const trimmed = taskText.trim();
    if (!trimmed) return;
    const audit = await auditComputerCapabilities(circleId).catch(() => null);
    const grantedIds = await loadComputerTaskGrantIds(circleId).catch(() => []);
    const execution = prepareComputerTaskExecution({ task: trimmed, audit, grantedIds });
    await persistComputerTaskState({
      task: trimmed,
      taskKind: execution.preview.kind,
      taskLabel: execution.preview.label,
      phase: 'planning',
      adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
      grantedAccess: execution.grants.granted,
      accessPlan: execution.grants.summary,
      blockers: execution.readiness.ready ? [] : [execution.readiness.summary],
      nextSteps: execution.entrypoint === 'browser_runtime'
        ? ['Review the access plan', 'Approve browser access if the task looks right']
        : ['Run the best available computer surface', 'Review the result and blockers'],
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

    setBotTyping(true);
    setRunStatus('running');
    try {
      const outcome = await dispatchChatAutomationPlan(computerPlan, {
        ctx: {
          circleId,
          userId: currentUserId || 'anonymous',
          threadId: activeThreadId || undefined,
          model: selectedModel !== 'auto' ? selectedModel : null,
          chatMode: planActMode,
          extras: {
            audit,
          },
        },
        handlers: {
          run_computer_task: async () => {
            if (execution.entrypoint === 'browser_runtime') {
              const plan = await describeComputerUsePlan({ task: trimmed, circleId, agentName });
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
                  grantSummary: execution.grants.summary,
                  approvalSummary: execution.grants.approvalSummary,
                  grantIds: execution.grants.outstanding.map((grant) => grant.id),
                  browserPlan: planCard,
                  browserActions: plan.actions,
                },
              };
            }

            const result = await executeComputerTaskWithAgent({
              task: trimmed,
              circleId,
              userId: currentUserId || 'anonymous',
              userName: currentUserName,
              model: selectedModel !== 'auto' ? selectedModel : undefined,
              audit,
              grantedIds,
              chatHistory: messages.slice(-10).map((m) => `${m.isBot ? agentName : (m.userName || 'User')}: ${m.content}`).join('\n'),
              sessionArchiveContext: await loadSessionArchiveContext() || undefined,
              replyTo: replyTo?.content,
            });

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
                grantSummary: result.execution.grants.summary,
                approvalSummary: result.execution.grants.approvalSummary,
                grantIds: result.execution.grants.outstanding.map((grant) => grant.id),
                handoffSuggestion: result.handoffSuggestion || null,
              },
            };
          },
        },
        onOutcome: attachPlanDecisionToRun,
      });

      const prefix = outcome.data?.taskLabel
        ? `**Use Computer** routed as ${String(outcome.data.taskLabel).toLowerCase()}.\n\n`
        : '**Use Computer**\n\n';
      const grantSummary = typeof outcome.data?.grantSummary === 'string' ? outcome.data.grantSummary : '';
      const approvalSummary = typeof outcome.data?.approvalSummary === 'string' ? outcome.data.approvalSummary : '';
      const grantIds = Array.isArray(outcome.data?.grantIds)
        ? outcome.data.grantIds as Array<'browser_navigation' | 'browser_side_effect' | 'file_read' | 'file_write' | 'app_read' | 'app_action' | 'mcp_tool' | 'bridge_tool'>
        : [];
      const browserPlan = outcome.data?.browserPlan as BrowserPlanCardData | undefined;
      const browserActions = outcome.data?.browserActions as BrowserAction[] | undefined;
      const handoff = outcome.data?.handoffSuggestion as HandoffSuggestion | undefined;
      if (browserPlan && browserActions) {
        setPendingComputerUseTask(trimmed);
        setPendingComputerUsePlan(browserPlan);
        setPendingComputerUseActions(browserActions);
        setPendingComputerUseGrantSummary(grantSummary);
        setPendingComputerUseApprovalSummary(approvalSummary);
        setPendingComputerUseGrantIds(grantIds);
        setPendingComputerUseOrigin(null);
        setShowComputerUsePermission(true);
        const accessBlock = grantSummary
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
          nextSteps: ['Approve the task to start browser execution'],
          blockers: approvalSummary ? [approvalSummary] : [],
        });
        recordSessionArchiveEvent({
          kind: 'computer_task',
          summary: `Computer task awaiting approval: ${trimmed}`,
          touched: ['surface:computer_use', 'surface:browser', `computer_task:${trimmed}`],
          metadata: {
            adapterId: String(outcome.data?.adapterId || 'browser_adapter'),
            grantSummary: grantSummary || execution.grants.summary,
            approvalSummary: approvalSummary || null,
          },
        });
        addBotMessage(`${prefix}${outcome.message}${accessBlock}`, undefined, { runId: outcome.runId || null, browserPlans: [browserPlan] });
      } else {
        const accessBlock = grantSummary
          ? `\n\n${grantSummary}${approvalSummary ? `\n${approvalSummary}` : ''}`
          : '';
        const warningBlock = outcome.warnings?.length
          ? `\n\n${outcome.warnings.map((warning) => `- ${warning}`).join('\n')}`
          : '';
        await persistComputerTaskState({
          task: trimmed,
          taskKind: String(outcome.data?.taskKind || execution.preview.kind),
          taskLabel: String(outcome.data?.taskLabel || execution.preview.label),
          phase: outcome.warnings?.length ? 'blocked' : 'completed',
          adapterId: typeof outcome.data?.adapterId === 'string' ? outcome.data.adapterId : null,
          runId: outcome.runId || null,
          grantedAccess: execution.grants.granted,
          accessPlan: grantSummary || execution.grants.summary,
          blockers: outcome.warnings || [],
          nextSteps: handoff ? [handoff.title] : [],
        });
        recordSessionArchiveEvent({
          kind: 'computer_task',
          summary: outcome.warnings?.length
            ? `Computer task blocked: ${trimmed}`
            : `Computer task completed without browser runtime: ${trimmed}`,
          touched: ['surface:computer_use', `computer_task:${trimmed}`],
          metadata: {
            adapterId: typeof outcome.data?.adapterId === 'string' ? outcome.data.adapterId : null,
            warnings: outcome.warnings || [],
            runId: outcome.runId || null,
          },
        });
        addBotMessage(`${prefix}${outcome.message}${accessBlock}${warningBlock}`, undefined, { runId: outcome.runId || null });
      }

      if (handoff) {
        setPendingHandoff(handoff);
      }
      return { handled: true as const, browser: !!browserPlan };
    } catch (error: any) {
      await persistComputerTaskState({
        task: trimmed,
        taskKind: execution.preview.kind,
        taskLabel: execution.preview.label,
        phase: 'failed',
        adapterId: execution.entrypoint === 'browser_runtime' ? 'browser_adapter' : null,
        grantedAccess: execution.grants.granted,
        accessPlan: execution.grants.summary,
        blockers: [error?.message || 'Unknown error'],
      });
      recordSessionArchiveError(
        `Use Computer failed: ${error?.message || 'Unknown error'}`,
        typeof error?.stack === 'string' ? error.stack : null,
        ['surface:computer_use', `computer_task:${trimmed}`],
      );
      addBotMessage(`**Use Computer** failed: ${error?.message || 'Unknown error'}`);
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
    loadSessionArchiveContext,
    messages,
    planActMode,
    recordSessionArchiveError,
    recordSessionArchiveEvent,
    replyTo,
    selectedModel,
    persistComputerTaskState,
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
        setMessages(mapPersistedRowsToChatMessages(rows, currentUserId || undefined, agentName));
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
          addBotMessage(`Build-page stream failed: ${msg}.`);
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
  // sessions, and bridge-detected Claude Code sessions.
  useEffect(() => {
    if (!circleId) return;
    const loadAgents = async () => {
      try {
        const [officeResult, identities, connections] = await Promise.all([
          loadCircleOfficeAgents(circleId),
          loadAgentIdentities(),
          loadConnections(),
        ]);

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
            current_task: agent.current_task || existing.current_task,
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
          const res = await fetch('http://localhost:7778/sessions', { signal: AbortSignal.timeout(3000) });
          if (res.ok) {
            const { sessions } = await res.json();
            for (const s of sessions || []) {
              const name = s.slug || s.sessionId?.slice(0, 12) || 'Claude Code';
              pushAgent({
                id: `bridge::${s.sessionId}`,
                name,
                status: s.status === 'active' ? 'building' : 'idle',
                provider: 'claude-code',
                color: '#22d3ee',
                owner_display_name: 'Bridge',
                current_task: s.cwd || null,
                circle_id: circleId,
                model: s.model || null,
                sessionKey: s.sessionId || null,
                source: 'bridge-session',
              });
            }
          }
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

        setLiveAgents(ranked);
      } catch {
        setLiveAgents([]);
      }
    };
    void loadAgents();
    const ch = supabase.channel(`chat_agents_${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_office_agents' }, () => void loadAgents())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
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
    const preferredModel = agent.model && agent.model !== 'auto' ? agent.model : undefined;

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
      const dbId = agent.id?.startsWith('bridge::') ? undefined : agent.id;
      const result = await wakeAndAssignTask(
        normalizedProvider,
        agent.name,
        task,
        circleId,
        dbId,
        { model: preferredModel },
      );
      if (result.ok) {
        return `**${agent.name}** [executed via ${normalizedProvider}${preferredModel ? ` · ${preferredModel}` : ''}]:\n\n${result.response || 'Done'}`;
      }
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
      if (rows.length > 0) {
        setMessages(mapPersistedRowsToChatMessages(rows, userId, agentName));
      }
    } catch (e) { 
      console.error('[ChatTab] Unexpected error loading messages:', e);
    }

    setLoaded(true);

    // Non-critical enrichments — load after the chat shell is ready
    void (async () => {
      try {
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

        const msg: ChatMessage = {
          ...shapePersistedChatMessage(newMsg, {
            currentUserId,
            botDisplayName: agentName,
            fallbackUserName: 'Circle Member',
          }),
          reactions: newMsg.reactions || {},
          replyTo: null,
          artifacts: isBotFromPopout ? (readPersistedChatBotMetadata(newMsg.content)?.artifacts || undefined) : undefined,
          wikiRefs: isBotFromPopout ? (readPersistedChatBotMetadata(newMsg.content)?.wikiRefs || undefined) : undefined,
          researchRefs: isBotFromPopout ? (readPersistedChatBotMetadata(newMsg.content)?.researchRefs || undefined) : undefined,
          memoryRefs: isBotFromPopout ? (readPersistedChatBotMetadata(newMsg.content)?.memoryRefs || undefined) : undefined,
          memoriesUsed: isBotFromPopout ? (readPersistedChatBotMetadata(newMsg.content)?.memoriesUsed || undefined) : undefined,
          executionStream: isBotFromPopout ? (readPersistedChatBotMetadata(newMsg.content)?.executionStream || undefined) : undefined,
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
    };

    setMessages(prev => [...prev, msg]);
    animateNewMessage(msg.id);

    // Trigger effects for special messages
    if (isCheckIn || isAchievement) {
      setTimeout(() => triggerParticleEffect(200, 300, isAchievement), 300);
    }

    // Persist to Supabase with retry
    if (currentUserId) {
      const persistMessage = async (attempt = 0) => {
        try {
          const dbId = await persistChatMessage({
            circleId,
            userId: currentUserId,
            content,
            threadId: activeThreadId,
            replyToId: replyTo?.dbId || null,
            isBot: false,
            reactions: {},
          });
          if (dbId) {
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

  const addBotMessage = (content: string, artifacts?: SwanBotStructuredArtifact[], extra?: { delegatedTo?: string; delegatedSubagents?: string[]; memoriesUsed?: string[]; memoryRefs?: PromptMemoryReference[]; memoryRecommendations?: OpenSwanMemoryRecommendation[]; executionStream?: OpenSwanExecutionContract[]; browserPlans?: BrowserPlanCardData[]; browserPlanEvents?: BrowserPlanEvent[]; browserSessions?: BrowserSessionRecord[]; localOnly?: boolean; runId?: string | null; taskPlan?: OpenSwanTaskPlan; toolEvents?: OpenSwanToolEvent[]; verificationResults?: OpenSwanVerificationResult[]; wikiRefs?: WikiArticleReference[]; researchRefs?: ResearchDocumentReference[]; automationProposal?: AutomationProposal; searchResults?: { query: string; rows: SearchResultRow[] }; commandsHelp?: boolean; assignPickerAgents?: AssignPickerAgent[] }) => {
    const msgId = `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      delegatedTo: extra?.delegatedTo,
      delegatedSubagents: extra?.delegatedSubagents,
      runId: extra?.runId,
      memoriesUsed: extra?.memoriesUsed,
      memoryRefs: extra?.memoryRefs,
      memoryRecommendations: extra?.memoryRecommendations,
      executionStream: extra?.executionStream,
      browserPlans: extra?.browserPlans,
      browserPlanEvents: extra?.browserPlanEvents,
      browserSessions: extra?.browserSessions,
      taskPlan: extra?.taskPlan,
      toolEvents: extra?.toolEvents,
      verificationResults: extra?.verificationResults,
      automationProposal: extra?.automationProposal,
      searchResults: extra?.searchResults,
      commandsHelp: extra?.commandsHelp,
      assignPickerAgents: extra?.assignPickerAgents,
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

    // Persist bot message with retry (skip for local-only slash command responses)
    if (currentUserId && activeThreadId && !extra?.localOnly) {
      persistMainChatBotMessageWithRetry({
        circleId,
        userId: currentUserId,
        agentName,
        content,
        threadId: activeThreadId,
        artifacts,
        wikiRefs: extra?.wikiRefs,
        researchRefs: extra?.researchRefs,
        memoriesUsed: extra?.memoriesUsed,
        memoryRefs: extra?.memoryRefs,
        memoryRecommendations: extra?.memoryRecommendations,
        executionStream: extra?.executionStream,
        browserPlans: extra?.browserPlans,
        browserPlanEvents: extra?.browserPlanEvents,
        browserSessions: extra?.browserSessions,
        onError: (error) => {
          console.error('[ChatTab] Unexpected error persisting bot msg:', error);
        },
        onPersisted: (dbId) => {
          setMessages(prev => prev.map((message) => (
            message.id === msgId ? { ...message, dbId } : message
          )));
        },
      });
    }

    syncSessionArchiveMessage(msg);

    return msg;
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
      isPending: true,
    };
    setMessages(prev => [...prev, msg]);
    animateNewMessage(msg.id);
    return msg;
  };

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
      addBotMessage(`Could not clear this thread: ${error.message}`);
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
      addBotMessage(`${header}\n\n${result.summary}${findings}`, undefined, { runId });
    } else if (status === 'error' && errorMessage) {
      const key = `err::${task}::${errorMessage.slice(0, 80)}`;
      if (computerUsePostedKeyRef.current === key) return;
      computerUsePostedKeyRef.current = key;
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
      });
      recordSessionArchiveError(
        `Computer task failed: ${task}`,
        errorMessage,
        ['surface:computer_use', task ? `computer_task:${task}` : ''].filter(Boolean),
      );
      addBotMessage(`**Computer Use** failed: ${errorMessage}`);
    }
  // addBotMessage intentionally not in deps — it's recreated every render,
  // and the ref-based dedupe above guarantees one post per terminal state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerUseTask.state.status, computerUseTask.state.result, computerUseTask.state.errorMessage, computerUseTask.state.runId, computerUseTask.state.sessionId, computerUseTask.state.task, computerUseTask.state.liveUrl, pendingComputerUseGrantIds, pendingComputerUseGrantSummary, persistComputerTaskState, recordSessionArchiveError, recordSessionArchiveEvent]);

  const updateBotMessage = (
    messageId: string,
    patch: Partial<Pick<ChatMessage, 'content' | 'artifacts' | 'wikiRefs' | 'researchRefs' | 'runId' | 'taskPlan' | 'toolEvents' | 'verificationResults' | 'executionStream' | 'browserPlans' | 'browserPlanEvents' | 'browserSessions' | 'isPending' | 'memoriesUsed' | 'memoryRefs' | 'memoryRecommendations' | 'delegatedSubagents'>>,
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
      browserPlans: message.browserPlans,
      browserPlanEvents: message.browserPlanEvents,
      browserSessions: message.browserSessions,
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

  // ─── Send Crypto ──────────────────────────────────────────────────────────

  const handleSendCrypto = async () => {
    if (!sendTo.trim() || !sendAmount.trim()) return;
    const amount = parseFloat(sendAmount);
    if (isNaN(amount) || amount <= 0) {
      addBotMessage("Invalid amount. Enter a number greater than 0.");
      return;
    }

    setSendingCrypto(true);

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
        addBotMessage(`Wallet connection failed: ${e.message}`);
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
      addBotMessage(`❌ Transaction failed: ${result.error}\n\nTry again or check your wallet.`);
    }

    setSendingCrypto(false);
    setShowSendCrypto(false);
    setSendTo('');
    setSendAmount('');
  };

  // ─── Send Message ────────────────────────────────────────────────────────

  const sendMessage = async (overrideText?: string) => {
    if (sendLockRef.current) return;
    const content = (overrideText || input).trim();
    if (!content) return;
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
    addUserMessage(content);
    setInput('');
    setAttachments([]);
    setReplyTo(null);
    setExpandedCategory(null);

    // Track user message in behavior profile
    if (profileRef.current) {
      profileRef.current = updateProfileFromMessage(profileRef.current, content, true);
      saveUserProfile(profileRef.current).catch(() => {});
    }
    recordChatActivity(circleId, 'message').catch(() => {});
    if (content.startsWith('/')) {
      recordChatActivity(circleId, 'slash').catch(() => {});
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
    // Detect "@a @b prompt" with 2+ distinct agents at the start of the
    // message — fan out the prompt to each in parallel, then post each
    // agent's reply as its own bot message. Single-agent and non-agent
    // messages fall through to the normal flow unchanged.
    if (!content.startsWith('/') && liveAgents.length > 0) {
      const aliases: Record<string, string> = {};
      for (const a of liveAgents) {
        if (a.name) aliases[a.name.toLowerCase()] = a.name;
      }
      for (const alias of BLACKSWAN_ALIASES) {
        if (!aliases[alias]) aliases[alias] = 'BlackSwan';
      }
      const multi = parseMultiAgentRequest(content, makeAliasResolver(aliases));
      if (multi) {
        const targets = multi.agents
          .map(ref => liveAgents.find(a => a.name.toLowerCase() === ref.resolvedName.toLowerCase()))
          .filter((a): a is AssignableAgent => !!a);
        if (targets.length >= 2) {
          addBotMessage(
            `Dispatching to ${targets.length} agents in parallel: ${targets.map(t => '@' + t.name).join(' ')}`,
            undefined,
            { localOnly: true },
          );
          setBotTyping(true);
          Promise.allSettled(
            targets.map(async (agent) => {
              try {
                const reply = await dispatchAssignedAgentTask(agent, multi.cleanedPrompt);
                return { agent, ok: true, reply };
              } catch (err: any) {
                return { agent, ok: false, reply: `**${agent.name}** error: ${err?.message || 'unknown'}` };
              }
            }),
          ).then((settled) => {
            setBotTyping(false);
            for (const s of settled) {
              if (s.status === 'fulfilled') {
                addBotMessage(s.value.reply);
              } else {
                addBotMessage(`Multi-agent dispatch error: ${String(s.reason)}`, undefined, { localOnly: true });
              }
            }
          });
          return;
        }
      }
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
        addBotMessage(`SwanBot v2 router error: ${err?.message || 'unknown'}`, undefined, { localOnly: true });
        return;
      }
    }
    if (content.startsWith('/memory-bank') || content.startsWith('/mb')) {
      try {
        const { executeMemoryBankCommand } = await import('../../../lib/memoryBankChatCommands');
        const outcome = await executeMemoryBankCommand(content, {
          circleId,
          userId: currentUserId || 'anonymous',
        });
        if (outcome) {
          addBotMessage(outcome.message, undefined, { localOnly: true });
          return;
        }
      } catch (err: any) {
        addBotMessage(`Memory Bank error: ${err?.message || 'unknown error'}`, undefined, { localOnly: true });
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
        addBotMessage(`Recording command failed: ${err?.message || 'unknown'}`, undefined, { localOnly: true });
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
        addBotMessage(`Desktop diag failed: ${err?.message || 'unknown'}`, undefined, { localOnly: true });
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
        addBotMessage(`Automation command error: ${err?.message || 'unknown error'}`, undefined, { localOnly: true });
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

    // ─── Conversational intent routing (natural language → actions) ─────────
    // Catches "post this to WordPress", "create a task", "remember that...", etc.
    // Only fires for non-slash-command messages
    const lowerContent = content.toLowerCase().trim();
    if (!lowerContent.startsWith('/')) {
      const plan = buildChatAutomationPlan({
        message: content,
        attachments: currentAttachments.map((attachment) => ({
          uri: attachment.uri,
          type: attachment.type,
          id: attachment.id,
        })),
        selectedMode: chatMode,
      });
      if (plan.execution.kind === 'run_computer_task') {
        const shared = await executeSharedComputerTask(content);
        if (shared?.handled && !shared.browser) {
          return;
        }
      }
    }

    if (!lowerContent.startsWith('/')) {
      try {
        const { detectConversationalIntent, executeConversationalIntent } = await import('../../../lib/conversationalRouter');
        const intent = detectConversationalIntent(content, currentAttachments as any);
        if (intent.type !== 'none') {
          const shouldShowWorkbench = isCodingGenerationRequest(content, sessionProfile) || currentAttachments.some((attachment) => attachment.isFigma) || !!figmaPromptContext;
          if (shouldShowWorkbench) {
            startCodingWorkbench([content, buildAttachmentPromptContext(currentAttachments), figmaPromptContext].filter(Boolean).join('\n\n'));
          }
          setBotTyping(true);
          const result = await executeConversationalIntent(intent, {
            circleId, userId: currentUserId || '', userName: currentUserName,
            fullMessage: content, attachments: currentAttachments as any,
          });
          setBotTyping(false);
          if (shouldShowWorkbench) stopCodingWorkbench();
          if (result?.handled) {
            if (result.message === '__SHOW_MEMORIES__') {
              setShowMemoryViewer(true);
            } else {
              addBotMessage(result.message, result.artifacts as any);
            }
            return;
          }
        }
      } catch {}
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
        .catch((err: any) => addBotMessage(`**${target.name}** error: ${err?.message || 'unknown'}`, undefined, { localOnly: true }))
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
      } catch (e: any) { addBotMessage(`Memory error: ${e.message}`); }
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
      } catch (e: any) { addBotMessage(`Memory error: ${e.message}`); }
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
      } catch (e: any) { addBotMessage(`Memory error: ${e.message}`); }
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
          addBotMessage(`Schedule error: ${e.message || 'Unknown error'}`);
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

    // ─── Mission commands — intercept /mission requests ──────────────────────
    if (lowerContent.startsWith('/mission') && (lowerContent === '/mission' || lowerContent[8] === ' ')) {
      (async () => {
        setBotTyping(true);
        try {
          const { executeMissionCommand } = await import('../../../lib/missionChatCommands');
          const result = await executeMissionCommand(content, {
            circleId,
            userId: currentUserId || '',
          });
          addBotMessage(result.message || 'No response.', undefined, { localOnly: true });
        } catch (e: any) {
          addBotMessage(`Mission error: ${e.message || 'Unknown error'}`, undefined, { localOnly: true });
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
          addBotMessage(`Summary error: ${e.message || 'Unknown error'}`, undefined, { localOnly: true });
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
          addBotMessage(`Room error: ${e.message || 'Unknown error'}`);
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
        addBotMessage(`HF error: ${e.message}`);
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
          addBotMessage(`GitHub error: ${e.message || 'Unknown error'}`);
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
          addBotMessage(`WordPress error: ${e.message || 'Unknown error'}`);
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
    } catch (capErr) {
      setBotTyping(false);
      console.warn('[Chat] Capability routing error:', capErr);
    }

    // Trigger Agent AI — always responds UNLESS the user is @mentioning another member
    const escapedName = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isAtMentioningSomeoneElse = new RegExp(`^@(?!agent|blackswan|swanbot|swan|${escapedName}\\b)\\w`, 'i').test(content.trim());

    if (!isAtMentioningSomeoneElse) {
      const cleanContent = content.replace(new RegExp(`@(agent|blackswan|swanbot|swan|${escapedName})\\s*`, 'gi'), '').trim() || content;

      // Build chat context with OpenSwan envelope wrapping for temporal awareness
      const recentMessages = messages.slice(-10);
      const chatHistory = recentMessages.map(m => {
        const who = m.isBot ? agentName : (m.userName || 'User');
        const when = m.timestamp ? m.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
        const ago = m.timestamp ? formatTimeAgo(m.timestamp) : '';
        return `[${who} · ${when}${ago ? ` · ${ago}` : ''}] ${m.content.slice(0, 300)}`;
      }).join('\n');

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

      const fullPrompt = [
        attachmentContext,
        replyContext,
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
        const context: SwanBotContext = {
          userId: currentUserId || 'anonymous',
          circleId,
          userName: currentUserName,
          model: selectedModel !== 'auto' ? selectedModel : undefined,
          sessionArchiveContext: sessionArchiveContext || undefined,
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
        if (chatMode !== 'none' && chatMode !== 'talk') {
          const result = await executeAgentRun({
            surface: 'main_chat',
            circleId,
            userId: currentUserId || 'anonymous',
            userName: currentUserName,
            prompt: fullPrompt,
            model: selectedModel !== 'auto' ? selectedModel : undefined,
            mode: chatMode as any,
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
            const canStream = sessionDelegationMode !== 'parallel'
              && !isFigmaBuildRequest
              && !isCodingGenerationRequest(cleanContent, sessionProfile)
              && !looksLikeActionRequest(cleanContent);

            if (canStream) {
              try {
                const { buildStreamableSystemPrompt } = await import('../../../lib/swanbot');
                const { streamChatResponse } = await import('../../../lib/swanbotStream');
                const { resolveModelForSoul, spiritIdForProfile } = await import('../../../lib/serviceProfileSouls');
                const systemPrompt = await buildStreamableSystemPrompt({
                  circleId,
                  userId: currentUserId || 'anonymous',
                  currentMessage: cleanContent,
                  model: selectedModel !== 'auto' ? selectedModel : undefined,
                  userName: currentUserName,
                  chatHistory,
                  sessionArchiveContext: sessionArchiveContext || undefined,
                });
                const streamModel = resolveModelForSoul(
                  spiritIdForProfile(resolvedSessionProfile),
                  selectedModel !== 'auto' ? selectedModel : undefined,
                );
                const pendingMsg = addPendingBotMessage('');
                setRunStatus('running');
                let accumulated = '';
                await new Promise<void>((resolve, reject) => {
                  const handle = streamChatResponse({
                    messages: [
                      { role: 'system', content: systemPrompt },
                      { role: 'user', content: augmentedPrompt },
                    ],
                    model: streamModel,
                    circleId,
                    onDelta: (text) => {
                      accumulated += text;
                      updateBotMessage(pendingMsg.id, { content: accumulated, isPending: false });
                    },
                    onUsage: (_usage) => {},
                    onDone: () => resolve(),
                    onError: (msg) => reject(new Error(msg)),
                  });
                  // Store cancel handle in case we need to abort
                  streamingBuildCleanupRef.current = handle.cancel;
                });
                streamingBuildCleanupRef.current = null;
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
                if (currentUserId && activeThreadId) {
                  persistMainChatBotMessageWithRetry({
                    circleId,
                    userId: currentUserId,
                    agentName,
                    content: accumulated,
                    threadId: activeThreadId,
                    onError: (error) => console.error('[ChatTab] persist streaming msg:', error),
                  });
                }
                setRunStatus('idle');
                setBotTyping(false);
                stopCodingWorkbench();
                return;
              } catch (streamErr) {
                console.warn('[ChatTab] Streaming failed, falling back to batch:', streamErr);
                // Fall through to batch path below
              }
            }

            setRunStatus('running');
            setActiveSubagent(null);
            setActiveDelegatedSubagents([]);
            const pendingMessage = addPendingBotMessage(
              (isCodingGenerationRequest(cleanContent, sessionProfile) || isFigmaBuildRequest)
                ? 'BUILDING...\nOpenSwan is writing the first draft and preparing files.'
                // Use a verb from the shared rotation so the pending
                // stub matches the typing indicator's tone.
                : `${pickThinkingVerb(Math.floor(Date.now() / 1500))}…`,
            );
            const structured = await runOpenSwanSessionTurn({
              message: augmentedPrompt,
            context,
            surface: 'main_chat',
            chatSessionId: activeThreadId,
            mode: 'talk',
            title: cleanContent.slice(0, 100) || 'OpenSwan Session',
            goal: cleanContent.slice(0, 500),
            sessionProfile: resolvedSessionProfile,
            delegationMode: sessionDelegationMode,
            activePluginIds: activePlugins,
            metadata: {
              selectedModel,
              threadId: activeThreadId,
              attachmentCount: currentAttachments.length,
              delegationMode: sessionDelegationMode,
              activePluginIds: activePlugins,
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
              isPending: false,
            });
            if (profileRef.current) {
              profileRef.current = updateProfileFromMessage(profileRef.current, botResponse, false);
              saveUserProfile(profileRef.current).catch(() => {});
            }
            if (currentUserId && activeThreadId) {
              persistMainChatBotMessageWithRetry({
                circleId,
                userId: currentUserId,
                agentName,
                content: botResponse,
                threadId: activeThreadId,
                artifacts: structured.artifacts,
                wikiRefs,
                researchRefs,
                memoriesUsed: structured.memoriesUsed,
                memoryRefs: structured.memoryReferences,
                memoryRecommendations: structured.memoryRecommendations,
                executionStream,
                browserPlans: structured.browserPlans,
                browserPlanEvents: structured.browserPlanEvents,
                onError: (error) => {
                  console.error('[ChatTab] Unexpected error persisting bot msg:', error);
                },
                onPersisted: (dbId) => {
                  setMessages(prev => prev.map((message) => (
                    message.id === pendingMessage.id ? { ...message, dbId } : message
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
            recordSessionArchiveError(
              batchErr instanceof Error ? `OpenSwan session failed: ${batchErr.message}` : 'OpenSwan session failed',
              batchErr instanceof Error ? batchErr.stack || null : null,
              ['surface:main_chat', 'runtime:openswan'],
            );
            setRunStatus('idle');
            setActiveSubagent(null);
            setActiveDelegatedSubagents([]);
          }
        }
      } catch (err) {
        recordSessionArchiveError(
          err instanceof Error ? `Chat execution failed: ${err.message}` : 'Chat execution failed',
          err instanceof Error ? err.stack || null : null,
          ['surface:main_chat'],
        );
        const errorMessage = (isCodingGenerationRequest(cleanContent, sessionProfile) || isFigmaBuildRequest)
          ? "Build failed before OpenSwan could finish the draft. Try again."
          : "Something went wrong. Try again.";
        setMessages((prev) => {
          const pendingIndex = [...prev].reverse().findIndex((entry) => entry.isBot && entry.isPending);
          if (pendingIndex === -1) {
            return [...prev, {
              id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              content: errorMessage,
              isBot: true,
              isUser: false,
              userName: agentName,
              timestamp: new Date(),
              reactions: {},
              isPending: false,
            }];
          }
          const actualIndex = prev.length - 1 - pendingIndex;
          return prev.map((entry, index) => (
            index === actualIndex
              ? { ...entry, content: errorMessage, isPending: false }
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
          addBotMessage(`Wallet status error: ${error?.message || 'Unknown error'}`);
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
      setShowOpenSwanConsole(true);
      return;
    }
    if (actionText === '__PAIR_DESKTOP__') {
      if (Platform.OS !== 'web') return;
      (async () => {
        const { getDesktopBridgeHealth, pairDesktopBridge } = await import('../../../lib/desktopBridge');
        const health = await getDesktopBridgeHealth();
        if (!health) {
          addBotMessage(
            "**Desktop bridge unreachable.**\n\n" +
            "Start it in a terminal:\n\n```\nnode scripts/claude-bridge.js\n```\n\n" +
            "Then tap **Pair Desktop Bridge** again.",
            undefined,
            { localOnly: true },
          );
          return;
        }
        if (!health.supported) {
          addBotMessage(
            `**Bridge is on \`${health.platform}\` — desktop automation is macOS-only in Phase 1.** ` +
            'Windows/Linux support is on the roadmap (see `docs/DESKTOP_AUTOMATION_PHASE_1_PLAN.md`).',
            undefined,
            { localOnly: true },
          );
          return;
        }
        const pair = await pairDesktopBridge();
        if (!pair.ok) {
          addBotMessage(
            `**Pairing failed:** ${pair.error || 'unknown error'}. ` +
            'Check that the bridge has write access to `~/.uc-desktop-token` and try again.',
            undefined,
            { localOnly: true },
          );
          return;
        }
        addBotMessage(
          "**Desktop Bridge paired.** The agent can now launch apps, type text, and send key combos on your Mac when you approve each action.\n\n" +
          "Available tools: `desktop.launch_app`, `desktop.focus_app`, `desktop.type_text`, `desktop.press_keys`, `desktop.list_running_apps`.\n\n" +
          "**First keystroke:** macOS will prompt for Accessibility permission for whichever Terminal/iTerm is running the bridge. Grant it in System Settings → Privacy & Security → Accessibility.",
          undefined,
          { localOnly: true },
        );
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
      addBotMessage(`❌ Failed to create poll: ${result.error}`);
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
      addBotMessage(`❌ Failed to create proposal: ${result.error}`);
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
      addBotMessage(`❌ Vote failed: ${result.error}`);
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

  // ─── Reactions ────────────────────────────────────────────────────────────

  const toggleReaction = (messageId: string, emoji: string) => {
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
        // Trigger floating emoji
        addFloatingReaction(emoji, 200 + Math.random() * 100, 300 + Math.random() * 100);
      }
      return { ...msg, reactions };
    }));
    setShowReactions(null);
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
        <ChatInlineRichText
          content={item.content}
          accentColor={accentColor}
          textColor={messageDensity === 'compact' ? '#bbb' : '#ccc'}
        />
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
                <Text style={styles.messageSourceLabel}>AI Wiki</Text>
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
                            {getMemoryFamilyLabel(ref).toUpperCase()} • {formatMemoryStateLabel(ref).toUpperCase()} • {String(ref.scope).toUpperCase()} • {String(ref.memoryKind).toUpperCase()} • {formatMemoryStrengthLabel(ref).toUpperCase()} • {formatMemoryTrustLabel(ref).toUpperCase()} • {formatMemoryRecencyLabel(ref).toUpperCase()}{formatMemorySourceLabel(ref) ? ` • ${formatMemorySourceLabel(ref)!.toUpperCase()}` : ''}{formatArchiveBiasLabel(ref) ? ` • ${formatArchiveBiasLabel(ref)!.toUpperCase()}` : ''}
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
                  {recommendation.priority.toUpperCase()} • {recommendation.memoryKind.toUpperCase()} • {recommendation.target.replace(/_/g, ' ').toUpperCase()}
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
            addBotMessage(`Agent spawn failed: ${result.message}`);
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
        onOpenRunHistory={() => setShowRunHistory(true)}
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
                      {String(ref.memoryKind).toUpperCase()} • {formatMemoryStrengthLabel(ref).toUpperCase()} • {formatMemoryRecencyLabel(ref).toUpperCase()}
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
                  addBotMessage(`**${selectedAgent.name}** failed to spawn a dedicated OpenSwan session: ${e.message || 'Unknown error'}`);
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
                setAssigning(true);
                addUserMessage(`@${selectedAgent.name}: ${taskPrompt.trim()}`);
                setBotTyping(true);
                try {
                  if (selectedAgent.id && !selectedAgent.id.startsWith('bridge::') && selectedAgent.id !== DEFAULT_AGENT.id) {
                    await supabase.from('circle_office_agents')
                      .update({
                        current_task: taskPrompt.trim().slice(0, 120),
                        status: 'building',
                        updated_at: new Date().toISOString(),
                        last_active_at: new Date().toISOString(),
                      })
                      .eq('id', selectedAgent.id);
                  }
                  const response = await dispatchAssignedAgentTask(selectedAgent, taskPrompt.trim());
                  addBotMessage(response);
                  if (selectedAgent.id && !selectedAgent.id.startsWith('bridge::') && selectedAgent.id !== DEFAULT_AGENT.id) {
                    await supabase.from('circle_office_agents')
                      .update({ current_task: null, status: 'idle' })
                      .eq('id', selectedAgent.id);
                  }
                } catch (e: any) {
                  addBotMessage(`**${selectedAgent.name}** failed: ${e.message || 'Unknown error'}`);
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
                addBotMessage(`**Computer Use** ${result.success ? 'completed' : 'failed'}: ${result.message}`);
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
                addBotMessage(`**Computer Use** ${result.success ? 'completed' : 'failed'}: ${result.message}`);
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
            computerUsePostedKeyRef.current = null;
            await grantComputerTaskScopes(circleId, grantIdsToPersist).catch(() => {});
            const started = await computerUseTask.run(taskToRun);
            if (!started.started) {
              addBotMessage(`**Computer Use** could not start: ${started.reason || 'unknown error'}`);
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
        />
      )}

      {Platform.OS === 'web' && (
        <OpenSwanConsole
          visible={showOpenSwanConsole}
          accentColor={accentColor}
          currentMode={chatMode}
          currentModel={selectedModel === 'auto' ? null : selectedModel}
          circleId={circleId}
          userId={currentUserId}
          surface="main_chat"
          onClose={() => setShowOpenSwanConsole(false)}
          onSubmit={({ task, mode, model: modelOverride }) => {
            setShowOpenSwanConsole(false);
            // Sync the mode into the chat state so the rest of the turn
            // renders with the right accent + response contract. The
            // sendMessage path will see `chatMode === mode` and pass it
            // into `buildChatAutomationPlan({ selectedMode })`.
            setChatMode(mode);
            if (modelOverride && modelOverride !== selectedModel) {
              handleSessionModelChange(modelOverride);
            }
            // Fire the task through the normal send path so it goes
            // through the planner + dispatcher + HITL gate.
            setInput(task);
            sendMessage(task);
          }}
        />
      )}

      {Platform.OS === 'web' && computerUseTask.state.status !== 'idle' && (
        <View
          // Floating, draggable-feeling card pinned bottom-right while the
          // Computer Use agent works. Collapses to summary when done.
          style={{
            position: 'fixed' as any,
            bottom: 20,
            right: 20,
            width: 460,
            maxWidth: 'calc(100vw - 40px)' as any,
            maxHeight: '80vh' as any,
            zIndex: 950,
          }}
        >
          <ComputerUseLiveCard
            task={computerUseTask.state.task}
            status={computerUseTask.state.status === 'starting' ? 'starting' : computerUseTask.state.status}
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
                addBotMessage(`Confirmation could not be recorded: ${err?.message || 'unknown error'}`);
              });
            }}
            onCancel={() => computerUseTask.cancel()}
          />
        </View>
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
        onFocusBot={() => {
          if (!input.toLowerCase().includes(`@${agentName.toLowerCase()}`)) setInput(`@${agentName} ` + input);
          inputRef.current?.focus();
        }}
        inputRef={inputRef}
        accentColor={accentColor}
        selectedModel={selectedModel}
        onModelChange={handleSessionModelChange}
        attachments={attachments}
        onPickImage={async () => {
          const results = await pickAttachments();
          if (results.length > 0) setAttachments(prev => [...prev, ...results]);
        }}
        onRemoveAttachment={(id: string) => setAttachments(prev => prev.filter(a => a.id !== id))}
        chatMode={chatMode}
        onModeChange={setChatMode}
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
        onOpenControlPanel={() => setShowOpenSwanConsole(true)}
        onResetMind={async () => {
          const { resetAgentMind } = await import('../../../lib/swanbot');
          const { cleared } = await resetAgentMind(circleId);
          setMessages([]);
          addBotMessage(`Mind reset. ${cleared > 0 ? `Cleared ${cleared} memories. ` : ''}Starting fresh.`);
        }}
        onLocalBotMessage={(md: string) => addBotMessage(md, undefined, { localOnly: true })}
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
    backdropFilter: hovered ? 'blur(8px)' : 'none',
    backgroundColor: hovered ? (item.isBot ? accentColor + '08' : '#ffffff08') : 'transparent',
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
        <View style={[styles.enhancedMsgBubble, item.isBot && { borderLeftColor: accentColor }]}>
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

const CHAT_MODELS = [
  // ── Smart Pick ──
  { id: 'auto', label: 'Auto', desc: 'Auto-routes to best model for your task', color: '#22c55e', icon: 'A', group: 'smart', tags: ['text', 'code', 'images', 'web'] },

  // ── Coding & Engineering ──
  { id: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Best coder alive. Complex architecture.', color: '#a855f7', icon: 'O', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', desc: 'Fast coding. Great for iteration.', color: '#6366f1', icon: 'S', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'gpt-5.4', label: 'GPT-5.4', desc: 'OpenAI flagship. Strong at code + reasoning.', color: '#10b981', icon: '5', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'gpt-5.2', label: 'GPT-5.2', desc: 'Fast, reliable. Good balance.', color: '#10b981', icon: 'G', group: 'code', tags: ['code', 'text', 'web'] },
  { id: 'codex-mini', label: 'Codex Mini', desc: 'Built for code. Cheap + fast.', color: '#10a37f', icon: 'Cx', group: 'code', tags: ['code'] },
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2', desc: 'MoE. Exceptional at code.', color: '#ef4444', icon: 'DS', group: 'code', tags: ['code', 'text'] },
  { id: 'qwen-3.5-coder', label: 'Qwen Coder', desc: 'Apache 2.0. Code specialist.', color: '#ec4899', icon: 'QC', group: 'code', tags: ['code'] },

  // ── Reasoning & Research ──
  { id: 'o3', label: 'O3', desc: 'Deep reasoning. Math + science.', color: '#f59e0b', icon: 'o3', group: 'reason', tags: ['reason', 'code'] },
  { id: 'o4-mini', label: 'O4 Mini', desc: 'Fast reasoning. Budget-friendly.', color: '#f59e0b', icon: 'o4', group: 'reason', tags: ['reason', 'code'] },
  { id: 'deepseek-r1', label: 'DeepSeek R1', desc: 'Chain-of-thought. Open source.', color: '#ef4444', icon: 'R1', group: 'reason', tags: ['reason', 'code'] },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', desc: 'Google. 2M context. Vision.', color: '#3b82f6', icon: 'G3', group: 'reason', tags: ['reason', 'vision', 'web'] },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', desc: 'Google. Long context king.', color: '#3b82f6', icon: 'Gm', group: 'reason', tags: ['reason', 'vision', 'web'] },

  // ── Speed & Cost ──
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Lightning fast. Cheapest Claude.', color: '#22d3ee', icon: 'H', group: 'speed', tags: ['text', 'code', 'web'] },
  { id: 'gemini-2.5-flash', label: 'Gemini Flash', desc: 'Google. Fastest + free tier.', color: '#3b82f6', icon: 'Gf', group: 'speed', tags: ['text', 'code', 'vision', 'web'] },
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
  { key: 'smart', label: 'SMART PICK', color: '#22c55e' },
  { key: 'code', label: 'CODING & ENGINEERING', color: '#a855f7' },
  { key: 'reason', label: 'REASONING & RESEARCH', color: '#f59e0b' },
  { key: 'speed', label: 'SPEED & COST', color: '#22d3ee' },
  { key: 'creative', label: 'CREATIVE & MULTIMODAL', color: '#10b981' },
  { key: 'open', label: 'OPEN SOURCE', color: '#f59e0b' },
];

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
  onQuickAction,
  attachments,
  onPickImage,
  onRemoveAttachment,
  chatMode,
  onModeChange,
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
}: any) {
  const [focused, setFocused] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [customModels, setCustomModels] = useState<any[]>([]);
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

  // Load custom models on mount
  React.useEffect(() => {
    import('../../../lib/customModels').then(({ loadCustomModels, customModelToChatModel }) => {
      loadCustomModels().then(models => {
        setCustomModels(models.map(customModelToChatModel));
      });
    }).catch(() => {});
  }, []);
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

  useEffect(() => {
    setHighlightedSlashIndex(0);
  }, [slashToken, slashCommands.length]);

  const applySlashCommand = useCallback((command: ChatSlashCommand) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    onInputChange(command.insertText);
    setHighlightedSlashIndex(0);
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
      if (input.trim()) onSend();
    }
  }, [applySlashCommand, highlightedSlashIndex, input, onSend, showSlashCommands, slashCommands, chatMode, onModeChange]);

  const allModels = [...CHAT_MODELS, ...customModels];
  const currentModel = allModels.find(m => m.id === selectedModel) || CHAT_MODELS[0];
  const soulActions = getMainChatSessionActions(sessionProfile || 'senior');
  const controlStatusLabel = currentRunStep?.trim()
    || (runStatus === 'running' ? 'thinking'
      : runStatus === 'delegated' ? 'delegating'
      : runStatus === 'waiting_approval' ? 'awaiting approval'
      : 'ready');
  const accordionCategories = [
    { key: 'commands', category: PROMPT_CATEGORIES[0] },
    { key: 'create', category: PROMPT_CATEGORIES[1] },
    { key: 'publish', category: PROMPT_CATEGORIES[2] },
    { key: 'wallet', category: PROMPT_CATEGORIES[3] },
  ];

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
            onPress={() => { setShowModelPicker(!showModelPicker); setShowQuickActions(false); }}
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
            <Text style={[styles.modelButtonLabel, { color: currentModel.color }]}>{currentModel.label}</Text>
            <Text style={styles.modelChevron}>{showModelPicker ? '▲' : '▼'}</Text>
          </Pressable>

          {/* Model Dropdown */}
          {showModelPicker && !showAddModel && (
            <AnimatedPopup style={[styles.dropdownPanel, { maxHeight: 480, width: 300, left: 0, right: 'auto' }, ...(Platform.OS === 'web' ? [{ boxShadow: '4px 4px 0px rgba(99,102,241,0.05), 0 12px 40px rgba(0,0,0,0.6)', overflowY: 'auto' } as any] : [])]}>
              {MODEL_GROUPS.map(group => {
                const groupModels = CHAT_MODELS.filter((m: any) => m.group === group.key);
                if (groupModels.length === 0) return null;
                return (
                  <View key={group.key}>
                    <Text style={[styles.dropdownCategoryTitle, { color: group.color }]}>{group.label}</Text>
                    {groupModels.map((model: any) => {
                      const isActive = model.id === selectedModel;
                      const isHovered = hoveredModel === model.id;
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
                            ...(Platform.OS === 'web' ? [{ transition: 'all 0.15s ease', cursor: 'pointer' } as any] : []),
                          ]}
                        >
                          <View style={[styles.dropdownItemIcon, { backgroundColor: model.color + '20' }]}>
                            <Text style={[styles.dropdownItemIconText, { color: model.color }]}>{model.icon}</Text>
                          </View>
                          <View style={styles.dropdownItemText}>
                            <Text style={[styles.dropdownItemLabel, isActive && { color: model.color }]}>{model.label}</Text>
                            <Text style={styles.dropdownItemDesc}>{model.desc}</Text>
                            {(model as any).tags && (
                              <View style={{ flexDirection: 'row', gap: 3, marginTop: 2, flexWrap: 'wrap' }}>
                                {((model as any).tags as string[]).map((tag: string) => {
                                  const tagColors: Record<string, string> = { images: '#84cc16', vision: '#22d3ee', code: '#a855f7', text: '#606075', web: '#f59e0b', reason: '#ec4899' };
                                  return (
                                    <View key={tag} style={{ backgroundColor: (tagColors[tag] || '#606075') + '15', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
                                      <Text style={{ color: tagColors[tag] || '#606075', fontSize: 7, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{tag.toUpperCase()}</Text>
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
              })}

              {/* Custom HF models */}
              {customModels.length > 0 && (
                <View>
                  <Text style={[styles.dropdownCategoryTitle, { color: '#f472b6' }]}>YOUR MODELS (HF)</Text>
                  {customModels.map((model: any) => {
                    const isActive = model.id === selectedModel;
                    return (
                      <Pressable
                        key={model.id}
                        onPress={() => { onModelChange(model.id); setShowModelPicker(false); }}
                        accessibilityRole="button"
                        style={[styles.dropdownItem, isActive && { backgroundColor: (model.color || '#f472b6') + '18' }, ...(Platform.OS === 'web' ? [{ cursor: 'pointer' } as any] : [])]}
                      >
                        <View style={[styles.dropdownItemIcon, { backgroundColor: (model.color || '#f472b6') + '20' }]}>
                          <Text style={[styles.dropdownItemIconText, { color: model.color || '#f472b6' }]}>{model.icon}</Text>
                        </View>
                        <View style={styles.dropdownItemText}>
                          <Text style={[styles.dropdownItemLabel, isActive && { color: model.color || '#f472b6' }]}>{model.label}</Text>
                          <Text style={styles.dropdownItemDesc}>{model.desc}</Text>
                        </View>
                        {isActive && <View style={[styles.dropdownActiveDot, { backgroundColor: model.color || '#f472b6' }]} />}
                      </Pressable>
                    );
                  })}
                </View>
              )}

              <View style={styles.dropdownDivider} />
              <Pressable
                onPress={() => setShowAddModel(true)}
                accessibilityRole="button"
                style={[styles.dropdownItem, ...(Platform.OS === 'web' ? [{ cursor: 'pointer' } as any] : [])]}
              >
                <View style={[styles.dropdownItemIcon, { backgroundColor: accentColor + '20' }]}>
                  <Text style={[styles.dropdownItemIconText, { color: accentColor }]}>+</Text>
                </View>
                <View style={styles.dropdownItemText}>
                  <Text style={[styles.dropdownItemLabel, { color: accentColor }]}>Browse Hugging Face</Text>
                  <Text style={styles.dropdownItemDesc}>Add any model from HF Hub</Text>
                </View>
              </Pressable>
            </AnimatedPopup>
          )}

          {/* Add Model Panel */}
          {showModelPicker && showAddModel && (
            <AnimatedPopup style={[styles.dropdownPanel, styles.dropdownPanelWide, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' } as any] : [])]}>
              <AddModelPanel
                accentColor={accentColor}
                onModelAdded={(model) => {
                  import('../../../lib/customModels').then(({ customModelToChatModel }) => {
                    setCustomModels(prev => [...prev, customModelToChatModel(model)]);
                  });
                  setShowAddModel(false);
                }}
                onClose={() => setShowAddModel(false)}
              />
            </AnimatedPopup>
          )}
        </View>

        {/* Quick Actions Button */}
        <View style={{ position: 'relative' as const }}>
          <Pressable
            onPress={() => { setShowQuickActions(!showQuickActions); setShowModelPicker(false); }}
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
            accessibilityLabel="Open OpenSwan control center"
            style={({ hovered, pressed }: any) => [
              styles.modelButton,
              { borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '50' },
              hovered && {
                borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '80',
                backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '14',
                ...(Platform.OS === 'web' ? { boxShadow: `0 10px 28px ${(CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor)}22`, transform: 'translateY(-1px)' } as any : {}),
              },
              pressed && { transform: [{ scale: 0.985 }] },
              ...(Platform.OS === 'web' ? [{ transition: 'all 0.2s ease', cursor: 'pointer' } as any] : []),
            ]}
          >
            <View style={[styles.modelIconBox, { backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '20' }]}>
              <Text style={[styles.modelIconText, { color: CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor }]}>
                OS
              </Text>
            </View>
            <Text style={[styles.modelButtonLabel, { color: CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor }]}>
              OpenSwan
            </Text>
            <Text style={styles.modelChevron}>{showModePicker ? '▲' : '▼'}</Text>
          </Pressable>

          {showModePicker && (
            <AnimatedPopup style={[styles.dropdownPanel, styles.dropdownPanelControlCenter, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' } as any] : [])]}>
              <Text style={styles.dropdownTitle}>OpenSwan Control Center</Text>
              <View style={styles.controlCenterStatusBand}>
                <View style={styles.controlCenterStatusHeader}>
                  <View style={[styles.liveMiniDot, { backgroundColor: runStatus === 'idle' ? '#22c55e' : runStatus === 'waiting_approval' ? '#f59e0b' : '#6366f1' }]} />
                  <Text style={styles.controlCenterStatusLabel}>STATUS</Text>
                </View>
                <Text style={styles.controlCenterStatusValue} numberOfLines={2}>{controlStatusLabel}</Text>
              </View>
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
              {/* Full Control Panel — top-level action. Shows the posture
                  (tools / memory / subagents) the current mode will use
                  before launching a turn, plus the prune-biasing-memories
                  maintenance action. Distinct from the 2×2 grid below
                  because it's the primary "show me what's going to
                  happen" surface, not a single feature. */}
              {onOpenControlPanel ? (
                <Pressable
                  onPress={() => { onOpenControlPanel(); setShowModePicker(false); }}
                  accessibilityRole="button"
                  accessibilityLabel="Open OpenSwan Control Panel"
                  style={({ hovered, pressed }: any) => [
                    {
                      marginBottom: 8,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '60',
                      backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '14',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                    },
                    hovered && {
                      borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor),
                      backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '22',
                    },
                    pressed && { transform: [{ scale: 0.985 }] },
                    Platform.OS === 'web' && { cursor: 'pointer', transition: 'all 0.15s ease' } as any,
                  ]}
                >
                  <View style={[styles.dropdownItemIcon, { backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) + '30' }]}>
                    <Text style={[styles.dropdownItemIconText, { color: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) }]}>
                      ⌘
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.dropdownItemLabel, { color: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || accentColor) }]}>
                      Control Panel
                    </Text>
                    <Text style={styles.dropdownItemDesc}>
                      Inspect tools, memory, subagents — prune biasing memories
                    </Text>
                  </View>
                  <Text style={[styles.modelChevron, { marginLeft: 'auto' }]}>›</Text>
                </Pressable>
              ) : null}
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
            </AnimatedPopup>
          )}
        </View>

        {/* Cost footer + Desktop bridge status — right-aligned. */}
        <View style={{ flex: 1 }} />
        <DesktopBridgeStatusChip
          accentColor={accentColor}
          onMessage={(md) => onLocalBotMessage?.(md)}
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
          <EnhancedSendInputButton onPress={() => onSend()} disabled={!input.trim()} accentColor={accentColor} />
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
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#11111180',
    borderWidth: 1,
    borderColor: '#00000060',
    borderLeftWidth: 3,
    borderLeftColor: '#2a2a2a',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
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
    gap: 6,
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
    gap: 5,
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
