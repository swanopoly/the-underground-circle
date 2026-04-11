import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import FlatIcon from '../../../components/FlatIcon';
import MemoryViewer from '../../../components/agent/MemoryViewer';
import RunStatusBar from '../../../components/agent/RunStatusBar';
import PluginPicker from '../../../components/agent/PluginPicker';
import MemoryToast from '../../../components/agent/MemoryToast';
import {
  getSwanBotResponse as getAIResponse,
  getSwanBotStructuredResponse,
  SwanBotContext,
  type SwanBotStructuredArtifact,
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
import { pickImage, ChatAttachment, getMediaTypeIcon, prepareImageForAI } from '../../../lib/chatMedia';
import {
  loadUserProfile, updateProfileFromMessage, updateProfileFromDeletion,
  updateProfileFromReply, saveUserProfile, UserChatProfile,
} from '../../../lib/userChatProfile';
import {
  createSession as createComputerUseSession,
  planActions as planComputerUseActions,
  executePlan as executeComputerUsePlan,
  type ComputerUseSession,
  type ComputerUsePermission,
  type BrowserAction,
} from '../../../lib/computerUse';
import ComputerUsePanel from '../../../components/computer-use/ComputerUsePanel';
import ComputerUsePermissionDialog from '../../../components/computer-use/ComputerUsePermissionDialog';
import ComputerUseButton from '../../../components/computer-use/ComputerUseButton';

const REACTIONS_LIST = ['🔥', '💪', '👊', '💯', '⚡', '🎯'];
const BLACKSWAN_ID = 'blackswan';
const LOGIN_NEON = '#b8ff61';
const AGENT_STORAGE_KEY = 'uc_agent_name';
function loadAgentName(circleId: string): string {
  try { return localStorage.getItem(`${AGENT_STORAGE_KEY}_${circleId}`) || 'Agent'; } catch { return 'Agent'; }
}
function saveAgentName(circleId: string, name: string) {
  try { localStorage.setItem(`${AGENT_STORAGE_KEY}_${circleId}`, name); } catch {}
}

// ─── Prompt Categories ───────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: '>_ Assign Agent', text: '__ASSIGN_AGENT__' },
  { label: '+ Spawn Agent', text: '__SPAWN_AGENT__' },
  { label: '>_ Use Browser', text: '__COMPUTER_USE__' },
  { label: '📋 My Tasks', text: 'my tasks' },
  { label: '</> GitHub', text: '/gh help' },
  { label: '[] Rooms', text: '/room help' },
  { label: 'AI Summarize', text: '/summarize ' },
  { label: 'AI Translate', text: '/translate ' },
  { label: 'AI Imagine', text: '/imagine ' },
  { label: '✅ Check In', text: '__CHECK_IN__' },
  { label: '📋 New Task', text: '__NEW_TASK__' },
  { label: '📅 Daily Plan', text: 'daily plan' },
  { label: '📊 Status', text: 'status' },
  { label: '🔥 My Streak', text: 'my streak' },
  { label: '🗳️ Vote', text: '/proposals' },
  { label: '💸 Send Crypto', text: '__SEND_CRYPTO__' },
  { label: '⚔️ Challenge', text: 'challenge a member' },
  { label: '🎮 Play a Game', text: 'play a game' },
  { label: '🧠 Trivia', text: 'trivia' },
  { label: '🤔 Would You Rather', text: 'would you rather' },
  { label: '🔥 Hot Take', text: 'hot take' },
  { label: '🖥️ Step Away', text: '__STEP_AWAY__' },
  { label: '>_ Help', text: 'help' },
  { label: '☢️ Nuke Chat', text: '__NUKE__' },
];

const PROMPT_CATEGORIES = [
  {
    title: '🎯 MISSIONS',
    color: '#6366f1',
    prompts: [
      { label: 'Mission Status', desc: 'See all active missions', text: '/mission' },
      { label: 'New Mission', desc: 'Create from chat', text: '/mission create ' },
      { label: 'Mission Help', desc: 'Available commands', text: '/mission help' },
      { label: 'What should I work on?', desc: 'AI picks your next task', text: 'Based on our active missions, what should I work on next?' },
      { label: 'Sprint Review', desc: 'How did we do?', text: 'Review our mission progress this week — what shipped, what slipped, what to focus on next' },
    ],
  },
  {
    title: '🎮 GAMES & FUN',
    color: '#a855f7',
    prompts: [
      { label: 'Trivia Battle', desc: 'Test your knowledge', text: 'trivia' },
      { label: 'Would You Rather', desc: 'Fun dilemmas for the crew', text: 'would you rather' },
      { label: 'Hot Takes', desc: 'Drop a spicy opinion', text: 'hot take' },
      { label: 'Two Truths & a Lie', desc: 'Guess which is the lie', text: 'two truths' },
      { label: 'Rate My Day', desc: 'Score your day 1-10', text: 'rate my day' },
      { label: 'This or That', desc: 'Quick picks', text: 'this or that' },
      { label: 'Roast Battle', desc: 'Agent roasts everyone 😈', text: 'roast battle' },
    ],
  },
  {
    title: '⚔️ CHALLENGES',
    color: '#ef4444',
    prompts: [
      { label: 'Challenge a Member', desc: '1v1 productivity duel', text: 'challenge a member' },
      { label: 'Speed Task', desc: 'Race to finish first', text: 'speed task' },
      { label: 'Daily Dare', desc: 'Random dare', text: 'dare' },
    ],
  },
  {
    title: '📋 TASKS & PRODUCTIVITY',
    color: '#3b82f6',
    prompts: [
      { label: 'My Tasks', desc: 'See your open tasks', text: 'my tasks' },
      { label: 'Task Board', desc: 'Full circle overview', text: 'tasks' },
      { label: 'Daily Plan', desc: 'AI daily priorities', text: 'daily plan' },
      { label: 'Focus Mode', desc: 'Start a Pomodoro', text: 'focus' },
      { label: 'Accountability', desc: 'Full report', text: 'accountability' },
    ],
  },
  {
    title: '📊 STATS & TRACKING',
    color: '#22d3ee',
    prompts: [
      { label: 'Circle Status', desc: 'Check-ins, tasks, members', text: 'status' },
      { label: 'Leaderboard', desc: 'Streak rankings', text: 'leaderboard' },
      { label: 'Who Checked In', desc: "Today's check-ins", text: 'who checked in' },
      { label: 'Weekly Review', desc: 'Recap your week', text: 'weekly review' },
      { label: 'MVP of the Week', desc: 'Who crushed it?', text: 'mvp of the week' },
    ],
  },
  {
    title: '💸 CRYPTO',
    color: '#f97316',
    prompts: [
      { label: 'Send Crypto', desc: 'Send ETH/SOL to a member', text: '__SEND_CRYPTO__' },
      { label: 'My Wallet', desc: 'Check your wallet status', text: 'my wallet' },
      { label: 'Tip a Member', desc: 'Send a small tip', text: '__TIP__' },
      { label: 'Bounty', desc: 'Set a crypto bounty on a task', text: 'set a bounty on a task' },
    ],
  },
  {
    title: '🔗 CONNECT',
    color: '#6366f1',
    prompts: [
      { label: 'Discord Activity', desc: 'What\'s happening on Discord', text: 'what\'s happening on discord' },
      { label: 'Icebreaker', desc: 'Get to know your circle', text: 'icebreaker' },
      { label: 'Shoutout', desc: 'Hype up a member', text: 'shoutout' },
    ],
  },
  {
    title: '🗳️ GOVERNANCE (DAO)',
    color: '#22c55e',
    prompts: [
      { label: 'Create Proposal', desc: 'Put something to a vote', text: '/propose ' },
      { label: 'Quick Poll', desc: 'Ask the crew a question', text: '/poll ' },
      { label: 'Active Votes', desc: 'See open proposals & polls', text: '/proposals' },
      { label: 'Pinned Messages', desc: 'See important pinned msgs', text: '/pins' },
      { label: 'Search Chat', desc: 'Find old messages', text: '/search ' },
    ],
  },
  {
    title: '🔥 MOTIVATION',
    color: '#ec4899',
    prompts: [
      { label: 'Motivate Me', desc: 'Get fired up', text: 'motivate me' },
      { label: 'Roast Me', desc: 'If you dare 😈', text: 'roast me' },
      { label: 'Quote of the Day', desc: 'Inspirational quote', text: 'quote' },
      { label: 'Pep Talk', desc: 'Personalized encouragement', text: 'pep talk' },
    ],
  },
];

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
  // Memory indicators
  memoriesSaved?: string[];   // titles of memories extracted from this exchange
  memoriesUsed?: string[];    // titles of memories that informed this response
  delegatedTo?: string;       // subagent that handled this message
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

export default function ChatTab({ circleId, accentColor = '#6366f1' }: { circleId: string; accentColor?: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const [selectedModel, setSelectedModel] = useState<string>('auto');
  const [chatMode, setChatMode] = useState<string>('none');
  const [agentName, setAgentNameState] = useState<string>(() => loadAgentName(circleId));
  const [editingAgentName, setEditingAgentName] = useState(false);
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const setAgentName = useCallback((name: string) => {
    const trimmed = name.trim() || 'Agent';
    setAgentNameState(trimmed);
    saveAgentName(circleId, trimmed);
  }, [circleId]);
  const [pendingHandoff, setPendingHandoff] = useState<HandoffSuggestion | null>(null);
  // Quick action modal states (lifted from old EnhancedQuickBar)
  const [showQuickCheckIn, setShowQuickCheckIn] = useState(false);
  const [showQuickNewTask, setShowQuickNewTask] = useState(false);
  const [showQuickStepAway, setShowQuickStepAway] = useState(false);
  // Agent assignment
  const [showAssignPanel, setShowAssignPanel] = useState(false);
  const [showSpawnPanel, setShowSpawnPanel] = useState(false);
  const [liveAgents, setLiveAgents] = useState<any[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [assigning, setAssigning] = useState(false);
  // Media attachments
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  // Computer-use state (web-only)
  const [computerUseSession, setComputerUseSession] = useState<ComputerUseSession | null>(null);
  const [showComputerUsePermission, setShowComputerUsePermission] = useState(false);
  const [pendingComputerUseTask, setPendingComputerUseTask] = useState('');
  const [pendingComputerUseActions, setPendingComputerUseActions] = useState<BrowserAction[]>([]);
  const [showMemoryViewer, setShowMemoryViewer] = useState(false);
  const [showPluginPicker, setShowPluginPicker] = useState(false);
  const [activePlugins, setActivePlugins] = useState<string[]>([]);
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'delegated' | 'waiting_approval'>('idle');
  const [activeSubagent, setActiveSubagent] = useState<{ name: string; icon: string; color: string } | null>(null);
  const [currentRunStep, setCurrentRunStep] = useState<string>('');
  const [memoryToast, setMemoryToast] = useState<{ message: string; type: 'saved' | 'updated' | 'conflict' | 'forgotten' } | null>(null);
  // User behavior profile
  const profileRef = useRef<UserChatProfile | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const quickScrollRef = useRef<ScrollView>(null);
  const quickScrollX = useRef(0);
  const welcomeAnim = useRef(new Animated.Value(0)).current;
  const newMessageAnims = useRef<Map<string, Animated.Value>>(new Map()).current;

  // ─── Init ────────────────────────────────────────────────────────────────

  useEffect(() => {
    init();
  }, [circleId]);

  // Load user behavior profile
  useEffect(() => {
    loadUserProfile().then(p => {
      p.totalSessions += 1;
      profileRef.current = p;
      saveUserProfile(p).catch(() => {});
    }).catch(() => {});
  }, []);

  // Load live agents for assignment
  useEffect(() => {
    if (!circleId) return;
    const loadAgents = () => supabase.from('circle_office_agents')
      .select('id, name, status, owner_id, color, tool_icon, owner_display_name, current_task, circle_id, provider')
      .eq('circle_id', circleId)
      .neq('status', 'offline').order('status').limit(50)
      .then(({ data }) => { if (data) setLiveAgents(data); });
    loadAgents();
    const ch = supabase.channel(`chat_agents_${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_office_agents' }, loadAgents)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [circleId]);

  const init = async () => {
    try {
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, username')
        .eq('id', user.id)
        .single();
      if (profile) setCurrentUserName(profile.display_name || profile.username || 'You');
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
      const { data } = await supabase
        .from('circle_members')
        .select('user:profiles(id, username, display_name)')
        .eq('circle_id', circleId);
      const m = (data || []).map((d: any) => d.user).filter(Boolean);
      m.push({ id: BLACKSWAN_ID, username: 'Agent', display_name: agentName });
      setMembers(m);
    } catch (e) { /* circle may not exist yet */ }

    // Load persisted messages
    try {
      // Explicitly select only known-safe columns to avoid schema drift errors.
      // is_bot and reactions are added via migration — use safe fallback if missing.
      const { data, error } = await supabase
        .from('messages')
        .select('id, circle_id, user_id, content, reply_to, created_at, is_bot, reactions, user:profiles(username, display_name)')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) {
        // Fallback: if new columns not yet migrated, select without them
        if (error.code === '42703' || (error.message && error.message.includes('does not exist'))) {
          console.warn('[ChatTab] Schema migration pending — loading without is_bot/reactions');
          const { data: fallback, error: fe } = await supabase
            .from('messages')
            .select('id, circle_id, user_id, content, reply_to, created_at, user:profiles(username, display_name)')
            .eq('circle_id', circleId)
            .order('created_at', { ascending: true })
            .limit(100);
          if (!fe && fallback && fallback.length > 0) {
            const loaded: ChatMessage[] = fallback.map((m: any) => ({
              id: m.id, dbId: m.id,
              content: m.content || '',
              isBot: /^(🦢|🤖) \*\*\w+.*?:\*\*/.test(m.content || '') || (m.content || '').startsWith('👑 **OpenSwan:**'),
              isUser: m.user_id === user?.id,
              userName: m.user?.display_name || m.user?.username || 'Unknown',
              timestamp: new Date(m.created_at),
              reactions: {}, replyTo: null, isCheckIn: false, isAchievement: false,
            }));
            setMessages(loaded);
          }
        } else {
          console.error('[ChatTab] Error loading messages:', error);
        }
      } else if (data && data.length > 0) {
        const loaded: ChatMessage[] = data.map((m: any) => {
          const isBot = m.is_bot === true
            || /^(🦢|🤖) \*\*\w+.*?:\*\*/.test(m.content || '')
            || (m.content || '').startsWith('👑 **OpenSwan:**');
          return {
            id: m.id,
            dbId: m.id,
            content: isBot
              ? (m.content || '').replace(/^(🦢|🤖) \*\*\w+.*?:\*\* /, '').replace(/^👑 \*\*OpenSwan:\*\* /, '')
              : (m.content || ''),
            isBot,
            isUser: m.user_id === user?.id && !isBot,
            userName: isBot ? agentName : (m.user?.display_name || m.user?.username || 'Unknown'),
            timestamp: new Date(m.created_at),
            reactions: m.reactions || {},
            replyTo: null,
            isCheckIn: (m.content || '').toLowerCase().includes('checked in') || (m.content || '').toLowerCase().includes('streak'),
            isAchievement: (m.content || '').toLowerCase().includes('achievement') || (m.content || '').toLowerCase().includes('unlocked'),
          };
        });
        setMessages(loaded);
      }
    } catch (e) { 
      console.error('[ChatTab] Unexpected error loading messages:', e);
    }

    // Check wallet
    try {
      const w = await getConnectedWallet();
      if (w) setWallet(w);
    } catch (e) { /* no wallet */ }

    // Load Discord config
    try {
      const dConfig = await getCircleDiscordConfig(circleId);
      setDiscordConfig(dConfig);
      if (dConfig.guild_id) {
        const chans = await getCachedChannels(circleId);
        setDiscordChannels(chans.filter(c => isTextChannel(c.type)).map(c => c.name));
      }
    } catch (e) { /* no discord */ }

    // Load proposals and pinned messages
    try {
      const props = await getProposals(circleId, 'active');
      setProposals(props);
      const pins = await getPinnedMessages(circleId);
      setPinnedMessages(pins);
    } catch (e) { /* tables may not exist yet */ }

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
    if (!circleId || !currentUserId) return;

    const channel = supabase
      .channel(`circle-chat-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `circle_id=eq.${circleId}`,
      }, (payload: any) => {
        const newMsg = payload.new;
        // Skip messages we sent ourselves — BUT allow bot messages from FloatingChat
        const isBotFromPopout = newMsg.is_bot === true || /^(🦢|🤖) \*\*\w+/.test(newMsg.content || '');
        if (newMsg.user_id === currentUserId && !isBotFromPopout) return;

        // Detect bot messages even if is_bot column not yet migrated
        const isBotMsg = newMsg.is_bot === true
          || /^(🦢|🤖) \*\*\w+.*?:\*\*/.test(newMsg.content || '')
          || (newMsg.content || '').startsWith('👑 **OpenSwan:**');

        const msg: ChatMessage = {
          id: newMsg.id,
          dbId: newMsg.id,
          content: isBotMsg
            ? (newMsg.content || '').replace(/^(🦢|🤖) \*\*\w+.*?:\*\* /, '').replace(/^👑 \*\*OpenSwan:\*\* /, '')
            : (newMsg.content || ''),
          isBot: isBotMsg,
          isUser: false,
          userName: isBotMsg ? agentName : 'Circle Member',
          timestamp: new Date(newMsg.created_at),
          reactions: newMsg.reactions || {},
          replyTo: null,
          isCheckIn: (newMsg.content || '').toLowerCase().includes('checked in'),
          isAchievement: (newMsg.content || '').toLowerCase().includes('achievement'),
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
          // Dedup: skip if we already have this message
          if (prev.some(m => m.dbId === newMsg.id)) return prev;
          return [...prev, msg];
        });
        animateNewMessage(msg.id);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, currentUserId]);

  // Auto-scroll to bottom — on new messages and after initial load
  const prevMsgCount = useRef(0);
  const loadTimestamp = useRef(Date.now());
  useEffect(() => {
    if (messages.length === 0) return;
    const isNewMsg = messages.length > prevMsgCount.current && prevMsgCount.current > 0;
    prevMsgCount.current = messages.length;
    if (isNewMsg) {
      // New message: smooth scroll
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } else {
      // Initial load / refresh: reset the window and keep scrolling
      loadTimestamp.current = Date.now();
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 300);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 800);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 1500);
    }
  }, [messages.length]);

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
          const { data, error } = await supabase.from('messages').insert({
            circle_id: circleId,
            user_id: currentUserId,
            content,
            reactions: {},
            is_bot: false,
            ...(replyTo?.dbId ? { reply_to: replyTo.dbId } : {}),
          }).select('id').single();

          if (error) {
            // If schema migration hasn't run yet, retry without new columns
            if (error.code === 'PGRST204' || error.code === '42703') {
              console.warn('[ChatTab] Retrying insert without is_bot/reactions (migration pending)');
              const { data: d2, error: e2 } = await supabase.from('messages').insert({
                circle_id: circleId,
                user_id: currentUserId,
                content,
              }).select('id').single();
              if (!e2 && d2) {
                setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, dbId: d2.id } : m));
              } else {
                console.error('[ChatTab] Fallback insert failed:', e2?.message);
              }
              return;
            }
            console.error('[ChatTab] Error persisting message (attempt', attempt + 1, '):', error.code, error.message);
            if (attempt < 3) {
              setTimeout(() => persistMessage(attempt + 1), 1000 * (attempt + 1));
            }
          } else if (data) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, dbId: data.id } : m));
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

    return msg;
  };

  const addBotMessage = (content: string, artifacts?: SwanBotStructuredArtifact[], extra?: { delegatedTo?: string; memoriesUsed?: string[]; localOnly?: boolean }) => {
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
      delegatedTo: extra?.delegatedTo,
      memoriesUsed: extra?.memoriesUsed,
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
    if (currentUserId && !extra?.localOnly) {
      const persistBot = async (attempt = 0) => {
        try {
          const { error } = await supabase.from('messages').insert({
            circle_id: circleId,
            user_id: currentUserId,
            content: `🤖 **${agentName}:** ${content}`,
            reactions: {},
            is_bot: true,
          });
          if (error) {
            // Schema migration pending — retry without new columns
            if (error.code === 'PGRST204' || error.code === '42703') {
              console.warn('[ChatTab] Bot message: retrying without is_bot/reactions');
              await supabase.from('messages').insert({
                circle_id: circleId,
                user_id: currentUserId,
                content: `🤖 **${agentName}:** ${content}`,
              });
              return;
            }
            console.error('[ChatTab] Error persisting bot message (attempt', attempt + 1, '):', error.code, error.message);
            if (attempt < 3) setTimeout(() => persistBot(attempt + 1), 1000 * (attempt + 1));
          }
        } catch (e) {
          console.error('[ChatTab] Unexpected error persisting bot msg:', e);
          if (attempt < 3) setTimeout(() => persistBot(attempt + 1), 1000 * (attempt + 1));
        }
      };
      persistBot();
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
    const content = (overrideText || input).trim();
    if (!content) return;

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

    // Capture current attachments before clearing
    const currentAttachments = [...attachments];

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

    // ─── Conversational intent routing (natural language → actions) ─────────
    // Catches "post this to WordPress", "create a task", "remember that...", etc.
    // Only fires for non-slash-command messages
    const lowerContent = content.toLowerCase().trim();
    if (!lowerContent.startsWith('/')) {
      try {
        const { detectConversationalIntent, executeConversationalIntent } = await import('../../../lib/conversationalRouter');
        const intent = detectConversationalIntent(content, attachments as any);
        if (intent.type !== 'none') {
          setBotTyping(true);
          const result = await executeConversationalIntent(intent, {
            circleId, userId: currentUserId || '', userName: currentUserName,
            fullMessage: content, attachments: attachments as any,
          });
          setBotTyping(false);
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

    // /search query
    if (lowerContent.startsWith('/search ')) {
      const query = content.slice(8).trim();
      if (!query) { addBotMessage('🔍 Usage: /search keyword'); return; }
      const { data: results } = await supabase
        .from('messages')
        .select('content, created_at, user:profiles!user_id(display_name)')
        .eq('circle_id', circleId)
        .ilike('content', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(10);
      if (results && results.length > 0) {
        const lines = results.map((r: any) =>
          `[${new Date(r.created_at).toLocaleDateString()}] ${(r.user as any)?.display_name || 'Unknown'}: ${r.content.slice(0, 80)}`
        );
        addBotMessage(`🔍 Found ${results.length} result${results.length > 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n')}`);
      } else {
        addBotMessage(`🔍 No messages found for "${query}"`);
      }
      return;
    }

    // ─── Memory commands — /remember and /forget ────────────────────────────
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

    // ─── HF tool commands — intercept /summarize, /translate, etc. ────────────
    const hfPrefixes = ['/summarize', '/translate', '/classify', '/zero-shot', '/qa', '/imagine', '/vision', '/openmodel', '/build-page', '/code', '/speak', '/hf'];
    if (hfPrefixes.some(p => lowerContent.startsWith(p))) {
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
      } finally { setBotTyping(false); }
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

    // ─── Model capability routing — images, webpages, etc. ──────────────────
    try {
      const { routeByCapability } = await import('../../../lib/modelCapabilities');
      setBotTyping(true);
      const capResult = await routeByCapability(content, selectedModel);
      setBotTyping(false);
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

      // Build chat context from recent messages so the AI understands the conversation
      const recentMessages = messages.slice(-10);
      const chatHistory = recentMessages.map(m =>
        `${m.isBot ? 'Agent' : (m.userName || 'User')}: ${m.content.slice(0, 300)}`
      ).join('\n');

      // If replying to a specific message, prepend that context
      const replyContext = replyTo
        ? `[Replying to ${replyTo.isBot ? 'Agent' : replyTo.userName}: "${replyTo.content.slice(0, 200)}"]\n`
        : '';

      // Build attachment context for AI
      let attachmentContext = '';
      if (currentAttachments.length > 0) {
        attachmentContext = currentAttachments
          .map(a => prepareImageForAI(a))
          .join('\n');
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

      setBotTyping(true);
      try {
        const context: SwanBotContext = {
          userId: currentUserId || 'anonymous',
          circleId,
          userName: currentUserName,
          model: selectedModel !== 'auto' ? selectedModel : undefined,
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
          // Try subagent delegation — route to specialist if message matches
          let delegated = false;
          try {
            const { detectSubagent, delegateToSubagent } = await import('../../../lib/subagentRegistry');
            const { buildPluginPrompt } = await import('../../../lib/pluginRegistry');
            const subagent = detectSubagent(cleanContent);
            if (subagent) {
              setRunStatus('delegated');
              setActiveSubagent({ name: subagent.displayName, icon: subagent.icon, color: subagent.color });
              setCurrentRunStep(`${subagent.displayName} is working...`);

              // Include active plugin prompts
              const pluginPrompt = buildPluginPrompt(activePlugins);
              const augmentedPrompt = pluginPrompt ? `${pluginPrompt}\n\n${fullPrompt}` : fullPrompt;

              const result = await delegateToSubagent({
                circleId,
                userId: currentUserId || 'anonymous',
                userName: currentUserName,
                surface: 'main_chat',
                message: augmentedPrompt,
                subagent,
                model: selectedModel !== 'auto' ? selectedModel : undefined,
                chatHistory,
              });

              addBotMessage(result.response, undefined, { delegatedTo: subagent.displayName });
              delegated = true;
              setRunStatus('idle');
              setActiveSubagent(null);
              setCurrentRunStep('');

              if (profileRef.current) {
                profileRef.current = updateProfileFromMessage(profileRef.current, result.response, false);
                saveUserProfile(profileRef.current).catch(() => {});
              }
            }
          } catch { setRunStatus('idle'); setActiveSubagent(null); }

          if (!delegated) {
          const structured = await getSwanBotStructuredResponse(fullPrompt, context);
          const botResponse = structured.response;
          addBotMessage(botResponse, structured.artifacts);
          // Track bot response in behavior profile
          if (profileRef.current) {
            profileRef.current = updateProfileFromMessage(profileRef.current, botResponse, false);
            saveUserProfile(profileRef.current).catch(() => {});
          }
          // Still detect handoffs in talk mode
          const handoff = detectHandoff(botResponse, 'main_chat');
          if (handoff) {
            setPendingHandoff(handoff);
          }
          // Track in unified run system (non-blocking)
          try {
            const { createRun, updateRunStatus, addStep } = await import('../../../lib/agentRunSystem');
            const run = await createRun({
              circleId, userId: currentUserId || 'anonymous', surface: 'main_chat',
              title: cleanContent.slice(0, 100), goal: cleanContent.slice(0, 500),
              mode: 'talk', model: selectedModel !== 'auto' ? selectedModel : undefined,
            });
            if (run) {
              await addStep({ runId: run.id, circleId, stepIndex: 0, stepKind: 'message', title: 'Response', body: botResponse.slice(0, 5000) });
              await updateRunStatus(run.id, 'completed');
            }
          } catch {}
          } // close if (!delegated)
        }
      } catch (err) {
        addBotMessage("Something went wrong. Try again.");
        setRunStatus('idle');
        setActiveSubagent(null);
      }
      setBotTyping(false);
    }
  };

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

  // ─── Render Helpers ──────────────────────────────────────────────────────

  const renderInlineText = (content: string) => {
    const parts = content.split(/(@\w+)/g);
    return parts.map((part, i) => {
      if (part.startsWith('@')) {
        return <Text key={i} style={[styles.mention, { color: accentColor }]}>{part}</Text>;
      }
      const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
      return boldParts.map((bp, j) => {
        if (bp.startsWith('**') && bp.endsWith('**')) {
          return <Text key={`${i}-${j}`} style={styles.bold}>{bp.slice(2, -2)}</Text>;
        }
        return <Text key={`${i}-${j}`}>{bp}</Text>;
      });
    });
  };

  const renderArtifacts = (artifacts?: SwanBotStructuredArtifact[]) => {
    if (!artifacts || artifacts.length === 0) return null;
    return (
      <View style={styles.inlineArtifactStack}>
        {artifacts.map((artifact, index) => (
          <View key={`${artifact.title}-${index}`} style={styles.inlineArtifactCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <View style={{ width: 18, height: 18, borderRadius: 2, backgroundColor: accentColor + '20', justifyContent: 'center', alignItems: 'center' }}>
                <Text style={{ color: accentColor, fontSize: 8, fontWeight: '800', fontFamily: 'monospace' }}>
                  {artifact.kind === 'image' ? 'IMG' : artifact.kind === 'webpage' ? 'WEB' : artifact.kind === 'code' ? '</>' : artifact.kind === 'audio' ? 'AUD' : 'TXT'}
                </Text>
              </View>
              <Text style={[styles.inlineArtifactTitle, { color: accentColor, flex: 1 }]} numberOfLines={1}>{artifact.title}</Text>
              {(artifact.metadata as any)?.model && (
                <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: 'monospace' }}>{String((artifact.metadata as any).model)}</Text>
              )}
            </View>
            {/* Image — URL or base64 data URI */}
            {artifact.kind === 'image' && artifact.url ? (
              <View>
                <Image source={{ uri: artifact.url }} style={styles.inlineArtifactImage} resizeMode="contain" />
                {Platform.OS === 'web' && artifact.url.startsWith('data:') ? (
                  <Pressable
                    onPress={() => {
                      const w = window.open('');
                      if (w) { w.document.write(`<img src="${artifact.url}" style="max-width:100%;background:#000">`); w.document.title = artifact.title; }
                    }}
                    style={{ marginTop: 4, alignSelf: 'flex-start', backgroundColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}
                  >
                    <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: 'monospace' }}>Open Full Size</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {/* Webpage — live iframe preview on web */}
            {artifact.kind === 'webpage' && artifact.content && Platform.OS === 'web' ? (
              <View>
                <View style={{ height: 300, borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
                  <iframe
                    srcDoc={artifact.content}
                    style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#0a0a10' } as any}
                    sandbox="allow-scripts allow-same-origin"
                    title={artifact.title}
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pressable
                    onPress={() => {
                      const w = window.open('');
                      if (w) { w.document.write(artifact.content!); w.document.close(); w.document.title = artifact.title; }
                    }}
                    style={{ backgroundColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}
                  >
                    <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: 'monospace' }}>Open in New Tab</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const blob = new Blob([artifact.content!], { type: 'text/html' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `${artifact.title.replace(/\s+/g, '-').toLowerCase()}.html`;
                      a.click(); URL.revokeObjectURL(url);
                    }}
                    style={{ backgroundColor: '#1a1a28', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}
                  >
                    <Text style={{ color: '#a0a0b0', fontSize: 9, fontFamily: 'monospace' }}>Download HTML</Text>
                  </Pressable>
                </View>
              </View>
            ) : (artifact.kind === 'webpage' || artifact.kind === 'code') && artifact.content ? (
              <ScrollView horizontal style={styles.inlineArtifactCodeScroll} contentContainerStyle={styles.inlineArtifactCodeContent}>
                <Text style={styles.inlineArtifactCode}>{artifact.content.slice(0, 2000)}</Text>
              </ScrollView>
            ) : null}
            {/* Text content for other kinds */}
            {artifact.kind !== 'image' && artifact.kind !== 'code' && artifact.kind !== 'webpage' && artifact.content ? (
              <Text style={styles.inlineArtifactText}>{artifact.content}</Text>
            ) : null}
            {artifact.kind === 'audio' && artifact.url ? (
              <Text style={styles.inlineArtifactMeta}>Audio artifact generated.</Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  };

  const renderContent = (item: ChatMessage) => {
    return (
      <View>
        {/* Subagent delegation badge */}
        {item.delegatedTo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            <View style={{ backgroundColor: '#a855f715', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#a855f730', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Text style={{ color: '#a855f7', fontSize: 8, fontWeight: '700', fontFamily: 'monospace' }}>{item.delegatedTo.toUpperCase()}</Text>
            </View>
          </View>
        )}
        <Text style={[styles.msgContent, { color: messageDensity === 'compact' ? '#bbb' : '#ccc' }]}>
          {renderInlineText(item.content)}
        </Text>
        {renderArtifacts(item.artifacts)}
        {/* Memory source citations — which memories informed this response */}
        {item.memoriesUsed && item.memoriesUsed.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 6 }}>
            <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: 'monospace' }}>Used:</Text>
            {item.memoriesUsed.map((m, i) => (
              <View key={i} style={{ backgroundColor: '#6366f110', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#6366f125' }}>
                <Text style={{ color: '#6366f1', fontSize: 7, fontFamily: 'monospace' }}>{m}</Text>
              </View>
            ))}
          </View>
        )}
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

  const isConsecutive = (index: number) => {
    if (index === 0) return false;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (prev.isBot !== curr.isBot || prev.isUser !== curr.isUser) return false;
    return curr.timestamp.getTime() - prev.timestamp.getTime() < 300000;
  };

  // ─── Render Message ──────────────────────────────────────────────────────

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const consecutive = isConsecutive(index);
    const reactionEntries = Object.entries(item.reactions).filter(([, u]) => u.length > 0);
    const messageAnim = newMessageAnims.get(item.id) || new Animated.Value(1);

    return (
      <Animated.View
        style={{
          opacity: messageAnim,
          transform: [
            {
              translateY: messageAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [20, 0],
              }),
            },
          ],
        }}
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
        />
      </Animated.View>
    );
  };

  // ─── Empty State ─────────────────────────────────────────────────────────

  const renderEmptyState = () => (
    <ScrollView contentContainerStyle={styles.emptyContainer}>
      {isFirstVisit && (
        <Animated.View
          style={[
            styles.welcomeOverlay,
            {
              opacity: welcomeAnim,
              transform: [
                {
                  scale: welcomeAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={[styles.welcomeText, { color: accentColor }]}>✨ Welcome to the Circle!</Text>
          <Text style={styles.welcomeSubtext}>Your underground network awaits...</Text>
        </Animated.View>
      )}

      <View style={[styles.heroSection, Platform.OS === 'web' && styles.heroSectionWeb]}>
        <Image
          source={{ uri: 'https://swanopoly.s3.us-east-1.amazonaws.com/SwanAI/swanai.png' }}
          style={styles.heroBotImage}
          resizeMode="contain"
        />
        <Text style={[styles.heroTitle, { color: accentColor }]}>CIRCLE CHAT</Text>
        <Text style={styles.heroSubtitle}>
          Talk with your crew. Play games. Challenge each other.{'\n'}
          Tap any button below to get started.
        </Text>
        
        {/* Activity pulse */}
        <View style={[styles.activityPulse, { borderColor: accentColor + '40' }]}>
          <Text style={styles.activityText}>{members.length - 1} members • {messages.length} messages</Text>
        </View>
      </View>

      {/* Quick actions moved to composer dropdown */}

      {/* Categories with glassmorphism */}
      <View style={styles.categorySection}>
        <View style={styles.densityToggle}>
          <Text style={styles.sectionLabel}>EXPLORE</Text>
          <Pressable
            onPress={() => setMessageDensity(messageDensity === 'compact' ? 'cozy' : 'compact')}
            style={[styles.densityButton, { borderColor: accentColor + '40' }]}
          >
            <Text style={[styles.densityButtonText, { color: accentColor }]}>
              {messageDensity === 'compact' ? '⬜ Compact' : '⬛ Cozy'}
            </Text>
          </Pressable>
        </View>

        {PROMPT_CATEGORIES.map((cat, catIdx) => (
          <GlassmorphismCard
            key={catIdx}
            category={cat}
            expanded={expandedCategory === catIdx}
            onToggle={() => setExpandedCategory(expandedCategory === catIdx ? null : catIdx)}
            onPromptPress={(text: string) => {
              if (text.endsWith(' ')) {
                setInput(text);
                inputRef.current?.focus();
              } else {
                sendMessage(text);
              }
            }}
            accentColor={accentColor}
          />
        ))}
      </View>

      {/* Tips with parallax effect */}
      <View style={styles.tipsSection}>
        <Text style={styles.sectionLabel}>💡 HOW IT WORKS</Text>
        {[
          `Type @${agentName} or tap the bot button to talk to the AI`,
          '🎮 Play games — trivia, would you rather, hot takes, and more',
          '⚔️ Challenge members — 1v1 duels, speed tasks, dares',
          '🧠 AI knows everything — tasks, streak, check-ins, who\'s slacking',
          'Hover messages to react 🔥 💪 👊 or reply ↩',
        ].map((tip, i) => (
          <TipCard key={i} tip={tip} delay={i * 150} accentColor={accentColor} />
        ))}
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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

      {messages.length === 0 ? renderEmptyState() : (
        <>
          {/* Agent identity bar — tap to rename */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a28' }}>
            <FlatIcon name="robot" size={16} />
            {editingAgentName ? (
              <TextInput
                autoFocus
                value={agentNameDraft}
                onChangeText={setAgentNameDraft}
                onSubmitEditing={() => { setAgentName(agentNameDraft); setEditingAgentName(false); }}
                onBlur={() => { setAgentName(agentNameDraft); setEditingAgentName(false); }}
                style={{ color: '#f0f0f5', fontSize: 12, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', flex: 1, paddingVertical: 2, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
                maxLength={24}
                returnKeyType="done"
              />
            ) : (
              <Pressable
                onPress={() => { setAgentNameDraft(agentName); setEditingAgentName(true); }}
                style={[{ flexDirection: 'row', alignItems: 'center', gap: 4 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: accentColor, fontSize: 12, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' }}>{agentName}</Text>
                <Text style={{ color: '#3a3a4e', fontSize: 9 }}>E</Text>
              </Pressable>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <Pressable
                onPress={() => setShowPluginPicker(prev => !prev)}
                style={[{ backgroundColor: activePlugins.length > 0 ? '#22c55e15' : '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: activePlugins.length > 0 ? '#22c55e40' : '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: activePlugins.length > 0 ? '#22c55e' : '#606075', fontSize: 8, fontWeight: '700', fontFamily: 'monospace' }}>PLUGINS{activePlugins.length > 0 ? ` ${activePlugins.length}` : ''}</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowMemoryViewer(prev => !prev)}
                style={[{ backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: '#6366f1', fontSize: 8, fontWeight: '700', fontFamily: 'monospace' }}>MEMORY</Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  const { resetAgentMind } = await import('../../../lib/swanbot');
                  const { cleared } = await resetAgentMind(circleId);
                  setMessages([]);
                  addBotMessage(`Mind reset. ${cleared > 0 ? `Cleared ${cleared} memories. ` : ''}Starting fresh.`);
                }}
                style={[{ backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={{ color: '#ef4444', fontSize: 8, fontWeight: '700', fontFamily: 'monospace' }}>RESET</Text>
              </Pressable>
            </View>
          </View>

          {/* Plugin Picker Panel */}
          {showPluginPicker && (
            <PluginPicker
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
              userId={currentUserId || undefined}
              accentColor={accentColor}
              onClose={() => setShowMemoryViewer(false)}
            />
          )}

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
                <View key={pin.id} style={styles.pinnedItem}>
                  <Text style={styles.pinnedItemText} numberOfLines={2}>{pin.message_content || '(message)'}</Text>
                  <Text style={styles.pinnedItemMeta}>pinned by {pin.pinned_by_name || 'member'}</Text>
                </View>
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
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => {
              // Keep scrolling to bottom for 2s after messages load (covers async image renders)
              if (Date.now() - loadTimestamp.current < 2000) {
                flatListRef.current?.scrollToEnd({ animated: false });
              }
            }}
            onLayout={() => {
              if (messages.length > 0) {
                flatListRef.current?.scrollToEnd({ animated: false });
              }
            }}
          />
          
          {/* Quick actions moved to composer dropdown */}
        </>
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

      {/* Enhanced typing indicator */}
      {botTyping && (
        <View style={[styles.typingBar, { borderColor: accentColor + '20' }]}>
          <View style={[styles.typingDot, { backgroundColor: accentColor }]} />
          <Text style={styles.typingText}>Agent is thinking...</Text>
          <TypingDots />
        </View>
      )}

      {/* Enhanced mention popup */}
      {showMentions && filteredMembers.length > 0 && (
        <EnhancedMentionPopup
          members={filteredMembers}
          onSelect={insertMention}
          accentColor={accentColor}
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

      {/* ── Agent Assign/Spawn Panels ── */}
      {showSpawnPanel && (
        <View style={{ marginHorizontal: 16, marginBottom: 8, borderWidth: 1, borderColor: '#22c55e30', borderRadius: 12, overflow: 'hidden', maxWidth: 860, alignSelf: 'center' as any, width: '100%' }}>
          <SpawnAgentPanel
            circleId={circleId}
            onCreated={(_id: string, _name: string) => {
              setShowSpawnPanel(false);
              supabase.from('circle_office_agents')
                .select('id, name, status, owner_id, color, tool_icon, owner_display_name, current_task, circle_id, provider')
                .neq('status', 'offline').order('status').limit(50)
                .then(({ data }) => { if (data) setLiveAgents(data); });
            }}
            onCancel={() => setShowSpawnPanel(false)}
          />
        </View>
      )}

      {showAssignPanel && (
        <View style={{ marginHorizontal: 16, marginBottom: 8, padding: 14, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 12, maxWidth: 860, alignSelf: 'center' as any, width: '100%' }}>
          <Text style={{ color: '#606075', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 }}>SELECT AGENT</Text>
          {liveAgents.length === 0 ? (
            <Text style={{ color: '#555', fontSize: 11, fontStyle: 'italic', marginBottom: 8 }}>No agents online — connect one in the Office tab</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {liveAgents.map((agent: any) => {
                const isSelected = selectedAgent?.id === agent.id;
                const dotColor = ({ active: '#22c55e', idle: '#f59e0b', building: '#6366f1', error: '#ef4444' } as any)[agent.status] || '#888';
                const agentColor = agent.color || accentColor;
                return (
                  <Pressable key={agent.id} onPress={() => setSelectedAgent(isSelected ? null : agent)}
                    accessibilityRole="button" accessibilityLabel={`Select ${agent.name}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: isSelected ? agentColor + '70' : '#2a2a3e', backgroundColor: isSelected ? agentColor + '15' : '#111118', marginRight: 8 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
                    <View>
                      <Text style={{ color: isSelected ? agentColor : '#f0f0f5', fontSize: 12, fontWeight: '600' }}>{agent.name}</Text>
                      {agent.provider && <Text style={{ color: '#58a6ff', fontSize: 9, fontWeight: '600', textTransform: 'uppercase' as any, letterSpacing: 0.5 }}>{agent.provider}</Text>}
                    </View>
                    {isSelected && <Text style={{ color: agentColor, fontSize: 12 }}>{'✓'}</Text>}
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <Text style={{ color: '#606075', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6 }}>TASK</Text>
          <TextInput
            style={{ backgroundColor: '#1a1a28', color: '#f0f0f5', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a3e', padding: 10, fontSize: 13, minHeight: 50, maxHeight: 100 }}
            value={taskPrompt} onChangeText={setTaskPrompt}
            placeholder={`What should ${selectedAgent?.name || 'the agent'} do?`}
            placeholderTextColor="#555" multiline
          />
          <Pressable
            onPress={async () => {
              if (!selectedAgent || !taskPrompt.trim()) return;
              setAssigning(true);
              addUserMessage(`@${selectedAgent.name}: ${taskPrompt.trim()}`);
              setBotTyping(true);
              try {
                const provider = (selectedAgent.provider || '').toLowerCase().replace(/\s+/g, '-');
                const bridgeProviders = ['claude-code', 'codex', 'gemini', 'gemini-cli', 'cursor'];
                let response = '';
                if (bridgeProviders.includes(provider)) {
                  const result = await wakeAndAssignTask(
                    provider, selectedAgent.name, taskPrompt.trim(),
                    circleId, selectedAgent.id,
                  );
                  if (result.ok) {
                    response = `**${selectedAgent.name}** [executed via ${provider}]:\n\n${result.response || 'Done'}`;
                  } else {
                    const aiResp = await getAIResponse(`[Task for ${selectedAgent.name}] ${taskPrompt.trim()}`, { userId: currentUserId || '', circleId, userName: currentUserName });
                    response = `**${selectedAgent.name}** [AI draft — not executed by agent]:\n\n${aiResp}`;
                  }
                } else {
                  const aiResp = await getAIResponse(`[Task for ${selectedAgent.name}] ${taskPrompt.trim()}`, { userId: currentUserId || '', circleId, userName: currentUserName });
                  response = `**${selectedAgent.name}** (via Agent AI):\n\n${aiResp}`;
                }
                addBotMessage(response);
                await supabase.from('circle_office_agents')
                  .update({ current_task: null, status: 'active' })
                  .eq('id', selectedAgent.id);
              } catch (e: any) {
                addBotMessage(`**${selectedAgent.name}** failed: ${e.message || 'Unknown error'}`);
              } finally {
                setBotTyping(false); setAssigning(false);
                setTaskPrompt(''); setSelectedAgent(null); setShowAssignPanel(false);
              }
            }}
            disabled={!selectedAgent || !taskPrompt.trim() || assigning}
            accessibilityRole="button"
            style={{ backgroundColor: accentColor, borderRadius: 10, paddingVertical: 12, alignItems: 'center' as any, marginTop: 10, opacity: selectedAgent && taskPrompt.trim() && !assigning ? 1 : 0.4 }}>
            <Text style={{ color: '#000', fontSize: 13, fontWeight: '700' }}>{assigning ? 'Assigning...' : 'Assign Task'}</Text>
          </Pressable>
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
                setComputerUseSession(s => s ? { ...s, status: result.success ? 'completed' : 'failed', actions: result.actions } : s);
                addBotMessage(`**Computer Use** ${result.success ? 'completed' : 'failed'}: ${result.message}`);
              }).catch(() => {
                setComputerUseSession(s => s ? { ...s, status: 'failed' } : s);
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
                setComputerUseSession(s => s ? { ...s, status: result.success ? 'completed' : 'failed', actions: result.actions } : s);
                addBotMessage(`**Computer Use** ${result.success ? 'completed' : 'failed'}: ${result.message}`);
              }).catch(() => {
                setComputerUseSession(s => s ? { ...s, status: 'failed' } : s);
              });
              return resumed;
            });
          }}
          onCancel={() => {
            setComputerUseSession(null);
          }}
          accentColor={accentColor}
        />
      )}

      {/* Computer-Use Permission Dialog (web only) */}
      {Platform.OS === 'web' && showComputerUsePermission && pendingComputerUseActions.length > 0 && (
        <ComputerUsePermissionDialog
          task={pendingComputerUseTask}
          agentName={agentName}
          actions={pendingComputerUseActions}
          onAllow={(permission: ComputerUsePermission) => {
            setShowComputerUsePermission(false);
            const session = createComputerUseSession(agentName, pendingComputerUseTask, permission);
            session.actions = pendingComputerUseActions.map(a => ({
              ...a,
              status: permission === 'trusted' ? 'approved' as const : 'pending' as const,
            }));
            session.status = permission === 'trusted' ? 'executing' : 'awaiting_approval';
            setComputerUseSession(session);
            addBotMessage(`**Computer Use** session started: ${session.task} (${session.actions.length} actions planned)`);
            // Auto-execute if trusted
            if (session.status === 'executing') {
              executeComputerUsePlan(session, (completedAction, idx) => {
                setComputerUseSession(s => {
                  if (!s) return s;
                  const newActions = [...s.actions];
                  newActions[idx] = completedAction;
                  return { ...s, actions: newActions };
                });
              }).then(result => {
                setComputerUseSession(s => s ? { ...s, status: result.success ? 'completed' : 'failed', actions: result.actions } : s);
                addBotMessage(`**Computer Use** ${result.success ? 'completed' : 'failed'}: ${result.message}`);
              }).catch(() => {
                setComputerUseSession(s => s ? { ...s, status: 'failed' } : s);
              });
            }
            setPendingComputerUseTask('');
            setPendingComputerUseActions([]);
          }}
          onDeny={() => {
            setShowComputerUsePermission(false);
            setPendingComputerUseTask('');
            setPendingComputerUseActions([]);
          }}
        />
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
        currentStep={currentRunStep}
        accentColor={accentColor}
      />

      <EnhancedInput
        input={input}
        onInputChange={handleInputChange}
        onSend={sendMessage}
        onFocusBot={() => {
          if (!input.includes('@Agent')) setInput('@Agent ' + input);
          inputRef.current?.focus();
        }}
        inputRef={inputRef}
        accentColor={accentColor}
        selectedModel={selectedModel}
        onModelChange={setSelectedModel}
        attachments={attachments}
        onPickImage={async () => {
          const result = await pickImage();
          if (result) setAttachments(prev => [...prev, result]);
        }}
        onRemoveAttachment={(id: string) => setAttachments(prev => prev.filter(a => a.id !== id))}
        chatMode={chatMode}
        onModeChange={setChatMode}
        agentName={agentName}
        onQuickAction={(text: string) => {
          if (text === '__SEND_CRYPTO__') { setShowSendCrypto(true); return; }
          if (text === '__CHECK_IN__') { setShowQuickCheckIn(true); return; }
          if (text === '__NEW_TASK__') { setShowQuickNewTask(true); return; }
          if (text === '__STEP_AWAY__') { setShowQuickStepAway(true); return; }
          if (text === '__ASSIGN_AGENT__') { setShowAssignPanel(true); setShowSpawnPanel(false); return; }
          if (text === '__SPAWN_AGENT__') { setShowSpawnPanel(true); setShowAssignPanel(false); return; }
          if (text === '__COMPUTER_USE__') {
            if (Platform.OS !== 'web') return;
            // Show the task input by prompting the user
            const taskText = window.prompt('What should the agent do in the browser?');
            if (!taskText || !taskText.trim()) return;
            setPendingComputerUseTask(taskText.trim());
            setBotTyping(true);
            planComputerUseActions(taskText.trim()).then(actions => {
              setBotTyping(false);
              setPendingComputerUseActions(actions);
              setShowComputerUsePermission(true);
            }).catch(() => {
              setBotTyping(false);
              // Fallback plan
              const fallback: BrowserAction[] = [{
                id: `action_${Date.now()}_0`, type: 'navigate', target: taskText.trim(),
                description: `Complete: ${taskText.trim()}`, requiresApproval: true, status: 'pending',
              }];
              setPendingComputerUseActions(fallback);
              setShowComputerUsePermission(true);
            });
            return;
          }
          if (text === '__NUKE__') {
            const msg = 'Delete ALL messages in this circle? This cannot be undone.';
            const doNuke = async () => {
              const { error } = await supabase.from('messages').delete().eq('circle_id', circleId);
              if (!error) setMessages([]);
            };
            if (Platform.OS === 'web') { if (window.confirm(msg)) doNuke(); }
            else { import('react-native').then(({ Alert }) => Alert.alert('Nuke Chat', msg, [{ text: 'Cancel' }, { text: 'Delete All', style: 'destructive', onPress: doNuke }])); }
            return;
          }
          if (text.endsWith(' ')) { setInput(text); inputRef.current?.focus(); return; }
          sendMessage(text);
        }}
      />
    </KeyboardAvoidingView>
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
  showReactions, onToggleReactions, onReply, onReaction, onDelete, renderContent, accentColor, messageDensity,
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
              <FlatIcon name="robot" size={18} />
            ) : (
              <Text style={styles.msgAvatarText}>
                {(item.userName || '?').charAt(0).toUpperCase()}
              </Text>
            )}
          </View>
          <Text style={[styles.msgName, item.isBot && { color: accentColor }]}>
            {item.userName || 'Unknown'}
          </Text>
          {item.isBot && (
            <View style={[styles.aiBadge, { backgroundColor: accentColor + '30' }]}>
              <Text style={[styles.aiBadgeText, { color: accentColor }]}>AI</Text>
            </View>
          )}
          <Text style={styles.msgTime}>
            {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
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

function EnhancedMentionPopup({ members, onSelect, accentColor }: any) {
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
              <FlatIcon name="robot" size={16} />
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

// ─── Model selector data ─────────────────────────────────────────────────────
const CHAT_MODE_CONFIG = [
  { key: 'none', label: 'Off', desc: 'No agent mode — direct AI responses', icon: '--', color: '#606075' },
  { key: 'talk', label: 'Talk', desc: 'General conversation', icon: '..', color: '#a855f7' },
  { key: 'plan', label: 'Plan', desc: 'Create implementation plans', icon: 'P', color: '#6366f1' },
  { key: 'execute', label: 'Execute', desc: 'Do the work, ship code', icon: '!', color: '#f59e0b' },
  { key: 'review', label: 'Review', desc: 'Review code and work', icon: '?', color: '#22d3ee' },
  { key: 'research', label: 'Research', desc: 'Deep dive into a topic', icon: 'R', color: '#a855f7' },
  { key: 'support', label: 'Support', desc: 'Help and troubleshoot', icon: 'S', color: '#3b82f6' },
  { key: 'design', label: 'Design', desc: 'UI/UX design work', icon: 'D', color: '#ec4899' },
];

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
];

const MODEL_GROUPS: { key: string; label: string; color: string }[] = [
  { key: 'smart', label: 'SMART PICK', color: '#22c55e' },
  { key: 'code', label: 'CODING & ENGINEERING', color: '#a855f7' },
  { key: 'reason', label: 'REASONING & RESEARCH', color: '#f59e0b' },
  { key: 'speed', label: 'SPEED & COST', color: '#22d3ee' },
  { key: 'creative', label: 'CREATIVE & MULTIMODAL', color: '#10b981' },
  { key: 'open', label: 'OPEN SOURCE', color: '#f59e0b' },
];

function EnhancedInput({ input, onInputChange, onSend, onFocusBot, inputRef, accentColor, selectedModel, onModelChange, onQuickAction, attachments, onPickImage, onRemoveAttachment, chatMode, onModeChange, agentName }: any) {
  const [focused, setFocused] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showModePicker, setShowModePicker] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [customModels, setCustomModels] = useState<any[]>([]);
  const [hoveredModel, setHoveredModel] = useState<string | null>(null);
  const [hoveredAction, setHoveredAction] = useState<number | null>(null);

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

  const handleKeyPress = useCallback((e: any) => {
    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      if (input.trim()) onSend();
    }
  }, [input, onSend]);

  const allModels = [...CHAT_MODELS, ...customModels];
  const currentModel = allModels.find(m => m.id === selectedModel) || CHAT_MODELS[0];

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
            <View style={[styles.dropdownPanel, { maxHeight: 480, width: 300 }, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)', overflowY: 'auto' } as any] : [])]}>
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
            </View>
          )}

          {/* Add Model Panel */}
          {showModelPicker && showAddModel && (
            <View style={[styles.dropdownPanel, styles.dropdownPanelWide, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)' } as any] : [])]}>
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
            </View>
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
            <View style={[styles.dropdownPanel, styles.dropdownPanelWide, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' } as any] : [])]}>
              <Text style={styles.dropdownTitle}>Quick Actions</Text>
              {QUICK_PROMPTS.map((p, i) => (
                <Pressable
                  key={i}
                  onPress={() => { onQuickAction(p.text); setShowQuickActions(false); }}
                  onHoverIn={() => setHoveredAction(i)}
                  onHoverOut={() => setHoveredAction(null)}
                  accessibilityRole="button"
                  accessibilityLabel={p.label}
                  style={[
                    styles.dropdownItem,
                    hoveredAction === i && { backgroundColor: '#1a1a28' },
                    ...(Platform.OS === 'web' ? [{ transition: 'all 0.15s ease', cursor: 'pointer' } as any] : []),
                  ]}
                >
                  <Text style={styles.dropdownActionLabel}>{p.label}</Text>
                </Pressable>
              ))}
              <View style={styles.dropdownDivider} />
              {PROMPT_CATEGORIES.map((cat, ci) => (
                <View key={ci}>
                  <Text style={[styles.dropdownCategoryTitle, { color: cat.color }]}>{cat.title}</Text>
                  {cat.prompts.map((p, pi) => (
                    <Pressable
                      key={pi}
                      onPress={() => { onQuickAction(p.text); setShowQuickActions(false); }}
                      onHoverIn={() => setHoveredAction(100 + ci * 20 + pi)}
                      onHoverOut={() => setHoveredAction(null)}
                      accessibilityRole="button"
                      accessibilityLabel={p.label}
                      style={[
                        styles.dropdownItem, { paddingLeft: 20 },
                        hoveredAction === 100 + ci * 20 + pi && { backgroundColor: cat.color + '10' },
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
              ))}
            </View>
          )}
        </View>

        {/* Mode Selector Dropdown */}
        <View style={{ position: 'relative' as const }}>
          <Pressable
            onPress={() => { setShowModePicker(!showModePicker); setShowModelPicker(false); setShowQuickActions(false); }}
            accessibilityRole="button"
            accessibilityLabel={`Mode: ${(chatMode || 'talk').charAt(0).toUpperCase() + (chatMode || 'talk').slice(1)}`}
            style={[
              styles.modelButton,
              { borderColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || '#22c55e') + '50' },
              ...(Platform.OS === 'web' ? [{ transition: 'all 0.2s ease', cursor: 'pointer' } as any] : []),
            ]}
          >
            <View style={[styles.modelIconBox, { backgroundColor: (CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || '#22c55e') + '20' }]}>
              <Text style={[styles.modelIconText, { color: CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || '#22c55e' }]}>
                {CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.icon || '..'}
              </Text>
            </View>
            <Text style={[styles.modelButtonLabel, { color: CHAT_MODE_CONFIG.find(m => m.key === (chatMode || 'talk'))?.color || '#22c55e' }]}>
              {(chatMode || 'talk').charAt(0).toUpperCase() + (chatMode || 'talk').slice(1)}
            </Text>
            <Text style={styles.modelChevron}>{showModePicker ? '▲' : '▼'}</Text>
          </Pressable>

          {showModePicker && (
            <View style={[styles.dropdownPanel, ...(Platform.OS === 'web' ? [{ boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(12px)' } as any] : [])]}>
              <Text style={styles.dropdownTitle}>Agent Mode</Text>
              {CHAT_MODE_CONFIG.map(m => {
                const isActive = (chatMode || 'talk') === m.key;
                return (
                  <Pressable
                    key={m.key}
                    onPress={() => { onModeChange?.(m.key); setShowModePicker(false); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${m.label} mode`}
                    style={[
                      styles.dropdownItem,
                      isActive && { backgroundColor: m.color + '18', borderColor: m.color + '40' },
                      ...(Platform.OS === 'web' ? [{ transition: 'all 0.15s ease', cursor: 'pointer' } as any] : []),
                    ]}
                  >
                    <View style={[styles.dropdownItemIcon, { backgroundColor: m.color + '20' }]}>
                      <Text style={[styles.dropdownItemIconText, { color: m.color }]}>{m.icon}</Text>
                    </View>
                    <View style={styles.dropdownItemText}>
                      <Text style={[styles.dropdownItemLabel, isActive && { color: m.color }]}>{m.label}</Text>
                      <Text style={styles.dropdownItemDesc}>{m.desc}</Text>
                    </View>
                    {isActive && <View style={[styles.dropdownActiveDot, { backgroundColor: m.color }]} />}
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>
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
          <FlatIcon name="robot" size={18} />
        </Pressable>
        <Pressable
          onPress={onPickImage}
          style={[styles.enhancedBotTrigger, { backgroundColor: '#2a2a3e40' }]}
          accessibilityRole="button"
          accessibilityLabel="Attach image"
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
          onSubmitEditing={() => onSend()}
          onKeyPress={handleKeyPress}
          returnKeyType="send"
          multiline
          maxLength={1000}
          onFocus={() => { setFocused(true); setShowModelPicker(false); setShowQuickActions(false); }}
          onBlur={() => setFocused(false)}
        />
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <EnhancedSendInputButton onPress={() => onSend()} disabled={!input.trim()} accentColor={accentColor} />
        </Animated.View>
      </View>
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
    maxWidth: 860, alignSelf: 'center', width: '100%',
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
  emptyContainer: { padding: 20, maxWidth: 860, alignSelf: 'center', width: '100%' },
  heroSection: { alignItems: 'center', paddingTop: 100, paddingBottom: 20 },
  heroSectionWeb: {},
  heroBotAvatar: {
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    ...(Platform.OS === 'web' ? { className: 'bot-float-anim' } as any : {}),
  } as any,
  heroBotEmoji: { fontSize: 36 },
  heroBotImage: { width: 180, height: 180, marginBottom: 4 },
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

  // Enhanced messages
  messageList: { padding: 16, maxWidth: 860, alignSelf: 'center', width: '100%', flexGrow: 1, paddingTop: 16 },
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
  aiBadge: { borderRadius: 12, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
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
  msgContent: { fontSize: 15, lineHeight: 22 },
  mention: { fontWeight: '700', backgroundColor: '#1a1a1a', paddingHorizontal: 4, borderRadius: 12 },
  bold: { fontWeight: '800', color: '#fff' },
  inlineArtifactStack: {
    marginTop: 10,
    gap: 8,
  },
  inlineArtifactCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#24243a',
    backgroundColor: '#0b0b12',
    padding: 10,
  },
  inlineArtifactTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  inlineArtifactText: {
    color: '#d7d7e1',
    fontSize: 13,
    lineHeight: 18,
  },
  inlineArtifactMeta: {
    color: '#8a8aa3',
    fontSize: 12,
  },
  inlineArtifactImage: {
    width: '100%' as any,
    height: 220,
    borderRadius: 10,
    backgroundColor: '#111118',
  },
  inlineArtifactCodeScroll: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1f1f2f',
    backgroundColor: '#08080d',
  },
  inlineArtifactCodeContent: {
    padding: 10,
  },
  inlineArtifactCode: {
    color: '#d8f0d0',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
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
    maxWidth: 860,
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
    maxWidth: 860,
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
    maxWidth: 860,
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
    maxWidth: 860,
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
    maxWidth: 860,
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
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
    gap: 10,
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
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modelButtonLabel: {
    fontSize: 12,
    fontWeight: '600',
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
    borderColor: '#2a2a3e',
    backgroundColor: '#0a0a10',
  },
  quickActionsIcon: {
    fontSize: 14,
    fontWeight: '700',
  },
  quickActionsLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#a0a0b0',
  },
  dropdownPanel: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: 6,
    width: 220,
    backgroundColor: '#0f0f18',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 14,
    paddingVertical: 8,
    zIndex: 100,
    maxHeight: 400,
    ...(Platform.OS === 'web' ? { overflowY: 'auto' } as any : {}),
  },
  dropdownPanelWide: {
    width: 280,
    maxHeight: 480,
  },
  dropdownTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#606075',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: 'transparent',
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
  },
  dropdownItemLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f0f0f5',
  },
  dropdownItemDesc: {
    fontSize: 11,
    color: '#606075',
    marginTop: 1,
  },
  dropdownActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#1a1a28',
    marginVertical: 6,
    marginHorizontal: 14,
  },
  dropdownCategoryTitle: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  dropdownActionLabel: {
    fontSize: 13,
    color: '#f0f0f5',
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
