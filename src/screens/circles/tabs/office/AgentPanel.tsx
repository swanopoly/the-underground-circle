import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Pressable, Platform, ScrollView } from 'react-native';
import { OfficeAgent, STATUS_COLORS } from '../../../../lib/officeAgents';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { SessionTag } from '../../../../lib/sessionTags';
import SessionTagInput from '../../../../components/SessionTagInput';
import AgentControlCard from '../../../../components/AgentControlCard';
import { useAgentControl } from '../../../../services/hitlService';
import PixelAgent from './PixelAgent';
import {
  AgentAppearance, DEFAULT_APPEARANCE, EnvironmentType,
  SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, SHOE_COLORS, EYE_COLORS,
} from '../../../../lib/officeConfig';
import {
  getTemplatesByCategory, detectTemplate,
} from '../../../../lib/soulTemplates';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, getSpiritById, type AgentSpirit } from '../../../../lib/agentSpirits';
import { updateAgentSpirit } from '../../../../lib/circleOffice';
import { supabase } from '../../../../lib/supabase';

const PANTS_COLORS = ['#2d2d3d', '#2a2a2a', '#3d2b1a', '#1e3a5f', '#2d1b4e', '#1a3d1a'];

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
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
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

// ── SECTION: agent-quick-terminal — Inline AI chat with this specific agent ──

function AgentQuickTerminal({ agentName, agentId, circleId }: { agentName: string; agentId: string; circleId: string }) {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    setOutput('');
    try {
      const { data, error } = await supabase.functions.invoke('swanbot-ai', {
        body: {
          message: `@${agentName}: ${input}`,
          circleId,
          userId: (await supabase.auth.getUser()).data.user?.id,
          targetAgentName: agentName,
        },
      });
      if (error) throw error;
      setOutput(data?.response || data?.text || JSON.stringify(data).slice(0, 500));
    } catch (e: any) {
      setOutput(`Error: ${e.message || 'Failed to reach agent'}`);
    }
    setSending(false);
  };

  return (
    <View style={qtStyles.container} nativeID="section-agent-quick-terminal">
      <Text style={qtStyles.label}>TALK TO {agentName.toUpperCase()}</Text>
      <View style={qtStyles.inputRow}>
        <Text style={qtStyles.prompt}>{'>'}</Text>
        <TextInput
          style={qtStyles.input}
          value={input}
          onChangeText={setInput}
          placeholder={`Ask ${agentName} something...`}
          placeholderTextColor="#3b3b5b"
          onSubmitEditing={handleSend}
          returnKeyType="send"
          autoCapitalize="none"
          multiline={false}
        />
        <Pressable
          onPress={handleSend}
          disabled={sending || !input.trim()}
          style={[qtStyles.sendBtn, (!input.trim() || sending) && { opacity: 0.4 }]}
        >
          <Text style={qtStyles.sendText}>{sending ? '...' : '>'}</Text>
        </Pressable>
      </View>
      {output ? (
        <ScrollView style={qtStyles.output} nestedScrollEnabled>
          <Text style={qtStyles.outputText} selectable>{output}</Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const qtStyles = StyleSheet.create({
  container: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#1a1a2e', paddingTop: 10 },
  label: { color: '#6b7280', fontSize: 9, fontWeight: '700', letterSpacing: 1, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, marginBottom: 6, paddingHorizontal: 12 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#08081a', borderRadius: 8, borderWidth: 1, borderColor: '#1e1e3a', marginHorizontal: 12, paddingHorizontal: 8 },
  prompt: { color: '#8b5cf6', fontSize: 14, fontWeight: '800', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, marginRight: 6 },
  input: { flex: 1, color: '#e8e8f8', fontSize: 12, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, paddingVertical: 8, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any,
  sendBtn: { backgroundColor: '#8b5cf6', borderRadius: 5, paddingHorizontal: 10, paddingVertical: 4 },
  sendText: { color: '#fff', fontSize: 11, fontWeight: '800', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined },
  output: { backgroundColor: '#08081a', borderRadius: 8, borderWidth: 1, borderColor: '#1e1e3a', padding: 10, marginHorizontal: 12, marginTop: 6, maxHeight: 180 },
  outputText: { color: '#c9d1e8', fontSize: 11, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, lineHeight: 16 },
});

// ═════════════════════════════════════════════════════════════════════════════

export default function AgentPanel({
  agent, onClose, isDesktop, onRenameAgent,
  sessionTags, onAddSessionTag, onRemoveSessionTag, circleId,
  appearances, onAppearanceChange, environmentType, onRunCommand,
}: Props) {
  const slideAnim = useRef(new Animated.Value(400)).current;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [showCustomize, setShowCustomize] = useState(false);
  const [showSoul, setShowSoul] = useState(false); // kept for reset effect
  const [soulText, setSoulText] = useState('');
  const [soulSaving, setSoulSaving] = useState(false);
  const [soulStatus, setSoulStatus] = useState('');
  const [soulLoaded, setSoulLoaded] = useState<string | null>(null); // tracks which agent was loaded
  const [showSpirits, setShowSpirits] = useState(false);
  const [currentSpirit, setCurrentSpirit] = useState<string | null>(null);
  const [dbAgentId, setDbAgentId] = useState<string | null>(null);

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

  // Load spirit from DB agent when panel opens
  useEffect(() => {
    if (!agent || !circleId) return;
    (async () => {
      const { data } = await supabase
        .from('circle_office_agents')
        .select('id, spirit, spirit_emoji')
        .eq('circle_id', circleId)
        .ilike('name', agent.name)
        .maybeSingle();
      if (data) {
        setDbAgentId(data.id);
        setCurrentSpirit(data.spirit || null);
      }
    })();
  }, [agent?.name, circleId]);

  // Load personality when agent panel opens for a specific agent
  useEffect(() => {
    if (!agent || !circleId) return;
    const agentKey = agent.name || 'default';
    if (soulLoaded === agentKey) return; // already loaded
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('agent_personalities')
        .select('personality')
        .eq('user_id', auth.user.id)
        .eq('circle_id', circleId)
        .eq('agent_name', agentKey)
        .maybeSingle();
      // Fallback: if no per-agent personality, try 'default'
      if (!data?.personality) {
        const { data: defaultData } = await supabase
          .from('agent_personalities')
          .select('personality')
          .eq('user_id', auth.user.id)
          .eq('circle_id', circleId)
          .eq('agent_name', 'default')
          .maybeSingle();
        setSoulText(defaultData?.personality || '');
      } else {
        setSoulText(data.personality);
      }
      setSoulLoaded(agentKey);
    })();
  }, [agent?.name, circleId]);

  // Reset loaded state when agent changes
  useEffect(() => {
    if (!agent) {
      setSoulLoaded(null);
      setSoulText('');
      setShowSoul(false);
    }
  }, [agent?.name]);

  const handleSaveSoul = async () => {
    if (!circleId || !agent) return;
    setSoulSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSoulSaving(false); return; }
    const agentKey = agent.name || 'default';
    const { error } = await supabase
      .from('agent_personalities')
      .upsert({
        user_id: auth.user.id,
        circle_id: circleId,
        agent_name: agentKey,
        personality: soulText.trim(),
      }, { onConflict: 'user_id,circle_id,agent_name' });
    setSoulStatus(error ? `Error: ${error.message}` : 'Soul saved!');
    setSoulSaving(false);
    setTimeout(() => setSoulStatus(''), 3000);
  };

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

      {/* Agent Spirit & Soul — unified section */}
      <Pressable
        onPress={() => setShowSpirits(!showSpirits)}
        style={[styles.spiritRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={styles.spiritLabel}>
          {showSpirits ? '▼' : '▶'} SPIRIT & SOUL
        </Text>
        {currentSpirit ? (
          <View style={styles.spiritBadge}>
            <Text style={styles.spiritBadgeText}>
              {getSpiritById(currentSpirit)?.emoji} {getSpiritById(currentSpirit)?.name}
            </Text>
          </View>
        ) : (
          <Text style={styles.spiritNone}>none assigned</Text>
        )}
      </Pressable>

      {showSpirits && (
        <View style={styles.spiritPicker}>
          <Text style={styles.spiritHint}>
            Assign a specialty that shapes how {agent.name} thinks, responds, and what it knows.
          </Text>
          {currentSpirit && (
            <Pressable
              onPress={async () => {
                if (dbAgentId) {
                  await updateAgentSpirit(dbAgentId, null, null);
                  setCurrentSpirit(null);
                }
              }}
              style={[styles.spiritClearBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={styles.spiritClearText}>Clear spirit</Text>
            </Pressable>
          )}
          {SPIRIT_CATEGORIES.map(cat => (
            <View key={cat.key}>
              <Text style={[styles.spiritCatLabel, { color: cat.color }]}>{cat.label}</Text>
              <View style={styles.spiritGrid}>
                {AGENT_SPIRITS.filter(s => s.category === cat.key).map(spirit => {
                  const active = currentSpirit === spirit.id;
                  return (
                    <Pressable
                      key={spirit.id}
                      onPress={async () => {
                        if (dbAgentId) {
                          await updateAgentSpirit(dbAgentId, spirit.id, spirit.emoji);
                          setCurrentSpirit(spirit.id);
                        }
                      }}
                      style={[
                        styles.spiritCard,
                        active && { borderColor: spirit.color + '60', backgroundColor: spirit.color + '10' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={styles.spiritEmoji}>{spirit.emoji}</Text>
                      <Text style={[styles.spiritName, active && { color: spirit.color }]} numberOfLines={1}>
                        {spirit.name}
                      </Text>
                      <Text style={styles.spiritTagline} numberOfLines={1}>{spirit.tagline}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          {/* Personality (Soul) — inline below spirit grid */}
          {circleId && (
            <View style={styles.soulInlineSection}>
              <Text style={[styles.spiritCatLabel, { color: '#a855f7' }]}>Personality</Text>
              <Text style={styles.spiritHint}>
                Optional: fine-tune communication style. Prepended to every LLM call alongside the spirit.
              </Text>

              {/* Personality template quick-picks */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {getTemplatesByCategory('personality').map(tmpl => {
                  const isActive = detectTemplate(soulText)?.id === tmpl.id;
                  return (
                    <Pressable
                      key={tmpl.id}
                      onPress={() => setSoulText(tmpl.soulText)}
                      style={[
                        styles.personalityChip,
                        isActive && { borderColor: '#6366f1', backgroundColor: '#6366f115' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <Text style={styles.personalityChipText}>
                        {tmpl.emoji} {tmpl.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Editable soul text */}
              <TextInput
                style={styles.soulInput}
                value={soulText}
                onChangeText={setSoulText}
                placeholder="Pick a personality or write custom SOUL..."
                placeholderTextColor="#444"
                multiline
                numberOfLines={3}
              />

              {/* Save / Clear row */}
              <View style={styles.soulActions}>
                <Pressable
                  onPress={handleSaveSoul}
                  disabled={soulSaving}
                  style={[styles.soulSaveBtn, soulSaving && { opacity: 0.4 }]}
                >
                  <Text style={styles.soulSaveBtnText}>{soulSaving ? 'SAVING...' : 'SAVE SOUL'}</Text>
                </Pressable>
                {soulText.trim() ? (
                  <Pressable onPress={() => setSoulText('')} style={styles.soulClearBtn}>
                    <Text style={styles.soulClearBtnText}>CLEAR</Text>
                  </Pressable>
                ) : null}
                {soulStatus ? (
                  <Text style={{ fontSize: 8, color: soulStatus.startsWith('Error') ? '#ef4444' : '#22c55e', fontFamily: 'monospace' }}>
                    {soulStatus}
                  </Text>
                ) : null}
              </View>
            </View>
          )}
        </View>
      )}

      {/* Current activity */}
      <View style={styles.activityBar}>
        <Text style={styles.activityLabel}>NOW:</Text>
        <Text style={styles.activityValue}>{agent.activity}</Text>
      </View>

      {/* Session Tags */}
      {onAddSessionTag && onRemoveSessionTag && sessionKey && (
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
          <Text style={[styles.gridValue, { color: '#22d3ee' }]}>${agent.costToday.toFixed(2)}</Text>
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
          <Text style={[styles.gridValue, { color: '#22c55e' }]}>
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

            const NEON_SKIN_TONES = ['#ff00ff', '#00ff88', '#00ffff', '#ff4444', '#ffff00', '#aa55ff'];

            const ColorScroll = ({ label, colors, value, onSelect }: { label: string; colors: string[]; value: string; onSelect: (c: string) => void }) => (
              <>
                <Text style={styles.custSectionTitle}>{label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.custScroll}>
                  {colors.map(c => {
                    const active = value === c;
                    const isNeon = NEON_SKIN_TONES.includes(c);
                    return (
                      <Pressable key={c} onPress={() => onSelect(c)}
                        style={[styles.custItemSwatch, { backgroundColor: c }, isNeon && { shadowColor: c, shadowOffset: { width: 0, height: 0 }, shadowRadius: 8, shadowOpacity: 0.9 }, active && styles.custItemSwatchActive, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        {active && <Text style={styles.custItemCheck}>✓</Text>}
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            );

            const ItemScroll = ({ label, items }: { label: string; items: { key: string; emoji: string; name: string; active: boolean; glow?: string }[] }) => (
              <>
                <Text style={styles.custSectionTitle}>{label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.custScroll}>
                  {items.map(item => (
                    <Pressable key={item.key}
                      onPress={() => {
                        const field = label === 'HAT' ? 'hat' : label === 'EXPRESSION' ? 'expression' : label === 'ACCESSORY' ? 'accessory' : label === 'BACK ITEM' ? 'backItem' : label === 'FACIAL HAIR' ? 'facialHair' : label === 'PET' ? 'pet' : label === 'AURA' ? 'aura' : label === 'HAND ITEM' ? 'handItem' : label === 'HAIR STYLE' ? 'hairStyle' : '';
                        if (field) update({ [field]: item.key } as any);
                      }}
                      style={[styles.custItemCard, item.active && styles.custItemCardActive, item.active && item.glow && { shadowColor: item.glow, shadowOffset: { width: 0, height: 0 }, shadowRadius: 10, shadowOpacity: 0.8 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={styles.custItemEmoji}>{item.emoji}</Text>
                      <Text style={[styles.custItemLabel, item.active && styles.custItemLabelActive]}>{item.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
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

                <ColorScroll label="SKIN" colors={SKIN_TONES} value={a.skinTone} onSelect={c => update({ skinTone: c })} />
                <ColorScroll label="HAIR COLOR" colors={HAIR_COLORS} value={a.hairColor} onSelect={c => update({ hairColor: c })} />
                <ItemScroll label="HAIR STYLE" items={['flat', 'spiky', 'mohawk', 'long', 'curly', 'ponytail', 'cap', 'bald', 'buzzcut', 'afro', 'undercut', 'pigtails'].map(h => {
                  const emojis: Record<string, string> = { flat: '➡️', spiky: '⬆️', mohawk: '🔱', long: '💇', curly: '🌀', ponytail: '🎀', cap: '🧢', bald: '🥚', buzzcut: '✂️', afro: '🟤', undercut: '💈', pigtails: '🎗️' };
                  return { key: h, emoji: emojis[h], name: h.toUpperCase(), active: a.hairStyle === h };
                })} />
                <ColorScroll label="EYES" colors={EYE_COLORS} value={a.eyeColor} onSelect={c => update({ eyeColor: c })} />
                <ColorScroll label="SHIRT" colors={SHIRT_COLORS} value={a.shirtColor} onSelect={c => update({ shirtColor: c })} />
                <ColorScroll label="PANTS" colors={PANTS_COLORS} value={a.pantsColor} onSelect={c => update({ pantsColor: c })} />
                <ColorScroll label="SHOES" colors={SHOE_COLORS} value={a.shoeColor} onSelect={c => update({ shoeColor: c })} />
                <ItemScroll label="EXPRESSION" items={['neutral', 'happy', 'focused', 'sleepy', 'cool', 'angry', 'surprised', 'smirk', 'crying'].map(e => {
                  const emojis: Record<string, string> = { neutral: '😐', happy: '😊', focused: '🤨', sleepy: '😴', cool: '😎', angry: '😠', surprised: '😲', smirk: '😏', crying: '😢' };
                  return { key: e, emoji: emojis[e], name: e.toUpperCase(), active: a.expression === e };
                })} />
                <ItemScroll label="HAT" items={['none', 'cap', 'tophat', 'beanie', 'crown', 'helmet', 'horns', 'space_helmet', 'wizard_hat', 'halo', 'antenna', 'crab_helmet', 'pirate_hat', 'cowboy_hat', 'fez', 'mohawk_spikes'].map(h => {
                  const emojis: Record<string, string> = { none: '🚫', cap: '🧢', tophat: '🎩', beanie: '🧶', crown: '👑', helmet: '⛑️', horns: '😈', space_helmet: '🚀', wizard_hat: '🧙', halo: '😇', antenna: '👽', crab_helmet: '🦀', pirate_hat: '🏴‍☠️', cowboy_hat: '🤠', fez: '🎖️', mohawk_spikes: '🔩' };
                  const names: Record<string, string> = { none: 'NONE', cap: 'CAP', tophat: 'TOP HAT', beanie: 'BEANIE', crown: 'CROWN', helmet: 'HELMET', horns: 'HORNS', space_helmet: 'SPACE', wizard_hat: 'WIZARD', halo: 'HALO', antenna: 'ANTENNA', crab_helmet: 'CRAB', pirate_hat: 'PIRATE', cowboy_hat: 'COWBOY', fez: 'FEZ', mohawk_spikes: 'SPIKES' };
                  return { key: h, emoji: emojis[h], name: names[h], active: a.hat === h };
                })} />
                <ItemScroll label="ACCESSORY" items={['none', 'glasses', 'headphones', 'bowtie', 'scarf', 'hoodie', 'mask', 'monocle', 'eyepatch', 'bandana', 'chain', 'piercing', 'visor_shades', 'gas_mask'].map(x => {
                  const emojis: Record<string, string> = { none: '🚫', glasses: '👓', headphones: '🎧', bowtie: '🎀', scarf: '🧣', hoodie: '🧥', mask: '😷', monocle: '🧐', eyepatch: '🏴‍☠️', bandana: '🥷', chain: '⛓️', piercing: '💎', visor_shades: '🕶️', gas_mask: '☣️' };
                  const names: Record<string, string> = { none: 'NONE', glasses: 'GLASSES', headphones: 'PHONES', bowtie: 'BOWTIE', scarf: 'SCARF', hoodie: 'HOODIE', mask: 'MASK', monocle: 'MONOCLE', eyepatch: 'PATCH', bandana: 'BANDANA', chain: 'CHAIN', piercing: 'PIERCE', visor_shades: 'VISOR', gas_mask: 'GAS MASK' };
                  return { key: x, emoji: emojis[x], name: names[x], active: a.accessory === x };
                })} />
                <ItemScroll label="FACIAL HAIR" items={['none', 'stubble', 'beard', 'mustache', 'goatee', 'fu_manchu', 'sideburns', 'soul_patch'].map(f => {
                  const emojis: Record<string, string> = { none: '🚫', stubble: '🔘', beard: '🧔', mustache: '👨', goatee: '🐐', fu_manchu: '🐉', sideburns: '🔲', soul_patch: '▪️' };
                  const names: Record<string, string> = { none: 'NONE', stubble: 'STUBBLE', beard: 'BEARD', mustache: 'STACHE', goatee: 'GOATEE', fu_manchu: 'FU MANCHU', sideburns: 'BURNS', soul_patch: 'PATCH' };
                  return { key: f, emoji: emojis[f], name: names[f], active: (a.facialHair || 'none') === f };
                })} />
                <ItemScroll label="BACK ITEM" items={['none', 'cape', 'backpack', 'wings', 'jetpack', 'shield', 'sword', 'quiver', 'crab_shell', 'tentacles', 'rocket', 'scroll', 'boombox'].map(b => {
                  const emojis: Record<string, string> = { none: '🚫', cape: '🦸', backpack: '🎒', wings: '🪽', jetpack: '🚀', shield: '🛡️', sword: '⚔️', quiver: '🏹', crab_shell: '🦀', tentacles: '🐙', rocket: '🚀', scroll: '📜', boombox: '📻' };
                  const names: Record<string, string> = { none: 'NONE', cape: 'CAPE', backpack: 'PACK', wings: 'WINGS', jetpack: 'JETPACK', shield: 'SHIELD', sword: 'SWORD', quiver: 'QUIVER', crab_shell: 'SHELL', tentacles: 'TENTACLES', rocket: 'ROCKET', scroll: 'SCROLL', boombox: 'BOOMBOX' };
                  return { key: b, emoji: emojis[b], name: names[b], active: (a.backItem || 'none') === b };
                })} />
                <ItemScroll label="PET" items={['none', 'cat', 'dog', 'bird', 'robot', 'dragon', 'alien', 'crab', 'snake', 'bat', 'skull', 'mushroom', 'spider', 'shark', 'bones'].map(p => {
                  const emojis: Record<string, string> = { none: '🚫', cat: '🐱', dog: '🐕', bird: '🐦', robot: '🤖', dragon: '🐉', alien: '👽', crab: '🦀', snake: '🐍', bat: '🦇', skull: '💀', mushroom: '🍄', spider: '🕷️', shark: '🦈', bones: '🦴' };
                  const names: Record<string, string> = { none: 'NONE', cat: 'CAT', dog: 'DOG', bird: 'BIRD', robot: 'ROBOT', dragon: 'DRAGON', alien: 'ALIEN', crab: 'CRAB', snake: 'SNAKE', bat: 'BAT', skull: 'SKULL', mushroom: 'SHROOM', spider: 'SPIDER', shark: 'SHARK', bones: 'BONES' };
                  return { key: p, emoji: emojis[p], name: names[p], active: (a.pet || 'none') === p };
                })} />
                <ItemScroll label="AURA" items={['none', 'fire', 'ice', 'electric', 'nature', 'shadow', 'rainbow', 'glitch', 'cosmic', 'toxic', 'holy', 'void', 'galaxy'].map(au => {
                  const emojis: Record<string, string> = { none: '🚫', fire: '🔥', ice: '🧊', electric: '⚡', nature: '🌿', shadow: '🌑', rainbow: '🌈', glitch: '📟', cosmic: '✨', toxic: '☢️', holy: '🕊️', void: '🕳️', galaxy: '🌌' };
                  const names: Record<string, string> = { none: 'NONE', fire: 'FIRE', ice: 'ICE', electric: 'BOLT', nature: 'LEAF', shadow: 'SHADOW', rainbow: 'RAINBOW', glitch: 'GLITCH', cosmic: 'COSMIC', toxic: 'TOXIC', holy: 'HOLY', void: 'VOID', galaxy: 'GALAXY' };
                  const glowColors: Record<string, string> = { fire: '#ef4444', ice: '#22d3ee', electric: '#f59e0b', nature: '#22c55e', shadow: '#6f6f6f', rainbow: '#a855f7', cosmic: '#6366f1', toxic: '#22c55e', holy: '#ffd700', galaxy: '#a855f7' };
                  return { key: au, emoji: emojis[au], name: names[au], active: (a.aura || 'none') === au, glow: glowColors[au] };
                })} />
                <ItemScroll label="HAND ITEM" items={['none', 'lightsaber', 'coffee', 'laptop', 'flag', 'wand', 'crab_claws', 'sword_hand', 'pizza', 'microphone', 'torch'].map(hi => {
                  const emojis: Record<string, string> = { none: '🚫', lightsaber: '⚔️', coffee: '☕', laptop: '💻', flag: '🚩', wand: '🪄', crab_claws: '🦞', sword_hand: '🗡️', pizza: '🍕', microphone: '🎤', torch: '🔦' };
                  const names: Record<string, string> = { none: 'NONE', lightsaber: 'SABER', coffee: 'COFFEE', laptop: 'LAPTOP', flag: 'FLAG', wand: 'WAND', crab_claws: 'CLAWS', sword_hand: 'SWORD', pizza: 'PIZZA', microphone: 'MIC', torch: 'TORCH' };
                  return { key: hi, emoji: emojis[hi], name: names[hi], active: (a.handItem || 'none') === hi };
                })} />
              </View>
            );
          })()}
        </View>
      )}

      {/* Agent Soul section removed — merged into SPIRIT & SOUL above */}

      {/* ── SECTION: agent-controls — Bridge status + power + remote shell ── */}
      {circleId && sessionKey && (
        <View style={{ marginTop: 8 }} nativeID="section-agent-controls">
          <AgentControlCard
            agent={agent}
            circleId={circleId}
            control={control}
            onClose={() => {}}
            onOpenPanel={() => {}}
            onDisconnect={onClose}
            onRunCommand={onRunCommand}
            embedded
          />
        </View>
      )}

      {/* ── SECTION: agent-quick-terminal — Inline command to this agent ── */}
      {circleId && (
        <AgentQuickTerminal agentName={agent.name} agentId={agent.id} circleId={circleId} />
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
    backgroundColor: '#0a0a0a',
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
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
    borderColor: '#2a2a2a',
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
    backgroundColor: '#000000',
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
    backgroundColor: '#22c55e15',
    borderWidth: 1,
    borderColor: '#22c55e30',
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
    backgroundColor: '#161616',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
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
    borderColor: '#2a2a2a',
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
    borderColor: '#2a2a2a',
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
    gap: 4,
    paddingTop: 8,
  },
  custPreview: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 4,
  },
  custSectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: '#777',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
    marginTop: 6,
    marginBottom: 3,
  },
  custScroll: {
    marginBottom: 2,
  },
  custItemSwatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 2.5,
    borderColor: 'transparent',
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  custItemSwatchActive: {
    borderColor: '#fff',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 8px rgba(255,255,255,0.4)' } as any : {}),
  },
  custItemCheck: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '900',
    textShadowColor: '#000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  custItemCard: {
    width: 60,
    height: 60,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#2a2a2a',
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    gap: 1,
  },
  custItemCardActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 10px rgba(99,102,241,0.3)' } as any : {}),
  },
  custItemEmoji: {
    fontSize: 20,
  },
  custItemLabel: {
    fontSize: 7,
    color: '#555',
    fontFamily: 'monospace',
    fontWeight: '700',
    textAlign: 'center',
  },
  custItemLabelActive: {
    color: '#ddd',
  },
  // Spirit styles
  spiritRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  spiritLabel: {
    color: '#555', fontSize: 9, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1,
  },
  spiritBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
  },
  spiritBadgeText: {
    color: '#6366f1', fontSize: 9, fontWeight: '600', fontFamily: 'monospace',
  },
  spiritNone: {
    color: '#333', fontSize: 9, fontFamily: 'monospace',
  },
  spiritPicker: {
    padding: 10, gap: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  spiritHint: {
    color: '#555', fontSize: 9, fontFamily: 'monospace', lineHeight: 13,
  },
  spiritClearBtn: {
    paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6,
    backgroundColor: '#2a2a2a', alignSelf: 'flex-start',
  },
  spiritClearText: {
    color: '#ef4444', fontSize: 9, fontWeight: '600', fontFamily: 'monospace',
  },
  spiritCatLabel: {
    fontSize: 9, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 1,
    marginBottom: 4, marginTop: 4,
  },
  spiritGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 4,
  },
  spiritCard: {
    width: '48%', padding: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0a0a0a',
  },
  spiritEmoji: { fontSize: 14, marginBottom: 2 },
  spiritName: {
    color: '#6366f1', fontSize: 10, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritTagline: {
    color: '#555', fontSize: 8, fontFamily: 'monospace', lineHeight: 11, marginTop: 1,
  },

  // Inline soul section (inside spirit picker)
  soulInlineSection: {
    marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#2a2a2a',
  },
  personalityChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000000',
    marginRight: 6,
  },
  personalityChipText: {
    fontSize: 9, color: '#aaa', fontFamily: 'monospace', fontWeight: '600',
  },

  // Soul / personality styles
  soulActiveBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
    marginLeft: 8,
  },
  soulActiveBadgeText: {
    fontSize: 7, color: '#aaa', fontFamily: 'monospace', fontWeight: '700',
  },
  soulBody: {
    gap: 8, paddingTop: 8,
  },
  soulHint: {
    fontSize: 9, color: '#666', fontFamily: 'monospace', fontStyle: 'italic', lineHeight: 13,
  },
  soulCategoryRow: {
    flexDirection: 'row', gap: 4,
  },
  soulCategoryTab: {
    flex: 1, paddingVertical: 6, paddingHorizontal: 4, borderRadius: 6,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#000000',
    alignItems: 'center',
  },
  soulCategoryText: {
    fontSize: 8, color: '#555', fontFamily: 'monospace', fontWeight: '700',
  },
  soulCard: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 6, padding: 8, gap: 3, marginBottom: 4,
  },
  soulCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  soulCardName: {
    fontSize: 10, fontWeight: '800', color: '#999', fontFamily: 'monospace', flex: 1,
  },
  soulCardDesc: {
    fontSize: 8, color: '#555', fontFamily: 'monospace', lineHeight: 12,
  },
  soulInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#2a2a2a',
    borderRadius: 6, padding: 8, color: '#ccc', fontFamily: 'monospace',
    fontSize: 9, minHeight: 80, textAlignVertical: 'top',
  },
  soulActions: {
    flexDirection: 'row', gap: 6, alignItems: 'center',
  },
  soulSaveBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140',
  },
  soulSaveBtnText: {
    fontSize: 8, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5,
  },
  soulClearBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#ef444420', borderWidth: 1, borderColor: '#ef444440',
  },
  soulClearBtnText: {
    fontSize: 8, color: '#ef4444', fontFamily: 'monospace', fontWeight: '800',
  },
});
