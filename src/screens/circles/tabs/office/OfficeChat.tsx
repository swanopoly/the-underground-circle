import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, Pressable, Platform,
} from 'react-native';
import { OfficeAgent } from '../../../../lib/officeAgents';
import {
  OpenClawConfig, listSessions, getSessionStatus, getSessionHistory,
  sendAgentTask, listAgents, listCronJobs, runWebSearch,
  spawnSubAgent, manageCronJob, searchMemory, sendSessionMessage, listSubAgents,
} from '../../../../lib/openclawService';
import { AgentConnection, PROVIDER_META } from '../../../../lib/connectionManager';
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
  // Multi-connection support
  connections?: AgentConnection[];
  getConnectionConfig?: (id: string) => OpenClawConfig | null;
  // Telegram
  telegramConfig?: { botToken: string; chatId: string } | null;
  telegramConnected?: boolean;
  telegramMessages?: TelegramMessage[];
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

function processLocalCommand(text: string, agents: OfficeAgent[], connections?: AgentConnection[]): { response: string; command?: OfficeCommand } | null {
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

  if (lower === 'help' || lower === '?') {
    const { getCollaborationHelp } = await import('../../../../lib/officeChatCommands');
    return {
      response: `🏢 Office Commands\n\n` +
        `LOCAL:\n• status — Office overview\n• agents — List all agents\n• connections — List all connections\n• agent [name] — Agent details\n• costs — Cost breakdown\n• theme [name] — Change theme\n\n` +
        `AGENT COMMANDS:\n• ask [question] — Ask default agent\n• task [message] — Send task to default agent\n• task @[name] [message] — Route to connection/agent\n• spawn [task] — Launch background sub-agent\n• subagents — List running sub-agents\n• msg [session] [text] — Message a session\n• broadcast [msg] — Send to all channels\n\n` +
        `${getCollaborationHelp()}\n\n` +
        `SESSION & DATA:\n• sessions — All sessions (all connections)\n• session [key] — Session details\n• history [key] — Message history\n• memory [query] — Search agent memory\n• search [query] — Web search\n\n` +
        `CRON JOBS:\n• cron — List all jobs\n• cron run [id] — Run job now\n• cron enable/disable [id]\n\n` +
        `INTEGRATIONS:\n• agents-live — List real agent IDs\n• tg [message] — Send to Telegram\n• tg-feed — Recent Telegram messages`,
    };
  }

  return null;
}

export default function OfficeChat({
  circleId, onCommand, minimized, onToggle,
  agents = [],
  connections, getConnectionConfig,
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

  const anyConnected = connections?.some(c => c.status === 'connected') || false;

  const sendMessage = async () => {
    if (!input.trim() || processing) return;
    const text = input.trim();
    setInput('');
    addMsg(text, true);

    // Try local commands first
    const local = processLocalCommand(text, agents, connections);
    if (local) {
      addMsg(local.response, false, 'Office AI');
      if (local.command && onCommand) onCommand(local.command);
      return;
    }

    // Try collaboration commands (project management + messaging)
    if (anyConnected && getConnectionConfig) {
      const { processCollaborationCommand } = await import('../../../../lib/officeChatCommands');
      const collab = await processCollaborationCommand(text, agents, connections || [], getConnectionConfig);
      if (collab) {
        addMsg(collab.response, false, collab.success ? 'Office AI' : 'Error');
        return;
      }
    }

    const lower = text.toLowerCase();

    // ─── Multi-connection commands ─────────────────
    if (anyConnected && getConnectionConfig) {
      const defaultConn = getDefaultConfig(connections, getConnectionConfig);

      // sessions — show from all connections
      if (lower === 'sessions' || lower === 'list sessions') {
        setProcessing(true);
        addMsg('⏳ Fetching sessions from all connections...', false, 'System');
        const allLines: string[] = [];
        for (const conn of (connections || []).filter(c => c.status === 'connected')) {
          const cfg = getConnectionConfig(conn.id);
          if (!cfg) continue;
          const result = await listSessions(cfg);
          if (result.ok && result.sessions) {
            const meta = PROVIDER_META[conn.provider];
            allLines.push(`\n${meta.icon} ${conn.name}:`);
            result.sessions.forEach(s => {
              allLines.push(`  • ${s.sessionKey} [${s.kind}]${s.agentId ? ` agent:${s.agentId}` : ''}${s.model ? ` (${s.model})` : ''}`);
            });
          }
        }
        addMsg(`📡 Sessions${allLines.join('\n') || '\nNo active sessions'}`, false, 'System');
        setProcessing(false);
        return;
      }

      // session detail
      if (lower.startsWith('session ') && defaultConn) {
        const key = text.slice(8).trim();
        setProcessing(true);
        addMsg(`⏳ Getting status for ${key}...`, false, 'System');
        const result = await getSessionStatus(defaultConn.config, key);
        if (result.ok && result.status) {
          const s = result.status;
          addMsg(
            `📊 Session: ${s.sessionKey}\nModel: ${s.model || 'unknown'}\nTurns: ${s.turns || '?'}\nInput: ${s.totalInputTokens?.toLocaleString() || '?'}\nOutput: ${s.totalOutputTokens?.toLocaleString() || '?'}\nCost: ${s.totalCost != null ? `$${s.totalCost.toFixed(4)}` : '?'}`,
            false, defaultConn.conn.name
          );
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'System');
        }
        setProcessing(false);
        return;
      }

      // history
      if (lower.startsWith('history ') && defaultConn) {
        const key = text.slice(8).trim();
        setProcessing(true);
        const result = await getSessionHistory(defaultConn.config, key);
        if (result.ok && result.messages) {
          const lines = result.messages.slice(-8).map(m =>
            `[${m.role}] ${m.content.slice(0, 120)}${m.content.length > 120 ? '...' : ''}`
          );
          addMsg(`📝 Last ${lines.length} messages:\n\n${lines.join('\n\n')}`, false, defaultConn.conn.name);
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'System');
        }
        setProcessing(false);
        return;
      }

      // task — route to specific connection by @name or default
      if (lower.startsWith('task ')) {
        const taskText = text.slice(5).trim();
        let targetCfg = defaultConn?.config;
        let targetName = defaultConn?.conn.name || 'default';
        let agentId = 'main';
        let taskMsg = taskText;

        const atMatch = taskText.match(/^@(\S+)\s+(.*)/s);
        if (atMatch) {
          const target = atMatch[1];
          taskMsg = atMatch[2];
          // Try matching connection name first
          const matchedConn = findConnectionByName(connections, target);
          if (matchedConn && getConnectionConfig(matchedConn.id)) {
            targetCfg = getConnectionConfig(matchedConn.id)!;
            targetName = matchedConn.name;
          } else {
            agentId = target;
          }
        }

        if (!targetCfg) {
          addMsg('❌ No connected endpoint. Add a connection in ⚙️.', false, 'System');
          return;
        }

        setProcessing(true);
        addMsg(`⏳ Sending to ${targetName} (${agentId})...`, false, 'System');
        const result = await sendAgentTask(targetCfg, taskMsg, agentId);
        if (result.ok) {
          addMsg(`✅ Response:\n\n${result.reply || '(no response)'}`, false, targetName);
        } else {
          addMsg(`❌ ${result.error || 'Task failed'}`, false, 'System');
        }
        setProcessing(false);
        return;
      }

      // ask
      if (lower.startsWith('ask ') && defaultConn) {
        const question = text.slice(4).trim();
        setProcessing(true);
        addMsg(`⏳ Asking ${defaultConn.conn.name}...`, false, 'System');
        const result = await sendAgentTask(defaultConn.config, question, 'main');
        if (result.ok) {
          addMsg(`💬 ${result.reply || '(no response)'}`, false, defaultConn.conn.name);
        } else {
          addMsg(`❌ ${result.error || 'Failed'}`, false, 'System');
        }
        setProcessing(false);
        return;
      }

      // spawn
      if (lower.startsWith('spawn ') && defaultConn) {
        const taskText = text.slice(6).trim();
        setProcessing(true);
        addMsg(`⏳ Spawning sub-agent: "${taskText.slice(0, 60)}..."`, false, 'System');
        const result = await spawnSubAgent(defaultConn.config, taskText);
        if (result.ok) {
          addMsg(`🚀 Sub-agent spawned!\n\n${result.reply || '(launched)'}`, false, defaultConn.conn.name);
        } else {
          addMsg(`❌ ${result.error || 'Spawn failed'}`, false, 'System');
        }
        setProcessing(false);
        return;
      }

      // subagents
      if ((lower === 'subagents' || lower === 'sub-agents' || lower === 'spawns') && defaultConn) {
        setProcessing(true);
        const result = await listSubAgents(defaultConn.config);
        addMsg(result.ok ? `🚀 Sub-agents:\n\n${result.reply || 'None running'}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        setProcessing(false);
        return;
      }

      // search
      if (lower.startsWith('search ') && defaultConn) {
        const query = text.slice(7).trim();
        setProcessing(true);
        addMsg(`🔍 Searching: "${query}"...`, false, 'System');
        const result = await runWebSearch(defaultConn.config, query);
        if (result.ok && result.results) {
          const lines = result.results.slice(0, 5).map((r: any) =>
            `• ${r.title || 'No title'}\n  ${r.url || ''}\n  ${(r.description || '').slice(0, 100)}`
          );
          addMsg(`🔍 Results:\n\n${lines.join('\n\n') || 'No results'}`, false, 'System');
        } else {
          addMsg(`❌ ${result.error || 'Search failed'}`, false, 'System');
        }
        setProcessing(false);
        return;
      }

      // cron
      if (lower === 'cron' || lower === 'cron list' || lower === 'jobs') {
        setProcessing(true);
        const allJobs: string[] = [];
        for (const conn of (connections || []).filter(c => c.status === 'connected' && c.provider === 'openclaw')) {
          const cfg = getConnectionConfig(conn.id);
          if (!cfg) continue;
          const result = await listCronJobs(cfg);
          if (result.ok && result.jobs) {
            allJobs.push(`\n${PROVIDER_META[conn.provider].icon} ${conn.name}:`);
            result.jobs.forEach((j: any) => {
              allJobs.push(`  • ${j.name || j.jobId || 'unnamed'} [${j.enabled !== false ? '✅' : '⏸'}]`);
            });
          }
        }
        addMsg(`⏰ Cron Jobs${allJobs.join('\n') || '\nNo jobs'}`, false, 'System');
        setProcessing(false);
        return;
      }

      // agents-live
      if ((lower === 'agents-live' || lower === 'live agents') && defaultConn) {
        setProcessing(true);
        const result = await listAgents(defaultConn.config);
        addMsg(result.ok ? `🤖 Available agents: ${result.agents?.join(', ') || 'none'}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        setProcessing(false);
        return;
      }

      // cron enable/disable/run
      if ((lower.startsWith('cron enable ') || lower.startsWith('cron disable ') || lower.startsWith('cron run ')) && defaultConn) {
        const parts = text.split(/\s+/);
        const action = parts[1].toLowerCase();
        const jobId = parts.slice(2).join(' ').trim();
        setProcessing(true);
        if (action === 'run') {
          const result = await manageCronJob(defaultConn.config, 'run', jobId);
          addMsg(result.ok ? `✅ ${result.reply}` : `❌ ${result.error}`, false, defaultConn.conn.name);
        } else {
          const enabled = action === 'enable';
          const result = await manageCronJob(defaultConn.config, 'update', jobId, { enabled });
          addMsg(result.ok ? `✅ Job ${enabled ? 'enabled' : 'disabled'}` : `❌ ${result.error}`, false, defaultConn.conn.name);
        }
        setProcessing(false);
        return;
      }

      // memory
      if ((lower.startsWith('memory ') || lower.startsWith('recall ') || lower.startsWith('remember ')) && defaultConn) {
        const query = text.replace(/^(memory|recall|remember)\s+/i, '').trim();
        setProcessing(true);
        const result = await searchMemory(defaultConn.config, query);
        addMsg(result.ok ? `🧠 Memory:\n\n${result.reply || 'Nothing found'}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        setProcessing(false);
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
        const result = await sendSessionMessage(defaultConn.config, sessionKey, message);
        addMsg(result.ok ? `✅ ${result.reply}` : `❌ ${result.error || 'Failed'}`, false, defaultConn.conn.name);
        setProcessing(false);
        return;
      }

      // broadcast
      if (lower.startsWith('broadcast ')) {
        const broadcastMsg = text.slice(10).trim();
        setProcessing(true);
        addMsg(`📢 Broadcasting: "${broadcastMsg}"`, false, 'System');
        const results: string[] = [];
        for (const conn of (connections || []).filter(c => c.status === 'connected')) {
          const cfg = getConnectionConfig(conn.id);
          if (!cfg) continue;
          const r = await sendAgentTask(cfg, broadcastMsg, 'main');
          results.push(r.ok ? `✅ ${conn.name}` : `❌ ${conn.name}`);
        }
        if (telegramConnected && telegramConfig?.botToken && telegramConfig?.chatId) {
          const tgResult = await sendTgMessage(telegramConfig.botToken, telegramConfig.chatId, broadcastMsg);
          results.push(tgResult.ok ? '✅ Telegram' : '❌ Telegram');
        }
        addMsg(`📢 Broadcast results:\n${results.join('\n')}`, false, 'System');
        setProcessing(false);
        return;
      }
    }

    // ─── Telegram commands ─────────────────
    if (telegramConnected && telegramConfig && telegramConfig.botToken) {
      if (lower.startsWith('tg ') && lower !== 'tg-feed') {
        const msg = text.slice(3).trim();
        if (!telegramConfig.chatId) { addMsg('❌ No chat ID configured.', false, 'Telegram'); return; }
        setProcessing(true);
        const result = await sendTgMessage(telegramConfig.botToken, telegramConfig.chatId, msg);
        addMsg(result.ok ? `✈️ Sent: "${msg}"` : `❌ ${result.error || 'Send failed'}`, false, 'Telegram');
        setProcessing(false);
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

  const connectedCount = connections?.filter(c => c.status === 'connected').length || 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerIcon}>{'💬'}</Text>
        <Text style={styles.headerTitle}>OFFICE TERMINAL</Text>
        {connectedCount > 0 && (
          <View style={styles.connCountBadge}>
            <Text style={styles.connCountText}>{connectedCount}</Text>
          </View>
        )}
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
              item.agent === 'System' && styles.msgBubbleOC,
              item.agent === 'Telegram' && styles.msgBubbleTG,
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
          placeholderTextColor="#666"
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
  messageList: { flex: 1 },
  messageContent: { padding: 10, gap: 8 },
  msgRow: { gap: 2 },
  msgRowUser: { alignItems: 'flex-end' },
  msgAgent: { fontSize: 11, color: '#888', fontFamily: 'monospace', fontWeight: '700', marginLeft: 4, marginBottom: 2 },
  msgBubble: { maxWidth: '85%' as any, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10 },
  msgBubbleBot: { backgroundColor: '#111118', borderWidth: 1, borderColor: '#1a1a2e', alignSelf: 'flex-start' },
  msgBubbleUser: { backgroundColor: '#6366f1', alignSelf: 'flex-end' },
  msgBubbleOC: { borderColor: '#6366f140' },
  msgBubbleTG: { borderColor: '#0088cc40' },
  msgText: { fontSize: 14, color: '#ccc', fontFamily: 'monospace', lineHeight: 20 },
  msgTextUser: { color: '#fff' },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8,
    borderTopWidth: 1, borderTopColor: '#1a1a2e',
  },
  input: {
    flex: 1, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a2e',
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: '#ddd', fontFamily: 'monospace', fontSize: 14, minHeight: 48,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 10, backgroundColor: '#6366f1',
    alignItems: 'center', justifyContent: 'center',
  },
  sendText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
