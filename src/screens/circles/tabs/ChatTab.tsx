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
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { getSwanBotResponse as getAIResponse, SwanBotContext } from '../../../lib/swanbot';
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
import ProposalCard from '../../../components/ProposalCard';
import StepAwayCard from '../../../components/StepAwayCard';
import { Proposal, PinnedMessage } from '../../../types';

const REACTIONS_LIST = ['🔥', '💪', '👊', '💯', '⚡', '🎯'];
const BLACKSWAN_ID = 'blackswan';

// ─── Prompt Categories ───────────────────────────────────────────────────────

const QUICK_PROMPTS = [
  { label: '📅 Daily Plan', text: 'daily plan' },
  { label: '🎮 Play a Game', text: 'play a game' },
  { label: '📊 Status', text: 'status' },
  { label: '🔥 My Streak', text: 'my streak' },
  { label: '🗳️ Vote', text: '/proposals' },
  { label: '💸 Send Crypto', text: '__SEND_CRYPTO__' },
  { label: '⚔️ Challenge', text: 'challenge a member' },
];

const PROMPT_CATEGORIES = [
  {
    title: '🎮 GAMES & FUN',
    color: '#ec4899',
    prompts: [
      { label: 'Trivia Battle', desc: 'Test your knowledge', text: 'trivia' },
      { label: 'Would You Rather', desc: 'Fun dilemmas for the crew', text: 'would you rather' },
      { label: 'Hot Takes', desc: 'Drop a spicy opinion', text: 'hot take' },
      { label: 'Two Truths & a Lie', desc: 'Guess which is the lie', text: 'two truths' },
      { label: 'Rate My Day', desc: 'Score your day 1-10', text: 'rate my day' },
      { label: 'This or That', desc: 'Quick picks', text: 'this or that' },
      { label: 'Roast Battle', desc: 'BlackSwan roasts everyone 😈', text: 'roast battle' },
    ],
  },
  {
    title: '⚔️ CHALLENGES',
    color: '#f43f5e',
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
    color: '#10b981',
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
    color: '#22d3ee',
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
    color: '#8b5cf6',
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
    color: '#f59e0b',
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

// ─── Main Component ──────────────────────────────────────────────────────────

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

  const init = async () => {
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

    // Check if first visit
    const visitKey = `circle_${circleId}_visited`;
    const hasVisited = localStorage?.getItem(visitKey);
    if (!hasVisited) {
      setIsFirstVisit(true);
      localStorage?.setItem(visitKey, 'true');
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
      m.push({ id: BLACKSWAN_ID, username: 'BlackSwan', display_name: 'BlackSwan 🦢' });
      setMembers(m);
    } catch (e) { /* circle may not exist yet */ }

    // Load persisted messages
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*, user:profiles(username, display_name)')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) {
        console.error('Error loading messages:', error);
      } else if (data && data.length > 0) {
        const loaded: ChatMessage[] = data.map((m: any) => ({
          id: m.id,
          dbId: m.id,
          content: m.is_bot
            ? (m.content || '').replace(/^🦢 \*\*(SwanBot|BlackSwan):\*\* /, '').replace(/^👑 \*\*KingClaw:\*\* /, '')
            : m.content,
          isBot: m.is_bot || false,
          isUser: m.user_id === user?.id && !m.is_bot,
          userName: m.is_bot ? 'BlackSwan 🦢' : (m.user?.display_name || m.user?.username || 'Unknown'),
          timestamp: new Date(m.created_at),
          reactions: m.reactions || {},
          replyTo: null,
          isCheckIn: (m.content || '').toLowerCase().includes('checked in') || (m.content || '').toLowerCase().includes('streak'),
          isAchievement: (m.content || '').toLowerCase().includes('achievement') || (m.content || '').toLowerCase().includes('unlocked'),
        }));
        setMessages(loaded);
      }
    } catch (e) { 
      console.error('Unexpected error loading messages:', e);
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

    setLoaded(true);
  };

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
        // Skip messages we sent ourselves (already in local state)
        if (newMsg.user_id === currentUserId) return;

        const msg: ChatMessage = {
          id: newMsg.id,
          dbId: newMsg.id,
          content: newMsg.is_bot
            ? (newMsg.content || '').replace(/^🦢 \*\*(SwanBot|BlackSwan):\*\* /, '').replace(/^👑 \*\*KingClaw:\*\* /, '')
            : newMsg.content,
          isBot: newMsg.is_bot || false,
          isUser: false,
          userName: newMsg.is_bot ? 'BlackSwan 🦢' : 'Circle Member',
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

  // Auto-scroll with animation
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
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
    const color = isAchievement ? '#ffd700' : accentColor;
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
          }).select('id').single();

          if (error) {
            console.error('Error persisting message (attempt', attempt + 1, '):', error.message);
            if (attempt < 2) {
              setTimeout(() => persistMessage(attempt + 1), 1000 * (attempt + 1));
            }
          } else if (data) {
            setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, dbId: data.id } : m));
          }
        } catch (e) {
          console.error('Unexpected error persisting:', e);
          if (attempt < 2) {
            setTimeout(() => persistMessage(attempt + 1), 1000 * (attempt + 1));
          }
        }
      };
      persistMessage();
    }

    return msg;
  };

  const addBotMessage = (content: string) => {
    const msg: ChatMessage = {
      id: `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content,
      isBot: true,
      isUser: false,
      userName: 'BlackSwan 🦢',
      timestamp: new Date(),
      reactions: {},
    };
    
    setMessages(prev => [...prev, msg]);
    animateNewMessage(msg.id);

    // Persist bot message with retry
    if (currentUserId) {
      const persistBot = async (attempt = 0) => {
        try {
          const { error } = await supabase.from('messages').insert({
            circle_id: circleId,
            user_id: currentUserId,
            content: `🦢 **BlackSwan:** ${content}`,
            reactions: {},
            is_bot: true,
          });
          if (error) {
            console.error('Error persisting bot message (attempt', attempt + 1, '):', error.message);
            if (attempt < 2) setTimeout(() => persistBot(attempt + 1), 1000 * (attempt + 1));
          }
        } catch (e) {
          console.error('Unexpected error persisting bot msg:', e);
          if (attempt < 2) setTimeout(() => persistBot(attempt + 1), 1000 * (attempt + 1));
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
      addBotMessage("🦢 No wallet connected. Connecting...");
      try {
        const wallets = { metamask: !!(window as any)?.ethereum, phantom: !!(window as any)?.solana?.isPhantom };
        if (wallets.metamask) {
          activeWallet = await connectWallet('metamask');
        } else if (wallets.phantom) {
          activeWallet = await connectWallet('phantom');
        } else {
          addBotMessage("🦢 No wallet extension found. Install **MetaMask** or **Phantom** to send crypto.");
          setSendingCrypto(false);
          return;
        }
        setWallet(activeWallet);
      } catch (e: any) {
        addBotMessage(`🦢 Wallet connection failed: ${e.message}`);
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
        addBotMessage(`🦢 Can't find wallet for **@${toAddress}**. They need to connect a wallet first, or paste their address directly.`);
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

    // Add user message immediately
    addUserMessage(content);
    setInput('');
    setReplyTo(null);
    setExpandedCategory(null);

    // ─── Governance commands ───────────────────────────────────────
    const lowerContent = content.toLowerCase().trim();

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

    // Trigger BlackSwan AI — responds to @blackswan, @swanbot, @swan, or quick prompts
    const isBotMention = /(@blackswan|@swanbot|@swan\b)/i.test(content);
    const isQuickPrompt = QUICK_PROMPTS.some(p => p.text === content) ||
      PROMPT_CATEGORIES.some(cat => cat.prompts.some(p => p.text === content));
    const shouldTriggerBot = isBotMention || isQuickPrompt;

    if (shouldTriggerBot) {
      const cleanContent = content.replace(/@(blackswan|swanbot|swan)\s*/gi, '').trim() || content;

      setBotTyping(true);
      try {
        const context: SwanBotContext = {
          userId: currentUserId || 'anonymous',
          circleId,
          userName: currentUserName,
        };

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

        const botResponse = await getAIResponse(cleanContent, context);
        addBotMessage(botResponse);
      } catch (err) {
        addBotMessage("Something went wrong. Try again.");
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

  const renderContent = (content: string) => {
    const parts = content.split(/(@\w+)/g);
    return (
      <Text style={[styles.msgContent, { color: messageDensity === 'compact' ? '#bbb' : '#ccc' }]}>
        {parts.map((part, i) => {
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
        })}
      </Text>
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
          onDelete={item.isUser ? () => deleteMessage(item.id, item.dbId) : undefined}
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
        <Animated.View style={[styles.heroBotAvatar, { backgroundColor: accentColor + '20' }]}>
          <Text style={styles.heroBotEmoji}>🦢</Text>
        </Animated.View>
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

      {/* Quick prompts with 3D effect */}
      <View style={styles.quickPromptSection}>
        <Text style={styles.sectionLabel}>QUICK ACTIONS</Text>
        <View style={styles.quickPromptRow}>
          <Pressable
            onPress={() => {
              quickScrollX.current = Math.max(0, quickScrollX.current - 200);
              quickScrollRef.current?.scrollTo({ x: quickScrollX.current, animated: true });
            }}
            style={[styles.quickArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.quickArrowText, { color: accentColor }]}>‹</Text>
          </Pressable>
          <ScrollView
            ref={quickScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickPromptScroll}
            onScroll={(e) => { quickScrollX.current = e.nativeEvent.contentOffset.x; }}
            scrollEventThrottle={16}
            style={{ flex: 1 }}
          >
            {QUICK_PROMPTS.map((p, i) => (
              <EnhancedPromptCard
                key={i}
                label={p.label}
                onPress={() => sendMessage(p.text)}
                accentColor={accentColor}
                delay={i * 100}
              />
            ))}
          </ScrollView>
          <Pressable
            onPress={() => {
              quickScrollX.current = quickScrollX.current + 200;
              quickScrollRef.current?.scrollTo({ x: quickScrollX.current, animated: true });
            }}
            style={[styles.quickArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[styles.quickArrowText, { color: accentColor }]}>›</Text>
          </Pressable>
        </View>
      </View>

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
          '🦢 Tap the swan button or type @BlackSwan to talk to the AI',
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
        <View style={styles.loadingPulse}>
          <Text style={[styles.loadingText, { color: accentColor }]}>LOADING CHAT</Text>
          <TypingDots />
        </View>
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
          />
          
          {/* Step Away / Remote Control Handoff */}
          {currentUserId && (
            <View style={styles.stepAwayRow}>
              <StepAwayCard
                circleId={circleId}
                userId={currentUserId}
                userName={currentUserName}
                onPost={async (_type, content) => {
                  await sendMessage(content);
                }}
              />
            </View>
          )}

          {/* Enhanced quick bar */}
          <EnhancedQuickBar
            onPromptPress={sendMessage}
            onSendCrypto={() => setShowSendCrypto(true)}
            accentColor={accentColor}
          />
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
            addBotMessage('🦢 Wallet disconnected.');
          }}
          onBotMessage={addBotMessage}
        />
      )}

      {/* Enhanced typing indicator */}
      {botTyping && (
        <View style={[styles.typingBar, { borderColor: accentColor + '20' }]}>
          <View style={[styles.typingDot, { backgroundColor: accentColor }]} />
          <Text style={styles.typingText}>BlackSwan is thinking...</Text>
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

      {/* Enhanced input */}
      <EnhancedInput
        input={input}
        onInputChange={handleInputChange}
        onSend={sendMessage}
        onFocusBot={() => {
          if (!input.includes('@BlackSwan')) setInput('@BlackSwan ' + input);
          inputRef.current?.focus();
        }}
        inputRef={inputRef}
        accentColor={accentColor}
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
    borderColor: expanded ? category.color + '40' : '#1a1a1a60',
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

  const messageStyle = Platform.OS === 'web' ? {
    backdropFilter: hovered ? 'blur(8px)' : 'none',
    backgroundColor: hovered ? (item.isBot ? accentColor + '08' : '#ffffff08') : 'transparent',
    transition: 'all 0.2s ease',
  } as any : {};

  const spacing = messageDensity === 'compact' ? 6 : 12;

  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
            <Text style={styles.msgAvatarText}>
              {item.isBot ? '🦢' : (item.userName || '?').charAt(0).toUpperCase()}
            </Text>
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
          {renderContent(item.content)}
        </View>
        
        {hovered && (
          <View style={[styles.enhancedHoverActions, { backgroundColor: accentColor + '20' }]}>
            {REACTIONS_LIST.slice(0, 4).map((emoji) => (
              <Pressable key={emoji} onPress={() => onReaction(emoji)} style={styles.hoverBtn}>
                <Text style={styles.hoverBtnText}>{emoji}</Text>
              </Pressable>
            ))}
            <Pressable onPress={onToggleReactions} style={styles.hoverBtn}>
              <Text style={styles.hoverBtnText}>＋</Text>
            </Pressable>
            <View style={[styles.hoverDivider, { backgroundColor: accentColor + '40' }]} />
            <Pressable onPress={onReply} style={styles.hoverBtn}>
              <Text style={styles.hoverBtnText}>↩</Text>
            </Pressable>
            {onDelete && (
              <Pressable onPress={onDelete} style={styles.hoverBtn}>
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
        <View style={[styles.specialMessageGlow, { shadowColor: item.isAchievement ? '#ffd700' : accentColor }]} />
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

function EnhancedQuickBar({ onPromptPress, onSendCrypto, accentColor }: {
  onPromptPress: (text: string) => void;
  onSendCrypto: () => void;
  accentColor: string;
}) {
  const barStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(10px)',
    borderColor: accentColor + '20',
  } as any : { borderColor: accentColor + '20' };

  return (
    <View style={[styles.enhancedQuickBar, barStyle]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickBarScroll}>
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
        <EnhancedQuickChip label="🦢 More" onPress={() => onPromptPress('help')} accentColor={accentColor} />
      </ScrollView>
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
              onBotMessage(`🦢 MetaMask: ${e.message}`);
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
              onBotMessage(`🦢 Phantom: ${e.message}`);
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
        { borderColor: active ? accentColor : '#1a1a1a', backgroundColor: active ? accentColor + '15' : '#111' },
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
          { backgroundColor: disabled ? '#1a2a2a' : accentColor },
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
            m.id === BLACKSWAN_ID && { backgroundColor: '#a855f730' },
          ]}>
            <Text style={styles.mentionAvatarText}>
              {m.id === BLACKSWAN_ID ? '🦢' : (m.display_name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.mentionName}>{m.display_name || m.username}</Text>
            <Text style={styles.mentionHandle}>@{m.username}</Text>
          </View>
          {m.id === BLACKSWAN_ID && (
            <View style={[styles.mentionBotBadge, { backgroundColor: '#a855f730' }]}>
              <Text style={[styles.mentionBotBadgeText, { color: '#a855f7' }]}>AI</Text>
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

function EnhancedInput({ input, onInputChange, onSend, onFocusBot, inputRef, accentColor }: any) {
  const [focused, setFocused] = useState(false);
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

  // Handle Enter to send on web (Shift+Enter for newline)
  const handleKeyPress = useCallback((e: any) => {
    if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
      e.preventDefault?.();
      if (input.trim()) onSend();
    }
  }, [input, onSend]);

  const inputStyle = Platform.OS === 'web' ? {
    backdropFilter: 'blur(10px)',
    borderColor: focused ? accentColor + '60' : accentColor + '30',
    boxShadow: focused ? `0 0 20px ${accentColor}30` : 'none',
    transition: 'all 0.3s ease',
  } as any : {
    borderColor: focused ? accentColor + '60' : accentColor + '30',
  };

  return (
    <View style={[styles.enhancedInputBar, { borderColor: accentColor + '20' }]}>
      <View style={[styles.enhancedInputWrapper, inputStyle]}>
        <Pressable onPress={onFocusBot} style={[styles.enhancedBotTrigger, { backgroundColor: accentColor + '30' }]}>
          <Text style={styles.botTriggerText}>🦢</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.enhancedInput}
          placeholder="Message your circle... @BlackSwan to talk to AI"
          placeholderTextColor="#444"
          value={input}
          onChangeText={onInputChange}
          onSubmitEditing={() => onSend()}
          onKeyPress={handleKeyPress}
          returnKeyType="send"
          multiline
          maxLength={1000}
          onFocus={() => setFocused(true)}
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
  'claude-code': '#6366f1', 'cowork': '#22c55e', 'openclaw': '#f59e0b',
  'codex': '#10a37f', 'gemini': '#4285f4', 'cursor': '#8b5cf6', 'other': '#06b6d4',
};
const TOOL_ICONS: Record<string, string> = {
  'claude-code': '💻', 'cowork': '💼', 'openclaw': '🐾',
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
        else if (toolLine.includes('OpenClaw')) tool = 'openclaw';
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

// ─── Enhanced Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Core layout
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingPulse: { alignItems: 'center' },
  loadingText: { fontSize: 12, letterSpacing: 2, fontWeight: '700' },

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
  heroSectionWeb: Platform.OS === 'web' ? {
    backgroundImage: 'radial-gradient(circle at center, rgba(99, 102, 241, 0.1), transparent 70%)',
  } as any : {},
  heroBotAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#6366f1',
    ...(Platform.OS === 'web' ? { className: 'bot-float-anim' } as any : {}),
  } as any,
  heroBotEmoji: { fontSize: 36 },
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
    backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#2a2a3e',
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
    borderRadius: 8,
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
  categoryPrompts: { borderTopWidth: 1, borderTopColor: '#1a1a1a20' },

  enhancedPromptItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    paddingLeft: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#0e0e0e',
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
    borderColor: '#1a1a1a60',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  tipAccent: { width: 3, height: '100%', borderRadius: 2, marginRight: 12 },
  tipText: { color: '#888', fontSize: 13, lineHeight: 18, flex: 1 },

  // Pinned messages
  pinnedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
    backgroundColor: '#0d0d14',
  },
  pinnedBannerIcon: { fontSize: 14 },
  pinnedBannerText: { flex: 1, fontSize: 13, color: '#888', fontWeight: '600' },
  pinnedBannerChevron: { fontSize: 12, color: '#666' },
  pinnedList: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: '#0d0d14', gap: 6 },
  pinnedItem: {
    backgroundColor: '#111118', borderRadius: 8, padding: 10,
    borderLeftWidth: 3, borderLeftColor: '#eab308',
  },
  pinnedItemText: { fontSize: 13, color: '#ccc', lineHeight: 18 },
  pinnedItemMeta: { fontSize: 11, color: '#666', marginTop: 4 },

  // Proposal section
  proposalSection: {
    paddingHorizontal: 16, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
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
  } as any,
  messageHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  enhancedMsgAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#2a2a2a',
  },
  msgAvatarMe: { backgroundColor: '#1a2e1a', borderColor: '#2a4a2a' },
  msgAvatarText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  msgName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  aiBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  aiBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  msgTime: { color: '#444', fontSize: 11, marginLeft: 'auto' as any },

  msgContentWrap: { marginLeft: 46, position: 'relative' as any },
  enhancedMsgBubble: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#11111180',
    borderWidth: 1,
    borderColor: '#1a1a1a60',
    borderLeftWidth: 3,
    borderLeftColor: '#2a2a2a',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  msgContent: { fontSize: 15, lineHeight: 22 },
  mention: { fontWeight: '700', backgroundColor: '#1a1a3e', paddingHorizontal: 4, borderRadius: 4 },
  bold: { fontWeight: '800', color: '#fff' },

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
    borderRadius: 8,
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
    borderRadius: 10,
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
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  } as any,

  // Reply indicator
  replyIndicator: { flexDirection: 'row', alignItems: 'center', marginLeft: 46, marginBottom: 6, gap: 8 },
  replyIndicatorAccent: { width: 3, height: 16, borderRadius: 2 },
  replyIndicatorName: { fontSize: 12, fontWeight: '700' },
  replyIndicatorText: { color: '#555', fontSize: 12, flex: 1 },

  // Step Away row
  stepAwayRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
  },

  // Enhanced UI components
  enhancedQuickBar: {
    borderTopWidth: 1,
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
    backgroundColor: '#0a0a0acc',
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

  // Enhanced crypto panel
  enhancedCryptoPanel: {
    backgroundColor: '#0a0a0af0',
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
  walletDisconnectText: { color: '#cc4444', fontSize: 12, fontWeight: '600' },

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
    borderRadius: 10,
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
    borderRadius: 10,
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
    backgroundColor: '#0a0a0af5',
  },
  enhancedMentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a60',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.2s' } as any : {}),
  },
  mentionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mentionAvatarText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  mentionName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  mentionHandle: { color: '#555', fontSize: 12 },
  mentionBotBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  mentionBotBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },

  // Enhanced reply bar
  enhancedReplyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    backgroundColor: '#0a0a0af0',
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
    backgroundColor: '#0a0a0af0',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(8px)' } as any : {}),
  },
  typingDot: { width: 10, height: 10, borderRadius: 5 },
  typingText: { color: '#666', fontSize: 12, fontStyle: 'italic' },
  typingDotsText: { fontSize: 16, color: '#666' },

  // Enhanced input
  enhancedInputBar: {
    borderTopWidth: 1,
    padding: 16,
    backgroundColor: '#0a0a0af5',
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)' } as any : {}),
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