import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, Pressable, Platform,
} from 'react-native';
import type { NativeSyntheticEvent, TextInputKeyPressEventData } from 'react-native';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  OpenClawConfig, listSessions, getSessionStatus, getSessionHistory,
  sendAgentTask, listAgents, listCronJobs, runWebSearch,
  spawnSubAgent, manageCronJob, searchMemory, sendSessionMessage, listSubAgents,
} from '../../../../lib/openclawService';
import { AgentConnection, PROVIDER_META } from '../../../../lib/connectionManager';
import { sendMessage as sendTgMessage, TelegramMessage } from '../../../../lib/telegramService';
import { detectClaudeCodeBridge, execBridgeCommand } from '../../../../lib/claudeCodeDetector';
import { storage } from '../../../../lib/storage';
import OfficeActionPanel from '../../../../components/OfficeActionPanel';

const STORAGE_KEY_CHAT_HISTORY = '@office_terminal_history';
const DEFAULT_MESSAGE: ChatMessage = {
  id: '0',
  text: '🏢 Office Terminal ready. Type "help" for commands.\n\n  swan            — talk to BlackSwan AI\n  @agent message  — talk to an agent\n  $ command       — run shell command\n  help            — all commands',
  isUser: false,
  agent: 'System',
  timestamp: new Date(),
};

// Timeout wrapper for async operations
function withTimeout<T>(promise: Promise<T>, ms: number, label = 'Operation'): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ]);
}

interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  agent?: string;
  timestamp: Date;
  loading?: boolean;
}

export type OfficeCommand =
  | { type: 'theme'; value: string }
  | { type: 'info'; query: string }
  | { type: 'status' }
  | { type: 'costs' }
  | { type: 'agents' }
  | { type: 'clear' };

interface Props {
  circleId: string;
  onCommand?: (cmd: OfficeCommand) => void;
  minimized?: boolean;
  onToggle?: () => void;
  fullscreen?: boolean;
  onFullscreenToggle?: () => void;
  agents?: OfficeAgent[];
  // Multi-connection support
  connections?: AgentConnection[];
  getConnectionConfig?: (id: string) => OpenClawConfig | null;
  // Telegram
  telegramConfig?: { botToken: string; chatId: string } | null;
  telegramConnected?: boolean;
  telegramMessages?: TelegramMessage[];
  // Quick Actions
  onActionResult?: (message: string) => void;
}

// Get the first connected OpenClaw config
function getDefaultConfig(
  connections: AgentConnection[] | undefined,
  getConfig: ((id: string) => OpenClawConfig | null) | undefined,
): { config: OpenClawConfig; conn: AgentConnection } | null {
  if (!connections || !getConfig) return null;
  for (const c of connections) {
    if (c.status === 'connected') {
      const cfg = getConfig(c.id);
      if (cfg) return { config: cfg, conn: c };
    }
  }
  return null;
}

// Find a connection by name (case-insensitive partial match)
function findConnectionByName(
  connections: AgentConnection[] | undefined,
  name: string,
): AgentConnection | undefined {
  if (!connections) return undefined;
  const lower = name.toLowerCase();
  return connections.find(c => c.name.toLowerCase() === lower)
    || connections.find(c => c.name.toLowerCase().includes(lower));
}

// ─── BlackSwan Local AI ──────────────────────────────────────────────────────
// Always available — no external connection needed. Provides office insights,
// system info, and a helpful personality.

const SWAN_GREETINGS = [
  '👽 Greetings, operator. BlackSwan is online and scanning the perimeter.',
  '👽 *holographic flicker* — What do you need? I see all.',
  '👽 BlackSwan here. The cosmic frequencies are strong today.',
  '👽 Transmission received. How can I assist the circle?',
  '👽 *alien hum* — Ready for directives.',
];
const SWAN_FORTUNES = [
  '🔮 The stars say: your next deployment will go smoothly.',
  '🔮 Cosmic alignment suggests: now is the time to refactor.',
  '🔮 A strange signal approaches... it whispers: "ship it."',
  '🔮 The void reveals: your test coverage needs attention.',
  '🔮 Interstellar wisdom: the bug is always in the code you didn\'t write.',
  '🔮 The nebula shifts: a collaborator will bring unexpected insight.',
  '🔮 Alien frequencies detect: momentum is building in your circle.',
  '🔮 Transmission from deep space: take a break, then crush it.',
];

function processBlackSwanCommand(
  input: string,
  agents: OfficeAgent[],
  connections: AgentConnection[],
): string {
  const lower = input.toLowerCase().trim();

  // No subcommand — greeting
  if (!lower) {
    return SWAN_GREETINGS[Math.floor(Math.random() * SWAN_GREETINGS.length)];
  }

  // Help
  if (lower === 'help' || lower === '?') {
    return `👽 BlackSwan Commands\n\n` +
      `  swan             — Talk to BlackSwan\n` +
      `  swan status      — Office analysis\n` +
      `  swan scan        — Deep scan all agents\n` +
      `  swan agents      — Agent roster + health\n` +
      `  swan costs       — Cost breakdown\n` +
      `  swan fortune     — Cosmic prediction\n` +
      `  swan connections — Connection health\n` +
      `  swan time        — Current time + uptime\n` +
      `  swan tips        — Office optimization tips\n` +
      `  swan whoami      — Your profile info\n` +
      `  @BlackSwan <msg> — Chat with BlackSwan\n\n` +
      `💡 BlackSwan runs locally — no external API needed.`;
  }

  // Fortune
  if (lower === 'fortune' || lower === 'predict' || lower === '8ball') {
    return SWAN_FORTUNES[Math.floor(Math.random() * SWAN_FORTUNES.length)];
  }

  // Time
  if (lower === 'time' || lower === 'clock') {
    const now = new Date();
    return `🕐 ${now.toLocaleTimeString()} — ${now.toLocaleDateString()}\n📡 BlackSwan uptime: always on`;
  }

  // Status / scan
  if (lower === 'status' || lower === 'scan') {
    const active = agents.filter(a => a.status === 'active');
    const idle = agents.filter(a => a.status === 'idle');
    const offline = agents.filter(a => a.status === 'offline');
    const errored = agents.filter(a => a.status === 'error');
    const totalCost = agents.reduce((s, a) => s + a.costToday, 0);
    const totalTokens = agents.reduce((s, a) => s + a.tokensUsed, 0);
    const connUp = connections.filter(c => c.status === 'connected').length;
    const connTotal = connections.length;

    return `👽 BlackSwan Office Scan\n` +
      `${'━'.repeat(32)}\n` +
      `  🟢 Active:  ${active.length} agent${active.length !== 1 ? 's' : ''}${active.length > 0 ? ` (${active.map(a => a.name).join(', ')})` : ''}\n` +
      `  🟡 Idle:    ${idle.length} agent${idle.length !== 1 ? 's' : ''}\n` +
      `  ⚪ Offline: ${offline.length}\n` +
      (errored.length > 0 ? `  🔴 Error:   ${errored.length} (${errored.map(a => a.name).join(', ')})\n` : '') +
      `  📡 Connections: ${connUp}/${connTotal} online\n` +
      `  💰 Cost today: $${totalCost.toFixed(4)}\n` +
      `  🔤 Tokens: ${totalTokens.toLocaleString()}\n` +
      `${'━'.repeat(32)}\n` +
      (active.length > 0
        ? `📍 Active now: ${active.map(a => `${a.name} → ${a.activity}`).join('; ')}`
        : `📍 All quiet. Agents standing by.`);
  }

  // Agents roster
  if (lower === 'agents' || lower === 'roster') {
    if (agents.length === 0) return '👽 No agents detected in the office.';
    const lines = agents.map(a => {
      const status = { active: '🟢', idle: '🟡', error: '🔴', offline: '⚪' }[a.status] || '⚪';
      const cost = a.costToday > 0 ? ` · $${a.costToday.toFixed(4)}` : '';
      const model = a.model !== 'unknown' ? ` · ${a.model}` : '';
      return `  ${status} ${a.name} [${a.role}]${model}${cost}\n    └─ ${a.activity}`;
    });
    return `👽 Agent Roster (${agents.length})\n${'━'.repeat(32)}\n${lines.join('\n')}`;
  }

  // Costs
  if (lower === 'costs' || lower === 'cost' || lower === 'spend') {
    const sorted = [...agents].filter(a => a.costToday > 0).sort((a, b) => b.costToday - a.costToday);
    const totalCost = agents.reduce((s, a) => s + a.costToday, 0);
    if (sorted.length === 0) return `👽 $0.00 spent today. The office is running lean.`;
    const lines = sorted.map(a =>
      `  $${a.costToday.toFixed(4)}  ${a.name} (${a.model}) — ${a.tokensUsed.toLocaleString()} tokens`
    );
    return `👽 Cost Analysis\n${'━'.repeat(32)}\n${lines.join('\n')}\n${'━'.repeat(32)}\n  Total: $${totalCost.toFixed(4)}`;
  }

  // Connections
  if (lower === 'connections' || lower === 'conns') {
    if (connections.length === 0) return '👽 No connections configured. Add one in ⚙️ → Connections.';
    const lines = connections.map(c => {
      const icon = { connected: '🟢', connecting: '🟡', error: '🔴', disconnected: '⚪' }[c.status] || '⚪';
      return `  ${icon} ${c.name} [${c.provider}] — ${c.status}${c.error ? ` (${c.error})` : ''}`;
    });
    return `👽 Connection Status\n${'━'.repeat(32)}\n${lines.join('\n')}`;
  }

  // Tips
  if (lower === 'tips' || lower === 'optimize' || lower === 'advice') {
    const tips: string[] = [];
    const active = agents.filter(a => a.status === 'active');
    const totalCost = agents.reduce((s, a) => s + a.costToday, 0);
    const cachedRatio = agents.reduce((s, a) => s + a.cachedTokens, 0) / Math.max(1, agents.reduce((s, a) => s + a.inputTokens, 0));

    if (active.length === 0 && agents.length > 1) tips.push('💡 No agents active — consider assigning tasks to idle agents.');
    if (totalCost > 1) tips.push('💡 Spending over $1 today — review if all active sessions are needed.');
    if (cachedRatio < 0.3) tips.push('💡 Low cache hit rate — consider structuring prompts for better caching.');
    if (connections.filter(c => c.status === 'error').length > 0) tips.push('💡 Some connections have errors — check ⚙️ → Connections.');
    if (agents.some(a => a.model?.includes('opus'))) tips.push('💡 Using Opus models — switch to Sonnet/Haiku for routine tasks to save costs.');
    if (tips.length === 0) tips.push('✅ Office looking good! No optimization suggestions right now.');
    return `👽 BlackSwan Tips\n${'━'.repeat(32)}\n${tips.join('\n')}`;
  }

  // Whoami
  if (lower === 'whoami' || lower === 'who am i') {
    return `👽 You are the operator of this circle.\n` +
      `  Agents under your command: ${agents.length}\n` +
      `  Connections: ${connections.length}\n` +
      `  BlackSwan status: Always online ∞`;
  }

  // Default — treat as a chat message, respond with personality
  const chatResponses = [
    `👽 Interesting... "${input}". I'll keep my sensors tuned to that.`,
    `👽 *processes through alien neural net* — Noted. Anything else, operator?`,
    `👽 The cosmic frequencies resonate with your words. I am listening.`,
    `👽 Acknowledged. BlackSwan is always watching, always learning.`,
    `👽 *holographic shimmer* — My circuits are processing your request.`,
    `👽 Transmission received. The circle grows stronger with each interaction.`,
  ];
  return chatResponses[Math.floor(Math.random() * chatResponses.length)];
}

async function processLocalCommand(text: string, agents: OfficeAgent[], connections?: AgentConnection[]): Promise<{ response: string; command?: OfficeCommand } | null> {
  const lower = text.toLowerCase().trim();

  if (lower === 'status' || lower === 'office status') {
    if (agents.length === 0) return { response: '🏢 Office Status\nNo agents connected. Go to ⚙️ → Connections to add endpoints.', command: { type: 'status' } };
    const active = agents.filter(a => a.status === 'active');
    const totalCost = agents.reduce((s, a) => s + a.costToday, 0);
    const connCount = connections ? connections.filter(c => c.status === 'connected').length : 0;
    return {
      response: `🏢 Office Status\n${active.length}/${agents.length} agents active across ${connCount} connection${connCount !== 1 ? 's' : ''}\nCost today: $${totalCost.toFixed(2)}\n\nActive: ${active.map(a => `${a.name} (${a.connectionName})`).join(', ')}`,
      command: { type: 'status' },
    };
  }

  if (lower === 'connections' || lower === 'conns') {
    if (!connections || connections.length === 0) return { response: '🔗 No connections configured. Go to ⚙️ → Connections to add one.' };
    const lines = connections.map(c => {
      const meta = PROVIDER_META[c.provider];
      const dot = c.status === 'connected' ? '🟢' : c.status === 'connecting' ? '🟡' : c.status === 'error' ? '🔴' : '⚫';
      return `${dot} ${meta.icon} ${c.name} — ${c.endpoint}${c.sessionCount != null ? ` (${c.sessionCount} sessions)` : ''}`;
    });
    return { response: `🔗 Connections\n\n${lines.join('\n')}` };
  }

  if (lower.startsWith('agent ') || lower.startsWith('who is ')) {
    const name = lower.replace(/^(agent |who is )/, '').trim();
    const agent = agents.find(a => a.name.toLowerCase().includes(name));
    if (agent) {
      return {
        response: `🤖 ${agent.name} — ${agent.role}\nConnection: ${PROVIDER_META[agent.providerType].icon} ${agent.connectionName}\nStatus: ${agent.status} | Model: ${agent.model}\nCost: $${agent.costToday.toFixed(2)}/day | $${agent.costWeek.toFixed(2)}/wk\nMessages: ${agent.messagesProcessed.toLocaleString()}\n\nRecent:\n${agent.recentActions.slice(0, 3).map(a => `• ${a}`).join('\n')}`,
        command: { type: 'info', query: agent.name },
      };
    }
    return { response: `No agent "${name}". ${agents.length > 0 ? `Available: ${agents.map(a => a.name).join(', ')}` : 'No agents connected.'}` };
  }

  if (lower.includes('cost') || lower.includes('spend')) {
    const totalToday = agents.reduce((s, a) => s + a.costToday, 0);
    const totalWeek = agents.reduce((s, a) => s + a.costWeek, 0);
    const lines = [...agents].sort((a, b) => b.costToday - a.costToday)
      .map(a => `${PROVIDER_META[a.providerType].icon} ${a.name}: $${a.costToday.toFixed(2)}/day — ${a.model}`);
    return { response: `💰 Costs\nToday: $${totalToday.toFixed(2)} | Week: $${totalWeek.toFixed(2)}\n\n${lines.join('\n') || 'No agents connected'}`, command: { type: 'costs' } };
  }

  if (lower.startsWith('theme ') || lower.startsWith('set theme ')) {
    const themeName = lower.replace(/^(set )?theme /, '').trim();
    const map: Record<string, string> = { underground: 'underground', dark: 'underground', cyberpunk: 'cyberpunk', neon: 'cyberpunk', forest: 'forest', arctic: 'arctic', gold: 'gold' };
    const themeId = map[themeName];
    if (themeId) return { response: `🎨 Theme → ${themeId}`, command: { type: 'theme', value: themeId } };
    return { response: `Unknown theme. Try: underground, cyberpunk, forest, arctic, gold` };
  }

  if (lower === 'agents' || lower === 'list agents' || lower === 'team') {
    if (agents.length === 0) return { response: '🤖 No agents connected. Add connections in ⚙️ → Connections.', command: { type: 'agents' } };
    const lines = agents.map(a => {
      const dot = a.status === 'active' ? '🟢' : a.status === 'idle' ? '🟡' : a.status === 'error' ? '🔴' : '⚫';
      return `${dot} ${PROVIDER_META[a.providerType].icon} ${a.name} — ${a.role} (${a.connectionName})`;
    });
    return { response: `🤖 Agent Roster\n\n${lines.join('\n')}`, command: { type: 'agents' } };
  }

  // Conversation log commands
  if (lower === 'log' || lower === 'conversation log' || lower === 'messages') {
    const { getRecentMessages, formatMessageForTerminal } = await import('../../../../lib/conversationLog');
    const messages = await getRecentMessages(30);
    
    if (messages.length === 0) {
      return { response: '📝 Conversation Log\n\nNo messages yet. Use Quick Actions to start conversations with agents!' };
    }

    const formatted = messages.map(formatMessageForTerminal).join('\n');
    return { response: `📝 Recent Conversations (${messages.length})\n\n${formatted}\n\nTip: Use "log [agent]" to filter, "threads" to view grouped` };
  }

  if (lower.startsWith('log ')) {
    const agentQuery = text.slice(4).trim().toLowerCase();
    const matchedAgent = agents.find(a => a.name.toLowerCase().includes(agentQuery) || a.id.toLowerCase().includes(agentQuery));
    
    if (!matchedAgent) {
      return { response: `❌ Agent not found: "${agentQuery}"\n\nTry: ${agents.map(a => a.name).join(', ')}` };
    }

    const { getMessagesByAgent, formatMessageForTerminal } = await import('../../../../lib/conversationLog');
    const messages = await getMessagesByAgent(matchedAgent.id, 30);
    
    if (messages.length === 0) {
      return { response: `📝 ${matchedAgent.name} Log\n\nNo messages yet with this agent.` };
    }

    const formatted = messages.map(formatMessageForTerminal).join('\n');
    return { response: `📝 ${matchedAgent.name} (${messages.length} messages)\n\n${formatted}` };
  }

  if (lower === 'threads' || lower === 'conversations') {
    const { getRecentMessages, groupMessagesByConversation, formatThreadSummary } = await import('../../../../lib/conversationLog');
    const messages = await getRecentMessages(200);
    const threads = groupMessagesByConversation(messages);
    
    if (threads.length === 0) {
      return { response: '📋 Conversation Threads\n\nNo conversations yet. Start chatting with agents!' };
    }

    const formatted = threads.slice(0, 20).map(formatThreadSummary).join('\n');
    return { response: `📋 Active Threads (${threads.length})\n\n${formatted}\n\nUse "log [agent]" to see specific conversation` };
  }

  if (lower === 'clear log' || lower === 'clear messages') {
    const { clearConversationLog } = await import('../../../../lib/conversationLog');
    await clearConversationLog();
    return { response: '🗑️ Conversation log cleared!' };
  }

  if (lower === 'clear' || lower === 'clear history' || lower === 'clear terminal') {
    return { response: '🗑️', command: { type: 'clear' } };
  }

  if (lower === 'help' || lower === '?') {
    const { getCollaborationHelp } = await import('../../../../lib/officeChatCommands');
    const { getAdvancedHelp } = await import('../../../../lib/advancedChatCommands');
    return {
      response: `🏢 Office Commands\n\n` +
        `QUICK:\n• @agent message — Talk to an agent directly\n• swan [cmd] — Talk to BlackSwan AI (always available)\n• $ command — Run a shell command (via bridge)\n• sh command — Same as $ command\n\n` +
        `BLACKSWAN AI:\n• swan — Greet BlackSwan\n• swan status — Office analysis\n• swan scan — Deep scan all agents\n• swan costs — Cost breakdown\n• swan fortune — Cosmic prediction\n• swan tips — Optimization advice\n• @BlackSwan hi — Chat directly\n\n` +
        `LOCAL:\n• status — Office overview\n• agents — List all agents\n• connections — List all connections\n• agent [name] — Agent details\n• costs — Cost breakdown\n• theme [name] — Change theme\n\n` +
        `CONVERSATIONS:\n• log — Recent messages\n• log [agent] — Filter by agent\n• threads — Conversation threads\n• clear log — Clear conversation log\n• clear — Clear terminal history\n\n` +
        `AGENT COMMANDS:\n• ask [question] — Ask default agent\n• task [message] — Send task to default agent\n• task @[name] [message] — Route to connection/agent\n• spawn [task] — Launch background sub-agent\n• subagents — List running sub-agents\n• msg [session] [text] — Message a session\n• broadcast [msg] — Send to all channels\n\n` +
        `${getCollaborationHelp()}\n\n` +
        `${getAdvancedHelp()}\n\n` +
        `SESSION & DATA:\n• sessions — All sessions (all connections)\n• session [key] — Session details\n• history [key] — Message history\n• memory [query] — Search agent memory\n• search [query] — Web search\n\n` +
        `CRON JOBS:\n• cron — List all jobs\n• cron run [id] — Run job now\n• cron enable/disable [id]\n\n` +
        `SHELL (requires bridge):\n• $ ls -la — Run any shell command\n• > pwd — Same as $ prefix\n• Start bridge: node scripts/claude-bridge.js\n\n` +
        `INTEGRATIONS:\n• agents-live — List real agent IDs\n• tg [message] — Send to Telegram\n• tg-feed — Recent Telegram messages`,
    };
  }

  return null;
}

export default function OfficeChat({
  circleId, onCommand, minimized, onToggle,
  fullscreen = false, onFullscreenToggle,
  agents = [],
  connections, getConnectionConfig,
  telegramConfig, telegramConnected, telegramMessages,
  onActionResult,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_MESSAGE]);
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const listRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // Detect bridge on mount and periodically
  useEffect(() => {
    const check = () => detectClaudeCodeBridge().then(setBridgeOnline);
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, []);

  // Load chat history and command history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const saved = await storage.getItem(STORAGE_KEY_CHAT_HISTORY);
        if (saved) {
          const parsed = JSON.parse(saved);
          // Convert timestamp strings back to Date objects
          const restored = parsed.map((m: any) => ({
            ...m,
            timestamp: new Date(m.timestamp),
          }));
          setMessages(restored);
        }

        const savedCommands = await storage.getItem('@office_command_history');
        if (savedCommands) {
          setCommandHistory(JSON.parse(savedCommands));
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
      }
    };
    loadHistory();
  }, []);

  // Save chat history whenever messages change
  useEffect(() => {
    const saveHistory = async () => {
      try {
        await storage.setItem(STORAGE_KEY_CHAT_HISTORY, JSON.stringify(messages));
      } catch (error) {
        console.error('Failed to save chat history:', error);
      }
    };
    if (messages.length > 0) {
      saveHistory();
    }
  }, [messages]);

  const addMsg = (text: string, isUser: boolean, agent?: string) => {
    const msg: ChatMessage = { id: `${Date.now()}_${Math.random()}`, text, isUser, agent, timestamp: new Date() };
    setMessages(prev => [...prev, msg]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    return msg;
  };

  const anyConnected = connections?.some(c => c.status === 'connected') || false;

  const scrollToBottom = () => {
    listRef.current?.scrollToEnd({ animated: true });
    setShowScrollBtn(false);
  };

  const handleKeyPress = (e: any) => {
    if (Platform.OS !== 'web') return;
    
    // Up arrow - previous command
    if (e.nativeEvent.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    }
    
    // Down arrow - next command
    if (e.nativeEvent.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput('');
      }
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || processing) return;
    const text = input.trim();

    // Add to command history
    const newHistory = [...commandHistory.filter(c => c !== text), text].slice(-50);
    setCommandHistory(newHistory);
    setHistoryIndex(-1);
    await storage.setItem('@office_command_history', JSON.stringify(newHistory));

    setInput('');
    addMsg(text, true);

    // Try local commands first
    const local = await processLocalCommand(text, agents, connections);
    if (local) {
      if (local.command?.type === 'clear') {
        setMessages([DEFAULT_MESSAGE]);
        addMsg('Terminal cleared!', false, 'System');
        return;
      }
      addMsg(local.response, false, 'Office AI');
      if (local.command && onCommand) onCommand(local.command);
      return;
    }

    const lower = text.toLowerCase();

    // ─── BlackSwan local AI — always available, no external connection needed ───
    const swanMatch = lower.match(/^(?:swan|blackswan|bs)\s*(.*)/);
    const atSwanMatch = text.match(/^@(?:BlackSwan|blackswan|swan)\s+([\s\S]*)/);
    if (swanMatch || atSwanMatch) {
      const swanInput = (swanMatch?.[1] || atSwanMatch?.[1] || '').trim();
      const swanResponse = processBlackSwanCommand(swanInput, agents, connections || []);
      addMsg(swanResponse, false, 'BlackSwan');
      return;
    }

    // ─── Shell commands: $ command, > command, sh command, shell command ───
    const shellMatch = text.match(/^(?:\$|>|sh |shell )\s*(.*)/s);
    if (shellMatch) {
      const cmd = shellMatch[1].trim();
      if (!cmd) { addMsg('Usage: $ <command>  (e.g. $ ls -la)', false, 'System'); return; }
      if (!bridgeOnline) {
        addMsg('❌ Bridge not running. Start it with:\n  node scripts/claude-bridge.js', false, 'System');
        return;
      }
      // Block dangerous commands client-side before sending to bridge
      const BLOCKED = [
        /\brm\s+(-[a-zA-Z]*\s+)*[~/]/,
        /\bsudo\b/, /\bsu\s/, /\bpasswd\b/,
        /\bmkfs\b/, /\bdd\s+.*of=/, /\bshutdown\b/, /\breboot\b/,
        /\bcurl\b.*\|\s*(ba)?sh/, /\bwget\b.*\|\s*(ba)?sh/,
      ];
      if (BLOCKED.some(p => p.test(cmd))) {
        addMsg('❌ Command blocked — contains a restricted pattern', false, 'System');
        return;
      }
      setProcessing(true);
      addMsg(`⏳ Running: ${cmd}`, false, 'Shell');
      try {
        const result = await withTimeout(execBridgeCommand(cmd), 35000, 'Shell command');
        if (result.ok) {
          const output = (result.stdout || '').trim();
          const errOut = (result.stderr || '').trim();
          const combined = [output, errOut && `stderr: ${errOut}`].filter(Boolean).join('\n') || '(no output)';
          addMsg(combined, false, 'Shell');
        } else {
          addMsg(`❌ ${result.error || 'Command failed'}`, false, 'Shell');
        }
      } catch (e: any) {
        addMsg(`❌ ${e.message || 'Shell error'}`, false, 'Shell');
      } finally {
        setProcessing(false);
      }
      return;
    }

    // ─── @agent message shorthand ─────────────────────────────────────────
    const atMatch = text.match(/^@(\S+)\s+([\s\S]*)/);
    if (atMatch) {
      const target = atMatch[1];
      const msg = atMatch[2].trim();
      if (!msg) { addMsg(`Usage: @${target} <message>`, false, 'System'); return; }

      // Find matching connection or agent
      const matchedConn = findConnectionByName(connections, target);
      let targetCfg: OpenClawConfig | null = null;
      let targetName = target;
      let agentId = 'main';

      if (matchedConn && getConnectionConfig) {
        targetCfg = getConnectionConfig(matchedConn.id);
        targetName = matchedConn.name;
      } else {
        // Try default connection with target as agentId
        const defaultConn = getDefaultConfig(connections, getConnectionConfig);
        if (defaultConn) {
          targetCfg = defaultConn.config;
          targetName = defaultConn.conn.name;
          agentId = target;
        }
      }

      if (!targetCfg) {
        addMsg(`❌ No connection for @${target}. Check ⚙️ → Connections.`, false, 'System');
        return;
      }

      setProcessing(true);
      addMsg(`⏳ Sending to ${targetName} (${agentId})...`, false, 'System');
      try {
        const result = await withTimeout(sendAgentTask(targetCfg, msg, agentId), 30000, 'Agent response');
        if (result.ok) {
          addMsg(`${result.reply || '(no response)'}`, false, targetName);
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'System');
        }
      } catch (e: any) {
        addMsg(`❌ ${e.message || 'Request failed'}`, false, 'System');
      } finally {
        setProcessing(false);
      }
      return;
    }

    // Try collaboration commands (project management + messaging)
    if (anyConnected && getConnectionConfig) {
      try {
        const { processCollaborationCommand } = await import('../../../../lib/officeChatCommands');
        const collab = await processCollaborationCommand(text, agents, connections || [], getConnectionConfig);
        if (collab) {
          addMsg(collab.response, false, collab.success ? 'Office AI' : 'Error');
          return;
        }
      } catch {}
    }

    // Try advanced commands (tasks, conversations, coordination)
    if (anyConnected && getConnectionConfig) {
      try {
        const { processAdvancedCommands } = await import('../../../../lib/advancedChatCommands');
        const advanced = await processAdvancedCommands(text, agents, connections || [], getConnectionConfig);
        if (advanced) {
          addMsg(advanced.response, false, advanced.success ? 'Office AI' : 'Error');
          return;
        }
      } catch {}
    }

    // ─── Multi-connection commands (all wrapped in try/finally) ────────────
    if (anyConnected && getConnectionConfig) {
      const defaultConn = getDefaultConfig(connections, getConnectionConfig);

      // sessions
      if (lower === 'sessions' || lower === 'list sessions') {
        setProcessing(true);
        try {
          addMsg('⏳ Fetching sessions...', false, 'System');
          const allLines: string[] = [];
          for (const conn of (connections || []).filter(c => c.status === 'connected')) {
            const cfg = getConnectionConfig(conn.id);
            if (!cfg) continue;
            const result = await withTimeout(listSessions(cfg), 15000, 'Sessions');
            if (result.ok && result.sessions) {
              const meta = PROVIDER_META[conn.provider];
              allLines.push(`\n${meta.icon} ${conn.name}:`);
              result.sessions.forEach(s => {
                allLines.push(`  • ${s.sessionKey} [${s.kind}]${s.agentId ? ` agent:${s.agentId}` : ''}${s.model ? ` (${s.model})` : ''}`);
              });
            }
          }
          addMsg(`📡 Sessions${allLines.join('\n') || '\nNo active sessions'}`, false, 'System');
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // session detail
      if (lower.startsWith('session ') && defaultConn) {
        const key = text.slice(8).trim();
        setProcessing(true);
        try {
          addMsg(`⏳ Getting status for ${key}...`, false, 'System');
          const result = await withTimeout(getSessionStatus(defaultConn.config, key), 15000, 'Session status');
          if (result.ok && result.status) {
            const s = result.status;
            addMsg(`📊 Session: ${s.sessionKey}\nModel: ${s.model || 'unknown'}\nTurns: ${s.turns || '?'}\nInput: ${s.totalInputTokens?.toLocaleString() || '?'}\nOutput: ${s.totalOutputTokens?.toLocaleString() || '?'}\nCost: ${s.totalCost != null ? `$${s.totalCost.toFixed(4)}` : '?'}`, false, defaultConn.conn.name);
          } else {
            addMsg(`❌ ${result.error || 'Failed'}`, false, 'System');
          }
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // history
      if (lower.startsWith('history ') && defaultConn) {
        const key = text.slice(8).trim();
        setProcessing(true);
        try {
          const result = await withTimeout(getSessionHistory(defaultConn.config, key), 15000, 'History');
          if (result.ok && result.messages) {
            const lines = result.messages.slice(-8).map(m => `[${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`);
            addMsg(`📝 Last ${lines.length} messages:\n\n${lines.join('\n\n')}`, false, defaultConn.conn.name);
          } else {
            addMsg(`❌ ${result.error || 'Failed'}`, false, 'System');
          }
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // task @name message
      if (lower.startsWith('task ')) {
        const taskText = text.slice(5).trim();
        let targetCfg = defaultConn?.config;
        let targetName = defaultConn?.conn.name || 'default';
        let agentId = 'main';
        let taskMsg = taskText;

        const taskAt = taskText.match(/^@(\S+)\s+(.*)/s);
        if (taskAt) {
          const tgt = taskAt[1];
          taskMsg = taskAt[2];
          const mc = findConnectionByName(connections, tgt);
          if (mc && getConnectionConfig(mc.id)) { targetCfg = getConnectionConfig(mc.id)!; targetName = mc.name; }
          else { agentId = tgt; }
        }

        if (!targetCfg) { addMsg('❌ No connected endpoint. Add a connection in ⚙️.', false, 'System'); return; }

        setProcessing(true);
        try {
          addMsg(`⏳ Sending to ${targetName} (${agentId})...`, false, 'System');
          const result = await withTimeout(sendAgentTask(targetCfg, taskMsg, agentId), 30000, 'Agent task');
          addMsg(result.ok ? `✅ Response:\n\n${result.reply || '(no response)'}` : `❌ ${result.error || 'Task failed'}`, false, result.ok ? targetName : 'System');
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Task failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // ask
      if (lower.startsWith('ask ') && defaultConn) {
        const question = text.slice(4).trim();
        setProcessing(true);
        try {
          addMsg(`⏳ Asking ${defaultConn.conn.name}...`, false, 'System');
          const result = await withTimeout(sendAgentTask(defaultConn.config, question, 'main'), 30000, 'Agent');
          addMsg(result.ok ? `💬 ${result.reply || '(no response)'}` : `❌ ${result.error || 'Failed'}`, false, result.ok ? defaultConn.conn.name : 'System');
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // spawn
      if (lower.startsWith('spawn ') && defaultConn) {
        const taskText = text.slice(6).trim();
        setProcessing(true);
        try {
          addMsg(`⏳ Spawning sub-agent: "${taskText.slice(0, 60)}..."`, false, 'System');
          const result = await withTimeout(spawnSubAgent(defaultConn.config, taskText), 30000, 'Spawn');
          addMsg(result.ok ? `🚀 Sub-agent spawned!\n\n${result.reply || '(launched)'}` : `❌ ${result.error || 'Spawn failed'}`, false, result.ok ? defaultConn.conn.name : 'System');
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Spawn failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // subagents
      if ((lower === 'subagents' || lower === 'sub-agents' || lower === 'spawns') && defaultConn) {
        setProcessing(true);
        try {
          const result = await withTimeout(listSubAgents(defaultConn.config), 15000, 'Subagents');
          addMsg(result.ok ? `🚀 Sub-agents:\n\n${result.reply || 'None running'}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // search
      if (lower.startsWith('search ') && defaultConn) {
        const query = text.slice(7).trim();
        setProcessing(true);
        try {
          addMsg(`🔍 Searching: "${query}"...`, false, 'System');
          const result = await withTimeout(runWebSearch(defaultConn.config, query), 15000, 'Search');
          if (result.ok && result.results) {
            const lines = result.results.slice(0, 5).map((r: any) => `• ${r.title || 'No title'}\n  ${r.url || ''}\n  ${(r.description || '').slice(0, 100)}`);
            addMsg(`🔍 Results:\n\n${lines.join('\n\n') || 'No results'}`, false, 'System');
          } else {
            addMsg(`❌ ${result.error || 'Search failed'}`, false, 'System');
          }
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Search failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // cron
      if (lower === 'cron' || lower === 'cron list' || lower === 'jobs') {
        setProcessing(true);
        try {
          const allJobs: string[] = [];
          for (const conn of (connections || []).filter(c => c.status === 'connected' && c.provider === 'openclaw')) {
            const cfg = getConnectionConfig(conn.id);
            if (!cfg) continue;
            const result = await withTimeout(listCronJobs(cfg), 15000, 'Cron');
            if (result.ok && result.jobs) {
              allJobs.push(`\n${PROVIDER_META[conn.provider].icon} ${conn.name}:`);
              result.jobs.forEach((j: any) => { allJobs.push(`  • ${j.name || j.jobId || 'unnamed'} [${j.enabled !== false ? '✅' : '⏸'}]`); });
            }
          }
          addMsg(`⏰ Cron Jobs${allJobs.join('\n') || '\nNo jobs'}`, false, 'System');
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // agents-live
      if ((lower === 'agents-live' || lower === 'live agents') && defaultConn) {
        setProcessing(true);
        try {
          const result = await withTimeout(listAgents(defaultConn.config), 15000, 'Agents');
          addMsg(result.ok ? `🤖 Available agents: ${result.agents?.join(', ') || 'none'}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // cron enable/disable/run
      if ((lower.startsWith('cron enable ') || lower.startsWith('cron disable ') || lower.startsWith('cron run ')) && defaultConn) {
        const parts = text.split(/\s+/);
        const action = parts[1].toLowerCase();
        const jobId = parts.slice(2).join(' ').trim();
        setProcessing(true);
        try {
          if (action === 'run') {
            const result = await withTimeout(manageCronJob(defaultConn.config, 'run', jobId), 15000, 'Cron run');
            addMsg(result.ok ? `✅ ${result.reply}` : `❌ ${result.error}`, false, defaultConn.conn.name);
          } else {
            const enabled = action === 'enable';
            const result = await withTimeout(manageCronJob(defaultConn.config, 'update', jobId, { enabled }), 15000, 'Cron update');
            addMsg(result.ok ? `✅ Job ${enabled ? 'enabled' : 'disabled'}` : `❌ ${result.error}`, false, defaultConn.conn.name);
          }
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // memory
      if ((lower.startsWith('memory ') || lower.startsWith('recall ') || lower.startsWith('remember ')) && defaultConn) {
        const query = text.replace(/^(memory|recall|remember)\s+/i, '').trim();
        setProcessing(true);
        try {
          const result = await withTimeout(searchMemory(defaultConn.config, query), 15000, 'Memory');
          addMsg(result.ok ? `🧠 Memory:\n\n${result.reply || 'Nothing found'}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // msg
      if (lower.startsWith('msg ') && defaultConn) {
        const rest = text.slice(4).trim();
        const spaceIdx = rest.indexOf(' ');
        if (spaceIdx === -1) { addMsg('Usage: msg [sessionKey] [message]', false, 'System'); return; }
        const sessionKey = rest.slice(0, spaceIdx);
        const message = rest.slice(spaceIdx + 1).trim();
        setProcessing(true);
        try {
          const result = await withTimeout(sendSessionMessage(defaultConn.config, sessionKey, message), 15000, 'Message');
          addMsg(result.ok ? `✅ ${result.reply}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }

      // broadcast
      if (lower.startsWith('broadcast ')) {
        const broadcastMsg = text.slice(10).trim();
        setProcessing(true);
        try {
          addMsg(`📢 Broadcasting: "${broadcastMsg}"`, false, 'System');
          const results: string[] = [];
          for (const conn of (connections || []).filter(c => c.status === 'connected')) {
            const cfg = getConnectionConfig(conn.id);
            if (!cfg) continue;
            try {
              const r = await withTimeout(sendAgentTask(cfg, broadcastMsg, 'main'), 15000, 'Broadcast');
              results.push(r.ok ? `✅ ${conn.name}` : `❌ ${conn.name}`);
            } catch { results.push(`❌ ${conn.name} (timeout)`); }
          }
          if (telegramConnected && telegramConfig?.botToken && telegramConfig?.chatId) {
            const tgResult = await sendTgMessage(telegramConfig.botToken, telegramConfig.chatId, broadcastMsg);
            results.push(tgResult.ok ? '✅ Telegram' : '❌ Telegram');
          }
          addMsg(`📢 Broadcast results:\n${results.join('\n')}`, false, 'System');
        } catch (e: any) {
          addMsg(`❌ ${e.message || 'Broadcast failed'}`, false, 'System');
        } finally { setProcessing(false); }
        return;
      }
    }

    // ─── Telegram commands ─────────────────
    if (telegramConnected && telegramConfig && telegramConfig.botToken) {
      if (lower.startsWith('tg ') && lower !== 'tg-feed') {
        const msg = text.slice(3).trim();
        if (!telegramConfig.chatId) { addMsg('❌ No chat ID configured.', false, 'Telegram'); return; }
        setProcessing(true);
        try {
          const result = await sendTgMessage(telegramConfig.botToken, telegramConfig.chatId, msg);
          addMsg(result.ok ? `✈️ Sent: "${msg}"` : `❌ ${result.error || 'Send failed'}`, false, 'Telegram');
        } finally { setProcessing(false); }
        return;
      }
      if (lower === 'tg-feed' || lower === 'telegram feed') {
        if (telegramMessages && telegramMessages.length > 0) {
          const lines = telegramMessages.slice(0, 10).map(m => `[${m.from?.first_name || 'Unknown'}] ${m.text || '(no text)'}`);
          addMsg(`✈️ Recent Telegram (${telegramMessages.length} msgs)\n\n${lines.join('\n')}`, false, 'Telegram');
        } else {
          addMsg('✈️ No Telegram messages yet.', false, 'Telegram');
        }
        return;
      }
    }

    // Not connected hints
    if (lower.startsWith('task ') || lower === 'sessions' || lower.startsWith('search ') || lower === 'cron') {
      addMsg('⚠️ No connections active. Go to ⚙️ → Connections to add one.', false, 'System');
      return;
    }
    if (lower.startsWith('tg ')) {
      addMsg('⚠️ Telegram not connected. Go to ⚙️ → Telegram.', false, 'System');
      return;
    }

    // Route unrecognized input to BlackSwan instead of a dead-end
    const swanReply = processBlackSwanCommand(text, agents, connections || []);
    addMsg(swanReply, false, 'BlackSwan');
  };

  if (minimized) {
    return (
      <Pressable onPress={onToggle} style={[styles.minimized, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
        <Text style={styles.minimizedIcon}>{'💬'}</Text>
        <Text style={styles.minimizedText}>OFFICE TERMINAL</Text>
        <Text style={styles.minimizedBadge}>{messages.length}</Text>
      </Pressable>
    );
  }

  const connectedCount = connections?.filter(c => c.status === 'connected').length || 0;

  return (
    <View style={[styles.container, fullscreen && styles.containerFullscreen]}>
      <View style={[styles.header, fullscreen && styles.headerFullscreen]}>
        <Text style={styles.headerIcon}>{'💬'}</Text>
        <Text style={styles.headerTitle}>OFFICE TERMINAL</Text>
        {bridgeOnline && (
          <View style={{ backgroundColor: '#22c55e20', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, borderColor: '#22c55e30', flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#22c55e' }} />
            <Text style={{ fontSize: 8, color: '#22c55e', fontFamily: 'monospace', fontWeight: '800' }}>SH</Text>
          </View>
        )}
        {connectedCount > 0 && (
          <View style={styles.connCountBadge}>
            <Text style={styles.connCountText}>{connectedCount}</Text>
          </View>
        )}
        {telegramConnected && <Text style={styles.connIcon}>✈️</Text>}
        {onFullscreenToggle && (
          <Pressable onPress={onFullscreenToggle} style={[styles.fullscreenBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.fullscreenBtnText}>{fullscreen ? '⛶' : '⛶'}</Text>
          </Pressable>
        )}
        {!fullscreen && (
          <Pressable onPress={onToggle} style={[styles.minimizeBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.minimizeBtnText}>—</Text>
          </Pressable>
        )}
      </View>

      {/* Quick Actions - Compact version */}
      {agents && agents.length > 0 && getConnectionConfig && onActionResult && (
        <View style={styles.quickActionsBar}>
          <OfficeActionPanel
            agents={agents}
            getConfig={getConnectionConfig}
            onResult={onActionResult}
            compact={true}
          />
        </View>
      )}

      <View style={{ flex: 1, position: 'relative' }}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          style={styles.messageList}
          contentContainerStyle={styles.messageContent}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const isNearBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 50;
            setShowScrollBtn(!isNearBottom);
          }}
          scrollEventThrottle={400}
          renderItem={({ item }) => (
            <View style={[styles.msgRow, item.isUser && styles.msgRowUser]}>
              {!item.isUser && <Text style={styles.msgAgent}>{item.agent}</Text>}
              <View style={[styles.msgBubble, item.isUser ? styles.msgBubbleUser : styles.msgBubbleBot,
                item.agent === 'System' && styles.msgBubbleOC,
                item.agent === 'Telegram' && styles.msgBubbleTG,
                item.agent === 'Shell' && styles.msgBubbleShell,
              ]}>
                <Text style={[styles.msgText, item.isUser && styles.msgTextUser]} selectable>
                  {item.text}
                </Text>
              </View>
            </View>
          )}
        />
        
        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <Pressable
            onPress={scrollToBottom}
            style={[styles.scrollBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={styles.scrollBtnText}>↓</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={input}
          onChangeText={(text) => {
            setInput(text);
            setHistoryIndex(-1); // Reset history navigation on manual input
          }}
          onSubmitEditing={sendMessage}
          onKeyPress={handleKeyPress}
          placeholder={processing ? 'Working...' : 'Type a command... (↑↓ for history, "help" for commands)'}
          placeholderTextColor="#666"
          returnKeyType="send"
          editable={!processing}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
        />
        <Pressable
          onPress={sendMessage}
          style={[styles.sendBtn, processing && { opacity: 0.5 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          disabled={processing}
        >
          <Text style={styles.sendText}>{processing ? '⏳' : '↑'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a12', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 12, overflow: 'hidden', flex: 1, minHeight: 200,
  },
  containerFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: '#000',
    zIndex: 3000,
  },
  headerFullscreen: {
    backgroundColor: '#0d0d14',
    borderBottomWidth: 2,
    borderBottomColor: '#6366f1',
    paddingVertical: 12,
  },
  minimized: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0a0a12', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  minimizedIcon: { fontSize: 14 },
  minimizedText: { fontSize: 10, color: '#666', fontFamily: 'monospace', fontWeight: '700', letterSpacing: 1, flex: 1 },
  minimizedBadge: {
    fontSize: 9, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800',
    backgroundColor: '#6366f115', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  headerIcon: { fontSize: 12 },
  headerTitle: { fontSize: 10, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1, flex: 1 },
  connCountBadge: {
    backgroundColor: '#22c55e20', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1,
    borderWidth: 1, borderColor: '#22c55e30',
  },
  connCountText: { fontSize: 9, color: '#22c55e', fontFamily: 'monospace', fontWeight: '800' },
  connIcon: { fontSize: 10 },
  minimizeBtn: {
    width: 24, height: 24, borderRadius: 6, backgroundColor: '#ffffff08',
    alignItems: 'center', justifyContent: 'center',
  },
  minimizeBtnText: { color: '#666', fontSize: 14, fontWeight: '800' },
  fullscreenBtn: {
    width: 24, height: 24, borderRadius: 6, backgroundColor: '#6366f115',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#6366f130',
  },
  fullscreenBtnText: { color: '#6366f1', fontSize: 12, fontWeight: '800' },
  quickActionsBar: {
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#08080e',
  },
  messageList: { flex: 1 },
  messageContent: { padding: 10, gap: 8 },
  msgRow: { gap: 2 },
  msgRowUser: { alignItems: 'flex-end' },
  msgAgent: { fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: '700', marginLeft: 4, marginBottom: 2 },
  msgBubble: { maxWidth: '85%' as any, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  msgBubbleBot: { backgroundColor: '#222222', borderWidth: 1, borderColor: '#2a2a2a', alignSelf: 'flex-start' },
  msgBubbleUser: { backgroundColor: '#6366f1', alignSelf: 'flex-end' },
  msgBubbleOC: { borderColor: '#6366f140' },
  msgBubbleTG: { borderColor: '#0088cc40' },
  msgBubbleShell: { borderColor: '#22c55e40', backgroundColor: '#0a1210' },
  msgText: { fontSize: 14, color: '#ccc', fontFamily: 'monospace', lineHeight: 20 },
  msgTextUser: { color: '#fff' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8,
    borderTopWidth: 1, borderTopColor: '#2a2a2a',
  },
  input: {
    flex: 1, backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: '#ddd', fontFamily: 'monospace', fontSize: 14, minHeight: 48,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  scrollBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
    borderWidth: 2,
    borderColor: '#8b5cf6',
  },
  scrollBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
