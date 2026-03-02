import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Pressable, Platform, ScrollView } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { SessionTag } from '../../../../lib/sessionTags';
import SessionTagInput from '../../../../components/SessionTagInput';
import AgentKillSwitch from '../../../../components/AgentKillSwitch';
import { useAgentControl } from '../../../../services/hitlService';
import PixelAgent from './PixelAgent';
import {
  AgentAppearance, DEFAULT_APPEARANCE, EnvironmentType,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, SHOE_COLORS, EYE_COLORS,
} from '../../../../lib/officeConfig';

const PANTS_COLORS = ['#2d2d3d', '#1a1a2e', '#3d2b1a', '#1e3a5f', '#2d1b4e', '#1a3d1a'];

interface Props {
  agent: OfficeAgent | null;
  onClose: () => void;
  isDesktop?: boolean;
  onRenameAgent?: (agentId: string, newName: string) => void;
  sessionTags?: Map<string, SessionTag[]>;
  onAddSessionTag?: (sessionKey: string, tag: SessionTag) => void;
  onRemoveSessionTag?: (sessionKey: string, tagKey: string) => void;
  circleId?: string;
  appearances?: Record<string, AgentAppearance>;
  onAppearanceChange?: (id: string, appearance: AgentAppearance) => void;
  environmentType?: EnvironmentType;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function formatRelativeTime(iso?: string): string {
  if (!iso) return 'unknown';
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatMsgTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString();
}

function cacheHitPct(cachedTokens: number, totalInputTokens: number): string {
  if (!totalInputTokens) return '—';
  return Math.round((cachedTokens / totalInputTokens) * 100) + '%';
}

export default function AgentPanel({
  agent, onClose, isDesktop, onRenameAgent,
  sessionTags, onAddSessionTag, onRemoveSessionTag, circleId,
  appearances, onAppearanceChange, environmentType,
}: Props) {
  const slideAnim = useRef(new Animated.Value(400)).current;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [showCustomize, setShowCustomize] = useState(false);

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

  // Extract sessionKey early so hooks always run in same order
  const sessionKey = agent
    ? (agent.sessionKey || (agent.id.includes('::') ? agent.id.split('::')[1] : agent.id))
    : undefined;

  const control = useAgentControl(circleId, sessionKey);

  if (!agent) return null;

  const statusColor = STATUS_COLORS[agent.status];
  const currentTags = sessionTags?.get(sessionKey!) || [];

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

      <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
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

      {/* Session identity row */}
      <View style={styles.sessionKeyRow}>
        <Text style={styles.sessionKeyLabel}>SESSION</Text>
        <Text style={styles.sessionKeyValue}>{agent.sessionKey || agent.id.split('::')[1] || agent.id}</Text>
      </View>

      {/* Cost + Performance grid */}
      <View style={styles.gridRow}>
        <View style={styles.gridCard}>
          <Text style={[styles.gridValue, { color: '#22c55e' }]}>${agent.costToday.toFixed(2)}</Text>
          <Text style={styles.gridLabel}>Cost Today</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={[styles.gridValue, { color: '#6366f1' }]}>{formatTokens(agent.tokensUsed)}</Text>
          <Text style={styles.gridLabel}>Total Tokens</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{agent.turns || agent.messagesProcessed || '—'}</Text>
          <Text style={styles.gridLabel}>Turns</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{formatTokens(agent.inputTokens)}</Text>
          <Text style={styles.gridLabel}>Input Tokens</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{formatTokens(agent.outputTokens)}</Text>
          <Text style={styles.gridLabel}>Output Tokens</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={[styles.gridValue, { color: '#f59e0b' }]}>
            {cacheHitPct(agent.cachedTokens, agent.inputTokens)}
          </Text>
          <Text style={styles.gridLabel}>Cache Hit</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{formatTokens(agent.cachedTokens)}</Text>
          <Text style={styles.gridLabel}>Cached Tokens</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{agent.uptime || formatRelativeTime(agent.lastActive)}</Text>
          <Text style={styles.gridLabel}>Uptime</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={styles.gridValue}>{formatRelativeTime(agent.lastActive)}</Text>
          <Text style={styles.gridLabel}>Last Active</Text>
        </View>
      </View>

      {/* Activity log — real messages with real timestamps */}
      <View style={styles.actionsSection}>
        <Text style={styles.actionsTitle}>ACTIVITY LOG</Text>
        {agent.recentMessages.length > 0 ? (
          [...agent.recentMessages].reverse().map((msg, i) => (
            <View key={i} style={styles.actionRow}>
              <Text style={styles.actionTime}>{formatMsgTime(msg.timestamp)}</Text>
              <View style={[styles.actionDot, {
                backgroundColor: msg.role === 'assistant' ? agent.color : '#555',
              }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionRole, {
                  color: msg.role === 'assistant' ? agent.color : '#666',
                }]}>{msg.role.toUpperCase()}</Text>
                <Text style={[styles.actionText, i === 0 && { color: '#ccc' }]} numberOfLines={2}>
                  {msg.content}
                </Text>
              </View>
            </View>
          ))
        ) : agent.recentActions.length > 0 ? (
          agent.recentActions.map((action, i) => (
            <View key={i} style={styles.actionRow}>
              <Text style={styles.actionTime}>—</Text>
              <View style={[styles.actionDot, { backgroundColor: i === 0 ? agent.color : '#333' }]} />
              <Text style={[styles.actionText, i === 0 && { color: '#ccc' }]}>{action}</Text>
            </View>
          ))
        ) : (
          <Text style={styles.noActivity}>No recent activity</Text>
        )}
      </View>

      {/* Customize Agent Appearance */}
      {onAppearanceChange && (
        <View style={styles.customizeSection}>
          <Pressable
            onPress={() => setShowCustomize(!showCustomize)}
            style={[styles.customizeToggle, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={styles.customizeToggleText}>
              {showCustomize ? '▼' : '▶'} CUSTOMIZE AGENT
            </Text>
          </Pressable>

          {showCustomize && (() => {
            const a = appearances?.[agent.name] || { ...DEFAULT_APPEARANCE, shirtColor: agent.color, hairColor: agent.color };
            const update = (patch: Partial<AgentAppearance>) => {
              onAppearanceChange(agent.name, { ...a, ...patch });
            };

            const ColorRow = ({ label, colors, value, onSelect }: { label: string; colors: string[]; value: string; onSelect: (c: string) => void }) => (
              <View style={styles.custRow}>
                <Text style={styles.custLabel}>{label}</Text>
                <View style={styles.custSwatches}>
                  {colors.map(c => (
                    <Pressable
                      key={c}
                      onPress={() => onSelect(c)}
                      style={[
                        styles.custSwatch,
                        { backgroundColor: c },
                        value === c && styles.custSwatchActive,
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    />
                  ))}
                </View>
              </View>
            );

            const OptionRow = ({ label, options, value, onSelect }: { label: string; options: { key: string; label: string }[]; value: string; onSelect: (k: string) => void }) => (
              <View style={styles.custRow}>
                <Text style={styles.custLabel}>{label}</Text>
                <View style={styles.custOptions}>
                  {options.map(o => (
                    <Pressable
                      key={o.key}
                      onPress={() => onSelect(o.key)}
                      style={[
                        styles.custOptionBtn,
                        value === o.key && styles.custOptionActive,
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={[styles.custOptionText, value === o.key && styles.custOptionTextActive]}>{o.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );

            return (
              <View style={styles.custBody}>
                {/* Live preview */}
                <View style={styles.custPreview}>
                  <PixelAgent
                    agent={agent}
                    appearance={a}
                    environmentType={environmentType}
                    onPress={() => {}}
                    selected={false}
                    scale={1.6}
                  />
                </View>

                <ColorRow label="SKIN" colors={SKIN_TONES} value={a.skinTone} onSelect={c => update({ skinTone: c })} />
                <ColorRow label="HAIR COLOR" colors={HAIR_COLORS} value={a.hairColor} onSelect={c => update({ hairColor: c })} />
                <OptionRow label="HAIRSTYLE" value={a.hairStyle} onSelect={k => update({ hairStyle: k as any })}
                  options={['flat', 'spiky', 'mohawk', 'long', 'curly', 'ponytail', 'cap', 'bald'].map(h => ({ key: h, label: h.toUpperCase() }))} />
                <ColorRow label="EYES" colors={EYE_COLORS} value={a.eyeColor} onSelect={c => update({ eyeColor: c })} />
                <ColorRow label="SHIRT" colors={SHIRT_COLORS} value={a.shirtColor} onSelect={c => update({ shirtColor: c })} />
                <ColorRow label="PANTS" colors={PANTS_COLORS} value={a.pantsColor} onSelect={c => update({ pantsColor: c })} />
                <ColorRow label="SHOES" colors={SHOE_COLORS} value={a.shoeColor} onSelect={c => update({ shoeColor: c })} />
                <OptionRow label="HAT" value={a.hat} onSelect={k => update({ hat: k as any })}
                  options={['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'space_helmet', 'wizard_hat', 'halo', 'antenna'].map(h => ({ key: h, label: h.toUpperCase().replace('_', ' ') }))} />
                <OptionRow label="EXPRESSION" value={a.expression} onSelect={k => update({ expression: k as any })}
                  options={['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry'].map(e => ({ key: e, label: e.toUpperCase() }))} />
                <OptionRow label="ACCESSORY" value={a.accessory} onSelect={k => update({ accessory: k as any })}
                  options={['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana'].map(x => ({ key: x, label: x.toUpperCase() }))} />
                <OptionRow label="BACK ITEM" value={a.backItem} onSelect={k => update({ backItem: k as any })}
                  options={['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver'].map(b => ({ key: b, label: b.toUpperCase() }))} />
                <OptionRow label="FACIAL HAIR" value={a.facialHair} onSelect={k => update({ facialHair: k as any })}
                  options={['none', 'stubble', 'beard', 'mustache', 'goatee'].map(f => ({ key: f, label: f.toUpperCase() }))} />
                <OptionRow label="PET" value={a.pet} onSelect={k => update({ pet: k as any })}
                  options={[{ key: 'none', label: 'NONE' }, { key: 'cat', label: '🐱 CAT' }, { key: 'dog', label: '🐕 DOG' }, { key: 'bird', label: '🐦 BIRD' }, { key: 'robot', label: '🤖 BOT' }, { key: 'dragon', label: '🐉 DRAGON' }, { key: 'alien', label: '👽 ALIEN' }]} />
                <OptionRow label="AURA" value={a.aura} onSelect={k => update({ aura: k as any })}
                  options={[{ key: 'none', label: 'NONE' }, { key: 'fire', label: '🔥 FIRE' }, { key: 'ice', label: '🧊 ICE' }, { key: 'electric', label: '⚡ ZAP' }, { key: 'nature', label: '🌿 LEAF' }, { key: 'shadow', label: '🌑 DARK' }, { key: 'rainbow', label: '🌈 RAINBOW' }, { key: 'glitch', label: '📟 GLITCH' }, { key: 'cosmic', label: '✨ COSMIC' }]} />
                <OptionRow label="HAND ITEM" value={a.handItem || 'none'} onSelect={k => update({ handItem: k as any })}
                  options={[{ key: 'none', label: 'NONE' }, { key: 'lightsaber', label: '⚔️ SABER' }, { key: 'coffee', label: '☕ COFFEE' }, { key: 'laptop', label: '💻 LAPTOP' }, { key: 'flag', label: '🚩 FLAG' }, { key: 'wand', label: '🪄 WAND' }]} />
              </View>
            );
          })()}
        </View>
      )}

      {/* Kill switch / controls */}
      {circleId && (
        <AgentKillSwitch
          control={control}
          circleId={circleId}
          sessionKey={sessionKey}
          agentName={agent.name}
        />
      )}

      </ScrollView>
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
  scrollContent: {
    flex: 1,
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
  // Session key
  sessionKeyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  sessionKeyLabel: {
    fontSize: 9,
    color: '#444',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 1,
  },
  sessionKeyValue: {
    fontSize: 9,
    color: '#555',
    fontFamily: 'monospace',
    flex: 1,
  },
  // Activity log
  actionsSection: {
    gap: 5,
    marginBottom: 8,
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
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  actionTime: {
    fontSize: 8,
    color: '#333',
    fontFamily: 'monospace',
    width: 52,
    textAlign: 'right',
    paddingTop: 2,
  },
  actionDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 4,
  },
  actionRole: {
    fontSize: 7,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 1,
  },
  actionText: {
    fontSize: 10,
    color: '#555',
    fontFamily: 'monospace',
    flex: 1,
    lineHeight: 14,
  },
  noActivity: {
    fontSize: 10,
    color: '#333',
    fontFamily: 'monospace',
    fontStyle: 'italic',
    paddingLeft: 12,
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
  // Customize section
  customizeSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderColor: '#1a1a2e',
    paddingTop: 10,
  },
  customizeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  customizeToggleText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  custBody: {
    gap: 8,
    paddingTop: 8,
  },
  custPreview: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#0a0a12',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    marginBottom: 4,
  },
  custRow: {
    gap: 4,
  },
  custLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#555',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
  },
  custSwatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  custSwatch: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  custSwatchActive: {
    borderColor: '#fff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 6px #ffffff60' } as any : {}),
  },
  custOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  custOptionBtn: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  custOptionActive: {
    backgroundColor: '#6366f120',
    borderColor: '#6366f160',
  },
  custOptionText: {
    fontSize: 7,
    fontWeight: '700',
    color: '#555',
    fontFamily: 'monospace',
  },
  custOptionTextActive: {
    color: '#a5b4fc',
  },
});
