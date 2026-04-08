import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ChatSession, ChatRun, MODE_CONFIG, RUN_STATUS_CONFIG } from './chatTypes';

interface Props {
  session: ChatSession | null;
  activeRun: ChatRun | null;
  pendingApprovals: number;
  contextSourceCount: number;
  accentColor: string;
}

function ChatStatusBar({ session, activeRun, pendingApprovals, contextSourceCount, accentColor }: Props) {
  if (!session) {
    return (
      <View style={[styles.container, { borderTopColor: accentColor + '15' }]}>
        <Text style={styles.idleText}>Start a chat to see status here.</Text>
      </View>
    );
  }

  const modeConf = MODE_CONFIG[session.mode];
  const runStatusConf = activeRun ? RUN_STATUS_CONFIG[activeRun.status] : null;

  return (
    <View style={[styles.container, { borderTopColor: accentColor + '15' }]}>
      <View style={styles.segmentBubble}>
        <Text style={styles.segmentText} numberOfLines={1}>{session.title}</Text>
      </View>
      <View style={[styles.segmentBubble, { backgroundColor: modeConf.color + '14' }]}>
        <Text style={[styles.segmentText, { color: modeConf.color }]}>{modeConf.label}</Text>
      </View>
      <View style={[styles.segmentBubble, { backgroundColor: accentColor + '12' }]}>
        <Text style={[styles.segmentText, { color: accentColor }]} numberOfLines={1}>
          {session.model ?? 'Auto model'}
        </Text>
      </View>
      {runStatusConf ? (
        <View style={[styles.segmentBubble, { backgroundColor: runStatusConf.color + '14' }]}>
          <Text style={[styles.segmentText, { color: runStatusConf.color }]}>{runStatusConf.label}</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      {pendingApprovals > 0 ? (
        <View style={styles.approvalBadge}>
          <Text style={styles.approvalText}>{pendingApprovals} approvals</Text>
        </View>
      ) : null}
      {contextSourceCount > 0 ? (
        <View style={styles.contextBadge}>
          <Text style={styles.contextText}>{contextSourceCount} context</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#09120a',
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  idleText: {
    color: '#8e9f8e',
    fontSize: 12,
  },
  segmentBubble: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#101910',
    maxWidth: 160,
  },
  segmentText: {
    color: '#d9e4d3',
    fontSize: 11,
    fontWeight: '700',
  },
  approvalBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#3a2a10',
  },
  approvalText: {
    color: '#ffcc78',
    fontSize: 11,
    fontWeight: '700',
  },
  contextBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#102019',
  },
  contextText: {
    color: '#8fd8b4',
    fontSize: 11,
    fontWeight: '700',
  },
});

export default ChatStatusBar;
