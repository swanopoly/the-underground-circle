import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { ChatSession, MODE_CONFIG } from './chatTypes';

interface Props {
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  accentColor: string;
}

function formatRelativeTime(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ChatSidebar({ sessions, activeSessionId, onSelectSession, onNewSession, accentColor }: Props) {
  const ordered = useMemo(() => [...sessions].sort((a, b) => (
    new Date(b.lastEntryAt || b.createdAt).getTime() - new Date(a.lastEntryAt || a.createdAt).getTime()
  )), [sessions]);

  return (
    <View style={styles.container}>
      <View style={styles.topBlock}>
        <Text style={[styles.eyebrow, { color: accentColor }]}>Conversations</Text>
        <Text style={styles.title}>Main Chat</Text>
        <Text style={styles.subtitle}>Simple, warm, and ready for anything.</Text>
      </View>

      <Pressable
        style={[styles.newSessionButton, { backgroundColor: accentColor, borderColor: accentColor }]}
        onPress={onNewSession}
      >
        <Text style={styles.newSessionIcon}>＋</Text>
        <Text style={styles.newSessionLabel}>New chat</Text>
      </Pressable>

      <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
        {ordered.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>No chats yet</Text>
            <Text style={styles.emptySubtext}>Start one and your recent conversations will show up here.</Text>
          </View>
        ) : (
          ordered.map(session => {
            const active = session.id === activeSessionId;
            const modeConf = MODE_CONFIG[session.mode];
            return (
              <Pressable
                key={session.id}
                style={[
                  styles.sessionCard,
                  active && { borderColor: accentColor + '55', backgroundColor: accentColor + '12' },
                ]}
                onPress={() => onSelectSession(session.id)}
              >
                <View style={styles.cardTop}>
                  <Text style={[styles.sessionTitle, active && { color: '#f5faef' }]} numberOfLines={1}>
                    {session.title}
                  </Text>
                  <Text style={styles.sessionTime}>{formatRelativeTime(session.lastEntryAt)}</Text>
                </View>
                <View style={styles.cardBottom}>
                  <View style={[styles.modePill, { backgroundColor: modeConf.color + '16' }]}>
                    <Text style={[styles.modePillText, { color: modeConf.color }]}>{modeConf.label}</Text>
                  </View>
                  <Text style={styles.modelHint} numberOfLines={1}>{session.model ?? 'Auto model'}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 14,
  },
  topBlock: {
    marginBottom: 16,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#f2f8ee',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#90a090',
    lineHeight: 18,
  },
  newSessionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 999,
    borderWidth: 1,
    marginBottom: 16,
  },
  newSessionIcon: {
    color: '#081109',
    fontSize: 16,
    fontWeight: '900',
  },
  newSessionLabel: {
    color: '#081109',
    fontSize: 13,
    fontWeight: '800',
  },
  scrollArea: {
    flex: 1,
  },
  emptyContainer: {
    padding: 16,
    borderRadius: 24,
    backgroundColor: '#0f1811',
    borderWidth: 1,
    borderColor: '#18231a',
  },
  emptyTitle: {
    color: '#eef7e6',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtext: {
    color: '#8d9d8d',
    fontSize: 13,
    lineHeight: 18,
  },
  sessionCard: {
    borderRadius: 24,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#18231a',
    backgroundColor: '#0f1811',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  sessionTitle: {
    flex: 1,
    color: '#ced9c9',
    fontSize: 14,
    fontWeight: '700',
  },
  sessionTime: {
    color: '#738173',
    fontSize: 11,
    fontWeight: '600',
  },
  cardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modePill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  modePillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modelHint: {
    flex: 1,
    color: '#839283',
    fontSize: 11,
  },
});

export default ChatSidebar;
