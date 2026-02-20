import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { DirectMessage } from '../../types';
import Card from '../../components/Card';
import Button from '../../components/Button';

export default function DMScreen({ navigation, route }: any) {
  const { friendId, friendName } = route.params;
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    getCurrentUser();
    loadMessages();
    
    // Set up real-time subscription
    const subscription = supabase
      .channel(`dm-${friendId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `or(and(sender_id.eq.${currentUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${currentUserId}))`,
        },
        (payload) => {
          const newMessage = payload.new as DirectMessage;
          setMessages(prev => [...prev, newMessage]);
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [friendId, currentUserId]);

  const getCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);
  };

  const loadMessages = async () => {
    if (!currentUserId) return;

    const { data, error } = await supabase
      .from('direct_messages')
      .select(`
        *,
        sender:profiles!direct_messages_sender_id_fkey(id, display_name, username),
        receiver:profiles!direct_messages_receiver_id_fkey(id, display_name, username)
      `)
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${currentUserId})`)
      .order('created_at', { ascending: true });

    if (error) {
      Alert.alert('Error', 'Failed to load messages');
      return;
    }

    setMessages(data || []);
    
    // Mark messages as read
    await markMessagesAsRead();
    
    setTimeout(scrollToBottom, 100);
  };

  const markMessagesAsRead = async () => {
    const { error } = await supabase
      .from('direct_messages')
      .update({ is_read: true })
      .eq('sender_id', friendId)
      .eq('receiver_id', currentUserId)
      .eq('is_read', false);

    if (error) console.error('Failed to mark messages as read:', error);
  };

  const sendMessage = async () => {
    if (!newMessage.trim() || loading) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('direct_messages')
        .insert({
          sender_id: currentUserId,
          receiver_id: friendId,
          content: newMessage.trim(),
          message_type: 'text',
          is_read: false,
        })
        .select(`
          *,
          sender:profiles!direct_messages_sender_id_fkey(id, display_name, username),
          receiver:profiles!direct_messages_receiver_id_fkey(id, display_name, username)
        `)
        .single();

      if (error) throw error;

      // Message will be added via real-time subscription
      setNewMessage('');
      scrollToBottom();
    } catch (error: any) {
      Alert.alert('Error', 'Failed to send message');
    }
    setLoading(false);
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 24) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffInHours < 24 * 7) {
      return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
  };

  const groupMessagesByDate = (messages: DirectMessage[]) => {
    const groups: { [key: string]: DirectMessage[] } = {};
    
    messages.forEach(message => {
      const date = new Date(message.created_at).toDateString();
      if (!groups[date]) {
        groups[date] = [];
      }
      groups[date].push(message);
    });
    
    return groups;
  };

  const messageGroups = groupMessagesByDate(messages);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>← BACK</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{friendName || 'Chat'}</Text>
          <Text style={styles.headerSubtitle}>Direct Message</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView 
          ref={scrollViewRef}
          contentContainerStyle={styles.messagesContainer}
          showsVerticalScrollIndicator={false}
        >
          {Object.keys(messageGroups).length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Start the conversation!</Text>
              <Text style={styles.emptyDesc}>
                Send your first message to {friendName}
              </Text>
            </View>
          ) : (
            Object.entries(messageGroups).map(([date, groupMessages]) => (
              <View key={date}>
                <View style={styles.dateDivider}>
                  <Text style={styles.dateText}>
                    {new Date(date).toLocaleDateString([], { 
                      weekday: 'long', 
                      year: 'numeric', 
                      month: 'long', 
                      day: 'numeric' 
                    })}
                  </Text>
                </View>
                
                {groupMessages.map((message, index) => {
                  const isMyMessage = message.sender_id === currentUserId;
                  const showAvatar = !isMyMessage && (
                    index === 0 || 
                    groupMessages[index - 1]?.sender_id !== message.sender_id
                  );
                  
                  return (
                    <View
                      key={message.id}
                      style={[
                        styles.messageRow,
                        isMyMessage ? styles.myMessageRow : styles.theirMessageRow,
                      ]}
                    >
                      {showAvatar && (
                        <View style={styles.messageAvatar}>
                          <Text style={styles.messageAvatarText}>
                            {friendName?.charAt(0)?.toUpperCase() || '?'}
                          </Text>
                        </View>
                      )}
                      
                      <View style={[
                        styles.messageBubble,
                        isMyMessage ? styles.myMessage : styles.theirMessage,
                        !showAvatar && !isMyMessage && { marginLeft: 48 },
                      ]}>
                        <Text style={[
                          styles.messageText,
                          isMyMessage ? styles.myMessageText : styles.theirMessageText,
                        ]}>
                          {message.content}
                        </Text>
                        <Text style={[
                          styles.messageTime,
                          isMyMessage ? styles.myMessageTime : styles.theirMessageTime,
                        ]}>
                          {formatTime(message.created_at)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        <Card style={styles.inputContainer}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.messageInput}
              value={newMessage}
              onChangeText={setNewMessage}
              placeholder={`Message ${friendName}...`}
              placeholderTextColor="#444"
              multiline
              maxLength={1000}
              onSubmitEditing={sendMessage}
              blurOnSubmit={false}
            />
            <Button
              title="SEND"
              onPress={sendMessage}
              loading={loading}
              disabled={!newMessage.trim()}
              style={styles.sendButton}
            />
          </View>
        </Card>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  headerBack: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  headerSubtitle: { color: '#666', fontSize: 10, letterSpacing: 1, marginTop: 2 },
  
  content: { flex: 1 },
  messagesContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },

  emptyState: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center',
    paddingVertical: 60,
  },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptyDesc: { color: '#666', fontSize: 14, textAlign: 'center' },

  dateDivider: { 
    alignItems: 'center', 
    marginVertical: 20,
  },
  dateText: { 
    color: '#444', 
    fontSize: 11, 
    backgroundColor: '#111',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
  },

  messageRow: { 
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  myMessageRow: { 
    justifyContent: 'flex-end',
  },
  theirMessageRow: { 
    justifyContent: 'flex-start',
  },

  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageAvatarText: { color: '#fff', fontSize: 12, fontWeight: '900' },

  messageBubble: {
    maxWidth: '75%',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  myMessage: {
    backgroundColor: '#6366f1',
    borderBottomRightRadius: 4,
  },
  theirMessage: {
    backgroundColor: '#222',
    borderBottomLeftRadius: 4,
  },

  messageText: { fontSize: 14, lineHeight: 18 },
  myMessageText: { color: '#fff' },
  theirMessageText: { color: '#fff' },

  messageTime: { 
    fontSize: 9, 
    marginTop: 4,
    opacity: 0.7,
  },
  myMessageTime: { color: '#ddd', textAlign: 'right' },
  theirMessageTime: { color: '#999', textAlign: 'left' },

  inputContainer: {
    margin: 20,
    maxWidth: 480,
    alignSelf: 'center',
    width: '90%',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  messageInput: {
    flex: 1,
    backgroundColor: 'transparent',
    color: '#fff',
    fontSize: 14,
    maxHeight: 100,
    textAlignVertical: 'center',
  },
  sendButton: {
    minHeight: 40,
    paddingHorizontal: 16,
  },
});