import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Pressable, Platform } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { SessionTag } from '../../../../lib/sessionTags';
import SessionTagInput from '../../../../components/SessionTagInput';

interface Props {
  agent: OfficeAgent | null;
  onClose: () => void;
  isDesktop?: boolean;
  onRenameAgent?: (agentId: string, newName: string) => void;
  sessionTags?: Map<string, SessionTag[]>;
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

export default function AgentPanel({
  agent, onClose, isDesktop, onRenameAgent,
  sessionTags, onAddSessionTag, onRemoveSessionTag
}: Props) {
  const slideAnim = useRef(new Animated.Value(400)).current;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    if (agent) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: Platform.OS !== 'web',
        tension: 80,
        friction: 12,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 400,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [agent]);

  if (!agent) return null;

  const statusColor = STATUS_COLORS[agent.status];
  
  // Extract sessionKey from agent.id (format: connectionId::sessionKey)
  const sessionKey = agent.id.includes('::') ? agent.id.split('::')[1] : agent.id;
  const currentTags = sessionTags?.get(sessionKey) || [];

  return (
    <Animated.View style={[
      styles.panel,
      { transform: [{ translateY: slideAnim }] },
      isDesktop && styles.panelDesktop,
    ]}>
      {/* Handle */}
      <Pressable onPress={onClose} style={styles.handleArea}>
        <View style={styles.handle} />
      </Pressable>

      {/* Agent header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatar, { backgroundColor: agent.color + '20', borderColor: agent.color }]}>
            <Text style={[styles.avatarText, { color: agent.color }]}>
              {agent.name.charAt(0)}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            {editing ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.renameInput}
                  value={editName}
                  onChangeText={setEditName}
                  autoFocus
                  onSubmitEditing={() => {
                    if (editName.trim() && onRenameAgent) {
                      onRenameAgent(agent.id, editName.trim());
                    }
                    setEditing(false);
                  }}
                />
                <Pressable
                  onPress={() => {
                    if (editName.trim() && onRenameAgent) {
                      onRenameAgent(agent.id, editName.trim());
                    }
                    setEditing(false);
                  }}
                  style={[styles.renameSaveBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.renameSaveText}>✓</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditing(false)}
                  style={[styles.renameCancelBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.renameCancelText}>✕</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => { setEditName(agent.name); setEditing(true); }}
                style={[Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{agent.name}</Text>
                  <Text style={styles.renameHint}>✏️</Text>
                </View>
              </Pressable>
            )}
            <View style={styles.roleRow}>
              <Text style={styles.role}>{agent.role}</Text>
              <View style={styles.modelBadge}>
                <Text style={styles.modelText}>{agent.model}</Text>
              </View>
            </View>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '20', borderColor: statusColor + '40' }]}>
          <View style={[styles.statusDotSmall, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{agent.status.toUpperCase()}</Text>
        </View>
      </View>

      {/* Connection source */}
      <View style={styles.connectionRow}>
        <Text style={styles.connectionIcon}>{PROVIDER_META[agent.providerType]?.icon || '📡'}</Text>
        <Text style={[styles.connectionName, { color: PROVIDER_META[agent.providerType]?.color || '#888' }]}>{agent.connectionName}</Text>
        <Text style={styles.connectionType}>{PROVIDER_META[agent.providerType]?.label || agent.providerType}</Text>
      </View>

      {/* Current activity */}
      <View style={styles.activityBar}>
        <Text style={styles.activityLabel}>NOW:</Text>
        <Text style={styles.activityValue}>{agent.activity}</Text>
      </View>

      {/* Session Tags */}
      {onAddSessionTag && onRemoveSessionTag && (
        <View style={styles.tagsSection}>
          <Text style={styles.tagsSectionTitle}>SESSION TAGS</Text>
          <SessionTagInput
            sessionKey={sessionKey}
            currentTags={currentTags}
            onAddTag={(tag) => onAddSessionTag(sessionKey, tag)}
            onRemoveTag={(tagKey) => onRemoveSessionTag(sessionKey, tagKey)}
          />
        </View>
      )}

      {/* Cost + Performance grid */}
      <View style={styles.gridRow}>
        <View style={styles.gridCard}>
          <Text style={[styles.gridValue, { color: '#22c55e' }]}>${agent.costToday.toFixed(2)}</Text>
          <Text style={styles.gridLabel}>Cost Today</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>${agent.costWeek.toFixed(2)}</Text>
          <Text style={styles.gridLabel}>This Week</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={[styles.gridValue, { color: '#6366f1' }]}>{formatTokens(agent.tokensUsed)}</Text>
          <Text style={styles.gridLabel}>Tokens Used</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{agent.messagesProcessed.toLocaleString()}</Text>
          <Text style={styles.gridLabel}>Messages</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{agent.uptimeHours}h</Text>
          <Text style={styles.gridLabel}>Uptime</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{agent.lastActive}</Text>
          <Text style={styles.gridLabel}>Last Active</Text>
        </View>
      </View>

      {/* Recent actions */}
      <View style={styles.actionsSection}>
        <Text style={styles.actionsTitle}>ACTIVITY LOG</Text>
        {agent.recentActions.map((action, i) => (
          <View key={i} style={styles.actionRow}>
            <Text style={styles.actionTime}>{i === 0 ? 'just now' : `${i * 3 + 1}m ago`}</Text>
            <View style={[styles.actionDot, { backgroundColor: i === 0 ? agent.color : '#333' }]} />
            <Text style={[styles.actionText, i === 0 && { color: '#ccc' }]}>{action}</Text>
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0d0d14',
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: 560,
  },
  panelDesktop: {
    maxWidth: 560,
    left: 'auto' as any,
    right: 16,
    bottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 18,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  name: {
    fontSize: 16,
    fontWeight: '800',
    color: '#eee',
    fontFamily: 'monospace',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameHint: {
    fontSize: 10,
    opacity: 0.4,
  },
  renameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameInput: {
    flex: 1,
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: '#eee',
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '800',
  },
  renameSaveBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#22c55e20',
    borderWidth: 1,
    borderColor: '#22c55e40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameSaveText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '800',
  },
  renameCancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ef444420',
    borderWidth: 1,
    borderColor: '#ef444440',
    alignItems: 'center',
    justifyContent: 'center',
  },
  renameCancelText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '800',
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  role: {
    fontSize: 11,
    color: '#666',
    fontFamily: 'monospace',
  },
  modelBadge: {
    backgroundColor: '#ffffff08',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#ffffff10',
  },
  modelText: {
    fontSize: 8,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  // Connection source
  connectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 10, paddingHorizontal: 4,
  },
  connectionIcon: { fontSize: 12 },
  connectionName: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  connectionType: { fontSize: 9, color: '#555', fontFamily: 'monospace' },
  // Activity bar
  activityBar: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#111118',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  activityLabel: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  activityValue: {
    fontSize: 10,
    color: '#aaa',
    fontFamily: 'monospace',
    flex: 1,
  },
  // Cost/perf grid
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  gridCard: {
    backgroundColor: '#0a0a12',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    minWidth: '30%' as any,
    flex: 1,
  },
  gridValue: {
    fontSize: 15,
    fontWeight: '900',
    color: '#ddd',
    fontFamily: 'monospace',
  },
  gridLabel: {
    fontSize: 8,
    color: '#555',
    fontFamily: 'monospace',
    marginTop: 2,
    letterSpacing: 0.3,
  },
  // Activity log
  actionsSection: {
    gap: 5,
  },
  actionsTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#444',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionTime: {
    fontSize: 8,
    color: '#333',
    fontFamily: 'monospace',
    width: 46,
    textAlign: 'right',
  },
  actionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  actionText: {
    fontSize: 11,
    color: '#555',
    fontFamily: 'monospace',
    flex: 1,
  },
  // Tags section
  tagsSection: {
    gap: 6,
    marginVertical: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#1a1a2e',
  },
  tagsSectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: '#444',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
});
