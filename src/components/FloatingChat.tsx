import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  Animated,
  Image,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { getSwanBotResponse, SwanBotContext } from '../lib/swanbot';
import {
  getMatchingChatSlashCommands,
  type ChatSlashCommand,
} from '../lib/chatSlashCommands';
import {
  getSelectedChatSlashCommand,
} from '../lib/chatComposerController';
import { useChatComposerController } from '../lib/useChatComposerController';
import ChatBotIdentityRow from './chat/ChatBotIdentityRow';
import ChatInlineRichText from './chat/ChatInlineRichText';
import ChatSlashCommandPalette from './chat/ChatSlashCommandPalette';
import {
  formatPersistedChatBotMessage,
  getChatAgentAvatarSource,
  isPersistedChatBotMessage,
  loadChatAgentAvatar,
  loadChatAgentName,
  MAIN_CHAT_AGENT_NAME,
} from '../lib/chatAgentIdentity';
import { shapePersistedChatMessage } from '../lib/chatMessageShape';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FloatingChatProps {
  circleId: string;
  circleName: string;
  accentColor: string;
  onClose: () => void;
}

type FloatingMessage = {
  id: string;
  content: string;
  isBot: boolean;
  isUser: boolean;
  userName: string;
  timestamp: Date;
  dbId?: string;
};

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_WIDTH = 380;
const DEFAULT_HEIGHT = 500;
const MIN_WIDTH = 300;
const MIN_HEIGHT = 300;
const MAX_WIDTH = 600;
const MAX_HEIGHT = 700;
const DEFAULT_BOTTOM = 20;
const DEFAULT_RIGHT = 20;
const HEADER_HEIGHT = 40;

// ─── Component ──────────────────────────────────────────────────────────────

export default function FloatingChat({ circleId, circleName, accentColor, onClose }: FloatingChatProps) {
  // State
  const [messages, setMessages] = useState<FloatingMessage[]>([]);
  const [input, setInput] = useState('');
  const [botTyping, setBotTyping] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('You');
  const [agentName, setAgentName] = useState<string>(MAIN_CHAT_AGENT_NAME);
  const [agentAvatarUri, setAgentAvatarUri] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);

  // Position and size (web dragging/resizing)
  const [posX, setPosX] = useState(DEFAULT_RIGHT);
  const [posY, setPosY] = useState(DEFAULT_BOTTOM);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);

  // Refs
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const headerRef = useRef<View>(null);
  const resizeHandleRef = useRef<View>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentNameRef = useRef(agentName);
  const sendLockRef = useRef(false);

  // Animation
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // ─── Init ───────────────────────────────────────────────────────────────

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: 1,
        tension: 80,
        friction: 10,
        useNativeDriver: false,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();

    initUser();
    loadMessages();
  }, [circleId]);

  useEffect(() => {
    let cancelled = false;
    loadChatAgentName(circleId).then((savedName) => {
      if (!cancelled) setAgentName(savedName);
    }).catch(() => {});
    loadChatAgentAvatar(circleId).then((savedAvatar) => {
      if (!cancelled) setAgentAvatarUri(savedAvatar);
    }).catch(() => {
      if (!cancelled) setAgentAvatarUri(null);
    });
    return () => { cancelled = true; };
  }, [circleId]);

  useEffect(() => {
    agentNameRef.current = agentName;
    setMessages(prev => prev.map(message =>
      message.isBot && message.userName !== agentName
        ? { ...message, userName: agentName }
        : message
    ));
  }, [agentName]);

  const agentAvatarSource = getChatAgentAvatarSource(agentAvatarUri);

  const initUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (user) {
        setCurrentUserId(user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('display_name, username')
          .eq('id', user.id)
          .single();
        if (profile) setCurrentUserName(profile.display_name || profile.username || 'You');
      }
    } catch {}
  };

  const loadMessages = async () => {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('id, circle_id, user_id, content, created_at, is_bot, user:profiles(username, display_name)')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: true })
        .limit(50);

      if (!error && data && data.length > 0) {
        const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
        const loaded: FloatingMessage[] = data.map((m: any) =>
          shapePersistedChatMessage(m, {
            currentUserId: user?.id,
            botDisplayName: agentName,
          })
        );
        setMessages(loaded);
      }
    } catch (e) {
      console.error('[FloatingChat] Error loading messages:', e);
    }
  };

  // ─── Realtime Subscription ──────────────────────────────────────────────

  useEffect(() => {
    if (!circleId || !currentUserId) return;

    const channel = supabase
      .channel(`floating-chat-${circleId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `circle_id=eq.${circleId}`,
      }, (payload: any) => {
        const newMsg = payload.new;
        const isBotFromDb = isPersistedChatBotMessage(newMsg.content, newMsg.is_bot === true);
        if (newMsg.user_id === currentUserId && !isBotFromDb) return;

        const msg: FloatingMessage = shapePersistedChatMessage(newMsg, {
          currentUserId,
          botDisplayName: agentNameRef.current,
          fallbackUserName: 'Circle Member',
        });

        // Resolve sender name
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
            if ((m as any).dbId) return false;
            if (m.isBot !== msg.isBot || m.isUser !== msg.isUser) return false;
            if (m.content.trim() !== msg.content.trim()) return false;
            return Math.abs(m.timestamp.getTime() - incomingTs) < 15000;
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
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, currentUserId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Keep current values in refs so drag/resize handlers don't go stale
  const posXRef = useRef(posX);
  const posYRef = useRef(posY);
  const widthRef = useRef(width);
  const heightRef = useRef(height);
  useEffect(() => { posXRef.current = posX; }, [posX]);
  useEffect(() => { posYRef.current = posY; }, [posY]);
  useEffect(() => { widthRef.current = width; }, [width]);
  useEffect(() => { heightRef.current = height; }, [height]);

  // ─── Drag & Resize (web only) — attach once on mount ───────────────────

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let headerCleanup: (() => void) | null = null;
    let resizeCleanup: (() => void) | null = null;

    // Wait for DOM nodes to be available
    const timer = setTimeout(() => {
      // Header drag
      const headerNode = document.querySelector('[data-floating-chat-header]');
      if (headerNode) {
        const handleMouseDown = (e: Event) => {
          const me = e as MouseEvent;
          me.preventDefault();
          dragRef.current = {
            startX: me.clientX,
            startY: me.clientY,
            startPosX: posXRef.current,
            startPosY: posYRef.current,
          };

          const handleMouseMove = (ev: MouseEvent) => {
            if (!dragRef.current) return;
            const dx = ev.clientX - dragRef.current.startX;
            const dy = ev.clientY - dragRef.current.startY;
            // Position is right/bottom, so invert x
            setPosX(Math.max(0, dragRef.current.startPosX - dx));
            setPosY(Math.max(0, dragRef.current.startPosY + dy));
          };

          const handleMouseUp = () => {
            dragRef.current = null;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        };
        headerNode.addEventListener('mousedown', handleMouseDown);
        headerCleanup = () => headerNode.removeEventListener('mousedown', handleMouseDown);
      }

      // Resize handle
      const resizeNode = document.querySelector('[data-floating-chat-resize]');
      if (resizeNode) {
        const handleResizeDown = (e: Event) => {
          const me = e as MouseEvent;
          me.preventDefault();
          me.stopPropagation();
          resizeRef.current = {
            startX: me.clientX,
            startY: me.clientY,
            startW: widthRef.current,
            startH: heightRef.current,
          };

          const handleResizeMove = (ev: MouseEvent) => {
            if (!resizeRef.current) return;
            const dx = ev.clientX - resizeRef.current.startX;
            const dy = ev.clientY - resizeRef.current.startY;
            setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, resizeRef.current.startW - dx)));
            setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeRef.current.startH + dy)));
          };

          const handleResizeUp = () => {
            resizeRef.current = null;
            document.removeEventListener('mousemove', handleResizeMove);
            document.removeEventListener('mouseup', handleResizeUp);
          };

          document.addEventListener('mousemove', handleResizeMove);
          document.addEventListener('mouseup', handleResizeUp);
        };
        resizeNode.addEventListener('mousedown', handleResizeDown);
        resizeCleanup = () => resizeNode.removeEventListener('mousedown', handleResizeDown);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      headerCleanup?.();
      resizeCleanup?.();
    };
  }, []); // Run once on mount

  // ─── Send Message ───────────────────────────────────────────────────────

  const sendMessage = useCallback(async () => {
    if (sendLockRef.current) return;
    const content = input.trim();
    if (!content || !currentUserId) return;
    sendLockRef.current = true;
    setTimeout(() => { sendLockRef.current = false; }, 350);

    const lowerContent = content.toLowerCase().trim();
    if (lowerContent === '/help' || lowerContent === '/commands') {
      try {
        const { executeHelpCommand } = await import('../lib/missionChatCommands');
        const helpMessage = executeHelpCommand().message;
        const botMsg: FloatingMessage = {
          id: `bot-${Date.now()}`,
          content: helpMessage,
          isBot: true,
          isUser: false,
          userName: agentName,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, botMsg]);
        setInput('');
        return;
      } catch {}
    }

    // Optimistic local message
    const localId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userMsg: FloatingMessage = {
      id: localId,
      content,
      isBot: false,
      isUser: true,
      userName: currentUserName,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');

    // Persist to Supabase
    try {
      const { data, error } = await supabase.from('messages').insert({
        circle_id: circleId,
        user_id: currentUserId,
        content,
        reactions: {},
        is_bot: false,
      }).select('id').single();

      if (!error && data) {
        setMessages(prev => prev.map(m => m.id === localId ? { ...m, dbId: data.id } : m));
      } else if (error && (error.code === 'PGRST204' || error.code === '42703')) {
        // Fallback without new columns
        const { data: d2 } = await supabase.from('messages').insert({
          circle_id: circleId,
          user_id: currentUserId,
          content,
        }).select('id').single();
        if (d2) {
          setMessages(prev => prev.map(m => m.id === localId ? { ...m, dbId: d2.id } : m));
        }
      }
    } catch (e) {
      console.error('[FloatingChat] Error persisting message:', e);
    }

    // Always trigger AI in floating chat — it's a direct agent conversation
    {
      const cleanContent = content.replace(/@(agent|blackswan|swanbot|swan)\s*/gi, '').trim() || content;
      setBotTyping(true);
      try {
        // Build chat context from recent messages
        const recentMsgs = messages.slice(-10);
        const chatHistory = recentMsgs.map(m =>
          `${m.isBot ? agentName : (m.userName || 'User')}: ${m.content.slice(0, 300)}`
        ).join('\n');

        const context: SwanBotContext = {
          userId: currentUserId || 'anonymous',
          circleId,
          userName: currentUserName,
        };
        context.chatHistory = chatHistory;
        const botResponse = await getSwanBotResponse(cleanContent, context);

        // Add bot message locally
        const botId = `bot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const botMsg: FloatingMessage = {
          id: botId,
          content: botResponse,
          isBot: true,
          isUser: false,
          userName: agentName,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, botMsg]);

        // Persist bot message to DB so it survives pop-out close
        try {
          const { error: botInsertErr } = await supabase.from('messages').insert({
            circle_id: circleId,
            user_id: currentUserId,
            content: formatPersistedChatBotMessage(agentName, botResponse),
            reactions: {},
            is_bot: true,
          });
          if (botInsertErr) {
            console.warn('[FloatingChat] Bot message persist failed, retrying without is_bot:', botInsertErr.message);
            await supabase.from('messages').insert({
              circle_id: circleId,
              user_id: currentUserId,
              content: formatPersistedChatBotMessage(agentName, botResponse),
            });
          }
        } catch (e: any) {
          console.error('[FloatingChat] Bot message persist error:', e.message);
        }
      } catch {
        const errMsg: FloatingMessage = {
          id: `err-${Date.now()}`,
          content: 'Something went wrong. Try again.',
          isBot: true,
          isUser: false,
          userName: agentName,
          timestamp: new Date(),
        };
        setMessages(prev => [...prev, errMsg]);
      }
      setBotTyping(false);
    }
  }, [input, currentUserId, currentUserName, circleId, messages, agentName]);

  const applySlashCommand = useCallback((command: ChatSlashCommand) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    setInput(command.insertText);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);
  const {
    highlightedSlashIndex,
    setHighlightedSlashIndex,
    slashCommands,
    showSlashCommands,
    handleComposerInputChange,
    handleComposerKeyPress,
  } = useChatComposerController({
    input,
    focused,
    onInputChange: setInput,
    onSend: () => { void sendMessage(); },
    onApplySlashCommand: applySlashCommand,
  });

  // ─── Render ─────────────────────────────────────────────────────────────

  const renderMessage = useCallback(({ item }: { item: FloatingMessage }) => {
    const isUser = item.isUser;
    const isBot = item.isBot;

    return (
      <View
        nativeID={`section-floating-msg-${item.id}`}
        style={[
          styles.msgRow,
          isUser && styles.msgRowUser,
        ]}
      >
        {!isUser && (
          isBot ? (
            <ChatBotIdentityRow
              agentAvatarSource={agentAvatarSource}
              agentName={item.userName}
              accentColor={accentColor}
              compact
            />
          ) : (
            <Text style={styles.msgName}>
              {item.userName}
            </Text>
          )
        )}
        <View style={[
          styles.msgBubble,
          isUser && styles.msgBubbleUser,
          isBot && styles.msgBubbleBot,
          isUser && { backgroundColor: accentColor + '30', borderColor: accentColor + '50' },
        ]}>
          <ChatInlineRichText
            content={item.content}
            accentColor={accentColor}
            textColor={isUser ? '#f0f0f5' : '#d0d0dc'}
          />
        </View>
        <Text style={styles.msgTime}>
          {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    );
  }, [accentColor, agentAvatarSource]);

  const containerStyle: any = Platform.OS === 'web'
    ? {
        position: 'fixed' as any,
        bottom: posY,
        right: posX,
        width,
        height: minimized ? HEADER_HEIGHT + 4 : height,
        zIndex: 9000,
      }
    : {
        position: 'absolute' as any,
        bottom: DEFAULT_BOTTOM,
        right: DEFAULT_RIGHT,
        width: DEFAULT_WIDTH,
        height: minimized ? HEADER_HEIGHT + 4 : DEFAULT_HEIGHT,
        zIndex: 9000,
      };

  return (
    <Animated.View
      nativeID="section-floating-chat"
      style={[
        styles.container,
        containerStyle,
        {
          opacity: fadeAnim,
          transform: [{ scale: scaleAnim }],
          borderColor: accentColor + '30',
        },
        Platform.OS === 'web' ? {
          boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px ${accentColor}20`,
          transition: 'height 0.2s ease',
        } as any : {},
      ]}
    >
      {/* ── SECTION: Header — draggable, controls ── */}
      <View
        ref={headerRef}
        nativeID="section-floating-chat-header"
        // @ts-ignore — web data attribute for DOM query
        dataSet={{ floatingChatHeader: true }}
        style={[styles.header, { borderBottomColor: accentColor + '30' }]}
      >
        <View style={styles.headerLeft}>
          <Image source={agentAvatarSource} style={styles.headerAvatar} resizeMode="contain" />
          <Text style={styles.headerTitle} numberOfLines={1}>
            {agentName} · {circleName.toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          <Pressable
            onPress={() => setMinimized(!minimized)}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={minimized ? 'Maximize chat' : 'Minimize chat'}
          >
            <Text style={styles.headerBtnText}>{minimized ? '\u25A1' : '\u2500'}</Text>
          </Pressable>
          <Pressable
            onPress={() => setMinimized(!minimized)}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={minimized ? 'Minimize chat' : 'Maximize chat'}
          >
            <Text style={styles.headerBtnText}>{minimized ? '\u2500' : '\u25A1'}</Text>
          </Pressable>
          <Pressable
            onPress={onClose}
            style={[styles.headerBtn, styles.headerBtnClose]}
            accessibilityRole="button"
            accessibilityLabel="Close floating chat"
          >
            <Text style={[styles.headerBtnText, styles.headerBtnCloseText]}>{'\u2715'}</Text>
          </Pressable>
        </View>
      </View>

      {/* ── SECTION: Messages ── */}
      {!minimized && (
        <View nativeID="section-floating-chat-messages" style={styles.messagesContainer}>
          <FlatList
            ref={flatListRef}
            data={messages}
            renderItem={renderMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesList}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              flatListRef.current?.scrollToEnd({ animated: true });
            }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySubtext}>Type below or mention @agent</Text>
              </View>
            }
          />
          {botTyping && (
            <View style={styles.typingRow}>
              <Text style={[styles.typingText, { color: accentColor }]}>{agentName} is typing...</Text>
            </View>
          )}
        </View>
      )}

      {/* ── SECTION: Input ── */}
      {!minimized && (
        <View nativeID="section-floating-chat-input" style={[styles.inputContainer, { borderTopColor: accentColor + '30' }]}>
          {showSlashCommands && (
            <ChatSlashCommandPalette
              accentColor={accentColor}
              commands={slashCommands}
              highlightedIndex={highlightedSlashIndex}
              onHighlightIndexChange={setHighlightedSlashIndex}
              onSelect={applySlashCommand}
              variant="compact"
            />
          )}
          <TextInput
            ref={inputRef}
            style={[styles.input, Platform.OS === 'web' ? { outlineWidth: 0, outlineStyle: 'none' } as any : {}]}
            value={input}
            onChangeText={handleComposerInputChange}
            placeholder={`Ask ${agentName}...`}
            placeholderTextColor="#606075"
            onSubmitEditing={() => {
              if (Platform.OS === 'web') return;
              if (showSlashCommands) {
                const selected = getSelectedChatSlashCommand(slashCommands, highlightedSlashIndex);
                if (selected) {
                  applySlashCommand(selected);
                  return;
                }
              }
              void sendMessage();
            }}
            onKeyPress={Platform.OS === 'web' ? undefined : handleComposerKeyPress}
            {...(Platform.OS === 'web' ? { onKeyDown: handleComposerKeyPress as any } : {})}
            onFocus={() => {
              if (blurTimeoutRef.current) {
                clearTimeout(blurTimeoutRef.current);
                blurTimeoutRef.current = null;
              }
              setFocused(true);
            }}
            onBlur={() => {
              blurTimeoutRef.current = setTimeout(() => {
                setFocused(false);
                blurTimeoutRef.current = null;
              }, 120);
            }}
            returnKeyType="send"
            multiline={false}
          />
          <Pressable
            onPress={() => sendMessage()}
            style={[styles.sendBtn, { backgroundColor: input.trim() ? accentColor : '#1a1a28' }]}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Text style={[styles.sendBtnText, { color: input.trim() ? '#fff' : '#606075' }]}>{'\u2191'}</Text>
          </Pressable>
        </View>
      )}

      {/* ── SECTION: Resize handle (web only) ── */}
      {Platform.OS === 'web' && !minimized && (
        <View
          ref={resizeHandleRef}
          nativeID="section-floating-chat-resize"
          // @ts-ignore — web data attribute for DOM query
          dataSet={{ floatingChatResize: true }}
          style={styles.resizeHandle}
        >
          <Text style={styles.resizeHandleText}>{'\u25E2'}</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a10',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a28',
    overflow: 'hidden',
  },

  // Header
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    backgroundColor: '#0a0a10',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    ...(Platform.OS === 'web' ? { cursor: 'grab', userSelect: 'none' } as any : {}),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  headerAvatar: {
    width: 18,
    height: 18,
  },
  headerTitle: {
    color: '#a0a0b0',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
    flex: 1,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  headerBtn: {
    width: 28,
    height: 28,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.15s' } as any : {}),
  },
  headerBtnClose: {
    marginLeft: 2,
  },
  headerBtnText: {
    color: '#606075',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  headerBtnCloseText: {
    color: '#ef4444',
  },

  // Messages
  messagesContainer: {
    flex: 1,
    backgroundColor: '#050508',
  },
  messagesList: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  msgRow: {
    marginBottom: 8,
    maxWidth: '85%',
  },
  msgRowUser: {
    alignSelf: 'flex-end',
  },
  msgName: {
    color: '#a0a0b0',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
    fontFamily: 'monospace',
  },
  msgBubble: {
    backgroundColor: '#0f0f18',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#1a1a28',
  },
  msgBubbleUser: {
    borderRadius: 12,
  },
  msgBubbleBot: {
    backgroundColor: '#0f0f18',
    borderColor: '#1a1a28',
  },
  msgTime: {
    color: '#606075',
    fontSize: 9,
    marginTop: 2,
    fontFamily: 'monospace',
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    paddingVertical: 40,
  },
  emptyText: {
    color: '#606075',
    fontSize: 14,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#606075',
    fontSize: 11,
    marginTop: 4,
  },

  // Typing indicator
  typingRow: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  typingText: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Input
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0a0a10',
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    gap: 6,
    position: 'relative',
  },
  slashCommandPopup: {
    position: 'absolute' as any,
    left: 8,
    right: 8,
    bottom: 54,
    zIndex: 20,
  },
  input: {
    flex: 1,
    backgroundColor: '#0f0f18',
    color: '#f0f0f5',
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a1a28',
    fontFamily: 'monospace',
    maxHeight: 60,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background-color 0.15s' } as any : {}),
  },
  sendBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },

  // Resize handle
  resizeHandle: {
    position: 'absolute' as any,
    bottom: 0,
    left: 0,
    width: 20,
    height: 20,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    ...(Platform.OS === 'web' ? { cursor: 'nwse-resize' } as any : {}),
  },
  resizeHandleText: {
    color: '#606075',
    fontSize: 10,
    opacity: 0.5,
  },
});
