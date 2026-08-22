import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, TextInput, StyleSheet,
  ActivityIndicator, Animated, Easing, Platform, KeyboardAvoidingView,
} from 'react-native';
import {
  PlatformConfig, MessagingPlatform, UnifiedChat, UnifiedMessage,
  PLATFORM_INFO, saveConfig, loadConfig, clearConfig,
  testConnection, getChats, getMessages, sendMsg, formatMessageTime,
  normalizePhoneMessengerExactAuthority, phoneMessengerExactAuthorityMatches,
  PhoneMessengerAuthorityError,
  type PhoneMessengerExactAuthority, type PhoneMessengerAuthorityFence,
} from '../lib/imessageService';

// ─── Types ───────────────────────────────────────────────────────────────────

type Screen = 'picker' | 'setup' | 'chats' | 'thread';

export interface PhoneMessengerUnreadStatus {
  unreadCount: number;
  platform: MessagingPlatform;
  providerLabel: string;
  userId: string;
  circleId: string;
  generation: number;
}

export interface PhoneMessengerProps {
  visible: boolean;
  onClose: () => void;
  onUnreadCount?: (status: PhoneMessengerUnreadStatus) => void;
  exactAuthority: PhoneMessengerExactAuthority | null;
  isExactAuthorityCurrent: PhoneMessengerAuthorityFence;
}

const PLATFORMS: MessagingPlatform[] = ['imessage', 'android', 'telegram', 'discord'];

// ─── Component ───────────────────────────────────────────────────────────────

export default function PhoneMessenger(props: PhoneMessengerProps) {
  const authority = normalizePhoneMessengerExactAuthority(props.exactAuthority);
  let authorityIsCurrent = false;
  if (authority) {
    try { authorityIsCurrent = props.isExactAuthorityCurrent(authority) === true; } catch {}
  }

  // The authority-scoped child owns every credential, contact, message, and
  // draft state. Retiring or replacing the authority synchronously unmounts
  // that state before a different account/circle can render it.
  if (!props.visible || !authority || !authorityIsCurrent) return null;
  const scopeKey = `${encodeURIComponent(authority.userId)}:${encodeURIComponent(authority.circleId)}:${authority.generation}`;
  return (
    <PhoneMessengerAuthoritySession
      key={scopeKey}
      {...props}
      exactAuthority={authority}
    />
  );
}

function PhoneMessengerAuthoritySession({
  visible,
  onClose,
  onUnreadCount,
  exactAuthority,
  isExactAuthorityCurrent,
}: PhoneMessengerProps & { exactAuthority: PhoneMessengerExactAuthority }) {
  const [screen, setScreen] = useState<Screen>('picker');
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Setup form values
  const [selectedPlatform, setSelectedPlatform] = useState<MessagingPlatform>('imessage');
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  // Chats
  const [chats, setChats] = useState<UnifiedChat[]>([]);

  // Thread
  const [activeChat, setActiveChat] = useState<UnifiedChat | null>(null);
  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const authorityRef = useRef<PhoneMessengerExactAuthority>(exactAuthority);
  authorityRef.current = exactAuthority;
  const lifecycleController = useRef(new AbortController()).current;
  const requestControllers = useRef<Record<string, AbortController | undefined>>({});

  const authorityIsCurrent = useCallback((captured: PhoneMessengerExactAuthority) => {
    if (
      lifecycleController.signal.aborted
      || !phoneMessengerExactAuthorityMatches(captured, authorityRef.current)
    ) return false;
    try { return isExactAuthorityCurrent(captured) === true; } catch { return false; }
  }, [isExactAuthorityCurrent, lifecycleController]);

  const beginRequest = useCallback((slot: string) => {
    requestControllers.current[slot]?.abort();
    const controller = new AbortController();
    requestControllers.current[slot] = controller;
    if (lifecycleController.signal.aborted) controller.abort();
    else lifecycleController.signal.addEventListener('abort', () => controller.abort(), { once: true });
    return controller;
  }, [lifecycleController]);

  useEffect(() => () => {
    lifecycleController.abort();
    Object.values(requestControllers.current).forEach(controller => controller?.abort());
    requestControllers.current = {};
  }, [lifecycleController]);

  // Animations
  const phonePulse = useRef(new Animated.Value(0)).current;

  // ─── Init ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!visible) return;
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('init');
    (async () => {
      try {
        const saved = await loadConfig(
          capturedAuthority,
          authorityIsCurrent,
          controller.signal,
        );
        if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
        if (saved) {
          setConfig(saved);
          setSelectedPlatform(saved.platform);
          setLoading(true);
          const ok = await testConnection(
            saved,
            capturedAuthority,
            authorityIsCurrent,
            controller.signal,
          );
          if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
          setLoading(false);
          if (ok) {
            setScreen('chats');
            void loadChatList(saved);
          } else {
            setScreen('setup');
            setError('Could not reach server. Check your connection.');
          }
        } else {
          setScreen('picker');
        }
      } catch (error: any) {
        if (
          authorityIsCurrent(capturedAuthority)
          && !controller.signal.aborted
          && !(error instanceof PhoneMessengerAuthorityError)
        ) setError(error?.message || 'Could not load Messages.');
      }
    })();
    return () => controller.abort();
  }, [authorityIsCurrent, beginRequest, exactAuthority, visible]);

  // Phone pulse animation
  useEffect(() => {
    if (!visible) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(phonePulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(phonePulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [visible]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const selectPlatform = useCallback((p: MessagingPlatform) => {
    setSelectedPlatform(p);
    setFormValues({});
    setError('');
    setScreen('setup');
  }, []);

  const handleConnect = useCallback(async () => {
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('connect');
    if (!authorityIsCurrent(capturedAuthority)) return;
    const info = PLATFORM_INFO[selectedPlatform];
    // Validate required fields (first field is always required)
    const firstField = info.setupFields[0];
    if (!formValues[firstField.key]?.trim()) {
      setError(`Enter your ${firstField.label}`);
      return;
    }

    setLoading(true);
    setError('');
    const cfg: PlatformConfig = {
      platform: selectedPlatform,
      ...Object.fromEntries(
        info.setupFields.map(f => [f.key, formValues[f.key]?.trim() || ''])
      ),
    } as PlatformConfig;

    try {
      const ok = await testConnection(
        cfg,
        capturedAuthority,
        authorityIsCurrent,
        controller.signal,
      );
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
      if (!ok) throw new Error('Connection failed — check your credentials');
      await saveConfig(cfg, capturedAuthority, authorityIsCurrent, controller.signal);
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
      setConfig(cfg);
      setScreen('chats');
      void loadChatList(cfg);
    } catch (e: any) {
      if (
        authorityIsCurrent(capturedAuthority)
        && !controller.signal.aborted
        && !(e instanceof PhoneMessengerAuthorityError)
      ) setError(e.message || 'Could not connect');
    } finally {
      if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) setLoading(false);
    }
  }, [authorityIsCurrent, beginRequest, exactAuthority, formValues, selectedPlatform]);

  const handleDisconnect = useCallback(async () => {
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('disconnect');
    try {
      await clearConfig(capturedAuthority, authorityIsCurrent, controller.signal);
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
      setConfig(null);
      setChats([]);
      setMessages([]);
      setActiveChat(null);
      setFormValues({});
      setCompose('');
      setScreen('picker');
    } catch (error: any) {
      if (
        authorityIsCurrent(capturedAuthority)
        && !controller.signal.aborted
        && !(error instanceof PhoneMessengerAuthorityError)
      ) setError(error?.message || 'Could not disconnect.');
    }
  }, [authorityIsCurrent, beginRequest, exactAuthority]);

  const loadChatList = useCallback(async (cfg: PlatformConfig) => {
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('chats');
    if (!authorityIsCurrent(capturedAuthority)) return;
    setLoading(true);
    try {
      const data = await getChats(
        cfg,
        capturedAuthority,
        authorityIsCurrent,
        controller.signal,
      );
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
      setChats(data);
      const unreadCount = data.reduce((count, chat) => count + (chat.unread ?? 0), 0);
      onUnreadCount?.({
        unreadCount,
        platform: cfg.platform,
        providerLabel: PLATFORM_INFO[cfg.platform].name,
        userId: capturedAuthority.userId,
        circleId: capturedAuthority.circleId,
        generation: capturedAuthority.generation,
      });
    } catch (e: any) {
      if (
        authorityIsCurrent(capturedAuthority)
        && !controller.signal.aborted
        && !(e instanceof PhoneMessengerAuthorityError)
      ) setError(e.message || 'Failed to load chats');
    } finally {
      if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) setLoading(false);
    }
  }, [authorityIsCurrent, beginRequest, exactAuthority, onUnreadCount]);

  const openChat = useCallback(async (chat: UnifiedChat) => {
    if (!config) return;
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('thread');
    if (!authorityIsCurrent(capturedAuthority)) return;
    setActiveChat(chat);
    setScreen('thread');
    setLoading(true);
    setMessages([]);
    try {
      const msgs = await getMessages(
        config,
        chat.id,
        capturedAuthority,
        authorityIsCurrent,
        controller.signal,
      );
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
      setMessages(msgs);
      setTimeout(() => {
        if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) {
          scrollRef.current?.scrollToEnd({ animated: false });
        }
      }, 100);
    } catch (e: any) {
      if (
        authorityIsCurrent(capturedAuthority)
        && !controller.signal.aborted
        && !(e instanceof PhoneMessengerAuthorityError)
      ) setError(e.message || 'Failed to load messages');
    } finally {
      if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) setLoading(false);
    }
  }, [authorityIsCurrent, beginRequest, config, exactAuthority]);

  const handleSend = useCallback(async () => {
    if (!config || !activeChat || !compose.trim()) return;
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('send');
    if (!authorityIsCurrent(capturedAuthority)) return;
    const text = compose.trim();
    setCompose('');
    setSending(true);

    // Optimistic update
    const optimistic: UnifiedMessage = {
      id: `temp-${Date.now()}`,
      text,
      isFromMe: true,
      timestamp: Date.now(),
      platform: config.platform,
    };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => {
      if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) {
        scrollRef.current?.scrollToEnd({ animated: true });
      }
    }, 50);

    try {
      await sendMsg(
        config,
        activeChat.id,
        text,
        capturedAuthority,
        authorityIsCurrent,
        controller.signal,
      );
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
    } catch (e: any) {
      if (
        authorityIsCurrent(capturedAuthority)
        && !controller.signal.aborted
        && !(e instanceof PhoneMessengerAuthorityError)
      ) setError('Failed to send: ' + (e.message || 'Unknown error'));
    } finally {
      if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) setSending(false);
    }
  }, [activeChat, authorityIsCurrent, beginRequest, compose, config, exactAuthority]);

  const refreshMessages = useCallback(async () => {
    if (!config || !activeChat) return;
    const capturedAuthority = exactAuthority;
    const controller = beginRequest('thread');
    if (!authorityIsCurrent(capturedAuthority)) return;
    setLoading(true);
    try {
      const msgs = await getMessages(
        config,
        activeChat.id,
        capturedAuthority,
        authorityIsCurrent,
        controller.signal,
      );
      if (!authorityIsCurrent(capturedAuthority) || controller.signal.aborted) return;
      setMessages(msgs);
      setTimeout(() => {
        if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) {
          scrollRef.current?.scrollToEnd({ animated: true });
        }
      }, 100);
    } catch { /* silent */ }
    finally {
      if (authorityIsCurrent(capturedAuthority) && !controller.signal.aborted) setLoading(false);
    }
  }, [activeChat, authorityIsCurrent, beginRequest, config, exactAuthority]);

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!visible) return null;

  const activePlatform = config?.platform || selectedPlatform;
  const platformColor = PLATFORM_INFO[activePlatform].color;

  const borderGlow = phonePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [platformColor + '40', platformColor + 'a0'],
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Animated.View style={[s.phone, { borderColor: borderGlow }]} onStartShouldSetResponder={() => true}>
          {/* Notch */}
          <View style={s.notch}>
            <View style={s.notchCamera} />
          </View>

          {/* Status bar */}
          <View style={s.statusBar}>
            <Text style={s.statusTime}>
              {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
            <View style={s.statusIcons}>
              <Text style={s.statusIcon}>📶</Text>
              <Text style={s.statusIcon}>🔋</Text>
            </View>
          </View>

          {/* ─── Header ──────────────────────────────────────────── */}
          <View style={[s.header, { borderBottomColor: platformColor + '30' }]}>
            {screen === 'thread' ? (
              <>
                <Pressable onPress={() => { setScreen('chats'); setActiveChat(null); }} style={s.backBtn}>
                  <Text style={[s.backText, { color: platformColor }]}>‹ Back</Text>
                </Pressable>
                <View style={s.headerCenter}>
                  <Text style={s.headerTitle} numberOfLines={1}>
                    {activeChat?.name || 'Messages'}
                  </Text>
                  <Text style={[s.headerSubtitle, { color: platformColor }]}>
                    {activeChat?.service || PLATFORM_INFO[activePlatform].name}
                  </Text>
                </View>
                <Pressable onPress={refreshMessages} style={s.refreshBtn}>
                  <Text style={[s.refreshText, { color: platformColor }]}>↻</Text>
                </Pressable>
              </>
            ) : screen === 'picker' ? (
              <>
                <Text style={s.headerTitle}>📱 Connect</Text>
                <Pressable onPress={onClose} style={s.closeBtn}>
                  <Text style={s.closeText}>✕</Text>
                </Pressable>
              </>
            ) : (
              <>
                {screen === 'setup' && (
                  <Pressable onPress={() => { setScreen('picker'); setError(''); }} style={s.backBtn}>
                    <Text style={[s.backText, { color: platformColor }]}>‹</Text>
                  </Pressable>
                )}
                <Text style={s.headerTitle}>
                  {screen === 'setup'
                    ? `${PLATFORM_INFO[selectedPlatform].icon} ${PLATFORM_INFO[selectedPlatform].name}`
                    : `${PLATFORM_INFO[activePlatform].icon} Messages`}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {screen === 'chats' && config && (
                    <>
                      <Pressable onPress={() => loadChatList(config)} style={s.refreshBtn}>
                        <Text style={[s.refreshText, { color: platformColor }]}>↻</Text>
                      </Pressable>
                      <Pressable onPress={handleDisconnect} style={s.disconnectBtn}>
                        <Text style={s.disconnectText}>⏏</Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable onPress={onClose} style={s.closeBtn}>
                    <Text style={s.closeText}>✕</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>

          {/* Error banner */}
          {error ? (
            <Pressable onPress={() => setError('')} style={s.errorBanner}>
              <Text style={s.errorText}>{error}</Text>
            </Pressable>
          ) : null}

          {/* Loading */}
          {loading && (
            <View style={s.loadingBar}>
              <ActivityIndicator size="small" color={platformColor} />
            </View>
          )}

          {/* ─── Platform Picker ─────────────────────────────────── */}
          {screen === 'picker' && (
            <ScrollView style={s.body} contentContainerStyle={s.pickerContent}>
              <Text style={s.pickerTitle}>Connect Your Messages</Text>
              <Text style={s.pickerDesc}>Choose a messaging platform to link</Text>

              {PLATFORMS.map(p => {
                const info = PLATFORM_INFO[p];
                return (
                  <Pressable
                    key={p}
                    onPress={() => selectPlatform(p)}
                    style={({ pressed }) => [s.platformCard, pressed && { opacity: 0.7 }]}
                  >
                    <View style={[s.platformIcon, { backgroundColor: info.color + '20' }]}>
                      <Text style={s.platformEmoji}>{info.icon}</Text>
                    </View>
                    <View style={s.platformInfo}>
                      <Text style={s.platformName}>{info.name}</Text>
                      <Text style={s.platformDesc}>{info.description}</Text>
                    </View>
                    <Text style={[s.platformArrow, { color: info.color }]}>›</Text>
                  </Pressable>
                );
              })}

              <View style={s.pickerNote}>
                <Text style={s.noteText}>
                  All connections stay on your device.{'\n'}
                  No data is sent to our servers.
                </Text>
              </View>
            </ScrollView>
          )}

          {/* ─── Setup Screen ────────────────────────────────────── */}
          {screen === 'setup' && (
            <ScrollView style={s.body} contentContainerStyle={s.setupContent}>
              <View style={[s.setupIconWrap, { backgroundColor: PLATFORM_INFO[selectedPlatform].color + '20' }]}>
                <Text style={s.setupEmoji}>{PLATFORM_INFO[selectedPlatform].icon}</Text>
              </View>
              <Text style={s.setupTitle}>{PLATFORM_INFO[selectedPlatform].name}</Text>
              <Text style={s.setupDesc}>{PLATFORM_INFO[selectedPlatform].description}</Text>

              {PLATFORM_INFO[selectedPlatform].requiresMac && (
                <View style={s.macWarning}>
                  <Text style={s.macWarningText}>⚠️ Requires a Mac running BlueBubbles Server</Text>
                </View>
              )}

              {PLATFORM_INFO[selectedPlatform].setupFields.map(field => (
                <View key={field.key} style={s.inputGroup}>
                  <Text style={s.inputLabel}>{field.label}</Text>
                  <TextInput
                    style={[s.input, { borderColor: PLATFORM_INFO[selectedPlatform].color + '40' }]}
                    value={formValues[field.key] || ''}
                    onChangeText={(v) => setFormValues(prev => ({ ...prev, [field.key]: v }))}
                    placeholder={field.placeholder}
                    placeholderTextColor="#555"
                    secureTextEntry={field.secure}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              ))}

              <Pressable
                onPress={handleConnect}
                style={[s.connectBtn, { backgroundColor: PLATFORM_INFO[selectedPlatform].color }, loading && { opacity: 0.5 }]}
                disabled={loading}
              >
                <Text style={s.connectBtnText}>{loading ? 'Connecting...' : 'Connect'}</Text>
              </Pressable>

              {/* Platform-specific help */}
              <View style={s.setupHelp}>
                <Text style={s.helpTitle}>Setup Guide</Text>
                {selectedPlatform === 'imessage' && (
                  <>
                    <Text style={s.helpStep}>1. Install BlueBubbles Server on your Mac</Text>
                    <Text style={s.helpStep}>2. Set up a tunnel (ngrok / Cloudflare / zrok)</Text>
                    <Text style={s.helpStep}>3. Copy the server URL and password above</Text>
                    <Text style={[s.helpLink, { color: PLATFORM_INFO[selectedPlatform].color }]}>
                      github.com/BlueBubblesApp/bluebubbles-server
                    </Text>
                  </>
                )}
                {selectedPlatform === 'android' && (
                  <>
                    <Text style={s.helpStep}>1. Install android-sms-gateway on your Android phone</Text>
                    <Text style={s.helpStep}>2. Start the gateway service</Text>
                    <Text style={s.helpStep}>3. Enter your phone's gateway URL above</Text>
                    <Text style={[s.helpLink, { color: PLATFORM_INFO[selectedPlatform].color }]}>
                      github.com/capcom6/android-sms-gateway
                    </Text>
                  </>
                )}
                {selectedPlatform === 'telegram' && (
                  <>
                    <Text style={s.helpStep}>1. Message @BotFather on Telegram</Text>
                    <Text style={s.helpStep}>2. Create a new bot with /newbot</Text>
                    <Text style={s.helpStep}>3. Copy the bot token above</Text>
                    <Text style={s.helpStep}>4. Send a message to your bot to initialize</Text>
                  </>
                )}
                {selectedPlatform === 'discord' && (
                  <>
                    <Text style={s.helpStep}>1. Go to discord.com/developers/applications</Text>
                    <Text style={s.helpStep}>2. Create a new application → Bot → copy token</Text>
                    <Text style={s.helpStep}>3. Enable Message Content Intent</Text>
                    <Text style={s.helpStep}>4. Invite the bot to your server</Text>
                  </>
                )}
              </View>
            </ScrollView>
          )}

          {/* ─── Chats Screen ────────────────────────────────────── */}
          {screen === 'chats' && (
            <ScrollView style={s.body}>
              {chats.length === 0 && !loading && (
                <View style={s.empty}>
                  <Text style={s.emptyIcon}>💬</Text>
                  <Text style={s.emptyText}>No conversations yet</Text>
                  <Text style={s.emptyHint}>
                    {activePlatform === 'telegram'
                      ? 'Send a message to your bot first'
                      : 'Messages will appear here'}
                  </Text>
                </View>
              )}
              {chats.map((chat) => (
                <Pressable
                  key={chat.id}
                  onPress={() => openChat(chat)}
                  style={({ pressed }) => [s.chatRow, pressed && s.chatRowPressed]}
                >
                  <View style={[s.chatAvatar, { backgroundColor: platformColor + '20' }]}>
                    <Text style={s.chatAvatarText}>{chat.avatar || '👤'}</Text>
                  </View>
                  <View style={s.chatInfo}>
                    <View style={s.chatTop}>
                      <Text style={s.chatName} numberOfLines={1}>{chat.name}</Text>
                      {chat.lastMessageTime && (
                        <Text style={s.chatTime}>{formatMessageTime(chat.lastMessageTime)}</Text>
                      )}
                    </View>
                    <View style={s.chatBottom}>
                      <Text style={s.chatPreview} numberOfLines={1}>
                        {chat.lastMessage || 'No messages'}
                      </Text>
                      {chat.service && (
                        <View style={[s.chatServiceBadge, { backgroundColor: platformColor + '20' }]}>
                          <Text style={[s.chatServiceText, { color: platformColor }]}>
                            {chat.service.length > 8 ? chat.service.slice(0, 8) : chat.service}
                          </Text>
                        </View>
                      )}
                      {(chat.unread || 0) > 0 && (
                        <View style={[s.unreadBadge, { backgroundColor: platformColor }]}>
                          <Text style={s.unreadText}>{chat.unread}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {/* ─── Thread Screen ───────────────────────────────────── */}
          {screen === 'thread' && (
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <ScrollView
                ref={scrollRef}
                style={s.body}
                contentContainerStyle={s.threadContent}
                onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
              >
                {messages.length === 0 && !loading && (
                  <View style={s.empty}>
                    <Text style={s.emptyText}>No messages</Text>
                  </View>
                )}
                {messages.map((msg, i) => {
                  const showTime = i === 0 ||
                    (msg.timestamp - messages[i - 1].timestamp > 3600000);
                  return (
                    <View key={msg.id}>
                      {showTime && (
                        <Text style={s.timeStamp}>
                          {new Date(msg.timestamp).toLocaleString([], {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </Text>
                      )}
                      <View style={[
                        s.bubble,
                        msg.isFromMe
                          ? [s.bubbleSent, { backgroundColor: platformColor }]
                          : s.bubbleReceived,
                      ]}>
                        {!msg.isFromMe && activeChat?.isGroup && msg.sender && (
                          <Text style={[s.bubbleSender, { color: platformColor }]}>{msg.sender}</Text>
                        )}
                        <Text style={[
                          s.bubbleText,
                          msg.isFromMe ? s.bubbleTextSent : s.bubbleTextReceived,
                        ]}>
                          {msg.text || ''}
                        </Text>
                        <Text style={[s.bubbleTime, msg.isFromMe ? { color: '#00000050' } : { color: '#ffffff40' }]}>
                          {new Date(msg.timestamp).toLocaleTimeString([], {
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Compose bar */}
              <View style={s.composeBar}>
                <TextInput
                  style={[s.composeInput, { borderColor: platformColor + '40' }]}
                  value={compose}
                  onChangeText={setCompose}
                  placeholder={PLATFORM_INFO[activePlatform].name}
                  placeholderTextColor="#555"
                  multiline
                  maxLength={2000}
                />
                <Pressable
                  onPress={handleSend}
                  style={[s.sendBtn, { backgroundColor: platformColor }, (!compose.trim() || sending) && { opacity: 0.3 }]}
                  disabled={!compose.trim() || sending}
                >
                  <Text style={s.sendIcon}>↑</Text>
                </Pressable>
              </View>
            </KeyboardAvoidingView>
          )}

          {/* Home indicator */}
          <View style={s.homeIndicator}>
            <View style={s.homeBar} />
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000000cc',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  phone: {
    width: 380,
    maxWidth: '100%' as any,
    height: '90%' as any,
    maxHeight: 750,
    backgroundColor: '#000',
    borderRadius: 40,
    borderWidth: 3,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 40px rgba(52, 199, 89, 0.15), 0 20px 60px rgba(0,0,0,0.8)' } as any : { elevation: 20 }),
  },

  // Notch
  notch: {
    alignSelf: 'center',
    width: 120,
    height: 28,
    backgroundColor: '#000',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 4,
  },
  notchCamera: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#1a1a2e', borderWidth: 1, borderColor: '#333' },

  // Status bar
  statusBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, height: 18, marginTop: -4,
  },
  statusTime: { color: '#fff', fontSize: 12, fontWeight: '600', fontFamily: 'monospace' },
  statusIcons: { flexDirection: 'row', gap: 4 },
  statusIcon: { fontSize: 10 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', fontFamily: 'monospace' },
  headerSubtitle: { fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  backBtn: { paddingRight: 8 },
  backText: { fontSize: 20, fontWeight: '600' },
  refreshBtn: { padding: 4 },
  refreshText: { fontSize: 18, fontWeight: '700' },
  disconnectBtn: { padding: 4 },
  disconnectText: { color: '#ef4444', fontSize: 16 },
  closeBtn: { padding: 4 },
  closeText: { color: '#666', fontSize: 16, fontWeight: '700' },

  // Error
  errorBanner: { backgroundColor: '#ef444420', borderBottomWidth: 1, borderBottomColor: '#ef444440', paddingHorizontal: 12, paddingVertical: 6 },
  errorText: { color: '#ef4444', fontSize: 11, fontFamily: 'monospace', textAlign: 'center' },

  // Loading
  loadingBar: { paddingVertical: 4, alignItems: 'center' },

  // Body
  body: { flex: 1 },

  // ─── Platform Picker ───────────────────────────────────
  pickerContent: { padding: 20 },
  pickerTitle: { color: '#fff', fontSize: 20, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center', marginTop: 8 },
  pickerDesc: { color: '#888', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', marginBottom: 24 },

  platformCard: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    backgroundColor: '#0d0d14', borderRadius: 16, marginBottom: 12,
    borderWidth: 1, borderColor: '#1a1a2e',
  },
  platformIcon: {
    width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  platformEmoji: { fontSize: 24 },
  platformInfo: { flex: 1 },
  platformName: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  platformDesc: { color: '#888', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  platformArrow: { fontSize: 24, fontWeight: '300' },

  pickerNote: {
    marginTop: 16, padding: 12, backgroundColor: '#0d0d14', borderRadius: 12,
    borderWidth: 1, borderColor: '#1a1a2e',
  },
  noteText: { color: '#555', fontSize: 10, fontFamily: 'monospace', textAlign: 'center', lineHeight: 16 },

  // ─── Setup ─────────────────────────────────────────────
  setupContent: { padding: 24, alignItems: 'center' },
  setupIconWrap: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  setupEmoji: { fontSize: 36 },
  setupTitle: { color: '#fff', fontSize: 20, fontWeight: '800', fontFamily: 'monospace', marginBottom: 4 },
  setupDesc: { color: '#888', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', lineHeight: 17, marginBottom: 20 },
  macWarning: { backgroundColor: '#f59e0b20', borderWidth: 1, borderColor: '#f59e0b40', borderRadius: 8, padding: 8, marginBottom: 16, width: '100%' as any },
  macWarningText: { color: '#f59e0b', fontSize: 10, fontFamily: 'monospace', textAlign: 'center' },

  inputGroup: { width: '100%' as any, marginBottom: 14 },
  inputLabel: { color: '#888', fontSize: 11, fontWeight: '600', fontFamily: 'monospace', marginBottom: 4, marginLeft: 4 },
  input: {
    backgroundColor: '#0d0d14', borderWidth: 1, borderRadius: 12,
    color: '#fff', fontSize: 14, fontFamily: 'monospace', paddingHorizontal: 14, paddingVertical: 12,
  },
  connectBtn: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 32, width: '100%' as any, alignItems: 'center', marginTop: 4 },
  connectBtnText: { color: '#000', fontSize: 15, fontWeight: '800', fontFamily: 'monospace' },
  setupHelp: { marginTop: 28, padding: 16, backgroundColor: '#0d0d14', borderRadius: 12, width: '100%' as any, borderWidth: 1, borderColor: '#1a1a2e' },
  helpTitle: { color: '#fff', fontSize: 12, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  helpStep: { color: '#888', fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
  helpLink: { fontSize: 10, fontFamily: 'monospace', marginTop: 8 },

  // ─── Chats ─────────────────────────────────────────────
  chatRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#0d0d14',
  },
  chatRowPressed: { backgroundColor: '#0d0d14' },
  chatAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  chatAvatarText: { fontSize: 20 },
  chatInfo: { flex: 1 },
  chatTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  chatName: { color: '#fff', fontSize: 14, fontWeight: '600', fontFamily: 'monospace', flex: 1, marginRight: 8 },
  chatTime: { color: '#666', fontSize: 10, fontFamily: 'monospace' },
  chatBottom: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chatPreview: { color: '#888', fontSize: 12, fontFamily: 'monospace', flex: 1 },
  chatServiceBadge: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  chatServiceText: { fontSize: 8, fontWeight: '700', fontFamily: 'monospace' },
  unreadBadge: { minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  unreadText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  // ─── Thread ────────────────────────────────────────────
  threadContent: { padding: 12, paddingBottom: 4 },
  timeStamp: { color: '#666', fontSize: 10, fontFamily: 'monospace', textAlign: 'center', marginVertical: 12 },
  bubble: { maxWidth: '78%' as any, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 3 },
  bubbleSent: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bubbleReceived: { backgroundColor: '#1a1a2e', alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
  bubbleSender: { fontSize: 9, fontWeight: '700', fontFamily: 'monospace', marginBottom: 2 },
  bubbleText: { fontSize: 14, fontFamily: 'monospace', lineHeight: 20 },
  bubbleTextSent: { color: '#000' },
  bubbleTextReceived: { color: '#fff' },
  bubbleTime: { fontSize: 8, fontFamily: 'monospace', textAlign: 'right', marginTop: 2 },

  // ─── Compose ───────────────────────────────────────────
  composeBar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#0d0d14', gap: 8 },
  composeInput: { flex: 1, backgroundColor: '#0d0d14', borderRadius: 20, borderWidth: 1, color: '#fff', fontSize: 14, fontFamily: 'monospace', paddingHorizontal: 16, paddingVertical: 8, maxHeight: 100 },
  sendBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '800' },

  // ─── Empty ─────────────────────────────────────────────
  empty: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyText: { color: '#666', fontSize: 13, fontFamily: 'monospace' },
  emptyHint: { color: '#444', fontSize: 11, fontFamily: 'monospace', marginTop: 4 },

  // ─── Home indicator ────────────────────────────────────
  homeIndicator: { alignItems: 'center', paddingVertical: 6 },
  homeBar: { width: 100, height: 4, borderRadius: 2, backgroundColor: '#444' },
});
