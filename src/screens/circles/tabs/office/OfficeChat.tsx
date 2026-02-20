import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, Pressable, Platform,
} from 'react-native';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  OpenClawConfig, listSessions, getSessionStatus, getSessionHistory,
  sendAgentTask, listAgents, listCronJobs, runWebSearch,
} from '../../../../lib/openclawService';
import { sendMessage as sendTgMessage, TelegramMessage } from '../../../../lib/telegramService';

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
  | { type: 'agents' };

interface Props {
  circleId: string;
  onCommand?: (cmd: OfficeCommand) => void;
  minimized?: boolean;
  onToggle?: () => void;
  agents?: OfficeAgent[];
  // Live connections
  openclawConfig?: OpenClawConfig | null;
  openclawConnected?: boolean;
  telegramConfig?: { botToken: string; chatId: string } | null;
  telegramConnected?: boolean;
  telegramMessages?: TelegramMessage[];
}

// ─── Local command processing (works without any connection) ───

function processLocalCommand(text: string, agents: OfficeAgent[]): { response: string; command?: OfficeCommand } | null {
  const lower = text.toLowerCase().trim();

  if (lower === 'status' || lower === 'office status') {
    if (agents.length === 0) return { response: '🏢 Office Status\nNo agents connected. Go to ⚙️ → Connect to link your OpenClaw gateway.', command: { type: 'status' } };
    const active = agents.filter(a => a.status === 'active');
    const totalCost = agents.reduce((s, a) => s + a.costToday, 0);
    return {
      response: `🏢 Office Status\n${active.length}/${agents.length} agents active\nCost today: $${totalCost.toFixed(2)}\n\nActive: ${active.map(a => a.name).join(', ')}`,
      command: { type: 'status' },
    };
  }

  if (lower.startsWith('agent ') || lower.startsWith('who is ')) {
    const name = lower.replace(/^(agent |who is )/, '').trim();
    const agent = agents.find(a => a.name.toLowerCase().includes(name));
    if (agent) {
      return {
        response: `🤖 ${agent.name} — ${agent.role}\nStatus: ${agent.status} | Model: ${agent.model}\nCost: $${agent.costToday.toFixed(2)}/day | $${agent.costWeek.toFixed(2)}/wk\nMessages: ${agent.messagesProcessed.toLocaleString()}\n\nRecent:\n${agent.recentActions.slice(0, 3).map(a => `• ${a}`).join('\n')}`,
        command: { type: 'info', query: agent.name },
      };
    }
    return { response: `No agent "${name}". ${agents.length > 0 ? `Available: ${agents.map(a => a.name).join(', ')}` : 'No agents connected.'}` };
  }

  if (lower.includes('cost') || lower.includes('spend')) {
    const totalToday = agents.reduce((s, a) => s + a.costToday, 0);
    const totalWeek = agents.reduce((s, a) => s + a.costWeek, 0);
    const lines = [...agents].sort((a, b) => b.costToday - a.costToday)
      .map(a => `${a.name}: $${a.costToday.toFixed(2)}/day — ${a.model}`);
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
    if (agents.length === 0) return { response: '🤖 No agents connected. Link your OpenClaw gateway in ⚙️ → Connect.', command: { type: 'agents' } };
    const lines = agents.map(a => {
      const dot = a.status === 'active' ? '🟢' : a.status === 'idle' ? '🟡' : a.status === 'error' ? '🔴' : '⚫';
      return `${dot} ${a.name} — ${a.role}`;
    });
    return { response: `🤖 Agent Roster\n\n${lines.join('\n')}`, command: { type: 'agents' } };
  }

  if (lower === 'help' || lower === '?') {
    return {
      response: `🏢 Office Commands\n\n` +
        `LOCAL:\n• status — Office overview\n• agents — List agents\n• agent [name] — Agent details\n• costs — Cost breakdown\n• theme [name] — Change theme\n\n` +
        `OPENCLAW (requires connection):\n• sessions — Live sessions list\n• session [key] — Session details\n• history [key] — Message history\n• task [message] — Send task to main agent\n• task @[agent] [message] — Send to specific agent\n• search [query] — Web search\n• cron — List scheduled jobs\n• agents-live — List real agent IDs\n\n` +
        `TELEGRAM (requires connection):\n• tg [message] — Send to Telegram\n• tg-feed — Recent Telegram messages`,
    };
  }

  return null; // Not a local command
}

export default function OfficeChat({
  circleId, onCommand, minimized, onToggle,
  agents = [],
  openclawConfig, openclawConnected,
  telegramConfig, telegramConnected, telegramMessages,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: '0', text: '🏢 Office Terminal ready. Type "help" for commands.', isUser: false, agent: 'System', timestamp: new Date() },
  ]);
  const [input, setInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const listRef = useRef<FlatList>(null);

  const addMsg = (text: string, isUser: boolean, agent?: string) => {
    const msg: ChatMessage = { id: `${Date.now()}_${Math.random()}`, text, isUser, agent, timestamp: new Date() };
    setMessages(prev => [...prev, msg]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    return msg;
  };

  const sendMessage = async () => {
    if (!input.trim() || processing) return;
    const text = input.trim();
    setInput('');
    addMsg(text, true);

    // Try local commands first
    const local = processLocalCommand(text, agents);
    if (local) {
      addMsg(local.response, false, 'Office AI');
      if (local.command && onCommand) onCommand(local.command);
      return;
    }

    const lower = text.toLowerCase();

    // ─── OpenClaw commands ─────────────────
    if (openclawConnected && openclawConfig) {
      const cfg = openclawConfig;

      // sessions
      if (lower === 'sessions' || lower === 'list sessions') {
        setProcessing(true);
        addMsg('⏳ Fetching live sessions...', false, 'OpenClaw');
        const result = await listSessions(cfg);
        if (result.ok && result.sessions) {
          const lines = result.sessions.map(s =>
            `• ${s.sessionKey} [${s.kind}]${s.agentId ? ` agent:${s.agentId}` : ''}${s.model ? ` (${s.model})` : ''}`
          );
          addMsg(`📡 ${result.sessions.length} Sessions\n\n${lines.join('\n') || 'No active sessions'}`, false, 'OpenClaw');
        } else {
          addMsg(`❌ ${result.error || 'Failed to fetch sessions'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }

      // session detail
      if (lower.startsWith('session ')) {
        const key = text.slice(8).trim();
        setProcessing(true);
        addMsg(`⏳ Getting status for ${key}...`, false, 'OpenClaw');
        const result = await getSessionStatus(cfg, key);
        if (result.ok && result.status) {
          const s = result.status;
          addMsg(
            `📊 Session: ${s.sessionKey}\nModel: ${s.model || 'unknown'}\nTurns: ${s.turns || '?'}\nInput tokens: ${s.totalInputTokens?.toLocaleString() || '?'}\nOutput tokens: ${s.totalOutputTokens?.toLocaleString() || '?'}\nCost: ${s.totalCost != null ? `$${s.totalCost.toFixed(4)}` : '?'}`,
            false, 'OpenClaw'
          );
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }

      // history
      if (lower.startsWith('history ')) {
        const key = text.slice(8).trim();
        setProcessing(true);
        addMsg(`⏳ Pulling history for ${key}...`, false, 'OpenClaw');
        const result = await getSessionHistory(cfg, key);
        if (result.ok && result.messages) {
          const lines = result.messages.slice(-8).map(m =>
            `[${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`
          );
          addMsg(`📝 Last ${lines.length} messages:\n\n${lines.join('\n\n')}`, false, 'OpenClaw');
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }

      // task
      if (lower.startsWith('task ')) {
        const taskText = text.slice(5).trim();
        let agentId = 'main';
        let taskMsg = taskText;
        // Check for @agent prefix
        const atMatch = taskText.match(/^@(\S+)\s+(.*)/s);
        if (atMatch) { agentId = atMatch[1]; taskMsg = atMatch[2]; }
        setProcessing(true);
        addMsg(`⏳ Sending to agent "${agentId}"...`, false, 'OpenClaw');
        const result = await sendAgentTask(cfg, taskMsg, agentId);
        if (result.ok) {
          addMsg(`✅ Agent response:\n\n${result.reply || '(no response)'}`, false, `Agent:${agentId}`);
        } else {
          addMsg(`❌ ${result.error || 'Task failed'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }

      // search
      if (lower.startsWith('search ')) {
        const query = text.slice(7).trim();
        setProcessing(true);
        addMsg(`🔍 Searching: "${query}"...`, false, 'OpenClaw');
        const result = await runWebSearch(cfg, query);
        if (result.ok && result.results) {
          const lines = result.results.slice(0, 5).map((r: any) =>
            `• ${r.title || 'No title'}\n  ${r.url || ''}\n  ${(r.description || '').slice(0, 100)}`
          );
          addMsg(`🔍 Results:\n\n${lines.join('\n\n') || 'No results'}`, false, 'OpenClaw');
        } else {
          addMsg(`❌ ${result.error || 'Search failed'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }

      // cron
      if (lower === 'cron' || lower === 'cron list' || lower === 'jobs') {
        setProcessing(true);
        addMsg('⏳ Fetching cron jobs...', false, 'OpenClaw');
        const result = await listCronJobs(cfg);
        if (result.ok && result.jobs) {
          const lines = result.jobs.map((j: any) =>
            `• ${j.name || j.jobId || 'unnamed'} [${j.enabled !== false ? '✅' : '⏸'}] ${j.schedule?.expr || j.schedule?.kind || ''}`
          );
          addMsg(`⏰ ${result.jobs.length} Cron Jobs\n\n${lines.join('\n') || 'No jobs'}`, false, 'OpenClaw');
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }

      // agents-live
      if (lower === 'agents-live' || lower === 'live agents') {
        setProcessing(true);
        const result = await listAgents(cfg);
        if (result.ok && result.agents) {
          addMsg(`🤖 Available agents: ${result.agents.join(', ') || 'none'}`, false, 'OpenClaw');
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'OpenClaw');
        }
        setProcessing(false);
        return;
      }
    }

    // ─── Telegram commands ─────────────────
    if (telegramConnected && telegramConfig && telegramConfig.botToken) {
      if (lower.startsWith('tg ') && lower !== 'tg-feed') {
        const msg = text.slice(3).trim();
        if (!telegramConfig.chatId) {
          addMsg('❌ No chat ID configured. Set it in ⚙️ → Telegram.', false, 'Telegram');
          return;
        }
        setProcessing(true);
        const result = await sendTgMessage(telegramConfig.botToken, telegramConfig.chatId, msg);
        if (result.ok) {
          addMsg(`✈️ Sent to Telegram: "${msg}"`, false, 'Telegram');
        } else {
          addMsg(`❌ ${result.error || 'Send failed'}`, false, 'Telegram');
        }
        setProcessing(false);
        return;
      }

      if (lower === 'tg-feed' || lower === 'telegram feed') {
        if (telegramMessages && telegramMessages.length > 0) {
          const lines = telegramMessages.slice(0, 10).map(m =>
            `[${m.from?.first_name || 'Unknown'}] ${m.text || '(no text)'}`
          );
          addMsg(`✈️ Recent Telegram (${telegramMessages.length} msgs)\n\n${lines.join('\n')}`, false, 'Telegram');
        } else {
          addMsg('✈️ No Telegram messages yet. Send a message to your bot!', false, 'Telegram');
        }
        return;
      }
    }

    // ─── Not connected hints ─────────────────
    if (lower.startsWith('task ') || lower === 'sessions' || lower.startsWith('search ') || lower === 'cron') {
      addMsg('⚠️ OpenClaw not connected. Go to ⚙️ → Connect to set up your gateway.', false, 'System');
      return;
    }
    if (lower.startsWith('tg ')) {
      addMsg('⚠️ Telegram not connected. Go to ⚙️ → Telegram to set up your bot.', false, 'System');
      return;
    }

    addMsg('Unknown command. Type "help" for all commands.', false, 'Office AI');
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>{'💬'}</Text>
        <Text style={styles.headerTitle}>OFFICE TERMINAL</Text>
        {openclawConnected && <View style={[styles.connDot, { backgroundColor: '#22c55e' }]} />}
        {telegramConnected && <Text style={styles.connIcon}>✈️</Text>}
        <Pressable onPress={onToggle} style={[styles.minimizeBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={styles.minimizeBtnText}>—</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        renderItem={({ item }) => (
          <View style={[styles.msgRow, item.isUser && styles.msgRowUser]}>
            {!item.isUser && <Text style={styles.msgAgent}>{item.agent}</Text>}
            <View style={[styles.msgBubble, item.isUser ? styles.msgBubbleUser : styles.msgBubbleBot,
              item.agent === 'OpenClaw' && styles.msgBubbleOC,
              item.agent === 'Telegram' && styles.msgBubbleTG,
              item.agent?.startsWith('Agent:') && styles.msgBubbleAgent,
            ]}>
              <Text style={[styles.msgText, item.isUser && styles.msgTextUser]}>{item.text}</Text>
            </View>
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={sendMessage}
          placeholder={processing ? 'Working...' : 'Type a command... (try "help")'}
          placeholderTextColor="#444"
          returnKeyType="send"
          editable={!processing}
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
    backgroundColor: '#0a0a12', borderWidth: 1, borderColor: '#1a1a2e',
    borderRadius: 12, overflow: 'hidden', flex: 1, minHeight: 200,
  },
  minimized: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#0a0a12', borderWidth: 1, borderColor: '#1a1a2e',
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
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  headerIcon: { fontSize: 12 },
  headerTitle: { fontSize: 10, color: '#888', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1, flex: 1 },
  connDot: { width: 6, height: 6, borderRadius: 3 },
  connIcon: { fontSize: 10 },
  minimizeBtn: {
    width: 24, height: 24, borderRadius: 6, backgroundColor: '#ffffff08',
    alignItems: 'center', justifyContent: 'center',
  },
  minimizeBtnText: { color: '#666', fontSize: 14, fontWeight: '800' },
  messageList: { flex: 1 },
  messageContent: { padding: 10, gap: 8 },
  msgRow: { gap: 2 },
  msgRowUser: { alignItems: 'flex-end' },
  msgAgent: { fontSize: 8, color: '#555', fontFamily: 'monospace', fontWeight: '700', marginLeft: 4, marginBottom: 1 },
  msgBubble: { maxWidth: '85%' as any, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  msgBubbleBot: { backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a2e', alignSelf: 'flex-start' },
  msgBubbleUser: { backgroundColor: '#6366f1', alignSelf: 'flex-end' },
  msgBubbleOC: { borderColor: '#6366f140' },
  msgBubbleTG: { borderColor: '#0088cc40' },
  msgBubbleAgent: { borderColor: '#22c55e40' },
  msgText: { fontSize: 11, color: '#ccc', fontFamily: 'monospace', lineHeight: 16 },
  msgTextUser: { color: '#fff' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
  },
  input: {
    flex: 1, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
    color: '#ddd', fontFamily: 'monospace', fontSize: 11,
  },
  sendBtn: {
    width: 32, height: 32, borderRadius: 8, backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
