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
} from 'react-native';
import { supabase } from '../../../lib/supabase';

export default function ChatTab({ circleId }: { circleId: string }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    const { data } = await supabase
      .from('messages')
      .select('*, user:profiles(username, display_name)')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: true })
      .limit(100);

    setMessages(data || []);
  }, [circleId]);

  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel(`chat:${circleId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `circle_id=eq.${circleId}` }, (payload) => {
        fetchMessages();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchMessages]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  const sendMessage = async () => {
    if (!input.trim() || !currentUserId) return;
    setSending(true);

    const { error } = await supabase.from('messages').insert({
      circle_id: circleId,
      user_id: currentUserId,
      content: input.trim(),
    });

    setSending(false);
    if (!error) {
      setInput('');
      fetchMessages();
    }
  };

  const getTimeStr = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const isConsecutive = (index: number) => {
    if (index === 0) return false;
    const prev = messages[index - 1];
    const curr = messages[index];
    if (prev.user_id !== curr.user_id) return false;
    const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff < 300000; // 5 minutes
  };

  const renderMessage = ({ item, index }: { item: any; index: number }) => {
    const isMe = item.user_id === currentUserId;
    const consecutive = isConsecutive(index);

    return (
      <View style={[styles.messageRow, consecutive && styles.messageConsecutive]}>
        {!consecutive && (
          <View style={styles.messageHeader}>
            <View style={[styles.msgAvatar, isMe && styles.msgAvatarMe]}>
              <Text style={styles.msgAvatarText}>
                {(item.user?.display_name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.msgName}>{item.user?.display_name || item.user?.username}</Text>
            <Text style={styles.msgTime}>{getTimeStr(item.created_at)}</Text>
          </View>
        )}
        <Text style={[styles.msgContent, consecutive && styles.msgContentConsecutive]}>
          {item.content}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>💬</Text>
            <Text style={styles.emptyText}>No messages yet</Text>
            <Text style={styles.emptySubtext}>Say what's on your mind</Text>
          </View>
        }
      />

      <View style={styles.inputBar}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Type a message..."
            placeholderTextColor="#444"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            returnKeyType="send"
            multiline
            maxLength={1000}
          />
          <SendButton onPress={sendMessage} disabled={!input.trim() || sending} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function SendButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      disabled={disabled}
      style={[
        styles.sendButton,
        hovered && styles.sendButtonHovered,
        disabled && styles.sendButtonDisabled,
      ]}
    >
      <Text style={styles.sendText}>↑</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messageList: {
    padding: 16,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
    flexGrow: 1,
  },
  messageRow: {
    marginBottom: 12,
  },
  messageConsecutive: {
    marginBottom: 2,
    marginTop: -6,
  },
  messageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  msgAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  msgAvatarMe: {
    backgroundColor: '#1a2e1a',
  },
  msgAvatarText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  msgName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  msgTime: {
    color: '#444',
    fontSize: 11,
  },
  msgContent: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 21,
    marginLeft: 36,
  },
  msgContentConsecutive: {
    marginLeft: 36,
  },
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    padding: 12,
    backgroundColor: '#0a0a0a',
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
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  sendButtonHovered: {
    backgroundColor: '#ddd',
    ...(Platform.OS === 'web' ? { transform: [{ scale: 1.05 }] } : {}),
  },
  sendButtonDisabled: {
    backgroundColor: '#333',
    opacity: 0.5,
  },
  sendText: {
    color: '#0a0a0a',
    fontSize: 18,
    fontWeight: '800',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 12,
  },
  emptyText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtext: {
    color: '#555',
    fontSize: 14,
    marginTop: 4,
  },
});
