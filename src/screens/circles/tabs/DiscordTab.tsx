import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, FlatList, StyleSheet, Platform,
  Pressable, RefreshControl, ActivityIndicator, ScrollView,
} from 'react-native';
import {
  getCircleDiscordConfig, connectDiscordWithGuildId, disconnectDiscord,
  getCachedChannels, syncChannels, getChannelMessages, sendToChannel,
  getGuildInfo, getGuildIconUrl, channelIcon, isTextChannel,
  DiscordChannel, DiscordMessage, DiscordGuildInfo, CircleDiscordConfig,
} from '../../../lib/discord';

// ─── Types ─────────────────────────────────────────────────────────

type ViewMode = 'setup' | 'channels' | 'messages';

// ─── Main Component ────────────────────────────────────────────────

export default function DiscordTab({ circleId }: { circleId: string }) {
  const [config, setConfig] = useState<CircleDiscordConfig | null>(null);
  const [guild, setGuild] = useState<DiscordGuildInfo | null>(null);
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [view, setView] = useState<ViewMode>('setup');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Setup fields
  const [botToken, setBotToken] = useState('');
  const [guildId, setGuildId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [setupError, setSetupError] = useState('');

  // Messages view
  const [activeChannel, setActiveChannel] = useState<DiscordChannel | null>(null);
  const [messages, setMessages] = useState<DiscordMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [msgInput, setMsgInput] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);

  // ─── Init ────────────────────────────────────────────────────────

  useEffect(() => { loadConfig(); }, [circleId]);

  const loadConfig = async () => {
    setLoading(true);
    const cfg = await getCircleDiscordConfig(circleId);
    setConfig(cfg);

    if (cfg.guild_id && cfg.bot_token) {
      // Connected — load guild info and channels
      const [guildInfo, chans] = await Promise.all([
        getGuildInfo(cfg.guild_id, cfg.bot_token),
        getCachedChannels(circleId),
      ]);
      setGuild(guildInfo);
      setChannels(chans);
      setView('channels');
    } else {
      setView('setup');
    }
    setLoading(false);
  };

  // ─── Connect ─────────────────────────────────────────────────────

  const handleConnect = async () => {
    setSetupError('');
    if (!botToken.trim()) { setSetupError('Bot token is required'); return; }
    if (!guildId.trim()) { setSetupError('Server ID is required'); return; }

    setConnecting(true);
    const result = await connectDiscordWithGuildId(circleId, botToken.trim(), guildId.trim());

    if (result.success && result.guild) {
      setGuild(result.guild);
      setConfig({
        guild_id: result.guild.id,
        bot_token: botToken.trim(),
        webhook_url: null,
        connected_at: new Date().toISOString(),
      });
      const chans = await getCachedChannels(circleId);
      setChannels(chans);
      setView('channels');
    } else {
      setSetupError(result.error || 'Failed to connect');
    }
    setConnecting(false);
  };

  const handleDisconnect = async () => {
    await disconnectDiscord(circleId);
    setConfig(null);
    setGuild(null);
    setChannels([]);
    setView('setup');
  };

  // ─── Refresh ─────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setRefreshing(true);
    if (config?.guild_id && config?.bot_token) {
      await syncChannels(circleId, config.guild_id, config.bot_token);
      const chans = await getCachedChannels(circleId);
      setChannels(chans);
      const guildInfo = await getGuildInfo(config.guild_id, config.bot_token);
      if (guildInfo) setGuild(guildInfo);
    }
    setRefreshing(false);
  };

  // ─── Channel Messages ────────────────────────────────────────────

  const openChannel = async (channel: DiscordChannel) => {
    if (!config?.bot_token) return;
    setActiveChannel(channel);
    setView('messages');
    setLoadingMsgs(true);
    try {
      const msgs = await getChannelMessages(channel.id, config.bot_token, 30);
      setMessages(msgs.reverse());
    } catch (e: any) {
      setMessages([]);
    }
    setLoadingMsgs(false);
  };

  const refreshMessages = async () => {
    if (!activeChannel || !config?.bot_token) return;
    const msgs = await getChannelMessages(activeChannel.id, config.bot_token, 30);
    setMessages(msgs.reverse());
  };

  const handleSendToDiscord = async () => {
    if (!msgInput.trim() || !activeChannel || !config?.bot_token) return;
    setSendingMsg(true);
    const result = await sendToChannel(activeChannel.id, msgInput.trim(), config.bot_token);
    if (result.success) {
      setMsgInput('');
      await refreshMessages();
    }
    setSendingMsg(false);
  };

  // ─── Render: Loading ─────────────────────────────────────────────

  if (loading) {
    return (
      <View style={st.centered}>
        <ActivityIndicator color="#fff" />
        <Text style={st.loadingText}>Loading Discord...</Text>
      </View>
    );
  }

  // ─── Render: Setup ───────────────────────────────────────────────

  if (view === 'setup') {
    return (
      <ScrollView style={st.container} contentContainerStyle={st.setupContent}>
        <View style={st.setupHeader}>
          <Text style={st.setupIcon}>🎮</Text>
          <Text style={st.setupTitle}>CONNECT DISCORD</Text>
          <Text style={st.setupSubtitle}>
            Link your Discord server to this circle.{'\n'}
            Members can browse channels and chat from here.
          </Text>
        </View>

        {setupError ? (
          <View style={st.errorBox}>
            <Text style={st.errorText}>{setupError}</Text>
          </View>
        ) : null}

        <View style={st.setupSteps}>
          <Text style={st.stepTitle}>HOW TO CONNECT</Text>
          <View style={st.stepCard}>
            <Text style={st.stepNum}>1</Text>
            <View style={st.stepInfo}>
              <Text style={st.stepLabel}>Create a Discord Bot</Text>
              <Text style={st.stepDesc}>
                Go to discord.com/developers → New Application → Bot tab → Copy Token
              </Text>
            </View>
          </View>
          <View style={st.stepCard}>
            <Text style={st.stepNum}>2</Text>
            <View style={st.stepInfo}>
              <Text style={st.stepLabel}>Invite Bot to Your Server</Text>
              <Text style={st.stepDesc}>
                OAuth2 → URL Generator → Select "bot" scope + "Read Messages" + "Send Messages" → Open URL
              </Text>
            </View>
          </View>
          <View style={st.stepCard}>
            <Text style={st.stepNum}>3</Text>
            <View style={st.stepInfo}>
              <Text style={st.stepLabel}>Get Server ID</Text>
              <Text style={st.stepDesc}>
                Enable Developer Mode in Discord Settings → Right-click server → Copy Server ID
              </Text>
            </View>
          </View>
        </View>

        <Text style={st.inputLabel}>BOT TOKEN</Text>
        <TextInput
          style={st.input}
          placeholder="Paste your bot token..."
          placeholderTextColor="#444"
          value={botToken}
          onChangeText={setBotToken}
          secureTextEntry
          autoCapitalize="none"
        />

        <Text style={st.inputLabel}>SERVER ID</Text>
        <TextInput
          style={st.input}
          placeholder="e.g. 941919469268254760"
          placeholderTextColor="#444"
          value={guildId}
          onChangeText={setGuildId}
          autoCapitalize="none"
          keyboardType="numeric"
        />

        <Pressable
          onPress={handleConnect}
          disabled={connecting || !botToken.trim() || !guildId.trim()}
          style={[st.connectBtn, (connecting || !botToken.trim() || !guildId.trim()) && st.connectBtnDisabled]}
        >
          <Text style={st.connectBtnText}>
            {connecting ? 'CONNECTING...' : '🔗 CONNECT SERVER'}
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // ─── Render: Messages ────────────────────────────────────────────

  if (view === 'messages' && activeChannel) {
    return (
      <View style={st.container}>
        {/* Channel header */}
        <View style={st.channelHeader}>
          <Pressable onPress={() => { setView('channels'); setActiveChannel(null); }} style={st.backBtn}>
            <Text style={st.backBtnText}>←</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={st.channelName}># {activeChannel.name}</Text>
            {activeChannel.topic && <Text style={st.channelTopic}>{activeChannel.topic}</Text>}
          </View>
          <Pressable onPress={refreshMessages} style={st.refreshBtn}>
            <Text style={st.refreshBtnText}>↻</Text>
          </Pressable>
        </View>

        {/* Messages */}
        {loadingMsgs ? (
          <View style={st.centered}><ActivityIndicator color="#fff" /></View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={m => m.id}
            renderItem={({ item }) => (
              <View style={st.msgRow}>
                <View style={st.msgAvatar}>
                  <Text style={st.msgAvatarText}>
                    {(item.author.global_name || item.author.username || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={st.msgHeader}>
                    <Text style={st.msgAuthor}>{item.author.global_name || item.author.username}</Text>
                    <Text style={st.msgTime}>
                      {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <Text style={st.msgContent}>{item.content || '[embed/attachment]'}</Text>
                </View>
              </View>
            )}
            contentContainerStyle={st.msgList}
            ListEmptyComponent={
              <View style={st.centered}><Text style={st.emptyText}>No messages in this channel</Text></View>
            }
          />
        )}

        {/* Send message */}
        <View style={st.msgInputBar}>
          <TextInput
            style={st.msgInput}
            placeholder={`Message #${activeChannel.name}...`}
            placeholderTextColor="#444"
            value={msgInput}
            onChangeText={setMsgInput}
            onSubmitEditing={handleSendToDiscord}
            maxLength={2000}
          />
          <Pressable
            onPress={handleSendToDiscord}
            disabled={!msgInput.trim() || sendingMsg}
            style={[st.msgSendBtn, (!msgInput.trim() || sendingMsg) && { opacity: 0.4 }]}
          >
            <Text style={st.msgSendText}>↑</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ─── Render: Channels List ───────────────────────────────────────

  const categories = channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);
  const uncategorized = channels.filter(c => c.type !== 4 && !c.parent_id).sort((a, b) => a.position - b.position);

  return (
    <View style={st.container}>
      {/* Server header */}
      <View style={st.serverHeader}>
        <View style={st.serverInfo}>
          <Text style={st.serverIcon}>🎮</Text>
          <View style={{ flex: 1 }}>
            <Text style={st.serverName}>{guild?.name || 'Discord Server'}</Text>
            <Text style={st.serverMeta}>
              {guild?.member_count ? `${guild.member_count} members · ` : ''}{channels.filter(c => isTextChannel(c.type)).length} channels
            </Text>
          </View>
          <Pressable onPress={handleRefresh} style={st.refreshBtn}>
            <Text style={st.refreshBtnText}>{refreshing ? '⏳' : '↻'}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#fff" />}
      >
        {/* Uncategorized channels */}
        {uncategorized.map(ch => (
          <ChannelRow
            key={ch.id}
            channel={ch}
            onPress={() => isTextChannel(ch.type) && openChannel(ch)}
          />
        ))}

        {/* Categories with children */}
        {categories.map(cat => {
          const children = channels
            .filter(c => c.parent_id === cat.id && c.type !== 4)
            .sort((a, b) => a.position - b.position);
          return (
            <View key={cat.id}>
              <View style={st.categoryRow}>
                <Text style={st.categoryName}>{cat.name.toUpperCase()}</Text>
              </View>
              {children.map(ch => (
                <ChannelRow
                  key={ch.id}
                  channel={ch}
                  onPress={() => isTextChannel(ch.type) && openChannel(ch)}
                />
              ))}
            </View>
          );
        })}

        {/* Disconnect */}
        <View style={st.disconnectSection}>
          <Pressable onPress={handleDisconnect} style={st.disconnectBtn}>
            <Text style={st.disconnectText}>⏏ DISCONNECT DISCORD</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Channel Row ───────────────────────────────────────────────────

function ChannelRow({ channel, onPress }: { channel: DiscordChannel; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  const isText = isTextChannel(channel.type);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[st.channelRow, hovered && isText && st.channelRowHovered, !isText && { opacity: 0.5 }]}
    >
      <Text style={st.channelIcon}>{channelIcon(channel.type)}</Text>
      <Text style={st.channelLabel}>{channel.name}</Text>
      {isText && <Text style={st.channelArrow}>→</Text>}
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  loadingText: { color: '#555', fontSize: 12, marginTop: 8 },
  emptyText: { color: '#555', fontSize: 14 },

  // Setup
  setupContent: { padding: 24, maxWidth: 860, alignSelf: 'center', width: '100%' },
  setupHeader: { alignItems: 'center', marginBottom: 28 },
  setupIcon: { fontSize: 40, marginBottom: 12 },
  setupTitle: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: 3 },
  setupSubtitle: { color: '#666', fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 20 },
  errorBox: { backgroundColor: '#2a1515', borderWidth: 1, borderColor: '#4a2020', borderRadius: 10, padding: 12, marginBottom: 16 },
  errorText: { color: '#ff6666', fontSize: 13, textAlign: 'center' },
  setupSteps: { marginBottom: 24 },
  stepTitle: { color: '#666', fontSize: 11, letterSpacing: 2, fontWeight: '700', marginBottom: 12 },
  stepCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: '#111', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#000000', marginBottom: 8,
  },
  stepNum: {
    color: '#5865F2', fontSize: 18, fontWeight: '900',
    width: 30, height: 30, textAlign: 'center', lineHeight: 30,
    backgroundColor: '#1a1a3e', borderRadius: 15, overflow: 'hidden',
  },
  stepInfo: { flex: 1 },
  stepLabel: { color: '#fff', fontSize: 14, fontWeight: '700' },
  stepDesc: { color: '#666', fontSize: 12, marginTop: 4, lineHeight: 18 },
  inputLabel: { color: '#555', fontSize: 10, letterSpacing: 2, fontWeight: '700', marginBottom: 6 },
  input: {
    backgroundColor: '#111', borderWidth: 1, borderColor: '#222', borderRadius: 10,
    padding: 14, color: '#fff', fontSize: 15, marginBottom: 16,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  connectBtn: {
    backgroundColor: '#5865F2', borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  connectBtnDisabled: { opacity: 0.4 },
  connectBtnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },

  // Server header
  serverHeader: {
    borderBottomWidth: 1, borderBottomColor: '#000000', padding: 16,
    maxWidth: 860, alignSelf: 'center', width: '100%',
  },
  serverInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  serverIcon: { fontSize: 28 },
  serverName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  serverMeta: { color: '#555', fontSize: 11, marginTop: 2 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#000000',
    justifyContent: 'center', alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  refreshBtnText: { color: '#888', fontSize: 16 },

  // Channels
  categoryRow: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, maxWidth: 860, alignSelf: 'center', width: '100%' },
  categoryName: { color: '#555', fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  channelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 10, paddingHorizontal: 20, maxWidth: 860, alignSelf: 'center', width: '100%',
    borderRadius: 8, marginHorizontal: 8,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  channelRowHovered: { backgroundColor: '#111' },
  channelIcon: { fontSize: 14, width: 20 },
  channelLabel: { color: '#ccc', fontSize: 14, flex: 1 },
  channelArrow: { color: '#333', fontSize: 14 },

  // Channel messages view
  channelHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: '#000000',
    maxWidth: 860, alignSelf: 'center', width: '100%',
  },
  backBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#000000',
    justifyContent: 'center', alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  backBtnText: { color: '#888', fontSize: 16 },
  channelName: { color: '#fff', fontSize: 15, fontWeight: '700' },
  channelTopic: { color: '#555', fontSize: 11, marginTop: 2 },

  msgList: { padding: 16, maxWidth: 860, alignSelf: 'center', width: '100%' },
  msgRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#5865F2',
    justifyContent: 'center', alignItems: 'center',
  },
  msgAvatarText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  msgHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  msgAuthor: { color: '#fff', fontSize: 13, fontWeight: '700' },
  msgTime: { color: '#444', fontSize: 10 },
  msgContent: { color: '#ccc', fontSize: 14, lineHeight: 20 },

  msgInputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    padding: 12, borderTopWidth: 1, borderTopColor: '#000000',
    maxWidth: 860, alignSelf: 'center', width: '100%',
  },
  msgInput: {
    flex: 1, backgroundColor: '#111', borderWidth: 1, borderColor: '#222',
    borderRadius: 12, padding: 12, color: '#fff', fontSize: 14,
    maxHeight: 100,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  msgSendBtn: {
    width: 36, height: 36, borderRadius: 12, backgroundColor: '#5865F2',
    justifyContent: 'center', alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  msgSendText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  // Disconnect
  disconnectSection: { alignItems: 'center', padding: 24, marginTop: 16 },
  disconnectBtn: {
    paddingVertical: 12, paddingHorizontal: 24, borderRadius: 10,
    backgroundColor: '#1a1111', borderWidth: 1, borderColor: '#2e1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  disconnectText: { color: '#cc4444', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
