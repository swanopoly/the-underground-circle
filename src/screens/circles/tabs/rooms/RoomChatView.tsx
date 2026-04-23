/**
 * RoomChatView — Redesigned room chat with visible preset buttons.
 *
 * Replaces hidden regex-based intent inference with an explicit preset strip.
 * User messages always get a BlackSwan AI response (no @mention required).
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, StyleSheet, Platform,
  ActivityIndicator, Animated, FlatList,
} from 'react-native';
import { ROOM_CHAT_PRESETS, type ChatPreset, type RoomMessage } from './roomTypes';
import { useRoomMessages } from './roomHooks';
import { supabase } from '../../../../lib/supabase';
import ChatArtifacts from '../../../../components/chat/ChatArtifacts';
import { readMessageArtifacts, readMessageMemoriesUsed } from '../../../../lib/messageMetadataReaders';
import { sendRoomStructuredChatMessage } from '../../../../lib/roomChatService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Props {
  roomId: string;
  circleId: string;
  accentColor: string;
  activeFile?: { name: string; content: string; file_type: string } | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Component ──────────────────────────────────────────────────────────────

function RoomChatView({ roomId, circleId, accentColor, activeFile }: Props) {
  const { messages } = useRoomMessages(roomId);
  const [input, setInput] = useState('');
  const [botTyping, setBotTyping] = useState(false);
  const scrollRef = useRef<FlatList<RoomMessage>>(null);
  const typingAnim = useRef(new Animated.Value(0)).current;

  // ── Auto-scroll to bottom on new messages ──
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages.length]);

  // ── Typing indicator animation ──
  useEffect(() => {
    if (botTyping) {
      const anim = Animated.loop(
        Animated.sequence([
          Animated.timing(typingAnim, { toValue: 1, duration: 600, useNativeDriver: false }),
          Animated.timing(typingAnim, { toValue: 0, duration: 600, useNativeDriver: false }),
        ]),
      );
      anim.start();
      return () => anim.stop();
    } else {
      typingAnim.setValue(0);
    }
  }, [botTyping, typingAnim]);

  // ── Get current user ──
  const userIdRef = useRef<string>('anonymous');
  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => {
        if (data?.user?.id) userIdRef.current = data.user.id;
      })
      .catch(() => {});
  }, []);

  // ── Send message ──
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || botTyping) return;

    setInput('');

    // Build context for AI
    setBotTyping(true);
    try {
      await sendRoomStructuredChatMessage({
        roomId,
        circleId,
        userId: userIdRef.current,
        content: trimmed,
        activeFile,
        recentMessages: messages.map((message) => ({
          content: message.content,
          metadata: message.metadata,
          agent_name: message.agentName,
        })),
      });
    } catch (err: any) {
      // Post error as system message
      await supabase.from('room_messages').insert({
        room_id: roomId,
        content: `AI response failed: ${err?.message || 'Unknown error'}`,
        message_type: 'system',
        metadata: { error: true },
      });
    } finally {
      setBotTyping(false);
    }
  }, [roomId, circleId, activeFile, messages, botTyping]);

  // ── Handle preset tap ──
  const handlePreset = useCallback((preset: ChatPreset) => {
    sendMessage(preset.prompt);
  }, [sendMessage]);

  // ── Handle input submit ──
  const handleSend = useCallback(() => {
    sendMessage(input);
  }, [input, sendMessage]);

  // ── Typing indicator opacity ──
  const typingOpacity = typingAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1],
  });

  return (
    <View style={styles.container} nativeID="section-room-chat">

      {/* ── SECTION: Preset Strip ── */}
      <View style={styles.presetStrip} nativeID="section-room-chat-presets">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.presetScroll}
        >
          {ROOM_CHAT_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => handlePreset(preset)}
              accessibilityRole="button"
              accessibilityLabel={`Use preset: ${preset.label}`}
              disabled={botTyping}
              style={({ hovered }: any) => [
                styles.presetPill,
                {
                  borderColor: preset.color + '50',
                  backgroundColor: preset.color + '10',
                },
                hovered && Platform.OS === 'web' && {
                  backgroundColor: preset.color + '25',
                },
                botTyping && { opacity: 0.4 },
              ]}
            >
              <Text style={[styles.presetIcon, { color: preset.color }]}>
                {preset.icon}
              </Text>
              <Text style={[styles.presetLabel, { color: preset.color }]}>
                {preset.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── SECTION: Messages Area ── */}
      {/* Virtualized so chat history stays fast past a few hundred messages.
          Previously this was a ScrollView + `messages.map()` which kept every
          bubble mounted. */}
      <FlatList
        ref={scrollRef}
        style={styles.messagesArea}
        contentContainerStyle={styles.messagesContent}
        nativeID="section-room-chat-messages"
        data={messages}
        keyExtractor={(m) => m.id}
        initialNumToRender={40}
        windowSize={10}
        maxToRenderPerBatch={20}
        removeClippedSubviews
        renderItem={({ item: msg }) => (
          <RenderRoomChatMessage
            msg={msg}
            accentColor={accentColor}
            circleId={circleId}
            roomId={roomId}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>{'>_'}</Text>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySub}>
              Send a message or tap a preset to get started
            </Text>
          </View>
        }
        ListFooterComponent={
          botTyping ? (
            <View style={styles.agentMsg}>
              <View style={[styles.agentAccent, { backgroundColor: '#f59e0b' }]} />
              <Animated.View style={[styles.typingBubble, { opacity: typingOpacity }]}>
                <Text style={styles.typingText}>BlackSwan is thinking...</Text>
              </Animated.View>
            </View>
          ) : null
        }
      />

      {/* ── SECTION: Active File Chip ── */}
      {activeFile && (
        <View style={styles.fileChipBar} nativeID="section-room-chat-file-context">
          <View style={[styles.fileChip, { borderColor: accentColor + '40' }]}>
            <Text style={[styles.fileChipIcon, { color: accentColor }]}>{'[]'}</Text>
            <Text style={styles.fileChipName} numberOfLines={1}>
              Attached: {activeFile.name}
            </Text>
          </View>
        </View>
      )}

      {/* ── SECTION: Input Bar ── */}
      <View style={styles.inputBar} nativeID="section-room-chat-input">
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Message this room..."
          placeholderTextColor="#606075"
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!botTyping}
          multiline={false}
        />
        <Pressable
          onPress={handleSend}
          disabled={!input.trim() || botTyping}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          style={[
            styles.sendBtn,
            {
              backgroundColor: accentColor,
              opacity: input.trim() && !botTyping ? 1 : 0.35,
            },
          ]}
        >
          <Text style={styles.sendText}>{'>'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Message row renderer ───────────────────────────────────────────────────
// Split out of the main component so React can memoize it per-row.
// Virtualized via FlatList above; each row only re-renders when its
// specific `msg` prop changes.

const RenderRoomChatMessage = React.memo(function RenderRoomChatMessage({
  msg,
  accentColor,
  circleId,
  roomId,
}: {
  msg: RoomMessage;
  accentColor: string;
  circleId: string;
  roomId: string;
}) {
  const isAgent = msg.messageType === 'agent_output';
  const isSystem = msg.messageType === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemMsg}>
        <Text style={styles.systemText}>{msg.content}</Text>
      </View>
    );
  }

  if (isAgent) {
    const artifacts = readMessageArtifacts(msg.metadata);
    const memoriesUsed = readMessageMemoriesUsed(msg.metadata);
    return (
      <View style={styles.agentMsg}>
        <View style={[styles.agentAccent, { backgroundColor: '#22c55e' }]} />
        <View style={styles.agentBubble}>
          <View style={styles.msgMeta}>
            <Text style={styles.agentName}>{msg.agentName || 'Agent'}</Text>
            <Text style={styles.msgTime}>{timeAgo(msg.createdAt)}</Text>
          </View>
          <Text style={styles.agentText} selectable>{msg.content}</Text>
          {artifacts.length > 0 && (
            <ChatArtifacts
              artifacts={artifacts as any}
              accentColor={accentColor}
              circleId={circleId}
              roomContext={{ roomId }}
            />
          )}
          {memoriesUsed.length > 0 && (
            <View style={styles.memoryChipRow}>
              {memoriesUsed.slice(0, 5).map((memory, index) => (
                <View key={`${String(memory)}-${index}`} style={styles.memoryChip}>
                  <Text style={styles.memoryChipText}>{String(memory)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  // User message
  return (
    <View style={styles.userMsg}>
      <View style={styles.userBubble}>
        <View style={styles.msgMeta}>
          <Text style={styles.msgTime}>{timeAgo(msg.createdAt)}</Text>
        </View>
        <Text style={styles.userText} selectable>{msg.content}</Text>
        {msg.metadata?.attached_file ? (
          <View style={styles.attachedChip}>
            <Text style={styles.attachedText}>
              {'[]'} {String(msg.metadata.attached_file)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050508',
    flexDirection: 'column',
  },

  // Preset strip
  presetStrip: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
    backgroundColor: '#0a0a10',
  },
  presetScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  presetPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderRadius: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  presetIcon: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: MONO,
  },
  presetLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as any,
  },

  // Messages area
  messagesArea: {
    flex: 1,
  },
  messagesContent: {
    padding: 12,
    gap: 8,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 6,
  },
  emptyIcon: {
    color: '#606075',
    fontSize: 24,
    fontWeight: '900',
    fontFamily: MONO,
    marginBottom: 4,
  },
  emptyText: {
    color: '#a0a0b0',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: MONO,
  },
  emptySub: {
    color: '#606075',
    fontSize: 11,
    fontFamily: MONO,
    textAlign: 'center',
    maxWidth: 240,
  },

  // System messages
  systemMsg: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  systemText: {
    color: '#606075',
    fontSize: 10,
    fontFamily: MONO,
    fontStyle: 'italic',
    textAlign: 'center',
  },

  // Agent messages (left-aligned)
  agentMsg: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    maxWidth: '85%' as any,
  },
  agentAccent: {
    width: 3,
    borderRadius: 1,
    marginRight: 8,
  },
  agentBubble: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 10,
    flex: 1,
    gap: 4,
  },
  agentName: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: MONO,
    letterSpacing: 0.5,
  },
  agentText: {
    color: '#f0f0f5',
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 18,
  },
  memoryChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  memoryChip: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#224328',
    backgroundColor: '#08100a',
  },
  memoryChipText: {
    color: '#bfe0c4',
    fontSize: 9,
    fontFamily: MONO,
    fontWeight: '700',
  },

  // User messages (right-aligned)
  userMsg: {
    alignSelf: 'flex-end',
    maxWidth: '75%' as any,
  },
  userBubble: {
    backgroundColor: '#0f0f18',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    padding: 10,
    gap: 4,
  },
  userText: {
    color: '#f0f0f5',
    fontSize: 12,
    fontFamily: MONO,
    lineHeight: 18,
  },

  // Shared message meta
  msgMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  msgTime: {
    color: '#606075',
    fontSize: 9,
    fontFamily: MONO,
  },

  // Attached file chip
  attachedChip: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    backgroundColor: '#050508',
    alignSelf: 'flex-start',
  },
  attachedText: {
    color: '#606075',
    fontSize: 9,
    fontFamily: MONO,
    fontWeight: '700',
  },

  // Typing indicator
  typingBubble: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#f59e0b30',
    borderRadius: 2,
    padding: 10,
  },
  typingText: {
    color: '#f59e0b',
    fontSize: 11,
    fontFamily: MONO,
    fontWeight: '600',
  },

  // File chip bar (above input)
  fileChipBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    backgroundColor: '#0a0a10',
  },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: '#050508',
    alignSelf: 'flex-start',
  },
  fileChipIcon: {
    fontSize: 10,
    fontWeight: '900',
    fontFamily: MONO,
  },
  fileChipName: {
    color: '#a0a0b0',
    fontSize: 11,
    fontFamily: MONO,
    maxWidth: 200,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#1a1a28',
    backgroundColor: '#0a0a10',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a28',
    borderWidth: 1,
    borderColor: '#2a2a3e',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: '#f0f0f5',
    fontSize: 13,
    fontFamily: MONO,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 2,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  sendText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
    fontFamily: MONO,
  },
});

export default RoomChatView;
