import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { getSwanBotResponse, SwanBotContext } from '../../lib/swanbot';

type BotMessage = {
  id: string;
  content: string;
  isBot: boolean;
  timestamp: Date;
};

const SUGGESTED_PROMPTS = [
  { label: '📅 Daily Plan', text: 'daily plan' },
  { label: '📋 My Tasks', text: 'my tasks' },
  { label: '📊 Status', text: 'status' },
  { label: '🔥 Streak', text: 'my streak' },
  { label: '⏱️ Focus', text: 'focus' },
  { label: '📈 Weekly Review', text: 'weekly review' },
  { label: '🎯 Challenge', text: 'challenge' },
  { label: '❓ Help', text: 'help' },
];

export default function SwanBotScreen({ navigation }: any) {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [activeCircle, setActiveCircle] = useState<{ id: string; name: string } | null>(null);
  const [circles, setCircles] = useState<any[]>([]);
  const [showCirclePicker, setShowCirclePicker] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .single();
    if (profile) setUserName(profile.display_name || profile.username);

    // Fetch user's circles
    const { data: memberData } = await supabase
      .from('circle_members')
      .select('circle:circles(id, name)')
      .eq('user_id', user.id);

    const userCircles = (memberData || []).map((m: any) => m.circle).filter(Boolean);
    setCircles(userCircles);
    if (userCircles.length > 0) {
      setActiveCircle(userCircles[0]);
    }

    // Welcome message
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    addBotMessage(`${greeting}, ${profile?.display_name || 'fam'}. 🦢\n\nI'm **BlackSwan** — your AI accountability partner. I can help with tasks, check your streak, manage your circle, or just give you a push.\n\n${userCircles.length > 0 ? `Active circle: **${userCircles[0].name}**` : 'Join a circle to unlock full features.'}\n\nType **help** to see all commands.`);
  };

  const addBotMessage = (content: string) => {
    setMessages(prev => [...prev, {
      id: `bot-${Date.now()}-${Math.random()}`,
      content,
      isBot: true,
      timestamp: new Date(),
    }]);
  };

  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || !userId) return;

    // Add user message
    const userMsg: BotMessage = {
      id: `user-${Date.now()}`,
      content: msg,
      isBot: false,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    // Get SwanBot response
    const context: SwanBotContext = {
      userId,
      circleId: activeCircle?.id,
      circleName: activeCircle?.name,
      userName,
    };

    try {
      const response = await getSwanBotResponse(msg, context);
      addBotMessage(response);
    } catch (err: any) {
      addBotMessage(`Something broke. ${err.message || 'Try again.'}`);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const renderContent = (content: string) => {
    const parts = content.split(/(\*\*[^*]+\*\*)/g);
    return (
      <Text style={styles.msgText}>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <Text key={i} style={styles.bold}>{part.slice(2, -2)}</Text>;
          }
          return <Text key={i}>{part}</Text>;
        })}
      </Text>
    );
  };

  const renderMessage = ({ item }: { item: BotMessage }) => {
    return (
      <View style={[styles.msgRow, item.isBot ? styles.msgRowBot : styles.msgRowUser]}>
        {item.isBot && (
          <View style={styles.botAvatar}>
            <Text style={styles.botAvatarText}>🦢</Text>
          </View>
        )}
        <View style={[styles.msgBubble, item.isBot ? styles.msgBubbleBot : styles.msgBubbleUser]}>
          {renderContent(item.content)}
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <View style={styles.headerInfo}>
          <View style={styles.headerTitleRow}>
            <Text style={styles.headerTitle}>SWANBOT</Text>
            <View style={styles.onlineDot} />
          </View>
          <Pressable onPress={() => setShowCirclePicker(!showCirclePicker)}>
            <Text style={styles.headerSubtitle}>
              {activeCircle ? `📍 ${activeCircle.name}` : 'No circle selected'} ▾
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Circle picker */}
      {showCirclePicker && (
        <View style={styles.circlePicker}>
          {circles.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                setActiveCircle(c);
                setShowCirclePicker(false);
                addBotMessage(`Switched to **${c.name}**. What do you need? 🦢`);
              }}
              style={[styles.circleOption, activeCircle?.id === c.id && styles.circleOptionActive]}
            >
              <Text style={[styles.circleOptionText, activeCircle?.id === c.id && styles.circleOptionTextActive]}>
                {c.name}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
      />

      {/* Loading indicator */}
      {loading && (
        <View style={styles.typingIndicator}>
          <View style={styles.botAvatarSmall}>
            <Text style={{ fontSize: 10 }}>🦢</Text>
          </View>
          <Text style={styles.typingText}>BlackSwan is thinking...</Text>
        </View>
      )}

      {/* Suggested prompts (show when no messages or few messages) */}
      {messages.length <= 1 && (
        <View style={styles.suggestedRow}>
          {SUGGESTED_PROMPTS.map((p) => (
            <Pressable
              key={p.text}
              onPress={() => sendMessage(p.text)}
              style={styles.suggestedChip}
            >
              <Text style={styles.suggestedText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            placeholder="Ask BlackSwan anything..."
            placeholderTextColor="#444"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            multiline
            maxLength={500}
          />
          <Pressable
            onPress={() => sendMessage()}
            disabled={!input.trim() || loading}
            style={[styles.sendButton, (!input.trim() || loading) && styles.sendButtonDisabled]}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  backText: { color: '#888', fontSize: 18 },
  headerInfo: { flex: 1 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 3,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ade80',
  },
  headerSubtitle: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  // Circle picker
  circlePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  circleOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  circleOptionActive: { borderColor: '#c084fc', backgroundColor: '#1a102e' },
  circleOptionText: { color: '#555', fontSize: 12, fontWeight: '700' },
  circleOptionTextActive: { color: '#c084fc' },
  // Messages
  messageList: {
    padding: 16,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
    flexGrow: 1,
  },
  msgRow: {
    flexDirection: 'row',
    marginBottom: 12,
    gap: 8,
  },
  msgRowBot: { justifyContent: 'flex-start' },
  msgRowUser: { justifyContent: 'flex-end' },
  botAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2e1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  botAvatarText: { fontSize: 16 },
  msgBubble: {
    maxWidth: '80%',
    borderRadius: 16,
    padding: 12,
    paddingHorizontal: 16,
  },
  msgBubbleBot: {
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#000000',
    borderTopLeftRadius: 4,
  },
  msgBubbleUser: {
    backgroundColor: '#1a1a3e',
    borderTopRightRadius: 4,
  },
  msgText: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
  },
  bold: {
    fontWeight: '800',
    color: '#fff',
  },
  // Typing
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  botAvatarSmall: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2e1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  typingText: { color: '#555', fontSize: 12, fontStyle: 'italic' },
  // Suggested
  suggestedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  suggestedChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  suggestedText: { color: '#888', fontSize: 13, fontWeight: '600' },
  // Input
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: '#000000',
    padding: 12,
    backgroundColor: '#000000',
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#111',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#222',
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    maxHeight: 100,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#c084fc',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
    opacity: 0.5,
  },
  sendText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});
