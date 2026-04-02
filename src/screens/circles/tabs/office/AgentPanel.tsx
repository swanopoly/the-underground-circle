import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Pressable, Platform, ScrollView } from 'react-native';
import { OfficeAgent, getOfficeStatusColor, getOfficeStatusLabel } from '../../../../lib/officeAgents';
import FlatIcon, { ICON_CATALOG } from '../../../../components/FlatIcon';
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
  const [showSpirits, setShowSpirits] = useState(true);
  const [editingSpirit, setEditingSpirit] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [customKnobs, setCustomKnobs] = useState({
    actionPosture: 'propose' as string,
    evidencePosture: 'high' as string,
    communicationDensity: 'normal' as string,
    skepticism: 'medium' as string,
    riskTier: 'medium' as string,
    escalationTrigger: '',
    skillBundle: '',
  });
  const [customProfiles, setCustomProfiles] = useState<any[]>([]);
  const [savingProfile, setSavingProfile] = useState(false);
  const [saveProfileName, setSaveProfileName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const personalityScrollRef = useRef<ScrollView>(null);
  const personalityScrollX = useRef(0);
  const [currentSpirit, setCurrentSpirit] = useState<string | null>(null);
  const [dbAgentId, setDbAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (agent) {
      slideAnim.setValue(isDesktop ? 420 : 400);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: Platform.OS !== 'web',
        tension: 120,
        friction: 16,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: isDesktop ? 420 : 400,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [agent, isDesktop]);

  // Extract sessionKey early so hooks always run in same order
  const sessionKey = agent
    ? (agent.sessionKey || (agent.id.includes('::') ? agent.id.split('::')[1] : agent.id))
    : undefined;

  const control = useAgentControl(circleId, sessionKey);

  // Load or create DB agent row when panel opens
  const ensureDbAgent = useCallback(async (): Promise<string | null> => {
    if (dbAgentId) return dbAgentId;
    if (!agent || !circleId) return null;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return null;
    // Try to find existing row
    const { data } = await supabase
      .from('circle_office_agents')
      .select('id, spirit, spirit_emoji')
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .ilike('name', agent.name)
      .maybeSingle();
    if (data) {
      setDbAgentId(data.id);
      setCurrentSpirit(data.spirit || null);
      return data.id;
    }
    // Auto-create if missing
    const { data: created, error } = await supabase
      .from('circle_office_agents')
      .upsert({
        circle_id: circleId,
        owner_id: auth.user.id,
        name: agent.name,
        provider: agent.providerType || 'claude-code',
        status: agent.status || 'idle',
        color: agent.color || '#6366f1',
      }, { onConflict: 'circle_id,owner_id,name' })
      .select('id')
      .single();
    if (created && !error) {
      setDbAgentId(created.id);
      return created.id;
    }
    return null;
  }, [dbAgentId, agent, circleId]);

  useEffect(() => {
    ensureDbAgent();
    // Load custom profiles
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const { data } = await supabase
        .from('custom_agent_profiles')
        .select('*')
        .eq('user_id', auth.user.id)
        .order('name');
      if (data) setCustomProfiles(data);
    })();
  }, [ensureDbAgent]);

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

  const statusColor = getOfficeStatusColor(agent.status);
  const statusLabel = getOfficeStatusLabel(agent.status).toUpperCase();
  const currentTags = sessionTags?.get(sessionKey!) || [];

  return (
    <Animated.View style={[
      styles.panel,
      isDesktop
        ? { transform: [{ translateX: slideAnim }] }
        : { transform: [{ translateY: slideAnim }] },
      isDesktop && styles.panelDesktop,
    ]}>
      {/* Close button (desktop: top-right X, mobile: drag handle) */}
      {isDesktop ? (
        <View style={styles.desktopHeader}>
          <Text style={styles.desktopHeaderTitle}>AGENT PANEL</Text>
          <Pressable onPress={onClose} style={[styles.desktopCloseBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={styles.desktopCloseBtnText}>✕</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={onClose} style={styles.handleArea}>
          <View style={styles.handle} />
        </Pressable>
      )}

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
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Connection source */}
      <View style={styles.connectionRow}>
        <Text style={styles.connectionIcon}>{PROVIDER_META[agent.providerType]?.icon || '📡'}</Text>
        <Text style={[styles.connectionName, { color: PROVIDER_META[agent.providerType]?.color || '#888' }]}>{agent.connectionName}</Text>
        <Text style={styles.connectionType}>{PROVIDER_META[agent.providerType]?.label || agent.providerType}</Text>
      </View>

      {/* ── Bridge controls + remote shell (moved up for quick access) ── */}
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

      {/* ── Quick terminal — talk to this agent ── */}
      {circleId && (
        <AgentQuickTerminal agentName={agent.name} agentId={agent.id} circleId={circleId} />
      )}

      <View style={styles.sectionDivider} />

      {/* Agent Spirit & Soul — unified section */}
      <Pressable
        onPress={() => setShowSpirits(!showSpirits)}
        style={[styles.spiritRow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <Text style={styles.spiritLabel}>
          {showSpirits ? '▼' : '▶'} SOUL
        </Text>
        {currentSpirit ? (
          <View style={[styles.spiritBadge, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
            {ICON_CATALOG[currentSpirit] ? (
              <FlatIcon name={currentSpirit} size={18} />
            ) : (
              <Text style={{ fontSize: 12 }}>{getSpiritById(currentSpirit)?.emoji}</Text>
            )}
            <Text style={styles.spiritBadgeText}>
              {getSpiritById(currentSpirit)?.name}
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
          {/* Selected spirit detail view — editable */}
          {currentSpirit && getSpiritById(currentSpirit) && (() => {
            const s = getSpiritById(currentSpirit)!;
            const postureColors: Record<string, string> = {
              'act': '#22c55e', 'act-gated': '#3b82f6', 'observe-act-gated': '#f59e0b',
              'observe-propose': '#a855f7', 'propose': '#6366f1', 'never-act': '#ef4444',
            };
            const riskColors: Record<string, string> = {
              'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'critical': '#dc2626',
            };
            const knobs = editingSpirit ? customKnobs : {
              actionPosture: s.actionPosture, evidencePosture: s.evidencePosture,
              communicationDensity: s.communicationDensity, skepticism: s.skepticism,
              riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle,
            };
            const prompt = editingSpirit ? customPrompt : s.systemPromptPrefix;

            const KnobPicker = ({ label, value, options, colors }: { label: string; value: string; options: string[]; colors?: Record<string, string> }) => (
              <View style={styles.spiritKnob}>
                <Text style={styles.spiritKnobLabel}>{label}</Text>
                {editingSpirit ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                    {options.map(opt => (
                      <Pressable key={opt} onPress={() => setCustomKnobs(prev => ({ ...prev, [label === 'ACTION' ? 'actionPosture' : label === 'EVIDENCE' ? 'evidencePosture' : label === 'COMMUNICATION' ? 'communicationDensity' : label === 'SKEPTICISM' ? 'skepticism' : 'riskTier']: opt }))}
                        style={[{ paddingHorizontal: 4, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: value === opt ? (colors?.[opt] || '#6366f1') + '60' : '#1e1e3a', backgroundColor: value === opt ? (colors?.[opt] || '#6366f1') + '15' : 'transparent' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={{ fontSize: 8, fontFamily: 'monospace', fontWeight: '700', color: value === opt ? (colors?.[opt] || '#6366f1') : '#555' }}>{opt.replace(/-/g, ' ').toUpperCase()}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={[styles.spiritKnobValue, { color: (colors?.[value] || '#6366f1') }]}>{value.replace(/-/g, ' ').toUpperCase()}</Text>
                )}
              </View>
            );

            return (
              <View style={styles.spiritDetail}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  {ICON_CATALOG[s.id] ? <FlatIcon name={s.id} size={28} glow /> : <Text style={{ fontSize: 24 }}>{s.emoji}</Text>}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.spiritDetailName}>{s.name}</Text>
                    <Text style={styles.spiritDetailTagline}>{s.tagline}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable
                      onPress={() => {
                        if (!editingSpirit) {
                          setCustomPrompt(s.systemPromptPrefix);
                          setCustomKnobs({ actionPosture: s.actionPosture, evidencePosture: s.evidencePosture, communicationDensity: s.communicationDensity, skepticism: s.skepticism, riskTier: s.riskTier, escalationTrigger: s.escalationTrigger, skillBundle: s.skillBundle });
                        }
                        setEditingSpirit(!editingSpirit);
                      }}
                      style={[{ paddingVertical: 5, paddingHorizontal: 10, borderRadius: 6, backgroundColor: editingSpirit ? '#6366f120' : '#ffffff08', borderWidth: 1, borderColor: editingSpirit ? '#6366f140' : '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <Text style={{ fontSize: 10, fontFamily: 'monospace', fontWeight: '700', color: editingSpirit ? '#6366f1' : '#888' }}>{editingSpirit ? 'EDITING' : 'EDIT'}</Text>
                    </Pressable>
                    <Pressable onPress={async () => { const id = await ensureDbAgent(); if (id) { await updateAgentSpirit(id, null, null); setCurrentSpirit(null); setEditingSpirit(false); } }}
                      style={[styles.spiritClearBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <Text style={styles.spiritClearText}>Clear</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Behavioral knobs */}
                <View style={styles.spiritKnobsGrid}>
                  <KnobPicker label="ACTION" value={knobs.actionPosture} options={['act', 'act-gated', 'observe-act-gated', 'observe-propose', 'propose', 'never-act']} colors={postureColors} />
                  <KnobPicker label="EVIDENCE" value={knobs.evidencePosture} options={['medium', 'high', 'very-high']} />
                  <KnobPicker label="COMMUNICATION" value={knobs.communicationDensity} options={['terse', 'normal', 'detailed', 'motivational']} />
                  <KnobPicker label="SKEPTICISM" value={knobs.skepticism} options={['low', 'medium', 'high', 'very-high']} colors={{ 'low': '#22c55e', 'medium': '#f59e0b', 'high': '#ef4444', 'very-high': '#dc2626' }} />
                  <KnobPicker label="RISK TIER" value={knobs.riskTier} options={['low', 'medium', 'high', 'critical']} colors={riskColors} />
                  <View style={styles.spiritKnob}>
                    <Text style={styles.spiritKnobLabel}>SKILL</Text>
                    {editingSpirit ? (
                      <TextInput value={customKnobs.skillBundle} onChangeText={v => setCustomKnobs(prev => ({ ...prev, skillBundle: v }))}
                        style={{ fontSize: 9, color: '#6366f1', fontFamily: 'monospace', fontWeight: '700', textAlign: 'center', borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 2 }} placeholder="skill-name" placeholderTextColor="#333" />
                    ) : (
                      <Text style={[styles.spiritKnobValue, { color: '#6366f1' }]} numberOfLines={1}>{knobs.skillBundle}</Text>
                    )}
                  </View>
                </View>

                {/* Escalation trigger */}
                <View style={styles.spiritEscalation}>
                  <Text style={styles.spiritKnobLabel}>ESCALATES WHEN</Text>
                  {editingSpirit ? (
                    <TextInput value={customKnobs.escalationTrigger} onChangeText={v => setCustomKnobs(prev => ({ ...prev, escalationTrigger: v }))}
                      style={[styles.spiritEscalationText, { borderBottomWidth: 1, borderBottomColor: '#1e1e3a', paddingVertical: 4 }]}
                      placeholder="e.g. failing tests, unclear requirements" placeholderTextColor="#333" />
                  ) : (
                    <Text style={styles.spiritEscalationText}>{knobs.escalationTrigger}</Text>
                  )}
                </View>

                {/* System prompt — collapsible, editable */}
                <Pressable onPress={() => setShowSoul(!showSoul)} style={[{ marginTop: 10, paddingVertical: 6 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                  <Text style={{ color: '#888', fontSize: 11, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 }}>
                    {showSoul ? '▼' : '▶'} SYSTEM PROMPT ({Math.round(prompt.length / 100) * 100}+ chars)
                  </Text>
                </Pressable>
                {showSoul && (
                  <View style={{ marginTop: 4 }}>
                    {editingSpirit ? (
                      <TextInput value={customPrompt} onChangeText={setCustomPrompt} multiline
                        style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12, color: '#ccc', fontFamily: 'monospace', fontSize: 11, minHeight: 200, maxHeight: 400, textAlignVertical: 'top' }}
                        placeholder="System prompt instructions..." placeholderTextColor="#333" />
                    ) : (
                      <ScrollView style={{ maxHeight: 300, backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 12 }}>
                        <Text style={{ color: '#aaa', fontFamily: 'monospace', fontSize: 11, lineHeight: 17 }} selectable>{prompt}</Text>
                      </ScrollView>
                    )}
                  </View>
                )}

                {/* Save as custom profile */}
                {editingSpirit && (
                  <View style={{ marginTop: 12 }}>
                    {showSaveForm ? (
                      <View style={{ gap: 8 }}>
                        <TextInput value={saveProfileName} onChangeText={setSaveProfileName} placeholder="Profile name..." placeholderTextColor="#555"
                          style={{ backgroundColor: '#000', borderWidth: 1, borderColor: '#1e1e3a', borderRadius: 8, padding: 10, color: '#eee', fontFamily: 'monospace', fontSize: 13 }} />
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Pressable
                            onPress={async () => {
                              if (!saveProfileName.trim()) return;
                              setSavingProfile(true);
                              const { data: auth } = await supabase.auth.getUser();
                              if (!auth.user) { setSavingProfile(false); return; }
                              const { data, error } = await supabase.from('custom_agent_profiles').upsert({
                                user_id: auth.user.id, name: saveProfileName.trim(),
                                system_prompt: customPrompt, skill_bundle: customKnobs.skillBundle,
                                risk_tier: customKnobs.riskTier, action_posture: customKnobs.actionPosture,
                                evidence_posture: customKnobs.evidencePosture, communication_density: customKnobs.communicationDensity,
                                skepticism: customKnobs.skepticism, escalation_trigger: customKnobs.escalationTrigger,
                                emoji: getSpiritById(currentSpirit)?.emoji || '🤖', color: getSpiritById(currentSpirit)?.color || '#6366f1',
                                tagline: `Custom ${s.name} profile`,
                              }, { onConflict: 'user_id,name' }).select().single();
                              if (!error && data) {
                                setCustomProfiles(prev => [...prev.filter(p => p.id !== data.id), data]);
                                setShowSaveForm(false); setSaveProfileName('');
                              }
                              setSavingProfile(false);
                            }}
                            style={[{ flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#22c55e15', borderWidth: 1, borderColor: '#22c55e40', alignItems: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={{ color: '#22c55e', fontSize: 12, fontFamily: 'monospace', fontWeight: '800' }}>{savingProfile ? '...' : 'SAVE PROFILE'}</Text>
                          </Pressable>
                          <Pressable onPress={() => setShowSaveForm(false)}
                            style={[{ paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, backgroundColor: '#ffffff08', borderWidth: 1, borderColor: '#ffffff15' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                            <Text style={{ color: '#888', fontSize: 12, fontFamily: 'monospace', fontWeight: '700' }}>Cancel</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable onPress={() => { setSaveProfileName(s.name + ' (Custom)'); setShowSaveForm(true); }}
                        style={[{ paddingVertical: 10, borderRadius: 8, backgroundColor: '#6366f115', borderWidth: 1, borderColor: '#6366f140', alignItems: 'center' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                        <Text style={{ color: '#6366f1', fontSize: 12, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.5 }}>💾 SAVE AS CUSTOM PROFILE</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })()}

          {/* Custom profiles section */}
          {customProfiles.length > 0 && (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.spiritCatLabel, { color: '#22c55e' }]}>Your Custom Profiles</Text>
              <View style={styles.spiritGrid}>
                {customProfiles.map(profile => {
                  const active = currentSpirit === `custom::${profile.id}`;
                  return (
                    <Pressable key={profile.id}
                      onPress={async () => {
                        const id = await ensureDbAgent();
                        if (id) {
                          await updateAgentSpirit(id, `custom::${profile.id}`, profile.emoji);
                          setCurrentSpirit(`custom::${profile.id}`);
                        }
                      }}
                      onLongPress={async () => {
                        // Delete on long press
                        await supabase.from('custom_agent_profiles').delete().eq('id', profile.id);
                        setCustomProfiles(prev => prev.filter(p => p.id !== profile.id));
                        if (currentSpirit === `custom::${profile.id}`) {
                          const dbId = await ensureDbAgent();
                          if (dbId) { await updateAgentSpirit(dbId, null, null); setCurrentSpirit(null); }
                        }
                      }}
                      style={[styles.spiritCard, active && { borderColor: (profile.color || '#22c55e') + '60', backgroundColor: (profile.color || '#22c55e') + '10' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        <Text style={{ fontSize: 28 }}>{profile.emoji || '🤖'}</Text>
                      </View>
                      <Text style={[styles.spiritName, active && { color: profile.color || '#22c55e' }]} numberOfLines={1}>{profile.name}</Text>
                      <Text style={styles.spiritTagline} numberOfLines={1}>{profile.tagline || 'Custom profile'}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
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
                        const id = await ensureDbAgent();
                        if (id) {
                          await updateAgentSpirit(id, spirit.id, spirit.emoji);
                          setCurrentSpirit(spirit.id);
                        }
                      }}
                      style={[
                        styles.spiritCard,
                        active && { borderColor: spirit.color + '60', backgroundColor: spirit.color + '10' },
                        Platform.OS === 'web' && { cursor: 'pointer' } as any,
                      ]}
                    >
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        {ICON_CATALOG[spirit.id] ? (
                          <FlatIcon name={spirit.id} size={32} glow={active} />
                        ) : (
                          <Text style={styles.spiritEmoji}>{spirit.emoji}</Text>
                        )}
                      </View>
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

              {/* Personality template quick-picks with scroll arrows */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 4 }}>
                <Pressable
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: Math.max(0, (personalityScrollX.current || 0) - 200), animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>‹</Text>
                </Pressable>
                <ScrollView
                  ref={personalityScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flex: 1 }}
                  onScroll={(e) => { personalityScrollX.current = e.nativeEvent.contentOffset.x; }}
                  scrollEventThrottle={16}
                >
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
                <Pressable
                  onPress={() => personalityScrollRef.current?.scrollTo({ x: (personalityScrollX.current || 0) + 200, animated: true })}
                  style={[styles.scrollArrow, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                >
                  <Text style={styles.scrollArrowText}>›</Text>
                </Pressable>
              </View>

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
          <Text style={[styles.gridValue, { color: '#22c55e' }]}>${((agent as any).costTotal || agent.costToday).toFixed(2)}</Text>
          <Text style={styles.gridLabel}>Total Cost</Text>
        </View>
        <View style={styles.gridCard}>
          <Text style={[styles.gridValue, { color: '#22d3ee' }]}>${agent.costToday.toFixed(2)}</Text>
          <Text style={styles.gridLabel}>Session Cost</Text>
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
            const a = appearances?.[agent.id] || appearances?.[agent.name] || { ...DEFAULT_APPEARANCE, shirtColor: agent.color, hairColor: agent.color };
            const update = (patch: Partial<AgentAppearance>) => {
              onAppearanceChange(agent.id, { ...a, ...patch });
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
    borderTopColor: '#1e1e3a',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '70%' as any,
  },
  panelDesktop: {
    top: 0,
    bottom: 0,
    left: 'auto' as any,
    right: 0,
    width: 540,
    maxHeight: '100%' as any,
    borderRadius: 0,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
    borderTopRightRadius: 0,
    borderTopWidth: 0,
    borderLeftWidth: 1,
    borderLeftColor: '#1e1e3a',
    ...(Platform.OS === 'web' ? {
      boxShadow: '-8px 0 30px rgba(0,0,0,0.5)',
    } as any : {}),
  },
  desktopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e3a',
    marginBottom: 8,
  },
  desktopHeaderTitle: {
    color: '#555',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  desktopCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopCloseBtnText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
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
  sectionDivider: {
    height: 1,
    backgroundColor: '#1e1e3a',
    marginVertical: 12,
    marginHorizontal: -4,
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
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
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
    fontSize: 13,
    color: '#888',
    fontFamily: 'monospace',
  },
  modelBadge: {
    backgroundColor: '#ffffff08',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ffffff10',
  },
  modelText: {
    fontSize: 10,
    color: '#777',
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  statusDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  // Connection source
  connectionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 10, paddingHorizontal: 4,
  },
  connectionIcon: { fontSize: 16 },
  connectionName: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  connectionType: { fontSize: 11, color: '#666', fontFamily: 'monospace' },
  // Activity bar
  activityBar: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#111',
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e1e3a',
  },
  activityLabel: {
    fontSize: 12,
    color: '#666',
    fontFamily: 'monospace',
    fontWeight: '800',
  },
  activityValue: {
    fontSize: 13,
    color: '#ccc',
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
    borderColor: '#1e1e3a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    minWidth: '30%' as any,
    flex: 1,
  },
  gridValue: {
    fontSize: 17,
    fontWeight: '900',
    color: '#fff',
    fontFamily: 'monospace',
  },
  gridLabel: {
    fontSize: 10,
    color: '#666',
    fontFamily: 'monospace',
    marginTop: 3,
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
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginBottom: 6,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 6,
  },
  actionTime: {
    fontSize: 10,
    color: '#444',
    fontFamily: 'monospace',
    width: 56,
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
    fontSize: 12,
    color: '#888',
    fontFamily: 'monospace',
    flex: 1,
    lineHeight: 18,
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
    gap: 8,
    marginVertical: 16,
    paddingVertical: 14,
  },
  tagsSectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  // Customize section
  customizeSection: {
    marginTop: 16,
    paddingTop: 12,
  },
  customizeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  customizeToggleText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#aaa',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
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
    fontSize: 12,
    fontWeight: '900',
    color: '#888',
    fontFamily: 'monospace',
    letterSpacing: 2,
    marginTop: 10,
    marginBottom: 6,
  },
  custScroll: {
    marginBottom: 4,
  },
  custItemSwatch: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: 'transparent',
    marginRight: 8,
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
    width: 70,
    height: 70,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#1e1e3a',
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
    gap: 2,
  },
  custItemCardActive: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f120',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 10px rgba(99,102,241,0.3)' } as any : {}),
  },
  custItemEmoji: {
    fontSize: 24,
  },
  custItemLabel: {
    fontSize: 9,
    color: '#666',
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
    paddingHorizontal: 4, paddingVertical: 10,
  },
  spiritLabel: {
    color: '#aaa', fontSize: 13, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5,
  },
  spiritBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
  },
  spiritBadgeText: {
    color: '#6366f1', fontSize: 11, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritNone: {
    color: '#555', fontSize: 11, fontFamily: 'monospace',
  },
  spiritPicker: {
    padding: 12, gap: 10,
  },
  spiritHint: {
    color: '#666', fontSize: 12, fontFamily: 'monospace', lineHeight: 18,
  },
  spiritDetail: {
    backgroundColor: '#08081a',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  spiritDetailName: {
    color: '#fff', fontSize: 15, fontWeight: '800', fontFamily: 'monospace',
  },
  spiritDetailTagline: {
    color: '#888', fontSize: 11, fontFamily: 'monospace', marginTop: 2,
  },
  spiritKnobsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  spiritKnob: {
    width: '30%' as any, backgroundColor: '#0a0a1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', padding: 8, alignItems: 'center',
  },
  spiritKnobLabel: {
    color: '#555', fontSize: 8, fontWeight: '800', fontFamily: 'monospace',
    letterSpacing: 1, marginBottom: 4,
  },
  spiritKnobValue: {
    fontSize: 11, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritEscalation: {
    marginTop: 10, backgroundColor: '#0a0a1a', borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', padding: 10,
  },
  spiritEscalationText: {
    color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginTop: 4, lineHeight: 18,
  },
  spiritClearBtn: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8,
    backgroundColor: '#ef444415', borderWidth: 1, borderColor: '#ef444430',
  },
  spiritClearText: {
    color: '#ef4444', fontSize: 11, fontWeight: '700', fontFamily: 'monospace',
  },
  spiritCatLabel: {
    fontSize: 12, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5,
    marginBottom: 6, marginTop: 8,
  },
  spiritGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
  },
  spiritCard: {
    width: '48%', padding: 12, borderRadius: 10,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#0a0a0a',
    alignItems: 'center',
  },
  spiritEmoji: { fontSize: 28, marginBottom: 4 },
  spiritName: {
    color: '#6366f1', fontSize: 12, fontWeight: '800', fontFamily: 'monospace', textAlign: 'center',
  },
  spiritTagline: {
    color: '#666', fontSize: 10, fontFamily: 'monospace', lineHeight: 15, marginTop: 2, textAlign: 'center',
  },

  // Inline soul section (inside spirit picker)
  soulInlineSection: {
    marginTop: 16, paddingTop: 14,
  },
  scrollArrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff08',
    borderWidth: 1,
    borderColor: '#ffffff15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollArrowText: {
    color: '#aaa',
    fontSize: 20,
    fontWeight: '600',
    marginTop: -1,
  },
  personalityChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#000000',
    marginRight: 8,
  },
  personalityChipText: {
    fontSize: 13, color: '#ccc', fontFamily: 'monospace', fontWeight: '600',
  },

  // Soul / personality styles
  soulActiveBadge: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8,
    borderWidth: 1, borderColor: '#6366f140', backgroundColor: '#6366f115',
    marginLeft: 8,
  },
  soulActiveBadgeText: {
    fontSize: 10, color: '#aaa', fontFamily: 'monospace', fontWeight: '700',
  },
  soulBody: {
    gap: 10, paddingTop: 10,
  },
  soulHint: {
    fontSize: 12, color: '#777', fontFamily: 'monospace', fontStyle: 'italic', lineHeight: 18,
  },
  soulCategoryRow: {
    flexDirection: 'row', gap: 6,
  },
  soulCategoryTab: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 8,
    borderWidth: 1, borderColor: '#1e1e3a', backgroundColor: '#000000',
    alignItems: 'center',
  },
  soulCategoryText: {
    fontSize: 11, color: '#666', fontFamily: 'monospace', fontWeight: '700',
  },
  soulCard: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#1e1e3a',
    borderRadius: 10, padding: 12, gap: 4, marginBottom: 6,
  },
  soulCardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  soulCardName: {
    fontSize: 13, fontWeight: '800', color: '#bbb', fontFamily: 'monospace', flex: 1,
  },
  soulCardDesc: {
    fontSize: 11, color: '#666', fontFamily: 'monospace', lineHeight: 16,
  },
  soulInput: {
    backgroundColor: '#000000', borderWidth: 1, borderColor: '#1e1e3a',
    borderRadius: 10, padding: 12, color: '#ddd', fontFamily: 'monospace',
    fontSize: 13, minHeight: 100, textAlignVertical: 'top',
  },
  soulActions: {
    flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 4,
  },
  soulSaveBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#6366f120', borderWidth: 1, borderColor: '#6366f140',
  },
  soulSaveBtnText: {
    fontSize: 12, color: '#6366f1', fontFamily: 'monospace', fontWeight: '800', letterSpacing: 0.8,
  },
  soulClearBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#ef444420', borderWidth: 1, borderColor: '#ef444440',
  },
  soulClearBtnText: {
    fontSize: 12, color: '#ef4444', fontFamily: 'monospace', fontWeight: '800',
  },
});
